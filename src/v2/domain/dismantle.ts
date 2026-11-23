import {
  V2_EQUIPMENT_DEFS,
  V2_WAREHOUSE_CAPACITY,
  getV2EquipmentDefByKind,
  type V2EquipmentDef,
  type V2EquipmentKind,
} from '../data/equipment';
import { V2_SHIPS, type V2ShipId } from '../data/ships';
import {
  getDismantlePartsMultiplier,
  getEffectiveWorkshopCost,
  getWreckFactionStabilityBonus,
} from './factions';
import { createV2EquipmentInstance, getAnyV2ItemDef } from './itemCatalog';
import { withV2Stream } from './rngStreams';
import type {
  V2ItemInstance,
  V2MapNode,
  V2ProfileState,
  V2RngStreams,
  V2RunState,
  V2WreckHotspot,
  V2WreckSpotId,
  V2WreckState,
  V3HullTuningState,
  V3HullTuningTrack,
} from './types';

export interface V3DismantleActionResult {
  readonly ok: boolean;
  readonly profile: V2ProfileState;
  readonly error?: string;
  readonly partsGained?: number;
  readonly upgradedDefId?: string;
}

export const V3_HULL_TUNING_MAX: Record<V3HullTuningTrack, number> = {
  hp: 3,
  salvage: 2,
  budget: 1,
};

export const V3_HULL_TUNING_LABELS: Record<
  V3HullTuningTrack,
  { readonly title: string; readonly perkPerLevel: string }
> = {
  hp: { title: '船体装甲加固', perkPerLevel: '+2 最大耐久/级' },
  salvage: { title: '拆解切割优化', perkPerLevel: '+15 残骸稳定度 & +1 拆解零件/级' },
  budget: { title: '能源总线扩容', perkPerLevel: '+1 出航装配预算' },
};

// --- Item Dismantling (Settlement & Base Workshop) ---

export function canDismantleV2Item(item: V2ItemInstance): {
  readonly ok: boolean;
  readonly reason?: string;
} {
  if (item.origin === 'loan') {
    return { ok: false, reason: '借用设备不可拆解' };
  }
  if (item.origin === 'mission' || item.category === 'mission') {
    return { ok: false, reason: '委托任务物资不可拆解' };
  }
  const def = getAnyV2ItemDef(item.definitionId);
  if (def?.isCollectible) {
    return { ok: false, reason: '珍稀遗物不可拆解，可保留修复或出售' };
  }
  if (item.origin !== 'loot' && item.origin !== 'owned') {
    return { ok: false, reason: '该物品不可拆解' };
  }
  return { ok: true };
}

export function getShipHullTuning(
  profile: Pick<V2ProfileState, 'hullTuning'> | undefined,
  shipId: V2ShipId
): V3HullTuningState {
  const raw = profile?.hullTuning?.[shipId];
  return {
    hpLevel: Math.max(0, Math.min(V3_HULL_TUNING_MAX.hp, Math.floor(raw?.hpLevel ?? 0))),
    salvageLevel: Math.max(
      0,
      Math.min(V3_HULL_TUNING_MAX.salvage, Math.floor(raw?.salvageLevel ?? 0))
    ),
    budgetLevel: Math.max(
      0,
      Math.min(V3_HULL_TUNING_MAX.budget, Math.floor(raw?.budgetLevel ?? 0))
    ),
  };
}

export function getEffectiveShipMaxHp(
  profile: Pick<V2ProfileState, 'hullTuning'> | undefined,
  shipId: V2ShipId
): number {
  const base = V2_SHIPS[shipId].maxHp;
  const tuning = getShipHullTuning(profile, shipId);
  return base + tuning.hpLevel * 2;
}

export function getEffectiveShipLoadoutBudget(
  profile: Pick<V2ProfileState, 'hullTuning'> | undefined,
  shipId: V2ShipId
): number {
  const base = V2_SHIPS[shipId].loadoutBudget;
  const tuning = getShipHullTuning(profile, shipId);
  return base + tuning.budgetLevel;
}

