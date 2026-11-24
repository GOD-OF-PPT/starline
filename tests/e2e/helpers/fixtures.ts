import {
  ALL_V2_EQUIPMENT_KINDS,
  ALL_V3_EQUIPMENT_KINDS,
  BOSS_NAMES,
  ITEM_CATALOG,
  MAX_ENDLESS_THREAT,
  MAX_FUEL,
  RUN_HISTORY_MAX_ENTRIES,
  SHIP_SPECS,
  STARTING_FUEL,
  V1_RULES_VERSION,
  V1_SCHEMA_VERSION,
  V2_RULES_VERSION,
  V2_SCHEMA_VERSION,
  V3_RULES_VERSION,
  V3_SCHEMA_VERSION,
  WAREHOUSE_BASE_CAPACITY,
  getOccupiedCells,
} from './contracts';
import type {
  GameSettings,
  SectorId,
  V1SaveData,
  V2AnomalyPayload,
  V2CargoBayState,
  V2CargoItemInstance,
  V2CombatPayload,
  V2CombatRewardBundle,
  V2ContractBonusObjective,
  V2ContractInstance,
  V2ContractType,
  V2CrewId,
  V2DiscardedRecord,
  V2DistressPayload,
  V2EncounterKind,
  V2EnemyUnitSpec,
  V2ItemCategory,
  V2ItemLocation,
  V2ItemOrigin,
  V2MapGraph,
  V2MapNode,
  V2MerchantPayload,
  V2NodeType,
  V2PlacedCargoItem,
  V2ProfileState,
  V2Quality,
  V2RelicId,
  V2RelicProgress,
  V2RngStreams,
  V2Rotation,
  V2RunPhase,
  V2SaveData,
  V2StagingItem,
  V2WreckPayload,
  V3CampaignState,
  V3CareerStats,
  V3FacilityId,
  V3ProfileState,
  V3RunState,
  V3SaveData,
  V3ShipId,
} from './contracts';

const DEFAULT_SAVED_AT = '2026-11-23T00:00:00.000Z';
const VALID_ROTATIONS = new Set<number>([0, 1, 2, 3]);
const VALID_BLUEPRINTS = new Set<string>(ALL_V3_EQUIPMENT_KINDS);
const LAYER_SECTOR_BGS = [1, 2, 4, 5, 3, 6] as const;
const LAYER_COMBAT_BOUNTIES = [6, 10, 14, 20, 28, 40] as const;
const LAYER_IMPROVED_PROBS = [0.0, 0.0, 0.1, 0.15, 0.2, 0.25] as const;

let fixtureCounter = 1;

function nextId(prefix: string): string {
  const id = `${prefix}_${fixtureCounter}`;
  fixtureCounter += 1;
  return id;
}

export function createDefaultSettings(overrides?: Partial<GameSettings>): GameSettings {
  return {
    combatSpeed: 1,
    reducedMotion: false,
    lowQuality: false,
    sfxMuted: false,
    bgmMuted: false,
    ...overrides,
  };
}

export function createRngStreams(seed = 1001): V2RngStreams {
  const base = (Math.abs(Math.floor(seed)) >>> 0) || 1001;
  return {
    map: { seed: (base ^ 0x1a2b3c4d) >>> 0, draws: 0 },
    enemies: { seed: (base ^ 0x2b3c4d5e) >>> 0, draws: 0 },
    shop: { seed: (base ^ 0x3c4d5e6f) >>> 0, draws: 0 },
    events: { seed: (base ^ 0x4d5e6f70) >>> 0, draws: 0 },
    rewards: { seed: (base ^ 0x5e6f7081) >>> 0, draws: 0 },
  };
}

export function createDefaultRelics(
  overrides?: Partial<Record<V2RelicId, Partial<V2RelicProgress>>>,
): Record<V2RelicId, V2RelicProgress> {
  return {
    ancient_navigator: {
      storedCount: 0,
      restored: false,
      ...overrides?.ancient_navigator,
    },
    quantum_core: {
      storedCount: 0,
      restored: false,
      ...overrides?.quantum_core,
    },
    cryo_amber: {
      storedCount: 0,
      restored: false,
      ...overrides?.cryo_amber,
    },
    obsidian_crown: {
      storedCount: 0,
      restored: false,
      ...overrides?.obsidian_crown,
    },
  };
}

export interface CreateCargoItemOptions {
  instanceId?: string;
  definitionId: string;
  category?: V2ItemCategory;
  quality?: V2Quality;
  origin?: V2ItemOrigin;
  fixedValue?: number;
  acquiredDepth?: number;
  missionBinding?: string;
  location?: V2ItemLocation;
  locked?: boolean;
  skipValidation?: boolean;
}

export function createCargoItem(options: CreateCargoItemOptions): V2CargoItemInstance {
  const isMissionDef = options.definitionId.startsWith('mission.');
  const origin: V2ItemOrigin = options.origin ?? (isMissionDef ? 'mission' : 'owned');
  const catalogMeta = ITEM_CATALOG[options.definitionId];

  const defaultValue =
    origin === 'loan' || origin === 'mission'
      ? 0
      : (catalogMeta?.defaultValue ?? 10);

  const fixedValue = options.fixedValue ?? defaultValue;
  const acquiredDepth = options.acquiredDepth ?? 0;

  if (!options.skipValidation) {
    if (!catalogMeta) {
      throw new Error(
        `Fixture invariant violation: unknown definitionId "${options.definitionId}".`,
      );
    }
    if (isMissionDef && origin !== 'mission') {
      throw new Error(
        `Fixture invariant violation: mission definitionId "${options.definitionId}" must have origin "mission" (got "${origin}").`,
      );
    }
    if (!isMissionDef && origin === 'mission') {
      throw new Error(
        `Fixture invariant violation: origin "mission" requires a "mission.*" definitionId (got "${options.definitionId}").`,
      );
    }
    if ((origin === 'loan' || origin === 'mission') && fixedValue !== 0) {
      throw new Error(
        `Fixture invariant violation: origin "${origin}" requires fixedValue === 0 (got ${fixedValue}).`,
      );
    }
    if (!Number.isInteger(fixedValue) || fixedValue < 0) {
      throw new Error(
        `Fixture invariant violation: fixedValue must be non-negative integer (got ${fixedValue}).`,
      );
    }
    if (!Number.isInteger(acquiredDepth) || acquiredDepth < 0) {
      throw new Error(
        `Fixture invariant violation: acquiredDepth must be non-negative integer (got ${acquiredDepth}).`,
      );
    }
  }

  const derivedCategory: V2ItemCategory =
    options.category ??
    catalogMeta?.category ??
    (isMissionDef
      ? 'mission'
      : options.definitionId.startsWith('equipment.')
        ? 'equipment'
        : options.definitionId.startsWith('gadget.')
          ? 'gadget'
          : 'cargo');

  const derivedQuality: V2Quality =
    options.quality ?? (options.definitionId.endsWith('.improved') ? 'improved' : 'common');

  return {
    instanceId: options.instanceId ?? nextId('inst'),
    definitionId: options.definitionId,
    category: derivedCategory,
    quality: derivedQuality,
    origin,
    acquiredDepth,
    fixedValue,
    ...(options.missionBinding !== undefined ? { missionBinding: options.missionBinding } : {}),
    location: options.location ?? 'bay',
    ...(options.locked !== undefined ? { locked: options.locked } : {}),
  };
}

export function createStagingItem(
  item: V2CargoItemInstance,
  rotation: V2Rotation = 0,
): V2StagingItem {
  return {
    item: { ...item, location: 'staging' },
    rotation,
  };
}

export interface PlacedItemInput {
  item: V2CargoItemInstance;
  x: number;
  y: number;
  rotation?: V2Rotation;
}

export type StagingItemInput =
  | { item: V2CargoItemInstance; rotation?: V2Rotation }
  | V2CargoItemInstance;

export type DiscardedItemInput = V2DiscardedRecord | V2CargoItemInstance;

export interface CreateCargoBayOptions {
  shipId?: V3ShipId;
  placed?: PlacedItemInput[];
  staging?: StagingItemInput[];
  discardedThisArrange?: DiscardedItemInput[];
  skipValidation?: boolean;
}

function isStagingWrapper(
  entry: StagingItemInput,
): entry is { item: V2CargoItemInstance; rotation?: V2Rotation } {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    'item' in entry &&
    typeof (entry as { item?: unknown }).item === 'object' &&
    (entry as { item?: unknown }).item !== null
  );
}

function isDiscardedRecord(entry: DiscardedItemInput): entry is V2DiscardedRecord {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    'item' in entry &&
    'previousLocation' in entry
  );
}

function validateBayItem(
  item: V2CargoItemInstance,
  zone: 'placed' | 'staging' | 'discardedThisArrange',
  seenInstanceIds: Set<string>,
): void {
  if (!item || typeof item !== 'object') {
    throw new Error(`Fixture invariant violation: ${zone} item is not an object.`);
  }
  if (typeof item.instanceId !== 'string' || item.instanceId.length === 0) {
    throw new Error(`Fixture invariant violation: ${zone} item has invalid instanceId.`);
  }
  if (seenInstanceIds.has(item.instanceId)) {
    throw new Error(
      `Fixture invariant violation: duplicate instanceId "${item.instanceId}" across bay (${zone}).`,
    );
  }
  seenInstanceIds.add(item.instanceId);

  const meta = ITEM_CATALOG[item.definitionId];
  if (!meta) {
    throw new Error(
      `Fixture invariant violation: unknown definitionId "${item.definitionId}" in ${zone}.`,
    );
  }

  const isMissionDef = item.definitionId.startsWith('mission.');
  if (isMissionDef !== (item.origin === 'mission')) {
    throw new Error(
      `Fixture invariant violation: ${zone} mission coupling mismatch for "${item.definitionId}" / "${item.origin}".`,
    );
  }
  if (!Number.isInteger(item.fixedValue) || item.fixedValue < 0) {
    throw new Error(
      `Fixture invariant violation: ${zone} item "${item.instanceId}" has invalid fixedValue ${item.fixedValue}.`,
    );
  }
  if ((item.origin === 'loan' || item.origin === 'mission') && item.fixedValue !== 0) {
    throw new Error(
      `Fixture invariant violation: ${zone} item "${item.instanceId}" with origin "${item.origin}" must have fixedValue 0.`,
    );
  }
  if (!Number.isInteger(item.acquiredDepth) || item.acquiredDepth < 0) {
    throw new Error(
      `Fixture invariant violation: ${zone} item "${item.instanceId}" has invalid acquiredDepth ${item.acquiredDepth}.`,
    );
  }
}

