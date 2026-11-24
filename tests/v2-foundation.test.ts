import { describe, expect, it } from 'vitest';
import { soundEngine } from '../src/audio/soundEngine';
import { createFreshSaveData } from '../src/domain/persistence';
import { V2_CARGO_DEFS } from '../src/v2/data/cargo';
import { V2_EQUIPMENT_DEFS, type V2EquipmentKind } from '../src/v2/data/equipment';
import { V3_GADGET_DEFS } from '../src/v2/data/gadgets';
import { createV2ShowcaseRun } from '../src/v2/data/showcaseRun';
import {
  completeV2CombatAtCurrentNode,
  startV2CombatAtCurrentNode,
} from '../src/v2/domain/combatV2';
import { getAvailableContractBoard, getDeepTierLockReason } from '../src/v2/domain/contracts';
import {
  applyV2EngineerSwap,
  buyV2MerchantOffer,
  generateV2CombatRewardBundle,
  resolveV2WreckChoice,
  selectV2MapNode,
} from '../src/v2/domain/encounter';
import { discardV2Item, undoV2LastDiscard } from '../src/v2/domain/inventoryV2';
import {
  collectVisibleV2DefIdsForRun,
  createV2CargoInstance,
  createV2EquipmentInstance,
  getAnyV2ItemDef,
  recordV2SeenItems,
} from '../src/v2/domain/itemCatalog';
import {
  buildFreeFallbackPrepareSlots,
  launchV2Expedition,
  saveV2LoadoutPreset,
} from '../src/v2/domain/loadout';
import { migrateV1ToV2SaveData } from '../src/v2/domain/migration';
import {
  V3_MAX_RUN_HISTORY,
  clearV2SaveData,
  createFreshV2Profile,
  createFreshV2SaveData,
  loadV2SaveData,
  migrateV2ToV3SaveData,
  normalizeV2SaveData,
  persistV2SaveData,
  validateLegacyV2SaveDataDetailed,
  validateV2SaveDataDetailed,
  type V2StorageLike,
} from '../src/v2/domain/persistenceV2';
import {
  MAX_UINT32,
  deriveSessionRunSeed,
  parseDeterministicSeedParam,
} from '../src/v2/domain/seedParam';
import { applyV2Settlement, calculateV2Settlement } from '../src/v2/domain/settlementV2';
import {
  V2_BACKUP_KEY,
  V2_LEGACY_RULES_VERSION,
  V2_LEGACY_SCHEMA_VERSION,
  V2_RULES_VERSION,
  V2_SAVE_KEY,
  V2_SCHEMA_VERSION,
  V3_BACKUP_KEY,
  type V2RunState,
} from '../src/v2/domain/types';
import { buildV2InspectSnapshot } from '../src/v2/ui/inspectSnapshot';
import { resolveV2BgmTrack } from '../src/v2/ui/v2AudioTrack';