export function getDismantleSalvagePartsYield(
  item: V2ItemInstance,
  profile?: Pick<V2ProfileState, 'factionRep' | 'hullTuning' | 'selectedShipId'>,
  shipId?: V2ShipId
): number {
  if (!canDismantleV2Item(item).ok) return 0;

  let baseParts: number;
  if (item.category === 'equipment') {
    baseParts =
      item.quality === 'improved'
        ? Math.max(10, Math.round(item.fixedValue * 0.9))
        : Math.max(6, Math.round(item.fixedValue * 0.8));
  } else {
    baseParts = Math.max(3, Math.round(item.fixedValue * 0.45));
  }

  const salvagersRep = profile?.factionRep?.free_salvagers ?? 0;
  const mult = getDismantlePartsMultiplier(salvagersRep);
  const effectiveShip = shipId ?? profile?.selectedShipId ?? 'cannon_skiff';
  const salvageTuning = getShipHullTuning(profile, effectiveShip).salvageLevel;
  return Math.max(1, Math.ceil(baseParts * mult) + salvageTuning);
}

export function dismantleV2WarehouseItem(
  profile: V2ProfileState,
  instanceId: string
): V3DismantleActionResult {
  const item = profile.equipmentWarehouse.find((w) => w.instanceId === instanceId);
  if (!item) {
    return { ok: false, profile, error: '设备库中不存在该设备' };
  }
  const check = canDismantleV2Item(item);
  if (!check.ok) {
    return { ok: false, profile, error: check.reason };
  }
  const partsGained = getDismantleSalvagePartsYield(item, profile, profile.selectedShipId);
  const nextWarehouse = profile.equipmentWarehouse.filter((w) => w.instanceId !== instanceId);
  return {
    ok: true,
    partsGained,
    profile: {
      ...profile,
      salvageParts: profile.salvageParts + partsGained,
      equipmentWarehouse: nextWarehouse,
      career: {
        ...profile.career,
        totalSalvagePartsEarned: profile.career.totalSalvagePartsEarned + partsGained,
        totalItemsDismantled: profile.career.totalItemsDismantled + 1,
      },
    },
  };
}

// --- Workbench Common -> Improved Refining (Salvage Parts ONLY, 0 credits!) ---

export function getUpgradeToImprovedCost(
  def: V2EquipmentDef,
  profile: Pick<V2ProfileState, 'factionRep'>
): { readonly parts: number; readonly credits: number } {
  const baseParts = Math.max(20, Math.round(def.recycleValue * 2));
  const parts = getEffectiveWorkshopCost(baseParts, profile.factionRep.deep_institute);
  return { parts, credits: 0 };
}

export function canUpgradeV2Equipment(
  profile: V2ProfileState,
  instanceId: string
): {
  readonly canUpgrade: boolean;
  readonly reason?: string;
  readonly cost?: { readonly parts: number; readonly credits: number };
  readonly targetDefId?: string;
} {
  const item = profile.equipmentWarehouse.find((w) => w.instanceId === instanceId);
  if (!item) {
    return { canUpgrade: false, reason: '设备库中不存在该设备' };
  }
  if (item.origin === 'loan' || item.origin === 'mission') {
    return { canUpgrade: false, reason: '借用或任务设备不可精炼升级' };
  }
  if (item.quality === 'improved') {
    return { canUpgrade: false, reason: '已达最高品质（优良）' };
  }
  const def = V2_EQUIPMENT_DEFS[item.definitionId];
  if (!def) {
    return { canUpgrade: false, reason: '无效设备定义' };
  }
  const targetDefId = `equipment.${def.kind}.improved`;
  if (!Object.prototype.hasOwnProperty.call(V2_EQUIPMENT_DEFS, targetDefId)) {
    return { canUpgrade: false, reason: '该设备无更高品质型号' };
  }
  const cost = getUpgradeToImprovedCost(def, profile);
  if (profile.salvageParts < cost.parts) {
    return {
      canUpgrade: false,
      cost,
      targetDefId,
      reason: `精密零件不足（需要 ${cost.parts} 精密零件，当前 ${profile.salvageParts}）`,
    };
  }
  return {
    canUpgrade: true,
    cost,
    targetDefId,
  };
}

