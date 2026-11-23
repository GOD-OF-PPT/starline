import { DEFAULT_SETTINGS, type RelicProgress } from '../../domain/progression';
import { V2_CREW_ORDER, type V2CrewId } from '../data/crew';
import {
  V2_ALL_EQUIPMENT_KINDS,
  V2_INITIAL_BLUEPRINTS,
  V2_WAREHOUSE_CAPACITY,
  type V2ArchetypeId,
  type V2EquipmentKind,
  type V2UnlockFamilyId,
} from '../data/equipment';
import { V2_FACILITY_ORDER, V2_RELIC_ORDER, type V2FacilityId } from '../data/facilities';
import { V2_SHIP_ORDER, isCellValidForShip, type V2ShipId } from '../data/ships';
import { getV2OccupiedCells, type V2Rotation } from '../data/shapes';
import { getAnyV2ItemDef } from './itemCatalog';
import { MAX_UINT32 } from './seedParam';
import {
  V2_BACKUP_KEY,
  V2_LEGACY_RULES_VERSION,
  V2_LEGACY_SCHEMA_VERSION,
  V2_MAX_FUEL,
  V2_RULES_VERSION,
  V2_SAVE_KEY,
  V2_SCHEMA_VERSION,
  V3_BACKUP_KEY,
  type CampaignActId,
  type EndingId,
  type FactionId,
  type SectorId,
  type V2ActiveCombatState,
  type V2CargoBayState,
  type V2CombatRewardBundle,
  type V2CombatSimulation,
  type V2ContractInstance,
  type V2DiscardedRecord,
  type V2EngineerSwapOffer,
  type V2GameSettings,
  type V2ItemInstance,
  type V2LoadoutPreset,
  type V2MapNode,
  type V2NodeType,
  type V2PresetSlot,
  type V2ProfileState,
  type V2RunPhase,
  type V2RunState,
  type V2SaveData,
  type V2TacticalCommandId,
  type V2TargetPolicy,
  type V3CampaignState,
  type V3CareerStats,
  type V3RunHistoryEntry,
} from './types';

export interface V2StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type V2LoadResult =
  | { readonly status: 'fresh'; readonly data: V2SaveData }
  | { readonly status: 'loaded'; readonly data: V2SaveData; readonly migratedFromV2?: boolean }
  | { readonly status: 'corrupt_with_backup'; readonly backup: V2SaveData; readonly error: string }
  | { readonly status: 'corrupt_no_backup'; readonly data: V2SaveData; readonly error: string };

export interface V2ValidationResult {
  readonly ok: boolean;
  readonly error?: string;
}

export const V3_MAX_RUN_HISTORY = 30;

const VALID_PHASES: ReadonlySet<V2RunPhase> = new Set([
  'MAP',
  'ENCOUNTER',
  'REWARD',
  'SHOP',
  'ARRANGE',
  'SETTLEMENT',
]);
const VALID_ORIGINS = new Set(['loan', 'owned', 'loot', 'mission']);
const VALID_ARCHETYPES: ReadonlySet<V2ArchetypeId> = new Set([
  'laser',
  'heavy',
  'hangar',
  'counter',
]);
const VALID_SHIP_SET: ReadonlySet<V2ShipId> = new Set(V2_SHIP_ORDER);
const VALID_CREW_SET: ReadonlySet<V2CrewId> = new Set(V2_CREW_ORDER);
const VALID_UNLOCK_FAMILIES: ReadonlySet<V2UnlockFamilyId> = new Set([
  'core',
  'heavy_kit',
  'hangar_kit',
  'counter_kit',
]);
const VALID_COMPLETED_CONTRACT_TYPES: ReadonlySet<'transport' | 'rescue' | 'survey'> = new Set([
  'transport',
  'rescue',
  'survey',
]);
const VALID_ACTS: ReadonlySet<CampaignActId> = new Set([
  'prologue',
  'act1',
  'act2',
  'act3',
  'endless',
]);
const VALID_SECTORS: ReadonlySet<SectorId> = new Set([
  'near_orbit',
  'frozen_graveyard',
  'stargate_abyss',
]);
const ALL_FACTIONS: readonly FactionId[] = [
  'starport_guild',
  'deep_institute',
  'free_salvagers',
];
const VALID_ENDINGS: ReadonlySet<EndingId> = new Set([
  'stargate_reignited',
  'free_haven',
  'fleet_heir',
]);
const VALID_NODE_TYPES: ReadonlySet<V2NodeType> = new Set([
  'combat',
  'elite',
  'boss',
  'wreck',
  'merchant',
  'anomaly',
  'distress',
]);
const VALID_CONTRACT_STATUSES: ReadonlySet<V2ContractInstance['status']> = new Set([
  'active',
  'aborted',
  'completed',
  'failed',
]);
const VALID_TARGET_POLICIES: ReadonlySet<V2TargetPolicy> = new Set([
  'weakest',
  'highest_threat',
]);
const VALID_TACTICAL_COMMANDS: ReadonlySet<V2TacticalCommandId> = new Set([
  'normal',
  'overload',
  'emergency_shield',
  'emergency_defense',
  'focus_calibrate',
  'signature_cannon_skiff',
  'signature_shield_cruiser',
  'signature_heavy_freighter',
  'signature_stargate_cruiser',
]);
const V3_CAREER_KEYS: readonly (keyof V3CareerStats)[] = [
  'totalWins',
  'totalDefeats',
  'totalSafeReturns',
  'totalCreditsEarned',
  'totalSalvagePartsEarned',
  'totalBossesDefeated',
  'totalWrecksDissected',
  'totalItemsDismantled',
  'deepestEndlessCleared',
];

function hasOwn(obj: object, key: string | number): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isSafeMapKey(key: string): boolean {
  return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isFiniteInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v);
}

function isNonNegInt(v: unknown): v is number {
  return isFiniteInt(v) && v >= 0;
}

function isValidRotation(v: unknown): v is V2Rotation {
  return v === 0 || v === 1 || v === 2 || v === 3;
}

function isDenseArrayOf<T>(
  value: unknown,
  predicate: (entry: unknown, index: number) => boolean
): value is T[] {
  if (!Array.isArray(value)) return false;
  for (let i = 0; i < value.length; i += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, i)) return false;
    if (!predicate(value[i], i)) return false;
  }
  return true;
}

function sanitizeNonNegInt(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
}

function isValidPresetSlot(raw: unknown): raw is V2PresetSlot {
  if (!isPlainObject(raw)) return false;
  if (typeof raw.definitionId !== 'string') return false;
  const def = getAnyV2ItemDef(raw.definitionId);
  if (!def || def.category !== 'equipment') return false;
  if (raw.quality !== def.quality) return false;
  if (raw.preferOrigin !== 'owned' && raw.preferOrigin !== 'loan') return false;
  if (!isFiniteInt(raw.x) || !isFiniteInt(raw.y)) return false;
  if (!isValidRotation(raw.rotation)) return false;
  return true;
}

function isValidLoadoutPreset(raw: unknown): raw is V2LoadoutPreset {
  if (!isPlainObject(raw)) return false;
  if (typeof raw.presetId !== 'string' || raw.presetId.length === 0) return false;
  if (typeof raw.name !== 'string') return false;
  if (typeof raw.shipId !== 'string' || !VALID_SHIP_SET.has(raw.shipId as V2ShipId)) return false;
  if (
    raw.crewId !== null &&
    (typeof raw.crewId !== 'string' || !VALID_CREW_SET.has(raw.crewId as V2CrewId))
  ) {
    return false;
  }
  if (
    typeof raw.primaryArchetype !== 'string' ||
    !VALID_ARCHETYPES.has(raw.primaryArchetype as V2ArchetypeId)
  ) {
    return false;
  }
  if (raw.updatedAt !== undefined && typeof raw.updatedAt !== 'string') return false;
  if (!isDenseArrayOf(raw.slots, isValidPresetSlot)) return false;
  return true;
}

function sanitizeLoadoutPresets(raw: unknown): V2LoadoutPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: V2LoadoutPreset[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    if (!hasOwn(raw, i)) continue;
    const pr = raw[i];
    if (!isPlainObject(pr)) continue;
    if (typeof pr.presetId !== 'string' || pr.presetId.length === 0) continue;
    if (typeof pr.name !== 'string') continue;
    if (typeof pr.shipId !== 'string' || !VALID_SHIP_SET.has(pr.shipId as V2ShipId)) continue;
    if (
      pr.crewId !== null &&
      (typeof pr.crewId !== 'string' || !VALID_CREW_SET.has(pr.crewId as V2CrewId))
    ) {
      continue;
    }
    if (
      typeof pr.primaryArchetype !== 'string' ||
      !VALID_ARCHETYPES.has(pr.primaryArchetype as V2ArchetypeId)
    ) {
      continue;
    }
    if (!Array.isArray(pr.slots)) continue;
    const cleanSlots: V2PresetSlot[] = [];
    for (let j = 0; j < pr.slots.length; j += 1) {
      if (!hasOwn(pr.slots, j)) continue;
      const sl = pr.slots[j];
      if (isValidPresetSlot(sl)) {
        cleanSlots.push({
          definitionId: sl.definitionId,
          quality: sl.quality,
          preferOrigin: sl.preferOrigin,
          x: sl.x,
          y: sl.y,
          rotation: sl.rotation,
        });
      }
    }
    out.push({
      presetId: pr.presetId,
      name: pr.name,
      shipId: pr.shipId as V2ShipId,
      crewId: pr.crewId as V2CrewId | null,
      primaryArchetype: pr.primaryArchetype as V2ArchetypeId,
      slots: cleanSlots,
      updatedAt: typeof pr.updatedAt === 'string' ? pr.updatedAt : new Date().toISOString(),
    });
  }
  return out;
}

function isValidRunHistoryEntry(raw: unknown): raw is V3RunHistoryEntry {
  if (!isPlainObject(raw)) return false;
  if (typeof raw.runId !== 'string' || raw.runId.length === 0) return false;
  if (typeof raw.finishedAt !== 'string') return false;
  if (typeof raw.sectorId !== 'string' || !VALID_SECTORS.has(raw.sectorId as SectorId)) return false;
  if (typeof raw.contractTemplateId !== 'string' || typeof raw.contractName !== 'string') return false;
  if (typeof raw.shipId !== 'string' || !VALID_SHIP_SET.has(raw.shipId as V2ShipId)) return false;
  if (
    raw.crewId !== null &&
    (typeof raw.crewId !== 'string' || !VALID_CREW_SET.has(raw.crewId as V2CrewId))
  ) {
    return false;
  }
  if (raw.outcome !== 'safe_return' && raw.outcome !== 'defeat') return false;
  if (typeof raw.contractCompleted !== 'boolean') return false;
  if (!isNonNegInt(raw.maxLayerReached)) return false;
  if (!isNonNegInt(raw.creditsEarned)) return false;
  if (!isNonNegInt(raw.salvagePartsEarned)) return false;
  if (!isFiniteInt(raw.endlessThreat) || raw.endlessThreat < 0 || raw.endlessThreat > 10) return false;
  if (raw.isFinalCampaignRun !== undefined && typeof raw.isFinalCampaignRun !== 'boolean') {
    return false;
  }
  return true;
}

