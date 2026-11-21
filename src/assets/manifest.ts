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
  // Top-down illustrated equipment & cargo sprites (192px/cell, 100% transparent L3/T4 cutouts)
  'equipment.laser.common': {
    key: 'equipment.laser.common',
    version: 'v004',
    view: 'top',
    canvasWidth: 192,
    canvasHeight: 384,
    anchor: { x: 0, y: 0 },
    source: 'public/assets/items/equipment_laser_common.webp',
    license: 'Original Starline First-Party Illustrated',
  },
  'equipment.laser.improved': {
    key: 'equipment.laser.improved',
    version: 'v004',
    view: 'top',
    canvasWidth: 192,
    canvasHeight: 384,
    anchor: { x: 0, y: 0 },
    source: 'public/assets/items/equipment_laser_improved.webp',
    license: 'Original Starline First-Party Illustrated',
  },
  'equipment.battery.common': {
    key: 'equipment.battery.common',
    version: 'v004',
    view: 'top',
    canvasWidth: 192,
    canvasHeight: 192,
    anchor: { x: 0, y: 0 },
    source: 'public/assets/items/equipment_battery_common.webp',
    license: 'Original Starline First-Party Illustrated',
  },
  'equipment.battery.improved': {
    key: 'equipment.battery.improved',
    version: 'v004',
    view: 'top',
    canvasWidth: 192,
    canvasHeight: 192,
    anchor: { x: 0, y: 0 },
    source: 'public/assets/items/equipment_battery_improved.webp',
    license: 'Original Starline First-Party Illustrated',
  },
  'equipment.shield.common': {
    key: 'equipment.shield.common',
    version: 'v004',
    view: 'top',
    canvasWidth: 192,
    canvasHeight: 384,
    anchor: { x: 0, y: 0 },
    source: 'public/assets/items/equipment_shield_common.webp',
    license: 'Original Starline First-Party Illustrated',
  },
  'equipment.shield.improved': {
    key: 'equipment.shield.improved',
    version: 'v004',
    view: 'top',
    canvasWidth: 192,
    canvasHeight: 384,
    anchor: { x: 0, y: 0 },
    source: 'public/assets/items/equipment_shield_improved.webp',
    license: 'Original Starline First-Party Illustrated',
  },
  'equipment.drone.common': {
    key: 'equipment.drone.common',
    version: 'v004',
    view: 'top',
    canvasWidth: 384,
    canvasHeight: 384,
    anchor: { x: 0, y: 0 },
    source: 'public/assets/items/equipment_drone_common.webp',
    license: 'Original Starline First-Party Illustrated',
  },
  'equipment.drone.improved': {
    key: 'equipment.drone.improved',
    version: 'v004',
    view: 'top',
    canvasWidth: 384,
    canvasHeight: 384,
    anchor: { x: 0, y: 0 },
    source: 'public/assets/items/equipment_drone_improved.webp',
    license: 'Original Starline First-Party Illustrated',
  },
  'cargo.data_box': {
    key: 'cargo.data_box',
    version: 'v004',
    view: 'top',
    canvasWidth: 192,
    canvasHeight: 192,
    anchor: { x: 0, y: 0 },
    source: 'public/assets/items/cargo_data_box.webp',
    license: 'Original Starline First-Party Illustrated',
  },
  'cargo.alloy_bar': {
    key: 'cargo.alloy_bar',
    version: 'v004',
    view: 'top',
    canvasWidth: 192,
    canvasHeight: 384,
    anchor: { x: 0, y: 0 },
    source: 'public/assets/items/cargo_alloy_bar.webp',
    license: 'Original Starline First-Party Illustrated',
  },
  'cargo.coolant_tank': {
    key: 'cargo.coolant_tank',
    version: 'v004',
    view: 'top',
    canvasWidth: 192,
    canvasHeight: 576,
    anchor: { x: 0, y: 0 },
    source: 'public/assets/items/cargo_coolant_tank.webp',
    license: 'Original Starline First-Party Illustrated',
  },
  'cargo.old_engine': {
    key: 'cargo.old_engine',
    version: 'v004',
    view: 'top',
    canvasWidth: 384,
    canvasHeight: 384,
    anchor: { x: 0, y: 0 },
    source: 'public/assets/items/cargo_old_engine.webp',
    license: 'Original Starline First-Party Illustrated',
  },
  'cargo.folding_antenna': {
    key: 'cargo.folding_antenna',
    version: 'v004',
    view: 'top',
    canvasWidth: 384,
    canvasHeight: 384,
    anchor: { x: 0, y: 0 },
    source: 'public/assets/items/cargo_folding_antenna.webp',
    license: 'Original Starline First-Party Illustrated',
  },
  'cargo.ancient_navigator': {
    key: 'cargo.ancient_navigator',
    version: 'v004',
    view: 'top',
    canvasWidth: 576,
    canvasHeight: 384,
    anchor: { x: 0, y: 0 },
    source: 'public/assets/items/cargo_ancient_navigator.webp',
    license: 'Original Starline First-Party Illustrated',
  },

  // Illustrated side-view combat ship sprites (512x256 POT WebP for WebGL trilinear mipmaps)
  'ship.player.cannon_skiff': {
    key: 'ship.player.cannon_skiff',
    version: 'v004',
    view: 'side',
    canvasWidth: 512,
    canvasHeight: 256,
    anchor: { x: 0.5, y: 0.5 },
    hardpoints: {
      muzzle: { x: 0.94, y: 0.54 },
      hit: { x: 0.54, y: 0.48 },
      engine: { x: 0.08, y: 0.52 },
      shieldCenter: { x: 0.56, y: 0.50 },
    },
    source: 'public/assets/ships/player_cannon_skiff.webp',
    license: 'Original Starline First-Party Illustrated',
  },
  'ship.player.shield_cruiser': {
    key: 'ship.player.shield_cruiser',
    version: 'v004',
    view: 'side',
    canvasWidth: 512,
    canvasHeight: 256,
    anchor: { x: 0.5, y: 0.5 },
    hardpoints: {
      muzzle: { x: 0.49, y: 0.19 },
      hit: { x: 0.60, y: 0.50 },
      engine: { x: 0.08, y: 0.54 },
      shieldCenter: { x: 0.72, y: 0.52 },
    },
    source: 'public/assets/ships/player_shield_cruiser.webp',
    license: 'Original Starline First-Party Illustrated',
  },
  'ship.enemy.scout': {
    key: 'ship.enemy.scout',
    version: 'v004',
    view: 'side',
    canvasWidth: 512,
    canvasHeight: 256,
    anchor: { x: 0.5, y: 0.5 },
    hardpoints: {
      muzzle: { x: 0.08, y: 0.65 },
      hit: { x: 0.46, y: 0.50 },
      engine: { x: 0.91, y: 0.50 },
      shieldCenter: { x: 0.46, y: 0.50 },
    },
    source: 'public/assets/ships/enemy_scout.webp',
    license: 'Original Starline First-Party Illustrated',
  },
  'ship.enemy.frigate': {
    key: 'ship.enemy.frigate',
    version: 'v004',
    view: 'side',
    canvasWidth: 512,
    canvasHeight: 256,
    anchor: { x: 0.5, y: 0.5 },
    hardpoints: {
      muzzle: { x: 0.07, y: 0.53 },
      hit: { x: 0.48, y: 0.50 },
      engine: { x: 0.91, y: 0.52 },
      shieldCenter: { x: 0.48, y: 0.50 },
    },
    source: 'public/assets/ships/enemy_frigate.webp',
    license: 'Original Starline First-Party Illustrated',
  },
  'ship.enemy.hulk': {
    key: 'ship.enemy.hulk',
    version: 'v004',
    view: 'side',
    canvasWidth: 512,
    canvasHeight: 256,
    anchor: { x: 0.5, y: 0.5 },
    hardpoints: {
      muzzle: { x: 0.05, y: 0.50 },
      hit: { x: 0.48, y: 0.52 },
      engine: { x: 0.94, y: 0.52 },
      shieldCenter: { x: 0.48, y: 0.52 },
    },
    source: 'public/assets/ships/enemy_hulk.webp',
    license: 'Original Starline First-Party Illustrated',
  },

  // Illustrated 2:1 Axonometric Orbital Station Base + Same-Camera Quadrant Overlays
  'base.station.worn': {
    key: 'base.station.worn',
    version: 'v004',
    view: 'iso',
    canvasWidth: 1280,
    canvasHeight: 720,
    anchor: { x: 0.5, y: 0.5 },
    source: 'public/assets/base/station_worn.webp',
    license: 'Original Starline First-Party Illustrated',
  },
  'base.overlay.workbench': {
    key: 'base.overlay.workbench',
    version: 'v004',
    view: 'iso',
    canvasWidth: 1280,
    canvasHeight: 720,
    anchor: { x: 0.5, y: 0.5 },
    source: 'public/assets/base/overlay_workbench.webp',
    license: 'Original Starline First-Party Illustrated',
  },
  'base.overlay.display_empty': {
    key: 'base.overlay.display_empty',
    version: 'v004',
    view: 'iso',
    canvasWidth: 1280,
    canvasHeight: 720,
    anchor: { x: 0.5, y: 0.5 },
    source: 'public/assets/base/overlay_display_empty.webp',
    license: 'Original Starline First-Party Illustrated',
  },
  'base.overlay.display_relic': {
    key: 'base.overlay.display_relic',
    version: 'v004',
    view: 'iso',
    canvasWidth: 1280,
    canvasHeight: 720,
    anchor: { x: 0.5, y: 0.5 },
    source: 'public/assets/base/overlay_display_relic.webp',
    license: 'Original Starline First-Party Illustrated',
  },
  'base.overlay.drydock': {
    key: 'base.overlay.drydock',
    version: 'v004',
    view: 'iso',
    canvasWidth: 1280,
    canvasHeight: 720,
    anchor: { x: 0.5, y: 0.5 },
    source: 'public/assets/base/overlay_drydock.webp',
    license: 'Original Starline First-Party Illustrated',
  },

  // Illustrated Deep-Space Combat Sector Backdrops
  'bg.sector.1': {
    key: 'bg.sector.1',
    version: 'v004',
    view: 'side',
    canvasWidth: 1280,
    canvasHeight: 720,
    anchor: { x: 0.5, y: 0.5 },
    source: 'public/assets/bg/sector_1.webp',
    license: 'Original Starline First-Party Illustrated',
  },
  'bg.sector.2': {
    key: 'bg.sector.2',
    version: 'v004',
    view: 'side',
    canvasWidth: 1280,
    canvasHeight: 720,
    anchor: { x: 0.5, y: 0.5 },
    source: 'public/assets/bg/sector_2.webp',
    license: 'Original Starline First-Party Illustrated',
  },
  'bg.sector.3': {
    key: 'bg.sector.3',
    version: 'v004',
    view: 'side',
    canvasWidth: 1280,
    canvasHeight: 720,
    anchor: { x: 0.5, y: 0.5 },
    source: 'public/assets/bg/sector_3.webp',
    license: 'Original Starline First-Party Illustrated',
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
