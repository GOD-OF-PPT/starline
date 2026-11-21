import {
  BUILDINGS,
  FIRST_EXPEDITION_BONUS_CREDITS,
  RELICS,
  type BuildingId,
} from '../data/buildings';
import { getItemDef } from '../data/items';
import type { ExpeditionState, SettlementReason } from './expedition';
import type { ItemInstance } from './inventory';
import {
  canBuildFacility,
  canRestoreRelic,
  mergeDiscoveries,
  type BaseProgression,
} from './progression';

export interface SettlementLineItem {
  readonly item: ItemInstance;
  readonly name: string;
  readonly isCollectible: boolean;
  readonly keptForCollection: boolean;
  readonly creditsValue: number;
}

export interface SettlementSummary {
  readonly expeditionId: string;
  readonly reason: SettlementReason;
  readonly bountyCredits: number;
  readonly tutorialBonusCredits: number;
  readonly cargoCredits: number;
  readonly equipmentRecycleCredits: number;
  readonly rawRecoverableTotal: number;
  readonly defeatRetentionRate: number;
  readonly finalCreditsEarned: number;
  readonly lineItems: readonly SettlementLineItem[];
  readonly collectibleCandidates: readonly ItemInstance[];
  readonly keptCollectibleIds: readonly string[];
  readonly keptRelicCount: number;
  readonly newlyDiscoveredDefIds: readonly string[];
}

export const DEFEAT_RECOVERY_RATIO = 0.4;

/**
 * Pure calculation of safe-return or defeat settlement.
 * - Borrowed equipment NEVER produces credits.
 * - Staging items NEVER produce credits (must be resolved before safe return; on defeat only placed items count).
 * - On safe return, collectible items marked as kept yield 0 credits and enter base relic storage.
 * - On defeat, player receives floor((bounty + placed scavenged cargo & equipment) * 0.4) and NO physical relic.
 */
export function calculateSettlement(
  expedition: ExpeditionState,
  progression: BaseProgression,
  keptCollectibleInstanceIds: readonly string[] = []
): SettlementSummary {
  const reason: SettlementReason = expedition.settlementReason ?? 'defeat';
  const keptSet = new Set(reason === 'safe_return' ? keptCollectibleInstanceIds : []);

  const lineItems: SettlementLineItem[] = [];
  const collectibleCandidates: ItemInstance[] = [];

  let cargoCredits = 0;
  let equipmentRecycleCredits = 0;
  let keptRelicCount = 0;

  for (const placed of expedition.bay.placed) {
    const item = placed.item;
    if (item.isBorrowed) continue;

    const def = getItemDef(item.defId);
    const isCollectible = def.category === 'cargo' && def.isCollectible;

    if (isCollectible) {
      collectibleCandidates.push(item);
    }

    const kept = reason === 'safe_return' && isCollectible && keptSet.has(item.instanceId);
    const creditsValue = kept ? 0 : item.value;

    if (kept) {
      keptRelicCount += 1;
    } else if (def.category === 'cargo') {
      cargoCredits += creditsValue;
    } else {
      equipmentRecycleCredits += creditsValue;
    }

    lineItems.push({
      item,
      name: def.name,
      isCollectible,
      keptForCollection: kept,
      creditsValue,
    });
  }

  const bountyCredits = expedition.accumulatedBounty;
  const tutorialBonusCredits =
    reason === 'safe_return' && expedition.isTutorial && !progression.tutorialCompleted
      ? FIRST_EXPEDITION_BONUS_CREDITS
      : 0;

  const rawRecoverableTotal = bountyCredits + cargoCredits + equipmentRecycleCredits;

  const finalCreditsEarned =
    reason === 'safe_return'
      ? rawRecoverableTotal + tutorialBonusCredits
      : Math.floor(rawRecoverableTotal * DEFEAT_RECOVERY_RATIO);

  const existingSet = new Set(progression.discoveredItems);
  const newlyDiscoveredDefIds = expedition.discoveredDuringRun.filter((id) => !existingSet.has(id));

  return {
    expeditionId: expedition.expeditionId,
    reason,
    bountyCredits,
    tutorialBonusCredits,
    cargoCredits,
    equipmentRecycleCredits,
    rawRecoverableTotal,
    defeatRetentionRate: reason === 'defeat' ? DEFEAT_RECOVERY_RATIO : 1,
    finalCreditsEarned,
    lineItems,
    collectibleCandidates,
    keptCollectibleIds: Array.from(keptSet),
    keptRelicCount,
    newlyDiscoveredDefIds,
  };
}

