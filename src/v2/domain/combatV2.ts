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
  V2_EQUIPMENT_DEFS,
  V2_MAX_BATTLE_SHIELD,
  V2_MAX_POST_WIN_REPAIR,
  type V2EquipmentKind,
  type V2Quality,
  type V2UnlockFamilyId,
} from '../data/equipment';
import { aggregateEndlessMutatorEffects, getV3SectorDef } from '../data/sectors';
import { getShipSignatureCommand } from '../data/ships';
import { calculateV2BuildStats, type V2BuildStats } from './buildStatsV2';
import { freezeRunBonusObjectiveForSettlement } from './contracts';
import { generateV2CombatRewardBundle } from './encounter';
import { areV2PlacedItemsAdjacent } from './inventoryV2';
import type {
  SectorId,
  V2ActiveCombatState,
  V2AppliedTacticalCommand,
  V2BossPhaseTransitionEvent,
  V2CargoBayState,
  V2CombatIntervention,
  V2CombatRoundLog,
  V2CombatSimulation,
  V2CombatUnitSnapshot,
  V2EliteTacticChoice,
  V2EliteTacticDecision,
  V2EliteTacticOptionPreview,
  V2EnemyAttackEvent,
  V2MapNode,
  V2PlacedItem,
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
  /** Optional Stargate Relay tier (T2+ grants R1 core bonus damage) */
  readonly stargateRelayTier?: number;
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

function selectTarget(
  candidates: readonly MutableUnit[],
  policy: V2TargetPolicy,
  lockedEnemyId?: string | null
): MutableUnit | null {
  if (lockedEnemyId) {
    const locked = candidates.find((u) => u.enemyId === lockedEnemyId && u.hp > 0);
    if (locked) return locked;
  }
  return selectTargetByPolicy(candidates, policy);
}

export interface V2OverloadableModuleSummary {
  readonly instanceId: string;
  readonly definitionId: string;
  readonly kind: V2EquipmentKind;
  readonly quality: V2Quality;
  readonly name: string;
  readonly overloadTitle: string;
  readonly overloadSummary: string;
  readonly adjacentPartnerCount: number;
  readonly adjacentPartnerNames: readonly string[];
}

function findOrthogonallyAdjacentPlacedEquipment(
  bay: V2CargoBayState,
  sourcePlaced: V2PlacedItem
): readonly { readonly placed: V2PlacedItem; readonly kind: V2EquipmentKind; readonly name: string; readonly quality: V2Quality }[] {
  const result: { readonly placed: V2PlacedItem; readonly kind: V2EquipmentKind; readonly name: string; readonly quality: V2Quality }[] = [];
  for (const other of bay.placed) {
    if (other.item.instanceId === sourcePlaced.item.instanceId) continue;
    const def = V2_EQUIPMENT_DEFS[other.item.definitionId];
    if (!def) continue;
    if (areV2PlacedItemsAdjacent(sourcePlaced, other)) {
      result.push({ placed: other, kind: def.kind, name: def.name, quality: def.quality });
    }
  }
  result.sort((a, b) => a.placed.item.instanceId.localeCompare(b.placed.item.instanceId));
  return result;
}

/**
 * Pure single source of truth describing all mounted combat modules eligible for D01 component overload.
 */
export function listV2OverloadableModules(
  bay: V2CargoBayState,
  precomputedStats?: V2BuildStats
): readonly V2OverloadableModuleSummary[] {
  const stats = precomputedStats ?? calculateV2BuildStats(bay);
  const items: V2OverloadableModuleSummary[] = [];
  const placedSorted = [...bay.placed].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    if (a.x !== b.x) return a.x - b.x;
    return a.item.instanceId.localeCompare(b.item.instanceId);
  });

  for (const placed of placedSorted) {
    const def = V2_EQUIPMENT_DEFS[placed.item.definitionId];
    if (!def) continue;
    const adjacent =
      def.kind === 'battery' ? findOrthogonallyAdjacentPlacedEquipment(bay, placed) : [];
    const adjacentNames = adjacent.map((a) => a.name);

    let overloadTitle: string;
    let overloadSummary: string;
    switch (def.kind) {
      case 'laser': {
        const lStat = stats.lasers.find((l) => l.instanceId === placed.item.instanceId);
        const burstDmg = (lStat?.totalDamage ?? (def.quality === 'improved' ? 4 : 3)) + 4;
        overloadTitle = '激光连射';
        overloadSummary = `本轮主射 +2 伤，并追加 1 发 ${burstDmg} 伤过载连射`;
        break;
      }
      case 'heavy': {
        overloadTitle = '重炮急射';
        overloadSummary = '蓄能轮立刻破甲开火（+4 伤）；开火轮转为 +8 伤破甲重炮齐射';
        break;
      }
      case 'shield': {
        const gain = def.quality === 'improved' ? 10 : 8;
        overloadTitle = '护盾爆发';
        overloadSummary = `立刻 +${gain} 护盾（上限 ${V2_MAX_BATTLE_SHIELD}），且本轮敌方穿盾减半`;
        break;
      }
      case 'repair': {
        const heal = def.quality === 'improved' ? 9 : 7;
        overloadTitle = '应急抢修';
        overloadSummary = `立刻紧急抢修 +${heal} 耐久并补充 +3 护盾`;
        break;
      }
      case 'battery': {
        overloadTitle = '相邻超载供能';
        overloadSummary =
          adjacent.length > 0
            ? `同时增幅 ${adjacent.length} 件正交相邻模块（${adjacentNames.join('、')}）本轮爆发`
            : '无相邻模块：释放 +6 破甲电弧并补充 +2 护盾';
        break;
      }
      case 'salvo_pod': {
        overloadTitle = '导弹过载齐射';
        overloadSummary = '本轮额外发射 +3 枚增压导弹（每发 +1 伤并自动切换击杀目标）';
        break;
      }
      case 'hangar': {
        overloadTitle = '编队紧急出击';
        overloadSummary = '本轮额外出动 +3 架过载无人机（每架 +1 伤）';
        break;
      }
      case 'flak': {
        overloadTitle = '全向弹幕过载';
        overloadSummary = '对全体敌舰追加 1 轮破甲全向弹幕（每目标额外 +3 伤）';
        break;
      }
      case 'emp_jammer': {
        overloadTitle = '高能 EMP 爆震';
        overloadSummary = '击碎目标 8 点护盾、追加破甲电磁击、本轮免疫 EMP 并削弱敌火';
        break;
      }
      case 'counter': {
        overloadTitle = '反击场超频';
        overloadSummary = '立刻 +5 护盾并提升本轮反击伤害与上限 +4';
        break;
      }
      case 'coolant_vent': {
        overloadTitle = '紧急冷排过载';
        overloadSummary = '立刻 +6 护盾、本轮穿盾减半并令重炮/导弹本轮 +3 伤';
        break;
      }
      case 'overdrive_core': {
        overloadTitle = '核心超频脉冲';
        overloadSummary = '本轮全直击破甲 +3 伤，并追加 5 伤核心过载束';
        break;
      }
      case 'capacitor': {
        overloadTitle = '电容紧急放电';
        overloadSummary = '触发全部重炮立刻破甲开火（无重炮时发射 +5 破甲电弧）';
        break;
      }
      case 'relay': {
        overloadTitle = '编队中继超频';
        overloadSummary = '全部机库/导弹舱本轮额外 +2 无人机/导弹（否则 +6 精准打击）';
        break;
      }
      case 'cargo_amp': {
        overloadTitle = '货舱谐振爆发';
        overloadSummary = '立刻 +4 护盾并按邻近货物释放破甲谐振冲击';
        break;
      }
      case 'salvage_grapple': {
        overloadTitle = '磁爪过载重击';
        overloadSummary = '释放 +6 额外伤破甲磁爪猛击并补充 +3 护盾';
        break;
      }
      default: {
        overloadTitle = '模块过载';
        overloadSummary = '释放过载能量冲击';
        break;
      }
    }

    items.push({
      instanceId: placed.item.instanceId,
      definitionId: placed.item.definitionId,
      kind: def.kind,
      quality: def.quality,
      name: def.name,
      overloadTitle,
      overloadSummary,
      adjacentPartnerCount: adjacent.length,
      adjacentPartnerNames: adjacentNames,
    });
  }

  return items;
}

function applyEnemyPierceBonus(basePierce: number, enemyPierceBonus: number): number {
  const clampedBase = Math.max(0, Math.min(1, basePierce));
  if (enemyPierceBonus <= 0) return clampedBase;
  return Math.min(0.65, Number((clampedBase + enemyPierceBonus).toFixed(2)));
}

