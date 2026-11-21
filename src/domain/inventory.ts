import { getItemDef } from '../data/items';
import {
  GRID_SIZE,
  getOccupiedCells,
  nextRotation,
  type GridCoord,
  type Rotation,
} from '../data/shapes';

export interface ItemInstance {
  readonly instanceId: string;
  readonly defId: string;
  readonly isBorrowed: boolean;
  /** Sale price for cargo (computed on drop), or recycleValue for scavenged equipment; 0 if borrowed */
  readonly value: number;
  /** Node where acquired (0 for starting equipment) */
  readonly acquiredNode: number;
}

export interface PlacedItem {
  readonly item: ItemInstance;
  readonly x: number;
  readonly y: number;
  readonly rotation: Rotation;
}

export interface StagingItem {
  readonly item: ItemInstance;
  readonly rotation: Rotation;
}

export type PreviousLocation =
  | { readonly zone: 'grid'; readonly x: number; readonly y: number; readonly rotation: Rotation }
  | { readonly zone: 'staging'; readonly rotation: Rotation };

export interface DiscardedRecord {
  readonly item: ItemInstance;
  readonly previousLocation: PreviousLocation;
}

export interface CargoBayState {
  readonly placed: readonly PlacedItem[];
  readonly staging: readonly StagingItem[];
  readonly discardedThisArrange: readonly DiscardedRecord[];
}

export type PlacementFailureReason = 'locked' | 'out_of_bounds' | 'overlap';

export interface PlacementCheckResult {
  readonly valid: boolean;
  readonly reason?: PlacementFailureReason;
  readonly cells: readonly GridCoord[];
  readonly conflictCells: readonly GridCoord[];
}

export function createEmptyCargoBay(): CargoBayState {
  return {
    placed: [],
    staging: [],
    discardedThisArrange: [],
  };
}

export function getPlacedItemCells(entry: PlacedItem): GridCoord[] {
  const def = getItemDef(entry.item.defId);
  return getOccupiedCells(def.shapeId, entry.rotation, entry.x, entry.y);
}

/**
 * Validate whether an item can be placed at (x, y) with given rotation.
 * Optionally ignores an existing placed item by instanceId (when moving/rotating in place).
 */
export function checkPlacement(
  bay: CargoBayState,
  defId: string,
  x: number,
  y: number,
  rotation: Rotation,
  ignoreInstanceId?: string,
  locked = false
): PlacementCheckResult {
  const def = getItemDef(defId);
  const cells = getOccupiedCells(def.shapeId, rotation, x, y);

  if (locked) {
    return { valid: false, reason: 'locked', cells, conflictCells: cells };
  }

  const outOfBounds: GridCoord[] = [];
  for (const c of cells) {
    if (c.x < 0 || c.x >= GRID_SIZE || c.y < 0 || c.y >= GRID_SIZE) {
      outOfBounds.push(c);
    }
  }
  if (outOfBounds.length > 0) {
    return { valid: false, reason: 'out_of_bounds', cells, conflictCells: outOfBounds };
  }

  const occupied = new Set<string>();
  for (const existing of bay.placed) {
    if (existing.item.instanceId === ignoreInstanceId) continue;
    for (const c of getPlacedItemCells(existing)) {
      occupied.add(`${c.x},${c.y}`);
    }
  }

  const overlaps: GridCoord[] = [];
  for (const c of cells) {
    if (occupied.has(`${c.x},${c.y}`)) {
      overlaps.push(c);
    }
  }
  if (overlaps.length > 0) {
    return { valid: false, reason: 'overlap', cells, conflictCells: overlaps };
  }

  return { valid: true, cells, conflictCells: [] };
}

export function findItemAtCell(bay: CargoBayState, x: number, y: number): PlacedItem | null {
  for (const entry of bay.placed) {
    const cells = getPlacedItemCells(entry);
    if (cells.some((c) => c.x === x && c.y === y)) {
      return entry;
    }
  }
  return null;
}

