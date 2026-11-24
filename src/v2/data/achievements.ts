import { V2_RELIC_ORDER } from './facilities';
import { V3_FACTION_ORDER } from './factions';
import { V2_CREW_ORDER } from './crew';
import type { V2ProfileState } from '../domain/types';

export interface V3AchievementDef {
  readonly id: string;
  readonly title: string;
  readonly category: '主线战役' | '无尽深渊' | '拆解经营' | '舰队图鉴';
  readonly description: string;
  readonly rewardCredits: number;
  readonly rewardParts: number;
  readonly check: (profile: V2ProfileState) => boolean;
  readonly progressText: (profile: V2ProfileState) => string;
}

function countRestoredRelics(profile: V2ProfileState): number {
  let count = 0;
  for (const rid of V2_RELIC_ORDER) {
    if (profile.relics[rid]?.restored) count += 1;
  }
  return count;
}

function getMaxCrewMastery(profile: V2ProfileState): number {
  let best = 0;
  for (const cid of V2_CREW_ORDER) {
    const tier = Math.max(0, Math.floor(profile.crewMastery[cid] ?? 0));
    if (tier > best) best = tier;
  }
  return best;
}

function getMaxFactionRep(profile: V2ProfileState): number {
  let best = 0;
  for (const fid of V3_FACTION_ORDER) {
    const rep = Math.max(0, Math.floor(profile.factionRep[fid] ?? 0));
    if (rep > best) best = rep;
  }
  return best;
}

/**
 * Exact 18 canonical V3 Achievements (F18).
 */
