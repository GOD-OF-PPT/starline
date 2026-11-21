export type V2ContractType = 'transport' | 'rescue' | 'survey' | 'free';
export type V2ContractTier = 'standard' | 'deep' | 'free';

export interface V2ContractTemplate {
  readonly templateId: string;
  readonly type: V2ContractType;
  readonly tier: V2ContractTier;
  readonly name: string;
  readonly shortName: string;
  readonly rewardCredits: number;
  /** Layer(s) where objective nodes are placed */
  readonly targetLayers: readonly number[];
  /** Number of marked objective nodes to generate */
  readonly markerCount: number;
  /** Number of markers required to succeed */
  readonly requiredCompletions: number;
  /** Mission item defId spawned on objective completion, if any */
  readonly missionItemDefId?: 'mission.sealed_reactor' | 'mission.escape_pod';
  /** Number of mission items spawned on objective completion */
  readonly missionItemCount?: number;
  /** Extra fuel cost per survey action (for survey contracts) */
  readonly surveyFuelCost?: number;
  readonly spaceNote: string;
  readonly gameplayNote: string;
  readonly rewardNote: string;
}

export const V2_CONTRACT_TEMPLATES: Record<string, V2ContractTemplate> = {
  transport_std: {
    templateId: 'transport_std',
    type: 'transport',
    tier: 'standard',
    name: '标准大件运输：密封反应堆',
    shortName: '运输·标准',
    rewardCredits: 70,
    targetLayers: [3],
    markerCount: 1,
    requiredCompletions: 1,
    missionItemDefId: 'mission.sealed_reactor',
    missionItemCount: 1,
    spaceNote: '需预留 2×3 连续六格',
    gameplayNote: '第 3 层回收密封反应堆并安全带回港（耐久 ≥1）',
    rewardNote: '交付报酬 70¤',
  },
  transport_deep: {
    templateId: 'transport_deep',
    type: 'transport',
    tier: 'deep',
    name: '深入大件运输：深层反应堆',
    shortName: '运输·深入',
    rewardCredits: 120,
    targetLayers: [5],
    markerCount: 1,
    requiredCompletions: 1,
    missionItemDefId: 'mission.sealed_reactor',
    missionItemCount: 1,
    spaceNote: '需预留 2×3 连续六格',
    gameplayNote: '第 5 层回收深层密封反应堆并安全带回港（耐久 ≥1）',
    rewardNote: '交付报酬 120¤',
  },
  rescue_std: {
    templateId: 'rescue_std',
    type: 'rescue',
    tier: 'standard',
    name: '标准失联救援：营救工程师',
    shortName: '救援·标准',
    rewardCredits: 70,
    targetLayers: [3],
    markerCount: 1,
    requiredCompletions: 1,
    missionItemDefId: 'mission.escape_pod',
    missionItemCount: 1,
    spaceNote: '1×2 救生舱 · 携带后每跃迁额外 +1 油',
    gameplayNote: '第 3 层救出工程师并带救生舱安全回港',
    rewardNote: '交付报酬 70¤',
  },
  rescue_deep: {
    templateId: 'rescue_deep',
    type: 'rescue',
    tier: 'deep',
    name: '深入失联救援：双舱搜救行动',
    shortName: '救援·深入',
    rewardCredits: 120,
    targetLayers: [5],
    markerCount: 1,
    requiredCompletions: 1,
    missionItemDefId: 'mission.escape_pod',
    missionItemCount: 2,
    spaceNote: '两个 1×2 救生舱 · 携带期间每跃迁总计仅 +1 油',
    gameplayNote: '第 5 层救出两名失联船员并带回双救生舱',
    rewardNote: '交付报酬 120¤',
  },
  survey_std: {
    templateId: 'survey_std',
    type: 'survey',
    tier: 'standard',
    name: '标准航迹勘测：三点选二',
    shortName: '勘测·标准',
    rewardCredits: 70,
    targetLayers: [2, 3, 4],
    markerCount: 3,
    requiredCompletions: 2,
    surveyFuelCost: 1,
    spaceNote: '不占船舱 · 每次勘测消耗 1 燃料',
    gameplayNote: '在 3 处标记节点中完成任意 2 处勘测并安全返航',
    rewardNote: '交付报酬 70¤',
  },
  survey_deep: {
    templateId: 'survey_deep',
    type: 'survey',
    tier: 'deep',
    name: '深入航迹勘测：全段贯通测绘',
    shortName: '勘测·深入',
    rewardCredits: 120,
    targetLayers: [2, 4, 6],
    markerCount: 3,
    requiredCompletions: 3,
    surveyFuelCost: 1,
    spaceNote: '不占船舱 · 第 2/4/6 层各勘测 1 次（每次 -1 油）',
    gameplayNote: '完成第 2、4、6 层全部 3 处标记勘测并安全返航',
    rewardNote: '交付报酬 120¤',
  },
  free_salvage: {
    templateId: 'free_salvage',
    type: 'free',
    tier: 'free',
    name: '自由打捞航次',
    shortName: '自由打捞',
    rewardCredits: 0,
    targetLayers: [],
    markerCount: 0,
    requiredCompletions: 0,
    spaceNote: '无任务占格与路线限制',
    gameplayNote: '自由探索六层航路、采购装备、打捞高价货与藏品',
    rewardNote: '按实际打捞与悬赏结算',
  },
};

export const V2_CORE_CONTRACT_TYPES: readonly ('transport' | 'rescue' | 'survey')[] = [
  'transport',
  'rescue',
  'survey',
];
