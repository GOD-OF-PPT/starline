import type { V2ShapeId } from './shapes';

export type V2EquipmentKind =
  | 'laser'
  | 'battery'
  | 'shield'
  | 'repair'
  | 'heavy'
  | 'capacitor'
  | 'hangar'
  | 'relay'
  | 'counter'
  | 'flak'
  | 'coolant_vent'
  | 'cargo_amp'
  | 'emp_jammer'
  | 'overdrive_core'
  | 'salvage_grapple'
  | 'salvo_pod';

export type V2Quality = 'common' | 'improved';

export type V2ArchetypeId = 'laser' | 'heavy' | 'hangar' | 'counter';

export type V2UnlockFamilyId = 'core' | 'heavy_kit' | 'hangar_kit' | 'counter_kit';

export interface V2EquipmentDef {
  readonly defId: string;
  readonly kind: V2EquipmentKind;
  readonly quality: V2Quality;
  readonly name: string;
  readonly shortName: string;
  readonly shapeId: V2ShapeId;
  readonly budgetCost: number;
  readonly recycleValue: number;
  readonly shopBuyPrice: number;
  readonly craftCost: number;
  readonly family: V2UnlockFamilyId;
  readonly summary: string;
  readonly badgeStat: string;
}

export const V2_MAX_BATTLE_SHIELD = 20;
export const V2_MAX_POST_WIN_REPAIR = 4;
export const V2_RESEARCH_COST_CREDITS = 30;
export const V2_WAREHOUSE_CAPACITY = 12;

export const V2_INITIAL_BLUEPRINTS: readonly V2EquipmentKind[] = [
  'laser',
  'battery',
  'shield',
  'repair',
];

/** Ordered family unlocks for 1st, 2nd, and 3rd distinct standard contract completions (§10.4) */
export interface V2FamilyUnlockReward {
  readonly family: V2UnlockFamilyId;
  readonly name: string;
  readonly unlockedKinds: readonly V2EquipmentKind[];
  readonly freeBlueprintKind: V2EquipmentKind;
  readonly giftMainKind: V2EquipmentKind;
}

export const V2_CONTRACT_FAMILY_UNLOCK_ORDER: readonly V2FamilyUnlockReward[] = [
  {
    family: 'heavy_kit',
    name: '重炮爆发体系',
    unlockedKinds: ['heavy', 'capacitor', 'coolant_vent', 'overdrive_core'],
    freeBlueprintKind: 'capacitor',
    giftMainKind: 'heavy',
  },
  {
    family: 'hangar_kit',
    name: '无人机编队体系',
    unlockedKinds: ['hangar', 'relay', 'salvo_pod'],
    freeBlueprintKind: 'relay',
    giftMainKind: 'hangar',
  },
  {
    family: 'counter_kit',
    name: '护盾反击与防空体系',
    unlockedKinds: ['counter', 'flak', 'emp_jammer'],
    freeBlueprintKind: 'flak',
    giftMainKind: 'counter',
  },
];

/** Guaranteed support part in Layers 2-4 matching run's primary archetype (§9) */
export const V2_ARCHETYPE_SUPPORT_PART: Record<V2ArchetypeId, V2EquipmentKind> = {
  laser: 'battery',
  heavy: 'capacitor',
  hangar: 'relay',
  counter: 'shield',
};

export const V2_ARCHETYPE_LABELS: Record<V2ArchetypeId, { readonly name: string; readonly supportName: string }> = {
  laser: { name: '激光压制', supportName: '能量电池' },
  heavy: { name: '重炮爆发', supportName: '蓄能器' },
  hangar: { name: '无人机编队', supportName: '编队中继' },
  counter: { name: '护盾反击', supportName: '护盾板' },
};

export const V2_ALL_EQUIPMENT_KINDS: readonly V2EquipmentKind[] = [
  'laser',
  'battery',
  'shield',
  'repair',
  'heavy',
  'capacitor',
  'hangar',
  'relay',
  'counter',
  'flak',
  'coolant_vent',
  'cargo_amp',
  'emp_jammer',
  'overdrive_core',
  'salvage_grapple',
  'salvo_pod',
];

