import type { RngCursor } from '../../domain/rng';
import type { GameSettings, RelicProgress } from '../../domain/progression';
import type { SectorBgIndex } from '../../data/nodes';
import type { V3EnemyIntent, V3EnemyIntentKind } from '../data/bosses';
import type {
  V2ContractTier,
  V2ContractType,
  V2FormalContractType,
} from '../data/contracts';
import type { V2CrewId } from '../data/crew';
import type { V2EncounterKind, V2EnemyUnitSpec } from '../data/enemies';
import type {
  V2ArchetypeId,
  V2EquipmentKind,
  V2Quality,
  V2UnlockFamilyId,
} from '../data/equipment';
import type { V2FacilityId } from '../data/facilities';
import type { SectorEnvModifierId } from '../data/sectors';
import type { V2Rotation } from '../data/shapes';
import type { V2ShipId, V2ShipSignatureCommandId } from '../data/ships';

/** V2/V3 settings extending shared GameSettings without touching legacy V1 progression.ts */
export interface V2GameSettings extends GameSettings {
  /** false / undefined => Default-ON Active Tactical Commands; true => Pure-Auto combat */
  readonly pureAutoCombat?: boolean;
}

export function isPureAutoCombat(
  settings?: { readonly pureAutoCombat?: boolean } | null
): boolean {
  return Boolean(settings?.pureAutoCombat);
}

export const V2_SCHEMA_VERSION = 3;
export const V2_RULES_VERSION = '3.0.0';
export const V2_LEGACY_SCHEMA_VERSION = 2;
export const V2_LEGACY_RULES_VERSION = '2.0.0';
export const V2_SAVE_KEY = 'starline_save_v2';
export const V2_BACKUP_KEY = 'starline_save_backup_v2';
export const V3_BACKUP_KEY = 'starline_save_backup_v3';
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

export type V2NodeType =
  | 'combat'
  | 'elite'
  | 'boss'
  | 'wreck'
  | 'merchant'
  | 'anomaly'
  | 'distress';

export interface V2ShopEquipmentOffer {
  readonly offerId: string;
  readonly item: V2ItemInstance;
  readonly buyPrice: number;
  readonly sold: boolean;
}

export type V2WreckChoice = 'armory' | 'cargo' | 'reactor_fuel' | 'reactor_repair';

export type V2WreckSpotId = 'armory' | 'cargo' | 'reactor';

export interface V2WreckHotspot {
  readonly spotId: V2WreckSpotId;
  readonly label: string;
  readonly cut: boolean;
  readonly riskHullDamage: number;
  readonly riskFuelCost: number;
  readonly riskAmbush: boolean;
  readonly rewardItem?: V2ItemInstance;
  readonly rewardItems?: readonly V2ItemInstance[];
  readonly rewardParts?: number;
  readonly rewardCredits?: number;
  readonly reactorFuelGain?: number;
  readonly reactorRepairGain?: number;
}

export interface V2WreckState {
  readonly nodeId: string;
  readonly stability: number;
  readonly maxStability: number;
  readonly cutsMade: number;
  readonly extracted: boolean;
  readonly hotspots: readonly V2WreckHotspot[];
  readonly lastCutSummary?: string;
  readonly ambushTriggered?: boolean;
  readonly stashedItems?: readonly V2ItemInstance[];
}

export interface V2EventOptionState {
  readonly index: number;
  readonly label: string;
  readonly costSummary: string;
  readonly rewardSummary: string;
  readonly requiredCrewId?: V2CrewId;
  readonly fuelCost?: number;
  readonly hpCost?: number;
  readonly walletCost?: number;
  readonly isFallback?: boolean;
  readonly rewardCredits?: number;
  readonly rewardParts?: number;
  readonly rewardFuel?: number;
  readonly rewardHp?: number;
  readonly rewardFactionId?: FactionId;
  readonly rewardFactionRep?: number;
  readonly rewardItems?: readonly V2ItemInstance[];
}

export interface V2EventState {
  readonly nodeId: string;
  readonly eventId: string;
  readonly title: string;
  readonly description: string;
  readonly resolved: boolean;
  readonly chosenIndex: number | null;
  readonly options: readonly V2EventOptionState[];
  readonly flavorTag?: string;
}

