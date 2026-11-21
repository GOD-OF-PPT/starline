import { V2_CARGO_DEFS, computeV2CargoPrice, type V2CargoDef } from '../data/cargo';
import {
  V2_EQUIPMENT_DEFS,
  type V2EquipmentDef,
  type V2EquipmentKind,
  type V2Quality,
} from '../data/equipment';
import type { V2ShapeId } from '../data/shapes';
import type { V2ItemInstance, V2ItemLocation, V2ItemOrigin } from './types';

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

export function getAnyV2ItemDef(defId: string): V2UnifiedItemDef | undefined {
  const eq = V2_EQUIPMENT_DEFS[defId];
  if (eq) {
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
  const cg = V2_CARGO_DEFS[defId];
  if (cg) {
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
  const def = V2_EQUIPMENT_DEFS[`equipment.${params.kind}.${params.quality}`];
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
  const def = V2_CARGO_DEFS[params.defId];
  if (!def) {
    throw new Error(`Unknown V2 cargo defId: ${params.defId}`);
  }
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
