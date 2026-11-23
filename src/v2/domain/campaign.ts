import {
  CAMPAIGN_ACT_ORDER,
  CAMPAIGN_CHAPTERS,
  CAMPAIGN_COMMS,
  CAMPAIGN_MILESTONES,
  RELIC_PITY_THRESHOLD,
  type CampaignCommDef,
  type CampaignCommTrigger,
} from '../data/campaign';
import { V2_CARGO_DEFS } from '../data/cargo';
import { V2_CREW, type V2CrewId } from '../data/crew';
import { V2_RELIC_ORDER } from '../data/facilities';
import {
  V3_SECTOR_ORDER,
  getV3SectorDef,
  type SectorBossId,
} from '../data/sectors';
import { getAnyV2ItemDef } from './itemCatalog';
import type { V2SettlementSummary } from './settlementV2';
import type {
  CampaignActId,
  SectorId,
  V2ProfileState,
  V2RunState,
  V3CampaignState,
} from './types';

export interface RelicPitySignalStatus {
  readonly triggered: boolean;
  readonly relicDefId: string | null;
  readonly counter: number;
  readonly threshold: number;
}

export interface FinalMissionGateCheck {
  readonly id: string;
  readonly label: string;
  readonly met: boolean;
}

export interface FinalMissionGateStatus {
  readonly unlocked: boolean;
  readonly checks: readonly FinalMissionGateCheck[];
  readonly unmetReasons: readonly string[];
}

export interface CampaignSyncResult {
  readonly profile: V2ProfileState;
  readonly actTransition: { readonly from: CampaignActId; readonly to: CampaignActId } | null;
  readonly newlyUnlockedSectors: readonly SectorId[];
  readonly newlyCompletedMilestones: readonly string[];
}

export interface CampaignRunAdvanceResult extends CampaignSyncResult {
  readonly crewMasteryUpgraded: {
    readonly crewId: V2CrewId;
    readonly fromTier: number;
    readonly toTier: number;
  } | null;
  readonly newlyDefeatedBossIds: readonly string[];
  readonly recoveredRelicThisRun: boolean;
  readonly nextSectorPityCounter: number;
}

export interface ActiveCampaignObjective {
  readonly currentAct: CampaignActId;
  readonly actLabel: string;
  readonly actTitle: string;
  readonly actSubtitle: string;
  readonly headline: string;
  readonly detail: string;
  readonly progressPct: number;
  readonly recommendedSectorId: SectorId;
  readonly unreadCommsCount: number;
}

export function getCampaignActRank(actId: CampaignActId): number {
  const idx = CAMPAIGN_ACT_ORDER.indexOf(actId);
  return idx >= 0 ? idx : 0;
}

export function getSectorBossId(sectorId: SectorId): SectorBossId {
  return getV3SectorDef(sectorId).bossId;
}

export function hasCampaignMilestone(
  campaign: Pick<V3CampaignState, 'completedMilestones'>,
  milestoneId: string
): boolean {
  const set = new Set(campaign.completedMilestones);
  if (set.has(milestoneId)) return true;
  const def = CAMPAIGN_MILESTONES.find(
    (m) => m.id === milestoneId || m.aliases.includes(milestoneId)
  );
  if (!def) return false;
  if (set.has(def.id)) return true;
  return def.aliases.some((a) => set.has(a));
}

export function getRestoredRelicCount(profile: V2ProfileState): number {
  let count = 0;
  for (const rid of V2_RELIC_ORDER) {
    if (profile.relics[rid]?.restored) count += 1;
  }
  return count;
}

export function getNextUncollectedSectorRelicDefId(
  profile: V2ProfileState,
  sectorId: SectorId
): string | null {
  const sector = getV3SectorDef(sectorId);
  for (const rid of sector.signatureRelicIds) {
    const progress = profile.relics[rid];
    const alreadyOwned = Boolean(progress?.restored) || (progress?.storedCount ?? 0) > 0;
    const defId = `cargo.${rid}`;
    if (!alreadyOwned && Object.prototype.hasOwnProperty.call(V2_CARGO_DEFS, defId)) {
      return defId;
    }
  }
  return null;
}