export function validateCargoBayInvariant(bay: V2CargoBayState): void {
  const ship = SHIP_SPECS[bay.shipId];
  if (!ship) {
    throw new Error(`Fixture invariant violation: unknown shipId "${bay.shipId}".`);
  }

  const seenInstanceIds = new Set<string>();
  const disabledSet = new Set(ship.disabledCells.map((c) => `${c.x},${c.y}`));
  const occupiedMap = new Map<string, string>();

  for (const entry of bay.placed) {
    const { item, x, y, rotation } = entry;
    validateBayItem(item, 'placed', seenInstanceIds);

    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      throw new Error(
        `Fixture invariant violation: placed item "${item.instanceId}" has non-integer coords (${x},${y}).`,
      );
    }
    if (!VALID_ROTATIONS.has(rotation as number)) {
      throw new Error(
        `Fixture invariant violation: placed item "${item.instanceId}" has invalid rotation ${String(rotation)}.`,
      );
    }

    const meta = ITEM_CATALOG[item.definitionId];
    const cells = getOccupiedCells(meta.shapeId, x, y, rotation);
    for (const cell of cells) {
      if (cell.x < 0 || cell.x >= ship.cols || cell.y < 0 || cell.y >= ship.rows) {
        throw new Error(
          `Fixture invariant violation: item "${item.instanceId}" (${item.definitionId}) cell (${cell.x},${cell.y}) out of bounds for ${ship.id} (${ship.cols}x${ship.rows}).`,
        );
      }
      const key = `${cell.x},${cell.y}`;
      if (disabledSet.has(key)) {
        throw new Error(
          `Fixture invariant violation: item "${item.instanceId}" overlaps disabled bulkhead cell (${cell.x},${cell.y}) on ${ship.id}.`,
        );
      }
      const existing = occupiedMap.get(key);
      if (existing) {
        throw new Error(
          `Fixture invariant violation: overlap at (${cell.x},${cell.y}) between "${existing}" and "${item.instanceId}".`,
        );
      }
      occupiedMap.set(key, item.instanceId);
    }
  }

  for (const entry of bay.staging) {
    if (!entry || typeof entry !== 'object' || !('item' in entry)) {
      throw new Error('Fixture invariant violation: bay.staging entry must be { item, rotation }.');
    }
    validateBayItem(entry.item, 'staging', seenInstanceIds);
    if (!VALID_ROTATIONS.has(entry.rotation as number)) {
      throw new Error(
        `Fixture invariant violation: staging item "${entry.item.instanceId}" has invalid rotation ${String(entry.rotation)}.`,
      );
    }
  }

  for (const record of bay.discardedThisArrange) {
    if (!record || typeof record !== 'object' || !('item' in record) || !record.previousLocation) {
      throw new Error(
        'Fixture invariant violation: bay.discardedThisArrange entry must be { item, previousLocation }.',
      );
    }
    validateBayItem(record.item, 'discardedThisArrange', seenInstanceIds);
    if (!VALID_ROTATIONS.has(record.previousLocation.rotation as number)) {
      throw new Error(
        `Fixture invariant violation: discarded item "${record.item.instanceId}" has invalid previousLocation.rotation ${String(record.previousLocation.rotation)}.`,
      );
    }
    if (
      record.previousLocation.zone === 'grid' &&
      (!Number.isInteger(record.previousLocation.x) || !Number.isInteger(record.previousLocation.y))
    ) {
      throw new Error(
        `Fixture invariant violation: discarded item "${record.item.instanceId}" has non-integer previousLocation grid coords.`,
      );
    }
  }
}

export function createCargoBay(options: CreateCargoBayOptions = {}): V2CargoBayState {
  const shipId: V3ShipId = options.shipId ?? 'cannon_skiff';
  const placed: V2PlacedCargoItem[] = (options.placed ?? []).map((p) => ({
    item: { ...p.item, location: 'bay' },
    x: p.x,
    y: p.y,
    rotation: p.rotation ?? 0,
  }));

  const staging: V2StagingItem[] = (options.staging ?? []).map((entry) =>
    isStagingWrapper(entry)
      ? {
          item: { ...entry.item, location: 'staging' },
          rotation: entry.rotation ?? 0,
        }
      : {
          item: { ...entry, location: 'staging' },
          rotation: 0,
        },
  );

  const discardedThisArrange: V2DiscardedRecord[] = (options.discardedThisArrange ?? []).map(
    (entry) =>
      isDiscardedRecord(entry)
        ? {
            item: { ...entry.item },
            previousLocation: { ...entry.previousLocation },
          }
        : {
            item: { ...entry },
            previousLocation: { zone: 'staging', rotation: 0 },
          },
  );

  const bay: V2CargoBayState = {
    shipId,
    placed,
    staging,
    discardedThisArrange,
  };

  if (!options.skipValidation) {
    validateCargoBayInvariant(bay);
  }
  return bay;
}

export function createStarterCombatBay(shipId: V3ShipId = 'cannon_skiff'): V2CargoBayState {
  // Coordinates chosen to be strictly valid on all 4 ships (avoiding disabled cells on heavy_freighter and stargate_cruiser).
  const offsetX = shipId === 'stargate_cruiser' ? 1 : 0;
  const offsetY = shipId === 'stargate_cruiser' ? 1 : 0;
  return createCargoBay({
    shipId,
    placed: [
      {
        item: createCargoItem({
          instanceId: 'loan_laser_1',
          definitionId: 'equipment.laser.common',
          origin: 'loan',
        }),
        x: offsetX,
        y: offsetY,
        rotation: 0,
      },
      {
        item: createCargoItem({
          instanceId: 'loan_battery_1',
          definitionId: 'equipment.battery.common',
          origin: 'loan',
        }),
        x: offsetX + 1,
        y: offsetY,
        rotation: 0,
      },
      {
        item: createCargoItem({
          instanceId: 'loan_shield_1',
          definitionId: 'equipment.shield.common',
          origin: 'loan',
        }),
        x: offsetX + 2,
        y: offsetY,
        rotation: 0,
      },
    ],
  });
}

// ============================================================================
// Opaque-Box Node Payload Builders (Zero src/ Imports)
// ============================================================================

function getDepthScale(layer: number): number {
  if (layer <= 2) return 0.75;
  if (layer <= 4) return 1.0;
  return 1.25;
}

export function createCombatNodePayload(
  encounterKind: V2EncounterKind,
  layer: number,
  nodeId: string,
  bossId?: string,
): V2CombatPayload {
  const clampedLayer = Math.max(1, Math.min(6, Math.floor(layer)));
  const mult = getDepthScale(clampedLayer);
  const baseBounty = LAYER_COMBAT_BOUNTIES[clampedLayer - 1];
  const baseImprovedProb = LAYER_IMPROVED_PROBS[clampedLayer - 1];

  const scaleHp = (hp: number) => Math.max(1, Math.round(hp * mult));
  const scaleDmg = (dmg: number) => Math.max(1, Math.round(dmg * mult));

  let units: V2EnemyUnitSpec[];
  let extraBounty = 0;
  let improvedProb: number = baseImprovedProb;

  switch (encounterKind) {
    case 'swarm':
      units = [
        {
          enemyId: `${nodeId}_swarm_1`,
          name: '蜂群无人机 A',
          spriteArchetype: 'scout',
          maxHp: scaleHp(6),
          damagePerRound: clampedLayer >= 5 ? 2 : 1,
          armor: 0,
          pierceRatio: 0,
        },
        {
          enemyId: `${nodeId}_swarm_2`,
          name: '蜂群无人机 B',
          spriteArchetype: 'scout',
          maxHp: scaleHp(6),
          damagePerRound: clampedLayer >= 5 ? 2 : 1,
          armor: 0,
          pierceRatio: 0,
        },
        {
          enemyId: `${nodeId}_swarm_3`,
          name: '蜂群无人机 C',
          spriteArchetype: 'scout',
          maxHp: scaleHp(6),
          damagePerRound: 1,
          armor: 0,
          pierceRatio: 0,
        },
        {
          enemyId: `${nodeId}_swarm_4`,
          name: '蜂群无人机 D',
          spriteArchetype: 'scout',
          maxHp: scaleHp(6),
          damagePerRound: 1,
          armor: 0,
          pierceRatio: 0,
        },
      ];
      break;
    case 'armored':
      units = [
        {
          enemyId: `${nodeId}_armored_1`,
          name: '重装护卫艇',
          spriteArchetype: 'frigate',
          maxHp: scaleHp(28),
          damagePerRound: scaleDmg(3),
          armor: 2,
          pierceRatio: 0,
        },
      ];
      break;
    case 'piercer':
      units = [
        {
          enemyId: `${nodeId}_piercer_1`,
          name: '穿盾猎杀艇',
          spriteArchetype: 'interceptor',
          maxHp: scaleHp(22),
          damagePerRound: scaleDmg(4),
          armor: 0,
          pierceRatio: 0.5,
        },
      ];
      break;
    case 'artillery':
      units = [
        {
          enemyId: `${nodeId}_artillery_1`,
          name: '轨道火炮舰',
          spriteArchetype: 'frigate',
          maxHp: scaleHp(24),
          damagePerRound: scaleDmg(4),
          armor: 0,
          pierceRatio: 0,
        },
      ];
      break;
    case 'shield_regen':
      units = [
        {
          enemyId: `${nodeId}_shield_regen_1`,
          name: '自愈护盾舰',
          spriteArchetype: 'frigate',
          maxHp: scaleHp(24),
          damagePerRound: scaleDmg(3),
          armor: 1,
          pierceRatio: 0,
        },
      ];
      break;
    case 'drone_carrier':
      units = [
        {
          enemyId: `${nodeId}_carrier_1`,
          name: '无人机母舰',
          spriteArchetype: 'frigate',
          maxHp: scaleHp(26),
          damagePerRound: scaleDmg(2),
          armor: 1,
          pierceRatio: 0,
        },
        {
          enemyId: `${nodeId}_carrier_drone_1`,
          name: '护航机甲 A',
          spriteArchetype: 'scout',
          maxHp: scaleHp(5),
          damagePerRound: 1,
          armor: 0,
          pierceRatio: 0,
        },
        {
          enemyId: `${nodeId}_carrier_drone_2`,
          name: '护航机甲 B',
          spriteArchetype: 'scout',
          maxHp: scaleHp(5),
          damagePerRound: 1,
          armor: 0,
          pierceRatio: 0,
        },
      ];
      break;
    case 'emp_disruptor':
      units = [
        {
          enemyId: `${nodeId}_emp_1`,
          name: '电磁干扰舰',
          spriteArchetype: 'interceptor',
          maxHp: scaleHp(22),
          damagePerRound: scaleDmg(3),
          armor: 0,
          pierceRatio: 0.25,
        },
      ];
      break;
    case 'rammer':
      units = [
        {
          enemyId: `${nodeId}_rammer_1`,
          name: '冲撞突击艇',
          spriteArchetype: 'interceptor',
          maxHp: scaleHp(20),
          damagePerRound: scaleDmg(5),
          armor: 0,
          pierceRatio: 0,
        },
      ];
      break;
    case 'boss_anvil':
      extraBounty = 25;
      improvedProb = 0.4;
      units = [
        {
          enemyId: bossId ?? `${nodeId}_boss_anvil`,
          name: BOSS_NAMES.act1,
          spriteArchetype: 'boss_dreadnought',
          maxHp: 32,
          damagePerRound: 4,
          armor: 1,
          pierceRatio: 0,
          isBoss: true,
        },
        {
          enemyId: `${nodeId}_anvil_escort_1`,
          name: '护航截击机 A',
          spriteArchetype: 'interceptor',
          maxHp: 8,
          damagePerRound: 1,
          armor: 0,
          pierceRatio: 0,
        },
        {
          enemyId: `${nodeId}_anvil_escort_2`,
          name: '护航截击机 B',
          spriteArchetype: 'interceptor',
          maxHp: 8,
          damagePerRound: 1,
          armor: 0,
          pierceRatio: 0,
        },
      ];
      break;
    case 'boss_dreadnought':
      extraBounty = 35;
      improvedProb = 0.4;
      units = [
        {
          enemyId: bossId ?? `${nodeId}_boss_dreadnought`,
          name: BOSS_NAMES.act2,
          spriteArchetype: 'boss_dreadnought',
          maxHp: 44,
          damagePerRound: 5,
          armor: 2,
          pierceRatio: 0,
          isBoss: true,
        },
        {
          enemyId: `${nodeId}_dread_escort_1`,
          name: '冰原护航机 A',
          spriteArchetype: 'interceptor',
          maxHp: 10,
          damagePerRound: 1,
          armor: 0,
          pierceRatio: 0,
        },
        {
          enemyId: `${nodeId}_dread_escort_2`,
          name: '冰原护航机 B',
          spriteArchetype: 'interceptor',
          maxHp: 10,
          damagePerRound: 1,
          armor: 0,
          pierceRatio: 0,
        },
      ];
      break;
    case 'boss_leviathan':
      extraBounty = 50;
      improvedProb = 0.4;
      units = [
        {
          enemyId: bossId ?? `${nodeId}_boss_leviathan`,
          name: BOSS_NAMES.act3,
          spriteArchetype: 'boss_leviathan',
          maxHp: 56,
          damagePerRound: 6,
          armor: 2,
          pierceRatio: 0.25,
          isBoss: true,
        },
        {
          enemyId: `${nodeId}_lev_escort_1`,
          name: '黑曜守卫机 A',
          spriteArchetype: 'interceptor',
          maxHp: 12,
          damagePerRound: 2,
          armor: 0,
          pierceRatio: 0,
        },
        {
          enemyId: `${nodeId}_lev_escort_2`,
          name: '黑曜守卫机 B',
          spriteArchetype: 'interceptor',
          maxHp: 12,
          damagePerRound: 2,
          armor: 0,
          pierceRatio: 0,
        },
      ];
      break;
    case 'elite':
      extraBounty = 25;
      improvedProb = 0.4;
      units = [
        {
          enemyId: bossId ?? `${nodeId}_elite_flagship`,
          name: '铁壁旗舰护卫',
          spriteArchetype: 'boss_dreadnought',
          maxHp: 32,
          damagePerRound: 4,
          armor: 1,
          pierceRatio: 0,
          isBoss: true,
        },
        {
          enemyId: `${nodeId}_elite_escort_1`,
          name: '护航截击机 A',
          spriteArchetype: 'interceptor',
          maxHp: 8,
          damagePerRound: 1,
          armor: 0,
          pierceRatio: 0,
        },
        {
          enemyId: `${nodeId}_elite_escort_2`,
          name: '护航截击机 B',
          spriteArchetype: 'interceptor',
          maxHp: 8,
          damagePerRound: 1,
          armor: 0,
          pierceRatio: 0,
        },
      ];
      break;
    case 'patrol':
    default:
      units = [
        {
          enemyId: `${nodeId}_patrol_1`,
          name: '巡逻拾荒艇',
          spriteArchetype: 'scout',
          maxHp: scaleHp(20),
          damagePerRound: scaleDmg(3),
          armor: 0,
          pierceRatio: 0,
        },
      ];
      break;
  }

  return {
    encounterKind,
    units,
    bounty: baseBounty + extraBounty,
    improvedProb,
  };
}