export interface V2WreckPayload {
  readonly armoryItem: V2ItemInstance;
  readonly cargoItems: readonly V2ItemInstance[];
  readonly armorySizeRange: string;
  readonly armoryValueRange: string;
  readonly cargoSizeRange: string;
  readonly cargoValueRange: string;
  readonly reactorFuelGain?: number;
  readonly reactorRepairGain?: number;
  readonly chosenRoom: V2WreckChoice | null;
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
  readonly bossId?: string;
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
  readonly bossId?: string;
  readonly hasRelicSignal?: boolean;
  readonly relicSignalDefId?: string;
  readonly eventId?: string;
  readonly combat?: V2CombatPayload;
  readonly wreck?: V2WreckPayload;
  readonly merchant?: V2MerchantPayload;
  readonly anomaly?: V2AnomalyPayload;
  readonly distress?: V2DistressPayload;
  readonly eventState?: V2EventState;
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
  readonly missionItemDefId?: 'mission.sealed_reactor' | 'mission.escape_pod' | 'mission.black_box';
  readonly missionItemCount: number;
  readonly surveyFuelCost: number;
  readonly factionId?: FactionId;
  readonly factionRepReward?: number;
  readonly targetLayer?: number;
  readonly bonusObjective?: V3RunBonusObjective;
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
  readonly shieldDamaged?: number;
  readonly targetHpAfter: number;
  readonly targetKilled: boolean;
}

export interface V2EnemyAttackEvent {
  readonly enemyId: string;
  readonly rawDamage: number;
  readonly pierceDamage: number;
  readonly shieldAbsorbed: number;
  readonly hullDamage: number;
  readonly intentKind?: V3EnemyIntentKind;
  readonly empShieldDrained?: number;
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
  readonly shield?: number;
  readonly maxShield?: number;
  readonly currentPhase?: number;
  readonly totalPhases?: number;
  readonly nextIntent?: V3EnemyIntent;
}

export interface V2BossPhaseTransitionEvent {
  readonly enemyId: string;
  readonly fromPhase: number;
  readonly toPhase: number;
  readonly label: string;
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
  readonly envModifierEvent?: string;
  readonly appliedTacticThisRound?: V2TacticalCommandId;
  readonly enemyIntentsThisRound?: readonly {
    readonly enemyId: string;
    readonly intent: V3EnemyIntent;
  }[];
  readonly bossPhaseTransitions?: readonly V2BossPhaseTransitionEvent[];
  readonly summonedEnemies?: readonly V2CombatUnitSnapshot[];
  readonly enemySpecialNotes?: readonly string[];
}

export type V2TacticalCommandId =
  | 'normal'
  | 'overload'
  | 'emergency_shield'
  | 'emergency_defense'
  | 'focus_calibrate'
  | V2ShipSignatureCommandId;

export type V2EliteTacticChoice = V2TacticalCommandId;

export interface V2AppliedTacticalCommand {
  readonly decisionId: string;
  readonly roundNumber: number;
  readonly choice: V2TacticalCommandId;
}

export interface V2EliteTacticOptionPreview {
  readonly choice: V2TacticalCommandId;
  readonly label: string;
  readonly summary: string;
  readonly enabled: boolean;
  readonly disabledReason?: string;
  readonly isSignature?: boolean;
  readonly predictedOutcome: 'victory' | 'defeat';
  readonly predictedFinalHp: number;
  readonly predictedRounds: number;
}

export interface V2EliteTacticDecision {
  readonly decisionId: string;
  readonly roundNumber: number;
  readonly playerHpAtPause: number;
  readonly playerShieldAtPause: number;
  readonly enemyThreatDamage: number;
  readonly enemiesAlive: number;
  readonly options: readonly V2EliteTacticOptionPreview[];
  readonly chosen: V2TacticalCommandId | null;
  readonly chargeIndex?: number;
  readonly chargesRemaining?: number;
  readonly chargesMax?: number;
  readonly bossPhaseAtPause?: number;
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
  readonly appliedTactic?: V2TacticalCommandId;
  readonly appliedCommands?: readonly {
    readonly roundNumber: number;
    readonly choice: V2TacticalCommandId;
  }[];
  readonly sectorId?: SectorId;
  readonly envModifierId?: SectorEnvModifierId;
  readonly bossId?: string;
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
  /** Active tactical command decision (paused before pendingDecision.roundNumber) */
  readonly pendingDecision?: V2EliteTacticDecision | null;
  /** Ordered list of tactical commands already committed during this battle */
  readonly committedCommands?: readonly V2AppliedTacticalCommand[];
  /** 0-indexed round index where live playback resumes cleanly without replaying earlier rounds */
  readonly resumeFromRound?: number;
  /** Persisted decisionId once live playback has reached the pause boundary (reload-safe instant restore) */
  readonly pausedAtDecisionId?: string | null;
}

export interface V2EngineerSwapOffer {
  readonly targetInstanceId: string;
  readonly candidates: readonly V2EquipmentKind[];
  readonly used: boolean;
}

export type V2TrialBuildId = 'trial_heavy' | 'trial_hangar' | 'trial_counter';

export type CampaignActId = 'prologue' | 'act1' | 'act2' | 'act3' | 'endless';
export type SectorId = 'near_orbit' | 'frozen_graveyard' | 'stargate_abyss';
export type FactionId = 'starport_guild' | 'deep_institute' | 'free_salvagers';
export type EndingId = 'stargate_reignited' | 'free_haven' | 'fleet_heir';