export function upgradeV2EquipmentToImproved(
  profile: V2ProfileState,
  instanceId: string
): V3DismantleActionResult {
  const check = canUpgradeV2Equipment(profile, instanceId);
  if (!check.canUpgrade || !check.cost || !check.targetDefId) {
    return { ok: false, profile, error: check.reason ?? '无法精炼升级' };
  }
  const item = profile.equipmentWarehouse.find((w) => w.instanceId === instanceId)!;
  const def = V2_EQUIPMENT_DEFS[item.definitionId]!;
  const upgraded = createV2EquipmentInstance({
    instanceId: item.instanceId,
    kind: def.kind,
    quality: 'improved',
    origin: 'owned',
    acquiredDepth: item.acquiredDepth,
    location: 'warehouse',
  });
  const nextWarehouse = profile.equipmentWarehouse.map((w) =>
    w.instanceId === instanceId ? upgraded : w
  );
  const nextDiscovered = profile.discoveredItems.includes(upgraded.definitionId)
    ? profile.discoveredItems
    : [...profile.discoveredItems, upgraded.definitionId];
  const nextSeen = profile.seenItems.includes(upgraded.definitionId)
    ? profile.seenItems
    : [...profile.seenItems, upgraded.definitionId];

  return {
    ok: true,
    upgradedDefId: upgraded.definitionId,
    profile: {
      ...profile,
      salvageParts: profile.salvageParts - check.cost.parts,
      equipmentWarehouse: nextWarehouse,
      discoveredItems: nextDiscovered,
      seenItems: nextSeen,
    },
  };
}

// --- Salvage-Parts Module Crafting (0 credits!) ---

export function getPartsCraftCost(
  kind: V2EquipmentKind,
  profile: Pick<V2ProfileState, 'factionRep'>
): { readonly parts: number; readonly credits: number } {
  const def = getV2EquipmentDefByKind(kind, 'common');
  const baseParts = Math.max(18, Math.round(def.recycleValue * 1.8));
  const parts = getEffectiveWorkshopCost(baseParts, profile.factionRep.deep_institute);
  return { parts, credits: 0 };
}

export function canCraftV2EquipmentWithParts(
  profile: V2ProfileState,
  kind: V2EquipmentKind
): {
  readonly canCraft: boolean;
  readonly reason?: string;
  readonly cost: { readonly parts: number; readonly credits: number };
} {
  const cost = getPartsCraftCost(kind, profile);
  if (!profile.blueprints.includes(kind)) {
    return { canCraft: false, cost, reason: '尚未解锁该设备的普通蓝图' };
  }
  if (profile.equipmentWarehouse.length >= V2_WAREHOUSE_CAPACITY) {
    return {
      canCraft: false,
      cost,
      reason: `设备库已满（${V2_WAREHOUSE_CAPACITY}/${V2_WAREHOUSE_CAPACITY}），请先腾出空位`,
    };
  }
  if (profile.salvageParts < cost.parts) {
    return {
      canCraft: false,
      cost,
      reason: `精密零件不足（需要 ${cost.parts} 精密零件，当前 ${profile.salvageParts}）`,
    };
  }
  return { canCraft: true, cost };
}

