import type Phaser from 'phaser';

/**
 * High-craft 2:1 Axonometric Miniature Industrial Sci-Fi Asset Generator for BaseScene (F04).
 *
 * Projection contract (Art Spec §3 & §9):
 * - Ground axes have exact slopes ±1/2: screen(u, v, z) = (ax + (u - v), ay + (u + v) * 0.5 - z)
 * - Verticals remain strictly vertical.
 * - Main light from top-left -> top face brightest, left face medium-lit, right face deep-shaded,
 *   soft grounded bottom-right contact shadows, matte painted metal, beveled edges, wear & rivets.
 * - Worn & Repaired versions of every building share IDENTICAL 512x512 canvas & ground anchor (256, 336)
 *   so upgrading NEVER shifts or jumps.
 */

export const BASE_BUILDING_TEX_W = 512;
export const BASE_BUILDING_TEX_H = 512;
export const BASE_BUILDING_ANCHOR_X = 256;
export const BASE_BUILDING_ANCHOR_Y = 336;
export const BASE_BUILDING_ANCHOR_NX = BASE_BUILDING_ANCHOR_X / BASE_BUILDING_TEX_W;
export const BASE_BUILDING_ANCHOR_NY = BASE_BUILDING_ANCHOR_Y / BASE_BUILDING_TEX_H;

export const BASE_DECK_TEX_W = 1024;
export const BASE_DECK_TEX_H = 1024;
export const BASE_DECK_ANCHOR_Y = 540;

export const BASE_SHIP_TEX_W = 256;
export const BASE_SHIP_TEX_H = 256;
export const BASE_SHIP_ANCHOR_Y = 152;

type Pt = readonly [number, number];

class IsoPainter {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly ax: number;
  private readonly ay: number;

  constructor(ctx: CanvasRenderingContext2D, ax: number, ay: number) {
    this.ctx = ctx;
    this.ax = ax;
    this.ay = ay;
  }

  p(u: number, v: number, z = 0): Pt {
    return [this.ax + (u - v), this.ay + (u + v) * 0.5 - z];
  }

