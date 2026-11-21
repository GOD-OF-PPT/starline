import Phaser from 'phaser';
import type { BuildingId } from '../data/buildings';
import type { BaseProgression, GameSettings } from '../domain/progression';

export interface BaseSceneState {
  readonly progression: BaseProgression;
  readonly settings: GameSettings;
  readonly recentlyBuiltId: BuildingId | null;
}

/**
 * 2:1 Axonometric Miniature Space Salvage Station (Art Spec §3 & §9).
 * Ground axes have exact slopes ±1/2; verticals remain strictly vertical.
 * Worn & repaired buildings share identical ground anchors so upgrading NEVER causes visual jumping.
 */
export class BaseScene extends Phaser.Scene {
  private currentState: BaseSceneState | null = null;
  private onBuildingClick: ((id: BuildingId) => void) | null = null;

  private bgGraphics!: Phaser.GameObjects.Graphics;
  private deckGraphics!: Phaser.GameObjects.Graphics;
  private bldGraphics!: Phaser.GameObjects.Graphics;
  private animGraphics!: Phaser.GameObjects.Graphics;
  private hitZones: { id: BuildingId; zone: Phaser.GameObjects.Zone; label: Phaser.GameObjects.Text }[] = [];

  private elapsed = 0;
  private buildCelebrateTimer = 0;
  private celebrateBuilding: BuildingId | null = null;
  private stars: { nx: number; ny: number; r: number; a: number }[] = [];

  constructor() {
    super({ key: 'BaseScene' });
  }

