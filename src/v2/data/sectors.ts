import type { SectorBgIndex } from '../../data/nodes';
import { SeededRng } from '../../domain/rng';
import type { CampaignActId, SectorId } from '../domain/types';

export type SectorEnvModifierId = 'none' | 'cryo_ion' | 'gravity_tide';

export type SectorBossId = 'boss_anvil' | 'boss_dreadnought' | 'boss_leviathan';

export interface SectorEnvModifierDef {
  readonly id: SectorEnvModifierId;
  readonly name: string;
  readonly shortBadge: string;
  readonly description: string;
  readonly combatRuleSummary: string;
}

export interface SectorDefinition {
  readonly id: SectorId;
  readonly order: 1 | 2 | 3;
  readonly name: string;
  readonly shortName: string;
  readonly actId: CampaignActId;
  readonly subtitle: string;
  readonly description: string;
  readonly primaryBgIndex: SectorBgIndex;
  readonly layerBgIndices: readonly [
    SectorBgIndex,
    SectorBgIndex,
    SectorBgIndex,
    SectorBgIndex,
    SectorBgIndex,
    SectorBgIndex,
  ];
  readonly envModifier: SectorEnvModifierDef;
  readonly bossId: SectorBossId;
  readonly bossName: string;
  readonly signatureRelicIds: readonly string[];
  readonly enemyHpMult: number;
  readonly enemyDmgAdd: number;
  readonly bountyMult: number;
  readonly cargoPriceMult: number;
  readonly improvedProbBonus: number;
  readonly relicDropChanceDeep: number;
  readonly encounterWeights: Readonly<Record<'patrol' | 'swarm' | 'armored' | 'piercer', number>>;
  readonly unlockRequirementText: string;
}

export const V3_SECTOR_ORDER: readonly SectorId[] = [
  'near_orbit',
  'frozen_graveyard',
  'stargate_abyss',
];

export const V3_SECTORS: Record<SectorId, SectorDefinition> = {
  near_orbit: {
    id: 'near_orbit',
    order: 1,
    name: '近轨残骸带',
    shortName: '近轨带',
    actId: 'act1',
    subtitle: '第一幕 · 轨道拆解主航道',
    description:
      '拆解站外围的密集残骸航道，空间环境平稳，适合建立初期体系并追踪第一幕首领「铁砧号」。',
    primaryBgIndex: 1,
    layerBgIndices: [1, 1, 2, 2, 4, 4],
    envModifier: {
      id: 'none',
      name: '标准近轨航道',
      shortBadge: '标准环境',
      description: '磁场与引力均处于安全区间，无额外环境减益或增幅。',
      combatRuleSummary: '标准战斗规则，按舰船配装与克制关系结算。',
    },
    bossId: 'boss_anvil',
    bossName: '铁砧号',
    signatureRelicIds: ['ancient_navigator'],
    enemyHpMult: 1.0,
    enemyDmgAdd: 0,
    bountyMult: 1.0,
    cargoPriceMult: 1.0,
    improvedProbBonus: 0,
    relicDropChanceDeep: 0.12,
    encounterWeights: {
      patrol: 1,
      swarm: 1,
      armored: 1,
      piercer: 1,
    },
    unlockRequirementText: '默认开放',
  },
  frozen_graveyard: {
    id: 'frozen_graveyard',
    order: 2,
    name: '冰晶舰冢带',
    shortName: '冰晶冢',
    actId: 'act2',
    subtitle: '第二幕 · 低温电离封锁区',
    description:
      '旧舰队残骸与冰晶尘云交织的高危坟场，低温电离场会持续压制护盾，但高价货物与优良装备产出显著提高。',
    primaryBgIndex: 5,
    layerBgIndices: [4, 4, 5, 5, 3, 3],
    envModifier: {
      id: 'cryo_ion',
      name: '低温电离场',
      shortBadge: '低温电离 · 护盾压制',
      description: '低温冰晶离子云干扰护盾发生器：开战初始护盾 -2，偶数回合末剩余护盾衰减 2 点（不伤及船体耐久）。',
      combatRuleSummary: '开战初始护盾 -2；偶数回合末剩余护盾 -2（最低至 0，不扣耐久）。',
    },
    bossId: 'boss_dreadnought',
    bossName: '铁壁无畏',
    signatureRelicIds: ['cryo_amber', 'quantum_core'],
    enemyHpMult: 1.15,
    enemyDmgAdd: 1,
    bountyMult: 1.25,
    cargoPriceMult: 1.2,
    improvedProbBonus: 0.08,
    relicDropChanceDeep: 0.18,
    encounterWeights: {
      patrol: 1,
      swarm: 2,
      armored: 2,
      piercer: 2,
    },
    unlockRequirementText: '击败第一幕首领「铁砧号」解锁',
  },
  stargate_abyss: {
    id: 'stargate_abyss',
    order: 3,
    name: '古代星门禁区',
    shortName: '星门禁区',
    actId: 'act3',
    subtitle: '第三幕 · 引力潮汐核心区',
    description:
      '环绕失活古星门的深渊禁区，周期性引力潮汐会同时放大双方火力，是夺回黑曜冠徽并挑战「黑曜利维坦」的最终航域。',
    primaryBgIndex: 6,
    layerBgIndices: [3, 3, 5, 5, 6, 6],
    envModifier: {
      id: 'gravity_tide',
      name: '引力潮汐',
      shortBadge: '引力潮汐 · 偶数轮高潮',
      description: '古星门残余引力在偶数回合掀起高潮：我方首次直击伤害 +2，同时每架存活敌舰攻击 +1；奇数回合恢复平缓。',
      combatRuleSummary: '偶数回合高潮涌动：我方首次直击 +2 伤，存活敌舰每次攻击 +1 伤；奇数回合平缓。',
    },
    bossId: 'boss_leviathan',
    bossName: '黑曜利维坦',
    signatureRelicIds: ['obsidian_crown', 'quantum_core'],
    enemyHpMult: 1.3,
    enemyDmgAdd: 1,
    bountyMult: 1.5,
    cargoPriceMult: 1.35,
    improvedProbBonus: 0.15,
    relicDropChanceDeep: 0.24,
    encounterWeights: {
      patrol: 1,
      swarm: 2,
      armored: 3,
      piercer: 3,
    },
    unlockRequirementText: '击败第二幕首领「铁壁无畏」解锁',
  },
};

