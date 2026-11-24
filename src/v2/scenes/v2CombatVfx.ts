import type { V2CombatRoundLog } from '../domain/types';

/**
 * Pure, zero-Phaser deterministic VFX & choreography helpers for V2CombatScene.
 * Shared single source of truth between runtime rendering and unit tests.
 */

// ---------------------------------------------------------------------------
// A01 — Localized Hit VFX, Mild Hull Tint & Camera Shake Budgets (Art Spec §10)
// ---------------------------------------------------------------------------

/** Mild warm multiplicative tint applied briefly to hull on hull damage (NEVER opaque white fill) */
export const VFX_HIT_MILD_TINT = 0xfff2cc;

/** Brief warm tint duration on hull hit (strictly <= 40ms per A01 spec) */
export const VFX_HIT_FLASH_DURATION_MS = 38;

/** Maximum radius (CSS px) of localized ADD impact glow so flash never obscures hull silhouette */
export const VFX_IMPACT_GLOW_MAX_RADIUS = 18;

/** Camera shake hard caps per Art Spec §10 (<= 120ms, <= 3 CSS px) */
export const VFX_MAX_SHAKE_MS = 120;
export const VFX_MAX_SHAKE_PX = 3.0;

export interface HitFlashInput {
  readonly shieldAbsorbed: number;
  readonly hullDamage: number;
  readonly reducedMotion: boolean;
}

export interface HitFlashDecision {
  /** True when shield absorbed 100% of damage (hullDamage === 0): flash ONLY curved shield barrier */
  readonly flashShieldOnly: boolean;
  /** True when mild multiplicative warm tint should be applied briefly to hull */
  readonly applyHullWarmTint: boolean;
  /** Multiplicative tint color (never opaque white fill) */
  readonly hullTintColor: number;
  /** Tint duration in ms (0 or <= 40ms) */
  readonly hullTintDurationMs: number;
  /** Whether a localized ADD glow flash should spawn at the impact point */
  readonly spawnLocalizedGlow: boolean;
  /** Localized glow visual kind */
  readonly glowKind: 'hull' | 'shield' | 'none';
}

export function resolveHitFlashDecision(input: HitFlashInput): HitFlashDecision {
  const shieldAbsorbed = Math.max(0, input.shieldAbsorbed);
  const hullDamage = Math.max(0, input.hullDamage);

  if (hullDamage > 0) {
    return {
      flashShieldOnly: false,
      applyHullWarmTint: !input.reducedMotion,
      hullTintColor: VFX_HIT_MILD_TINT,
      hullTintDurationMs: input.reducedMotion ? 0 : VFX_HIT_FLASH_DURATION_MS,
      spawnLocalizedGlow: true,
      glowKind: 'hull',
    };
  }

  if (shieldAbsorbed > 0) {
    return {
      flashShieldOnly: true,
      applyHullWarmTint: false,
      hullTintColor: VFX_HIT_MILD_TINT,
      hullTintDurationMs: 0,
      spawnLocalizedGlow: true,
      glowKind: 'shield',
    };
  }

  return {
    flashShieldOnly: false,
    applyHullWarmTint: false,
    hullTintColor: VFX_HIT_MILD_TINT,
    hullTintDurationMs: 0,
    spawnLocalizedGlow: false,
    glowKind: 'none',
  };
}

export function clampCameraShakeMs(requestedMs: number, reducedMotion: boolean): number {
  if (reducedMotion || !Number.isFinite(requestedMs) || requestedMs <= 0) return 0;
  return Math.min(VFX_MAX_SHAKE_MS, requestedMs);
}

export function computeCameraShakeMagnitudePx(remainingMs: number, reducedMotion: boolean): number {
  if (reducedMotion || !Number.isFinite(remainingMs) || remainingMs <= 0) return 0;
  const clamped = Math.min(VFX_MAX_SHAKE_MS, remainingMs);
  return Math.min(VFX_MAX_SHAKE_PX, (clamped / VFX_MAX_SHAKE_MS) * VFX_MAX_SHAKE_PX);
}

// ---------------------------------------------------------------------------
// A02 — Multi-Beat Combat Round Choreography Schedule
// ---------------------------------------------------------------------------

export type RoundBeatKind =
  | 'charge'
  | 'player_fire'
  | 'player_impact'
  | 'enemy_fire'
  | 'enemy_impact'
  | 'resolve';

export interface RoundBeatSpec {
  readonly kind: RoundBeatKind;
  readonly baseDelayMs: number;
  readonly delayMs: number;
}

/** Nominal 1x combat round beat timestamps (all divided by combatSpeed; fire->impact = 60ms <= 200ms) */
export const VFX_BEAT_TIMINGS_MS = {
  charge: 0,
  playerFire: 120,
  playerImpact: 180,
  enemyFire: 450,
  enemyImpact: 510,
  resolve: 590,
  resolveFast: 300,
} as const;

export function buildRoundBeatSchedule(
  log: Pick<V2CombatRoundLog, 'playerAttacks' | 'enemyAttacks' | 'counterAttack'>,
  combatSpeed: number,
  _reducedMotion = false
): readonly RoundBeatSpec[] {
  const safeSpeed = Number.isFinite(combatSpeed) && combatSpeed > 0 ? Math.max(0.5, combatSpeed) : 1;
  const scale = (baseDelayMs: number): number => Math.round(baseDelayMs / safeSpeed);

  const hasEnemyRetaliation = log.enemyAttacks.length > 0 || log.counterAttack !== null;
  const beats: RoundBeatSpec[] = [
    { kind: 'charge', baseDelayMs: VFX_BEAT_TIMINGS_MS.charge, delayMs: scale(VFX_BEAT_TIMINGS_MS.charge) },
    { kind: 'player_fire', baseDelayMs: VFX_BEAT_TIMINGS_MS.playerFire, delayMs: scale(VFX_BEAT_TIMINGS_MS.playerFire) },
    {
      kind: 'player_impact',
      baseDelayMs: VFX_BEAT_TIMINGS_MS.playerImpact,
      delayMs: scale(VFX_BEAT_TIMINGS_MS.playerImpact),
    },
  ];

  if (hasEnemyRetaliation) {
    beats.push({
      kind: 'enemy_fire',
      baseDelayMs: VFX_BEAT_TIMINGS_MS.enemyFire,
      delayMs: scale(VFX_BEAT_TIMINGS_MS.enemyFire),
    });
    beats.push({
      kind: 'enemy_impact',
      baseDelayMs: VFX_BEAT_TIMINGS_MS.enemyImpact,
      delayMs: scale(VFX_BEAT_TIMINGS_MS.enemyImpact),
    });
    beats.push({
      kind: 'resolve',
      baseDelayMs: VFX_BEAT_TIMINGS_MS.resolve,
      delayMs: scale(VFX_BEAT_TIMINGS_MS.resolve),
    });
  } else {
    beats.push({
      kind: 'resolve',
      baseDelayMs: VFX_BEAT_TIMINGS_MS.resolveFast,
      delayMs: scale(VFX_BEAT_TIMINGS_MS.resolveFast),
    });
  }

  return beats;
}

/** Pure JS linear interpolation (zero Phaser.Math dependency) */
export function lerpNumber(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
