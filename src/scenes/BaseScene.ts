import Phaser from 'phaser';
import { getBaseLayerImageUrl, getPlayerShipImageUrl } from '../assets/itemArt';
import { soundEngine } from '../audio/soundEngine';
import { BUILDINGS, RELICS, RELIC_ORDER, type BuildingId } from '../data/buildings';
import {
  DEFAULT_SETTINGS,
  canBuildFacility,
  getRelicCollectionSummary,
  type BaseProgression,
  type GameSettings,
} from '../domain/progression';
import type { V2ShipId } from '../v2/data/ships';
import type { CampaignActId } from '../v2/domain/types';

export interface BaseSceneState {
  readonly progression: BaseProgression;
  readonly settings: GameSettings;
  readonly recentlyBuiltId: BuildingId | null;
  readonly v2Override?: {
    readonly shipId?: V2ShipId;
    readonly wbText?: string;
    readonly dispText?: string;
    readonly dockText?: string;
    readonly berthText?: string;
    readonly workbenchWorking?: boolean;
    readonly showAllPins?: boolean;
  };
}

/** Interface Contract #4: Native V2 Orbital Station Diorama State (zero V1 adapter) */
export interface V2BaseDioramaState {
  readonly activeShipId: V2ShipId;
  readonly facilityTiers: Readonly<Record<string, number>>;
  readonly restoredRelicIds: readonly string[];
  readonly campaignAct: CampaignActId;
  readonly stargatePowered: boolean;
  readonly settings?: GameSettings;
  readonly recentlyBuiltId?: string | null;
  readonly restorableRelicCount?: number;
  readonly workbenchWorking?: boolean;
  readonly blueprintsCount?: number;
  readonly totalBlueprints?: number;
  readonly warehouseCount?: number;
  readonly warehouseCapacity?: number;
  readonly unlockedShipsCount?: number;
  readonly totalShips?: number;
}

export interface ReturnDockingPlayback {
  readonly earnedCredits: number;
  readonly crateCount: number;
  readonly hasKeptRelic: boolean;
  readonly wasDefeat: boolean;
  readonly onProgress?: (progress: number) => void;
  readonly onFinish?: () => void;
}

const TEX_W = 1280;
const TEX_H = 720;

export type BaseOverlayKey = 'workbench' | 'display_empty' | 'display_relic' | 'drydock';

export const BASE_OVERLAY_KEYS: readonly BaseOverlayKey[] = [
  'workbench',
  'display_empty',
  'display_relic',
  'drydock',
] as const;

export interface OverlayTransitionState {
  readonly alpha: number;
  readonly targetAlpha: 0 | 1;
  readonly scanProgress: number;
  readonly poweringUp: boolean;
}

export interface OverlayQuadrantBounds {
  readonly nx0: number;
  readonly ny0: number;
  readonly nx1: number;
  readonly ny1: number;
  readonly accent: number;
}

/** Exact measured alpha bounding boxes of public/assets/base/overlay_*.webp (1280x720) */
export const OVERLAY_QUADRANT_BOUNDS: Record<BaseOverlayKey, OverlayQuadrantBounds> = {
  workbench: { nx0: 0.039, ny0: 0.121, nx1: 0.419, ny1: 0.694, accent: 0xf6b852 },
  display_empty: { nx0: 0.339, ny0: 0.0, nx1: 0.671, ny1: 0.417, accent: 0x62d6df },
  display_relic: { nx0: 0.339, ny0: 0.0, nx1: 0.671, ny1: 0.417, accent: 0xf6b852 },
  drydock: { nx0: 0.59, ny0: 0.14, nx1: 0.962, ny1: 0.686, accent: 0x62d6df },
};

const OVERLAY_FADE_IN_SEC = 0.52;
const OVERLAY_SCAN_SEC = 0.68;
const OVERLAY_FADE_OUT_SEC = 0.4;

/** Pure deterministic overlay cross-fade & bottom-to-top scanline stepper (zero Phaser Tween dependency) */
export function stepOverlayTransition(
  state: OverlayTransitionState,
  dtSec: number,
  reducedMotion: boolean
): OverlayTransitionState {
  if (reducedMotion) {
    return {
      alpha: state.targetAlpha,
      targetAlpha: state.targetAlpha,
      scanProgress: 1,
      poweringUp: false,
    };
  }
  const safeDt = Number.isFinite(dtSec) && dtSec > 0 ? dtSec : 0;
  if (state.targetAlpha === 1) {
    const nextAlpha = Math.min(1, state.alpha + safeDt / OVERLAY_FADE_IN_SEC);
    if (state.poweringUp) {
      const nextScan = Math.min(1, state.scanProgress + safeDt / OVERLAY_SCAN_SEC);
      return {
        alpha: nextAlpha,
        targetAlpha: 1,
        scanProgress: nextScan,
        poweringUp: nextScan < 1,
      };
    }
    return {
      alpha: nextAlpha,
      targetAlpha: 1,
      scanProgress: 1,
      poweringUp: false,
    };
  }

  const nextAlpha = Math.max(0, state.alpha - safeDt / OVERLAY_FADE_OUT_SEC);
  return {
    alpha: nextAlpha,
    targetAlpha: 0,
    scanProgress: 1,
    poweringUp: false,
  };
}

export interface CranePoint2D {
  readonly x: number;
  readonly y: number;
}

export interface CraneSegment {
  readonly name: 'turntable_mast' | 'lower_boom' | 'upper_jib' | 'hoist_trolley';
  readonly from: CranePoint2D;
  readonly to: CranePoint2D;
}

export interface ArticulatedCraneInput {
  readonly base: CranePoint2D;
  readonly target: CranePoint2D;
  readonly scale: number;
  readonly cableDrop?: number;
  readonly swayX?: number;
  readonly mode?: 'stowed' | 'idle' | 'docking';
}