export function getV3SectorDef(sectorId: SectorId | string | undefined): SectorDefinition {
  if (sectorId && Object.prototype.hasOwnProperty.call(V3_SECTORS, sectorId)) {
    return V3_SECTORS[sectorId as SectorId];
  }
  return V3_SECTORS.near_orbit;
}

// ============================================================================
// F18 — Endless Abyss (威压 1–10) & Deterministic Mutator Catalog
// ============================================================================

export const MAX_ENDLESS_THREAT = 10;

export type EndlessMutatorId =
  | 'ion_surge'
  | 'armored_hull'
  | 'overclocked_salvo'
  | 'aegis_protocol'
  | 'pierce_barrage'
  | 'volatile_salvage';

export interface V3EndlessMutatorDef {
  readonly id: EndlessMutatorId;
  readonly name: string;
  readonly shortBadge: string;
  readonly description: string;
  readonly combatRuleSummary: string;
  readonly openingShieldPenalty: number;
  readonly evenRoundShieldDrain: number;
  readonly enemyArmorBonus: number;
  readonly enemyDamageBonus: number;
  readonly enemyOpeningShield: number;
  readonly enemyPierceBonus: number;
  readonly enemyHpBonusPct: number;
  readonly bountyMultBonus: number;
  readonly salvagePartsPerWin: number;
}

export const V3_ENDLESS_MUTATOR_ORDER: readonly EndlessMutatorId[] = [
  'ion_surge',
  'armored_hull',
  'overclocked_salvo',
  'aegis_protocol',
  'pierce_barrage',
  'volatile_salvage',
];

