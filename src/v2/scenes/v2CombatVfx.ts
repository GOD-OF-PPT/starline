import type { V2CombatRoundLog } from '../domain/types';

/**
 * Pure, zero-Phaser deterministic VFX & choreography helpers for V2CombatScene.
 * Shared single source of truth between runtime rendering and unit tests (A01–A05, A06-code).
 */

// ---------------------------------------------------------------------------
// A01 — Localized Hit VFX, Mild Hull Tint & Camera Shake Budgets (Art Spec §10)
// ---------------------------------------------------------------------------

/** Mild warm multiplicative tint applied briefly to hull on hull damage (never opaque white fill) */
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

// ---------------------------------------------------------------------------
// A03 — 3-Layer Composite Beams, Capped Particle Pool & Hitstop
// ---------------------------------------------------------------------------

/** Strict Art Spec §10 particle budgets */
export const VFX_MAX_PARTICLES_PER_BURST = 24;
export const VFX_MAX_ACTIVE_PARTICLES = 100;

/** Hitstop durations in ms (strictly in [40, 80]ms for heavy/lethal blows, 0 in reducedMotion) */
export const VFX_HITSTOP_HEAVY_MS = 50;
export const VFX_HITSTOP_LETHAL_MS = 64;
export const VFX_HITSTOP_BOSS_KILL_MS = 80;

export interface BeamLayerStroke {
  readonly width: number;
  readonly color: number;
  readonly alpha: number;
}

export interface ThreeLayerBeamStrokes {
  readonly outerGlow: BeamLayerStroke;
  readonly coloredCore: BeamLayerStroke;
  readonly whiteCenter: BeamLayerStroke;
}

export function computeThreeLayerBeamStrokes(
  thickness: number,
  color: number,
  alpha: number
): ThreeLayerBeamStrokes {
  const safeThick = Math.max(1, thickness);
  const safeAlpha = Math.max(0, Math.min(1, alpha));
  return {
    outerGlow: {
      width: safeThick * 2.5,
      color,
      alpha: safeAlpha * 0.34,
    },
    coloredCore: {
      width: safeThick,
      color,
      alpha: safeAlpha * 0.92,
    },
    whiteCenter: {
      width: Math.max(1.2, safeThick * 0.38),
      color: 0xffffff,
      alpha: safeAlpha * 0.96,
    },
  };
}

export interface HitstopInput {
  readonly hasHeavyHit: boolean;
  readonly hasLethalKill: boolean;
  readonly hasBossPhase: boolean;
  readonly isBossKill: boolean;
  readonly reducedMotion: boolean;
}

export function computeHitstopDurationMs(input: HitstopInput): number {
  if (input.reducedMotion) return 0;
  if (input.isBossKill) return VFX_HITSTOP_BOSS_KILL_MS;
  if (input.hasLethalKill || input.hasBossPhase) return VFX_HITSTOP_LETHAL_MS;
  if (input.hasHeavyHit) return VFX_HITSTOP_HEAVY_MS;
  return 0;
}

export type VfxParticleKind = 'spark' | 'shield_shard' | 'debris';

export interface VfxParticle {
  active: boolean;
  kind: VfxParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: number;
  life: number;
  maxLife: number;
  angleRad: number;
  vAngleRad: number;
}

export interface ParticleBurstOptions {
  readonly kind: VfxParticleKind;
  readonly x: number;
  readonly y: number;
  readonly count: number;
  readonly color: number;
  readonly lowQuality: boolean;
  readonly speedMin?: number;
  readonly speedMax?: number;
  readonly baseAngleRad?: number;
  readonly spreadRad?: number;
  readonly sizeMin?: number;
  readonly sizeMax?: number;
  readonly lifeSec?: number;
}

/**
 * Fixed-capacity particle pool strictly enforcing Art Spec §10 limits:
 * - <= 24 particles per single burst
 * - <= 100 active particles total across the screen
 * - 0 particles spawned when lowQuality is enabled
 */
export class VfxParticlePool {
  readonly capacity: number;
  private readonly slots: VfxParticle[];
  private activeCount = 0;
  private lastBurstSpawned = 0;
  private seed = 0x9e3779b9;

