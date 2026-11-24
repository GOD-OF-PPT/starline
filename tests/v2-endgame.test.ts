import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/domain/rng';
import { V3_ACHIEVEMENTS, V3_ACHIEVEMENTS_BY_ID } from '../src/v2/data/achievements';
import { V3_BOSS_ORDER } from '../src/v2/data/bosses';
import { CAMPAIGN_COMMS } from '../src/v2/data/campaign';
import {
  V2_REGULAR_ENCOUNTER_KINDS,
  buildEncounterUnits,
  buildSectorEnemyEncounter,
} from '../src/v2/data/enemies';
import { V2_ALL_EQUIPMENT_KINDS } from '../src/v2/data/equipment';
import {
  V2_RELICS,
  V2_RELIC_ORDER,
  V3_STATION_FACILITIES,
  V3_STATION_FACILITY_ORDER,
} from '../src/v2/data/facilities';
import {
  V3_BESTIARY_NOTES,
  V3_ENDINGS,
  V3_ENDING_ORDER,
  V3_LORE_ENTRIES,
  buildDynamicEndingEpilogue,
} from '../src/v2/data/lore';
import {
  MAX_ENDLESS_THREAT,
  V3_ENDLESS_MUTATOR_ORDER,
  aggregateEndlessMutatorEffects,
  describeEndlessThreatScaling,
  getEndlessMutatorCountForThreat,
  rollEndlessMutators,
} from '../src/v2/data/sectors';
import { createV2ShowcaseRun } from '../src/v2/data/showcaseRun';
import {
  claimV3Achievement,
  evaluateV3Achievements,
  getClaimableAchievementCount,
  syncUnlockedAchievements,
} from '../src/v2/domain/achievements';
import {
  getUnlockedCampaignComms,
  isFinalCampaignMissionUnlocked,
  isRunPendingCampaignEnding,
} from '../src/v2/domain/campaign';
import {
  commitV2EliteTacticDecision,
  completeV2CombatAtCurrentNode,
  getEffectiveV2CombatBounty,
  previewV2CombatNode,
  simulateV2Combat,
  startV2CombatAtCurrentNode,
} from '../src/v2/domain/combatV2';
import {
  cutV2WreckHotspot,
  extractV2Wreck,
  finishV2ArrangeAndProceed,
  finishV2MerchantVisit,
  initiateV2SafeReturnFromMap,
  pickV2CombatReward,
  selectV2MapNode,
} from '../src/v2/domain/encounter';
import { evaluateV2EventOption, resolveV2EventOption } from '../src/v2/domain/events';
import {
  addV2ItemToStaging,
  createEmptyV2Bay,
  discardV2Item,
  placeV2FromStaging,
  validateV2Placement,
} from '../src/v2/domain/inventoryV2';
import { createV2EquipmentInstance } from '../src/v2/domain/itemCatalog';
import {
  buildFreeFallbackPrepareSlots,
  launchV2Expedition,
  parseV3CustomSeedInput,
  validateV2PrepareLoadout,
} from '../src/v2/domain/loadout';
import {
  V3_MAX_RUN_HISTORY,
  V3_MAX_SETTLED_RUN_IDS,
  createFreshV2Profile,
  createFreshV2SaveData,
  loadV2SaveData,
  normalizeV2SaveData,
  persistV2SaveData,
  validateV2SaveDataDetailed,
  type V2StorageLike,
} from '../src/v2/domain/persistenceV2';
import { getEffectiveWarehouseCapacity } from '../src/v2/domain/progressionV2';
import {
  applyV2Settlement,
  calculateV2Settlement,
  finalizeClimaxEnding,
} from '../src/v2/domain/settlementV2';
import type {
  EndingId,
  SectorId,
  V2CargoBayState,
  V2ProfileState,
  V2RunState,
  V2TacticalCommandId,
  V3RunBonusObjective,
} from '../src/v2/domain/types';

