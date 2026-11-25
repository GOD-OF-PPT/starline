import { getItemImageUrl } from '../../assets/itemArt';
import { soundEngine } from '../../audio/soundEngine';
import { createRandomSeed } from '../../domain/rng';
import { MultiTabGuard } from '../../domain/tabLock';
import type { ReturnDockingCargoItem, V2BaseDioramaState } from '../../scenes/BaseScene';
import { PhaserHost } from '../../scenes/PhaserHost';
import { hasOpenModal, registerModalBackgroundRoot } from '../../ui/Modals';
import { CAMPAIGN_CHAPTERS, type CampaignCommTrigger } from '../data/campaign';
import { V2_CREW, type V2CrewId } from '../data/crew';
import {
  V2_ALL_EQUIPMENT_KINDS,
  V2_EQUIPMENT_DEFS,
  getV2EquipmentDefByKind,
  type V2EquipmentKind,
  type V2UnlockFamilyId,
} from '../data/equipment';
import {
  V2_RELICS,
  V2_RELIC_ORDER,
  V3_STATION_FACILITIES,
  type V3StationFacilityId,
} from '../data/facilities';
import { V3_FACTIONS } from '../data/factions';
import { getV3GadgetDef, type V3GadgetKind } from '../data/gadgets';
import { getV3SectorDef } from '../data/sectors';
import { V2_SHIPS, V2_SHIP_ORDER, type V2ShipId } from '../data/ships';
import { createV2ShowcaseRun } from '../data/showcaseRun';
import {
  V2_TRIAL_BUILDS,
  buildTrialPrepareSlots,
  getTrialDemoUnits,
} from '../data/trialBuilds';
import { V2_TUTORIAL_HINTS, createV2TutorialRun } from '../data/tutorialV2';
import { claimV3Achievement } from '../domain/achievements';
import {
  calculateV2BuildStats,
  detectNewlyActivatedSynergies,
  recordV2DiscoveredSynergies,
  type V2SynergyCatalogEntry,
} from '../domain/buildStatsV2';
import {
  getActiveCampaignObjective,
  getTriggeredCommForContext,
  isFinalCampaignMissionUnlocked,
  isRunPendingCampaignEnding,
  markCampaignCommRead,
  markCampaignCommsRead,
} from '../domain/campaign';
import {
  commitV2EliteTacticDecision,
  commitV2ModuleOverload,
  completeV2CombatAtCurrentNode,
  getTacticalCommandLabel,
  listV2OverloadableModules,
  markV2CombatDecisionPaused,
  setV2LiveCombatLockedEnemy,
  setV2PreCombatLockedEnemy,
  simulateV2Combat,
  startV2CombatAtCurrentNode,
} from '../domain/combatV2';
import {
  abortActiveV2Contract,
  countEscapePodsInBay,
  performSurveyAtCurrentNode,
  pickRecommendedV2ContractId,
} from '../domain/contracts';
import {
  buildActiveWreckStateForNode,
  craftV2EquipmentWithParts,
  dismantleV2WarehouseItem,
  evaluateWreckHotspotCut,
  getEffectiveShipLoadoutBudget,
  getEffectiveShipMaxHp,
  tuneV2ShipHull,
  upgradeV2EquipmentToImproved,
} from '../domain/dismantle';
import {
  abandonV2EventAndReturn,
  applyV2EngineerSwap,
  buyV2MerchantFuel,
  buyV2MerchantOffer,
  buyV2MerchantRepair,
  cutV2WreckHotspot,
  extractV2Wreck,
  finishV2ArrangeAndProceed,
  finishV2MerchantVisit,
  getV2SafeReturnStatus,
  initiateV2EmergencyTowReturn,
  initiateV2SafeReturnFromMap,
  pickV2CombatReward,
  resolveV2AnomalyChoice,
  resolveV2DistressChoice,
  resolveV2EventOption,
  selectV2MapNode,
  sellV2ItemToMerchant,
  useV3GadgetInRun,
} from '../domain/encounter';
import { findFirstLegalV2Placement } from '../domain/inventoryV2';
import {
  collectVisibleV2DefIdsForRun,
  createV2EquipmentInstance,
  createV3GadgetInstance,
  recordV2SeenItems,
} from '../domain/itemCatalog';
import {
  buildFreeFallbackPrepareSlots,
  deleteV2LoadoutPreset,
  launchV2Expedition,
  parseV3CustomSeedInput,
  resolveV2PresetAgainstWarehouse,
  saveV2LoadoutPreset,
  validateV2PrepareLoadout,
  type V2PrepareSlotEntry,
} from '../domain/loadout';
import {
  inspectV1SaveForMigration,
  migrateV1ToV2SaveData,
  type V1MigrationInspection,
} from '../domain/migration';
import {
  clearV2SaveData,
  createFreshV2SaveData,
  loadV2SaveData,
  persistV2SaveData,
} from '../domain/persistenceV2';
import {
  canResearchV2Instance,
  canRestoreV2Relic,
  canUpgradeV3Facility,
  choosePendingV2FamilyUnlock,
  claimV2PendingGiftToWarehouse,
  craftV2CommonEquipment,
  craftV3GadgetWithParts,
  getActiveRelicPassives,
  getEffectiveV2ResearchCost,
  getEffectiveWarehouseCapacity,
  getFacilityTier,
  getV2RelicSummary,
  researchV2Equipment,
  restoreV2Relic,
  sellV2PendingGift,
  sellV2WarehouseItem,
  upgradeV3Facility,
} from '../domain/progressionV2';
import { deriveSessionRunSeed, parseDeterministicSeedParam } from '../domain/seedParam';
import {
  applyV2Settlement,
  calculateV2Settlement,
  finalizeClimaxEnding,
} from '../domain/settlementV2';
import { deriveV2ShipVisualSpec } from '../domain/shipVisualSpec';
import { computeV2PlacementTacticalDelta } from '../domain/tacticalDelta';
import {
  V2_TAB_CHANNEL,
  V2_TAB_LOCK_KEY,
  isPureAutoCombat,
  type EndingId,
  type FactionId,
  type SectorId,
  type V2CargoBayState,
  type V2CombatRoundLog,
  type V2CombatUnitSnapshot,
  type V2MapNode,
  type V2PlacedItem,
  type V2ProfileState,
  type V2RunState,
  type V2SaveData,
  type V2SettlementDisposition,
  type V2TrialBuildId,
  type V2WreckSpotId,
  type V3HullTuningTrack,
} from '../domain/types';
import {
  CargoGridV2Component,
  isHeavyPlacementItem,
  type CargoGridV2Callbacks,
} from './CargoGridV2';
import { crewPortraitSvg, svgIcon } from './icons';
import {
  buildV2InspectSnapshot,
  type StarlineInspectSnapshot,
  type StarlineScreenId,
} from './inspectSnapshot';
import {
  PlaytestTelemetryLogger,
  isPlaytestParamEnabled,
} from './playtestTelemetry';
import { openV3CampaignModal, type CampaignModalTab } from './modals/CampaignModal';
import { openV3CareerModal, type CareerModalTab } from './modals/CareerModal';
import { ArrangePhaseView } from './screens/ArrangeView';
import { BasePhaseView } from './screens/BaseView';
import {
  CombatLivePhaseView,
  CombatPrePhaseView,
  PreCombatAutoEngageController,
  updateCombatPreAutoEngageUi,
} from './screens/CombatView';
import { EndingPhaseView } from './screens/EndingView';
import { EventPhaseView } from './screens/EventView';
import { MapPhaseView } from './screens/MapView';
import { PreparePhaseView } from './screens/PrepareView';
import { RewardPhaseView } from './screens/RewardView';
import {
  ManagedViewSlot,
  NODE_TYPE_META,
  V2StaticStageSyncTracker,
  type NextBaseGoal,
  type V2PrepareDraft,
  type V2ReturnDockingNotice,
  type V2StaticStageMode,
} from './screens/screenTypes';
import {
  SettlementBillRollupController,
  SettlementPhaseView,
} from './screens/SettlementView';
import { ShopPhaseView } from './screens/ShopView';
import { TitlePhaseView } from './screens/TitleView';
import type { V2StageOverloadModuleSpec } from '../scenes/V2CombatScene';
import {
  VFX_WRECK_CLAMP_POP_RATIO,
  VFX_WRECK_CUT_DURATION_MS,
  VFX_WRECK_FLIP_DURATION_MS,
  type WreckCompartmentVisualState,
} from '../scenes/v2CombatVfx';
import {
  WRECK_SPOT_COORDS,
  WreckOverlayPhaseView,
  WreckPhaseView,
  type WreckHotspotId,
} from './screens/WreckView';
import { resolveV2BgmTrack } from './v2AudioTrack';
import {
  openV1MigrationModal,
  openV2BackupRecoveryModal,
  openV2CargoPeekModal,
  openV2CodexModal,
  openV2ContractsDrawerModal,
  openV2DiscardConfirmModal,
  openV2FacilitiesDrawerModal,
  openV2HelpModal,
  openV2MoreModesModal,
  openV2RelicGalleryModal,
  openV2SettingsModal,
  openV2ShowcasePickerModal,
  openV2WarehouseModal,
  subscribeV2ModalOpen,
} from './V2Modals';

const V2_TITLE_SESSION_KEY = 'starline_v2_title_entered';

export interface V2ControllerOptions {
  readonly onSwitchToV1: () => void;
}

export class V2AppController {
  private readonly mountEl: HTMLElement;
  private readonly options: V2ControllerOptions;
  private readonly urlBaseSeed: number | null;

  private save: V2SaveData;
  /** Isolated 4-node showcase run (strictly in-memory; NEVER mutates formal profile/save!) */
  private showcaseRun: V2RunState | null = null;
  private phaserHost: PhaserHost | null = null;
  private cargoGrid: CargoGridV2Component | null = null;
  private cargoHeaderTitleEl: HTMLElement | null = null;
  private cargoHeaderSubEl: HTMLElement | null = null;
  private cargoMountEl: HTMLElement | null = null;
  private titleViewSlot!: ManagedViewSlot<'TITLE'>;
  private endingViewSlot!: ManagedViewSlot<'ENDING'>;
  private overlayViewSlot!: ManagedViewSlot<'BASE' | 'COMBAT_LIVE' | 'WRECK_OVERLAY'>;
  private leftViewSlot!: ManagedViewSlot<
    | 'PREPARE'
    | 'MAP'
    | 'COMBAT_PRE'
    | 'WRECK'
    | 'EVENT'
    | 'SHOP'
    | 'REWARD'
    | 'ARRANGE'
    | 'SETTLEMENT'
  >;
  private lastStaticOverlayKey: string | null = null;

  private readonly titlePhaseView = new TitlePhaseView();
  private readonly endingPhaseView = new EndingPhaseView();
  private readonly basePhaseView = new BasePhaseView();
  private readonly combatLivePhaseView = new CombatLivePhaseView();
  private readonly wreckOverlayPhaseView = new WreckOverlayPhaseView();
  private readonly preparePhaseView = new PreparePhaseView();
  private readonly mapPhaseView = new MapPhaseView();
  private readonly combatPrePhaseView = new CombatPrePhaseView();
  private readonly wreckPhaseView = new WreckPhaseView();
  private readonly eventPhaseView = new EventPhaseView();
  private readonly shopPhaseView = new ShopPhaseView();
  private readonly rewardPhaseView = new RewardPhaseView();
  private readonly arrangePhaseView = new ArrangePhaseView();
  private readonly settlementPhaseView = new SettlementPhaseView();
  private tabGuard: MultiTabGuard;

  private sessionLaunchIndex = 0;
  private destroyed = false;
  private isReadOnlyTab = false;
  private storageError: string | null = null;
  private actionToast: string | null = null;
  private actionToastTimer: number | null = null;
  private recentlyBuiltPin: string | null = null;
  private titleEntered = false;
  private v1Inspection: V1MigrationInspection;
  private migrationPromptDismissed = false;

  private prepareDraft: V2PrepareDraft | null = null;
  private settlementDispositions: Record<string, V2SettlementDisposition> = {};
  private sceneCollapseOverride: boolean | null = null;
  private activeDockingNotice: V2ReturnDockingNotice | null = null;
  private campaignBannerCollapsed = false;
  private preferredSectorId: SectorId | null = null;
  private selectedEndingId: EndingId | null = null;
  private endingGalleryId: EndingId | null = null;
  private activeCommBanner: {
    readonly id: string;
    readonly speakerId: V2CrewId;
    readonly title: string;
    readonly text: string;
  } | null = null;
  private activeSynergyToast: { readonly entries: readonly V2SynergyCatalogEntry[] } | null = null;
  private synergyToastTimer: number | null = null;

  // Interactive focus states for unified Map & 3-hotspot Wreck
  private selectedMapNodeId: string | null = null;
  private selectedWreckHotspot: WreckHotspotId = 'armory';
  private mobileMapShowFull = false;
  private mobileHoldZoomed = false;
  private lastViewportPhaseKey: string | null = null;
  private lastCompactViewport = typeof window !== 'undefined' ? window.innerWidth < 860 : false;
  private failedAssetKeys: string[] = [];

  // Live combat playback display telemetry (pure presentation)
  private activeCombatPlaybackKey: string | null = null;
  private readonly staticStageTracker = new V2StaticStageSyncTracker();
  private readonly preCombatAutoEngage: PreCombatAutoEngageController;
  private readonly settlementRollup = new SettlementBillRollupController();
  private readonly playtestTelemetry: PlaytestTelemetryLogger;
  private settledRollupRunId: string | null = null;
  private settledRunsCountInSession = 0;
  private unsubscribeModalOpen: (() => void) | null = null;
  private liveCombatRound = 0;
  private liveCombatPlayerHp = 30;
  private liveCombatPlayerShield = 0;
  private liveCombatEnemiesAlive = 0;
  private liveCombatEventLine = '';
  private liveEnemySnapshots: readonly V2CombatUnitSnapshot[] = [];
  private livePhaseBannerText: string | null = null;
  private awaitingEliteDecision = false;
  private showCombatLogDetails = false;
  private inFlightWreckCut: {
    readonly runId: string;
    readonly nodeId: string;
    readonly spotId: V2WreckSpotId;
    readonly normX: number;
    readonly normY: number;
    readonly willAmbush: boolean;
    readonly flipItemDefIds: readonly string[];
    phase: 'cutting' | 'flipping';
    clampPopped: boolean;
    clampTimerId: number | null;
    cutTimerId: number | null;
    flipTimerId: number | null;
    flipEls: HTMLElement[];
  } | null = null;

  // Persistent DOM anchors so Phaser canvas never flickers
  private appShellEl!: HTMLElement;
  private titleHostEl!: HTMLElement;
  private endingHostEl!: HTMLElement;
  private topHudEl!: HTMLElement;
  private bannersEl!: HTMLElement;
  private mainLayoutEl!: HTMLElement;
  private sceneWrapEl!: HTMLElement;
  private sceneCanvasHostEl!: HTMLElement;
  private sceneOverlayEl!: HTMLElement;
  private leftPanelEl!: HTMLElement;
  private rightPanelEl!: HTMLElement;
  private modalHostEl!: HTMLElement;
  private selectedSettlementFamilyUnlock: V2UnlockFamilyId | null = null;

  constructor(mountEl: HTMLElement, options: V2ControllerOptions) {
    this.mountEl = mountEl;
    this.options = options;
    this.urlBaseSeed = parseDeterministicSeedParam(
      typeof window !== 'undefined' ? window.location.search : ''
    );
    const playtestEnabled = isPlaytestParamEnabled(
      typeof window !== 'undefined' ? window.location.search : ''
    );
    this.playtestTelemetry = new PlaytestTelemetryLogger({
      enabled: playtestEnabled,
      storage: playtestEnabled && typeof window !== 'undefined' ? window.localStorage : null,
    });
    this.save = createFreshV2SaveData();
    this.v1Inspection = inspectV1SaveForMigration(window.localStorage);

    this.preCombatAutoEngage = new PreCombatAutoEngageController({
      onEngage: (nodeKey) => this.engageCurrentCombat(nodeKey),
      onChange: () => this.refreshPreCombatAutoEngageUi(),
      isLiveEligible: (expectedKey) => this.getPreCombatAutoEngageLiveEligibility(expectedKey),
    });

    this.tabGuard = new MultiTabGuard(
      (isOwner) => {
        if (this.destroyed || typeof window === 'undefined') return;
        this.isReadOnlyTab = !isOwner;
        if (this.isReadOnlyTab) {
          this.preCombatAutoEngage.pause('readonly');
          this.cancelInFlightWreckCut();
        }
        this.phaserHost?.setCombatPaused(this.isReadOnlyTab);
        this.syncAll();
      },
      { lockKey: V2_TAB_LOCK_KEY, channelName: V2_TAB_CHANNEL }
    );
  }

  private getBonusBossCharges(): number {
    return getActiveRelicPassives(this.save.profile).bossTacticalChargeBonus;
  }

  private getCurrentRun(): V2RunState | null {
    return this.showcaseRun ?? this.save.activeRun;
  }

  private setCurrentRun(next: V2RunState | null): void {
    if (this.showcaseRun) {
      this.showcaseRun = next;
      return;
    }
    let nextProfile = this.save.profile;
    if (next && !next.isShowcase) {
      nextProfile = recordV2SeenItems(nextProfile, collectVisibleV2DefIdsForRun(next));
    }
    this.save = { ...this.save, profile: nextProfile, activeRun: next };
    this.persist();
  }

  private computeCurrentScreen(): StarlineScreenId {
    const run = this.getCurrentRun();
    if (this.endingGalleryId !== null || isRunPendingCampaignEnding(run)) return 'ending';
    if (!this.titleEntered && !run) return 'title';
    if (run) return 'run';
    if (this.prepareDraft) return 'prepare';
    return 'base';
  }

  private buildInspectSnapshot(): StarlineInspectSnapshot {
    return buildV2InspectSnapshot({
      save: this.save,
      activeRun: this.getCurrentRun(),
      screen: this.computeCurrentScreen(),
      phaserScene: this.phaserHost?.getActiveSceneKey() ?? null,
      bgmTrack: soundEngine.getCurrentTrack(),
      liveCombatRound: this.liveCombatRound,
      awaitingEliteDecision: this.awaitingEliteDecision,
      failedAssets: this.failedAssetKeys,
      modalOpen: hasOpenModal(),
    });
  }

  init(): void {
    this.buildShellDom();
    this.titleEntered = this.readTitleSession();

    const loaded = loadV2SaveData(window.localStorage);
    let migratedOnBoot = false;
    if (loaded.status === 'loaded' || loaded.status === 'fresh') {
      this.save = loaded.data;
      migratedOnBoot =
        loaded.status === 'loaded' &&
        Boolean(loaded.migratedFromV2 || loaded.migratedFromV3_0);
    } else if (loaded.status === 'corrupt_with_backup') {
      this.save = loaded.backup;
      this.titleEntered = true;
      openV2BackupRecoveryModal(this.modalHostEl, {
        error: loaded.error,
        hasBackup: true,
        onRestoreBackup: () => {
          this.staticStageTracker.reset();
          this.activeCombatPlaybackKey = null;
          this.save = loaded.backup;
          this.persist();
          this.syncAll();
        },
        onResetFresh: () => {
          this.staticStageTracker.reset();
          this.activeCombatPlaybackKey = null;
          clearV2SaveData(window.localStorage);
          this.save = createFreshV2SaveData();
          this.persist();
          this.syncAll();
        },
      });
    } else {
      this.save = loaded.data;
      this.titleEntered = true;
      openV2BackupRecoveryModal(this.modalHostEl, {
        error: loaded.error,
        hasBackup: false,
        onResetFresh: () => {
          this.staticStageTracker.reset();
          this.activeCombatPlaybackKey = null;
          clearV2SaveData(window.localStorage);
          this.save = createFreshV2SaveData();
          this.persist();
          this.syncAll();
        },
      });
    }

    if (this.save.activeRun) {
      this.titleEntered = true;
      this.writeTitleSession(true);
    }
    this.campaignBannerCollapsed = !this.save.profile.tutorialCompleted;

    this.applySettingsEffects();

    this.phaserHost = new PhaserHost(this.sceneCanvasHostEl);
    this.phaserHost.onBuildingClick((buildingId) => {
      if (hasOpenModal() || this.getCurrentRun() || this.prepareDraft) return;
      soundEngine.play('click');
      if (buildingId === 'workbench') {
        this.openWarehouseModal('warehouse');
      } else if (buildingId === 'display') {
        this.openRelicGalleryModal();
      } else if (buildingId === 'drydock') {
        this.openFacilitiesModal();
      }
    });
    this.phaserHost.onBerthClick(() => {
      if (hasOpenModal() || this.getCurrentRun() || this.prepareDraft || !this.canMutate()) return;
      soundEngine.play('click');
      const p = this.save.profile;
      if (!p.tutorialCompleted && p.totalRuns === 0) {
        this.startTutorialRun();
        return;
      }
      this.openPrepareForContract(this.pickRecommendedContractId(p));
    });
    this.phaserHost.onAssetLoadError((failedKeys) => {
      this.failedAssetKeys = failedKeys;
      this.renderBanners();
    });

    this.tabGuard.start();
    this.isReadOnlyTab = !this.tabGuard.canWrite();

    if (migratedOnBoot && !this.isReadOnlyTab && this.tabGuard.canWrite()) {
      this.persist();
    }

    window.__STARLINE_INSPECT__ = () => this.buildInspectSnapshot();
    window.addEventListener('resize', this.handleWindowResize);
    window.addEventListener('orientationchange', this.handleWindowResize);
    if (this.playtestTelemetry.isEnabled()) {
      this.mountEl.addEventListener('click', this.handlePlaytestMountClick, true);
    }
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
    this.unsubscribeModalOpen?.();
    this.unsubscribeModalOpen = subscribeV2ModalOpen(() => {
      this.cargoGrid?.cancelActiveDrag(true);
      if (this.preCombatAutoEngage.pause('modal')) {
        this.refreshPreCombatAutoEngageUi();
      }
      const hadInFlightCut = this.inFlightWreckCut !== null;
      this.cancelInFlightWreckCut();
      if (hadInFlightCut) {
        const run = this.getCurrentRun();
        const node = run?.currentNodeId ? run.graph.nodes[run.currentNodeId] ?? null : null;
        if (
          run &&
          run.phase === 'ENCOUNTER' &&
          node &&
          node.type === 'wreck' &&
          !node.resolved &&
          !node.combat
        ) {
          this.syncWreckCompartmentsToPhaser(run, node, null);
          this.renderWreckOverlay(run, node);
          this.renderEncounterPhase(run);
        }
      }
    });

    this.syncAll();

    if (
      this.titleEntered &&
      this.shouldOfferMigrationPrompt() &&
      !this.migrationPromptDismissed
    ) {
      this.openMigrationWizard();
    }
  }

  destroy(): void {
    this.destroyed = true;
    delete window.__STARLINE_INSPECT__;
    soundEngine.setTrack('none');
    window.removeEventListener('resize', this.handleWindowResize);
    window.removeEventListener('orientationchange', this.handleWindowResize);
    if (this.playtestTelemetry.isEnabled()) {
      this.mountEl.removeEventListener('click', this.handlePlaytestMountClick, true);
    }
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    this.unsubscribeModalOpen?.();
    this.unsubscribeModalOpen = null;
    this.activeDockingNotice = null;
    this.cancelInFlightWreckCut();
    this.cancelSettlementRollup();
    this.preCombatAutoEngage.destroy();
    if (this.actionToastTimer !== null) {
      window.clearTimeout(this.actionToastTimer);
      this.actionToastTimer = null;
    }
    if (this.synergyToastTimer !== null) {
      window.clearTimeout(this.synergyToastTimer);
      this.synergyToastTimer = null;
    }
    this.activeSynergyToast = null;
    this.staticStageTracker.reset();
    this.activeCombatPlaybackKey = null;
    this.lastStaticOverlayKey = null;
    this.titleViewSlot?.unmount(true);
    this.endingViewSlot?.unmount(true);
    this.overlayViewSlot?.unmount(true);
    this.leftViewSlot?.unmount(true);
    this.teardownCargoBay();
    this.tabGuard.destroy();
    this.phaserHost?.destroy();
    this.phaserHost = null;
    this.mountEl.innerHTML = '';
  }

