import type { V2EnemyUnitSpec } from '../data/enemies';
import { V2_MAX_BATTLE_SHIELD, type V2EquipmentKind, type V2UnlockFamilyId } from '../data/equipment';
import { calculateV2BuildStats, type V2BuildStats } from './buildStatsV2';
import { generateV2CombatRewardBundle } from './encounter';
import type {
  V2ActiveCombatState,
  V2CargoBayState,
  V2CombatRoundLog,
  V2CombatSimulation,
  V2CombatUnitSnapshot,
  V2EliteTacticChoice,
  V2EliteTacticDecision,
  V2EliteTacticOptionPreview,
  V2EnemyAttackEvent,
  V2PlayerAttackEvent,
  V2RunState,
  V2TargetPolicy,
} from './types';

export const V2_MAX_COMBAT_ROUNDS = 30;
export const V2_ELITE_OVERLOAD_SHIELD_COST = 4;
export const V2_ELITE_OVERLOAD_RAW_DMG = 6;
export const V2_ELITE_DEFENSE_SHIELD_GAIN = 8;

interface MutableUnit {
  readonly enemyId: string;
  readonly name: string;
  readonly spriteArchetype: V2EnemyUnitSpec['spriteArchetype'];
  hp: number;
  readonly maxHp: number;
  readonly damagePerRound: number;
  readonly armor: number;
  readonly pierceRatio: number;
  readonly isBoss?: boolean;
}

function selectTargetByPolicy(
  candidates: readonly MutableUnit[],
  policy: V2TargetPolicy
): MutableUnit | null {
  const living = candidates.filter((u) => u.hp > 0);
  if (living.length === 0) return null;
  const sorted = [...living].sort((a, b) => {
    if (policy === 'weakest') {
      if (a.hp !== b.hp) return a.hp - b.hp;
    } else {
      if (a.damagePerRound !== b.damagePerRound) return b.damagePerRound - a.damagePerRound;
    }
    return a.enemyId.localeCompare(b.enemyId);
  });
  return sorted[0];
}

function snapshotUnits(units: readonly MutableUnit[]): readonly V2CombatUnitSnapshot[] {
  return units.map((u) => ({
    enemyId: u.enemyId,
    name: u.name,
    spriteArchetype: u.spriteArchetype,
    hp: u.hp,
    maxHp: u.maxHp,
    damagePerRound: u.damagePerRound,
    armor: u.armor,
    pierceRatio: u.pierceRatio,
    isBoss: u.isBoss,
  }));
}

function applyHitToUnit(
  unit: MutableUnit,
  sourceKind: V2PlayerAttackEvent['sourceKind'],
  sourceInstanceId: string,
  rawDamage: number
): V2PlayerAttackEvent {
  // §8.2: Per-hit armor reduction: max(1, rawDamage - armor)
  const appliedDamage = Math.max(1, rawDamage - unit.armor);
  const armorBlocked = Math.max(0, rawDamage - appliedDamage);
  const wasAlive = unit.hp > 0;
  unit.hp = Math.max(0, unit.hp - appliedDamage);
  return {
    sourceKind,
    sourceInstanceId,
    targetEnemyId: unit.enemyId,
    rawDamage,
    appliedDamage,
    armorBlocked,
    targetHpAfter: unit.hp,
    targetKilled: wasAlive && unit.hp === 0,
  };
}

/**
 * Single authoritative deterministic combat engine used identically by BOTH preview and live battle (§8.2 & AC07-AC10).
 * Optionally applies a Round-2 Elite tactical choice (`normal` | `overload` | `emergency_defense`).
 */
