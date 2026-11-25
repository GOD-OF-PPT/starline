import {
  V2_ALL_FORMAL_CONTRACT_TYPES,
  V2_CONTRACT_TEMPLATES,
  V2_CORE_CONTRACT_TYPES,
  type V2ContractTemplate,
} from '../data/contracts';
import { addV2ItemToStaging, removeV2ItemsByOriginAndDef } from './inventoryV2';
import { createV2CargoInstance } from './itemCatalog';
import type {
  V2CargoBayState,
  V2ContractInstance,
  V2MapNode,
  V2ProfileState,
  V2RunState,
  V3RunBonusObjective,
} from './types';

export function isDeepTierUnlocked(profile: V2ProfileState): boolean {
  return profile.completedContractTypes.length >= 1 && profile.deepestLayerReached >= 4;
}

export function getDeepTierLockReason(profile: V2ProfileState): string | null {
  if (isDeepTierUnlocked(profile)) return null;
  const unmet: string[] = [];
  if (profile.completedContractTypes.length < 1) {
    unmet.push('完成任意 1 份标准委托');
  }
  if (profile.deepestLayerReached < 4) {
    unmet.push(`曾抵达第 4 层（当前最深 L${profile.deepestLayerReached}）`);
  }
  return `解锁条件：${unmet.join(' 且 ')}`;
}

export interface V2LockedContractEntry {
  readonly template: V2ContractTemplate;
  readonly locked: boolean;
  readonly lockReason: string | null;
}

/**
 * Returns the V3 contract board:
 * - 5 standard templates (transport / rescue / survey / bounty / derelict)
 * - 3 deep-tier templates with lock status & reason (transport_deep / rescue_deep / survey_deep)
 * - free_salvage template
 */
export function getAvailableContractBoard(profile: V2ProfileState): {
  readonly standardTemplates: readonly V2ContractTemplate[];
  readonly deepTemplates: readonly V2ContractTemplate[];
  readonly deepEntries: readonly V2LockedContractEntry[];
  readonly freeTemplate: V2ContractTemplate;
  readonly deepUnlocked: boolean;
  readonly deepLockReason: string | null;
} {
  const deepUnlocked = isDeepTierUnlocked(profile);
  const deepLockReason = getDeepTierLockReason(profile);
  const standardTemplates = V2_ALL_FORMAL_CONTRACT_TYPES.map(
    (type) => V2_CONTRACT_TEMPLATES[`${type}_std`]
  ).filter((tpl): tpl is V2ContractTemplate => Boolean(tpl));
  const deepTemplates = V2_CORE_CONTRACT_TYPES.map(
    (type) => V2_CONTRACT_TEMPLATES[`${type}_deep`]
  ).filter((tpl): tpl is V2ContractTemplate => Boolean(tpl));
  const deepEntries: V2LockedContractEntry[] = deepTemplates.map((template) => ({
    template,
    locked: !deepUnlocked,
    lockReason: deepLockReason,
  }));
  return {
    standardTemplates,
    deepTemplates,
    deepEntries,
    freeTemplate: V2_CONTRACT_TEMPLATES.free_salvage,
    deepUnlocked,
    deepLockReason,
  };
}

export const V2_RECOMMENDED_STANDARD_ORDER = [
  'rescue_std',
  'survey_std',
  'bounty_std',
  'derelict_std',
  'transport_std',
] as const;

/**
 * Pure post-first-voyage contract recommender (S10):
 * Prioritizes `rescue_std` (distinct Escape Pod +1 fuel/jump tradeoff, unlocked & 0¤-launchable)
 * over `transport_std` (already experienced in the first-voyage tutorial), then advances through
 * remaining uncompleted standard contracts before deep-tier contracts once unlocked.
 */
export function pickRecommendedV2ContractId(
  profile: V2ProfileState,
  board: ReturnType<typeof getAvailableContractBoard> = getAvailableContractBoard(profile)
): string {
  const rankMap = new Map<string, number>(
    V2_RECOMMENDED_STANDARD_ORDER.map((id, idx) => [id, idx])
  );
  const orderedStandard = [...board.standardTemplates].sort((a, b) => {
    const ra = rankMap.get(a.templateId) ?? V2_RECOMMENDED_STANDARD_ORDER.length;
    const rb = rankMap.get(b.templateId) ?? V2_RECOMMENDED_STANDARD_ORDER.length;
    return ra - rb;
  });

  const nextStd = orderedStandard.find(
    (c) => !profile.completedContractIds.includes(c.templateId)
  );
  if (nextStd) return nextStd.templateId;

  if (board.deepUnlocked) {
    const nextDeep = board.deepTemplates.find(
      (c) => !profile.completedContractIds.includes(c.templateId)
    );
    if (nextDeep) return nextDeep.templateId;
    return board.deepTemplates[0]?.templateId ?? 'rescue_std';
  }

  return orderedStandard[0]?.templateId ?? 'rescue_std';
}

