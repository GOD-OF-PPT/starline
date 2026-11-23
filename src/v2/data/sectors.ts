import type { SectorBgIndex } from '../../data/nodes';
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
