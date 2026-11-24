import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/domain/rng';
import { V2_CARGO_DEFS } from '../src/v2/data/cargo';
import { V2_ALL_FORMAL_CONTRACT_TYPES, V2_CONTRACT_TEMPLATES } from '../src/v2/data/contracts';
import {
  V2_ALL_EQUIPMENT_KINDS,
  V2_EQUIPMENT_DEFS,
  getMerchantBuybackPrice,
  getV2EquipmentDefByKind,
} from '../src/v2/data/equipment';
import { V3_EVENT_CATALOG, drawSectorEventPayload } from '../src/v2/data/events';
import {
  V3_FACTION_LEVEL_THRESHOLDS,
  V3_FACTION_MAX_REP,
  V3_FACTION_ORDER,
} from '../src/v2/data/factions';
import { V3_GADGET_DEFS, V3_GADGET_ORDER, getV3GadgetDefByKind } from '../src/v2/data/gadgets';
import { V2_SHIPS, V2_SHIP_ORDER } from '../src/v2/data/ships';
import {
  completeV2CombatAtCurrentNode,
  startV2CombatAtCurrentNode,
} from '../src/v2/domain/combatV2';
import {
  evaluateRunBonusObjective,
  freezeRunBonusObjectiveForSettlement,
  generateContractBonusObjective,
  getAvailableContractBoard,
  isContractReadyForDelivery,
} from '../src/v2/domain/contracts';
import {
  V3_HULL_TUNING_MAX,
  buildActiveWreckStateForNode,
  canCraftV2EquipmentWithParts,
  canDismantleV2Item,
  canTuneV2ShipHull,
  canUpgradeV2Equipment,
  craftV2EquipmentWithParts,
  dismantleV2WarehouseItem,
  evaluateWreckHotspotCut,
  getDismantleSalvagePartsYield,
  getEffectiveShipLoadoutBudget,
  getEffectiveShipMaxHp,
  getHullTuningCost,
  getPartsCraftCost,
  getShipHullTuning,
  getUpgradeToImprovedCost,
  tuneV2ShipHull,
  upgradeV2EquipmentToImproved,
} from '../src/v2/domain/dismantle';
import {
  abandonV2EventAndReturn,
  areAllEventOptionsUnaffordable,
  cutV2WreckHotspot,
  extractV2Wreck,
  pickV2CombatReward,
  selectV2MapNode,
} from '../src/v2/domain/encounter';
import { evaluateV2EventOption, resolveV2EventOption } from '../src/v2/domain/events';
import {
  addFactionRep,
  getDismantlePartsMultiplier,
  getEffectiveMerchantEquipmentPrice,
  getEffectiveMerchantServicePrice,
  getEffectiveWorkshopCost,
  getFactionProgress,
  getFactionRank,
  getGuildContractBonusCredits,
  getMerchantDiscountRate,
  getSurveyInstituteBonusParts,
  getWorkshopDiscountRate,
  getWreckFactionStabilityBonus,
} from '../src/v2/domain/factions';
import {
  createV2CargoInstance,
  createV2EquipmentInstance,
  createV3GadgetInstance,
} from '../src/v2/domain/itemCatalog';
import { buildFreeFallbackPrepareSlots, launchV2Expedition } from '../src/v2/domain/loadout';
import {
  createFreshV2Profile,
  createFreshV2SaveData,
  loadV2SaveData,
  persistV2SaveData,
  validateV2SaveDataDetailed,
  type V2StorageLike,
} from '../src/v2/domain/persistenceV2';
import {
  canCraftV3GadgetWithParts,
  getEffectiveV2CraftCost,
} from '../src/v2/domain/progressionV2';
import {
  applyV2Settlement,
  calculateV2Settlement,
  getAllowedDispositionsForItem,
  getDefaultDispositionForItem,
} from '../src/v2/domain/settlementV2';
import type {
  FactionId,
  SectorId,
  V2ProfileState,
  V2RunState,
  V2SettlementDisposition,
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

function makeM4Profile(overrides: Partial<V2ProfileState> = {}): V2ProfileState {
  const base = createFreshV2Profile();
  return {
    ...base,
    tutorialCompleted: true,
    credits: 1000,
    salvageParts: 500,
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
      workbench: 2,
      contract_hub: 2,
      drydock: 2,
      drydock_tier2: 1,
      research_lab: 2,
      display: 1,
      stargate_relay: 0,
    },
    unlockedShips: ['cannon_skiff', 'shield_cruiser', 'heavy_freighter', 'stargate_cruiser'],
    unlockedCrew: ['engineer', 'navigator', 'salvager'],
    unlockedFamilies: ['core', 'heavy_kit', 'hangar_kit', 'counter_kit'],
    blueprints: [...V2_ALL_EQUIPMENT_KINDS],
    completedContractTypes: ['transport', 'rescue'],
    deepestLayerReached: 5,
    campaign: {
      ...base.campaign,
      currentAct: 'act3',
      unlockedSectors: ['near_orbit', 'frozen_graveyard', 'stargate_abyss'],
    },
    ...overrides,
  };
}