export function shouldTriggerRelicPitySignal(
  profile: V2ProfileState,
  sectorId: SectorId
): RelicPitySignalStatus {
  const raw = profile.campaign.relicPityCounters[sectorId] ?? 0;
  const counter = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
  const relicDefId = getNextUncollectedSectorRelicDefId(profile, sectorId);
  const triggered = counter >= RELIC_PITY_THRESHOLD && relicDefId !== null;
  return {
    triggered,
    relicDefId: triggered ? relicDefId : null,
    counter,
    threshold: RELIC_PITY_THRESHOLD,
  };
}

export function isFinalCampaignMissionUnlocked(profile: V2ProfileState): FinalMissionGateStatus {
  const c = profile.campaign;
  const act1Cleared =
    c.defeatedBossIds.includes('boss_anvil') ||
    c.unlockedSectors.includes('frozen_graveyard') ||
    hasCampaignMilestone(c, 'act1_boss_defeated');
  const act2Cleared =
    c.defeatedBossIds.includes('boss_dreadnought') ||
    c.unlockedSectors.includes('stargate_abyss') ||
    hasCampaignMilestone(c, 'act2_boss_defeated');
  const restoredCount = getRestoredRelicCount(profile);
  const relicsReady = restoredCount >= 2;
  const relayBuilt =
    (profile.facilityTiers.stargate_relay ?? 0) >= 1 ||
    hasCampaignMilestone(c, 'stargate_relay_built');

  const checks: FinalMissionGateCheck[] = [
    {
      id: 'act1_boss',
      label: '击败第一幕首领「铁砧号」（解锁冰晶舰冢带）',
      met: act1Cleared,
    },
    {
      id: 'act2_boss',
      label: '击败第二幕首领「铁壁无畏」（解锁古代星门禁区）',
      met: act2Cleared,
    },
    {
      id: 'relics_2',
      label: `在收藏展台修复至少 2 件古代遗物（当前 ${restoredCount}/2）`,
      met: relicsReady,
    },
    {
      id: 'stargate_relay',
      label: '在空间站建成「星门通讯塔」',
      met: relayBuilt,
    },
  ];

  const unmetReasons = checks.filter((chk) => !chk.met).map((chk) => chk.label);
  const unlocked = Boolean(c.finalMissionUnlocked) || unmetReasons.length === 0;
  return {
    unlocked,
    checks,
    unmetReasons: unlocked ? [] : unmetReasons,
  };
}

/**
 * Strictly monotonic campaign state synchronizer.
 * Never downgrades currentAct or strips previously unlocked sectors, milestones, bosses, or endgame flags.
 */
