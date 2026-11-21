import Phaser from 'phaser';
import { getBaseLayerImageUrl, getPlayerShipImageUrl } from '../assets/itemArt';
import { BUILDINGS, RELICS, type BuildingId } from '../data/buildings';
import { canBuildFacility, canRestoreRelic, type BaseProgression, type GameSettings } from '../domain/progression';

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

const TEX_W = 1280;
const TEX_H = 720;

/**
 * Illustrated 2:1 Axonometric Orbital Salvage Station (v2.0).
 * Composites hand-painted same-camera quadrant overlays over station_worn.webp with zero jump,
 * enriched with real-time Phaser VFX (welding sparks, patrolling cargo tug, pulsing relic rings,
 * blinking deck beacons, interactive diegetic pins, and F11 return-to-port docking animation).
 */
export class BaseScene extends Phaser.Scene {
  private currentState: BaseSceneState | null = null;
  private onBuildingClick: ((id: BuildingId) => void) | null = null;

  private bgGraphics!: Phaser.GameObjects.Graphics;
  private edgeMaskGraphics!: Phaser.GameObjects.Graphics;
  private animGraphics!: Phaser.GameObjects.Graphics;

  private baseImage!: Phaser.GameObjects.Image;
  private wbOverlay!: Phaser.GameObjects.Image;
  private dispEmptyOverlay!: Phaser.GameObjects.Image;
  private dispRelicOverlay!: Phaser.GameObjects.Image;
  private drydockOverlay!: Phaser.GameObjects.Image;
  private arrivalShipSprite!: Phaser.GameObjects.Image;

  private hitZones: {
    id: BuildingId;
    zone: Phaser.GameObjects.Zone;
    badgeBg: Phaser.GameObjects.Graphics;
    label: Phaser.GameObjects.Text;
  }[] = [];

  private elapsed = 0;
  private buildCelebrateTimer = 0;
  private celebrateBuilding: BuildingId | null = null;
  private viewW = 390;
  private viewH = 340;
  private texturesReady = false;

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

  preload(): void {
    const queue: [string, string][] = [
      ['base.station.worn', getBaseLayerImageUrl('worn')],
      ['base.overlay.workbench', getBaseLayerImageUrl('workbench')],
      ['base.overlay.display_empty', getBaseLayerImageUrl('display_empty')],
      ['base.overlay.display_relic', getBaseLayerImageUrl('display_relic')],
      ['base.overlay.drydock', getBaseLayerImageUrl('drydock')],
      ['ship.player.cannon_skiff', getPlayerShipImageUrl('cannon_skiff')],
      ['ship.player.shield_cruiser', getPlayerShipImageUrl('shield_cruiser')],
    ];
    for (const [key, url] of queue) {
      if (!this.textures.exists(key)) {
        this.load.image(key, url);
      }
    }
  }