describe('M4 F11: Multi-Cut Derelict Dissection, Ambush Recovery & Persistence', () => {
  it('enforces safe 1st cut, greedy 2nd/3rd stability & risk guards, lethal-cut & fuel guards, optional profile bonuses, and 0-cut safe extraction', () => {
    const baseProfile = makeM4Profile({
      facilityTiers: { ...createFreshV2Profile().facilityTiers, workbench: 3 },
      factionRep: { starport_guild: 0, deep_institute: 0, free_salvagers: 250 }, // Lv3 -> +10 stability
      hullTuning: {
        cannon_skiff: { hpLevel: 0, salvageLevel: 2, budgetLevel: 0 }, // +30 stability
      },
    });
    const launch = launchV2Expedition({
      profile: baseProfile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'salvager',
      primaryArchetype: 'laser',
      slots: buildFreeFallbackPrepareSlots('cannon_skiff', baseProfile.blueprints),
      sectorId: 'near_orbit',
      seed: 4101,
    });
    expect(launch.ok && launch.run).toBeTruthy();
    const run = launch.run!;
    const wreckNode = Object.values(run.graph.nodes).find((n) => n.type === 'wreck' && n.wreck)!;

    // Bug #5 regression check: passing profile directly to cutV2WreckHotspot initializes full stability bonuses
    // 100 base + 30 salvageTuning(2*15) + 10 free_salvagers Lv3 + 10 workbench T3 = 150!
    const directWreckRun: V2RunState = {
      ...run,
      currentNodeId: wreckNode.nodeId,
      phase: 'ENCOUNTER',
      activeWreck: null,
    };
    const builtWithProfile = buildActiveWreckStateForNode(directWreckRun, wreckNode, baseProfile);
    expect(builtWithProfile.wreck.maxStability).toBe(150);

    // 1st cut is ALWAYS safe (0 hull dmg, 0 fuel, 0 ambush) and costs 40 stability
    const eval1 = evaluateWreckHotspotCut(directWreckRun, builtWithProfile.wreck, 'armory');
    expect(eval1.canCut).toBe(true);
    expect(eval1.isFirstSafeCut).toBe(true);
    expect(eval1.effectiveHullDamage).toBe(0);
    expect(eval1.effectiveFuelCost).toBe(0);
    expect(eval1.effectiveAmbushRisk).toBe(false);
    expect(eval1.stabilityCost).toBe(40);

    const cut1 = cutV2WreckHotspot(
      directWreckRun,
      'armory',
      baseProfile.unlockedFamilies,
      undefined,
      baseProfile
    );
    expect(cut1.ok).toBe(true);
    expect(cut1.run.activeWreck!.maxStability).toBe(150);
    expect(cut1.run.activeWreck!.stability).toBe(110); // 150 - 40
    expect(cut1.run.activeWreck!.cutsMade).toBe(1);
    expect(cut1.run.hp).toBe(directWreckRun.hp);
    expect(cut1.run.salvagePartsEarned).toBeGreaterThan(0);
    // Duplicate cut on same spot rejected
    expect(cutV2WreckHotspot(cut1.run, 'armory', baseProfile.unlockedFamilies).ok).toBe(false);

    // Greedy 2nd cut on reactor: requires fuel >= 1 and hp > effectiveHullDamage (5)
    const evalReactorLowFuel = evaluateWreckHotspotCut(
      { ...cut1.run, fuel: 0 },
      cut1.run.activeWreck!,
      'reactor'
    );
    expect(evalReactorLowFuel.canCut).toBe(false);
    expect(evalReactorLowFuel.effectiveFuelCost).toBe(1);

    // Lethal-cut guard: HP <= 5 blocks greedy reactor cut (5 hull dmg)
    const evalReactorLethal = evaluateWreckHotspotCut(
      { ...cut1.run, hp: 5, fuel: 5 },
      cut1.run.activeWreck!,
      'reactor'
    );
    expect(evalReactorLethal.canCut).toBe(false);
    expect(evalReactorLethal.isLethal).toBe(true);

    // Zero stability blocks greedy 2nd cut
    const evalZeroStab = evaluateWreckHotspotCut(
      cut1.run,
      { ...cut1.run.activeWreck!, stability: 0 },
      'cargo'
    );
    expect(evalZeroStab.canCut).toBe(false);

    // 2nd greedy cut on reactor (with sufficient HP & fuel) deducts 35 stability, applies hull dmg + fuel cost, and grants reactor effect
    const cut2 = cutV2WreckHotspot(
      { ...cut1.run, hp: 20, fuel: 4 },
      'reactor',
      baseProfile.unlockedFamilies,
      'fuel'
    );
    expect(cut2.ok).toBe(true);
    expect(cut2.run.activeWreck!.cutsMade).toBe(2);
    expect(cut2.run.activeWreck!.stability).toBe(75); // 110 - 35
    expect(cut2.run.hp).toBe(15); // 20 - 5

    // Reload persistence mid-dissection
    const storage = new MemoryStorage();
    const midDissectionSave = {
      ...createFreshV2SaveData(),
      profile: baseProfile,
      activeRun: cut2.run,
    };
    expect(validateV2SaveDataDetailed(midDissectionSave).ok).toBe(true);
    expect(persistV2SaveData(storage, midDissectionSave).ok).toBe(true);
    const reloaded = loadV2SaveData(storage);
    expect(reloaded.status).toBe('loaded');
    if (reloaded.status !== 'loaded') return;
    expect(reloaded.data.activeRun!.activeWreck!.cutsMade).toBe(2);
    expect(reloaded.data.activeRun!.activeWreck!.stability).toBe(75);

    // Greedy 3rd cut on 'cargo' after reload (deterministic non-ambush path; ambush path tested separately in Test 2):
    // cutsMade >= 2 -> stabilityCost === 25 (75 -> 50), hull damage applied, cutsMade === 3, clean extraction increments wrecksDissectedThisRun!
    const reloadedRun = reloaded.data.activeRun!;
    const runForCut3: V2RunState = {
      ...reloadedRun,
      activeWreck: {
        ...reloadedRun.activeWreck!,
        hotspots: reloadedRun.activeWreck!.hotspots.map((h) =>
          h.spotId === 'cargo' ? { ...h, riskAmbush: false } : h
        ),
      },
    };
    const eval3 = evaluateWreckHotspotCut(runForCut3, runForCut3.activeWreck!, 'cargo');
    expect(eval3.canCut).toBe(true);
    expect(eval3.isFirstSafeCut).toBe(false);
    expect(eval3.stabilityCost).toBe(25);
    expect(eval3.effectiveHullDamage).toBeGreaterThan(0);

    const cut3 = cutV2WreckHotspot(
      runForCut3,
      'cargo',
      baseProfile.unlockedFamilies,
      undefined,
      baseProfile
    );
    expect(cut3.ok).toBe(true);
    expect(cut3.ambushTriggered).toBe(false);
    expect(cut3.run.activeWreck!.cutsMade).toBe(3);
    expect(cut3.run.activeWreck!.stability).toBe(50); // 75 - 25
    expect(cut3.run.hp).toBe(runForCut3.hp - eval3.effectiveHullDamage);

    const ext3 = extractV2Wreck(cut3.run);
    expect(ext3.ok).toBe(true);
    expect(ext3.run.graph.nodes[wreckNode.nodeId].resolved).toBe(true);
    expect(ext3.run.wrecksDissectedThisRun).toBe(1);

    // 0-cut safe extraction (anti-softlock!) succeeds cleanly without incrementing wrecksDissectedThisRun
    const zeroCutExtract = extractV2Wreck({
      ...directWreckRun,
      activeWreck: builtWithProfile.wreck,
    });
    expect(zeroCutExtract.ok).toBe(true);
    expect(zeroCutExtract.run.graph.nodes[wreckNode.nodeId].resolved).toBe(true);
    expect(zeroCutExtract.run.wrecksDissectedThisRun ?? 0).toBe(0);
  });

  it('stashes staging items on wreck ambush, blocks BOTH extractV2Wreck AND abandonV2EventAndReturn during ambush, survives reload, and restores stashed items on pickV2CombatReward', () => {
    const profile = makeM4Profile();
    const launch = launchV2Expedition({
      profile,
      contractTemplateId: 'free_salvage',
      shipId: 'stargate_cruiser',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: buildFreeFallbackPrepareSlots('stargate_cruiser', profile.blueprints),
      sectorId: 'near_orbit',
      seed: 4150,
    });
    const run = launch.run!;
    const wreckNode = Object.values(run.graph.nodes).find((n) => n.type === 'wreck' && n.wreck)!;

    // Build an active wreck where 1st cut stages armory item, and 2nd cut on cargo deterministically triggers ambush!
    const built = buildActiveWreckStateForNode(
      { ...run, currentNodeId: wreckNode.nodeId, phase: 'ENCOUNTER' },
      wreckNode,
      profile
    );
    const forcedAmbushWreck = {
      ...built.wreck,
      hotspots: built.wreck.hotspots.map((h) =>
        h.spotId === 'cargo' ? { ...h, riskAmbush: true, riskHullDamage: 2 } : h
      ),
    };
    const atWreck: V2RunState = {
      ...run,
      currentNodeId: wreckNode.nodeId,
      phase: 'ENCOUNTER',
      activeWreck: forcedAmbushWreck,
      hp: 38,
      maxHp: 38,
    };

    const firstCut = cutV2WreckHotspot(atWreck, 'armory', profile.unlockedFamilies);
    expect(firstCut.ok).toBe(true);
    expect(firstCut.run.bay.staging.length).toBeGreaterThanOrEqual(1);
    const armoryItemId = firstCut.run.bay.staging[0].item.instanceId;

    // 2nd greedy cut triggers ambush!
    const ambushCut = cutV2WreckHotspot(firstCut.run, 'cargo', profile.unlockedFamilies);
    expect(ambushCut.ok).toBe(true);
    expect(ambushCut.ambushTriggered).toBe(true);
    expect(ambushCut.run.activeWreck!.ambushTriggered).toBe(true);
    expect(ambushCut.run.bay.staging.length).toBe(0); // Emptied so combat can start cleanly!
    expect(
      (ambushCut.run.activeWreck!.stashedItems ?? []).some((i) => i.instanceId === armoryItemId)
    ).toBe(true);
    expect(ambushCut.run.graph.nodes[wreckNode.nodeId].combat).toBeDefined();

    // BOTH extractV2Wreck AND abandonV2EventAndReturn MUST be blocked during ambush (Bug #2 fix!)
    expect(extractV2Wreck(ambushCut.run).ok).toBe(false);
    expect(abandonV2EventAndReturn(ambushCut.run).ok).toBe(false);

    // Mid-ambush state survives full save/reload round-trip
    const storage = new MemoryStorage();
    expect(
      persistV2SaveData(storage, {
        ...createFreshV2SaveData(),
        profile,
        activeRun: ambushCut.run,
      }).ok
    ).toBe(true);
    const reloadedAmbush = loadV2SaveData(storage);
    expect(reloadedAmbush.status).toBe('loaded');
    if (reloadedAmbush.status !== 'loaded') return;
    const restoredAmbushRun = reloadedAmbush.data.activeRun!;
    expect(restoredAmbushRun.activeWreck!.ambushTriggered).toBe(true);
    expect(abandonV2EventAndReturn(restoredAmbushRun).ok).toBe(false);

    // Fight & win the ambush -> pickV2CombatReward restores ALL stashed items back into staging!
    const started = startV2CombatAtCurrentNode(restoredAmbushRun, 'weakest', {
      pureAutoCombat: true,
    });
    expect(started.ok).toBe(true);
    expect(started.run.activeCombat!.simulation.outcome).toBe('victory');
    const done = completeV2CombatAtCurrentNode(started.run, profile.unlockedFamilies);
    expect(done.ok).toBe(true);
    expect(done.run.phase).toBe('REWARD');

    const rewarded = pickV2CombatReward(done.run, 'repair', profile.unlockedFamilies);
    expect(rewarded.ok).toBe(true);
    expect(rewarded.run.activeWreck).toBeNull();
    expect(rewarded.run.wrecksDissectedThisRun).toBe(1);
    expect(rewarded.run.bay.staging.some((s) => s.item.instanceId === armoryItemId)).toBe(true);
  });
});