export function simulateV2Combat(params: {
  readonly resultId: string;
  readonly bay: V2CargoBayState;
  readonly startingHp: number;
  readonly maxHp: number;
  readonly units: readonly V2EnemyUnitSpec[];
  readonly targetPolicy: V2TargetPolicy;
  readonly precomputedStats?: V2BuildStats;
  readonly round2Tactic?: V2EliteTacticChoice;
}): V2CombatSimulation {
  const stats = params.precomputedStats ?? calculateV2BuildStats(params.bay);
  const enemies: MutableUnit[] = params.units.map((u) => ({
    enemyId: u.enemyId,
    name: u.name,
    spriteArchetype: u.spriteArchetype,
    hp: u.maxHp,
    maxHp: u.maxHp,
    damagePerRound: u.damagePerRound,
    armor: u.armor,
    pierceRatio: u.pierceRatio,
    isBoss: u.isBoss,
  }));

  const initialEnemies = snapshotUnits(enemies);
  let playerHp = Math.max(0, params.startingHp);
  let playerShield = stats.effectiveShield;
  const startingPlayerShield = playerShield;
  const rounds: V2CombatRoundLog[] = [];

  let outcome: 'victory' | 'defeat' = 'defeat';
  let stalemate = false;
  let appliedTactic: V2EliteTacticChoice | undefined = undefined;

  for (let round = 1; round <= V2_MAX_COMBAT_ROUNDS; round++) {
    // Step 1: Read start-of-round living enemies, compute hangar drone counts & heavy firing schedule
    const startLiving = enemies.filter((u) => u.hp > 0);
    if (startLiving.length === 0) {
      outcome = 'victory';
      break;
    }

    // Phase-D optional Round-2 Elite tactical order (applied cleanly at Round 2 boundary before shots)
    let suppressEquipmentWeaponsThisRound = false;
    let triggerOverloadBonusHit = false;
    if (round === 2 && params.round2Tactic) {
      appliedTactic = params.round2Tactic;
      if (params.round2Tactic === 'overload' && playerShield >= V2_ELITE_OVERLOAD_SHIELD_COST) {
        playerShield -= V2_ELITE_OVERLOAD_SHIELD_COST;
        triggerOverloadBonusHit = true;
      } else if (params.round2Tactic === 'emergency_defense') {
        playerShield = Math.min(V2_MAX_BATTLE_SHIELD, playerShield + V2_ELITE_DEFENSE_SHIELD_GAIN);
        suppressEquipmentWeaponsThisRound = true;
      }
    }

    const droneCountsByHangar: Record<string, number> = {};
    for (const hg of stats.hangars) {
      const count = Math.min(hg.maxDrones, round + hg.roundOneBonusDrones);
      droneCountsByHangar[hg.instanceId] = count;
    }

    const heavyChargingIds: string[] = [];
    for (const h of stats.heavies) {
      const fires = h.firesOnOddRounds ? round % 2 === 1 : round % 2 === 0;
      if (!fires || suppressEquipmentWeaponsThisRound) heavyChargingIds.push(h.instanceId);
    }

    // Step 2 & 3: Select single-target primary from start-of-round snapshot (overkill allowed & deterministic!)
    const primaryTarget = selectTargetByPolicy(startLiving, params.targetPolicy)!;
    const playerAttacks: V2PlayerAttackEvent[] = [];

    // 2a. Core attack (preserved even during emergency_defense)
    if (stats.coreAttack > 0) {
      playerAttacks.push(applyHitToUnit(primaryTarget, 'core', 'ship_core', stats.coreAttack));
    }

    // Optional Round-2 Overload extra normal hit (subject to armor)
    if (triggerOverloadBonusHit) {
      playerAttacks.push(
        applyHitToUnit(primaryTarget, 'core', 'tactic_overload', V2_ELITE_OVERLOAD_RAW_DMG)
      );
    }

    if (!suppressEquipmentWeaponsThisRound) {
      // 2b. Lasers (sorted by instanceId)
      for (const l of stats.lasers) {
        playerAttacks.push(applyHitToUnit(primaryTarget, 'laser', l.instanceId, l.totalDamage));
      }

      // 2c. Heavy cannons firing this round (sorted by instanceId)
      for (const h of stats.heavies) {
        const fires = h.firesOnOddRounds ? round % 2 === 1 : round % 2 === 0;
        if (fires) {
          const bonus = round === 1 ? h.firstShotBonus : 0;
          playerAttacks.push(applyHitToUnit(primaryTarget, 'heavy', h.instanceId, h.baseDamage + bonus));
        }
      }

      // 2d. Hangar drones: each active drone fires 1 individual hit (so armor applies per drone! AC08)
      for (const hg of stats.hangars) {
        const drones = droneCountsByHangar[hg.instanceId] ?? 0;
        for (let d = 0; d < drones; d++) {
          playerAttacks.push(
            applyHitToUnit(primaryTarget, 'hangar', `${hg.instanceId}_d${d + 1}`, hg.damagePerDrone)
          );
        }
      }

      // 2e. Flak arrays: hit EVERY enemy alive at start of round (sorted by enemyId)
      const startLivingSortedForFlak = [...startLiving].sort((a, b) =>
        a.enemyId.localeCompare(b.enemyId)
      );
      for (const fl of stats.flaks) {
        for (const target of startLivingSortedForFlak) {
          playerAttacks.push(applyHitToUnit(target, 'flak', fl.instanceId, fl.damagePerEnemy));
        }
      }
    }

    // Step 4: Simultaneous enemy attacks from startLiving (even if killed in step 3!)
    const startLivingSorted = [...startLiving].sort((a, b) => a.enemyId.localeCompare(b.enemyId));
    const enemyAttacks: V2EnemyAttackEvent[] = [];
    let shieldAbsorbedTotal = 0;

    for (const enemy of startLivingSorted) {
      const rawDamage = enemy.damagePerRound;
      const pierceDamage =
        enemy.pierceRatio > 0 ? Math.floor(rawDamage * enemy.pierceRatio) : 0;
      const normalDamage = rawDamage - pierceDamage;
      const shieldAbsorbed = Math.min(playerShield, normalDamage);
      playerShield -= shieldAbsorbed;
      shieldAbsorbedTotal += shieldAbsorbed;
      const hullDamage = pierceDamage + (normalDamage - shieldAbsorbed);
      playerHp = Math.max(0, playerHp - hullDamage);

      enemyAttacks.push({
        enemyId: enemy.enemyId,
        rawDamage,
        pierceDamage,
        shieldAbsorbed,
        hullDamage,
      });
    }

    // Step 5: Counter phase (ship-wide ONCE per round, based ONLY on actual shield absorbed, preserved during emergency_defense!)
    let counterAttack: V2PlayerAttackEvent | null = null;
    if (stats.bestActiveCounter && shieldAbsorbedTotal > 0) {
      const rawCounter = Math.min(
        stats.bestActiveCounter.maxDamage,
        Math.floor(shieldAbsorbedTotal * stats.bestActiveCounter.ratio)
      );
      if (rawCounter > 0) {
        const postMainLiving = enemies.filter((u) => u.hp > 0);
        const counterTarget = selectTargetByPolicy(postMainLiving, params.targetPolicy);
        if (counterTarget) {
          counterAttack = applyHitToUnit(
            counterTarget,
            'counter',
            stats.bestActiveCounter.instanceId,
            rawCounter
          );
        }
      }
    }

    rounds.push({
      round,
      droneCountsByHangar,
      heavyChargingIds,
      playerAttacks,
      enemyAttacks,
      counterAttack,
      shieldAbsorbedTotal,
      playerHpAfter: playerHp,
      playerShieldAfter: playerShield,
      enemiesAfter: snapshotUnits(enemies),
    });

    // Step 6: Win/loss check — player HP <= 0 ALWAYS loses first (including mutual destruction via counter! AC09)
    if (playerHp <= 0) {
      outcome = 'defeat';
      break;
    }
    const remainingLiving = enemies.some((u) => u.hp > 0);
    if (!remainingLiving) {
      outcome = 'victory';
      break;
    }
    if (round === V2_MAX_COMBAT_ROUNDS) {
      outcome = 'defeat';
      stalemate = true;
      break;
    }
  }

  // Step 7: Post-victory repair only on victory
  const repairApplied =
    outcome === 'victory' ? Math.min(stats.effectiveRepair, Math.max(0, params.maxHp - playerHp)) : 0;
  const finalPlayerHpAfterRepair = Math.min(params.maxHp, playerHp + repairApplied);

  return {
    resultId: params.resultId,
    outcome,
    stalemate,
    targetPolicy: params.targetPolicy,
    roundsCount: rounds.length,
    startingPlayerHp: params.startingHp,
    startingPlayerShield,
    finalPlayerHp: playerHp,
    repairApplied,
    finalPlayerHpAfterRepair,
    initialEnemies,
    rounds,
    appliedTactic,
  };
}