  constructor(capacity = VFX_MAX_ACTIVE_PARTICLES) {
    this.capacity = Math.max(1, Math.min(VFX_MAX_ACTIVE_PARTICLES, Math.floor(capacity)));
    this.slots = Array.from({ length: this.capacity }, () => ({
      active: false,
      kind: 'spark' as VfxParticleKind,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      size: 2,
      color: 0xffffff,
      life: 0,
      maxLife: 0.3,
      angleRad: 0,
      vAngleRad: 0,
    }));
  }

  private nextRand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 0x100000000;
  }

  spawnBurst(opts: ParticleBurstOptions): number {
    if (opts.lowQuality) {
      this.lastBurstSpawned = 0;
      return 0;
    }
    const requested = Math.min(VFX_MAX_PARTICLES_PER_BURST, Math.max(0, Math.floor(opts.count)));
    if (requested === 0) {
      this.lastBurstSpawned = 0;
      return 0;
    }

    const speedMin = opts.speedMin ?? (opts.kind === 'debris' ? 30 : 75);
    const speedMax = opts.speedMax ?? (opts.kind === 'debris' ? 95 : 190);
    const baseAngle = opts.baseAngleRad ?? 0;
    const spread = opts.spreadRad ?? Math.PI * 2;
    const sizeMin = opts.sizeMin ?? (opts.kind === 'debris' ? 3 : 2);
    const sizeMax = opts.sizeMax ?? (opts.kind === 'debris' ? 6 : 4.2);
    const baseLife = opts.lifeSec ?? (opts.kind === 'debris' ? 0.72 : 0.34);

    let spawned = 0;
    for (let i = 0; i < this.capacity && spawned < requested; i++) {
      const slot = this.slots[i];
      if (slot.active) continue;

      const frac = requested > 1 ? spawned / requested : 0.5;
      const jitter = (this.nextRand() - 0.5) * (spread / Math.max(1, requested));
      const ang = baseAngle - spread * 0.5 + frac * spread + jitter;
      const spd = speedMin + this.nextRand() * Math.max(0, speedMax - speedMin);
      const sz = sizeMin + this.nextRand() * Math.max(0, sizeMax - sizeMin);
      const life = baseLife * (0.75 + this.nextRand() * 0.45);

      slot.active = true;
      slot.kind = opts.kind;
      slot.x = opts.x;
      slot.y = opts.y;
      slot.vx = Math.cos(ang) * spd;
      slot.vy = Math.sin(ang) * spd;
      slot.size = sz;
      slot.color = opts.color;
      slot.life = life;
      slot.maxLife = life;
      slot.angleRad = ang;
      slot.vAngleRad = (this.nextRand() - 0.5) * 9;

      spawned += 1;
      this.activeCount += 1;
    }

    this.lastBurstSpawned = spawned;
    return spawned;
  }

  step(dtSec: number): void {
    if (dtSec <= 0 || this.activeCount === 0) return;
    const drag = Math.pow(0.18, dtSec);
    for (let i = 0; i < this.capacity; i++) {
      const p = this.slots[i];
      if (!p.active) continue;
      p.life -= dtSec;
      if (p.life <= 0) {
        p.active = false;
        p.life = 0;
        this.activeCount = Math.max(0, this.activeCount - 1);
        continue;
      }
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;
      if (p.kind !== 'debris') {
        p.vx *= drag;
        p.vy *= drag;
      } else {
        p.vx *= Math.pow(0.55, dtSec);
        p.vy *= Math.pow(0.55, dtSec);
      }
      p.angleRad += p.vAngleRad * dtSec;
    }
  }

  clear(): void {
    for (let i = 0; i < this.capacity; i++) {
      this.slots[i].active = false;
      this.slots[i].life = 0;
    }
    this.activeCount = 0;
    this.lastBurstSpawned = 0;
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  getLastBurstSpawned(): number {
    return this.lastBurstSpawned;
  }

  forEachActive(cb: (p: Readonly<VfxParticle>) => void): void {
    if (this.activeCount === 0) return;
    for (let i = 0; i < this.capacity; i++) {
      const p = this.slots[i];
      if (p.active) cb(p);
    }
  }
}

// ---------------------------------------------------------------------------
// A04 + A06-code — Death Choreography, Trailing HP Bars & Tiered Popups
// ---------------------------------------------------------------------------

export interface HpTrailState {
  hp: number;
  maxHp: number;
  trailHp: number;
  holdMs: number;
}

export const VFX_HP_TRAIL_HOLD_MS = 150;

