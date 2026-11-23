import {
  V2_EXTENDED_RELIC_CARGO_KINDS,
  V2_REGULAR_CARGO_KINDS,
} from '../data/cargo';
import {
  getMerchantBuybackPrice,
  getUnlockedEquipmentKinds,
  type V2EquipmentKind,
  type V2Quality,
  type V2UnlockFamilyId,
} from '../data/equipment';
import { computeV2JumpFuelCost } from './contracts';
import { addV2ItemToStaging, removeV2ItemById } from './inventoryV2';
import { createV2CargoInstance, createV2EquipmentInstance } from './itemCatalog';
import { withV2Stream } from './rngStreams';
import type {
  V2CombatRewardBundle,
  V2EngineerSwapOffer,
  V2ItemInstance,
  V2MapNode,
  V2RngStreams,
  V2RunState,
} from './types';

export interface V2ActionOutcome {
  readonly ok: boolean;
  readonly run: V2RunState;
  readonly error?: string;
}

export function getReachableNextNodeIds(run: V2RunState): readonly string[] {
  if (run.currentNodeId === null) {
    return run.graph.startNextNodeIds;
  }
  const cur = run.graph.nodes[run.currentNodeId];
  return cur ? cur.nextNodeIds : [];
}

export function isAtTerminalLayer(run: V2RunState): boolean {
  if (!run.currentNodeId) return false;
  const cur = run.graph.nodes[run.currentNodeId];
  return Boolean(cur && cur.layer >= run.graph.maxLayers);
}

/**
 * Generates an Engineer swap offer (3 distinct common candidates from unlocked pool)
 * on the FIRST non-loan, non-mission equipment acquired during a run (§6.2).
 */
export function maybeCreateEngineerSwapOffer(
  run: V2RunState,
  acquiredItem: V2ItemInstance,
  unlockedFamilies: readonly V2UnlockFamilyId[]
): V2RunState {
  if (!run.engineerSwapAvailable || run.crewId !== 'engineer') return run;
  if (acquiredItem.category !== 'equipment') return run;
  if (acquiredItem.origin === 'loan' || acquiredItem.origin === 'mission') return run;

  const acquiredKind = acquiredItem.definitionId.split('.')[1] as V2EquipmentKind;
  const pool = getUnlockedEquipmentKinds(unlockedFamilies).filter((k) => k !== acquiredKind);
  if (pool.length === 0) return run;

  const draw = withV2Stream(run.rngStreams, 'rewards', (rng) => {
    const remaining = [...pool];
    const picked: V2EquipmentKind[] = [];
    while (picked.length < 3 && remaining.length > 0) {
      const idx = rng.nextInt(remaining.length);
      picked.push(remaining.splice(idx, 1)[0]);
    }
    return picked;
  });

  const offer: V2EngineerSwapOffer = {
    targetInstanceId: acquiredItem.instanceId,
    candidates: draw.value,
    used: false,
  };

  return {
    ...run,
    rngStreams: draw.nextStreams,
    engineerSwapAvailable: false,
    activeEngineerOffer: offer,
  };
}

export function applyV2EngineerSwap(
  run: V2RunState,
  chosenKind: V2EquipmentKind
): V2ActionOutcome {
  const offer = run.activeEngineerOffer;
  if (!offer || offer.used) {
    return { ok: false, run, error: '当前没有可用的工程师改装机会' };
  }
  if (!offer.candidates.includes(chosenKind)) {
    return { ok: false, run, error: '所选设备不在本次候选列表中' };
  }

  // Locate target in staging or bay
  const inStaging = run.bay.staging.find((s) => s.item.instanceId === offer.targetInstanceId);
  const inPlaced = run.bay.placed.find((p) => p.item.instanceId === offer.targetInstanceId);
  const orig = inStaging?.item ?? inPlaced?.item;
  if (!orig || orig.origin === 'owned' || orig.origin === 'loan') {
    return { ok: false, run, error: '原设备已被舍弃或不可改装' };
  }

  const swapped = createV2EquipmentInstance({
    instanceId: `${orig.instanceId}_eng`,
    kind: chosenKind,
    quality: 'common', // §6.2: swaps to same-tier common equipment
    origin: 'loot',
    acquiredDepth: orig.acquiredDepth,
    location: 'staging',
  });

  let nextBay = removeV2ItemById(run.bay, orig.instanceId);
  nextBay = addV2ItemToStaging(nextBay, swapped, 0);

  return {
    ok: true,
    run: {
      ...run,
      bay: nextBay,
      activeEngineerOffer: { ...offer, used: true },
    },
  };
}

