import type { RngCursor } from '../../domain/rng';
import type { GameSettings, RelicProgress } from '../../domain/progression';
import type { SectorBgIndex } from '../../data/nodes';
import type { V2ContractTier, V2ContractType } from '../data/contracts';
import type { V2CrewId } from '../data/crew';
import type { V2EncounterKind, V2EnemyUnitSpec } from '../data/enemies';
import type {
  V2ArchetypeId,
  V2EquipmentKind,
  V2Quality,
  V2UnlockFamilyId,
} from '../data/equipment';
import type { V2FacilityId } from '../data/facilities';
import type { V2Rotation } from '../data/shapes';
import type { V2ShipId } from '../data/ships';

export const V2_SCHEMA_VERSION = 2;
export const V2_RULES_VERSION = '2.0.0';
export const V2_SAVE_KEY = 'starline_save_v2';
export const V2_BACKUP_KEY = 'starline_save_backup_v2';
export const V2_TAB_LOCK_KEY = 'starline_active_tab_lock_v2';
export const V2_TAB_CHANNEL = 'starline_tab_sync_v2';

export const V2_STARTING_FUEL = 9;
export const V2_MAX_FUEL = 10;

/** Explicit four-way provenance (§14): NEVER inferred from name or color */
export type V2ItemOrigin = 'loan' | 'owned' | 'loot' | 'mission';

export type V2ItemLocation = 'bay' | 'staging' | 'warehouse' | 'gift_queue';

export interface V2ItemInstance {
  readonly instanceId: string;
  readonly definitionId: string;
  readonly category: 'equipment' | 'cargo' | 'mission';
  readonly quality: V2Quality;
  readonly origin: V2ItemOrigin;
  readonly acquiredDepth: number;
  /** Fixed appraisal / recycle value (0 for loan & mission items) */
  readonly fixedValue: number;
  readonly missionBinding?: string;
  readonly location: V2ItemLocation;
}

export interface V2PlacedItem {
  readonly item: V2ItemInstance;
  readonly x: number;
  readonly y: number;
  readonly rotation: V2Rotation;
}

export interface V2StagingItem {
  readonly item: V2ItemInstance;
  readonly rotation: V2Rotation;
}

export type V2PreviousLocation =
  | { readonly zone: 'grid'; readonly x: number; readonly y: number; readonly rotation: V2Rotation }
  | { readonly zone: 'staging'; readonly rotation: V2Rotation };

export interface V2DiscardedRecord {
  readonly item: V2ItemInstance;
  readonly previousLocation: V2PreviousLocation;
}

export interface V2CargoBayState {
  readonly shipId: V2ShipId;
  readonly placed: readonly V2PlacedItem[];
  readonly staging: readonly V2StagingItem[];
  readonly discardedThisArrange: readonly V2DiscardedRecord[];
}

export type V2NamedStreamKey = 'map' | 'enemies' | 'shop' | 'events' | 'rewards';

export type V2RngStreams = Record<V2NamedStreamKey, RngCursor>;

export type V2NodeType = 'combat' | 'elite' | 'wreck' | 'merchant' | 'anomaly' | 'distress';

export interface V2ShopEquipmentOffer {
  readonly offerId: string;
  readonly item: V2ItemInstance;
  readonly buyPrice: number;
  readonly sold: boolean;
}

export interface V2WreckPayload {
  readonly armoryItem: V2ItemInstance;
  readonly cargoItems: readonly V2ItemInstance[];
  readonly armorySizeRange: string;
  readonly armoryValueRange: string;
  readonly cargoSizeRange: string;
  readonly cargoValueRange: string;
  readonly chosenRoom: 'armory' | 'cargo' | null;
}

export interface V2MerchantPayload {
  readonly offers: readonly V2ShopEquipmentOffer[];
  readonly fuelPrice: number;
  readonly fuelAmount: number;
  readonly fuelBought: boolean;
  readonly repairPrice: number;
  readonly repairAmount: number;
  readonly repairBought: boolean;
}

export interface V2AnomalyPayload {
  readonly cargoCategoryLabel: string;
  readonly safeFuelCost: number;
  readonly safeCargoItem: V2ItemInstance;
  readonly breachHpCost: number;
  readonly breachCargoItems: readonly V2ItemInstance[];
  readonly chosenOption: 'traverse' | 'breach' | null;
}

export interface V2DistressPayload {
  readonly rescueFuelCost: number;
  readonly repairAmount: number;
  readonly haulCargoItem: V2ItemInstance;
  readonly chosenOption: 'rescue_crew' | 'haul_cargo' | null;
}

