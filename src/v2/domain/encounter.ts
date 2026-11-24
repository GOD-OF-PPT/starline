import {
  V2_CARGO_DEFS,
  V2_EXTENDED_RELIC_CARGO_KINDS,
  V2_REGULAR_CARGO_KINDS,
  computeV2CargoPrice,
} from '../data/cargo';
import { buildSectorEnemyEncounter, isActBossEncounterKind } from '../data/enemies';
import {
  getMerchantBuybackPrice,
  getUnlockedEquipmentKinds,
  type V2EquipmentKind,
  type V2Quality,
  type V2UnlockFamilyId,
} from '../data/equipment';
import { getV3GadgetDef } from '../data/gadgets';
import { getV3SectorDef } from '../data/sectors';
import { calculateV2BuildStats } from './buildStatsV2';
import {
  computeV2JumpFuelCost,
  freezeRunBonusObjectiveForSettlement,
  grantContractObjectiveItemsForNode,
} from './contracts';
import { buildActiveWreckStateForNode, evaluateWreckHotspotCut } from './dismantle';
import {
  buildFallbackEventStateFromLegacyNode,
  computeNextStipendSpent,
  evaluateV2EventOption,
  hasActiveEngineerOffer,
  isAtTerminalLayer,
  maybeCreateEngineerSwapOffer,
  resolvePostEncounterPhase,
  resolveV2EventOption,
  shouldAutoSkipArrange,
} from './events';
import {
  getEffectiveMerchantEquipmentPrice,
  getEffectiveMerchantServicePrice,
} from './factions';
import { addV2ItemToStaging, removeV2ItemById } from './inventoryV2';
import { createV2CargoInstance, createV2EquipmentInstance } from './itemCatalog';
import { withV2Stream } from './rngStreams';
import type {
  V2CombatPayload,
  V2CombatRewardBundle,
  V2ItemInstance,
  V2MapNode,
  V2ProfileState,
  V2RngStreams,
  V2RunState,
  V2WreckSpotId,
  V2WreckState,
} from './types';

export {
  evaluateV2EventOption,
  hasActiveEngineerOffer,
  isAtTerminalLayer,
  maybeCreateEngineerSwapOffer,
  resolvePostEncounterPhase,
  resolveV2EventOption,
  shouldAutoSkipArrange,
};

export interface V2ActionOutcome {
  readonly ok: boolean;
  readonly run: V2RunState;
  readonly error?: string;
}

export interface V3WreckCutOutcome extends V2ActionOutcome {
  readonly ambushTriggered?: boolean;
  readonly tookHazard?: boolean;
  readonly summaryText?: string;
}

export function getReachableNextNodeIds(run: V2RunState): readonly string[] {
  if (run.currentNodeId === null) {
    return run.graph.startNextNodeIds;
  }
  const cur = run.graph.nodes[run.currentNodeId];
  return cur ? cur.nextNodeIds : [];
}



