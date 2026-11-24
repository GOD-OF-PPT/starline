import Phaser from 'phaser';
import {
  getEnemyShipImageUrl,
  getEventBackdropImageUrl,
  getPlayerShipImageUrl,
  getSectorBgImageUrl,
  getShipModuleImageUrl,
} from '../../assets/itemArt';
import { getShipHardpoints, getShipSplitSlice } from '../../assets/manifest';
import { soundEngine } from '../../audio/soundEngine';
import type { SectorBgIndex } from '../../data/nodes';
import type { GameSettings } from '../../domain/progression';
import type { V3EnemyIntent } from '../data/bosses';
import type { V2EnemyUnitSpec } from '../data/enemies';
import type { V2ShipId } from '../data/ships';
import { getTacticalCommandLabel } from '../domain/combatV2';
import type { V2ShipVisualSpec } from '../domain/shipVisualSpec';
import type {
  SectorId,
  V2CombatRoundLog,
  V2CombatSimulation,
  V2CombatUnitSnapshot,
} from '../domain/types';
import {
  type DamagePopupTier,
  type HpTrailState,
  type MicroExplosionSpec,
  type WreckCompartmentVisualState,
  VFX_HIT_MILD_TINT,
  VFX_IMPACT_GLOW_MAX_RADIUS,
  VFX_MAX_ACTIVE_PARTICLES,
  VFX_WRECK_CUT_DURATION_MS,
  VfxParticlePool,
  allocateNonOverlappingPopupPos,
  applyHpChangeToTrail,
  buildRoundBeatSchedule,
  clampCameraShakeMs,
  computeCameraShakeMagnitudePx,
  computeEnginePlumeGeometry,
  computeHitstopDurationMs,
  computeHpBarTickRatios,
  computeIdleMicroTiltDeg,
  computeSplitHullHalvesSpec,
  computeThreeLayerBeamStrokes,
  computeWreckCutTimeline,
  getDamagePopupStyle,
  lerpNumber,
  resolveHitFlashDecision,
  sanitizeCombatSpeed,
  stepHpTrailState,
} from './v2CombatVfx';

export * from './v2CombatVfx';

export interface V2StagePlayback {
  readonly playbackKey?: string;
  readonly shipId: V2ShipId;
  readonly shipVisualSpec?: V2ShipVisualSpec | null;
  readonly sectorId?: SectorId;
  readonly sectorIndex: SectorBgIndex;
  readonly eventBackdrop: 'wreck' | 'merchant' | 'anomaly' | 'distress' | null;
  readonly units: readonly V2EnemyUnitSpec[];
  readonly simulation: V2CombatSimulation | null;
  readonly settings: GameSettings;
  /** Optional 1-indexed round number to pause BEFORE executing (e.g. 2 for Elite Round-2 decision) */
  readonly pauseAtRound?: number | null;
  /** Optional 0-indexed round index to resume playback from after a tactical decision */
  readonly resumeFromRound?: number;
  readonly onPauseForDecision?: () => void;
  readonly onRoundStep?: (roundIndex: number, log: V2CombatRoundLog) => void;
  readonly onComplete?: () => void;
}

interface BeamFx {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: number;
  thickness: number;
  jagged?: boolean;
  life: number;
  maxLife: number;
}

interface RingFx {
  x: number;
  y: number;
  maxR: number;
  color: number;
  life: number;
  maxLife: number;
}

interface SmokePuff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: number;
  life: number;
  maxLife: number;
}

interface PopupFx {
  textObj: Phaser.GameObjects.Text;
  tier: DamagePopupTier;
  vy: number;
  life: number;
  maxLife: number;
}

interface MountedModuleEntry {
  readonly kind: 'heavy' | 'laser' | 'drone_bay' | 'counter_ring' | 'cargo_rack';
  sprite: Phaser.GameObjects.Image;
  badgeText?: Phaser.GameObjects.Text;
  /** Offset relative to playerSprite display width/height */
  relX: number;
  relY: number;
  scaleRatio: number;
  recoilX: number;
  muzzleOffsetX: number;
  muzzleOffsetY: number;
}

interface ImpactGlowFx {
  x: number;
  y: number;
  maxR: number;
  color: number;
  kind: 'hull' | 'shield' | 'heavy' | 'emp';
  life: number;
  maxLife: number;
}

interface MuzzleFlashFx {
  x: number;
  y: number;
  dir: 1 | -1;
  color: number;
  size: number;
  life: number;
  maxLife: number;
}

interface TracerFx {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: number;
  width: number;
  elapsed: number;
  duration: number;
}

interface DeathChoreoFx {
  readonly enemyId: string;
  readonly baseX: number;
  readonly baseY: number;
  readonly isBoss: boolean;
  readonly foreSprite: Phaser.GameObjects.Image;
  readonly aftSprite: Phaser.GameObjects.Image;
  foreX: number;
  foreY: number;
  foreVx: number;
  foreVy: number;
  foreAngle: number;
  foreVAngle: number;
  aftX: number;
  aftY: number;
  aftVx: number;
  aftVy: number;
  aftAngle: number;
  aftVAngle: number;
  readonly explosions: readonly MicroExplosionSpec[];
  nextExplosionIdx: number;
  elapsed: number;
  readonly duration: number;
}

interface InFlightRoundState {
  readonly roundIdx: number;
  readonly log: V2CombatRoundLog;
  visualsCommitted: boolean;
  stepReported: boolean;
}

interface EnemyVisualEntry {
  readonly enemyId: string;
  readonly spec: V2EnemyUnitSpec;
  sprite: Phaser.GameObjects.Image;
  intentTag?: Phaser.GameObjects.Text;
  baseX: number;
  baseY: number;
  hp: number;
  maxHp: number;
  trailHp: number;
  trailHoldMs: number;
  shield: number;
  maxShield: number;
  phase: number;
  isCharging: boolean;
  baseTint: number | null;
  flashMs: number;
  shieldArcLife: number;
  recoilX: number;
  angleDeg: number;
  dead: boolean;
  brokenApart: boolean;
}

const SHIP_TEX_W = 512;
const SHIP_TEX_H = 256;
const BG_TEX_W = 1280;
const BG_TEX_H = 720;

/**
 * Dedicated V2 Multi-Unit Combat, Modular Ship Showcase & Event Stage Scene:
 * - Renders 3 player ships + 5 real hand-painted modular external hardpoint sprites driven strictly by V2ShipVisualSpec
 *   (Heavy Railgun, Pulse Laser Turret, Ventral Drone Launch Bay, Shield Counter-Arc Ring, External Magnetic Cargo Clamp).
 * - Fires projectiles directly from corresponding mounted hardpoints with mechanical charge/recoil/impact/backflow stages.
 * - Renders enemy tactical intent pills and damaged smoke states when HP < 50%.
 * - Supports Phase-D Elite Round-2 tactical pause boundary (skipPlayback NEVER bypasses an unresolved decision!).
 * - Pure presentation only: replays pre-computed deterministic V2CombatSimulation; zero rule mutation!
 */
export class V2CombatScene extends Phaser.Scene {
  private playback: V2StagePlayback | null = null;
  private appliedPlaybackKey: string | null = null;
  private bgImage: Phaser.GameObjects.Image | null = null;
  private bgGraphics!: Phaser.GameObjects.Graphics;
  private fxGraphics!: Phaser.GameObjects.Graphics;
  private addFxGraphics!: Phaser.GameObjects.Graphics;
  private playerSprite: Phaser.GameObjects.Image | null = null;
  private moduleSprites: MountedModuleEntry[] = [];
  private enemies: EnemyVisualEntry[] = [];

  private stars: { nx: number; ny: number; speed: number; r: number; a: number }[] = [];
  private beams: BeamFx[] = [];
  private rings: RingFx[] = [];
  private impactGlows: ImpactGlowFx[] = [];
  private muzzleFlashes: MuzzleFlashFx[] = [];
  private tracers: TracerFx[] = [];
  private deathChoreos: DeathChoreoFx[] = [];
  private particlePool = new VfxParticlePool(VFX_MAX_ACTIVE_PARTICLES);
  private smokes: SmokePuff[] = [];
  private popups: PopupFx[] = [];
  private wreckCompartments: readonly WreckCompartmentVisualState[] = [];
  private wreckCutAnim: {
    normX: number;
    normY: number;
    elapsedMs: number;
    durationMs: number;
    clampPopped: boolean;
  } | null = null;

  private viewW = 390;
  private viewH = 240;
  private dpr = 1;
  private texturesReady = false;
  private externalPaused = false;
  private decisionPaused = false;
  private elapsed = 0;
  private smokeAccumMs = 0;

  private playerBaseX = 95;
  private playerBaseY = 120;
  private playerBaseTint: number | null = null;
  private playerCurrentTint: number | null = null;
  private playerAngleDeg = 0;
  private playerHpState: HpTrailState = { hp: 0, maxHp: 0, trailHp: 0, holdMs: 0 };
  private playerShield = 0;
  private playerMaxShield = 0;
  private playerRecoilX = 0;
  private playerFlashMs = 0;
  private shieldArcLife = 0;
  private counterBackflowLife = 0;
  private synergyPulseLife = 0;
  private synergyTargetKind: MountedModuleEntry['kind'] | null = null;
  private hangarDoorLife = 0;
  private prevDronesCount = 0;
  private activeDronesCount = 0;
  private heavyChargingCount = 0;
  private enemyChargeMs = 0;
  private shakeTimerMs = 0;
  private hitstopRemainingMs = 0;
  private lastTriggeredHitstopMs = 0;
  private plumesRendered = 0;
  private onAssetError: ((key: string) => void) | null = null;

  private roundTimerMs = 0;
  private nextRoundIdx = 0;
  private playbackActive = false;
  private waitingCompletion = false;
  private completionDelayMs = 0;
  private roundTimers: Phaser.Time.TimerEvent[] = [];
  private roundEpoch = 0;
  private inFlightRound: InFlightRoundState | null = null;

  constructor() {
    super({ key: 'V2CombatScene' });
  }

  setPaused(paused: boolean): void {
    this.externalPaused = paused;
    if (paused) {
      this.hitstopRemainingMs = 0;
      this.flushInFlightRound(true);
    }
    if (this.time) {
      this.time.paused = paused || this.decisionPaused;
    }
  }

  setAssetErrorHandler(handler: (key: string) => void): void {
    this.onAssetError = handler;
  }

  private applyCameraViewport(): void {
    if (!this.cameras?.main) return;
    const bw = Math.round(this.viewW * this.dpr);
    const bh = Math.round(this.viewH * this.dpr);
    this.cameras.main.setViewport(0, 0, bw, bh);
    this.cameras.main.setZoom(this.dpr);
    this.cameras.main.centerOn(this.viewW * 0.5, this.viewH * 0.5);
  }

