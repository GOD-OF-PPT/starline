import type { SeededRng } from '../../domain/rng';
import type { SectorBgIndex } from '../../data/nodes';
import {
  V2_CARGO_DEFS,
  V2_EXTENDED_RELIC_CARGO_KINDS,
  V2_REGULAR_CARGO_KINDS,
  computeV2CargoPrice,
} from '../data/cargo';
import { V2_CONTRACT_TEMPLATES, type V2ContractTemplate } from '../data/contracts';
import {
  buildEncounterUnits,
  getEncounterBounty,
  getEncounterImprovedProb,
  type V2EncounterKind,
} from '../data/enemies';
import {
  V2_ARCHETYPE_SUPPORT_PART,
  getUnlockedEquipmentKinds,
  getV2EquipmentDefByKind,
  type V2ArchetypeId,
  type V2EquipmentKind,
  type V2Quality,
  type V2UnlockFamilyId,
} from '../data/equipment';
import { V2_SHAPES } from '../data/shapes';
import { createV2CargoInstance, createV2EquipmentInstance } from './itemCatalog';
import { withV2Stream } from './rngStreams';
import {
  V2_STARTING_FUEL,
  type V2AnomalyPayload,
  type V2CombatPayload,
  type V2ContractInstance,
  type V2DistressPayload,
  type V2ItemInstance,
  type V2MapNode,
  type V2MerchantPayload,
  type V2NodeType,
  type V2RngStreams,
  type V2ShopEquipmentOffer,
  type V2StarGraph,
  type V2WreckPayload,
} from './types';

const LAYER_SECTOR_BGS: readonly SectorBgIndex[] = [1, 2, 4, 5, 3, 6];

const REGULAR_ENCOUNTER_KINDS: readonly V2EncounterKind[] = [
  'patrol',
  'swarm',
  'armored',
  'piercer',
];

export interface GenerateV2GraphParams {
  readonly runId: string;
  readonly contractTemplateId: string;
  readonly primaryArchetype: V2ArchetypeId;
  readonly unlockedFamilies: readonly V2UnlockFamilyId[];
  readonly streams: V2RngStreams;
  readonly allowImproved: boolean;
  readonly maxLayers?: number;
}

export interface GenerateV2GraphResult {
  readonly graph: V2StarGraph;
  readonly markedNodeIds: readonly string[];
  readonly nextStreams: V2RngStreams;
}

function makeNodeId(layer: number, lane: 0 | 1): string {
  return `L${layer}${lane === 0 ? 'A' : 'B'}`;
}

function pickCargoDefId(rng: SeededRng, layer: number, isEliteOrDeepBonus = false): string {
  // Preserve v3.0 extended relics in deep layers (4..6) at modest probability (ADR-02)
  if (layer >= 4) {
    const extProb = isEliteOrDeepBonus ? 0.22 : 0.12;
    if (rng.nextFloat() < extProb) {
      const kind = rng.pick(V2_EXTENDED_RELIC_CARGO_KINDS);
      return `cargo.${kind}`;
    }
  }
  const kind = rng.pick(V2_REGULAR_CARGO_KINDS);
  return `cargo.${kind}`;
}

function rollQuality(
  rng: SeededRng,
  layer: number,
  isElite: boolean,
  allowImproved: boolean
): V2Quality {
  if (!allowImproved) return 'common';
  const prob = getEncounterImprovedProb(isElite ? 'elite' : 'patrol', layer, allowImproved);
  return rng.nextFloat() < prob ? 'improved' : 'common';
}

function sizeRangeLabel(items: readonly V2ItemInstance[]): string {
  const counts = items.map((it) => {
    const def = V2_CARGO_DEFS[it.definitionId];
    return def ? V2_SHAPES[def.shapeId].cells.length : 2;
  });
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  return min === max ? `${min} 格` : `${min}–${max} 格`;
}

