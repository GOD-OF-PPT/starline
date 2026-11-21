import { CARGO_KINDS, getCargoDef, type CargoKind } from './items';
import { SHAPES } from './shapes';

export type RouteType = 'normal' | 'danger';
export type EnemyArchetype = 'scout' | 'frigate' | 'hulk';

export interface NodeBaseConfig {
  readonly node: number; // 1..6
  readonly sectorName: string;
  readonly normalHp: number;
  readonly normalDamage: number;
  readonly normalBounty: number;
  readonly cargoBaseB: number;
  readonly normalImprovedProb: number; // 0..1
  readonly enemyArchetype: EnemyArchetype;
  readonly enemyName: string;
  readonly dangerEnemyName: string;
}

export const MAX_EXPEDITION_NODES = 6;

export const NODE_CONFIGS: readonly NodeBaseConfig[] = [
  {
    node: 1,
    sectorName: '外环残骸带',
    normalHp: 12,
    normalDamage: 2,
    normalBounty: 5,
    cargoBaseB: 12,
    normalImprovedProb: 0.0,
    enemyArchetype: 'scout',
    enemyName: '巡逻拾荒艇',
    dangerEnemyName: '改装突袭艇',
  },
  {
    node: 2,
    sectorName: '旧船坞漂流区',
    normalHp: 20,
    normalDamage: 2,
    normalBounty: 8,
    cargoBaseB: 18,
    normalImprovedProb: 0.1,
    enemyArchetype: 'scout',
    enemyName: '双联哨戒艇',
    dangerEnemyName: '装甲截击艇',
  },
  {
    node: 3,
    sectorName: '断轨中转站',
    normalHp: 28,
    normalDamage: 3,
    normalBounty: 12,
    cargoBaseB: 26,
    normalImprovedProb: 0.2,
    enemyArchetype: 'frigate',
    enemyName: '护航炮艇',
    dangerEnemyName: '重炮猎手舰',
  },
  {
    node: 4,
    sectorName: '沉船墓场边缘',
    normalHp: 36,
    normalDamage: 4,
    normalBounty: 18,
    cargoBaseB: 38,
    normalImprovedProb: 0.3,
    enemyArchetype: 'frigate',
    enemyName: '拆解武装舰',
    dangerEnemyName: '红标驱逐舰',
  },
  {
    node: 5,
    sectorName: '深层反应堆废墟',
    normalHp: 46,
    normalDamage: 5,
    normalBounty: 26,
    cargoBaseB: 54,
    normalImprovedProb: 0.4,
    enemyArchetype: 'hulk',
    enemyName: '重型守卫舰',
    dangerEnemyName: '过载要塞舰',
  },
  {
    node: 6,
    sectorName: '核心残骸深处',
    normalHp: 58,
    normalDamage: 6,
    normalBounty: 36,
    cargoBaseB: 76,
    normalImprovedProb: 0.5,
    enemyArchetype: 'hulk',
    enemyName: '旗舰防卫舰',
    dangerEnemyName: '黑曜主力舰',
  },
];

export interface EnemySpec {
  readonly name: string;
  readonly archetype: EnemyArchetype;
  readonly isDanger: boolean;
  readonly maxHp: number;
  readonly damagePerRound: number;
}

export interface RouteSpec {
  readonly node: number;
  readonly routeType: RouteType;
  readonly label: string;
  readonly sectorName: string;
  readonly enemy: EnemySpec;
  readonly bounty: number;
  readonly improvedEquipmentProb: number;
  readonly cargoPriceRange: { readonly min: number; readonly max: number };
}

export function getNodeConfig(node: number): NodeBaseConfig {
  const cfg = NODE_CONFIGS[node - 1];
  if (!cfg) {
    throw new Error(`Invalid node index: ${node} (expected 1..${MAX_EXPEDITION_NODES})`);
  }
  return cfg;
}

/**
 * Compute cargo value according to blueprint §4 & §5:
 * Normal: round(B * cells * coeff / 2)
 * Danger: round(normalPrice * 1.6)
 */
export function computeCargoPrice(
  cargoKind: CargoKind,
  node: number,
  routeType: RouteType
): number {
  const cfg = getNodeConfig(node);
  const def = getCargoDef(cargoKind);
  const cells = SHAPES[def.shapeId].cells.length;
  const normalPrice = Math.round((cfg.cargoBaseB * cells * def.valueCoeff) / 2);
  if (routeType === 'danger') {
    return Math.round(normalPrice * 1.6);
  }
  return normalPrice;
}

export function getRouteSpec(node: number, routeType: RouteType): RouteSpec {
  const cfg = getNodeConfig(node);
  const isDanger = routeType === 'danger';

  const maxHp = isDanger ? Math.ceil(cfg.normalHp * 1.3) : cfg.normalHp;
  const damagePerRound = isDanger ? cfg.normalDamage + 1 : cfg.normalDamage;
  const bounty = isDanger ? Math.round(cfg.normalBounty * 1.6) : cfg.normalBounty;
  const improvedEquipmentProb = isDanger
    ? Math.min(0.75, Number((cfg.normalImprovedProb + 0.25).toFixed(2)))
    : cfg.normalImprovedProb;

  let minPrice = Infinity;
  let maxPrice = -Infinity;
  for (const kind of CARGO_KINDS) {
    const p = computeCargoPrice(kind, node, routeType);
    if (p < minPrice) minPrice = p;
    if (p > maxPrice) maxPrice = p;
  }

  return {
    node,
    routeType,
    label: isDanger ? '危险航路' : '普通航路',
    sectorName: cfg.sectorName,
    enemy: {
      name: isDanger ? cfg.dangerEnemyName : cfg.enemyName,
      archetype: cfg.enemyArchetype,
      isDanger,
      maxHp,
      damagePerRound,
    },
    bounty,
    improvedEquipmentProb,
    cargoPriceRange: { min: minPrice, max: maxPrice },
  };
}