  poly(
    pts: readonly Pt[],
    fill?: string | CanvasGradient,
    stroke?: string,
    lineWidth = 2
  ): void {
    const c = this.ctx;
    c.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? c.moveTo(x, y) : c.lineTo(x, y)));
    c.closePath();
    if (fill) {
      c.fillStyle = fill;
      c.fill();
    }
    if (stroke && lineWidth > 0) {
      c.strokeStyle = stroke;
      c.lineWidth = lineWidth;
      c.lineJoin = 'round';
      c.stroke();
    }
  }

  line(a: Pt, b: Pt, stroke: string, lineWidth = 2, dash?: number[]): void {
    const c = this.ctx;
    c.save();
    if (dash) c.setLineDash(dash);
    c.beginPath();
    c.moveTo(a[0], a[1]);
    c.lineTo(b[0], b[1]);
    c.strokeStyle = stroke;
    c.lineWidth = lineWidth;
    c.lineCap = 'round';
    c.stroke();
    c.restore();
  }

  /** Grounded soft bottom-right contact shadow */
  groundShadow(u0: number, v0: number, u1: number, v1: number, offsetU = 10, offsetV = 2, alpha = 0.42): void {
    const pts = [
      this.p(u0 + offsetU, v0 + offsetV, 0),
      this.p(u1 + offsetU, v0 + offsetV, 0),
      this.p(u1 + offsetU, v1 + offsetV, 0),
      this.p(u0 + offsetU, v1 + offsetV, 0),
    ];
    this.ctx.save();
    this.ctx.filter = 'blur(5px)';
    this.poly(pts, `rgba(5, 10, 18, ${alpha})`);
    this.ctx.restore();
  }

  /** Draw a 2:1 axonometric solid block with top-left directional shading & crisp bevel highlights */
  box(
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    z0: number,
    z1: number,
    colors: {
      top: string;
      topDark?: string;
      left: string;
      right: string;
      edge?: string;
      highlight?: string;
    },
    edgeWidth = 2
  ): void {
    const c = this.ctx;
    // Bottom vertices
    const b00 = this.p(u0, v0, z0); // back
    const b10 = this.p(u1, v0, z0); // right
    const b11 = this.p(u1, v1, z0); // front-bottom
    const b01 = this.p(u0, v1, z0); // left
    // Top vertices
    const t00 = this.p(u0, v0, z1);
    const t10 = this.p(u1, v0, z1);
    const t11 = this.p(u1, v1, z1);
    const t01 = this.p(u0, v1, z1);

    // Left visible face (v = v1, spans u0 -> u1, faces front-left, catches top-left light)
    const leftGrad = c.createLinearGradient(t01[0], t01[1], b11[0], b11[1]);
    leftGrad.addColorStop(0, colors.left);
    leftGrad.addColorStop(1, '#202c3b');
    this.poly([t01, t11, b11, b01], leftGrad, colors.edge ?? '#1a2433', edgeWidth);

    // Right visible face (u = u1, spans v0 -> v1, faces front-right, shaded)
    const rightGrad = c.createLinearGradient(t11[0], t11[1], b10[0], b10[1]);
    rightGrad.addColorStop(0, colors.right);
    rightGrad.addColorStop(1, '#151e2b');
    this.poly([t11, t10, b10, b11], rightGrad, colors.edge ?? '#1a2433', edgeWidth);

    // Top face (z = z1, brightest lit from top-left)
    const topGrad = c.createLinearGradient(t00[0], t00[1], t11[0], t11[1]);
    topGrad.addColorStop(0, colors.top);
    topGrad.addColorStop(1, colors.topDark ?? colors.left);
    this.poly([t00, t10, t11, t01], topGrad, colors.edge ?? '#1a2433', edgeWidth);

    // Crisp lit top-left bevel ridge (wear-catches light without neon)
    if (colors.highlight !== 'none') {
      const hi = colors.highlight ?? 'rgba(218, 232, 246, 0.42)';
      this.line(t00, t01, hi, 1.8);
      this.line(t01, t11, hi, 1.5);
      this.line(t00, t10, 'rgba(200, 218, 236, 0.25)', 1.2);
    }
    // Suppress unused b00 warning
    void b00;
  }

  /** Draw a 2:1 axonometric flat deck tile at height z */
  quadZ(
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    z: number,
    fill: string | CanvasGradient,
    stroke?: string,
    lineWidth = 1.5
  ): void {
    this.poly(
      [this.p(u0, v0, z), this.p(u1, v0, z), this.p(u1, v1, z), this.p(u0, v1, z)],
      fill,
      stroke,
      lineWidth
    );
  }

  /** Draw an axonometric face on the front-left plane (fixed v) */
  faceLeft(
    u0: number,
    u1: number,
    v: number,
    z0: number,
    z1: number,
    fill: string | CanvasGradient,
    stroke?: string,
    lineWidth = 1.5
  ): void {
    this.poly(
      [this.p(u0, v, z1), this.p(u1, v, z1), this.p(u1, v, z0), this.p(u0, v, z0)],
      fill,
      stroke,
      lineWidth
    );
  }

  /** Draw an axonometric face on the front-right plane (fixed u) */
  faceRight(
    u: number,
    v0: number,
    v1: number,
    z0: number,
    z1: number,
    fill: string | CanvasGradient,
    stroke?: string,
    lineWidth = 1.5
  ): void {
    this.poly(
      [this.p(u, v0, z1), this.p(u, v1, z1), this.p(u, v1, z0), this.p(u, v0, z0)],
      fill,
      stroke,
      lineWidth
    );
  }

  /** Draw industrial yellow-dark hazard chevron strip along u axis at fixed v */
  hazardStripU(u0: number, u1: number, v0: number, v1: number, z: number, count = 5): void {
    this.quadZ(u0, v0, u1, v1, z, '#232d3b', '#141d29', 1);
    const step = (u1 - u0) / count;
    for (let i = 0; i < count; i++) {
      if (i % 2 === 0) {
        this.quadZ(u0 + i * step, v0, u0 + (i + 0.6) * step, v1, z, '#d9a145');
      }
    }
  }

  /** Vertical cylinder/pillar at (u, v) from z0 to z1 */
  cylinder(
    u: number,
    v: number,
    radius: number,
    z0: number,
    z1: number,
    bodyLeft: string,
    bodyRight: string,
    topCol: string
  ): void {
    const c = this.ctx;
    const [bx, by] = this.p(u, v, z0);
    const [tx, ty] = this.p(u, v, z1);
    const ry = radius * 0.5;
    const grad = c.createLinearGradient(bx - radius, by, bx + radius, by);
    grad.addColorStop(0, bodyLeft);
    grad.addColorStop(0.6, bodyRight);
    grad.addColorStop(1, '#182230');

    c.beginPath();
    c.ellipse(bx, by, radius, ry, 0, 0, Math.PI);
    c.lineTo(tx - radius, ty);
    c.ellipse(tx, ty, radius, ry, 0, Math.PI, 0, true);
    c.closePath();
    c.fillStyle = grad;
    c.fill();
    c.strokeStyle = '#1b2635';
    c.lineWidth = 1.6;
    c.stroke();

    c.beginPath();
    c.ellipse(tx, ty, radius, ry, 0, 0, Math.PI * 2);
    c.fillStyle = topCol;
    c.fill();
    c.strokeStyle = 'rgba(210,226,242,0.5)';
    c.lineWidth = 1.4;
    c.stroke();
  }

  /** Subtle warm or cyan radial light pool on deck */
  lightPool(u: number, v: number, z: number, rx: number, colorRgb: string, peakAlpha: number): void {
    const c = this.ctx;
    const [x, y] = this.p(u, v, z);
    c.save();
    c.translate(x, y);
    c.scale(1, 0.5);
    const grad = c.createRadialGradient(0, 0, 2, 0, 0, rx);
    grad.addColorStop(0, `rgba(${colorRgb}, ${peakAlpha})`);
    grad.addColorStop(0.55, `rgba(${colorRgb}, ${peakAlpha * 0.45})`);
    grad.addColorStop(1, `rgba(${colorRgb}, 0)`);
    c.fillStyle = grad;
    c.beginPath();
    c.arc(0, 0, rx, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  /** Deterministic subtle steel wear scratches & rivets */
  wearMarks(pts: readonly [number, number, number][], color = 'rgba(195,212,230,0.42)'): void {
    const c = this.ctx;
    c.strokeStyle = color;
    c.lineWidth = 1.4;
    for (const [u, v, z] of pts) {
      const [x, y] = this.p(u, v, z);
      c.beginPath();
      c.moveTo(x - 4, y - 1);
      c.lineTo(x + 4, y + 2);
      c.stroke();
    }
  }
}

function registerCanvas(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D) => void
): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, w, h);
  draw(ctx);
  tex.refresh();
}

