import {
  V2_EQUIPMENT_DEFS,
  V2_RESEARCH_COST_CREDITS,
  V2_WAREHOUSE_CAPACITY,
  getV2EquipmentDefByKind,
  type V2EquipmentKind,
} from '../data/equipment';
import {
  V2_FACILITIES,
  V2_RELICS,
  V2_RELIC_ORDER,
  V3_STATION_FACILITIES,
  type V2FacilityId,
  type V3FacilityTierSpec,
  type V3StationFacilityId,
} from '../data/facilities';
import { getV3GadgetDefByKind, type V3GadgetKind } from '../data/gadgets';
import { syncCampaignProgress } from './campaign';
import { getEffectiveWorkshopCost } from './factions';
import { createV2EquipmentInstance, createV3GadgetInstance } from './itemCatalog';
import type { V2ProfileState } from './types';

export interface V3ActiveRelicPassives {
  readonly startingFuelBonus: number;
  readonly fullMapReveal: boolean;
  readonly maxHpBonus: number;
  readonly loadoutBudgetBonus: number;
  readonly bossTacticalChargeBonus: number;
  readonly activeRelicIds: readonly string[];
}

/**
 * Authoritative active station passives from restored Relics (F15).
 * STRICTLY gated on `relic.restored === true` — stored-but-unrestored relics grant ZERO bonuses!
 */
export function getActiveRelicPassives(
  profile?: Partial<Pick<V2ProfileState, 'relics'>> | null
): V3ActiveRelicPassives {
  const relics = profile?.relics ?? {};
  const nav = Boolean(relics.ancient_navigator?.restored);
  const cryo = Boolean(relics.cryo_amber?.restored);
  const quantum = Boolean(relics.quantum_core?.restored);
  const crown = Boolean(relics.obsidian_crown?.restored);
  const activeRelicIds: string[] = [];
  if (nav) activeRelicIds.push('ancient_navigator');
  if (cryo) activeRelicIds.push('cryo_amber');
  if (quantum) activeRelicIds.push('quantum_core');
  if (crown) activeRelicIds.push('obsidian_crown');
  return {
    startingFuelBonus: nav ? 1 : 0,
    fullMapReveal: nav,
    maxHpBonus: cryo ? 4 : 0,
    loadoutBudgetBonus: quantum ? 1 : 0,
    bossTacticalChargeBonus: crown ? 1 : 0,
    activeRelicIds,
  };
}

/**
 * Resolves the canonical tier (0..3) of a station department, harmonizing legacy `buildings` and `drydock_tier2`.
 */
export function getFacilityTier(
  profile: Pick<V2ProfileState, 'buildings' | 'facilityTiers'> | undefined | null,
  facilityId: V3StationFacilityId
): number {
  if (!profile) return 0;
  const raw = Math.max(0, Math.min(3, Math.floor(profile.facilityTiers?.[facilityId] ?? 0)));
  if (facilityId === 'stargate_relay') {
    return raw;
  }
  if (facilityId === 'drydock') {
    const tier2Built =
      Boolean(profile.buildings?.drydock_tier2) ||
      Math.floor(profile.facilityTiers?.drydock_tier2 ?? 0) >= 1;
    const baseFromBuildings = tier2Built ? 2 : profile.buildings?.drydock ? 1 : 0;
    return Math.max(raw, baseFromBuildings);
  }
  const built = Boolean(profile.buildings?.[facilityId]);
  return Math.max(raw, built ? 1 : 0);
}

/**
 * Dynamic warehouse capacity: 12 at research_lab T0/T1 (preserves T2-A8-02), 16 at T2, 20 at T3.
 */
export function getEffectiveWarehouseCapacity(
  profile?: Pick<V2ProfileState, 'buildings' | 'facilityTiers'> | null
): number {
  const labTier = getFacilityTier(profile, 'research_lab');
  if (labTier >= 3) return 20;
  if (labTier >= 2) return 16;
  return V2_WAREHOUSE_CAPACITY;
}

/**
 * Dynamic loadout preset slots: 3 at workbench T0/T1, 5 at T2, 6 at T3.
 */
export function getEffectiveMaxPresets(
  profile?: Pick<V2ProfileState, 'buildings' | 'facilityTiers'> | null
): number {
  const wbTier = getFacilityTier(profile, 'workbench');
  if (wbTier >= 3) return 6;
  if (wbTier >= 2) return 5;
  return 3;
}

