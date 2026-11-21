import Phaser from 'phaser';
import { getShipHardpoints } from '../assets/manifest';
import { registerCombatShipTextures } from '../assets/sceneArt';
import { soundEngine } from '../audio/soundEngine';
import type { LoadoutId } from '../data/items';
import type { EnemySpec } from '../data/nodes';
import type { CombatRoundEvent, CombatSimulationResult } from '../domain/combat';
import type { GameSettings } from '../domain/progression';

export interface CombatScenePlayback {
  readonly loadoutId: LoadoutId;
  readonly enemy: EnemySpec | null; // null during ARRANGE/REWARD -> shows calm player ship
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

/**
 * Orthogonal side-view Combat & Flight Scene (Art Spec §3 & §10).
 * - Consumes pre-computed CombatSimulationResult without altering outcomes.
 * - Supports 1x (1000ms/round) and 2x (500ms/round) speed, Reduced Motion, and Low Quality.
 * - Automatically pauses on tab backgrounding (visibilitychange).
 * - World-only micro-shake <= 3px, <= 120ms (never shakes HUD or cargo bay).
 */
export class CombatScene extends Phaser.Scene {
  private playback: CombatScenePlayback | null = null;
  private bgGraphics!: Phaser.GameObjects.Graphics;
  private fxGraphics!: Phaser.GameObjects.Graphics;
  private playerSprite: Phaser.GameObjects.Image | null = null;
  private enemySprite: Phaser.GameObjects.Image | null = null;

  private stars: { nx: number; ny: number; speed: number; r: number; a: number }[] = [];
  private sparks: SparkParticle[] = [];
  private beams: BeamEffect[] = [];
  private shieldArcs: ShieldArcEffect[] = [];

  private roundTimerMs = 0;
  private nextRoundIndex = 0;
  private playbackActive = false;
  private completionDelayMs = 0;
  private waitingCompletion = false;
  private shakeTimerMs = 0;
  private elapsed = 0;
  private externalPaused = false;
  private viewW = 390;
  private viewH = 180;

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
    if (this.scene.isActive()) {
      this.layoutSprites();
    }
  }

  init(data?: { playback?: CombatScenePlayback }): void {
    if (data?.playback) {
      this.playback = data.playback;
    }
  }