/**
 * 1. Station Main Orbital Platform Deck (1024x640, exact 2:1 axonometric).
 * Features structural girder skirt, segmented grating panels, cable trenches, safety railings,
 * mooring bollards, and an illuminated primary docking pad with tie-down clamps.
 */
function drawStationDeck(ctx: CanvasRenderingContext2D): void {
  const ax = 512;
  const ay = BASE_DECK_ANCHOR_Y;
  const iso = new IsoPainter(ctx, ax, ay);

  // Heavy lower structural girder skirt under deck
  iso.box(-236, -236, 236, 236, -34, -8, {
    top: '#243346',
    left: '#1e2c3d',
    right: '#141e2b',
    edge: '#101824',
    highlight: 'none',
  });

  // Under-deck vertical truss ribs along front-left and front-right edges
  for (let i = -200; i <= 200; i += 44) {
    iso.line(iso.p(i, 236, -8), iso.p(i, 236, -34), '#3b4e66', 4);
    iso.line(iso.p(i + 22, 236, -8), iso.p(i, 236, -34), '#2c3d52', 2);
    iso.line(iso.p(236, i, -8), iso.p(236, i, -34), '#28384c', 4);
    iso.line(iso.p(236, i + 22, -8), iso.p(236, i, -34), '#1c2939', 2);
  }

  // Main upper deck slab (beveled heavy industrial armor)
  iso.box(-244, -244, 244, 244, -8, 0, {
    top: '#34465c',
    topDark: '#243346',
    left: '#43566e',
    right: '#263447',
    edge: '#60758e',
    highlight: 'rgba(182, 204, 226, 0.5)',
  });

  // Segmented industrial deck steel panels & recessed walkway grid
  for (let u = -220; u <= 220; u += 55) {
    iso.line(iso.p(u, -220, 0.5), iso.p(u, 220, 0.5), 'rgba(20, 31, 46, 0.65)', 1.5);
    iso.line(iso.p(-220, u, 0.5), iso.p(220, u, 0.5), 'rgba(20, 31, 46, 0.65)', 1.5);
  }

  // Recessed central service cross-corridor (darker steel grating with amber guide seams)
  iso.quadZ(-220, -24, 220, 24, 0.5, '#1f2d3e', '#4c6078', 1.4);
  iso.quadZ(-24, -220, 24, 220, 0.5, '#1f2d3e', '#4c6078', 1.4);
  // Subtle industrial cable conduit lines along walkway edges
  iso.line(iso.p(-215, -18, 1), iso.p(215, -18, 1), 'rgba(98, 214, 223, 0.22)', 2, [10, 8]);
  iso.line(iso.p(-18, -215, 1), iso.p(-18, 215, 1), 'rgba(246, 184, 82, 0.24)', 2, [12, 8]);

  // Back-edge safety guardrails & orbital antenna stanchions (never occlude foreground!)
  for (let t = -220; t <= 220; t += 44) {
    iso.line(iso.p(t, -236, 0), iso.p(t, -236, 16), '#6b8099', 2.2);
    iso.line(iso.p(-236, t, 0), iso.p(-236, t, 16), '#768ca6', 2.2);
  }
  iso.line(iso.p(-236, -236, 16), iso.p(220, -236, 16), '#859bb4', 2);
  iso.line(iso.p(-236, -236, 16), iso.p(-236, 220, 16), '#93a9c2', 2);

  // Corner mooring bollards
  for (const [bu, bv] of [
    [-226, 226],
    [226, -226],
    [226, 226],
    [-226, -226],
  ]) {
    iso.cylinder(bu, bv, 8, 0, 14, '#7d93ac', '#46586e', '#9eb3ca');
  }

  // Primary Salvage Ship Docking Pad (front-left quadrant around u=-15..110, v=75..195 -> centered at u=45, v=135)
  // Wait: let's match BaseScene anchor mapping: mainShip is at u = +48, v = +118
  // Let's draw a crisp recessed landing pad centered at (u: 46, v: 118)
  iso.quadZ(-28, 48, 120, 188, 0.8, '#172333', '#566b83', 2);
  iso.quadZ(-18, 58, 110, 178, 1.2, '#1c2a3c', '#f6b852', 2.2);
  // Landing pad H-alignment rails & exhaust scorch mark
  iso.lightPool(46, 118, 1.5, 42, '10, 16, 26', 0.45);
  iso.hazardStripU(-24, 116, 180, 188, 1.4, 10);
  // Corner pad clamp beacons
  for (const [cu, cv] of [
    [-20, 56],
    [112, 56],
    [-20, 180],
    [112, 180],
  ]) {
    iso.box(cu - 5, cv - 5, cu + 5, cv + 5, 0, 7, {
      top: '#f6b852',
      left: '#607389',
      right: '#374759',
      edge: '#16202e',
    });
  }
}