  create(): void {
    this.viewW = this.scale.width || 390;
    this.viewH = this.scale.height || 340;
    this.cameras.main.setViewport(0, 0, this.viewW, this.viewH);
    this.cameras.main.setBackgroundColor('#0B1320');

    this.bgGraphics = this.add.graphics().setDepth(1);

    // Layer 2: Hand-painted master worn diorama + zero-jump same-camera upgrade overlays
    this.baseImage = this.add.image(0, 0, 'base.station.worn').setOrigin(0.5, 0.5).setDepth(2);
    this.wbOverlay = this.add.image(0, 0, 'base.overlay.workbench').setOrigin(0.5, 0.5).setDepth(3).setVisible(false);
    this.dispEmptyOverlay = this.add.image(0, 0, 'base.overlay.display_empty').setOrigin(0.5, 0.5).setDepth(3.1).setVisible(false);
    this.dispRelicOverlay = this.add.image(0, 0, 'base.overlay.display_relic').setOrigin(0.5, 0.5).setDepth(3.2).setVisible(false);
    this.drydockOverlay = this.add.image(0, 0, 'base.overlay.drydock').setOrigin(0.5, 0.5).setDepth(3.3).setVisible(false);
    this.edgeMaskGraphics = this.add.graphics().setDepth(3.6);

    // Arrival ship sprite used exclusively during F11 return-to-port approach
    this.arrivalShipSprite = this.add
      .image(0, 0, 'ship.player.cannon_skiff')
      .setOrigin(0.5, 0.5)
      .setDepth(5)
      .setVisible(false);

    this.animGraphics = this.add.graphics().setDepth(6);
    this.texturesReady = true;

    this.createInteractiveZones();
    this.redrawStatic();

    this.scale.on('resize', this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.texturesReady = false;
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
    if (this.scene.isActive() && this.texturesReady) {
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
    if (this.scene.isActive() && this.texturesReady) {
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
    if (this.arrivalShipSprite) this.arrivalShipSprite.setVisible(false);
    pb.onProgress?.(1);
    pb.onFinish?.();
  }

  update(_time: number, delta: number): void {
    if (!this.currentState || !this.texturesReady) return;
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
        if (this.arrivalShipSprite) this.arrivalShipSprite.setVisible(false);
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
      this.syncViewport(this.scale.width || 390, this.scale.height || 340);
    }
  }

  /**
   * Computes exact image framing so the entire 4-quadrant station fills the viewport
   * lushly on BOTH wide desktop 16:9 AND narrow mobile portrait!
   */
  private getLayout() {
    const w = this.viewW || this.scale.width || 390;
    const h = this.viewH || this.scale.height || 340;
    const aspect = w / Math.max(1, h);

    // Keep entire 4-quadrant station (from glass display roof to mooring bollard) completely uncropped
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
      // Exact visual landmarks on station_worn_master / station_upgraded_all
      workbench: pt(0.22, 0.43),
      workbenchSpark: pt(0.252, 0.455),
      display: pt(0.50, 0.20),
      displayRelic: pt(0.50, 0.175),
      drydock: pt(0.76, 0.41),
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

    const defs: { id: BuildingId }[] = [
      { id: 'workbench' },
      { id: 'display' },
      { id: 'drydock' },
    ];

    for (const d of defs) {
      const zone = this.add.zone(0, 0, 120, 96).setInteractive({ useHandCursor: true }).setDepth(9);
      zone.on('pointerdown', () => {
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
        })
        .setOrigin(0.5, 0.5)
        .setDepth(8);
      this.hitZones.push({ id: d.id, zone, badgeBg, label });
    }
  }

  private redrawStatic(): void {
    if (!this.currentState || !this.texturesReady) return;
    const { progression } = this.currentState;
    const L = this.getLayout();

    // Seamless deep-space starfield behind station so wide widescreen margins blend organically
    this.bgGraphics.clear();
    this.bgGraphics.fillStyle(0x0b1320, 1);
    this.bgGraphics.fillRect(0, 0, L.w, L.h);
    for (let i = 0; i < 56; i++) {
      const sx = ((i * 137 + 29) % 1000) / 1000 * L.w;
      const sy = ((i * 89 + 41) % 1000) / 1000 * L.h;
      const sr = i % 6 === 0 ? 1.5 : 0.95;
      const sa = 0.22 + (i % 4) * 0.14;
      this.bgGraphics.fillStyle(i % 7 === 0 ? 0x89d6e8 : 0xdbe8f8, sa);
      this.bgGraphics.fillCircle(sx, sy, sr);
    }

    // Position all same-camera station layers identically (zero shift!)
    for (const img of [
      this.baseImage,
      this.wbOverlay,
      this.dispEmptyOverlay,
      this.dispRelicOverlay,
      this.drydockOverlay,
    ]) {
      img.setPosition(L.cx, L.cy).setScale(L.scale);
    }

    // Soft feathered dissolve on exposed image edges so station diorama floats seamlessly in space
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

    const wbBuilt = progression.buildings.workbench;
    const dispBuilt = progression.buildings.display;
    const relicRestored = Boolean(progression.relics.ancient_navigator?.restored);
    const dockBuilt = progression.buildings.drydock;

    this.wbOverlay.setVisible(wbBuilt);
    this.dispEmptyOverlay.setVisible(dispBuilt && !relicRestored);
    this.dispRelicOverlay.setVisible(dispBuilt && relicRestored);
    this.drydockOverlay.setVisible(dockBuilt);

    // Update diegetic station pins directly above each facility!
    const pinSpecs: Record<
      BuildingId,
      { pos: { x: number; y: number }; pinY: number; text: string; accent: number; textColor: string; visible: boolean }
    > = (() => {
      const wbCheck = canBuildFacility(progression, 'workbench');
      const dispCheck = canBuildFacility(progression, 'display');
      const dockCheck = canBuildFacility(progression, 'drydock');
      const relicCheck = canRestoreRelic(progression, 'ancient_navigator');

      const wbText = wbBuilt
        ? '工作台 · 图鉴'
        : `修复工作台 · ${BUILDINGS.workbench.cost}¤`;
      const dispText = !dispBuilt
        ? `展台 · ${BUILDINGS.display.cost}¤`
        : relicRestored
        ? '展台 · 星仪 ✓'
        : relicCheck.canRestore
        ? `修复星仪 · ${RELICS.ancient_navigator.restoreCost}¤`
        : '展台 · 待藏品';
      const dockText = dockBuilt ? '双泊位 ✓' : `扩建船坞 · ${BUILDINGS.drydock.cost}¤`;

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
          accent: relicRestored
            ? 0x62d6df
            : (!dispBuilt && dispCheck.canBuild) || relicCheck.canRestore
            ? 0xf6b852
            : 0x5d728a,
          textColor: relicRestored
            ? '#62D6DF'
            : (!dispBuilt && dispCheck.canBuild) || relicCheck.canRestore
            ? '#F6B852'
            : '#D5E0EC',
          visible: wbBuilt,
        },
        drydock: {
          pos: L.drydock,
          pinY: Math.max(18, L.pt(0.77, 0.155).y),
          text: dockText,
          accent: dockBuilt ? 0x62d6df : dockCheck.canBuild ? 0xf6b852 : 0x5d728a,
          textColor: dockBuilt ? '#62D6DF' : dockCheck.canBuild ? '#F6B852' : '#D5E0EC',
          visible: wbBuilt,
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

  private drawDynamicLayer(): void {
    this.animGraphics.clear();
    if (!this.currentState || !this.texturesReady) return;
    const { progression, settings } = this.currentState;
    const L = this.getLayout();
    const s = L.scale;
    const t = settings.reducedMotion ? 0 : this.elapsed;

    // 1. Subtle aviation beacons blinking on station corner bollards
    if (!settings.reducedMotion) {
      const blink = Math.sin(t * 3.1) > 0.35;
      if (blink) {
        const corners = [
          L.pt(0.068, 0.478),
          L.pt(0.502, 0.905),
          L.pt(0.935, 0.482),
        ];
        for (const c of corners) {
          this.animGraphics.fillStyle(0xf6b852, 0.85);
          this.animGraphics.fillCircle(c.x, c.y, Math.max(2, 3.2 * s));
        }
      }
    }

    // 2. Repaired Workbench: live welding spark bursts & warm flickering arc glow
    if (progression.buildings.workbench && !settings.reducedMotion && !settings.lowQuality) {
      const sp = L.workbenchSpark;
      const pulse = 0.55 + 0.45 * Math.sin(t * 14);
      this.animGraphics.fillStyle(0xffe7a8, 0.72 * pulse);
      this.animGraphics.fillCircle(sp.x, sp.y, Math.max(2.5, 6 * s * pulse));
      for (let i = 0; i < 6; i++) {
        const phase = (t * 2.4 + i * 0.17) % 1;
        const ang = -Math.PI * 0.85 + (i * 0.32);
        const dist = phase * 26 * s;
        const px = sp.x + Math.cos(ang) * dist;
        const py = sp.y + Math.sin(ang) * dist + phase * phase * 18 * s;
        this.animGraphics.fillStyle(i % 2 === 0 ? 0xf6b852 : 0xfff0c2, Math.max(0, 1 - phase));
        this.animGraphics.fillCircle(px, py, Math.max(1.2, 2.2 * s * (1 - phase * 0.5)));
      }

      // Autonomous hovering cargo-tug drone gliding smoothly along central cross-walkway
      const p = (Math.sin(t * 0.8) + 1) * 0.5;
      const botX = Phaser.Math.Linear(L.pt(0.36, 0.55).x, L.pt(0.62, 0.39).x, p);
      const botY = Phaser.Math.Linear(L.pt(0.36, 0.55).y, L.pt(0.62, 0.39).y, p) + Math.sin(t * 4) * 2 * s;
      this.animGraphics.fillStyle(0x060b14, 0.42);
      this.animGraphics.fillEllipse(botX, botY + 9 * s, 14 * s, 6 * s);
      this.animGraphics.fillStyle(0x88a0b8, 1);
      this.animGraphics.fillRoundedRect(botX - 7 * s, botY - 4 * s, 14 * s, 8 * s, 3);
      this.animGraphics.fillStyle(0x62d6df, 1);
      this.animGraphics.fillCircle(botX + 2 * s, botY, Math.max(1.5, 2.4 * s));
    }

    // 3. Restored Ancient Navigator: subtle cyan-gold orbital halo inside glass vitrine
    if (progression.buildings.display && progression.relics.ancient_navigator?.restored) {
      const rp = L.displayRelic;
      const pulse = 1 + Math.sin(t * 2.5) * 0.08;
      this.animGraphics.lineStyle(Math.max(1.2, 2.2 * s), 0x62d6df, 0.72);
      this.animGraphics.strokeCircle(rp.x, rp.y, 34 * s * pulse);
      this.animGraphics.lineStyle(Math.max(1, 1.4 * s), 0xf6b852, 0.5);
      this.animGraphics.strokeEllipse(rp.x, rp.y, 82 * s * pulse, 28 * s * pulse);
    }

    // 4. Affordable facility pulse ring (diegetic visual callout without text walls!)
    if (!settings.reducedMotion) {
      const pulseR = (Math.sin(t * 3.5) + 1) * 0.5;
      if (!progression.buildings.workbench && canBuildFacility(progression, 'workbench').canBuild) {
        this.animGraphics.lineStyle(2, 0xf6b852, 0.45 + pulseR * 0.4);
        this.animGraphics.strokeCircle(L.workbench.x, L.workbench.y, (32 + pulseR * 16) * s);
      }
      if (progression.buildings.display && canRestoreRelic(progression, 'ancient_navigator').canRestore) {
        this.animGraphics.lineStyle(2, 0x62d6df, 0.45 + pulseR * 0.45);
        this.animGraphics.strokeCircle(L.display.x, L.display.y, (32 + pulseR * 16) * s);
      }
    }

    // 5. F11 Return-to-Port Docking & Unloading Sequence (<= 1.4s, pure presentation!)
    if (this.dockingPlayback) {
      const p = Math.min(1, this.dockingElapsedMs / this.dockingDurationMs);
      const dockPhase = Math.min(1, p / 0.48);
      const easeOut = 1 - Math.pow(1 - dockPhase, 3);

      const isShield = progression.selectedLoadout === 'shield_cruiser' && progression.buildings.drydock;
      const shipKey = isShield ? 'ship.player.shield_cruiser' : 'ship.player.cannon_skiff';
      if (this.arrivalShipSprite.texture.key !== shipKey) {
        this.arrivalShipSprite.setTexture(shipKey);
      }

      const curX = Phaser.Math.Linear(L.approachStart.x, L.padShip.x, easeOut);
      const curY = Phaser.Math.Linear(L.approachStart.y, L.padShip.y, easeOut);
      const shipScale = Phaser.Math.Linear(0.36, 0.24, easeOut) * s;

      this.arrivalShipSprite
        .setVisible(p < 0.62)
        .setPosition(curX, curY)
        .setScale(shipScale)
        .setAngle(-18 * (1 - easeOut))
        .setAlpha(p > 0.48 ? Math.max(0, 1 - (p - 0.48) / 0.14) : this.dockingPlayback.wasDefeat ? 0.8 : 1);

      // Braking retro-thruster plume or amber escort tug
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

      // Cargo crates arcing smoothly from landing pad into Workbench / Display
      if (p >= 0.44 && p <= 0.96) {
        const unloadP = (p - 0.44) / 0.52;
        const crates = Math.min(5, Math.max(2, this.dockingPlayback.crateCount));
        for (let i = 0; i < crates; i++) {
          const localP = Math.max(0, Math.min(1, unloadP * 1.45 - i * 0.13));
          if (localP <= 0 || localP >= 1) continue;
          const isRelicCrate = this.dockingPlayback.hasKeptRelic && i === crates - 1;
          const target = isRelicCrate ? L.display : L.workbench;
          const cx = Phaser.Math.Linear(L.padShip.x, target.x, localP);
          const cy =
            Phaser.Math.Linear(L.padShip.y - 12 * s, target.y, localP) -
            Math.sin(localP * Math.PI) * 52 * s;
          const sz = Math.max(6, 13 * s);
          this.animGraphics.fillStyle(isRelicCrate ? 0x62d6df : 0xf6b852, 1);
          this.animGraphics.lineStyle(1.6, 0x0d1726, 1);
          this.animGraphics.fillRoundedRect(cx - sz * 0.5, cy - sz * 0.5, sz, sz, 3);
          this.animGraphics.strokeRoundedRect(cx - sz * 0.5, cy - sz * 0.5, sz, sz, 3);
        }
      }

      // Crisp pad lock pulse ring
      if (p > 0.75) {
        const ringP = (p - 0.75) / 0.25;
        this.animGraphics.lineStyle(2.5, 0xf6b852, Math.max(0, 1 - ringP));
        this.animGraphics.strokeEllipse(L.padShip.x, L.padShip.y + 8 * s, (90 + ringP * 90) * s, (45 + ringP * 45) * s);
      }
    } else if (this.arrivalShipSprite) {
      this.arrivalShipSprite.setVisible(false);
    }

    // 6. Fresh construction completion burst (capped <= 16 sparks, disabled in reducedMotion)
    if (this.buildCelebrateTimer > 0 && this.celebrateBuilding && !settings.reducedMotion) {
      const target = L[this.celebrateBuilding];
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
