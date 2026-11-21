import type { V2GridCoord } from './shapes';

export type V2ShipId = 'cannon_skiff' | 'shield_cruiser' | 'heavy_freighter';

export interface V2ShipDefinition {
  readonly id: V2ShipId;
  readonly name: string;
  readonly cols: number;
  readonly rows: number;
  readonly validCellCount: number;
  /** Permanently obstructed hull bulkhead cells (e.g. heavy_freighter (4,0) and (0,3)) */
  readonly disabledCells: readonly V2GridCoord[];
  readonly maxHp: number;
  readonly coreAttack: number;
  readonly bonusShield: number;
  readonly loadoutBudget: number;
  readonly summary: string;
  readonly unlockHint: string;
}

export const V2_SHIP_ORDER: readonly V2ShipId[] = [
  'cannon_skiff',
  'shield_cruiser',
  'heavy_freighter',
];

export const V2_SHIPS: Record<V2ShipId, V2ShipDefinition> = {
  cannon_skiff: {
    id: 'cannon_skiff',
    name: '标准炮艇',
    cols: 4,
    rows: 4,
    validCellCount: 16,
    disabledCells: [],
    maxHp: 30,
    coreAttack: 2,
    bonusShield: 0,
    loadoutBudget: 6,
    summary: '4×4 常规艇体 · 自带外置小炮（核心 2 攻/轮）· 预算 6',
    unlockHint: '初始解锁',
  },
  shield_cruiser: {
    id: 'shield_cruiser',
    name: '护盾工程艇',
    cols: 4,
    rows: 4,
    validCellCount: 16,
    disabledCells: [],
    maxHp: 34,
    coreAttack: 1,
    bonusShield: 4,
    loadoutBudget: 6,
    summary: '4×4 高耐久艇体 · 每战额外 +4 护盾 · 预算 6',
    unlockHint: '扩建船坞一阶（120¤）解锁',
  },
  heavy_freighter: {
    id: 'heavy_freighter',
    name: '远航货船',
    cols: 5,
    rows: 4,
    validCellCount: 18,
    disabledCells: [
      { x: 4, y: 0 },
      { x: 0, y: 3 },
    ],
    maxHp: 28,
    coreAttack: 1,
    bonusShield: 0,
    loadoutBudget: 5,
    summary: '5×4 异形大舱（18 格，右上/左下封板）· 大件与反应堆友好 · 预算 5',
    unlockHint: '扩建船坞二阶（200¤，需完成两种标准委托）解锁',
  },
};

export function isCellDisabledForShip(shipId: V2ShipId, x: number, y: number): boolean {
  const ship = V2_SHIPS[shipId];
  return ship.disabledCells.some((c) => c.x === x && c.y === y);
}

export function isCellValidForShip(shipId: V2ShipId, x: number, y: number): boolean {
  const ship = V2_SHIPS[shipId];
  if (x < 0 || y < 0 || x >= ship.cols || y >= ship.rows) return false;
  return !isCellDisabledForShip(shipId, x, y);
}

export function getAllValidCellsForShip(shipId: V2ShipId): readonly V2GridCoord[] {
  const ship = V2_SHIPS[shipId];
  const out: V2GridCoord[] = [];
  for (let y = 0; y < ship.rows; y++) {
    for (let x = 0; x < ship.cols; x++) {
      if (!isCellDisabledForShip(shipId, x, y)) {
        out.push({ x, y });
      }
    }
  }
  return out;
}