/**
 * Spawns mission item(s) (2x3 Sealed Reactor or 1/2 Escape Pods) when resolving a contract objective node.
 * Guaranteed idempotent via claimedEventIds!
 */
export function maybeGrantContractObjectiveItems(run: V2RunState, node: V2MapNode): V2RunState {
  if (!node.contractMarker) return run;
  const c = run.contract;
  if (c.status !== 'active') return run;
  if (c.type !== 'transport' && c.type !== 'rescue') return run;
  if (!c.missionItemDefId || c.missionItemCount <= 0) return run;

  const claimKey = `mission_grant_${node.nodeId}`;
  if (run.claimedEventIds.includes(claimKey)) return run;

  let nextBay = run.bay;
  for (let i = 0; i < c.missionItemCount; i++) {
    const item = createV2CargoInstance({
      instanceId: `${run.runId}_mis_${node.nodeId}_${i + 1}`,
      defId: c.missionItemDefId,
      origin: 'mission',
      acquiredDepth: node.layer,
      location: 'staging',
      missionBinding: c.contractId,
    });
    nextBay = addV2ItemToStaging(nextBay, item, 0);
  }

  return {
    ...run,
    bay: nextBay,
    claimedEventIds: [...run.claimedEventIds, claimKey],
    contract: {
      ...c,
      completedNodeIds: c.completedNodeIds.includes(node.nodeId)
        ? c.completedNodeIds
        : [...c.completedNodeIds, node.nodeId],
    },
  };
}

/**
 * Selects and enters a reachable next-layer map node atomically (deducts fuel once, enters encounter/shop).
 */
export function selectV2MapNode(run: V2RunState, targetNodeId: string): V2ActionOutcome {
  if (run.phase !== 'MAP') {
    return { ok: false, run, error: '当前阶段不可选择航路节点' };
  }
  if (run.bay.staging.length > 0) {
    return { ok: false, run, error: '请先处理暂存区物品再出发' };
  }
  const reachable = getReachableNextNodeIds(run);
  if (!reachable.includes(targetNodeId)) {
    return { ok: false, run, error: '目标节点不在当前可达航线上' };
  }
  const node = run.graph.nodes[targetNodeId];
  if (!node) {
    return { ok: false, run, error: '目标节点不存在' };
  }
  if (run.visitedNodeIds.includes(targetNodeId)) {
    return { ok: false, run, error: '禁止重复进入已访问节点' };
  }

  const fuelCalc = computeV2JumpFuelCost(run);
  if (run.fuel < fuelCalc.totalCost) {
    return {
      ok: false,
      run,
      error: `燃料不足：需要 ${fuelCalc.totalCost}，当前仅有 ${run.fuel}（还差 ${fuelCalc.totalCost - run.fuel}）`,
    };
  }

  const nextPhase = node.type === 'merchant' ? 'SHOP' : 'ENCOUNTER';
  return {
    ok: true,
    run: {
      ...run,
      fuel: run.fuel - fuelCalc.totalCost,
      navigatorFreeJumpUsed: run.navigatorFreeJumpUsed || fuelCalc.navigatorDiscountApplied,
      currentNodeId: targetNodeId,
      visitedNodeIds: [...run.visitedNodeIds, targetNodeId],
      phase: nextPhase,
      activeCombat: null,
      pendingReward: null,
      activeEngineerOffer: null,
    },
  };
}

/**
 * Resolves Wreck Salvage choice: Armory (1 equipment), Cargo Hold (2 cargos),
 * OR Reactor Bay (+2 fuel / +8 HP repair) — mutually exclusive & idempotent (§5.4 + Polish Phase B).
 */
