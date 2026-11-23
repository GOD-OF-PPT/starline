import {
  V2_EQUIPMENT_DEFS,
  V2_MAX_BATTLE_SHIELD,
  V2_MAX_POST_WIN_REPAIR,
  getEffectiveV2EquipmentBudgetCost,
  type V2EquipmentKind,
  type V2Quality,
} from '../data/equipment';
import { getV3GadgetDef } from '../data/gadgets';
import { V2_SHIPS } from '../data/ships';
import {
  areV2PlacedItemsAdjacent,
  doesV2PlacedItemTouchPowerCell,
} from './inventoryV2';
import type { V2CargoBayState, V2PlacedItem } from './types';

export interface V2AdjacencyLink {
  readonly sourceInstanceId: string;
  readonly sourceKind: V2EquipmentKind;
  readonly targetInstanceId: string;
  readonly targetKind: V2EquipmentKind | 'cargo';
  readonly label: string;
}

export interface V2LaserComputed {
  readonly instanceId: string;
  readonly quality: V2Quality;
  readonly baseDamage: number;
  readonly batteryBonus: number;
  readonly overdriveBonus: number;
  readonly powerCellBonus: number;
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
  readonly coolantBonus: number;
  readonly overdriveBonus: number;
  readonly powerCellBonus: number;
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

export interface V2SalvoComputed {
  readonly instanceId: string;
  readonly quality: V2Quality;
  readonly missiles: number;
  readonly damagePerMissile: number;
  readonly coolantBonus: number;
  readonly overdriveBonus: number;
  readonly powerCellBoosted: boolean;
}

export interface V2EmpJammerComputed {
  readonly instanceId: string;
  readonly quality: V2Quality;
  readonly damage: number;
  readonly shieldShred: number;
  readonly empResist: number;
  readonly enemyWeakenEveryRound: boolean;
}

export interface V2CoolantVentComputed {
  readonly instanceId: string;
  readonly quality: V2Quality;
  readonly shieldBonus: number;
  readonly endOfRoundShieldRegen: number;
  readonly cryoResist: number;
}

export interface V2OverdriveCoreComputed {
  readonly instanceId: string;
  readonly quality: V2Quality;
  readonly coreAttackBonus: number;
  readonly directWeaponBonus: number;
  readonly multiHitBonus: number;
}

export interface V2CargoAmpComputed {
  readonly instanceId: string;
  readonly quality: V2Quality;
  readonly adjacentCargoCount: number;
  readonly coreAttackBonus: number;
  readonly shieldBonus: number;
}

export interface V2SalvageGrappleComputed {
  readonly instanceId: string;
  readonly quality: V2Quality;
  readonly damage: number;
  readonly wreckStabilityBonus: number;
  readonly wreckHullReduction: number;
  readonly bonusSalvageParts: number;
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
  readonly salvos: readonly V2SalvoComputed[];
  readonly empJammers: readonly V2EmpJammerComputed[];
  readonly coolantVents: readonly V2CoolantVentComputed[];
  readonly overdriveCores: readonly V2OverdriveCoreComputed[];
  readonly cargoAmps: readonly V2CargoAmpComputed[];
  readonly salvageGrapples: readonly V2SalvageGrappleComputed[];
  readonly activeCounters: readonly V2CounterComputed[];
  /** Highest-quality active counter on the ship (triggers at most once per round, §7.2) */
  readonly bestActiveCounter: V2CounterComputed | null;
  readonly endOfRoundShieldRegen: number;
  readonly cryoDrainReduction: number;
  readonly empDrainReduction: number;
  readonly enemyWeakenAmount: number;
  readonly enemyWeakenEveryRound: boolean;
  readonly wreckStabilityBonus: number;
  readonly wreckHullDamageReduction: number;
  readonly bonusSalvagePartsPerWin: number;
  readonly bonusSalvagePartsPerCut: number;
  readonly powerCellBoostedIds: readonly string[];
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
  const eqItems: {
    placed: V2PlacedItem;
    kind: V2EquipmentKind;
    quality: V2Quality;
    powerBoosted: boolean;
  }[] = [];
  const cargoItems: V2PlacedItem[] = [];

  let totalPlacedBudget = 0;
  let nonLoanBayValue = 0;

