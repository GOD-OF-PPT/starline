import { createRandomSeed } from '../../domain/rng';
import { V2_CONTRACT_TEMPLATES } from '../data/contracts';
import type { V2CrewId } from '../data/crew';
import {
  V2_EQUIPMENT_DEFS,
  getEffectiveV2EquipmentBudgetCost,
  type V2ArchetypeId,
  type V2EquipmentKind,
} from '../data/equipment';
import { V3_SECTORS, getV3SectorDef } from '../data/sectors';
import type { V2Rotation } from '../data/shapes';
import { V2_SHIPS, type V2ShipId } from '../data/ships';
import { shouldTriggerRelicPitySignal } from './campaign';
import { createV2ContractInstance, generateContractBonusObjective } from './contracts';
import { getEffectiveShipLoadoutBudget, getEffectiveShipMaxHp } from './dismantle';
import {
  createEmptyV2Bay,
  findFirstLegalV2Placement,
  validateV2Placement,
} from './inventoryV2';
import { createV2EquipmentInstance } from './itemCatalog';
import { createV2RngStreams } from './rngStreams';
import { generateV2StarGraph } from './routeGenerator';
import { buildTrialPrepareSlots, isKindAuthorizedByTrialBuild } from '../data/trialBuilds';
import {
  V2_MAX_FUEL,
  V2_RULES_VERSION,
  V2_SCHEMA_VERSION,
  V2_STARTING_FUEL,
  type SectorId,
  type V2CargoBayState,
  type V2LoadoutPreset,
  type V2PlacedItem,
  type V2PresetSlot,
  type V2ProfileState,
  type V2RunState,
  type V2TrialBuildId,
} from './types';

export const V2_MAX_SAVED_PRESETS = 3;

export interface V2PrepareSlotEntry {
  readonly slotKey: string;
  readonly origin: 'loan' | 'owned';
  readonly definitionId: string;
  /** Required when origin === 'owned' (points to real instanceId in equipmentWarehouse) */
  readonly warehouseInstanceId?: string;
  readonly x: number;
  readonly y: number;
  readonly rotation: V2Rotation;
}

export interface V2PrepareValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly totalBudget: number;
  readonly maxBudget: number;
  readonly ownedInstancesUsed: readonly string[];
}

/**
 * Builds a guaranteed-free, budget-legal starter loadout using unlocked common blueprints
 * so even a bankrupt player (0 credits, 0 warehouse items) can ALWAYS launch (§6.1 & AC12).
 */
export function buildFreeFallbackPrepareSlots(
  shipId: V2ShipId,
  blueprints: readonly V2EquipmentKind[],
  budgetOverride?: number
): readonly V2PrepareSlotEntry[] {
  const ship = V2_SHIPS[shipId];
  const budget = budgetOverride ?? ship.loadoutBudget;
  let usedBudget = 0;
  let tempBay: V2CargoBayState = createEmptyV2Bay(shipId);
  const out: V2PrepareSlotEntry[] = [];

  // Default balanced free combo within ship budget:
  // cannon_skiff (6): laser(2) + battery(1) + shield(2) = 5 (or 2x laser + battery = 5)
  // shield_cruiser (6): laser(2) + battery(1) + shield(2) = 5
  // heavy_freighter (5): laser(2) + battery(1) + shield(2) = 5
  const desired: readonly V2EquipmentKind[] = ['laser', 'battery', 'shield'];
  let idx = 1;
  for (const kind of desired) {
    if (!blueprints.includes(kind)) continue;
    const def = V2_EQUIPMENT_DEFS[`equipment.${kind}.common`];
    if (!def || usedBudget + def.budgetCost > budget) continue;
    const spot = findFirstLegalV2Placement(tempBay, def.defId);
    if (!spot) continue;
    const dummy = createV2EquipmentInstance({
      instanceId: `prep_free_${idx}`,
      kind,
      quality: 'common',
      origin: 'loan',
      acquiredDepth: 0,
      location: 'bay',
    });
    tempBay = {
      ...tempBay,
      placed: [...tempBay.placed, { item: dummy, x: spot.x, y: spot.y, rotation: spot.rotation }],
    };
    out.push({
      slotKey: `free_${idx++}`,
      origin: 'loan',
      definitionId: def.defId,
      x: spot.x,
      y: spot.y,
      rotation: spot.rotation,
    });
    usedBudget += def.budgetCost;
  }

  return out;
}