function valueRangeLabel(items: readonly V2ItemInstance[]): string {
  const vals = items.map((it) => it.fixedValue);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return min === max ? `${min}¤` : `${min}–${max}¤`;
}

/**
 * Generates a deterministic 6-layer (or custom-layer) directed acyclic star map
 * enforcing ALL §4.3, §5.1, §9, and AC05 invariants:
 * - Every node at layer L < maxLayers has >= 1 outgoing edge; every node at L > 1 has >= 1 incoming edge
 * - Layer 1 always has 1 wreck + 1 light combat (patrol)
 * - Layer 6 always has 1 elite + 1 non-combat ending
 * - At least 2 layers have non-combat options; max 2 consecutive mandatory-combat layers
 * - At least 1 reachable merchant in Layers 2–4
 * - Guaranteed connected path covers ALL contract objectives within starting fuel budget (9)
 * - Guaranteed reachable primary-archetype support part in Layers 2–4 (free via wreck/combat OR
 *   merchant with sufficient guaranteed bounties beforehand)
 */
export function generateV2StarGraph(params: GenerateV2GraphParams): GenerateV2GraphResult {
  const maxLayers = params.maxLayers ?? 6;
  const tpl: V2ContractTemplate =
    V2_CONTRACT_TEMPLATES[params.contractTemplateId] ?? V2_CONTRACT_TEMPLATES.free_salvage;
  const unlockedKinds = getUnlockedEquipmentKinds(params.unlockedFamilies);
  const supportKind = V2_ARCHETYPE_SUPPORT_PART[params.primaryArchetype];

  let streams = params.streams;

  // 1. Choose guaranteed backbone lanes (one node per layer 1..maxLayers)
  const backboneLanes: (0 | 1)[] = [];
  const laneDraw = withV2Stream(streams, 'map', (rng) => {
    const lanes: (0 | 1)[] = [];
    for (let layer = 1; layer <= maxLayers; layer++) {
      lanes.push(rng.nextInt(2) as 0 | 1);
    }
    return lanes;
  });
  backboneLanes.push(...laneDraw.value);
  streams = laneDraw.nextStreams;

  const guaranteedPathNodeIds = backboneLanes.map((lane, idx) => makeNodeId(idx + 1, lane));

  // 2. Assign node types per layer respecting all §5.1 invariants
  const nodeTypes: Record<string, V2NodeType> = {};
  const contractMarkers = new Set<string>();

  // Place contract markers directly along the guaranteed backbone path!
  for (const targetLayer of tpl.targetLayers) {
    if (targetLayer >= 1 && targetLayer <= maxLayers) {
      contractMarkers.add(guaranteedPathNodeIds[targetLayer - 1]);
    }
  }

  // Decide merchant layer (2..4) and support-guarantee layer (2..4) deterministically
  const planDraw = withV2Stream(streams, 'map', (rng) => {
    const merchantLayer = maxLayers >= 4 ? 2 + rng.nextInt(3) : Math.min(2, maxLayers);
    // Support guarantee placed on guaranteed path in layer 2..4 (prefer a non-merchant layer so it is free & always affordable!)
    const candidateSupportLayers = [2, 3, 4].filter(
      (l) => l <= maxLayers && l !== merchantLayer
    );
    const supportLayer =
      candidateSupportLayers.length > 0
        ? rng.pick(candidateSupportLayers)
        : Math.min(2, maxLayers);

    const layerAssignments: Record<string, V2NodeType> = {};
    const nonCombatPool: readonly V2NodeType[] = ['wreck', 'anomaly', 'distress'];

    for (let layer = 1; layer <= maxLayers; layer++) {
      const idA = makeNodeId(layer, 0);
      const idB = makeNodeId(layer, 1);
      const gLane = backboneLanes[layer - 1];
      const gId = makeNodeId(layer, gLane);
      const oId = makeNodeId(layer, (1 - gLane) as 0 | 1);

      if (layer === 1) {
        // §5.1: Layer 1 fixed 1 wreck + 1 light combat
        const wreckOnGuaranteed = rng.nextInt(2) === 0;
        layerAssignments[gId] = wreckOnGuaranteed ? 'wreck' : 'combat';
        layerAssignments[oId] = wreckOnGuaranteed ? 'combat' : 'wreck';
      } else if (layer === maxLayers && maxLayers >= 6) {
        // §5.1: Layer 6 fixed 1 elite + 1 non-combat ending
        // Keep survey_deep's Layer 6 marker on the non-combat node so elite is never forced!
        const nonCombatType = rng.pick(nonCombatPool);
        if (contractMarkers.has(gId)) {
          layerAssignments[gId] = nonCombatType;
          layerAssignments[oId] = 'elite';
        } else {
          const eliteOnG = rng.nextInt(2) === 0;
          layerAssignments[gId] = eliteOnG ? 'elite' : nonCombatType;
          layerAssignments[oId] = eliteOnG ? nonCombatType : 'elite';
        }
      } else if (layer === merchantLayer) {
        // Guaranteed reachable merchant in Layers 2..4
        const merchantOnG = !contractMarkers.has(gId) && rng.nextInt(3) !== 0;
        if (merchantOnG) {
          layerAssignments[gId] = 'merchant';
          layerAssignments[oId] = 'combat';
        } else {
          // Put merchant on the sibling lane (still reachable via edges from layer-1!)
          layerAssignments[gId] =
            layer === supportLayer
              ? rng.nextInt(2) === 0
                ? 'wreck'
                : 'combat'
              : 'combat';
          layerAssignments[oId] = 'merchant';
        }
      } else if (layer === supportLayer) {
        // Guarantee support item on guaranteed path via wreck or combat (0 cost, 100% affordable!)
        const useWreck = rng.nextInt(2) === 0;
        layerAssignments[gId] = useWreck ? 'wreck' : 'combat';
        layerAssignments[oId] = useWreck ? 'combat' : rng.pick(nonCombatPool);
      } else {
        // Mixed layers: never create 2+ consecutive mandatory-combat layers; at least one branch is non-combat
        const gIsCombat = rng.nextInt(3) !== 0;
        const otherType = gIsCombat ? rng.pick(nonCombatPool) : 'combat';
        layerAssignments[gId] = gIsCombat ? 'combat' : rng.pick(nonCombatPool);
        layerAssignments[oId] = otherType;
      }

      // Sanity safeguard for idA/idB assignment
      if (!layerAssignments[idA]) layerAssignments[idA] = 'combat';
      if (!layerAssignments[idB]) layerAssignments[idB] = 'wreck';
    }

    return { layerAssignments, merchantLayer, supportLayer };
  });

  Object.assign(nodeTypes, planDraw.value.layerAssignments);
  const supportNodeId = guaranteedPathNodeIds[planDraw.value.supportLayer - 1];
  streams = planDraw.nextStreams;

  // 3. Build directed edges between layers (always forward, prefer 2 edges, guarantee full reachability)
  const edges: Record<string, string[]> = {};
  const edgeDraw = withV2Stream(streams, 'map', (rng) => {
    const out: Record<string, string[]> = {};
    for (let layer = 1; layer < maxLayers; layer++) {
      const idA = makeNodeId(layer, 0);
      const idB = makeNodeId(layer, 1);
      const nextA = makeNodeId(layer + 1, 0);
      const nextB = makeNodeId(layer + 1, 1);
      const gCur = guaranteedPathNodeIds[layer - 1];
      const gNext = guaranteedPathNodeIds[layer];

      const setA = new Set<string>();
      const setB = new Set<string>();

      // Always include guaranteed backbone edge
      if (gCur === idA) setA.add(gNext);
      else setB.add(gNext);

      // Prefer 2 outgoing edges (~75% dual-branching), always ensure >=1 out-edge and >=1 in-edge for both nodes
      setA.add(nextA);
      setB.add(nextB);
      if (rng.nextFloat() < 0.72) setA.add(nextB);
      if (rng.nextFloat() < 0.72) setB.add(nextA);

      // Ensure merchant node in next layer is reachable from guaranteed backbone node!
      const nextMerchant =
        nodeTypes[nextA] === 'merchant'
          ? nextA
          : nodeTypes[nextB] === 'merchant'
          ? nextB
          : null;
      if (nextMerchant) {
        if (gCur === idA) setA.add(nextMerchant);
        else setB.add(nextMerchant);
      }

      out[idA] = Array.from(setA).sort();
      out[idB] = Array.from(setB).sort();
    }
    out[makeNodeId(maxLayers, 0)] = [];
    out[makeNodeId(maxLayers, 1)] = [];
    return out;
  });
  Object.assign(edges, edgeDraw.value);
  streams = edgeDraw.nextStreams;

  // 4. Populate each node's concrete deterministic payload using its dedicated named PRNG stream!
  const nodes: Record<string, V2MapNode> = {};
  let itemSeq = 1;
  const nextUid = (prefix: string) => `${params.runId}_${prefix}_${itemSeq++}`;

  for (let layer = 1; layer <= maxLayers; layer++) {
    const sectorBg = LAYER_SECTOR_BGS[Math.min(LAYER_SECTOR_BGS.length - 1, layer - 1)];
    for (const lane of [0, 1] as const) {
      const nodeId = makeNodeId(layer, lane);
      const type = nodeTypes[nodeId];
      const isSupportNode = nodeId === supportNodeId;
      const isMarker = contractMarkers.has(nodeId);

      let combat: V2CombatPayload | undefined;
      let wreck: V2WreckPayload | undefined;
      let merchant: V2MerchantPayload | undefined;
      let anomaly: V2AnomalyPayload | undefined;
      let distress: V2DistressPayload | undefined;

      if (type === 'combat' || type === 'elite') {
        const res = withV2Stream(streams, 'enemies', (rng) => {
          const encounterKind: V2EncounterKind =
            type === 'elite'
              ? 'elite'
              : layer === 1
              ? 'patrol'
              : rng.pick(REGULAR_ENCOUNTER_KINDS);
          const useLeviathan = type === 'elite' && rng.nextInt(2) === 1;
          const units = buildEncounterUnits(encounterKind, layer, nodeId, useLeviathan);
          const payload: V2CombatPayload = {
            encounterKind,
            units,
            bounty: getEncounterBounty(encounterKind, layer),
            improvedProb: getEncounterImprovedProb(encounterKind, layer, params.allowImproved),
            guaranteedSupportKind: isSupportNode ? supportKind : undefined,
          };
          return payload;
        });
        combat = res.value;
        streams = res.nextStreams;
      } else if (type === 'wreck') {
        const res = withV2Stream(streams, 'events', (rng) => {
          const eqKind: V2EquipmentKind = isSupportNode
            ? supportKind
            : rng.pick(unlockedKinds);
          const eqQuality = rollQuality(rng, layer, false, params.allowImproved);
          const armoryItem = createV2EquipmentInstance({
            instanceId: nextUid('wrk_eq'),
            kind: eqKind,
            quality: eqQuality,
            origin: 'loot',
            acquiredDepth: layer,
            location: 'staging',
          });
          const cargoDef1 = pickCargoDefId(rng, layer, false);
          const cargoDef2 = pickCargoDefId(rng, layer, false);
          const c1 = createV2CargoInstance({
            instanceId: nextUid('wrk_cg'),
            defId: cargoDef1,
            origin: 'loot',
            acquiredDepth: layer,
            location: 'staging',
          });
          const c2 = createV2CargoInstance({
            instanceId: nextUid('wrk_cg'),
            defId: cargoDef2,
            origin: 'loot',
            acquiredDepth: layer,
            location: 'staging',
          });
          const eqDef = getV2EquipmentDefByKind(eqKind, eqQuality);
          const eqCells = V2_SHAPES[eqDef.shapeId].cells.length;
          const payload: V2WreckPayload = {
            armoryItem,
            cargoItems: [c1, c2],
            armorySizeRange: `${eqCells} 格设备`,
            armoryValueRange: `回收 ${armoryItem.fixedValue}¤`,
            cargoSizeRange: `2 件（单件 ${sizeRangeLabel([c1, c2])}）`,
            cargoValueRange: `合计 ${c1.fixedValue + c2.fixedValue}¤（${valueRangeLabel([c1, c2])}）`,
            reactorFuelGain: 2,
            reactorRepairGain: 8,
            chosenRoom: null,
          };
          return payload;
        });
        wreck = res.value;
        streams = res.nextStreams;
      } else if (type === 'merchant') {
        const res = withV2Stream(streams, 'shop', (rng) => {
          const offerKind1: V2EquipmentKind = isSupportNode
            ? supportKind
            : rng.pick(unlockedKinds);
          const otherPool = unlockedKinds.filter((k) => k !== offerKind1);
          const offerKind2: V2EquipmentKind =
            otherPool.length > 0 ? rng.pick(otherPool) : offerKind1;
          const q1 = isSupportNode ? 'common' : rollQuality(rng, layer, false, params.allowImproved);
          const q2 = rollQuality(rng, layer, false, params.allowImproved);

          const makeOffer = (idx: number, kind: V2EquipmentKind, quality: V2Quality): V2ShopEquipmentOffer => {
            const def = getV2EquipmentDefByKind(kind, quality);
            const item = createV2EquipmentInstance({
              instanceId: nextUid(`shop_${idx}`),
              kind,
              quality,
              origin: 'loot',
              acquiredDepth: layer,
              location: 'staging',
            });
            return {
              offerId: `${nodeId}_offer_${idx}`,
              item,
              buyPrice: def.shopBuyPrice,
              sold: false,
            };
          };

          const payload: V2MerchantPayload = {
            offers: [makeOffer(1, offerKind1, q1), makeOffer(2, offerKind2, q2)],
            fuelPrice: 12,
            fuelAmount: 2,
            fuelBought: false,
            repairPrice: 15,
            repairAmount: 10,
            repairBought: false,
          };
          return payload;
        });
        merchant = res.value;
        streams = res.nextStreams;
      } else if (type === 'anomaly') {
        const res = withV2Stream(streams, 'events', (rng) => {
          const defId = pickCargoDefId(rng, layer, layer >= 4);
          const def = V2_CARGO_DEFS[defId];
          const safeCargoItem = createV2CargoInstance({
            instanceId: nextUid('anom_safe'),
            defId,
            origin: 'loot',
            acquiredDepth: layer,
            location: 'staging',
          });
          const breach1 = createV2CargoInstance({
            instanceId: nextUid('anom_b1'),
            defId,
            origin: 'loot',
            acquiredDepth: layer,
            location: 'staging',
          });
          const breach2 = createV2CargoInstance({
            instanceId: nextUid('anom_b2'),
            defId,
            origin: 'loot',
            acquiredDepth: layer,
            location: 'staging',
          });
          const payload: V2AnomalyPayload = {
            cargoCategoryLabel: `${def.name}（${V2_SHAPES[def.shapeId].label} · 单件 ${computeV2CargoPrice(defId, layer)}¤）`,
            safeFuelCost: 1,
            safeCargoItem,
            breachHpCost: 4,
            breachCargoItems: [breach1, breach2],
            chosenOption: null,
          };
          return payload;
        });
        anomaly = res.value;
        streams = res.nextStreams;
      } else if (type === 'distress') {
        const res = withV2Stream(streams, 'events', (rng) => {
          const defId = pickCargoDefId(rng, layer, false);
          const haulCargoItem = createV2CargoInstance({
            instanceId: nextUid('dist_cg'),
            defId,
            origin: 'loot',
            acquiredDepth: layer,
            location: 'staging',
          });
          const payload: V2DistressPayload = {
            rescueFuelCost: 1,
            repairAmount: 10,
            haulCargoItem,
            chosenOption: null,
          };
          return payload;
        });
        distress = res.value;
        streams = res.nextStreams;
      }

      nodes[nodeId] = {
        nodeId,
        layer,
        lane,
        type,
        sectorBg,
        nextNodeIds: edges[nodeId] ?? [],
        contractMarker: isMarker,
        hasSupportGuarantee: isSupportNode,
        combat,
        wreck,
        merchant,
        anomaly,
        distress,
        resolved: false,
      };
    }
  }

  const graph: V2StarGraph = {
    maxLayers,
    startNextNodeIds: [makeNodeId(1, 0), makeNodeId(1, 1)],
    nodes,
    guaranteedPathNodeIds,
  };

  return {
    graph,
    markedNodeIds: Array.from(contractMarkers).sort(),
    nextStreams: streams,
  };
}