export function createWreckNodePayload(nodeId: string, layer: number): V2WreckPayload {
  return {
    armoryItem: createCargoItem({
      instanceId: `${nodeId}_wreck_armory`,
      definitionId: 'equipment.laser.common',
      origin: 'loot',
      acquiredDepth: layer,
      location: 'staging',
    }),
    cargoItems: [
      createCargoItem({
        instanceId: `${nodeId}_wreck_cargo_1`,
        definitionId: 'cargo.alloy_bar',
        origin: 'loot',
        acquiredDepth: layer,
        location: 'staging',
      }),
      createCargoItem({
        instanceId: `${nodeId}_wreck_cargo_2`,
        definitionId: 'cargo.data_box',
        origin: 'loot',
        acquiredDepth: layer,
        location: 'staging',
      }),
    ],
    armorySizeRange: '1×2 ~ 2×2',
    armoryValueRange: '10~20¤',
    cargoSizeRange: '1×1 ~ 1×2',
    cargoValueRange: '15~30¤',
    reactorFuelGain: 2,
    reactorRepairGain: 8,
    chosenRoom: null,
  };
}

export function createMerchantNodePayload(nodeId: string, layer: number): V2MerchantPayload {
  return {
    offers: [
      {
        offerId: 'offer_1',
        item: createCargoItem({
          instanceId: `${nodeId}_offer_shield`,
          definitionId: 'equipment.shield.common',
          origin: 'loot',
          fixedValue: 10,
          acquiredDepth: layer,
          location: 'staging',
        }),
        buyPrice: 25,
        sold: false,
      },
      {
        offerId: 'offer_2',
        item: createCargoItem({
          instanceId: `${nodeId}_offer_battery`,
          definitionId: 'equipment.battery.common',
          origin: 'loot',
          fixedValue: 8,
          acquiredDepth: layer,
          location: 'staging',
        }),
        buyPrice: 20,
        sold: false,
      },
    ],
    fuelPrice: 12,
    fuelAmount: 2,
    fuelBought: false,
    repairPrice: 15,
    repairAmount: 10,
    repairBought: false,
  };
}

export function createAnomalyNodePayload(nodeId: string, layer: number): V2AnomalyPayload {
  return {
    cargoCategoryLabel: '精密零件',
    safeFuelCost: 1,
    safeCargoItem: createCargoItem({
      instanceId: `${nodeId}_anom_safe`,
      definitionId: 'cargo.alloy_bar',
      origin: 'loot',
      acquiredDepth: layer,
      location: 'staging',
    }),
    breachHpCost: 4,
    breachCargoItems: [
      createCargoItem({
        instanceId: `${nodeId}_anom_breach_1`,
        definitionId: 'cargo.coolant_tank',
        origin: 'loot',
        acquiredDepth: layer,
        location: 'staging',
      }),
      createCargoItem({
        instanceId: `${nodeId}_anom_breach_2`,
        definitionId: 'cargo.data_box',
        origin: 'loot',
        acquiredDepth: layer,
        location: 'staging',
      }),
    ],
    chosenOption: null,
  };
}

export function createDistressNodePayload(nodeId: string, layer: number): V2DistressPayload {
  return {
    rescueFuelCost: 1,
    repairAmount: 10,
    haulCargoItem: createCargoItem({
      instanceId: `${nodeId}_distress_haul`,
      definitionId: 'cargo.alloy_bar',
      origin: 'loot',
      acquiredDepth: layer,
      location: 'staging',
    }),
    chosenOption: null,
  };
}

export interface CreateMapGraphOptions {
  maxLayers?: number;
  nodeOverrides?: Partial<Record<string, Partial<V2MapNode>>>;
  bossKind?: V2EncounterKind;
  bossId?: string;
  layer6Type?: V2NodeType;
  skipDefaultPayloads?: boolean;
}

export function createMapGraph(options: CreateMapGraphOptions = {}): V2MapGraph {
  const maxLayers = options.maxLayers ?? 6;
  const nodes: Record<string, V2MapNode> = {};
  const guaranteedPathNodeIds: string[] = [];
  const layer6NodeType: V2NodeType = options.layer6Type ?? 'elite';

  const defaultLayerTypes: [V2NodeType, V2NodeType][] = [
    ['wreck', 'combat'],
    ['merchant', 'anomaly'],
    ['combat', 'distress'],
    ['wreck', 'combat'],
    ['merchant', 'elite'],
    [layer6NodeType, layer6NodeType],
  ];

  const buildNode = (
    nodeId: string,
    layer: number,
    lane: 0 | 1,
    defaultType: V2NodeType,
    nextIds: string[],
  ): V2MapNode => {
    const override = options.nodeOverrides?.[nodeId];
    const finalType: V2NodeType = override?.type ?? defaultType;
    const isFinalLayer = layer === maxLayers;
    const defaultEncounterKind: V2EncounterKind | undefined =
      finalType === 'combat'
        ? 'patrol'
        : finalType === 'elite' || finalType === 'boss'
          ? isFinalLayer
            ? (options.bossKind ?? 'elite')
            : 'elite'
          : undefined;
    const finalEncounterKind = override?.encounterKind ?? defaultEncounterKind;
    const finalBossId =
      override?.bossId ?? (isFinalLayer && options.bossId ? options.bossId : undefined);
    const sectorBg = LAYER_SECTOR_BGS[Math.min(5, Math.max(0, layer - 1))];

    const base: V2MapNode = {
      nodeId,
      layer,
      lane,
      type: finalType,
      sectorBg,
      nextNodeIds: [...nextIds],
      contractMarker: Boolean(override?.contractMarker ?? override?.isContractTarget ?? false),
      fuelCost: 1,
      visited: false,
      resolved: false,
      ...(finalEncounterKind ? { encounterKind: finalEncounterKind } : {}),
      ...(finalBossId ? { bossId: finalBossId } : {}),
    };

    const merged: V2MapNode = {
      ...base,
      ...override,
      nextNodeIds: override?.nextNodeIds ? [...override.nextNodeIds] : [...base.nextNodeIds],
      contractMarker: Boolean(override?.contractMarker ?? override?.isContractTarget ?? base.contractMarker),
    };

    if (!options.skipDefaultPayloads) {
      if (
        (merged.type === 'combat' || merged.type === 'elite' || merged.type === 'boss') &&
        (!override || !('combat' in override))
      ) {
        merged.combat = createCombatNodePayload(
          merged.encounterKind ?? (merged.type === 'combat' ? 'patrol' : 'elite'),
          layer,
          nodeId,
          merged.bossId,
        );
      } else if (merged.type === 'wreck' && (!override || !('wreck' in override))) {
        merged.wreck = createWreckNodePayload(nodeId, layer);
      } else if (merged.type === 'merchant' && (!override || !('merchant' in override))) {
        merged.merchant = createMerchantNodePayload(nodeId, layer);
      } else if (merged.type === 'anomaly' && (!override || !('anomaly' in override))) {
        merged.anomaly = createAnomalyNodePayload(nodeId, layer);
      } else if (merged.type === 'distress' && (!override || !('distress' in override))) {
        merged.distress = createDistressNodePayload(nodeId, layer);
      }
    }

    return merged;
  };

  for (let layer = 1; layer <= maxLayers; layer += 1) {
    const idA = `L${layer}A`;
    const idB = `L${layer}B`;
    const nextIds = layer < maxLayers ? [`L${layer + 1}A`, `L${layer + 1}B`] : [];
    const [typeA, typeB] = defaultLayerTypes[Math.min(layer - 1, defaultLayerTypes.length - 1)];

    nodes[idA] = buildNode(idA, layer, 0, typeA, nextIds);
    nodes[idB] = buildNode(idB, layer, 1, typeB, nextIds);
    guaranteedPathNodeIds.push(idA);
  }

  return {
    maxLayers,
    startNextNodeIds: ['L1A', 'L1B'],
    nodes,
    guaranteedPathNodeIds,
  };
}

