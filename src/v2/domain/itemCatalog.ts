import { V2_CARGO_DEFS, computeV2CargoPrice, type V2CargoDef } from '../data/cargo';
import {
  V2_EQUIPMENT_DEFS,
  getV2EquipmentDefByKind,
  type V2EquipmentDef,
  type V2EquipmentKind,
  type V2Quality,
} from '../data/equipment';
import type { V2ShapeId } from '../data/shapes';
import type {
  V2ItemInstance,
  V2ItemLocation,
  V2ItemOrigin,
  V2ProfileState,
  V2RunState,
} from './types';

export interface V2UnifiedItemDef {
  readonly defId: string;
  readonly category: 'equipment' | 'cargo' | 'mission';
  readonly name: string;
  readonly shortName: string;
  readonly shapeId: V2ShapeId;
  readonly quality: V2Quality;
  readonly summary: string;
  readonly isCollectible: boolean;
  readonly relicId?: string;
  readonly equipmentDef?: V2EquipmentDef;
  readonly cargoDef?: V2CargoDef;
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export function getAnyV2ItemDef(defId: string): V2UnifiedItemDef | undefined {
  if (typeof defId !== 'string') return undefined;
  if (hasOwn(V2_EQUIPMENT_DEFS, defId)) {
    const eq = V2_EQUIPMENT_DEFS[defId];
    return {
      defId: eq.defId,
      category: 'equipment',
      name: eq.name,
      shortName: eq.shortName,
      shapeId: eq.shapeId,
      quality: eq.quality,
      summary: eq.summary,
      isCollectible: false,
      equipmentDef: eq,
    };
  }
  if (hasOwn(V2_CARGO_DEFS, defId)) {
    const cg = V2_CARGO_DEFS[defId];
    return {
      defId: cg.defId,
      category: cg.isMissionItem ? 'mission' : 'cargo',
      name: cg.name,
      shortName: cg.shortName,
      shapeId: cg.shapeId,
      quality: 'common',
      summary: cg.summary,
      isCollectible: cg.isCollectible,
      relicId: cg.relicId,
      cargoDef: cg,
    };
  }
  return undefined;
}

export function createV2EquipmentInstance(params: {
  readonly instanceId: string;
  readonly kind: V2EquipmentKind;
  readonly quality: V2Quality;
  readonly origin: 'loan' | 'owned' | 'loot';
  readonly acquiredDepth: number;
  readonly location: V2ItemLocation;
}): V2ItemInstance {
  const key = `equipment.${params.kind}.${params.quality}`;
  if (!hasOwn(V2_EQUIPMENT_DEFS, key)) {
    throw new Error(`Unknown V2 equipment defId: ${key}`);
  }
  const def = V2_EQUIPMENT_DEFS[key];
  return {
    instanceId: params.instanceId,
    definitionId: def.defId,
    category: 'equipment',
    quality: params.quality,
    origin: params.origin,
    acquiredDepth: params.acquiredDepth,
    fixedValue: params.origin === 'loan' ? 0 : def.recycleValue,
    location: params.location,
  };
}

export function createV2CargoInstance(params: {
  readonly instanceId: string;
  readonly defId: string;
  readonly origin: 'loan' | 'loot' | 'mission';
  readonly acquiredDepth: number;
  readonly location: V2ItemLocation;
  readonly missionBinding?: string;
  readonly fixedValueOverride?: number;
}): V2ItemInstance {
  if (typeof params.defId !== 'string' || !hasOwn(V2_CARGO_DEFS, params.defId)) {
    throw new Error(`Unknown V2 cargo defId: ${String(params.defId)}`);
  }
  const def = V2_CARGO_DEFS[params.defId];
  const isMission = def.isMissionItem;
  const origin: V2ItemOrigin = isMission ? 'mission' : params.origin;
  const fixedValue =
    isMission || origin === 'loan'
      ? 0
      : params.fixedValueOverride ?? computeV2CargoPrice(params.defId, params.acquiredDepth);

  return {
    instanceId: params.instanceId,
    definitionId: def.defId,
    category: isMission ? 'mission' : 'cargo',
    quality: 'common',
    origin,
    acquiredDepth: params.acquiredDepth,
    fixedValue,
    missionBinding: params.missionBinding,
    location: params.location,
  };
}

/**
 * Purely records known item definition IDs into `profile.seenItems`.
 * Returns the exact original `profile` reference if no new valid defId is added.
 */
export function recordV2SeenItems(
  profile: V2ProfileState,
  defIds: readonly string[]
): V2ProfileState {
  if (defIds.length === 0) return profile;
  const existing = new Set(profile.seenItems);
  const additions: string[] = [];
  for (const id of defIds) {
    if (!existing.has(id) && getAnyV2ItemDef(id)) {
      existing.add(id);
      additions.push(id);
    }
  }
  if (additions.length === 0) return profile;
  return {
    ...profile,
    seenItems: [...profile.seenItems, ...additions],
  };
}

/**
 * Collects item definition IDs that are legitimately visible to the player in the current run state.
 * Respects fog-of-war: NEVER leaks unpeeked/uncut wreck contents when crewId !== 'salvager'.
 */
export function collectVisibleV2DefIdsForRun(run: V2RunState): readonly string[] {
  const seen = new Set<string>();

  for (const p of run.bay.placed) {
    seen.add(p.item.definitionId);
  }
  for (const s of run.bay.staging) {
    seen.add(s.item.definitionId);
  }

  if (run.pendingReward) {
    seen.add(run.pendingReward.equipmentOption.definitionId);
    seen.add(run.pendingReward.cargoOption.definitionId);
  }

  if (run.activeEngineerOffer && !run.activeEngineerOffer.used) {
    for (const kind of run.activeEngineerOffer.candidates) {
      seen.add(getV2EquipmentDefByKind(kind, 'common').defId);
    }
  }

  if (run.currentNodeId && hasOwn(run.graph.nodes, run.currentNodeId)) {
    const node = run.graph.nodes[run.currentNodeId];
    if (node) {
      if (node.merchant && (run.phase === 'SHOP' || node.resolved)) {
        for (const offer of node.merchant.offers) {
          seen.add(offer.item.definitionId);
        }
      }
      if (node.wreck) {
        if (run.crewId === 'salvager') {
          seen.add(node.wreck.armoryItem.definitionId);
          for (const cg of node.wreck.cargoItems) {
            seen.add(cg.definitionId);
          }
        } else if (node.wreck.chosenRoom === 'armory') {
          seen.add(node.wreck.armoryItem.definitionId);
        } else if (node.wreck.chosenRoom === 'cargo') {
          for (const cg of node.wreck.cargoItems) {
            seen.add(cg.definitionId);
          }
        }
      }
      if (node.anomaly && (run.phase === 'ENCOUNTER' || node.resolved)) {
        seen.add(node.anomaly.safeCargoItem.definitionId);
        if (node.anomaly.chosenOption === 'breach') {
          for (const cg of node.anomaly.breachCargoItems) {
            seen.add(cg.definitionId);
          }
        }
      }
      if (node.distress && (run.phase === 'ENCOUNTER' || node.resolved)) {
        seen.add(node.distress.haulCargoItem.definitionId);
      }
    }
  }

  return Array.from(seen);
}

