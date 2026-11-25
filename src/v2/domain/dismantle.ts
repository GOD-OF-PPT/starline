import {
  V2_EQUIPMENT_DEFS,
  getUnlockedEquipmentKinds,
  getV2EquipmentDefByKind,
  type V2EquipmentDef,
  type V2EquipmentKind,
} from '../data/equipment';
import { V3_FACTION_MAX_REP } from '../data/factions';
import { V2_SHIPS, type V2ShipId } from '../data/ships';
import { computeV2CargoPrice } from '../data/cargo';
import { getV3SectorDef } from '../data/sectors';
import { calculateV2BuildStats } from './buildStatsV2';
import {
  getAntiArbitragePartsCraftFloor,
  getDismantlePartsMultiplier,
  getEffectiveWorkshopCost,
  getWreckFactionStabilityBonus,
} from './factions';
import {
  createV2CargoInstance,
  createV2EquipmentInstance,
  getAnyV2ItemDef,
} from './itemCatalog';
import {
  getActiveRelicPassives,
  getEffectiveWarehouseCapacity,
  getFacilityTier,
} from './progressionV2';
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
  profile: (Pick<V2ProfileState, 'hullTuning'> & Partial<Pick<V2ProfileState, 'relics'>>) | undefined,
  shipId: V2ShipId
): number {
  const base = V2_SHIPS[shipId].maxHp;
  const tuning = getShipHullTuning(profile, shipId);
  const relicBonus = getActiveRelicPassives(profile).maxHpBonus;
  return base + tuning.hpLevel * 2 + relicBonus;
}

export function getEffectiveShipLoadoutBudget(
  profile: (Pick<V2ProfileState, 'hullTuning'> & Partial<Pick<V2ProfileState, 'relics'>>) | undefined,
  shipId: V2ShipId
): number {
  const base = V2_SHIPS[shipId].loadoutBudget;
  const tuning = getShipHullTuning(profile, shipId);
  const relicBonus = getActiveRelicPassives(profile).loadoutBudgetBonus;
  return base + tuning.budgetLevel + relicBonus;
}

