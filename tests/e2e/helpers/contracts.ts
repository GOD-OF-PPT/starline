/**
 * Opaque-Box E2E Contracts & Static Constants for 《星际拆解站：星门远征》 (V3).
 *
 * Strictly zero imports from `src/` and zero Node environment global references.
 * Mirrors PROJECT.md § Interface Contracts #1 & #2 and explorer_e2e_r1_2/handoff.md.
 */

export const STORAGE_KEYS = {
  V2_SAVE: 'starline_save_v2',
  V2_BACKUP: 'starline_save_backup_v2',
  V2_TAB_LOCK: 'starline_active_tab_lock_v2',
  V1_SAVE: 'starline_save_v1',
  V1_BACKUP: 'starline_save_backup_v1',
  V1_TAB_LOCK: 'starline_active_tab_lock_v1',
  SESSION_ACTIVE_MODE: 'starline_active_mode',
  SESSION_V2_TITLE_ENTERED: 'starline_v2_title_entered',
  SESSION_V1_TITLE_ENTERED: 'starline_title_entered_v3',
  SESSION_V2_TAB_SELF_ID: 'starline_active_tab_lock_v2_self_id',
  SESSION_E2E_SEEDED: '__starline_e2e_seeded__',
} as const;

export const V1_SCHEMA_VERSION = 1 as const;
export const V1_RULES_VERSION = 'v1.0.0' as const;
export const V2_SCHEMA_VERSION = 2 as const;
export const V2_RULES_VERSION = '2.0.0' as const;
export const V3_SCHEMA_VERSION = 3 as const;
export const V3_RULES_VERSION = '3.0.0' as const;

export const MAX_FUEL = 10;
export const STARTING_FUEL = 9;
export const WAREHOUSE_BASE_CAPACITY = 12;
export const RUN_HISTORY_MAX_ENTRIES = 30;
export const MAX_ENDLESS_THREAT = 10;
export const RESEARCH_COST_CREDITS = 30;
export const MAX_BATTLE_SHIELD = 20;
export const MAX_POST_WIN_REPAIR = 4;

export type CampaignActId = 'prologue' | 'act1' | 'act2' | 'act3' | 'endless';
export type SectorId = 'near_orbit' | 'frozen_graveyard' | 'stargate_abyss';
export type FactionId = 'starport_guild' | 'deep_institute' | 'free_salvagers';
export type EndingId = 'stargate_reignited' | 'free_haven' | 'fleet_heir';

export type V2ShipId = 'cannon_skiff' | 'shield_cruiser' | 'heavy_freighter';
export type V3ShipId = V2ShipId | 'stargate_cruiser';
export type V2CrewId = 'engineer' | 'navigator' | 'salvager';
export type V2ArchetypeId = 'laser' | 'heavy' | 'hangar' | 'counter';
export type V2UnlockFamilyId = 'core' | 'heavy_kit' | 'hangar_kit' | 'counter_kit';

export type V2FacilityId =
  | 'workbench'
  | 'contract_hub'
  | 'drydock'
  | 'research_lab'
  | 'display'
  | 'drydock_tier2';
export type V3FacilityId = V2FacilityId | 'stargate_relay';

export type V2RelicId =
  | 'ancient_navigator'
  | 'quantum_core'
  | 'cryo_amber'
  | 'obsidian_crown';

export type V2EquipmentKind =
  | 'laser'
  | 'battery'
  | 'shield'
  | 'repair'
  | 'heavy'
  | 'capacitor'
  | 'hangar'
  | 'relay'
  | 'counter'
  | 'flak';

export type V3NewEquipmentKind =
  | 'coolant_vent'
  | 'cargo_amp'
  | 'emp_jammer'
  | 'overdrive_core'
  | 'salvage_grapple'
  | 'salvo_pod';

export type V3EquipmentKind = V2EquipmentKind | V3NewEquipmentKind;

export type V3GadgetKind =
  | 'repair_kit'
  | 'overcharge_cell'
  | 'jump_canister'
  | 'cut_stabilizer';

export type V2ShapeId = '1x1' | '1x2' | '1x3' | '2x2' | '2x3' | 'L3' | 'T4';
export type V2Rotation = 0 | 1 | 2 | 3;
export type V2ItemOrigin = 'loan' | 'owned' | 'loot' | 'mission';
export type V2RunPhase =
  | 'MAP'
  | 'ENCOUNTER'
  | 'REWARD'
  | 'SHOP'
  | 'ARRANGE'
  | 'SETTLEMENT';
