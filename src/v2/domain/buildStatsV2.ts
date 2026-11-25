import {
  V2_EQUIPMENT_DEFS,
  V2_MAX_BATTLE_SHIELD,
  V2_MAX_POST_WIN_REPAIR,
  getEffectiveV2EquipmentBudgetCost,
  type V2EquipmentKind,
  type V2Quality,
} from '../data/equipment';
import { getV3GadgetDef } from '../data/gadgets';
import { V2_SHIPS } from '../data/ships';
import {
  areV2PlacedItemsAdjacent,
  doesV2PlacedItemTouchPowerCell,
} from './inventoryV2';
import type { V2CargoBayState, V2PlacedItem, V2ProfileState } from './types';

export type V2SynergyTypeId =
  | 'battery_laser'
  | 'coolant_heavy'
  | 'capacitor_heavy'
  | 'relay_hangar'
  | 'shield_counter'
  | 'coolant_vent_heavy'
  | 'coolant_vent_salvo'
  | 'support_salvo'
  | 'overdrive_weapon'
  | 'cargo_amp_cargo';

export interface V2SynergyCatalogEntry {
  readonly id: V2SynergyTypeId;
  readonly name: string;
  readonly pairLabel: string;
  readonly effectSummary: string;
  readonly isCrossCategory?: boolean;
}

export const V2_SYNERGY_ORDER: readonly V2SynergyTypeId[] = [
  'battery_laser',
  'coolant_heavy',
  'capacitor_heavy',
  'relay_hangar',
  'shield_counter',
  'coolant_vent_heavy',
  'coolant_vent_salvo',
  'support_salvo',
  'overdrive_weapon',
  'cargo_amp_cargo',
];

export const V2_SYNERGY_CATALOG: Readonly<Record<V2SynergyTypeId, V2SynergyCatalogEntry>> = {
  battery_laser: {
    id: 'battery_laser',
    name: '高能供能回路',
    pairLabel: '能量电池 ↔ 激光炮',
    effectSummary: '普通电池供能至多 1 门激光炮 (+2 伤)，优良电池供能至多 2 门 (+3 伤)',
  },
  coolant_heavy: {
    id: 'coolant_heavy',
    name: '跨类液冷炮管',
    pairLabel: '冷却罐货品 ↔ 重炮',
    effectSummary: '货物冷却罐正交贴邻重炮时为其提供额外 +4 伤（与排热阀可叠加）',
    isCrossCategory: true,
  },
  capacitor_heavy: {
    id: 'capacitor_heavy',
    name: '先手电容直驱',
    pairLabel: '蓄能器 ↔ 重炮',
    effectSummary: '重炮改为第 1、3、5…轮先手开火（优良蓄能器首轮额外 +3 伤）',
  },
  relay_hangar: {
    id: 'relay_hangar',
    name: '编队扩展链路',
    pairLabel: '编队中继 ↔ 无人机库',
    effectSummary: '无人机库上限 3→4 架（优良中继首轮额外出动 1 架）',
  },
  shield_counter: {
    id: 'shield_counter',
    name: '偏导反击共振',
    pairLabel: '护盾板 ↔ 反击器',
    effectSummary: '激活反击器，每轮按护盾实际吸收量触发 50%/75% 反击',
  },
  coolant_vent_heavy: {
    id: 'coolant_vent_heavy',
    name: '排热重炮增压',
    pairLabel: '冷却排热阀 ↔ 重炮',
    effectSummary: '排热阀正交贴邻重炮时每次开火 +2/+3 伤',
  },
  coolant_vent_salvo: {
    id: 'coolant_vent_salvo',
    name: '排热齐射冷却',
    pairLabel: '冷却排热阀 ↔ 齐射导弹舱',
    effectSummary: '排热阀正交贴邻导弹舱时每轮首枚导弹 +2/+3 伤',
  },
  support_salvo: {
    id: 'support_salvo',
    name: '火控装填扩展',
    pairLabel: '蓄能器/编队中继 ↔ 齐射导弹舱',
    effectSummary: '导弹舱每轮发射数量 +1 枚',
  },
  overdrive_weapon: {
    id: 'overdrive_weapon',
    name: '超频核心增幅',
    pairLabel: '超频核心 ↔ 武器模块',
    effectSummary: '正交贴邻武器获得超频增伤（直击 +2/+3，多段每发 +1/+2）',
  },
  cargo_amp_cargo: {
    id: 'cargo_amp_cargo',
    name: '跨类货舱谐振',
    pairLabel: '货舱谐振仪 ↔ 货物/任务物',
    effectSummary: '每贴邻 1 件货物或任务物，提升舰核火力与护盾',
    isCrossCategory: true,
  },
};

const VALID_SYNERGY_ID_SET: ReadonlySet<string> = new Set(V2_SYNERGY_ORDER);

export function isV2SynergyTypeId(id: string): id is V2SynergyTypeId {
  return VALID_SYNERGY_ID_SET.has(id);
}

export function getBatterySupplyCapacity(quality: V2Quality): number {
  return quality === 'improved' ? 2 : 1;
}

export interface V2AdjacencyLink {
  readonly sourceInstanceId: string;
  readonly sourceKind: V2EquipmentKind | 'cargo';
  readonly targetInstanceId: string;
  readonly targetKind: V2EquipmentKind | 'cargo';
  readonly label: string;
  readonly synergyId?: V2SynergyTypeId;
  readonly status?: 'active' | 'capped';
}

export interface V2BatterySupplySummary {
  readonly instanceId: string;
  readonly quality: V2Quality;
  readonly capacity: number;
  readonly suppliedLaserIds: readonly string[];
  readonly adjacentLaserIds: readonly string[];
  readonly cappedLaserIds: readonly string[];
}

export interface V2LaserComputed {
  readonly instanceId: string;
  readonly quality: V2Quality;
  readonly baseDamage: number;
  readonly batteryBonus: number;
  readonly batterySourceId?: string | null;
  readonly batteryCapped?: boolean;
  readonly overdriveBonus: number;
  readonly powerCellBonus: number;
  readonly totalDamage: number;
}

export interface V2HeavyComputed {
  readonly instanceId: string;
  readonly quality: V2Quality;
  readonly baseDamage: number;
  readonly capacitorQuality: V2Quality | null;
  /** True if fires on odd rounds (1,3,5...), false if even rounds (2,4,6...) */
  readonly firesOnOddRounds: boolean;
  readonly firstShotBonus: number;
  readonly coolantBonus: number;
  readonly coolantTankBonus: number;
  readonly coolantTankLinked: boolean;
  readonly overdriveBonus: number;
  readonly powerCellBonus: number;
}

export interface V2HangarComputed {
  readonly instanceId: string;
  readonly quality: V2Quality;
  readonly damagePerDrone: number;
  readonly relayQuality: V2Quality | null;
  readonly maxDrones: number;
  readonly roundOneBonusDrones: number;
}

