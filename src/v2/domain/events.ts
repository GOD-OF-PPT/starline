import { V2_CREW } from '../data/crew';
import {
  getUnlockedEquipmentKinds,
  type V2EquipmentKind,
  type V2UnlockFamilyId,
} from '../data/equipment';
import { getEventTemplateById, resolveFallbackOptionEffects } from '../data/events';
import {
  canPerformSurveyAtCurrentNode,
  freezeRunBonusObjectiveForSettlement,
  grantContractObjectiveItemsForNode,
} from './contracts';
import { addV2ItemToStaging, detectV2BaySpatialConflict } from './inventoryV2';
import { getAnyV2ItemDef } from './itemCatalog';
import { withV2Stream } from './rngStreams';
import type {
  FactionId,
  V2EngineerSwapOffer,
  V2EventOptionState,
  V2EventState,
  V2ItemInstance,
  V2MapNode,
  V2RunState,
} from './types';

export interface V2EventOptionEvaluation {
  readonly enabled: boolean;
  readonly reason?: string;
}

export interface V2EventResolveResult {
  readonly ok: boolean;
  readonly run: V2RunState;
  readonly error?: string;
  readonly hadDamage?: boolean;
  readonly hadHeal?: boolean;
  readonly gainedItemsCount?: number;
}

/**
 * Returns true when the current node is at the final layer or has no outgoing edges.
 * Returns false when `currentNodeId === null` (e.g., pre-L1 tutorial ARRANGE).
 */
export function isAtTerminalLayer(run: V2RunState): boolean {
  if (!run.currentNodeId) return false;
  const cur = run.graph.nodes[run.currentNodeId];
  if (!cur) return false;
  return cur.layer >= run.graph.maxLayers || cur.nextNodeIds.length === 0;
}

/**
 * Returns true when an unused Engineer Swap offer is active on the run.
 */
export function hasActiveEngineerOffer(run: V2RunState): boolean {
  return Boolean(run.activeEngineerOffer && !run.activeEngineerOffer.used);
}

/**
 * Pure S02 auto-skip predicate: skip empty ARRANGE ONLY when staging is empty,
 * no unused Engineer Swap offer is pending, and no Survey scan can be performed here.
 */
export function shouldAutoSkipArrange(run: V2RunState): boolean {
  return (
    run.bay.staging.length === 0 &&
    !hasActiveEngineerOffer(run) &&
    !canPerformSurveyAtCurrentNode(run).canSurvey
  );
}

/**
 * Unified post-encounter phase transition (S02):
 * MUST be invoked AFTER marking node `resolved: true`, restoring ambush stashed items,
 * creating any Engineer Swap offer, and granting contract objective items!
 */
export function resolvePostEncounterPhase(run: V2RunState): V2RunState {
  if (run.hp <= 0) {
    return freezeRunBonusObjectiveForSettlement(
      {
        ...run,
        hp: 0,
        lockedEnemyId: null,
        phase: 'SETTLEMENT',
        settlementReason: 'defeat',
      },
      'defeat'
    );
  }

  if (!shouldAutoSkipArrange(run)) {
    const conflictCheck = detectV2BaySpatialConflict(run.bay);
    const nextConflictCount =
      (run.spatialConflictCount ?? 0) + (conflictCheck.hasConflict ? 1 : 0);
    return {
      ...run,
      spatialConflictCount: nextConflictCount,
      lockedEnemyId: null,
      phase: 'ARRANGE',
    };
  }

  const nextDiscardedCount =
    (run.discardedCountThisRun ?? 0) + run.bay.discardedThisArrange.length;
  const cleanBay =
    run.bay.discardedThisArrange.length > 0
      ? { ...run.bay, discardedThisArrange: [] }
      : run.bay;

  if (isAtTerminalLayer(run)) {
    return freezeRunBonusObjectiveForSettlement(
      {
        ...run,
        bay: cleanBay,
        discardedCountThisRun: nextDiscardedCount,
        lockedEnemyId: null,
        phase: 'SETTLEMENT',
        settlementReason: 'safe_return',
      },
      'safe_return'
    );
  }

  return {
    ...run,
    bay: cleanBay,
    discardedCountThisRun: nextDiscardedCount,
    lockedEnemyId: null,
    phase: 'MAP',
  };
}