export type V2NodeType =
  | 'combat'
  | 'elite'
  | 'wreck'
  | 'merchant'
  | 'anomaly'
  | 'distress'
  | 'boss';
export type V2ContractType =
  | 'transport'
  | 'rescue'
  | 'survey'
  | 'free'
  | 'bounty'
  | 'derelict';
export type V2TrialBuildId = 'trial_heavy' | 'trial_hangar' | 'trial_counter';
export type V2TargetPolicy = 'weakest' | 'highest_threat';

export type V2EncounterKind =
  | 'patrol'
  | 'swarm'
  | 'armored'
  | 'piercer'
  | 'elite'
  | 'artillery'
  | 'shield_regen'
  | 'drone_carrier'
  | 'emp_disruptor'
  | 'rammer'
  | 'boss_anvil'
  | 'boss_dreadnought'
  | 'boss_leviathan';

export interface StarlineInspectActiveRun {
  runId: string;
  seed: number;
  sectorId: string;
  contractId: string;
  shipId: string;
  crewId: string;
  layer: number;
  fuel: number;
  hp: number;
  maxHp: number;
  wallet: number;
  combatRound: number | null;
  combatWaitingDecision: boolean;
  wreckStability: number | null;
  isFinalCampaignRun: boolean;
  endlessThreat: number;
}

export interface StarlineInspectSnapshot {
  mode: 'v1' | 'v2';
  schemaVersion: number;
  screen: 'title' | 'base' | 'prepare' | 'run' | 'ending';
  phase: string | null;
  phaserScene: string | null;
  bgmTrack: string;
  campaignAct: string;
  unlockedSectors: string[];
  endingsUnlocked: string[];
  credits: number;
  salvageParts: number;
  activeRun: StarlineInspectActiveRun | null;
  failedAssets: string[];
  modalOpen: boolean;
}

export interface GameSettings {
  combatSpeed: 1 | 2;
  reducedMotion: boolean;
  lowQuality: boolean;
  sfxMuted: boolean;
  bgmMuted: boolean;
  eliteTacticExperiment?: boolean;
  pureAutoCombat?: boolean;
}

export interface V2RelicProgress {
  storedCount: number;
  restored: boolean;
}

export type V2ItemCategory = 'equipment' | 'cargo' | 'mission' | 'gadget';
export type V2Quality = 'common' | 'improved';
export type V2ItemLocation = 'bay' | 'staging' | 'warehouse' | 'gift_queue';

export interface V2CargoItemInstance {
  instanceId: string;
  definitionId: string;
  category: V2ItemCategory;
  quality: V2Quality;
  origin: V2ItemOrigin;
  acquiredDepth: number;
  fixedValue: number;
  missionBinding?: string;
  location: V2ItemLocation;
  locked?: boolean;
}

export interface V2PlacedCargoItem {
  item: V2CargoItemInstance;
  x: number;
  y: number;
  rotation: V2Rotation;
}

export interface V2StagingItem {
  item: V2CargoItemInstance;
  rotation: V2Rotation;
}

export type V2PreviousLocation =
  | { zone: 'grid'; x: number; y: number; rotation: V2Rotation }
  | { zone: 'staging'; rotation: V2Rotation };

export interface V2DiscardedRecord {
  item: V2CargoItemInstance;
  previousLocation: V2PreviousLocation;
}

export interface V2CargoBayState {
  shipId: V3ShipId;
  placed: V2PlacedCargoItem[];
  staging: V2StagingItem[];
  discardedThisArrange: V2DiscardedRecord[];
}

export interface V2LoadoutPresetSlot {
  definitionId: string;
  quality: V2Quality;
  preferOrigin: 'owned' | 'loan';
  x: number;
  y: number;
  rotation: V2Rotation;
}

export interface V2LoadoutPreset {
  presetId: string;
  name: string;
  shipId: V3ShipId;
  crewId: V2CrewId | null;
  primaryArchetype: V2ArchetypeId;
  slots: V2LoadoutPresetSlot[];
  updatedAt: string;
}

export interface V2MigrationRecord {
  migrationId: string;
  migratedAt: string;
  sourceVersion: number;
  settledOldRunCredits: number;
  preservedV1Relics: number;
  legacyAbyssalUnlocked: boolean;
}

export interface V2RngStreamState {
  seed: number;
  draws: number;
}

export interface V2RngStreams {
  map: V2RngStreamState;
  enemies: V2RngStreamState;
  shop: V2RngStreamState;
  events: V2RngStreamState;
  rewards: V2RngStreamState;
}

