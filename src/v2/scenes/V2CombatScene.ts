import Phaser from 'phaser';
import {
  getEnemyShipImageUrl,
  getEventBackdropImageUrl,
  getPlayerShipImageUrl,
  getSectorBgImageUrl,
} from '../../assets/itemArt';
import { getShipHardpoints } from '../../assets/manifest';
import { soundEngine } from '../../audio/soundEngine';
import type { SectorBgIndex } from '../../data/nodes';
import type { GameSettings } from '../../domain/progression';
import type { V2EnemyUnitSpec } from '../data/enemies';
import type { V2ShipId } from '../data/ships';
import type { V2CombatRoundLog, V2CombatSimulation } from '../domain/types';

export interface V2StagePlayback {
  readonly shipId: V2ShipId;
  readonly sectorIndex: SectorBgIndex;
  readonly eventBackdrop: 'wreck' | 'merchant' | 'anomaly' | 'distress' | null;
  readonly units: readonly V2EnemyUnitSpec[];
  readonly simulation: V2CombatSimulation | null;
  readonly settings: GameSettings;
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

interface PopupFx {
  textObj: Phaser.GameObjects.Text;
  vy: number;
  life: number;
  maxLife: number;
}

interface EnemyVisualEntry {
  readonly enemyId: string;
  readonly spec: V2EnemyUnitSpec;
  sprite: Phaser.GameObjects.Image;
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
 * Dedicated V2 Multi-Unit Combat & Event Stage Scene:
 * - Renders 3 player ships (Cannon Skiff, Shield Cruiser, Heavy Freighter), 6 deep-space sectors,
 *   and 4 hand-painted event backdrops (Wreck, Merchant, Anomaly, Distress).
 * - Renders 1..4 individual enemy units with individual HP/armor/pierce readouts.
 * - Distinct visual signatures for Heavy Cannon charge/slug, countable orbiting Drone Hangar units (1..4),
 *   reactive Shield Counter jagged arc lightning, and multi-target Flak shrapnel bursts.
 * - Pure presentation only: replays pre-computed deterministic V2CombatSimulation; zero rule mutation!
 */
export class V2CombatScene extends Phaser.Scene {
  private playback: V2StagePlayback | null = null;
  private bgImage: Phaser.GameObjects.Image | null = null;
  private bgGraphics!: Phaser.GameObjects.Graphics;
  private fxGraphics!: Phaser.GameObjects.Graphics;
  private playerSprite: Phaser.GameObjects.Image | null = null;
  private enemies: EnemyVisualEntry[] = [];

  private stars: { nx: number; ny: number; speed: number; r: number; a: number }[] = [];
  private beams: BeamFx[] = [];
  private rings: RingFx[] = [];
  private popups: PopupFx[] = [];

  private viewW = 390;
  private viewH = 240;
  private texturesReady = false;
  private externalPaused = false;
  private elapsed = 0;

  private playerBaseX = 95;
  private playerBaseY = 120;
  private playerRecoilX = 0;
  private playerFlashMs = 0;
  private shieldArcLife = 0;
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

  syncViewport(w: number, h: number): void {
    if (w < 16 || h < 16) return;
    this.viewW = w;
    this.viewH = h;
    if (this.cameras?.main) {
      this.cameras.main.setViewport(0, 0, w, h);
    }
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
    ];
    for (const [key, url] of queue) {
      if (!this.textures.exists(key)) {
        this.load.image(key, url);
      }
    }
  }

  create(): void {
    this.viewW = this.scale.width || 390;
    this.viewH = this.scale.height || 240;
    this.cameras.main.setViewport(0, 0, this.viewW, this.viewH);
    this.cameras.main.setBackgroundColor('#0C1524');

    this.stars = [];
    for (let i = 0; i < 36; i++) {
      this.stars.push({
        nx: ((i * 97) % 100) / 100,
        ny: ((i * 53) % 100) / 100,
        speed: 0.03 + (i % 4) * 0.025,
        r: i % 5 === 0 ? 1.5 : 1,
        a: 0.2 + (i % 4) * 0.07,
      });
    }

    this.bgImage = this.add.image(0, 0, 'bg.sector.1').setOrigin(0.5, 0.5).setDepth(0);
    this.bgGraphics = this.add.graphics().setDepth(1);
    this.fxGraphics = this.add.graphics().setDepth(7);
    this.texturesReady = true;

    this.applyPlayback();

    this.scale.on('resize', this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.texturesReady = false;
      this.clearPopups();
      this.destroyEnemySprites();
      this.scale.off('resize', this.handleResize, this);
    });
  }