describe('M4 F11: Salvage Parts Dismantling, Refining, Parts Crafting & 3-Track Hull Tuning', () => {
  it('protects loan, mission, and all 4 collectible relics from dismantling while supporting Settlement & Workshop dismantling, defeat 40% recovery, refining, parts crafting, and 3-track hull tuning', () => {
    const profile = makeM4Profile({ credits: 400, salvageParts: 300 });

    // Strict protection: loan, mission, and all 4 collectible relics CANNOT be dismantled!
    const loanItem = createV2EquipmentInstance({
      instanceId: 'p_loan',
      kind: 'laser',
      quality: 'common',
      origin: 'loan',
      acquiredDepth: 0,
      location: 'bay',
    });
    const missionItem = createV2CargoInstance({
      instanceId: 'p_mission',
      defId: 'mission.black_box',
      origin: 'mission',
      acquiredDepth: 4,
      location: 'bay',
    });
    expect(canDismantleV2Item(loanItem).ok).toBe(false);
    expect(canDismantleV2Item(missionItem).ok).toBe(false);

    const relicDefIds = [
      'cargo.ancient_navigator',
      'cargo.quantum_core',
      'cargo.cryo_amber',
      'cargo.obsidian_crown',
    ];
    for (const defId of relicDefIds) {
      const relicInst = createV2CargoInstance({
        instanceId: `rel_${defId}`,
        defId,
        origin: 'loot',
        acquiredDepth: 4,
        location: 'bay',
      });
      expect(canDismantleV2Item(relicInst).ok).toBe(false);
      expect(getDismantleSalvagePartsYield(relicInst, profile)).toBe(0);
      expect(
        getAllowedDispositionsForItem(relicInst, 'safe_return', profile, false)
      ).not.toContain('dismantle');
    }

    // Settlement dismantling: allowed for loot equipment/cargo/gadget, NEVER default
    const lootEq = createV2EquipmentInstance({
      instanceId: 'settle_eq_1',
      kind: 'heavy',
      quality: 'common',
      origin: 'loot',
      acquiredDepth: 3,
      location: 'bay',
    });
    const lootCargo = createV2CargoInstance({
      instanceId: 'settle_cg_1',
      defId: 'cargo.old_engine',
      origin: 'loot',
      acquiredDepth: 3,
      location: 'bay',
    });
    expect(getDefaultDispositionForItem(lootEq, 'safe_return', false, profile)).toBe('sell');
    expect(getAllowedDispositionsForItem(lootEq, 'safe_return', profile, false)).toContain(
      'dismantle'
    );
    expect(getDefaultDispositionForItem(lootCargo, 'safe_return', false, profile)).toBe('sell');
    expect(getAllowedDispositionsForItem(lootCargo, 'safe_return', profile, false)).toContain(
      'dismantle'
    );

    const launch = launchV2Expedition({
      profile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: [],
      sectorId: 'near_orbit',
      seed: 4201,
    });
    const settleRun: V2RunState = {
      ...launch.run!,
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
      salvagePartsEarned: 25,
      wrecksDissectedThisRun: 2,
      bay: {
        ...launch.run!.bay,
        placed: [
          { item: lootEq, x: 0, y: 0, rotation: 0 },
          { item: lootCargo, x: 1, y: 0, rotation: 0 },
        ],
      },
    };
    const overrides: Record<string, V2SettlementDisposition> = {
      [lootEq.instanceId]: 'dismantle',
      [lootCargo.instanceId]: 'dismantle',
    };
    const sum = calculateV2Settlement(settleRun, profile, overrides);
    const expectedDismantleParts =
      getDismantleSalvagePartsYield(lootEq, profile, 'cannon_skiff') +
      getDismantleSalvagePartsYield(lootCargo, profile, 'cannon_skiff');
    expect(sum.dismantledPartsEarned).toBe(expectedDismantleParts);
    expect(sum.dismantledItemsCount).toBe(2);
    expect(sum.totalSalvagePartsEarned).toBe(25 + expectedDismantleParts);

    const applied = applyV2Settlement(profile, settleRun, overrides);
    expect(applied.ok).toBe(true);
    expect(applied.profile.salvageParts).toBe(profile.salvageParts + 25 + expectedDismantleParts);
    expect(applied.profile.career.totalItemsDismantled).toBe(2);
    expect(applied.profile.career.totalWrecksDissected).toBe(2);

    // Defeat recovers 40% of runSalvagePartsEarned and 0 dismantled items
    const defeatSum = calculateV2Settlement(
      { ...settleRun, settlementReason: 'defeat', hp: 0 },
      profile
    );
    expect(defeatSum.runSalvagePartsEarned).toBe(Math.floor(25 * 0.4));
    expect(defeatSum.dismantledPartsEarned).toBe(0);
    expect(defeatSum.totalSalvagePartsEarned).toBe(10);

    // Workshop: Parts crafting (0 credits) -> Refining Common -> Improved (0 credits) -> Dismantling
    const craftCheck = canCraftV2EquipmentWithParts(profile, 'laser');
    expect(craftCheck.canCraft).toBe(true);
    expect(craftCheck.cost.credits).toBe(0);
    const crafted = craftV2EquipmentWithParts(profile, 'laser', 'm4_test');
    expect(crafted.ok).toBe(true);
    expect(crafted.profile.credits).toBe(profile.credits); // 0 credits spent!
    expect(crafted.profile.salvageParts).toBe(profile.salvageParts - craftCheck.cost.parts);
    const craftedInst = crafted.profile.equipmentWarehouse[0];
    expect(craftedInst.instanceId).toBe('craftp_laser_m4_test');
    expect(craftedInst.quality).toBe('common');

    // Refine Common -> Improved (preserves exact instanceId, 0 credits)
    const upgCheck = canUpgradeV2Equipment(crafted.profile, craftedInst.instanceId);
    expect(upgCheck.canUpgrade).toBe(true);
    expect(upgCheck.cost!.credits).toBe(0);
    const refined = upgradeV2EquipmentToImproved(crafted.profile, craftedInst.instanceId);
    expect(refined.ok).toBe(true);
    expect(refined.profile.credits).toBe(profile.credits);
    expect(refined.profile.equipmentWarehouse[0].instanceId).toBe(craftedInst.instanceId);
    expect(refined.profile.equipmentWarehouse[0].quality).toBe('improved');
    expect(refined.profile.discoveredItems).toContain('equipment.laser.improved');
    expect(refined.profile.seenItems).toContain('equipment.laser.improved');
    // Refining already-improved item is blocked
    expect(canUpgradeV2Equipment(refined.profile, craftedInst.instanceId).canUpgrade).toBe(false);

    // Workshop dismantle
    const beforeDismantleParts = refined.profile.salvageParts;
    const dismantled = dismantleV2WarehouseItem(refined.profile, craftedInst.instanceId);
    expect(dismantled.ok).toBe(true);
    expect(dismantled.profile.equipmentWarehouse.length).toBe(0);
    expect(dismantled.profile.salvageParts).toBe(beforeDismantleParts + dismantled.partsGained!);
    expect(dismantled.profile.career.totalItemsDismantled).toBe(1);

    // 3-Track Hull Tuning: hp (max 3), salvage (max 2), budget (max 1), plus guards
    let tuned = makeM4Profile({
      salvageParts: 1000,
      unlockedShips: ['cannon_skiff'],
      credits: 500,
    });
    // Locked ship rejected
    expect(canTuneV2ShipHull(tuned, 'stargate_cruiser', 'hp').canTune).toBe(false);

    // Max out HP track (3 levels -> +6 maxHp)
    for (let lv = 1; lv <= V3_HULL_TUNING_MAX.hp; lv += 1) {
      const cost = getHullTuningCost('hp', lv, tuned);
      expect(cost.credits).toBe(0);
      const res = tuneV2ShipHull(tuned, 'cannon_skiff', 'hp');
      expect(res.ok).toBe(true);
      tuned = res.profile;
    }
    expect(getShipHullTuning(tuned, 'cannon_skiff').hpLevel).toBe(3);
    expect(getEffectiveShipMaxHp(tuned, 'cannon_skiff')).toBe(V2_SHIPS.cannon_skiff.maxHp + 6);
    expect(canTuneV2ShipHull(tuned, 'cannon_skiff', 'hp').canTune).toBe(false);

    // Max out salvage (2) & budget (1)
    tuned = tuneV2ShipHull(tuned, 'cannon_skiff', 'salvage').profile;
    tuned = tuneV2ShipHull(tuned, 'cannon_skiff', 'salvage').profile;
    expect(getShipHullTuning(tuned, 'cannon_skiff').salvageLevel).toBe(2);
    expect(canTuneV2ShipHull(tuned, 'cannon_skiff', 'salvage').canTune).toBe(false);

    tuned = tuneV2ShipHull(tuned, 'cannon_skiff', 'budget').profile;
    expect(getShipHullTuning(tuned, 'cannon_skiff').budgetLevel).toBe(1);
    expect(getEffectiveShipLoadoutBudget(tuned, 'cannon_skiff')).toBe(
      V2_SHIPS.cannon_skiff.loadoutBudget + 1
    );
    expect(canTuneV2ShipHull(tuned, 'cannon_skiff', 'budget').canTune).toBe(false);
    expect(tuned.credits).toBe(500); // Zero credits spent on hull tuning!
  });
});