export function syncCampaignProgress(profile: V2ProfileState): CampaignSyncResult {
  const prev = profile.campaign;

  const bossSet = new Set<string>(prev.defeatedBossIds);
  const milestoneSet = new Set<string>(prev.completedMilestones);
  const sectorSet = new Set<SectorId>(prev.unlockedSectors);
  sectorSet.add('near_orbit');

  const newlyCompletedMilestones: string[] = [];
  const markMilestone = (id: string) => {
    if (!hasCampaignMilestone({ completedMilestones: Array.from(milestoneSet) }, id)) {
      milestoneSet.add(id);
      newlyCompletedMilestones.push(id);
    } else if (!milestoneSet.has(id)) {
      milestoneSet.add(id);
    }
  };

  if (profile.tutorialCompleted || profile.buildings.workbench) {
    markMilestone('tutorial_complete');
  }
  if (profile.completedContractIds.length > 0 || profile.completedContractTypes.length > 0) {
    markMilestone('first_contract_complete');
  }
  if (profile.buildings.research_lab) {
    markMilestone('research_lab_built');
  }

  const act1BossDone =
    bossSet.has('boss_anvil') ||
    hasCampaignMilestone({ completedMilestones: Array.from(milestoneSet) }, 'act1_boss_defeated');
  if (act1BossDone) {
    markMilestone('act1_boss_defeated');
    sectorSet.add('frozen_graveyard');
  }

  const act2BossDone =
    bossSet.has('boss_dreadnought') ||
    hasCampaignMilestone({ completedMilestones: Array.from(milestoneSet) }, 'act2_boss_defeated');
  if (act2BossDone) {
    markMilestone('act2_boss_defeated');
    sectorSet.add('frozen_graveyard');
    sectorSet.add('stargate_abyss');
  }

  if (getRestoredRelicCount(profile) >= 2) {
    markMilestone('relic_restored_2');
  }
  if ((profile.facilityTiers.stargate_relay ?? 0) >= 1) {
    markMilestone('stargate_relay_built');
  }
  if (bossSet.has('boss_leviathan') || prev.endingsUnlocked.length > 0) {
    markMilestone('act3_boss_defeated');
  }

  const nextUnlockedSectors = V3_SECTOR_ORDER.filter((sid) => sectorSet.has(sid));
  const newlyUnlockedSectors = nextUnlockedSectors.filter(
    (sid) => !prev.unlockedSectors.includes(sid)
  );

  const nextEndlessUnlocked = Boolean(prev.endlessUnlocked) || prev.endingsUnlocked.length > 0;

  let derivedAct: CampaignActId = 'prologue';
  if (nextEndlessUnlocked) {
    derivedAct = 'endless';
  } else if (nextUnlockedSectors.includes('stargate_abyss')) {
    derivedAct = 'act3';
  } else if (nextUnlockedSectors.includes('frozen_graveyard')) {
    derivedAct = 'act2';
  } else if (
    profile.tutorialCompleted ||
    hasCampaignMilestone({ completedMilestones: Array.from(milestoneSet) }, 'tutorial_complete')
  ) {
    derivedAct = 'act1';
  }

  const nextAct: CampaignActId =
    getCampaignActRank(derivedAct) > getCampaignActRank(prev.currentAct)
      ? derivedAct
      : prev.currentAct;

  const preliminaryCampaign: V3CampaignState = {
    ...prev,
    currentAct: nextAct,
    unlockedSectors: nextUnlockedSectors,
    completedMilestones: Array.from(milestoneSet),
    defeatedBossIds: Array.from(bossSet),
    endlessUnlocked: nextEndlessUnlocked,
  };

  const preliminaryProfile: V2ProfileState = {
    ...profile,
    campaign: preliminaryCampaign,
  };
  const finalGate = isFinalCampaignMissionUnlocked(preliminaryProfile);
  const nextFinalMissionUnlocked = Boolean(prev.finalMissionUnlocked) || finalGate.unlocked;

  const nextCampaign: V3CampaignState = {
    ...preliminaryCampaign,
    finalMissionUnlocked: nextFinalMissionUnlocked,
  };

  const actTransition =
    nextAct !== prev.currentAct ? { from: prev.currentAct, to: nextAct } : null;

  return {
    profile: {
      ...profile,
      campaign: nextCampaign,
    },
    actTransition,
    newlyUnlockedSectors,
    newlyCompletedMilestones,
  };
}

function collectDefeatedBossIdsFromRun(
  run: V2RunState,
  summary: V2SettlementSummary
): readonly string[] {
  if (run.isShowcase || run.isTutorial || summary.reason === 'defeat') {
    return [];
  }
  const bosses = new Set<string>(run.defeatedBossIdsThisRun ?? []);

  for (const node of Object.values(run.graph.nodes)) {
    const claimKey = `combat_done_${node.nodeId}`;
    if (!run.claimedEventIds.includes(claimKey)) continue;
    // Never infer combat victory from an unresolved node regardless of currentNodeId!
    if (!node.resolved) continue;
    const explicitBossId = node.combat?.bossId ?? node.bossId;
    if (explicitBossId) {
      bosses.add(explicitBossId);
    } else if ((node.type === 'elite' || node.type === 'boss') && node.layer >= 6) {
      bosses.add(getSectorBossId(run.sectorId));
    }
  }

  return Array.from(bosses);
}

function collectDefeatedEnemyKindsFromRun(
  run: V2RunState,
  _summary: V2SettlementSummary
): readonly string[] {
  if (run.isShowcase || run.isTutorial) {
    return [];
  }
  const kinds = new Set<string>(run.defeatedEnemyKindsThisRun ?? []);
  for (const node of Object.values(run.graph.nodes)) {
    const claimKey = `combat_done_${node.nodeId}`;
    if (!run.claimedEventIds.includes(claimKey) || !node.combat) continue;
    // Never infer enemy victory from an unresolved node regardless of currentNodeId!
    if (!node.resolved) continue;
    kinds.add(node.combat.encounterKind);
    if (node.combat.bossId) kinds.add(node.combat.bossId);
  }
  return Array.from(kinds);
}

