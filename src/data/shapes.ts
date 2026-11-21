export type ShapeId = '1x1' | '1x2' | '1x3' | '2x2' | 'L3' | 'T4';

export type Rotation = 0 | 1 | 2 | 3;

export interface GridCoord {
  readonly x: number;
  readonly y: number;
}

export interface ShapeDefinition {
  readonly id: ShapeId;
  readonly label: string;
  readonly cells: readonly GridCoord[];
  readonly canonicalWidth: number;
  readonly canonicalHeight: number;
  readonly sourcePixelWidth: number;
  readonly sourcePixelHeight: number;
}

export const GRID_SIZE = 4;
export const SOURCE_PX_PER_CELL = 192;
export const SOURCE_MARGIN_PX = 12;

export const SHAPES: Record<ShapeId, ShapeDefinition> = {
  '1x1': {
    id: '1x1',
    label: '1×1',
    cells: [{ x: 0, y: 0 }],
    canonicalWidth: 1,
    canonicalHeight: 1,
    sourcePixelWidth: 192,
    sourcePixelHeight: 192,
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
    sourcePixelWidth: 192,
    sourcePixelHeight: 384,
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
    sourcePixelWidth: 192,
    sourcePixelHeight: 576,
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
    sourcePixelWidth: 384,
    sourcePixelHeight: 384,
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
    sourcePixelWidth: 384,
    sourcePixelHeight: 384,
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
    sourcePixelWidth: 576,
    sourcePixelHeight: 384,
  },
};

/**
 * Rotate a cell set clockwise by 90° * rotation in screen coordinates (x right, y down),
 * then normalize so min(x) === 0 and min(y) === 0. No mirroring.
 */
export function rotateCells(cells: readonly GridCoord[], rotation: Rotation): GridCoord[] {
  let current = cells.map((c) => ({ x: c.x, y: c.y }));
  const steps = ((rotation % 4) + 4) % 4;
  for (let i = 0; i < steps; i++) {
    current = current.map((c) => ({ x: -c.y, y: c.x }));
    let minX = Infinity;
    let minY = Infinity;
    for (const c of current) {
      if (c.x < minX) minX = c.x;
      if (c.y < minY) minY = c.y;
    }
    current = current.map((c) => ({ x: c.x - minX, y: c.y - minY }));
  }
  return current.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));
}

export function getRotatedShapeCells(shapeId: ShapeId, rotation: Rotation): GridCoord[] {
  return rotateCells(SHAPES[shapeId].cells, rotation);
}

export function getShapeBounds(
  shapeId: ShapeId,
  rotation: Rotation
): { width: number; height: number } {
  const cells = getRotatedShapeCells(shapeId, rotation);
  let maxX = 0;
  let maxY = 0;
  for (const c of cells) {
    if (c.x > maxX) maxX = c.x;
    if (c.y > maxY) maxY = c.y;
  }
  return { width: maxX + 1, height: maxY + 1 };
}

export function getOccupiedCells(
  shapeId: ShapeId,
  rotation: Rotation,
  originX: number,
  originY: number
): GridCoord[] {
  return getRotatedShapeCells(shapeId, rotation).map((c) => ({
    x: originX + c.x,
    y: originY + c.y,
  }));
}

export function areCellSetsOrthogonallyAdjacent(
  a: readonly GridCoord[],
  b: readonly GridCoord[]
): boolean {
  for (const ca of a) {
    for (const cb of b) {
      const manhattan = Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y);
      if (manhattan === 1) return true;
    }
  }
  return false;
}

export function nextRotation(rotation: Rotation): Rotation {
  return (((rotation + 1) % 4) as Rotation);
}
