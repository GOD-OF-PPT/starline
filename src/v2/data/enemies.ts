import type { EnemyArchetype } from '../../data/nodes';
import type { SeededRng } from '../../domain/rng';
import type { SectorId } from '../domain/types';
import { getV3SectorDef } from './sectors';

export type V2EncounterKind =
  | 'patrol'
  | 'swarm'
  | 'armored'
  | 'piercer'
  | 'elite'
  | 'boss_anvil'
  | 'boss_dreadnought'
  | 'boss_leviathan';

export interface V2EnemyUnitTemplate {
  readonly unitIdSuffix: string;
  readonly name: string;
  readonly spriteArchetype: EnemyArchetype;
  readonly baseHp: number;
  readonly baseDamage: number;
  readonly armor: number;
  /** Fraction of damage piercing directly through shield (0..1; piercer = 0.5) */
  readonly pierceRatio: number;
  readonly isBoss?: boolean;
}

export interface V2EncounterTemplate {
  readonly kind: V2EncounterKind;
  readonly name: string;
  readonly badge: string;
  readonly tacticHint: string;
  readonly scaleWithDepth: boolean;
  readonly extraBounty: number;
  readonly units: readonly V2EnemyUnitTemplate[];
}

export interface V2EnemyUnitSpec {
  readonly enemyId: string;
  readonly name: string;
  readonly spriteArchetype: EnemyArchetype;
  readonly maxHp: number;
  readonly damagePerRound: number;
  readonly armor: number;
  readonly pierceRatio: number;
  readonly isBoss?: boolean;
}

/** Fixed normal combat bounties for layers 1..6 (§9) */
export const V2_LAYER_COMBAT_BOUNTIES: readonly number[] = [6, 10, 14, 20, 28, 40];

/** Improved equipment drop probabilities for layers 1..6 (§9; elite/boss = 0.40) */
export const V2_LAYER_IMPROVED_PROBS: readonly number[] = [0.0, 0.0, 0.1, 0.15, 0.2, 0.25];
export const V2_ELITE_IMPROVED_PROB = 0.4;

export const V2_REGULAR_ENCOUNTER_KINDS: readonly ('patrol' | 'swarm' | 'armored' | 'piercer')[] = [
  'patrol',
  'swarm',
  'armored',
  'piercer',
];