  for (const placed of bay.placed) {
    if (placed.item.origin === 'owned' || placed.item.origin === 'loot') {
      nonLoanBayValue += placed.item.fixedValue;
    }
    const def = V2_EQUIPMENT_DEFS[placed.item.definitionId];
    if (def) {
      totalPlacedBudget += getEffectiveV2EquipmentBudgetCost(def, placed.item.origin);
      const powerBoosted = doesV2PlacedItemTouchPowerCell(bay, placed);
      eqItems.push({ placed, kind: def.kind, quality: def.quality, powerBoosted });
    } else if (placed.item.category === 'gadget') {
      const gd = getV3GadgetDef(placed.item.definitionId);
      if (gd) {
        totalPlacedBudget += gd.budgetCost;
      }
    } else if (placed.item.category === 'cargo' || placed.item.category === 'mission') {
      cargoItems.push(placed);
    }
  }

  // Deterministic ordering by instanceId (§8.2)
  eqItems.sort((a, b) => a.placed.item.instanceId.localeCompare(b.placed.item.instanceId));
  cargoItems.sort((a, b) => a.item.instanceId.localeCompare(b.item.instanceId));

  const powerCellBoostedIds = eqItems
    .filter((e) => e.powerBoosted)
    .map((e) => e.placed.item.instanceId);

  const batteries = eqItems.filter((e) => e.kind === 'battery');
  const shields = eqItems.filter((e) => e.kind === 'shield');
  const capacitors = eqItems.filter((e) => e.kind === 'capacitor');
  const relays = eqItems.filter((e) => e.kind === 'relay');
  const counters = eqItems.filter((e) => e.kind === 'counter');
  const coolantRaw = eqItems.filter((e) => e.kind === 'coolant_vent');
  const overdriveRaw = eqItems.filter((e) => e.kind === 'overdrive_core');
  const cargoAmpRaw = eqItems.filter((e) => e.kind === 'cargo_amp');
  const empRaw = eqItems.filter((e) => e.kind === 'emp_jammer');
  const grappleRaw = eqItems.filter((e) => e.kind === 'salvage_grapple');
  const salvoRaw = eqItems.filter((e) => e.kind === 'salvo_pod');

  const links: V2AdjacencyLink[] = [];

  // Helper: best adjacent overdrive_core for a given weapon
  const findBestOverdrive = (
    targetPlaced: V2PlacedItem,
    targetKind: V2EquipmentKind,
    mode: 'direct' | 'multi'
  ): number => {
    let bestBonus = 0;
    let bestId: string | null = null;
    for (const ov of overdriveRaw) {
      if (areV2PlacedItemsAdjacent(targetPlaced, ov.placed)) {
        const bonus =
          mode === 'direct'
            ? ov.quality === 'improved'
              ? 3
              : 2
            : ov.quality === 'improved'
            ? 2
            : 1;
        if (bonus > bestBonus) {
          bestBonus = bonus;
          bestId = ov.placed.item.instanceId;
        }
      }
    }
    if (bestId && bestBonus > 0) {
      links.push({
        sourceInstanceId: bestId,
        sourceKind: 'overdrive_core',
        targetInstanceId: targetPlaced.item.instanceId,
        targetKind,
        label: mode === 'direct' ? `超频+${bestBonus}` : `超频+${bestBonus}/发`,
      });
    }
    return bestBonus;
  };

  // Helper: best adjacent coolant_vent for heavy/salvo
  const findBestCoolantBonus = (
    targetPlaced: V2PlacedItem,
    targetKind: V2EquipmentKind
  ): number => {
    let bestBonus = 0;
    let bestId: string | null = null;
    for (const cv of coolantRaw) {
      if (areV2PlacedItemsAdjacent(targetPlaced, cv.placed)) {
        const bonus = cv.quality === 'improved' ? 3 : 2;
        if (bonus > bestBonus) {
          bestBonus = bonus;
          bestId = cv.placed.item.instanceId;
        }
      }
    }
    if (bestId && bestBonus > 0) {
      links.push({
        sourceInstanceId: bestId,
        sourceKind: 'coolant_vent',
        targetInstanceId: targetPlaced.item.instanceId,
        targetKind,
        label: `排热+${bestBonus}`,
      });
    }
    return bestBonus;
  };

  // Core attack (base ship + overdrive_core + cargo_amp + support power cell bonuses)
  let coreAttack = ship.coreAttack;

