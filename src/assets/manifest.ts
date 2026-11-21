export type AssetView = 'top' | 'side' | 'iso' | 'ui';

export interface NormalizedPoint {
  readonly x: number; // 0..1
  readonly y: number; // 0..1
}

export interface ShipHardpoints {
  readonly muzzle: NormalizedPoint;
  readonly hit: NormalizedPoint;
  readonly engine: NormalizedPoint;
  readonly shieldCenter: NormalizedPoint;
}

export interface AssetManifestEntry {
  readonly key: string;
  readonly version: string;
  readonly view: AssetView;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly anchor: NormalizedPoint;
  readonly hardpoints?: ShipHardpoints;
  readonly source: string;
  readonly license: string;
}

export const ASSET_MANIFEST: Record<string, AssetManifestEntry> = {
  // Top-down cargo & equipment (192px/cell, soft overhead light, no baked shadows)
  'equipment.laser.common': {
    key: 'equipment.laser.common',
    version: 'v001',
    view: 'top',
    canvasWidth: 192,
    canvasHeight: 384,
    anchor: { x: 0, y: 0 },
    source: 'procedural_svg_master:itemArt.ts',
    license: 'Original Starline First-Party',
  },
  'equipment.laser.improved': {
    key: 'equipment.laser.improved',
    version: 'v001',
    view: 'top',
    canvasWidth: 192,
    canvasHeight: 384,
    anchor: { x: 0, y: 0 },
    source: 'procedural_svg_master:itemArt.ts',
    license: 'Original Starline First-Party',
  },
  'equipment.battery.common': {
    key: 'equipment.battery.common',
    version: 'v001',
    view: 'top',
    canvasWidth: 192,
    canvasHeight: 192,
    anchor: { x: 0, y: 0 },
    source: 'procedural_svg_master:itemArt.ts',
    license: 'Original Starline First-Party',
  },
  'equipment.battery.improved': {
    key: 'equipment.battery.improved',
    version: 'v001',
    view: 'top',
    canvasWidth: 192,
    canvasHeight: 192,
    anchor: { x: 0, y: 0 },
    source: 'procedural_svg_master:itemArt.ts',
    license: 'Original Starline First-Party',
  },
  'equipment.shield.common': {
    key: 'equipment.shield.common',
    version: 'v001',
    view: 'top',
    canvasWidth: 192,
    canvasHeight: 384,
    anchor: { x: 0, y: 0 },
    source: 'procedural_svg_master:itemArt.ts',
    license: 'Original Starline First-Party',
  },
  'equipment.shield.improved': {
    key: 'equipment.shield.improved',
    version: 'v001',
    view: 'top',
    canvasWidth: 192,
    canvasHeight: 384,
    anchor: { x: 0, y: 0 },
    source: 'procedural_svg_master:itemArt.ts',
    license: 'Original Starline First-Party',
  },
  'equipment.drone.common': {
    key: 'equipment.drone.common',
    version: 'v001',
    view: 'top',
    canvasWidth: 384,
    canvasHeight: 384,
    anchor: { x: 0, y: 0 },
    source: 'procedural_svg_master:itemArt.ts',
    license: 'Original Starline First-Party',
  },
  'equipment.drone.improved': {
    key: 'equipment.drone.improved',
    version: 'v001',
    view: 'top',
    canvasWidth: 384,
    canvasHeight: 384,
    anchor: { x: 0, y: 0 },
    source: 'procedural_svg_master:itemArt.ts',
    license: 'Original Starline First-Party',
  },
  'cargo.data_box': {
    key: 'cargo.data_box',
    version: 'v001',
    view: 'top',
    canvasWidth: 192,
    canvasHeight: 192,
    anchor: { x: 0, y: 0 },
    source: 'procedural_svg_master:itemArt.ts',
    license: 'Original Starline First-Party',
  },
  'cargo.alloy_bar': {
    key: 'cargo.alloy_bar',
    version: 'v001',
    view: 'top',
    canvasWidth: 192,
    canvasHeight: 384,
    anchor: { x: 0, y: 0 },
    source: 'procedural_svg_master:itemArt.ts',
    license: 'Original Starline First-Party',
  },
  'cargo.coolant_tank': {
    key: 'cargo.coolant_tank',
    version: 'v001',
    view: 'top',
    canvasWidth: 192,
    canvasHeight: 576,
    anchor: { x: 0, y: 0 },
    source: 'procedural_svg_master:itemArt.ts',
    license: 'Original Starline First-Party',
  },
  'cargo.old_engine': {
    key: 'cargo.old_engine',
    version: 'v001',
    view: 'top',
    canvasWidth: 384,
    canvasHeight: 384,
    anchor: { x: 0, y: 0 },
    source: 'procedural_svg_master:itemArt.ts',
    license: 'Original Starline First-Party',
  },
  'cargo.folding_antenna': {
    key: 'cargo.folding_antenna',
    version: 'v001',
    view: 'top',
    canvasWidth: 384,
    canvasHeight: 384,
    anchor: { x: 0, y: 0 },
    source: 'procedural_svg_master:itemArt.ts',
    license: 'Original Starline First-Party',
  },
  'cargo.ancient_navigator': {
    key: 'cargo.ancient_navigator',
    version: 'v001',
    view: 'top',
    canvasWidth: 576,
    canvasHeight: 384,
    anchor: { x: 0, y: 0 },
    source: 'procedural_svg_master:itemArt.ts',
    license: 'Original Starline First-Party',
  },

  // Orthogonal side-view combat ships (768x384 canonical canvas)
  'ship.player.cannon_skiff': {
    key: 'ship.player.cannon_skiff',
    version: 'v001',
    view: 'side',
    canvasWidth: 768,
    canvasHeight: 384,
    anchor: { x: 0.5, y: 0.5 },
    hardpoints: {
      muzzle: { x: 0.86, y: 0.44 },
      hit: { x: 0.58, y: 0.5 },
      engine: { x: 0.14, y: 0.52 },
      shieldCenter: { x: 0.54, y: 0.5 },
    },
    source: 'procedural_canvas_master:sceneArt.ts',
    license: 'Original Starline First-Party',
  },
  'ship.player.shield_cruiser': {
    key: 'ship.player.shield_cruiser',
    version: 'v001',
    view: 'side',
    canvasWidth: 768,
    canvasHeight: 384,
    anchor: { x: 0.5, y: 0.5 },
    hardpoints: {
      muzzle: { x: 0.84, y: 0.42 },
      hit: { x: 0.6, y: 0.5 },
      engine: { x: 0.14, y: 0.54 },
      shieldCenter: { x: 0.56, y: 0.5 },
    },
    source: 'procedural_canvas_master:sceneArt.ts',
    license: 'Original Starline First-Party',
  },
  'ship.enemy.scout.normal': {
    key: 'ship.enemy.scout.normal',
    version: 'v001',
    view: 'side',
    canvasWidth: 768,
    canvasHeight: 384,
    anchor: { x: 0.5, y: 0.5 },
    hardpoints: {
      muzzle: { x: 0.16, y: 0.48 },
      hit: { x: 0.45, y: 0.5 },
      engine: { x: 0.84, y: 0.5 },
      shieldCenter: { x: 0.46, y: 0.5 },
    },
    source: 'procedural_canvas_master:sceneArt.ts',
    license: 'Original Starline First-Party',
  },
  'ship.enemy.scout.danger': {
    key: 'ship.enemy.scout.danger',
    version: 'v001',
    view: 'side',
    canvasWidth: 768,
    canvasHeight: 384,
    anchor: { x: 0.5, y: 0.5 },
    hardpoints: {
      muzzle: { x: 0.14, y: 0.46 },
      hit: { x: 0.45, y: 0.5 },
      engine: { x: 0.85, y: 0.5 },
      shieldCenter: { x: 0.46, y: 0.5 },
    },
    source: 'procedural_canvas_master:sceneArt.ts',
    license: 'Original Starline First-Party',
  },
  'ship.enemy.frigate.normal': {
    key: 'ship.enemy.frigate.normal',
    version: 'v001',
    view: 'side',
    canvasWidth: 768,
    canvasHeight: 384,
    anchor: { x: 0.5, y: 0.5 },
    hardpoints: {
      muzzle: { x: 0.14, y: 0.46 },
      hit: { x: 0.44, y: 0.5 },
      engine: { x: 0.86, y: 0.52 },
      shieldCenter: { x: 0.45, y: 0.5 },
    },
    source: 'procedural_canvas_master:sceneArt.ts',
    license: 'Original Starline First-Party',
  },
  'ship.enemy.frigate.danger': {
    key: 'ship.enemy.frigate.danger',
    version: 'v001',
    view: 'side',
    canvasWidth: 768,
    canvasHeight: 384,
    anchor: { x: 0.5, y: 0.5 },
    hardpoints: {
      muzzle: { x: 0.12, y: 0.44 },
      hit: { x: 0.44, y: 0.5 },
      engine: { x: 0.86, y: 0.52 },
      shieldCenter: { x: 0.45, y: 0.5 },
    },
    source: 'procedural_canvas_master:sceneArt.ts',
    license: 'Original Starline First-Party',
  },
  'ship.enemy.hulk.normal': {
    key: 'ship.enemy.hulk.normal',
    version: 'v001',
    view: 'side',
    canvasWidth: 768,
    canvasHeight: 384,
    anchor: { x: 0.5, y: 0.5 },
    hardpoints: {
      muzzle: { x: 0.12, y: 0.45 },
      hit: { x: 0.44, y: 0.5 },
      engine: { x: 0.88, y: 0.52 },
      shieldCenter: { x: 0.45, y: 0.5 },
    },
    source: 'procedural_canvas_master:sceneArt.ts',
    license: 'Original Starline First-Party',
  },
  'ship.enemy.hulk.danger': {
    key: 'ship.enemy.hulk.danger',
    version: 'v001',
    view: 'side',
    canvasWidth: 768,
    canvasHeight: 384,
    anchor: { x: 0.5, y: 0.5 },
    hardpoints: {
      muzzle: { x: 0.11, y: 0.44 },
      hit: { x: 0.44, y: 0.5 },
      engine: { x: 0.88, y: 0.52 },
      shieldCenter: { x: 0.45, y: 0.5 },
    },
    source: 'procedural_canvas_master:sceneArt.ts',
    license: 'Original Starline First-Party',
  },
};

export function getShipHardpoints(textureKey: string): ShipHardpoints {
  const entry = ASSET_MANIFEST[textureKey];
  if (!entry?.hardpoints) {
    return {
      muzzle: { x: 0.5, y: 0.5 },
      hit: { x: 0.5, y: 0.5 },
      engine: { x: 0.5, y: 0.5 },
      shieldCenter: { x: 0.5, y: 0.5 },
    };
  }
  return entry.hardpoints;
}
