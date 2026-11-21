import {
  CARGO_KINDS,
  EQUIPMENT_KINDS,
  LOADOUTS,
  SHIP_CORE,
  getCargoDef,
  getEquipmentDef,
  type EquipmentKind,
  type EquipmentQuality,
  type LoadoutId,
} from '../data/items';
import {
  MAX_EXPEDITION_NODES,
  computeCargoPrice,
  getRouteSpec,
  type RouteSpec,
  type RouteType,
} from '../data/nodes';
import { TUTORIAL_SCRIPT } from '../data/tutorial';
import { calculateBuildStats, type BuildStats } from './buildStats';
import { simulateCombat, type CombatSimulationResult } from './combat';
import {
  commitDiscards,
  createEmptyCargoBay,
  type CargoBayState,
  type ItemInstance,
} from './inventory';
import { SeededRng, createRandomSeed, type RngCursor } from './rng';

export type ExpeditionPhase = 'ROUTE_SELECT' | 'COMBAT' | 'REWARD' | 'ARRANGE' | 'SETTLEMENT';
export type SettlementReason = 'safe_return' | 'defeat';

export type RewardOption =
  | {
      readonly optionId: 'equipment';
      readonly kind: 'equipment';
      readonly item: ItemInstance;
    }
  | {
      readonly optionId: 'cargo';
      readonly kind: 'cargo';
      readonly item: ItemInstance;
    }
  | {
      readonly optionId: 'repair';
      readonly kind: 'repair';
      readonly healAmount: number;
    };

export interface ActiveCombatState {
  readonly routeSpec: RouteSpec;
  readonly statsSnapshot: BuildStats;
  readonly startingHp: number;
  readonly simulation: CombatSimulationResult;
}

export interface ExpeditionState {
  readonly expeditionId: string;
  readonly loadoutId: LoadoutId;
  readonly isTutorial: boolean;
  readonly maxNodes: number;
  readonly currentNode: number; // 1..maxNodes
  readonly completedNodes: number;
  readonly phase: ExpeditionPhase;
  readonly currentHp: number;
  readonly maxHp: number;
  readonly accumulatedBounty: number;
  readonly bay: CargoBayState;
  readonly rngCursor: RngCursor;
  readonly nextInstanceSeq: number;
  readonly recentEquipmentKinds: readonly EquipmentKind[];
  readonly activeCombat: ActiveCombatState | null;
  readonly lastCombat: ActiveCombatState | null;
  readonly pendingRewards: readonly RewardOption[] | null;
  readonly settlementReason: SettlementReason | null;
  readonly discoveredDuringRun: readonly string[];
}

export interface StartExpeditionOptions {
  readonly loadoutId: LoadoutId;
  readonly isTutorial?: boolean;
  readonly seed?: number;
  readonly maxNodes?: number;
  readonly expeditionId?: string;
}

export function startExpedition(options: StartExpeditionOptions): ExpeditionState {
  const loadout = LOADOUTS[options.loadoutId];
  const seed = options.seed ?? createRandomSeed();
  const maxNodes = options.maxNodes ?? MAX_EXPEDITION_NODES;
  const expeditionId =
    options.expeditionId ?? `exp_${Date.now().toString(36)}_${(seed >>> 0).toString(36)}`;

  const starterItem: ItemInstance = {
    instanceId: `${expeditionId}_item_0`,
    defId: loadout.starterDefId,
    isBorrowed: true,
    value: 0,
    acquiredNode: 0,
  };

  const bay: CargoBayState = {
    ...createEmptyCargoBay(),
    placed: [
      {
        item: starterItem,
        x: loadout.starterOrigin.x,
        y: loadout.starterOrigin.y,
        rotation: 0,
      },
    ],
  };

  return {
    expeditionId,
    loadoutId: options.loadoutId,
    isTutorial: Boolean(options.isTutorial),
    maxNodes,
    currentNode: 1,
    completedNodes: 0,
    phase: 'ROUTE_SELECT',
    currentHp: SHIP_CORE.maxHp,
    maxHp: SHIP_CORE.maxHp,
    accumulatedBounty: 0,
    bay,
    rngCursor: { seed: seed >>> 0, draws: 0 },
    nextInstanceSeq: 1,
    recentEquipmentKinds: [],
    activeCombat: null,
    lastCombat: null,
    pendingRewards: null,
    settlementReason: null,
    discoveredDuringRun: [loadout.starterDefId],
  };
}