class MemoryStorage implements V2StorageLike {
  private readonly map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

function makeLegacyV2SaveObject(overrides?: {
  credits?: number;
  tutorialCompleted?: boolean;
  totalRuns?: number;
  deepestLayerReached?: number;
  completedContractTypes?: ('transport' | 'rescue' | 'survey')[];
  completedContractIds?: string[];
  buildings?: Partial<Record<string, boolean>>;
  restoredRelics?: string[];
  withActiveRun?: boolean;
}): Record<string, unknown> {
  const base = createFreshV2SaveData();
  const profileClone: Record<string, unknown> = {
    ...base.profile,
    credits: overrides?.credits ?? 240,
    tutorialCompleted: overrides?.tutorialCompleted ?? true,
    totalRuns: overrides?.totalRuns ?? 3,
    deepestLayerReached: overrides?.deepestLayerReached ?? 4,
    completedContractTypes: overrides?.completedContractTypes ?? ['transport'],
    completedContractIds: overrides?.completedContractIds ?? ['transport_std'],
    buildings: {
      ...base.profile.buildings,
      workbench: true,
      contract_hub: true,
      ...(overrides?.buildings ?? {}),
    },
    relics: { ...base.profile.relics },
  };
  if (overrides?.restoredRelics) {
    const relics = profileClone.relics as Record<string, { storedCount: number; restored: boolean }>;
    for (const rid of overrides.restoredRelics) {
      relics[rid] = { storedCount: 0, restored: true };
    }
  }
  // Strip all V3-only fields to simulate an authentic legacy V2 payload
  delete profileClone.salvageParts;
  delete profileClone.facilityTiers;
  delete profileClone.campaign;
  delete profileClone.factionRep;
  delete profileClone.crewMastery;
  delete profileClone.achievementsUnlocked;
  delete profileClone.defeatedEnemyKinds;
  delete profileClone.runHistory;
  delete profileClone.career;

  let legacyRun: Record<string, unknown> | null = null;
  if (overrides?.withActiveRun) {
    const launched = launchV2Expedition({
      profile: base.profile,
      contractTemplateId: 'transport_std',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: buildFreeFallbackPrepareSlots('cannon_skiff', base.profile.blueprints),
      seed: 12345,
    });
    const runObj: Record<string, unknown> = {
      ...launched.run!,
      schemaVersion: V2_LEGACY_SCHEMA_VERSION,
      rulesVersion: V2_LEGACY_RULES_VERSION,
    };
    delete runObj.sectorId;
    delete runObj.endlessThreat;
    delete runObj.endlessMutatorIds;
    delete runObj.recentEquipmentKinds;
    delete runObj.usedEventIds;
    delete runObj.bonusObjective;
    delete runObj.tacticalChargesMax;
    delete runObj.tacticalChargesUsed;
    delete runObj.salvagePartsEarned;
    delete runObj.isFinalCampaignRun;
    legacyRun = runObj;
  }

  return {
    schemaVersion: V2_LEGACY_SCHEMA_VERSION,
    rulesVersion: V2_LEGACY_RULES_VERSION,
    savedAt: '2026-11-20T12:00:00.000Z',
    profile: profileClone,
    activeRun: legacyRun,
    settings: base.settings,
  };
}

describe('M1 Foundation: F02 Save Schema V3 & Non-Destructive V2->V3 Migration', () => {
  it('upgrades a valid legacy V2 save (with activeRun) to V3 while preserving backup and inferring Campaign Act', () => {
    const legacyV2 = makeLegacyV2SaveObject({
      credits: 410,
      tutorialCompleted: true,
      totalRuns: 5,
      deepestLayerReached: 5,
      completedContractTypes: ['transport', 'rescue'],
      completedContractIds: ['transport_std', 'rescue_std'],
      buildings: { research_lab: true, drydock: true },
      withActiveRun: true,
    });

    expect(validateLegacyV2SaveDataDetailed(legacyV2).ok).toBe(true);
    expect(validateV2SaveDataDetailed(legacyV2).ok).toBe(false);

    const store = new MemoryStorage();
    const rawLegacy = JSON.stringify(legacyV2);
    store.setItem(V2_SAVE_KEY, rawLegacy);

    const loaded = loadV2SaveData(store);
    expect(loaded.status).toBe('loaded');
    if (loaded.status === 'loaded') {
      expect(loaded.migratedFromV2).toBe(true);
      expect(loaded.data.schemaVersion).toBe(V2_SCHEMA_VERSION);
      expect(loaded.data.rulesVersion).toBe(V2_RULES_VERSION);
      expect(loaded.data.profile.credits).toBe(410);
      expect(loaded.data.profile.buildings.research_lab).toBe(true);
      expect(loaded.data.profile.facilityTiers.research_lab).toBe(1);
      expect(loaded.data.profile.facilityTiers.stargate_relay).toBe(0);
      expect(loaded.data.profile.campaign.currentAct).toBe('act2');
      expect(loaded.data.profile.campaign.unlockedSectors).toEqual([
        'near_orbit',
        'frozen_graveyard',
      ]);
      expect(loaded.data.profile.salvageParts).toBe(0);
      expect(loaded.data.profile.career.totalWins).toBe(2);
      expect(loaded.data.activeRun).not.toBeNull();
      expect(loaded.data.activeRun?.schemaVersion).toBe(V2_SCHEMA_VERSION);
      expect(loaded.data.activeRun?.sectorId).toBe('near_orbit');
      expect(loaded.data.activeRun?.recentEquipmentKinds).toEqual([]);
      // Original V2 raw string preserved under starline_save_backup_v2
      expect(store.getItem(V2_BACKUP_KEY)).toBe(rawLegacy);
    }
  });

  it('infers prologue, act1, act2, and act3 accurately from V2 progress', () => {
    const prologue = migrateV2ToV3SaveData(
      makeLegacyV2SaveObject({
        tutorialCompleted: false,
        totalRuns: 0,
        completedContractTypes: [],
        completedContractIds: [],
        deepestLayerReached: 0,
        buildings: { workbench: false, contract_hub: false },
      })
    );
    expect(prologue.ok).toBe(true);
    expect(prologue.data?.profile.campaign.currentAct).toBe('prologue');
    expect(prologue.data?.profile.campaign.unlockedSectors).toEqual(['near_orbit']);

    const act1 = migrateV2ToV3SaveData(
      makeLegacyV2SaveObject({
        tutorialCompleted: true,
        totalRuns: 2,
        completedContractTypes: ['transport'],
        deepestLayerReached: 3,
      })
    );
    expect(act1.ok).toBe(true);
    expect(act1.data?.profile.campaign.currentAct).toBe('act1');

    const act3 = migrateV2ToV3SaveData(
      makeLegacyV2SaveObject({
        tutorialCompleted: true,
        totalRuns: 8,
        completedContractTypes: ['transport', 'rescue', 'survey'],
        deepestLayerReached: 6,
        buildings: { drydock: true, drydock_tier2: true },
        restoredRelics: ['ancient_navigator', 'cryo_amber'],
      })
    );
    expect(act3.ok).toBe(true);
    expect(act3.data?.profile.campaign.currentAct).toBe('act3');
    expect(act3.data?.profile.campaign.unlockedSectors).toEqual([
      'near_orbit',
      'frozen_graveyard',
      'stargate_abyss',
    ]);
    expect(act3.data?.profile.facilityTiers.drydock).toBe(2);
  });

  it('does NOT overwrite an existing valid backup during V2->V3 migration and recovers from V2 backup when primary is corrupt', () => {
    const store = new MemoryStorage();
    const olderV2Backup = JSON.stringify(makeLegacyV2SaveObject({ credits: 111 }));
    const newerV2Primary = JSON.stringify(makeLegacyV2SaveObject({ credits: 222 }));
    store.setItem(V2_BACKUP_KEY, olderV2Backup);
    store.setItem(V2_SAVE_KEY, newerV2Primary);

    const loaded = loadV2SaveData(store);
    expect(loaded.status).toBe('loaded');
    // Pre-existing valid backup must NOT be overwritten
    expect(store.getItem(V2_BACKUP_KEY)).toBe(olderV2Backup);

    // Corrupt primary -> recovers from legacy V2 backup cleanly upgraded to V3
    store.setItem(V2_SAVE_KEY, '{corrupt json!!!');
    const recovered = loadV2SaveData(store);
    expect(recovered.status).toBe('corrupt_with_backup');
    if (recovered.status === 'corrupt_with_backup') {
      expect(recovered.backup.schemaVersion).toBe(V2_SCHEMA_VERSION);
      expect(recovered.backup.profile.credits).toBe(111);
    }
  });

  it('persistV2SaveData rotates a valid legacy V2 primary into backup and V1->V3 migration derives coherent V3 fields', () => {
    const store = new MemoryStorage();
    const legacyV2Raw = JSON.stringify(makeLegacyV2SaveObject({ credits: 333 }));
    store.setItem(V2_SAVE_KEY, legacyV2Raw);

    const freshV3 = createFreshV2SaveData();
    expect(persistV2SaveData(store, freshV3).ok).toBe(true);
    expect(store.getItem(V2_BACKUP_KEY)).toBe(legacyV2Raw);

    const v1 = createFreshSaveData();
    const v1Veteran = {
      ...v1,
      progression: {
        ...v1.progression,
        credits: 300,
        tutorialCompleted: true,
        deepestNodeReached: 4,
        totalExpeditions: 4,
        buildings: { workbench: true, display: true, drydock: true },
      },
    };
    const migratedFromV1 = migrateV1ToV2SaveData(v1Veteran);
    expect(migratedFromV1.schemaVersion).toBe(V2_SCHEMA_VERSION);
    expect(migratedFromV1.profile.facilityTiers.workbench).toBe(1);
    expect(migratedFromV1.profile.facilityTiers.drydock).toBe(1);
    expect(migratedFromV1.profile.campaign.currentAct).toBe('act2');
  });

  it('caps runHistory at V3_MAX_RUN_HISTORY (30) across repeated settlements', () => {
    let profile = createFreshV2Profile();
    for (let i = 0; i < 35; i++) {
      const launched = launchV2Expedition({
        profile,
        contractTemplateId: 'free_salvage',
        shipId: 'cannon_skiff',
        crewId: 'engineer',
        primaryArchetype: 'laser',
        slots: buildFreeFallbackPrepareSlots('cannon_skiff', profile.blueprints),
        seed: 7000 + i,
      });
      const settlingRun: V2RunState = {
        ...launched.run!,
        phase: 'SETTLEMENT',
        settlementReason: 'safe_return',
        wallet: 10,
      };
      const res = applyV2Settlement(profile, settlingRun);
      expect(res.ok).toBe(true);
      profile = res.profile;
    }
    expect(profile.runHistory.length).toBe(V3_MAX_RUN_HISTORY);
    expect(profile.career.totalSafeReturns).toBe(35);
    expect(profile.career.totalCreditsEarned).toBeGreaterThanOrEqual(350);
  });

  it('preserves starline_save_backup_v2 permanently across 3+ subsequent V3 saves, rotates V3 backups to V3_BACKUP_KEY, and recovers from V3_BACKUP_KEY or V2_BACKUP_KEY (V2 or V3)', () => {
    const store = new MemoryStorage();
    const originalV2Raw = JSON.stringify(makeLegacyV2SaveObject({ credits: 450 }));
    store.setItem(V2_SAVE_KEY, originalV2Raw);

    // Boot load migrates V2 -> V3 and backs up V2 into V2_BACKUP_KEY
    const loaded = loadV2SaveData(store);
    expect(loaded.status).toBe('loaded');
    if (loaded.status !== 'loaded') return;
    expect(loaded.migratedFromV2).toBe(true);
    expect(store.getItem(V2_BACKUP_KEY)).toBe(originalV2Raw);

    // Persist 4 subsequent V3 saves (save #1 upgrades primary from V2 -> V3; saves #2..#4 rotate V3 -> V3_BACKUP_KEY)
    const save1 = { ...loaded.data, profile: { ...loaded.data.profile, credits: 500 } };
    const save2 = { ...loaded.data, profile: { ...loaded.data.profile, credits: 600 } };
    const save3 = { ...loaded.data, profile: { ...loaded.data.profile, credits: 700 } };
    const save4 = { ...loaded.data, profile: { ...loaded.data.profile, credits: 800 } };
    expect(persistV2SaveData(store, save1).ok).toBe(true);
    expect(persistV2SaveData(store, save2).ok).toBe(true);
    expect(persistV2SaveData(store, save3).ok).toBe(true);
    expect(persistV2SaveData(store, save4).ok).toBe(true);

    // Original V2 backup MUST remain 100% untouched after 4 subsequent V3 saves
    expect(store.getItem(V2_BACKUP_KEY)).toBe(originalV2Raw);
    expect(JSON.parse(store.getItem(V2_BACKUP_KEY)!).schemaVersion).toBe(V2_LEGACY_SCHEMA_VERSION);
    // Rolling V3 backup holds save3 (700 credits), primary holds save4 (800 credits)
    expect(JSON.parse(store.getItem(V3_BACKUP_KEY)!).profile.credits).toBe(700);
    expect(JSON.parse(store.getItem(V2_SAVE_KEY)!).profile.credits).toBe(800);

    // Corrupt primary -> recovers from V3_BACKUP_KEY FIRST (700 credits)
    store.setItem(V2_SAVE_KEY, '{corrupt');
    const recFromV3 = loadV2SaveData(store);
    expect(recFromV3.status).toBe('corrupt_with_backup');
    if (recFromV3.status === 'corrupt_with_backup') {
      expect(recFromV3.backup.profile.credits).toBe(700);
    }

    // Corrupt V3_BACKUP_KEY too -> falls back to V2_BACKUP_KEY (450 credits, migrated to V3) without overwriting V2_BACKUP_KEY
    store.setItem(V3_BACKUP_KEY, 'not-json');
    const recFromV2 = loadV2SaveData(store);
    expect(recFromV2.status).toBe('corrupt_with_backup');
    if (recFromV2.status === 'corrupt_with_backup') {
      expect(recFromV2.backup.schemaVersion).toBe(V2_SCHEMA_VERSION);
      expect(recFromV2.backup.profile.credits).toBe(450);
    }
    expect(store.getItem(V2_BACKUP_KEY)).toBe(originalV2Raw);

    // Cross-track E2E compatibility: corrupt primary + valid V3 payload seeded directly in starline_save_backup_v2 recovers cleanly
    const compatStore = new MemoryStorage();
    const seededV3Backup = {
      ...createFreshV2SaveData(),
      profile: { ...createFreshV2Profile(), credits: 654, salvageParts: 19 },
    };
    compatStore.setItem(V2_SAVE_KEY, '{corrupt-primary');
    compatStore.setItem(V2_BACKUP_KEY, JSON.stringify(seededV3Backup));
    const recCompat = loadV2SaveData(compatStore);
    expect(recCompat.status).toBe('corrupt_with_backup');
    if (recCompat.status === 'corrupt_with_backup') {
      expect(recCompat.backup.schemaVersion).toBe(V2_SCHEMA_VERSION);
      expect(recCompat.backup.profile.credits).toBe(654);
      expect(recCompat.backup.profile.salvageParts).toBe(19);
    }

    // Pre-existing older V2 backup is NEVER overwritten on 1st persistV2SaveData either
    const olderStore = new MemoryStorage();
    const olderV2 = JSON.stringify(makeLegacyV2SaveObject({ credits: 111 }));
    const newerV2 = JSON.stringify(makeLegacyV2SaveObject({ credits: 222 }));
    olderStore.setItem(V2_BACKUP_KEY, olderV2);
    olderStore.setItem(V2_SAVE_KEY, newerV2);
    expect(persistV2SaveData(olderStore, save1).ok).toBe(true);
    expect(olderStore.getItem(V2_BACKUP_KEY)).toBe(olderV2);

    // clearV2SaveData cleans primary, V2 backup, and V3 backup
    clearV2SaveData(store);
    expect(store.getItem(V2_SAVE_KEY)).toBeNull();
    expect(store.getItem(V2_BACKUP_KEY)).toBeNull();
    expect(store.getItem(V3_BACKUP_KEY)).toBeNull();
  });

  it('rejects negative/NaN/out-of-range V3 numeric fields and bogus endings, normalizes them cleanly, and auto-normalizes on persist', () => {
    const base = createFreshV2SaveData();
    const launched = launchV2Expedition({
      profile: base.profile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: buildFreeFallbackPrepareSlots('cannon_skiff', base.profile.blueprints),
      seed: 9001,
    });

    // Validation rejects every adversarial V3 numeric/ending payload
    expect(
      validateV2SaveDataDetailed({
        ...base,
        profile: {
          ...base.profile,
          campaign: { ...base.profile.campaign, maxEndlessThreat: -8 },
        },
      }).ok
    ).toBe(false);
    expect(
      validateV2SaveDataDetailed({
        ...base,
        profile: {
          ...base.profile,
          campaign: { ...base.profile.campaign, maxEndlessThreat: 99 },
        },
      }).ok
    ).toBe(false);
    expect(
      validateV2SaveDataDetailed({
        ...base,
        profile: {
          ...base.profile,
          campaign: { ...base.profile.campaign, maxEndlessThreat: Number.NaN },
        },
      }).ok
    ).toBe(false);
    expect(
      validateV2SaveDataDetailed({
        ...base,
        profile: {
          ...base.profile,
          campaign: { ...base.profile.campaign, endingsUnlocked: ['bogus_ending'] as never },
        },
      }).ok
    ).toBe(false);
    expect(
      validateV2SaveDataDetailed({
        ...base,
        profile: {
          ...base.profile,
          facilityTiers: { ...base.profile.facilityTiers, stargate_relay: -2 },
        },
      }).ok
    ).toBe(false);
    expect(
      validateV2SaveDataDetailed({
        ...base,
        profile: {
          ...base.profile,
          facilityTiers: { ...base.profile.facilityTiers, drydock: 99 },
        },
      }).ok
    ).toBe(false);
    expect(
      validateV2SaveDataDetailed({
        ...base,
        profile: {
          ...base.profile,
          facilityTiers: { ...base.profile.facilityTiers, workbench: Number.NaN },
        },
      }).ok
    ).toBe(false);
    expect(
      validateV2SaveDataDetailed({
        ...base,
        profile: {
          ...base.profile,
          career: { ...base.profile.career, totalDefeats: -3 },
        },
      }).ok
    ).toBe(false);
    expect(
      validateV2SaveDataDetailed({
        ...base,
        profile: {
          ...base.profile,
          career: { ...base.profile.career, totalCreditsEarned: Number.NaN },
        },
      }).ok
    ).toBe(false);
    expect(
      validateV2SaveDataDetailed({
        ...base,
        activeRun: { ...launched.run!, endlessThreat: -7 },
      }).ok
    ).toBe(false);
    expect(
      validateV2SaveDataDetailed({
        ...base,
        activeRun: { ...launched.run!, endlessThreat: 12 },
      }).ok
    ).toBe(false);

    // normalizeV2SaveData clamps and sanitizes all V3 numeric/ending fields cleanly
    const dirty = {
      ...base,
      profile: {
        ...base.profile,
        facilityTiers: {
          ...base.profile.facilityTiers,
          workbench: -3,
          drydock: 99,
          stargate_relay: Number.NaN,
        },
        campaign: {
          ...base.profile.campaign,
          maxEndlessThreat: 99,
          endingsUnlocked: ['stargate_reignited', 'bogus_ending', 'stargate_reignited'] as never,
        },
        career: {
          totalWins: -4,
          totalDefeats: Number.NaN,
          totalSafeReturns: 5.9,
          totalCreditsEarned: Number.POSITIVE_INFINITY,
          totalSalvagePartsEarned: -1,
          totalBossesDefeated: 2,
          totalWrecksDissected: -9,
          totalItemsDismantled: Number.NaN,
          deepestEndlessCleared: -2,
        },
      },
      activeRun: { ...launched.run!, endlessThreat: -7 },
    };
    const normalized = normalizeV2SaveData(dirty);
    expect(normalized.profile.facilityTiers.workbench).toBe(0);
    expect(normalized.profile.facilityTiers.drydock).toBe(3);
    expect(normalized.profile.facilityTiers.stargate_relay).toBe(0);
    expect(normalized.profile.campaign.maxEndlessThreat).toBe(10);
    expect(normalized.profile.campaign.endingsUnlocked).toEqual(['stargate_reignited']);
    expect(normalized.profile.career).toEqual({
      totalWins: 0,
      totalDefeats: 0,
      totalSafeReturns: 5,
      totalCreditsEarned: 0,
      totalSalvagePartsEarned: 0,
      totalBossesDefeated: 2,
      totalWrecksDissected: 0,
      totalItemsDismantled: 0,
      deepestEndlessCleared: 0,
    });
    expect(normalized.activeRun?.endlessThreat).toBe(0);
    expect(validateV2SaveDataDetailed(normalized).ok).toBe(true);

    // persistV2SaveData normalizes dirty runHistory (>30) and unsynced seenItems before writing
    const store = new MemoryStorage();
    const oversizedHistory = Array.from({ length: 45 }, (_, idx) => ({
      runId: `run_${idx}`,
      finishedAt: '2026-11-23T00:00:00.000Z',
      sectorId: 'near_orbit' as const,
      contractTemplateId: 'free_salvage',
      contractName: '自由打捞',
      shipId: 'cannon_skiff' as const,
      crewId: 'engineer' as const,
      outcome: 'safe_return' as const,
      contractCompleted: true,
      maxLayerReached: 4,
      creditsEarned: 100,
      salvagePartsEarned: 0,
      endlessThreat: 0,
    }));
    const unsyncedSave = {
      ...base,
      profile: {
        ...base.profile,
        discoveredItems: ['equipment.laser.common', 'cargo.alloy_bar'],
        seenItems: [],
        runHistory: oversizedHistory,
      },
    };
    expect(persistV2SaveData(store, unsyncedSave).ok).toBe(true);
    const persisted = JSON.parse(store.getItem(V2_SAVE_KEY)!);
    expect(persisted.profile.runHistory.length).toBe(V3_MAX_RUN_HISTORY);
    expect(persisted.profile.seenItems).toContain('equipment.laser.common');
    expect(persisted.profile.seenItems).toContain('cargo.alloy_bar');
  });

  it('prevents NaN corruption in profile.relics storedCount across V2 migration, V3 validation, and direct normalization', () => {
    const base = createFreshV2SaveData();

    // V3 saves with missing, string, negative, float, null, or NaN storedCount MUST be rejected
    const invalidV3RelicCases: unknown[] = [
      { ancient_navigator: { restored: true } },
      { ancient_navigator: { storedCount: 'oops', restored: true } },
      { ancient_navigator: { storedCount: -1, restored: false } },
      { ancient_navigator: { storedCount: 1.7, restored: false } },
      { ancient_navigator: { storedCount: null, restored: false } },
      { ancient_navigator: { storedCount: Number.NaN, restored: false } },
      { ancient_navigator: { storedCount: 1, restored: 'yes' } },
      { ancient_navigator: null },
      null,
      [],
    ];
    for (const badRelics of invalidV3RelicCases) {
      const candidate = {
        ...base,
        profile: { ...base.profile, relics: badRelics as never },
      };
      expect(validateV2SaveDataDetailed(candidate).ok).toBe(false);

      const store = new MemoryStorage();
      store.setItem(V2_SAVE_KEY, JSON.stringify(candidate));
      const loaded = loadV2SaveData(store);
      expect(loaded.status).toBe('corrupt_no_backup');

      // Direct normalization must ALSO sanitize without ever yielding NaN
      const normalized = normalizeV2SaveData(candidate);
      for (const st of Object.values(normalized.profile.relics)) {
        expect(Number.isInteger(st.storedCount)).toBe(true);
        expect(st.storedCount).toBeGreaterThanOrEqual(0);
        expect(typeof st.restored).toBe('boolean');
      }
    }

    // Legacy V2 save with omitted storedCount in a relic entry migrates cleanly to storedCount: 0 (never NaN)
    const legacyMissingStoredCount = makeLegacyV2SaveObject();
    (legacyMissingStoredCount.profile as Record<string, unknown>).relics = {
      ancient_navigator: { restored: true },
    };
    const storeV2 = new MemoryStorage();
    storeV2.setItem(V2_SAVE_KEY, JSON.stringify(legacyMissingStoredCount));
    const loadedV2 = loadV2SaveData(storeV2);
    expect(loadedV2.status).toBe('loaded');
    if (loadedV2.status === 'loaded') {
      expect(loadedV2.migratedFromV2).toBe(true);
      expect(loadedV2.data.profile.relics.ancient_navigator).toEqual({
        storedCount: 0,
        restored: true,
      });
      expect(Number.isNaN(loadedV2.data.profile.relics.ancient_navigator.storedCount)).toBe(false);
    }

    // Legacy V2 save with non-integer/string/negative storedCount or null relics entry MUST be rejected
    for (const badLegacyRelics of [
      { ancient_navigator: { storedCount: 'oops', restored: true } },
      { ancient_navigator: { storedCount: -2, restored: false } },
      { ancient_navigator: { storedCount: 2.5, restored: false } },
      { ancient_navigator: null },
      null,
    ]) {
      const badLegacy = makeLegacyV2SaveObject();
      (badLegacy.profile as Record<string, unknown>).relics = badLegacyRelics;
      expect(validateLegacyV2SaveDataDetailed(badLegacy).ok).toBe(false);
      expect(migrateV2ToV3SaveData(badLegacy).ok).toBe(false);
    }
  });

  it('rejects null/malformed profile, campaign, factionRep, crewMastery, settings, and activeRun fields while keeping partial legacy V2 saves migratable', () => {
    const base = createFreshV2SaveData();
    const launched = launchV2Expedition({
      profile: base.profile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: buildFreeFallbackPrepareSlots('cannon_skiff', base.profile.blueprints),
      seed: 0,
    });
    expect(launched.ok).toBe(true);
    const validRunSeedZero = launched.run!;
    expect(validateV2SaveDataDetailed({ ...base, activeRun: validRunSeedZero }).ok).toBe(true);

    // 1. Partial legacy V2 save with ALL optional keys omitted MUST still migrate cleanly to V3
    const partialLegacyV2 = makeLegacyV2SaveObject({ credits: 180 });
    const partialProfile = partialLegacyV2.profile as Record<string, unknown>;
    for (const optionalKey of [
      'unlockedCrew',
      'unlockedFamilies',
      'relics',
      'discoveredItems',
      'seenItems',
      'completedContractTypes',
      'completedContractIds',
      'deepestLayerReached',
      'totalRuns',
      'tutorialCompleted',
      'tutorialBonusClaimed',
      'selectedShipId',
      'selectedCrewId',
      'selectedArchetype',
      'migrationRecord',
    ]) {
      delete partialProfile[optionalKey];
    }
    delete partialLegacyV2.settings;

    const partialStore = new MemoryStorage();
    partialStore.setItem(V2_SAVE_KEY, JSON.stringify(partialLegacyV2));
    const partialLoaded = loadV2SaveData(partialStore);
    expect(partialLoaded.status).toBe('loaded');
    if (partialLoaded.status === 'loaded') {
      expect(partialLoaded.migratedFromV2).toBe(true);
      expect(partialLoaded.data.profile.unlockedCrew).toEqual(['engineer']);
      expect(partialLoaded.data.profile.unlockedFamilies).toEqual(['core']);
      expect(partialLoaded.data.profile.selectedArchetype).toBe('laser');
      expect(partialLoaded.data.profile.selectedShipId).toBe('cannon_skiff');
      expect(getAvailableContractBoard(partialLoaded.data.profile).standardTemplates.length).toBeGreaterThan(0);
      const launchAfterPartial = launchV2Expedition({
        profile: partialLoaded.data.profile,
        contractTemplateId: 'free_salvage',
        shipId: partialLoaded.data.profile.selectedShipId,
        crewId: partialLoaded.data.profile.selectedCrewId,
        primaryArchetype: partialLoaded.data.profile.selectedArchetype,
        slots: buildFreeFallbackPrepareSlots(
          partialLoaded.data.profile.selectedShipId,
          partialLoaded.data.profile.blueprints
        ),
        seed: 2026,
      });
      expect(launchAfterPartial.ok).toBe(true);
      expect(persistV2SaveData(partialStore, partialLoaded.data).ok).toBe(true);
    }

    // 2. Malformed/null V3 profile, campaign, factionRep, crewMastery, settings cases MUST be rejected
    const badV3Payloads: unknown[] = [
      { ...base, profile: { ...base.profile, unlockedCrew: null } },
      { ...base, profile: { ...base.profile, unlockedCrew: ['bogus_crew'] } },
      { ...base, profile: { ...base.profile, unlockedFamilies: null } },
      { ...base, profile: { ...base.profile, unlockedFamilies: ['bogus_kit'] } },
      { ...base, profile: { ...base.profile, completedContractTypes: null } },
      { ...base, profile: { ...base.profile, completedContractTypes: ['bogus_type'] } },
      { ...base, profile: { ...base.profile, completedContractIds: null } },
      { ...base, profile: { ...base.profile, discoveredItems: 'equipment.laser.common' } },
      { ...base, profile: { ...base.profile, seenItems: 'cargo.alloy_bar' } },
      { ...base, profile: { ...base.profile, pendingGiftQueue: [null] } },
      { ...base, profile: { ...base.profile, totalRuns: -5 } },
      { ...base, profile: { ...base.profile, totalRuns: null } },
      { ...base, profile: { ...base.profile, deepestLayerReached: -3 } },
      { ...base, profile: { ...base.profile, deepestLayerReached: null } },
      { ...base, profile: { ...base.profile, selectedArchetype: 'bogus' } },
      { ...base, profile: { ...base.profile, selectedShipId: 'bogus_ship' } },
      { ...base, profile: { ...base.profile, selectedCrewId: 'bogus_crew' } },
      {
        ...base,
        profile: {
          ...base.profile,
          campaign: { ...base.profile.campaign, relicPityCounters: null },
        },
      },
      {
        ...base,
        profile: {
          ...base.profile,
          campaign: { ...base.profile.campaign, relicPityCounters: [] },
        },
      },
      {
        ...base,
        profile: {
          ...base.profile,
          campaign: { ...base.profile.campaign, relicPityCounters: { near_orbit: -1 } },
        },
      },
      {
        ...base,
        profile: {
          ...base.profile,
          campaign: { ...base.profile.campaign, finalMissionUnlocked: 'yes' },
        },
      },
      {
        ...base,
        profile: {
          ...base.profile,
          campaign: { ...base.profile.campaign, endlessUnlocked: null },
        },
      },
      {
        ...base,
        profile: {
          ...base.profile,
          factionRep: { starport_guild: -50, deep_institute: Number.NaN, free_salvagers: 999 },
        },
      },
      { ...base, profile: { ...base.profile, factionRep: [] } },
      { ...base, profile: { ...base.profile, factionRep: null } },
      {
        ...base,
        profile: {
          ...base.profile,
          crewMastery: { engineer: -2, navigator: 99, salvager: Number.NaN },
        },
      },
      { ...base, profile: { ...base.profile, crewMastery: [] } },
      { ...base, profile: { ...base.profile, crewMastery: null } },
      { ...base, settings: 'bad' },
      { ...base, settings: null },
      { ...base, settings: [] },
      // ActiveRun invariants: invalid seed, chargesUsed > chargesMax, missing currentNodeId on ENCOUNTER/SHOP/REWARD
      { ...base, activeRun: { ...validRunSeedZero, seed: Number.NaN } },
      { ...base, activeRun: { ...validRunSeedZero, seed: -1 } },
      { ...base, activeRun: { ...validRunSeedZero, seed: 12.5 } },
      {
        ...base,
        activeRun: { ...validRunSeedZero, tacticalChargesMax: 1, tacticalChargesUsed: 5 },
      },
      {
        ...base,
        activeRun: { ...validRunSeedZero, phase: 'ENCOUNTER', currentNodeId: null },
      },
      {
        ...base,
        activeRun: { ...validRunSeedZero, phase: 'SHOP', currentNodeId: null },
      },
      {
        ...base,
        activeRun: {
          ...validRunSeedZero,
          phase: 'REWARD',
          currentNodeId: null,
          pendingReward: {
            nodeId: 'L1A',
            equipmentOption: validRunSeedZero.bay.placed[0].item,
            cargoOption: validRunSeedZero.bay.placed[0].item,
            repairAmount: 4,
            chosen: null,
          },
        },
      },
    ];
    for (const payload of badV3Payloads) {
      expect(validateV2SaveDataDetailed(payload).ok).toBe(false);
    }

    // Valid edge cases: selectedCrewId === null (solo), MAP & SETTLEMENT with currentNodeId === null
    expect(
      validateV2SaveDataDetailed({
        ...base,
        profile: { ...base.profile, selectedCrewId: null },
      }).ok
    ).toBe(true);
    expect(
      validateV2SaveDataDetailed({
        ...base,
        activeRun: {
          ...validRunSeedZero,
          phase: 'SETTLEMENT',
          settlementReason: 'safe_return',
          currentNodeId: null,
        },
      }).ok
    ).toBe(true);

    // 3. Explicit null arrays in legacy V2 saves MUST be rejected (not overwrite defaults with null)
    for (const field of ['unlockedCrew', 'unlockedFamilies', 'completedContractTypes', 'completedContractIds'] as const) {
      const badV2 = makeLegacyV2SaveObject();
      (badV2.profile as Record<string, unknown>)[field] = null;
      expect(validateLegacyV2SaveDataDetailed(badV2).ok).toBe(false);
      expect(migrateV2ToV3SaveData(badV2).ok).toBe(false);
      const store = new MemoryStorage();
      store.setItem(V2_SAVE_KEY, JSON.stringify(badV2));
      expect(loadV2SaveData(store).status).toBe('corrupt_no_backup');
    }

    // 4. Direct normalizeV2SaveData never splits strings into chars, never keeps null relicPityCounters, never pollutes settings
    const normalizedMalformed = normalizeV2SaveData({
      ...base,
      profile: {
        ...base.profile,
        discoveredItems: 'equipment.laser.common' as never,
        seenItems: 'cargo.alloy_bar' as never,
        unlockedCrew: null as never,
        unlockedFamilies: null as never,
        completedContractTypes: null as never,
        completedContractIds: null as never,
        pendingGiftQueue: [null] as never,
        totalRuns: -5,
        deepestLayerReached: -3,
        selectedArchetype: 'bogus' as never,
        selectedShipId: 'bogus' as never,
        campaign: { ...base.profile.campaign, relicPityCounters: null as never },
      },
      settings: 'bad' as never,
    });
    expect(normalizedMalformed.profile.discoveredItems).toEqual([]);
    expect(normalizedMalformed.profile.seenItems).toEqual([]);
    expect(normalizedMalformed.profile.unlockedCrew).toEqual(['engineer']);
    expect(normalizedMalformed.profile.unlockedFamilies).toEqual(['core']);
    expect(normalizedMalformed.profile.completedContractTypes).toEqual([]);
    expect(normalizedMalformed.profile.completedContractIds).toEqual([]);
    expect(normalizedMalformed.profile.pendingGiftQueue).toEqual([]);
    expect(normalizedMalformed.profile.totalRuns).toBe(0);
    expect(normalizedMalformed.profile.deepestLayerReached).toBe(0);
    expect(normalizedMalformed.profile.selectedArchetype).toBe('laser');
    expect(normalizedMalformed.profile.selectedShipId).toBe('cannon_skiff');
    expect(normalizedMalformed.profile.campaign.relicPityCounters).toEqual({});
    expect('0' in normalizedMalformed.settings).toBe(false);
    expect(validateV2SaveDataDetailed(normalizedMalformed).ok).toBe(true);
  });

  it('persistV2SaveData returns { ok: false } cleanly without throwing TypeError on non-array/null payloads while still trimming valid oversized runHistory', () => {
    const base = createFreshV2SaveData();
    const store = new MemoryStorage();

    const throwingCandidates: unknown[] = [
      { ...base, profile: { ...base.profile, discoveredItems: 123 } },
      { ...base, profile: { ...base.profile, seenItems: 123 } },
      { ...base, profile: { ...base.profile, runHistory: 123 } },
      { ...base, profile: { ...base.profile, discoveredItems: 'equipment.laser.common' } },
      { ...base, profile: { ...base.profile, runHistory: null } },
      { ...base, profile: null },
      null,
    ];

    for (const candidate of throwingCandidates) {
      let result: { readonly ok: boolean; readonly error?: string } | undefined;
      expect(() => {
        result = persistV2SaveData(store, candidate as never);
      }).not.toThrow();
      expect(result?.ok).toBe(false);
      expect(result?.error).toBeTruthy();
    }
    expect(store.getItem(V2_SAVE_KEY)).toBeNull();

    // Valid oversized runHistory (60 entries) and unsynced seenItems still persist & trim cleanly to 30
    const history60 = Array.from({ length: 60 }, (_, idx) => ({
      runId: `hist_${idx}`,
      finishedAt: '2026-11-23T00:00:00.000Z',
      sectorId: 'near_orbit' as const,
      contractTemplateId: 'free_salvage',
      contractName: '自由打捞',
      shipId: 'cannon_skiff' as const,
      crewId: 'engineer' as const,
      outcome: 'safe_return' as const,
      contractCompleted: true,
      maxLayerReached: 3,
      creditsEarned: 60,
      salvagePartsEarned: 0,
      endlessThreat: 0,
    }));
    const validOversized = {
      ...base,
      profile: {
        ...base.profile,
        discoveredItems: ['equipment.laser.common', 'cargo.alloy_bar'],
        seenItems: [],
        runHistory: history60,
      },
    };
    expect(persistV2SaveData(store, validOversized).ok).toBe(true);
    const reloaded = loadV2SaveData(store);
    expect(reloaded.status).toBe('loaded');
    if (reloaded.status === 'loaded') {
      expect(reloaded.data.profile.runHistory.length).toBe(V3_MAX_RUN_HISTORY);
      expect(reloaded.data.profile.runHistory[0].runId).toBe('hist_0');
      expect(reloaded.data.profile.runHistory[29].runId).toBe('hist_29');
      expect(reloaded.data.profile.seenItems).toContain('equipment.laser.common');
      expect(reloaded.data.profile.seenItems).toContain('cargo.alloy_bar');
    }
  });

  it('blocks Object.prototype key bypasses (toString/constructor/valueOf/__proto__) across itemCatalog and V2/V3 save validation without throwing', () => {
    const protoKeys = ['toString', 'constructor', 'valueOf', '__proto__', 'hasOwnProperty'];
    for (const key of protoKeys) {
      expect(getAnyV2ItemDef(key)).toBeUndefined();
    }
    const freshProfile = createFreshV2Profile();
    expect(recordV2SeenItems(freshProfile, protoKeys)).toBe(freshProfile);

    const base = createFreshV2SaveData();
    const launched = launchV2Expedition({
      profile: base.profile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: buildFreeFallbackPrepareSlots('cannon_skiff', base.profile.blueprints),
      seed: 1234,
    });
    const run = launched.run!;
    const sampleItem = run.bay.placed[0].item;

    const protoAttackPayloads: unknown[] = [
      // activeRun.shipId: 'toString' with matching bay.shipId
      {
        ...base,
        activeRun: {
          ...run,
          shipId: 'toString',
          bay: { shipId: 'toString', placed: [], staging: [], discardedThisArrange: [] },
        },
      },
      // activeRun.currentNodeId: 'toString' across MAP, ENCOUNTER, SHOP, REWARD
      { ...base, activeRun: { ...run, phase: 'MAP', currentNodeId: 'toString' } },
      { ...base, activeRun: { ...run, phase: 'ENCOUNTER', currentNodeId: 'toString' } },
      { ...base, activeRun: { ...run, phase: 'SHOP', currentNodeId: 'toString' } },
      { ...base, activeRun: { ...run, phase: 'REWARD', currentNodeId: 'toString' } },
      // definitionId: 'toString' / 'constructor' / 'valueOf' in bay.placed (must NOT throw uncaught TypeError!)
      {
        ...base,
        activeRun: {
          ...run,
          bay: {
            ...run.bay,
            placed: [{ ...run.bay.placed[0], item: { ...sampleItem, definitionId: 'toString' } }],
          },
        },
      },
      {
        ...base,
        activeRun: {
          ...run,
          bay: {
            ...run.bay,
            placed: [{ ...run.bay.placed[0], item: { ...sampleItem, definitionId: 'constructor' } }],
          },
        },
      },
      // definitionId: 'toString' in bay.staging, warehouse, pendingGiftQueue, discardedThisArrange, preset slot
      {
        ...base,
        activeRun: {
          ...run,
          bay: {
            ...run.bay,
            staging: [{ item: { ...sampleItem, instanceId: 'st_proto', definitionId: 'toString' }, rotation: 0 }],
          },
        },
      },
      {
        ...base,
        activeRun: {
          ...run,
          bay: {
            ...run.bay,
            discardedThisArrange: [
              {
                item: { ...sampleItem, instanceId: 'disc_proto', definitionId: 'valueOf' },
                previousLocation: { zone: 'staging', rotation: 0 },
              },
            ],
          },
        },
      },
      {
        ...base,
        profile: {
          ...base.profile,
          equipmentWarehouse: [
            {
              ...sampleItem,
              instanceId: 'wh_proto',
              definitionId: 'toString',
              origin: 'owned',
              location: 'warehouse',
              fixedValue: 10,
            },
          ],
        },
      },
      {
        ...base,
        profile: {
          ...base.profile,
          pendingGiftQueue: [
            {
              ...sampleItem,
              instanceId: 'gift_proto',
              definitionId: 'constructor',
              origin: 'owned',
              location: 'gift_queue',
              fixedValue: 10,
            },
          ],
        },
      },
      {
        ...base,
        profile: {
          ...base.profile,
          loadoutPresets: [
            {
              presetId: 'p_proto',
              name: 'Proto Preset',
              shipId: 'cannon_skiff',
              crewId: 'engineer',
              primaryArchetype: 'laser',
              updatedAt: '2026-11-23T00:00:00.000Z',
              slots: [
                {
                  definitionId: 'toString',
                  quality: 'common',
                  preferOrigin: 'loan',
                  x: 0,
                  y: 0,
                  rotation: 0,
                },
              ],
            },
          ],
        },
      },
      // graph.startNextNodeIds pointing to 'toString'
      {
        ...base,
        activeRun: {
          ...run,
          graph: { ...run.graph, startNextNodeIds: ['toString'] },
        },
      },
    ];

    for (const payload of protoAttackPayloads) {
      let detailed: { readonly ok: boolean; readonly error?: string } | undefined;
      expect(() => {
        detailed = validateV2SaveDataDetailed(payload);
      }).not.toThrow();
      expect(detailed?.ok).toBe(false);

      const store = new MemoryStorage();
      store.setItem(V2_SAVE_KEY, JSON.stringify(payload));
      expect(loadV2SaveData(store).status).toBe('corrupt_no_backup');
    }

    // Legacy V2 save with shipId: 'toString' or currentNodeId: 'toString' MUST also be rejected
    const badLegacyV2 = makeLegacyV2SaveObject({ withActiveRun: true });
    (badLegacyV2.activeRun as Record<string, unknown>).currentNodeId = 'toString';
    expect(validateLegacyV2SaveDataDetailed(badLegacyV2).ok).toBe(false);
    expect(migrateV2ToV3SaveData(badLegacyV2).ok).toBe(false);

    // JSON-parsed own "__proto__" key inside graph.nodes must be rejected cleanly without prototype pollution
    const rawGraphWithProtoNode = JSON.parse(
      JSON.stringify({ ...base, activeRun: run }).replace(
        '"nodes":{',
        '"nodes":{"__proto__":{"nodeId":"__proto__","layer":1,"lane":0,"type":"wreck","sectorBg":1,"nextNodeIds":[],"contractMarker":false,"resolved":false},'
      )
    ) as unknown;
    expect(validateV2SaveDataDetailed(rawGraphWithProtoNode).ok).toBe(false);
    expect(({} as Record<string, unknown>).nodeId).toBeUndefined();
  });

  it('rejects malformed nested elements in loadoutPresets, discardedThisArrange, graph, contract, pendingReward, and activeCombat while preserving valid real-game states', () => {
    const base = createFreshV2SaveData();
    const launched = launchV2Expedition({
      profile: base.profile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: buildFreeFallbackPrepareSlots('cannon_skiff', base.profile.blueprints),
      seed: 4321,
    });
    const run = launched.run!;
    const firstCombatNode = Object.values(run.graph.nodes).find((n) => n.layer === 1 && n.combat)!;
    const validEquip = createV2EquipmentInstance({
      instanceId: 'eq_nested_1',
      kind: 'laser',
      quality: 'common',
      origin: 'loot',
      acquiredDepth: 1,
      location: 'staging',
    });
    const validCargo = createV2CargoInstance({
      instanceId: 'cg_nested_1',
      defId: 'cargo.alloy_bar',
      origin: 'loot',
      acquiredDepth: 1,
      location: 'staging',
    });
    const validPresetBase = {
      presetId: 'preset_valid_1',
      name: '标准激光',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      updatedAt: '2026-11-23T00:00:00.000Z',
      slots: [
        {
          definitionId: 'equipment.laser.common',
          quality: 'common',
          preferOrigin: 'loan',
          x: 0,
          y: 0,
          rotation: 0,
        },
      ],
    };

    const malformedNestedPayloads: unknown[] = [
      // 1. loadoutPresets malformed entries & slots
      { ...base, profile: { ...base.profile, loadoutPresets: [{ ...validPresetBase, slots: [null] }] } },
      { ...base, profile: { ...base.profile, loadoutPresets: [{ ...validPresetBase, shipId: 'bogus_ship' }] } },
      { ...base, profile: { ...base.profile, loadoutPresets: [{ ...validPresetBase, crewId: 'bogus_crew' }] } },
      { ...base, profile: { ...base.profile, loadoutPresets: [{ ...validPresetBase, primaryArchetype: 'bogus' }] } },
      {
        ...base,
        profile: {
          ...base.profile,
          loadoutPresets: [
            {
              ...validPresetBase,
              slots: [{ ...validPresetBase.slots[0], definitionId: 'cargo.alloy_bar' }],
            },
          ],
        },
      },
      {
        ...base,
        profile: {
          ...base.profile,
          loadoutPresets: [
            {
              ...validPresetBase,
              slots: [{ ...validPresetBase.slots[0], preferOrigin: 'loot' }],
            },
          ],
        },
      },
      {
        ...base,
        profile: {
          ...base.profile,
          loadoutPresets: [
            {
              ...validPresetBase,
              slots: [{ ...validPresetBase.slots[0], rotation: 5 }],
            },
          ],
        },
      },
      {
        ...base,
        profile: {
          ...base.profile,
          loadoutPresets: [
            {
              ...validPresetBase,
              slots: [{ ...validPresetBase.slots[0], x: 1.5 }],
            },
          ],
        },
      },
      // 2. bay.discardedThisArrange malformed records
      { ...base, activeRun: { ...run, bay: { ...run.bay, discardedThisArrange: [null] } } },
      {
        ...base,
        activeRun: {
          ...run,
          bay: {
            ...run.bay,
            discardedThisArrange: [{ item: null, previousLocation: { zone: 'staging', rotation: 0 } }],
          },
        },
      },
      {
        ...base,
        activeRun: {
          ...run,
          bay: {
            ...run.bay,
            discardedThisArrange: [{ item: validEquip, previousLocation: null }],
          },
        },
      },
      {
        ...base,
        activeRun: {
          ...run,
          bay: {
            ...run.bay,
            discardedThisArrange: [
              { item: validEquip, previousLocation: { zone: 'grid', x: 0.5, y: 0, rotation: 0 } },
            ],
          },
        },
      },
      {
        ...base,
        activeRun: {
          ...run,
          bay: {
            ...run.bay,
            discardedThisArrange: [
              { item: validEquip, previousLocation: { zone: 'staging', rotation: 9 } },
            ],
          },
        },
      },
      {
        ...base,
        activeRun: {
          ...run,
          bay: {
            ...run.bay,
            discardedThisArrange: [
              { item: validEquip, previousLocation: { zone: 'pocket', rotation: 0 } },
            ],
          },
        },
      },
      {
        ...base,
        activeRun: {
          ...run,
          bay: {
            ...run.bay,
            discardedThisArrange: [
              { item: run.bay.placed[0].item, previousLocation: { zone: 'staging', rotation: 0 } },
            ],
          },
        },
      },
      // 3. activeRun.graph malformed startNextNodeIds & node entries
      { ...base, activeRun: { ...run, graph: { ...run.graph, startNextNodeIds: null } } },
      { ...base, activeRun: { ...run, graph: { ...run.graph, startNextNodeIds: [] } } },
      { ...base, activeRun: { ...run, graph: { ...run.graph, startNextNodeIds: ['NO_SUCH_NODE'] } } },
      {
        ...base,
        activeRun: {
          ...run,
          graph: { ...run.graph, nodes: { ...run.graph.nodes, L1A: null } },
        },
      },
      {
        ...base,
        activeRun: {
          ...run,
          graph: {
            ...run.graph,
            nodes: {
              ...run.graph.nodes,
              L1A: { ...run.graph.nodes.L1A, nextNodeIds: null },
            },
          },
        },
      },
      {
        ...base,
        activeRun: {
          ...run,
          graph: {
            ...run.graph,
            nodes: {
              ...run.graph.nodes,
              L1A: { ...run.graph.nodes.L1A, nextNodeIds: ['NO_SUCH_NODE'] },
            },
          },
        },
      },
      {
        ...base,
        activeRun: {
          ...run,
          graph: {
            ...run.graph,
            nodes: {
              ...run.graph.nodes,
              L1A: { ...run.graph.nodes.L1A, type: 'bogus_type' },
            },
          },
        },
      },
      {
        ...base,
        activeRun: {
          ...run,
          graph: {
            ...run.graph,
            nodes: {
              ...run.graph.nodes,
              L1A: { ...run.graph.nodes.L1A, layer: 0 },
            },
          },
        },
      },
      // 4. activeRun.contract malformed fields
      { ...base, activeRun: { ...run, contract: { ...run.contract, markedNodeIds: null } } },
      { ...base, activeRun: { ...run, contract: { ...run.contract, completedNodeIds: null } } },
      { ...base, activeRun: { ...run, contract: { ...run.contract, rewardCredits: -10 } } },
      { ...base, activeRun: { ...run, contract: { ...run.contract, status: 'bogus' } } },
      // 5. activeRun.pendingReward malformed (both in REWARD and non-REWARD phases)
      {
        ...base,
        activeRun: {
          ...run,
          phase: 'REWARD',
          currentNodeId: firstCombatNode.nodeId,
          pendingReward: {},
        },
      },
      {
        ...base,
        activeRun: {
          ...run,
          phase: 'REWARD',
          currentNodeId: firstCombatNode.nodeId,
          pendingReward: {
            nodeId: firstCombatNode.nodeId,
            equipmentOption: null,
            cargoOption: validCargo,
            repairAmount: 10,
            chosen: null,
          },
        },
      },
      {
        ...base,
        activeRun: {
          ...run,
          phase: 'REWARD',
          currentNodeId: firstCombatNode.nodeId,
          pendingReward: {
            nodeId: firstCombatNode.nodeId,
            equipmentOption: validEquip,
            cargoOption: validCargo,
            repairAmount: -5,
            chosen: null,
          },
        },
      },
      { ...base, activeRun: { ...run, phase: 'MAP', pendingReward: {} } },
      // 6. activeRun.activeCombat malformed
      { ...base, activeRun: { ...run, phase: 'ENCOUNTER', currentNodeId: firstCombatNode.nodeId, activeCombat: 'bad' } },
      { ...base, activeRun: { ...run, phase: 'ENCOUNTER', currentNodeId: firstCombatNode.nodeId, activeCombat: {} } },
      {
        ...base,
        activeRun: {
          ...run,
          phase: 'ENCOUNTER',
          currentNodeId: firstCombatNode.nodeId,
          activeCombat: {
            nodeId: firstCombatNode.nodeId,
            startingHp: 30,
            targetPolicy: 'weakest',
            simulation: null,
          },
        },
      },
      {
        ...base,
        activeRun: {
          ...run,
          phase: 'ENCOUNTER',
          currentNodeId: firstCombatNode.nodeId,
          activeCombat: {
            nodeId: firstCombatNode.nodeId,
            startingHp: 30,
            targetPolicy: 'weakest',
            simulation: {
              resultId: 'sim_1',
              outcome: 'draw',
              stalemate: false,
              targetPolicy: 'weakest',
              roundsCount: 1,
              startingPlayerHp: 30,
              startingPlayerShield: 0,
              finalPlayerHp: 20,
              repairApplied: 0,
              finalPlayerHpAfterRepair: 20,
              initialEnemies: [],
              rounds: [],
            },
          },
        },
      },
    ];

    for (const payload of malformedNestedPayloads) {
      expect(validateV2SaveDataDetailed(payload).ok).toBe(false);
      const store = new MemoryStorage();
      store.setItem(V2_SAVE_KEY, JSON.stringify(payload));
      expect(loadV2SaveData(store).status).toBe('corrupt_no_backup');
    }

    // Legacy V2 migration MUST also reject loadoutPresets with slots: [null] and malformed nested activeRun fields
    const badLegacyPreset = makeLegacyV2SaveObject();
    (badLegacyPreset.profile as Record<string, unknown>).loadoutPresets = [
      { ...validPresetBase, slots: [null] },
    ];
    expect(validateLegacyV2SaveDataDetailed(badLegacyPreset).ok).toBe(false);
    expect(migrateV2ToV3SaveData(badLegacyPreset).ok).toBe(false);

    const badLegacyRun = makeLegacyV2SaveObject({ withActiveRun: true });
    (badLegacyRun.activeRun as Record<string, unknown>).activeCombat = { simulation: null };
    expect(validateLegacyV2SaveDataDetailed(badLegacyRun).ok).toBe(false);
    expect(migrateV2ToV3SaveData(badLegacyRun).ok).toBe(false);

    // Direct normalizeV2SaveData strips null preset slots cleanly while keeping valid slots
    const normPresetSave = normalizeV2SaveData({
      ...base,
      profile: {
        ...base.profile,
        loadoutPresets: [
          {
            ...validPresetBase,
            slots: [null, validPresetBase.slots[0]],
          },
        ] as never,
      },
    });
    expect(normPresetSave.profile.loadoutPresets).toHaveLength(1);
    expect(normPresetSave.profile.loadoutPresets[0].slots).toHaveLength(1);
    expect(validateV2SaveDataDetailed(normPresetSave).ok).toBe(true);

    // Real-game valid states MUST all persist and reload cleanly (loadoutPresets, discardedThisArrange, activeCombat + pendingDecision, REWARD)
    const presetRes = saveV2LoadoutPreset(base.profile, {
      name: '合法配装',
      shipId: 'cannon_skiff',
      crewId: null,
      primaryArchetype: 'laser',
      slots: buildFreeFallbackPrepareSlots('cannon_skiff', base.profile.blueprints),
    });
    expect(presetRes.ok).toBe(true);

    const discRes = discardV2Item(run.bay, run.bay.placed[0].item.instanceId);
    expect(discRes.ok).toBe(true);
    const store = new MemoryStorage();
    expect(
      persistV2SaveData(store, {
        ...base,
        profile: presetRes.profile,
        activeRun: { ...run, phase: 'ARRANGE', bay: discRes.bay },
      }).ok
    ).toBe(true);
    const reloadedArrange = loadV2SaveData(store);
    expect(reloadedArrange.status).toBe('loaded');
    if (reloadedArrange.status === 'loaded') {
      expect(reloadedArrange.data.profile.loadoutPresets).toHaveLength(1);
      expect(undoV2LastDiscard(reloadedArrange.data.activeRun!.bay).ok).toBe(true);
    }

    // Real-game combat + pendingReward round-trip
    const entered = selectV2MapNode(run, firstCombatNode.nodeId);
    expect(entered.ok).toBe(true);
    const started = startV2CombatAtCurrentNode(entered.run, 'weakest');
    expect(started.ok).toBe(true);
    expect(persistV2SaveData(store, { ...base, activeRun: started.run }).ok).toBe(true);
    expect(loadV2SaveData(store).status).toBe('loaded');

    const completed = completeV2CombatAtCurrentNode(started.run, base.profile.unlockedFamilies);
    expect(completed.ok).toBe(true);
    expect(persistV2SaveData(store, { ...base, activeRun: completed.run }).ok).toBe(true);
    expect(loadV2SaveData(store).status).toBe('loaded');

    // Real-game Elite Round-2 pendingDecision round-trip
    const showcaseRun = createV2ShowcaseRun('trial_counter', 'elite_nested_rt');
    const atElite: V2RunState = {
      ...showcaseRun,
      currentNodeId: 'L4A',
      visitedNodeIds: ['L1A', 'L2A', 'L3A', 'L4A'],
      phase: 'ENCOUNTER',
    };
    const startedElite = startV2CombatAtCurrentNode(atElite, 'weakest', { enableEliteTactic: true });
    expect(startedElite.ok).toBe(true);
    expect(persistV2SaveData(store, { ...base, activeRun: startedElite.run }).ok).toBe(true);
    expect(loadV2SaveData(store).status).toBe('loaded');
  });

  it('rejects sparse arrays with empty slots across validation and persistV2SaveData to prevent persist->load self-corruption', () => {
    const base = createFreshV2SaveData();
    const launched = launchV2Expedition({
      profile: base.profile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: buildFreeFallbackPrepareSlots('cannon_skiff', base.profile.blueprints),
      seed: 7777,
    });
    const run = launched.run!;

    const makeSparse = <T,>(len = 2): T[] => new Array<T>(len);
    const makeSparseWithHole = (): string[] => {
      const arr: string[] = [];
      arr[0] = 'equipment.laser.common';
      arr[2] = 'cargo.alloy_bar';
      return arr;
    };

    const sparseCandidates: unknown[] = [
      { ...base, activeRun: { ...run, recentEquipmentKinds: makeSparse(2) } },
      { ...base, activeRun: { ...run, usedEventIds: makeSparse(2) } },
      { ...base, activeRun: { ...run, visitedNodeIds: makeSparse(1) } },
      { ...base, activeRun: { ...run, claimedEventIds: makeSparse(1) } },
      { ...base, activeRun: { ...run, transactionIds: makeSparse(1) } },
      { ...base, activeRun: { ...run, endlessMutatorIds: makeSparse(2) } },
      { ...base, activeRun: { ...run, bay: { ...run.bay, placed: makeSparse(1) } } },
      { ...base, activeRun: { ...run, bay: { ...run.bay, staging: makeSparse(1) } } },
      { ...base, activeRun: { ...run, bay: { ...run.bay, discardedThisArrange: makeSparse(1) } } },
      {
        ...base,
        profile: {
          ...base.profile,
          campaign: { ...base.profile.campaign, unlockedSectors: makeSparse(2) },
        },
      },
      {
        ...base,
        profile: {
          ...base.profile,
          campaign: { ...base.profile.campaign, completedMilestones: makeSparse(2) },
        },
      },
      {
        ...base,
        profile: {
          ...base.profile,
          campaign: { ...base.profile.campaign, endingsUnlocked: makeSparse(1) },
        },
      },
      { ...base, profile: { ...base.profile, discoveredItems: makeSparseWithHole() } },
      { ...base, profile: { ...base.profile, seenItems: makeSparse(2) } },
      { ...base, profile: { ...base.profile, settledRunIds: makeSparse(1) } },
      { ...base, profile: { ...base.profile, unlockedShips: makeSparse(1) } },
      { ...base, profile: { ...base.profile, blueprints: makeSparse(1) } },
      { ...base, profile: { ...base.profile, runHistory: makeSparse(1) } },
      {
        ...base,
        profile: {
          ...base.profile,
          loadoutPresets: [
            {
              presetId: 'p_sparse',
              name: 'Sparse Slots',
              shipId: 'cannon_skiff',
              crewId: 'engineer',
              primaryArchetype: 'laser',
              updatedAt: '2026-11-23T00:00:00.000Z',
              slots: makeSparse(1),
            },
          ],
        },
      },
    ];

    const store = new MemoryStorage();
    for (const candidate of sparseCandidates) {
      expect(validateV2SaveDataDetailed(candidate).ok).toBe(false);
      const persistRes = persistV2SaveData(store, candidate as never);
      expect(persistRes.ok).toBe(false);
      expect(store.getItem(V2_SAVE_KEY)).toBeNull();
    }
  });

  it('enforces all 6 proactive hardening invariants (item parity, warehouse/gift ID uniqueness, uint32 seed bound, runHistory schema, selectedShipId fallback, settings key allowlist)', () => {
    const base = createFreshV2SaveData();
    const launched = launchV2Expedition({
      profile: base.profile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: buildFreeFallbackPrepareSlots('cannon_skiff', base.profile.blueprints),
      seed: MAX_UINT32,
    });
    expect(launched.ok).toBe(true);
    const maxUint32Run = launched.run!;
    expect(validateV2SaveDataDetailed({ ...base, activeRun: maxUint32Run }).ok).toBe(true);

    // 1. Item category/quality parity & warehouse equipment-only enforcement
    const validOwnedLaser = createV2EquipmentInstance({
      instanceId: 'wh_eq_1',
      kind: 'laser',
      quality: 'common',
      origin: 'owned',
      acquiredDepth: 0,
      location: 'warehouse',
    });
    const validCargoLoot = createV2CargoInstance({
      instanceId: 'cg_item_1',
      defId: 'cargo.alloy_bar',
      origin: 'loot',
      acquiredDepth: 1,
      location: 'staging',
    });
    // Tampered category (cargo posing as equipment)
    expect(
      validateV2SaveDataDetailed({
        ...base,
        activeRun: {
          ...maxUint32Run,
          bay: {
            ...maxUint32Run.bay,
            staging: [{ item: { ...validCargoLoot, category: 'equipment' }, rotation: 0 }],
          },
        },
      }).ok
    ).toBe(false);
    // Tampered quality (common def posing as improved)
    expect(
      validateV2SaveDataDetailed({
        ...base,
        profile: {
          ...base.profile,
          equipmentWarehouse: [{ ...validOwnedLaser, quality: 'improved' }],
        },
      }).ok
    ).toBe(false);
    // Cargo item placed directly into equipmentWarehouse
    expect(
      validateV2SaveDataDetailed({
        ...base,
        profile: {
          ...base.profile,
          equipmentWarehouse: [{ ...validCargoLoot, location: 'warehouse' }],
        },
      }).ok
    ).toBe(false);

    // 2. Combined instanceId uniqueness across equipmentWarehouse & pendingGiftQueue
    const dupGiftSave = {
      ...base,
      profile: {
        ...base.profile,
        equipmentWarehouse: [validOwnedLaser],
        pendingGiftQueue: [{ ...validOwnedLaser, location: 'gift_queue' as const }],
      },
    };
    expect(validateV2SaveDataDetailed(dupGiftSave).ok).toBe(false);
    const dupStore = new MemoryStorage();
    expect(persistV2SaveData(dupStore, dupGiftSave).ok).toBe(false);
    const normDup = normalizeV2SaveData(dupGiftSave);
    expect(normDup.profile.equipmentWarehouse).toHaveLength(1);
    expect(normDup.profile.pendingGiftQueue).toHaveLength(0);
    expect(validateV2SaveDataDetailed(normDup).ok).toBe(true);

    // 3. activeRun.seed uint32 upper bound (0xffffffff valid, 0x100000000 rejected)
    expect(
      validateV2SaveDataDetailed({
        ...base,
        activeRun: { ...maxUint32Run, seed: MAX_UINT32 + 1 },
      }).ok
    ).toBe(false);

    // 4. profile.runHistory entry schema validation & normalization filtering
    expect(
      validateV2SaveDataDetailed({
        ...base,
        profile: { ...base.profile, runHistory: [{}] as never },
      }).ok
    ).toBe(false);
    expect(
      validateV2SaveDataDetailed({
        ...base,
        profile: {
          ...base.profile,
          runHistory: [{ runId: 'r_bad', outcome: 'bogus', creditsEarned: 10 }] as never,
        },
      }).ok
    ).toBe(false);
    const normBadHist = normalizeV2SaveData({
      ...base,
      profile: { ...base.profile, runHistory: [{}] as never },
    });
    expect(normBadHist.profile.runHistory).toEqual([]);
    expect(validateV2SaveDataDetailed(normBadHist).ok).toBe(true);

    // 5. selectedShipId falls back to unlockedShips[0] if not unlocked
    const lockedSelectionSave = {
      ...base,
      profile: {
        ...base.profile,
        unlockedShips: ['cannon_skiff' as const],
        selectedShipId: 'shield_cruiser' as const,
      },
    };
    const normShip = normalizeV2SaveData(lockedSelectionSave);
    expect(normShip.profile.selectedShipId).toBe('cannon_skiff');

    const unlockedSelectionSave = {
      ...base,
      profile: {
        ...base.profile,
        unlockedShips: ['cannon_skiff' as const, 'shield_cruiser' as const],
        selectedShipId: 'shield_cruiser' as const,
      },
    };
    expect(normalizeV2SaveData(unlockedSelectionSave).profile.selectedShipId).toBe('shield_cruiser');

    const legacyLockedShip = makeLegacyV2SaveObject();
    (legacyLockedShip.profile as Record<string, unknown>).unlockedShips = ['cannon_skiff'];
    (legacyLockedShip.profile as Record<string, unknown>).selectedShipId = 'heavy_freighter';
    const migLockedShip = migrateV2ToV3SaveData(legacyLockedShip);
    expect(migLockedShip.ok).toBe(true);
    expect(migLockedShip.data?.profile.selectedShipId).toBe('cannon_skiff');

    // 6. Known-key-only settings normalization strips extra/proto keys while preserving valid GameSettings
    const dirtySettingsJson = JSON.parse(
      JSON.stringify({
        ...base,
        settings: {
          combatSpeed: 2,
          reducedMotion: true,
          lowQuality: false,
          sfxMuted: true,
          bgmMuted: false,
          eliteTacticExperiment: true,
          extraUnknownKey: 'should_be_stripped',
        },
      }).replace('"extraUnknownKey":', '"__proto__":{"polluted":true},"extraUnknownKey":')
    ) as typeof base;
    const settingsStore = new MemoryStorage();
    settingsStore.setItem(V2_SAVE_KEY, JSON.stringify(dirtySettingsJson));
    const loadedSettings = loadV2SaveData(settingsStore);
    expect(loadedSettings.status).toBe('loaded');
    if (loadedSettings.status === 'loaded') {
      expect(loadedSettings.data.settings).toEqual({
        combatSpeed: 2,
        reducedMotion: true,
        lowQuality: false,
        sfxMuted: true,
        bgmMuted: false,
        eliteTacticExperiment: true,
      });
      expect('extraUnknownKey' in loadedSettings.data.settings).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(loadedSettings.data.settings, '__proto__')).toBe(
        false
      );
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    }
  });
});

