import { BUILDING_ORDER, RELIC_ORDER, type BuildingId } from '../data/buildings';
import {
  ALL_ITEM_DEFINITIONS,
  EQUIPMENT_KINDS,
  LOADOUTS,
  type EquipmentKind,
  type LoadoutId,
} from '../data/items';
import { MAX_EXPEDITION_NODES } from '../data/nodes';
import { GRID_SIZE, getOccupiedCells, type Rotation } from '../data/shapes';
import type {
  ActiveCombatState,
  ExpeditionPhase,
  ExpeditionState,
  RewardOption,
} from './expedition';
import type {
  CargoBayState,
  DiscardedRecord,
  ItemInstance,
  PlacedItem,
  StagingItem,
} from './inventory';
import {
  DEFAULT_SETTINGS,
  RULES_VERSION,
  SAVE_SCHEMA_VERSION,
  createInitialProgression,
  type BaseProgression,
  type GameSettings,
} from './progression';

export const PRIMARY_SAVE_KEY = 'starline_save_v1';
export const BACKUP_SAVE_KEY = 'starline_save_backup_v1';

export interface SaveData {
  readonly schemaVersion: number;
  readonly rulesVersion: string;
  readonly savedAt: string;
  readonly progression: BaseProgression;
  readonly settings: GameSettings;
  readonly activeExpedition: ExpeditionState | null;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type LoadStatus =
  | { readonly status: 'fresh'; readonly data: SaveData }
  | { readonly status: 'loaded'; readonly data: SaveData }
  | { readonly status: 'corrupt_with_backup'; readonly backup: SaveData; readonly error: string }
  | { readonly status: 'corrupt_no_backup'; readonly data: SaveData; readonly error: string };

export interface SaveResult {
  readonly ok: boolean;
  readonly error?: string;
}

export function createFreshSaveData(): SaveData {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    rulesVersion: RULES_VERSION,
    savedAt: new Date().toISOString(),
    progression: createInitialProgression(),
    settings: { ...DEFAULT_SETTINGS },
    activeExpedition: null,
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonNegInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && Number.isFinite(v) && v >= 0;
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && Number.isFinite(v) && v > 0;
}

function isRotation(v: unknown): v is Rotation {
  return v === 0 || v === 1 || v === 2 || v === 3;
}

function isLoadoutId(v: unknown): v is LoadoutId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(LOADOUTS, v);
}

function isEquipmentKind(v: unknown): v is EquipmentKind {
  return typeof v === 'string' && (EQUIPMENT_KINDS as readonly string[]).includes(v);
}

const VALID_PHASES: readonly ExpeditionPhase[] = [
  'ROUTE_SELECT',
  'COMBAT',
  'REWARD',
  'ARRANGE',
  'SETTLEMENT',
];

function validateItemInstance(raw: unknown): raw is ItemInstance {
  if (!isPlainObject(raw)) return false;
  if (typeof raw.instanceId !== 'string' || raw.instanceId.trim().length === 0) return false;
  if (typeof raw.defId !== 'string' || !ALL_ITEM_DEFINITIONS[raw.defId]) return false;
  if (typeof raw.isBorrowed !== 'boolean') return false;
  if (!isNonNegInt(raw.value)) return false;
  if (!isNonNegInt(raw.acquiredNode)) return false;
  return true;
}

