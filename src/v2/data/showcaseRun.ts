import { buildEncounterUnits } from './enemies';
import { buildTrialPrepareSlots, V2_TRIAL_BUILDS } from './trialBuilds';
import { createV2ContractInstance } from '../domain/contracts';
import { createV2CargoInstance, createV2EquipmentInstance } from '../domain/itemCatalog';
import { createV2RngStreams } from '../domain/rngStreams';
import {
  V2_MAX_FUEL,
  V2_RULES_VERSION,
  V2_SCHEMA_VERSION,
  V2_STARTING_FUEL,
  type V2MapNode,
  type V2PlacedItem,
  type V2RunState,
  type V2StarGraph,
  type V2TrialBuildId,
} from '../domain/types';

export const V2_SHOWCASE_SEED = 20261122;

/**
 * Curated 4-layer "10-Minute Vertical Slice" showcase run (never mutates formal save/profile):
 * - Starts with the player's chosen cohesive Trial Build (Heavy Railgun / Drone Hangar / Shield Counter)
 * - Layer 1: Archetype-tailored showcase battle (L1A) OR 3-hotspot Salvage Wreck (L1B)
 * - Layer 2: 3-hotspot Salvage Wreck with Armory / Reactor(+2 Fuel or +8 HP) / Cargo (L2A) OR Traveling Merchant (L2B)
 * - Layer 3: Contract Objective Wreck granting 2×3 Sealed Reactor (L3A) forcing real spatial trade-offs OR Anomaly Sector (L3B)
 * - Layer 4: Elite Flagship Battle (L4A, supports Phase-D Round-2 tactical decision!) OR Distress Signal safe exit (L4B)
 */