export type V2EnemySpriteArchetype =
  | 'scout'
  | 'frigate'
  | 'interceptor'
  | 'boss_dreadnought'
  | 'boss_leviathan';

export interface V2EnemyUnitSpec {
  enemyId: string;
  name: string;
  spriteArchetype: V2EnemySpriteArchetype;
  maxHp: number;
  damagePerRound: number;
  armor: number;
  pierceRatio: number;
  isBoss?: boolean;
}

export interface V2CombatPayload {
  encounterKind: V2EncounterKind;
  units: V2EnemyUnitSpec[];
  bounty: number;
  improvedProb: number;
  guaranteedSupportKind?: V3EquipmentKind;
}

export interface V2ShopEquipmentOffer {
  offerId: string;
  item: V2CargoItemInstance;
  buyPrice: number;
  sold: boolean;
}

export interface V2MerchantPayload {
  offers: V2ShopEquipmentOffer[];
  fuelPrice: number;
  fuelAmount: number;
  fuelBought: boolean;
  repairPrice: number;
  repairAmount: number;
  repairBought: boolean;
}

export type V2WreckChoice = 'armory' | 'cargo' | 'reactor_fuel' | 'reactor_repair';

export interface V2WreckPayload {
  armoryItem: V2CargoItemInstance;
  cargoItems: V2CargoItemInstance[];
  armorySizeRange: string;
  armoryValueRange: string;
  cargoSizeRange: string;
  cargoValueRange: string;
  reactorFuelGain?: number;
  reactorRepairGain?: number;
  chosenRoom: V2WreckChoice | null;
}

export interface V2AnomalyPayload {
  cargoCategoryLabel: string;
  safeFuelCost: number;
  safeCargoItem: V2CargoItemInstance;
  breachHpCost: number;
  breachCargoItems: V2CargoItemInstance[];
  chosenOption: 'traverse' | 'breach' | null;
}

export interface V2DistressPayload {
  rescueFuelCost: number;
  repairAmount: number;
  haulCargoItem: V2CargoItemInstance;
  chosenOption: 'rescue_crew' | 'haul_cargo' | null;
}

export interface V2MapNode {
  nodeId: string;
  layer: number;
  lane: 0 | 1;
  type: V2NodeType;
  sectorBg: 1 | 2 | 3 | 4 | 5 | 6;
  nextNodeIds: string[];
  contractMarker: boolean;
  hasSupportGuarantee?: boolean;
  combat?: V2CombatPayload;
  wreck?: V2WreckPayload;
  merchant?: V2MerchantPayload;
  anomaly?: V2AnomalyPayload;
  distress?: V2DistressPayload;
  resolved: boolean;
  abandoned?: boolean;
  // Optional additive V3 / E2E metadata
  fuelCost?: number;
  visited?: boolean;
  encounterKind?: V2EncounterKind;
  bossId?: string;
  isContractTarget?: boolean;
  hasRelicSignal?: boolean;
  eventId?: string;
  label?: string;
  summary?: string;
}

export interface V2MapGraph {
  maxLayers: number;
  startNextNodeIds: string[];
  nodes: Record<string, V2MapNode>;
  guaranteedPathNodeIds: string[];
}

export interface V2ContractBonusObjective {
  id: string;
  label: string;
  completed: boolean;
  rewardCredits: number;
}

export interface V2ContractInstance {
  contractId: string;
  templateId: string;
  type: V2ContractType;
  tier: 'standard' | 'deep' | 'free';
  name: string;
  rewardCredits: number;
  markedNodeIds: string[];
  requiredCompletions: number;
  completedNodeIds: string[];
  missionItemDefId?: 'mission.sealed_reactor' | 'mission.escape_pod' | 'mission.black_box';
  missionItemCount: number;
  surveyFuelCost: number;
  status: 'active' | 'aborted' | 'completed' | 'failed';
  rewardClaimed: boolean;
  // Optional additive V3 metadata
  factionId?: FactionId;
  factionRepReward?: number;
  targetLayer?: number;
  bonusObjective?: V2ContractBonusObjective;
}

export interface V2CombatUnitSnapshot {
  enemyId: string;
  name: string;
  spriteArchetype: V2EnemySpriteArchetype;
  hp: number;
  maxHp: number;
  damagePerRound: number;
  armor: number;
  pierceRatio: number;
  isBoss?: boolean;
}

export type V2EliteTacticChoice =
  | 'normal'
  | 'overload'
  | 'emergency_defense'
  | 'emergency_shield'
  | 'focus_calibrate';