/**
 * 2. Salvage Workbench (拆解工作台) — Worn vs Repaired (512x512, anchor 256,336).
 * Unmistakable visual identity even without text: heavy cutting bench, back tool pegboard wall,
 * overhead gantry light bar, workpiece hull plate, plasma canister & articulated crane mount.
 */
function drawWorkbench(ctx: CanvasRenderingContext2D, repaired: boolean): void {
  const iso = new IsoPainter(ctx, BASE_BUILDING_ANCHOR_X, BASE_BUILDING_ANCHOR_Y);

  // Exact shared foundation pad (u: -88..88, v: -76..76)
  iso.groundShadow(-86, -74, 92, 82, 14, 4, 0.45);
  iso.box(-88, -76, 88, 76, 0, 10, {
    top: '#2e3e52',
    topDark: '#233143',
    left: '#3f5166',
    right: '#222f40',
    edge: '#5a6e86',
  });
  iso.hazardStripU(-82, 82, 66, 74, 10.6, 8);

  // Back structural tool-wall bulkhead (u: -80..72, v: -72..-54, z: 10..112)
  iso.box(-80, -72, 72, -54, 10, 112, {
    top: repaired ? '#647890' : '#4a5666',
    left: repaired ? '#506278' : '#3a4554',
    right: repaired ? '#334254' : '#26303d',
    edge: '#1a2433',
  });

  // Back tool pegboard panel on the wall face (v = -53.5)
  iso.faceLeft(-68, 56, -53.5, 34, 98, repaired ? '#243447' : '#1e2733', '#6e839b', 2);

  if (!repaired) {
    // WORN STATE: dark broken wall, crooked wrench, welded patch plate, dark overhead hood, dusty debris
    // Mismatched rust-brown patch plate bolted over wall damage
    iso.faceLeft(-52, -10, -53, 46, 82, '#5c5047', '#8b7b6e', 1.8);
    // One lone crooked wrench hanging on empty pegboard
    iso.line(iso.p(16, -52.5, 76), iso.p(30, -52.5, 56), '#7e8fa3', 4);
    // Dark unpowered workbench table with dented hull scrap
    iso.box(-56, -34, 48, 34, 10, 44, {
      top: '#445160',
      topDark: '#36414f',
      left: '#35414f',
      right: '#242e3b',
      edge: '#19222e',
    });
    // Scattered rusty scrap plate on table
    iso.box(-32, -16, 22, 16, 44, 52, {
      top: '#6b5b4e',
      left: '#52463d',
      right: '#3a322c',
      edge: '#201c1a',
    });
    // Folded inactive robotic gantry pillar (left side)
    iso.box(-76, -42, -52, -14, 10, 86, {
      top: '#4b5868',
      left: '#3a4656',
      right: '#283240',
      edge: '#18212d',
    });
    // Folded limp crane boom resting down
    iso.line(iso.p(-64, -26, 84), iso.p(-36, -12, 98), '#5a687a', 7);
    iso.line(iso.p(-36, -12, 98), iso.p(-20, 4, 62), '#465466', 6);
    // Overhead lamp canopy (powered OFF)
    iso.box(-72, -62, 64, -18, 108, 122, {
      top: '#455262',
      left: '#374352',
      right: '#242f3d',
      edge: '#18212d',
    });
    iso.wearMarks([
      [-40, 34, 30],
      [20, 34, 24],
      [60, -20, 60],
    ]);
  } else {
    // REPAIRED STATE: warm glowing overhead work lamps, full pegboard tools, lit diagnostic screen,
    // heavy steel cutting bench with glowing plasma weld seam, pressurized fuel tanks, and active robot shoulder mount!
    // Overhead illuminated canopy & twin warm floodlight fixtures
    iso.box(-74, -64, 66, -12, 110, 126, {
      top: '#71869e',
      topDark: '#55687f',
      left: '#576b82',
      right: '#38485c',
      edge: '#1b2736',
    });
    // Twin warm glowing lamp bars under canopy
    iso.quadZ(-58, -42, -10, -22, 109, '#f6b852');
    iso.quadZ(8, -42, 54, -22, 109, '#f6b852');
    // Overhead amber rotating safety beacon on roof
    iso.cylinder(48, -44, 9, 126, 140, '#f6b852', '#c9882d', '#ffe09e');

    // Warm work-light pool washing across the bench and deck!
    iso.lightPool(-4, 4, 46, 86, '246, 184, 82', 0.24);
    iso.lightPool(0, 16, 11, 105, '246, 184, 82', 0.16);

    // Tool pegboard wall details: hanging industrial tools + illuminated diagnostic monitor!
    // Glowing cyan diagnostic monitor on left side of wall
    iso.faceLeft(-60, -22, -53, 52, 90, '#142636', '#62d6df', 2);
    iso.line(iso.p(-54, -52.5, 78), iso.p(-28, -52.5, 78), '#62d6df', 2.5);
    iso.line(iso.p(-54, -52.5, 68), iso.p(-36, -52.5, 68), '#f6b852', 2.5);
    iso.line(iso.p(-54, -52.5, 60), iso.p(-30, -52.5, 60), '#89b4c4', 2);
    // Hanging wrench, cutter, caliper & spare gear silhouettes on pegboard
    iso.line(iso.p(-6, -52.5, 88), iso.p(-6, -52.5, 52), '#c9d7e6', 4);
    iso.line(iso.p(10, -52.5, 86), iso.p(10, -52.5, 56), '#f6b852', 4.5);
    iso.line(iso.p(26, -52.5, 88), iso.p(26, -52.5, 54), '#b6c7d9', 4);
    iso.line(iso.p(42, -52.5, 84), iso.p(42, -52.5, 58), '#62d6df', 4);
    // Tool shelf rail
    iso.box(-14, -54, 52, -40, 36, 44, {
      top: '#70849c',
      left: '#52657b',
      right: '#354457',
      edge: '#1b2635',
    });

    // Reinforced main salvage workbench table (heavy slotted steel bed + drawers)
    iso.box(-56, -34, 48, 34, 10, 48, {
      top: '#687d94',
      topDark: '#4f6278',
      left: '#52657b',
      right: '#344457',
      edge: '#1c2838',
    });
    // Tool cabinet drawers on front-left side of workbench
    for (const [du0, du1] of [
      [-48, -14],
      [-4, 38],
    ]) {
      iso.faceLeft(du0, du1, 34.5, 16, 40, '#2a3a4e', '#7b91a9', 1.6);
      iso.line(iso.p(du0 + 8, 35, 34), iso.p(du1 - 8, 35, 34), '#f6b852', 2.4);
      iso.line(iso.p(du0 + 8, 35, 24), iso.p(du1 - 8, 35, 24), '#9fb4ca', 2);
    }

    // Half-disassembled salvage hull plate clamped on the workbench with warm glowing cut seam
    iso.box(-34, -18, 28, 18, 48, 58, {
      top: '#7d92aa',
      topDark: '#5b6f85',
      left: '#5c7086',
      right: '#3c4d61',
      edge: '#202d3d',
    });
    iso.line(iso.p(-22, -4, 59), iso.p(16, 8, 59), '#f6b852', 3);
    iso.line(iso.p(-20, -4, 59), iso.p(12, 6, 59), '#fff0c2', 1.2);

    // Active robot welder shoulder turret mount (left column — BaseScene animates the moving arm from here!)
    iso.box(-78, -44, -50, -12, 10, 76, {
      top: '#758aa2',
      left: '#586c83',
      right: '#38485c',
      edge: '#1b2635',
    });
    iso.cylinder(-64, -28, 13, 76, 92, '#f6b852', '#c8872b', '#ffd584');

    // Twin pressurized plasma/coolant cylinders strapped at right side of bench
    iso.cylinder(66, -24, 10, 10, 56, '#62d6df', '#2d7b85', '#a9eef4');
    iso.cylinder(66, 2, 10, 10, 52, '#d89b3e', '#8e6122', '#f7ca78');
    // Neat alloy salvage crate stacked on front-right
    iso.box(52, 26, 78, 54, 10, 32, {
      top: '#8c7250',
      left: '#6a553b',
      right: '#493a28',
      edge: '#241c13',
    });
  }
}

