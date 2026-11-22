import Phaser from 'phaser';
import {
  getEnemyShipImageUrl,
  getEventBackdropImageUrl,
  getPlayerShipImageUrl,
  getSectorBgImageUrl,
  getShipModuleImageUrl,
} from '../../assets/itemArt';
import { getShipHardpoints } from '../../assets/manifest';
import { soundEngine } from '../../audio/soundEngine';
import type { SectorBgIndex } from '../../data/nodes';
import type { GameSettings } from '../../domain/progression';
import type { V2EnemyUnitSpec } from '../data/enemies';
import type { V2ShipId } from '../data/ships';
import type { V2ShipVisualSpec } from '../domain/shipVisualSpec';
import type { V2CombatRoundLog, V2CombatSimulation } from '../domain/types';

export interface V2StagePlayback {
  readonly shipId: V2ShipId;
  readonly shipVisualSpec?: V2ShipVisualSpec | null;
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

interface EnemyVisualEntry {
  readonly enemyId: string;
  readonly spec: V2EnemyUnitSpec;
  sprite: Phaser.GameObjects.Image;
  intentTag?: Phaser.GameObjects.Text;
  baseX: number;
  baseY: number;
  hp: number;
  maxHp: number;
  flashMs: number;
  recoilX: number;
  dead: boolean;
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
  private bgImage: Phaser.GameObjects.Image | null = null;
  private bgGraphics!: Phaser.GameObjects.Graphics;
  private fxGraphics!: Phaser.GameObjects.Graphics;
  private playerSprite: Phaser.GameObjects.Image | null = null;
  private moduleSprites: MountedModuleEntry[] = [];
  private enemies: EnemyVisualEntry[] = [];

  private stars: { nx: number; ny: number; speed: number; r: number; a: number }[] = [];
  private beams: BeamFx[] = [];
  private rings: RingFx[] = [];
  private smokes: SmokePuff[] = [];
  private popups: PopupFx[] = [];

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
  private playerRecoilX = 0;
  private playerFlashMs = 0;
  private shieldArcLife = 0;
  private counterBackflowLife = 0;
  private activeDronesCount = 0;
  private heavyChargingCount = 0;
  private shakeTimerMs = 0;

  private roundTimerMs = 0;
  private nextRoundIdx = 0;
  private playbackActive = false;
  private waitingCompletion = false;
  private completionDelayMs = 0;

  constructor() {
    super({ key: 'V2CombatScene' });
  }

  setPaused(paused: boolean): void {
    this.externalPaused = paused;
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
    if (w < 16 || h < 16) return;
    this.viewW = w;
    this.viewH = h;
    if (dpr !== undefined) this.dpr = dpr;
    this.applyCameraViewport();
    if (this.scene.isActive() && this.texturesReady) {
      this.layoutAll();
    }
  }

  init(data?: { playback?: V2StagePlayback }): void {
    if (data?.playback) {
      this.playback = data.playback;
    }
  }

  preload(): void {
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
    this.playerSprite = null;
    this.moduleSprites = [];
    this.enemies = [];
    this.popups = [];
    this.beams = [];
    this.rings = [];
    this.smokes = [];
    this.texturesReady = true;

    this.applyPlayback();

    this.scale.on('resize', this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.texturesReady = false;
      this.playbackActive = false;
      this.waitingCompletion = false;
      this.decisionPaused = false;
      this.nextRoundIdx = 0;
      this.beams = [];
      this.rings = [];
      this.smokes = [];
      this.clearPopups();
      this.destroyModuleSprites();
      this.destroyEnemySprites();
      this.playerSprite = null;
      this.bgImage = null;
      this.scale.off('resize', this.handleResize, this);
    });
  }

  private handleResize(gameSize?: Phaser.Structs.Size): void {
    if (!this.scene.isActive()) return;
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
    this.playback = playback;
    if (this.scene.isActive() && this.texturesReady) {
      this.applyPlayback();
    }
  }

  /** Updates modular ship hardpoints immediately without resetting backdrop or idle pose */
  updateShipVisualSpec(spec: V2ShipVisualSpec | null): void {
    if (!this.playback) return;
    this.playback = { ...this.playback, shipVisualSpec: spec };
    if (this.scene.isActive() && this.texturesReady) {
      this.rebuildModuleSprites();
      this.layoutModules();
    }
  }