export const V2_ENCOUNTER_TEMPLATES: Record<V2EncounterKind, V2EncounterTemplate> = {
  patrol: {
    kind: 'patrol',
    name: '巡逻艇编队',
    badge: '常规',
    tacticHint: '稳定单体火力，适合检验常规攻防',
    scaleWithDepth: true,
    extraBounty: 0,
    units: [
      {
        unitIdSuffix: 'patrol_1',
        name: '巡逻拾荒艇',
        spriteArchetype: 'scout',
        baseHp: 20,
        baseDamage: 3,
        armor: 0,
        pierceRatio: 0,
      },
    ],
  },
  swarm: {
    kind: 'swarm',
    name: '微型蜂群',
    badge: '4目标蜂群',
    tacticHint: '4 架低血目标齐射；防空阵列与高频输出占优，重炮易过量浪费',
    scaleWithDepth: true,
    extraBounty: 0,
    units: [
      { unitIdSuffix: 'swarm_1', name: '蜂群无人机 A', spriteArchetype: 'scout', baseHp: 6, baseDamage: 1, armor: 0, pierceRatio: 0 },
      { unitIdSuffix: 'swarm_2', name: '蜂群无人机 B', spriteArchetype: 'scout', baseHp: 6, baseDamage: 1, armor: 0, pierceRatio: 0 },
      { unitIdSuffix: 'swarm_3', name: '蜂群无人机 C', spriteArchetype: 'scout', baseHp: 6, baseDamage: 1, armor: 0, pierceRatio: 0 },
      { unitIdSuffix: 'swarm_4', name: '蜂群无人机 D', spriteArchetype: 'scout', baseHp: 6, baseDamage: 1, armor: 0, pierceRatio: 0 },
    ],
  },
  armored: {
    kind: 'armored',
    name: '装甲护卫舰',
    badge: '重甲 2',
    tacticHint: '逐发减伤 2 点（最低 1）；重炮单发高伤远胜大量小弹',
    scaleWithDepth: true,
    extraBounty: 0,
    units: [
      {
        unitIdSuffix: 'armored_1',
        name: '重装护卫艇',
        spriteArchetype: 'frigate',
        baseHp: 28,
        baseDamage: 3,
        armor: 2,
        pierceRatio: 0,
      },
    ],
  },
  piercer: {
    kind: 'piercer',
    name: '穿盾猎手',
    badge: '50%穿盾',
    tacticHint: '每轮半数伤害直接穿透护盾（不计入反击吸收）；建议速战压短轮数',
    scaleWithDepth: true,
    extraBounty: 0,
    units: [
      {
        unitIdSuffix: 'piercer_1',
        name: '穿盾猎杀艇',
        spriteArchetype: 'interceptor',
        baseHp: 22,
        baseDamage: 4,
        armor: 0,
        pierceRatio: 0.5,
      },
    ],
  },
  elite: {
    kind: 'elite',
    name: '末层旗舰编队',
    badge: '★ 末层精英',
    tacticHint: '固定强度：重甲旗舰 (32/攻4/甲1) + 两架护航机 (8/攻1)',
    scaleWithDepth: false,
    extraBounty: 25,
    units: [
      {
        unitIdSuffix: 'elite_flagship',
        name: '铁壁旗舰护卫',
        spriteArchetype: 'boss_dreadnought',
        baseHp: 32,
        baseDamage: 4,
        armor: 1,
        pierceRatio: 0,
        isBoss: true,
      },
      {
        unitIdSuffix: 'elite_escort_1',
        name: '护航截击机 A',
        spriteArchetype: 'interceptor',
        baseHp: 8,
        baseDamage: 1,
        armor: 0,
        pierceRatio: 0,
      },
      {
        unitIdSuffix: 'elite_escort_2',
        name: '护航截击机 B',
        spriteArchetype: 'interceptor',
        baseHp: 8,
        baseDamage: 1,
        armor: 0,
        pierceRatio: 0,
      },
    ],
  },
  boss_anvil: {
    kind: 'boss_anvil',
    name: '第一幕首领 · 铁砧号',
    badge: '★ 第一幕首领',
    tacticHint: '近轨封锁巨舰「铁砧号」(32/攻4/甲1) + 两架护航截击机，击败后解锁冰晶舰冢带',
    scaleWithDepth: false,
    extraBounty: 25,
    units: [
      {
        unitIdSuffix: 'boss_anvil_core',
        name: '铁砧号',
        spriteArchetype: 'hulk',
        baseHp: 32,
        baseDamage: 4,
        armor: 1,
        pierceRatio: 0,
        isBoss: true,
      },
      {
        unitIdSuffix: 'boss_anvil_escort_1',
        name: '近轨护航机 A',
        spriteArchetype: 'interceptor',
        baseHp: 8,
        baseDamage: 1,
        armor: 0,
        pierceRatio: 0,
      },
      {
        unitIdSuffix: 'boss_anvil_escort_2',
        name: '近轨护航机 B',
        spriteArchetype: 'interceptor',
        baseHp: 8,
        baseDamage: 1,
        armor: 0,
        pierceRatio: 0,
      },
    ],
  },
  boss_dreadnought: {
    kind: 'boss_dreadnought',
    name: '第二幕首领 · 铁壁无畏',
    badge: '★ 第二幕首领',
    tacticHint: '冰晶重甲旗舰「铁壁无畏」(42/攻5/甲2) + 双护航机，注意低温电离护盾压制',
    scaleWithDepth: false,
    extraBounty: 35,
    units: [
      {
        unitIdSuffix: 'boss_dreadnought_core',
        name: '铁壁无畏',
        spriteArchetype: 'boss_dreadnought',
        baseHp: 42,
        baseDamage: 5,
        armor: 2,
        pierceRatio: 0,
        isBoss: true,
      },
      {
        unitIdSuffix: 'boss_dreadnought_escort_1',
        name: '冰晶护卫艇 A',
        spriteArchetype: 'interceptor',
        baseHp: 9,
        baseDamage: 1,
        armor: 0,
        pierceRatio: 0,
      },
      {
        unitIdSuffix: 'boss_dreadnought_escort_2',
        name: '冰晶护卫艇 B',
        spriteArchetype: 'interceptor',
        baseHp: 9,
        baseDamage: 1,
        armor: 0,
        pierceRatio: 0,
      },
    ],
  },
  boss_leviathan: {
    kind: 'boss_leviathan',
    name: '第三幕首领 · 黑曜利维坦',
    badge: '★ 第三幕首领',
    tacticHint: '星门守卫旗舰「黑曜利维坦」(52/攻6/甲2/穿盾25%) + 双护航机，留意偶数轮引力高潮',
    scaleWithDepth: false,
    extraBounty: 50,
    units: [
      {
        unitIdSuffix: 'boss_leviathan_core',
        name: '黑曜利维坦',
        spriteArchetype: 'boss_leviathan',
        baseHp: 52,
        baseDamage: 6,
        armor: 2,
        pierceRatio: 0.25,
        isBoss: true,
      },
      {
        unitIdSuffix: 'boss_leviathan_escort_1',
        name: '星渊护航机 A',
        spriteArchetype: 'interceptor',
        baseHp: 10,
        baseDamage: 1,
        armor: 0,
        pierceRatio: 0,
      },
      {
        unitIdSuffix: 'boss_leviathan_escort_2',
        name: '星渊护航机 B',
        spriteArchetype: 'interceptor',
        baseHp: 10,
        baseDamage: 1,
        armor: 0,
        pierceRatio: 0,
      },
    ],
  },
};