export interface V2FlakComputed {
  readonly instanceId: string;
  readonly quality: V2Quality;
  readonly damagePerEnemy: number;
}

export interface V2CounterComputed {
  readonly instanceId: string;
  readonly quality: V2Quality;
  readonly ratio: number;
  readonly maxDamage: number;
}

export interface V2SalvoComputed {
  readonly instanceId: string;
  readonly quality: V2Quality;
  readonly missiles: number;
  readonly damagePerMissile: number;
  readonly coolantBonus: number;
  readonly overdriveBonus: number;
  readonly powerCellBoosted: boolean;
}

export interface V2EmpJammerComputed {
  readonly instanceId: string;
  readonly quality: V2Quality;
  readonly damage: number;
  readonly shieldShred: number;
  readonly empResist: number;
  readonly enemyWeakenEveryRound: boolean;
}

export interface V2CoolantVentComputed {
  readonly instanceId: string;
  readonly quality: V2Quality;
  readonly shieldBonus: number;
  readonly endOfRoundShieldRegen: number;
  readonly cryoResist: number;
}

export interface V2OverdriveCoreComputed {
  readonly instanceId: string;
  readonly quality: V2Quality;
  readonly coreAttackBonus: number;
  readonly directWeaponBonus: number;
  readonly multiHitBonus: number;
}

export interface V2CargoAmpComputed {
  readonly instanceId: string;
  readonly quality: V2Quality;
  readonly adjacentCargoCount: number;
  readonly coreAttackBonus: number;
  readonly shieldBonus: number;
}

export interface V2SalvageGrappleComputed {
  readonly instanceId: string;
  readonly quality: V2Quality;
  readonly damage: number;
  readonly wreckStabilityBonus: number;
  readonly wreckHullReduction: number;
  readonly bonusSalvageParts: number;
}

export interface V2BuildStats {
  readonly coreAttack: number;
  readonly hullBonusShield: number;
  readonly rawShield: number;
  readonly effectiveShield: number;
  readonly shieldCapped: boolean;
  readonly rawRepair: number;
  readonly effectiveRepair: number;
  readonly repairCapped: boolean;
  readonly lasers: readonly V2LaserComputed[];
  readonly heavies: readonly V2HeavyComputed[];
  readonly hangars: readonly V2HangarComputed[];
  readonly flaks: readonly V2FlakComputed[];
  readonly salvos: readonly V2SalvoComputed[];
  readonly empJammers: readonly V2EmpJammerComputed[];
  readonly coolantVents: readonly V2CoolantVentComputed[];
  readonly overdriveCores: readonly V2OverdriveCoreComputed[];
  readonly cargoAmps: readonly V2CargoAmpComputed[];
  readonly salvageGrapples: readonly V2SalvageGrappleComputed[];
  readonly activeCounters: readonly V2CounterComputed[];
  /** Highest-quality active counter on the ship (triggers at most once per round, §7.2) */
  readonly bestActiveCounter: V2CounterComputed | null;
  readonly endOfRoundShieldRegen: number;
  readonly cryoDrainReduction: number;
  readonly empDrainReduction: number;
  readonly enemyWeakenAmount: number;
  readonly enemyWeakenEveryRound: boolean;
  readonly wreckStabilityBonus: number;
  readonly wreckHullDamageReduction: number;
  readonly bonusSalvagePartsPerWin: number;
  readonly bonusSalvagePartsPerCut: number;
  readonly powerCellBoostedIds: readonly string[];
  /** Active adjacency links ONLY (never includes capped/starved battery links) */
  readonly links: readonly V2AdjacencyLink[];
  /** Capped/starved battery links rendered with distinct visual cue (D03) */
  readonly cappedLinks: readonly V2AdjacencyLink[];
  /** Per-battery supply allocation summary (common cap=1, improved cap=2) */
  readonly batterySupplies: readonly V2BatterySupplySummary[];
  /** Estimated steady per-round single-target summary for quick HUD readout */
  readonly nominalRound1SingleDmg: number;
  readonly totalPlacedBudget: number;
  readonly nonLoanBayValue: number;
}

/**
 * Pure helper detecting active synergy types in `stats.links` that have not yet been discovered.
 */
export function detectNewlyActivatedSynergies(
  stats: Pick<V2BuildStats, 'links'>,
  discoveredSynergies?: readonly string[]
): readonly V2SynergyCatalogEntry[] {
  const known = new Set(discoveredSynergies ?? []);
  const activeIds = new Set<V2SynergyTypeId>();
  for (const lnk of stats.links) {
    if (lnk.status === 'capped') continue;
    if (lnk.synergyId && isV2SynergyTypeId(lnk.synergyId) && !known.has(lnk.synergyId)) {
      activeIds.add(lnk.synergyId);
    }
  }
  if (activeIds.size === 0) return [];
  return V2_SYNERGY_ORDER.filter((id) => activeIds.has(id)).map((id) => V2_SYNERGY_CATALOG[id]);
}

/**
 * Immutably records newly discovered synergy IDs onto `profile.discoveredSynergies`.
 * Returns exact same `profile` reference if nothing new was added.
 */
export function recordV2DiscoveredSynergies(
  profile: V2ProfileState,
  synergyIds: readonly string[]
): V2ProfileState {
  if (synergyIds.length === 0) return profile;
  const existing = profile.discoveredSynergies ?? [];
  const nextSet = new Set<string>(existing);
  let changed = false;
  for (const id of synergyIds) {
    if (isV2SynergyTypeId(id) && !nextSet.has(id)) {
      nextSet.add(id);
      changed = true;
    }
  }
  if (!changed) return profile;
  const ordered = V2_SYNERGY_ORDER.filter((id) => nextSet.has(id));
  return {
    ...profile,
    discoveredSynergies: ordered,
  };
}

function compareQuality(a: V2Quality | null, b: V2Quality): V2Quality {
  if (a === 'improved' || b === 'improved') return 'improved';
  return 'common';
}

