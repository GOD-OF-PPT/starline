import type Phaser from 'phaser';
import type { LoadoutId } from '../data/items';
import type { EnemyArchetype } from '../data/nodes';

/**
 * High-craft 1024x512 (power-of-two 2:1 for crisp WebGL trilinear mipmaps)
 * orthogonal side-view combat ship texture generator.
 * Art Spec §3 & §5: Top-left directional light, bottom-right shaded hull underside,
 * warm cockpit/work lights, matte painted steel, recessed ribs/louvres, bolted weapon mounts,
 * subtle leading-edge paint-chip wear, ~75% canvas width subject fill.
 */
export const COMBAT_SHIP_TEX_W = 1024;
export const COMBAT_SHIP_TEX_H = 512;

function createCanvasTexture(
  scene: Phaser.Scene,
  key: string,
  draw: (ctx: CanvasRenderingContext2D) => void
): void {
  if (scene.textures.exists(key)) return;
  const canvasTex = scene.textures.createCanvas(key, COMBAT_SHIP_TEX_W, COMBAT_SHIP_TEX_H);
  if (!canvasTex) return;
  const ctx = canvasTex.getContext();
  ctx.clearRect(0, 0, COMBAT_SHIP_TEX_W, COMBAT_SHIP_TEX_H);
  ctx.save();
  ctx.scale(COMBAT_SHIP_TEX_W / 768, COMBAT_SHIP_TEX_H / 384);
  draw(ctx);
  ctx.restore();
  canvasTex.refresh();
}

function drawRoundedPoly(
  ctx: CanvasRenderingContext2D,
  pts: readonly [number, number][],
  fill: string | CanvasGradient,
  stroke?: string,
  lineWidth = 4
): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke && lineWidth > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

