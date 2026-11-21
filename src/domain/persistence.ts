import type { ExpeditionState } from './expedition';
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

export function isValidSaveData(raw: unknown): raw is SaveData {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.schemaVersion !== 'number' || obj.schemaVersion > SAVE_SCHEMA_VERSION) {
    return false;
  }
  if (typeof obj.rulesVersion !== 'string') return false;
  if (!obj.progression || typeof obj.progression !== 'object') return false;
  const prog = obj.progression as Record<string, unknown>;
  if (typeof prog.credits !== 'number' || !Number.isFinite(prog.credits) || prog.credits < 0) {
    return false;
  }
  if (!prog.buildings || typeof prog.buildings !== 'object') return false;
  if (!Array.isArray(prog.discoveredItems)) return false;
  if (!obj.settings || typeof obj.settings !== 'object') return false;
  return true;
}

function parseSaveString(rawStr: string | null): { ok: true; data: SaveData } | { ok: false; error: string } {
  if (!rawStr) {
    return { ok: false, error: 'empty' };
  }
  try {
    const parsed: unknown = JSON.parse(rawStr);
    if (!isValidSaveData(parsed)) {
      return { ok: false, error: '存档结构损坏或版本不兼容' };
    }
    // Fill any missing defaults cleanly across patch versions
    const normalized: SaveData = {
      ...parsed,
      settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
      progression: {
        ...createInitialProgression(),
        ...parsed.progression,
        buildings: {
          ...createInitialProgression().buildings,
          ...parsed.progression.buildings,
        },
        relics: {
          ...createInitialProgression().relics,
          ...(parsed.progression.relics ?? {}),
        },
      },
    };
    return { ok: true, data: normalized };
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
 * Never claims success if browser storage throws (quota exceeded, private mode, etc.).
 */
export function persistSaveData(storage: StorageLike, data: SaveData): SaveResult {
  const payload: SaveData = {
    ...data,
    schemaVersion: SAVE_SCHEMA_VERSION,
    rulesVersion: RULES_VERSION,
    savedAt: new Date().toISOString(),
  };

  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '序列化失败' };
  }

  try {
    const previousValid = storage.getItem(PRIMARY_SAVE_KEY);
    if (previousValid && parseSaveString(previousValid).ok) {
      storage.setItem(BACKUP_SAVE_KEY, previousValid);
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
