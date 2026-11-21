import type { EnemyArchetype } from '../../data/nodes';

export type V2EncounterKind = 'patrol' | 'swarm' | 'armored' | 'piercer' | 'elite';

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

/** Improved equipment drop probabilities for layers 1..6 (§9; elite = 0.40) */
export const V2_LAYER_IMPROVED_PROBS: readonly number[] = [0.0, 0.0, 0.1, 0.15, 0.2, 0.25];
export const V2_ELITE_IMPROVED_PROB = 0.4;

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
};

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
  const tpl = V2_ENCOUNTER_TEMPLATES[kind];
  const mult = tpl.scaleWithDepth ? getDepthScalingFactor(layer) : 1.0;

  return tpl.units.map((u) => {
    const spriteArchetype: EnemyArchetype =
      useLeviathanVisual && u.isBoss ? 'boss_leviathan' : u.spriteArchetype;
    return {
      enemyId: `${nodeId}_${u.unitIdSuffix}`,
      name: useLeviathanVisual && u.isBoss ? '黑曜旗舰护卫' : u.name,
      spriteArchetype,
      maxHp: Math.max(1, Math.round(u.baseHp * mult)),
      damagePerRound: Math.max(1, Math.round(u.baseDamage * mult)),
      armor: u.armor, // Armor never scales with depth (§8.3)
      pierceRatio: u.pierceRatio,
      isBoss: u.isBoss,
    };
  });
}

export function getEncounterBounty(kind: V2EncounterKind, layer: number): number {
  const idx = Math.max(0, Math.min(V2_LAYER_COMBAT_BOUNTIES.length - 1, layer - 1));
  return V2_LAYER_COMBAT_BOUNTIES[idx] + V2_ENCOUNTER_TEMPLATES[kind].extraBounty;
}

export function getEncounterImprovedProb(
  kind: V2EncounterKind,
  layer: number,
  allowImproved = true
): number {
  if (!allowImproved) return 0;
  if (kind === 'elite') return V2_ELITE_IMPROVED_PROB;
  const idx = Math.max(0, Math.min(V2_LAYER_IMPROVED_PROBS.length - 1, layer - 1));
  return V2_LAYER_IMPROVED_PROBS[idx];
}
