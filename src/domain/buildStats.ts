import { getItemDef, SHIP_CORE, type EquipmentDefinition } from '../data/items';
import { areCellSetsOrthogonallyAdjacent, type GridCoord } from '../data/shapes';
import { getPlacedItemCells, type CargoBayState, type PlacedItem } from './inventory';

export interface BatteryLaserLink {
  readonly batteryInstanceId: string;
  readonly laserInstanceId: string;
  readonly bonus: number;
  readonly batteryCell: GridCoord;
  readonly laserCell: GridCoord;
}

export interface LaserBreakdown {
  readonly instanceId: string;
  readonly baseAttack: number;
  readonly batteryBonus: number;
  readonly totalAttack: number;
  readonly sourceBatteryId: string | null;
}

export interface BuildStats {
  readonly maxHp: number;
  readonly baseAttack: number;
  readonly laserBaseAttack: number;
  readonly batteryBonusAttack: number;
  readonly totalAttack: number;
  readonly rawShield: number;
  readonly effectiveShield: number;
  readonly shieldCapped: boolean;
  readonly shieldOverflow: number;
  readonly rawRepair: number;
  readonly effectiveRepair: number;
  readonly repairCapped: boolean;
  readonly repairOverflow: number;
  readonly links: readonly BatteryLaserLink[];
  readonly laserBreakdowns: readonly LaserBreakdown[];
  readonly cargoSellValue: number;
  readonly equipmentRecycleValue: number;
  readonly totalBayValue: number;
  readonly occupiedCellCount: number;
}

function findSharedAdjacentPair(
  aCells: readonly GridCoord[],
  bCells: readonly GridCoord[]
): { readonly a: GridCoord; readonly b: GridCoord } | null {
  for (const a of aCells) {
    for (const b of bCells) {
      if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1) {
        return { a, b };
      }
    }
  }
  return null;
}

/**
 * Deterministic calculation of ship combat & economic stats from PLACED items only.
 * Staging and discarded items NEVER contribute to attack, shield, repair, or bay valuation.
 */
export function calculateBuildStats(bay: CargoBayState): BuildStats {
  const lasers: { entry: PlacedItem; def: EquipmentDefinition; cells: GridCoord[] }[] = [];
  const batteries: { entry: PlacedItem; def: EquipmentDefinition; cells: GridCoord[] }[] = [];

  let rawShield = 0;
  let rawRepair = 0;
  let cargoSellValue = 0;
  let equipmentRecycleValue = 0;
  let occupiedCellCount = 0;

  for (const entry of bay.placed) {
    const def = getItemDef(entry.item.defId);
    const cells = getPlacedItemCells(entry);
    occupiedCellCount += cells.length;

    if (def.category === 'cargo') {
      cargoSellValue += entry.item.value;
    } else {
      if (!entry.item.isBorrowed) {
        equipmentRecycleValue += entry.item.value;
      }
      if (def.kind === 'laser') {
        lasers.push({ entry, def, cells });
      } else if (def.kind === 'battery') {
        batteries.push({ entry, def, cells });
      } else if (def.kind === 'shield') {
        rawShield += def.shieldBonus;
      } else if (def.kind === 'drone') {
        rawRepair += def.postVictoryRepair;
      }
    }
  }

  let laserBaseAttack = 0;
  let batteryBonusAttack = 0;
  const links: BatteryLaserLink[] = [];
  const laserBreakdowns: LaserBreakdown[] = [];

  // Sort batteries deterministically so tie-breaking for equal-bonus links is always stable
  const sortedBatteries = [...batteries].sort((a, b) =>
    a.entry.item.instanceId.localeCompare(b.entry.item.instanceId)
  );

  for (const laser of lasers) {
    laserBaseAttack += laser.def.attackBonus;

    let bestBonus = 0;
    let bestBattery: (typeof sortedBatteries)[number] | null = null;

    for (const battery of sortedBatteries) {
      if (!areCellSetsOrthogonallyAdjacent(laser.cells, battery.cells)) continue;
      if (battery.def.adjacentLaserBonus > bestBonus) {
        bestBonus = battery.def.adjacentLaserBonus;
        bestBattery = battery;
      }
    }

    if (bestBattery && bestBonus > 0) {
      batteryBonusAttack += bestBonus;
      const pair = findSharedAdjacentPair(bestBattery.cells, laser.cells);
      if (pair) {
        links.push({
          batteryInstanceId: bestBattery.entry.item.instanceId,
          laserInstanceId: laser.entry.item.instanceId,
          bonus: bestBonus,
          batteryCell: pair.a,
          laserCell: pair.b,
        });
      }
    }

    laserBreakdowns.push({
      instanceId: laser.entry.item.instanceId,
      baseAttack: laser.def.attackBonus,
      batteryBonus: bestBonus,
      totalAttack: laser.def.attackBonus + bestBonus,
      sourceBatteryId: bestBattery ? bestBattery.entry.item.instanceId : null,
    });
  }

  const effectiveShield = Math.min(SHIP_CORE.maxShield, rawShield);
  const shieldOverflow = Math.max(0, rawShield - SHIP_CORE.maxShield);
  const shieldCapped = rawShield >= SHIP_CORE.maxShield;

  const effectiveRepair = Math.min(SHIP_CORE.maxRepairPerCombat, rawRepair);
  const repairOverflow = Math.max(0, rawRepair - SHIP_CORE.maxRepairPerCombat);
  const repairCapped = rawRepair >= SHIP_CORE.maxRepairPerCombat;

  return {
    maxHp: SHIP_CORE.maxHp,
    baseAttack: SHIP_CORE.baseAttack,
    laserBaseAttack,
    batteryBonusAttack,
    totalAttack: SHIP_CORE.baseAttack + laserBaseAttack + batteryBonusAttack,
    rawShield,
    effectiveShield,
    shieldCapped,
    shieldOverflow,
    rawRepair,
    effectiveRepair,
    repairCapped,
    repairOverflow,
    links,
    laserBreakdowns,
    cargoSellValue,
    equipmentRecycleValue,
    totalBayValue: cargoSellValue + equipmentRecycleValue,
    occupiedCellCount,
  };
}
