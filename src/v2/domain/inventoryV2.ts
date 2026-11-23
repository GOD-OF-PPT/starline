import {
  V2_SHAPES,
  getV2OccupiedCells,
  nextV2Rotation,
  type V2GridCoord,
  type V2Rotation,
  type V2ShapeId,
} from '../data/shapes';
import {
  V2_SHIPS,
  isCellDisabledForShip,
  isCellPowerCellForShip,
  isCellValidForShip,
  type V2ShipId,
} from '../data/ships';
import { getAnyV2ItemDef } from './itemCatalog';
import type {
  V2CargoBayState,
  V2DiscardedRecord,
  V2ItemInstance,
  V2PlacedItem,
  V2StagingItem,
} from './types';

export interface V2PlacementValidation {
  readonly valid: boolean;
  readonly reason?: 'out_of_bounds' | 'disabled_cell' | 'overlap';
  readonly cells: readonly V2GridCoord[];
  readonly conflictCells: readonly V2GridCoord[];
}

export function createEmptyV2Bay(shipId: V2ShipId): V2CargoBayState {
  return {
    shipId,
    placed: [],
    staging: [],
    discardedThisArrange: [],
  };
}

export function getV2PlacedCells(placed: V2PlacedItem): readonly V2GridCoord[] {
  const def = getAnyV2ItemDef(placed.item.definitionId);
  if (!def) return [];
  return getV2OccupiedCells(def.shapeId, placed.x, placed.y, placed.rotation);
}

export function buildV2OccupancyMap(
  bay: V2CargoBayState,
  excludeInstanceId?: string
): Map<string, V2PlacedItem> {
  const map = new Map<string, V2PlacedItem>();
  for (const placed of bay.placed) {
    if (excludeInstanceId && placed.item.instanceId === excludeInstanceId) continue;
    for (const c of getV2PlacedCells(placed)) {
      map.set(`${c.x},${c.y}`, placed);
    }
  }
  return map;
}

export function findV2ItemAtCell(
  bay: V2CargoBayState,
  x: number,
  y: number
): V2PlacedItem | undefined {
  for (const placed of bay.placed) {
    const cells = getV2PlacedCells(placed);
    if (cells.some((c) => c.x === x && c.y === y)) {
      return placed;
    }
  }
  return undefined;
}

export function validateV2Placement(
  bay: V2CargoBayState,
  defId: string,
  originX: number,
  originY: number,
  rotation: V2Rotation,
  excludeInstanceId?: string
): V2PlacementValidation {
  const def = getAnyV2ItemDef(defId);
  if (!def) {
    return { valid: false, reason: 'out_of_bounds', cells: [], conflictCells: [] };
  }
  const ship = V2_SHIPS[bay.shipId];
  const cells = getV2OccupiedCells(def.shapeId, originX, originY, rotation);
  const occupied = buildV2OccupancyMap(bay, excludeInstanceId);
  const conflictCells: V2GridCoord[] = [];
  let hasOutOfBounds = false;
  let hasDisabled = false;
  let hasOverlap = false;

  for (const c of cells) {
    if (c.x < 0 || c.y < 0 || c.x >= ship.cols || c.y >= ship.rows) {
      hasOutOfBounds = true;
      conflictCells.push(c);
    } else if (isCellDisabledForShip(bay.shipId, c.x, c.y)) {
      hasDisabled = true;
      conflictCells.push(c);
    } else if (occupied.has(`${c.x},${c.y}`)) {
      hasOverlap = true;
      conflictCells.push(c);
    }
  }

  if (hasOutOfBounds) {
    return { valid: false, reason: 'out_of_bounds', cells, conflictCells };
  }
  if (hasDisabled) {
    return { valid: false, reason: 'disabled_cell', cells, conflictCells };
  }
  if (hasOverlap) {
    return { valid: false, reason: 'overlap', cells, conflictCells };
  }
  return { valid: true, cells, conflictCells: [] };
}

export function addV2ItemToStaging(
  bay: V2CargoBayState,
  item: V2ItemInstance,
  rotation: V2Rotation = 0
): V2CargoBayState {
  const stagedItem: V2ItemInstance = { ...item, location: 'staging' };
  return {
    ...bay,
    staging: [...bay.staging, { item: stagedItem, rotation }],
  };
}

export function placeV2FromStaging(
  bay: V2CargoBayState,
  instanceId: string,
  x: number,
  y: number,
  rotation?: V2Rotation
): { readonly ok: boolean; readonly bay: V2CargoBayState; readonly reason?: string } {
  const idx = bay.staging.findIndex((s) => s.item.instanceId === instanceId);
  if (idx < 0) return { ok: false, bay, reason: 'not_in_staging' };
  const entry = bay.staging[idx];
  const rot = rotation ?? entry.rotation;
  const check = validateV2Placement(bay, entry.item.definitionId, x, y, rot);
  if (!check.valid) return { ok: false, bay, reason: check.reason };

  const placedItem: V2ItemInstance = { ...entry.item, location: 'bay' };
  const nextStaging = bay.staging.filter((s) => s.item.instanceId !== instanceId);
  return {
    ok: true,
    bay: {
      ...bay,
      staging: nextStaging,
      placed: [...bay.placed, { item: placedItem, x, y, rotation: rot }],
    },
  };
}

