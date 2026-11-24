import type { V2CrewId } from '../data/crew';

/**
 * Unified 1.5px stroke industrial sci-fi inline SVG icon kit (Phase C + V3 M2).
 * Replaces platform-inconsistent emojis across HUD, Base Station dock, Map, Events, Campaign, and Modals.
 */

export type V2IconName =
  | 'fuel'
  | 'hull'
  | 'shield'
  | 'credits'
  | 'cannon'
  | 'drone'
  | 'counter'
  | 'wrench'
  | 'radar'
  | 'crate'
  | 'star'
  | 'lock'
  | 'warehouse'
  | 'museum'
  | 'book'
  | 'settings'
  | 'help'
  | 'swap'
  | 'rocket'
  | 'beacon'
  | 'wreck'
  | 'merchant'
  | 'anomaly'
  | 'distress'
  | 'elite'
  | 'combat'
  | 'check'
  | 'bolt'
  | 'grid'
  | 'campaign'
  | 'comms'
  | 'cryo'
  | 'gravity'
  | 'medal'
  | 'chevronDown'
  | 'chevronUp'
  | 'target'
  | 'boss'
  | 'parts'
  | 'cut'
  | 'warning'
  | 'faction'
  | 'upgrade';

const ICON_PATHS: Record<V2IconName, string> = {
  fuel: '<path d="M5 4h7a2 2 0 0 1 2 2v13H4V6a2 2 0 0 1 1-2Z"/><path d="M14 8h2l2 2v5a1.5 1.5 0 0 1-3 0v-3"/><path d="M7 10h4"/><path d="M3 19h12"/>',
  hull: '<path d="M12 3 4 6.5v5.2c0 4.6 3.2 7.8 8 9.3 4.8-1.5 8-4.7 8-9.3V6.5L12 3Z"/><path d="M9 12h6M12 9v6"/>',
  shield: '<path d="M12 3 4.5 6.2v5.4c0 4.4 3.1 7.6 7.5 9.1 4.4-1.5 7.5-4.7 7.5-9.1V6.2L12 3Z"/><path d="M12 6.8v10.2" opacity=".55"/>',
  credits: '<circle cx="12" cy="12" r="8"/><path d="M9 9.5h6M9 14.5h6M12 7.5v9"/>',
  cannon: '<path d="M3 14h10l2-2h6v-3h-6l-2-2H3v7Z"/><path d="M6 14v4h5v-4"/><path d="M17 10.5h3"/>',
  drone: '<circle cx="12" cy="12" r="2.6"/><path d="M4.5 6.5 9.6 10M19.5 6.5 14.4 10M4.5 17.5 9.6 14M19.5 17.5 14.4 14"/><circle cx="4.5" cy="6.5" r="2"/><circle cx="19.5" cy="6.5" r="2"/><circle cx="4.5" cy="17.5" r="2"/><circle cx="19.5" cy="17.5" r="2"/>',
  counter: '<path d="M12 3a9 9 0 0 0-7 14.6"/><path d="M12 3a9 9 0 0 1 7 14.6"/><path d="M13 7 9.5 12h3.5L11 17l4.5-6H12l1-4Z"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.3 2.3-2.2-.8-.8-2.2 2.3-2.3Z"/>',
  radar: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4" opacity=".65"/><path d="M12 12l5.5-5.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  crate: '<path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>',
  star: '<path d="m12 3.5 2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.4l-5.1 2.7 1-5.6-4.1-4 5.7-.8L12 3.5Z"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  warehouse: '<path d="M3 9 12 4l9 5v11H3V9Z"/><path d="M7 20v-7h10v7"/><path d="M7 16h10"/>',
  museum: '<path d="M3 9 12 4l9 5H3Z"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8"/><path d="M3 19h18"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21V5.5Z"/><path d="M8 7h8M8 11h6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.4M12 19.1v2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.8 2.1c-.9.5-1.3 1-1.3 1.9v.5"/><circle cx="12" cy="17" r=".8" fill="currentColor"/>',
  swap: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>',
  rocket: '<path d="M14.5 4.5c3.5-.5 5 1 5 5-1.8 3.2-4.8 6.2-8 8l-5-5c1.8-3.2 4.8-6.2 8-8Z"/><path d="M6.5 12.5 4 15l5 5 2.5-2.5"/><circle cx="14.5" cy="9.5" r="1.4"/>',
  beacon: '<path d="M12 4v16"/><path d="M8 20h8"/><path d="M7.8 9.2a6 6 0 0 1 8.4 0"/><path d="M5 6.4a10 10 0 0 1 14 0"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>',
  wreck: '<path d="M3 14 8 6l4 3 4-4 5 9-4 5H7l-4-5Z"/><path d="M10 11l3 4"/>',
  merchant: '<path d="M4 9h16l-1.5 10h-13L4 9Z"/><path d="M7 9V6.5a5 5 0 0 1 10 0V9"/><path d="M9.5 13.5h5"/>',
  anomaly: '<circle cx="12" cy="12" r="3"/><path d="M12 3a9 9 0 0 1 8.4 5.8"/><path d="M12 21a9 9 0 0 1-8.4-5.8"/><path d="M3.6 8.8A9 9 0 0 1 12 3"/><path d="M20.4 15.2A9 9 0 0 1 12 21"/>',
  distress: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/>',
  elite: '<path d="m12 2.8 2.8 5.2 5.7 1-4 4.2.8 5.8L12 16.3 6.7 19l.8-5.8-4-4.2 5.7-1L12 2.8Z"/><circle cx="12" cy="11.5" r="2"/>',
  combat: '<path d="M4 20 14 10M20 4l-6 6M14 4h6v6M4 14l6 6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  bolt: '<path d="M13 2 5 13h6l-1 9 9-12h-6l0-8Z"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/>',
  campaign: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5" opacity=".75"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>',
  comms: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V16H6.5A2.5 2.5 0 0 1 4 13.5v-7Z"/><path d="M8.5 9.5h7M8.5 12.5h4.5"/>',
  cryo: '<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/><path d="m10 5 2 2 2-2M10 19l2-2 2 2"/>',
  gravity: '<circle cx="12" cy="12" r="2.5"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(-24 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(24 12 12)" opacity=".65"/>',
  medal: '<circle cx="12" cy="10" r="5.5"/><path d="M9 14.8 7.5 21l4.5-2.2L16.5 21 15 14.8"/><path d="m12 7.2.9 1.9 2 .3-1.5 1.4.4 2-1.8-.9-1.8.9.4-2-1.5-1.4 2-.3.9-1.9Z"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronUp: '<path d="m6 15 6-6 6 6"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22"/>',
  boss: '<path d="m12 2.5 3.5 4.2 5.5-1.2-2.2 5.4 3.2 4.6-5.6.5L12 21.5 7.6 16l-5.6-.5 3.2-4.6L3 5.5l5.5 1.2L12 2.5Z"/><circle cx="12" cy="12" r="2.6"/>',
  parts: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M4.7 6.2l2.1 1.4M17.2 16.4l2.1 1.4M2.8 12h2.6M18.6 12h2.6M4.7 17.8l2.1-1.4M17.2 7.6l2.1-1.4"/><circle cx="12" cy="12" r="6.8" stroke-dasharray="2.5 2.5" opacity=".6"/>',
  cut: '<circle cx="6.5" cy="7" r="2.5"/><circle cx="6.5" cy="17" r="2.5"/><path d="M8.7 8.4 20 16M8.7 15.6 20 8"/><path d="M14.5 12h6.5" stroke-dasharray="2 2"/>',
  warning: '<path d="M12 3.2 21 19.2H3L12 3.2Z"/><path d="M12 9.2v4.6"/><circle cx="12" cy="16.4" r=".8" fill="currentColor"/>',
  faction: '<path d="M12 2.8 4.5 6.4v5.8c0 4.6 3.2 7.6 7.5 9 4.3-1.4 7.5-4.4 7.5-9V6.4L12 2.8Z"/><path d="m12 7.2 1.6 3.2 3.5.5-2.5 2.4.6 3.4L12 15.1l-3.2 1.6.6-3.4-2.5-2.4 3.5-.5L12 7.2Z"/>',
  upgrade: '<path d="m6 14 6-6 6 6"/><path d="m6 19.5 6-6 6 6"/><path d="M12 3.5v2.5"/>',
};