export function resolveV2WreckChoice(
  run: V2RunState,
  room: 'armory' | 'cargo' | 'reactor_fuel' | 'reactor_repair',
  unlockedFamilies: readonly V2UnlockFamilyId[]
): V2ActionOutcome {
  if (run.phase !== 'ENCOUNTER' || !run.currentNodeId) {
    return { ok: false, run, error: '当前不在事件节点内' };
  }
  const node = run.graph.nodes[run.currentNodeId];
  if (!node || node.type !== 'wreck' || !node.wreck) {
    return { ok: false, run, error: '当前节点不是废船打捞' };
  }
  const claimKey = `wreck_${node.nodeId}`;
  if (node.resolved || run.claimedEventIds.includes(claimKey)) {
    return { ok: false, run, error: '该废船事件已结算' };
  }

  let nextBay = run.bay;
  let nextFuel = run.fuel;
  let nextHp = run.hp;
  let acquiredEq: V2ItemInstance | null = null;

  if (room === 'armory') {
    nextBay = addV2ItemToStaging(nextBay, node.wreck.armoryItem, 0);
    acquiredEq = node.wreck.armoryItem;
  } else if (room === 'cargo') {
    for (const cg of node.wreck.cargoItems) {
      nextBay = addV2ItemToStaging(nextBay, cg, 0);
    }
  } else if (room === 'reactor_fuel') {
    const fuelGain = Math.min(node.wreck.reactorFuelGain ?? 2, run.maxFuel - run.fuel);
    if (fuelGain <= 0) {
      return { ok: false, run, error: '燃料已满，可改选应急维修或其他舱室' };
    }
    nextFuel = run.fuel + fuelGain;
  } else {
    const repairGain = Math.min(node.wreck.reactorRepairGain ?? 8, run.maxHp - run.hp);
    if (repairGain <= 0) {
      return { ok: false, run, error: '船体耐久已满，可改选抽取燃料或其他舱室' };
    }
    nextHp = run.hp + repairGain;
  }

  const updatedNode: V2MapNode = {
    ...node,
    resolved: true,
    wreck: { ...node.wreck, chosenRoom: room },
  };

  const armoryKind =
    room === 'armory' && node.layer <= 3
      ? (node.wreck.armoryItem.definitionId.split('.')[1] as V2EquipmentKind)
      : null;
  const nextRecentKinds = armoryKind
    ? [...(run.recentEquipmentKinds ?? []), armoryKind].slice(-4)
    : [...(run.recentEquipmentKinds ?? [])];

  let nextRun: V2RunState = {
    ...run,
    fuel: nextFuel,
    hp: nextHp,
    bay: nextBay,
    phase: 'ARRANGE',
    claimedEventIds: [...run.claimedEventIds, claimKey],
    recentEquipmentKinds: nextRecentKinds,
    graph: {
      ...run.graph,
      nodes: { ...run.graph.nodes, [node.nodeId]: updatedNode },
    },
  };

  if (acquiredEq) {
    nextRun = maybeCreateEngineerSwapOffer(nextRun, acquiredEq, unlockedFamilies);
  }
  nextRun = maybeGrantContractObjectiveItems(nextRun, updatedNode);

  return { ok: true, run: nextRun };
}

/**
 * Resolves Anomaly Sector choice:
 * - traverse: -1 fuel -> 1 cargo of disclosed category
 * - breach: -4 HP (ONLY allowed when hp > 4!) -> 2 cargos of disclosed category (§5.4)
 */
