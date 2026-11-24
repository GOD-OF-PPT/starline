import type { V2ShapeId } from './shapes';

export type V3GadgetKind =
  | 'repair_kit'
  | 'overcharge_cell'
  | 'jump_canister'
  | 'cut_stabilizer';

export type V3GadgetUsableContext = 'map_arrange' | 'combat_pre' | 'wreck';

export interface V3GadgetDef {
  readonly defId: string;
  readonly kind: V3GadgetKind;
  readonly name: string;
  readonly shortName: string;
  readonly shapeId: V2ShapeId;
  readonly budgetCost: number;
  readonly fixedValue: number;
  readonly shopBuyPrice: number;
  readonly craftCostParts: number;
  readonly usableIn: V3GadgetUsableContext;
  readonly buttonLabel: string;
  readonly shortEffectLabel: string;
  readonly summary: string;
}

export const V3_GADGET_ORDER: readonly V3GadgetKind[] = [
  'repair_kit',
  'overcharge_cell',
  'jump_canister',
  'cut_stabilizer',
];

export const V3_GADGET_DEFS: Record<string, V3GadgetDef> = {
  'gadget.repair_kit': {
    defId: 'gadget.repair_kit',
    kind: 'repair_kit',
    name: '应急维修包',
    shortName: '维修包',
    shapeId: '1x1',
    budgetCost: 1,
    fixedValue: 12,
    shopBuyPrice: 24,
    craftCostParts: 16,
    usableIn: 'map_arrange',
    buttonLabel: '应急维修包 (+10 HP)',
    shortEffectLabel: '+10 HP',
    summary: '一次性 1×1 消耗装置：航路或整理阶段使用，立即修复 +10 船体耐久（不超上限）。',
  },
  'gadget.overcharge_cell': {
    defId: 'gadget.overcharge_cell',
    kind: 'overcharge_cell',
    name: '过载电池',
    shortName: '过载电',
    shapeId: '1x1',
    budgetCost: 1,
    fixedValue: 14,
    shopBuyPrice: 28,
    craftCostParts: 18,
    usableIn: 'combat_pre',
    buttonLabel: '过载电池',
    shortEffectLabel: '首轮+6破甲/+4盾',
    summary: '一次性 1×1 消耗装置：战斗开战前激活，首轮追加 +6 无视护甲能量爆发并 +4 护盾（遵循 20 盾上限）。',
  },
  'gadget.jump_canister': {
    defId: 'gadget.jump_canister',
    kind: 'jump_canister',
    name: '跃迁燃料罐',
    shortName: '燃料罐',
    shapeId: '1x1',
    budgetCost: 1,
    fixedValue: 12,
    shopBuyPrice: 24,
    craftCostParts: 16,
    usableIn: 'map_arrange',
    buttonLabel: '跃迁燃料罐 (+2 燃料)',
    shortEffectLabel: '+2 燃料',
    summary: '一次性 1×1 消耗装置：航路或整理阶段使用，立即补充 +2 跃迁燃料（上限 10）。',
  },
  'gadget.cut_stabilizer': {
    defId: 'gadget.cut_stabilizer',
    kind: 'cut_stabilizer',
    name: '切割稳定器',
    shortName: '稳定器',
    shapeId: '1x1',
    budgetCost: 1,
    fixedValue: 12,
    shopBuyPrice: 24,
    craftCostParts: 16,
    usableIn: 'wreck',
    buttonLabel: '切割稳定器',
    shortEffectLabel: '+35稳定/下次无风险',
    summary: '一次性 1×1 消耗装置：残骸拆解时使用，立即恢复 +35 结构稳定度，并令下一次风险切割免除船体损伤、燃料消耗与伏击警报。',
  },
};

export function getV3GadgetDef(defId: string): V3GadgetDef | undefined {
  return Object.prototype.hasOwnProperty.call(V3_GADGET_DEFS, defId)
    ? V3_GADGET_DEFS[defId]
    : undefined;
}

export function getV3GadgetDefByKind(kind: V3GadgetKind): V3GadgetDef {
  return V3_GADGET_DEFS[`gadget.${kind}`];
}
