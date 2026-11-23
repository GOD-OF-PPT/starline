import type { BgmTrack } from '../../audio/soundEngine';
import type { V2RunState } from '../domain/types';

/**
 * Pure single-source-of-truth BGM track resolver for V2/V3 gameplay states.
 */
export function resolveV2BgmTrack(params: {
  readonly titleEntered: boolean;
  readonly run: V2RunState | null;
}): BgmTrack {
  const { titleEntered, run } = params;
  if (!run) {
    return titleEntered ? 'base' : 'none';
  }
  if (run.phase === 'ENCOUNTER' && run.currentNodeId) {
    const node = run.graph.nodes[run.currentNodeId];
    const isBossOrElite = Boolean(
      node && (node.type === 'elite' || node.combat?.units.some((u) => u.isBoss))
    );
    if (isBossOrElite) return 'boss';
  }
  return 'expedition';
}
