import { buildEncounterUnits } from '../data/enemies';
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
} from '../domain/types';

export const V2_TUTORIAL_SEED = 20261121;

export interface V2TutorialStageHint {
  readonly layer: number;
  readonly mapHint: string;
  readonly encounterHint: string;
  readonly arrangeHint: string;
}

export const V2_TUTORIAL_HINTS: Record<number, V2TutorialStageHint> = {
  0: {
    layer: 0,
    mapHint: '教学航次（共 3 层）：你的任务是在第 3 层回收 2×3 密封反应堆！先前往第 1 层巡逻艇体验战损预测与交火。',
    encounterHint: '',
    arrangeHint: '',
  },
  1: {
    layer: 1,
    mapHint: '前往第 2 层「废船打捞」体验武器舱/货仓二选一与船舱旋转拼装。',
    encounterHint: '开战前可切换“最弱优先 / 最大威胁”并查看准确战损预览，点击「开始交火」自动战斗。',
    arrangeHint: '拖放或点选（也可 Tab/方向键/Enter/R）把奖励放入 4×4 船舱，整理完毕进入第 2 层。',
  },
  2: {
    layer: 2,
    mapHint: '最后一步：前往第 3 层目标节点回收「2×3 密封反应堆」（占 6 格）。',
    encounterHint: '废船二选一：选择武器舱拿设备，或货仓拿高价货物（不可两边都开）。',
    arrangeHint: '试着旋转并调整装备位置；激光炮紧挨电池可获得每轮 +2 增伤！',
  },
  3: {
    layer: 3,
    mapHint: '完成整理后即可免费呼叫回收信标安全返航并交付反应堆！',
    encounterHint: '已抵达反应堆封存舱！点击回收进入船舱空间取舍演示。',
    arrangeHint: '空间冲突出现！2×3 密封反应堆（6格）与现有货物无法同时装下：请舍弃旧发动机或冷却罐腾出 2×3 空间，或点击「放弃委托」直接带货返航。',
  },
};

/**
 * Builds the deterministic 3-layer V2 Tutorial Run (§12 & AC01):
 * - Preloads 12/16 occupied cells on cannon_skiff (4x4):
 *     laser.common (1x2, loan) + battery.common (1x1, loan) + old_engine (2x2, loot 24¤)
 *     + coolant_tank (1x3, loot 18¤) + alloy_bar (1x2, loan 0¤)
 * - Layer 1: Patrol light combat (HP 15, dmg 2) -> reward shield/alloy_bar/repair
 * - Layer 2: Wreck salvage (Armory laser vs Cargo alloy_bar + data_box)
 * - Layer 3: Contract objective wreck holding the 2x3 Sealed Reactor (6 cells)!
 *   Even with 0 extra items kept from L1/L2, 12 + 6 = 18 > 16 => mathematically guaranteed
 *   impossible to keep all simultaneously, with >=2 feasible single-discard solutions!
 */
