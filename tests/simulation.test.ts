import { describe, expect, it } from 'vitest';
import { getItemDef, type LoadoutId } from '../src/data/items';
import type { RouteType } from '../src/data/nodes';
import { calculateBuildStats } from '../src/domain/buildStats';
import { calculateSettlement } from '../src/domain/economy';
import {
  completeCombat,
  getRoutePreview,
  initiateSafeReturn,
  isAtFinalNode,
  proceedToNextNode,
  selectReward,
  selectRoute,
  startExpedition,
  updateArrangeBay,
  type ExpeditionState,
} from '../src/domain/expedition';
import {
  checkPlacement,
  discardItem,
  findFirstValidPlacement,
  placeFromStaging,
  type CargoBayState,
} from '../src/domain/inventory';
import { createInitialProgression } from '../src/domain/progression';

type StrategyName =
  | 'cargo_only'
  | 'cannon_stack'
  | 'shield_cannon_hybrid'
  | 'repair_sustain'
  | 'conservative_early'
  | 'deep_dive';

function placeOptimally(bay: CargoBayState, instanceId: string): CargoBayState {
  const staged = bay.staging.find((s) => s.item.instanceId === instanceId);
  if (!staged) return bay;
  const def = getItemDef(staged.item.defId);

  // Try all valid placements and maximize totalAttack + shield*0.6 + repair*1.5 + bayValue*0.2
  let bestBay: CargoBayState | null = null;
  let bestScore = -Infinity;

  for (const rot of [0, 1, 2, 3] as const) {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        if (!checkPlacement(bay, def.defId, x, y, rot).valid) continue;
        const placed = placeFromStaging(bay, instanceId, x, y, rot);
        if (!placed.ok) continue;
        const stats = calculateBuildStats(placed.bay);
        const score =
          stats.totalAttack * 4 +
          stats.effectiveShield * 1.5 +
          stats.effectiveRepair * 3 +
          stats.totalBayValue * 0.1;
        if (score > bestScore) {
          bestScore = score;
          bestBay = placed.bay;
        }
      }
    }
  }

  if (bestBay) return bestBay;
  const first = findFirstValidPlacement(bay, def.defId);
  if (first) {
    const res = placeFromStaging(bay, instanceId, first.x, first.y, first.rotation);
    if (res.ok) return res.bay;
  }
  return discardItem(bay, instanceId).bay;
}

function runSimulatedExpedition(
  strategy: StrategyName,
  loadoutId: LoadoutId,
  seed: number
): {
  readonly safeReturn: boolean;
  readonly depth: number;
  readonly credits: number;
} {
  let exp: ExpeditionState = startExpedition({ loadoutId, seed, isTutorial: false });
  const prog = createInitialProgression();

  while (exp.phase !== 'SETTLEMENT') {
    if (exp.phase === 'ROUTE_SELECT') {
      const normalPreview = getRoutePreview(exp, 'normal');
      const dangerPreview = getRoutePreview(exp, 'danger');
      let route: RouteType = 'normal';

      if (strategy === 'deep_dive') {
        if (
          dangerPreview.prediction.outcome === 'victory' &&
          dangerPreview.prediction.finalPlayerHp >= 8
        ) {
          route = 'danger';
        }
      } else if (strategy === 'shield_cannon_hybrid' || strategy === 'cannon_stack') {
        if (
          exp.currentNode >= 2 &&
          dangerPreview.prediction.outcome === 'victory' &&
          dangerPreview.prediction.finalPlayerHp >= 14
        ) {
          route = 'danger';
        }
      }

      // If normal wins and danger loses, always pick normal
      if (route === 'danger' && dangerPreview.prediction.outcome === 'defeat') {
        route = 'normal';
      }
      if (normalPreview.prediction.outcome === 'defeat' && dangerPreview.prediction.outcome === 'victory') {
        route = 'danger';
      }

      exp = selectRoute(exp, route);
      exp = completeCombat(exp);
      continue;
    }

    if (exp.phase === 'REWARD' && exp.pendingRewards) {
      const eqOpt = exp.pendingRewards.find((r) => r.kind === 'equipment');
      const cargoOpt = exp.pendingRewards.find((r) => r.kind === 'cargo');
      const eqDef = eqOpt && eqOpt.kind === 'equipment' ? getItemDef(eqOpt.item.defId) : null;
      const stats = calculateBuildStats(exp.bay);

      let pick: 'equipment' | 'cargo' | 'repair' = 'cargo';
      const lowHp = exp.currentHp <= 14;

      if (strategy === 'cargo_only') {
        pick = exp.currentHp <= 10 ? 'repair' : 'cargo';
      } else if (strategy === 'cannon_stack') {
        if (lowHp) pick = 'repair';
        else if (eqDef && eqDef.category === 'equipment' && (eqDef.kind === 'laser' || eqDef.kind === 'battery')) {
          pick = 'equipment';
        } else {
          pick = 'cargo';
        }
      } else if (strategy === 'shield_cannon_hybrid') {
        if (lowHp) pick = 'repair';
        else if (
          eqDef &&
          eqDef.category === 'equipment' &&
          ((eqDef.kind === 'shield' && !stats.shieldCapped) ||
            eqDef.kind === 'laser' ||
            eqDef.kind === 'battery')
        ) {
          pick = 'equipment';
        } else {
          pick = 'cargo';
        }
      } else if (strategy === 'repair_sustain') {
        if (exp.currentHp <= 18) pick = 'repair';
        else if (
          eqDef &&
          eqDef.category === 'equipment' &&
          ((eqDef.kind === 'drone' && !stats.repairCapped) ||
            (eqDef.kind === 'shield' && !stats.shieldCapped) ||
            eqDef.kind === 'laser')
        ) {
          pick = 'equipment';
        } else {
          pick = 'cargo';
        }
      } else if (strategy === 'conservative_early') {
        if (exp.currentNode <= 2 && eqDef && eqDef.category === 'equipment' && eqDef.kind !== 'drone') {
          pick = 'equipment';
        } else {
          pick = 'cargo';
        }
      } else if (strategy === 'deep_dive') {
        if (exp.currentHp <= 15) pick = 'repair';
        else if (exp.currentNode <= 3 && eqOpt) pick = 'equipment';
        else if (cargoOpt && cargoOpt.kind === 'cargo' && cargoOpt.item.value >= 35) pick = 'cargo';
        else pick = eqOpt ? 'equipment' : 'cargo';
      }

      exp = selectReward(exp, pick);
      continue;
    }

    if (exp.phase === 'ARRANGE') {
      let bay = exp.bay;
      for (const s of [...bay.staging]) {
        bay = placeOptimally(bay, s.item.instanceId);
      }
      exp = updateArrangeBay(exp, bay);

      if (isAtFinalNode(exp)) {
        exp = initiateSafeReturn(exp);
        continue;
      }

      if (strategy === 'conservative_early' && exp.currentNode >= 3) {
        exp = initiateSafeReturn(exp);
        continue;
      }

      // Smart retreat if next normal node is guaranteed lethal
      const nextSimExp: ExpeditionState = { ...exp, currentNode: exp.currentNode + 1 };
      const nextNormal = getRoutePreview(nextSimExp, 'normal');
      if (nextNormal.prediction.outcome === 'defeat') {
        exp = initiateSafeReturn(exp);
        continue;
      }

      exp = proceedToNextNode(exp);
    }
  }

  const summary = calculateSettlement(exp, prog, []);
  return {
    safeReturn: summary.reason === 'safe_return',
    depth: exp.completedNodes,
    credits: summary.finalCreditsEarned,
  };
}