  syncViewport(w: number, h: number, dpr?: number): void {
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 16 || h < 16) return;
    this.viewW = w;
    this.viewH = h;
    if (dpr !== undefined && Number.isFinite(dpr) && dpr > 0) this.dpr = dpr;
    this.applyCameraViewport();
    if (this.scene?.isActive() && this.texturesReady) {
      this.layoutAll();
    }
  }

  init(data?: {
    playback?: V2StagePlayback;
    getLatestPlayback?: () => V2StagePlayback | null;
    onAssetError?: (key: string) => void;
  }): void {
    const latest = data?.getLatestPlayback?.() ?? data?.playback;
    if (latest) {
      this.playback = latest;
    }
    if (data?.onAssetError) {
      this.onAssetError = data.onAssetError;
    }
  }

  preload(): void {
    this.load.on('loaderror', (file: { key?: string }) => {
      this.onAssetError?.(file?.key ?? 'unknown');
    });
    const queue: [string, string][] = [
      ['bg.sector.1', getSectorBgImageUrl(1)],
      ['bg.sector.2', getSectorBgImageUrl(2)],
      ['bg.sector.3', getSectorBgImageUrl(3)],
      ['bg.sector.4', getSectorBgImageUrl(4)],
      ['bg.sector.5', getSectorBgImageUrl(5)],
      ['bg.sector.6', getSectorBgImageUrl(6)],
      ['event.wreck', getEventBackdropImageUrl('wreck')],
      ['event.merchant', getEventBackdropImageUrl('merchant')],
      ['event.anomaly', getEventBackdropImageUrl('anomaly')],
      ['event.distress', getEventBackdropImageUrl('distress')],
      ['v2.ship.player.cannon_skiff', getPlayerShipImageUrl('cannon_skiff')],
      ['v2.ship.player.shield_cruiser', getPlayerShipImageUrl('shield_cruiser')],
      ['v2.ship.player.heavy_freighter', getPlayerShipImageUrl('heavy_freighter')],
      ['v2.ship.player.stargate_cruiser', getPlayerShipImageUrl('stargate_cruiser')],
      ['ship.enemy.scout', getEnemyShipImageUrl('scout')],
      ['ship.enemy.interceptor', getEnemyShipImageUrl('interceptor')],
      ['ship.enemy.frigate', getEnemyShipImageUrl('frigate')],
      ['ship.enemy.hulk', getEnemyShipImageUrl('hulk')],
      ['ship.enemy.boss_dreadnought', getEnemyShipImageUrl('boss_dreadnought')],
      ['ship.enemy.boss_leviathan', getEnemyShipImageUrl('boss_leviathan')],
      ['ship.mod.laser_turret', getShipModuleImageUrl('laser_turret')],
      ['ship.mod.heavy_railgun', getShipModuleImageUrl('heavy_railgun')],
      ['ship.mod.drone_bay', getShipModuleImageUrl('drone_bay')],
      ['ship.mod.counter_ring', getShipModuleImageUrl('counter_ring')],
      ['ship.mod.cargo_rack', getShipModuleImageUrl('cargo_rack')],
    ];
    for (const [key, url] of queue) {
      if (!this.textures.exists(key)) {
        this.load.image(key, url);
      }
    }
  }

  create(): void {
    this.dpr = (this.game.registry.get('dpr') as number) || 1;
    this.viewW = Math.round((this.scale.width || 390) / this.dpr);
    this.viewH = Math.round((this.scale.height || 240) / this.dpr);
    this.applyCameraViewport();
    this.cameras.main.setBackgroundColor('#0C1524');

    this.stars = [];
    for (let i = 0; i < 42; i++) {
      this.stars.push({
        nx: ((i * 97) % 100) / 100,
        ny: ((i * 53) % 100) / 100,
        speed: 0.028 + (i % 4) * 0.022,
        r: i % 5 === 0 ? 1.5 : 1,
        a: 0.2 + (i % 4) * 0.07,
      });
    }

    this.bgImage = this.add.image(0, 0, 'bg.sector.1').setOrigin(0.5, 0.5).setDepth(0);
    this.bgGraphics = this.add.graphics().setDepth(1);
    this.fxGraphics = this.add.graphics().setDepth(7);
    this.addFxGraphics = this.add.graphics().setDepth(8);
    const addBlendMode = Phaser.BlendModes?.ADD ?? 1;
    if (typeof this.addFxGraphics.setBlendMode === 'function') {
      this.addFxGraphics.setBlendMode(addBlendMode);
    }
    this.playerSprite = null;
    this.moduleSprites = [];
    this.enemies = [];
    this.popups = [];
    this.beams = [];
    this.rings = [];
    this.impactGlows = [];
    this.muzzleFlashes = [];
    this.tracers = [];
    this.deathChoreos = [];
    this.particlePool.clear();
    this.smokes = [];
    this.roundTimers = [];
    this.inFlightRound = null;
    this.hitstopRemainingMs = 0;
    this.lastTriggeredHitstopMs = 0;
    this.plumesRendered = 0;
    this.texturesReady = true;

    this.applyPlayback();

    this.scale.on('resize', this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.cancelRoundTimers();
      this.inFlightRound = null;
      this.hitstopRemainingMs = 0;
      this.texturesReady = false;
      this.appliedPlaybackKey = null;
      this.playbackActive = false;
      this.waitingCompletion = false;
      this.decisionPaused = false;
      this.nextRoundIdx = 0;
      this.beams = [];
      this.rings = [];
      this.impactGlows = [];
      this.muzzleFlashes = [];
      this.tracers = [];
      this.particlePool.clear();
      this.clearDeathChoreos();
      this.smokes = [];
      this.clearPopups();
      this.wreckCompartments = [];
      this.wreckCutAnim = null;
      this.destroyModuleSprites();
      this.destroyEnemySprites();
      this.playerSprite = null;
      this.bgImage = null;
      this.scale.off('resize', this.handleResize, this);
    });
  }

  private handleResize(gameSize?: Phaser.Structs.Size): void {
    if (!this.scene?.isActive()) return;
    const dpr = (this.game.registry.get('dpr') as number) || this.dpr || 1;
    if (gameSize && gameSize.width > 0 && gameSize.height > 0) {
      this.syncViewport(Math.round(gameSize.width / dpr), Math.round(gameSize.height / dpr), dpr);
    } else {
      this.syncViewport(
        Math.round((this.scale.width || 390) / dpr),
        Math.round((this.scale.height || 240) / dpr),
        dpr
      );
    }
  }

  setPlayback(playback: V2StagePlayback): void {
    const nextStaticKey = !playback.simulation ? (playback.playbackKey ?? null) : null;
    if (
      this.scene?.isActive() &&
      this.texturesReady &&
      nextStaticKey !== null &&
      nextStaticKey === this.appliedPlaybackKey
    ) {
      this.playback = {
        ...(this.playback ?? playback),
        shipVisualSpec: playback.shipVisualSpec ?? null,
        settings: playback.settings,
        playbackKey: nextStaticKey,
      };
      this.updateShipVisualSpec(playback.shipVisualSpec ?? null);
      this.updateSettings(playback.settings);
      return;
    }
    this.playback = playback;
    if (this.scene?.isActive() && this.texturesReady) {
      this.applyPlayback();
    }
  }

  /** Updates modular ship hardpoints immediately without resetting backdrop or idle pose */
  updateShipVisualSpec(spec: V2ShipVisualSpec | null): void {
    if (!this.playback) return;
    this.playback = { ...this.playback, shipVisualSpec: spec };
    if (this.scene?.isActive() && this.texturesReady) {
      this.rebuildModuleSprites();
      this.layoutModules();
    }
  }

  updateSettings(settings: GameSettings): void {
    if (this.playback) {
      this.playback = { ...this.playback, settings };
    }
    if (settings.reducedMotion) {
      this.hitstopRemainingMs = 0;
      this.shakeTimerMs = 0;
      if (this.deathChoreos.length > 0) {
        this.clearDeathChoreos();
      }
      this.playerHpState.trailHp = this.playerHpState.hp;
      this.playerHpState.holdMs = 0;
      for (const e of this.enemies) {
        e.trailHp = e.hp;
        e.trailHoldMs = 0;
      }
    }
    if (settings.lowQuality) {
      this.particlePool.clear();
    }
  }

  /** Read-only presentation state snapshot for deterministic stage verification */
  getStagePresentationSnapshot(): {
    readonly appliedPlaybackKey: string | null;
    readonly activeRings: number;
    readonly activeBeams: number;
    readonly activeSmokes: number;
    readonly activePopups: number;
    readonly enemyCount: number;
    readonly moduleCount: number;
    readonly playerVisible: boolean;
    readonly activeImpactGlows: number;
    readonly activeParticles: number;
    readonly activeTracers: number;
    readonly activeMuzzleFlashes: number;
    readonly activeDeathChoreos: number;
    readonly pendingTimers: number;
    readonly hitstopRemainingMs: number;
    readonly lastTriggeredHitstopMs: number;
    readonly playerTint: number | null;
    readonly playerAngle: number;
    readonly playerHp: number;
    readonly playerMaxHp: number;
    readonly playerTrailHp: number;
    readonly playerShield: number;
    readonly plumesRendered: number;
    readonly wreckCutActive: boolean;
    readonly wreckCompartmentsCut: number;
    readonly wreckCompartmentCount: number;
    readonly enemiesState: readonly {
      readonly enemyId: string;
      readonly hp: number;
      readonly trailHp: number;
      readonly shield: number;
      readonly dead: boolean;
      readonly flashMs: number;
      readonly shieldArcLife: number;
      readonly angle: number;
    }[];
  } {
    return {
      appliedPlaybackKey: this.appliedPlaybackKey,
      activeRings: this.rings.length,
      activeBeams: this.beams.length,
      activeSmokes: this.smokes.length,
      activePopups: this.popups.length,
      enemyCount: this.enemies.length,
      moduleCount: this.moduleSprites.length,
      playerVisible: Boolean(this.playerSprite?.visible),
      activeImpactGlows: this.impactGlows.length,
      activeParticles: this.particlePool.getActiveCount(),
      activeTracers: this.tracers.length,
      activeMuzzleFlashes: this.muzzleFlashes.length,
      activeDeathChoreos: this.deathChoreos.length,
      pendingTimers: this.roundTimers.length,
      hitstopRemainingMs: this.hitstopRemainingMs,
      lastTriggeredHitstopMs: this.lastTriggeredHitstopMs,
      playerTint: this.playerCurrentTint,
      playerAngle: this.playerAngleDeg,
      playerHp: this.playerHpState.hp,
      playerMaxHp: this.playerHpState.maxHp,
      playerTrailHp: this.playerHpState.trailHp,
      playerShield: this.playerShield,
      plumesRendered: this.plumesRendered,
      wreckCutActive: this.wreckCutAnim !== null,
      wreckCompartmentsCut: this.wreckCompartments.filter((c) => c.cut).length,
      wreckCompartmentCount: this.wreckCompartments.length,
      enemiesState: this.enemies.map((e) => ({
        enemyId: e.enemyId,
        hp: e.hp,
        trailHp: e.trailHp,
        shield: e.shield,
        dead: e.dead,
        flashMs: e.flashMs,
        shieldArcLife: e.shieldArcLife,
        angle: e.angleDeg,
      })),
    };
  }

  /**
   * Plays plasma cutting seam + spark burst on wreck backdrop when player cuts a room open.
   * Preserves exact 2-arg signature & Frame-0 ring/SFX invariants (F02/S08/A07-code).
   */
  triggerWreckCutFx(normX: number, normY: number): void {
    if (!this.scene?.isActive() || !this.texturesReady) return;
    const x = this.viewW * normX;
    const y = this.viewH * normY;
    const reduced = this.playback?.settings.reducedMotion ?? false;
    this.rings.push({ x, y, maxR: 38, color: 0xf6b852, life: 0.36, maxLife: 0.36 });
    this.rings.push({ x, y, maxR: 22, color: 0x62d6df, life: 0.28, maxLife: 0.28 });
    this.spawnImpactGlow(x, y, 0xf6b852, 'heavy', 16);
    this.particlePool.spawnBurst({
      kind: 'spark',
      x,
      y,
      count: 14,
      color: 0xf6b852,
      lowQuality: this.playback?.settings.lowQuality ?? false,
    });
    this.wreckCutAnim = reduced
      ? null
      : {
          normX,
          normY,
          elapsedMs: 0,
          durationMs: VFX_WRECK_CUT_DURATION_MS,
          clampPopped: false,
        };
    soundEngine.play('wreckCut');
  }

  setWreckCompartmentStates(states: readonly WreckCompartmentVisualState[]): void {
    this.wreckCompartments = states;
  }

  popWreckCutClamp(normX: number, normY: number): void {
    if (!this.scene?.isActive() || !this.texturesReady) return;
    const x = this.viewW * normX;
    const y = this.viewH * normY;
    if (this.wreckCutAnim) {
      this.wreckCutAnim.clampPopped = true;
    }
    this.rings.push({ x, y, maxR: 44, color: 0x62d6df, life: 0.3, maxLife: 0.3 });
    this.spawnImpactGlow(x, y, 0x62d6df, 'shield', 15);
    this.particlePool.spawnBurst({
      kind: 'spark',
      x,
      y,
      count: 12,
      color: 0x62d6df,
      lowQuality: this.playback?.settings.lowQuality ?? false,
    });
  }

  finishWreckCutFx(): void {
    this.wreckCutAnim = null;
  }

  private cancelRoundTimers(): void {
    this.roundEpoch += 1;
    for (const timer of this.roundTimers) {
      this.time?.removeEvent?.(timer);
      timer?.remove?.(false);
    }
    this.roundTimers = [];
  }

  private scheduleRoundTimer(delayMs: number, epoch: number, callback: () => void): void {
    if (this.time && typeof this.time.delayedCall === 'function') {
      let handle: Phaser.Time.TimerEvent | null = null;
      handle = this.time.delayedCall(Math.max(0, delayMs), () => {
        if (handle) {
          this.roundTimers = this.roundTimers.filter((t) => t !== handle);
        }
        if (epoch !== this.roundEpoch || !this.texturesReady) return;
        callback();
      });
      if (handle) {
        this.roundTimers.push(handle);
      }
    } else if (epoch === this.roundEpoch && this.texturesReady) {
      callback();
    }
  }

  private applyPlayerHpUpdate(nextHp: number, nextShield: number, snap = false): void {
    const reduced = snap || (this.playback?.settings.reducedMotion ?? false);
    if (Number.isFinite(nextHp)) {
      this.playerHpState.maxHp = Math.max(this.playerHpState.maxHp, nextHp);
    }
    applyHpChangeToTrail(this.playerHpState, nextHp, reduced);
    this.playerShield = nextShield;
    this.playerMaxShield = Math.max(this.playerMaxShield, nextShield);
  }

  private flushInFlightRound(reportStep: boolean, snapTrails = false): void {
    this.cancelRoundTimers();
    const pending = this.inFlightRound;
    this.inFlightRound = null;
    if (!pending) return;
    if (!pending.visualsCommitted) {
      pending.visualsCommitted = true;
      this.syncUnitStatesToRound(pending.log, snapTrails);
    }
    if (reportStep && !pending.stepReported) {
      pending.stepReported = true;
      this.playback?.onRoundStep?.(pending.roundIdx, pending.log);
    }
  }

  private spawnImpactGlow(
    x: number,
    y: number,
    color: number,
    kind: ImpactGlowFx['kind'],
    maxR = VFX_IMPACT_GLOW_MAX_RADIUS
  ): void {
    const clampedR = Math.min(VFX_IMPACT_GLOW_MAX_RADIUS, Math.max(6, maxR));
    const duration = kind === 'heavy' ? 0.22 : kind === 'shield' ? 0.24 : 0.16;
    this.impactGlows.push({
      x,
      y,
      maxR: clampedR,
      color,
      kind,
      life: duration,
      maxLife: duration,
    });
  }

  private spawnMuzzleFlash(x: number, y: number, dir: 1 | -1, color: number, size: number): void {
    const duration = size >= 14 ? 0.14 : 0.1;
    this.muzzleFlashes.push({
      x,
      y,
      dir,
      color,
      size,
      life: duration,
      maxLife: duration,
    });
  }

  private spawnTracer(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: number,
    width = 3.4,
    duration = 0.12
  ): void {
    this.tracers.push({
      x1,
      y1,
      x2,
      y2,
      color,
      width,
      elapsed: 0,
      duration,
    });
  }

  private triggerHitstop(durationMs: number): void {
    if (durationMs <= 0) return;
    this.hitstopRemainingMs = Math.max(this.hitstopRemainingMs, durationMs);
    this.lastTriggeredHitstopMs = Math.max(this.lastTriggeredHitstopMs, durationMs);
  }

  private triggerShake(durationMs: number, reduced: boolean): void {
    const clamped = clampCameraShakeMs(durationMs, reduced);
    if (clamped > 0) {
      this.shakeTimerMs = Math.min(clampCameraShakeMs(120, false), Math.max(this.shakeTimerMs, clamped));
    }
  }

  private clearDeathChoreos(): void {
    for (const dc of this.deathChoreos) {
      if (dc.foreSprite?.scene) dc.foreSprite.destroy();
      if (dc.aftSprite?.scene) dc.aftSprite.destroy();
    }
    this.deathChoreos = [];
  }

  skipPlayback(): void {
    if (this.externalPaused || this.decisionPaused) return;
    if (!this.playback?.simulation || (!this.playbackActive && !this.waitingCompletion)) return;
    const sim = this.playback.simulation;
    const pauseAt = this.playback.pauseAtRound ?? null;

    // Cleanly cancel pending beat timers and commit any in-flight round ONCE without double-applying
    this.hitstopRemainingMs = 0;
    this.clearDeathChoreos();
    this.flushInFlightRound(true, true);

    // Guard before loop as well (e.g. Round-1 seeded pause with empty rounds array)
    if (pauseAt !== null && this.nextRoundIdx + 1 === pauseAt) {
      this.playbackActive = false;
      this.decisionPaused = true;
      if (this.time) this.time.paused = true;
      this.playback.onPauseForDecision?.();
      return;
    }

    while (this.nextRoundIdx < sim.rounds.length) {
      // Strictly respect unresolved tactical decision boundary!
      if (pauseAt !== null && this.nextRoundIdx + 1 === pauseAt) {
        this.playbackActive = false;
        this.decisionPaused = true;
        if (this.time) this.time.paused = true;
        this.playback.onPauseForDecision?.();
        return;
      }
      const log = sim.rounds[this.nextRoundIdx];
      this.syncUnitStatesToRound(log, true);
      this.playback.onRoundStep?.(this.nextRoundIdx, log);
      this.nextRoundIdx += 1;
    }
    this.playbackActive = false;
    this.waitingCompletion = false;
    this.playback.onComplete?.();
  }

  private getRoleBaseTint(unit: Pick<V2EnemyUnitSpec, 'enemyId' | 'name' | 'role' | 'isBoss'>): number | null {
    if (unit.isBoss) return null;
    const role = unit.role;
    const idLower = unit.enemyId.toLowerCase();
    if (role === 'artillery' || idLower.includes('artillery') || unit.name.includes('火炮')) return 0xffe0ad;
    if (role === 'shield_regen' || idLower.includes('shield_regen') || unit.name.includes('自愈')) return 0xc7f5ff;
    if (role === 'emp_disruptor' || idLower.includes('emp') || unit.name.includes('电磁')) return 0xe1ccff;
    if (role === 'rammer' || idLower.includes('rammer') || unit.name.includes('冲撞')) return 0xffc6c6;
    return null;
  }

  private formatCanvasIntentTag(
    unit: Pick<V2EnemyUnitSpec, 'damagePerRound' | 'armor' | 'pierceRatio'>,
    intent?: V3EnemyIntent,
    shield = 0
  ): { readonly text: string; readonly color: string; readonly isCharging: boolean } {
    if (intent) {
      const parts: string[] = [intent.shortLabel];
      if (intent.damage > 0) parts.push(`攻${intent.damage}`);
      if (intent.shieldGain && intent.shieldGain > 0 && !intent.shortLabel.includes('盾')) {
        parts.push(`盾+${intent.shieldGain}`);
      }
      if (shield > 0) parts.push(`盾${shield}`);
      const color =
        intent.kind === 'charge'
          ? '#F6B852'
          : intent.kind === 'pierce_beam' || intent.kind === 'ram' || intent.kind === 'heavy_volley'
          ? '#FF8AA8'
          : intent.kind === 'shield_regen'
          ? '#62D6DF'
          : intent.kind === 'emp'
          ? '#D6B8FF'
          : intent.kind === 'summon'
          ? '#7AE582'
          : '#E9EDF2';
      return {
        text: parts.join(' · '),
        color,
        isCharging: intent.kind === 'charge',
      };
    }
    const intentParts: string[] = [`攻${unit.damagePerRound}`];
    if (unit.armor > 0) intentParts.push(`甲${unit.armor}`);
    if (unit.pierceRatio > 0) intentParts.push(`穿${Math.round(unit.pierceRatio * 100)}%`);
    if (shield > 0) intentParts.push(`盾${shield}`);
    return {
      text: intentParts.join(' · '),
      color: unit.pierceRatio > 0 ? '#FFA3B8' : unit.armor > 0 ? '#F6B852' : '#E9EDF2',
      isCharging: false,
    };
  }

  private spawnEnemyVisualEntry(
    unit: V2EnemyUnitSpec,
    initialSnap?: V2CombatUnitSnapshot
  ): EnemyVisualEntry {
    const eKey = `ship.enemy.${unit.spriteArchetype}`;
    const sprite = this.add
      .image(0, 0, this.textures.exists(eKey) ? eKey : 'ship.enemy.scout')
      .setOrigin(0.5, 0.5)
      .setDepth(unit.isBoss ? 4 : 3);

    const initShield = initialSnap?.shield ?? unit.initialShield ?? 0;
    const initMaxShield = initialSnap?.maxShield ?? unit.maxShield ?? initShield;
    const tag = this.formatCanvasIntentTag(unit, initialSnap?.nextIntent, initShield);

    const intentTag = this.add
      .text(0, 0, tag.text, {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: unit.isBoss ? '11px' : '10px',
        fontStyle: 'bold',
        color: tag.color,
        backgroundColor: 'rgba(11, 18, 31, 0.84)',
        padding: { left: 5, right: 5, top: 2, bottom: 2 },
        resolution: 2,
      })
      .setOrigin(0.5, 0.5)
      .setDepth(6);

    const baseTint = this.getRoleBaseTint(unit);
    if (baseTint !== null) {
      sprite.setTint(baseTint);
    }

    const initHp = initialSnap ? initialSnap.hp : unit.maxHp;
    const initMaxHp = initialSnap ? initialSnap.maxHp : unit.maxHp;
    const entry: EnemyVisualEntry = {
      enemyId: unit.enemyId,
      spec: unit,
      sprite,
      intentTag,
      baseX: 0,
      baseY: 0,
      hp: initHp,
      maxHp: initMaxHp,
      trailHp: initHp,
      trailHoldMs: 0,
      shield: initShield,
      maxShield: initMaxShield,
      phase: initialSnap?.currentPhase ?? 1,
      isCharging: tag.isCharging,
      baseTint,
      flashMs: 0,
      shieldArcLife: 0,
      recoilX: 0,
      angleDeg: 0,
      dead: initHp <= 0,
      brokenApart: false,
    };
    this.enemies.push(entry);
    return entry;
  }

  private applyEnemyHpUpdate(entry: EnemyVisualEntry, nextHp: number, snap = false): void {
    const reduced = snap || (this.playback?.settings.reducedMotion ?? false);
    const trailState: HpTrailState = {
      hp: entry.hp,
      maxHp: entry.maxHp,
      trailHp: entry.trailHp,
      holdMs: entry.trailHoldMs,
    };
    applyHpChangeToTrail(trailState, nextHp, reduced);
    entry.hp = trailState.hp;
    entry.trailHp = trailState.trailHp;
    entry.trailHoldMs = trailState.holdMs;
  }

  private syncEnemyRosterFromSnapshots(
    snapshots: readonly V2CombatUnitSnapshot[],
    animated = false,
    snapTrails = false
  ): void {
    let addedAny = false;
    const newlyAdded: EnemyVisualEntry[] = [];
    for (const snap of snapshots) {
      let entry = this.enemies.find((e) => e.enemyId === snap.enemyId);
      if (!entry && snap.hp > 0) {
        const spec: V2EnemyUnitSpec = {
          enemyId: snap.enemyId,
          name: snap.name,
          spriteArchetype: snap.spriteArchetype,
          maxHp: snap.maxHp,
          damagePerRound: snap.damagePerRound,
          armor: snap.armor,
          pierceRatio: snap.pierceRatio,
          isBoss: snap.isBoss,
        };
        entry = this.spawnEnemyVisualEntry(spec, snap);
        addedAny = true;
        newlyAdded.push(entry);
      }
      if (!entry) continue;
      this.applyEnemyHpUpdate(entry, snap.hp, snapTrails);
      entry.shield = snap.shield ?? 0;
      entry.maxShield = Math.max(entry.maxShield, snap.maxShield ?? entry.shield);
      if (snap.currentPhase !== undefined) {
        entry.phase = snap.currentPhase;
      }
      if (snap.hp <= 0) {
        const hasActiveChoreo = this.deathChoreos.some((dc) => dc.enemyId === entry!.enemyId);
        entry.dead = true;
        entry.isCharging = false;
        if (!hasActiveChoreo && !entry.brokenApart) {
          entry.sprite.setVisible(true).setAlpha(0.18).setTint(0x4b5563);
        } else if (entry.brokenApart) {
          entry.sprite.setVisible(false);
        }
        entry.intentTag?.setVisible(false);
      } else {
        const tag = this.formatCanvasIntentTag(snap, snap.nextIntent, entry.shield);
        entry.isCharging = tag.isCharging;
        if (entry.intentTag?.scene) {
          entry.intentTag.setText(tag.text).setColor(tag.color).setVisible(true);
        }
      }
    }
    if (addedAny) {
      this.layoutEnemies();
      if (animated) {
        soundEngine.play('droneLaunch');
        for (const spawned of newlyAdded) {
          this.rings.push({
            x: spawned.baseX,
            y: spawned.baseY,
            maxR: 28,
            color: 0x7ae582,
            life: 0.4,
            maxLife: 0.4,
          });
          this.spawnPopup(spawned.baseX, spawned.baseY - 22, '增援抵达', '#7AE582', 'status');
        }
      }
    }
  }

  private syncUnitStatesToRound(log: V2CombatRoundLog, snapTrails = false): void {
    this.activeDronesCount = Object.values(log.droneCountsByHangar).reduce((a, b) => a + b, 0);
    this.heavyChargingCount = log.heavyChargingIds.length;
    this.applyPlayerHpUpdate(log.playerHpAfter, log.playerShieldAfter, snapTrails);
    this.syncEnemyRosterFromSnapshots(log.enemiesAfter, false, snapTrails);
  }

  private clearPopups(): void {
    for (const p of this.popups) {
      if (p.textObj?.scene) p.textObj.destroy();
    }
    this.popups = [];
  }

  private destroyModuleSprites(): void {
    for (const m of this.moduleSprites) {
      if (m.sprite?.scene) m.sprite.destroy();
      if (m.badgeText?.scene) m.badgeText.destroy();
    }
    this.moduleSprites = [];
  }

  private destroyEnemySprites(): void {
    for (const e of this.enemies) {
      if (e.sprite?.scene) e.sprite.destroy();
      if (e.intentTag?.scene) e.intentTag.destroy();
    }
    this.enemies = [];
  }

  private rebuildModuleSprites(): void {
    this.destroyModuleSprites();
    const spec = this.playback?.shipVisualSpec;
    if (
      !spec ||
      !this.playerSprite ||
      !this.playerSprite.scene ||
      !this.playerSprite.visible ||
      this.playback?.eventBackdrop === 'wreck'
    ) {
      return;
    }

    const addMount = (
      kind: MountedModuleEntry['kind'],
      texKey: string,
      relX: number,
      relY: number,
      scaleRatio: number,
      depth: number,
      muzzleOffsetX: number,
      muzzleOffsetY: number,
      countBadge?: number
    ) => {
      if (!this.textures.exists(texKey)) return;
      const sprite = this.add.image(0, 0, texKey).setOrigin(0.5, 0.5).setDepth(depth);
      let badgeText: Phaser.GameObjects.Text | undefined;
      if (countBadge && countBadge > 1) {
        badgeText = this.add
          .text(0, 0, `×${countBadge}`, {
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: '11px',
            fontStyle: 'bold',
            color: '#F6B852',
            backgroundColor: 'rgba(11, 18, 31, 0.84)',
            padding: { left: 4, right: 4, top: 1, bottom: 1 },
            resolution: 2,
          })
          .setOrigin(0.5, 0.5)
          .setDepth(depth + 1);
      }
      this.moduleSprites.push({
        kind,
        sprite,
        badgeText,
        relX,
        relY,
        scaleRatio,
        recoilX: 0,
        muzzleOffsetX,
        muzzleOffsetY,
      });
    };

    // 1. Dorsal Main Weapon: Heavy Railgun or Pulse Laser Turret (or both staggered cleanly)
    if (spec.heavyCount > 0) {
      addMount(
        'heavy',
        'ship.mod.heavy_railgun',
        0.04,
        -0.38,
        0.46,
        4,
        0.44,
        -0.02,
        spec.heavyCount
      );
    }
    if (spec.laserCount > 0) {
      addMount(
        'laser',
        'ship.mod.laser_turret',
        spec.heavyCount > 0 ? -0.18 : 0.08,
        spec.heavyCount > 0 ? -0.34 : -0.34,
        0.34,
        4,
        0.44,
        -0.06,
        spec.laserCount
      );
    }

    // 2. Dorsal Counter-Arc Emitter Ring (mounts aft or forward dorsal when counter is installed)
    if (spec.hasCounter) {
      const hasTopWeapon = spec.heavyCount > 0 || spec.laserCount > 0;
      addMount(
        'counter_ring',
        'ship.mod.counter_ring',
        hasTopWeapon ? -0.26 : -0.02,
        -0.36,
        0.30,
        4,
        0.38,
        -0.06
      );
    }

    // 3. Ventral Drone Launch Bay Pod
    if (spec.hangarCount > 0) {
      addMount(
        'drone_bay',
        'ship.mod.drone_bay',
        0.06,
        0.42,
        0.38,
        4,
        0.36,
        0.04,
        spec.hangarCount
      );
    }

    // 4. External Magnetic Cargo Clamp (shown for Sealed Reactor / Escape Pods / Heavy Salvage Load)
    if (spec.hasSealedReactor || spec.escapePodCount > 0 || spec.cargoMassTier >= 2) {
      addMount(
        'cargo_rack',
        'ship.mod.cargo_rack',
        spec.hangarCount > 0 ? -0.26 : -0.16,
        0.40,
        0.34,
        2,
        0,
        0
      );
    }
  }

  private layoutModules(bobY = 0): void {
    if (!this.playerSprite || !this.playerSprite.scene) return;
    const dw = this.playerSprite.displayWidth;
    const dh = this.playerSprite.displayHeight;
    const px = this.playerSprite.x;
    const py = this.playerSprite.y + bobY * 0; // playerSprite.y already includes bobY in update!

    for (const m of this.moduleSprites) {
      const targetW = dw * m.scaleRatio;
      const scale = targetW / (m.sprite.width || 256);
      const mx = px + dw * m.relX + m.recoilX;
      const my = py + dh * m.relY;
      m.sprite.setScale(scale).setPosition(mx, my);
      if (m.badgeText) {
        m.badgeText.setPosition(mx - m.sprite.displayWidth * 0.25, my - m.sprite.displayHeight * 0.48);
      }
      if (this.playerFlashMs > 0) {
        m.sprite.setTint(VFX_HIT_MILD_TINT);
      } else {
        m.sprite.clearTint();
      }
    }
  }

  private getModuleMuzzle(kind: MountedModuleEntry['kind']): { x: number; y: number } | null {
    const mod = this.moduleSprites.find((m) => m.kind === kind);
    if (!mod || !mod.sprite.scene) return null;
    return {
      x: mod.sprite.x + mod.sprite.displayWidth * mod.muzzleOffsetX,
      y: mod.sprite.y + mod.sprite.displayHeight * mod.muzzleOffsetY,
    };
  }

  private applyPlayback(): void {
    this.cancelRoundTimers();
    this.inFlightRound = null;
    this.beams = [];
    this.rings = [];
    this.impactGlows = [];
    this.muzzleFlashes = [];
    this.tracers = [];
    this.particlePool.clear();
    this.clearDeathChoreos();
    this.smokes = [];
    this.clearPopups();
    this.destroyModuleSprites();
    this.destroyEnemySprites();

    this.roundTimerMs = 0;
    this.nextRoundIdx = this.playback?.resumeFromRound ?? 0;
    this.decisionPaused = false;
    this.waitingCompletion = false;
    this.completionDelayMs = 0;
    this.playerRecoilX = 0;
    this.playerFlashMs = 0;
    this.playerAngleDeg = 0;
    this.shieldArcLife = 0;
    this.counterBackflowLife = 0;
    this.synergyPulseLife = 0;
    this.synergyTargetKind = null;
    this.hangarDoorLife = 0;
    this.prevDronesCount = 0;
    this.activeDronesCount = 0;
    this.heavyChargingCount = 0;
    this.enemyChargeMs = 0;
    this.shakeTimerMs = 0;
    this.hitstopRemainingMs = 0;
    this.lastTriggeredHitstopMs = 0;
    this.plumesRendered = 0;
    if (this.time) {
      this.time.paused = this.externalPaused;
    }

    const pb = this.playback;
    if (!pb) {
      this.appliedPlaybackKey = null;
      this.playerBaseTint = null;
      this.playerCurrentTint = null;
      this.playerHpState = { hp: 0, maxHp: 0, trailHp: 0, holdMs: 0 };
      this.playerShield = 0;
      this.playerMaxShield = 0;
      return;
    }
    this.appliedPlaybackKey = !pb.simulation ? (pb.playbackKey ?? null) : null;
    this.wreckCutAnim = null;
    if (pb.eventBackdrop !== 'wreck') {
      this.wreckCompartments = [];
    }
    const initPlayerHp = pb.simulation?.startingPlayerHp ?? 0;
    const initPlayerShield = pb.simulation?.startingPlayerShield ?? 0;
    this.playerHpState = {
      hp: initPlayerHp,
      maxHp: initPlayerHp,
      trailHp: initPlayerHp,
      holdMs: 0,
    };
    this.playerShield = initPlayerShield;
    this.playerMaxShield = initPlayerShield;

    // Backdrop: event scene or sector deep-space
    const bgKey = pb.eventBackdrop
      ? `event.${pb.eventBackdrop}`
      : `bg.sector.${pb.sectorIndex ?? 1}`;
    if (!this.bgImage || !this.bgImage.scene) {
      this.bgImage = this.add
        .image(0, 0, this.textures.exists(bgKey) ? bgKey : 'bg.sector.1')
        .setOrigin(0.5, 0.5)
        .setDepth(0);
    } else if (this.textures.exists(bgKey)) {
      this.bgImage.setTexture(bgKey);
    }
    if (pb.eventBackdrop) {
      this.bgImage.clearTint();
    } else if (pb.sectorId === 'frozen_graveyard') {
      this.bgImage.setTint(0xd8f3ff);
    } else if (pb.sectorId === 'stargate_abyss') {
      this.bgImage.setTint(0xddd0ff);
    } else {
      this.bgImage.clearTint();
    }

    // Player ship sprite (hide on wreck backdrop so the 3 interactive hull compartments stay unobstructed!)
    const showPlayerShip = pb.eventBackdrop !== 'wreck';
    const rawKey = `v2.ship.player.${pb.shipId}`;
    const pKey = this.textures.exists(rawKey) ? rawKey : 'v2.ship.player.shield_cruiser';
    if (!this.playerSprite || !this.playerSprite.scene) {
      this.playerSprite = this.add.image(0, 0, pKey).setOrigin(0.5, 0.5).setDepth(3);
    } else {
      this.playerSprite.setTexture(pKey);
    }
    this.playerSprite.setVisible(showPlayerShip).setAlpha(1);
    this.playerBaseTint = pb.shipId === 'stargate_cruiser' ? 0xe6f8ff : null;
    this.playerCurrentTint = this.playerBaseTint;
    if (this.playerBaseTint !== null) {
      this.playerSprite.setTint(this.playerBaseTint);
    } else {
      this.playerSprite.clearTint();
    }

    if (showPlayerShip) {
      this.rebuildModuleSprites();
    }

    // Enemy unit sprites (1..5+) + dynamic tactical intent pills
    const initSnaps = pb.simulation?.initialEnemies ?? [];
    for (const unit of pb.units) {
      const initSnap = initSnaps.find((s) => s.enemyId === unit.enemyId);
      this.spawnEnemyVisualEntry(unit, initSnap);
    }

    // If resuming from Round >= 1 (e.g. after tactical choice or reload), fast-sync unit roster, HP, shield, phase & summons
    if (pb.simulation && this.nextRoundIdx > 0 && pb.simulation.rounds.length > 0) {
      const targetIdx = Math.min(this.nextRoundIdx - 1, pb.simulation.rounds.length - 1);
      for (let idx = 0; idx <= targetIdx; idx++) {
        this.syncUnitStatesToRound(pb.simulation.rounds[idx], true);
      }
    }

    this.layoutAll();

    if (pb.simulation) {
      const pauseAt = pb.pauseAtRound ?? null;
      if (pauseAt !== null && this.nextRoundIdx + 1 === pauseAt) {
        // Immediate reload-safe or Round-1 pause guard (works even when simulation.rounds is empty!)
        this.playbackActive = false;
        this.decisionPaused = true;
        pb.onPauseForDecision?.();
      } else {
        this.playbackActive = true;
        this.roundTimerMs = this.nextRoundIdx > 0 ? 180 : 240;
        if (this.nextRoundIdx === 0 && pb.units.some((u) => u.isBoss)) {
          soundEngine.play('bossAlarm');
        }
      }
    } else {
      this.playbackActive = false;
    }
  }

  private layoutEnemies(): void {
    const w = this.viewW;
    const h = this.viewH;
    const baseShipScale = Math.min((w * 0.34) / SHIP_TEX_W, (h * 0.46) / SHIP_TEX_H);

    const n = this.enemies.length;
    if (n === 1) {
      const e = this.enemies[0];
      e.baseX = w * 0.76;
      e.baseY = h * 0.54;
      const mult = e.spec.isBoss ? 1.16 : 1.0;
      e.sprite.setScale(baseShipScale * mult).setPosition(e.baseX, e.baseY);
    } else if (n === 2) {
      const positions: [number, number][] = [
        [w * 0.72, h * 0.40],
        [w * 0.78, h * 0.68],
      ];
      this.enemies.forEach((e, idx) => {
        const [ex, ey] = positions[idx];
        e.baseX = ex;
        e.baseY = ey;
        const mult = e.spec.isBoss ? 1.04 : 0.72;
        e.sprite.setScale(baseShipScale * mult).setPosition(ex, ey);
      });
    } else if (n === 3) {
      const positions: [number, number, number][] = [
        [w * 0.80, h * 0.54, 1.08],
        [w * 0.62, h * 0.35, 0.54],
        [w * 0.62, h * 0.73, 0.54],
      ];
      this.enemies.forEach((e, idx) => {
        const [ex, ey, mult] = positions[idx] ?? [w * 0.74, h * 0.54, 0.62];
        e.baseX = ex;
        e.baseY = ey;
        e.sprite.setScale(baseShipScale * mult).setPosition(ex, ey);
      });
    } else if (n === 4) {
      const hasBoss = this.enemies.some((e) => e.spec.isBoss);
      if (hasBoss) {
        const bossEntry = this.enemies.find((e) => e.spec.isBoss)!;
        const others = this.enemies.filter((e) => e !== bossEntry);
        bossEntry.baseX = w * 0.82;
        bossEntry.baseY = h * 0.54;
        bossEntry.sprite.setScale(baseShipScale * 1.02).setPosition(bossEntry.baseX, bossEntry.baseY);
        const ySlots = [h * 0.30, h * 0.54, h * 0.78];
        others.forEach((e, idx) => {
          e.baseX = w * 0.60;
          e.baseY = ySlots[idx] ?? h * 0.54;
          e.sprite.setScale(baseShipScale * 0.48).setPosition(e.baseX, e.baseY);
        });
      } else {
        const positions: [number, number][] = [
          [w * 0.63, h * 0.34],
          [w * 0.82, h * 0.39],
          [w * 0.63, h * 0.72],
          [w * 0.82, h * 0.68],
        ];
        this.enemies.forEach((e, idx) => {
          const [ex, ey] = positions[idx % positions.length];
          e.baseX = ex;
          e.baseY = ey;
          e.sprite.setScale(baseShipScale * 0.52).setPosition(ex, ey);
        });
      }
    } else if (n >= 5) {
      const bossEntry = this.enemies.find((e) => e.spec.isBoss) ?? this.enemies[0];
      const others = this.enemies.filter((e) => e !== bossEntry);
      bossEntry.baseX = w * 0.82;
      bossEntry.baseY = h * 0.54;
      bossEntry.sprite
        .setScale(baseShipScale * (bossEntry.spec.isBoss ? 1.0 : 0.72))
        .setPosition(bossEntry.baseX, bossEntry.baseY);
      const count = others.length;
      others.forEach((e, idx) => {
        const frac = count > 1 ? idx / (count - 1) : 0.5;
        e.baseX = idx % 2 === 0 ? w * 0.58 : w * 0.66;
        e.baseY = h * (0.28 + frac * 0.48);
        e.sprite.setScale(baseShipScale * 0.44).setPosition(e.baseX, e.baseY);
      });
    }

    for (const e of this.enemies) {
      if (e.intentTag && e.intentTag.scene) {
        const yOff = e.sprite.displayHeight * 0.52 + 10;
        e.intentTag.setPosition(e.baseX, e.baseY - yOff).setVisible(!e.dead);
      }
    }
  }

  private layoutAll(): void {
    const w = this.viewW;
    const h = this.viewH;

    if (this.bgImage && this.bgImage.scene) {
      const bgScale = Math.max(w / BG_TEX_W, h / BG_TEX_H);
      this.bgImage.setPosition(w * 0.5, h * 0.5).setScale(bgScale);
    }

    const baseShipScale = Math.min((w * 0.34) / SHIP_TEX_W, (h * 0.46) / SHIP_TEX_H);
    const hasCombatUnits = this.enemies.length > 0;
    this.playerBaseX = hasCombatUnits ? w * 0.24 : w * 0.48;
    this.playerBaseY = hasCombatUnits ? h * 0.54 : h * 0.56;

    if (this.playerSprite && this.playerSprite.scene) {
      const flagshipMult = this.playback?.shipId === 'stargate_cruiser' ? 1.06 : 1.0;
      const pScale = (hasCombatUnits ? baseShipScale : baseShipScale * 1.15) * flagshipMult;
      this.playerSprite.setScale(pScale).setPosition(this.playerBaseX, this.playerBaseY);
      this.layoutModules();
    }

    this.layoutEnemies();
  }

  private getSpritePoint(sprite: Phaser.GameObjects.Image, norm: { x: number; y: number }): { x: number; y: number } {
    const dw = sprite.displayWidth;
    const dh = sprite.displayHeight;
    return {
      x: sprite.x - dw * 0.5 + dw * norm.x,
      y: sprite.y - dh * 0.5 + dh * norm.y,
    };
  }

  private spawnPopup(
    x: number,
    y: number,
    text: string,
    colorOverride?: string,
    tier: DamagePopupTier = 'normal'
  ): void {
    const reduced = this.playback?.settings.reducedMotion ?? false;
    const style = getDamagePopupStyle(tier);
    const existing = this.popups
      .filter((p) => p.textObj?.scene)
      .map((p) => ({ x: p.textObj.x, y: p.textObj.y }));
    const pos = allocateNonOverlappingPopupPos({
      desiredX: x,
      desiredY: y,
      existing,
      viewW: this.viewW,
      viewH: this.viewH,
    });
    const t = this.add
      .text(pos.x, pos.y, text, {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: style.fontSize,
        fontStyle: 'bold',
        color: colorOverride ?? style.color,
        stroke: style.stroke,
        strokeThickness: style.strokeThickness,
        resolution: 2,
      })
      .setOrigin(0.5, 0.5)
      .setDepth(9);
    this.popups.push({
      textObj: t,
      tier,
      vy: reduced ? 0 : style.vy,
      life: style.maxLife,
      maxLife: style.maxLife,
    });
  }

  private executeRoundVisual(roundIdx: number, log: V2CombatRoundLog): void {
    const pb = this.playback;
    if (!pb || !this.playerSprite) return;

    // Flush any previous in-flight round cleanly before starting the next round
    this.flushInFlightRound(true);

    const reduced = pb.settings.reducedMotion;
    const speed = sanitizeCombatSpeed(pb.settings.combatSpeed ?? 1);
    const vSpec = pb.shipVisualSpec;

    const roundState: InFlightRoundState = {
      roundIdx,
      log,
      visualsCommitted: false,
      stepReported: false,
    };
    this.inFlightRound = roundState;
    const epoch = this.roundEpoch;

    const prevAliveIds = new Set(this.enemies.filter((e) => !e.dead).map((e) => e.enemyId));
    const enemiesFiringThisRound = new Set(log.enemyAttacks.map((ea) => ea.enemyId));
    const killedVisualIds = new Set<string>();

    const getPlayerPoints = () => {
      const sprite = this.playerSprite;
      const pHp = getShipHardpoints(`ship.player.${pb.shipId}`);
      const pMuzzle = sprite ? this.getSpritePoint(sprite, pHp.muzzle) : { x: this.playerBaseX + 26, y: this.playerBaseY };
      const pHit = sprite ? this.getSpritePoint(sprite, pHp.hit) : { x: this.playerBaseX, y: this.playerBaseY };
      const pShield = sprite ? this.getSpritePoint(sprite, pHp.shieldCenter) : { x: this.playerBaseX + 24, y: this.playerBaseY };
      const heavyMuzzle = this.getModuleMuzzle('heavy') ?? pMuzzle;
      const laserMuzzle = this.getModuleMuzzle('laser') ?? pMuzzle;
      const droneMuzzle = this.getModuleMuzzle('drone_bay') ?? { x: this.playerBaseX + 24, y: this.playerBaseY + 18 };
      const counterMuzzle = this.getModuleMuzzle('counter_ring') ?? { x: this.playerBaseX + 24, y: this.playerBaseY - 12 };
      return { pMuzzle, pHit, pShield, heavyMuzzle, laserMuzzle, droneMuzzle, counterMuzzle };
    };

    const runChargeBeat = () => {
      const { heavyMuzzle, droneMuzzle } = getPlayerPoints();
      this.prevDronesCount = this.activeDronesCount;
      this.activeDronesCount = Object.values(log.droneCountsByHangar).reduce((a, b) => a + b, 0);
      if (this.activeDronesCount > this.prevDronesCount) {
        this.hangarDoorLife = 0.44;
        this.rings.push({ x: droneMuzzle.x, y: droneMuzzle.y, maxR: 20, color: 0x7be8ff, life: 0.28, maxLife: 0.28 });
      }
      this.heavyChargingCount = log.heavyChargingIds.length;
      if (this.heavyChargingCount > 0) {
        soundEngine.play('chargeUp');
        this.spawnPopup(heavyMuzzle.x - 10, heavyMuzzle.y - 20, '重炮蓄能', '#F6B852', 'status');
      }

      if (log.appliedTacticThisRound && log.appliedTacticThisRound !== 'normal') {
        const cmd = log.appliedTacticThisRound;
        const cmdLabel = getTacticalCommandLabel(cmd, pb.shipId);
        if (cmd === 'emergency_shield' || cmd === 'emergency_defense') {
          this.shieldArcLife = 0.58;
          soundEngine.play('shieldOverload');
          this.rings.push({ x: this.playerBaseX + 18, y: this.playerBaseY, maxR: 48, color: 0x62d6df, life: 0.42, maxLife: 0.42 });
          this.spawnPopup(this.playerBaseX + 14, this.playerBaseY - 36, `${cmdLabel}！`, '#62D6DF', 'shield');
        } else if (cmd === 'focus_calibrate') {
          soundEngine.play('tacticalOrder');
          this.spawnPopup(this.playerBaseX + 14, this.playerBaseY - 36, '聚焦校准！', '#7AE582', 'status');
        } else if (cmd === 'signature_heavy_freighter') {
          this.shieldArcLife = 0.52;
          soundEngine.play('repairPulse');
          this.rings.push({ x: this.playerBaseX, y: this.playerBaseY, maxR: 46, color: 0x7ae582, life: 0.44, maxLife: 0.44 });
          this.spawnPopup(this.playerBaseX + 12, this.playerBaseY - 36, `${cmdLabel} +5HP/+4盾`, '#7AE582', 'heal');
        } else if (cmd === 'signature_shield_cruiser') {
          this.shieldArcLife = 0.56;
          soundEngine.play('shieldOverload');
          this.rings.push({ x: this.playerBaseX + 16, y: this.playerBaseY, maxR: 54, color: 0x62d6df, life: 0.46, maxLife: 0.46 });
          this.spawnPopup(this.playerBaseX + 14, this.playerBaseY - 36, `${cmdLabel}！`, '#62D6DF', 'shield');
        } else if (cmd === 'signature_cannon_skiff' || cmd === 'signature_stargate_cruiser') {
          soundEngine.play('tacticalOrder');
          this.spawnPopup(this.playerBaseX + 14, this.playerBaseY - 36, `${cmdLabel}！`, '#F6B852', 'status');
        }
      }

      if (log.enemyIntentsThisRound) {
        let playedRegenSfx = false;
        for (const item of log.enemyIntentsThisRound) {
          const src = this.enemies.find((e) => e.enemyId === item.enemyId);
          const afterSnap = log.enemiesAfter.find((e) => e.enemyId === item.enemyId);
          if (!src || src.dead || !afterSnap || afterSnap.hp <= 0) continue;
          if (item.intent.shieldGain && item.intent.shieldGain > 0) {
            if (!playedRegenSfx) {
              soundEngine.play('shieldOverload');
              playedRegenSfx = true;
            }
            src.shieldArcLife = Math.max(src.shieldArcLife, 0.36);
            this.rings.push({ x: src.baseX, y: src.baseY, maxR: 34, color: 0x62d6df, life: 0.36, maxLife: 0.36 });
            this.spawnPopup(src.baseX, src.baseY - 34, `敌盾 +${item.intent.shieldGain}`, '#62D6DF', 'shield');
          } else if (item.intent.kind === 'charge') {
            this.rings.push({ x: src.baseX, y: src.baseY, maxR: 30, color: 0xf6b852, life: 0.38, maxLife: 0.38 });
            this.spawnPopup(src.baseX, src.baseY - 34, item.intent.shortLabel, '#F6B852', 'status');
          }
        }
      }
    };

    const runPlayerFireBeat = () => {
      const { pMuzzle, heavyMuzzle, laserMuzzle, droneMuzzle, counterMuzzle } = getPlayerPoints();
      let playedLaser = false;
      let playedHeavy = false;
      let playedDrone = false;
      let playedFlak = false;
      let shownSynergyTag = false;

      for (const atk of log.playerAttacks) {
        const target = this.enemies.find((e) => e.enemyId === atk.targetEnemyId);
        if (!target) continue;
        const eKey = `ship.enemy.${target.spec.spriteArchetype}`;
        const ePt = this.getSpritePoint(target.sprite, getShipHardpoints(eKey).hit);

        if (atk.sourceKind === 'heavy') {
          if (!playedHeavy) {
            soundEngine.play('heavyBlast');
            playedHeavy = true;
            if (vSpec?.heavyBoosted && !shownSynergyTag) {
              this.synergyPulseLife = 0.42;
              this.synergyTargetKind = 'heavy';
              this.spawnPopup(heavyMuzzle.x - 8, heavyMuzzle.y - 26, '联动·先手', '#F6B852', 'status');
              shownSynergyTag = true;
            }
          }
          this.playerRecoilX = -10;
          const hm = this.moduleSprites.find((m) => m.kind === 'heavy');
          if (hm) hm.recoilX = -12;
          this.spawnMuzzleFlash(heavyMuzzle.x, heavyMuzzle.y, 1, 0xf6b852, 16);
          this.spawnTracer(heavyMuzzle.x, heavyMuzzle.y, ePt.x, ePt.y, 0xffe4a3, 4.4, 0.12);
          this.beams.push({
            x1: heavyMuzzle.x,
            y1: heavyMuzzle.y,
            x2: ePt.x,
            y2: ePt.y,
            color: 0xf6b852,
            thickness: 6.5,
            life: 0.38,
            maxLife: 0.38,
          });
          this.rings.push({ x: heavyMuzzle.x, y: heavyMuzzle.y, maxR: 18, color: 0xffe4a3, life: 0.2, maxLife: 0.2 });
        } else if (atk.sourceKind === 'hangar') {
          if (!playedDrone) {
            soundEngine.play('droneLaunch');
            playedDrone = true;
            if (vSpec?.hangarBoosted && !shownSynergyTag) {
              this.synergyPulseLife = 0.42;
              this.synergyTargetKind = 'drone_bay';
              this.spawnPopup(droneMuzzle.x, droneMuzzle.y + 20, '联动·编队', '#62D6DF', 'status');
              shownSynergyTag = true;
            }
          }
          const laneOffset = ((this.beams.length % 4) - 1.5) * 14;
          const srcX = droneMuzzle.x + 26;
          const srcY = this.playerBaseY + laneOffset;
          this.spawnMuzzleFlash(srcX, srcY, 1, 0x7be8ff, 9);
          this.beams.push({
            x1: srcX,
            y1: srcY,
            x2: ePt.x,
            y2: ePt.y,
            color: 0x7be8ff,
            thickness: 2.2,
            life: 0.25,
            maxLife: 0.25,
          });
        } else if (atk.sourceKind === 'salvo') {
          if (!playedDrone) {
            soundEngine.play('droneLaunch');
            playedDrone = true;
          }
          const laneOffset = ((this.beams.length % 5) - 2) * 10;
          this.spawnMuzzleFlash(heavyMuzzle.x, heavyMuzzle.y + laneOffset, 1, 0xf97316, 12);
          this.spawnTracer(heavyMuzzle.x, heavyMuzzle.y + laneOffset, ePt.x, ePt.y, 0xfb923c, 3.2, 0.13);
          this.beams.push({
            x1: heavyMuzzle.x,
            y1: heavyMuzzle.y + laneOffset,
            x2: ePt.x,
            y2: ePt.y,
            color: 0xf97316,
            thickness: 3.0,
            life: 0.28,
            maxLife: 0.28,
          });
        } else if (atk.sourceKind === 'emp') {
          if (!playedLaser) {
            soundEngine.play('laserFire');
            playedLaser = true;
          }
          this.spawnMuzzleFlash(counterMuzzle.x, counterMuzzle.y, 1, 0xa78bfa, 12);
          this.beams.push({
            x1: counterMuzzle.x,
            y1: counterMuzzle.y,
            x2: ePt.x,
            y2: ePt.y,
            color: 0xa78bfa,
            thickness: 3.8,
            jagged: true,
            life: 0.3,
            maxLife: 0.3,
          });
        } else if (atk.sourceKind === 'grapple') {
          this.spawnMuzzleFlash(pMuzzle.x, pMuzzle.y + 6, 1, 0x34d399, 10);
          this.beams.push({
            x1: pMuzzle.x,
            y1: pMuzzle.y + 6,
            x2: ePt.x,
            y2: ePt.y,
            color: 0x34d399,
            thickness: 2.8,
            life: 0.26,
            maxLife: 0.26,
          });
        } else if (atk.sourceInstanceId === 'gadget_overcharge_cell') {
          soundEngine.play('heavyBlast');
          this.spawnMuzzleFlash(pMuzzle.x, pMuzzle.y, 1, 0xfacc15, 16);
          this.spawnTracer(pMuzzle.x, pMuzzle.y, ePt.x, ePt.y, 0xfacc15, 4.2, 0.12);
          this.beams.push({
            x1: pMuzzle.x,
            y1: pMuzzle.y,
            x2: ePt.x,
            y2: ePt.y,
            color: 0xfacc15,
            thickness: 5.5,
            life: 0.36,
            maxLife: 0.36,
          });
          this.spawnPopup(this.playerBaseX + 14, this.playerBaseY - 38, '过载电池爆发！', '#FACC15', 'status');
        } else if (atk.sourceKind === 'flak') {
          if (!playedFlak) {
            soundEngine.play('laserFire');
            playedFlak = true;
          }
          this.spawnMuzzleFlash(laserMuzzle.x, laserMuzzle.y - 4, 1, 0xffd27d, 10);
          this.spawnTracer(laserMuzzle.x, laserMuzzle.y - 4, ePt.x, ePt.y, 0xffd27d, 2.8, 0.1);
          this.beams.push({
            x1: laserMuzzle.x,
            y1: laserMuzzle.y - 4,
            x2: ePt.x,
            y2: ePt.y,
            color: 0xffd27d,
            thickness: 2.4,
            life: 0.22,
            maxLife: 0.22,
          });
        } else if (atk.sourceInstanceId === 'tactic_overload') {
          soundEngine.play('heavyBlast');
          this.playerRecoilX = -8;
          this.spawnMuzzleFlash(pMuzzle.x, pMuzzle.y, 1, 0xff9f43, 15);
          this.spawnTracer(pMuzzle.x, pMuzzle.y, ePt.x, ePt.y, 0xff9f43, 4.0, 0.12);
          this.beams.push({
            x1: pMuzzle.x,
            y1: pMuzzle.y,
            x2: ePt.x,
            y2: ePt.y,
            color: 0xff9f43,
            thickness: 5,
            life: 0.34,
            maxLife: 0.34,
          });
          this.spawnPopup(this.playerBaseX + 12, this.playerBaseY - 36, '火力过载！', '#FF9F43', 'status');
        } else if (atk.sourceInstanceId === 'tactic_focus_calibrate') {
          this.spawnMuzzleFlash(pMuzzle.x, pMuzzle.y, 1, 0x7ae582, 13);
          this.beams.push({
            x1: pMuzzle.x,
            y1: pMuzzle.y,
            x2: ePt.x,
            y2: ePt.y,
            color: 0x7ae582,
            thickness: 4,
            life: 0.32,
            maxLife: 0.32,
          });
        } else if (atk.sourceInstanceId.startsWith('tactic_sig_')) {
          const isWave = atk.sourceInstanceId.includes('shield_cruiser') || atk.sourceInstanceId.includes('stargate');
          const sigColor = atk.sourceInstanceId.includes('shield_cruiser')
            ? 0x62d6df
            : atk.sourceInstanceId.includes('stargate')
            ? 0xc9a0ff
            : 0xf6b852;
          this.spawnMuzzleFlash(pMuzzle.x, pMuzzle.y, 1, sigColor, 14);
          this.spawnTracer(pMuzzle.x, pMuzzle.y, ePt.x, ePt.y, sigColor, 3.6, 0.12);
          this.beams.push({
            x1: pMuzzle.x,
            y1: pMuzzle.y,
            x2: ePt.x,
            y2: ePt.y,
            color: sigColor,
            thickness: isWave ? 4.4 : 3.8,
            jagged: isWave,
            life: 0.34,
            maxLife: 0.34,
          });
        } else {
          if (!playedLaser) {
            soundEngine.play('laserFire');
            playedLaser = true;
            if (atk.sourceKind === 'laser' && vSpec?.laserBoosted && !shownSynergyTag) {
              this.synergyPulseLife = 0.42;
              this.synergyTargetKind = 'laser';
              this.spawnPopup(laserMuzzle.x - 6, laserMuzzle.y - 22, '联动·充能', '#62D6DF', 'status');
              shownSynergyTag = true;
            }
          }
          this.playerRecoilX = Math.min(this.playerRecoilX, -4);
          const lm = this.moduleSprites.find((m) => m.kind === 'laser');
          if (lm && atk.sourceKind === 'laser') lm.recoilX = -6;
          const srcPt = atk.sourceKind === 'laser' ? laserMuzzle : pMuzzle;
          this.spawnMuzzleFlash(srcPt.x, srcPt.y, 1, 0x62d6df, 11);
          this.beams.push({
            x1: srcPt.x,
            y1: srcPt.y,
            x2: ePt.x,
            y2: ePt.y,
            color: 0x62d6df,
            thickness: 3,
            life: 0.26,
            maxLife: 0.26,
          });
        }
      }
    };

    const runPlayerImpactBeat = () => {
      const lowQuality = this.playback?.settings.lowQuality ?? false;
      interface EnemyTierBucket {
        normalDmg: number;
        armorDmg: number;
        armorBlocked: number;
        pierceDmg: number;
        shieldDmg: number;
      }
      const bucketsByEnemy = new Map<string, EnemyTierBucket>();
      let hasHeavyHit = false;
      let hasLethalKill = false;
      let isBossKill = false;

      for (const atk of log.playerAttacks) {
        const target = this.enemies.find((e) => e.enemyId === atk.targetEnemyId);
        if (!target) continue;

        let bucket = bucketsByEnemy.get(target.enemyId);
        if (!bucket) {
          bucket = { normalDmg: 0, armorDmg: 0, armorBlocked: 0, pierceDmg: 0, shieldDmg: 0 };
          bucketsByEnemy.set(target.enemyId, bucket);
        }

        const eKey = `ship.enemy.${target.spec.spriteArchetype}`;
        const eHp = getShipHardpoints(eKey);
        const ePt = this.getSpritePoint(target.sprite, eHp.hit);
        const shieldDamaged = atk.shieldDamaged ?? 0;
        const hullDmg = Math.max(0, atk.appliedDamage - shieldDamaged);
        const isPierce =
          atk.sourceInstanceId === 'tactic_overload' ||
          atk.sourceInstanceId === 'tactic_focus_calibrate' ||
          atk.sourceInstanceId.startsWith('tactic_sig_') ||
          atk.sourceInstanceId === 'gadget_overcharge_cell' ||
          (atk.sourceKind === 'heavy' && atk.armorBlocked === 0 && target.spec.armor > 0);
        const isHeavy =
          atk.sourceKind === 'heavy' ||
          atk.sourceInstanceId === 'gadget_overcharge_cell' ||
          atk.sourceInstanceId === 'tactic_overload';
        if (isHeavy) hasHeavyHit = true;

        if (shieldDamaged > 0) bucket.shieldDmg += shieldDamaged;
        if (hullDmg > 0) {
          if (isPierce) {
            bucket.pierceDmg += hullDmg;
          } else if (atk.armorBlocked > 0) {
            bucket.armorDmg += hullDmg;
            bucket.armorBlocked += atk.armorBlocked;
          } else {
            bucket.normalDmg += hullDmg;
          }
        } else if (atk.armorBlocked > 0) {
          bucket.armorBlocked += atk.armorBlocked;
        }

        const flashDecision = resolveHitFlashDecision({
          shieldAbsorbed: shieldDamaged,
          hullDamage: hullDmg,
          reducedMotion: reduced,
        });

        this.applyEnemyHpUpdate(target, Math.min(target.hp, atk.targetHpAfter), false);
        if (shieldDamaged > 0) {
          target.shield = Math.max(0, target.shield - shieldDamaged);
          target.shieldArcLife = 0.36;
          this.rings.push({ x: ePt.x, y: ePt.y, maxR: 26, color: 0x62d6df, life: 0.28, maxLife: 0.28 });
          this.spawnImpactGlow(ePt.x, ePt.y, 0x62d6df, 'shield', 15);
          this.particlePool.spawnBurst({
            kind: 'shield_shard',
            x: ePt.x - 6,
            y: ePt.y,
            count: 10,
            color: 0x7be8ff,
            lowQuality,
            baseAngleRad: Math.PI,
            spreadRad: Math.PI * 0.9,
          });
        }

        if (flashDecision.applyHullWarmTint) {
          target.flashMs = Math.max(target.flashMs, flashDecision.hullTintDurationMs);
        }

        if (hullDmg > 0) {
          target.recoilX = isHeavy ? 9 : 6;
          const glowColor = isHeavy ? 0xf6b852 : atk.sourceKind === 'emp' ? 0xa78bfa : 0xffe4a3;
          this.spawnImpactGlow(ePt.x, ePt.y, glowColor, isHeavy ? 'heavy' : 'hull', isHeavy ? 18 : 14);
          this.particlePool.spawnBurst({
            kind: 'spark',
            x: ePt.x,
            y: ePt.y,
            count: isHeavy ? 16 : 8,
            color: glowColor,
            lowQuality,
            baseAngleRad: Math.PI,
            spreadRad: Math.PI * 1.15,
          });
          if (isHeavy) {
            this.triggerShake(110, reduced);
            this.rings.push({ x: ePt.x, y: ePt.y, maxR: 36, color: 0xf6b852, life: 0.36, maxLife: 0.36 });
          } else if (atk.sourceKind === 'salvo') {
            this.rings.push({ x: ePt.x, y: ePt.y, maxR: 22, color: 0xfb923c, life: 0.24, maxLife: 0.24 });
          } else if (atk.sourceKind === 'emp') {
            this.rings.push({ x: ePt.x, y: ePt.y, maxR: 32, color: 0xa78bfa, life: 0.34, maxLife: 0.34 });
          } else if (atk.sourceKind === 'grapple') {
            this.rings.push({ x: ePt.x, y: ePt.y, maxR: 18, color: 0x34d399, life: 0.22, maxLife: 0.22 });
          } else if (atk.sourceKind === 'flak') {
            this.rings.push({ x: ePt.x, y: ePt.y, maxR: 20, color: 0xffd27d, life: 0.24, maxLife: 0.24 });
          }
        }

        if (
          atk.targetKilled &&
          !enemiesFiringThisRound.has(target.enemyId) &&
          prevAliveIds.has(target.enemyId) &&
          !killedVisualIds.has(target.enemyId)
        ) {
          killedVisualIds.add(target.enemyId);
          hasLethalKill = true;
          if (target.spec.isBoss) isBossKill = true;
          this.triggerEnemyDeathVisual(target);
        }
      }

      // Emit tiered non-overlapping damage popups per enemy (normal / armor / pierce / shield)
      for (const [eid, bucket] of bucketsByEnemy.entries()) {
        const target = this.enemies.find((e) => e.enemyId === eid);
        if (!target) continue;
        if (bucket.pierceDmg > 0) {
          this.spawnPopup(target.baseX, target.baseY - 26, `穿 -${bucket.pierceDmg}`, undefined, 'pierce');
        }
        if (bucket.normalDmg > 0) {
          this.spawnPopup(target.baseX, target.baseY - 22, `-${bucket.normalDmg}`, undefined, 'normal');
        }
        if (bucket.armorDmg > 0 || (bucket.armorBlocked > 0 && bucket.normalDmg === 0 && bucket.pierceDmg === 0 && bucket.shieldDmg === 0)) {
          const txt =
            bucket.armorDmg > 0
              ? `-${bucket.armorDmg} (甲-${bucket.armorBlocked})`
              : `格挡 (甲-${bucket.armorBlocked})`;
          this.spawnPopup(target.baseX + 8, target.baseY - 14, txt, undefined, 'armor');
        }
        if (bucket.shieldDmg > 0 && bucket.normalDmg === 0 && bucket.pierceDmg === 0 && bucket.armorDmg === 0) {
          this.spawnPopup(target.baseX, target.baseY - 22, `破盾 -${bucket.shieldDmg}`, undefined, 'shield');
        }
      }

      const hasBossPhase = Boolean(log.bossPhaseTransitions && log.bossPhaseTransitions.length > 0);
      if (hasBossPhase && log.bossPhaseTransitions) {
        soundEngine.play('bossPhase');
        this.triggerShake(120, reduced);
        for (const tr of log.bossPhaseTransitions) {
          const bEntry = this.enemies.find((e) => e.enemyId === tr.enemyId);
          if (bEntry) {
            bEntry.phase = tr.toPhase;
            this.rings.push({ x: bEntry.baseX, y: bEntry.baseY, maxR: 76, color: 0xf6b852, life: 0.56, maxLife: 0.56 });
            this.rings.push({ x: bEntry.baseX, y: bEntry.baseY, maxR: 54, color: 0xff5c7a, life: 0.48, maxLife: 0.48 });
            this.particlePool.spawnBurst({
              kind: 'spark',
              x: bEntry.baseX,
              y: bEntry.baseY,
              count: 20,
              color: 0xf6b852,
              lowQuality,
            });
            this.spawnPopup(bEntry.baseX, bEntry.baseY - 40, `阶段 P${tr.toPhase}！`, '#FFD791', 'status');
          }
        }
      }

      const hitstopMs = computeHitstopDurationMs({
        hasHeavyHit,
        hasLethalKill,
        hasBossPhase,
        isBossKill,
        reducedMotion: reduced,
      });
      this.triggerHitstop(hitstopMs);
    };

    const runEnemyFireBeat = () => {
      const { pHit } = getPlayerPoints();
      if (log.enemyAttacks.length > 0) {
        this.enemyChargeMs = 240;
        soundEngine.play('enemyFire');
      }
      for (const ea of log.enemyAttacks) {
        const src = this.enemies.find((e) => e.enemyId === ea.enemyId);
        if (src) {
          const eKey = `ship.enemy.${src.spec.spriteArchetype}`;
          const eMuz = this.getSpritePoint(src.sprite, getShipHardpoints(eKey).muzzle);
          src.recoilX = ea.intentKind === 'ram' ? -16 : 5;
          const isHeavyBeam = ea.intentKind === 'pierce_beam' || ea.intentKind === 'heavy_volley';
          const isEmp = ea.intentKind === 'emp' || (ea.empShieldDrained ?? 0) > 0;
          const beamColor = isEmp
            ? 0xc9a0ff
            : isHeavyBeam
            ? 0xff4d6d
            : ea.pierceDamage > 0
            ? 0xff7096
            : 0xf27564;
          this.spawnMuzzleFlash(eMuz.x, eMuz.y, -1, beamColor, isHeavyBeam ? 15 : 10);
          if (isHeavyBeam || ea.intentKind === 'ram') {
            this.spawnTracer(eMuz.x, eMuz.y, pHit.x, pHit.y, beamColor, isHeavyBeam ? 4.0 : 3.2, 0.12);
          }
          this.beams.push({
            x1: eMuz.x,
            y1: eMuz.y,
            x2: pHit.x,
            y2: pHit.y,
            color: beamColor,
            thickness: isHeavyBeam ? 5.8 : isEmp ? 3.8 : ea.pierceDamage > 0 ? 3.5 : 2.5,
            jagged: isEmp,
            life: isHeavyBeam ? 0.38 : 0.28,
            maxLife: isHeavyBeam ? 0.38 : 0.28,
          });
        }
      }
    };

    const runEnemyImpactBeat = () => {
      const lowQuality = this.playback?.settings.lowQuality ?? false;
      const { pHit, pShield, counterMuzzle } = getPlayerPoints();
      let totalHullDmg = 0;
      let totalPierce = 0;
      let totalEmpDrained = 0;
      let hasHeavyEnemyHit = false;
      for (const ea of log.enemyAttacks) {
        totalHullDmg += ea.hullDamage;
        totalPierce += ea.pierceDamage;
        totalEmpDrained += ea.empShieldDrained ?? 0;
        if (ea.intentKind === 'pierce_beam' || ea.intentKind === 'heavy_volley') {
          hasHeavyEnemyHit = true;
        }
      }

      if (hasHeavyEnemyHit) {
        this.rings.push({ x: pHit.x, y: pHit.y, maxR: 40, color: 0xff4d6d, life: 0.36, maxLife: 0.36 });
        this.triggerShake(120, reduced);
      }

      if (totalEmpDrained > 0) {
        soundEngine.play('empDisrupt');
        this.rings.push({ x: this.playerBaseX + 18, y: this.playerBaseY, maxR: 42, color: 0xc9a0ff, life: 0.38, maxLife: 0.38 });
        this.spawnImpactGlow(pShield.x, pShield.y, 0xc9a0ff, 'emp', 16);
        this.particlePool.spawnBurst({
          kind: 'shield_shard',
          x: pShield.x + 8,
          y: pShield.y,
          count: 10,
          color: 0xd6b8ff,
          lowQuality,
          baseAngleRad: 0,
          spreadRad: Math.PI * 0.9,
        });
        this.spawnPopup(this.playerBaseX + 18, this.playerBaseY + 20, `EMP -${totalEmpDrained}盾`, '#D6B8FF', 'status');
      }

      const playerFlashDecision = resolveHitFlashDecision({
        shieldAbsorbed: log.shieldAbsorbedTotal,
        hullDamage: totalHullDmg,
        reducedMotion: reduced,
      });

      if (log.shieldAbsorbedTotal > 0) {
        this.shieldArcLife = 0.36;
        soundEngine.play('shieldHit');
        this.spawnImpactGlow(pShield.x + 12, pShield.y, 0x62d6df, 'shield', 16);
        this.particlePool.spawnBurst({
          kind: 'shield_shard',
          x: pShield.x + 14,
          y: pShield.y,
          count: 12,
          color: 0x7be8ff,
          lowQuality,
          baseAngleRad: 0,
          spreadRad: Math.PI * 0.85,
        });
        this.spawnPopup(this.playerBaseX + 26, this.playerBaseY - 24, `盾吸 ${log.shieldAbsorbedTotal}`, undefined, 'shield');
      }

      if (totalHullDmg > 0) {
        if (playerFlashDecision.applyHullWarmTint) {
          this.playerFlashMs = playerFlashDecision.hullTintDurationMs;
        }
        this.spawnImpactGlow(
          pHit.x,
          pHit.y,
          hasHeavyEnemyHit ? 0xff4d6d : 0xf6b852,
          hasHeavyEnemyHit ? 'heavy' : 'hull',
          hasHeavyEnemyHit ? 18 : 15
        );
        this.particlePool.spawnBurst({
          kind: 'spark',
          x: pHit.x,
          y: pHit.y,
          count: hasHeavyEnemyHit ? 16 : 10,
          color: hasHeavyEnemyHit ? 0xff4d6d : 0xf27564,
          lowQuality,
          baseAngleRad: 0,
          spreadRad: Math.PI * 1.1,
        });
        this.triggerShake(85, reduced);
        soundEngine.play('hullHit');
        this.spawnPopup(
          this.playerBaseX - 8,
          this.playerBaseY - 12,
          totalPierce > 0 ? `穿盾 -${totalHullDmg}` : `-${totalHullDmg}`,
          totalPierce > 0 ? undefined : '#F27564',
          totalPierce > 0 ? 'pierce' : 'normal'
        );
        if (hasHeavyEnemyHit || log.playerHpAfter <= 0) {
          this.triggerHitstop(
            computeHitstopDurationMs({
              hasHeavyHit: hasHeavyEnemyHit,
              hasLethalKill: log.playerHpAfter <= 0,
              hasBossPhase: false,
              isBossKill: false,
              reducedMotion: reduced,
            })
          );
        }
      }

      this.applyPlayerHpUpdate(log.playerHpAfter, log.playerShieldAfter, false);

      if (log.counterAttack) {
        const cTarget = this.enemies.find((e) => e.enemyId === log.counterAttack!.targetEnemyId);
        if (cTarget) {
          soundEngine.play('counterZap');
          this.counterBackflowLife = 0.34;
          const eKey = `ship.enemy.${cTarget.spec.spriteArchetype}`;
          const ePt = this.getSpritePoint(cTarget.sprite, getShipHardpoints(eKey).hit);
          const cShield = log.counterAttack.shieldDamaged ?? 0;
          const cHull = Math.max(0, log.counterAttack.appliedDamage - cShield);
          const cDecision = resolveHitFlashDecision({
            shieldAbsorbed: cShield,
            hullDamage: cHull,
            reducedMotion: reduced,
          });
          this.applyEnemyHpUpdate(cTarget, Math.min(cTarget.hp, log.counterAttack.targetHpAfter), false);
          if (cShield > 0) {
            cTarget.shield = Math.max(0, cTarget.shield - cShield);
            cTarget.shieldArcLife = 0.34;
          }
          if (cDecision.applyHullWarmTint) {
            cTarget.flashMs = Math.max(cTarget.flashMs, cDecision.hullTintDurationMs);
          }
          this.spawnMuzzleFlash(counterMuzzle.x, counterMuzzle.y, 1, 0x62d6df, 12);
          this.spawnImpactGlow(ePt.x, ePt.y, 0x62d6df, cHull > 0 ? 'hull' : 'shield', 15);
          this.particlePool.spawnBurst({
            kind: 'spark',
            x: ePt.x,
            y: ePt.y,
            count: 10,
            color: 0x62d6df,
            lowQuality,
            baseAngleRad: Math.PI,
            spreadRad: Math.PI,
          });
          this.beams.push({
            x1: counterMuzzle.x,
            y1: counterMuzzle.y,
            x2: ePt.x,
            y2: ePt.y,
            color: 0x62d6df,
            thickness: 4.2,
            jagged: true,
            life: 0.38,
            maxLife: 0.38,
          });
          this.rings.push({ x: counterMuzzle.x, y: counterMuzzle.y, maxR: 22, color: 0x62d6df, life: 0.26, maxLife: 0.26 });
          this.rings.push({ x: ePt.x, y: ePt.y, maxR: 28, color: 0x62d6df, life: 0.32, maxLife: 0.32 });
          this.spawnPopup(
            cTarget.baseX,
            cTarget.baseY - 38,
            `反击 -${log.counterAttack.appliedDamage}`,
            undefined,
            'counter'
          );
        }
      }
    };

    const runResolveBeat = () => {
      if (this.inFlightRound === roundState) {
        this.inFlightRound = null;
      }
      if (!roundState.visualsCommitted) {
        roundState.visualsCommitted = true;
        this.applyPlayerHpUpdate(log.playerHpAfter, log.playerShieldAfter, false);
        let killedAnyResolve = false;
        let killedBossResolve = false;
        for (const snap of log.enemiesAfter) {
          if (snap.hp <= 0 && prevAliveIds.has(snap.enemyId) && !killedVisualIds.has(snap.enemyId)) {
            const entry = this.enemies.find((e) => e.enemyId === snap.enemyId);
            if (entry) {
              killedVisualIds.add(snap.enemyId);
              killedAnyResolve = true;
              if (entry.spec.isBoss) killedBossResolve = true;
              this.triggerEnemyDeathVisual(entry);
            }
          }
        }
        this.syncEnemyRosterFromSnapshots(log.enemiesAfter, true);
        if (killedAnyResolve) {
          this.triggerHitstop(
            computeHitstopDurationMs({
              hasHeavyHit: false,
              hasLethalKill: true,
              hasBossPhase: false,
              isBossKill: killedBossResolve,
              reducedMotion: reduced,
            })
          );
        }
      }
      if (!roundState.stepReported) {
        roundState.stepReported = true;
        pb.onRoundStep?.(roundIdx, log);
      }
    };

    const schedule = buildRoundBeatSchedule(log, speed, reduced);
    for (const beat of schedule) {
      const handler =
        beat.kind === 'charge'
          ? runChargeBeat
          : beat.kind === 'player_fire'
          ? runPlayerFireBeat
          : beat.kind === 'player_impact'
          ? runPlayerImpactBeat
          : beat.kind === 'enemy_fire'
          ? runEnemyFireBeat
          : beat.kind === 'enemy_impact'
          ? runEnemyImpactBeat
          : runResolveBeat;
      this.scheduleRoundTimer(beat.delayMs, epoch, handler);
    }
  }

  private triggerEnemyDeathVisual(entry: EnemyVisualEntry): void {
    const reduced = this.playback?.settings.reducedMotion ?? false;
    const lowQuality = this.playback?.settings.lowQuality ?? false;
    entry.dead = true;
    entry.isCharging = false;
    entry.intentTag?.setVisible(false);
    soundEngine.play('enemyDestroy');

    if (reduced) {
      // Instant clean defeat presentation in reducedMotion (no split-hull drift or flashing)
      entry.sprite.setVisible(true).setAlpha(0.18).setTint(0x4b5563);
      this.rings.push({
        x: entry.baseX,
        y: entry.baseY,
        maxR: entry.spec.isBoss ? 56 : 32,
        color: 0xf6b852,
        life: 0.36,
        maxLife: 0.36,
      });
      this.spawnImpactGlow(entry.baseX, entry.baseY, 0xf6b852, 'heavy', 16);
      return;
    }

    // A04 + A06-code: Multi-stage death breakup with cropped split-hull drift (or future A06 dedicated plates)
    const eKey = `ship.enemy.${entry.spec.spriteArchetype}`;
    const resolvedKey = this.textures.exists(eKey) ? eKey : 'ship.enemy.scout';
    const sliceSpec = getShipSplitSlice(eKey);
    const hasDedicatedPlates = Boolean(
      sliceSpec.foreHalfKey &&
        sliceSpec.aftHalfKey &&
        this.textures.exists(sliceSpec.foreHalfKey) &&
        this.textures.exists(sliceSpec.aftHalfKey)
    );
    const foreTexKey = hasDedicatedPlates ? sliceSpec.foreHalfKey! : resolvedKey;
    const aftTexKey = hasDedicatedPlates ? sliceSpec.aftHalfKey! : resolvedKey;

    const texW = entry.sprite.width || SHIP_TEX_W;
    const texH = entry.sprite.height || SHIP_TEX_H;
    const scaleX = entry.sprite.displayWidth / Math.max(1, texW);
    const scaleY = entry.sprite.displayHeight / Math.max(1, texH);

    const choreoSpec = computeSplitHullHalvesSpec({
      texWidth: texW,
      texHeight: texH,
      splitRatioX: sliceSpec.splitRatioX,
      baseX: entry.sprite.x || entry.baseX,
      baseY: entry.sprite.y || entry.baseY,
      displayWidth: entry.sprite.displayWidth,
      displayHeight: entry.sprite.displayHeight,
      isBoss: Boolean(entry.spec.isBoss),
      hasDedicatedPlates,
    });

    entry.brokenApart = true;
    entry.sprite.setVisible(false);

    const foreSprite = this.add
      .image(choreoSpec.fore.startX, choreoSpec.fore.startY, foreTexKey)
      .setOrigin(0.5, 0.5)
      .setScale(scaleX, scaleY)
      .setDepth(entry.spec.isBoss ? 4 : 3)
      .setTint(0xb6c0cf);
    const aftSprite = this.add
      .image(choreoSpec.aft.startX, choreoSpec.aft.startY, aftTexKey)
      .setOrigin(0.5, 0.5)
      .setScale(scaleX, scaleY)
      .setDepth(entry.spec.isBoss ? 4 : 3)
      .setTint(0x94a3b8);

    if (choreoSpec.fore.useCrop) {
      foreSprite.setCrop(
        choreoSpec.fore.cropX,
        choreoSpec.fore.cropY,
        choreoSpec.fore.cropW,
        choreoSpec.fore.cropH
      );
    }
    if (choreoSpec.aft.useCrop) {
      aftSprite.setCrop(
        choreoSpec.aft.cropX,
        choreoSpec.aft.cropY,
        choreoSpec.aft.cropW,
        choreoSpec.aft.cropH
      );
    }

    this.deathChoreos.push({
      enemyId: entry.enemyId,
      baseX: entry.baseX,
      baseY: entry.baseY,
      isBoss: Boolean(entry.spec.isBoss),
      foreSprite,
      aftSprite,
      foreX: choreoSpec.fore.startX,
      foreY: choreoSpec.fore.startY,
      foreVx: choreoSpec.fore.vx,
      foreVy: choreoSpec.fore.vy,
      foreAngle: entry.angleDeg,
      foreVAngle: choreoSpec.fore.vAngleDeg,
      aftX: choreoSpec.aft.startX,
      aftY: choreoSpec.aft.startY,
      aftVx: choreoSpec.aft.vx,
      aftVy: choreoSpec.aft.vy,
      aftAngle: entry.angleDeg,
      aftVAngle: choreoSpec.aft.vAngleDeg,
      explosions: choreoSpec.explosions,
      nextExplosionIdx: 0,
      elapsed: 0,
      duration: choreoSpec.durationSec,
    });

    // Immediate opening blast + debris scatter
    this.particlePool.spawnBurst({
      kind: 'debris',
      x: entry.baseX,
      y: entry.baseY,
      count: entry.spec.isBoss ? 18 : 12,
      color: 0x64748b,
      lowQuality,
    });
    this.particlePool.spawnBurst({
      kind: 'spark',
      x: entry.baseX,
      y: entry.baseY,
      count: entry.spec.isBoss ? 22 : 14,
      color: 0xf6b852,
      lowQuality,
    });
  }

  update(_time: number, delta: number): void {
    const isHidden = typeof document !== 'undefined' && document.hidden;
    const safeDelta = Number.isFinite(delta) ? Math.max(0, delta) : 0;
    const rawLoopDelta = this.game?.loop?.rawDelta;
    const safeRawDelta =
      typeof rawLoopDelta === 'number' && Number.isFinite(rawLoopDelta) ? Math.max(0, rawLoopDelta) : safeDelta;
    const elapsedMs = isHidden ? 0 : Math.max(safeDelta, safeRawDelta);
    // Use bounded wall-clock elapsed time (`game.loop.rawDelta`) so combat round pacing
    // (~950ms/round at 1x) stays faithful to real time even during Phaser's 120-frame startup/focus
    // cooldown or <5 FPS software rendering, while pausing on hidden tabs and stepping at most
    // one round per frame (never skipping tactical pause boundaries).
    const stepDeltaMs = Math.min(500, elapsedMs);
    const fxDeltaMs = Math.min(120, elapsedMs);
    const dt = fxDeltaMs / 1000;
    const pb = this.playback;
    const reduced = pb?.settings.reducedMotion ?? false;
    const lowQuality = pb?.settings.lowQuality ?? false;
    const speed = sanitizeCombatSpeed(pb?.settings.combatSpeed ?? 1);

    if (!this.externalPaused) {
      this.elapsed += dt;
    }

    // A03 Hitstop: bounded by fxDeltaMs so low-FPS rendering never stalls, skipped in reducedMotion
    let isHitstopped = false;
    if (this.hitstopRemainingMs > 0) {
      if (reduced || this.externalPaused) {
        this.hitstopRemainingMs = 0;
      } else {
        this.hitstopRemainingMs = Math.max(0, this.hitstopRemainingMs - fxDeltaMs);
        isHitstopped = true;
      }
    }
    const worldDt = isHitstopped ? 0 : dt;
    const worldDtMs = isHitstopped ? 0 : fxDeltaMs;

    // Step combat playback with multi-charge tactical pause support
    if (pb?.simulation && !this.externalPaused && !this.decisionPaused) {
      const intervalMs = 950 / speed;
      if (this.playbackActive) {
        this.roundTimerMs -= stepDeltaMs;
        if (this.roundTimerMs <= 0) {
          this.flushInFlightRound(true);
          const pauseAt = pb.pauseAtRound ?? null;
          if (pauseAt !== null && this.nextRoundIdx + 1 === pauseAt) {
            this.playbackActive = false;
            this.decisionPaused = true;
            if (this.time) this.time.paused = true;
            pb.onPauseForDecision?.();
          } else if (this.nextRoundIdx < pb.simulation.rounds.length) {
            this.executeRoundVisual(this.nextRoundIdx, pb.simulation.rounds[this.nextRoundIdx]);
            this.nextRoundIdx += 1;
            this.roundTimerMs = intervalMs;
          } else {
            this.playbackActive = false;
            this.waitingCompletion = true;
            this.completionDelayMs = 420 / speed;
            if (pb.simulation.outcome === 'victory' && pb.simulation.repairApplied > 0) {
              soundEngine.play('repairPulse');
              this.spawnPopup(
                this.playerBaseX,
                this.playerBaseY - 28,
                `维修 +${pb.simulation.repairApplied}`,
                undefined,
                'heal'
              );
            }
          }
        }
      } else if (this.waitingCompletion) {
        this.completionDelayMs -= stepDeltaMs;
        if (this.completionDelayMs <= 0) {
          this.flushInFlightRound(true);
          this.waitingCompletion = false;
          pb.onComplete?.();
        }
      }
    }

    // Camera micro-shake (DPR-safe via centerOn; clamped <= 120ms & <= 3 CSS px per Art Spec §10)
    if (this.shakeTimerMs > 0 && !reduced) {
      this.shakeTimerMs = Math.max(0, this.shakeTimerMs - fxDeltaMs);
      const mag = computeCameraShakeMagnitudePx(this.shakeTimerMs, reduced);
      this.cameras.main.centerOn(
        this.viewW * 0.5 + (Math.random() * 2 - 1) * mag,
        this.viewH * 0.5 + (Math.random() * 2 - 1) * mag
      );
    } else {
      this.cameras.main.centerOn(this.viewW * 0.5, this.viewH * 0.5);
    }

    // Advance player & enemy HP damage-lag trails
    stepHpTrailState(this.playerHpState, worldDtMs, reduced);
    for (const e of this.enemies) {
      if (e.trailHp > e.hp) {
        const trailState: HpTrailState = {
          hp: e.hp,
          maxHp: e.maxHp,
          trailHp: e.trailHp,
          holdMs: e.trailHoldMs,
        };
        stepHpTrailState(trailState, worldDtMs, reduced);
        e.trailHp = trailState.trailHp;
        e.trailHoldMs = trailState.holdMs;
      }
    }

    // Ship subtle motion + idle micro-tilt (A05) + recoil + modular hardpoints sync (A01)
    const bobP = reduced ? 0 : Math.sin(this.elapsed * 2.5) * 3;
    this.playerAngleDeg = computeIdleMicroTiltDeg({
      elapsed: this.elapsed,
      phaseOffset: 0,
      reducedMotion: reduced,
      lowQuality,
      isBoss: false,
    });
    if (!isHitstopped) {
      this.playerRecoilX *= Math.pow(0.05, worldDt);
      for (const m of this.moduleSprites) {
        m.recoilX *= Math.pow(0.04, worldDt);
      }
    }
    if (this.playerSprite && this.playerSprite.scene) {
      this.playerSprite
        .setPosition(this.playerBaseX + this.playerRecoilX, this.playerBaseY + bobP)
        .setAngle(this.playerAngleDeg);
      this.playerFlashMs = reduced ? 0 : Math.max(0, this.playerFlashMs - fxDeltaMs);
      if (this.playerFlashMs > 0) {
        this.playerSprite.setTint(VFX_HIT_MILD_TINT);
        this.playerCurrentTint = VFX_HIT_MILD_TINT;
      } else {
        this.playerCurrentTint = this.playerBaseTint;
        if (this.playerBaseTint !== null) {
          this.playerSprite.setTint(this.playerBaseTint);
        } else {
          this.playerSprite.clearTint();
        }
      }
      this.layoutModules(bobP);
    }

    // Enemy bobbing + idle micro-tilt (A05) + 3-state visual (A01)
    this.smokeAccumMs += worldDtMs;
    const emitSmoke = !reduced && !lowQuality && this.smokeAccumMs >= 160;
    if (emitSmoke) this.smokeAccumMs = 0;
    if (this.enemyChargeMs > 0) this.enemyChargeMs = Math.max(0, this.enemyChargeMs - worldDtMs);

    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.dead) continue;
      if (!isHitstopped) {
        e.recoilX *= Math.pow(0.05, worldDt);
      }
      const bobE = reduced ? 0 : Math.cos(this.elapsed * 2.2 + i) * 3;
      e.angleDeg = computeIdleMicroTiltDeg({
        elapsed: this.elapsed,
        phaseOffset: i * 1.3 + 0.7,
        reducedMotion: reduced,
        lowQuality,
        isBoss: Boolean(e.spec.isBoss),
      });
      e.sprite.setPosition(e.baseX + e.recoilX, e.baseY + bobE).setAngle(e.angleDeg);
      if (e.intentTag && e.intentTag.scene) {
        const yOff = e.sprite.displayHeight * 0.52 + 10;
        e.intentTag.setPosition(e.baseX + e.recoilX, e.baseY + bobE - yOff);
      }
      const isDamaged = e.hp > 0 && e.hp <= e.maxHp * 0.5;
      e.flashMs = reduced ? 0 : Math.max(0, e.flashMs - fxDeltaMs);
      if (e.flashMs > 0) {
        e.sprite.setTint(VFX_HIT_MILD_TINT);
      } else if (isDamaged) {
        const flicker = !reduced && Math.sin(this.elapsed * 18 + i * 3) > 0.72;
        e.sprite.setTint(flicker ? 0x8fa1b8 : 0xb6c0cf);
      } else if (e.baseTint !== null) {
        e.sprite.setTint(e.baseTint);
      } else {
        e.sprite.clearTint();
      }
      if (emitSmoke && isDamaged) {
        this.smokes.push({
          x: e.baseX + (Math.random() - 0.5) * 18,
          y: e.baseY + (Math.random() - 0.5) * 10,
          vx: 8 + Math.random() * 10,
          vy: -14 - Math.random() * 10,
          r: 4 + Math.random() * 4,
          color: Math.random() < 0.25 ? 0xf6b852 : 0x2a3444,
          life: 0.75,
          maxLife: 0.75,
        });
      }
    }

    // A04 + A06-code: Step split-hull death choreography & staggered micro-explosions
    this.deathChoreos = this.deathChoreos.filter((dc) => {
      dc.elapsed += worldDt;
      while (dc.nextExplosionIdx < dc.explosions.length && dc.elapsed >= dc.explosions[dc.nextExplosionIdx].delaySec) {
        const exp = dc.explosions[dc.nextExplosionIdx];
        dc.nextExplosionIdx += 1;
        const ex = dc.baseX + exp.offsetX;
        const ey = dc.baseY + exp.offsetY;
        this.rings.push({ x: ex, y: ey, maxR: exp.radius, color: exp.color, life: 0.34, maxLife: 0.34 });
        this.spawnImpactGlow(ex, ey, exp.color, 'heavy', Math.min(18, exp.radius * 0.4));
        this.particlePool.spawnBurst({
          kind: 'spark',
          x: ex,
          y: ey,
          count: dc.isBoss ? 12 : 8,
          color: exp.color,
          lowQuality,
        });
      }

      if (dc.elapsed >= dc.duration) {
        if (dc.foreSprite?.scene) dc.foreSprite.destroy();
        if (dc.aftSprite?.scene) dc.aftSprite.destroy();
        return false;
      }

      dc.foreX += dc.foreVx * worldDt;
      dc.foreY += dc.foreVy * worldDt;
      dc.foreAngle += dc.foreVAngle * worldDt;
      dc.aftX += dc.aftVx * worldDt;
      dc.aftY += dc.aftVy * worldDt;
      dc.aftAngle += dc.aftVAngle * worldDt;

      const fade = Math.max(0, 1 - dc.elapsed / dc.duration);
      const alpha = Math.min(1, fade * 1.25);
      if (dc.foreSprite?.scene) {
        dc.foreSprite.setPosition(dc.foreX, dc.foreY).setAngle(dc.foreAngle).setAlpha(alpha);
      }
      if (dc.aftSprite?.scene) {
        dc.aftSprite.setPosition(dc.aftX, dc.aftY).setAngle(dc.aftAngle).setAlpha(alpha);
      }
      return true;
    });

    // Starfield
    this.bgGraphics.clear();
    if (!lowQuality && pb?.eventBackdrop !== 'wreck') {
      for (let idx = 0; idx < this.stars.length; idx++) {
        const st = this.stars[idx];
        const sx = (((st.nx - (reduced ? 0 : this.elapsed * st.speed)) % 1) + 1) % 1;
        const starColor =
          pb?.sectorId === 'frozen_graveyard'
            ? 0x9be8ff
            : pb?.sectorId === 'stargate_abyss'
            ? idx % 3 === 0
              ? 0xf6b852
              : 0xc9b3ff
            : 0xe9edf2;
        this.bgGraphics.fillStyle(starColor, st.a);
        this.bgGraphics.fillCircle(sx * this.viewW, st.ny * this.viewH, st.r);
      }
    }

    this.fxGraphics.clear();
    this.addFxGraphics.clear();

    // A05 Engine thruster exhaust plumes (ported from V1 CombatScene + static subtle glow in reducedMotion/lowQuality)
    let plumesDrawn = 0;
    const drawPlume = (geom: ReturnType<typeof computeEnginePlumeGeometry>, engX: number, engY: number) => {
      const [ox1, oy1, ox2, oy2, ox3, oy3] = geom.outerTriangle;
      const [ix1, iy1, ix2, iy2, ix3, iy3] = geom.innerTriangle;
      this.addFxGraphics.fillStyle(geom.outerColor, geom.nozzleGlowAlpha);
      this.addFxGraphics.fillCircle(engX, engY, geom.nozzleGlowRadius);
      this.addFxGraphics.fillStyle(geom.outerColor, geom.outerAlpha);
      this.addFxGraphics.fillTriangle(ox1, oy1, ox2, oy2, ox3, oy3);
      this.addFxGraphics.fillStyle(geom.innerColor, geom.innerAlpha);
      this.addFxGraphics.fillTriangle(ix1, iy1, ix2, iy2, ix3, iy3);
      plumesDrawn += 1;
    };

    if (pb && this.playerSprite && this.playerSprite.scene && this.playerSprite.visible && pb.eventBackdrop !== 'wreck') {
      const pHp = getShipHardpoints(`ship.player.${pb.shipId}`);
      const eng = this.getSpritePoint(this.playerSprite, pHp.engine);
      const plume = computeEnginePlumeGeometry({
        engineX: eng.x,
        engineY: eng.y,
        displayWidth: this.playerSprite.displayWidth,
        displayHeight: this.playerSprite.displayHeight,
        facing: 'right',
        elapsed: this.elapsed,
        phaseOffset: 0,
        recoilBoost: Math.abs(this.playerRecoilX) * 0.03,
        reducedMotion: reduced,
        lowQuality,
      });
      drawPlume(plume, eng.x, eng.y);
    }

    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.dead || !e.sprite?.scene || !e.sprite.visible) continue;
      const eKey = `ship.enemy.${e.spec.spriteArchetype}`;
      const eHp = getShipHardpoints(eKey);
      const eng = this.getSpritePoint(e.sprite, eHp.engine);
      const plume = computeEnginePlumeGeometry({
        engineX: eng.x,
        engineY: eng.y,
        displayWidth: e.sprite.displayWidth,
        displayHeight: e.sprite.displayHeight,
        facing: 'left',
        elapsed: this.elapsed,
        phaseOffset: i * 1.7 + 0.4,
        recoilBoost: Math.abs(e.recoilX) * 0.02,
        reducedMotion: reduced,
        lowQuality,
        isBoss: Boolean(e.spec.isBoss),
        isDanger: e.spec.pierceRatio > 0 || e.spec.armor > 0,
      });
      drawPlume(plume, eng.x, eng.y);

      if (e.spec.spriteArchetype === 'boss_leviathan') {
        const jaw = this.getSpritePoint(e.sprite, eHp.muzzle);
        const jawPulse = reduced || lowQuality ? 0.65 : 0.55 + 0.45 * Math.sin(this.elapsed * 7);
        this.addFxGraphics.fillStyle(0xf27564, 0.25 * jawPulse);
        this.addFxGraphics.fillCircle(jaw.x, jaw.y, Math.max(8, e.sprite.displayHeight * 0.14) * jawPulse);
        this.addFxGraphics.fillStyle(0xffd791, 0.55 * jawPulse);
        this.addFxGraphics.fillCircle(jaw.x, jaw.y, Math.max(4, e.sprite.displayHeight * 0.06) * jawPulse);
      }
    }
    this.plumesRendered = plumesDrawn;

    // Synergy Power Conduit Pulse (Origin: Hull Core -> Process: Illuminated Conduit -> Result: Energized Mount!)
    if (this.synergyPulseLife > 0 && this.synergyTargetKind && this.playerSprite?.visible) {
      this.synergyPulseLife = Math.max(0, this.synergyPulseLife - worldDt);
      const a = Math.min(1, this.synergyPulseLife / 0.42);
      const mod = this.moduleSprites.find((m) => m.kind === this.synergyTargetKind);
      if (mod && mod.sprite.scene) {
        const conduitColor = this.synergyTargetKind === 'heavy' ? 0xf6b852 : 0x62d6df;
        this.fxGraphics.lineStyle(3, conduitColor, a * 0.92);
        this.fxGraphics.lineBetween(this.playerBaseX - 8, this.playerBaseY, mod.sprite.x, mod.sprite.y);
        this.addFxGraphics.fillStyle(conduitColor, a * 0.55);
        this.addFxGraphics.fillCircle(mod.sprite.x, mod.sprite.y, 12 * a + 4);
      }
    }

    // Ventral Drone Bay Hatch Opening Warm Launch Glow
    if (this.hangarDoorLife > 0 && this.playerSprite?.visible) {
      this.hangarDoorLife = Math.max(0, this.hangarDoorLife - worldDt);
      const a = Math.min(1, this.hangarDoorLife / 0.44);
      const dm = this.getModuleMuzzle('drone_bay');
      if (dm) {
        this.fxGraphics.fillStyle(0xf6b852, a * 0.42);
        this.fxGraphics.fillEllipse(dm.x - 4, dm.y + 4, 26, 10);
        this.fxGraphics.lineStyle(2, 0x7be8ff, a * 0.85);
        this.fxGraphics.lineBetween(dm.x - 8, dm.y + 4, dm.x + 22, dm.y + 4);
      }
    }

    // Enemy Charge-Up Pulsing Halos & Pre-Fire Charge Core Telegraph
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (e.isCharging) {
        const eMuz = this.getSpritePoint(e.sprite, getShipHardpoints(`ship.enemy.${e.spec.spriteArchetype}`).muzzle);
        const pulse = reduced ? 0.72 : 0.45 + 0.45 * Math.sin(this.elapsed * 11);
        this.fxGraphics.lineStyle(2.2, 0xf6b852, pulse);
        this.fxGraphics.strokeCircle(eMuz.x, eMuz.y, e.spec.isBoss ? 16 : 11);
        this.addFxGraphics.fillStyle(0xff7096, pulse * 0.36);
        this.addFxGraphics.fillCircle(eMuz.x, eMuz.y, e.spec.isBoss ? 9 : 6);
      }
    }
    if (this.enemyChargeMs > 0) {
      const a = Math.min(1, this.enemyChargeMs / 240);
      for (const e of this.enemies) {
        if (e.dead || (e.spec.armor <= 0 && !e.spec.isBoss)) continue;
        const eMuz = this.getSpritePoint(e.sprite, getShipHardpoints(`ship.enemy.${e.spec.spriteArchetype}`).muzzle);
        this.addFxGraphics.fillStyle(0xff8c52, a * 0.65);
        this.addFxGraphics.fillCircle(eMuz.x, eMuz.y, (e.spec.isBoss ? 14 : 9) * a);
      }
    }

    // Heavy Cannon amber charging halo directly at the mounted Heavy Railgun barrel
    if (this.heavyChargingCount > 0 && this.playerSprite) {
      const hm = this.getModuleMuzzle('heavy') ?? { x: this.playerBaseX + 26, y: this.playerBaseY - 14 };
      const pulse = reduced ? 0.8 : 0.45 + 0.5 * Math.sin(this.elapsed * 12);
      this.fxGraphics.lineStyle(2.5, 0xf6b852, pulse);
      this.fxGraphics.strokeCircle(hm.x, hm.y, 13);
      this.addFxGraphics.fillStyle(0xffd27d, pulse * 0.42);
      this.addFxGraphics.fillCircle(hm.x, hm.y, 7);
    }

    // Active Shield Counter emitter subtle idle hum
    if (pb?.shipVisualSpec?.counterActive && this.playerSprite?.visible) {
      const cm = this.getModuleMuzzle('counter_ring');
      if (cm) {
        const p = reduced ? 0.55 : 0.35 + 0.35 * Math.sin(this.elapsed * 6);
        this.fxGraphics.lineStyle(1.8, 0x62d6df, p);
        this.fxGraphics.strokeCircle(cm.x - 6, cm.y, 9);
      }
    }

    // Countable orbiting micro-drone chevrons launched from ventral bay
    if (this.activeDronesCount > 0) {
      const shown = Math.min(8, this.activeDronesCount);
      for (let d = 0; d < shown; d++) {
        const angle = (reduced ? 0 : this.elapsed * 2.0) + (d / shown) * Math.PI * 2;
        const dx = this.playerBaseX + 42 + Math.cos(angle) * 14;
        const dy = this.playerBaseY - 26 + d * 14 + (reduced ? 0 : Math.sin(angle) * 4);
        this.fxGraphics.fillStyle(0x62d6df, 0.95);
        this.fxGraphics.fillTriangle(dx + 8, dy, dx - 5, dy - 4.5, dx - 5, dy + 4.5);
        this.fxGraphics.lineStyle(1.2, 0xf6b852, 0.92);
        this.fxGraphics.strokeTriangle(dx + 8, dy, dx - 5, dy - 4.5, dx - 5, dy + 4.5);
      }
    }

    // Localized curved hexagonal shield deflection ripple (player & enemies) + ADD energy glow
    if (this.shieldArcLife > 0) {
      this.shieldArcLife = Math.max(0, this.shieldArcLife - worldDt);
      const a = Math.min(1, this.shieldArcLife / 0.36);
      const sx = this.playerBaseX + 30;
      const sy = this.playerBaseY;
      this.fxGraphics.lineStyle(3.5, 0x62d6df, a * 0.92);
      this.fxGraphics.beginPath();
      this.fxGraphics.arc(sx, sy, 36, -Math.PI * 0.42, Math.PI * 0.42);
      this.fxGraphics.strokePath();
      this.addFxGraphics.lineStyle(5.2, 0x62d6df, a * 0.42);
      this.addFxGraphics.beginPath();
      this.addFxGraphics.arc(sx, sy, 37, -Math.PI * 0.44, Math.PI * 0.44);
      this.addFxGraphics.strokePath();
      this.addFxGraphics.lineStyle(1.6, 0xb8f3ff, a * 0.75);
      this.addFxGraphics.beginPath();
      this.addFxGraphics.arc(sx - 4, sy, 29, -Math.PI * 0.34, Math.PI * 0.34);
      this.addFxGraphics.strokePath();
    }
    for (const e of this.enemies) {
      if (e.shieldArcLife <= 0) continue;
      e.shieldArcLife = Math.max(0, e.shieldArcLife - worldDt);
      const a = Math.min(1, e.shieldArcLife / 0.36);
      const eHp = getShipHardpoints(`ship.enemy.${e.spec.spriteArchetype}`);
      const sc = this.getSpritePoint(e.sprite, eHp.shieldCenter);
      const rad = Math.max(22, Math.min(44, e.sprite.displayHeight * 0.44));
      this.fxGraphics.lineStyle(3.0, 0x62d6df, a * 0.9);
      this.fxGraphics.beginPath();
      this.fxGraphics.arc(sc.x - 10, sc.y, rad, Math.PI * 0.58, Math.PI * 1.42);
      this.fxGraphics.strokePath();
      this.addFxGraphics.lineStyle(4.8, 0x62d6df, a * 0.42);
      this.addFxGraphics.beginPath();
      this.addFxGraphics.arc(sc.x - 10, sc.y, rad + 1, Math.PI * 0.56, Math.PI * 1.44);
      this.addFxGraphics.strokePath();
    }
    if (this.counterBackflowLife > 0) {
      this.counterBackflowLife = Math.max(0, this.counterBackflowLife - worldDt);
      const a = Math.min(1, this.counterBackflowLife / 0.34);
      const cm = this.getModuleMuzzle('counter_ring');
      if (cm) {
        this.fxGraphics.lineStyle(2.8, 0x7be8ff, a);
        this.fxGraphics.beginPath();
        this.fxGraphics.moveTo(this.playerBaseX + 34, this.playerBaseY);
        this.fxGraphics.lineTo(cm.x, cm.y);
        this.fxGraphics.strokePath();
      }
    }

    // A01 Localized ADD-blend impact glows at exact hit coordinates
    this.impactGlows = this.impactGlows.filter((g) => {
      g.life -= worldDt;
      if (g.life <= 0) return false;
      const t = Math.max(0, g.life / g.maxLife);
      const rad = g.maxR * (0.55 + 0.45 * (1 - t));
      const outerAlpha = reduced ? t * 0.42 : t * 0.62;
      const coreAlpha = reduced ? t * 0.55 : t * 0.88;
      this.addFxGraphics.fillStyle(g.color, outerAlpha);
      this.addFxGraphics.fillCircle(g.x, g.y, rad);
      this.addFxGraphics.fillStyle(g.kind === 'shield' ? 0xd8f8ff : 0xfff4d6, coreAlpha);
      this.addFxGraphics.fillCircle(g.x, g.y, Math.max(3, rad * 0.42));
      return true;
    });

    // A03 Weapon muzzle flashes at weapon hardpoints (ADD blend)
    this.muzzleFlashes = this.muzzleFlashes.filter((mf) => {
      mf.life -= worldDt;
      if (mf.life <= 0) return false;
      const t = Math.max(0, mf.life / mf.maxLife);
      const r = mf.size * (0.65 + 0.35 * t);
      this.addFxGraphics.fillStyle(mf.color, t * 0.58);
      this.addFxGraphics.fillCircle(mf.x, mf.y, r);
      this.addFxGraphics.fillStyle(0xffffff, t * 0.92);
      this.addFxGraphics.fillTriangle(
        mf.x,
        mf.y - r * 0.45,
        mf.x,
        mf.y + r * 0.45,
        mf.x + mf.dir * r * 1.45,
        mf.y
      );
      return true;
    });

    // A03 Heavy railgun / cannon tracer projectiles (ADD blend)
    this.tracers = this.tracers.filter((tr) => {
      tr.elapsed += worldDt;
      if (tr.elapsed >= tr.duration) return false;
      const pHead = Math.min(1, tr.elapsed / tr.duration);
      const pTail = Math.max(0, pHead - 0.28);
      const hx = lerpNumber(tr.x1, tr.x2, pHead);
      const hy = lerpNumber(tr.y1, tr.y2, pHead);
      const tx = lerpNumber(tr.x1, tr.x2, pTail);
      const ty = lerpNumber(tr.y1, tr.y2, pTail);
      this.addFxGraphics.lineStyle(tr.width * 2.1, tr.color, 0.38);
      this.addFxGraphics.lineBetween(tx, ty, hx, hy);
      this.addFxGraphics.lineStyle(tr.width, 0xffffff, 0.95);
      this.addFxGraphics.lineBetween(tx, ty, hx, hy);
      this.addFxGraphics.fillStyle(0xffffff, 0.96);
      this.addFxGraphics.fillCircle(hx, hy, tr.width * 0.85);
      return true;
    });

    // A03 Pooled spark, shield-shard & debris particles (strictly <= 24/burst, <= 100 active, 0 in lowQuality)
    this.particlePool.step(worldDt);
    this.particlePool.forEachActive((p) => {
      const a = Math.max(0, p.life / Math.max(0.01, p.maxLife));
      if (p.kind === 'spark') {
        const tailX = p.x - p.vx * 0.025;
        const tailY = p.y - p.vy * 0.025;
        this.addFxGraphics.lineStyle(Math.max(1.2, p.size * 0.7), p.color, a * 0.88);
        this.addFxGraphics.lineBetween(tailX, tailY, p.x, p.y);
        this.addFxGraphics.fillStyle(0xfff6dc, a);
        this.addFxGraphics.fillCircle(p.x, p.y, Math.max(1.2, p.size * 0.45));
      } else if (p.kind === 'shield_shard') {
        const c = Math.cos(p.angleRad) * p.size;
        const s = Math.sin(p.angleRad) * p.size;
        this.addFxGraphics.fillStyle(p.color, a * 0.85);
        this.addFxGraphics.fillTriangle(
          p.x + c * 1.3,
          p.y + s * 1.3,
          p.x - s * 0.7,
          p.y + c * 0.7,
          p.x - c * 0.9,
          p.y - s * 0.9
        );
      } else {
        this.fxGraphics.fillStyle(p.color, a * 0.85);
        this.fxGraphics.fillRect(p.x - p.size * 0.5, p.y - p.size * 0.35, p.size, p.size * 0.7);
      }
    });

    // Damaged hull smoke puffs
    this.smokes = this.smokes.filter((s) => {
      s.life -= worldDt;
      if (s.life <= 0) return false;
      s.x += s.vx * worldDt;
      s.y += s.vy * worldDt;
      const a = (s.life / s.maxLife) * 0.6;
      this.fxGraphics.fillStyle(s.color, a);
      this.fxGraphics.fillCircle(s.x, s.y, s.r * (1.3 - (s.life / s.maxLife) * 0.4));
      return true;
    });

    // A04 Ticked HP & Shield bars with trailing damage ghost bar (Enemies + Player combat bar)
    const drawTickedHpBar = (
      bx: number,
      by: number,
      barW: number,
      hp: number,
      trailHp: number,
      maxHp: number,
      shield: number,
      maxShield: number,
      fillColor: number
    ) => {
      const safeMax = Math.max(1, maxHp);
      const pct = Math.max(0, Math.min(1, hp / safeMax));
      const trailPct = Math.max(pct, Math.min(1, trailHp / safeMax));

      if (shield > 0) {
        const sPct = Math.max(0, Math.min(1, shield / Math.max(1, maxShield, shield)));
        this.fxGraphics.fillStyle(0x0b121f, 0.85);
        this.fxGraphics.fillRoundedRect(bx - 1, by - 6, barW + 2, 5, 2);
        this.fxGraphics.fillStyle(0x62d6df, 0.95);
        this.fxGraphics.fillRoundedRect(bx, by - 5, barW * sPct, 3, 1.5);
      }
      this.fxGraphics.fillStyle(0x0b121f, 0.88);
      this.fxGraphics.fillRoundedRect(bx - 1, by - 1, barW + 2, 7, 3);
      if (trailPct > pct + 0.002) {
        this.fxGraphics.fillStyle(0xfff2cc, 0.88);
        this.fxGraphics.fillRoundedRect(bx, by, barW * trailPct, 5, 2);
      }
      if (pct > 0) {
        this.fxGraphics.fillStyle(fillColor, 0.95);
        this.fxGraphics.fillRoundedRect(bx, by, barW * pct, 5, 2);
      }
      const ticks = computeHpBarTickRatios(safeMax);
      if (ticks.length > 0) {
        this.fxGraphics.lineStyle(1, 0x0b121f, 0.62);
        for (const r of ticks) {
          const tx = bx + barW * r;
          this.fxGraphics.lineBetween(tx, by, tx, by + 5);
        }
      }
    };

    if (pb?.simulation && this.playerSprite && this.playerSprite.visible && this.playerHpState.maxHp > 0) {
      const pBarW = 60;
      const pBx = this.playerBaseX - pBarW * 0.5;
      const pBy = this.playerBaseY + this.playerSprite.displayHeight * 0.46 + 4;
      drawTickedHpBar(
        pBx,
        pBy,
        pBarW,
        this.playerHpState.hp,
        this.playerHpState.trailHp,
        this.playerHpState.maxHp,
        this.playerShield,
        this.playerMaxShield,
        0x7ae582
      );
    }

    for (const e of this.enemies) {
      if (e.dead) continue;
      const barW = e.spec.isBoss ? 68 : this.enemies.length === 1 ? 56 : 38;
      const bx = e.baseX - barW / 2;
      const by = e.baseY + e.sprite.displayHeight * 0.46 + 4;
      drawTickedHpBar(
        bx,
        by,
        barW,
        e.hp,
        e.trailHp,
        e.maxHp,
        e.shield,
        e.maxShield,
        e.spec.isBoss ? 0xf6b852 : 0xf27564
      );
    }

    // A03 3-Layer Composite Beams (outer ADD glow + colored mid core + bright white center)
    const strokeBeamPath = (gfx: Phaser.GameObjects.Graphics, b: BeamFx) => {
      if (b.jagged) {
        const steps = 6;
        gfx.beginPath();
        gfx.moveTo(b.x1, b.y1);
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          const jx = b.x1 + (b.x2 - b.x1) * t;
          const jy = b.y1 + (b.y2 - b.y1) * t + (s % 2 === 0 ? -9 : 9);
          gfx.lineTo(jx, jy);
        }
        gfx.lineTo(b.x2, b.y2);
        gfx.strokePath();
      } else {
        gfx.beginPath();
        gfx.moveTo(b.x1, b.y1);
        gfx.lineTo(b.x2, b.y2);
        gfx.strokePath();
      }
    };

    this.beams = this.beams.filter((b) => {
      b.life -= worldDt;
      if (b.life <= 0) return false;
      const a = Math.max(0, b.life / b.maxLife);
      const layers = computeThreeLayerBeamStrokes(b.thickness, b.color, a);
      // Layer 1: Wide outer ADD glow
      this.addFxGraphics.lineStyle(layers.outerGlow.width, layers.outerGlow.color, layers.outerGlow.alpha);
      strokeBeamPath(this.addFxGraphics, b);
      // Layer 2: Colored mid core
      this.fxGraphics.lineStyle(layers.coloredCore.width, layers.coloredCore.color, layers.coloredCore.alpha);
      strokeBeamPath(this.fxGraphics, b);
      // Layer 3: Bright white center
      this.addFxGraphics.lineStyle(layers.whiteCenter.width, layers.whiteCenter.color, layers.whiteCenter.alpha);
      strokeBeamPath(this.addFxGraphics, b);
      return true;
    });

    // A07-code + S08: Wreck compartment closed / cutting / cutaway visual layers
    if (pb?.eventBackdrop === 'wreck') {
      if (this.wreckCutAnim) {
        this.wreckCutAnim.elapsedMs += worldDt * 1000;
        if (this.wreckCutAnim.elapsedMs >= this.wreckCutAnim.durationMs) {
          this.wreckCutAnim = null;
        }
      }
      const scale = Math.max(0.65, Math.min(1.25, Math.min(this.viewW / 960, this.viewH / 540)));
      const boxW = Math.round(78 * scale);
      const boxH = Math.round(54 * scale);

      for (const comp of this.wreckCompartments) {
        const cx = this.viewW * comp.normX;
        const cy = this.viewH * comp.normY;
        const left = cx - boxW * 0.5;
        const top = cy - boxH * 0.5;
        // Optional external plate hook (strictly exists-checked, 0 404 requests!)
        const optionalPlateKey = comp.cut
          ? `event.wreck.room.${comp.spotId}.open`
          : `event.wreck.room.${comp.spotId}.closed`;
        const hasOptionalPlate = Boolean(this.textures?.exists(optionalPlateKey));

        if (!hasOptionalPlate) {
          if (comp.cut) {
            // Exposed cutaway interior cavity with ribs + sheared clamp brackets
            this.fxGraphics.fillStyle(0x08101c, 0.86);
            this.fxGraphics.fillRoundedRect(left, top, boxW, boxH, 6);
            this.fxGraphics.lineStyle(2, 0x62d6df, 0.72);
            this.fxGraphics.strokeRoundedRect(left, top, boxW, boxH, 6);
            this.fxGraphics.lineStyle(1, 0x2b4566, 0.75);
            this.fxGraphics.lineBetween(left + boxW * 0.25, top + 4, left + boxW * 0.25, top + boxH - 4);
            this.fxGraphics.lineBetween(left + boxW * 0.75, top + 4, left + boxW * 0.75, top + boxH - 4);
            // Popped clamps shifted outward
            this.fxGraphics.fillStyle(0x62d6df, 0.6);
            this.fxGraphics.fillRect(left - 8, cy - 6, 5, 12);
            this.fxGraphics.fillRect(left + boxW + 3, cy - 6, 5, 12);
          } else {
            // Armored closed bulkhead hatch + glowing hydraulic clamps
            const clampColor = comp.isLethal
              ? 0xf27564
              : comp.isRisky
              ? 0xf6b852
              : 0x62d6df;
            const pulseAlpha = reduced ? 0.78 : 0.62 + Math.sin(this.elapsed * 4.2 + comp.normX * 7) * 0.24;
            this.fxGraphics.fillStyle(0x18273a, 0.72);
            this.fxGraphics.fillRoundedRect(left, top, boxW, boxH, 6);
            this.fxGraphics.lineStyle(1.8, clampColor, pulseAlpha);
            this.fxGraphics.strokeRoundedRect(left, top, boxW, boxH, 6);
            // Clamps gripping left/right seams
            this.fxGraphics.fillStyle(clampColor, pulseAlpha);
            this.fxGraphics.fillRect(left - 3, cy - 8, 6, 16);
            this.fxGraphics.fillRect(left + boxW - 3, cy - 8, 6, 16);
          }
        }

        if (comp.cutting && this.wreckCutAnim) {
          const frame = computeWreckCutTimeline(
            this.wreckCutAnim.elapsedMs,
            this.wreckCutAnim.durationMs,
            reduced
          );
          const torchX = cx + frame.torchLocalX * (boxW * 0.5);
          const torchY = cy + frame.torchLocalY * (boxH * 0.5);
          // Glowing ADD-blend plasma cut perimeter & torch head
          this.addFxGraphics.lineStyle(3.2, 0xf6b852, 0.92);
          this.addFxGraphics.strokeRoundedRect(left, top, boxW, boxH, 6);
          this.addFxGraphics.fillStyle(0xfff1cc, 0.95);
          this.addFxGraphics.fillCircle(torchX, torchY, 6 * scale);
          this.addFxGraphics.fillStyle(0xf6b852, 0.48);
          this.addFxGraphics.fillCircle(torchX, torchY, 13 * scale);
          if (!lowQuality && !reduced) {
            this.particlePool.spawnBurst({
              kind: 'spark',
              x: torchX,
              y: torchY,
              count: 2,
              color: 0xf6b852,
              lowQuality,
            });
          }
        }
      }
    }

    // Impact rings
    this.rings = this.rings.filter((r) => {
      r.life -= worldDt;
      if (r.life <= 0) return false;
      const p = 1 - r.life / r.maxLife;
      const rad = 4 + r.maxR * p;
      this.fxGraphics.lineStyle(2.5, r.color, Math.max(0, 1 - p));
      this.fxGraphics.strokeCircle(r.x, r.y, rad);
      return true;
    });

    // Floating combat popups (vy === 0 in reducedMotion)
    this.popups = this.popups.filter((p) => {
      p.life -= worldDt;
      if (p.life <= 0) {
        if (p.textObj?.scene) p.textObj.destroy();
        return false;
      }
      if (p.textObj?.scene) {
        p.textObj.y += p.vy * worldDt;
        p.textObj.setAlpha(Math.min(1, p.life / (p.maxLife * 0.45)));
      }
      return true;
    });
  }
}