function sanitizeSettings(raw: unknown): V2GameSettings {
  if (!isPlainObject(raw)) {
    return { ...DEFAULT_SETTINGS };
  }
  const combatSpeed: 1 | 2 = raw.combatSpeed === 2 ? 2 : 1;
  const reducedMotion =
    typeof raw.reducedMotion === 'boolean' ? raw.reducedMotion : DEFAULT_SETTINGS.reducedMotion;
  const lowQuality =
    typeof raw.lowQuality === 'boolean' ? raw.lowQuality : DEFAULT_SETTINGS.lowQuality;
  const sfxMuted =
    typeof raw.sfxMuted === 'boolean' ? raw.sfxMuted : DEFAULT_SETTINGS.sfxMuted;
  const bgmMuted =
    typeof raw.bgmMuted === 'boolean' ? raw.bgmMuted : DEFAULT_SETTINGS.bgmMuted;

  return {
    combatSpeed,
    reducedMotion,
    lowQuality,
    sfxMuted,
    bgmMuted,
    ...(typeof raw.eliteTacticExperiment === 'boolean'
      ? { eliteTacticExperiment: raw.eliteTacticExperiment }
      : {}),
    ...(typeof raw.pureAutoCombat === 'boolean'
      ? { pureAutoCombat: raw.pureAutoCombat }
      : {}),
  };
}

export function createInitialV2Relics(): Record<string, RelicProgress> {
  const relics: Record<string, RelicProgress> = {};
  for (const rid of V2_RELIC_ORDER) {
    relics[rid] = { storedCount: 0, restored: false };
  }
  return relics;
}

export function createInitialV3FacilityTiers(
  buildings: Partial<Record<V2FacilityId, boolean>>
): Record<string, number> {
  const tiers: Record<string, number> = {};
  for (const f of V2_FACILITY_ORDER) {
    tiers[f] = buildings[f] ? 1 : 0;
  }
  tiers.drydock = buildings.drydock_tier2 ? 2 : buildings.drydock ? 1 : 0;
  tiers.stargate_relay = 0;
  return tiers;
}

export function createInitialV3FactionRep(): Record<FactionId, number> {
  return {
    starport_guild: 0,
    deep_institute: 0,
    free_salvagers: 0,
  };
}

export function createInitialV3CrewMastery(): Record<V2CrewId, number> {
  return {
    engineer: 0,
    navigator: 0,
    salvager: 0,
  };
}

export function createInitialV3CareerStats(): V3CareerStats {
  return {
    totalWins: 0,
    totalDefeats: 0,
    totalSafeReturns: 0,
    totalCreditsEarned: 0,
    totalSalvagePartsEarned: 0,
    totalBossesDefeated: 0,
    totalWrecksDissected: 0,
    totalItemsDismantled: 0,
    deepestEndlessCleared: 0,
  };
}

export function createInitialV3CampaignState(): V3CampaignState {
  return {
    currentAct: 'prologue',
    unlockedSectors: ['near_orbit'],
    completedMilestones: [],
    defeatedBossIds: [],
    readCommsIds: [],
    relicPityCounters: {},
    endingsUnlocked: [],
    finalMissionUnlocked: false,
    endlessUnlocked: false,
    maxEndlessThreat: 0,
  };
}

export function inferV3CampaignFromV2Profile(
  p: Pick<
    V2ProfileState,
    | 'tutorialCompleted'
    | 'totalRuns'
    | 'buildings'
    | 'completedContractTypes'
    | 'deepestLayerReached'
    | 'relics'
  >
): V3CampaignState {
  const restoredRelics = isPlainObject(p.relics)
    ? Object.values(p.relics).filter((r) => isPlainObject(r) && Boolean(r.restored)).length
    : 0;
  const stdTypes = Array.isArray(p.completedContractTypes) ? p.completedContractTypes.length : 0;
  const totalRuns = sanitizeNonNegInt(p.totalRuns);
  const deepestLayerReached = sanitizeNonNegInt(p.deepestLayerReached);
  const buildings: Record<string, unknown> = isPlainObject(p.buildings) ? p.buildings : {};
  const hasWorkbench = hasOwn(buildings, 'workbench') && Boolean(buildings.workbench);
  const hasDrydockTier2 = hasOwn(buildings, 'drydock_tier2') && Boolean(buildings.drydock_tier2);
  const hasResearchLab = hasOwn(buildings, 'research_lab') && Boolean(buildings.research_lab);

  if (!p.tutorialCompleted && totalRuns === 0 && !hasWorkbench) {
    return createInitialV3CampaignState();
  }

  if (
    stdTypes >= 3 &&
    (hasDrydockTier2 || restoredRelics >= 2 || deepestLayerReached >= 6)
  ) {
    return {
      ...createInitialV3CampaignState(),
      currentAct: 'act3',
      unlockedSectors: ['near_orbit', 'frozen_graveyard', 'stargate_abyss'],
      completedMilestones: ['prologue_complete', 'act1_complete', 'act2_complete'],
    };
  }

  if (
    stdTypes >= 2 ||
    (hasResearchLab && deepestLayerReached >= 4) ||
    restoredRelics >= 1
  ) {
    return {
      ...createInitialV3CampaignState(),
      currentAct: 'act2',
      unlockedSectors: ['near_orbit', 'frozen_graveyard'],
      completedMilestones: ['prologue_complete', 'act1_complete'],
    };
  }

  return {
    ...createInitialV3CampaignState(),
    currentAct: 'act1',
    unlockedSectors: ['near_orbit'],
    completedMilestones: ['prologue_complete'],
  };
}

export function inferV3CareerFromV2Profile(
  p: Pick<V2ProfileState, 'totalRuns' | 'completedContractIds' | 'credits'>
): V3CareerStats {
  const totalRuns = sanitizeNonNegInt(p.totalRuns);
  const completedCount = Array.isArray(p.completedContractIds) ? p.completedContractIds.length : 0;
  const wins = Math.min(totalRuns, completedCount);
  return {
    ...createInitialV3CareerStats(),
    totalWins: wins,
    totalSafeReturns: wins,
    totalCreditsEarned: sanitizeNonNegInt(p.credits),
  };
}

export function createFreshV2Profile(): V2ProfileState {
  const buildings = {} as Record<V2FacilityId, boolean>;
  for (const f of V2_FACILITY_ORDER) {
    buildings[f] = false;
  }
  return {
    credits: 0,
    buildings,
    unlockedShips: ['cannon_skiff'],
    unlockedCrew: ['engineer'],
    unlockedFamilies: ['core'],
    blueprints: [...V2_INITIAL_BLUEPRINTS],
    equipmentWarehouse: [],
    pendingGiftQueue: [],
    relics: createInitialV2Relics(),
    discoveredItems: [],
    seenItems: [],
    loadoutPresets: [],
    completedContractTypes: [],
    completedContractIds: [],
    deepestLayerReached: 0,
    totalRuns: 0,
    tutorialCompleted: false,
    tutorialBonusClaimed: false,
    settledRunIds: [],
    selectedShipId: 'cannon_skiff',
    selectedCrewId: 'engineer',
    selectedArchetype: 'laser',
    migrationRecord: null,
    // V3 fields
    salvageParts: 0,
    facilityTiers: createInitialV3FacilityTiers(buildings),
    campaign: createInitialV3CampaignState(),
    factionRep: createInitialV3FactionRep(),
    crewMastery: createInitialV3CrewMastery(),
    achievementsUnlocked: [],
    defeatedEnemyKinds: [],
    runHistory: [],
    career: createInitialV3CareerStats(),
  };
}

export function createFreshV2SaveData(): V2SaveData {
  return {
    schemaVersion: V2_SCHEMA_VERSION,
    rulesVersion: V2_RULES_VERSION,
    savedAt: new Date().toISOString(),
    profile: createFreshV2Profile(),
    activeRun: null,
    settings: { ...DEFAULT_SETTINGS },
  };
}

function validateV2Item(raw: unknown, label: string): V2ValidationResult {
  if (!isPlainObject(raw)) return { ok: false, error: `${label} 不是对象` };
  const item = raw as Partial<V2ItemInstance>;
  if (typeof item.instanceId !== 'string' || item.instanceId.length === 0) {
    return { ok: false, error: `${label}.instanceId 无效` };
  }
  if (typeof item.definitionId !== 'string') {
    return { ok: false, error: `${label}.definitionId 未知: ${String(item.definitionId)}` };
  }
  const def = getAnyV2ItemDef(item.definitionId);
  if (!def) {
    return { ok: false, error: `${label}.definitionId 未知: ${String(item.definitionId)}` };
  }
  if (item.category !== def.category) {
    return { ok: false, error: `${label}.category 与物品定义不匹配` };
  }
  if (item.quality !== def.quality) {
    return { ok: false, error: `${label}.quality 与物品定义不匹配` };
  }
  if (typeof item.origin !== 'string' || !VALID_ORIGINS.has(item.origin)) {
    return { ok: false, error: `${label}.origin 非法` };
  }
  if (def.category === 'mission' && item.origin !== 'mission') {
    return { ok: false, error: `${label} 任务物来源必须为 mission` };
  }
  if (def.category !== 'mission' && item.origin === 'mission') {
    return { ok: false, error: `${label} 非任务物不可标记为 mission` };
  }
  if (!isFiniteInt(item.fixedValue) || item.fixedValue < 0) {
    return { ok: false, error: `${label}.fixedValue 非法` };
  }
  if ((item.origin === 'loan' || item.origin === 'mission') && item.fixedValue !== 0) {
    return { ok: false, error: `${label} 借用/任务物标价必须为 0` };
  }
  if (!isFiniteInt(item.acquiredDepth) || item.acquiredDepth < 0) {
    return { ok: false, error: `${label}.acquiredDepth 非法` };
  }
  return { ok: true };
}

