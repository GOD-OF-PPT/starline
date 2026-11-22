/// <reference types="vite/client" />
import { getItemDef, type LoadoutId } from '../data/items';
import type { EnemyArchetype, SectorBgIndex } from '../data/nodes';
import { SHAPES } from '../data/shapes';

/**
 * Illustrated high-craft game asset URL resolver (v3.0 + V2 Voyage Management).
 * Serves all 56 hand-painted industrial sci-fi WebP assets from /assets/
 * (31 top-down items including 10 V2 equipment families x 2 qualities & 2 mission cargos,
 * 9 POT side-view ships including Heavy Freighter & 2 BOSS warships,
 * 5 base diorama layers, 6 deep-space sector backdrops, 4 non-combat event scenes,
 * and 16:9 title screen key art).
 */

const BASE = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';

function assetUrl(relPath: string): string {
  const prefix = BASE.endsWith('/') ? BASE : `${BASE}/`;
  return `${prefix}assets/${relPath}`;
}

/** Alias V2 repair drone IDs onto the crisp hand-painted L3 repair drone sprites */
const ITEM_ALIASES: Record<string, string> = {
  'equipment.repair.common': 'equipment.drone.common',
  'equipment.repair.improved': 'equipment.drone.improved',
};

const KNOWN_ITEM_IDS = new Set([
  'equipment.laser.common',
  'equipment.laser.improved',
  'equipment.battery.common',
  'equipment.battery.improved',
  'equipment.shield.common',
  'equipment.shield.improved',
  'equipment.drone.common',
  'equipment.drone.improved',
  'equipment.heavy.common',
  'equipment.heavy.improved',
  'equipment.capacitor.common',
  'equipment.capacitor.improved',
  'equipment.hangar.common',
  'equipment.hangar.improved',
  'equipment.relay.common',
  'equipment.relay.improved',
  'equipment.counter.common',
  'equipment.counter.improved',
  'equipment.flak.common',
  'equipment.flak.improved',
  'cargo.data_box',
  'cargo.alloy_bar',
  'cargo.coolant_tank',
  'cargo.old_engine',
  'cargo.folding_antenna',
  'cargo.ancient_navigator',
  'cargo.quantum_core',
  'cargo.cryo_amber',
  'cargo.obsidian_crown',
  'mission.sealed_reactor',
  'mission.escape_pod',
]);

export function getItemImageUrl(defId: string): string {
  const canonical = ITEM_ALIASES[defId] ?? defId;
  if (KNOWN_ITEM_IDS.has(canonical)) {
    return assetUrl(`items/${canonical.replace(/\./g, '_')}.webp`);
  }
  const def = getItemDef(defId);
  const shape = SHAPES[def.shapeId];
  const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${shape.sourcePixelWidth} ${shape.sourcePixelHeight}" width="${shape.sourcePixelWidth}" height="${shape.sourcePixelHeight}"><rect x="12" y="12" width="${shape.sourcePixelWidth - 24}" height="${shape.sourcePixelHeight - 24}" rx="12" fill="#566477"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fallbackSvg)}`;
}

export function getPlayerShipImageUrl(loadoutId: LoadoutId | 'heavy_freighter'): string {
  return assetUrl(`ships/player_${loadoutId}.webp`);
}

export function getEnemyShipImageUrl(archetype: EnemyArchetype): string {
  return assetUrl(`ships/enemy_${archetype}.webp`);
}

export function getSectorBgImageUrl(sectorIndex: SectorBgIndex): string {
  return assetUrl(`bg/sector_${sectorIndex}.webp`);
}

export function getEventBackdropImageUrl(
  eventKind: 'wreck' | 'merchant' | 'anomaly' | 'distress'
): string {
  return assetUrl(`events/event_${eventKind}.webp`);
}

export function getTitleKeyArtUrl(): string {
  return assetUrl('ui/title_key_art.webp');
}

export function getBaseLayerImageUrl(
  layer: 'worn' | 'workbench' | 'display_empty' | 'display_relic' | 'drydock'
): string {
  if (layer === 'worn') return assetUrl('base/station_worn.webp');
  return assetUrl(`base/overlay_${layer}.webp`);
}

export type V2ShipModuleArtKey =
  | 'laser_turret'
  | 'heavy_railgun'
  | 'drone_bay'
  | 'counter_ring'
  | 'cargo_rack';

export function getShipModuleImageUrl(mod: V2ShipModuleArtKey): string {
  return assetUrl(`modules/mod_${mod}.webp`);
}