  private handleResize(gameSize?: Phaser.Structs.Size): void {
    if (!this.scene.isActive()) return;
    if (gameSize && gameSize.width > 0 && gameSize.height > 0) {
      this.syncViewport(gameSize.width, gameSize.height);
    } else {
      this.syncViewport(this.scale.width || 390, this.scale.height || 240);
    }
  }

  setPlayback(playback: V2StagePlayback): void {
    this.playback = playback;
    if (this.scene.isActive() && this.texturesReady) {
      this.applyPlayback();
    }
  }

  updateSettings(settings: GameSettings): void {
    if (this.playback) {
      this.playback = { ...this.playback, settings };
    }
  }

  skipPlayback(): void {
    if (this.externalPaused) return;
    if (!this.playback?.simulation || (!this.playbackActive && !this.waitingCompletion)) return;
    const sim = this.playback.simulation;
    while (this.nextRoundIdx < sim.rounds.length) {
      const log = sim.rounds[this.nextRoundIdx];
      this.playback.onRoundStep?.(this.nextRoundIdx, log);
      this.nextRoundIdx += 1;
    }
    this.playbackActive = false;
    this.waitingCompletion = false;
    this.playback.onComplete?.();
  }

  private clearPopups(): void {
    for (const p of this.popups) p.textObj.destroy();
    this.popups = [];
  }

  private destroyEnemySprites(): void {
    for (const e of this.enemies) e.sprite.destroy();
    this.enemies = [];
  }

  private applyPlayback(): void {
    this.beams = [];
    this.rings = [];
    this.clearPopups();
    this.destroyEnemySprites();

    this.roundTimerMs = 0;
    this.nextRoundIdx = 0;
    this.waitingCompletion = false;
    this.completionDelayMs = 0;
    this.playerRecoilX = 0;
    this.playerFlashMs = 0;
    this.shieldArcLife = 0;
    this.activeDronesCount = 0;
    this.heavyChargingCount = 0;
    this.shakeTimerMs = 0;

    const pb = this.playback;
    if (!pb) return;

    // Backdrop: event scene or sector deep-space
    const bgKey = pb.eventBackdrop
      ? `event.${pb.eventBackdrop}`
      : `bg.sector.${pb.sectorIndex ?? 1}`;
    if (this.bgImage && this.textures.exists(bgKey)) {
      this.bgImage.setTexture(bgKey);
    }

    // Player ship sprite
    const pKey = `v2.ship.player.${pb.shipId}`;
    if (!this.playerSprite) {
      this.playerSprite = this.add.image(0, 0, pKey).setOrigin(0.5, 0.5).setDepth(3);
    } else if (this.textures.exists(pKey)) {
      this.playerSprite.setTexture(pKey);
    }
    this.playerSprite.setVisible(true).setAlpha(1).clearTint();

    // Enemy unit sprites (1..4)
    for (const unit of pb.units) {
      const eKey = `ship.enemy.${unit.spriteArchetype}`;
      const sprite = this.add
        .image(0, 0, this.textures.exists(eKey) ? eKey : 'ship.enemy.scout')
        .setOrigin(0.5, 0.5)
        .setDepth(unit.isBoss ? 4 : 3);
      this.enemies.push({
        enemyId: unit.enemyId,
        spec: unit,
        sprite,
        baseX: 0,
        baseY: 0,
        hp: unit.maxHp,
        maxHp: unit.maxHp,
        flashMs: 0,
        recoilX: 0,
        dead: false,
      });
    }

    this.layoutAll();

    if (pb.simulation) {
      this.playbackActive = true;
      this.roundTimerMs = 240;
      if (pb.units.some((u) => u.isBoss)) {
        soundEngine.play('bossAlarm');
      }
    } else {
      this.playbackActive = false;
    }
  }