function computeMaxLayerReached(run: V2RunState): number {
  let maxLayer = 0;
  for (const nid of run.visitedNodeIds) {
    const layer = run.graph.nodes[nid]?.layer ?? 0;
    if (layer > maxLayer) maxLayer = layer;
  }
  return maxLayer;
}

function hasRecoveredRelicInRun(run: V2RunState, summary: V2SettlementSummary): boolean {
  if (summary.reason !== 'safe_return') return false;
  if (Object.keys(summary.keptRelicsById).length > 0) return true;
  return run.bay.placed.some((p) => Boolean(getAnyV2ItemDef(p.item.definitionId)?.isCollectible));
}

export function evaluateCrewMasteryAfterRun(
  profile: V2ProfileState,
  run: V2RunState,
  summary: V2SettlementSummary,
  defeatedBossIdsThisRun: readonly string[],
  maxLayerReached: number
): { readonly crewId: V2CrewId; readonly fromTier: number; readonly toTier: number } | null {
  if (!run.crewId || summary.reason !== 'safe_return' || run.isTutorial || run.isShowcase) {
    return null;
  }
  const crewId = run.crewId;
  const currentTier = Math.max(0, Math.min(2, Math.floor(profile.crewMastery[crewId] ?? 0)));
  if (currentTier >= 2) return null;

  const completedFormalContract =
    summary.contractCompleted && run.contract.type !== 'free';

  if (currentTier === 0) {
    if (completedFormalContract || maxLayerReached >= 4) {
      return { crewId, fromTier: 0, toTier: 1 };
    }
    return null;
  }

  // currentTier === 1 -> check Tier 2 feats
  const priorSafeReturnsWithCrew = profile.runHistory.filter(
    (entry) => entry.crewId === crewId && entry.outcome === 'safe_return' && entry.runId !== run.runId
  ).length;
  const totalSafeReturnsWithCrew = priorSafeReturnsWithCrew + 1;
  const completedDeepContract =
    summary.contractCompleted && run.contract.tier === 'deep';

  if (
    maxLayerReached >= 6 ||
    defeatedBossIdsThisRun.length > 0 ||
    completedDeepContract ||
    totalSafeReturnsWithCrew >= 3
  ) {
    return { crewId, fromTier: 1, toTier: 2 };
  }
  return null;
}

/**
 * Atomically advances Campaign progression, Boss tracking, Relic Pity counters, Bestiary kinds,
 * and Crew Mastery after a run settles (invoked inside applyV2Settlement behind settledRunIds guard).
 */