function validateCargoBay(raw: unknown): { ok: true; bay: CargoBayState } | { ok: false; error: string } {
  if (!isPlainObject(raw)) return { ok: false, error: '船舱对象缺失' };
  if (!Array.isArray(raw.placed) || !Array.isArray(raw.staging) || !Array.isArray(raw.discardedThisArrange)) {
    return { ok: false, error: '船舱数组字段缺失' };
  }

  const seenIds = new Set<string>();
  const occupiedCells = new Set<string>();

  for (const entry of raw.placed) {
    if (!isPlainObject(entry)) return { ok: false, error: '已放置物品结构损坏' };
    if (!validateItemInstance(entry.item)) return { ok: false, error: '已放置物品定义或数值无效' };
    if (seenIds.has(entry.item.instanceId)) return { ok: false, error: '船舱内存在重复物品 ID' };
    seenIds.add(entry.item.instanceId);

    if (!isNonNegInt(entry.x) || !isNonNegInt(entry.y) || !isRotation(entry.rotation)) {
      return { ok: false, error: '已放置物品坐标或旋转角度无效' };
    }
    const def = ALL_ITEM_DEFINITIONS[entry.item.defId];
    const cells = getOccupiedCells(def.shapeId, entry.rotation, entry.x, entry.y);
    for (const c of cells) {
      if (c.x < 0 || c.x >= GRID_SIZE || c.y < 0 || c.y >= GRID_SIZE) {
        return { ok: false, error: '船舱物品存在越界占格' };
      }
      const key = `${c.x},${c.y}`;
      if (occupiedCells.has(key)) {
        return { ok: false, error: '船舱物品存在重叠占格' };
      }
      occupiedCells.add(key);
    }
  }

  for (const entry of raw.staging) {
    if (!isPlainObject(entry)) return { ok: false, error: '暂存区物品结构损坏' };
    if (!validateItemInstance(entry.item)) return { ok: false, error: '暂存区物品定义无效' };
    if (seenIds.has(entry.item.instanceId)) return { ok: false, error: '暂存区与船舱存在重复物品 ID' };
    seenIds.add(entry.item.instanceId);
    if (!isRotation(entry.rotation)) return { ok: false, error: '暂存区物品旋转无效' };
  }

  for (const rec of raw.discardedThisArrange) {
    if (!isPlainObject(rec)) return { ok: false, error: '舍弃记录结构损坏' };
    if (!validateItemInstance(rec.item)) return { ok: false, error: '舍弃物品定义无效' };
    if (seenIds.has(rec.item.instanceId)) return { ok: false, error: '舍弃记录存在重复物品 ID' };
    seenIds.add(rec.item.instanceId);
    if (!isPlainObject(rec.previousLocation)) return { ok: false, error: '舍弃原位置缺失' };
    const loc = rec.previousLocation;
    if (loc.zone === 'grid') {
      if (!isNonNegInt(loc.x) || !isNonNegInt(loc.y) || !isRotation(loc.rotation)) {
        return { ok: false, error: '舍弃原网格坐标无效' };
      }
    } else if (loc.zone === 'staging') {
      if (!isRotation(loc.rotation)) return { ok: false, error: '舍弃原暂存旋转无效' };
    } else {
      return { ok: false, error: '舍弃原位置类型非法' };
    }
  }

  return {
    ok: true,
    bay: {
      placed: raw.placed as PlacedItem[],
      staging: raw.staging as StagingItem[],
      discardedThisArrange: raw.discardedThisArrange as DiscardedRecord[],
    },
  };
}

function validateActiveCombat(raw: unknown): raw is ActiveCombatState {
  if (!isPlainObject(raw)) return false;
  if (!isPlainObject(raw.routeSpec) || !isPlainObject(raw.statsSnapshot) || !isPlainObject(raw.simulation)) {
    return false;
  }
  const route = raw.routeSpec;
  if (!isPositiveInt(route.node) || (route.routeType !== 'normal' && route.routeType !== 'danger')) {
    return false;
  }
  if (!isPlainObject(route.enemy)) return false;
  if (
    typeof route.enemy.name !== 'string' ||
    !isPositiveInt(route.enemy.maxHp) ||
    !isNonNegInt(route.enemy.damagePerRound)
  ) {
    return false;
  }
  if (!isNonNegInt(route.bounty)) return false;
  if (!isNonNegInt(raw.startingHp)) return false;

  const sim = raw.simulation;
  if (sim.outcome !== 'victory' && sim.outcome !== 'defeat') return false;
  if (!Array.isArray(sim.rounds)) return false;
  if (
    !isNonNegInt(sim.roundsCount) ||
    !isNonNegInt(sim.finalPlayerHp) ||
    !isNonNegInt(sim.bountyEarned) ||
    !isNonNegInt(sim.startingPlayerShield) ||
    !isPositiveInt(sim.startingEnemyHp)
  ) {
    return false;
  }
  return true;
}

function validateRewardOption(raw: unknown): raw is RewardOption {
  if (!isPlainObject(raw)) return false;
  if (raw.kind === 'repair' && raw.optionId === 'repair') {
    return isPositiveInt(raw.healAmount);
  }
  if (
    (raw.kind === 'equipment' && raw.optionId === 'equipment') ||
    (raw.kind === 'cargo' && raw.optionId === 'cargo')
  ) {
    return validateItemInstance(raw.item);
  }
  return false;
}