export const V3_ENDLESS_MUTATORS: Record<EndlessMutatorId, V3EndlessMutatorDef> = {
  ion_surge: {
    id: 'ion_surge',
    name: '电离过载',
    shortBadge: '电离词条 · 护盾削弱',
    description: '深渊电离风暴持续干扰护盾矩阵：开战初始护盾 -2，偶数回合末额外衰减 1 点余盾；击破赏金 +15%。',
    combatRuleSummary: '开战初始护盾 -2，偶数回合末余盾 -1；战斗赏金 +15%',
    openingShieldPenalty: 2,
    evenRoundShieldDrain: 1,
    enemyArmorBonus: 0,
    enemyDamageBonus: 0,
    enemyOpeningShield: 0,
    enemyPierceBonus: 0,
    enemyHpBonusPct: 0,
    bountyMultBonus: 0.15,
    salvagePartsPerWin: 0,
  },
  armored_hull: {
    id: 'armored_hull',
    name: '重甲编队',
    shortBadge: '重甲词条 · 敌甲 +1',
    description: '深渊巡弋舰队加装额外复合装甲：非蜂群敌舰护甲 +1；每场战斗胜利额外回收 +2 精密零件。',
    combatRuleSummary: '非蜂群敌舰护甲 +1；每战胜利额外 +2 精密零件',
    openingShieldPenalty: 0,
    evenRoundShieldDrain: 0,
    enemyArmorBonus: 1,
    enemyDamageBonus: 0,
    enemyOpeningShield: 0,
    enemyPierceBonus: 0,
    enemyHpBonusPct: 0,
    bountyMultBonus: 0.1,
    salvagePartsPerWin: 2,
  },
  overclocked_salvo: {
    id: 'overclocked_salvo',
    name: '超频敌火',
    shortBadge: '火力词条 · 敌攻 +1',
    description: '敌舰武器阵列进入超频状态：每次敌方直击伤害 +1；击破赏金 +20%。',
    combatRuleSummary: '敌舰直击攻击 +1；战斗赏金 +20%',
    openingShieldPenalty: 0,
    evenRoundShieldDrain: 0,
    enemyArmorBonus: 0,
    enemyDamageBonus: 1,
    enemyOpeningShield: 0,
    enemyPierceBonus: 0,
    enemyHpBonusPct: 0,
    bountyMultBonus: 0.2,
    salvagePartsPerWin: 0,
  },
  aegis_protocol: {
    id: 'aegis_protocol',
    name: '偏导矩阵',
    shortBadge: '偏导词条 · 敌盾 +3',
    description: '深渊敌舰开战同步激活偏导护盾：所有敌舰初始获得 +3 护盾；击破赏金 +15%。',
    combatRuleSummary: '敌舰开战 +3 护盾；战斗赏金 +15%',
    openingShieldPenalty: 0,
    evenRoundShieldDrain: 0,
    enemyArmorBonus: 0,
    enemyDamageBonus: 0,
    enemyOpeningShield: 3,
    enemyPierceBonus: 0,
    enemyHpBonusPct: 0,
    bountyMultBonus: 0.15,
    salvagePartsPerWin: 0,
  },
  pierce_barrage: {
    id: 'pierce_barrage',
    name: '穿盾校准',
    shortBadge: '穿盾词条 · 穿盾 +15%',
    description: '敌舰弹道搭载星渊穿盾模组：敌方攻击穿盾比例 +15%（上限 65%）；每战胜利额外 +3 精密零件。',
    combatRuleSummary: '敌方穿盾比例 +15%（上限 65%）；每战胜利 +3 精密零件',
    openingShieldPenalty: 0,
    evenRoundShieldDrain: 0,
    enemyArmorBonus: 0,
    enemyDamageBonus: 0,
    enemyOpeningShield: 0,
    enemyPierceBonus: 0.15,
    enemyHpBonusPct: 0,
    bountyMultBonus: 0.1,
    salvagePartsPerWin: 3,
  },
  volatile_salvage: {
    id: 'volatile_salvage',
    name: '高危残骸潮',
    shortBadge: '高危词条 · 敌耐久 +15%',
    description: '高能深渊残骸裹挟强化舰体：敌舰耐久 +15%；击破赏金 +25% 且每战胜利额外 +2 精密零件。',
    combatRuleSummary: '敌舰耐久 +15%；战斗赏金 +25% 且每战 +2 精密零件',
    openingShieldPenalty: 0,
    evenRoundShieldDrain: 0,
    enemyArmorBonus: 0,
    enemyDamageBonus: 0,
    enemyOpeningShield: 0,
    enemyPierceBonus: 0,
    enemyHpBonusPct: 0.15,
    bountyMultBonus: 0.25,
    salvagePartsPerWin: 2,
  },
};

export function isEndlessMutatorId(id: string | undefined | null): id is EndlessMutatorId {
  return Boolean(id && Object.prototype.hasOwnProperty.call(V3_ENDLESS_MUTATORS, id));
}

export function getV3EndlessMutatorDef(id: string | undefined | null): V3EndlessMutatorDef | null {
  if (isEndlessMutatorId(id)) {
    return V3_ENDLESS_MUTATORS[id];
  }
  return null;
}

export function getEndlessMutatorCountForThreat(threat: number): number {
  const clamped = Math.max(0, Math.min(MAX_ENDLESS_THREAT, Math.floor(threat)));
  if (clamped <= 0) return 0;
  if (clamped <= 3) return 1;
  if (clamped <= 6) return 2;
  return 3;
}

