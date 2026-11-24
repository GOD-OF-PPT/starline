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
  type V2StagingItem,
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
    mapHint: '首航教学（共 4 层）：前往第 1 层巡逻靶舰检验「激光炮 + 能量电池」联动增伤，再拆残骸并在第 3 层回收 2×3 密封反应堆！',
    encounterHint: '',
    arrangeHint: '先装电池：把暂存区的「能量电池」放进 (1,0) 贴紧激光炮，触发每轮 +2 增伤后点击「整理完毕」出发！',
  },
  1: {
    layer: 1,
    mapHint: '第 1 层告捷！前往第 2 层「漂流残骸」亲手切割舱室并体验林工现场改装。',
    encounterHint: '教学靶舰：激光炮贴邻能量电池后可大幅提升压制效率、减少受击轮次。倒计时结束或点击「开始交火」立即开战。',
    arrangeHint: '拖放或点选把奖励摆入 4×4 船舱，也可使用林工现场改装；整理完毕前往第 2 层。',
  },
  2: {
    layer: 2,
    mapHint: '前往第 3 层目标残骸回收「2×3 密封反应堆」（占 6 格），注意船舱空间取舍！',
    encounterHint: '废船切割首刀安全无伤：军械舱拿设备、货舱拿高价货、反应舱补油/抢修，切完即可撤离。',
    arrangeHint: '调整装备贴邻可点亮联动并同步更新舰体外挂；整理完毕即可跃迁第 3 层。',
  },
  3: {
    layer: 3,
    mapHint: '第 4 层最终抉择：走 A 线回收信标零风险回港交付，或挑战 B 线封锁拦截艇赢取古代遗物「古代导航仪」！',
    encounterHint: '已抵达反应堆封存舱！撤离时将同步回收 2×3 密封反应堆（占 6 格），进入空间取舍。',
    arrangeHint: '空间冲突！2×3 密封反应堆（6 格）与现有物品无法共存：参考实时「将损失」提示决定舍弃旧货或武器（卸炮会让第 4 层 B 线转为高危）。',
  },
  4: {
    layer: 4,
    mapHint: '已抵达第 4 层终层节点，直接安全返航即可交付反应堆！',
    encounterHint: 'A 线信标可零风险回港交付；B 线封锁拦截艇护甲与穿盾火力较强，保留激光炮+电池可稳健压制并夺取「古代导航仪」！',
    arrangeHint: '将战利品装舱后即可进入返航结算，免费通电工作台并领取 +40¤ 首航奖励！',
  },
};

/**
 * Builds the deterministic 4-layer V2/V3 First-Voyage Tutorial Run (S01 / AC01):
 * - Step 1: Starts in `ARRANGE` (`currentNodeId: null`) with `battery.common` in `bay.staging`
 *   (NOT pre-placed!) and 11/16 occupied cells (`laser` at (0,0), `old_engine` at (2,0),
 *   `coolant_tank` at (1,1) covering PowerCell (1,2), `alloy_bar` at (0,2)) leaving pocket (1,0)
 *   right beside `laser.common`.
 * - Step 2 (`L1A`): Dedicated 14 HP / 2 dmg `patrol_tutorial` — wired Laser+Battery wins in
 *   2 rounds (26 HP left) vs unwired 3 rounds (24 HP left).
 * - Step 3 (`L2A`): Derelict wreck clamp cut + Lin Gong Engineer Swap (`engineerSwapAvailable: true`).
 * - Step 4 (`L3A`, penultimate): Contract objective wreck granting `2x3` Sealed Reactor (6 cells)
 *   BEFORE `shouldAutoSkipArrange`, guaranteeing a real spatial conflict (11+6=17 > 16; 12+6=18 > 16)
 *   with >= 2 feasible single-discard choices and live sacrifice preview.
 * - Step 5 (`L4A` vs `L4B` fork):
 *   - `L4A`: Safe Return Beacon (`tutorial_safe_beacon`, 1 fallback option -> direct SETTLEMENT).
 *   - `L4B`: Optional Risk Branch (`tutorial_raider` 7 HP / 4 pierce dmg / armor 2 + guaranteed `cargo.ancient_navigator`),
 *     steady (2r) if Laser+Battery kept, dangerous/lethal if Laser discarded.
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
      encounterKind: 'patrol_tutorial',
      units: buildEncounterUnits('patrol_tutorial', 1, 'L1A'),
      bounty: 6,
      improvedProb: 0,
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
      cargoValueRange: '合计 25¤',
      reactorFuelGain: 2,
      reactorRepairGain: 8,
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
    nextNodeIds: ['L4A', 'L4B'],
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
      cargoValueRange: '合计 18¤',
      reactorFuelGain: 2,
      reactorRepairGain: 8,
      chosenRoom: null,
    },
    resolved: false,
  };

  const l4SafeBeacon: V2MapNode = {
    nodeId: 'L4A',
    layer: 4,
    lane: 0,
    type: 'distress',
    sectorBg: 1,
    nextNodeIds: [],
    contractMarker: false,
    eventId: 'tutorial_safe_beacon',
    eventState: {
      nodeId: 'L4A',
      eventId: 'tutorial_safe_beacon',
      title: '近轨回收信标 · 安全回港',
      description:
        '拆解站回收引导信标已锁定你的航迹。携带密封反应堆直接接驳，即可零风险返港交付并通电工作台。',
      resolved: false,
      chosenIndex: null,
      flavorTag: '安全回港',
      options: [
        {
          index: 0,
          label: '接入回收信标 · 安全回港交付',
          costSummary: '0 伤害 · 零战斗风险',
          rewardSummary: '立即安全返港交付密封反应堆（+40¤ 首航奖励）',
          isFallback: true,
        },
      ],
    },
    resolved: false,
  };

  const l4RiskBranch: V2MapNode = {
    nodeId: 'L4B',
    layer: 4,
    lane: 1,
    type: 'combat',
    sectorBg: 4,
    nextNodeIds: [],
    contractMarker: false,
    hasRelicSignal: true,
    relicSignalDefId: 'cargo.ancient_navigator',
    combat: {
      encounterKind: 'tutorial_raider',
      units: buildEncounterUnits('tutorial_raider', 4, 'L4B'),
      bounty: 18,
      improvedProb: 0,
    },
    resolved: false,
  };

  const graph: V2StarGraph = {
    maxLayers: 4,
    startNextNodeIds: ['L1A'],
    nodes: {
      L1A: l1Combat,
      L2A: l2Wreck,
      L3A: l3Objective,
      L4A: l4SafeBeacon,
      L4B: l4RiskBranch,
    },
    guaranteedPathNodeIds: ['L1A', 'L2A', 'L3A', 'L4A'],
  };

  const contract = createV2ContractInstance('transport_std', ['L3A'], runId);

  // Preload 11 cells on 4x4 cannon_skiff leaving pocket (1,0) directly adjacent to laser.common!
  // coolant_tank covers hull PowerCell (1,2) so Step-1 battery wiring targets (1,0) unambiguously.
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

  // Step 1: Battery starts in staging/hand so the player wires it next to Laser themselves!
  const initialStaging: V2StagingItem[] = [
    {
      item: createV2EquipmentInstance({
        instanceId: `${runId}_tut_bat`,
        kind: 'battery',
        quality: 'common',
        origin: 'loan',
        acquiredDepth: 0,
        location: 'staging',
      }),
      rotation: 0,
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
    phase: 'ARRANGE',
    bay: {
      shipId: 'cannon_skiff',
      placed: initialPlaced,
      staging: initialStaging,
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
