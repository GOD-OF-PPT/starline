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
