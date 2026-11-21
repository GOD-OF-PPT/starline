import Phaser from 'phaser';
import {
  getEnemyShipImageUrl,
  getPlayerShipImageUrl,
  getSectorBgImageUrl,
} from '../assets/itemArt';
import { getShipHardpoints } from '../assets/manifest';
import { soundEngine } from '../audio/soundEngine';
import type { LoadoutId } from '../data/items';
import type { EnemySpec } from '../data/nodes';
import type { CombatRoundEvent, CombatSimulationResult } from '../domain/combat';
import type { GameSettings } from '../domain/progression';

export interface CombatScenePlayback {
  readonly loadoutId: LoadoutId;
  readonly enemy: EnemySpec | null;
  readonly sectorIndex?: 1 | 2 | 3;
  readonly simulation: CombatSimulationResult | null;
  readonly settings: GameSettings;
  readonly onRoundStep?: (roundIndex: number, event: CombatRoundEvent) => void;
  readonly onComplete?: () => void;
}

interface SparkParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: number;
  size: number;
}

interface BeamEffect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: number;
  life: number;
  maxLife: number;
}

interface ShieldArcEffect {
  x: number;
  y: number;
  radius: number;
  life: number;
  maxLife: number;
}

interface ShockwaveRing {
  x: number;
  y: number;
  maxRadius: number;
  color: number;
  life: number;
  maxLife: number;
}

interface FloatingPopup {
  textObj: Phaser.GameObjects.Text;
  vy: number;
  life: number;
  maxLife: number;
}

const SHIP_TEX_W = 512;
const SHIP_TEX_H = 256;
const BG_TEX_W = 1280;
const BG_TEX_H = 720;

/**
 * Illustrated Side-View Space Combat & Flight Scene (v2.0).
 * Combines hand-painted deep-space sector backdrops & illustrated transparent ships with
 * juicy combat choreography: recoil kickback, white hit-flash, floating damage/shield/repair numbers,
 * pulsing ion thrusters, shield energy flares, breakup explosions, and deterministic simulation playback.
 */
export class CombatScene extends Phaser.Scene {
  private playback: CombatScenePlayback | null = null;
  private bgImage: Phaser.GameObjects.Image | null = null;
  private bgGraphics!: Phaser.GameObjects.Graphics;
  private fxGraphics!: Phaser.GameObjects.Graphics;
  private playerSprite: Phaser.GameObjects.Image | null = null;
  private enemySprite: Phaser.GameObjects.Image | null = null;

  private stars: { nx: number; ny: number; speed: number; r: number; a: number }[] = [];
  private sparks: SparkParticle[] = [];
  private beams: BeamEffect[] = [];
  private shieldArcs: ShieldArcEffect[] = [];
  private shockwaves: ShockwaveRing[] = [];
  private popups: FloatingPopup[] = [];

  private roundTimerMs = 0;
  private nextRoundIndex = 0;
  private playbackActive = false;
  private completionDelayMs = 0;
  private waitingCompletion = false;
  private shakeTimerMs = 0;
  private elapsed = 0;
  private externalPaused = false;
  private viewW = 390;
  private viewH = 240;
  private texturesReady = false;

  // Per-ship tactile animation offsets
  private playerBaseX = 100;
  private enemyBaseX = 290;
  private shipBaseY = 120;
  private playerRecoilX = 0;
  private enemyRecoilX = 0;
  private playerFlashMs = 0;
  private enemyFlashMs = 0;
  private entrySwoop = 0;
  private playerDamaged = false;
  private enemyDamaged = false;
  private smokeTimer = 0;

