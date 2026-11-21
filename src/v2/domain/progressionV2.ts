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
  type V2FacilityId,
} from '../data/facilities';
import { createV2EquipmentInstance } from './itemCatalog';
import type { V2ProfileState } from './types';

export interface V2ProfileActionResult {
  readonly ok: boolean;
  readonly profile: V2ProfileState;
  readonly error?: string;
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

  return {
    ok: true,
    profile: {
      ...profile,
      credits: profile.credits - def.cost,
      buildings: {
        ...profile.buildings,
        [facilityId]: true,
      },
      unlockedShips: nextShips,
    },
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
  const def = V2_EQUIPMENT_DEFS[item.definitionId];
  if (!def) return { canResearch: false, reason: '无效设备定义' };
  if (profile.blueprints.includes(def.kind)) {
    return { canResearch: false, reason: `「${def.name}」普通蓝图已解锁，无需重复研究` };
  }
  if (profile.credits < V2_RESEARCH_COST_CREDITS) {
    return {
      canResearch: false,
      reason: `信用点不足（需 ${V2_RESEARCH_COST_CREDITS}¤，当前 ${profile.credits}¤）`,
    };
  }
  return {
    canResearch: true,
    kind: def.kind,
    isImproved: def.quality === 'improved',
  };
}

/**
 * Researches 1 owned/loot equipment instance from warehouse + 30 credits -> unlocks common blueprint ONCE (§10.4 & AC15).
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
  const nextWarehouse = profile.equipmentWarehouse.filter((w) => w.instanceId !== instanceId);
  return {
    ok: true,
    profile: {
      ...profile,
      credits: profile.credits - V2_RESEARCH_COST_CREDITS,
      equipmentWarehouse: nextWarehouse,
      blueprints: [...profile.blueprints, check.kind],
    },
  };
}

/**
 * Crafts 1 owned common equipment instance at Base (cost = commonRecycle * 3, instant, §10.4).
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
  if (profile.equipmentWarehouse.length >= V2_WAREHOUSE_CAPACITY) {
    return {
      ok: false,
      profile,
      error: `设备库已满（${V2_WAREHOUSE_CAPACITY}/${V2_WAREHOUSE_CAPACITY}），请先腾出空位`,
    };
  }
  const def = getV2EquipmentDefByKind(kind, 'common');
  if (profile.credits < def.craftCost) {
    return { ok: false, profile, error: `信用点不足（制造需 ${def.craftCost}¤）` };
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
      credits: profile.credits - def.craftCost,
      equipmentWarehouse: [...profile.equipmentWarehouse, item],
      discoveredItems: profile.discoveredItems.includes(item.definitionId)
        ? profile.discoveredItems
        : [...profile.discoveredItems, item.definitionId],
    },
  };
}

/**
 * Sells an owned/loot equipment instance directly from base warehouse at fixedValue.
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
  if (profile.equipmentWarehouse.length >= V2_WAREHOUSE_CAPACITY) {
    return {
      ok: false,
      profile,
      error: `设备库已满（${V2_WAREHOUSE_CAPACITY}/${V2_WAREHOUSE_CAPACITY}），请先出售/研究库存或直接出售赠品`,
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
  return {
    ok: true,
    profile: {
      ...profile,
      credits: profile.credits - def.restoreCost,
      relics: {
        ...profile.relics,
        [relicId]: {
          storedCount: Math.max(0, st.storedCount - 1),
          restored: true,
        },
      },
    },
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
