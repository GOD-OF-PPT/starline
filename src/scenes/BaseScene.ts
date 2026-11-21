import Phaser from 'phaser';
import {
  BASE_BUILDING_ANCHOR_NX,
  BASE_BUILDING_ANCHOR_NY,
  BASE_DECK_ANCHOR_Y,
  BASE_DECK_TEX_H,
  BASE_DECK_TEX_W,
  BASE_SHIP_ANCHOR_Y,
  BASE_SHIP_TEX_H,
  registerBaseArtTextures,
} from '../assets/baseArt';
import type { BuildingId } from '../data/buildings';
import type { BaseProgression, GameSettings } from '../domain/progression';

export interface BaseSceneState {
  readonly progression: BaseProgression;
  readonly settings: GameSettings;
  readonly recentlyBuiltId: BuildingId | null;
}

export interface ReturnDockingPlayback {
  readonly earnedCredits: number;
  readonly crateCount: number;
  readonly hasKeptRelic: boolean;
  readonly wasDefeat: boolean;
  readonly onProgress?: (progress: number) => void;
  readonly onFinish?: () => void;
}

/**
 * High-craft 2:1 Axonometric Miniature Space Salvage Station (F04 & F11).
 * Layer stack (Art Spec §9):
 *   1: Space backdrop + distant planetary rim & orbital truss silhouette
 *   2: Station deck platform sprite (base.deck, POT 1024x1024)
 *   3-5: Buildings depth-sorted strictly by ground anchor Y (Display -> Workbench -> Drydock -> Ship)
 *   6: Living activity (jointed welder arm, patrolling tug bot, drydock runway pulse, F11 docking/unloading crates)
 *   7: Interactive building hit zones & crisp 12px UI markers positioned cleanly above roofs
 */
export class BaseScene extends Phaser.Scene {
  private currentState: BaseSceneState | null = null;
  private onBuildingClick: ((id: BuildingId) => void) | null = null;

  private bgGraphics!: Phaser.GameObjects.Graphics;
  private animGraphics!: Phaser.GameObjects.Graphics;

  private deckSprite!: Phaser.GameObjects.Image;
  private displaySprite!: Phaser.GameObjects.Image;
  private workbenchSprite!: Phaser.GameObjects.Image;
  private drydockSprite!: Phaser.GameObjects.Image;
  private shipSprite!: Phaser.GameObjects.Image;

  private hitZones: {
    id: BuildingId;
    zone: Phaser.GameObjects.Zone;
    label: Phaser.GameObjects.Text;
  }[] = [];

  private elapsed = 0;
  private buildCelebrateTimer = 0;
  private celebrateBuilding: BuildingId | null = null;
  private stars: { nx: number; ny: number; r: number; a: number }[] = [];
  private viewW = 390;
  private viewH = 268;

  // F11 Return-to-port docking & unloading animation (pure presentation, zero payout authority)
  private dockingPlayback: ReturnDockingPlayback | null = null;
  private dockingElapsedMs = 0;
  private readonly dockingDurationMs = 1400;

  constructor() {
    super({ key: 'BaseScene' });
  }

  init(data?: { state?: BaseSceneState; onBuildingClick?: (id: BuildingId) => void }): void {
    if (data?.state) this.currentState = data.state;
    if (data?.onBuildingClick) this.onBuildingClick = data.onBuildingClick;
  }

