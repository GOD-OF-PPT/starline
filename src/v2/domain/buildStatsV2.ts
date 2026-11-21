import {
  V2_EQUIPMENT_DEFS,
  V2_MAX_BATTLE_SHIELD,
  V2_MAX_POST_WIN_REPAIR,
  type V2EquipmentKind,
  type V2Quality,
} from '../data/equipment';
import { V2_SHIPS } from '../data/ships';
import { areV2PlacedItemsAdjacent } from './inventoryV2';
import type { V2CargoBayState, V2PlacedItem } from './types';

export interface V2AdjacencyLink {
  readonly sourceInstanceId: string;
  readonly sourceKind: V2EquipmentKind;
  readonly targetInstanceId: string;
  readonly targetKind: V2EquipmentKind;
  readonly label: string;
}

export interface V2LaserComputed {
  readonly instanceId: string;
  readonly quality: V2Quality;
  readonly baseDamage: number;
  readonly batteryBonus: number;
  readonly totalDamage: number;
}

export interface V2HeavyComputed {
  readonly instanceId: string;
  readonly quality: V2Quality;
  readonly baseDamage: number;
  readonly capacitorQuality: V2Quality | null;
  /** True if fires on odd rounds (1,3,5...), false if even rounds (2,4,6...) */
  readonly firesOnOddRounds: boolean;
  readonly firstShotBonus: number;
}

export interface V2HangarComputed {
  readonly instanceId: string;
  readonly quality: V2Quality;
  readonly damagePerDrone: number;
  readonly relayQuality: V2Quality | null;
  readonly maxDrones: number;
  readonly roundOneBonusDrones: number;
}

export interface V2FlakComputed {
  readonly instanceId: string;
  readonly quality: V2Quality;
  readonly damagePerEnemy: number;
}

export interface V2CounterComputed {
  readonly instanceId: string;
  readonly quality: V2Quality;
  readonly ratio: number;
  readonly maxDamage: number;
}

export interface V2BuildStats {
  readonly coreAttack: number;
  readonly hullBonusShield: number;
  readonly rawShield: number;
  readonly effectiveShield: number;
  readonly shieldCapped: boolean;
  readonly rawRepair: number;
  readonly effectiveRepair: number;
  readonly repairCapped: boolean;
  readonly lasers: readonly V2LaserComputed[];
  readonly heavies: readonly V2HeavyComputed[];
  readonly hangars: readonly V2HangarComputed[];
  readonly flaks: readonly V2FlakComputed[];
  readonly activeCounters: readonly V2CounterComputed[];
  /** Highest-quality active counter on the ship (triggers at most once per round, §7.2) */
  readonly bestActiveCounter: V2CounterComputed | null;
  readonly links: readonly V2AdjacencyLink[];
  /** Estimated steady per-round single-target summary for quick HUD readout */
  readonly nominalRound1SingleDmg: number;
  readonly totalPlacedBudget: number;
  readonly nonLoanBayValue: number;
}

function compareQuality(a: V2Quality | null, b: V2Quality): V2Quality {
  if (a === 'improved' || b === 'improved') return 'improved';
  return 'common';
}