export function advanceCampaignAfterRun(
  profile: V2ProfileState,
  run: V2RunState,
  summary: V2SettlementSummary
): CampaignRunAdvanceResult {
  const prevSectorCounter = Math.max(
    0,
    Math.floor(profile.campaign.relicPityCounters[run.sectorId] ?? 0)
  );
  if (run.isShowcase) {
    return {
      profile,
      actTransition: null,
      newlyUnlockedSectors: [],
      newlyCompletedMilestones: [],
      crewMasteryUpgraded: null,
      newlyDefeatedBossIds: [],
      recoveredRelicThisRun: false,
      nextSectorPityCounter: prevSectorCounter,
    };
  }

  const defeatedInRun = collectDefeatedBossIdsFromRun(run, summary);
  const newlyDefeatedBossIds = defeatedInRun.filter(
    (bid) => !profile.campaign.defeatedBossIds.includes(bid)
  );
  const nextDefeatedBossIds = Array.from(
    new Set([...profile.campaign.defeatedBossIds, ...defeatedInRun])
  );

  const defeatedKindsInRun = collectDefeatedEnemyKindsFromRun(run, summary);
  const nextDefeatedEnemyKinds = Array.from(
    new Set([...profile.defeatedEnemyKinds, ...defeatedKindsInRun])
  );

  const recoveredRelic = hasRecoveredRelicInRun(run, summary);
  const nextPityCounters: Record<string, number> = { ...profile.campaign.relicPityCounters };

  let nextSectorPityCounter = prevSectorCounter;
  if (!run.isTutorial && !run.isShowcase) {
    if (recoveredRelic) {
      nextPityCounters[run.sectorId] = 0;
      nextSectorPityCounter = 0;
    } else {
      nextSectorPityCounter = prevSectorCounter + 1;
      nextPityCounters[run.sectorId] = nextSectorPityCounter;
    }
  }

  const maxLayerReached = computeMaxLayerReached(run);
  const masteryUpgrade = evaluateCrewMasteryAfterRun(
    profile,
    run,
    summary,
    defeatedInRun,
    maxLayerReached
  );
  const nextCrewMastery: Record<V2CrewId, number> = { ...profile.crewMastery };
  if (masteryUpgrade) {
    nextCrewMastery[masteryUpgrade.crewId] = Math.max(
      0,
      Math.min(2, masteryUpgrade.toTier)
    );
  }

  const nextCareer = {
    ...profile.career,
    totalBossesDefeated: profile.career.totalBossesDefeated + defeatedInRun.length,
  };

  const preSyncProfile: V2ProfileState = {
    ...profile,
    crewMastery: nextCrewMastery,
    defeatedEnemyKinds: nextDefeatedEnemyKinds,
    career: nextCareer,
    campaign: {
      ...profile.campaign,
      defeatedBossIds: nextDefeatedBossIds,
      relicPityCounters: nextPityCounters,
    },
  };

  const synced = syncCampaignProgress(preSyncProfile);
  return {
    ...synced,
    crewMasteryUpgraded: masteryUpgrade,
    newlyDefeatedBossIds,
    recoveredRelicThisRun: recoveredRelic,
    nextSectorPityCounter,
  };
}

export function getUnlockedCampaignComms(profile: V2ProfileState): readonly CampaignCommDef[] {
  const actRank = getCampaignActRank(profile.campaign.currentAct);
  const bosses = new Set(profile.campaign.defeatedBossIds);
  const hasAnyRelic = V2_RELIC_ORDER.some(
    (rid) => Boolean(profile.relics[rid]?.restored) || (profile.relics[rid]?.storedCount ?? 0) > 0
  );
  const hasAnyPityReady = profile.campaign.unlockedSectors.some(
    (sid) => shouldTriggerRelicPitySignal(profile, sid).triggered
  );

  return CAMPAIGN_COMMS.filter((comm) => {
    switch (comm.trigger) {
      case 'prologue_start':
        return true;
      case 'act1_start':
        return actRank >= 1 || profile.tutorialCompleted;
      case 'crew_salvager_join':
        return profile.unlockedCrew.includes('salvager');
      case 'crew_navigator_join':
        return profile.unlockedCrew.includes('navigator');
      case 'pity_signal_detected':
        return hasAnyPityReady || profile.campaign.readCommsIds.includes(comm.id);
      case 'relic_recovered':
        return hasAnyRelic || profile.campaign.readCommsIds.includes(comm.id);
      case 'act1_boss_intro':
        return actRank >= 1 && (profile.deepestLayerReached >= 5 || bosses.has('boss_anvil') || profile.campaign.readCommsIds.includes(comm.id));
      case 'act1_boss_clear':
      case 'act2_start':
        return actRank >= 2 || bosses.has('boss_anvil') || profile.campaign.unlockedSectors.includes('frozen_graveyard');
      case 'act2_boss_intro':
        return actRank >= 2 && (bosses.has('boss_dreadnought') || profile.campaign.readCommsIds.includes(comm.id));
      case 'act2_boss_clear':
      case 'act3_start':
        return actRank >= 3 || bosses.has('boss_dreadnought') || profile.campaign.unlockedSectors.includes('stargate_abyss');
      case 'act3_boss_intro':
        return bosses.has('boss_leviathan') || profile.campaign.finalMissionUnlocked || profile.campaign.readCommsIds.includes(comm.id);
      default:
        return false;
    }
  });
}

export function getUnreadCampaignCommsCount(profile: V2ProfileState): number {
  const readSet = new Set(profile.campaign.readCommsIds);
  return getUnlockedCampaignComms(profile).filter((c) => !readSet.has(c.id)).length;
}