function validateV2Bay(raw: unknown, expectedShipId: V2ShipId): V2ValidationResult {
  if (!isPlainObject(raw)) return { ok: false, error: 'activeRun.bay 缺失' };
  const bay = raw as Partial<V2CargoBayState>;
  if (bay.shipId !== expectedShipId) {
    return { ok: false, error: 'bay.shipId 与 run.shipId 不一致' };
  }
  if (
    !Array.isArray(bay.placed) ||
    !Array.isArray(bay.staging) ||
    !Array.isArray(bay.discardedThisArrange)
  ) {
    return { ok: false, error: 'bay 数组字段损坏' };
  }

  const seenIds = new Set<string>();
  const occupied = new Set<string>();

  for (let i = 0; i < bay.placed.length; i += 1) {
    if (!hasOwn(bay.placed, i)) {
      return { ok: false, error: `bay.placed[${i}] 存在稀疏空洞` };
    }
    const p = bay.placed[i];
    if (!isPlainObject(p)) {
      return { ok: false, error: `bay.placed[${i}] 无效` };
    }
    const itemCheck = validateV2Item(p.item, `bay.placed[${i}].item`);
    if (!itemCheck.ok) return itemCheck;
    const item = p.item as V2ItemInstance;
    if (seenIds.has(item.instanceId)) {
      return { ok: false, error: `重复的物品实例 ID: ${item.instanceId}` };
    }
    seenIds.add(item.instanceId);

    if (!isFiniteInt(p.x) || !isFiniteInt(p.y) || !isValidRotation(p.rotation)) {
      return { ok: false, error: `bay.placed[${i}] 坐标或旋转非法` };
    }
    const def = getAnyV2ItemDef(item.definitionId);
    if (!def) {
      return { ok: false, error: `bay.placed[${i}].item.definitionId 未知` };
    }
    const cells = getV2OccupiedCells(def.shapeId, p.x, p.y, p.rotation);
    for (const c of cells) {
      if (!isCellValidForShip(expectedShipId, c.x, c.y)) {
        return { ok: false, error: `bay.placed[${i}] 越界或落入禁用格 (${c.x},${c.y})` };
      }
      const key = `${c.x},${c.y}`;
      if (occupied.has(key)) {
        return { ok: false, error: `bay.placed 存在格子重叠 (${key})` };
      }
      occupied.add(key);
    }
  }

  for (let i = 0; i < bay.staging.length; i += 1) {
    if (!hasOwn(bay.staging, i)) {
      return { ok: false, error: `bay.staging[${i}] 存在稀疏空洞` };
    }
    const s = bay.staging[i];
    if (!isPlainObject(s)) {
      return { ok: false, error: `bay.staging[${i}] 无效` };
    }
    const itemCheck = validateV2Item(s.item, `bay.staging[${i}].item`);
    if (!itemCheck.ok) return itemCheck;
    const item = s.item as V2ItemInstance;
    if (seenIds.has(item.instanceId)) {
      return { ok: false, error: `重复的暂存实例 ID: ${item.instanceId}` };
    }
    seenIds.add(item.instanceId);
    if (!isValidRotation(s.rotation)) {
      return { ok: false, error: `bay.staging[${i}].rotation 非法` };
    }
  }

  for (let i = 0; i < bay.discardedThisArrange.length; i += 1) {
    if (!hasOwn(bay.discardedThisArrange, i)) {
      return { ok: false, error: `bay.discardedThisArrange[${i}] 存在稀疏空洞` };
    }
    const rec = bay.discardedThisArrange[i] as Partial<V2DiscardedRecord> | undefined;
    if (!isPlainObject(rec)) {
      return { ok: false, error: `bay.discardedThisArrange[${i}] 无效` };
    }
    const itemCheck = validateV2Item(rec.item, `bay.discardedThisArrange[${i}].item`);
    if (!itemCheck.ok) return itemCheck;
    const item = rec.item as V2ItemInstance;
    if (seenIds.has(item.instanceId)) {
      return { ok: false, error: `重复的舍弃实例 ID: ${item.instanceId}` };
    }
    seenIds.add(item.instanceId);
    const prev = rec.previousLocation;
    if (!isPlainObject(prev)) {
      return { ok: false, error: `bay.discardedThisArrange[${i}].previousLocation 无效` };
    }
    if (prev.zone === 'grid') {
      if (!isFiniteInt(prev.x) || !isFiniteInt(prev.y) || !isValidRotation(prev.rotation)) {
        return {
          ok: false,
          error: `bay.discardedThisArrange[${i}].previousLocation 网格坐标或旋转非法`,
        };
      }
    } else if (prev.zone === 'staging') {
      if (!isValidRotation(prev.rotation)) {
        return {
          ok: false,
          error: `bay.discardedThisArrange[${i}].previousLocation 暂存旋转非法`,
        };
      }
    } else {
      return { ok: false, error: `bay.discardedThisArrange[${i}].previousLocation.zone 非法` };
    }
  }

  return { ok: true };
}

