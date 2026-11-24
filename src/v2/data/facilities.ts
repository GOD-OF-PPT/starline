import { RELICS, RELIC_ORDER, type RelicDefinition } from '../../data/buildings';

export type V2FacilityId =
  | 'workbench'
  | 'contract_hub'
  | 'drydock'
  | 'drydock_tier2'
  | 'research_lab'
  | 'display';

export interface V2FacilityDef {
  readonly id: V2FacilityId;
  /** Logical facility category (5 categories; drydock_tier2 is upgrade of drydock) */
  readonly category: 'workbench' | 'contract_hub' | 'drydock' | 'research_lab' | 'display';
  readonly name: string;
  readonly cost: number;
  readonly effectSummary: string;
  readonly unlockRequirementText: string;
}

export const V2_FACILITY_ORDER: readonly V2FacilityId[] = [
  'workbench',
  'contract_hub',
  'drydock',
  'research_lab',
  'display',
  'drydock_tier2',
];

export const V2_FACILITIES: Record<V2FacilityId, V2FacilityDef> = {
  workbench: {
    id: 'workbench',
    category: 'workbench',
    name: '拆解工作台',
    cost: 0,
    effectSummary: '解锁基础图鉴、3 套配装预设保存与普通设备说明',
    unlockRequirementText: '完成教学航次自动免费修复',
  },
  contract_hub: {
    id: 'contract_hub',
    category: 'contract_hub',
    name: '委托中心',
    cost: 0,
    effectSummary: '发布三类委托（运输/救援/勘测），追踪完成记录与体系解锁',
    unlockRequirementText: '完成教学航次免费启用',
  },
  drydock: {
    id: 'drydock',
    category: 'drydock',
    name: '船坞扩建（一阶）',
    cost: 120,
    effectSummary: '解锁「护盾工程艇」（4×4、34耐久、+4护盾、预算6）',
    unlockRequirementText: '拆解工作台已启用',
  },
  research_lab: {
    id: 'research_lab',
    category: 'research_lab',
    name: '研究台',
    cost: 100,
    effectSummary: '解锁 12 件设备库、蓝图研究（实例+30¤）与普通设备制造',
    unlockRequirementText: '完成任意 1 次标准委托',
  },
  display: {
    id: 'display',
    category: 'display',
    name: '收藏展台',
    cost: 100,
    effectSummary: '开启星际藏品陈列馆，存放并修复带回的深空藏品',
    unlockRequirementText: '研究台已启用',
  },
  drydock_tier2: {
    id: 'drydock_tier2',
    category: 'drydock',
    name: '船坞扩建（二阶）',
    cost: 200,
    effectSummary: '解锁「远航货船」（5×4 异形 18 格大舱、预算5）',
    unlockRequirementText: '船坞一阶已建且完成至少 2 种标准委托',
  },
};

export const V2_RELICS: Record<string, RelicDefinition> = RELICS;
export const V2_RELIC_ORDER: readonly string[] = RELIC_ORDER;
export const V2_TUTORIAL_SUCCESS_BONUS = 40;

export type V3StationFacilityId =
  | 'workbench'
  | 'contract_hub'
  | 'drydock'
  | 'research_lab'
  | 'display'
  | 'stargate_relay';

export interface V3FacilityTierSpec {
  readonly tier: 1 | 2 | 3;
  readonly title: string;
  readonly creditCost: number;
  readonly partsCost: number;
  readonly effectSummary: string;
  readonly requirementText: string;
}

export interface V3StationFacilityDef {
  readonly id: V3StationFacilityId;
  readonly name: string;
  readonly shortName: string;
  readonly category: V3StationFacilityId;
  readonly tiers: readonly [V3FacilityTierSpec, V3FacilityTierSpec, V3FacilityTierSpec];
}