export function getRoutePreview(
  expedition: ExpeditionState,
  routeType: RouteType
): {
  readonly routeSpec: RouteSpec;
  readonly stats: BuildStats;
  readonly prediction: CombatSimulationResult;
} {
  const routeSpec = getRouteSpec(expedition.currentNode, routeType);
  const stats = calculateBuildStats(expedition.bay);
  const prediction = simulateCombat(stats, expedition.currentHp, routeSpec.enemy, routeSpec.bounty);
  return { routeSpec, stats, prediction };
}

export function selectRoute(
  expedition: ExpeditionState,
  routeType: RouteType
): ExpeditionState {
  if (expedition.phase !== 'ROUTE_SELECT') {
    throw new Error(`Cannot select route during phase ${expedition.phase}`);
  }
  if (expedition.currentNode < 1 || expedition.currentNode > expedition.maxNodes) {
    throw new Error(`Invalid node ${expedition.currentNode} for route selection`);
  }

  const { routeSpec, stats, prediction } = getRoutePreview(expedition, routeType);

  const activeCombat: ActiveCombatState = {
    routeSpec,
    statsSnapshot: stats,
    startingHp: expedition.currentHp,
    simulation: prediction,
  };

  return {
    ...expedition,
    phase: 'COMBAT',
    activeCombat,
    lastCombat: activeCombat,
  };
}

function generateRewards(
  expedition: ExpeditionState,
  routeSpec: RouteSpec
): {
  readonly rewards: readonly RewardOption[];
  readonly nextRngCursor: RngCursor;
  readonly nextInstanceSeq: number;
  readonly nextRecentEquipmentKinds: readonly EquipmentKind[];
} {
  let seq = expedition.nextInstanceSeq;
  const makeId = () => `${expedition.expeditionId}_item_${seq++}`;

  const tutorialStep = expedition.isTutorial ? TUTORIAL_SCRIPT[routeSpec.node] : undefined;
  if (tutorialStep) {
    const eqDef = getEquipmentDef(tutorialStep.equipment.kind, tutorialStep.equipment.quality);
    const cargoDef = getCargoDef(tutorialStep.cargo);
    const cargoPrice = computeCargoPrice(tutorialStep.cargo, routeSpec.node, routeSpec.routeType);

    const eqItem: ItemInstance = {
      instanceId: makeId(),
      defId: eqDef.defId,
      isBorrowed: false,
      value: eqDef.recycleValue,
      acquiredNode: routeSpec.node,
    };
    const cargoItem: ItemInstance = {
      instanceId: makeId(),
      defId: cargoDef.defId,
      isBorrowed: false,
      value: cargoPrice,
      acquiredNode: routeSpec.node,
    };
    return {
      rewards: [
        { optionId: 'equipment', kind: 'equipment', item: eqItem },
        { optionId: 'cargo', kind: 'cargo', item: cargoItem },
        { optionId: 'repair', kind: 'repair', healAmount: SHIP_CORE.repairRewardAmount },
      ],
      nextRngCursor: expedition.rngCursor,
      nextInstanceSeq: seq,
      nextRecentEquipmentKinds: [...expedition.recentEquipmentKinds, tutorialStep.equipment.kind].slice(
        -2
      ),
    };
  }

  const rng = SeededRng.fromCursor(expedition.rngCursor);

  // Anti-3-peat rule: if last two offered equipment kinds are identical, draw from the remaining 3
  let eqPool: readonly EquipmentKind[] = EQUIPMENT_KINDS;
  const recent = expedition.recentEquipmentKinds;
  if (recent.length >= 2 && recent[recent.length - 1] === recent[recent.length - 2]) {
    const blocked = recent[recent.length - 1];
    eqPool = EQUIPMENT_KINDS.filter((k) => k !== blocked);
  }

  const eqKind = rng.pick(eqPool);
  const qualityRoll = rng.nextFloat();
  const eqQuality: EquipmentQuality =
    qualityRoll < routeSpec.improvedEquipmentProb ? 'improved' : 'common';
  const eqDef = getEquipmentDef(eqKind, eqQuality);

  const cargoKind = rng.pick(CARGO_KINDS);
  const cargoDef = getCargoDef(cargoKind);
  const cargoPrice = computeCargoPrice(cargoKind, routeSpec.node, routeSpec.routeType);

  const eqItem: ItemInstance = {
    instanceId: makeId(),
    defId: eqDef.defId,
    isBorrowed: false,
    value: eqDef.recycleValue,
    acquiredNode: routeSpec.node,
  };

  const cargoItem: ItemInstance = {
    instanceId: makeId(),
    defId: cargoDef.defId,
    isBorrowed: false,
    value: cargoPrice,
    acquiredNode: routeSpec.node,
  };

  return {
    rewards: [
      { optionId: 'equipment', kind: 'equipment', item: eqItem },
      { optionId: 'cargo', kind: 'cargo', item: cargoItem },
      { optionId: 'repair', kind: 'repair', healAmount: SHIP_CORE.repairRewardAmount },
    ],
    nextRngCursor: rng.getCursor(),
    nextInstanceSeq: seq,
    nextRecentEquipmentKinds: [...recent, eqKind].slice(-2),
  };
}

