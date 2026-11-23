import type { RelicProgress } from '../../domain/progression';
import { V2_CONTRACT_TEMPLATES } from '../data/contracts';
import { V2_CREW, type V2CrewId } from '../data/crew';
import {
  V2_CONTRACT_FAMILY_UNLOCK_ORDER,
  type V2EquipmentKind,
} from '../data/equipment';
import { V2_TUTORIAL_SUCCESS_BONUS } from '../data/facilities';
import { advanceCampaignAfterRun } from './campaign';
import { isContractReadyForDelivery } from './contracts';
import { canDismantleV2Item, getDismantleSalvagePartsYield } from './dismantle';
import {
  addFactionRep,
  getGuildContractBonusCredits,
  getSurveyInstituteBonusParts,
} from './factions';
import { createV2EquipmentInstance, getAnyV2ItemDef } from './itemCatalog';
import { V3_MAX_RUN_HISTORY } from './persistenceV2';
import { getEffectiveWarehouseCapacity, getFacilityTier } from './progressionV2';
import type {
  CampaignActId,
  FactionId,
  SectorId,
  V2ItemInstance,
  V2ProfileState,
  V2RunState,
  V2SettlementDisposition,
  V3RunBonusObjective,
  V3RunHistoryEntry,
} from './types';

export interface V2SettlementItemLine {
  readonly item: V2ItemInstance;
  readonly name: string;
  readonly allowedDispositions: readonly V2SettlementDisposition[];
  readonly selectedDisposition: V2SettlementDisposition;
  readonly creditsPayout: number;
  readonly partsPayout?: number;
  readonly relicId?: string;
}

export interface V2SettlementSummary {
  readonly reason: 'safe_return' | 'defeat';
  readonly walletCredits: number;
  readonly contractCompleted: boolean;
  readonly contractRewardCredits: number;
  readonly tutorialBonusCredits: number;
  readonly soldItemsCredits: number;
  /** Optional Salvager Mastery T1+ cargo appraisal bonus credits (0 at Tier 0) */
  readonly crewMasteryBonusCredits?: number;
  /** Optional Bonus Objective state & credits paid (F13) */
  readonly bonusObjective?: V3RunBonusObjective | null;
  readonly bonusObjectiveCredits: number;
  /** Starport Guild Lv3 +10% guild contract bonus credits (0 at Lv1/Lv2) */
  readonly factionContractBonusCredits?: number;
  /** Salvage Parts earned from wreck dissection & expedition events/perks */
  readonly runSalvagePartsEarned: number;
  /** Salvage Parts earned from items dismantled at Settlement */
  readonly dismantledPartsEarned: number;
  /** Total Salvage Parts credited to profile on settlement confirmation */
  readonly totalSalvagePartsEarned: number;
  readonly dismantledItemsCount: number;
  /** Faction reputation deltas credited on settlement confirmation */
  readonly factionRepGains?: Partial<Record<FactionId, number>>;
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
  contractCompleted: boolean,
  profile?: V2ProfileState
): V2SettlementDisposition {
  if (reason === 'defeat') {
    if (item.origin === 'loan') return 'return_loan';
    if (item.origin === 'mission') return 'deliver';
    return 'sell';
  }
  if (item.origin === 'loan') return 'return_loan';
  if (item.origin === 'mission') return contractCompleted ? 'deliver' : 'return_loan';
  if (item.origin === 'owned') return 'store'; // Owned equipment defaults back to warehouse (§10.3)
  if (item.category === 'cargo' && profile?.buildings.display) {
    const def = getAnyV2ItemDef(item.definitionId);
    if (def?.isCollectible && def.relicId) {
      const relicProgress = profile.relics[def.relicId];
      if (!relicProgress?.restored && (relicProgress?.storedCount ?? 0) === 0) {
        return 'keep_relic';
      }
    }
  }
  return 'sell'; // Loot cargo & loot equipment default to sell (NEVER 'dismantle'!)
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
  if (item.origin === 'mission' || item.category === 'mission') {
    return [contractCompleted ? 'deliver' : 'return_loan'];
  }

  const def = getAnyV2ItemDef(item.definitionId);
  const canDismantle = canDismantleV2Item(item).ok;

  if (item.category === 'equipment' || item.category === 'gadget') {
    if (item.origin === 'owned') {
      return canDismantle ? ['store', 'sell', 'dismantle'] : ['store', 'sell'];
    }
    if (profile.buildings.research_lab) {
      return canDismantle ? ['sell', 'store', 'dismantle'] : ['sell', 'store'];
    }
    return canDismantle ? ['sell', 'dismantle'] : ['sell'];
  }

  // Cargo
  if (def?.isCollectible && def.relicId) {
    return ['sell', 'keep_relic'];
  }
  return canDismantle ? ['sell', 'dismantle'] : ['sell'];
}

