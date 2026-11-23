import type { EnemyArchetype } from '../../data/nodes';

export type V3BossId = 'boss_anvil' | 'boss_dreadnought' | 'boss_leviathan';

export type V3EnemyIntentKind =
  | 'attack'
  | 'charge'
  | 'heavy_volley'
  | 'pierce_beam'
  | 'shield_regen'
  | 'summon'
  | 'emp'
  | 'ram'
  | 'phase_shift';

export interface V3EnemyIntent {
  readonly kind: V3EnemyIntentKind;
  readonly label: string;
  readonly shortLabel: string;
  readonly damage: number;
  readonly pierceRatio?: number;
  readonly shieldGain?: number;
  readonly empShieldDrain?: number;
  readonly summonCount?: number;
}

export interface V3BossIntentTemplate {
  readonly kind: V3EnemyIntentKind;
  readonly label: string;
  readonly shortLabel: string;
  /** Multiplier applied to the boss unit's current damagePerRound (0 for charge/summon turns) */
  readonly damageMult: number;
  readonly flatDamageOffset?: number;
  readonly pierceRatio?: number;
  readonly shieldGain?: number;
  readonly empShieldDrain?: number;
  readonly summonCount?: number;
}

export interface V3BossSummonSpec {
  readonly name: string;
  readonly spriteArchetype: EnemyArchetype;
  readonly maxHp: number;
  readonly damagePerRound: number;
  readonly armor: number;
  readonly pierceRatio: number;
}

export interface V3BossPhaseDef {
  readonly phaseNumber: 1 | 2 | 3;
  readonly name: string;
  /** Phase triggers when boss HP <= Math.floor(maxHp * hpThresholdRatio); Phase 1 uses 1.0 */
  readonly hpThresholdRatio: number;
  readonly transitionBanner: string;
  readonly summary: string;
  /** Optional armor override applied when entering this phase */
  readonly armorOverride?: number;
  /** Optional immediate enemy shield gained upon entering this phase */
  readonly shieldGainOnEnter?: number;
  /** Optional immediate reinforcement drones summoned upon entering this phase */
  readonly summonOnEnterCount?: number;
  readonly summonSpec?: V3BossSummonSpec;
  /** Optional special intent used specifically on the phase-transition round */
  readonly transitionRoundIntent?: V3BossIntentTemplate;
  /** Repeating deterministic intent cycle for rounds in this phase */
  readonly intentCycle: readonly V3BossIntentTemplate[];
}

export interface V3BossDefinition {
  readonly bossId: V3BossId;
  readonly actNumber: 1 | 2 | 3;
  readonly name: string;
  readonly title: string;
  readonly spriteArchetype: EnemyArchetype;
  readonly initialShield: number;
  readonly maxShield: number;
  readonly phaseCountLabel: string;
  readonly tacticalOverview: string;
  readonly phases: readonly V3BossPhaseDef[];
}

export const V3_BOSS_ORDER: readonly V3BossId[] = [
  'boss_anvil',
  'boss_dreadnought',
  'boss_leviathan',
];