export interface V2EliteTacticOptionPreview {
  choice: V2EliteTacticChoice;
  label: string;
  summary: string;
  enabled: boolean;
  disabledReason?: string;
  predictedOutcome: 'victory' | 'defeat';
  predictedFinalHp: number;
  predictedRounds: number;
}

export interface V2EliteTacticDecision {
  decisionId: string;
  roundNumber: number;
  playerHpAtPause: number;
  playerShieldAtPause: number;
  enemyThreatDamage: number;
  enemiesAlive: number;
  options: V2EliteTacticOptionPreview[];
  chosen: V2EliteTacticChoice | null;
}

export interface V2CombatSimulation {
  resultId: string;
  outcome: 'victory' | 'defeat';
  stalemate: boolean;
  targetPolicy: V2TargetPolicy;
  roundsCount: number;
  startingPlayerHp: number;
  startingPlayerShield: number;
  finalPlayerHp: number;
  repairApplied: number;
  finalPlayerHpAfterRepair: number;
  initialEnemies: V2CombatUnitSnapshot[];
  rounds: unknown[];
  appliedTactic?: V2EliteTacticChoice;
}

export interface V2ActiveCombatState {
  nodeId: string;
  startingHp: number;
  targetPolicy: V2TargetPolicy;
  simulation: V2CombatSimulation;
  pendingDecision?: V2EliteTacticDecision | null;
}

export interface V2CombatRewardBundle {
  nodeId: string;
  equipmentOption: V2CargoItemInstance;
  cargoOption: V2CargoItemInstance;
  repairAmount: number;
  chosen: 'equipment' | 'cargo' | 'repair' | null;
}

export interface V2EngineerSwapOffer {
  targetInstanceId: string;
  candidates: V3EquipmentKind[];
  used: boolean;
}

export interface V2WreckHotspot {
  spotId: 'armory' | 'cargo' | 'reactor';
  label: string;
  cut: boolean;
  riskHullDamage: number;
  riskFuelCost: number;
  riskAmbush: boolean;
  rewardItem?: V2CargoItemInstance;
  rewardParts?: number;
  rewardCredits?: number;
}

export interface V2WreckState {
  nodeId: string;
  stability: number;
  maxStability: number;
  cutsMade: number;
  extracted: boolean;
  hotspots: V2WreckHotspot[];
}

export interface V2EventOptionState {
  index: number;
  label: string;
  costSummary: string;
  rewardSummary: string;
  requiredCrewId?: V2CrewId;
  fuelCost?: number;
  hpCost?: number;
  walletCost?: number;
  isFallback?: boolean;
}

export interface V2EventState {
  nodeId: string;
  eventId: string;
  title: string;
  description: string;
  resolved: boolean;
  chosenIndex: number | null;
  options: V2EventOptionState[];
}

export interface V2ProfileState {
  credits: number;
  buildings: Record<V2FacilityId, boolean>;
  unlockedShips: V3ShipId[];
  unlockedCrew: V2CrewId[];
  unlockedFamilies: V2UnlockFamilyId[];
  blueprints: V3EquipmentKind[];
  equipmentWarehouse: V2CargoItemInstance[];
  pendingGiftQueue: V2CargoItemInstance[];
  relics: Record<V2RelicId, V2RelicProgress>;
  discoveredItems: string[];
  seenItems: string[];
  loadoutPresets: V2LoadoutPreset[];
  completedContractTypes: ('transport' | 'rescue' | 'survey' | 'bounty' | 'derelict')[];
  completedContractIds: string[];
  deepestLayerReached: number;
  totalRuns: number;
  tutorialCompleted: boolean;
  tutorialBonusClaimed: boolean;
  settledRunIds: string[];
  selectedShipId: V3ShipId;
  selectedCrewId: V2CrewId | null;
  selectedArchetype: V2ArchetypeId;
  migrationRecord: V2MigrationRecord | null;
}

export interface V3CampaignState {
  currentAct: CampaignActId;
  unlockedSectors: SectorId[];
  completedMilestones: string[];
  defeatedBossIds: string[];
  readCommsIds: string[];
  relicPityCounters: Record<string, number>;
  endingsUnlocked: EndingId[];
  finalMissionUnlocked: boolean;
  endlessUnlocked: boolean;
  maxEndlessThreat: number;
}

export interface V3CareerStats {
  totalWins: number;
  totalDefeats: number;
  totalSafeReturns: number;
  totalCreditsEarned: number;
  totalSalvagePartsEarned: number;
  totalBossesDefeated: number;
  totalWrecksDissected: number;
  totalItemsDismantled: number;
  deepestEndlessCleared: number;
}

