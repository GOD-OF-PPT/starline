import type Phaser from 'phaser';
import type { LoadoutId } from '../data/items';
import type { EnemyArchetype } from '../data/nodes';

/**
 * Generates high-craft 768x384 orthogonal side-view ship textures into Phaser's texture manager.
 * Lighting rule (Art Spec §3): Top-left main light, bottom-right shading, warm amber work lights,
 * matte painted steel hulls, subtle wear marks, subject spanning ~75% of canvas width.
 */
function createCanvasTexture(
  scene: Phaser.Scene,
  key: string,
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
): void {
  if (scene.textures.exists(key)) return;
  const canvasTex = scene.textures.createCanvas(key, width, height);
  if (!canvasTex) return;
  const ctx = canvasTex.getContext();
  ctx.clearRect(0, 0, width, height);
  draw(ctx, width, height);
  canvasTex.refresh();
}

function drawRoundedPoly(
  ctx: CanvasRenderingContext2D,
  pts: readonly [number, number][],
  fill: string | CanvasGradient,
  stroke: string,
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
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function drawPlayerShip(ctx: CanvasRenderingContext2D, loadout: LoadoutId): void {
  const isShield = loadout === 'shield_cruiser';

  // Thruster exhaust cone (subtle)
  const thrGrad = ctx.createLinearGradient(58, 200, 128, 200);
  thrGrad.addColorStop(0, 'rgba(98,214,223,0)');
  thrGrad.addColorStop(1, 'rgba(98,214,223,0.75)');
  ctx.fillStyle = thrGrad;
  ctx.beginPath();
  ctx.moveTo(126, 174);
  ctx.lineTo(66, 198);
  ctx.lineTo(126, 224);
  ctx.closePath();
  ctx.fill();

  // Rear engine block
  drawRoundedPoly(
    ctx,
    [
      [110, 154],
      [215, 146],
      [215, 250],
      [110, 240],
      [96, 222],
      [96, 172],
    ],
    '#344356',
    '#8EA4BC',
    5
  );

  // Main hull body with top-left light gradient
  const hullGrad = ctx.createLinearGradient(160, 100, 620, 290);
  hullGrad.addColorStop(0, isShield ? '#72889F' : '#6F8094');
  hullGrad.addColorStop(0.55, isShield ? '#485E75' : '#4A596C');
  hullGrad.addColorStop(1, '#293545');

  if (isShield) {
    // Broad armored industrial shield cruiser silhouette
    drawRoundedPoly(
      ctx,
      [
        [184, 122],
        [490, 114],
        [612, 148],
        [652, 188],
        [652, 226],
        [604, 266],
        [210, 270],
        [176, 242],
      ],
      hullGrad,
      '#A7BCD2',
      5
    );
    // Forward curved shield emitter prow
    drawRoundedPoly(
      ctx,
      [
        [574, 128],
        [648, 152],
        [670, 198],
        [648, 248],
        [574, 272],
        [594, 224],
        [594, 174],
      ],
      '#3A5268',
      '#62D6DF',
      5
    );
    // Emitter glow bars
    ctx.fillStyle = '#62D6DF';
    ctx.fillRect(622, 166, 18, 66);
    // Dorsal utility turret
    drawRoundedPoly(
      ctx,
      [
        [430, 116],
        [520, 116],
        [540, 134],
        [642, 146],
        [642, 162],
        [520, 158],
        [430, 148],
      ],
      '#3D4E62',
      '#99AFC5',
      4
    );
  } else {
    // Compact salvage cannon skiff silhouette
    drawRoundedPoly(
      ctx,
      [
        [182, 132],
        [462, 122],
        [576, 156],
        [608, 184],
        [608, 226],
        [554, 258],
        [208, 260],
        [178, 232],
      ],
      hullGrad,
      '#A3B7CC',
      5
    );
    // Heavy forward twin-rail laser barrel
    drawRoundedPoly(
      ctx,
      [
        [456, 146],
        [664, 154],
        [664, 182],
        [456, 190],
      ],
      '#3C4C60',
      '#A2B7CD',
      5
    );
    ctx.fillStyle = '#62D6DF';
    ctx.fillRect(520, 164, 132, 8);
    // Lower cargo clamp pod
    drawRoundedPoly(
      ctx,
      [
        [248, 236],
        [496, 236],
        [478, 276],
        [268, 276],
      ],
      '#2A3748',
      '#7B90A8',
      4
    );
  }

  // Amber industrial stripe & panel seams
  ctx.fillStyle = '#F6B852';
  ctx.fillRect(256, 188, 174, 14);
  ctx.strokeStyle = '#212E3E';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(318, 130);
  ctx.lineTo(318, 256);
  ctx.moveTo(436, 128);
  ctx.lineTo(436, 256);
  ctx.stroke();

  // Warm illuminated cockpit canopy
  drawRoundedPoly(
    ctx,
    [
      [350, 138],
      [444, 138],
      [482, 168],
      [350, 168],
    ],
    '#F6B852',
    '#1B2736',
    4
  );
  // Canopy glare
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillRect(366, 144, 58, 7);

  // Subtle edge wear marks
  ctx.strokeStyle = '#C4D2E0';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(212, 148);
  ctx.lineTo(242, 144);
  ctx.moveTo(466, 236);
  ctx.lineTo(494, 232);
  ctx.stroke();
}

function drawEnemyShip(
  ctx: CanvasRenderingContext2D,
  archetype: EnemyArchetype,
  isDanger: boolean
): void {
  // Enemies face LEFT (muzzle on left, engines on right)
  const accent = isDanger ? '#F27564' : '#D49A42';
  const hullLight = isDanger ? '#6B525A' : '#5E6B7B';
  const hullMid = isDanger ? '#47333B' : '#3D4959';
  const hullDark = '#232B38';
  const strokeCol = isDanger ? '#E5A39B' : '#96A8BC';

  const grad = ctx.createLinearGradient(140, 96, 650, 290);
  grad.addColorStop(0, hullLight);
  grad.addColorStop(0.55, hullMid);
  grad.addColorStop(1, hullDark);

  // Rear thruster glow (right side)
  const thrGrad = ctx.createLinearGradient(635, 194, 710, 194);
  thrGrad.addColorStop(0, isDanger ? 'rgba(242,117,100,0.85)' : 'rgba(246,184,82,0.75)');
  thrGrad.addColorStop(1, 'rgba(242,117,100,0)');
  ctx.fillStyle = thrGrad;
  ctx.beginPath();
  ctx.moveTo(640, 168);
  ctx.lineTo(712, 194);
  ctx.lineTo(640, 222);
  ctx.closePath();
  ctx.fill();

  if (archetype === 'scout') {
    // Angular agile scavenger scout
    drawRoundedPoly(
      ctx,
      [
        [152, 184],
        [278, 134],
        [548, 128],
        [642, 168],
        [642, 224],
        [538, 256],
        [262, 248],
        [152, 212],
      ],
      grad,
      strokeCol,
      5
    );
    // Forward nose cannon
    drawRoundedPoly(
      ctx,
      [
        [106, 174],
        [248, 168],
        [248, 202],
        [106, 196],
      ],
      '#2B3544',
      strokeCol,
      4
    );
    // Sensor eye
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(328, 186, 18, 0, Math.PI * 2);
    ctx.fill();
  } else if (archetype === 'frigate') {
    // Twin-deck armored gunship
    drawRoundedPoly(
      ctx,
      [
        [140, 158],
        [240, 114],
        [586, 110],
        [656, 152],
        [656, 242],
        [572, 276],
        [224, 272],
        [140, 234],
      ],
      grad,
      strokeCol,
      5
    );
    // Upper & lower heavy gun barrels
    drawRoundedPoly(
      ctx,
      [
        [98, 160],
        [258, 152],
        [258, 186],
        [98, 182],
      ],
      '#2A3443',
      strokeCol,
      4
    );
    drawRoundedPoly(
      ctx,
      [
        [124, 214],
        [264, 210],
        [264, 240],
        [124, 236],
      ],
      '#2A3443',
      strokeCol,
      4
    );
    // Armored bridge visor
    drawRoundedPoly(
      ctx,
      [
        [338, 132],
        [462, 132],
        [462, 164],
        [314, 164],
      ],
      accent,
      '#1A222E',
      4
    );
  } else {
    // Heavy fortress hulk
    drawRoundedPoly(
      ctx,
      [
        [126, 134],
        [218, 86],
        [610, 86],
        [676, 138],
        [676, 256],
        [604, 302],
        [212, 298],
        [126, 250],
      ],
      grad,
      strokeCol,
      6
    );
    // Bulkhead ribs
    ctx.strokeStyle = '#1D2532';
    ctx.lineWidth = 6;
    for (const x of [280, 380, 480, 570]) {
      ctx.beginPath();
      ctx.moveTo(x, 96);
      ctx.lineTo(x, 292);
      ctx.stroke();
    }
    // Massive siege prow cannon
    drawRoundedPoly(
      ctx,
      [
        [82, 154],
        [266, 144],
        [266, 206],
        [82, 198],
      ],
      '#26303F',
      strokeCol,
      5
    );
    // Core reactor slit
    ctx.fillStyle = accent;
    ctx.fillRect(320, 174, 180, 26);
  }

  // Danger route hazard chevrons + dorsal warning beacon
  if (isDanger) {
    ctx.fillStyle = '#F27564';
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
    ctx.arc(520, 122, 10, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function registerCombatShipTextures(scene: Phaser.Scene): void {
  createCanvasTexture(scene, 'ship.player.cannon_skiff', 768, 384, (ctx) =>
    drawPlayerShip(ctx, 'cannon_skiff')
  );
  createCanvasTexture(scene, 'ship.player.shield_cruiser', 768, 384, (ctx) =>
    drawPlayerShip(ctx, 'shield_cruiser')
  );

  for (const arch of ['scout', 'frigate', 'hulk'] as const) {
    createCanvasTexture(scene, `ship.enemy.${arch}.normal`, 768, 384, (ctx) =>
      drawEnemyShip(ctx, arch, false)
    );
    createCanvasTexture(scene, `ship.enemy.${arch}.danger`, 768, 384, (ctx) =>
      drawEnemyShip(ctx, arch, true)
    );
  }
}