interface BaseEquipmentSpec {
  readonly kind: V2EquipmentKind;
  readonly name: string;
  readonly shortName: string;
  readonly shapeId: V2ShapeId;
  readonly commonBudget: number;
  readonly commonRecycle: number;
  readonly family: V2UnlockFamilyId;
  readonly commonSummary: string;
  readonly improvedSummary: string;
  readonly commonBadge: string;
  readonly improvedBadge: string;
}

const BASE_SPECS: readonly BaseEquipmentSpec[] = [
  {
    kind: 'laser',
    name: '激光炮',
    shortName: '激光',
    shapeId: '1x2',
    commonBudget: 2,
    commonRecycle: 10,
    family: 'core',
    commonSummary: '每轮单体伤害 3；贴邻能量电池每轮额外增伤',
    improvedSummary: '每轮单体伤害 4；贴邻能量电池每轮额外增伤',
    commonBadge: '单3',
    improvedBadge: '单4',
  },
  {
    kind: 'battery',
    name: '能量电池',
    shortName: '电池',
    shapeId: '1x1',
    commonBudget: 1,
    commonRecycle: 8,
    family: 'core',
    commonSummary: '正交相邻激光炮每轮 +2（同炮取最高电池）',
    improvedSummary: '正交相邻激光炮每轮 +3（同炮取最高电池）',
    commonBadge: '炮+2',
    improvedBadge: '炮+3',
  },
  {
    kind: 'shield',
    name: '护盾板',
    shortName: '护盾',
    shapeId: '1x2',
    commonBudget: 2,
    commonRecycle: 10,
    family: 'core',
    commonSummary: '每战初始护盾 +6（总护盾上限 20）；激活相邻反击器',
    improvedSummary: '每战初始护盾 +8（总护盾上限 20）；激活相邻反击器',
    commonBadge: '盾+6',
    improvedBadge: '盾+8',
  },
  {
    kind: 'repair',
    name: '维修无人机',
    shortName: '维修',
    shapeId: 'L3',
    commonBudget: 2,
    commonRecycle: 14,
    family: 'core',
    commonSummary: '战斗胜利后修复 2 耐久（每战上限 4）',
    improvedSummary: '战斗胜利后修复 3 耐久（每战上限 4）',
    commonBadge: '修+2',
    improvedBadge: '修+3',
  },
  {
    kind: 'heavy',
    name: '重炮',
    shortName: '重炮',
    shapeId: '1x3',
    commonBudget: 3,
    commonRecycle: 20,
    family: 'heavy_kit',
    commonSummary: '第 2、4、6…轮单体 12（贴邻蓄能器改为 1、3、5…轮）',
    improvedSummary: '第 2、4、6…轮单体 15（贴邻蓄能器改为 1、3、5…轮）',
    commonBadge: '重12',
    improvedBadge: '重15',
  },
  {
    kind: 'capacitor',
    name: '蓄能器',
    shortName: '蓄能',
    shapeId: '1x1',
    commonBudget: 1,
    commonRecycle: 8,
    family: 'heavy_kit',
    commonSummary: '相邻重炮改为第 1、3、5…轮先手开火（多个不叠加加速）',
    improvedSummary: '相邻重炮改为第 1、3、5…轮先手开火，且首轮额外 +3',
    commonBadge: '先手',
    improvedBadge: '先+3',
  },
  {
    kind: 'hangar',
    name: '无人机库',
    shortName: '机库',
    shapeId: '2x2',
    commonBudget: 3,
    commonRecycle: 20,
    family: 'hangar_kit',
    commonSummary: '第 1 轮出 1 架，每轮 +1 至多 3 架；每架独立索敌造成 2 伤（击毁自动转火）',
    improvedSummary: '第 1 轮出 1 架，每轮 +1 至多 3 架；每架独立索敌造成 3 伤（击毁自动转火）',
    commonBadge: '机×2',
    improvedBadge: '机×3',
  },
  {
    kind: 'relay',
    name: '编队中继',
    shortName: '中继',
    shapeId: '1x1',
    commonBudget: 1,
    commonRecycle: 8,
    family: 'hangar_kit',
    commonSummary: '相邻无人机库上限 3→4 架（多个取最高品质）',
    improvedSummary: '相邻无人机库上限 3→4 架，且首轮多发射 1 架',
    commonBadge: '上限4',
    improvedBadge: '首+1',
  },
  {
    kind: 'counter',
    name: '反击器',
    shortName: '反击',
    shapeId: '1x2',
    commonBudget: 2,
    commonRecycle: 14,
    family: 'counter_kit',
    commonSummary: '自带 +4 护盾；相邻护盾板激活：每轮按实吸护盾 floor(50%) 反击（最高 4，全船限 1 次）',
    improvedSummary: '自带 +5 护盾；相邻护盾板激活：每轮按实吸护盾 floor(75%) 反击（最高 5，全船限 1 次）',
    commonBadge: '盾4/反50%',
    improvedBadge: '盾5/反75%',
  },
  {
    kind: 'flak',
    name: '防空阵列',
    shortName: '防空',
    shapeId: 'T4',
    commonBudget: 3,
    commonRecycle: 20,
    family: 'counter_kit',
    commonSummary: '每轮对全部存活敌目标各造成 2 点伤害（克制蜂群）',
    improvedSummary: '每轮对全部存活敌目标各造成 3 点伤害（克制蜂群）',
    commonBadge: '群2',
    improvedBadge: '群3',
  },
  {
    kind: 'coolant_vent',
    name: '冷却排热阀',
    shortName: '排热',
    shapeId: '1x2',
    commonBudget: 2,
    commonRecycle: 14,
    family: 'heavy_kit',
    commonSummary: '+4 护盾且每轮末回盾 +1（抵消低温衰减 1）；正交贴邻重炮/导弹舱时该武器每次 +2 伤',
    improvedSummary: '+6 护盾且每轮末回盾 +2（抵消低温衰减 2）；正交贴邻重炮/导弹舱时该武器每次 +3 伤',
    commonBadge: '盾4/回1',
    improvedBadge: '盾6/回2',
  },
  {
    kind: 'cargo_amp',
    name: '货舱谐振仪',
    shortName: '谐振',
    shapeId: '1x1',
    commonBudget: 1,
    commonRecycle: 10,
    family: 'core',
    commonSummary: '舰核攻 +1；每正交贴邻 1 件货物/任务物额外 +1 舰核攻（上限 +3）与 +2 护盾',
    improvedSummary: '舰核攻 +2；每正交贴邻 1 件货物/任务物额外 +2 舰核攻（上限 +5）与 +3 护盾',
    commonBadge: '核+1/货联',
    improvedBadge: '核+2/货联',
  },
  {
    kind: 'emp_jammer',
    name: 'EMP 干扰器',
    shortName: '干扰',
    shapeId: '1x2',
    commonBudget: 2,
    commonRecycle: 16,
    family: 'counter_kit',
    commonSummary: '每轮 2 伤并额外削敌盾 3；抵御敌 EMP 削盾 2；奇数轮削弱首名敌舰 1 点攻击（最低 1）',
    improvedSummary: '每轮 3 伤并额外削敌盾 5；抵御敌 EMP 削盾 3；每轮削弱首名敌舰 1 点攻击（最低 1）',
    commonBadge: 'EMP2/削3',
    improvedBadge: 'EMP3/削5',
  },
  {
    kind: 'overdrive_core',
    name: '超频核心',
    shortName: '超频',
    shapeId: '2x2',
    commonBudget: 3,
    commonRecycle: 22,
    family: 'heavy_kit',
    commonSummary: '舰核攻 +2；正交贴邻武器获超频增幅（直击/重炮/干扰 +2 伤，机库/导弹/防空每发 +1 伤）',
    improvedSummary: '舰核攻 +3；正交贴邻武器获超频增幅（直击/重炮/干扰 +3 伤，机库/导弹/防空每发 +2 伤）',
    commonBadge: '核+2/增幅',
    improvedBadge: '核+3/强增',
  },
  {
    kind: 'salvage_grapple',
    name: '磁力拆解爪',
    shortName: '拆解爪',
    shapeId: '1x2',
    commonBudget: 2,
    commonRecycle: 14,
    family: 'core',
    commonSummary: '每轮 2 伤；残骸初始稳定度 +10、风险切割船体伤 -1；战后与残骸切割额外 +2 精密零件',
    improvedSummary: '每轮 3 伤；残骸初始稳定度 +18、风险切割船体伤 -2；战后与残骸切割额外 +4 精密零件',
    commonBadge: '爪2/稳+10',
    improvedBadge: '爪3/稳+18',
  },
  {
    kind: 'salvo_pod',
    name: '齐射导弹舱',
    shortName: '导弹舱',
    shapeId: '1x3',
    commonBudget: 3,
    commonRecycle: 22,
    family: 'hangar_kit',
    commonSummary: '每轮齐射 3 枚导弹（每枚 2 伤，独立索敌自动转火）；贴邻蓄能器或编队中继时发射数 +1',
    improvedSummary: '每轮齐射 3 枚导弹（每枚 3 伤，独立索敌自动转火）；贴邻蓄能器或编队中继时发射数 +1',
    commonBadge: '弹3×2',
    improvedBadge: '弹3×3',
  },
];