export const V3_ACHIEVEMENTS: readonly V3AchievementDef[] = [
  {
    id: 'first_expedition',
    title: '首航启程',
    category: '主线战役',
    description: '完成首次星际远航并安全返航（累计远航 ≥ 1 次）。',
    rewardCredits: 30,
    rewardParts: 5,
    check: (p) => p.totalRuns >= 1 || p.career.totalSafeReturns >= 1,
    progressText: (p) => `${Math.min(1, Math.max(p.totalRuns, p.career.totalSafeReturns))}/1 次`,
  },
  {
    id: 'act1_clear',
    title: '近轨破壁者',
    category: '主线战役',
    description: '击败第一幕首领「铁砧号」，打通冰晶舰冢航道。',
    rewardCredits: 60,
    rewardParts: 10,
    check: (p) =>
      p.campaign.defeatedBossIds.includes('boss_anvil') ||
      p.campaign.completedMilestones.includes('act1_boss_defeated'),
    progressText: (p) =>
      p.campaign.defeatedBossIds.includes('boss_anvil') ||
      p.campaign.completedMilestones.includes('act1_boss_defeated')
        ? '已击败铁砧号'
        : '0/1 铁砧号',
  },
  {
    id: 'act2_clear',
    title: '冰晶突围者',
    category: '主线战役',
    description: '击败第二幕首领「铁壁无畏」，解锁古代星门禁区。',
    rewardCredits: 90,
    rewardParts: 15,
    check: (p) =>
      p.campaign.defeatedBossIds.includes('boss_dreadnought') ||
      p.campaign.completedMilestones.includes('act2_boss_defeated'),
    progressText: (p) =>
      p.campaign.defeatedBossIds.includes('boss_dreadnought') ||
      p.campaign.completedMilestones.includes('act2_boss_defeated')
        ? '已击败铁壁无畏'
        : '0/1 铁壁无畏',
  },
  {
    id: 'act3_clear',
    title: '星门重启者',
    category: '主线战役',
    description: '击败终局首领「黑曜利维坦」并达成任意 1 项战役结局。',
    rewardCredits: 150,
    rewardParts: 25,
    check: (p) =>
      p.campaign.defeatedBossIds.includes('boss_leviathan') ||
      p.campaign.endingsUnlocked.length >= 1,
    progressText: (p) =>
      p.campaign.defeatedBossIds.includes('boss_leviathan') ||
      p.campaign.endingsUnlocked.length >= 1
        ? '已通关第三幕'
        : '0/1 黑曜利维坦',
  },
  {
    id: 'ending_collector',
    title: '三途归宿',
    category: '主线战役',
    description: '收集全部 3 项星门终局结局（星门重燃 / 自由港湾 / 旧舰队继承者）。',
    rewardCredits: 200,
    rewardParts: 30,
    check: (p) => p.campaign.endingsUnlocked.length >= 3,
    progressText: (p) => `${Math.min(3, p.campaign.endingsUnlocked.length)}/3 结局`,
  },
  {
    id: 'endless_first_clear',
    title: '无尽深渊行者',
    category: '无尽深渊',
    description: '首次在无尽深渊（威压 ≥ 1）安全凯旋通关。',
    rewardCredits: 80,
    rewardParts: 15,
    check: (p) => p.career.deepestEndlessCleared >= 1,
    progressText: (p) => `威压 ${Math.min(1, p.career.deepestEndlessCleared)}/1`,
  },
  {
    id: 'endless_veteran',
    title: '深渊征服者',
    category: '无尽深渊',
    description: '在无尽深渊通关威压 5 或更高难度。',
    rewardCredits: 140,
    rewardParts: 25,
    check: (p) => p.career.deepestEndlessCleared >= 5,
    progressText: (p) => `威压 ${Math.min(5, p.career.deepestEndlessCleared)}/5`,
  },
  {
    id: 'endless_apex',
    title: '渊极主宰',
    category: '无尽深渊',
    description: '在无尽深渊最高难度「威压 10」安全通关。',
    rewardCredits: 260,
    rewardParts: 40,
    check: (p) => p.career.deepestEndlessCleared >= 10,
    progressText: (p) => `威压 ${Math.min(10, p.career.deepestEndlessCleared)}/10`,
  },
  {
    id: 'contract_veteran',
    title: '金牌承包商',
    category: '拆解经营',
    description: '累计成功交付至少 5 份正式星港委托。',
    rewardCredits: 70,
    rewardParts: 10,
    check: (p) => p.career.totalWins >= 5 || p.completedContractIds.length >= 5,
    progressText: (p) =>
      `${Math.min(5, Math.max(p.career.totalWins, p.completedContractIds.length))}/5 份`,
  },
  {
    id: 'contract_all_types',
    title: '全能星港特派',
    category: '拆解经营',
    description: '完成全部 5 类标准委托（运输 / 救援 / 测绘 / 清剿悬赏 / 黑匣打捞）。',
    rewardCredits: 100,
    rewardParts: 15,
    check: (p) => p.completedContractTypes.length >= 5,
    progressText: (p) => `${Math.min(5, p.completedContractTypes.length)}/5 类`,
  },
  {
    id: 'wreck_veteran',
    title: '废船外科医',
    category: '拆解经营',
    description: '累计完成 5 次深空废船残骸拆解。',
    rewardCredits: 50,
    rewardParts: 12,
    check: (p) => p.career.totalWrecksDissected >= 5,
    progressText: (p) => `${Math.min(5, p.career.totalWrecksDissected)}/5 次`,
  },
  {
    id: 'scrap_refiner',
    title: '精密拆解大师',
    category: '拆解经营',
    description: '累计将 4 件装备或货物分解提纯为精密零件。',
    rewardCredits: 50,
    rewardParts: 12,
    check: (p) => p.career.totalItemsDismantled >= 4,
    progressText: (p) => `${Math.min(4, p.career.totalItemsDismantled)}/4 件`,
  },
  {
    id: 'fleet_complete',
    title: '旗舰舰队总司',
    category: '舰队图鉴',
    description: '解锁全部 4 艘星际舰船（含终极旗舰「星门巡洋舰」）。',
    rewardCredits: 120,
    rewardParts: 20,
    check: (p) => p.unlockedShips.length >= 4,
    progressText: (p) => `${Math.min(4, p.unlockedShips.length)}/4 舰`,
  },
  {
    id: 'crew_mastery_max',
    title: '黄金乘组',
    category: '舰队图鉴',
    description: '将任意一位具名船员的专精等级培养至满级 Lv.2。',
    rewardCredits: 80,
    rewardParts: 12,
    check: (p) => getMaxCrewMastery(p) >= 2,
    progressText: (p) => `最高 Lv.${Math.min(2, getMaxCrewMastery(p))}/2`,
  },
  {
    id: 'faction_exalted',
    title: '星港座上宾',
    category: '拆解经营',
    description: '在任意星港阵营的声望达到最高等级 Lv.3（≥ 220）。',
    rewardCredits: 90,
    rewardParts: 15,
    check: (p) => getMaxFactionRep(p) >= 220,
    progressText: (p) => `最高 ${Math.min(220, getMaxFactionRep(p))}/220`,
  },
  {
    id: 'relic_curator',
    title: '古星门博物学家',
    category: '舰队图鉴',
    description: '在空间站收藏展台修复全部 4 件古代星门遗物。',
    rewardCredits: 150,
    rewardParts: 25,
    check: (p) => countRestoredRelics(p) >= 4,
    progressText: (p) => `${countRestoredRelics(p)}/4 遗物`,
  },
  {
    id: 'station_relay',
    title: '星门中继工程师',
    category: '主线战役',
    description: '在空间站建成「星门通讯塔」，为终局远征建立中继信标。',
    rewardCredits: 100,
    rewardParts: 18,
    check: (p) =>
      (p.facilityTiers.stargate_relay ?? 0) >= 1 ||
      p.campaign.completedMilestones.includes('stargate_relay_built'),
    progressText: (p) =>
      (p.facilityTiers.stargate_relay ?? 0) >= 1 ? '已建成 T1+' : '0/1 星门通讯塔',
  },
  {
    id: 'bestiary_hunter',
    title: '深空敌舰图鉴师',
    category: '舰队图鉴',
    description: '在敌舰图鉴中累计记录击败至少 8 种敌舰或首领编队。',
    rewardCredits: 80,
    rewardParts: 15,
    check: (p) => {
      const merged = new Set([...p.defeatedEnemyKinds, ...p.campaign.defeatedBossIds]);
      return merged.size >= 8;
    },
    progressText: (p) => {
      const merged = new Set([...p.defeatedEnemyKinds, ...p.campaign.defeatedBossIds]);
      return `${Math.min(8, merged.size)}/8 种`;
    },
  },
];

export const V3_ACHIEVEMENTS_BY_ID: Readonly<Record<string, V3AchievementDef>> = Object.fromEntries(
  V3_ACHIEVEMENTS.map((a) => [a.id, a])
);
