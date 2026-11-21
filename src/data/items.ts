import { SHAPES, type ShapeId } from './shapes';

export type ItemCategory = 'equipment' | 'cargo';
export type EquipmentKind = 'laser' | 'battery' | 'shield' | 'drone';
export type EquipmentQuality = 'common' | 'improved';
export type CargoKind =
  | 'data_box'
  | 'alloy_bar'
  | 'coolant_tank'
  | 'old_engine'
  | 'folding_antenna'
  | 'ancient_navigator';

export type LoadoutId = 'cannon_skiff' | 'shield_cruiser';

export interface ShipCoreSpec {
  readonly maxHp: number;
  readonly baseAttack: number;
  readonly maxShield: number;
  readonly maxRepairPerCombat: number;
  readonly repairRewardAmount: number;
}

export const SHIP_CORE: ShipCoreSpec = {
  maxHp: 30,
  baseAttack: 4,
  maxShield: 18,
  maxRepairPerCombat: 4,
  repairRewardAmount: 12,
};

export interface EquipmentDefinition {
  readonly defId: string; // stable runtime key e.g. equipment.laser.common
  readonly category: 'equipment';
  readonly kind: EquipmentKind;
  readonly quality: EquipmentQuality;
  readonly name: string;
  readonly qualityLabel: string;
  readonly shapeId: ShapeId;
  readonly attackBonus: number;
  readonly adjacentLaserBonus: number;
  readonly shieldBonus: number;
  readonly postVictoryRepair: number;
  readonly recycleValue: number;
  readonly summary: string;
  readonly detail: string;
}

export interface CargoDefinition {
  readonly defId: string; // stable runtime key e.g. cargo.data_box
  readonly category: 'cargo';
  readonly kind: CargoKind;
  readonly name: string;
  readonly shapeId: ShapeId;
  readonly valueCoeff: number;
  readonly isCollectible: boolean;
  readonly summary: string;
  readonly detail: string;
}

export type ItemDefinition = EquipmentDefinition | CargoDefinition;

export const EQUIPMENT_KINDS: readonly EquipmentKind[] = [
  'laser',
  'battery',
  'shield',
  'drone',
];

export const CARGO_KINDS: readonly CargoKind[] = [
  'data_box',
  'alloy_bar',
  'coolant_tank',
  'old_engine',
  'folding_antenna',
  'ancient_navigator',
];

export const EQUIPMENT_DEFINITIONS: Record<string, EquipmentDefinition> = {
  'equipment.laser.common': {
    defId: 'equipment.laser.common',
    category: 'equipment',
    kind: 'laser',
    quality: 'common',
    name: '激光炮',
    qualityLabel: '普通',
    shapeId: '1x2',
    attackBonus: 3,
    adjacentLaserBonus: 0,
    shieldBonus: 0,
    postVictoryRepair: 0,
    recycleValue: 8,
    summary: '攻击 +3',
    detail: '基础舰载激光模块，所有激光炮火力直接相加。',
  },
  'equipment.laser.improved': {
    defId: 'equipment.laser.improved',
    category: 'equipment',
    kind: 'laser',
    quality: 'improved',
    name: '激光炮',
    qualityLabel: '优良',
    shapeId: '1x2',
    attackBonus: 5,
    adjacentLaserBonus: 0,
    shieldBonus: 0,
    postVictoryRepair: 0,
    recycleValue: 16,
    summary: '攻击 +5',
    detail: '加装双散热片与聚焦线圈的高出力激光炮，火力直接相加。',
  },
  'equipment.battery.common': {
    defId: 'equipment.battery.common',
    category: 'equipment',
    kind: 'battery',
    quality: 'common',
    name: '能量电池',
    qualityLabel: '普通',
    shapeId: '1x1',
    attackBonus: 0,
    adjacentLaserBonus: 2,
    shieldBonus: 0,
    postVictoryRepair: 0,
    recycleValue: 6,
    summary: '相邻炮攻击 +2',
    detail: '正交贴邻每门激光炮攻击 +2；同一门炮仅取相邻电池最高值，斜角不生效。',
  },
  'equipment.battery.improved': {
    defId: 'equipment.battery.improved',
    category: 'equipment',
    kind: 'battery',
    quality: 'improved',
    name: '能量电池',
    qualityLabel: '优良',
    shapeId: '1x1',
    attackBonus: 0,
    adjacentLaserBonus: 3,
    shieldBonus: 0,
    postVictoryRepair: 0,
    recycleValue: 12,
    summary: '相邻炮攻击 +3',
    detail: '高密度双电芯电容，正交贴邻每门激光炮攻击 +3；可同时增益多门炮。',
  },
  'equipment.shield.common': {
    defId: 'equipment.shield.common',
    category: 'equipment',
    kind: 'shield',
    quality: 'common',
    name: '护盾板',
    qualityLabel: '普通',
    shapeId: '1x2',
    attackBonus: 0,
    adjacentLaserBonus: 0,
    shieldBonus: 6,
    postVictoryRepair: 0,
    recycleValue: 8,
    summary: '每战护盾 +6',
    detail: '每场战斗开始重新生成 6 点护盾；总护盾上限 18。',
  },
  'equipment.shield.improved': {
    defId: 'equipment.shield.improved',
    category: 'equipment',
    kind: 'shield',
    quality: 'improved',
    name: '护盾板',
    qualityLabel: '优良',
    shapeId: '1x2',
    attackBonus: 0,
    adjacentLaserBonus: 0,
    shieldBonus: 9,
    postVictoryRepair: 0,
    recycleValue: 16,
    summary: '每战护盾 +9',
    detail: '叠层复合场发生器，每战生成 9 点护盾；总护盾上限 18。',
  },
  'equipment.drone.common': {
    defId: 'equipment.drone.common',
    category: 'equipment',
    kind: 'drone',
    quality: 'common',
    name: '维修无人机',
    qualityLabel: '普通',
    shapeId: 'L3',
    attackBonus: 0,
    adjacentLaserBonus: 0,
    shieldBonus: 0,
    postVictoryRepair: 2,
    recycleValue: 10,
    summary: '胜后修 +2 耐久',
    detail: '每场获胜后恢复 2 点耐久（每战总上限 4，战败不触发）。',
  },
  'equipment.drone.improved': {
    defId: 'equipment.drone.improved',
    category: 'equipment',
    kind: 'drone',
    quality: 'improved',
    name: '维修无人机',
    qualityLabel: '优良',
    shapeId: 'L3',
    attackBonus: 0,
    adjacentLaserBonus: 0,
    shieldBonus: 0,
    postVictoryRepair: 3,
    recycleValue: 20,
    summary: '胜后修 +3 耐久',
    detail: '双机械焊臂精修机，每场获胜后恢复 3 点耐久（每战总上限 4）。',
  },
};