export function placeFromStaging(
  bay: CargoBayState,
  instanceId: string,
  x: number,
  y: number,
  rotation?: Rotation,
  locked = false
): { readonly ok: boolean; readonly bay: CargoBayState; readonly reason?: PlacementFailureReason } {
  const stagingEntry = bay.staging.find((s) => s.item.instanceId === instanceId);
  if (!stagingEntry) {
    return { ok: false, bay };
  }
  const rot = rotation ?? stagingEntry.rotation;
  const check = checkPlacement(bay, stagingEntry.item.defId, x, y, rot, undefined, locked);
  if (!check.valid) {
    return { ok: false, bay, reason: check.reason };
  }
  return {
    ok: true,
    bay: {
      ...bay,
      staging: bay.staging.filter((s) => s.item.instanceId !== instanceId),
      placed: [...bay.placed, { item: stagingEntry.item, x, y, rotation: rot }],
    },
  };
}

export function movePlacedItem(
  bay: CargoBayState,
  instanceId: string,
  x: number,
  y: number,
  rotation?: Rotation,
  locked = false
): { readonly ok: boolean; readonly bay: CargoBayState; readonly reason?: PlacementFailureReason } {
  const existing = bay.placed.find((p) => p.item.instanceId === instanceId);
  if (!existing) {
    return { ok: false, bay };
  }
  const rot = rotation ?? existing.rotation;
  const check = checkPlacement(bay, existing.item.defId, x, y, rot, instanceId, locked);
  if (!check.valid) {
    return { ok: false, bay, reason: check.reason };
  }
  return {
    ok: true,
    bay: {
      ...bay,
      placed: bay.placed.map((p) =>
        p.item.instanceId === instanceId ? { ...p, x, y, rotation: rot } : p
      ),
    },
  };
}

export function movePlacedToStaging(
  bay: CargoBayState,
  instanceId: string,
  locked = false
): { readonly ok: boolean; readonly bay: CargoBayState; readonly reason?: PlacementFailureReason } {
  if (locked) {
    return { ok: false, bay, reason: 'locked' };
  }
  const existing = bay.placed.find((p) => p.item.instanceId === instanceId);
  if (!existing) {
    return { ok: false, bay };
  }
  return {
    ok: true,
    bay: {
      ...bay,
      placed: bay.placed.filter((p) => p.item.instanceId !== instanceId),
      staging: [...bay.staging, { item: existing.item, rotation: existing.rotation }],
    },
  };
}

export function rotateStagingItem(
  bay: CargoBayState,
  instanceId: string,
  locked = false
): { readonly ok: boolean; readonly bay: CargoBayState; readonly reason?: PlacementFailureReason } {
  if (locked) {
    return { ok: false, bay, reason: 'locked' };
  }
  const existing = bay.staging.find((s) => s.item.instanceId === instanceId);
  if (!existing) {
    return { ok: false, bay };
  }
  return {
    ok: true,
    bay: {
      ...bay,
      staging: bay.staging.map((s) =>
        s.item.instanceId === instanceId ? { ...s, rotation: nextRotation(s.rotation) } : s
      ),
    },
  };
}

/**
 * Rotate a placed item clockwise in place; if rotating at (x, y) goes out of bounds near edges,
 * attempts minimal shift within bounds without overlapping other items.
 */