describe('M1 Foundation: F04 Codex 48/48, seenItems, Locked Deep Contracts, Anti-Repeat & Shop Engineer Swap', () => {
  it('reaches 48/48 Codex by recording delivered mission items on safe_return and NOT on defeat/abort', () => {
    const totalCodexDefs =
      Object.keys(V2_EQUIPMENT_DEFS).length +
      Object.keys(V3_GADGET_DEFS).length +
      Object.keys(V2_CARGO_DEFS).length;
    expect(totalCodexDefs).toBe(48);

    const profile = createFreshV2Profile();

    // 1. Transport mission delivery -> mission.sealed_reactor discovered
    const tLaunch = launchV2Expedition({
      profile,
      contractTemplateId: 'transport_std',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: [],
      seed: 9101,
    });
    const reactor = createV2CargoInstance({
      instanceId: 'm_reactor_1',
      defId: 'mission.sealed_reactor',
      origin: 'mission',
      acquiredDepth: 2,
      location: 'bay',
      missionBinding: tLaunch.run!.contract.contractId,
    });
    const transportSafeRun: V2RunState = {
      ...tLaunch.run!,
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
      bay: {
        ...tLaunch.run!.bay,
        placed: [{ item: reactor, x: 0, y: 0, rotation: 0 }],
      },
    };
    const transportSum = calculateV2Settlement(transportSafeRun, profile);
    expect(transportSum.contractCompleted).toBe(true);
    expect(transportSum.discoveredDefIds).toContain('mission.sealed_reactor');

    // Defeat must NOT discover mission.sealed_reactor
    const transportDefeatSum = calculateV2Settlement(
      { ...transportSafeRun, settlementReason: 'defeat', hp: 0 },
      profile
    );
    expect(transportDefeatSum.discoveredDefIds).not.toContain('mission.sealed_reactor');

    // Aborted return must NOT discover mission.sealed_reactor
    const transportAbortSum = calculateV2Settlement(
      {
        ...transportSafeRun,
        contract: { ...transportSafeRun.contract, status: 'aborted' },
      },
      profile
    );
    expect(transportAbortSum.discoveredDefIds).not.toContain('mission.sealed_reactor');

    // 2. Rescue mission delivery -> mission.escape_pod discovered
    const rLaunch = launchV2Expedition({
      profile,
      contractTemplateId: 'rescue_std',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: [],
      seed: 9102,
    });
    const pod = createV2CargoInstance({
      instanceId: 'm_pod_1',
      defId: 'mission.escape_pod',
      origin: 'mission',
      acquiredDepth: 2,
      location: 'bay',
      missionBinding: rLaunch.run!.contract.contractId,
    });
    const rescueSafeRun: V2RunState = {
      ...rLaunch.run!,
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
      bay: {
        ...rLaunch.run!.bay,
        placed: [{ item: pod, x: 0, y: 0, rotation: 0 }],
      },
    };
    const rescueSum = calculateV2Settlement(rescueSafeRun, profile);
    expect(rescueSum.contractCompleted).toBe(true);
    expect(rescueSum.discoveredDefIds).toContain('mission.escape_pod');

    // 3. Derelict mission delivery -> mission.black_box discovered on safe_return and NOT on defeat/abort
    const dLaunch = launchV2Expedition({
      profile,
      contractTemplateId: 'derelict_std',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: [],
      seed: 9103,
    });
    const blackBox = createV2CargoInstance({
      instanceId: 'm_black_box_1',
      defId: 'mission.black_box',
      origin: 'mission',
      acquiredDepth: 4,
      location: 'bay',
      missionBinding: dLaunch.run!.contract.contractId,
    });
    const derelictSafeRun: V2RunState = {
      ...dLaunch.run!,
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
      bay: {
        ...dLaunch.run!.bay,
        placed: [{ item: blackBox, x: 0, y: 0, rotation: 0 }],
      },
    };
    const derelictSum = calculateV2Settlement(derelictSafeRun, profile);
    expect(derelictSum.contractCompleted).toBe(true);
    expect(derelictSum.discoveredDefIds).toContain('mission.black_box');
    const derelictDefeatSum = calculateV2Settlement(
      { ...derelictSafeRun, settlementReason: 'defeat', hp: 0 },
      profile
    );
    expect(derelictDefeatSum.discoveredDefIds).not.toContain('mission.black_box');
  });

  it('tracks seenItems via recordV2SeenItems & collectVisibleV2DefIdsForRun without leaking unpeeked wreck contents', () => {
    const baseProfile = createFreshV2Profile();
    // No-op returns identical reference
    expect(recordV2SeenItems(baseProfile, [])).toBe(baseProfile);
    expect(recordV2SeenItems(baseProfile, ['nonexistent.def'])).toBe(baseProfile);

    const updated = recordV2SeenItems(baseProfile, [
      'equipment.heavy.common',
      'cargo.alloy_bar',
      'equipment.heavy.common',
    ]);
    expect(updated).not.toBe(baseProfile);
    expect(updated.seenItems).toEqual(['equipment.heavy.common', 'cargo.alloy_bar']);
    expect(updated.discoveredItems).toEqual([]);

    // Find a wreck node in a deterministic run
    const launch = launchV2Expedition({
      profile: baseProfile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: [],
      seed: 4242,
    });
    const run = launch.run!;
    const wreckNode = Object.values(run.graph.nodes).find((n) => n.type === 'wreck' && n.wreck);
    expect(wreckNode).toBeDefined();

    // Engineer (not Salvager) at uncut wreck -> must NOT leak armoryItem or cargoItems!
    const engAtWreck: V2RunState = {
      ...run,
      crewId: 'engineer',
      currentNodeId: wreckNode!.nodeId,
      phase: 'ENCOUNTER',
    };
    const visibleEng = collectVisibleV2DefIdsForRun(engAtWreck);
    expect(visibleEng).not.toContain(wreckNode!.wreck!.armoryItem.definitionId);
    for (const cg of wreckNode!.wreck!.cargoItems) {
      expect(visibleEng).not.toContain(cg.definitionId);
    }

    // Salvager at uncut wreck -> peeks and records both armoryItem and cargoItems!
    const salvAtWreck: V2RunState = { ...engAtWreck, crewId: 'salvager' };
    const visibleSalv = collectVisibleV2DefIdsForRun(salvAtWreck);
    expect(visibleSalv).toContain(wreckNode!.wreck!.armoryItem.definitionId);
    for (const cg of wreckNode!.wreck!.cargoItems) {
      expect(visibleSalv).toContain(cg.definitionId);
    }
  });

  it('always returns all 3 deep templates with accurate dual-condition deepLockReason', () => {
    const fresh = createFreshV2Profile();
    const boardFresh = getAvailableContractBoard(fresh);
    expect(boardFresh.deepUnlocked).toBe(false);
    expect(boardFresh.deepTemplates.length).toBe(3);
    expect(boardFresh.deepEntries.length).toBe(3);
    expect(boardFresh.deepEntries.every((e) => e.locked)).toBe(true);
    expect(boardFresh.deepLockReason).toContain('标准委托');
    expect(boardFresh.deepLockReason).toContain('第 4 层');

    // Only 1 standard contract completed, deepest layer still 3 -> still locked citing Layer 4
    const partial1 = { ...fresh, completedContractTypes: ['transport' as const], deepestLayerReached: 3 };
    expect(getDeepTierLockReason(partial1)).toContain('第 4 层');
    expect(getDeepTierLockReason(partial1)).not.toContain('标准委托');

    // Only Layer 4 reached, 0 contracts -> still locked citing standard contract
    const partial2 = { ...fresh, completedContractTypes: [], deepestLayerReached: 4 };
    expect(getDeepTierLockReason(partial2)).toContain('标准委托');
    expect(getDeepTierLockReason(partial2)).not.toContain('第 4 层');

    // Both conditions met -> unlocked
    const unlocked = { ...fresh, completedContractTypes: ['transport' as const], deepestLayerReached: 4 };
    const boardUnlocked = getAvailableContractBoard(unlocked);
    expect(boardUnlocked.deepUnlocked).toBe(true);
    expect(boardUnlocked.deepLockReason).toBeNull();
    expect(boardUnlocked.deepEntries.every((e) => !e.locked)).toBe(true);
  });

  it('wires recentEquipmentKinds L1-L3 anti-repeat guard in combat and wreck resolution', () => {
    const profile = {
      ...createFreshV2Profile(),
      unlockedFamilies: ['core', 'heavy_kit', 'hangar_kit', 'counter_kit'] as const,
    };
    const launched = launchV2Expedition({
      profile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: buildFreeFallbackPrepareSlots('cannon_skiff', profile.blueprints),
      seed: 31415,
    });
    const run = launched.run!;
    const l1CombatNode = Object.values(run.graph.nodes).find(
      (n) => n.layer === 1 && n.combat
    );
    expect(l1CombatNode).toBeDefined();

    // Seed two consecutive 'laser' awards in recentEquipmentKinds -> L1 combat reward MUST NOT repeat 'laser'
    const entered = selectV2MapNode(
      { ...run, recentEquipmentKinds: ['laser', 'laser'] },
      l1CombatNode!.nodeId
    );
    expect(entered.ok).toBe(true);
    const started = startV2CombatAtCurrentNode(entered.run, 'weakest');
    expect(started.ok).toBe(true);
    const completed = completeV2CombatAtCurrentNode(
      started.run,
      profile.unlockedFamilies
    );
    expect(completed.ok).toBe(true);
    const offeredKind = completed.run.pendingReward!.equipmentOption.definitionId.split(
      '.'
    )[1] as V2EquipmentKind;
    expect(offeredKind).not.toBe('laser');
    expect(completed.run.recentEquipmentKinds[completed.run.recentEquipmentKinds.length - 1]).toBe(
      offeredKind
    );

    // Also verify wreck armory cut at layer <= 3 records kind in recentEquipmentKinds
    const wreckNode = Object.values(run.graph.nodes).find(
      (n) => n.layer <= 3 && n.type === 'wreck' && n.wreck
    );
    expect(wreckNode).toBeDefined();
    const atWreck: V2RunState = {
      ...run,
      currentNodeId: wreckNode!.nodeId,
      phase: 'ENCOUNTER',
    };
    const cut = resolveV2WreckChoice(atWreck, 'armory', profile.unlockedFamilies);
    expect(cut.ok).toBe(true);
    const expectedKind = wreckNode!.wreck!.armoryItem.definitionId.split('.')[1];
    expect(cut.run.recentEquipmentKinds).toContain(expectedKind);

    // Anti-repeat guard MUST also suppress a 3rd consecutive duplicate even when guaranteedSupportKind matches!
    const guaranteedNode = {
      ...l1CombatNode!,
      layer: 2,
      combat: {
        ...l1CombatNode!.combat!,
        guaranteedSupportKind: 'battery' as const,
      },
    };
    const { bundle: antiRepeatBundle } = generateV2CombatRewardBundle(
      run,
      guaranteedNode,
      profile.unlockedFamilies,
      ['battery', 'battery']
    );
    const antiRepeatKind = antiRepeatBundle.equipmentOption.definitionId.split('.')[1];
    expect(antiRepeatKind).not.toBe('battery');

    // Explicit caller recentEquipmentKinds override propagates into next run.recentEquipmentKinds
    const enteredExplicit = selectV2MapNode(
      { ...run, recentEquipmentKinds: [] },
      l1CombatNode!.nodeId
    );
    const startedExplicit = startV2CombatAtCurrentNode(enteredExplicit.run, 'weakest');
    const completedExplicit = completeV2CombatAtCurrentNode(
      startedExplicit.run,
      profile.unlockedFamilies,
      ['shield', 'shield']
    );
    expect(completedExplicit.ok).toBe(true);
    expect(completedExplicit.run.recentEquipmentKinds.slice(0, 2)).toEqual(['shield', 'shield']);
    expect(completedExplicit.run.recentEquipmentKinds[2]).not.toBe('shield');
  });

  it('supports Engineer Swap directly in SHOP phase after buying a merchant equipment offer', () => {
    const profile = {
      ...createFreshV2Profile(),
      unlockedFamilies: ['core', 'heavy_kit'] as const,
    };
    const launched = launchV2Expedition({
      profile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: buildFreeFallbackPrepareSlots('cannon_skiff', profile.blueprints),
      seed: 2026,
    });
    const run = launched.run!;
    const merchantNode = Object.values(run.graph.nodes).find(
      (n) => n.type === 'merchant' && n.merchant && n.merchant.offers.length > 0
    );
    expect(merchantNode).toBeDefined();

    const inShop: V2RunState = {
      ...run,
      currentNodeId: merchantNode!.nodeId,
      phase: 'SHOP',
      wallet: 999,
      engineerSwapAvailable: true,
    };
    const firstOffer = merchantNode!.merchant!.offers[0];
    const bought = buyV2MerchantOffer(
      inShop,
      firstOffer.offerId,
      'tx_test_shop_swap',
      profile.unlockedFamilies
    );
    expect(bought.ok).toBe(true);
    expect(bought.run.phase).toBe('SHOP');
    expect(bought.run.activeEngineerOffer).not.toBeNull();
    expect(bought.run.activeEngineerOffer!.used).toBe(false);

    const swapTargetKind = bought.run.activeEngineerOffer!.candidates[0];
    const swapped = applyV2EngineerSwap(bought.run, swapTargetKind);
    expect(swapped.ok).toBe(true);
    expect(swapped.run.phase).toBe('SHOP');
    expect(swapped.run.activeEngineerOffer!.used).toBe(true);
  });
});