function validateV2RunCore(
  raw: unknown,
  expectedSchema: number,
  expectedRules: string,
  requireV3Fields: boolean
): V2ValidationResult {
  if (!isPlainObject(raw)) return { ok: false, error: 'activeRun 不是对象' };
  const run = raw as Partial<V2RunState>;
  if (typeof run.runId !== 'string' || run.runId.length === 0) {
    return { ok: false, error: 'activeRun.runId 缺失' };
  }
  if (run.schemaVersion !== expectedSchema || run.rulesVersion !== expectedRules) {
    return { ok: false, error: 'activeRun 版本号不匹配' };
  }
  if (!isNonNegInt(run.seed) || run.seed > MAX_UINT32) {
    return { ok: false, error: 'activeRun.seed 非法或超出 uint32 范围' };
  }
  if (typeof run.shipId !== 'string' || !VALID_SHIP_SET.has(run.shipId as V2ShipId)) {
    return { ok: false, error: 'activeRun.shipId 非法' };
  }
  const shipId = run.shipId as V2ShipId;
  if (
    run.crewId !== null &&
    (typeof run.crewId !== 'string' || !VALID_CREW_SET.has(run.crewId as V2CrewId))
  ) {
    return { ok: false, error: 'activeRun.crewId 非法' };
  }
  if (
    typeof run.primaryArchetype !== 'string' ||
    !VALID_ARCHETYPES.has(run.primaryArchetype as V2ArchetypeId)
  ) {
    return { ok: false, error: 'activeRun.primaryArchetype 非法' };
  }
  if (typeof run.phase !== 'string' || !VALID_PHASES.has(run.phase as V2RunPhase)) {
    return { ok: false, error: `activeRun.phase 非法: ${String(run.phase)}` };
  }
  if (
    !isFiniteInt(run.fuel) ||
    run.fuel < 0 ||
    !isFiniteInt(run.maxFuel) ||
    run.fuel > run.maxFuel ||
    run.maxFuel > V2_MAX_FUEL
  ) {
    return { ok: false, error: 'activeRun.fuel 越界或为负' };
  }
  if (
    !isFiniteInt(run.hp) ||
    run.hp < 0 ||
    !isFiniteInt(run.maxHp) ||
    run.maxHp <= 0 ||
    run.hp > run.maxHp
  ) {
    return { ok: false, error: 'activeRun.hp 越界' };
  }
  if (!isFiniteInt(run.wallet) || run.wallet < 0) {
    return { ok: false, error: 'activeRun.wallet 为负或非法' };
  }
  if (!isPlainObject(run.graph) || !isPlainObject(run.graph.nodes)) {
    return { ok: false, error: 'activeRun.graph 损坏' };
  }
  const graphNodes = run.graph.nodes as Record<string, unknown>;
  if (!isFiniteInt(run.graph.maxLayers) || run.graph.maxLayers < 1) {
    return { ok: false, error: 'activeRun.graph.maxLayers 非法' };
  }
  if (
    !isDenseArrayOf(
      run.graph.startNextNodeIds,
      (nid) => isString(nid) && hasOwn(graphNodes, nid) && isPlainObject(graphNodes[nid])
    ) ||
    run.graph.startNextNodeIds.length === 0
  ) {
    return { ok: false, error: 'activeRun.graph.startNextNodeIds 损坏' };
  }
  if (
    run.graph.guaranteedPathNodeIds !== undefined &&
    !isDenseArrayOf(run.graph.guaranteedPathNodeIds, isString)
  ) {
    return { ok: false, error: 'activeRun.graph.guaranteedPathNodeIds 损坏' };
  }
  for (const [nodeKey, rawNode] of Object.entries(graphNodes)) {
    if (!isSafeMapKey(nodeKey)) {
      return { ok: false, error: `activeRun.graph.nodes 包含非法键名: ${nodeKey}` };
    }
    if (!isPlainObject(rawNode)) {
      return { ok: false, error: `activeRun.graph.nodes.${nodeKey} 不是对象` };
    }
    const n = rawNode as Partial<V2MapNode>;
    if (typeof n.nodeId !== 'string' || n.nodeId.length === 0 || n.nodeId !== nodeKey) {
      return { ok: false, error: `activeRun.graph.nodes.${nodeKey}.nodeId 非法` };
    }
    if (typeof n.type !== 'string' || !VALID_NODE_TYPES.has(n.type as V2NodeType)) {
      return { ok: false, error: `activeRun.graph.nodes.${nodeKey}.type 非法` };
    }
    if (!isFiniteInt(n.layer) || n.layer < 1) {
      return { ok: false, error: `activeRun.graph.nodes.${nodeKey}.layer 非法` };
    }
    if (
      !isDenseArrayOf(
        n.nextNodeIds,
        (nid) => isString(nid) && hasOwn(graphNodes, nid) && isPlainObject(graphNodes[nid])
      )
    ) {
      return { ok: false, error: `activeRun.graph.nodes.${nodeKey}.nextNodeIds 损坏` };
    }
    if (n.bossId !== undefined && typeof n.bossId !== 'string') {
      return { ok: false, error: `activeRun.graph.nodes.${nodeKey}.bossId 非法` };
    }
    if (n.hasRelicSignal !== undefined && typeof n.hasRelicSignal !== 'boolean') {
      return { ok: false, error: `activeRun.graph.nodes.${nodeKey}.hasRelicSignal 非法` };
    }
    if (n.relicSignalDefId !== undefined && typeof n.relicSignalDefId !== 'string') {
      return { ok: false, error: `activeRun.graph.nodes.${nodeKey}.relicSignalDefId 非法` };
    }
    if (n.eventId !== undefined && typeof n.eventId !== 'string') {
      return { ok: false, error: `activeRun.graph.nodes.${nodeKey}.eventId 非法` };
    }
  }
  if (run.currentNodeId !== null && typeof run.currentNodeId !== 'string') {
    return { ok: false, error: 'activeRun.currentNodeId 类型非法' };
  }
  if (
    typeof run.currentNodeId === 'string' &&
    (!hasOwn(graphNodes, run.currentNodeId) || !isPlainObject(graphNodes[run.currentNodeId]))
  ) {
    return {
      ok: false,
      error: `activeRun.currentNodeId (${String(run.currentNodeId)}) 不在航图中`,
    };
  }
  if (
    (run.phase === 'ENCOUNTER' || run.phase === 'SHOP' || run.phase === 'REWARD') &&
    run.currentNodeId === null
  ) {
    return { ok: false, error: `${run.phase} 阶段缺少合法 currentNodeId` };
  }
  if (!isPlainObject(run.contract)) {
    return { ok: false, error: 'activeRun.contract 损坏' };
  }
  const contract = run.contract as Partial<V2ContractInstance>;
  if (typeof contract.contractId !== 'string' || contract.contractId.length === 0) {
    return { ok: false, error: 'activeRun.contract.contractId 损坏' };
  }
  if (
    !isDenseArrayOf(contract.markedNodeIds, isString) ||
    !isDenseArrayOf(contract.completedNodeIds, isString)
  ) {
    return { ok: false, error: 'activeRun.contract 节点数组损坏' };
  }
  if (!isNonNegInt(contract.rewardCredits) || !isNonNegInt(contract.requiredCompletions)) {
    return { ok: false, error: 'activeRun.contract 数值字段非法' };
  }
  if (
    typeof contract.status !== 'string' ||
    !VALID_CONTRACT_STATUSES.has(contract.status as V2ContractInstance['status'])
  ) {
    return { ok: false, error: `activeRun.contract.status 非法: ${String(contract.status)}` };
  }
  if (!isPlainObject(run.rngStreams)) {
    return { ok: false, error: 'activeRun.rngStreams 缺失' };
  }
  for (const key of ['map', 'enemies', 'shop', 'events', 'rewards'] as const) {
    if (!hasOwn(run.rngStreams, key)) {
      return { ok: false, error: `activeRun.rngStreams.${key} 缺失` };
    }
    const cur = run.rngStreams[key];
    if (!isPlainObject(cur) || !isFiniteInt(cur.seed) || !isNonNegInt(cur.draws)) {
      return { ok: false, error: `activeRun.rngStreams.${key} 游标非法` };
    }
  }
  if (
    !isDenseArrayOf(run.visitedNodeIds, isString) ||
    !isDenseArrayOf(run.claimedEventIds, isString) ||
    !isDenseArrayOf(run.transactionIds, isString)
  ) {
    return { ok: false, error: 'activeRun 幂等追踪数组损坏' };
  }
  if (run.phase === 'REWARD' && run.pendingReward === null) {
    return { ok: false, error: 'REWARD 阶段缺少 pendingReward' };
  }
  if (run.pendingReward !== null) {
    if (!isPlainObject(run.pendingReward)) {
      return { ok: false, error: 'activeRun.pendingReward 数据损坏' };
    }
    const pr = run.pendingReward as Partial<V2CombatRewardBundle>;
    if (typeof pr.nodeId !== 'string' || pr.nodeId.length === 0) {
      return { ok: false, error: 'activeRun.pendingReward.nodeId 无效' };
    }
    const eqChk = validateV2Item(pr.equipmentOption, 'activeRun.pendingReward.equipmentOption');
    if (!eqChk.ok) return eqChk;
    const cgChk = validateV2Item(pr.cargoOption, 'activeRun.pendingReward.cargoOption');
    if (!cgChk.ok) return cgChk;
    if (!isNonNegInt(pr.repairAmount)) {
      return { ok: false, error: 'activeRun.pendingReward.repairAmount 非法' };
    }
    if (
      pr.chosen !== null &&
      pr.chosen !== 'equipment' &&
      pr.chosen !== 'cargo' &&
      pr.chosen !== 'repair'
    ) {
      return { ok: false, error: 'activeRun.pendingReward.chosen 非法' };
    }
  }
  if (
    run.phase === 'SETTLEMENT' &&
    run.settlementReason !== 'safe_return' &&
    run.settlementReason !== 'defeat'
  ) {
    return { ok: false, error: 'SETTLEMENT 阶段缺少合法 settlementReason' };
  }
  if (run.activeCombat !== null) {
    if (!isPlainObject(run.activeCombat)) {
      return { ok: false, error: 'activeRun.activeCombat 损坏' };
    }
    const ac = run.activeCombat as Partial<V2ActiveCombatState>;
    if (
      typeof ac.nodeId !== 'string' ||
      ac.nodeId.length === 0 ||
      !hasOwn(graphNodes, ac.nodeId) ||
      !isPlainObject(graphNodes[ac.nodeId])
    ) {
      return { ok: false, error: 'activeRun.activeCombat.nodeId 无效' };
    }
    if (!isNonNegInt(ac.startingHp)) {
      return { ok: false, error: 'activeRun.activeCombat.startingHp 非法' };
    }
    if (
      typeof ac.targetPolicy !== 'string' ||
      !VALID_TARGET_POLICIES.has(ac.targetPolicy as V2TargetPolicy)
    ) {
      return { ok: false, error: 'activeRun.activeCombat.targetPolicy 非法' };
    }
    const sim = ac.simulation as Partial<V2CombatSimulation> | undefined;
    if (
      !isPlainObject(sim) ||
      typeof sim.resultId !== 'string' ||
      sim.resultId.length === 0 ||
      (sim.outcome !== 'victory' && sim.outcome !== 'defeat') ||
      !isNonNegInt(sim.roundsCount) ||
      !isNonNegInt(sim.finalPlayerHp) ||
      !isNonNegInt(sim.finalPlayerHpAfterRepair) ||
      !isDenseArrayOf(sim.rounds, isPlainObject) ||
      !isDenseArrayOf(sim.initialEnemies, isPlainObject)
    ) {
      return { ok: false, error: 'activeRun.activeCombat.simulation 数据损坏' };
    }
    if (
      sim.appliedCommands !== undefined &&
      !isDenseArrayOf(
        sim.appliedCommands,
        (c) =>
          isPlainObject(c) &&
          isFiniteInt(c.roundNumber) &&
          c.roundNumber >= 1 &&
          typeof c.choice === 'string' &&
          VALID_TACTICAL_COMMANDS.has(c.choice as V2TacticalCommandId)
      )
    ) {
      return { ok: false, error: 'activeRun.activeCombat.simulation.appliedCommands 非法' };
    }
    if (ac.pendingDecision !== undefined && ac.pendingDecision !== null) {
      const pd = ac.pendingDecision;
      if (
        !isPlainObject(pd) ||
        typeof pd.decisionId !== 'string' ||
        pd.decisionId.length === 0 ||
        (pd.roundNumber !== undefined && (!isFiniteInt(pd.roundNumber) || pd.roundNumber < 1)) ||
        (pd.chosen !== null &&
          (typeof pd.chosen !== 'string' ||
            !VALID_TACTICAL_COMMANDS.has(pd.chosen as V2TacticalCommandId))) ||
        !isDenseArrayOf(
          pd.options,
          (o) =>
            isPlainObject(o) &&
            typeof o.choice === 'string' &&
            VALID_TACTICAL_COMMANDS.has(o.choice as V2TacticalCommandId) &&
            typeof o.enabled === 'boolean'
        )
      ) {
        return { ok: false, error: 'activeCombat.pendingDecision 数据损坏' };
      }
    }
    if (
      ac.committedCommands !== undefined &&
      !isDenseArrayOf(
        ac.committedCommands,
        (c) =>
          isPlainObject(c) &&
          typeof c.decisionId === 'string' &&
          c.decisionId.length > 0 &&
          isFiniteInt(c.roundNumber) &&
          c.roundNumber >= 1 &&
          typeof c.choice === 'string' &&
          VALID_TACTICAL_COMMANDS.has(c.choice as V2TacticalCommandId)
      )
    ) {
      return { ok: false, error: 'activeCombat.committedCommands 数据损坏' };
    }
    if (ac.resumeFromRound !== undefined && !isNonNegInt(ac.resumeFromRound)) {
      return { ok: false, error: 'activeCombat.resumeFromRound 非法' };
    }
    if (
      ac.pausedAtDecisionId !== undefined &&
      ac.pausedAtDecisionId !== null &&
      typeof ac.pausedAtDecisionId !== 'string'
    ) {
      return { ok: false, error: 'activeCombat.pausedAtDecisionId 非法' };
    }
  }
  if (run.activeEngineerOffer !== null && run.activeEngineerOffer !== undefined) {
    const offer = run.activeEngineerOffer as Partial<V2EngineerSwapOffer>;
    if (
      !isPlainObject(offer) ||
      typeof offer.targetInstanceId !== 'string' ||
      offer.targetInstanceId.length === 0 ||
      !isDenseArrayOf(
        offer.candidates,
        (c) => isString(c) && V2_ALL_EQUIPMENT_KINDS.includes(c as V2EquipmentKind)
      ) ||
      typeof offer.used !== 'boolean'
    ) {
      return { ok: false, error: 'activeRun.activeEngineerOffer 数据损坏' };
    }
  }

  if (
    requireV3Fields ||
    run.tacticalChargesMax !== undefined ||
    run.tacticalChargesUsed !== undefined
  ) {
    if (
      !isNonNegInt(run.tacticalChargesMax) ||
      !isNonNegInt(run.tacticalChargesUsed) ||
      run.tacticalChargesUsed > run.tacticalChargesMax
    ) {
      return { ok: false, error: 'activeRun 战术充能字段非法' };
    }
  }

  if (requireV3Fields) {
    if (typeof run.sectorId !== 'string' || !VALID_SECTORS.has(run.sectorId as SectorId)) {
      return { ok: false, error: `activeRun.sectorId 非法: ${String(run.sectorId)}` };
    }
    if (
      !isDenseArrayOf(run.recentEquipmentKinds, isString) ||
      !isDenseArrayOf(run.usedEventIds, isString)
    ) {
      return { ok: false, error: 'activeRun V3 数组字段损坏' };
    }
    if (
      run.endlessMutatorIds !== undefined &&
      !isDenseArrayOf(run.endlessMutatorIds, isString)
    ) {
      return { ok: false, error: 'activeRun.endlessMutatorIds 非法' };
    }
    if (run.bonusObjective !== undefined) {
      const bo = run.bonusObjective;
      if (
        !isPlainObject(bo) ||
        typeof bo.id !== 'string' ||
        typeof bo.label !== 'string' ||
        typeof bo.completed !== 'boolean' ||
        !isNonNegInt(bo.rewardCredits)
      ) {
        return { ok: false, error: 'activeRun.bonusObjective 非法' };
      }
    }
    if (!isNonNegInt(run.salvagePartsEarned)) {
      return { ok: false, error: 'activeRun.salvagePartsEarned 非法' };
    }
    if (
      run.endlessThreat !== undefined &&
      (!isFiniteInt(run.endlessThreat) || run.endlessThreat < 0 || run.endlessThreat > 10)
    ) {
      return { ok: false, error: 'activeRun.endlessThreat 越界或非法' };
    }
    if (
      run.crewMasteryTier !== undefined &&
      (!isFiniteInt(run.crewMasteryTier) || run.crewMasteryTier < 0 || run.crewMasteryTier > 2)
    ) {
      return { ok: false, error: 'activeRun.crewMasteryTier 越界或非法' };
    }
    if (
      run.defeatedBossIdsThisRun !== undefined &&
      !isDenseArrayOf(run.defeatedBossIdsThisRun, isString)
    ) {
      return { ok: false, error: 'activeRun.defeatedBossIdsThisRun 非法' };
    }
    if (
      run.defeatedEnemyKindsThisRun !== undefined &&
      !isDenseArrayOf(run.defeatedEnemyKindsThisRun, isString)
    ) {
      return { ok: false, error: 'activeRun.defeatedEnemyKindsThisRun 非法' };
    }
  }

  return validateV2Bay(run.bay, shipId);
}