  init(data?: { state?: BaseSceneState; onBuildingClick?: (id: BuildingId) => void }): void {
    if (data?.state) this.currentState = data.state;
    if (data?.onBuildingClick) this.onBuildingClick = data.onBuildingClick;
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#111A29');

    // Subtle non-collectible background stars (deterministic pattern)
    this.stars = [];
    for (let i = 0; i < 42; i++) {
      const seed = (i * 2654435761) >>> 0;
      this.stars.push({
        nx: ((seed & 0xffff) / 0xffff),
        ny: (((seed >>> 16) & 0xffff) / 0xffff) * 0.58,
        r: i % 5 === 0 ? 1.5 : 1,
        a: 0.16 + ((i % 4) * 0.08),
      });
    }

    this.bgGraphics = this.add.graphics().setDepth(1);
    this.deckGraphics = this.add.graphics().setDepth(2);
    this.bldGraphics = this.add.graphics().setDepth(3);
    this.animGraphics = this.add.graphics().setDepth(4);

    this.createInteractiveZones();
    this.redrawStatic();

    this.scale.on('resize', this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.handleResize, this);
    });
  }

  setState(state: BaseSceneState): void {
    const newlyBuilt = state.recentlyBuiltId;
    if (newlyBuilt && newlyBuilt !== this.celebrateBuilding) {
      this.celebrateBuilding = newlyBuilt;
      this.buildCelebrateTimer = 1.8;
    }
    this.currentState = state;
    if (this.scene.isActive()) {
      this.redrawStatic();
    }
  }

  setClickHandler(handler: (id: BuildingId) => void): void {
    this.onBuildingClick = handler;
  }

  update(_time: number, delta: number): void {
    if (!this.currentState) return;
    const dt = Math.min(delta / 1000, 0.05);
    this.elapsed += dt;
    if (this.buildCelebrateTimer > 0) {
      this.buildCelebrateTimer = Math.max(0, this.buildCelebrateTimer - dt);
    }
    this.drawDynamicLayer();
  }

  private handleResize(): void {
    if (!this.scene.isActive()) return;
    this.redrawStatic();
  }

  private getLayout() {
    const w = this.scale.width || 390;
    const h = this.scale.height || 300;
    const cx = w * 0.5;
    const cy = h * 0.57;
    // Unit scale fits cleanly on both 360px portrait and 1366px desktop
    const s = Math.min(w / 400, h / 250) * 1.02;
    return {
      w,
      h,
      cx,
      cy,
      s,
      // Exact 2:1 axonometric ground anchors for the 3 buildings
      workbench: { x: cx - 86 * s, y: cy + 8 * s },
      display: { x: cx + 8 * s, y: cy - 42 * s },
      drydock: { x: cx + 86 * s, y: cy + 16 * s },
      mainShip: { x: cx - 18 * s, y: cy + 52 * s },
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
      const zone = this.add.zone(0, 0, 90, 74).setInteractive({ useHandCursor: true }).setDepth(6);
      zone.on('pointerdown', () => {
        this.onBuildingClick?.(d.id);
      });
      const label = this.add
        .text(0, 0, d.title, {
          fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
          fontSize: '12px',
          color: '#E9EDF2',
          backgroundColor: 'rgba(17, 26, 41, 0.84)',
          padding: { x: 6, y: 3 },
        })
        .setOrigin(0.5, 0.5)
        .setDepth(5);
      this.hitZones.push({ id: d.id, zone, label });
    }
  }

  private isoDiamond(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    fill: number,
    alpha = 1,
    stroke?: number,
    strokeWidth = 1.5
  ): void {
    g.fillStyle(fill, alpha);
    g.beginPath();
    g.moveTo(cx, cy - ry);
    g.lineTo(cx + rx, cy);
    g.lineTo(cx, cy + ry);
    g.lineTo(cx - rx, cy);
    g.closePath();
    g.fillPath();
    if (stroke !== undefined) {
      g.lineStyle(strokeWidth, stroke, alpha);
      g.strokePath();
    }
  }

  /**
   * Draw an exact 2:1 axonometric extruded box anchored at bottom-center (cx, cy).
   * Top-left main light -> top brightest, left medium-lit, right shaded.
   */
  private isoBox(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    u: number,
    v: number,
    h: number,
    topCol: number,
    leftCol: number,
    rightCol: number,
    edgeCol: number
  ): void {
    // 2:1 axonometric vectors: +u -> (+u, +u/2), +v -> (-v, +v/2)
    // Center bottom diamond at (cx, cy)
    const bx = cx;
    const by = cy + (u + v) * 0.25;
    const lx = cx - v;
    const ly = by - v * 0.5;
    const rx = cx + u;
    const ry = by - u * 0.5;
    const tx = cx + u - v;
    const ty = by - (u + v) * 0.5;

    // Left wall (lit side)
    g.fillStyle(leftCol, 1);
    g.beginPath();
    g.moveTo(lx, ly);
    g.lineTo(bx, by);
    g.lineTo(bx, by - h);
    g.lineTo(lx, ly - h);
    g.closePath();
    g.fillPath();

    // Right wall (shaded side)
    g.fillStyle(rightCol, 1);
    g.beginPath();
    g.moveTo(bx, by);
    g.lineTo(rx, ry);
    g.lineTo(rx, ry - h);
    g.lineTo(bx, by - h);
    g.closePath();
    g.fillPath();

    // Top roof (brightest)
    g.fillStyle(topCol, 1);
    g.beginPath();
    g.moveTo(tx, ty - h);
    g.lineTo(rx, ry - h);
    g.lineTo(bx, by - h);
    g.lineTo(lx, ly - h);
    g.closePath();
    g.fillPath();

    // Crisp mechanical outline
    g.lineStyle(1.4, edgeCol, 0.85);
    g.beginPath();
    g.moveTo(tx, ty - h);
    g.lineTo(rx, ry - h);
    g.lineTo(rx, ry);
    g.lineTo(bx, by);
    g.lineTo(lx, ly);
    g.lineTo(lx, ly - h);
    g.closePath();
    g.strokePath();
  }

  private redrawStatic(): void {
    if (!this.currentState) return;
    const { progression } = this.currentState;
    const L = this.getLayout();
    const s = L.s;

    // 1. Background sky + distant girder
    this.bgGraphics.clear();
    this.bgGraphics.fillStyle(0x111a29, 1);
    this.bgGraphics.fillRect(0, 0, L.w, L.h);

    for (const st of this.stars) {
      this.bgGraphics.fillStyle(0xd9e4f2, st.a);
      this.bgGraphics.fillCircle(st.nx * L.w, st.ny * L.h, st.r);
    }

    // Subtle distant orbital truss (low contrast background architecture)
    this.bgGraphics.lineStyle(1.5, 0x223247, 0.55);
    this.bgGraphics.beginPath();
    this.bgGraphics.moveTo(0, L.cy - 92 * s);
    this.bgGraphics.lineTo(L.w, L.cy - 54 * s);
    this.bgGraphics.strokePath();

    // 2. Main 2:1 Axonometric Station Deck Platform
    this.deckGraphics.clear();
    // Deck underside thickness
    this.deckGraphics.fillStyle(0x182334, 1);
    this.deckGraphics.beginPath();
    this.deckGraphics.moveTo(L.cx - 184 * s, L.cy + 14 * s);
    this.deckGraphics.lineTo(L.cx, L.cy + 106 * s);
    this.deckGraphics.lineTo(L.cx + 184 * s, L.cy + 14 * s);
    this.deckGraphics.lineTo(L.cx + 184 * s, L.cy + 28 * s);
    this.deckGraphics.lineTo(L.cx, L.cy + 120 * s);
    this.deckGraphics.lineTo(L.cx - 184 * s, L.cy + 28 * s);
    this.deckGraphics.closePath();
    this.deckGraphics.fillPath();

    // Deck top diamond (exact 2:1 ratio: rx = 184, ry = 92)
    this.isoDiamond(this.deckGraphics, L.cx, L.cy + 14 * s, 184 * s, 92 * s, 0x26364a, 1, 0x566477, 2);
    // Inner industrial walkway panel lines (2:1 parallel)
    this.isoDiamond(this.deckGraphics, L.cx, L.cy + 14 * s, 152 * s, 76 * s, 0x223143, 0.7, 0x3b4d63, 1);

    // Docking pad markings for primary salvage ship
    this.isoDiamond(
      this.deckGraphics,
      L.mainShip.x,
      L.mainShip.y,
      54 * s,
      27 * s,
      0x1c293a,
      1,
      0xf6b852,
      1.6
    );

    // 3. Buildings (drawn back-to-front by ground anchor Y!)
    this.bldGraphics.clear();

    // --- Back: Collection Display (收藏展台) ---
    this.drawDisplayBuilding(L.display.x, L.display.y, s, progression.buildings.display, Boolean(progression.relics.ancient_navigator?.restored));

    // --- Mid-Left: Workbench (拆解工作台) ---
    this.drawWorkbenchBuilding(L.workbench.x, L.workbench.y, s, progression.buildings.workbench);

    // --- Mid-Right: Drydock (船坞扩建) ---
    this.drawDrydockBuilding(L.drydock.x, L.drydock.y, s, progression.buildings.drydock);

    // --- Foreground: Primary Salvage Ship (always docked at base) ---
    this.drawDockedMiniShip(
      this.bldGraphics,
      L.mainShip.x,
      L.mainShip.y - 4 * s,
      s,
      progression.selectedLoadout === 'shield_cruiser' && progression.buildings.drydock
    );

    // Update interactive hit zones & labels
    const posMap: Record<BuildingId, { x: number; y: number; built: boolean }> = {
      workbench: { x: L.workbench.x, y: L.workbench.y, built: progression.buildings.workbench },
      display: { x: L.display.x, y: L.display.y, built: progression.buildings.display },
      drydock: { x: L.drydock.x, y: L.drydock.y, built: progression.buildings.drydock },
    };

    for (const item of this.hitZones) {
      const p = posMap[item.id];
      const visible = item.id === 'workbench' || progression.buildings.workbench;
      item.zone.setPosition(p.x, p.y - 16 * s).setSize(96 * s, 74 * s).setVisible(visible);
      item.label
        .setPosition(p.x, p.y - 52 * s)
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

    this.drawDynamicLayer();
  }

  private drawWorkbenchBuilding(x: number, y: number, s: number, repaired: boolean): void {
    const g = this.bldGraphics;
    // Pad base (identical footprint in both states)
    this.isoDiamond(g, x, y + 6 * s, 48 * s, 24 * s, 0x1a2636, 1, 0x45566b, 1.2);

    if (!repaired) {
      // Worn: dark unpowered bay, folded mechanical arm, patched roof
      this.isoBox(g, x, y + 4 * s, 32 * s, 26 * s, 24 * s, 0x435060, 0x333f4e, 0x242e3b, 0x627285);
      // Welded patch plate on roof
      this.isoDiamond(g, x + 2 * s, y - 20 * s, 12 * s, 6 * s, 0x5c534a, 1);
      // Folded inactive crane arm
      g.lineStyle(3 * s, 0x566477, 1);
      g.beginPath();
      g.moveTo(x - 10 * s, y - 22 * s);
      g.lineTo(x + 8 * s, y - 30 * s);
      g.lineTo(x + 16 * s, y - 20 * s);
      g.strokePath();
    } else {
      // Repaired: full structure, tool wall, warm lit bay, active gantry
      this.isoBox(g, x, y + 4 * s, 32 * s, 26 * s, 26 * s, 0x5f7186, 0x48586c, 0x324052, 0x9ab0c7);
      // Tool wall accent strip on left face
      g.fillStyle(0xf6b852, 0.9);
      g.fillRect(x - 20 * s, y - 14 * s, 14 * s, 4 * s);
      // Warm overhead work lamp housing
      this.isoBox(g, x + 2 * s, y - 22 * s, 16 * s, 12 * s, 8 * s, 0x76899f, 0x53657a, 0x3a495c, 0xa8bdd3);
      // Warm amber work light cone on deck
      g.fillStyle(0xf6b852, 0.14);
      g.fillEllipse(x - 4 * s, y + 8 * s, 52 * s, 24 * s);
      // Bright lamp beacon
      g.fillStyle(0xf6b852, 1);
      g.fillCircle(x + 2 * s, y - 32 * s, 3.6 * s);
    }
  }

  private drawDisplayBuilding(
    x: number,
    y: number,
    s: number,
    repaired: boolean,
    hasRestoredRelic: boolean
  ): void {
    const g = this.bldGraphics;
    this.isoDiamond(g, x, y + 6 * s, 46 * s, 23 * s, 0x1a2636, 1, 0x45566b, 1.2);

    if (!repaired) {
      // Worn: sealed pedestal with folded protective tarp
      this.isoBox(g, x, y + 4 * s, 28 * s, 28 * s, 14 * s, 0x485463, 0x36414f, 0x26303d, 0x627285);
      // Tarp cover
      this.isoBox(g, x, y - 10 * s, 18 * s, 18 * s, 12 * s, 0x585c63, 0x454952, 0x333740, 0x767c85);
    } else {
      // Repaired: finished display plinth + glass showcase dome + directional spotlight
      this.isoBox(g, x, y + 4 * s, 28 * s, 28 * s, 16 * s, 0x66798f, 0x4c5d72, 0x354354, 0xa2b7cd);
      // Glass dome walls (translucent cyan tint)
      g.fillStyle(0x62d6df, 0.16);
      g.lineStyle(1.6, 0x89dfe6, 0.75);
      g.fillRoundedRect(x - 18 * s, y - 40 * s, 36 * s, 32 * s, 8 * s);
      g.strokeRoundedRect(x - 18 * s, y - 40 * s, 36 * s, 32 * s, 8 * s);
      // Spotlight beam
      g.fillStyle(0xf6b852, hasRestoredRelic ? 0.22 : 0.1);
      g.fillTriangle(x, y - 42 * s, x - 14 * s, y - 10 * s, x + 14 * s, y - 10 * s);
      // Restored ancient navigator static pedestal base
      if (hasRestoredRelic) {
        g.lineStyle(2 * s, 0xf6b852, 1);
        g.strokeCircle(x, y - 24 * s, 9 * s);
        g.lineStyle(1.5 * s, 0x62d6df, 0.95);
        g.strokeCircle(x, y - 24 * s, 5 * s);
      }
    }
  }

  private drawDrydockBuilding(x: number, y: number, s: number, repaired: boolean): void {
    const g = this.bldGraphics;
    this.isoDiamond(g, x, y + 8 * s, 56 * s, 28 * s, 0x1a2636, 1, 0x45566b, 1.2);

    if (!repaired) {
      // Worn: shuttered sealed bay & broken guide rails
      this.isoBox(g, x, y + 4 * s, 34 * s, 28 * s, 18 * s, 0x424e5e, 0x313c4b, 0x222c38, 0x607083);
      g.lineStyle(2 * s, 0x5c6878, 0.8);
      g.lineBetween(x - 24 * s, y + 10 * s, x - 6 * s, y + 19 * s);
    } else {
      // Repaired: expanded open berth gantry + glowing guide lights + docked Shield Cruiser
      this.isoBox(g, x + 12 * s, y - 8 * s, 14 * s, 30 * s, 32 * s, 0x607389, 0x46586d, 0x2f3e50, 0x9ab0c7);
      // Guide rails with warm amber guide beacons
      g.lineStyle(2.2 * s, 0xf6b852, 0.9);
      g.lineBetween(x - 36 * s, y + 12 * s, x - 2 * s, y + 29 * s);
      g.fillStyle(0xf6b852, 1);
      g.fillCircle(x - 34 * s, y + 12 * s, 2.5 * s);
      g.fillCircle(x - 18 * s, y + 20 * s, 2.5 * s);
      g.fillCircle(x - 2 * s, y + 28 * s, 2.5 * s);
      // Second ship (Shield Cruiser) parked inside expanded drydock!
      this.drawDockedMiniShip(g, x - 12 * s, y + 4 * s, s * 0.85, true);
    }
  }

  private drawDockedMiniShip(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    s: number,
    isShieldVariant: boolean
  ): void {
    // 2:1 axonometric miniature docked salvage vessel
    this.isoBox(
      g,
      x,
      y,
      26 * s,
      isShieldVariant ? 20 * s : 16 * s,
      11 * s,
      isShieldVariant ? 0x738ba4 : 0x7b8da1,
      isShieldVariant ? 0x4d647c : 0x56687c,
      0x344456,
      0xb2c6db
    );
    // Warm cockpit window
    g.fillStyle(0xf6b852, 1);
    g.fillCircle(x + 8 * s, y - 10 * s, 3.2 * s);
    // Cyan accent on shield variant or cannon tip on cannon skiff
    g.fillStyle(0x62d6df, 1);
    if (isShieldVariant) {
      g.fillRoundedRect(x - 12 * s, y - 9 * s, 10 * s, 4 * s, 2);
    } else {
      g.fillRect(x + 14 * s, y - 7 * s, 10 * s, 3 * s);
    }
  }

  private drawDynamicLayer(): void {
    this.animGraphics.clear();
    if (!this.currentState) return;
    const { progression, settings } = this.currentState;
    const L = this.getLayout();
    const s = L.s;
    const t = settings.reducedMotion ? 0 : this.elapsed;

    // Animated welding robot arm & sparks when workbench is repaired
    if (progression.buildings.workbench) {
      const wx = L.workbench.x;
      const wy = L.workbench.y;
      const swing = Math.sin(t * 2.4) * 7 * s;
      this.animGraphics.lineStyle(2.5 * s, 0xf6b852, 0.95);
      this.animGraphics.beginPath();
      this.animGraphics.moveTo(wx - 12 * s, wy - 20 * s);
      this.animGraphics.lineTo(wx - 22 * s + swing * 0.4, wy - 34 * s);
      this.animGraphics.lineTo(wx - 10 * s + swing, wy - 16 * s);
      this.animGraphics.strokePath();

      // Occasional welding spark (disabled in lowQuality / reducedMotion)
      if (!settings.reducedMotion && !settings.lowQuality && Math.sin(t * 9) > 0.4) {
        this.animGraphics.fillStyle(0xf6b852, 0.95);
        this.animGraphics.fillCircle(wx - 10 * s + swing, wy - 16 * s, 3.2 * s);
        this.animGraphics.fillStyle(0x62d6df, 0.85);
        this.animGraphics.fillCircle(wx - 13 * s + swing, wy - 19 * s, 1.8 * s);
      }

      // Small hovering maintenance bot patrolling station walkway
      const angle = t * 0.65;
      const bx = L.cx + Math.cos(angle) * 62 * s;
      const by = L.cy + 26 * s + Math.sin(angle) * 26 * s;
      this.animGraphics.fillStyle(0x899fb5, 1);
      this.animGraphics.fillCircle(bx, by - 8 * s, 4.2 * s);
      this.animGraphics.fillStyle(0x62d6df, 0.95);
      this.animGraphics.fillCircle(bx, by - 8 * s, 1.8 * s);
    }

    // Restored Ancient Navigator gentle pulsing star-ring in Collection Display
    if (progression.buildings.display && progression.relics.ancient_navigator?.restored) {
      const dx = L.display.x;
      const dy = L.display.y - 24 * s;
      const r = (9 + Math.sin(t * 2.2) * 1.2) * s;
      this.animGraphics.lineStyle(1.8 * s, 0x62d6df, 0.75);
      this.animGraphics.strokeCircle(dx, dy, r);
    }

    // Fresh construction celebration sparks (≤ 1.8s, disabled in reducedMotion)
    if (this.buildCelebrateTimer > 0 && this.celebrateBuilding && !settings.reducedMotion) {
      const target = L[this.celebrateBuilding];
      const progress = 1 - this.buildCelebrateTimer / 1.8;
      const count = settings.lowQuality ? 6 : 16;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + progress * 1.2;
        const dist = (14 + progress * 44) * s;
        const px = target.x + Math.cos(a) * dist;
        const py = target.y - 16 * s + Math.sin(a) * dist * 0.6;
        this.animGraphics.fillStyle(i % 2 === 0 ? 0xf6b852 : 0x62d6df, Math.max(0, 1 - progress));
        this.animGraphics.fillCircle(px, py, 2.6 * s);
      }
    }
  }
}