export interface V3RunHistoryEntry {
  runId: string;
  finishedAt: string;
  sectorId: SectorId;
  contractTemplateId: string;
  contractName: string;
  shipId: V3ShipId;
  crewId: V2CrewId | null;
  outcome: 'safe_return' | 'defeat';
  contractCompleted: boolean;
  maxLayerReached: number;
  creditsEarned: number;
  salvagePartsEarned: number;
  endlessThreat: number;
  isFinalCampaignRun?: boolean;
  endlessMutatorIds?: string[];
  seed?: number;
}

export interface V3ProfileState extends V2ProfileState {
  salvageParts: number;
  facilityTiers: Record<V3FacilityId, number>;
  campaign: V3CampaignState;
  factionRep: Record<FactionId, number>;
  crewMastery: Record<V2CrewId, number>;
  achievementsUnlocked: string[];
  defeatedEnemyKinds: string[];
  runHistory: V3RunHistoryEntry[];
  career: V3CareerStats;
}

export interface V2RunState {
  runId: string;
  schemaVersion: number;
  rulesVersion: string;
  seed: number;
  rngStreams: V2RngStreams;
  shipId: V3ShipId;
  crewId: V2CrewId | null;
  primaryArchetype: V2ArchetypeId;
  phase: V2RunPhase;
  fuel: number;
  maxFuel: number;
  hp: number;
  maxHp: number;
  wallet: number;
  currentNodeId: string | null;
  graph: V2MapGraph;
  contract: V2ContractInstance;
  bay: V2CargoBayState;
  visitedNodeIds: string[];
  claimedEventIds: string[];
  transactionIds: string[];
  isTutorial: boolean;
  allowImproved: boolean;
  targetPolicy: V2TargetPolicy;
  activeCombat: V2ActiveCombatState | null;
  pendingReward: V2CombatRewardBundle | null;
  engineerSwapAvailable: boolean;
  activeEngineerOffer: V2EngineerSwapOffer | null;
  navigatorFreeJumpUsed: boolean;
  settlementReason: 'safe_return' | 'defeat' | null;
  isShowcase?: boolean;
  trialBuildId?: V2TrialBuildId | null;
  activeWreck?: V2WreckState | null;
  activeEvent?: V2EventState | null;
}

export interface V3RunState extends V2RunState {
  sectorId: SectorId;
  endlessThreat?: number;
  endlessMutatorIds?: string[];
  recentEquipmentKinds: string[];
  usedEventIds: string[];
  bonusObjective?: V2ContractBonusObjective;
  tacticalChargesMax: number;
  tacticalChargesUsed: number;
  salvagePartsEarned: number;
  isFinalCampaignRun?: boolean;
}

export interface V2SaveData {
  schemaVersion: typeof V2_SCHEMA_VERSION;
  rulesVersion: typeof V2_RULES_VERSION;
  savedAt: string;
  profile: V2ProfileState;
  activeRun: V2RunState | null;
  settings: GameSettings;
}

export interface V3SaveData {
  schemaVersion: typeof V3_SCHEMA_VERSION;
  rulesVersion: typeof V3_RULES_VERSION;
  savedAt: string;
  profile: V3ProfileState;
  activeRun: V3RunState | null;
  settings: GameSettings;
}

export interface V1SaveData {
  schemaVersion: typeof V1_SCHEMA_VERSION;
  rulesVersion: typeof V1_RULES_VERSION;
  savedAt: string;
  progression: {
    credits: number;
    buildings: { workbench: boolean; display: boolean; drydock: boolean };
    discoveredItems: string[];
    relics: Record<V2RelicId, V2RelicProgress>;
    selectedLoadout: 'cannon_skiff' | 'shield_cruiser';
    selectedRegion: 'standard' | 'abyssal';
    tutorialCompleted: boolean;
    settledExpeditionIds: string[];
    totalExpeditions: number;
    safeReturns: number;
    deepestNodeReached: number;
    totalCreditsEarned: number;
  };
  settings: GameSettings;
  activeExpedition: null;
}

export interface CellCoord {
  x: number;
  y: number;
}

export interface ShipSpec {
  id: V3ShipId;
  name: string;
  cols: number;
  rows: number;
  validCells: number;
  disabledCells: readonly CellCoord[];
  maxHp: number;
  budget: number;
}