export function getStargateRelayStartingWallet(
  profile?: Pick<V2ProfileState, 'buildings' | 'facilityTiers'> | null
): number {
  const relayTier = getFacilityTier(profile, 'stargate_relay');
  if (relayTier >= 3) return 50;
  if (relayTier >= 2) return 25;
  return 0;
}

export function getStargateRelayR1CoreBonus(
  profile?: Pick<V2ProfileState, 'buildings' | 'facilityTiers'> | null
): number {
  const relayTier = getFacilityTier(profile, 'stargate_relay');
  if (relayTier >= 3) return 2;
  if (relayTier >= 2) return 1;
  return 0;
}

export function getEffectiveV2ResearchCost(
  profile: Pick<V2ProfileState, 'factionRep'> & Partial<Pick<V2ProfileState, 'buildings' | 'facilityTiers'>>
): number {
  const labTier = profile.facilityTiers || profile.buildings
    ? getFacilityTier(profile as Pick<V2ProfileState, 'buildings' | 'facilityTiers'>, 'research_lab')
    : 0;
  const baseCost = labTier >= 2 ? Math.max(10, V2_RESEARCH_COST_CREDITS - 5) : V2_RESEARCH_COST_CREDITS;
  return getEffectiveWorkshopCost(baseCost, profile.factionRep.deep_institute);
}

export function getEffectiveV2CraftCost(
  profile: Pick<V2ProfileState, 'factionRep'>,
  kind: V2EquipmentKind
): number {
  const def = getV2EquipmentDefByKind(kind, 'common');
  return getEffectiveWorkshopCost(def.craftCost, profile.factionRep.deep_institute);
}

export interface V2ProfileActionResult {
  readonly ok: boolean;
  readonly profile: V2ProfileState;
  readonly error?: string;
  readonly newTier?: number;
}

export function canUpgradeV3Facility(
  profile: V2ProfileState,
  facilityId: V3StationFacilityId
): {
  readonly canUpgrade: boolean;
  readonly currentTier: number;
  readonly nextTier: 1 | 2 | 3 | null;
  readonly nextSpec: V3FacilityTierSpec | null;
  readonly reason?: string;
} {
  const def = V3_STATION_FACILITIES[facilityId];
  if (!def) {
    return { canUpgrade: false, currentTier: 0, nextTier: null, nextSpec: null, reason: '未知设施' };
  }
  const currentTier = getFacilityTier(profile, facilityId);
  if (currentTier >= 3) {
    return { canUpgrade: false, currentTier: 3, nextTier: null, nextSpec: null, reason: '已满级 T3' };
  }
  const nextTier = (currentTier + 1) as 1 | 2 | 3;
  const nextSpec = def.tiers[nextTier - 1];

  // Prerequisite checks by department & tier
  if (nextTier === 1) {
    if (facilityId === 'workbench' || facilityId === 'contract_hub') {
      return {
        canUpgrade: false,
        currentTier,
        nextTier,
        nextSpec,
        reason: '前置条件：完成教学航次自动免费启用',
      };
    }
    if (facilityId === 'drydock') {
      if (getFacilityTier(profile, 'workbench') < 1) {
        return {
          canUpgrade: false,
          currentTier,
          nextTier,
          nextSpec,
          reason: '前置条件：需先启用拆解工作台',
        };
      }
    }
    if (facilityId === 'research_lab') {
      if (profile.completedContractTypes.length < 1) {
        return {
          canUpgrade: false,
          currentTier,
          nextTier,
          nextSpec,
          reason: '前置条件：需先完成 1 次标准委托',
        };
      }
    }
    if (facilityId === 'display') {
      if (getFacilityTier(profile, 'research_lab') < 1) {
        return {
          canUpgrade: false,
          currentTier,
          nextTier,
          nextSpec,
          reason: '前置条件：需先建成深空研究台',
        };
      }
    }
    if (facilityId === 'stargate_relay') {
      const hasLab = getFacilityTier(profile, 'research_lab') >= 1;
      const hasDrydock2 = getFacilityTier(profile, 'drydock') >= 2;
      const act3Reached =
        profile.campaign.currentAct === 'act3' ||
        profile.campaign.currentAct === 'endless' ||
        profile.campaign.defeatedBossIds.includes('boss_dreadnought') ||
        profile.campaign.unlockedSectors.includes('stargate_abyss');
      if (!hasLab || !hasDrydock2 || !act3Reached) {
        return {
          canUpgrade: false,
          currentTier,
          nextTier,
          nextSpec,
          reason: '前置条件：需要研究台 T1、船坞 T2 并进入第三幕（击败铁壁无畏）',
        };
      }
    }
  } else if (nextTier === 2) {
    if (facilityId === 'drydock' && profile.completedContractTypes.length < 2) {
      return {
        canUpgrade: false,
        currentTier,
        nextTier,
        nextSpec,
        reason: '前置条件：需完成至少 2 种标准委托',
      };
    }
  }

  // Cost checks (credits + salvageParts)
  if (profile.credits < nextSpec.creditCost) {
    return {
      canUpgrade: false,
      currentTier,
      nextTier,
      nextSpec,
      reason: `信用点不足（需 ${nextSpec.creditCost}¤，还差 ${nextSpec.creditCost - profile.credits}¤）`,
    };
  }
  if (profile.salvageParts < nextSpec.partsCost) {
    return {
      canUpgrade: false,
      currentTier,
      nextTier,
      nextSpec,
      reason: `精密零件不足（需 ${nextSpec.partsCost} 件，还差 ${nextSpec.partsCost - profile.salvageParts} 件）`,
    };
  }

  return { canUpgrade: true, currentTier, nextTier, nextSpec };
}