export function calculateV2BuildStats(bay: V2CargoBayState): V2BuildStats {
  const ship = V2_SHIPS[bay.shipId];
  const eqItems: {
    placed: V2PlacedItem;
    kind: V2EquipmentKind;
    quality: V2Quality;
    powerBoosted: boolean;
  }[] = [];
  const cargoItems: V2PlacedItem[] = [];

  let totalPlacedBudget = 0;
  let nonLoanBayValue = 0;

  for (const placed of bay.placed) {
    if (placed.item.origin === 'owned' || placed.item.origin === 'loot') {
      nonLoanBayValue += placed.item.fixedValue;
    }
    const def = V2_EQUIPMENT_DEFS[placed.item.definitionId];
    if (def) {
      totalPlacedBudget += getEffectiveV2EquipmentBudgetCost(def, placed.item.origin);
      const powerBoosted = doesV2PlacedItemTouchPowerCell(bay, placed);
      eqItems.push({ placed, kind: def.kind, quality: def.quality, powerBoosted });
    } else if (placed.item.category === 'gadget') {
      const gd = getV3GadgetDef(placed.item.definitionId);
      if (gd) {
        totalPlacedBudget += gd.budgetCost;
      }
    } else if (placed.item.category === 'cargo' || placed.item.category === 'mission') {
      cargoItems.push(placed);
    }
  }

  // Deterministic ordering by instanceId (§8.2)
  eqItems.sort((a, b) => a.placed.item.instanceId.localeCompare(b.placed.item.instanceId));
  cargoItems.sort((a, b) => a.item.instanceId.localeCompare(b.item.instanceId));

  const powerCellBoostedIds = eqItems
    .filter((e) => e.powerBoosted)
    .map((e) => e.placed.item.instanceId);

  const batteries = eqItems.filter((e) => e.kind === 'battery');
  const shields = eqItems.filter((e) => e.kind === 'shield');
  const capacitors = eqItems.filter((e) => e.kind === 'capacitor');
  const relays = eqItems.filter((e) => e.kind === 'relay');
  const counters = eqItems.filter((e) => e.kind === 'counter');
  const coolantRaw = eqItems.filter((e) => e.kind === 'coolant_vent');
  const overdriveRaw = eqItems.filter((e) => e.kind === 'overdrive_core');
  const cargoAmpRaw = eqItems.filter((e) => e.kind === 'cargo_amp');
  const empRaw = eqItems.filter((e) => e.kind === 'emp_jammer');
  const grappleRaw = eqItems.filter((e) => e.kind === 'salvage_grapple');
  const salvoRaw = eqItems.filter((e) => e.kind === 'salvo_pod');

  const links: V2AdjacencyLink[] = [];
  const cappedLinks: V2AdjacencyLink[] = [];

  // Helper: best adjacent overdrive_core for a given weapon
  const findBestOverdrive = (
    targetPlaced: V2PlacedItem,
    targetKind: V2EquipmentKind,
    mode: 'direct' | 'multi'
  ): number => {
    let bestBonus = 0;
    let bestId: string | null = null;
    for (const ov of overdriveRaw) {
      if (areV2PlacedItemsAdjacent(targetPlaced, ov.placed)) {
        const bonus =
          mode === 'direct'
            ? ov.quality === 'improved'
              ? 3
              : 2
            : ov.quality === 'improved'
            ? 2
            : 1;
        if (bonus > bestBonus) {
          bestBonus = bonus;
          bestId = ov.placed.item.instanceId;
        }
      }
    }
    if (bestId && bestBonus > 0) {
      links.push({
        sourceInstanceId: bestId,
        sourceKind: 'overdrive_core',
        targetInstanceId: targetPlaced.item.instanceId,
        targetKind,
        label: mode === 'direct' ? `超频+${bestBonus}` : `超频+${bestBonus}/发`,
        synergyId: 'overdrive_weapon',
        status: 'active',
      });
    }
    return bestBonus;
  };

  // Helper: best adjacent coolant_vent for heavy/salvo
  const findBestCoolantBonus = (
    targetPlaced: V2PlacedItem,
    targetKind: V2EquipmentKind
  ): number => {
    let bestBonus = 0;
    let bestId: string | null = null;
    for (const cv of coolantRaw) {
      if (areV2PlacedItemsAdjacent(targetPlaced, cv.placed)) {
        const bonus = cv.quality === 'improved' ? 3 : 2;
        if (bonus > bestBonus) {
          bestBonus = bonus;
          bestId = cv.placed.item.instanceId;
        }
      }
    }
    if (bestId && bestBonus > 0) {
      links.push({
        sourceInstanceId: bestId,
        sourceKind: 'coolant_vent',
        targetInstanceId: targetPlaced.item.instanceId,
        targetKind,
        label: `排热+${bestBonus}`,
        synergyId: targetKind === 'salvo_pod' ? 'coolant_vent_salvo' : 'coolant_vent_heavy',
        status: 'active',
      });
    }
    return bestBonus;
  };

  // Core attack (base ship + overdrive_core + cargo_amp + support power cell bonuses)
  let coreAttack = ship.coreAttack;

  // Overdrive cores
  const overdriveCores: V2OverdriveCoreComputed[] = [];
  for (const ov of overdriveRaw) {
    const bonus = (ov.quality === 'improved' ? 3 : 2) + (ov.powerBoosted ? 1 : 0);
    coreAttack += bonus;
    overdriveCores.push({
      instanceId: ov.placed.item.instanceId,
      quality: ov.quality,
      coreAttackBonus: bonus,
      directWeaponBonus: ov.quality === 'improved' ? 3 : 2,
      multiHitBonus: ov.quality === 'improved' ? 2 : 1,
    });
  }

  // Cargo amps (base +1/+2 coreAttack + adjacent cargo/mission resonance)
  const cargoAmps: V2CargoAmpComputed[] = [];
  let cargoAmpShieldTotal = 0;
  for (const ca of cargoAmpRaw) {
    let adjCount = 0;
    for (const cg of cargoItems) {
      if (areV2PlacedItemsAdjacent(ca.placed, cg)) {
        adjCount += 1;
        links.push({
          sourceInstanceId: ca.placed.item.instanceId,
          sourceKind: 'cargo_amp',
          targetInstanceId: cg.item.instanceId,
          targetKind: 'cargo',
          label: ca.quality === 'improved' ? '谐振+2' : '谐振+1',
          synergyId: 'cargo_amp_cargo',
          status: 'active',
        });
      }
    }
    const perCargoAtk = ca.quality === 'improved' ? 2 : 1;
    const maxExtraAtk = ca.quality === 'improved' ? 5 : 3;
    const extraAtk = Math.min(maxExtraAtk, adjCount * perCargoAtk);
    const totalCoreBonus = (ca.quality === 'improved' ? 2 : 1) + extraAtk + (ca.powerBoosted ? 1 : 0);
    const shieldBonus = adjCount * (ca.quality === 'improved' ? 3 : 2);
    coreAttack += totalCoreBonus;
    cargoAmpShieldTotal += shieldBonus;
    cargoAmps.push({
      instanceId: ca.placed.item.instanceId,
      quality: ca.quality,
      adjacentCargoCount: adjCount,
      coreAttackBonus: totalCoreBonus,
      shieldBonus,
    });
  }

  // Support modules on power cells grant +1 coreAttack
  for (const sup of [...batteries, ...capacitors, ...relays]) {
    if (sup.powerBoosted) {
      coreAttack += 1;
    }
  }

  // 1. Lasers + capacity-capped battery supply (D03: common cap=1 / improved cap=2, optimal 2-phase Kuhn matching)
  const comparePriority = (
    a: { placed: V2PlacedItem; quality: V2Quality },
    b: { placed: V2PlacedItem; quality: V2Quality }
  ): number => {
    if (a.quality !== b.quality) return a.quality === 'improved' ? -1 : 1;
    if (a.placed.y !== b.placed.y) return a.placed.y - b.placed.y;
    if (a.placed.x !== b.placed.x) return a.placed.x - b.placed.x;
    return a.placed.item.instanceId.localeCompare(b.placed.item.instanceId);
  };

  const laserRaw = eqItems.filter((e) => e.kind === 'laser');
  const lasersByPriority = [...laserRaw].sort(comparePriority);
  const batteriesByPriority = [...batteries].sort(comparePriority);

  interface BatterySlot {
    readonly batteryIdx: number;
    readonly quality: V2Quality;
    readonly bonus: number;
  }
  const batterySlots: BatterySlot[] = [];
  for (let bi = 0; bi < batteriesByPriority.length; bi++) {
    const bat = batteriesByPriority[bi];
    const cap = getBatterySupplyCapacity(bat.quality);
    const bonus = bat.quality === 'improved' ? 3 : 2;
    for (let s = 0; s < cap; s++) {
      batterySlots.push({ batteryIdx: bi, quality: bat.quality, bonus });
    }
  }

  // Adjacency lists from laser priority index -> adjacent battery slot indices (improved slots first)
  const laserAdjSlots: number[][] = lasersByPriority.map((laser) => {
    const slots: number[] = [];
    for (let si = 0; si < batterySlots.length; si++) {
      const bat = batteriesByPriority[batterySlots[si].batteryIdx];
      if (areV2PlacedItemsAdjacent(laser.placed, bat.placed)) {
        slots.push(si);
      }
    }
    return slots;
  });

  const slotOwner: number[] = new Array(batterySlots.length).fill(-1);
  const laserMatchedSlot: number[] = new Array(lasersByPriority.length).fill(-1);

  const tryAugmentLaser = (laserIdx: number, visitedSlots: Uint8Array, improvedOnly: boolean): boolean => {
    for (const si of laserAdjSlots[laserIdx]) {
      if (improvedOnly && batterySlots[si].quality !== 'improved') continue;
      if (visitedSlots[si]) continue;
      visitedSlots[si] = 1;
      const curOwner = slotOwner[si];
      if (curOwner === -1 || tryAugmentLaser(curOwner, visitedSlots, improvedOnly)) {
        slotOwner[si] = laserIdx;
        laserMatchedSlot[laserIdx] = si;
        return true;
      }
    }
    return false;
  };

  // Phase 1: Maximize improved (+3) battery slot matches in laser priority order
  for (let li = 0; li < lasersByPriority.length; li++) {
    const visited = new Uint8Array(batterySlots.length);
    tryAugmentLaser(li, visited, true);
  }
  // Phase 2: Maximize remaining common (+2) battery slot matches via augmenting paths (preserving Phase-1 optimality)
  for (let li = 0; li < lasersByPriority.length; li++) {
    if (laserMatchedSlot[li] !== -1) continue;
    const visited = new Uint8Array(batterySlots.length);
    tryAugmentLaser(li, visited, false);
  }

  const assignedBatteryByLaserId = new Map<string, { readonly batteryId: string; readonly bonus: number }>();
  const suppliedLasersByBatteryId = new Map<string, string[]>();
  for (const bat of batteriesByPriority) {
    suppliedLasersByBatteryId.set(bat.placed.item.instanceId, []);
  }
  for (let li = 0; li < lasersByPriority.length; li++) {
    const si = laserMatchedSlot[li];
    if (si === -1) continue;
    const slot = batterySlots[si];
    const bat = batteriesByPriority[slot.batteryIdx];
    const laser = lasersByPriority[li];
    assignedBatteryByLaserId.set(laser.placed.item.instanceId, {
      batteryId: bat.placed.item.instanceId,
      bonus: slot.bonus,
    });
    suppliedLasersByBatteryId.get(bat.placed.item.instanceId)!.push(laser.placed.item.instanceId);
  }

  const lasers: V2LaserComputed[] = [];
  const starvedLaserIds = new Set<string>();
  for (const l of laserRaw) {
    const assigned = assignedBatteryByLaserId.get(l.placed.item.instanceId);
    const bestBonus = assigned?.bonus ?? 0;
    const bestBatId = assigned?.batteryId ?? null;
    const adjBatteries = batteriesByPriority.filter((b) =>
      areV2PlacedItemsAdjacent(l.placed, b.placed)
    );
    const isCapped = !bestBatId && adjBatteries.length > 0;
    if (bestBatId) {
      links.push({
        sourceInstanceId: bestBatId,
        sourceKind: 'battery',
        targetInstanceId: l.placed.item.instanceId,
        targetKind: 'laser',
        label: `+${bestBonus}`,
        synergyId: 'battery_laser',
        status: 'active',
      });
    } else if (isCapped) {
      starvedLaserIds.add(l.placed.item.instanceId);
      for (const b of adjBatteries) {
        cappedLinks.push({
          sourceInstanceId: b.placed.item.instanceId,
          sourceKind: 'battery',
          targetInstanceId: l.placed.item.instanceId,
          targetKind: 'laser',
          label: '✕ 上限',
          synergyId: 'battery_laser',
          status: 'capped',
        });
      }
    }
    const overdriveBonus = findBestOverdrive(l.placed, 'laser', 'direct');
    const powerCellBonus = l.powerBoosted ? 1 : 0;
    const baseDamage = l.quality === 'improved' ? 4 : 3;
    lasers.push({
      instanceId: l.placed.item.instanceId,
      quality: l.quality,
      baseDamage,
      batteryBonus: bestBonus,
      batterySourceId: bestBatId,
      batteryCapped: isCapped,
      overdriveBonus,
      powerCellBonus,
      totalDamage: baseDamage + bestBonus + overdriveBonus + powerCellBonus,
    });
  }

  const batterySupplies: V2BatterySupplySummary[] = batteries.map((b) => {
    const adjLaserIds = laserRaw
      .filter((l) => areV2PlacedItemsAdjacent(l.placed, b.placed))
      .map((l) => l.placed.item.instanceId);
    const suppliedLaserIds = suppliedLasersByBatteryId.get(b.placed.item.instanceId) ?? [];
    const cappedLaserIds = adjLaserIds.filter((id) => starvedLaserIds.has(id));
    return {
      instanceId: b.placed.item.instanceId,
      quality: b.quality,
      capacity: getBatterySupplyCapacity(b.quality),
      suppliedLaserIds,
      adjacentLaserIds: adjLaserIds,
      cappedLaserIds,
    };
  });

  // 2. Heavy cannons + highest quality adjacent capacitor + coolant_vent + cargo.coolant_tank (D03 cross-category +4) + overdrive + power cell
  const coolantTanks = cargoItems
    .filter((cg) => cg.item.definitionId === 'cargo.coolant_tank')
    .sort((a, b) => {
      if (a.y !== b.y) return a.y - b.y;
      if (a.x !== b.x) return a.x - b.x;
      return a.item.instanceId.localeCompare(b.item.instanceId);
    });

  const heavies: V2HeavyComputed[] = [];
  for (const h of eqItems.filter((e) => e.kind === 'heavy')) {
    let bestCapQ: V2Quality | null = null;
    let bestCapId: string | null = null;
    for (const c of capacitors) {
      if (areV2PlacedItemsAdjacent(h.placed, c.placed)) {
        const nextQ = compareQuality(bestCapQ, c.quality);
        if (nextQ !== bestCapQ) {
          bestCapQ = nextQ;
          bestCapId = c.placed.item.instanceId;
        }
      }
    }
    if (bestCapId && bestCapQ) {
      links.push({
        sourceInstanceId: bestCapId,
        sourceKind: 'capacitor',
        targetInstanceId: h.placed.item.instanceId,
        targetKind: 'heavy',
        label: bestCapQ === 'improved' ? '先手+3' : '先手',
        synergyId: 'capacitor_heavy',
        status: 'active',
      });
    }
    const coolantBonus = findBestCoolantBonus(h.placed, 'heavy');
    const adjCoolantTank = coolantTanks.find((ct) => areV2PlacedItemsAdjacent(h.placed, ct));
    const coolantTankBonus = adjCoolantTank ? 4 : 0;
    const coolantTankLinked = Boolean(adjCoolantTank);
    if (adjCoolantTank) {
      links.push({
        sourceInstanceId: adjCoolantTank.item.instanceId,
        sourceKind: 'cargo',
        targetInstanceId: h.placed.item.instanceId,
        targetKind: 'heavy',
        label: '液冷+4',
        synergyId: 'coolant_heavy',
        status: 'active',
      });
    }
    const overdriveBonus = findBestOverdrive(h.placed, 'heavy', 'direct');
    const powerCellBonus = h.powerBoosted ? 3 : 0;
    heavies.push({
      instanceId: h.placed.item.instanceId,
      quality: h.quality,
      baseDamage:
        (h.quality === 'improved' ? 15 : 12) +
        coolantBonus +
        coolantTankBonus +
        overdriveBonus +
        powerCellBonus,
      capacitorQuality: bestCapQ,
      firesOnOddRounds: bestCapQ !== null,
      firstShotBonus: bestCapQ === 'improved' ? 3 : 0,
      coolantBonus,
      coolantTankBonus,
      coolantTankLinked,
      overdriveBonus,
      powerCellBonus,
    });
  }

  // 3. Drone hangars + highest quality adjacent relay + overdrive + power cell
  const hangars: V2HangarComputed[] = [];
  for (const hg of eqItems.filter((e) => e.kind === 'hangar')) {
    let bestRelQ: V2Quality | null = null;
    let bestRelId: string | null = null;
    for (const r of relays) {
      if (areV2PlacedItemsAdjacent(hg.placed, r.placed)) {
        const nextQ = compareQuality(bestRelQ, r.quality);
        if (nextQ !== bestRelQ) {
          bestRelQ = nextQ;
          bestRelId = r.placed.item.instanceId;
        }
      }
    }
    if (bestRelId && bestRelQ) {
      links.push({
        sourceInstanceId: bestRelId,
        sourceKind: 'relay',
        targetInstanceId: hg.placed.item.instanceId,
        targetKind: 'hangar',
        label: bestRelQ === 'improved' ? '上限4/首+1' : '上限4',
        synergyId: 'relay_hangar',
        status: 'active',
      });
    }
    const overdriveBonus = findBestOverdrive(hg.placed, 'hangar', 'multi');
    const maxDrones = bestRelQ ? 4 : 3;
    const baseR1Bonus = bestRelQ === 'improved' ? 1 : 0;
    const roundOneBonusDrones = Math.min(maxDrones - 1, baseR1Bonus + (hg.powerBoosted ? 1 : 0));
    hangars.push({
      instanceId: hg.placed.item.instanceId,
      quality: hg.quality,
      damagePerDrone: (hg.quality === 'improved' ? 3 : 2) + overdriveBonus,
      relayQuality: bestRelQ,
      maxDrones,
      roundOneBonusDrones,
    });
  }

  // 4. Flak arrays + overdrive + power cell
  const flaks: V2FlakComputed[] = eqItems
    .filter((e) => e.kind === 'flak')
    .map((f) => {
      const overdriveBonus = findBestOverdrive(f.placed, 'flak', 'multi');
      return {
        instanceId: f.placed.item.instanceId,
        quality: f.quality,
        damagePerEnemy: (f.quality === 'improved' ? 3 : 2) + overdriveBonus + (f.powerBoosted ? 1 : 0),
      };
    });

  // 4b. Salvo Pods (3 missiles base; +1 if adjacent to capacitor/relay; +1 if on power cell; +coolant/overdrive)
  const salvos: V2SalvoComputed[] = [];
  for (const sv of salvoRaw) {
    let supportLinked = false;
    for (const sup of [...capacitors, ...relays]) {
      if (areV2PlacedItemsAdjacent(sv.placed, sup.placed)) {
        supportLinked = true;
        links.push({
          sourceInstanceId: sup.placed.item.instanceId,
          sourceKind: sup.kind,
          targetInstanceId: sv.placed.item.instanceId,
          targetKind: 'salvo_pod',
          label: '导弹+1枚',
          synergyId: 'support_salvo',
          status: 'active',
        });
        break;
      }
    }
    const coolantBonus = findBestCoolantBonus(sv.placed, 'salvo_pod');
    const overdriveBonus = findBestOverdrive(sv.placed, 'salvo_pod', 'multi');
    const missiles = 3 + (supportLinked ? 1 : 0) + (sv.powerBoosted ? 1 : 0);
    const damagePerMissile = (sv.quality === 'improved' ? 3 : 2) + overdriveBonus;
    salvos.push({
      instanceId: sv.placed.item.instanceId,
      quality: sv.quality,
      missiles,
      damagePerMissile,
      coolantBonus,
      overdriveBonus,
      powerCellBoosted: sv.powerBoosted,
    });
  }

  // 4c. EMP Jammers
  const empJammers: V2EmpJammerComputed[] = [];
  let empDrainReduction = 0;
  let enemyWeakenAmount = 0;
  let enemyWeakenEveryRound = false;
  for (const ej of empRaw) {
    const overdriveBonus = findBestOverdrive(ej.placed, 'emp_jammer', 'direct');
    const damage = (ej.quality === 'improved' ? 3 : 2) + overdriveBonus + (ej.powerBoosted ? 1 : 0);
    const shieldShred = (ej.quality === 'improved' ? 5 : 3) + (ej.powerBoosted ? 1 : 0);
    const empResist = ej.quality === 'improved' ? 3 : 2;
    const everyRound = ej.quality === 'improved';
    empDrainReduction += empResist;
    enemyWeakenAmount = Math.max(enemyWeakenAmount, 1);
    if (everyRound) enemyWeakenEveryRound = true;
    empJammers.push({
      instanceId: ej.placed.item.instanceId,
      quality: ej.quality,
      damage,
      shieldShred,
      empResist,
      enemyWeakenEveryRound: everyRound,
    });
  }

  // 4d. Salvage Grapples
  const salvageGrapples: V2SalvageGrappleComputed[] = [];
  let wreckStabilityBonus = 0;
  let wreckHullDamageReduction = 0;
  let bonusSalvagePartsPerWin = 0;
  let bonusSalvagePartsPerCut = 0;
  for (const gr of grappleRaw) {
    const overdriveBonus = findBestOverdrive(gr.placed, 'salvage_grapple', 'direct');
    const damage = (gr.quality === 'improved' ? 3 : 2) + overdriveBonus;
    const stabBonus = gr.quality === 'improved' ? 18 : 10;
    const hullRed = gr.quality === 'improved' ? 2 : 1;
    const partsBonus = (gr.quality === 'improved' ? 4 : 2) + (gr.powerBoosted ? 1 : 0);
    wreckStabilityBonus += stabBonus;
    wreckHullDamageReduction += hullRed;
    bonusSalvagePartsPerWin += partsBonus;
    bonusSalvagePartsPerCut += partsBonus;
    salvageGrapples.push({
      instanceId: gr.placed.item.instanceId,
      quality: gr.quality,
      damage,
      wreckStabilityBonus: stabBonus,
      wreckHullReduction: hullRed,
      bonusSalvageParts: partsBonus,
    });
  }

  // 4e. Coolant Vents
  const coolantVents: V2CoolantVentComputed[] = [];
  let coolantShieldTotal = 0;
  let endOfRoundShieldRegen = 0;
  let cryoDrainReduction = 0;
  for (const cv of coolantRaw) {
    const shieldBonus = cv.quality === 'improved' ? 6 : 4;
    const regen = (cv.quality === 'improved' ? 2 : 1) + (cv.powerBoosted ? 1 : 0);
    const cryoResist = cv.quality === 'improved' ? 2 : 1;
    coolantShieldTotal += shieldBonus;
    endOfRoundShieldRegen += regen;
    cryoDrainReduction += cryoResist;
    coolantVents.push({
      instanceId: cv.placed.item.instanceId,
      quality: cv.quality,
      shieldBonus,
      endOfRoundShieldRegen: regen,
      cryoResist,
    });
  }

  // 5. Shields (strictly capped at V2_MAX_BATTLE_SHIELD = 20!)
  let rawShield = ship.bonusShield + coolantShieldTotal + cargoAmpShieldTotal;
  for (const s of shields) {
    rawShield += (s.quality === 'improved' ? 8 : 6) + (s.powerBoosted ? 2 : 0);
  }
  for (const ct of counters) {
    rawShield += (ct.quality === 'improved' ? 5 : 4) + (ct.powerBoosted ? 1 : 0);
  }
  const effectiveShield = Math.min(V2_MAX_BATTLE_SHIELD, rawShield);

  // 6. Active Counters (must be adjacent to at least one Shield; ship-wide highest quality fires ONCE/round)
  const activeCounters: V2CounterComputed[] = [];
  for (const ct of counters) {
    const adjShield = shields.find((s) => areV2PlacedItemsAdjacent(ct.placed, s.placed));
    if (adjShield) {
      links.push({
        sourceInstanceId: adjShield.placed.item.instanceId,
        sourceKind: 'shield',
        targetInstanceId: ct.placed.item.instanceId,
        targetKind: 'counter',
        label: ct.quality === 'improved' ? '反75%' : '反50%',
        synergyId: 'shield_counter',
        status: 'active',
      });
      activeCounters.push({
        instanceId: ct.placed.item.instanceId,
        quality: ct.quality,
        ratio: ct.quality === 'improved' ? 0.75 : 0.5,
        maxDamage: (ct.quality === 'improved' ? 5 : 4) + (ct.powerBoosted ? 1 : 0),
      });
    }
  }
  let bestActiveCounter: V2CounterComputed | null = null;
  for (const ct of activeCounters) {
    if (
      !bestActiveCounter ||
      (ct.quality === 'improved' && bestActiveCounter.quality !== 'improved') ||
      (ct.quality === bestActiveCounter.quality && ct.maxDamage > bestActiveCounter.maxDamage)
    ) {
      bestActiveCounter = ct;
    }
  }

  // 7. Repair drones (strictly capped at V2_MAX_POST_WIN_REPAIR = 4!)
  let rawRepair = 0;
  for (const rp of eqItems.filter((e) => e.kind === 'repair')) {
    rawRepair += (rp.quality === 'improved' ? 3 : 2) + (rp.powerBoosted ? 1 : 0);
  }
  const effectiveRepair = Math.min(V2_MAX_POST_WIN_REPAIR, rawRepair);

  // Round 1 nominal single-target damage estimate for HUD
  let nominalRound1SingleDmg = coreAttack;
  for (const l of lasers) nominalRound1SingleDmg += l.totalDamage;
  for (const h of heavies) {
    if (h.firesOnOddRounds) nominalRound1SingleDmg += h.baseDamage + h.firstShotBonus;
  }
  for (const hg of hangars) {
    const r1Drones = Math.min(hg.maxDrones, 1 + hg.roundOneBonusDrones);
    nominalRound1SingleDmg += r1Drones * hg.damagePerDrone;
  }
  for (const sv of salvos) {
    nominalRound1SingleDmg += sv.missiles * sv.damagePerMissile + sv.coolantBonus;
  }
  for (const ej of empJammers) nominalRound1SingleDmg += ej.damage;
  for (const gr of salvageGrapples) nominalRound1SingleDmg += gr.damage;
  for (const f of flaks) nominalRound1SingleDmg += f.damagePerEnemy;

  return {
    coreAttack,
    hullBonusShield: ship.bonusShield,
    rawShield,
    effectiveShield,
    shieldCapped: rawShield > V2_MAX_BATTLE_SHIELD,
    rawRepair,
    effectiveRepair,
    repairCapped: rawRepair > V2_MAX_POST_WIN_REPAIR,
    lasers,
    heavies,
    hangars,
    flaks,
    salvos,
    empJammers,
    coolantVents,
    overdriveCores,
    cargoAmps,
    salvageGrapples,
    activeCounters,
    bestActiveCounter,
    endOfRoundShieldRegen,
    cryoDrainReduction,
    empDrainReduction,
    enemyWeakenAmount,
    enemyWeakenEveryRound,
    wreckStabilityBonus,
    wreckHullDamageReduction,
    bonusSalvagePartsPerWin,
    bonusSalvagePartsPerCut,
    powerCellBoostedIds,
    links,
    cappedLinks,
    batterySupplies,
    nominalRound1SingleDmg,
    totalPlacedBudget,
    nonLoanBayValue,
  };
}