export function markCampaignCommRead(
  profile: V2ProfileState,
  commId: string
): V2ProfileState {
  if (profile.campaign.readCommsIds.includes(commId)) return profile;
  return {
    ...profile,
    campaign: {
      ...profile.campaign,
      readCommsIds: [...profile.campaign.readCommsIds, commId],
    },
  };
}

export function markCampaignCommsRead(
  profile: V2ProfileState,
  commIds: readonly string[]
): V2ProfileState {
  if (commIds.length === 0) return profile;
  const existing = new Set(profile.campaign.readCommsIds);
  const additions: string[] = [];
  for (const id of commIds) {
    if (!existing.has(id)) {
      existing.add(id);
      additions.push(id);
    }
  }
  if (additions.length === 0) return profile;
  return {
    ...profile,
    campaign: {
      ...profile.campaign,
      readCommsIds: [...profile.campaign.readCommsIds, ...additions],
    },
  };
}

export function getTriggeredCommForContext(
  profile: V2ProfileState,
  trigger: CampaignCommTrigger
): CampaignCommDef | null {
  const comm = CAMPAIGN_COMMS.find((c) => c.trigger === trigger);
  if (!comm) return null;
  if (profile.campaign.readCommsIds.includes(comm.id)) return null;
  return comm;
}

export function getActiveCampaignObjective(profile: V2ProfileState): ActiveCampaignObjective {
  const act = profile.campaign.currentAct;
  const chapter = CAMPAIGN_CHAPTERS[act] ?? CAMPAIGN_CHAPTERS.prologue;
  const unreadCommsCount = getUnreadCampaignCommsCount(profile);

  const completedMilestoneCount = CAMPAIGN_MILESTONES.filter((m) =>
    hasCampaignMilestone(profile.campaign, m.id)
  ).length;
  const progressPct = Math.max(
    8,
    Math.min(100, Math.round((completedMilestoneCount / CAMPAIGN_MILESTONES.length) * 100))
  );

  if (act === 'prologue') {
    return {
      currentAct: act,
      actLabel: chapter.shortLabel,
      actTitle: chapter.title,
      actSubtitle: chapter.subtitle,
      headline: '完成首航教学 · 重启工作台',
      detail: '出航回收 2×3 密封反应堆并安全返航，解锁第一幕「近轨清道」。',
      progressPct,
      recommendedSectorId: 'near_orbit',
      unreadCommsCount,
    };
  }

  if (act === 'act1') {
    const pity = shouldTriggerRelicPitySignal(profile, 'near_orbit');
    return {
      currentAct: act,
      actLabel: chapter.shortLabel,
      actTitle: chapter.title,
      actSubtitle: chapter.subtitle,
      headline: '击败第一幕首领「铁砧号」',
      detail: pity.triggered
        ? '近轨残骸带已锁定保底遗物信号，推进至第 6 层击溃铁砧号以解锁冰晶舰冢带。'
        : '在近轨残骸带完成委托与扩建，推进至第 6 层击溃「铁砧号」解锁第二星区。',
      progressPct,
      recommendedSectorId: 'near_orbit',
      unreadCommsCount,
    };
  }

  if (act === 'act2') {
    const pity = shouldTriggerRelicPitySignal(profile, 'frozen_graveyard');
    return {
      currentAct: act,
      actLabel: chapter.shortLabel,
      actTitle: chapter.title,
      actSubtitle: chapter.subtitle,
      headline: '击败第二幕首领「铁壁无畏」',
      detail: pity.triggered
        ? '冰晶舰冢带已锁定保底遗物信号！应对低温电离护盾压制并击溃铁壁无畏。'
        : '驶入冰晶舰冢带（低温电离环境），击败第 6 层「铁壁无畏」开启古代星门禁区。',
      progressPct,
      recommendedSectorId: 'frozen_graveyard',
      unreadCommsCount,
    };
  }

  if (act === 'act3') {
    const gate = isFinalCampaignMissionUnlocked(profile);
    return {
      currentAct: act,
      actLabel: chapter.shortLabel,
      actTitle: chapter.title,
      actSubtitle: chapter.subtitle,
      headline: gate.unlocked
        ? '星门重启远征 · 前置已全部就绪'
        : '筹备第三幕「星门重启远征」',
      detail: gate.unlocked
        ? '已达成终战全部前置，随时深入古代星门禁区迎战「黑曜利维坦」。'
        : `待完成前置：${gate.unmetReasons[0] ?? '推进古代星门禁区并修复古代遗物'}`,
      progressPct,
      recommendedSectorId: 'stargate_abyss',
      unreadCommsCount,
    };
  }

  return {
    currentAct: act,
    actLabel: chapter.shortLabel,
    actTitle: chapter.title,
    actSubtitle: chapter.subtitle,
    headline: '无尽深渊 · 深空极限远征',
    detail: `已通关主线战役，当前最高深渊威压 ${profile.campaign.maxEndlessThreat}/10。`,
    progressPct: 100,
    recommendedSectorId: 'stargate_abyss',
    unreadCommsCount,
  };
}