export function applyV2EngineerSwap(
  run: V2RunState,
  chosenKind: V2EquipmentKind
): V2ActionOutcome {
  const offer = run.activeEngineerOffer;
  if (!offer || offer.used) {
    return { ok: false, run, error: '当前没有可用的林工现场改装机会' };
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

  // Engineer Mastery T2 preserves 'improved' quality on swap; T0/T1 swap to common (§6.2)
  const swappedQuality: V2Quality =
    run.crewId === 'engineer' && (run.crewMasteryTier ?? 0) >= 2 && orig.quality === 'improved'
      ? 'improved'
      : 'common';

  const swapped = createV2EquipmentInstance({
    instanceId: `${orig.instanceId}_eng`,
    kind: chosenKind,
    quality: swappedQuality,
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
 * Spawns mission item(s) (2x3 Sealed Reactor, 1/2 Escape Pods, or 1x2 Black Box) or records Bounty kill
 * when resolving a contract objective node. Guaranteed idempotent via claimedEventIds!
 */
export function maybeGrantContractObjectiveItems(run: V2RunState, node: V2MapNode): V2RunState {
  return grantContractObjectiveItemsForNode(run, node);
}

/**
 * Selects and enters a reachable next-layer map node atomically (deducts fuel once, enters encounter/shop).
 */
export function selectV2MapNode(
  run: V2RunState,
  targetNodeId: string,
  options?: { readonly bonusBossCharges?: number; readonly profile?: V2ProfileState }
): V2ActionOutcome {
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
  const bonusBoss = Math.max(
    0,
    Math.floor(
      options?.bonusBossCharges ??
        (options?.profile?.relics?.obsidian_crown?.restored ? 1 : 0)
    )
  );
  const isBossNode = Boolean(
    node.combat &&
      (node.type === 'boss' ||
        Boolean(node.bossId || node.combat.bossId) ||
        isActBossEncounterKind(node.combat.encounterKind) ||
        (node.type === 'elite' && node.layer >= 6 && !run.isShowcase && !run.isTutorial))
  );
  const nextChargesMax = node.combat ? (isBossNode ? 2 + bonusBoss : 1) : run.tacticalChargesMax;
  const nextChargesUsed = node.combat ? 0 : run.tacticalChargesUsed;

  let nextStreams = run.rngStreams;
  let activeWreck: V2WreckState | null = null;
  let activeEvent = null;

  if (node.type === 'wreck' && node.wreck) {
    const built = buildActiveWreckStateForNode(run, node, options?.profile);
    activeWreck = built.wreck;
    nextStreams = built.nextStreams;
  } else if (node.type === 'anomaly' || node.type === 'distress') {
    activeEvent = node.eventState ?? buildFallbackEventStateFromLegacyNode(run, node);
  }

  const nextDiscardedCount =
    (run.discardedCountThisRun ?? 0) + run.bay.discardedThisArrange.length;
  const cleanBay =
    run.bay.discardedThisArrange.length > 0
      ? { ...run.bay, discardedThisArrange: [] }
      : run.bay;

  return {
    ok: true,
    run: {
      ...run,
      rngStreams: nextStreams,
      fuel: run.fuel - fuelCalc.totalCost,
      navigatorFreeJumpUsed: run.navigatorFreeJumpUsed || fuelCalc.navigatorDiscountApplied,
      currentNodeId: targetNodeId,
      visitedNodeIds: [...run.visitedNodeIds, targetNodeId],
      bay: cleanBay,
      discardedCountThisRun: nextDiscardedCount,
      phase: nextPhase,
      activeCombat: null,
      overchargeCellActive: false,
      pendingReward: null,
      activeEngineerOffer: null,
      activeWreck,
      activeEvent,
      tacticalChargesMax: nextChargesMax,
      tacticalChargesUsed: nextChargesUsed,
    },
  };
}

export interface V3GadgetUseCheck {
  readonly usable: boolean;
  readonly reason?: string;
}

export interface V3GadgetUseOutcome extends V2ActionOutcome {
  readonly message?: string;
  readonly gadgetKind?: string;
}

/**
 * Pure usability guard for consumable 1x1 tactical gadgets placed in the cargo bay.
 */
export function canUseV3GadgetInRun(
  run: V2RunState,
  instanceId: string
): V3GadgetUseCheck {
  const placed = run.bay.placed.find((p) => p.item.instanceId === instanceId);
  if (!placed) {
    return { usable: false, reason: '船舱中未找到该装置（请先安装进货舱）' };
  }
  const def = getV3GadgetDef(placed.item.definitionId);
  if (!def) {
    return { usable: false, reason: '该物品不是可消耗战术装置' };
  }

  if (def.kind === 'repair_kit') {
    if (run.phase !== 'MAP' && run.phase !== 'ARRANGE') {
      return { usable: false, reason: '仅可在星图或船舱整理阶段使用' };
    }
    if (run.hp >= run.maxHp) {
      return { usable: false, reason: '船体耐久已满，无需使用' };
    }
    return { usable: true };
  }

  if (def.kind === 'jump_canister') {
    if (run.phase !== 'MAP' && run.phase !== 'ARRANGE') {
      return { usable: false, reason: '仅可在星图或船舱整理阶段使用' };
    }
    if (run.fuel >= run.maxFuel) {
      return { usable: false, reason: '跃迁燃料已满，无需使用' };
    }
    return { usable: true };
  }

  if (def.kind === 'overcharge_cell') {
    const node = run.currentNodeId ? run.graph.nodes[run.currentNodeId] : undefined;
    if (run.phase !== 'ENCOUNTER' || !node?.combat) {
      return { usable: false, reason: '仅可在战斗节点开战前激活' };
    }
    if (run.activeCombat) {
      return { usable: false, reason: '战斗已经打响，无法再装填过载电池' };
    }
    if (run.overchargeCellActive) {
      return { usable: false, reason: '本场战斗过载电池已充能就绪' };
    }
    return { usable: true };
  }

  // cut_stabilizer
  const node = run.currentNodeId ? run.graph.nodes[run.currentNodeId] : undefined;
  if (run.phase !== 'ENCOUNTER' || !node || node.type !== 'wreck' || node.combat || run.activeCombat) {
    return { usable: false, reason: '仅可在残骸拆解阶段使用' };
  }
  const wreck = run.activeWreck && run.activeWreck.nodeId === node.nodeId ? run.activeWreck : null;
  if (wreck?.extracted) {
    return { usable: false, reason: '残骸已撤离' };
  }
  if (wreck?.ambushTriggered) {
    return { usable: false, reason: '伏击警报已触发，请先应战' };
  }
  if (wreck?.stabilizerActive) {
    return { usable: false, reason: '切割稳定器保护已生效，下一次风险切割免伤' };
  }
  return { usable: true };
}

/**
 * Pure, atomic consumable gadget activation: removes the exact instance from `bay.placed` and applies its effect.
 */
export function useV3GadgetInRun(
  run: V2RunState,
  instanceId: string,
  profile?: V2ProfileState
): V3GadgetUseOutcome {
  const check = canUseV3GadgetInRun(run, instanceId);
  if (!check.usable) {
    return { ok: false, run, error: check.reason ?? '当前无法使用该装置' };
  }
  const placed = run.bay.placed.find((p) => p.item.instanceId === instanceId)!;
  const def = getV3GadgetDef(placed.item.definitionId)!;
  const nextBay = removeV2ItemById(run.bay, instanceId);

  if (def.kind === 'repair_kit') {
    const nextHp = Math.min(run.maxHp, run.hp + 10);
    const gained = nextHp - run.hp;
    return {
      ok: true,
      gadgetKind: def.kind,
      message: `使用应急维修包：船体耐久 +${gained} HP（${nextHp}/${run.maxHp}）`,
      run: { ...run, hp: nextHp, bay: nextBay },
    };
  }

  if (def.kind === 'jump_canister') {
    const nextFuel = Math.min(run.maxFuel, run.fuel + 2);
    const gained = nextFuel - run.fuel;
    return {
      ok: true,
      gadgetKind: def.kind,
      message: `使用跃迁燃料罐：燃料 +${gained}（${nextFuel}/${run.maxFuel}）`,
      run: { ...run, fuel: nextFuel, bay: nextBay },
    };
  }

  if (def.kind === 'overcharge_cell') {
    return {
      ok: true,
      gadgetKind: def.kind,
      message: '过载电池已充能：本战首轮追加 +6 无视护甲爆发与 +4 护盾（已同步至战果预估）',
      run: { ...run, bay: nextBay, overchargeCellActive: true },
    };
  }

  // cut_stabilizer
  const node = run.graph.nodes[run.currentNodeId!]!;
  const built = buildActiveWreckStateForNode(run, node, profile);
  const nextStability = Math.min(built.wreck.maxStability, built.wreck.stability + 35);
  const nextWreck: V2WreckState = {
    ...built.wreck,
    stability: nextStability,
    stabilizerActive: true,
    lastCutSummary: `切割稳定器已启用：结构稳定度恢复至 ${nextStability}/${built.wreck.maxStability}，下一次风险切割免疫船体损伤、燃料消耗与伏击！`,
  };
  return {
    ok: true,
    gadgetKind: def.kind,
    message: `使用切割稳定器：稳定度恢复至 ${nextStability}，下次风险切割免伤防伏击`,
    run: {
      ...run,
      rngStreams: built.nextStreams,
      bay: nextBay,
      activeWreck: nextWreck,
    },
  };
}

/**
 * Multi-cut press-your-luck derelict dissection cut action (F11):
 * - 1st cut is ALWAYS SAFE (0 hull damage, 0 fuel cost, 0 ambush risk)
 * - 2nd/3rd greedy cuts apply disclosed hull/fuel/ambush risks with strict lethal-cut guard
 * - Immediately stages items & awards Salvage Parts / credits; never auto-exits before Extract
 * - On ambush, stashes bay.staging into activeWreck.stashedItems and attaches node.combat cleanly
 */
export function cutV2WreckHotspot(
  run: V2RunState,
  spotId: V2WreckSpotId,
  unlockedFamilies: readonly V2UnlockFamilyId[],
  reactorMode?: 'fuel' | 'repair',
  profile?: V2ProfileState
): V3WreckCutOutcome {
  if (run.phase !== 'ENCOUNTER' || !run.currentNodeId) {
    return { ok: false, run, error: '当前不在残骸拆解节点内' };
  }
  const node = run.graph.nodes[run.currentNodeId];
  if (!node || node.type !== 'wreck') {
    return { ok: false, run, error: '当前节点不是漂流残骸' };
  }
  if (node.combat || run.activeCombat) {
    return { ok: false, run, error: '当前存在敌舰伏击，请先处理战斗' };
  }

  const built = buildActiveWreckStateForNode(run, node, profile);
  const wreck = built.wreck;
  let nextStreams = built.nextStreams;

  const claimKey = `wreck_cut_${node.nodeId}_${spotId}`;
  if (run.claimedEventIds.includes(claimKey)) {
    return { ok: false, run, error: '该残骸舱室已切开' };
  }

  const evalRes = evaluateWreckHotspotCut(run, wreck, spotId);
  if (!evalRes.canCut) {
    return { ok: false, run, error: evalRes.disabledReason ?? '当前无法切割该舱室' };
  }

  const spot = wreck.hotspots.find((h) => h.spotId === spotId)!;
  const grappleBonusParts = calculateV2BuildStats(run.bay).bonusSalvagePartsPerCut;
  const totalSpotParts = Math.max(0, spot.rewardParts ?? 0) + grappleBonusParts;
  let nextHp = Math.max(1, run.hp - evalRes.effectiveHullDamage);
  let nextFuel = Math.max(0, run.fuel - evalRes.effectiveFuelCost);
  let nextWallet = run.wallet + Math.max(0, spot.rewardCredits ?? 0);
  let nextParts = (run.salvagePartsEarned ?? 0) + totalSpotParts;
  let nextBay = run.bay;
  const acquiredEquips: V2ItemInstance[] = [];
  const nextRecentKinds = [...(run.recentEquipmentKinds ?? [])];

  const itemsToStage: V2ItemInstance[] =
    spot.rewardItems && spot.rewardItems.length > 0
      ? [...spot.rewardItems]
      : spot.rewardItem
      ? [spot.rewardItem]
      : [];

  for (const rawItem of itemsToStage) {
    const alreadyStaged = nextBay.staging.some((s) => s.item.instanceId === rawItem.instanceId);
    if (!alreadyStaged) {
      const stagedItem: V2ItemInstance = { ...rawItem, location: 'staging' };
      nextBay = addV2ItemToStaging(nextBay, stagedItem, 0);
      if (stagedItem.category === 'equipment') {
        acquiredEquips.push(stagedItem);
        if (node.layer <= 3) {
          const kind = stagedItem.definitionId.split('.')[1] as V2EquipmentKind;
          if (kind) nextRecentKinds.push(kind);
        }
      }
    }
  }

  const summaryParts: string[] = [`切开${spot.label}`];
  if (itemsToStage.length > 0) {
    summaryParts.push(`回收 ${itemsToStage.length} 件物资入暂存区`);
  }
  if (totalSpotParts > 0) {
    summaryParts.push(
      grappleBonusParts > 0
        ? `+${totalSpotParts} 精密零件（含拆解爪 +${grappleBonusParts}）`
        : `+${totalSpotParts} 精密零件`
    );
  }
  if ((spot.rewardCredits ?? 0) > 0) {
    summaryParts.push(`+${spot.rewardCredits}¤`);
  }

  // Reactor bonus fuel/repair ONLY if hotspot explicitly defines reactorFuelGain / reactorRepairGain
  if (spotId === 'reactor' && ((spot.reactorFuelGain ?? 0) > 0 || (spot.reactorRepairGain ?? 0) > 0)) {
    const salvagerT2 = run.crewId === 'salvager' && (run.crewMasteryTier ?? 0) >= 2;
    const fuelCapGain =
      (spot.reactorFuelGain ?? 0) > 0
        ? Math.min((spot.reactorFuelGain ?? 0) + (salvagerT2 ? 1 : 0), run.maxFuel - nextFuel)
        : 0;
    const repairCapGain =
      (spot.reactorRepairGain ?? 0) > 0
        ? Math.min((spot.reactorRepairGain ?? 0) + (salvagerT2 ? 2 : 0), run.maxHp - nextHp)
        : 0;

    if (reactorMode === 'repair' && repairCapGain > 0) {
      nextHp += repairCapGain;
      summaryParts.push(`应急抢修 +${repairCapGain} HP`);
    } else if (reactorMode === 'fuel' && fuelCapGain > 0) {
      nextFuel += fuelCapGain;
      summaryParts.push(`抽取 +${fuelCapGain} 燃料`);
    } else if (fuelCapGain > 0) {
      nextFuel += fuelCapGain;
      summaryParts.push(`抽取 +${fuelCapGain} 燃料`);
    } else if (repairCapGain > 0) {
      nextHp += repairCapGain;
      summaryParts.push(`应急抢修 +${repairCapGain} HP`);
    }
  }

  if (evalRes.effectiveHullDamage > 0) {
    summaryParts.push(`船体受损 -${evalRes.effectiveHullDamage} HP`);
  }
  if (evalRes.effectiveFuelCost > 0) {
    summaryParts.push(`切割耗油 -${evalRes.effectiveFuelCost}`);
  }

  const stabilizerConsumed = !evalRes.isFirstSafeCut && Boolean(wreck.stabilizerActive);
  if (stabilizerConsumed) {
    summaryParts.push('切割稳定器护航生效（免伤防伏击）');
  }

  const nextHotspots = wreck.hotspots.map((h) =>
    h.spotId === spotId ? { ...h, cut: true } : h
  );
  const nextStability = Math.max(0, wreck.stability - evalRes.stabilityCost);
  const nextCutsMade = wreck.cutsMade + 1;
  let summaryText = summaryParts.join(' · ');

  let ambushTriggered = false;
  let updatedNode: V2MapNode = node;
  let nextWreck: V2WreckState = {
    ...wreck,
    stability: nextStability,
    cutsMade: nextCutsMade,
    hotspots: nextHotspots,
    stabilizerActive: stabilizerConsumed ? false : wreck.stabilizerActive,
    lastCutSummary: summaryText,
  };
  let nextChargesMax = run.tacticalChargesMax;
  let nextChargesUsed = run.tacticalChargesUsed;

  // Ambush handling (ZERO edits to combatV2.ts: stash bay.staging into activeWreck.stashedItems!)
  if (!evalRes.isFirstSafeCut && evalRes.effectiveAmbushRisk) {
    ambushTriggered = true;
    summaryText = `${summaryText} · 警报触发伏击敌舰！已暂封战利品，击败伏击后自动返还。`;
    const stashedItems: V2ItemInstance[] = [
      ...(wreck.stashedItems ?? []),
      ...nextBay.staging.map((s) => s.item),
    ];
    nextBay = { ...nextBay, staging: [] };

    const ambushDraw = withV2Stream(nextStreams, 'enemies', (rng) => {
      const enc = buildSectorEnemyEncounter(
        run.sectorId,
        node.layer,
        'regular',
        rng,
        run.endlessThreat ?? 0,
        {
          nodeId: node.nodeId,
          allowImproved: run.allowImproved,
        }
      );
      const payload: V2CombatPayload = {
        encounterKind: enc.encounterKind,
        units: enc.units,
        bounty: enc.bounty,
        improvedProb: enc.improvedProb,
      };
      return payload;
    });
    nextStreams = ambushDraw.nextStreams;
    updatedNode = { ...node, combat: ambushDraw.value };
    nextWreck = {
      ...nextWreck,
      ambushTriggered: true,
      stashedItems,
      lastCutSummary: summaryText,
    };
    nextChargesMax = 1;
    nextChargesUsed = 0;
  }

  let nextRun: V2RunState = {
    ...run,
    rngStreams: nextStreams,
    hp: nextHp,
    fuel: nextFuel,
    wallet: nextWallet,
    salvagePartsEarned: nextParts,
    bay: nextBay,
    activeWreck: nextWreck,
    claimedEventIds: [...run.claimedEventIds, claimKey],
    recentEquipmentKinds: nextRecentKinds.slice(-4),
    tacticalChargesMax: nextChargesMax,
    tacticalChargesUsed: nextChargesUsed,
    graph: {
      ...run.graph,
      nodes: { ...run.graph.nodes, [node.nodeId]: updatedNode },
    },
  };

  for (const eq of acquiredEquips) {
    nextRun = maybeCreateEngineerSwapOffer(nextRun, eq, unlockedFamilies);
  }

  return {
    ok: true,
    run: nextRun,
    ambushTriggered,
    tookHazard: evalRes.effectiveHullDamage > 0 || evalRes.effectiveFuelCost > 0,
    summaryText,
  };
}

/**
 * Extracts from the current derelict wreck (F11):
 * - Allowed at any time during non-ambushed wreck encounter (even 0 cuts to prevent softlocks)
 * - Grants marked contract objective items (e.g. mission.black_box on derelict_std)
 * - Transitions to ARRANGE if staging has items or survey available; else SETTLEMENT if terminal layer; else MAP!
 */
export function extractV2Wreck(run: V2RunState): V2ActionOutcome {
  if (run.phase !== 'ENCOUNTER' || !run.currentNodeId) {
    return { ok: false, run, error: '当前不在残骸拆解阶段' };
  }
  const node = run.graph.nodes[run.currentNodeId];
  if (!node || node.type !== 'wreck') {
    return { ok: false, run, error: '当前节点不是漂流残骸' };
  }
  if (run.activeWreck?.ambushTriggered || node.combat) {
    return { ok: false, run, error: '敌舰伏击尚未清除，无法直接撤离' };
  }

  const cutsMade = run.activeWreck?.cutsMade ?? 0;
  const updatedNode: V2MapNode = {
    ...node,
    resolved: true,
  };

  let nextRun: V2RunState = {
    ...run,
    activeWreck: null,
    wrecksDissectedThisRun: (run.wrecksDissectedThisRun ?? 0) + (cutsMade > 0 ? 1 : 0),
    graph: {
      ...run.graph,
      nodes: { ...run.graph.nodes, [node.nodeId]: updatedNode },
    },
  };

  nextRun = grantContractObjectiveItemsForNode(nextRun, updatedNode);
  nextRun = resolvePostEncounterPhase(nextRun);

  return { ok: true, run: nextRun };
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
    const salvagerFuelBonus =
      run.crewId === 'salvager' && (run.crewMasteryTier ?? 0) >= 2 ? 1 : 0;
    const fuelGain = Math.min(
      (node.wreck.reactorFuelGain ?? 2) + salvagerFuelBonus,
      run.maxFuel - run.fuel
    );
    if (fuelGain <= 0) {
      return { ok: false, run, error: '燃料已满，可改选应急维修或其他舱室' };
    }
    nextFuel = run.fuel + fuelGain;
  } else {
    const salvagerRepairBonus =
      run.crewId === 'salvager' && (run.crewMasteryTier ?? 0) >= 2 ? 2 : 0;
    const repairGain = Math.min(
      (node.wreck.reactorRepairGain ?? 8) + salvagerRepairBonus,
      run.maxHp - run.hp
    );
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
  nextRun = resolvePostEncounterPhase(nextRun);

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
    claimedEventIds: [...run.claimedEventIds, claimKey],
    graph: {
      ...run.graph,
      nodes: { ...run.graph.nodes, [node.nodeId]: updatedNode },
    },
  };

  nextRun = maybeGrantContractObjectiveItems(nextRun, updatedNode);
  nextRun = resolvePostEncounterPhase(nextRun);
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
    claimedEventIds: [...run.claimedEventIds, claimKey],
    graph: {
      ...run.graph,
      nodes: { ...run.graph.nodes, [node.nodeId]: updatedNode },
    },
  };

  nextRun = maybeGrantContractObjectiveItems(nextRun, updatedNode);
  nextRun = resolvePostEncounterPhase(nextRun);
  return { ok: true, run: nextRun };
}

/**
 * Checks whether ALL options in the current non-combat event are unaffordable (§5.4 + F12).
 */
export function areAllEventOptionsUnaffordable(run: V2RunState): boolean {
  if (run.phase !== 'ENCOUNTER' || !run.currentNodeId) return false;
  if (run.activeEvent && run.activeEvent.nodeId === run.currentNodeId) {
    return run.activeEvent.options.every((opt) => !evaluateV2EventOption(run, opt).enabled);
  }
  const node = run.graph.nodes[run.currentNodeId];
  if (!node) return false;
  if (node.eventState) {
    return node.eventState.options.every((opt) => !evaluateV2EventOption(run, opt).enabled);
  }
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
  if (
    !node ||
    node.type === 'combat' ||
    node.type === 'elite' ||
    node.type === 'boss' ||
    Boolean(node.combat) ||
    Boolean(run.activeCombat) ||
    Boolean(run.activeWreck?.ambushTriggered)
  ) {
    return { ok: false, run, error: '战斗节点或残骸伏击战斗不可按非战斗事件放弃' };
  }
  const updatedNode: V2MapNode = { ...node, abandoned: true, resolved: false };
  const nextRun = freezeRunBonusObjectiveForSettlement(
    {
      ...run,
      activeWreck: null,
      activeEvent: null,
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
      graph: {
        ...run.graph,
        nodes: { ...run.graph.nodes, [node.nodeId]: updatedNode },
      },
    },
    'safe_return'
  );
  return { ok: true, run: nextRun };
}

// --- Merchant Transactions (idempotent via transactionIds, AC06 + F13 Starport Guild Discount) ---

export function buyV2MerchantOffer(
  run: V2RunState,
  offerId: string,
  transactionId: string,
  unlockedFamilies: readonly V2UnlockFamilyId[],
  starportGuildRep = 0
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

  const effectivePrice = getEffectiveMerchantEquipmentPrice(
    offer.buyPrice,
    offer.item.fixedValue,
    starportGuildRep
  );
  if (run.wallet < effectivePrice) {
    return { ok: false, run, error: `航行钱包不足（需要 ${effectivePrice}¤，当前 ${run.wallet}¤）` };
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
    wallet: run.wallet - effectivePrice,
    ...(effectivePrice > 0
      ? { stipendSpentCredits: computeNextStipendSpent(run, effectivePrice) }
      : {}),
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

export function buyV2MerchantFuel(
  run: V2RunState,
  transactionId: string,
  starportGuildRep = 0
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
  if (node.merchant.fuelBought) {
    return { ok: false, run, error: '本节点燃料补给限购 1 次' };
  }
  const actualGain = Math.min(node.merchant.fuelAmount, run.maxFuel - run.fuel);
  if (actualGain <= 0) {
    return { ok: false, run, error: '燃料已达上限（禁止无收益购买）' };
  }
  const effectivePrice = getEffectiveMerchantServicePrice(
    node.merchant.fuelPrice,
    starportGuildRep
  );
  if (run.wallet < effectivePrice) {
    return { ok: false, run, error: `航行钱包不足（需要 ${effectivePrice}¤）` };
  }
  const updatedNode: V2MapNode = {
    ...node,
    merchant: { ...node.merchant, fuelBought: true },
  };
  return {
    ok: true,
    run: {
      ...run,
      wallet: run.wallet - effectivePrice,
      ...(effectivePrice > 0
        ? { stipendSpentCredits: computeNextStipendSpent(run, effectivePrice) }
        : {}),
      fuel: run.fuel + actualGain,
      transactionIds: [...run.transactionIds, transactionId],
      graph: {
        ...run.graph,
        nodes: { ...run.graph.nodes, [node.nodeId]: updatedNode },
      },
    },
  };
}

export function buyV2MerchantRepair(
  run: V2RunState,
  transactionId: string,
  starportGuildRep = 0
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
  if (node.merchant.repairBought) {
    return { ok: false, run, error: '本节点维修服务限购 1 次' };
  }
  const actualGain = Math.min(node.merchant.repairAmount, run.maxHp - run.hp);
  if (actualGain <= 0) {
    return { ok: false, run, error: '船体耐久已满（禁止无收益购买）' };
  }
  const effectivePrice = getEffectiveMerchantServicePrice(
    node.merchant.repairPrice,
    starportGuildRep
  );
  if (run.wallet < effectivePrice) {
    return { ok: false, run, error: `航行钱包不足（需要 ${effectivePrice}¤）` };
  }
  const updatedNode: V2MapNode = {
    ...node,
    merchant: { ...node.merchant, repairBought: true },
  };
  return {
    ok: true,
    run: {
      ...run,
      wallet: run.wallet - effectivePrice,
      ...(effectivePrice > 0
        ? { stipendSpentCredits: computeNextStipendSpent(run, effectivePrice) }
        : {}),
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

  const nextEngineerOffer =
    run.activeEngineerOffer &&
    !run.activeEngineerOffer.used &&
    run.activeEngineerOffer.targetInstanceId === instanceId
      ? { ...run.activeEngineerOffer, used: true }
      : run.activeEngineerOffer;

  return {
    ok: true,
    run: {
      ...run,
      wallet: run.wallet + payout,
      bay: removeV2ItemById(run.bay, instanceId),
      activeEngineerOffer: nextEngineerOffer,
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
    graph: {
      ...run.graph,
      nodes: { ...run.graph.nodes, [node.nodeId]: updatedNode },
    },
  };
  nextRun = maybeGrantContractObjectiveItems(nextRun, updatedNode);
  nextRun = resolvePostEncounterPhase(nextRun);
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

    const sector = getV3SectorDef(run.sectorId);
    const isElite = node.type === 'elite' || node.type === 'boss';
    let cargoDefId: string;
    if (
      node.hasRelicSignal &&
      node.relicSignalDefId &&
      Object.prototype.hasOwnProperty.call(V2_CARGO_DEFS, node.relicSignalDefId)
    ) {
      cargoDefId = node.relicSignalDefId;
    } else if (
      node.layer >= 4 &&
      rng.nextFloat() < (isElite ? Math.max(0.25, sector.relicDropChanceDeep + 0.13) : sector.relicDropChanceDeep)
    ) {
      if (sector.signatureRelicIds.length > 0 && rng.nextFloat() < 0.7) {
        const sigDefId = `cargo.${rng.pick(sector.signatureRelicIds)}`;
        cargoDefId = Object.prototype.hasOwnProperty.call(V2_CARGO_DEFS, sigDefId)
          ? sigDefId
          : `cargo.${rng.pick(V2_EXTENDED_RELIC_CARGO_KINDS)}`;
      } else {
        cargoDefId = `cargo.${rng.pick(V2_EXTENDED_RELIC_CARGO_KINDS)}`;
      }
    } else {
      cargoDefId = `cargo.${rng.pick(V2_REGULAR_CARGO_KINDS)}`;
    }
    const scaledCargoVal =
      sector.cargoPriceMult === 1
        ? undefined
        : Math.max(1, Math.round(computeV2CargoPrice(cargoDefId, node.layer) * sector.cargoPriceMult));
    const cargoOption = createV2CargoInstance({
      instanceId: `${run.runId}_rew_cg_${node.nodeId}`,
      defId: cargoDefId,
      origin: 'loot',
      acquiredDepth: node.layer,
      location: 'staging',
      fixedValueOverride: scaledCargoVal,
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

  // Restore any loot stashed during a wreck ambush encounter back into staging!
  let nextActiveWreck = run.activeWreck ?? null;
  let nextWrecksDissected = run.wrecksDissectedThisRun ?? 0;
  if (run.activeWreck?.ambushTriggered) {
    for (const stashed of run.activeWreck.stashedItems ?? []) {
      const exists = nextBay.staging.some((s) => s.item.instanceId === stashed.instanceId);
      if (!exists) {
        nextBay = addV2ItemToStaging(nextBay, { ...stashed, location: 'staging' }, 0);
      }
    }
    nextActiveWreck = null;
    nextWrecksDissected += 1;
  }

  const updatedNode: V2MapNode = { ...node, resolved: true };
  let nextRun: V2RunState = {
    ...run,
    hp: nextHp,
    bay: nextBay,
    activeWreck: nextActiveWreck,
    wrecksDissectedThisRun: nextWrecksDissected,
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
  nextRun = resolvePostEncounterPhase(nextRun);
  return { ok: true, run: nextRun };
}

/**
 * Finishes ARRANGE phase:
 * - Requires staging to be completely cleared
 * - Expires any unused Engineer swap offer (§6.2)
 * - Accumulates discardedCountThisRun and clears discard undo stack
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
  const nextDiscardedCount =
    (run.discardedCountThisRun ?? 0) + run.bay.discardedThisArrange.length;
  const cleanBay = { ...run.bay, discardedThisArrange: [] };
  const expiredOffer = run.activeEngineerOffer
    ? { ...run.activeEngineerOffer, used: true }
    : null;

  if (action === 'safe_return' || isAtTerminalLayer(run)) {
    const settlementRun = freezeRunBonusObjectiveForSettlement(
      {
        ...run,
        bay: cleanBay,
        discardedCountThisRun: nextDiscardedCount,
        activeEngineerOffer: expiredOffer,
        phase: 'SETTLEMENT',
        settlementReason: 'safe_return',
      },
      'safe_return'
    );
    return { ok: true, run: settlementRun };
  }

  return {
    ok: true,
    run: {
      ...run,
      bay: cleanBay,
      discardedCountThisRun: nextDiscardedCount,
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
  const nextDiscardedCount =
    (run.discardedCountThisRun ?? 0) + run.bay.discardedThisArrange.length;
  const settlementRun = freezeRunBonusObjectiveForSettlement(
    {
      ...run,
      bay: { ...run.bay, discardedThisArrange: [] },
      discardedCountThisRun: nextDiscardedCount,
      activeEngineerOffer: null,
      activeWreck: null,
      activeEvent: null,
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
    },
    'safe_return'
  );
  return { ok: true, run: settlementRun };
}