export interface V2RewardSynergyMatch {
  readonly synergyId: V2SynergyTypeId;
  readonly synergyName: string;
  readonly badgeLabel: string;
  readonly partnerInstanceIds: readonly string[];
  readonly partnerNames: readonly string[];
  readonly partnerDefIds: readonly string[];
  readonly isCrossCategory: boolean;
  readonly batteryCappedWarning?: boolean;
}

export interface V2RewardSynergyEvaluation {
  readonly rewardDefId: string;
  readonly rewardKind: V2EquipmentKind | null;
  readonly hasSynergy: boolean;
  readonly matches: readonly V2RewardSynergyMatch[];
  readonly primaryBadgeText: string | null;
  readonly summaryText: string;
  readonly suggestedPartnerHint: string | null;
}

const OVERDRIVE_WEAPON_KINDS: ReadonlySet<V2EquipmentKind> = new Set([
  'laser',
  'heavy',
  'hangar',
  'flak',
  'salvo_pod',
  'emp_jammer',
  'salvage_grapple',
]);

const SUGGESTED_PARTNER_HINT_BY_KIND: Readonly<Partial<Record<V2EquipmentKind, string>>> = {
  laser: '能量电池 / 超频核心',
  battery: '激光炮',
  heavy: '蓄能器 / 冷却罐 / 排热阀',
  capacitor: '磁轨重炮 / 齐射导弹舱',
  hangar: '编队中继 / 超频核心',
  relay: '无人机库 / 齐射导弹舱',
  shield: '反击器',
  counter: '护盾板',
  flak: '超频核心',
  coolant_vent: '磁轨重炮 / 齐射导弹舱',
  cargo_amp: '任意货物 / 任务货',
  emp_jammer: '超频核心',
  overdrive_core: '任意武器模块',
  salvage_grapple: '超频核心',
  salvo_pod: '蓄能器 / 编队中继 / 排热阀',
};