/**
 * Previews an upcoming combat node using the exact same deterministic engine.
 */
export function previewV2CombatNode(
  run: V2RunState,
  nodeId: string,
  policyOverride?: V2TargetPolicy
): V2CombatSimulation | null {
  const node = run.graph.nodes[nodeId];
  if (!node || !node.combat) return null;
  return simulateV2Combat({
    resultId: `preview_${run.runId}_${nodeId}`,
    bay: run.bay,
    startingHp: run.hp,
    maxHp: run.maxHp,
    units: node.combat.units,
    targetPolicy: policyOverride ?? run.targetPolicy,
  });
}

function buildEliteRound2Decision(params: {
  readonly run: V2RunState;
  readonly nodeId: string;
  readonly targetPolicy: V2TargetPolicy;
  readonly units: readonly V2EnemyUnitSpec[];
  readonly baselineSim: V2CombatSimulation;
}): V2EliteTacticDecision | null {
  if (params.baselineSim.rounds.length < 2) return null;
  const r1 = params.baselineSim.rounds[0];
  if (!r1 || r1.playerHpAfter <= 0) return null;
  const aliveEnemies = r1.enemiesAfter.filter((e) => e.hp > 0);
  if (aliveEnemies.length === 0) return null;

  const canOverload = r1.playerShieldAfter >= V2_ELITE_OVERLOAD_SHIELD_COST;
  const simOverload = canOverload
    ? simulateV2Combat({
        resultId: `prev_ov_${params.run.runId}_${params.nodeId}`,
        bay: params.run.bay,
        startingHp: params.run.hp,
        maxHp: params.run.maxHp,
        units: params.units,
        targetPolicy: params.targetPolicy,
        round2Tactic: 'overload',
      })
    : params.baselineSim;

  const simDefense = simulateV2Combat({
    resultId: `prev_def_${params.run.runId}_${params.nodeId}`,
    bay: params.run.bay,
    startingHp: params.run.hp,
    maxHp: params.run.maxHp,
    units: params.units,
    targetPolicy: params.targetPolicy,
    round2Tactic: 'emergency_defense',
  });

  const options: V2EliteTacticOptionPreview[] = [
    {
      choice: 'normal',
      label: '正常执行',
      summary: '按原配装节拍自动交火，保留现有护盾与武器轮次',
      enabled: true,
      predictedOutcome: params.baselineSim.outcome,
      predictedFinalHp: params.baselineSim.finalPlayerHpAfterRepair,
      predictedRounds: params.baselineSim.roundsCount,
    },
    {
      choice: 'overload',
      label: '火力过载',
      summary: `消耗 ${V2_ELITE_OVERLOAD_SHIELD_COST} 护盾，本轮额外追加 1 次 ${V2_ELITE_OVERLOAD_RAW_DMG} 点直击（受护甲影响）`,
      enabled: canOverload,
      disabledReason: canOverload
        ? undefined
        : `当前剩余护盾 ${r1.playerShieldAfter} < ${V2_ELITE_OVERLOAD_SHIELD_COST}`,
      predictedOutcome: simOverload.outcome,
      predictedFinalHp: simOverload.finalPlayerHpAfterRepair,
      predictedRounds: simOverload.roundsCount,
    },
    {
      choice: 'emergency_defense',
      label: '紧急防御',
      summary: `立刻 +${V2_ELITE_DEFENSE_SHIELD_GAIN} 护盾（上限 ${V2_MAX_BATTLE_SHIELD}），本轮设备主动武器停火（核心/机库增长/反击保留）`,
      enabled: true,
      predictedOutcome: simDefense.outcome,
      predictedFinalHp: simDefense.finalPlayerHpAfterRepair,
      predictedRounds: simDefense.roundsCount,
    },
  ];

  return {
    decisionId: `tactic_${params.run.runId}_${params.nodeId}_r2`,
    roundNumber: 2,
    playerHpAtPause: r1.playerHpAfter,
    playerShieldAtPause: r1.playerShieldAfter,
    enemyThreatDamage: aliveEnemies.reduce((sum, e) => sum + e.damagePerRound, 0),
    enemiesAlive: aliveEnemies.length,
    options,
    chosen: null,
  };
}

