import type { V2CrewId } from '../data/crew';
import type { V2EnemyUnitSpec } from '../data/enemies';
import {
  V2_MAX_BATTLE_SHIELD,
  V2_MAX_POST_WIN_REPAIR,
  type V2EquipmentKind,
  type V2UnlockFamilyId,
} from '../data/equipment';
import { getV3SectorDef } from '../data/sectors';
import { calculateV2BuildStats, type V2BuildStats } from './buildStatsV2';
import { generateV2CombatRewardBundle } from './encounter';
import type {
  SectorId,
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
export const V2_ELITE_OVERLOAD_COST = 3;
export const V2_ELITE_OVERLOAD_RAW_DMG = 9;
export const V2_ELITE_DEFENSE_SHIELD_GAIN = 5;
/** @deprecated Alias kept for external imports; Overload now spends shield first then HP */
export const V2_ELITE_OVERLOAD_SHIELD_COST = V2_ELITE_OVERLOAD_COST;

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
  rawDamage: number,
  ignoreArmor = false
): V2PlayerAttackEvent {
  // §8.2: Per-hit armor reduction: max(1, rawDamage - armor) (unless armor-piercing tactical order)
  const appliedDamage = ignoreArmor ? Math.max(1, rawDamage) : Math.max(1, rawDamage - unit.armor);
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
  readonly sectorId?: SectorId;
  readonly crewId?: V2CrewId | null;
  readonly crewMasteryTier?: number;
}): V2CombatSimulation {
  const stats = params.precomputedStats ?? calculateV2BuildStats(params.bay);
  const sectorId: SectorId = params.sectorId ?? 'near_orbit';
  const sector = getV3SectorDef(sectorId);
  const envModifierId = sector.envModifier.id;
  const masteryTier = Math.max(0, Math.min(2, Math.floor(params.crewMasteryTier ?? 0)));

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

  // Opening shield: base build shield + Engineer Mastery T2 (+2, capped at 20), then Sector 2 cryo_ion (-2, min 0)
  const engineerOpeningShieldBonus = params.crewId === 'engineer' && masteryTier >= 2 ? 2 : 0;
  const preEnvShield = Math.min(V2_MAX_BATTLE_SHIELD, stats.effectiveShield + engineerOpeningShieldBonus);
  let playerShield =
    envModifierId === 'cryo_ion' ? Math.max(0, preEnvShield - 2) : preEnvShield;
  const cryoOpeningSuppressed = envModifierId === 'cryo_ion' && preEnvShield > playerShield;
  const startingPlayerShield = playerShield;
  const rounds: V2CombatRoundLog[] = [];

  let outcome: 'victory' | 'defeat' = 'defeat';
  let stalemate = false;
  let appliedTactic: V2EliteTacticChoice | undefined = undefined;
  let heavyStallApplied = false;

  for (let round = 1; round <= V2_MAX_COMBAT_ROUNDS; round++) {
    // Step 1: Read start-of-round living enemies, compute hangar drone counts & heavy firing schedule
    const startLiving = enemies.filter((u) => u.hp > 0);
    if (startLiving.length === 0) {
      outcome = 'victory';
      break;
    }

    // Phase-D optional Round-2 Elite tactical order (applied cleanly at Round 2 boundary before shots)
    let suppressDirectWeaponsThisRound = false;
    let triggerOverloadBonusHit = false;
    if (round === 2 && params.round2Tactic) {
      appliedTactic = params.round2Tactic;
      if (
        params.round2Tactic === 'overload' &&
        playerHp + playerShield > V2_ELITE_OVERLOAD_COST
      ) {
        const shieldPaid = Math.min(playerShield, V2_ELITE_OVERLOAD_COST);
        playerShield -= shieldPaid;
        const hpPaid = V2_ELITE_OVERLOAD_COST - shieldPaid;
        playerHp = Math.max(1, playerHp - hpPaid);
        triggerOverloadBonusHit = true;
      } else if (params.round2Tactic === 'emergency_defense') {
        const shieldGain =
          V2_ELITE_DEFENSE_SHIELD_GAIN + (stats.bestActiveCounter ? 2 : 0);
        playerShield = Math.min(V2_MAX_BATTLE_SHIELD, playerShield + shieldGain);
        suppressDirectWeaponsThisRound = true;
        heavyStallApplied = true;
      }
    }

    // Power diversion during Emergency Defense stalls heavy railgun charge by 1 cycle, while hangar bays continue launching/ramping
    const effectiveHeavyRound = heavyStallApplied && round >= 2 ? round - 1 : round;

    const droneCountsByHangar: Record<string, number> = {};
    for (const hg of stats.hangars) {
      const count = Math.min(hg.maxDrones, round + hg.roundOneBonusDrones);
      droneCountsByHangar[hg.instanceId] = count;
    }

    const heavyChargingIds: string[] = [];
    for (const h of stats.heavies) {
      const fires = h.firesOnOddRounds ? effectiveHeavyRound % 2 === 1 : effectiveHeavyRound % 2 === 0;
      if (!fires || suppressDirectWeaponsThisRound) heavyChargingIds.push(h.instanceId);
    }

    // Step 2 & 3: Select single-target primary from start-of-round snapshot (overkill allowed & deterministic!)
    const primaryTarget = selectTargetByPolicy(startLiving, params.targetPolicy)!;
    const playerAttacks: V2PlayerAttackEvent[] = [];

    // Deterministic first-direct-attack bonuses (Navigator Mastery T2 on R1; Sector 3 gravity_tide on even rounds)
    const isGravitySurgeRound = envModifierId === 'gravity_tide' && round % 2 === 0;
    let pendingFirstHitBonus =
      (round === 1 && params.crewId === 'navigator' && masteryTier >= 2 ? 2 : 0) +
      (isGravitySurgeRound ? 2 : 0);
    const consumeFirstHitBonus = (): number => {
      if (pendingFirstHitBonus <= 0) return 0;
      const bonus = pendingFirstHitBonus;
      pendingFirstHitBonus = 0;
      return bonus;
    };

    // 2a. Core attack (paused during full-shield emergency_defense power diversion)
    if (stats.coreAttack > 0 && !suppressDirectWeaponsThisRound) {
      playerAttacks.push(
        applyHitToUnit(
          primaryTarget,
          'core',
          'ship_core',
          stats.coreAttack + consumeFirstHitBonus()
        )
      );
    }

    // Optional Round-2 Overload armor-piercing strike (ignores enemy armor; switches to living target if primary fell to core!)
    if (triggerOverloadBonusHit) {
      const overloadTarget = selectTargetByPolicy(enemies, params.targetPolicy) ?? primaryTarget;
      playerAttacks.push(
        applyHitToUnit(
          overloadTarget,
          'core',
          'tactic_overload',
          V2_ELITE_OVERLOAD_RAW_DMG,
          true
        )
      );
    }

    if (!suppressDirectWeaponsThisRound) {
      // 2b. Lasers (sorted by instanceId)
      for (const l of stats.lasers) {
        playerAttacks.push(
          applyHitToUnit(
            primaryTarget,
            'laser',
            l.instanceId,
            l.totalDamage + consumeFirstHitBonus()
          )
        );
      }

      // 2c. Heavy cannons firing this round (sorted by instanceId)
      for (const h of stats.heavies) {
        const fires = h.firesOnOddRounds
          ? effectiveHeavyRound % 2 === 1
          : effectiveHeavyRound % 2 === 0;
        if (fires) {
          const bonus = round === 1 ? h.firstShotBonus : 0;
          playerAttacks.push(
            applyHitToUnit(
              primaryTarget,
              'heavy',
              h.instanceId,
              h.baseDamage + bonus + consumeFirstHitBonus()
            )
          );
        }
      }

      // 2d. Hangar drones: each active drone acquires a living enemy independently (auto-switches on kill; per-drone armor still applies! AC08)
      for (const hg of stats.hangars) {
        const drones = droneCountsByHangar[hg.instanceId] ?? 0;
        for (let d = 0; d < drones; d++) {
          const droneTarget = selectTargetByPolicy(enemies, params.targetPolicy) ?? primaryTarget;
          playerAttacks.push(
            applyHitToUnit(
              droneTarget,
              'hangar',
              `${hg.instanceId}_d${d + 1}`,
              hg.damagePerDrone + consumeFirstHitBonus()
            )
          );
        }
      }

      // 2e. Flak arrays: hit EVERY enemy alive at start of round (sorted by enemyId)
      const startLivingSortedForFlak = [...startLiving].sort((a, b) =>
        a.enemyId.localeCompare(b.enemyId)
      );
      for (const fl of stats.flaks) {
        for (const target of startLivingSortedForFlak) {
          playerAttacks.push(
            applyHitToUnit(
              target,
              'flak',
              fl.instanceId,
              fl.damagePerEnemy + consumeFirstHitBonus()
            )
          );
        }
      }
    }

    // Step 4: Simultaneous enemy attacks from startLiving (even if killed in step 3!)
    const startLivingSorted = [...startLiving].sort((a, b) => a.enemyId.localeCompare(b.enemyId));
    const enemyAttacks: V2EnemyAttackEvent[] = [];
    let shieldAbsorbedTotal = 0;
    const gravityEnemyDmgBonus = isGravitySurgeRound ? 1 : 0;

    for (const enemy of startLivingSorted) {
      const rawDamage = enemy.damagePerRound + gravityEnemyDmgBonus;
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

    // Step 5: Counter phase (ship-wide ONCE per round, based ONLY on actual shield absorbed; supercharged +2 during emergency_defense!)
    let counterAttack: V2PlayerAttackEvent | null = null;
    if (stats.bestActiveCounter && shieldAbsorbedTotal > 0) {
      const defenseCounterBonus =
        round === 2 && params.round2Tactic === 'emergency_defense' ? 2 : 0;
      const rawCounter = Math.min(
        stats.bestActiveCounter.maxDamage + defenseCounterBonus,
        Math.floor(shieldAbsorbedTotal * stats.bestActiveCounter.ratio) + defenseCounterBonus
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

    // Step 5b: End-of-round deterministic sector environmental effect
    let envModifierEvent: string | undefined;
    if (envModifierId === 'cryo_ion') {
      if (round % 2 === 0) {
        if (playerShield > 0) {
          const drained = Math.min(playerShield, 2);
          playerShield -= drained;
          envModifierEvent = `低温电离脉冲：余盾衰减 -${drained}`;
        } else {
          envModifierEvent = '低温电离脉冲：无余盾，船体未受损';
        }
      } else if (round === 1 && cryoOpeningSuppressed) {
        envModifierEvent = `低温电离场：开战护盾压制 -${preEnvShield - startingPlayerShield}`;
      }
    } else if (isGravitySurgeRound) {
      envModifierEvent = '引力潮汐高潮：我方首击 +2 / 敌舰齐射各 +1';
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
      ...(envModifierEvent ? { envModifierEvent } : {}),
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

  // Step 7: Post-victory repair only on victory (Engineer Mastery T1 adds +1 post-win repair, still capped at V2_MAX_POST_WIN_REPAIR = 4)
  const engineerRepairBonus = params.crewId === 'engineer' && masteryTier >= 1 ? 1 : 0;
  const totalEffectiveRepair = Math.min(
    V2_MAX_POST_WIN_REPAIR,
    stats.effectiveRepair + engineerRepairBonus
  );
  const repairApplied =
    outcome === 'victory'
      ? Math.min(totalEffectiveRepair, Math.max(0, params.maxHp - playerHp))
      : 0;
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
    sectorId,
    envModifierId,
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
    sectorId: run.sectorId,
    crewId: run.crewId,
    crewMasteryTier: run.crewMasteryTier ?? 0,
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

  const canOverload = r1.playerHpAfter + r1.playerShieldAfter > V2_ELITE_OVERLOAD_COST;
  const overloadShieldCost = Math.min(r1.playerShieldAfter, V2_ELITE_OVERLOAD_COST);
  const overloadHpCost = V2_ELITE_OVERLOAD_COST - overloadShieldCost;
  const overloadCostLabel =
    overloadHpCost === 0
      ? `消耗 ${overloadShieldCost} 护盾`
      : overloadShieldCost === 0
      ? `消耗 ${overloadHpCost} 耐久`
      : `消耗 ${overloadShieldCost} 盾 + ${overloadHpCost} 耐久`;

  const simOverload = canOverload
    ? simulateV2Combat({
        resultId: `prev_ov_${params.run.runId}_${params.nodeId}`,
        bay: params.run.bay,
        startingHp: params.run.hp,
        maxHp: params.run.maxHp,
        units: params.units,
        targetPolicy: params.targetPolicy,
        round2Tactic: 'overload',
        sectorId: params.run.sectorId,
        crewId: params.run.crewId,
        crewMasteryTier: params.run.crewMasteryTier ?? 0,
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
    sectorId: params.run.sectorId,
    crewId: params.run.crewId,
    crewMasteryTier: params.run.crewMasteryTier ?? 0,
  });

  const hasCounter = calculateV2BuildStats(params.run.bay).bestActiveCounter !== null;
  const defenseShieldGain = V2_ELITE_DEFENSE_SHIELD_GAIN + (hasCounter ? 2 : 0);

  const options: V2EliteTacticOptionPreview[] = [
    {
      choice: 'normal',
      label: '正常执行',
      summary: '按原配装节拍自动交火，无额外损耗且保持重炮蓄能/机库扩编进度',
      enabled: true,
      predictedOutcome: params.baselineSim.outcome,
      predictedFinalHp: params.baselineSim.finalPlayerHpAfterRepair,
      predictedRounds: params.baselineSim.roundsCount,
    },
    {
      choice: 'overload',
      label: '火力过载',
      summary: `${overloadCostLabel}，本轮追加 1 次 ${V2_ELITE_OVERLOAD_RAW_DMG} 点无视护甲破甲直击`,
      enabled: canOverload,
      disabledReason: canOverload
        ? undefined
        : `剩余护盾与耐久总和 ${r1.playerHpAfter + r1.playerShieldAfter} ≤ ${V2_ELITE_OVERLOAD_COST}，无法承受过载反冲`,
      predictedOutcome: simOverload.outcome,
      predictedFinalHp: simOverload.finalPlayerHpAfterRepair,
      predictedRounds: simOverload.roundsCount,
    },
    {
      choice: 'emergency_defense',
      label: '紧急防御',
      summary: `立刻 +${defenseShieldGain} 护盾（上限 ${V2_MAX_BATTLE_SHIELD}${
        hasCounter ? '，含反击器协同 +2' : ''
      }），全炮停火且重炮蓄能延后 1 轮（机库照常扩编${hasCounter ? '，反击当轮 +2 伤' : ''}）`,
      enabled: true,
      predictedOutcome: simDefense.outcome,
      predictedFinalHp: simDefense.finalPlayerHpAfterRepair,
      predictedRounds: simDefense.roundsCount,
    },
  ];

  const isGravitySurgeR2 = getV3SectorDef(params.run.sectorId).envModifier.id === 'gravity_tide';
  const enemyThreatDamage = aliveEnemies.reduce(
    (sum, e) => sum + e.damagePerRound + (isGravitySurgeR2 ? 1 : 0),
    0
  );

  return {
    decisionId: `tactic_${params.run.runId}_${params.nodeId}_r2`,
    roundNumber: 2,
    playerHpAtPause: r1.playerHpAfter,
    playerShieldAtPause: r1.playerShieldAfter,
    enemyThreatDamage,
    enemiesAlive: aliveEnemies.length,
    options,
    chosen: null,
  };
}

/**
 * Single authoritative combat victory bounty calculator (applies Salvager Mastery T2 +20% ceil bonus)
 * shared by Map forecast, Combat Pre-View, and completeV2CombatAtCurrentNode payout.
 */
export function getEffectiveV2CombatBounty(
  run: Pick<V2RunState, 'crewId' | 'crewMasteryTier'>,
  baseBounty: number
): number {
  return run.crewId === 'salvager' && (run.crewMasteryTier ?? 0) >= 2
    ? Math.ceil(baseBounty * 1.2)
    : baseBounty;
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
    sectorId: run.sectorId,
    crewId: run.crewId,
    crewMasteryTier: run.crewMasteryTier ?? 0,
  });

  const pendingDecision =
    options?.enableEliteTactic && (node.type === 'elite' || node.type === 'boss')
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
    sectorId: run.sectorId,
    crewId: run.crewId,
    crewMasteryTier: run.crewMasteryTier ?? 0,
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
  recentEquipmentKinds?: readonly V2EquipmentKind[]
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

  const effectiveRecent =
    recentEquipmentKinds && recentEquipmentKinds.length > 0
      ? recentEquipmentKinds
      : run.recentEquipmentKinds ?? [];

  const { bundle, nextStreams } = generateV2CombatRewardBundle(
    run,
    node,
    unlockedFamilies,
    effectiveRecent
  );

  const offeredKind = bundle.equipmentOption.definitionId.split('.')[1] as V2EquipmentKind;
  const nextRecentKinds =
    node.layer <= 3
      ? [...effectiveRecent, offeredKind].slice(-4)
      : [...effectiveRecent];

  const effectiveBounty = getEffectiveV2CombatBounty(run, node.combat.bounty);

  const bossIdOnNode =
    node.combat.bossId ??
    node.bossId ??
    ((node.type === 'elite' || node.type === 'boss') &&
    node.layer >= 6 &&
    !run.isTutorial &&
    !run.isShowcase
      ? getV3SectorDef(run.sectorId).bossId
      : undefined);

  const prevBosses = run.defeatedBossIdsThisRun ?? [];
  const nextBosses =
    bossIdOnNode && !prevBosses.includes(bossIdOnNode)
      ? [...prevBosses, bossIdOnNode]
      : [...prevBosses];

  const prevKinds = run.defeatedEnemyKindsThisRun ?? [];
  const kindAdditions = [node.combat.encounterKind, ...(bossIdOnNode ? [bossIdOnNode] : [])];
  const nextDefeatedKinds = Array.from(new Set([...prevKinds, ...kindAdditions]));

  return {
    ok: true,
    run: {
      ...run,
      hp: sim.finalPlayerHpAfterRepair,
      wallet: run.wallet + effectiveBounty,
      rngStreams: nextStreams,
      activeCombat: null,
      pendingReward: bundle,
      phase: 'REWARD',
      claimedEventIds: [...run.claimedEventIds, claimKey],
      recentEquipmentKinds: nextRecentKinds,
      defeatedBossIdsThisRun: nextBosses,
      defeatedEnemyKindsThisRun: nextDefeatedKinds,
    },
  };
}