export function completeCombat(expedition: ExpeditionState): ExpeditionState {
  if (expedition.phase !== 'COMBAT' || !expedition.activeCombat) {
    throw new Error(`Cannot complete combat during phase ${expedition.phase}`);
  }

  const { routeSpec, simulation } = expedition.activeCombat;

  if (simulation.outcome === 'defeat') {
    return {
      ...expedition,
      phase: 'SETTLEMENT',
      currentHp: 0,
      activeCombat: null,
      pendingRewards: null,
      settlementReason: 'defeat',
    };
  }

  const generated = generateRewards(expedition, routeSpec);

  return {
    ...expedition,
    phase: 'REWARD',
    currentHp: simulation.finalPlayerHp,
    completedNodes: expedition.completedNodes + 1,
    accumulatedBounty: expedition.accumulatedBounty + simulation.bountyEarned,
    activeCombat: null,
    pendingRewards: generated.rewards,
    rngCursor: generated.nextRngCursor,
    nextInstanceSeq: generated.nextInstanceSeq,
    recentEquipmentKinds: generated.nextRecentEquipmentKinds,
  };
}

export function selectReward(
  expedition: ExpeditionState,
  optionId: 'equipment' | 'cargo' | 'repair'
): ExpeditionState {
  if (expedition.phase !== 'REWARD' || !expedition.pendingRewards) {
    throw new Error(`Cannot select reward during phase ${expedition.phase}`);
  }

  const chosen = expedition.pendingRewards.find((r) => r.optionId === optionId);
  if (!chosen) {
    throw new Error(`Reward option ${optionId} not found`);
  }

  if (chosen.kind === 'repair') {
    const healedHp = Math.min(expedition.maxHp, expedition.currentHp + chosen.healAmount);
    return {
      ...expedition,
      phase: 'ARRANGE',
      currentHp: healedHp,
      pendingRewards: null,
      bay: commitDiscards(expedition.bay),
    };
  }

  const discovered = expedition.discoveredDuringRun.includes(chosen.item.defId)
    ? expedition.discoveredDuringRun
    : [...expedition.discoveredDuringRun, chosen.item.defId];

  return {
    ...expedition,
    phase: 'ARRANGE',
    pendingRewards: null,
    discoveredDuringRun: discovered,
    bay: {
      ...commitDiscards(expedition.bay),
      staging: [...expedition.bay.staging, { item: chosen.item, rotation: 0 }],
    },
  };
}

export function isCargoBayEditable(expedition: ExpeditionState): boolean {
  return expedition.phase === 'ARRANGE';
}

export function updateArrangeBay(
  expedition: ExpeditionState,
  nextBay: CargoBayState
): ExpeditionState {
  if (!isCargoBayEditable(expedition)) {
    throw new Error(`Cargo bay is locked during phase ${expedition.phase}`);
  }
  return {
    ...expedition,
    bay: nextBay,
  };
}

export function canLeaveArrange(expedition: ExpeditionState): {
  readonly ok: boolean;
  readonly reason?: string;
} {
  if (expedition.phase !== 'ARRANGE') {
    return { ok: false, reason: '当前不在整理阶段' };
  }
  if (expedition.bay.staging.length > 0) {
    return { ok: false, reason: '请先处理暂存区物品（放入船舱或舍弃）' };
  }
  return { ok: true };
}

export function isAtFinalNode(expedition: ExpeditionState): boolean {
  return expedition.currentNode >= expedition.maxNodes;
}

export function proceedToNextNode(expedition: ExpeditionState): ExpeditionState {
  const check = canLeaveArrange(expedition);
  if (!check.ok) {
    throw new Error(check.reason ?? 'Cannot leave arrange phase');
  }
  if (isAtFinalNode(expedition)) {
    throw new Error(`Already at final node ${expedition.maxNodes}; must return to base`);
  }
  return {
    ...expedition,
    phase: 'ROUTE_SELECT',
    currentNode: expedition.currentNode + 1,
    bay: commitDiscards(expedition.bay),
  };
}

export function initiateSafeReturn(expedition: ExpeditionState): ExpeditionState {
  const check = canLeaveArrange(expedition);
  if (!check.ok) {
    throw new Error(check.reason ?? 'Cannot leave arrange phase');
  }
  return {
    ...expedition,
    phase: 'SETTLEMENT',
    settlementReason: 'safe_return',
    bay: commitDiscards(expedition.bay),
  };
}