  constructor() {
    super({ key: 'CombatScene' });
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
      this.layoutSprites();
    }
  }

  init(data?: { playback?: CombatScenePlayback }): void {
    if (data?.playback) {
      this.playback = data.playback;
    }
  }

  preload(): void {
    const queue: [string, string][] = [
      ['bg.sector.1', getSectorBgImageUrl(1)],
      ['bg.sector.2', getSectorBgImageUrl(2)],
      ['bg.sector.3', getSectorBgImageUrl(3)],
      ['ship.player.cannon_skiff', getPlayerShipImageUrl('cannon_skiff')],
      ['ship.player.shield_cruiser', getPlayerShipImageUrl('shield_cruiser')],
      ['ship.enemy.scout', getEnemyShipImageUrl('scout')],
      ['ship.enemy.frigate', getEnemyShipImageUrl('frigate')],
      ['ship.enemy.hulk', getEnemyShipImageUrl('hulk')],
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
    for (let i = 0; i < 42; i++) {
      this.stars.push({
        nx: ((i * 97) % 100) / 100,
        ny: ((i * 53) % 100) / 100,
        speed: 0.04 + (i % 4) * 0.03,
        r: i % 5 === 0 ? 1.5 : 1,
        a: 0.2 + (i % 4) * 0.08,
      });
    }

    this.bgImage = this.add.image(0, 0, 'bg.sector.1').setOrigin(0.5, 0.5).setDepth(0);
    this.bgGraphics = this.add.graphics().setDepth(1);
    this.fxGraphics = this.add.graphics().setDepth(6);
    this.texturesReady = true;

    this.applyPlaybackState();

    this.scale.on('resize', this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.texturesReady = false;
      this.clearPopups();
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

  setPlayback(playback: CombatScenePlayback): void {
    this.playback = playback;
    if (this.scene.isActive() && this.texturesReady) {
      this.applyPlaybackState();
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
    while (this.nextRoundIndex < sim.rounds.length) {
      const ev = sim.rounds[this.nextRoundIndex];
      this.playback.onRoundStep?.(this.nextRoundIndex, ev);
      this.nextRoundIndex += 1;
    }
    this.playbackActive = false;
    this.waitingCompletion = false;
    this.playback.onComplete?.();
  }

  private clearPopups(): void {
    for (const p of this.popups) {
      p.textObj.destroy();
    }
    this.popups = [];
  }

  private applyPlaybackState(): void {
    this.sparks = [];
    this.beams = [];
    this.shieldArcs = [];
    this.shockwaves = [];
    this.clearPopups();
    this.roundTimerMs = 0;
    this.nextRoundIndex = 0;
    this.waitingCompletion = false;
    this.completionDelayMs = 0;
    this.shakeTimerMs = 0;
    this.playerRecoilX = 0;
    this.enemyRecoilX = 0;
    this.playerFlashMs = 0;
    this.enemyFlashMs = 0;
    this.playerDamaged = false;
    this.enemyDamaged = false;
    this.entrySwoop = this.playback?.settings.reducedMotion ? 0 : 1;

    if (this.playerSprite) {
      this.playerSprite.destroy();
      this.playerSprite = null;
    }
    if (this.enemySprite) {
      this.enemySprite.destroy();
      this.enemySprite = null;
    }

    if (!this.playback) return;

    // Pick illustrated sector backdrop matching sector depth or danger route
    const secIdx: 1 | 2 | 3 =
      this.playback.enemy?.isDanger && (this.playback.sectorIndex ?? 1) >= 2
        ? 3
        : this.playback.sectorIndex ?? 1;
    if (this.bgImage) {
      this.bgImage.setTexture(`bg.sector.${secIdx}`);
      this.bgImage.setAlpha(this.playback.enemy?.isDanger ? 0.94 : 0.88);
    }

    const playerKey = `ship.player.${this.playback.loadoutId}`;
    this.playerSprite = this.add.image(0, 0, playerKey).setOrigin(0.5, 0.5).setDepth(3);

    if (this.playback.enemy) {
      const enemyKey = `ship.enemy.${this.playback.enemy.archetype}`;
      this.enemySprite = this.add.image(0, 0, enemyKey).setOrigin(0.5, 0.5).setDepth(3);
      if (this.playback.enemy.isDanger) {
        // Subtle warm crimson elite glaze for danger-route variants
        this.enemySprite.setTint(0xffcfc8);
      }
    }

    this.layoutSprites();

    if (this.playback.simulation) {
      this.playbackActive = true;
      const roundDuration = this.playback.settings.combatSpeed === 2 ? 500 : 950;
      this.roundTimerMs = Math.max(0, roundDuration - 320);
    } else {
      this.playbackActive = false;
    }
  }

  private layoutSprites(): void {
    const w = this.viewW || this.scale.width || 390;
    const h = this.viewH || this.scale.height || 240;

    if (this.bgImage) {
      const bgScale = Math.max(w / BG_TEX_W, h / BG_TEX_H) * 1.06;
      this.bgImage.setPosition(w * 0.5, h * 0.5).setScale(bgScale);
    }

    const shipScale = Math.min((w * 0.41) / SHIP_TEX_W, (h * 0.62) / SHIP_TEX_H);
    this.shipBaseY = this.playback?.simulation ? h * 0.62 : h * 0.56;
    this.playerBaseX = this.enemySprite ? w * 0.25 : w * 0.5;
    this.enemyBaseX = w * 0.75;

    if (this.playerSprite) {
      this.playerSprite.setPosition(this.playerBaseX, this.shipBaseY).setScale(shipScale);
    }
    if (this.enemySprite) {
      const bossBoost = this.playback?.enemy?.archetype === 'hulk' ? 1.12 : 1.0;
      this.enemySprite.setPosition(this.enemyBaseX, this.shipBaseY).setScale(shipScale * bossBoost);
    }
  }

  private getSpritePoint(sprite: Phaser.GameObjects.Image, norm: { x: number; y: number }) {
    const left = sprite.x - sprite.displayWidth * 0.5;
    const top = sprite.y - sprite.displayHeight * 0.5;
    return {
      x: left + sprite.displayWidth * norm.x,
      y: top + sprite.displayHeight * norm.y,
    };
  }

  private spawnPopup(x: number, y: number, label: string, color: string): void {
    const txt = this.add
      .text(x, y, label, {
        fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
        fontSize: '18px',
        fontStyle: 'bold',
        color,
        stroke: '#0B1320',
        strokeThickness: 4,
      })
      .setOrigin(0.5, 0.5)
      .setDepth(8);
    this.popups.push({
      textObj: txt,
      vy: -42,
      life: 0.72,
      maxLife: 0.72,
    });
  }

  update(_time: number, delta: number): void {
    if (typeof document !== 'undefined' && document.hidden) return;
    if (this.externalPaused || !this.texturesReady) return;

    const dtMs = Math.min(delta, 50);
    const dt = dtMs / 1000;
    this.elapsed += dt;

    const settings = this.playback?.settings;
    const reduced = Boolean(settings?.reducedMotion);
    const lowQ = Boolean(settings?.lowQuality);
    const w = this.viewW || this.scale.width || 390;
    const h = this.viewH || this.scale.height || 240;

    // 1. Subtle star drift & gentle backdrop parallax
    if (this.bgImage && !reduced && !lowQ) {
      this.bgImage.x = w * 0.5 + Math.sin(this.elapsed * 0.25) * 10;
    }

    this.bgGraphics.clear();
    // Subtle dark vignette edge so center combat ships pop crisply
    this.bgGraphics.fillStyle(0x0a1220, 0.22);
    this.bgGraphics.fillRect(0, 0, w, h);

    for (const st of this.stars) {
      if (!reduced) {
        st.nx -= st.speed * dt;
        if (st.nx < 0) st.nx += 1;
      }
      this.bgGraphics.fillStyle(0xdbe8f8, st.a);
      this.bgGraphics.fillCircle(st.nx * w, st.ny * h, st.r);
    }

    // 2. Smooth spring physics for entry swoop, recoil kickback, and idle hover
    if (this.entrySwoop > 0) {
      this.entrySwoop = Math.max(0, this.entrySwoop - dt * 2.8);
    }
    this.playerRecoilX *= Math.pow(0.001, dt);
    this.enemyRecoilX *= Math.pow(0.001, dt);

    const swoopOffset = this.entrySwoop * this.entrySwoop * -w * 0.25;
    if (this.playerSprite) {
      this.playerSprite.x = this.playerBaseX + this.playerRecoilX + swoopOffset;
      this.playerSprite.y = this.shipBaseY + (reduced ? 0 : Math.sin(this.elapsed * 2.4) * 3.0);
    }
    if (this.enemySprite) {
      this.enemySprite.x = this.enemyBaseX + this.enemyRecoilX;
      this.enemySprite.y = this.shipBaseY + (reduced ? 0 : Math.cos(this.elapsed * 2.1) * 3.0);
    }

    // Hit flash decay
    if (this.playerFlashMs > 0) {
      this.playerFlashMs -= dtMs;
      if (this.playerFlashMs <= 0 && this.playerSprite) {
        this.playerSprite.clearTint();
      }
    }
    if (this.enemyFlashMs > 0) {
      this.enemyFlashMs -= dtMs;
      if (this.enemyFlashMs <= 0 && this.enemySprite) {
        if (this.playback?.enemy?.isDanger) this.enemySprite.setTint(0xffcfc8);
        else this.enemySprite.clearTint();
      }
    }

    // Periodic damage sparks on ships below 50% HP
    if (!lowQ && !reduced && this.playbackActive) {
      this.smokeTimer += dt;
      if (this.smokeTimer >= 0.16) {
        this.smokeTimer = 0;
        if (this.playerDamaged && this.playerSprite && this.playerSprite.alpha > 0.5) {
          this.spawnSparks(this.playerSprite.x, this.playerSprite.y, 2, 0xf6b852);
        }
        if (this.enemyDamaged && this.enemySprite && this.enemySprite.alpha > 0.5) {
          this.spawnSparks(this.enemySprite.x, this.enemySprite.y, 2, 0xf27564);
        }
      }
    }

    // 3. Advance deterministic combat rounds
    if (this.playbackActive && this.playback?.simulation) {
      const roundDuration = this.playback.settings.combatSpeed === 2 ? 500 : 950;
      this.roundTimerMs += dtMs;
      if (this.roundTimerMs >= roundDuration) {
        this.roundTimerMs -= roundDuration;
        const sim = this.playback.simulation;
        if (this.nextRoundIndex < sim.rounds.length) {
          const ev = sim.rounds[this.nextRoundIndex];
          this.playRoundFx(ev);
          this.playback.onRoundStep?.(this.nextRoundIndex, ev);
          this.nextRoundIndex += 1;
        }
        if (this.nextRoundIndex >= sim.rounds.length) {
          // Post-victory drone repair visual popup!
          if (sim.outcome === 'victory' && sim.repairApplied > 0 && this.playerSprite) {
            soundEngine.play('repairPulse');
            this.spawnPopup(
              this.playerSprite.x,
              this.playerSprite.y - this.playerSprite.displayHeight * 0.45,
              `修 +${sim.repairApplied}`,
              '#62D6DF'
            );
          }
          this.playbackActive = false;
          this.waitingCompletion = true;
          this.completionDelayMs = this.playback.settings.combatSpeed === 2 ? 380 : 620;
        }
      }
    } else if (this.waitingCompletion) {
      this.completionDelayMs -= dtMs;
      if (this.completionDelayMs <= 0) {
        this.waitingCompletion = false;
        this.playback?.onComplete?.();
      }
    }

    // 4. World-only micro-shake (<= 3.5 CSS px, <= 120ms, disabled in reducedMotion)
    if (this.shakeTimerMs > 0 && !reduced) {
      this.shakeTimerMs = Math.max(0, this.shakeTimerMs - dtMs);
      const amp = (this.shakeTimerMs / 120) * 3.2;
      this.cameras.main.setScroll((Math.random() - 0.5) * amp * 2, (Math.random() - 0.5) * amp * 2);
    } else {
      this.cameras.main.setScroll(0, 0);
    }

    // 5. Render dynamic thruster glow + beams + shield arcs + shockwaves + sparks
    this.fxGraphics.clear();

    // Animated pulsing ion thruster plumes behind live ships
    if (!reduced) {
      const flicker = 0.78 + Math.sin(this.elapsed * 24) * 0.22;
      if (this.playerSprite && this.playerSprite.alpha > 0.5) {
        const pHp = getShipHardpoints(this.playerSprite.texture.key);
        const eng = this.getSpritePoint(this.playerSprite, pHp.engine);
        const len = Math.max(12, this.playerSprite.displayWidth * 0.14) * flicker;
        const rad = Math.max(5, this.playerSprite.displayHeight * 0.13);
        this.fxGraphics.fillStyle(0x62d6df, 0.42 * flicker);
        this.fxGraphics.fillTriangle(eng.x, eng.y - rad, eng.x, eng.y + rad, eng.x - len, eng.y);
        this.fxGraphics.fillStyle(0xe8fdff, 0.85 * flicker);
        this.fxGraphics.fillTriangle(eng.x, eng.y - rad * 0.45, eng.x, eng.y + rad * 0.45, eng.x - len * 0.55, eng.y);
      }
      if (this.enemySprite && this.enemySprite.alpha > 0.5) {
        const eHp = getShipHardpoints(this.enemySprite.texture.key);
        const eng = this.getSpritePoint(this.enemySprite, eHp.engine);
        const len = Math.max(12, this.enemySprite.displayWidth * 0.13) * flicker;
        const rad = Math.max(5, this.enemySprite.displayHeight * 0.12);
        const isDanger = Boolean(this.playback?.enemy?.isDanger);
        this.fxGraphics.fillStyle(isDanger ? 0xf27564 : 0xf6b852, 0.44 * flicker);
        this.fxGraphics.fillTriangle(eng.x, eng.y - rad, eng.x, eng.y + rad, eng.x + len, eng.y);
      }
    }

    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.life -= dt;
      if (b.life <= 0) {
        this.beams.splice(i, 1);
        continue;
      }
      const alpha = Math.max(0, b.life / b.maxLife);
      const expand = 1 - alpha;
      // Muzzle emitter burst
      this.fxGraphics.fillStyle(b.color, alpha * 0.8);
      this.fxGraphics.fillCircle(b.x1, b.y1, 7 * alpha + 2);
      // Impact shock ring
      this.fxGraphics.lineStyle(2.4, b.color, alpha * 0.88);
      this.fxGraphics.strokeCircle(b.x2, b.y2, 6 + expand * 18);
      // Outer plasma glow + bright core laser
      this.fxGraphics.lineStyle(8, b.color, alpha * 0.34);
      this.fxGraphics.lineBetween(b.x1, b.y1, b.x2, b.y2);
      this.fxGraphics.lineStyle(3.2, 0xf2fbff, alpha);
      this.fxGraphics.lineBetween(b.x1, b.y1, b.x2, b.y2);
    }

    for (let i = this.shieldArcs.length - 1; i >= 0; i--) {
      const a = this.shieldArcs[i];
      a.life -= dt;
      if (a.life <= 0) {
        this.shieldArcs.splice(i, 1);
        continue;
      }
      const alpha = Math.max(0, a.life / a.maxLife);
      this.fxGraphics.lineStyle(5, 0x62d6df, alpha * 0.88);
      this.fxGraphics.beginPath();
      this.fxGraphics.arc(a.x, a.y, a.radius, -0.88, 0.88);
      this.fxGraphics.strokePath();
      this.fxGraphics.lineStyle(2, 0xe8fdff, alpha * 0.78);
      this.fxGraphics.beginPath();
      this.fxGraphics.arc(a.x, a.y, a.radius - 4, -0.72, 0.72);
      this.fxGraphics.strokePath();
    }

    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.life -= dt;
      if (sw.life <= 0) {
        this.shockwaves.splice(i, 1);
        continue;
      }
      const p = 1 - sw.life / sw.maxLife;
      const alpha = Math.max(0, 1 - p);
      this.fxGraphics.lineStyle(3.5 * alpha + 1, sw.color, alpha * 0.9);
      this.fxGraphics.strokeCircle(sw.x, sw.y, sw.maxRadius * p);
    }

    if (!lowQ && !reduced) {
      for (let i = this.sparks.length - 1; i >= 0; i--) {
        const p = this.sparks[i];
        p.life -= dt;
        if (p.life <= 0) {
          this.sparks.splice(i, 1);
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        this.fxGraphics.fillStyle(p.color, Math.max(0, p.life / p.maxLife));
        this.fxGraphics.fillCircle(p.x, p.y, p.size);
      }
    }

    // Update floating damage / shield / repair popups
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const pop = this.popups[i];
      pop.life -= dt;
      if (pop.life <= 0) {
        pop.textObj.destroy();
        this.popups.splice(i, 1);
        continue;
      }
      const tNorm = 1 - pop.life / pop.maxLife;
      pop.textObj.y += pop.vy * dt * (1 - tNorm * 0.45);
      pop.textObj.setAlpha(tNorm > 0.65 ? Math.max(0, (1 - tNorm) / 0.35) : 1);
      const popScale = tNorm < 0.15 ? 0.8 + (tNorm / 0.15) * 0.35 : 1.0;
      pop.textObj.setScale(popScale);
    }
  }

  private playRoundFx(ev: CombatRoundEvent): void {
    if (!this.playback || !this.playerSprite || !this.enemySprite) return;
    const reduced = this.playback.settings.reducedMotion;
    const playerHp = getShipHardpoints(this.playerSprite.texture.key);
    const enemyHp = getShipHardpoints(this.enemySprite.texture.key);

    const pMuzzle = this.getSpritePoint(this.playerSprite, playerHp.muzzle);
    const pHit = this.getSpritePoint(this.playerSprite, playerHp.hit);
    const pShield = this.getSpritePoint(this.playerSprite, playerHp.shieldCenter);
    const eMuzzle = this.getSpritePoint(this.enemySprite, enemyHp.muzzle);
    const eHit = this.getSpritePoint(this.enemySprite, enemyHp.hit);

    // Recoil kickback & hit flash
    if (!reduced) {
      this.playerRecoilX = -10;
      this.enemyRecoilX = 10;
      this.enemySprite.setTintFill(0xffffff);
      this.enemyFlashMs = 75;
      if (ev.hpLoss > 0) {
        this.playerSprite.setTintFill(0xffffff);
        this.playerFlashMs = 75;
      }
    }

    // Player laser beam -> enemy
    this.beams.push({
      x1: pMuzzle.x,
      y1: pMuzzle.y,
      x2: eHit.x,
      y2: eHit.y,
      color: 0x62d6df,
      life: 0.24,
      maxLife: 0.24,
    });
    soundEngine.play('laserFire');

    // Floating enemy damage popup!
    const eDmg = ev.playerDamageDealt;
    this.spawnPopup(
      eHit.x + (Math.random() - 0.5) * 14,
      eHit.y - this.enemySprite.displayHeight * 0.32,
      `-${eDmg}`,
      '#F6B852'
    );

    // Enemy plasma bolt -> player
    this.beams.push({
      x1: eMuzzle.x,
      y1: eMuzzle.y,
      x2: pHit.x,
      y2: pHit.y,
      color: 0xf27564,
      life: 0.24,
      maxLife: 0.24,
    });

    if (ev.shieldAbsorbed > 0) {
      this.shieldArcs.push({
        x: pShield.x,
        y: pShield.y,
        radius: Math.max(28, this.playerSprite.displayWidth * 0.34),
        life: 0.24,
        maxLife: 0.24,
      });
      this.spawnPopup(
        pShield.x + 12,
        pShield.y - this.playerSprite.displayHeight * 0.35,
        `盾${ev.shieldAbsorbed}`,
        '#62D6DF'
      );
      soundEngine.play('shieldHit');
    }
    if (ev.hpLoss > 0) {
      soundEngine.play('hullHit');
      this.shakeTimerMs = 115;
      this.spawnPopup(
        pHit.x - 10,
        pHit.y - this.playerSprite.displayHeight * 0.28,
        `-${ev.hpLoss}`,
        '#F27564'
      );
    }

    this.enemyDamaged = ev.enemyHpAfter > 0 && ev.enemyHpAfter <= (this.playback.simulation?.startingEnemyHp ?? 12) * 0.5;
    this.playerDamaged = ev.playerHpAfter > 0 && ev.playerHpAfter <= 15;

    if (!this.playback.settings.lowQuality && !reduced) {
      this.spawnSparks(eHit.x, eHit.y, ev.enemyHpAfter <= 0 ? 22 : 10, 0xf6b852);
      this.spawnSparks(pHit.x, pHit.y, ev.hpLoss > 0 ? 10 : 6, ev.hpLoss > 0 ? 0xf27564 : 0x62d6df);
    }

    // Dramatic breakup shockwave when enemy or player is destroyed!
    if (ev.enemyHpAfter <= 0 && this.enemySprite) {
      soundEngine.play('enemyDestroy');
      this.shakeTimerMs = 120;
      this.shockwaves.push({
        x: eHit.x,
        y: eHit.y,
        maxRadius: Math.max(54, this.enemySprite.displayWidth * 0.55),
        color: 0xf6b852,
        life: 0.42,
        maxLife: 0.42,
      });
      this.shockwaves.push({
        x: eHit.x,
        y: eHit.y,
        maxRadius: Math.max(36, this.enemySprite.displayWidth * 0.36),
        color: 0xfff0c2,
        life: 0.28,
        maxLife: 0.28,
      });
      this.enemySprite.setAlpha(0.18);
    }
    if (ev.playerHpAfter <= 0 && this.playerSprite) {
      soundEngine.play('enemyDestroy');
      this.shockwaves.push({
        x: pHit.x,
        y: pHit.y,
        maxRadius: Math.max(52, this.playerSprite.displayWidth * 0.52),
        color: 0xf27564,
        life: 0.42,
        maxLife: 0.42,
      });
      this.playerSprite.setAlpha(0.22);
    }
  }

  private spawnSparks(x: number, y: number, count: number, color: number): void {
    const budget = Math.min(count, 24, Math.max(0, 100 - this.sparks.length));
    for (let i = 0; i < budget; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 40 + Math.random() * 115;
      const life = 0.24 + Math.random() * 0.24;
      this.sparks.push({
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        life,
        maxLife: life,
        color,
        size: 1.8 + Math.random() * 2.4,
      });
    }
  }
}