export function getDismantleSalvagePartsYield(
  item: V2ItemInstance,
  profile?: Pick<V2ProfileState, 'factionRep' | 'hullTuning' | 'selectedShipId'> &
    Partial<Pick<V2ProfileState, 'buildings' | 'facilityTiers'>>,
  shipId?: V2ShipId
): number {
  if (!canDismantleV2Item(item).ok) return 0;

  let baseParts: number;
  if (item.category === 'equipment') {
    baseParts =
      item.quality === 'improved'
        ? Math.max(10, Math.round(item.fixedValue * 0.9))
        : Math.max(6, Math.round(item.fixedValue * 0.8));
  } else if (item.category === 'gadget') {
    baseParts = Math.max(4, Math.round(item.fixedValue * 0.55));
  } else {
    baseParts = Math.max(3, Math.round(item.fixedValue * 0.45));
  }

  const salvagersRep = profile?.factionRep?.free_salvagers ?? 0;
  const wbTier =
    profile?.facilityTiers || profile?.buildings
      ? getFacilityTier(
          profile as Pick<V2ProfileState, 'buildings' | 'facilityTiers'>,
          'workbench'
        )
      : 0;
  const wbMult = wbTier >= 2 ? 1.1 : 1;
  const mult = getDismantlePartsMultiplier(salvagersRep) * wbMult;
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
  profile: Pick<V2ProfileState, 'factionRep'> &
    Partial<Pick<V2ProfileState, 'buildings' | 'facilityTiers'>>
): { readonly parts: number; readonly credits: number } {
  const wbTier =
    profile.facilityTiers || profile.buildings
      ? getFacilityTier(profile as Pick<V2ProfileState, 'buildings' | 'facilityTiers'>, 'workbench')
      : 0;
  const rawParts = Math.max(20, Math.round(def.recycleValue * 2));
  const baseParts = wbTier >= 3 ? Math.max(12, Math.round(rawParts * 0.9)) : rawParts;
  const discounted = getEffectiveWorkshopCost(baseParts, profile.factionRep.deep_institute);
  const improvedDef = getV2EquipmentDefByKind(def.kind, 'improved');
  const commonBase = Math.max(6, Math.round(def.recycleValue * 0.8));
  const improvedBase = Math.max(10, Math.round(improvedDef.recycleValue * 0.9));
  const maxMult = getDismantlePartsMultiplier(V3_FACTION_MAX_REP) * 1.1;
  const maxDismantleDelta = Math.ceil(improvedBase * maxMult) - Math.ceil(commonBase * maxMult);
  const parts = Math.max(discounted, maxDismantleDelta + 2);
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
  profile: Pick<V2ProfileState, 'factionRep'> &
    Partial<Pick<V2ProfileState, 'buildings' | 'facilityTiers'>>
): { readonly parts: number; readonly credits: number } {
  const def = getV2EquipmentDefByKind(kind, 'common');
  const wbTier =
    profile.facilityTiers || profile.buildings
      ? getFacilityTier(profile as Pick<V2ProfileState, 'buildings' | 'facilityTiers'>, 'workbench')
      : 0;
  const rawParts = Math.max(18, Math.round(def.recycleValue * 1.8));
  const baseParts = wbTier >= 3 ? Math.max(12, Math.round(rawParts * 0.9)) : rawParts;
  const discounted = getEffectiveWorkshopCost(baseParts, profile.factionRep.deep_institute);
  const commonBaseDismantle = Math.max(6, Math.round(def.recycleValue * 0.8));
  const antiArbitrageFloor = getAntiArbitragePartsCraftFloor(
    commonBaseDismantle,
    V3_HULL_TUNING_MAX.salvage,
    2
  );
  const parts = Math.max(discounted, antiArbitrageFloor);
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
  const capacity = getEffectiveWarehouseCapacity(profile);
  if (profile.equipmentWarehouse.length >= capacity) {
    return {
      canCraft: false,
      cost,
      reason: `设备库已满（${capacity}/${capacity}），请先腾出空位`,
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
  profile: Pick<V2ProfileState, 'factionRep'> &
    Partial<Pick<V2ProfileState, 'buildings' | 'facilityTiers'>>
): { readonly parts: number; readonly credits: number } {
  const baseTable: Record<V3HullTuningTrack, readonly number[]> = {
    hp: [25, 45, 65],
    salvage: [30, 55],
    budget: [60],
  };
  const arr = baseTable[track];
  const idx = Math.max(0, Math.min(arr.length - 1, nextLevel - 1));
  const dockTier =
    profile.facilityTiers || profile.buildings
      ? getFacilityTier(profile as Pick<V2ProfileState, 'buildings' | 'facilityTiers'>, 'drydock')
      : 0;
  const rawCost = dockTier >= 3 ? Math.max(15, Math.round(arr[idx] * 0.9)) : arr[idx];
  const parts = getEffectiveWorkshopCost(rawCost, profile.factionRep.deep_institute);
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
  /** Disclosed structural collapse chance (0..100%) on greedy cuts (D05) */
  readonly collapseRiskPct?: number;
  /** True when nextStability <= 0 on an unprotected greedy cut (guaranteed collapse) */
  readonly willGuaranteedCollapse?: boolean;
  readonly disabledReason?: string;
}

const VAULT_CARGO_POOL: readonly string[] = [
  'cargo.old_engine',
  'cargo.coolant_tank',
  'cargo.folding_antenna',
];

/**
 * Builds or preserves the active multi-cut wreck state for a wreck node.
 * NEVER overwrites an already-existing `run.activeWreck` matching `node.nodeId`
 * (guarantees seeded E2E fixtures & reload state survive intact!).
 *
 * D05 compartment count:
 * - L1-L2, Tutorial, and Showcase: 3 compartments (`armory`, `cargo`, `reactor`)
 * - L3-L4 formal runs: 4 compartments (`+vault`)
 * - L5-L6 formal runs: 4-5 compartments (`+vault`, plus `events`-stream optional `+aux_bay`)
 */
export function buildActiveWreckStateForNode(
  run: V2RunState,
  node: V2MapNode,
  profile?: Pick<V2ProfileState, 'factionRep' | 'hullTuning'> &
    Partial<Pick<V2ProfileState, 'buildings' | 'facilityTiers' | 'unlockedFamilies'>>
): { readonly wreck: V2WreckState; readonly nextStreams: V2RngStreams } {
  if (run.activeWreck && run.activeWreck.nodeId === node.nodeId) {
    return { wreck: run.activeWreck, nextStreams: run.rngStreams };
  }

  const w = node.wreck;
  const salvageLevel = getShipHullTuning(profile, run.shipId).salvageLevel;
  const factionBonus = getWreckFactionStabilityBonus(profile?.factionRep?.free_salvagers ?? 0);
  const grappleBonus = calculateV2BuildStats(run.bay).wreckStabilityBonus;
  const wbTier =
    profile?.facilityTiers || profile?.buildings
      ? getFacilityTier(
          profile as Pick<V2ProfileState, 'buildings' | 'facilityTiers'>,
          'workbench'
        )
      : 0;
  const workbenchBonus = wbTier >= 3 ? 10 : 0;
  const maxStability = 100 + salvageLevel * 15 + factionBonus + grappleBonus + workbenchBonus;
  const sector = getV3SectorDef(run.sectorId);
  const allowExtraSpots = !run.isTutorial && !run.isShowcase;

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
        reactorRepairGain: run.isShowcase ? (w?.reactorRepairGain ?? 8) : 5,
      },
    ];

    // D05: L3-L6 formal wrecks add a 4th sealed Vault compartment (high-value cargo + parts + credits)
    if (allowExtraSpots && node.layer >= 3) {
      const vaultCargoDefId = rng.pick(VAULT_CARGO_POOL);
      const vaultVal =
        sector.cargoPriceMult === 1
          ? undefined
          : Math.max(1, Math.round(computeV2CargoPrice(vaultCargoDefId, node.layer) * sector.cargoPriceMult));
      const vaultItem = createV2CargoInstance({
        instanceId: `${run.runId}_wrk_vault_${node.nodeId}`,
        defId: vaultCargoDefId,
        origin: 'loot',
        acquiredDepth: node.layer,
        location: 'staging',
        fixedValueOverride: vaultVal,
      });
      hotspots.push({
        spotId: 'vault',
        label: '密封金库',
        cut: false,
        riskHullDamage: 4 + Math.floor(node.layer / 3),
        riskFuelCost: 0,
        riskAmbush: rng.nextFloat() < 0.28,
        rewardItem: vaultItem,
        rewardItems: [vaultItem],
        rewardParts: 7 + node.layer * 2,
        rewardCredits: 8 + node.layer * 2,
      });
    }

    // D05: L5-L6 formal wrecks can spawn a 5th Auxiliary Bay compartment via deterministic events stream
    if (allowExtraSpots && node.layer >= 5 && rng.nextFloat() < 0.65) {
      const unlockedKinds = getUnlockedEquipmentKinds(profile?.unlockedFamilies ?? ['core']);
      const auxKind = rng.pick(unlockedKinds);
      const auxQuality =
        run.allowImproved && rng.nextFloat() < Math.min(0.65, 0.22 + node.layer * 0.06)
          ? 'improved'
          : 'common';
      const auxItem = createV2EquipmentInstance({
        instanceId: `${run.runId}_wrk_aux_${node.nodeId}`,
        kind: auxKind,
        quality: auxQuality,
        origin: 'loot',
        acquiredDepth: node.layer,
        location: 'staging',
      });
      hotspots.push({
        spotId: 'aux_bay',
        label: '副舱设备间',
        cut: false,
        riskHullDamage: 4,
        riskFuelCost: 0,
        riskAmbush: rng.nextFloat() < 0.34,
        rewardItem: auxItem,
        rewardParts: 9 + node.layer,
      });
    }

    const state: V2WreckState = {
      nodeId: node.nodeId,
      stability: maxStability,
      maxStability,
      cutsMade: 0,
      extracted: false,
      collapsed: false,
      wreckLootInstanceIds: [],
      hotspots,
    };
    return state;
  });

  return { wreck: draw.value, nextStreams: draw.nextStreams };
}

