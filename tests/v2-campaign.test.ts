import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/domain/rng';
import {
  CAMPAIGN_CHAPTERS,
  CAMPAIGN_COMMS,
  RELIC_PITY_THRESHOLD,
} from '../src/v2/data/campaign';
import { V2_CONTRACT_TEMPLATES } from '../src/v2/data/contracts';
import { V2_CREW, V2_CREW_ORDER } from '../src/v2/data/crew';
import {
  buildEncounterUnits,
  buildSectorEnemyEncounter,
  getV2EncounterTemplate,
} from '../src/v2/data/enemies';
import {
  V2_MAX_BATTLE_SHIELD,
  V2_MAX_POST_WIN_REPAIR,
} from '../src/v2/data/equipment';
import { drawSectorEventPayload } from '../src/v2/data/events';
import { V3_SECTORS, V3_SECTOR_ORDER, getV3SectorDef } from '../src/v2/data/sectors';
import { createV2ShowcaseRun } from '../src/v2/data/showcaseRun';
import { createV2TutorialRun } from '../src/v2/data/tutorialV2';
import {
  advanceCampaignAfterRun,
  getActiveCampaignObjective,
  getTriggeredCommForContext,
  getUnlockedCampaignComms,
  getUnreadCampaignCommsCount,
  hasCampaignMilestone,
  isFinalCampaignMissionUnlocked,
  markCampaignCommRead,
  markCampaignCommsRead,
  previewSettlementCampaignOutcomes,
  shouldTriggerRelicPitySignal,
  syncCampaignProgress,
} from '../src/v2/domain/campaign';
import {
  completeV2CombatAtCurrentNode,
  getEffectiveV2CombatBounty,
  previewV2CombatNode,
  simulateV2Combat,
  startV2CombatAtCurrentNode,
} from '../src/v2/domain/combatV2';
import { createV2ContractInstance } from '../src/v2/domain/contracts';
import {
  applyV2EngineerSwap,
  generateV2CombatRewardBundle,
  maybeCreateEngineerSwapOffer,
  resolveV2WreckChoice,
} from '../src/v2/domain/encounter';
import {
  createV2CargoInstance,
  createV2EquipmentInstance,
} from '../src/v2/domain/itemCatalog';
import {
  buildFreeFallbackPrepareSlots,
  launchV2Expedition,
  validateV2PrepareLoadout,
} from '../src/v2/domain/loadout';
import {
  createFreshV2Profile,
  createFreshV2SaveData,
  normalizeV2SaveData,
  validateV2SaveDataDetailed,
} from '../src/v2/domain/persistenceV2';
import { purchaseV2Facility, restoreV2Relic } from '../src/v2/domain/progressionV2';
import { createV2RngStreams } from '../src/v2/domain/rngStreams';
import {
  generateV2StarGraph,
  verifyV2GraphInvariants,
} from '../src/v2/domain/routeGenerator';
import {
  applyV2Settlement,
  calculateV2Settlement,
  getDefaultDispositionForItem,
} from '../src/v2/domain/settlementV2';
import { computeV2PlacementTacticalDelta } from '../src/v2/domain/tacticalDelta';
import {
  V2_MAX_FUEL,
  V2_STARTING_FUEL,
  type SectorId,
  type V2CargoBayState,
  type V2MapNode,
  type V2ProfileState,
  type V2RunState,
} from '../src/v2/domain/types';
import { crewPortraitSvg } from '../src/v2/ui/icons';
import { resolveV2BgmTrack } from '../src/v2/ui/v2AudioTrack';

function makeUnlockedAllProfile(overrides: Partial<V2ProfileState> = {}): V2ProfileState {
  const base = createFreshV2Profile();
  return {
    ...base,
    credits: 500,
    tutorialCompleted: true,
    buildings: {
      workbench: true,
      contract_hub: true,
      drydock: true,
      drydock_tier2: true,
      research_lab: true,
      display: true,
    },
    facilityTiers: {
      ...base.facilityTiers,
      workbench: 1,
      contract_hub: 1,
      drydock: 2,
      drydock_tier2: 1,
      research_lab: 1,
      display: 1,
    },
    unlockedShips: ['cannon_skiff', 'shield_cruiser', 'heavy_freighter'],
    unlockedCrew: ['engineer', 'navigator', 'salvager'],
    unlockedFamilies: ['core', 'heavy_kit', 'hangar_kit', 'counter_kit'],
    blueprints: [
      'laser',
      'battery',
      'shield',
      'repair',
      'heavy',
      'capacitor',
      'hangar',
      'relay',
      'counter',
      'flak',
    ],
    campaign: {
      ...base.campaign,
      currentAct: 'act1',
      unlockedSectors: ['near_orbit'],
      completedMilestones: ['tutorial_complete'],
    },
    ...overrides,
  };
}

function makeSimpleTestBay(
  items: { kind: Parameters<typeof createV2EquipmentInstance>[0]['kind']; x: number; y: number; quality?: 'common' | 'improved' }[]
): V2CargoBayState {
  return {
    shipId: 'cannon_skiff',
    placed: items.map((it, idx) => ({
      item: createV2EquipmentInstance({
        instanceId: `test_eq_${idx + 1}`,
        kind: it.kind,
        quality: it.quality ?? 'common',
        origin: 'loan',
        acquiredDepth: 0,
        location: 'bay',
      }),
      x: it.x,
      y: it.y,
      rotation: 0,
    })),
    staging: [],
    discardedThisArrange: [],
  };
}