export interface ArticulatedCranePose {
  readonly turntable: CranePoint2D;
  readonly shoulder: CranePoint2D;
  readonly elbow: CranePoint2D;
  readonly trolley: CranePoint2D;
  readonly hook: CranePoint2D;
  readonly segments: readonly [CraneSegment, CraneSegment, CraneSegment, CraneSegment];
  readonly lowerBoomLength: number;
  readonly upperJibLength: number;
  readonly cableLength: number;
  readonly mode: 'stowed' | 'idle' | 'docking';
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clampVal(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Pure deterministic 4-joint / 5-vertex articulated crane inverse-kinematics solver:
 * turntable (p0) -> shoulder (p1) -> elbow (p2) -> trolley (p3) -> hook (p4).
 * Uses pure JS Law-of-Cosines IK with overhead elbow preference, smooth telescoping for
 * long-range relic hoists, and close-range stow retraction (pure JS math, zero NaN).
 */
export function solveArticulatedCranePose(input: ArticulatedCraneInput): ArticulatedCranePose {
  const s = Math.max(0.25, Number.isFinite(input.scale) ? input.scale : 1);
  const mode = input.mode ?? 'idle';
  const turntable: CranePoint2D = { x: input.base.x, y: input.base.y };

  const mastHeight = (mode === 'stowed' ? 20 : 26) * s;
  const slewLean = clampVal((input.target.x - turntable.x) * 0.08, -8 * s, 8 * s);
  const shoulder: CranePoint2D = {
    x: turntable.x + slewLean,
    y: turntable.y - mastHeight,
  };

  const cableLength = Math.max(10 * s, input.cableDrop ?? (mode === 'stowed' ? 12 * s : 26 * s));
  const trolley: CranePoint2D = {
    x: input.target.x,
    y: input.target.y - cableLength,
  };
  const swayX = Number.isFinite(input.swayX) ? (input.swayX ?? 0) : 0;
  const hook: CranePoint2D = {
    x: trolley.x + swayX,
    y: input.target.y,
  };

  let lowerBoomLength = 152 * s;
  let upperJibLength = 138 * s;

  const dx = trolley.x - shoulder.x;
  const dy = trolley.y - shoulder.y;
  const dist = Math.hypot(dx, dy);

  const maxReach = (lowerBoomLength + upperJibLength) * 0.94;
  const minReach = Math.abs(lowerBoomLength - upperJibLength) + 8 * s;

  if (dist > maxReach) {
    // Telescope upper jib smoothly for distant targets (e.g., relic display dome) while keeping elbow arch
    upperJibLength = dist - lowerBoomLength + 20 * s;
  } else if (dist < minReach) {
    // Retract stowed/close-range boom proportionally so elbow folds neatly without NaN
    const ratio = Math.max(0.28, (dist + 24 * s) / (lowerBoomLength + upperJibLength));
    lowerBoomLength *= ratio;
    upperJibLength *= ratio;
  }

  let elbow: CranePoint2D;
  if (dist < 1e-4) {
    elbow = {
      x: shoulder.x - lowerBoomLength * 0.4,
      y: shoulder.y - lowerBoomLength * 0.9,
    };
  } else {
    const a = lowerBoomLength;
    const b = upperJibLength;
    const u = clampVal((a * a - b * b + dist * dist) / (2 * dist), -a, a);
    const hSq = Math.max(0, a * a - u * u);
    const h = Math.sqrt(hSq);

    const mx = shoulder.x + (u / dist) * dx;
    const my = shoulder.y + (u / dist) * dy;
    const px = -dy / dist;
    const py = dx / dist;

    const candA: CranePoint2D = { x: mx + h * px, y: my + h * py };
    const candB: CranePoint2D = { x: mx - h * px, y: my - h * py };

    // Always choose the overhead candidate (smaller Y in screen space; deterministic -X tie-breaker)
    if (Math.abs(candA.y - candB.y) > 1e-4) {
      elbow = candA.y < candB.y ? candA : candB;
    } else {
      elbow = candA.x <= candB.x ? candA : candB;
    }
  }

  const segments: readonly [CraneSegment, CraneSegment, CraneSegment, CraneSegment] = [
    { name: 'turntable_mast', from: turntable, to: shoulder },
    { name: 'lower_boom', from: shoulder, to: elbow },
    { name: 'upper_jib', from: elbow, to: trolley },
    { name: 'hoist_trolley', from: trolley, to: hook },
  ];

  return {
    turntable,
    shoulder,
    elbow,
    trolley,
    hook,
    segments,
    lowerBoomLength,
    upperJibLength,
    cableLength,
    mode,
  };
}

function createInitialOverlayStates(): Record<BaseOverlayKey, OverlayTransitionState> {
  return {
    workbench: { alpha: 0, targetAlpha: 0, scanProgress: 1, poweringUp: false },
    display_empty: { alpha: 0, targetAlpha: 0, scanProgress: 1, poweringUp: false },
    display_relic: { alpha: 0, targetAlpha: 0, scanProgress: 1, poweringUp: false },
    drydock: { alpha: 0, targetAlpha: 0, scanProgress: 1, poweringUp: false },
  };
}

function matchesRecentlyBuiltOverlay(key: BaseOverlayKey, recentlyBuiltId: string | null): boolean {
  if (!recentlyBuiltId) return false;
  if (key === 'workbench') return recentlyBuiltId === 'workbench' || recentlyBuiltId === 'research_lab';
  if (key === 'display_empty' || key === 'display_relic') return recentlyBuiltId === 'display';
  if (key === 'drydock') return recentlyBuiltId === 'drydock' || recentlyBuiltId === 'drydock_tier2';
  return false;
}

/**
 * Illustrated Axonometric Orbital Salvage Station (V1 + Full V2/V3 Diorama Parity).
 * Preserves legacy V1 `setState()` / `setProgression()` 100% untouched for `?mode=v1`,
 * while providing native `setV2StationState(V2BaseDioramaState)` for active 4-hull berthed ship,
 * diegetic T1–T3 facility lighting, 4 orbiting restored relic halos, Act-aware space nebula,
 * 4-joint articulated crane, smooth facility overlay cross-fade/scanline power-up,
 * and Stargate Relay portal rings & beacon beam.
 */
export class BaseScene extends Phaser.Scene {
  private currentState: BaseSceneState | null = null;
  private v2State: V2BaseDioramaState | null = null;
  private onBuildingClick: ((id: BuildingId) => void) | null = null;
  private onBerthClick: (() => void) | null = null;
  private onAssetError: ((key: string) => void) | null = null;

  private bgGraphics!: Phaser.GameObjects.Graphics;
  private overlayScanGraphics!: Phaser.GameObjects.Graphics;
  private edgeMaskGraphics!: Phaser.GameObjects.Graphics;
  private v2StaticGraphics!: Phaser.GameObjects.Graphics;
  private animGraphics!: Phaser.GameObjects.Graphics;

  private baseImage!: Phaser.GameObjects.Image;
  private wbOverlay!: Phaser.GameObjects.Image;
  private dispEmptyOverlay!: Phaser.GameObjects.Image;
  private dispRelicOverlay!: Phaser.GameObjects.Image;
  private drydockOverlay!: Phaser.GameObjects.Image;
  private berthedShipSprite!: Phaser.GameObjects.Image;
  private arrivalShipSprite!: Phaser.GameObjects.Image;

  private hitZones: {
    id: BuildingId;
    zone: Phaser.GameObjects.Zone;
    badgeBg: Phaser.GameObjects.Graphics;
    label: Phaser.GameObjects.Text;
  }[] = [];
  private stargatePin: {
    zone: Phaser.GameObjects.Zone;
    badgeBg: Phaser.GameObjects.Graphics;
    label: Phaser.GameObjects.Text;
  } | null = null;
  private berthZone: Phaser.GameObjects.Zone | null = null;

  private elapsed = 0;
  private buildCelebrateTimer = 0;
  private celebrateFacilityKey: string | null = null;
  private viewW = 390;
  private viewH = 340;
  private dpr = 1;
  private texturesReady = false;

  // A08-code smooth overlay cross-fade + scanline power-up state
  private overlayInitialized = false;
  private overlayTransitions: Record<BaseOverlayKey, OverlayTransitionState> = createInitialOverlayStates();
  private lastCranePose: ArticulatedCranePose | null = null;

  // F11 Return-to-port docking & unloading animation (pure presentation, zero payout authority)
  private dockingPlayback: ReturnDockingPlayback | null = null;
  private dockingElapsedMs = 0;
  private readonly dockingDurationMs = 1400;
  private dockingServoStage: 0 | 1 | 2 = 0;
  private servoClockMs = 0;
  private lastCraneServoMs = -1000;

  constructor() {
    super({ key: 'BaseScene' });
  }

  init(data?: {
    state?: BaseSceneState;
    v2State?: V2BaseDioramaState;
    onBuildingClick?: (id: BuildingId) => void;
    onBerthClick?: () => void;
    onAssetError?: (key: string) => void;
  }): void {
    if (data?.v2State) {
      this.v2State = data.v2State;
      this.currentState = null;
    } else if (data?.state) {
      this.currentState = data.state;
      this.v2State = null;
    }
    if (data?.onBuildingClick) this.onBuildingClick = data.onBuildingClick;
    if (data?.onBerthClick) this.onBerthClick = data.onBerthClick;
    if (data?.onAssetError) this.onAssetError = data.onAssetError;
  }

  preload(): void {
    this.load.on('loaderror', (file: { key?: string }) => {
      this.onAssetError?.(file?.key ?? 'unknown');
    });
    const queue: [string, string][] = [
      ['base.station.worn', getBaseLayerImageUrl('worn')],
      ['base.overlay.workbench', getBaseLayerImageUrl('workbench')],
      ['base.overlay.display_empty', getBaseLayerImageUrl('display_empty')],
      ['base.overlay.display_relic', getBaseLayerImageUrl('display_relic')],
      ['base.overlay.drydock', getBaseLayerImageUrl('drydock')],
      ['ship.player.cannon_skiff', getPlayerShipImageUrl('cannon_skiff')],
      ['ship.player.shield_cruiser', getPlayerShipImageUrl('shield_cruiser')],
      ['ship.player.heavy_freighter', getPlayerShipImageUrl('heavy_freighter')],
      ['ship.player.stargate_cruiser', getPlayerShipImageUrl('stargate_cruiser')],
    ];
    for (const [key, url] of queue) {
      if (!this.textures.exists(key)) {
        this.load.image(key, url);
      }
    }
  }

  create(): void {
    this.dpr = (this.game.registry.get('dpr') as number) || 1;
    const parentRect = this.game.canvas?.parentElement?.getBoundingClientRect();
    const liveW = parentRect && parentRect.width >= 16 ? Math.round(parentRect.width) : 0;
    const liveH = parentRect && parentRect.height >= 16 ? Math.round(parentRect.height) : 0;
    this.viewW = liveW || Math.round((this.scale.width || 390) / this.dpr);
    this.viewH = liveH || Math.round((this.scale.height || 340) / this.dpr);
    const expectedBw = Math.round(this.viewW * this.dpr);
    const expectedBh = Math.round(this.viewH * this.dpr);
    if (this.scale.width !== expectedBw || this.scale.height !== expectedBh) {
      this.scale.resize(expectedBw, expectedBh);
    }
    this.applyCameraViewport();
    this.cameras.main.setBackgroundColor('#0B1320');

    this.bgGraphics = this.add.graphics().setDepth(1);

    // Layer 2: Hand-painted master worn diorama + zero-jump same-camera upgrade overlays
    this.baseImage = this.add.image(0, 0, 'base.station.worn').setOrigin(0.5, 0.5).setDepth(2);
    this.wbOverlay = this.add.image(0, 0, 'base.overlay.workbench').setOrigin(0.5, 0.5).setDepth(3).setVisible(false);
    this.dispEmptyOverlay = this.add.image(0, 0, 'base.overlay.display_empty').setOrigin(0.5, 0.5).setDepth(3.1).setVisible(false);
    this.dispRelicOverlay = this.add.image(0, 0, 'base.overlay.display_relic').setOrigin(0.5, 0.5).setDepth(3.2).setVisible(false);
    this.drydockOverlay = this.add.image(0, 0, 'base.overlay.drydock').setOrigin(0.5, 0.5).setDepth(3.3).setVisible(false);
    this.overlayScanGraphics = this.add.graphics().setDepth(3.5);
    this.edgeMaskGraphics = this.add.graphics().setDepth(3.6);
    this.v2StaticGraphics = this.add.graphics().setDepth(3.8);

    // Berthed player ship resting on the landing pad (actively displayed in V2 mode!)
    this.berthedShipSprite = this.add
      .image(0, 0, 'ship.player.cannon_skiff')
      .setOrigin(0.5, 0.5)
      .setDepth(4.5)
      .setVisible(false);

    // Arrival ship sprite used exclusively during F11 return-to-port approach
    this.arrivalShipSprite = this.add
      .image(0, 0, 'ship.player.cannon_skiff')
      .setOrigin(0.5, 0.5)
      .setDepth(5)
      .setVisible(false);

    this.animGraphics = this.add.graphics().setDepth(6);
    this.overlayInitialized = false;
    this.overlayTransitions = createInitialOverlayStates();
    this.lastCranePose = null;
    this.dockingServoStage = 0;
    this.servoClockMs = 0;
    this.lastCraneServoMs = -1000;
    this.texturesReady = true;

    this.createInteractiveZones();
    this.redrawStatic();

    this.scale.on('resize', this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.texturesReady = false;
      this.overlayInitialized = false;
      this.overlayTransitions = createInitialOverlayStates();
      this.lastCranePose = null;
      this.dockingPlayback = null;
      this.dockingElapsedMs = 0;
      this.dockingServoStage = 0;
      this.servoClockMs = 0;
      this.lastCraneServoMs = -1000;
      this.hitZones = [];
      this.stargatePin = null;
      this.berthZone = null;
      this.scale.off('resize', this.handleResize, this);
    });
  }

  private applyCameraViewport(): void {
    if (!this.cameras?.main) return;
    const bw = Math.max(1, Math.round(this.viewW * this.dpr));
    const bh = Math.max(1, Math.round(this.viewH * this.dpr));
    this.cameras.main.setViewport(0, 0, bw, bh);
    this.cameras.main.setZoom(this.dpr);
    this.cameras.main.centerOn(this.viewW * 0.5, this.viewH * 0.5);
  }

  syncViewport(w: number, h: number, dpr?: number): void {
    if (w < 16 || h < 16) return;
    this.viewW = w;
    this.viewH = h;
    if (dpr !== undefined) this.dpr = dpr;
    this.applyCameraViewport();
    if (this.sys?.isActive() && this.texturesReady) {
      this.redrawStatic();
    }
  }

  /** Legacy V1 BaseScene entry point — preserved 100% intact for ?mode=v1 */
  setState(state: BaseSceneState): void {
    const newlyBuilt = state.recentlyBuiltId;
    if (newlyBuilt && newlyBuilt !== this.celebrateFacilityKey) {
      this.celebrateFacilityKey = newlyBuilt;
      this.buildCelebrateTimer = 1.6;
    }
    this.currentState = state;
    this.v2State = null;
    if (this.scene.isActive() && this.texturesReady) {
      this.redrawStatic();
    }
  }

  /** Legacy V1 compatibility helper */
  setProgression(progression: BaseProgression, settings?: GameSettings): void {
    this.setState({
      progression,
      settings: settings ?? this.currentState?.settings ?? DEFAULT_SETTINGS,
      recentlyBuiltId: null,
    });
  }

  /** Contract #4: Native V2/V3 Orbital Station Diorama state setter */
  setV2StationState(state: V2BaseDioramaState): void {
    const newlyBuilt = state.recentlyBuiltId ?? null;
    if (newlyBuilt && newlyBuilt !== this.celebrateFacilityKey) {
      this.celebrateFacilityKey = newlyBuilt;
      this.buildCelebrateTimer = 1.6;
    }
    this.v2State = state;
    this.currentState = null;
    if (this.scene.isActive() && this.texturesReady) {
      this.redrawStatic();
    }
  }

  setClickHandler(handler: (id: BuildingId) => void): void {
    this.onBuildingClick = handler;
  }

  setBerthClickHandler(handler: () => void): void {
    this.onBerthClick = handler;
  }

  setAssetErrorHandler(handler: (key: string) => void): void {
    this.onAssetError = handler;
  }

  updateSettings(settings: GameSettings): void {
    if (this.v2State) {
      this.v2State = { ...this.v2State, settings };
    } else if (this.currentState) {
      this.currentState = { ...this.currentState, settings };
    }
    if (settings.reducedMotion) {
      for (const key of BASE_OVERLAY_KEYS) {
        this.overlayTransitions[key] = stepOverlayTransition(this.overlayTransitions[key], 0, true);
      }
    }
    if (this.scene?.isActive() && this.texturesReady) {
      this.drawDynamicLayer();
    }
  }

  /** Read-only snapshot of overlay cross-fade & scanline progress for deterministic testing */
  getOverlayTransitionSnapshot(): Record<BaseOverlayKey, Readonly<OverlayTransitionState>> {
    return {
      workbench: { ...this.overlayTransitions.workbench },
      display_empty: { ...this.overlayTransitions.display_empty },
      display_relic: { ...this.overlayTransitions.display_relic },
      drydock: { ...this.overlayTransitions.drydock },
    };
  }

  /** Read-only snapshot of most recently solved 4-joint articulated crane pose */
  getLastCranePose(): ArticulatedCranePose | null {
    return this.lastCranePose;
  }

  startReturnDocking(playback: ReturnDockingPlayback): void {
    this.dockingPlayback = playback;
    this.dockingElapsedMs = 0;
    this.dockingServoStage = 0;
  }

  skipReturnDocking(): void {
    if (!this.dockingPlayback) return;
    const pb = this.dockingPlayback;
    this.dockingPlayback = null;
    this.dockingElapsedMs = 0;
    this.dockingServoStage = 2;
    if (this.arrivalShipSprite) this.arrivalShipSprite.setVisible(false);
    pb.onProgress?.(1);
    pb.onFinish?.();
  }

  private triggerCraneServo(): void {
    if (this.servoClockMs - this.lastCraneServoMs < 320) return;
    this.lastCraneServoMs = this.servoClockMs;
    soundEngine.play('craneServo');
  }

  update(_time: number, delta: number): void {
    if ((!this.currentState && !this.v2State) || !this.texturesReady) return;
    const isHidden = typeof document !== 'undefined' && document.hidden;
    const safeDelta = Number.isFinite(delta) ? Math.max(0, delta) : 0;
    const rawLoopDelta = this.game?.loop?.rawDelta;
    const safeRawDelta =
      typeof rawLoopDelta === 'number' && Number.isFinite(rawLoopDelta)
        ? Math.max(0, rawLoopDelta)
        : safeDelta;
    const elapsedMs = isHidden ? 0 : Math.max(safeDelta, safeRawDelta);
    const dtMs = Math.min(elapsedMs, 50);
    const dt = dtMs / 1000;
    this.elapsed += dt;
    this.servoClockMs += Math.min(elapsedMs, 500);

    const settings = this.getActiveSettings();
    const overlayDt = Math.min(elapsedMs, 250) / 1000;
    for (const key of BASE_OVERLAY_KEYS) {
      this.overlayTransitions[key] = stepOverlayTransition(
        this.overlayTransitions[key],
        overlayDt,
        settings.reducedMotion
      );
    }

    if (this.buildCelebrateTimer > 0) {
      this.buildCelebrateTimer = Math.max(0, this.buildCelebrateTimer - dt);
    }

    if (this.dockingPlayback) {
      this.dockingElapsedMs += Math.min(elapsedMs, 500);
      const p = Math.min(1, this.dockingElapsedMs / this.dockingDurationMs);
      // Stage-gated crane servo audio during active crane unload (1–2 triggers max per docking, 0 idle/post-skip)
      if (p >= 0.44 && this.dockingServoStage < 1) {
        this.dockingServoStage = 1;
        this.triggerCraneServo();
      } else if (
        p >= 0.74 &&
        this.dockingServoStage < 2 &&
        (this.dockingPlayback.crateCount >= 3 || this.dockingPlayback.hasKeptRelic)
      ) {
        this.dockingServoStage = 2;
        this.triggerCraneServo();
      }
      this.dockingPlayback.onProgress?.(p);
      if (p >= 1) {
        const pb = this.dockingPlayback;
        this.dockingPlayback = null;
        this.dockingServoStage = 2;
        if (this.arrivalShipSprite) this.arrivalShipSprite.setVisible(false);
        pb.onFinish?.();
      }
    }

    this.drawDynamicLayer();
  }

  private handleResize(gameSize?: Phaser.Structs.Size): void {
    if (!this.sys?.isActive()) return;
    const dpr = (this.game.registry.get('dpr') as number) || this.dpr || 1;
    const bw = gameSize && gameSize.width > 0 ? gameSize.width : this.scale.width || 390;
    const bh = gameSize && gameSize.height > 0 ? gameSize.height : this.scale.height || 340;
    this.syncViewport(Math.round(bw / dpr), Math.round(bh / dpr), dpr);
  }

  private getLayout() {
    const w = this.viewW || this.scale.width || 390;
    const h = this.viewH || this.scale.height || 340;
    const aspect = w / Math.max(1, h);

    const scale =
      aspect >= 1.55
        ? Math.min(w / TEX_W, h / (TEX_H * 0.94))
        : Math.max(w / TEX_W, h / (TEX_H * 1.02));

    const cx = w * 0.5;
    const cy = h * 0.51;
    const imgW = TEX_W * scale;
    const imgH = TEX_H * scale;
    const left = cx - imgW * 0.5;
    const top = cy - imgH * 0.5;

    const pt = (nx: number, ny: number) => ({
      x: left + nx * imgW,
      y: top + ny * imgH,
    });

    return {
      w,
      h,
      cx,
      cy,
      left,
      top,
      imgW,
      imgH,
      scale,
      pt,
      workbench: pt(0.22, 0.43),
      researchLab: pt(0.155, 0.345),
      workbenchSpark: pt(0.252, 0.455),
      contractHub: pt(0.305, 0.615),
      display: pt(0.50, 0.20),
      displayRelic: pt(0.50, 0.175),
      drydock: pt(0.76, 0.41),
      stargateRelay: pt(0.685, 0.225),
      padShip: pt(0.515, 0.715),
      approachStart: pt(0.06, 0.92),
    };
  }

  private createInteractiveZones(): void {
    for (const item of this.hitZones) {
      item.zone.destroy();
      item.badgeBg.destroy();
      item.label.destroy();
    }
    this.hitZones = [];
    if (this.stargatePin) {
      this.stargatePin.zone.destroy();
      this.stargatePin.badgeBg.destroy();
      this.stargatePin.label.destroy();
      this.stargatePin = null;
    }

    const defs: { id: BuildingId }[] = [
      { id: 'workbench' },
      { id: 'display' },
      { id: 'drydock' },
    ];

    const isDirectCanvasPointer = (pointer?: Phaser.Input.Pointer): boolean => {
      const evt = pointer?.event;
      if (!evt || !evt.target) return true;
      return evt.target === this.game.canvas;
    };

    for (const d of defs) {
      const zone = this.add.zone(0, 0, 120, 96).setInteractive({ useHandCursor: true }).setDepth(9);
      zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        if (!isDirectCanvasPointer(pointer)) return;
        this.onBuildingClick?.(d.id);
      });
      const badgeBg = this.add.graphics().setDepth(7);
      const label = this.add
        .text(0, 0, '', {
          fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
          fontSize: '12px',
          fontStyle: 'bold',
          color: '#E9EDF2',
          padding: { x: 8, y: 4 },
          resolution: 2,
        })
        .setOrigin(0.5, 0.5)
        .setDepth(8);
      this.hitZones.push({ id: d.id, zone, badgeBg, label });
    }