export interface V3CampaignState {
  readonly currentAct: CampaignActId;
  readonly unlockedSectors: readonly SectorId[];
  readonly completedMilestones: readonly string[];
  readonly defeatedBossIds: readonly string[];
  readonly readCommsIds: readonly string[];
  readonly relicPityCounters: Record<string, number>;
  readonly endingsUnlocked: readonly EndingId[];
  readonly finalMissionUnlocked: boolean;
  readonly endlessUnlocked: boolean;
  readonly maxEndlessThreat: number; // 0..10
}

export interface V3CareerStats {
  readonly totalWins: number;
  readonly totalDefeats: number;
  readonly totalSafeReturns: number;
  readonly totalCreditsEarned: number;
  readonly totalSalvagePartsEarned: number;
  readonly totalBossesDefeated: number;
  readonly totalWrecksDissected: number;
  readonly totalItemsDismantled: number;
  readonly deepestEndlessCleared: number;
}

export interface V3RunHistoryEntry {
  readonly runId: string;
  readonly finishedAt: string;
  readonly sectorId: SectorId;
  readonly contractTemplateId: string;
  readonly contractName: string;
  readonly shipId: V2ShipId;
  readonly crewId: V2CrewId | null;
  readonly outcome: 'safe_return' | 'defeat';
  readonly contractCompleted: boolean;
  readonly maxLayerReached: number;
  readonly creditsEarned: number;
  readonly salvagePartsEarned: number;
  readonly endlessThreat: number;
  readonly isFinalCampaignRun?: boolean;
}

export interface V3RunBonusObjective {
  readonly id: string;
  readonly label: string;
  readonly completed: boolean;
  readonly rewardCredits: number;
}

export interface V2RunState {
  readonly runId: string;
  readonly schemaVersion: number;
  readonly rulesVersion: string;
  readonly seed: number;
  readonly rngStreams: V2RngStreams;
  readonly isTutorial: boolean;
  readonly isShowcase?: boolean;
  readonly trialBuildId?: V2TrialBuildId | null;
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
  // V3 additive run fields
  readonly sectorId: SectorId;
  readonly endlessThreat?: number;
  readonly endlessMutatorIds?: readonly string[];
  readonly recentEquipmentKinds: readonly V2EquipmentKind[];
  readonly usedEventIds: readonly string[];
  readonly bonusObjective?: V3RunBonusObjective;
  readonly tacticalChargesMax: number;
  readonly tacticalChargesUsed: number;
  readonly salvagePartsEarned: number;
  readonly isFinalCampaignRun?: boolean;
  /** Snapshotted crew mastery tier (0..2) at expedition launch for 100% reload-safe preview/combat parity */
  readonly crewMasteryTier?: number;
  /** Boss IDs defeated during this expedition (committed to profile.campaign.defeatedBossIds on settlement) */
  readonly defeatedBossIdsThisRun?: readonly string[];
  /** Encounter kinds defeated during this expedition (committed to profile.defeatedEnemyKinds on settlement) */
  readonly defeatedEnemyKindsThisRun?: readonly string[];
  /** Active multi-cut derelict dissection state while inside a wreck encounter (F11) */
  readonly activeWreck?: V2WreckState | null;
  /** Active sector narrative event state while inside an anomaly/distress encounter (F12) */
  readonly activeEvent?: V2EventState | null;
  /** Total items discarded across arrange phases during this run (for bonus_no_discard evaluation) */
  readonly discardedCountThisRun?: number;
  /** Total derelicts dissected during this run (committed to career.totalWrecksDissected) */
  readonly wrecksDissectedThisRun?: number;
  /** Faction reputation gained from narrative events during this run */
  readonly factionRepEarnedThisRun?: Partial<Record<FactionId, number>>;
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

export type V3HullTuningTrack = 'hp' | 'salvage' | 'budget';

export interface V3HullTuningState {
  readonly hpLevel: number;
  readonly salvageLevel: number;
  readonly budgetLevel: number;
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
  readonly completedContractTypes: readonly V2FormalContractType[];
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
  // V3 additive profile fields
  readonly salvageParts: number;
  readonly facilityTiers: Record<string, number>;
  readonly campaign: V3CampaignState;
  readonly factionRep: Record<FactionId, number>;
  readonly crewMastery: Record<V2CrewId, number>;
  readonly achievementsUnlocked: readonly string[];
  readonly defeatedEnemyKinds: readonly string[];
  readonly runHistory: readonly V3RunHistoryEntry[];
  readonly career: V3CareerStats;
  readonly hullTuning?: Record<string, V3HullTuningState>;
}

export interface V2SaveData {
  readonly schemaVersion: number;
  readonly rulesVersion: string;
  readonly savedAt: string;
  readonly profile: V2ProfileState;
  readonly activeRun: V2RunState | null;
  readonly settings: V2GameSettings;
}

export type V2SettlementDisposition =
  | 'sell'
  | 'store'
  | 'dismantle'
  | 'keep_relic'
  | 'deliver'
  | 'return_loan';
