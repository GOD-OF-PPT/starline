import type { RelicProgress } from '../../domain/progression';
import {
  V2_CONTRACT_FAMILY_UNLOCK_ORDER,
  V2_WAREHOUSE_CAPACITY,
  type V2EquipmentKind,
} from '../data/equipment';
import { V2_TUTORIAL_SUCCESS_BONUS } from '../data/facilities';
import { isContractReadyForDelivery } from './contracts';
import { createV2EquipmentInstance, getAnyV2ItemDef } from './itemCatalog';
import type {
  V2ItemInstance,
  V2ProfileState,
  V2RunState,
  V2SettlementDisposition,
  V3RunHistoryEntry,
} from './types';
import { V3_MAX_RUN_HISTORY } from './persistenceV2';

export interface V2SettlementItemLine {
  readonly item: V2ItemInstance;
  readonly name: string;
  readonly allowedDispositions: readonly V2SettlementDisposition[];
  readonly selectedDisposition: V2SettlementDisposition;
  readonly creditsPayout: number;
  readonly relicId?: string;
}

export interface V2SettlementSummary {
  readonly reason: 'safe_return' | 'defeat';
  readonly walletCredits: number;
  readonly contractCompleted: boolean;
  readonly contractRewardCredits: number;
  readonly tutorialBonusCredits: number;
  readonly soldItemsCredits: number;
  /** Defeat 40% recoverable total before 0.4 floor */
  readonly defeatRecoverableBase: number;
  /** Exact final delta added to profile.credits (single source of truth for HUD & receipt, AC13!) */
  readonly finalCreditsEarned: number;
  readonly lines: readonly V2SettlementItemLine[];
  readonly storedToWarehouseItems: readonly V2ItemInstance[];
  readonly keptRelicsById: Record<string, number>;
  readonly warehouseProjectedCount: number;
  readonly warehouseOverflow: boolean;
  readonly lostOwnedCount: number;
  readonly lostLootCount: number;
  readonly discoveredDefIds: readonly string[];
}

export function getDefaultDispositionForItem(
  item: V2ItemInstance,
  reason: 'safe_return' | 'defeat',
  contractCompleted: boolean
): V2SettlementDisposition {
  if (reason === 'defeat') {
    if (item.origin === 'loan') return 'return_loan';
    if (item.origin === 'mission') return 'deliver';
    return 'sell';
  }
  if (item.origin === 'loan') return 'return_loan';
  if (item.origin === 'mission') return contractCompleted ? 'deliver' : 'return_loan';
  if (item.origin === 'owned') return 'store'; // Owned equipment defaults back to warehouse (§10.3)
  return 'sell'; // Loot cargo & loot equipment default to sell
}

export function getAllowedDispositionsForItem(
  item: V2ItemInstance,
  reason: 'safe_return' | 'defeat',
  profile: V2ProfileState,
  contractCompleted: boolean
): readonly V2SettlementDisposition[] {
  if (reason === 'defeat') {
    return [getDefaultDispositionForItem(item, reason, false)];
  }
  if (item.origin === 'loan') return ['return_loan'];
  if (item.origin === 'mission') return [contractCompleted ? 'deliver' : 'return_loan'];

  const def = getAnyV2ItemDef(item.definitionId);
  if (item.category === 'equipment') {
    if (item.origin === 'owned') {
      // Owned base equipment can always return to warehouse or be sold (§10.3)
      return ['store', 'sell'];
    }
    // Loot equipment can be stored in warehouse once Research Lab is built (or sold)
    return profile.buildings.research_lab ? ['sell', 'store'] : ['sell'];
  }

  // Cargo
  if (def?.isCollectible && def.relicId) {
    return ['sell', 'keep_relic'];
  }
  return ['sell'];
}

/**
 * Single authoritative settlement calculator (§10.3, §10.5, AC13, AC14).
 * Enforces strict mutual exclusivity: EVERY item has exactly ONE disposition (deliver / sell / store / keep_relic / return_loan).
 */