export function getV2EncounterTemplate(kind: string): V2EncounterTemplate {
  if (Object.prototype.hasOwnProperty.call(V2_ENCOUNTER_TEMPLATES, kind)) {
    return V2_ENCOUNTER_TEMPLATES[kind as V2EncounterKind];
  }
  return V2_ENCOUNTER_TEMPLATES.patrol;
}

export function isBossEncounterKind(kind: string): boolean {
  return (
    kind === 'elite' ||
    kind === 'boss_anvil' ||
    kind === 'boss_dreadnought' ||
    kind === 'boss_leviathan'
  );
}

export function getDepthScalingFactor(layer: number): number {
  if (layer <= 2) return 0.75;
  if (layer <= 4) return 1.0;
  return 1.25;
}

export function buildEncounterUnits(
  kind: V2EncounterKind,
  layer: number,
  nodeId: string,
  useLeviathanVisual = false
): readonly V2EnemyUnitSpec[] {
  const tpl = getV2EncounterTemplate(kind);
  const mult = tpl.scaleWithDepth ? getDepthScalingFactor(layer) : 1.0;

  return tpl.units.map((u, idx) => {
    const spriteArchetype: EnemyArchetype =
      useLeviathanVisual && u.isBoss ? 'boss_leviathan' : u.spriteArchetype;
    const scaledDamage =
      kind === 'swarm' && layer >= 5 && idx < 2
        ? 2
        : Math.max(1, Math.round(u.baseDamage * mult));
    return {
      enemyId: `${nodeId}_${u.unitIdSuffix}`,
      name: useLeviathanVisual && u.isBoss ? '黑曜旗舰护卫' : u.name,
      spriteArchetype,
      maxHp: Math.max(1, Math.round(u.baseHp * mult)),
      damagePerRound: scaledDamage,
      armor: u.armor, // Armor never scales with depth (§8.3)
      pierceRatio: u.pierceRatio,
      isBoss: u.isBoss,
    };
  });
}

export function getEncounterBounty(kind: V2EncounterKind, layer: number): number {
  const idx = Math.max(0, Math.min(V2_LAYER_COMBAT_BOUNTIES.length - 1, layer - 1));
  return V2_LAYER_COMBAT_BOUNTIES[idx] + getV2EncounterTemplate(kind).extraBounty;
}

export function getEncounterImprovedProb(
  kind: V2EncounterKind,
  layer: number,
  allowImproved = true
): number {
  if (!allowImproved) return 0;
  if (isBossEncounterKind(kind)) return V2_ELITE_IMPROVED_PROB;
  const idx = Math.max(0, Math.min(V2_LAYER_IMPROVED_PROBS.length - 1, layer - 1));
  return V2_LAYER_IMPROVED_PROBS[idx];
}

export interface SectorEnemyEncounterOptions {
  readonly nodeId?: string;
  readonly allowImproved?: boolean;
  readonly isFinalCampaignRun?: boolean;
}

export interface SectorEnemyEncounterResult {
  readonly encounterKind: V2EncounterKind;
  readonly units: readonly V2EnemyUnitSpec[];
  readonly bounty: number;
  readonly improvedProb: number;
  readonly bossId?: string;
}