export function upgradeV3Facility(
  profile: V2ProfileState,
  facilityId: V3StationFacilityId
): V2ProfileActionResult {
  const check = canUpgradeV3Facility(profile, facilityId);
  if (!check.canUpgrade || !check.nextTier || !check.nextSpec) {
    return { ok: false, profile, error: check.reason ?? '当前无法升级该设施' };
  }

  const nextTier = check.nextTier;
  const nextSpec = check.nextSpec;
  const nextShips = [...profile.unlockedShips];
  const nextBuildings = { ...profile.buildings };
  const nextFacilityTiers: Record<string, number> = {
    ...profile.facilityTiers,
    [facilityId]: nextTier,
  };

  if (facilityId !== 'stargate_relay') {
    nextBuildings[facilityId] = true;
  }

  if (facilityId === 'drydock') {
    if (nextTier >= 1 && !nextShips.includes('shield_cruiser')) {
      nextShips.push('shield_cruiser');
    }
    if (nextTier >= 2) {
      nextBuildings.drydock_tier2 = true;
      nextFacilityTiers.drydock_tier2 = Math.max(1, nextFacilityTiers.drydock_tier2 ?? 0);
      if (!nextShips.includes('heavy_freighter')) {
        nextShips.push('heavy_freighter');
      }
    }
    if (nextTier >= 3 && !nextShips.includes('stargate_cruiser')) {
      nextShips.push('stargate_cruiser');
    }
  }

  const updated: V2ProfileState = {
    ...profile,
    credits: profile.credits - nextSpec.creditCost,
    salvageParts: profile.salvageParts - nextSpec.partsCost,
    buildings: nextBuildings,
    facilityTiers: nextFacilityTiers,
    unlockedShips: nextShips,
  };

  return {
    ok: true,
    newTier: nextTier,
    profile: syncCampaignProgress(updated).profile,
  };
}

export function canBuildV2Facility(
  profile: V2ProfileState,
  facilityId: V2FacilityId
): { readonly canBuild: boolean; readonly reason?: string } {
  const def = V2_FACILITIES[facilityId];
  if (!def) return { canBuild: false, reason: '未知设施' };
  if (profile.buildings[facilityId]) return { canBuild: false, reason: '已建成' };

  if (facilityId === 'workbench' || facilityId === 'contract_hub') {
    return { canBuild: false, reason: '完成教学航次自动免费启用' };
  }
  if (facilityId === 'drydock') {
    if (!profile.buildings.workbench) return { canBuild: false, reason: '需先启用拆解工作台' };
  }
  if (facilityId === 'research_lab') {
    if (profile.completedContractTypes.length < 1) {
      return { canBuild: false, reason: '需先完成 1 次标准委托' };
    }
  }
  if (facilityId === 'display') {
    if (!profile.buildings.research_lab) return { canBuild: false, reason: '需先建成研究台' };
  }
  if (facilityId === 'drydock_tier2') {
    if (!profile.buildings.drydock) return { canBuild: false, reason: '需先建成船坞一阶' };
    if (profile.completedContractTypes.length < 2) {
      return { canBuild: false, reason: '需完成至少 2 种标准委托' };
    }
  }
  if (profile.credits < def.cost) {
    return { canBuild: false, reason: `信用点不足（需 ${def.cost}¤，还差 ${def.cost - profile.credits}¤）` };
  }
  return { canBuild: true };
}