export function calculateV2Settlement(
  run: V2RunState,
  profile: V2ProfileState,
  dispositionOverrides: Record<string, V2SettlementDisposition> = {}
): V2SettlementSummary {
  const reason = run.settlementReason ?? (run.hp <= 0 ? 'defeat' : 'safe_return');
  const contractCompleted = isContractReadyForDelivery(run, reason);

  // Only placed items participate in settlement (staging must be empty before combat/return)
  const placedItems = run.bay.placed.map((p) => p.item);
  const discoveredSet = new Set<string>();
  for (const item of placedItems) {
    if (item.origin !== 'mission' || (reason === 'safe_return' && contractCompleted)) {
      discoveredSet.add(item.definitionId);
    }
  }

  if (reason === 'defeat') {
    let nonLoanRecoverable = 0;
    let lostOwnedCount = 0;
    let lostLootCount = 0;
    const lines: V2SettlementItemLine[] = placedItems.map((item) => {
      const def = getAnyV2ItemDef(item.definitionId);
      const disp = getDefaultDispositionForItem(item, 'defeat', false);
      if (item.origin === 'owned') {
        nonLoanRecoverable += item.fixedValue;
        lostOwnedCount += 1;
      } else if (item.origin === 'loot') {
        nonLoanRecoverable += item.fixedValue;
        lostLootCount += 1;
      }
      return {
        item,
        name: def?.name ?? item.definitionId,
        allowedDispositions: [disp],
        selectedDisposition: disp,
        creditsPayout: 0,
        relicId: def?.relicId,
      };
    });

    const defeatRecoverableBase = run.wallet + nonLoanRecoverable;
    const finalCreditsEarned = Math.floor(defeatRecoverableBase * 0.4);

    return {
      reason: 'defeat',
      walletCredits: run.wallet,
      contractCompleted: false,
      contractRewardCredits: 0,
      tutorialBonusCredits: 0,
      soldItemsCredits: 0,
      defeatRecoverableBase,
      finalCreditsEarned,
      lines,
      storedToWarehouseItems: [],
      keptRelicsById: {},
      warehouseProjectedCount: profile.equipmentWarehouse.length,
      warehouseOverflow: false,
      lostOwnedCount,
      lostLootCount,
      discoveredDefIds: Array.from(discoveredSet),
    };
  }

  // Safe Return (§10.3)
  let soldItemsCredits = 0;
  const storedToWarehouseItems: V2ItemInstance[] = [];
  const keptRelicsById: Record<string, number> = {};

  const lines: V2SettlementItemLine[] = placedItems.map((item) => {
    const def = getAnyV2ItemDef(item.definitionId);
    const allowed = getAllowedDispositionsForItem(item, 'safe_return', profile, contractCompleted);
    const requested = dispositionOverrides[item.instanceId];
    const selected =
      requested && allowed.includes(requested)
        ? requested
        : getDefaultDispositionForItem(item, 'safe_return', contractCompleted);

    let creditsPayout = 0;
    if (selected === 'sell') {
      creditsPayout = item.fixedValue;
      soldItemsCredits += creditsPayout;
    } else if (selected === 'store') {
      storedToWarehouseItems.push({ ...item, origin: 'owned', location: 'warehouse' });
    } else if (selected === 'keep_relic' && def?.relicId) {
      keptRelicsById[def.relicId] = (keptRelicsById[def.relicId] ?? 0) + 1;
    }

    return {
      item,
      name: def?.name ?? item.definitionId,
      allowedDispositions: allowed,
      selectedDisposition: selected,
      creditsPayout,
      relicId: def?.relicId,
    };
  });

  // Tutorial success grants fixed +40 once (§12); regular contracts grant template reward once (§4.1)
  const contractRewardCredits =
    contractCompleted && !run.isTutorial ? run.contract.rewardCredits : 0;
  const tutorialBonusCredits =
    run.isTutorial && contractCompleted && !profile.tutorialBonusClaimed
      ? V2_TUTORIAL_SUCCESS_BONUS
      : 0;

  const finalCreditsEarned =
    run.wallet + soldItemsCredits + contractRewardCredits + tutorialBonusCredits;

  const warehouseProjectedCount =
    profile.equipmentWarehouse.length + storedToWarehouseItems.length;
  const warehouseOverflow = warehouseProjectedCount > V2_WAREHOUSE_CAPACITY;

  return {
    reason: 'safe_return',
    walletCredits: run.wallet,
    contractCompleted,
    contractRewardCredits,
    tutorialBonusCredits,
    soldItemsCredits,
    defeatRecoverableBase: 0,
    finalCreditsEarned,
    lines,
    storedToWarehouseItems,
    keptRelicsById,
    warehouseProjectedCount,
    warehouseOverflow,
    lostOwnedCount: 0,
    lostLootCount: 0,
    discoveredDefIds: Array.from(discoveredSet),
  };
}