export function moveV2PlacedItem(
  bay: V2CargoBayState,
  instanceId: string,
  x: number,
  y: number,
  rotation?: V2Rotation
): { readonly ok: boolean; readonly bay: V2CargoBayState; readonly reason?: string } {
  const existing = bay.placed.find((p) => p.item.instanceId === instanceId);
  if (!existing) return { ok: false, bay, reason: 'not_placed' };
  const rot = rotation ?? existing.rotation;
  const check = validateV2Placement(bay, existing.item.definitionId, x, y, rot, instanceId);
  if (!check.valid) return { ok: false, bay, reason: check.reason };

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

export function rotateV2PlacedItem(
  bay: V2CargoBayState,
  instanceId: string
): { readonly ok: boolean; readonly bay: V2CargoBayState; readonly reason?: string } {
  const existing = bay.placed.find((p) => p.item.instanceId === instanceId);
  if (!existing) return { ok: false, bay, reason: 'not_placed' };
  const nextRot = nextV2Rotation(existing.rotation);
  const direct = validateV2Placement(
    bay,
    existing.item.definitionId,
    existing.x,
    existing.y,
    nextRot,
    instanceId
  );
  if (direct.valid) {
    return {
      ok: true,
      bay: {
        ...bay,
        placed: bay.placed.map((p) =>
          p.item.instanceId === instanceId ? { ...p, rotation: nextRot } : p
        ),
      },
    };
  }
  // Small ergonomic kick offsets around anchor (never crosses disabled/occupied cells)
  const kicks: readonly [number, number][] = [
    [-1, 0],
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, -1],
    [-2, 0],
    [0, -2],
  ];
  for (const [dx, dy] of kicks) {
    const nx = existing.x + dx;
    const ny = existing.y + dy;
    const check = validateV2Placement(
      bay,
      existing.item.definitionId,
      nx,
      ny,
      nextRot,
      instanceId
    );
    if (check.valid) {
      return {
        ok: true,
        bay: {
          ...bay,
          placed: bay.placed.map((p) =>
            p.item.instanceId === instanceId ? { ...p, x: nx, y: ny, rotation: nextRot } : p
          ),
        },
      };
    }
  }
  return { ok: false, bay, reason: direct.reason };
}

export function rotateV2StagingItem(bay: V2CargoBayState, instanceId: string): V2CargoBayState {
  return {
    ...bay,
    staging: bay.staging.map((s) =>
      s.item.instanceId === instanceId ? { ...s, rotation: nextV2Rotation(s.rotation) } : s
    ),
  };
}

export function moveV2PlacedToStaging(
  bay: V2CargoBayState,
  instanceId: string
): { readonly ok: boolean; readonly bay: V2CargoBayState } {
  const existing = bay.placed.find((p) => p.item.instanceId === instanceId);
  if (!existing) return { ok: false, bay };
  const stagedItem: V2ItemInstance = { ...existing.item, location: 'staging' };
  return {
    ok: true,
    bay: {
      ...bay,
      placed: bay.placed.filter((p) => p.item.instanceId !== instanceId),
      staging: [...bay.staging, { item: stagedItem, rotation: existing.rotation }],
    },
  };
}

export function discardV2Item(
  bay: V2CargoBayState,
  instanceId: string
): { readonly ok: boolean; readonly bay: V2CargoBayState; readonly discarded?: V2ItemInstance } {
  const placed = bay.placed.find((p) => p.item.instanceId === instanceId);
  if (placed) {
    const rec: V2DiscardedRecord = {
      item: placed.item,
      previousLocation: {
        zone: 'grid',
        x: placed.x,
        y: placed.y,
        rotation: placed.rotation,
      },
    };
    return {
      ok: true,
      discarded: placed.item,
      bay: {
        ...bay,
        placed: bay.placed.filter((p) => p.item.instanceId !== instanceId),
        discardedThisArrange: [...bay.discardedThisArrange, rec],
      },
    };
  }
  const staged = bay.staging.find((s) => s.item.instanceId === instanceId);
  if (staged) {
    const rec: V2DiscardedRecord = {
      item: staged.item,
      previousLocation: {
        zone: 'staging',
        rotation: staged.rotation,
      },
    };
    return {
      ok: true,
      discarded: staged.item,
      bay: {
        ...bay,
        staging: bay.staging.filter((s) => s.item.instanceId !== instanceId),
        discardedThisArrange: [...bay.discardedThisArrange, rec],
      },
    };
  }
  return { ok: false, bay };
}

