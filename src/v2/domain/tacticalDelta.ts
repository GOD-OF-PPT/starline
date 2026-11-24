import type { V2CrewId } from '../data/crew';
import {
  buildEncounterUnits,
  getV2EncounterTemplate,
  type V2EnemyUnitSpec,
} from '../data/enemies';
import { V2_EQUIPMENT_DEFS, type V2EquipmentKind } from '../data/equipment';
import { getV2OccupiedCells, V2_SHAPES, type V2Rotation } from '../data/shapes';
import { V2_SHIPS } from '../data/ships';
import { calculateV2BuildStats } from './buildStatsV2';
import * as combatV2 from './combatV2';
import { getReachableNextNodeIds } from './encounter';
import {
  areV2PlacedItemsAdjacent,
  findFirstLegalV2Placement,
  removeV2ItemById,
  validateV2Placement,
  verifyV2SpatialConflict,
} from './inventoryV2';
import { getAnyV2ItemDef } from './itemCatalog';
import type {
  SectorId,
  V2CargoBayState,
  V2ItemInstance,
  V2PlacedItem,
  V2RunState,
  V2TargetPolicy,
} from './types';

const MAX_CACHE_ENTRIES = 256;

interface CachedPlacementSpot {
  readonly x: number;
  readonly y: number;
  readonly rotation: V2Rotation;
}

export interface TacticalDeltaCacheStats {
  readonly deltaHits: number;
  readonly deltaMisses: number;
  readonly bestPlacementHits: number;
  readonly bestPlacementMisses: number;
  readonly deltaSize: number;
  readonly bestPlacementSize: number;
  readonly simulationCalls: number;
}

const deltaCache = new Map<string, V2TacticalDelta>();
const bestPlacementCache = new Map<string, CachedPlacementSpot | null>();

let deltaHits = 0;
let deltaMisses = 0;
let bestPlacementHits = 0;
let bestPlacementMisses = 0;
let simulationCalls = 0;

function lruGet<V>(cache: Map<string, V>, key: string): { readonly hit: boolean; readonly value?: V } {
  if (!cache.has(key)) return { hit: false };
  const value = cache.get(key)!;
  cache.delete(key);
  cache.set(key, value);
  return { hit: true, value };
}

function lruSet<V>(cache: Map<string, V>, key: string, value: V): void {
  if (cache.has(key)) {
    cache.delete(key);
  } else if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    }
  }
  cache.set(key, value);
}

function cloneTacticalDelta(delta: V2TacticalDelta): V2TacticalDelta {
  if (delta.recommendedSpot) {
    return {
      synergyLine: delta.synergyLine,
      combatDeltaLine: delta.combatDeltaLine,
      spaceLine: delta.spaceLine,
      recommendedSpot: {
        x: delta.recommendedSpot.x,
        y: delta.recommendedSpot.y,
        rotation: delta.recommendedSpot.rotation,
      },
      positiveImpact: delta.positiveImpact,
    };
  }
  return {
    synergyLine: delta.synergyLine,
    combatDeltaLine: delta.combatDeltaLine,
    spaceLine: delta.spaceLine,
    positiveImpact: delta.positiveImpact,
  };
}

function cacheAndReturnDelta(key: string, value: V2TacticalDelta): V2TacticalDelta {
  lruSet(deltaCache, key, cloneTacticalDelta(value));
  return cloneTacticalDelta(value);
}

function runDeltaSimulation(
  params: Parameters<typeof combatV2.simulateV2Combat>[0]
): ReturnType<typeof combatV2.simulateV2Combat> {
  simulationCalls += 1;
  return combatV2.simulateV2Combat(params);
}

/**
 * Pure deterministic hash of bay hull and placed items affecting stats/combat delta.
 * Staging and discard undo entries are excluded because they do not alter combat outcomes.
 */
export function computeV2BayHash(bay: V2CargoBayState): string {
  const placedPart = bay.placed
    .map(
      (p) =>
        `${p.item.instanceId}:${p.item.definitionId}:${p.item.category}:${p.item.quality}:${p.item.origin}@${p.x},${p.y},${p.rotation}`
    )
    .join(';');
  return `${bay.shipId}|${placedPart}`;
}

export function clearTacticalDeltaCache(): void {
  deltaCache.clear();
  bestPlacementCache.clear();
  deltaHits = 0;
  deltaMisses = 0;
  bestPlacementHits = 0;
  bestPlacementMisses = 0;
  simulationCalls = 0;
}

export function getTacticalDeltaCacheStats(): TacticalDeltaCacheStats {
  return {
    deltaHits,
    deltaMisses,
    bestPlacementHits,
    bestPlacementMisses,
    deltaSize: deltaCache.size,
    bestPlacementSize: bestPlacementCache.size,
    simulationCalls,
  };
}

function serializeUnits(units: readonly V2EnemyUnitSpec[]): string {
  return units
    .map(
      (u) =>
        `${u.enemyId}:${u.name}:${u.spriteArchetype}:${u.maxHp}:${u.damagePerRound}:${u.armor}:${u.pierceRatio}:${
          u.isBoss ? 1 : 0
        }:${u.role ?? ''}:${u.initialShield ?? ''}:${u.maxShield ?? ''}`
    )
    .join(',');
}