export function resolveV2AnomalyChoice(
  run: V2RunState,
  choice: 'traverse' | 'breach'
): V2ActionOutcome {
  if (run.phase !== 'ENCOUNTER' || !run.currentNodeId) {
    return { ok: false, run, error: '当前不在异常区节点内' };
  }
  const node = run.graph.nodes[run.currentNodeId];
  if (!node || node.type !== 'anomaly' || !node.anomaly) {
    return { ok: false, run, error: '当前节点不是异常区' };
  }
  const claimKey = `anomaly_${node.nodeId}`;
  if (node.resolved || run.claimedEventIds.includes(claimKey)) {
    return { ok: false, run, error: '该异常区事件已结算' };
  }

  let nextFuel = run.fuel;
  let nextHp = run.hp;
  let nextBay = run.bay;

  if (choice === 'traverse') {
    if (run.fuel < node.anomaly.safeFuelCost) {
      return {
        ok: false,
        run,
        error: `燃料不足：穿越需要 ${node.anomaly.safeFuelCost} 燃料，当前 ${run.fuel}`,
      };
    }
    nextFuel -= node.anomaly.safeFuelCost;
    nextBay = addV2ItemToStaging(nextBay, node.anomaly.safeCargoItem, 0);
  } else {
    if (run.hp <= node.anomaly.breachHpCost) {
      return {
        ok: false,
        run,
        error: `耐久不足：强行切入需当前耐久 > ${node.anomaly.breachHpCost}（当前 ${run.hp}）`,
      };
    }
    nextHp -= node.anomaly.breachHpCost;
    for (const cg of node.anomaly.breachCargoItems) {
      nextBay = addV2ItemToStaging(nextBay, cg, 0);
    }
  }

  const updatedNode: V2MapNode = {
    ...node,
    resolved: true,
    anomaly: { ...node.anomaly, chosenOption: choice },
  };

  let nextRun: V2RunState = {
    ...run,
    fuel: nextFuel,
    hp: nextHp,
    bay: nextBay,
    phase: 'ARRANGE',
    claimedEventIds: [...run.claimedEventIds, claimKey],
    graph: {
      ...run.graph,
      nodes: { ...run.graph.nodes, [node.nodeId]: updatedNode },
    },
  };

  nextRun = maybeGrantContractObjectiveItems(nextRun, updatedNode);
  return { ok: true, run: nextRun };
}

/**
 * Resolves Distress Signal choice:
 * - rescue_crew: -1 fuel -> +10 HP (never spawns escape pod!)
 * - haul_cargo: 0 fuel -> 1 disclosed cargo (§5.4)
 */
export function resolveV2DistressChoice(
  run: V2RunState,
  choice: 'rescue_crew' | 'haul_cargo'
): V2ActionOutcome {
  if (run.phase !== 'ENCOUNTER' || !run.currentNodeId) {
    return { ok: false, run, error: '当前不在求救信号节点内' };
  }
  const node = run.graph.nodes[run.currentNodeId];
  if (!node || node.type !== 'distress' || !node.distress) {
    return { ok: false, run, error: '当前节点不是求救信号' };
  }
  const claimKey = `distress_${node.nodeId}`;
  if (node.resolved || run.claimedEventIds.includes(claimKey)) {
    return { ok: false, run, error: '该求救事件已结算' };
  }

  let nextFuel = run.fuel;
  let nextHp = run.hp;
  let nextBay = run.bay;

  if (choice === 'rescue_crew') {
    if (run.fuel < node.distress.rescueFuelCost) {
      return {
        ok: false,
        run,
        error: `燃料不足：救援维修队需 ${node.distress.rescueFuelCost} 燃料`,
      };
    }
    nextFuel -= node.distress.rescueFuelCost;
    nextHp = Math.min(run.maxHp, run.hp + node.distress.repairAmount);
  } else {
    nextBay = addV2ItemToStaging(nextBay, node.distress.haulCargoItem, 0);
  }

  const updatedNode: V2MapNode = {
    ...node,
    resolved: true,
    distress: { ...node.distress, chosenOption: choice },
  };

  let nextRun: V2RunState = {
    ...run,
    fuel: nextFuel,
    hp: nextHp,
    bay: nextBay,
    phase: 'ARRANGE',
    claimedEventIds: [...run.claimedEventIds, claimKey],
    graph: {
      ...run.graph,
      nodes: { ...run.graph.nodes, [node.nodeId]: updatedNode },
    },
  };

  nextRun = maybeGrantContractObjectiveItems(nextRun, updatedNode);
  return { ok: true, run: nextRun };
}