class MemoryStorage implements V2StorageLike {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

function makeEndgameProfile(overrides: Partial<V2ProfileState> = {}): V2ProfileState {
  const base = createFreshV2Profile();
  return {
    ...base,
    tutorialCompleted: true,
    credits: 2000,
    salvageParts: 400,
    buildings: {
      workbench: true,
      contract_hub: true,
      drydock: true,
      research_lab: true,
      display: true,
      drydock_tier2: true,
    },
    facilityTiers: {
      ...base.facilityTiers,
      workbench: 3,
      contract_hub: 3,
      drydock: 3,
      drydock_tier2: 1,
      research_lab: 3,
      display: 3,
      stargate_relay: 2,
    },
    unlockedShips: ['cannon_skiff', 'shield_cruiser', 'heavy_freighter', 'stargate_cruiser'],
    unlockedCrew: ['engineer', 'navigator', 'salvager'],
    unlockedFamilies: ['core', 'heavy_kit', 'hangar_kit', 'counter_kit'],
    blueprints: [...V2_ALL_EQUIPMENT_KINDS],
    completedContractTypes: ['transport', 'rescue', 'survey', 'bounty', 'derelict'],
    deepestLayerReached: 6,
    relics: {
      ancient_navigator: { storedCount: 0, restored: true },
      cryo_amber: { storedCount: 0, restored: true },
      quantum_core: { storedCount: 0, restored: false },
      obsidian_crown: { storedCount: 0, restored: false },
    },
    campaign: {
      ...base.campaign,
      currentAct: 'act3',
      unlockedSectors: ['near_orbit', 'frozen_graveyard', 'stargate_abyss'],
      completedMilestones: [
        'tutorial_complete',
        'first_contract_complete',
        'research_lab_built',
        'act1_boss_defeated',
        'act2_boss_defeated',
        'stargate_relay_built',
      ],
      defeatedBossIds: ['boss_anvil', 'boss_dreadnought'],
      finalMissionUnlocked: true,
      endlessUnlocked: false,
      maxEndlessThreat: 0,
    },
    ...overrides,
  };
}

function placeEq(
  bay: V2CargoBayState,
  id: string,
  kind: Parameters<typeof createV2EquipmentInstance>[0]['kind'],
  quality: 'common' | 'improved',
  x: number,
  y: number,
  rotation: 0 | 1 | 2 | 3 = 0
): V2CargoBayState {
  const item = createV2EquipmentInstance({
    instanceId: id,
    kind,
    quality,
    origin: 'owned',
    acquiredDepth: 0,
    location: 'staging',
  });
  const staged = addV2ItemToStaging(bay, item, rotation);
  const res = placeV2FromStaging(staged, id, x, y, rotation);
  if (!res.ok) {
    throw new Error(`Failed placing ${id} (${kind}) at (${x},${y}): ${res.reason}`);
  }
  return res.bay;
}

/**
 * Helper: runs a combat node with Active Tactical play (choosing best enabled option by predictedOutcome -> predictedFinalHp)
 * OR Pure-Auto play, returning the final run after combat completion.
 */
function resolveCombatWithPolicy(
  run: V2RunState,
  unlockedFamilies: V2ProfileState['unlockedFamilies'],
  mode: 'tactical' | 'pure_auto',
  opts?: { readonly bonusBossCharges?: number; readonly stargateRelayTier?: number }
): { readonly ok: boolean; readonly run: V2RunState; readonly outcome: 'victory' | 'defeat' } {
  const start = startV2CombatAtCurrentNode(
    run,
    'weakest',
    mode === 'tactical'
      ? {
          enableTacticalCommands: true,
          pureAutoCombat: false,
          bonusBossCharges: opts?.bonusBossCharges ?? 0,
          stargateRelayTier: opts?.stargateRelayTier ?? 0,
        }
      : {
          pureAutoCombat: true,
          bonusBossCharges: opts?.bonusBossCharges ?? 0,
          stargateRelayTier: opts?.stargateRelayTier ?? 0,
        }
  );
  if (!start.ok || !start.run.activeCombat) {
    return { ok: false, run, outcome: 'defeat' };
  }
  let cur = start.run;
  let safety = 0;
  while (
    cur.activeCombat?.pendingDecision &&
    cur.activeCombat.pendingDecision.chosen === null &&
    safety < 5
  ) {
    safety += 1;
    const dec = cur.activeCombat.pendingDecision;
    const enabled = dec.options.filter((o) => o.enabled);
    // Pick option maximizing victory first, then highest predictedFinalHp, then fewest rounds
    const best = [...enabled].sort((a, b) => {
      if (a.predictedOutcome !== b.predictedOutcome) {
        return a.predictedOutcome === 'victory' ? -1 : 1;
      }
      if (a.predictedFinalHp !== b.predictedFinalHp) {
        return b.predictedFinalHp - a.predictedFinalHp;
      }
      return a.predictedRounds - b.predictedRounds;
    })[0];
    const choice: V2TacticalCommandId = best ? best.choice : 'normal';
    const committed = commitV2EliteTacticDecision(cur, dec.decisionId, choice, {
      stargateRelayTier: opts?.stargateRelayTier ?? 0,
    });
    if (!committed.ok) break;
    cur = committed.run;
  }
  const outcome = cur.activeCombat?.simulation.outcome ?? 'defeat';
  const done = completeV2CombatAtCurrentNode(cur, unlockedFamilies);
  return { ok: done.ok, run: done.run, outcome };
}

/**
 * Helper: auto-places staged items into any valid empty grid cell, discarding only if grid is genuinely full.
 */
function autoResolveStaging(run: V2RunState): V2RunState {
  let bay = run.bay;
  let discarded = run.discardedCountThisRun ?? 0;
  while (bay.staging.length > 0) {
    const entry = bay.staging[0];
    let placed = false;
    outer: for (const rot of [0, 1, 2, 3] as const) {
      for (let y = 0; y < 5; y += 1) {
        for (let x = 0; x < 5; x += 1) {
          if (validateV2Placement(bay, entry.item.definitionId, x, y, rot).valid) {
            const r = placeV2FromStaging(bay, entry.item.instanceId, x, y, rot);
            if (r.ok) {
              bay = r.bay;
              placed = true;
              break outer;
            }
          }
        }
      }
    }
    if (!placed) {
      const d = discardV2Item(bay, entry.item.instanceId);
      bay = d.bay;
      discarded += 1;
    }
  }
  return { ...run, bay, discardedCountThisRun: discarded };
}

describe('M6 F17: Act III Climax Mission, L5->L6 Reachability, Reload-Safe Direct Victory & All 3 Endings', () => {
  it('enforces all 4 independent climax unlock gates, launch validation, and 20-seed L5A/L5B -> L6 boss_leviathan reachability', () => {
    const unlocked = makeEndgameProfile({
      campaign: {
        ...makeEndgameProfile().campaign,
        finalMissionUnlocked: false,
      },
    });
    expect(isFinalCampaignMissionUnlocked(unlocked).unlocked).toBe(true);

    // Test each of the 4 checks independently failing!
    // 1. Missing Act I boss
    const noAct1 = makeEndgameProfile({
      campaign: {
        ...unlocked.campaign,
        unlockedSectors: ['near_orbit'],
        defeatedBossIds: ['boss_dreadnought'],
        completedMilestones: ['stargate_relay_built'],
        finalMissionUnlocked: false,
      },
    });
    expect(isFinalCampaignMissionUnlocked(noAct1).unlocked).toBe(false);

    // 2. Missing Act II boss
    const noAct2 = makeEndgameProfile({
      campaign: {
        ...unlocked.campaign,
        unlockedSectors: ['near_orbit', 'frozen_graveyard'],
        defeatedBossIds: ['boss_anvil'],
        completedMilestones: ['stargate_relay_built'],
        finalMissionUnlocked: false,
      },
    });
    expect(isFinalCampaignMissionUnlocked(noAct2).unlocked).toBe(false);

    // 3. Stored-but-unrestored relics do NOT satisfy relics_2!
    const storedOnlyRelics = makeEndgameProfile({
      relics: {
        ancient_navigator: { storedCount: 2, restored: false },
        cryo_amber: { storedCount: 2, restored: false },
        quantum_core: { storedCount: 1, restored: false },
        obsidian_crown: { storedCount: 0, restored: false },
      },
      campaign: { ...unlocked.campaign, finalMissionUnlocked: false },
    });
    expect(isFinalCampaignMissionUnlocked(storedOnlyRelics).unlocked).toBe(false);

    // 4. Missing Stargate Relay
    const noRelay = makeEndgameProfile({
      facilityTiers: { ...unlocked.facilityTiers, stargate_relay: 0 },
      campaign: {
        ...unlocked.campaign,
        completedMilestones: ['act1_boss_defeated', 'act2_boss_defeated'],
        finalMissionUnlocked: false,
      },
    });
    expect(isFinalCampaignMissionUnlocked(noRelay).unlocked).toBe(false);

    // Launch validation guards
    const slots = buildFreeFallbackPrepareSlots('stargate_cruiser', unlocked.blueprints);
    expect(
      validateV2PrepareLoadout(noRelay, 'stargate_cruiser', 'engineer', slots, null, 'stargate_abyss', {
        isFinalCampaignRun: true,
      }).valid
    ).toBe(false);
    expect(
      validateV2PrepareLoadout(unlocked, 'stargate_cruiser', 'engineer', slots, null, 'near_orbit', {
        isFinalCampaignRun: true,
      }).valid
    ).toBe(false);
    expect(
      validateV2PrepareLoadout(
        {
          ...unlocked,
          campaign: { ...unlocked.campaign, endlessUnlocked: true, maxEndlessThreat: 3 },
        },
        'stargate_cruiser',
        'engineer',
        slots,
        null,
        'stargate_abyss',
        {
          isFinalCampaignRun: true,
          endlessThreat: 1,
        }
      ).valid
    ).toBe(false);

    // 20-seed L5A & L5B -> L6 boss_leviathan reachability guarantee!
    for (let s = 0; s < 20; s += 1) {
      const launch = launchV2Expedition({
        profile: unlocked,
        contractTemplateId: 'free_salvage',
        shipId: 'stargate_cruiser',
        crewId: 'engineer',
        primaryArchetype: 'laser',
        slots,
        sectorId: 'stargate_abyss',
        isFinalCampaignRun: true,
        seed: 6100 + s,
      });
      expect(launch.ok && launch.run).toBeTruthy();
      const run = launch.run!;
      expect(run.isFinalCampaignRun).toBe(true);
      expect(run.contract.name).toBe('星门重启远征');
      const l6Nodes = Object.values(run.graph.nodes).filter((n) => n.layer === 6);
      const bossNode = l6Nodes.find((n) => n.bossId === 'boss_leviathan')!;
      expect(bossNode).toBeDefined();
      expect(bossNode.combat!.encounterKind).toBe('boss_leviathan');
      expect(run.graph.nodes['L5A'].nextNodeIds).toContain(bossNode.nodeId);
      expect(run.graph.nodes['L5B'].nextNodeIds).toContain(bossNode.nodeId);
    }
  });

  it('freezes optional bonus objective on direct Act III climax victory (Bug #3), survives save/reload, validates all 3 dynamic epilogues, and commits non-destructively with full-warehouse overflow protection', () => {
    const profile = makeEndgameProfile({
      credits: 500,
      salvageParts: 100,
      factionRep: { starport_guild: 120, deep_institute: 240, free_salvagers: 80 },
    });
    const strongBay = placeEq(
      placeEq(
        placeEq(
          placeEq(createEmptyV2Bay('stargate_cruiser'), 'h1', 'heavy', 'improved', 1, 0),
          'oc1',
          'overdrive_core',
          'improved',
          2,
          0
        ),
        'cv1',
        'coolant_vent',
        'improved',
        0,
        1
      ),
      'sh1',
      'shield',
      'improved',
      4,
      1
    );

    const launch = launchV2Expedition({
      profile,
      contractTemplateId: 'bounty_std',
      shipId: 'stargate_cruiser',
      crewId: 'engineer',
      primaryArchetype: 'heavy',
      slots: [],
      sectorId: 'stargate_abyss',
      isFinalCampaignRun: true,
      seed: 6201,
    });
    const run = launch.run!;
    const bossNode = Object.values(run.graph.nodes).find(
      (n) => n.layer === 6 && n.bossId === 'boss_leviathan'
    )!;
    const highHpBonus: V3RunBonusObjective = {
      id: 'bonus_high_hp',
      label: '安全返航时耐久 >= 60%',
      completed: false,
      rewardCredits: 26,
    };
    const atClimaxBoss: V2RunState = {
      ...run,
      currentNodeId: bossNode.nodeId,
      phase: 'ENCOUNTER',
      bay: strongBay,
      hp: 42,
      maxHp: 42,
      bonusObjective: highHpBonus,
      contract: {
        ...run.contract,
        completedNodeIds: [...run.contract.markedNodeIds],
        bonusObjective: highHpBonus,
      },
    };

    const res = resolveCombatWithPolicy(atClimaxBoss, profile.unlockedFamilies, 'tactical', {
      bonusBossCharges: 0,
      stargateRelayTier: 2,
    });
    expect(res.ok).toBe(true);
    expect(res.outcome).toBe('victory');
    expect(res.run.phase).toBe('SETTLEMENT');
    expect(res.run.settlementReason).toBe('safe_return');
    // Bug #3 fix verified: bonus objective was frozen on direct climax victory!
    expect(res.run.bonusObjective!.completed).toBe(true);
    expect(isRunPendingCampaignEnding(res.run)).toBe(true);

    // Reload-safe persistence right at pending climax ending!
    const storage = new MemoryStorage();
    const pendingSave = { ...createFreshV2SaveData(), profile, activeRun: res.run };
    expect(validateV2SaveDataDetailed(pendingSave).ok).toBe(true);
    expect(persistV2SaveData(storage, pendingSave).ok).toBe(true);
    const loaded = loadV2SaveData(storage);
    expect(loaded.status).toBe('loaded');
    if (loaded.status !== 'loaded') return;
    expect(isRunPendingCampaignEnding(loaded.data.activeRun!)).toBe(true);

    // Dynamic epilogue checks across all 3 endings & gallery replay non-mutation
    expect(V3_ENDING_ORDER).toEqual(['stargate_reignited', 'free_haven', 'fleet_heir']);
    for (const eid of V3_ENDING_ORDER) {
      expect(V3_ENDINGS[eid].id).toBe(eid);
      const epi = buildDynamicEndingEpilogue(eid, profile);
      expect(epi.topFactionId).toBe('deep_institute'); // highest rep = 240
      expect(epi.restoredRelicsCount).toBe(2);
      expect(epi.paragraphs.length).toBeGreaterThanOrEqual(4);
      expect(epi.crewFarewells.length).toBe(3);
    }
    // Tie-breaking toward ending's factionTheme when all reps are equal
    const tiedProfile = makeEndgameProfile({
      factionRep: { starport_guild: 100, deep_institute: 100, free_salvagers: 100 },
    });
    expect(buildDynamicEndingEpilogue('free_haven', tiedProfile).topFactionId).toBe('free_salvagers');
    expect(buildDynamicEndingEpilogue('fleet_heir', tiedProfile).topFactionId).toBe('starport_guild');

    // Full-warehouse overflow protection during finalizeClimaxEnding!
    const cap = getEffectiveWarehouseCapacity(profile);
    const fullWarehouse = Array.from({ length: cap }, (_, i) =>
      createV2EquipmentInstance({
        instanceId: `full_wh_${i}`,
        kind: 'battery',
        quality: 'common',
        origin: 'owned',
        acquiredDepth: 0,
        location: 'warehouse',
      })
    );
    const fullWhProfile: V2ProfileState = {
      ...profile,
      equipmentWarehouse: fullWarehouse,
    };
    const committed1 = finalizeClimaxEnding(fullWhProfile, loaded.data.activeRun!, 'stargate_reignited');
    expect(committed1.ok).toBe(true);
    expect(committed1.profile.equipmentWarehouse.length).toBe(cap); // Overflow cleanly sold, never deadlocked!
    expect(committed1.profile.credits).toBeGreaterThan(fullWhProfile.credits);
    expect(committed1.profile.campaign.currentAct).toBe('endless');
    expect(committed1.profile.campaign.endlessUnlocked).toBe(true);
    expect(committed1.profile.campaign.maxEndlessThreat).toBeGreaterThanOrEqual(1);
    expect(committed1.profile.campaign.endingsUnlocked).toEqual(['stargate_reignited']);

    // Multi-ending collection across 3 distinct climax runs (without duplicates!)
    const run2: V2RunState = { ...loaded.data.activeRun!, runId: 'climax_run_2' };
    const committed2 = finalizeClimaxEnding(committed1.profile, run2, 'free_haven');
    const run3: V2RunState = { ...loaded.data.activeRun!, runId: 'climax_run_3' };
    const committed3 = finalizeClimaxEnding(committed2.profile, run3, 'fleet_heir');
    expect(committed3.profile.campaign.endingsUnlocked).toEqual([
      'stargate_reignited',
      'free_haven',
      'fleet_heir',
    ]);
    // Re-running finalizeClimaxEnding with existing runId & endingId stays strictly idempotent!
    const dupCredits = committed3.profile.credits;
    const dupCall = finalizeClimaxEnding(committed3.profile, run3, 'fleet_heir');
    expect(dupCall.profile.credits).toBe(dupCredits);
    expect(dupCall.profile.campaign.endingsUnlocked.length).toBe(3);

    // Gallery replay (pure read) causes ZERO profile mutation
    const snapshotBefore = JSON.stringify(committed3.profile);
    for (const eid of committed3.profile.campaign.endingsUnlocked) {
      buildDynamicEndingEpilogue(eid as EndingId, committed3.profile);
    }
    expect(JSON.stringify(committed3.profile)).toBe(snapshotBefore);

    // Fix C regression: finalizeClimaxEnding strictly ignores showcase runs without mutating endings/act/endless!
    const showcaseRun = createV2ShowcaseRun('trial_heavy', 'show_climax_guard');
    const showFinalized = finalizeClimaxEnding(profile, showcaseRun, 'stargate_reignited');
    expect(showFinalized.ok).toBe(true);
    expect(showFinalized.profile).toBe(profile);
    expect(showFinalized.newlyUnlockedAchievementIds).toEqual([]);
    expect(showFinalized.profile.campaign.endingsUnlocked).toEqual([]);
    expect(showFinalized.profile.campaign.currentAct).toBe('act3');
    expect(showFinalized.profile.campaign.endlessUnlocked).toBe(false);
  });
});

describe('M6 F18: Endless Abyss (Threat 1-10), All 6 Mutators, Seeded Reproducibility & Threat Advancement', () => {
  it('enforces strict Endless gating, verifies all 6 mutators individually for combat & reward parity, custom seed parsing, and threat advancement vs early retreat', () => {
    expect(MAX_ENDLESS_THREAT).toBe(10);
    expect(V3_ENDLESS_MUTATOR_ORDER).toEqual([
      'ion_surge',
      'armored_hull',
      'overclocked_salvo',
      'aegis_protocol',
      'pierce_barrage',
      'volatile_salvage',
    ]);

    // Mutator counts by threat: 0 (T0), 1 (T1-3), 2 (T4-6), 3 (T7-10)
    expect(getEndlessMutatorCountForThreat(0)).toBe(0);
    for (const t of [1, 2, 3]) expect(getEndlessMutatorCountForThreat(t)).toBe(1);
    for (const t of [4, 5, 6]) expect(getEndlessMutatorCountForThreat(t)).toBe(2);
    for (const t of [7, 8, 9, 10]) expect(getEndlessMutatorCountForThreat(t)).toBe(3);

    // Strict gating in validateV2PrepareLoadout
    const lockedProf = makeEndgameProfile();
    const endlessT1Prof = makeEndgameProfile({
      campaign: {
        ...lockedProf.campaign,
        currentAct: 'endless',
        endlessUnlocked: true,
        maxEndlessThreat: 1,
      },
    });
    const slots = buildFreeFallbackPrepareSlots('stargate_cruiser', lockedProf.blueprints);

    expect(
      validateV2PrepareLoadout(
        lockedProf,
        'stargate_cruiser',
        'engineer',
        slots,
        null,
        'stargate_abyss',
        { endlessThreat: 1 }
      ).valid
    ).toBe(false);
    expect(
      validateV2PrepareLoadout(
        endlessT1Prof,
        'stargate_cruiser',
        'engineer',
        slots,
        null,
        'stargate_abyss',
        { endlessThreat: 1 }
      ).valid
    ).toBe(true);
    // Reject threat > maxEndlessThreat (2 > 1), > 10 (11), non-integer (1.5), negative (-1)
    for (const badThreat of [2, 5, 11, 1.5, -1]) {
      expect(
        validateV2PrepareLoadout(
          endlessT1Prof,
          'stargate_cruiser',
          'engineer',
          slots,
          null,
          'stargate_abyss',
          { endlessThreat: badThreat }
        ).valid
      ).toBe(false);
    }

    // Custom seed parser + byte-identical seeded run reproducibility
    expect(parseV3CustomSeedInput('12345')).toBe(12345);
    expect(parseV3CustomSeedInput('0')).toBe(0);
    expect(parseV3CustomSeedInput('999999999999')).toBe(0xffffffff);
    expect(parseV3CustomSeedInput('')).toBeNull();
    expect(parseV3CustomSeedInput('abc')).toBeNull();
    expect(parseV3CustomSeedInput('-7')).toBeNull();
    expect(parseV3CustomSeedInput('12.5')).toBeNull();

    const endlessT5Prof = makeEndgameProfile({
      campaign: { ...endlessT1Prof.campaign, maxEndlessThreat: 5 },
    });
    const runA = launchV2Expedition({
      profile: endlessT5Prof,
      contractTemplateId: 'free_salvage',
      shipId: 'stargate_cruiser',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots,
      sectorId: 'stargate_abyss',
      endlessThreat: 5,
      seed: 20260808,
    }).run!;
    const runB = launchV2Expedition({
      profile: endlessT5Prof,
      contractTemplateId: 'free_salvage',
      shipId: 'stargate_cruiser',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots,
      sectorId: 'stargate_abyss',
      endlessThreat: 5,
      seed: 20260808,
    }).run!;
    expect(runA.endlessMutatorIds).toEqual(runB.endlessMutatorIds);
    expect(runA.endlessMutatorIds!.length).toBe(2);
    expect(runA.graph.nodes).toEqual(runB.graph.nodes);

    // Individual verification of ALL 6 mutators (combat mechanics + reward bonuses + preview===live parity!)
    const refBay = placeEq(
      placeEq(createEmptyV2Bay('shield_cruiser'), 'l1', 'laser', 'improved', 0, 0),
      's1',
      'shield',
      'improved',
      1,
      0
    );
    const refUnits = buildEncounterUnits('armored', 4, 'mut_ref'); // HP 28, armor 2, dmg 3, pierce 0
    const baseSim = simulateV2Combat({
      resultId: 'mut_base',
      bay: refBay,
      startingHp: 34,
      maxHp: 34,
      units: refUnits,
      targetPolicy: 'weakest',
    });

    // 1. ion_surge: opening shield -2 & even-round shield -1; bounty +15%
    const simIon = simulateV2Combat({
      resultId: 'mut_ion',
      bay: refBay,
      startingHp: 34,
      maxHp: 34,
      units: refUnits,
      targetPolicy: 'weakest',
      endlessMutatorIds: ['ion_surge'],
    });
    expect(simIon.startingPlayerShield).toBe(baseSim.startingPlayerShield - 2);
    expect(aggregateEndlessMutatorEffects(['ion_surge']).bountyMultBonus).toBe(0.15);

    // 2. armored_hull: non-swarm enemy armor +1; bounty +10%, +2 parts/win
    const simArmor = simulateV2Combat({
      resultId: 'mut_arm',
      bay: refBay,
      startingHp: 34,
      maxHp: 34,
      units: refUnits,
      targetPolicy: 'weakest',
      endlessMutatorIds: ['armored_hull'],
    });
    expect(simArmor.initialEnemies[0].armor).toBe(refUnits[0].armor + 1);
    expect(aggregateEndlessMutatorEffects(['armored_hull']).salvagePartsPerWin).toBe(2);

    // 3. overclocked_salvo: enemy attacking dmg +1; bounty +20%
    const simOver = simulateV2Combat({
      resultId: 'mut_over',
      bay: refBay,
      startingHp: 34,
      maxHp: 34,
      units: refUnits,
      targetPolicy: 'weakest',
      endlessMutatorIds: ['overclocked_salvo'],
    });
    expect(simOver.rounds[0].enemyAttacks[0].rawDamage).toBe(
      baseSim.rounds[0].enemyAttacks[0].rawDamage + 1
    );
    expect(aggregateEndlessMutatorEffects(['overclocked_salvo']).bountyMultBonus).toBe(0.2);

    // 4. aegis_protocol: all enemies opening shield +3; bounty +15%
    const simAegis = simulateV2Combat({
      resultId: 'mut_aegis',
      bay: refBay,
      startingHp: 34,
      maxHp: 34,
      units: refUnits,
      targetPolicy: 'weakest',
      endlessMutatorIds: ['aegis_protocol'],
    });
    expect(simAegis.initialEnemies[0].shield).toBe(3);

    // 5. pierce_barrage: enemy pierceRatio +0.15; bounty +10%, +3 parts/win
    const simPierce = simulateV2Combat({
      resultId: 'mut_pierce',
      bay: refBay,
      startingHp: 34,
      maxHp: 34,
      units: refUnits,
      targetPolicy: 'weakest',
      endlessMutatorIds: ['pierce_barrage'],
    });
    expect(simPierce.initialEnemies[0].pierceRatio).toBeCloseTo(0.15, 5);
    expect(aggregateEndlessMutatorEffects(['pierce_barrage']).salvagePartsPerWin).toBe(3);

    // 6. volatile_salvage: enemy maxHp * 1.15; bounty +25%, +2 parts/win
    const simVol = simulateV2Combat({
      resultId: 'mut_vol',
      bay: refBay,
      startingHp: 34,
      maxHp: 34,
      units: refUnits,
      targetPolicy: 'weakest',
      endlessMutatorIds: ['volatile_salvage'],
    });
    expect(simVol.initialEnemies[0].maxHp).toBe(Math.round(refUnits[0].maxHp * 1.15));
    expect(aggregateEndlessMutatorEffects(['volatile_salvage']).bountyMultBonus).toBe(0.25);

    // Preview === Live === Settlement bounty & parts parity with explicit bounty+parts Endless mutators
    // (Preserves runA/runB seed determinism above untouched while ensuring non-zero salvagePartsPerWin coverage!)
    const parityRun = launchV2Expedition({
      profile: endlessT5Prof,
      contractTemplateId: 'free_salvage',
      shipId: 'stargate_cruiser',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots,
      sectorId: 'stargate_abyss',
      endlessThreat: 5,
      endlessMutatorIds: ['pierce_barrage', 'volatile_salvage'],
      seed: 20260808,
    }).run!;
    expect(parityRun.endlessMutatorIds).toEqual(['pierce_barrage', 'volatile_salvage']);
    const combatNode = Object.values(parityRun.graph.nodes).find(
      (n) => n.type === 'combat' && n.combat
    )!;
    const atNode: V2RunState = {
      ...parityRun,
      currentNodeId: combatNode.nodeId,
      phase: 'ENCOUNTER',
      bay: placeEq(
        placeEq(createEmptyV2Bay('stargate_cruiser'), 'h1', 'heavy', 'improved', 1, 0),
        'oc1',
        'overdrive_core',
        'improved',
        2,
        0
      ),
      hp: 42,
      maxHp: 42,
    };
    const prev = previewV2CombatNode(atNode, combatNode.nodeId, 'weakest')!;
    expect(prev.outcome).toBe('victory');
    const live = startV2CombatAtCurrentNode(atNode, 'weakest', { pureAutoCombat: true });
    expect(live.run.activeCombat!.simulation.outcome).toBe(prev.outcome);
    expect(live.run.activeCombat!.simulation.finalPlayerHpAfterRepair).toBe(
      prev.finalPlayerHpAfterRepair
    );
    const doneCombat = completeV2CombatAtCurrentNode(live.run, endlessT5Prof.unlockedFamilies);
    const expectedBounty = getEffectiveV2CombatBounty(atNode, combatNode.combat!.bounty);
    const expectedParts = aggregateEndlessMutatorEffects(atNode.endlessMutatorIds).salvagePartsPerWin;
    expect(expectedBounty).toBeGreaterThan(combatNode.combat!.bounty);
    expect(expectedParts).toBe(5); // pierce_barrage (+3) + volatile_salvage (+2) > 0!
    expect(doneCombat.run.wallet).toBe(atNode.wallet + expectedBounty);
    expect(doneCombat.run.salvagePartsEarned).toBe(expectedParts);

    // Full preview === live === settlement parity for mutator-boosted bounty & salvage parts!
    const endlessSettleRun: V2RunState = {
      ...doneCombat.run,
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
    };
    const endlessSettleSum = calculateV2Settlement(endlessSettleRun, endlessT5Prof);
    expect(endlessSettleSum.walletCredits).toBe(expectedBounty);
    expect(endlessSettleSum.finalCreditsEarned).toBe(expectedBounty);
    expect(endlessSettleSum.runSalvagePartsEarned).toBe(expectedParts);
    expect(endlessSettleSum.totalSalvagePartsEarned).toBe(expectedParts);

    // Endless advancement on clear vs early-retreat non-advancement!
    const earlyRetreatRun: V2RunState = {
      ...runA,
      runId: 'endless_early_retreat',
      endlessThreat: 5,
      visitedNodeIds: ['L1A', 'L2A'],
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
      defeatedBossIdsThisRun: [],
    };
    const afterEarly = applyV2Settlement(endlessT5Prof, earlyRetreatRun);
    expect(afterEarly.profile.career.deepestEndlessCleared).toBe(0);
    expect(afterEarly.profile.campaign.maxEndlessThreat).toBe(5); // Did NOT advance!

    const l6Node = Object.values(runA.graph.nodes).find((n) => n.layer === 6)!;
    const clearRun: V2RunState = {
      ...runA,
      runId: 'endless_clear_t5',
      endlessThreat: 5,
      visitedNodeIds: ['L1A', l6Node.nodeId],
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
    };
    const afterClear = applyV2Settlement(endlessT5Prof, clearRun);
    expect(afterClear.profile.career.deepestEndlessCleared).toBe(5);
    expect(afterClear.profile.campaign.maxEndlessThreat).toBe(6); // Unlocked Threat 6!
  });
});

describe('M6 F18: 30-Run Career Ledger, Bestiary (13), Lore (10 + 15 Comms) & All 18 Achievements', () => {
  it('enforces 30-run ring buffer eviction across 35 runs, validates Bestiary (13), Lore (10 + 15 comms), and verifies ALL 18 achievements + credit-neutral sync + idempotent claim', () => {
    // 1. 35-run sweep on 30-run ring buffer
    let prof = makeEndgameProfile({ totalRuns: 0, runHistory: [], settledRunIds: [] });
    const baseLaunch = launchV2Expedition({
      profile: prof,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: [],
      sectorId: 'near_orbit',
      seed: 6401,
    }).run!;

    for (let i = 1; i <= 35; i += 1) {
      const r: V2RunState = {
        ...baseLaunch,
        runId: `hist_run_${i}`,
        phase: 'SETTLEMENT',
        settlementReason: i % 5 === 0 ? 'defeat' : 'safe_return',
        wallet: 30,
        salvagePartsEarned: 10,
      };
      prof = applyV2Settlement(prof, r).profile;
    }
    expect(prof.totalRuns).toBe(35);
    expect(prof.runHistory.length).toBe(V3_MAX_RUN_HISTORY); // Strictly capped at 30!
    expect(prof.runHistory[0].runId).toBe('hist_run_35'); // Newest at index 0
    expect(prof.runHistory[29].runId).toBe('hist_run_6'); // Oldest 5 evicted (1..5)
    expect(prof.career.totalSafeReturns).toBe(28);
    expect(prof.career.totalDefeats).toBe(7);

    // Fix C regression: settledRunIds strictly capped at V3_MAX_SETTLED_RUN_IDS (100) across 120 runs + normalizeV2SaveData!
    for (let i = 36; i <= 120; i += 1) {
      const r: V2RunState = {
        ...baseLaunch,
        runId: `hist_run_${i}`,
        phase: 'SETTLEMENT',
        settlementReason: 'safe_return',
        wallet: 30,
        salvagePartsEarned: 5,
      };
      prof = applyV2Settlement(prof, r).profile;
    }
    expect(prof.totalRuns).toBe(120);
    expect(prof.runHistory.length).toBe(V3_MAX_RUN_HISTORY);
    expect(prof.settledRunIds.length).toBe(V3_MAX_SETTLED_RUN_IDS);
    expect(prof.settledRunIds[0]).toBe('hist_run_21');
    expect(prof.settledRunIds[V3_MAX_SETTLED_RUN_IDS - 1]).toBe('hist_run_120');
    // Newest run remains strictly idempotent against double-settle
    const dupLatest = applyV2Settlement(prof, {
      ...baseLaunch,
      runId: 'hist_run_120',
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
      wallet: 99,
      salvagePartsEarned: 99,
    });
    expect(dupLatest.profile.totalRuns).toBe(120);
    expect(dupLatest.profile.credits).toBe(prof.credits);
    // normalizeV2SaveData also deduplicates & bounds oversized raw settledRunIds
    const rawOversizedSave = {
      ...createFreshV2SaveData(),
      profile: {
        ...prof,
        settledRunIds: [
          ...Array.from({ length: 130 }, (_, idx) => `raw_s_${idx + 1}`),
          'raw_s_130',
        ],
      },
    };
    const normOversized = normalizeV2SaveData(rawOversizedSave);
    expect(normOversized.profile.settledRunIds.length).toBe(V3_MAX_SETTLED_RUN_IDS);
    expect(normOversized.profile.settledRunIds[0]).toBe('raw_s_31');
    expect(normOversized.profile.settledRunIds[V3_MAX_SETTLED_RUN_IDS - 1]).toBe('raw_s_130');

    // 2. Bestiary (13 entries: 9 regular + elite + 3 Act Bosses) & Lore (10 entries + 15 comms)
    const expectedBestiaryKeys = [...V2_REGULAR_ENCOUNTER_KINDS, 'elite', ...V3_BOSS_ORDER];
    expect(expectedBestiaryKeys.length).toBe(13);
    expect(Object.keys(V3_BESTIARY_NOTES).length).toBe(13);
    for (const k of expectedBestiaryKeys) {
      expect(V3_BESTIARY_NOTES[k]).toBeDefined();
      expect(V3_BESTIARY_NOTES[k].lore.length).toBeGreaterThan(5);
      expect(V3_BESTIARY_NOTES[k].counterTip.length).toBeGreaterThan(5);
    }

    expect(V3_LORE_ENTRIES.length).toBe(10);
    expect(CAMPAIGN_COMMS.length).toBe(15);
    const freshProf = createFreshV2Profile();
    const maxedProf = makeEndgameProfile({
      totalRuns: 10,
      completedContractIds: ['c1', 'c2', 'c3', 'c4', 'c5'],
      completedContractTypes: ['transport', 'rescue', 'survey', 'bounty', 'derelict'],
      crewMastery: { engineer: 2, navigator: 2, salvager: 2 },
      factionRep: { starport_guild: 250, deep_institute: 250, free_salvagers: 250 },
      relics: {
        ancient_navigator: { storedCount: 0, restored: true },
        cryo_amber: { storedCount: 0, restored: true },
        quantum_core: { storedCount: 0, restored: true },
        obsidian_crown: { storedCount: 0, restored: true },
      },
      defeatedEnemyKinds: [...V2_REGULAR_ENCOUNTER_KINDS],
      campaign: {
        ...makeEndgameProfile().campaign,
        currentAct: 'endless',
        defeatedBossIds: ['boss_anvil', 'boss_dreadnought', 'boss_leviathan'],
        endingsUnlocked: ['stargate_reignited', 'free_haven', 'fleet_heir'],
        endlessUnlocked: true,
        maxEndlessThreat: 10,
      },
      career: {
        totalWins: 8,
        totalDefeats: 1,
        totalSafeReturns: 9,
        totalCreditsEarned: 4000,
        totalSalvagePartsEarned: 800,
        totalBossesDefeated: 4,
        totalWrecksDissected: 8,
        totalItemsDismantled: 8,
        deepestEndlessCleared: 10,
      },
      achievementsUnlocked: [],
      achievementsClaimed: [],
    });
    expect(V3_LORE_ENTRIES.filter((l) => l.isUnlocked(maxedProf)).length).toBe(10);
    expect(getUnlockedCampaignComms(maxedProf).length).toBeGreaterThanOrEqual(10);

    // 3. ALL 18 Achievements individually verified (unmet on freshProf -> met on maxedProf)
    expect(V3_ACHIEVEMENTS.length).toBe(18);
    expect(Object.keys(V3_ACHIEVEMENTS_BY_ID).length).toBe(18);
    for (const ach of V3_ACHIEVEMENTS) {
      expect(ach.check(freshProf)).toBe(false);
      expect(ach.check(maxedProf)).toBe(true);
    }

    // Credit-neutral syncUnlockedAchievements & strictly idempotent claimV3Achievement!
    const creditsBeforeSync = maxedProf.credits;
    const partsBeforeSync = maxedProf.salvageParts;
    const synced = syncUnlockedAchievements(maxedProf, []);
    expect(synced.newlyUnlockedIds.length).toBe(18);
    expect(synced.profile.credits).toBe(creditsBeforeSync); // Strictly credit-neutral!
    expect(synced.profile.salvageParts).toBe(partsBeforeSync); // Strictly parts-neutral!
    expect(getClaimableAchievementCount(synced.profile)).toBe(18);
    expect(evaluateV3Achievements(synced.profile).every((s) => s.claimable)).toBe(true);

    // Claiming every achievement once grants exact rewards; 2nd claim fails; unmet/unknown fails!
    let claiming = synced.profile;
    let totalAchCredits = 0;
    let totalAchParts = 0;
    for (const ach of V3_ACHIEVEMENTS) {
      const c = claimV3Achievement(claiming, ach.id);
      expect(c.ok).toBe(true);
      expect(c.rewardCredits).toBe(ach.rewardCredits);
      expect(c.rewardParts).toBe(ach.rewardParts);
      claiming = c.profile;
      totalAchCredits += ach.rewardCredits;
      totalAchParts += ach.rewardParts;
      // Duplicate claim rejected!
      const dup = claimV3Achievement(claiming, ach.id);
      expect(dup.ok).toBe(false);
      expect(dup.rewardCredits).toBe(0);
      expect(dup.rewardParts).toBe(0);
    }
    expect(claiming.credits).toBe(creditsBeforeSync + totalAchCredits);
    expect(claiming.salvageParts).toBe(partsBeforeSync + totalAchParts);
    expect(getClaimableAchievementCount(claiming)).toBe(0);
    expect(claimV3Achievement(freshProf, 'first_expedition').ok).toBe(false);
    expect(claimV3Achievement(claiming, 'nonexistent_ach').ok).toBe(false);
  });
});

describe('M6/M7 Multi-Seed Balance Simulation Matrix (Sectors 1-3, 3 Act Bosses, Bankruptcy, Runway & Endless 1->10)', () => {
  it('Pillar 1: Sectors 1-3 multi-seed expeditions achieve healthy win rates, positive net income, and zero crash/NaN/negative state', () => {
    const profile = makeEndgameProfile();
    const sectorConfigs: ReadonlyArray<{
      readonly sectorId: SectorId;
      readonly shipId: V2CargoBayState['shipId'];
      readonly bay: V2CargoBayState;
      readonly seeds: readonly number[];
    }> = [
      {
        sectorId: 'near_orbit',
        shipId: 'cannon_skiff',
        bay: placeEq(
          placeEq(
            placeEq(createEmptyV2Bay('cannon_skiff'), 'l1', 'laser', 'common', 0, 0),
            'b1',
            'battery',
            'common',
            1,
            0
          ),
          's1',
          'shield',
          'common',
          2,
          0
        ),
        seeds: [7101, 7102, 7103, 7104, 7105, 7106],
      },
      {
        sectorId: 'frozen_graveyard',
        shipId: 'shield_cruiser',
        bay: placeEq(
          placeEq(
            placeEq(
              placeEq(createEmptyV2Bay('shield_cruiser'), 'h1', 'heavy', 'improved', 0, 0),
              'cv1',
              'coolant_vent',
              'improved',
              1,
              0
            ),
            'cap1',
            'capacitor',
            'common',
            1,
            2
          ),
          'sh1',
          'shield',
          'improved',
          2,
          0
        ),
        seeds: [7201, 7202, 7203, 7204, 7205, 7206],
      },
      {
        sectorId: 'stargate_abyss',
        shipId: 'stargate_cruiser',
        bay: placeEq(
          placeEq(
            placeEq(
              placeEq(createEmptyV2Bay('stargate_cruiser'), 'h1', 'heavy', 'improved', 1, 0),
              'oc1',
              'overdrive_core',
              'improved',
              2,
              0
            ),
            'cv1',
            'coolant_vent',
            'improved',
            0,
            1
          ),
          'sh1',
          'shield',
          'improved',
          4,
          1
        ),
        seeds: [7301, 7302, 7303, 7304, 7305, 7306],
      },
    ];

    for (const cfg of sectorConfigs) {
      let safeReturns = 0;
      let totalNetCredits = 0;

      for (const seed of cfg.seeds) {
        const launch = launchV2Expedition({
          profile,
          contractTemplateId: 'free_salvage',
          shipId: cfg.shipId,
          crewId: 'engineer',
          primaryArchetype: 'laser',
          slots: [],
          sectorId: cfg.sectorId,
          seed,
        });
        expect(launch.ok && launch.run).toBeTruthy();
        let run: V2RunState = { ...launch.run!, bay: cfg.bay };

        // Step through up to 6 layers deterministically using Active Tactical play
        let guard = 0;
        while (run.phase !== 'SETTLEMENT' && guard < 40) {
          guard += 1;
          if (run.phase === 'MAP') {
            const curNode = run.currentNodeId ? run.graph.nodes[run.currentNodeId] : null;
            const nextIds = curNode ? curNode.nextNodeIds : ['L1A', 'L1B'].filter((id) => Boolean(run.graph.nodes[id]));
            // Safe return if low HP or low fuel or at max layer
            if (nextIds.length === 0 || run.fuel <= 1 || run.hp <= Math.ceil(run.maxHp * 0.35)) {
              run = initiateV2SafeReturnFromMap(run).run;
              continue;
            }
            const targetId = nextIds[0];
            const entered = selectV2MapNode(run, targetId, { profile });
            if (!entered.ok) {
              run = initiateV2SafeReturnFromMap(run).run;
              continue;
            }
            run = entered.run;
          } else if (run.phase === 'ENCOUNTER') {
            const node = run.graph.nodes[run.currentNodeId!];
            if (node.combat) {
              const res = resolveCombatWithPolicy(run, profile.unlockedFamilies, 'tactical', {
                stargateRelayTier: 2,
              });
              run = res.run;
            } else if (node.type === 'wreck') {
              const cut = cutV2WreckHotspot(run, 'armory', profile.unlockedFamilies, undefined, profile);
              run = cut.ok ? cut.run : run;
              const ext = extractV2Wreck(run);
              run = ext.ok ? ext.run : run;
            } else if (node.type === 'anomaly' || node.type === 'distress') {
              const opts = node.eventState?.options ?? [];
              const enabledOpt = opts.find((o) => evaluateV2EventOption(run, o).enabled);
              const idx = enabledOpt ? enabledOpt.index : Math.max(0, opts.length - 1);
              run = resolveV2EventOption(run, idx, profile.unlockedFamilies).run;
            } else {
              run = initiateV2SafeReturnFromMap(run).run;
            }
          } else if (run.phase === 'SHOP') {
            run = finishV2MerchantVisit(run).run;
          } else if (run.phase === 'REWARD') {
            const rewardChoice = run.hp < run.maxHp - 5 ? 'repair' : 'cargo';
            run = pickV2CombatReward(run, rewardChoice, profile.unlockedFamilies).run;
          } else if (run.phase === 'ARRANGE') {
            run = autoResolveStaging(run);
            const curLayer = run.currentNodeId ? run.graph.nodes[run.currentNodeId]?.layer ?? 1 : 1;
            const dest = curLayer >= run.graph.maxLayers ? 'safe_return' : 'map';
            run = finishV2ArrangeAndProceed(run, dest).run;
          }
        }

        expect(run.phase).toBe('SETTLEMENT');
        const summary = calculateV2Settlement(run, profile);
        expect(Number.isFinite(summary.finalCreditsEarned)).toBe(true);
        expect(summary.finalCreditsEarned).toBeGreaterThanOrEqual(0);
        expect(summary.totalSalvagePartsEarned).toBeGreaterThanOrEqual(0);
        if (summary.reason === 'safe_return') {
          safeReturns += 1;
        }
        totalNetCredits += summary.finalCreditsEarned;
      }

      // Healthy win/safe-return rate & strictly positive net income in EVERY sector!
      expect(safeReturns / cfg.seeds.length).toBeGreaterThanOrEqual(0.8);
      expect(totalNetCredits / cfg.seeds.length).toBeGreaterThan(40);
    }
  });

  it('Pillar 2: All 3 Act Bosses (boss_anvil, boss_dreadnought, boss_leviathan) are genuinely winnable under BOTH Active Tactical AND Pure-Auto, and Tactical >= Pure-Auto survival', () => {
    const profile = makeEndgameProfile();
    const bossScenarios: ReadonlyArray<{
      readonly bossId: 'boss_anvil' | 'boss_dreadnought' | 'boss_leviathan';
      readonly sectorId: SectorId;
      readonly shipId: V2CargoBayState['shipId'];
      readonly hp: number;
      readonly bay: V2CargoBayState;
    }> = [
      {
        bossId: 'boss_anvil',
        sectorId: 'near_orbit',
        shipId: 'cannon_skiff',
        hp: 30,
        bay: placeEq(
          placeEq(
            placeEq(
              placeEq(createEmptyV2Bay('cannon_skiff'), 'l1', 'laser', 'common', 0, 0),
              'b1',
              'battery',
              'common',
              1,
              0
            ),
            'l2',
            'laser',
            'common',
            2,
            0
          ),
          's1',
          'shield',
          'common',
          3,
          0
        ),
      },
      {
        bossId: 'boss_dreadnought',
        sectorId: 'frozen_graveyard',
        shipId: 'shield_cruiser',
        hp: 34,
        bay: placeEq(
          placeEq(
            placeEq(
              placeEq(createEmptyV2Bay('shield_cruiser'), 'h1', 'heavy', 'improved', 0, 0),
              'cv1',
              'coolant_vent',
              'improved',
              1,
              0
            ),
            's1',
            'shield',
            'improved',
            2,
            0
          ),
          'ej1',
          'emp_jammer',
          'improved',
          3,
          0
        ),
      },
      {
        bossId: 'boss_leviathan',
        sectorId: 'stargate_abyss',
        shipId: 'stargate_cruiser',
        hp: 42,
        bay: placeEq(
          placeEq(
            placeEq(
              placeEq(createEmptyV2Bay('stargate_cruiser'), 'h1', 'heavy', 'improved', 1, 0),
              'oc1',
              'overdrive_core',
              'improved',
              2,
              0
            ),
            'cv1',
            'coolant_vent',
            'improved',
            0,
            1
          ),
          'sh1',
          'shield',
          'improved',
          4,
          1
        ),
      },
    ];

    for (let idx = 0; idx < bossScenarios.length; idx += 1) {
      const sc = bossScenarios[idx];
      const launch = launchV2Expedition({
        profile,
        contractTemplateId: 'free_salvage',
        shipId: sc.shipId,
        crewId: 'engineer',
        primaryArchetype: 'laser',
        slots: [],
        sectorId: sc.sectorId,
        seed: 7400 + idx,
      });
      const run = launch.run!;
      const bossNode = Object.values(run.graph.nodes).find(
        (n) => n.layer === 6 && n.bossId === sc.bossId
      )!;
      expect(bossNode).toBeDefined();

      const atBoss: V2RunState = {
        ...run,
        currentNodeId: bossNode.nodeId,
        phase: 'ENCOUNTER',
        bay: sc.bay,
        hp: sc.hp,
        maxHp: sc.hp,
        tacticalChargesMax: 2,
        tacticalChargesUsed: 0,
      };

      // Progression-accurate relay tier: stargate_relay is an Act III facility (unavailable during Act I & Act II!)
      const relayTier = sc.bossId === 'boss_leviathan' ? 2 : 0;
      const autoRes = resolveCombatWithPolicy(atBoss, profile.unlockedFamilies, 'pure_auto', {
        stargateRelayTier: relayTier,
      });
      const tacRes = resolveCombatWithPolicy(atBoss, profile.unlockedFamilies, 'tactical', {
        stargateRelayTier: relayTier,
      });

      expect(autoRes.outcome).toBe('victory');
      expect(tacRes.outcome).toBe('victory');
      // Active Tactical must match or beat Pure-Auto final surviving HP!
      expect(tacRes.run.hp).toBeGreaterThanOrEqual(autoRes.run.hp);
    }
  });

  it('Pillar 3 & 4: Guarantees 0-credit bankruptcy recovery (free fallback + 40% defeat recovery) and validates economy progression runway (5,960 credits + 795 parts)', () => {
    // Bankruptcy profile: 0 credits, 0 salvageParts, empty warehouse
    const broke = createFreshV2Profile();
    expect(broke.credits).toBe(0);
    expect(broke.salvageParts).toBe(0);

    const freeSlots = buildFreeFallbackPrepareSlots('cannon_skiff', broke.blueprints);
    expect(freeSlots.length).toBeGreaterThanOrEqual(2);
    const checkFree = validateV2PrepareLoadout(
      broke,
      'cannon_skiff',
      'engineer',
      freeSlots,
      null,
      'near_orbit'
    );
    expect(checkFree.valid).toBe(true);

    const launched = launchV2Expedition({
      profile: broke,
      contractTemplateId: 'transport_std',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: freeSlots,
      sectorId: 'near_orbit',
      seed: 7501,
    });
    expect(launched.ok && launched.run).toBeTruthy();

    // Defeat recovery guarantees 40% credit & 40% parts recovery (zero softlock!)
    const defeatedRun: V2RunState = {
      ...launched.run!,
      phase: 'SETTLEMENT',
      settlementReason: 'defeat',
      hp: 0,
      wallet: 25,
      salvagePartsEarned: 15,
    };
    const defeatSum = calculateV2Settlement(defeatedRun, broke);
    expect(defeatSum.finalCreditsEarned).toBe(Math.floor(25 * 0.4)); // 10 credits recovered!
    expect(defeatSum.totalSalvagePartsEarned).toBe(Math.floor(15 * 0.4)); // 6 parts recovered!
    const afterDefeat = applyV2Settlement(broke, defeatedRun).profile;
    expect(afterDefeat.credits).toBe(10);
    expect(afterDefeat.salvageParts).toBe(6);

    // Comeback run from 10 credits launches for free and earns substantial positive income!
    const comeback = launchV2Expedition({
      profile: afterDefeat,
      contractTemplateId: 'transport_std',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: buildFreeFallbackPrepareSlots('cannon_skiff', afterDefeat.blueprints),
      sectorId: 'near_orbit',
      seed: 7502,
    });
    expect(comeback.ok).toBe(true);

    // Economy runway math: total sinks = 5,960 credits + 795 parts (reachable within realistic ~25-40 runs across Act I-III + Endless!)
    let totalSinkCredits = V2_RELIC_ORDER.reduce((s, r) => s + V2_RELICS[r].restoreCost, 0);
    let totalSinkParts = 0;
    for (const fid of V3_STATION_FACILITY_ORDER) {
      for (const t of V3_STATION_FACILITIES[fid].tiers) {
        totalSinkCredits += t.creditCost;
        totalSinkParts += t.partsCost;
      }
    }
    expect(totalSinkCredits).toBe(5960);
    expect(totalSinkParts).toBe(795);

    // Pillar 4 Economy Runway: measure REAL simulated formal contract + combat + wreck + salvage run earnings via calculateV2Settlement
    const runwayProf = makeEndgameProfile({
      facilityTiers: {
        ...makeEndgameProfile().facilityTiers,
        workbench: 2,
        contract_hub: 2,
        drydock: 2,
        research_lab: 2,
        display: 2,
        stargate_relay: 1,
      },
      factionRep: { starport_guild: 120, deep_institute: 150, free_salvagers: 150 },
    });
    const runwayScenarios: ReadonlyArray<{
      readonly contractTemplateId: 'transport_deep' | 'bounty_std' | 'derelict_std';
      readonly sectorId: SectorId;
      readonly shipId: V2CargoBayState['shipId'];
      readonly seed: number;
    }> = [
      { contractTemplateId: 'transport_deep', sectorId: 'frozen_graveyard', shipId: 'heavy_freighter', seed: 7601 },
      { contractTemplateId: 'bounty_std', sectorId: 'near_orbit', shipId: 'shield_cruiser', seed: 7602 },
      { contractTemplateId: 'derelict_std', sectorId: 'near_orbit', shipId: 'shield_cruiser', seed: 7603 },
      { contractTemplateId: 'transport_deep', sectorId: 'stargate_abyss', shipId: 'stargate_cruiser', seed: 7604 },
      { contractTemplateId: 'bounty_std', sectorId: 'frozen_graveyard', shipId: 'shield_cruiser', seed: 7605 },
      { contractTemplateId: 'derelict_std', sectorId: 'stargate_abyss', shipId: 'stargate_cruiser', seed: 7606 },
    ];
    let totalSimCredits = 0;
    let totalSimParts = 0;
    let completedSimRuns = 0;

    for (const sc of runwayScenarios) {
      const simLaunch = launchV2Expedition({
        profile: runwayProf,
        contractTemplateId: sc.contractTemplateId,
        shipId: sc.shipId,
        crewId: 'salvager',
        primaryArchetype: 'heavy',
        slots: buildFreeFallbackPrepareSlots(sc.shipId, runwayProf.blueprints),
        sectorId: sc.sectorId,
        seed: sc.seed,
      });
      expect(simLaunch.ok && simLaunch.run).toBeTruthy();
      let r = simLaunch.run!;
      let steps = 0;
      while (r.phase !== 'SETTLEMENT' && steps < 40) {
        steps += 1;
        if (r.phase === 'MAP') {
          const curNode = r.currentNodeId ? r.graph.nodes[r.currentNodeId] : null;
          const nextIds = curNode
            ? curNode.nextNodeIds
            : r.graph.startNextNodeIds.filter((id) => Boolean(r.graph.nodes[id]));
          if (nextIds.length === 0 || r.fuel <= 1 || r.hp <= Math.ceil(r.maxHp * 0.35)) {
            r = initiateV2SafeReturnFromMap(r).run;
            continue;
          }
          // Prefer marked contract node or wreck/combat node to progress contract & earn loot/parts
          const preferred =
            nextIds.find((nid) => r.contract.markedNodeIds.includes(nid)) ??
            nextIds.find((nid) => r.graph.nodes[nid]?.type === 'wreck') ??
            nextIds[0];
          const entered = selectV2MapNode(r, preferred, { profile: runwayProf });
          if (!entered.ok) {
            r = initiateV2SafeReturnFromMap(r).run;
            continue;
          }
          r = entered.run;
        } else if (r.phase === 'ENCOUNTER') {
          const node = r.graph.nodes[r.currentNodeId!];
          if (node.combat) {
            r = resolveCombatWithPolicy(r, runwayProf.unlockedFamilies, 'tactical', {
              stargateRelayTier: 1,
            }).run;
          } else if (node.type === 'wreck') {
            const cut1 = cutV2WreckHotspot(r, 'armory', runwayProf.unlockedFamilies, undefined, runwayProf);
            r = cut1.ok ? cut1.run : r;
            const ext = extractV2Wreck(r);
            r = ext.ok ? ext.run : r;
          } else if (node.type === 'anomaly' || node.type === 'distress') {
            const opts = node.eventState?.options ?? [];
            const enabledOpt = opts.find((o) => evaluateV2EventOption(r, o).enabled);
            r = resolveV2EventOption(
              r,
              enabledOpt ? enabledOpt.index : Math.max(0, opts.length - 1),
              runwayProf.unlockedFamilies
            ).run;
          } else {
            r = initiateV2SafeReturnFromMap(r).run;
          }
        } else if (r.phase === 'SHOP') {
          r = finishV2MerchantVisit(r).run;
        } else if (r.phase === 'REWARD') {
          const choice = r.hp < r.maxHp - 6 ? 'repair' : 'cargo';
          r = pickV2CombatReward(r, choice, runwayProf.unlockedFamilies).run;
        } else if (r.phase === 'ARRANGE') {
          r = autoResolveStaging(r);
          const curLayer = r.currentNodeId ? r.graph.nodes[r.currentNodeId]?.layer ?? 1 : 1;
          r = finishV2ArrangeAndProceed(r, curLayer >= r.graph.maxLayers ? 'safe_return' : 'map').run;
        }
      }
      expect(r.phase).toBe('SETTLEMENT');
      const creditSummary = calculateV2Settlement(r, runwayProf);
      // Measure parts yield when player chooses to dismantle loot items at settlement
      const dismantleOverrides: Record<string, 'dismantle'> = {};
      for (const line of creditSummary.lines) {
        if (line.item.origin === 'loot' && line.allowedDispositions.includes('dismantle')) {
          dismantleOverrides[line.item.instanceId] = 'dismantle';
        }
      }
      const partsSummary = calculateV2Settlement(r, runwayProf, dismantleOverrides);
      totalSimCredits += creditSummary.finalCreditsEarned;
      totalSimParts += partsSummary.totalSalvagePartsEarned;
      if (creditSummary.reason === 'safe_return') completedSimRuns += 1;
    }

    expect(completedSimRuns).toBeGreaterThanOrEqual(4);
    const simulatedRunCredits = totalSimCredits / runwayScenarios.length;
    const simulatedRunParts = totalSimParts / runwayScenarios.length;
    expect(simulatedRunCredits).toBeGreaterThan(0);
    expect(simulatedRunParts).toBeGreaterThan(0);
    const creditRunwayRuns = totalSinkCredits / simulatedRunCredits;
    const partsRunwayRuns = totalSinkParts / simulatedRunParts;
    expect(creditRunwayRuns).toBeGreaterThanOrEqual(10);
    expect(creditRunwayRuns).toBeLessThanOrEqual(45);
    expect(partsRunwayRuns).toBeGreaterThanOrEqual(10);
    expect(partsRunwayRuns).toBeLessThanOrEqual(45);
  });

  it('Pillar 5: Verifies strictly monotonic Endless Threat 1 -> 10 scaling across stats, bounties, mutator counts, and live combat pressure', () => {
    const refBay = placeEq(
      placeEq(
        placeEq(
          placeEq(createEmptyV2Bay('stargate_cruiser'), 'h1', 'heavy', 'improved', 1, 0),
          'oc1',
          'overdrive_core',
          'improved',
          2,
          0
        ),
        'cv1',
        'coolant_vent',
        'improved',
        0,
        1
      ),
      'sh1',
      'shield',
      'improved',
      4,
      1
    );

    let prevHp = 0;
    let prevDmg = 0;
    let prevBounty = 0;
    let prevMutCount = 0;
    const hpLostByThreat: Record<number, number> = {};

    for (let threat = 1; threat <= MAX_ENDLESS_THREAT; threat += 1) {
      const desc = describeEndlessThreatScaling(threat);
      expect(desc.threat).toBe(threat);
      expect(desc.hpBonusPct).toBe(threat * 10);
      expect(desc.dmgAdd).toBe(Math.floor(threat / 3));
      expect(desc.bountyBonusPct).toBe(threat * 12);
      expect(desc.mutatorCount).toBeGreaterThanOrEqual(prevMutCount);
      prevMutCount = desc.mutatorCount;

      const enc = buildSectorEnemyEncounter(
        'stargate_abyss',
        6,
        'elite',
        new SeededRng(8000 + threat),
        threat
      );
      const bossUnit = enc.units[0];
      expect(bossUnit.maxHp).toBeGreaterThan(prevHp);
      expect(bossUnit.damagePerRound).toBeGreaterThanOrEqual(prevDmg);
      expect(enc.bounty).toBeGreaterThan(prevBounty);
      prevHp = bossUnit.maxHp;
      prevDmg = bossUnit.damagePerRound;
      prevBounty = enc.bounty;

      // Measure actual combat pressure with deterministic mutators across 3 seeds
      let totalLost = 0;
      for (const seedOffset of [11, 22, 33]) {
        const muts = rollEndlessMutators(8100 + seedOffset, threat);
        expect(muts.length).toBe(desc.mutatorCount);
        const sim = simulateV2Combat({
          resultId: `endless_scale_${threat}_${seedOffset}`,
          bay: refBay,
          startingHp: 100,
          maxHp: 100,
          units: enc.units,
          targetPolicy: 'highest_threat',
          sectorId: 'stargate_abyss',
          encounterKind: enc.encounterKind,
          bossId: enc.bossId,
          endlessThreat: threat,
          endlessMutatorIds: muts,
        });
        totalLost += 100 - sim.finalPlayerHp;
      }
      hpLostByThreat[threat] = totalLost / 3;
    }

    // Combat pressure scales monotonically upward from Threat 1 -> Threat 5 -> Threat 10!
    expect(hpLostByThreat[5]).toBeGreaterThan(hpLostByThreat[1]);
    expect(hpLostByThreat[10]).toBeGreaterThan(hpLostByThreat[5]);
  });
});