  updateSettings(settings: GameSettings): void {
    if (this.playback) {
      this.playback = { ...this.playback, settings };
    }
  }

  /**
   * Plays short mechanical cutting spark burst on wreck backdrop when player cuts a room open.
   */
  triggerWreckCutFx(normX: number, normY: number): void {
    if (!this.scene.isActive() || !this.texturesReady) return;
    const x = this.viewW * normX;
    const y = this.viewH * normY;
    this.rings.push({ x, y, maxR: 38, color: 0xf6b852, life: 0.36, maxLife: 0.36 });
    this.rings.push({ x, y, maxR: 22, color: 0x62d6df, life: 0.28, maxLife: 0.28 });
    soundEngine.play('place');
  }

  skipPlayback(): void {
    if (this.externalPaused || this.decisionPaused) return;
    if (!this.playback?.simulation || (!this.playbackActive && !this.waitingCompletion)) return;
    const sim = this.playback.simulation;
    const pauseAt = this.playback.pauseAtRound ?? null;

    while (this.nextRoundIdx < sim.rounds.length) {
      // Strictly respect unresolved Phase-D Elite Round-2 decision boundary!
      if (pauseAt !== null && this.nextRoundIdx + 1 === pauseAt) {
        this.playbackActive = false;
        this.decisionPaused = true;
        this.playback.onPauseForDecision?.();
        return;
      }
      const log = sim.rounds[this.nextRoundIdx];
      this.syncUnitStatesToRound(log);
      this.playback.onRoundStep?.(this.nextRoundIdx, log);
      this.nextRoundIdx += 1;
    }
    this.playbackActive = false;
    this.waitingCompletion = false;
    this.playback.onComplete?.();
  }