export type ContractTemplateId =
  | 'transport_std'
  | 'rescue_std'
  | 'survey_std'
  | 'transport_deep'
  | 'rescue_deep'
  | 'survey_deep'
  | 'free_salvage'
  | 'bounty_std'
  | 'derelict_std';

export interface CreateContractOptions {
  runId?: string;
  bonusObjective?: V2ContractBonusObjective;
  overrides?: Partial<V2ContractInstance>;
}

export function createContractInstance(
  templateId: ContractTemplateId = 'transport_std',
  options: CreateContractOptions = {},
): V2ContractInstance {
  const runId = options.runId ?? 'run_fixture_1';
  const catalog: Record<
    ContractTemplateId,
    Omit<V2ContractInstance, 'contractId' | 'completedNodeIds' | 'status' | 'rewardClaimed'>
  > = {
    transport_std: {
      templateId: 'transport_std',
      type: 'transport' as V2ContractType,
      tier: 'standard',
      name: '标准大件运输：密封反应堆',
      rewardCredits: 70,
      markedNodeIds: ['L3A'],
      requiredCompletions: 1,
      missionItemDefId: 'mission.sealed_reactor',
      missionItemCount: 1,
      surveyFuelCost: 0,
      factionId: 'starport_guild',
      factionRepReward: 35,
      targetLayer: 3,
    },
    rescue_std: {
      templateId: 'rescue_std',
      type: 'rescue',
      tier: 'standard',
      name: '标准失联救援：营救工程师',
      rewardCredits: 70,
      markedNodeIds: ['L3B'],
      requiredCompletions: 1,
      missionItemDefId: 'mission.escape_pod',
      missionItemCount: 1,
      surveyFuelCost: 0,
      factionId: 'free_salvagers',
      factionRepReward: 35,
      targetLayer: 3,
    },
    survey_std: {
      templateId: 'survey_std',
      type: 'survey',
      tier: 'standard',
      name: '标准航迹勘测：三点选二',
      rewardCredits: 70,
      markedNodeIds: ['L2A', 'L3A', 'L4A'],
      requiredCompletions: 2,
      missionItemCount: 0,
      surveyFuelCost: 1,
      factionId: 'deep_institute',
      factionRepReward: 35,
      targetLayer: 4,
    },
    transport_deep: {
      templateId: 'transport_deep',
      type: 'transport',
      tier: 'deep',
      name: '深入大件运输：深层反应堆',
      rewardCredits: 120,
      markedNodeIds: ['L5A'],
      requiredCompletions: 1,
      missionItemDefId: 'mission.sealed_reactor',
      missionItemCount: 1,
      surveyFuelCost: 0,
      factionId: 'starport_guild',
      factionRepReward: 50,
      targetLayer: 5,
    },
    rescue_deep: {
      templateId: 'rescue_deep',
      type: 'rescue',
      tier: 'deep',
      name: '深入失联救援：双舱搜救行动',
      rewardCredits: 120,
      markedNodeIds: ['L5A'],
      requiredCompletions: 1,
      missionItemDefId: 'mission.escape_pod',
      missionItemCount: 2,
      surveyFuelCost: 0,
      factionId: 'free_salvagers',
      factionRepReward: 50,
      targetLayer: 5,
    },
    survey_deep: {
      templateId: 'survey_deep',
      type: 'survey',
      tier: 'deep',
      name: '深入航迹勘测：全段贯通测绘',
      rewardCredits: 120,
      markedNodeIds: ['L2A', 'L4A', 'L6A'],
      requiredCompletions: 3,
      missionItemCount: 0,
      surveyFuelCost: 1,
      factionId: 'deep_institute',
      factionRepReward: 50,
      targetLayer: 6,
    },
    free_salvage: {
      templateId: 'free_salvage',
      type: 'free',
      tier: 'free',
      name: '自由打捞航次',
      rewardCredits: 0,
      markedNodeIds: [],
      requiredCompletions: 0,
      missionItemCount: 0,
      surveyFuelCost: 0,
    },
    bounty_std: {
      templateId: 'bounty_std',
      type: 'bounty',
      tier: 'standard',
      name: '清剿悬赏：叛乱哨舰',
      rewardCredits: 85,
      markedNodeIds: ['L3A', 'L4B'],
      requiredCompletions: 1,
      missionItemCount: 0,
      surveyFuelCost: 0,
      factionId: 'starport_guild',
      factionRepReward: 40,
      targetLayer: 4,
    },
    derelict_std: {
      templateId: 'derelict_std',
      type: 'derelict',
      tier: 'standard',
      name: '黑匣打捞：遗失记录仪',
      rewardCredits: 85,
      markedNodeIds: ['L4A'],
      requiredCompletions: 1,
      missionItemDefId: 'mission.black_box',
      missionItemCount: 1,
      surveyFuelCost: 0,
      factionId: 'free_salvagers',
      factionRepReward: 40,
      targetLayer: 4,
    },
  };

  const base = catalog[templateId];
  return {
    contractId: `ct_${runId}_${templateId}`,
    ...base,
    markedNodeIds: [...base.markedNodeIds],
    completedNodeIds: [],
    status: 'active',
    rewardClaimed: false,
    ...(options.bonusObjective ? { bonusObjective: { ...options.bonusObjective } } : {}),
    ...options.overrides,
    ...(options.overrides?.markedNodeIds ? { markedNodeIds: [...options.overrides.markedNodeIds] } : {}),
    ...(options.overrides?.completedNodeIds
      ? { completedNodeIds: [...options.overrides.completedNodeIds] }
      : {}),
  };
}

export function validateV2ProfileInvariant(profile: V2ProfileState): void {
  if (!Number.isInteger(profile.credits) || profile.credits < 0) {
    throw new Error(
      `Fixture invariant violation: profile.credits must be a non-negative integer (got ${profile.credits}).`,
    );
  }

  if (!Array.isArray(profile.unlockedShips) || profile.unlockedShips.length === 0) {
    throw new Error('Fixture invariant violation: profile.unlockedShips cannot be empty.');
  }
  const seenShips = new Set<string>();
  for (const shipId of profile.unlockedShips) {
    if (!(shipId in SHIP_SPECS)) {
      throw new Error(`Fixture invariant violation: unknown unlockedShip "${String(shipId)}".`);
    }
    if (seenShips.has(shipId)) {
      throw new Error(`Fixture invariant violation: duplicate unlockedShip "${shipId}".`);
    }
    seenShips.add(shipId);
  }

  if (!Array.isArray(profile.blueprints)) {
    throw new Error('Fixture invariant violation: profile.blueprints must be an array.');
  }
  const seenBlueprints = new Set<string>();
  for (const bp of profile.blueprints) {
    if (!VALID_BLUEPRINTS.has(bp)) {
      throw new Error(`Fixture invariant violation: unknown blueprint "${String(bp)}".`);
    }
    if (seenBlueprints.has(bp)) {
      throw new Error(`Fixture invariant violation: duplicate blueprint "${bp}".`);
    }
    seenBlueprints.add(bp);
  }

  const warehouse = profile.equipmentWarehouse;
  if (!Array.isArray(warehouse)) {
    throw new Error('Fixture invariant violation: profile.equipmentWarehouse must be an array.');
  }
  if (warehouse.length > WAREHOUSE_BASE_CAPACITY) {
    throw new Error(`V2 warehouse cannot exceed ${WAREHOUSE_BASE_CAPACITY} items.`);
  }
  const seenWarehouseIds = new Set<string>();
  for (const item of warehouse) {
    if (item.origin === 'loan' || item.origin === 'mission') {
      throw new Error(`Warehouse item "${item.instanceId}" cannot have origin "${item.origin}".`);
    }
    if (!ITEM_CATALOG[item.definitionId]) {
      throw new Error(
        `Fixture invariant violation: warehouse item "${item.instanceId}" has unknown definitionId "${item.definitionId}".`,
      );
    }
    if (!Number.isInteger(item.fixedValue) || item.fixedValue < 0) {
      throw new Error(
        `Fixture invariant violation: warehouse item "${item.instanceId}" has invalid fixedValue ${item.fixedValue}.`,
      );
    }
    if (!Number.isInteger(item.acquiredDepth) || item.acquiredDepth < 0) {
      throw new Error(
        `Fixture invariant violation: warehouse item "${item.instanceId}" has invalid acquiredDepth ${item.acquiredDepth}.`,
      );
    }
    if (seenWarehouseIds.has(item.instanceId)) {
      throw new Error(
        `Fixture invariant violation: duplicate instanceId "${item.instanceId}" in equipmentWarehouse.`,
      );
    }
    seenWarehouseIds.add(item.instanceId);
  }
}

export function validateV3ProfileInvariant(profile: V3ProfileState): void {
  validateV2ProfileInvariant(profile);

  if (!Number.isInteger(profile.salvageParts) || profile.salvageParts < 0) {
    throw new Error(
      `Fixture invariant violation: profile.salvageParts must be a non-negative integer (got ${profile.salvageParts}).`,
    );
  }
  if (!Array.isArray(profile.runHistory)) {
    throw new Error('Fixture invariant violation: profile.runHistory must be an array.');
  }
  if (profile.runHistory.length > RUN_HISTORY_MAX_ENTRIES) {
    throw new Error(
      `Fixture invariant violation: profile.runHistory exceeds max ${RUN_HISTORY_MAX_ENTRIES} entries (got ${profile.runHistory.length}).`,
    );
  }
  if (
    !profile.campaign ||
    !Array.isArray(profile.campaign.unlockedSectors) ||
    profile.campaign.unlockedSectors.length === 0
  ) {
    throw new Error('Fixture invariant violation: profile.campaign.unlockedSectors cannot be empty.');
  }
  if (
    !Number.isInteger(profile.campaign.maxEndlessThreat) ||
    profile.campaign.maxEndlessThreat < 0 ||
    profile.campaign.maxEndlessThreat > MAX_ENDLESS_THREAT
  ) {
    throw new Error(
      `Fixture invariant violation: profile.campaign.maxEndlessThreat out of range 0..${MAX_ENDLESS_THREAT} (got ${profile.campaign.maxEndlessThreat}).`,
    );
  }
}

