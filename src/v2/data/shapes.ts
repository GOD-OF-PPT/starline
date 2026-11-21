/**
 * Canonical V2 shape masks (single source of truth for rules, solver, and UI).
 * Coordinates: x rightward, y downward. Normalized so minX = 0, minY = 0 after every 90° CW rotation.
 */
export type V2ShapeId = '1x1' | '1x2' | '1x3' | '2x2' | '2x3' | 'L3' | 'T4';

export type V2Rotation = 0 | 1 | 2 | 3;

export interface V2GridCoord {
  readonly x: number;
  readonly y: number;
}

export interface V2ShapeDefinition {
  readonly id: V2ShapeId;
  readonly label: string;
  readonly cells: readonly V2GridCoord[];
  readonly canonicalWidth: number;
  readonly canonicalHeight: number;
  readonly canvasWidthPx: number;
  readonly canvasHeightPx: number;
}

export const V2_CELL_SOURCE_PX = 192;

export const V2_SHAPES: Record<V2ShapeId, V2ShapeDefinition> = {
  '1x1': {
    id: '1x1',
    label: '1×1',
    cells: [{ x: 0, y: 0 }],
    canonicalWidth: 1,
    canonicalHeight: 1,
    canvasWidthPx: 192,
    canvasHeightPx: 192,
  },
  '1x2': {
    id: '1x2',
    label: '1×2',
    cells: [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
    ],
    canonicalWidth: 1,
    canonicalHeight: 2,
    canvasWidthPx: 192,
    canvasHeightPx: 384,
  },
  '1x3': {
    id: '1x3',
    label: '1×3',
    cells: [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 2 },
    ],
    canonicalWidth: 1,
    canonicalHeight: 3,
    canvasWidthPx: 192,
    canvasHeightPx: 576,
  },
  '2x2': {
    id: '2x2',
    label: '2×2',
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
    canonicalWidth: 2,
    canonicalHeight: 2,
    canvasWidthPx: 384,
    canvasHeightPx: 384,
  },
  '2x3': {
    id: '2x3',
    label: '2×3',
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
    ],
    canonicalWidth: 2,
    canonicalHeight: 3,
    canvasWidthPx: 384,
    canvasHeightPx: 576,
  },
  L3: {
    id: 'L3',
    label: 'L形(3格)',
    cells: [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
    canonicalWidth: 2,
    canonicalHeight: 2,
    canvasWidthPx: 384,
    canvasHeightPx: 384,
  },
  T4: {
    id: 'T4',
    label: 'T形(4格)',
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
    ],
    canonicalWidth: 3,
    canonicalHeight: 2,
    canvasWidthPx: 576,
    canvasHeightPx: 384,
  },
};

export function rotateV2Cells(
  shapeId: V2ShapeId,
  rotation: V2Rotation
): readonly V2GridCoord[] {
  let current = V2_SHAPES[shapeId].cells.map((c) => ({ x: c.x, y: c.y }));
  for (let step = 0; step < rotation; step++) {
    const maxY = Math.max(...current.map((c) => c.y));
    current = current.map((c) => ({ x: maxY - c.y, y: c.x }));
    const minX = Math.min(...current.map((c) => c.x));
    const minY = Math.min(...current.map((c) => c.y));
    current = current.map((c) => ({ x: c.x - minX, y: c.y - minY }));
  }
  return current.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));
}

export function getV2ShapeBounds(
  shapeId: V2ShapeId,
  rotation: V2Rotation
): { readonly width: number; readonly height: number } {
  const cells = rotateV2Cells(shapeId, rotation);
  const width = Math.max(...cells.map((c) => c.x)) + 1;
  const height = Math.max(...cells.map((c) => c.y)) + 1;
  return { width, height };
}

export function getV2OccupiedCells(
  shapeId: V2ShapeId,
  originX: number,
  originY: number,
  rotation: V2Rotation
): readonly V2GridCoord[] {
  return rotateV2Cells(shapeId, rotation).map((c) => ({
    x: originX + c.x,
    y: originY + c.y,
  }));
}

export function nextV2Rotation(rotation: V2Rotation): V2Rotation {
  return ((rotation + 1) % 4) as V2Rotation;
}