interface BonusObjectiveSpec {
  readonly id: string;
  readonly label: string;
}

const BONUS_OBJECTIVE_POOL: readonly BonusObjectiveSpec[] = [
  { id: 'bonus_high_hp', label: '返航时船体耐久 ≥ 60%' },
  { id: 'bonus_no_discard', label: '全程不丢弃任何物资' },
  { id: 'bonus_fuel_reserve', label: '返航时保留至少 3 点燃料' },
  { id: 'bonus_deep_dive', label: '至少推进至目标深层并安全返航' },
];

/**
 * Deterministically generates an Optional Bonus Objective (+30% credits) for formal contracts.
 * Returns undefined for free salvage contracts.
 */
export function generateContractBonusObjective(
  tpl: V2ContractTemplate,
  seed: number
): V3RunBonusObjective | undefined {
  if (tpl.type === 'free' || tpl.rewardCredits <= 0) return undefined;
  const rewardCredits = Math.max(10, Math.round(tpl.rewardCredits * 0.3));
  let hash = (seed >>> 0) ^ 0x9e3779b9;
  for (let i = 0; i < tpl.templateId.length; i++) {
    hash = Math.imul(hash ^ tpl.templateId.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  const picked = BONUS_OBJECTIVE_POOL[hash % BONUS_OBJECTIVE_POOL.length];
  return {
    id: picked.id,
    label: picked.label,
    completed: false,
    rewardCredits,
  };
}

export function previewContractBonusHint(tpl: V2ContractTemplate): {
  readonly label: string;
  readonly rewardCredits: number;
} | null {
  if (tpl.type === 'free' || tpl.rewardCredits <= 0) return null;
  const rewardCredits = Math.max(10, Math.round(tpl.rewardCredits * 0.3));
  const labelByType: Record<string, string> = {
    transport: '返航时船体 ≥ 60% 或全程零舍弃',
    rescue: '保留余油 ≥ 3 或船体 ≥ 60%',
    survey: '全程零舍弃或深层勘测返航',
    bounty: '返航时船体 ≥ 60% 或全程零舍弃',
    derelict: '全程零舍弃或船体 ≥ 60% 返航',
  };
  return {
    label: labelByType[tpl.type] ?? '满足附加战术条件',
    rewardCredits,
  };
}

/**
 * Live evaluator for run bonus objectives (used for Map/Arrange status tracker AND frozen on transition to SETTLEMENT).
 */
export function evaluateRunBonusObjective(
  run: V2RunState,
  reason: 'safe_return' | 'defeat' = 'safe_return'
): boolean {
  const bonus = run.bonusObjective ?? run.contract.bonusObjective;
  if (!bonus) return false;
  if (reason === 'defeat' || run.hp <= 0 || run.emergencyTowUsed === true) return false;

  switch (bonus.id) {
    case 'bonus_high_hp':
    case 'bonus_hp_60':
      return run.hp >= Math.ceil(run.maxHp * 0.6);
    case 'bonus_no_discard':
      return (run.discardedCountThisRun ?? 0) === 0 && run.bay.discardedThisArrange.length === 0;
    case 'bonus_fuel_reserve':
      return run.fuel >= 3;
    case 'bonus_deep_dive': {
      let maxLayer = 0;
      for (const nid of run.visitedNodeIds) {
        const ly = run.graph.nodes[nid]?.layer ?? 0;
        if (ly > maxLayer) maxLayer = ly;
      }
      const targetLayer = run.contract.targetLayer ?? (run.contract.tier === 'deep' ? 5 : 4);
      return maxLayer >= targetLayer;
    }
    default:
      return bonus.completed;
  }
}

/**
 * Evaluates and freezes `bonusObjective.completed` ONLY when transitioning into SETTLEMENT.
 * Preserves seeded SETTLEMENT fixtures by never being called inside calculateV2Settlement!
 */
export function freezeRunBonusObjectiveForSettlement(
  run: V2RunState,
  reason: 'safe_return' | 'defeat'
): V2RunState {
  const bonus = run.bonusObjective ?? run.contract.bonusObjective;
  if (!bonus) return run;
  const completed = evaluateRunBonusObjective(run, reason);
  const frozen: V3RunBonusObjective = { ...bonus, completed };
  return {
    ...run,
    bonusObjective: frozen,
    contract: {
      ...run.contract,
      bonusObjective: frozen,
    },
  };
}

export function createV2ContractInstance(
  templateId: string,
  markedNodeIds: readonly string[],
  runId: string,
  bonusObjective?: V3RunBonusObjective
): V2ContractInstance {
  const tpl = V2_CONTRACT_TEMPLATES[templateId] ?? V2_CONTRACT_TEMPLATES.free_salvage;
  const targetLayer =
    tpl.targetLayers.length > 0 ? tpl.targetLayers[tpl.targetLayers.length - 1] : undefined;
  return {
    contractId: `ct_${runId}_${tpl.templateId}`,
    templateId: tpl.templateId,
    type: tpl.type,
    tier: tpl.tier,
    name: tpl.name,
    rewardCredits: tpl.rewardCredits,
    markedNodeIds: [...markedNodeIds],
    requiredCompletions: tpl.requiredCompletions,
    completedNodeIds: [],
    missionItemDefId: tpl.missionItemDefId,
    missionItemCount: tpl.missionItemCount ?? 0,
    surveyFuelCost: tpl.surveyFuelCost ?? 0,
    ...(tpl.factionId ? { factionId: tpl.factionId } : {}),
    ...(tpl.factionRepReward !== undefined ? { factionRepReward: tpl.factionRepReward } : {}),
    ...(targetLayer !== undefined ? { targetLayer } : {}),
    ...(bonusObjective ? { bonusObjective } : {}),
    status: 'active',
    rewardClaimed: false,
  };
}

/**
 * Grants contract objective items (transport / rescue / derelict) or records bounty target kills.
 * Guaranteed idempotent via `claimedEventIds`.
 */
export function grantContractObjectiveItemsForNode(run: V2RunState, node: V2MapNode): V2RunState {
  if (!node.contractMarker) return run;
  const c = run.contract;
  if (c.status !== 'active') return run;

  if (c.type === 'bounty') {
    if (
      (node.type === 'combat' || node.type === 'elite' || node.type === 'boss') &&
      node.resolved &&
      !c.completedNodeIds.includes(node.nodeId)
    ) {
      return {
        ...run,
        contract: {
          ...c,
          completedNodeIds: [...c.completedNodeIds, node.nodeId],
        },
      };
    }
    return run;
  }

  if (c.type !== 'transport' && c.type !== 'rescue' && c.type !== 'derelict') return run;
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
 * Counts mission escape pods currently held in bay or staging.
 */
export function countEscapePodsInBay(bay: V2CargoBayState): number {
  let count = 0;
  for (const p of bay.placed) {
    if (p.item.definitionId === 'mission.escape_pod' && p.item.origin === 'mission') {
      count += 1;
    }
  }
  for (const s of bay.staging) {
    if (s.item.definitionId === 'mission.escape_pod' && s.item.origin === 'mission') {
      count += 1;
    }
  }
  return count;
}

/**
 * §4.2 & §5.3: Carrying 1 OR 2 escape pods adds a FLAT +1 fuel per new node jump (never +2!).
 */
export function getEscapePodExtraFuelCost(bay: V2CargoBayState): number {
  return countEscapePodsInBay(bay) > 0 ? 1 : 0;
}

/**
 * Computes exact total fuel cost to travel to the next layer node:
 * - Base travel cost = 1 (0 on first jump if Navigator crew is active and unused)
 * - Plus flat +1 if carrying any escape pod(s)
 */
export function computeV2JumpFuelCost(run: V2RunState): {
  readonly baseCost: number;
  readonly rescueSurcharge: number;
  readonly totalCost: number;
  readonly navigatorDiscountApplied: boolean;
} {
  const navigatorDiscountApplied =
    run.crewId === 'navigator' && !run.navigatorFreeJumpUsed;
  const baseCost = navigatorDiscountApplied ? 0 : 1;
  const rescueSurcharge = getEscapePodExtraFuelCost(run.bay);
  return {
    baseCost,
    rescueSurcharge,
    totalCost: baseCost + rescueSurcharge,
    navigatorDiscountApplied,
  };
}

/**
 * Checks whether the run's contract satisfies all delivery conditions upon safe return (§4.2 + F13).
 * Never satisfied on defeat or after explicit abort!
 */
export function isContractReadyForDelivery(
  run: V2RunState,
  reason: 'safe_return' | 'defeat'
): boolean {
  if (reason !== 'safe_return') return false;
  const c = run.contract;
  if (c.type === 'free' || c.status !== 'active' || c.rewardClaimed) return false;
  if (run.hp < 1) return false;

  if (c.type === 'transport') {
    const reactors = run.bay.placed.filter(
      (p) =>
        p.item.definitionId === 'mission.sealed_reactor' &&
        p.item.origin === 'mission' &&
        p.item.missionBinding === c.contractId
    );
    return reactors.length >= c.missionItemCount;
  }

  if (c.type === 'rescue') {
    const pods = run.bay.placed.filter(
      (p) =>
        p.item.definitionId === 'mission.escape_pod' &&
        p.item.origin === 'mission' &&
        p.item.missionBinding === c.contractId
    );
    return pods.length >= c.missionItemCount;
  }

  if (c.type === 'survey' || c.type === 'bounty') {
    return c.completedNodeIds.length >= c.requiredCompletions;
  }

  if (c.type === 'derelict') {
    const boxes = run.bay.placed.filter(
      (p) =>
        p.item.definitionId === 'mission.black_box' &&
        p.item.origin === 'mission' &&
        (!p.item.missionBinding || p.item.missionBinding === c.contractId)
    );
    return boxes.length >= Math.max(1, c.missionItemCount);
  }

  return false;
}

/**
 * Voluntarily aborts the active contract (§4.1 & §4.2):
 * - Marks contract status = 'aborted' (zero penalty to base credits)
 * - Removes bound mission cargo (escape pods transferred cleanly via rescue beacon, reactor/black box released)
 */
export function abortActiveV2Contract(run: V2RunState): V2RunState {
  if (run.contract.type === 'free' || run.contract.status !== 'active') {
    return run;
  }
  let nextBay = run.bay;
  if (run.contract.missionItemDefId) {
    nextBay = removeV2ItemsByOriginAndDef(nextBay, run.contract.missionItemDefId);
  }
  return {
    ...run,
    bay: nextBay,
    contract: {
      ...run.contract,
      status: 'aborted',
    },
  };
}

/**
 * Checks if a survey action can be performed on the current resolved node (§4.2 & AC04).
 */
export function canPerformSurveyAtCurrentNode(run: V2RunState): {
  readonly canSurvey: boolean;
  readonly reason?: string;
} {
  const c = run.contract;
  if (c.type !== 'survey' || c.status !== 'active') {
    return { canSurvey: false, reason: 'no_active_survey' };
  }
  if (!run.currentNodeId) return { canSurvey: false, reason: 'no_current_node' };
  const node = run.graph.nodes[run.currentNodeId];
  if (!node || !node.contractMarker) return { canSurvey: false, reason: 'not_marked' };
  if (!node.resolved) return { canSurvey: false, reason: 'node_not_resolved' };
  if (c.completedNodeIds.includes(run.currentNodeId)) {
    return { canSurvey: false, reason: 'already_surveyed' };
  }
  if (run.fuel < c.surveyFuelCost) {
    return { canSurvey: false, reason: 'insufficient_fuel' };
  }
  return { canSurvey: true };
}

/**
 * Executes a one-time survey scan on a resolved marked node, consuming surveyFuelCost (1 fuel).
 */
export function performSurveyAtCurrentNode(run: V2RunState): {
  readonly ok: boolean;
  readonly run: V2RunState;
  readonly reason?: string;
} {
  const check = canPerformSurveyAtCurrentNode(run);
  if (!check.canSurvey || !run.currentNodeId) {
    return { ok: false, run, reason: check.reason };
  }
  return {
    ok: true,
    run: {
      ...run,
      fuel: run.fuel - run.contract.surveyFuelCost,
      contract: {
        ...run.contract,
        completedNodeIds: [...run.contract.completedNodeIds, run.currentNodeId],
      },
    },
  };
}