describe('M2 Mainline Campaign (F05): 4-Act progression, Boss unlocks, Final Mission Gate & Monotonic Sync', () => {
  it('advances Prologue -> Act I on tutorial settlement and preserves idempotency', () => {
    const profile = createFreshV2Profile();
    expect(profile.campaign.currentAct).toBe('prologue');
    expect(profile.campaign.unlockedSectors).toEqual(['near_orbit']);

    const tutRun: V2RunState = {
      ...createV2TutorialRun('tut_m2_001'),
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
      visitedNodeIds: ['L1A', 'L2A', 'L3A'],
    };

    const settled = applyV2Settlement(profile, tutRun);
    expect(settled.ok).toBe(true);
    expect(settled.profile.tutorialCompleted).toBe(true);
    expect(settled.profile.campaign.currentAct).toBe('act1');
    expect(settled.actTransition).toEqual({ from: 'prologue', to: 'act1' });
    expect(hasCampaignMilestone(settled.profile.campaign, 'tutorial_complete')).toBe(true);
    expect(hasCampaignMilestone(settled.profile.campaign, 'prologue_complete')).toBe(true);

    // Duplicate settlement is strictly idempotent
    const dup = applyV2Settlement(settled.profile, tutRun);
    expect(dup.ok).toBe(true);
    expect(dup.profile).toBe(settled.profile);
  });

  it('unlocks Sector 2 (frozen_graveyard) + Act II after defeating boss_anvil, and Sector 3 (stargate_abyss) + Act III after boss_dreadnought', () => {
    const pAct1 = makeUnlockedAllProfile();
    const slots = buildFreeFallbackPrepareSlots('cannon_skiff', pAct1.blueprints);
    const launch1 = launchV2Expedition({
      profile: pAct1,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots,
      sectorId: 'near_orbit',
      seed: 10101,
    });
    expect(launch1.ok && launch1.run).toBeTruthy();

    // Find Layer 6 elite/boss node and simulate defeating boss_anvil
    const run1 = launch1.run!;
    const bossNode1 = Object.values(run1.graph.nodes).find(
      (n) => n.layer === 6 && n.type === 'elite'
    )!;
    expect(bossNode1.bossId).toBe('boss_anvil');
    expect(bossNode1.combat?.bossId).toBe('boss_anvil');
    expect(bossNode1.combat?.encounterKind).toBe('boss_anvil');

    const run1AfterBoss: V2RunState = {
      ...run1,
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
      visitedNodeIds: ['L1A', 'L2A', 'L3A', 'L4A', 'L5A', bossNode1.nodeId],
      claimedEventIds: [`combat_done_${bossNode1.nodeId}`],
      defeatedBossIdsThisRun: ['boss_anvil'],
      defeatedEnemyKindsThisRun: ['patrol', 'boss_anvil'],
    };

    const res1 = applyV2Settlement(launch1.profile, run1AfterBoss);
    expect(res1.ok).toBe(true);
    expect(res1.profile.campaign.currentAct).toBe('act2');
    expect(res1.profile.campaign.unlockedSectors).toEqual(['near_orbit', 'frozen_graveyard']);
    expect(res1.profile.campaign.defeatedBossIds).toContain('boss_anvil');
    expect(res1.profile.career.totalBossesDefeated).toBe(1);
    expect(res1.profile.defeatedEnemyKinds).toContain('boss_anvil');
    expect(res1.actTransition).toEqual({ from: 'act1', to: 'act2' });
    expect(res1.newlyUnlockedSectors).toEqual(['frozen_graveyard']);

    // Now launch into Sector 2 (frozen_graveyard) and defeat boss_dreadnought
    const launch2 = launchV2Expedition({
      profile: res1.profile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots,
      sectorId: 'frozen_graveyard',
      seed: 20202,
    });
    expect(launch2.ok && launch2.run).toBeTruthy();
    const run2 = launch2.run!;
    const bossNode2 = Object.values(run2.graph.nodes).find(
      (n) => n.layer === 6 && n.type === 'elite'
    )!;
    expect(bossNode2.bossId).toBe('boss_dreadnought');

    const run2AfterBoss: V2RunState = {
      ...run2,
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
      visitedNodeIds: ['L1A', 'L2A', 'L3A', 'L4A', 'L5A', bossNode2.nodeId],
      claimedEventIds: [`combat_done_${bossNode2.nodeId}`],
      defeatedBossIdsThisRun: ['boss_dreadnought'],
      defeatedEnemyKindsThisRun: ['boss_dreadnought'],
    };

    const res2 = applyV2Settlement(launch2.profile, run2AfterBoss);
    expect(res2.ok).toBe(true);
    expect(res2.profile.campaign.currentAct).toBe('act3');
    expect(res2.profile.campaign.unlockedSectors).toEqual([
      'near_orbit',
      'frozen_graveyard',
      'stargate_abyss',
    ]);
    expect(res2.profile.campaign.defeatedBossIds).toContain('boss_dreadnought');
    expect(res2.profile.career.totalBossesDefeated).toBe(2);
    expect(res2.newlyUnlockedSectors).toEqual(['stargate_abyss']);
  });

  it('does NOT credit boss defeat or unlock next sector when player loses to the boss', () => {
    const pAct1 = makeUnlockedAllProfile();
    const slots = buildFreeFallbackPrepareSlots('cannon_skiff', pAct1.blueprints);
    const launch = launchV2Expedition({
      profile: pAct1,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots,
      sectorId: 'near_orbit',
      seed: 30303,
    });
    const run = launch.run!;
    const bossNode = Object.values(run.graph.nodes).find(
      (n) => n.layer === 6 && n.type === 'elite'
    )!;

    // Defeat on the boss node (node.resolved === false, currentNodeId === bossNode.nodeId)
    const defeatedRun: V2RunState = {
      ...run,
      hp: 0,
      currentNodeId: bossNode.nodeId,
      phase: 'SETTLEMENT',
      settlementReason: 'defeat',
      claimedEventIds: [`combat_done_${bossNode.nodeId}`],
      defeatedBossIdsThisRun: [],
    };
    const res = applyV2Settlement(launch.profile, defeatedRun);
    expect(res.ok).toBe(true);
    expect(res.profile.campaign.defeatedBossIds).not.toContain('boss_anvil');
    expect(res.profile.campaign.unlockedSectors).toEqual(['near_orbit']);
    expect(res.profile.campaign.currentAct).toBe('act1');
  });

  it('enforces Act III Final Mission Gate prerequisites and syncs monotonically on facility/relic progress', () => {
    const pAct2 = makeUnlockedAllProfile({
      campaign: {
        ...createFreshV2Profile().campaign,
        currentAct: 'act2',
        unlockedSectors: ['near_orbit', 'frozen_graveyard'],
        completedMilestones: ['tutorial_complete', 'act1_boss_defeated'],
        defeatedBossIds: ['boss_anvil'],
      },
      relics: {
        ancient_navigator: { storedCount: 1, restored: false },
        cryo_amber: { storedCount: 1, restored: false },
        quantum_core: { storedCount: 0, restored: false },
        obsidian_crown: { storedCount: 0, restored: false },
      },
    });

    const lockedGate = isFinalCampaignMissionUnlocked(pAct2);
    expect(lockedGate.unlocked).toBe(false);
    expect(lockedGate.unmetReasons.length).toBeGreaterThanOrEqual(3);

    // Restore 2 relics via progressionV2 -> immediately records relic_restored_2
    const r1 = restoreV2Relic(pAct2, 'ancient_navigator');
    expect(r1.ok).toBe(true);
    const r2 = restoreV2Relic(r1.profile, 'cryo_amber');
    expect(r2.ok).toBe(true);
    expect(hasCampaignMilestone(r2.profile.campaign, 'relic_restored_2')).toBe(true);

    // Still locked without Act II boss + stargate_relay
    expect(isFinalCampaignMissionUnlocked(r2.profile).unlocked).toBe(false);

    // Fulfill Act II boss + stargate_relay -> unlocks Final Mission!
    const readyProfile: V2ProfileState = {
      ...r2.profile,
      facilityTiers: { ...r2.profile.facilityTiers, stargate_relay: 1 },
      campaign: {
        ...r2.profile.campaign,
        defeatedBossIds: ['boss_anvil', 'boss_dreadnought'],
      },
    };
    const synced = syncCampaignProgress(readyProfile);
    expect(synced.profile.campaign.currentAct).toBe('act3');
    expect(synced.profile.campaign.finalMissionUnlocked).toBe(true);
    expect(isFinalCampaignMissionUnlocked(synced.profile).unlocked).toBe(true);

    // Monotonicity: legacy migrated Act III profile with legacy alias milestones never downgrades
    const legacyMigrated = makeUnlockedAllProfile({
      campaign: {
        ...createFreshV2Profile().campaign,
        currentAct: 'act3',
        unlockedSectors: ['near_orbit', 'frozen_graveyard', 'stargate_abyss'],
        completedMilestones: ['prologue_complete', 'act1_complete', 'act2_complete'],
        defeatedBossIds: [],
        finalMissionUnlocked: true,
        endlessUnlocked: true,
      },
    });
    const mono = syncCampaignProgress(legacyMigrated);
    expect(mono.profile.campaign.currentAct).toBe('endless');
    expect(mono.profile.campaign.unlockedSectors).toEqual([
      'near_orbit',
      'frozen_graveyard',
      'stargate_abyss',
    ]);
    expect(mono.profile.campaign.finalMissionUnlocked).toBe(true);
    expect(mono.profile.campaign.endlessUnlocked).toBe(true);

    // Facility purchase immediately triggers research_lab_built milestone
    const preLab = createFreshV2Profile();
    const labCandidate: V2ProfileState = {
      ...preLab,
      credits: 200,
      tutorialCompleted: true,
      buildings: { ...preLab.buildings, workbench: true, contract_hub: true },
      completedContractTypes: ['transport'],
    };
    const built = purchaseV2Facility(labCandidate, 'research_lab');
    expect(built.ok).toBe(true);
    expect(hasCampaignMilestone(built.profile.campaign, 'research_lab_built')).toBe(true);
  });
});

