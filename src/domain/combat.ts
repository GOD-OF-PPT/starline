import type { EnemySpec } from '../data/nodes';
import type { BuildStats } from './buildStats';

export type CombatOutcome = 'victory' | 'defeat';

export interface CombatRoundEvent {
  readonly round: number;
  readonly playerDamageDealt: number;
  readonly enemyDamageDealt: number;
  readonly shieldAbsorbed: number;
  readonly hpLoss: number;
  readonly playerHpAfter: number;
  readonly playerShieldAfter: number;
  readonly enemyHpAfter: number;
}

export interface CombatSimulationResult {
  readonly outcome: CombatOutcome;
  readonly roundsCount: number;
  readonly rounds: readonly CombatRoundEvent[];
  readonly startingPlayerHp: number;
  readonly startingPlayerShield: number;
  readonly startingEnemyHp: number;
  readonly totalDamageTaken: number;
  readonly totalShieldAbsorbed: number;
  readonly totalHpLoss: number;
  readonly hpBeforeRepair: number;
  readonly repairApplied: number;
  readonly finalPlayerHp: number;
  readonly bountyEarned: number;
}

/**
 * Single source of truth for BOTH combat prediction and actual combat resolution (Blueprint §5).
 * Synchronous round-by-round fixed damage:
 * 1. Both deal fixed damage simultaneously.
 * 2. Enemy damage hits shield first, remainder hits HP.
 * 3. Check player HP <= 0 -> DEFEAT (mutual destruction is defeat).
 * 4. Else check enemy HP <= 0 -> VICTORY.
 * 5. On victory only, grant bounty and apply post-victory repair (capped at maxHp).
 */
export function simulateCombat(
  stats: Pick<BuildStats, 'maxHp' | 'totalAttack' | 'effectiveShield' | 'effectiveRepair'>,
  currentHp: number,
  enemy: EnemySpec,
  bounty: number
): CombatSimulationResult {
  let playerHp = Math.max(0, Math.min(stats.maxHp, currentHp));
  let playerShield = stats.effectiveShield;
  let enemyHp = enemy.maxHp;

  const startingPlayerHp = playerHp;
  const startingPlayerShield = playerShield;
  const startingEnemyHp = enemyHp;

  const rounds: CombatRoundEvent[] = [];
  let totalDamageTaken = 0;
  let totalShieldAbsorbed = 0;
  let totalHpLoss = 0;
  let outcome: CombatOutcome = 'defeat';

  if (playerHp <= 0) {
    return {
      outcome: 'defeat',
      roundsCount: 0,
      rounds,
      startingPlayerHp,
      startingPlayerShield,
      startingEnemyHp,
      totalDamageTaken: 0,
      totalShieldAbsorbed: 0,
      totalHpLoss: 0,
      hpBeforeRepair: 0,
      repairApplied: 0,
      finalPlayerHp: 0,
      bountyEarned: 0,
    };
  }

  for (let round = 1; round <= 100; round++) {
    const playerDamageDealt = Math.max(1, stats.totalAttack);
    const enemyDamageDealt = Math.max(0, enemy.damagePerRound);

    enemyHp = Math.max(0, enemyHp - playerDamageDealt);

    const shieldAbsorbed = Math.min(playerShield, enemyDamageDealt);
    playerShield -= shieldAbsorbed;
    const hpLoss = enemyDamageDealt - shieldAbsorbed;
    playerHp = Math.max(0, playerHp - hpLoss);

    totalDamageTaken += enemyDamageDealt;
    totalShieldAbsorbed += shieldAbsorbed;
    totalHpLoss += hpLoss;

    rounds.push({
      round,
      playerDamageDealt,
      enemyDamageDealt,
      shieldAbsorbed,
      hpLoss,
      playerHpAfter: playerHp,
      playerShieldAfter: playerShield,
      enemyHpAfter: enemyHp,
    });

    if (playerHp <= 0) {
      outcome = 'defeat';
      break;
    }
    if (enemyHp <= 0) {
      outcome = 'victory';
      break;
    }
  }

  const hpBeforeRepair = playerHp;
  const repairApplied =
    outcome === 'victory' ? Math.min(stats.effectiveRepair, stats.maxHp - playerHp) : 0;
  const finalPlayerHp = outcome === 'victory' ? playerHp + repairApplied : 0;
  const bountyEarned = outcome === 'victory' ? bounty : 0;

  return {
    outcome,
    roundsCount: rounds.length,
    rounds,
    startingPlayerHp,
    startingPlayerShield,
    startingEnemyHp,
    totalDamageTaken,
    totalShieldAbsorbed,
    totalHpLoss,
    hpBeforeRepair,
    repairApplied,
    finalPlayerHp,
    bountyEarned,
  };
}