function serializeRefEncounter(ref: ReferenceEncounter): string {
  return `${ref.label}|${ref.encounterKind ?? ''}|${ref.bossId ?? ''}|${serializeUnits(ref.units)}`;
}

function serializeItemKey(item: V2ItemInstance): string {
  return `${item.instanceId}:${item.definitionId}:${item.category}:${item.quality}:${item.origin}:${item.fixedValue}`;
}

function serializeSimCtx(
  simCtx: DeltaSimContext | undefined,
  startingHp: number,
  maxHp: number,
  targetPolicy: V2TargetPolicy
): string {
  return [
    String(startingHp),
    String(maxHp),
    targetPolicy,
    simCtx?.sectorId ?? 'near_orbit',
    simCtx?.crewId ?? '',
    String(simCtx?.crewMasteryTier ?? 0),
    simCtx?.encounterKind ?? '',
    simCtx?.bossId ?? '',
    String(simCtx?.endlessThreat ?? 0),
    (simCtx?.endlessMutatorIds ?? []).join(','),
    String(simCtx?.stargateRelayTier ?? 0),
  ].join('|');
}

function withPlacedItem(
  bay: V2CargoBayState,
  item: V2ItemInstance,
  x: number,
  y: number,
  rotation: V2Rotation
): V2CargoBayState {
  return {
    ...bay,
    placed: [...bay.placed, { item: { ...item, location: 'bay' }, x, y, rotation }],
  };
}

export interface V2TacticalDelta {
  /** Fact 1: Direct adjacency synergy effect or partner hint */
  readonly synergyLine: string;
  /** Fact 2: Authoritative simulated next-battle delta (or value-per-cell for pure cargo) */
  readonly combatDeltaLine: string;
  /** Fact 3: Space / fit summary */
  readonly spaceLine: string;
  /** Optional best legal placement spot for staging items (used to softly highlight a synergy slot) */
  readonly recommendedSpot?: { readonly x: number; readonly y: number; readonly rotation: V2Rotation };
  /** Whether installing/placing this item improves next battle */
  readonly positiveImpact: boolean;
}

interface ReferenceEncounter {
  readonly label: string;
  readonly units: readonly V2EnemyUnitSpec[];
  readonly encounterKind?: string;
  readonly bossId?: string;
}

function resolveReferenceEncounter(run: V2RunState | null): ReferenceEncounter {
  if (run) {
    const reachable = getReachableNextNodeIds(run);
    for (const nid of reachable) {
      const n = run.graph.nodes[nid];
      if (n?.combat) {
        const tpl = getV2EncounterTemplate(n.combat.encounterKind);
        return {
          label: `下站·${tpl.name}`,
          units: n.combat.units,
          encounterKind: n.combat.encounterKind,
          bossId: n.combat.bossId ?? n.bossId,
        };
      }
    }
    // Look 1 layer deeper along reachable nodes
    for (const nid of reachable) {
      const n = run.graph.nodes[nid];
      for (const nextId of n?.nextNodeIds ?? []) {
        const deep = run.graph.nodes[nextId];
        if (deep?.combat) {
          const tpl = getV2EncounterTemplate(deep.combat.encounterKind);
          return {
            label: `前路·${tpl.name}`,
            units: deep.combat.units,
            encounterKind: deep.combat.encounterKind,
            bossId: deep.combat.bossId ?? deep.bossId,
          };
        }
      }
    }
    const curLayer = run.currentNodeId ? run.graph.nodes[run.currentNodeId]?.layer ?? 1 : 1;
    const nextLayer = Math.min(run.graph.maxLayers, curLayer + 1);
    return {
      label: `第 ${nextLayer} 层标准敌舰`,
      units: buildEncounterUnits('armored', nextLayer, 'ref_delta'),
      encounterKind: 'armored',
    };
  }

  return {
    label: '模拟靶舰（装甲护卫）',
    units: buildEncounterUnits('armored', 3, 'ref_prep'),
    encounterKind: 'armored',
  };
}

function getSynergyPartnerKinds(kind: V2EquipmentKind): readonly V2EquipmentKind[] {
  switch (kind) {
    case 'laser':
      return ['battery', 'overdrive_core'];
    case 'battery':
      return ['laser'];
    case 'heavy':
      return ['capacitor', 'coolant_vent', 'overdrive_core'];
    case 'capacitor':
      return ['heavy', 'salvo_pod'];
    case 'hangar':
      return ['relay', 'overdrive_core'];
    case 'relay':
      return ['hangar', 'salvo_pod'];
    case 'shield':
      return ['counter'];
    case 'counter':
      return ['shield'];
    case 'coolant_vent':
      return ['heavy', 'salvo_pod'];
    case 'overdrive_core':
      return ['salvo_pod', 'heavy', 'laser', 'emp_jammer', 'hangar', 'flak', 'salvage_grapple'];
    case 'salvo_pod':
      return ['capacitor', 'relay', 'coolant_vent', 'overdrive_core'];
    case 'emp_jammer':
      return ['overdrive_core'];
    case 'salvage_grapple':
      return ['overdrive_core'];
    case 'flak':
      return ['overdrive_core'];
    default:
      return [];
  }
}

