import {
  V3_ACHIEVEMENTS,
  V3_ACHIEVEMENTS_BY_ID,
  type V3AchievementDef,
} from '../data/achievements';
import type { V2ProfileState } from './types';

export interface V3AchievementStatus {
  readonly def: V3AchievementDef;
  readonly met: boolean;
  readonly unlocked: boolean;
  readonly claimed: boolean;
  readonly claimable: boolean;
  readonly progressLabel: string;
}

export interface SyncAchievementsResult {
  readonly profile: V2ProfileState;
  readonly newlyUnlockedIds: readonly string[];
}

export interface ClaimAchievementResult {
  readonly ok: boolean;
  readonly profile: V2ProfileState;
  readonly rewardCredits: number;
  readonly rewardParts: number;
  readonly error?: string;
}

/**
 * Resolves the authoritative set of already-claimed achievement IDs.
 * When `achievementsClaimed` is absent on older V3 saves / fixtures, pre-existing
 * `achievementsUnlocked` entries are treated as already claimed while `[]` leaves all met
 * achievements claimable via explicit player click.
 */
export function getClaimedAchievementIds(profile: V2ProfileState): readonly string[] {
  if (profile.achievementsClaimed !== undefined) {
    return profile.achievementsClaimed;
  }
  return profile.achievementsUnlocked;
}

export function evaluateV3Achievements(profile: V2ProfileState): readonly V3AchievementStatus[] {
  const unlockedSet = new Set(profile.achievementsUnlocked);
  const claimedSet = new Set(getClaimedAchievementIds(profile));

  return V3_ACHIEVEMENTS.map((def) => {
    const met = def.check(profile);
    const unlocked = met || unlockedSet.has(def.id);
    const claimed = claimedSet.has(def.id);
    const claimable = unlocked && !claimed;
    return {
      def,
      met,
      unlocked,
      claimed,
      claimable,
      progressLabel: def.progressText(profile),
    };
  });
}

export function getClaimableAchievementCount(profile: V2ProfileState): number {
  return evaluateV3Achievements(profile).filter((s) => s.claimable).length;
}

/**
 * Pure non-credit-mutating synchronizer called after settlement / ending commit.
 * Appends newly satisfied achievement IDs to `profile.achievementsUnlocked` while preserving
 * `achievementsClaimed` untouched so rewards are claimed explicitly and settlement credit
 * accounting stays 100% exact.
 */
export function syncUnlockedAchievements(
  profile: V2ProfileState,
  baseClaimed?: readonly string[]
): SyncAchievementsResult {
  const claimedBase = Array.from(
    new Set(
      baseClaimed !== undefined
        ? baseClaimed
        : profile.achievementsClaimed !== undefined
        ? profile.achievementsClaimed
        : profile.achievementsUnlocked
    )
  );
  const unlockedSet = new Set(profile.achievementsUnlocked);
  const newlyUnlockedIds: string[] = [];

  for (const def of V3_ACHIEVEMENTS) {
    if (!unlockedSet.has(def.id) && def.check(profile)) {
      unlockedSet.add(def.id);
      newlyUnlockedIds.push(def.id);
    }
  }

  if (newlyUnlockedIds.length === 0) {
    return { profile, newlyUnlockedIds: [] };
  }

  return {
    profile: {
      ...profile,
      achievementsUnlocked: Array.from(unlockedSet),
      achievementsClaimed: claimedBase,
    },
    newlyUnlockedIds,
  };
}

/**
 * Strictly idempotent atomic achievement claim.
 * Grants `rewardCredits` and `rewardParts` ONCE and marks the achievement in both
 * `achievementsUnlocked` and `achievementsClaimed` (deduplicated).
 */
export function claimV3Achievement(
  profile: V2ProfileState,
  achievementId: string
): ClaimAchievementResult {
  const def = V3_ACHIEVEMENTS_BY_ID[achievementId];
  if (!def) {
    return {
      ok: false,
      profile,
      rewardCredits: 0,
      rewardParts: 0,
      error: '未知成就编号',
    };
  }

  const claimedList = getClaimedAchievementIds(profile);
  if (claimedList.includes(achievementId)) {
    return {
      ok: false,
      profile,
      rewardCredits: 0,
      rewardParts: 0,
      error: '该成就奖励已领取',
    };
  }

  const eligible = def.check(profile) || profile.achievementsUnlocked.includes(achievementId);
  if (!eligible) {
    return {
      ok: false,
      profile,
      rewardCredits: 0,
      rewardParts: 0,
      error: '尚未达成该成就条件',
    };
  }

  const nextUnlocked = Array.from(new Set([...profile.achievementsUnlocked, achievementId]));
  const nextClaimed = Array.from(new Set([...claimedList, achievementId]));

  return {
    ok: true,
    profile: {
      ...profile,
      credits: profile.credits + def.rewardCredits,
      salvageParts: profile.salvageParts + def.rewardParts,
      achievementsUnlocked: nextUnlocked,
      achievementsClaimed: nextClaimed,
    },
    rewardCredits: def.rewardCredits,
    rewardParts: def.rewardParts,
  };
}