function validateSaveDataCore(
  raw: unknown,
  expectedSchema: number,
  expectedRules: string,
  requireV3Fields: boolean
): V2ValidationResult {
  if (!isPlainObject(raw)) return { ok: false, error: '存档根节点不是对象' };
  const d = raw as Partial<V2SaveData>;
  if (d.schemaVersion !== expectedSchema) {
    return { ok: false, error: `schemaVersion 不匹配 (${String(d.schemaVersion)})` };
  }
  if (d.rulesVersion !== expectedRules) {
    return { ok: false, error: `rulesVersion 不匹配 (${String(d.rulesVersion)})` };
  }
  if (!isPlainObject(d.profile)) {
    return { ok: false, error: 'profile 缺失' };
  }
  if (d.settings !== undefined ? !isPlainObject(d.settings) : requireV3Fields) {
    return { ok: false, error: 'settings 不是对象' };
  }

  const p = d.profile as Partial<V2ProfileState>;
  if (!isNonNegInt(p.credits)) {
    return { ok: false, error: 'profile.credits 非法' };
  }
  if (!isPlainObject(p.buildings)) {
    return { ok: false, error: 'profile.buildings 缺失' };
  }
  if (
    !isDenseArrayOf(p.unlockedShips, (s) => isString(s) && VALID_SHIP_SET.has(s as V2ShipId)) ||
    p.unlockedShips.length === 0
  ) {
    return { ok: false, error: 'profile.unlockedShips 缺失或包含未知舰船' };
  }
  if (p.unlockedCrew !== undefined || requireV3Fields) {
    if (!isDenseArrayOf(p.unlockedCrew, (c) => isString(c) && VALID_CREW_SET.has(c as V2CrewId))) {
      return { ok: false, error: 'profile.unlockedCrew 非法' };
    }
  }
  if (p.unlockedFamilies !== undefined || requireV3Fields) {
    if (
      !isDenseArrayOf(
        p.unlockedFamilies,
        (fam) => isString(fam) && VALID_UNLOCK_FAMILIES.has(fam as V2UnlockFamilyId)
      )
    ) {
      return { ok: false, error: 'profile.unlockedFamilies 非法' };
    }
  }
  if (!Array.isArray(p.blueprints)) {
    return { ok: false, error: 'profile.blueprints 缺失' };
  }
  const bpSet = new Set<string>();
  for (let i = 0; i < p.blueprints.length; i += 1) {
    if (!hasOwn(p.blueprints, i)) {
      return { ok: false, error: `profile.blueprints[${i}] 存在稀疏空洞` };
    }
    const bp = p.blueprints[i];
    if (
      typeof bp !== 'string' ||
      !V2_ALL_EQUIPMENT_KINDS.includes(bp as V2EquipmentKind) ||
      bpSet.has(bp)
    ) {
      return { ok: false, error: `非法或重复蓝图: ${String(bp)}` };
    }
    bpSet.add(bp);
  }
  if (!Array.isArray(p.equipmentWarehouse) || p.equipmentWarehouse.length > V2_WAREHOUSE_CAPACITY) {
    return { ok: false, error: 'profile.equipmentWarehouse 非法或超容量' };
  }
  const warehouseAndGiftIds = new Set<string>();
  for (let i = 0; i < p.equipmentWarehouse.length; i += 1) {
    if (!hasOwn(p.equipmentWarehouse, i)) {
      return { ok: false, error: `equipmentWarehouse[${i}] 存在稀疏空洞` };
    }
    const it = p.equipmentWarehouse[i];
    const chk = validateV2Item(it, `equipmentWarehouse[${i}]`);
    if (!chk.ok) return chk;
    const def = getAnyV2ItemDef(it.definitionId);
    if (!def || def.category !== 'equipment') {
      return { ok: false, error: `equipmentWarehouse[${i}] 仅允许存放装备` };
    }
    if (it.origin === 'loan' || it.origin === 'mission') {
      return { ok: false, error: '借用或任务物不允许进入设备库' };
    }
    if (warehouseAndGiftIds.has(it.instanceId)) {
      return { ok: false, error: `设备库存在重复实例 ID: ${it.instanceId}` };
    }
    warehouseAndGiftIds.add(it.instanceId);
  }
  if (
    !isDenseArrayOf(p.settledRunIds, isString) ||
    !Array.isArray(p.loadoutPresets) ||
    !Array.isArray(p.pendingGiftQueue)
  ) {
    return { ok: false, error: 'profile 关键数组字段损坏' };
  }
  for (let i = 0; i < p.loadoutPresets.length; i += 1) {
    if (!hasOwn(p.loadoutPresets, i) || !isValidLoadoutPreset(p.loadoutPresets[i])) {
      return { ok: false, error: `profile.loadoutPresets[${i}] 损坏` };
    }
  }
  for (let i = 0; i < p.pendingGiftQueue.length; i += 1) {
    if (!hasOwn(p.pendingGiftQueue, i)) {
      return { ok: false, error: `pendingGiftQueue[${i}] 存在稀疏空洞` };
    }
    const g = p.pendingGiftQueue[i];
    const chk = validateV2Item(g, `pendingGiftQueue[${i}]`);
    if (!chk.ok) return chk;
    if (g.origin === 'loan' || g.origin === 'mission') {
      return { ok: false, error: '借用或任务物不允许进入赠品队列' };
    }
    if (warehouseAndGiftIds.has(g.instanceId)) {
      return { ok: false, error: `赠品队列存在重复或与设备库冲突的实例 ID: ${g.instanceId}` };
    }
    warehouseAndGiftIds.add(g.instanceId);
  }

  if (p.relics !== undefined || requireV3Fields) {
    if (!isPlainObject(p.relics)) {
      return { ok: false, error: 'profile.relics 非法' };
    }
    for (const [rid, entry] of Object.entries(p.relics)) {
      if (!isPlainObject(entry)) {
        return { ok: false, error: `profile.relics.${rid} 不是对象` };
      }
      if (entry.storedCount !== undefined ? !isNonNegInt(entry.storedCount) : requireV3Fields) {
        return { ok: false, error: `profile.relics.${rid}.storedCount 非法` };
      }
      if (entry.restored !== undefined ? typeof entry.restored !== 'boolean' : requireV3Fields) {
        return { ok: false, error: `profile.relics.${rid}.restored 非法` };
      }
    }
  }

  if (p.completedContractTypes !== undefined || requireV3Fields) {
    if (
      !isDenseArrayOf(
        p.completedContractTypes,
        (ct) =>
          isString(ct) &&
          VALID_COMPLETED_CONTRACT_TYPES.has(ct as 'transport' | 'rescue' | 'survey')
      )
    ) {
      return { ok: false, error: 'profile.completedContractTypes 非法' };
    }
  }
  if (p.completedContractIds !== undefined || requireV3Fields) {
    if (!isDenseArrayOf(p.completedContractIds, isString)) {
      return { ok: false, error: 'profile.completedContractIds 非法' };
    }
  }
  if (p.discoveredItems !== undefined || requireV3Fields) {
    if (!isDenseArrayOf(p.discoveredItems, isString)) {
      return { ok: false, error: 'profile.discoveredItems 非法' };
    }
  }
  if (p.seenItems !== undefined || requireV3Fields) {
    if (!isDenseArrayOf(p.seenItems, isString)) {
      return { ok: false, error: 'profile.seenItems 非法' };
    }
  }
  if (p.totalRuns !== undefined || requireV3Fields) {
    if (!isNonNegInt(p.totalRuns)) {
      return { ok: false, error: 'profile.totalRuns 非法' };
    }
  }
  if (p.deepestLayerReached !== undefined || requireV3Fields) {
    if (!isNonNegInt(p.deepestLayerReached)) {
      return { ok: false, error: 'profile.deepestLayerReached 非法' };
    }
  }
  if (p.tutorialCompleted !== undefined ? typeof p.tutorialCompleted !== 'boolean' : requireV3Fields) {
    return { ok: false, error: 'profile.tutorialCompleted 非法' };
  }
  if (
    p.tutorialBonusClaimed !== undefined
      ? typeof p.tutorialBonusClaimed !== 'boolean'
      : requireV3Fields
  ) {
    return { ok: false, error: 'profile.tutorialBonusClaimed 非法' };
  }
  if (p.selectedShipId !== undefined || requireV3Fields) {
    if (typeof p.selectedShipId !== 'string' || !VALID_SHIP_SET.has(p.selectedShipId as V2ShipId)) {
      return { ok: false, error: `profile.selectedShipId 非法: ${String(p.selectedShipId)}` };
    }
  }
  if (p.selectedCrewId !== undefined && p.selectedCrewId !== null) {
    if (typeof p.selectedCrewId !== 'string' || !VALID_CREW_SET.has(p.selectedCrewId as V2CrewId)) {
      return { ok: false, error: `profile.selectedCrewId 非法: ${String(p.selectedCrewId)}` };
    }
  }
  if (p.selectedArchetype !== undefined || requireV3Fields) {
    if (
      typeof p.selectedArchetype !== 'string' ||
      !VALID_ARCHETYPES.has(p.selectedArchetype as V2ArchetypeId)
    ) {
      return { ok: false, error: `profile.selectedArchetype 非法: ${String(p.selectedArchetype)}` };
    }
  }

  if (requireV3Fields) {
    if (!isNonNegInt(p.salvageParts)) {
      return { ok: false, error: 'profile.salvageParts 非法' };
    }
    if (!isPlainObject(p.facilityTiers)) {
      return { ok: false, error: 'profile.facilityTiers 缺失' };
    }
    for (const [facKey, tierVal] of Object.entries(p.facilityTiers)) {
      if (!isFiniteInt(tierVal) || tierVal < 0 || tierVal > 3) {
        return { ok: false, error: `profile.facilityTiers.${facKey} 越界或非法` };
      }
    }
    if (!isPlainObject(p.campaign)) {
      return { ok: false, error: 'profile.campaign 缺失' };
    }
    if (typeof p.campaign.currentAct !== 'string' || !VALID_ACTS.has(p.campaign.currentAct as CampaignActId)) {
      return { ok: false, error: `profile.campaign.currentAct 非法: ${String(p.campaign.currentAct)}` };
    }
    if (
      !isDenseArrayOf(
        p.campaign.unlockedSectors,
        (s) => isString(s) && VALID_SECTORS.has(s as SectorId)
      ) ||
      p.campaign.unlockedSectors.length === 0
    ) {
      return { ok: false, error: 'profile.campaign.unlockedSectors 非法' };
    }
    if (
      !isDenseArrayOf(p.campaign.completedMilestones, isString) ||
      !isDenseArrayOf(p.campaign.defeatedBossIds, isString) ||
      !isDenseArrayOf(p.campaign.readCommsIds, isString) ||
      !isDenseArrayOf(
        p.campaign.endingsUnlocked,
        (e) => isString(e) && VALID_ENDINGS.has(e as EndingId)
      )
    ) {
      return { ok: false, error: 'profile.campaign 数组字段损坏' };
    }
    if (!isPlainObject(p.campaign.relicPityCounters)) {
      return { ok: false, error: 'profile.campaign.relicPityCounters 非法' };
    }
    for (const [pityKey, pityVal] of Object.entries(p.campaign.relicPityCounters)) {
      if (!isNonNegInt(pityVal)) {
        return { ok: false, error: `profile.campaign.relicPityCounters.${pityKey} 非法` };
      }
    }
    if (
      typeof p.campaign.finalMissionUnlocked !== 'boolean' ||
      typeof p.campaign.endlessUnlocked !== 'boolean'
    ) {
      return { ok: false, error: 'profile.campaign 布尔标志损坏' };
    }
    if (
      !isFiniteInt(p.campaign.maxEndlessThreat) ||
      p.campaign.maxEndlessThreat < 0 ||
      p.campaign.maxEndlessThreat > 10
    ) {
      return { ok: false, error: 'profile.campaign.maxEndlessThreat 越界或非法' };
    }
    if (!isPlainObject(p.factionRep)) {
      return { ok: false, error: 'profile.factionRep 缺失' };
    }
    for (const fid of ALL_FACTIONS) {
      if (!hasOwn(p.factionRep, fid)) {
        return { ok: false, error: `profile.factionRep.${fid} 缺失` };
      }
      const repVal = p.factionRep[fid];
      if (!isFiniteInt(repVal) || repVal < 0 || repVal > 300) {
        return { ok: false, error: `profile.factionRep.${fid} 越界或非法` };
      }
    }
    for (const [repKey, repVal] of Object.entries(p.factionRep)) {
      if (!isFiniteInt(repVal) || repVal < 0 || repVal > 300) {
        return { ok: false, error: `profile.factionRep.${repKey} 越界或非法` };
      }
    }
    if (!isPlainObject(p.crewMastery)) {
      return { ok: false, error: 'profile.crewMastery 缺失' };
    }
    for (const cid of V2_CREW_ORDER) {
      if (!hasOwn(p.crewMastery, cid)) {
        return { ok: false, error: `profile.crewMastery.${cid} 缺失` };
      }
      const mVal = p.crewMastery[cid];
      if (!isFiniteInt(mVal) || mVal < 0 || mVal > 2) {
        return { ok: false, error: `profile.crewMastery.${cid} 越界或非法` };
      }
    }
    for (const [mKey, mVal] of Object.entries(p.crewMastery)) {
      if (!isFiniteInt(mVal) || mVal < 0 || mVal > 2) {
        return { ok: false, error: `profile.crewMastery.${mKey} 越界或非法` };
      }
    }
    if (
      !isDenseArrayOf(p.achievementsUnlocked, isString) ||
      !isDenseArrayOf(p.defeatedEnemyKinds, isString) ||
      !isDenseArrayOf(p.runHistory, isValidRunHistoryEntry)
    ) {
      return { ok: false, error: 'profile V3 追踪数组损坏' };
    }
    if (!isPlainObject(p.career)) {
      return { ok: false, error: 'profile.career 损坏' };
    }
    for (const cKey of V3_CAREER_KEYS) {
      if (!hasOwn(p.career, cKey)) {
        return { ok: false, error: `profile.career.${cKey} 缺失` };
      }
      const cVal = p.career[cKey];
      if (!isNonNegInt(cVal)) {
        return { ok: false, error: `profile.career.${cKey} 为负或非法` };
      }
    }
  }

  if (d.activeRun !== null) {
    const runChk = validateV2RunCore(d.activeRun, expectedSchema, expectedRules, requireV3Fields);
    if (!runChk.ok) return runChk;
  }
  return { ok: true };
}

