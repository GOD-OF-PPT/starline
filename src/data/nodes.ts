import { CARGO_KINDS, getCargoDef, type CargoKind } from './items';
import { SHAPES } from './shapes';

export type RouteType = 'normal' | 'danger';
export type EnemyArchetype =
  | 'scout'
  | 'interceptor'
  | 'frigate'
  | 'hulk'
  | 'boss_dreadnought'
  | 'boss_leviathan';
export type SectorBgIndex = 1 | 2 | 3 | 4 | 5 | 6;
export type RegionId = 'standard' | 'abyssal';

export interface RegionDefinition {
  readonly id: RegionId;
  readonly name: string;
  readonly shortName: string;
  readonly badge: string;
  readonly hpMult: number;
  readonly dmgAdd: number;
  readonly bountyMult: number;
  readonly cargoMult: number;
  readonly improvedBonus: number;
  readonly relicChance: number;
  readonly bossRelicChance: number;
  readonly unlockHint: string;
}

export const REGIONS: Record<RegionId, RegionDefinition> = {
  standard: {
    id: 'standard',
    name: '近轨残骸航线',
    shortName: '标准航线',
    badge: '6大星域 · 旗舰BOSS',
    hpMult: 1.0,
    dmgAdd: 0,
    bountyMult: 1.0,
    cargoMult: 1.0,
    improvedBonus: 0,
    relicChance: 0.22,
    bossRelicChance: 0.48,
    unlockHint: '默认开放',
  },
  abyssal: {
    id: 'abyssal',
    name: '星渊星门禁区',
    shortName: '星渊禁区',
    badge: '+35%赏 · 高爆藏品',
    hpMult: 1.15,
    dmgAdd: 1,
    bountyMult: 1.35,
    cargoMult: 1.2,
    improvedBonus: 0.15,
    relicChance: 0.36,
    bossRelicChance: 0.68,
    unlockHint: '修复工作台或抵达第 3 站解锁',
  },
};

export interface NodeBaseConfig {
  readonly node: number; // 1..6
  readonly sectorName: string;
  readonly abyssalSectorName: string;
  readonly sectorBg: SectorBgIndex;
  readonly abyssalSectorBg: SectorBgIndex;
  readonly normalHp: number;
  readonly normalDamage: number;
  readonly normalBounty: number;
  readonly cargoBaseB: number;
  readonly normalImprovedProb: number; // 0..1
  readonly enemyArchetype: EnemyArchetype;
  readonly dangerArchetype: EnemyArchetype;
  readonly enemyName: string;
  readonly dangerEnemyName: string;
  readonly abyssalEnemyName: string;
  readonly abyssalDangerEnemyName: string;
  readonly normalIsBoss?: boolean;
  readonly dangerIsBoss?: boolean;
  readonly abyssalDangerIsBoss?: boolean;
}

export const MAX_EXPEDITION_NODES = 6;

export const NODE_CONFIGS: readonly NodeBaseConfig[] = [
  {
    node: 1,
    sectorName: '外环残骸带',
    abyssalSectorName: '晶化静默外带',
    sectorBg: 1,
    abyssalSectorBg: 5,
    normalHp: 12,
    normalDamage: 2,
    normalBounty: 5,
    cargoBaseB: 12,
    normalImprovedProb: 0.0,
    enemyArchetype: 'scout',
    dangerArchetype: 'interceptor',
    enemyName: '巡逻拾荒艇',
    dangerEnemyName: '改装突袭艇',
    abyssalEnemyName: '冰渊侦察艇',
    abyssalDangerEnemyName: '赤翼截击艇',
  },
  {
    node: 2,
    sectorName: '琥珀矿尘带',
    abyssalSectorName: '断轨熔炉环',
    sectorBg: 2,
    abyssalSectorBg: 4,
    normalHp: 20,
    normalDamage: 2,
    normalBounty: 8,
    cargoBaseB: 18,
    normalImprovedProb: 0.1,
    enemyArchetype: 'scout',
    dangerArchetype: 'interceptor',
    enemyName: '双联哨戒艇',
    dangerEnemyName: '装甲截击艇',
    abyssalEnemyName: '轨道清道艇',
    abyssalDangerEnemyName: '绯红猎杀艇',
  },
  {
    node: 3,
    sectorName: '断轨中转站',
    abyssalSectorName: '反应堆裂隙',
    sectorBg: 4,
    abyssalSectorBg: 3,
    normalHp: 28,
    normalDamage: 3,
    normalBounty: 12,
    cargoBaseB: 26,
    normalImprovedProb: 0.2,
    enemyArchetype: 'frigate',
    dangerArchetype: 'interceptor',
    enemyName: '护航炮艇',
    dangerEnemyName: '重炮猎手舰',
    abyssalEnemyName: '裂隙重炮艇',
    abyssalDangerEnemyName: '熔炉先锋无畏',
    abyssalDangerIsBoss: true,
  },
  {
    node: 4,
    sectorName: '冰晶沉船带',
    abyssalSectorName: '极寒舰冢核心',
    sectorBg: 5,
    abyssalSectorBg: 5,
    normalHp: 36,
    normalDamage: 4,
    normalBounty: 18,
    cargoBaseB: 38,
    normalImprovedProb: 0.3,
    enemyArchetype: 'frigate',
    dangerArchetype: 'hulk',
    enemyName: '拆解武装舰',
    dangerEnemyName: '红标驱逐舰',
    abyssalEnemyName: '冰封护卫舰',
    abyssalDangerEnemyName: '过载重装舰',
  },
  {
    node: 5,
    sectorName: '反应堆废墟',
    abyssalSectorName: '古星门前哨',
    sectorBg: 3,
    abyssalSectorBg: 6,
    normalHp: 46,
    normalDamage: 5,
    normalBounty: 26,
    cargoBaseB: 54,
    normalImprovedProb: 0.4,
    enemyArchetype: 'hulk',
    dangerArchetype: 'hulk',
    enemyName: '重型守卫舰',
    dangerEnemyName: '过载要塞舰',
    abyssalEnemyName: '星门守备巨舰',
    abyssalDangerEnemyName: '铁壁重炮要塞',
  },
  {
    node: 6,
    sectorName: '古代星门核心',
    abyssalSectorName: '黑曜主星门深渊',
    sectorBg: 6,
    abyssalSectorBg: 6,
    normalHp: 58,
    normalDamage: 6,
    normalBounty: 36,
    cargoBaseB: 76,
    normalImprovedProb: 0.5,
    enemyArchetype: 'boss_dreadnought',
    dangerArchetype: 'boss_leviathan',
    enemyName: '铁壁无畏旗舰',
    dangerEnemyName: '黑曜利维坦',
    abyssalEnemyName: '深渊铁壁旗舰',
    abyssalDangerEnemyName: '虚空君王利维坦',
    normalIsBoss: true,
    dangerIsBoss: true,
    abyssalDangerIsBoss: true,
  },
];