export function evaluateWreckHotspotCut(
  run: Pick<V2RunState, 'hp' | 'fuel'> & Partial<Pick<V2RunState, 'bay'>>,
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
      collapseRiskPct: 0,
      willGuaranteedCollapse: false,
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
      collapseRiskPct: 0,
      willGuaranteedCollapse: false,
      disabledReason: '已完成残骸撤离',
    };
  }

  if (wreck.collapsed) {
    return {
      canCut: false,
      isFirstSafeCut,
      isLethal: false,
      effectiveHullDamage: 0,
      effectiveFuelCost: 0,
      effectiveAmbushRisk: false,
      stabilityCost,
      collapseRiskPct: 100,
      willGuaranteedCollapse: true,
      disabledReason: '残骸已发生结构坍塌，剩余舱室封锁，请立即撤离',
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
      collapseRiskPct: 0,
      willGuaranteedCollapse: false,
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
      collapseRiskPct: 0,
      willGuaranteedCollapse: false,
      disabledReason: '该舱室已切开',
    };
  }

  if (run.hp <= 0) {
    return {
      canCut: false,
      isFirstSafeCut,
      isLethal: true,
      effectiveHullDamage: 0,
      effectiveFuelCost: 0,
      effectiveAmbushRisk: false,
      stabilityCost,
      collapseRiskPct: 0,
      willGuaranteedCollapse: false,
      disabledReason: '船体已损毁，无法继续切割（请撤离结算）',
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
      collapseRiskPct: 100,
      willGuaranteedCollapse: true,
      disabledReason: '结构稳定度归零，无法继续切割',
    };
  }

  // Cut #1 is ALWAYS SAFE; Cut Stabilizer protects the next risky cut (0 hull / 0 fuel / 0 ambush / 0 collapse)
  const stabilizerProtects = !isFirstSafeCut && Boolean(wreck.stabilizerActive);
  const grappleReduction = run.bay ? calculateV2BuildStats(run.bay).wreckHullDamageReduction : 0;
  const effectiveHullDamage =
    isFirstSafeCut || stabilizerProtects
      ? 0
      : Math.max(0, spot.riskHullDamage - grappleReduction);
  const effectiveFuelCost = isFirstSafeCut || stabilizerProtects ? 0 : Math.max(0, spot.riskFuelCost);
  const effectiveAmbushRisk =
    isFirstSafeCut || stabilizerProtects ? false : Boolean(spot.riskAmbush);

  const nextStability = Math.max(0, wreck.stability - stabilityCost);
  let collapseRiskPct = 0;
  let willGuaranteedCollapse = false;
  if (!isFirstSafeCut && !stabilizerProtects) {
    if (nextStability <= 0) {
      collapseRiskPct = 100;
      willGuaranteedCollapse = true;
    } else if (nextStability < 30) {
      collapseRiskPct = Math.max(10, Math.min(75, Math.round(((30 - nextStability) / 30) * 60)));
    }
  }

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
      collapseRiskPct,
      willGuaranteedCollapse,
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
      collapseRiskPct,
      willGuaranteedCollapse,
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
    collapseRiskPct,
    willGuaranteedCollapse,
  };
}
