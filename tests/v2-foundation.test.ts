import { describe, expect, it } from 'vitest';
import { soundEngine } from '../src/audio/soundEngine';
import { createFreshSaveData } from '../src/domain/persistence';
import { V2_CARGO_DEFS } from '../src/v2/data/cargo';
import { V2_EQUIPMENT_DEFS, type V2EquipmentKind } from '../src/v2/data/equipment';
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
import {
  collectVisibleV2DefIdsForRun,
  createV2CargoInstance,
  recordV2SeenItems,
} from '../src/v2/domain/itemCatalog';
import { buildFreeFallbackPrepareSlots, launchV2Expedition } from '../src/v2/domain/loadout';
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
        discoveredItems: ['eq.laser.common', 'cargo.alloy_plate'],
        seenItems: [],
        runHistory: oversizedHistory,
      },
    };
    expect(persistV2SaveData(store, unsyncedSave).ok).toBe(true);
    const persisted = JSON.parse(store.getItem(V2_SAVE_KEY)!);
    expect(persisted.profile.runHistory.length).toBe(V3_MAX_RUN_HISTORY);
    expect(persisted.profile.seenItems).toContain('eq.laser.common');
    expect(persisted.profile.seenItems).toContain('cargo.alloy_plate');
  });
});

describe('M1 Foundation: F04 Codex 31/31, seenItems, Locked Deep Contracts, Anti-Repeat & Shop Engineer Swap', () => {
  it('reaches 31/31 Codex by recording delivered mission items on safe_return and NOT on defeat/abort', () => {
    const totalCodexDefs =
      Object.keys(V2_EQUIPMENT_DEFS).length + Object.keys(V2_CARGO_DEFS).length;
    expect(totalCodexDefs).toBe(31);

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
