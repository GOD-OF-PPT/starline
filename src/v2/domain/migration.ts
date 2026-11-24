import { calculateSettlement as calculateV1Settlement } from '../../domain/economy';
import {
  PRIMARY_SAVE_KEY as V1_PRIMARY_SAVE_KEY,
  loadSaveData as loadV1SaveData,
  type SaveData as V1SaveData,
} from '../../domain/persistence';
import type { RelicProgress } from '../../domain/progression';
import { V2_INITIAL_BLUEPRINTS } from '../data/equipment';
import { V2_RELIC_ORDER } from '../data/facilities';
import { getAnyV2ItemDef } from './itemCatalog';
import {
  createFreshV2Profile,
  createInitialV2Relics,
  createInitialV3FacilityTiers,
  inferV3CampaignFromV2Profile,
  inferV3CareerFromV2Profile,
  type V2StorageLike,
} from './persistenceV2';
import {
  V2_RULES_VERSION,
  V2_SCHEMA_VERSION,
  type V2MigrationRecord,
  type V2ProfileState,
  type V2SaveData,
} from './types';

export interface V1ActiveRunMigrationPreview {
  readonly expeditionId: string;
  readonly phase: string;
  readonly currentNode: number;
  readonly maxNodes: number;
  readonly resolvedAs: 'safe_return' | 'defeat';
  readonly estimatedCredits: number;
  readonly summaryText: string;
}

export interface V1MigrationInspection {
  readonly hasV1Save: boolean;
  readonly v1Valid: boolean;
  readonly v1Error?: string;
  readonly v1Save?: V1SaveData;
  readonly baseCredits: number;
  readonly activeRunPreview: V1ActiveRunMigrationPreview | null;
  readonly relicsSummary: { readonly stored: number; readonly restored: number };
  readonly legacyAbyssalUnlocked: boolean;
}

/**
 * Inspects existing V1 save WITHOUT mutating or deleting starline_save_v1 (§15 & AC18).
 */
export function inspectV1SaveForMigration(storage: V2StorageLike): V1MigrationInspection {
  const raw = storage.getItem(V1_PRIMARY_SAVE_KEY);
  if (!raw) {
    return {
      hasV1Save: false,
      v1Valid: false,
      baseCredits: 0,
      activeRunPreview: null,
      relicsSummary: { stored: 0, restored: 0 },
      legacyAbyssalUnlocked: false,
    };
  }

  const loaded = loadV1SaveData(storage);
  if (loaded.status === 'corrupt_no_backup') {
    return {
      hasV1Save: true,
      v1Valid: false,
      v1Error: loaded.error,
      baseCredits: 0,
      activeRunPreview: null,
      relicsSummary: { stored: 0, restored: 0 },
      legacyAbyssalUnlocked: false,
    };
  }

  const v1 = loaded.status === 'corrupt_with_backup' ? loaded.backup : loaded.data;
  const prog = v1.progression;

  let stored = 0;
  let restored = 0;
  for (const rid of V2_RELIC_ORDER) {
    const st = prog.relics[rid];
    if (st) {
      stored += st.storedCount;
      if (st.restored) restored += 1;
    }
  }

  let activeRunPreview: V1ActiveRunMigrationPreview | null = null;
  if (v1.activeExpedition) {
    const exp = v1.activeExpedition;
    if (exp.phase === 'COMBAT' && exp.activeCombat) {
      // §15: Evaluate active V1 combat using its saved deterministic V1 snapshot!
      const sim = exp.activeCombat.simulation;
      if (sim.outcome === 'victory') {
        const settledExp = {
          ...exp,
          phase: 'SETTLEMENT' as const,
          settlementReason: 'safe_return' as const,
          currentHp: sim.finalPlayerHp,
          accumulatedBounty: exp.accumulatedBounty + exp.activeCombat.routeSpec.bounty,
        };
        const sum = calculateV1Settlement(settledExp, prog, []);
        activeRunPreview = {
          expeditionId: exp.expeditionId,
          phase: exp.phase,
          currentNode: exp.currentNode,
          maxNodes: exp.maxNodes,
          resolvedAs: 'safe_return',
          estimatedCredits: sum.finalCreditsEarned,
          summaryText: `第 ${exp.currentNode}/${exp.maxNodes} 站战斗按旧规则可获胜（不补发未选奖励），预计折算 +${sum.finalCreditsEarned}¤`,
        };
      } else {
        const settledExp = {
          ...exp,
          phase: 'SETTLEMENT' as const,
          settlementReason: 'defeat' as const,
          currentHp: 0,
        };
        const sum = calculateV1Settlement(settledExp, prog, []);
        activeRunPreview = {
          expeditionId: exp.expeditionId,
          phase: exp.phase,
          currentNode: exp.currentNode,
          maxNodes: exp.maxNodes,
          resolvedAs: 'defeat',
          estimatedCredits: sum.finalCreditsEarned,
          summaryText: `第 ${exp.currentNode}/${exp.maxNodes} 站战斗按旧规则判败，按旧 40% 公式折算 +${sum.finalCreditsEarned}¤`,
        };
      }
    } else {
      const reason = exp.settlementReason === 'defeat' ? 'defeat' : 'safe_return';
      const settledExp = {
        ...exp,
        phase: 'SETTLEMENT' as const,
        settlementReason: reason as 'safe_return' | 'defeat',
      };
      const sum = calculateV1Settlement(settledExp, prog, []);
      activeRunPreview = {
        expeditionId: exp.expeditionId,
        phase: exp.phase,
        currentNode: exp.currentNode,
        maxNodes: exp.maxNodes,
        resolvedAs: reason,
        estimatedCredits: sum.finalCreditsEarned,
        summaryText: `第 ${exp.currentNode}/${exp.maxNodes} 站稳定局面按旧规则${
          reason === 'defeat' ? '战败 40% 折算' : '安全返航结算'
        }，预计 +${sum.finalCreditsEarned}¤`,
      };
    }
  }

  return {
    hasV1Save: true,
    v1Valid: true,
    v1Save: v1,
    baseCredits: prog.credits,
    activeRunPreview,
    relicsSummary: { stored, restored },
    legacyAbyssalUnlocked:
      Boolean(prog.buildings.workbench) || prog.deepestNodeReached >= 3,
  };
}