function countFreeCells(bay: V2CargoBayState): { readonly free: number; readonly total: number } {
  const ship = V2_SHIPS[bay.shipId];
  let occupied = 0;
  for (const p of bay.placed) {
    const def = getAnyV2ItemDef(p.item.definitionId);
    if (def) occupied += V2_SHAPES[def.shapeId].cells.length;
  }
  return { free: Math.max(0, ship.validCellCount - occupied), total: ship.validCellCount };
}

export interface DeltaSimContext {
  readonly sectorId?: SectorId;
  readonly crewId?: V2CrewId | null;
  readonly crewMasteryTier?: number;
  readonly encounterKind?: string;
  readonly bossId?: string;
  readonly endlessThreat?: number;
  readonly endlessMutatorIds?: readonly string[];
  readonly stargateRelayTier?: number;
}

export function findBestPlacementForItem(
  bay: V2CargoBayState,
  item: V2ItemInstance,
  startingHp: number,
  maxHp: number,
  policy: V2TargetPolicy,
  refUnits: readonly V2EnemyUnitSpec[],
  simCtx?: DeltaSimContext
): { readonly x: number; readonly y: number; readonly rotation: V2Rotation; readonly bayAfter: V2CargoBayState } | null {
  const ship = V2_SHIPS[bay.shipId];
  const def = getAnyV2ItemDef(item.definitionId);
  if (!def) return null;

  const cacheKey = `${computeV2BayHash(bay)}|${serializeItemKey(item)}|${serializeUnits(
    refUnits
  )}|${serializeSimCtx(simCtx, startingHp, maxHp, policy)}`;
  const cached = lruGet(bestPlacementCache, cacheKey);
  if (cached.hit) {
    bestPlacementHits += 1;
    const spot = cached.value ?? null;
    if (!spot) return null;
    return {
      x: spot.x,
      y: spot.y,
      rotation: spot.rotation,
      bayAfter: withPlacedItem(bay, item, spot.x, spot.y, spot.rotation),
    };
  }
  bestPlacementMisses += 1;

  let best: {
    x: number;
    y: number;
    rotation: V2Rotation;
    bayAfter: V2CargoBayState;
    score: number;
  } | null = null;

  const rotations: readonly V2Rotation[] = [0, 1, 2, 3];
  const seenMasks = new Set<string>();

  for (const rotation of rotations) {
    for (let y = 0; y < ship.rows; y++) {
      for (let x = 0; x < ship.cols; x++) {
        const chk = validateV2Placement(bay, item.definitionId, x, y, rotation);
        if (!chk.valid) continue;
        const cells = getV2OccupiedCells(def.shapeId, x, y, rotation)
          .map((c) => `${c.x},${c.y}`)
          .sort()
          .join('|');
        if (seenMasks.has(cells)) continue;
        seenMasks.add(cells);

        const nextBay = withPlacedItem(bay, item, x, y, rotation);
        const st = calculateV2BuildStats(nextBay);
        const sim = runDeltaSimulation({
          resultId: 'delta_probe',
          bay: nextBay,
          startingHp,
          maxHp,
          units: refUnits,
          targetPolicy: policy,
          precomputedStats: st,
          sectorId: simCtx?.sectorId,
          crewId: simCtx?.crewId,
          crewMasteryTier: simCtx?.crewMasteryTier,
          encounterKind: simCtx?.encounterKind,
          bossId: simCtx?.bossId,
          endlessThreat: simCtx?.endlessThreat,
          endlessMutatorIds: simCtx?.endlessMutatorIds,
          stargateRelayTier: simCtx?.stargateRelayTier,
        });
        const linkBonus = st.links.length * 100;
        const winBonus = sim.outcome === 'victory' ? 10_000 : 0;
        const score = winBonus + sim.finalPlayerHpAfterRepair * 20 - sim.roundsCount * 5 + linkBonus;
        if (!best || score > best.score) {
          best = { x, y, rotation, bayAfter: nextBay, score };
        }
      }
    }
  }

  if (!best) {
    lruSet(bestPlacementCache, cacheKey, null);
    return null;
  }

  lruSet(bestPlacementCache, cacheKey, { x: best.x, y: best.y, rotation: best.rotation });
  return { x: best.x, y: best.y, rotation: best.rotation, bayAfter: best.bayAfter };
}