export function createV2ProfileFixture(
  overrides?: Partial<V2ProfileState>,
): V2ProfileState {
  const normalizedWarehouse = (overrides?.equipmentWarehouse ?? []).map((item) => ({
    ...item,
    location: 'warehouse' as const,
  }));

  const profile: V2ProfileState = {
    credits: 0,
    buildings: {
      workbench: false,
      contract_hub: false,
      drydock: false,
      research_lab: false,
      display: false,
      drydock_tier2: false,
      ...overrides?.buildings,
    },
    unlockedShips: overrides?.unlockedShips ? [...overrides.unlockedShips] : ['cannon_skiff'],
    unlockedCrew: overrides?.unlockedCrew ? [...overrides.unlockedCrew] : ['engineer'],
    unlockedFamilies: overrides?.unlockedFamilies ? [...overrides.unlockedFamilies] : ['core'],
    blueprints: overrides?.blueprints
      ? [...overrides.blueprints]
      : ['laser', 'battery', 'shield', 'repair'],
    equipmentWarehouse: normalizedWarehouse,
    pendingGiftQueue: overrides?.pendingGiftQueue
      ? overrides.pendingGiftQueue.map((item) => ({ ...item, location: 'gift_queue' as const }))
      : [],
    relics: createDefaultRelics(overrides?.relics),
    discoveredItems: overrides?.discoveredItems ? [...overrides.discoveredItems] : [],
    seenItems: overrides?.seenItems ? [...overrides.seenItems] : [],
    loadoutPresets: overrides?.loadoutPresets
      ? overrides.loadoutPresets.map((p) => ({
          ...p,
          slots: p.slots.map((s) => ({ ...s })),
        }))
      : [],
    completedContractTypes: overrides?.completedContractTypes
      ? [...overrides.completedContractTypes]
      : [],
    completedContractIds: overrides?.completedContractIds
      ? [...overrides.completedContractIds]
      : [],
    deepestLayerReached: overrides?.deepestLayerReached ?? 0,
    totalRuns: overrides?.totalRuns ?? 0,
    tutorialCompleted: overrides?.tutorialCompleted ?? false,
    tutorialBonusClaimed: overrides?.tutorialBonusClaimed ?? false,
    settledRunIds: overrides?.settledRunIds ? [...overrides.settledRunIds] : [],
    selectedShipId: overrides?.selectedShipId ?? 'cannon_skiff',
    selectedCrewId: overrides?.selectedCrewId !== undefined ? overrides.selectedCrewId : 'engineer',
    selectedArchetype: overrides?.selectedArchetype ?? 'laser',
    migrationRecord: overrides?.migrationRecord ? { ...overrides.migrationRecord } : null,
  };

  if (overrides?.credits !== undefined) {
    profile.credits = overrides.credits;
  }

  validateV2ProfileInvariant(profile);
  return profile;
}

export function createV2SaveFixture(
  overrides?: {
    profile?: Partial<V2ProfileState>;
    settings?: Partial<GameSettings>;
    savedAt?: string;
  },
): V2SaveData {
  return {
    schemaVersion: V2_SCHEMA_VERSION,
    rulesVersion: V2_RULES_VERSION,
    savedAt: overrides?.savedAt ?? DEFAULT_SAVED_AT,
    profile: createV2ProfileFixture(overrides?.profile),
    activeRun: null,
    settings: createDefaultSettings(overrides?.settings),
  };
}

export function createDefaultCampaignState(
  overrides?: Partial<V3CampaignState>,
): V3CampaignState {
  return {
    currentAct: overrides?.currentAct ?? 'prologue',
    unlockedSectors: overrides?.unlockedSectors ? [...overrides.unlockedSectors] : ['near_orbit'],
    completedMilestones: overrides?.completedMilestones ? [...overrides.completedMilestones] : [],
    defeatedBossIds: overrides?.defeatedBossIds ? [...overrides.defeatedBossIds] : [],
    readCommsIds: overrides?.readCommsIds ? [...overrides.readCommsIds] : [],
    relicPityCounters: {
      near_orbit: 0,
      frozen_graveyard: 0,
      stargate_abyss: 0,
      ...overrides?.relicPityCounters,
    },
    endingsUnlocked: overrides?.endingsUnlocked ? [...overrides.endingsUnlocked] : [],
    finalMissionUnlocked: overrides?.finalMissionUnlocked ?? false,
    endlessUnlocked: overrides?.endlessUnlocked ?? false,
    maxEndlessThreat: overrides?.maxEndlessThreat ?? 0,
  };
}

export function createDefaultCareerStats(
  overrides?: Partial<V3CareerStats>,
): V3CareerStats {
  return {
    totalWins: 0,
    totalDefeats: 0,
    totalSafeReturns: 0,
    totalCreditsEarned: 0,
    totalSalvagePartsEarned: 0,
    totalBossesDefeated: 0,
    totalWrecksDissected: 0,
    totalItemsDismantled: 0,
    deepestEndlessCleared: 0,
    ...overrides,
  };
}

export function createV3ProfileFixture(
  overrides?: Partial<V3ProfileState>,
): V3ProfileState {
  const base = createV2ProfileFixture(overrides);
  const derivedTiers: Record<V3FacilityId, number> = {
    workbench: base.buildings.workbench ? 1 : 0,
    contract_hub: base.buildings.contract_hub ? 1 : 0,
    drydock: base.buildings.drydock ? 1 : 0,
    research_lab: base.buildings.research_lab ? 1 : 0,
    display: base.buildings.display ? 1 : 0,
    drydock_tier2: base.buildings.drydock_tier2 ? 1 : 0,
    stargate_relay: 0,
  };

  const profile: V3ProfileState = {
    ...base,
    salvageParts: overrides?.salvageParts ?? 0,
    facilityTiers: {
      ...derivedTiers,
      ...overrides?.facilityTiers,
    },
    campaign: createDefaultCampaignState(overrides?.campaign),
    factionRep: {
      starport_guild: 0,
      deep_institute: 0,
      free_salvagers: 0,
      ...overrides?.factionRep,
    },
    crewMastery: {
      engineer: 0,
      navigator: 0,
      salvager: 0,
      ...overrides?.crewMastery,
    },
    achievementsUnlocked: overrides?.achievementsUnlocked ? [...overrides.achievementsUnlocked] : [],
    defeatedEnemyKinds: overrides?.defeatedEnemyKinds ? [...overrides.defeatedEnemyKinds] : [],
    runHistory: overrides?.runHistory ? overrides.runHistory.map((h) => ({ ...h })) : [],
    career: createDefaultCareerStats(overrides?.career),
  };

  validateV3ProfileInvariant(profile);
  return profile;
}

export function validateV3RunInvariant(run: V3RunState): void {
  if (run.schemaVersion !== V3_SCHEMA_VERSION || run.rulesVersion !== V3_RULES_VERSION) {
    throw new Error(
      `Fixture invariant violation: run version mismatch (expected ${V3_SCHEMA_VERSION}/${V3_RULES_VERSION}, got ${run.schemaVersion}/${run.rulesVersion}).`,
    );
  }
  if (!(run.shipId in SHIP_SPECS)) {
    throw new Error(`Fixture invariant violation: unknown run.shipId "${String(run.shipId)}".`);
  }
  if (
    !Number.isInteger(run.maxFuel) ||
    run.maxFuel <= 0 ||
    run.maxFuel > MAX_FUEL ||
    !Number.isInteger(run.fuel) ||
    run.fuel < 0 ||
    run.fuel > run.maxFuel
  ) {
    throw new Error(
      `Fixture invariant violation: run fuel/maxFuel out of bounds (fuel=${run.fuel}, maxFuel=${run.maxFuel}, MAX_FUEL=${MAX_FUEL}).`,
    );
  }
  if (
    !Number.isInteger(run.maxHp) ||
    run.maxHp <= 0 ||
    !Number.isInteger(run.hp) ||
    run.hp < 0 ||
    run.hp > run.maxHp
  ) {
    throw new Error(
      `Fixture invariant violation: run hp/maxHp out of bounds (hp=${run.hp}, maxHp=${run.maxHp}).`,
    );
  }
  if (!Number.isInteger(run.wallet) || run.wallet < 0) {
    throw new Error(
      `Fixture invariant violation: run.wallet must be a non-negative integer (got ${run.wallet}).`,
    );
  }
  if (
    !Number.isInteger(run.tacticalChargesMax) ||
    run.tacticalChargesMax < 0 ||
    !Number.isInteger(run.tacticalChargesUsed) ||
    run.tacticalChargesUsed < 0
  ) {
    throw new Error(
      `Fixture invariant violation: invalid tactical charges (max=${run.tacticalChargesMax}, used=${run.tacticalChargesUsed}).`,
    );
  }
  if (!Number.isInteger(run.salvagePartsEarned) || run.salvagePartsEarned < 0) {
    throw new Error(
      `Fixture invariant violation: salvagePartsEarned must be non-negative integer (got ${run.salvagePartsEarned}).`,
    );
  }
  for (const key of ['map', 'enemies', 'shop', 'events', 'rewards'] as const) {
    const stream = run.rngStreams?.[key];
    if (
      !stream ||
      !Number.isInteger(stream.seed) ||
      !Number.isInteger(stream.draws) ||
      stream.draws < 0
    ) {
      throw new Error(`Fixture invariant violation: invalid rngStreams.${key}.`);
    }
  }
  if (run.bay.shipId !== run.shipId) {
    throw new Error(
      `Fixture invariant violation: bay.shipId "${run.bay.shipId}" does not match run.shipId "${run.shipId}".`,
    );
  }
  validateCargoBayInvariant(run.bay);

  if (run.currentNodeId !== null && !(run.currentNodeId in run.graph.nodes)) {
    throw new Error(
      `Fixture invariant violation: currentNodeId "${run.currentNodeId}" does not exist in graph.nodes.`,
    );
  }

  if (run.phase === 'ENCOUNTER') {
    if (run.currentNodeId === null) {
      throw new Error('Fixture invariant violation: ENCOUNTER phase requires non-null currentNodeId.');
    }
    const node = run.graph.nodes[run.currentNodeId];
    if (node.type === 'merchant') {
      throw new Error(
        `Fixture invariant violation: merchant node "${node.nodeId}" requires phase "SHOP", not "ENCOUNTER".`,
      );
    }
    if (node.type === 'combat' || node.type === 'elite' || node.type === 'boss') {
      if (!node.combat || !Array.isArray(node.combat.units) || node.combat.units.length === 0) {
        throw new Error(
          `Fixture invariant violation: ENCOUNTER combat node "${node.nodeId}" requires non-empty node.combat.units.`,
        );
      }
      if (run.activeCombat !== null) {
        if (run.activeCombat.nodeId !== run.currentNodeId || !run.activeCombat.simulation) {
          throw new Error(
            `Fixture invariant violation: activeCombat on "${node.nodeId}" must match currentNodeId and include simulation (or be null for pre-combat).`,
          );
        }
      }
    } else if (node.type === 'wreck') {
      if (!node.wreck && !run.activeWreck) {
        throw new Error(
          `Fixture invariant violation: ENCOUNTER wreck node "${node.nodeId}" requires node.wreck payload.`,
        );
      }
    } else if (node.type === 'anomaly') {
      if (!node.anomaly && !run.activeEvent) {
        throw new Error(
          `Fixture invariant violation: ENCOUNTER anomaly node "${node.nodeId}" requires node.anomaly payload.`,
        );
      }
    } else if (node.type === 'distress') {
      if (!node.distress && !run.activeEvent) {
        throw new Error(
          `Fixture invariant violation: ENCOUNTER distress node "${node.nodeId}" requires node.distress payload.`,
        );
      }
    }
  }

  if (run.phase === 'SHOP') {
    if (run.currentNodeId === null) {
      throw new Error('Fixture invariant violation: SHOP phase requires non-null currentNodeId.');
    }
    const node = run.graph.nodes[run.currentNodeId];
    if (node.type !== 'merchant' || !node.merchant || !Array.isArray(node.merchant.offers)) {
      throw new Error(
        `Fixture invariant violation: SHOP phase on "${node.nodeId}" requires a merchant node with node.merchant.offers.`,
      );
    }
  }

  if (run.phase === 'REWARD') {
    if (
      !run.pendingReward ||
      !run.pendingReward.equipmentOption ||
      !run.pendingReward.cargoOption
    ) {
      throw new Error(
        'Fixture invariant violation: REWARD phase requires pendingReward with equipmentOption and cargoOption.',
      );
    }
  }

  if (
    run.phase === 'SETTLEMENT' &&
    run.settlementReason !== 'safe_return' &&
    run.settlementReason !== 'defeat'
  ) {
    throw new Error(
      'Fixture invariant violation: SETTLEMENT phase requires settlementReason "safe_return" | "defeat".',
    );
  }
}