function snapshotUnits(
  units: readonly MutableUnit[],
  nextRound: number,
  bossDef: V3BossDefinition | null,
  encounterKind?: string,
  bossId?: string,
  enemyPierceBonus = 0
): readonly V2CombatUnitSnapshot[] {
  return units.map((u) => {
    const rawNextIntent =
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
    const nextIntent =
      rawNextIntent && rawNextIntent.damage > 0 && enemyPierceBonus > 0
        ? {
            ...rawNextIntent,
            pierceRatio: applyEnemyPierceBonus(
              rawNextIntent.pierceRatio ?? u.pierceRatio,
              enemyPierceBonus
            ),
          }
        : rawNextIntent;
    const displayPierceRatio =
      enemyPierceBonus > 0
        ? applyEnemyPierceBonus(u.pierceRatio, enemyPierceBonus)
        : u.pierceRatio;
    return {
      enemyId: u.enemyId,
      name: u.name,
      spriteArchetype: u.spriteArchetype,
      hp: u.hp,
      maxHp: u.maxHp,
      damagePerRound: u.damagePerRound,
      armor: u.armor,
      pierceRatio: displayPierceRatio,
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
  ignoreArmor = false,
  isOverload = false
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
    ...(isOverload ? { isOverload: true } : {}),
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
  readonly enemyPierceBonus?: number;
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
    enemyPierceBonus = 0,
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
          const snap = snapshotUnits(
            [summoned],
            round + 1,
            bossDef,
            encounterKind,
            bossId,
            enemyPierceBonus
          )[0];
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
  readonly overchargeCellActive?: boolean;
  readonly stargateRelayTier?: number;
  readonly endlessThreat?: number;
  readonly endlessMutatorIds?: readonly string[];
  /** D02: Opening Round-1 specific-enemy target lock (auto-fallback to targetPolicy on death) */
  readonly lockedEnemyId?: string | null;
  /** D01/D02: Ordered deterministic mid-combat interventions (tactical commands, module overloads, target locks) */
  readonly interventions?: readonly V2CombatIntervention[];
}): V2CombatSimulation {
  const stats = params.precomputedStats ?? calculateV2BuildStats(params.bay);
  const sectorId: SectorId = params.sectorId ?? 'near_orbit';
  const sector = getV3SectorDef(sectorId);
  const envModifierId = sector.envModifier.id;
  const masteryTier = Math.max(0, Math.min(2, Math.floor(params.crewMasteryTier ?? 0)));
  const relayTier = Math.max(0, Math.floor(params.stargateRelayTier ?? 0));
  const endlessThreat = Math.max(0, Math.min(10, Math.floor(params.endlessThreat ?? 0)));
  const mutatorEffects = aggregateEndlessMutatorEffects(params.endlessMutatorIds);

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

  const interventionsByRound = new Map<number, V2CombatIntervention[]>();
  if (params.interventions && params.interventions.length > 0) {
    for (const iv of params.interventions) {
      if (!Number.isInteger(iv.roundNumber) || iv.roundNumber < 1) continue;
      if (iv.kind === 'tactical_command' && iv.commandId) {
        commandByRound.set(iv.roundNumber, iv.commandId);
      }
      const list = interventionsByRound.get(iv.roundNumber);
      if (list) list.push(iv);
      else interventionsByRound.set(iv.roundNumber, [iv]);
    }
  }

  const enemies: MutableUnit[] = params.units.map((u) => {
    const role = resolveUnitIntentRole(u, params.encounterKind, resolvedBossId);
    const shieldInit = resolveUnitInitialShield(u, params.encounterKind, resolvedBossId);
    const isMultiPhaseBoss = Boolean(u.isBoss && bossDef);
    const effMaxHp =
      mutatorEffects.enemyHpBonusPct > 0
        ? Math.max(1, Math.round(u.maxHp * (1 + mutatorEffects.enemyHpBonusPct)))
        : u.maxHp;
    const effArmor = u.armor + (role === 'swarm_drone' ? 0 : mutatorEffects.enemyArmorBonus);
    const effShield = shieldInit.shield + mutatorEffects.enemyOpeningShield;
    const effMaxShield = Math.max(shieldInit.maxShield, effShield);
    return {
      enemyId: u.enemyId,
      name: u.name,
      spriteArchetype: u.spriteArchetype,
      hp: effMaxHp,
      maxHp: effMaxHp,
      damagePerRound: u.damagePerRound,
      armor: effArmor,
      pierceRatio: u.pierceRatio,
      isBoss: u.isBoss,
      role,
      shield: effShield,
      maxShield: effMaxShield,
      ...(isMultiPhaseBoss ? { currentPhase: 1, totalPhases: bossDef!.phases.length } : {}),
      phaseStartedRound: 1,
      summonsDone: 0,
    };
  });

  const initialEnemies = snapshotUnits(
    enemies,
    1,
    bossDef,
    params.encounterKind,
    resolvedBossId,
    mutatorEffects.enemyPierceBonus
  );
  let playerHp = Math.max(0, params.startingHp);

  // Opening shield: base build shield + Engineer Mastery T2 (+2) + Overcharge Cell (+4), capped at 20,
  // then Sector 2 cryo_ion (-2, min 0) and Endless mutator openingShieldPenalty (e.g. ion_surge -2)
  const engineerOpeningShieldBonus = params.crewId === 'engineer' && masteryTier >= 2 ? 2 : 0;
  const overchargeShieldBonus = params.overchargeCellActive ? 4 : 0;
  const preEnvShield = Math.min(
    V2_MAX_BATTLE_SHIELD,
    stats.effectiveShield + engineerOpeningShieldBonus + overchargeShieldBonus
  );
  const cryoOpenDrain = envModifierId === 'cryo_ion' ? Math.max(0, 2 - stats.cryoDrainReduction) : 0;
  const mutatorOpenDrain = mutatorEffects.openingShieldPenalty;
  let playerShield = Math.max(0, preEnvShield - cryoOpenDrain - mutatorOpenDrain);
  const cryoOpeningSuppressed = envModifierId === 'cryo_ion' && cryoOpenDrain > 0 && preEnvShield > 0;
  const mutatorOpeningSuppressed = mutatorOpenDrain > 0 && preEnvShield - cryoOpenDrain > playerShield;
  const startingPlayerShield = playerShield;
  const rounds: V2CombatRoundLog[] = [];

  let outcome: 'victory' | 'defeat' = 'defeat';
  let stalemate = false;
  let appliedTactic: V2TacticalCommandId | undefined = undefined;
  const appliedCommandsList: { readonly roundNumber: number; readonly choice: V2TacticalCommandId }[] = [];
  const appliedInterventionsList: V2CombatIntervention[] = [];
  let activeLockedEnemyId: string | null = params.lockedEnemyId ?? null;
  let heavyStallApplied = false;

  for (let round = 1; round <= V2_MAX_COMBAT_ROUNDS; round++) {
    // Step 1: Read start-of-round living enemies, compute hangar drone counts & heavy firing schedule
    const startLiving = enemies.filter((u) => u.hp > 0);
    if (startLiving.length === 0) {
      outcome = 'victory';
      break;
    }

    const roundInterventions = interventionsByRound.get(round) ?? [];
    const appliedInterventionsThisRound: V2CombatIntervention[] = [];

    // Apply any mid-combat target_lock interventions scheduled for this round BEFORE target acquisition
    let effectiveLockIntervention: V2CombatIntervention | null = null;
    for (const iv of roundInterventions) {
      if (iv.kind === 'target_lock') {
        activeLockedEnemyId = iv.targetEnemyId ?? null;
        effectiveLockIntervention = iv;
      }
    }
    if (effectiveLockIntervention) {
      appliedInterventionsThisRound.push(effectiveLockIntervention);
      appliedInterventionsList.push(effectiveLockIntervention);
    }

    const roundCmd = commandByRound.get(round);
    let suppressDirectWeaponsThisRound = false;
    let ignoreArmorDirectThisRound = false;
    let directWeaponDmgBonus = 0;
    let pierceMitigationFactor = 1;
    let empImmuneThisRound = false;
    let counterBonusThisRound = 0;
    let overloadEnemyWeakenExtra = 0;
    const tacticStrikes: {
      readonly sourceKind?: V2PlayerAttackEvent['sourceKind'];
      readonly sourceInstanceId: string;
      readonly rawDamage: number;
      readonly ignoreArmor: boolean;
      readonly aoe?: boolean;
      readonly isOverload?: boolean;
    }[] = [];

    // Per-module D01 overload boost maps for this round
    const laserDmgBonusById = new Map<string, number>();
    const laserExtraBursts: { readonly instanceId: string; readonly rawDamage: number }[] = [];
    const forcedHeavyFireIds = new Set<string>();
    const heavyOverloadBonusById = new Map<string, number>();
    const heavyOverloadPierceIds = new Set<string>();
    const salvoExtraMissilesById = new Map<string, { readonly count: number; readonly dmgBonus: number }>();
    const hangarExtraDronesById = new Map<string, { readonly count: number; readonly dmgBonus: number }>();
    const flakExtraVolleys: { readonly instanceId: string; readonly rawDamage: number; readonly ignoreArmor: boolean }[] = [];
    const empExtraBursts: { readonly instanceId: string; readonly rawDamage: number; readonly shieldShred: number }[] = [];
    const grappleExtraBursts: { readonly instanceId: string; readonly rawDamage: number }[] = [];
    let coolantOverloadHeavySalvoBonus = 0;

    if (roundCmd) {
      appliedTactic = roundCmd;
      appliedCommandsList.push({ roundNumber: round, choice: roundCmd });
      const matchingCmdIv = roundInterventions.find(
        (iv) => iv.kind === 'tactical_command' && iv.commandId === roundCmd
      );
      if (matchingCmdIv) {
        appliedInterventionsThisRound.push(matchingCmdIv);
        appliedInterventionsList.push(matchingCmdIv);
      }
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

    // D01: Apply per-module component overload interventions scheduled for this round
    const addLaserBonus = (id: string, amt: number) => {
      laserDmgBonusById.set(id, (laserDmgBonusById.get(id) ?? 0) + amt);
    };
    const addHeavyBonus = (id: string, amt: number, forceFire: boolean) => {
      if (forceFire) forcedHeavyFireIds.add(id);
      heavyOverloadPierceIds.add(id);
      heavyOverloadBonusById.set(id, (heavyOverloadBonusById.get(id) ?? 0) + amt);
    };
    const addSalvoExtra = (id: string, count: number, dmgBonus: number) => {
      const prev = salvoExtraMissilesById.get(id);
      salvoExtraMissilesById.set(id, {
        count: (prev?.count ?? 0) + count,
        dmgBonus: Math.max(prev?.dmgBonus ?? 0, dmgBonus),
      });
    };
    const addHangarExtra = (id: string, count: number, dmgBonus: number) => {
      const prev = hangarExtraDronesById.get(id);
      hangarExtraDronesById.set(id, {
        count: (prev?.count ?? 0) + count,
        dmgBonus: Math.max(prev?.dmgBonus ?? 0, dmgBonus),
      });
    };

    for (const iv of roundInterventions) {
      if (iv.kind !== 'overload_module' || !iv.moduleInstanceId) continue;
      const placedMod = params.bay.placed.find((p) => p.item.instanceId === iv.moduleInstanceId);
      if (!placedMod) continue;
      const eqDef = V2_EQUIPMENT_DEFS[placedMod.item.definitionId];
      if (!eqDef) continue;
      if (iv.moduleKind && iv.moduleKind !== eqDef.kind) continue;

      const resolvedIv: V2CombatIntervention = {
        ...iv,
        moduleKind: eqDef.kind,
      };
      appliedInterventionsThisRound.push(resolvedIv);
      appliedInterventionsList.push(resolvedIv);

      const modId = placedMod.item.instanceId;
      switch (eqDef.kind) {
        case 'laser': {
          const lStat = stats.lasers.find((l) => l.instanceId === modId);
          const burstBase = lStat?.totalDamage ?? (eqDef.quality === 'improved' ? 4 : 3);
          addLaserBonus(modId, 2);
          laserExtraBursts.push({ instanceId: `${modId}_ov`, rawDamage: burstBase + 4 });
          break;
        }
        case 'heavy': {
          const hStat = stats.heavies.find((h) => h.instanceId === modId);
          const effHeavyRoundPreview = heavyStallApplied && round >= 2 ? round - 1 : round;
          const naturallyFires = hStat
            ? hStat.firesOnOddRounds
              ? effHeavyRoundPreview % 2 === 1
              : effHeavyRoundPreview % 2 === 0
            : false;
          if (naturallyFires) {
            addHeavyBonus(modId, 8, true);
          } else {
            addHeavyBonus(modId, 4, true);
          }
          break;
        }
        case 'shield': {
          const gain = (eqDef.quality === 'improved' ? 10 : 8) + (stats.bestActiveCounter ? 2 : 0);
          playerShield = Math.min(V2_MAX_BATTLE_SHIELD, playerShield + gain);
          pierceMitigationFactor = Math.min(pierceMitigationFactor, 0.5);
          if (stats.bestActiveCounter) {
            counterBonusThisRound += 2;
          }
          break;
        }
        case 'repair': {
          const healAmt = eqDef.quality === 'improved' ? 9 : 7;
          playerHp = Math.min(params.maxHp, playerHp + healAmt);
          playerShield = Math.min(V2_MAX_BATTLE_SHIELD, playerShield + 3);
          break;
        }
        case 'battery': {
          // Boost ALL orthogonally adjacent equipment modules together for this round!
          const adjModules = findOrthogonallyAdjacentPlacedEquipment(params.bay, placedMod);
          const batQualityBonus = eqDef.quality === 'improved' ? 3 : 2;
          if (adjModules.length === 0) {
            playerShield = Math.min(V2_MAX_BATTLE_SHIELD, playerShield + 2);
            tacticStrikes.push({
              sourceKind: 'core',
              sourceInstanceId: `${modId}_ov_arc`,
              rawDamage: 6,
              ignoreArmor: true,
              isOverload: true,
            });
          } else {
            const effHeavyRoundPreview = heavyStallApplied && round >= 2 ? round - 1 : round;
            for (const adj of adjModules) {
              const adjId = adj.placed.item.instanceId;
              switch (adj.kind) {
                case 'laser': {
                  const lStat = stats.lasers.find((l) => l.instanceId === adjId);
                  const baseDmg = lStat?.totalDamage ?? (adj.quality === 'improved' ? 4 : 3);
                  addLaserBonus(adjId, batQualityBonus + 2);
                  laserExtraBursts.push({
                    instanceId: `${adjId}_bat_ov`,
                    rawDamage: baseDmg + batQualityBonus,
                  });
                  break;
                }
                case 'heavy': {
                  const hStat = stats.heavies.find((h) => h.instanceId === adjId);
                  const naturallyFires = hStat
                    ? hStat.firesOnOddRounds
                      ? effHeavyRoundPreview % 2 === 1
                      : effHeavyRoundPreview % 2 === 0
                    : false;
                  addHeavyBonus(adjId, naturallyFires ? 6 + batQualityBonus - 2 : 3 + batQualityBonus - 2, true);
                  break;
                }
                case 'salvo_pod': {
                  addSalvoExtra(adjId, 2, 1);
                  break;
                }
                case 'hangar': {
                  addHangarExtra(adjId, 2, 1);
                  break;
                }
                case 'flak': {
                  const fStat = stats.flaks.find((f) => f.instanceId === adjId);
                  flakExtraVolleys.push({
                    instanceId: `${adjId}_bat_ov`,
                    rawDamage: (fStat?.damagePerEnemy ?? 2) + batQualityBonus,
                    ignoreArmor: true,
                  });
                  break;
                }
                case 'shield':
                case 'counter':
                case 'coolant_vent': {
                  playerShield = Math.min(V2_MAX_BATTLE_SHIELD, playerShield + 5);
                  pierceMitigationFactor = Math.min(pierceMitigationFactor, 0.5);
                  if (adj.kind === 'counter') counterBonusThisRound += 2;
                  break;
                }
                case 'repair': {
                  playerHp = Math.min(params.maxHp, playerHp + 4);
                  break;
                }
                case 'emp_jammer': {
                  const eStat = stats.empJammers.find((e) => e.instanceId === adjId);
                  empExtraBursts.push({
                    instanceId: `${adjId}_bat_ov`,
                    rawDamage: (eStat?.damage ?? 2) + 3,
                    shieldShred: 3,
                  });
                  break;
                }
                case 'salvage_grapple': {
                  const gStat = stats.salvageGrapples.find((g) => g.instanceId === adjId);
                  grappleExtraBursts.push({
                    instanceId: `${adjId}_bat_ov`,
                    rawDamage: (gStat?.damage ?? 2) + 3,
                  });
                  break;
                }
                default: {
                  directWeaponDmgBonus += 2;
                  break;
                }
              }
            }
          }
          break;
        }
        case 'salvo_pod': {
          addSalvoExtra(modId, 3, 1);
          break;
        }
        case 'hangar': {
          addHangarExtra(modId, 3, 1);
          break;
        }
        case 'flak': {
          const fStat = stats.flaks.find((f) => f.instanceId === modId);
          flakExtraVolleys.push({
            instanceId: `${modId}_ov`,
            rawDamage: (fStat?.damagePerEnemy ?? (eqDef.quality === 'improved' ? 3 : 2)) + 3,
            ignoreArmor: true,
          });
          break;
        }
        case 'emp_jammer': {
          const eStat = stats.empJammers.find((e) => e.instanceId === modId);
          empImmuneThisRound = true;
          overloadEnemyWeakenExtra += 2;
          empExtraBursts.push({
            instanceId: `${modId}_ov`,
            rawDamage: (eStat?.damage ?? 2) + 4,
            shieldShred: 8,
          });
          break;
        }
        case 'counter': {
          playerShield = Math.min(V2_MAX_BATTLE_SHIELD, playerShield + 5);
          counterBonusThisRound += 4;
          break;
        }
        case 'coolant_vent': {
          playerShield = Math.min(V2_MAX_BATTLE_SHIELD, playerShield + 6);
          pierceMitigationFactor = Math.min(pierceMitigationFactor, 0.5);
          coolantOverloadHeavySalvoBonus += 3;
          break;
        }
        case 'overdrive_core': {
          ignoreArmorDirectThisRound = true;
          directWeaponDmgBonus += 3;
          tacticStrikes.push({
            sourceKind: 'core',
            sourceInstanceId: `${modId}_ov`,
            rawDamage: 5,
            ignoreArmor: true,
            isOverload: true,
          });
          break;
        }
        case 'capacitor': {
          if (stats.heavies.length > 0) {
            for (const h of stats.heavies) {
              addHeavyBonus(h.instanceId, 5, true);
            }
          } else {
            tacticStrikes.push({
              sourceKind: 'core',
              sourceInstanceId: `${modId}_ov`,
              rawDamage: 5,
              ignoreArmor: true,
              isOverload: true,
            });
          }
          break;
        }
        case 'relay': {
          let boostedAny = false;
          for (const hg of stats.hangars) {
            addHangarExtra(hg.instanceId, 2, 1);
            boostedAny = true;
          }
          for (const sv of stats.salvos) {
            addSalvoExtra(sv.instanceId, 2, 0);
            boostedAny = true;
          }
          if (!boostedAny) {
            tacticStrikes.push({
              sourceKind: 'core',
              sourceInstanceId: `${modId}_ov`,
              rawDamage: 6,
              ignoreArmor: true,
              isOverload: true,
            });
          }
          break;
        }
        case 'cargo_amp': {
          const caStat = stats.cargoAmps.find((c) => c.instanceId === modId);
          playerShield = Math.min(V2_MAX_BATTLE_SHIELD, playerShield + 4);
          tacticStrikes.push({
            sourceKind: 'core',
            sourceInstanceId: `${modId}_ov`,
            rawDamage: 5 + (caStat?.adjacentCargoCount ?? 0) * 2,
            ignoreArmor: true,
            isOverload: true,
          });
          break;
        }
        case 'salvage_grapple': {
          const gStat = stats.salvageGrapples.find((g) => g.instanceId === modId);
          playerShield = Math.min(V2_MAX_BATTLE_SHIELD, playerShield + 3);
          grappleExtraBursts.push({
            instanceId: `${modId}_ov`,
            rawDamage: (gStat?.damage ?? 2) + 6,
          });
          break;
        }
      }
    }

    // Power diversion during legacy Emergency Defense stalls heavy railgun charge by 1 cycle
    const effectiveHeavyRound = heavyStallApplied && round >= 2 ? round - 1 : round;

    const droneCountsByHangar: Record<string, number> = {};
    for (const hg of stats.hangars) {
      const extraDrones = hangarExtraDronesById.get(hg.instanceId)?.count ?? 0;
      const count = Math.min(hg.maxDrones, round + hg.roundOneBonusDrones) + extraDrones;
      droneCountsByHangar[hg.instanceId] = count;
    }

    const heavyChargingIds: string[] = [];
    for (const h of stats.heavies) {
      const fires =
        forcedHeavyFireIds.has(h.instanceId) ||
        (h.firesOnOddRounds ? effectiveHeavyRound % 2 === 1 : effectiveHeavyRound % 2 === 0);
      if (!fires || suppressDirectWeaponsThisRound) heavyChargingIds.push(h.instanceId);
    }

    // Step 2 & 3: Select single-target primary from start-of-round snapshot (honors lockedEnemyId with auto-fallback!)
    const primaryTarget = selectTarget(startLiving, params.targetPolicy, activeLockedEnemyId)!;
    const lockedEnemyIdUsed =
      activeLockedEnemyId && startLiving.some((u) => u.enemyId === activeLockedEnemyId)
        ? activeLockedEnemyId
        : null;
    const playerAttacks: V2PlayerAttackEvent[] = [];

    // Overcharge Cell consumable gadget: Round 1 +6 armor-piercing burst!
    if (round === 1 && params.overchargeCellActive) {
      tacticStrikes.push({
        sourceInstanceId: 'gadget_overcharge_cell',
        rawDamage: 6,
        ignoreArmor: true,
      });
    }

    // Deterministic first-direct-attack bonuses (Navigator Mastery T2 on R1; Stargate Relay T2+ on R1; Sector 3 gravity_tide on even rounds)
    const isGravitySurgeRound = envModifierId === 'gravity_tide' && round % 2 === 0;
    const relayR1Bonus = round === 1 ? (relayTier >= 3 ? 2 : relayTier >= 2 ? 1 : 0) : 0;
    let pendingFirstHitBonus =
      (round === 1 && params.crewId === 'navigator' && masteryTier >= 2 ? 2 : 0) +
      relayR1Bonus +
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

    // 2a-bis. Tactical command / hull signature / module-overload core strikes
    for (const strike of tacticStrikes) {
      const sKind = strike.sourceKind ?? 'core';
      if (strike.aoe) {
        const livingSorted = enemies
          .filter((u) => u.hp > 0)
          .sort((a, b) => a.enemyId.localeCompare(b.enemyId));
        const targets = livingSorted.length > 0 ? livingSorted : [primaryTarget];
        for (const t of targets) {
          playerAttacks.push(
            applyHitToUnit(
              t,
              sKind,
              strike.sourceInstanceId,
              strike.rawDamage,
              strike.ignoreArmor,
              Boolean(strike.isOverload)
            )
          );
        }
      } else {
        const target = selectTarget(enemies, params.targetPolicy, activeLockedEnemyId) ?? primaryTarget;
        playerAttacks.push(
          applyHitToUnit(
            target,
            sKind,
            strike.sourceInstanceId,
            strike.rawDamage,
            strike.ignoreArmor,
            Boolean(strike.isOverload)
          )
        );
      }
    }

    if (!suppressDirectWeaponsThisRound) {
      // 2b. Lasers (sorted by instanceId)
      for (const l of stats.lasers) {
        const ovBonus = laserDmgBonusById.get(l.instanceId) ?? 0;
        playerAttacks.push(
          applyHitToUnit(
            primaryTarget,
            'laser',
            l.instanceId,
            l.totalDamage + ovBonus + directWeaponDmgBonus + consumeFirstHitBonus(),
            ignoreArmorDirectThisRound,
            ovBonus > 0
          )
        );
      }
      for (const lb of laserExtraBursts) {
        const burstTarget = selectTarget(enemies, params.targetPolicy, activeLockedEnemyId) ?? primaryTarget;
        playerAttacks.push(
          applyHitToUnit(
            burstTarget,
            'laser',
            lb.instanceId,
            lb.rawDamage + directWeaponDmgBonus,
            ignoreArmorDirectThisRound,
            true
          )
        );
      }

      // 2c. Heavy cannons firing this round (sorted by instanceId)
      for (const h of stats.heavies) {
        const isForced = forcedHeavyFireIds.has(h.instanceId);
        const fires =
          isForced ||
          (h.firesOnOddRounds ? effectiveHeavyRound % 2 === 1 : effectiveHeavyRound % 2 === 0);
        if (fires) {
          const bonus = round === 1 ? h.firstShotBonus : 0;
          const ovBonus = heavyOverloadBonusById.get(h.instanceId) ?? 0;
          const isHeavyOv = isForced || ovBonus > 0;
          const heavyTarget = isHeavyOv
            ? selectTarget(enemies, params.targetPolicy, activeLockedEnemyId) ?? primaryTarget
            : primaryTarget;
          playerAttacks.push(
            applyHitToUnit(
              heavyTarget,
              'heavy',
              h.instanceId,
              h.baseDamage +
                bonus +
                ovBonus +
                coolantOverloadHeavySalvoBonus +
                directWeaponDmgBonus +
                consumeFirstHitBonus(),
              ignoreArmorDirectThisRound || heavyOverloadPierceIds.has(h.instanceId),
              isHeavyOv
            )
          );
        }
      }

      // 2d. Hangar drones: each active drone acquires a living enemy independently
      for (const hg of stats.hangars) {
        const baseDrones = Math.min(hg.maxDrones, round + hg.roundOneBonusDrones);
        const extraSpec = hangarExtraDronesById.get(hg.instanceId);
        const totalDrones = baseDrones + (extraSpec?.count ?? 0);
        for (let d = 0; d < totalDrones; d++) {
          const isOvDrone = d >= baseDrones;
          const droneTarget = selectTarget(enemies, params.targetPolicy, activeLockedEnemyId) ?? primaryTarget;
          playerAttacks.push(
            applyHitToUnit(
              droneTarget,
              'hangar',
              `${hg.instanceId}_d${d + 1}`,
              hg.damagePerDrone + (isOvDrone ? extraSpec?.dmgBonus ?? 0 : 0) + consumeFirstHitBonus(),
              ignoreArmorDirectThisRound,
              isOvDrone
            )
          );
        }
      }

      // 2d-bis. Salvo Pods: multi-missile volley with independent retargeting on kill
      for (const sv of stats.salvos) {
        const extraSpec = salvoExtraMissilesById.get(sv.instanceId);
        const totalMissiles = sv.missiles + (extraSpec?.count ?? 0);
        for (let m = 0; m < totalMissiles; m++) {
          const isOvMissile = m >= sv.missiles;
          const salvoTarget = selectTarget(enemies, params.targetPolicy, activeLockedEnemyId) ?? primaryTarget;
          const coolantExtra = m === 0 ? sv.coolantBonus + coolantOverloadHeavySalvoBonus : 0;
          playerAttacks.push(
            applyHitToUnit(
              salvoTarget,
              'salvo',
              `${sv.instanceId}_m${m + 1}`,
              sv.damagePerMissile +
                (isOvMissile ? extraSpec?.dmgBonus ?? 0 : 0) +
                coolantExtra +
                directWeaponDmgBonus +
                consumeFirstHitBonus(),
              ignoreArmorDirectThisRound,
              isOvMissile
            )
          );
        }
      }

      // 2d-ter. EMP Jammers: strip enemy shield before dealing direct EMP pulse damage
      for (const ej of stats.empJammers) {
        const empTarget = selectTarget(enemies, params.targetPolicy, activeLockedEnemyId) ?? primaryTarget;
        const preShred = Math.min(empTarget.shield, ej.shieldShred);
        if (preShred > 0) {
          empTarget.shield -= preShred;
        }
        const hit = applyHitToUnit(
          empTarget,
          'emp',
          ej.instanceId,
          ej.damage + directWeaponDmgBonus + consumeFirstHitBonus(),
          ignoreArmorDirectThisRound
        );
        playerAttacks.push(
          preShred > 0
            ? {
                ...hit,
                appliedDamage: hit.appliedDamage + preShred,
                shieldDamaged: (hit.shieldDamaged ?? 0) + preShred,
              }
            : hit
        );
      }
      for (const eb of empExtraBursts) {
        const empTarget = selectTarget(enemies, params.targetPolicy, activeLockedEnemyId) ?? primaryTarget;
        const preShred = Math.min(empTarget.shield, eb.shieldShred);
        if (preShred > 0) empTarget.shield -= preShred;
        const hit = applyHitToUnit(empTarget, 'emp', eb.instanceId, eb.rawDamage, true, true);
        playerAttacks.push(
          preShred > 0
            ? {
                ...hit,
                appliedDamage: hit.appliedDamage + preShred,
                shieldDamaged: (hit.shieldDamaged ?? 0) + preShred,
              }
            : hit
        );
      }

      // 2d-quater. Salvage Grapples: magnetic clamp strike
      for (const gr of stats.salvageGrapples) {
        const grappleTarget = selectTarget(enemies, params.targetPolicy, activeLockedEnemyId) ?? primaryTarget;
        playerAttacks.push(
          applyHitToUnit(
            grappleTarget,
            'grapple',
            gr.instanceId,
            gr.damage + directWeaponDmgBonus + consumeFirstHitBonus(),
            ignoreArmorDirectThisRound
          )
        );
      }
      for (const gb of grappleExtraBursts) {
        const grappleTarget = selectTarget(enemies, params.targetPolicy, activeLockedEnemyId) ?? primaryTarget;
        playerAttacks.push(
          applyHitToUnit(grappleTarget, 'grapple', gb.instanceId, gb.rawDamage, true, true)
        );
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
      for (const fv of flakExtraVolleys) {
        const livingForOvFlak = enemies
          .filter((u) => u.hp > 0)
          .sort((a, b) => a.enemyId.localeCompare(b.enemyId));
        const targets = livingForOvFlak.length > 0 ? livingForOvFlak : startLivingSortedForFlak;
        for (const target of targets) {
          playerAttacks.push(
            applyHitToUnit(target, 'flak', fv.instanceId, fv.rawDamage, fv.ignoreArmor, true)
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
      enemyPierceBonus: mutatorEffects.enemyPierceBonus,
    });

    // Step 4: Simultaneous enemy actions from startLiving using telegraphed round intents
    const startLivingSorted = [...startLiving].sort((a, b) => a.enemyId.localeCompare(b.enemyId));
    const enemyAttacks: V2EnemyAttackEvent[] = [];
    const enemyIntentsThisRound: { readonly enemyId: string; readonly intent: V3EnemyIntent }[] = [];
    let shieldAbsorbedTotal = 0;
    const gravityEnemyDmgBonus = isGravitySurgeRound ? 1 : 0;
    let empWeakenApplied = false;
    const empWeakenActiveThisRound =
      stats.enemyWeakenAmount > 0 && (stats.enemyWeakenEveryRound || round % 2 === 1);

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
      const basePierce = Math.max(0, Math.min(1, intent.pierceRatio ?? enemy.pierceRatio));
      const mutatorPierce = applyEnemyPierceBonus(basePierce, mutatorEffects.enemyPierceBonus);
      const loggedIntent: V3EnemyIntent =
        intent.damage > 0 && mutatorEffects.enemyPierceBonus > 0
          ? { ...intent, pierceRatio: mutatorPierce }
          : intent;
      enemyIntentsThisRound.push({ enemyId: enemy.enemyId, intent: loggedIntent });

      let rawDamage = 0;
      let pierceDamage = 0;
      let shieldAbsorbed = 0;
      let hullDamage = 0;
      let empShieldDrained = 0;

      // Gravity tide (+1) and Endless mutator enemyDamageBonus apply ONLY when enemy fires an attack (intent.damage > 0)
      if (intent.damage > 0) {
        rawDamage = intent.damage + gravityEnemyDmgBonus + mutatorEffects.enemyDamageBonus;
        if (empWeakenActiveThisRound && !empWeakenApplied) {
          rawDamage = Math.max(1, rawDamage - stats.enemyWeakenAmount);
          empWeakenApplied = true;
        }
        if (overloadEnemyWeakenExtra > 0) {
          rawDamage = Math.max(1, rawDamage - overloadEnemyWeakenExtra);
        }
        const effectivePierceRatio = mutatorPierce * pierceMitigationFactor;
        pierceDamage = effectivePierceRatio > 0 ? Math.floor(rawDamage * effectivePierceRatio) : 0;
        const normalDamage = rawDamage - pierceDamage;
        shieldAbsorbed = Math.min(playerShield, normalDamage);
        playerShield -= shieldAbsorbed;
        shieldAbsorbedTotal += shieldAbsorbed;
        hullDamage = pierceDamage + (normalDamage - shieldAbsorbed);
        playerHp = Math.max(0, playerHp - hullDamage);
      }

      // EMP Shield Disruptor effect (dampened by emp_jammer empDrainReduction)
      if (intent.empShieldDrain && intent.empShieldDrain > 0) {
        const netEmpDrain = Math.max(0, intent.empShieldDrain - stats.empDrainReduction);
        if (empImmuneThisRound) {
          enemySpecialNotes.push('舱壁防护：已抵御 EMP 护盾干扰');
        } else if (netEmpDrain <= 0) {
          enemySpecialNotes.push('EMP 干扰器：已完全抵消敌方护盾干扰');
        } else if (playerShield > 0) {
          empShieldDrained = Math.min(playerShield, netEmpDrain);
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

      // Self-buffs, ally shield projection & summons only execute if the unit survived player fire
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

      if (enemy.hp > 0 && intent.allyShieldGain && intent.allyShieldGain > 0) {
        const livingAllies = enemies
          .filter((e) => e.hp > 0 && e.enemyId !== enemy.enemyId)
          .sort((a, b) => {
            if (b.damagePerRound !== a.damagePerRound) return b.damagePerRound - a.damagePerRound;
            if (b.maxHp !== a.maxHp) return b.maxHp - a.maxHp;
            return a.enemyId.localeCompare(b.enemyId);
          });
        const recipient = livingAllies[0] ?? enemy;
        const cap = Math.max(recipient.maxShield, intent.allyShieldGain, 8);
        recipient.maxShield = cap;
        const before = recipient.shield;
        recipient.shield = Math.min(cap, recipient.shield + intent.allyShieldGain);
        const gained = recipient.shield - before;
        if (gained > 0) {
          enemySpecialNotes.push(`${enemy.name} 为 ${recipient.name} 投影护盾 +${gained}`);
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
          const snap = snapshotUnits(
            [drone],
            round + 1,
            bossDef,
            params.encounterKind,
            resolvedBossId,
            mutatorEffects.enemyPierceBonus
          )[0];
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
        const counterTarget = selectTarget(postMainLiving, params.targetPolicy, activeLockedEnemyId);
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
            enemyPierceBonus: mutatorEffects.enemyPierceBonus,
          });
        }
      }
    }

    // Step 5b: End-of-round deterministic sector environmental effect + Endless mutator drain + Coolant Vent regen
    const envNotes: string[] = [];
    if (envModifierId === 'cryo_ion') {
      if (round % 2 === 0) {
        const netCryoDrain = Math.max(0, 2 - stats.cryoDrainReduction);
        if (netCryoDrain === 0) {
          envNotes.push('低温电离脉冲：冷却排热阀抵消余盾衰减');
        } else if (playerShield > 0) {
          const drained = Math.min(playerShield, netCryoDrain);
          playerShield -= drained;
          envNotes.push(`低温电离脉冲：余盾衰减 -${drained}`);
        } else {
          envNotes.push('低温电离脉冲：无余盾，船体未受损');
        }
      } else if (round === 1 && cryoOpeningSuppressed) {
        envNotes.push(`低温电离场：开战护盾压制 -${Math.min(preEnvShield, cryoOpenDrain)}`);
      }
    } else if (isGravitySurgeRound) {
      envNotes.push('引力潮汐高潮：我方首击 +2 / 敌舰齐射各 +1');
    }

    if (round === 1 && mutatorOpeningSuppressed) {
      envNotes.push(`深渊电离过载：开战护盾 -${mutatorOpenDrain}`);
    }
    if (round % 2 === 0 && mutatorEffects.evenRoundShieldDrain > 0) {
      if (playerShield > 0) {
        const drained = Math.min(playerShield, mutatorEffects.evenRoundShieldDrain);
        playerShield -= drained;
        envNotes.push(`深渊电离过载：偶数轮余盾 -${drained}`);
      }
    }
    const envModifierEvent = envNotes.length > 0 ? envNotes.join(' · ') : undefined;

    if (playerHp > 0 && enemies.some((u) => u.hp > 0) && stats.endOfRoundShieldRegen > 0) {
      playerShield = Math.min(V2_MAX_BATTLE_SHIELD, playerShield + stats.endOfRoundShieldRegen);
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
      enemiesAfter: snapshotUnits(
        enemies,
        round + 1,
        bossDef,
        params.encounterKind,
        resolvedBossId,
        mutatorEffects.enemyPierceBonus
      ),
      ...(envModifierEvent ? { envModifierEvent } : {}),
      ...(roundCmd ? { appliedTacticThisRound: roundCmd } : {}),
      ...(enemyIntentsThisRound.length > 0 ? { enemyIntentsThisRound } : {}),
      ...(bossPhaseTransitions.length > 0 ? { bossPhaseTransitions } : {}),
      ...(summonedEnemies.length > 0 ? { summonedEnemies } : {}),
      ...(enemySpecialNotes.length > 0 ? { enemySpecialNotes } : {}),
      ...(appliedInterventionsThisRound.length > 0 ? { appliedInterventionsThisRound } : {}),
      ...(lockedEnemyIdUsed ? { lockedEnemyIdUsed } : {}),
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
    ...(params.overchargeCellActive ? { overchargeApplied: true } : {}),
    ...(relayTier > 0 ? { stargateRelayTier: relayTier } : {}),
    ...(endlessThreat > 0 ? { endlessThreat } : {}),
    ...(mutatorEffects.activeIds.length > 0 ? { endlessMutatorIds: mutatorEffects.activeIds } : {}),
    ...(params.lockedEnemyId !== undefined ? { lockedEnemyId: params.lockedEnemyId } : {}),
    ...(appliedInterventionsList.length > 0 ? { appliedInterventions: appliedInterventionsList } : {}),
  };
}

/**
 * Previews an upcoming combat node using the exact same deterministic engine.
 * S06 guarantee: always runs un-intervened baseline (`interventions: []`).
 * Node-isolation guard: inherits `run.lockedEnemyId` ONLY for `run.currentNodeId` unless explicitly overridden.
 */
export function previewV2CombatNode(
  run: V2RunState,
  nodeId: string,
  policyOverride?: V2TargetPolicy,
  options?: { readonly stargateRelayTier?: number; readonly lockedEnemyId?: string | null }
): V2CombatSimulation | null {
  const node = run.graph.nodes[nodeId];
  if (!node || !node.combat) return null;
  const isCurrentNode = run.currentNodeId === nodeId;
  const effectiveLock =
    options?.lockedEnemyId !== undefined
      ? options.lockedEnemyId
      : isCurrentNode
      ? run.lockedEnemyId ?? null
      : null;
  const validLock =
    effectiveLock && node.combat.units.some((u) => u.enemyId === effectiveLock)
      ? effectiveLock
      : null;
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
    overchargeCellActive: isCurrentNode ? Boolean(run.overchargeCellActive) : false,
    stargateRelayTier: options?.stargateRelayTier ?? 0,
    endlessThreat: run.endlessThreat,
    endlessMutatorIds: run.endlessMutatorIds,
    lockedEnemyId: validLock,
    interventions: [],
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
  readonly priorInterventions?: readonly V2CombatIntervention[];
  readonly openingLockedEnemyId?: string | null;
  readonly chargeIndex: number;
  readonly chargesMax: number;
  readonly stargateRelayTier?: number;
}): V2EliteTacticDecision | null {
  const {
    run,
    node,
    targetPolicy,
    startingHp,
    baselineSim,
    pauseRound,
    priorCommands,
    priorInterventions = [],
    openingLockedEnemyId = null,
    chargeIndex,
    chargesMax,
    stargateRelayTier,
  } = params;
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
      interventions: priorInterventions,
      lockedEnemyId: openingLockedEnemyId,
      sectorId: run.sectorId,
      crewId: run.crewId,
      crewMasteryTier: run.crewMasteryTier ?? 0,
      encounterKind: node.combat!.encounterKind,
      bossId,
      overchargeCellActive: Boolean(run.overchargeCellActive || baselineSim.overchargeApplied),
      stargateRelayTier: stargateRelayTier ?? baselineSim.stargateRelayTier ?? 0,
      endlessThreat: run.endlessThreat ?? baselineSim.endlessThreat,
      endlessMutatorIds: run.endlessMutatorIds ?? baselineSim.endlessMutatorIds,
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
  const mutatorEffects = aggregateEndlessMutatorEffects(
    run.endlessMutatorIds ?? baselineSim.endlessMutatorIds
  );
  const enemyThreatDamage = pauseRoundLog
    ? pauseRoundLog.enemyAttacks.reduce((sum, a) => sum + a.rawDamage, 0)
    : aliveEnemies.reduce((sum, e) => {
        const dmg = e.nextIntent ? e.nextIntent.damage : e.damagePerRound;
        return sum + (dmg > 0 ? dmg + (isGravitySurge ? 1 : 0) + mutatorEffects.enemyDamageBonus : 0);
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
  run: Pick<V2RunState, 'crewId' | 'crewMasteryTier' | 'endlessMutatorIds'>,
  baseBounty: number
): number {
  const afterCrew =
    run.crewId === 'salvager' && (run.crewMasteryTier ?? 0) >= 2
      ? Math.ceil(baseBounty * 1.2)
      : baseBounty;
  const mutatorBonus = aggregateEndlessMutatorEffects(run.endlessMutatorIds).bountyMultBonus;
  return mutatorBonus > 0 ? Math.round(afterCrew * (1 + mutatorBonus)) : afterCrew;
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
  if (run.activeCombat && run.activeCombat.nodeId !== node.nodeId) {
    return { ok: false, run, error: '存在未结算的战斗状态' };
  }
  if (run.claimedEventIds.includes(`combat_done_${node.nodeId}`)) {
    return { ok: false, run, error: '该场战斗已结算' };
  }

  const targetPolicy = policyOverride ?? run.targetPolicy;
  const bossId = resolveNodeBossId(node, run);
  const tacticalChargesMax = computeCombatTacticalChargesMax(node, run, options?.bonusBossCharges ?? 0);
  const tacticalChargesUsed = 0;
  const openingLockedEnemyId =
    run.lockedEnemyId && node.combat.units.some((u) => u.enemyId === run.lockedEnemyId)
      ? run.lockedEnemyId
      : null;

  const simulation = simulateV2Combat({
    resultId: `cmb_${run.runId}_${node.nodeId}`,
    bay: run.bay,
    startingHp: run.hp,
    maxHp: run.maxHp,
    units: node.combat.units,
    targetPolicy,
    lockedEnemyId: openingLockedEnemyId,
    interventions: [],
    sectorId: run.sectorId,
    crewId: run.crewId,
    crewMasteryTier: run.crewMasteryTier ?? 0,
    encounterKind: node.combat.encounterKind,
    bossId,
    overchargeCellActive: Boolean(run.overchargeCellActive),
    stargateRelayTier: options?.stargateRelayTier ?? 0,
    endlessThreat: run.endlessThreat,
    endlessMutatorIds: run.endlessMutatorIds,
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
          priorInterventions: [],
          openingLockedEnemyId,
          chargeIndex: 1,
          chargesMax: tacticalChargesMax,
          stargateRelayTier: options?.stargateRelayTier ?? 0,
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
    lockedEnemyId: openingLockedEnemyId,
    interventions: [],
  };

  return {
    ok: true,
    run: {
      ...run,
      targetPolicy,
      lockedEnemyId: openingLockedEnemyId,
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
  choice: V2EliteTacticChoice,
  options?: { readonly stargateRelayTier?: number }
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
  const prevInterventions = run.activeCombat.interventions ?? [];
  const nextInterventions: readonly V2CombatIntervention[] = consumesCharge
    ? [
        ...prevInterventions,
        {
          interventionId: decisionId,
          roundNumber: pending.roundNumber,
          kind: 'tactical_command',
          commandId: choice,
        },
      ]
    : [...prevInterventions];
  const nextChargesUsed = consumesCharge
    ? Math.min(run.tacticalChargesMax, run.tacticalChargesUsed + 1)
    : run.tacticalChargesUsed;

  const bossId = resolveNodeBossId(node, run);
  const relayTier = options?.stargateRelayTier ?? run.activeCombat.simulation.stargateRelayTier ?? 0;
  const openingLockedEnemyId = run.activeCombat.lockedEnemyId ?? null;
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
    lockedEnemyId: openingLockedEnemyId,
    tacticalCommands:
      scheduledCommands.length > 0
        ? scheduledCommands
        : [{ roundNumber: pending.roundNumber, choice }],
    interventions: nextInterventions,
    sectorId: run.sectorId,
    crewId: run.crewId,
    crewMasteryTier: run.crewMasteryTier ?? 0,
    encounterKind: node.combat.encounterKind,
    bossId,
    overchargeCellActive: Boolean(
      run.overchargeCellActive || run.activeCombat.simulation.overchargeApplied
    ),
    stargateRelayTier: relayTier,
    endlessThreat: run.endlessThreat ?? run.activeCombat.simulation.endlessThreat,
    endlessMutatorIds: run.endlessMutatorIds ?? run.activeCombat.simulation.endlessMutatorIds,
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
        priorInterventions: nextInterventions,
        openingLockedEnemyId,
        chargeIndex: nextChargesUsed + 1,
        chargesMax: run.tacticalChargesMax,
        stargateRelayTier: relayTier,
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
        interventions: nextInterventions,
        resumeFromRound: Math.max(0, pending.roundNumber - 1),
        pausedAtDecisionId: null,
      },
      claimedEventIds: [...run.claimedEventIds, claimKey],
    },
  };
}

/**
 * Pure preview for overloading a specific mounted module during an active pause decision window.
 */
export function previewV2ModuleOverload(
  run: V2RunState,
  decisionId: string,
  moduleInstanceId: string,
  options?: { readonly stargateRelayTier?: number }
): V2CombatSimulation | null {
  if (run.phase !== 'ENCOUNTER' || !run.activeCombat || !run.currentNodeId) return null;
  const pending = run.activeCombat.pendingDecision;
  if (!pending || pending.decisionId !== decisionId || pending.chosen !== null) return null;
  const node = run.graph.nodes[run.currentNodeId];
  if (!node || !node.combat) return null;
  const placed = run.bay.placed.find((p) => p.item.instanceId === moduleInstanceId);
  if (!placed) return null;
  const eqDef = V2_EQUIPMENT_DEFS[placed.item.definitionId];
  if (!eqDef) return null;

  const bossId = resolveNodeBossId(node, run);
  const relayTier = options?.stargateRelayTier ?? run.activeCombat.simulation.stargateRelayTier ?? 0;
  const prevCommitted = run.activeCombat.committedCommands ?? [];
  const prevInterventions = run.activeCombat.interventions ?? [];
  const nextInterventions: readonly V2CombatIntervention[] = [
    ...prevInterventions,
    {
      interventionId: decisionId,
      roundNumber: pending.roundNumber,
      kind: 'overload_module',
      moduleInstanceId,
      moduleKind: eqDef.kind,
    },
  ];
  return simulateV2Combat({
    resultId: `prev_ov_${moduleInstanceId}_${run.runId}_${node.nodeId}_r${pending.roundNumber}`,
    bay: run.bay,
    startingHp: run.activeCombat.startingHp,
    maxHp: run.maxHp,
    units: node.combat.units,
    targetPolicy: run.activeCombat.targetPolicy,
    lockedEnemyId: run.activeCombat.lockedEnemyId ?? null,
    tacticalCommands: prevCommitted.map((c) => ({ roundNumber: c.roundNumber, choice: c.choice })),
    interventions: nextInterventions,
    sectorId: run.sectorId,
    crewId: run.crewId,
    crewMasteryTier: run.crewMasteryTier ?? 0,
    encounterKind: node.combat.encounterKind,
    bossId,
    overchargeCellActive: Boolean(
      run.overchargeCellActive || run.activeCombat.simulation.overchargeApplied
    ),
    stargateRelayTier: relayTier,
    endlessThreat: run.endlessThreat ?? run.activeCombat.simulation.endlessThreat,
    endlessMutatorIds: run.endlessMutatorIds ?? run.activeCombat.simulation.endlessMutatorIds,
  });
}

/**
 * D01: Commits a per-module component overload during a tactical decision window.
 * - Shares charge pool & idempotency claim key (`tactic_commit_${decisionId}`) with Active Tactical Commands.
 * - NEVER writes `'overload_module'` into `pendingDecision.chosen`; instead advances `pendingDecision` to `nextChained ?? null`.
 * - Persists the intervention in `activeCombat.interventions` for bit-for-bit reload replay.
 */
export function commitV2ModuleOverload(
  run: V2RunState,
  decisionId: string,
  moduleInstanceId: string,
  options?: { readonly stargateRelayTier?: number }
): {
  readonly ok: boolean;
  readonly run: V2RunState;
  readonly moduleKind?: V2EquipmentKind;
  readonly error?: string;
} {
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
  if (run.tacticalChargesUsed >= run.tacticalChargesMax) {
    return { ok: false, run, error: '本场战斗指令充能已耗尽' };
  }

  const node = run.graph.nodes[run.currentNodeId];
  if (!node || !node.combat) {
    return { ok: false, run, error: '当前战斗节点数据异常' };
  }
  const placed = run.bay.placed.find((p) => p.item.instanceId === moduleInstanceId);
  if (!placed) {
    return { ok: false, run, error: '未找到指定舱内部件' };
  }
  const eqDef = V2_EQUIPMENT_DEFS[placed.item.definitionId];
  if (!eqDef) {
    return { ok: false, run, error: '仅装备模块支持战中过载' };
  }

  const nextChargesUsed = Math.min(run.tacticalChargesMax, run.tacticalChargesUsed + 1);
  const prevCommitted = run.activeCombat.committedCommands ?? [];
  const prevInterventions = run.activeCombat.interventions ?? [];
  const overloadIv: V2CombatIntervention = {
    interventionId: decisionId,
    roundNumber: pending.roundNumber,
    kind: 'overload_module',
    moduleInstanceId,
    moduleKind: eqDef.kind,
  };
  const nextInterventions: readonly V2CombatIntervention[] = [...prevInterventions, overloadIv];

  const bossId = resolveNodeBossId(node, run);
  const relayTier = options?.stargateRelayTier ?? run.activeCombat.simulation.stargateRelayTier ?? 0;
  const openingLockedEnemyId = run.activeCombat.lockedEnemyId ?? null;

  const nextSimulation = simulateV2Combat({
    resultId: `cmb_${run.runId}_${node.nodeId}_r${pending.roundNumber}_ov_${eqDef.kind}_c${nextChargesUsed}`,
    bay: run.bay,
    startingHp: run.activeCombat.startingHp,
    maxHp: run.maxHp,
    units: node.combat.units,
    targetPolicy: run.activeCombat.targetPolicy,
    lockedEnemyId: openingLockedEnemyId,
    tacticalCommands: prevCommitted.map((c) => ({ roundNumber: c.roundNumber, choice: c.choice })),
    interventions: nextInterventions,
    sectorId: run.sectorId,
    crewId: run.crewId,
    crewMasteryTier: run.crewMasteryTier ?? 0,
    encounterKind: node.combat.encounterKind,
    bossId,
    overchargeCellActive: Boolean(
      run.overchargeCellActive || run.activeCombat.simulation.overchargeApplied
    ),
    stargateRelayTier: relayTier,
    endlessThreat: run.endlessThreat ?? run.activeCombat.simulation.endlessThreat,
    endlessMutatorIds: run.endlessMutatorIds ?? run.activeCombat.simulation.endlessMutatorIds,
  });

  // Never stuff 'overload_module' into pendingDecision.chosen — advance to next pause or null!
  let nextPendingDecision: V2EliteTacticDecision | null = null;
  if (nextChargesUsed < run.tacticalChargesMax) {
    const nextPauseRound = findNextPauseRoundAfterCommit(nextSimulation, pending.roundNumber);
    if (nextPauseRound !== null) {
      nextPendingDecision = buildTacticalDecisionAtRound({
        run,
        node,
        targetPolicy: run.activeCombat.targetPolicy,
        startingHp: run.activeCombat.startingHp,
        baselineSim: nextSimulation,
        pauseRound: nextPauseRound,
        priorCommands: prevCommitted,
        priorInterventions: nextInterventions,
        openingLockedEnemyId,
        chargeIndex: nextChargesUsed + 1,
        chargesMax: run.tacticalChargesMax,
        stargateRelayTier: relayTier,
      });
    }
  }

  return {
    ok: true,
    moduleKind: eqDef.kind,
    run: {
      ...run,
      tacticalChargesUsed: nextChargesUsed,
      activeCombat: {
        ...run.activeCombat,
        simulation: nextSimulation,
        pendingDecision: nextPendingDecision,
        committedCommands: prevCommitted,
        interventions: nextInterventions,
        resumeFromRound: Math.max(0, pending.roundNumber - 1),
        pausedAtDecisionId: null,
      },
      claimedEventIds: [...run.claimedEventIds, claimKey],
    },
  };
}

/**
 * D02: Toggles or clears pre-combat target lock on the current combat node (before combat starts).
 */
export function setV2PreCombatLockedEnemy(
  run: V2RunState,
  enemyId: string | null
): { readonly ok: boolean; readonly run: V2RunState; readonly error?: string } {
  if (run.phase !== 'ENCOUNTER' || !run.currentNodeId || run.activeCombat) {
    return { ok: false, run, error: '当前不在战前集火准备阶段' };
  }
  const node = run.graph.nodes[run.currentNodeId];
  if (!node || !node.combat) {
    return { ok: false, run, error: '当前节点不是战斗遭遇' };
  }
  if (enemyId === null || run.lockedEnemyId === enemyId) {
    return {
      ok: true,
      run: {
        ...run,
        lockedEnemyId: null,
      },
    };
  }
  if (!node.combat.units.some((u) => u.enemyId === enemyId)) {
    return { ok: false, run, error: '目标敌舰不存在于当前遭遇中' };
  }
  return {
    ok: true,
    run: {
      ...run,
      lockedEnemyId: enemyId,
    },
  };
}

/**
 * D02: Toggles or clears target lock mid-combat WITHOUT retroactively mutating Round 1!
 * - Preserves immutable opening Round-1 lock on `activeCombat.lockedEnemyId`.
 * - Records Round-2+ target lock strictly in `activeCombat.interventions` (`kind: 'target_lock'`).
 * - Immediately rebuilds open `pendingDecision` previews so tactical options reflect the new lock.
 */
export function setV2LiveCombatLockedEnemy(
  run: V2RunState,
  enemyId: string | null,
  currentRound?: number,
  options?: { readonly stargateRelayTier?: number }
): { readonly ok: boolean; readonly run: V2RunState; readonly error?: string } {
  if (run.phase !== 'ENCOUNTER' || !run.activeCombat || !run.currentNodeId) {
    return { ok: false, run, error: '当前不在进行中的战斗内' };
  }
  const node = run.graph.nodes[run.currentNodeId];
  if (!node || !node.combat) {
    return { ok: false, run, error: '当前战斗节点数据异常' };
  }

  const ac = run.activeCombat;
  const nextLock: string | null = enemyId === null || run.lockedEnemyId === enemyId ? null : enemyId;

  const pending = ac.pendingDecision;
  const openPending = Boolean(pending && pending.chosen === null);
  const applyRound =
    openPending && pending
      ? Math.max(2, pending.roundNumber)
      : Math.max(2, (currentRound ?? (ac.resumeFromRound ?? 0) + 1) + 1);

  // Validate target exists and is still alive before applyRound (refuse locking a destroyed enemy)
  if (nextLock !== null) {
    const prevIdx = Math.min(Math.max(0, applyRound - 2), ac.simulation.rounds.length - 1);
    const snapPool =
      applyRound >= 2 && ac.simulation.rounds.length > 0
        ? ac.simulation.rounds[prevIdx].enemiesAfter
        : ac.simulation.initialEnemies;
    const livingSnap = snapPool.find((e) => e.enemyId === nextLock);
    if (!livingSnap || livingSnap.hp <= 0) {
      return { ok: false, run, error: '该目标已被击毁，无法锁定' };
    }
  }

  const prevInterventions = ac.interventions ?? [];
  const filteredInterventions = prevInterventions.filter(
    (iv) => !(iv.kind === 'target_lock' && iv.roundNumber === applyRound)
  );
  const lockIv: V2CombatIntervention = {
    interventionId: `lock_${run.runId}_${node.nodeId}_r${applyRound}`,
    roundNumber: applyRound,
    kind: 'target_lock',
    targetEnemyId: nextLock,
  };
  const nextInterventions: readonly V2CombatIntervention[] = [...filteredInterventions, lockIv];

  const bossId = resolveNodeBossId(node, run);
  const relayTier = options?.stargateRelayTier ?? ac.simulation.stargateRelayTier ?? 0;
  const prevCommitted = ac.committedCommands ?? [];
  const openingLockedEnemyId = ac.lockedEnemyId ?? null;

  const nextSimulation = simulateV2Combat({
    resultId: `cmb_${run.runId}_${node.nodeId}_lock_r${applyRound}_${nextLock ?? 'none'}`,
    bay: run.bay,
    startingHp: ac.startingHp,
    maxHp: run.maxHp,
    units: node.combat.units,
    targetPolicy: ac.targetPolicy,
    lockedEnemyId: openingLockedEnemyId,
    tacticalCommands: prevCommitted.map((c) => ({ roundNumber: c.roundNumber, choice: c.choice })),
    interventions: nextInterventions,
    sectorId: run.sectorId,
    crewId: run.crewId,
    crewMasteryTier: run.crewMasteryTier ?? 0,
    encounterKind: node.combat.encounterKind,
    bossId,
    overchargeCellActive: Boolean(run.overchargeCellActive || ac.simulation.overchargeApplied),
    stargateRelayTier: relayTier,
    endlessThreat: run.endlessThreat ?? ac.simulation.endlessThreat,
    endlessMutatorIds: run.endlessMutatorIds ?? ac.simulation.endlessMutatorIds,
  });

  let nextPendingDecision = pending ?? null;
  if (openPending && pending) {
    const rebuilt = buildTacticalDecisionAtRound({
      run,
      node,
      targetPolicy: ac.targetPolicy,
      startingHp: ac.startingHp,
      baselineSim: nextSimulation,
      pauseRound: pending.roundNumber,
      priorCommands: prevCommitted,
      priorInterventions: nextInterventions,
      openingLockedEnemyId,
      chargeIndex: pending.chargeIndex ?? 1,
      chargesMax: pending.chargesMax ?? run.tacticalChargesMax,
      stargateRelayTier: relayTier,
    });
    if (rebuilt) {
      nextPendingDecision = { ...rebuilt, decisionId: pending.decisionId };
    }
  }

  return {
    ok: true,
    run: {
      ...run,
      lockedEnemyId: nextLock,
      activeCombat: {
        ...ac,
        simulation: nextSimulation,
        pendingDecision: nextPendingDecision,
        interventions: nextInterventions,
      },
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
    const defeatRun = freezeRunBonusObjectiveForSettlement(
      {
        ...run,
        hp: 0,
        activeCombat: null,
        lockedEnemyId: null,
        overchargeCellActive: false,
        phase: 'SETTLEMENT',
        settlementReason: 'defeat',
        claimedEventIds: [...run.claimedEventIds, claimKey],
      },
      'defeat'
    );
    return {
      ok: true,
      run: defeatRun,
    };
  }

  const effectiveBounty = getEffectiveV2CombatBounty(run, node.combat.bounty);
  const grappleWinParts = calculateV2BuildStats(run.bay).bonusSalvagePartsPerWin;
  const mutatorWinParts = aggregateEndlessMutatorEffects(run.endlessMutatorIds).salvagePartsPerWin;
  const totalWinParts = grappleWinParts + mutatorWinParts;
  const bossIdOnNode = resolveNodeBossId(node, run);

  const prevBosses = run.defeatedBossIdsThisRun ?? [];
  const nextBosses =
    bossIdOnNode && !prevBosses.includes(bossIdOnNode)
      ? [...prevBosses, bossIdOnNode]
      : [...prevBosses];

  const prevKinds = run.defeatedEnemyKindsThisRun ?? [];
  const kindAdditions = [node.combat.encounterKind, ...(bossIdOnNode ? [bossIdOnNode] : [])];
  const nextDefeatedKinds = Array.from(new Set([...prevKinds, ...kindAdditions]));

  // F17 Act III Climax Victory: defeating boss_leviathan during isFinalCampaignRun transitions
  // directly into reload-safe SETTLEMENT/safe_return pending Campaign Ending Choice!
  if (run.isFinalCampaignRun === true && bossIdOnNode === 'boss_leviathan') {
    const resolvedNodes = {
      ...run.graph.nodes,
      [node.nodeId]: {
        ...node,
        resolved: true,
      },
    };
    const climaxRun = freezeRunBonusObjectiveForSettlement(
      {
        ...run,
        hp: sim.finalPlayerHpAfterRepair,
        wallet: run.wallet + effectiveBounty,
        salvagePartsEarned: (run.salvagePartsEarned ?? 0) + totalWinParts,
        graph: {
          ...run.graph,
          nodes: resolvedNodes,
        },
        activeCombat: null,
        lockedEnemyId: null,
        overchargeCellActive: false,
        pendingReward: null,
        phase: 'SETTLEMENT',
        settlementReason: 'safe_return',
        claimedEventIds: [...run.claimedEventIds, claimKey],
        defeatedBossIdsThisRun: nextBosses,
        defeatedEnemyKindsThisRun: nextDefeatedKinds,
      },
      'safe_return'
    );
    return {
      ok: true,
      run: climaxRun,
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

  return {
    ok: true,
    run: {
      ...run,
      hp: sim.finalPlayerHpAfterRepair,
      wallet: run.wallet + effectiveBounty,
      salvagePartsEarned: (run.salvagePartsEarned ?? 0) + totalWinParts,
      rngStreams: nextStreams,
      activeCombat: null,
      lockedEnemyId: null,
      overchargeCellActive: false,
      pendingReward: bundle,
      phase: 'REWARD',
      claimedEventIds: [...run.claimedEventIds, claimKey],
      recentEquipmentKinds: nextRecentKinds,
      defeatedBossIdsThisRun: nextBosses,
      defeatedEnemyKindsThisRun: nextDefeatedKinds,
    },
  };
}
