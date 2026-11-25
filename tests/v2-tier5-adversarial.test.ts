import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/domain/rng';
import { V3_ACHIEVEMENTS } from '../src/v2/data/achievements';
import { V3_BOSS_ORDER } from '../src/v2/data/bosses';
import { buildSectorEnemyEncounter } from '../src/v2/data/enemies';
import { V3_STATION_FACILITIES } from '../src/v2/data/facilities';
import {
  MAX_ENDLESS_THREAT,
  getEndlessMutatorCountForThreat,
  rollEndlessMutators,
} from '../src/v2/data/sectors';
import { V2_SHIP_ORDER, getShipSignatureCommand, type V2ShipId } from '../src/v2/data/ships';
import { claimV3Achievement } from '../src/v2/domain/achievements';
import {
  commitV2EliteTacticDecision,
  completeV2CombatAtCurrentNode,
  previewV2CombatNode,
  simulateV2Combat,
  startV2CombatAtCurrentNode,
} from '../src/v2/domain/combatV2';
import { upgradeV2EquipmentToImproved } from '../src/v2/domain/dismantle';
import {
  cutV2WreckHotspot,
  initiateV2SafeReturnFromMap,
  selectV2MapNode,
  useV3GadgetInRun,
} from '../src/v2/domain/encounter';
import {
  addV2ItemToStaging,
  createEmptyV2Bay,
  findFirstLegalV2Placement,
  placeV2FromStaging,
} from '../src/v2/domain/inventoryV2';
import { createV2EquipmentInstance, createV3GadgetInstance } from '../src/v2/domain/itemCatalog';
import { buildFreeFallbackPrepareSlots, launchV2Expedition } from '../src/v2/domain/loadout';
import {
  createFreshV2SaveData,
  normalizeV2SaveData,
  validateV2SaveDataDetailed,
} from '../src/v2/domain/persistenceV2';
import { restoreV2Relic, upgradeV3Facility } from '../src/v2/domain/progressionV2';
import {
  applyV2Settlement,
  calculateV2Settlement,
  finalizeClimaxEnding,
} from '../src/v2/domain/settlementV2';
import type { V2EquipmentKind } from '../src/v2/data/equipment';
import type {
  SectorId,
  V2CargoBayState,
  V2ItemInstance,
  V2ProfileState,
  V2RunState,
  V2TacticalCommandId,
} from '../src/v2/domain/types';

function makeEndgameProfile(): V2ProfileState {
  const base = createFreshV2SaveData().profile;
  const laserCommon = createV2EquipmentInstance({
    instanceId: 't5_upgrade_target',
    kind: 'laser',
    quality: 'common',
    origin: 'owned',
    acquiredDepth: 0,
    location: 'warehouse',
  });
  return {
    ...base,
    credits: 1200,
    salvageParts: 200,
    tutorialCompleted: true,
    tutorialBonusClaimed: true,
    unlockedShips: [...V2_SHIP_ORDER],
    unlockedCrew: ['engineer', 'navigator', 'salvager'],
    buildings: {
      workbench: true,
      contract_hub: true,
      drydock: true,
      research_lab: true,
      display: true,
      drydock_tier2: true,
    },
    facilityTiers: {
      workbench: 2,
      contract_hub: 2,
      drydock: 2,
      research_lab: 2,
      display: 2,
      drydock_tier2: 1,
      stargate_relay: 2,
    },
    relics: {
      ...base.relics,
      ancient_navigator: { storedCount: 1, restored: false },
    },
    equipmentWarehouse: [laserCommon],
    achievementsUnlocked: [V3_ACHIEVEMENTS[0].id],
    achievementsClaimed: [],
    campaign: {
      ...base.campaign,
      currentAct: 'endless',
      unlockedSectors: ['near_orbit', 'frozen_graveyard', 'stargate_abyss'],
      defeatedBossIds: ['boss_anvil', 'boss_dreadnought', 'boss_leviathan'],
      endingsUnlocked: ['stargate_reignited'],
      finalMissionUnlocked: true,
      endlessUnlocked: true,
      maxEndlessThreat: 10,
    },
  };
}

