import { describe, expect, it } from 'vitest';
import { getItemImageUrl } from '../src/assets/itemArt';
import { createInitialProgression, type BaseProgression } from '../src/domain/progression';
import type { V2BaseDioramaState } from '../src/scenes/BaseScene';
import { V2_CARGO_DEFS } from '../src/v2/data/cargo';
import { buildEncounterUnits } from '../src/v2/data/enemies';
import {
  V2_ALL_EQUIPMENT_KINDS,
  V2_EQUIPMENT_DEFS,
  V2_MAX_BATTLE_SHIELD,
  V2_MAX_POST_WIN_REPAIR,
  getMerchantBuybackPrice,
} from '../src/v2/data/equipment';
import {
  V2_RELICS,
  V2_RELIC_ORDER,
  V3_RELIC_PASSIVES,
  V3_STATION_FACILITIES,
  V3_STATION_FACILITY_ORDER,
} from '../src/v2/data/facilities';
import { V3_GADGET_DEFS, V3_GADGET_ORDER } from '../src/v2/data/gadgets';
import {
  V2_SHIPS,
  V2_SHIP_ORDER,
  getAllValidCellsForShip,
  isCellDisabledForShip,
  isCellPowerCellForShip,
} from '../src/v2/data/ships';
import { createV2ShowcaseRun } from '../src/v2/data/showcaseRun';
import { V2_TRIAL_BUILD_ORDER, buildTrialPrepareSlots } from '../src/v2/data/trialBuilds';
import { calculateV2BuildStats } from '../src/v2/domain/buildStatsV2';
import {
  completeV2CombatAtCurrentNode,
  previewV2CombatNode,
  simulateV2Combat,
  startV2CombatAtCurrentNode,
} from '../src/v2/domain/combatV2';
import {
  buildActiveWreckStateForNode,
  evaluateWreckHotspotCut,
  getEffectiveShipLoadoutBudget,
  getEffectiveShipMaxHp,
} from '../src/v2/domain/dismantle';
import {
  buyV2MerchantFuel,
  buyV2MerchantOffer,
  buyV2MerchantRepair,
  canUseV3GadgetInRun,
  cutV2WreckHotspot,
  extractV2Wreck,
  initiateV2EmergencyTowReturn,
  initiateV2SafeReturnFromMap,
  resolveV2EventOption,
  sellV2ItemToMerchant,
  useV3GadgetInRun,
} from '../src/v2/domain/encounter';
import {
  addV2ItemToStaging,
  createEmptyV2Bay,
  doesV2PlacedItemTouchPowerCell,
  getV2PowerCellBoostedInstanceIds,
  placeV2FromStaging,
  validateV2Placement,
} from '../src/v2/domain/inventoryV2';
import {
  createV2CargoInstance,
  createV2EquipmentInstance,
  createV3GadgetInstance,
  getAnyV2ItemDef,
  recordV2SeenItems,
} from '../src/v2/domain/itemCatalog';
import {
  buildFreeFallbackPrepareSlots,
  launchV2Expedition,
  validateV2PrepareLoadout,
} from '../src/v2/domain/loadout';
import {
  createFreshV2Profile,
  createFreshV2SaveData,
  loadV2SaveData,
  normalizeV2SaveData,
  persistV2SaveData,
  validateV2SaveDataDetailed,
  type V2StorageLike,
} from '../src/v2/domain/persistenceV2';
import {
  canCraftV3GadgetWithParts,
  canResearchV2Instance,
  canRestoreV2Relic,
  canUpgradeV3Facility,
  craftV2CommonEquipment,
  craftV3GadgetWithParts,
  getActiveRelicPassives,
  getEffectiveMaxPresets,
  getEffectiveV2ResearchCost,
  getEffectiveWarehouseCapacity,
  getFacilityTier,
  getStargateRelayR1CoreBonus,
  getStargateRelayStartingWallet,
  restoreV2Relic,
  upgradeV3Facility,
} from '../src/v2/domain/progressionV2';
import {
  applyV2Settlement,
  calculateV2Settlement,
  getAllowedDispositionsForItem,
  getDefaultDispositionForItem,
} from '../src/v2/domain/settlementV2';
import { computeV2PlacementTacticalDelta } from '../src/v2/domain/tacticalDelta';
import type {
  V2CargoBayState,
  V2ProfileState,
  V2RunState,
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

function makeM5Profile(overrides: Partial<V2ProfileState> = {}): V2ProfileState {
  const base = createFreshV2Profile();
  return {
    ...base,
    tutorialCompleted: true,
    credits: 8000,
    salvageParts: 1500,
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
    completedContractTypes: ['transport', 'rescue', 'survey'],
    deepestLayerReached: 6,
    campaign: {
      ...base.campaign,
      currentAct: 'act3',
      unlockedSectors: ['near_orbit', 'frozen_graveyard', 'stargate_abyss'],
      defeatedBossIds: ['boss_anvil', 'boss_dreadnought'],
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
    throw new Error(`Failed placing ${id} (${kind}) at (${x},${y}) rot=${rotation}: ${res.reason}`);
  }
  return res.bay;
}

describe('M5 F14: All 16 Modules (32 Defs), 6 New Cross-Archetype Mechanics & Global Caps', () => {
  it('verifies all 16 kinds (32 defs) and genuine mechanics of coolant_vent, cargo_amp, emp_jammer, overdrive_core, salvage_grapple, salvo_pod, plus global shield=20 & repair=4 caps', () => {
    expect(V2_ALL_EQUIPMENT_KINDS.length).toBe(16);
    expect(Object.keys(V2_EQUIPMENT_DEFS).length).toBe(32);

    // 1. coolant_vent: shieldBonus (4/6), endOfRoundShieldRegen (1/2 + powerCell), cryoResist (1/2), coolantBonus (+2/+3) on heavy & salvo_pod
    // Place coolant_vent(improved, 1x2) at (0,0) [no power cell on cannon_skiff (1,2)] adjacent to heavy(common, 1x3) at (1,0) [touches (1,2) power cell!]
    let bayCool = createEmptyV2Bay('cannon_skiff');
    bayCool = placeEq(bayCool, 'cv1', 'coolant_vent', 'improved', 0, 0);
    bayCool = placeEq(bayCool, 'hv1', 'heavy', 'common', 1, 0);
    const coolStats = calculateV2BuildStats(bayCool);
    expect(coolStats.coolantVents[0].shieldBonus).toBe(6);
    expect(coolStats.coolantVents[0].endOfRoundShieldRegen).toBe(2);
    expect(coolStats.coolantVents[0].cryoResist).toBe(2);
    expect(coolStats.cryoDrainReduction).toBe(2);
    expect(coolStats.heavies[0].coolantBonus).toBe(3); // Adjacent improved coolant_vent -> +3!
    expect(coolStats.heavies[0].powerCellBonus).toBe(3); // Touches cannon_skiff Power Cell (1,2)!

    // In Sector 2 (frozen_graveyard, cryo_ion -2 opening shield), cryoDrainReduction=2 completely negates opening drain!
    const armUnits = buildEncounterUnits('armored', 4, 'cv_cryo');
    const simCryoProtected = simulateV2Combat({
      resultId: 'cv_cryo_ok',
      bay: bayCool,
      startingHp: 30,
      maxHp: 30,
      units: armUnits,
      targetPolicy: 'weakest',
      sectorId: 'frozen_graveyard',
    });
    expect(simCryoProtected.startingPlayerShield).toBe(6); // 0 cryo drain instead of -2!
    // End-of-round shield regen triggers when enemies are still alive after Round 1
    expect(simCryoProtected.rounds[0].playerShieldAfter).toBe(
      Math.min(V2_MAX_BATTLE_SHIELD, 6 - simCryoProtected.rounds[0].shieldAbsorbedTotal + 2)
    );

    // 2. cargo_amp: counts ONLY adjacent cargo & mission (NOT gadget or equipment!)
    let bayCargo = createEmptyV2Bay('cannon_skiff');
    bayCargo = placeEq(bayCargo, 'ca1', 'cargo_amp', 'common', 1, 1); // (1,1)
    const cg1 = createV2CargoInstance({
      instanceId: 'cg_1',
      defId: 'cargo.data_box', // 1x1
      origin: 'loot',
      acquiredDepth: 1,
      location: 'staging',
    });
    const m1 = createV2CargoInstance({
      instanceId: 'ms_1',
      defId: 'mission.black_box', // 1x2
      origin: 'mission',
      acquiredDepth: 2,
      location: 'staging',
    });
    const g1 = createV3GadgetInstance({
      instanceId: 'gd_1',
      kind: 'repair_kit', // 1x1 gadget — must NOT count!
      origin: 'owned',
      acquiredDepth: 0,
      location: 'staging',
    });
    bayCargo = placeV2FromStaging(addV2ItemToStaging(bayCargo, cg1, 0), 'cg_1', 0, 1, 0).bay; // left of (1,1)
    bayCargo = placeV2FromStaging(addV2ItemToStaging(bayCargo, m1, 0), 'ms_1', 2, 1, 0).bay; // right of (1,1)
    bayCargo = placeV2FromStaging(addV2ItemToStaging(bayCargo, g1, 0), 'gd_1', 1, 0, 0).bay; // above (1,1)
    bayCargo = placeEq(bayCargo, 'bt_adj', 'battery', 'common', 1, 2); // below (1,1) — equipment must NOT count!
    const cargoStats = calculateV2BuildStats(bayCargo);
    expect(cargoStats.cargoAmps[0].adjacentCargoCount).toBe(2); // ONLY cg_1 + ms_1
    expect(cargoStats.cargoAmps[0].coreAttackBonus).toBe(1 + 2); // base 1 + 2*1
    expect(cargoStats.cargoAmps[0].shieldBonus).toBe(4); // 2*2

    // 3. emp_jammer: shieldShred before hit, empResist dampens EMP drain, enemy weaken (common odd-only vs improved every-round)
    const shieldRegenEnemy = buildEncounterUnits('shield_regen', 4, 'ej_sh'); // 5 initial shield
    const empEnemy = buildEncounterUnits('emp_disruptor', 4, 'ej_emp'); // 3 EMP drain on odd rounds
    let bayEmp = createEmptyV2Bay('cannon_skiff');
    bayEmp = placeEq(bayEmp, 'ej1', 'emp_jammer', 'improved', 0, 0); // shieldShred 5, dmg 3, empResist 3, weaken every round
    bayEmp = placeEq(bayEmp, 'sh1', 'shield', 'improved', 2, 0);
    const empStats = calculateV2BuildStats(bayEmp);
    expect(empStats.empJammers[0].shieldShred).toBe(5);
    expect(empStats.empDrainReduction).toBe(3);
    expect(empStats.enemyWeakenAmount).toBe(1);
    expect(empStats.enemyWeakenEveryRound).toBe(true);

    const highShieldEnemy = [
      { ...shieldRegenEnemy[0], initialShield: 8, maxShield: 8 },
    ];
    const simEjShred = simulateV2Combat({
      resultId: 'ej_shred',
      bay: bayEmp,
      startingHp: 30,
      maxHp: 30,
      units: highShieldEnemy,
      targetPolicy: 'weakest',
      encounterKind: 'shield_regen',
    });
    const ejHit = simEjShred.rounds[0].playerAttacks.find((a) => a.sourceInstanceId === 'ej1')!;
    // ship_core (2 dmg) chips 8->6 shield first, then emp_jammer pre-shreds 5 shield + deals 3 dmg (1 more to shield + 2 to HP) -> 6 shieldDamaged!
    expect(ejHit.shieldDamaged).toBe(6);

    const simEjResist = simulateV2Combat({
      resultId: 'ej_resist',
      bay: bayEmp,
      startingHp: 30,
      maxHp: 30,
      units: empEnemy,
      targetPolicy: 'weakest',
      encounterKind: 'emp_disruptor',
    });
    // empResist 3 completely negates emp_disruptor's 3 EMP shield drain!
    expect(simEjResist.rounds[0].enemyAttacks[0].empShieldDrained ?? 0).toBe(0);
    // Improved jammer weakens enemy attack by 1 on BOTH Round 1 (odd) and Round 2 (even)!
    expect(simEjResist.rounds[1].enemyAttacks[0].rawDamage).toBe(empEnemy[0].damagePerRound - 1);

    // 4. overdrive_core + salvage_grapple + salvo_pod (incl. Bug #7 synergy partner symmetry!)
    let baySyn = createEmptyV2Bay('stargate_cruiser');
    // overdrive_core (2x2) at (1,0) -> cells (1,0),(2,0),(1,1),(2,1) [touches Power Cell (2,1)!]
    baySyn = placeEq(baySyn, 'oc1', 'overdrive_core', 'common', 1, 0);
    // salvage_grapple (1x2) at (0,1) -> adjacent to (1,1) of overdrive_core!
    baySyn = placeEq(baySyn, 'sg1', 'salvage_grapple', 'improved', 0, 1);
    // salvo_pod (1x3) at (3,0) -> adjacent to (2,0),(2,1) of overdrive_core!
    baySyn = placeEq(baySyn, 'sp1', 'salvo_pod', 'common', 3, 0);
    // BOTH capacitor (1x1) at (4,1) AND relay (1x1) at (4,2) adjacent to salvo_pod -> must add ONLY +1 missile (non-stacking)!
    baySyn = placeEq(baySyn, 'cap1', 'capacitor', 'common', 4, 1);
    baySyn = placeEq(baySyn, 'rel1', 'relay', 'common', 4, 2);

    const synStats = calculateV2BuildStats(baySyn);
    expect(synStats.overdriveCores[0].coreAttackBonus).toBe(3); // base 2 + 1 Power Cell
    expect(synStats.salvageGrapples[0].damage).toBe(3 + 2); // improved 3 + overdrive direct +2
    expect(synStats.wreckStabilityBonus).toBe(18);
    expect(synStats.wreckHullDamageReduction).toBe(2);
    expect(synStats.bonusSalvagePartsPerWin).toBe(4);
    expect(synStats.bonusSalvagePartsPerCut).toBe(4);
    // salvo_pod: base 3 + 1 (cap/relay non-stacking!) + 1 (touches Power Cell (3,2)!) = 5 missiles; dmg = 2 + 1 (overdrive multi) = 3!
    expect(synStats.salvos[0].missiles).toBe(5);
    expect(synStats.salvos[0].damagePerMissile).toBe(3);

    // Salvo Pod auto-retargets across multiple swarm enemies on kill!
    const swarm = buildEncounterUnits('swarm', 2, 'sp_swarm');
    const simSalvo = simulateV2Combat({
      resultId: 'sp_multi',
      bay: baySyn,
      startingHp: 38,
      maxHp: 38,
      units: swarm,
      targetPolicy: 'weakest',
    });
    const salvoTargets = new Set(
      simSalvo.rounds[0].playerAttacks
        .filter((a) => a.sourceInstanceId.startsWith('sp1_m'))
        .map((a) => a.targetEnemyId)
    );
    expect(salvoTargets.size).toBeGreaterThanOrEqual(2);

    // Bug #7 symmetry check: tacticalDelta recognizes salvage_grapple as a direct synergy partner of overdrive_core!
    const ocStaging = createV2EquipmentInstance({
      instanceId: 'oc_stage',
      kind: 'overdrive_core',
      quality: 'common',
      origin: 'loot',
      acquiredDepth: 2,
      location: 'staging',
    });
    const sgOnlyBay = placeEq(createEmptyV2Bay('stargate_cruiser'), 'sg_only', 'salvage_grapple', 'common', 0, 1);
    const deltaOc = computeV2PlacementTacticalDelta({
      run: null,
      bay: sgOnlyBay,
      startingHp: 38,
      maxHp: 38,
      targetPolicy: 'weakest',
      item: ocStaging,
      zone: 'staging',
      candidateSpot: { x: 1, y: 1, rotation: 0 },
    });
    expect(deltaOc.synergyLine).toContain('联动');

    // Salvage Grapple grants bonusSalvagePartsPerWin on combat victory AND bonusSalvagePartsPerCut on wreck cut!
    const profile = makeM5Profile();
    const launch = launchV2Expedition({
      profile,
      contractTemplateId: 'free_salvage',
      shipId: 'stargate_cruiser',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: [],
      sectorId: 'near_orbit',
      seed: 5101,
    });
    const cNode = Object.values(launch.run!.graph.nodes).find((n) => n.type === 'combat' && n.combat)!;
    const wNode = Object.values(launch.run!.graph.nodes).find((n) => n.type === 'wreck' && n.wreck)!;
    const winStart = startV2CombatAtCurrentNode(
      { ...launch.run!, currentNodeId: cNode.nodeId, phase: 'ENCOUNTER', bay: baySyn, hp: 38, maxHp: 38 },
      'weakest',
      { pureAutoCombat: true }
    );
    const winDone = completeV2CombatAtCurrentNode(winStart.run, profile.unlockedFamilies);
    expect(winDone.run.salvagePartsEarned).toBe(4); // bonusSalvagePartsPerWin from improved salvage_grapple!

    const baseWreck = buildActiveWreckStateForNode(
      { ...launch.run!, currentNodeId: wNode.nodeId, phase: 'ENCOUNTER', bay: createEmptyV2Bay('stargate_cruiser') },
      wNode
    ).wreck;
    const grappleWreck = buildActiveWreckStateForNode(
      { ...launch.run!, currentNodeId: wNode.nodeId, phase: 'ENCOUNTER', bay: baySyn },
      wNode
    ).wreck;
    expect(grappleWreck.maxStability).toBe(baseWreck.maxStability + 18);
    const cutRes = cutV2WreckHotspot(
      { ...launch.run!, currentNodeId: wNode.nodeId, phase: 'ENCOUNTER', bay: baySyn, activeWreck: grappleWreck },
      'armory',
      profile.unlockedFamilies
    );
    const spotBaseParts = grappleWreck.hotspots.find((h) => h.spotId === 'armory')!.rewardParts ?? 0;
    expect(cutRes.run.salvagePartsEarned).toBe(spotBaseParts + 4);

    // 5. Strict Global Caps: V2_MAX_BATTLE_SHIELD = 20 and V2_MAX_POST_WIN_REPAIR = 4!
    let capBay = createEmptyV2Bay('stargate_cruiser');
    // stargate_cruiser bonusShield=4 + 3 improved shields (3*9=27) + 2 improved repairs (2*3=6 + powerCell)
    capBay = placeEq(capBay, 'sh_a', 'shield', 'improved', 1, 0);
    capBay = placeEq(capBay, 'sh_b', 'shield', 'improved', 2, 0);
    capBay = placeEq(capBay, 'sh_c', 'shield', 'improved', 3, 0);
    capBay = placeEq(capBay, 'rp_a', 'repair', 'improved', 0, 2);
    capBay = placeEq(capBay, 'rp_b', 'repair', 'improved', 3, 2);
    const capStats = calculateV2BuildStats(capBay);
    expect(capStats.effectiveShield).toBe(V2_MAX_BATTLE_SHIELD); // Strictly capped at 20!
    expect(capStats.effectiveRepair).toBe(V2_MAX_POST_WIN_REPAIR); // Strictly capped at 4!
  });
});

describe('M5 F14: All 4 Consumable Gadgets, Atomic Use, Preview Parity & Loan/Persistence Guards', () => {
  it('enforces Workbench T2+ crafting, context/full guards, atomic consumption, exact effects, preview === live overcharge parity, loan rejection, and save round-trip', () => {
    expect(V3_GADGET_ORDER).toEqual([
      'repair_kit',
      'overcharge_cell',
      'jump_canister',
      'cut_stabilizer',
    ]);
    expect(Object.keys(V3_GADGET_DEFS).length).toBe(4);

    // Workbench T1 blocks gadget crafting; T2+ unlocks it
    const wbT1Profile = makeM5Profile({
      facilityTiers: { ...createFreshV2Profile().facilityTiers, workbench: 1, research_lab: 2 },
    });
    expect(canCraftV3GadgetWithParts(wbT1Profile, 'repair_kit').canCraft).toBe(false);

    let wbT2Profile = makeM5Profile({ salvageParts: 400 });
    for (const gKind of V3_GADGET_ORDER) {
      const check = canCraftV3GadgetWithParts(wbT2Profile, gKind);
      expect(check.canCraft).toBe(true);
      const crafted = craftV3GadgetWithParts(wbT2Profile, gKind, `g_${gKind}`);
      expect(crafted.ok).toBe(true);
      wbT2Profile = crafted.profile;
    }
    expect(wbT2Profile.equipmentWarehouse.length).toBe(4);

    // Prepare loadout rejects loaned gadgets (origin: 'loan')
    const loanGadgetCheck = validateV2PrepareLoadout(wbT2Profile, 'cannon_skiff', 'engineer', [
      {
        slotKey: 'bad_g_loan',
        definitionId: 'gadget.repair_kit',
        origin: 'loan',
        x: 0,
        y: 0,
        rotation: 0,
      },
    ]);
    expect(loanGadgetCheck.valid).toBe(false);

    // Launch with all 4 owned gadgets installed!
    const launch = launchV2Expedition({
      profile: wbT2Profile,
      contractTemplateId: 'free_salvage',
      shipId: 'stargate_cruiser',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: wbT2Profile.equipmentWarehouse.map((w, idx) => ({
        slotKey: `gs_${idx}`,
        definitionId: w.definitionId,
        origin: 'owned' as const,
        warehouseInstanceId: w.instanceId,
        x: 1 + (idx % 3),
        y: Math.floor(idx / 3),
        rotation: 0 as const,
      })),
      sectorId: 'near_orbit',
      seed: 5201,
    });
    expect(launch.ok && launch.run).toBeTruthy();
    const run = launch.run!;

    // Bug #6 regression check: validateV2Item rejects gadget with origin === 'loan' inside activeRun.bay!
    const illegalLoanGadget = {
      ...createV3GadgetInstance({
        instanceId: 'bad_loan_g',
        kind: 'repair_kit',
        origin: 'owned',
        acquiredDepth: 0,
        location: 'bay',
      }),
      origin: 'loan' as const,
      fixedValue: 0,
    };
    const badSaveCheck = validateV2SaveDataDetailed({
      ...createFreshV2SaveData(),
      profile: wbT2Profile,
      activeRun: {
        ...run,
        bay: {
          ...run.bay,
          placed: [{ item: illegalLoanGadget, x: 1, y: 1, rotation: 0 }],
        },
      },
    });
    expect(badSaveCheck.ok).toBe(false);

    // 1. repair_kit: blocked at full HP & blocked in ENCOUNTER; works in MAP (+10 HP, atomic!)
    const rkId = run.bay.placed.find((p) => p.item.definitionId === 'gadget.repair_kit')!.item
      .instanceId;
    expect(canUseV3GadgetInRun({ ...run, phase: 'MAP', hp: run.maxHp }, rkId).usable).toBe(false);
    expect(canUseV3GadgetInRun({ ...run, phase: 'ENCOUNTER', hp: 10 }, rkId).usable).toBe(false);
    const usedRk = useV3GadgetInRun({ ...run, phase: 'MAP', hp: 20 }, rkId);
    expect(usedRk.ok).toBe(true);
    expect(usedRk.run.hp).toBe(30);
    // Atomic consumption: 2nd use strictly rejected!
    expect(useV3GadgetInRun(usedRk.run, rkId).ok).toBe(false);

    // 2. jump_canister: blocked at full fuel; works in ARRANGE (+2 fuel, atomic!)
    const jcId = usedRk.run.bay.placed.find((p) => p.item.definitionId === 'gadget.jump_canister')!
      .item.instanceId;
    expect(
      canUseV3GadgetInRun({ ...usedRk.run, phase: 'ARRANGE', fuel: usedRk.run.maxFuel }, jcId)
        .usable
    ).toBe(false);
    const usedJc = useV3GadgetInRun({ ...usedRk.run, phase: 'ARRANGE', fuel: 4 }, jcId);
    expect(usedJc.ok).toBe(true);
    expect(usedJc.run.fuel).toBe(6);
    expect(useV3GadgetInRun(usedJc.run, jcId).ok).toBe(false);

    // 3. overcharge_cell: blocked in MAP; activates in pre-combat ENCOUNTER -> R1 +6 ignore-armor & +4 shield; preview === live parity & save round-trip!
    const ocId = usedJc.run.bay.placed.find((p) => p.item.definitionId === 'gadget.overcharge_cell')!
      .item.instanceId;
    expect(canUseV3GadgetInRun({ ...usedJc.run, phase: 'MAP' }, ocId).usable).toBe(false);
    const cNode = Object.values(usedJc.run.graph.nodes).find((n) => n.type === 'combat' && n.combat)!;
    const preCombatRun: V2RunState = {
      ...usedJc.run,
      currentNodeId: cNode.nodeId,
      phase: 'ENCOUNTER',
    };
    const previewBeforeOc = previewV2CombatNode(preCombatRun, cNode.nodeId, 'weakest')!;
    const usedOc = useV3GadgetInRun(preCombatRun, ocId);
    expect(usedOc.ok).toBe(true);
    expect(usedOc.run.overchargeCellActive).toBe(true);

    // Persistence round-trip with overchargeCellActive === true
    const storage = new MemoryStorage();
    expect(
      persistV2SaveData(storage, {
        ...createFreshV2SaveData(),
        profile: wbT2Profile,
        activeRun: usedOc.run,
      }).ok
    ).toBe(true);
    const reloadedOc = loadV2SaveData(storage);
    expect(reloadedOc.status).toBe('loaded');
    if (reloadedOc.status !== 'loaded') return;
    expect(reloadedOc.data.activeRun!.overchargeCellActive).toBe(true);

    const previewWithOc = previewV2CombatNode(reloadedOc.data.activeRun!, cNode.nodeId, 'weakest')!;
    expect(previewWithOc.overchargeApplied).toBe(true);
    expect(previewWithOc.startingPlayerShield).toBe(
      Math.min(V2_MAX_BATTLE_SHIELD, previewBeforeOc.startingPlayerShield + 4)
    );
    const ocHit = previewWithOc.rounds[0].playerAttacks.find(
      (a) => a.sourceInstanceId === 'gadget_overcharge_cell'
    );
    expect(ocHit?.appliedDamage).toBe(6);
    expect(ocHit?.armorBlocked).toBe(0);

    const liveOc = startV2CombatAtCurrentNode(reloadedOc.data.activeRun!, 'weakest', {
      pureAutoCombat: true,
    });
    expect(liveOc.run.activeCombat!.simulation.roundsCount).toBe(previewWithOc.roundsCount);
    expect(liveOc.run.activeCombat!.simulation.finalPlayerHpAfterRepair).toBe(
      previewWithOc.finalPlayerHpAfterRepair
    );
    const doneOc = completeV2CombatAtCurrentNode(liveOc.run, wbT2Profile.unlockedFamilies);
    expect(doneOc.run.overchargeCellActive).toBe(false); // Cleared after battle!

    // 4. cut_stabilizer: +35 stability + next greedy cut 0 hull / 0 fuel / false ambush + save round-trip!
    const csId = usedJc.run.bay.placed.find((p) => p.item.definitionId === 'gadget.cut_stabilizer')!
      .item.instanceId;
    const wNode = Object.values(usedJc.run.graph.nodes).find((n) => n.type === 'wreck' && n.wreck)!;
    const atWreckRun: V2RunState = {
      ...usedJc.run,
      currentNodeId: wNode.nodeId,
      phase: 'ENCOUNTER',
    };
    const cut1 = cutV2WreckHotspot(atWreckRun, 'armory', wbT2Profile.unlockedFamilies, undefined, wbT2Profile);
    expect(cut1.ok).toBe(true);
    const stabAfterCut1 = cut1.run.activeWreck!.stability;

    const usedCs = useV3GadgetInRun(cut1.run, csId, wbT2Profile);
    expect(usedCs.ok).toBe(true);
    expect(usedCs.run.activeWreck!.stabilizerActive).toBe(true);
    expect(usedCs.run.activeWreck!.stability).toBe(
      Math.min(usedCs.run.activeWreck!.maxStability, stabAfterCut1 + 35)
    );
    expect(
      validateV2SaveDataDetailed({
        ...createFreshV2SaveData(),
        profile: wbT2Profile,
        activeRun: usedCs.run,
      }).ok
    ).toBe(true);

    // With stabilizerActive, greedy 2nd cut on reactor has 0 hull dmg, 0 fuel cost, false ambush!
    const evalStab = evaluateWreckHotspotCut(usedCs.run, usedCs.run.activeWreck!, 'reactor');
    expect(evalStab.canCut).toBe(true);
    expect(evalStab.effectiveHullDamage).toBe(0);
    expect(evalStab.effectiveFuelCost).toBe(0);
    expect(evalStab.effectiveAmbushRisk).toBe(false);
    const cut2 = cutV2WreckHotspot(usedCs.run, 'reactor', wbT2Profile.unlockedFamilies, 'fuel');
    expect(cut2.ok).toBe(true);
    expect(cut2.run.hp).toBe(usedCs.run.hp);
    expect(cut2.run.activeWreck!.stabilizerActive).toBe(false); // Consumed on next cut!
  });
});

describe('M5 F14: 4th Flagship stargate_cruiser & Hull Power Cells Across All 4 Ships', () => {
  it('validates stargate_cruiser 5x5 geometry, 5 bulkheads, 20 valid cells, budget 8, Drydock T3 unlock, and single-bonus-per-item Power Cell behavior across all 4 ships', () => {
    const sg = V2_SHIPS.stargate_cruiser;
    expect(sg.cols).toBe(5);
    expect(sg.rows).toBe(5);
    expect(sg.validCellCount).toBe(20);
    expect(sg.loadoutBudget).toBe(8);
    expect(getAllValidCellsForShip('stargate_cruiser').length).toBe(20);

    const expectedBulkheads: readonly [number, number][] = [
      [0, 0],
      [4, 0],
      [0, 4],
      [4, 4],
      [2, 4],
    ];
    for (const [bx, by] of expectedBulkheads) {
      expect(isCellDisabledForShip('stargate_cruiser', bx, by)).toBe(true);
      const check = validateV2Placement(
        createEmptyV2Bay('stargate_cruiser'),
        'equipment.battery.common',
        bx,
        by,
        0
      );
      expect(check.valid).toBe(false);
      expect(check.reason).toBe('disabled_cell');
    }

    // Power cells across all 4 ships
    expect(isCellPowerCellForShip('cannon_skiff', 1, 2)).toBe(true);
    expect(isCellPowerCellForShip('shield_cruiser', 2, 1)).toBe(true);
    expect(isCellPowerCellForShip('shield_cruiser', 2, 2)).toBe(true);
    expect(isCellPowerCellForShip('heavy_freighter', 2, 1)).toBe(true);
    expect(isCellPowerCellForShip('heavy_freighter', 3, 2)).toBe(true);
    expect(isCellPowerCellForShip('stargate_cruiser', 2, 1)).toBe(true);
    expect(isCellPowerCellForShip('stargate_cruiser', 1, 2)).toBe(true);
    expect(isCellPowerCellForShip('stargate_cruiser', 3, 2)).toBe(true);

    // Single-bonus-per-item: 1x2 laser touching BOTH (2,1) AND (2,2) on shield_cruiser gains ONLY +1 powerCellBonus (NOT +2!)
    const bayTouchTwo = placeEq(createEmptyV2Bay('shield_cruiser'), 'l_two', 'laser', 'common', 2, 1);
    expect(doesV2PlacedItemTouchPowerCell(bayTouchTwo, bayTouchTwo.placed[0])).toBe(true);
    expect(getV2PowerCellBoostedInstanceIds(bayTouchTwo).has('l_two')).toBe(true);
    const statsTwo = calculateV2BuildStats(bayTouchTwo);
    expect(statsTwo.lasers[0].powerCellBonus).toBe(1); // Granted ONCE even touching 2 Power Cells!

    // Drydock T3 unlocks stargate_cruiser
    const preDock3 = makeM5Profile({
      unlockedShips: ['cannon_skiff', 'shield_cruiser', 'heavy_freighter'],
      facilityTiers: { ...createFreshV2Profile().facilityTiers, drydock: 2, drydock_tier2: 1 },
    });
    const upgDock3 = upgradeV3Facility(preDock3, 'drydock');
    expect(upgDock3.ok).toBe(true);
    expect(upgDock3.newTier).toBe(3);
    expect(upgDock3.profile.unlockedShips).toContain('stargate_cruiser');
  });
});

describe('M5 F15 & F16: 6-Dept T1-T3 Upgrades, stargate_relay, Relic Passives, 48/48 Codex, Holodeck Isolation & BaseScene Diorama', () => {
  it('verifies all 6 departments T1-T3 progression, total economy sinks, stargate_relay prereqs & perks, and Bug #4 bidirectional facilityTiers <-> buildings sync', () => {
    expect(V3_STATION_FACILITY_ORDER).toEqual([
      'workbench',
      'contract_hub',
      'drydock',
      'research_lab',
      'display',
      'stargate_relay',
    ]);

    // Total facility + relic credit & parts sink verification (5,660 + 300 = 5,960 credits; 795 parts)
    let totalFacCredits = 0;
    let totalFacParts = 0;
    for (const fid of V3_STATION_FACILITY_ORDER) {
      for (const tier of V3_STATION_FACILITIES[fid].tiers) {
        totalFacCredits += tier.creditCost;
        totalFacParts += tier.partsCost;
      }
    }
    const totalRelicCredits = V2_RELIC_ORDER.reduce((s, r) => s + V2_RELICS[r].restoreCost, 0);
    expect(totalFacCredits).toBe(5660);
    expect(totalRelicCredits).toBe(300);
    expect(totalFacCredits + totalRelicCredits).toBe(5960);
    expect(totalFacParts).toBe(795);

    // Walk full T1->T2->T3 upgrades from fresh post-tutorial Act 3-ready profile
    let prof = makeM5Profile({
      credits: 10000,
      salvageParts: 2000,
      buildings: {
        workbench: true,
        contract_hub: true,
        drydock: false,
        research_lab: false,
        display: false,
        drydock_tier2: false,
      },
      facilityTiers: {
        workbench: 1,
        contract_hub: 1,
        drydock: 0,
        drydock_tier2: 0,
        research_lab: 0,
        display: 0,
        stargate_relay: 0,
      },
      unlockedShips: ['cannon_skiff'],
    });

    // stargate_relay blocked until research_lab >= 1 AND drydock >= 2 AND Act 3
    expect(canUpgradeV3Facility(prof, 'stargate_relay').canUpgrade).toBe(false);

    // Research Lab T1 -> T2 -> T3: warehouse capacity 12 -> 16 -> 20, research cost 30 -> 25
    expect(getEffectiveWarehouseCapacity(prof)).toBe(12);
    expect(getEffectiveV2ResearchCost(prof)).toBe(30);
    prof = upgradeV3Facility(prof, 'research_lab').profile;
    expect(getFacilityTier(prof, 'research_lab')).toBe(1);
    prof = upgradeV3Facility(prof, 'research_lab').profile;
    expect(getEffectiveWarehouseCapacity(prof)).toBe(16);
    expect(getEffectiveV2ResearchCost(prof)).toBe(25);
    prof = upgradeV3Facility(prof, 'research_lab').profile;
    expect(getEffectiveWarehouseCapacity(prof)).toBe(20);

    // Workbench T1 -> T2 -> T3: presets 3 -> 5 -> 6
    expect(getEffectiveMaxPresets(prof)).toBe(3);
    prof = upgradeV3Facility(prof, 'workbench').profile;
    expect(getEffectiveMaxPresets(prof)).toBe(5);
    prof = upgradeV3Facility(prof, 'workbench').profile;
    expect(getEffectiveMaxPresets(prof)).toBe(6);

    // Drydock T1 -> T2 -> T3 unlocks shield_cruiser -> heavy_freighter -> stargate_cruiser
    prof = upgradeV3Facility(prof, 'drydock').profile;
    expect(prof.unlockedShips).toContain('shield_cruiser');
    prof = upgradeV3Facility(prof, 'drydock').profile;
    expect(prof.unlockedShips).toContain('heavy_freighter');
    expect(prof.buildings.drydock_tier2).toBe(true);
    prof = upgradeV3Facility(prof, 'drydock').profile;
    expect(prof.unlockedShips).toContain('stargate_cruiser');

    // Now stargate_relay T1 -> T2 -> T3 unlocks milestone + starting wallet (+25/+50) + R1 core dmg (+1/+2)
    expect(canUpgradeV3Facility(prof, 'stargate_relay').canUpgrade).toBe(true);
    prof = upgradeV3Facility(prof, 'stargate_relay').profile;
    expect(prof.campaign.completedMilestones).toContain('stargate_relay_built');
    expect(getStargateRelayStartingWallet(prof)).toBe(0);
    expect(getStargateRelayR1CoreBonus(prof)).toBe(0);

    prof = upgradeV3Facility(prof, 'stargate_relay').profile;
    expect(getStargateRelayStartingWallet(prof)).toBe(25);
    expect(getStargateRelayR1CoreBonus(prof)).toBe(1);

    // Fix A regression (T2): launch grants 25¤ usable in-run stipend, but Layer-0 safe return cashes out 0¤
    const t2Launch = launchV2Expedition({
      profile: prof,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: [],
      sectorId: 'near_orbit',
      seed: 5300,
    });
    expect(t2Launch.ok && t2Launch.run).toBeTruthy();
    expect(t2Launch.run!.wallet).toBe(25);
    expect(t2Launch.run!.startingStipendCredits).toBe(25);
    expect(t2Launch.run!.stipendSpentCredits).toBe(0);
    const t2InstantRet = initiateV2SafeReturnFromMap(t2Launch.run!);
    expect(t2InstantRet.ok).toBe(true);
    const t2InstantSum = calculateV2Settlement(t2InstantRet.run, prof);
    expect(t2InstantSum.walletCredits).toBe(0);
    expect(t2InstantSum.finalCreditsEarned).toBe(0);

    prof = upgradeV3Facility(prof, 'stargate_relay').profile;
    expect(getStargateRelayStartingWallet(prof)).toBe(50);
    expect(getStargateRelayR1CoreBonus(prof)).toBe(2);
    expect(canUpgradeV3Facility(prof, 'stargate_relay').canUpgrade).toBe(false); // Max T3

    // Verify stargate_relay T3 starting wallet & R1 core damage bonus in real launch & combat
    const relayLaunch = launchV2Expedition({
      profile: prof,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: [],
      sectorId: 'near_orbit',
      seed: 5301,
    });
    expect(relayLaunch.ok && relayLaunch.run).toBeTruthy();
    expect(relayLaunch.run!.wallet).toBe(50);
    expect(relayLaunch.run!.startingStipendCredits).toBe(50);
    expect(relayLaunch.run!.stipendSpentCredits).toBe(0);

    // Fix A regression (T3): anti-infinite-credit-printer checks across ALL exit paths!
    // 1) Immediate Layer-0 safe return -> 0¤ cashed out, profile.credits unchanged
    const t3L0Return = initiateV2SafeReturnFromMap(relayLaunch.run!);
    expect(t3L0Return.ok).toBe(true);
    const t3L0Sum = calculateV2Settlement(t3L0Return.run, prof);
    expect(t3L0Sum.walletCredits).toBe(0);
    expect(t3L0Sum.finalCreditsEarned).toBe(0);
    const t3L0Applied = applyV2Settlement(prof, t3L0Return.run);
    expect(t3L0Applied.ok).toBe(true);
    expect(t3L0Applied.profile.credits).toBe(prof.credits);

    // 2) L1 0-cut wreck -> extract -> safe return -> 0¤ cashed out
    const wreckNode = Object.values(relayLaunch.run!.graph.nodes).find(
      (n) => n.type === 'wreck' && n.wreck
    )!;
    expect(wreckNode).toBeDefined();
    const builtWreck = buildActiveWreckStateForNode(
      { ...relayLaunch.run!, currentNodeId: wreckNode.nodeId, phase: 'ENCOUNTER' },
      wreckNode,
      prof
    );
    const extractedZeroCut = extractV2Wreck({
      ...relayLaunch.run!,
      currentNodeId: wreckNode.nodeId,
      phase: 'ENCOUNTER',
      activeWreck: builtWreck.wreck,
    });
    expect(extractedZeroCut.ok).toBe(true);
    const afterWreckReturn = initiateV2EmergencyTowReturn(extractedZeroCut.run);
    expect(afterWreckReturn.ok).toBe(true);
    const wreckRetSum = calculateV2Settlement(afterWreckReturn.run, prof);
    expect(wreckRetSum.walletCredits).toBe(0);
    expect(wreckRetSum.finalCreditsEarned).toBe(0);

    // 3) 0-loot immediate defeat -> 0¤ cashed out (stipend excluded from 40% defeat recovery)
    const t3DefeatRun: V2RunState = {
      ...relayLaunch.run!,
      phase: 'SETTLEMENT',
      settlementReason: 'defeat',
      hp: 0,
    };
    const t3DefeatSum = calculateV2Settlement(t3DefeatRun, prof);
    expect(t3DefeatSum.walletCredits).toBe(0);
    expect(t3DefeatSum.defeatRecoverableBase).toBe(0);
    expect(t3DefeatSum.finalCreditsEarned).toBe(0);

    // 4) Earning real combat bounty (+30¤ -> wallet 80) cashes out exact earned 30¤!
    const t3EarnedRun: V2RunState = {
      ...relayLaunch.run!,
      wallet: 80,
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
    };
    const t3EarnedSum = calculateV2Settlement(t3EarnedRun, prof);
    expect(t3EarnedSum.walletCredits).toBe(30);
    expect(t3EarnedSum.finalCreditsEarned).toBe(30);

    // 5) Stipend-first spend accounting across Merchant (fuel, repair, offer) + Merchant loot sale:
    //    Spending stipend mid-run MUST preserve 100% of real earned bounties & loot sales on BOTH safe_return & defeat!
    const merchantSeedRun =
      Object.values(relayLaunch.run!.graph.nodes).some((n) => n.type === 'merchant' && n.merchant)
        ? relayLaunch.run!
        : launchV2Expedition({
            profile: prof,
            contractTemplateId: 'free_salvage',
            shipId: 'cannon_skiff',
            crewId: 'engineer',
            primaryArchetype: 'laser',
            slots: [],
            sectorId: 'near_orbit',
            seed: 2,
          }).run!;
    const merchantNode = Object.values(merchantSeedRun.graph.nodes).find(
      (n) => n.type === 'merchant' && n.merchant && n.merchant.offers.length > 0
    )!;
    expect(merchantNode).toBeDefined();
    const priciestOffer = [...merchantNode.merchant!.offers].sort(
      (a, b) => b.buyPrice - a.buyPrice
    )[0]!;
    const lootCargo = createV2CargoInstance({
      instanceId: 'loot_cargo_stipend_1',
      defId: 'cargo.data_box',
      origin: 'loot',
      acquiredDepth: 1,
      location: 'staging',
    });
    const fuelPrice = merchantNode.merchant!.fuelPrice;
    const repairPrice = merchantNode.merchant!.repairPrice;
    const offerPrice = priciestOffer.buyPrice;
    expect(fuelPrice + repairPrice + offerPrice).toBeGreaterThan(50);
    const realCombatBounty = Math.max(6, fuelPrice + repairPrice + offerPrice - 45);
    const shopReadyRun: V2RunState = {
      ...merchantSeedRun,
      currentNodeId: merchantNode.nodeId,
      phase: 'SHOP',
      fuel: Math.max(0, merchantSeedRun.maxFuel - 2),
      hp: Math.max(1, merchantSeedRun.maxHp - 6),
      wallet: merchantSeedRun.wallet + realCombatBounty,
      bay: addV2ItemToStaging(merchantSeedRun.bay, lootCargo, 0),
    };
    const afterFuelBuy = buyV2MerchantFuel(shopReadyRun, 'tx_stipend_fuel', 0);
    expect(afterFuelBuy.ok).toBe(true);
    expect(afterFuelBuy.run.stipendSpentCredits).toBe(Math.min(50, fuelPrice));

    const afterRepairBuy = buyV2MerchantRepair(afterFuelBuy.run, 'tx_stipend_repair', 0);
    expect(afterRepairBuy.ok).toBe(true);
    expect(afterRepairBuy.run.stipendSpentCredits).toBe(Math.min(50, fuelPrice + repairPrice));

    const afterOfferBuy = buyV2MerchantOffer(
      afterRepairBuy.run,
      priciestOffer.offerId,
      'tx_stipend_offer',
      prof.unlockedFamilies,
      0
    );
    expect(afterOfferBuy.ok).toBe(true);
    expect(afterOfferBuy.run.stipendSpentCredits).toBe(50); // Fully consumed 50¤ stipend and clamped at 50

    // Selling real looted cargo to merchant adds real earned credits WITHOUT modifying stipendSpentCredits!
    const expectedLootBuyback = getMerchantBuybackPrice(lootCargo.fixedValue);
    expect(expectedLootBuyback).toBeGreaterThan(0);
    const afterLootSale = sellV2ItemToMerchant(
      afterOfferBuy.run,
      lootCargo.instanceId,
      'tx_stipend_sell_loot'
    );
    expect(afterLootSale.ok).toBe(true);
    expect(afterLootSale.run.stipendSpentCredits).toBe(50); // Unchanged on sell!
    expect(afterLootSale.run.wallet).toBe(afterOfferBuy.run.wallet + expectedLootBuyback);

    // Since 50¤ stipend was 100% consumed, ALL remaining wallet (bounty surplus + loot sale) cashes out!
    const expectedWalletAfterMerchant =
      50 + realCombatBounty - (fuelPrice + repairPrice + offerPrice) + expectedLootBuyback;
    expect(afterLootSale.run.wallet).toBe(expectedWalletAfterMerchant);
    expect(expectedWalletAfterMerchant).toBeGreaterThan(0);

    const merchSafeSum = calculateV2Settlement(
      { ...afterLootSale.run, phase: 'SETTLEMENT', settlementReason: 'safe_return' },
      prof
    );
    expect(merchSafeSum.walletCredits).toBe(expectedWalletAfterMerchant);
    expect(merchSafeSum.finalCreditsEarned).toBe(expectedWalletAfterMerchant);

    const merchDefeatSum = calculateV2Settlement(
      { ...afterLootSale.run, phase: 'SETTLEMENT', settlementReason: 'defeat', hp: 0 },
      prof
    );
    expect(merchDefeatSum.walletCredits).toBe(expectedWalletAfterMerchant);
    expect(merchDefeatSum.defeatRecoverableBase).toBe(expectedWalletAfterMerchant);
    expect(merchDefeatSum.finalCreditsEarned).toBe(Math.floor(expectedWalletAfterMerchant * 0.2));

    // 6) Stipend-first spend accounting across Merchant + Wallet-Cost Event (resolveV2EventOption):
    //    Spend 47¤ of 50¤ stipend (12¤ fuel + 18¤ repair + 17¤ event) + earn +46¤ combat bounties ->
    //    wallet = 49¤, unspentStipend = 3¤ -> Safe Return walletCredits === 46, Defeat base === 46, payout === 9!
    const eventNode = Object.values(merchantSeedRun.graph.nodes).find(
      (n) => n.nodeId !== merchantNode.nodeId && !n.resolved
    )!;
    expect(eventNode).toBeDefined();
    const afterServices = buyV2MerchantRepair(
      buyV2MerchantFuel(
        {
          ...merchantSeedRun,
          currentNodeId: merchantNode.nodeId,
          phase: 'SHOP',
          fuel: Math.max(0, merchantSeedRun.maxFuel - 2),
          hp: Math.max(1, merchantSeedRun.maxHp - 6),
        },
        'tx_ev_fuel',
        0
      ).run,
      'tx_ev_repair',
      0
    );
    expect(afterServices.ok).toBe(true);
    expect(afterServices.run.wallet).toBe(20); // 50 - 12 - 18
    expect(afterServices.run.stipendSpentCredits).toBe(30);

    const walletEventRun: V2RunState = {
      ...afterServices.run,
      currentNodeId: eventNode.nodeId,
      phase: 'ENCOUNTER',
      activeEvent: {
        nodeId: eventNode.nodeId,
        eventId: 'evt_stipend_wallet_check',
        title: '星港补给交易',
        description: '支付 17¤ 获取应急导航校准。',
        resolved: false,
        chosenIndex: null,
        flavorTag: '事件测试',
        options: [
          {
            index: 0,
            label: '支付 17¤ 校准航线',
            costSummary: '消耗 17¤',
            rewardSummary: '补给 +1 燃料',
            walletCost: 17,
            rewardFuel: 1,
          },
          {
            index: 1,
            label: '安全绕行',
            costSummary: '无消耗',
            rewardSummary: '离开节点',
            isFallback: true,
          },
        ],
      },
    };
    const afterWalletEvent = resolveV2EventOption(walletEventRun, 0, prof.unlockedFamilies);
    expect(afterWalletEvent.ok).toBe(true);
    expect(afterWalletEvent.run.wallet).toBe(3); // 20 - 17
    expect(afterWalletEvent.run.stipendSpentCredits).toBe(47); // 30 + 17

    const withRealBounties: V2RunState = {
      ...afterWalletEvent.run,
      wallet: afterWalletEvent.run.wallet + 46, // 3 + 46 = 49¤ (< 50¤ original stipend!)
    };
    const evSafeSum = calculateV2Settlement(
      { ...withRealBounties, phase: 'SETTLEMENT', settlementReason: 'safe_return' },
      prof
    );
    expect(evSafeSum.walletCredits).toBe(46); // 49 - (50 - 47) = 46¤ (0¤ confiscated!)
    expect(evSafeSum.finalCreditsEarned).toBe(46);

    const evDefeatSum = calculateV2Settlement(
      { ...withRealBounties, phase: 'SETTLEMENT', settlementReason: 'defeat', hp: 0 },
      prof
    );
    expect(evDefeatSum.walletCredits).toBe(46);
    expect(evDefeatSum.defeatRecoverableBase).toBe(46);
    expect(evDefeatSum.finalCreditsEarned).toBe(9); // Math.floor(46 * 0.2) = 9¤

    // 7) startingStipendCredits & stipendSpentCredits persistence round-trip, validation & normalization
    const stipendStorage = new MemoryStorage();
    const stipendSave = {
      ...createFreshV2SaveData(),
      profile: prof,
      activeRun: {
        ...relayLaunch.run!,
        wallet: 49,
        stipendSpentCredits: 47,
      },
    };
    expect(validateV2SaveDataDetailed(stipendSave).ok).toBe(true);
    expect(persistV2SaveData(stipendStorage, stipendSave).ok).toBe(true);
    const reloadedStipend = loadV2SaveData(stipendStorage);
    expect(reloadedStipend.status).toBe('loaded');
    if (reloadedStipend.status === 'loaded') {
      expect(reloadedStipend.data.activeRun!.startingStipendCredits).toBe(50);
      expect(reloadedStipend.data.activeRun!.stipendSpentCredits).toBe(47);
    }
    for (const badStipend of [-1, -50, Number.NaN, 12.5, '50']) {
      const tampered = {
        ...stipendSave,
        activeRun: {
          ...relayLaunch.run!,
          startingStipendCredits: badStipend as unknown as number,
        },
      };
      expect(validateV2SaveDataDetailed(tampered).ok).toBe(false);
    }
    for (const badSpent of [-1, -10, 12.5, Number.NaN, Number.POSITIVE_INFINITY, '10', null, 51]) {
      const tamperedSpent = {
        ...stipendSave,
        activeRun: {
          ...relayLaunch.run!,
          startingStipendCredits: 50,
          stipendSpentCredits: badSpent as unknown as number,
        },
      };
      expect(validateV2SaveDataDetailed(tamperedSpent).ok).toBe(false);
    }
    // Reject stipendSpentCredits > 0 when startingStipendCredits is 0 or omitted
    expect(
      validateV2SaveDataDetailed({
        ...stipendSave,
        activeRun: {
          ...relayLaunch.run!,
          startingStipendCredits: 0,
          stipendSpentCredits: 1,
        },
      }).ok
    ).toBe(false);
    const legacyNoStartRun = { ...relayLaunch.run!, stipendSpentCredits: 1 };
    delete (legacyNoStartRun as { startingStipendCredits?: number }).startingStipendCredits;
    expect(
      validateV2SaveDataDetailed({
        ...stipendSave,
        activeRun: legacyNoStartRun,
      }).ok
    ).toBe(false);

    // normalizeV2SaveData clamps oversized/invalid stipendSpentCredits and preserves undefined on legacy saves
    const normOvershoot = normalizeV2SaveData({
      ...stipendSave,
      activeRun: {
        ...relayLaunch.run!,
        startingStipendCredits: 50,
        stipendSpentCredits: 80,
      },
    });
    expect(normOvershoot.activeRun!.stipendSpentCredits).toBe(50);
    const normNeg = normalizeV2SaveData({
      ...stipendSave,
      activeRun: {
        ...relayLaunch.run!,
        startingStipendCredits: 50,
        stipendSpentCredits: -7,
      },
    });
    expect(normNeg.activeRun!.stipendSpentCredits).toBe(0);
    const legacyRunNoSpent = { ...relayLaunch.run! };
    delete (legacyRunNoSpent as { stipendSpentCredits?: number }).stipendSpentCredits;
    const normLegacy = normalizeV2SaveData({
      ...stipendSave,
      activeRun: legacyRunNoSpent,
    });
    expect(normLegacy.activeRun!.stipendSpentCredits).toBeUndefined();

    // Fix C regression: isSafeMapKey rejects __proto__ / constructor / prototype keys in facilityTiers & relicPityCounters
    const protoFacSave = {
      ...stipendSave,
      profile: {
        ...prof,
        facilityTiers: JSON.parse('{"workbench":1,"__proto__":2}') as Record<string, number>,
      },
    };
    expect(validateV2SaveDataDetailed(protoFacSave).ok).toBe(false);
    const ctorFacSave = {
      ...stipendSave,
      profile: {
        ...prof,
        facilityTiers: JSON.parse('{"workbench":1,"constructor":2}') as Record<string, number>,
      },
    };
    expect(validateV2SaveDataDetailed(ctorFacSave).ok).toBe(false);
    const protoPitySave = {
      ...stipendSave,
      profile: {
        ...prof,
        campaign: {
          ...prof.campaign,
          relicPityCounters: JSON.parse('{"near_orbit":1,"__proto__":2}') as Record<string, number>,
        },
      },
    };
    expect(validateV2SaveDataDetailed(protoPitySave).ok).toBe(false);

    // Reviewer 1 §5 symmetry check: lone flak hints overdrive_core synergy partner
    const loneFlak = createV2EquipmentInstance({
      instanceId: 'flak_hint_1',
      kind: 'flak',
      quality: 'common',
      origin: 'owned',
      acquiredDepth: 0,
      location: 'staging',
    });
    const flakDelta = computeV2PlacementTacticalDelta({
      run: null,
      bay: createEmptyV2Bay('cannon_skiff'),
      startingHp: 30,
      maxHp: 30,
      targetPolicy: 'weakest',
      item: loneFlak,
      zone: 'staging',
    });
    expect(flakDelta.synergyLine).toContain(V2_EQUIPMENT_DEFS['equipment.overdrive_core.common'].name);

    const patrol = buildEncounterUnits('patrol', 4, 'relay_r1');
    const simRelay0 = simulateV2Combat({
      resultId: 'rel_0',
      bay: createEmptyV2Bay('cannon_skiff'),
      startingHp: 30,
      maxHp: 30,
      units: patrol,
      targetPolicy: 'weakest',
      stargateRelayTier: 0,
    });
    const simRelay3 = simulateV2Combat({
      resultId: 'rel_3',
      bay: createEmptyV2Bay('cannon_skiff'),
      startingHp: 30,
      maxHp: 30,
      units: patrol,
      targetPolicy: 'weakest',
      stargateRelayTier: 3,
    });
    const coreR1Base = simRelay0.rounds[0].playerAttacks.find(
      (a) => a.sourceInstanceId === 'ship_core'
    )!;
    const coreR1T3 = simRelay3.rounds[0].playerAttacks.find(
      (a) => a.sourceInstanceId === 'ship_core'
    )!;
    expect(coreR1T3.appliedDamage).toBe(coreR1Base.appliedDamage + 2);

    // Bug #4 regression test: asymmetric facilityTiers without buildings booleans works everywhere & normalizes bidirectionally!
    const asymItem = createV2EquipmentInstance({
      instanceId: 'asym_eq_1',
      kind: 'heavy',
      quality: 'common',
      origin: 'owned',
      acquiredDepth: 1,
      location: 'warehouse',
    });
    const asymProfile: V2ProfileState = {
      ...createFreshV2Profile(),
      credits: 500,
      buildings: {
        workbench: false,
        contract_hub: false,
        drydock: false,
        research_lab: false,
        display: false,
        drydock_tier2: false,
      },
      facilityTiers: {
        workbench: 2,
        contract_hub: 1,
        drydock: 3,
        research_lab: 2,
        display: 2,
        stargate_relay: 1,
      },
      blueprints: ['laser'],
      equipmentWarehouse: [asymItem],
      relics: {
        ...createFreshV2Profile().relics,
        ancient_navigator: { storedCount: 1, restored: false },
      },
    };
    expect(canResearchV2Instance(asymProfile, asymItem.instanceId).canResearch).toBe(true);
    expect(craftV2CommonEquipment(asymProfile, 'laser', 'asym').ok).toBe(true);
    expect(canRestoreV2Relic(asymProfile, 'ancient_navigator').canRestore).toBe(true);
    const relicLoot = createV2CargoInstance({
      instanceId: 'asym_rel',
      defId: 'cargo.cryo_amber', // storedCount=0, restored=false -> should default to keep_relic via facilityTiers.display=2!
      origin: 'loot',
      acquiredDepth: 4,
      location: 'bay',
    });
    expect(getDefaultDispositionForItem(relicLoot, 'safe_return', false, asymProfile)).toBe(
      'keep_relic'
    );
    expect(
      getAllowedDispositionsForItem(
        { ...asymItem, origin: 'loot' },
        'safe_return',
        asymProfile,
        false
      )
    ).toContain('store');

    const normalizedAsym = normalizeV2SaveData({
      ...createFreshV2SaveData(),
      profile: asymProfile,
    });
    expect(normalizedAsym.profile.buildings.workbench).toBe(true);
    expect(normalizedAsym.profile.buildings.research_lab).toBe(true);
    expect(normalizedAsym.profile.buildings.display).toBe(true);
    expect(normalizedAsym.profile.buildings.drydock).toBe(true);
    expect(normalizedAsym.profile.buildings.drydock_tier2).toBe(true);
  });

  it('strictly gates all 4 relic passives on restored === true, verifies 48/48 Codex parity, Holodeck isolation across all 4 ships, and V2BaseDioramaState coexistence', () => {
    expect(Object.keys(V3_RELIC_PASSIVES).length).toBe(4);

    // Stored-but-unrestored relics MUST grant ZERO passives!
    const storedAll = makeM5Profile({
      relics: {
        ancient_navigator: { storedCount: 1, restored: false },
        cryo_amber: { storedCount: 1, restored: false },
        quantum_core: { storedCount: 1, restored: false },
        obsidian_crown: { storedCount: 1, restored: false },
      },
    });
    const storedPassives = getActiveRelicPassives(storedAll);
    expect(storedPassives).toEqual({
      startingFuelBonus: 0,
      fullMapReveal: false,
      maxHpBonus: 0,
      loadoutBudgetBonus: 0,
      bossTacticalChargeBonus: 0,
      activeRelicIds: [],
    });
    expect(getEffectiveShipMaxHp(storedAll, 'cannon_skiff')).toBe(V2_SHIPS.cannon_skiff.maxHp);
    expect(getEffectiveShipLoadoutBudget(storedAll, 'cannon_skiff')).toBe(
      V2_SHIPS.cannon_skiff.loadoutBudget
    );

    // Restore all 4 relics -> all 4 passives activate!
    let restored = storedAll;
    for (const rid of V2_RELIC_ORDER) {
      const r = restoreV2Relic(restored, rid);
      expect(r.ok).toBe(true);
      restored = r.profile;
    }
    const activePassives = getActiveRelicPassives(restored);
    expect(activePassives.startingFuelBonus).toBe(1);
    expect(activePassives.fullMapReveal).toBe(true);
    expect(activePassives.maxHpBonus).toBe(4);
    expect(activePassives.loadoutBudgetBonus).toBe(1);
    expect(activePassives.bossTacticalChargeBonus).toBe(1);
    expect(activePassives.activeRelicIds.length).toBe(4);
    expect(getEffectiveShipMaxHp(restored, 'cannon_skiff')).toBe(V2_SHIPS.cannon_skiff.maxHp + 4);
    expect(getEffectiveShipLoadoutBudget(restored, 'cannon_skiff')).toBe(
      V2_SHIPS.cannon_skiff.loadoutBudget + 1
    );

    const baseFuelLaunch = launchV2Expedition({
      profile: storedAll,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: [],
      sectorId: 'near_orbit',
      seed: 5400,
    });
    const fuelLaunch = launchV2Expedition({
      profile: restored,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: [],
      sectorId: 'near_orbit',
      seed: 5401,
    });
    expect(baseFuelLaunch.run!.fuel).toBe(9); // V2_STARTING_FUEL = 9 (unrestored grants 0!)
    expect(fuelLaunch.run!.fuel).toBe(10); // Starting 9 + ancient_navigator +1 = 10 (V2_MAX_FUEL)!

    // 48/48 Codex parity: 32 equipment + 4 gadgets + 12 cargo = 48
    const allCodexIds = [
      ...Object.keys(V2_EQUIPMENT_DEFS),
      ...Object.keys(V3_GADGET_DEFS),
      ...Object.keys(V2_CARGO_DEFS),
    ];
    expect(allCodexIds.length).toBe(48);
    expect(new Set(allCodexIds).size).toBe(48);
    for (const defId of allCodexIds) {
      expect(getAnyV2ItemDef(defId)).toBeDefined();
      const art = getItemImageUrl(defId);
      expect(typeof art).toBe('string');
      expect(art.length).toBeGreaterThan(0);
    }
    const seenAll = recordV2SeenItems(createFreshV2Profile(), allCodexIds);
    expect(seenAll.seenItems.length).toBe(48);

    // Holodeck / Trial isolation across ALL 4 ships (including stargate_cruiser!)
    const freshProf = makeM5Profile();
    for (const shipId of V2_SHIP_ORDER) {
      for (const trialId of V2_TRIAL_BUILD_ORDER) {
        const slots = buildTrialPrepareSlots(trialId, shipId);
        const check = validateV2PrepareLoadout(freshProf, shipId, 'engineer', slots, trialId);
        expect(check.valid).toBe(true);
      }
    }
    // Mixing an owned gadget into a Trial loadout MUST be rejected
    const withGadgetProf = craftV3GadgetWithParts(freshProf, 'repair_kit', 'mix_chk').profile;
    const trialSlots = buildTrialPrepareSlots('trial_heavy', 'stargate_cruiser');
    const mixedCheck = validateV2PrepareLoadout(
      withGadgetProf,
      'stargate_cruiser',
      'engineer',
      [
        ...trialSlots,
        {
          slotKey: 'ill_g',
          definitionId: 'gadget.repair_kit',
          origin: 'owned',
          warehouseInstanceId: withGadgetProf.equipmentWarehouse[0].instanceId,
          x: 2,
          y: 3,
          rotation: 0,
        },
      ],
      'trial_heavy'
    );
    expect(mixedCheck.valid).toBe(false);

    // Showcase run strict immutability
    const showcase = createV2ShowcaseRun('trial_hangar', 'holodeck_iso');
    const settledShow = applyV2Settlement(freshProf, {
      ...showcase,
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
      wallet: 999,
      salvagePartsEarned: 999,
    });
    expect(settledShow.profile).toBe(freshProf);

    // V2BaseDioramaState contract validation & V1 BaseProgression coexistence
    const v1Prog: BaseProgression = createInitialProgression();
    expect(v1Prog.buildings.workbench).toBe(false);
    const diorama: V2BaseDioramaState = {
      activeShipId: 'stargate_cruiser',
      facilityTiers: restored.facilityTiers,
      restoredRelicIds: activePassives.activeRelicIds,
      campaignAct: restored.campaign.currentAct,
      stargatePowered: getFacilityTier(restored, 'stargate_relay') >= 1,
      warehouseCount: restored.equipmentWarehouse.length,
      warehouseCapacity: getEffectiveWarehouseCapacity(restored),
      unlockedShipsCount: restored.unlockedShips.length,
      totalShips: V2_SHIP_ORDER.length,
    };
    expect(diorama.activeShipId).toBe('stargate_cruiser');
    expect(diorama.restoredRelicIds.length).toBe(4);
    expect(diorama.totalShips).toBe(4);
    expect(buildFreeFallbackPrepareSlots('stargate_cruiser', restored.blueprints).length).toBeGreaterThan(0);
  });
});