export const SHIP_SPECS: Record<V3ShipId, ShipSpec> = {
  cannon_skiff: {
    id: 'cannon_skiff',
    name: '标准炮艇',
    cols: 4,
    rows: 4,
    validCells: 16,
    disabledCells: [],
    maxHp: 30,
    budget: 6,
  },
  shield_cruiser: {
    id: 'shield_cruiser',
    name: '护盾工程艇',
    cols: 4,
    rows: 4,
    validCells: 16,
    disabledCells: [],
    maxHp: 34,
    budget: 6,
  },
  heavy_freighter: {
    id: 'heavy_freighter',
    name: '远航货船',
    cols: 5,
    rows: 4,
    validCells: 18,
    disabledCells: [
      { x: 4, y: 0 },
      { x: 0, y: 3 },
    ],
    maxHp: 28,
    budget: 5,
  },
  stargate_cruiser: {
    id: 'stargate_cruiser',
    name: '星门巡洋舰',
    cols: 5,
    rows: 5,
    validCells: 20,
    disabledCells: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 4 },
      { x: 4, y: 4 },
      { x: 2, y: 4 },
    ],
    maxHp: 38,
    budget: 8,
  },
};

export const SHAPE_FOOTPRINTS: Record<V2ShapeId, readonly CellCoord[]> = {
  '1x1': [{ x: 0, y: 0 }],
  '1x2': [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
  ],
  '1x3': [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: 2 },
  ],
  '2x2': [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ],
  '2x3': [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 0, y: 2 },
    { x: 1, y: 2 },
  ],
  L3: [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ],
  T4: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 1, y: 1 },
  ],
};

export function getOccupiedCells(
  shapeId: V2ShapeId,
  x: number,
  y: number,
  rotation: V2Rotation = 0,
): CellCoord[] {
  let cells = SHAPE_FOOTPRINTS[shapeId].map((c) => ({ x: c.x, y: c.y }));
  for (let step = 0; step < rotation; step += 1) {
    cells = cells.map((c) => ({ x: -c.y, y: c.x }));
    const minX = Math.min(...cells.map((c) => c.x));
    const minY = Math.min(...cells.map((c) => c.y));
    cells = cells.map((c) => ({ x: c.x - minX, y: c.y - minY }));
  }
  return cells.map((c) => ({ x: c.x + x, y: c.y + y }));
}

export interface ItemCatalogMeta {
  shapeId: V2ShapeId;
  defaultValue: number;
  category: 'equipment' | 'cargo' | 'mission' | 'gadget';
}