export function applyHpChangeToTrail(
  state: HpTrailState,
  nextHp: number,
  reducedMotion: boolean
): void {
  const clamped = Math.max(0, nextHp);
  if (clamped < state.hp && !reducedMotion) {
    state.trailHp = Math.max(state.trailHp, state.hp);
    state.holdMs = VFX_HP_TRAIL_HOLD_MS;
  } else {
    state.trailHp = clamped;
    state.holdMs = 0;
  }
  state.hp = clamped;
}

export function stepHpTrailState(
  state: HpTrailState,
  dtMs: number,
  reducedMotion: boolean
): void {
  if (reducedMotion || state.trailHp <= state.hp) {
    state.trailHp = state.hp;
    state.holdMs = 0;
    return;
  }
  if (dtMs <= 0) return;
  if (state.holdMs > 0) {
    state.holdMs = Math.max(0, state.holdMs - dtMs);
    return;
  }
  const drainPerSec = Math.max(state.maxHp * 0.55, 10);
  state.trailHp = Math.max(state.hp, state.trailHp - (drainPerSec * dtMs) / 1000);
}

export function computeHpBarTickRatios(maxHp: number): readonly number[] {
  const safeMax = Math.max(1, Math.floor(maxHp));
  const step = safeMax <= 30 ? 5 : safeMax <= 80 ? 10 : safeMax <= 180 ? 20 : Math.ceil(safeMax / 8);
  const ratios: number[] = [];
  for (let hp = step; hp < safeMax && ratios.length < 8; hp += step) {
    ratios.push(hp / safeMax);
  }
  return ratios;
}

export type DamagePopupTier = 'normal' | 'armor' | 'pierce' | 'counter' | 'shield' | 'heal' | 'status';

export interface DamagePopupStyle {
  readonly tier: DamagePopupTier;
  readonly fontSize: string;
  readonly color: string;
  readonly stroke: string;
  readonly strokeThickness: number;
  readonly vy: number;
  readonly maxLife: number;
}

export function getDamagePopupStyle(tier: DamagePopupTier): DamagePopupStyle {
  switch (tier) {
    case 'armor':
      return {
        tier,
        fontSize: '13px',
        color: '#CBD5E1',
        stroke: '#1E293B',
        strokeThickness: 4,
        vy: -18,
        maxLife: 0.8,
      };
    case 'pierce':
      return {
        tier,
        fontSize: '17px',
        color: '#FF7096',
        stroke: '#2A0A18',
        strokeThickness: 5,
        vy: -30,
        maxLife: 0.88,
      };
    case 'counter':
      return {
        tier,
        fontSize: '16px',
        color: '#62D6DF',
        stroke: '#07222D',
        strokeThickness: 4,
        vy: -28,
        maxLife: 0.84,
      };
    case 'shield':
      return {
        tier,
        fontSize: '14px',
        color: '#7BE8FF',
        stroke: '#0B121F',
        strokeThickness: 4,
        vy: -22,
        maxLife: 0.76,
      };
    case 'heal':
      return {
        tier,
        fontSize: '15px',
        color: '#7AE582',
        stroke: '#0B121F',
        strokeThickness: 4,
        vy: -22,
        maxLife: 0.82,
      };
    case 'status':
      return {
        tier,
        fontSize: '14px',
        color: '#FFD791',
        stroke: '#0B121F',
        strokeThickness: 4,
        vy: -16,
        maxLife: 0.86,
      };
    case 'normal':
    default:
      return {
        tier: 'normal',
        fontSize: '15px',
        color: '#F6B852',
        stroke: '#0B121F',
        strokeThickness: 4,
        vy: -24,
        maxLife: 0.78,
      };
  }
}

export interface PopupPositionInput {
  readonly desiredX: number;
  readonly desiredY: number;
  readonly existing: readonly { readonly x: number; readonly y: number }[];
  readonly viewW: number;
  readonly viewH: number;
  readonly minDx?: number;
  readonly minDy?: number;
}