/**
 * Starts combat at the current combat/elite node, locking the exact simulation snapshot into activeCombat.
 * When `enableEliteTactic` is enabled on an Elite node reaching Round 2, attaches an atomic Round-2 decision snapshot.
 */
export function startV2CombatAtCurrentNode(
  run: V2RunState,
  policyOverride?: V2TargetPolicy,
  options?: { readonly enableEliteTactic?: boolean }
): { readonly ok: boolean; readonly run: V2RunState; readonly error?: string } {
  if (run.phase !== 'ENCOUNTER' || !run.currentNodeId) {
    return { ok: false, run, error: '当前不在战斗节点内' };
  }
  if (run.bay.staging.length > 0) {
    return { ok: false, run, error: '暂存区必须清空后才可开战' };
  }
  const node = run.graph.nodes[run.currentNodeId];
  if (!node || !node.combat) {
    return { ok: false, run, error: '当前节点不是战斗遭遇' };
  }
  if (run.activeCombat && run.activeCombat.nodeId === node.nodeId) {
    return { ok: true, run }; // Already started; idempotent on refresh!
  }

  const targetPolicy = policyOverride ?? run.targetPolicy;
  const simulation = simulateV2Combat({
    resultId: `cmb_${run.runId}_${node.nodeId}`,
    bay: run.bay,
    startingHp: run.hp,
    maxHp: run.maxHp,
    units: node.combat.units,
    targetPolicy,
  });

  const pendingDecision =
    options?.enableEliteTactic && node.type === 'elite'
      ? buildEliteRound2Decision({
          run,
          nodeId: node.nodeId,
          targetPolicy,
          units: node.combat.units,
          baselineSim: simulation,
        })
      : null;

  const activeCombat: V2ActiveCombatState = {
    nodeId: node.nodeId,
    startingHp: run.hp,
    targetPolicy,
    simulation,
    pendingDecision,
  };

  return {
    ok: true,
    run: {
      ...run,
      targetPolicy,
      activeCombat,
    },
  };
}