export const V3_BOSS_DEFS: Record<V3BossId, V3BossDefinition> = {
  boss_anvil: {
    bossId: 'boss_anvil',
    actNumber: 1,
    name: '铁砧号',
    title: '第一幕首领 · 铁砧号',
    spriteArchetype: 'hulk',
    initialShield: 0,
    maxShield: 6,
    phaseCountLabel: '2 阶段',
    tacticalOverview: '重甲轨道船坞巨舰：半血展开无人机船坞并切换重击与蓄盾节奏',
    phases: [
      {
        phaseNumber: 1,
        name: '船坞封锁',
        hpThresholdRatio: 1.0,
        transitionBanner: '铁砧号展开主炮封锁阵列！',
        summary: '常规重炮齐射与装甲整备交替推进',
        intentCycle: [
          {
            kind: 'attack',
            label: '重炮齐射',
            shortLabel: '齐射',
            damageMult: 1.0,
          },
          {
            kind: 'shield_regen',
            label: '装甲整备',
            shortLabel: '整备+盾',
            damageMult: 0.75,
            shieldGain: 2,
          },
        ],
      },
      {
        phaseNumber: 2,
        name: '无人机船坞展开',
        hpThresholdRatio: 0.5,
        transitionBanner: '铁砧号进入第 2 阶段：无人机船坞展开！',
        summary: '耐久 ≤50% 释放 2 架船坞无人机并获得护盾，交替重炮压制与装甲蓄盾',
        shieldGainOnEnter: 2,
        summonOnEnterCount: 2,
        summonSpec: {
          name: '铁砧无人机',
          spriteArchetype: 'scout',
          maxHp: 3,
          damagePerRound: 1,
          armor: 0,
          pierceRatio: 0,
        },
        transitionRoundIntent: {
          kind: 'summon',
          label: '船坞展开',
          shortLabel: '召唤',
          damageMult: 0,
        },
        intentCycle: [
          {
            kind: 'heavy_volley',
            label: '重炮压制',
            shortLabel: '重压',
            damageMult: 1.0,
          },
          {
            kind: 'shield_regen',
            label: '装甲蓄能',
            shortLabel: '蓄盾',
            damageMult: 0,
            shieldGain: 3,
          },
        ],
      },
    ],
  },
  boss_dreadnought: {
    bossId: 'boss_dreadnought',
    actNumber: 2,
    name: '铁壁无畏',
    title: '第二幕首领 · 铁壁无畏',
    spriteArchetype: 'boss_dreadnought',
    initialShield: 4,
    maxShield: 8,
    phaseCountLabel: '2 阶段',
    tacticalOverview: '冰晶重甲旗舰：初段厚甲护盾守阵，半血触发护盾过载并蓄能穿甲光束',
    phases: [
      {
        phaseNumber: 1,
        name: '铁壁防线',
        hpThresholdRatio: 1.0,
        transitionBanner: '铁壁无畏启动冰晶重甲防线！',
        summary: '初始 4 点护盾与重甲 2 守阵，交替铁壁齐射与护盾维护',
        intentCycle: [
          {
            kind: 'attack',
            label: '铁壁齐射',
            shortLabel: '齐射',
            damageMult: 1.0,
          },
          {
            kind: 'shield_regen',
            label: '护盾维护',
            shortLabel: '护盾+3',
            damageMult: 0,
            shieldGain: 3,
          },
        ],
      },
      {
        phaseNumber: 2,
        name: '穿甲主炮充能',
        hpThresholdRatio: 0.5,
        transitionBanner: '铁壁无畏进入第 2 阶段：护盾过载，穿甲主炮充能！',
        summary: '耐久 ≤50% 卸甲散热（护甲 2→0）并瞬间过载 +6 护盾，交替蓄力与 50% 穿盾主炮光束',
        armorOverride: 0,
        shieldGainOnEnter: 6,
        transitionRoundIntent: {
          kind: 'charge',
          label: '主炮蓄力',
          shortLabel: '蓄力!',
          damageMult: 0,
        },
        intentCycle: [
          {
            kind: 'charge',
            label: '主炮蓄力',
            shortLabel: '蓄力!',
            damageMult: 0,
          },
          {
            kind: 'pierce_beam',
            label: '穿甲过载光束',
            shortLabel: '穿甲光束',
            damageMult: 1.4,
            pierceRatio: 0.5,
          },
        ],
      },
    ],
  },
  boss_leviathan: {
    bossId: 'boss_leviathan',
    actNumber: 3,
    name: '黑曜利维坦',
    title: '第三幕首领 · 黑曜利维坦',
    spriteArchetype: 'boss_leviathan',
    initialShield: 0,
    maxShield: 8,
    phaseCountLabel: '3 阶段（三阶段）',
    tacticalOverview: '古星门三阶段守护旗舰：护航阵列 → 反应炉暴露（破甲窗口） → 星渊终极齐射',
    phases: [
      {
        phaseNumber: 1,
        name: '护航阵列',
        hpThresholdRatio: 1.0,
        transitionBanner: '黑曜利维坦展开星渊护航阵列！',
        summary: '双护航机协防，两轮穿盾黑曜齐射后进行星渊充能蓄盾',
        intentCycle: [
          {
            kind: 'attack',
            label: '黑曜齐射',
            shortLabel: '穿盾齐射',
            damageMult: 0.7,
            pierceRatio: 0.25,
          },
          {
            kind: 'attack',
            label: '护航集火',
            shortLabel: '穿盾集火',
            damageMult: 0.7,
            pierceRatio: 0.25,
          },
          {
            kind: 'charge',
            label: '星渊充能',
            shortLabel: '充能+盾',
            damageMult: 0,
            shieldGain: 2,
          },
        ],
      },
      {
        phaseNumber: 2,
        name: '反应炉暴露',
        hpThresholdRatio: 0.66,
        transitionBanner: '黑曜利维坦进入第 2 阶段：核心反应炉暴露！',
        summary: '耐久 ≤66% 反应炉暴露（护甲 2→0 易伤窗口），增援星渊无人机并释放 EMP 引力脉冲',
        armorOverride: 0,
        summonOnEnterCount: 1,
        summonSpec: {
          name: '星渊护航无人机',
          spriteArchetype: 'scout',
          maxHp: 3,
          damagePerRound: 1,
          armor: 0,
          pierceRatio: 0,
        },
        transitionRoundIntent: {
          kind: 'charge',
          label: '核心暴露 · 引力蓄能',
          shortLabel: '核心暴露',
          damageMult: 0,
        },
        intentCycle: [
          {
            kind: 'emp',
            label: 'EMP 引力脉冲',
            shortLabel: 'EMP 脉冲',
            damageMult: 0.65,
            pierceRatio: 0.2,
            empShieldDrain: 2,
          },
          {
            kind: 'heavy_volley',
            label: '星渊过载轰击',
            shortLabel: '过载轰击',
            damageMult: 0.75,
            pierceRatio: 0.25,
          },
        ],
      },
      {
        phaseNumber: 3,
        name: '星渊终极齐射',
        hpThresholdRatio: 0.33,
        transitionBanner: '黑曜利维坦进入第 3 阶段：星渊终极齐射！',
        summary: '耐久 ≤33% 应急护盾过载（+2 盾）并蓄力，随后释放高穿盾星渊终极齐射',
        armorOverride: 0,
        shieldGainOnEnter: 2,
        transitionRoundIntent: {
          kind: 'charge',
          label: '星渊终极蓄力',
          shortLabel: '终极蓄力!',
          damageMult: 0,
        },
        intentCycle: [
          {
            kind: 'charge',
            label: '星渊终极蓄力',
            shortLabel: '终极蓄力!',
            damageMult: 0,
            shieldGain: 2,
          },
          {
            kind: 'pierce_beam',
            label: '星渊终极齐射',
            shortLabel: '终极齐射',
            damageMult: 1.15,
            pierceRatio: 0.35,
          },
        ],
      },
    ],
  },
};