export interface SettlementCampaignPreview {
  readonly headlines: readonly string[];
  readonly pityLine: string | null;
}

/**
 * Pure non-mutating preview of campaign / boss / mastery / pity updates for SettlementView.
 */
export function previewSettlementCampaignOutcomes(
  profile: V2ProfileState,
  run: V2RunState,
  summary: V2SettlementSummary
): SettlementCampaignPreview {
  if (run.isShowcase || profile.settledRunIds.includes(run.runId)) {
    return { headlines: [], pityLine: null };
  }
  const tutorialSucceeded = run.isTutorial && summary.reason === 'safe_return';
  const simulatedProfile: V2ProfileState = {
    ...profile,
    tutorialCompleted: profile.tutorialCompleted || tutorialSucceeded,
    buildings: tutorialSucceeded
      ? { ...profile.buildings, workbench: true, contract_hub: true }
      : profile.buildings,
    completedContractIds:
      summary.contractCompleted && !run.isTutorial && run.contract.type !== 'free'
        ? Array.from(new Set([...profile.completedContractIds, run.contract.templateId]))
        : profile.completedContractIds,
  };
  const adv = advanceCampaignAfterRun(simulatedProfile, run, summary);
  const headlines: string[] = [];

  if (adv.actTransition) {
    headlines.push(
      `主线推进：${CAMPAIGN_CHAPTERS[adv.actTransition.from].shortLabel} → ${CAMPAIGN_CHAPTERS[adv.actTransition.to].title}`
    );
  }
  for (const sid of adv.newlyUnlockedSectors) {
    headlines.push(`解锁新星区：${getV3SectorDef(sid).name}`);
  }
  for (const bid of adv.newlyDefeatedBossIds) {
    const bossName =
      bid === 'boss_anvil'
        ? '铁砧号'
        : bid === 'boss_dreadnought'
        ? '铁壁无畏'
        : bid === 'boss_leviathan'
        ? '黑曜利维坦'
        : bid;
    headlines.push(`首领击破记录：${bossName}`);
  }
  if (adv.crewMasteryUpgraded) {
    const crew = V2_CREW[adv.crewMasteryUpgraded.crewId];
    headlines.push(
      `船员专精提升：${crew.name} Lv.${adv.crewMasteryUpgraded.fromTier} → Lv.${adv.crewMasteryUpgraded.toTier}`
    );
  }

  let pityLine: string | null = null;
  if (!run.isTutorial) {
    const sector = getV3SectorDef(run.sectorId);
    if (adv.recoveredRelicThisRun) {
      pityLine = `${sector.name}：已带回古代遗物，遗物信号保底计数重置为 0/${RELIC_PITY_THRESHOLD}`;
    } else {
      const nextCount = adv.nextSectorPityCounter;
      const hasRemainingSectorRelic =
        getNextUncollectedSectorRelicDefId(adv.profile, run.sectorId) !== null;
      pityLine =
        nextCount >= RELIC_PITY_THRESHOLD && hasRemainingSectorRelic
          ? `${sector.name}：保底计数 ${nextCount}/${RELIC_PITY_THRESHOLD}，下次出航将锁定保底遗物信号！`
          : hasRemainingSectorRelic
          ? `${sector.name}：遗物信号保底进度 ${nextCount}/${RELIC_PITY_THRESHOLD}`
          : `${sector.name}：本星区标志遗物已全部收集`;
    }
  }

  return { headlines, pityLine };
}
