import type { CampaignActId, SectorId } from '../domain/types';
import type { V2CrewId } from './crew';

/** Number of settled runs in a sector without a relic before next run guarantees a visible relic signal node */
export const RELIC_PITY_THRESHOLD = 3;

export interface CampaignChapterDef {
  readonly actId: CampaignActId;
  readonly order: number;
  readonly shortLabel: string;
  readonly title: string;
  readonly subtitle: string;
  readonly briefing: string;
  readonly sectorId: SectorId | null;
  readonly targetBossId: string | null;
  readonly targetBossName: string | null;
  readonly primaryGoalSummary: string;
}

export interface CampaignMilestoneDef {
  readonly id: string;
  readonly aliases: readonly string[];
  readonly actId: CampaignActId;
  readonly title: string;
  readonly description: string;
}

export type CampaignCommTrigger =
  | 'prologue_start'
  | 'act1_start'
  | 'act1_boss_intro'
  | 'act1_boss_clear'
  | 'act2_start'
  | 'act2_boss_intro'
  | 'act2_boss_clear'
  | 'act3_start'
  | 'act3_boss_intro'
  | 'relic_recovered'
  | 'crew_salvager_join'
  | 'crew_navigator_join'
  | 'pity_signal_detected';

export interface CampaignCommDef {
  readonly id: string;
  readonly trigger: CampaignCommTrigger;
  readonly actId: CampaignActId;
  readonly speakerId: V2CrewId;
  readonly title: string;
  readonly text: string;
}

export const CAMPAIGN_ACT_ORDER: readonly CampaignActId[] = [
  'prologue',
  'act1',
  'act2',
  'act3',
  'endless',
];

export const CAMPAIGN_CHAPTERS: Record<CampaignActId, CampaignChapterDef> = {
  prologue: {
    actId: 'prologue',
    order: 0,
    shortLabel: '序章',
    title: '序章 · 轨道复苏',
    subtitle: '重启拆解站基础运作',
    briefing:
      '轨道拆解站刚刚恢复主供能。完成首次示范航次，带回 2×3 密封反应堆以启动拆解工作台与委托中心。',
    sectorId: 'near_orbit',
    targetBossId: null,
    targetBossName: null,
    primaryGoalSummary: '完成首航教学并重启拆解站工作台',
  },
  act1: {
    actId: 'act1',
    order: 1,
    shortLabel: '第一幕',
    title: '第一幕 · 近轨清道',
    subtitle: '近轨残骸带 · 击溃封锁旗舰',
    briefing:
      '星门重启计划正式立项。在近轨残骸带完成委托、扩建研究台与船坞，追踪古星图线索并击败封锁近轨航道的「铁砧号」。',
    sectorId: 'near_orbit',
    targetBossId: 'boss_anvil',
    targetBossName: '铁砧号',
    primaryGoalSummary: '探索近轨残骸带并击败第 6 层首领「铁砧号」',
  },
  act2: {
    actId: 'act2',
    order: 2,
    shortLabel: '第二幕',
    title: '第二幕 · 冰晶舰冢',
    subtitle: '冰晶舰冢带 · 低温电离突围',
    briefing:
      '近轨封锁已破，航道直指低温电离笼罩的「冰晶舰冢带」。适应护盾衰减环境，打捞冰晶藏品并击败重甲旗舰「铁壁无畏」。',
    sectorId: 'frozen_graveyard',
    targetBossId: 'boss_dreadnought',
    targetBossName: '铁壁无畏',
    primaryGoalSummary: '突入冰晶舰冢带并击败第 6 层首领「铁壁无畏」',
  },
  act3: {
    actId: 'act3',
    order: 3,
    shortLabel: '第三幕',
    title: '第三幕 · 星门禁区',
    subtitle: '古代星门禁区 · 重启远征筹备',
    briefing:
      '通往古代星门禁区的跃迁窗口已开启。在引力潮汐中集齐并修复星门遗物、建成星门通讯塔，迎接终局首领「黑曜利维坦」。',
    sectorId: 'stargate_abyss',
    targetBossId: 'boss_leviathan',
    targetBossName: '黑曜利维坦',
    primaryGoalSummary: '集齐遗物与星门通讯塔，准备星门重启终战',
  },
  endless: {
    actId: 'endless',
    order: 4,
    shortLabel: '终局',
    title: '终局 · 无尽深渊',
    subtitle: '星门彼端 · 高威压深空远征',
    briefing:
      '古代星门已重塑航标，更高威压的无尽深渊向成熟舰队敞开，挑战极限配装与深空纪录。',
    sectorId: 'stargate_abyss',
    targetBossId: 'boss_leviathan',
    targetBossName: '黑曜利维坦',
    primaryGoalSummary: '挑战无尽深渊高威压远征',
  },
};