export interface CreateV3RunOptions {
  runId?: string;
  seed?: number;
  sectorId?: SectorId;
  shipId?: V3ShipId;
  crewId?: V2CrewId | null;
  phase?: V2RunPhase;
  fuel?: number;
  maxFuel?: number;
  hp?: number;
  maxHp?: number;
  wallet?: number;
  currentNodeId?: string | null;
  graph?: V2MapGraph;
  contract?: V2ContractInstance;
  bay?: V2CargoBayState;
  overrides?: Partial<V3RunState>;
  skipValidation?: boolean;
}

export function createV3RunFixture(options: CreateV3RunOptions = {}): V3RunState {
  const runId = options.runId ?? nextId('run_v3');
  const seed = options.seed ?? 202601;
  const shipId = options.shipId ?? 'cannon_skiff';
  const ship = SHIP_SPECS[shipId];
  const graph = options.graph ?? createMapGraph();
  const phase = options.phase ?? 'MAP';
  const maxHp = options.maxHp ?? (ship ? ship.maxHp : 30);
  const hp = options.hp ?? maxHp;
  const maxFuel = options.maxFuel ?? MAX_FUEL;
  const fuel = options.fuel ?? Math.min(STARTING_FUEL, maxFuel);
  const currentNodeId =
    options.currentNodeId !== undefined
      ? options.currentNodeId
      : phase === 'MAP'
        ? null
        : 'L1A';

  const bay = options.bay ?? createStarterCombatBay(shipId);
  const contract = options.contract ?? createContractInstance('transport_std', { runId });

  const defaultPendingReward: V2CombatRewardBundle | null =
    phase === 'REWARD'
      ? {
          nodeId: currentNodeId ?? 'L1B',
          equipmentOption: createCargoItem({
            instanceId: `${runId}_rew_laser`,
            definitionId: 'equipment.laser.common',
            origin: 'loot',
            acquiredDepth: 1,
            location: 'staging',
          }),
          cargoOption: createCargoItem({
            instanceId: `${runId}_rew_alloy`,
            definitionId: 'cargo.alloy_bar',
            origin: 'loot',
            acquiredDepth: 1,
            location: 'staging',
          }),
          repairAmount: 6,
          chosen: null,
        }
      : null;

  const baseRun: V3RunState = {
    runId,
    schemaVersion: V3_SCHEMA_VERSION,
    rulesVersion: V3_RULES_VERSION,
    seed,
    rngStreams: createRngStreams(seed),
    shipId,
    crewId: options.crewId !== undefined ? options.crewId : 'engineer',
    primaryArchetype: 'laser',
    phase,
    fuel,
    maxFuel,
    hp,
    maxHp,
    wallet: options.wallet ?? 0,
    currentNodeId,
    graph,
    contract,
    bay,
    visitedNodeIds: currentNodeId ? [currentNodeId] : [],
    claimedEventIds: [],
    transactionIds: [],
    isTutorial: false,
    allowImproved: true,
    targetPolicy: 'weakest',
    activeCombat: null,
    pendingReward: defaultPendingReward,
    engineerSwapAvailable: (options.crewId ?? 'engineer') === 'engineer',
    activeEngineerOffer: null,
    navigatorFreeJumpUsed: false,
    settlementReason: phase === 'SETTLEMENT' ? 'safe_return' : null,
    sectorId: options.sectorId ?? 'near_orbit',
    endlessThreat: 0,
    endlessMutatorIds: [],
    recentEquipmentKinds: [],
    usedEventIds: [],
    tacticalChargesMax: 1,
    tacticalChargesUsed: 0,
    salvagePartsEarned: 0,
    isFinalCampaignRun: false,
    ...options.overrides,
  };

  // Clone graph.nodes and sync visitedNodeIds -> node.visited & contract.markedNodeIds -> node.contractMarker
  const syncedNodes: Record<string, V2MapNode> = {};
  for (const [nid, node] of Object.entries(baseRun.graph.nodes)) {
    syncedNodes[nid] = {
      ...node,
      nextNodeIds: [...node.nextNodeIds],
    };
  }
  for (const visitedId of baseRun.visitedNodeIds) {
    if (visitedId in syncedNodes) {
      syncedNodes[visitedId] = { ...syncedNodes[visitedId], visited: true };
    }
  }
  for (const markedId of baseRun.contract.markedNodeIds) {
    if (markedId in syncedNodes) {
      syncedNodes[markedId] = { ...syncedNodes[markedId], contractMarker: true };
    }
  }

  const finalRun: V3RunState = {
    ...baseRun,
    visitedNodeIds: [...baseRun.visitedNodeIds],
    graph: {
      ...baseRun.graph,
      startNextNodeIds: [...baseRun.graph.startNextNodeIds],
      guaranteedPathNodeIds: [...baseRun.graph.guaranteedPathNodeIds],
      nodes: syncedNodes,
    },
  };

  if (!options.skipValidation) {
    validateV3RunInvariant(finalRun);
  }

  return finalRun;
}

export function createV3SaveFixture(
  overrides?: {
    profile?: Partial<V3ProfileState>;
    activeRun?: V3RunState | null;
    settings?: Partial<GameSettings>;
    savedAt?: string;
    skipValidation?: boolean;
  },
): V3SaveData {
  const save: V3SaveData = {
    schemaVersion: V3_SCHEMA_VERSION,
    rulesVersion: V3_RULES_VERSION,
    savedAt: overrides?.savedAt ?? DEFAULT_SAVED_AT,
    profile: createV3ProfileFixture(overrides?.profile),
    activeRun: overrides?.activeRun ?? null,
    settings: createDefaultSettings(overrides?.settings),
  };

  if (!overrides?.skipValidation && save.activeRun !== null) {
    if (
      save.activeRun.schemaVersion !== save.schemaVersion ||
      save.activeRun.rulesVersion !== save.rulesVersion
    ) {
      throw new Error(
        `Fixture invariant violation: activeRun version (${save.activeRun.schemaVersion}/${save.activeRun.rulesVersion}) does not match save version (${save.schemaVersion}/${save.rulesVersion}).`,
      );
    }
    validateV3RunInvariant(save.activeRun);
  }

  return save;
}

export function createV1SaveFixture(
  overrides?: Partial<V1SaveData['progression']>,
): V1SaveData {
  return {
    schemaVersion: V1_SCHEMA_VERSION,
    rulesVersion: V1_RULES_VERSION,
    savedAt: DEFAULT_SAVED_AT,
    progression: {
      credits: 120,
      buildings: {
        workbench: true,
        display: false,
        drydock: false,
      },
      discoveredItems: ['equipment.laser.common'],
      relics: createDefaultRelics(),
      selectedLoadout: 'cannon_skiff',
      selectedRegion: 'standard',
      tutorialCompleted: true,
      settledExpeditionIds: ['v1_exp_1'],
      totalExpeditions: 1,
      safeReturns: 1,
      deepestNodeReached: 3,
      totalCreditsEarned: 120,
      ...overrides,
    },
    settings: createDefaultSettings(),
    activeExpedition: null,
  };
}

// ============================================================================
// Named Presets for Rapid Reuse Across Tiers 1–4
// ============================================================================

export function presetFreshV3(): V3SaveData {
  return createV3SaveFixture();
}

export function presetPostTutorialV3(
  overrides?: Partial<V3ProfileState>,
): V3SaveData {
  return createV3SaveFixture({
    profile: {
      credits: 80,
      salvageParts: 15,
      tutorialCompleted: true,
      tutorialBonusClaimed: true,
      totalRuns: 1,
      deepestLayerReached: 3,
      buildings: {
        workbench: true,
        contract_hub: true,
        drydock: false,
        research_lab: false,
        display: false,
        drydock_tier2: false,
      },
      facilityTiers: {
        workbench: 1,
        contract_hub: 1,
        drydock: 0,
        research_lab: 0,
        display: 0,
        drydock_tier2: 0,
        stargate_relay: 0,
      },
      campaign: createDefaultCampaignState({
        currentAct: 'act1',
        unlockedSectors: ['near_orbit'],
        completedMilestones: ['tutorial_complete'],
      }),
      ...overrides,
    },
  });
}