describe('M2 Relic Pity Guarantee & Settlement Default Disposition', () => {
  it('guarantees a reachable hasRelicSignal node carrying sector signature relic across 120 seeds on all 3 sectors when pity >= threshold', () => {
    const profile = makeUnlockedAllProfile({
      campaign: {
        ...createFreshV2Profile().campaign,
        currentAct: 'act3',
        unlockedSectors: ['near_orbit', 'frozen_graveyard', 'stargate_abyss'],
        relicPityCounters: {
          near_orbit: RELIC_PITY_THRESHOLD,
          frozen_graveyard: RELIC_PITY_THRESHOLD + 2,
          stargate_abyss: RELIC_PITY_THRESHOLD,
        },
      },
    });
    const slots = buildFreeFallbackPrepareSlots('cannon_skiff', profile.blueprints);

    for (const sectorId of V3_SECTOR_ORDER) {
      const expectedDefId = `cargo.${V3_SECTORS[sectorId].signatureRelicIds[0]}`;
      const pity = shouldTriggerRelicPitySignal(profile, sectorId);
      expect(pity.triggered).toBe(true);
      expect(pity.relicDefId).toBe(expectedDefId);

      for (let seed = 1; seed <= 40; seed++) {
        const res = launchV2Expedition({
          profile,
          contractTemplateId: 'free_salvage',
          shipId: 'cannon_skiff',
          crewId: 'engineer',
          primaryArchetype: 'laser',
          slots,
          sectorId,
          seed: seed * 97 + sectorId.length,
        });
        expect(res.ok && res.run).toBeTruthy();
        const run = res.run!;
        const signalNodes = Object.values(run.graph.nodes).filter((n) => n.hasRelicSignal);
        expect(signalNodes.length).toBe(1);
        const sn = signalNodes[0];
        expect(sn.relicSignalDefId).toBe(expectedDefId);
        expect(sn.type).not.toBe('merchant');

        // Verify the signature relic is genuinely embedded in the node payload or combat reward!
        if (sn.type === 'wreck') {
          expect(sn.wreck?.cargoItems.some((c) => c.definitionId === expectedDefId)).toBe(true);
        } else if (sn.type === 'anomaly') {
          expect(sn.anomaly?.safeCargoItem.definitionId).toBe(expectedDefId);
          expect(sn.anomaly?.breachCargoItems[0].definitionId).toBe(expectedDefId);
        } else if (sn.type === 'distress') {
          expect(sn.distress?.haulCargoItem.definitionId).toBe(expectedDefId);
        } else if (sn.combat) {
          const rew = generateV2CombatRewardBundle(run, sn, profile.unlockedFamilies, []);
          expect(rew.bundle.cargoOption.definitionId).toBe(expectedDefId);
        }
      }
    }
  });

  it('defaults un-restored collectible relic to keep_relic when display is built, resets ONLY current sector pity, and increments pity on non-relic return', () => {
    const profile = makeUnlockedAllProfile({
      campaign: {
        ...createFreshV2Profile().campaign,
        currentAct: 'act2',
        unlockedSectors: ['near_orbit', 'frozen_graveyard'],
        relicPityCounters: {
          near_orbit: 3,
          frozen_graveyard: 1,
          stargate_abyss: 0,
        },
      },
    });

    const relicItem = createV2CargoInstance({
      instanceId: 'relic_inst_1',
      defId: 'cargo.ancient_navigator',
      origin: 'loot',
      acquiredDepth: 4,
      location: 'bay',
    });

    // Default disposition keeps relic when display is built and relic is un-restored
    expect(getDefaultDispositionForItem(relicItem, 'safe_return', false, profile)).toBe('keep_relic');
    // When display is NOT built, defaults to sell (preserves legacy behavior)
    const noDisplay = {
      ...profile,
      buildings: { ...profile.buildings, display: false },
      facilityTiers: { ...profile.facilityTiers, display: 0 },
    };
    expect(getDefaultDispositionForItem(relicItem, 'safe_return', false, noDisplay)).toBe('sell');

    const slots = buildFreeFallbackPrepareSlots('cannon_skiff', profile.blueprints);
    const launch = launchV2Expedition({
      profile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots,
      sectorId: 'near_orbit',
      seed: 4444,
    });
    const runWithRelic: V2RunState = {
      ...launch.run!,
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
      bay: {
        ...launch.run!.bay,
        placed: [{ item: relicItem, x: 0, y: 0, rotation: 0 }],
      },
    };

    const settledRelic = applyV2Settlement(launch.profile, runWithRelic);
    expect(settledRelic.ok).toBe(true);
    expect(settledRelic.profile.relics.ancient_navigator.storedCount).toBe(1);
    expect(settledRelic.profile.campaign.relicPityCounters.near_orbit).toBe(0);
    // Other sector's pity counter MUST remain untouched!
    expect(settledRelic.profile.campaign.relicPityCounters.frozen_graveyard).toBe(1);

    // Explicit override to 'sell' still sells the relic
    const summarySellOverride = calculateV2Settlement(runWithRelic, launch.profile, {
      [relicItem.instanceId]: 'sell',
    });
    expect(summarySellOverride.soldItemsCredits).toBe(relicItem.fixedValue);
    expect(Object.keys(summarySellOverride.keptRelicsById).length).toBe(0);

    // Non-relic return increments ONLY run.sectorId pity counter by +1
    const launchNoRelic = launchV2Expedition({
      profile: settledRelic.profile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots,
      sectorId: 'frozen_graveyard',
      seed: 5555,
    });
    const runNoRelic: V2RunState = {
      ...launchNoRelic.run!,
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
    };
    const settledNoRelic = applyV2Settlement(launchNoRelic.profile, runNoRelic);
    expect(settledNoRelic.ok).toBe(true);
    expect(settledNoRelic.profile.campaign.relicPityCounters.frozen_graveyard).toBe(2);
    expect(settledNoRelic.profile.campaign.relicPityCounters.near_orbit).toBe(0);
  });
});

