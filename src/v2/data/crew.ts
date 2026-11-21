export type V2CrewId = 'engineer' | 'navigator' | 'salvager';

export interface V2CrewDefinition {
  readonly id: V2CrewId;
  readonly name: string;
  readonly roleTitle: string;
  readonly abilityTitle: string;
  readonly abilitySummary: string;
  readonly unlockHint: string;
}

export const V2_CREW_ORDER: readonly V2CrewId[] = ['engineer', 'navigator', 'salvager'];

export const V2_CREW: Record<V2CrewId, V2CrewDefinition> = {
  engineer: {
    id: 'engineer',
    name: '工程师',
    roleTitle: '改装技师',
    abilityTitle: '首件改装换型',
    abilitySummary:
      '本趟首次取得非借用、非任务设备时，可免费从 3 个预先生成的同档普通设备候选中改换其一（离开当次整理过期）。',
    unlockHint: '默认拥有',
  },
  navigator: {
    id: 'navigator',
    name: '领航员',
    roleTitle: '深空引航官',
    abilityTitle: '首次跃迁免基耗',
    abilitySummary:
      '每趟首次跨层跃迁的基础燃料成本为 0（携带救生舱的附加油耗照常计算）。',
    unlockHint: '完成 1 次航迹勘测委托解锁',
  },
  salvager: {
    id: 'salvager',
    name: '打捞师',
    roleTitle: '废船勘察员',
    abilityTitle: '废船全舱透视',
    abilitySummary:
      '在废船打捞做出二选一之前，直接透视武器舱与货仓两边的完整产物、占格与标价。',
    unlockHint: '完成 1 次大件运输委托解锁',
  },
};