  private readonly handleVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && document.hidden) {
      this.cargoGrid?.cancelActiveDrag(true);
      if (this.preCombatAutoEngage.pause('hidden')) {
        this.refreshPreCombatAutoEngageUi();
      }
    }
  };

  private getPreCombatAutoEngageLiveEligibility(expectedKey?: string): {
    readonly eligible: boolean;
    readonly nodeKey: string | null;
    readonly canMutate: boolean;
    readonly modalOpen: boolean;
    readonly hidden: boolean;
  } {
    const run = this.getCurrentRun();
    const node = run?.currentNodeId ? run.graph.nodes[run.currentNodeId] ?? null : null;
    const nodeKey = run && run.currentNodeId ? `${run.runId}:${run.currentNodeId}` : null;
    const eligible = Boolean(
      this.computeCurrentScreen() === 'run' &&
        run &&
        run.phase === 'ENCOUNTER' &&
        node?.combat &&
        !run.activeCombat &&
        run.bay.staging.length === 0 &&
        (!expectedKey || nodeKey === expectedKey)
    );
    const modalOpen = hasOpenModal();
    const hidden = typeof document !== 'undefined' && Boolean(document.hidden);
    const canMutate = this.canMutate();
    return { eligible, nodeKey: eligible ? nodeKey : null, canMutate, modalOpen, hidden };
  }

  private refreshPreCombatAutoEngageUi(): void {
    if (!this.leftPanelEl) return;
    const run = this.getCurrentRun();
    const readOnly = this.isReadOnlyTab && !(run?.isShowcase ?? false);
    updateCombatPreAutoEngageUi(
      this.leftPanelEl,
      this.preCombatAutoEngage.getSnapshot(),
      readOnly
    );
  }

  private engageCurrentCombat(expectedNodeKey?: string): boolean {
    if (!this.canMutate()) return false;
    const latest = this.getCurrentRun();
    if (!latest || latest.phase !== 'ENCOUNTER' || !latest.currentNodeId) return false;
    if (latest.activeCombat) return false;
    if (latest.bay.staging.length > 0) return false;
    const node = latest.graph.nodes[latest.currentNodeId];
    if (!node?.combat) return false;
    const curKey = `${latest.runId}:${latest.currentNodeId}`;
    if (expectedNodeKey && expectedNodeKey !== curKey) return false;

    this.preCombatAutoEngage.markEngaged(curKey);
    const curPureAuto = isPureAutoCombat(this.save.settings);
    const res = startV2CombatAtCurrentNode(latest, latest.targetPolicy, {
      enableTacticalCommands: !curPureAuto,
      pureAutoCombat: curPureAuto,
      bonusBossCharges: this.getBonusBossCharges(),
      stargateRelayTier: getFacilityTier(this.save.profile, 'stargate_relay'),
    });
    if (!res.ok) {
      this.showToast(res.error ?? '无法开始战斗');
      return false;
    }
    this.setCurrentRun(res.run);
    soundEngine.play('chargeUp');
    this.syncAll();
    return true;
  }

  private buildStageOverloadSpecs(bay: V2CargoBayState): readonly V2StageOverloadModuleSpec[] {
    return listV2OverloadableModules(bay).map((m) => ({
      instanceId: m.instanceId,
      kind: m.kind,
      label: m.name,
    }));
  }

  private computeLiveCombatPlaybackKey(run: V2RunState, nodeId: string): string {
    const ac = run.activeCombat;
    if (!ac) return 'none';
    const pending = ac.pendingDecision;
    const committedCount = ac.committedCommands?.length ?? 0;
    const ivCount = ac.interventions?.length ?? 0;
    return `${run.runId}_${nodeId}_${ac.simulation.resultId}_${pending?.decisionId ?? 'none'}_${
      pending?.chosen ?? 'open'
    }_${committedCount}_${ivCount}_${run.tacticalChargesUsed}`;
  }

  private handleToggleEnemyLock(enemyId: string): void {
    if (!this.canMutate()) return;
    const latest = this.getCurrentRun();
    if (!latest || latest.phase !== 'ENCOUNTER' || !latest.currentNodeId) return;

    if (!latest.activeCombat) {
      const node = latest.graph.nodes[latest.currentNodeId];
      if (
        !node?.combat ||
        (node.combat.units.length <= 1 && (latest.lockedEnemyId ?? null) === null)
      ) {
        return;
      }
      const res = setV2PreCombatLockedEnemy(latest, enemyId);
      if (!res.ok) return;
      this.preCombatAutoEngage.pause('policy');
      this.setCurrentRun(res.run);
      soundEngine.play('tacticalOrder');
      this.phaserHost?.updateV2LockedEnemy(res.run.lockedEnemyId ?? null);
      this.renderEncounterPhase(res.run);
      return;
    }

    const relayTier = getFacilityTier(this.save.profile, 'stargate_relay');
    const effectiveCurrentRound = this.awaitingEliteDecision
      ? this.liveCombatRound
      : Math.max(this.liveCombatRound, this.phaserHost?.getV2CurrentDispatchedRound() ?? 0);
    const res = setV2LiveCombatLockedEnemy(latest, enemyId, effectiveCurrentRound, {
      stargateRelayTier: relayTier,
    });
    if (!res.ok || !res.run.activeCombat) {
      if (res.error) this.showToast(res.error);
      return;
    }
    this.setCurrentRun(res.run);
    soundEngine.play('tacticalOrder');
    this.activeCombatPlaybackKey = this.computeLiveCombatPlaybackKey(
      res.run,
      res.run.currentNodeId!
    );
    const nextPending = res.run.activeCombat.pendingDecision;
    const nextNeedsDecision = Boolean(nextPending && nextPending.chosen === null);
    if (!nextNeedsDecision) {
      this.awaitingEliteDecision = false;
    }
    this.phaserHost?.patchV2LiveCombatSimulation(res.run.activeCombat.simulation, {
      pauseAtRound: nextNeedsDecision && nextPending ? nextPending.roundNumber : null,
      lockedEnemyId: res.run.lockedEnemyId ?? null,
      canOverloadModules: this.awaitingEliteDecision && nextNeedsDecision && this.canMutate(),
      overloadableModules: this.buildStageOverloadSpecs(res.run.bay),
    });
    this.renderCombatPlaybackOverlay(res.run);
  }

  private handleCommitModuleOverload(decisionId: string, moduleInstanceId: string): void {
    if (!this.canMutate()) return;
    const cur = this.getCurrentRun();
    if (!cur) return;
    const res = commitV2ModuleOverload(cur, decisionId, moduleInstanceId, {
      stargateRelayTier: getFacilityTier(this.save.profile, 'stargate_relay'),
    });
    if (!res.ok) {
      this.showToast(res.error ?? '部件过载不可用');
      return;
    }
    this.awaitingEliteDecision = false;
    this.activeCombatPlaybackKey = null;
    this.livePhaseBannerText = null;
    this.setCurrentRun(res.run);
    const mk = res.moduleKind;
    if (mk === 'battery') soundEngine.play('energyLink');
    else if (mk === 'shield' || mk === 'counter' || mk === 'coolant_vent') soundEngine.play('shieldOverload');
    else if (mk === 'repair') soundEngine.play('repairPulse');
    else if (mk === 'heavy' || mk === 'capacitor') soundEngine.play('heavyBlast');
    else soundEngine.play('tacticalOrder');
    this.syncAll();
  }

  /**
   * D03: Records first-time synergy discovery ONLY on player-initiated editable bay edits
   * (strictly suppressed on boot/reload/demo/trial/showcase/readOnly) and renders a non-blocking
   * `"新联动！"` banner without calling `syncAll()`.
   */
  private handlePlayerInitiatedBaySynergies(
    bay: V2CargoBayState,
    opts?: {
      readonly isTrialOrShowcase?: boolean;
      readonly playSfx?: boolean;
      readonly skipRenderBanners?: boolean;
      readonly prevBay?: V2CargoBayState;
    }
  ): void {
    if (this.isReadOnlyTab || !this.tabGuard.canWrite() || this.showcaseRun || opts?.isTrialOrShowcase) {
      return;
    }
    const stats = calculateV2BuildStats(bay);
    const newly = detectNewlyActivatedSynergies(stats, this.save.profile.discoveredSynergies);
    if (newly.length === 0) return;
    const nextProfile = recordV2DiscoveredSynergies(
      this.save.profile,
      newly.map((e) => e.id)
    );
    if (nextProfile === this.save.profile) return;
    this.save = { ...this.save, profile: nextProfile };
    this.persist();
    let shouldPlayDiscoverySfx = Boolean(opts?.playSfx);
    if (!shouldPlayDiscoverySfx) {
      const gridHasPendingSnap = this.cargoGrid?.hasPendingSnapFeedback() ?? false;
      if (!gridHasPendingSnap) {
        shouldPlayDiscoverySfx = true;
      } else if (opts?.prevBay) {
        const prevStats = calculateV2BuildStats(opts.prevBay);
        const prevSigs = new Set(
          prevStats.links.map((l) => `${l.sourceInstanceId}->${l.targetInstanceId}:${l.sourceKind}`)
        );
        const gridWillDetectNewLink = stats.links.some(
          (l) => !prevSigs.has(`${l.sourceInstanceId}->${l.targetInstanceId}:${l.sourceKind}`)
        );
        if (!gridWillDetectNewLink) {
          shouldPlayDiscoverySfx = true;
        }
      }
    }
    if (shouldPlayDiscoverySfx) {
      soundEngine.play('energyLink');
    }
    this.activeSynergyToast = { entries: newly };
    if (this.synergyToastTimer !== null) {
      window.clearTimeout(this.synergyToastTimer);
    }
    this.synergyToastTimer = window.setTimeout(() => {
      if (this.destroyed) return;
      this.activeSynergyToast = null;
      this.synergyToastTimer = null;
      this.renderBanners();
    }, 4800);
    if (!opts?.skipRenderBanners) {
      this.renderBanners();
    }
  }

  private handleWindowResize = (): void => {
    const nextCompact = window.innerWidth < 860;
    const breakpointFlipped = nextCompact !== this.lastCompactViewport;
    this.lastCompactViewport = nextCompact;
    this.applyViewportClasses();
    this.phaserHost?.resize();
    this.renderTopHud();
    if (breakpointFlipped) {
      this.renderPanels();
    }
  };

  private canMutate(): boolean {
    if (this.showcaseRun) return !hasOpenModal();
    return !this.isReadOnlyTab && this.tabGuard.canWrite() && !hasOpenModal();
  }

  private isArrangeSceneCollapsed(): boolean {
    if (this.sceneCollapseOverride !== null) return this.sceneCollapseOverride;
    return false;
  }

  private shouldOfferMigrationPrompt(): boolean {
    return (
      this.v1Inspection.hasV1Save &&
      !this.save.profile.migrationRecord &&
      this.save.profile.totalRuns === 0 &&
      !this.save.activeRun &&
      !this.showcaseRun
    );
  }

  private readTitleSession(): boolean {
    try {
      return window.sessionStorage.getItem(V2_TITLE_SESSION_KEY) === '1';
    } catch {
      return false;
    }
  }

  private writeTitleSession(entered: boolean): void {
    try {
      if (entered) window.sessionStorage.setItem(V2_TITLE_SESSION_KEY, '1');
      else window.sessionStorage.removeItem(V2_TITLE_SESSION_KEY);
    } catch {
      // ignore storage unavailability
    }
  }

  private showToast(msg: string): void {
    this.actionToast = msg;
    if (this.actionToastTimer !== null) {
      window.clearTimeout(this.actionToastTimer);
    }
    this.actionToastTimer = window.setTimeout(() => {
      this.actionToast = null;
      this.actionToastTimer = null;
      this.renderBanners();
    }, 3200);
    this.renderBanners();
  }

  private persist(): void {
    if (this.showcaseRun) return;
    if (this.isReadOnlyTab || !this.tabGuard.canWrite()) return;
    const res = persistV2SaveData(window.localStorage, this.save);
    if (!res.ok) {
      this.storageError = res.error ?? '存档写入失败';
    } else {
      this.storageError = null;
    }
  }

  private applySettingsEffects(): void {
    soundEngine.setMute(this.save.settings.sfxMuted, this.save.settings.bgmMuted);
    document.body.classList.toggle('reduced-motion', this.save.settings.reducedMotion);
    document.body.classList.toggle('low-quality', this.save.settings.lowQuality);
    this.phaserHost?.updateCombatSettings(this.save.settings);
    if (this.save.settings.reducedMotion) {
      this.phaserHost?.skipBaseReturnDocking();
    }
  }

  private computeNextBaseGoal(p: V2ProfileState, projectedCredits = p.credits): NextBaseGoal {
    if (!p.tutorialCompleted) {
      return {
        title: '首航目标：启动拆解工作台',
        detail: '完成首航教学带回密封反应堆，免费通电工作台并奖 +40¤',
        actionKind: 'facilities',
        ready: true,
      };
    }

    if (p.buildings.research_lab) {
      const researchable = p.equipmentWarehouse.find(
        (w) => canResearchV2Instance(p, w.instanceId).canResearch
      );
      if (researchable) {
        const def = V2_EQUIPMENT_DEFS[researchable.definitionId];
        const effResearchCost = getEffectiveV2ResearchCost(p);
        const ready = projectedCredits >= effResearchCost;
        return {
          title: `研究台：解锁「${def?.name ?? '新设备'}」蓝图`,
          detail: ready
            ? `资金已就绪（${effResearchCost}¤），立即研究永久掌握`
            : `还差 ${Math.max(0, effResearchCost - projectedCredits)}¤`,
          actionKind: 'warehouse',
          targetCost: effResearchCost,
          ready,
        };
      }
    }

    for (const rid of V2_RELIC_ORDER) {
      const st = p.relics[rid];
      if (st && st.storedCount > 0 && !st.restored) {
        const relic = V2_RELICS[rid];
        const chk = canRestoreV2Relic(p, rid);
        return {
          title: `展台修复：${relic.name}`,
          detail: chk.canRestore
            ? `库藏已就绪，花费 ${relic.restoreCost}¤ 陈列展台`
            : chk.reason ?? `需 ${relic.restoreCost}¤`,
          actionKind: 'relics',
          targetCost: relic.restoreCost,
          ready: chk.canRestore,
        };
      }
    }

    const priorityOrder: V3StationFacilityId[] = [
      'research_lab',
      'drydock',
      'display',
      'stargate_relay',
      'workbench',
      'contract_hub',
    ];
    for (const fid of priorityOrder) {
      const def = V3_STATION_FACILITIES[fid];
      const chk = canUpgradeV3Facility(p, fid);
      if (!chk.nextSpec || !chk.nextTier) continue;
      if (chk.nextSpec.creditCost === 0 && chk.nextSpec.partsCost === 0) continue;
      const diff = Math.max(0, chk.nextSpec.creditCost - projectedCredits);
      const partsDiff = Math.max(0, chk.nextSpec.partsCost - p.salvageParts);
      return {
        title: `扩建目标：${def.name} T${chk.nextTier}`,
        detail: chk.canUpgrade
          ? `${chk.nextSpec.effectSummary}（资源已就绪）`
          : diff > 0
          ? `还差 ${diff}¤ · ${chk.nextSpec.effectSummary}`
          : partsDiff > 0
          ? `还差 ${partsDiff} 精密零件 · ${chk.nextSpec.effectSummary}`
          : chk.reason ?? chk.nextSpec.effectSummary,
        actionKind: 'facilities',
        targetCost: chk.nextSpec.creditCost,
        ready: chk.canUpgrade,
      };
    }

    return {
      title: '拆解站全部门已满级 T3',
      detail: '驾驶旗舰挑战终局星门与无尽深渊',
      actionKind: 'relics',
      ready: true,
    };
  }

  private pickRecommendedContractId(p: V2ProfileState): string {
    return pickRecommendedV2ContractId(p);
  }

  private buildShellDom(): void {
    this.mountEl.innerHTML = '';

    this.appShellEl = document.createElement('div');
    this.appShellEl.className = 'app-shell v2-shell';

    this.topHudEl = document.createElement('header');
    this.topHudEl.className = 'top-hud v2-top-hud';

    this.bannersEl = document.createElement('div');
    this.bannersEl.className = 'banners-stack';

    this.mainLayoutEl = document.createElement('main');
    this.mainLayoutEl.className = 'main-layout';

    this.sceneWrapEl = document.createElement('section');
    this.sceneWrapEl.className = 'scene-card v3-ship-stage';
    this.sceneWrapEl.dataset.stageRegion = 'ship-stage';
    this.sceneWrapEl.dataset.testid = 'ship-stage';

    this.sceneCanvasHostEl = document.createElement('div');
    this.sceneCanvasHostEl.className = 'scene-canvas-host';

    this.sceneOverlayEl = document.createElement('div');
    this.sceneOverlayEl.className = 'scene-overlay';

    this.sceneWrapEl.appendChild(this.sceneCanvasHostEl);
    this.sceneWrapEl.appendChild(this.sceneOverlayEl);

    this.leftPanelEl = document.createElement('section');
    this.leftPanelEl.className = 'panel-card panel-left v3-context-dock';
    this.leftPanelEl.dataset.stageRegion = 'context-dock';
    this.leftPanelEl.dataset.testid = 'context-dock';

    this.rightPanelEl = document.createElement('section');
    this.rightPanelEl.className = 'panel-card panel-right v3-hold-view';
    this.rightPanelEl.dataset.stageRegion = 'hold-view';
    this.rightPanelEl.dataset.testid = 'hold-view';

    this.mainLayoutEl.appendChild(this.sceneWrapEl);
    this.mainLayoutEl.appendChild(this.leftPanelEl);
    this.mainLayoutEl.appendChild(this.rightPanelEl);

    this.appShellEl.appendChild(this.topHudEl);
    this.appShellEl.appendChild(this.bannersEl);
    this.appShellEl.appendChild(this.mainLayoutEl);

    this.titleHostEl = document.createElement('div');
    this.titleHostEl.className = 'title-host v2-title-host';

    this.endingHostEl = document.createElement('div');
    this.endingHostEl.className = 'ending-host v2-ending-host';
    this.endingHostEl.style.display = 'none';

    this.modalHostEl = document.createElement('div');
    this.modalHostEl.className = 'modal-host v2-modal-host';

    this.mountEl.appendChild(this.appShellEl);
    this.mountEl.appendChild(this.titleHostEl);
    this.mountEl.appendChild(this.endingHostEl);
    this.mountEl.appendChild(this.modalHostEl);

    this.titleViewSlot = new ManagedViewSlot(this.titleHostEl);
    this.endingViewSlot = new ManagedViewSlot(this.endingHostEl);
    this.overlayViewSlot = new ManagedViewSlot(this.sceneOverlayEl);
    this.leftViewSlot = new ManagedViewSlot(this.leftPanelEl);
    this.lastStaticOverlayKey = null;

    registerModalBackgroundRoot(this.appShellEl);
  }

  private applyViewportClasses(): void {
    const run = this.getCurrentRun();
    const curNode = run?.currentNodeId ? run.graph.nodes[run.currentNodeId] : null;
    const currentScreen = this.computeCurrentScreen();
    const isEnding = currentScreen === 'ending';
    const isBaseHero = !run && !this.prepareDraft && !isEnding;
    const isPrepare = Boolean(!run && this.prepareDraft && !isEnding);
    const isVoyage = Boolean(run && !isEnding);
    const isMap = run?.phase === 'MAP';
    const isEncounter = run?.phase === 'ENCOUNTER';
    const isArrange = run?.phase === 'ARRANGE';
    const isReward = run?.phase === 'REWARD';
    const isShop = run?.phase === 'SHOP';
    const isSettlement = run?.phase === 'SETTLEMENT';
    const isLiveCombat = Boolean(run?.phase === 'ENCOUNTER' && run.activeCombat);
    const isPreCombat = Boolean(run?.phase === 'ENCOUNTER' && curNode?.combat && !run.activeCombat);
    const isWreckHero = Boolean(
      run?.phase === 'ENCOUNTER' && curNode?.type === 'wreck' && !curNode.combat && !run.activeCombat
    );
    const isMapHero = Boolean(isMap);
    const phaseKey = `${currentScreen}:${run?.phase ?? ''}:${isLiveCombat ? 'live' : isPreCombat ? 'pre' : 'idle'}`;
    if (this.lastViewportPhaseKey !== phaseKey) {
      this.lastViewportPhaseKey = phaseKey;
      this.mobileHoldZoomed = false;
      this.cargoGrid?.cancelActiveDrag(false);
      this.cargoGrid?.collapseDetailsDrawer();
    }
    const isHoldZoomed = Boolean(isVoyage && !isLiveCombat && (isArrange || this.mobileHoldZoomed));
    const collapsed = isArrange && this.isArrangeSceneCollapsed();

    this.sceneWrapEl.classList.toggle('scene-collapsed', collapsed);
    this.appShellEl.classList.toggle('phase-base-hero', isBaseHero);
    this.appShellEl.classList.toggle('phase-prepare', isPrepare);
    this.appShellEl.classList.toggle('phase-voyage', isVoyage);
    this.appShellEl.classList.toggle('phase-map', Boolean(isMap));
    this.appShellEl.classList.toggle('phase-encounter', Boolean(isEncounter));
    this.appShellEl.classList.toggle('phase-arrange', Boolean(isArrange));
    this.appShellEl.classList.toggle('phase-reward', Boolean(isReward));
    this.appShellEl.classList.toggle('phase-shop', Boolean(isShop));
    this.appShellEl.classList.toggle('phase-settlement', Boolean(isSettlement));
    this.appShellEl.classList.toggle('phase-combat', isLiveCombat || isPreCombat);
    this.appShellEl.classList.toggle('phase-combat-live', isLiveCombat);
    this.appShellEl.classList.toggle('phase-wreck-hero', isWreckHero);
    this.appShellEl.classList.toggle('phase-map-hero', isMapHero);
    this.appShellEl.classList.toggle('is-hold-zoomed', isHoldZoomed);

    this.appShellEl.dataset.screen = currentScreen;
    this.appShellEl.dataset.phase = run ? run.phase : '';
    this.appShellEl.dataset.act = this.save.profile.campaign.currentAct;
    this.appShellEl.dataset.sector = run
      ? run.sectorId
      : this.prepareDraft?.sectorId ?? this.save.profile.campaign.unlockedSectors[0] ?? 'near_orbit';
  }

  private syncVisibleSeenItems(): void {
    if (this.showcaseRun || this.isReadOnlyTab || !this.save.activeRun) return;
    const visibleDefIds = collectVisibleV2DefIdsForRun(this.save.activeRun);
    const nextProfile = recordV2SeenItems(this.save.profile, visibleDefIds);
    if (nextProfile !== this.save.profile) {
      this.save = { ...this.save, profile: nextProfile };
      this.persist();
    }
  }

  private static readonly PLAYTEST_INTERACTIVE_SELECTOR =
    'button, [data-action], a, input, select, [role="button"], label[data-settle-item], [data-select-node], [data-jump-node], [data-wreck-cut], [data-pick-reward], [data-elite-tactic], [data-staging-id]';

  private readonly handlePlaytestMountClick = (ev: MouseEvent): void => {
    if (!this.playtestTelemetry.isEnabled()) return;
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    const actionable = target.closest<HTMLElement>(V2AppController.PLAYTEST_INTERACTIVE_SELECTOR);
    if (!actionable) return;
    const action =
      actionable.dataset.action ||
      actionable.dataset.testid ||
      actionable.id ||
      actionable.tagName.toLowerCase();
    this.playtestTelemetry.recordClick(action, actionable.dataset.testid ?? null);
  };

  private computeTelemetryPhaseKey(): string {
    const screen = this.computeCurrentScreen();
    if (screen !== 'run') return screen;
    const run = this.getCurrentRun();
    if (!run) return screen;
    if (run.phase === 'ENCOUNTER') {
      const node = run.currentNodeId ? run.graph.nodes[run.currentNodeId] : null;
      if (run.activeCombat) return 'ENCOUNTER:COMBAT_LIVE';
      if (node?.combat) return 'ENCOUNTER:COMBAT_PRE';
      if (node?.type === 'wreck') return 'ENCOUNTER:WRECK';
      return `ENCOUNTER:${(node?.type ?? 'event').toUpperCase()}`;
    }
    return run.phase;
  }

  getPlaytestTelemetryExportJson(): string | null {
    if (!this.playtestTelemetry.isEnabled()) return null;
    return this.playtestTelemetry.exportJson();
  }

  private syncAll(): void {
    this.v1Inspection = inspectV1SaveForMigration(window.localStorage);
    this.syncVisibleSeenItems();
    this.applyViewportClasses();
    if (this.playtestTelemetry.isEnabled()) {
      const run = this.getCurrentRun();
      this.playtestTelemetry.recordPhase(this.computeTelemetryPhaseKey(), {
        runId: run?.runId ?? null,
        nodeId: run?.currentNodeId ?? null,
        isTutorial: run?.isTutorial,
      });
    }
    soundEngine.setTrack(
      resolveV2BgmTrack({
        titleEntered: this.titleEntered,
        run: this.getCurrentRun(),
      })
    );
    this.renderTitleOverlay();
    this.renderEndingOverlay();
    this.syncOverlayBackgroundLock();
    this.renderTopHud();
    this.renderBanners();
    this.syncPhaserStage();
    this.renderPanels();
    this.phaserHost?.resize();
  }

  private syncOverlayBackgroundLock(): void {
    const showTitle = this.computeCurrentScreen() === 'title';
    const showEnding = this.computeCurrentScreen() === 'ending';
    const locked = showTitle || showEnding;
    this.appShellEl.dataset.titleLocked = locked ? '1' : '0';
    if ('inert' in this.appShellEl) {
      (this.appShellEl as HTMLElement & { inert: boolean }).inert = locked || hasOpenModal();
    }
  }

  // --- Title Screen & Ending Ceremony Overlays ---

  private renderTitleOverlay(): void {
    const showTitle = this.computeCurrentScreen() === 'title';

    if (!showTitle) {
      this.titleViewSlot.unmount(true);
      this.titleHostEl.style.display = 'none';
      return;
    }

    this.titleHostEl.style.display = 'block';
    this.titleViewSlot.sync(
      'TITLE',
      this.titlePhaseView,
      {
        profile: this.save.profile,
        shouldOfferMigration: this.shouldOfferMigrationPrompt(),
      },
      {
        onEnterStation: () => {
          soundEngine.play('returnDock');
          this.titleEntered = true;
          this.writeTitleSession(true);
          this.syncAll();
        },
        onOpenMoreModes: () => {
          soundEngine.play('click');
          openV2MoreModesModal(this.modalHostEl, {
            onStartShowcase: (trialId) => this.startShowcaseRun(trialId),
            onSwitchToV1: () => this.options.onSwitchToV1(),
          });
        },
        onOpenHelp: () => {
          soundEngine.play('click');
          openV2HelpModal(this.modalHostEl);
        },
        onOpenMigration: () => {
          soundEngine.play('click');
          this.titleEntered = true;
          this.writeTitleSession(true);
          this.syncAll();
          this.openMigrationWizard();
        },
      }
    );
  }

  private renderEndingOverlay(): void {
    const run = this.getCurrentRun();
    const isGallery = this.endingGalleryId !== null;
    const isClimax = !isGallery && isRunPendingCampaignEnding(run);
    const showEnding = isGallery || isClimax;

    if (!showEnding) {
      this.endingViewSlot.unmount(true);
      this.endingHostEl.style.display = 'none';
      return;
    }

    this.endingHostEl.style.display = 'block';
    this.endingViewSlot.sync(
      'ENDING',
      this.endingPhaseView,
      {
        profile: this.save.profile,
        mode: isGallery ? 'gallery' : 'climax',
        selectedEndingId: isGallery ? this.endingGalleryId : this.selectedEndingId,
        climaxRun: isClimax ? run : null,
        readOnly: this.isReadOnlyTab,
      },
      {
        onSelectEnding: (endingId) => {
          const isGalleryNow = this.endingGalleryId !== null;
          const isClimaxNow = !isGalleryNow && isRunPendingCampaignEnding(this.getCurrentRun());
          if (isClimaxNow && this.isReadOnlyTab) return;
          this.selectedEndingId = endingId;
          soundEngine.play('relicRestore');
          this.renderEndingOverlay();
        },
        onClearSelection: () => {
          this.selectedEndingId = null;
          soundEngine.play('click');
          this.renderEndingOverlay();
        },
        onContinueToBase: () => {
          if (this.endingGalleryId !== null) {
            this.endingGalleryId = null;
            this.selectedEndingId = null;
            soundEngine.play('click');
            this.syncAll();
            return;
          }
          if (!this.canMutate()) return;
          const activeRun = this.save.activeRun;
          if (!activeRun || !isRunPendingCampaignEnding(activeRun)) return;
          const chosen: EndingId = this.selectedEndingId ?? 'stargate_reignited';
          const res = finalizeClimaxEnding(this.save.profile, activeRun, chosen);
          this.save = {
            ...this.save,
            profile: res.profile,
            activeRun: null,
          };
          this.selectedEndingId = null;
          this.resetSettlementUiState();
          this.activeDockingNotice = null;
          this.titleEntered = true;
          this.writeTitleSession(true);
          this.triggerCrewComm('endless_unlock');
          this.persist();
          soundEngine.play('contractDeliver');
          this.syncAll();
        },
      }
    );
  }

  private startShowcaseRun(trialId: V2TrialBuildId): void {
    this.cancelInFlightWreckCut();
    this.staticStageTracker.reset();
    this.activeCombatPlaybackKey = null;
    this.titleEntered = true;
    this.writeTitleSession(true);
    this.prepareDraft = null;
    this.selectedEndingId = null;
    this.endingGalleryId = null;
    this.activeDockingNotice = null;
    this.activeCommBanner = null;
    this.resetSettlementUiState();
    this.selectedMapNodeId = null;
    this.selectedWreckHotspot = 'armory';
    this.awaitingEliteDecision = false;
    this.showCombatLogDetails = false;
    this.cargoGrid?.collapseDetailsDrawer();
    this.showcaseRun = createV2ShowcaseRun(trialId);
    soundEngine.play('warpJump');
    this.syncAll();
  }

  // --- Top HUD & Banners ---

  private formatContractHudPill(run: V2RunState): string {
    const c = run.contract;
    if (c.status === 'aborted') return '自由返航';
    if (c.type === 'free') return '自由打捞';
    if (c.type === 'transport') {
      const hasReactor = run.bay.placed.some(
        (p) => p.item.origin === 'mission' && p.item.definitionId === 'mission.sealed_reactor'
      );
      return hasReactor ? '转运 · 已装反应堆' : '转运 · 待取反应堆';
    }
    if (c.type === 'rescue') {
      const pods = countEscapePodsInBay(run.bay);
      return `救援 · 救生舱 ${pods}/${c.missionItemCount}`;
    }
    if (c.type === 'survey') {
      return `勘测 · ${c.completedNodeIds.length}/${c.requiredCompletions}`;
    }
    if (c.type === 'bounty') {
      return `悬赏 · ${c.completedNodeIds.length}/${c.requiredCompletions}`;
    }
    if (c.type === 'derelict') {
      const hasBox = run.bay.placed.some(
        (p) => p.item.origin === 'mission' && p.item.definitionId === 'mission.black_box'
      );
      return hasBox ? '黑匣 · 已装黑匣' : '黑匣 · 待取黑匣';
    }
    return c.name;
  }

  private renderTopHud(): void {
    const run = this.getCurrentRun();
    const p = this.save.profile;
    const relicSum = getV2RelicSummary(p);

    let pillsHtml = '';
    if (run) {
      const fuelLow = run.fuel <= 2;
      if (run.phase === 'SETTLEMENT') {
        const sum = calculateV2Settlement(run, p, this.settlementDispositions);
        pillsHtml = `
          <div class="hud-pill"><span class="k">${svgIcon('beacon', 13)} 状态</span><strong class="v">${
            sum.reason === 'defeat' ? '拖回基地' : '安全靠泊'
          }</strong></div>
          <div class="hud-pill"><span class="k">${svgIcon('star', 13)} 委托</span><strong class="v">${
            sum.contractCompleted ? '可交付' : run.contract.type === 'free' ? '自由打捞' : '未完成'
          }</strong></div>
          <div class="hud-pill pill-accent"><span class="k">${svgIcon('credits', 13)} 实得</span><strong class="v num">+${
            sum.finalCreditsEarned
          }¤</strong></div>
          ${
            sum.totalSalvagePartsEarned > 0
              ? `<div class="hud-pill"><span class="k">${svgIcon('parts', 13)} 零件</span><strong class="v num">+${sum.totalSalvagePartsEarned}</strong></div>`
              : ''
          }
        `;
      } else {
        pillsHtml = `
          <div class="hud-pill ${run.hp <= 8 ? 'pill-danger' : ''}"><span class="k">${svgIcon('hull', 13)} 耐久</span><strong class="v num">${
            run.hp
          }/${run.maxHp}</strong></div>
          <div class="hud-pill ${fuelLow ? 'pill-warn' : ''}"><span class="k">${svgIcon('fuel', 13)} 燃料</span><strong class="v num">${
            run.fuel
          }/${run.maxFuel}</strong></div>
          <div class="hud-pill"><span class="k">${svgIcon('star', 13)} 任务</span><strong class="v">${this.formatContractHudPill(
            run
          )}</strong></div>
        `;
      }
    } else {
      const displayCredits =
        this.activeDockingNotice && this.activeDockingNotice.animating
          ? Math.round(
              this.activeDockingNotice.creditsBefore +
                (this.activeDockingNotice.creditsAfter - this.activeDockingNotice.creditsBefore) *
                  this.activeDockingNotice.progress
            )
          : p.credits;
      const warehouseCap = getEffectiveWarehouseCapacity(p);
      pillsHtml = `
        <div class="hud-pill pill-accent"><span class="k">${svgIcon('credits', 13)} 信用点</span><strong class="v num">${displayCredits}¤</strong></div>
        <div class="hud-pill"><span class="k">${svgIcon('parts', 13)} 精密零件</span><strong class="v num">${p.salvageParts}</strong></div>
        <div class="hud-pill"><span class="k">${svgIcon('warehouse', 13)} 库存</span><strong class="v num">${p.equipmentWarehouse.length}/${warehouseCap}</strong></div>
        <div class="hud-pill"><span class="k">${svgIcon('museum', 13)} 藏品</span><strong class="v num">${relicSum.restoredCount}/${relicSum.totalCount}</strong></div>
      `;
    }

    const isVoyage = Boolean(run && this.computeCurrentScreen() === 'run');
    const showMobileHoldToggle = Boolean(
      isVoyage && run && run.phase !== 'ARRANGE' && !run.activeCombat
    );
    this.topHudEl.classList.toggle('is-voyage-slim', isVoyage);

    this.topHudEl.innerHTML = `
      <div class="hud-brand">
        <span class="hud-logo-dot"></span>
        <span class="hud-title">星际拆解站</span>
        ${run?.isShowcase ? `<span class="v2-showcase-chip">4 站试玩</span>` : ''}
        ${run?.isFinalCampaignRun ? `<span class="v3-hud-climax-chip">终局远征</span>` : ''}
        ${
          (run?.endlessThreat ?? 0) >= 1
            ? `<span class="v3-hud-endless-chip">威压 ${run!.endlessThreat}</span>`
            : ''
        }
      </div>
      <div class="hud-actions">
        ${
          run?.isShowcase
            ? `<button type="button" class="btn btn-sm btn-secondary" id="v2-btn-exit-showcase">退出试玩</button>`
            : ''
        }
        ${
          showMobileHoldToggle
            ? `<button type="button" class="btn btn-sm btn-secondary v3-mobile-hold-toggle ${
                this.mobileHoldZoomed ? 'active' : ''
              }" id="v3-btn-toggle-mobile-hold" data-testid="btn-toggle-mobile-hold" aria-pressed="${
                this.mobileHoldZoomed ? 'true' : 'false'
              }">${svgIcon('grid', 14)} ${this.mobileHoldZoomed ? '收起船舱' : '船舱'}</button>`
            : ''
        }
        <button type="button" class="btn btn-sm btn-ghost" id="v2-hud-help" aria-label="远航指南">${svgIcon('help', 14)} 指南</button>
        <button type="button" class="btn btn-sm btn-ghost" id="v2-hud-settings" aria-label="设置">${svgIcon('settings', 14)} 设置</button>
      </div>
      <div class="hud-pills">${pillsHtml}</div>
    `;

    this.topHudEl.querySelector('#v2-btn-exit-showcase')?.addEventListener('click', () => {
      soundEngine.play('click');
      this.showcaseRun = null;
      this.staticStageTracker.reset();
      this.activeCombatPlaybackKey = null;
      this.awaitingEliteDecision = false;
      this.syncAll();
    });
    this.topHudEl.querySelector('#v3-btn-toggle-mobile-hold')?.addEventListener('click', () => {
      soundEngine.play('click');
      this.mobileHoldZoomed = !this.mobileHoldZoomed;
      this.applyViewportClasses();
      this.renderTopHud();
    });
    this.topHudEl.querySelector('#v2-hud-help')?.addEventListener('click', () => {
      soundEngine.play('click');
      openV2HelpModal(this.modalHostEl);
    });
    this.topHudEl.querySelector('#v2-hud-settings')?.addEventListener('click', () => {
      soundEngine.play('click');
      this.openSettingsModal();
    });
  }

  private renderBanners(): void {
    const items: string[] = [];

    if (this.isReadOnlyTab && !this.showcaseRun) {
      items.push(`
        <div class="system-banner banner-warn" role="alert">
          <span>${svgIcon('lock', 14)} 另一个窗口正在保存进度，当前窗口暂为只读。</span>
          <button type="button" class="btn btn-sm btn-primary" id="v2-btn-takeover">切换至此窗口继续</button>
        </div>
      `);
    }

    if (this.storageError) {
      items.push(`<div class="system-banner banner-danger" role="alert">${this.storageError}</div>`);
    }

    if (this.actionToast) {
      items.push(`<div class="system-banner banner-warn" role="status">${this.actionToast}</div>`);
    }

    const run = this.getCurrentRun();
    if (run?.isTutorial) {
      const currentLayer = run.currentNodeId ? run.graph.nodes[run.currentNodeId]?.layer ?? 1 : 0;
      const hint = V2_TUTORIAL_HINTS[currentLayer] ?? V2_TUTORIAL_HINTS[0];
      const hintText =
        run.phase === 'ARRANGE' && hint.arrangeHint
          ? hint.arrangeHint
          : run.phase === 'ENCOUNTER' && hint.encounterHint
          ? hint.encounterHint
          : hint.mapHint || hint.arrangeHint;
      items.push(`
        <div class="tutorial-banner">
          <span class="tutorial-badge">首航教学 ${currentLayer}/${run.graph.maxLayers}</span>
          <span>${hintText}</span>
        </div>
      `);
    }

    if (this.activeSynergyToast && this.activeSynergyToast.entries.length > 0) {
      const entries = this.activeSynergyToast.entries;
      const summary = entries
        .map((e) => `<strong>${e.name}</strong>（${e.pairLabel}）：${e.effectSummary}`)
        .join(' · ');
      items.push(`
        <div class="system-banner v3-synergy-discovery-toast" data-testid="synergy-discovery-toast" data-synergy-ids="${entries
          .map((e) => e.id)
          .join(',')}" role="status">
          <span class="v3-synergy-toast-badge">✦ 新联动！</span>
          <span class="v3-synergy-toast-body">${summary}</span>
          <button type="button" class="btn btn-sm btn-ghost" id="v3-synergy-toast-dismiss" aria-label="关闭联动提示">✕</button>
        </div>
      `);
    }

    if (this.activeCommBanner) {
      const c = this.activeCommBanner;
      items.push(`
        <div class="v3-comm-banner" data-testid="crew-comm-banner" role="status">
          ${crewPortraitSvg(c.speakerId, 30)}
          <div class="v3-comm-banner-body">
            <div class="v3-comm-banner-head">${svgIcon('comms', 12)} ${c.title}</div>
            <div class="v3-comm-banner-text">「${c.text}」</div>
          </div>
          <div class="v3-comm-banner-actions">
            <button type="button" class="btn btn-sm btn-secondary" id="v3-comm-open-archive">查看档案</button>
            <button type="button" class="btn btn-sm btn-ghost" id="v3-comm-dismiss" aria-label="关闭通讯">✕</button>
          </div>
        </div>
      `);
    }

    if (this.failedAssetKeys.length > 0) {
      items.push(`
        <div class="system-banner banner-warn">
          <span>部分画面资源加载失败（${this.failedAssetKeys.length} 项），不影响规则结算，可随时重试加载。</span>
          <button type="button" class="btn btn-sm btn-primary" id="v2-btn-retry-assets">重试加载</button>
        </div>
      `);
    }

    if (!run && this.shouldOfferMigrationPrompt()) {
      items.push(`
        <div class="system-banner banner-warn">
          <span>检测到经典版旧档（信用点 ${this.v1Inspection.baseCredits}¤${
        this.v1Inspection.activeRunPreview ? ' · 含未完成航次' : ''
      }），可安全导入并保留旧档。</span>
          <button type="button" class="btn btn-sm btn-primary" id="v2-banner-migrate">导入旧档</button>
        </div>
      `);
    }

    this.bannersEl.innerHTML = items.join('');

    this.bannersEl.querySelector('#v3-synergy-toast-dismiss')?.addEventListener('click', () => {
      this.activeSynergyToast = null;
      if (this.synergyToastTimer !== null) {
        window.clearTimeout(this.synergyToastTimer);
        this.synergyToastTimer = null;
      }
      this.renderBanners();
    });

    this.bannersEl.querySelector('#v3-comm-open-archive')?.addEventListener('click', () => {
      const comm = this.activeCommBanner;
      this.activeCommBanner = null;
      if (comm && !this.isReadOnlyTab) {
        this.save = { ...this.save, profile: markCampaignCommRead(this.save.profile, comm.id) };
        this.persist();
      }
      this.renderBanners();
      soundEngine.play('click');
      this.openCampaignModal('comms');
    });

    this.bannersEl.querySelector('#v3-comm-dismiss')?.addEventListener('click', () => {
      const comm = this.activeCommBanner;
      this.activeCommBanner = null;
      if (comm && !this.isReadOnlyTab) {
        this.save = { ...this.save, profile: markCampaignCommRead(this.save.profile, comm.id) };
        this.persist();
      }
      soundEngine.play('click');
      this.renderBanners();
      if (this.computeCurrentScreen() === 'base') {
        this.renderBaseHeroOverlay();
      }
    });

    this.bannersEl.querySelector('#v2-btn-retry-assets')?.addEventListener('click', () => {
      this.failedAssetKeys = [];
      this.renderBanners();
      this.phaserHost?.retryFailedAssets();
      this.showToast('正在重新加载画面资源…');
    });

    this.bannersEl.querySelector('#v2-btn-takeover')?.addEventListener('click', () => {
      const latest = loadV2SaveData(window.localStorage);
      if (latest.status === 'loaded') {
        this.save = latest.data;
      }
      this.staticStageTracker.reset();
      this.activeDockingNotice = null;
      this.phaserHost?.skipBaseReturnDocking();
      this.tabGuard.takeOver();
      this.isReadOnlyTab = !this.tabGuard.canWrite();
      this.phaserHost?.setCombatPaused(this.isReadOnlyTab);
      soundEngine.play('click');
      this.showToast('已切换至当前窗口并同步最新进度。');
      this.syncAll();
    });

    this.bannersEl.querySelector('#v2-banner-migrate')?.addEventListener('click', () => {
      this.openMigrationWizard();
    });
  }

  private triggerCrewComm(trigger: CampaignCommTrigger): void {
    const comm = getTriggeredCommForContext(this.save.profile, trigger);
    if (!comm) return;
    this.activeCommBanner = {
      id: comm.id,
      speakerId: comm.speakerId,
      title: comm.title,
      text: comm.text,
    };
  }

  // --- Phaser Stage Bridge ---

  private buildV2DioramaState(): V2BaseDioramaState {
    const p = this.save.profile;
    const relicSum = getV2RelicSummary(p);
    const nextGoal = this.computeNextBaseGoal(p);
    const restoredRelicIds = V2_RELIC_ORDER.filter((id) => Boolean(p.relics[id]?.restored));
    const relayTier = getFacilityTier(p, 'stargate_relay');
    return {
      activeShipId: p.selectedShipId,
      facilityTiers: {
        workbench: getFacilityTier(p, 'workbench'),
        contract_hub: getFacilityTier(p, 'contract_hub'),
        drydock: getFacilityTier(p, 'drydock'),
        research_lab: getFacilityTier(p, 'research_lab'),
        display: getFacilityTier(p, 'display'),
        stargate_relay: relayTier,
      },
      restoredRelicIds,
      campaignAct: p.campaign.currentAct,
      stargatePowered: relayTier >= 1,
      settings: this.save.settings,
      recentlyBuiltId: this.recentlyBuiltPin,
      restorableRelicCount: relicSum.restorableIds.length,
      workbenchWorking: Boolean(this.activeDockingNotice || nextGoal.ready),
      blueprintsCount: p.blueprints.length,
      totalBlueprints: V2_ALL_EQUIPMENT_KINDS.length,
      warehouseCount: p.equipmentWarehouse.length,
      warehouseCapacity: getEffectiveWarehouseCapacity(p),
      unlockedShipsCount: p.unlockedShips.length,
      totalShips: V2_SHIP_ORDER.length,
    };
  }

  private syncPhaserStage(): void {
    if (!this.phaserHost) return;
    const run = this.getCurrentRun();

    // 1. BASE HERO STAGE (Native V2 Diorama Parity — Contract #4)
    if (!run && !this.prepareDraft) {
      this.staticStageTracker.reset();
      this.activeCombatPlaybackKey = null;
      this.awaitingEliteDecision = false;
      this.phaserHost.showV2Base(this.buildV2DioramaState());
      if (this.computeCurrentScreen() === 'base') {
        this.renderBaseHeroOverlay();
      } else {
        this.overlayViewSlot.unmount(true);
        this.lastStaticOverlayKey = null;
      }
      return;
    }

    // 2. PREPARE Stage
    if (!run && this.prepareDraft) {
      this.activeCombatPlaybackKey = null;
      this.awaitingEliteDecision = false;
      const draft = this.prepareDraft;
      const previewBay = this.buildPreparePreviewBay(draft);
      const visualSpec = deriveV2ShipVisualSpec(previewBay);
      const ship = V2_SHIPS[draft.shipId];

      if (draft.playingDemo && draft.trialBuildId) {
        this.staticStageTracker.reset();
        const trial = V2_TRIAL_BUILDS[draft.trialBuildId];
        const demoUnits = getTrialDemoUnits(draft.trialBuildId);
        const demoKey = `demo_${draft.shipId}_${draft.trialBuildId}`;
        if (draft.demoPlaybackKey !== demoKey) {
          draft.demoPlaybackKey = demoKey;
          const demoSim = simulateV2Combat({
            resultId: demoKey,
            bay: previewBay,
            startingHp: ship.maxHp,
            maxHp: ship.maxHp,
            units: demoUnits,
            targetPolicy: 'weakest',
          });
          const shortSim = { ...demoSim, rounds: demoSim.rounds.slice(0, 3) };
          this.phaserHost.showV2Stage({
            shipId: draft.shipId,
            shipVisualSpec: visualSpec,
            sectorIndex:
              draft.trialBuildId === 'trial_heavy' ? 4 : draft.trialBuildId === 'trial_hangar' ? 2 : 5,
            eventBackdrop: null,
            units: demoUnits,
            simulation: shortSim,
            settings: { ...this.save.settings, combatSpeed: 2 },
            onComplete: () => {
              if (this.prepareDraft === draft) {
                draft.playingDemo = false;
                draft.demoPlaybackKey = null;
                this.syncPhaserStage();
              }
            },
          });
        }
        this.overlayViewSlot.unmount();
        const demoOverlayKey = `demo:${trial.shortName}:${trial.demoEnemyTitle}:${trial.demoHint}`;
        if (this.lastStaticOverlayKey !== demoOverlayKey) {
          this.lastStaticOverlayKey = demoOverlayKey;
          this.sceneOverlayEl.innerHTML = `
            <div class="scene-stage-tag">${svgIcon('bolt', 13)} 实战微演示 · ${trial.shortName} 对阵 ${trial.demoEnemyTitle}</div>
            <div class="v2-demo-bar">
              <span>${trial.demoHint}</span>
              <button type="button" class="btn btn-sm btn-secondary" id="v2-stop-demo">跳过演示</button>
            </div>
          `;
          this.sceneOverlayEl.querySelector('#v2-stop-demo')?.addEventListener('click', () => {
            if (this.prepareDraft !== draft) return;
            draft.playingDemo = false;
            draft.demoPlaybackKey = null;
            this.syncPhaserStage();
          });
        }
        return;
      }

      draft.demoPlaybackKey = null;
      const prepSector = getV3SectorDef(draft.sectorId);
      this.staticStageTracker.sync(
        this.phaserHost,
        {
          mode: 'prepare',
          runId: 'prepare',
          nodeId: 'none',
          shipId: draft.shipId,
          sectorId: draft.sectorId,
          sectorIndex: prepSector.primaryBgIndex,
          eventBackdrop: null,
          units: [],
        },
        visualSpec,
        (playbackKey) => ({
          playbackKey,
          shipId: draft.shipId,
          shipVisualSpec: visualSpec,
          sectorId: draft.sectorId,
          sectorIndex: prepSector.primaryBgIndex,
          eventBackdrop: null,
          units: [],
          simulation: null,
          settings: this.save.settings,
        })
      );

      this.overlayViewSlot.unmount();
      const mountChips =
        visualSpec.mountSummaryTags.length > 0
          ? visualSpec.mountSummaryTags.map((t) => `<span class="v2-mount-pill">${t}</span>`).join('')
          : `<span class="v2-mount-pill muted">仅舰载核心小炮</span>`;
      const prepOverlayKey = `prepare:${ship.name}:${prepSector.name}:${visualSpec.mountSummaryTags.join('|')}`;
      if (this.lastStaticOverlayKey !== prepOverlayKey) {
        this.lastStaticOverlayKey = prepOverlayKey;
        this.sceneOverlayEl.innerHTML = `
          <div class="scene-stage-tag">${svgIcon('rocket', 13)} ${ship.name} · ${prepSector.name} · 外部挂点实时联动</div>
          <div class="v2-mount-strip">${mountChips}</div>
        `;
      }
      return;
    }

    if (!run) return;
    if (this.computeCurrentScreen() === 'ending') {
      this.overlayViewSlot.unmount(true);
      this.lastStaticOverlayKey = null;
      return;
    }

    const currentNode = run.currentNodeId ? run.graph.nodes[run.currentNodeId] : null;
    const activeSector = getV3SectorDef(run.sectorId);
    const sectorIndex = currentNode?.sectorBg ?? activeSector.primaryBgIndex;
    const visualSpec = deriveV2ShipVisualSpec(run.bay);

    // 3. LIVE COMBAT HERO STAGE
    if (run.phase === 'ENCOUNTER' && run.activeCombat && currentNode?.combat) {
      this.staticStageTracker.reset();
      const activeCombat = run.activeCombat;
      const sim = activeCombat.simulation;
      const pending = activeCombat.pendingDecision;
      const needsDecision = Boolean(pending && pending.chosen === null);
      const alreadyAtPause = Boolean(
        needsDecision &&
          pending &&
          (pending.roundNumber <= 1 ||
            sim.rounds.length === 0 ||
            activeCombat.pausedAtDecisionId === pending.decisionId ||
            (activeCombat.resumeFromRound ?? 0) >= pending.roundNumber - 1)
      );
      const resumeRound =
        alreadyAtPause && pending
          ? Math.max(0, pending.roundNumber - 1)
          : activeCombat.resumeFromRound ??
            (pending && pending.chosen !== null ? Math.max(0, pending.roundNumber - 1) : 0);
      const pbKey = this.computeLiveCombatPlaybackKey(run, currentNode.nodeId);
      const overloadSpecs = this.buildStageOverloadSpecs(run.bay);

      if (this.activeCombatPlaybackKey !== pbKey) {
        this.activeCombatPlaybackKey = pbKey;
        this.awaitingEliteDecision = alreadyAtPause;
        this.liveCombatRound = alreadyAtPause && pending ? pending.roundNumber : resumeRound;
        this.livePhaseBannerText = null;
        const latestCmd =
          activeCombat.committedCommands && activeCombat.committedCommands.length > 0
            ? activeCombat.committedCommands[activeCombat.committedCommands.length - 1]
            : null;
        const latestActionIv = [...(activeCombat.interventions ?? [])]
          .reverse()
          .find((iv) => iv.kind !== 'target_lock');
        const activeOrderChoice =
          latestCmd?.choice ?? (pending?.chosen && pending.chosen !== 'normal' ? pending.chosen : null);
        if (latestActionIv?.kind === 'overload_module' && latestActionIv.moduleKind) {
          this.liveCombatEventLine = `部件过载：${
            getV2EquipmentDefByKind(latestActionIv.moduleKind, 'common').name
          }`;
        } else if (latestActionIv?.kind === 'tactical_command' && latestActionIv.commandId) {
          this.liveCombatEventLine =
            latestActionIv.commandId !== 'normal'
              ? `指令生效：${getTacticalCommandLabel(latestActionIv.commandId, run.shipId)}`
              : '';
        } else {
          this.liveCombatEventLine = activeOrderChoice
            ? `指令生效：${getTacticalCommandLabel(activeOrderChoice, run.shipId)}`
            : '';
        }

        const prevLog =
          resumeRound > 0 && sim.rounds.length > 0
            ? sim.rounds[Math.min(resumeRound - 1, sim.rounds.length - 1)]
            : null;
        this.liveCombatPlayerHp = prevLog
          ? prevLog.playerHpAfter
          : alreadyAtPause && pending
          ? pending.playerHpAtPause
          : sim.startingPlayerHp;
        this.liveCombatPlayerShield = prevLog
          ? prevLog.playerShieldAfter
          : alreadyAtPause && pending
          ? pending.playerShieldAtPause
          : sim.startingPlayerShield;
        this.liveEnemySnapshots = prevLog ? prevLog.enemiesAfter : sim.initialEnemies;
        this.liveCombatEnemiesAlive = this.liveEnemySnapshots.filter((e) => e.hp > 0).length;

        this.phaserHost.showV2Stage({
          shipId: run.shipId,
          shipVisualSpec: visualSpec,
          sectorId: run.sectorId,
          sectorIndex,
          eventBackdrop: null,
          units: currentNode.combat.units,
          simulation: sim,
          settings: this.save.settings,
          pauseAtRound: needsDecision && pending ? pending.roundNumber : null,
          resumeFromRound: resumeRound,
          lockedEnemyId: run.lockedEnemyId ?? null,
          overloadableModules: overloadSpecs,
          canOverloadModules: alreadyAtPause && needsDecision && this.canMutate(),
          onEnemyLock: (enemyId) => this.handleToggleEnemyLock(enemyId),
          onModuleOverload: (instanceId) => {
            const curRun = this.getCurrentRun();
            const curPending = curRun?.activeCombat?.pendingDecision;
            if (!this.awaitingEliteDecision || !curPending || curPending.chosen !== null) return;
            this.handleCommitModuleOverload(curPending.decisionId, instanceId);
          },
          onPauseForDecision: () => {
            const curRun = this.getCurrentRun() ?? run;
            const curPending = curRun.activeCombat?.pendingDecision;
            this.awaitingEliteDecision = true;
            if (curPending) {
              this.liveCombatRound = curPending.roundNumber;
              if (this.canMutate()) {
                const marked = markV2CombatDecisionPaused(curRun, curPending.decisionId);
                if (marked !== curRun) {
                  this.setCurrentRun(marked);
                }
              }
            }
            this.phaserHost?.updateV2OverloadInteraction(
              this.canMutate(),
              this.buildStageOverloadSpecs(curRun.bay)
            );
            if (!alreadyAtPause) {
              soundEngine.play('bossAlarm');
            }
            this.renderCombatPlaybackOverlay(this.getCurrentRun() ?? run);
          },
          onRoundStep: (_idx: number, log: V2CombatRoundLog) => {
            this.liveCombatRound = log.round;
            this.liveCombatPlayerHp = log.playerHpAfter;
            this.liveCombatPlayerShield = log.playerShieldAfter;
            this.liveEnemySnapshots = log.enemiesAfter;
            this.liveCombatEnemiesAlive = log.enemiesAfter.filter((e) => e.hp > 0).length;
            this.livePhaseBannerText =
              log.bossPhaseTransitions && log.bossPhaseTransitions.length > 0
                ? log.bossPhaseTransitions.map((t) => t.label).join(' · ')
                : null;
            const dealt = log.playerAttacks.reduce((s, a) => s + a.appliedDamage, 0);
            const tookHull = log.enemyAttacks.reduce((s, a) => s + a.hullDamage, 0);
            const parts: string[] = [`第 ${log.round} 轮`];
            if (log.appliedTacticThisRound && log.appliedTacticThisRound !== 'normal') {
              parts.push(`指令·${getTacticalCommandLabel(log.appliedTacticThisRound, run.shipId)}`);
            }
            const ovRound = log.appliedInterventionsThisRound?.find(
              (iv) => iv.kind === 'overload_module' && iv.moduleKind
            );
            if (ovRound?.moduleKind) {
              parts.push(`过载·${getV2EquipmentDefByKind(ovRound.moduleKind, 'common').name}`);
            }
            if (dealt > 0) parts.push(`我方输出 ${dealt}`);
            if (log.heavyChargingIds.length > 0) parts.push('重炮蓄能');
            if (log.shieldAbsorbedTotal > 0) parts.push(`盾吸 ${log.shieldAbsorbedTotal}`);
            if (log.counterAttack) parts.push(`反击 -${log.counterAttack.appliedDamage}`);
            if (tookHull > 0) parts.push(`舰体受创 -${tookHull}`);
            if (log.bossPhaseTransitions && log.bossPhaseTransitions.length > 0) {
              parts.push(log.bossPhaseTransitions[0].label);
            } else if (log.enemySpecialNotes && log.enemySpecialNotes.length > 0) {
              parts.push(log.enemySpecialNotes[0]);
            }
            if (log.envModifierEvent) parts.push(log.envModifierEvent);
            this.liveCombatEventLine = parts.join(' · ');
            this.renderCombatPlaybackOverlay(this.getCurrentRun() ?? run);
          },
          onComplete: () => {
            const activeRun = this.getCurrentRun();
            if (!activeRun || !activeRun.activeCombat) return;
            const res = completeV2CombatAtCurrentNode(
              activeRun,
              this.save.profile.unlockedFamilies,
              activeRun.recentEquipmentKinds
            );
            if (res.ok) {
              const finalOutcome = activeRun.activeCombat.simulation.outcome;
              this.activeCombatPlaybackKey = null;
              this.awaitingEliteDecision = false;
              this.showCombatLogDetails = false;
              this.cargoGrid?.collapseDetailsDrawer();
              this.livePhaseBannerText = null;
              this.liveEnemySnapshots = [];
              if (isRunPendingCampaignEnding(res.run)) {
                this.selectedEndingId = null;
              }
              this.setCurrentRun(res.run);
              soundEngine.play(
                isRunPendingCampaignEnding(res.run)
                  ? 'contractDeliver'
                  : finalOutcome === 'victory'
                  ? 'enemyDestroy'
                  : 'hullHit'
              );
              this.syncAll();
            }
          },
        });
      }
      this.renderCombatPlaybackOverlay(this.getCurrentRun() ?? run);
      return;
    }

    // 4. WRECK MULTI-CUT HERO STAGE (skip into pre-combat when ambush combat is attached!)
    if (
      run.phase === 'ENCOUNTER' &&
      currentNode?.type === 'wreck' &&
      (currentNode.wreck || run.activeWreck) &&
      !currentNode.combat
    ) {
      this.activeCombatPlaybackKey = null;
      this.awaitingEliteDecision = false;
      this.staticStageTracker.sync(
        this.phaserHost,
        {
          mode: 'wreck',
          runId: run.runId,
          nodeId: currentNode.nodeId,
          shipId: run.shipId,
          sectorId: run.sectorId,
          sectorIndex,
          eventBackdrop: 'wreck',
          units: [],
        },
        visualSpec,
        (playbackKey) => ({
          playbackKey,
          shipId: run.shipId,
          shipVisualSpec: visualSpec,
          sectorId: run.sectorId,
          sectorIndex,
          eventBackdrop: 'wreck' as const,
          units: [],
          simulation: null,
          settings: this.save.settings,
        })
      );
      this.syncWreckCompartmentsToPhaser(run, currentNode, this.inFlightWreckCut?.spotId ?? null);
      this.renderWreckOverlay(run, currentNode);
      return;
    }

    // 5. Static Event / Pre-Combat / Map / Arrange / Settlement Stage
    this.activeCombatPlaybackKey = null;
    this.awaitingEliteDecision = false;
    const eventBg =
      currentNode &&
      (currentNode.type === 'merchant' ||
        currentNode.type === 'anomaly' ||
        currentNode.type === 'distress')
        ? currentNode.type
        : null;
    const previewUnits =
      run.phase === 'ENCOUNTER' && currentNode?.combat ? currentNode.combat.units : [];
    const stageMode: V2StaticStageMode =
      run.phase === 'MAP'
        ? 'map'
        : run.phase === 'SHOP'
        ? 'shop'
        : run.phase === 'REWARD'
        ? 'reward'
        : run.phase === 'ARRANGE'
        ? 'arrange'
        : run.phase === 'SETTLEMENT'
        ? 'settlement'
        : currentNode?.combat
        ? 'pre_combat'
        : 'event';

    this.staticStageTracker.sync(
      this.phaserHost,
      {
        mode: stageMode,
        runId: run.runId,
        nodeId: currentNode?.nodeId ?? 'none',
        shipId: run.shipId,
        sectorId: run.sectorId,
        sectorIndex,
        eventBackdrop: eventBg,
        units: previewUnits,
      },
      visualSpec,
      (playbackKey) => ({
        playbackKey,
        shipId: run.shipId,
        shipVisualSpec: visualSpec,
        sectorId: run.sectorId,
        sectorIndex,
        eventBackdrop: eventBg,
        units: previewUnits,
        simulation: null,
        settings: this.save.settings,
        lockedEnemyId:
          stageMode === 'pre_combat' && previewUnits.length > 1 ? run.lockedEnemyId ?? null : null,
        onEnemyLock:
          stageMode === 'pre_combat' && previewUnits.length > 1
            ? (enemyId) => this.handleToggleEnemyLock(enemyId)
            : undefined,
        onModuleOverload: undefined,
      })
    );
    if (stageMode === 'pre_combat') {
      this.phaserHost.updateV2LockedEnemy(
        previewUnits.length > 1 ? run.lockedEnemyId ?? null : null
      );
      this.phaserHost.setV2StageCallbacks({
        onEnemyLock:
          previewUnits.length > 1 ? (enemyId) => this.handleToggleEnemyLock(enemyId) : null,
        onModuleOverload: null,
      });
    } else {
      this.phaserHost.setV2StageCallbacks({
        onEnemyLock: null,
        onModuleOverload: null,
      });
    }

    const stageLabel =
      run.phase === 'MAP'
        ? `${svgIcon('radar', 13)} ${activeSector.name} · 航路第 ${currentNode ? currentNode.layer : 0}/${run.graph.maxLayers} 层`
        : run.phase === 'SHOP'
        ? `${svgIcon('merchant', 13)} 流动商人 · 航行钱包 ${run.wallet}¤`
        : run.phase === 'REWARD'
        ? `${svgIcon('crate', 13)} 战利品打捞 · 选择 1 项补给`
        : run.phase === 'ARRANGE'
        ? `${svgIcon('grid', 13)} ${V2_SHIPS[run.shipId].name} · 船舱外观联动`
        : run.phase === 'SETTLEMENT'
        ? `${svgIcon('beacon', 13)} ${run.settlementReason === 'defeat' ? '紧急拖回结算' : '安全靠泊清点'}`
        : currentNode
        ? `${svgIcon(NODE_TYPE_META[currentNode.type].icon, 13)} ${activeSector.name} · 第 ${currentNode.layer} 层 ${
            NODE_TYPE_META[currentNode.type].label
          }`
        : '深空巡航中';

    this.overlayViewSlot.unmount();
    const showMountPills = run.phase === 'ARRANGE' || run.phase === 'MAP';
    const staticOverlayKey = `stage:${stageLabel}:${
      showMountPills ? visualSpec.mountSummaryTags.join('|') : ''
    }`;
    if (this.lastStaticOverlayKey !== staticOverlayKey) {
      this.lastStaticOverlayKey = staticOverlayKey;
      this.sceneOverlayEl.innerHTML = `
        <div class="scene-stage-tag">${stageLabel}</div>
        ${
          showMountPills && visualSpec.mountSummaryTags.length > 0
            ? `<div class="v2-mount-strip">${visualSpec.mountSummaryTags
                .map((t) => `<span class="v2-mount-pill">${t}</span>`)
                .join('')}</div>`
            : ''
        }
      `;
    }
  }

  // --- Screen Delegations ---

  private renderBaseHeroOverlay(): void {
    const p = this.save.profile;
    this.lastStaticOverlayKey = null;
    this.overlayViewSlot.sync(
      'BASE',
      this.basePhaseView,
      {
        profile: p,
        readOnly: this.isReadOnlyTab,
        nextGoal: this.computeNextBaseGoal(p),
        recommendedContractId: this.pickRecommendedContractId(p),
        activeDockingNotice: this.activeDockingNotice,
        campaignBannerCollapsed: this.campaignBannerCollapsed,
        campaignObjective: getActiveCampaignObjective(p),
      },
      {
        onSkipDocking: () => {
          this.phaserHost?.skipBaseReturnDocking();
        },
        onCloseDocking: () => {
          this.activeDockingNotice = null;
          if (this.computeCurrentScreen() === 'base') {
            this.renderBaseHeroOverlay();
          }
        },
        onStartTutorial: () => this.startTutorialRun(),
        onLaunchRecommended: (contractTemplateId) => {
          if (!this.canMutate()) return;
          soundEngine.play('click');
          this.openPrepareForContract(contractTemplateId);
        },
        onOpenContracts: () => {
          soundEngine.play('click');
          openV2ContractsDrawerModal(this.modalHostEl, this.save.profile, {
            readOnly: this.isReadOnlyTab,
            onSelectContract: (tplId) => {
              if (!this.canMutate()) return;
              this.openPrepareForContract(tplId);
            },
            onStartTutorial: () => this.startTutorialRun(),
          });
        },
        onToggleCampaignBanner: () => {
          this.campaignBannerCollapsed = !this.campaignBannerCollapsed;
          soundEngine.play('click');
          if (this.computeCurrentScreen() === 'base') {
            this.renderBaseHeroOverlay();
          }
        },
        onOpenCampaign: () => {
          soundEngine.play('click');
          this.openCampaignModal('roadmap');
        },
        onOpenGoal: (kind) => {
          soundEngine.play('click');
          if (kind === 'warehouse') this.openWarehouseModal('warehouse');
          else if (kind === 'relics') this.openRelicGalleryModal();
          else this.openFacilitiesModal();
        },
        onOpenWarehouse: () => {
          soundEngine.play('click');
          this.openWarehouseModal('warehouse');
        },
        onOpenFacilities: () => {
          soundEngine.play('click');
          this.openFacilitiesModal();
        },
        onOpenRelics: () => {
          soundEngine.play('click');
          this.openRelicGalleryModal();
        },
        onOpenCodex: () => {
          soundEngine.play('click');
          openV2CodexModal(this.modalHostEl, this.save.profile);
        },
        onOpenCareer: () => {
          soundEngine.play('click');
          this.openCareerModal('overview');
        },
        onChoosePendingFamilyUnlock: (family) => {
          if (!this.canMutate()) return;
          const res = choosePendingV2FamilyUnlock(this.save.profile, family);
          if (!res.ok) {
            this.showToast(res.error ?? '解锁体系失败');
            return;
          }
          this.save = { ...this.save, profile: res.profile };
          this.persist();
          soundEngine.play('relicRestore');
          this.showToast(
            `已解锁新流派体系：${res.unlockedFamilyName ?? family}（蓝图与首件赠品已发放）`
          );
          this.syncAll();
        },
      }
    );
  }

  private startTutorialRun(): void {
    if (!this.canMutate()) return;
    if (this.settledRunsCountInSession > 0) {
      this.playtestTelemetry.recordReplayStart(this.settledRunsCountInSession, 'tutorial');
    }
    const run = createV2TutorialRun(`v2tut_${Date.now().toString(36)}`);
    this.save = { ...this.save, activeRun: run };
    this.activeDockingNotice = null;
    this.showCombatLogDetails = false;
    this.cargoGrid?.collapseDetailsDrawer();
    this.persist();
    soundEngine.play('warpJump');
    this.syncAll();
  }

  private renderCombatPlaybackOverlay(run: V2RunState): void {
    this.lastStaticOverlayKey = null;
    const readOnly = this.isReadOnlyTab && !run.isShowcase;
    this.overlayViewSlot.sync(
      'COMBAT_LIVE',
      this.combatLivePhaseView,
      {
        run,
        liveCombatRound: this.liveCombatRound,
        liveCombatPlayerHp: this.liveCombatPlayerHp,
        liveCombatPlayerShield: this.liveCombatPlayerShield,
        liveCombatEnemiesAlive: this.liveCombatEnemiesAlive,
        liveCombatEventLine: this.liveCombatEventLine,
        liveEnemySnapshots: this.liveEnemySnapshots,
        livePhaseBannerText: this.livePhaseBannerText,
        awaitingEliteDecision: this.awaitingEliteDecision,
        combatSpeed: this.save.settings.combatSpeed,
        readOnly,
        stargateRelayTier: getFacilityTier(this.save.profile, 'stargate_relay'),
      },
      {
        onPeekBay: () => {
          const activeRun = this.getCurrentRun() ?? run;
          soundEngine.play('click');
          openV2CargoPeekModal(
            this.modalHostEl,
            activeRun.bay,
            `参战配装 · ${V2_SHIPS[activeRun.shipId].name}`
          );
        },
        onToggleSpeed: () => {
          const activeRun = this.getCurrentRun() ?? run;
          const nextSpd = this.save.settings.combatSpeed === 1 ? 2 : 1;
          this.save = {
            ...this.save,
            settings: { ...this.save.settings, combatSpeed: nextSpd },
          };
          this.applySettingsEffects();
          this.persist();
          this.renderCombatPlaybackOverlay(activeRun);
        },
        onSkipPlayback: () => {
          if (this.awaitingEliteDecision) return;
          this.phaserHost?.skipCombatPlayback();
        },
        onCommitEliteTactic: (decisionId, choice) => {
          if (!this.canMutate()) return;
          const cur = this.getCurrentRun();
          if (!cur) return;
          const res = commitV2EliteTacticDecision(cur, decisionId, choice, {
            stargateRelayTier: getFacilityTier(this.save.profile, 'stargate_relay'),
          });
          if (!res.ok) {
            this.showToast(res.error ?? '战术指令无效');
            return;
          }
          this.awaitingEliteDecision = false;
          this.activeCombatPlaybackKey = null;
          this.livePhaseBannerText = null;
          this.setCurrentRun(res.run);
          soundEngine.play('tacticalOrder');
          this.syncAll();
        },
        onOverloadModule: (decisionId, moduleInstanceId) => {
          this.handleCommitModuleOverload(decisionId, moduleInstanceId);
        },
        onToggleLockEnemy: (enemyId) => {
          this.handleToggleEnemyLock(enemyId);
        },
      }
    );
  }

  private buildWreckCompartmentStates(
    run: V2RunState,
    node: V2MapNode,
    cuttingSpotId: V2WreckSpotId | null
  ): readonly WreckCompartmentVisualState[] {
    const wreck = buildActiveWreckStateForNode(run, node, this.save.profile).wreck;
    return wreck.hotspots.map((spot) => {
      const coords = WRECK_SPOT_COORDS[spot.spotId] ?? { normX: 0.5, normY: 0.45 };
      const evalRes = evaluateWreckHotspotCut(run, wreck, spot.spotId);
      const visualSpotId: WreckCompartmentVisualState['spotId'] =
        spot.spotId === 'armory' || spot.spotId === 'aux_bay'
          ? 'armory'
          : spot.spotId === 'reactor'
          ? 'reactor'
          : 'cargo';
      const silhouetteKind: WreckCompartmentVisualState['silhouetteKind'] =
        spot.spotId === 'armory' || spot.spotId === 'aux_bay'
          ? 'equipment'
          : spot.spotId === 'reactor'
          ? 'reactor'
          : 'cargo';
      return {
        spotId: visualSpotId,
        normX: coords.normX,
        normY: coords.normY,
        cut: spot.cut,
        cutting: cuttingSpotId === spot.spotId,
        canCut: evalRes.canCut,
        isLethal: evalRes.isLethal,
        isRisky: !evalRes.isFirstSafeCut && !wreck.stabilizerActive,
        silhouetteKind,
      };
    });
  }

  private syncWreckCompartmentsToPhaser(
    run: V2RunState,
    node: V2MapNode,
    cuttingSpotId: V2WreckSpotId | null
  ): void {
    this.phaserHost?.updateV2WreckCompartments(
      this.buildWreckCompartmentStates(run, node, cuttingSpotId)
    );
  }

  private readonly handleWreckCutSkipKey = (ev: KeyboardEvent): void => {
    if (!this.inFlightWreckCut) return;
    if (ev.key === ' ' || ev.key === 'Enter' || ev.key === 'Escape') {
      ev.preventDefault();
      this.skipInFlightWreckCut();
    }
  };

  private cancelInFlightWreckCut(): void {
    const active = this.inFlightWreckCut;
    if (!active) return;
    if (typeof window !== 'undefined') {
      if (active.clampTimerId !== null) window.clearTimeout(active.clampTimerId);
      if (active.cutTimerId !== null) window.clearTimeout(active.cutTimerId);
      if (active.flipTimerId !== null) window.clearTimeout(active.flipTimerId);
      window.removeEventListener('keydown', this.handleWreckCutSkipKey);
    } else {
      if (active.clampTimerId !== null) globalThis.clearTimeout(active.clampTimerId);
      if (active.cutTimerId !== null) globalThis.clearTimeout(active.cutTimerId);
      if (active.flipTimerId !== null) globalThis.clearTimeout(active.flipTimerId);
    }
    for (const el of active.flipEls) {
      el.remove();
    }
    this.inFlightWreckCut = null;
    this.phaserHost?.finishV2WreckCutFx();
  }

  private resolveWreckFlipTargetRect(): { readonly left: number; readonly top: number; readonly width: number; readonly height: number } {
    const candidates: (HTMLElement | null)[] = [
      this.rightPanelEl.querySelector<HTMLElement>('[data-cargo-slot="staging"]'),
      this.rightPanelEl.querySelector<HTMLElement>('[data-cargo-slot="board"]'),
      this.leftPanelEl.querySelector<HTMLElement>('[data-testid="wreck-stability"]'),
      this.rightPanelEl.querySelector<HTMLElement>('#v2-cargo-mount'),
    ];
    for (const el of candidates) {
      if (!el) continue;
      if (el.style?.display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r && r.width > 0 && r.height > 0) {
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      }
    }
    const vw = typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 1024;
    const vh = typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 768;
    return { left: vw * 0.72, top: vh * 0.72, width: 48, height: 48 };
  }

  private launchWreckFlipGhosts(
    spotId: V2WreckSpotId,
    normX: number,
    normY: number,
    itemDefIds: readonly string[]
  ): HTMLElement[] {
    if (typeof document === 'undefined' || itemDefIds.length === 0) return [];
    const pinEl = this.sceneOverlayEl.querySelector<HTMLElement>(
      `[data-testid="wreck-spot-${spotId}"]`
    );
    const pinRect = pinEl?.getBoundingClientRect();
    const stageRect = this.sceneWrapEl.getBoundingClientRect();
    const startX =
      pinRect && pinRect.width > 0
        ? pinRect.left + pinRect.width * 0.5
        : stageRect && stageRect.width > 0
        ? stageRect.left + stageRect.width * normX
        : 320;
    const startY =
      pinRect && pinRect.height > 0
        ? pinRect.top + pinRect.height * 0.5
        : stageRect && stageRect.height > 0
        ? stageRect.top + stageRect.height * normY
        : 220;

    const targetRect = this.resolveWreckFlipTargetRect();
    const endX = targetRect.left + targetRect.width * 0.5;
    const endY = targetRect.top + targetRect.height * 0.5;
    const dx = endX - startX;
    const dy = endY - startY;

    const created: HTMLElement[] = [];
    itemDefIds.slice(0, 3).forEach((defId, idx) => {
      const ghost = document.createElement('div');
      ghost.className = 'v3-wreck-flip-ghost';
      ghost.dataset.testid = 'wreck-flip-ghost';
      ghost.dataset.itemDefId = defId;
      ghost.style.left = `${startX - 24 + idx * 8}px`;
      ghost.style.top = `${startY - 24 - idx * 6}px`;
      ghost.style.transform = 'translate(0px, 0px) scale(1)';

      const img = document.createElement('img');
      img.src = getItemImageUrl(defId);
      img.alt = '';
      img.draggable = false;
      ghost.appendChild(img);
      document.body.appendChild(ghost);
      created.push(ghost);

      // Force synchronous style/layout flush so real browsers compute before-change styles
      // and genuinely execute the 260ms CSS FLIP flight transition.
      void ghost.getBoundingClientRect();

      ghost.classList.add('is-flying');
      ghost.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px) scale(0.55)`;
      ghost.style.opacity = '0.25';
    });
    return created;
  }

  private startWreckCutSequence(spotId: V2WreckSpotId): void {
    if (!this.canMutate() || this.inFlightWreckCut) return;
    const run = this.getCurrentRun();
    const node = run?.currentNodeId ? run.graph.nodes[run.currentNodeId] : null;
    if (!run || run.phase !== 'ENCOUNTER' || !node || node.type !== 'wreck' || node.resolved || node.combat) {
      return;
    }

    const wreck = buildActiveWreckStateForNode(run, node, this.save.profile).wreck;
    const evalRes = evaluateWreckHotspotCut(run, wreck, spotId);
    if (!evalRes.canCut) {
      this.showToast(evalRes.disabledReason ?? '无法切割该舱室');
      return;
    }

    const spot = wreck.hotspots.find((h) => h.spotId === spotId);
    const coords = WRECK_SPOT_COORDS[spotId] ?? { normX: 0.5, normY: 0.45 };
    const flipItemDefIds = spot
      ? spot.rewardItems && spot.rewardItems.length > 0
        ? spot.rewardItems.map((i) => i.definitionId)
        : spot.rewardItem
        ? [spot.rewardItem.definitionId]
        : []
      : [];
    const willAmbush = Boolean(evalRes.effectiveAmbushRisk);

    this.selectedWreckHotspot = spotId;
    if (this.phaserHost) {
      this.phaserHost.triggerV2WreckCutFx(coords.normX, coords.normY);
    } else {
      soundEngine.play('wreckCut');
    }

    // Instant commit path in reducedMotion (0 timers, 0 FLIP ghosts, zero info loss)
    if (this.save.settings.reducedMotion) {
      soundEngine.play('clampPop');
      this.phaserHost?.popV2WreckCutClamp(coords.normX, coords.normY);
      this.commitWreckCut(run.runId, node.nodeId, spotId);
      return;
    }

    const state = {
      runId: run.runId,
      nodeId: node.nodeId,
      spotId,
      normX: coords.normX,
      normY: coords.normY,
      willAmbush,
      flipItemDefIds,
      phase: 'cutting' as 'cutting' | 'flipping',
      clampPopped: false,
      clampTimerId: null as number | null,
      cutTimerId: null as number | null,
      flipTimerId: null as number | null,
      flipEls: [] as HTMLElement[],
    };
    this.inFlightWreckCut = state;
    this.syncWreckCompartmentsToPhaser(run, node, spotId);
    this.renderWreckOverlay(run, node);
    this.renderEncounterPhase(run);
    window.addEventListener('keydown', this.handleWreckCutSkipKey);

    const clampDelayMs = Math.round(VFX_WRECK_CUT_DURATION_MS * VFX_WRECK_CLAMP_POP_RATIO);
    state.clampTimerId = window.setTimeout(() => {
      if (this.inFlightWreckCut !== state) return;
      state.clampTimerId = null;
      if (!state.clampPopped) {
        state.clampPopped = true;
        soundEngine.play('clampPop');
        this.phaserHost?.popV2WreckCutClamp(state.normX, state.normY);
      }
    }, clampDelayMs);

    state.cutTimerId = window.setTimeout(() => {
      if (this.inFlightWreckCut !== state) return;
      state.cutTimerId = null;
      if (!state.clampPopped) {
        state.clampPopped = true;
        soundEngine.play('clampPop');
        this.phaserHost?.popV2WreckCutClamp(state.normX, state.normY);
      }
      if (state.willAmbush || state.flipItemDefIds.length === 0) {
        this.commitWreckCut(state.runId, state.nodeId, state.spotId);
        return;
      }
      state.phase = 'flipping';
      state.flipEls = this.launchWreckFlipGhosts(
        state.spotId,
        state.normX,
        state.normY,
        state.flipItemDefIds
      );
      state.flipTimerId = window.setTimeout(() => {
        if (this.inFlightWreckCut !== state) return;
        state.flipTimerId = null;
        this.commitWreckCut(state.runId, state.nodeId, state.spotId);
      }, VFX_WRECK_FLIP_DURATION_MS);
    }, VFX_WRECK_CUT_DURATION_MS);
  }

  private skipInFlightWreckCut(): void {
    const active = this.inFlightWreckCut;
    if (!active) return;
    const { runId, nodeId, spotId, normX, normY, clampPopped } = active;
    this.cancelInFlightWreckCut();
    if (!clampPopped) {
      soundEngine.play('clampPop');
      this.phaserHost?.popV2WreckCutClamp(normX, normY);
    }
    this.commitWreckCut(runId, nodeId, spotId);
  }

  private commitWreckCut(
    expectedRunId: string,
    expectedNodeId: string,
    spotId: V2WreckSpotId
  ): void {
    this.cancelInFlightWreckCut();
    if (this.destroyed || typeof window === 'undefined') return;
    if (!this.canMutate()) {
      this.syncAll();
      return;
    }
    const latestRun = this.getCurrentRun();
    if (
      !latestRun ||
      latestRun.runId !== expectedRunId ||
      latestRun.phase !== 'ENCOUNTER' ||
      latestRun.currentNodeId !== expectedNodeId
    ) {
      this.syncAll();
      return;
    }
    const res = cutV2WreckHotspot(
      latestRun,
      spotId,
      this.save.profile.unlockedFamilies,
      undefined,
      this.save.profile
    );
    if (!res.ok) {
      this.showToast(res.error ?? '无法切割该舱室');
      this.syncAll();
      return;
    }
    this.selectedWreckHotspot = spotId;
    this.setCurrentRun(res.run);
    const updatedNode = res.run.currentNodeId ? res.run.graph.nodes[res.run.currentNodeId] : null;
    if (res.ambushTriggered || updatedNode?.combat) {
      this.showCombatLogDetails = false;
      this.cargoGrid?.collapseDetailsDrawer();
    }
    if (res.ambushTriggered) {
      soundEngine.play('bossAlarm');
      this.showToast('残骸警报触发！敌舰伏击来袭，战利品已暂封待战后返还！');
    } else if (res.collapsed) {
      soundEngine.play('hullHit');
      this.showToast(res.summaryText ?? '残骸结构坍塌！本船未撤离物资已损失，剩余舱室封锁。');
    } else if (res.tookHazard) {
      soundEngine.play('hullHit');
      if (res.summaryText) this.showToast(res.summaryText);
    }
    this.syncAll();
  }

  private renderWreckOverlay(run: V2RunState, node: V2MapNode): void {
    this.lastStaticOverlayKey = null;
    this.overlayViewSlot.sync(
      'WRECK_OVERLAY',
      this.wreckOverlayPhaseView,
      {
        run,
        node,
        profile: this.save.profile,
        readOnly: this.isReadOnlyTab && !run.isShowcase,
        selectedHotspot: this.selectedWreckHotspot,
        cuttingSpotId: this.inFlightWreckCut?.spotId ?? null,
      },
      {
        onSelectHotspot: (spot) => {
          const latest = this.getCurrentRun() ?? run;
          const latestNode =
            (latest.currentNodeId ? latest.graph.nodes[latest.currentNodeId] : null) ?? node;
          this.selectedWreckHotspot = spot;
          soundEngine.play('hoverValid');
          this.renderWreckOverlay(latest, latestNode);
          this.renderEncounterPhase(latest);
        },
        onCutHotspot: (spot) => {
          this.startWreckCutSequence(spot);
        },
        onSkipCut: () => {
          this.skipInFlightWreckCut();
        },
      }
    );
  }

  private renderPanels(): void {
    const run = this.getCurrentRun();
    const currentScreen = this.computeCurrentScreen();
    if (!run || currentScreen !== 'run') {
      this.preCombatAutoEngage.reset();
      this.cancelInFlightWreckCut();
    } else if (
      this.inFlightWreckCut &&
      (run.phase !== 'ENCOUNTER' ||
        run.runId !== this.inFlightWreckCut.runId ||
        run.currentNodeId !== this.inFlightWreckCut.nodeId)
    ) {
      this.cancelInFlightWreckCut();
    }

    if (currentScreen === 'title' || currentScreen === 'ending') {
      this.cancelSettlementRollup();
      this.leftViewSlot.unmount(true);
      this.teardownCargoBay();
      this.rightPanelEl.innerHTML = '';
      return;
    }

    if (!run) {
      this.cancelSettlementRollup();
      if (this.prepareDraft) {
        this.renderPreparePanels();
      } else {
        this.leftViewSlot.unmount(true);
        this.teardownCargoBay();
        this.rightPanelEl.innerHTML = '';
      }
      return;
    }

    if (run.phase !== 'ENCOUNTER') {
      this.preCombatAutoEngage.reset();
    }
    if (run.phase !== 'SETTLEMENT') {
      this.cancelSettlementRollup();
    }

    if (run.phase === 'MAP') {
      this.renderMapPhase(run);
    } else if (run.phase === 'ENCOUNTER') {
      this.renderEncounterPhase(run);
    } else if (run.phase === 'SHOP') {
      this.renderShopPhase(run);
    } else if (run.phase === 'REWARD') {
      this.renderRewardPhase(run);
    } else if (run.phase === 'ARRANGE') {
      this.renderArrangePhase(run);
    } else {
      this.renderSettlementPhase(run);
    }
  }

  private openPrepareForContract(
    contractTemplateId: string,
    preferredSectorOverride?: SectorId,
    modeOverride?: {
      readonly isFinalCampaignRun?: boolean;
      readonly endlessThreat?: number;
    }
  ): void {
    const p = this.save.profile;
    const unlockedSectors =
      p.campaign.unlockedSectors.length > 0 ? p.campaign.unlockedSectors : (['near_orbit'] as const);
    const wantsFinal = Boolean(
      modeOverride?.isFinalCampaignRun && isFinalCampaignMissionUnlocked(p).unlocked
    );
    const wantsEndlessThreat =
      !wantsFinal && p.campaign.endlessUnlocked && (modeOverride?.endlessThreat ?? 0) >= 1
        ? Math.max(
            1,
            Math.min(
              Math.max(1, Math.min(10, p.campaign.maxEndlessThreat)),
              Math.floor(modeOverride!.endlessThreat!)
            )
          )
        : 0;
    const chosenSector: SectorId =
      wantsFinal || wantsEndlessThreat >= 1
        ? unlockedSectors.includes('stargate_abyss')
          ? 'stargate_abyss'
          : unlockedSectors[0] ?? 'near_orbit'
        : preferredSectorOverride && unlockedSectors.includes(preferredSectorOverride)
        ? preferredSectorOverride
        : this.preferredSectorId && unlockedSectors.includes(this.preferredSectorId)
        ? this.preferredSectorId
        : unlockedSectors[0] ?? 'near_orbit';
    const shipId = p.unlockedShips.includes(p.selectedShipId) ? p.selectedShipId : 'cannon_skiff';
    const crewId =
      p.selectedCrewId && p.unlockedCrew.includes(p.selectedCrewId)
        ? p.selectedCrewId
        : p.unlockedCrew[0] ?? null;
    const slots = [
      ...buildFreeFallbackPrepareSlots(
        shipId,
        p.blueprints,
        getEffectiveShipLoadoutBudget(p, shipId)
      ),
    ];
    this.prepareDraft = {
      contractTemplateId,
      sectorId: chosenSector,
      shipId,
      crewId,
      primaryArchetype: p.selectedArchetype,
      trialBuildId: null,
      playingDemo: false,
      demoPlaybackKey: null,
      slots,
      missingPresetEntries: [],
      presetNotice: null,
      isFinalCampaignRun: wantsFinal,
      endlessThreat: wantsEndlessThreat,
      customSeedInput: '',
      defaultSeed: createRandomSeed() >>> 0,
    };
    this.activeDockingNotice = null;
    this.syncAll();
  }

  private buildPreparePreviewBay(draft: V2PrepareDraft): V2CargoBayState {
    const placed: V2PlacedItem[] = [];
    for (const s of draft.slots) {
      const def = V2_EQUIPMENT_DEFS[s.definitionId];
      const gdDef = def ? undefined : getV3GadgetDef(s.definitionId);
      if (!def && !gdDef) continue;
      if (s.origin === 'owned' && s.warehouseInstanceId) {
        const real = this.save.profile.equipmentWarehouse.find(
          (w) => w.instanceId === s.warehouseInstanceId
        );
        if (real) {
          placed.push({
            item: { ...real, origin: 'owned', location: 'bay' },
            x: s.x,
            y: s.y,
            rotation: s.rotation,
          });
          continue;
        }
      }
      if (gdDef) {
        placed.push({
          item: createV3GadgetInstance({
            instanceId: s.slotKey,
            kind: gdDef.kind,
            origin: 'owned',
            acquiredDepth: 0,
            location: 'bay',
          }),
          x: s.x,
          y: s.y,
          rotation: s.rotation,
        });
        continue;
      }
      placed.push({
        item: createV2EquipmentInstance({
          instanceId: s.slotKey,
          kind: def!.kind,
          quality: def!.quality,
          origin: s.origin,
          acquiredDepth: 0,
          location: 'bay',
        }),
        x: s.x,
        y: s.y,
        rotation: s.rotation,
      });
    }
    return {
      shipId: draft.shipId,
      placed,
      staging: [],
      discardedThisArrange: [],
    };
  }

  private launchExpeditionFromDraft(draft: V2PrepareDraft): void {
    if (!this.canMutate()) return;
    const customSeed = parseV3CustomSeedInput(draft.customSeedInput);
    const effectiveSeed =
      customSeed ?? deriveSessionRunSeed(this.urlBaseSeed, this.sessionLaunchIndex) ?? draft.defaultSeed;
    const effectiveThreat = draft.isFinalCampaignRun ? 0 : draft.endlessThreat;
    const res = launchV2Expedition({
      profile: this.save.profile,
      contractTemplateId: draft.contractTemplateId,
      shipId: draft.shipId,
      crewId: draft.crewId,
      primaryArchetype: draft.primaryArchetype,
      slots: draft.slots,
      trialBuildId: draft.trialBuildId,
      sectorId: draft.sectorId,
      seed: effectiveSeed,
      isFinalCampaignRun: draft.isFinalCampaignRun,
      endlessThreat: effectiveThreat,
    });
    if (!res.ok || !res.run) {
      this.showToast(res.errors.join('；') || '无法出航');
      return;
    }
    if (customSeed === null && this.urlBaseSeed !== null) {
      this.sessionLaunchIndex += 1;
    }
    const nextProfile = recordV2SeenItems(res.profile, collectVisibleV2DefIdsForRun(res.run));
    this.save = {
      ...this.save,
      profile: nextProfile,
      activeRun: res.run,
    };
    this.preferredSectorId = res.run.sectorId;
    this.prepareDraft = null;
    this.resetSettlementUiState();
    this.selectedMapNodeId = null;
    this.showCombatLogDetails = false;
    this.cargoGrid?.collapseDetailsDrawer();
    this.cancelInFlightWreckCut();

    const hasRelicSignal = Object.values(res.run.graph.nodes).some((n) => Boolean(n.hasRelicSignal));
    if (hasRelicSignal) {
      this.triggerCrewComm('pity_signal_detected');
    } else if (res.run.sectorId === 'frozen_graveyard') {
      this.triggerCrewComm('act2_start');
    } else if (res.run.sectorId === 'stargate_abyss') {
      this.triggerCrewComm('act3_start');
    }

    if (this.settledRunsCountInSession > 0) {
      this.playtestTelemetry.recordReplayStart(this.settledRunsCountInSession, 'expedition');
    }
    this.persist();
    soundEngine.play('warpJump');
    this.syncAll();
  }

  private renderPreparePanels(): void {
    const draft = this.prepareDraft;
    if (!draft) return;
    const p = this.save.profile;
    const readOnly = this.isReadOnlyTab;
    const validation = validateV2PrepareLoadout(
      p,
      draft.shipId,
      draft.crewId,
      draft.slots,
      draft.trialBuildId,
      draft.sectorId,
      {
        isFinalCampaignRun: draft.isFinalCampaignRun,
        endlessThreat: draft.isFinalCampaignRun ? 0 : draft.endlessThreat,
      }
    );
    const previewBay = this.buildPreparePreviewBay(draft);
    const fallbackPreviewSeed =
      deriveSessionRunSeed(this.urlBaseSeed, this.sessionLaunchIndex) ?? draft.defaultSeed;
    const effectivePreviewSeed =
      parseV3CustomSeedInput(draft.customSeedInput) ?? fallbackPreviewSeed;

    this.leftViewSlot.sync(
      'PREPARE',
      this.preparePhaseView,
      { profile: p, draft, readOnly, validation, effectivePreviewSeed, fallbackPreviewSeed },
      {
        onBack: () => {
          this.prepareDraft = null;
          soundEngine.play('click');
          this.syncAll();
        },
        onSelectSector: (sectorId) => {
          const curDraft = this.prepareDraft;
          const curProfile = this.save.profile;
          if (!curDraft || !curProfile.campaign.unlockedSectors.includes(sectorId)) return;
          curDraft.sectorId = sectorId;
          if (sectorId !== 'stargate_abyss' && curDraft.isFinalCampaignRun) {
            curDraft.isFinalCampaignRun = false;
          }
          this.preferredSectorId = sectorId;
          soundEngine.play('click');
          this.syncAll();
        },
        onSelectStandardMode: () => {
          const curDraft = this.prepareDraft;
          if (!curDraft) return;
          curDraft.isFinalCampaignRun = false;
          curDraft.endlessThreat = 0;
          soundEngine.play('click');
          this.syncAll();
        },
        onSelectFinalMissionMode: () => {
          const curDraft = this.prepareDraft;
          const curProfile = this.save.profile;
          if (!curDraft || !isFinalCampaignMissionUnlocked(curProfile).unlocked) return;
          curDraft.isFinalCampaignRun = true;
          curDraft.endlessThreat = 0;
          curDraft.sectorId = 'stargate_abyss';
          this.preferredSectorId = 'stargate_abyss';
          soundEngine.play('energyLink');
          this.syncAll();
        },
        onSelectEndlessMode: () => {
          const curDraft = this.prepareDraft;
          const curProfile = this.save.profile;
          if (!curDraft || !curProfile.campaign.endlessUnlocked) return;
          const maxAllowed = Math.max(
            1,
            Math.min(10, Math.floor(curProfile.campaign.maxEndlessThreat || 1))
          );
          curDraft.isFinalCampaignRun = false;
          curDraft.endlessThreat = Math.max(1, Math.min(maxAllowed, curDraft.endlessThreat || 1));
          if (curProfile.campaign.unlockedSectors.includes('stargate_abyss')) {
            curDraft.sectorId = 'stargate_abyss';
            this.preferredSectorId = 'stargate_abyss';
          }
          soundEngine.play('energyLink');
          this.syncAll();
        },
        onSelectEndlessThreat: (threat) => {
          const curDraft = this.prepareDraft;
          const curProfile = this.save.profile;
          if (!curDraft || !curProfile.campaign.endlessUnlocked) return;
          const maxAllowed = Math.max(
            1,
            Math.min(10, Math.floor(curProfile.campaign.maxEndlessThreat || 1))
          );
          if (threat < 1 || threat > maxAllowed) return;
          curDraft.isFinalCampaignRun = false;
          curDraft.endlessThreat = threat;
          soundEngine.play('click');
          this.syncAll();
        },
        onChangeCustomSeed: (raw) => {
          if (this.isReadOnlyTab) return;
          const curDraft = this.prepareDraft;
          if (!curDraft) return;
          curDraft.customSeedInput = raw;
        },
        onPickTrial: (tid) => {
          const curDraft = this.prepareDraft;
          if (!curDraft) return;
          const spec = V2_TRIAL_BUILDS[tid];
          curDraft.trialBuildId = tid;
          curDraft.primaryArchetype = spec.archetypeId;
          curDraft.slots = [...buildTrialPrepareSlots(tid, curDraft.shipId)];
          curDraft.playingDemo = true;
          curDraft.demoPlaybackKey = null;
          curDraft.missingPresetEntries = [];
          curDraft.presetNotice = null;
          soundEngine.play('energyLink');
          this.syncAll();
        },
        onExitTrial: () => {
          const curDraft = this.prepareDraft;
          const curProfile = this.save.profile;
          if (!curDraft) return;
          curDraft.trialBuildId = null;
          curDraft.playingDemo = false;
          curDraft.demoPlaybackKey = null;
          curDraft.slots = [
            ...buildFreeFallbackPrepareSlots(
              curDraft.shipId,
              curProfile.blueprints,
              getEffectiveShipLoadoutBudget(curProfile, curDraft.shipId)
            ),
          ];
          soundEngine.play('click');
          this.syncAll();
        },
        onSelectShip: (nextShip: V2ShipId) => {
          const curDraft = this.prepareDraft;
          const curProfile = this.save.profile;
          if (!curDraft || !curProfile.unlockedShips.includes(nextShip)) return;
          const canPersistShip =
            !this.isReadOnlyTab && this.tabGuard.canWrite() && !this.showcaseRun;
          if (nextShip === curDraft.shipId) {
            if (curProfile.selectedShipId !== nextShip && canPersistShip) {
              this.save = {
                ...this.save,
                profile: { ...curProfile, selectedShipId: nextShip },
              };
              this.persist();
              this.syncAll();
            }
            return;
          }
          curDraft.shipId = nextShip;
          curDraft.playingDemo = false;
          curDraft.demoPlaybackKey = null;
          curDraft.slots = curDraft.trialBuildId
            ? [...buildTrialPrepareSlots(curDraft.trialBuildId, nextShip)]
            : [
                ...buildFreeFallbackPrepareSlots(
                  nextShip,
                  curProfile.blueprints,
                  getEffectiveShipLoadoutBudget(curProfile, nextShip)
                ),
              ];
          curDraft.missingPresetEntries = [];
          curDraft.presetNotice = null;
          if (canPersistShip) {
            this.save = {
              ...this.save,
              profile: { ...curProfile, selectedShipId: nextShip },
            };
            this.persist();
          }
          soundEngine.play('click');
          this.syncAll();
        },
        onSelectCrew: (crewId) => {
          const curDraft = this.prepareDraft;
          const curProfile = this.save.profile;
          if (!curDraft || !curProfile.unlockedCrew.includes(crewId)) return;
          curDraft.crewId = crewId;
          soundEngine.play('click');
          this.syncAll();
        },
        onSelectArchetype: (arch) => {
          const curDraft = this.prepareDraft;
          if (!curDraft) return;
          curDraft.primaryArchetype = arch;
          soundEngine.play('click');
          this.syncAll();
        },
        onFallback: () => {
          const curDraft = this.prepareDraft;
          const curProfile = this.save.profile;
          if (!curDraft) return;
          curDraft.trialBuildId = null;
          curDraft.playingDemo = false;
          curDraft.demoPlaybackKey = null;
          curDraft.slots = [
            ...buildFreeFallbackPrepareSlots(
              curDraft.shipId,
              curProfile.blueprints,
              getEffectiveShipLoadoutBudget(curProfile, curDraft.shipId)
            ),
          ];
          curDraft.missingPresetEntries = [];
          curDraft.presetNotice = null;
          soundEngine.play('click');
          this.syncAll();
        },
        onClear: () => {
          const curDraft = this.prepareDraft;
          if (!curDraft) return;
          curDraft.trialBuildId = null;
          curDraft.playingDemo = false;
          curDraft.demoPlaybackKey = null;
          curDraft.slots = [];
          curDraft.missingPresetEntries = [];
          curDraft.presetNotice = null;
          soundEngine.play('click');
          this.syncAll();
        },
        onAddLoan: (defId) => {
          const curDraft = this.prepareDraft;
          if (!this.canMutate() || !curDraft || curDraft.trialBuildId) return;
          const liveBay = this.buildPreparePreviewBay(curDraft);
          const spot = findFirstLegalV2Placement(liveBay, defId);
          if (!spot) {
            this.showToast('当前船舱没有足够空位放入该设备，请先移位或卸下旧件。');
            return;
          }
          curDraft.playingDemo = false;
          curDraft.demoPlaybackKey = null;
          curDraft.slots = [
            ...curDraft.slots,
            {
              slotKey: `loan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
              origin: 'loan',
              definitionId: defId,
              x: spot.x,
              y: spot.y,
              rotation: spot.rotation,
            },
          ];
          const nextPreviewBay = this.buildPreparePreviewBay(curDraft);
          this.handlePlayerInitiatedBaySynergies(nextPreviewBay, {
            isTrialOrShowcase: false,
            playSfx: true,
            skipRenderBanners: true,
            prevBay: liveBay,
          });
          soundEngine.play(
            isHeavyPlacementItem({ definitionId: defId, category: 'equipment' })
              ? 'placeHeavy'
              : 'place'
          );
          this.syncAll();
        },
        onAddOwned: (instId) => {
          const curDraft = this.prepareDraft;
          const curProfile = this.save.profile;
          if (!this.canMutate() || !curDraft || curDraft.trialBuildId) return;
          const w = curProfile.equipmentWarehouse.find((item) => item.instanceId === instId);
          if (!w) return;
          const liveBay = this.buildPreparePreviewBay(curDraft);
          const spot = findFirstLegalV2Placement(liveBay, w.definitionId);
          if (!spot) {
            this.showToast('当前船舱没有足够空位放入该自有设备。');
            return;
          }
          curDraft.playingDemo = false;
          curDraft.demoPlaybackKey = null;
          curDraft.slots = [
            ...curDraft.slots,
            {
              slotKey: w.instanceId,
              origin: 'owned',
              definitionId: w.definitionId,
              warehouseInstanceId: w.instanceId,
              x: spot.x,
              y: spot.y,
              rotation: spot.rotation,
            },
          ];
          const nextPreviewBay = this.buildPreparePreviewBay(curDraft);
          this.handlePlayerInitiatedBaySynergies(nextPreviewBay, {
            isTrialOrShowcase: false,
            playSfx: true,
            skipRenderBanners: true,
            prevBay: liveBay,
          });
          soundEngine.play(isHeavyPlacementItem(w) ? 'placeHeavy' : 'place');
          this.syncAll();
        },
        onSavePreset: (name) => {
          const curDraft = this.prepareDraft;
          const curProfile = this.save.profile;
          if (!this.canMutate() || !curDraft || curDraft.trialBuildId) return;
          const existing = curProfile.loadoutPresets.find((pr) => pr.name === name);
          const res = saveV2LoadoutPreset(curProfile, {
            presetId: existing?.presetId,
            name,
            shipId: curDraft.shipId,
            crewId: curDraft.crewId,
            primaryArchetype: curDraft.primaryArchetype,
            slots: curDraft.slots,
          });
          if (!res.ok) {
            this.showToast(res.error ?? '保存预设失败');
            return;
          }
          this.save = { ...this.save, profile: res.profile };
          this.persist();
          soundEngine.play('click');
          this.showToast(`已保存配装预设「${name}」。`);
          this.syncAll();
        },
        onLoadPreset: (presetId) => {
          const curDraft = this.prepareDraft;
          const curProfile = this.save.profile;
          if (!curDraft) return;
          const pr = curProfile.loadoutPresets.find((item) => item.presetId === presetId);
          if (!pr) return;
          if (!curProfile.unlockedShips.includes(pr.shipId)) {
            this.showToast('预设对应的舰船尚未解锁。');
            return;
          }
          const resolved = resolveV2PresetAgainstWarehouse(curProfile, pr);
          const goodSlots = resolved
            .map((r) => r.resolved)
            .filter((x): x is V2PrepareSlotEntry => x !== null);
          const missing = resolved.filter((r) => r.missingOwned);

          curDraft.shipId = pr.shipId;
          curDraft.crewId =
            pr.crewId && curProfile.unlockedCrew.includes(pr.crewId)
              ? pr.crewId
              : curDraft.crewId;
          curDraft.primaryArchetype = pr.primaryArchetype;
          curDraft.trialBuildId = null;
          curDraft.playingDemo = false;
          curDraft.demoPlaybackKey = null;
          curDraft.slots = goodSlots;
          curDraft.missingPresetEntries = missing;
          curDraft.presetNotice =
            missing.length > 0
              ? `预设「${pr.name}」有 ${missing.length} 件自有设备当前不在仓库中，已空出对应槽位。`
              : `已完整载入预设「${pr.name}」。`;
          soundEngine.play('click');
          this.syncAll();
        },
        onSubLoan: () => {
          const curDraft = this.prepareDraft;
          if (!this.canMutate() || !curDraft || curDraft.trialBuildId) return;
          const prevBay = this.buildPreparePreviewBay(curDraft);
          let tempBay = prevBay;
          const added: V2PrepareSlotEntry[] = [...curDraft.slots];
          for (const m of curDraft.missingPresetEntries) {
            if (!m.canSubstituteCommonLoan) continue;
            const origDef = V2_EQUIPMENT_DEFS[m.presetSlot.definitionId];
            if (!origDef) continue;
            const commonDef = getV2EquipmentDefByKind(origDef.kind, 'common');
            const spot = findFirstLegalV2Placement(tempBay, commonDef.defId);
            if (!spot) continue;
            added.push({
              slotKey: `sub_${Date.now().toString(36)}_${added.length}`,
              origin: 'loan',
              definitionId: commonDef.defId,
              x: spot.x,
              y: spot.y,
              rotation: spot.rotation,
            });
            tempBay = this.buildPreparePreviewBay({ ...curDraft, slots: added });
          }
          curDraft.slots = added;
          curDraft.missingPresetEntries = [];
          curDraft.presetNotice = '已按你的确认，以借用普通蓝图补齐缺失槽位。';
          this.handlePlayerInitiatedBaySynergies(tempBay, {
            isTrialOrShowcase: false,
            playSfx: true,
            skipRenderBanners: true,
            prevBay,
          });
          soundEngine.play('place');
          this.syncAll();
        },
        onDeletePreset: (presetId) => {
          if (!this.canMutate()) return;
          this.save = {
            ...this.save,
            profile: deleteV2LoadoutPreset(this.save.profile, presetId),
          };
          this.persist();
          soundEngine.play('click');
          this.syncAll();
        },
        onLaunch: () => {
          const curDraft = this.prepareDraft;
          if (curDraft) this.launchExpeditionFromDraft(curDraft);
        },
      }
    );

    const shipMaxHp = getEffectiveShipMaxHp(p, draft.shipId);
    const draftMasteryTier = draft.crewId ? p.crewMastery[draft.crewId] ?? 0 : 0;
    this.mountV2CargoBay(previewBay, !readOnly, {
      title: `整备船舱 · ${V2_SHIPS[draft.shipId].name}`,
      prepareMode: true,
      getTacticalDelta: (item, zone) =>
        computeV2PlacementTacticalDelta({
          run: null,
          bay: previewBay,
          startingHp: shipMaxHp,
          maxHp: shipMaxHp,
          targetPolicy: 'weakest',
          item,
          zone,
          sectorId: draft.sectorId,
          crewId: draft.crewId,
          crewMasteryTier: draftMasteryTier,
          stargateRelayTier: getFacilityTier(p, 'stargate_relay'),
        }),
      onChange: (nextBay) => {
        if (!this.canMutate() || this.prepareDraft !== draft) return;
        const prevBay = this.buildPreparePreviewBay(draft);
        const wasPlayingDemo = draft.playingDemo;
        draft.playingDemo = false;
        draft.demoPlaybackKey = null;
        draft.slots = nextBay.placed.map((pl) => {
          const prev = draft.slots.find(
            (s) =>
              s.slotKey === pl.item.instanceId ||
              (s.warehouseInstanceId && s.warehouseInstanceId === pl.item.instanceId)
          );
          return {
            slotKey: prev?.slotKey ?? pl.item.instanceId,
            origin: prev?.origin ?? (pl.item.origin === 'owned' ? 'owned' : 'loan'),
            definitionId: pl.item.definitionId,
            warehouseInstanceId: prev?.warehouseInstanceId,
            x: pl.x,
            y: pl.y,
            rotation: pl.rotation,
          };
        });
        this.handlePlayerInitiatedBaySynergies(nextBay, {
          isTrialOrShowcase: Boolean(draft.trialBuildId),
          prevBay,
        });
        this.syncPrepareLocal(draft, wasPlayingDemo);
      },
      onPrepareRemove: draft.trialBuildId
        ? undefined
        : (instanceId) => {
            if (!this.canMutate() || this.prepareDraft !== draft) return;
            const wasPlayingDemo = draft.playingDemo;
            draft.playingDemo = false;
            draft.demoPlaybackKey = null;
            draft.slots = draft.slots.filter(
              (s) => s.slotKey !== instanceId && s.warehouseInstanceId !== instanceId
            );
            this.syncPrepareLocal(draft, wasPlayingDemo);
          },
    });
  }

  private handleUseGadget(run: V2RunState, instanceId: string): void {
    if (!this.canMutate()) return;
    const res = useV3GadgetInRun(run, instanceId, this.save.profile);
    if (!res.ok) {
      this.showToast(res.error ?? '当前无法使用该装置');
      return;
    }
    this.setCurrentRun(res.run);
    if (res.gadgetKind === 'repair_kit') soundEngine.play('repairPulse');
    else if (res.gadgetKind === 'overcharge_cell') soundEngine.play('energyLink');
    else soundEngine.play('place');
    if (res.message) this.showToast(res.message);
    this.syncAll();
  }

  private renderMapPhase(run: V2RunState): void {
    const readOnly = this.isReadOnlyTab && !run.isShowcase;
    const relicPassives = getActiveRelicPassives(this.save.profile);
    this.leftViewSlot.sync(
      'MAP',
      this.mapPhaseView,
      {
        run,
        readOnly,
        selectedMapNodeId: this.selectedMapNodeId,
        mobileMapShowFull: this.mobileMapShowFull,
        isCompactViewport: window.innerWidth < 860,
        pureAutoCombat: isPureAutoCombat(this.save.settings),
        bonusBossCharges: this.getBonusBossCharges(),
        fullMapReveal: relicPassives.fullMapReveal,
        stargateRelayTier: getFacilityTier(this.save.profile, 'stargate_relay'),
      },
      {
        onToggleMobileMap: () => {
          this.mobileMapShowFull = !this.mobileMapShowFull;
          soundEngine.play('click');
          const latest = this.getCurrentRun();
          if (latest && latest.phase === 'MAP') {
            this.renderMapPhase(latest);
          }
        },
        onSelectNode: (nid) => {
          this.selectedMapNodeId = nid;
          soundEngine.play('hoverValid');
          const latest = this.getCurrentRun();
          if (latest && latest.phase === 'MAP') {
            this.renderMapPhase(latest);
          }
        },
        onJumpNode: (nid) => {
          if (!this.canMutate()) return;
          const latest = this.getCurrentRun();
          if (!latest || latest.phase !== 'MAP') return;
          const executeJump = () => {
            if (!this.canMutate()) return;
            const cur = this.getCurrentRun();
            if (!cur || cur.phase !== 'MAP') return;
            const res = selectV2MapNode(cur, nid, {
              bonusBossCharges: this.getBonusBossCharges(),
              profile: this.save.profile,
            });
            if (!res.ok) {
              this.showToast(res.error ?? '无法跃迁至该节点');
              return;
            }
            this.selectedMapNodeId = null;
            this.selectedWreckHotspot = 'armory';
            this.showCombatLogDetails = false;
            this.cargoGrid?.collapseDetailsDrawer();
            const enteredNode = res.run.graph.nodes[nid];
            if (this.playtestTelemetry.isEnabled()) {
              const isSafeBeacon =
                enteredNode?.eventId === 'tutorial_safe_beacon' ||
                enteredNode?.eventState?.eventId === 'tutorial_safe_beacon';
              const isRisk = Boolean(
                enteredNode?.combat &&
                  (enteredNode.type === 'elite' ||
                    enteredNode.type === 'boss' ||
                    enteredNode.hasRelicSignal ||
                    enteredNode.layer >= cur.graph.maxLayers)
              );
              this.playtestTelemetry.recordBranchChoice(
                nid,
                isSafeBeacon ? 'safe_return' : isRisk ? 'risk_branch' : 'other'
              );
            }
            const bossId = enteredNode?.combat?.bossId ?? enteredNode?.bossId;
            if (bossId === 'boss_anvil') this.triggerCrewComm('act1_boss_intro');
            else if (bossId === 'boss_dreadnought') this.triggerCrewComm('act2_boss_intro');
            else if (bossId === 'boss_leviathan') this.triggerCrewComm('act3_boss_intro');
            this.setCurrentRun(res.run);
            soundEngine.play('warpJump');
            this.syncAll();
          };
          if (latest.bay.discardedThisArrange.length > 0) {
            openV2DiscardConfirmModal(this.modalHostEl, latest.bay.discardedThisArrange, executeJump);
          } else {
            executeJump();
          }
        },
        onUseGadget: (instanceId) => {
          const latest = this.getCurrentRun();
          if (!latest || latest.phase !== 'MAP') return;
          this.handleUseGadget(latest, instanceId);
        },
        onSafeReturn: () => {
          if (!this.canMutate()) return;
          const latest = this.getCurrentRun();
          if (!latest || latest.phase !== 'MAP') return;
          const executeSafeReturn = () => {
            if (!this.canMutate()) return;
            const cur = this.getCurrentRun();
            if (!cur || cur.phase !== 'MAP') return;
            const status = getV2SafeReturnStatus(cur);
            const res = status.isFreeBeacon
              ? initiateV2SafeReturnFromMap(cur)
              : initiateV2EmergencyTowReturn(cur);
            if (!res.ok) return this.showToast(res.error ?? '当前无法返航');
            this.playtestTelemetry.recordBranchChoice(cur.currentNodeId, 'safe_return');
            this.resetSettlementUiState();
            this.setCurrentRun(res.run);
            soundEngine.play('returnDock');
            this.syncAll();
          };
          if (latest.bay.discardedThisArrange.length > 0) {
            openV2DiscardConfirmModal(
              this.modalHostEl,
              latest.bay.discardedThisArrange,
              executeSafeReturn
            );
          } else {
            executeSafeReturn();
          }
        },
        onAbortContract: () => {
          if (!this.canMutate()) return;
          const latest = this.getCurrentRun();
          if (!latest || latest.phase !== 'MAP') return;
          const nextRun = abortActiveV2Contract(latest);
          this.setCurrentRun(nextRun);
          soundEngine.play('click');
          this.showToast(
            latest.contract.type === 'rescue'
              ? '已放弃救援委托：救生舱已由信标移交，释放船舱空位与额外油耗。'
              : '已放弃当前委托，可继续自由探索或免费返航。'
          );
          this.syncAll();
        },
      }
    );

    this.mountV2CargoBay(run.bay, !readOnly, {
      title: `当前船舱 · ${V2_SHIPS[run.shipId].name}`,
      statusBadge: readOnly ? '只读观察' : '航行中 · 可调整',
      getTacticalDelta: (item, zone) => {
        const activeRun = this.getCurrentRun() ?? run;
        return computeV2PlacementTacticalDelta({
          run: activeRun,
          bay: activeRun.bay,
          startingHp: activeRun.hp,
          maxHp: activeRun.maxHp,
          targetPolicy: activeRun.targetPolicy,
          item,
          zone,
          stargateRelayTier: getFacilityTier(this.save.profile, 'stargate_relay'),
        });
      },
      onChange: (nextBay) => {
        if (!this.canMutate()) return;
        const curRun = this.getCurrentRun();
        if (!curRun || curRun.phase !== 'MAP') return;
        this.handlePlayerInitiatedBaySynergies(nextBay, {
          isTrialOrShowcase: Boolean(curRun.isShowcase),
          prevBay: curRun.bay,
        });
        this.syncMapLocal({ ...curRun, bay: nextBay });
      },
    });
  }

  private renderEncounterPhase(run: V2RunState): void {
    const node = run.currentNodeId ? run.graph.nodes[run.currentNodeId] : null;
    if (!node) {
      this.leftViewSlot.unmount(true);
      this.preCombatAutoEngage.reset();
      return;
    }
    const readOnly = this.isReadOnlyTab && !run.isShowcase;

    if (node.combat) {
      if (run.activeCombat) {
        this.preCombatAutoEngage.reset();
        this.leftViewSlot.unmount(true);
        // S03: Keep persistent HoldView (CargoGridV2) mounted & read-only across live combat (0 mid-voyage teardown).
        this.mountV2CargoBay(run.bay, false, {
          title: `参战船舱 · ${V2_SHIPS[run.shipId].name}`,
          statusBadge: '交火中 · 只读',
        });
        return;
      }

      const pureAuto = isPureAutoCombat(this.save.settings);
      const bonusBossCharges = this.getBonusBossCharges();
      const stargateRelayTier = getFacilityTier(this.save.profile, 'stargate_relay');
      const autoEngageSnap = this.preCombatAutoEngage.sync(
        this.getPreCombatAutoEngageLiveEligibility()
      );
      this.leftViewSlot.sync(
        'COMBAT_PRE',
        this.combatPrePhaseView,
        {
          run,
          node,
          readOnly,
          showCombatLogDetails: this.showCombatLogDetails,
          pureAutoCombat: pureAuto,
          bonusBossCharges,
          stargateRelayTier,
          autoEngage: autoEngageSnap,
        },
        {
          onSelectPolicy: (policy) => {
            if (!this.canMutate()) return;
            const latest = this.getCurrentRun();
            if (!latest || latest.phase !== 'ENCOUNTER' || latest.activeCombat) return;
            this.preCombatAutoEngage.pause('policy');
            this.setCurrentRun({ ...latest, targetPolicy: policy });
            soundEngine.play('tacticalOrder');
            this.syncAll();
          },
          onToggleLog: () => {
            const latest = this.getCurrentRun();
            if (!latest || latest.phase !== 'ENCOUNTER' || latest.activeCombat) return;
            this.preCombatAutoEngage.pause('details');
            this.showCombatLogDetails = !this.showCombatLogDetails;
            this.renderEncounterPhase(latest);
          },
          onUseGadget: (instanceId) => {
            const latest = this.getCurrentRun();
            if (!latest || latest.phase !== 'ENCOUNTER' || latest.activeCombat) return;
            this.preCombatAutoEngage.pause('gadget');
            this.handleUseGadget(latest, instanceId);
          },
          onTogglePauseAutoEngage: () => {
            if (!this.canMutate()) return;
            if (this.preCombatAutoEngage.togglePause()) {
              soundEngine.play('click');
              this.refreshPreCombatAutoEngageUi();
            }
          },
          onToggleLockEnemy: (enemyId) => {
            this.handleToggleEnemyLock(enemyId);
          },
          onStartCombat: () => {
            if (!this.canMutate()) return;
            this.preCombatAutoEngage.engageNow();
          },
        }
      );

      this.mountV2CargoBay(run.bay, false, {
        title: `参战船舱 · ${V2_SHIPS[run.shipId].name}`,
        statusBadge: '战前锁定',
        getTacticalDelta: (item, zone) => {
          const activeRun = this.getCurrentRun() ?? run;
          return computeV2PlacementTacticalDelta({
            run: activeRun,
            bay: activeRun.bay,
            startingHp: activeRun.hp,
            maxHp: activeRun.maxHp,
            targetPolicy: activeRun.targetPolicy,
            item,
            zone,
            stargateRelayTier: getFacilityTier(this.save.profile, 'stargate_relay'),
          });
        },
      });
      return;
    }

    this.preCombatAutoEngage.reset();

    if (node.type === 'wreck' && (node.wreck || run.activeWreck)) {
      this.leftViewSlot.sync(
        'WRECK',
        this.wreckPhaseView,
        {
          run,
          node,
          profile: this.save.profile,
          readOnly,
          selectedHotspot: this.selectedWreckHotspot,
          cuttingSpotId: this.inFlightWreckCut?.spotId ?? null,
        },
        {
          onSelectHotspot: (spot) => {
            const latest = this.getCurrentRun() ?? run;
            const latestNode =
              (latest.currentNodeId ? latest.graph.nodes[latest.currentNodeId] : null) ?? node;
            this.selectedWreckHotspot = spot;
            soundEngine.play('hoverValid');
            this.renderWreckOverlay(latest, latestNode);
            this.renderEncounterPhase(latest);
          },
          onCutSpot: (spotId: V2WreckSpotId) => {
            this.startWreckCutSequence(spotId);
          },
          onSkipCut: () => {
            this.skipInFlightWreckCut();
          },
          onUseGadget: (instanceId) => {
            if (this.inFlightWreckCut) return;
            const latest = this.getCurrentRun();
            if (!latest || latest.phase !== 'ENCOUNTER') return;
            this.handleUseGadget(latest, instanceId);
          },
          onExtract: () => {
            if (!this.canMutate() || this.inFlightWreckCut) return;
            const latest = this.getCurrentRun();
            if (!latest || latest.phase !== 'ENCOUNTER') return;
            const res = extractV2Wreck(latest);
            if (!res.ok) return this.showToast(res.error ?? '无法撤离残骸');
            if (res.run.phase === 'SETTLEMENT') {
              this.resetSettlementUiState();
            }
            this.setCurrentRun(res.run);
            soundEngine.play(res.run.phase === 'SETTLEMENT' ? 'returnDock' : 'pickup');
            this.syncAll();
          },
          onAbandon: () => {
            if (!this.canMutate() || this.inFlightWreckCut) return;
            const latest = this.getCurrentRun();
            if (!latest || latest.phase !== 'ENCOUNTER') return;
            const res = abandonV2EventAndReturn(latest);
            if (!res.ok) return this.showToast(res.error ?? '无法放弃返航');
            this.resetSettlementUiState();
            this.setCurrentRun(res.run);
            soundEngine.play('returnDock');
            this.syncAll();
          },
        }
      );
      this.mountV2CargoBay(run.bay, false, { title: '当前船舱参考', statusBadge: '参考空位' });
      return;
    }

    this.leftViewSlot.sync(
      'EVENT',
      this.eventPhaseView,
      { run, node, readOnly },
      {
        onSelectEventOption: (optionIndex) => {
          if (!this.canMutate()) return;
          const latest = this.getCurrentRun();
          if (!latest || latest.phase !== 'ENCOUNTER') return;
          const res = resolveV2EventOption(
            latest,
            optionIndex,
            this.save.profile.unlockedFamilies
          );
          if (!res.ok) return this.showToast(res.error ?? '操作失败');
          if (res.run.phase === 'SETTLEMENT') {
            this.resetSettlementUiState();
          }
          this.setCurrentRun(res.run);
          if (res.hadDamage) soundEngine.play('hullHit');
          else if (res.hadHeal) soundEngine.play('repairPulse');
          else if ((res.gainedItemsCount ?? 0) > 0) soundEngine.play('rewardRare');
          else soundEngine.play('click');
          this.syncAll();
        },
        onAnomalyChoice: (choice) => {
          if (!this.canMutate()) return;
          const latest = this.getCurrentRun();
          if (!latest || latest.phase !== 'ENCOUNTER') return;
          const res = resolveV2AnomalyChoice(latest, choice);
          if (!res.ok) return this.showToast(res.error ?? '操作失败');
          if (res.run.phase === 'SETTLEMENT') {
            this.resetSettlementUiState();
          }
          this.setCurrentRun(res.run);
          soundEngine.play('place');
          this.syncAll();
        },
        onDistressChoice: (choice) => {
          if (!this.canMutate()) return;
          const latest = this.getCurrentRun();
          if (!latest || latest.phase !== 'ENCOUNTER') return;
          const res = resolveV2DistressChoice(latest, choice);
          if (!res.ok) return this.showToast(res.error ?? '操作失败');
          if (res.run.phase === 'SETTLEMENT') {
            this.resetSettlementUiState();
          }
          this.setCurrentRun(res.run);
          soundEngine.play('place');
          this.syncAll();
        },
        onAbandon: () => {
          if (!this.canMutate()) return;
          const latest = this.getCurrentRun();
          if (!latest || latest.phase !== 'ENCOUNTER') return;
          const res = abandonV2EventAndReturn(latest);
          if (!res.ok) return this.showToast(res.error ?? '无法放弃返航');
          this.resetSettlementUiState();
          this.setCurrentRun(res.run);
          soundEngine.play('returnDock');
          this.syncAll();
        },
      }
    );

    this.mountV2CargoBay(run.bay, false, { title: '当前船舱一览', statusBadge: '参考空位' });
  }

  private handleEngineerSwap(run: V2RunState, kind: V2EquipmentKind): void {
    if (!this.canMutate()) return;
    const res = applyV2EngineerSwap(run, kind);
    if (!res.ok) return this.showToast(res.error ?? '改装失败');
    const swappedItem = res.run.bay.staging.find((s) => s.item.instanceId.endsWith('_eng'))?.item;
    const qualityTag = swappedItem?.quality === 'improved' ? '（优良）' : '';
    this.setCurrentRun(res.run);
    soundEngine.play('place');
    this.showToast(`林工已改装为「${getV2EquipmentDefByKind(kind, 'common').name}${qualityTag}」。`);
    this.syncAll();
  }

  private renderShopPhase(run: V2RunState): void {
    const node = run.currentNodeId ? run.graph.nodes[run.currentNodeId] : null;
    if (!node || !node.merchant) {
      this.leftViewSlot.unmount(true);
      return;
    }
    const readOnly = this.isReadOnlyTab && !run.isShowcase;
    const guildRep = this.save.profile.factionRep.starport_guild ?? 0;

    this.leftViewSlot.sync(
      'SHOP',
      this.shopPhaseView,
      { run, node, readOnly, starportGuildRep: guildRep },
      {
        onBuyOffer: (oid) => {
          if (!this.canMutate()) return;
          const latest = this.getCurrentRun();
          const latestNode = latest?.currentNodeId ? latest.graph.nodes[latest.currentNodeId] : null;
          if (!latest || latest.phase !== 'SHOP' || !latestNode) return;
          const latestRep = this.save.profile.factionRep.starport_guild ?? 0;
          const res = buyV2MerchantOffer(
            latest,
            oid,
            `tx_offer_${latestNode.nodeId}_${oid}`,
            this.save.profile.unlockedFamilies,
            latestRep
          );
          if (!res.ok) return this.showToast(res.error ?? '购买失败');
          this.setCurrentRun(res.run);
          soundEngine.play('cashRegister');
          this.syncAll();
        },
        onBuyFuel: () => {
          if (!this.canMutate()) return;
          const latest = this.getCurrentRun();
          const latestNode = latest?.currentNodeId ? latest.graph.nodes[latest.currentNodeId] : null;
          if (!latest || latest.phase !== 'SHOP' || !latestNode) return;
          const latestRep = this.save.profile.factionRep.starport_guild ?? 0;
          const res = buyV2MerchantFuel(latest, `tx_fuel_${latestNode.nodeId}`, latestRep);
          if (!res.ok) return this.showToast(res.error ?? '无法购买燃料');
          this.setCurrentRun(res.run);
          soundEngine.play('cashRegister');
          this.syncAll();
        },
        onBuyRepair: () => {
          if (!this.canMutate()) return;
          const latest = this.getCurrentRun();
          const latestNode = latest?.currentNodeId ? latest.graph.nodes[latest.currentNodeId] : null;
          if (!latest || latest.phase !== 'SHOP' || !latestNode) return;
          const latestRep = this.save.profile.factionRep.starport_guild ?? 0;
          const res = buyV2MerchantRepair(latest, `tx_repair_${latestNode.nodeId}`, latestRep);
          if (!res.ok) return this.showToast(res.error ?? '无法购买维修');
          this.setCurrentRun(res.run);
          soundEngine.play('repairPulse');
          this.syncAll();
        },
        onSellLoot: (iid) => {
          if (!this.canMutate()) return;
          const latest = this.getCurrentRun();
          const latestNode = latest?.currentNodeId ? latest.graph.nodes[latest.currentNodeId] : null;
          if (!latest || latest.phase !== 'SHOP' || !latestNode) return;
          const res = sellV2ItemToMerchant(latest, iid, `tx_sell_${latestNode.nodeId}_${iid}`);
          if (!res.ok) return this.showToast(res.error ?? '出售失败');
          this.setCurrentRun(res.run);
          soundEngine.play('cashRegister');
          this.syncAll();
        },
        onEngineerSwap: (kind) => {
          const latest = this.getCurrentRun();
          if (!latest || latest.phase !== 'SHOP') return;
          this.handleEngineerSwap(latest, kind);
        },
        onFinish: () => {
          if (!this.canMutate()) return;
          const latest = this.getCurrentRun();
          if (!latest || latest.phase !== 'SHOP') return;
          const preview = finishV2MerchantVisit(latest);
          if (!preview.ok) return this.showToast(preview.error ?? '无法离开商人节点');
          const executeFinish = () => {
            if (!this.canMutate()) return;
            const cur = this.getCurrentRun();
            if (!cur || cur.phase !== 'SHOP') return;
            const res = finishV2MerchantVisit(cur);
            if (!res.ok) return this.showToast(res.error ?? '无法离开商人节点');
            if (res.run.phase === 'SETTLEMENT') {
              this.resetSettlementUiState();
            }
            this.setCurrentRun(res.run);
            soundEngine.play(res.run.phase === 'SETTLEMENT' ? 'returnDock' : 'warpJump');
            this.syncAll();
          };
          if (latest.bay.discardedThisArrange.length > 0 && preview.run.phase !== 'ARRANGE') {
            openV2DiscardConfirmModal(
              this.modalHostEl,
              latest.bay.discardedThisArrange,
              executeFinish
            );
          } else {
            executeFinish();
          }
        },
      }
    );

    this.mountV2CargoBay(run.bay, !readOnly, {
      title: '商人节点船舱整理',
      getTacticalDelta: (item, zone) => {
        const activeRun = this.getCurrentRun() ?? run;
        return computeV2PlacementTacticalDelta({
          run: activeRun,
          bay: activeRun.bay,
          startingHp: activeRun.hp,
          maxHp: activeRun.maxHp,
          targetPolicy: activeRun.targetPolicy,
          item,
          zone,
          stargateRelayTier: getFacilityTier(this.save.profile, 'stargate_relay'),
        });
      },
      onChange: (nextBay) => {
        if (!this.canMutate()) return;
        const curRun = this.getCurrentRun();
        if (!curRun || curRun.phase !== 'SHOP') return;
        this.handlePlayerInitiatedBaySynergies(nextBay, {
          isTrialOrShowcase: Boolean(curRun.isShowcase),
          prevBay: curRun.bay,
        });
        this.syncShopLocal({ ...curRun, bay: nextBay });
      },
    });
  }

  private renderRewardPhase(run: V2RunState): void {
    const readOnly = this.isReadOnlyTab && !run.isShowcase;
    this.leftViewSlot.sync(
      'REWARD',
      this.rewardPhaseView,
      {
        run,
        readOnly,
        stargateRelayTier: getFacilityTier(this.save.profile, 'stargate_relay'),
      },
      {
        onPickReward: (choice) => {
          if (!this.canMutate()) return;
          const latest = this.getCurrentRun();
          if (!latest || latest.phase !== 'REWARD') return;
          const res = pickV2CombatReward(latest, choice, this.save.profile.unlockedFamilies);
          if (!res.ok) return this.showToast(res.error ?? '领取奖励失败');
          if (res.run.phase === 'SETTLEMENT') {
            this.resetSettlementUiState();
          }
          this.setCurrentRun(res.run);
          soundEngine.play(
            choice === 'skip' ? 'click' : choice === 'repair' ? 'repairPulse' : 'rewardRare'
          );
          this.syncAll();
        },
      }
    );

    this.mountV2CargoBay(run.bay, false, { title: '当前船舱参考', statusBadge: '参考空位' });
  }

  private renderArrangePhase(run: V2RunState): void {
    const readOnly = this.isReadOnlyTab && !run.isShowcase;
    const collapsed = this.isArrangeSceneCollapsed();

    this.leftViewSlot.sync(
      'ARRANGE',
      this.arrangePhaseView,
      { run, readOnly, sceneCollapsed: collapsed },
      {
        onToggleShipPreview: () => {
          this.sceneCollapseOverride = !this.isArrangeSceneCollapsed();
          soundEngine.play('click');
          this.syncAll();
        },
        onEngineerSwap: (kind) => {
          const latest = this.getCurrentRun();
          if (!latest || latest.phase !== 'ARRANGE') return;
          this.handleEngineerSwap(latest, kind);
        },
        onSurveyScan: () => {
          if (!this.canMutate()) return;
          const latest = this.getCurrentRun();
          if (!latest || latest.phase !== 'ARRANGE') return;
          const res = performSurveyAtCurrentNode(latest);
          if (!res.ok) return this.showToast(res.reason ?? '无法执行勘测');
          this.setCurrentRun(res.run);
          soundEngine.play('energyLink');
          this.showToast('航迹勘测完成！');
          this.syncAll();
        },
        onUseGadget: (instanceId) => {
          const latest = this.getCurrentRun();
          if (!latest || latest.phase !== 'ARRANGE') return;
          this.handleUseGadget(latest, instanceId);
        },
        onAbortContract: () => {
          if (!this.canMutate()) return;
          const latest = this.getCurrentRun();
          if (!latest || latest.phase !== 'ARRANGE') return;
          const nextRun = abortActiveV2Contract(latest);
          this.setCurrentRun(nextRun);
          soundEngine.play('click');
          this.showToast('已放弃当前委托。');
          this.syncAll();
        },
        onLeaveArrange: (terminal) => {
          if (!this.canMutate()) return;
          const latest = this.getCurrentRun();
          if (!latest || latest.phase !== 'ARRANGE') return;
          const proceed = () => {
            if (!this.canMutate()) return;
            const cur = this.getCurrentRun();
            if (!cur || cur.phase !== 'ARRANGE') return;
            const res = finishV2ArrangeAndProceed(cur, terminal ? 'safe_return' : 'map');
            if (!res.ok) return this.showToast(res.error ?? '当前无法离开整理');
            if (res.run.phase === 'SETTLEMENT') {
              this.resetSettlementUiState();
            }
            this.setCurrentRun(res.run);
            soundEngine.play(res.run.phase === 'SETTLEMENT' ? 'returnDock' : 'tacticalOrder');
            this.syncAll();
          };
          if (latest.bay.discardedThisArrange.length > 0) {
            openV2DiscardConfirmModal(this.modalHostEl, latest.bay.discardedThisArrange, proceed);
          } else {
            proceed();
          }
        },
      }
    );

    this.mountV2CargoBay(run.bay, !readOnly, {
      title: `整舱拼装 · ${V2_SHIPS[run.shipId].name}`,
      statusBadge: '可调整',
      getInspectorHost: () =>
        window.innerWidth >= 860
          ? this.arrangePhaseView.getInspectorSlot() ??
            this.leftPanelEl.querySelector<HTMLElement>('#v3-arrange-inspector-slot')
          : null,
      getTacticalDelta: (item, zone) => {
        const activeRun = this.getCurrentRun() ?? run;
        return computeV2PlacementTacticalDelta({
          run: activeRun,
          bay: activeRun.bay,
          startingHp: activeRun.hp,
          maxHp: activeRun.maxHp,
          targetPolicy: activeRun.targetPolicy,
          item,
          zone,
          stargateRelayTier: getFacilityTier(this.save.profile, 'stargate_relay'),
        });
      },
      onChange: (nextBay) => {
        if (!this.canMutate()) return;
        const curRun = this.getCurrentRun();
        if (!curRun || curRun.phase !== 'ARRANGE') return;
        this.handlePlayerInitiatedBaySynergies(nextBay, {
          isTrialOrShowcase: Boolean(curRun.isShowcase),
          prevBay: curRun.bay,
        });
        this.syncArrangeLocal({ ...curRun, bay: nextBay });
      },
    });
  }

  private readonly handleSettlementRollupKey = (ev: KeyboardEvent): void => {
    if (hasOpenModal()) return;
    if (!this.settlementRollup.isActive()) return;
    if (ev.key === ' ' || ev.key === 'Enter' || ev.key === 'Escape') {
      ev.preventDefault();
      this.settlementRollup.skip();
      window.removeEventListener('keydown', this.handleSettlementRollupKey);
    }
  };

  private cancelSettlementRollup(): void {
    this.settlementRollup.cancel();
    this.settledRollupRunId = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleSettlementRollupKey);
    }
  }

  private buildDockingCargoItems(
    summary: ReturnType<typeof calculateV2Settlement>
  ): readonly ReturnDockingCargoItem[] {
    const nonLoan = summary.lines.filter((l) => l.item.origin !== 'loan');
    const pool = nonLoan.length > 0 ? nonLoan : summary.lines;
    const priorityOf = (l: (typeof summary.lines)[number]): number => {
      if (l.selectedDisposition === 'keep_relic' || l.relicId) return 0;
      if (l.item.category === 'mission' || l.item.origin === 'mission') return 1;
      return 2;
    };
    const sorted = [...pool].sort((a, b) => {
      const pa = priorityOf(a);
      const pb = priorityOf(b);
      if (pa !== pb) return pa - pb;
      return b.item.fixedValue - a.item.fixedValue;
    });
    return sorted.slice(0, 5).map((l) => ({
      instanceId: l.item.instanceId,
      definitionId: l.item.definitionId,
      name: l.name,
      artUrl: getItemImageUrl(l.item.definitionId),
      isRelic: Boolean(l.relicId || l.selectedDisposition === 'keep_relic'),
      isMission: l.item.category === 'mission' || l.item.origin === 'mission',
      toDisplay: l.selectedDisposition === 'keep_relic',
    }));
  }

  private resetSettlementUiState(): void {
    this.settlementDispositions = {};
    this.selectedSettlementFamilyUnlock = null;
  }

  private renderSettlementPhase(run: V2RunState): void {
    if (this.settlementRollup.isActive() && this.settledRollupRunId === run.runId) {
      this.settlementRollup.skip({ silentCashRegister: true });
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', this.handleSettlementRollupKey);
      }
    }
    const p = this.save.profile;
    const readOnly = this.isReadOnlyTab && !run.isShowcase;
    const summary = calculateV2Settlement(run, p, this.settlementDispositions);
    const validChoices = summary.pendingFamilyUnlockChoices ?? [];
    if (
      this.selectedSettlementFamilyUnlock !== null &&
      !validChoices.includes(this.selectedSettlementFamilyUnlock)
    ) {
      this.selectedSettlementFamilyUnlock = null;
    }
    const isSafe = summary.reason === 'safe_return';
    const projectedCredits = p.credits + summary.finalCreditsEarned;
    const nextGoal = this.computeNextBaseGoal(p, projectedCredits);

    this.leftViewSlot.sync(
      'SETTLEMENT',
      this.settlementPhaseView,
      {
        run,
        profile: p,
        summary,
        nextGoal,
        readOnly,
        selectedFamilyUnlock: this.selectedSettlementFamilyUnlock,
      },
      {
        onChangeDisposition: (iid, disp) => {
          if (!this.canMutate()) return;
          const curRun = this.getCurrentRun() ?? run;
          this.settlementRollup.skip({ silentCashRegister: true });
          window.removeEventListener('keydown', this.handleSettlementRollupKey);
          this.settlementDispositions[iid] = disp;
          soundEngine.play(
            disp === 'dismantle'
              ? 'clampPop'
              : disp === 'keep_relic'
              ? 'relicRestore'
              : 'creditTick'
          );
          this.renderTopHud();
          this.renderSettlementPhase(curRun);
        },
        onSelectFamilyUnlock: (family) => {
          if (!this.canMutate()) return;
          const curRun = this.getCurrentRun() ?? run;
          this.selectedSettlementFamilyUnlock = family;
          soundEngine.play('click');
          this.renderSettlementPhase(curRun);
        },
        onSkipRollup: () => {
          this.settlementRollup.skip();
          window.removeEventListener('keydown', this.handleSettlementRollupKey);
        },
        onShowcaseRetry: () => {
          this.cancelSettlementRollup();
          soundEngine.play('click');
          openV2ShowcasePickerModal(this.modalHostEl, (tid) => this.startShowcaseRun(tid));
        },
        onShowcaseToBase: () => {
          this.cancelSettlementRollup();
          soundEngine.play('returnDock');
          this.showcaseRun = null;
          this.resetSettlementUiState();
          this.syncAll();
        },
        onConfirmSettlement: () => {
          if (!this.canMutate()) return;
          if (!this.save.activeRun || this.save.activeRun.phase !== 'SETTLEMENT') return;

          this.cancelSettlementRollup();

          const creditsBefore = this.save.profile.credits;
          const result = applyV2Settlement(
            this.save.profile,
            this.save.activeRun,
            this.settlementDispositions,
            { chosenFamily: this.selectedSettlementFamilyUnlock }
          );
          if (!result.ok) {
            this.showToast(result.error ?? '结算失败');
            return;
          }

          const dockingItems = this.buildDockingCargoItems(result.summary);
          const wasTutorialCompleted = this.save.profile.tutorialCompleted;
          this.save = {
            ...this.save,
            profile: result.profile,
            activeRun: null,
          };
          if (!wasTutorialCompleted && result.profile.tutorialCompleted) {
            this.campaignBannerCollapsed = false;
          }
          this.resetSettlementUiState();
          this.settledRunsCountInSession += 1;
          this.persist();

          soundEngine.play(result.summary.contractCompleted ? 'contractDeliver' : 'returnDock');

          const repNotes = Object.entries(result.factionRepGains ?? {})
            .filter(([, delta]) => typeof delta === 'number' && delta > 0)
            .map(([fid, delta]) => `${V3_FACTIONS[fid as FactionId]?.name ?? fid}声望 +${delta}`);

          const unlockedParts = [
            result.actTransition
              ? `主线推进：${CAMPAIGN_CHAPTERS[result.actTransition.to].title}`
              : null,
            result.newlyUnlockedSectors && result.newlyUnlockedSectors.length > 0
              ? `解锁星区：${result.newlyUnlockedSectors.map((sid) => getV3SectorDef(sid).name).join('、')}`
              : null,
            result.endlessClearedThreat
              ? `无尽深渊 威压 ${result.endlessClearedThreat} 通关`
              : null,
            result.newlyUnlockedAchievementIds && result.newlyUnlockedAchievementIds.length > 0
              ? `解锁成就 ×${result.newlyUnlockedAchievementIds.length}`
              : null,
            result.crewMasteryUpgraded
              ? `${V2_CREW[result.crewMasteryUpgraded.crewId].name}专精升至 Lv.${result.crewMasteryUpgraded.toTier}`
              : null,
            result.unlockedFamilyName ? `解锁体系：${result.unlockedFamilyName}` : null,
            result.unlockedCrewName ? `新船员加入：${result.unlockedCrewName}` : null,
            ...repNotes,
          ].filter(Boolean);

          // Trigger non-blocking crew comm banner on major campaign/crew/relic beats (never auto-opens modal!)
          if (result.newlyDefeatedBossIds?.includes('boss_anvil')) {
            this.triggerCrewComm('act1_boss_clear');
          } else if (result.newlyDefeatedBossIds?.includes('boss_dreadnought')) {
            this.triggerCrewComm('act2_boss_clear');
          } else if (result.actTransition?.to === 'act1') {
            this.triggerCrewComm('act1_start');
          } else if (result.unlockedCrewName?.includes('苏岚')) {
            this.triggerCrewComm('crew_salvager_join');
          } else if (result.unlockedCrewName?.includes('陆衡')) {
            this.triggerCrewComm('crew_navigator_join');
          } else if (Object.keys(result.summary.keptRelicsById).length > 0) {
            this.triggerCrewComm('relic_recovered');
          }

          const reduced = this.save.settings.reducedMotion;
          const notice: V2ReturnDockingNotice = {
            creditsBefore,
            creditsAfter: result.profile.credits,
            earnedCredits: result.summary.finalCreditsEarned,
            earnedParts: result.summary.totalSalvagePartsEarned,
            contractCompleted: result.summary.contractCompleted,
            unlockedText: unlockedParts.length > 0 ? unlockedParts.join(' · ') : null,
            crateCount: Math.max(1, dockingItems.length || result.summary.lines.length),
            hasKeptRelic: Object.keys(result.summary.keptRelicsById).length > 0,
            wasDefeat: result.summary.reason === 'defeat',
            animating: !reduced,
            progress: reduced ? 1 : 0,
          };
          this.activeDockingNotice = notice;
          this.syncAll();

          if (!reduced) {
            const syncDockingSlot = () => {
              const updated =
                this.basePhaseView.isMountedIn(this.sceneOverlayEl) &&
                this.basePhaseView.updateDockingNotice(this.activeDockingNotice, {
                  onSkipDocking: () => {
                    this.phaserHost?.skipBaseReturnDocking();
                  },
                  onCloseDocking: () => {
                    this.activeDockingNotice = null;
                    this.basePhaseView.updateDockingNotice(null);
                  },
                });
              if (!updated && this.computeCurrentScreen() === 'base') {
                this.renderBaseHeroOverlay();
              }
            };
            this.phaserHost?.playBaseReturnDocking({
              earnedCredits: notice.earnedCredits,
              crateCount: notice.crateCount,
              hasKeptRelic: notice.hasKeptRelic,
              wasDefeat: notice.wasDefeat,
              items: dockingItems,
              onProgress: (prog) => {
                if (this.activeDockingNotice !== notice) return;
                notice.progress = prog;
                this.renderTopHud();
                syncDockingSlot();
              },
              onFinish: () => {
                if (this.activeDockingNotice !== notice) return;
                notice.animating = false;
                notice.progress = 1;
                this.renderTopHud();
                syncDockingSlot();
              },
            });
          }
        },
      }
    );

    if (this.settledRollupRunId !== run.runId) {
      this.settledRollupRunId = run.runId;
      this.settlementRollup.start(
        this.leftPanelEl,
        summary.finalCreditsEarned,
        this.save.settings.reducedMotion,
        {
          onComplete: () => {
            window.removeEventListener('keydown', this.handleSettlementRollupKey);
          },
        }
      );
      if (this.settlementRollup.isActive()) {
        window.addEventListener('keydown', this.handleSettlementRollupKey);
      }
    }

    this.mountV2CargoBay(run.bay, false, {
      title: isSafe ? '返航船舱清点' : '战败前最终布局',
      statusBadge: '结算清点',
    });
  }

  // --- Shared Right-Panel CargoGridV2 Mount ---

  private teardownCargoBay(): void {
    this.cargoGrid?.destroy();
    this.cargoGrid = null;
    this.cargoHeaderTitleEl = null;
    this.cargoHeaderSubEl = null;
    this.cargoMountEl = null;
  }

  private updateStageMountStrip(
    visualSpec: ReturnType<typeof deriveV2ShipVisualSpec>,
    fallbackMutedLabel?: string
  ): void {
    this.lastStaticOverlayKey = null;
    const existingStrip = this.sceneOverlayEl.querySelector<HTMLElement>('.v2-mount-strip');
    if (visualSpec.mountSummaryTags.length === 0 && !fallbackMutedLabel) {
      existingStrip?.remove();
      return;
    }
    const html =
      visualSpec.mountSummaryTags.length > 0
        ? visualSpec.mountSummaryTags.map((t) => `<span class="v2-mount-pill">${t}</span>`).join('')
        : `<span class="v2-mount-pill muted">${fallbackMutedLabel}</span>`;
    if (existingStrip) {
      existingStrip.innerHTML = html;
    } else if (this.sceneOverlayEl.querySelector('.scene-stage-tag')) {
      const strip = document.createElement('div');
      strip.className = 'v2-mount-strip';
      strip.innerHTML = html;
      this.sceneOverlayEl.appendChild(strip);
    }
  }

  private syncArrangeLocal(nextRun: V2RunState): void {
    const prevStorageError = this.storageError;
    this.setCurrentRun(nextRun);
    const visualSpec = deriveV2ShipVisualSpec(nextRun.bay);
    this.phaserHost?.updateV2ShipVisualSpec(visualSpec);
    this.updateStageMountStrip(visualSpec);
    this.renderTopHud();
    if (this.storageError !== prevStorageError) {
      this.renderBanners();
    }
    this.renderArrangePhase(nextRun);
  }

  private syncMapLocal(nextRun: V2RunState): void {
    const prevStorageError = this.storageError;
    this.setCurrentRun(nextRun);
    const visualSpec = deriveV2ShipVisualSpec(nextRun.bay);
    this.phaserHost?.updateV2ShipVisualSpec(visualSpec);
    this.updateStageMountStrip(visualSpec);
    this.renderTopHud();
    if (this.storageError !== prevStorageError) {
      this.renderBanners();
    }
    this.renderMapPhase(nextRun);
  }

  private syncShopLocal(nextRun: V2RunState): void {
    const prevStorageError = this.storageError;
    this.setCurrentRun(nextRun);
    const visualSpec = deriveV2ShipVisualSpec(nextRun.bay);
    this.phaserHost?.updateV2ShipVisualSpec(visualSpec);
    this.renderTopHud();
    if (this.storageError !== prevStorageError) {
      this.renderBanners();
    }
    this.renderShopPhase(nextRun);
  }

  private syncPrepareLocal(draft: V2PrepareDraft, wasPlayingDemo: boolean): void {
    const previewBay = this.buildPreparePreviewBay(draft);
    const visualSpec = deriveV2ShipVisualSpec(previewBay);
    if (wasPlayingDemo) {
      this.syncPhaserStage();
    } else {
      this.phaserHost?.updateV2ShipVisualSpec(visualSpec);
      this.updateStageMountStrip(visualSpec, '仅舰载核心小炮');
    }
    this.renderPreparePanels();
  }

  private mountV2CargoBay(
    bay: V2CargoBayState,
    editable: boolean,
    opts: {
      readonly title: string;
      readonly statusBadge?: string;
      readonly prepareMode?: boolean;
      readonly getInspectorHost?: () => HTMLElement | null;
      readonly getTacticalDelta?: (
        item: V2PlacedItem['item'],
        zone: 'grid' | 'staging'
      ) => ReturnType<typeof computeV2PlacementTacticalDelta> | null;
      readonly onChange?: (nextBay: V2CargoBayState) => void;
      readonly onPrepareRemove?: (instanceId: string) => void;
    }
  ): void {
    const badgeText = opts.statusBadge ?? (editable ? '可调整' : '当前配置');
    const callbacks: CargoGridV2Callbacks = {
      onBayChange: (nextBay) => opts.onChange?.(nextBay),
      onPrepareRemoveItem: opts.onPrepareRemove ? (id) => opts.onPrepareRemove?.(id) : undefined,
      getTacticalDelta: opts.getTacticalDelta,
      getInspectorHost: opts.getInspectorHost,
      onDragAttempt: this.playtestTelemetry.isEnabled()
        ? (attempt) => this.playtestTelemetry.recordDragAttempt(attempt)
        : undefined,
    };

    const canReuse =
      this.cargoGrid !== null &&
      this.cargoMountEl !== null &&
      this.rightPanelEl.contains(this.cargoMountEl);

    if (!canReuse) {
      this.teardownCargoBay();
      this.rightPanelEl.innerHTML = '';

      const header = document.createElement('div');
      header.className = 'panel-header';

      const titleEl = document.createElement('h2');
      titleEl.textContent = opts.title;

      const subEl = document.createElement('span');
      subEl.className = 'panel-sub';
      subEl.textContent = badgeText;

      header.appendChild(titleEl);
      header.appendChild(subEl);

      const mount = document.createElement('div');
      mount.className = 'cargo-mount-root';
      mount.id = 'v2-cargo-mount';

      this.rightPanelEl.appendChild(header);
      this.rightPanelEl.appendChild(mount);

      this.cargoHeaderTitleEl = titleEl;
      this.cargoHeaderSubEl = subEl;
      this.cargoMountEl = mount;
      this.cargoGrid = new CargoGridV2Component(mount, callbacks);
    } else {
      if (this.cargoHeaderTitleEl && this.cargoHeaderTitleEl.textContent !== opts.title) {
        this.cargoHeaderTitleEl.textContent = opts.title;
      }
      if (this.cargoHeaderSubEl && this.cargoHeaderSubEl.textContent !== badgeText) {
        this.cargoHeaderSubEl.textContent = badgeText;
      }
      this.cargoGrid!.setCallbacks(callbacks);
    }

    this.cargoGrid!.render(bay, editable, { prepareMode: opts.prepareMode });
  }

  // --- Modal Launchers ---

  private openCampaignModal(initialTab: CampaignModalTab = 'roadmap'): void {
    const applyReadCommIds = (commIds: readonly string[]) => {
      if (this.isReadOnlyTab || !this.tabGuard.canWrite() || commIds.length === 0) return;
      const nextProfile = markCampaignCommsRead(this.save.profile, commIds);
      let bannerCleared = false;
      if (this.activeCommBanner && commIds.includes(this.activeCommBanner.id)) {
        this.activeCommBanner = null;
        bannerCleared = true;
      }
      if (nextProfile !== this.save.profile) {
        this.save = { ...this.save, profile: nextProfile };
        this.persist();
        if (this.computeCurrentScreen() === 'base') {
          this.renderBaseHeroOverlay();
        }
      }
      if (bannerCleared) {
        this.renderBanners();
      }
    };

    openV3CampaignModal(this.modalHostEl, () => this.save.profile, {
      readOnly: this.isReadOnlyTab,
      initialTab,
      onMarkCommRead: (commId: string) => applyReadCommIds([commId]),
      onMarkCommsRead: (commIds: readonly string[]) => applyReadCommIds(commIds),
      onSelectSectorFromCampaign: (sectorId: SectorId) => {
        if (!this.canMutate()) return;
        if (!this.save.profile.campaign.unlockedSectors.includes(sectorId)) return;
        this.preferredSectorId = sectorId;
        this.openPrepareForContract(this.pickRecommendedContractId(this.save.profile), sectorId);
      },
      onLaunchFinalMission: () => {
        if (!this.canMutate()) return;
        if (!isFinalCampaignMissionUnlocked(this.save.profile).unlocked) return;
        this.preferredSectorId = 'stargate_abyss';
        this.openPrepareForContract(
          this.pickRecommendedContractId(this.save.profile),
          'stargate_abyss',
          { isFinalCampaignRun: true }
        );
      },
      onOpenEndless: () => {
        if (!this.canMutate()) return;
        if (!this.save.profile.campaign.endlessUnlocked) return;
        this.preferredSectorId = 'stargate_abyss';
        this.openPrepareForContract(
          this.pickRecommendedContractId(this.save.profile),
          'stargate_abyss',
          { endlessThreat: 1 }
        );
      },
    });
  }

  private openCareerModal(initialTab: CareerModalTab = 'overview'): void {
    openV3CareerModal(this.modalHostEl, () => this.save.profile, {
      readOnly: this.isReadOnlyTab,
      initialTab,
      onClaimAchievement: (achievementId: string) => {
        if (this.isReadOnlyTab || !this.tabGuard.canWrite()) {
          return {
            ok: false,
            rewardCredits: 0,
            rewardParts: 0,
            error: '当前窗口为只读状态',
          };
        }
        const res = claimV3Achievement(this.save.profile, achievementId);
        if (res.ok) {
          this.save = { ...this.save, profile: res.profile };
          this.persist();
          soundEngine.play('relicRestore');
          this.syncAll();
        }
        return {
          ok: res.ok,
          rewardCredits: res.rewardCredits,
          rewardParts: res.rewardParts,
          error: res.error,
        };
      },
      onReplayEnding: (endingId: EndingId) => {
        this.activeDockingNotice = null;
        this.phaserHost?.skipBaseReturnDocking();
        this.endingGalleryId = endingId;
        this.selectedEndingId = endingId;
        soundEngine.play('click');
        this.syncAll();
      },
    });
  }

  private openFacilitiesModal(): void {
    openV2FacilitiesDrawerModal(this.modalHostEl, () => this.save.profile, {
      readOnly: this.isReadOnlyTab,
      onUpgrade: (fid: V3StationFacilityId) => {
        if (this.isReadOnlyTab || !this.tabGuard.canWrite()) {
          return { ok: false, error: '当前窗口为只读状态' };
        }
        const res = upgradeV3Facility(this.save.profile, fid);
        if (res.ok) {
          this.save = { ...this.save, profile: res.profile };
          this.recentlyBuiltPin = fid;
          this.persist();
          soundEngine.play('buildComplete');
          this.syncAll();
        }
        return res;
      },
    });
  }

  private openSettingsModal(): void {
    openV2SettingsModal(this.modalHostEl, this.save.settings, {
      readOnly: this.isReadOnlyTab,
      hasV1Save: this.v1Inspection.hasV1Save,
      playtestTelemetry: this.playtestTelemetry.isEnabled()
        ? {
            enabled: true,
            onExport: () => {
              const json = this.playtestTelemetry.downloadJson();
              this.showToast('已导出试玩日志 (JSON)。');
              return json;
            },
            onClear: () => {
              this.playtestTelemetry.clear();
              this.showToast('已清空本地试玩日志。');
            },
          }
        : undefined,
      onChange: (next) => {
        this.save = { ...this.save, settings: next };
        this.applySettingsEffects();
        this.persist();
        // Immediately reflect Pure-Auto toggle on active Combat Pre-View or Map View
        this.renderPanels();
      },
      onSwitchToV1: () => this.options.onSwitchToV1(),
      onOpenMigration: this.v1Inspection.hasV1Save ? () => this.openMigrationWizard() : undefined,
      onResetV2Save: () => {
        if (!this.canMutate()) return;
        this.staticStageTracker.reset();
        this.activeCombatPlaybackKey = null;
        clearV2SaveData(window.localStorage);
        this.save = createFreshV2SaveData();
        this.campaignBannerCollapsed = true;
        this.showcaseRun = null;
        this.prepareDraft = null;
        this.selectedEndingId = null;
        this.endingGalleryId = null;
        this.activeDockingNotice = null;
        this.phaserHost?.skipBaseReturnDocking();
        this.activeCommBanner = null;
        this.preferredSectorId = null;
        this.persist();
        soundEngine.play('click');
        this.showToast('远航进度已重置（经典版旧档不受影响）。');
        this.syncAll();
      },
    });
  }

  private openWarehouseModal(initialTab: 'warehouse' | 'research'): void {
    openV2WarehouseModal(this.modalHostEl, () => this.save.profile, {
      readOnly: this.isReadOnlyTab,
      initialTab,
      onResearch: (instanceId) => {
        if (this.isReadOnlyTab || !this.tabGuard.canWrite()) {
          return { ok: false, error: '当前窗口为只读状态' };
        }
        const res = researchV2Equipment(this.save.profile, instanceId);
        if (res.ok) {
          this.save = { ...this.save, profile: res.profile };
          this.persist();
          soundEngine.play('energyLink');
          this.syncAll();
        }
        return res;
      },
      onCraft: (kind) => {
        if (this.isReadOnlyTab || !this.tabGuard.canWrite()) {
          return { ok: false, error: '当前窗口为只读状态' };
        }
        const res = craftV2CommonEquipment(this.save.profile, kind);
        if (res.ok) {
          this.save = { ...this.save, profile: res.profile };
          this.persist();
          soundEngine.play('buildComplete');
          this.syncAll();
        }
        return res;
      },
      onCraftWithParts: (kind) => {
        if (this.isReadOnlyTab || !this.tabGuard.canWrite()) {
          return { ok: false, error: '当前窗口为只读状态' };
        }
        const res = craftV2EquipmentWithParts(this.save.profile, kind);
        if (res.ok) {
          this.save = { ...this.save, profile: res.profile };
          this.persist();
          soundEngine.play('buildComplete');
          this.syncAll();
        }
        return res;
      },
      onCraftGadget: (kind: V3GadgetKind) => {
        if (this.isReadOnlyTab || !this.tabGuard.canWrite()) {
          return { ok: false, error: '当前窗口为只读状态' };
        }
        const res = craftV3GadgetWithParts(this.save.profile, kind);
        if (res.ok) {
          this.save = { ...this.save, profile: res.profile };
          this.persist();
          soundEngine.play('buildComplete');
          this.syncAll();
        }
        return res;
      },
      onUpgradeItem: (instanceId) => {
        if (this.isReadOnlyTab || !this.tabGuard.canWrite()) {
          return { ok: false, error: '当前窗口为只读状态' };
        }
        const res = upgradeV2EquipmentToImproved(this.save.profile, instanceId);
        if (res.ok) {
          this.save = { ...this.save, profile: res.profile };
          this.persist();
          soundEngine.play('energyLink');
          this.syncAll();
        }
        return res;
      },
      onDismantleItem: (instanceId) => {
        if (this.isReadOnlyTab || !this.tabGuard.canWrite()) {
          return { ok: false, error: '当前窗口为只读状态' };
        }
        const res = dismantleV2WarehouseItem(this.save.profile, instanceId);
        if (res.ok) {
          this.save = { ...this.save, profile: res.profile };
          this.persist();
          soundEngine.play('wreckCut');
          this.syncAll();
        }
        return res;
      },
      onTuneHull: (shipId: V2ShipId, track: V3HullTuningTrack) => {
        if (this.isReadOnlyTab || !this.tabGuard.canWrite()) {
          return { ok: false, error: '当前窗口为只读状态' };
        }
        const res = tuneV2ShipHull(this.save.profile, shipId, track);
        if (res.ok) {
          this.save = { ...this.save, profile: res.profile };
          this.persist();
          soundEngine.play('buildComplete');
          this.syncAll();
        }
        return res;
      },
      onSellItem: (instanceId) => {
        if (this.isReadOnlyTab || !this.tabGuard.canWrite()) {
          return { ok: false, error: '当前窗口为只读状态' };
        }
        const res = sellV2WarehouseItem(this.save.profile, instanceId);
        if (res.ok) {
          this.save = { ...this.save, profile: res.profile };
          this.persist();
          soundEngine.play('cashRegister');
          this.syncAll();
        }
        return res;
      },
      onClaimGift: (instanceId) => {
        if (this.isReadOnlyTab || !this.tabGuard.canWrite()) {
          return { ok: false, error: '当前窗口为只读状态' };
        }
        const res = claimV2PendingGiftToWarehouse(this.save.profile, instanceId);
        if (res.ok) {
          this.save = { ...this.save, profile: res.profile };
          this.persist();
          soundEngine.play('place');
          this.syncAll();
        }
        return res;
      },
      onSellGift: (instanceId) => {
        if (this.isReadOnlyTab || !this.tabGuard.canWrite()) {
          return { ok: false, error: '当前窗口为只读状态' };
        }
        const res = sellV2PendingGift(this.save.profile, instanceId);
        if (res.ok) {
          this.save = { ...this.save, profile: res.profile };
          this.persist();
          soundEngine.play('cashRegister');
          this.syncAll();
        }
        return res;
      },
    });
  }

  private openRelicGalleryModal(): void {
    openV2RelicGalleryModal(this.modalHostEl, () => this.save.profile, {
      readOnly: this.isReadOnlyTab,
      onRestore: (relicId) => {
        if (this.isReadOnlyTab || !this.tabGuard.canWrite()) {
          return { ok: false, error: '当前窗口为只读状态' };
        }
        const res = restoreV2Relic(this.save.profile, relicId);
        if (res.ok) {
          this.save = { ...this.save, profile: res.profile };
          this.recentlyBuiltPin = 'display';
          this.persist();
          soundEngine.play('relicRestore');
          this.syncAll();
        }
        return res;
      },
    });
  }

  private openMigrationWizard(): void {
    this.v1Inspection = inspectV1SaveForMigration(window.localStorage);
    openV1MigrationModal(this.modalHostEl, this.v1Inspection, {
      onContinueV1: () => {
        this.options.onSwitchToV1();
      },
      onConfirmMigrate: () => {
        if (this.isReadOnlyTab || !this.tabGuard.canWrite()) {
          this.showToast('当前窗口为只读状态，请先接管控制权再导入。');
          return;
        }
        if (!this.v1Inspection.v1Save) {
          this.showToast('旧档数据无效，无法导入');
          return;
        }
        const migrated = migrateV1ToV2SaveData(this.v1Inspection.v1Save);
        this.staticStageTracker.reset();
        this.activeCombatPlaybackKey = null;
        this.activeDockingNotice = null;
        this.phaserHost?.skipBaseReturnDocking();
        this.save = migrated;
        this.migrationPromptDismissed = true;
        this.persist();
        soundEngine.play('contractDeliver');
        this.showToast(
          `导入完成！已结转 ${migrated.profile.credits}¤ 并完整保留藏品馆进度（经典旧档未受影响）。`
        );
        this.syncAll();
      },
      onStartFreshV2: () => {
        this.migrationPromptDismissed = true;
        this.syncAll();
      },
    });
  }
}