  // Overdrive cores
  const overdriveCores: V2OverdriveCoreComputed[] = [];
  for (const ov of overdriveRaw) {
    const bonus = (ov.quality === 'improved' ? 3 : 2) + (ov.powerBoosted ? 1 : 0);
    coreAttack += bonus;
    overdriveCores.push({
      instanceId: ov.placed.item.instanceId,
      quality: ov.quality,
      coreAttackBonus: bonus,
      directWeaponBonus: ov.quality === 'improved' ? 3 : 2,
      multiHitBonus: ov.quality === 'improved' ? 2 : 1,
    });
  }

  // Cargo amps (base +1/+2 coreAttack + adjacent cargo/mission resonance)
  const cargoAmps: V2CargoAmpComputed[] = [];
  let cargoAmpShieldTotal = 0;
  for (const ca of cargoAmpRaw) {
    let adjCount = 0;
    for (const cg of cargoItems) {
      if (areV2PlacedItemsAdjacent(ca.placed, cg)) {
        adjCount += 1;
        links.push({
          sourceInstanceId: ca.placed.item.instanceId,
          sourceKind: 'cargo_amp',
          targetInstanceId: cg.item.instanceId,
          targetKind: 'cargo',
          label: ca.quality === 'improved' ? '谐振+2' : '谐振+1',
        });
      }
    }
    const perCargoAtk = ca.quality === 'improved' ? 2 : 1;
    const maxExtraAtk = ca.quality === 'improved' ? 5 : 3;
    const extraAtk = Math.min(maxExtraAtk, adjCount * perCargoAtk);
    const totalCoreBonus = (ca.quality === 'improved' ? 2 : 1) + extraAtk + (ca.powerBoosted ? 1 : 0);
    const shieldBonus = adjCount * (ca.quality === 'improved' ? 3 : 2);
    coreAttack += totalCoreBonus;
    cargoAmpShieldTotal += shieldBonus;
    cargoAmps.push({
      instanceId: ca.placed.item.instanceId,
      quality: ca.quality,
      adjacentCargoCount: adjCount,
      coreAttackBonus: totalCoreBonus,
      shieldBonus,
    });
  }

  // Support modules on power cells grant +1 coreAttack
  for (const sup of [...batteries, ...capacitors, ...relays]) {
    if (sup.powerBoosted) {
      coreAttack += 1;
    }
  }

  // 1. Lasers + best adjacent battery + overdrive + power cell
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
    const overdriveBonus = findBestOverdrive(l.placed, 'laser', 'direct');
    const powerCellBonus = l.powerBoosted ? 1 : 0;
    const baseDamage = l.quality === 'improved' ? 4 : 3;
    lasers.push({
      instanceId: l.placed.item.instanceId,
      quality: l.quality,
      baseDamage,
      batteryBonus: bestBonus,
      overdriveBonus,
      powerCellBonus,
      totalDamage: baseDamage + bestBonus + overdriveBonus + powerCellBonus,
    });
  }