function formatSimComparison(
  label: string,
  before: ReturnType<typeof combatV2.simulateV2Combat>,
  after: ReturnType<typeof combatV2.simulateV2Combat>,
  mode: 'install' | 'installed_value'
): { readonly line: string; readonly positive: boolean } {
  const prefix = mode === 'install' ? `装入后对「${label}」：` : `相对卸下，对「${label}」：`;
  if (before.outcome === 'defeat' && after.outcome === 'victory') {
    return {
      line: `${prefix}由败转胜（余 ${after.finalPlayerHpAfterRepair} 耐久 · ${after.roundsCount} 轮）`,
      positive: true,
    };
  }
  if (before.outcome === 'victory' && after.outcome === 'defeat') {
    return {
      line: `${prefix}将转为战败，请谨慎调整`,
      positive: false,
    };
  }
  const roundDiff = before.roundsCount - after.roundsCount;
  const hpSaved = after.finalPlayerHpAfterRepair - before.finalPlayerHpAfterRepair;

  const parts: string[] = [];
  if (roundDiff > 0) parts.push(`少打 ${roundDiff} 回合`);
  else if (roundDiff < 0) parts.push(`多打 ${Math.abs(roundDiff)} 回合`);
  if (hpSaved > 0) parts.push(`少损 ${hpSaved} 耐久`);
  else if (hpSaved < 0) parts.push(`多损 ${Math.abs(hpSaved)} 耐久`);

  if (parts.length === 0) {
    return {
      line: `${prefix}战果持平（${after.roundsCount} 轮 · 余 ${after.finalPlayerHpAfterRepair} 耐久）`,
      positive: false,
    };
  }
  return {
    line: `${prefix}${parts.join('，')}`,
    positive: roundDiff > 0 || hpSaved > 0,
  };
}

/**
 * Computes a concise ≤3-line authoritative tactical delta using the EXACT same `simulateV2Combat` engine.
 */
