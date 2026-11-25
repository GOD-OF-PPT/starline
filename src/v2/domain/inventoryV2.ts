import type { SeededRng } from '../../domain/rng';
import {
  V2_CARGO_DEFS,
  V2_NON_COLLECTIBLE_CARGO_DEF_IDS,
  computeV2CargoPrice,
} from '../data/cargo';
import { getV2EquipmentDefByKind, type V2EquipmentKind } from '../data/equipment';
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
import { createV2CargoInstance, getAnyV2ItemDef } from './itemCatalog';
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

const SHIP_BLOCKED_MASK_CACHE = new Map<V2ShipId, number>();
const SHIP_SHAPE_MASKS_CACHE = new Map<string, readonly number[]>();

function getShipBlockedMask(shipId: V2ShipId): number {
  const cached = SHIP_BLOCKED_MASK_CACHE.get(shipId);
  if (cached !== undefined) return cached;
  const ship = V2_SHIPS[shipId];
  let blockedMask = 0;
  for (let y = 0; y < ship.rows; y++) {
    for (let x = 0; x < ship.cols; x++) {
      if (!isCellValidForShip(shipId, x, y)) {
        blockedMask |= 1 << (y * ship.cols + x);
      }
    }
  }
  SHIP_BLOCKED_MASK_CACHE.set(shipId, blockedMask);
  return blockedMask;
}

function getShipShapePlacementMasks(shipId: V2ShipId, shapeId: V2ShapeId): readonly number[] {
  const key = `${shipId}:${shapeId}`;
  const cached = SHIP_SHAPE_MASKS_CACHE.get(key);
  if (cached) return cached;
  const ship = V2_SHIPS[shipId];
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
          mask |= 1 << (c.y * ship.cols + c.x);
        }
        if (ok) unique.add(mask);
      }
    }
  }
  const arr = Array.from(unique);
  SHIP_SHAPE_MASKS_CACHE.set(key, arr);
  return arr;
}

/**
 * Exact bitmask backtracking solver: determines whether a list of shapes can ALL fit simultaneously
 * inside the specified ship hull (honoring disabled cells and 90° rotations).
 * Uses 100% exact algebraic pruning: 1x1 stripping, cached placement masks, identical-shape
 * symmetry breaking, and shape-group boundary memoization.
 */
