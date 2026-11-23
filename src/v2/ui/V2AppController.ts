import { soundEngine } from '../../audio/soundEngine';
import type { BuildingId } from '../../data/buildings';
import type { BaseProgression } from '../../domain/progression';
import { MultiTabGuard } from '../../domain/tabLock';
import { PhaserHost } from '../../scenes/PhaserHost';
import { hasOpenModal, registerModalBackgroundRoot } from '../../ui/Modals';
import { CAMPAIGN_CHAPTERS, type CampaignCommTrigger } from '../data/campaign';
import { V2_CREW, type V2CrewId } from '../data/crew';
import {
  V2_EQUIPMENT_DEFS,
  V2_RESEARCH_COST_CREDITS,
  V2_WAREHOUSE_CAPACITY,
  getV2EquipmentDefByKind,
  type V2EquipmentKind,
} from '../data/equipment';
import {
  V2_FACILITIES,
  V2_RELICS,
  V2_RELIC_ORDER,
  type V2FacilityId,
} from '../data/facilities';
import { getV3SectorDef } from '../data/sectors';
import { V2_SHIPS, type V2ShipId } from '../data/ships';
import { createV2ShowcaseRun } from '../data/showcaseRun';
import {
  V2_TRIAL_BUILDS,
  buildTrialPrepareSlots,
  getTrialDemoUnits,
} from '../data/trialBuilds';
import { V2_TUTORIAL_HINTS, createV2TutorialRun } from '../data/tutorialV2';
import {
  getActiveCampaignObjective,
  getTriggeredCommForContext,
  markCampaignCommRead,
  markCampaignCommsRead,
} from '../domain/campaign';
import {
  commitV2EliteTacticDecision,
  completeV2CombatAtCurrentNode,
  simulateV2Combat,
  startV2CombatAtCurrentNode,
} from '../domain/combatV2';
import {
  abortActiveV2Contract,
  countEscapePodsInBay,
  getAvailableContractBoard,
  performSurveyAtCurrentNode,
} from '../domain/contracts';
import {
  abandonV2EventAndReturn,
  applyV2EngineerSwap,
  buyV2MerchantFuel,
  buyV2MerchantOffer,
  buyV2MerchantRepair,
  finishV2ArrangeAndProceed,
  finishV2MerchantVisit,
  initiateV2SafeReturnFromMap,
  pickV2CombatReward,
  resolveV2AnomalyChoice,
  resolveV2DistressChoice,
  resolveV2WreckChoice,
  selectV2MapNode,
  sellV2ItemToMerchant,
} from '../domain/encounter';
import { findFirstLegalV2Placement } from '../domain/inventoryV2';
import {
  collectVisibleV2DefIdsForRun,
  createV2EquipmentInstance,
  recordV2SeenItems,
} from '../domain/itemCatalog';
import {
  buildFreeFallbackPrepareSlots,
  deleteV2LoadoutPreset,
  launchV2Expedition,
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
  canBuildV2Facility,
  canResearchV2Instance,
  canRestoreV2Relic,
  claimV2PendingGiftToWarehouse,
  craftV2CommonEquipment,
  getV2RelicSummary,
  purchaseV2Facility,
  researchV2Equipment,
  restoreV2Relic,
  sellV2PendingGift,
  sellV2WarehouseItem,
} from '../domain/progressionV2';
import { deriveSessionRunSeed, parseDeterministicSeedParam } from '../domain/seedParam';
import { applyV2Settlement, calculateV2Settlement } from '../domain/settlementV2';
import { deriveV2ShipVisualSpec } from '../domain/shipVisualSpec';
import { computeV2PlacementTacticalDelta } from '../domain/tacticalDelta';
import {
  V2_TAB_CHANNEL,
  V2_TAB_LOCK_KEY,
  type SectorId,
  type V2CargoBayState,
  type V2CombatRoundLog,
  type V2MapNode,
  type V2PlacedItem,
  type V2ProfileState,
  type V2RunState,
  type V2SaveData,
  type V2SettlementDisposition,
  type V2TrialBuildId,
  type V2WreckChoice,
} from '../domain/types';
import { CargoGridV2Component } from './CargoGridV2';
import { crewPortraitSvg, svgIcon } from './icons';
import {
  buildV2InspectSnapshot,
  type StarlineInspectSnapshot,
  type StarlineScreenId,
} from './inspectSnapshot';
import { openV3CampaignModal, type CampaignModalTab } from './modals/CampaignModal';
import { renderArrangeView } from './screens/ArrangeView';
import { renderBaseHeroView } from './screens/BaseView';
import { renderCombatLiveOverlay, renderCombatPreView } from './screens/CombatView';
import { renderEventView } from './screens/EventView';
import { renderMapView } from './screens/MapView';
import { renderPrepareView } from './screens/PrepareView';
import { renderRewardView } from './screens/RewardView';
import {
  NODE_TYPE_META,
  type NextBaseGoal,
  type V2PrepareDraft,
  type V2ReturnDockingNotice,
} from './screens/screenTypes';
import { renderSettlementView } from './screens/SettlementView';
import { renderShopView } from './screens/ShopView';
import { renderTitleView } from './screens/TitleView';
import {
  renderWreckHotspotOverlay,
  renderWreckLeftPanel,
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
  private tabGuard: MultiTabGuard;

  private sessionLaunchIndex = 0;
  private isReadOnlyTab = false;
  private storageError: string | null = null;
  private actionToast: string | null = null;
  private actionToastTimer: number | null = null;
  private recentlyBuiltPin: BuildingId | null = null;
  private titleEntered = false;
  private v1Inspection: V1MigrationInspection;
  private migrationPromptDismissed = false;

  private prepareDraft: V2PrepareDraft | null = null;
  private settlementDispositions: Record<string, V2SettlementDisposition> = {};
  private sceneCollapseOverride: boolean | null = null;
  private activeDockingNotice: V2ReturnDockingNotice | null = null;
  private campaignBannerCollapsed = false;
  private preferredSectorId: SectorId | null = null;
  private activeCommBanner: {
    readonly id: string;
    readonly speakerId: V2CrewId;
    readonly title: string;
    readonly text: string;
  } | null = null;

  // Interactive focus states for unified Map & 3-hotspot Wreck
  private selectedMapNodeId: string | null = null;
  private selectedWreckHotspot: WreckHotspotId = 'armory';
  private mobileMapShowFull = false;
  private lastCompactViewport = typeof window !== 'undefined' ? window.innerWidth < 860 : false;
  private failedAssetKeys: string[] = [];

  // Live combat playback display telemetry (pure presentation)
  private activeCombatPlaybackKey: string | null = null;
  private liveCombatRound = 0;
  private liveCombatPlayerHp = 30;
  private liveCombatPlayerShield = 0;
  private liveCombatEnemiesAlive = 0;
  private liveCombatEventLine = '';
  private awaitingEliteDecision = false;
  private showCombatLogDetails = false;

  // Persistent DOM anchors so Phaser canvas never flickers
  private appShellEl!: HTMLElement;
  private titleHostEl!: HTMLElement;
  private topHudEl!: HTMLElement;
  private bannersEl!: HTMLElement;
  private mainLayoutEl!: HTMLElement;
  private sceneWrapEl!: HTMLElement;
  private sceneCanvasHostEl!: HTMLElement;
  private sceneOverlayEl!: HTMLElement;
  private leftPanelEl!: HTMLElement;
  private rightPanelEl!: HTMLElement;
  private modalHostEl!: HTMLElement;

  constructor(mountEl: HTMLElement, options: V2ControllerOptions) {
    this.mountEl = mountEl;
    this.options = options;
    this.urlBaseSeed = parseDeterministicSeedParam(
      typeof window !== 'undefined' ? window.location.search : ''
    );
    this.save = createFreshV2SaveData();
    this.v1Inspection = inspectV1SaveForMigration(window.localStorage);

    this.tabGuard = new MultiTabGuard(
      (isOwner) => {
        this.isReadOnlyTab = !isOwner;
        this.phaserHost?.setCombatPaused(this.isReadOnlyTab);
        this.syncAll();
      },
      { lockKey: V2_TAB_LOCK_KEY, channelName: V2_TAB_CHANNEL }
    );
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
    let migratedFromV2OnBoot = false;
    if (loaded.status === 'loaded' || loaded.status === 'fresh') {
      this.save = loaded.data;
      migratedFromV2OnBoot = loaded.status === 'loaded' && Boolean(loaded.migratedFromV2);
    } else if (loaded.status === 'corrupt_with_backup') {
      this.save = loaded.backup;
      this.titleEntered = true;
      openV2BackupRecoveryModal(this.modalHostEl, {
        error: loaded.error,
        hasBackup: true,
        onRestoreBackup: () => {
          this.save = loaded.backup;
          this.persist();
          this.syncAll();
        },
        onResetFresh: () => {
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

    if (migratedFromV2OnBoot && !this.isReadOnlyTab && this.tabGuard.canWrite()) {
      this.persist();
    }

    window.__STARLINE_INSPECT__ = () => this.buildInspectSnapshot();
    window.addEventListener('resize', this.handleWindowResize);
    window.addEventListener('orientationchange', this.handleWindowResize);

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
    delete window.__STARLINE_INSPECT__;
    soundEngine.setTrack('none');
    window.removeEventListener('resize', this.handleWindowResize);
    window.removeEventListener('orientationchange', this.handleWindowResize);
    if (this.actionToastTimer !== null) {
      window.clearTimeout(this.actionToastTimer);
      this.actionToastTimer = null;
    }
    this.cargoGrid?.destroy();
    this.cargoGrid = null;
    this.tabGuard.destroy();
    this.phaserHost?.destroy();
    this.phaserHost = null;
    this.mountEl.innerHTML = '';
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
    return true;
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
  }

  private computeNextBaseGoal(p: V2ProfileState, projectedCredits = p.credits): NextBaseGoal {
    if (p.buildings.research_lab) {
      const researchable = p.equipmentWarehouse.find(
        (w) => canResearchV2Instance(p, w.instanceId).canResearch
      );
      if (researchable) {
        const def = V2_EQUIPMENT_DEFS[researchable.definitionId];
        const ready = projectedCredits >= V2_RESEARCH_COST_CREDITS;
        return {
          title: `研究台：解锁「${def?.name ?? '新设备'}」蓝图`,
          detail: ready
            ? `资金已就绪（${V2_RESEARCH_COST_CREDITS}¤），立即研究永久掌握`
            : `还差 ${Math.max(0, V2_RESEARCH_COST_CREDITS - projectedCredits)}¤`,
          actionKind: 'warehouse',
          targetCost: V2_RESEARCH_COST_CREDITS,
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

    const shortTag: Record<V2FacilityId, string> = {
      workbench: '免费启用基础工作台与预设',
      contract_hub: '开启三类标准远航委托',
      research_lab: '解锁 12 格设备库与永久蓝图研究',
      drydock: '解锁护盾工程艇（+4 护盾）',
      display: '开启 4 件稀世遗物展台陈列',
      drydock_tier2: '解锁 5×4 远航货船（18 格大舱）',
    };
    const priorityOrder: V2FacilityId[] = ['research_lab', 'drydock', 'display', 'drydock_tier2'];
    for (const fid of priorityOrder) {
      if (p.buildings[fid]) continue;
      const fac = V2_FACILITIES[fid];
      const chk = canBuildV2Facility(p, fid);
      const diff = Math.max(0, fac.cost - projectedCredits);
      return {
        title: `扩建目标：${fac.name}`,
        detail:
          chk.canBuild || diff === 0
            ? `${shortTag[fid]}（资金已就绪）`
            : `还差 ${diff}¤ · ${shortTag[fid]}`,
        actionKind: 'facilities',
        targetCost: fac.cost,
        ready: chk.canBuild,
      };
    }

    return {
      title: '拆解站主力设施已全建成',
      detail: '挑战深入委托与搜集全部 4 件星际遗物',
      actionKind: 'relics',
      ready: true,
    };
  }

  private pickRecommendedContractId(p: V2ProfileState): string {
    const board = getAvailableContractBoard(p);
    const nextStd = board.standardTemplates.find(
      (c) => !p.completedContractIds.includes(c.templateId)
    );
    if (nextStd) return nextStd.templateId;
    if (board.deepUnlocked) {
      const nextDeep = board.deepTemplates.find(
        (c) => !p.completedContractIds.includes(c.templateId)
      );
      if (nextDeep) return nextDeep.templateId;
      return board.deepTemplates[0]?.templateId ?? 'transport_std';
    }
    return board.standardTemplates[0]?.templateId ?? 'transport_std';
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
    this.sceneWrapEl.className = 'scene-card';

    this.sceneCanvasHostEl = document.createElement('div');
    this.sceneCanvasHostEl.className = 'scene-canvas-host';

    this.sceneOverlayEl = document.createElement('div');
    this.sceneOverlayEl.className = 'scene-overlay';

    this.sceneWrapEl.appendChild(this.sceneCanvasHostEl);
    this.sceneWrapEl.appendChild(this.sceneOverlayEl);

    this.leftPanelEl = document.createElement('section');
    this.leftPanelEl.className = 'panel-card panel-left';

    this.rightPanelEl = document.createElement('section');
    this.rightPanelEl.className = 'panel-card panel-right';

    this.mainLayoutEl.appendChild(this.sceneWrapEl);
    this.mainLayoutEl.appendChild(this.leftPanelEl);
    this.mainLayoutEl.appendChild(this.rightPanelEl);

    this.appShellEl.appendChild(this.topHudEl);
    this.appShellEl.appendChild(this.bannersEl);
    this.appShellEl.appendChild(this.mainLayoutEl);

    this.titleHostEl = document.createElement('div');
    this.titleHostEl.className = 'title-host';

    this.modalHostEl = document.createElement('div');
    this.modalHostEl.className = 'modal-host';

    this.mountEl.appendChild(this.appShellEl);
    this.mountEl.appendChild(this.titleHostEl);
    this.mountEl.appendChild(this.modalHostEl);

    registerModalBackgroundRoot(this.appShellEl);
  }

  private applyViewportClasses(): void {
    const run = this.getCurrentRun();
    const curNode = run?.currentNodeId ? run.graph.nodes[run.currentNodeId] : null;
    const isBaseHero = !run && !this.prepareDraft;
    const isPrepare = Boolean(!run && this.prepareDraft);
    const isArrange = run?.phase === 'ARRANGE';
    const isSettlement = run?.phase === 'SETTLEMENT';
    const isLiveCombat = Boolean(run?.phase === 'ENCOUNTER' && run.activeCombat);
    const isPreCombat = Boolean(run?.phase === 'ENCOUNTER' && curNode?.combat && !run.activeCombat);
    const isWreckHero = Boolean(run?.phase === 'ENCOUNTER' && curNode?.type === 'wreck');
    const isMapHero = Boolean(run?.phase === 'MAP');
    const collapsed = isArrange && this.isArrangeSceneCollapsed();

    this.sceneWrapEl.classList.toggle('scene-collapsed', collapsed);
    this.appShellEl.classList.toggle('phase-base-hero', isBaseHero);
    this.appShellEl.classList.toggle('phase-prepare', isPrepare);
    this.appShellEl.classList.toggle('phase-arrange', Boolean(isArrange));
    this.appShellEl.classList.toggle('phase-settlement', Boolean(isSettlement));
    this.appShellEl.classList.toggle('phase-combat', isLiveCombat || isPreCombat);
    this.appShellEl.classList.toggle('phase-combat-live', isLiveCombat);
    this.appShellEl.classList.toggle('phase-wreck-hero', isWreckHero);
    this.appShellEl.classList.toggle('phase-map-hero', isMapHero);

    this.appShellEl.dataset.screen = this.computeCurrentScreen();
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

  private syncAll(): void {
    this.v1Inspection = inspectV1SaveForMigration(window.localStorage);
    this.syncVisibleSeenItems();
    this.applyViewportClasses();
    soundEngine.setTrack(
      resolveV2BgmTrack({
        titleEntered: this.titleEntered,
        run: this.getCurrentRun(),
      })
    );
    this.renderTitleOverlay();
    this.renderTopHud();
    this.renderBanners();
    this.syncPhaserStage();
    this.renderPanels();
    this.phaserHost?.resize();
  }

  // --- Title Screen Overlay ---

  private renderTitleOverlay(): void {
    const showTitle = !this.titleEntered && !this.getCurrentRun();
    this.appShellEl.dataset.titleLocked = showTitle ? '1' : '0';
    if ('inert' in this.appShellEl) {
      (this.appShellEl as HTMLElement & { inert: boolean }).inert = showTitle || hasOpenModal();
    }

    if (!showTitle) {
      this.titleHostEl.innerHTML = '';
      this.titleHostEl.style.display = 'none';
      return;
    }

    this.titleHostEl.style.display = 'block';
    renderTitleView(
      this.titleHostEl,
      {
        profile: this.save.profile,
        shouldOfferMigration: this.shouldOfferMigrationPrompt(),
      },
      {
        onEnterStation: () => {
          soundEngine.play('click');
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

  private startShowcaseRun(trialId: V2TrialBuildId): void {
    this.titleEntered = true;
    this.writeTitleSession(true);
    this.prepareDraft = null;
    this.activeDockingNotice = null;
    this.activeCommBanner = null;
    this.settlementDispositions = {};
    this.selectedMapNodeId = null;
    this.selectedWreckHotspot = 'armory';
    this.awaitingEliteDecision = false;
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
      return hasReactor ? '运输 · 已装反应堆' : '运输 · 待取反应堆';
    }
    if (c.type === 'rescue') {
      const pods = countEscapePodsInBay(run.bay);
      return `救援 · 救生舱 ${pods}/${c.missionItemCount}`;
    }
    if (c.type === 'survey') {
      return `勘测 · ${c.completedNodeIds.length}/${c.requiredCompletions}`;
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
            sum.reason === 'defeat' ? '拖回拆解站' : '安全靠泊'
          }</strong></div>
          <div class="hud-pill"><span class="k">${svgIcon('star', 13)} 委托</span><strong class="v">${
            sum.contractCompleted ? '可交付' : run.contract.type === 'free' ? '自由打捞' : '未完成'
          }</strong></div>
          <div class="hud-pill pill-accent"><span class="k">${svgIcon('credits', 13)} 实得</span><strong class="v num">+${
            sum.finalCreditsEarned
          }¤</strong></div>
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
      pillsHtml = `
        <div class="hud-pill pill-accent"><span class="k">${svgIcon('credits', 13)} 信用点</span><strong class="v num">${displayCredits}¤</strong></div>
        <div class="hud-pill"><span class="k">${svgIcon('warehouse', 13)} 库存</span><strong class="v num">${p.equipmentWarehouse.length}/${V2_WAREHOUSE_CAPACITY}</strong></div>
        <div class="hud-pill"><span class="k">${svgIcon('museum', 13)} 藏品</span><strong class="v num">${relicSum.restoredCount}/${relicSum.totalCount}</strong></div>
      `;
    }

    const showCollapseBtn = run?.phase === 'ARRANGE';
    const collapsed = this.isArrangeSceneCollapsed();

    this.topHudEl.innerHTML = `
      <div class="hud-brand">
        <span class="hud-logo-dot"></span>
        <span class="hud-title">星际拆解站</span>
        ${run?.isShowcase ? `<span class="v2-showcase-chip">4 站试玩</span>` : ''}
      </div>
      <div class="hud-actions">
        ${
          run?.isShowcase
            ? `<button type="button" class="btn btn-sm btn-secondary" id="v2-btn-exit-showcase">退出试玩</button>`
            : ''
        }
        ${
          showCollapseBtn
            ? `<button type="button" class="btn btn-sm btn-secondary" id="v2-btn-toggle-scene">${
                collapsed ? '展开舰体' : '收起舰体'
              }</button>`
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
      this.activeCombatPlaybackKey = null;
      this.awaitingEliteDecision = false;
      this.syncAll();
    });
    this.topHudEl.querySelector('#v2-btn-toggle-scene')?.addEventListener('click', () => {
      this.sceneCollapseOverride = !collapsed;
      this.applyViewportClasses();
      this.renderTopHud();
      this.phaserHost?.resize();
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
          <span class="tutorial-badge">首航教学 ${currentLayer}/3</span>
          <span>${hintText}</span>
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
      if (!this.getCurrentRun() && !this.prepareDraft) {
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

  private adaptProfileToV1BaseProgression(): BaseProgression {
    const p = this.save.profile;
    return {
      credits: p.credits,
      buildings: {
        workbench: p.buildings.workbench,
        display: p.buildings.display,
        drydock: p.buildings.drydock,
      },
      relics: p.relics,
      discoveredItems: p.discoveredItems,
      selectedLoadout: p.selectedShipId === 'shield_cruiser' ? 'shield_cruiser' : 'cannon_skiff',
      selectedRegion: undefined,
      deepestNodeReached: p.deepestLayerReached,
      totalExpeditions: p.totalRuns,
      safeReturns: p.totalRuns,
      totalCreditsEarned: p.credits,
      tutorialCompleted: p.tutorialCompleted,
      settledExpeditionIds: p.settledRunIds,
    };
  }

  private syncPhaserStage(): void {
    if (!this.phaserHost) return;
    const run = this.getCurrentRun();

    // 1. BASE HERO STAGE
    if (!run && !this.prepareDraft) {
      this.activeCombatPlaybackKey = null;
      this.awaitingEliteDecision = false;
      const p = this.save.profile;
      const relicSum = getV2RelicSummary(p);
      const nextGoal = this.computeNextBaseGoal(p);
      this.phaserHost.showBase({
        progression: this.adaptProfileToV1BaseProgression(),
        settings: this.save.settings,
        recentlyBuiltId: this.recentlyBuiltPin,
        v2Override: {
          shipId: p.selectedShipId,
          wbText: p.buildings.research_lab
            ? `研究工作台 · ${p.blueprints.length}/10 蓝图`
            : p.buildings.workbench
            ? `工作台 · 设备库 ${p.equipmentWarehouse.length}/12`
            : '首航启用工作台',
          dispText: p.buildings.display
            ? `藏品展台 ${relicSum.restoredCount}/${relicSum.totalCount}`
            : `收藏展台 · ${V2_FACILITIES.display.cost}¤`,
          dockText: p.buildings.drydock_tier2
            ? '船坞二阶 · 3 舰就绪'
            : p.buildings.drydock
            ? '船坞一阶 · 2 舰就绪'
            : `扩建船坞 · ${V2_FACILITIES.drydock.cost}¤`,
          workbenchWorking: Boolean(this.activeDockingNotice || nextGoal.ready),
          showAllPins: true,
        },
      });
      this.renderBaseHeroOverlay();
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
        this.sceneOverlayEl.innerHTML = `
          <div class="scene-stage-tag">${svgIcon('bolt', 13)} 实战微演示 · ${trial.shortName} 对阵 ${trial.demoEnemyTitle}</div>
          <div class="v2-demo-bar">
            <span>${trial.demoHint}</span>
            <button type="button" class="btn btn-sm btn-secondary" id="v2-stop-demo">跳过演示</button>
          </div>
        `;
        this.sceneOverlayEl.querySelector('#v2-stop-demo')?.addEventListener('click', () => {
          draft.playingDemo = false;
          draft.demoPlaybackKey = null;
          this.syncPhaserStage();
        });
        return;
      }

      draft.demoPlaybackKey = null;
      const prepSector = getV3SectorDef(draft.sectorId);
      this.phaserHost.showV2Stage({
        shipId: draft.shipId,
        shipVisualSpec: visualSpec,
        sectorId: draft.sectorId,
        sectorIndex: prepSector.primaryBgIndex,
        eventBackdrop: null,
        units: [],
        simulation: null,
        settings: this.save.settings,
      });

      const mountChips =
        visualSpec.mountSummaryTags.length > 0
          ? visualSpec.mountSummaryTags.map((t) => `<span class="v2-mount-pill">${t}</span>`).join('')
          : `<span class="v2-mount-pill muted">仅舰载核心小炮</span>`;

      this.sceneOverlayEl.innerHTML = `
        <div class="scene-stage-tag">${svgIcon('rocket', 13)} ${ship.name} · ${prepSector.name} · 外部挂点实时联动</div>
        <div class="v2-mount-strip">${mountChips}</div>
      `;
      return;
    }

    if (!run) return;

    const currentNode = run.currentNodeId ? run.graph.nodes[run.currentNodeId] : null;
    const activeSector = getV3SectorDef(run.sectorId);
    const sectorIndex = currentNode?.sectorBg ?? activeSector.primaryBgIndex;
    const visualSpec = deriveV2ShipVisualSpec(run.bay);

    // 3. LIVE COMBAT HERO STAGE
    if (run.phase === 'ENCOUNTER' && run.activeCombat && currentNode?.combat) {
      const sim = run.activeCombat.simulation;
      const pending = run.activeCombat.pendingDecision;
      const needsDecision = Boolean(pending && pending.chosen === null);
      const resumeRound = pending && pending.chosen !== null ? 1 : 0;
      const pbKey = `${run.runId}_${currentNode.nodeId}_${sim.resultId}_${pending?.chosen ?? 'open'}`;

      if (this.activeCombatPlaybackKey !== pbKey) {
        this.activeCombatPlaybackKey = pbKey;
        this.awaitingEliteDecision = false;
        this.liveCombatRound = resumeRound;
        this.liveCombatEventLine =
          pending?.chosen === 'overload'
            ? '指令生效：火力过载 · 耗 3 盾/耐久追加 9 点无视护甲破甲直击'
            : pending?.chosen === 'emergency_defense'
            ? '指令生效：紧急防御 · 强化护盾并全炮停火（机库扩编与护盾反击保留）'
            : '';
        const prevLog = resumeRound > 0 ? sim.rounds[resumeRound - 1] : null;
        this.liveCombatPlayerHp = prevLog ? prevLog.playerHpAfter : sim.startingPlayerHp;
        this.liveCombatPlayerShield = prevLog ? prevLog.playerShieldAfter : sim.startingPlayerShield;
        this.liveCombatEnemiesAlive = prevLog
          ? prevLog.enemiesAfter.filter((e) => e.hp > 0).length
          : sim.initialEnemies.length;

        this.phaserHost.showV2Stage({
          shipId: run.shipId,
          shipVisualSpec: visualSpec,
          sectorId: run.sectorId,
          sectorIndex,
          eventBackdrop: null,
          units: currentNode.combat.units,
          simulation: sim,
          settings: this.save.settings,
          pauseAtRound: needsDecision ? pending!.roundNumber : null,
          resumeFromRound: resumeRound,
          onPauseForDecision: () => {
            this.awaitingEliteDecision = true;
            soundEngine.play('bossAlarm');
            this.renderCombatPlaybackOverlay(this.getCurrentRun() ?? run);
          },
          onRoundStep: (_idx: number, log: V2CombatRoundLog) => {
            this.liveCombatRound = log.round;
            this.liveCombatPlayerHp = log.playerHpAfter;
            this.liveCombatPlayerShield = log.playerShieldAfter;
            this.liveCombatEnemiesAlive = log.enemiesAfter.filter((e) => e.hp > 0).length;
            const dealt = log.playerAttacks.reduce((s, a) => s + a.appliedDamage, 0);
            const tookHull = log.enemyAttacks.reduce((s, a) => s + a.hullDamage, 0);
            const parts: string[] = [`第 ${log.round} 轮`];
            if (dealt > 0) parts.push(`我方输出 ${dealt}`);
            if (log.heavyChargingIds.length > 0) parts.push('重炮蓄能');
            if (log.shieldAbsorbedTotal > 0) parts.push(`盾吸 ${log.shieldAbsorbedTotal}`);
            if (log.counterAttack) parts.push(`反击 -${log.counterAttack.appliedDamage}`);
            if (tookHull > 0) parts.push(`舰体受创 -${tookHull}`);
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
              this.activeCombatPlaybackKey = null;
              this.awaitingEliteDecision = false;
              this.setCurrentRun(res.run);
              soundEngine.play(sim.outcome === 'victory' ? 'enemyDestroy' : 'hullHit');
              this.syncAll();
            }
          },
        });
      }
      this.renderCombatPlaybackOverlay(run);
      return;
    }

    // 4. WRECK 3-HOTSPOT HERO STAGE
    if (run.phase === 'ENCOUNTER' && currentNode?.type === 'wreck' && currentNode.wreck) {
      this.activeCombatPlaybackKey = null;
      this.phaserHost.showV2Stage({
        shipId: run.shipId,
        shipVisualSpec: visualSpec,
        sectorId: run.sectorId,
        sectorIndex,
        eventBackdrop: 'wreck',
        units: [],
        simulation: null,
        settings: this.save.settings,
      });
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

    this.phaserHost.showV2Stage({
      shipId: run.shipId,
      shipVisualSpec: visualSpec,
      sectorId: run.sectorId,
      sectorIndex,
      eventBackdrop: eventBg,
      units: previewUnits,
      simulation: null,
      settings: this.save.settings,
    });

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

    const showMountPills = run.phase === 'ARRANGE' || run.phase === 'MAP';
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

  // --- Screen Delegations ---

  private renderBaseHeroOverlay(): void {
    const p = this.save.profile;
    renderBaseHeroView(
      this.sceneOverlayEl,
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
          this.renderBaseHeroOverlay();
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
          this.renderBaseHeroOverlay();
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
      }
    );
  }

  private startTutorialRun(): void {
    if (!this.canMutate()) return;
    const run = createV2TutorialRun(`v2tut_${Date.now().toString(36)}`);
    this.save = { ...this.save, activeRun: run };
    this.activeDockingNotice = null;
    this.persist();
    soundEngine.play('warpJump');
    this.syncAll();
  }

  private renderCombatPlaybackOverlay(run: V2RunState): void {
    renderCombatLiveOverlay(
      this.sceneOverlayEl,
      {
        run,
        liveCombatRound: this.liveCombatRound,
        liveCombatPlayerHp: this.liveCombatPlayerHp,
        liveCombatPlayerShield: this.liveCombatPlayerShield,
        liveCombatEnemiesAlive: this.liveCombatEnemiesAlive,
        liveCombatEventLine: this.liveCombatEventLine,
        awaitingEliteDecision: this.awaitingEliteDecision,
        combatSpeed: this.save.settings.combatSpeed,
      },
      {
        onPeekBay: () => {
          soundEngine.play('click');
          openV2CargoPeekModal(this.modalHostEl, run.bay, `参战配装 · ${V2_SHIPS[run.shipId].name}`);
        },
        onToggleSpeed: () => {
          const nextSpd = this.save.settings.combatSpeed === 1 ? 2 : 1;
          this.save = {
            ...this.save,
            settings: { ...this.save.settings, combatSpeed: nextSpd },
          };
          this.applySettingsEffects();
          this.persist();
          this.renderCombatPlaybackOverlay(run);
        },
        onSkipPlayback: () => {
          this.phaserHost?.skipCombatPlayback();
        },
        onCommitEliteTactic: (decisionId, choice) => {
          if (!this.canMutate()) return;
          const cur = this.getCurrentRun();
          if (!cur) return;
          const res = commitV2EliteTacticDecision(cur, decisionId, choice);
          if (!res.ok) {
            this.showToast(res.error ?? '战术指令无效');
            return;
          }
          this.awaitingEliteDecision = false;
          this.activeCombatPlaybackKey = null;
          this.setCurrentRun(res.run);
          soundEngine.play('energyLink');
          this.syncAll();
        },
      }
    );
  }

  private renderWreckOverlay(run: V2RunState, node: V2MapNode): void {
    renderWreckHotspotOverlay(
      this.sceneOverlayEl,
      {
        run,
        node,
        readOnly: this.isReadOnlyTab && !run.isShowcase,
        selectedHotspot: this.selectedWreckHotspot,
      },
      {
        onSelectHotspot: (spot) => {
          this.selectedWreckHotspot = spot;
          soundEngine.play('click');
          this.renderWreckOverlay(run, node);
        },
        onCutWreck: (room: V2WreckChoice) => {
          if (!this.canMutate()) return;
          const spotCoords =
            room === 'armory' ? [0.22, 0.48] : room === 'cargo' ? [0.79, 0.51] : [0.5, 0.46];
          this.phaserHost?.triggerV2WreckCutFx(spotCoords[0], spotCoords[1]);
          const res = resolveV2WreckChoice(run, room, this.save.profile.unlockedFamilies);
          if (!res.ok) return this.showToast(res.error ?? '无法切割该舱室');
          this.setCurrentRun(res.run);
          soundEngine.play('place');
          this.syncAll();
        },
      }
    );
  }

  private renderPanels(): void {
    const run = this.getCurrentRun();
    if (!run) {
      if (this.prepareDraft) {
        this.renderPreparePanels();
      } else {
        this.cargoGrid?.destroy();
        this.cargoGrid = null;
        this.leftPanelEl.innerHTML = '';
        this.rightPanelEl.innerHTML = '';
      }
      return;
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
    preferredSectorOverride?: SectorId
  ): void {
    const p = this.save.profile;
    const unlockedSectors =
      p.campaign.unlockedSectors.length > 0 ? p.campaign.unlockedSectors : (['near_orbit'] as const);
    const chosenSector: SectorId =
      preferredSectorOverride && unlockedSectors.includes(preferredSectorOverride)
        ? preferredSectorOverride
        : this.preferredSectorId && unlockedSectors.includes(this.preferredSectorId)
        ? this.preferredSectorId
        : unlockedSectors[0] ?? 'near_orbit';
    const shipId = p.unlockedShips.includes(p.selectedShipId) ? p.selectedShipId : 'cannon_skiff';
    const crewId =
      p.selectedCrewId && p.unlockedCrew.includes(p.selectedCrewId)
        ? p.selectedCrewId
        : p.unlockedCrew[0] ?? null;
    const slots = [...buildFreeFallbackPrepareSlots(shipId, p.blueprints)];
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
    };
    this.activeDockingNotice = null;
    this.syncAll();
  }

  private buildPreparePreviewBay(draft: V2PrepareDraft): V2CargoBayState {
    const placed: V2PlacedItem[] = [];
    for (const s of draft.slots) {
      const def = V2_EQUIPMENT_DEFS[s.definitionId];
      if (!def) continue;
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
      placed.push({
        item: createV2EquipmentInstance({
          instanceId: s.slotKey,
          kind: def.kind,
          quality: def.quality,
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
    const deterministicSeed = deriveSessionRunSeed(this.urlBaseSeed, this.sessionLaunchIndex);
    const res = launchV2Expedition({
      profile: this.save.profile,
      contractTemplateId: draft.contractTemplateId,
      shipId: draft.shipId,
      crewId: draft.crewId,
      primaryArchetype: draft.primaryArchetype,
      slots: draft.slots,
      trialBuildId: draft.trialBuildId,
      sectorId: draft.sectorId,
      seed: deterministicSeed,
    });
    if (!res.ok || !res.run) {
      this.showToast(res.errors.join('；') || '无法出航');
      return;
    }
    if (this.urlBaseSeed !== null) {
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
    this.settlementDispositions = {};
    this.selectedMapNodeId = null;

    const hasRelicSignal = Object.values(res.run.graph.nodes).some((n) => Boolean(n.hasRelicSignal));
    if (hasRelicSignal) {
      this.triggerCrewComm('pity_signal_detected');
    } else if (res.run.sectorId === 'frozen_graveyard') {
      this.triggerCrewComm('act2_start');
    } else if (res.run.sectorId === 'stargate_abyss') {
      this.triggerCrewComm('act3_start');
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
      draft.sectorId
    );
    const previewBay = this.buildPreparePreviewBay(draft);

    renderPrepareView(
      this.leftPanelEl,
      { profile: p, draft, readOnly, validation },
      {
        onBack: () => {
          this.prepareDraft = null;
          soundEngine.play('click');
          this.syncAll();
        },
        onSelectSector: (sectorId) => {
          if (!p.campaign.unlockedSectors.includes(sectorId)) return;
          draft.sectorId = sectorId;
          this.preferredSectorId = sectorId;
          soundEngine.play('click');
          this.syncAll();
        },
        onPickTrial: (tid) => {
          const spec = V2_TRIAL_BUILDS[tid];
          draft.trialBuildId = tid;
          draft.primaryArchetype = spec.archetypeId;
          draft.slots = [...buildTrialPrepareSlots(tid, draft.shipId)];
          draft.playingDemo = true;
          draft.demoPlaybackKey = null;
          draft.missingPresetEntries = [];
          draft.presetNotice = null;
          soundEngine.play('energyLink');
          this.syncAll();
        },
        onExitTrial: () => {
          draft.trialBuildId = null;
          draft.playingDemo = false;
          draft.demoPlaybackKey = null;
          draft.slots = [...buildFreeFallbackPrepareSlots(draft.shipId, p.blueprints)];
          soundEngine.play('click');
          this.syncAll();
        },
        onSelectShip: (nextShip: V2ShipId) => {
          if (nextShip === draft.shipId) return;
          draft.shipId = nextShip;
          draft.playingDemo = false;
          draft.demoPlaybackKey = null;
          draft.slots = draft.trialBuildId
            ? [...buildTrialPrepareSlots(draft.trialBuildId, nextShip)]
            : [...buildFreeFallbackPrepareSlots(nextShip, p.blueprints)];
          draft.missingPresetEntries = [];
          draft.presetNotice = null;
          soundEngine.play('click');
          this.syncAll();
        },
        onSelectCrew: (crewId) => {
          if (!p.unlockedCrew.includes(crewId)) return;
          draft.crewId = crewId;
          soundEngine.play('click');
          this.syncAll();
        },
        onSelectArchetype: (arch) => {
          draft.primaryArchetype = arch;
          soundEngine.play('click');
          this.syncAll();
        },
        onFallback: () => {
          draft.trialBuildId = null;
          draft.playingDemo = false;
          draft.demoPlaybackKey = null;
          draft.slots = [...buildFreeFallbackPrepareSlots(draft.shipId, p.blueprints)];
          draft.missingPresetEntries = [];
          draft.presetNotice = null;
          soundEngine.play('click');
          this.syncAll();
        },
        onClear: () => {
          draft.trialBuildId = null;
          draft.playingDemo = false;
          draft.demoPlaybackKey = null;
          draft.slots = [];
          draft.missingPresetEntries = [];
          draft.presetNotice = null;
          soundEngine.play('click');
          this.syncAll();
        },
        onAddLoan: (defId) => {
          if (draft.trialBuildId) return;
          const spot = findFirstLegalV2Placement(previewBay, defId);
          if (!spot) {
            this.showToast('当前船舱没有足够空位放入该设备，请先移位或卸下旧件。');
            return;
          }
          draft.playingDemo = false;
          draft.demoPlaybackKey = null;
          draft.slots = [
            ...draft.slots,
            {
              slotKey: `loan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
              origin: 'loan',
              definitionId: defId,
              x: spot.x,
              y: spot.y,
              rotation: spot.rotation,
            },
          ];
          soundEngine.play('place');
          this.syncAll();
        },
        onAddOwned: (instId) => {
          if (draft.trialBuildId) return;
          const w = p.equipmentWarehouse.find((item) => item.instanceId === instId);
          if (!w) return;
          const spot = findFirstLegalV2Placement(previewBay, w.definitionId);
          if (!spot) {
            this.showToast('当前船舱没有足够空位放入该自有设备。');
            return;
          }
          draft.playingDemo = false;
          draft.demoPlaybackKey = null;
          draft.slots = [
            ...draft.slots,
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
          soundEngine.play('place');
          this.syncAll();
        },
        onSavePreset: (name) => {
          if (!this.canMutate() || draft.trialBuildId) return;
          const existing = p.loadoutPresets.find((pr) => pr.name === name);
          const res = saveV2LoadoutPreset(this.save.profile, {
            presetId: existing?.presetId,
            name,
            shipId: draft.shipId,
            crewId: draft.crewId,
            primaryArchetype: draft.primaryArchetype,
            slots: draft.slots,
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
          const pr = p.loadoutPresets.find((item) => item.presetId === presetId);
          if (!pr) return;
          if (!p.unlockedShips.includes(pr.shipId)) {
            this.showToast('预设对应的舰船尚未解锁。');
            return;
          }
          const resolved = resolveV2PresetAgainstWarehouse(p, pr);
          const goodSlots = resolved
            .map((r) => r.resolved)
            .filter((x): x is V2PrepareSlotEntry => x !== null);
          const missing = resolved.filter((r) => r.missingOwned);

          draft.shipId = pr.shipId;
          draft.crewId = pr.crewId && p.unlockedCrew.includes(pr.crewId) ? pr.crewId : draft.crewId;
          draft.primaryArchetype = pr.primaryArchetype;
          draft.trialBuildId = null;
          draft.playingDemo = false;
          draft.demoPlaybackKey = null;
          draft.slots = goodSlots;
          draft.missingPresetEntries = missing;
          draft.presetNotice =
            missing.length > 0
              ? `预设「${pr.name}」有 ${missing.length} 件自有设备当前不在仓库中，已空出对应槽位。`
              : `已完整载入预设「${pr.name}」。`;
          soundEngine.play('click');
          this.syncAll();
        },
        onSubLoan: () => {
          let tempBay = this.buildPreparePreviewBay(draft);
          const added: V2PrepareSlotEntry[] = [...draft.slots];
          for (const m of draft.missingPresetEntries) {
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
            tempBay = this.buildPreparePreviewBay({ ...draft, slots: added });
          }
          draft.slots = added;
          draft.missingPresetEntries = [];
          draft.presetNotice = '已按你的确认，以借用普通蓝图补齐缺失槽位。';
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
        onLaunch: () => this.launchExpeditionFromDraft(draft),
      }
    );

    const shipMaxHp = V2_SHIPS[draft.shipId].maxHp;
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
        }),
      onChange: (nextBay) => {
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
        this.syncAll();
      },
      onPrepareRemove: draft.trialBuildId
        ? undefined
        : (instanceId) => {
            draft.playingDemo = false;
            draft.demoPlaybackKey = null;
            draft.slots = draft.slots.filter(
              (s) => s.slotKey !== instanceId && s.warehouseInstanceId !== instanceId
            );
            this.syncAll();
          },
    });
  }

  private renderMapPhase(run: V2RunState): void {
    const readOnly = this.isReadOnlyTab && !run.isShowcase;
    renderMapView(
      this.leftPanelEl,
      {
        run,
        readOnly,
        selectedMapNodeId: this.selectedMapNodeId,
        mobileMapShowFull: this.mobileMapShowFull,
        isCompactViewport: window.innerWidth < 860,
        eliteTacticEnabled: Boolean(this.save.settings.eliteTacticExperiment),
      },
      {
        onToggleMobileMap: () => {
          this.mobileMapShowFull = !this.mobileMapShowFull;
          soundEngine.play('click');
          this.renderMapPhase(run);
        },
        onSelectNode: (nid) => {
          this.selectedMapNodeId = nid;
          soundEngine.play('click');
          this.renderMapPhase(run);
        },
        onJumpNode: (nid) => {
          if (!this.canMutate()) return;
          const res = selectV2MapNode(run, nid);
          if (!res.ok) {
            this.showToast(res.error ?? '无法跃迁至该节点');
            return;
          }
          this.selectedMapNodeId = null;
          this.selectedWreckHotspot = 'armory';
          const enteredNode = res.run.graph.nodes[nid];
          const bossId = enteredNode?.combat?.bossId ?? enteredNode?.bossId;
          if (bossId === 'boss_anvil') this.triggerCrewComm('act1_boss_intro');
          else if (bossId === 'boss_dreadnought') this.triggerCrewComm('act2_boss_intro');
          else if (bossId === 'boss_leviathan') this.triggerCrewComm('act3_boss_intro');
          this.setCurrentRun(res.run);
          soundEngine.play('warpJump');
          this.syncAll();
        },
        onSafeReturn: () => {
          if (!this.canMutate()) return;
          const res = initiateV2SafeReturnFromMap(run);
          if (!res.ok) return this.showToast(res.error ?? '当前无法返航');
          this.settlementDispositions = {};
          this.setCurrentRun(res.run);
          soundEngine.play('returnDock');
          this.syncAll();
        },
        onAbortContract: () => {
          if (!this.canMutate()) return;
          const nextRun = abortActiveV2Contract(run);
          this.setCurrentRun(nextRun);
          soundEngine.play('click');
          this.showToast(
            run.contract.type === 'rescue'
              ? '已放弃救援委托：救生舱已由信标移交，释放船舱空位与额外油耗。'
              : '已放弃当前委托，可继续自由探索或免费返航。'
          );
          this.syncAll();
        },
      }
    );

    this.mountV2CargoBay(run.bay, false, {
      title: `当前船舱 · ${V2_SHIPS[run.shipId].name}`,
      statusBadge: '航行中',
    });
  }

  private renderEncounterPhase(run: V2RunState): void {
    const node = run.currentNodeId ? run.graph.nodes[run.currentNodeId] : null;
    if (!node) return;
    const readOnly = this.isReadOnlyTab && !run.isShowcase;

    if (node.combat) {
      if (run.activeCombat) {
        this.cargoGrid?.destroy();
        this.cargoGrid = null;
        this.leftPanelEl.innerHTML = '';
        this.rightPanelEl.innerHTML = '';
        return;
      }

      renderCombatPreView(
        this.leftPanelEl,
        {
          run,
          node,
          readOnly,
          showCombatLogDetails: this.showCombatLogDetails,
          eliteTacticEnabled: Boolean(this.save.settings.eliteTacticExperiment),
        },
        {
          onSelectPolicy: (policy) => {
            if (!this.canMutate()) return;
            this.setCurrentRun({ ...run, targetPolicy: policy });
            soundEngine.play('click');
            this.syncAll();
          },
          onToggleLog: () => {
            this.showCombatLogDetails = !this.showCombatLogDetails;
            this.renderEncounterPhase(run);
          },
          onStartCombat: () => {
            if (!this.canMutate()) return;
            const res = startV2CombatAtCurrentNode(run, run.targetPolicy, {
              enableEliteTactic: Boolean(this.save.settings.eliteTacticExperiment),
            });
            if (!res.ok) {
              this.showToast(res.error ?? '无法开始战斗');
              return;
            }
            this.setCurrentRun(res.run);
            soundEngine.play('click');
            this.syncAll();
          },
        }
      );

      this.mountV2CargoBay(run.bay, false, {
        title: `参战船舱 · ${V2_SHIPS[run.shipId].name}`,
        statusBadge: '战前锁定',
      });
      return;
    }

    if (node.type === 'wreck' && node.wreck) {
      renderWreckLeftPanel(
        this.leftPanelEl,
        { readOnly },
        {
          onAbandon: () => {
            if (!this.canMutate()) return;
            const res = abandonV2EventAndReturn(run);
            if (!res.ok) return this.showToast(res.error ?? '无法放弃返航');
            this.settlementDispositions = {};
            this.setCurrentRun(res.run);
            soundEngine.play('returnDock');
            this.syncAll();
          },
        }
      );
      this.mountV2CargoBay(run.bay, false, { title: '当前船舱参考', statusBadge: '参考空位' });
      return;
    }

    renderEventView(
      this.leftPanelEl,
      { run, node, readOnly },
      {
        onAnomalyChoice: (choice) => {
          if (!this.canMutate()) return;
          const res = resolveV2AnomalyChoice(run, choice);
          if (!res.ok) return this.showToast(res.error ?? '操作失败');
          this.setCurrentRun(res.run);
          soundEngine.play('place');
          this.syncAll();
        },
        onDistressChoice: (choice) => {
          if (!this.canMutate()) return;
          const res = resolveV2DistressChoice(run, choice);
          if (!res.ok) return this.showToast(res.error ?? '操作失败');
          this.setCurrentRun(res.run);
          soundEngine.play('place');
          this.syncAll();
        },
        onAbandon: () => {
          if (!this.canMutate()) return;
          const res = abandonV2EventAndReturn(run);
          if (!res.ok) return this.showToast(res.error ?? '无法放弃返航');
          this.settlementDispositions = {};
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
    if (!node || !node.merchant) return;
    const readOnly = this.isReadOnlyTab && !run.isShowcase;

    renderShopView(
      this.leftPanelEl,
      { run, node, readOnly },
      {
        onBuyOffer: (oid) => {
          if (!this.canMutate()) return;
          const res = buyV2MerchantOffer(
            run,
            oid,
            `tx_offer_${node.nodeId}_${oid}`,
            this.save.profile.unlockedFamilies
          );
          if (!res.ok) return this.showToast(res.error ?? '购买失败');
          this.setCurrentRun(res.run);
          soundEngine.play('place');
          this.syncAll();
        },
        onBuyFuel: () => {
          if (!this.canMutate()) return;
          const res = buyV2MerchantFuel(run, `tx_fuel_${node.nodeId}`);
          if (!res.ok) return this.showToast(res.error ?? '无法购买燃料');
          this.setCurrentRun(res.run);
          soundEngine.play('click');
          this.syncAll();
        },
        onBuyRepair: () => {
          if (!this.canMutate()) return;
          const res = buyV2MerchantRepair(run, `tx_repair_${node.nodeId}`);
          if (!res.ok) return this.showToast(res.error ?? '无法购买维修');
          this.setCurrentRun(res.run);
          soundEngine.play('click');
          this.syncAll();
        },
        onSellLoot: (iid) => {
          if (!this.canMutate()) return;
          const res = sellV2ItemToMerchant(run, iid, `tx_sell_${node.nodeId}_${iid}`);
          if (!res.ok) return this.showToast(res.error ?? '出售失败');
          this.setCurrentRun(res.run);
          soundEngine.play('click');
          this.syncAll();
        },
        onEngineerSwap: (kind) => this.handleEngineerSwap(run, kind),
        onFinish: () => {
          if (!this.canMutate()) return;
          const res = finishV2MerchantVisit(run);
          if (!res.ok) return this.showToast(res.error ?? '无法离开商人节点');
          this.setCurrentRun(res.run);
          soundEngine.play('click');
          this.syncAll();
        },
      }
    );

    this.mountV2CargoBay(run.bay, !readOnly, {
      title: '商人节点船舱整理',
      getTacticalDelta: (item, zone) =>
        computeV2PlacementTacticalDelta({
          run,
          bay: run.bay,
          startingHp: run.hp,
          maxHp: run.maxHp,
          targetPolicy: run.targetPolicy,
          item,
          zone,
        }),
      onChange: (nextBay) => {
        if (!this.canMutate()) return;
        this.setCurrentRun({ ...run, bay: nextBay });
        this.syncAll();
      },
    });
  }

  private renderRewardPhase(run: V2RunState): void {
    const readOnly = this.isReadOnlyTab && !run.isShowcase;
    renderRewardView(
      this.leftPanelEl,
      { run, readOnly },
      {
        onPickReward: (choice) => {
          if (!this.canMutate()) return;
          const res = pickV2CombatReward(run, choice, this.save.profile.unlockedFamilies);
          if (!res.ok) return this.showToast(res.error ?? '领取奖励失败');
          this.setCurrentRun(res.run);
          soundEngine.play('place');
          this.syncAll();
        },
      }
    );

    this.mountV2CargoBay(run.bay, false, { title: '当前船舱参考', statusBadge: '参考空位' });
  }

  private renderArrangePhase(run: V2RunState): void {
    const readOnly = this.isReadOnlyTab && !run.isShowcase;
    const collapsed = this.isArrangeSceneCollapsed();

    renderArrangeView(
      this.leftPanelEl,
      { run, readOnly, sceneCollapsed: collapsed },
      {
        onToggleShipPreview: () => {
          this.sceneCollapseOverride = !collapsed;
          soundEngine.play('click');
          this.syncAll();
        },
        onEngineerSwap: (kind) => this.handleEngineerSwap(run, kind),
        onSurveyScan: () => {
          if (!this.canMutate()) return;
          const res = performSurveyAtCurrentNode(run);
          if (!res.ok) return this.showToast(res.reason ?? '无法执行勘测');
          this.setCurrentRun(res.run);
          soundEngine.play('energyLink');
          this.showToast('航迹勘测完成！');
          this.syncAll();
        },
        onAbortContract: () => {
          if (!this.canMutate()) return;
          const nextRun = abortActiveV2Contract(run);
          this.setCurrentRun(nextRun);
          soundEngine.play('click');
          this.showToast('已放弃当前委托。');
          this.syncAll();
        },
        onLeaveArrange: (terminal) => {
          if (!this.canMutate()) return;
          const proceed = () => {
            const res = finishV2ArrangeAndProceed(run, terminal ? 'safe_return' : 'map');
            if (!res.ok) return this.showToast(res.error ?? '当前无法离开整理');
            if (res.run.phase === 'SETTLEMENT') {
              this.settlementDispositions = {};
            }
            this.setCurrentRun(res.run);
            soundEngine.play('click');
            this.syncAll();
          };
          if (run.bay.discardedThisArrange.length > 0) {
            openV2DiscardConfirmModal(this.modalHostEl, run.bay.discardedThisArrange, proceed);
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
          ? this.leftPanelEl.querySelector<HTMLElement>('#v3-arrange-inspector-slot')
          : null,
      getTacticalDelta: (item, zone) =>
        computeV2PlacementTacticalDelta({
          run,
          bay: run.bay,
          startingHp: run.hp,
          maxHp: run.maxHp,
          targetPolicy: run.targetPolicy,
          item,
          zone,
        }),
      onChange: (nextBay) => {
        if (!this.canMutate()) return;
        this.setCurrentRun({ ...run, bay: nextBay });
        this.phaserHost?.updateV2ShipVisualSpec(deriveV2ShipVisualSpec(nextBay));
        this.syncAll();
      },
    });
  }

  private renderSettlementPhase(run: V2RunState): void {
    const p = this.save.profile;
    const readOnly = this.isReadOnlyTab && !run.isShowcase;
    const summary = calculateV2Settlement(run, p, this.settlementDispositions);
    const isSafe = summary.reason === 'safe_return';
    const projectedCredits = p.credits + summary.finalCreditsEarned;
    const nextGoal = this.computeNextBaseGoal(p, projectedCredits);

    renderSettlementView(
      this.leftPanelEl,
      { run, profile: p, summary, nextGoal, readOnly },
      {
        onChangeDisposition: (iid, disp) => {
          if (!this.canMutate()) return;
          this.settlementDispositions[iid] = disp;
          soundEngine.play('click');
          this.renderTopHud();
          this.renderSettlementPhase(run);
        },
        onShowcaseRetry: () => {
          soundEngine.play('click');
          openV2ShowcasePickerModal(this.modalHostEl, (tid) => this.startShowcaseRun(tid));
        },
        onShowcaseToBase: () => {
          soundEngine.play('click');
          this.showcaseRun = null;
          this.settlementDispositions = {};
          this.syncAll();
        },
        onConfirmSettlement: () => {
          if (!this.canMutate()) return;
          if (!this.save.activeRun || this.save.activeRun.phase !== 'SETTLEMENT') return;

          const creditsBefore = this.save.profile.credits;
          const result = applyV2Settlement(
            this.save.profile,
            this.save.activeRun,
            this.settlementDispositions
          );
          if (!result.ok) {
            this.showToast(result.error ?? '结算失败');
            return;
          }

          this.save = {
            ...this.save,
            profile: result.profile,
            activeRun: null,
          };
          this.settlementDispositions = {};
          this.persist();

          soundEngine.play(result.summary.contractCompleted ? 'contractDeliver' : 'returnDock');

          const unlockedParts = [
            result.actTransition
              ? `主线推进：${CAMPAIGN_CHAPTERS[result.actTransition.to].title}`
              : null,
            result.newlyUnlockedSectors && result.newlyUnlockedSectors.length > 0
              ? `解锁星区：${result.newlyUnlockedSectors.map((sid) => getV3SectorDef(sid).name).join('、')}`
              : null,
            result.crewMasteryUpgraded
              ? `${V2_CREW[result.crewMasteryUpgraded.crewId].name}专精升至 Lv.${result.crewMasteryUpgraded.toTier}`
              : null,
            result.unlockedFamilyName ? `解锁体系：${result.unlockedFamilyName}` : null,
            result.unlockedCrewName ? `新船员加入：${result.unlockedCrewName}` : null,
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
            contractCompleted: result.summary.contractCompleted,
            unlockedText: unlockedParts.length > 0 ? unlockedParts.join(' · ') : null,
            crateCount: Math.max(1, result.summary.lines.length),
            hasKeptRelic: Object.keys(result.summary.keptRelicsById).length > 0,
            wasDefeat: result.summary.reason === 'defeat',
            animating: !reduced,
            progress: reduced ? 1 : 0,
          };
          this.activeDockingNotice = notice;
          this.syncAll();

          if (!reduced) {
            this.phaserHost?.playBaseReturnDocking({
              earnedCredits: notice.earnedCredits,
              crateCount: notice.crateCount,
              hasKeptRelic: notice.hasKeptRelic,
              wasDefeat: notice.wasDefeat,
              onProgress: (prog) => {
                if (this.activeDockingNotice !== notice) return;
                notice.progress = prog;
                this.renderTopHud();
                this.renderBaseHeroOverlay();
              },
              onFinish: () => {
                if (this.activeDockingNotice !== notice) return;
                notice.animating = false;
                notice.progress = 1;
                this.renderTopHud();
                this.renderBaseHeroOverlay();
              },
            });
          }
        },
      }
    );

    this.mountV2CargoBay(run.bay, false, {
      title: isSafe ? '返航船舱清点' : '战败前最终布局',
      statusBadge: '结算清点',
    });
  }

  // --- Shared Right-Panel CargoGridV2 Mount ---

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
    this.rightPanelEl.innerHTML = `
      <div class="panel-header">
        <h2>${opts.title}</h2>
        <span class="panel-sub">${opts.statusBadge ?? (editable ? '可调整' : '当前配置')}</span>
      </div>
      <div class="cargo-mount-root" id="v2-cargo-mount"></div>
    `;
    const mount = this.rightPanelEl.querySelector<HTMLElement>('#v2-cargo-mount')!;
    this.cargoGrid?.destroy();
    this.cargoGrid = new CargoGridV2Component(mount, {
      onBayChange: (nextBay) => opts.onChange?.(nextBay),
      onPrepareRemoveItem: (id) => opts.onPrepareRemove?.(id),
      getTacticalDelta: opts.getTacticalDelta,
      getInspectorHost: opts.getInspectorHost,
    });
    this.cargoGrid.render(bay, editable, { prepareMode: opts.prepareMode });
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
        if (!this.getCurrentRun() && !this.prepareDraft) {
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
    });
  }

  private openFacilitiesModal(): void {
    openV2FacilitiesDrawerModal(this.modalHostEl, () => this.save.profile, {
      readOnly: this.isReadOnlyTab,
      onBuild: (fid: V2FacilityId) => {
        if (this.isReadOnlyTab || !this.tabGuard.canWrite()) {
          return { ok: false, error: '当前窗口为只读状态' };
        }
        const res = purchaseV2Facility(this.save.profile, fid);
        if (res.ok) {
          this.save = { ...this.save, profile: res.profile };
          this.recentlyBuiltPin =
            fid === 'display'
              ? 'display'
              : fid === 'drydock' || fid === 'drydock_tier2'
              ? 'drydock'
              : 'workbench';
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
      onChange: (next) => {
        this.save = { ...this.save, settings: next };
        this.applySettingsEffects();
        this.persist();
      },
      onSwitchToV1: () => this.options.onSwitchToV1(),
      onOpenMigration: this.v1Inspection.hasV1Save ? () => this.openMigrationWizard() : undefined,
      onResetV2Save: () => {
        if (!this.canMutate()) return;
        clearV2SaveData(window.localStorage);
        this.save = createFreshV2SaveData();
        this.showcaseRun = null;
        this.prepareDraft = null;
        this.activeDockingNotice = null;
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
      onSellItem: (instanceId) => {
        if (this.isReadOnlyTab || !this.tabGuard.canWrite()) {
          return { ok: false, error: '当前窗口为只读状态' };
        }
        const res = sellV2WarehouseItem(this.save.profile, instanceId);
        if (res.ok) {
          this.save = { ...this.save, profile: res.profile };
          this.persist();
          soundEngine.play('click');
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
          soundEngine.play('click');
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