export function computeV2PlacementTacticalDelta(params: {
  readonly run: V2RunState | null;
  readonly bay: V2CargoBayState;
  readonly startingHp: number;
  readonly maxHp: number;
  readonly targetPolicy: V2TargetPolicy;
  readonly item: V2ItemInstance;
  readonly zone: 'grid' | 'staging';
  readonly candidateSpot?: { readonly x: number; readonly y: number; readonly rotation: V2Rotation };
  readonly sectorId?: SectorId;
  readonly crewId?: V2CrewId | null;
  readonly crewMasteryTier?: number;
  readonly stargateRelayTier?: number;
}): V2TacticalDelta {
  const bayHash = computeV2BayHash(params.bay);
  const itemKey = serializeItemKey(params.item);

  // Mission, gadget, or pure cargo item -> clear value/contract space readout (skip encounter lookup)
  if (params.item.category !== 'equipment') {
    const nonEqKey = `non_eq|${bayHash}|${itemKey}|${params.zone}`;
    const cached = lruGet(deltaCache, nonEqKey);
    if (cached.hit && cached.value) {
      deltaHits += 1;
      return cloneTacticalDelta(cached.value);
    }
    deltaMisses += 1;

    const def = getAnyV2ItemDef(params.item.definitionId);
    const cellCount = def ? V2_SHAPES[def.shapeId].cells.length : 1;
    const freeInfo = countFreeCells(params.bay);

    let result: V2TacticalDelta;
    if (params.item.category === 'mission') {
      const fit =
        params.zone === 'grid'
          ? `已装舱占 ${cellCount} 格 · 剩余 ${freeInfo.free}/${freeInfo.total} 格`
          : freeInfo.free >= cellCount
          ? `需 ${cellCount} 格连续空间 · 当前余 ${freeInfo.free}/${freeInfo.total} 格`
          : `空间不足：需 ${cellCount} 格，当前仅余 ${freeInfo.free} 格（需腾舱或放弃委托）`;
      result = {
        synergyLine: '委托专属大件 · 不参战，安全带回即可交付悬赏',
        combatDeltaLine: '占据核心装载区，可能需要取舍部分旧货或副装备',
        spaceLine: fit,
        positiveImpact: true,
      };
    } else if (params.item.category === 'gadget') {
      result = {
        synergyLine: `一次性战术消耗装置 · ${def?.gadgetDef?.shortEffectLabel ?? '主动消耗使用'}`,
        combatDeltaLine: def?.summary ?? '装入船舱后可在对应阶段主动触发并消耗',
        spaceLine:
          params.zone === 'grid'
            ? `已占 ${cellCount} 格 · 船舱剩余 ${freeInfo.free}/${freeInfo.total} 格`
            : `占 ${cellCount} 格 · 当前船舱剩余 ${freeInfo.free}/${freeInfo.total} 格`,
        positiveImpact: true,
      };
    } else {
      const perCell = (params.item.fixedValue / Math.max(1, cellCount)).toFixed(1);
      result = {
        synergyLine: `高价货物 · 不参战，回收均价 ${perCell}¤/格`,
        combatDeltaLine: `安全返航出售 +${params.item.fixedValue}¤（商人收购 ${Math.floor(params.item.fixedValue * 0.8)}¤）`,
        spaceLine:
          params.zone === 'grid'
            ? `已占 ${cellCount} 格 · 船舱剩余 ${freeInfo.free}/${freeInfo.total} 格`
            : `占 ${cellCount} 格 · 当前船舱剩余 ${freeInfo.free}/${freeInfo.total} 格`,
        positiveImpact: params.item.fixedValue > 0,
      };
    }

    return cacheAndReturnDelta(nonEqKey, result);
  }

  const eqDef = V2_EQUIPMENT_DEFS[params.item.definitionId]!;
  const ref = resolveReferenceEncounter(params.run);
  const simCtx: DeltaSimContext = {
    sectorId: params.sectorId ?? params.run?.sectorId ?? 'near_orbit',
    crewId: params.crewId !== undefined ? params.crewId : params.run?.crewId ?? null,
    crewMasteryTier: params.crewMasteryTier ?? params.run?.crewMasteryTier ?? 0,
    encounterKind: ref.encounterKind,
    bossId: ref.bossId,
    endlessThreat: params.run?.endlessThreat,
    endlessMutatorIds: params.run?.endlessMutatorIds,
    stargateRelayTier: params.stargateRelayTier,
  };
  const candidateSpotKey = params.candidateSpot
    ? `${params.candidateSpot.x},${params.candidateSpot.y},${params.candidateSpot.rotation}`
    : '';
  const eqCacheKey = `eq|${bayHash}|${serializeRefEncounter(ref)}|${serializeSimCtx(
    simCtx,
    params.startingHp,
    params.maxHp,
    params.targetPolicy
  )}|${itemKey}|${params.zone}|${candidateSpotKey}`;

  const cachedEq = lruGet(deltaCache, eqCacheKey);
  if (cachedEq.hit && cachedEq.value) {
    deltaHits += 1;
    return cloneTacticalDelta(cachedEq.value);
  }
  deltaMisses += 1;

  const def = getAnyV2ItemDef(params.item.definitionId);
  const cellCount = def ? V2_SHAPES[def.shapeId].cells.length : 1;
  const freeInfo = countFreeCells(params.bay);
  const partnerKinds = getSynergyPartnerKinds(eqDef.kind);

  if (params.zone === 'staging') {
    const baselineSim = runDeltaSimulation({
      resultId: 'delta_base',
      bay: params.bay,
      startingHp: params.startingHp,
      maxHp: params.maxHp,
      units: ref.units,
      targetPolicy: params.targetPolicy,
      sectorId: simCtx.sectorId,
      crewId: simCtx.crewId,
      crewMasteryTier: simCtx.crewMasteryTier,
      encounterKind: simCtx.encounterKind,
      bossId: simCtx.bossId,
      endlessThreat: simCtx.endlessThreat,
      endlessMutatorIds: simCtx.endlessMutatorIds,
      stargateRelayTier: simCtx.stargateRelayTier,
    });

    let chosenSpot: { x: number; y: number; rotation: V2Rotation; bayAfter: V2CargoBayState } | null = null;
    if (params.candidateSpot) {
      const chk = validateV2Placement(
        params.bay,
        params.item.definitionId,
        params.candidateSpot.x,
        params.candidateSpot.y,
        params.candidateSpot.rotation
      );
      if (chk.valid) {
        chosenSpot = {
          ...params.candidateSpot,
          bayAfter: withPlacedItem(
            params.bay,
            params.item,
            params.candidateSpot.x,
            params.candidateSpot.y,
            params.candidateSpot.rotation
          ),
        };
      }
    }
    if (!chosenSpot) {
      chosenSpot = findBestPlacementForItem(
        params.bay,
        params.item,
        params.startingHp,
        params.maxHp,
        params.targetPolicy,
        ref.units,
        simCtx
      );
    }

    if (!chosenSpot) {
      const noSpaceResult: V2TacticalDelta = {
        synergyLine:
          partnerKinds.length > 0
            ? `可与「${V2_EQUIPMENT_DEFS[`equipment.${partnerKinds[0]}.common`].name}」正交联动`
            : eqDef.summary,
        combatDeltaLine: '当前船舱无合法空位，请先移位或舍弃旧件腾出格位',
        spaceLine: `需 ${cellCount} 格（${V2_SHAPES[eqDef.shapeId].label}）· 当前余 ${freeInfo.free}/${freeInfo.total} 格`,
        positiveImpact: false,
      };
      return cacheAndReturnDelta(eqCacheKey, noSpaceResult);
    }

    const afterStats = calculateV2BuildStats(chosenSpot.bayAfter);
    const activeLinks = afterStats.links.filter(
      (l) => l.sourceInstanceId === params.item.instanceId || l.targetInstanceId === params.item.instanceId
    );
    const synergyLine =
      activeLinks.length > 0
        ? `推荐格位可触发联动：${activeLinks.map((l) => l.label).join(' / ')}`
        : partnerKinds.length > 0
        ? `贴邻「${V2_EQUIPMENT_DEFS[`equipment.${partnerKinds[0]}.common`].name}」可触发联动（当前舱内未配对）`
        : eqDef.summary;

    const afterSim = runDeltaSimulation({
      resultId: 'delta_after',
      bay: chosenSpot.bayAfter,
      startingHp: params.startingHp,
      maxHp: params.maxHp,
      units: ref.units,
      targetPolicy: params.targetPolicy,
      precomputedStats: afterStats,
      sectorId: simCtx.sectorId,
      crewId: simCtx.crewId,
      crewMasteryTier: simCtx.crewMasteryTier,
      encounterKind: simCtx.encounterKind,
      bossId: simCtx.bossId,
      endlessThreat: simCtx.endlessThreat,
      endlessMutatorIds: simCtx.endlessMutatorIds,
      stargateRelayTier: simCtx.stargateRelayTier,
    });
    const cmp = formatSimComparison(ref.label, baselineSim, afterSim, 'install');

    const stagingResult: V2TacticalDelta = {
      synergyLine,
      combatDeltaLine: cmp.line,
      spaceLine: `占 ${cellCount} 格 · 装入后余 ${Math.max(0, freeInfo.free - cellCount)}/${freeInfo.total} 格`,
      recommendedSpot: { x: chosenSpot.x, y: chosenSpot.y, rotation: chosenSpot.rotation },
      positiveImpact: cmp.positive || activeLinks.length > 0,
    };
    return cacheAndReturnDelta(eqCacheKey, stagingResult);
  }

  // Already placed in bay: show active synergy + impact vs removing it + reposition hint if unlinked partner exists!
  const currentStats = calculateV2BuildStats(params.bay);
  const currentLinks = currentStats.links.filter(
    (l) => l.sourceInstanceId === params.item.instanceId || l.targetInstanceId === params.item.instanceId
  );

  const bayWithout = removeV2ItemById(params.bay, params.item.instanceId);
  const simWithout = runDeltaSimulation({
    resultId: 'delta_without',
    bay: bayWithout,
    startingHp: params.startingHp,
    maxHp: params.maxHp,
    units: ref.units,
    targetPolicy: params.targetPolicy,
    sectorId: simCtx.sectorId,
    crewId: simCtx.crewId,
    crewMasteryTier: simCtx.crewMasteryTier,
    encounterKind: simCtx.encounterKind,
    bossId: simCtx.bossId,
    endlessThreat: simCtx.endlessThreat,
    endlessMutatorIds: simCtx.endlessMutatorIds,
    stargateRelayTier: simCtx.stargateRelayTier,
  });
  const simCurrent = runDeltaSimulation({
    resultId: 'delta_cur',
    bay: params.bay,
    startingHp: params.startingHp,
    maxHp: params.maxHp,
    units: ref.units,
    targetPolicy: params.targetPolicy,
    precomputedStats: currentStats,
    sectorId: simCtx.sectorId,
    crewId: simCtx.crewId,
    crewMasteryTier: simCtx.crewMasteryTier,
    encounterKind: simCtx.encounterKind,
    bossId: simCtx.bossId,
    endlessThreat: simCtx.endlessThreat,
    endlessMutatorIds: simCtx.endlessMutatorIds,
    stargateRelayTier: simCtx.stargateRelayTier,
  });

  let synergyLine: string;
  let recommendedSpot: { x: number; y: number; rotation: V2Rotation } | undefined;

  if (currentLinks.length > 0) {
    const partnerPlaced = params.bay.placed.find((p) =>
      currentLinks.some(
        (l) =>
          (l.sourceInstanceId === params.item.instanceId && l.targetInstanceId === p.item.instanceId) ||
          (l.targetInstanceId === params.item.instanceId && l.sourceInstanceId === p.item.instanceId)
      )
    );
    const partnerName = partnerPlaced
      ? getAnyV2ItemDef(partnerPlaced.item.definitionId)?.name ?? '相邻装备'
      : '相邻装备';
    synergyLine = `已贴邻「${partnerName}」生效（${currentLinks.map((l) => l.label).join(' / ')}）`;
  } else if (partnerKinds.length > 0) {
    const partnerInBay = params.bay.placed.find((p) => {
      const pEq = V2_EQUIPMENT_DEFS[p.item.definitionId];
      return pEq && partnerKinds.includes(pEq.kind);
    });
    if (partnerInBay) {
      // Check if moving this item can link to partnerInBay!
      const bestMove = findBestPlacementForItem(
        bayWithout,
        params.item,
        params.startingHp,
        params.maxHp,
        params.targetPolicy,
        ref.units,
        simCtx
      );
      const movedPlaced: V2PlacedItem | null = bestMove
        ? { item: params.item, x: bestMove.x, y: bestMove.y, rotation: bestMove.rotation }
        : null;
      const canLink = movedPlaced !== null && areV2PlacedItemsAdjacent(movedPlaced, partnerInBay);
      if (canLink && bestMove) {
        recommendedSpot = { x: bestMove.x, y: bestMove.y, rotation: bestMove.rotation };
        synergyLine = `未贴邻「${getAnyV2ItemDef(partnerInBay.item.definitionId)?.name ?? '联动件'}」— 移至高亮位即可激活联动！`;
      } else {
        synergyLine = `未贴邻「${getAnyV2ItemDef(partnerInBay.item.definitionId)?.name ?? '联动件'}」— 调整位置正交贴紧即可激活`;
      }
    } else {
      synergyLine = `可与「${V2_EQUIPMENT_DEFS[`equipment.${partnerKinds[0]}.common`].name}」正交联动`;
    }
  } else {
    synergyLine = eqDef.summary;
  }

  const cmp = formatSimComparison(ref.label, simWithout, simCurrent, 'installed_value');
  const gridResult: V2TacticalDelta = {
    synergyLine,
    combatDeltaLine: cmp.line,
    spaceLine: `已占 ${cellCount} 格（${V2_SHAPES[eqDef.shapeId].label}）· 船舱余 ${freeInfo.free}/${freeInfo.total} 格`,
    recommendedSpot,
    positiveImpact: cmp.positive || currentLinks.length > 0,
  };
  return cacheAndReturnDelta(eqCacheKey, gridResult);
}

