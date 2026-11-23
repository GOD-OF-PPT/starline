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
import { simulateV2Combat } from './combatV2';
import { getReachableNextNodeIds } from './encounter';
import {
  areV2PlacedItemsAdjacent,
  removeV2ItemById,
  validateV2Placement,
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
      return ['salvo_pod', 'heavy', 'laser', 'emp_jammer', 'hangar', 'flak'];
    case 'salvo_pod':
      return ['capacitor', 'relay', 'coolant_vent', 'overdrive_core'];
    case 'emp_jammer':
      return ['overdrive_core'];
    case 'salvage_grapple':
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

interface DeltaSimContext {
  readonly sectorId?: SectorId;
  readonly crewId?: V2CrewId | null;
  readonly crewMasteryTier?: number;
  readonly encounterKind?: string;
  readonly bossId?: string;
  readonly endlessThreat?: number;
  readonly endlessMutatorIds?: readonly string[];
}

function findBestPlacementForItem(
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
        const sim = simulateV2Combat({
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

  return best ? { x: best.x, y: best.y, rotation: best.rotation, bayAfter: best.bayAfter } : null;
}

function formatSimComparison(
  label: string,
  before: ReturnType<typeof simulateV2Combat>,
  after: ReturnType<typeof simulateV2Combat>,
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
}): V2TacticalDelta {
  const def = getAnyV2ItemDef(params.item.definitionId);
  const cellCount = def ? V2_SHAPES[def.shapeId].cells.length : 1;
  const freeInfo = countFreeCells(params.bay);

  // Mission or pure cargo item -> clear value/contract space readout
  if (params.item.category !== 'equipment') {
    if (params.item.category === 'mission') {
      const fit =
        params.zone === 'grid'
          ? `已装舱占 ${cellCount} 格 · 剩余 ${freeInfo.free}/${freeInfo.total} 格`
          : freeInfo.free >= cellCount
          ? `需 ${cellCount} 格连续空间 · 当前余 ${freeInfo.free}/${freeInfo.total} 格`
          : `空间不足：需 ${cellCount} 格，当前仅余 ${freeInfo.free} 格（需腾舱或放弃委托）`;
      return {
        synergyLine: '委托专属大件 · 不参战，安全带回即可交付悬赏',
        combatDeltaLine: '占据核心装载区，可能需要取舍部分旧货或副装备',
        spaceLine: fit,
        positiveImpact: true,
      };
    }

    if (params.item.category === 'gadget') {
      return {
        synergyLine: `一次性战术消耗装置 · ${def?.gadgetDef?.shortEffectLabel ?? '主动消耗使用'}`,
        combatDeltaLine: def?.summary ?? '装入船舱后可在对应阶段主动触发并消耗',
        spaceLine:
          params.zone === 'grid'
            ? `已占 ${cellCount} 格 · 船舱剩余 ${freeInfo.free}/${freeInfo.total} 格`
            : `占 ${cellCount} 格 · 当前船舱剩余 ${freeInfo.free}/${freeInfo.total} 格`,
        positiveImpact: true,
      };
    }

    const perCell = (params.item.fixedValue / Math.max(1, cellCount)).toFixed(1);
    return {
      synergyLine: `高价货物 · 不参战，回收均价 ${perCell}¤/格`,
      combatDeltaLine: `安全返航出售 +${params.item.fixedValue}¤（商人收购 ${Math.floor(params.item.fixedValue * 0.8)}¤）`,
      spaceLine:
        params.zone === 'grid'
          ? `已占 ${cellCount} 格 · 船舱剩余 ${freeInfo.free}/${freeInfo.total} 格`
          : `占 ${cellCount} 格 · 当前船舱剩余 ${freeInfo.free}/${freeInfo.total} 格`,
      positiveImpact: params.item.fixedValue > 0,
    };
  }

  const eqDef = V2_EQUIPMENT_DEFS[params.item.definitionId]!;
  const ref = resolveReferenceEncounter(params.run);
  const partnerKinds = getSynergyPartnerKinds(eqDef.kind);
  const simCtx: DeltaSimContext = {
    sectorId: params.sectorId ?? params.run?.sectorId ?? 'near_orbit',
    crewId: params.crewId !== undefined ? params.crewId : params.run?.crewId ?? null,
    crewMasteryTier: params.crewMasteryTier ?? params.run?.crewMasteryTier ?? 0,
    encounterKind: ref.encounterKind,
    bossId: ref.bossId,
    endlessThreat: params.run?.endlessThreat,
    endlessMutatorIds: params.run?.endlessMutatorIds,
  };

  if (params.zone === 'staging') {
    const baselineSim = simulateV2Combat({
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
      return {
        synergyLine:
          partnerKinds.length > 0
            ? `可与「${V2_EQUIPMENT_DEFS[`equipment.${partnerKinds[0]}.common`].name}」正交联动`
            : eqDef.summary,
        combatDeltaLine: '当前船舱无合法空位，请先移位或舍弃旧件腾出格位',
        spaceLine: `需 ${cellCount} 格（${V2_SHAPES[eqDef.shapeId].label}）· 当前余 ${freeInfo.free}/${freeInfo.total} 格`,
        positiveImpact: false,
      };
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

    const afterSim = simulateV2Combat({
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
    });
    const cmp = formatSimComparison(ref.label, baselineSim, afterSim, 'install');

    return {
      synergyLine,
      combatDeltaLine: cmp.line,
      spaceLine: `占 ${cellCount} 格 · 装入后余 ${Math.max(0, freeInfo.free - cellCount)}/${freeInfo.total} 格`,
      recommendedSpot: { x: chosenSpot.x, y: chosenSpot.y, rotation: chosenSpot.rotation },
      positiveImpact: cmp.positive || activeLinks.length > 0,
    };
  }

  // Already placed in bay: show active synergy + impact vs removing it + reposition hint if unlinked partner exists!
  const currentStats = calculateV2BuildStats(params.bay);
  const currentLinks = currentStats.links.filter(
    (l) => l.sourceInstanceId === params.item.instanceId || l.targetInstanceId === params.item.instanceId
  );

  const bayWithout = removeV2ItemById(params.bay, params.item.instanceId);
  const simWithout = simulateV2Combat({
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
  });
  const simCurrent = simulateV2Combat({
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
  return {
    synergyLine,
    combatDeltaLine: cmp.line,
    spaceLine: `已占 ${cellCount} 格（${V2_SHAPES[eqDef.shapeId].label}）· 船舱余 ${freeInfo.free}/${freeInfo.total} 格`,
    recommendedSpot,
    positiveImpact: cmp.positive || currentLinks.length > 0,
  };
}