export function allocateNonOverlappingPopupPos(input: PopupPositionInput): { readonly x: number; readonly y: number } {
  const minDx = input.minDx ?? 42;
  const minDy = input.minDy ?? 18;
  const marginX = 28;
  const marginY = 16;
  const maxX = Math.max(marginX, input.viewW - marginX);
  const maxY = Math.max(marginY, input.viewH - marginY);
  const clamp = (val: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, val));

  const offsets: readonly [number, number][] = [
    [0, 0],
    [0, -minDy - 2],
    [minDx + 2, -Math.round(minDy * 0.55)],
    [-(minDx + 2), -Math.round(minDy * 0.55)],
    [0, -(minDy + 2) * 2],
    [minDx + 2, -(minDy + 2) * 1.5],
    [-(minDx + 2), -(minDy + 2) * 1.5],
    [0, minDy + 2],
    [minDx + 4, minDy + 2],
    [-(minDx + 4), minDy + 2],
    [minDx * 2 + 4, 0],
    [-(minDx * 2 + 4), 0],
    [0, -(minDy + 2) * 3],
    [minDx + 4, -(minDy + 2) * 2.5],
    [-(minDx + 4), -(minDy + 2) * 2.5],
    [0, (minDy + 2) * 2],
  ];

  const overlaps = (x: number, y: number): boolean =>
    input.existing.some((p) => Math.abs(x - p.x) < minDx && Math.abs(y - p.y) < minDy);

  for (const [ox, oy] of offsets) {
    const cx = clamp(input.desiredX + ox, marginX, maxX);
    const cy = clamp(input.desiredY + oy, marginY, maxY);
    if (!overlaps(cx, cy)) {
      return { x: cx, y: cy };
    }
  }

  // Fallback: stack below/above last existing popup cleanly
  const stackIdx = input.existing.length;
  const fallbackX = clamp(input.desiredX + ((stackIdx % 3) - 1) * (minDx + 2), marginX, maxX);
  const fallbackY = clamp(input.desiredY - (Math.floor(stackIdx / 3) + 1) * (minDy + 2), marginY, maxY);
  return { x: fallbackX, y: fallbackY };
}

export interface SplitHullHalfSpec {
  readonly useCrop: boolean;
  readonly cropX: number;
  readonly cropY: number;
  readonly cropW: number;
  readonly cropH: number;
  readonly startX: number;
  readonly startY: number;
  readonly vx: number;
  readonly vy: number;
  readonly vAngleDeg: number;
}

export interface MicroExplosionSpec {
  readonly delaySec: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly radius: number;
  readonly color: number;
}

export interface SplitHullChoreoSpec {
  readonly fore: SplitHullHalfSpec;
  readonly aft: SplitHullHalfSpec;
  readonly explosions: readonly MicroExplosionSpec[];
  readonly durationSec: number;
}

export function computeSplitHullHalvesSpec(input: {
  readonly texWidth: number;
  readonly texHeight: number;
  readonly splitRatioX: number;
  readonly baseX: number;
  readonly baseY: number;
  readonly displayWidth: number;
  readonly displayHeight: number;
  readonly isBoss: boolean;
  readonly hasDedicatedPlates: boolean;
}): SplitHullChoreoSpec {
  const ratio = Math.max(0.25, Math.min(0.75, input.splitRatioX));
  const splitPx = Math.round(input.texWidth * ratio);
  const dw = Math.max(24, input.displayWidth);
  const dh = Math.max(16, input.displayHeight);
  const speedScale = input.isBoss ? 1.15 : 1.0;

  const fore: SplitHullHalfSpec = {
    useCrop: !input.hasDedicatedPlates,
    cropX: 0,
    cropY: 0,
    cropW: Math.max(1, splitPx),
    cropH: Math.max(1, input.texHeight),
    startX: input.baseX - 2,
    startY: input.baseY - 1,
    vx: -26 * speedScale,
    vy: -14 * speedScale,
    vAngleDeg: -26 * speedScale,
  };

  const aft: SplitHullHalfSpec = {
    useCrop: !input.hasDedicatedPlates,
    cropX: splitPx,
    cropY: 0,
    cropW: Math.max(1, input.texWidth - splitPx),
    cropH: Math.max(1, input.texHeight),
    startX: input.baseX + 2,
    startY: input.baseY + 1,
    vx: 30 * speedScale,
    vy: 15 * speedScale,
    vAngleDeg: 22 * speedScale,
  };

  const explosions: MicroExplosionSpec[] = input.isBoss
    ? [
        { delaySec: 0, offsetX: -dw * 0.12, offsetY: -dh * 0.08, radius: 46, color: 0xf6b852 },
        { delaySec: 0.11, offsetX: dw * 0.14, offsetY: dh * 0.10, radius: 42, color: 0xff7096 },
        { delaySec: 0.22, offsetX: -dw * 0.04, offsetY: dh * 0.12, radius: 52, color: 0xf6b852 },
        { delaySec: 0.34, offsetX: dw * 0.08, offsetY: -dh * 0.12, radius: 64, color: 0xffe4a3 },
        { delaySec: 0.46, offsetX: 0, offsetY: 0, radius: 74, color: 0xff5c7a },
      ]
    : [
        { delaySec: 0, offsetX: -dw * 0.10, offsetY: -dh * 0.06, radius: 28, color: 0xf6b852 },
        { delaySec: 0.12, offsetX: dw * 0.12, offsetY: dh * 0.08, radius: 26, color: 0xff8c52 },
        { delaySec: 0.24, offsetX: 0, offsetY: 0, radius: 38, color: 0xffe4a3 },
      ];

  return {
    fore,
    aft,
    explosions,
    durationSec: input.isBoss ? 1.15 : 0.85,
  };
}