export const V2_EQUIPMENT_DEFS: Record<string, V2EquipmentDef> = {};

for (const spec of BASE_SPECS) {
  const commonId = `equipment.${spec.kind}.common`;
  const improvedId = `equipment.${spec.kind}.improved`;
  const improvedRecycle = Math.round(spec.commonRecycle * 1.5);

  V2_EQUIPMENT_DEFS[commonId] = {
    defId: commonId,
    kind: spec.kind,
    quality: 'common',
    name: spec.name,
    shortName: spec.shortName,
    shapeId: spec.shapeId,
    budgetCost: spec.commonBudget,
    recycleValue: spec.commonRecycle,
    shopBuyPrice: Math.ceil(spec.commonRecycle * 2.5),
    craftCost: spec.commonRecycle * 3,
    family: spec.family,
    summary: spec.commonSummary,
    badgeStat: spec.commonBadge,
  };

  V2_EQUIPMENT_DEFS[improvedId] = {
    defId: improvedId,
    kind: spec.kind,
    quality: 'improved',
    name: `优良${spec.name}`,
    shortName: `优·${spec.shortName}`,
    shapeId: spec.shapeId,
    budgetCost: spec.commonBudget + 1,
    recycleValue: improvedRecycle,
    shopBuyPrice: Math.ceil(improvedRecycle * 2.5),
    craftCost: 0, // Improved equipment cannot be crafted (§10.4)
    family: spec.family,
    summary: spec.improvedSummary,
    badgeStat: spec.improvedBadge,
  };
}