export function validateV2SaveDataDetailed(raw: unknown): V2ValidationResult {
  return validateSaveDataCore(raw, V2_SCHEMA_VERSION, V2_RULES_VERSION, true);
}

export function validateLegacyV2SaveDataDetailed(raw: unknown): V2ValidationResult {
  return validateSaveDataCore(raw, V2_LEGACY_SCHEMA_VERSION, V2_LEGACY_RULES_VERSION, false);
}

/**
 * Non-destructively upgrades a validated legacy V2 (schemaVersion: 2) save to V3 (schemaVersion: 3).
 * Preserves EVERY V2 profile, settings, and activeRun field while deriving initial V3 progression.
 */
export function migrateV2ToV3SaveData(rawV2: unknown): {
  readonly ok: boolean;
  readonly data?: V2SaveData;
  readonly error?: string;
} {
  const check = validateLegacyV2SaveDataDetailed(rawV2);
  if (!check.ok) {
    return { ok: false, error: check.error };
  }
  const src = rawV2 as V2SaveData;
  const fresh = createFreshV2Profile();
  const srcProfile: Partial<V2ProfileState> = src.profile;

  const buildings: Record<V2FacilityId, boolean> = { ...fresh.buildings };
  if (isPlainObject(srcProfile.buildings)) {
    for (const f of V2_FACILITY_ORDER) {
      if (hasOwn(srcProfile.buildings, f)) {
        buildings[f] = Boolean(srcProfile.buildings[f]);
      }
    }
  }

  const relics: Record<string, RelicProgress> = { ...createInitialV2Relics() };
  if (isPlainObject(srcProfile.relics)) {
    for (const rid of V2_RELIC_ORDER) {
      const st = hasOwn(srcProfile.relics, rid) ? srcProfile.relics[rid] : undefined;
      if (isPlainObject(st)) {
        relics[rid] = {
          storedCount: sanitizeNonNegInt(st.storedCount),
          restored: Boolean(st.restored),
        };
      }
    }
  }

  const unlockedShips: V2ShipId[] =
    Array.isArray(srcProfile.unlockedShips) && srcProfile.unlockedShips.length > 0
      ? [...srcProfile.unlockedShips]
      : [...fresh.unlockedShips];
  const unlockedCrew: V2CrewId[] = Array.isArray(srcProfile.unlockedCrew)
    ? srcProfile.unlockedCrew.filter(
        (c): c is V2CrewId => typeof c === 'string' && VALID_CREW_SET.has(c as V2CrewId)
      )
    : [...fresh.unlockedCrew];
  const unlockedFamilies: V2UnlockFamilyId[] = Array.isArray(srcProfile.unlockedFamilies)
    ? srcProfile.unlockedFamilies.filter(
        (f): f is V2UnlockFamilyId =>
          typeof f === 'string' && VALID_UNLOCK_FAMILIES.has(f as V2UnlockFamilyId)
      )
    : [...fresh.unlockedFamilies];
  const blueprints = Array.isArray(srcProfile.blueprints)
    ? [...srcProfile.blueprints]
    : [...fresh.blueprints];
  const equipmentWarehouse = Array.isArray(srcProfile.equipmentWarehouse)
    ? [...srcProfile.equipmentWarehouse]
    : [];
  const pendingGiftQueue = Array.isArray(srcProfile.pendingGiftQueue)
    ? [...srcProfile.pendingGiftQueue]
    : [];
  const loadoutPresets = sanitizeLoadoutPresets(srcProfile.loadoutPresets);
  const settledRunIds = Array.isArray(srcProfile.settledRunIds)
    ? srcProfile.settledRunIds.filter((s): s is string => typeof s === 'string')
    : [];
  const completedContractTypes: ('transport' | 'rescue' | 'survey')[] = Array.isArray(
    srcProfile.completedContractTypes
  )
    ? srcProfile.completedContractTypes.filter(
        (t): t is 'transport' | 'rescue' | 'survey' =>
          typeof t === 'string' &&
          VALID_COMPLETED_CONTRACT_TYPES.has(t as 'transport' | 'rescue' | 'survey')
      )
    : [];
  const completedContractIds = Array.isArray(srcProfile.completedContractIds)
    ? srcProfile.completedContractIds.filter((s): s is string => typeof s === 'string')
    : [];
  const discoveredItems = Array.isArray(srcProfile.discoveredItems)
    ? srcProfile.discoveredItems.filter((s): s is string => typeof s === 'string')
    : [];
  const seenItems = Array.from(
    new Set([
      ...(Array.isArray(srcProfile.seenItems)
        ? srcProfile.seenItems.filter((s): s is string => typeof s === 'string')
        : []),
      ...discoveredItems,
    ])
  );
  const credits = sanitizeNonNegInt(srcProfile.credits);
  const deepestLayerReached = sanitizeNonNegInt(srcProfile.deepestLayerReached);
  const totalRuns = sanitizeNonNegInt(srcProfile.totalRuns);
  const tutorialCompleted = Boolean(srcProfile.tutorialCompleted);
  const tutorialBonusClaimed = Boolean(srcProfile.tutorialBonusClaimed);
  const selectedShipId: V2ShipId =
    typeof srcProfile.selectedShipId === 'string' &&
    VALID_SHIP_SET.has(srcProfile.selectedShipId as V2ShipId) &&
    unlockedShips.includes(srcProfile.selectedShipId as V2ShipId)
      ? (srcProfile.selectedShipId as V2ShipId)
      : unlockedShips[0];
  const selectedCrewId: V2CrewId | null =
    srcProfile.selectedCrewId === null
      ? null
      : typeof srcProfile.selectedCrewId === 'string' &&
        VALID_CREW_SET.has(srcProfile.selectedCrewId as V2CrewId)
      ? (srcProfile.selectedCrewId as V2CrewId)
      : fresh.selectedCrewId;
  const selectedArchetype: V2ArchetypeId =
    typeof srcProfile.selectedArchetype === 'string' &&
    VALID_ARCHETYPES.has(srcProfile.selectedArchetype as V2ArchetypeId)
      ? (srcProfile.selectedArchetype as V2ArchetypeId)
      : fresh.selectedArchetype;
  const migrationRecord = isPlainObject(srcProfile.migrationRecord)
    ? srcProfile.migrationRecord
    : null;

  const migratedProfile: V2ProfileState = {
    credits,
    buildings,
    unlockedShips,
    unlockedCrew,
    unlockedFamilies,
    blueprints,
    equipmentWarehouse,
    pendingGiftQueue,
    relics,
    discoveredItems,
    seenItems,
    loadoutPresets,
    completedContractTypes,
    completedContractIds,
    deepestLayerReached,
    totalRuns,
    tutorialCompleted,
    tutorialBonusClaimed,
    settledRunIds,
    selectedShipId,
    selectedCrewId,
    selectedArchetype,
    migrationRecord,
    salvageParts: 0,
    facilityTiers: createInitialV3FacilityTiers(buildings),
    campaign: inferV3CampaignFromV2Profile({
      tutorialCompleted,
      totalRuns,
      buildings,
      completedContractTypes,
      deepestLayerReached,
      relics,
    }),
    factionRep: createInitialV3FactionRep(),
    crewMastery: createInitialV3CrewMastery(),
    achievementsUnlocked: [],
    defeatedEnemyKinds: [],
    runHistory: [],
    career: inferV3CareerFromV2Profile({
      totalRuns,
      completedContractIds,
      credits,
    }),
  };

  let migratedRun: V2RunState | null = null;
  if (src.activeRun !== null) {
    migratedRun = {
      ...src.activeRun,
      schemaVersion: V2_SCHEMA_VERSION,
      rulesVersion: V2_RULES_VERSION,
      sectorId: 'near_orbit',
      endlessThreat: 0,
      endlessMutatorIds: [],
      recentEquipmentKinds: [],
      usedEventIds: [],
      tacticalChargesMax: 1,
      tacticalChargesUsed: 0,
      salvagePartsEarned: 0,
      isFinalCampaignRun: false,
    };
  }

  const migrated: V2SaveData = {
    schemaVersion: V2_SCHEMA_VERSION,
    rulesVersion: V2_RULES_VERSION,
    savedAt: typeof src.savedAt === 'string' && src.savedAt.length > 0 ? src.savedAt : new Date().toISOString(),
    profile: migratedProfile,
    activeRun: migratedRun,
    settings: sanitizeSettings(src.settings),
  };

  const finalCheck = validateV2SaveDataDetailed(migrated);
  if (!finalCheck.ok) {
    return { ok: false, error: `V2->V3 迁移后校验失败: ${finalCheck.error}` };
  }
  return { ok: true, data: normalizeV2SaveData(migrated) };
}