describe('M2 Star Sectors & Environmental Modifiers (F06): Gating, Backdrops, Deterministic Parity', () => {
  it('rejects launching into locked frozen_graveyard and stargate_abyss in both validateV2PrepareLoadout and launchV2Expedition', () => {
    const pAct1 = makeUnlockedAllProfile();
    const slots = buildFreeFallbackPrepareSlots('cannon_skiff', pAct1.blueprints);

    for (const lockedSector of ['frozen_graveyard', 'stargate_abyss'] as const) {
      const check = validateV2PrepareLoadout(
        pAct1,
        'cannon_skiff',
        'engineer',
        slots,
        null,
        lockedSector
      );
      expect(check.valid).toBe(false);
      expect(check.errors.some((e) => e.includes('尚未解锁'))).toBe(true);

      const launch = launchV2Expedition({
        profile: pAct1,
        contractTemplateId: 'free_salvage',
        shipId: 'cannon_skiff',
        crewId: 'engineer',
        primaryArchetype: 'laser',
        slots,
        sectorId: lockedSector,
        seed: 7777,
      });
      expect(launch.ok).toBe(false);
      expect(launch.run).toBeNull();
    }
  });

  it('maps exact PROJECT.md F06 sector backdrop indices per layer for all 3 sectors', () => {
    expect(getV3SectorDef('near_orbit').layerBgIndices).toEqual([1, 1, 2, 2, 4, 4]);
    expect(getV3SectorDef('frozen_graveyard').layerBgIndices).toEqual([4, 4, 5, 5, 3, 3]);
    expect(getV3SectorDef('stargate_abyss').layerBgIndices).toEqual([3, 3, 5, 5, 6, 6]);
  });

  it('applies Sector 2 cryo_ion and Sector 3 gravity_tide deterministically with 100% preview === execution parity', () => {
    const bay = makeSimpleTestBay([
      { kind: 'laser', x: 0, y: 0 },
      { kind: 'battery', x: 1, y: 0 },
      { kind: 'shield', x: 2, y: 0 },
      { kind: 'shield', x: 0, y: 2 },
    ]);
    const units = buildEncounterUnits('armored', 4, 'test_env');

    // Sector 1 (near_orbit) MUST equal omitted sectorId bit-for-bit
    const baseSim = simulateV2Combat({
      resultId: 's0',
      bay,
      startingHp: 30,
      maxHp: 30,
      units,
      targetPolicy: 'weakest',
    });
    const nearSim = simulateV2Combat({
      resultId: 's0',
      bay,
      startingHp: 30,
      maxHp: 30,
      units,
      targetPolicy: 'weakest',
      sectorId: 'near_orbit',
    });
    expect(nearSim.finalPlayerHpAfterRepair).toBe(baseSim.finalPlayerHpAfterRepair);
    expect(nearSim.startingPlayerShield).toBe(baseSim.startingPlayerShield);
    expect(nearSim.roundsCount).toBe(baseSim.roundsCount);

    // Sector 2 (cryo_ion): opening shield is reduced by 2, and even round decays remaining shield by 2 without hurting HP
    const cryoSim = simulateV2Combat({
      resultId: 's_cryo',
      bay,
      startingHp: 30,
      maxHp: 30,
      units,
      targetPolicy: 'weakest',
      sectorId: 'frozen_graveyard',
    });
    expect(cryoSim.envModifierId).toBe('cryo_ion');
    expect(cryoSim.startingPlayerShield).toBe(Math.max(0, baseSim.startingPlayerShield - 2));
    expect(cryoSim.rounds[0].envModifierEvent).toContain('低温电离');
    if (cryoSim.rounds.length >= 2) {
      expect(cryoSim.rounds[1].envModifierEvent).toContain('低温电离脉冲');
    }

    // Verify cryo_ion never damages HP when shield === 0
    const noShieldBay = makeSimpleTestBay([{ kind: 'laser', x: 0, y: 0 }]);
    const weakUnit = [{ ...units[0], maxHp: 30, damagePerRound: 1, armor: 0 }];
    const cryoZeroShield = simulateV2Combat({
      resultId: 's_cryo_0',
      bay: noShieldBay,
      startingHp: 30,
      maxHp: 30,
      units: weakUnit,
      targetPolicy: 'weakest',
      sectorId: 'frozen_graveyard',
    });
    expect(cryoZeroShield.startingPlayerShield).toBe(0);
    // Round 2: enemy deals 1 damage -> HP drops by exact 1, zero extra cryo hull damage!
    expect(cryoZeroShield.rounds[1].playerHpAfter).toBe(cryoZeroShield.rounds[0].playerHpAfter - 1);

    // Sector 3 (gravity_tide): Round 2 first player attack gets +2 raw damage AND enemy gets +1 raw damage
    const gravSim = simulateV2Combat({
      resultId: 's_grav',
      bay,
      startingHp: 30,
      maxHp: 30,
      units,
      targetPolicy: 'weakest',
      sectorId: 'stargate_abyss',
    });
    expect(gravSim.envModifierId).toBe('gravity_tide');
    expect(gravSim.rounds.length).toBeGreaterThanOrEqual(2);
    // Round 1 (odd): identical raw damages to baseline
    expect(gravSim.rounds[0].playerAttacks[0].rawDamage).toBe(
      baseSim.rounds[0].playerAttacks[0].rawDamage
    );
    expect(gravSim.rounds[0].enemyAttacks[0].rawDamage).toBe(
      baseSim.rounds[0].enemyAttacks[0].rawDamage
    );
    // Round 2 (even): +2 on first player direct hit, +1 on enemy attack!
    expect(gravSim.rounds[1].playerAttacks[0].rawDamage).toBe(
      baseSim.rounds[1].playerAttacks[0].rawDamage + 2
    );
    expect(gravSim.rounds[1].enemyAttacks[0].rawDamage).toBe(
      baseSim.rounds[1].enemyAttacks[0].rawDamage + 1
    );
    expect(gravSim.rounds[1].envModifierEvent).toContain('引力潮汐');

    // Full previewV2CombatNode === startV2CombatAtCurrentNode parity across Sector 2 & Sector 3
    const pAll = makeUnlockedAllProfile({
      campaign: {
        ...createFreshV2Profile().campaign,
        currentAct: 'act3',
        unlockedSectors: ['near_orbit', 'frozen_graveyard', 'stargate_abyss'],
      },
    });
    const slots = buildFreeFallbackPrepareSlots('cannon_skiff', pAll.blueprints);

    for (const sectorId of ['frozen_graveyard', 'stargate_abyss'] as const) {
      const launched = launchV2Expedition({
        profile: pAll,
        contractTemplateId: 'free_salvage',
        shipId: 'cannon_skiff',
        crewId: 'engineer',
        primaryArchetype: 'laser',
        slots,
        sectorId,
        seed: 8888,
      });
      const run = launched.run!;
      const combatNode = Object.values(run.graph.nodes).find((n) => n.layer === 6 && n.combat)!;
      const atNodeRun: V2RunState = {
        ...run,
        currentNodeId: combatNode.nodeId,
        phase: 'ENCOUNTER',
      };
      const pv = previewV2CombatNode(atNodeRun, combatNode.nodeId)!;
      const started = startV2CombatAtCurrentNode(atNodeRun);
      expect(started.ok).toBe(true);
      const execSim = started.run.activeCombat!.simulation;
      expect(execSim.outcome).toBe(pv.outcome);
      expect(execSim.finalPlayerHpAfterRepair).toBe(pv.finalPlayerHpAfterRepair);
      expect(execSim.roundsCount).toBe(pv.roundsCount);
      expect(execSim.startingPlayerShield).toBe(pv.startingPlayerShield);
      expect(execSim.envModifierId).toBe(getV3SectorDef(sectorId).envModifier.id);

      // Verify tacticalDelta handles boss encounter kinds safely without throwing
      const delta = computeV2PlacementTacticalDelta({
        run: atNodeRun,
        bay: atNodeRun.bay,
        startingHp: atNodeRun.hp,
        maxHp: atNodeRun.maxHp,
        targetPolicy: 'weakest',
        item: atNodeRun.bay.placed[0].item,
        zone: 'grid',
      });
      expect(delta.combatDeltaLine.length).toBeGreaterThan(0);
    }
  });
});