function validateExpedition(raw: unknown): { ok: true; exp: ExpeditionState } | { ok: false; error: string } {
  if (!isPlainObject(raw)) return { ok: false, error: '出航状态不是有效对象' };
  if (typeof raw.expeditionId !== 'string' || raw.expeditionId.trim().length === 0) {
    return { ok: false, error: '出航 ID 缺失' };
  }
  if (raw.regionId !== undefined && raw.regionId !== 'standard' && raw.regionId !== 'abyssal') {
    return { ok: false, error: '出航星域区域标识非法' };
  }
  if (!isLoadoutId(raw.loadoutId)) return { ok: false, error: '出航舰船方案非法' };
  if (typeof raw.isTutorial !== 'boolean') return { ok: false, error: '教学标志缺失' };

  if (!isPositiveInt(raw.maxNodes) || raw.maxNodes > MAX_EXPEDITION_NODES) {
    return { ok: false, error: '最大节点数越界' };
  }
  if (!isPositiveInt(raw.currentNode) || raw.currentNode > raw.maxNodes) {
    return { ok: false, error: '当前节点数越界' };
  }
  if (!isNonNegInt(raw.completedNodes) || raw.completedNodes > raw.maxNodes) {
    return { ok: false, error: '已完成节点数越界' };
  }
  if (typeof raw.phase !== 'string' || !(VALID_PHASES as readonly string[]).includes(raw.phase)) {
    return { ok: false, error: `非法出航阶段: ${String(raw.phase)}` };
  }
  if (!isPositiveInt(raw.maxHp) || !isNonNegInt(raw.currentHp) || raw.currentHp > raw.maxHp) {
    return { ok: false, error: '耐久值无效或超出上限' };
  }
  if (!isNonNegInt(raw.accumulatedBounty)) return { ok: false, error: '累计悬赏无效' };
  if (!isNonNegInt(raw.nextInstanceSeq)) return { ok: false, error: '物品序列号无效' };

  if (!isPlainObject(raw.rngCursor)) return { ok: false, error: '随机流游标缺失' };
  if (
    typeof raw.rngCursor.seed !== 'number' ||
    !Number.isFinite(raw.rngCursor.seed) ||
    !isNonNegInt(raw.rngCursor.draws)
  ) {
    return { ok: false, error: '随机流种子或抽取位置无效' };
  }

  if (!Array.isArray(raw.recentEquipmentKinds) || !raw.recentEquipmentKinds.every(isEquipmentKind)) {
    return { ok: false, error: '最近设备抽取记录无效' };
  }
  if (
    !Array.isArray(raw.discoveredDuringRun) ||
    !raw.discoveredDuringRun.every((id) => typeof id === 'string' && Boolean(ALL_ITEM_DEFINITIONS[id]))
  ) {
    return { ok: false, error: '本局发现记录包含未知物品' };
  }

  const bayRes = validateCargoBay(raw.bay);
  if (!bayRes.ok) return bayRes;

  const phase = raw.phase as ExpeditionPhase;

  if (raw.activeCombat !== null && !validateActiveCombat(raw.activeCombat)) {
    return { ok: false, error: '当前战斗快照损坏' };
  }
  if (raw.lastCombat !== null && !validateActiveCombat(raw.lastCombat)) {
    return { ok: false, error: '历史战斗快照损坏' };
  }

  if (phase === 'COMBAT' && raw.activeCombat === null) {
    return { ok: false, error: '战斗阶段缺少战斗快照' };
  }

  if (phase === 'REWARD') {
    if (!Array.isArray(raw.pendingRewards) || raw.pendingRewards.length === 0) {
      return { ok: false, error: '奖励阶段缺少待选奖励列表' };
    }
    if (!raw.pendingRewards.every(validateRewardOption)) {
      return { ok: false, error: '待选奖励项结构损坏' };
    }
  } else if (raw.pendingRewards !== null) {
    if (!Array.isArray(raw.pendingRewards) || !raw.pendingRewards.every(validateRewardOption)) {
      return { ok: false, error: '奖励字段包含非法数据' };
    }
  }

  if (phase === 'SETTLEMENT') {
    if (raw.settlementReason !== 'safe_return' && raw.settlementReason !== 'defeat') {
      return { ok: false, error: '结算阶段缺少有效结算原因' };
    }
  } else if (raw.settlementReason !== null) {
    return { ok: false, error: '非结算阶段包含非法结算原因' };
  }

  if (phase === 'ROUTE_SELECT' && bayRes.bay.staging.length > 0) {
    return { ok: false, error: '航路选择阶段存在未清理的暂存物品' };
  }

  return { ok: true, exp: raw as unknown as ExpeditionState };
}

