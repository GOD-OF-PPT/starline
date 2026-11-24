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
  const shieldAbsorbed = Number.isFinite(input.shieldAbsorbed) ? Math.max(0, input.shieldAbsorbed) : 0;
  const hullDamage = Number.isFinite(input.hullDamage) ? Math.max(0, input.hullDamage) : 0;

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

export function sanitizeCombatSpeed(combatSpeed: number): number {
  return Number.isFinite(combatSpeed) && combatSpeed > 0 ? Math.max(0.5, combatSpeed) : 1;
}

export function buildRoundBeatSchedule(
  log: Pick<V2CombatRoundLog, 'playerAttacks' | 'enemyAttacks' | 'counterAttack'>,
  combatSpeed: number,
  _reducedMotion = false
): readonly RoundBeatSpec[] {
  const safeSpeed = sanitizeCombatSpeed(combatSpeed);
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
  const safeThick = Number.isFinite(thickness) ? Math.max(1, thickness) : 3;
  const safeColor = Number.isFinite(color) ? color : 0xffffff;
  const safeAlpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
  return {
    outerGlow: {
      width: safeThick * 2.5,
      color: safeColor,
      alpha: safeAlpha * 0.34,
    },
    coloredCore: {
      width: safeThick,
      color: safeColor,
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
    this.capacity = Number.isFinite(capacity)
      ? Math.max(0, Math.min(VFX_MAX_ACTIVE_PARTICLES, Math.floor(capacity)))
      : VFX_MAX_ACTIVE_PARTICLES;
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
    const safeCount = Number.isFinite(opts.count) ? opts.count : 0;
    const requested = Math.min(VFX_MAX_PARTICLES_PER_BURST, Math.max(0, Math.floor(safeCount)));
    if (requested === 0 || this.capacity === 0) {
      this.lastBurstSpawned = 0;
      return 0;
    }

    const originX = Number.isFinite(opts.x) ? opts.x : 0;
    const originY = Number.isFinite(opts.y) ? opts.y : 0;
    const defaultSpeedMin = opts.kind === 'debris' ? 30 : 75;
    const defaultSpeedMax = opts.kind === 'debris' ? 95 : 190;
    const speedMin =
      opts.speedMin !== undefined && Number.isFinite(opts.speedMin) && opts.speedMin >= 0
        ? opts.speedMin
        : defaultSpeedMin;
    const speedMax =
      opts.speedMax !== undefined && Number.isFinite(opts.speedMax) && opts.speedMax >= 0
        ? Math.max(speedMin, opts.speedMax)
        : Math.max(speedMin, defaultSpeedMax);
    const baseAngle =
      opts.baseAngleRad !== undefined && Number.isFinite(opts.baseAngleRad) ? opts.baseAngleRad : 0;
    const spread =
      opts.spreadRad !== undefined && Number.isFinite(opts.spreadRad)
        ? Math.max(0, opts.spreadRad)
        : Math.PI * 2;
    const defaultSizeMin = opts.kind === 'debris' ? 3 : 2;
    const defaultSizeMax = opts.kind === 'debris' ? 6 : 4.2;
    const sizeMin =
      opts.sizeMin !== undefined && Number.isFinite(opts.sizeMin) && opts.sizeMin > 0
        ? opts.sizeMin
        : defaultSizeMin;
    const sizeMax =
      opts.sizeMax !== undefined && Number.isFinite(opts.sizeMax) && opts.sizeMax > 0
        ? Math.max(sizeMin, opts.sizeMax)
        : Math.max(sizeMin, defaultSizeMax);
    const defaultLife = opts.kind === 'debris' ? 0.72 : 0.35;
    const baseLife =
      opts.lifeSec !== undefined && Number.isFinite(opts.lifeSec) && opts.lifeSec > 0
        ? opts.lifeSec
        : defaultLife;
    const safeColor = Number.isFinite(opts.color) ? opts.color : 0xffffff;

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
      slot.x = originX;
      slot.y = originY;
      slot.vx = Math.cos(ang) * spd;
      slot.vy = Math.sin(ang) * spd;
      slot.size = sz;
      slot.color = safeColor;
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
    if (!Number.isFinite(dtSec) || dtSec <= 0 || this.activeCount === 0) return;
    const drag = Math.pow(0.18, dtSec);
    const debrisDrag = Math.pow(0.55, dtSec);
    for (let i = 0; i < this.capacity; i++) {
      const p = this.slots[i];
      if (!p.active) continue;
      p.life -= dtSec;
      if (!Number.isFinite(p.life) || p.life <= 0) {
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
        p.vx *= debrisDrag;
        p.vy *= debrisDrag;
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
  if (!Number.isFinite(nextHp)) return;
  const clamped = Math.max(0, nextHp);
  if (reducedMotion) {
    state.trailHp = clamped;
    state.holdMs = 0;
  } else if (clamped < state.hp) {
    state.trailHp = Math.max(Number.isFinite(state.trailHp) ? state.trailHp : state.hp, state.hp);
    state.holdMs = VFX_HP_TRAIL_HOLD_MS;
  } else if (clamped > state.hp) {
    if (!Number.isFinite(state.trailHp) || clamped >= state.trailHp) {
      state.trailHp = clamped;
      state.holdMs = 0;
    }
  }
  // When clamped === state.hp && !reducedMotion: preserve active trailHp and holdMs untouched!
  state.hp = clamped;
}

export function stepHpTrailState(
  state: HpTrailState,
  dtMs: number,
  reducedMotion: boolean
): void {
  if (!Number.isFinite(state.hp)) return;
  if (!Number.isFinite(state.trailHp)) {
    state.trailHp = state.hp;
  }
  if (!Number.isFinite(state.holdMs)) {
    state.holdMs = 0;
  }
  if (reducedMotion || state.trailHp <= state.hp) {
    state.trailHp = state.hp;
    state.holdMs = 0;
    return;
  }
  if (!Number.isFinite(dtMs) || dtMs <= 0) return;
  if (state.holdMs > 0) {
    state.holdMs = Math.max(0, state.holdMs - dtMs);
    return;
  }
  const safeMaxHp = Number.isFinite(state.maxHp) && state.maxHp > 0 ? state.maxHp : Math.max(1, state.hp);
  const drainPerSec = Math.max(safeMaxHp * 0.55, 10);
  state.trailHp = Math.max(state.hp, state.trailHp - (drainPerSec * dtMs) / 1000);
}

export function computeHpBarTickRatios(maxHp: number): readonly number[] {
  if (!Number.isFinite(maxHp) || maxHp <= 0) return [];
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
  const minDx =
    input.minDx !== undefined && Number.isFinite(input.minDx) && input.minDx > 0 ? input.minDx : 42;
  const minDy =
    input.minDy !== undefined && Number.isFinite(input.minDy) && input.minDy > 0 ? input.minDy : 18;
  const viewW = Number.isFinite(input.viewW) && input.viewW > 0 ? input.viewW : 390;
  const viewH = Number.isFinite(input.viewH) && input.viewH > 0 ? input.viewH : 240;
  const marginX = 28;
  const marginY = 16;
  const maxX = Math.max(marginX, viewW - marginX);
  const maxY = Math.max(marginY, viewH - marginY);
  const clamp = (val: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, val));
  const desiredX = Number.isFinite(input.desiredX) ? input.desiredX : viewW * 0.5;
  const desiredY = Number.isFinite(input.desiredY) ? input.desiredY : viewH * 0.5;

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
    const cx = clamp(desiredX + ox, marginX, maxX);
    const cy = clamp(desiredY + oy, marginY, maxY);
    if (!overlaps(cx, cy)) {
      return { x: cx, y: cy };
    }
  }

  // Deterministic viewport-inward grid search across [marginX..maxX] x [marginY..maxY]
  // anchored on clamped (desiredX, desiredY) so corner/edge clusters expand inward with 0 overlaps.
  const anchorX = clamp(desiredX, marginX, maxX);
  const anchorY = clamp(desiredY, marginY, maxY);
  const stepX = minDx + 2;
  const stepY = minDy + 2;

  const collectAxisCoords = (anchor: number, lo: number, hi: number, step: number, phaseOffset: number): number[] => {
    const coords: number[] = [];
    const seen = new Set<number>();
    const add = (v: number) => {
      if (v < lo - 1e-6 || v > hi + 1e-6) return;
      const clamped = clamp(v, lo, hi);
      const key = Math.round(clamped * 100);
      if (!seen.has(key)) {
        seen.add(key);
        coords.push(clamped);
      }
    };
    const start = anchor + phaseOffset;
    const maxSteps = Math.min(48, Math.ceil((hi - lo) / step) + 2);
    add(start);
    for (let k = 1; k <= maxSteps; k++) {
      add(start + k * step);
      add(start - k * step);
    }
    if (phaseOffset !== 0) {
      add(lo);
      add(hi);
    }
    return coords;
  };

  const searchGrid = (phaseX: number, phaseY: number): { readonly x: number; readonly y: number } | null => {
    const xs = collectAxisCoords(anchorX, marginX, maxX, stepX, phaseX);
    const ys = collectAxisCoords(anchorY, marginY, maxY, stepY, phaseY);
    let best: { x: number; y: number } | null = null;
    let bestDistSq = Number.POSITIVE_INFINITY;
    for (const cy of ys) {
      for (const cx of xs) {
        if (overlaps(cx, cy)) continue;
        const dx = cx - anchorX;
        const dy = cy - anchorY;
        const distSq = dx * dx + dy * dy;
        if (
          distSq < bestDistSq - 1e-6 ||
          (Math.abs(distSq - bestDistSq) <= 1e-6 &&
            best !== null &&
            (cy < best.y || (cy === best.y && cx < best.x)))
        ) {
          bestDistSq = distSq;
          best = { x: cx, y: cy };
        }
      }
    }
    return best;
  };

  const primaryHit = searchGrid(0, 0);
  if (primaryHit) return primaryHit;

  const halfStepHit = searchGrid(stepX * 0.5, stepY * 0.5);
  if (halfStepHit) return halfStepHit;

  // Final fallback if viewport is physically packed full beyond cell capacity
  const stackIdx = input.existing.length;
  const cols = Math.max(1, Math.floor((maxX - marginX) / stepX) + 1);
  const rows = Math.max(1, Math.floor((maxY - marginY) / stepY) + 1);
  const fallbackX = clamp(marginX + (stackIdx % cols) * stepX, marginX, maxX);
  const fallbackY = clamp(marginY + (Math.floor(stackIdx / cols) % rows) * stepY, marginY, maxY);
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
  const safeTexW = Number.isFinite(input.texWidth) && input.texWidth > 0 ? input.texWidth : 512;
  const safeTexH = Number.isFinite(input.texHeight) && input.texHeight > 0 ? input.texHeight : 256;
  const rawRatio = Number.isFinite(input.splitRatioX) ? input.splitRatioX : 0.5;
  const ratio = Math.max(0.25, Math.min(0.75, rawRatio));
  const splitPx = Math.max(1, Math.round(safeTexW * ratio));
  const safeBaseX = Number.isFinite(input.baseX) ? input.baseX : 0;
  const safeBaseY = Number.isFinite(input.baseY) ? input.baseY : 0;
  const safeDisplayW = Number.isFinite(input.displayWidth) ? input.displayWidth : 128;
  const safeDisplayH = Number.isFinite(input.displayHeight) ? input.displayHeight : 64;
  const dw = Math.max(24, safeDisplayW);
  const dh = Math.max(16, safeDisplayH);
  const speedScale = input.isBoss ? 1.15 : 1.0;

  const fore: SplitHullHalfSpec = {
    useCrop: !input.hasDedicatedPlates,
    cropX: 0,
    cropY: 0,
    cropW: Math.max(1, splitPx),
    cropH: Math.max(1, safeTexH),
    startX: safeBaseX - 2,
    startY: safeBaseY - 1,
    vx: -26 * speedScale,
    vy: -14 * speedScale,
    vAngleDeg: -26 * speedScale,
  };

  const aft: SplitHullHalfSpec = {
    useCrop: !input.hasDedicatedPlates,
    cropX: splitPx,
    cropY: 0,
    cropW: Math.max(1, safeTexW - splitPx),
    cropH: Math.max(1, safeTexH),
    startX: safeBaseX + 2,
    startY: safeBaseY + 1,
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
  const safeElapsed = Number.isFinite(input.elapsed) ? input.elapsed : 0;
  const safePhase = Number.isFinite(input.phaseOffset) ? input.phaseOffset : 0;
  const safeRecoil =
    input.recoilBoost !== undefined && Number.isFinite(input.recoilBoost) ? input.recoilBoost : 0;
  const flicker = staticMode ? 0.72 : 0.78 + Math.sin(safeElapsed * 24 + safePhase) * 0.22;
  const boost = staticMode ? 0 : Math.min(0.35, Math.max(0, safeRecoil));

  const dir = input.facing === 'right' ? -1 : 1; // exhaust shoots aft (opposite facing)
  const lenFactor = input.facing === 'right' ? 0.145 : 0.135;
  const radFactor = input.facing === 'right' ? 0.13 : 0.12;
  const safeW = Number.isFinite(input.displayWidth) ? input.displayWidth : 128;
  const safeH = Number.isFinite(input.displayHeight) ? input.displayHeight : 64;
  const len = Math.max(12, safeW * lenFactor) * (flicker + boost);
  const rad = Math.max(4.5, safeH * radFactor);

  const ex = Number.isFinite(input.engineX) ? input.engineX : 0;
  const ey = Number.isFinite(input.engineY) ? input.engineY : 0;

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
  const safeElapsed = Number.isFinite(input.elapsed) ? input.elapsed : 0;
  const safePhase = Number.isFinite(input.phaseOffset) ? input.phaseOffset : 0;
  const amp = input.isBoss ? 0.9 : 1.45;
  return Math.sin(safeElapsed * 1.9 + safePhase) * amp;
}

/** Pure JS linear interpolation (zero Phaser.Math dependency) */
export function lerpNumber(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