describe('M2 Named Crew (F07): 林工/陆衡/苏岚 Portraits, Mastery Progression, Genuine Perks & Comms', () => {
  it('defines named specialists 林工/陆衡/苏岚, resolves rescue_std clash, and renders distinct inline SVG portraits', () => {
    expect(V2_CREW.engineer.name).toBe('林工');
    expect(V2_CREW.navigator.name).toBe('陆衡');
    expect(V2_CREW.salvager.name).toBe('苏岚');
    expect(V2_CONTRACT_TEMPLATES.rescue_std.name).not.toContain('营救工程师');
    expect(V2_CONTRACT_TEMPLATES.rescue_std.gameplayNote).not.toContain('工程师');
    expect(V2_CREW.navigator.unlockHint).toMatch(/未解锁.*测绘/);
    expect(V2_CREW.salvager.unlockHint).toMatch(/未解锁.*转运/);

    const svgs = V2_CREW_ORDER.map((cid) => crewPortraitSvg(cid, 36));
    for (const s of svgs) {
      expect(s).toContain('<svg');
      expect(s).toContain('</svg>');
    }
    expect(new Set(svgs).size).toBe(3);
  });

  it('upgrades Crew Mastery 0 -> 1 -> 2 on qualifying feats and clamps strictly to 2', () => {
    const p0 = makeUnlockedAllProfile();
    expect(p0.crewMastery.engineer).toBe(0);

    const slots = buildFreeFallbackPrepareSlots('cannon_skiff', p0.blueprints);
    // Run 1: safe return reaching Layer 4 upgrades 0 -> 1
    const l1 = launchV2Expedition({
      profile: p0,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots,
      seed: 1111,
    });
    const r1: V2RunState = {
      ...l1.run!,
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
      visitedNodeIds: ['L1A', 'L2A', 'L3A', 'L4A'],
    };
    const s1 = applyV2Settlement(l1.profile, r1);
    expect(s1.profile.crewMastery.engineer).toBe(1);
    expect(s1.crewMasteryUpgraded).toEqual({ crewId: 'engineer', fromTier: 0, toTier: 1 });

    // Run 2: reaching Layer 6 upgrades 1 -> 2
    const l2 = launchV2Expedition({
      profile: s1.profile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots,
      seed: 2222,
    });
    const r2: V2RunState = {
      ...l2.run!,
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
      visitedNodeIds: ['L1A', 'L2A', 'L3A', 'L4A', 'L5A', 'L6A'],
    };
    const s2 = applyV2Settlement(l2.profile, r2);
    expect(s2.profile.crewMastery.engineer).toBe(2);
    expect(s2.crewMasteryUpgraded).toEqual({ crewId: 'engineer', fromTier: 1, toTier: 2 });

    // Run 3: stays strictly clamped at 2
    const l3 = launchV2Expedition({
      profile: s2.profile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots,
      seed: 3333,
    });
    const r3: V2RunState = {
      ...l3.run!,
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
      visitedNodeIds: ['L1A', 'L2A', 'L3A', 'L4A', 'L5A', 'L6A'],
    };
    const s3 = applyV2Settlement(l3.profile, r3);
    expect(s3.profile.crewMastery.engineer).toBe(2);
    expect(s3.crewMasteryUpgraded).toBeNull();
  });

  it('applies genuine Mastery T1 & T2 perks for 林工, 陆衡, and 苏岚 while keeping Tier 0 neutral', () => {
    const baseProfile = makeUnlockedAllProfile();
    const slots = buildFreeFallbackPrepareSlots('cannon_skiff', baseProfile.blueprints);

    // --- 1. 林工 (Engineer) ---
    // Tier 0: 3 candidates, swaps improved -> common
    const engT0Launch = launchV2Expedition({
      profile: baseProfile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots,
      seed: 100,
    });
    const impLaser = createV2EquipmentInstance({
      instanceId: 'imp_laser_1',
      kind: 'laser',
      quality: 'improved',
      origin: 'loot',
      acquiredDepth: 4,
      location: 'staging',
    });
    const runT0WithStaging: V2RunState = {
      ...engT0Launch.run!,
      bay: { ...engT0Launch.run!.bay, staging: [{ item: impLaser, rotation: 0 }] },
    };
    const offeredT0 = maybeCreateEngineerSwapOffer(
      runT0WithStaging,
      impLaser,
      baseProfile.unlockedFamilies
    );
    expect(offeredT0.activeEngineerOffer?.candidates.length).toBe(3);
    const swappedT0 = applyV2EngineerSwap(offeredT0, offeredT0.activeEngineerOffer!.candidates[0]);
    expect(swappedT0.ok).toBe(true);
    expect(swappedT0.run.bay.staging[0].item.quality).toBe('common');

    // Tier 1 & Tier 2: 4 candidates + T2 preserves 'improved' quality + combat repair/shield caps!
    const engT2Profile = makeUnlockedAllProfile({
      crewMastery: { engineer: 2, navigator: 0, salvager: 0 },
    });
    const engT2Launch = launchV2Expedition({
      profile: engT2Profile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots,
      seed: 100,
    });
    expect(engT2Launch.run!.crewMasteryTier).toBe(2);
    const runT2WithStaging: V2RunState = {
      ...engT2Launch.run!,
      bay: { ...engT2Launch.run!.bay, staging: [{ item: impLaser, rotation: 0 }] },
    };
    const offeredT2 = maybeCreateEngineerSwapOffer(
      runT2WithStaging,
      impLaser,
      engT2Profile.unlockedFamilies
    );
    expect(offeredT2.activeEngineerOffer?.candidates.length).toBe(4);
    const swappedT2 = applyV2EngineerSwap(offeredT2, offeredT2.activeEngineerOffer!.candidates[0]);
    expect(swappedT2.ok).toBe(true);
    expect(swappedT2.run.bay.staging[0].item.quality).toBe('improved');

    const engBay = makeSimpleTestBay([
      { kind: 'laser', x: 0, y: 0 },
      { kind: 'shield', x: 2, y: 0 },
    ]);
    const patrol = buildEncounterUnits('patrol', 1, 'eng_test');
    const simEng0 = simulateV2Combat({
      resultId: 'eng0',
      bay: engBay,
      startingHp: 20,
      maxHp: 30,
      units: patrol,
      targetPolicy: 'weakest',
      crewId: 'engineer',
      crewMasteryTier: 0,
    });
    const simEng2 = simulateV2Combat({
      resultId: 'eng2',
      bay: engBay,
      startingHp: 20,
      maxHp: 30,
      units: patrol,
      targetPolicy: 'weakest',
      crewId: 'engineer',
      crewMasteryTier: 2,
    });
    expect(simEng2.startingPlayerShield).toBe(
      Math.min(V2_MAX_BATTLE_SHIELD, simEng0.startingPlayerShield + 2)
    );
    expect(simEng2.repairApplied).toBe(Math.min(V2_MAX_POST_WIN_REPAIR, simEng0.repairApplied + 1));

    // --- 2. 陆衡 (Navigator) ---
    const navT0Launch = launchV2Expedition({
      profile: baseProfile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'navigator',
      primaryArchetype: 'laser',
      slots,
      seed: 200,
    });
    expect(navT0Launch.run!.fuel).toBe(V2_STARTING_FUEL);

    const navT2Profile = makeUnlockedAllProfile({
      crewMastery: { engineer: 0, navigator: 2, salvager: 0 },
    });
    const navT2Launch = launchV2Expedition({
      profile: navT2Profile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'navigator',
      primaryArchetype: 'laser',
      slots,
      seed: 200,
    });
    expect(navT2Launch.run!.fuel).toBe(Math.min(V2_MAX_FUEL, V2_STARTING_FUEL + 1));

    const simNav0 = simulateV2Combat({
      resultId: 'nav0',
      bay: engBay,
      startingHp: 30,
      maxHp: 30,
      units: patrol,
      targetPolicy: 'weakest',
      crewId: 'navigator',
      crewMasteryTier: 0,
    });
    const simNav2 = simulateV2Combat({
      resultId: 'nav2',
      bay: engBay,
      startingHp: 30,
      maxHp: 30,
      units: patrol,
      targetPolicy: 'weakest',
      crewId: 'navigator',
      crewMasteryTier: 2,
    });
    expect(simNav2.rounds[0].playerAttacks[0].rawDamage).toBe(
      simNav0.rounds[0].playerAttacks[0].rawDamage + 2
    );

    // --- 3. 苏岚 (Salvager) ---
    const salvT2Profile = makeUnlockedAllProfile({
      crewMastery: { engineer: 0, navigator: 0, salvager: 2 },
    });
    const salvLaunch = launchV2Expedition({
      profile: salvT2Profile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'salvager',
      primaryArchetype: 'laser',
      slots,
      seed: 300,
    });
    const salvRun = salvLaunch.run!;
    // T1: +15% cargo sale appraisal bonus
    const cargoLoot = createV2CargoInstance({
      instanceId: 'salv_cg_1',
      defId: 'cargo.old_engine',
      origin: 'loot',
      acquiredDepth: 3,
      location: 'bay',
      fixedValueOverride: 40,
    });
    const settleSum = calculateV2Settlement(
      {
        ...salvRun,
        phase: 'SETTLEMENT',
        settlementReason: 'safe_return',
        bay: { ...salvRun.bay, placed: [{ item: cargoLoot, x: 0, y: 0, rotation: 0 }] },
      },
      salvT2Profile
    );
    expect(settleSum.soldItemsCredits).toBe(40);
    expect(settleSum.crewMasteryBonusCredits).toBe(6); // Math.round(40 * 0.15)
    expect(settleSum.finalCreditsEarned).toBe(46);

    // T2: Wreck reactor fuel (+3 instead of +2) & repair (+10 instead of +8)
    const wreckNode = Object.values(salvRun.graph.nodes).find((n) => n.type === 'wreck')!;
    const atWreckRun: V2RunState = {
      ...salvRun,
      currentNodeId: wreckNode.nodeId,
      phase: 'ENCOUNTER',
      fuel: 5,
      hp: 15,
    };
    const fuelCut = resolveV2WreckChoice(atWreckRun, 'reactor_fuel', salvT2Profile.unlockedFamilies);
    expect(fuelCut.ok).toBe(true);
    expect(fuelCut.run.fuel).toBe(8); // 5 + (2 + 1)
    const repairCut = resolveV2WreckChoice(
      atWreckRun,
      'reactor_repair',
      salvT2Profile.unlockedFamilies
    );
    expect(repairCut.ok).toBe(true);
    expect(repairCut.run.hp).toBe(25); // 15 + (8 + 2)

    // T2: Combat victory bounty +20% (Math.ceil)
    const combatNode = Object.values(salvRun.graph.nodes).find((n) => n.layer === 1 && n.combat)!;
    const atCombat: V2RunState = {
      ...salvRun,
      currentNodeId: combatNode.nodeId,
      phase: 'ENCOUNTER',
    };
    const started = startV2CombatAtCurrentNode(atCombat);
    expect(started.ok).toBe(true);
    const completed = completeV2CombatAtCurrentNode(
      started.run,
      salvT2Profile.unlockedFamilies,
      []
    );
    expect(completed.ok).toBe(true);
    expect(completed.run.wallet).toBe(Math.ceil(combatNode.combat!.bounty * 1.2));
  });

  it('tracks unlocked & unread crew comms and prevents duplicate triggers after marking read', () => {
    const p = makeUnlockedAllProfile();
    const unlocked = getUnlockedCampaignComms(p);
    expect(unlocked.length).toBeGreaterThanOrEqual(4);
    expect(CAMPAIGN_COMMS.length).toBeGreaterThanOrEqual(10);

    const unreadBefore = getUnreadCampaignCommsCount(p);
    expect(unreadBefore).toBe(unlocked.length);

    const comm = getTriggeredCommForContext(p, 'act1_start');
    expect(comm).not.toBeNull();
    const pRead = markCampaignCommRead(p, comm!.id);
    expect(getUnreadCampaignCommsCount(pRead)).toBe(unreadBefore - 1);
    expect(getTriggeredCommForContext(pRead, 'act1_start')).toBeNull();

    const obj = getActiveCampaignObjective(pRead);
    expect(obj.actLabel).toBe(CAMPAIGN_CHAPTERS.act1.shortLabel);
    expect(obj.headline).toContain('铁砧号');
  });
});