/**
 * Checks whether ALL options in the current non-combat event are unaffordable (§5.4).
 */
export function areAllEventOptionsUnaffordable(run: V2RunState): boolean {
  if (run.phase !== 'ENCOUNTER' || !run.currentNodeId) return false;
  const node = run.graph.nodes[run.currentNodeId];
  if (!node) return false;
  if (node.type === 'anomaly' && node.anomaly) {
    return run.fuel < node.anomaly.safeFuelCost && run.hp <= node.anomaly.breachHpCost;
  }
  return false;
}

/**
 * Abandons the current non-combat event and transitions directly to safe-return SETTLEMENT (§5.4 & §14):
 * - Entry travel fuel is NOT refunded
 * - No reward granted, contract marker NOT completed
 */
export function abandonV2EventAndReturn(run: V2RunState): V2ActionOutcome {
  if (run.phase !== 'ENCOUNTER' || !run.currentNodeId) {
    return { ok: false, run, error: '当前不在可放弃的事件中' };
  }
  const node = run.graph.nodes[run.currentNodeId];
  if (!node || node.type === 'combat' || node.type === 'elite') {
    return { ok: false, run, error: '战斗节点不可按非战斗事件放弃' };
  }
  const updatedNode: V2MapNode = { ...node, abandoned: true, resolved: false };
  return {
    ok: true,
    run: {
      ...run,
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
      graph: {
        ...run.graph,
        nodes: { ...run.graph.nodes, [node.nodeId]: updatedNode },
      },
    },
  };
}

// --- Merchant Transactions (idempotent via transactionIds, AC06) ---

export function buyV2MerchantOffer(
  run: V2RunState,
  offerId: string,
  transactionId: string,
  unlockedFamilies: readonly V2UnlockFamilyId[]
): V2ActionOutcome {
  if (run.phase !== 'SHOP' || !run.currentNodeId) {
    return { ok: false, run, error: '当前不在流动商人界面' };
  }
  if (run.transactionIds.includes(transactionId)) {
    return { ok: false, run, error: '重复交易已拦截' };
  }
  const node = run.graph.nodes[run.currentNodeId];
  if (!node || node.type !== 'merchant' || !node.merchant) {
    return { ok: false, run, error: '当前节点不是商人' };
  }
  const offer = node.merchant.offers.find((o) => o.offerId === offerId);
  if (!offer) return { ok: false, run, error: '商品不存在' };
  if (offer.sold) return { ok: false, run, error: '该设备已售罄（每件限购 1）' };
  if (run.wallet < offer.buyPrice) {
    return { ok: false, run, error: `航行钱包不足（需要 ${offer.buyPrice}¤，当前 ${run.wallet}¤）` };
  }

  const nextOffers = node.merchant.offers.map((o) =>
    o.offerId === offerId ? { ...o, sold: true } : o
  );
  const updatedNode: V2MapNode = {
    ...node,
    merchant: { ...node.merchant, offers: nextOffers },
  };
  let nextRun: V2RunState = {
    ...run,
    wallet: run.wallet - offer.buyPrice,
    bay: addV2ItemToStaging(run.bay, offer.item, 0),
    transactionIds: [...run.transactionIds, transactionId],
    graph: {
      ...run.graph,
      nodes: { ...run.graph.nodes, [node.nodeId]: updatedNode },
    },
  };
  nextRun = maybeCreateEngineerSwapOffer(nextRun, offer.item, unlockedFamilies);
  return { ok: true, run: nextRun };
}

