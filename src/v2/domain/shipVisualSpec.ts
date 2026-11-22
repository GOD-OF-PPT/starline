import { V2_EQUIPMENT_DEFS } from '../data/equipment';
import { V2_SHAPES } from '../data/shapes';
import type { V2ShipId } from '../data/ships';
import { calculateV2BuildStats } from './buildStatsV2';
import { getAnyV2ItemDef } from './itemCatalog';
import type { V2CargoBayState } from './types';

/**
 * Pure data-driven description of external modules mounted on the player ship hull.
 * Strictly derived from real `bay.placed` definitions and `calculateV2BuildStats` —
 * never guesses from item names or colors, and never invents stats.
 */
export interface V2ShipVisualSpec {
  readonly shipId: V2ShipId;
  readonly laserCount: number;
  readonly laserBoosted: boolean;
  readonly laserImproved: boolean;
  readonly heavyCount: number;
  readonly heavyBoosted: boolean;
  readonly heavyImproved: boolean;
  readonly hangarCount: number;
  readonly hangarBoosted: boolean;
  readonly hangarMaxDrones: number;
  readonly flakCount: number;
  readonly shieldCount: number;
  readonly effectiveShield: number;
  readonly hasCounter: boolean;
  readonly counterActive: boolean;
  readonly counterImproved: boolean;
  readonly hasRepairDrone: boolean;
  readonly hasSealedReactor: boolean;
  readonly escapePodCount: number;
  readonly cargoCellCount: number;
  readonly cargoMassTier: 0 | 1 | 2;
  readonly mountSummaryTags: readonly string[];
}

export function deriveV2ShipVisualSpec(bay: V2CargoBayState): V2ShipVisualSpec {
  const stats = calculateV2BuildStats(bay);

  let shieldCount = 0;
  let hasCounter = false;
  let hasRepairDrone = false;
  let hasSealedReactor = false;
  let escapePodCount = 0;
  let cargoCellCount = 0;

  for (const placed of bay.placed) {
    const defId = placed.item.definitionId;
    const eq = V2_EQUIPMENT_DEFS[defId];
    if (eq) {
      if (eq.kind === 'shield') shieldCount += 1;
      if (eq.kind === 'counter') hasCounter = true;
      if (eq.kind === 'repair') hasRepairDrone = true;
      continue;
    }

    if (defId === 'mission.sealed_reactor') {
      hasSealedReactor = true;
    } else if (defId === 'mission.escape_pod') {
      escapePodCount += 1;
    }

    const anyDef = getAnyV2ItemDef(defId);
    if (anyDef) {
      cargoCellCount += V2_SHAPES[anyDef.shapeId].cells.length;
    }
  }

  const laserCount = stats.lasers.length;
  const laserBoosted = stats.lasers.some((l) => l.batteryBonus > 0);
  const laserImproved = stats.lasers.some((l) => l.quality === 'improved');

  const heavyCount = stats.heavies.length;
  const heavyBoosted = stats.heavies.some((h) => h.firesOnOddRounds);
  const heavyImproved = stats.heavies.some((h) => h.quality === 'improved');

  const hangarCount = stats.hangars.length;
  const hangarBoosted = stats.hangars.some((h) => h.relayQuality !== null);
  const hangarMaxDrones = stats.hangars.reduce((sum, h) => sum + h.maxDrones, 0);

  const flakCount = stats.flaks.length;
  const counterActive = stats.bestActiveCounter !== null;
  const counterImproved = stats.bestActiveCounter?.quality === 'improved';
  const cargoMassTier: 0 | 1 | 2 =
    hasSealedReactor || cargoCellCount >= 6 ? 2 : cargoCellCount >= 2 ? 1 : 0;

  const mountSummaryTags: string[] = [];
  if (heavyCount > 0) {
    mountSummaryTags.push(`磁轨重炮×${heavyCount}${heavyBoosted ? '·先手' : ''}`);
  }
  if (laserCount > 0) {
    mountSummaryTags.push(`脉冲炮塔×${laserCount}${laserBoosted ? '·充能' : ''}`);
  }
  if (hangarCount > 0) {
    mountSummaryTags.push(`无人机舱×${hangarCount}·上限${hangarMaxDrones}`);
  }
  if (flakCount > 0) {
    mountSummaryTags.push(`防空阵列×${flakCount}`);
  }
  if (counterActive) {
    mountSummaryTags.push(`反击环·激活`);
  } else if (hasCounter) {
    mountSummaryTags.push(`反击环·待接护盾`);
  } else if (stats.effectiveShield > 0) {
    mountSummaryTags.push(`护盾 ${stats.effectiveShield}`);
  }
  if (hasSealedReactor) {
    mountSummaryTags.push('外挂密封反应堆');
  } else if (escapePodCount > 0) {
    mountSummaryTags.push(`外挂救生舱×${escapePodCount}`);
  }
  if (hasRepairDrone) {
    mountSummaryTags.push('维修蜂坞');
  }

  return {
    shipId: bay.shipId,
    laserCount,
    laserBoosted,
    laserImproved,
    heavyCount,
    heavyBoosted,
    heavyImproved,
    hangarCount,
    hangarBoosted,
    hangarMaxDrones,
    flakCount,
    shieldCount,
    effectiveShield: stats.effectiveShield,
    hasCounter,
    counterActive,
    counterImproved,
    hasRepairDrone,
    hasSealedReactor,
    escapePodCount,
    cargoCellCount,
    cargoMassTier,
    mountSummaryTags,
  };
}