describe('M1 Foundation: F03 Seed Helper, Inspect Snapshot & F04 BGM Tracks', () => {
  it('parses ?seed=<uint32> strictly and derives session run seeds with wrap-around', () => {
    expect(parseDeterministicSeedParam('')).toBeNull();
    expect(parseDeterministicSeedParam('?seed=')).toBeNull();
    expect(parseDeterministicSeedParam('?seed=-1')).toBeNull();
    expect(parseDeterministicSeedParam('?seed=abc')).toBeNull();
    expect(parseDeterministicSeedParam('?seed=12.5')).toBeNull();
    expect(parseDeterministicSeedParam('?seed=NaN')).toBeNull();
    expect(parseDeterministicSeedParam('?seed=123abc')).toBeNull();

    expect(parseDeterministicSeedParam('?seed=0')).toBe(0);
    expect(parseDeterministicSeedParam('?seed=42')).toBe(42);
    expect(parseDeterministicSeedParam('?mode=v2&seed=20261123')).toBe(20261123);
    expect(parseDeterministicSeedParam(`?seed=${MAX_UINT32}`)).toBe(MAX_UINT32);
    expect(parseDeterministicSeedParam('?seed=9999999999')).toBe(MAX_UINT32);

    expect(deriveSessionRunSeed(null, 0)).toBeUndefined();
    expect(deriveSessionRunSeed(42, 0)).toBe(42);
    expect(deriveSessionRunSeed(42, 1)).toBe(43);
    expect(deriveSessionRunSeed(42, 2)).toBe(44);
    expect(deriveSessionRunSeed(MAX_UINT32, 1)).toBe(0);
    expect(deriveSessionRunSeed(42, Number.NaN)).toBe(42);
    expect(deriveSessionRunSeed(42, Number.POSITIVE_INFINITY)).toBe(42);
  });

  it('builds strictly read-only StarlineInspectSnapshot with deep-copied arrays and zero mutator methods', () => {
    const save = createFreshV2SaveData();
    const launched = launchV2Expedition({
      profile: save.profile,
      contractTemplateId: 'transport_std',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: buildFreeFallbackPrepareSlots('cannon_skiff', save.profile.blueprints),
      seed: 8888,
    });
    const failedSource = ['asset_x'];
    const snap = buildV2InspectSnapshot({
      save,
      activeRun: launched.run!,
      screen: 'run',
      phaserScene: 'V2CombatScene',
      bgmTrack: 'expedition',
      liveCombatRound: 2,
      awaitingEliteDecision: false,
      failedAssets: failedSource,
      modalOpen: false,
    });

    expect(snap.mode).toBe('v2');
    expect(snap.schemaVersion).toBe(V2_SCHEMA_VERSION);
    expect(snap.screen).toBe('run');
    expect(snap.phase).toBe('MAP');
    expect(snap.phaserScene).toBe('V2CombatScene');
    expect(snap.bgmTrack).toBe('expedition');
    expect(snap.campaignAct).toBe('prologue');
    expect(snap.activeRun?.seed).toBe(8888);
    expect(snap.activeRun?.sectorId).toBe('near_orbit');
    expect(snap.activeRun?.combatRound).toBeNull();

    // No function/mutator methods anywhere on snapshot
    for (const val of Object.values(snap)) {
      expect(typeof val).not.toBe('function');
    }

    // Mutating returned arrays does NOT affect underlying state
    snap.unlockedSectors.push('stargate_abyss');
    snap.failedAssets.push('mutated');
    expect(save.profile.campaign.unlockedSectors).toEqual(['near_orbit']);
    expect(failedSource).toEqual(['asset_x']);
  });

  it('supports boss BGM track in SoundEngine and resolves V2 BGM track deterministically', () => {
    soundEngine.setTrack('none');
    expect(soundEngine.getCurrentTrack()).toBe('none');
    soundEngine.setTrack('base');
    expect(soundEngine.getCurrentTrack()).toBe('base');
    soundEngine.setTrack('expedition');
    expect(soundEngine.getCurrentTrack()).toBe('expedition');
    soundEngine.setTrack('boss');
    expect(soundEngine.getCurrentTrack()).toBe('boss');
    soundEngine.setTrack('none');
    expect(soundEngine.getCurrentTrack()).toBe('none');

    expect(resolveV2BgmTrack({ titleEntered: false, run: null })).toBe('none');
    expect(resolveV2BgmTrack({ titleEntered: true, run: null })).toBe('base');

    const profile = createFreshV2Profile();
    const run = launchV2Expedition({
      profile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: buildFreeFallbackPrepareSlots('cannon_skiff', profile.blueprints),
      seed: 1001,
    }).run!;
    expect(resolveV2BgmTrack({ titleEntered: true, run })).toBe('expedition');

    const eliteNode = Object.values(run.graph.nodes).find((n) => n.type === 'elite');
    expect(eliteNode).toBeDefined();
    expect(
      resolveV2BgmTrack({
        titleEntered: true,
        run: { ...run, phase: 'ENCOUNTER', currentNodeId: eliteNode!.nodeId },
      })
    ).toBe('boss');
    expect(
      resolveV2BgmTrack({
        titleEntered: true,
        run: { ...run, phase: 'REWARD', currentNodeId: eliteNode!.nodeId },
      })
    ).toBe('expedition');
  });
});