/**
 * Computes updated `stipendSpentCredits` when spending `spent` credits from `run.wallet`
 * using stipend-first accounting (clamped to `[0, startingStipendCredits]`).
 */
export function computeNextStipendSpent(
  run: Pick<V2RunState, 'startingStipendCredits' | 'stipendSpentCredits'>,
  spent: number
): number {
  const startingStipend = Math.max(0, Math.floor(run.startingStipendCredits ?? 0));
  const alreadySpent = Math.min(
    startingStipend,
    Math.max(0, Math.floor(run.stipendSpentCredits ?? 0))
  );
  const unspentStipend = Math.max(0, startingStipend - alreadySpent);
  return alreadySpent + Math.min(unspentStipend, Math.max(0, Math.floor(spent)));
}

/**
 * Generates an Engineer swap offer (3 distinct common candidates from unlocked pool, 4 at Mastery T1+)
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

  const candidateCount = (run.crewMasteryTier ?? 0) >= 1 ? 4 : 3;
  const draw = withV2Stream(run.rngStreams, 'rewards', (rng) => {
    const remaining = [...pool];
    const picked: V2EquipmentKind[] = [];
    while (picked.length < candidateCount && remaining.length > 0) {
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

/**
 * Evaluates affordability, crew requirement, and lethal-HP guard for an event option.
 * `isFallback === true` options are ALWAYS enabled so players can never be softlocked!
 */
export function evaluateV2EventOption(
  run: Pick<V2RunState, 'crewId' | 'fuel' | 'hp' | 'wallet'>,
  option: V2EventOptionState
): V2EventOptionEvaluation {
  if (option.isFallback) {
    return { enabled: true };
  }
  if (option.requiredCrewId && run.crewId !== option.requiredCrewId) {
    const crewName = V2_CREW[option.requiredCrewId]?.name ?? option.requiredCrewId;
    return { enabled: false, reason: `需携带船员「${crewName}」` };
  }
  if (option.fuelCost !== undefined && option.fuelCost > 0 && run.fuel < option.fuelCost) {
    return {
      enabled: false,
      reason: `燃料不足（需 ${option.fuelCost}，当前 ${run.fuel}）`,
    };
  }
  if (option.walletCost !== undefined && option.walletCost > 0 && run.wallet < option.walletCost) {
    return {
      enabled: false,
      reason: `钱包不足（需 ${option.walletCost}¤，当前 ${run.wallet}¤）`,
    };
  }
  // Strict lethal HP guard: never let an event kill the ship!
  if (option.hpCost !== undefined && option.hpCost > 0 && run.hp <= option.hpCost) {
    return {
      enabled: false,
      reason: `船体耐久不足（需 > ${option.hpCost} HP，当前 ${run.hp}）`,
    };
  }
  return { enabled: true };
}

/**
 * Synthesizes a V2EventState from legacy `node.anomaly` / `node.distress` payloads
 * (for older migrated saves that predate F12's `node.eventState`).
 */