function getPlacedDisplayName(placed: V2PlacedItem): string {
  const eqDef = V2_EQUIPMENT_DEFS[placed.item.definitionId];
  if (eqDef) return eqDef.name;
  if (placed.item.definitionId === 'cargo.coolant_tank') return '冷却罐';
  if (placed.item.definitionId === 'mission.sealed_reactor') return '密封反应堆';
  if (placed.item.definitionId === 'mission.escape_pod') return '救援救生舱';
  if (placed.item.definitionId === 'mission.black_box') return '加密黑匣记录仪';
  if (placed.item.definitionId === 'cargo.old_engine') return '旧引擎';
  if (placed.item.definitionId === 'cargo.folding_antenna') return '折叠天线';
  if (placed.item.definitionId === 'cargo.alloy_bar') return '合金条';
  if (placed.item.definitionId === 'cargo.data_box') return '数据盒';
  if (placed.item.definitionId === 'cargo.ancient_navigator') return '古代导航仪';
  if (placed.item.definitionId === 'cargo.quantum_core') return '量子星核';
  if (placed.item.definitionId === 'cargo.cryo_amber') return '星渊琥珀匣';
  if (placed.item.definitionId === 'cargo.obsidian_crown') return '黑曜舰桥冠徽';
  return placed.item.definitionId;
}