export function getV2EquipmentDef(defId: string): V2EquipmentDef | undefined {
  return V2_EQUIPMENT_DEFS[defId];
}

export function getV2EquipmentDefByKind(kind: V2EquipmentKind, quality: V2Quality): V2EquipmentDef {
  return V2_EQUIPMENT_DEFS[`equipment.${kind}.${quality}`];
}

/**
 * Effective pre-flight loadout budget cost:
 * Owned common equipment enjoys a -1 budget discount (minimum 1) so crafting/storing common gear
 * yields a real firepower ceiling advantage over lossless free blueprint loans in exchange for defeat risk!
 */
export function getEffectiveV2EquipmentBudgetCost(
  def: Pick<V2EquipmentDef, 'budgetCost' | 'quality'>,
  origin: 'loan' | 'owned' | 'loot' | 'mission'
): number {
  if (origin === 'owned' && def.quality === 'common') {
    return Math.max(1, def.budgetCost - 1);
  }
  return def.budgetCost;
}

export function getMerchantBuybackPrice(fixedValue: number): number {
  return Math.floor(fixedValue * 0.8);
}

export function getUnlockedEquipmentKinds(
  unlockedFamilies: readonly V2UnlockFamilyId[]
): readonly V2EquipmentKind[] {
  const set = new Set<V2UnlockFamilyId>(['core', ...unlockedFamilies]);
  return BASE_SPECS.filter((s) => set.has(s.family)).map((s) => s.kind);
}