export function purchaseV2Facility(
  profile: V2ProfileState,
  facilityId: V2FacilityId
): V2ProfileActionResult {
  const check = canBuildV2Facility(profile, facilityId);
  if (!check.canBuild) {
    return { ok: false, profile, error: check.reason };
  }
  const def = V2_FACILITIES[facilityId];
  const nextShips = [...profile.unlockedShips];
  if (facilityId === 'drydock' && !nextShips.includes('shield_cruiser')) {
    nextShips.push('shield_cruiser');
  }
  if (facilityId === 'drydock_tier2' && !nextShips.includes('heavy_freighter')) {
    nextShips.push('heavy_freighter');
  }

  const nextFacilityTiers: Record<string, number> = {
    ...profile.facilityTiers,
    [facilityId]: Math.max(1, profile.facilityTiers[facilityId] ?? 0),
  };
  if (facilityId === 'drydock_tier2') {
    nextFacilityTiers.drydock = Math.max(2, nextFacilityTiers.drydock ?? 0);
  }

  const updated: V2ProfileState = {
    ...profile,
    credits: profile.credits - def.cost,
    buildings: {
      ...profile.buildings,
      [facilityId]: true,
    },
    facilityTiers: nextFacilityTiers,
    unlockedShips: nextShips,
  };

  return {
    ok: true,
    profile: syncCampaignProgress(updated).profile,
  };
}

export function canResearchV2Instance(
  profile: V2ProfileState,
  instanceId: string
): { readonly canResearch: boolean; readonly reason?: string; readonly kind?: V2EquipmentKind; readonly isImproved?: boolean } {
  if (!profile.buildings.research_lab) {
    return { canResearch: false, reason: '需先建成「研究台」（100¤）' };
  }
  const item = profile.equipmentWarehouse.find((w) => w.instanceId === instanceId);
  if (!item) {
    return { canResearch: false, reason: '设备库中不存在该实例（可能已被消耗）' };
  }
  if (item.origin === 'loan' || item.origin === 'mission') {
    return { canResearch: false, reason: '借用设备或任务物不可用于研究' };
  }
  if (item.category === 'gadget') {
    return { canResearch: false, reason: '消耗装置无需逆向研究蓝图' };
  }
  const def = V2_EQUIPMENT_DEFS[item.definitionId];
  if (!def) return { canResearch: false, reason: '无效设备定义' };
  if (profile.blueprints.includes(def.kind)) {
    return { canResearch: false, reason: `「${def.name}」普通蓝图已解锁，无需重复研究` };
  }
  const researchCost = getEffectiveV2ResearchCost(profile);
  if (profile.credits < researchCost) {
    return {
      canResearch: false,
      reason: `信用点不足（需 ${researchCost}¤，当前 ${profile.credits}¤）`,
    };
  }
  return {
    canResearch: true,
    kind: def.kind,
    isImproved: def.quality === 'improved',
  };
}

/**
 * Researches 1 owned/loot equipment instance from warehouse + researchCost -> unlocks common blueprint ONCE (§10.4 & AC15).
 * Consumes the exact instance atomically so double-clicking can NEVER double-charge!
 */
export function researchV2Equipment(
  profile: V2ProfileState,
  instanceId: string
): V2ProfileActionResult {
  const check = canResearchV2Instance(profile, instanceId);
  if (!check.canResearch || !check.kind) {
    return { ok: false, profile, error: check.reason };
  }
  const researchCost = getEffectiveV2ResearchCost(profile);
  const nextWarehouse = profile.equipmentWarehouse.filter((w) => w.instanceId !== instanceId);
  return {
    ok: true,
    profile: {
      ...profile,
      credits: profile.credits - researchCost,
      equipmentWarehouse: nextWarehouse,
      blueprints: [...profile.blueprints, check.kind],
    },
  };
}

/**
 * Crafts 1 owned common equipment instance at Base (cost = commonRecycle * 3 discounted by Deep Institute rep, instant, §10.4).
 */