export const CARGO_DEFINITIONS: Record<string, CargoDefinition> = {
  'cargo.data_box': {
    defId: 'cargo.data_box',
    category: 'cargo',
    kind: 'data_box',
    name: '数据盒',
    shapeId: '1x1',
    valueCoeff: 1.2,
    isCollectible: false,
    summary: '小巧高密货物',
    detail: '密封航行黑匣子，体积小巧易于填补船舱空隙，无战斗加成。',
  },
  'cargo.alloy_bar': {
    defId: 'cargo.alloy_bar',
    category: 'cargo',
    kind: 'alloy_bar',
    name: '合金条',
    shapeId: '1x2',
    valueCoeff: 1.0,
    isCollectible: false,
    summary: '标准船材货物',
    detail: '成捆回收的工业级钛铝合金条，报价稳定，无战斗加成。',
  },
  'cargo.coolant_tank': {
    defId: 'cargo.coolant_tank',
    category: 'cargo',
    kind: 'coolant_tank',
    name: '冷却罐',
    shapeId: '1x3',
    valueCoeff: 1.15,
    isCollectible: false,
    summary: '修长高值货物',
    detail: '加压循环冷却罐，需要整排三格空间，单价较高，无战斗加成。',
  },
  'cargo.old_engine': {
    defId: 'cargo.old_engine',
    category: 'cargo',
    kind: 'old_engine',
    name: '旧引擎',
    shapeId: '2x2',
    valueCoeff: 0.9,
    isCollectible: false,
    summary: '大体积高总价',
    detail: '整块拆下的推进机组，占据 2×2 大块空间但总价可观，无战斗加成。',
  },
  'cargo.folding_antenna': {
    defId: 'cargo.folding_antenna',
    category: 'cargo',
    kind: 'folding_antenna',
    name: '折叠天线',
    shapeId: 'L3',
    valueCoeff: 1.2,
    isCollectible: false,
    summary: 'L形高密异形货',
    detail: '折弯态深空通信阵列，异形难摆但每格价值可观，无战斗加成。',
  },
  'cargo.ancient_navigator': {
    defId: 'cargo.ancient_navigator',
    category: 'cargo',
    kind: 'ancient_navigator',
    name: '古代导航仪',
    shapeId: 'T4',
    valueCoeff: 1.35,
    isCollectible: true,
    summary: '稀有废宝 · 可收藏',
    detail: '带有独特环形星图核心的古老导航仪。安全返航后可高价卖出，或留存至基地收藏展台修复。',
  },
};

export const ALL_ITEM_DEFINITIONS: Record<string, ItemDefinition> = {
  ...EQUIPMENT_DEFINITIONS,
  ...CARGO_DEFINITIONS,
};

export function getEquipmentDef(kind: EquipmentKind, quality: EquipmentQuality): EquipmentDefinition {
  return EQUIPMENT_DEFINITIONS[`equipment.${kind}.${quality}`];
}

export function getCargoDef(kind: CargoKind): CargoDefinition {
  return CARGO_DEFINITIONS[`cargo.${kind}`];
}

export function getItemDef(defId: string): ItemDefinition {
  const def = ALL_ITEM_DEFINITIONS[defId];
  if (!def) {
    throw new Error(`Unknown item definition: ${defId}`);
  }
  return def;
}

export function getItemCellCount(defId: string): number {
  const def = getItemDef(defId);
  return SHAPES[def.shapeId].cells.length;
}

export interface LoadoutDefinition {
  readonly id: LoadoutId;
  readonly name: string;
  readonly subtitle: string;
  readonly description: string;
  readonly starterDefId: string;
  readonly starterOrigin: { readonly x: number; readonly y: number };
  readonly unlockBuildingId: string | null;
}

export const LOADOUTS: Record<LoadoutId, LoadoutDefinition> = {
  cannon_skiff: {
    id: 'cannon_skiff',
    name: '标准炮艇',
    subtitle: '初始攻 7 · 盾 0',
    description: '借用 1 门普通激光炮，前期清理更快，适合稳步压低交火轮数。',
    starterDefId: 'equipment.laser.common',
    starterOrigin: { x: 1, y: 1 },
    unlockBuildingId: null,
  },
  shield_cruiser: {
    id: 'shield_cruiser',
    name: '护盾工程艇',
    subtitle: '初始攻 4 · 盾 6',
    description: '借用 1 块普通护盾板，每战自动抵挡 6 点伤害，容错更稳、续航更强。',
    starterDefId: 'equipment.shield.common',
    starterOrigin: { x: 1, y: 1 },
    unlockBuildingId: 'drydock',
  },
};
