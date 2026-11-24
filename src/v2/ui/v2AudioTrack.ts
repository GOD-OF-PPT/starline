import type { BgmTrack } from '../../audio/soundEngine';
import { isRunPendingCampaignEnding } from '../domain/campaign';
import type { V2RunState } from '../domain/types';

/**
 * Pure single-source-of-truth BGM track resolver for V2/V3 gameplay states.
 */
export function resolveV2BgmTrack(params: {
  readonly titleEntered: boolean;
  readonly run: V2RunState | null;
}): BgmTrack {
  const { titleEntered, run } = params;
  if (!run || isRunPendingCampaignEnding(run)) {
    return titleEntered ? 'base' : 'none';
  }
  if (run.phase === 'ENCOUNTER' && run.currentNodeId) {
    const node = run.graph.nodes[run.currentNodeId];
    const isBossOrElite = Boolean(
      node &&
        (node.type === 'elite' ||
          node.type === 'boss' ||
          Boolean(node.bossId) ||
          node.combat?.units.some((u) => u.isBoss))
    );
    if (isBossOrElite) return 'boss';
  }
  return 'expedition';
}