function drawRivets(ctx: CanvasRenderingContext2D, pts: readonly [number, number][], col = '#a9bed4'): void {
  ctx.fillStyle = col;
  for (const [x, y] of pts) {
    ctx.beginPath();
    ctx.arc(x, y, 2.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPlayerShip(ctx: CanvasRenderingContext2D, loadout: LoadoutId): void {
  const isShield = loadout === 'shield_cruiser';

  // Soft thruster exhaust outer cone + bright white-cyan inner plasma core
  const thrGrad = ctx.createLinearGradient(32, 198, 128, 198);
  thrGrad.addColorStop(0, 'rgba(98,214,223,0)');
  thrGrad.addColorStop(0.5, 'rgba(98,214,223,0.42)');
  thrGrad.addColorStop(0.85, 'rgba(168,242,248,0.85)');
  thrGrad.addColorStop(1, 'rgba(240,252,255,0.96)');
  ctx.fillStyle = thrGrad;
  ctx.beginPath();
  ctx.moveTo(126, 158);
  ctx.lineTo(36, 196);
  ctx.lineTo(126, 234);
  ctx.closePath();
  ctx.fill();

  const coreGrad = ctx.createLinearGradient(68, 196, 124, 196);
  coreGrad.addColorStop(0, 'rgba(235,252,255,0)');
  coreGrad.addColorStop(1, 'rgba(245,253,255,0.95)');
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.moveTo(124, 178);
  ctx.lineTo(70, 196);
  ctx.lineTo(124, 214);
  ctx.closePath();
  ctx.fill();

  // Dorsal communications whip antenna & beacon mast
  ctx.strokeStyle = '#9db4cb';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(278, 134);
  ctx.lineTo(256, 94);
  ctx.moveTo(298, 132);
  ctx.lineTo(286, 108);
  ctx.stroke();
  ctx.fillStyle = '#62d6df';
  ctx.beginPath();
  ctx.arc(256, 94, 4, 0, Math.PI * 2);
  ctx.fill();

  // Twin gimballed thruster nozzle bells
  drawRoundedPoly(
    ctx,
    [
      [108, 152],
      [148, 158],
      [148, 194],
      [108, 198],
    ],
    '#2a3646',
    '#8ea4bc',
    4
  );
  drawRoundedPoly(
    ctx,
    [
      [108, 200],
      [148, 204],
      [148, 238],
      [108, 244],
    ],
    '#222d3b',
    '#7c92aa',
    4
  );
  // Subtle thruster inner cyan lip
  ctx.fillStyle = 'rgba(98,214,223,0.65)';
  ctx.fillRect(108, 160, 6, 30);
  ctx.fillRect(108, 208, 6, 28);

  // Rear reactor & cooling manifold housing
  const rearGrad = ctx.createLinearGradient(142, 138, 236, 258);
  rearGrad.addColorStop(0, '#4f6278');
  rearGrad.addColorStop(1, '#232f3f');
  drawRoundedPoly(
    ctx,
    [
      [142, 146],
      [234, 138],
      [234, 256],
      [142, 246],
    ],
    rearGrad,
    '#9bb1c7',
    4.5
  );
  // Reactor cooling louvres
  ctx.strokeStyle = '#18222e';
  ctx.lineWidth = 4;
  for (let y = 162; y <= 228; y += 16) {
    ctx.beginPath();
    ctx.moveTo(160, y);
    ctx.lineTo(214, y);
    ctx.stroke();
  }

  // Main painted-steel salvage hull with top-left directional highlight gradient
  const hullGrad = ctx.createLinearGradient(190, 102, 610, 290);
  hullGrad.addColorStop(0, isShield ? '#7c94ae' : '#7b8ea3');
  hullGrad.addColorStop(0.45, isShield ? '#4f6882' : '#53657a');
  hullGrad.addColorStop(0.82, '#2d3b4d');
  hullGrad.addColorStop(1, '#1e2937');

  if (isShield) {
    // Broad armored industrial Shield Engineering Cruiser silhouette
    drawRoundedPoly(
      ctx,
      [
        [204, 118],
        [488, 110],
        [606, 142],
        [646, 186],
        [646, 226],
        [596, 266],
        [226, 270],
        [196, 242],
      ],
      hullGrad,
      '#adc3d9',
      5
    );
    // Upper lit armor bevel highlight
    ctx.strokeStyle = 'rgba(226, 238, 250, 0.52)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(212, 123);
    ctx.lineTo(486, 115);
    ctx.lineTo(596, 146);
    ctx.stroke();

    // Forward curved armored shield emitter prow with recessed cyan coils
    const prowGrad = ctx.createLinearGradient(570, 126, 678, 274);
    prowGrad.addColorStop(0, '#5a7892');
    prowGrad.addColorStop(0.55, '#344d63');
    prowGrad.addColorStop(1, '#1f3142');
    drawRoundedPoly(
      ctx,
      [
        [566, 124],
        [644, 146],
        [676, 198],
        [644, 252],
        [566, 274],
        [592, 224],
        [592, 174],
      ],
      prowGrad,
      '#62d6df',
      5
    );
    // Emitter bars & stabilizer ribs
    ctx.fillStyle = '#182b3a';
    ctx.fillRect(614, 156, 30, 86);
    ctx.fillStyle = '#62d6df';
    ctx.fillRect(620, 164, 18, 22);
    ctx.fillRect(620, 194, 18, 22);
    ctx.fillRect(620, 224, 18, 12);

    // Dorsal utility turret
    drawRoundedPoly(
      ctx,
      [
        [434, 112],
        [520, 112],
        [542, 130],
        [642, 142],
        [642, 160],
        [520, 156],
        [434, 146],
      ],
      '#3c4f65',
      '#a0b5cb',
      4
    );
    ctx.fillStyle = '#62d6df';
    ctx.fillRect(554, 148, 82, 5);
  } else {
    // Compact heavy-gun Salvage Cannon Skiff silhouette
    drawRoundedPoly(
      ctx,
      [
        [200, 128],
        [462, 118],
        [574, 152],
        [608, 184],
        [608, 226],
        [554, 258],
        [224, 260],
        [196, 232],
      ],
      hullGrad,
      '#aac0d6',
      5
    );
    // Upper lit hull chamfer highlight
    ctx.strokeStyle = 'rgba(226, 238, 250, 0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(208, 133);
    ctx.lineTo(460, 123);
    ctx.lineTo(568, 155);
    ctx.stroke();

    // Underslung armored cargo-bay grapple pod
    drawRoundedPoly(
      ctx,
      [
        [248, 236],
        [498, 236],
        [480, 278],
        [268, 278],
      ],
      '#283546',
      '#8499b0',
      4
    );
    // Grapple clamp teeth
    ctx.fillStyle = '#d9a145';
    ctx.fillRect(284, 258, 34, 10);
    ctx.fillRect(424, 258, 34, 10);

    // Forward heavy twin-rail salvage laser barrel & recoil housing
    const gunGrad = ctx.createLinearGradient(452, 144, 452, 194);
    gunGrad.addColorStop(0, '#5a6e84');
    gunGrad.addColorStop(1, '#263445');
    drawRoundedPoly(
      ctx,
      [
        [452, 144],
        [668, 152],
        [668, 184],
        [452, 192],
      ],
      gunGrad,
      '#a7bdd3',
      4.5
    );
    ctx.fillStyle = '#182534';
    ctx.fillRect(508, 161, 152, 14);
    ctx.fillStyle = '#62d6df';
    ctx.fillRect(516, 165, 142, 6);
    // Barrel散热 collar
    drawRoundedPoly(
      ctx,
      [
        [528, 144],
        [558, 145],
        [558, 190],
        [528, 191],
      ],
      '#3a4c61',
      '#99afc5',
      3.5
    );
  }

  // Mid-hull panel seams, amber hazard stripe, and riveted armor plates
  ctx.fillStyle = '#f6b852';
  ctx.fillRect(256, 188, 176, 14);
  ctx.fillStyle = '#212d3c';
  for (let x = 276; x <= 406; x += 28) {
    ctx.fillRect(x, 188, 10, 14);
  }
  ctx.strokeStyle = '#1d2938';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(318, 128);
  ctx.lineTo(318, 256);
  ctx.moveTo(436, 124);
  ctx.lineTo(436, 256);
  ctx.stroke();

  // Warm illuminated cockpit cabin with framed mullions & diagonal glass glare
  drawRoundedPoly(
    ctx,
    [
      [348, 134],
      [448, 134],
      [486, 168],
      [348, 168],
    ],
    '#f6b852',
    '#1b2736',
    4.5
  );
  ctx.strokeStyle = '#253447';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(398, 134);
  ctx.lineTo(412, 168);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.48)';
  ctx.fillRect(362, 140, 32, 7);
  ctx.fillRect(416, 142, 26, 6);

  // Subtle metallic wear chips & bolted armor rivets
  drawRivets(ctx, [
    [244, 144],
    [306, 144],
    [244, 240],
    [306, 240],
    [334, 224],
    [422, 224],
    [454, 226],
  ]);
  ctx.strokeStyle = '#d0dce8';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(212, 152);
  ctx.lineTo(238, 148);
  ctx.moveTo(476, 238);
  ctx.lineTo(506, 233);
  ctx.stroke();
}

function drawEnemyShip(
  ctx: CanvasRenderingContext2D,
  archetype: EnemyArchetype,
  isDanger: boolean
): void {
  const accent = isDanger ? '#f27564' : '#d89d42';
  const hullLight = isDanger ? '#795a63' : '#6c7b8d';
  const hullMid = isDanger ? '#4e3740' : '#435061';
  const hullDark = '#212936';
  const strokeCol = isDanger ? '#ebb0a8' : '#9eb1c5';

  const grad = ctx.createLinearGradient(130, 92, 650, 294);
  grad.addColorStop(0, hullLight);
  grad.addColorStop(0.5, hullMid);
  grad.addColorStop(1, hullDark);

  // Rear thruster exhaust outer cone + hot core (right side)
  const thrGrad = ctx.createLinearGradient(635, 194, 738, 194);
  thrGrad.addColorStop(0, isDanger ? 'rgba(255,220,210,0.96)' : 'rgba(255,235,190,0.94)');
  thrGrad.addColorStop(0.35, isDanger ? 'rgba(242,117,100,0.88)' : 'rgba(246,184,82,0.82)');
  thrGrad.addColorStop(1, 'rgba(242,117,100,0)');
  ctx.fillStyle = thrGrad;
  ctx.beginPath();
  ctx.moveTo(640, 162);
  ctx.lineTo(738, 194);
  ctx.lineTo(640, 228);
  ctx.closePath();
  ctx.fill();

  // Rear thruster nozzle bell
  drawRoundedPoly(
    ctx,
    [
      [620, 158],
      [662, 166],
      [662, 224],
      [620, 232],
    ],
    '#252e3c',
    strokeCol,
    4
  );

  if (archetype === 'scout') {
    // Agile angular scavenger interceptor
    drawRoundedPoly(
      ctx,
      [
        [152, 184],
        [280, 130],
        [554, 124],
        [646, 166],
        [646, 224],
        [542, 258],
        [262, 248],
        [152, 212],
      ],
      grad,
      strokeCol,
      5
    );
    // Upper lit hull rim bevel
    ctx.strokeStyle = 'rgba(232, 240, 248, 0.45)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(282, 135);
    ctx.lineTo(550, 129);
    ctx.stroke();

    // Hull panel seam & cooling vents
    ctx.strokeStyle = '#1b2431';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(398, 130);
    ctx.lineTo(398, 250);
    ctx.moveTo(524, 128);
    ctx.lineTo(524, 254);
    ctx.stroke();
    for (let y = 158; y <= 212; y += 16) {
      ctx.beginPath();
      ctx.moveTo(548, y);
      ctx.lineTo(604, y);
      ctx.stroke();
    }

    // Dorsal stabilizer fin & radar whip
    drawRoundedPoly(
      ctx,
      [
        [454, 126],
        [562, 94],
        [594, 128],
      ],
      hullMid,
      strokeCol,
      4
    );
    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(558, 96);
    ctx.lineTo(582, 72);
    ctx.stroke();

    // Underslung scavenger clamp pod
    drawRoundedPoly(
      ctx,
      [
        [308, 244],
        [466, 246],
        [450, 274],
        [324, 272],
      ],
      '#242e3c',
      strokeCol,
      3.5
    );

    // Forward nose autocannon
    drawRoundedPoly(
      ctx,
      [
        [102, 174],
        [248, 166],
        [248, 202],
        [102, 196],
      ],
      '#283342',
      strokeCol,
      4
    );
    ctx.fillStyle = accent;
    ctx.fillRect(114, 181, 48, 7);
    // Armored optical sensor housing with glass highlight
    ctx.fillStyle = '#1b2431';
    ctx.beginPath();
    ctx.arc(334, 186, 25, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(330, 186, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.arc(325, 181, 4.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (archetype === 'frigate') {
    // Twin-deck armored gunship frigate
    drawRoundedPoly(
      ctx,
      [
        [140, 156],
        [242, 110],
        [588, 106],
        [658, 150],
        [658, 244],
        [574, 278],
        [224, 272],
        [140, 234],
      ],
      grad,
      strokeCol,
      5
    );
    // Upper lit hull rim bevel
    ctx.strokeStyle = 'rgba(232, 240, 248, 0.45)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(246, 115);
    ctx.lineTo(584, 111);
    ctx.stroke();

    // Dorsal armored communications turret
    drawRoundedPoly(
      ctx,
      [
        [456, 84],
        [548, 84],
        [566, 108],
        [442, 108],
      ],
      hullMid,
      strokeCol,
      4
    );

    // Armor bulkhead ribs
    ctx.strokeStyle = '#1c2431';
    ctx.lineWidth = 4.5;
    for (const x of [306, 424, 536]) {
      ctx.beginPath();
      ctx.moveTo(x, 114);
      ctx.lineTo(x, 268);
      ctx.stroke();
    }
    // Dual forward heavy cannon barrels
    drawRoundedPoly(
      ctx,
      [
        [94, 158],
        [258, 150],
        [258, 184],
        [94, 180],
      ],
      '#283241',
      strokeCol,
      4
    );
    drawRoundedPoly(
      ctx,
      [
        [120, 214],
        [264, 208],
        [264, 240],
        [120, 236],
      ],
      '#283241',
      strokeCol,
      4
    );
    ctx.fillStyle = accent;
    ctx.fillRect(104, 165, 42, 6);
    ctx.fillRect(130, 221, 36, 6);
    // Armored bridge visor with diagonal glass glare
    drawRoundedPoly(
      ctx,
      [
        [338, 128],
        [466, 128],
        [466, 162],
        [314, 162],
      ],
      accent,
      '#1a222e',
      4
    );
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(348, 134, 40, 6);
  } else {
    // Massive heavy dreadnought / fortress hulk
    drawRoundedPoly(
      ctx,
      [
        [124, 132],
        [218, 84],
        [612, 84],
        [678, 138],
        [678, 258],
        [604, 304],
        [212, 298],
        [124, 250],
      ],
      grad,
      strokeCol,
      6
    );
    // Heavy armor superstructure tower
    drawRoundedPoly(
      ctx,
      [
        [374, 54],
        [548, 54],
        [572, 88],
        [356, 88],
      ],
      hullMid,
      strokeCol,
      4.5
    );
    ctx.fillStyle = accent;
    ctx.fillRect(390, 64, 72, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(394, 66, 30, 4);

    // Bulkhead ribs
    ctx.strokeStyle = '#1b2330';
    ctx.lineWidth = 6;
    for (const x of [280, 380, 480, 572]) {
      ctx.beginPath();
      ctx.moveTo(x, 92);
      ctx.lineTo(x, 292);
      ctx.stroke();
    }
    // Siege prow cannon
    drawRoundedPoly(
      ctx,
      [
        [78, 152],
        [268, 142],
        [268, 208],
        [78, 198],
      ],
      '#242e3d',
      strokeCol,
      5
    );
    ctx.fillStyle = accent;
    ctx.fillRect(92, 168, 110, 14);
    // Core reactor slit
    ctx.fillStyle = '#171e29';
    ctx.fillRect(314, 168, 194, 36);
    ctx.fillStyle = accent;
    ctx.fillRect(322, 176, 178, 20);
  }

  // Danger route coral-red hazard chevrons & dorsal warning beacon
  if (isDanger) {
    ctx.fillStyle = '#f27564';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(410 + i * 32, 224);
      ctx.lineTo(428 + i * 32, 224);
      ctx.lineTo(416 + i * 32, 250);
      ctx.lineTo(398 + i * 32, 250);
      ctx.closePath();
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(522, 118, 10, 0, Math.PI * 2);
    ctx.fill();
  }

  drawRivets(
    ctx,
    [
      [294, 146],
      [352, 146],
      [482, 146],
      [554, 146],
      [294, 240],
      [554, 240],
    ],
    isDanger ? '#d9a49d' : '#a2b4c7'
  );
}

export function registerCombatShipTextures(scene: Phaser.Scene): void {
  createCanvasTexture(scene, 'ship.player.cannon_skiff', (ctx) =>
    drawPlayerShip(ctx, 'cannon_skiff')
  );
  createCanvasTexture(scene, 'ship.player.shield_cruiser', (ctx) =>
    drawPlayerShip(ctx, 'shield_cruiser')
  );

  for (const arch of ['scout', 'frigate', 'hulk'] as const) {
    createCanvasTexture(scene, `ship.enemy.${arch}.normal`, (ctx) =>
      drawEnemyShip(ctx, arch, false)
    );
    createCanvasTexture(scene, `ship.enemy.${arch}.danger`, (ctx) =>
      drawEnemyShip(ctx, arch, true)
    );
  }
}