describe('M2 Contract #3 Pluggable Registries & 900-Seed Multi-Sector Graph Invariants', () => {
  it('buildSectorEnemyEncounter produces distinct Act Bosses, sector scaling, and endlessThreat scaling', () => {
    const rng = new SeededRng(4242);
    const anvil = buildSectorEnemyEncounter('near_orbit', 6, 'elite', rng, 0, { nodeId: 'L6A' });
    const dread = buildSectorEnemyEncounter('frozen_graveyard', 6, 'elite', rng, 0, {
      nodeId: 'L6A',
    });
    const levi = buildSectorEnemyEncounter('stargate_abyss', 6, 'elite', rng, 0, {
      nodeId: 'L6A',
    });

    expect(anvil.bossId).toBe('boss_anvil');
    expect(dread.bossId).toBe('boss_dreadnought');
    expect(levi.bossId).toBe('boss_leviathan');
    expect(dread.units[0].maxHp).toBeGreaterThan(anvil.units[0].maxHp);
    expect(levi.units[0].maxHp).toBeGreaterThan(dread.units[0].maxHp);

    // Endless threat scaling increases HP and bounty deterministically
    const leviT5 = buildSectorEnemyEncounter('stargate_abyss', 6, 'elite', rng, 5, {
      nodeId: 'L6A',
    });
    expect(leviT5.units[0].maxHp).toBeGreaterThan(levi.units[0].maxHp);
    expect(leviT5.bounty).toBeGreaterThan(levi.bounty);

    // Safe fallback for unknown encounter kinds
    expect(getV2EncounterTemplate('boss_anvil').name).toContain('铁砧号');
    expect(getV2EncounterTemplate('unknown_future_enemy').kind).toBe('patrol');
  });

  it('drawSectorEventPayload avoids repeating usedEventIds across all 3 sectors and honors guaranteedRelicDefId', () => {
    for (const sectorId of V3_SECTOR_ORDER) {
      for (const nodeType of ['anomaly', 'distress'] as const) {
        const rng = new SeededRng(1337 + sectorId.length);
        const used: string[] = [];
        for (let i = 0; i < 3; i++) {
          const drawn = drawSectorEventPayload(sectorId, nodeType, used, rng, {
            layer: 3,
            guaranteedRelicDefId: i === 2 ? 'cargo.cryo_amber' : null,
          });
          expect(used.includes(drawn.eventId)).toBe(false);
          used.push(drawn.eventId);
          if (i === 2) {
            if (nodeType === 'anomaly') {
              expect(drawn.anomaly?.safeCargoItem.definitionId).toBe('cargo.cryo_amber');
            } else {
              expect(drawn.distress?.haulCargoItem.definitionId).toBe('cargo.cryo_amber');
            }
          }
        }
      }
    }
  });

  it('passes verifyV2GraphInvariants across 300 seeds × 3 sectors (900 star graphs, incl. pity signals)', () => {
    const contracts = ['transport_std', 'rescue_std', 'survey_std', 'survey_deep', 'free_salvage'];
    const archetypes = ['laser', 'heavy', 'hangar', 'counter'] as const;

    for (const sectorId of V3_SECTOR_ORDER) {
      const expectedBgs = V3_SECTORS[sectorId].layerBgIndices;
      for (let i = 0; i < 300; i++) {
        const seed = 70000 + i * 31 + sectorId.length * 1009;
        const contractTemplateId = contracts[i % contracts.length];
        const primaryArchetype = archetypes[i % archetypes.length];
        const guaranteedRelicDefId =
          i % 5 === 0 ? `cargo.${V3_SECTORS[sectorId].signatureRelicIds[0]}` : null;

        const gen = generateV2StarGraph({
          runId: `inv_${sectorId}_${i}`,
          contractTemplateId,
          primaryArchetype,
          unlockedFamilies: ['core', 'heavy_kit', 'hangar_kit', 'counter_kit'],
          streams: createV2RngStreams(seed),
          allowImproved: true,
          sectorId,
          guaranteedRelicDefId,
        });
        const contract = createV2ContractInstance(
          contractTemplateId,
          gen.markedNodeIds,
          `inv_${sectorId}_${i}`
        );
        const report = verifyV2GraphInvariants(gen.graph, contract, primaryArchetype);
        if (!report.ok) {
          throw new Error(
            `Graph invariant failed (${sectorId}, seed=${seed}): ${report.violations.join('; ')}`
          );
        }

        // Verify sector backdrop indices and bossId assignment on Layer 6
        for (const node of Object.values(gen.graph.nodes)) {
          expect(node.sectorBg).toBe(expectedBgs[node.layer - 1]);
          if (node.layer === 6 && node.type === 'elite') {
            expect(node.bossId).toBe(V3_SECTORS[sectorId].bossId);
          }
        }
        if (guaranteedRelicDefId) {
          expect(gen.relicSignalNodeId).not.toBeNull();
          expect(gen.graph.nodes[gen.relicSignalNodeId!].hasRelicSignal).toBe(true);
        }
      }
    }
  });
});

describe('M2 Persistence V3 Round-Trip & BGM Boss Track Compatibility', () => {
  it('validates active runs across all 3 sectors with M2 optional fields & boss node type, and rejects invalid mastery/node types', () => {
    const save = createFreshV2SaveData();
    const pAll = makeUnlockedAllProfile({
      crewMastery: { engineer: 2, navigator: 1, salvager: 0 },
      campaign: {
        ...save.profile.campaign,
        currentAct: 'act3',
        unlockedSectors: ['near_orbit', 'frozen_graveyard', 'stargate_abyss'],
        defeatedBossIds: ['boss_anvil', 'boss_dreadnought'],
        relicPityCounters: { near_orbit: 0, frozen_graveyard: 3, stargate_abyss: 1 },
      },
    });
    const slots = buildFreeFallbackPrepareSlots('cannon_skiff', pAll.blueprints);
    const launch = launchV2Expedition({
      profile: pAll,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots,
      sectorId: 'frozen_graveyard',
      seed: 90909,
    });
    expect(launch.ok && launch.run).toBeTruthy();

    // Round-trip save with boss node type & all M2 metadata
    const l6BossKey = Object.values(launch.run!.graph.nodes).find(
      (n) => n.layer === 6 && n.type === 'elite'
    )!.nodeId;
    const bossTypedNode: V2MapNode = {
      ...launch.run!.graph.nodes[l6BossKey],
      type: 'boss',
    };
    const runWithBossNode: V2RunState = {
      ...launch.run!,
      currentNodeId: l6BossKey,
      phase: 'ENCOUNTER',
      graph: {
        ...launch.run!.graph,
        nodes: { ...launch.run!.graph.nodes, [l6BossKey]: bossTypedNode },
      },
    };

    const fullSave = {
      ...save,
      profile: launch.profile,
      activeRun: runWithBossNode,
    };
    expect(validateV2SaveDataDetailed(fullSave)).toEqual({ ok: true });
    expect(resolveV2BgmTrack({ titleEntered: true, run: runWithBossNode })).toBe('boss');

    // Reject out-of-range crewMasteryTier
    const badMasterySave = {
      ...fullSave,
      activeRun: { ...runWithBossNode, crewMasteryTier: 3 },
    };
    expect(validateV2SaveDataDetailed(badMasterySave).ok).toBe(false);
  });
});