function validateProgression(
  raw: unknown
): { ok: true; progression: BaseProgression } | { ok: false; error: string } {
  if (!isPlainObject(raw)) return { ok: false, error: '基地进度对象缺失' };
  if (!isNonNegInt(raw.credits)) return { ok: false, error: '信用点数值非法' };
  if (!isPlainObject(raw.buildings)) return { ok: false, error: '建筑状态对象缺失' };

  const buildings = {} as Record<BuildingId, boolean>;
  for (const id of BUILDING_ORDER) {
    if (typeof raw.buildings[id] !== 'boolean') {
      return { ok: false, error: `建筑 ${id} 状态不是布尔值` };
    }
    buildings[id] = raw.buildings[id] as boolean;
  }

  if (
    !Array.isArray(raw.discoveredItems) ||
    !raw.discoveredItems.every((id) => typeof id === 'string' && Boolean(ALL_ITEM_DEFINITIONS[id]))
  ) {
    return { ok: false, error: '图鉴发现记录包含未知物品 ID' };
  }

  if (!isPlainObject(raw.relics)) return { ok: false, error: '藏品仓库结构缺失' };
  const relics: Record<string, { storedCount: number; restored: boolean }> = {};
  for (const [k, v] of Object.entries(raw.relics)) {
    if (!isPlainObject(v) || !isNonNegInt(v.storedCount) || typeof v.restored !== 'boolean') {
      return { ok: false, error: `藏品 ${k} 状态损坏` };
    }
    relics[k] = { storedCount: v.storedCount, restored: v.restored };
  }
  for (const relicId of RELIC_ORDER) {
    if (!relics[relicId]) {
      relics[relicId] = { storedCount: 0, restored: false };
    }
  }

  if (!isLoadoutId(raw.selectedLoadout)) return { ok: false, error: '默认舰船方案无效' };
  const selectedRegion =
    raw.selectedRegion === undefined
      ? 'standard'
      : raw.selectedRegion === 'standard' || raw.selectedRegion === 'abyssal'
      ? raw.selectedRegion
      : null;
  if (!selectedRegion) return { ok: false, error: '默认星域选择无效' };

  if (typeof raw.tutorialCompleted !== 'boolean') return { ok: false, error: '教学完成标志无效' };
  if (
    !Array.isArray(raw.settledExpeditionIds) ||
    !raw.settledExpeditionIds.every((s) => typeof s === 'string' && s.trim().length > 0)
  ) {
    return { ok: false, error: '已结算航次去重表损坏' };
  }

  if (
    !isNonNegInt(raw.totalExpeditions) ||
    !isNonNegInt(raw.safeReturns) ||
    !isNonNegInt(raw.deepestNodeReached) ||
    !isNonNegInt(raw.totalCreditsEarned)
  ) {
    return { ok: false, error: '基地统计数值非法' };
  }

  return {
    ok: true,
    progression: {
      credits: raw.credits,
      buildings,
      discoveredItems: Array.from(new Set(raw.discoveredItems as string[])),
      relics,
      selectedLoadout: raw.selectedLoadout,
      selectedRegion,
      tutorialCompleted: raw.tutorialCompleted,
      settledExpeditionIds: Array.from(new Set(raw.settledExpeditionIds as string[])),
      totalExpeditions: raw.totalExpeditions,
      safeReturns: raw.safeReturns,
      deepestNodeReached: raw.deepestNodeReached,
      totalCreditsEarned: raw.totalCreditsEarned,
    },
  };
}

function validateSettings(raw: unknown): { ok: true; settings: GameSettings } | { ok: false; error: string } {
  if (!isPlainObject(raw)) return { ok: false, error: '设置对象缺失' };
  if (raw.combatSpeed !== 1 && raw.combatSpeed !== 2) {
    return { ok: false, error: '战斗速度设置非法' };
  }
  if (
    typeof raw.reducedMotion !== 'boolean' ||
    typeof raw.lowQuality !== 'boolean' ||
    typeof raw.sfxMuted !== 'boolean' ||
    typeof raw.bgmMuted !== 'boolean'
  ) {
    return { ok: false, error: '设置开关字段不是布尔值' };
  }
  return {
    ok: true,
    settings: {
      combatSpeed: raw.combatSpeed,
      reducedMotion: raw.reducedMotion,
      lowQuality: raw.lowQuality,
      sfxMuted: raw.sfxMuted,
      bgmMuted: raw.bgmMuted,
    },
  };
}

/**
 * Explicit version migration pipeline.
 * Rejects future/unknown schema versions rather than silently loading incompatible data.
 */
function migrateRawSave(raw: unknown): { ok: true; migrated: Record<string, unknown> } | { ok: false; error: string } {
  if (!isPlainObject(raw)) return { ok: false, error: '存档根节点不是 JSON 对象' };
  if (!isPositiveInt(raw.schemaVersion)) {
    return { ok: false, error: '存档版本号无效' };
  }
  if (raw.schemaVersion > SAVE_SCHEMA_VERSION) {
    return { ok: false, error: `不支持更高版本存档 v${raw.schemaVersion}` };
  }
  // Future migrations (e.g. v1 -> v2) will transform cleanly here before validation
  return { ok: true, migrated: raw };
}