export function svgIcon(name: V2IconName, size = 15, extraClass = ''): string {
  const cls = extraClass ? `v2-ico ${extraClass}` : 'v2-ico';
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
}

/**
 * Self-contained industrial sci-fi inline SVG portraits for the 3 named crew specialists:
 * - engineer (林工): amber welding goggles, headset mic, technician collar
 * - navigator (陆衡): cyan orbital astrolabe HUD eyepiece, high-collar flight jacket
 * - salvager (苏岚): emerald-amber salvage visor & breather collar, shoulder lamp
 * Zero external requests -> 0 failedAssets.
 */
export function crewPortraitSvg(crewId: V2CrewId, size = 36, extraClass = ''): string {
  const cls = extraClass ? `v3-crew-portrait ${extraClass}` : 'v3-crew-portrait';
  if (crewId === 'engineer') {
    return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="44" height="44" rx="10" fill="#152030" stroke="#F6B852" stroke-width="1.8"/>
      <path d="M10 43c1.6-7.5 6.8-11 14-11s12.4 3.5 14 11" fill="#2A3B52" stroke="#F6B852" stroke-width="1.5"/>
      <path d="M18 32.5 24 38l6-5.5" stroke="#F6B852" stroke-width="1.5" stroke-linejoin="round"/>
      <circle cx="24" cy="21" r="8.5" fill="#E3C3A3" stroke="#6B8099" stroke-width="1.3"/>
      <path d="M15.5 18.5c1.5-5.5 15.5-5.5 17 0" fill="#27364A"/>
      <rect x="14.5" y="13.5" width="19" height="5" rx="2.5" fill="#1B2A3D" stroke="#F6B852" stroke-width="1.4"/>
      <circle cx="20" cy="16" r="2.2" fill="#F6B852"/>
      <circle cx="28" cy="16" r="2.2" fill="#F6B852"/>
      <path d="M20.5 22.5h2M25.5 22.5h2M22 25.8c1.3.9 2.7.9 4 0" stroke="#223044" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M32.5 21v3.5l-4.5 1.8" stroke="#62D6DF" stroke-width="1.4" stroke-linecap="round"/>
      <circle cx="27.5" cy="26.4" r="1.3" fill="#62D6DF"/>
    </svg>`;
  }
  if (crewId === 'navigator') {
    return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="44" height="44" rx="10" fill="#132236" stroke="#62D6DF" stroke-width="1.8"/>
      <circle cx="37" cy="11" r="4.5" stroke="#62D6DF" stroke-width="1.1" opacity="0.55"/>
      <path d="M37 5.5v11M31.5 11h11" stroke="#62D6DF" stroke-width="0.9" opacity="0.45"/>
      <path d="M10 43c1.8-7.8 6.8-11.2 14-11.2s12.2 3.4 14 11.2" fill="#1E354E" stroke="#62D6DF" stroke-width="1.5"/>
      <path d="M16 34.5 24 31l8 3.5" stroke="#62D6DF" stroke-width="1.5" stroke-linejoin="round"/>
      <circle cx="24" cy="21" r="8.3" fill="#DFC3A8" stroke="#6B8099" stroke-width="1.3"/>
      <path d="M15.8 19c.6-6.2 7.2-9 12.6-7.2 2.4.8 3.7 2.8 4 5.8-3.4-2-10.2-2.6-16.6 1.4Z" fill="#1E2C3E"/>
      <rect x="23.5" y="18.5" width="9.5" height="5" rx="1.8" fill="rgba(98,214,223,0.28)" stroke="#62D6DF" stroke-width="1.5"/>
      <circle cx="27.5" cy="21" r="1.2" fill="#62D6DF"/>
      <path d="M19.5 21.5h2M22.2 25.5c1.2.6 2.4.6 3.6 0" stroke="#223044" stroke-width="1.4" stroke-linecap="round"/>
    </svg>`;
  }
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <rect x="2" y="2" width="44" height="44" rx="10" fill="#14262D" stroke="#7AE582" stroke-width="1.8"/>
    <path d="M10 43c1.8-7.4 6.8-11 14-11s12.2 3.6 14 11" fill="#233C3D" stroke="#7AE582" stroke-width="1.5"/>
    <circle cx="34.5" cy="36.5" r="2.6" fill="#F6B852" stroke="#14262D" stroke-width="1.2"/>
    <circle cx="24" cy="20.5" r="8.4" fill="#E6C6AA" stroke="#6B8099" stroke-width="1.3"/>
    <path d="M15 19.5c.4-6.4 5.2-9.2 10.6-8.4 4.2.6 7.4 3.4 7.6 8.4-2.8-2.6-13.8-2.8-18.2 0Z" fill="#243546"/>
    <path d="M15.5 18.8h17l-1.6 4.8h-13.8l-1.6-4.8Z" fill="rgba(122,229,130,0.25)" stroke="#7AE582" stroke-width="1.4"/>
    <path d="M19 21.2h4M25 21.2h4" stroke="#7AE582" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M18.5 27.5h11l-1.4 3.5h-8.2l-1.4-3.5Z" fill="#2A404B" stroke="#7AE582" stroke-width="1.2"/>
  </svg>`;
}