    const sgZone = this.add.zone(0, 0, 110, 86).setInteractive({ useHandCursor: true }).setDepth(9).setVisible(false);
    sgZone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!isDirectCanvasPointer(pointer)) return;
      this.onBuildingClick?.('drydock');
    });
    const sgBg = this.add.graphics().setDepth(7);
    const sgLabel = this.add
      .text(0, 0, '', {
        fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#F6B852',
        padding: { x: 7, y: 3 },
        resolution: 2,
      })
      .setOrigin(0.5, 0.5)
      .setDepth(8)
      .setVisible(false);
    this.stargatePin = { zone: sgZone, badgeBg: sgBg, label: sgLabel };

    if (this.berthZone?.scene) this.berthZone.destroy();
    this.berthZone = this.add
      .zone(0, 0, 140, 88)
      .setInteractive({ useHandCursor: true })
      .setDepth(9);
    this.berthZone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!isDirectCanvasPointer(pointer)) return;
      this.onBerthClick?.();
    });
  }

  private resolveActiveShipKey(): string {
    if (this.v2State) {
      const candidate = `ship.player.${this.v2State.activeShipId}`;
      return this.textures.exists(candidate) ? candidate : 'ship.player.shield_cruiser';
    }
    if (!this.currentState) return 'ship.player.cannon_skiff';
    const v2Ship = this.currentState.v2Override?.shipId;
    if (v2Ship) {
      const candidate = `ship.player.${v2Ship}`;
      return this.textures.exists(candidate) ? candidate : 'ship.player.shield_cruiser';
    }
    const isShield =
      this.currentState.progression.selectedLoadout === 'shield_cruiser' &&
      this.currentState.progression.buildings.drydock;
    return isShield ? 'ship.player.shield_cruiser' : 'ship.player.cannon_skiff';
  }

  private getActiveSettings(): GameSettings {
    return this.v2State?.settings ?? this.currentState?.settings ?? DEFAULT_SETTINGS;
  }

  private getV2Tier(id: string): number {
    if (!this.v2State) return 0;
    const raw = Math.max(0, Math.min(3, Math.floor(this.v2State.facilityTiers[id] ?? 0)));
    if (id === 'drydock') {
      const d2 = Math.floor(this.v2State.facilityTiers.drydock_tier2 ?? 0);
      return Math.max(raw, d2 >= 1 ? 2 : 0);
    }
    return raw;
  }

  private redrawStatic(): void {
    if ((!this.currentState && !this.v2State) || !this.texturesReady) return;
    if (this.v2State) {
      this.redrawV2Static();
      return;
    }
    this.redrawV1Static();
  }

  private drawSharedBackdropAndOverlays(L: ReturnType<BaseScene['getLayout']>, act?: CampaignActId, stargatePowered = false): void {
    this.bgGraphics.clear();
    this.bgGraphics.fillStyle(0x0b1320, 1);
    this.bgGraphics.fillRect(0, 0, L.w, L.h);

    // Act-aware deep-space nebula wash (V2/V3)
    if (act === 'act2') {
      this.bgGraphics.fillStyle(0x163854, 0.28);
      this.bgGraphics.fillEllipse(L.cx, L.top + L.imgH * 0.25, L.w * 0.85, L.h * 0.55);
    } else if (act === 'act3' || act === 'endless') {
      this.bgGraphics.fillStyle(0x281c4a, 0.34);
      this.bgGraphics.fillEllipse(L.cx, L.top + L.imgH * 0.24, L.w * 0.9, L.h * 0.58);
      if (stargatePowered) {
        this.bgGraphics.fillStyle(0xf6b852, 0.1);
        this.bgGraphics.fillEllipse(L.stargateRelay.x, L.stargateRelay.y - 30 * L.scale, L.w * 0.4, L.h * 0.36);
      }
    }

    for (let i = 0; i < 56; i++) {
      const sx = (((i * 137 + 29) % 1000) / 1000) * L.w;
      const sy = (((i * 89 + 41) % 1000) / 1000) * L.h;
      const sr = i % 6 === 0 ? 1.5 : 0.95;
      const sa = 0.22 + (i % 4) * 0.14;
      const starCol =
        act === 'act3' || act === 'endless'
          ? i % 5 === 0
            ? 0xf6b852
            : i % 7 === 0
            ? 0xc4b5fd
            : 0xdbe8f8
          : i % 7 === 0
          ? 0x89d6e8
          : 0xdbe8f8;
      this.bgGraphics.fillStyle(starCol, sa);
      this.bgGraphics.fillCircle(sx, sy, sr);
    }

    for (const img of [
      this.baseImage,
      this.wbOverlay,
      this.dispEmptyOverlay,
      this.dispRelicOverlay,
      this.drydockOverlay,
    ]) {
      img.setPosition(L.cx, L.cy).setScale(L.scale);
    }

    this.edgeMaskGraphics.clear();
    const steps = 16;
    if (L.left > 1) {
      const featherW = Math.min(72, L.imgW * 0.09);
      const stepW = featherW / steps;
      for (let i = 0; i < steps; i++) {
        const t = 1 - i / steps;
        const alpha = t * t;
        this.edgeMaskGraphics.fillStyle(0x0b1320, alpha);
        this.edgeMaskGraphics.fillRect(L.left - 2 + i * stepW, 0, stepW + 1, L.h);
        this.edgeMaskGraphics.fillRect(L.left + L.imgW + 2 - (i + 1) * stepW, 0, stepW + 1, L.h);
      }
    }
    if (L.top > 1) {
      const featherH = Math.min(36, L.imgH * 0.08);
      const stepH = featherH / steps;
      for (let i = 0; i < steps; i++) {
        const t = 1 - i / steps;
        const alpha = t * t;
        this.edgeMaskGraphics.fillStyle(0x0b1320, alpha);
        this.edgeMaskGraphics.fillRect(0, L.top - 2 + i * stepH, L.w, stepH + 1);
        this.edgeMaskGraphics.fillRect(0, L.top + L.imgH + 2 - (i + 1) * stepH, L.w, stepH + 1);
      }
    }
  }

  private redrawV2Static(): void {
    const st = this.v2State;
    if (!st || !this.texturesReady) return;
    const L = this.getLayout();
    const s = L.scale;

    const wbTier = this.getV2Tier('workbench');
    const hubTier = this.getV2Tier('contract_hub');
    const labTier = this.getV2Tier('research_lab');
    const dockTier = this.getV2Tier('drydock');
    const dispTier = this.getV2Tier('display');
    const relayTier = this.getV2Tier('stargate_relay');
    const stargateOn = st.stargatePowered || relayTier >= 1;
    const anyRelicRestored = st.restoredRelicIds.length > 0;

    this.drawSharedBackdropAndOverlays(L, st.campaignAct, stargateOn);

    // Same-camera quadrant WebP overlays (smooth cross-fade + scanline power-up)
    const settings = this.getActiveSettings();
    this.syncOverlayTargets(
      {
        workbench: wbTier >= 1 || labTier >= 1,
        display_empty: dispTier >= 1 && !anyRelicRestored,
        display_relic: dispTier >= 1 && anyRelicRestored,
        drydock: dockTier >= 1,
      },
      st.recentlyBuiltId ?? null,
      settings.reducedMotion
    );

    // Diegetic V2 architectural structures, T1-T3 tier lights & mooring pad
    this.v2StaticGraphics.clear();

    // A. Landing pad cradle cleanly masking painted hull so active berthed player ship shines
    this.v2StaticGraphics.fillStyle(0x0b1524, 0.88);
    this.v2StaticGraphics.fillEllipse(L.padShip.x, L.padShip.y + 4 * s, 146 * s, 64 * s);
    this.v2StaticGraphics.lineStyle(Math.max(1.5, 2.2 * s), st.activeShipId === 'stargate_cruiser' ? 0xf6b852 : 0x62d6df, 0.72);
    this.v2StaticGraphics.strokeEllipse(L.padShip.x, L.padShip.y + 4 * s, 146 * s, 64 * s);
    // Illuminated mooring clamps
    for (const dx of [-58, 58]) {
      this.v2StaticGraphics.fillStyle(0x283a50, 0.95);
      this.v2StaticGraphics.fillRoundedRect(L.padShip.x + dx * s - 8 * s, L.padShip.y - 6 * s, 16 * s, 20 * s, 3);
      this.v2StaticGraphics.fillStyle(0xf6b852, 0.9);
      this.v2StaticGraphics.fillCircle(L.padShip.x + dx * s, L.padShip.y + 4 * s, Math.max(2, 3 * s));
    }

    // B. Contract Hub (T1-T3) at L.contractHub
    if (hubTier >= 1) {
      const ch = L.contractHub;
      this.v2StaticGraphics.fillStyle(0x1b2f47, 0.95);
      this.v2StaticGraphics.fillRoundedRect(ch.x - 16 * s, ch.y - 10 * s, 32 * s, 20 * s, 4);
      this.v2StaticGraphics.lineStyle(Math.max(1.5, 2 * s), 0x62d6df, 0.88);
      this.v2StaticGraphics.lineBetween(ch.x, ch.y - 10 * s, ch.x, ch.y - (22 + hubTier * 6) * s);
      this.v2StaticGraphics.strokeCircle(ch.x, ch.y - (22 + hubTier * 6) * s, (4 + hubTier * 2) * s);
      if (hubTier >= 2) {
        this.v2StaticGraphics.lineStyle(Math.max(1.2, 1.8 * s), 0xf6b852, 0.8);
        this.v2StaticGraphics.lineBetween(ch.x + 12 * s, ch.y - 8 * s, ch.x + 18 * s, ch.y - 24 * s);
      }
    }

    // C. Research Lab (T1-T3) at L.researchLab
    if (labTier >= 1) {
      const rl = L.researchLab;
      this.v2StaticGraphics.fillStyle(0x102a42, 0.9);
      this.v2StaticGraphics.fillCircle(rl.x, rl.y, (16 + labTier * 4) * s);
      this.v2StaticGraphics.lineStyle(Math.max(1.4, 2 * s), 0x62d6df, 0.85);
      this.v2StaticGraphics.strokeCircle(rl.x, rl.y, (16 + labTier * 4) * s);
      if (labTier >= 2) {
        this.v2StaticGraphics.lineStyle(Math.max(1.2, 1.8 * s), 0x7be8ff, 0.72);
        this.v2StaticGraphics.lineBetween(rl.x + 14 * s, rl.y + 8 * s, L.workbench.x - 18 * s, L.workbench.y - 12 * s);
      }
    }

    // D. Drydock T2/T3 Heavy Trusses & Flagship Frame at L.drydock
    if (dockTier >= 2) {
      const dd = L.drydock;
      this.v2StaticGraphics.lineStyle(Math.max(1.8, 2.8 * s), dockTier >= 3 ? 0xf6b852 : 0x7b93ad, 0.85);
      this.v2StaticGraphics.strokeRoundedRect(dd.x - 42 * s, dd.y - 30 * s, 84 * s, 56 * s, 8);
      if (dockTier >= 3) {
        this.v2StaticGraphics.lineStyle(Math.max(1.4, 2 * s), 0x62d6df, 0.8);
        this.v2StaticGraphics.strokeRoundedRect(dd.x - 48 * s, dd.y - 36 * s, 96 * s, 68 * s, 10);
      }
    }

    // E. Stargate Relay Pylon / Portal Frame at L.stargateRelay
    const sg = L.stargateRelay;
    this.v2StaticGraphics.fillStyle(0x142236, 0.94);
    this.v2StaticGraphics.fillRoundedRect(sg.x - 14 * s, sg.y + 12 * s, 28 * s, 26 * s, 5);
    if (stargateOn) {
      this.v2StaticGraphics.lineStyle(Math.max(2, 3.2 * s), 0xf6b852, 0.92);
      this.v2StaticGraphics.strokeCircle(sg.x, sg.y - 4 * s, 24 * s);
      this.v2StaticGraphics.lineStyle(Math.max(1.4, 2.2 * s), 0x62d6df, 0.88);
      this.v2StaticGraphics.strokeCircle(sg.x, sg.y - 4 * s, 17 * s);
    } else {
      this.v2StaticGraphics.lineStyle(Math.max(1.4, 2 * s), 0x4b6078, 0.65);
      this.v2StaticGraphics.strokeCircle(sg.x, sg.y - 4 * s, 20 * s);
    }

    // F. Active Berthed Player Ship on landing pad (4 hulls!)
    const shipKey = this.resolveActiveShipKey();
    if (this.berthedShipSprite?.scene) {
      if (this.berthedShipSprite.texture.key !== shipKey) {
        this.berthedShipSprite.setTexture(shipKey);
      }
      const shipScale =
        st.activeShipId === 'stargate_cruiser'
          ? 0.285 * s
          : st.activeShipId === 'heavy_freighter'
          ? 0.275 * s
          : st.activeShipId === 'shield_cruiser'
          ? 0.26 * s
          : 0.245 * s;
      const shipAngle = st.activeShipId === 'heavy_freighter' ? -10 : -11;
      this.berthedShipSprite
        .setPosition(L.padShip.x, L.padShip.y - 4 * s)
        .setScale(shipScale)
        .setAngle(shipAngle)
        .setVisible(!this.dockingPlayback);
      if (st.activeShipId === 'stargate_cruiser') {
        this.berthedShipSprite.setTint(0xfff1cc);
      } else {
        this.berthedShipSprite.clearTint();
      }
    }

    if (this.berthZone?.scene) {
      this.berthZone
        .setPosition(L.padShip.x, L.padShip.y - 6 * s)
        .setSize(Math.max(110, 190 * s), Math.max(70, 110 * s))
        .setVisible(Boolean(this.onBerthClick));
    }

    // Update diegetic V2 station pins
    const bpCount = st.blueprintsCount ?? 0;
    const bpTotal = st.totalBlueprints ?? 16;
    const shipsCount = st.unlockedShipsCount ?? 1;
    const shipsTotal = st.totalShips ?? 4;
    const restorable = st.restorableRelicCount ?? 0;
    const restoredCount = st.restoredRelicIds.length;

    const pinSpecs: Record<
      BuildingId,
      { pos: { x: number; y: number }; pinY: number; text: string; accent: number; textColor: string; visible: boolean }
    > = {
      workbench: {
        pos: L.workbench,
        pinY: Math.max(18, L.pt(0.20, 0.145).y),
        text: wbTier >= 1 ? `工坊 T${wbTier} · 蓝图 ${bpCount}/${bpTotal}` : '工坊 · 首航修复',
        accent: wbTier >= 2 ? 0xf6b852 : wbTier >= 1 ? 0x62d6df : 0x5d728a,
        textColor: wbTier >= 2 ? '#F6B852' : wbTier >= 1 ? '#62D6DF' : '#D5E0EC',
        visible: true,
      },
      display: {
        pos: L.display,
        pinY: Math.max(18, L.pt(0.50, 0.045).y),
        text:
          dispTier < 1
            ? '收藏展台 · 未建'
            : restorable > 0
            ? `展台 T${dispTier} · 可修复(${restorable})`
            : restoredCount >= 4
            ? `藏品馆 T${dispTier} · 4/4 ★`
            : `藏品馆 T${dispTier} · ${restoredCount}/4`,
        accent: restorable > 0 || restoredCount >= 4 ? 0xf6b852 : dispTier >= 1 ? 0x62d6df : 0x5d728a,
        textColor: restorable > 0 || restoredCount >= 4 ? '#F6B852' : dispTier >= 1 ? '#62D6DF' : '#D5E0EC',
        visible: true,
      },
      drydock: {
        pos: L.drydock,
        pinY: Math.max(18, L.pt(0.77, 0.155).y),
        text: dockTier >= 1 ? `船坞 T${dockTier} · ${shipsCount}/${shipsTotal} 舰` : `船坞 · ${shipsCount}/${shipsTotal} 舰`,
        accent: dockTier >= 3 ? 0xf6b852 : dockTier >= 1 ? 0x62d6df : 0x5d728a,
        textColor: dockTier >= 3 ? '#F6B852' : dockTier >= 1 ? '#62D6DF' : '#D5E0EC',
        visible: true,
      },
    };

    for (const item of this.hitZones) {
      const spec = pinSpecs[item.id];
      const zoneW = Math.max(88, 220 * s);
      const zoneH = Math.max(76, 170 * s);
      item.zone.setPosition(spec.pos.x, spec.pos.y).setSize(zoneW, zoneH).setVisible(spec.visible);
      item.label.setVisible(spec.visible);
      item.badgeBg.clear();
      if (!spec.visible) continue;

      const lx = Math.max(60, Math.min(L.w - 60, spec.pos.x));
      const ly = spec.pinY;
      item.label.setText(spec.text).setColor(spec.textColor).setPosition(lx, ly);

      const bw = item.label.width + 6;
      const bh = item.label.height + 2;
      item.badgeBg.fillStyle(0x0d1726, 0.92);
      item.badgeBg.fillRoundedRect(lx - bw * 0.5, ly - bh * 0.5, bw, bh, 7);
      item.badgeBg.lineStyle(1.6, spec.accent, 0.95);
      item.badgeBg.strokeRoundedRect(lx - bw * 0.5, ly - bh * 0.5, bw, bh, 7);
    }

    // Optional 4th Stargate Relay pin (visible when built or Act 3+)
    if (this.stargatePin) {
      const showSgPin = stargateOn || st.campaignAct === 'act3' || st.campaignAct === 'endless';
      this.stargatePin.badgeBg.clear();
      this.stargatePin.zone.setPosition(sg.x, sg.y).setSize(Math.max(80, 120 * s), Math.max(70, 100 * s)).setVisible(showSgPin);
      this.stargatePin.label.setVisible(showSgPin);
      if (showSgPin) {
        const sgText = stargateOn ? `星门塔 T${Math.max(1, relayTier)} ★` : '星门塔 · 待建造';
        const sgX = Math.max(60, Math.min(L.w - 60, sg.x));
        const sgY = Math.max(20, sg.y - 36 * s);
        this.stargatePin.label.setText(sgText).setColor(stargateOn ? '#F6B852' : '#AFBDCD').setPosition(sgX, sgY);
        const bw = this.stargatePin.label.width + 6;
        const bh = this.stargatePin.label.height + 2;
        this.stargatePin.badgeBg.fillStyle(0x0d1726, 0.92);
        this.stargatePin.badgeBg.fillRoundedRect(sgX - bw * 0.5, sgY - bh * 0.5, bw, bh, 6);
        this.stargatePin.badgeBg.lineStyle(1.5, stargateOn ? 0xf6b852 : 0x5d728a, 0.95);
        this.stargatePin.badgeBg.strokeRoundedRect(sgX - bw * 0.5, sgY - bh * 0.5, bw, bh, 6);
      }
    }

    this.drawDynamicLayer();
  }

  private redrawV1Static(): void {
    if (!this.currentState || !this.texturesReady) return;
    const { progression } = this.currentState;
    const L = this.getLayout();

    this.v2StaticGraphics.clear();
    if (this.stargatePin) {
      this.stargatePin.badgeBg.clear();
      this.stargatePin.zone.setVisible(false);
      this.stargatePin.label.setVisible(false);
    }

    this.drawSharedBackdropAndOverlays(L);

    const wbBuilt = progression.buildings.workbench;
    const dispBuilt = progression.buildings.display;
    const relicSum = getRelicCollectionSummary(progression);
    const anyRelicRestored = relicSum.restoredCount > 0;
    const dockBuilt = progression.buildings.drydock;

    const settings = this.getActiveSettings();
    this.syncOverlayTargets(
      {
        workbench: wbBuilt,
        display_empty: dispBuilt && !anyRelicRestored,
        display_relic: dispBuilt && anyRelicRestored,
        drydock: dockBuilt,
      },
      this.currentState.recentlyBuiltId ?? null,
      settings.reducedMotion
    );

    if (this.berthedShipSprite?.scene) {
      this.berthedShipSprite.setVisible(false);
    }
    if (this.berthZone?.scene) {
      this.berthZone
        .setPosition(L.padShip.x, L.padShip.y - 6 * L.scale)
        .setSize(Math.max(110, 190 * L.scale), Math.max(70, 110 * L.scale))
        .setVisible(Boolean(this.onBerthClick));
    }

    const pinSpecs: Record<
      BuildingId,
      { pos: { x: number; y: number }; pinY: number; text: string; accent: number; textColor: string; visible: boolean }
    > = (() => {
      const wbCheck = canBuildFacility(progression, 'workbench');
      const dispCheck = canBuildFacility(progression, 'display');
      const dockCheck = canBuildFacility(progression, 'drydock');
      const hasRestorable = relicSum.restorableIds.length > 0;

      const v2o = this.currentState?.v2Override;
      const wbText =
        v2o?.wbText ??
        (wbBuilt ? '工作台 · 图鉴' : `修复工作台 · ${BUILDINGS.workbench.cost}¤`);
      const dispText =
        v2o?.dispText ??
        (!dispBuilt
          ? `展台 · ${BUILDINGS.display.cost}¤`
          : hasRestorable
          ? `展台 · 可修复 (${relicSum.restorableIds.length})`
          : relicSum.restoredCount >= relicSum.totalCount
          ? `藏品馆 ${relicSum.restoredCount}/${relicSum.totalCount} ★`
          : relicSum.restoredCount > 0
          ? `藏品馆 ${relicSum.restoredCount}/${relicSum.totalCount}`
          : '展台 · 待藏品');
      const dockText =
        v2o?.dockText ?? (dockBuilt ? '双泊位 ✓' : `扩建船坞 · ${BUILDINGS.drydock.cost}¤`);
      const forcePins = Boolean(v2o?.showAllPins);

      return {
        workbench: {
          pos: L.workbench,
          pinY: Math.max(18, L.pt(0.20, 0.145).y),
          text: wbText,
          accent: wbBuilt ? 0x62d6df : wbCheck.canBuild ? 0xf6b852 : 0x5d728a,
          textColor: wbBuilt ? '#62D6DF' : wbCheck.canBuild ? '#F6B852' : '#D5E0EC',
          visible: true,
        },
        display: {
          pos: L.display,
          pinY: Math.max(18, L.pt(0.50, 0.045).y),
          text: dispText,
          accent: hasRestorable
            ? 0xf6b852
            : relicSum.restoredCount >= relicSum.totalCount
            ? 0xf6b852
            : anyRelicRestored
            ? 0x62d6df
            : !dispBuilt && dispCheck.canBuild
            ? 0xf6b852
            : 0x5d728a,
          textColor: hasRestorable
            ? '#F6B852'
            : relicSum.restoredCount >= relicSum.totalCount
            ? '#F6B852'
            : anyRelicRestored
            ? '#62D6DF'
            : !dispBuilt && dispCheck.canBuild
            ? '#F6B852'
            : '#D5E0EC',
          visible: wbBuilt || forcePins,
        },
        drydock: {
          pos: L.drydock,
          pinY: Math.max(18, L.pt(0.77, 0.155).y),
          text: dockText,
          accent: dockBuilt ? 0x62d6df : dockCheck.canBuild ? 0xf6b852 : 0x5d728a,
          textColor: dockBuilt ? '#62D6DF' : dockCheck.canBuild ? '#F6B852' : '#D5E0EC',
          visible: wbBuilt || forcePins,
        },
      };
    })();

    for (const item of this.hitZones) {
      const spec = pinSpecs[item.id];
      const zoneW = Math.max(88, 220 * L.scale);
      const zoneH = Math.max(76, 170 * L.scale);
      item.zone.setPosition(spec.pos.x, spec.pos.y).setSize(zoneW, zoneH).setVisible(spec.visible);
      item.label.setVisible(spec.visible);
      item.badgeBg.clear();
      if (!spec.visible) continue;

      const lx = Math.max(56, Math.min(L.w - 56, spec.pos.x));
      const ly = spec.pinY;
      item.label.setText(spec.text).setColor(spec.textColor).setPosition(lx, ly);

      const bw = item.label.width + 6;
      const bh = item.label.height + 2;
      item.badgeBg.fillStyle(0x0d1726, 0.9);
      item.badgeBg.fillRoundedRect(lx - bw * 0.5, ly - bh * 0.5, bw, bh, 7);
      item.badgeBg.lineStyle(1.6, spec.accent, 0.95);
      item.badgeBg.strokeRoundedRect(lx - bw * 0.5, ly - bh * 0.5, bw, bh, 7);
    }

    this.drawDynamicLayer();
  }

  private syncOverlayTargets(
    targets: Record<BaseOverlayKey, boolean>,
    recentlyBuiltId: string | null,
    reducedMotion: boolean
  ): void {
    if (!this.overlayInitialized) {
      for (const key of BASE_OVERLAY_KEYS) {
        const wantOn = targets[key];
        const animateInitialBuild = !reducedMotion && wantOn && matchesRecentlyBuiltOverlay(key, recentlyBuiltId);
        this.overlayTransitions[key] = animateInitialBuild
          ? { alpha: 0, targetAlpha: 1, scanProgress: 0, poweringUp: true }
          : { alpha: wantOn ? 1 : 0, targetAlpha: wantOn ? 1 : 0, scanProgress: 1, poweringUp: false };
      }
      this.overlayInitialized = true;
      return;
    }

    for (const key of BASE_OVERLAY_KEYS) {
      const nextTarget: 0 | 1 = targets[key] ? 1 : 0;
      const prev = this.overlayTransitions[key];
      if (nextTarget === prev.targetAlpha) {
        if (reducedMotion) {
          this.overlayTransitions[key] = {
            alpha: nextTarget,
            targetAlpha: nextTarget,
            scanProgress: 1,
            poweringUp: false,
          };
        }
        continue;
      }

      if (reducedMotion) {
        this.overlayTransitions[key] = {
          alpha: nextTarget,
          targetAlpha: nextTarget,
          scanProgress: 1,
          poweringUp: false,
        };
      } else if (nextTarget === 1) {
        this.overlayTransitions[key] = {
          alpha: prev.alpha,
          targetAlpha: 1,
          scanProgress: 0,
          poweringUp: true,
        };
      } else {
        this.overlayTransitions[key] = {
          alpha: prev.alpha,
          targetAlpha: 0,
          scanProgress: 1,
          poweringUp: false,
        };
      }
    }
  }

  private applyOverlayVisuals(L: ReturnType<BaseScene['getLayout']>, settings: GameSettings): void {
    if (this.overlayScanGraphics) {
      this.overlayScanGraphics.clear();
    }

    const pairs: readonly { readonly key: BaseOverlayKey; readonly img: Phaser.GameObjects.Image }[] = [
      { key: 'workbench', img: this.wbOverlay },
      { key: 'display_empty', img: this.dispEmptyOverlay },
      { key: 'display_relic', img: this.dispRelicOverlay },
      { key: 'drydock', img: this.drydockOverlay },
    ];

    for (const { key, img } of pairs) {
      if (!img?.scene) continue;
      const st = this.overlayTransitions[key];
      const visible = st.alpha > 0.004;
      img.setVisible(visible).setAlpha(st.alpha);

      if (st.poweringUp && st.scanProgress < 1 && !settings.reducedMotion) {
        const bounds = OVERLAY_QUADRANT_BOUNDS[key];
        const ease = 1 - (1 - st.scanProgress) * (1 - st.scanProgress);
        const normScanY = bounds.ny1 - (bounds.ny1 - bounds.ny0) * ease;
        const cropTopPx = Math.max(0, Math.min(TEX_H - 1, Math.floor(normScanY * TEX_H)));
        const cropH = Math.max(1, TEX_H - cropTopPx);
        img.setCrop(0, cropTopPx, TEX_W, cropH);

        if (this.overlayScanGraphics) {
          const x0 = L.left + bounds.nx0 * L.imgW;
          const x1 = L.left + bounds.nx1 * L.imgW;
          const scanY = L.top + normScanY * L.imgH;
          const botY = L.top + bounds.ny1 * L.imgH;
          const fade = Math.sin(Math.min(1, st.scanProgress) * Math.PI);
          const w = Math.max(4, x1 - x0);
          const trailH = Math.min(28 * L.scale, Math.max(0, botY - scanY));

          if (trailH > 1) {
            this.overlayScanGraphics.fillStyle(bounds.accent, 0.16 * fade);
            this.overlayScanGraphics.fillRect(x0, scanY, w, trailH);
          }
          // Glowing scanline sweep bar
          this.overlayScanGraphics.lineStyle(Math.max(2, 3.2 * L.scale), bounds.accent, 0.88 * fade);
          this.overlayScanGraphics.lineBetween(x0, scanY, x1, scanY);
          this.overlayScanGraphics.lineStyle(Math.max(1, 1.4 * L.scale), 0xffffff, 0.78 * fade);
          this.overlayScanGraphics.lineBetween(x0, scanY, x1, scanY);

          // Subtle horizontal CRT scanlines & corner lock ticks (omitted in lowQuality)
          if (!settings.lowQuality) {
            const stepPx = Math.max(6, 10 * L.scale);
            this.overlayScanGraphics.lineStyle(1, bounds.accent, 0.14 * fade);
            for (let sy = scanY + stepPx; sy < botY; sy += stepPx) {
              this.overlayScanGraphics.lineBetween(x0 + 4, sy, x1 - 4, sy);
            }
            const tick = Math.max(6, 10 * L.scale);
            this.overlayScanGraphics.lineStyle(Math.max(1.5, 2 * L.scale), bounds.accent, 0.7 * fade);
            this.overlayScanGraphics.lineBetween(x0, scanY - tick * 0.4, x0, scanY + tick * 0.4);
            this.overlayScanGraphics.lineBetween(x1, scanY - tick * 0.4, x1, scanY + tick * 0.4);
          }
        }
      } else {
        img.setCrop();
      }
    }
  }

  private drawDynamicLayer(): void {
    this.animGraphics.clear();
    if ((!this.currentState && !this.v2State) || !this.texturesReady) return;
    const settings = this.getActiveSettings();
    const L = this.getLayout();
    const s = L.scale;
    const t = settings.reducedMotion ? 0 : this.elapsed;

    this.applyOverlayVisuals(L, settings);

    if (this.v2State) {
      this.drawV2DynamicLayer(L, s, t, settings);
      return;
    }

    const { progression } = this.currentState!;

    // 0. Subtle landing-pad mooring readiness beacon ring
    if (!this.dockingPlayback && !settings.reducedMotion) {
      const padPulse = 0.22 + 0.14 * Math.sin(t * 2.2);
      this.animGraphics.lineStyle(1.4, 0x62d6df, padPulse);
      this.animGraphics.strokeEllipse(L.padShip.x, L.padShip.y + 8 * s, 114 * s, 54 * s);
    }

    // 1. Subtle aviation beacons blinking on station corner bollards
    if (!settings.reducedMotion) {
      const blink = Math.sin(t * 3.1) > 0.35;
      if (blink) {
        const corners = [L.pt(0.068, 0.478), L.pt(0.502, 0.905), L.pt(0.935, 0.482)];
        for (const c of corners) {
          this.animGraphics.fillStyle(0xf6b852, 0.85);
          this.animGraphics.fillCircle(c.x, c.y, Math.max(2, 3.2 * s));
        }
      }
    }

    // 2. Repaired Workbench
    const wbWorking = Boolean(this.currentState?.v2Override?.workbenchWorking || this.dockingPlayback);
    if (progression.buildings.workbench) {
      this.drawWorkbenchFx(L, s, t, settings, wbWorking, 1);
    }

    // 3. Restored Museum Relics
    const relicSum = getRelicCollectionSummary(progression);
    if (progression.buildings.display && relicSum.restoredCount > 0) {
      const restoredIds = RELIC_ORDER.filter((id) => progression.relics[id]?.restored);
      this.drawRelicHalos(L, s, t, restoredIds);
    }

    // 4. Affordable facility / restorable relic pulse ring
    if (!settings.reducedMotion) {
      const pulseR = (Math.sin(t * 3.5) + 1) * 0.5;
      if (!progression.buildings.workbench && canBuildFacility(progression, 'workbench').canBuild) {
        this.animGraphics.lineStyle(2, 0xf6b852, 0.45 + pulseR * 0.4);
        this.animGraphics.strokeCircle(L.workbench.x, L.workbench.y, (32 + pulseR * 16) * s);
      }
      if (progression.buildings.display && relicSum.restorableIds.length > 0) {
        this.animGraphics.lineStyle(2, 0xf6b852, 0.45 + pulseR * 0.45);
        this.animGraphics.strokeCircle(L.display.x, L.display.y, (32 + pulseR * 16) * s);
      }
    }

    this.drawDockingAndCelebration(L, s, settings);
  }

  private drawV2DynamicLayer(
    L: ReturnType<BaseScene['getLayout']>,
    s: number,
    t: number,
    settings: GameSettings
  ): void {
    const st = this.v2State!;
    const wbTier = this.getV2Tier('workbench');
    const hubTier = this.getV2Tier('contract_hub');
    const labTier = this.getV2Tier('research_lab');
    const dockTier = this.getV2Tier('drydock');
    const dispTier = this.getV2Tier('display');
    const relayTier = this.getV2Tier('stargate_relay');
    const stargateOn = st.stargatePowered || relayTier >= 1;

    // 0. Active berthed ship gentle hover + hull-specific deck lighting
    if (this.berthedShipSprite?.scene) {
      const showBerthed = !this.dockingPlayback;
      this.berthedShipSprite.setVisible(showBerthed);
      if (showBerthed) {
        const hoverY = settings.reducedMotion ? 0 : Math.sin(t * 2.1) * 1.4 * s;
        this.berthedShipSprite.setY(L.padShip.y - 4 * s + hoverY);

        if (st.activeShipId === 'shield_cruiser') {
          const shimmer = 0.25 + 0.14 * Math.sin(t * 2.6);
          this.animGraphics.lineStyle(Math.max(1.4, 2 * s), 0x62d6df, shimmer);
          this.animGraphics.strokeEllipse(L.padShip.x + 10 * s, L.padShip.y - 4 * s, 96 * s, 44 * s);
        } else if (st.activeShipId === 'heavy_freighter') {
          this.animGraphics.fillStyle(0xf6b852, 0.28 + 0.1 * Math.sin(t * 3));
          this.animGraphics.fillCircle(L.padShip.x - 28 * s, L.padShip.y + 8 * s, 9 * s);
          this.animGraphics.fillCircle(L.padShip.x + 28 * s, L.padShip.y + 8 * s, 9 * s);
        } else if (st.activeShipId === 'stargate_cruiser') {
          const haloPulse = 1 + Math.sin(t * 2.4) * 0.05;
          this.animGraphics.lineStyle(Math.max(1.6, 2.4 * s), 0xf6b852, 0.72);
          this.animGraphics.strokeEllipse(L.padShip.x, L.padShip.y - 2 * s, 134 * s * haloPulse, 56 * s * haloPulse);
          this.animGraphics.lineStyle(Math.max(1.2, 1.8 * s), 0x62d6df, 0.56);
          this.animGraphics.strokeEllipse(L.padShip.x, L.padShip.y - 2 * s, 114 * s / haloPulse, 44 * s / haloPulse);
        } else if (!settings.reducedMotion) {
          const padPulse = 0.22 + 0.14 * Math.sin(t * 2.2);
          this.animGraphics.lineStyle(1.4, 0x62d6df, padPulse);
          this.animGraphics.strokeEllipse(L.padShip.x, L.padShip.y + 6 * s, 118 * s, 54 * s);
        }
      }
    }

    // 1. Corner aviation beacons
    if (!settings.reducedMotion) {
      const blink = Math.sin(t * 3.1) > 0.35;
      if (blink) {
        for (const c of [L.pt(0.068, 0.478), L.pt(0.502, 0.905), L.pt(0.935, 0.482)]) {
          this.animGraphics.fillStyle(0xf6b852, 0.85);
          this.animGraphics.fillCircle(c.x, c.y, Math.max(2, 3.2 * s));
        }
      }
    }

    // 2. Workbench (T1-T3)
    if (wbTier >= 1) {
      this.drawWorkbenchFx(L, s, t, settings, Boolean(st.workbenchWorking || this.dockingPlayback || wbTier >= 2), wbTier);
    }

    // 3. Research Lab (T1-T3) holo scan ring
    if (labTier >= 1 && !settings.reducedMotion) {
      const rl = L.researchLab;
      const pulse = 0.45 + 0.35 * Math.sin(t * 3.1);
      this.animGraphics.lineStyle(Math.max(1.2, 1.8 * s), 0x62d6df, pulse);
      this.animGraphics.strokeCircle(rl.x, rl.y, (10 + labTier * 5 + Math.sin(t * 2) * 3) * s);
      if (labTier >= 3) {
        this.animGraphics.lineStyle(Math.max(1.2, 1.6 * s), 0xf6b852, 0.65);
        this.animGraphics.strokeEllipse(rl.x, rl.y, 44 * s, 18 * s);
      }
    }

    // 4. Contract Hub (T1-T3) uplink wave
    if (hubTier >= 1 && !settings.reducedMotion) {
      const ch = L.contractHub;
      const topY = ch.y - (22 + hubTier * 6) * s;
      const wave = (t * 1.1) % 1;
      this.animGraphics.lineStyle(Math.max(1.2, 1.6 * s), hubTier >= 3 ? 0xf6b852 : 0x62d6df, (1 - wave) * 0.78);
      this.animGraphics.strokeCircle(ch.x, topY, (6 + wave * (14 + hubTier * 6)) * s);
    }

    // 5. Drydock (T1-T3) deck beacons
    if (dockTier >= 1 && !settings.reducedMotion) {
      const dd = L.drydock;
      const glow = 0.55 + 0.4 * Math.sin(t * 2.8);
      this.animGraphics.fillStyle(dockTier >= 3 ? 0xf6b852 : 0x62d6df, glow);
      this.animGraphics.fillCircle(dd.x - 36 * s, dd.y - 24 * s, Math.max(2.2, 3.6 * s));
      this.animGraphics.fillCircle(dd.x + 36 * s, dd.y - 24 * s, Math.max(2.2, 3.6 * s));
    }

    // 6. Restored Relics Aura (4 color-coded orbiting markers)
    if (dispTier >= 1 && st.restoredRelicIds.length > 0) {
      this.drawRelicHalos(L, s, t, st.restoredRelicIds);
    }

    // 7. Restorable relic pulse callout
    if (!settings.reducedMotion && dispTier >= 1 && (st.restorableRelicCount ?? 0) > 0) {
      const pulseR = (Math.sin(t * 3.5) + 1) * 0.5;
      this.animGraphics.lineStyle(2, 0xf6b852, 0.45 + pulseR * 0.45);
      this.animGraphics.strokeCircle(L.display.x, L.display.y, (32 + pulseR * 16) * s);
    }

    // 8. Stargate Relay illuminated portal rings & vertical beacon beam!
    if (stargateOn) {
      const sg = L.stargateRelay;
      const pulse = settings.reducedMotion ? 1 : 0.94 + 0.1 * Math.sin(t * 3.4);
      const beamW = (relayTier >= 3 ? 20 : relayTier >= 2 ? 14 : 10) * s;
      // Vertical zenith beacon beam ascending into space
      this.animGraphics.fillStyle(0x62d6df, 0.2);
      this.animGraphics.fillRect(sg.x - beamW * 0.5, 0, beamW, sg.y - 4 * s);
      this.animGraphics.fillStyle(0xf6b852, 0.34);
      this.animGraphics.fillRect(sg.x - beamW * 0.22, 0, beamW * 0.44, sg.y - 4 * s);

      // Glowing portal core + concentric stargate rings
      this.animGraphics.fillStyle(0x62d6df, 0.35);
      this.animGraphics.fillCircle(sg.x, sg.y - 4 * s, 14 * s * pulse);
      this.animGraphics.lineStyle(Math.max(1.6, 2.4 * s), 0xf6b852, 0.9);
      this.animGraphics.strokeCircle(sg.x, sg.y - 4 * s, 26 * s * pulse);
      if (relayTier >= 2) {
        this.animGraphics.lineStyle(Math.max(1.2, 1.8 * s), 0x7be8ff, 0.72);
        this.animGraphics.strokeEllipse(sg.x, sg.y - 4 * s, 64 * s * pulse, 22 * s * pulse);
        // Energy resonance arc linking Stargate Relay to Display Relic Dome
        this.animGraphics.lineStyle(Math.max(1.2, 1.8 * s), 0xf6b852, 0.42 + 0.2 * Math.sin(t * 4));
        this.animGraphics.lineBetween(sg.x - 18 * s, sg.y - 6 * s, L.displayRelic.x + 28 * s, L.displayRelic.y);
      }
    }

    this.drawDockingAndCelebration(L, s, settings);
  }

  private drawWorkbenchFx(
    L: ReturnType<BaseScene['getLayout']>,
    s: number,
    t: number,
    settings: GameSettings,
    wbWorking: boolean,
    tier: number
  ): void {
    if (wbWorking) {
      const lamp = L.pt(0.22, 0.34);
      const conePulse = settings.reducedMotion ? 0.16 : 0.13 + 0.05 * Math.sin(t * 4.2);
      this.animGraphics.fillStyle(tier >= 3 ? 0xffe49e : 0xf6b852, conePulse);
      this.animGraphics.fillTriangle(
        lamp.x,
        lamp.y,
        L.workbench.x - 58 * s,
        L.workbench.y + 42 * s,
        L.workbench.x + 54 * s,
        L.workbench.y + 34 * s
      );
      this.animGraphics.fillStyle(0x62d6df, 0.9);
      this.animGraphics.fillCircle(L.pt(0.185, 0.39).x, L.pt(0.185, 0.39).y, Math.max(2, 3 * s));
    }

    if (!settings.reducedMotion && !settings.lowQuality) {
      const sp = L.workbenchSpark;
      const pulse = 0.55 + 0.45 * Math.sin(t * 14);
      this.animGraphics.fillStyle(0xffe7a8, 0.72 * pulse);
      this.animGraphics.fillCircle(sp.x, sp.y, Math.max(2.5, 6 * s * pulse));
      for (let i = 0; i < 6; i++) {
        const phase = (t * 2.4 + i * 0.17) % 1;
        const ang = -Math.PI * 0.85 + i * 0.32;
        const dist = phase * 26 * s;
        const px = sp.x + Math.cos(ang) * dist;
        const py = sp.y + Math.sin(ang) * dist + phase * phase * 18 * s;
        this.animGraphics.fillStyle(i % 2 === 0 ? 0xf6b852 : 0xfff0c2, Math.max(0, 1 - phase));
        this.animGraphics.fillCircle(px, py, Math.max(1.2, 2.2 * s * (1 - phase * 0.5)));
      }

      const p = (Math.sin(t * 0.8) + 1) * 0.5;
      const botX = lerp(L.pt(0.36, 0.55).x, L.pt(0.62, 0.39).x, p);
      const botY = lerp(L.pt(0.36, 0.55).y, L.pt(0.62, 0.39).y, p) + Math.sin(t * 4) * 2 * s;
      this.animGraphics.fillStyle(0x060b14, 0.42);
      this.animGraphics.fillEllipse(botX, botY + 9 * s, 14 * s, 6 * s);
      this.animGraphics.fillStyle(0x88a0b8, 1);
      this.animGraphics.fillRoundedRect(botX - 7 * s, botY - 4 * s, 14 * s, 8 * s, 3);
      this.animGraphics.fillStyle(0x62d6df, 1);
      this.animGraphics.fillCircle(botX + 2 * s, botY, Math.max(1.5, 2.4 * s));
    }
  }

  private drawRelicHalos(
    L: ReturnType<BaseScene['getLayout']>,
    s: number,
    t: number,
    restoredIds: readonly string[]
  ): void {
    const rp = L.displayRelic;
    const pulse = 1 + Math.sin(t * 2.5) * 0.08;
    const isComplete = restoredIds.length >= RELIC_ORDER.length;
    this.animGraphics.lineStyle(Math.max(1.2, 2.2 * s), isComplete ? 0xf6b852 : 0x62d6df, 0.78);
    this.animGraphics.strokeCircle(rp.x, rp.y, 34 * s * pulse);
    this.animGraphics.lineStyle(Math.max(1, 1.5 * s), isComplete ? 0x62d6df : 0xf6b852, 0.58);
    this.animGraphics.strokeEllipse(rp.x, rp.y, 84 * s * pulse, 28 * s * pulse);
    if (isComplete) {
      this.animGraphics.lineStyle(Math.max(1, 1.4 * s), 0xf6b852, 0.42);
      this.animGraphics.strokeEllipse(rp.x, rp.y, 108 * s * pulse, 42 * s * pulse);
    }

    restoredIds.forEach((id, idx) => {
      const def = RELICS[id];
      const hex = Number.parseInt((def?.accentColor ?? '#62D6DF').replace('#', ''), 16);
      const ang = t * 1.15 + (idx / Math.max(1, restoredIds.length)) * Math.PI * 2;
      const ox = rp.x + Math.cos(ang) * 42 * s;
      const oy = rp.y + Math.sin(ang) * 14 * s;
      this.animGraphics.fillStyle(hex, 0.35);
      this.animGraphics.fillCircle(ox, oy, Math.max(3.5, 7 * s));
      this.animGraphics.fillStyle(hex, 0.96);
      this.animGraphics.fillCircle(ox, oy, Math.max(2, 3.6 * s));
    });
  }

  private renderArticulatedCrane(
    pose: ArticulatedCranePose,
    s: number,
    activeLoad: boolean,
    isRelicLoad: boolean
  ): void {
    const isStowed = pose.mode === 'stowed';
    const baseDark = isStowed ? 0x1e2c3d : 0x26384d;
    const boomColor = isStowed ? 0x495b70 : 0x7b93ad;
    const jibColor = isStowed ? 0x5c7086 : 0xa8bfd6;
    const accentColor = isStowed ? 0x5a6d82 : isRelicLoad ? 0x62d6df : 0xf6b852;

    const { turntable, shoulder, elbow, trolley, hook } = pose;

    // Turntable concrete/steel deck ring & bearing base (Joint 0)
    this.animGraphics.fillStyle(0x0d1726, 0.9);
    this.animGraphics.fillEllipse(turntable.x, turntable.y + 3 * s, 26 * s, 12 * s);
    this.animGraphics.fillStyle(baseDark, 1);
    this.animGraphics.fillCircle(turntable.x, turntable.y, Math.max(5, 8.5 * s));
    this.animGraphics.lineStyle(Math.max(1.4, 2 * s), accentColor, isStowed ? 0.45 : 0.85);
    this.animGraphics.strokeCircle(turntable.x, turntable.y, Math.max(5, 8.5 * s));

    // Segment 1: Turntable Pedestal Mast (turntable -> shoulder)
    this.animGraphics.lineStyle(Math.max(3.5, 6.2 * s), baseDark, 1);
    this.animGraphics.lineBetween(turntable.x, turntable.y, shoulder.x, shoulder.y);
    this.animGraphics.lineStyle(Math.max(1.8, 3.2 * s), boomColor, 0.95);
    this.animGraphics.lineBetween(turntable.x, turntable.y, shoulder.x, shoulder.y);

    // Segment 2: Lower Articulated Boom (shoulder -> elbow) + hydraulic piston strut
    this.animGraphics.lineStyle(Math.max(3.4, 6.0 * s), 0x1a2738, 0.95);
    this.animGraphics.lineBetween(shoulder.x, shoulder.y + 1.5 * s, elbow.x, elbow.y + 1.5 * s);
    this.animGraphics.lineStyle(Math.max(2.6, 4.6 * s), boomColor, 0.98);
    this.animGraphics.lineBetween(shoulder.x, shoulder.y, elbow.x, elbow.y);
    const strutMidX = lerp(shoulder.x, elbow.x, 0.45);
    const strutMidY = lerp(shoulder.y, elbow.y, 0.45);
    this.animGraphics.lineStyle(Math.max(1.4, 2.2 * s), accentColor, isStowed ? 0.35 : 0.85);
    this.animGraphics.lineBetween(turntable.x + (shoulder.x - turntable.x) * 0.4, turntable.y - 6 * s, strutMidX, strutMidY);

    // Segment 3: Upper Articulated Jib (elbow -> trolley)
    this.animGraphics.lineStyle(Math.max(2.6, 4.6 * s), 0x1a2738, 0.92);
    this.animGraphics.lineBetween(elbow.x, elbow.y + 1.2 * s, trolley.x, trolley.y + 1.2 * s);
    this.animGraphics.lineStyle(Math.max(2.0, 3.4 * s), jibColor, 0.98);
    this.animGraphics.lineBetween(elbow.x, elbow.y, trolley.x, trolley.y);

    // Segment 4: Hoist Trolley Cable & Magnetic Grapple (trolley -> hook)
    this.animGraphics.lineStyle(Math.max(1.4, 2.0 * s), 0xd5e3f2, isStowed ? 0.55 : 0.92);
    this.animGraphics.lineBetween(trolley.x, trolley.y, hook.x, hook.y);

    // Bolted pivot bearings at shoulder (Joint 1), elbow (Joint 2), and trolley pulley (Joint 3)
    this.animGraphics.fillStyle(baseDark, 1);
    this.animGraphics.fillCircle(shoulder.x, shoulder.y, Math.max(3.2, 5.2 * s));
    this.animGraphics.fillStyle(accentColor, isStowed ? 0.5 : 1);
    this.animGraphics.fillCircle(shoulder.x, shoulder.y, Math.max(1.8, 2.8 * s));

    this.animGraphics.fillStyle(baseDark, 1);
    this.animGraphics.fillCircle(elbow.x, elbow.y, Math.max(3.4, 5.5 * s));
    this.animGraphics.fillStyle(accentColor, isStowed ? 0.5 : 1);
    this.animGraphics.fillCircle(elbow.x, elbow.y, Math.max(2.0, 3.2 * s));

    this.animGraphics.fillStyle(baseDark, 1);
    this.animGraphics.fillCircle(trolley.x, trolley.y, Math.max(2.8, 4.4 * s));
    this.animGraphics.fillStyle(accentColor, isStowed ? 0.5 : 1);
    this.animGraphics.fillCircle(trolley.x, trolley.y, Math.max(1.6, 2.4 * s));

    // Twin magnetic grapple prongs at hook (Joint 4)
    const clawW = Math.max(4, 6.5 * s);
    const clawH = Math.max(3.5, 5.5 * s);
    this.animGraphics.lineStyle(Math.max(1.6, 2.4 * s), jibColor, 0.95);
    this.animGraphics.lineBetween(hook.x - clawW, hook.y + clawH, hook.x, hook.y - 1 * s);
    this.animGraphics.lineBetween(hook.x + clawW, hook.y + clawH, hook.x, hook.y - 1 * s);
    this.animGraphics.fillStyle(accentColor, activeLoad ? 0.98 : isStowed ? 0.45 : 0.85);
    this.animGraphics.fillCircle(hook.x, hook.y, Math.max(2.2, 3.6 * s));
    if (activeLoad) {
      this.animGraphics.lineStyle(Math.max(1.2, 1.8 * s), accentColor, 0.65);
      this.animGraphics.strokeCircle(hook.x, hook.y + 3 * s, Math.max(5.5, 9 * s));
    }
  }

  private drawDockingAndCelebration(
    L: ReturnType<BaseScene['getLayout']>,
    s: number,
    settings: GameSettings
  ): void {
    const craneBase = L.pt(0.34, 0.57);
    const wbActive = this.v2State
      ? this.getV2Tier('workbench') >= 1 || this.getV2Tier('research_lab') >= 1
      : Boolean(this.currentState?.progression.buildings.workbench);
    const t = settings.reducedMotion ? 0 : this.elapsed;

    if (this.dockingPlayback) {
      const p = Math.min(1, this.dockingElapsedMs / this.dockingDurationMs);
      const dockPhase = Math.min(1, p / 0.48);
      const easeOut = 1 - Math.pow(1 - dockPhase, 3);

      const shipKey = this.resolveActiveShipKey();
      if (this.arrivalShipSprite.texture.key !== shipKey) {
        this.arrivalShipSprite.setTexture(shipKey);
      }

      const curX = lerp(L.approachStart.x, L.padShip.x, easeOut);
      const curY = lerp(L.approachStart.y, L.padShip.y - 8 * s, easeOut);
      const shipScale = lerp(0.36, 0.25, easeOut) * s;

      this.arrivalShipSprite
        .setVisible(p < 0.95)
        .setPosition(curX, curY)
        .setScale(shipScale)
        .setAngle(lerp(-22, -12, easeOut))
        .setAlpha(this.dockingPlayback.wasDefeat ? 0.85 : 1);
      if (this.v2State?.activeShipId === 'stargate_cruiser') {
        this.arrivalShipSprite.setTint(0xfff1cc);
      } else {
        this.arrivalShipSprite.clearTint();
      }

      if (dockPhase < 0.94) {
        if (this.dockingPlayback.wasDefeat) {
          const tugX = curX + 46 * s;
          const tugY = curY - 18 * s;
          this.animGraphics.lineStyle(2, 0xf6b852, 0.9);
          this.animGraphics.lineBetween(curX, curY, tugX, tugY);
          this.animGraphics.fillStyle(0xf6b852, 1);
          this.animGraphics.fillRoundedRect(tugX - 10 * s, tugY - 5 * s, 20 * s, 10 * s, 3);
        } else {
          this.animGraphics.fillStyle(0x62d6df, (1 - dockPhase) * 0.78);
          this.animGraphics.fillCircle(curX - 38 * s, curY + 14 * s, Math.max(4, 14 * s * (1 - dockPhase * 0.4)));
        }
      }

      let craneTarget: CranePoint2D;
      let craneSwayX = 0;
      let activeLoad = false;
      let isRelicLoad = false;

      if (p < 0.44) {
        const approachFrac = clampVal(p / 0.44, 0, 1);
        const slewEase = approachFrac * approachFrac * (3 - 2 * approachFrac);
        const parkPt = L.pt(0.39, 0.56);
        const pickPt = L.pt(0.505, 0.695);
        craneTarget = {
          x: lerp(parkPt.x, pickPt.x, slewEase),
          y: lerp(parkPt.y, pickPt.y, slewEase),
        };
      } else if (p <= 0.96) {
        const unloadP = (p - 0.44) / 0.52;
        const crates = Math.min(5, Math.max(2, this.dockingPlayback.crateCount));
        let leadGripX: number | null = null;
        let leadGripY: number | null = null;
        let leadIsRelic = false;

        for (let i = 0; i < crates; i++) {
          const localP = Math.max(0, Math.min(1, unloadP * 1.45 - i * 0.13));
          if (localP <= 0 || localP >= 1) continue;
          const isRelicCrate = this.dockingPlayback.hasKeptRelic && i === crates - 1;
          const target = isRelicCrate ? L.display : L.workbench;
          const cx = lerp(L.padShip.x, target.x, localP);
          const cy =
            lerp(L.padShip.y - 12 * s, target.y, localP) -
            Math.sin(localP * Math.PI) * 52 * s;
          if (leadGripX === null) {
            leadGripX = cx;
            leadGripY = cy;
            leadIsRelic = isRelicCrate;
          }
          const sz = Math.max(6, 13 * s);
          this.animGraphics.fillStyle(isRelicCrate ? 0x62d6df : 0xf6b852, 1);
          this.animGraphics.lineStyle(1.6, 0x0d1726, 1);
          this.animGraphics.fillRoundedRect(cx - sz * 0.5, cy - sz * 0.5, sz, sz, 3);
          this.animGraphics.strokeRoundedRect(cx - sz * 0.5, cy - sz * 0.5, sz, sz, 3);
        }

        if (leadGripX !== null && leadGripY !== null) {
          craneTarget = { x: leadGripX, y: leadGripY - 6 * s };
          craneSwayX = settings.reducedMotion ? 0 : Math.sin(unloadP * Math.PI * 4) * 3.5 * s;
          activeLoad = true;
          isRelicLoad = leadIsRelic;
        } else {
          craneTarget = L.pt(0.39, 0.54);
        }
      } else {
        const settleFrac = clampVal((p - 0.96) / 0.04, 0, 1);
        craneTarget = {
          x: lerp(L.workbench.x, L.pt(0.39, 0.55).x, settleFrac),
          y: lerp(L.workbench.y, L.pt(0.39, 0.55).y, settleFrac),
        };
      }

      const dockingPose = solveArticulatedCranePose({
        base: craneBase,
        target: craneTarget,
        scale: s,
        cableDrop: activeLoad ? 24 * s : 28 * s,
        swayX: craneSwayX,
        mode: 'docking',
      });
      this.lastCranePose = dockingPose;
      this.renderArticulatedCrane(dockingPose, s, activeLoad, isRelicLoad);

      if (p > 0.75) {
        const ringP = (p - 0.75) / 0.25;
        this.animGraphics.lineStyle(2.5, 0xf6b852, Math.max(0, 1 - ringP));
        this.animGraphics.strokeEllipse(L.padShip.x, L.padShip.y + 8 * s, (90 + ringP * 90) * s, (45 + ringP * 45) * s);
      }
    } else {
      if (this.arrivalShipSprite) {
        this.arrivalShipSprite.setVisible(false);
      }

      // A08-code: Render 4-joint crane in idle state (stowed when worn; patrolling apron when repaired)
      if (wbActive) {
        const idleFrac = settings.reducedMotion ? 0.35 : (Math.sin(t * 0.48) + 1) * 0.5;
        const leftPt = L.pt(0.285, 0.5);
        const rightPt = L.pt(0.455, 0.625);
        const idlePose = solveArticulatedCranePose({
          base: craneBase,
          target: {
            x: lerp(leftPt.x, rightPt.x, idleFrac),
            y: lerp(leftPt.y, rightPt.y, idleFrac),
          },
          scale: s,
          cableDrop: 24 * s,
          swayX: settings.reducedMotion ? 0 : Math.cos(t * 0.96) * 1.6 * s,
          mode: 'idle',
        });
        this.lastCranePose = idlePose;
        this.renderArticulatedCrane(idlePose, s, false, false);
      } else {
        const stowedPose = solveArticulatedCranePose({
          base: craneBase,
          target: L.pt(0.365, 0.555),
          scale: s,
          cableDrop: 12 * s,
          swayX: 0,
          mode: 'stowed',
        });
        this.lastCranePose = stowedPose;
        this.renderArticulatedCrane(stowedPose, s, false, false);
      }
    }

    if (this.buildCelebrateTimer > 0 && this.celebrateFacilityKey && !settings.reducedMotion) {
      const target =
        this.celebrateFacilityKey === 'stargate_relay'
          ? L.stargateRelay
          : this.celebrateFacilityKey === 'contract_hub'
          ? L.contractHub
          : this.celebrateFacilityKey === 'research_lab'
          ? L.researchLab
          : this.celebrateFacilityKey === 'display'
          ? L.display
          : this.celebrateFacilityKey === 'drydock' || this.celebrateFacilityKey === 'drydock_tier2'
          ? L.drydock
          : L.workbench;
      const progress = 1 - this.buildCelebrateTimer / 1.6;
      const count = settings.lowQuality ? 6 : 16;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + progress * 1.1;
        const dist = (26 + progress * 92) * s;
        const px = target.x + Math.cos(a) * dist;
        const py = target.y + Math.sin(a) * dist * 0.58;
        this.animGraphics.fillStyle(i % 2 === 0 ? 0xf6b852 : 0x62d6df, Math.max(0, 1 - progress));
        this.animGraphics.fillCircle(px, py, Math.max(2, 4.5 * s));
      }
    }
  }
}

