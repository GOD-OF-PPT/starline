import {
  resolveV3BossDefForEncounter,
  type V3BossDefinition,
  type V3EnemyIntent,
} from '../data/bosses';
import type { V2CrewId } from '../data/crew';
import {
  isActBossEncounterKind,
  resolveUnitInitialShield,
  resolveUnitIntentForRound,
  resolveUnitIntentRole,
  type V2EncounterKind,
  type V2EnemyUnitRole,
  type V2EnemyUnitSpec,
} from '../data/enemies';
import {
  V2_MAX_BATTLE_SHIELD,
  V2_MAX_POST_WIN_REPAIR,
  type V2EquipmentKind,
  type V2UnlockFamilyId,
} from '../data/equipment';
import { getV3SectorDef } from '../data/sectors';
import { getShipSignatureCommand } from '../data/ships';
import { calculateV2BuildStats, type V2BuildStats } from './buildStatsV2';
import { generateV2CombatRewardBundle } from './encounter';
import type {
  SectorId,
  V2ActiveCombatState,
  V2AppliedTacticalCommand,
  V2BossPhaseTransitionEvent,
  V2CargoBayState,
  V2CombatRoundLog,
  V2CombatSimulation,
  V2CombatUnitSnapshot,
  V2EliteTacticChoice,
  V2EliteTacticDecision,
  V2EliteTacticOptionPreview,
  V2EnemyAttackEvent,
  V2MapNode,
  V2PlayerAttackEvent,
  V2RunState,
  V2TacticalCommandId,
  V2TargetPolicy,
} from './types';

export const V2_MAX_COMBAT_ROUNDS = 30;
export const V2_ELITE_OVERLOAD_COST = 3;
export const V2_ELITE_OVERLOAD_RAW_DMG = 9;
export const V2_ELITE_DEFENSE_SHIELD_GAIN = 5;
export const V2_TACTIC_EMERGENCY_SHIELD_GAIN = 6;
export const V2_TACTIC_FOCUS_PRECISION_DMG = 4;
/** @deprecated Alias kept for external imports; Overload now spends shield first then HP */
export const V2_ELITE_OVERLOAD_SHIELD_COST = V2_ELITE_OVERLOAD_COST;

const MAX_LIVING_ENEMIES_WITH_SUMMONS = 4;
const MAX_CARRIER_SUMMONS_PER_UNIT = 3;

interface MutableUnit {
  readonly enemyId: string;
  readonly name: string;
  readonly spriteArchetype: V2EnemyUnitSpec['spriteArchetype'];
  hp: number;
  readonly maxHp: number;
  readonly damagePerRound: number;
  armor: number;
  readonly pierceRatio: number;
  readonly isBoss?: boolean;
  readonly role: V2EnemyUnitRole;
  shield: number;
  maxShield: number;
  currentPhase?: number;
  totalPhases?: number;
  phaseStartedRound: number;
  summonsDone: number;
}

export interface V2ScheduledTacticalCommand {
  readonly roundNumber: number;
  readonly choice: V2TacticalCommandId;
}

export interface V2StartCombatOptions {
  readonly enableTacticalCommands?: boolean;
  /** Legacy alias for enableTacticalCommands */
  readonly enableEliteTactic?: boolean;
  /** When true, bypasses all tactical pauses (Pure-Auto mode) */
  readonly pureAutoCombat?: boolean;
  /** Extra tactical command charges on Act Boss encounters (e.g. restored obsidian_crown +1) */
  readonly bonusBossCharges?: number;
}

/**
 * Authoritative helper identifying Act Boss / Boss encounters for charge budgets, UI badges, and settlement.
 */
export function isActBossOrBossNode(
  node: Pick<V2MapNode, 'type' | 'layer' | 'bossId' | 'combat'>,
  run?: Pick<V2RunState, 'isShowcase' | 'isTutorial'>
): boolean {
  if (!node.combat) return false;
  if (node.type === 'boss') return true;
  if (node.bossId || node.combat.bossId) return true;
  if (isActBossEncounterKind(node.combat.encounterKind)) return true;
  if (node.type === 'elite' && node.layer >= 6 && !run?.isShowcase && !run?.isTutorial) {
    return true;
  }
  return false;
}

/**
 * Resolves the canonical Boss ID (`boss_anvil` | `boss_dreadnought` | `boss_leviathan`) for a combat node.
 */
export function resolveNodeBossId(
  node: Pick<V2MapNode, 'type' | 'layer' | 'bossId' | 'combat'>,
  run: Pick<V2RunState, 'sectorId' | 'isTutorial' | 'isShowcase'>
): string | undefined {
  if (!node.combat) return node.bossId;
  if (node.combat.bossId) return node.combat.bossId;
  if (node.bossId) return node.bossId;
  if (isActBossEncounterKind(node.combat.encounterKind)) {
    return node.combat.encounterKind;
  }
  if (
    (node.type === 'elite' || node.type === 'boss') &&
    node.layer >= 6 &&
    !run.isTutorial &&
    !run.isShowcase
  ) {
    return getV3SectorDef(run.sectorId).bossId;
  }
  return undefined;
}

/**
 * Computes tactical command charge cap for a given combat node (1 regular/non-boss elite; 2 + bonus for Act Bosses).
 */