export function validateSaveDataDetailed(
  raw: unknown
): { ok: true; data: SaveData } | { ok: false; error: string } {
  const mig = migrateRawSave(raw);
  if (!mig.ok) return mig;
  const obj = mig.migrated;

  if (typeof obj.rulesVersion !== 'string' || obj.rulesVersion.trim().length === 0) {
    return { ok: false, error: '规则版本字段缺失' };
  }

  const progRes = validateProgression(obj.progression);
  if (!progRes.ok) return progRes;

  const setRes = validateSettings(obj.settings);
  if (!setRes.ok) return setRes;

  let activeExpedition: ExpeditionState | null = null;
  if (obj.activeExpedition !== null && obj.activeExpedition !== undefined) {
    const expRes = validateExpedition(obj.activeExpedition);
    if (!expRes.ok) return expRes;
    activeExpedition = expRes.exp;
  } else if (obj.activeExpedition === undefined) {
    return { ok: false, error: '缺少 activeExpedition 字段' };
  }

  const savedAt = typeof obj.savedAt === 'string' ? obj.savedAt : new Date().toISOString();

  return {
    ok: true,
    data: {
      schemaVersion: SAVE_SCHEMA_VERSION,
      rulesVersion: obj.rulesVersion,
      savedAt,
      progression: progRes.progression,
      settings: { ...DEFAULT_SETTINGS, ...setRes.settings },
      activeExpedition,
    },
  };
}

export function isValidSaveData(raw: unknown): raw is SaveData {
  return validateSaveDataDetailed(raw).ok;
}

function parseSaveString(rawStr: string | null): { ok: true; data: SaveData } | { ok: false; error: string } {
  if (!rawStr) {
    return { ok: false, error: '存档为空' };
  }
  try {
    const parsed: unknown = JSON.parse(rawStr);
    return validateSaveDataDetailed(parsed);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'JSON 解析失败' };
  }
}

export function loadSaveData(storage: StorageLike): LoadStatus {
  let primaryRaw: string | null = null;
  let backupRaw: string | null = null;
  try {
    primaryRaw = storage.getItem(PRIMARY_SAVE_KEY);
    backupRaw = storage.getItem(BACKUP_SAVE_KEY);
  } catch (err) {
    return {
      status: 'corrupt_no_backup',
      data: createFreshSaveData(),
      error: err instanceof Error ? err.message : '无法读取浏览器存储',
    };
  }

  if (!primaryRaw && !backupRaw) {
    return { status: 'fresh', data: createFreshSaveData() };
  }

  const primary = parseSaveString(primaryRaw);
  if (primary.ok) {
    return { status: 'loaded', data: primary.data };
  }

  const backup = parseSaveString(backupRaw);
  if (backup.ok) {
    return {
      status: 'corrupt_with_backup',
      backup: backup.data,
      error: primary.error,
    };
  }

  return {
    status: 'corrupt_no_backup',
    data: createFreshSaveData(),
    error: primary.error,
  };
}

/**
 * Atomic snapshot save with rolling last-known-good backup.
 * Validates outgoing payload AND verifies existing primary before copying to backup so a
 * semantically corrupt primary can NEVER overwrite the last valid backup.
 */
export function persistSaveData(storage: StorageLike, data: SaveData): SaveResult {
  const payload: SaveData = {
    ...data,
    schemaVersion: SAVE_SCHEMA_VERSION,
    rulesVersion: RULES_VERSION,
    savedAt: new Date().toISOString(),
  };

  const selfCheck = validateSaveDataDetailed(payload);
  if (!selfCheck.ok) {
    return { ok: false, error: `拒绝写入无效存档：${selfCheck.error}` };
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '序列化失败' };
  }

  try {
    const previousPrimary = storage.getItem(PRIMARY_SAVE_KEY);
    if (previousPrimary && parseSaveString(previousPrimary).ok) {
      storage.setItem(BACKUP_SAVE_KEY, previousPrimary);
    }
    storage.setItem(PRIMARY_SAVE_KEY, serialized);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '浏览器本地存储写入失败（空间不足或受限）',
    };
  }
}

export function clearSaveData(storage: StorageLike): SaveResult {
  try {
    storage.removeItem(PRIMARY_SAVE_KEY);
    storage.removeItem(BACKUP_SAVE_KEY);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '清除存档失败',
    };
  }
}