function installItem(bay: V2CargoBayState, item: V2ItemInstance): V2CargoBayState {
  const staged = addV2ItemToStaging(bay, item);
  const slot = findFirstLegalV2Placement(staged, item.definitionId);
  expect(slot).not.toBeNull();
  const placed = placeV2FromStaging(staged, item.instanceId, slot!.x, slot!.y, slot!.rotation);
  expect(placed.ok).toBe(true);
  return placed.bay;
}

function makeArmedBayForShip(shipId: V2ShipId): V2CargoBayState {
  let bay = createEmptyV2Bay(shipId);
  const kinds: readonly V2EquipmentKind[] = ['laser', 'battery', 'shield'];
  for (let i = 0; i < kinds.length; i += 1) {
    const inst = createV2EquipmentInstance({
      instanceId: `t5_${shipId}_eq_${i}`,
      kind: kinds[i],
      quality: 'improved',
      origin: 'owned',
      acquiredDepth: 0,
      location: 'staging',
    });
    bay = installItem(bay, inst);
  }
  return bay;
}

describe('M7 Phase 2 · Tier 5 White-Box Adversarial Hardening Suite', () => {
  it('T5-D01: Endless Abyss mutator generation & threat clamping remain deterministic and duplicate-free across 50 seeds × 10 threat tiers', () => {
    for (let threat = 1; threat <= MAX_ENDLESS_THREAT; threat += 1) {
      const expectedCount = getEndlessMutatorCountForThreat(threat);
      expect(expectedCount).toBeGreaterThanOrEqual(1);
      for (let seed = 70001; seed <= 70050; seed += 1) {
        const m1 = rollEndlessMutators(seed, threat);
        const m2 = rollEndlessMutators(seed, threat);
        expect(m1).toEqual(m2);
        expect(m1.length).toBe(expectedCount);
        expect(new Set(m1).size).toBe(m1.length);
      }
    }

    // Persistence normalization clamps out-of-range threat levels strictly into [0..10]
    for (const badThreat of [-5, -1, 11, 999, Number.NaN]) {
      const save = createFreshV2SaveData();
      const raw = {
        ...save,
        profile: {
          ...save.profile,
          campaign: {
            ...save.profile.campaign,
            maxEndlessThreat: badThreat,
          },
        },
      };
      const normalized = normalizeV2SaveData(raw);
      expect(normalized.profile.campaign.maxEndlessThreat).toBeGreaterThanOrEqual(0);
      expect(normalized.profile.campaign.maxEndlessThreat).toBeLessThanOrEqual(MAX_ENDLESS_THREAT);
      expect(validateV2SaveDataDetailed(normalized).ok).toBe(true);
    }
  });

  it('T5-D02: All 4 hulls × 3 Act Bosses × universal & hull-signature commands maintain finite deterministic parity', () => {
    const universalOrders: readonly V2TacticalCommandId[] = [
      'overload',
      'emergency_shield',
      'focus_calibrate',
    ];
    const bossSectorMap: Record<(typeof V3_BOSS_ORDER)[number], SectorId> = {
      boss_anvil: 'near_orbit',
      boss_dreadnought: 'frozen_graveyard',
      boss_leviathan: 'stargate_abyss',
    };

    for (const shipId of V2_SHIP_ORDER) {
      const bay = makeArmedBayForShip(shipId);
      const sigCmd = getShipSignatureCommand(shipId);
      const ordersToTest: readonly V2TacticalCommandId[] = [...universalOrders, sigCmd.choice];

      for (const bossId of V3_BOSS_ORDER) {
        const sectorId = bossSectorMap[bossId];
        const encounter = buildSectorEnemyEncounter(sectorId, 6, bossId, new SeededRng(9100));
        expect(encounter.units.some((u) => u.isBoss)).toBe(true);

        for (const order of ordersToTest) {
          const simA = simulateV2Combat({
            resultId: `t5_${shipId}_${bossId}_${order}_a`,
            bay,
            startingHp: 30,
            maxHp: 38,
            units: encounter.units,
            targetPolicy: 'weakest',
            sectorId,
            bossId,
            encounterKind: bossId,
            tacticalCommands: [{ roundNumber: 2, choice: order }],
          });
          const simB = simulateV2Combat({
            resultId: `t5_${shipId}_${bossId}_${order}_b`,
            bay,
            startingHp: 30,
            maxHp: 38,
            units: encounter.units,
            targetPolicy: 'weakest',
            sectorId,
            bossId,
            encounterKind: bossId,
            tacticalCommands: [{ roundNumber: 2, choice: order }],
          });

          expect(simA.outcome).toBe(simB.outcome);
          expect(simA.finalPlayerHp).toBe(simB.finalPlayerHp);
          expect(simA.finalPlayerHpAfterRepair).toBe(simB.finalPlayerHpAfterRepair);
          expect(simA.roundsCount).toBe(simB.roundsCount);
          expect(Number.isFinite(simA.finalPlayerHp)).toBe(true);
          expect(Number.isFinite(simA.finalPlayerHpAfterRepair)).toBe(true);
          expect(simA.roundsCount).toBeGreaterThanOrEqual(1);
          expect(simA.roundsCount).toBeLessThanOrEqual(30);
        }
      }
    }
  });

  it('T5-D03: 45-run Career Ledger enforces exact 30-entry FIFO ring buffer while aggregate career stats remain strictly monotonic', () => {
    let profile = makeEndgameProfile();
    const settledOrder: string[] = [];

    for (let i = 1; i <= 45; i += 1) {
      const launched = launchV2Expedition({
        profile,
        contractTemplateId: 'free_salvage',
        shipId: 'cannon_skiff',
        crewId: 'engineer',
        primaryArchetype: 'laser',
        sectorId: 'near_orbit',
        slots: buildFreeFallbackPrepareSlots('cannon_skiff', profile.blueprints),
        seed: 80000 + i,
      });
      expect(launched.ok).toBe(true);
      const run: V2RunState = {
        ...launched.run!,
        wallet: launched.run!.wallet + 12,
        salvagePartsEarned: 3,
      };
      const ret = initiateV2SafeReturnFromMap(run);
      expect(ret.ok).toBe(true);

      const prevSafeReturns = profile.career.totalSafeReturns;
      const prevParts = profile.career.totalSalvagePartsEarned;
      const settled = applyV2Settlement(profile, ret.run, {});
      expect(settled.ok).toBe(true);
      profile = settled.profile;
      settledOrder.push(run.runId);

      expect(profile.runHistory.length).toBeLessThanOrEqual(30);
      expect(profile.career.totalSafeReturns).toBe(prevSafeReturns + 1);
      expect(profile.career.totalSalvagePartsEarned).toBe(prevParts + 3);
    }

    expect(profile.runHistory).toHaveLength(30);
    // Most recent entry is run #45 and oldest kept entry is run #16 (runs #1..#15 evicted FIFO)
    const historyRunIds = profile.runHistory.map((e) => e.runId);
    expect(historyRunIds).toContain(settledOrder[44]);
    expect(historyRunIds).toContain(settledOrder[15]);
    expect(historyRunIds).not.toContain(settledOrder[0]);
    expect(historyRunIds).not.toContain(settledOrder[14]);
    expect(profile.career.totalSafeReturns).toBe(45);
  });

  it('T5-D04: Double-invocation idempotency blocks duplicate credits/parts debit or reward grant across 7 core mutators', () => {
    const profile = makeEndgameProfile();

    // 1. Double claimV3Achievement -> second claim rejected with zero duplicate reward
    const achId = V3_ACHIEVEMENTS[0].id;
    const claim1 = claimV3Achievement(profile, achId);
    expect(claim1.ok).toBe(true);
    const creditsAfterClaim1 = claim1.profile.credits;
    const claim2 = claimV3Achievement(claim1.profile, achId);
    expect(claim2.ok).toBe(false);
    expect(claim2.profile.credits).toBe(creditsAfterClaim1);

    // 2. Double restoreV2Relic -> second restore rejected cleanly
    const rest1 = restoreV2Relic(profile, 'ancient_navigator');
    expect(rest1.ok).toBe(true);
    const rest2 = restoreV2Relic(rest1.profile, 'ancient_navigator');
    expect(rest2.ok).toBe(false);
    expect(rest2.profile.credits).toBe(rest1.profile.credits);

    // 3. Double upgradeV2EquipmentToImproved -> second upgrade on same instanceId rejected cleanly
    const upg1 = upgradeV2EquipmentToImproved(profile, 't5_upgrade_target');
    expect(upg1.ok).toBe(true);
    const upg2 = upgradeV2EquipmentToImproved(upg1.profile, 't5_upgrade_target');
    expect(upg2.ok).toBe(false);
    expect(upg2.profile.salvageParts).toBe(upg1.profile.salvageParts);

    // 4. Double upgradeV3Facility when credits & parts only cover 1 tier -> second call rejected without negative balance
    const workbenchTier2 = V3_STATION_FACILITIES.workbench.tiers[1];
    const tightProfile: V2ProfileState = {
      ...profile,
      credits: workbenchTier2.creditCost,
      salvageParts: workbenchTier2.partsCost,
      facilityTiers: { ...profile.facilityTiers, workbench: 1 },
    };
    const fac1 = upgradeV3Facility(tightProfile, 'workbench');
    expect(fac1.ok).toBe(true);
    expect(fac1.profile.credits).toBe(0);
    expect(fac1.profile.salvageParts).toBe(0);
    expect(fac1.profile.facilityTiers.workbench).toBe(2);
    const fac2 = upgradeV3Facility(fac1.profile, 'workbench');
    expect(fac2.ok).toBe(false);
    expect(fac2.profile.credits).toBe(0);
    expect(fac2.profile.salvageParts).toBe(0);
    expect(fac2.profile.facilityTiers.workbench).toBe(2);

    // 5. Double applyV2Settlement on same runId -> strictly idempotent
    const launched = launchV2Expedition({
      profile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      sectorId: 'near_orbit',
      slots: buildFreeFallbackPrepareSlots('cannon_skiff', profile.blueprints),
      seed: 81001,
    });
    expect(launched.ok).toBe(true);
    const ret = initiateV2SafeReturnFromMap({
      ...launched.run!,
      wallet: launched.run!.wallet + 30,
    });
    const set1 = applyV2Settlement(profile, ret.run, {});
    expect(set1.ok).toBe(true);
    const set2 = applyV2Settlement(set1.profile, ret.run, {});
    expect(set2.profile.credits).toBe(set1.profile.credits);
    expect(set2.profile.runHistory.length).toBe(set1.profile.runHistory.length);

    // 6. Double finalizeClimaxEnding on same run -> does not duplicate endingId or double-pay credits
    const climaxRun: V2RunState = {
      ...launched.run!,
      isFinalCampaignRun: true,
      sectorId: 'stargate_abyss',
      defeatedBossIdsThisRun: ['boss_leviathan'],
    };
    const end1 = finalizeClimaxEnding(profile, climaxRun, 'free_haven');
    expect(end1.ok).toBe(true);
    expect(end1.profile.campaign.endingsUnlocked).toContain('free_haven');
    const end2 = finalizeClimaxEnding(end1.profile, climaxRun, 'free_haven');
    expect(end2.profile.campaign.endingsUnlocked.filter((e) => e === 'free_haven')).toHaveLength(1);
    expect(end2.profile.credits).toBe(end1.profile.credits);

    // 7. Double useV3GadgetInRun on same repair_kit instanceId -> consumed once, second rejected
    const kit = createV3GadgetInstance({
      instanceId: 't5_kit_1',
      kind: 'repair_kit',
      origin: 'owned',
      acquiredDepth: 0,
      location: 'staging',
    });
    const gadgetBay = installItem(createEmptyV2Bay('cannon_skiff'), kit);
    const damagedRun: V2RunState = {
      ...launched.run!,
      bay: gadgetBay,
      hp: 15,
      maxHp: 30,
    };
    const use1 = useV3GadgetInRun(damagedRun, 't5_kit_1');
    expect(use1.ok).toBe(true);
    expect(use1.run.hp).toBeGreaterThan(15);
    const use2 = useV3GadgetInRun(use1.run, 't5_kit_1');
    expect(use2.ok).toBe(false);
    expect(use2.run.hp).toBe(use1.run.hp);
  });

  it('T5-D05: Multi-cut Wreck lethal guard, ambush combat preview-execution parity, and defeat 40% tow-back stay mathematically airtight', () => {
    const profile = makeEndgameProfile();
    let testedWreck = false;
    for (let seed = 82001; seed <= 82030 && !testedWreck; seed += 1) {
      const launched = launchV2Expedition({
        profile,
        contractTemplateId: 'free_salvage',
        shipId: 'cannon_skiff',
        crewId: 'engineer',
        primaryArchetype: 'laser',
        sectorId: 'near_orbit',
        slots: buildFreeFallbackPrepareSlots('cannon_skiff', profile.blueprints),
        seed,
      });
      if (!launched.ok || !launched.run) continue;
      const l1Wreck = Object.values(launched.run.graph.nodes).find(
        (n) => n.layer === 1 && n.type === 'wreck',
      );
      if (!l1Wreck) continue;

      const entered = selectV2MapNode(launched.run, l1Wreck.nodeId);
      if (!entered.ok || !entered.run.activeWreck) continue;

      // 1st cut is safe
      const firstCut = cutV2WreckHotspot(entered.run, 'armory', profile.unlockedFamilies, undefined, profile);
      expect(firstCut.ok).toBe(true);
      expect(firstCut.run.hp).toBe(entered.run.hp);

      // Force 1 HP to verify lethal-cut guard blocks any hotspot with riskHullDamage >= current HP
      const riskySpot = firstCut.run.activeWreck?.hotspots.find(
        (h) => !h.cut && h.riskHullDamage >= 1,
      );
      if (riskySpot) {
        const lowHpRun: V2RunState = { ...firstCut.run, hp: 1 };
        const blocked = cutV2WreckHotspot(
          lowHpRun,
          riskySpot.spotId,
          profile.unlockedFamilies,
          undefined,
          profile,
        );
        expect(blocked.ok).toBe(false);
        expect(blocked.run.hp).toBe(1);
        testedWreck = true;
      }

      // If a cut triggers an ambush combat, verify preview === live === completion parity
      const secondSpot = firstCut.run.activeWreck?.hotspots.find((h) => !h.cut);
      if (secondSpot) {
        const secondCut = cutV2WreckHotspot(
          firstCut.run,
          secondSpot.spotId,
          profile.unlockedFamilies,
          undefined,
          profile,
        );
        if (secondCut.ok && secondCut.run.activeWreck?.ambushTriggered) {
          const pv = previewV2CombatNode(secondCut.run, l1Wreck.nodeId, secondCut.run.targetPolicy);
          expect(pv).not.toBeNull();
          const started = startV2CombatAtCurrentNode(secondCut.run, undefined, {
            pureAutoCombat: true,
          });
          expect(started.ok).toBe(true);
          expect(started.run.activeCombat?.simulation.finalPlayerHpAfterRepair).toBe(
            pv!.finalPlayerHpAfterRepair,
          );
          const done = completeV2CombatAtCurrentNode(
            started.run,
            profile.unlockedFamilies,
            started.run.recentEquipmentKinds,
          );
          expect(done.ok).toBe(true);
        }
      }
    }
    expect(testedWreck).toBe(true);

    // Verify tactical command commit and defeat 40% tow-back settlement invariants
    const launchedDefeat = launchV2Expedition({
      profile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      sectorId: 'near_orbit',
      slots: buildFreeFallbackPrepareSlots('cannon_skiff', profile.blueprints),
      seed: 82999,
    });
    expect(launchedDefeat.ok && launchedDefeat.run).toBeTruthy();
    const combatNode = Object.values(launchedDefeat.run!.graph.nodes).find(
      (n) => n.layer === 1 && n.type === 'combat',
    );
    if (combatNode) {
      const atCombat = selectV2MapNode(launchedDefeat.run!, combatNode.nodeId);
      const lowRun: V2RunState = {
        ...atCombat.run,
        hp: 10,
        tacticalChargesMax: 1,
        tacticalChargesUsed: 0,
      };
      const started = startV2CombatAtCurrentNode(lowRun, undefined, { pureAutoCombat: false });
      if (started.ok && started.run.activeCombat?.pendingDecision) {
        const committed = commitV2EliteTacticDecision(
          started.run,
          started.run.activeCombat.pendingDecision.decisionId,
          'emergency_shield',
        );
        expect(committed.ok).toBe(true);
      }
    }
    const defeatSummary = calculateV2Settlement(
      {
        ...launchedDefeat.run!,
        phase: 'SETTLEMENT',
        settlementReason: 'defeat',
        wallet: (launchedDefeat.run!.startingStipendCredits ?? 0) + 50,
        salvagePartsEarned: 8,
      },
      profile,
    );
    expect(defeatSummary.finalCreditsEarned).toBeGreaterThanOrEqual(10);
    expect(defeatSummary.totalSalvagePartsEarned).toBe(Math.floor(8 * 0.2));
  });
});