describe('§10D 确定性六类策略平衡模拟', () => {
  const strategies: readonly StrategyName[] = [
    'cargo_only',
    'cannon_stack',
    'shield_cannon_hybrid',
    'repair_sustain',
    'conservative_early',
    'deep_dive',
  ];
  const SEEDS = 80;

  it('两种开局方案在六类策略下均具备可玩路径，且不存在无脑必死开局', () => {
    const report: Record<string, Record<string, { safeRate: number; avgDepth: number; avgCredits: number }>> = {};

    for (const loadoutId of ['cannon_skiff', 'shield_cruiser'] as const) {
      report[loadoutId] = {};
      for (const strategy of strategies) {
        let safeCount = 0;
        let depthSum = 0;
        let creditsSum = 0;
        for (let i = 1; i <= SEEDS; i++) {
          const res = runSimulatedExpedition(strategy, loadoutId, i * 7919 + 17);
          if (res.safeReturn) safeCount++;
          depthSum += res.depth;
          creditsSum += res.credits;
        }
        report[loadoutId][strategy] = {
          safeRate: Number((safeCount / SEEDS).toFixed(2)),
          avgDepth: Number((depthSum / SEEDS).toFixed(2)),
          avgCredits: Math.round(creditsSum / SEEDS),
        };
      }
    }

    console.log('\n[Phase D Simulation Report (80 seeds per strategy)]');
    console.table(report.cannon_skiff);
    console.table(report.shield_cruiser);

    // Verify at least 3 strategies on cannon_skiff achieve avgDepth >= 4.0 and >= 75 credits
    const strongCannonStrategies = strategies.filter(
      (s) => report.cannon_skiff[s].avgDepth >= 4.0 && report.cannon_skiff[s].avgCredits >= 75
    );
    expect(strongCannonStrategies.length).toBeGreaterThanOrEqual(3);

    // Verify shield_cruiser is genuinely viable with >= 3 distinct high-yield strategies (>= 80 credits, depth >= 3.0)
    const strongShieldStrategies = strategies.filter(
      (s) => report.shield_cruiser[s].avgDepth >= 3.0 && report.shield_cruiser[s].avgCredits >= 80
    );
    expect(strongShieldStrategies.length).toBeGreaterThanOrEqual(3);

    // Verify shield_cruiser also has a deep strategy reaching depth >= 4.0
    const deepShieldStrategies = strategies.filter(
      (s) => report.shield_cruiser[s].avgDepth >= 4.0
    );
    expect(deepShieldStrategies.length).toBeGreaterThanOrEqual(1);

    // Verify deeper strategies out-earn conservative early return on cannon_skiff
    const maxDeepCredits = Math.max(
      report.cannon_skiff.deep_dive.avgCredits,
      report.cannon_skiff.shield_cannon_hybrid.avgCredits,
      report.cannon_skiff.cannon_stack.avgCredits
    );
    expect(maxDeepCredits).toBeGreaterThan(report.cannon_skiff.conservative_early.avgCredits);
  });
});