export interface V2CombatPayload {
  readonly encounterKind: V2EncounterKind;
  readonly units: readonly V2EnemyUnitSpec[];
  readonly bounty: number;
  readonly improvedProb: number;
  readonly guaranteedSupportKind?: V2EquipmentKind;
}

export interface V2MapNode {
  readonly nodeId: string;
  readonly layer: number; // 1..6 (or 1..3 in tutorial)
  readonly lane: 0 | 1; // A=0, B=1
  readonly type: V2NodeType;
  readonly sectorBg: SectorBgIndex;
  readonly nextNodeIds: readonly string[];
  readonly contractMarker: boolean;
  readonly hasSupportGuarantee?: boolean;
  readonly combat?: V2CombatPayload;
  readonly wreck?: V2WreckPayload;
  readonly merchant?: V2MerchantPayload;
  readonly anomaly?: V2AnomalyPayload;
  readonly distress?: V2DistressPayload;
  readonly resolved: boolean;
  readonly abandoned?: boolean;
}

export interface V2StarGraph {
  readonly maxLayers: number;
  readonly startNextNodeIds: readonly string[];
  readonly nodes: Record<string, V2MapNode>;
  readonly guaranteedPathNodeIds: readonly string[];
}

export interface V2ContractInstance {
  readonly contractId: string;
  readonly templateId: string;
  readonly type: V2ContractType;
  readonly tier: V2ContractTier;
  readonly name: string;
  readonly rewardCredits: number;
  readonly markedNodeIds: readonly string[];
  readonly requiredCompletions: number;
  readonly completedNodeIds: readonly string[];
  readonly missionItemDefId?: 'mission.sealed_reactor' | 'mission.escape_pod';
  readonly missionItemCount: number;
  readonly surveyFuelCost: number;
  readonly status: 'active' | 'aborted' | 'completed' | 'failed';
  readonly rewardClaimed: boolean;
}

export type V2TargetPolicy = 'weakest' | 'highest_threat';

export type V2AttackSourceKind = 'core' | 'laser' | 'heavy' | 'hangar' | 'flak' | 'counter';

export interface V2PlayerAttackEvent {
  readonly sourceKind: V2AttackSourceKind;
  readonly sourceInstanceId: string;
  readonly targetEnemyId: string;
  readonly rawDamage: number;
  readonly appliedDamage: number;
  readonly armorBlocked: number;
  readonly targetHpAfter: number;
  readonly targetKilled: boolean;
}

export interface V2EnemyAttackEvent {
  readonly enemyId: string;
  readonly rawDamage: number;
  readonly pierceDamage: number;
  readonly shieldAbsorbed: number;
  readonly hullDamage: number;
}

export interface V2CombatUnitSnapshot {
  readonly enemyId: string;
  readonly name: string;
  readonly spriteArchetype: V2EnemyUnitSpec['spriteArchetype'];
  readonly hp: number;
  readonly maxHp: number;
  readonly damagePerRound: number;
  readonly armor: number;
  readonly pierceRatio: number;
  readonly isBoss?: boolean;
}

export interface V2CombatRoundLog {
  readonly round: number;
  readonly droneCountsByHangar: Record<string, number>;
  readonly heavyChargingIds: readonly string[];
  readonly playerAttacks: readonly V2PlayerAttackEvent[];
  readonly enemyAttacks: readonly V2EnemyAttackEvent[];
  readonly counterAttack: V2PlayerAttackEvent | null;
  readonly shieldAbsorbedTotal: number;
  readonly playerHpAfter: number;
  readonly playerShieldAfter: number;
  readonly enemiesAfter: readonly V2CombatUnitSnapshot[];
}

export interface V2CombatSimulation {
  readonly resultId: string;
  readonly outcome: 'victory' | 'defeat';
  readonly stalemate: boolean;
  readonly targetPolicy: V2TargetPolicy;
  readonly roundsCount: number;
  readonly startingPlayerHp: number;
  readonly startingPlayerShield: number;
  readonly finalPlayerHp: number;
  readonly repairApplied: number;
  readonly finalPlayerHpAfterRepair: number;
  readonly initialEnemies: readonly V2CombatUnitSnapshot[];
  readonly rounds: readonly V2CombatRoundLog[];
}

export interface V2CombatRewardBundle {
  readonly nodeId: string;
  readonly equipmentOption: V2ItemInstance;
  readonly cargoOption: V2ItemInstance;
  readonly repairAmount: number;
  readonly chosen: 'equipment' | 'cargo' | 'repair' | null;
}