export function computeCombatTacticalChargesMax(
  node: Pick<V2MapNode, 'type' | 'layer' | 'bossId' | 'combat'>,
  run?: Pick<V2RunState, 'isShowcase' | 'isTutorial'>,
  bonusBossCharges = 0
): number {
  const safeBonus = Math.max(0, Math.floor(bonusBossCharges));
  if (isActBossOrBossNode(node, run)) {
    return 2 + safeBonus;
  }
  return 1;
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

function snapshotUnits(
  units: readonly MutableUnit[],
  nextRound: number,
  bossDef: V3BossDefinition | null,
  encounterKind?: string,
  bossId?: string
): readonly V2CombatUnitSnapshot[] {
  return units.map((u) => {
    const nextIntent =
      u.hp > 0
        ? resolveUnitIntentForRound({
            unit: u,
            round: nextRound,
            bossDef,
            currentPhase: u.currentPhase,
            phaseStartedRound: u.phaseStartedRound,
            encounterKind,
            bossId,
          })
        : undefined;
    return {
      enemyId: u.enemyId,
      name: u.name,
      spriteArchetype: u.spriteArchetype,
      hp: u.hp,
      maxHp: u.maxHp,
      damagePerRound: u.damagePerRound,
      armor: u.armor,
      pierceRatio: u.pierceRatio,
      ...(u.isBoss ? { isBoss: true } : {}),
      ...(u.maxShield > 0 || u.shield > 0
        ? { shield: u.shield, maxShield: Math.max(u.maxShield, u.shield) }
        : {}),
      ...(u.currentPhase !== undefined ? { currentPhase: u.currentPhase } : {}),
      ...(u.totalPhases !== undefined ? { totalPhases: u.totalPhases } : {}),
      ...(nextIntent ? { nextIntent } : {}),
    };
  });
}

function applyHitToUnit(
  unit: MutableUnit,
  sourceKind: V2PlayerAttackEvent['sourceKind'],
  sourceInstanceId: string,
  rawDamage: number,
  ignoreArmor = false
): V2PlayerAttackEvent {
  const safeRaw = Math.max(1, rawDamage);
  const wasAlive = unit.hp > 0;

  let shieldDamaged = 0;
  let hpDamage = 0;
  let armorBlocked = 0;

  if (unit.shield > 0) {
    shieldDamaged = Math.min(unit.shield, safeRaw);
    unit.shield -= shieldDamaged;
    const overflowRaw = safeRaw - shieldDamaged;
    if (overflowRaw > 0) {
      hpDamage = ignoreArmor ? overflowRaw : Math.max(1, overflowRaw - unit.armor);
      armorBlocked = Math.max(0, overflowRaw - hpDamage);
    }
  } else {
    // §8.2: Per-hit armor reduction: max(1, rawDamage - armor) (unless armor-piercing tactical order)
    hpDamage = ignoreArmor ? safeRaw : Math.max(1, safeRaw - unit.armor);
    armorBlocked = Math.max(0, safeRaw - hpDamage);
  }

  unit.hp = Math.max(0, unit.hp - hpDamage);
  const appliedDamage = shieldDamaged + hpDamage;

  return {
    sourceKind,
    sourceInstanceId,
    targetEnemyId: unit.enemyId,
    rawDamage: safeRaw,
    appliedDamage,
    armorBlocked,
    ...(shieldDamaged > 0 ? { shieldDamaged } : {}),
    targetHpAfter: unit.hp,
    targetKilled: wasAlive && unit.hp === 0,
  };
}

function processBossPhaseTransitions(params: {
  readonly enemies: MutableUnit[];
  readonly bossDef: V3BossDefinition | null;
  readonly round: number;
  readonly bossPhaseTransitions: V2BossPhaseTransitionEvent[];
  readonly summonedEnemies: V2CombatUnitSnapshot[];
  readonly enemySpecialNotes: string[];
  readonly justTransitionedBossIds: Set<string>;
  readonly encounterKind?: string;
  readonly bossId?: string;
}): void {
  const {
    enemies,
    bossDef,
    round,
    bossPhaseTransitions,
    summonedEnemies,
    enemySpecialNotes,
    justTransitionedBossIds,
    encounterKind,
    bossId,
  } = params;
  if (!bossDef) return;

  for (const unit of enemies) {
    if (!unit.isBoss || unit.hp <= 0 || unit.currentPhase === undefined) continue;
    for (const phaseDef of bossDef.phases) {
      if (phaseDef.phaseNumber <= unit.currentPhase) continue;
      const thresholdHp = Math.floor(unit.maxHp * phaseDef.hpThresholdRatio);
      if (unit.hp > thresholdHp) continue;

      const fromPhase = unit.currentPhase;
      unit.currentPhase = phaseDef.phaseNumber;
      unit.phaseStartedRound = round;
      justTransitionedBossIds.add(unit.enemyId);

      bossPhaseTransitions.push({
        enemyId: unit.enemyId,
        fromPhase,
        toPhase: phaseDef.phaseNumber,
        label: phaseDef.transitionBanner,
      });
      enemySpecialNotes.push(phaseDef.transitionBanner);

      if (phaseDef.armorOverride !== undefined) {
        unit.armor = phaseDef.armorOverride;
      }
      if (phaseDef.shieldGainOnEnter && phaseDef.shieldGainOnEnter > 0) {
        const cap = Math.max(unit.maxShield, bossDef.maxShield, phaseDef.shieldGainOnEnter);
        unit.maxShield = cap;
        unit.shield = Math.min(cap, unit.shield + phaseDef.shieldGainOnEnter);
      }
      if (phaseDef.summonSpec && phaseDef.summonOnEnterCount && phaseDef.summonOnEnterCount > 0) {
        let livingCount = enemies.filter((e) => e.hp > 0).length;
        for (let sIdx = 0; sIdx < phaseDef.summonOnEnterCount; sIdx++) {
          if (livingCount >= MAX_LIVING_ENEMIES_WITH_SUMMONS) break;
          const summonId = `${unit.enemyId}_p${phaseDef.phaseNumber}_s${sIdx + 1}`;
          if (enemies.some((e) => e.enemyId === summonId)) continue;
          const spec = phaseDef.summonSpec;
          const summoned: MutableUnit = {
            enemyId: summonId,
            name: phaseDef.summonOnEnterCount > 1 ? `${spec.name} ${String.fromCharCode(65 + sIdx)}` : spec.name,
            spriteArchetype: spec.spriteArchetype,
            hp: spec.maxHp,
            maxHp: spec.maxHp,
            damagePerRound: spec.damagePerRound,
            armor: spec.armor,
            pierceRatio: spec.pierceRatio,
            role: 'swarm_drone',
            shield: 0,
            maxShield: 0,
            phaseStartedRound: round + 1,
            summonsDone: 0,
          };
          enemies.push(summoned);
          livingCount += 1;
          const snap = snapshotUnits([summoned], round + 1, bossDef, encounterKind, bossId)[0];
          if (snap) summonedEnemies.push(snap);
        }
      }
    }
  }
}

export function getTacticalCommandLabel(choice: V2TacticalCommandId, shipId?: string): string {
  switch (choice) {
    case 'normal':
      return '正常执行';
    case 'overload':
      return '火力过载';
    case 'emergency_shield':
      return '紧急护盾';
    case 'emergency_defense':
      return '紧急防御';
    case 'focus_calibrate':
      return '聚焦校准';
    case 'signature_cannon_skiff':
      return '双联超频';
    case 'signature_shield_cruiser':
      return '相位反震';
    case 'signature_heavy_freighter':
      return '舱壁抢修';
    case 'signature_stargate_cruiser':
      return '星门共振';
    default:
      return shipId ? getShipSignatureCommand(shipId).label : '战术指令';
  }
}

/**
 * Single authoritative deterministic combat engine used identically by pre-combat preview,
 * tactical delta, tactical option previews, live Phaser playback, and settlement.
 */
export function simulateV2Combat(params: {
  readonly resultId: string;
  readonly bay: V2CargoBayState;
  readonly startingHp: number;
  readonly maxHp: number;
  readonly units: readonly V2EnemyUnitSpec[];
  readonly targetPolicy: V2TargetPolicy;
  readonly precomputedStats?: V2BuildStats;
  /** Legacy Round-2 single tactic hook */
  readonly round2Tactic?: V2EliteTacticChoice;
  /** V3 multi-charge scheduled tactical commands (cumulative, ordered by roundNumber) */
  readonly tacticalCommands?: readonly V2ScheduledTacticalCommand[];
  readonly sectorId?: SectorId;
  readonly crewId?: V2CrewId | null;
  readonly crewMasteryTier?: number;
  readonly encounterKind?: V2EncounterKind | string;
  readonly bossId?: string;
}): V2CombatSimulation {
  const stats = params.precomputedStats ?? calculateV2BuildStats(params.bay);
  const sectorId: SectorId = params.sectorId ?? 'near_orbit';
  const sector = getV3SectorDef(sectorId);
  const envModifierId = sector.envModifier.id;
  const masteryTier = Math.max(0, Math.min(2, Math.floor(params.crewMasteryTier ?? 0)));

  const bossDef = resolveV3BossDefForEncounter({
    encounterKind: params.encounterKind,
    bossId: params.bossId,
    units: params.units,
  });
  const resolvedBossId = params.bossId ?? bossDef?.bossId;

  const commandByRound = new Map<number, V2TacticalCommandId>();
  if (params.tacticalCommands && params.tacticalCommands.length > 0) {
    for (const cmd of params.tacticalCommands) {
      if (Number.isInteger(cmd.roundNumber) && cmd.roundNumber >= 1) {
        commandByRound.set(cmd.roundNumber, cmd.choice);
      }
    }
  } else if (params.round2Tactic) {
    commandByRound.set(2, params.round2Tactic);
  }

  const enemies: MutableUnit[] = params.units.map((u) => {
    const role = resolveUnitIntentRole(u, params.encounterKind, resolvedBossId);
    const shieldInit = resolveUnitInitialShield(u, params.encounterKind, resolvedBossId);
    const isMultiPhaseBoss = Boolean(u.isBoss && bossDef);
    return {
      enemyId: u.enemyId,
      name: u.name,
      spriteArchetype: u.spriteArchetype,
      hp: u.maxHp,
      maxHp: u.maxHp,
      damagePerRound: u.damagePerRound,
      armor: u.armor,
      pierceRatio: u.pierceRatio,
      isBoss: u.isBoss,
      role,
      shield: shieldInit.shield,
      maxShield: shieldInit.maxShield,
      ...(isMultiPhaseBoss ? { currentPhase: 1, totalPhases: bossDef!.phases.length } : {}),
      phaseStartedRound: 1,
      summonsDone: 0,
    };
  });

  const initialEnemies = snapshotUnits(enemies, 1, bossDef, params.encounterKind, resolvedBossId);
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
  let appliedTactic: V2TacticalCommandId | undefined = undefined;
  const appliedCommandsList: { readonly roundNumber: number; readonly choice: V2TacticalCommandId }[] = [];
  let heavyStallApplied = false;

  for (let round = 1; round <= V2_MAX_COMBAT_ROUNDS; round++) {
    // Step 1: Read start-of-round living enemies, compute hangar drone counts & heavy firing schedule
    const startLiving = enemies.filter((u) => u.hp > 0);
    if (startLiving.length === 0) {
      outcome = 'victory';
      break;
    }

    const roundCmd = commandByRound.get(round);
    let suppressDirectWeaponsThisRound = false;
    let ignoreArmorDirectThisRound = false;
    let directWeaponDmgBonus = 0;
    let pierceMitigationFactor = 1;
    let empImmuneThisRound = false;
    let counterBonusThisRound = 0;
    const tacticStrikes: {
      readonly sourceInstanceId: string;
      readonly rawDamage: number;
      readonly ignoreArmor: boolean;
      readonly aoe?: boolean;
    }[] = [];

    if (roundCmd) {
      appliedTactic = roundCmd;
      appliedCommandsList.push({ roundNumber: round, choice: roundCmd });
      if (
        roundCmd === 'overload' &&
        playerHp + playerShield > V2_ELITE_OVERLOAD_COST
      ) {
        const shieldPaid = Math.min(playerShield, V2_ELITE_OVERLOAD_COST);
        playerShield -= shieldPaid;
        const hpPaid = V2_ELITE_OVERLOAD_COST - shieldPaid;
        playerHp = Math.max(1, playerHp - hpPaid);
        tacticStrikes.push({
          sourceInstanceId: 'tactic_overload',
          rawDamage: V2_ELITE_OVERLOAD_RAW_DMG,
          ignoreArmor: true,
        });
      } else if (roundCmd === 'emergency_shield') {
        const shieldGain =
          V2_TACTIC_EMERGENCY_SHIELD_GAIN + (stats.bestActiveCounter ? 2 : 0);
        playerShield = Math.min(V2_MAX_BATTLE_SHIELD, playerShield + shieldGain);
        pierceMitigationFactor = 0.5;
        if (stats.bestActiveCounter) {
          counterBonusThisRound = 2;
        }
      } else if (roundCmd === 'emergency_defense') {
        const shieldGain =
          V2_ELITE_DEFENSE_SHIELD_GAIN + (stats.bestActiveCounter ? 2 : 0);
        playerShield = Math.min(V2_MAX_BATTLE_SHIELD, playerShield + shieldGain);
        suppressDirectWeaponsThisRound = true;
        heavyStallApplied = true;
        counterBonusThisRound = 2;
      } else if (roundCmd === 'focus_calibrate') {
        ignoreArmorDirectThisRound = true;
        directWeaponDmgBonus = 1;
        tacticStrikes.push({
          sourceInstanceId: 'tactic_focus_calibrate',
          rawDamage: V2_TACTIC_FOCUS_PRECISION_DMG,
          ignoreArmor: true,
        });
      } else if (roundCmd === 'signature_cannon_skiff') {
        directWeaponDmgBonus = 1;
        tacticStrikes.push(
          { sourceInstanceId: 'tactic_sig_cannon_skiff_1', rawDamage: 4, ignoreArmor: true },
          { sourceInstanceId: 'tactic_sig_cannon_skiff_2', rawDamage: 4, ignoreArmor: true }
        );
      } else if (roundCmd === 'signature_shield_cruiser') {
        playerShield = Math.min(V2_MAX_BATTLE_SHIELD, playerShield + 5);
        const shockwaveDmg = Math.max(4, Math.floor(playerShield * 0.5));
        tacticStrikes.push({
          sourceInstanceId: 'tactic_sig_shield_cruiser',
          rawDamage: shockwaveDmg,
          ignoreArmor: true,
          aoe: true,
        });
      } else if (roundCmd === 'signature_heavy_freighter') {
        playerHp = Math.min(params.maxHp, playerHp + 5);
        playerShield = Math.min(V2_MAX_BATTLE_SHIELD, playerShield + 4);
        empImmuneThisRound = true;
      } else if (roundCmd === 'signature_stargate_cruiser') {
        playerShield = Math.min(V2_MAX_BATTLE_SHIELD, playerShield + 4);
        tacticStrikes.push({
          sourceInstanceId: 'tactic_sig_stargate_cruiser',
          rawDamage: 7,
          ignoreArmor: true,
          aoe: true,
        });
      }
    }

    // Power diversion during legacy Emergency Defense stalls heavy railgun charge by 1 cycle
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

    // 2a. Core attack
    if (stats.coreAttack > 0 && !suppressDirectWeaponsThisRound) {
      playerAttacks.push(
        applyHitToUnit(
          primaryTarget,
          'core',
          'ship_core',
          stats.coreAttack + directWeaponDmgBonus + consumeFirstHitBonus(),
          ignoreArmorDirectThisRound
        )
      );
    }

    // 2a-bis. Tactical command / hull signature strikes
    for (const strike of tacticStrikes) {
      if (strike.aoe) {
        const livingSorted = enemies
          .filter((u) => u.hp > 0)
          .sort((a, b) => a.enemyId.localeCompare(b.enemyId));
        const targets = livingSorted.length > 0 ? livingSorted : [primaryTarget];
        for (const t of targets) {
          playerAttacks.push(
            applyHitToUnit(t, 'core', strike.sourceInstanceId, strike.rawDamage, strike.ignoreArmor)
          );
        }
      } else {
        const target = selectTargetByPolicy(enemies, params.targetPolicy) ?? primaryTarget;
        playerAttacks.push(
          applyHitToUnit(target, 'core', strike.sourceInstanceId, strike.rawDamage, strike.ignoreArmor)
        );
      }
    }

    if (!suppressDirectWeaponsThisRound) {
      // 2b. Lasers (sorted by instanceId)
      for (const l of stats.lasers) {
        playerAttacks.push(
          applyHitToUnit(
            primaryTarget,
            'laser',
            l.instanceId,
            l.totalDamage + directWeaponDmgBonus + consumeFirstHitBonus(),
            ignoreArmorDirectThisRound
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
              h.baseDamage + bonus + directWeaponDmgBonus + consumeFirstHitBonus(),
              ignoreArmorDirectThisRound
            )
          );
        }
      }

      // 2d. Hangar drones: each active drone acquires a living enemy independently
      for (const hg of stats.hangars) {
        const drones = droneCountsByHangar[hg.instanceId] ?? 0;
        for (let d = 0; d < drones; d++) {
          const droneTarget = selectTargetByPolicy(enemies, params.targetPolicy) ?? primaryTarget;
          playerAttacks.push(
            applyHitToUnit(
              droneTarget,
              'hangar',
              `${hg.instanceId}_d${d + 1}`,
              hg.damagePerDrone + consumeFirstHitBonus(),
              ignoreArmorDirectThisRound
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
              fl.damagePerEnemy + consumeFirstHitBonus(),
              ignoreArmorDirectThisRound
            )
          );
        }
      }
    }

    // Step 3b: Multi-Phase Act Boss threshold transitions (evaluated after player attack phase)
    const bossPhaseTransitions: V2BossPhaseTransitionEvent[] = [];
    const summonedEnemies: V2CombatUnitSnapshot[] = [];
    const enemySpecialNotes: string[] = [];
    const justTransitionedBossIds = new Set<string>();

    processBossPhaseTransitions({
      enemies,
      bossDef,
      round,
      bossPhaseTransitions,
      summonedEnemies,
      enemySpecialNotes,
      justTransitionedBossIds,
      encounterKind: params.encounterKind,
      bossId: resolvedBossId,
    });

    // Step 4: Simultaneous enemy actions from startLiving using telegraphed round intents
    const startLivingSorted = [...startLiving].sort((a, b) => a.enemyId.localeCompare(b.enemyId));
    const enemyAttacks: V2EnemyAttackEvent[] = [];
    const enemyIntentsThisRound: { readonly enemyId: string; readonly intent: V3EnemyIntent }[] = [];
    let shieldAbsorbedTotal = 0;
    const gravityEnemyDmgBonus = isGravitySurgeRound ? 1 : 0;

    for (const enemy of startLivingSorted) {
      const intent = resolveUnitIntentForRound({
        unit: enemy,
        round,
        bossDef,
        currentPhase: enemy.currentPhase,
        phaseStartedRound: enemy.phaseStartedRound,
        isTransitionRound: justTransitionedBossIds.has(enemy.enemyId),
        encounterKind: params.encounterKind,
        bossId: resolvedBossId,
      });
      enemyIntentsThisRound.push({ enemyId: enemy.enemyId, intent });

      let rawDamage = 0;
      let pierceDamage = 0;
      let shieldAbsorbed = 0;
      let hullDamage = 0;
      let empShieldDrained = 0;

      // Gravity tide (+1) applies ONLY when the enemy actually fires an attack (intent.damage > 0)
      if (intent.damage > 0) {
        rawDamage = intent.damage + gravityEnemyDmgBonus;
        const effectivePierceRatio =
          Math.max(0, Math.min(1, intent.pierceRatio ?? enemy.pierceRatio)) * pierceMitigationFactor;
        pierceDamage = effectivePierceRatio > 0 ? Math.floor(rawDamage * effectivePierceRatio) : 0;
        const normalDamage = rawDamage - pierceDamage;
        shieldAbsorbed = Math.min(playerShield, normalDamage);
        playerShield -= shieldAbsorbed;
        shieldAbsorbedTotal += shieldAbsorbed;
        hullDamage = pierceDamage + (normalDamage - shieldAbsorbed);
        playerHp = Math.max(0, playerHp - hullDamage);
      }

      // EMP Shield Disruptor effect (runs after damage or independently on EMP rounds)
      if (intent.empShieldDrain && intent.empShieldDrain > 0) {
        if (empImmuneThisRound) {
          enemySpecialNotes.push('舱壁防护：已抵御 EMP 护盾干扰');
        } else if (playerShield > 0) {
          empShieldDrained = Math.min(playerShield, intent.empShieldDrain);
          playerShield -= empShieldDrained;
          enemySpecialNotes.push(`${enemy.name} EMP 脉冲：我方护盾 -${empShieldDrained}`);
        }
      }

      if (rawDamage > 0 || empShieldDrained > 0) {
        enemyAttacks.push({
          enemyId: enemy.enemyId,
          rawDamage,
          pierceDamage,
          shieldAbsorbed,
          hullDamage,
          intentKind: intent.kind,
          ...(empShieldDrained > 0 ? { empShieldDrained } : {}),
        });
      }

      // Self-buffs & summons only execute if the unit survived player fire
      if (enemy.hp > 0 && intent.shieldGain && intent.shieldGain > 0) {
        const cap = Math.max(enemy.maxShield, intent.shieldGain, 6);
        enemy.maxShield = cap;
        const before = enemy.shield;
        enemy.shield = Math.min(cap, enemy.shield + intent.shieldGain);
        const gained = enemy.shield - before;
        if (gained > 0) {
          enemySpecialNotes.push(`${enemy.name} 护盾充能 +${gained}`);
        }
      }

      if (
        enemy.hp > 0 &&
        intent.summonCount &&
        intent.summonCount > 0 &&
        enemy.summonsDone < MAX_CARRIER_SUMMONS_PER_UNIT
      ) {
        let livingCount = enemies.filter((e) => e.hp > 0).length;
        for (let k = 0; k < intent.summonCount; k++) {
          if (
            livingCount >= MAX_LIVING_ENEMIES_WITH_SUMMONS ||
            enemy.summonsDone >= MAX_CARRIER_SUMMONS_PER_UNIT
          ) {
            break;
          }
          enemy.summonsDone += 1;
          const summonId = `${enemy.enemyId}_sum_r${round}_${enemy.summonsDone}`;
          const drone: MutableUnit = {
            enemyId: summonId,
            name: `母舰无人机 #${enemy.summonsDone}`,
            spriteArchetype: 'scout',
            hp: 5,
            maxHp: 5,
            damagePerRound: 1,
            armor: 0,
            pierceRatio: 0,
            role: 'swarm_drone',
            shield: 0,
            maxShield: 0,
            phaseStartedRound: round + 1,
            summonsDone: 0,
          };
          enemies.push(drone);
          livingCount += 1;
          const snap = snapshotUnits([drone], round + 1, bossDef, params.encounterKind, resolvedBossId)[0];
          if (snap) summonedEnemies.push(snap);
          enemySpecialNotes.push(`${enemy.name} 放出护航无人机`);
        }
      }
    }

    // Step 5: Counter phase (ship-wide ONCE per round, based ONLY on actual shield absorbed)
    let counterAttack: V2PlayerAttackEvent | null = null;
    if (stats.bestActiveCounter && shieldAbsorbedTotal > 0) {
      const rawCounter = Math.min(
        stats.bestActiveCounter.maxDamage + counterBonusThisRound,
        Math.floor(shieldAbsorbedTotal * stats.bestActiveCounter.ratio) + counterBonusThisRound
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
          // Counter damage can also push a living Boss across a phase threshold cleanly
          processBossPhaseTransitions({
            enemies,
            bossDef,
            round,
            bossPhaseTransitions,
            summonedEnemies,
            enemySpecialNotes,
            justTransitionedBossIds,
            encounterKind: params.encounterKind,
            bossId: resolvedBossId,
          });
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
      enemiesAfter: snapshotUnits(enemies, round + 1, bossDef, params.encounterKind, resolvedBossId),
      ...(envModifierEvent ? { envModifierEvent } : {}),
      ...(roundCmd ? { appliedTacticThisRound: roundCmd } : {}),
      ...(enemyIntentsThisRound.length > 0 ? { enemyIntentsThisRound } : {}),
      ...(bossPhaseTransitions.length > 0 ? { bossPhaseTransitions } : {}),
      ...(summonedEnemies.length > 0 ? { summonedEnemies } : {}),
      ...(enemySpecialNotes.length > 0 ? { enemySpecialNotes } : {}),
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
  const finalPlayerHpAfterRepair = outcome === 'victory' ? Math.min(params.maxHp, playerHp + repairApplied) : 0;

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
    ...(appliedCommandsList.length > 0 ? { appliedCommands: appliedCommandsList } : {}),
    sectorId,
    envModifierId,
    ...(resolvedBossId ? { bossId: resolvedBossId } : {}),
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
    encounterKind: node.combat.encounterKind,
    bossId: resolveNodeBossId(node, run),
  });
}

function buildTacticalDecisionAtRound(params: {
  readonly run: V2RunState;
  readonly node: V2MapNode;
  readonly targetPolicy: V2TargetPolicy;
  readonly startingHp: number;
  readonly baselineSim: V2CombatSimulation;
  readonly pauseRound: number;
  readonly priorCommands: readonly V2AppliedTacticalCommand[];
  readonly chargeIndex: number;
  readonly chargesMax: number;
}): V2EliteTacticDecision | null {
  const { run, node, targetPolicy, startingHp, baselineSim, pauseRound, priorCommands, chargeIndex, chargesMax } =
    params;
  if (!node.combat || pauseRound < 2) return null;
  if (baselineSim.rounds.length < pauseRound) return null;
  const prevRoundLog = baselineSim.rounds[pauseRound - 2];
  if (!prevRoundLog || prevRoundLog.playerHpAfter <= 0) return null;
  const aliveEnemies = prevRoundLog.enemiesAfter.filter((e) => e.hp > 0);
  if (aliveEnemies.length === 0) return null;

  const bossId = resolveNodeBossId(node, run);
  const priorScheduled: readonly V2ScheduledTacticalCommand[] = priorCommands.map((c) => ({
    roundNumber: c.roundNumber,
    choice: c.choice,
  }));

  const runPreviewWithChoice = (choice: V2TacticalCommandId): V2CombatSimulation =>
    simulateV2Combat({
      resultId: `prev_${choice}_${run.runId}_${node.nodeId}_r${pauseRound}`,
      bay: run.bay,
      startingHp,
      maxHp: run.maxHp,
      units: node.combat!.units,
      targetPolicy,
      tacticalCommands: [...priorScheduled, { roundNumber: pauseRound, choice }],
      sectorId: run.sectorId,
      crewId: run.crewId,
      crewMasteryTier: run.crewMasteryTier ?? 0,
      encounterKind: node.combat!.encounterKind,
      bossId,
    });

  const hpAtPause = prevRoundLog.playerHpAfter;
  const shieldAtPause = prevRoundLog.playerShieldAfter;
  const canOverload = hpAtPause + shieldAtPause > V2_ELITE_OVERLOAD_COST;
  const overloadShieldCost = Math.min(shieldAtPause, V2_ELITE_OVERLOAD_COST);
  const overloadHpCost = V2_ELITE_OVERLOAD_COST - overloadShieldCost;
  const overloadCostLabel =
    overloadHpCost === 0
      ? `消耗 ${overloadShieldCost} 护盾`
      : overloadShieldCost === 0
      ? `消耗 ${overloadHpCost} 耐久`
      : `消耗 ${overloadShieldCost} 盾 + ${overloadHpCost} 耐久`;

  const simOverload = canOverload ? runPreviewWithChoice('overload') : baselineSim;
  const simShield = runPreviewWithChoice('emergency_shield');
  const simFocus = runPreviewWithChoice('focus_calibrate');

  const sigDef = getShipSignatureCommand(run.shipId);
  const simSignature = runPreviewWithChoice(sigDef.choice);

  const hasCounter = calculateV2BuildStats(run.bay).bestActiveCounter !== null;
  const shieldGain = V2_TACTIC_EMERGENCY_SHIELD_GAIN + (hasCounter ? 2 : 0);

  // Ordered strictly: 1. overload, 2. emergency_shield, 3. focus_calibrate, 4. Hull Signature (LAST!)
  const options: V2EliteTacticOptionPreview[] = [
    {
      choice: 'overload',
      label: '火力过载',
      summary: `${overloadCostLabel}，追加 1 次 ${V2_ELITE_OVERLOAD_RAW_DMG} 点无视护甲破甲直击`,
      enabled: canOverload,
      disabledReason: canOverload
        ? undefined
        : `剩余护盾与耐久总和 ${hpAtPause + shieldAtPause} ≤ ${V2_ELITE_OVERLOAD_COST}，无法承受过载反冲`,
      predictedOutcome: simOverload.outcome,
      predictedFinalHp: simOverload.outcome === 'victory' ? simOverload.finalPlayerHpAfterRepair : 0,
      predictedRounds: simOverload.roundsCount,
    },
    {
      choice: 'emergency_shield',
      label: '紧急护盾',
      summary: `立刻 +${shieldGain} 护盾（上限 ${V2_MAX_BATTLE_SHIELD}${
        hasCounter ? '，反击协同 +2 盾/+2 伤' : ''
      }），且本轮敌方穿盾比例减半`,
      enabled: true,
      predictedOutcome: simShield.outcome,
      predictedFinalHp: simShield.outcome === 'victory' ? simShield.finalPlayerHpAfterRepair : 0,
      predictedRounds: simShield.roundsCount,
    },
    {
      choice: 'focus_calibrate',
      label: '聚焦校准',
      summary: `本轮我方直击武器全部无视敌方护甲且伤害 +1，并追加 ${V2_TACTIC_FOCUS_PRECISION_DMG} 点破甲精准齐射`,
      enabled: true,
      predictedOutcome: simFocus.outcome,
      predictedFinalHp: simFocus.outcome === 'victory' ? simFocus.finalPlayerHpAfterRepair : 0,
      predictedRounds: simFocus.roundsCount,
    },
    {
      choice: sigDef.choice,
      label: sigDef.label,
      summary: sigDef.summary,
      enabled: true,
      isSignature: true,
      predictedOutcome: simSignature.outcome,
      predictedFinalHp: simSignature.outcome === 'victory' ? simSignature.finalPlayerHpAfterRepair : 0,
      predictedRounds: simSignature.roundsCount,
    },
  ];

  // Authoritative incoming threat damage at pauseRound (matches actual simulated round salvo!)
  const pauseRoundLog = baselineSim.rounds[pauseRound - 1];
  const isGravitySurge =
    getV3SectorDef(run.sectorId).envModifier.id === 'gravity_tide' && pauseRound % 2 === 0;
  const enemyThreatDamage = pauseRoundLog
    ? pauseRoundLog.enemyAttacks.reduce((sum, a) => sum + a.rawDamage, 0)
    : aliveEnemies.reduce((sum, e) => {
        const dmg = e.nextIntent ? e.nextIntent.damage : e.damagePerRound;
        return sum + (dmg > 0 ? dmg + (isGravitySurge ? 1 : 0) : 0);
      }, 0);

  const bossSnap = aliveEnemies.find((e) => e.isBoss);
  const chargesRemaining = Math.max(1, chargesMax - (chargeIndex - 1));

  return {
    decisionId: `tactic_${run.runId}_${node.nodeId}_r${pauseRound}_c${chargeIndex}`,
    roundNumber: pauseRound,
    playerHpAtPause: hpAtPause,
    playerShieldAtPause: shieldAtPause,
    enemyThreatDamage,
    enemiesAlive: aliveEnemies.length,
    options,
    chosen: null,
    chargeIndex,
    chargesRemaining,
    chargesMax,
    ...(bossSnap?.currentPhase !== undefined ? { bossPhaseAtPause: bossSnap.currentPhase } : {}),
  };
}

function findNextPauseRoundAfterCommit(
  sim: V2CombatSimulation,
  committedRound: number
): number | null {
  const isRoundPausable = (r: number): boolean => {
    if (r <= committedRound || sim.rounds.length < r) return false;
    const prev = sim.rounds[r - 2];
    if (!prev || prev.playerHpAfter <= 0) return false;
    return prev.enemiesAfter.some((e) => e.hp > 0);
  };

  // 1. Prefer the first round immediately following a Boss phase transition at >= committedRound
  for (let idx = Math.max(0, committedRound - 1); idx < sim.rounds.length; idx++) {
    const rLog = sim.rounds[idx];
    if (rLog.bossPhaseTransitions && rLog.bossPhaseTransitions.length > 0) {
      const candidate = rLog.round + 1;
      if (isRoundPausable(candidate)) return candidate;
    }
  }

  // 2. Fallback to committedRound + 2 (pacing rhythm)
  if (isRoundPausable(committedRound + 2)) {
    return committedRound + 2;
  }

  // 3. Fallback to committedRound + 1 if battle would otherwise finish before R+2 (guarantees 2nd charge window)
  if (isRoundPausable(committedRound + 1)) {
    return committedRound + 1;
  }

  return null;
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
 * Starts combat at the current combat/elite/boss node, locking the exact simulation snapshot into activeCombat.
 * - Computes dynamic `tacticalChargesMax` (1 regular/non-boss elite; 2 + bonusBossCharges for Act Bosses) and resets `tacticalChargesUsed = 0`.
 * - Enables mid-combat active tactical pause when requested (always ON in V2AppController unless `pureAutoCombat === true`).
 * - Idempotent on refresh when `run.activeCombat.nodeId === node.nodeId`.
 */
export function startV2CombatAtCurrentNode(
  run: V2RunState,
  policyOverride?: V2TargetPolicy,
  options?: V2StartCombatOptions
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
  const bossId = resolveNodeBossId(node, run);
  const tacticalChargesMax = computeCombatTacticalChargesMax(node, run, options?.bonusBossCharges ?? 0);
  const tacticalChargesUsed = 0;

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
    encounterKind: node.combat.encounterKind,
    bossId,
  });

  const tacticalEnabled =
    options?.pureAutoCombat !== true &&
    (options?.enableTacticalCommands === true ||
      options?.enableEliteTactic === true ||
      options?.pureAutoCombat === false);

  const pendingDecision =
    tacticalEnabled && tacticalChargesMax > 0
      ? buildTacticalDecisionAtRound({
          run,
          node,
          targetPolicy,
          startingHp: run.hp,
          baselineSim: simulation,
          pauseRound: 2,
          priorCommands: [],
          chargeIndex: 1,
          chargesMax: tacticalChargesMax,
        })
      : null;

  const activeCombat: V2ActiveCombatState = {
    nodeId: node.nodeId,
    startingHp: run.hp,
    targetPolicy,
    simulation,
    pendingDecision,
    committedCommands: [],
    resumeFromRound: 0,
    pausedAtDecisionId: null,
  };

  return {
    ok: true,
    run: {
      ...run,
      targetPolicy,
      tacticalChargesMax,
      tacticalChargesUsed,
      activeCombat,
    },
  };
}