/**
 * Computes deterministic one-time migrationId for a V1 snapshot so repeating migration NEVER double-credits (§15 & AC18).
 */
export function computeV1MigrationId(v1: V1SaveData): string {
  const expId = v1.activeExpedition?.expeditionId ?? 'base';
  return `mig_v1_${v1.progression.totalExpeditions}_${v1.progression.credits}_${expId}`;
}

/**
 * Migrates a validated V1 save into a clean V2SaveData (§15 & ADR-01/ADR-02):
 * - Preserves credits (+ optional settled old V1 run credits)
 * - Preserves workbench, display, drydock (drydock unlocks Shield Cruiser!)
 * - Free-enables Contract Hub & 4 core common blueprints (NEVER mints free owned equipment instances!)
 * - Preserves ALL 4 V1 relics (ancient_navigator, quantum_core, cryo_amber, obsidian_crown)
 * - Maps discovered item IDs cleanly (improved laser stays a discovery marker only, no free items!)
 * - NEVER mutates or deletes starline_save_v1 or starline_save_backup_v1!
 */
export function migrateV1ToV2SaveData(
  v1: V1SaveData,
  existingV2?: V2SaveData | null
): V2SaveData {
  const migrationId = computeV1MigrationId(v1);
  // Idempotent guard: already migrated this exact V1 snapshot -> return existing V2 untouched!
  if (existingV2 && existingV2.profile.migrationRecord?.migrationId === migrationId) {
    return existingV2;
  }

  const prog = v1.progression;

  // Resolve active V1 expedition (if any) using V1 rules only
  let settledOldRunCredits = 0;
  if (v1.activeExpedition) {
    const exp = v1.activeExpedition;
    if (exp.phase === 'COMBAT' && exp.activeCombat) {
      const sim = exp.activeCombat.simulation;
      const settledExp =
        sim.outcome === 'victory'
          ? {
              ...exp,
              phase: 'SETTLEMENT' as const,
              settlementReason: 'safe_return' as const,
              currentHp: sim.finalPlayerHp,
              accumulatedBounty: exp.accumulatedBounty + exp.activeCombat.routeSpec.bounty,
            }
          : {
              ...exp,
              phase: 'SETTLEMENT' as const,
              settlementReason: 'defeat' as const,
              currentHp: 0,
            };
      settledOldRunCredits = calculateV1Settlement(settledExp, prog, []).finalCreditsEarned;
    } else {
      const reason = exp.settlementReason === 'defeat' ? 'defeat' : 'safe_return';
      settledOldRunCredits = calculateV1Settlement(
        { ...exp, phase: 'SETTLEMENT', settlementReason: reason },
        prog,
        []
      ).finalCreditsEarned;
    }
  }

  const baseProfile = createFreshV2Profile();

  // Preserve ALL 4 relics cleanly (ADR-02)
  const relics: Record<string, RelicProgress> = { ...createInitialV2Relics() };
  let preservedV1Relics = 0;
  for (const rid of V2_RELIC_ORDER) {
    const oldSt = prog.relics[rid];
    if (oldSt) {
      relics[rid] = {
        storedCount: Math.max(0, oldSt.storedCount),
        restored: Boolean(oldSt.restored),
      };
      if (oldSt.restored || oldSt.storedCount > 0) preservedV1Relics += 1;
    }
  }

  // Map V1 discovered item IDs -> V2 item IDs (discovery markers ONLY; never mints free owned items!)
  const v1ToV2IdMap: Record<string, string> = {
    'equipment.drone.common': 'equipment.repair.common',
    'equipment.drone.improved': 'equipment.repair.improved',
  };
  const discoveredSet = new Set<string>();
  for (const rawId of prog.discoveredItems) {
    const mapped = v1ToV2IdMap[rawId] ?? rawId;
    if (getAnyV2ItemDef(mapped)) {
      discoveredSet.add(mapped);
    }
  }

  const unlockedShips: V2ProfileState['unlockedShips'] = prog.buildings.drydock
    ? ['cannon_skiff', 'shield_cruiser']
    : ['cannon_skiff'];

  const legacyAbyssalUnlocked =
    Boolean(prog.buildings.workbench) || prog.deepestNodeReached >= 3;

  const migrationRecord: V2MigrationRecord = {
    migrationId,
    migratedAt: new Date().toISOString(),
    sourceVersion: v1.schemaVersion,
    settledOldRunCredits,
    preservedV1Relics,
    legacyAbyssalUnlocked,
  };

  const migratedBuildings = {
    ...baseProfile.buildings,
    workbench: Boolean(prog.buildings.workbench) || prog.tutorialCompleted,
    contract_hub: true, // §15: First V1 migration enables Contract Hub for free!
    drydock: Boolean(prog.buildings.drydock),
    drydock_tier2: false,
    research_lab: Boolean(prog.buildings.display), // If V1 already had display, enable research_lab so display remains coherent
    display: Boolean(prog.buildings.display),
  };
  const migratedCredits = prog.credits + settledOldRunCredits;
  const migratedDeepest = Math.min(6, Math.max(0, prog.deepestNodeReached));
  const migratedTutorialCompleted = Boolean(
    prog.tutorialCompleted || prog.buildings.workbench || prog.totalExpeditions > 0
  );

  const migratedProfile: V2ProfileState = {
    ...baseProfile,
    credits: migratedCredits,
    buildings: migratedBuildings,
    unlockedShips,
    unlockedCrew: ['engineer'],
    unlockedFamilies: ['core'],
    blueprints: [...V2_INITIAL_BLUEPRINTS],
    equipmentWarehouse: [], // §15: Never grant nonexistent owned instances from V1 discovery!
    pendingGiftQueue: [],
    relics,
    discoveredItems: Array.from(discoveredSet),
    seenItems: Array.from(discoveredSet),
    deepestLayerReached: migratedDeepest,
    totalRuns: prog.totalExpeditions,
    tutorialCompleted: migratedTutorialCompleted,
    tutorialBonusClaimed: Boolean(prog.tutorialCompleted),
    settledRunIds: v1.activeExpedition ? [v1.activeExpedition.expeditionId] : [],
    selectedShipId:
      prog.selectedLoadout === 'shield_cruiser' && prog.buildings.drydock
        ? 'shield_cruiser'
        : 'cannon_skiff',
    selectedCrewId: 'engineer',
    selectedArchetype: 'laser',
    migrationRecord,
    facilityTiers: createInitialV3FacilityTiers(migratedBuildings),
    campaign: inferV3CampaignFromV2Profile({
      tutorialCompleted: migratedTutorialCompleted,
      totalRuns: prog.totalExpeditions,
      buildings: migratedBuildings,
      completedContractTypes: [],
      deepestLayerReached: migratedDeepest,
      relics,
    }),
    career: inferV3CareerFromV2Profile({
      totalRuns: prog.totalExpeditions,
      completedContractIds: [],
      credits: migratedCredits,
    }),
  };

  return {
    schemaVersion: V2_SCHEMA_VERSION,
    rulesVersion: V2_RULES_VERSION,
    savedAt: new Date().toISOString(),
    profile: migratedProfile,
    activeRun: null,
    settings: { ...v1.settings },
  };
}