  private layoutAll(): void {
    const w = this.viewW;
    const h = this.viewH;

    if (this.bgImage) {
      const bgScale = Math.max(w / BG_TEX_W, h / BG_TEX_H);
      this.bgImage.setPosition(w * 0.5, h * 0.5).setScale(bgScale);
    }

    const baseShipScale = Math.min((w * 0.34) / SHIP_TEX_W, (h * 0.48) / SHIP_TEX_H);
    const hasCombatUnits = this.enemies.length > 0;
    this.playerBaseX = hasCombatUnits ? w * 0.23 : w * 0.26;
    this.playerBaseY = hasCombatUnits ? h * 0.57 : h * 0.62;

    if (this.playerSprite) {
      const pScale = hasCombatUnits ? baseShipScale : baseShipScale * 0.85;
      this.playerSprite.setScale(pScale).setPosition(this.playerBaseX, this.playerBaseY);
    }

    // Layout 1..4 enemies cleanly without overlapping HUD top strip
    const n = this.enemies.length;
    if (n === 1) {
      const e = this.enemies[0];
      e.baseX = w * 0.76;
      e.baseY = h * 0.57;
      const mult = e.spec.isBoss ? 1.18 : 1.0;
      e.sprite.setScale(baseShipScale * mult).setPosition(e.baseX, e.baseY);
    } else if (n === 3) {
      // Layer 6 Elite formation: flagship center-right + 2 escort fighters flanking!
      const positions: [number, number, number][] = [
        [w * 0.8, h * 0.57, 1.12],
        [w * 0.62, h * 0.36, 0.58],
        [w * 0.62, h * 0.78, 0.58],
      ];
      this.enemies.forEach((e, idx) => {
        const [ex, ey, mult] = positions[idx] ?? [w * 0.74, h * 0.56, 0.65];
        e.baseX = ex;
        e.baseY = ey;
        e.sprite.setScale(baseShipScale * mult).setPosition(ex, ey);
      });
    } else if (n >= 4) {
      // 4-unit Swarm diamond formation
      const positions: [number, number][] = [
        [w * 0.63, h * 0.36],
        [w * 0.82, h * 0.42],
        [w * 0.63, h * 0.76],
        [w * 0.82, h * 0.72],
      ];
      this.enemies.forEach((e, idx) => {
        const [ex, ey] = positions[idx % positions.length];
        e.baseX = ex;
        e.baseY = ey;
        e.sprite.setScale(baseShipScale * 0.54).setPosition(ex, ey);
      });
    } else if (n === 2) {
      const positions: [number, number][] = [
        [w * 0.72, h * 0.40],
        [w * 0.78, h * 0.74],
      ];
      this.enemies.forEach((e, idx) => {
        const [ex, ey] = positions[idx];
        e.baseX = ex;
        e.baseY = ey;
        e.sprite.setScale(baseShipScale * 0.75).setPosition(ex, ey);
      });
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

    // Update countable drone & heavy charging telemetry
    this.activeDronesCount = Object.values(log.droneCountsByHangar).reduce((a, b) => a + b, 0);
    this.heavyChargingCount = log.heavyChargingIds.length;
    if (this.heavyChargingCount > 0) {
      soundEngine.play('chargeUp');
      this.spawnPopup(this.playerBaseX, this.playerBaseY - 34, '重炮蓄能', '#F6B852');
    }

    // Aggregate per-round build SFX (merged per round, never spammed!)
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
        if (!reduced) this.shakeTimerMs = 110;
        this.beams.push({
          x1: pMuzzle.x,
          y1: pMuzzle.y,
          x2: ePt.x,
          y2: ePt.y,
          color: 0xf6b852,
          thickness: 6,
          life: 0.36,
          maxLife: 0.36,
        });
        this.rings.push({ x: ePt.x, y: ePt.y, maxR: 34, color: 0xf6b852, life: 0.34, maxLife: 0.34 });
      } else if (atk.sourceKind === 'hangar') {
        if (!playedDrone) {
          soundEngine.play('droneLaunch');
          playedDrone = true;
        }
        // Launch from orbiting drone position ahead of ship
        this.beams.push({
          x1: this.playerBaseX + 36,
          y1: this.playerBaseY - 22 + (this.beams.length % 4) * 14,
          x2: ePt.x,
          y2: ePt.y,
          color: 0x7be8ff,
          thickness: 2,
          life: 0.25,
          maxLife: 0.25,
        });
      } else if (atk.sourceKind === 'flak') {
        if (!playedFlak) {
          soundEngine.play('laserFire');
          playedFlak = true;
        }
        this.beams.push({
          x1: pMuzzle.x,
          y1: pMuzzle.y - 6,
          x2: ePt.x,
          y2: ePt.y,
          color: 0xffd27d,
          thickness: 2.2,
          life: 0.22,
          maxLife: 0.22,
        });
        this.rings.push({ x: ePt.x, y: ePt.y, maxR: 20, color: 0xffd27d, life: 0.24, maxLife: 0.24 });
      } else {
        if (!playedLaser) {
          soundEngine.play('laserFire');
          playedLaser = true;
        }
        this.playerRecoilX = Math.min(this.playerRecoilX, -4);
        this.beams.push({
          x1: pMuzzle.x,
          y1: pMuzzle.y,
          x2: ePt.x,
          y2: ePt.y,
          color: 0x62d6df,
          thickness: 3,
          life: 0.26,
          maxLife: 0.26,
        });
      }
    }

