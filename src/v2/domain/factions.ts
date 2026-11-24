import { getMerchantBuybackPrice } from '../data/equipment';
import { V3_FACTION_LEVEL_THRESHOLDS, V3_FACTION_MAX_REP } from '../data/factions';
import type { FactionId, V2ContractInstance } from './types';

export type V3FactionRank = 1 | 2 | 3;

export function getFactionRank(rep: number): V3FactionRank {
  const safeRep = Number.isFinite(rep) ? Math.floor(rep) : 0;
  if (safeRep >= V3_FACTION_LEVEL_THRESHOLDS[2]) return 3;
  if (safeRep >= V3_FACTION_LEVEL_THRESHOLDS[1]) return 2;
  return 1;
}

export function getFactionProgress(rep: number): {
  readonly rank: V3FactionRank;
  readonly rep: number;
  readonly nextThreshold: number | null;
  readonly progressPct: number;
} {
  const clamped = Math.max(0, Math.min(V3_FACTION_MAX_REP, Math.floor(Number.isFinite(rep) ? rep : 0)));
  const rank = getFactionRank(clamped);
  const nextThreshold =
    rank === 1
      ? V3_FACTION_LEVEL_THRESHOLDS[1]
      : rank === 2
      ? V3_FACTION_LEVEL_THRESHOLDS[2]
      : null;
  const progressPct = Math.round((clamped / V3_FACTION_MAX_REP) * 100);
  return {
    rank,
    rep: clamped,
    nextThreshold,
    progressPct,
  };
}

export function addFactionRep(
  factionRep: Record<FactionId, number>,
  factionId: FactionId,
  delta: number
): Record<FactionId, number> {
  const safeDelta = Number.isFinite(delta) ? Math.round(delta) : 0;
  const prev = Number.isFinite(factionRep[factionId]) ? Math.floor(factionRep[factionId]) : 0;
  const next = Math.max(0, Math.min(V3_FACTION_MAX_REP, prev + safeDelta));
  if (next === prev) return factionRep;
  return {
    ...factionRep,
    [factionId]: next,
  };
}

/** Starport Guild merchant discount rate: Lv1 0%, Lv2 10%, Lv3 15% */
export function getMerchantDiscountRate(starportGuildRep: number): number {
  const rank = getFactionRank(starportGuildRep);
  if (rank === 3) return 0.15;
  if (rank === 2) return 0.1;
  return 0;
}

/**
 * Computes effective merchant equipment buy price with strict anti-arbitrage floor:
 * - At Lv1 (<100 rep), returns exact baseBuyPrice (zero change to baseline tests).
 * - At Lv2/Lv3, strictly enforces discountedPrice >= getMerchantBuybackPrice(itemFixedValue) + 2.
 */
export function getEffectiveMerchantEquipmentPrice(
  baseBuyPrice: number,
  itemFixedValue: number,
  starportGuildRep: number
): number {
  const rate = getMerchantDiscountRate(starportGuildRep);
  if (rate <= 0) return baseBuyPrice;
  const discounted = Math.round(baseBuyPrice * (1 - rate));
  const antiArbitrageFloor = getMerchantBuybackPrice(itemFixedValue) + 2;
  return Math.max(antiArbitrageFloor, discounted);
}

/**
 * Computes effective merchant service price (fuel/repair) with Starport Guild rep discount.
 * Returns exact basePrice at Lv1 (<100 rep).
 */
export function getEffectiveMerchantServicePrice(
  basePrice: number,
  starportGuildRep: number
): number {
  const rate = getMerchantDiscountRate(starportGuildRep);
  if (rate <= 0) return basePrice;
  return Math.max(5, Math.round(basePrice * (1 - rate)));
}

/** Deep Institute workshop discount rate: Lv1 0%, Lv2 15%, Lv3 25% */
export function getWorkshopDiscountRate(deepInstituteRep: number): number {
  const rank = getFactionRank(deepInstituteRep);
  if (rank === 3) return 0.25;
  if (rank === 2) return 0.15;
  return 0;
}

export function getEffectiveWorkshopCost(
  baseCost: number,
  deepInstituteRep: number
): number {
  const rate = getWorkshopDiscountRate(deepInstituteRep);
  if (rate <= 0) return baseCost;
  return Math.max(1, Math.round(baseCost * (1 - rate)));
}

/** Free Salvagers dismantle Salvage Parts multiplier: Lv1 1.0x, Lv2 1.2x, Lv3 1.35x */
export function getDismantlePartsMultiplier(freeSalvagersRep: number): number {
  const rank = getFactionRank(freeSalvagersRep);
  if (rank === 3) return 1.35;
  if (rank === 2) return 1.2;
  return 1.0;
}

/** Free Salvagers Lv3 bonus initial structural stability on derelict wrecks */
export function getWreckFactionStabilityBonus(freeSalvagersRep: number): number {
  return getFactionRank(freeSalvagersRep) >= 3 ? 10 : 0;
}

/** Starport Guild Lv3 bonus credits (+10%) on completed Guild contracts (0 at Lv1/Lv2) */
export function getGuildContractBonusCredits(
  contract: Pick<V2ContractInstance, 'factionId' | 'rewardCredits'>,
  starportGuildRep: number
): number {
  if (contract.factionId !== 'starport_guild') return 0;
  if (getFactionRank(starportGuildRep) < 3) return 0;
  return Math.round(contract.rewardCredits * 0.1);
}

/** Deep Institute Lv3 bonus Salvage Parts (+6) on completed survey contracts */
export function getSurveyInstituteBonusParts(
  contract: Pick<V2ContractInstance, 'type'>,
  deepInstituteRep: number
): number {
  if (contract.type !== 'survey') return 0;
  return getFactionRank(deepInstituteRep) >= 3 ? 6 : 0;
}
