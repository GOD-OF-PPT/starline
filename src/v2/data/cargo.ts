import type { V2ShapeId } from './shapes';

export type V2RegularCargoKind =
  | 'data_box'
  | 'alloy_bar'
  | 'coolant_tank'
  | 'old_engine'
  | 'folding_antenna'
  | 'ancient_navigator';

/** Preserved v3.0 collectible relics (migrated & collectable in deep/elite encounters, ADR-02) */
export type V2ExtendedRelicCargoKind = 'quantum_core' | 'cryo_amber' | 'obsidian_crown';

export type V2MissionCargoKind = 'sealed_reactor' | 'escape_pod' | 'black_box';

export type V2CargoKind = V2RegularCargoKind | V2ExtendedRelicCargoKind | V2MissionCargoKind;

export interface V2CargoDef {
  readonly defId: string;
  readonly kind: V2CargoKind;
  readonly name: string;
  readonly shortName: string;
  readonly shapeId: V2ShapeId;
  /** Layer 1 base recycle price (0 for mission items — mission items have no normal sale value!) */
  readonly layer1BasePrice: number;
  readonly isCollectible: boolean;
  readonly isMissionItem: boolean;
  readonly relicId?: string;
  readonly summary: string;
}

/** Depth price multipliers for layers 1..6 (§10.2) */
export const V2_CARGO_DEPTH_MULTIPLIERS: readonly number[] = [1, 1.15, 1.3, 1.5, 1.75, 2];

export const V2_REGULAR_CARGO_KINDS: readonly V2RegularCargoKind[] = [
  'data_box',
  'alloy_bar',
  'coolant_tank',
  'old_engine',
  'folding_antenna',
  'ancient_navigator',
];

export const V2_EXTENDED_RELIC_CARGO_KINDS: readonly V2ExtendedRelicCargoKind[] = [
  'quantum_core',
  'cryo_amber',
  'obsidian_crown',
];

export const V2_CARGO_DEFS: Record<string, V2CargoDef> = {
  'cargo.data_box': {
    defId: 'cargo.data_box',
    kind: 'data_box',
    name: '数据盒',
    shortName: '数据盒',
    shapeId: '1x1',
    layer1BasePrice: 7,
    isCollectible: false,
    isMissionItem: false,
    summary: '紧凑黑匣子，1×1 易插缝，1 层基价 7¤（7.0¤/格）',
  },
  'cargo.alloy_bar': {
    defId: 'cargo.alloy_bar',
    kind: 'alloy_bar',
    name: '合金条',
    shortName: '合金条',
    shapeId: '1x2',
    layer1BasePrice: 15,
    isCollectible: false,
    isMissionItem: false,
    summary: '标准精炼船体合金，1×2，1 层基价 15¤（7.5¤/格）',
  },
  'cargo.coolant_tank': {
    defId: 'cargo.coolant_tank',
    kind: 'coolant_tank',
    name: '冷却罐',
    shortName: '冷却罐',
    shapeId: '1x3',
    layer1BasePrice: 27,
    isCollectible: false,
    isMissionItem: false,
    summary: '工业压液冷罐，1×3 细长高密货，1 层基价 27¤（9.0¤/格）；正交贴邻重炮时额外 +4 伤',
  },
  'cargo.old_engine': {
    defId: 'cargo.old_engine',
    kind: 'old_engine',
    name: '旧引擎',
    shortName: '旧引擎',
    shapeId: '2x2',
    layer1BasePrice: 32,
    isCollectible: false,
    isMissionItem: false,
    summary: '厚重推进机组，2×2，1 层基价 32¤（8.0¤/格）',
  },
  'cargo.folding_antenna': {
    defId: 'cargo.folding_antenna',
    kind: 'folding_antenna',
    name: '折叠天线',
    shortName: '天线',
    shapeId: 'L3',
    layer1BasePrice: 32,
    isCollectible: false,
    isMissionItem: false,
    summary: 'L 形高密通信阵列，1 层基价 32¤（10.7¤/格）',
  },
  'cargo.ancient_navigator': {
    defId: 'cargo.ancient_navigator',
    kind: 'ancient_navigator',
    name: '古代导航仪',
    shortName: '导航仪',
    shapeId: 'T4',
    layer1BasePrice: 48,
    isCollectible: true,
    isMissionItem: false,
    relicId: 'ancient_navigator',
    summary: 'T 形古星仪，安全返航可出售或入展台仓库修复展示',
  },
  'cargo.quantum_core': {
    defId: 'cargo.quantum_core',
    kind: 'quantum_core',
    name: '量子星核',
    shortName: '量子核',
    shapeId: '2x2',
    layer1BasePrice: 50,
    isCollectible: true,
    isMissionItem: false,
    relicId: 'quantum_core',
    summary: '2×2 零点晶核藏品，安全返航可出售或入展台修复',
  },
  'cargo.cryo_amber': {
    defId: 'cargo.cryo_amber',
    kind: 'cryo_amber',
    name: '星渊琥珀匣',
    shortName: '琥珀匣',
    shapeId: '1x3',
    layer1BasePrice: 42,
    isCollectible: true,
    isMissionItem: false,
    relicId: 'cryo_amber',
    summary: '1×3 冰晶样本罐藏品，安全返航可出售或入展台修复',
  },
  'cargo.obsidian_crown': {
    defId: 'cargo.obsidian_crown',
    kind: 'obsidian_crown',
    name: '黑曜舰桥冠徽',
    shortName: '黑曜冠',
    shapeId: 'L3',
    layer1BasePrice: 52,
    isCollectible: true,
    isMissionItem: false,
    relicId: 'obsidian_crown',
    summary: 'L 形旗舰指挥冠徽藏品，安全返航可出售或入展台修复',
  },
  'mission.sealed_reactor': {
    defId: 'mission.sealed_reactor',
    kind: 'sealed_reactor',
    name: '密封反应堆',
    shortName: '反应堆',
    shapeId: '2x3',
    layer1BasePrice: 0,
    isCollectible: false,
    isMissionItem: true,
    summary: '大件运输委托货（2×3 占六格）· 无普通卖价 · 需带回港交付',
  },
  'mission.escape_pod': {
    defId: 'mission.escape_pod',
    kind: 'escape_pod',
    name: '救援救生舱',
    shortName: '救生舱',
    shapeId: '1x2',
    layer1BasePrice: 0,
    isCollectible: false,
    isMissionItem: true,
    summary: '失联救援任务舱（1×2）· 携带期间每次跨层额外耗 1 燃料 · 不可出售',
  },
  'mission.black_box': {
    defId: 'mission.black_box',
    kind: 'black_box',
    name: '加密黑匣记录仪',
    shortName: '黑匣子',
    shapeId: '1x2',
    layer1BasePrice: 0,
    isCollectible: false,
    isMissionItem: true,
    summary: '黑匣打捞委托件（1×2）· 无普通卖价 · 不可拆解，需带回港交付',
  },
};

export function getV2CargoDef(defId: string): V2CargoDef | undefined {
  return V2_CARGO_DEFS[defId];
}

export function computeV2CargoPrice(defId: string, depthLayer: number): number {
  const def = V2_CARGO_DEFS[defId];
  if (!def || def.isMissionItem || def.layer1BasePrice <= 0) return 0;
  const idx = Math.max(0, Math.min(V2_CARGO_DEPTH_MULTIPLIERS.length - 1, depthLayer - 1));
  return Math.round(def.layer1BasePrice * V2_CARGO_DEPTH_MULTIPLIERS[idx]);
}

export function getV2ItemDef(defId: string) {
  return V2_CARGO_DEFS[defId];
}