/**
 * Deterministically rolls distinct Endless Abyss mutators from `(seed, threat)`.
 * Threat 0 -> 0 mutators; Threat 1..3 -> 1; Threat 4..6 -> 2; Threat 7..10 -> 3.
 */
export function rollEndlessMutators(
  seed: number,
  threat: number
): readonly EndlessMutatorId[] {
  const count = getEndlessMutatorCountForThreat(threat);
  if (count <= 0) return [];
  const safeSeed = Number.isFinite(seed) ? seed >>> 0 : 1;
  const clampedThreat = Math.max(1, Math.min(MAX_ENDLESS_THREAT, Math.floor(threat)));
  const mixedSeed =
    (safeSeed ^ Math.imul(clampedThreat, 0x9e3779b1) ^ 0x517cc1b7) >>> 0;
  const rng = new SeededRng(mixedSeed);
  const pool: EndlessMutatorId[] = [...V3_ENDLESS_MUTATOR_ORDER];
  const chosen: EndlessMutatorId[] = [];
  while (chosen.length < count && pool.length > 0) {
    const idx = rng.nextInt(pool.length);
    chosen.push(pool.splice(idx, 1)[0]);
  }
  return chosen;
}

export interface AggregatedEndlessMutatorEffects {
  readonly activeIds: readonly EndlessMutatorId[];
  readonly openingShieldPenalty: number;
  readonly evenRoundShieldDrain: number;
  readonly enemyArmorBonus: number;
  readonly enemyDamageBonus: number;
  readonly enemyOpeningShield: number;
  readonly enemyPierceBonus: number;
  readonly enemyHpBonusPct: number;
  readonly bountyMultBonus: number;
  readonly salvagePartsPerWin: number;
}

export function aggregateEndlessMutatorEffects(
  mutatorIds?: readonly string[] | null
): AggregatedEndlessMutatorEffects {
  const seen = new Set<EndlessMutatorId>();
  const activeIds: EndlessMutatorId[] = [];
  let openingShieldPenalty = 0;
  let evenRoundShieldDrain = 0;
  let enemyArmorBonus = 0;
  let enemyDamageBonus = 0;
  let enemyOpeningShield = 0;
  let enemyPierceBonus = 0;
  let enemyHpBonusPct = 0;
  let bountyMultBonus = 0;
  let salvagePartsPerWin = 0;

  if (mutatorIds) {
    for (const rawId of mutatorIds) {
      if (!isEndlessMutatorId(rawId) || seen.has(rawId)) continue;
      seen.add(rawId);
      activeIds.push(rawId);
      const def = V3_ENDLESS_MUTATORS[rawId];
      openingShieldPenalty += def.openingShieldPenalty;
      evenRoundShieldDrain += def.evenRoundShieldDrain;
      enemyArmorBonus += def.enemyArmorBonus;
      enemyDamageBonus += def.enemyDamageBonus;
      enemyOpeningShield += def.enemyOpeningShield;
      enemyPierceBonus += def.enemyPierceBonus;
      enemyHpBonusPct += def.enemyHpBonusPct;
      bountyMultBonus += def.bountyMultBonus;
      salvagePartsPerWin += def.salvagePartsPerWin;
    }
  }

  return {
    activeIds,
    openingShieldPenalty,
    evenRoundShieldDrain,
    enemyArmorBonus,
    enemyDamageBonus,
    enemyOpeningShield,
    enemyPierceBonus: Math.min(0.35, Number(enemyPierceBonus.toFixed(2))),
    enemyHpBonusPct: Number(enemyHpBonusPct.toFixed(2)),
    bountyMultBonus: Number(bountyMultBonus.toFixed(2)),
    salvagePartsPerWin,
  };
}

export function describeEndlessThreatScaling(threat: number): {
  readonly threat: number;
  readonly hpBonusPct: number;
  readonly dmgAdd: number;
  readonly bountyBonusPct: number;
  readonly mutatorCount: number;
} {
  const clamped = Math.max(0, Math.min(MAX_ENDLESS_THREAT, Math.floor(threat)));
  return {
    threat: clamped,
    hpBonusPct: clamped * 10,
    dmgAdd: Math.floor(clamped / 3),
    bountyBonusPct: clamped * 12,
    mutatorCount: getEndlessMutatorCountForThreat(clamped),
  };
}