// ---------------------------------------------------------------------------
// A05 — Engine Exhaust Plumes & Idle Attitude Micro-Tilt
// ---------------------------------------------------------------------------

export interface EnginePlumeGeometry {
  readonly outerTriangle: readonly [number, number, number, number, number, number];
  readonly innerTriangle: readonly [number, number, number, number, number, number];
  readonly outerColor: number;
  readonly innerColor: number;
  readonly outerAlpha: number;
  readonly innerAlpha: number;
  readonly nozzleGlowRadius: number;
  readonly nozzleGlowAlpha: number;
  readonly flicker: number;
}

export function computeEnginePlumeGeometry(input: {
  readonly engineX: number;
  readonly engineY: number;
  readonly displayWidth: number;
  readonly displayHeight: number;
  readonly facing: 'right' | 'left';
  readonly elapsed: number;
  readonly phaseOffset: number;
  readonly recoilBoost?: number;
  readonly reducedMotion: boolean;
  readonly lowQuality: boolean;
  readonly isBoss?: boolean;
  readonly isDanger?: boolean;
}): EnginePlumeGeometry {
  const staticMode = input.reducedMotion || input.lowQuality;
  const flicker = staticMode ? 0.72 : 0.78 + Math.sin(input.elapsed * 24 + input.phaseOffset) * 0.22;
  const boost = staticMode ? 0 : Math.min(0.35, Math.max(0, input.recoilBoost ?? 0));

  const dir = input.facing === 'right' ? -1 : 1; // exhaust shoots aft (opposite facing)
  const lenFactor = input.facing === 'right' ? 0.145 : 0.135;
  const radFactor = input.facing === 'right' ? 0.13 : 0.12;
  const len = Math.max(12, input.displayWidth * lenFactor) * (flicker + boost);
  const rad = Math.max(4.5, input.displayHeight * radFactor);

  const ex = input.engineX;
  const ey = input.engineY;

  const outerColor =
    input.facing === 'right' ? 0x62d6df : input.isBoss || input.isDanger ? 0xf27564 : 0xf6b852;
  const innerColor = input.facing === 'right' ? 0xe8fdff : 0xfff1cc;

  const outerAlpha = (staticMode ? 0.34 : 0.44) * flicker;
  const innerAlpha = (staticMode ? 0.62 : 0.85) * flicker;

  return {
    outerTriangle: [ex, ey - rad, ex, ey + rad, ex + dir * len, ey],
    innerTriangle: [ex, ey - rad * 0.46, ex, ey + rad * 0.46, ex + dir * len * 0.56, ey],
    outerColor,
    innerColor,
    outerAlpha,
    innerAlpha,
    nozzleGlowRadius: Math.max(5, rad * 0.85),
    nozzleGlowAlpha: (staticMode ? 0.22 : 0.34) * flicker,
    flicker,
  };
}

export function computeIdleMicroTiltDeg(input: {
  readonly elapsed: number;
  readonly phaseOffset: number;
  readonly reducedMotion: boolean;
  readonly lowQuality: boolean;
  readonly isBoss?: boolean;
}): number {
  if (input.reducedMotion || input.lowQuality) return 0;
  const amp = input.isBoss ? 0.9 : 1.45;
  return Math.sin(input.elapsed * 1.9 + input.phaseOffset) * amp;
}

/** Pure JS linear interpolation (zero Phaser.Math dependency) */
export function lerpNumber(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