describe('M4 F12: All 18 Crew-Reactive Sector Events, usedEventIds & Safe Fallbacks', () => {
  it('verifies all 18 events (6/sector, 9 anomaly + 9 distress), crew bonuses, non-repeating draw, strict unaffordable/lethal gating, and zero-cost fallbacks', () => {
    expect(V3_EVENT_CATALOG.length).toBe(18);
    const uniqueIds = new Set(V3_EVENT_CATALOG.map((e) => e.eventId));
    expect(uniqueIds.size).toBe(18);

    const sectors: readonly SectorId[] = ['near_orbit', 'frozen_graveyard', 'stargate_abyss'];
    for (const s of sectors) {
      const inSector = V3_EVENT_CATALOG.filter((e) => e.sectorId === s);
      expect(inSector.length).toBe(6);
      expect(inSector.filter((e) => e.nodeType === 'anomaly').length).toBe(3);
      expect(inSector.filter((e) => e.nodeType === 'distress').length).toBe(3);
    }

    // Every event MUST have >=1 crew-specific bonus option AND >=1 zero-cost isFallback: true option
    const crewCounts: Record<string, number> = { engineer: 0, navigator: 0, salvager: 0 };
    for (const evt of V3_EVENT_CATALOG) {
      const fallbacks = evt.options.filter((o) => o.isFallback === true);
      expect(fallbacks.length).toBeGreaterThanOrEqual(1);
      for (const fb of fallbacks) {
        expect(fb.fuelCost ?? 0).toBe(0);
        expect(fb.hpCost ?? 0).toBe(0);
        expect(fb.walletCost ?? 0).toBe(0);
      }
      const crewOpts = evt.options.filter((o) => Boolean(o.requiredCrewId));
      expect(crewOpts.length).toBeGreaterThanOrEqual(1);
      for (const co of crewOpts) {
        crewCounts[co.requiredCrewId!] += 1;
      }
    }
    expect(crewCounts.engineer).toBeGreaterThanOrEqual(3);
    expect(crewCounts.navigator).toBeGreaterThanOrEqual(3);
    expect(crewCounts.salvager).toBeGreaterThanOrEqual(3);

    // Non-repeating draw across all 3 anomaly events in near_orbit via usedEventIds
    const rng = new SeededRng(4301);
    const used: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const draw = drawSectorEventPayload('near_orbit', 'anomaly', used, rng, { layer: 2 });
      expect(used).not.toContain(draw.eventId);
      used.push(draw.eventId);
    }
    expect(new Set(used).size).toBe(3);

    // Strict option evaluation: fallback always enabled; crew/fuel/wallet/lethal-HP strictly gated!
    const crewOpt = {
      index: 0,
      label: '林工接入',
      costSummary: '工程师专属',
      rewardSummary: '+15¤',
      requiredCrewId: 'engineer' as const,
      rewardCredits: 15,
    };
    const hpOpt = {
      index: 1,
      label: '强行穿越',
      costSummary: '-5 HP',
      rewardSummary: '+20¤',
      hpCost: 5,
      rewardCredits: 20,
    };
    const fuelWalletOpt = {
      index: 2,
      label: '高价交易',
      costSummary: '-2 油 / -30¤',
      rewardSummary: '货物',
      fuelCost: 2,
      walletCost: 30,
    };
    const fallbackOpt = {
      index: 3,
      label: '安全绕行',
      costSummary: '无消耗',
      rewardSummary: '安全撤离',
      isFallback: true,
    };

    expect(
      evaluateV2EventOption({ crewId: 'navigator', fuel: 5, hp: 20, wallet: 100 }, crewOpt).enabled
    ).toBe(false);
    expect(
      evaluateV2EventOption({ crewId: 'engineer', fuel: 5, hp: 20, wallet: 100 }, crewOpt).enabled
    ).toBe(true);
    // Strict lethal HP guard: hp === hpCost (5) is BLOCKED; hp === hpCost + 1 (6) is ALLOWED!
    expect(
      evaluateV2EventOption({ crewId: 'engineer', fuel: 5, hp: 5, wallet: 100 }, hpOpt).enabled
    ).toBe(false);
    expect(
      evaluateV2EventOption({ crewId: 'engineer', fuel: 5, hp: 6, wallet: 100 }, hpOpt).enabled
    ).toBe(true);
    // Fuel & wallet gates
    expect(
      evaluateV2EventOption({ crewId: 'engineer', fuel: 1, hp: 20, wallet: 100 }, fuelWalletOpt)
        .enabled
    ).toBe(false);
    expect(
      evaluateV2EventOption({ crewId: 'engineer', fuel: 5, hp: 20, wallet: 20 }, fuelWalletOpt)
        .enabled
    ).toBe(false);
    // Fallback is ALWAYS enabled even at fuel=0, hp=1, wallet=0!
    expect(
      evaluateV2EventOption({ crewId: null, fuel: 0, hp: 1, wallet: 0 }, fallbackOpt).enabled
    ).toBe(true);

    // Live resolveV2EventOption records usedEventIds & enforces idempotency
    const profile = makeM4Profile();
    const launch = launchV2Expedition({
      profile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: buildFreeFallbackPrepareSlots('cannon_skiff', profile.blueprints),
      sectorId: 'near_orbit',
      seed: 4309,
    });
    const run = launch.run!;
    const drawn = drawSectorEventPayload('near_orbit', 'anomaly', [], new SeededRng(99), {
      layer: 2,
      nodeId: 'L2A',
    });
    const nodeWithEvent = {
      ...run.graph.nodes['L2A'],
      type: 'anomaly' as const,
      eventId: drawn.eventId,
      eventState: drawn.eventState,
      anomaly: drawn.anomaly,
      combat: undefined,
      wreck: undefined,
    };
    const atEvent: V2RunState = {
      ...run,
      currentNodeId: 'L2A',
      phase: 'ENCOUNTER',
      fuel: 0,
      hp: 1,
      wallet: 0,
      graph: { ...run.graph, nodes: { ...run.graph.nodes, L2A: nodeWithEvent } },
    };
    // Because drawn event has isFallback: true, areAllEventOptionsUnaffordable is FALSE
    expect(areAllEventOptionsUnaffordable(atEvent)).toBe(false);
    // Stripping fallback options makes areAllEventOptionsUnaffordable TRUE
    const noFallbackEvent = {
      ...drawn.eventState,
      options: drawn.eventState.options.filter((o) => !o.isFallback),
    };
    const stuckEventRun: V2RunState = {
      ...atEvent,
      crewId: null,
      activeEvent: noFallbackEvent,
    };
    expect(areAllEventOptionsUnaffordable(stuckEventRun)).toBe(true);

    const fbIdx = drawn.eventState.options.findIndex((o) => o.isFallback);
    const resolved = resolveV2EventOption(atEvent, fbIdx, profile.unlockedFamilies);
    expect(resolved.ok).toBe(true);
    expect(resolved.run.usedEventIds).toContain(drawn.eventId);
    // Idempotency: resolving same node again fails
    expect(resolveV2EventOption(resolved.run, fbIdx, profile.unlockedFamilies).ok).toBe(false);

    // Reviewer 2 polish: direct resolveV2EventOption rejects unaffordable / wrong-crew indices,
    // and matching crew-specific bonus option resolves with its expected reward!
    const blackboxDrawn = drawSectorEventPayload(
      'near_orbit',
      'anomaly',
      ['evt_smuggler_dock', 'evt_unstable_reactor'],
      new SeededRng(101),
      { layer: 2, nodeId: 'L2A' }
    );
    expect(blackboxDrawn.eventId).toBe('evt_blackbox_decode');
    const blackboxNode = {
      ...nodeWithEvent,
      resolved: false,
      eventId: blackboxDrawn.eventId,
      eventState: blackboxDrawn.eventState,
      anomaly: blackboxDrawn.anomaly,
    };
    const atBlackboxWrongCrew: V2RunState = {
      ...atEvent,
      crewId: 'salvager',
      fuel: 0,
      wallet: 10,
      salvagePartsEarned: 0,
      graph: { ...atEvent.graph, nodes: { ...atEvent.graph.nodes, L2A: blackboxNode } },
    };
    // Option 0 costs 1 fuel (unaffordable at fuel=0) -> rejected!
    expect(resolveV2EventOption(atBlackboxWrongCrew, 0, profile.unlockedFamilies).ok).toBe(false);
    // Option 1 requires engineer (crewId='salvager') -> rejected!
    expect(resolveV2EventOption(atBlackboxWrongCrew, 1, profile.unlockedFamilies).ok).toBe(false);

    // Matching crew (engineer) resolves option 1 with +25¤ wallet, +6 parts, and 1 staged equipment!
    const atBlackboxEngineer: V2RunState = {
      ...atBlackboxWrongCrew,
      crewId: 'engineer',
    };
    const crewResolved = resolveV2EventOption(atBlackboxEngineer, 1, profile.unlockedFamilies);
    expect(crewResolved.ok).toBe(true);
    expect(crewResolved.run.wallet).toBe(35); // 10 + 25
    expect(crewResolved.run.salvagePartsEarned).toBe(6);
    expect(crewResolved.gainedItemsCount).toBe(1);
    expect(crewResolved.run.bay.staging.length).toBeGreaterThanOrEqual(1);
  });
});