export function craftV2EquipmentWithParts(
  profile: V2ProfileState,
  kind: V2EquipmentKind,
  uniqueSuffix?: string
): V3DismantleActionResult {
  const check = canCraftV2EquipmentWithParts(profile, kind);
  if (!check.canCraft) {
    return { ok: false, profile, error: check.reason };
  }
  const item = createV2EquipmentInstance({
    instanceId: `craftp_${kind}_${
      uniqueSuffix ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    }`,
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
      salvageParts: profile.salvageParts - check.cost.parts,
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

// --- 3-Track Hull Tuning (Salvage Parts ONLY, 0 credits!) ---

export function getHullTuningCost(
  track: V3HullTuningTrack,
  nextLevel: number,
  profile: Pick<V2ProfileState, 'factionRep'>
): { readonly parts: number; readonly credits: number } {
  const baseTable: Record<V3HullTuningTrack, readonly number[]> = {
    hp: [25, 45, 65],
    salvage: [30, 55],
    budget: [60],
  };
  const arr = baseTable[track];
  const idx = Math.max(0, Math.min(arr.length - 1, nextLevel - 1));
  const parts = getEffectiveWorkshopCost(arr[idx], profile.factionRep.deep_institute);
  return { parts, credits: 0 };
}

export function canTuneV2ShipHull(
  profile: V2ProfileState,
  shipId: V2ShipId,
  track: V3HullTuningTrack
): {
  readonly canTune: boolean;
  readonly currentLevel: number;
  readonly maxLevel: number;
  readonly cost: { readonly parts: number; readonly credits: number } | null;
  readonly reason?: string;
} {
  const maxLevel = V3_HULL_TUNING_MAX[track];
  const tuning = getShipHullTuning(profile, shipId);
  const currentLevel =
    track === 'hp' ? tuning.hpLevel : track === 'salvage' ? tuning.salvageLevel : tuning.budgetLevel;

  if (!profile.unlockedShips.includes(shipId)) {
    return { canTune: false, currentLevel, maxLevel, cost: null, reason: '舰船尚未解锁' };
  }
  if (currentLevel >= maxLevel) {
    return { canTune: false, currentLevel, maxLevel, cost: null, reason: '已达最高调校等级' };
  }
  const cost = getHullTuningCost(track, currentLevel + 1, profile);
  if (profile.salvageParts < cost.parts) {
    return {
      canTune: false,
      currentLevel,
      maxLevel,
      cost,
      reason: `精密零件不足（需要 ${cost.parts} 精密零件，当前 ${profile.salvageParts}）`,
    };
  }
  return { canTune: true, currentLevel, maxLevel, cost };
}

export function tuneV2ShipHull(
  profile: V2ProfileState,
  shipId: V2ShipId,
  track: V3HullTuningTrack
): V3DismantleActionResult {
  const check = canTuneV2ShipHull(profile, shipId, track);
  if (!check.canTune || !check.cost) {
    return { ok: false, profile, error: check.reason ?? '无法调校船体' };
  }
  const prev = getShipHullTuning(profile, shipId);
  const nextShipTuning: V3HullTuningState = {
    hpLevel: track === 'hp' ? prev.hpLevel + 1 : prev.hpLevel,
    salvageLevel: track === 'salvage' ? prev.salvageLevel + 1 : prev.salvageLevel,
    budgetLevel: track === 'budget' ? prev.budgetLevel + 1 : prev.budgetLevel,
  };
  return {
    ok: true,
    profile: {
      ...profile,
      salvageParts: profile.salvageParts - check.cost.parts,
      hullTuning: {
        ...(profile.hullTuning ?? {}),
        [shipId]: nextShipTuning,
      },
    },
  };
}

// --- Multi-Cut Derelict Dissection (F11) ---

export interface V3WreckCutEvaluation {
  readonly canCut: boolean;
  readonly isFirstSafeCut: boolean;
  readonly isLethal: boolean;
  readonly effectiveHullDamage: number;
  readonly effectiveFuelCost: number;
  readonly effectiveAmbushRisk: boolean;
  readonly stabilityCost: number;
  readonly disabledReason?: string;
}

/**
 * Builds or preserves the active multi-cut wreck state for a wreck node.
 * NEVER overwrites an already-existing `run.activeWreck` matching `node.nodeId`
 * (guarantees seeded E2E fixtures & reload state survive intact!).
 */
export function buildActiveWreckStateForNode(
  run: V2RunState,
  node: V2MapNode,
  profile?: Pick<V2ProfileState, 'factionRep' | 'hullTuning'>
): { readonly wreck: V2WreckState; readonly nextStreams: V2RngStreams } {
  if (run.activeWreck && run.activeWreck.nodeId === node.nodeId) {
    return { wreck: run.activeWreck, nextStreams: run.rngStreams };
  }

  const w = node.wreck;
  const salvageLevel = getShipHullTuning(profile, run.shipId).salvageLevel;
  const factionBonus = getWreckFactionStabilityBonus(profile?.factionRep?.free_salvagers ?? 0);
  const maxStability = 100 + salvageLevel * 15 + factionBonus;

  const draw = withV2Stream(run.rngStreams, 'events', (rng) => {
    const armoryAmbush = node.layer >= 3 && rng.nextFloat() < 0.32;
    const cargoAmbush = node.layer >= 2 && rng.nextFloat() < 0.24;

    const hotspots: V2WreckHotspot[] = [
      {
        spotId: 'armory',
        label: '军械舱',
        cut: false,
        riskHullDamage: 3 + Math.floor(node.layer / 2),
        riskFuelCost: 0,
        riskAmbush: armoryAmbush,
        rewardItem: w?.armoryItem,
        rewardParts: 4 + node.layer,
      },
      {
        spotId: 'cargo',
        label: '主货舱',
        cut: false,
        riskHullDamage: 4,
        riskFuelCost: 0,
        riskAmbush: cargoAmbush,
        rewardItem: w?.cargoItems[0],
        rewardItems: w?.cargoItems,
        rewardParts: 5 + node.layer,
      },
      {
        spotId: 'reactor',
        label: '反应堆舱',
        cut: false,
        riskHullDamage: 5,
        riskFuelCost: 1,
        riskAmbush: false,
        rewardParts: 8 + node.layer * 2,
        reactorFuelGain: w?.reactorFuelGain ?? 2,
        reactorRepairGain: w?.reactorRepairGain ?? 8,
      },
    ];

    const state: V2WreckState = {
      nodeId: node.nodeId,
      stability: maxStability,
      maxStability,
      cutsMade: 0,
      extracted: false,
      hotspots,
    };
    return state;
  });

  return { wreck: draw.value, nextStreams: draw.nextStreams };
}

export function evaluateWreckHotspotCut(
  run: Pick<V2RunState, 'hp' | 'fuel'>,
  wreck: V2WreckState,
  spotId: V2WreckSpotId
): V3WreckCutEvaluation {
  const spot = wreck.hotspots.find((h) => h.spotId === spotId);
  const isFirstSafeCut = wreck.cutsMade === 0;
  const stabilityCost = isFirstSafeCut ? 40 : wreck.cutsMade === 1 ? 35 : 25;

  if (!spot) {
    return {
      canCut: false,
      isFirstSafeCut,
      isLethal: false,
      effectiveHullDamage: 0,
      effectiveFuelCost: 0,
      effectiveAmbushRisk: false,
      stabilityCost,
      disabledReason: '未找到目标残骸舱室',
    };
  }

  if (wreck.extracted) {
    return {
      canCut: false,
      isFirstSafeCut,
      isLethal: false,
      effectiveHullDamage: 0,
      effectiveFuelCost: 0,
      effectiveAmbushRisk: false,
      stabilityCost,
      disabledReason: '已完成残骸撤离',
    };
  }

  if (wreck.ambushTriggered) {
    return {
      canCut: false,
      isFirstSafeCut,
      isLethal: false,
      effectiveHullDamage: 0,
      effectiveFuelCost: 0,
      effectiveAmbushRisk: false,
      stabilityCost,
      disabledReason: '警报已触发伏击敌舰，请先应对战斗',
    };
  }

  if (spot.cut) {
    return {
      canCut: false,
      isFirstSafeCut,
      isLethal: false,
      effectiveHullDamage: 0,
      effectiveFuelCost: 0,
      effectiveAmbushRisk: false,
      stabilityCost,
      disabledReason: '该舱室已切开',
    };
  }

  if (!isFirstSafeCut && wreck.stability <= 0) {
    return {
      canCut: false,
      isFirstSafeCut,
      isLethal: false,
      effectiveHullDamage: spot.riskHullDamage,
      effectiveFuelCost: spot.riskFuelCost,
      effectiveAmbushRisk: spot.riskAmbush,
      stabilityCost,
      disabledReason: '结构稳定度归零，无法继续切割',
    };
  }

  // Cut #1 is ALWAYS SAFE (0 hull loss, 0 fuel cost, 0 ambush risk!)
  const effectiveHullDamage = isFirstSafeCut ? 0 : Math.max(0, spot.riskHullDamage);
  const effectiveFuelCost = isFirstSafeCut ? 0 : Math.max(0, spot.riskFuelCost);
  const effectiveAmbushRisk = isFirstSafeCut ? false : Boolean(spot.riskAmbush);

  // Strict lethal-cut guard: never allow a cut that drops HP <= 0!
  if (effectiveHullDamage > 0 && run.hp <= effectiveHullDamage) {
    return {
      canCut: false,
      isFirstSafeCut,
      isLethal: true,
      effectiveHullDamage,
      effectiveFuelCost,
      effectiveAmbushRisk,
      stabilityCost,
      disabledReason: '致命风险：船体不足，切割将损毁舰体（无法切割）',
    };
  }

  if (effectiveFuelCost > 0 && run.fuel < effectiveFuelCost) {
    return {
      canCut: false,
      isFirstSafeCut,
      isLethal: false,
      effectiveHullDamage,
      effectiveFuelCost,
      effectiveAmbushRisk,
      stabilityCost,
      disabledReason: `燃料不足（需 ${effectiveFuelCost} 燃料，当前 ${run.fuel}）`,
    };
  }

  return {
    canCut: true,
    isFirstSafeCut,
    isLethal: false,
    effectiveHullDamage,
    effectiveFuelCost,
    effectiveAmbushRisk,
    stabilityCost,
  };
}