/**
 * Commits the player's Round-2 Elite tactical decision atomically and idempotently.
 * Recomputes the authoritative battle outcome with the chosen Round-2 order; refresh can never duplicate or undo it.
 */
export function commitV2EliteTacticDecision(
  run: V2RunState,
  decisionId: string,
  choice: V2EliteTacticChoice
): { readonly ok: boolean; readonly run: V2RunState; readonly error?: string } {
  if (run.phase !== 'ENCOUNTER' || !run.activeCombat || !run.currentNodeId) {
    return { ok: false, run, error: '当前没有等待战术抉择的战斗' };
  }
  const pending = run.activeCombat.pendingDecision;
  if (!pending || pending.decisionId !== decisionId) {
    return { ok: false, run, error: '战术抉择编号无效或已过期' };
  }
  const claimKey = `tactic_commit_${decisionId}`;
  if (pending.chosen !== null || run.claimedEventIds.includes(claimKey)) {
    return { ok: false, run, error: '该回合战术抉择已完成，禁止重复触发' };
  }
  const opt = pending.options.find((o) => o.choice === choice);
  if (!opt || !opt.enabled) {
    return { ok: false, run, error: opt?.disabledReason ?? '该战术指令当前不可用' };
  }

  const node = run.graph.nodes[run.currentNodeId];
  if (!node || !node.combat) {
    return { ok: false, run, error: '当前精英节点数据异常' };
  }

  const nextSimulation = simulateV2Combat({
    resultId: `cmb_${run.runId}_${node.nodeId}_${choice}`,
    bay: run.bay,
    startingHp: run.activeCombat.startingHp,
    maxHp: run.maxHp,
    units: node.combat.units,
    targetPolicy: run.activeCombat.targetPolicy,
    round2Tactic: choice,
  });

  return {
    ok: true,
    run: {
      ...run,
      activeCombat: {
        ...run.activeCombat,
        simulation: nextSimulation,
        pendingDecision: {
          ...pending,
          chosen: choice,
        },
      },
      claimedEventIds: [...run.claimedEventIds, claimKey],
    },
  };
}

