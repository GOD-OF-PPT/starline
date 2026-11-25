import {
  V2_CARGO_DEFS,
  computeV2CargoPrice,
} from '../data/cargo';
import { buildSectorEnemyEncounter, isActBossEncounterKind } from '../data/enemies';
import {
  V2_MAX_POST_WIN_REPAIR,
  getMerchantBuybackPrice,
  getUnlockedEquipmentKinds,
  getV2EquipmentDefByKind,
  type V2EquipmentKind,
  type V2Quality,
  type V2UnlockFamilyId,
} from '../data/equipment';
import { getV3GadgetDef } from '../data/gadgets';
import { getV3SectorDef } from '../data/sectors';
import { V2_SHAPES, type V2ShapeId } from '../data/shapes';
import { calculateV2BuildStats, evaluateV2RewardSynergies } from './buildStatsV2';
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
import {
  addV2ItemToStaging,
  canFitAllV2Shapes,
  composeConflictCargoBundle,
  getV2BayOccupancy,
  pickConflictInducingEquipmentKinds,
  removeV2ItemById,
} from './inventoryV2';
import { createV2CargoInstance, createV2EquipmentInstance, getAnyV2ItemDef } from './itemCatalog';
import { withV2Stream } from './rngStreams';
import type {
  V2CombatPayload,
  V2CombatRewardBundle,
  V2EventState,
  V2ItemInstance,
  V2MapNode,
  V2ProfileState,
  V2RewardChoiceId,
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
  readonly collapsed?: boolean;
  readonly tookHazard?: boolean;
  readonly summaryText?: string;
}

export type V2SafeReturnMode = 'beacon_free' | 'emergency_tow' | 'stranded_tow';

export interface V2SafeReturnStatus {
  readonly mode: V2SafeReturnMode;
  readonly isFreeBeacon: boolean;
  readonly isStranded: boolean;
  readonly canReturnNow: boolean;
  readonly blockedReason?: string;
  /** 0 for beacon_free; 0.35 (-35% tow fee) for emergency_tow / stranded_tow */
  readonly towPenaltyRate: number;
  readonly nextBeaconLayer: number | null;
}

function getUpcomingContractMissionShapes(run: V2RunState, node: V2MapNode): V2ShapeId[] {
  if (
    !node.contractMarker ||
    run.contract.status !== 'active' ||
    !run.contract.missionItemDefId ||
    run.contract.missionItemCount <= 0
  ) {
    return [];
  }
  const def = V2_CARGO_DEFS[run.contract.missionItemDefId];
  if (!def) return [];
  const shapes: V2ShapeId[] = [];
  for (let i = 0; i < run.contract.missionItemCount; i += 1) {
    shapes.push(def.shapeId);
  }
  return shapes;
}

function formatWreckCargoSizeRange(items: readonly V2ItemInstance[]): string {
  const counts = items.map((it) => {
    const def = V2_CARGO_DEFS[it.definitionId];
    return def ? V2_SHAPES[def.shapeId].cells.length : 2;
  });
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const range = min === max ? `${min} 格` : `${min}–${max} 格`;
  return `${items.length} 件（单件 ${range}）`;
}