  private syncUnitStatesToRound(log: V2CombatRoundLog): void {
    this.activeDronesCount = Object.values(log.droneCountsByHangar).reduce((a, b) => a + b, 0);
    this.heavyChargingCount = log.heavyChargingIds.length;
    for (const snap of log.enemiesAfter) {
      const entry = this.enemies.find((e) => e.enemyId === snap.enemyId);
      if (!entry) continue;
      entry.hp = snap.hp;
      if (snap.hp <= 0) {
        entry.dead = true;
        entry.sprite.setAlpha(0.18).setTint(0x4b5563);
        entry.intentTag?.setVisible(false);
      }
    }
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
    if (!spec || !this.playerSprite || !this.playerSprite.scene) return;

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
        m.sprite.setTintFill(0xffffff);
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
    this.beams = [];
    this.rings = [];
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
    this.shieldArcLife = 0;
    this.counterBackflowLife = 0;
    this.activeDronesCount = 0;
    this.heavyChargingCount = 0;
    this.shakeTimerMs = 0;

    const pb = this.playback;
    if (!pb) return;

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

    // Player ship sprite (hide on wreck backdrop so the 3 interactive hull compartments stay unobstructed!)
    const showPlayerShip = pb.eventBackdrop !== 'wreck';
    const pKey = `v2.ship.player.${pb.shipId}`;
    if (!this.playerSprite || !this.playerSprite.scene) {
      this.playerSprite = this.add.image(0, 0, pKey).setOrigin(0.5, 0.5).setDepth(3);
    } else if (this.textures.exists(pKey)) {
      this.playerSprite.setTexture(pKey);
    }
    this.playerSprite.setVisible(showPlayerShip).setAlpha(1).clearTint();

    if (showPlayerShip) {
      this.rebuildModuleSprites();
    }

    // Enemy unit sprites (1..4) + compact tactical intent pills
    for (const unit of pb.units) {
      const eKey = `ship.enemy.${unit.spriteArchetype}`;
      const sprite = this.add
        .image(0, 0, this.textures.exists(eKey) ? eKey : 'ship.enemy.scout')
        .setOrigin(0.5, 0.5)
        .setDepth(unit.isBoss ? 4 : 3);

      const intentParts: string[] = [`攻${unit.damagePerRound}`];
      if (unit.armor > 0) intentParts.push(`甲${unit.armor}`);
      if (unit.pierceRatio > 0) intentParts.push(`穿${Math.round(unit.pierceRatio * 100)}%`);

      const intentTag = this.add
        .text(0, 0, intentParts.join(' · '), {
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: unit.isBoss ? '11px' : '10px',
          fontStyle: 'bold',
          color: unit.pierceRatio > 0 ? '#FFA3B8' : unit.armor > 0 ? '#F6B852' : '#E9EDF2',
          backgroundColor: 'rgba(11, 18, 31, 0.82)',
          padding: { left: 5, right: 5, top: 2, bottom: 2 },
          resolution: 2,
        })
        .setOrigin(0.5, 0.5)
        .setDepth(6);

      this.enemies.push({
        enemyId: unit.enemyId,
        spec: unit,
        sprite,
        intentTag,
        baseX: 0,
        baseY: 0,
        hp: unit.maxHp,
        maxHp: unit.maxHp,
        flashMs: 0,
        recoilX: 0,
        dead: false,
      });
    }

    // If resuming from Round >= 1 (e.g. after Elite Round-2 tactic choice), fast-sync Round 1 HP visuals
    if (pb.simulation && this.nextRoundIdx > 0) {
      const prevLog = pb.simulation.rounds[Math.min(this.nextRoundIdx - 1, pb.simulation.rounds.length - 1)];
      if (prevLog) {
        this.syncUnitStatesToRound(prevLog);
      }
    }

    this.layoutAll();

    if (pb.simulation) {
      this.playbackActive = true;
      this.roundTimerMs = this.nextRoundIdx > 0 ? 180 : 240;
      if (this.nextRoundIdx === 0 && pb.units.some((u) => u.isBoss)) {
        soundEngine.play('bossAlarm');
      }
    } else {
      this.playbackActive = false;
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
      const pScale = hasCombatUnits ? baseShipScale : baseShipScale * 1.15;
      this.playerSprite.setScale(pScale).setPosition(this.playerBaseX, this.playerBaseY);
      this.layoutModules();
    }

    // Layout 1..4 enemies cleanly without overlapping top/bottom HUD strips
    const n = this.enemies.length;
    if (n === 1) {
      const e = this.enemies[0];
      e.baseX = w * 0.76;
      e.baseY = h * 0.54;
      const mult = e.spec.isBoss ? 1.16 : 1.0;
      e.sprite.setScale(baseShipScale * mult).setPosition(e.baseX, e.baseY);
    } else if (n === 3) {
      const positions: [number, number, number][] = [
        [w * 0.80, h * 0.54, 1.10],
        [w * 0.62, h * 0.34, 0.56],
        [w * 0.62, h * 0.74, 0.56],
      ];
      this.enemies.forEach((e, idx) => {
        const [ex, ey, mult] = positions[idx] ?? [w * 0.74, h * 0.54, 0.65];
        e.baseX = ex;
        e.baseY = ey;
        e.sprite.setScale(baseShipScale * mult).setPosition(ex, ey);
      });
    } else if (n >= 4) {
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
    } else if (n === 2) {
      const positions: [number, number][] = [
        [w * 0.72, h * 0.38],
        [w * 0.78, h * 0.70],
      ];
      this.enemies.forEach((e, idx) => {
        const [ex, ey] = positions[idx];
        e.baseX = ex;
        e.baseY = ey;
        e.sprite.setScale(baseShipScale * 0.74).setPosition(ex, ey);
      });
    }

    for (const e of this.enemies) {
      if (e.intentTag && e.intentTag.scene) {
        const yOff = e.sprite.displayHeight * 0.52 + 10;
        e.intentTag.setPosition(e.baseX, e.baseY - yOff).setVisible(!e.dead);
      }
    }
  }

  private getSpritePoint(sprite: Phaser.GameObjects.Image, norm: { x: number; y: number }): { x: number; y: number } {
    const dw = sprite.displayWidth;
    const dh = sprite.displayHeight;
    return {
      x: sprite.x - dw * 0.5 + dw * norm.x,
      y: sprite.y - dh * 0.5 + dh * norm.y,
    };
  }

  private spawnPopup(x: number, y: number, text: string, color: string): void {
    const t = this.add
      .text(x, y, text, {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '15px',
        fontStyle: 'bold',
        color,
        stroke: '#0B121F',
        strokeThickness: 4,
        resolution: 2,
      })
      .setOrigin(0.5, 0.5)
      .setDepth(9);
    this.popups.push({ textObj: t, vy: -24, life: 0.78, maxLife: 0.78 });
  }