export function craftV2CommonEquipment(
  profile: V2ProfileState,
  kind: V2EquipmentKind,
  uniqueSuffix?: string
): V2ProfileActionResult {
  if (!profile.buildings.research_lab) {
    return { ok: false, profile, error: '需先建成「研究台」才可制造设备' };
  }
  if (!profile.blueprints.includes(kind)) {
    return { ok: false, profile, error: '尚未解锁该设备的普通蓝图' };
  }
  const capacity = getEffectiveWarehouseCapacity(profile);
  if (profile.equipmentWarehouse.length >= capacity) {
    return {
      ok: false,
      profile,
      error: `设备库已满（${capacity}/${capacity}），请先腾出空位`,
    };
  }
  const craftCost = getEffectiveV2CraftCost(profile, kind);
  if (profile.credits < craftCost) {
    return { ok: false, profile, error: `信用点不足（制造需 ${craftCost}¤）` };
  }
  const item = createV2EquipmentInstance({
    instanceId: `craft_${kind}_${uniqueSuffix ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`}`,
    kind,
    quality: 'common',
    origin: 'owned',
    acquiredDepth: 0,
    location: 'warehouse',
  });
  return {
    ok: true,
    profile: {
      ...profile,
      credits: profile.credits - craftCost,
      equipmentWarehouse: [...profile.equipmentWarehouse, item],
      discoveredItems: profile.discoveredItems.includes(item.definitionId)
        ? profile.discoveredItems
        : [...profile.discoveredItems, item.definitionId],
      seenItems: profile.seenItems.includes(item.definitionId)
        ? profile.seenItems
        : [...profile.seenItems, item.definitionId],
    },
  };
}

/**
 * Crafts 1 consumable 1x1 tactical gadget using Salvage Parts (requires Workbench T2+).
 */
export function canCraftV3GadgetWithParts(
  profile: V2ProfileState,
  kind: V3GadgetKind
): { readonly canCraft: boolean; readonly partsCost: number; readonly reason?: string } {
  const def = getV3GadgetDefByKind(kind);
  const wbTier = getFacilityTier(profile, 'workbench');
  const rawCost = wbTier >= 3 ? Math.max(8, Math.round(def.craftCostParts * 0.9)) : def.craftCostParts;
  const partsCost = getEffectiveWorkshopCost(rawCost, profile.factionRep.deep_institute);
  if (wbTier < 2) {
    return { canCraft: false, partsCost, reason: '需将拆解工作台升级至 T2 后解锁装置制造' };
  }
  const capacity = getEffectiveWarehouseCapacity(profile);
  if (profile.equipmentWarehouse.length >= capacity) {
    return { canCraft: false, partsCost, reason: `设备库已满（${capacity}/${capacity}）` };
  }
  if (profile.salvageParts < partsCost) {
    return {
      canCraft: false,
      partsCost,
      reason: `精密零件不足（需要 ${partsCost} 件，当前 ${profile.salvageParts} 件）`,
    };
  }
  return { canCraft: true, partsCost };
}

export function craftV3GadgetWithParts(
  profile: V2ProfileState,
  kind: V3GadgetKind,
  uniqueSuffix?: string
): V2ProfileActionResult {
  const check = canCraftV3GadgetWithParts(profile, kind);
  if (!check.canCraft) {
    return { ok: false, profile, error: check.reason };
  }
  const item = createV3GadgetInstance({
    instanceId: `craftg_${kind}_${uniqueSuffix ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`}`,
    kind,
    origin: 'owned',
    acquiredDepth: 0,
    location: 'warehouse',
  });
  return {
    ok: true,
    profile: {
      ...profile,
      salvageParts: profile.salvageParts - check.partsCost,
      equipmentWarehouse: [...profile.equipmentWarehouse, item],
      discoveredItems: profile.discoveredItems.includes(item.definitionId)
        ? profile.discoveredItems
        : [...profile.discoveredItems, item.definitionId],
      seenItems: profile.seenItems.includes(item.definitionId)
        ? profile.seenItems
        : [...profile.seenItems, item.definitionId],
    },
  };
}

/**
 * Sells an owned/loot equipment or gadget instance directly from base warehouse at fixedValue.
 */
export function sellV2WarehouseItem(
  profile: V2ProfileState,
  instanceId: string
): V2ProfileActionResult {
  const item = profile.equipmentWarehouse.find((w) => w.instanceId === instanceId);
  if (!item) return { ok: false, profile, error: '设备库中不存在该物品' };
  if (item.origin === 'loan' || item.origin === 'mission') {
    return { ok: false, profile, error: '借用或任务物不可出售' };
  }
  return {
    ok: true,
    profile: {
      ...profile,
      credits: profile.credits + item.fixedValue,
      equipmentWarehouse: profile.equipmentWarehouse.filter((w) => w.instanceId !== instanceId),
    },
  };
}

