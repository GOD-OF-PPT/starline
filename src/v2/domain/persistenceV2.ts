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
  V2_MAX_FUEL,
  V2_RULES_VERSION,
  V2_SAVE_KEY,
  V2_SCHEMA_VERSION,
  type V2CargoBayState,
  type V2ItemInstance,
  type V2ProfileState,
  type V2RunPhase,
  type V2RunState,
  type V2SaveData,
} from './types';

export interface V2StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type V2LoadResult =
  | { readonly status: 'fresh'; readonly data: V2SaveData }
  | { readonly status: 'loaded'; readonly data: V2SaveData }
  | { readonly status: 'corrupt_with_backup'; readonly backup: V2SaveData; readonly error: string }
  | { readonly status: 'corrupt_no_backup'; readonly data: V2SaveData; readonly error: string };

export interface V2ValidationResult {
  readonly ok: boolean;
  readonly error?: string;
}

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

function isFiniteInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v);
}

export function createInitialV2Relics(): Record<string, RelicProgress> {
  const relics: Record<string, RelicProgress> = {};
  for (const rid of V2_RELIC_ORDER) {
    relics[rid] = { storedCount: 0, restored: false };
  }
  return relics;
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
  if (!Array.isArray(bay.placed) || !Array.isArray(bay.staging) || !Array.isArray(bay.discardedThisArrange)) {
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

function validateV2Run(raw: unknown): V2ValidationResult {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'activeRun 不是对象' };
  const run = raw as Partial<V2RunState>;
  if (typeof run.runId !== 'string' || run.runId.length === 0) {
    return { ok: false, error: 'activeRun.runId 缺失' };
  }
  if (run.schemaVersion !== V2_SCHEMA_VERSION || run.rulesVersion !== V2_RULES_VERSION) {
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
  if (!isFiniteInt(run.fuel) || run.fuel < 0 || !isFiniteInt(run.maxFuel) || run.fuel > run.maxFuel || run.maxFuel > V2_MAX_FUEL) {
    return { ok: false, error: 'activeRun.fuel 越界或为负' };
  }
  if (!isFiniteInt(run.hp) || run.hp < 0 || !isFiniteInt(run.maxHp) || run.maxHp <= 0 || run.hp > run.maxHp) {
    return { ok: false, error: 'activeRun.hp 越界' };
  }
  if (!isFiniteInt(run.wallet) || run.wallet < 0) {
    return { ok: false, error: 'activeRun.wallet 为负或非法' };
  }
  if (!run.graph || typeof run.graph !== 'object' || !run.graph.nodes || typeof run.graph.nodes !== 'object') {
    return { ok: false, error: 'activeRun.graph 损坏' };
  }
  if (typeof run.currentNodeId === 'string' && !(run.currentNodeId in run.graph.nodes)) {
    return { ok: false, error: `activeRun.currentNodeId (${String(run.currentNodeId)}) 不在航图中` };
  }
  if (!run.contract || typeof run.contract !== 'object' || typeof run.contract.contractId !== 'string') {
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
  if (!Array.isArray(run.visitedNodeIds) || !Array.isArray(run.claimedEventIds) || !Array.isArray(run.transactionIds)) {
    return { ok: false, error: 'activeRun 幂等追踪数组损坏' };
  }
  if (run.phase === 'REWARD' && !run.pendingReward) {
    return { ok: false, error: 'REWARD 阶段缺少 pendingReward' };
  }
  if (run.phase === 'SETTLEMENT' && run.settlementReason !== 'safe_return' && run.settlementReason !== 'defeat') {
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

  return validateV2Bay(run.bay, run.shipId);
}

export function validateV2SaveDataDetailed(raw: unknown): V2ValidationResult {
  if (!raw || typeof raw !== 'object') return { ok: false, error: '存档根节点不是对象' };
  const d = raw as Partial<V2SaveData>;
  if (d.schemaVersion !== V2_SCHEMA_VERSION) {
    return { ok: false, error: `schemaVersion 不匹配 (${String(d.schemaVersion)})` };
  }
  if (d.rulesVersion !== V2_RULES_VERSION) {
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
  if (!Array.isArray(p.settledRunIds) || !Array.isArray(p.loadoutPresets) || !Array.isArray(p.pendingGiftQueue)) {
    return { ok: false, error: 'profile 关键数组字段损坏' };
  }
  if (d.activeRun !== null) {
    const runChk = validateV2Run(d.activeRun);
    if (!runChk.ok) return runChk;
  }
  return { ok: true };
}

function normalizeV2SaveData(raw: V2SaveData): V2SaveData {
  const relics: Record<string, RelicProgress> = { ...createInitialV2Relics() };
  for (const rid of V2_RELIC_ORDER) {
    const st = raw.profile.relics?.[rid];
    if (st) {
      relics[rid] = { storedCount: Math.max(0, st.storedCount), restored: Boolean(st.restored) };
    }
  }
  const buildings = { ...createFreshV2Profile().buildings, ...raw.profile.buildings };
  return {
    ...raw,
    profile: {
      ...raw.profile,
      buildings,
      relics,
    },
    settings: {
      ...DEFAULT_SETTINGS,
      ...raw.settings,
    },
  };
}

export function loadV2SaveData(storage: V2StorageLike): V2LoadResult {
  let primaryRaw: string | null = null;
  let backupRaw: string | null = null;
  try {
    primaryRaw = storage.getItem(V2_SAVE_KEY);
    backupRaw = storage.getItem(V2_BACKUP_KEY);
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
    const check = validateV2SaveDataDetailed(parsed);
    if (check.ok) {
      return { status: 'loaded', data: normalizeV2SaveData(parsed as V2SaveData) };
    }
    primaryError = check.error ?? primaryError;
  } catch (err) {
    primaryError = `JSON 解析失败: ${String(err)}`;
  }

  // Primary corrupt -> try backup WITHOUT ever overwriting backup!
  if (backupRaw) {
    try {
      const parsedBackup = JSON.parse(backupRaw) as unknown;
      const bCheck = validateV2SaveDataDetailed(parsedBackup);
      if (bCheck.ok) {
        return {
          status: 'corrupt_with_backup',
          backup: normalizeV2SaveData(parsedBackup as V2SaveData),
          error: primaryError,
        };
      }
    } catch {
      // backup also unreadable
    }
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
  const payload: V2SaveData = {
    ...data,
    schemaVersion: V2_SCHEMA_VERSION,
    rulesVersion: V2_RULES_VERSION,
    savedAt: new Date().toISOString(),
  };
  const check = validateV2SaveDataDetailed(payload);
  if (!check.ok) {
    return { ok: false, error: `拒绝写入非法 V2 存档: ${check.error}` };
  }

  try {
    const prev = storage.getItem(V2_SAVE_KEY);
    if (prev) {
      try {
        const parsedPrev = JSON.parse(prev) as unknown;
        if (validateV2SaveDataDetailed(parsedPrev).ok) {
          storage.setItem(V2_BACKUP_KEY, prev);
        }
      } catch {
        // Never overwrite valid backup with corrupt primary
      }
    }
    storage.setItem(V2_SAVE_KEY, JSON.stringify(payload));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `V2 存档写入失败: ${String(err)}` };
  }
}

export function clearV2SaveData(storage: V2StorageLike): void {
  try {
    storage.removeItem(V2_SAVE_KEY);
    storage.removeItem(V2_BACKUP_KEY);
  } catch {
    // ignore
  }
}