export function createV2TutorialRun(runId: string): V2RunState {
  const streams = createV2RngStreams(V2_TUTORIAL_SEED);

  const l1Combat: V2MapNode = {
    nodeId: 'L1A',
    layer: 1,
    lane: 0,
    type: 'combat',
    sectorBg: 1,
    nextNodeIds: ['L2A'],
    contractMarker: false,
    combat: {
      encounterKind: 'patrol',
      units: buildEncounterUnits('patrol', 1, 'L1A'),
      bounty: 6,
      improvedProb: 0,
    },
    resolved: false,
  };

  const l1Wreck: V2MapNode = {
    nodeId: 'L1B',
    layer: 1,
    lane: 1,
    type: 'wreck',
    sectorBg: 1,
    nextNodeIds: ['L2A'],
    contractMarker: false,
    wreck: {
      armoryItem: createV2EquipmentInstance({
        instanceId: `${runId}_tut_l1_shd`,
        kind: 'shield',
        quality: 'common',
        origin: 'loot',
        acquiredDepth: 1,
        location: 'staging',
      }),
      cargoItems: [
        createV2CargoInstance({
          instanceId: `${runId}_tut_l1_cg1`,
          defId: 'cargo.data_box',
          origin: 'loot',
          acquiredDepth: 1,
          location: 'staging',
        }),
        createV2CargoInstance({
          instanceId: `${runId}_tut_l1_cg2`,
          defId: 'cargo.alloy_bar',
          origin: 'loot',
          acquiredDepth: 1,
          location: 'staging',
        }),
      ],
      armorySizeRange: '2 格设备',
      armoryValueRange: '回收 10¤',
      cargoSizeRange: '2 件（1–2 格）',
      cargoValueRange: '合计 26¤',
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
    nextNodeIds: ['L3A'],
    contractMarker: false,
    wreck: {
      armoryItem: createV2EquipmentInstance({
        instanceId: `${runId}_tut_l2_shd`,
        kind: 'shield',
        quality: 'common',
        origin: 'loot',
        acquiredDepth: 2,
        location: 'staging',
      }),
      cargoItems: [
        createV2CargoInstance({
          instanceId: `${runId}_tut_l2_cg1`,
          defId: 'cargo.alloy_bar',
          origin: 'loot',
          acquiredDepth: 2,
          location: 'staging',
        }),
        createV2CargoInstance({
          instanceId: `${runId}_tut_l2_cg2`,
          defId: 'cargo.data_box',
          origin: 'loot',
          acquiredDepth: 2,
          location: 'staging',
        }),
      ],
      armorySizeRange: '2 格设备',
      armoryValueRange: '回收 10¤',
      cargoSizeRange: '2 件（1–2 格）',
      cargoValueRange: '合计 30¤',
      chosenRoom: null,
    },
    resolved: false,
  };

  const l3Objective: V2MapNode = {
    nodeId: 'L3A',
    layer: 3,
    lane: 0,
    type: 'wreck',
    sectorBg: 4,
    nextNodeIds: [],
    contractMarker: true,
    wreck: {
      armoryItem: createV2EquipmentInstance({
        instanceId: `${runId}_tut_l3_bat`,
        kind: 'battery',
        quality: 'common',
        origin: 'loot',
        acquiredDepth: 3,
        location: 'staging',
      }),
      cargoItems: [
        createV2CargoInstance({
          instanceId: `${runId}_tut_l3_cg1`,
          defId: 'cargo.data_box',
          origin: 'loot',
          acquiredDepth: 3,
          location: 'staging',
        }),
        createV2CargoInstance({
          instanceId: `${runId}_tut_l3_cg2`,
          defId: 'cargo.data_box',
          origin: 'loot',
          acquiredDepth: 3,
          location: 'staging',
        }),
      ],
      armorySizeRange: '1 格设备',
      armoryValueRange: '回收 8¤',
      cargoSizeRange: '2 件（1 格）',
      cargoValueRange: '合计 26¤',
      chosenRoom: null,
    },
    resolved: false,
  };

  const graph: V2StarGraph = {
    maxLayers: 3,
    startNextNodeIds: ['L1A', 'L1B'],
    nodes: {
      L1A: l1Combat,
      L1B: l1Wreck,
      L2A: l2Wreck,
      L3A: l3Objective,
    },
    guaranteedPathNodeIds: ['L1A', 'L2A', 'L3A'],
  };

  const contract = createV2ContractInstance('transport_std', ['L3A'], runId);

  // Preload 12 cells on 4x4 cannon_skiff so adding 2x3 Sealed Reactor (6 cells) ALWAYS creates a real spatial conflict!
  const initialPlaced: V2PlacedItem[] = [
    {
      item: createV2EquipmentInstance({
        instanceId: `${runId}_tut_laser`,
        kind: 'laser',
        quality: 'common',
        origin: 'loan',
        acquiredDepth: 0,
        location: 'bay',
      }),
      x: 0,
      y: 0,
      rotation: 0, // (0,0),(0,1)
    },
    {
      item: createV2EquipmentInstance({
        instanceId: `${runId}_tut_bat`,
        kind: 'battery',
        quality: 'common',
        origin: 'loan',
        acquiredDepth: 0,
        location: 'bay',
      }),
      x: 1,
      y: 0,
      rotation: 0, // (1,0) adjacent to laser!
    },
    {
      item: createV2CargoInstance({
        instanceId: `${runId}_tut_eng`,
        defId: 'cargo.old_engine',
        origin: 'loot',
        acquiredDepth: 1,
        location: 'bay',
        fixedValueOverride: 24,
      }),
      x: 2,
      y: 0,
      rotation: 0, // (2,0),(3,0),(2,1),(3,1)
    },
    {
      item: createV2CargoInstance({
        instanceId: `${runId}_tut_cool`,
        defId: 'cargo.coolant_tank',
        origin: 'loot',
        acquiredDepth: 1,
        location: 'bay',
        fixedValueOverride: 18,
      }),
      x: 1,
      y: 1,
      rotation: 0, // (1,1),(1,2),(1,3)
    },
    {
      item: createV2CargoInstance({
        instanceId: `${runId}_tut_alloy`,
        defId: 'cargo.alloy_bar',
        origin: 'loan',
        acquiredDepth: 0,
        location: 'bay',
      }),
      x: 0,
      y: 2,
      rotation: 0, // (0,2),(0,3)
    },
  ];

  return {
    runId,
    schemaVersion: V2_SCHEMA_VERSION,
    rulesVersion: V2_RULES_VERSION,
    seed: V2_TUTORIAL_SEED,
    rngStreams: streams,
    isTutorial: true,
    allowImproved: false,
    contract,
    shipId: 'cannon_skiff',
    crewId: 'engineer',
    primaryArchetype: 'laser',
    fuel: V2_STARTING_FUEL,
    maxFuel: V2_MAX_FUEL,
    hp: 30,
    maxHp: 30,
    wallet: 0,
    graph,
    visitedNodeIds: [],
    currentNodeId: null,
    phase: 'MAP',
    bay: {
      shipId: 'cannon_skiff',
      placed: initialPlaced,
      staging: [],
      discardedThisArrange: [],
    },
    targetPolicy: 'weakest',
    activeCombat: null,
    pendingReward: null,
    claimedEventIds: [],
    transactionIds: [],
    engineerSwapAvailable: false,
    activeEngineerOffer: null,
    navigatorFreeJumpUsed: false,
    settlementReason: null,
  };
}