/**
 * Commits the deterministic combat result once playback finishes or is skipped.
 * - Strictly refuses completion while an Elite Round-2 tactical decision remains unresolved!
 * - Victory: applies post-repair HP, pays fixed bounty into run.wallet, generates deterministic 3-choice reward bundle
 * - Defeat: sets HP = 0 and enters SETTLEMENT (defeat)
 */
export function completeV2CombatAtCurrentNode(
  run: V2RunState,
  unlockedFamilies: readonly V2UnlockFamilyId[],
  recentEquipmentKinds: readonly V2EquipmentKind[] = []
): { readonly ok: boolean; readonly run: V2RunState; readonly error?: string } {
  if (run.phase !== 'ENCOUNTER' || !run.activeCombat || !run.currentNodeId) {
    return { ok: false, run, error: '没有进行中的战斗可结算' };
  }
  if (run.activeCombat.pendingDecision && run.activeCombat.pendingDecision.chosen === null) {
    return { ok: false, run, error: '请先完成第 2 回合精英战战术抉择' };
  }
  const node = run.graph.nodes[run.currentNodeId];
  if (!node || !node.combat) {
    return { ok: false, run, error: '当前战斗节点数据异常' };
  }
  const claimKey = `combat_done_${node.nodeId}`;
  if (run.claimedEventIds.includes(claimKey)) {
    return { ok: false, run, error: '该场战斗已结算' };
  }

  const sim = run.activeCombat.simulation;
  if (sim.outcome === 'defeat') {
    return {
      ok: true,
      run: {
        ...run,
        hp: 0,
        activeCombat: null,
        phase: 'SETTLEMENT',
        settlementReason: 'defeat',
        claimedEventIds: [...run.claimedEventIds, claimKey],
      },
    };
  }

  const { bundle, nextStreams } = generateV2CombatRewardBundle(
    run,
    node,
    unlockedFamilies,
    recentEquipmentKinds
  );

  return {
    ok: true,
    run: {
      ...run,
      hp: sim.finalPlayerHpAfterRepair,
      wallet: run.wallet + node.combat.bounty,
      rngStreams: nextStreams,
      activeCombat: null,
      pendingReward: bundle,
      phase: 'REWARD',
      claimedEventIds: [...run.claimedEventIds, claimKey],
    },
  };
}