    // Popups for enemy damage
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
      this.shieldArcLife = 0.34;
      soundEngine.play('shieldHit');
      this.spawnPopup(this.playerBaseX + 22, this.playerBaseY - 22, `盾${log.shieldAbsorbedTotal}`, '#62D6DF');
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

    // Reactive Shield Counter jagged lightning arc back to enemy!
    if (log.counterAttack) {
      const cTarget = this.enemies.find((e) => e.enemyId === log.counterAttack!.targetEnemyId);
      if (cTarget) {
        soundEngine.play('counterZap');
        const ePt = this.getSpritePoint(
          cTarget.sprite,
          getShipHardpoints(`ship.enemy.${cTarget.spec.spriteArchetype}`).hit
        );
        this.beams.push({
          x1: this.playerBaseX + 34,
          y1: this.playerBaseY,
          x2: ePt.x,
          y2: ePt.y,
          color: 0x62d6df,
          thickness: 4,
          jagged: true,
          life: 0.36,
          maxLife: 0.36,
        });
        this.rings.push({ x: ePt.x, y: ePt.y, maxR: 26, color: 0x62d6df, life: 0.3, maxLife: 0.3 });
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

    // Step combat playback
    if (pb?.simulation && !this.externalPaused) {
      const intervalMs = 950 / speed;
      if (this.playbackActive) {
        this.roundTimerMs -= delta;
        if (this.roundTimerMs <= 0) {
          if (this.nextRoundIdx < pb.simulation.rounds.length) {
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
                `修 +${pb.simulation.repairApplied}`,
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
      const mag = (this.shakeTimerMs / 110) * 3;
      this.cameras.main.setScroll((Math.random() - 0.5) * mag * 2, (Math.random() - 0.5) * mag * 2);
    } else {
      this.cameras.main.setScroll(0, 0);
    }

    // Ship subtle motion + recoil + hit flash
    const bobP = reduced ? 0 : Math.sin(this.elapsed * 2.5) * 3;
    this.playerRecoilX *= Math.pow(0.05, dt);
    if (this.playerSprite) {
      this.playerSprite.setPosition(this.playerBaseX + this.playerRecoilX, this.playerBaseY + bobP);
      if (this.playerFlashMs > 0) {
        this.playerFlashMs -= delta;
        this.playerSprite.setTintFill(0xffffff);
      } else {
        this.playerSprite.clearTint();
      }
    }

    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.dead) continue;
      e.recoilX *= Math.pow(0.05, dt);
      const bobE = reduced ? 0 : Math.cos(this.elapsed * 2.2 + i) * 3;
      e.sprite.setPosition(e.baseX + e.recoilX, e.baseY + bobE);
      if (e.flashMs > 0) {
        e.flashMs -= delta;
        e.sprite.setTintFill(0xffffff);
      } else {
        e.sprite.clearTint();
      }
    }

    // Draw starfield & subtle dark gradient readability scrim
    this.bgGraphics.clear();
    if (!lowQuality) {
      for (const st of this.stars) {
        const sx = (((st.nx - (reduced ? 0 : this.elapsed * st.speed)) % 1) + 1) % 1;
        this.bgGraphics.fillStyle(0xe9edf2, st.a);
        this.bgGraphics.fillCircle(sx * this.viewW, st.ny * this.viewH, st.r);
      }
    }

    // Draw FX: countable drone chevrons, heavy charge halo, shield arc, beams, shockwaves, unit HP mini-bars
    this.fxGraphics.clear();

    // Heavy Cannon amber charging ring (stays clear even in reducedMotion!)
    if (this.heavyChargingCount > 0 && this.playerSprite) {
      const pulse = reduced ? 0.8 : 0.5 + 0.45 * Math.sin(this.elapsed * 12);
      this.fxGraphics.lineStyle(2.5, 0xf6b852, pulse);
      this.fxGraphics.strokeCircle(this.playerBaseX + 26, this.playerBaseY, 18);
    }

    // Countable orbiting micro-drone chevrons (1..4+ physical sprites, visible in low-motion!)
    if (this.activeDronesCount > 0) {
      const shown = Math.min(8, this.activeDronesCount);
      for (let d = 0; d < shown; d++) {
        const angle = (reduced ? 0 : this.elapsed * 1.8) + (d / shown) * Math.PI * 2;
        const dx = this.playerBaseX + 34 + Math.cos(angle) * 14;
        const dy = this.playerBaseY - 26 + d * 14 + (reduced ? 0 : Math.sin(angle) * 4);
        this.fxGraphics.fillStyle(0x62d6df, 0.95);
        this.fxGraphics.fillTriangle(dx + 7, dy, dx - 5, dy - 4, dx - 5, dy + 4);
        this.fxGraphics.lineStyle(1, 0xf6b852, 0.9);
        this.fxGraphics.strokeTriangle(dx + 7, dy, dx - 5, dy - 4, dx - 5, dy + 4);
      }
    }

    // Shield deflection arc
    if (this.shieldArcLife > 0) {
      this.shieldArcLife = Math.max(0, this.shieldArcLife - dt);
      const a = Math.min(1, this.shieldArcLife / 0.34);
      this.fxGraphics.lineStyle(4, 0x62d6df, a * 0.9);
      this.fxGraphics.beginPath();
      this.fxGraphics.arc(this.playerBaseX + 24, this.playerBaseY, 34, -Math.PI * 0.42, Math.PI * 0.42);
      this.fxGraphics.strokePath();
    }

    // Unit micro HP bars under each multi-unit enemy so swarm & elite targets are immediately readable
    if (this.enemies.length > 1) {
      for (const e of this.enemies) {
        if (e.dead) continue;
        const barW = e.spec.isBoss ? 58 : 34;
        const bx = e.baseX - barW / 2;
        const by = e.baseY + (e.spec.isBoss ? 30 : 20);
        const pct = Math.max(0, Math.min(1, e.hp / e.maxHp));
        this.fxGraphics.fillStyle(0x0b121f, 0.85);
        this.fxGraphics.fillRoundedRect(bx - 1, by - 1, barW + 2, 7, 3);
        this.fxGraphics.fillStyle(e.spec.isBoss ? 0xf6b852 : 0xf27564, 0.95);
        this.fxGraphics.fillRoundedRect(bx, by, barW * pct, 5, 2);
      }
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
        this.fxGraphics.lineBetween(b.x1, b.y1, b.x2, b.y2);
        this.fxGraphics.lineStyle(Math.max(1, b.thickness * 0.4), 0xffffff, a * 0.9);
        this.fxGraphics.lineBetween(b.x1, b.y1, b.x2, b.y2);
      }
      return true;
    });

    // Expanding impact & destruction rings
    this.rings = this.rings.filter((r) => {
      r.life -= dt;
      if (r.life <= 0) return false;
      const p = 1 - r.life / r.maxLife;
      this.fxGraphics.lineStyle(2.5, r.color, (1 - p) * 0.9);
      this.fxGraphics.strokeCircle(r.x, r.y, Math.max(4, r.maxR * p));
      return true;
    });

    // Floating combat popups
    this.popups = this.popups.filter((p) => {
      p.life -= dt;
      if (p.life <= 0) {
        p.textObj.destroy();
        return false;
      }
      if (!reduced) {
        p.textObj.y += p.vy * dt;
      }
      p.textObj.setAlpha(Math.min(1, p.life / (p.maxLife * 0.45)));
      return true;
    });
  }
}