export function presetAct1V3(overrides?: Partial<V3ProfileState>): V3SaveData {
  return presetPostTutorialV3({
    credits: 260,
    salvageParts: 40,
    completedContractTypes: ['transport'],
    completedContractIds: ['transport_std'],
    unlockedCrew: ['engineer', 'salvager'],
    buildings: {
      workbench: true,
      contract_hub: true,
      drydock: true,
      research_lab: true,
      display: false,
      drydock_tier2: false,
    },
    facilityTiers: {
      workbench: 1,
      contract_hub: 1,
      drydock: 1,
      research_lab: 1,
      display: 0,
      drydock_tier2: 0,
      stargate_relay: 0,
    },
    unlockedShips: ['cannon_skiff', 'shield_cruiser'],
    equipmentWarehouse: [
      createCargoItem({
        instanceId: 'wh_laser_1',
        definitionId: 'equipment.laser.common',
        origin: 'owned',
        location: 'warehouse',
      }),
      createCargoItem({
        instanceId: 'wh_shield_1',
        definitionId: 'equipment.shield.common',
        origin: 'owned',
        location: 'warehouse',
      }),
    ],
    ...overrides,
  });
}

export function presetAct2V3(overrides?: Partial<V3ProfileState>): V3SaveData {
  return createV3SaveFixture({
    profile: {
      credits: 680,
      salvageParts: 120,
      tutorialCompleted: true,
      tutorialBonusClaimed: true,
      totalRuns: 6,
      deepestLayerReached: 6,
      buildings: {
        workbench: true,
        contract_hub: true,
        drydock: true,
        research_lab: true,
        display: true,
        drydock_tier2: true,
      },
      facilityTiers: {
        workbench: 2,
        contract_hub: 2,
        drydock: 2,
        research_lab: 2,
        display: 1,
        drydock_tier2: 1,
        stargate_relay: 0,
      },
      unlockedShips: ['cannon_skiff', 'shield_cruiser', 'heavy_freighter'],
      unlockedCrew: ['engineer', 'navigator', 'salvager'],
      unlockedFamilies: ['core', 'heavy_kit', 'hangar_kit', 'counter_kit'],
      blueprints: [...ALL_V2_EQUIPMENT_KINDS],
      completedContractTypes: ['transport', 'rescue', 'survey'],
      completedContractIds: ['transport_std', 'rescue_std', 'survey_std'],
      factionRep: {
        starport_guild: 120,
        deep_institute: 110,
        free_salvagers: 105,
      },
      crewMastery: {
        engineer: 1,
        navigator: 1,
        salvager: 1,
      },
      campaign: createDefaultCampaignState({
        currentAct: 'act2',
        unlockedSectors: ['near_orbit', 'frozen_graveyard'],
        completedMilestones: ['tutorial_complete', 'act1_boss_defeated'],
        defeatedBossIds: ['boss_anvil'],
      }),
      career: createDefaultCareerStats({
        totalWins: 5,
        totalSafeReturns: 5,
        totalCreditsEarned: 950,
        totalSalvagePartsEarned: 160,
        totalBossesDefeated: 1,
        totalWrecksDissected: 6,
        totalItemsDismantled: 4,
      }),
      ...overrides,
    },
  });
}

export function presetAct3ClimaxV3(
  overrides?: Partial<V3ProfileState>,
): V3SaveData {
  return createV3SaveFixture({
    profile: {
      credits: 1450,
      salvageParts: 260,
      tutorialCompleted: true,
      tutorialBonusClaimed: true,
      totalRuns: 12,
      deepestLayerReached: 6,
      buildings: {
        workbench: true,
        contract_hub: true,
        drydock: true,
        research_lab: true,
        display: true,
        drydock_tier2: true,
      },
      facilityTiers: {
        workbench: 3,
        contract_hub: 3,
        drydock: 3,
        research_lab: 3,
        display: 2,
        drydock_tier2: 2,
        stargate_relay: 1,
      },
      unlockedShips: [
        'cannon_skiff',
        'shield_cruiser',
        'heavy_freighter',
        'stargate_cruiser',
      ],
      unlockedCrew: ['engineer', 'navigator', 'salvager'],
      unlockedFamilies: ['core', 'heavy_kit', 'hangar_kit', 'counter_kit'],
      blueprints: [...ALL_V3_EQUIPMENT_KINDS],
      relics: createDefaultRelics({
        ancient_navigator: { storedCount: 1, restored: true },
        quantum_core: { storedCount: 1, restored: true },
        cryo_amber: { storedCount: 1, restored: true },
        obsidian_crown: { storedCount: 1, restored: false },
      }),
      factionRep: {
        starport_guild: 240,
        deep_institute: 230,
        free_salvagers: 225,
      },
      crewMastery: {
        engineer: 2,
        navigator: 2,
        salvager: 2,
      },
      completedContractTypes: ['transport', 'rescue', 'survey', 'bounty', 'derelict'],
      completedContractIds: [
        'transport_std',
        'rescue_std',
        'survey_std',
        'transport_deep',
        'bounty_std',
        'derelict_std',
      ],
      campaign: createDefaultCampaignState({
        currentAct: 'act3',
        unlockedSectors: ['near_orbit', 'frozen_graveyard', 'stargate_abyss'],
        completedMilestones: [
          'tutorial_complete',
          'act1_boss_defeated',
          'act2_boss_defeated',
          'stargate_relay_built',
        ],
        defeatedBossIds: ['boss_anvil', 'boss_dreadnought'],
        finalMissionUnlocked: true,
        endlessUnlocked: false,
      }),
      defeatedEnemyKinds: [
        'patrol',
        'swarm',
        'armored',
        'piercer',
        'artillery',
        'boss_anvil',
        'boss_dreadnought',
      ],
      achievementsUnlocked: ['first_expedition', 'act1_clear', 'act2_clear'],
      career: createDefaultCareerStats({
        totalWins: 11,
        totalDefeats: 1,
        totalSafeReturns: 11,
        totalCreditsEarned: 2400,
        totalSalvagePartsEarned: 380,
        totalBossesDefeated: 2,
        totalWrecksDissected: 14,
        totalItemsDismantled: 12,
      }),
      ...overrides,
    },
  });
}

export function presetEndlessReadyV3(
  overrides?: Partial<V3ProfileState>,
): V3SaveData {
  const base = presetAct3ClimaxV3();
  return createV3SaveFixture({
    profile: {
      ...base.profile,
      relics: createDefaultRelics({
        ancient_navigator: { storedCount: 1, restored: true },
        quantum_core: { storedCount: 1, restored: true },
        cryo_amber: { storedCount: 1, restored: true },
        obsidian_crown: { storedCount: 1, restored: true },
      }),
      campaign: {
        ...base.profile.campaign,
        currentAct: 'endless',
        defeatedBossIds: ['boss_anvil', 'boss_dreadnought', 'boss_leviathan'],
        endingsUnlocked: ['stargate_reignited'],
        finalMissionUnlocked: true,
        endlessUnlocked: true,
        maxEndlessThreat: 1,
      },
      career: {
        ...base.profile.career,
        totalBossesDefeated: 3,
        deepestEndlessCleared: 0,
      },
      ...overrides,
    },
  });
}

export function presetMidRunMapV3(
  runOverrides?: CreateV3RunOptions,
  profileOverrides?: Partial<V3ProfileState>,
): V3SaveData {
  const base = presetAct1V3(profileOverrides);
  const run = createV3RunFixture({
    phase: 'MAP',
    currentNodeId: null,
    fuel: STARTING_FUEL,
    ...runOverrides,
  });
  return {
    ...base,
    activeRun: run,
  };
}

export function presetBossEncounterV3(
  act: 1 | 2 | 3,
  profileOverrides?: Partial<V3ProfileState>,
): V3SaveData {
  const sectorMap: Record<1 | 2 | 3, SectorId> = {
    1: 'near_orbit',
    2: 'frozen_graveyard',
    3: 'stargate_abyss',
  };
  const bossMap: Record<1 | 2 | 3, { kind: V2EncounterKind; id: string }> = {
    1: { kind: 'boss_anvil', id: 'boss_anvil' },
    2: { kind: 'boss_dreadnought', id: 'boss_dreadnought' },
    3: { kind: 'boss_leviathan', id: 'boss_leviathan' },
  };
  const base =
    act === 1
      ? presetAct1V3(profileOverrides)
      : act === 2
        ? presetAct2V3(profileOverrides)
        : presetAct3ClimaxV3(profileOverrides);
  const boss = bossMap[act];
  const shipId: V3ShipId =
    act === 3 ? 'stargate_cruiser' : act === 2 ? 'shield_cruiser' : 'cannon_skiff';
  const graph = createMapGraph({
    maxLayers: 6,
    bossKind: boss.kind,
    bossId: boss.id,
  });
  const bay = createCargoBay({
    shipId,
    placed: [
      {
        item: createCargoItem({
          instanceId: nextId(`boss_wpn_${act}`),
          definitionId: 'equipment.laser.improved',
          origin: 'owned',
        }),
        x: 1,
        y: 1,
      },
      {
        item: createCargoItem({
          instanceId: nextId(`boss_bat_${act}`),
          definitionId: 'equipment.battery.improved',
          origin: 'owned',
        }),
        x: 2,
        y: 1,
      },
      {
        item: createCargoItem({
          instanceId: nextId(`boss_shd_${act}`),
          definitionId: 'equipment.shield.improved',
          origin: 'owned',
        }),
        x: 3,
        y: 1,
      },
    ],
  });

  // Pre-combat encounter: activeCombat MUST be null while graph.nodes.L6A.combat is populated
  // so CombatPreView renders btn-start-combat and clicking it executes real live combat.
  const run = createV3RunFixture({
    sectorId: sectorMap[act],
    shipId,
    phase: 'ENCOUNTER',
    currentNodeId: 'L6A',
    graph,
    bay,
    fuel: 4,
    overrides: {
      visitedNodeIds: ['L1A', 'L2A', 'L3A', 'L4A', 'L5A', 'L6A'],
      tacticalChargesMax: 2,
      tacticalChargesUsed: 0,
      isFinalCampaignRun: act === 3,
      activeCombat: null,
    },
  });

  return {
    ...base,
    activeRun: run,
  };
}