export function buildFallbackEventStateFromLegacyNode(
  _run: V2RunState,
  node: V2MapNode
): V2EventState | null {
  const tpl = node.eventId ? getEventTemplateById(node.eventId) : undefined;
  if (node.type === 'anomaly' && node.anomaly) {
    const a = node.anomaly;
    const safeName = getAnyV2ItemDef(a.safeCargoItem.definitionId)?.name ?? '打捞货物';
    const breachVal = a.breachCargoItems.reduce((s, c) => s + c.fixedValue, 0);
    return {
      nodeId: node.nodeId,
      eventId: node.eventId ?? `legacy_anomaly_${node.nodeId}`,
      title: tpl?.title ?? '异常星区信号',
      description:
        tpl?.description ??
        `电离云团中漂浮着稀有 ${a.cargoCategoryLabel} 信号，可选择耗油平稳穿越或顶着电弧硬闯。`,
      resolved: node.resolved,
      chosenIndex: null,
      flavorTag: tpl?.flavorTag ?? '异常事件',
      options: [
        {
          index: 0,
          label: `安全穿越（耗 ${a.safeFuelCost} 燃料）`,
          costSummary: `消耗 ${a.safeFuelCost} 燃料`,
          rewardSummary: `获得 ${safeName}（${a.safeCargoItem.fixedValue}¤）`,
          fuelCost: a.safeFuelCost,
          rewardItems: [a.safeCargoItem],
        },
        {
          index: 1,
          label: `强行破入（扣 ${a.breachHpCost} 耐久）`,
          costSummary: `承受 ${a.breachHpCost} 点船体伤害`,
          rewardSummary: `带走 ${a.breachCargoItems.length} 件货物（共 ${breachVal}¤）`,
          hpCost: a.breachHpCost,
          rewardItems: a.breachCargoItems,
        },
        {
          index: 2,
          label: '标记坐标后安全绕行',
          costSummary: '无消耗',
          rewardSummary: '安全撤离至星际航图',
          isFallback: true,
        },
      ],
    };
  }

  if (node.type === 'distress' && node.distress) {
    const d = node.distress;
    const haulName = getAnyV2ItemDef(d.haulCargoItem.definitionId)?.name ?? '漂流货物';
    return {
      nodeId: node.nodeId,
      eventId: node.eventId ?? `legacy_distress_${node.nodeId}`,
      title: tpl?.title ?? '轨道求救信标',
      description:
        tpl?.description ??
        '收到附近遇险船只的求救频段，可耗油施救换取现场抢修，或回收其漂散货箱。',
      resolved: node.resolved,
      chosenIndex: null,
      flavorTag: tpl?.flavorTag ?? '求救事件',
      options: [
        {
          index: 0,
          label: `救援遇险船员（耗 ${d.rescueFuelCost} 燃料）`,
          costSummary: `消耗 ${d.rescueFuelCost} 燃料`,
          rewardSummary: `立即恢复 +${d.repairAmount} 耐久`,
          fuelCost: d.rescueFuelCost,
          rewardHp: d.repairAmount,
        },
        {
          index: 1,
          label: '打捞漂散货舱（0 燃料）',
          costSummary: '无消耗',
          rewardSummary: `获得 ${haulName}（${d.haulCargoItem.fixedValue}¤）`,
          rewardItems: [d.haulCargoItem],
        },
        {
          index: 2,
          label: '转发求救频段后继续航行',
          costSummary: '无消耗',
          rewardSummary: '零损耗返回航图',
          isFallback: true,
        },
      ],
    };
  }

  return null;
}

/**
 * Resolves a player's chosen option on the active sector event (F12).
 * Supports both live-generated `V2EventState` and minimal seeded E2E `activeEvent` fixtures.
 */