export function calculateV2BuildStats(bay: V2CargoBayState): V2BuildStats {
  const ship = V2_SHIPS[bay.shipId];
  const eqItems: { placed: V2PlacedItem; kind: V2EquipmentKind; quality: V2Quality }[] = [];

  let totalPlacedBudget = 0;
  let nonLoanBayValue = 0;

  for (const placed of bay.placed) {
    if (placed.item.origin === 'owned' || placed.item.origin === 'loot') {
      nonLoanBayValue += placed.item.fixedValue;
    }
    const def = V2_EQUIPMENT_DEFS[placed.item.definitionId];
    if (def) {
      totalPlacedBudget += def.budgetCost;
      eqItems.push({ placed, kind: def.kind, quality: def.quality });
    }
  }

  // Deterministic ordering by instanceId (§8.2)
  eqItems.sort((a, b) => a.placed.item.instanceId.localeCompare(b.placed.item.instanceId));

  const batteries = eqItems.filter((e) => e.kind === 'battery');
  const shields = eqItems.filter((e) => e.kind === 'shield');
  const capacitors = eqItems.filter((e) => e.kind === 'capacitor');
  const relays = eqItems.filter((e) => e.kind === 'relay');

  const links: V2AdjacencyLink[] = [];

  // 1. Lasers + best adjacent battery
  const lasers: V2LaserComputed[] = [];
  for (const l of eqItems.filter((e) => e.kind === 'laser')) {
    let bestBonus = 0;
    let bestBatId: string | null = null;
    for (const b of batteries) {
      if (areV2PlacedItemsAdjacent(l.placed, b.placed)) {
        const bonus = b.quality === 'improved' ? 3 : 2;
        if (bonus > bestBonus) {
          bestBonus = bonus;
          bestBatId = b.placed.item.instanceId;
        }
      }
    }
    if (bestBatId) {
      links.push({
        sourceInstanceId: bestBatId,
        sourceKind: 'battery',
        targetInstanceId: l.placed.item.instanceId,
        targetKind: 'laser',
        label: `+${bestBonus}`,
      });
    }
    const baseDamage = l.quality === 'improved' ? 4 : 3;
    lasers.push({
      instanceId: l.placed.item.instanceId,
      quality: l.quality,
      baseDamage,
      batteryBonus: bestBonus,
      totalDamage: baseDamage + bestBonus,
    });
  }

  // 2. Heavy cannons + highest quality adjacent capacitor (multiple capacitors never accelerate further)
  const heavies: V2HeavyComputed[] = [];
  for (const h of eqItems.filter((e) => e.kind === 'heavy')) {
    let bestCapQ: V2Quality | null = null;
    let bestCapId: string | null = null;
    for (const c of capacitors) {
      if (areV2PlacedItemsAdjacent(h.placed, c.placed)) {
        const nextQ = compareQuality(bestCapQ, c.quality);
        if (nextQ !== bestCapQ) {
          bestCapQ = nextQ;
          bestCapId = c.placed.item.instanceId;
        }
      }
    }
    if (bestCapId && bestCapQ) {
      links.push({
        sourceInstanceId: bestCapId,
        sourceKind: 'capacitor',
        targetInstanceId: h.placed.item.instanceId,
        targetKind: 'heavy',
        label: bestCapQ === 'improved' ? '先手+3' : '先手',
      });
    }
    heavies.push({
      instanceId: h.placed.item.instanceId,
      quality: h.quality,
      baseDamage: h.quality === 'improved' ? 15 : 12,
      capacitorQuality: bestCapQ,
      firesOnOddRounds: bestCapQ !== null,
      firstShotBonus: bestCapQ === 'improved' ? 3 : 0,
    });
  }

  // 3. Drone hangars + highest quality adjacent relay
  const hangars: V2HangarComputed[] = [];
  for (const hg of eqItems.filter((e) => e.kind === 'hangar')) {
    let bestRelQ: V2Quality | null = null;
    let bestRelId: string | null = null;
    for (const r of relays) {
      if (areV2PlacedItemsAdjacent(hg.placed, r.placed)) {
        const nextQ = compareQuality(bestRelQ, r.quality);
        if (nextQ !== bestRelQ) {
          bestRelQ = nextQ;
          bestRelId = r.placed.item.instanceId;
        }
      }
    }
    if (bestRelId && bestRelQ) {
      links.push({
        sourceInstanceId: bestRelId,
        sourceKind: 'relay',
        targetInstanceId: hg.placed.item.instanceId,
        targetKind: 'hangar',
        label: bestRelQ === 'improved' ? '上限4/首+1' : '上限4',
      });
    }
    hangars.push({
      instanceId: hg.placed.item.instanceId,
      quality: hg.quality,
      damagePerDrone: hg.quality === 'improved' ? 3 : 2,
      relayQuality: bestRelQ,
      maxDrones: bestRelQ ? 4 : 3,
      roundOneBonusDrones: bestRelQ === 'improved' ? 1 : 0,
    });
  }

  // 4. Flak arrays
  const flaks: V2FlakComputed[] = eqItems
    .filter((e) => e.kind === 'flak')
    .map((f) => ({
      instanceId: f.placed.item.instanceId,
      quality: f.quality,
      damagePerEnemy: f.quality === 'improved' ? 3 : 2,
    }));

  // 5. Shields (cap 20 including hull bonus)
  let rawShield = ship.bonusShield;
  for (const s of shields) {
    rawShield += s.quality === 'improved' ? 8 : 6;
  }
  const effectiveShield = Math.min(V2_MAX_BATTLE_SHIELD, rawShield);

  // 6. Active Counters (must be adjacent to at least one Shield; ship-wide highest quality fires ONCE/round)
  const activeCounters: V2CounterComputed[] = [];
  for (const ct of eqItems.filter((e) => e.kind === 'counter')) {
    const adjShield = shields.find((s) => areV2PlacedItemsAdjacent(ct.placed, s.placed));
    if (adjShield) {
      links.push({
        sourceInstanceId: adjShield.placed.item.instanceId,
        sourceKind: 'shield',
        targetInstanceId: ct.placed.item.instanceId,
        targetKind: 'counter',
        label: ct.quality === 'improved' ? '反75%' : '反50%',
      });
      activeCounters.push({
        instanceId: ct.placed.item.instanceId,
        quality: ct.quality,
        ratio: ct.quality === 'improved' ? 0.75 : 0.5,
        maxDamage: ct.quality === 'improved' ? 5 : 4,
      });
    }
  }
  let bestActiveCounter: V2CounterComputed | null = null;
  for (const ct of activeCounters) {
    if (!bestActiveCounter || (ct.quality === 'improved' && bestActiveCounter.quality !== 'improved')) {
      bestActiveCounter = ct;
    }
  }

  // 7. Repair drones (cap 4)
  let rawRepair = 0;
  for (const rp of eqItems.filter((e) => e.kind === 'repair')) {
    rawRepair += rp.quality === 'improved' ? 3 : 2;
  }
  const effectiveRepair = Math.min(V2_MAX_POST_WIN_REPAIR, rawRepair);

  // Round 1 nominal single-target damage estimate for HUD
  let nominalRound1SingleDmg = ship.coreAttack;
  for (const l of lasers) nominalRound1SingleDmg += l.totalDamage;
  for (const h of heavies) {
    if (h.firesOnOddRounds) nominalRound1SingleDmg += h.baseDamage + h.firstShotBonus;
  }
  for (const hg of hangars) {
    const r1Drones = Math.min(hg.maxDrones, 1 + hg.roundOneBonusDrones);
    nominalRound1SingleDmg += r1Drones * hg.damagePerDrone;
  }
  for (const f of flaks) nominalRound1SingleDmg += f.damagePerEnemy;

  return {
    coreAttack: ship.coreAttack,
    hullBonusShield: ship.bonusShield,
    rawShield,
    effectiveShield,
    shieldCapped: rawShield > V2_MAX_BATTLE_SHIELD,
    rawRepair,
    effectiveRepair,
    repairCapped: rawRepair > V2_MAX_POST_WIN_REPAIR,
    lasers,
    heavies,
    hangars,
    flaks,
    activeCounters,
    bestActiveCounter,
    links,
    nominalRound1SingleDmg,
    totalPlacedBudget,
    nonLoanBayValue,
  };
}