export function presetWreckEncounterV3(
  overrides?: {
    crewId?: V2CrewId;
    hp?: number;
    fuel?: number;
    shipId?: V3ShipId;
  },
): V3SaveData {
  const base = presetAct1V3();
  const shipId = overrides?.shipId ?? 'cannon_skiff';
  const armoryItem = createCargoItem({
    instanceId: 'wreck_armory_laser',
    definitionId: 'equipment.laser.common',
    origin: 'loot',
    acquiredDepth: 1,
    location: 'staging',
  });
  const cargoAlloy = createCargoItem({
    instanceId: 'wreck_cargo_alloy',
    definitionId: 'cargo.alloy_bar',
    origin: 'loot',
    acquiredDepth: 1,
    location: 'staging',
  });
  const cargoData = createCargoItem({
    instanceId: 'wreck_cargo_data',
    definitionId: 'cargo.data_box',
    origin: 'loot',
    acquiredDepth: 1,
    location: 'staging',
  });
  const reactorEngine = createCargoItem({
    instanceId: 'wreck_reactor_engine',
    definitionId: 'cargo.old_engine',
    origin: 'loot',
    acquiredDepth: 1,
    location: 'staging',
  });

  const graph = createMapGraph({
    nodeOverrides: {
      L1A: {
        type: 'wreck',
        visited: true,
        resolved: false,
        wreck: {
          armoryItem,
          cargoItems: [cargoAlloy, cargoData],
          armorySizeRange: '1×2 ~ 2×2',
          armoryValueRange: '10~20¤',
          cargoSizeRange: '1×1 ~ 1×2',
          cargoValueRange: '15~30¤',
          reactorFuelGain: 2,
          reactorRepairGain: 8,
          chosenRoom: null,
        },
      },
    },
  });

  const run = createV3RunFixture({
    shipId,
    crewId: overrides?.crewId ?? 'engineer',
    phase: 'ENCOUNTER',
    currentNodeId: 'L1A',
    graph,
    hp: overrides?.hp ?? SHIP_SPECS[shipId].maxHp,
    fuel: overrides?.fuel ?? 8,
    overrides: {
      visitedNodeIds: ['L1A'],
      activeWreck: {
        nodeId: 'L1A',
        stability: 100,
        maxStability: 100,
        cutsMade: 0,
        extracted: false,
        hotspots: [
          {
            spotId: 'armory',
            label: '军械舱',
            cut: false,
            riskHullDamage: 0,
            riskFuelCost: 0,
            riskAmbush: false,
            rewardItem: { ...armoryItem },
          },
          {
            spotId: 'cargo',
            label: '主货舱',
            cut: false,
            riskHullDamage: 4,
            riskFuelCost: 0,
            riskAmbush: false,
            rewardItem: { ...cargoAlloy },
            rewardParts: 8,
          },
          {
            spotId: 'reactor',
            label: '反应堆舱',
            cut: false,
            riskHullDamage: 6,
            riskFuelCost: 1,
            riskAmbush: false,
            rewardItem: reactorEngine,
            rewardParts: 12,
          },
        ],
      },
    },
  });

  return {
    ...base,
    activeRun: run,
  };
}

export function presetEventEncounterV3(
  overrides?: {
    crewId?: V2CrewId;
    wallet?: number;
    fuel?: number;
    hp?: number;
  },
): V3SaveData {
  const base = presetAct2V3();
  const graph = createMapGraph({
    nodeOverrides: {
      L2B: {
        type: 'anomaly',
        visited: true,
        resolved: false,
        eventId: 'evt_blackbox_decode',
        anomaly: {
          cargoCategoryLabel: '旧舰队黑匣',
          safeFuelCost: 1,
          safeCargoItem: createCargoItem({
            instanceId: 'evt_safe_alloy',
            definitionId: 'cargo.alloy_bar',
            origin: 'loot',
            acquiredDepth: 2,
            location: 'staging',
          }),
          breachHpCost: 4,
          breachCargoItems: [
            createCargoItem({
              instanceId: 'evt_breach_coolant',
              definitionId: 'cargo.coolant_tank',
              origin: 'loot',
              acquiredDepth: 2,
              location: 'staging',
            }),
            createCargoItem({
              instanceId: 'evt_breach_data',
              definitionId: 'cargo.data_box',
              origin: 'loot',
              acquiredDepth: 2,
              location: 'staging',
            }),
          ],
          chosenOption: null,
        },
      },
    },
  });

  const run = createV3RunFixture({
    crewId: overrides?.crewId ?? 'engineer',
    phase: 'ENCOUNTER',
    currentNodeId: 'L2B',
    graph,
    wallet: overrides?.wallet ?? 40,
    fuel: overrides?.fuel ?? 7,
    hp: overrides?.hp ?? 28,
    overrides: {
      visitedNodeIds: ['L1A', 'L2B'],
      activeEvent: {
        nodeId: 'L2B',
        eventId: 'evt_blackbox_decode',
        title: '漂流黑匣破译',
        description: '一具加密的旧舰队黑匣正在发射微弱信标，可尝试拆解破译或安全掠过。',
        resolved: false,
        chosenIndex: null,
        options: [
          {
            index: 0,
            label: '强行撬开外壳（消耗 1 燃料）',
            costSummary: '-1 燃料',
            rewardSummary: '+18¤ 与精密零件',
            fuelCost: 1,
          },
          {
            index: 1,
            label: '林工专线解码（工程师专属）',
            costSummary: '无损耗',
            rewardSummary: '+25¤ 与设备模块',
            requiredCrewId: 'engineer',
          },
          {
            index: 2,
            label: '记录坐标后安全撤离',
            costSummary: '无消耗',
            rewardSummary: '安全离开',
            isFallback: true,
          },
        ],
      },
    },
  });

  return {
    ...base,
    activeRun: run,
  };
}

export function presetShopEncounterV3(
  overrides?: {
    wallet?: number;
    fuel?: number;
    hp?: number;
    crewId?: V2CrewId;
    engineerSwapAvailable?: boolean;
  },
): V3SaveData {
  const base = presetAct1V3();
  const crewId = overrides?.crewId ?? 'engineer';
  const engineerSwapAvailable = overrides?.engineerSwapAvailable ?? crewId === 'engineer';

  const graph = createMapGraph({
    nodeOverrides: {
      L2A: {
        type: 'merchant',
        visited: true,
        resolved: false,
        merchant: {
          offers: [
            {
              offerId: 'offer_1',
              item: createCargoItem({
                instanceId: 'shop_offer_shield',
                definitionId: 'equipment.shield.common',
                origin: 'loot',
                fixedValue: 10,
                acquiredDepth: 2,
                location: 'staging',
              }),
              buyPrice: 25,
              sold: false,
            },
            {
              offerId: 'offer_2',
              item: createCargoItem({
                instanceId: 'shop_offer_bat',
                definitionId: 'equipment.battery.common',
                origin: 'loot',
                fixedValue: 8,
                acquiredDepth: 2,
                location: 'staging',
              }),
              buyPrice: 20,
              sold: false,
            },
          ],
          fuelPrice: 12,
          fuelAmount: 2,
          fuelBought: false,
          repairPrice: 16,
          repairAmount: 10,
          repairBought: false,
        },
      },
    },
  });

  const bay = createCargoBay({
    shipId: 'cannon_skiff',
    placed: [
      {
        item: createCargoItem({
          instanceId: 'shop_loan_laser',
          definitionId: 'equipment.laser.common',
          origin: 'loan',
        }),
        x: 0,
        y: 0,
      },
      {
        item: createCargoItem({
          instanceId: 'shop_loot_alloy',
          definitionId: 'cargo.alloy_bar',
          origin: 'loot',
          fixedValue: 15,
          acquiredDepth: 1,
        }),
        x: 1,
        y: 0,
      },
      {
        item: createCargoItem({
          instanceId: 'shop_loot_battery',
          definitionId: 'equipment.battery.common',
          origin: 'loot',
          fixedValue: 8,
          acquiredDepth: 1,
        }),
        x: 2,
        y: 0,
      },
    ],
  });

  const run = createV3RunFixture({
    crewId,
    phase: 'SHOP',
    currentNodeId: 'L2A',
    graph,
    bay,
    wallet: overrides?.wallet ?? 80,
    fuel: overrides?.fuel ?? 6,
    hp: overrides?.hp ?? 20,
    overrides: {
      visitedNodeIds: ['L1A', 'L2A'],
      engineerSwapAvailable,
      activeEngineerOffer:
        crewId === 'engineer' && engineerSwapAvailable
          ? {
              targetInstanceId: 'shop_loot_battery',
              candidates: ['laser', 'shield'],
              used: false,
            }
          : null,
    },
  });

  return {
    ...base,
    activeRun: run,
  };
}

export function presetArrangeV3(
  stagingItems?: StagingItemInput[],
): V3SaveData {
  const base = presetAct1V3();
  const bay = createCargoBay({
    shipId: 'cannon_skiff',
    placed: [
      {
        item: createCargoItem({
          instanceId: 'arr_laser_1',
          definitionId: 'equipment.laser.common',
          origin: 'loan',
        }),
        x: 0,
        y: 0,
      },
    ],
    staging: stagingItems ?? [
      createStagingItem(
        createCargoItem({
          instanceId: 'arr_stg_bat',
          definitionId: 'equipment.battery.common',
          origin: 'loot',
          acquiredDepth: 1,
          location: 'staging',
        }),
        0,
      ),
    ],
  });
  const run = createV3RunFixture({
    phase: 'ARRANGE',
    currentNodeId: 'L1A',
    bay,
    overrides: {
      visitedNodeIds: ['L1A'],
    },
  });
  return {
    ...base,
    activeRun: run,
  };
}

export function presetSettlementV3(
  overrides?: {
    reason?: 'safe_return' | 'defeat';
    wallet?: number;
    bay?: V2CargoBayState;
    contract?: V2ContractInstance;
    bonusObjective?: V2ContractBonusObjective;
  },
): V3SaveData {
  const base = presetAct1V3();
  const bay =
    overrides?.bay ??
    createCargoBay({
      shipId: 'cannon_skiff',
      placed: [
        {
          item: createCargoItem({
            instanceId: 'settle_loan_laser',
            definitionId: 'equipment.laser.common',
            origin: 'loan',
          }),
          x: 0,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'settle_loot_eq',
            definitionId: 'equipment.shield.common',
            origin: 'loot',
            fixedValue: 10,
            acquiredDepth: 2,
          }),
          x: 1,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'settle_loot_cargo',
            definitionId: 'cargo.alloy_bar',
            origin: 'loot',
            fixedValue: 20,
            acquiredDepth: 2,
          }),
          x: 2,
          y: 0,
        },
      ],
    });

  if (!base.profile.unlockedShips.includes(bay.shipId)) {
    base.profile.unlockedShips = [...base.profile.unlockedShips, bay.shipId];
  }

  const run = createV3RunFixture({
    shipId: bay.shipId,
    phase: 'SETTLEMENT',
    currentNodeId: 'L3A',
    bay,
    wallet: overrides?.wallet ?? 35,
    contract: overrides?.contract,
    overrides: {
      visitedNodeIds: ['L1A', 'L2A', 'L3A'],
      settlementReason: overrides?.reason ?? 'safe_return',
      ...(overrides?.bonusObjective ? { bonusObjective: overrides.bonusObjective } : {}),
    },
  });

  return {
    ...base,
    activeRun: run,
  };
}