export function undoV2LastDiscard(
  bay: V2CargoBayState
): { readonly ok: boolean; readonly bay: V2CargoBayState } {
  if (bay.discardedThisArrange.length === 0) return { ok: false, bay };
  const last = bay.discardedThisArrange[bay.discardedThisArrange.length - 1];
  const rest = bay.discardedThisArrange.slice(0, -1);

  if (last.previousLocation.zone === 'grid') {
    const { x, y, rotation } = last.previousLocation;
    const check = validateV2Placement(bay, last.item.definitionId, x, y, rotation);
    if (check.valid) {
      return {
        ok: true,
        bay: {
          ...bay,
          placed: [...bay.placed, { item: { ...last.item, location: 'bay' }, x, y, rotation }],
          discardedThisArrange: rest,
        },
      };
    }
    // Original slot occupied -> restore cleanly into staging!
    return {
      ok: true,
      bay: {
        ...bay,
        staging: [...bay.staging, { item: { ...last.item, location: 'staging' }, rotation }],
        discardedThisArrange: rest,
      },
    };
  }

  return {
    ok: true,
    bay: {
      ...bay,
      staging: [
        ...bay.staging,
        { item: { ...last.item, location: 'staging' }, rotation: last.previousLocation.rotation },
      ],
      discardedThisArrange: rest,
    },
  };
}

export function clearV2DiscardHistory(bay: V2CargoBayState): V2CargoBayState {
  if (bay.discardedThisArrange.length === 0) return bay;
  return { ...bay, discardedThisArrange: [] };
}

export function removeV2ItemsByOriginAndDef(
  bay: V2CargoBayState,
  defId: string
): V2CargoBayState {
  return {
    ...bay,
    placed: bay.placed.filter((p) => p.item.definitionId !== defId),
    staging: bay.staging.filter((s) => s.item.definitionId !== defId),
    discardedThisArrange: bay.discardedThisArrange.filter(
      (d) => d.item.definitionId !== defId
    ),
  };
}

export function removeV2ItemById(bay: V2CargoBayState, instanceId: string): V2CargoBayState {
  return {
    ...bay,
    placed: bay.placed.filter((p) => p.item.instanceId !== instanceId),
    staging: bay.staging.filter((s) => s.item.instanceId !== instanceId),
  };
}

export function getV2BayOccupancy(bay: V2CargoBayState): {
  readonly occupiedCells: number;
  readonly totalCells: number;
} {
  let occupiedCells = 0;
  for (const p of bay.placed) {
    occupiedCells += getV2PlacedCells(p).length;
  }
  return {
    occupiedCells,
    totalCells: V2_SHIPS[bay.shipId].validCellCount,
  };
}

/**
 * Orthogonal adjacency check (§7.1): true iff at least one cell pair shares an edge.
 * Multiple shared edges between the same two items still count as a single adjacency.
 */