  private executeRoundVisual(roundIdx: number, log: V2CombatRoundLog): void {
    const pb = this.playback;
    if (!pb || !this.playerSprite) return;
    const reduced = pb.settings.reducedMotion;

    const pHp = getShipHardpoints(`ship.player.${pb.shipId}`);
    const pMuzzle = this.getSpritePoint(this.playerSprite, pHp.muzzle);
    const pHit = this.getSpritePoint(this.playerSprite, pHp.hit);
    const heavyMuzzle = this.getModuleMuzzle('heavy') ?? pMuzzle;
    const laserMuzzle = this.getModuleMuzzle('laser') ?? pMuzzle;
    const droneMuzzle = this.getModuleMuzzle('drone_bay') ?? { x: this.playerBaseX + 24, y: this.playerBaseY + 18 };
    const counterMuzzle = this.getModuleMuzzle('counter_ring') ?? { x: this.playerBaseX + 24, y: this.playerBaseY - 12 };

    // Update countable drone & heavy charging telemetry
    this.activeDronesCount = Object.values(log.droneCountsByHangar).reduce((a, b) => a + b, 0);
    this.heavyChargingCount = log.heavyChargingIds.length;
    if (this.heavyChargingCount > 0) {
      soundEngine.play('chargeUp');
      this.spawnPopup(heavyMuzzle.x - 10, heavyMuzzle.y - 20, '重炮蓄能', '#F6B852');
    }

    let playedLaser = false;
    let playedHeavy = false;
    let playedDrone = false;
    let playedFlak = false;

    const dmgByEnemy = new Map<string, number>();

    for (const atk of log.playerAttacks) {
      const target = this.enemies.find((e) => e.enemyId === atk.targetEnemyId);
      if (!target) continue;
      dmgByEnemy.set(target.enemyId, (dmgByEnemy.get(target.enemyId) ?? 0) + atk.appliedDamage);

      const eKey = `ship.enemy.${target.spec.spriteArchetype}`;
      const ePt = this.getSpritePoint(target.sprite, getShipHardpoints(eKey).hit);
      target.flashMs = 110;
      target.recoilX = 6;

      if (atk.sourceKind === 'heavy') {
        if (!playedHeavy) {
          soundEngine.play('heavyBlast');
          playedHeavy = true;
        }
        this.playerRecoilX = -10;
        const hm = this.moduleSprites.find((m) => m.kind === 'heavy');
        if (hm) hm.recoilX = -12;
        if (!reduced) this.shakeTimerMs = 120;
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
        this.rings.push({ x: ePt.x, y: ePt.y, maxR: 36, color: 0xf6b852, life: 0.36, maxLife: 0.36 });
      } else if (atk.sourceKind === 'hangar') {
        if (!playedDrone) {
          soundEngine.play('droneLaunch');
          playedDrone = true;
        }
        const laneOffset = ((this.beams.length % 4) - 1.5) * 14;
        this.beams.push({
          x1: droneMuzzle.x + 26,
          y1: this.playerBaseY + laneOffset,
          x2: ePt.x,
          y2: ePt.y,
          color: 0x7be8ff,
          thickness: 2.2,
          life: 0.25,
          maxLife: 0.25,
        });
      } else if (atk.sourceKind === 'flak') {
        if (!playedFlak) {
          soundEngine.play('laserFire');
          playedFlak = true;
        }
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
        this.rings.push({ x: ePt.x, y: ePt.y, maxR: 20, color: 0xffd27d, life: 0.24, maxLife: 0.24 });
      } else if (atk.sourceInstanceId === 'tactic_overload') {
        soundEngine.play('heavyBlast');
        this.playerRecoilX = -8;
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
        this.rings.push({ x: ePt.x, y: ePt.y, maxR: 30, color: 0xff9f43, life: 0.3, maxLife: 0.3 });
        this.spawnPopup(this.playerBaseX + 12, this.playerBaseY - 36, '火力过载！', '#FF9F43');
      } else {
        if (!playedLaser) {
          soundEngine.play('laserFire');
          playedLaser = true;
        }
        this.playerRecoilX = Math.min(this.playerRecoilX, -4);
        const lm = this.moduleSprites.find((m) => m.kind === 'laser');
        if (lm && atk.sourceKind === 'laser') lm.recoilX = -6;
        const srcPt = atk.sourceKind === 'laser' ? laserMuzzle : pMuzzle;
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

    for (const [eid, total] of dmgByEnemy.entries()) {
      const target = this.enemies.find((e) => e.enemyId === eid);
      if (target && total > 0) {
        this.spawnPopup(target.baseX, target.baseY - 22, `-${total}`, '#F6B852');
      }
    }

    // Enemy attacks -> player shield/hull
    let totalHullDmg = 0;
    let totalPierce = 0;
    for (const ea of log.enemyAttacks) {
      const src = this.enemies.find((e) => e.enemyId === ea.enemyId);
      if (src) {
        const eKey = `ship.enemy.${src.spec.spriteArchetype}`;
        const eMuz = this.getSpritePoint(src.sprite, getShipHardpoints(eKey).muzzle);
        src.recoilX = 5;
        this.beams.push({
          x1: eMuz.x,
          y1: eMuz.y,
          x2: pHit.x,
          y2: pHit.y,
          color: ea.pierceDamage > 0 ? 0xff7096 : 0xf27564,
          thickness: ea.pierceDamage > 0 ? 3.5 : 2.5,
          life: 0.26,
          maxLife: 0.26,
        });
      }
      totalHullDmg += ea.hullDamage;
      totalPierce += ea.pierceDamage;
    }

    if (log.shieldAbsorbedTotal > 0) {
      this.shieldArcLife = 0.36;
      soundEngine.play('shieldHit');
      this.spawnPopup(this.playerBaseX + 26, this.playerBaseY - 24, `盾吸 ${log.shieldAbsorbedTotal}`, '#62D6DF');
    }
    if (totalHullDmg > 0) {
      this.playerFlashMs = 110;
      if (!reduced) this.shakeTimerMs = Math.max(this.shakeTimerMs, 85);
      soundEngine.play('hullHit');
      this.spawnPopup(
        this.playerBaseX - 8,
        this.playerBaseY - 12,
        totalPierce > 0 ? `穿盾 -${totalHullDmg}` : `-${totalHullDmg}`,
        '#F27564'
      );
    }

    // Reactive Shield Counter: energy backflow into Counter Ring -> jagged cyan arc discharge!
    if (log.counterAttack) {
      const cTarget = this.enemies.find((e) => e.enemyId === log.counterAttack!.targetEnemyId);
      if (cTarget) {
        soundEngine.play('counterZap');
        this.counterBackflowLife = 0.34;
        const ePt = this.getSpritePoint(
          cTarget.sprite,
          getShipHardpoints(`ship.enemy.${cTarget.spec.spriteArchetype}`).hit
        );
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
        this.spawnPopup(cTarget.baseX, cTarget.baseY - 38, `反击 -${log.counterAttack.appliedDamage}`, '#62D6DF');
      }
    }

    // Update live enemy HP snapshots & trigger unit death shockwaves
    for (const snap of log.enemiesAfter) {
      const entry = this.enemies.find((e) => e.enemyId === snap.enemyId);
      if (!entry) continue;
      const justDied = !entry.dead && snap.hp <= 0;
      entry.hp = snap.hp;
      if (justDied) {
        entry.dead = true;
        entry.sprite.setAlpha(0.18).setTint(0x4b5563);
        entry.intentTag?.setVisible(false);
        soundEngine.play('enemyDestroy');
        this.rings.push({
          x: entry.baseX,
          y: entry.baseY,
          maxR: entry.spec.isBoss ? 64 : 36,
          color: 0xf6b852,
          life: 0.45,
          maxLife: 0.45,
        });
      }
    }

    pb.onRoundStep?.(roundIdx, log);
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta, 50) / 1000;
    const pb = this.playback;
    const reduced = pb?.settings.reducedMotion ?? false;
    const lowQuality = pb?.settings.lowQuality ?? false;
    const speed = pb?.settings.combatSpeed ?? 1;

    if (!this.externalPaused) {
      this.elapsed += dt;
    }

    // Step combat playback with Phase-D Round-2 Elite pause support
    if (pb?.simulation && !this.externalPaused && !this.decisionPaused) {
      const intervalMs = 950 / speed;
      if (this.playbackActive) {
        this.roundTimerMs -= delta;
        if (this.roundTimerMs <= 0) {
          const pauseAt = pb.pauseAtRound ?? null;
          if (pauseAt !== null && this.nextRoundIdx + 1 === pauseAt && this.nextRoundIdx < pb.simulation.rounds.length) {
            this.playbackActive = false;
            this.decisionPaused = true;
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
                '#62D6DF'
              );
            }
          }
        }
      } else if (this.waitingCompletion) {
        this.completionDelayMs -= delta;
        if (this.completionDelayMs <= 0) {
          this.waitingCompletion = false;
          pb.onComplete?.();
        }
      }
    }