describe('M4 F13: All 3 Factions, Rep Perks & Exhaustive Anti-Arbitrage Proof', () => {
  it('verifies all 3 Orbital Factions, Lv1-Lv3 thresholds (0/100/220), clamping (0..300), and exact perks', () => {
    expect(V3_FACTION_ORDER).toEqual(['starport_guild', 'deep_institute', 'free_salvagers']);
    expect(V3_FACTION_LEVEL_THRESHOLDS).toEqual([0, 100, 220]);
    expect(V3_FACTION_MAX_REP).toBe(300);

    // Threshold boundaries & clamping
    expect(getFactionRank(0)).toBe(1);
    expect(getFactionRank(99)).toBe(1);
    expect(getFactionRank(100)).toBe(2);
    expect(getFactionRank(219)).toBe(2);
    expect(getFactionRank(220)).toBe(3);
    expect(getFactionRank(300)).toBe(3);
    expect(getFactionProgress(150).nextThreshold).toBe(220);
    expect(getFactionProgress(220).nextThreshold).toBeNull();

    const baseRep: Record<FactionId, number> = {
      starport_guild: 0,
      deep_institute: 50,
      free_salvagers: 290,
    };
    expect(addFactionRep(baseRep, 'free_salvagers', 50).free_salvagers).toBe(300);
    expect(addFactionRep(baseRep, 'starport_guild', -40).starport_guild).toBe(0);

    // Starport Guild perks
    expect(getMerchantDiscountRate(0)).toBe(0);
    expect(getMerchantDiscountRate(100)).toBe(0.1);
    expect(getMerchantDiscountRate(220)).toBe(0.15);
    expect(getEffectiveMerchantServicePrice(20, 0)).toBe(20);
    expect(getEffectiveMerchantServicePrice(20, 220)).toBe(17);
    expect(
      getGuildContractBonusCredits({ factionId: 'starport_guild', rewardCredits: 85 }, 220)
    ).toBe(9);
    expect(
      getGuildContractBonusCredits({ factionId: 'deep_institute', rewardCredits: 85 }, 220)
    ).toBe(0);

    // Deep Institute perks
    expect(getWorkshopDiscountRate(0)).toBe(0);
    expect(getWorkshopDiscountRate(100)).toBe(0.15);
    expect(getWorkshopDiscountRate(220)).toBe(0.25);
    expect(getEffectiveWorkshopCost(40, 220)).toBe(30);
    expect(getSurveyInstituteBonusParts({ type: 'survey' }, 219)).toBe(0);
    expect(getSurveyInstituteBonusParts({ type: 'survey' }, 220)).toBe(6);
    expect(getSurveyInstituteBonusParts({ type: 'bounty' }, 220)).toBe(0);

    // Free Salvagers perks
    expect(getDismantlePartsMultiplier(0)).toBe(1.0);
    expect(getDismantlePartsMultiplier(100)).toBe(1.2);
    expect(getDismantlePartsMultiplier(220)).toBe(1.35);
    expect(getWreckFactionStabilityBonus(219)).toBe(0);
    expect(getWreckFactionStabilityBonus(220)).toBe(10);
  });

  it('PROVES zero arbitrage exhaustively across ALL 32 equipment defs, ALL 4 gadgets, ALL faction ranks, ALL Workbench tiers (T0-T3), and ALL Hull Salvage Tuning levels (0..2)', () => {
    const repLevels = [0, 100, 220] as const;
    const wbTiers = [0, 1, 2, 3] as const;
    const salvageLevels = [0, 1, 2] as const;

    // 1. Merchant Buy vs Merchant Buyback AND vs Base Sell across all 32 equipment defs & all 4 gadgets & all Guild ranks
    for (const guildRep of repLevels) {
      for (const def of Object.values(V2_EQUIPMENT_DEFS)) {
        const effBuy = getEffectiveMerchantEquipmentPrice(
          def.shopBuyPrice,
          def.recycleValue,
          guildRep
        );
        const buyback = getMerchantBuybackPrice(def.recycleValue);
        expect(effBuy).toBeGreaterThanOrEqual(buyback + 2);
        expect(effBuy).toBeGreaterThan(def.recycleValue);
      }
      for (const gDef of Object.values(V3_GADGET_DEFS)) {
        const effBuy = getEffectiveMerchantEquipmentPrice(
          gDef.shopBuyPrice,
          gDef.fixedValue,
          guildRep
        );
        const buyback = getMerchantBuybackPrice(gDef.fixedValue);
        expect(effBuy).toBeGreaterThanOrEqual(buyback + 2);
        expect(effBuy).toBeGreaterThan(gDef.fixedValue);
      }
    }

    // 2. Exhaustive Parts Craft, Gadget Parts Craft, Refine, and Credit Craft vs Dismantle/Sell across EVERY combo!
    for (const wbTier of wbTiers) {
      for (const deepRep of repLevels) {
        for (const salvRep of repLevels) {
          for (const salvLv of salvageLevels) {
            const testProfile = makeM4Profile({
              salvageParts: 9999,
              credits: 9999,
              buildings: {
                workbench: wbTier >= 1,
                contract_hub: true,
                drydock: true,
                research_lab: true,
                display: true,
                drydock_tier2: true,
              },
              facilityTiers: {
                workbench: wbTier,
                contract_hub: 2,
                drydock: 3,
                drydock_tier2: 1,
                research_lab: 3,
                display: 3,
                stargate_relay: 3,
              },
              factionRep: {
                starport_guild: 220,
                deep_institute: deepRep,
                free_salvagers: salvRep,
              },
              hullTuning: Object.fromEntries(
                V2_SHIP_ORDER.map((s) => [s, { hpLevel: 3, salvageLevel: salvLv, budgetLevel: 1 }])
              ),
            });

            // A. All 16 equipment kinds: parts craft, refine, credit craft
            for (const kind of V2_ALL_EQUIPMENT_KINDS) {
              const commonDef = getV2EquipmentDefByKind(kind, 'common');
              const commonItem = createV2EquipmentInstance({
                instanceId: `arb_c_${kind}`,
                kind,
                quality: 'common',
                origin: 'owned',
                acquiredDepth: 0,
                location: 'warehouse',
              });
              const improvedItem = createV2EquipmentInstance({
                instanceId: `arb_i_${kind}`,
                kind,
                quality: 'improved',
                origin: 'owned',
                acquiredDepth: 0,
                location: 'warehouse',
              });

              const partsCraftCost = getPartsCraftCost(kind, testProfile).parts;
              const refineCost = getUpgradeToImprovedCost(commonDef, testProfile).parts;
              const creditCraftCost = getEffectiveV2CraftCost(testProfile, kind);

              for (const shipId of V2_SHIP_ORDER) {
                const dismantleCommon = getDismantleSalvagePartsYield(
                  commonItem,
                  testProfile,
                  shipId
                );
                const dismantleImproved = getDismantleSalvagePartsYield(
                  improvedItem,
                  testProfile,
                  shipId
                );
                // Bug #1 core invariant: crafting common with parts MUST cost >= dismantle + 2!
                expect(partsCraftCost).toBeGreaterThanOrEqual(dismantleCommon + 2);
                // Refining common -> improved MUST cost strictly > dismantle delta!
                expect(refineCost).toBeGreaterThan(dismantleImproved - dismantleCommon);
                // Crafting + Refining -> Dismantling improved MUST still lose parts!
                expect(partsCraftCost + refineCost).toBeGreaterThan(dismantleImproved);
              }
              // Credit craft vs base sell & merchant buyback
              expect(creditCraftCost).toBeGreaterThan(commonDef.recycleValue);
              expect(creditCraftCost).toBeGreaterThan(getMerchantBuybackPrice(commonDef.recycleValue));
            }

            // B. All 4 gadgets: parts craft vs dismantle yield across all ships
            for (const gKind of V3_GADGET_ORDER) {
              const gadgetItem = createV3GadgetInstance({
                instanceId: `arb_g_${gKind}`,
                kind: gKind,
                origin: 'owned',
                acquiredDepth: 0,
                location: 'warehouse',
              });
              const gCheck = canCraftV3GadgetWithParts(testProfile, gKind);
              for (const shipId of V2_SHIP_ORDER) {
                const dismantleGadget = getDismantleSalvagePartsYield(
                  gadgetItem,
                  testProfile,
                  shipId
                );
                expect(gCheck.partsCost).toBeGreaterThanOrEqual(dismantleGadget + 2);
              }
              const gDef = getV3GadgetDefByKind(gKind);
              expect(gDef.shopBuyPrice).toBeGreaterThan(gDef.fixedValue);
            }
          }
        }
      }
    }
  });
});