/**
 * Idempotently settle an expedition into BaseProgression.
 * Guarded by unique expeditionId so duplicate clicks, reloads, or duplicate events NEVER double-pay.
 */
export function applyExpeditionSettlement(
  progression: BaseProgression,
  expedition: ExpeditionState,
  keptCollectibleInstanceIds: readonly string[] = []
): {
  readonly progression: BaseProgression;
  readonly summary: SettlementSummary;
  readonly alreadySettled: boolean;
} {
  if (expedition.phase !== 'SETTLEMENT') {
    throw new Error(`Cannot settle expedition in phase ${expedition.phase}`);
  }

  const summary = calculateSettlement(expedition, progression, keptCollectibleInstanceIds);

  if (progression.settledExpeditionIds.includes(expedition.expeditionId)) {
    return { progression, summary, alreadySettled: true };
  }

  const prevNav = progression.relics.ancient_navigator ?? { storedCount: 0, restored: false };
  const nextRelics =
    summary.keptRelicCount > 0
      ? {
          ...progression.relics,
          ancient_navigator: {
            ...prevNav,
            storedCount: prevNav.storedCount + summary.keptRelicCount,
          },
        }
      : progression.relics;

  const nextProgression: BaseProgression = {
    ...progression,
    credits: progression.credits + summary.finalCreditsEarned,
    discoveredItems: mergeDiscoveries(progression.discoveredItems, expedition.discoveredDuringRun),
    relics: nextRelics,
    tutorialCompleted: progression.tutorialCompleted || expedition.isTutorial,
    settledExpeditionIds: [...progression.settledExpeditionIds, expedition.expeditionId].slice(-50),
    totalExpeditions: progression.totalExpeditions + 1,
    safeReturns: progression.safeReturns + (summary.reason === 'safe_return' ? 1 : 0),
    deepestNodeReached: Math.max(progression.deepestNodeReached, expedition.completedNodes),
    totalCreditsEarned: progression.totalCreditsEarned + summary.finalCreditsEarned,
  };

  return { progression: nextProgression, summary, alreadySettled: false };
}

export function purchaseBuilding(
  progression: BaseProgression,
  buildingId: BuildingId
): { readonly ok: boolean; readonly progression: BaseProgression; readonly reason?: string } {
  const check = canBuildFacility(progression, buildingId);
  if (!check.canBuild) {
    return { ok: false, progression, reason: check.reason };
  }
  const def = BUILDINGS[buildingId];
  return {
    ok: true,
    progression: {
      ...progression,
      credits: progression.credits - def.cost,
      buildings: {
        ...progression.buildings,
        [buildingId]: true,
      },
      discoveredItems:
        buildingId === 'drydock'
          ? mergeDiscoveries(progression.discoveredItems, ['equipment.shield.common'])
          : progression.discoveredItems,
    },
  };
}

export function restoreRelic(
  progression: BaseProgression,
  relicId: string
): { readonly ok: boolean; readonly progression: BaseProgression; readonly reason?: string } {
  const check = canRestoreRelic(progression, relicId);
  if (!check.canRestore) {
    return { ok: false, progression, reason: check.reason };
  }
  const def = RELICS[relicId];
  const prev = progression.relics[relicId];
  return {
    ok: true,
    progression: {
      ...progression,
      credits: progression.credits - def.restoreCost,
      relics: {
        ...progression.relics,
        [relicId]: {
          storedCount: Math.max(0, prev.storedCount - 1),
          restored: true,
        },
      },
    },
  };
}