export interface V2ApplySettlementResult {
  readonly ok: boolean;
  readonly profile: V2ProfileState;
  readonly summary: V2SettlementSummary;
  readonly unlockedFamilyName?: string;
  readonly unlockedCrewName?: string;
  readonly error?: string;
}

/**
 * Atomically applies settlement to V2ProfileState (100% idempotent via settledRunIds, AC13/AC17!).
 * Refuses to settle if warehouseProjectedCount > 12 (never silently drops equipment, §10.4!).
 */
export function applyV2Settlement(
  profile: V2ProfileState,
  run: V2RunState,
  dispositionOverrides: Record<string, V2SettlementDisposition> = {}
): V2ApplySettlementResult {
  const summary = calculateV2Settlement(run, profile, dispositionOverrides);

  // Idempotency guard: already settled this runId -> return untouched!
  if (profile.settledRunIds.includes(run.runId)) {
    return { ok: true, profile, summary };
  }

  if (summary.warehouseOverflow) {
    return {
      ok: false,
      profile,
      summary,
      error: `设备库容量不足（预计 ${summary.warehouseProjectedCount}/${V2_WAREHOUSE_CAPACITY}），请将部分设备改为出售后再确认结算`,
    };
  }

  const nextRelics: Record<string, RelicProgress> = { ...profile.relics };
  for (const [relicId, count] of Object.entries(summary.keptRelicsById)) {
    const prev = nextRelics[relicId] ?? { storedCount: 0, restored: false };
    nextRelics[relicId] = {
      ...prev,
      storedCount: prev.storedCount + count,
    };
  }

  const placedDefIds = run.bay.placed.map((p) => p.item.definitionId);
  const nextDiscovered = Array.from(
    new Set([...profile.discoveredItems, ...summary.discoveredDefIds])
  );
  const nextSeen = Array.from(
    new Set([...profile.seenItems, ...summary.discoveredDefIds, ...placedDefIds])
  );

  // Deepest layer reached during this run
  let maxLayerThisRun = 0;
  for (const nid of run.visitedNodeIds) {
    const layer = run.graph.nodes[nid]?.layer ?? 0;
    if (layer > maxLayerThisRun) maxLayerThisRun = layer;
  }

  // Buildings auto-unlocked on tutorial completion regardless of delivery success (§12)
  const nextBuildings = { ...profile.buildings };
  const nextFacilityTiers: Record<string, number> = { ...profile.facilityTiers };
  if (run.isTutorial) {
    nextBuildings.workbench = true;
    nextBuildings.contract_hub = true;
    nextFacilityTiers.workbench = Math.max(1, nextFacilityTiers.workbench ?? 0);
    nextFacilityTiers.contract_hub = Math.max(1, nextFacilityTiers.contract_hub ?? 0);
  }

  // Contract completion unlocks: crew + ordered equipment families (§6.2 & §10.4)
  const nextCompletedTypes = [...profile.completedContractTypes];
  const nextCompletedIds = [...profile.completedContractIds];
  const nextCrew = [...profile.unlockedCrew];
  const nextFamilies = [...profile.unlockedFamilies];
  const nextBlueprints: V2EquipmentKind[] = [...profile.blueprints];
  const nextGifts: V2ItemInstance[] = [...profile.pendingGiftQueue];

  let unlockedFamilyName: string | undefined;
  let unlockedCrewName: string | undefined;

  if (summary.contractCompleted && !run.isTutorial && run.contract.type !== 'free') {
    if (!nextCompletedIds.includes(run.contract.templateId)) {
      nextCompletedIds.push(run.contract.templateId);
    }

    const cType = run.contract.type;
    // Crew unlocks on first transport / survey contract (§6.2)
    if (cType === 'transport' && !nextCrew.includes('salvager')) {
      nextCrew.push('salvager');
      unlockedCrewName = '打捞师';
    } else if (cType === 'survey' && !nextCrew.includes('navigator')) {
      nextCrew.push('navigator');
      unlockedCrewName = '领航员';
    }

    // First-time completion of each distinct standard contract type unlocks next ordered family (§10.4)
    if (run.contract.tier === 'standard' && !nextCompletedTypes.includes(cType)) {
      nextCompletedTypes.push(cType);
      const nextUnlock = V2_CONTRACT_FAMILY_UNLOCK_ORDER.find(
        (u) => !nextFamilies.includes(u.family)
      );
      if (nextUnlock) {
        nextFamilies.push(nextUnlock.family);
        if (!nextBlueprints.includes(nextUnlock.freeBlueprintKind)) {
          nextBlueprints.push(nextUnlock.freeBlueprintKind);
        }
        const giftItem = createV2EquipmentInstance({
          instanceId: `gift_${nextUnlock.family}_${run.runId}`,
          kind: nextUnlock.giftMainKind,
          quality: 'common',
          origin: 'owned',
          acquiredDepth: 0,
          location: 'gift_queue',
        });
        nextGifts.push(giftItem);
        unlockedFamilyName = nextUnlock.name;
      }
    }
  }

  const salvageEarned = Math.max(0, Math.floor(run.salvagePartsEarned ?? 0));
  const historyEntry: V3RunHistoryEntry = {
    runId: run.runId,
    finishedAt: new Date().toISOString(),
    sectorId: run.sectorId,
    contractTemplateId: run.contract.templateId,
    contractName: run.contract.name,
    shipId: run.shipId,
    crewId: run.crewId,
    outcome: summary.reason,
    contractCompleted: summary.contractCompleted,
    maxLayerReached: maxLayerThisRun,
    creditsEarned: summary.finalCreditsEarned,
    salvagePartsEarned: salvageEarned,
    endlessThreat: run.endlessThreat ?? 0,
    isFinalCampaignRun: run.isFinalCampaignRun,
  };
  const nextRunHistory = [historyEntry, ...profile.runHistory].slice(0, V3_MAX_RUN_HISTORY);
  const nextCareer = {
    ...profile.career,
    totalWins: profile.career.totalWins + (summary.contractCompleted ? 1 : 0),
    totalDefeats: profile.career.totalDefeats + (summary.reason === 'defeat' ? 1 : 0),
    totalSafeReturns: profile.career.totalSafeReturns + (summary.reason === 'safe_return' ? 1 : 0),
    totalCreditsEarned: profile.career.totalCreditsEarned + Math.max(0, summary.finalCreditsEarned),
    totalSalvagePartsEarned: profile.career.totalSalvagePartsEarned + salvageEarned,
  };

  const nextProfile: V2ProfileState = {
    ...profile,
    credits: profile.credits + summary.finalCreditsEarned,
    salvageParts: profile.salvageParts + salvageEarned,
    buildings: nextBuildings,
    facilityTiers: nextFacilityTiers,
    unlockedCrew: nextCrew,
    unlockedFamilies: nextFamilies,
    blueprints: nextBlueprints,
    equipmentWarehouse: [
      ...profile.equipmentWarehouse,
      ...summary.storedToWarehouseItems,
    ],
    pendingGiftQueue: nextGifts,
    relics: nextRelics,
    discoveredItems: nextDiscovered,
    seenItems: nextSeen,
    completedContractTypes: nextCompletedTypes,
    completedContractIds: nextCompletedIds,
    deepestLayerReached: Math.max(profile.deepestLayerReached, maxLayerThisRun),
    totalRuns: profile.totalRuns + 1,
    tutorialCompleted: profile.tutorialCompleted || run.isTutorial,
    tutorialBonusClaimed:
      profile.tutorialBonusClaimed || summary.tutorialBonusCredits > 0,
    settledRunIds: [...profile.settledRunIds, run.runId],
    runHistory: nextRunHistory,
    career: nextCareer,
  };

  return {
    ok: true,
    profile: nextProfile,
    summary,
    unlockedFamilyName,
    unlockedCrewName,
  };
}