export function validateV2PrepareLoadout(
  profile: V2ProfileState,
  shipId: V2ShipId,
  crewId: V2CrewId | null,
  slots: readonly V2PrepareSlotEntry[],
  trialBuildId: V2TrialBuildId | null = null,
  sectorId: SectorId = 'near_orbit'
): V2PrepareValidation {
  const errors: string[] = [];
  if (!Object.prototype.hasOwnProperty.call(V3_SECTORS, sectorId)) {
    errors.push(`未知目标星区「${String(sectorId)}」`);
  } else if (!profile.campaign.unlockedSectors.includes(sectorId)) {
    const sector = getV3SectorDef(sectorId);
    errors.push(`目标星区「${sector.name}」尚未解锁（${sector.unlockRequirementText}）`);
  }
  if (!profile.unlockedShips.includes(shipId)) {
    errors.push(`舰船 ${V2_SHIPS[shipId]?.name ?? shipId} 尚未解锁`);
  }
  if (crewId !== null && !profile.unlockedCrew.includes(crewId)) {
    errors.push('所选船员尚未解锁');
  }

  const maxBudget = getEffectiveShipLoadoutBudget(profile, shipId);
  let totalBudget = 0;
  const ownedUsedSet = new Set<string>();
  let tempBay = createEmptyV2Bay(shipId);

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const def = V2_EQUIPMENT_DEFS[slot.definitionId];
    if (!def) {
      errors.push(`槽位 ${i + 1} 设备定义无效`);
      continue;
    }
    totalBudget += getEffectiveV2EquipmentBudgetCost(def, slot.origin);

    if (slot.origin === 'loan') {
      if (def.quality !== 'common') {
        errors.push(`免费借用仅限普通品质（${def.name} 为优良）`);
      }
      if (trialBuildId !== null) {
        if (!isKindAuthorizedByTrialBuild(trialBuildId, def.kind)) {
          errors.push(`试航方案为整套借用，不可混入方案外设备「${def.name}」`);
        }
      } else if (!profile.blueprints.includes(def.kind)) {
        errors.push(`尚未解锁「${def.name}」普通蓝图，不可免费借用`);
      }
    } else {
      if (trialBuildId !== null) {
        errors.push(`试航方案为整套借用，不可与自有设备「${def.name}」混搭`);
      }
      if (!slot.warehouseInstanceId) {
        errors.push(`自有槽位 ${def.name} 缺少真实库存实例 ID`);
      } else {
        const real = profile.equipmentWarehouse.find(
          (w) => w.instanceId === slot.warehouseInstanceId
        );
        if (!real) {
          errors.push(`库存中缺少自有设备「${def.name}」`);
        } else if (real.definitionId !== slot.definitionId) {
          errors.push(`库存实例与槽位定义不匹配`);
        } else if (ownedUsedSet.has(real.instanceId)) {
          errors.push(`同一库存设备实例不可重复装配`);
        } else {
          ownedUsedSet.add(real.instanceId);
        }
      }
    }

    const chk = validateV2Placement(tempBay, slot.definitionId, slot.x, slot.y, slot.rotation);
    if (!chk.valid) {
      errors.push(`「${def.name}」放置非法（${chk.reason}）`);
    } else {
      const dummy = createV2EquipmentInstance({
        instanceId: `chk_${i}`,
        kind: def.kind,
        quality: def.quality,
        origin: slot.origin,
        acquiredDepth: 0,
        location: 'bay',
      });
      tempBay = {
        ...tempBay,
        placed: [...tempBay.placed, { item: dummy, x: slot.x, y: slot.y, rotation: slot.rotation }],
      };
    }
  }

  // Whole-kit integrity check when launching in Trial Mode (allows repositioning/rotating inside bay, forbids partial-kit mixing)
  if (trialBuildId !== null) {
    const expectedIds = buildTrialPrepareSlots(trialBuildId, shipId)
      .map((s) => s.definitionId)
      .sort();
    const actualIds = slots.map((s) => s.definitionId).sort();
    const exactMatch =
      expectedIds.length === actualIds.length &&
      expectedIds.every((id, idx) => id === actualIds[idx]);
    if (!exactMatch) {
      errors.push('试航方案必须保持整套配置完整（可在舱内拖动/旋转调整位置，切回自由配装后方可增删设备）');
    }
  }

  if (totalBudget > maxBudget) {
    errors.push(`开局装配预算超限：当前 ${totalBudget} / 上限 ${maxBudget}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    totalBudget,
    maxBudget,
    ownedInstancesUsed: Array.from(ownedUsedSet),
  };
}

/**
 * Atomically launches a V2 run (§14 & AC12):
 * - Re-validates budget, hull placements, ship/crew unlocks, and owned inventory existence
 * - Deducts brought `owned` equipment instances from `profile.equipmentWarehouse`
 * - Builds deterministic 6-layer DAG with persisted named PRNG streams
 */
export function launchV2Expedition(params: {
  readonly profile: V2ProfileState;
  readonly contractTemplateId: string;
  readonly shipId: V2ShipId;
  readonly crewId: V2CrewId | null;
  readonly primaryArchetype: V2ArchetypeId;
  readonly slots: readonly V2PrepareSlotEntry[];
  readonly trialBuildId?: V2TrialBuildId | null;
  readonly seed?: number;
  readonly allowImproved?: boolean;
  readonly maxLayers?: number;
  readonly sectorId?: SectorId;
  readonly endlessThreat?: number;
  readonly endlessMutatorIds?: readonly string[];
  readonly isFinalCampaignRun?: boolean;
}): {
  readonly ok: boolean;
  readonly profile: V2ProfileState;
  readonly run: V2RunState | null;
  readonly errors: readonly string[];
} {
  const trialBuildId = params.trialBuildId ?? null;
  const sectorId: SectorId = params.sectorId ?? 'near_orbit';
  const check = validateV2PrepareLoadout(
    params.profile,
    params.shipId,
    params.crewId,
    params.slots,
    trialBuildId,
    sectorId
  );
  if (!check.valid) {
    return { ok: false, profile: params.profile, run: null, errors: check.errors };
  }

  const tpl =
    V2_CONTRACT_TEMPLATES[params.contractTemplateId] ?? V2_CONTRACT_TEMPLATES.free_salvage;
  const seed = (params.seed ?? createRandomSeed()) >>> 0;
  const runId = `v2run_${seed.toString(36)}_${params.profile.totalRuns + 1}`;
  const streams = createV2RngStreams(seed);
  const pity = shouldTriggerRelicPitySignal(params.profile, sectorId);

  const generated = generateV2StarGraph({
    runId,
    contractTemplateId: tpl.templateId,
    primaryArchetype: params.primaryArchetype,
    unlockedFamilies: params.profile.unlockedFamilies,
    streams,
    allowImproved: params.allowImproved ?? true,
    maxLayers: params.maxLayers ?? 6,
    sectorId,
    endlessThreat: params.endlessThreat ?? 0,
    isFinalCampaignRun: Boolean(params.isFinalCampaignRun),
    guaranteedRelicDefId: pity.triggered ? pity.relicDefId : null,
  });

  const bonusObjective = generateContractBonusObjective(tpl, seed);
  const contract = createV2ContractInstance(
    tpl.templateId,
    generated.markedNodeIds,
    runId,
    bonusObjective
  );

  // Atomically move selected owned items from warehouse into run bay, and mint loan items
  const usedOwnedIds = new Set<string>(check.ownedInstancesUsed);
  const nextWarehouse = params.profile.equipmentWarehouse.filter(
    (w) => !usedOwnedIds.has(w.instanceId)
  );

  const placed: V2PlacedItem[] = [];
  let loanSeq = 1;
  for (const slot of params.slots) {
    const def = V2_EQUIPMENT_DEFS[slot.definitionId]!;
    if (slot.origin === 'owned' && slot.warehouseInstanceId) {
      const real = params.profile.equipmentWarehouse.find(
        (w) => w.instanceId === slot.warehouseInstanceId
      )!;
      placed.push({
        item: { ...real, origin: 'owned', location: 'bay' },
        x: slot.x,
        y: slot.y,
        rotation: slot.rotation,
      });
    } else {
      const loanItem = createV2EquipmentInstance({
        instanceId: `${runId}_loan_${loanSeq++}`,
        kind: def.kind,
        quality: 'common',
        origin: 'loan',
        acquiredDepth: 0,
        location: 'bay',
      });
      placed.push({
        item: loanItem,
        x: slot.x,
        y: slot.y,
        rotation: slot.rotation,
      });
    }
  }

  const effectiveMaxHp = getEffectiveShipMaxHp(params.profile, params.shipId);
  const crewMasteryTier = params.crewId
    ? Math.max(0, Math.min(2, Math.floor(params.profile.crewMastery[params.crewId] ?? 0)))
    : 0;
  const navigatorFuelBonus = params.crewId === 'navigator' && crewMasteryTier >= 1 ? 1 : 0;
  const startingFuel = Math.min(V2_MAX_FUEL, V2_STARTING_FUEL + navigatorFuelBonus);

  const run: V2RunState = {
    runId,
    schemaVersion: V2_SCHEMA_VERSION,
    rulesVersion: V2_RULES_VERSION,
    seed,
    rngStreams: generated.nextStreams,
    isTutorial: false,
    trialBuildId,
    allowImproved: params.allowImproved ?? true,
    contract,
    shipId: params.shipId,
    crewId: params.crewId,
    primaryArchetype: params.primaryArchetype,
    fuel: startingFuel,
    maxFuel: V2_MAX_FUEL,
    hp: effectiveMaxHp,
    maxHp: effectiveMaxHp,
    wallet: 0,
    graph: generated.graph,
    visitedNodeIds: [],
    currentNodeId: null,
    phase: 'MAP',
    bay: {
      shipId: params.shipId,
      placed,
      staging: [],
      discardedThisArrange: [],
    },
    targetPolicy: 'weakest',
    activeCombat: null,
    pendingReward: null,
    claimedEventIds: [],
    transactionIds: [],
    engineerSwapAvailable: params.crewId === 'engineer',
    activeEngineerOffer: null,
    navigatorFreeJumpUsed: false,
    settlementReason: null,
    sectorId,
    endlessThreat: params.endlessThreat ?? 0,
    endlessMutatorIds: params.endlessMutatorIds ? [...params.endlessMutatorIds] : [],
    recentEquipmentKinds: [],
    usedEventIds: [...generated.usedEventIds],
    ...(bonusObjective ? { bonusObjective } : {}),
    tacticalChargesMax: 1,
    tacticalChargesUsed: 0,
    salvagePartsEarned: 0,
    isFinalCampaignRun: Boolean(params.isFinalCampaignRun),
    crewMasteryTier,
    defeatedBossIdsThisRun: [],
    defeatedEnemyKindsThisRun: [],
    activeWreck: null,
    activeEvent: null,
    discardedCountThisRun: 0,
    wrecksDissectedThisRun: 0,
    factionRepEarnedThisRun: {},
  };

  const nextProfile: V2ProfileState = {
    ...params.profile,
    equipmentWarehouse: nextWarehouse,
    selectedShipId: params.shipId,
    selectedCrewId: params.crewId,
    selectedArchetype: params.primaryArchetype,
  };

  return { ok: true, profile: nextProfile, run, errors: [] };
}

// --- Loadout Presets (Max 3, never clones real instances, explicit missing-item warning, §6.3) ---

export function saveV2LoadoutPreset(
  profile: V2ProfileState,
  input: {
    readonly presetId?: string;
    readonly name: string;
    readonly shipId: V2ShipId;
    readonly crewId: V2CrewId | null;
    readonly primaryArchetype: V2ArchetypeId;
    readonly slots: readonly V2PrepareSlotEntry[];
  }
): { readonly ok: boolean; readonly profile: V2ProfileState; readonly error?: string } {
  const existingIdx = input.presetId
    ? profile.loadoutPresets.findIndex((p) => p.presetId === input.presetId)
    : -1;
  if (existingIdx < 0 && profile.loadoutPresets.length >= V2_MAX_SAVED_PRESETS) {
    return {
      ok: false,
      profile,
      error: `最多保存 ${V2_MAX_SAVED_PRESETS} 套配装预设，请先覆盖或删除旧预设`,
    };
  }

  const presetSlots: V2PresetSlot[] = input.slots.map((s) => {
    const def = V2_EQUIPMENT_DEFS[s.definitionId];
    return {
      definitionId: s.definitionId,
      quality: def?.quality ?? 'common',
      preferOrigin: s.origin,
      x: s.x,
      y: s.y,
      rotation: s.rotation,
    };
  });

  const record: V2LoadoutPreset = {
    presetId: input.presetId ?? `preset_${Date.now().toString(36)}`,
    name: input.name.trim() || `预设 ${profile.loadoutPresets.length + 1}`,
    shipId: input.shipId,
    crewId: input.crewId,
    primaryArchetype: input.primaryArchetype,
    slots: presetSlots,
    updatedAt: new Date().toISOString(),
  };

  const nextPresets =
    existingIdx >= 0
      ? profile.loadoutPresets.map((p, i) => (i === existingIdx ? record : p))
      : [...profile.loadoutPresets, record];

  return {
    ok: true,
    profile: { ...profile, loadoutPresets: nextPresets },
  };
}

export function deleteV2LoadoutPreset(
  profile: V2ProfileState,
  presetId: string
): V2ProfileState {
  return {
    ...profile,
    loadoutPresets: profile.loadoutPresets.filter((p) => p.presetId !== presetId),
  };
}

export interface V2ResolvedPresetSlot {
  readonly presetSlot: V2PresetSlot;
  readonly resolved: V2PrepareSlotEntry | null;
  readonly missingOwned: boolean;
  readonly canSubstituteCommonLoan: boolean;
}

/**
 * Resolves a saved preset against current warehouse WITHOUT silently substituting missing owned items (§6.3)!
 * Missing owned items are surfaced explicitly with optional user-confirmed common loan substitution.
 */
export function resolveV2PresetAgainstWarehouse(
  profile: V2ProfileState,
  preset: V2LoadoutPreset
): readonly V2ResolvedPresetSlot[] {
  const claimedOwnedIds = new Set<string>();
  return preset.slots.map((ps, idx) => {
    const def = V2_EQUIPMENT_DEFS[ps.definitionId];
    if (!def) {
      return {
        presetSlot: ps,
        resolved: null,
        missingOwned: true,
        canSubstituteCommonLoan: false,
      };
    }

    if (ps.preferOrigin === 'owned') {
      const match = profile.equipmentWarehouse.find(
        (w) => w.definitionId === ps.definitionId && !claimedOwnedIds.has(w.instanceId)
      );
      if (match) {
        claimedOwnedIds.add(match.instanceId);
        return {
          presetSlot: ps,
          resolved: {
            slotKey: `ps_${idx}`,
            origin: 'owned',
            definitionId: ps.definitionId,
            warehouseInstanceId: match.instanceId,
            x: ps.x,
            y: ps.y,
            rotation: ps.rotation,
          },
          missingOwned: false,
          canSubstituteCommonLoan: false,
        };
      }
      // Missing real owned instance -> do NOT auto-substitute! Report clearly!
      return {
        presetSlot: ps,
        resolved: null,
        missingOwned: true,
        canSubstituteCommonLoan: profile.blueprints.includes(def.kind),
      };
    }

    // Loan slot
    if (profile.blueprints.includes(def.kind) && def.quality === 'common') {
      return {
        presetSlot: ps,
        resolved: {
          slotKey: `ps_${idx}`,
          origin: 'loan',
          definitionId: ps.definitionId,
          x: ps.x,
          y: ps.y,
          rotation: ps.rotation,
        },
        missingOwned: false,
        canSubstituteCommonLoan: false,
      };
    }

    return {
      presetSlot: ps,
      resolved: null,
      missingOwned: true,
      canSubstituteCommonLoan: false,
    };
  });
}