export function normalizeV2SaveData(raw: V2SaveData): V2SaveData {
  const fresh = createFreshV2Profile();
  const rawProfile: Partial<V2ProfileState> = isPlainObject(raw?.profile) ? raw.profile : fresh;

  const relics: Record<string, RelicProgress> = { ...createInitialV2Relics() };
  if (isPlainObject(rawProfile.relics)) {
    for (const rid of V2_RELIC_ORDER) {
      const st = hasOwn(rawProfile.relics, rid) ? rawProfile.relics[rid] : undefined;
      if (isPlainObject(st)) {
        relics[rid] = {
          storedCount: sanitizeNonNegInt(st.storedCount),
          restored: Boolean(st.restored),
        };
      }
    }
  }

  const buildings: Record<V2FacilityId, boolean> = { ...fresh.buildings };
  if (isPlainObject(rawProfile.buildings)) {
    for (const f of V2_FACILITY_ORDER) {
      if (hasOwn(rawProfile.buildings, f)) {
        buildings[f] = Boolean(rawProfile.buildings[f]);
      }
    }
  }

  const facilityTiers: Record<string, number> = {
    ...createInitialV3FacilityTiers(buildings),
  };
  const rawTiers = isPlainObject(rawProfile.facilityTiers) ? rawProfile.facilityTiers : {};
  for (const [facKey, tierVal] of Object.entries(rawTiers)) {
    if (!isSafeMapKey(facKey)) continue;
    if (typeof tierVal === 'number' && Number.isFinite(tierVal)) {
      facilityTiers[facKey] = Math.max(0, Math.min(3, Math.floor(tierVal)));
    } else if (!hasOwn(facilityTiers, facKey)) {
      facilityTiers[facKey] = 0;
    }
  }
  if (
    typeof facilityTiers.stargate_relay !== 'number' ||
    !Number.isFinite(facilityTiers.stargate_relay)
  ) {
    facilityTiers.stargate_relay = 0;
  }

  const factionRep: Record<FactionId, number> = { ...createInitialV3FactionRep() };
  if (isPlainObject(rawProfile.factionRep)) {
    for (const fid of ALL_FACTIONS) {
      if (!hasOwn(rawProfile.factionRep, fid)) continue;
      const v = rawProfile.factionRep[fid];
      if (typeof v === 'number' && Number.isFinite(v)) {
        factionRep[fid] = Math.max(0, Math.min(300, Math.floor(v)));
      }
    }
  }

  const crewMastery: Record<V2CrewId, number> = { ...createInitialV3CrewMastery() };
  if (isPlainObject(rawProfile.crewMastery)) {
    for (const cid of V2_CREW_ORDER) {
      if (!hasOwn(rawProfile.crewMastery, cid)) continue;
      const v = rawProfile.crewMastery[cid];
      if (typeof v === 'number' && Number.isFinite(v)) {
        crewMastery[cid] = Math.max(0, Math.min(2, Math.floor(v)));
      }
    }
  }

  const filteredShips: V2ShipId[] = Array.isArray(rawProfile.unlockedShips)
    ? Array.from(
        new Set(
          rawProfile.unlockedShips.filter(
            (s): s is V2ShipId => typeof s === 'string' && VALID_SHIP_SET.has(s as V2ShipId)
          )
        )
      )
    : [];
  const unlockedShips: V2ShipId[] =
    filteredShips.length > 0 ? filteredShips : [...fresh.unlockedShips];

  const unlockedCrew: V2CrewId[] = Array.isArray(rawProfile.unlockedCrew)
    ? Array.from(
        new Set(
          rawProfile.unlockedCrew.filter(
            (c): c is V2CrewId => typeof c === 'string' && VALID_CREW_SET.has(c as V2CrewId)
          )
        )
      )
    : [...fresh.unlockedCrew];

  const unlockedFamilies: V2UnlockFamilyId[] = Array.isArray(rawProfile.unlockedFamilies)
    ? Array.from(
        new Set(
          rawProfile.unlockedFamilies.filter(
            (f): f is V2UnlockFamilyId =>
              typeof f === 'string' && VALID_UNLOCK_FAMILIES.has(f as V2UnlockFamilyId)
          )
        )
      )
    : [...fresh.unlockedFamilies];

  const blueprints: V2EquipmentKind[] = Array.isArray(rawProfile.blueprints)
    ? Array.from(
        new Set(
          rawProfile.blueprints.filter(
            (bp): bp is V2EquipmentKind =>
              typeof bp === 'string' && V2_ALL_EQUIPMENT_KINDS.includes(bp as V2EquipmentKind)
          )
        )
      )
    : [...fresh.blueprints];

  const completedContractTypes: ('transport' | 'rescue' | 'survey')[] = Array.isArray(
    rawProfile.completedContractTypes
  )
    ? Array.from(
        new Set(
          rawProfile.completedContractTypes.filter(
            (t): t is 'transport' | 'rescue' | 'survey' =>
              typeof t === 'string' &&
              VALID_COMPLETED_CONTRACT_TYPES.has(t as 'transport' | 'rescue' | 'survey')
          )
        )
      )
    : [];

  const completedContractIds = Array.isArray(rawProfile.completedContractIds)
    ? Array.from(
        new Set(rawProfile.completedContractIds.filter((s): s is string => typeof s === 'string'))
      )
    : [];

  const discoveredItems = Array.isArray(rawProfile.discoveredItems)
    ? Array.from(
        new Set(rawProfile.discoveredItems.filter((s): s is string => typeof s === 'string'))
      )
    : [];
  const rawSeenItems = Array.isArray(rawProfile.seenItems)
    ? rawProfile.seenItems.filter((s): s is string => typeof s === 'string')
    : [];
  const seenItems = Array.from(new Set([...rawSeenItems, ...discoveredItems]));

  const achievementsUnlocked = Array.isArray(rawProfile.achievementsUnlocked)
    ? Array.from(
        new Set(rawProfile.achievementsUnlocked.filter((s): s is string => typeof s === 'string'))
      )
    : [];
  const defeatedEnemyKinds = Array.isArray(rawProfile.defeatedEnemyKinds)
    ? Array.from(
        new Set(rawProfile.defeatedEnemyKinds.filter((s): s is string => typeof s === 'string'))
      )
    : [];
  const runHistory = Array.isArray(rawProfile.runHistory)
    ? rawProfile.runHistory
        .filter((h): h is V3RunHistoryEntry => isValidRunHistoryEntry(h))
        .slice(0, V3_MAX_RUN_HISTORY)
    : [];
  const settledRunIds = Array.isArray(rawProfile.settledRunIds)
    ? rawProfile.settledRunIds.filter((s): s is string => typeof s === 'string')
    : [];
  const loadoutPresets = sanitizeLoadoutPresets(rawProfile.loadoutPresets);

  const seenWarehouseAndGiftIds = new Set<string>();
  const equipmentWarehouse: V2ItemInstance[] = [];
  if (Array.isArray(rawProfile.equipmentWarehouse)) {
    for (let i = 0; i < rawProfile.equipmentWarehouse.length; i += 1) {
      if (!hasOwn(rawProfile.equipmentWarehouse, i)) continue;
      const it = rawProfile.equipmentWarehouse[i];
      if (
        validateV2Item(it, 'equipmentWarehouse').ok &&
        getAnyV2ItemDef(it.definitionId)?.category === 'equipment' &&
        it.origin !== 'loan' &&
        it.origin !== 'mission' &&
        !seenWarehouseAndGiftIds.has(it.instanceId)
      ) {
        seenWarehouseAndGiftIds.add(it.instanceId);
        equipmentWarehouse.push(it);
      }
    }
  }

  const pendingGiftQueue: V2ItemInstance[] = [];
  if (Array.isArray(rawProfile.pendingGiftQueue)) {
    for (let i = 0; i < rawProfile.pendingGiftQueue.length; i += 1) {
      if (!hasOwn(rawProfile.pendingGiftQueue, i)) continue;
      const g = rawProfile.pendingGiftQueue[i];
      if (
        validateV2Item(g, 'pendingGiftQueue').ok &&
        g.origin !== 'loan' &&
        g.origin !== 'mission' &&
        !seenWarehouseAndGiftIds.has(g.instanceId)
      ) {
        seenWarehouseAndGiftIds.add(g.instanceId);
        pendingGiftQueue.push(g);
      }
    }
  }

  const credits = sanitizeNonNegInt(rawProfile.credits);
  const salvageParts = sanitizeNonNegInt(rawProfile.salvageParts);
  const totalRuns = sanitizeNonNegInt(rawProfile.totalRuns);
  const deepestLayerReached = sanitizeNonNegInt(rawProfile.deepestLayerReached);
  const selectedShipId: V2ShipId =
    typeof rawProfile.selectedShipId === 'string' &&
    VALID_SHIP_SET.has(rawProfile.selectedShipId as V2ShipId) &&
    unlockedShips.includes(rawProfile.selectedShipId as V2ShipId)
      ? (rawProfile.selectedShipId as V2ShipId)
      : unlockedShips[0];
  const selectedCrewId: V2CrewId | null =
    rawProfile.selectedCrewId === null
      ? null
      : typeof rawProfile.selectedCrewId === 'string' &&
        VALID_CREW_SET.has(rawProfile.selectedCrewId as V2CrewId)
      ? (rawProfile.selectedCrewId as V2CrewId)
      : fresh.selectedCrewId;
  const selectedArchetype: V2ArchetypeId =
    typeof rawProfile.selectedArchetype === 'string' &&
    VALID_ARCHETYPES.has(rawProfile.selectedArchetype as V2ArchetypeId)
      ? (rawProfile.selectedArchetype as V2ArchetypeId)
      : fresh.selectedArchetype;

  const baseCampaign = createInitialV3CampaignState();
  const rawCampaign: Partial<V3CampaignState> = isPlainObject(rawProfile.campaign)
    ? rawProfile.campaign
    : baseCampaign;
  const currentAct: CampaignActId =
    typeof rawCampaign.currentAct === 'string' && VALID_ACTS.has(rawCampaign.currentAct)
      ? rawCampaign.currentAct
      : baseCampaign.currentAct;
  const filteredSectors = Array.isArray(rawCampaign.unlockedSectors)
    ? Array.from(
        new Set(
          rawCampaign.unlockedSectors.filter(
            (s): s is SectorId => typeof s === 'string' && VALID_SECTORS.has(s as SectorId)
          )
        )
      )
    : [];
  const unlockedSectors: SectorId[] =
    filteredSectors.length > 0 ? filteredSectors : [...baseCampaign.unlockedSectors];
  const completedMilestones = Array.isArray(rawCampaign.completedMilestones)
    ? Array.from(
        new Set(rawCampaign.completedMilestones.filter((s): s is string => typeof s === 'string'))
      )
    : [];
  const defeatedBossIds = Array.isArray(rawCampaign.defeatedBossIds)
    ? Array.from(
        new Set(rawCampaign.defeatedBossIds.filter((s): s is string => typeof s === 'string'))
      )
    : [];
  const readCommsIds = Array.isArray(rawCampaign.readCommsIds)
    ? Array.from(new Set(rawCampaign.readCommsIds.filter((s): s is string => typeof s === 'string')))
    : [];
  const relicPityCounters: Record<string, number> = {};
  if (isPlainObject(rawCampaign.relicPityCounters)) {
    for (const [k, v] of Object.entries(rawCampaign.relicPityCounters)) {
      if (!isSafeMapKey(k)) continue;
      relicPityCounters[k] = sanitizeNonNegInt(v);
    }
  }
  const rawMaxThreat = rawCampaign.maxEndlessThreat;
  const maxEndlessThreat =
    typeof rawMaxThreat === 'number' && Number.isFinite(rawMaxThreat)
      ? Math.max(0, Math.min(10, Math.floor(rawMaxThreat)))
      : 0;
  const endingsUnlocked = Array.from(
    new Set(
      (Array.isArray(rawCampaign.endingsUnlocked) ? rawCampaign.endingsUnlocked : []).filter(
        (e): e is EndingId => typeof e === 'string' && VALID_ENDINGS.has(e as EndingId)
      )
    )
  );
  const finalMissionUnlocked = Boolean(rawCampaign.finalMissionUnlocked);
  const endlessUnlocked = Boolean(rawCampaign.endlessUnlocked);

  const rawCareer: Partial<V3CareerStats> = isPlainObject(rawProfile.career)
    ? rawProfile.career
    : createInitialV3CareerStats();
  const career: V3CareerStats = {
    totalWins: sanitizeNonNegInt(rawCareer.totalWins),
    totalDefeats: sanitizeNonNegInt(rawCareer.totalDefeats),
    totalSafeReturns: sanitizeNonNegInt(rawCareer.totalSafeReturns),
    totalCreditsEarned: sanitizeNonNegInt(rawCareer.totalCreditsEarned),
    totalSalvagePartsEarned: sanitizeNonNegInt(rawCareer.totalSalvagePartsEarned),
    totalBossesDefeated: sanitizeNonNegInt(rawCareer.totalBossesDefeated),
    totalWrecksDissected: sanitizeNonNegInt(rawCareer.totalWrecksDissected),
    totalItemsDismantled: sanitizeNonNegInt(rawCareer.totalItemsDismantled),
    deepestEndlessCleared: sanitizeNonNegInt(rawCareer.deepestEndlessCleared),
  };

  let activeRun: V2RunState | null = null;
  if (raw.activeRun !== null && isPlainObject(raw.activeRun)) {
    const rawRun = raw.activeRun;
    const nextEndlessThreat =
      rawRun.endlessThreat !== undefined
        ? typeof rawRun.endlessThreat === 'number' && Number.isFinite(rawRun.endlessThreat)
          ? Math.max(0, Math.min(10, Math.floor(rawRun.endlessThreat)))
          : 0
        : undefined;
    const needsEndlessPatch =
      rawRun.endlessThreat !== undefined && nextEndlessThreat !== rawRun.endlessThreat;
    const nextCrewMasteryTier =
      rawRun.crewMasteryTier !== undefined
        ? typeof rawRun.crewMasteryTier === 'number' && Number.isFinite(rawRun.crewMasteryTier)
          ? Math.max(0, Math.min(2, Math.floor(rawRun.crewMasteryTier)))
          : 0
        : undefined;
    const needsCrewMasteryPatch =
      rawRun.crewMasteryTier !== undefined && nextCrewMasteryTier !== rawRun.crewMasteryTier;
    const safeChargesMax = sanitizeNonNegInt(rawRun.tacticalChargesMax);
    const safeChargesUsed = Math.min(safeChargesMax, sanitizeNonNegInt(rawRun.tacticalChargesUsed));
    const needsChargesPatch =
      rawRun.tacticalChargesMax !== safeChargesMax || rawRun.tacticalChargesUsed !== safeChargesUsed;

    if (needsEndlessPatch || needsCrewMasteryPatch || needsChargesPatch) {
      activeRun = {
        ...rawRun,
        ...(rawRun.endlessThreat !== undefined ? { endlessThreat: nextEndlessThreat } : {}),
        ...(rawRun.crewMasteryTier !== undefined ? { crewMasteryTier: nextCrewMasteryTier } : {}),
        tacticalChargesMax: safeChargesMax,
        tacticalChargesUsed: safeChargesUsed,
      };
    } else {
      activeRun = rawRun;
    }
  }

  return {
    schemaVersion: typeof raw?.schemaVersion === 'number' ? raw.schemaVersion : V2_SCHEMA_VERSION,
    rulesVersion: typeof raw?.rulesVersion === 'string' ? raw.rulesVersion : V2_RULES_VERSION,
    savedAt:
      typeof raw?.savedAt === 'string' && raw.savedAt.length > 0
        ? raw.savedAt
        : new Date().toISOString(),
    profile: {
      credits,
      salvageParts,
      buildings,
      unlockedShips,
      unlockedCrew,
      unlockedFamilies,
      blueprints,
      equipmentWarehouse,
      pendingGiftQueue,
      relics,
      discoveredItems,
      seenItems,
      loadoutPresets,
      completedContractTypes,
      completedContractIds,
      deepestLayerReached,
      totalRuns,
      tutorialCompleted: Boolean(rawProfile.tutorialCompleted),
      tutorialBonusClaimed: Boolean(rawProfile.tutorialBonusClaimed),
      settledRunIds,
      selectedShipId,
      selectedCrewId,
      selectedArchetype,
      migrationRecord: isPlainObject(rawProfile.migrationRecord)
        ? rawProfile.migrationRecord
        : null,
      facilityTiers,
      factionRep,
      crewMastery,
      achievementsUnlocked,
      defeatedEnemyKinds,
      runHistory,
      campaign: {
        currentAct,
        unlockedSectors,
        completedMilestones,
        defeatedBossIds,
        readCommsIds,
        relicPityCounters,
        endingsUnlocked,
        finalMissionUnlocked,
        endlessUnlocked,
        maxEndlessThreat,
      },
      career,
    },
    activeRun,
    settings: sanitizeSettings(raw?.settings),
  };
}