/**
 * Pure helper marking that live playback has reached the active tactical pause boundary
 * so browser reload restores the pause immediately without replaying earlier rounds.
 */
export function markV2CombatDecisionPaused(
  run: V2RunState,
  decisionId: string
): V2RunState {
  if (!run.activeCombat || !run.activeCombat.pendingDecision) return run;
  const pending = run.activeCombat.pendingDecision;
  if (pending.decisionId !== decisionId || pending.chosen !== null) return run;
  const pauseResumeIdx = Math.max(0, pending.roundNumber - 1);
  if (
    run.activeCombat.pausedAtDecisionId === decisionId &&
    run.activeCombat.resumeFromRound === pauseResumeIdx
  ) {
    return run;
  }
  return {
    ...run,
    activeCombat: {
      ...run.activeCombat,
      resumeFromRound: pauseResumeIdx,
      pausedAtDecisionId: decisionId,
    },
  };
}

/**
 * Commits the player's active tactical command atomically and idempotently.
 * - Accumulates multi-charge commands across Boss phases while maintaining 100% deterministic preview parity.
 * - Increments `tacticalChargesUsed` cleanly without ever exceeding `tacticalChargesMax`.
 * - Chains Pause #2 / #3 automatically when charges remain and battle continues.
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
    return { ok: false, run, error: '当前战斗节点数据异常' };
  }

  const consumesCharge = choice !== 'normal';
  if (consumesCharge && run.tacticalChargesUsed >= run.tacticalChargesMax) {
    return { ok: false, run, error: '本场战斗战术指令充能已耗尽' };
  }

  const prevCommitted = run.activeCombat.committedCommands ?? [];
  const nextCommitted: readonly V2AppliedTacticalCommand[] = consumesCharge
    ? [
        ...prevCommitted,
        { decisionId, roundNumber: pending.roundNumber, choice },
      ]
    : [...prevCommitted];
  const nextChargesUsed = consumesCharge
    ? Math.min(run.tacticalChargesMax, run.tacticalChargesUsed + 1)
    : run.tacticalChargesUsed;

  const bossId = resolveNodeBossId(node, run);
  const scheduledCommands: readonly V2ScheduledTacticalCommand[] = nextCommitted.map((c) => ({
    roundNumber: c.roundNumber,
    choice: c.choice,
  }));

  const nextSimulation = simulateV2Combat({
    resultId: `cmb_${run.runId}_${node.nodeId}_r${pending.roundNumber}_${choice}_c${nextChargesUsed}`,
    bay: run.bay,
    startingHp: run.activeCombat.startingHp,
    maxHp: run.maxHp,
    units: node.combat.units,
    targetPolicy: run.activeCombat.targetPolicy,
    tacticalCommands:
      scheduledCommands.length > 0
        ? scheduledCommands
        : [{ roundNumber: pending.roundNumber, choice }],
    sectorId: run.sectorId,
    crewId: run.crewId,
    crewMasteryTier: run.crewMasteryTier ?? 0,
    encounterKind: node.combat.encounterKind,
    bossId,
  });

  // Check if another charge remains and combat continues to a later pause round (e.g. Boss Phase 2 / 3)
  let nextPendingDecision: V2EliteTacticDecision = {
    ...pending,
    chosen: choice,
  };
  if (nextChargesUsed < run.tacticalChargesMax) {
    const nextPauseRound = findNextPauseRoundAfterCommit(nextSimulation, pending.roundNumber);
    if (nextPauseRound !== null) {
      const chained = buildTacticalDecisionAtRound({
        run,
        node,
        targetPolicy: run.activeCombat.targetPolicy,
        startingHp: run.activeCombat.startingHp,
        baselineSim: nextSimulation,
        pauseRound: nextPauseRound,
        priorCommands: nextCommitted,
        chargeIndex: nextChargesUsed + 1,
        chargesMax: run.tacticalChargesMax,
      });
      if (chained) {
        nextPendingDecision = chained;
      }
    }
  }

  return {
    ok: true,
    run: {
      ...run,
      tacticalChargesUsed: nextChargesUsed,
      activeCombat: {
        ...run.activeCombat,
        simulation: nextSimulation,
        pendingDecision: nextPendingDecision,
        committedCommands: nextCommitted,
        resumeFromRound: Math.max(0, pending.roundNumber - 1),
        pausedAtDecisionId: null,
      },
      claimedEventIds: [...run.claimedEventIds, claimKey],
    },
  };
}

/**
 * Commits the deterministic combat result once playback finishes or is skipped.
 * - Strictly refuses completion while any tactical decision remains unresolved!
 * - Preserves `tacticalChargesUsed` so post-combat telemetry/save records charges spent.
 * - Victory: applies post-repair HP, pays fixed bounty into run.wallet, records defeated boss & enemy kinds, generates deterministic 3-choice reward bundle.
 * - Defeat: sets HP = 0 and enters SETTLEMENT (defeat).
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
    return { ok: false, run, error: '请先完成当前回合的战术指令抉择' };
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
  const bossIdOnNode = resolveNodeBossId(node, run);

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