export interface EnemySpec {
  readonly name: string;
  readonly archetype: EnemyArchetype;
  readonly isDanger: boolean;
  readonly isBoss?: boolean;
  readonly maxHp: number;
  readonly damagePerRound: number;
}

export interface RouteSpec {
  readonly node: number;
  readonly regionId?: RegionId;
  readonly routeType: RouteType;
  readonly label: string;
  readonly sectorName: string;
  readonly sectorBg?: SectorBgIndex;
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
 * Abyssal Frontier applies region cargo appraisal multiplier.
 */
export function computeCargoPrice(
  cargoKind: CargoKind,
  node: number,
  routeType: RouteType,
  regionId: RegionId = 'standard'
): number {
  const cfg = getNodeConfig(node);
  const region = REGIONS[regionId] ?? REGIONS.standard;
  const def = getCargoDef(cargoKind);
  const cells = SHAPES[def.shapeId].cells.length;
  const normalPrice = Math.round((cfg.cargoBaseB * cells * def.valueCoeff * region.cargoMult) / 2);
  if (routeType === 'danger') {
    return Math.round(normalPrice * 1.6);
  }
  return normalPrice;
}

export function getRouteSpec(
  node: number,
  routeType: RouteType,
  regionId: RegionId = 'standard'
): RouteSpec {
  const cfg = getNodeConfig(node);
  const region = REGIONS[regionId] ?? REGIONS.standard;
  const isDanger = routeType === 'danger';
  const isAbyssal = region.id === 'abyssal';

  const baseHp = Math.ceil(cfg.normalHp * region.hpMult);
  const baseDmg = cfg.normalDamage + region.dmgAdd;
  const baseBounty = Math.round(cfg.normalBounty * region.bountyMult);

  const maxHp = isDanger ? Math.ceil(baseHp * 1.3) : baseHp;
  const damagePerRound = isDanger ? baseDmg + 1 : baseDmg;
  const bounty = isDanger ? Math.round(baseBounty * 1.6) : baseBounty;
  const improvedEquipmentProb = Math.min(
    0.75,
    Number(
      (
        cfg.normalImprovedProb +
        region.improvedBonus +
        (isDanger ? 0.25 : 0)
      ).toFixed(2)
    )
  );

  let archetype: EnemyArchetype = isDanger ? cfg.dangerArchetype : cfg.enemyArchetype;
  const isBoss = isDanger
    ? Boolean(cfg.dangerIsBoss || (isAbyssal && cfg.abyssalDangerIsBoss))
    : Boolean(cfg.normalIsBoss);

  if (isAbyssal && isDanger && cfg.abyssalDangerIsBoss && node < 6) {
    archetype = 'boss_dreadnought';
  }

  const enemyName = isAbyssal
    ? isDanger
      ? cfg.abyssalDangerEnemyName
      : cfg.abyssalEnemyName
    : isDanger
    ? cfg.dangerEnemyName
    : cfg.enemyName;

  let minPrice = Infinity;
  let maxPrice = -Infinity;
  for (const kind of CARGO_KINDS) {
    const p = computeCargoPrice(kind, node, routeType, region.id);
    if (p < minPrice) minPrice = p;
    if (p > maxPrice) maxPrice = p;
  }

  return {
    node,
    regionId: region.id,
    routeType,
    label: isBoss ? 'BOSS 航道' : isDanger ? '危险航路' : '普通航路',
    sectorName: isAbyssal ? cfg.abyssalSectorName : cfg.sectorName,
    sectorBg: isAbyssal ? cfg.abyssalSectorBg : cfg.sectorBg,
    enemy: {
      name: enemyName,
      archetype,
      isDanger,
      isBoss,
      maxHp,
      damagePerRound,
    },
    bounty,
    improvedEquipmentProb,
    cargoPriceRange: { min: minPrice, max: maxPrice },
  };
}