export interface GraphInvariantReport {
  readonly ok: boolean;
  readonly violations: readonly string[];
}

/**
 * Exhaustive invariant verifier for AC05 (used across 1000+ seeds in Vitest!).
 */
export function verifyV2GraphInvariants(
  graph: V2StarGraph,
  contract: V2ContractInstance,
  primaryArchetype: V2ArchetypeId
): GraphInvariantReport {
  const violations: string[] = [];
  const supportKind = V2_ARCHETYPE_SUPPORT_PART[primaryArchetype];

  // 1. BFS reachability from START
  const reachable = new Set<string>();
  const queue = [...graph.startNextNodeIds];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (reachable.has(cur)) continue;
    const node = graph.nodes[cur];
    if (!node) {
      violations.push(`Missing node referenced by edge: ${cur}`);
      continue;
    }
    reachable.add(cur);
    for (const nxt of node.nextNodeIds) {
      const target = graph.nodes[nxt];
      if (!target || target.layer !== node.layer + 1) {
        violations.push(`Invalid forward edge ${cur} -> ${nxt}`);
      } else {
        queue.push(nxt);
      }
    }
  }

  for (const node of Object.values(graph.nodes)) {
    if (!reachable.has(node.nodeId)) {
      violations.push(`Unreachable node: ${node.nodeId}`);
    }
    if (node.layer < graph.maxLayers && node.nextNodeIds.length === 0) {
      violations.push(`Dead-end non-terminal node: ${node.nodeId}`);
    }
  }

  // 2. Layer 1 invariant: 1 wreck + 1 combat (patrol)
  const l1 = [graph.nodes['L1A'], graph.nodes['L1B']].filter(Boolean);
  const l1Wrecks = l1.filter((n) => n.type === 'wreck').length;
  const l1Combats = l1.filter((n) => n.type === 'combat' && n.combat?.encounterKind === 'patrol').length;
  if (l1Wrecks !== 1 || l1Combats !== 1) {
    violations.push(`Layer 1 must have 1 wreck + 1 patrol combat (got wreck=${l1Wrecks}, patrol=${l1Combats})`);
  }

  // 3. Layer 6 invariant: 1 elite + 1 non-combat
  if (graph.maxLayers >= 6) {
    const l6 = [graph.nodes['L6A'], graph.nodes['L6B']].filter(Boolean);
    const elites = l6.filter((n) => n.type === 'elite').length;
    const nonCombats = l6.filter((n) => n.type !== 'combat' && n.type !== 'elite').length;
    if (elites !== 1 || nonCombats !== 1) {
      violations.push(`Layer 6 must have 1 elite + 1 non-combat (got elite=${elites}, nonCombat=${nonCombats})`);
    }
  }

  // 4. Event distribution: >=2 non-combat layers, >=1 reachable merchant in L2..L4, max 2 consecutive mandatory-combat layers
  let nonCombatLayers = 0;
  let consecutiveMandatoryCombat = 0;
  let merchantInMid = false;
  let supportReachable = false;

  for (let layer = 1; layer <= graph.maxLayers; layer++) {
    const a = graph.nodes[makeNodeId(layer, 0)];
    const b = graph.nodes[makeNodeId(layer, 1)];
    const pair = [a, b].filter(Boolean);
    const hasNonCombat = pair.some((n) => n.type !== 'combat' && n.type !== 'elite');
    if (hasNonCombat) {
      nonCombatLayers += 1;
      consecutiveMandatoryCombat = 0;
    } else {
      consecutiveMandatoryCombat += 1;
      if (consecutiveMandatoryCombat > 2) {
        violations.push(`>2 consecutive mandatory-combat layers ending at Layer ${layer}`);
      }
    }
    if (layer >= 2 && layer <= 4) {
      for (const n of pair) {
        if (reachable.has(n.nodeId) && n.type === 'merchant') merchantInMid = true;
        if (reachable.has(n.nodeId)) {
          if (n.type === 'wreck' && n.wreck?.armoryItem.definitionId === `equipment.${supportKind}.common`) {
            supportReachable = true;
          }
          if (n.type === 'wreck' && n.wreck?.armoryItem.definitionId === `equipment.${supportKind}.improved`) {
            supportReachable = true;
          }
          if (n.type === 'combat' && n.combat?.guaranteedSupportKind === supportKind) {
            supportReachable = true;
          }
          if (
            n.type === 'merchant' &&
            n.merchant?.offers.some((o) => o.item.definitionId.startsWith(`equipment.${supportKind}.`))
          ) {
            supportReachable = true;
          }
        }
      }
    }
  }

  if (nonCombatLayers < 2) violations.push(`Need >=2 non-combat layers, got ${nonCombatLayers}`);
  if (graph.maxLayers >= 4 && !merchantInMid) violations.push('No reachable merchant in Layers 2..4');
  if (graph.maxLayers >= 4 && !supportReachable) {
    violations.push(`No reachable archetype support part (${supportKind}) in Layers 2..4`);
  }

  // 5. Guaranteed connected path covering ALL required contract objectives within starting fuel (9)
  const gPath = graph.guaranteedPathNodeIds;
  for (let i = 0; i < gPath.length - 1; i++) {
    const cur = graph.nodes[gPath[i]];
    if (!cur || !cur.nextNodeIds.includes(gPath[i + 1])) {
      violations.push(`Guaranteed path disconnected between ${gPath[i]} and ${gPath[i + 1]}`);
    }
  }
  const markersOnGuaranteed = gPath.filter((id) => graph.nodes[id]?.contractMarker);
  if (contract.type !== 'free' && markersOnGuaranteed.length < contract.requiredCompletions) {
    violations.push(
      `Guaranteed path only covers ${markersOnGuaranteed.length}/${contract.requiredCompletions} required contract markers`
    );
  }
  // Compute minimum fuel along guaranteed path to finish contract
  if (contract.type !== 'free' && markersOnGuaranteed.length >= contract.requiredCompletions) {
    const lastNeededMarkerId = markersOnGuaranteed[contract.requiredCompletions - 1];
    const lastLayer = graph.nodes[lastNeededMarkerId].layer;
    const travelFuel = lastLayer; // 1 fuel per jump up to lastLayer (rescue pods only affect AFTER pickup, free return at lastLayer!)
    const surveyFuel = contract.type === 'survey' ? contract.requiredCompletions * contract.surveyFuelCost : 0;
    const totalNeededFuel = travelFuel + surveyFuel;
    if (totalNeededFuel > V2_STARTING_FUEL) {
      violations.push(
        `Guaranteed contract path requires ${totalNeededFuel} fuel > starting fuel ${V2_STARTING_FUEL}`
      );
    }
  }

  return { ok: violations.length === 0, violations };
}
