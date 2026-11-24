import type { FactionId } from '../domain/types';

export const V3_FACTION_ORDER: readonly FactionId[] = [
  'starport_guild',
  'deep_institute',
  'free_salvagers',
];

export const V3_FACTION_MAX_REP = 300;

/** Reputation thresholds for Lv1 (0..99), Lv2 (100..219), Lv3 (220..300) */
export const V3_FACTION_LEVEL_THRESHOLDS = [0, 100, 220] as const;

export interface V3FactionDef {
  readonly id: FactionId;
  readonly name: string;
  readonly shortName: string;
  readonly tagline: string;
  readonly accentColor: string;
  readonly perksByRank: {
    readonly 1: string;
    readonly 2: string;
    readonly 3: string;
  };
}

export const V3_FACTIONS: Record<FactionId, V3FactionDef> = {
  starport_guild: {
    id: 'starport_guild',
    name: '星港行会',
    shortName: '行会',
    tagline: '轨道航运与悬赏仲裁联盟',
    accentColor: '#f6b852',
    perksByRank: {
      1: '接入标准大件转运与清剿悬赏合同',
      2: '流动商人设备与补给享 10% 折扣（严守无套利底价）',
      3: '流动商人享 15% 折扣，行会委托交付赏金 +10%',
    },
  },
  deep_institute: {
    id: 'deep_institute',
    name: '深空研究院',
    shortName: '研究院',
    tagline: '旧纪元星门考古与蓝图解析机构',
    accentColor: '#62d6df',
    perksByRank: {
      1: '接入航迹勘测任务与轨道蓝图档案',
      2: '工坊蓝图研究、制造、精炼升级与调校费用 -15%',
      3: '工坊全项研发与升级费用 -25%，勘测交付额外 +6 精密零件',
    },
  },
  free_salvagers: {
    id: 'free_salvagers',
    name: '自由拾荒团',
    shortName: '拾荒团',
    tagline: '无主残骸猎手与深空搜救互助网',
    accentColor: '#7ae582',
    perksByRank: {
      1: '接入失联救援与黑匣打捞高危合同',
      2: '结算与工坊拆解产出精密零件 +20%',
      3: '拆解产出精密零件 +35%，残骸拆解初始稳定度 +10',
    },
  },
};

export function getV3FactionDef(factionId: FactionId): V3FactionDef {
  return V3_FACTIONS[factionId];
}