export function isV3BossId(id: string | undefined | null): id is V3BossId {
  return id === 'boss_anvil' || id === 'boss_dreadnought' || id === 'boss_leviathan';
}

export function getV3BossDef(bossId: string | undefined | null): V3BossDefinition | null {
  if (isV3BossId(bossId)) {
    return V3_BOSS_DEFS[bossId];
  }
  return null;
}

/**
 * Resolves the authoritative multi-phase Act Boss definition even from minimal persisted fixtures
 * that omit serialized bossPhases metadata.
 */
export function resolveV3BossDefForEncounter(params: {
  readonly encounterKind?: string;
  readonly bossId?: string;
  readonly units?: readonly {
    readonly enemyId: string;
    readonly name: string;
    readonly isBoss?: boolean;
  }[];
}): V3BossDefinition | null {
  const fromExplicit = getV3BossDef(params.bossId) ?? getV3BossDef(params.encounterKind);
  if (fromExplicit) return fromExplicit;
  const units = params.units ?? [];
  for (const u of units) {
    if (!u.isBoss) continue;
    const idLower = u.enemyId.toLowerCase();
    if (idLower.includes('anvil') || u.name.includes('铁砧')) return V3_BOSS_DEFS.boss_anvil;
    if (idLower.includes('dreadnought') || u.name.includes('铁壁无畏')) {
      return V3_BOSS_DEFS.boss_dreadnought;
    }
    if (idLower.includes('leviathan') || u.name.includes('黑曜利维坦')) {
      return V3_BOSS_DEFS.boss_leviathan;
    }
  }
  return null;
}

export function materializeBossIntent(
  tpl: V3BossIntentTemplate,
  baseDamage: number,
  basePierceRatio: number
): V3EnemyIntent {
  const damage =
    tpl.damageMult <= 0
      ? 0
      : Math.max(1, Math.round(baseDamage * tpl.damageMult) + (tpl.flatDamageOffset ?? 0));
  return {
    kind: tpl.kind,
    label: tpl.label,
    shortLabel: tpl.shortLabel,
    damage,
    ...(tpl.pierceRatio !== undefined
      ? { pierceRatio: tpl.pierceRatio }
      : basePierceRatio > 0 && damage > 0
      ? { pierceRatio: basePierceRatio }
      : {}),
    ...(tpl.shieldGain ? { shieldGain: tpl.shieldGain } : {}),
    ...(tpl.empShieldDrain ? { empShieldDrain: tpl.empShieldDrain } : {}),
    ...(tpl.summonCount ? { summonCount: tpl.summonCount } : {}),
  };
}