function isValidLegacyV2RawString(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return validateLegacyV2SaveDataDetailed(parsed).ok;
  } catch {
    return false;
  }
}

function tryRecoverBackupRaw(raw: string | null): V2SaveData | null {
  if (!raw) return null;
  try {
    const parsedBackup = JSON.parse(raw) as unknown;
    const bCheck = validateV2SaveDataDetailed(parsedBackup);
    if (bCheck.ok) {
      return normalizeV2SaveData(parsedBackup as V2SaveData);
    }
    if (
      isPlainObject(parsedBackup) &&
      parsedBackup.schemaVersion === V2_LEGACY_SCHEMA_VERSION
    ) {
      const migratedBackup = migrateV2ToV3SaveData(parsedBackup);
      if (migratedBackup.ok && migratedBackup.data) {
        return normalizeV2SaveData(migratedBackup.data);
      }
    }
  } catch {
    // backup unreadable
  }
  return null;
}

export function loadV2SaveData(storage: V2StorageLike): V2LoadResult {
  let primaryRaw: string | null = null;
  let v3BackupRaw: string | null = null;
  let v2BackupRaw: string | null = null;
  try {
    primaryRaw = storage.getItem(V2_SAVE_KEY);
    v3BackupRaw = storage.getItem(V3_BACKUP_KEY);
    v2BackupRaw = storage.getItem(V2_BACKUP_KEY);
  } catch (err) {
    return {
      status: 'corrupt_no_backup',
      data: createFreshV2SaveData(),
      error: `无法访问浏览器存储: ${String(err)}`,
    };
  }

  if (!primaryRaw) {
    return { status: 'fresh', data: createFreshV2SaveData() };
  }

  let primaryError = '主存档结构无效';
  try {
    const parsed = JSON.parse(primaryRaw) as unknown;
    const v3Check = validateV2SaveDataDetailed(parsed);
    if (v3Check.ok) {
      return { status: 'loaded', data: normalizeV2SaveData(parsed as V2SaveData) };
    }

    if (
      isPlainObject(parsed) &&
      parsed.schemaVersion === V2_LEGACY_SCHEMA_VERSION
    ) {
      const migrated = migrateV2ToV3SaveData(parsed);
      if (migrated.ok && migrated.data) {
        // Strictly write-once for valid legacy V2 saves: preserve original V2 JSON ONLY if V2_BACKUP_KEY does not already hold a valid legacy V2 save
        if (!isValidLegacyV2RawString(v2BackupRaw)) {
          try {
            storage.setItem(V2_BACKUP_KEY, primaryRaw);
          } catch {
            // Best-effort backup
          }
        }
        return {
          status: 'loaded',
          data: normalizeV2SaveData(migrated.data),
          migratedFromV2: true,
        };
      }
      primaryError = migrated.error ?? v3Check.error ?? primaryError;
    } else {
      primaryError = v3Check.error ?? primaryError;
    }
  } catch (err) {
    primaryError = `JSON 解析失败: ${String(err)}`;
  }

  // Primary corrupt -> try rolling V3 backup FIRST, then fall back to V2 backup (accepting both V3 and legacy V2 without ever overwriting V2_BACKUP_KEY)
  const recoveredV3 = tryRecoverBackupRaw(v3BackupRaw);
  if (recoveredV3) {
    return {
      status: 'corrupt_with_backup',
      backup: recoveredV3,
      error: primaryError,
    };
  }

  const recoveredV2 = tryRecoverBackupRaw(v2BackupRaw);
  if (recoveredV2) {
    return {
      status: 'corrupt_with_backup',
      backup: recoveredV2,
      error: primaryError,
    };
  }

  return {
    status: 'corrupt_no_backup',
    data: createFreshV2SaveData(),
    error: primaryError,
  };
}

export function persistV2SaveData(
  storage: V2StorageLike,
  data: V2SaveData
): { readonly ok: boolean; readonly error?: string } {
  let payload: V2SaveData;
  try {
    if (!isPlainObject(data)) {
      return { ok: false, error: '拒绝写入非法 V3 存档: 存档根节点不是对象' };
    }
    const rawPayload: V2SaveData = {
      ...data,
      schemaVersion: V2_SCHEMA_VERSION,
      rulesVersion: V2_RULES_VERSION,
      savedAt: new Date().toISOString(),
    };
    const preCheck = validateV2SaveDataDetailed(rawPayload);
    if (!preCheck.ok) {
      return { ok: false, error: `拒绝写入非法 V3 存档: ${preCheck.error}` };
    }
    payload = normalizeV2SaveData(rawPayload);
    const check = validateV2SaveDataDetailed(payload);
    if (!check.ok) {
      return { ok: false, error: `拒绝写入非法 V3 存档: ${check.error}` };
    }
  } catch (err) {
    return { ok: false, error: `拒绝写入非法 V3 存档: ${String(err)}` };
  }

  try {
    const prev = storage.getItem(V2_SAVE_KEY);
    if (prev) {
      try {
        const parsedPrev = JSON.parse(prev) as unknown;
        if (validateV2SaveDataDetailed(parsedPrev).ok) {
          // Rotate valid V3 previous primary exclusively into V3_BACKUP_KEY (never touch V2_BACKUP_KEY!)
          storage.setItem(V3_BACKUP_KEY, prev);
        } else if (validateLegacyV2SaveDataDetailed(parsedPrev).ok) {
          // Strictly write-once for valid legacy V2 backup: never overwrite an existing valid legacy V2 backup
          if (!isValidLegacyV2RawString(storage.getItem(V2_BACKUP_KEY))) {
            storage.setItem(V2_BACKUP_KEY, prev);
          }
        }
      } catch {
        // Never overwrite valid backup with corrupt primary
      }
    }
    storage.setItem(V2_SAVE_KEY, JSON.stringify(payload));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `V3 存档写入失败: ${String(err)}` };
  }
}

export function clearV2SaveData(storage: V2StorageLike): void {
  try {
    storage.removeItem(V2_SAVE_KEY);
    storage.removeItem(V2_BACKUP_KEY);
    storage.removeItem(V3_BACKUP_KEY);
  } catch {
    // ignore
  }
}