export type V2CombatThreatTier = 'steady' | 'strained' | 'danger' | 'lethal';

export interface V2CombatThreatClassification {
  readonly tier: V2CombatThreatTier;
  readonly label: '稳' | '吃力' | '危险' | '致命';
  readonly riskClass: 'ok' | 'warn' | 'risk';
}

/**
 * Pure qualitative combat threat tier classifier shared across Map route forecasts,
 * first-voyage fork warnings (S01), and Layer-1 threat badges (S06).
 */
export function classifyV2CombatThreat(
  sim: { readonly outcome: 'victory' | 'defeat'; readonly playerFinalHp: number },
  maxHp: number
): V2CombatThreatClassification {
  if (sim.outcome !== 'victory' || sim.playerFinalHp <= 0) {
    return { tier: 'lethal', label: '致命', riskClass: 'risk' };
  }
  const ratio = sim.playerFinalHp / Math.max(1, maxHp);
  if (ratio < 0.35) {
    return { tier: 'danger', label: '危险', riskClass: 'risk' };
  }
  if (ratio < 0.6) {
    return { tier: 'strained', label: '吃力', riskClass: 'warn' };
  }
  return { tier: 'steady', label: '稳', riskClass: 'ok' };
}

export interface V2ItemSacrificePreview {
  readonly instanceId: string;
  readonly name: string;
  readonly freedCells: number;
  readonly firepowerLoss: number;
  readonly shieldLoss: number;
  readonly repairLoss: number;
  readonly valueLoss: number;
  readonly impactSummary: string;
  readonly fullLabel: string;
}

