import type { EnemyArchetype } from '../../data/nodes';
import type { SeededRng } from '../../domain/rng';
import type { SectorId } from '../domain/types';
import {
  materializeBossIntent,
  resolveV3BossDefForEncounter,
  type V3BossDefinition,
  type V3EnemyIntent,
} from './bosses';
import { getV3SectorDef } from './sectors';

export type V2RegularEncounterKind =
  | 'patrol'
  | 'swarm'
  | 'armored'
  | 'piercer'
  | 'artillery'
  | 'shield_regen'
  | 'drone_carrier'
  | 'emp_disruptor'
  | 'rammer';

export type V2EncounterKind =
  | V2RegularEncounterKind
  | 'patrol_tutorial'
  | 'tutorial_raider'
  | 'elite'
  | 'boss_anvil'
  | 'boss_dreadnought'
  | 'boss_leviathan';

export type V2EnemyUnitRole =
  | 'standard'
  | 'swarm_drone'
  | 'armored'
  | 'piercer'
  | 'artillery'
  | 'shield_regen'
  | 'drone_carrier'
  | 'emp_disruptor'
  | 'rammer'
  | 'boss_anvil'
  | 'boss_dreadnought'
  | 'boss_leviathan'
  | 'elite_flagship';

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
  readonly role?: V2EnemyUnitRole;
  readonly initialShield?: number;
  readonly maxShield?: number;
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
  readonly role?: V2EnemyUnitRole;
  readonly initialShield?: number;
  readonly maxShield?: number;
}

/** Fixed normal combat bounties for layers 1..6 (§9) */
export const V2_LAYER_COMBAT_BOUNTIES: readonly number[] = [6, 10, 14, 20, 28, 40];

/** Improved equipment drop probabilities for layers 1..6 (§9; elite/boss = 0.40) */
export const V2_LAYER_IMPROVED_PROBS: readonly number[] = [0.0, 0.0, 0.1, 0.15, 0.2, 0.25];
export const V2_ELITE_IMPROVED_PROB = 0.4;