    // Camera micro-shake
    if (this.shakeTimerMs > 0 && !reduced) {
      this.shakeTimerMs = Math.max(0, this.shakeTimerMs - delta);
      const mag = (this.shakeTimerMs / 120) * 3.2;
      this.cameras.main.setScroll((Math.random() - 0.5) * mag * 2, (Math.random() - 0.5) * mag * 2);
    } else {
      this.cameras.main.setScroll(0, 0);
    }

    // Ship subtle motion + recoil + modular hardpoints sync
    const bobP = reduced ? 0 : Math.sin(this.elapsed * 2.5) * 3;
    this.playerRecoilX *= Math.pow(0.05, dt);
    for (const m of this.moduleSprites) {
      m.recoilX *= Math.pow(0.04, dt);
    }
    if (this.playerSprite && this.playerSprite.scene) {
      this.playerSprite.setPosition(this.playerBaseX + this.playerRecoilX, this.playerBaseY + bobP);
      if (this.playerFlashMs > 0) {
        this.playerFlashMs -= delta;
        this.playerSprite.setTintFill(0xffffff);
      } else {
        this.playerSprite.clearTint();
      }
      this.layoutModules(bobP);
    }

    // Enemy bobbing + damaged hull state (<50% HP darkened tint + rising smoke puffs)
    this.smokeAccumMs += delta;
    const emitSmoke = !reduced && !lowQuality && this.smokeAccumMs >= 160;
    if (emitSmoke) this.smokeAccumMs = 0;

    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.dead) continue;
      e.recoilX *= Math.pow(0.05, dt);
      const bobE = reduced ? 0 : Math.cos(this.elapsed * 2.2 + i) * 3;
      e.sprite.setPosition(e.baseX + e.recoilX, e.baseY + bobE);
      if (e.intentTag && e.intentTag.scene) {
        const yOff = e.sprite.displayHeight * 0.52 + 10;
        e.intentTag.setPosition(e.baseX + e.recoilX, e.baseY + bobE - yOff);
      }
      const isDamaged = e.hp > 0 && e.hp <= e.maxHp * 0.5;
      if (e.flashMs > 0) {
        e.flashMs -= delta;
        e.sprite.setTintFill(0xffffff);
      } else if (isDamaged) {
        e.sprite.setTint(0xb6c0cf);
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

    // Starfield
    this.bgGraphics.clear();
    if (!lowQuality && pb?.eventBackdrop !== 'wreck') {
      for (const st of this.stars) {
        const sx = (((st.nx - (reduced ? 0 : this.elapsed * st.speed)) % 1) + 1) % 1;
        this.bgGraphics.fillStyle(0xe9edf2, st.a);
        this.bgGraphics.fillCircle(sx * this.viewW, st.ny * this.viewH, st.r);
      }
    }

    this.fxGraphics.clear();

    // Heavy Cannon amber charging halo directly at the mounted Heavy Railgun barrel
    if (this.heavyChargingCount > 0 && this.playerSprite) {
      const hm = this.getModuleMuzzle('heavy') ?? { x: this.playerBaseX + 26, y: this.playerBaseY - 14 };
      const pulse = reduced ? 0.8 : 0.45 + 0.5 * Math.sin(this.elapsed * 12);
      this.fxGraphics.lineStyle(2.5, 0xf6b852, pulse);
      this.fxGraphics.strokeCircle(hm.x, hm.y, 13);
      this.fxGraphics.fillStyle(0xffd27d, pulse * 0.35);
      this.fxGraphics.fillCircle(hm.x, hm.y, 7);
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

    // Localized curved hexagonal shield deflection ripple + energy backflow to counter ring
    if (this.shieldArcLife > 0) {
      this.shieldArcLife = Math.max(0, this.shieldArcLife - dt);
      const a = Math.min(1, this.shieldArcLife / 0.36);
      const sx = this.playerBaseX + 30;
      const sy = this.playerBaseY;
      this.fxGraphics.lineStyle(3.5, 0x62d6df, a * 0.92);
      this.fxGraphics.beginPath();
      this.fxGraphics.arc(sx, sy, 36, -Math.PI * 0.42, Math.PI * 0.42);
      this.fxGraphics.strokePath();
      this.fxGraphics.lineStyle(1.5, 0xb8f3ff, a * 0.65);
      this.fxGraphics.beginPath();
      this.fxGraphics.arc(sx - 4, sy, 29, -Math.PI * 0.34, Math.PI * 0.34);
      this.fxGraphics.strokePath();
    }
    if (this.counterBackflowLife > 0) {
      this.counterBackflowLife = Math.max(0, this.counterBackflowLife - dt);
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

    // Damaged hull smoke puffs
    this.smokes = this.smokes.filter((s) => {
      s.life -= dt;
      if (s.life <= 0) return false;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const a = (s.life / s.maxLife) * 0.6;
      this.fxGraphics.fillStyle(s.color, a);
      this.fxGraphics.fillCircle(s.x, s.y, s.r * (1.3 - (s.life / s.maxLife) * 0.4));
      return true;
    });

    // Enemy HP bars (shown for ALL combat enemies so battlefield stays readable without side tables!)
    for (const e of this.enemies) {
      if (e.dead) continue;
      const barW = e.spec.isBoss ? 68 : this.enemies.length === 1 ? 56 : 38;
      const bx = e.baseX - barW / 2;
      const by = e.baseY + e.sprite.displayHeight * 0.46 + 4;
      const pct = Math.max(0, Math.min(1, e.hp / e.maxHp));
      this.fxGraphics.fillStyle(0x0b121f, 0.88);
      this.fxGraphics.fillRoundedRect(bx - 1, by - 1, barW + 2, 7, 3);
      this.fxGraphics.fillStyle(e.spec.isBoss ? 0xf6b852 : 0xf27564, 0.95);
      this.fxGraphics.fillRoundedRect(bx, by, barW * pct, 5, 2);
    }

    // Beams & jagged counter lightning
    this.beams = this.beams.filter((b) => {
      b.life -= dt;
      if (b.life <= 0) return false;
      const a = Math.max(0, b.life / b.maxLife);
      this.fxGraphics.lineStyle(b.thickness, b.color, a);
      if (b.jagged) {
        const steps = 6;
        this.fxGraphics.beginPath();
        this.fxGraphics.moveTo(b.x1, b.y1);
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          const jx = b.x1 + (b.x2 - b.x1) * t;
          const jy = b.y1 + (b.y2 - b.y1) * t + (s % 2 === 0 ? -9 : 9);
          this.fxGraphics.lineTo(jx, jy);
        }
        this.fxGraphics.lineTo(b.x2, b.y2);
        this.fxGraphics.strokePath();
      } else {
        this.fxGraphics.beginPath();
        this.fxGraphics.moveTo(b.x1, b.y1);
        this.fxGraphics.lineTo(b.x2, b.y2);
        this.fxGraphics.strokePath();
      }
      return true;
    });

    // Impact rings
    this.rings = this.rings.filter((r) => {
      r.life -= dt;
      if (r.life <= 0) return false;
      const p = 1 - r.life / r.maxLife;
      const rad = 4 + r.maxR * p;
      this.fxGraphics.lineStyle(2.5, r.color, Math.max(0, 1 - p));
      this.fxGraphics.strokeCircle(r.x, r.y, rad);
      return true;
    });

    // Floating combat popups
    this.popups = this.popups.filter((p) => {
      p.life -= dt;
      if (p.life <= 0) {
        if (p.textObj?.scene) p.textObj.destroy();
        return false;
      }
      if (p.textObj?.scene) {
        p.textObj.y += p.vy * dt;
        p.textObj.setAlpha(Math.min(1, p.life / (p.maxLife * 0.45)));
      }
      return true;
    });
  }
}