export interface V2MissionSacrificeSummary {
  readonly missionItemName: string;
  readonly needsSpace: boolean;
  readonly needsRearrangeOnly: boolean;
  readonly options: readonly V2ItemSacrificePreview[];
  readonly summaryText: string;
}

function buildSacrificePreviewFromStatsDelta(
  item: V2ItemInstance,
  name: string,
  freedCells: number,
  statsBefore: ReturnType<typeof calculateV2BuildStats>,
  statsAfter: ReturnType<typeof calculateV2BuildStats>
): V2ItemSacrificePreview {
  const firepowerLoss = Math.max(
    0,
    statsBefore.nominalRound1SingleDmg - statsAfter.nominalRound1SingleDmg
  );
  const shieldLoss = Math.max(0, statsBefore.effectiveShield - statsAfter.effectiveShield);
  const repairLoss = Math.max(0, statsBefore.effectiveRepair - statsAfter.effectiveRepair);
  const valueLoss =
    item.origin === 'loot' || item.origin === 'owned' ? Math.max(0, item.fixedValue) : 0;

  const parts: string[] = [];
  if (firepowerLoss > 0) parts.push(`火力 -${firepowerLoss}`);
  if (shieldLoss > 0) parts.push(`护盾 -${shieldLoss}`);
  if (repairLoss > 0) parts.push(`维修 -${repairLoss}`);
  if (valueLoss > 0) parts.push(`-${valueLoss}¤`);
  if (parts.length === 0) {
    parts.push(item.origin === 'loan' ? '借用 · 0¤' : '0¤');
  }

  const impactSummary = parts.join('，');
  return {
    instanceId: item.instanceId,
    name,
    freedCells,
    firepowerLoss,
    shieldLoss,
    repairLoss,
    valueLoss,
    impactSummary,
    fullLabel: `${name}（${impactSummary}）`,
  };
}

/**
 * Pure real-time sacrifice preview for a currently placed cargo bay item (S01).
 * Evaluates exact firepower / shield / repair / credit loss if discarded.
 */
export function computeV2ItemSacrificePreview(
  bay: V2CargoBayState,
  instanceId: string
): V2ItemSacrificePreview | null {
  const placed = bay.placed.find((p) => p.item.instanceId === instanceId);
  if (!placed) return null;
  const def = getAnyV2ItemDef(placed.item.definitionId);
  if (!def) return null;
  const freedCells = V2_SHAPES[def.shapeId].cells.length;
  const statsBefore = calculateV2BuildStats(bay);
  const statsAfter = calculateV2BuildStats(removeV2ItemById(bay, instanceId));
  return buildSacrificePreviewFromStatsDelta(
    placed.item,
    def.name,
    freedCells,
    statsBefore,
    statsAfter
  );
}

/**
 * Pure real-time mission-item spatial conflict sacrifice summary (S01 Step 4).
 * When a mission item (e.g. 2x3 Sealed Reactor) sits in staging and cannot fit directly,
 * uses the exact bitmask conflict solver to enumerate concrete sacrifice losses (`将损失：...`).
 */