export const CAMPAIGN_MILESTONES: readonly CampaignMilestoneDef[] = [
  {
    id: 'tutorial_complete',
    aliases: ['prologue_complete'],
    actId: 'prologue',
    title: '完成首航教学',
    description: '安全返航并启用拆解工作台与委托中心，开启第一幕主线。',
  },
  {
    id: 'first_contract_complete',
    aliases: [],
    actId: 'act1',
    title: '交付首份正式委托',
    description: '在星港完成任意 1 份标准委托，建立稳定信用点收益。',
  },
  {
    id: 'research_lab_built',
    aliases: [],
    actId: 'act1',
    title: '建成研究台',
    description: '启用 12 格设备库、蓝图研究与自由制造，组建高协同配装。',
  },
  {
    id: 'act1_boss_defeated',
    aliases: ['act1_complete'],
    actId: 'act1',
    title: '击败第一幕首领「铁砧号」',
    description: '肃清近轨残骸带第 6 层首领，解锁第二星区「冰晶舰冢带」与第二幕。',
  },
  {
    id: 'act2_boss_defeated',
    aliases: ['act2_complete'],
    actId: 'act2',
    title: '击败第二幕首领「铁壁无畏」',
    description: '突破低温电离区并击败第 6 层首领，解锁第三星区「古代星门禁区」与第三幕。',
  },
  {
    id: 'relic_restored_2',
    aliases: [],
    actId: 'act3',
    title: '修复至少 2 件星门遗物',
    description: '在收藏展台复原古星门关键组件，为星门重启校准坐标。',
  },
  {
    id: 'stargate_relay_built',
    aliases: [],
    actId: 'act3',
    title: '建成星门通讯塔',
    description: '完成星门重启远征所需的空间站高能中继建设。',
  },
  {
    id: 'act3_boss_defeated',
    aliases: ['act3_complete'],
    actId: 'act3',
    title: '击败终局首领「黑曜利维坦」',
    description: '夺回古代星门控制权，开启终局抉择与无尽深渊。',
  },
];

