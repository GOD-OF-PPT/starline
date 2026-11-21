import {
  BUILDING_ORDER,
  BUILDINGS,
  RELICS,
  RELIC_ORDER,
  type BuildingId,
} from '../data/buildings';
import {
  CARGO_DEFINITIONS,
  EQUIPMENT_DEFINITIONS,
  LOADOUTS,
  type LoadoutId,
} from '../data/items';
import type { RegionId } from '../data/nodes';

export const SAVE_SCHEMA_VERSION = 1;
export const RULES_VERSION = 'v1.0.0';

export interface GameSettings {
  readonly combatSpeed: 1 | 2;
  readonly reducedMotion: boolean;
  readonly lowQuality: boolean;
  readonly sfxMuted: boolean;
  readonly bgmMuted: boolean;
}

export interface RelicProgress {
  readonly storedCount: number; // physically returned and kept, awaiting restoration
  readonly restored: boolean;
}

export interface BaseProgression {
  readonly credits: number;
  readonly buildings: Record<BuildingId, boolean>;
  readonly discoveredItems: readonly string[]; // defIds seen or obtained
  readonly relics: Record<string, RelicProgress>;
  readonly selectedLoadout: LoadoutId;
  readonly selectedRegion?: RegionId;
  readonly tutorialCompleted: boolean;
  readonly settledExpeditionIds: readonly string[];
  readonly totalExpeditions: number;
  readonly safeReturns: number;
  readonly deepestNodeReached: number;
  readonly totalCreditsEarned: number;
}

export const DEFAULT_SETTINGS: GameSettings = {
  combatSpeed: 1,
  reducedMotion: false,
  lowQuality: false,
  sfxMuted: false,
  bgmMuted: false,
};

export function createInitialRelics(): Record<string, RelicProgress> {
  const relics: Record<string, RelicProgress> = {};
  for (const id of RELIC_ORDER) {
    relics[id] = { storedCount: 0, restored: false };
  }
  return relics;
}

export function createInitialProgression(): BaseProgression {
  return {
    credits: 0,
    buildings: {
      workbench: false,
      display: false,
      drydock: false,
    },
    discoveredItems: ['equipment.laser.common'],
    relics: createInitialRelics(),
    selectedLoadout: 'cannon_skiff',
    selectedRegion: 'standard',
    tutorialCompleted: false,
    settledExpeditionIds: [],
    totalExpeditions: 0,
    safeReturns: 0,
    deepestNodeReached: 0,
    totalCreditsEarned: 0,
  };
}

export function isLoadoutUnlocked(progression: BaseProgression, loadoutId: LoadoutId): boolean {
  const def = LOADOUTS[loadoutId];
  if (!def.unlockBuildingId) return true;
  return Boolean(progression.buildings[def.unlockBuildingId as BuildingId]);
}

export function isRegionUnlocked(progression: BaseProgression, regionId: RegionId): boolean {
  if (regionId === 'standard') return true;
  return Boolean(progression.buildings.workbench || progression.deepestNodeReached >= 3);
}

export function canBuildFacility(
  progression: BaseProgression,
  buildingId: BuildingId
): { readonly canBuild: boolean; readonly reason?: string } {
  const def = BUILDINGS[buildingId];
  if (progression.buildings[buildingId]) {
    return { canBuild: false, reason: '已建成' };
  }
  if (def.prerequisite && !progression.buildings[def.prerequisite]) {
    return { canBuild: false, reason: `需先修复${BUILDINGS[def.prerequisite].name}` };
  }
  if (progression.credits < def.cost) {
    return { canBuild: false, reason: `还差 ${def.cost - progression.credits} 信用点` };
  }
  return { canBuild: true };
}

export function canRestoreRelic(
  progression: BaseProgression,
  relicId: string
): { readonly canRestore: boolean; readonly reason?: string } {
  const def = RELICS[relicId];
  if (!def) return { canRestore: false, reason: '未知藏品' };
  const status = progression.relics[relicId];
  if (!progression.buildings.display) {
    return { canRestore: false, reason: '需先建造收藏展台' };
  }
  if (status?.restored) {
    return { canRestore: false, reason: '已修复展示' };
  }
  if (!status || status.storedCount <= 0) {
    return { canRestore: false, reason: '尚未带回实物' };
  }
  if (progression.credits < def.restoreCost) {
    return { canRestore: false, reason: `还差 ${def.restoreCost - progression.credits} 信用点` };
  }
  return { canRestore: true };
}

export interface RelicCollectionSummary {
  readonly restoredCount: number;
  readonly storedTotal: number;
  readonly restorableIds: readonly string[];
  readonly totalCount: number;
}

export function getRelicCollectionSummary(progression: BaseProgression): RelicCollectionSummary {
  let restoredCount = 0;
  let storedTotal = 0;
  const restorableIds: string[] = [];
  for (const id of RELIC_ORDER) {
    const st = progression.relics[id];
    if (st?.restored) restoredCount += 1;
    if (st?.storedCount) storedTotal += st.storedCount;
    if (canRestoreRelic(progression, id).canRestore) {
      restorableIds.push(id);
    }
  }
  return {
    restoredCount,
    storedTotal,
    restorableIds,
    totalCount: RELIC_ORDER.length,
  };
}

export function mergeDiscoveries(
  existing: readonly string[],
  defIds: readonly string[]
): readonly string[] {
  const set = new Set(existing);
  for (const id of defIds) {
    set.add(id);
  }
  return Array.from(set);
}

export interface CodexSummary {
  readonly equipmentDiscovered: number;
  readonly equipmentTotal: number;
  readonly cargoDiscovered: number;
  readonly cargoTotal: number;
  readonly relicsRestored: number;
  readonly relicsTotal: number;
  readonly completionPercent: number;
}

export function getCodexSummary(progression: BaseProgression): CodexSummary {
  const eqKeys = Object.keys(EQUIPMENT_DEFINITIONS);
  const cargoKeys = Object.keys(CARGO_DEFINITIONS);
  const relicKeys = Object.keys(RELICS);
  const discoveredSet = new Set(progression.discoveredItems);

  const equipmentDiscovered = eqKeys.filter((k) => discoveredSet.has(k)).length;
  const cargoDiscovered = cargoKeys.filter((k) => discoveredSet.has(k)).length;
  const relicsRestored = relicKeys.filter((k) => progression.relics[k]?.restored).length;

  const total = eqKeys.length + cargoKeys.length + relicKeys.length;
  const done = equipmentDiscovered + cargoDiscovered + relicsRestored;

  return {
    equipmentDiscovered,
    equipmentTotal: eqKeys.length,
    cargoDiscovered,
    cargoTotal: cargoKeys.length,
    relicsRestored,
    relicsTotal: relicKeys.length,
    completionPercent: total > 0 ? Math.round((done / total) * 100) : 0,
  };
}

export function getVisibleBuildings(progression: BaseProgression): readonly BuildingId[] {
  if (!progression.buildings.workbench) {
    return ['workbench'];
  }
  return BUILDING_ORDER;
}