function pickWeightedRegularKind(
  weights: Readonly<Record<'patrol' | 'swarm' | 'armored' | 'piercer', number>>,
  rng: SeededRng
): 'patrol' | 'swarm' | 'armored' | 'piercer' {
  const total =
    weights.patrol + weights.swarm + weights.armored + weights.piercer;
  if (total <= 0) return rng.pick(V2_REGULAR_ENCOUNTER_KINDS);
  let roll = rng.nextFloat() * total;
  for (const kind of V2_REGULAR_ENCOUNTER_KINDS) {
    roll -= weights[kind];
    if (roll < 0) return kind;
  }
  return V2_REGULAR_ENCOUNTER_KINDS[V2_REGULAR_ENCOUNTER_KINDS.length - 1];
}

/**
 * Interface Contract #3 Pluggable Sector Enemy Registry Hook.
 * Called by `routeGenerator.ts` so M2 delivers 3 distinct sectors & Act Bosses while M3 can expand
 * enemy rosters & multi-phase bosses strictly inside `src/v2/data/enemies.ts`.
 */
export function buildSectorEnemyEncounter(
  sectorId: SectorId,
  layer: number,
  kind: V2EncounterKind | 'regular' | 'elite' | 'boss',
  rng: SeededRng,
  endlessThreat = 0,
  options?: SectorEnemyEncounterOptions
): SectorEnemyEncounterResult {
  const sector = getV3SectorDef(sectorId);
  const nodeId = options?.nodeId ?? `L${layer}`;
  const allowImproved = options?.allowImproved ?? true;
  const clampedThreat = Math.max(0, Math.min(10, Math.floor(endlessThreat)));

  const isBossRequest =
    kind === 'elite' ||
    kind === 'boss' ||
    kind === 'boss_anvil' ||
    kind === 'boss_dreadnought' ||
    kind === 'boss_leviathan';

  let encounterKind: V2EncounterKind;
  let bossId: string | undefined;

  if (isBossRequest) {
    if (kind === 'boss_anvil' || kind === 'boss_dreadnought' || kind === 'boss_leviathan') {
      encounterKind = kind;
      bossId = kind;
    } else if (options?.isFinalCampaignRun) {
      encounterKind = 'boss_leviathan';
      bossId = 'boss_leviathan';
    } else {
      encounterKind = sector.bossId;
      bossId = sector.bossId;
    }
  } else if (kind === 'regular') {
    if (layer === 1) {
      encounterKind = 'patrol';
    } else if (sectorId === 'near_orbit' && clampedThreat === 0) {
      encounterKind = rng.pick(V2_REGULAR_ENCOUNTER_KINDS);
    } else {
      encounterKind = pickWeightedRegularKind(sector.encounterWeights, rng);
    }
  } else {
    encounterKind = kind;
  }

  const baseUnits = buildEncounterUnits(encounterKind, layer, nodeId, false);
  const isNeutralBaseline = sectorId === 'near_orbit' && clampedThreat === 0;
  const isFixedBoss = bossId !== undefined;

  const endlessHpMult = 1 + clampedThreat * 0.1;
  const endlessDmgAdd = Math.floor(clampedThreat / 3);
  const endlessBountyMult = 1 + clampedThreat * 0.12;

  const units: readonly V2EnemyUnitSpec[] =
    isNeutralBaseline || (isFixedBoss && clampedThreat === 0)
      ? baseUnits
      : baseUnits.map((u) => {
          const hpScale = (isFixedBoss ? 1 : sector.enemyHpMult) * endlessHpMult;
          const dmgBonus =
            (isFixedBoss ? 0 : encounterKind === 'swarm' ? 0 : sector.enemyDmgAdd) +
            endlessDmgAdd;
          return {
            ...u,
            maxHp: Math.max(1, Math.round(u.maxHp * hpScale)),
            damagePerRound: Math.max(1, u.damagePerRound + dmgBonus),
          };
        });

  const baseBounty = getEncounterBounty(encounterKind, layer);
  const bounty = isNeutralBaseline
    ? baseBounty
    : Math.max(1, Math.round(baseBounty * sector.bountyMult * endlessBountyMult));

  const baseImprovedProb = getEncounterImprovedProb(encounterKind, layer, allowImproved);
  const improvedProb = !allowImproved
    ? 0
    : isNeutralBaseline
    ? baseImprovedProb
    : Math.min(0.75, Number((baseImprovedProb + sector.improvedProbBonus).toFixed(2)));

  return {
    encounterKind,
    units,
    bounty,
    improvedProb,
    bossId,
  };
}