export function rotatePlacedItemInPlace(
  bay: CargoBayState,
  instanceId: string,
  locked = false
): { readonly ok: boolean; readonly bay: CargoBayState; readonly reason?: PlacementFailureReason } {
  if (locked) {
    return { ok: false, bay, reason: 'locked' };
  }
  const existing = bay.placed.find((p) => p.item.instanceId === instanceId);
  if (!existing) {
    return { ok: false, bay };
  }
  const rot = nextRotation(existing.rotation);
  const offsets: readonly GridCoord[] = [
    { x: 0, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
    { x: -1, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -2, y: 0 },
    { x: 0, y: -2 },
  ];

  let lastReason: PlacementFailureReason = 'overlap';
  for (const offset of offsets) {
    const nx = existing.x + offset.x;
    const ny = existing.y + offset.y;
    const check = checkPlacement(bay, existing.item.defId, nx, ny, rot, instanceId, locked);
    if (check.valid) {
      return {
        ok: true,
        bay: {
          ...bay,
          placed: bay.placed.map((p) =>
            p.item.instanceId === instanceId ? { ...p, x: nx, y: ny, rotation: rot } : p
          ),
        },
      };
    }
    if (offset.x === 0 && offset.y === 0 && check.reason) {
      lastReason = check.reason;
    }
  }
  return { ok: false, bay, reason: lastReason };
}

export function discardItem(
  bay: CargoBayState,
  instanceId: string,
  locked = false
): { readonly ok: boolean; readonly bay: CargoBayState; readonly reason?: PlacementFailureReason } {
  if (locked) {
    return { ok: false, bay, reason: 'locked' };
  }
  const placedEntry = bay.placed.find((p) => p.item.instanceId === instanceId);
  if (placedEntry) {
    const record: DiscardedRecord = {
      item: placedEntry.item,
      previousLocation: {
        zone: 'grid',
        x: placedEntry.x,
        y: placedEntry.y,
        rotation: placedEntry.rotation,
      },
    };
    return {
      ok: true,
      bay: {
        ...bay,
        placed: bay.placed.filter((p) => p.item.instanceId !== instanceId),
        discardedThisArrange: [...bay.discardedThisArrange, record],
      },
    };
  }

  const stagingEntry = bay.staging.find((s) => s.item.instanceId === instanceId);
  if (stagingEntry) {
    const record: DiscardedRecord = {
      item: stagingEntry.item,
      previousLocation: {
        zone: 'staging',
        rotation: stagingEntry.rotation,
      },
    };
    return {
      ok: true,
      bay: {
        ...bay,
        staging: bay.staging.filter((s) => s.item.instanceId !== instanceId),
        discardedThisArrange: [...bay.discardedThisArrange, record],
      },
    };
  }

  return { ok: false, bay };
}

/**
 * Undo a discard made during the current arrange phase.
 * Restores exact instanceId, shape, rotation, and original coordinates if free,
 * or restores to staging if original grid cells are now occupied.
 */
export function undoDiscard(
  bay: CargoBayState,
  instanceId?: string,
  locked = false
): {
  readonly ok: boolean;
  readonly bay: CargoBayState;
  readonly restoredTo?: 'grid' | 'staging';
  readonly reason?: PlacementFailureReason;
} {
  if (locked) {
    return { ok: false, bay, reason: 'locked' };
  }
  if (bay.discardedThisArrange.length === 0) {
    return { ok: false, bay };
  }

  const idx = instanceId
    ? bay.discardedThisArrange.findIndex((d) => d.item.instanceId === instanceId)
    : bay.discardedThisArrange.length - 1;

  if (idx < 0) {
    return { ok: false, bay };
  }

  const record = bay.discardedThisArrange[idx];
  const remainingDiscards = bay.discardedThisArrange.filter((_, i) => i !== idx);

  if (record.previousLocation.zone === 'grid') {
    const { x, y, rotation } = record.previousLocation;
    const check = checkPlacement(bay, record.item.defId, x, y, rotation, undefined, false);
    if (check.valid) {
      return {
        ok: true,
        restoredTo: 'grid',
        bay: {
          ...bay,
          placed: [...bay.placed, { item: record.item, x, y, rotation }],
          discardedThisArrange: remainingDiscards,
        },
      };
    }
    return {
      ok: true,
      restoredTo: 'staging',
      bay: {
        ...bay,
        staging: [...bay.staging, { item: record.item, rotation }],
        discardedThisArrange: remainingDiscards,
      },
    };
  }

  return {
    ok: true,
    restoredTo: 'staging',
    bay: {
      ...bay,
      staging: [...bay.staging, { item: record.item, rotation: record.previousLocation.rotation }],
      discardedThisArrange: remainingDiscards,
    },
  };
}

export function commitDiscards(bay: CargoBayState): CargoBayState {
  if (bay.discardedThisArrange.length === 0) return bay;
  return {
    ...bay,
    discardedThisArrange: [],
  };
}

/**
 * Find first valid grid placement (across all 4 rotations) for a given defId.
 * Useful for quick tap-place hints and deterministic strategy simulations.
 */
export function findFirstValidPlacement(
  bay: CargoBayState,
  defId: string,
  preferredRotation: Rotation = 0
): { readonly x: number; readonly y: number; readonly rotation: Rotation } | null {
  const rotations: Rotation[] = [
    preferredRotation,
    (((preferredRotation + 1) % 4) as Rotation),
    (((preferredRotation + 2) % 4) as Rotation),
    (((preferredRotation + 3) % 4) as Rotation),
  ];
  for (const rotation of rotations) {
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const check = checkPlacement(bay, defId, x, y, rotation);
        if (check.valid) {
          return { x, y, rotation };
        }
      }
    }
  }
  return null;
}
