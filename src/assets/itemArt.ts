/// <reference types="vite/client" />
import { getItemDef, type LoadoutId } from '../data/items';
import type { EnemyArchetype } from '../data/nodes';
import { SHAPES } from '../data/shapes';

/**
 * Illustrated high-craft game asset URL resolver (v2.0).
 * Serves pre-extracted hand-painted industrial sci-fi WebP sprites from /assets/
 * (192px/cell items with 100% transparent L3/T4 cutouts, 512x256 POT side-view ships,
 * 1280x720 base diorama + overlays, and 1280x720 deep-space sector backdrops).
 */

const BASE = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';

function assetUrl(relPath: string): string {
  const prefix = BASE.endsWith('/') ? BASE : `${BASE}/`;
  return `${prefix}assets/${relPath}`;
}

const KNOWN_ITEM_IDS = new Set([
  'equipment.laser.common',
  'equipment.laser.improved',
  'equipment.battery.common',
  'equipment.battery.improved',
  'equipment.shield.common',
  'equipment.shield.improved',
  'equipment.drone.common',
  'equipment.drone.improved',
  'cargo.data_box',
  'cargo.alloy_bar',
  'cargo.coolant_tank',
  'cargo.old_engine',
  'cargo.folding_antenna',
  'cargo.ancient_navigator',
]);

export function getItemImageUrl(defId: string): string {
  if (KNOWN_ITEM_IDS.has(defId)) {
    return assetUrl(`items/${defId.replace(/\./g, '_')}.webp`);
  }
  const def = getItemDef(defId);
  const shape = SHAPES[def.shapeId];
  const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${shape.sourcePixelWidth} ${shape.sourcePixelHeight}" width="${shape.sourcePixelWidth}" height="${shape.sourcePixelHeight}"><rect x="12" y="12" width="${shape.sourcePixelWidth - 24}" height="${shape.sourcePixelHeight - 24}" rx="12" fill="#566477"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fallbackSvg)}`;
}

export function getPlayerShipImageUrl(loadoutId: LoadoutId): string {
  return assetUrl(`ships/player_${loadoutId}.webp`);
}

export function getEnemyShipImageUrl(archetype: EnemyArchetype): string {
  return assetUrl(`ships/enemy_${archetype}.webp`);
}

export function getSectorBgImageUrl(sectorIndex: 1 | 2 | 3): string {
  return assetUrl(`bg/sector_${sectorIndex}.webp`);
}

export function getBaseLayerImageUrl(
  layer: 'worn' | 'workbench' | 'display_empty' | 'display_relic' | 'drydock'
): string {
  if (layer === 'worn') return assetUrl('base/station_worn.webp');
  return assetUrl(`base/overlay_${layer}.webp`);
}