  // 2. Heavy cannons + highest quality adjacent capacitor + coolant + overdrive + power cell
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
    const coolantBonus = findBestCoolantBonus(h.placed, 'heavy');
    const overdriveBonus = findBestOverdrive(h.placed, 'heavy', 'direct');
    const powerCellBonus = h.powerBoosted ? 3 : 0;
    heavies.push({
      instanceId: h.placed.item.instanceId,
      quality: h.quality,
      baseDamage: (h.quality === 'improved' ? 15 : 12) + coolantBonus + overdriveBonus + powerCellBonus,
      capacitorQuality: bestCapQ,
      firesOnOddRounds: bestCapQ !== null,
      firstShotBonus: bestCapQ === 'improved' ? 3 : 0,
      coolantBonus,
      overdriveBonus,
      powerCellBonus,
    });
  }

  // 3. Drone hangars + highest quality adjacent relay + overdrive + power cell
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
    const overdriveBonus = findBestOverdrive(hg.placed, 'hangar', 'multi');
    const maxDrones = bestRelQ ? 4 : 3;
    const baseR1Bonus = bestRelQ === 'improved' ? 1 : 0;
    const roundOneBonusDrones = Math.min(maxDrones - 1, baseR1Bonus + (hg.powerBoosted ? 1 : 0));
    hangars.push({
      instanceId: hg.placed.item.instanceId,
      quality: hg.quality,
      damagePerDrone: (hg.quality === 'improved' ? 3 : 2) + overdriveBonus,
      relayQuality: bestRelQ,
      maxDrones,
      roundOneBonusDrones,
    });
  }

  // 4. Flak arrays + overdrive + power cell
  const flaks: V2FlakComputed[] = eqItems
    .filter((e) => e.kind === 'flak')
    .map((f) => {
      const overdriveBonus = findBestOverdrive(f.placed, 'flak', 'multi');
      return {
        instanceId: f.placed.item.instanceId,
        quality: f.quality,
        damagePerEnemy: (f.quality === 'improved' ? 3 : 2) + overdriveBonus + (f.powerBoosted ? 1 : 0),
      };
    });

  // 4b. Salvo Pods (3 missiles base; +1 if adjacent to capacitor/relay; +1 if on power cell; +coolant/overdrive)
  const salvos: V2SalvoComputed[] = [];
  for (const sv of salvoRaw) {
    let supportLinked = false;
    for (const sup of [...capacitors, ...relays]) {
      if (areV2PlacedItemsAdjacent(sv.placed, sup.placed)) {
        supportLinked = true;
        links.push({
          sourceInstanceId: sup.placed.item.instanceId,
          sourceKind: sup.kind,
          targetInstanceId: sv.placed.item.instanceId,
          targetKind: 'salvo_pod',
          label: '导弹+1枚',
        });
        break;
      }
    }
    const coolantBonus = findBestCoolantBonus(sv.placed, 'salvo_pod');
    const overdriveBonus = findBestOverdrive(sv.placed, 'salvo_pod', 'multi');
    const missiles = 3 + (supportLinked ? 1 : 0) + (sv.powerBoosted ? 1 : 0);
    const damagePerMissile = (sv.quality === 'improved' ? 3 : 2) + overdriveBonus;
    salvos.push({
      instanceId: sv.placed.item.instanceId,
      quality: sv.quality,
      missiles,
      damagePerMissile,
      coolantBonus,
      overdriveBonus,
      powerCellBoosted: sv.powerBoosted,
    });
  }

  // 4c. EMP Jammers
  const empJammers: V2EmpJammerComputed[] = [];
  let empDrainReduction = 0;
  let enemyWeakenAmount = 0;
  let enemyWeakenEveryRound = false;
  for (const ej of empRaw) {
    const overdriveBonus = findBestOverdrive(ej.placed, 'emp_jammer', 'direct');
    const damage = (ej.quality === 'improved' ? 3 : 2) + overdriveBonus + (ej.powerBoosted ? 1 : 0);
    const shieldShred = (ej.quality === 'improved' ? 5 : 3) + (ej.powerBoosted ? 1 : 0);
    const empResist = ej.quality === 'improved' ? 3 : 2;
    const everyRound = ej.quality === 'improved';
    empDrainReduction += empResist;
    enemyWeakenAmount = Math.max(enemyWeakenAmount, 1);
    if (everyRound) enemyWeakenEveryRound = true;
    empJammers.push({
      instanceId: ej.placed.item.instanceId,
      quality: ej.quality,
      damage,
      shieldShred,
      empResist,
      enemyWeakenEveryRound: everyRound,
    });
  }

  // 4d. Salvage Grapples
  const salvageGrapples: V2SalvageGrappleComputed[] = [];
  let wreckStabilityBonus = 0;
  let wreckHullDamageReduction = 0;
  let bonusSalvagePartsPerWin = 0;
  let bonusSalvagePartsPerCut = 0;
  for (const gr of grappleRaw) {
    const overdriveBonus = findBestOverdrive(gr.placed, 'salvage_grapple', 'direct');
    const damage = (gr.quality === 'improved' ? 3 : 2) + overdriveBonus;
    const stabBonus = gr.quality === 'improved' ? 18 : 10;
    const hullRed = gr.quality === 'improved' ? 2 : 1;
    const partsBonus = (gr.quality === 'improved' ? 4 : 2) + (gr.powerBoosted ? 1 : 0);
    wreckStabilityBonus += stabBonus;
    wreckHullDamageReduction += hullRed;
    bonusSalvagePartsPerWin += partsBonus;
    bonusSalvagePartsPerCut += partsBonus;
    salvageGrapples.push({
      instanceId: gr.placed.item.instanceId,
      quality: gr.quality,
      damage,
      wreckStabilityBonus: stabBonus,
      wreckHullReduction: hullRed,
      bonusSalvageParts: partsBonus,
    });
  }

  // 4e. Coolant Vents
  const coolantVents: V2CoolantVentComputed[] = [];
  let coolantShieldTotal = 0;
  let endOfRoundShieldRegen = 0;
  let cryoDrainReduction = 0;
  for (const cv of coolantRaw) {
    const shieldBonus = cv.quality === 'improved' ? 6 : 4;
    const regen = (cv.quality === 'improved' ? 2 : 1) + (cv.powerBoosted ? 1 : 0);
    const cryoResist = cv.quality === 'improved' ? 2 : 1;
    coolantShieldTotal += shieldBonus;
    endOfRoundShieldRegen += regen;
    cryoDrainReduction += cryoResist;
    coolantVents.push({
      instanceId: cv.placed.item.instanceId,
      quality: cv.quality,
      shieldBonus,
      endOfRoundShieldRegen: regen,
      cryoResist,
    });
  }

  // 5. Shields (strictly capped at V2_MAX_BATTLE_SHIELD = 20!)
  let rawShield = ship.bonusShield + coolantShieldTotal + cargoAmpShieldTotal;
  for (const s of shields) {
    rawShield += (s.quality === 'improved' ? 8 : 6) + (s.powerBoosted ? 2 : 0);
  }
  for (const ct of counters) {
    rawShield += (ct.quality === 'improved' ? 5 : 4) + (ct.powerBoosted ? 1 : 0);
  }
  const effectiveShield = Math.min(V2_MAX_BATTLE_SHIELD, rawShield);

  // 6. Active Counters (must be adjacent to at least one Shield; ship-wide highest quality fires ONCE/round)
  const activeCounters: V2CounterComputed[] = [];
  for (const ct of counters) {
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
        maxDamage: (ct.quality === 'improved' ? 5 : 4) + (ct.powerBoosted ? 1 : 0),
      });
    }
  }
  let bestActiveCounter: V2CounterComputed | null = null;
  for (const ct of activeCounters) {
    if (
      !bestActiveCounter ||
      (ct.quality === 'improved' && bestActiveCounter.quality !== 'improved') ||
      (ct.quality === bestActiveCounter.quality && ct.maxDamage > bestActiveCounter.maxDamage)
    ) {
      bestActiveCounter = ct;
    }
  }

  // 7. Repair drones (strictly capped at V2_MAX_POST_WIN_REPAIR = 4!)
  let rawRepair = 0;
  for (const rp of eqItems.filter((e) => e.kind === 'repair')) {
    rawRepair += (rp.quality === 'improved' ? 3 : 2) + (rp.powerBoosted ? 1 : 0);
  }
  const effectiveRepair = Math.min(V2_MAX_POST_WIN_REPAIR, rawRepair);

  // Round 1 nominal single-target damage estimate for HUD
  let nominalRound1SingleDmg = coreAttack;
  for (const l of lasers) nominalRound1SingleDmg += l.totalDamage;
  for (const h of heavies) {
    if (h.firesOnOddRounds) nominalRound1SingleDmg += h.baseDamage + h.firstShotBonus;
  }
  for (const hg of hangars) {
    const r1Drones = Math.min(hg.maxDrones, 1 + hg.roundOneBonusDrones);
    nominalRound1SingleDmg += r1Drones * hg.damagePerDrone;
  }
  for (const sv of salvos) {
    nominalRound1SingleDmg += sv.missiles * sv.damagePerMissile + sv.coolantBonus;
  }
  for (const ej of empJammers) nominalRound1SingleDmg += ej.damage;
  for (const gr of salvageGrapples) nominalRound1SingleDmg += gr.damage;
  for (const f of flaks) nominalRound1SingleDmg += f.damagePerEnemy;

  return {
    coreAttack,
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
    salvos,
    empJammers,
    coolantVents,
    overdriveCores,
    cargoAmps,
    salvageGrapples,
    activeCounters,
    bestActiveCounter,
    endOfRoundShieldRegen,
    cryoDrainReduction,
    empDrainReduction,
    enemyWeakenAmount,
    enemyWeakenEveryRound,
    wreckStabilityBonus,
    wreckHullDamageReduction,
    bonusSalvagePartsPerWin,
    bonusSalvagePartsPerCut,
    powerCellBoostedIds,
    links,
    nominalRound1SingleDmg,
    totalPlacedBudget,
    nonLoanBayValue,
  };
}