export function buyV2MerchantFuel(run: V2RunState, transactionId: string): V2ActionOutcome {
  if (run.phase !== 'SHOP' || !run.currentNodeId) {
    return { ok: false, run, error: '当前不在流动商人界面' };
  }
  if (run.transactionIds.includes(transactionId)) {
    return { ok: false, run, error: '重复交易已拦截' };
  }
  const node = run.graph.nodes[run.currentNodeId];
  if (!node || node.type !== 'merchant' || !node.merchant) {
    return { ok: false, run, error: '当前节点不是商人' };
  }
  if (node.merchant.fuelBought) {
    return { ok: false, run, error: '本节点燃料补给限购 1 次' };
  }
  const actualGain = Math.min(node.merchant.fuelAmount, run.maxFuel - run.fuel);
  if (actualGain <= 0) {
    return { ok: false, run, error: '燃料已达上限（禁止无收益购买）' };
  }
  if (run.wallet < node.merchant.fuelPrice) {
    return { ok: false, run, error: `航行钱包不足（需要 ${node.merchant.fuelPrice}¤）` };
  }
  const updatedNode: V2MapNode = {
    ...node,
    merchant: { ...node.merchant, fuelBought: true },
  };
  return {
    ok: true,
    run: {
      ...run,
      wallet: run.wallet - node.merchant.fuelPrice,
      fuel: run.fuel + actualGain,
      transactionIds: [...run.transactionIds, transactionId],
      graph: {
        ...run.graph,
        nodes: { ...run.graph.nodes, [node.nodeId]: updatedNode },
      },
    },
  };
}

export function buyV2MerchantRepair(run: V2RunState, transactionId: string): V2ActionOutcome {
  if (run.phase !== 'SHOP' || !run.currentNodeId) {
    return { ok: false, run, error: '当前不在流动商人界面' };
  }
  if (run.transactionIds.includes(transactionId)) {
    return { ok: false, run, error: '重复交易已拦截' };
  }
  const node = run.graph.nodes[run.currentNodeId];
  if (!node || node.type !== 'merchant' || !node.merchant) {
    return { ok: false, run, error: '当前节点不是商人' };
  }
  if (node.merchant.repairBought) {
    return { ok: false, run, error: '本节点维修服务限购 1 次' };
  }
  const actualGain = Math.min(node.merchant.repairAmount, run.maxHp - run.hp);
  if (actualGain <= 0) {
    return { ok: false, run, error: '船体耐久已满（禁止无收益购买）' };
  }
  if (run.wallet < node.merchant.repairPrice) {
    return { ok: false, run, error: `航行钱包不足（需要 ${node.merchant.repairPrice}¤）` };
  }
  const updatedNode: V2MapNode = {
    ...node,
    merchant: { ...node.merchant, repairBought: true },
  };
  return {
    ok: true,
    run: {
      ...run,
      wallet: run.wallet - node.merchant.repairPrice,
      hp: run.hp + actualGain,
      transactionIds: [...run.transactionIds, transactionId],
      graph: {
        ...run.graph,
        nodes: { ...run.graph.nodes, [node.nodeId]: updatedNode },
      },
    },
  };
}

/**
 * Sells a loot item (cargo or loot equipment) to the merchant at floor(fixedValue * 0.8) (§5.4 & §10.1):
 * Strictly rejects loan, owned (base warehouse equipment), and mission items!
 */
export function sellV2ItemToMerchant(
  run: V2RunState,
  instanceId: string,
  transactionId: string
): V2ActionOutcome {
  if (run.phase !== 'SHOP' || !run.currentNodeId) {
    return { ok: false, run, error: '当前不在流动商人界面' };
  }
  if (run.transactionIds.includes(transactionId)) {
    return { ok: false, run, error: '重复交易已拦截' };
  }
  const placed = run.bay.placed.find((p) => p.item.instanceId === instanceId);
  const staged = run.bay.staging.find((s) => s.item.instanceId === instanceId);
  const item = placed?.item ?? staged?.item;
  if (!item) return { ok: false, run, error: '物品不存在' };

  if (item.origin === 'loan') {
    return { ok: false, run, error: '借用设备不可出售' };
  }
  if (item.origin === 'owned') {
    return { ok: false, run, error: '自带基地库存设备不可在沿途商店出售（防止零风险套现）' };
  }
  if (item.origin === 'mission' || item.category === 'mission') {
    return { ok: false, run, error: '任务物资不可出售' };
  }
  const payout = getMerchantBuybackPrice(item.fixedValue);
  if (payout <= 0) {
    return { ok: false, run, error: '该物品无可售价值' };
  }

  return {
    ok: true,
    run: {
      ...run,
      wallet: run.wallet + payout,
      bay: removeV2ItemById(run.bay, instanceId),
      transactionIds: [...run.transactionIds, transactionId],
    },
  };
}