/** Canonical DOM & UI display order (workbench MUST stay first for sequential T1->T2->T3 upgrades) */
export const V3_STATION_FACILITY_ORDER: readonly V3StationFacilityId[] = [
  'workbench',
  'contract_hub',
  'drydock',
  'research_lab',
  'display',
  'stargate_relay',
];

export const V3_STATION_FACILITIES: Record<V3StationFacilityId, V3StationFacilityDef> = {
  workbench: {
    id: 'workbench',
    name: '拆解工作台',
    shortName: '工作台',
    category: 'workbench',
    tiers: [
      {
        tier: 1,
        title: '一阶 · 基础拆解台',
        creditCost: 0,
        partsCost: 0,
        effectSummary: '解锁图鉴、3 套配装预设与拆解工坊基础功能',
        requirementText: '完成教学航次自动免费修复',
      },
      {
        tier: 2,
        title: '二阶 · 精密装配线',
        creditCost: 200,
        partsCost: 30,
        effectSummary: '配装预设上限 3→5 套 · 工坊可制造 4 类战术消耗装置 · 拆解零件产出 +10%',
        requirementText: '工作台达到一阶',
      },
      {
        tier: 3,
        title: '三阶 · 全自动拆解矩阵',
        creditCost: 400,
        partsCost: 60,
        effectSummary: '配装预设上限 5→6 套 · 精炼与零件组装消耗 -10% · 残骸初始稳定度 +10',
        requirementText: '工作台达到二阶',
      },
    ],
  },
  contract_hub: {
    id: 'contract_hub',
    name: '委托中心',
    shortName: '委托台',
    category: 'contract_hub',
    tiers: [
      {
        tier: 1,
        title: '一阶 · 港务联络站',
        creditCost: 0,
        partsCost: 0,
        effectSummary: '发布各大阵营委托，追踪完成进度与装备体系解锁',
        requirementText: '完成教学航次自动免费启用',
      },
      {
        tier: 2,
        title: '二阶 · 商业调度中心',
        creditCost: 220,
        partsCost: 25,
        effectSummary: '正式委托交付报酬 +10%',
        requirementText: '委托中心达到一阶',
      },
      {
        tier: 3,
        title: '三阶 · 星区总调度署',
        creditCost: 440,
        partsCost: 55,
        effectSummary: '正式委托报酬 +20% · 附加目标报酬 +10% · 阵营声望获取 +15%',
        requirementText: '委托中心达到二阶',
      },
    ],
  },
  drydock: {
    id: 'drydock',
    name: '星港船坞',
    shortName: '船坞',
    category: 'drydock',
    tiers: [
      {
        tier: 1,
        title: '一阶 · 护盾泊位',
        creditCost: 120,
        partsCost: 0,
        effectSummary: '解锁「护盾工程艇」（4×4、34 耐久、+4 护盾、预算 6、2 处供能格）',
        requirementText: '拆解工作台已启用',
      },
      {
        tier: 2,
        title: '二阶 · 重型货运泊位',
        creditCost: 200,
        partsCost: 0,
        effectSummary: '解锁「远航货船」（5×4 异形 18 格大舱、预算 5、2 处供能格）',
        requirementText: '船坞一阶已建且完成至少 2 种标准委托',
      },
      {
        tier: 3,
        title: '三阶 · 旗舰干船坞',
        creditCost: 560,
        partsCost: 90,
        effectSummary: '解锁第 4 旗舰「星门巡洋舰」（5×5 异形 20 格、38 耐久、预算 8、3 处供能格）· 船体调校零件消耗 -10%',
        requirementText: '船坞二阶已建',
      },
    ],
  },
  research_lab: {
    id: 'research_lab',
    name: '深空研究台',
    shortName: '研究台',
    category: 'research_lab',
    tiers: [
      {
        tier: 1,
        title: '一阶 · 逆向分析室',
        creditCost: 100,
        partsCost: 0,
        effectSummary: '解锁 12 件设备库、蓝图逆向研究（实例+30¤）与普通设备制造',
        requirementText: '完成任意 1 次标准委托',
      },
      {
        tier: 2,
        title: '二阶 · 扩容备件库',
        creditCost: 260,
        partsCost: 40,
        effectSummary: '设备库容量 12→16 件 · 蓝图研究信用点费用 -5¤',
        requirementText: '研究台达到一阶',
      },
      {
        tier: 3,
        title: '三阶 · 超导科研核心',
        creditCost: 520,
        partsCost: 80,
        effectSummary: '设备库容量 16→20 件 · 远航优良装备掉落概率 +8%',
        requirementText: '研究台达到二阶',
      },
    ],
  },
  display: {
    id: 'display',
    name: '收藏展台',
    shortName: '展台',
    category: 'display',
    tiers: [
      {
        tier: 1,
        title: '一阶 · 藏品陈列馆',
        creditCost: 100,
        partsCost: 0,
        effectSummary: '开启星际藏品馆，存放并修复 4 件深空遗物以激活常驻空间站被动',
        requirementText: '深空研究台已启用',
      },
      {
        tier: 2,
        title: '二阶 · 遗物共鸣厅',
        creditCost: 240,
        partsCost: 35,
        effectSummary: '深层遗物出现概率 +6% · 返航出售货物估价 +8%',
        requirementText: '收藏展台达到一阶',
      },
      {
        tier: 3,
        title: '三阶 · 古代档案圣殿',
        creditCost: 480,
        partsCost: 70,
        effectSummary: '遗物信号保底门槛 3→2 次 · 返航出售货物估价 +15%',
        requirementText: '收藏展台达到二阶',
      },
    ],
  },
  stargate_relay: {
    id: 'stargate_relay',
    name: '星门通讯塔',
    shortName: '星门塔',
    category: 'stargate_relay',
    tiers: [
      {
        tier: 1,
        title: '一阶 · 星门中继信标',
        creditCost: 420,
        partsCost: 70,
        effectSummary: '点亮空间站星门信标，达成「星门通讯塔建成」主线里程碑并解锁终局远征许可',
        requirementText: '前置条件：研究台一阶 + 船坞二阶 + 进入第三幕（击败铁壁无畏）',
      },
      {
        tier: 2,
        title: '二阶 · 跃迁同步阵列',
        creditCost: 580,
        partsCost: 100,
        effectSummary: '每次出航初始航行钱包 +25¤ · 战斗首轮舰核伤害 +1',
        requirementText: '星门通讯塔达到一阶',
      },
      {
        tier: 3,
        title: '三阶 · 星门超频共振塔',
        creditCost: 820,
        partsCost: 140,
        effectSummary: '每次出航初始航行钱包 +50¤ · 战斗首轮舰核伤害 +2 · 空间站全功率星门光柱',
        requirementText: '星门通讯塔达到二阶',
      },
    ],
  },
};

export interface V3RelicPassiveMeta {
  readonly relicId: string;
  readonly shortBadge: string;
  readonly effectText: string;
}

export const V3_RELIC_PASSIVES: Record<string, V3RelicPassiveMeta> = {
  ancient_navigator: {
    relicId: 'ancient_navigator',
    shortBadge: '+1 燃料 · 全图透视',
    effectText: '被动效果：出航初始燃料 +1（上限 10）· 星图全 6 层节点与深层情报完全显现',
  },
  cryo_amber: {
    relicId: 'cryo_amber',
    shortBadge: '全舰 +4 耐久',
    effectText: '被动效果：全体舰船最大耐久与出航耐久 +4 HP',
  },
  quantum_core: {
    relicId: 'quantum_core',
    shortBadge: '全舰 +1 预算',
    effectText: '被动效果：全体舰船整备装配预算 +1',
  },
  obsidian_crown: {
    relicId: 'obsidian_crown',
    shortBadge: '首领 +1 指令',
    effectText: '被动效果：星区首领战主动战术指令充能 +1（最高 3 次）',
  },
};