/**
 * Single authoritative settlement calculator (§10.3, §10.5, AC13, AC14, F11, F13).
 * Enforces strict mutual exclusivity: EVERY item has exactly ONE disposition
 * (deliver / sell / store / dismantle / keep_relic / return_loan).
 */
export function calculateV2Settlement(
  run: V2RunState,
  profile: V2ProfileState,
  dispositionOverrides: Record<string, V2SettlementDisposition> = {}
): V2SettlementSummary {
  const reason = run.settlementReason ?? (run.hp <= 0 ? 'defeat' : 'safe_return');
  const contractCompleted = isContractReadyForDelivery(run, reason);
  const activeBonus = run.bonusObjective ?? run.contract.bonusObjective ?? null;

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
        partsPayout: 0,
        relicId: def?.relicId,
      };
    });

    const defeatRecoverableBase = run.wallet + nonLoanRecoverable;
    const finalCreditsEarned = Math.floor(defeatRecoverableBase * 0.4);
    const runSalvagePartsEarned = Math.floor(Math.max(0, Math.floor(run.salvagePartsEarned ?? 0)) * 0.4);

    return {
      reason: 'defeat',
      walletCredits: run.wallet,
      contractCompleted: false,
      contractRewardCredits: 0,
      tutorialBonusCredits: 0,
      soldItemsCredits: 0,
      bonusObjective: activeBonus ? { ...activeBonus, completed: false } : null,
      bonusObjectiveCredits: 0,
      factionContractBonusCredits: 0,
      runSalvagePartsEarned,
      dismantledPartsEarned: 0,
      totalSalvagePartsEarned: runSalvagePartsEarned,
      dismantledItemsCount: 0,
      factionRepGains: {},
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

  // Safe Return (§10.3 + F11 + F13)
  let soldItemsCredits = 0;
  let soldLootCargoCredits = 0;
  let dismantledPartsEarned = 0;
  let dismantledItemsCount = 0;
  const storedToWarehouseItems: V2ItemInstance[] = [];
  const keptRelicsById: Record<string, number> = {};

  const lines: V2SettlementItemLine[] = placedItems.map((item) => {
    const def = getAnyV2ItemDef(item.definitionId);
    const allowed = getAllowedDispositionsForItem(item, 'safe_return', profile, contractCompleted);
    const requested = dispositionOverrides[item.instanceId];
    const selected =
      requested && allowed.includes(requested)
        ? requested
        : getDefaultDispositionForItem(item, 'safe_return', contractCompleted, profile);

    let creditsPayout = 0;
    let partsPayout = 0;
    if (selected === 'sell') {
      creditsPayout = item.fixedValue;
      soldItemsCredits += creditsPayout;
      if (item.category === 'cargo' && item.origin === 'loot') {
        soldLootCargoCredits += creditsPayout;
      }
    } else if (selected === 'dismantle') {
      partsPayout = getDismantleSalvagePartsYield(item, profile, run.shipId);
      dismantledPartsEarned += partsPayout;
      dismantledItemsCount += 1;
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
      partsPayout,
      relicId: def?.relicId,
    };
  });

  // Salvager Mastery Tier >= 1 (+15%) & Display T2/T3 (+8%/+15%) appraisal bonus on sold loot cargo (0 at T0/T1)
  const effectiveMasteryTier =
    run.crewMasteryTier ?? (run.crewId ? profile.crewMastery[run.crewId] ?? 0 : 0);
  const displayTier = getFacilityTier(profile, 'display');
  const displayCargoPct = displayTier >= 3 ? 0.15 : displayTier >= 2 ? 0.08 : 0;
  const crewMasteryBonusCredits =
    (run.crewId === 'salvager' && effectiveMasteryTier >= 1 && soldLootCargoCredits > 0
      ? Math.round(soldLootCargoCredits * 0.15)
      : 0) +
    (displayCargoPct > 0 && soldLootCargoCredits > 0
      ? Math.round(soldLootCargoCredits * displayCargoPct)
      : 0);

  // Tutorial success grants fixed +40 once (§12); regular contracts grant template reward once (+contract_hub T2/T3 bonus)
  const hubTier = getFacilityTier(profile, 'contract_hub');
  const hubContractMult = hubTier >= 3 ? 1.2 : hubTier >= 2 ? 1.1 : 1;
  const contractRewardCredits =
    contractCompleted && !run.isTutorial
      ? Math.round(run.contract.rewardCredits * hubContractMult)
      : 0;
  const tutorialBonusCredits =
    run.isTutorial && contractCompleted && !profile.tutorialBonusClaimed
      ? V2_TUTORIAL_SUCCESS_BONUS
      : 0;

  // Optional Bonus Objective (F13): trust frozen `activeBonus.completed` — NEVER clobber pre-seeded false!
  const hubBonusMult = hubTier >= 3 ? 1.1 : 1;
  const bonusObjectiveCredits =
    contractCompleted && !run.isTutorial && activeBonus?.completed === true
      ? Math.round(activeBonus.rewardCredits * hubBonusMult)
      : 0;

  // Faction Perks (F13): Starport Guild Lv3 +10% guild contract bonus; Deep Institute Lv3 +6 survey parts
  const tplFallback = V2_CONTRACT_TEMPLATES[run.contract.templateId];
  const effectiveFactionId = run.contract.factionId ?? tplFallback?.factionId;
  const factionContractBonusCredits =
    contractCompleted && !run.isTutorial
      ? getGuildContractBonusCredits(
          { factionId: effectiveFactionId, rewardCredits: run.contract.rewardCredits },
          profile.factionRep.starport_guild
        )
      : 0;

  const surveyBonusParts =
    contractCompleted && !run.isTutorial
      ? getSurveyInstituteBonusParts(run.contract, profile.factionRep.deep_institute)
      : 0;

  const runSalvagePartsEarned =
    Math.max(0, Math.floor(run.salvagePartsEarned ?? 0)) + surveyBonusParts;
  const totalSalvagePartsEarned = runSalvagePartsEarned + dismantledPartsEarned;

  // Faction reputation gains (event rep + completed formal contract rep; contract_hub T3 +15%)
  const hubRepMult = hubTier >= 3 ? 1.15 : 1;
  const factionRepGains: Partial<Record<FactionId, number>> = {};
  if (!run.isShowcase) {
    if (run.factionRepEarnedThisRun) {
      for (const [fid, val] of Object.entries(run.factionRepEarnedThisRun) as [FactionId, number | undefined][]) {
        if (val && val > 0) {
          factionRepGains[fid] = (factionRepGains[fid] ?? 0) + Math.round(val);
        }
      }
    }
    if (contractCompleted && !run.isTutorial && effectiveFactionId) {
      const baseRep = run.contract.factionRepReward ?? tplFallback?.factionRepReward ?? 35;
      const bonusRep = activeBonus?.completed === true ? 10 : 0;
      const totalRep = Math.round((baseRep + bonusRep) * hubRepMult);
      if (totalRep > 0) {
        factionRepGains[effectiveFactionId] =
          (factionRepGains[effectiveFactionId] ?? 0) + totalRep;
      }
    }
  }

  const finalCreditsEarned =
    run.wallet +
    soldItemsCredits +
    crewMasteryBonusCredits +
    contractRewardCredits +
    bonusObjectiveCredits +
    factionContractBonusCredits +
    tutorialBonusCredits;

  const warehouseCapacity = getEffectiveWarehouseCapacity(profile);
  const warehouseProjectedCount =
    profile.equipmentWarehouse.length + storedToWarehouseItems.length;
  const warehouseOverflow = warehouseProjectedCount > warehouseCapacity;

  return {
    reason: 'safe_return',
    walletCredits: run.wallet,
    contractCompleted,
    contractRewardCredits,
    tutorialBonusCredits,
    soldItemsCredits,
    crewMasteryBonusCredits,
    bonusObjective: activeBonus,
    bonusObjectiveCredits,
    factionContractBonusCredits,
    runSalvagePartsEarned,
    dismantledPartsEarned,
    totalSalvagePartsEarned,
    dismantledItemsCount,
    factionRepGains,
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
  readonly factionRepGains?: Partial<Record<FactionId, number>>;
  readonly actTransition?: { readonly from: CampaignActId; readonly to: CampaignActId } | null;
  readonly newlyUnlockedSectors?: readonly SectorId[];
  readonly newlyCompletedMilestones?: readonly string[];
  readonly crewMasteryUpgraded?: {
    readonly crewId: V2CrewId;
    readonly fromTier: number;
    readonly toTier: number;
  } | null;
  readonly newlyDefeatedBossIds?: readonly string[];
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
    const cap = getEffectiveWarehouseCapacity(profile);
    return {
      ok: false,
      profile,
      summary,
      error: `设备库容量不足（预计 ${summary.warehouseProjectedCount}/${cap}），请将部分设备改为出售或拆解后再确认结算`,
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

  // Buildings auto-unlocked on tutorial safe return regardless of delivery success (§12),
  // but NOT on tutorial defeat (which keeps campaign in prologue).
  const tutorialSucceeded = run.isTutorial && summary.reason === 'safe_return';
  const nextBuildings = { ...profile.buildings };
  const nextFacilityTiers: Record<string, number> = { ...profile.facilityTiers };
  if (tutorialSucceeded) {
    nextBuildings.workbench = true;
    nextBuildings.contract_hub = true;
    nextFacilityTiers.workbench = Math.max(1, nextFacilityTiers.workbench ?? 0);
    nextFacilityTiers.contract_hub = Math.max(1, nextFacilityTiers.contract_hub ?? 0);
  }

  // Contract completion unlocks: crew + ordered equipment families (§6.2 & §10.4 + F13)
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
      unlockedCrewName = `${V2_CREW.salvager.name}（打捞师）`;
    } else if (cType === 'survey' && !nextCrew.includes('navigator')) {
      nextCrew.push('navigator');
      unlockedCrewName = `${V2_CREW.navigator.name}（领航员）`;
    }

    // Record completion of any of the 5 formal contract types (transport/rescue/survey/bounty/derelict)
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

  // Apply faction reputation gains (strictly clamped 0..300)
  let nextFactionRep = profile.factionRep;
  if (summary.factionRepGains) {
    for (const [fid, delta] of Object.entries(summary.factionRepGains) as [FactionId, number | undefined][]) {
      if (delta && delta > 0) {
        nextFactionRep = addFactionRep(nextFactionRep, fid, delta);
      }
    }
  }

  const salvageEarned = summary.totalSalvagePartsEarned;
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
    totalWrecksDissected:
      profile.career.totalWrecksDissected + Math.max(0, Math.floor(run.wrecksDissectedThisRun ?? 0)),
    totalItemsDismantled: profile.career.totalItemsDismantled + summary.dismantledItemsCount,
  };

  const baseNextProfile: V2ProfileState = {
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
    tutorialCompleted: profile.tutorialCompleted || tutorialSucceeded,
    tutorialBonusClaimed:
      profile.tutorialBonusClaimed || summary.tutorialBonusCredits > 0,
    settledRunIds: [...profile.settledRunIds, run.runId],
    factionRep: nextFactionRep,
    runHistory: nextRunHistory,
    career: nextCareer,
  };

  const campaignAdvance = advanceCampaignAfterRun(baseNextProfile, run, summary);

  return {
    ok: true,
    profile: campaignAdvance.profile,
    summary,
    unlockedFamilyName,
    unlockedCrewName,
    factionRepGains: summary.factionRepGains,
    actTransition: campaignAdvance.actTransition,
    newlyUnlockedSectors: campaignAdvance.newlyUnlockedSectors,
    newlyCompletedMilestones: campaignAdvance.newlyCompletedMilestones,
    crewMasteryUpgraded: campaignAdvance.crewMasteryUpgraded,
    newlyDefeatedBossIds: campaignAdvance.newlyDefeatedBossIds,
  };
}
