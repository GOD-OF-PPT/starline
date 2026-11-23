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
  'mission.black_box': 'cargo.data_box',
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

function makeSvgDataUri(w: number, h: number, body: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function makeEquipArt(
  cols: number,
  rows: number,
  improved: boolean,
  accent: string,
  secondary: string,
  emblem: string
): string {
  const w = cols * 192;
  const h = rows * 192;
  const frameStroke = improved ? '#F6B852' : '#6F86A1';
  const bgTop = improved ? '#24344C' : '#1B283A';
  const bgBot = improved ? '#142033' : '#111A28';
  const rimGlow = improved
    ? `<rect x="14" y="14" width="${w - 28}" height="${h - 28}" rx="20" fill="none" stroke="#F6B852" stroke-width="5" opacity="0.55"/>`
    : '';
  const body = `
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${bgTop}"/>
        <stop offset="100%" stop-color="${bgBot}"/>
      </linearGradient>
    </defs>
    <rect x="8" y="8" width="${w - 16}" height="${h - 16}" rx="22" fill="url(#g)" stroke="${frameStroke}" stroke-width="7"/>
    ${rimGlow}
    <circle cx="28" cy="28" r="5" fill="${secondary}" opacity="0.8"/>
    <circle cx="${w - 28}" cy="28" r="5" fill="${secondary}" opacity="0.8"/>
    <circle cx="28" cy="${h - 28}" r="5" fill="${secondary}" opacity="0.8"/>
    <circle cx="${w - 28}" cy="${h - 28}" r="5" fill="${secondary}" opacity="0.8"/>
    <g stroke="${accent}" stroke-linecap="round" stroke-linejoin="round">${emblem}</g>
  `;
  return makeSvgDataUri(w, h, body);
}

function makeGadgetArt(accent: string, coreFill: string, glyph: string): string {
  const body = `
    <defs>
      <radialGradient id="rg" cx="50%" cy="45%" r="55%">
        <stop offset="0%" stop-color="${coreFill}"/>
        <stop offset="100%" stop-color="#132033"/>
      </radialGradient>
    </defs>
    <rect x="10" y="10" width="172" height="172" rx="28" fill="url(#rg)" stroke="${accent}" stroke-width="8"/>
    <rect x="24" y="24" width="144" height="144" rx="18" fill="none" stroke="${accent}" stroke-width="2.5" stroke-dasharray="10 7" opacity="0.7"/>
    <g stroke="${accent}" fill="none" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>
  `;
  return makeSvgDataUri(192, 192, body);
}

const V3_INLINE_ITEM_ART: Record<string, string> = {
  // 1. coolant_vent (1x2 = 192x384)
  'equipment.coolant_vent.common': makeEquipArt(
    1,
    2,
    false,
    '#7DD3FC',
    '#38BDF8',
    `<rect x="52" y="42" width="88" height="300" rx="18" fill="#12304A" stroke-width="6"/>
     <line x1="66" y1="92" x2="126" y2="92" stroke-width="10"/>
     <line x1="66" y1="142" x2="126" y2="142" stroke-width="10"/>
     <line x1="66" y1="192" x2="126" y2="192" stroke-width="10"/>
     <line x1="66" y1="242" x2="126" y2="242" stroke-width="10"/>
     <line x1="66" y1="292" x2="126" y2="292" stroke-width="10"/>
     <circle cx="96" cy="192" r="24" fill="#38BDF8" fill-opacity="0.25" stroke-width="5"/>`
  ),
  'equipment.coolant_vent.improved': makeEquipArt(
    1,
    2,
    true,
    '#BAE6FD',
    '#F6B852',
    `<rect x="48" y="38" width="96" height="308" rx="20" fill="#173D5C" stroke-width="7"/>
     <line x1="64" y1="88" x2="128" y2="88" stroke-width="11"/>
     <line x1="64" y1="140" x2="128" y2="140" stroke-width="11"/>
     <line x1="64" y1="192" x2="128" y2="192" stroke-width="11"/>
     <line x1="64" y1="244" x2="128" y2="244" stroke-width="11"/>
     <line x1="64" y1="296" x2="128" y2="296" stroke-width="11"/>
     <circle cx="96" cy="192" r="28" fill="#7DD3FC" fill-opacity="0.38" stroke="#F6B852" stroke-width="5"/>`
  ),
  // 2. cargo_amp (1x1 = 192x192)
  'equipment.cargo_amp.common': makeEquipArt(
    1,
    1,
    false,
    '#FBBF24',
    '#F59E0B',
    `<polygon points="96,34 154,96 96,158 38,96" fill="#3B2A12" stroke-width="7"/>
     <rect x="74" y="74" width="44" height="44" rx="6" fill="#FBBF24" fill-opacity="0.32" stroke-width="5"/>
     <line x1="96" y1="24" x2="96" y2="48" stroke-width="6"/>
     <line x1="96" y1="144" x2="96" y2="168" stroke-width="6"/>
     <line x1="24" y1="96" x2="48" y2="96" stroke-width="6"/>
     <line x1="144" y1="96" x2="168" y2="96" stroke-width="6"/>`
  ),
  'equipment.cargo_amp.improved': makeEquipArt(
    1,
    1,
    true,
    '#FDE68A',
    '#F6B852',
    `<polygon points="96,30 158,96 96,162 34,96" fill="#4D3512" stroke-width="8"/>
     <circle cx="96" cy="96" r="30" fill="#FBBF24" fill-opacity="0.4" stroke-width="5"/>
     <line x1="96" y1="20" x2="96" y2="52" stroke-width="7"/>
     <line x1="96" y1="140" x2="96" y2="172" stroke-width="7"/>
     <line x1="20" y1="96" x2="52" y2="96" stroke-width="7"/>
     <line x1="140" y1="96" x2="172" y2="96" stroke-width="7"/>`
  ),
  // 3. emp_jammer (1x2 = 192x384)
  'equipment.emp_jammer.common': makeEquipArt(
    1,
    2,
    false,
    '#A78BFA',
    '#8B5CF6',
    `<circle cx="96" cy="110" r="46" fill="#2A1D4D" stroke-width="7"/>
     <circle cx="96" cy="110" r="22" fill="#A78BFA" fill-opacity="0.35" stroke-width="5"/>
     <path d="M96 158 L96 334" stroke-width="9"/>
     <path d="M58 214 Q96 186 134 214" fill="none" stroke-width="6"/>
     <path d="M52 266 Q96 238 140 266" fill="none" stroke-width="6"/>
     <path d="M62 316 Q96 292 130 316" fill="none" stroke-width="6"/>`
  ),
  'equipment.emp_jammer.improved': makeEquipArt(
    1,
    2,
    true,
    '#DDD6FE',
    '#F6B852',
    `<circle cx="96" cy="108" r="50" fill="#372466" stroke-width="8"/>
     <circle cx="96" cy="108" r="24" fill="#C4B5FD" fill-opacity="0.5" stroke="#F6B852" stroke-width="5"/>
     <path d="M96 158 L96 338" stroke-width="10"/>
     <path d="M52 210 Q96 178 140 210" fill="none" stroke-width="7"/>
     <path d="M46 264 Q96 230 146 264" fill="none" stroke-width="7"/>
     <path d="M56 318 Q96 288 136 318" fill="none" stroke-width="7"/>`
  ),
  // 4. overdrive_core (2x2 = 384x384)
  'equipment.overdrive_core.common': makeEquipArt(
    2,
    2,
    false,
    '#FB7185',
    '#F43F5E',
    `<polygon points="192,46 322,120 322,264 192,338 62,264 62,120" fill="#3D1624" stroke-width="9"/>
     <circle cx="192" cy="192" r="72" fill="#FB7185" fill-opacity="0.22" stroke-width="8"/>
     <path d="M204 114 L152 200 L196 200 L178 272 L236 182 L190 182 Z" fill="#FB7185" stroke-width="5"/>`
  ),
  'equipment.overdrive_core.improved': makeEquipArt(
    2,
    2,
    true,
    '#FDA4AF',
    '#F6B852',
    `<polygon points="192,40 328,116 328,268 192,344 56,268 56,116" fill="#521B2E" stroke-width="10"/>
     <circle cx="192" cy="192" r="82" fill="#FB7185" fill-opacity="0.32" stroke="#F6B852" stroke-width="7"/>
     <path d="M206 108 L148 200 L196 200 L176 278 L242 180 L192 180 Z" fill="#FDE68A" stroke-width="5"/>`
  ),
  // 5. salvage_grapple (1x2 = 192x384)
  'equipment.salvage_grapple.common': makeEquipArt(
    1,
    2,
    false,
    '#34D399',
    '#10B981',
    `<rect x="66" y="218" width="60" height="122" rx="14" fill="#133A2E" stroke-width="7"/>
     <line x1="96" y1="120" x2="96" y2="218" stroke-width="12"/>
     <path d="M96 122 L44 82 L58 46" fill="none" stroke-width="10"/>
     <path d="M96 122 L148 82 L134 46" fill="none" stroke-width="10"/>
     <circle cx="96" cy="124" r="16" fill="#34D399" fill-opacity="0.35" stroke-width="5"/>`
  ),
  'equipment.salvage_grapple.improved': makeEquipArt(
    1,
    2,
    true,
    '#6EE7B7',
    '#F6B852',
    `<rect x="62" y="214" width="68" height="128" rx="16" fill="#164A3B" stroke-width="8"/>
     <line x1="96" y1="114" x2="96" y2="214" stroke-width="14"/>
     <path d="M96 118 L38 78 L54 40" fill="none" stroke-width="11"/>
     <path d="M96 118 L154 78 L138 40" fill="none" stroke-width="11"/>
     <circle cx="96" cy="120" r="20" fill="#6EE7B7" fill-opacity="0.45" stroke="#F6B852" stroke-width="5"/>`
  ),
  // 6. salvo_pod (1x3 = 192x576)
  'equipment.salvo_pod.common': makeEquipArt(
    1,
    3,
    false,
    '#F97316',
    '#FB923C',
    `<rect x="44" y="42" width="104" height="492" rx="20" fill="#3B1F12" stroke-width="7"/>
     <circle cx="96" cy="126" r="34" fill="#F97316" fill-opacity="0.28" stroke-width="7"/>
     <circle cx="96" cy="126" r="12" fill="#FED7AA"/>
     <circle cx="96" cy="288" r="34" fill="#F97316" fill-opacity="0.28" stroke-width="7"/>
     <circle cx="96" cy="288" r="12" fill="#FED7AA"/>
     <circle cx="96" cy="450" r="34" fill="#F97316" fill-opacity="0.28" stroke-width="7"/>
     <circle cx="96" cy="450" r="12" fill="#FED7AA"/>`
  ),
  'equipment.salvo_pod.improved': makeEquipArt(
    1,
    3,
    true,
    '#FDBA74',
    '#F6B852',
    `<rect x="40" y="38" width="112" height="500" rx="22" fill="#4D2614" stroke-width="8"/>
     <circle cx="96" cy="124" r="38" fill="#FB923C" fill-opacity="0.38" stroke="#F6B852" stroke-width="7"/>
     <circle cx="96" cy="124" r="14" fill="#FEF3C7"/>
     <circle cx="96" cy="288" r="38" fill="#FB923C" fill-opacity="0.38" stroke="#F6B852" stroke-width="7"/>
     <circle cx="96" cy="288" r="14" fill="#FEF3C7"/>
     <circle cx="96" cy="452" r="38" fill="#FB923C" fill-opacity="0.38" stroke="#F6B852" stroke-width="7"/>
     <circle cx="96" cy="452" r="14" fill="#FEF3C7"/>`
  ),
  // 4 Consumable 1x1 Tactical Gadgets
  'gadget.repair_kit': makeGadgetArt(
    '#4ADE80',
    '#144028',
    `<path d="M96 52 V140 M52 96 H140" stroke-width="20"/>
     <circle cx="96" cy="96" r="56" stroke-width="4" opacity="0.45"/>`
  ),
  'gadget.overcharge_cell': makeGadgetArt(
    '#FACC15',
    '#45340E',
    `<path d="M108 42 L60 104 H98 L84 150 L134 88 H96 Z" fill="#FACC15" stroke-width="6"/>`
  ),
  'gadget.jump_canister': makeGadgetArt(
    '#38BDF8',
    '#11354E',
    `<rect x="64" y="48" width="64" height="98" rx="14" fill="#38BDF8" fill-opacity="0.24" stroke-width="8"/>
     <line x1="78" y1="36" x2="114" y2="36" stroke-width="10"/>
     <path d="M78 106 L96 80 L114 106" stroke-width="8"/>`
  ),
  'gadget.cut_stabilizer': makeGadgetArt(
    '#C084FC',
    '#321B4E',
    `<circle cx="96" cy="96" r="42" stroke-width="8"/>
     <line x1="96" y1="36" x2="96" y2="66" stroke-width="8"/>
     <line x1="96" y1="126" x2="96" y2="156" stroke-width="8"/>
     <line x1="36" y1="96" x2="66" y2="96" stroke-width="8"/>
     <line x1="126" y1="96" x2="156" y2="96" stroke-width="8"/>
     <circle cx="96" cy="96" r="12" fill="#C084FC"/>`
  ),
};

export function getItemImageUrl(defId: string): string {
  if (Object.prototype.hasOwnProperty.call(V3_INLINE_ITEM_ART, defId)) {
    return V3_INLINE_ITEM_ART[defId];
  }
  const canonical = ITEM_ALIASES[defId] ?? defId;
  if (KNOWN_ITEM_IDS.has(canonical)) {
    return assetUrl(`items/${canonical.replace(/\./g, '_')}.webp`);
  }
  try {
    const def = getItemDef(defId);
    const shape = SHAPES[def.shapeId];
    const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${shape.sourcePixelWidth} ${shape.sourcePixelHeight}" width="${shape.sourcePixelWidth}" height="${shape.sourcePixelHeight}"><rect x="12" y="12" width="${shape.sourcePixelWidth - 24}" height="${shape.sourcePixelHeight - 24}" rx="12" fill="#566477"/></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fallbackSvg)}`;
  } catch {
    return makeGadgetArt('#7B93AD', '#1A2738', `<circle cx="96" cy="96" r="30" stroke-width="8"/>`);
  }
}

export function getPlayerShipImageUrl(
  loadoutId: LoadoutId | 'heavy_freighter' | 'stargate_cruiser'
): string {
  const canonical = loadoutId === 'stargate_cruiser' ? 'shield_cruiser' : loadoutId;
  return assetUrl(`ships/player_${canonical}.webp`);
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