export function areV2PlacedItemsAdjacent(a: V2PlacedItem, b: V2PlacedItem): boolean {
  if (a.item.instanceId === b.item.instanceId) return false;
  const cellsA = getV2PlacedCells(a);
  const cellsB = getV2PlacedCells(b);
  for (const ca of cellsA) {
    for (const cb of cellsB) {
      if (Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y) === 1) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Returns true if any cell occupied by `placed` sits on one of the hull's highlighted Power Cells.
 */
export function doesV2PlacedItemTouchPowerCell(
  bay: Pick<V2CargoBayState, 'shipId'>,
  placed: V2PlacedItem
): boolean {
  const cells = getV2PlacedCells(placed);
  return cells.some((c) => isCellPowerCellForShip(bay.shipId, c.x, c.y));
}

/**
 * Returns the set of placed equipment instanceIds currently powered by at least one hull Power Cell.
 */
export function getV2PowerCellBoostedInstanceIds(
  bay: V2CargoBayState
): ReadonlySet<string> {
  const boosted = new Set<string>();
  for (const placed of bay.placed) {
    if (placed.item.category === 'equipment' && doesV2PlacedItemTouchPowerCell(bay, placed)) {
      boosted.add(placed.item.instanceId);
    }
  }
  return boosted;
}

/**
 * Finds first legal placement on the hull for a shape (helpful for presets & AI simulation).
 */
export function findFirstLegalV2Placement(
  bay: V2CargoBayState,
  defId: string
): { readonly x: number; readonly y: number; readonly rotation: V2Rotation } | null {
  const ship = V2_SHIPS[bay.shipId];
  const rotations: readonly V2Rotation[] = [0, 1, 2, 3];
  for (const rot of rotations) {
    for (let y = 0; y < ship.rows; y++) {
      for (let x = 0; x < ship.cols; x++) {
        if (validateV2Placement(bay, defId, x, y, rot).valid) {
          return { x, y, rotation: rot };
        }
      }
    }
  }
  return null;
}

/**
 * Exact bitmask backtracking solver: determines whether a list of shapes can ALL fit simultaneously
 * inside the specified ship hull (honoring disabled cells and 90° rotations).
 * Used to mathematically certify AC01 (tutorial spatial conflict) and AC02/AC11!
 */
export function canFitAllV2Shapes(
  shipId: V2ShipId,
  shapeIds: readonly V2ShapeId[]
): boolean {
  const ship = V2_SHIPS[shipId];
  const totalNeeded = shapeIds.reduce((sum, s) => sum + V2_SHAPES[s].cells.length, 0);
  if (totalNeeded > ship.validCellCount) return false;
  if (shapeIds.length === 0) return true;

  // Place largest shapes first for near-instant pruning
  const sorted = [...shapeIds].sort(
    (a, b) => V2_SHAPES[b].cells.length - V2_SHAPES[a].cells.length
  );

  // Build valid cell bitmask index (max 5*5 = 25 bits -> fits cleanly in 32-bit int!)
  const bitIndex = (x: number, y: number) => y * ship.cols + x;
  let blockedMask = 0;
  for (let y = 0; y < ship.rows; y++) {
    for (let x = 0; x < ship.cols; x++) {
      if (!isCellValidForShip(shipId, x, y)) {
        blockedMask |= 1 << bitIndex(x, y);
      }
    }
  }

  // Precompute unique placement bitmasks per shape
  const masksByShape = new Map<V2ShapeId, number[]>();
  const getMasks = (shapeId: V2ShapeId): number[] => {
    const cached = masksByShape.get(shapeId);
    if (cached) return cached;
    const unique = new Set<number>();
    const rotations: readonly V2Rotation[] = [0, 1, 2, 3];
    for (const rot of rotations) {
      for (let y = 0; y < ship.rows; y++) {
        for (let x = 0; x < ship.cols; x++) {
          const cells = getV2OccupiedCells(shapeId, x, y, rot);
          let ok = true;
          let mask = 0;
          for (const c of cells) {
            if (!isCellValidForShip(shipId, c.x, c.y)) {
              ok = false;
              break;
            }
            mask |= 1 << bitIndex(c.x, c.y);
          }
          if (ok) unique.add(mask);
        }
      }
    }
    const arr = Array.from(unique);
    masksByShape.set(shapeId, arr);
    return arr;
  };

  const dfs = (idx: number, usedMask: number): boolean => {
    if (idx === sorted.length) return true;
    const masks = getMasks(sorted[idx]);
    for (const m of masks) {
      if ((usedMask & m) === 0) {
        if (dfs(idx + 1, usedMask | m)) return true;
      }
    }
    return false;
  };

  return dfs(0, blockedMask);
}

/**
 * Verifies AC01 spatial conflict:
 * 1. Keeping ALL existing items + incoming item simultaneously has NO valid packing on shipId.
 * 2. Counts how many distinct single-item discards from existingItems allow keeping incomingItem.
 */
export function verifyV2SpatialConflict(
  shipId: V2ShipId,
  existingItems: readonly { readonly id: string; readonly shapeId: V2ShapeId }[],
  incomingShapeId: V2ShapeId
): {
  readonly allFitTogether: boolean;
  readonly feasibleSingleDiscardIds: readonly string[];
} {
  const allShapes = [...existingItems.map((i) => i.shapeId), incomingShapeId];
  const allFitTogether = canFitAllV2Shapes(shipId, allShapes);
  const feasibleSingleDiscardIds: string[] = [];

  for (let i = 0; i < existingItems.length; i++) {
    const remaining = existingItems
      .filter((_, idx) => idx !== i)
      .map((item) => item.shapeId);
    if (canFitAllV2Shapes(shipId, [...remaining, incomingShapeId])) {
      feasibleSingleDiscardIds.push(existingItems[i].id);
    }
  }

  return { allFitTogether, feasibleSingleDiscardIds };
}

export function getV2BayItemCounts(bay: V2CargoBayState): {
  readonly placedCount: number;
  readonly stagingCount: number;
  readonly totalItems: readonly V2ItemInstance[];
} {
  const totalItems = [
    ...bay.placed.map((p) => p.item),
    ...bay.staging.map((s) => s.item),
  ];
  return {
    placedCount: bay.placed.length,
    stagingCount: bay.staging.length,
    totalItems,
  };
}

export function getV2StagingItem(
  bay: V2CargoBayState,
  instanceId: string
): V2StagingItem | undefined {
  return bay.staging.find((s) => s.item.instanceId === instanceId);
}