/**
 * Claims a contract-unlock gift item from pendingGiftQueue into warehouse (blocks if full so gifts never vanish, §10.4).
 */
export function claimV2PendingGiftToWarehouse(
  profile: V2ProfileState,
  instanceId: string
): V2ProfileActionResult {
  const gift = profile.pendingGiftQueue.find((g) => g.instanceId === instanceId);
  if (!gift) return { ok: false, profile, error: '待领取队列中无此赠品' };
  const capacity = getEffectiveWarehouseCapacity(profile);
  if (profile.equipmentWarehouse.length >= capacity) {
    return {
      ok: false,
      profile,
      error: `设备库已满（${capacity}/${capacity}），请先出售/研究库存或直接出售赠品`,
    };
  }
  const stored = { ...gift, origin: 'owned' as const, location: 'warehouse' as const };
  return {
    ok: true,
    profile: {
      ...profile,
      pendingGiftQueue: profile.pendingGiftQueue.filter((g) => g.instanceId !== instanceId),
      equipmentWarehouse: [...profile.equipmentWarehouse, stored],
      discoveredItems: profile.discoveredItems.includes(stored.definitionId)
        ? profile.discoveredItems
        : [...profile.discoveredItems, stored.definitionId],
      seenItems: profile.seenItems.includes(stored.definitionId)
        ? profile.seenItems
        : [...profile.seenItems, stored.definitionId],
    },
  };
}

export function sellV2PendingGift(
  profile: V2ProfileState,
  instanceId: string
): V2ProfileActionResult {
  const gift = profile.pendingGiftQueue.find((g) => g.instanceId === instanceId);
  if (!gift) return { ok: false, profile, error: '待领取队列中无此赠品' };
  return {
    ok: true,
    profile: {
      ...profile,
      credits: profile.credits + gift.fixedValue,
      pendingGiftQueue: profile.pendingGiftQueue.filter((g) => g.instanceId !== instanceId),
    },
  };
}

export function canRestoreV2Relic(
  profile: V2ProfileState,
  relicId: string
): { readonly canRestore: boolean; readonly reason?: string } {
  const def = V2_RELICS[relicId];
  if (!def) return { canRestore: false, reason: '未知藏品' };
  if (!profile.buildings.display) return { canRestore: false, reason: '需先建成收藏展台' };
  const st = profile.relics[relicId];
  if (!st) return { canRestore: false, reason: '藏品记录缺失' };
  if (st.restored) return { canRestore: false, reason: '已修复展示' };
  if (st.storedCount <= 0) return { canRestore: false, reason: '尚未带回实物' };
  if (profile.credits < def.restoreCost) {
    return { canRestore: false, reason: `信用点不足（需 ${def.restoreCost}¤）` };
  }
  return { canRestore: true };
}

export function restoreV2Relic(
  profile: V2ProfileState,
  relicId: string
): V2ProfileActionResult {
  const check = canRestoreV2Relic(profile, relicId);
  if (!check.canRestore) return { ok: false, profile, error: check.reason };
  const def = V2_RELICS[relicId];
  const st = profile.relics[relicId];
  const updated: V2ProfileState = {
    ...profile,
    credits: profile.credits - def.restoreCost,
    relics: {
      ...profile.relics,
      [relicId]: {
        storedCount: Math.max(0, st.storedCount - 1),
        restored: true,
      },
    },
  };
  return {
    ok: true,
    profile: syncCampaignProgress(updated).profile,
  };
}

export function getV2RelicSummary(profile: V2ProfileState): {
  readonly restoredCount: number;
  readonly totalCount: number;
  readonly storedTotal: number;
  readonly restorableIds: readonly string[];
} {
  let restoredCount = 0;
  let storedTotal = 0;
  const restorableIds: string[] = [];
  for (const rid of V2_RELIC_ORDER) {
    const st = profile.relics[rid] ?? { storedCount: 0, restored: false };
    if (st.restored) restoredCount += 1;
    storedTotal += st.storedCount;
    if (canRestoreV2Relic(profile, rid).canRestore) {
      restorableIds.push(rid);
    }
  }
  return {
    restoredCount,
    totalCount: V2_RELIC_ORDER.length,
    storedTotal,
    restorableIds,
  };
}