function formatWreckCargoValueRange(items: readonly V2ItemInstance[]): string {
  const vals = items.map((it) => it.fixedValue);
  const total = vals.reduce((s, v) => s + v, 0);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = min === max ? `${min}¤` : `${min}–${max}¤`;
  return `合计 ${total}¤（${range}）`;
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
  let activeEvent: V2EventState | null = null;
  let updatedTargetNode: V2MapNode = node;
  const shouldCalibrateConflict =
    !run.isTutorial &&
    !run.isShowcase &&
    (run.spatialConflictCount ?? 0) === 0 &&
    run.bay.placed.length > 0 &&
    !node.resolved;
  const sector = getV3SectorDef(run.sectorId);

  if (node.type === 'wreck' && node.wreck) {
    // D06 Hook 1: Dynamically calibrate wreck cargo/armory on node entry (persisted to graph & activeWreck!)
    if (shouldCalibrateConflict && !run.activeWreck) {
      const missionShapes = getUpcomingContractMissionShapes(run, node);
      const relicExisting =
        node.hasRelicSignal && node.relicSignalDefId
          ? node.wreck.cargoItems.filter((c) => c.definitionId === node.relicSignalDefId)
          : [];
      const unlockedKinds = getUnlockedEquipmentKinds(
        options?.profile?.unlockedFamilies ?? ['core']
      );
      const occ = getV2BayOccupancy(run.bay);
      const freeCells = Math.max(0, occ.totalCells - occ.occupiedCells);

      const calibrated = withV2Stream(nextStreams, 'events', (rng) => {
        const cargoBundle = composeConflictCargoBundle({
          shipId: run.bay.shipId,
          placedItems: run.bay.placed,
          extraCommittedShapes: missionShapes,
          existingItems: relicExisting,
          layer: node.layer,
          sectorPriceMult: sector.cargoPriceMult,
          maxItems: 3,
          minItems: 2,
          rng,
          idPrefix: `${run.runId}_d06_wrk_${node.nodeId}`,
        });

        let armoryItem = node.wreck!.armoryItem;
        if (!node.hasSupportGuarantee && freeCells <= 4) {
          const conflictKinds = pickConflictInducingEquipmentKinds(
            run.bay.shipId,
            run.bay.placed,
            missionShapes,
            unlockedKinds
          );
          if (conflictKinds.length > 0) {
            const pickedKind = rng.pick(conflictKinds);
            armoryItem = createV2EquipmentInstance({
              instanceId: `${run.runId}_d06_wrkeq_${node.nodeId}`,
              kind: pickedKind,
              quality: armoryItem.quality,
              origin: 'loot',
              acquiredDepth: node.layer,
              location: 'staging',
            });
          }
        }
        return { cargoItems: cargoBundle.items, armoryItem };
      });

      nextStreams = calibrated.nextStreams;
      const eqDef = getAnyV2ItemDef(calibrated.value.armoryItem.definitionId);
      const eqCells = eqDef ? V2_SHAPES[eqDef.shapeId].cells.length : 2;
      updatedTargetNode = {
        ...node,
        wreck: {
          ...node.wreck,
          armoryItem: calibrated.value.armoryItem,
          cargoItems: calibrated.value.cargoItems,
          armorySizeRange: `${eqCells} 格设备`,
          armoryValueRange: `回收 ${calibrated.value.armoryItem.fixedValue}¤`,
          cargoSizeRange: formatWreckCargoSizeRange(calibrated.value.cargoItems),
          cargoValueRange: formatWreckCargoValueRange(calibrated.value.cargoItems),
        },
      };
    }

    const built = buildActiveWreckStateForNode(
      { ...run, rngStreams: nextStreams },
      updatedTargetNode,
      options?.profile
    );
    activeWreck = built.wreck;
    nextStreams = built.nextStreams;
  } else if (node.type === 'anomaly' || node.type === 'distress') {
    let baseEvent = node.eventState ?? buildFallbackEventStateFromLegacyNode(run, node);

    // D06 Hook 2: Dynamically calibrate cargo-granting event options on L2+ entry (reload-safe!)
    if (shouldCalibrateConflict && !run.activeEvent && node.layer >= 2 && baseEvent) {
      const missionShapes = getUpcomingContractMissionShapes(run, node);
      const calibratedEv = withV2Stream(nextStreams, 'events', (rng) => {
        const nextOptions = baseEvent!.options.map((opt) => {
          const hasCargoReward = Boolean(
            opt.rewardItems &&
              opt.rewardItems.length > 0 &&
              opt.rewardItems.every((it) => it.category === 'cargo')
          );
          const isMarkedRescueGift =
            !hasCargoReward &&
            !opt.isFallback &&
            node.layer >= 3 &&
            node.contractMarker &&
            run.contract.type === 'rescue' &&
            (!opt.rewardItems || opt.rewardItems.length === 0);
          if (!hasCargoReward && !isMarkedRescueGift) return opt;

          const existingRewardItems = opt.rewardItems ?? [];
          const relicExisting =
            node.hasRelicSignal && node.relicSignalDefId
              ? existingRewardItems.filter((it) => it.definitionId === node.relicSignalDefId)
              : [];
          const bundle = composeConflictCargoBundle({
            shipId: run.bay.shipId,
            placedItems: run.bay.placed,
            extraCommittedShapes: missionShapes,
            existingItems: relicExisting,
            layer: node.layer,
            sectorPriceMult: sector.cargoPriceMult,
            maxItems: isMarkedRescueGift
              ? 3
              : Math.max(2, Math.min(3, existingRewardItems.length + 1)),
            minItems: Math.max(1, existingRewardItems.length),
            forceConflict: isMarkedRescueGift,
            rng,
            idPrefix: `${run.runId}_d06_evt_${node.nodeId}_${opt.index}`,
          });
          return {
            ...opt,
            rewardItems: bundle.items,
          };
        });

        let nextAnomaly = node.anomaly;
        if (node.type === 'anomaly' && node.anomaly) {
          const relicExisting =
            node.hasRelicSignal && node.relicSignalDefId
              ? node.anomaly.breachCargoItems.filter((it) => it.definitionId === node.relicSignalDefId)
              : [];
          const breachBundle = composeConflictCargoBundle({
            shipId: run.bay.shipId,
            placedItems: run.bay.placed,
            extraCommittedShapes: missionShapes,
            existingItems: relicExisting,
            layer: node.layer,
            sectorPriceMult: sector.cargoPriceMult,
            maxItems: 3,
            minItems: 2,
            rng,
            idPrefix: `${run.runId}_d06_anom_${node.nodeId}`,
          });
          nextAnomaly = {
            ...node.anomaly,
            breachCargoItems: breachBundle.items,
          };
        }

        let nextDistress = node.distress;
        if (
          node.type === 'distress' &&
          node.distress &&
          !(node.hasRelicSignal && node.distress.haulCargoItem.definitionId === node.relicSignalDefId)
        ) {
          const haulBundle = composeConflictCargoBundle({
            shipId: run.bay.shipId,
            placedItems: run.bay.placed,
            extraCommittedShapes: missionShapes,
            layer: node.layer,
            sectorPriceMult: sector.cargoPriceMult,
            maxItems: 1,
            minItems: 1,
            rng,
            idPrefix: `${run.runId}_d06_dist_${node.nodeId}`,
          });
          if (haulBundle.items[0]) {
            nextDistress = {
              ...node.distress,
              haulCargoItem: haulBundle.items[0],
            };
          }
        }

        return {
          eventState: { ...baseEvent!, options: nextOptions },
          anomaly: nextAnomaly,
          distress: nextDistress,
        };
      });

      nextStreams = calibratedEv.nextStreams;
      baseEvent = calibratedEv.value.eventState;
      updatedTargetNode = {
        ...node,
        ...(calibratedEv.value.anomaly ? { anomaly: calibratedEv.value.anomaly } : {}),
        ...(calibratedEv.value.distress ? { distress: calibratedEv.value.distress } : {}),
        eventState: baseEvent,
      };
    }

    activeEvent = baseEvent;
  }

  const nextDiscardedCount =
    (run.discardedCountThisRun ?? 0) + run.bay.discardedThisArrange.length;
  const cleanBay =
    run.bay.discardedThisArrange.length > 0
      ? { ...run.bay, discardedThisArrange: [] }
      : run.bay;

  const nextGraph =
    updatedTargetNode === node
      ? run.graph
      : {
          ...run.graph,
          nodes: { ...run.graph.nodes, [targetNodeId]: updatedTargetNode },
        };

  return {
    ok: true,
    run: {
      ...run,
      graph: nextGraph,
      rngStreams: nextStreams,
      fuel: run.fuel - fuelCalc.totalCost,
      navigatorFreeJumpUsed: run.navigatorFreeJumpUsed || fuelCalc.navigatorDiscountApplied,
      currentNodeId: targetNodeId,
      visitedNodeIds: [...run.visitedNodeIds, targetNodeId],
      bay: cleanBay,
      discardedCountThisRun: nextDiscardedCount,
      phase: nextPhase,
      activeCombat: null,
      lockedEnemyId: null,
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
  if (node.resolved) {
    return { ok: false, run, error: '该残骸节点已结算' };
  }
  if (run.hp <= 0) {
    return { ok: false, run, error: '船体耐久归零，无法继续切割残骸' };
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
  let nextHp = Math.max(0, run.hp - evalRes.effectiveHullDamage);
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

  const newlyLootedIds: string[] = [];
  for (const rawItem of itemsToStage) {
    const alreadyStaged = nextBay.staging.some((s) => s.item.instanceId === rawItem.instanceId);
    if (!alreadyStaged) {
      const stagedItem: V2ItemInstance = { ...rawItem, location: 'staging' };
      nextBay = addV2ItemToStaging(nextBay, stagedItem, 0);
      newlyLootedIds.push(stagedItem.instanceId);
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
  // D04 restrained healing: Salvager T2 adds +1 HP (5->6) on multi-cut reactor repair
  if (spotId === 'reactor' && ((spot.reactorFuelGain ?? 0) > 0 || (spot.reactorRepairGain ?? 0) > 0)) {
    const salvagerT2 = run.crewId === 'salvager' && (run.crewMasteryTier ?? 0) >= 2;
    const fuelCapGain =
      (spot.reactorFuelGain ?? 0) > 0
        ? Math.min((spot.reactorFuelGain ?? 0) + (salvagerT2 ? 1 : 0), run.maxFuel - nextFuel)
        : 0;
    const repairCapGain =
      (spot.reactorRepairGain ?? 0) > 0
        ? Math.min((spot.reactorRepairGain ?? 0) + (salvagerT2 ? 1 : 0), run.maxHp - nextHp)
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
    summaryParts.push('切割稳定器护航生效（免伤防伏击防坍塌）');
  }

  const nextHotspots = wreck.hotspots.map((h) =>
    h.spotId === spotId ? { ...h, cut: true } : h
  );
  const nextStability = Math.max(0, wreck.stability - evalRes.stabilityCost);
  const nextCutsMade = wreck.cutsMade + 1;
  let summaryText = summaryParts.join(' · ');

  let nextWreckLootIds = Array.from(
    new Set([...(wreck.wreckLootInstanceIds ?? []), ...newlyLootedIds])
  );

  // D05 Deterministic Structural Collapse (Cut #1 & Stabilizer 100% safe!)
  let collapsed = false;
  if (!evalRes.isFirstSafeCut && !stabilizerConsumed) {
    if (nextStability <= 0) {
      collapsed = true;
    } else if (nextStability < 30 && (evalRes.collapseRiskPct ?? 0) > 0) {
      const collapseRoll = withV2Stream(nextStreams, 'events', (rng) =>
        rng.nextFloat() * 100 < (evalRes.collapseRiskPct ?? 0)
      );
      nextStreams = collapseRoll.nextStreams;
      collapsed = collapseRoll.value;
    }
  }

  let nextEngineerOffer = run.activeEngineerOffer;
  if (collapsed) {
    // Forfeit ONLY unextracted staged items from THIS wreck (placed ship gear & mission items stay 100% intact!)
    const forfeitedSet = new Set(nextWreckLootIds);
    const lostCount = nextBay.staging.filter((s) => forfeitedSet.has(s.item.instanceId)).length;
    nextBay = {
      ...nextBay,
      staging: nextBay.staging.filter((s) => !forfeitedSet.has(s.item.instanceId)),
    };
    if (nextEngineerOffer && forfeitedSet.has(nextEngineerOffer.targetInstanceId)) {
      nextEngineerOffer = { ...nextEngineerOffer, used: true };
    }
    // Minor structural shock clamped so hp >= 1 (NEVER violates lethal-cut guard!)
    const shockDamage = nextHp > 1 ? Math.min(3, nextHp - 1) : 0;
    nextHp = Math.max(1, nextHp - shockDamage);
    nextWreckLootIds = [];
    summaryText = `${summaryText} · 残骸结构坍塌！本船暂存物资损失 ${lostCount} 件${
      shockDamage > 0 ? `，受震荡 -${shockDamage} HP` : ''
    }，剩余舱室已封锁。`;
  }

  let ambushTriggered = false;
  let updatedNode: V2MapNode = node;
  let nextWreck: V2WreckState = {
    ...wreck,
    stability: nextStability,
    cutsMade: nextCutsMade,
    hotspots: nextHotspots,
    stabilizerActive: stabilizerConsumed ? false : wreck.stabilizerActive,
    collapsed,
    wreckLootInstanceIds: nextWreckLootIds,
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
    activeEngineerOffer: nextEngineerOffer,
    claimedEventIds: [...run.claimedEventIds, claimKey],
    recentEquipmentKinds: nextRecentKinds.slice(-4),
    tacticalChargesMax: nextChargesMax,
    tacticalChargesUsed: nextChargesUsed,
    ...(ambushTriggered ? { lockedEnemyId: null } : {}),
    graph: {
      ...run.graph,
      nodes: { ...run.graph.nodes, [node.nodeId]: updatedNode },
    },
  };

  if (!collapsed) {
    for (const eq of acquiredEquips) {
      nextRun = maybeCreateEngineerSwapOffer(nextRun, eq, unlockedFamilies);
    }
  }

  return {
    ok: true,
    run: nextRun,
    ambushTriggered,
    collapsed,
    tookHazard: collapsed || evalRes.effectiveHullDamage > 0 || evalRes.effectiveFuelCost > 0,
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
  const claimKey = `wreck_extract_${node.nodeId}`;
  if (node.resolved || run.activeWreck?.extracted || run.claimedEventIds.includes(claimKey)) {
    return { ok: false, run, error: '该残骸节点已结算' };
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
    claimedEventIds: [...run.claimedEventIds, claimKey],
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
    nextHp = run.hp <= 0 ? 0 : run.hp + repairGain;
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
    nextHp = run.hp <= 0 ? 0 : Math.min(run.maxHp, run.hp + node.distress.repairAmount);
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
  const isFreeReturnNode = Boolean(node.isBeacon) || isAtTerminalLayer(run);
  const updatedNode: V2MapNode = { ...node, abandoned: true, resolved: false };
  const nextRun = freezeRunBonusObjectiveForSettlement(
    {
      ...run,
      bay: { ...run.bay, staging: [], discardedThisArrange: [] },
      activeEngineerOffer: null,
      activeWreck: null,
      activeEvent: null,
      lockedEnemyId: null,
      emergencyTowUsed: !isFreeReturnNode,
      returnMode: isFreeReturnNode ? 'beacon_free' : 'emergency_tow',
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
 * Generates deterministic D07 3-equipment synergy-tagged post-combat rewards (repairAmount = 0):
 * - Picks 3 distinct unlocked equipment kinds honoring AC05 `guaranteedSupportKind`, L1-L3 anti-repeat,
 *   live-bay synergy relevance, and D06 spatial conflict sizing.
 * - Preserves guaranteed relics on `hasRelicSignal` nodes (Tutorial L4B `ancient_navigator` & pity signals)
 *   in BOTH `bonusLootItems` AND `cargoOption` mirror.
 * - Attaches D06 conflict-guarantee salvage crates into `bonusLootItems` on L3+ (or L2 marked) when needed.
 */
export function generateV2CombatRewardBundle(
  run: V2RunState,
  node: V2MapNode,
  unlockedFamilies: readonly V2UnlockFamilyId[],
  recentEquipmentKinds: readonly V2EquipmentKind[] = []
): { readonly bundle: V2CombatRewardBundle; readonly nextStreams: V2RngStreams } {
  const combat = node.combat!;
  const unlockedKinds = getUnlockedEquipmentKinds(unlockedFamilies);
  const sector = getV3SectorDef(run.sectorId);
  const isElite = node.type === 'elite' || node.type === 'boss';
  const buildStats = calculateV2BuildStats(run.bay);
  const repairAlreadyCapped = buildStats.rawRepair >= V2_MAX_POST_WIN_REPAIR;
  const shouldCalibrateConflict =
    !run.isTutorial &&
    !run.isShowcase &&
    (run.spatialConflictCount ?? 0) === 0 &&
    run.bay.placed.length > 0;
  const missionShapes = getUpcomingContractMissionShapes(run, node);

  const draw = withV2Stream(run.rngStreams, 'rewards', (rng) => {
    const blockedKind: V2EquipmentKind | null =
      node.layer <= 3 &&
      recentEquipmentKinds.length >= 2 &&
      recentEquipmentKinds[recentEquipmentKinds.length - 1] ===
        recentEquipmentKinds[recentEquipmentKinds.length - 2]
        ? recentEquipmentKinds[recentEquipmentKinds.length - 1]
        : null;

    const pickedKinds: V2EquipmentKind[] = [];
    const conflictKinds = shouldCalibrateConflict
      ? pickConflictInducingEquipmentKinds(
          run.bay.shipId,
          run.bay.placed,
          missionShapes,
          unlockedKinds
        )
      : [];

    const availablePool = (excludeBlocked: boolean): V2EquipmentKind[] => {
      let pool = unlockedKinds.filter((k) => !pickedKinds.includes(k));
      if (excludeBlocked && blockedKind) {
        const filtered = pool.filter((k) => k !== blockedKind);
        if (filtered.length > 0) pool = filtered;
      }
      return pool;
    };

    // Slot 0: honor AC05 guaranteedSupportKind unless suppressed by L1-L3 anti-repeat guard
    if (combat.guaranteedSupportKind && combat.guaranteedSupportKind !== blockedKind) {
      pickedKinds.push(combat.guaranteedSupportKind);
    } else {
      const pool0 = availablePool(true);
      const conflict0 = pool0.filter((k) => conflictKinds.includes(k));
      if (conflict0.length > 0) {
        pickedKinds.push(rng.pick(conflict0));
      } else {
        pickedKinds.push(rng.pick(pool0));
      }
    }

    // Slot 1: prefer a distinct kind with active bay synergy if Slot 0 has none (buildcraft clarity!)
    const slot0HasSynergy = evaluateV2RewardSynergies(
      run.bay,
      getV2EquipmentDefByKind(pickedKinds[0], 'common').defId
    ).hasSynergy;
    const pool1 = availablePool(true);
    if (!slot0HasSynergy) {
      const synCandidates = pool1.filter(
        (k) =>
          evaluateV2RewardSynergies(
            run.bay,
            getV2EquipmentDefByKind(k, 'common').defId
          ).hasSynergy
      );
      if (synCandidates.length > 0) {
        pickedKinds.push(rng.pick(synCandidates));
      } else if (pool1.length > 0) {
        pickedKinds.push(rng.pick(pool1));
      }
    } else if (pool1.length > 0) {
      const conflict1 = pool1.filter((k) => conflictKinds.includes(k));
      pickedKinds.push(conflict1.length > 0 ? rng.pick(conflict1) : rng.pick(pool1));
    }

    // Slot 2: distinct kind (prefer conflict-inducing or larger unlocked shape when D06 active; down-weight redundant repair)
    const pool2Raw = availablePool(true);
    let pool2 = pool2Raw;
    if (repairAlreadyCapped && pool2.length > 1) {
      const noRep = pool2.filter((k) => k !== 'repair');
      if (noRep.length > 0) pool2 = noRep;
    }
    if (pool2.length > 0) {
      const conflict2 = pool2.filter((k) => conflictKinds.includes(k));
      if (conflict2.length > 0) {
        pickedKinds.push(rng.pick(conflict2));
      } else if (shouldCalibrateConflict) {
        const larger = pool2.filter(
          (k) => V2_SHAPES[getV2EquipmentDefByKind(k, 'common').shapeId].cells.length >= 2
        );
        pickedKinds.push(larger.length > 0 ? rng.pick(larger) : rng.pick(pool2));
      } else {
        pickedKinds.push(rng.pick(pool2));
      }
    }

    // Safety backfill if unlocked pool ever has < 3 distinct kinds
    while (pickedKinds.length < 3 && unlockedKinds.length > 0) {
      const rest = availablePool(false);
      pickedKinds.push(rest.length > 0 ? rng.pick(rest) : rng.pick(unlockedKinds));
    }

    // Roll qualities independently per slot; guarantee >= 1 improved on elite/boss when allowImproved
    const qualities: V2Quality[] = pickedKinds.map(() =>
      run.allowImproved && rng.nextFloat() < combat.improvedProb ? 'improved' : 'common'
    );
    if (isElite && run.allowImproved && !qualities.includes('improved') && qualities.length > 0) {
      qualities[0] = 'improved';
    }

    const equipmentOptions: V2ItemInstance[] = pickedKinds.map((kind, idx) =>
      createV2EquipmentInstance({
        instanceId: `${run.runId}_rew_eq_${node.nodeId}_${idx}`,
        kind,
        quality: qualities[idx],
        origin: 'loot',
        acquiredDepth: node.layer,
        location: 'staging',
      })
    );

    const bonusLootItems: V2ItemInstance[] = [];
    let guaranteedRelicItem: V2ItemInstance | null = null;
    if (
      node.hasRelicSignal &&
      node.relicSignalDefId &&
      Object.prototype.hasOwnProperty.call(V2_CARGO_DEFS, node.relicSignalDefId)
    ) {
      const scaledVal =
        sector.cargoPriceMult === 1
          ? undefined
          : Math.max(
              1,
              Math.round(computeV2CargoPrice(node.relicSignalDefId, node.layer) * sector.cargoPriceMult)
            );
      guaranteedRelicItem = createV2CargoInstance({
        instanceId: `${run.runId}_rew_relic_${node.nodeId}`,
        defId: node.relicSignalDefId,
        origin: 'loot',
        acquiredDepth: node.layer,
        location: 'staging',
        fixedValueOverride: scaledVal,
      });
      bonusLootItems.push(guaranteedRelicItem);
    }

    // D06 Hook 3: On L3+ (or L2 on spacious 18-20 cell hulls with >= 9 free cells), if even the
    // smallest offered equipment + mission items still fit without conflict, attach 1-2 salvage crates!
    const occNow = getV2BayOccupancy(run.bay);
    const freeNow = Math.max(0, occNow.totalCells - occNow.occupiedCells);
    if (shouldCalibrateConflict && (node.layer >= 3 || (node.layer === 2 && freeNow >= 9))) {
      const eqShapes = equipmentOptions.map(
        (eq) => getAnyV2ItemDef(eq.definitionId)?.shapeId ?? '1x1'
      );
      const smallestEqShape = eqShapes.reduce((minS, s) =>
        V2_SHAPES[s].cells.length < V2_SHAPES[minS].cells.length ? s : minS
      );
      const placedShapes = run.bay.placed.map(
        (p) => getAnyV2ItemDef(p.item.definitionId)?.shapeId ?? '1x1'
      );
      const bonusShapes = bonusLootItems.map(
        (b) => getAnyV2ItemDef(b.definitionId)?.shapeId ?? '1x1'
      );
      const fitsEvenSmallest = canFitAllV2Shapes(run.bay.shipId, [
        ...placedShapes,
        ...missionShapes,
        ...bonusShapes,
        smallestEqShape,
      ]);
      if (fitsEvenSmallest) {
        const extraSlots = node.layer >= 3 ? 2 : 1;
        const salvage = composeConflictCargoBundle({
          shipId: run.bay.shipId,
          placedItems: run.bay.placed,
          extraCommittedShapes: [...missionShapes, smallestEqShape],
          existingItems: bonusLootItems,
          layer: node.layer,
          sectorPriceMult: sector.cargoPriceMult,
          maxItems: bonusLootItems.length + extraSlots,
          minItems: bonusLootItems.length + 1,
          forceConflict: node.layer >= 3,
          rng,
          idPrefix: `${run.runId}_d06_rewcg_${node.nodeId}`,
        });
        bonusLootItems.splice(0, bonusLootItems.length, ...salvage.items);
      }
    }

    const equipmentOption = equipmentOptions[0];
    // Preserve cargoOption as guaranteed relic mirror (for hasRelicSignal compatibility) or primary bonus/eq fallback
    const cargoOption = guaranteedRelicItem ?? bonusLootItems[0] ?? equipmentOption;

    const bundle: V2CombatRewardBundle = {
      nodeId: node.nodeId,
      equipmentOptions,
      ...(bonusLootItems.length > 0 ? { bonusLootItems } : {}),
      equipmentOption,
      cargoOption,
      repairAmount: 0,
      chosen: null,
    };
    return bundle;
  });

  return { bundle: draw.value, nextStreams: draw.nextStreams };
}

export function pickV2CombatReward(
  run: V2RunState,
  choice: V2RewardChoiceId,
  unlockedFamilies: readonly V2UnlockFamilyId[]
): V2ActionOutcome {
  if (run.phase !== 'REWARD' || !run.pendingReward || !run.currentNodeId) {
    return { ok: false, run, error: '当前不在战后三选一阶段' };
  }
  const node = run.graph.nodes[run.currentNodeId];
  const bundle = run.pendingReward;
  const claimKey = `reward_${bundle.nodeId}`;
  if (bundle.chosen !== null || run.claimedEventIds.includes(claimKey)) {
    return { ok: false, run, error: '本节点奖励已领取' };
  }

  const isModern3Eq = Boolean(bundle.equipmentOptions && bundle.equipmentOptions.length > 0);
  let nextBay = run.bay;
  let nextHp = run.hp;
  let acquiredEq: V2ItemInstance | null = null;
  let nextRecentKinds = [...(run.recentEquipmentKinds ?? [])];

  if (choice === 'equipment_0' || choice === 'equipment_1' || choice === 'equipment_2') {
    const idx = choice === 'equipment_0' ? 0 : choice === 'equipment_1' ? 1 : 2;
    const picked = bundle.equipmentOptions?.[idx] ?? (idx === 0 ? bundle.equipmentOption : undefined);
    if (!picked) {
      return { ok: false, run, error: '目标装备选项不存在' };
    }
    nextBay = addV2ItemToStaging(nextBay, picked, 0);
    acquiredEq = picked;
    for (const bonus of bundle.bonusLootItems ?? []) {
      if (!nextBay.staging.some((s) => s.item.instanceId === bonus.instanceId)) {
        nextBay = addV2ItemToStaging(nextBay, bonus, 0);
      }
    }
    if (node.layer <= 3) {
      const pickedKind = picked.definitionId.split('.')[1] as V2EquipmentKind | undefined;
      if (pickedKind) {
        if (nextRecentKinds.length > 0) {
          nextRecentKinds = [...nextRecentKinds.slice(0, -1), pickedKind];
        } else {
          nextRecentKinds = [pickedKind];
        }
      }
    }
  } else if (choice === 'equipment') {
    const picked = bundle.equipmentOptions?.[0] ?? bundle.equipmentOption;
    nextBay = addV2ItemToStaging(nextBay, picked, 0);
    acquiredEq = picked;
    for (const bonus of bundle.bonusLootItems ?? []) {
      if (!nextBay.staging.some((s) => s.item.instanceId === bonus.instanceId)) {
        nextBay = addV2ItemToStaging(nextBay, bonus, 0);
      }
    }
  } else if (choice === 'skip') {
    // Zero-heal skip: stages 0 equipment and 0 D06 crates, while ALWAYS preserving guaranteed collectible relics!
    for (const bonus of bundle.bonusLootItems ?? []) {
      const def = V2_CARGO_DEFS[bonus.definitionId];
      if (def?.isCollectible && !nextBay.staging.some((s) => s.item.instanceId === bonus.instanceId)) {
        nextBay = addV2ItemToStaging(nextBay, bonus, 0);
      }
    }
  } else if (choice === 'cargo') {
    if (isModern3Eq) {
      return { ok: false, run, error: '当前版本战后奖励已改为三件装备三选一（不含单独货箱选项）' };
    }
    nextBay = addV2ItemToStaging(nextBay, bundle.cargoOption, 0);
  } else if (choice === 'repair') {
    if (isModern3Eq || (bundle.repairAmount ?? 0) <= 0) {
      if (run.isTutorial) {
        // Legacy tutorial compatibility alias: 0 HP healed (strictly zero-heal!) and stages guaranteed relic only
        for (const bonus of bundle.bonusLootItems ?? []) {
          const def = V2_CARGO_DEFS[bonus.definitionId];
          if (def?.isCollectible && !nextBay.staging.some((s) => s.item.instanceId === bonus.instanceId)) {
            nextBay = addV2ItemToStaging(nextBay, bonus, 0);
          }
        }
      } else {
        return { ok: false, run, error: '当前版本战后奖励已取消免费抢修，请选择装备或跳过' };
      }
    } else {
      nextHp = run.hp <= 0 ? 0 : Math.min(run.maxHp, run.hp + bundle.repairAmount);
    }
  } else {
    return { ok: false, run, error: '无效的奖励选项' };
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
    recentEquipmentKinds: nextRecentKinds.slice(-4),
    pendingReward: { ...bundle, chosen: choice },
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
 * Pure D04 3-state Safe Return evaluator (`D2 = b` Beacon-only free return + non-softlock Emergency Tow):
 * - `'beacon_free'` (0% fee): L0 orbital staging, `curNode.isBeacon === true`, or terminal layer.
 * - `'stranded_tow'` (35% fee): non-beacon AND insufficient fuel to jump to any next node (ZERO softlock!).
 * - `'emergency_tow'` (35% fee): non-beacon with fuel remaining (voluntary early bail-out).
 */
export function getV2SafeReturnStatus(run: V2RunState): V2SafeReturnStatus {
  const curNode = run.currentNodeId ? run.graph.nodes[run.currentNodeId] : null;
  const curLayer = curNode?.layer ?? 0;
  const isFreeBeacon =
    run.currentNodeId === null ||
    Boolean(curNode?.isBeacon) ||
    isAtTerminalLayer(run);

  let nextBeaconLayer: number | null = null;
  for (const n of Object.values(run.graph.nodes)) {
    if (n.isBeacon && n.layer > curLayer) {
      if (nextBeaconLayer === null || n.layer < nextBeaconLayer) {
        nextBeaconLayer = n.layer;
      }
    }
  }
  if (nextBeaconLayer === null && curLayer < run.graph.maxLayers) {
    nextBeaconLayer = run.graph.maxLayers;
  }

  const hasStaged = run.bay.staging.length > 0;
  const phaseOk = run.phase === 'MAP' || run.phase === 'ARRANGE';
  const blockedReason = !phaseOk
    ? '当前阶段不可发起返航'
    : hasStaged
    ? `请先处理暂存区 ${run.bay.staging.length} 件物品再返航`
    : undefined;

  if (isFreeBeacon) {
    return {
      mode: 'beacon_free',
      isFreeBeacon: true,
      isStranded: false,
      canReturnNow: phaseOk && !hasStaged,
      ...(blockedReason ? { blockedReason } : {}),
      towPenaltyRate: 0,
      nextBeaconLayer,
    };
  }

  const reachable = getReachableNextNodeIds(run);
  const jumpCost = computeV2JumpFuelCost(run).totalCost;
  const isStranded = reachable.length > 0 && run.fuel < jumpCost;

  return {
    mode: isStranded ? 'stranded_tow' : 'emergency_tow',
    isFreeBeacon: false,
    isStranded,
    canReturnNow: phaseOk && !hasStaged,
    ...(blockedReason ? { blockedReason } : {}),
    towPenaltyRate: 0.35,
    nextBeaconLayer,
  };
}

/**
 * Finishes ARRANGE phase:
 * - Requires staging to be completely cleared
 * - Expires any unused Engineer swap offer (§6.2)
 * - Accumulates discardedCountThisRun and clears discard undo stack
 * - At terminal layer (Layer 6 or Tutorial Layer 4), automatically transitions to free safe-return SETTLEMENT!
 * - Enforces D04 Beacon rule on non-terminal `'safe_return'`.
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

  if (isAtTerminalLayer(run)) {
    const settlementRun = freezeRunBonusObjectiveForSettlement(
      {
        ...run,
        bay: cleanBay,
        discardedCountThisRun: nextDiscardedCount,
        activeEngineerOffer: expiredOffer,
        lockedEnemyId: null,
        emergencyTowUsed: false,
        returnMode: 'beacon_free',
        phase: 'SETTLEMENT',
        settlementReason: 'safe_return',
      },
      'safe_return'
    );
    return { ok: true, run: settlementRun };
  }

  if (action === 'safe_return') {
    const status = getV2SafeReturnStatus(run);
    if (!status.isFreeBeacon) {
      return {
        ok: false,
        run,
        error: '当前不在回收信标节点，无法免费安全返航（请先返回航图前往信标或呼叫紧急拖航）',
      };
    }
    const settlementRun = freezeRunBonusObjectiveForSettlement(
      {
        ...run,
        bay: cleanBay,
        discardedCountThisRun: nextDiscardedCount,
        activeEngineerOffer: expiredOffer,
        lockedEnemyId: null,
        emergencyTowUsed: false,
        returnMode: 'beacon_free',
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
      lockedEnemyId: null,
      phase: 'MAP',
    },
  };
}

/**
 * Initiates safe return from MAP/ARRANGE phase (D04 / D2 = b):
 * - Free at Layer 0, Recovery Beacon nodes (`isBeacon === true`), and terminal layer.
 * - Rejects non-beacon calls unless `options?.allowEmergencyTow === true` (strict domain enforcement!).
 */
export function initiateV2SafeReturnFromMap(
  run: V2RunState,
  options?: { readonly allowEmergencyTow?: boolean }
): V2ActionOutcome {
  if (run.phase !== 'MAP' && run.phase !== 'ARRANGE') {
    return { ok: false, run, error: '当前阶段不可直接呼叫安全返航' };
  }
  if (run.bay.staging.length > 0) {
    return { ok: false, run, error: '请先处理暂存区物品后再返航' };
  }

  const status = getV2SafeReturnStatus(run);
  if (!status.isFreeBeacon && options?.allowEmergencyTow !== true) {
    const hint = status.nextBeaconLayer
      ? `（下一回收信标位于第 ${status.nextBeaconLayer} 层，或呼叫紧急拖航）`
      : '（或呼叫紧急拖航）';
    return {
      ok: false,
      run,
      error: `当前不在回收信标节点，无法免费安全返航${hint}`,
    };
  }

  const emergencyTowUsed = !status.isFreeBeacon;
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
      lockedEnemyId: null,
      emergencyTowUsed,
      returnMode: status.mode,
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
    },
    'safe_return'
  );
  return { ok: true, run: settlementRun };
}

/**
 * Non-softlock Emergency Tow return from any non-beacon node (-35% tow fee, 0 depth appreciation, 0 bonus).
 * Always callable even at 0 fuel and 0 credits!
 */
export function initiateV2EmergencyTowReturn(run: V2RunState): V2ActionOutcome {
  return initiateV2SafeReturnFromMap(run, { allowEmergencyTow: true });
}