describe('M2 Iteration 2 Regression Tests (Challenger 1 & 2 Defect Parity)', () => {
  it('C1-1: tutorial defeat stays in prologue (no tutorial_complete or auto-unlocked buildings), while safe_return advances to act1', () => {
    const fresh = createFreshV2Profile();
    const tutDefeatRun: V2RunState = {
      ...createV2TutorialRun('tut_reg_defeat'),
      hp: 0,
      phase: 'SETTLEMENT',
      settlementReason: 'defeat',
      visitedNodeIds: ['L1A'],
    };

    const defeatSummary = calculateV2Settlement(tutDefeatRun, fresh);
    const defeatPreview = previewSettlementCampaignOutcomes(fresh, tutDefeatRun, defeatSummary);
    expect(defeatPreview.headlines).toEqual([]);
    expect(defeatPreview.pityLine).toBeNull();

    const defeatSettled = applyV2Settlement(fresh, tutDefeatRun);
    expect(defeatSettled.ok).toBe(true);
    expect(defeatSettled.profile.tutorialCompleted).toBe(false);
    expect(defeatSettled.profile.campaign.currentAct).toBe('prologue');
    expect(defeatSettled.actTransition).toBeNull();
    expect(hasCampaignMilestone(defeatSettled.profile.campaign, 'tutorial_complete')).toBe(false);
    expect(defeatSettled.profile.buildings.workbench).toBe(false);
    expect(defeatSettled.profile.buildings.contract_hub).toBe(false);
    expect(defeatSettled.profile.facilityTiers.workbench ?? 0).toBe(0);
    expect(defeatSettled.profile.facilityTiers.contract_hub ?? 0).toBe(0);

    // Subsequent tutorial safe_return properly advances prologue -> act1
    const tutSuccessRun: V2RunState = {
      ...createV2TutorialRun('tut_reg_safe_return'),
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
      visitedNodeIds: ['L1A', 'L2A', 'L3A'],
    };
    const successSummary = calculateV2Settlement(tutSuccessRun, defeatSettled.profile);
    const successPreview = previewSettlementCampaignOutcomes(
      defeatSettled.profile,
      tutSuccessRun,
      successSummary
    );
    expect(successPreview.headlines.some((h) => h.includes('第一幕'))).toBe(true);

    const successSettled = applyV2Settlement(defeatSettled.profile, tutSuccessRun);
    expect(successSettled.ok).toBe(true);
    expect(successSettled.profile.tutorialCompleted).toBe(true);
    expect(successSettled.profile.campaign.currentAct).toBe('act1');
    expect(hasCampaignMilestone(successSettled.profile.campaign, 'tutorial_complete')).toBe(true);
    expect(successSettled.profile.buildings.workbench).toBe(true);
    expect(successSettled.profile.buildings.contract_hub).toBe(true);
  });

  it('C1-2: defeat at boss node with currentNodeId=null and unresolved node NEVER credits boss_anvil, Sector 2, or defeatedEnemyKinds', () => {
    const pAct1 = makeUnlockedAllProfile();
    const slots = buildFreeFallbackPrepareSlots('cannon_skiff', pAct1.blueprints);
    const launch = launchV2Expedition({
      profile: pAct1,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots,
      sectorId: 'near_orbit',
      seed: 31337,
    });
    const run = launch.run!;
    const bossNode = Object.values(run.graph.nodes).find(
      (n) => n.layer === 6 && n.type === 'elite'
    )!;

    // Lose genuinely via startV2CombatAtCurrentNode + completeV2CombatAtCurrentNode (hp=1, empty bay)
    const doomedRun: V2RunState = {
      ...run,
      hp: 1,
      currentNodeId: bossNode.nodeId,
      phase: 'ENCOUNTER',
      bay: { ...run.bay, placed: [], staging: [] },
    };
    const started = startV2CombatAtCurrentNode(doomedRun);
    expect(started.ok).toBe(true);
    expect(started.run.activeCombat!.simulation.outcome).toBe('defeat');

    const completed = completeV2CombatAtCurrentNode(
      started.run,
      launch.profile.unlockedFamilies,
      []
    );
    expect(completed.ok).toBe(true);
    expect(completed.run.settlementReason).toBe('defeat');
    expect(completed.run.claimedEventIds).toContain(`combat_done_${bossNode.nodeId}`);
    expect(completed.run.graph.nodes[bossNode.nodeId].resolved).toBe(false);

    // Mutate currentNodeId to null (exact Challenger 1 repro)
    const settled = applyV2Settlement(launch.profile, {
      ...completed.run,
      runId: 'run_lose_boss_null_node',
      currentNodeId: null,
    });
    expect(settled.ok).toBe(true);
    expect(settled.profile.campaign.defeatedBossIds).toEqual([]);
    expect(settled.profile.campaign.unlockedSectors).toEqual(['near_orbit']);
    expect(settled.profile.campaign.currentAct).toBe('act1');
    expect(settled.profile.career.totalBossesDefeated).toBe(0);
    expect(settled.profile.defeatedEnemyKinds).not.toContain('boss_anvil');
  });

  it('C1-3: normalizeV2SaveData clamps activeRun.crewMasteryTier (3->2, -1->0) while validateV2SaveDataDetailed rejects out-of-range and relicPityCounters null -> {}', () => {
    const save = createFreshV2SaveData();
    const p = makeUnlockedAllProfile();
    const slots = buildFreeFallbackPrepareSlots('cannon_skiff', p.blueprints);
    const launch = launchV2Expedition({
      profile: p,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots,
      sectorId: 'near_orbit',
      seed: 4201,
    });
    const baseSave = { ...save, profile: launch.profile, activeRun: launch.run! };

    const highRaw = {
      ...baseSave,
      activeRun: { ...launch.run!, crewMasteryTier: 3 },
    };
    const lowRaw = {
      ...baseSave,
      activeRun: { ...launch.run!, crewMasteryTier: -1 },
    };
    const nanRaw = {
      ...baseSave,
      activeRun: { ...launch.run!, crewMasteryTier: Number.NaN },
    };

    // Strict validator rejects all out-of-range / NaN values
    expect(validateV2SaveDataDetailed(highRaw).ok).toBe(false);
    expect(validateV2SaveDataDetailed(lowRaw).ok).toBe(false);
    expect(validateV2SaveDataDetailed(nanRaw).ok).toBe(false);

    // Normalizer clamps cleanly into 0..2 and preserves relicPityCounters: null -> {}
    const normHigh = normalizeV2SaveData(highRaw);
    const normLow = normalizeV2SaveData(lowRaw);
    const normNan = normalizeV2SaveData(nanRaw);
    expect(normHigh.activeRun?.crewMasteryTier).toBe(2);
    expect(normLow.activeRun?.crewMasteryTier).toBe(0);
    expect(normNan.activeRun?.crewMasteryTier).toBe(0);
    expect(validateV2SaveDataDetailed(normHigh)).toEqual({ ok: true });
    expect(validateV2SaveDataDetailed(normLow)).toEqual({ ok: true });

    const nullPityNorm = normalizeV2SaveData({
      ...baseSave,
      profile: {
        ...baseSave.profile,
        campaign: {
          ...baseSave.profile.campaign,
          relicPityCounters: null as unknown as Record<string, number>,
        },
      },
    });
    expect(nullPityNorm.profile.campaign.relicPityCounters).toEqual({});
  });

  it('C1-4: validateV2PrepareLoadout & launchV2Expedition reject forged/unknown sectorIds even if tampered into unlockedSectors', () => {
    const pAct1 = makeUnlockedAllProfile();
    const slots = buildFreeFallbackPrepareSlots('cannon_skiff', pAct1.blueprints);

    for (const badId of ['bogus_sector', '', '__proto__', 'constructor']) {
      const check = validateV2PrepareLoadout(
        pAct1,
        'cannon_skiff',
        'engineer',
        slots,
        null,
        badId as SectorId
      );
      expect(check.valid).toBe(false);
      expect(check.errors.some((e) => e.includes('未知目标星区'))).toBe(true);
      expect(check.errors.some((e) => e.includes('近轨残骸带'))).toBe(false);
    }

    // Tampered unlockedSectors containing 'bogus_sector' MUST still be rejected
    const tamperedProfile: V2ProfileState = {
      ...pAct1,
      campaign: {
        ...pAct1.campaign,
        unlockedSectors: ['near_orbit', 'bogus_sector' as SectorId],
      },
    };
    const tamperedLaunch = launchV2Expedition({
      profile: tamperedProfile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots,
      sectorId: 'bogus_sector' as SectorId,
      seed: 9999,
    });
    expect(tamperedLaunch.ok).toBe(false);
    expect(tamperedLaunch.run).toBeNull();
    expect(tamperedLaunch.errors.some((e) => e.includes('未知目标星区'))).toBe(true);
  });

  it('C2-D1: Sector 3 (gravity_tide) Round-2 interactive Boss enemyThreatDamage matches actual Round-2 salvo (11 vs base 8 on boss_leviathan + 2 escorts)', () => {
    const pAll = makeUnlockedAllProfile({
      campaign: {
        ...createFreshV2Profile().campaign,
        currentAct: 'act3',
        unlockedSectors: ['near_orbit', 'frozen_graveyard', 'stargate_abyss'],
      },
    });
    const slots = buildFreeFallbackPrepareSlots('cannon_skiff', pAll.blueprints);
    const launch = launchV2Expedition({
      profile: pAll,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots,
      sectorId: 'stargate_abyss',
      seed: 1001,
    });
    expect(launch.ok && launch.run).toBeTruthy();

    const run = launch.run!;
    const bossNode = Object.values(run.graph.nodes).find(
      (n) => n.layer === 6 && n.type === 'elite'
    )!;
    expect(bossNode.bossId).toBe('boss_leviathan');

    const atBossRun: V2RunState = {
      ...run,
      currentNodeId: bossNode.nodeId,
      phase: 'ENCOUNTER',
    };
    const started = startV2CombatAtCurrentNode(atBossRun, 'weakest', {
      enableEliteTactic: true,
    });
    expect(started.ok).toBe(true);

    const pending = started.run.activeCombat!.pendingDecision;
    expect(pending).not.toBeNull();
    const r2 = started.run.activeCombat!.simulation.rounds[1];
    expect(r2).toBeDefined();
    const actualR2RawSum = r2.enemyAttacks.reduce((sum, a) => sum + a.rawDamage, 0);

    // boss_leviathan P1 R2 uses damageMult: 0.7 -> Math.round(6 * 0.7) = 4, plus 2 escorts (1+1) = 6 base;
    // with gravity_tide (+1 per attacking enemy = +3) it MUST equal 9 and match pending.enemyThreatDamage!
    expect(pending!.enemiesAlive).toBe(3);
    expect(actualR2RawSum).toBe(9);
    expect(pending!.enemyThreatDamage).toBe(actualR2RawSum);
  });

  it('C2-D2: getEffectiveV2CombatBounty returns +20% ceil ONLY for Salvager Mastery T2 and matches completeV2CombatAtCurrentNode payout', () => {
    expect(getEffectiveV2CombatBounty({ crewId: 'salvager', crewMasteryTier: 2 }, 9)).toBe(11);
    expect(getEffectiveV2CombatBounty({ crewId: 'salvager', crewMasteryTier: 1 }, 9)).toBe(9);
    expect(getEffectiveV2CombatBounty({ crewId: 'salvager', crewMasteryTier: 0 }, 9)).toBe(9);
    expect(getEffectiveV2CombatBounty({ crewId: 'engineer', crewMasteryTier: 2 }, 9)).toBe(9);
    expect(getEffectiveV2CombatBounty({ crewId: 'navigator', crewMasteryTier: 2 }, 9)).toBe(9);
    expect(getEffectiveV2CombatBounty({ crewId: null, crewMasteryTier: 2 }, 9)).toBe(9);

    const salvT2 = makeUnlockedAllProfile({
      crewMastery: { engineer: 0, navigator: 0, salvager: 2 },
      campaign: {
        ...createFreshV2Profile().campaign,
        currentAct: 'act3',
        unlockedSectors: ['near_orbit', 'frozen_graveyard', 'stargate_abyss'],
      },
    });
    const slots = buildFreeFallbackPrepareSlots('cannon_skiff', salvT2.blueprints);
    const launch = launchV2Expedition({
      profile: salvT2,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'salvager',
      primaryArchetype: 'laser',
      slots,
      sectorId: 'stargate_abyss',
      seed: 2026,
    });
    const run = launch.run!;
    const l1Combat = Object.values(run.graph.nodes).find((n) => n.layer === 1 && n.combat)!;
    const expectedBounty = getEffectiveV2CombatBounty(run, l1Combat.combat!.bounty);
    expect(expectedBounty).toBe(Math.ceil(l1Combat.combat!.bounty * 1.2));

    const started = startV2CombatAtCurrentNode({
      ...run,
      currentNodeId: l1Combat.nodeId,
      phase: 'ENCOUNTER',
    });
    expect(started.ok).toBe(true);
    const done = completeV2CombatAtCurrentNode(started.run, salvT2.unlockedFamilies, []);
    expect(done.ok).toBe(true);
    expect(done.run.wallet).toBe(expectedBounty);
  });

  it('C2-D3 & Polish #8/#9: showcase/tutorial runs isolate pity & bosses; settlement preview is idempotent & checks exhausted relics; batch comms mark read works', () => {
    const profile = makeUnlockedAllProfile({
      crewMastery: { engineer: 0, navigator: 0, salvager: 0 },
      campaign: {
        ...createFreshV2Profile().campaign,
        currentAct: 'act1',
        unlockedSectors: ['near_orbit'],
        defeatedBossIds: [],
        relicPityCounters: { near_orbit: 2, frozen_graveyard: 1 },
      },
    });

    // Showcase run carrying a collectible relic + explicit boss node MUST be a strict no-op in advanceCampaignAfterRun
    const showcaseBase = createV2ShowcaseRun('trial_heavy');
    const relic = createV2CargoInstance({
      instanceId: 'sc_relic_1',
      defId: 'cargo.ancient_navigator',
      origin: 'loot',
      acquiredDepth: 4,
      location: 'bay',
    });
    const firstNodeId = Object.keys(showcaseBase.graph.nodes)[0];
    const showcaseRun: V2RunState = {
      ...showcaseBase,
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
      visitedNodeIds: Object.keys(showcaseBase.graph.nodes),
      claimedEventIds: [`combat_done_${firstNodeId}`],
      defeatedBossIdsThisRun: ['boss_anvil'],
      defeatedEnemyKindsThisRun: ['boss_anvil'],
      bay: {
        ...showcaseBase.bay,
        placed: [{ item: relic, x: 0, y: 0, rotation: 0 }],
      },
      graph: {
        ...showcaseBase.graph,
        nodes: {
          ...showcaseBase.graph.nodes,
          [firstNodeId]: {
            ...showcaseBase.graph.nodes[firstNodeId],
            resolved: true,
            bossId: 'boss_anvil',
          },
        },
      },
    };
    const scSummary = calculateV2Settlement(showcaseRun, profile);
    const scAdvance = advanceCampaignAfterRun(profile, showcaseRun, scSummary);
    expect(scAdvance.profile).toBe(profile);
    expect(scAdvance.profile.campaign.relicPityCounters.near_orbit).toBe(2);
    expect(scAdvance.profile.campaign.defeatedBossIds).toEqual([]);
    expect(scAdvance.profile.crewMastery.engineer).toBe(0);
    expect(scAdvance.newlyDefeatedBossIds).toEqual([]);
    expect(scAdvance.recoveredRelicThisRun).toBe(false);

    // Tutorial run with a relic MUST NOT mutate relicPityCounters either
    const tutWithRelic: V2RunState = {
      ...createV2TutorialRun('tut_pity_iso'),
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
      bay: {
        ...createV2TutorialRun('tut_pity_iso').bay,
        placed: [{ item: relic, x: 0, y: 0, rotation: 0 }],
      },
    };
    const tutAdv = advanceCampaignAfterRun(
      profile,
      tutWithRelic,
      calculateV2Settlement(tutWithRelic, profile)
    );
    expect(tutAdv.profile.campaign.relicPityCounters.near_orbit).toBe(2);

    // Polish #8: previewSettlementCampaignOutcomes short-circuits on already-settled runId and hides pity-lock copy when sector relics are exhausted
    const slots = buildFreeFallbackPrepareSlots('cannon_skiff', profile.blueprints);
    const exhaustedProfile = makeUnlockedAllProfile({
      relics: {
        ancient_navigator: { storedCount: 0, restored: true },
        cryo_amber: { storedCount: 0, restored: false },
        quantum_core: { storedCount: 0, restored: false },
        obsidian_crown: { storedCount: 0, restored: false },
      },
      campaign: {
        ...createFreshV2Profile().campaign,
        currentAct: 'act1',
        unlockedSectors: ['near_orbit'],
        relicPityCounters: { near_orbit: RELIC_PITY_THRESHOLD },
      },
    });
    const launched = launchV2Expedition({
      profile: exhaustedProfile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots,
      sectorId: 'near_orbit',
      seed: 6060,
    });
    const runDone: V2RunState = {
      ...launched.run!,
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
    };
    const doneSummary = calculateV2Settlement(runDone, launched.profile);
    const exhaustedPreview = previewSettlementCampaignOutcomes(launched.profile, runDone, doneSummary);
    expect(exhaustedPreview.pityLine).not.toContain('下次出航将锁定保底遗物信号');

    const settledRun = applyV2Settlement(launched.profile, runDone);
    const replayPreview = previewSettlementCampaignOutcomes(
      settledRun.profile,
      runDone,
      doneSummary
    );
    expect(replayPreview).toEqual({ headlines: [], pityLine: null });

    // Polish #9: markCampaignCommsRead batches multiple IDs cleanly and returns same reference on replay
    const idsToMark = getUnlockedCampaignComms(profile).map((c) => c.id);
    const afterBatch = markCampaignCommsRead(profile, idsToMark);
    expect(getUnreadCampaignCommsCount(afterBatch)).toBe(0);
    expect(markCampaignCommsRead(afterBatch, idsToMark)).toBe(afterBatch);
  });
});