  create(): void {
    this.viewW = this.scale.width || 390;
    this.viewH = this.scale.height || 268;
    this.cameras.main.setViewport(0, 0, this.viewW, this.viewH);
    this.cameras.main.setBackgroundColor('#111A29');

    registerBaseArtTextures(this);

    this.stars = [];
    for (let i = 0; i < 46; i++) {
      const seed = (i * 2654435761) >>> 0;
      this.stars.push({
        nx: (seed & 0xffff) / 0xffff,
        ny: (((seed >>> 16) & 0xffff) / 0xffff) * 0.65,
        r: i % 5 === 0 ? 1.5 : 1,
        a: 0.14 + (i % 4) * 0.07,
      });
    }

    this.bgGraphics = this.add.graphics().setDepth(1);
    this.deckSprite = this.add
      .image(0, 0, 'base.deck')
      .setOrigin(0.5, BASE_DECK_ANCHOR_Y / BASE_DECK_TEX_H)
      .setDepth(2);

    // Depth-sorted strictly by ground anchor Y (back to front)
    this.displaySprite = this.add
      .image(0, 0, 'base.display.worn')
      .setOrigin(BASE_BUILDING_ANCHOR_NX, BASE_BUILDING_ANCHOR_NY)
      .setDepth(3);
    this.workbenchSprite = this.add
      .image(0, 0, 'base.workbench.worn')
      .setOrigin(BASE_BUILDING_ANCHOR_NX, BASE_BUILDING_ANCHOR_NY)
      .setDepth(4);
    this.drydockSprite = this.add
      .image(0, 0, 'base.drydock.worn')
      .setOrigin(BASE_BUILDING_ANCHOR_NX, BASE_BUILDING_ANCHOR_NY)
      .setDepth(4.2);
    this.shipSprite = this.add
      .image(0, 0, 'base.ship.cannon_skiff')
      .setOrigin(0.5, BASE_SHIP_ANCHOR_Y / BASE_SHIP_TEX_H)
      .setDepth(5);

    this.animGraphics = this.add.graphics().setDepth(6);

    this.createInteractiveZones();
    this.redrawStatic();

    this.scale.on('resize', this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.handleResize, this);
    });
  }

  syncViewport(w: number, h: number): void {
    if (w < 16 || h < 16) return;
    this.viewW = w;
    this.viewH = h;
    if (this.cameras?.main) {
      this.cameras.main.setViewport(0, 0, w, h);
    }
    if (this.scene.isActive() && this.bgGraphics) {
      this.redrawStatic();
    }
  }

  setState(state: BaseSceneState): void {
    const newlyBuilt = state.recentlyBuiltId;
    if (newlyBuilt && newlyBuilt !== this.celebrateBuilding) {
      this.celebrateBuilding = newlyBuilt;
      this.buildCelebrateTimer = 1.6;
    }
    this.currentState = state;
    if (this.scene.isActive() && this.deckSprite) {
      this.redrawStatic();
    }
  }

  setClickHandler(handler: (id: BuildingId) => void): void {
    this.onBuildingClick = handler;
  }

  startReturnDocking(playback: ReturnDockingPlayback): void {
    this.dockingPlayback = playback;
    this.dockingElapsedMs = 0;
  }

  skipReturnDocking(): void {
    if (!this.dockingPlayback) return;
    const pb = this.dockingPlayback;
    this.dockingPlayback = null;
    this.dockingElapsedMs = 0;
    this.positionDockedShipResting();
    pb.onProgress?.(1);
    pb.onFinish?.();
  }

  update(_time: number, delta: number): void {
    if (!this.currentState) return;
    const dtMs = Math.min(delta, 50);
    const dt = dtMs / 1000;
    this.elapsed += dt;

    if (this.buildCelebrateTimer > 0) {
      this.buildCelebrateTimer = Math.max(0, this.buildCelebrateTimer - dt);
    }

    if (this.dockingPlayback) {
      this.dockingElapsedMs += dtMs;
      const p = Math.min(1, this.dockingElapsedMs / this.dockingDurationMs);
      this.dockingPlayback.onProgress?.(p);
      if (p >= 1) {
        const pb = this.dockingPlayback;
        this.dockingPlayback = null;
        this.positionDockedShipResting();
        pb.onFinish?.();
      }
    }

    this.drawDynamicLayer();
  }

  private handleResize(gameSize?: Phaser.Structs.Size): void {
    if (!this.scene.isActive()) return;
    if (gameSize && gameSize.width > 0 && gameSize.height > 0) {
      this.syncViewport(gameSize.width, gameSize.height);
    } else {
      this.syncViewport(this.scale.width || 390, this.scale.height || 268);
    }
  }

  /**
   * Maps logical station deck 2:1 axonometric coords (u, v) to canvas screen coords!
   * Deck texture spans u,v in [-244..244] -> total screen width 976px, height 488px inside 1024x640.
   */
  private getLayout() {
    const w = this.viewW || this.scale.width || 390;
    const h = this.viewH || this.scale.height || 268;
    const cx = w * 0.5;
    const cy = h * 0.62;
    // Scale deck cleanly inside viewport with generous top headroom for elevated building callouts
    const deckScale = Math.min((w * 0.92) / 976, (h * 0.85) / 560);
    const iso = (u: number, v: number, z = 0) => ({
      x: cx + (u - v) * deckScale,
      y: cy + ((u + v) * 0.5 - z) * deckScale,
    });

    return {
      w,
      h,
      cx,
      cy,
      deckScale,
      iso,
      // Exact 2:1 quadrant centers matching deck walkways & landing pad!
      display: iso(-126, -124, 0),
      workbench: iso(-126, 114, 0),
      drydock: iso(116, -112, 0),
      mainShip: iso(46, 118, 2),
      approachStart: iso(-290, 290, 22),
      bldScale: deckScale * 0.96,
      shipScale: deckScale * 0.88,
    };
  }

  private createInteractiveZones(): void {
    for (const item of this.hitZones) {
      item.zone.destroy();
      item.label.destroy();
    }
    this.hitZones = [];

    const defs: { id: BuildingId; title: string }[] = [
      { id: 'workbench', title: '拆解工作台' },
      { id: 'display', title: '收藏展台' },
      { id: 'drydock', title: '船坞泊位' },
    ];

    for (const d of defs) {
      const zone = this.add.zone(0, 0, 96, 76).setInteractive({ useHandCursor: true }).setDepth(8);
      zone.on('pointerdown', () => {
        this.onBuildingClick?.(d.id);
      });
      const label = this.add
        .text(0, 0, d.title, {
          fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
          fontSize: '12px',
          fontStyle: 'bold',
          color: '#E9EDF2',
          backgroundColor: 'rgba(17, 26, 41, 0.92)',
          padding: { x: 7, y: 3 },
        })
        .setOrigin(0.5, 0.5)
        .setDepth(7);
      this.hitZones.push({ id: d.id, zone, label });
    }
  }

  private positionDockedShipResting(): void {
    if (!this.shipSprite) return;
    const L = this.getLayout();
    this.shipSprite
      .setPosition(L.mainShip.x, L.mainShip.y)
      .setScale(L.shipScale)
      .setAlpha(1);
  }

  private redrawStatic(): void {
    if (!this.currentState) return;
    const { progression, settings } = this.currentState;
    const L = this.getLayout();

    // 1. Deep space backdrop + subtle distant planet horizon & orbital truss silhouette
    this.bgGraphics.clear();
    this.bgGraphics.fillStyle(0x111a29, 1);
    this.bgGraphics.fillRect(0, 0, L.w, L.h);

    if (!settings.lowQuality) {
      // Distant dark-indigo planet crescent peeking behind upper-right sky
      const px = L.w * 0.92;
      const py = L.h * 0.14;
      const pr = Math.max(L.w * 0.24, 90);
      this.bgGraphics.fillStyle(0x162436, 0.65);
      this.bgGraphics.fillCircle(px, py, pr);
      this.bgGraphics.lineStyle(1.5, 0x2c4b68, 0.45);
      this.bgGraphics.strokeCircle(px, py, pr + 2);
    }

    for (const st of this.stars) {
      this.bgGraphics.fillStyle(0xd9e4f2, st.a);
      this.bgGraphics.fillCircle(st.nx * L.w, st.ny * L.h, st.r);
    }

    // Subtle low-contrast orbital crane truss behind station with cross-bracing
    const yL1 = L.cy - 190 * L.deckScale;
    const yR1 = L.cy - 130 * L.deckScale;
    const yL2 = yL1 + 14 * L.deckScale;
    const yR2 = yR1 + 14 * L.deckScale;
    this.bgGraphics.lineStyle(1.6, 0x1e2e42, 0.65);
    this.bgGraphics.beginPath();
    this.bgGraphics.moveTo(0, yL1);
    this.bgGraphics.lineTo(L.w, yR1);
    this.bgGraphics.moveTo(0, yL2);
    this.bgGraphics.lineTo(L.w, yR2);
    for (let i = 0; i < 10; i++) {
      const f0 = i / 10;
      const f1 = (i + 1) / 10;
      this.bgGraphics.moveTo(L.w * f0, Phaser.Math.Linear(yL1, yR1, f0));
      this.bgGraphics.lineTo(L.w * f1, Phaser.Math.Linear(yL2, yR2, f1));
    }
    this.bgGraphics.strokePath();

    // 2. Deck Platform Sprite
    this.deckSprite.setPosition(L.cx, L.cy).setScale(L.deckScale);

    // 3. Swap building textures cleanly on identical ground anchors (zero jump!)
    const displayKey = !progression.buildings.display
      ? 'base.display.worn'
      : progression.relics.ancient_navigator?.restored
      ? 'base.display.restored'
      : 'base.display.repaired';
    this.displaySprite
      .setTexture(displayKey)
      .setPosition(L.display.x, L.display.y)
      .setScale(L.bldScale);

    const wbKey = progression.buildings.workbench ? 'base.workbench.repaired' : 'base.workbench.worn';
    this.workbenchSprite
      .setTexture(wbKey)
      .setPosition(L.workbench.x, L.workbench.y)
      .setScale(L.bldScale);

    const dockKey = progression.buildings.drydock ? 'base.drydock.repaired' : 'base.drydock.worn';
    this.drydockSprite
      .setTexture(dockKey)
      .setPosition(L.drydock.x, L.drydock.y)
      .setScale(L.bldScale);

    // 4. Primary Docked Ship Sprite
    const isShieldShip =
      progression.selectedLoadout === 'shield_cruiser' && progression.buildings.drydock;
    this.shipSprite.setTexture(isShieldShip ? 'base.ship.shield_cruiser' : 'base.ship.cannon_skiff');
    if (!this.dockingPlayback) {
      this.positionDockedShipResting();
    }

    // 5. Interactive hit zones & crisp 12px UI markers positioned cleanly ABOVE roof silhouettes (zero overlap!)
    const posMap: Record<
      BuildingId,
      { x: number; y: number; built: boolean; labelOffsetX: number; labelOffsetY: number }
    > = {
      workbench: {
        x: L.workbench.x,
        y: L.workbench.y,
        built: progression.buildings.workbench,
        labelOffsetX: -26 * L.bldScale,
        labelOffsetY: -188 * L.bldScale,
      },
      display: {
        x: L.display.x,
        y: L.display.y,
        built: progression.buildings.display,
        labelOffsetX: 0,
        labelOffsetY: -206 * L.bldScale,
      },
      drydock: {
        x: L.drydock.x,
        y: L.drydock.y,
        built: progression.buildings.drydock,
        labelOffsetX: 28 * L.bldScale,
        labelOffsetY: -172 * L.bldScale,
      },
    };

    for (const item of this.hitZones) {
      const p = posMap[item.id];
      const visible = item.id === 'workbench' || progression.buildings.workbench;
      const zoneW = Math.max(64, 150 * L.bldScale);
      const zoneH = Math.max(54, 120 * L.bldScale);
      item.zone.setPosition(p.x, p.y - 44 * L.bldScale).setSize(zoneW, zoneH).setVisible(visible);
      const lx = Math.max(48, Math.min(L.w - 48, p.x + p.labelOffsetX));
      const ly = Math.max(15, p.y + p.labelOffsetY);
      item.label
        .setPosition(lx, ly)
        .setVisible(visible)
        .setText(
          item.id === 'workbench'
            ? p.built
              ? '拆解工作台 ✓'
              : '待修复 · 工作台'
            : item.id === 'display'
            ? p.built
              ? '收藏展台 ✓'
              : '收藏展台'
            : p.built
            ? '船坞泊位 ✓'
            : '船坞扩建'
        )
        .setColor(p.built ? '#E9EDF2' : '#F6B852');
    }

    // Prevent unused constant warning
    void BASE_DECK_TEX_W;

    this.drawDynamicLayer();
  }

  private drawDynamicLayer(): void {
    this.animGraphics.clear();
    if (!this.currentState) return;
    const { progression, settings } = this.currentState;
    const L = this.getLayout();
    const s = L.bldScale;
    const t = settings.reducedMotion ? 0 : this.elapsed;

    // 1. Repaired Workbench: articulated 2-joint robotic welder arm pivoting over hull workpiece + subtle sparks
    if (progression.buildings.workbench) {
      // Shoulder mount matches drawWorkbench cylinder(-64, -28, z:92)
      const shoulder = {
        x: L.workbench.x + (-64 - -28) * s,
        y: L.workbench.y + ((-64 + -28) * 0.5 - 92) * s,
      };
      const swing = Math.sin(t * 2.3) * 14 * s;
      const elbow = {
        x: shoulder.x + 28 * s + swing * 0.45,
        y: shoulder.y - 18 * s + Math.cos(t * 2.3) * 4 * s,
      };
      const tip = {
        x: L.workbench.x + (-4 + Math.sin(t * 2.3) * 16) * s,
        y: L.workbench.y + (2 - 60) * s,
      };

      // Arm segments with realistic steel + amber joint caps
      this.animGraphics.lineStyle(Math.max(2.2, 5.5 * s), 0x8ea4bc, 1);
      this.animGraphics.lineBetween(shoulder.x, shoulder.y, elbow.x, elbow.y);
      this.animGraphics.lineStyle(Math.max(1.8, 4.2 * s), 0xf6b852, 1);
      this.animGraphics.lineBetween(elbow.x, elbow.y, tip.x, tip.y);
      this.animGraphics.fillStyle(0xf6b852, 1);
      this.animGraphics.fillCircle(elbow.x, elbow.y, Math.max(2.2, 4.5 * s));

      // Localized welding arc flicker (off in lowQuality / reducedMotion)
      if (!settings.reducedMotion && !settings.lowQuality && Math.sin(t * 11) > 0.25) {
        this.animGraphics.fillStyle(0xf6b852, 0.9);
        this.animGraphics.fillCircle(tip.x, tip.y, Math.max(2.4, 5 * s));
        this.animGraphics.fillStyle(0x62d6df, 0.95);
        this.animGraphics.fillCircle(tip.x, tip.y, Math.max(1.4, 2.6 * s));
      }

      // Autonomous hovering cargo-tug drone patrolling the central cross-corridor
      const loopP = (t * 0.16) % 1;
      const uPos = -140 + Math.sin(loopP * Math.PI * 2) * 120;
      const vPos = 6 * Math.cos(loopP * Math.PI * 2);
      const bot = L.iso(uPos, vPos, 14);
      // Soft shadow on deck directly beneath drone
      this.animGraphics.fillStyle(0x060b14, 0.45);
      this.animGraphics.fillEllipse(bot.x, bot.y + 12 * L.deckScale, 14 * L.deckScale, 7 * L.deckScale);
      // Drone chassis & cyan sensor eye
      this.animGraphics.fillStyle(0x7c92aa, 1);
      this.animGraphics.fillRoundedRect(
        bot.x - 8 * L.deckScale,
        bot.y - 5 * L.deckScale,
        16 * L.deckScale,
        10 * L.deckScale,
        3
      );
      this.animGraphics.fillStyle(0x62d6df, 1);
      this.animGraphics.fillCircle(bot.x + 2 * L.deckScale, bot.y, Math.max(1.5, 2.5 * L.deckScale));
    }

    // 2. Repaired Drydock: sequential approach guide light chase along rails
    if (progression.buildings.drydock && !settings.reducedMotion) {
      const activeIdx = Math.floor(t * 3.2) % 4;
      const railUs = [-64, -30, 4, 36];
      const u = railUs[activeIdx];
      for (const v of [-38, 44]) {
        const pt = {
          x: L.drydock.x + (u - v) * s,
          y: L.drydock.y + ((u + v) * 0.5 - 16) * s,
        };
        this.animGraphics.fillStyle(0xffe19c, 0.92);
        this.animGraphics.fillCircle(pt.x, pt.y, Math.max(2, 4.5 * s));
      }
    }

    // 3. Restored Ancient Navigator: subtle cyan-gold pulse inside glass vitrine
    if (progression.buildings.display && progression.relics.ancient_navigator?.restored) {
      const rx = L.display.x;
      const ry = L.display.y - 78 * s;
      const pulse = 1 + Math.sin(t * 2.4) * 0.1;
      this.animGraphics.lineStyle(Math.max(1.2, 2.2 * s), 0x62d6df, 0.72);
      this.animGraphics.strokeCircle(rx, ry, 21 * s * pulse);
    }

    // 4. F11 Return-to-Port Docking & Unloading Sequence (<= 1.4s, pure presentation!)
    if (this.dockingPlayback) {
      const p = Math.min(1, this.dockingElapsedMs / this.dockingDurationMs);
      const dockPhase = Math.min(1, p / 0.48);
      // Smooth ease-out landing approach
      const easeOut = 1 - Math.pow(1 - dockPhase, 3);
      const curX = Phaser.Math.Linear(L.approachStart.x, L.mainShip.x, easeOut);
      const curY = Phaser.Math.Linear(L.approachStart.y, L.mainShip.y, easeOut);

      this.shipSprite
        .setPosition(curX, curY)
        .setScale(L.shipScale)
        .setAlpha(this.dockingPlayback.wasDefeat ? 0.72 : 1);

      // Braking retro-thruster plume during docking approach (or amber escort tug on defeat)
      if (dockPhase < 0.95) {
        if (this.dockingPlayback.wasDefeat) {
          // Small amber rescue tug pulling the damaged ship into berth
          const tugX = curX + 46 * L.deckScale;
          const tugY = curY - 22 * L.deckScale;
          this.animGraphics.lineStyle(2, 0xf6b852, 0.85);
          this.animGraphics.lineBetween(curX, curY, tugX, tugY);
          this.animGraphics.fillStyle(0xf6b852, 1);
          this.animGraphics.fillRoundedRect(
            tugX - 10 * L.deckScale,
            tugY - 6 * L.deckScale,
            20 * L.deckScale,
            12 * L.deckScale,
            3
          );
        } else {
          this.animGraphics.fillStyle(0x62d6df, (1 - dockPhase) * 0.75);
          this.animGraphics.fillCircle(
            curX - 24 * L.deckScale,
            curY + 14 * L.deckScale,
            Math.max(3, 12 * L.deckScale * (1 - dockPhase * 0.5))
          );
        }
      }

      // Cargo crates arcing smoothly from ship to Workbench / Display bay (p in 0.48..0.92)
      if (p >= 0.46 && p <= 0.96) {
        const unloadP = (p - 0.46) / 0.5;
        const crates = Math.min(4, Math.max(1, this.dockingPlayback.crateCount));
        for (let i = 0; i < crates; i++) {
          const localP = Math.max(0, Math.min(1, unloadP * 1.4 - i * 0.14));
          if (localP <= 0 || localP >= 1) continue;
          const isRelicCrate = this.dockingPlayback.hasKeptRelic && i === crates - 1;
          const target = isRelicCrate ? L.display : L.workbench;
          const cx = Phaser.Math.Linear(L.mainShip.x, target.x, localP);
          const cy =
            Phaser.Math.Linear(L.mainShip.y - 12 * L.deckScale, target.y - 24 * L.deckScale, localP) -
            Math.sin(localP * Math.PI) * 34 * L.deckScale;

          this.animGraphics.fillStyle(isRelicCrate ? 0x62d6df : 0xf6b852, 1);
          this.animGraphics.lineStyle(1.4, 0x111a29, 1);
          const sz = Math.max(5, 11 * L.deckScale);
          this.animGraphics.fillRoundedRect(cx - sz * 0.5, cy - sz * 0.5, sz, sz, 2);
          this.animGraphics.strokeRoundedRect(cx - sz * 0.5, cy - sz * 0.5, sz, sz, 2);
        }
      }

      // Crisp pad lock pulse on completion
      if (p > 0.78) {
        const ringP = (p - 0.78) / 0.22;
        this.animGraphics.lineStyle(2.5, 0xf6b852, Math.max(0, 1 - ringP));
        this.animGraphics.strokeEllipse(
          L.mainShip.x,
          L.mainShip.y + 8 * L.deckScale,
          (70 + ringP * 70) * L.deckScale,
          (35 + ringP * 35) * L.deckScale
        );
      }
    }

    // 5. Fresh construction completion sparks (capped <= 16 sparks, disabled in reducedMotion)
    if (this.buildCelebrateTimer > 0 && this.celebrateBuilding && !settings.reducedMotion) {
      const target = L[this.celebrateBuilding];
      const progress = 1 - this.buildCelebrateTimer / 1.6;
      const count = settings.lowQuality ? 6 : 16;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + progress * 1.1;
        const dist = (22 + progress * 76) * s;
        const px = target.x + Math.cos(a) * dist;
        const py = target.y - 44 * s + Math.sin(a) * dist * 0.55;
        this.animGraphics.fillStyle(i % 2 === 0 ? 0xf6b852 : 0x62d6df, Math.max(0, 1 - progress));
        this.animGraphics.fillCircle(px, py, Math.max(1.8, 3.8 * s));
      }
    }
  }
}
