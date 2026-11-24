export const MAX_UINT32 = 0xffffffff;

/**
 * Parses `?seed=<uint32>` from a URL query string.
 * - Accepts non-negative base-10 integers only (rejects empty, NaN, floats, negative, trailing chars).
 * - Clamps safe integers > 0xFFFFFFFF to 0xFFFFFFFF and normalizes as unsigned 32-bit integer.
 */
export function parseDeterministicSeedParam(search: string): number | null {
  const params = new URLSearchParams(search);
  const raw = params.get('seed');
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || !Number.isSafeInteger(num) || num < 0) return null;
  return Math.min(MAX_UINT32, num) >>> 0;
}

/**
 * Derives the deterministic run seed for the N-th expedition launched in a session (0-indexed).
 * Launch #1 (runIndex=0) -> baseSeed; Launch #2 (runIndex=1) -> (baseSeed + 1) >>> 0.
 */
export function deriveSessionRunSeed(
  baseSeed: number | null,
  runIndex: number
): number | undefined {
  if (baseSeed === null) return undefined;
  const safeIndex = Number.isFinite(runIndex) ? Math.max(0, Math.floor(runIndex)) : 0;
  return ((baseSeed >>> 0) + safeIndex) >>> 0;
}