export function resolveV2EventOption(
  run: V2RunState,
  optionIndex: number,
  unlockedFamilies: readonly V2UnlockFamilyId[]
): V2EventResolveResult {
  if (run.phase !== 'ENCOUNTER' || !run.currentNodeId) {
    return { ok: false, run, error: '当前不在星区事件节点内' };
  }
  const node = run.graph.nodes[run.currentNodeId];
  if (!node) {
    return { ok: false, run, error: '当前节点数据缺失' };
  }

  const eventState =
    run.activeEvent && run.activeEvent.nodeId === node.nodeId
      ? run.activeEvent
      : node.eventState ?? buildFallbackEventStateFromLegacyNode(run, node);

  if (!eventState) {
    return { ok: false, run, error: '当前节点没有可处理的星区事件' };
  }
  const claimKey = `event_opt_${node.nodeId}`;
  if (eventState.resolved || node.resolved || run.claimedEventIds.includes(claimKey)) {
    return { ok: false, run, error: '该星区事件已结算' };
  }

  const option =
    eventState.options.find((o) => o.index === optionIndex) ?? eventState.options[optionIndex];
  if (!option) {
    return { ok: false, run, error: '所选事件分支不存在' };
  }

  const evalRes = evaluateV2EventOption(run, option);
  if (!evalRes.enabled) {
    return { ok: false, run, error: evalRes.reason ?? '当前条件不满足该事件选项' };
  }

  const fuelCost = option.isFallback ? 0 : Math.max(0, option.fuelCost ?? 0);
  const hpCost = option.isFallback ? 0 : Math.max(0, option.hpCost ?? 0);
  const walletCost = option.isFallback ? 0 : Math.max(0, option.walletCost ?? 0);

  const effects = resolveFallbackOptionEffects(eventState.eventId, option, run, unlockedFamilies);

  const nextFuel = Math.min(run.maxFuel, Math.max(0, run.fuel - fuelCost + effects.rewardFuel));
  const nextHp =
    run.hp <= 0
      ? 0
      : Math.min(run.maxHp, Math.max(0, run.hp - hpCost + effects.rewardHp));
  const nextWallet = Math.max(0, run.wallet - walletCost + effects.rewardCredits);
  const nextParts = (run.salvagePartsEarned ?? 0) + Math.max(0, effects.rewardParts);

  let nextBay = run.bay;
  const acquiredEquipments: V2ItemInstance[] = [];
  const nextRecentKinds = [...(run.recentEquipmentKinds ?? [])];

  for (const rawItem of effects.rewardItems) {
    const alreadyStaged = nextBay.staging.some((s) => s.item.instanceId === rawItem.instanceId);
    if (!alreadyStaged) {
      nextBay = addV2ItemToStaging(nextBay, { ...rawItem, location: 'staging' }, 0);
      if (rawItem.category === 'equipment') {
        acquiredEquipments.push(rawItem);
        if (node.layer <= 3) {
          const kind = rawItem.definitionId.split('.')[1] as V2EquipmentKind;
          if (kind) nextRecentKinds.push(kind);
        }
      }
    }
  }

  const nextFactionRepEarned: Partial<Record<FactionId, number>> = {
    ...(run.factionRepEarnedThisRun ?? {}),
  };
  if (effects.rewardFactionId && effects.rewardFactionRep > 0) {
    nextFactionRepEarned[effects.rewardFactionId] =
      (nextFactionRepEarned[effects.rewardFactionId] ?? 0) + effects.rewardFactionRep;
  }

  const nextUsedEventIds = run.usedEventIds.includes(eventState.eventId)
    ? [...run.usedEventIds]
    : [...run.usedEventIds, eventState.eventId];

  const resolvedEvent: V2EventState = {
    ...eventState,
    resolved: true,
    chosenIndex: option.index,
  };
  const updatedNode: V2MapNode = {
    ...node,
    resolved: true,
    eventState: resolvedEvent,
  };

  let nextRun: V2RunState = {
    ...run,
    rngStreams: effects.nextStreams,
    fuel: nextFuel,
    hp: nextHp,
    wallet: nextWallet,
    ...(walletCost > 0
      ? { stipendSpentCredits: computeNextStipendSpent(run, walletCost) }
      : {}),
    salvagePartsEarned: nextParts,
    bay: nextBay,
    activeEvent: null,
    claimedEventIds: [...run.claimedEventIds, claimKey],
    usedEventIds: nextUsedEventIds,
    recentEquipmentKinds: nextRecentKinds.slice(-4),
    factionRepEarnedThisRun: nextFactionRepEarned,
    graph: {
      ...run.graph,
      nodes: { ...run.graph.nodes, [node.nodeId]: updatedNode },
    },
  };

  for (const eq of acquiredEquipments) {
    nextRun = maybeCreateEngineerSwapOffer(nextRun, eq, unlockedFamilies);
  }
  nextRun = grantContractObjectiveItemsForNode(nextRun, updatedNode);
  nextRun = resolvePostEncounterPhase(nextRun);

  return {
    ok: true,
    run: nextRun,
    hadDamage: hpCost > 0 || nextHp < run.hp,
    hadHeal: run.hp > 0 && effects.rewardHp > 0,
    gainedItemsCount: effects.rewardItems.length,
  };
}