export function summarizeV2MissionSacrificeOptions(
  bay: V2CargoBayState
): V2MissionSacrificeSummary | null {
  const missionStaged = bay.staging.find(
    (s) => s.item.category === 'mission' || s.item.origin === 'mission'
  );
  if (!missionStaged) return null;
  const missionDef = getAnyV2ItemDef(missionStaged.item.definitionId);
  if (!missionDef) return null;

  const directSpot = findFirstLegalV2Placement(bay, missionStaged.item.definitionId);
  if (directSpot !== null) {
    return {
      missionItemName: missionDef.name,
      needsSpace: false,
      needsRearrangeOnly: false,
      options: [],
      summaryText: '',
    };
  }

  const placedWithShapes = bay.placed
    .map((p) => {
      const d = getAnyV2ItemDef(p.item.definitionId);
      return d ? { id: p.item.instanceId, shapeId: d.shapeId, item: p.item } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const conflict = verifyV2SpatialConflict(
    bay.shipId,
    placedWithShapes.map((x) => ({ id: x.id, shapeId: x.shapeId })),
    missionDef.shapeId
  );

  if (conflict.allFitTogether) {
    return {
      missionItemName: missionDef.name,
      needsSpace: false,
      needsRearrangeOnly: true,
      options: [],
      summaryText: '',
    };
  }

  const feasibleSet = new Set(conflict.feasibleSingleDiscardIds);
  const candidatePool =
    feasibleSet.size > 0
      ? bay.placed.filter(
          (p) => p.item.category !== 'mission' && feasibleSet.has(p.item.instanceId)
        )
      : bay.placed.filter((p) => p.item.category !== 'mission');

  const previews = candidatePool
    .map((p) => computeV2ItemSacrificePreview(bay, p.item.instanceId))
    .filter((pv): pv is V2ItemSacrificePreview => pv !== null)
    .sort((a, b) => {
      const aCombat = a.firepowerLoss * 10 + a.shieldLoss * 4 + a.repairLoss * 4;
      const bCombat = b.firepowerLoss * 10 + b.shieldLoss * 4 + b.repairLoss * 4;
      if (bCombat !== aCombat) return bCombat - aCombat;
      if (b.valueLoss !== a.valueLoss) return b.valueLoss - a.valueLoss;
      if (b.freedCells !== a.freedCells) return b.freedCells - a.freedCells;
      return a.instanceId.localeCompare(b.instanceId);
    });

  const summaryText =
    previews.length > 0 ? `将损失：${previews.map((o) => o.fullLabel).join(' / ')}` : '';

  return {
    missionItemName: missionDef.name,
    needsSpace: true,
    needsRearrangeOnly: false,
    options: previews,
    summaryText,
  };
}

/**
 * Summarizes real-time loss of items currently in `bay.discardedThisArrange` (undoable before leaving).
 */
export function summarizeV2DiscardedSacrifices(bay: V2CargoBayState): string {
  if (bay.discardedThisArrange.length === 0) return '';
  const labels: string[] = [];
  for (const rec of bay.discardedThisArrange) {
    const def = getAnyV2ItemDef(rec.item.definitionId);
    if (!def) continue;
    const cells = V2_SHAPES[def.shapeId].cells.length;
    if (rec.previousLocation.zone === 'grid') {
      const prevLoc = rec.previousLocation;
      const targetCoords = new Set(
        getV2OccupiedCells(def.shapeId, prevLoc.x, prevLoc.y, prevLoc.rotation).map(
          (c) => `${c.x},${c.y}`
        )
      );
      const nonOverlappingPlaced = bay.placed.filter((p) => {
        const pd = getAnyV2ItemDef(p.item.definitionId);
        if (!pd) return true;
        return !getV2OccupiedCells(pd.shapeId, p.x, p.y, p.rotation).some((c) =>
          targetCoords.has(`${c.x},${c.y}`)
        );
      });
      const probeWithout: V2CargoBayState = { ...bay, placed: nonOverlappingPlaced };
      const probeWith: V2CargoBayState = {
        ...bay,
        placed: [
          ...nonOverlappingPlaced,
          {
            item: { ...rec.item, location: 'bay' },
            x: prevLoc.x,
            y: prevLoc.y,
            rotation: prevLoc.rotation,
          },
        ],
      };
      const pv = buildSacrificePreviewFromStatsDelta(
        rec.item,
        def.name,
        cells,
        calculateV2BuildStats(probeWith),
        calculateV2BuildStats(probeWithout)
      );
      labels.push(pv.fullLabel);
    } else {
      const val =
        rec.item.origin === 'loot' || rec.item.origin === 'owned'
          ? Math.max(0, rec.item.fixedValue)
          : 0;
      labels.push(
        `${def.name}（${val > 0 ? `-${val}¤` : rec.item.origin === 'loan' ? '借用 · 0¤' : '0¤'}）`
      );
    }
  }
  return labels.length > 0 ? `将损失：${labels.join(' / ')}` : '';
}