export const V2_REGULAR_ENCOUNTER_KINDS: readonly V2RegularEncounterKind[] = [
  'patrol',
  'swarm',
  'armored',
  'piercer',
  'artillery',
  'shield_regen',
  'drone_carrier',
  'emp_disruptor',
  'rammer',
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
        role: 'standard',
      },
    ],
  },
  patrol_tutorial: {
    kind: 'patrol_tutorial',
    name: '教学巡逻靶舰',
    badge: '教学靶舰',
    tacticHint: '14 耐久轻型靶舰：激光炮贴邻能量电池后每轮 7 伤，2 轮击破（少挨 1 轮火力）',
    scaleWithDepth: false,
    extraBounty: 0,
    units: [
      {
        unitIdSuffix: 'patrol_tut_1',
        name: '巡逻靶舰',
        spriteArchetype: 'scout',
        baseHp: 14,
        baseDamage: 2,
        armor: 0,
        pierceRatio: 0,
        role: 'standard',
      },
    ],
  },
  tutorial_raider: {
    kind: 'tutorial_raider',
    name: '封锁拦截艇',
    badge: '甲2 · 穿盾',
    tacticHint: '重甲穿盾拦截艇（7HP / 4穿盾攻 / 装甲2）：伤害完全穿透护盾且减免低伤核心炮；保留激光炮+电池可 2 轮稳赢，卸炮将面临重创或战败风险',
    scaleWithDepth: false,
    extraBounty: 0,
    units: [
      {
        unitIdSuffix: 'tut_raider_1',
        name: '封锁拦截艇',
        spriteArchetype: 'interceptor',
        baseHp: 7,
        baseDamage: 4,
        armor: 2,
        pierceRatio: 1,
        role: 'standard',
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
      {
        unitIdSuffix: 'swarm_1',
        name: '蜂群无人机 A',
        spriteArchetype: 'scout',
        baseHp: 6,
        baseDamage: 1,
        armor: 0,
        pierceRatio: 0,
        role: 'swarm_drone',
      },
      {
        unitIdSuffix: 'swarm_2',
        name: '蜂群无人机 B',
        spriteArchetype: 'scout',
        baseHp: 6,
        baseDamage: 1,
        armor: 0,
        pierceRatio: 0,
        role: 'swarm_drone',
      },
      {
        unitIdSuffix: 'swarm_3',
        name: '蜂群无人机 C',
        spriteArchetype: 'scout',
        baseHp: 6,
        baseDamage: 1,
        armor: 0,
        pierceRatio: 0,
        role: 'swarm_drone',
      },
      {
        unitIdSuffix: 'swarm_4',
        name: '蜂群无人机 D',
        spriteArchetype: 'scout',
        baseHp: 6,
        baseDamage: 1,
        armor: 0,
        pierceRatio: 0,
        role: 'swarm_drone',
      },
    ],
  },
  armored: {
    kind: 'armored',
    name: '装甲护卫舰',
    badge: '重甲 2',
    tacticHint: '逐发减伤 2 点（最低 1）；重炮单发高伤或聚焦校准破甲占优',
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
        role: 'armored',
      },
    ],
  },
  piercer: {
    kind: 'piercer',
    name: '穿盾猎手',
    badge: '50%穿盾',
    tacticHint: '每轮半数伤害直接穿透护盾（不计入反击吸收）；紧急护盾可减半穿盾比例',
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
        role: 'piercer',
      },
    ],
  },
  artillery: {
    kind: 'artillery',
    name: '轨道火炮舰',
    badge: '蓄力重炮',
    tacticHint: '奇数轮蓄力瞄准（0 伤），偶数轮发射高伤穿盾重炮齐射；可在偶数轮施放紧急护盾格挡',
    scaleWithDepth: true,
    extraBounty: 3,
    units: [
      {
        unitIdSuffix: 'artillery_1',
        name: '轨道火炮舰',
        spriteArchetype: 'frigate',
        baseHp: 24,
        baseDamage: 4,
        armor: 1,
        pierceRatio: 0.25,
        role: 'artillery',
      },
    ],
  },
  shield_regen: {
    kind: 'shield_regen',
    name: '自愈护盾舰',
    badge: '护盾再生',
    tacticHint: '开战自带偏导护盾，偶数轮自动充能再生护盾；建议配合火力过载或聚焦校准速破',
    scaleWithDepth: true,
    extraBounty: 3,
    units: [
      {
        unitIdSuffix: 'shield_regen_1',
        name: '自愈护盾舰',
        spriteArchetype: 'frigate',
        baseHp: 21,
        baseDamage: 3,
        armor: 0,
        pierceRatio: 0,
        role: 'shield_regen',
        initialShield: 5,
        maxShield: 8,
      },
    ],
  },
  drone_carrier: {
    kind: 'drone_carrier',
    name: '无人机母舰',
    badge: '召唤增援',
    tacticHint: '重型废船改装母舰，周期性放出护航无人机（最多维持 4 目标）；优先点杀母舰可阻断增援',
    scaleWithDepth: true,
    extraBounty: 4,
    units: [
      {
        unitIdSuffix: 'carrier_core',
        name: '无人机母舰',
        spriteArchetype: 'hulk',
        baseHp: 24,
        baseDamage: 2,
        armor: 1,
        pierceRatio: 0,
        role: 'drone_carrier',
      },
      {
        unitIdSuffix: 'carrier_drone_1',
        name: '母舰无人机 A',
        spriteArchetype: 'scout',
        baseHp: 5,
        baseDamage: 1,
        armor: 0,
        pierceRatio: 0,
        role: 'swarm_drone',
      },
    ],
  },
  emp_disruptor: {
    kind: 'emp_disruptor',
    name: '电磁干扰舰',
    badge: 'EMP 削盾',
    tacticHint: '奇数轮释放电磁干扰脉冲削减我方 3 点护盾并附带穿盾伤害；货船「舱壁抢修」可免疫当轮 EMP',
    scaleWithDepth: true,
    extraBounty: 3,
    units: [
      {
        unitIdSuffix: 'emp_1',
        name: '电磁干扰舰',
        spriteArchetype: 'interceptor',
        baseHp: 21,
        baseDamage: 3,
        armor: 0,
        pierceRatio: 0.25,
        role: 'emp_disruptor',
      },
    ],
  },
  rammer: {
    kind: 'rammer',
    name: '冲撞突击艇',
    badge: '加速撞击',
    tacticHint: '奇数轮推进加速压制，偶数轮高速舰首撞击（高伤 + 30% 穿盾）；预判偶数轮抬盾或先手击毁',
    scaleWithDepth: true,
    extraBounty: 3,
    units: [
      {
        unitIdSuffix: 'rammer_1',
        name: '冲撞突击艇',
        spriteArchetype: 'interceptor',
        baseHp: 23,
        baseDamage: 3,
        armor: 1,
        pierceRatio: 0,
        role: 'rammer',
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
        role: 'elite_flagship',
      },
      {
        unitIdSuffix: 'elite_escort_1',
        name: '护航截击机 A',
        spriteArchetype: 'interceptor',
        baseHp: 8,
        baseDamage: 1,
        armor: 0,
        pierceRatio: 0,
        role: 'standard',
      },
      {
        unitIdSuffix: 'elite_escort_2',
        name: '护航截击机 B',
        spriteArchetype: 'interceptor',
        baseHp: 8,
        baseDamage: 1,
        armor: 0,
        pierceRatio: 0,
        role: 'standard',
      },
    ],
  },
  boss_anvil: {
    kind: 'boss_anvil',
    name: '第一幕首领 · 铁砧号',
    badge: '★ 第一幕首领 · 2 阶段',
    tacticHint: '近轨重甲船坞巨舰「铁砧号」（2 阶段）：半血展开无人机船坞，击败后解锁冰晶舰冢带',
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
        role: 'boss_anvil',
        initialShield: 0,
        maxShield: 6,
      },
      {
        unitIdSuffix: 'boss_anvil_escort_1',
        name: '近轨护航机 A',
        spriteArchetype: 'interceptor',
        baseHp: 8,
        baseDamage: 1,
        armor: 0,
        pierceRatio: 0,
        role: 'standard',
      },
      {
        unitIdSuffix: 'boss_anvil_escort_2',
        name: '近轨护航机 B',
        spriteArchetype: 'interceptor',
        baseHp: 8,
        baseDamage: 1,
        armor: 0,
        pierceRatio: 0,
        role: 'standard',
      },
    ],
  },
  boss_dreadnought: {
    kind: 'boss_dreadnought',
    name: '第二幕首领 · 铁壁无畏',
    badge: '★ 第二幕首领 · 2 阶段',
    tacticHint: '冰晶重甲旗舰「铁壁无畏」（2 阶段）：半血触发护盾过载并蓄能 50% 穿盾主炮光束',
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
        role: 'boss_dreadnought',
        initialShield: 4,
        maxShield: 8,
      },
      {
        unitIdSuffix: 'boss_dreadnought_escort_1',
        name: '冰晶护卫艇 A',
        spriteArchetype: 'interceptor',
        baseHp: 9,
        baseDamage: 1,
        armor: 0,
        pierceRatio: 0,
        role: 'standard',
      },
      {
        unitIdSuffix: 'boss_dreadnought_escort_2',
        name: '冰晶护卫艇 B',
        spriteArchetype: 'interceptor',
        baseHp: 9,
        baseDamage: 1,
        armor: 0,
        pierceRatio: 0,
        role: 'standard',
      },
    ],
  },
  boss_leviathan: {
    kind: 'boss_leviathan',
    name: '第三幕首领 · 黑曜利维坦',
    badge: '★ 第三幕首领 · 三阶段',
    tacticHint: '古星门守护旗舰「黑曜利维坦」（3 阶段）：护航阵列 → 反应炉暴露 → 星渊终极齐射',
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
        role: 'boss_leviathan',
        initialShield: 0,
        maxShield: 8,
      },
      {
        unitIdSuffix: 'boss_leviathan_escort_1',
        name: '星渊护航机 A',
        spriteArchetype: 'interceptor',
        baseHp: 10,
        baseDamage: 1,
        armor: 0,
        pierceRatio: 0,
        role: 'standard',
      },
      {
        unitIdSuffix: 'boss_leviathan_escort_2',
        name: '星渊护航机 B',
        spriteArchetype: 'interceptor',
        baseHp: 10,
        baseDamage: 1,
        armor: 0,
        pierceRatio: 0,
        role: 'standard',
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

export function isActBossEncounterKind(kind: string): boolean {
  return kind === 'boss_anvil' || kind === 'boss_dreadnought' || kind === 'boss_leviathan';
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
    const scaledShield =
      u.initialShield !== undefined && u.initialShield > 0
        ? Math.max(1, Math.round(u.initialShield * (tpl.scaleWithDepth ? mult : 1)))
        : undefined;
    const scaledMaxShield =
      u.maxShield !== undefined && u.maxShield > 0
        ? Math.max(scaledShield ?? 0, Math.round(u.maxShield * (tpl.scaleWithDepth ? mult : 1)))
        : undefined;
    return {
      enemyId: `${nodeId}_${u.unitIdSuffix}`,
      name: useLeviathanVisual && u.isBoss ? '黑曜旗舰护卫' : u.name,
      spriteArchetype,
      maxHp: Math.max(1, Math.round(u.baseHp * mult)),
      damagePerRound: scaledDamage,
      armor: u.armor, // Armor never scales with depth (§8.3)
      pierceRatio: u.pierceRatio,
      isBoss: u.isBoss,
      ...(u.role ? { role: u.role } : {}),
      ...(scaledShield !== undefined ? { initialShield: scaledShield } : {}),
      ...(scaledMaxShield !== undefined ? { maxShield: scaledMaxShield } : {}),
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

/**
 * Resolves a unit's tactical intent role even when loaded from minimal persisted fixtures
 * that omit `role` metadata.
 */
export function resolveUnitIntentRole(
  unit: Pick<V2EnemyUnitSpec, 'enemyId' | 'name' | 'isBoss' | 'role' | 'armor' | 'pierceRatio' | 'spriteArchetype'>,
  encounterKind?: string,
  bossId?: string
): V2EnemyUnitRole {
  if (unit.role) return unit.role;
  const idLower = unit.enemyId.toLowerCase();
  if (unit.isBoss) {
    if (bossId === 'boss_anvil' || encounterKind === 'boss_anvil' || idLower.includes('anvil') || unit.name.includes('铁砧')) {
      return 'boss_anvil';
    }
    if (
      bossId === 'boss_dreadnought' ||
      encounterKind === 'boss_dreadnought' ||
      idLower.includes('dreadnought') ||
      unit.name.includes('铁壁无畏')
    ) {
      return 'boss_dreadnought';
    }
    if (
      bossId === 'boss_leviathan' ||
      encounterKind === 'boss_leviathan' ||
      idLower.includes('leviathan') ||
      unit.name.includes('黑曜利维坦')
    ) {
      return 'boss_leviathan';
    }
    return 'elite_flagship';
  }
  if (idLower.includes('artillery') || unit.name.includes('火炮')) return 'artillery';
  if (idLower.includes('shield_regen') || unit.name.includes('自愈') || unit.name.includes('护盾舰')) {
    return 'shield_regen';
  }
  if (idLower.includes('carrier_core') || idLower.includes('drone_carrier') || unit.name.includes('母舰')) {
    return 'drone_carrier';
  }
  if (idLower.includes('emp') || unit.name.includes('电磁') || unit.name.includes('干扰')) {
    return 'emp_disruptor';
  }
  if (idLower.includes('rammer') || unit.name.includes('冲撞') || unit.name.includes('突击艇')) {
    return 'rammer';
  }
  if (idLower.includes('drone') || idLower.includes('swarm') || unit.name.includes('无人机')) {
    return 'swarm_drone';
  }
  if (encounterKind === 'artillery') return 'artillery';
  if (encounterKind === 'shield_regen') return 'shield_regen';
  if (encounterKind === 'drone_carrier' && unit.spriteArchetype === 'hulk') return 'drone_carrier';
  if (encounterKind === 'emp_disruptor') return 'emp_disruptor';
  if (encounterKind === 'rammer') return 'rammer';
  if (encounterKind === 'piercer' || unit.pierceRatio >= 0.4) return 'piercer';
  if (encounterKind === 'armored' || unit.armor >= 2) return 'armored';
  if (encounterKind === 'swarm') return 'swarm_drone';
  return 'standard';
}

export function resolveUnitInitialShield(
  unit: Pick<V2EnemyUnitSpec, 'enemyId' | 'name' | 'isBoss' | 'role' | 'armor' | 'pierceRatio' | 'spriteArchetype' | 'initialShield' | 'maxShield'>,
  encounterKind?: string,
  bossId?: string
): { readonly shield: number; readonly maxShield: number } {
  if (unit.initialShield !== undefined || unit.maxShield !== undefined) {
    const shield = Math.max(0, Math.floor(unit.initialShield ?? 0));
    const maxShield = Math.max(shield, Math.floor(unit.maxShield ?? shield));
    return { shield, maxShield };
  }
  const role = resolveUnitIntentRole(unit, encounterKind, bossId);
  if (role === 'shield_regen') return { shield: 5, maxShield: 8 };
  if (role === 'boss_dreadnought') return { shield: 4, maxShield: 8 };
  if (role === 'boss_anvil') return { shield: 0, maxShield: 6 };
  if (role === 'boss_leviathan') return { shield: 0, maxShield: 8 };
  return { shield: 0, maxShield: 0 };
}

/**
 * Pure single-source-of-truth telegraphed intent resolver shared by `simulateV2Combat`,
 * `tacticalDelta`, `CombatView`, `MapView`, and `V2CombatScene`.
 */
export function resolveUnitIntentForRound(params: {
  readonly unit: Pick<
    V2EnemyUnitSpec,
    'enemyId' | 'name' | 'damagePerRound' | 'armor' | 'pierceRatio' | 'isBoss' | 'role' | 'spriteArchetype'
  >;
  readonly round: number;
  readonly bossDef?: V3BossDefinition | null;
  readonly currentPhase?: number;
  readonly phaseStartedRound?: number;
  readonly isTransitionRound?: boolean;
  readonly encounterKind?: string;
  readonly bossId?: string;
}): V3EnemyIntent {
  const { unit, round } = params;
  const r = Math.max(1, Math.floor(round));
  const baseDmg = Math.max(1, unit.damagePerRound);
  const role = resolveUnitIntentRole(unit, params.encounterKind, params.bossId);

  if (unit.isBoss) {
    const bossDef =
      params.bossDef ??
      resolveV3BossDefForEncounter({
        encounterKind: params.encounterKind,
        bossId: params.bossId,
        units: [unit],
      });
    if (bossDef) {
      const phaseNum = Math.max(1, Math.min(bossDef.phases.length, params.currentPhase ?? 1));
      const phaseDef = bossDef.phases[phaseNum - 1] ?? bossDef.phases[0];
      if (params.isTransitionRound && phaseDef.transitionRoundIntent) {
        return materializeBossIntent(phaseDef.transitionRoundIntent, baseDmg, unit.pierceRatio);
      }
      const startR = Math.max(1, params.phaseStartedRound ?? 1);
      const offset = phaseDef.transitionRoundIntent && phaseNum > 1 ? 1 : 0;
      const stepIdx = Math.max(0, r - startR - offset) % phaseDef.intentCycle.length;
      const tpl = phaseDef.intentCycle[stepIdx];
      return materializeBossIntent(tpl, baseDmg, unit.pierceRatio);
    }
  }

  switch (role) {
    case 'artillery': {
      if (r % 2 === 1) {
        return {
          kind: 'charge',
          label: '蓄力瞄准',
          shortLabel: '蓄力!',
          damage: 0,
        };
      }
      return {
        kind: 'heavy_volley',
        label: '重炮齐射',
        shortLabel: '重炮齐射',
        damage: Math.max(2, Math.round(baseDmg * 1.75)),
        pierceRatio: Math.max(0.25, unit.pierceRatio),
      };
    }
    case 'shield_regen': {
      if (r % 2 === 1) {
        return {
          kind: 'attack',
          label: '标准齐射',
          shortLabel: '齐射',
          damage: baseDmg,
          ...(unit.pierceRatio > 0 ? { pierceRatio: unit.pierceRatio } : {}),
        };
      }
      return {
        kind: 'shield_regen',
        label: '护盾充能',
        shortLabel: '护盾+4',
        damage: Math.max(1, Math.round(baseDmg * 0.67)),
        shieldGain: 4,
        ...(unit.pierceRatio > 0 ? { pierceRatio: unit.pierceRatio } : {}),
      };
    }
    case 'drone_carrier': {
      const step = (r - 1) % 3;
      if (step === 1) {
        return {
          kind: 'summon',
          label: '召唤无人机',
          shortLabel: '召唤',
          damage: 0,
          summonCount: 1,
        };
      }
      return {
        kind: 'attack',
        label: step === 0 ? '母舰齐射' : '压制火力',
        shortLabel: '齐射',
        damage: baseDmg,
      };
    }
    case 'emp_disruptor': {
      if (r % 2 === 1) {
        return {
          kind: 'emp',
          label: 'EMP 干扰脉冲',
          shortLabel: 'EMP 削盾',
          damage: Math.max(1, Math.round(baseDmg * 0.75)),
          pierceRatio: Math.max(0.25, unit.pierceRatio),
          empShieldDrain: 3,
        };
      }
      return {
        kind: 'attack',
        label: '穿盾点射',
        shortLabel: '穿盾点射',
        damage: baseDmg,
        pierceRatio: Math.max(0.25, unit.pierceRatio),
      };
    }
    case 'rammer': {
      if (r % 2 === 1) {
        return {
          kind: 'charge',
          label: '推进加速',
          shortLabel: '加速!',
          damage: Math.max(1, Math.round(baseDmg * 0.5)),
        };
      }
      return {
        kind: 'ram',
        label: '舰首撞击',
        shortLabel: '撞击',
        damage: Math.max(2, Math.round(baseDmg * 1.65)),
        pierceRatio: Math.max(0.3, unit.pierceRatio),
      };
    }
    case 'piercer':
      return {
        kind: 'attack',
        label: '穿盾点射',
        shortLabel: '穿盾',
        damage: baseDmg,
        pierceRatio: unit.pierceRatio > 0 ? unit.pierceRatio : 0.5,
      };
    case 'armored':
      return {
        kind: 'attack',
        label: '稳态炮击',
        shortLabel: '稳态攻',
        damage: baseDmg,
      };
    case 'swarm_drone':
      return {
        kind: 'attack',
        label: '蜂群点射',
        shortLabel: '点射',
        damage: baseDmg,
      };
    default:
      return {
        kind: 'attack',
        label: unit.pierceRatio > 0 ? '穿盾齐射' : '常规齐射',
        shortLabel: unit.pierceRatio > 0 ? '穿盾攻' : '齐射',
        damage: baseDmg,
        ...(unit.pierceRatio > 0 ? { pierceRatio: unit.pierceRatio } : {}),
      };
  }
}

/**
 * Returns the telegraphed opening intent cycle (1..3 rounds) for Pre-Combat HUD display.
 */
export function getUnitIntentCyclePreview(
  unit: Pick<
    V2EnemyUnitSpec,
    'enemyId' | 'name' | 'damagePerRound' | 'armor' | 'pierceRatio' | 'isBoss' | 'role' | 'spriteArchetype'
  >,
  encounterKind?: string,
  bossId?: string
): readonly V3EnemyIntent[] {
  const role = resolveUnitIntentRole(unit, encounterKind, bossId);
  const bossDef = unit.isBoss
    ? resolveV3BossDefForEncounter({ encounterKind, bossId, units: [unit] })
    : null;

  let cycleLen = 1;
  if (bossDef) {
    cycleLen = bossDef.phases[0].intentCycle.length;
  } else if (role === 'drone_carrier') {
    cycleLen = 3;
  } else if (
    role === 'artillery' ||
    role === 'shield_regen' ||
    role === 'emp_disruptor' ||
    role === 'rammer'
  ) {
    cycleLen = 2;
  }

  const out: V3EnemyIntent[] = [];
  for (let r = 1; r <= cycleLen; r++) {
    out.push(
      resolveUnitIntentForRound({
        unit,
        round: r,
        bossDef,
        currentPhase: 1,
        phaseStartedRound: 1,
        encounterKind,
        bossId,
      })
    );
  }
  return out;
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

/**
 * M3 expanded sector regular-enemy weights (blended cleanly with `getV3SectorDef(sectorId).encounterWeights`
 * without modifying `src/v2/data/sectors.ts`).
 */
const V3_EXPANDED_SECTOR_REGULAR_WEIGHTS: Record<
  SectorId,
  Readonly<Record<'artillery' | 'shield_regen' | 'drone_carrier' | 'emp_disruptor' | 'rammer', number>>
> = {
  near_orbit: {
    artillery: 1,
    shield_regen: 1,
    drone_carrier: 1,
    emp_disruptor: 1,
    rammer: 1,
  },
  frozen_graveyard: {
    artillery: 3,
    shield_regen: 3,
    drone_carrier: 2,
    emp_disruptor: 2,
    rammer: 1,
  },
  stargate_abyss: {
    artillery: 3,
    shield_regen: 2,
    drone_carrier: 3,
    emp_disruptor: 3,
    rammer: 2,
  },
};

function pickWeightedRegularKindForSector(
  sectorId: SectorId,
  rng: SeededRng
): V2RegularEncounterKind {
  const sector = getV3SectorDef(sectorId);
  const classic = sector.encounterWeights;
  const expanded = V3_EXPANDED_SECTOR_REGULAR_WEIGHTS[sectorId] ?? V3_EXPANDED_SECTOR_REGULAR_WEIGHTS.near_orbit;

  const weights: Record<V2RegularEncounterKind, number> = {
    patrol: classic.patrol,
    swarm: classic.swarm,
    armored: classic.armored,
    piercer: classic.piercer,
    artillery: expanded.artillery,
    shield_regen: expanded.shield_regen,
    drone_carrier: expanded.drone_carrier,
    emp_disruptor: expanded.emp_disruptor,
    rammer: expanded.rammer,
  };

  let total = 0;
  for (const kind of V2_REGULAR_ENCOUNTER_KINDS) {
    total += Math.max(0, weights[kind]);
  }
  if (total <= 0) return rng.pick(V2_REGULAR_ENCOUNTER_KINDS);
  let roll = rng.nextFloat() * total;
  for (const kind of V2_REGULAR_ENCOUNTER_KINDS) {
    roll -= Math.max(0, weights[kind]);
    if (roll < 0) return kind;
  }
  return V2_REGULAR_ENCOUNTER_KINDS[V2_REGULAR_ENCOUNTER_KINDS.length - 1];
}

/**
 * Interface Contract #3 Pluggable Sector Enemy Registry Hook.
 * Called by `routeGenerator.ts` so M3 expands the enemy roster to 9 regular types + 3 multi-phase Act Bosses
 * strictly inside `src/v2/data/enemies.ts` & `src/v2/data/bosses.ts`.
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
    } else {
      encounterKind = pickWeightedRegularKindForSector(sectorId, rng);
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