/**
 * 3. Collection Display (收藏展台) — Worn vs Repaired (Empty) vs Restored (Ancient Navigator inside!)
 * Shared 512x512 canvas & exact ground anchor (256, 336).
 */
function drawCollectionDisplay(
  ctx: CanvasRenderingContext2D,
  repaired: boolean,
  hasRestoredRelic: boolean
): void {
  const iso = new IsoPainter(ctx, BASE_BUILDING_ANCHOR_X, BASE_BUILDING_ANCHOR_Y);

  iso.groundShadow(-80, -80, 86, 86, 14, 4, 0.44);
  // Shared octagonal-trimmed exhibition deck base
  iso.box(-80, -80, 80, 80, 0, 12, {
    top: '#324357',
    topDark: '#233143',
    left: '#43556b',
    right: '#233042',
    edge: '#5d728a',
  });

  // Stepped inner exhibition plinth
  iso.box(-56, -56, 56, 56, 12, 30, {
    top: repaired ? '#647991' : '#4a5768',
    topDark: repaired ? '#4c5f75' : '#394452',
    left: repaired ? '#50647a' : '#3a4654',
    right: repaired ? '#334254' : '#26303d',
    edge: '#1c2635',
  });

  if (!repaired) {
    // WORN: mothballed plinth draped in matte canvas tarp with cargo straps & folded light pylons
    iso.box(-38, -38, 38, 38, 30, 72, {
      top: '#606670',
      topDark: '#4d525c',
      left: '#4f545e',
      right: '#383d46',
      edge: '#252930',
      highlight: 'rgba(180,190,202,0.3)',
    });
    // Crossed tie-down straps across tarp
    iso.line(iso.p(-38, 0, 72), iso.p(38, 0, 72), '#c48f3d', 3.5);
    iso.line(iso.p(0, -38, 72), iso.p(0, 38, 72), '#c48f3d', 3.5);
    iso.line(iso.p(0, 38, 72), iso.p(0, 38, 30), '#9c712f', 3.5);
    iso.line(iso.p(38, 0, 72), iso.p(38, 0, 30), '#7a5824', 3.5);
    // Folded unlit spotlight stanchions at back corners
    iso.box(-70, -70, -54, -54, 12, 42, {
      top: '#4e5c6d',
      left: '#3b4757',
      right: '#283240',
      edge: '#1a222d',
    });
    iso.box(54, -70, 70, -54, 12, 42, {
      top: '#4e5c6d',
      left: '#3b4757',
      right: '#283240',
      edge: '#1a222d',
    });
  } else {
    // REPAIRED: Museum-grade illuminated armored glass vitrine, twin overhead spotlights,
    // front specimen data plaque, and cradle (holding the brass-and-cyan Ancient Navigator if restored!)
    // Warm golden ambient floor glow around plinth
    iso.lightPool(0, 0, 31, 78, hasRestoredRelic ? '98, 214, 223' : '246, 184, 82', hasRestoredRelic ? 0.25 : 0.16);

    // Back twin spotlight gantry arches rising cleanly behind the glass showcase
    for (const [lu, lv] of [
      [-64, -64],
      [64, -64],
    ]) {
      iso.box(lu - 8, lv - 8, lu + 8, lv + 8, 12, 126, {
        top: '#788ea6',
        left: '#5b6f86',
        right: '#39495d',
        edge: '#1d2938',
      });
    }
    // Overhead spotlight cross-beam
    iso.box(-68, -70, 68, -56, 122, 134, {
      top: '#7c92aa',
      left: '#5b6f86',
      right: '#38485c',
      edge: '#1c2736',
    });
    // Focused directional warm spotlight emitter head
    iso.box(-14, -62, 14, -44, 114, 124, {
      top: '#8aa0b8',
      left: '#f6b852',
      right: '#c4872d',
      edge: '#1c2736',
    });

    // Inner mounting cradle on plinth top
    iso.cylinder(0, 0, 26, 30, 42, '#7d92a8', '#46586e', '#9eb4cb');
    iso.cylinder(0, 0, 18, 42, 48, '#f6b852', '#b37d2b', '#ffe09c');

    // Back glass pane faces (drawn before relic!)
    const glassBack = 'rgba(98, 214, 223, 0.10)';
    iso.faceLeft(-42, 42, -42, 30, 118, glassBack, 'rgba(138, 224, 232, 0.45)', 1.5);
    iso.faceRight(-42, -42, 42, 30, 118, glassBack, 'rgba(138, 224, 232, 0.45)', 1.5);

    // Directional light cone illuminating inside vitrine
    const [cx, cyTop] = iso.p(0, 0, 116);
    const [, cyBot] = iso.p(0, 0, 44);
    const coneGrad = ctx.createLinearGradient(cx, cyTop, cx, cyBot);
    coneGrad.addColorStop(0, 'rgba(246, 184, 82, 0.34)');
    coneGrad.addColorStop(1, 'rgba(246, 184, 82, 0.04)');
    ctx.fillStyle = coneGrad;
    ctx.beginPath();
    ctx.moveTo(cx - 10, cyTop);
    ctx.lineTo(cx + 10, cyTop);
    ctx.lineTo(cx + 42, cyBot);
    ctx.lineTo(cx - 42, cyBot);
    ctx.closePath();
    ctx.fill();

    // If Ancient Navigator is restored -> paint iconic miniature brass-and-cyan T-frame astrolabe inside!
    if (hasRestoredRelic) {
      const [rx, ry] = iso.p(0, 0, 78);
      // Support pedestal stem
      iso.cylinder(0, 0, 6, 48, 66, '#d2a24c', '#8a6627', '#f6c86e');
      // T-bar cross wings
      iso.box(-26, -6, 26, 6, 68, 76, {
        top: '#d9b060',
        left: '#a8813c',
        right: '#705425',
        edge: '#2d2211',
      });
      // Concentric brass & cyan astrolabe rings
      ctx.save();
      ctx.strokeStyle = '#f6b852';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(rx, ry, 24, 20, -0.25, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = '#62d6df';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.ellipse(rx, ry, 16, 13, 0.35, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#62d6df';
      ctx.beginPath();
      ctx.arc(rx, ry, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff4d1';
      ctx.beginPath();
      ctx.arc(rx, ry, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Front glass vitrine walls with crisp architectural corner mullions & specular glass streaks
    iso.faceLeft(-42, 42, 42, 30, 118, 'rgba(98, 214, 223, 0.14)', 'rgba(162, 232, 238, 0.72)', 2);
    iso.faceRight(42, -42, 42, 30, 118, 'rgba(72, 166, 182, 0.12)', 'rgba(130, 212, 222, 0.65)', 2);
    iso.quadZ(-42, -42, 42, 42, 118, 'rgba(155, 228, 236, 0.18)', 'rgba(182, 240, 245, 0.85)', 2);

    // Subtle diagonal glass specular reflection lines
    iso.line(iso.p(-28, 42, 108), iso.p(-6, 42, 54), 'rgba(235, 248, 255, 0.34)', 3);
    iso.line(iso.p(-14, 42, 110), iso.p(0, 42, 74), 'rgba(235, 248, 255, 0.2)', 1.8);

    // Front illuminated specimen info podium (outside glass)
    iso.box(-20, 56, 20, 72, 12, 34, {
      top: '#62d6df',
      topDark: '#266b77',
      left: '#4c6075',
      right: '#2f3e50',
      edge: '#192331',
    });
  }
}

/**
 * 4. Drydock Expansion (船坞扩建) — Worn (sealed bay) vs Repaired (open gantry berth + docked Shield Cruiser!)
 * Shared 512x512 canvas & exact ground anchor (256, 336).
 */
function drawDrydock(ctx: CanvasRenderingContext2D, repaired: boolean): void {
  const iso = new IsoPainter(ctx, BASE_BUILDING_ANCHOR_X, BASE_BUILDING_ANCHOR_Y);

  iso.groundShadow(-94, -84, 98, 90, 14, 4, 0.46);
  // Shared heavy reinforced berth slab (u: -94..94, v: -84..84)
  iso.box(-94, -84, 94, 84, 0, 10, {
    top: '#2e3e52',
    topDark: '#212e3f',
    left: '#3f5166',
    right: '#222f40',
    edge: '#5a6e86',
  });

  if (!repaired) {
    // WORN: Shuttered blast hangar door, broken bent approach rails, hazard barricades
    iso.box(-64, -76, 86, 42, 10, 66, {
      top: '#475464',
      topDark: '#364150',
      left: '#394554',
      right: '#26303d',
      edge: '#19222e',
    });
    // Heavy corrugated blast shutter slats on front-left door face (v = 42.5)
    iso.faceLeft(-50, 70, 42.5, 14, 58, '#283342', '#5b6b7e', 2);
    for (let z = 22; z <= 52; z += 10) {
      iso.line(iso.p(-48, 43, z), iso.p(68, 43, z), '#475668', 2);
    }
    // Red-orange "SEALED" industrial X brace across door
    iso.line(iso.p(-36, 43.5, 18), iso.p(56, 43.5, 54), '#8a5248', 3.5);
    iso.line(iso.p(56, 43.5, 18), iso.p(-36, 43.5, 54), '#8a5248', 3.5);

    // Broken approach rail track outside the shuttered bay
    iso.line(iso.p(-60, 56, 11), iso.p(-10, 56, 11), '#6b7b8e', 4);
    iso.line(iso.p(8, 60, 11), iso.p(62, 54, 11), '#5d6b7a', 4);
    iso.hazardStripU(-86, 86, 72, 82, 10.6, 8);
  } else {
    // REPAIRED: Open recessed docking slipway, twin precision guide rails with warm approach beacons,
    // towering industrial bridge gantry with umbilical arms, AND the Shield Engineering Cruiser parked inside!
    // Recessed slipway floor
    iso.quadZ(-78, -58, 52, 68, 10.6, '#172332', '#5b728b', 2);
    // Twin parallel steel docking guide rails
    iso.box(-76, -42, 46, -34, 10, 15, {
      top: '#879cb4',
      left: '#5c7086',
      right: '#38495c',
      edge: '#1b2635',
    });
    iso.box(-76, 40, 46, 48, 10, 15, {
      top: '#879cb4',
      left: '#5c7086',
      right: '#38495c',
      edge: '#1b2635',
    });

    // Sequential glowing amber runway guide lights along both rails
    for (const u of [-64, -30, 4, 36]) {
      iso.lightPool(u, -38, 15.5, 14, '246, 184, 82', 0.45);
      iso.lightPool(u, 44, 15.5, 14, '246, 184, 82', 0.45);
      iso.quadZ(u - 3, -40, u + 3, -36, 15.6, '#f6b852');
      iso.quadZ(u - 3, 42, u + 3, 46, 15.6, '#f6b852');
    }

    // Rear control tower & hydraulic docking crane gantry (right/back side: u: 52..88, v: -74..62)
    iso.box(52, -74, 88, 62, 10, 108, {
      top: '#6b8098',
      topDark: '#4f6278',
      left: '#53677d',
      right: '#344457',
      edge: '#1b2635',
    });
    // Illuminated control tower observation window
    iso.faceLeft(56, 84, 62.5, 68, 92, '#f6b852', '#1c2838', 2);
    iso.faceRight(88.5, -54, 40, 68, 92, '#c89238', '#1c2838', 1.8);
    // Overhead twin gantry bridge arches spanning over the docked ship
    iso.box(-22, -76, 84, -56, 98, 114, {
      top: '#798fa8',
      left: '#5a6e85',
      right: '#39495d',
      edge: '#1b2635',
    });
    iso.box(-22, -76, -4, -56, 10, 98, {
      top: '#6e839b',
      left: '#53667c',
      right: '#364659',
      edge: '#1b2635',
    });

    // Docked Shield Engineering Cruiser resting on the slipway! (centered u:-18, v:4, z:14)
    drawIsoShip(ctx, BASE_BUILDING_ANCHOR_X - 20, BASE_BUILDING_ANCHOR_Y - 18, 0.88, true);

    // Front safety stripe along berth entrance
    iso.hazardStripU(-88, 86, 74, 82, 10.6, 9);
  }
}

/**
 * 5. Detailed 2:1 Axonometric Miniature Salvage Ship (Cannon Skiff or Shield Engineering Cruiser).
 */
function drawIsoShip(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  scale: number,
  isShieldVariant: boolean
): void {
  ctx.save();
  ctx.translate(ax, ay);
  ctx.scale(scale, scale);
  const iso = new IsoPainter(ctx, 0, 0);

  // Soft landing shadow beneath ship
  iso.groundShadow(-42, -24, 46, 26, 8, 4, 0.5);

  // Landing skids
  iso.box(-32, -22, 26, -16, 0, 6, { top: '#6d8299', left: '#4c5f74', right: '#314052', edge: '#18222e' });
  iso.box(-32, 16, 26, 22, 0, 6, { top: '#6d8299', left: '#4c5f74', right: '#314052', edge: '#18222e' });

  // Engine nacelles at rear (u: -44..-24)
  iso.box(-44, -18, -22, 18, 8, 28, {
    top: '#52657b',
    left: '#3f5065',
    right: '#283546',
    edge: '#18222e',
  });
  // Cyan ion thruster ports on left-rear
  iso.faceRight(-44.5, -12, -4, 12, 22, '#62d6df');
  iso.faceRight(-44.5, 4, 12, 12, 22, '#62d6df');

  // Main armored salvage hull
  iso.box(-26, -24, 30, 24, 6, 32, {
    top: isShieldVariant ? '#728ba6' : '#7b8da2',
    topDark: isShieldVariant ? '#516a84' : '#586b80',
    left: isShieldVariant ? '#526b85' : '#5a6d83',
    right: '#354558',
    edge: '#1c2736',
  });

  // Amber industrial identity stripe across hull top
  iso.quadZ(-16, -20, 20, -12, 32.6, '#f6b852');
  iso.quadZ(-16, 12, 20, 20, 32.6, '#f6b852');

  // Warm illuminated cockpit cabin (raised bridge)
  iso.box(-4, -12, 20, 12, 32, 44, {
    top: '#8ba1b8',
    left: '#62778e',
    right: '#3d4f63',
    edge: '#1b2635',
  });
  iso.faceRight(20.5, -9, 9, 34, 42, '#f6b852', '#1a2533', 1.5);
  iso.faceLeft(4, 20, 12.5, 34, 42, '#f9cc78', '#1a2533', 1.5);

  if (isShieldVariant) {
    // Broad curved/chamfered cyan-emitter shield prow
    iso.box(30, -26, 44, 26, 8, 30, {
      top: '#51718a',
      left: '#3d5a70',
      right: '#273c4e',
      edge: '#62d6df',
    });
    iso.faceRight(44.5, -18, 18, 12, 26, '#62d6df');
    iso.lightPool(42, 0, 20, 24, '98, 214, 223', 0.35);
  } else {
    // Forward twin-rail salvage laser cannon turret
    iso.box(28, -9, 52, 9, 14, 25, {
      top: '#60758c',
      left: '#475a70',
      right: '#2d3d50',
      edge: '#192330',
    });
    iso.quadZ(32, -3, 52, 3, 25.6, '#62d6df');
  }

  ctx.restore();
}

export function registerBaseArtTextures(scene: Phaser.Scene): void {
  registerCanvas(scene, 'base.deck', BASE_DECK_TEX_W, BASE_DECK_TEX_H, drawStationDeck);

  registerCanvas(scene, 'base.workbench.worn', BASE_BUILDING_TEX_W, BASE_BUILDING_TEX_H, (ctx) =>
    drawWorkbench(ctx, false)
  );
  registerCanvas(scene, 'base.workbench.repaired', BASE_BUILDING_TEX_W, BASE_BUILDING_TEX_H, (ctx) =>
    drawWorkbench(ctx, true)
  );

  registerCanvas(scene, 'base.display.worn', BASE_BUILDING_TEX_W, BASE_BUILDING_TEX_H, (ctx) =>
    drawCollectionDisplay(ctx, false, false)
  );
  registerCanvas(scene, 'base.display.repaired', BASE_BUILDING_TEX_W, BASE_BUILDING_TEX_H, (ctx) =>
    drawCollectionDisplay(ctx, true, false)
  );
  registerCanvas(scene, 'base.display.restored', BASE_BUILDING_TEX_W, BASE_BUILDING_TEX_H, (ctx) =>
    drawCollectionDisplay(ctx, true, true)
  );

  registerCanvas(scene, 'base.drydock.worn', BASE_BUILDING_TEX_W, BASE_BUILDING_TEX_H, (ctx) =>
    drawDrydock(ctx, false)
  );
  registerCanvas(scene, 'base.drydock.repaired', BASE_BUILDING_TEX_W, BASE_BUILDING_TEX_H, (ctx) =>
    drawDrydock(ctx, true)
  );

  registerCanvas(scene, 'base.ship.cannon_skiff', BASE_SHIP_TEX_W, BASE_SHIP_TEX_H, (ctx) =>
    drawIsoShip(ctx, BASE_SHIP_TEX_W * 0.5, BASE_SHIP_ANCHOR_Y, 1.35, false)
  );
  registerCanvas(scene, 'base.ship.shield_cruiser', BASE_SHIP_TEX_W, BASE_SHIP_TEX_H, (ctx) =>
    drawIsoShip(ctx, BASE_SHIP_TEX_W * 0.5, BASE_SHIP_ANCHOR_Y, 1.35, true)
  );
}