export const ITEM_CATALOG: Record<string, ItemCatalogMeta> = {
  // Core V2 Equipment (Common & Improved)
  'equipment.laser.common': { shapeId: '1x2', defaultValue: 10, category: 'equipment' },
  'equipment.laser.improved': { shapeId: '1x2', defaultValue: 15, category: 'equipment' },
  'equipment.battery.common': { shapeId: '1x1', defaultValue: 8, category: 'equipment' },
  'equipment.battery.improved': { shapeId: '1x1', defaultValue: 12, category: 'equipment' },
  'equipment.shield.common': { shapeId: '1x2', defaultValue: 10, category: 'equipment' },
  'equipment.shield.improved': { shapeId: '1x2', defaultValue: 15, category: 'equipment' },
  'equipment.repair.common': { shapeId: 'L3', defaultValue: 14, category: 'equipment' },
  'equipment.repair.improved': { shapeId: 'L3', defaultValue: 21, category: 'equipment' },
  'equipment.heavy.common': { shapeId: '1x3', defaultValue: 20, category: 'equipment' },
  'equipment.heavy.improved': { shapeId: '1x3', defaultValue: 30, category: 'equipment' },
  'equipment.capacitor.common': { shapeId: '1x1', defaultValue: 8, category: 'equipment' },
  'equipment.capacitor.improved': { shapeId: '1x1', defaultValue: 12, category: 'equipment' },
  'equipment.hangar.common': { shapeId: '2x2', defaultValue: 20, category: 'equipment' },
  'equipment.hangar.improved': { shapeId: '2x2', defaultValue: 30, category: 'equipment' },
  'equipment.relay.common': { shapeId: '1x1', defaultValue: 8, category: 'equipment' },
  'equipment.relay.improved': { shapeId: '1x1', defaultValue: 12, category: 'equipment' },
  'equipment.counter.common': { shapeId: '1x2', defaultValue: 14, category: 'equipment' },
  'equipment.counter.improved': { shapeId: '1x2', defaultValue: 21, category: 'equipment' },
  'equipment.flak.common': { shapeId: 'T4', defaultValue: 20, category: 'equipment' },
  'equipment.flak.improved': { shapeId: 'T4', defaultValue: 30, category: 'equipment' },

  // V3 New Equipment Modules (M5)
  'equipment.coolant_vent.common': { shapeId: '1x2', defaultValue: 14, category: 'equipment' },
  'equipment.coolant_vent.improved': { shapeId: '1x2', defaultValue: 21, category: 'equipment' },
  'equipment.cargo_amp.common': { shapeId: '1x1', defaultValue: 10, category: 'equipment' },
  'equipment.cargo_amp.improved': { shapeId: '1x1', defaultValue: 15, category: 'equipment' },
  'equipment.emp_jammer.common': { shapeId: '1x2', defaultValue: 16, category: 'equipment' },
  'equipment.emp_jammer.improved': { shapeId: '1x2', defaultValue: 24, category: 'equipment' },
  'equipment.overdrive_core.common': { shapeId: '2x2', defaultValue: 22, category: 'equipment' },
  'equipment.overdrive_core.improved': { shapeId: '2x2', defaultValue: 33, category: 'equipment' },
  'equipment.salvage_grapple.common': { shapeId: '1x2', defaultValue: 14, category: 'equipment' },
  'equipment.salvage_grapple.improved': { shapeId: '1x2', defaultValue: 21, category: 'equipment' },
  'equipment.salvo_pod.common': { shapeId: '1x3', defaultValue: 22, category: 'equipment' },
  'equipment.salvo_pod.improved': { shapeId: '1x3', defaultValue: 33, category: 'equipment' },

  // V3 Consumable 1x1 Tactical Gadgets (M5)
  'gadget.repair_kit': { shapeId: '1x1', defaultValue: 12, category: 'gadget' },
  'gadget.overcharge_cell': { shapeId: '1x1', defaultValue: 14, category: 'gadget' },
  'gadget.jump_canister': { shapeId: '1x1', defaultValue: 12, category: 'gadget' },
  'gadget.cut_stabilizer': { shapeId: '1x1', defaultValue: 12, category: 'gadget' },

  // Cargo & Relics
  'cargo.data_box': { shapeId: '1x1', defaultValue: 7, category: 'cargo' },
  'cargo.alloy_bar': { shapeId: '1x2', defaultValue: 15, category: 'cargo' },
  'cargo.coolant_tank': { shapeId: '1x3', defaultValue: 27, category: 'cargo' },
  'cargo.old_engine': { shapeId: '2x2', defaultValue: 32, category: 'cargo' },
  'cargo.folding_antenna': { shapeId: 'L3', defaultValue: 32, category: 'cargo' },
  'cargo.ancient_navigator': { shapeId: 'T4', defaultValue: 48, category: 'cargo' },
  'cargo.quantum_core': { shapeId: '2x2', defaultValue: 50, category: 'cargo' },
  'cargo.cryo_amber': { shapeId: '1x3', defaultValue: 42, category: 'cargo' },
  'cargo.obsidian_crown': { shapeId: 'L3', defaultValue: 52, category: 'cargo' },

  // Mission Items (MUST have origin: 'mission' and fixedValue: 0)
  'mission.sealed_reactor': { shapeId: '2x3', defaultValue: 0, category: 'mission' },
  'mission.escape_pod': { shapeId: '1x2', defaultValue: 0, category: 'mission' },
  'mission.black_box': { shapeId: '1x2', defaultValue: 0, category: 'mission' },
};

export const INITIAL_BLUEPRINTS: readonly V2EquipmentKind[] = [
  'laser',
  'battery',
  'shield',
  'repair',
];

export const ALL_V2_EQUIPMENT_KINDS: readonly V2EquipmentKind[] = [
  'laser',
  'battery',
  'shield',
  'repair',
  'heavy',
  'capacitor',
  'hangar',
  'relay',
  'counter',
  'flak',
];

export const ALL_V3_NEW_EQUIPMENT_KINDS: readonly V3NewEquipmentKind[] = [
  'coolant_vent',
  'cargo_amp',
  'emp_jammer',
  'overdrive_core',
  'salvage_grapple',
  'salvo_pod',
];

export const ALL_V3_EQUIPMENT_KINDS: readonly V3EquipmentKind[] = [
  ...ALL_V2_EQUIPMENT_KINDS,
  ...ALL_V3_NEW_EQUIPMENT_KINDS,
];

export const ALL_V3_GADGETS: readonly V3GadgetKind[] = [
  'repair_kit',
  'overcharge_cell',
  'jump_canister',
  'cut_stabilizer',
];

export const ALL_RELIC_IDS: readonly V2RelicId[] = [
  'ancient_navigator',
  'quantum_core',
  'cryo_amber',
  'obsidian_crown',
];