export const CAMPAIGN_COMMS: readonly CampaignCommDef[] = [
  {
    id: 'comm_prologue_start',
    trigger: 'prologue_start',
    actId: 'prologue',
    speakerId: 'engineer',
    title: '林工 · 轨道坞启动测试',
    text: '船长，拆解站主供能刚稳住。先跑一趟近轨示范航次，把密封反应堆带回来，我就能把工作台彻底盘活。',
  },
  {
    id: 'comm_act1_start',
    trigger: 'act1_start',
    actId: 'act1',
    speakerId: 'engineer',
    title: '林工 · 星门重启计划立项',
    text: '工作台和委托终端都在线了！雷达扫到近轨深处有旧星门航标碎片，不过第 6 层那艘「铁砧号」正堵着跃迁口。',
  },
  {
    id: 'comm_crew_salvager_join',
    trigger: 'crew_salvager_join',
    actId: 'act1',
    speakerId: 'salvager',
    title: '苏岚 · 加入舰队报到',
    text: '听说你们接手了星门残骸带？带上我，切残骸前不用盲赌——军械舱和货舱里装着什么，我一眼就能透视清楚。',
  },
  {
    id: 'comm_crew_navigator_join',
    trigger: 'crew_navigator_join',
    actId: 'act1',
    speakerId: 'navigator',
    title: '陆衡 · 加入舰队报到',
    text: '航迹图我重新校好了。出航交给我引航，首次跨层跃迁零基础油耗，省下来的燃料足够往更深星区探一探。',
  },
  {
    id: 'comm_pity_signal',
    trigger: 'pity_signal_detected',
    actId: 'act1',
    speakerId: 'navigator',
    title: '陆衡 · 高能遗物信号锁定',
    text: '星图捕获到清晰共振！本趟航路已锁定一处保底遗物信号节点，顺路切过去就能稳稳把星区藏品带回展台。',
  },
  {
    id: 'comm_relic_recovered',
    trigger: 'relic_recovered',
    actId: 'act1',
    speakerId: 'salvager',
    title: '苏岚 · 古代遗物安全入港',
    text: '这件古星门遗物成色真漂亮！记得留在收藏展台里修复，别顺手卖掉——星门重启少不了这些老家伙。',
  },
  {
    id: 'comm_act1_boss_intro',
    trigger: 'act1_boss_intro',
    actId: 'act1',
    speakerId: 'engineer',
    title: '林工 · 遭遇「铁砧号」',
    text: '前方就是封锁近轨的「铁砧号」和护航编队！盯紧战前推演与护甲减伤，击穿它就能打通冰晶舰冢航道。',
  },
  {
    id: 'comm_act1_boss_clear',
    trigger: 'act1_boss_clear',
    actId: 'act2',
    speakerId: 'engineer',
    title: '林工 · 冰晶舰冢航道开放',
    text: '漂亮，铁砧号彻底哑火了！跃迁信标已指向「冰晶舰冢带」，那边有低温电离场会压制护盾，出航前记得调好配装。',
  },
  {
    id: 'comm_act2_start',
    trigger: 'act2_start',
    actId: 'act2',
    speakerId: 'navigator',
    title: '陆衡 · 驶入冰晶舰冢带',
    text: '低温电离干扰比星图记载的更强：每次开战护盾会被压制 2 点，偶数回合末还会继续衰减。注意速战或补足续航。',
  },
  {
    id: 'comm_act2_boss_intro',
    trigger: 'act2_boss_intro',
    actId: 'act2',
    speakerId: 'salvager',
    title: '苏岚 · 遭遇「铁壁无畏」',
    text: '重型护甲信号爆表——是第二幕首领「铁壁无畏」！高伤破甲或持续集火更吃香，别让电离场把护盾磨光了。',
  },
  {
    id: 'comm_act2_boss_clear',
    trigger: 'act2_boss_clear',
    actId: 'act3',
    speakerId: 'navigator',
    title: '陆衡 · 古代星门禁区解锁',
    text: '「铁壁无畏」已被击毁！星门核心区的坐标全部点亮，我们终于可以驶入「古代星门禁区」筹备星门重启。',
  },
  {
    id: 'comm_act3_start',
    trigger: 'act3_start',
    actId: 'act3',
    speakerId: 'engineer',
    title: '林工 · 古代星门引力潮汐警告',
    text: '禁区里的古星门每到偶数回合就会掀起引力潮汐：我方首击 +2 伤，敌舰每架也会 +1 伤。算准爆发回合再开火！',
  },
  {
    id: 'comm_act3_boss_intro',
    trigger: 'act3_boss_intro',
    actId: 'act3',
    speakerId: 'salvager',
    title: '苏岚 · 遭遇「黑曜利维坦」',
    text: '那就是守在星门前的终局巨舰「黑曜利维坦」！全员就位，这一仗决定整个拆解站的未来。',
  },
];