describe('M4 F13: All 5 Formal Contract Types & Frozen +30% Optional Bonus Objectives', () => {
  it('supports all 5 standard contracts (incl. bounty_std & derelict_std black_box) and freezes all 4 +30% Bonus Objectives with Hub T3 multiplier & unpaid guards', () => {
    const profile = makeM4Profile({
      facilityTiers: { ...createFreshV2Profile().facilityTiers, contract_hub: 3, research_lab: 2 },
    });
    const board = getAvailableContractBoard(profile);
    expect(V2_ALL_FORMAL_CONTRACT_TYPES).toEqual([
      'transport',
      'rescue',
      'survey',
      'bounty',
      'derelict',
    ]);
    expect(board.standardTemplates.map((t) => t.templateId)).toEqual([
      'transport_std',
      'rescue_std',
      'survey_std',
      'bounty_std',
      'derelict_std',
    ]);
    expect(board.deepTemplates.length).toBe(3);

    // Verify +30% bonus objective reward math across templates (undefined for free_salvage)
    expect(generateContractBonusObjective(V2_CONTRACT_TEMPLATES.free_salvage, 10)).toBeUndefined();
    expect(generateContractBonusObjective(V2_CONTRACT_TEMPLATES.transport_std, 10)!.rewardCredits).toBe(
      21
    );
    expect(generateContractBonusObjective(V2_CONTRACT_TEMPLATES.bounty_std, 10)!.rewardCredits).toBe(
      26
    );
    expect(generateContractBonusObjective(V2_CONTRACT_TEMPLATES.transport_deep, 10)!.rewardCredits).toBe(
      36
    );

    // 1. Bounty contract: defeating combat at marked node completes contract!
    const bountyLaunch = launchV2Expedition({
      profile,
      contractTemplateId: 'bounty_std',
      shipId: 'stargate_cruiser',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: buildFreeFallbackPrepareSlots('stargate_cruiser', profile.blueprints),
      sectorId: 'near_orbit',
      seed: 4501,
    });
    expect(bountyLaunch.ok && bountyLaunch.run).toBeTruthy();
    const bRun = bountyLaunch.run!;
    const bountyTargetId = bRun.contract.markedNodeIds[0];
    expect(bRun.graph.nodes[bountyTargetId].type).toBe('combat');
    const atBounty: V2RunState = {
      ...bRun,
      currentNodeId: bountyTargetId,
      phase: 'ENCOUNTER',
    };
    const bStart = startV2CombatAtCurrentNode(atBounty, 'weakest', { pureAutoCombat: true });
    const bDone = completeV2CombatAtCurrentNode(bStart.run, profile.unlockedFamilies);
    const bPick = pickV2CombatReward(bDone.run, 'repair', profile.unlockedFamilies);
    expect(bPick.run.contract.completedNodeIds).toContain(bountyTargetId);
    expect(isContractReadyForDelivery(bPick.run, 'safe_return')).toBe(true);

    // 2. Derelict contract: extracting marked wreck spawns mission.black_box!
    const derelictLaunch = launchV2Expedition({
      profile,
      contractTemplateId: 'derelict_std',
      shipId: 'cannon_skiff',
      crewId: 'salvager',
      primaryArchetype: 'laser',
      slots: buildFreeFallbackPrepareSlots('cannon_skiff', profile.blueprints),
      sectorId: 'near_orbit',
      seed: 4502,
    });
    const dRun = derelictLaunch.run!;
    const derelictTargetId = dRun.contract.markedNodeIds[0];
    expect(dRun.graph.nodes[derelictTargetId].type).toBe('wreck');
    const enteredWreck = selectV2MapNode(
      {
        ...dRun,
        currentNodeId: Object.values(dRun.graph.nodes).find((n) =>
          n.nextNodeIds.includes(derelictTargetId)
        )!.nodeId,
        phase: 'MAP',
        graph: {
          ...dRun.graph,
          nodes: Object.fromEntries(
            Object.entries(dRun.graph.nodes).map(([k, v]) => [
              k,
              k === derelictTargetId ? { ...v, resolved: false } : { ...v, resolved: true },
            ])
          ),
        },
      },
      derelictTargetId,
      { profile }
    );
    expect(enteredWreck.ok).toBe(true);
    const extracted = extractV2Wreck(enteredWreck.run);
    expect(extracted.ok).toBe(true);
    expect(
      extracted.run.bay.staging.some((s) => s.item.definitionId === 'mission.black_box')
    ).toBe(true);
    expect(V2_CARGO_DEFS['mission.black_box']).toBeDefined();

    // 3. Evaluate ALL 4 Bonus Objective types + freeze-at-settlement + Hub T3 1.1x + +10 rep + unpaid guards
    const bonusCases: ReadonlyArray<{
      readonly obj: V3RunBonusObjective;
      readonly passPatch: Partial<V2RunState>;
      readonly failPatch: Partial<V2RunState>;
    }> = [
      {
        obj: { id: 'bonus_high_hp', label: '满血返航', completed: false, rewardCredits: 26 },
        passPatch: { hp: 23, maxHp: 38 }, // ceil(38*0.6)=23
        failPatch: { hp: 22, maxHp: 38 },
      },
      {
        obj: { id: 'bonus_no_discard', label: '零丢弃', completed: false, rewardCredits: 26 },
        passPatch: { discardedCountThisRun: 0 },
        failPatch: { discardedCountThisRun: 1 },
      },
      {
        obj: { id: 'bonus_fuel_reserve', label: '余油 >= 3', completed: false, rewardCredits: 26 },
        passPatch: { fuel: 3 },
        failPatch: { fuel: 2 },
      },
      {
        obj: { id: 'bonus_deep_dive', label: '深入第 4 层', completed: false, rewardCredits: 26 },
        passPatch: { visitedNodeIds: ['L1A', 'L4A'] },
        failPatch: { visitedNodeIds: ['L1A', 'L2A'] },
      },
    ];

    for (const c of bonusCases) {
      const passRun: V2RunState = {
        ...bPick.run,
        ...c.passPatch,
        bonusObjective: c.obj,
        contract: { ...bPick.run.contract, bonusObjective: c.obj },
      };
      const failRun: V2RunState = {
        ...bPick.run,
        ...c.failPatch,
        bonusObjective: c.obj,
        contract: { ...bPick.run.contract, bonusObjective: c.obj },
      };
      expect(evaluateRunBonusObjective(passRun, 'safe_return')).toBe(true);
      expect(evaluateRunBonusObjective(failRun, 'safe_return')).toBe(false);
      expect(evaluateRunBonusObjective(passRun, 'defeat')).toBe(false);
    }

    // Freeze at settlement entry: post-freeze mutation does NOT alter settled bonus payout!
    const highHpObj: V3RunBonusObjective = {
      id: 'bonus_high_hp',
      label: '耐久>=60%',
      completed: false,
      rewardCredits: 26,
    };
    const frozenRun = freezeRunBonusObjectiveForSettlement(
      {
        ...bPick.run,
        hp: 30,
        maxHp: 38,
        phase: 'SETTLEMENT',
        settlementReason: 'safe_return',
        bonusObjective: highHpObj,
        contract: { ...bPick.run.contract, bonusObjective: highHpObj },
      },
      'safe_return'
    );
    expect(frozenRun.bonusObjective!.completed).toBe(true);
    // Even if HP were later mutated below 60% in a fixture, calculateV2Settlement trusts frozen completed === true!
    const settledFrozen = calculateV2Settlement({ ...frozenRun, hp: 5 }, profile);
    // Hub T3 applies 1.1x to bonus objective: Math.round(26 * 1.1) = 29
    expect(settledFrozen.bonusObjectiveCredits).toBe(Math.round(26 * 1.1));
    // Hub T3 applies 1.15x to (baseRep 40 + bonusRep 10): Math.round(50 * 1.15) = 57
    expect(settledFrozen.factionRepGains!.starport_guild).toBe(Math.round((40 + 10) * 1.15));

    // Unpaid when main contract incomplete OR on defeat!
    const incompleteMain = calculateV2Settlement(
      { ...frozenRun, contract: { ...frozenRun.contract, completedNodeIds: [] } },
      profile
    );
    expect(incompleteMain.contractCompleted).toBe(false);
    expect(incompleteMain.bonusObjectiveCredits).toBe(0);

    const defeatMain = calculateV2Settlement(
      { ...frozenRun, settlementReason: 'defeat', hp: 0 },
      profile
    );
    expect(defeatMain.bonusObjectiveCredits).toBe(0);
  });
});