  create(): void {
    this.viewW = this.scale.width || 390;
    this.viewH = this.scale.height || 180;
    this.cameras.main.setViewport(0, 0, this.viewW, this.viewH);
    this.cameras.main.setBackgroundColor('#111A29');
    registerCombatShipTextures(this);

    this.stars = [];
    for (let i = 0; i < 36; i++) {
      this.stars.push({
        nx: ((i * 97) % 100) / 100,
        ny: ((i * 53) % 100) / 100,
        speed: 0.03 + (i % 4) * 0.02,
        r: i % 6 === 0 ? 1.5 : 1,
        a: 0.18 + (i % 4) * 0.08,
      });
    }

    this.bgGraphics = this.add.graphics().setDepth(1);
    this.fxGraphics = this.add.graphics().setDepth(5);

    this.applyPlaybackState();

    this.scale.on('resize', this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.handleResize, this);
    });
  }

  private handleResize(gameSize?: Phaser.Structs.Size): void {
    if (!this.scene.isActive()) return;
    if (gameSize && gameSize.width > 0 && gameSize.height > 0) {
      this.syncViewport(gameSize.width, gameSize.height);
    } else {
      this.syncViewport(this.scale.width || 390, this.scale.height || 180);
    }
  }

  setPlayback(playback: CombatScenePlayback): void {
    this.playback = playback;
    if (this.scene.isActive()) {
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

  private applyPlaybackState(): void {
    this.sparks = [];
    this.beams = [];
    this.shieldArcs = [];
    this.roundTimerMs = 0;
    this.nextRoundIndex = 0;
    this.waitingCompletion = false;
    this.completionDelayMs = 0;
    this.shakeTimerMs = 0;

    if (this.playerSprite) {
      this.playerSprite.destroy();
      this.playerSprite = null;
    }
    if (this.enemySprite) {
      this.enemySprite.destroy();
      this.enemySprite = null;
    }

    if (!this.playback) return;

    const playerKey = `ship.player.${this.playback.loadoutId}`;
    this.playerSprite = this.add.image(0, 0, playerKey).setOrigin(0.5, 0.5).setDepth(3);

    if (this.playback.enemy) {
      const enemyKey = `ship.enemy.${this.playback.enemy.archetype}.${
        this.playback.enemy.isDanger ? 'danger' : 'normal'
      }`;
      this.enemySprite = this.add.image(0, 0, enemyKey).setOrigin(0.5, 0.5).setDepth(3);
    }

    this.layoutSprites();

    if (this.playback.simulation) {
      this.playbackActive = true;
      // Trigger first volley slightly faster for crisp pacing (250ms lead-in)
      const roundDuration = this.playback.settings.combatSpeed === 2 ? 500 : 1000;
      this.roundTimerMs = Math.max(0, roundDuration - 260);
    } else {
      this.playbackActive = false;
    }
  }

  private layoutSprites(): void {
    const w = this.viewW || this.scale.width || 390;
    const h = this.viewH || this.scale.height || 180;
    const shipScale = Math.min((w * 0.42) / 768, (h * 0.78) / 384);

    if (this.playerSprite) {
      const px = this.enemySprite ? w * 0.26 : w * 0.5;
      this.playerSprite.setPosition(px, h * 0.54).setScale(shipScale);
    }
    if (this.enemySprite) {
      this.enemySprite.setPosition(w * 0.74, h * 0.54).setScale(shipScale);
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

  update(_time: number, delta: number): void {
    // Pause automatically if browser tab is hidden (Blueprint §9) or read-only tab lost control (F02)
    if (typeof document !== 'undefined' && document.hidden) return;
    if (this.externalPaused) return;

    const dtMs = Math.min(delta, 50);
    const dt = dtMs / 1000;
    this.elapsed += dt;

    const settings = this.playback?.settings;
    const reduced = Boolean(settings?.reducedMotion);
    const lowQ = Boolean(settings?.lowQuality);

    // 1. Background star parallax
    const w = this.viewW || this.scale.width || 390;
    const h = this.viewH || this.scale.height || 180;
    this.bgGraphics.clear();
    this.bgGraphics.fillStyle(0x111a29, 1);
    this.bgGraphics.fillRect(0, 0, w, h);

    for (const st of this.stars) {
      if (!reduced) {
        st.nx -= st.speed * dt;
        if (st.nx < 0) st.nx += 1;
      }
      this.bgGraphics.fillStyle(0xcbd8e8, st.a);
      this.bgGraphics.fillCircle(st.nx * w, st.ny * h, st.r);
    }

    // Subtle ship idle hover (disabled in reduced motion)
    if (!reduced) {
      if (this.playerSprite) {
        this.playerSprite.y = h * 0.54 + Math.sin(this.elapsed * 2.2) * 2.5;
      }
      if (this.enemySprite && this.enemySprite.visible) {
        this.enemySprite.y = h * 0.54 + Math.cos(this.elapsed * 2.0) * 2.5;
      }
    }

    // 2. Advance deterministic combat rounds
    if (this.playbackActive && this.playback?.simulation) {
      const roundDuration = this.playback.settings.combatSpeed === 2 ? 500 : 1000;
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
          this.playbackActive = false;
          this.waitingCompletion = true;
          this.completionDelayMs = this.playback.settings.combatSpeed === 2 ? 320 : 520;
        }
      }
    } else if (this.waitingCompletion) {
      this.completionDelayMs -= dtMs;
      if (this.completionDelayMs <= 0) {
        this.waitingCompletion = false;
        this.playback?.onComplete?.();
      }
    }

    // 3. World-only micro-shake (<= 3 CSS px, <= 120ms, disabled in reducedMotion)
    if (this.shakeTimerMs > 0 && !reduced) {
      this.shakeTimerMs = Math.max(0, this.shakeTimerMs - dtMs);
      const amp = (this.shakeTimerMs / 120) * 2.8;
      this.cameras.main.setScroll((Math.random() - 0.5) * amp * 2, (Math.random() - 0.5) * amp * 2);
    } else {
      this.cameras.main.setScroll(0, 0);
    }

    // 4. Update & draw beams, shield arcs, sparks
    this.fxGraphics.clear();

    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.life -= dt;
      if (b.life <= 0) {
        this.beams.splice(i, 1);
        continue;
      }
      const alpha = Math.max(0, b.life / b.maxLife);
      this.fxGraphics.lineStyle(5, b.color, alpha * 0.35);
      this.fxGraphics.lineBetween(b.x1, b.y1, b.x2, b.y2);
      this.fxGraphics.lineStyle(2.2, 0xe9edf2, alpha);
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
      this.fxGraphics.lineStyle(3.5, 0x62d6df, alpha * 0.9);
      this.fxGraphics.beginPath();
      this.fxGraphics.arc(a.x, a.y, a.radius, -0.75, 0.75);
      this.fxGraphics.strokePath();
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
  }

  private playRoundFx(ev: CombatRoundEvent): void {
    if (!this.playback || !this.playerSprite || !this.enemySprite) return;
    const playerHp = getShipHardpoints(this.playerSprite.texture.key);
    const enemyHp = getShipHardpoints(this.enemySprite.texture.key);

    const pMuzzle = this.getSpritePoint(this.playerSprite, playerHp.muzzle);
    const pHit = this.getSpritePoint(this.playerSprite, playerHp.hit);
    const pShield = this.getSpritePoint(this.playerSprite, playerHp.shieldCenter);
    const eMuzzle = this.getSpritePoint(this.enemySprite, enemyHp.muzzle);
    const eHit = this.getSpritePoint(this.enemySprite, enemyHp.hit);

    // Player laser beam -> enemy
    this.beams.push({
      x1: pMuzzle.x,
      y1: pMuzzle.y,
      x2: eHit.x,
      y2: eHit.y,
      color: 0x62d6df,
      life: 0.22,
      maxLife: 0.22,
    });
    soundEngine.play('laserFire');

    // Enemy shot -> player
    this.beams.push({
      x1: eMuzzle.x,
      y1: eMuzzle.y,
      x2: pHit.x,
      y2: pHit.y,
      color: 0xf27564,
      life: 0.22,
      maxLife: 0.22,
    });

    if (ev.shieldAbsorbed > 0) {
      this.shieldArcs.push({
        x: pShield.x,
        y: pShield.y,
        radius: Math.max(26, this.playerSprite.displayWidth * 0.34),
        life: 0.18,
        maxLife: 0.18,
      });
      soundEngine.play('shieldHit');
    }
    if (ev.hpLoss > 0) {
      soundEngine.play('hullHit');
      this.shakeTimerMs = 110;
    }

    // Capped particles: <= 14 per burst, <= 100 total active (Art Spec §10)
    if (!this.playback.settings.lowQuality && !this.playback.settings.reducedMotion) {
      this.spawnSparks(eHit.x, eHit.y, ev.enemyHpAfter <= 0 ? 18 : 8, 0xf6b852);
      this.spawnSparks(pHit.x, pHit.y, ev.hpLoss > 0 ? 8 : 5, ev.hpLoss > 0 ? 0xf27564 : 0x62d6df);
    }

    // Dim destroyed vessel cleanly
    if (ev.enemyHpAfter <= 0 && this.enemySprite) {
      this.enemySprite.setAlpha(0.28);
    }
    if (ev.playerHpAfter <= 0 && this.playerSprite) {
      this.playerSprite.setAlpha(0.28);
    }
  }

  private spawnSparks(x: number, y: number, count: number, color: number): void {
    const budget = Math.min(count, 24, Math.max(0, 100 - this.sparks.length));
    for (let i = 0; i < budget; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 30 + Math.random() * 85;
      const life = 0.22 + Math.random() * 0.2;
      this.sparks.push({
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        life,
        maxLife: life,
        color,
        size: 1.5 + Math.random() * 2,
      });
    }
  }
}