export const CREW_NAMES: Record<V2CrewId, string> = {
  engineer: '林工',
  navigator: '陆衡',
  salvager: '苏岚',
};

export const SECTOR_NAMES: Record<SectorId, string> = {
  near_orbit: '近轨残骸带',
  frozen_graveyard: '冰晶舰冢带',
  stargate_abyss: '古代星门禁区',
};

export const FACTION_NAMES: Record<FactionId, string> = {
  starport_guild: '星港行会',
  deep_institute: '深空研究院',
  free_salvagers: '自由拾荒团',
};

export const BOSS_NAMES = {
  act1: '铁砧号',
  act2: '铁壁无畏',
  act3: '黑曜利维坦',
} as const;

export const ENDING_NAMES: Record<EndingId, string> = {
  stargate_reignited: '星门重燃',
  free_haven: '自由港湾',
  fleet_heir: '旧舰队继承者',
};

/**
 * Contracted `data-testid` anchors from PROJECT.md § Interface Contracts #2.
 */
export const TEST_IDS = {
  // Title & Secondary Modes Drawer
  TITLE_SCREEN: 'title-screen',
  BTN_ENTER_STATION: 'btn-enter-station',
  BTN_MORE_MODES: 'btn-more-modes',
  BTN_MODE_SHOWCASE: 'btn-mode-showcase',
  BTN_MODE_V1: 'btn-mode-v1',

  // Base
  BASE_SCREEN: 'base-screen',
  CAMPAIGN_BANNER: 'campaign-banner',
  BTN_OPEN_CAMPAIGN: 'btn-open-campaign',
  BTN_OPEN_CONTRACTS: 'btn-open-contracts',
  BTN_OPEN_FACILITIES: 'btn-open-facilities',
  BTN_OPEN_WAREHOUSE: 'btn-open-warehouse',
  BTN_OPEN_RELICS: 'btn-open-relics',
  BTN_OPEN_CODEX: 'btn-open-codex',
  BTN_OPEN_CAREER: 'btn-open-career',
  BTN_START_TUTORIAL: 'btn-start-tutorial',
  BTN_START_RECOMMENDED: 'btn-start-recommended',

  // Prepare
  PREPARE_SCREEN: 'prepare-screen',
  SECTOR_SELECTOR: 'sector-selector',
  SHIP_SELECTOR: 'ship-selector',
  CREW_SELECTOR: 'crew-selector',
  BTN_LAUNCH_EXPEDITION: 'btn-launch-expedition',

  // Map
  MAP_SCREEN: 'map-screen',
  BTN_JUMP_NODE: 'btn-jump-node',
  BTN_SAFE_RETURN: 'btn-safe-return',
  mapNode: (id: string) => `map-node-${id}`,

  // Combat
  COMBAT_SCREEN: 'combat-screen',
  BTN_START_COMBAT: 'btn-start-combat',
  COMBAT_TACTICAL_BAR: 'combat-tactical-bar',
  BTN_COMBAT_SKIP: 'btn-combat-skip',
  tacticalOrder: (id: string) => `tactical-order-${id}`,

  // Wreck
  WRECK_SCREEN: 'wreck-screen',
  WRECK_STABILITY: 'wreck-stability',
  BTN_WRECK_EXTRACT: 'btn-wreck-extract',
  wreckCut: (spot: string) => `wreck-cut-${spot}`,

  // Event
  EVENT_SCREEN: 'event-screen',
  eventChoice: (index: number) => `event-choice-${index}`,

  // Shop / Reward / Arrange
  SHOP_SCREEN: 'shop-screen',
  ENGINEER_SWAP_BANNER: 'engineer-swap-banner',
  REWARD_SCREEN: 'reward-screen',
  ARRANGE_SCREEN: 'arrange-screen',
  BTN_LEAVE_ARRANGE: 'btn-leave-arrange',

  // Settlement / Ending
  SETTLEMENT_SCREEN: 'settlement-screen',
  BTN_CONFIRM_SETTLEMENT: 'btn-confirm-settlement',
  ENDING_SCREEN: 'ending-screen',
  BTN_ENDING_CONTINUE: 'btn-ending-continue',
  endingChoice: (id: EndingId | string) => `ending-choice-${id}`,
} as const;

export const DEV_JARGON_BLOCKLIST: readonly string[] = [
  '确定性模拟',
  '只读预览',
  '2:1',
  'schemaVersion',
  'undefined',
  'NaN',
  '制造优良件',
];