/**
 * Pure D07 live-bay synergy evaluator for post-combat 3-equipment rewards.
 * Covers all 10 verified V2SynergyTypeId rules in canonical V2_SYNERGY_ORDER,
 * including battery supply capacity checks (D03) and cargo.coolant_tank <-> heavy!
 */
export function evaluateV2RewardSynergies(
  bay: V2CargoBayState,
  rewardEquipmentDefId: string
): V2RewardSynergyEvaluation {
  const rewardDef = V2_EQUIPMENT_DEFS[rewardEquipmentDefId];
  if (!rewardDef) {
    return {
      rewardDefId: rewardEquipmentDefId,
      rewardKind: null,
      hasSynergy: false,
      matches: [],
      primaryBadgeText: null,
      summaryText: '独立组件',
      suggestedPartnerHint: null,
    };
  }

  const kind = rewardDef.kind;
  const sortedPlaced = [...bay.placed].sort((a, b) =>
    a.item.instanceId.localeCompare(b.item.instanceId)
  );
  const stats = calculateV2BuildStats(bay);

  const bySynergy = new Map<
    V2SynergyTypeId,
    {
      partners: V2PlacedItem[];
      batteryCappedWarning?: boolean;
      customBadge?: string;
    }
  >();

  const addMatch = (
    synergyId: V2SynergyTypeId,
    partners: V2PlacedItem[],
    opts?: { batteryCappedWarning?: boolean; customBadge?: string }
  ) => {
    if (partners.length === 0) return;
    const existing = bySynergy.get(synergyId);
    if (!existing) {
      bySynergy.set(synergyId, {
        partners: [...partners],
        batteryCappedWarning: opts?.batteryCappedWarning,
        customBadge: opts?.customBadge,
      });
    } else {
      const seenIds = new Set(existing.partners.map((p) => p.item.instanceId));
      for (const p of partners) {
        if (!seenIds.has(p.item.instanceId)) {
          existing.partners.push(p);
          seenIds.add(p.item.instanceId);
        }
      }
      if (opts?.batteryCappedWarning) existing.batteryCappedWarning = true;
      if (opts?.customBadge) existing.customBadge = opts.customBadge;
    }
  };

  const placedByEqKind = (eqKind: V2EquipmentKind): V2PlacedItem[] =>
    sortedPlaced.filter(
      (p) =>
        p.item.category === 'equipment' &&
        V2_EQUIPMENT_DEFS[p.item.definitionId]?.kind === eqKind
    );

  // 1. battery_laser (with D03 battery capacity awareness!)
  if (kind === 'battery') {
    const lasers = placedByEqKind('laser');
    if (lasers.length > 0) {
      const hasUnsupplied = stats.lasers.some((l) => l.batteryBonus === 0);
      const cap = getBatterySupplyCapacity(rewardDef.quality);
      addMatch('battery_laser', lasers, {
        customBadge: hasUnsupplied
          ? `可联「激光炮」· 供能≤${cap}门`
          : `可联「激光炮」· 增配供能(+${rewardDef.quality === 'improved' ? 3 : 2})`,
      });
    }
  } else if (kind === 'laser') {
    const batteries = placedByEqKind('battery');
    if (batteries.length > 0) {
      const hasSpareCapacity = stats.batterySupplies.some(
        (b) => b.suppliedLaserIds.length < b.capacity
      );
      addMatch('battery_laser', batteries, {
        batteryCappedWarning: !hasSpareCapacity,
        customBadge: hasSpareCapacity
          ? '可联「能量电池」· 尚有供能余量'
          : '可联「能量电池」（现有电池已满载）',
      });
    }
  }

  // 2. coolant_heavy (cross-category: cargo.coolant_tank <-> heavy)
  if (kind === 'heavy') {
    const coolants = sortedPlaced.filter(
      (p) => p.item.definitionId === 'cargo.coolant_tank'
    );
    if (coolants.length > 0) {
      addMatch('coolant_heavy', coolants, {
        customBadge: '跨类联「冷却罐」· +4 伤',
      });
    }
  }

  // 3. capacitor_heavy
  if (kind === 'capacitor') {
    addMatch('capacitor_heavy', placedByEqKind('heavy'), {
      customBadge: '可联「磁轨重炮」· 首轮先手开火',
    });
  } else if (kind === 'heavy') {
    addMatch('capacitor_heavy', placedByEqKind('capacitor'), {
      customBadge: '可联「蓄能器」· 首轮先手开火',
    });
  }

  // 4. relay_hangar
  if (kind === 'relay') {
    addMatch('relay_hangar', placedByEqKind('hangar'), {
      customBadge: '可联「无人机库」· 上限 3→4 架',
    });
  } else if (kind === 'hangar') {
    addMatch('relay_hangar', placedByEqKind('relay'), {
      customBadge: '可联「编队中继」· 上限 3→4 架',
    });
  }

  // 5. shield_counter
  if (kind === 'shield') {
    addMatch('shield_counter', placedByEqKind('counter'), {
      customBadge: '可联「反击器」· 激活护盾反击',
    });
  } else if (kind === 'counter') {
    addMatch('shield_counter', placedByEqKind('shield'), {
      customBadge: '可联「护盾板」· 激活护盾反击',
    });
  }

  // 6. coolant_vent_heavy
  if (kind === 'coolant_vent') {
    addMatch('coolant_vent_heavy', placedByEqKind('heavy'), {
      customBadge: '可联「磁轨重炮」· 每发 +2/+3 伤',
    });
  } else if (kind === 'heavy') {
    addMatch('coolant_vent_heavy', placedByEqKind('coolant_vent'), {
      customBadge: '可联「冷却排热阀」· 每发 +2/+3 伤',
    });
  }

  // 7. coolant_vent_salvo
  if (kind === 'coolant_vent') {
    addMatch('coolant_vent_salvo', placedByEqKind('salvo_pod'), {
      customBadge: '可联「齐射导弹舱」· 首弹 +2/+3 伤',
    });
  } else if (kind === 'salvo_pod') {
    addMatch('coolant_vent_salvo', placedByEqKind('coolant_vent'), {
      customBadge: '可联「冷却排热阀」· 首弹 +2/+3 伤',
    });
  }

  // 8. support_salvo (capacitor | relay <-> salvo_pod)
  if (kind === 'capacitor' || kind === 'relay') {
    addMatch('support_salvo', placedByEqKind('salvo_pod'), {
      customBadge: '可联「齐射导弹舱」· 导弹 +1 枚/轮',
    });
  } else if (kind === 'salvo_pod') {
    const supports = [...placedByEqKind('capacitor'), ...placedByEqKind('relay')];
    addMatch('support_salvo', supports, {
      customBadge: '可联「蓄能器/中继」· 导弹 +1 枚/轮',
    });
  }

  // 9. overdrive_weapon
  if (kind === 'overdrive_core') {
    const weapons = sortedPlaced.filter((p) => {
      const def = V2_EQUIPMENT_DEFS[p.item.definitionId];
      return Boolean(def && OVERDRIVE_WEAPON_KINDS.has(def.kind));
    });
    if (weapons.length > 0) {
      const names = Array.from(new Set(weapons.map(getPlacedDisplayName)));
      addMatch('overdrive_weapon', weapons, {
        customBadge: `可联「${names.slice(0, 2).join('/')}」· 超频增伤`,
      });
    }
  } else if (OVERDRIVE_WEAPON_KINDS.has(kind)) {
    addMatch('overdrive_weapon', placedByEqKind('overdrive_core'), {
      customBadge: '可联「超频核心」· 超频增伤',
    });
  }

  // 10. cargo_amp_cargo (cross-category: cargo_amp <-> any placed cargo/mission)
  if (kind === 'cargo_amp') {
    const cargos = sortedPlaced.filter(
      (p) => p.item.category === 'cargo' || p.item.category === 'mission'
    );
    if (cargos.length > 0) {
      const names = Array.from(new Set(cargos.map(getPlacedDisplayName)));
      const head = names.slice(0, 2).join('/');
      addMatch('cargo_amp_cargo', cargos, {
        customBadge: `跨类联「${head}」${names.length > 2 ? '等' : ''}· 核攻/护盾+`,
      });
    }
  }

  const matches: V2RewardSynergyMatch[] = [];
  for (const synergyId of V2_SYNERGY_ORDER) {
    const hit = bySynergy.get(synergyId);
    if (!hit) continue;
    const cat = V2_SYNERGY_CATALOG[synergyId];
    const partnerInstanceIds = hit.partners.map((p) => p.item.instanceId);
    const partnerDefIds = hit.partners.map((p) => p.item.definitionId);
    const partnerNames = Array.from(new Set(hit.partners.map(getPlacedDisplayName)));
    matches.push({
      synergyId,
      synergyName: cat.name,
      badgeLabel: hit.customBadge ?? `可联「${partnerNames[0]}」· ${cat.name}`,
      partnerInstanceIds,
      partnerNames,
      partnerDefIds,
      isCrossCategory: Boolean(cat.isCrossCategory),
      ...(hit.batteryCappedWarning ? { batteryCappedWarning: true } : {}),
    });
  }

  const hasSynergy = matches.length > 0;
  const primaryBadgeText = matches[0]?.badgeLabel ?? null;
  const suggestedPartnerHint = SUGGESTED_PARTNER_HINT_BY_KIND[kind] ?? null;
  const summaryText = hasSynergy
    ? matches.map((m) => m.badgeLabel).join('；')
    : suggestedPartnerHint
    ? `独立组件（可配对：${suggestedPartnerHint}）`
    : '独立组件（即装即用）';

  return {
    rewardDefId: rewardEquipmentDefId,
    rewardKind: kind,
    hasSynergy,
    matches,
    primaryBadgeText,
    summaryText,
    suggestedPartnerHint,
  };
}


