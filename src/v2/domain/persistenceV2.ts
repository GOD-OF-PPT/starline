import { DEFAULT_SETTINGS, type RelicProgress } from '../../domain/progression';
import { V2_CREW_ORDER, type V2CrewId } from '../data/crew';
import {
  V2_ALL_EQUIPMENT_KINDS,
  V2_INITIAL_BLUEPRINTS,
  V2_WAREHOUSE_CAPACITY,
  type V2EquipmentKind,
} from '../data/equipment';
import { V2_FACILITY_ORDER, V2_RELIC_ORDER, type V2FacilityId } from '../data/facilities';
import { V2_SHIPS, V2_SHIP_ORDER, isCellValidForShip, type V2ShipId } from '../data/ships';
import { getV2OccupiedCells, type V2Rotation } from '../data/shapes';
import { getAnyV2ItemDef } from './itemCatalog';
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
  type V2CargoBayState,
  type V2ItemInstance,
  type V2ProfileState,
  type V2RunPhase,
  type V2RunState,
  type V2SaveData,
  type V3CampaignState,
  type V3CareerStats,
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
const VALID_ARCHETYPES = new Set(['laser', 'heavy', 'hangar', 'counter']);
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

function isFiniteInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v);
}

function sanitizeNonNegInt(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
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
  const restoredRelics = Object.values(p.relics ?? {}).filter((r) => Boolean(r?.restored)).length;
  const stdTypes = p.completedContractTypes?.length ?? 0;

  if (!p.tutorialCompleted && (p.totalRuns ?? 0) === 0 && !p.buildings?.workbench) {
    return createInitialV3CampaignState();
  }

  if (
    stdTypes >= 3 &&
    (Boolean(p.buildings?.drydock_tier2) || restoredRelics >= 2 || (p.deepestLayerReached ?? 0) >= 6)
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
    (Boolean(p.buildings?.research_lab) && (p.deepestLayerReached ?? 0) >= 4) ||
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
  const wins = Math.min(p.totalRuns ?? 0, p.completedContractIds?.length ?? 0);
  return {
    ...createInitialV3CareerStats(),
    totalWins: wins,
    totalSafeReturns: wins,
    totalCreditsEarned: Math.max(0, p.credits ?? 0),
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
  if (!raw || typeof raw !== 'object') return { ok: false, error: `${label} 不是对象` };
  const item = raw as Partial<V2ItemInstance>;
  if (typeof item.instanceId !== 'string' || item.instanceId.length === 0) {
    return { ok: false, error: `${label}.instanceId 无效` };
  }
  if (typeof item.definitionId !== 'string' || !getAnyV2ItemDef(item.definitionId)) {
    return { ok: false, error: `${label}.definitionId 未知: ${String(item.definitionId)}` };
  }
  const def = getAnyV2ItemDef(item.definitionId)!;
  if (!VALID_ORIGINS.has(String(item.origin))) {
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
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'activeRun.bay 缺失' };
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

  for (let i = 0; i < bay.placed.length; i++) {
    const p = bay.placed[i];
    if (!p || typeof p !== 'object') return { ok: false, error: `bay.placed[${i}] 无效` };
    const itemCheck = validateV2Item(p.item, `bay.placed[${i}].item`);
    if (!itemCheck.ok) return itemCheck;
    if (seenIds.has(p.item.instanceId)) {
      return { ok: false, error: `重复的物品实例 ID: ${p.item.instanceId}` };
    }
    seenIds.add(p.item.instanceId);

    if (!isFiniteInt(p.x) || !isFiniteInt(p.y) || ![0, 1, 2, 3].includes(p.rotation)) {
      return { ok: false, error: `bay.placed[${i}] 坐标或旋转非法` };
    }
    const def = getAnyV2ItemDef(p.item.definitionId)!;
    const cells = getV2OccupiedCells(def.shapeId, p.x, p.y, p.rotation as V2Rotation);
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

  for (let i = 0; i < bay.staging.length; i++) {
    const s = bay.staging[i];
    if (!s || typeof s !== 'object') return { ok: false, error: `bay.staging[${i}] 无效` };
    const itemCheck = validateV2Item(s.item, `bay.staging[${i}].item`);
    if (!itemCheck.ok) return itemCheck;
    if (seenIds.has(s.item.instanceId)) {
      return { ok: false, error: `重复的暂存实例 ID: ${s.item.instanceId}` };
    }
    seenIds.add(s.item.instanceId);
    if (![0, 1, 2, 3].includes(s.rotation)) {
      return { ok: false, error: `bay.staging[${i}].rotation 非法` };
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
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'activeRun 不是对象' };
  const run = raw as Partial<V2RunState>;
  if (typeof run.runId !== 'string' || run.runId.length === 0) {
    return { ok: false, error: 'activeRun.runId 缺失' };
  }
  if (run.schemaVersion !== expectedSchema || run.rulesVersion !== expectedRules) {
    return { ok: false, error: 'activeRun 版本号不匹配' };
  }
  if (!run.shipId || !(run.shipId in V2_SHIPS)) {
    return { ok: false, error: 'activeRun.shipId 非法' };
  }
  if (run.crewId !== null && !V2_CREW_ORDER.includes(run.crewId as V2CrewId)) {
    return { ok: false, error: 'activeRun.crewId 非法' };
  }
  if (!VALID_ARCHETYPES.has(String(run.primaryArchetype))) {
    return { ok: false, error: 'activeRun.primaryArchetype 非法' };
  }
  if (!VALID_PHASES.has(run.phase as V2RunPhase)) {
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
  if (
    !run.graph ||
    typeof run.graph !== 'object' ||
    !run.graph.nodes ||
    typeof run.graph.nodes !== 'object'
  ) {
    return { ok: false, error: 'activeRun.graph 损坏' };
  }
  if (typeof run.currentNodeId === 'string' && !(run.currentNodeId in run.graph.nodes)) {
    return {
      ok: false,
      error: `activeRun.currentNodeId (${String(run.currentNodeId)}) 不在航图中`,
    };
  }
  if (
    !run.contract ||
    typeof run.contract !== 'object' ||
    typeof run.contract.contractId !== 'string'
  ) {
    return { ok: false, error: 'activeRun.contract 损坏' };
  }
  if (!run.rngStreams || typeof run.rngStreams !== 'object') {
    return { ok: false, error: 'activeRun.rngStreams 缺失' };
  }
  for (const key of ['map', 'enemies', 'shop', 'events', 'rewards'] as const) {
    const cur = run.rngStreams[key];
    if (!cur || !isFiniteInt(cur.seed) || !isFiniteInt(cur.draws) || cur.draws < 0) {
      return { ok: false, error: `activeRun.rngStreams.${key} 游标非法` };
    }
  }
  if (
    !Array.isArray(run.visitedNodeIds) ||
    !Array.isArray(run.claimedEventIds) ||
    !Array.isArray(run.transactionIds)
  ) {
    return { ok: false, error: 'activeRun 幂等追踪数组损坏' };
  }
  if (run.phase === 'REWARD' && !run.pendingReward) {
    return { ok: false, error: 'REWARD 阶段缺少 pendingReward' };
  }
  if (
    run.phase === 'SETTLEMENT' &&
    run.settlementReason !== 'safe_return' &&
    run.settlementReason !== 'defeat'
  ) {
    return { ok: false, error: 'SETTLEMENT 阶段缺少合法 settlementReason' };
  }
  if (run.activeCombat?.pendingDecision) {
    const pd = run.activeCombat.pendingDecision;
    if (
      typeof pd.decisionId !== 'string' ||
      pd.decisionId.length === 0 ||
      (pd.chosen !== null &&
        pd.chosen !== 'normal' &&
        pd.chosen !== 'overload' &&
        pd.chosen !== 'emergency_defense')
    ) {
      return { ok: false, error: 'activeCombat.pendingDecision 数据损坏' };
    }
  }

  if (requireV3Fields) {
    if (!run.sectorId || !VALID_SECTORS.has(run.sectorId)) {
      return { ok: false, error: `activeRun.sectorId 非法: ${String(run.sectorId)}` };
    }
    if (!Array.isArray(run.recentEquipmentKinds) || !Array.isArray(run.usedEventIds)) {
      return { ok: false, error: 'activeRun V3 数组字段损坏' };
    }
    if (
      !isFiniteInt(run.tacticalChargesMax) ||
      run.tacticalChargesMax < 0 ||
      !isFiniteInt(run.tacticalChargesUsed) ||
      run.tacticalChargesUsed < 0
    ) {
      return { ok: false, error: 'activeRun 战术充能字段非法' };
    }
    if (!isFiniteInt(run.salvagePartsEarned) || run.salvagePartsEarned < 0) {
      return { ok: false, error: 'activeRun.salvagePartsEarned 非法' };
    }
    if (
      run.endlessThreat !== undefined &&
      (!isFiniteInt(run.endlessThreat) || run.endlessThreat < 0 || run.endlessThreat > 10)
    ) {
      return { ok: false, error: 'activeRun.endlessThreat 越界或非法' };
    }
  }

  return validateV2Bay(run.bay, run.shipId);
}

function validateSaveDataCore(
  raw: unknown,
  expectedSchema: number,
  expectedRules: string,
  requireV3Fields: boolean
): V2ValidationResult {
  if (!raw || typeof raw !== 'object') return { ok: false, error: '存档根节点不是对象' };
  const d = raw as Partial<V2SaveData>;
  if (d.schemaVersion !== expectedSchema) {
    return { ok: false, error: `schemaVersion 不匹配 (${String(d.schemaVersion)})` };
  }
  if (d.rulesVersion !== expectedRules) {
    return { ok: false, error: `rulesVersion 不匹配 (${String(d.rulesVersion)})` };
  }
  if (!d.profile || typeof d.profile !== 'object') {
    return { ok: false, error: 'profile 缺失' };
  }
  const p = d.profile as Partial<V2ProfileState>;
  if (!isFiniteInt(p.credits) || p.credits < 0) {
    return { ok: false, error: 'profile.credits 非法' };
  }
  if (!p.buildings || typeof p.buildings !== 'object') {
    return { ok: false, error: 'profile.buildings 缺失' };
  }
  if (!Array.isArray(p.unlockedShips) || p.unlockedShips.length === 0) {
    return { ok: false, error: 'profile.unlockedShips 缺失' };
  }
  for (const s of p.unlockedShips) {
    if (!V2_SHIP_ORDER.includes(s)) return { ok: false, error: `未知舰船: ${String(s)}` };
  }
  if (!Array.isArray(p.blueprints)) {
    return { ok: false, error: 'profile.blueprints 缺失' };
  }
  const bpSet = new Set<string>();
  for (const bp of p.blueprints) {
    if (!V2_ALL_EQUIPMENT_KINDS.includes(bp as V2EquipmentKind) || bpSet.has(bp)) {
      return { ok: false, error: `非法或重复蓝图: ${String(bp)}` };
    }
    bpSet.add(bp);
  }
  if (!Array.isArray(p.equipmentWarehouse) || p.equipmentWarehouse.length > V2_WAREHOUSE_CAPACITY) {
    return { ok: false, error: 'profile.equipmentWarehouse 非法或超容量' };
  }
  const whIds = new Set<string>();
  for (let i = 0; i < p.equipmentWarehouse.length; i++) {
    const it = p.equipmentWarehouse[i];
    const chk = validateV2Item(it, `equipmentWarehouse[${i}]`);
    if (!chk.ok) return chk;
    if (it.origin === 'loan' || it.origin === 'mission') {
      return { ok: false, error: '借用或任务物不允许进入设备库' };
    }
    if (whIds.has(it.instanceId)) {
      return { ok: false, error: `设备库存在重复实例 ID: ${it.instanceId}` };
    }
    whIds.add(it.instanceId);
  }
  if (
    !Array.isArray(p.settledRunIds) ||
    !Array.isArray(p.loadoutPresets) ||
    !Array.isArray(p.pendingGiftQueue)
  ) {
    return { ok: false, error: 'profile 关键数组字段损坏' };
  }

  if (requireV3Fields) {
    if (!isFiniteInt(p.salvageParts) || p.salvageParts < 0) {
      return { ok: false, error: 'profile.salvageParts 非法' };
    }
    if (!p.facilityTiers || typeof p.facilityTiers !== 'object' || Array.isArray(p.facilityTiers)) {
      return { ok: false, error: 'profile.facilityTiers 缺失' };
    }
    for (const [facKey, tierVal] of Object.entries(p.facilityTiers)) {
      if (!isFiniteInt(tierVal) || tierVal < 0 || tierVal > 3) {
        return { ok: false, error: `profile.facilityTiers.${facKey} 越界或非法` };
      }
    }
    if (!p.campaign || typeof p.campaign !== 'object') {
      return { ok: false, error: 'profile.campaign 缺失' };
    }
    if (!VALID_ACTS.has(p.campaign.currentAct)) {
      return { ok: false, error: `profile.campaign.currentAct 非法: ${String(p.campaign.currentAct)}` };
    }
    if (
      !Array.isArray(p.campaign.unlockedSectors) ||
      p.campaign.unlockedSectors.length === 0 ||
      !p.campaign.unlockedSectors.every((s) => VALID_SECTORS.has(s))
    ) {
      return { ok: false, error: 'profile.campaign.unlockedSectors 非法' };
    }
    if (
      !Array.isArray(p.campaign.completedMilestones) ||
      !Array.isArray(p.campaign.defeatedBossIds) ||
      !Array.isArray(p.campaign.readCommsIds) ||
      !Array.isArray(p.campaign.endingsUnlocked)
    ) {
      return { ok: false, error: 'profile.campaign 数组字段损坏' };
    }
    if (!p.campaign.endingsUnlocked.every((e) => VALID_ENDINGS.has(e))) {
      return { ok: false, error: 'profile.campaign.endingsUnlocked 包含非法结局 ID' };
    }
    if (
      !isFiniteInt(p.campaign.maxEndlessThreat) ||
      p.campaign.maxEndlessThreat < 0 ||
      p.campaign.maxEndlessThreat > 10
    ) {
      return { ok: false, error: 'profile.campaign.maxEndlessThreat 越界或非法' };
    }
    if (!p.factionRep || typeof p.factionRep !== 'object') {
      return { ok: false, error: 'profile.factionRep 缺失' };
    }
    if (!p.crewMastery || typeof p.crewMastery !== 'object') {
      return { ok: false, error: 'profile.crewMastery 缺失' };
    }
    if (
      !Array.isArray(p.achievementsUnlocked) ||
      !Array.isArray(p.defeatedEnemyKinds) ||
      !Array.isArray(p.runHistory)
    ) {
      return { ok: false, error: 'profile V3 追踪数组损坏' };
    }
    if (!p.career || typeof p.career !== 'object' || Array.isArray(p.career)) {
      return { ok: false, error: 'profile.career 损坏' };
    }
    for (const cKey of V3_CAREER_KEYS) {
      const cVal = p.career[cKey];
      if (!isFiniteInt(cVal) || cVal < 0) {
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
  const srcProfile = src.profile;

  const buildings: Record<V2FacilityId, boolean> = {
    ...fresh.buildings,
    ...srcProfile.buildings,
  };
  const relics: Record<string, RelicProgress> = { ...createInitialV2Relics() };
  for (const rid of V2_RELIC_ORDER) {
    const st = srcProfile.relics?.[rid];
    if (st) {
      relics[rid] = { storedCount: Math.max(0, st.storedCount), restored: Boolean(st.restored) };
    }
  }

  const discoveredItems = Array.isArray(srcProfile.discoveredItems)
    ? [...srcProfile.discoveredItems]
    : [];
  const seenItems = Array.from(
    new Set([
      ...(Array.isArray(srcProfile.seenItems) ? srcProfile.seenItems : []),
      ...discoveredItems,
    ])
  );

  const migratedProfile: V2ProfileState = {
    ...fresh,
    ...srcProfile,
    buildings,
    relics,
    discoveredItems,
    seenItems,
    salvageParts: 0,
    facilityTiers: createInitialV3FacilityTiers(buildings),
    campaign: inferV3CampaignFromV2Profile({
      tutorialCompleted: Boolean(srcProfile.tutorialCompleted),
      totalRuns: srcProfile.totalRuns ?? 0,
      buildings,
      completedContractTypes: srcProfile.completedContractTypes ?? [],
      deepestLayerReached: srcProfile.deepestLayerReached ?? 0,
      relics,
    }),
    factionRep: createInitialV3FactionRep(),
    crewMastery: createInitialV3CrewMastery(),
    achievementsUnlocked: [],
    defeatedEnemyKinds: [],
    runHistory: [],
    career: inferV3CareerFromV2Profile({
      totalRuns: srcProfile.totalRuns ?? 0,
      completedContractIds: srcProfile.completedContractIds ?? [],
      credits: srcProfile.credits ?? 0,
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
    savedAt: src.savedAt || new Date().toISOString(),
    profile: migratedProfile,
    activeRun: migratedRun,
    settings: {
      ...DEFAULT_SETTINGS,
      ...src.settings,
    },
  };

  const finalCheck = validateV2SaveDataDetailed(migrated);
  if (!finalCheck.ok) {
    return { ok: false, error: `V2->V3 迁移后校验失败: ${finalCheck.error}` };
  }
  return { ok: true, data: normalizeV2SaveData(migrated) };
}

export function normalizeV2SaveData(raw: V2SaveData): V2SaveData {
  const relics: Record<string, RelicProgress> = { ...createInitialV2Relics() };
  for (const rid of V2_RELIC_ORDER) {
    const st = raw.profile.relics?.[rid];
    if (st) {
      relics[rid] = { storedCount: Math.max(0, st.storedCount), restored: Boolean(st.restored) };
    }
  }
  const fresh = createFreshV2Profile();
  const buildings = { ...fresh.buildings, ...raw.profile.buildings };
  const facilityTiers: Record<string, number> = {
    ...createInitialV3FacilityTiers(buildings),
  };
  const rawTiers = raw.profile.facilityTiers ?? {};
  for (const [facKey, tierVal] of Object.entries(rawTiers)) {
    if (typeof tierVal === 'number' && Number.isFinite(tierVal)) {
      facilityTiers[facKey] = Math.max(0, Math.min(3, Math.floor(tierVal)));
    } else if (!(facKey in facilityTiers)) {
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
  for (const fid of ALL_FACTIONS) {
    const v = raw.profile.factionRep?.[fid];
    if (typeof v === 'number' && Number.isFinite(v)) {
      factionRep[fid] = Math.max(0, Math.min(300, Math.floor(v)));
    }
  }

  const crewMastery: Record<V2CrewId, number> = { ...createInitialV3CrewMastery() };
  for (const cid of V2_CREW_ORDER) {
    const v = raw.profile.crewMastery?.[cid];
    if (typeof v === 'number' && Number.isFinite(v)) {
      crewMastery[cid] = Math.max(0, Math.min(2, Math.floor(v)));
    }
  }

  const discoveredItems = Array.from(new Set(raw.profile.discoveredItems ?? []));
  const seenItems = Array.from(new Set([...(raw.profile.seenItems ?? []), ...discoveredItems]));
  const runHistory = (raw.profile.runHistory ?? []).slice(0, V3_MAX_RUN_HISTORY);

  const baseCampaign = createInitialV3CampaignState();
  const rawCampaign = raw.profile.campaign ?? baseCampaign;
  const rawMaxThreat = rawCampaign.maxEndlessThreat;
  const maxEndlessThreat =
    typeof rawMaxThreat === 'number' && Number.isFinite(rawMaxThreat)
      ? Math.max(0, Math.min(10, Math.floor(rawMaxThreat)))
      : 0;
  const endingsUnlocked = Array.from(
    new Set(
      (Array.isArray(rawCampaign.endingsUnlocked) ? rawCampaign.endingsUnlocked : []).filter(
        (e): e is EndingId => VALID_ENDINGS.has(e)
      )
    )
  );

  const rawCareer = raw.profile.career ?? createInitialV3CareerStats();
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

  const activeRun: V2RunState | null =
    raw.activeRun === null
      ? null
      : raw.activeRun.endlessThreat !== undefined
      ? {
          ...raw.activeRun,
          endlessThreat:
            typeof raw.activeRun.endlessThreat === 'number' &&
            Number.isFinite(raw.activeRun.endlessThreat)
              ? Math.max(0, Math.min(10, Math.floor(raw.activeRun.endlessThreat)))
              : 0,
        }
      : raw.activeRun;

  return {
    ...raw,
    profile: {
      ...raw.profile,
      buildings,
      relics,
      discoveredItems,
      seenItems,
      facilityTiers,
      factionRep,
      crewMastery,
      runHistory,
      campaign: {
        ...baseCampaign,
        ...rawCampaign,
        maxEndlessThreat,
        endingsUnlocked,
      },
      career,
    },
    activeRun,
    settings: {
      ...DEFAULT_SETTINGS,
      ...raw.settings,
    },
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
      parsedBackup &&
      typeof parsedBackup === 'object' &&
      (parsedBackup as { schemaVersion?: unknown }).schemaVersion === V2_LEGACY_SCHEMA_VERSION
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
      parsed &&
      typeof parsed === 'object' &&
      (parsed as { schemaVersion?: unknown }).schemaVersion === V2_LEGACY_SCHEMA_VERSION
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
  const rawPayload: V2SaveData = {
    ...data,
    schemaVersion: V2_SCHEMA_VERSION,
    rulesVersion: V2_RULES_VERSION,
    savedAt: new Date().toISOString(),
  };
  const payload =
    rawPayload.profile && typeof rawPayload.profile === 'object'
      ? normalizeV2SaveData(rawPayload)
      : rawPayload;
  const check = validateV2SaveDataDetailed(payload);
  if (!check.ok) {
    return { ok: false, error: `拒绝写入非法 V3 存档: ${check.error}` };
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