export type V2RunPhase =
  | 'MAP'
  | 'ENCOUNTER'
  | 'REWARD'
  | 'SHOP'
  | 'ARRANGE'
  | 'SETTLEMENT';

export interface V2ActiveCombatState {
  readonly nodeId: string;
  readonly startingHp: number;
  readonly targetPolicy: V2TargetPolicy;
  readonly simulation: V2CombatSimulation;
}

export interface V2EngineerSwapOffer {
  readonly targetInstanceId: string;
  readonly candidates: readonly V2EquipmentKind[];
  readonly used: boolean;
}

export interface V2RunState {
  readonly runId: string;
  readonly schemaVersion: number;
  readonly rulesVersion: string;
  readonly seed: number;
  readonly rngStreams: V2RngStreams;
  readonly isTutorial: boolean;
  readonly allowImproved: boolean;
  readonly contract: V2ContractInstance;
  readonly shipId: V2ShipId;
  readonly crewId: V2CrewId | null;
  readonly primaryArchetype: V2ArchetypeId;
  readonly fuel: number;
  readonly maxFuel: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly wallet: number;
  readonly graph: V2StarGraph;
  readonly visitedNodeIds: readonly string[];
  readonly currentNodeId: string | null;
  readonly phase: V2RunPhase;
  readonly bay: V2CargoBayState;
  readonly targetPolicy: V2TargetPolicy;
  readonly activeCombat: V2ActiveCombatState | null;
  readonly pendingReward: V2CombatRewardBundle | null;
  readonly claimedEventIds: readonly string[];
  readonly transactionIds: readonly string[];
  readonly engineerSwapAvailable: boolean;
  readonly activeEngineerOffer: V2EngineerSwapOffer | null;
  readonly navigatorFreeJumpUsed: boolean;
  readonly settlementReason: 'safe_return' | 'defeat' | null;
}

export interface V2PresetSlot {
  readonly definitionId: string;
  readonly quality: V2Quality;
  readonly preferOrigin: 'owned' | 'loan';
  readonly x: number;
  readonly y: number;
  readonly rotation: V2Rotation;
}

export interface V2LoadoutPreset {
  readonly presetId: string;
  readonly name: string;
  readonly shipId: V2ShipId;
  readonly crewId: V2CrewId | null;
  readonly primaryArchetype: V2ArchetypeId;
  readonly slots: readonly V2PresetSlot[];
  readonly updatedAt: string;
}

export interface V2MigrationRecord {
  readonly migrationId: string;
  readonly migratedAt: string;
  readonly sourceVersion: number;
  readonly settledOldRunCredits: number;
  readonly preservedV1Relics: number;
  readonly legacyAbyssalUnlocked: boolean;
}

export interface V2ProfileState {
  readonly credits: number;
  readonly buildings: Record<V2FacilityId, boolean>;
  readonly unlockedShips: readonly V2ShipId[];
  readonly unlockedCrew: readonly V2CrewId[];
  readonly unlockedFamilies: readonly V2UnlockFamilyId[];
  readonly blueprints: readonly V2EquipmentKind[];
  readonly equipmentWarehouse: readonly V2ItemInstance[];
  readonly pendingGiftQueue: readonly V2ItemInstance[];
  readonly relics: Record<string, RelicProgress>;
  readonly discoveredItems: readonly string[];
  readonly seenItems: readonly string[];
  readonly loadoutPresets: readonly V2LoadoutPreset[];
  readonly completedContractTypes: readonly ('transport' | 'rescue' | 'survey')[];
  readonly completedContractIds: readonly string[];
  readonly deepestLayerReached: number;
  readonly totalRuns: number;
  readonly tutorialCompleted: boolean;
  readonly tutorialBonusClaimed: boolean;
  readonly settledRunIds: readonly string[];
  readonly selectedShipId: V2ShipId;
  readonly selectedCrewId: V2CrewId | null;
  readonly selectedArchetype: V2ArchetypeId;
  readonly migrationRecord: V2MigrationRecord | null;
}

export interface V2SaveData {
  readonly schemaVersion: number;
  readonly rulesVersion: string;
  readonly savedAt: string;
  readonly profile: V2ProfileState;
  readonly activeRun: V2RunState | null;
  readonly settings: GameSettings;
}

export type V2SettlementDisposition = 'sell' | 'store' | 'keep_relic' | 'deliver' | 'return_loan';