export function canFitAllV2Shapes(
  shipId: V2ShipId,
  shapeIds: readonly V2ShapeId[]
): boolean {
  const ship = V2_SHIPS[shipId];
  const totalNeeded = shapeIds.reduce((sum, s) => sum + V2_SHAPES[s].cells.length, 0);
  if (totalNeeded > ship.validCellCount) return false;
  if (shapeIds.length === 0) return true;

  // Every valid empty cell trivially accepts a '1x1', so once totalNeeded <= validCellCount,
  // only non-1x1 shapes constrain packing!
  const nonUnit = shapeIds.filter((s) => s !== '1x1');
  if (nonUnit.length === 0) return true;

  // Place largest shapes first, grouping identical shapes adjacently for exact symmetry breaking
  const sorted = [...nonUnit].sort((a, b) => {
    const diff = V2_SHAPES[b].cells.length - V2_SHAPES[a].cells.length;
    return diff !== 0 ? diff : a.localeCompare(b);
  });

  const blockedMask = getShipBlockedMask(shipId);
  const masksPerIdx = sorted.map((s) => getShipShapePlacementMasks(shipId, s));
  for (const m of masksPerIdx) {
    if (m.length === 0) return false;
  }

  const failedBoundary = new Set<number>();
  const BIT_SHIFT = 33554432; // 2^25 (> max 5x5 bitmask)

  const dfs = (idx: number, usedMask: number, minMaskIdx: number): boolean => {
    if (idx === sorted.length) return true;
    const isGroupBoundary = idx === 0 || sorted[idx] !== sorted[idx - 1];
    let boundaryKey = 0;
    if (isGroupBoundary) {
      boundaryKey = idx * BIT_SHIFT + usedMask;
      if (failedBoundary.has(boundaryKey)) return false;
    }

    const masks = masksPerIdx[idx];
    const startIdx = isGroupBoundary ? 0 : minMaskIdx;
    const nextIsSame = idx + 1 < sorted.length && sorted[idx + 1] === sorted[idx];
    for (let i = startIdx; i < masks.length; i += 1) {
      const m = masks[i];
      if ((usedMask & m) === 0) {
        if (dfs(idx + 1, usedMask | m, nextIsSame ? i + 1 : 0)) return true;
      }
    }

    if (isGroupBoundary) {
      failedBoundary.add(boundaryKey);
    }
    return false;
  };

  return dfs(0, blockedMask, 0);
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
  // Exact subset property: if all items fit together, removing any 1 existing item also fits!
  if (allFitTogether) {
    return {
      allFitTogether: true,
      feasibleSingleDiscardIds: existingItems.map((i) => i.id),
    };
  }

  const feasibleSingleDiscardIds: string[] = [];
  const checkedByShape = new Map<V2ShapeId, boolean>();
  for (let i = 0; i < existingItems.length; i++) {
    const removedShape = existingItems[i].shapeId;
    let fits = checkedByShape.get(removedShape);
    if (fits === undefined) {
      const remaining = existingItems
        .filter((_, idx) => idx !== i)
        .map((item) => item.shapeId);
      fits = canFitAllV2Shapes(shipId, [...remaining, incomingShapeId]);
      checkedByShape.set(removedShape, fits);
    }
    if (fits) {
      feasibleSingleDiscardIds.push(existingItems[i].id);
    }
  }

  return { allFitTogether: false, feasibleSingleDiscardIds };
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

export interface V2BaySpatialConflictResult {
  readonly hasConflict: boolean;
  readonly allFitTogether: boolean;
  readonly feasibleSingleDiscardIds: readonly string[];
}

function getShapeIdForInstance(item: Pick<V2ItemInstance, 'definitionId'>): V2ShapeId {
  return getAnyV2ItemDef(item.definitionId)?.shapeId ?? '1x1';
}

/**
 * Authoritative D06 bay-level spatial conflict detector directly wired to `verifyV2SpatialConflict`
 * and `canFitAllV2Shapes`. Detects true packing impossibility (not mere fragmentation) whenever
 * placed + staging items cannot all coexist on `bay.shipId`.
 */
export function detectV2BaySpatialConflict(bay: V2CargoBayState): V2BaySpatialConflictResult {
  if (bay.staging.length === 0 || bay.placed.length === 0) {
    return {
      hasConflict: false,
      allFitTogether: true,
      feasibleSingleDiscardIds: [],
    };
  }

  const placedDescriptors = bay.placed.map((p) => ({
    id: p.item.instanceId,
    shapeId: getShapeIdForInstance(p.item),
  }));
  const stagingDescriptors = bay.staging.map((s) => ({
    id: s.item.instanceId,
    shapeId: getShapeIdForInstance(s.item),
  }));

  if (stagingDescriptors.length === 1) {
    const res = verifyV2SpatialConflict(
      bay.shipId,
      placedDescriptors,
      stagingDescriptors[0].shapeId
    );
    return {
      hasConflict: !res.allFitTogether,
      allFitTogether: res.allFitTogether,
      feasibleSingleDiscardIds: res.feasibleSingleDiscardIds,
    };
  }

  const allDescriptors = [...placedDescriptors, ...stagingDescriptors];
  const allFitTogether = canFitAllV2Shapes(
    bay.shipId,
    allDescriptors.map((d) => d.shapeId)
  );
  if (allFitTogether) {
    return {
      hasConflict: false,
      allFitTogether: true,
      feasibleSingleDiscardIds: [],
    };
  }

  // Exact single-item discard check against the FULL (placed + staging) set, cached by shapeId
  const feasibleSingleDiscardIds: string[] = [];
  const shapeCanFitWithout = new Map<V2ShapeId, boolean>();
  const allShapes = allDescriptors.map((d) => d.shapeId);
  for (let i = 0; i < allDescriptors.length; i += 1) {
    const sh = allDescriptors[i].shapeId;
    let ok = shapeCanFitWithout.get(sh);
    if (ok === undefined) {
      const rest = allShapes.filter((_, idx) => idx !== i);
      ok = canFitAllV2Shapes(bay.shipId, rest);
      shapeCanFitWithout.set(sh, ok);
    }
    if (ok) {
      feasibleSingleDiscardIds.push(allDescriptors[i].id);
    }
  }

  return {
    hasConflict: true,
    allFitTogether: false,
    feasibleSingleDiscardIds,
  };
}

/**
 * Returns unlocked equipment kinds whose shape produces a genuine, single-discard-solvable
 * spatial conflict against `placedDescriptors` + `extraCommittedShapes` (D06).
 */
export function pickConflictInducingEquipmentKinds(
  shipId: V2ShipId,
  placedItems: readonly V2PlacedItem[],
  extraCommittedShapes: readonly V2ShapeId[],
  candidateKinds: readonly V2EquipmentKind[]
): readonly V2EquipmentKind[] {
  if (placedItems.length === 0 || candidateKinds.length === 0) return [];
  const baseDescriptors = [
    ...placedItems.map((p) => ({
      id: p.item.instanceId,
      shapeId: getShapeIdForInstance(p.item),
    })),
    ...extraCommittedShapes.map((shapeId, idx) => ({
      id: `committed_${idx}`,
      shapeId,
    })),
  ];

  const matching: V2EquipmentKind[] = [];
  for (const kind of candidateKinds) {
    const def = getV2EquipmentDefByKind(kind, 'common');
    const check = verifyV2SpatialConflict(shipId, baseDescriptors, def.shapeId);
    if (!check.allFitTogether && check.feasibleSingleDiscardIds.length >= 1) {
      matching.push(kind);
    }
  }
  return matching;
}

export interface ComposeConflictCargoParams {
  readonly shipId: V2ShipId;
  readonly placedItems: readonly V2PlacedItem[];
  readonly extraCommittedShapes?: readonly V2ShapeId[];
  readonly existingItems?: readonly V2ItemInstance[];
  readonly layer: number;
  readonly sectorPriceMult: number;
  readonly maxItems: number;
  readonly minItems?: number;
  readonly forceConflict?: boolean;
  readonly rng: SeededRng;
  readonly idPrefix: string;
}

const STAGE1_FILL_CARGO_POOL: readonly string[] = [
  'cargo.old_engine',
  'cargo.coolant_tank',
  'cargo.folding_antenna',
];

const STAGE2_CONFLICT_CARGO_POOL: readonly string[] = [
  'cargo.old_engine',
  'cargo.coolant_tank',
  'cargo.folding_antenna',
  'cargo.alloy_bar',
];

/**
 * Pure deterministic 2-stage D06 cargo bundle calibrator wired to `verifyV2SpatialConflict`
 * and `canFitAllV2Shapes`. Draws ONLY from non-collectible regular cargos so relic pity/rarity
 * stays untouched while guaranteeing genuine spatial tradeoffs (>= 1/run across all 5 contracts).
 */
export function composeConflictCargoBundle(
  params: ComposeConflictCargoParams
): { readonly items: readonly V2ItemInstance[]; readonly triggersConflict: boolean } {
  const {
    shipId,
    placedItems,
    extraCommittedShapes = [],
    existingItems = [],
    layer,
    sectorPriceMult,
    maxItems,
    minItems = 1,
    forceConflict = false,
    rng,
    idPrefix,
  } = params;

  const makeCargo = (defId: string, seq: number): V2ItemInstance => {
    const basePrice = computeV2CargoPrice(defId, layer);
    const fixedValueOverride =
      sectorPriceMult === 1 ? undefined : Math.max(1, Math.round(basePrice * sectorPriceMult));
    return createV2CargoInstance({
      instanceId: `${idPrefix}_${seq}`,
      defId,
      origin: 'loot',
      acquiredDepth: layer,
      location: 'staging',
      fixedValueOverride,
    });
  };

  const results: V2ItemInstance[] = [...existingItems];
  const shipCap = V2_SHIPS[shipId].validCellCount;
  const baselineDescriptors: { id: string; shapeId: V2ShapeId }[] = [
    ...placedItems.map((p) => ({
      id: p.item.instanceId,
      shapeId: getShapeIdForInstance(p.item),
    })),
    ...extraCommittedShapes.map((shapeId, idx) => ({
      id: `extra_${idx}`,
      shapeId,
    })),
    ...existingItems.map((it) => ({
      id: it.instanceId,
      shapeId: getShapeIdForInstance(it),
    })),
  ];

  const occupiedBaseline = baselineDescriptors.reduce(
    (sum, d) => sum + V2_SHAPES[d.shapeId].cells.length,
    0
  );
  const freeCells = Math.max(0, shipCap - occupiedBaseline);

  const alreadyConflicts = !canFitAllV2Shapes(
    shipId,
    baselineDescriptors.map((d) => d.shapeId)
  );
  if (alreadyConflicts) {
    let seq = 1;
    while (results.length < minItems && results.length < maxItems) {
      results.push(makeCargo(rng.pick(V2_NON_COLLECTIBLE_CARGO_DEF_IDS), seq++));
    }
    return { items: results, triggersConflict: true };
  }

  // Stage 1 (L1-L2 fill pacing when spacious): bias toward high-value 3-4 cell regular cargos
  // Scale fill count smoothly on larger 18-20 cell hulls when >= 11 cells are still free!
  const runStage2 = forceConflict || layer >= 3 || (layer >= 2 && freeCells <= 10);
  if (!runStage2) {
    const desired = freeCells >= 11 ? 3 : 2;
    const targetCount = Math.max(minItems, Math.min(maxItems, desired));
    let seq = 1;
    while (results.length < targetCount) {
      const defId = rng.pick(STAGE1_FILL_CARGO_POOL);
      results.push(makeCargo(defId, seq++));
    }
    const allShapes = [
      ...baselineDescriptors.map((d) => d.shapeId),
      ...results.slice(existingItems.length).map((it) => getShapeIdForInstance(it)),
    ];
    return {
      items: results,
      triggersConflict: !canFitAllV2Shapes(shipId, allShapes),
    };
  }

  // Stage 2: Iteratively add high-value non-collectible cargo until verifyV2SpatialConflict confirms
  // a genuine solvable conflict (allFitTogether === false && feasibleSingleDiscardIds >= 1).
  const currentDescriptors = [...baselineDescriptors];
  let triggersConflict = false;
  let seq = 1;

  while (results.length < maxItems) {
    // Check if any single cargo completes a clean solvable conflict right now
    const surgicalCandidates: string[] = [];
    const fallbackConflictCandidates: string[] = [];
    for (const defId of STAGE2_CONFLICT_CARGO_POOL) {
      const shapeId = V2_CARGO_DEFS[defId].shapeId;
      const check = verifyV2SpatialConflict(shipId, currentDescriptors, shapeId);
      if (!check.allFitTogether) {
        if (check.feasibleSingleDiscardIds.length >= 1) {
          surgicalCandidates.push(defId);
        } else {
          fallbackConflictCandidates.push(defId);
        }
      }
    }

    if (surgicalCandidates.length > 0) {
      const chosenDef = rng.pick(surgicalCandidates);
      const item = makeCargo(chosenDef, seq++);
      results.push(item);
      currentDescriptors.push({ id: item.instanceId, shapeId: V2_CARGO_DEFS[chosenDef].shapeId });
      triggersConflict = true;
      break;
    }

    if (fallbackConflictCandidates.length > 0 && results.length + 1 >= minItems) {
      const chosenDef = rng.pick(fallbackConflictCandidates);
      const item = makeCargo(chosenDef, seq++);
      results.push(item);
      currentDescriptors.push({ id: item.instanceId, shapeId: V2_CARGO_DEFS[chosenDef].shapeId });
      triggersConflict = true;
      break;
    }

    // Still spacious: add a chunky 3-4 cell item to close the remaining gap
    const remainingCells = Math.max(
      0,
      shipCap -
        currentDescriptors.reduce((sum, d) => sum + V2_SHAPES[d.shapeId].cells.length, 0)
    );
    const slotsLeftAfterThis = Math.max(0, maxItems - results.length - 1);
    const pickedDef =
      remainingCells >= 4 && slotsLeftAfterThis * 4 <= remainingCells
        ? 'cargo.old_engine'
        : rng.pick(
            remainingCells >= 7
              ? ['cargo.old_engine', 'cargo.old_engine', 'cargo.coolant_tank', 'cargo.folding_antenna']
              : STAGE1_FILL_CARGO_POOL
          );
    const item = makeCargo(pickedDef, seq++);
    results.push(item);
    currentDescriptors.push({ id: item.instanceId, shapeId: V2_CARGO_DEFS[pickedDef].shapeId });
  }

  // Ensure minItems if stopped early before reaching minItems
  while (results.length < minItems && results.length < maxItems) {
    const defId = rng.pick(STAGE1_FILL_CARGO_POOL);
    const item = makeCargo(defId, seq++);
    results.push(item);
    currentDescriptors.push({ id: item.instanceId, shapeId: V2_CARGO_DEFS[defId].shapeId });
  }

  if (!triggersConflict) {
    triggersConflict = !canFitAllV2Shapes(
      shipId,
      currentDescriptors.map((d) => d.shapeId)
    );
  }

  return { items: results, triggersConflict };
}