export function createV2ShowcaseRun(
  trialBuildId: V2TrialBuildId,
  runId = `showcase_${trialBuildId}_${Date.now().toString(36)}`
): V2RunState {
  const trial = V2_TRIAL_BUILDS[trialBuildId];
  const streams = createV2RngStreams(V2_SHOWCASE_SEED);
  const trialSlots = buildTrialPrepareSlots(trialBuildId, 'cannon_skiff');

  const placed: V2PlacedItem[] = trialSlots.map((s, idx) => {
    const kind = s.definitionId.split('.')[1] as Parameters<typeof createV2EquipmentInstance>[0]['kind'];
    return {
      item: createV2EquipmentInstance({
        instanceId: `${runId}_trial_${idx + 1}`,
        kind,
        quality: 'common',
        origin: 'loan',
        acquiredDepth: 0,
        location: 'bay',
      }),
      x: s.x,
      y: s.y,
      rotation: s.rotation,
    };
  });

  // Preload 2 valuable salvage items into the bottom rows so Layer 3's 2×3 Reactor creates genuine spatial tension!
  // Trial builds occupy rows 0..2 (cols 0..2 or 0..3):
  // - trial_heavy: (0,0)(0,1)(0,2), (1,0), (2,0)(2,1) -> free bottom-right (1,2)(2,2)(3,2)(1,3)(2,3)(3,3)
  // - trial_hangar: (0,0)(1,0)(0,1)(1,1), (2,0), (3,0)(3,1) -> free rows 2..3 completely!
  // - trial_counter: (0,0)(0,1), (1,0)(1,1), (2,0)(2,1) -> free rows 2..3 completely!
  placed.push(
    {
      item: createV2CargoInstance({
        instanceId: `${runId}_pre_engine`,
        defId: 'cargo.old_engine', // 2x2 at (2,2) -> (2,2)(3,2)(2,3)(3,3)
        origin: 'loot',
        acquiredDepth: 1,
        location: 'bay',
        fixedValueOverride: 28,
      }),
      x: 2,
      y: 2,
      rotation: 0,
    },
    {
      item: createV2CargoInstance({
        instanceId: `${runId}_pre_data`,
        defId: 'cargo.data_box', // 1x1 at (1,3)
        origin: 'loot',
        acquiredDepth: 1,
        location: 'bay',
        fixedValueOverride: 14,
      }),
      x: 1,
      y: 3,
      rotation: 0,
    }
  );

  const l1EncounterKind =
    trialBuildId === 'trial_heavy'
      ? 'armored'
      : trialBuildId === 'trial_hangar'
      ? 'swarm'
      : 'patrol';

  const l1Combat: V2MapNode = {
    nodeId: 'L1A',
    layer: 1,
    lane: 0,
    type: 'combat',
    sectorBg: 1,
    nextNodeIds: ['L2A', 'L2B'],
    contractMarker: false,
    combat: {
      encounterKind: l1EncounterKind,
      units: buildEncounterUnits(l1EncounterKind, 2, 'L1A'),
      bounty: 14,
      improvedProb: 0.25,
    },
    resolved: false,
  };

  const l1Wreck: V2MapNode = {
    nodeId: 'L1B',
    layer: 1,
    lane: 1,
    type: 'wreck',
    sectorBg: 1,
    nextNodeIds: ['L2A', 'L2B'],
    contractMarker: false,
    wreck: {
      armoryItem: createV2EquipmentInstance({
        instanceId: `${runId}_l1_eq`,
        kind: trialBuildId === 'trial_heavy' ? 'laser' : 'flak',
        quality: 'common',
        origin: 'loot',
        acquiredDepth: 1,
        location: 'staging',
      }),
      cargoItems: [
        createV2CargoInstance({
          instanceId: `${runId}_l1_cg1`,
          defId: 'cargo.alloy_bar',
          origin: 'loot',
          acquiredDepth: 1,
          location: 'staging',
        }),
        createV2CargoInstance({
          instanceId: `${runId}_l1_cg2`,
          defId: 'cargo.data_box',
          origin: 'loot',
          acquiredDepth: 1,
          location: 'staging',
        }),
      ],
      armorySizeRange: '2–4 格设备',
      armoryValueRange: '回收 10–20¤',
      cargoSizeRange: '2 件（1–2 格）',
      cargoValueRange: '合计 22¤',
      reactorFuelGain: 2,
      reactorRepairGain: 8,
      chosenRoom: null,
    },
    resolved: false,
  };

  const l2Wreck: V2MapNode = {
    nodeId: 'L2A',
    layer: 2,
    lane: 0,
    type: 'wreck',
    sectorBg: 2,
    nextNodeIds: ['L3A', 'L3B'],
    contractMarker: false,
    wreck: {
      armoryItem: createV2EquipmentInstance({
        instanceId: `${runId}_l2_eq`,
        kind:
          trialBuildId === 'trial_heavy'
            ? 'capacitor'
            : trialBuildId === 'trial_hangar'
            ? 'hangar'
            : 'battery',
        quality: 'improved',
        origin: 'loot',
        acquiredDepth: 2,
        location: 'staging',
      }),
      cargoItems: [
        createV2CargoInstance({
          instanceId: `${runId}_l2_cg1`,
          defId: 'cargo.coolant_tank',
          origin: 'loot',
          acquiredDepth: 2,
          location: 'staging',
        }),
        createV2CargoInstance({
          instanceId: `${runId}_l2_cg2`,
          defId: 'cargo.data_box',
          origin: 'loot',
          acquiredDepth: 2,
          location: 'staging',
        }),
      ],
      armorySizeRange: '优良核心配件',
      armoryValueRange: '回收 12–30¤',
      cargoSizeRange: '2 件（1–3 格）',
      cargoValueRange: '合计 39¤',
      reactorFuelGain: 2,
      reactorRepairGain: 8,
      chosenRoom: null,
    },
    resolved: false,
  };

  const l2Merchant: V2MapNode = {
    nodeId: 'L2B',
    layer: 2,
    lane: 1,
    type: 'merchant',
    sectorBg: 4,
    nextNodeIds: ['L3A', 'L3B'],
    contractMarker: false,
    merchant: {
      offers: [
        {
          offerId: 'L2B_offer_1',
          item: createV2EquipmentInstance({
            instanceId: `${runId}_shop_1`,
            kind: 'flak',
            quality: 'common',
            origin: 'loot',
            acquiredDepth: 2,
            location: 'staging',
          }),
          buyPrice: 32,
          sold: false,
        },
        {
          offerId: 'L2B_offer_2',
          item: createV2EquipmentInstance({
            instanceId: `${runId}_shop_2`,
            kind: 'battery',
            quality: 'improved',
            origin: 'loot',
            acquiredDepth: 2,
            location: 'staging',
          }),
          buyPrice: 28,
          sold: false,
        },
      ],
      fuelPrice: 10,
      fuelAmount: 2,
      fuelBought: false,
      repairPrice: 12,
      repairAmount: 10,
      repairBought: false,
    },
    resolved: false,
  };

  const l3Objective: V2MapNode = {
    nodeId: 'L3A',
    layer: 3,
    lane: 0,
    type: 'wreck',
    sectorBg: 5,
    nextNodeIds: ['L4A', 'L4B'],
    contractMarker: true,
    wreck: {
      armoryItem: createV2EquipmentInstance({
        instanceId: `${runId}_l3_eq`,
        kind: 'shield',
        quality: 'improved',
        origin: 'loot',
        acquiredDepth: 3,
        location: 'staging',
      }),
      cargoItems: [
        createV2CargoInstance({
          instanceId: `${runId}_l3_cg1`,
          defId: 'cargo.ancient_navigator',
          origin: 'loot',
          acquiredDepth: 3,
          location: 'staging',
        }),
        createV2CargoInstance({
          instanceId: `${runId}_l3_cg2`,
          defId: 'cargo.alloy_bar',
          origin: 'loot',
          acquiredDepth: 3,
          location: 'staging',
        }),
      ],
      armorySizeRange: '2 格优良护盾',
      armoryValueRange: '回收 15¤',
      cargoSizeRange: '含古星图仪藏品',
      cargoValueRange: '合计 80¤+',
      reactorFuelGain: 2,
      reactorRepairGain: 8,
      chosenRoom: null,
    },
    resolved: false,
  };

  const l3Anomaly: V2MapNode = {
    nodeId: 'L3B',
    layer: 3,
    lane: 1,
    type: 'anomaly',
    sectorBg: 3,
    nextNodeIds: ['L4A', 'L4B'],
    contractMarker: false,
    anomaly: {
      cargoCategoryLabel: '折叠天线（L3 · 单件 42¤）',
      safeFuelCost: 1,
      safeCargoItem: createV2CargoInstance({
        instanceId: `${runId}_l3_anom_s`,
        defId: 'cargo.folding_antenna',
        origin: 'loot',
        acquiredDepth: 3,
        location: 'staging',
      }),
      breachHpCost: 4,
      breachCargoItems: [
        createV2CargoInstance({
          instanceId: `${runId}_l3_anom_b1`,
          defId: 'cargo.folding_antenna',
          origin: 'loot',
          acquiredDepth: 3,
          location: 'staging',
        }),
        createV2CargoInstance({
          instanceId: `${runId}_l3_anom_b2`,
          defId: 'cargo.data_box',
          origin: 'loot',
          acquiredDepth: 3,
          location: 'staging',
        }),
      ],
      chosenOption: null,
    },
    resolved: false,
  };

  const l4Elite: V2MapNode = {
    nodeId: 'L4A',
    layer: 4,
    lane: 0,
    type: 'elite',
    sectorBg: 6,
    nextNodeIds: [],
    contractMarker: false,
    combat: {
      encounterKind: 'elite',
      units: buildEncounterUnits('elite', 4, 'L4A', trialBuildId === 'trial_counter'),
      bounty: 45,
      improvedProb: 0.4,
    },
    resolved: false,
  };

  const l4Distress: V2MapNode = {
    nodeId: 'L4B',
    layer: 4,
    lane: 1,
    type: 'distress',
    sectorBg: 6,
    nextNodeIds: [],
    contractMarker: false,
    distress: {
      rescueFuelCost: 1,
      repairAmount: 10,
      haulCargoItem: createV2CargoInstance({
        instanceId: `${runId}_l4_dist`,
        defId: 'cargo.quantum_core',
        origin: 'loot',
        acquiredDepth: 4,
        location: 'staging',
      }),
      chosenOption: null,
    },
    resolved: false,
  };

  const graph: V2StarGraph = {
    maxLayers: 4,
    startNextNodeIds: ['L1A', 'L1B'],
    nodes: {
      L1A: l1Combat,
      L1B: l1Wreck,
      L2A: l2Wreck,
      L2B: l2Merchant,
      L3A: l3Objective,
      L3B: l3Anomaly,
      L4A: l4Elite,
      L4B: l4Distress,
    },
    guaranteedPathNodeIds: ['L1A', 'L2A', 'L3A', 'L4B'],
  };

  const contract = createV2ContractInstance('transport_std', ['L3A'], runId);

  return {
    runId,
    schemaVersion: V2_SCHEMA_VERSION,
    rulesVersion: V2_RULES_VERSION,
    seed: V2_SHOWCASE_SEED,
    rngStreams: streams,
    isTutorial: false,
    isShowcase: true,
    trialBuildId,
    allowImproved: true,
    contract,
    shipId: 'cannon_skiff',
    crewId: 'engineer',
    primaryArchetype: trial.archetypeId,
    fuel: V2_STARTING_FUEL,
    maxFuel: V2_MAX_FUEL,
    hp: 30,
    maxHp: 30,
    wallet: 20, // Showcase stipend so L2 Merchant is immediately interactive
    graph,
    visitedNodeIds: [],
    currentNodeId: null,
    phase: 'MAP',
    bay: {
      shipId: 'cannon_skiff',
      placed,
      staging: [],
      discardedThisArrange: [],
    },
    targetPolicy: 'weakest',
    activeCombat: null,
    pendingReward: null,
    claimedEventIds: [],
    transactionIds: [],
    engineerSwapAvailable: true,
    activeEngineerOffer: null,
    navigatorFreeJumpUsed: false,
    settlementReason: null,
    sectorId: 'near_orbit',
    endlessThreat: 0,
    endlessMutatorIds: [],
    recentEquipmentKinds: [],
    usedEventIds: [],
    tacticalChargesMax: 1,
    tacticalChargesUsed: 0,
    salvagePartsEarned: 0,
    isFinalCampaignRun: false,
  };
}
