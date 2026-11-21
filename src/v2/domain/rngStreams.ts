import { SeededRng } from '../../domain/rng';
import type { V2NamedStreamKey, V2RngStreams } from './types';

const STREAM_SALTS: Record<V2NamedStreamKey, number> = {
  map: 0x9e3779b9,
  enemies: 0x85ebca6b,
  shop: 0xc2b2ae35,
  events: 0x27d4eb2f,
  rewards: 0x165667b1,
};

export function createV2RngStreams(masterSeed: number): V2RngStreams {
  const base = masterSeed >>> 0;
  return {
    map: { seed: (base ^ STREAM_SALTS.map) >>> 0 || 11, draws: 0 },
    enemies: { seed: (base ^ STREAM_SALTS.enemies) >>> 0 || 23, draws: 0 },
    shop: { seed: (base ^ STREAM_SALTS.shop) >>> 0 || 37, draws: 0 },
    events: { seed: (base ^ STREAM_SALTS.events) >>> 0 || 53, draws: 0 },
    rewards: { seed: (base ^ STREAM_SALTS.rewards) >>> 0 || 71, draws: 0 },
  };
}

/**
 * Draws deterministically from a named stream and returns both result and updated immutable stream map.
 */
export function withV2Stream<T>(
  streams: V2RngStreams,
  streamKey: V2NamedStreamKey,
  fn: (rng: SeededRng) => T
): { readonly value: T; readonly nextStreams: V2RngStreams } {
  const rng = SeededRng.fromCursor(streams[streamKey]);
  const value = fn(rng);
  return {
    value,
    nextStreams: {
      ...streams,
      [streamKey]: rng.getCursor(),
    },
  };
}
