export type V2CrewId = 'engineer' | 'navigator' | 'salvager';

export type V2CrewMasteryTier = 0 | 1 | 2;

export interface V2CrewMasteryTierDef {
  readonly tier: V2CrewMasteryTier;
  readonly title: string;
  readonly perkSummary: string;
  readonly unlockCondition: string;
}

export interface V2CrewDefinition {
  readonly id: V2CrewId;
  readonly name: string;
  readonly roleTitle: string;
  readonly callsign: string;
  readonly abilityTitle: string;
  readonly abilitySummary: string;
  readonly unlockHint: string;
  readonly accentColor: string;
  readonly bio: string;
  readonly masteryTiers: readonly [
    V2CrewMasteryTierDef,
    V2CrewMasteryTierDef,
    V2CrewMasteryTierDef,
  ];
}

export const V2_CREW_ORDER: readonly V2CrewId[] = ['engineer', 'navigator', 'salvager'];

export const V2_CREW: Record<V2CrewId, V2CrewDefinition> = {
  engineer: {
    id: 'engineer',
    name: '林工',
    roleTitle: '首席改装技师',
    callsign: '林工 · 工程师',
    abilityTitle: '首件改装换型',
    abilitySummary:
      '本趟首次取得非借用、非任务设备时，可免费从预先生成的同档设备候选中改换其一（离开当次整理过期）。',
    unlockHint: '默认拥有',
    accentColor: '#f6b852',
    bio: '原近轨拆解坞总装技师，擅长在颠簸船舱中即时改接线束与炮架接口。',
    masteryTiers: [
      {
        tier: 0,
        title: '见习改装技师',
        perkSummary: '基础能力：首件拾获设备可 3 选 1 免费改装为普通设备。',
        unlockCondition: '初始专精',
      },
      {
        tier: 1,
        title: '资深整备技师',
        perkSummary: '改装候选增至 4 个，且每场战斗获胜后额外自动抢修 +1 耐久（上限 4）。',
        unlockCondition: '携林工完成任意正式委托，或安全返航抵达第 4 层及以上',
      },
      {
        tier: 2,
        title: '星港首席总工',
        perkSummary: '改装优良设备时保留「优良」品质，且每场战斗开局额外获得 +2 护盾（上限 20）。',
        unlockCondition: '携林工抵达第 6 层、击败星区首领、完成深入委托或累计 3 次安全返航',
      },
    ],
  },
  navigator: {
    id: 'navigator',
    name: '陆衡',
    roleTitle: '深空引航官',
    callsign: '陆衡 · 领航员',
    abilityTitle: '首次跃迁免基耗',
    abilitySummary:
      '每趟首次跨层跃迁的基础燃料成本为 0（携带救生舱的附加油耗照常计算）。',
    unlockHint: '未解锁 · 完成 1 次航迹勘测（测绘）委托解锁',
    accentColor: '#62d6df',
    bio: '前旧舰队星图测绘官，熟悉各星区引力异常与跃迁窗，能用最少燃料切出安全航道。',
    masteryTiers: [
      {
        tier: 0,
        title: '轨道领航员',
        perkSummary: '基础能力：每趟首次跨层跃迁基础油耗为 0 燃料。',
        unlockCondition: '初始专精',
      },
      {
        tier: 1,
        title: '深空测绘官',
        perkSummary: '出航初始燃料 +1（上限 10），大幅提升深层航路容错率。',
        unlockCondition: '携陆衡完成任意正式委托，或安全返航抵达第 4 层及以上',
      },
      {
        tier: 2,
        title: '星门引航大师',
        perkSummary: '战斗第 1 回合我方首次直击伤害 +2（先手星图弹道校准）。',
        unlockCondition: '携陆衡抵达第 6 层、击败星区首领、完成深入委托或累计 3 次安全返航',
      },
    ],
  },
  salvager: {
    id: 'salvager',
    name: '苏岚',
    roleTitle: '残骸勘察员',
    callsign: '苏岚 · 打捞师',
    abilityTitle: '残骸全舱透视',
    abilitySummary:
      '在残骸打捞做出抉择之前，直接透视武器舱与货舱两边的完整产物、占格与标价。',
    unlockHint: '未解锁 · 完成 1 次大件运输（转运）委托解锁',
    accentColor: '#7ae582',
    bio: '资深废船猎手与货舱估价师，仅凭外舱焊缝与热成像便能一眼识破残骸内藏货品。',
    masteryTiers: [
      {
        tier: 0,
        title: '残骸勘察员',
        perkSummary: '基础能力：残骸打捞前透视军械舱与货舱完整产物与价值。',
        unlockCondition: '初始专精',
      },
      {
        tier: 1,
        title: '星港首席估价师',
        perkSummary: '安全返航出售拾获货物时，额外获得 +15% 精准估价加成。',
        unlockCondition: '携苏岚完成任意正式委托，或安全返航抵达第 4 层及以上',
      },
      {
        tier: 2,
        title: '废船拆解大师',
        perkSummary: '残骸反应舱抽油 +1 / 抢修 +2，且战斗胜利赏金 +20%。',
        unlockCondition: '携苏岚抵达第 6 层、击败星区首领、完成深入委托或累计 3 次安全返航',
      },
    ],
  },
};

export function getV2CrewMasteryTierDef(crewId: V2CrewId, tier: number): V2CrewMasteryTierDef {
  const clamped = Math.max(0, Math.min(2, Math.floor(tier))) as V2CrewMasteryTier;
  return V2_CREW[crewId].masteryTiers[clamped];
}