export function finishV2MerchantVisit(run: V2RunState): V2ActionOutcome {
  if (run.phase !== 'SHOP' || !run.currentNodeId) {
    return { ok: false, run, error: '当前不在流动商人界面' };
  }
  const node = run.graph.nodes[run.currentNodeId];
  if (!node || node.type !== 'merchant') {
    return { ok: false, run, error: '当前节点不是商人' };
  }
  const updatedNode: V2MapNode = { ...node, resolved: true };
  let nextRun: V2RunState = {
    ...run,
    phase: 'ARRANGE',
    graph: {
      ...run.graph,
      nodes: { ...run.graph.nodes, [node.nodeId]: updatedNode },
    },
  };
  nextRun = maybeGrantContractObjectiveItems(nextRun, updatedNode);
  return { ok: true, run: nextRun };
}

/**
 * Generates deterministic 3-choice post-combat rewards (1 equipment, 1 cargo, 1 repair +10).
 * Respects guaranteedSupportKind on designated nodes and prevents 3 consecutive identical equipment types in L1-L3!
 */
export function generateV2CombatRewardBundle(
  run: V2RunState,
  node: V2MapNode,
  unlockedFamilies: readonly V2UnlockFamilyId[],
  recentEquipmentKinds: readonly V2EquipmentKind[] = []
): { readonly bundle: V2CombatRewardBundle; readonly nextStreams: V2RngStreams } {
  const combat = node.combat!;
  const unlockedKinds = getUnlockedEquipmentKinds(unlockedFamilies);

  const draw = withV2Stream(run.rngStreams, 'rewards', (rng) => {
    const blockedKind: V2EquipmentKind | null =
      node.layer <= 3 &&
      recentEquipmentKinds.length >= 2 &&
      recentEquipmentKinds[recentEquipmentKinds.length - 1] ===
        recentEquipmentKinds[recentEquipmentKinds.length - 2]
        ? recentEquipmentKinds[recentEquipmentKinds.length - 1]
        : null;

    let eqKind: V2EquipmentKind;
    if (combat.guaranteedSupportKind && combat.guaranteedSupportKind !== blockedKind) {
      eqKind = combat.guaranteedSupportKind;
    } else {
      let pool = [...unlockedKinds];
      if (blockedKind) {
        const filtered = pool.filter((k) => k !== blockedKind);
        if (filtered.length > 0) pool = filtered;
      }
      eqKind = rng.pick(pool);
    }

    const quality: V2Quality =
      run.allowImproved && rng.nextFloat() < combat.improvedProb ? 'improved' : 'common';
    const equipmentOption = createV2EquipmentInstance({
      instanceId: `${run.runId}_rew_eq_${node.nodeId}`,
      kind: eqKind,
      quality,
      origin: 'loot',
      acquiredDepth: node.layer,
      location: 'staging',
    });

    const isElite = node.type === 'elite';
    let cargoDefId: string;
    if (node.layer >= 4 && rng.nextFloat() < (isElite ? 0.25 : 0.12)) {
      cargoDefId = `cargo.${rng.pick(V2_EXTENDED_RELIC_CARGO_KINDS)}`;
    } else {
      cargoDefId = `cargo.${rng.pick(V2_REGULAR_CARGO_KINDS)}`;
    }
    const cargoOption = createV2CargoInstance({
      instanceId: `${run.runId}_rew_cg_${node.nodeId}`,
      defId: cargoDefId,
      origin: 'loot',
      acquiredDepth: node.layer,
      location: 'staging',
    });

    const bundle: V2CombatRewardBundle = {
      nodeId: node.nodeId,
      equipmentOption,
      cargoOption,
      repairAmount: 10,
      chosen: null,
    };
    return bundle;
  });

  return { bundle: draw.value, nextStreams: draw.nextStreams };
}

