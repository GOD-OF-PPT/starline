import type { BgmTrack } from '../../audio/soundEngine';
import type { V2RunState, V2SaveData } from '../domain/types';

export type StarlineScreenId = 'title' | 'base' | 'prepare' | 'run' | 'ending';

export interface StarlineInspectActiveRun {
  readonly runId: string;
  readonly seed: number;
  readonly sectorId: string;
  readonly contractId: string;
  readonly shipId: string;
  readonly crewId: string;
  readonly layer: number;
  readonly fuel: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly wallet: number;
  readonly combatRound: number | null;
  readonly combatWaitingDecision: boolean;
  readonly wreckStability: number | null;
  readonly isFinalCampaignRun: boolean;
  readonly endlessThreat: number;
}

export interface StarlineInspectSnapshot {
  readonly mode: 'v1' | 'v2';
  readonly schemaVersion: number;
  readonly screen: StarlineScreenId;
  readonly phase: string | null;
  readonly phaserScene: string | null;
  readonly bgmTrack: string;
  readonly campaignAct: string;
  readonly unlockedSectors: string[];
  readonly endingsUnlocked: string[];
  readonly credits: number;
  readonly salvageParts: number;
  readonly activeRun: StarlineInspectActiveRun | null;
  readonly failedAssets: string[];
  readonly modalOpen: boolean;
}

declare global {
  interface Window {
    __STARLINE_INSPECT__?: () => StarlineInspectSnapshot;
  }
}

/**
 * Pure, strictly read-only telemetry snapshot builder matching PROJECT.md § Interface Contracts #2.
 * Always returns freshly copied arrays so external consumers cannot mutate internal state.
 */
export function buildV2InspectSnapshot(params: {
  readonly save: V2SaveData;
  readonly activeRun: V2RunState | null;
  readonly screen: StarlineScreenId;
  readonly phaserScene: string | null;
  readonly bgmTrack: BgmTrack;
  readonly liveCombatRound: number;
  readonly awaitingEliteDecision: boolean;
  readonly failedAssets: readonly string[];
  readonly modalOpen: boolean;
}): StarlineInspectSnapshot {
  const {
    save,
    activeRun,
    screen,
    phaserScene,
    bgmTrack,
    liveCombatRound,
    awaitingEliteDecision,
    failedAssets,
    modalOpen,
  } = params;

  const profile = save.profile;
  const runSnapshot: StarlineInspectActiveRun | null = activeRun
    ? {
        runId: activeRun.runId,
        seed: activeRun.seed,
        sectorId: activeRun.sectorId,
        contractId: activeRun.contract.templateId,
        shipId: activeRun.shipId,
        crewId: activeRun.crewId ?? '',
        layer: activeRun.currentNodeId
          ? activeRun.graph.nodes[activeRun.currentNodeId]?.layer ?? 0
          : 0,
        fuel: activeRun.fuel,
        hp: activeRun.hp,
        maxHp: activeRun.maxHp,
        wallet: activeRun.wallet,
        combatRound:
          activeRun.phase === 'ENCOUNTER' && activeRun.activeCombat ? liveCombatRound : null,
        combatWaitingDecision: Boolean(
          activeRun.phase === 'ENCOUNTER' &&
            activeRun.activeCombat &&
            awaitingEliteDecision &&
            activeRun.activeCombat.pendingDecision?.chosen === null
        ),
        wreckStability: null,
        isFinalCampaignRun: Boolean(activeRun.isFinalCampaignRun),
        endlessThreat: activeRun.endlessThreat ?? 0,
      }
    : null;

  return {
    mode: 'v2',
    schemaVersion: save.schemaVersion,
    screen,
    phase: activeRun ? activeRun.phase : null,
    phaserScene,
    bgmTrack,
    campaignAct: profile.campaign.currentAct,
    unlockedSectors: [...profile.campaign.unlockedSectors],
    endingsUnlocked: [...profile.campaign.endingsUnlocked],
    credits: profile.credits,
    salvageParts: profile.salvageParts,
    activeRun: runSnapshot,
    failedAssets: [...failedAssets],
    modalOpen,
  };
}
