/**
 * Unified 1.5px stroke industrial sci-fi inline SVG icon kit (Phase C).
 * Replaces platform-inconsistent emojis across HUD, Base Station dock, Map, Events, and Modals.
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
  | 'grid';

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
};

export function svgIcon(name: V2IconName, size = 15, extraClass = ''): string {
  const cls = extraClass ? `v2-ico ${extraClass}` : 'v2-ico';
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
}