export function pickV2CombatReward(
  run: V2RunState,
  choice: 'equipment' | 'cargo' | 'repair',
  unlockedFamilies: readonly V2UnlockFamilyId[]
): V2ActionOutcome {
  if (run.phase !== 'REWARD' || !run.pendingReward || !run.currentNodeId) {
    return { ok: false, run, error: '当前不在战后三选一阶段' };
  }
  const node = run.graph.nodes[run.currentNodeId];
  const claimKey = `reward_${run.pendingReward.nodeId}`;
  if (run.pendingReward.chosen !== null || run.claimedEventIds.includes(claimKey)) {
    return { ok: false, run, error: '本节点奖励已领取' };
  }

  let nextBay = run.bay;
  let nextHp = run.hp;
  let acquiredEq: V2ItemInstance | null = null;

  if (choice === 'equipment') {
    nextBay = addV2ItemToStaging(nextBay, run.pendingReward.equipmentOption, 0);
    acquiredEq = run.pendingReward.equipmentOption;
  } else if (choice === 'cargo') {
    nextBay = addV2ItemToStaging(nextBay, run.pendingReward.cargoOption, 0);
  } else {
    nextHp = Math.min(run.maxHp, run.hp + run.pendingReward.repairAmount);
  }

  const updatedNode: V2MapNode = { ...node, resolved: true };
  let nextRun: V2RunState = {
    ...run,
    hp: nextHp,
    bay: nextBay,
    phase: 'ARRANGE',
    pendingReward: { ...run.pendingReward, chosen: choice },
    claimedEventIds: [...run.claimedEventIds, claimKey],
    graph: {
      ...run.graph,
      nodes: { ...run.graph.nodes, [node.nodeId]: updatedNode },
    },
  };

  if (acquiredEq) {
    nextRun = maybeCreateEngineerSwapOffer(nextRun, acquiredEq, unlockedFamilies);
  }
  nextRun = maybeGrantContractObjectiveItems(nextRun, updatedNode);
  return { ok: true, run: nextRun };
}

/**
 * Finishes ARRANGE phase:
 * - Requires staging to be completely cleared
 * - Expires any unused Engineer swap offer (§6.2)
 * - Clears discard undo stack (caller shows discard confirm modal beforehand if non-empty!)
 * - At terminal layer (Layer 6 or Tutorial Layer 3), automatically transitions to safe-return SETTLEMENT!
 */
export function finishV2ArrangeAndProceed(
  run: V2RunState,
  action: 'map' | 'safe_return'
): V2ActionOutcome {
  if (run.phase !== 'ARRANGE') {
    return { ok: false, run, error: '当前不在船舱整理阶段' };
  }
  if (run.bay.staging.length > 0) {
    return { ok: false, run, error: '暂存区仍有未处理物品，请摆入船舱或舍弃后再离开' };
  }
  const cleanBay = { ...run.bay, discardedThisArrange: [] };
  const expiredOffer = run.activeEngineerOffer
    ? { ...run.activeEngineerOffer, used: true }
    : null;

  if (action === 'safe_return' || isAtTerminalLayer(run)) {
    return {
      ok: true,
      run: {
        ...run,
        bay: cleanBay,
        activeEngineerOffer: expiredOffer,
        phase: 'SETTLEMENT',
        settlementReason: 'safe_return',
      },
    };
  }

  return {
    ok: true,
    run: {
      ...run,
      bay: cleanBay,
      activeEngineerOffer: expiredOffer,
      phase: 'MAP',
    },
  };
}

/**
 * Initiates free safe return from MAP phase (always free via recovery beacon, §5.3!).
 */
export function initiateV2SafeReturnFromMap(run: V2RunState): V2ActionOutcome {
  if (run.phase !== 'MAP' && run.phase !== 'ARRANGE') {
    return { ok: false, run, error: '当前阶段不可直接呼叫安全返航' };
  }
  if (run.bay.staging.length > 0) {
    return { ok: false, run, error: '请先处理暂存区物品后再返航' };
  }
  return {
    ok: true,
    run: {
      ...run,
      bay: { ...run.bay, discardedThisArrange: [] },
      activeEngineerOffer: null,
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
    },
  };
}
