import {
  V2_CONTRACT_TEMPLATES,
  V2_CORE_CONTRACT_TYPES,
  type V2ContractTemplate,
} from '../data/contracts';
import { removeV2ItemsByOriginAndDef } from './inventoryV2';
import type {
  V2CargoBayState,
  V2ContractInstance,
  V2ProfileState,
  V2RunState,
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
 * Returns the V2 contract board: always one template per core type (transport/rescue/survey)
 * plus free salvage, and ALWAYS returns all 3 deep-tier templates with lock status & reason (§4.2).
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
  const standardTemplates = V2_CORE_CONTRACT_TYPES.map(
    (type) => V2_CONTRACT_TEMPLATES[`${type}_std`]
  );
  const deepTemplates = V2_CORE_CONTRACT_TYPES.map(
    (type) => V2_CONTRACT_TEMPLATES[`${type}_deep`]
  );
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

export function createV2ContractInstance(
  templateId: string,
  markedNodeIds: readonly string[],
  runId: string
): V2ContractInstance {
  const tpl = V2_CONTRACT_TEMPLATES[templateId] ?? V2_CONTRACT_TEMPLATES.free_salvage;
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
    status: 'active',
    rewardClaimed: false,
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
 * Checks whether the run's contract satisfies all delivery conditions upon safe return (§4.2).
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

  if (c.type === 'survey') {
    return c.completedNodeIds.length >= c.requiredCompletions;
  }

  return false;
}

/**
 * Voluntarily aborts the active contract (§4.1 & §4.2):
 * - Marks contract status = 'aborted' (zero penalty to base credits)
 * - Removes bound mission cargo (escape pods transferred cleanly via rescue beacon, reactor released)
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
