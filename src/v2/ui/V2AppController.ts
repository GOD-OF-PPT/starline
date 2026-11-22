import {
  getItemImageUrl,
  getPlayerShipImageUrl,
  getTitleKeyArtUrl,
} from '../../assets/itemArt';
import { soundEngine } from '../../audio/soundEngine';
import type { BuildingId } from '../../data/buildings';
import type { BaseProgression } from '../../domain/progression';
import { MultiTabGuard } from '../../domain/tabLock';
import { PhaserHost } from '../../scenes/PhaserHost';
import { hasOpenModal, registerModalBackgroundRoot } from '../../ui/Modals';
import { V2_CONTRACT_TEMPLATES } from '../data/contracts';
import { V2_CREW, V2_CREW_ORDER, type V2CrewId } from '../data/crew';
import {
  V2_ARCHETYPE_LABELS,
  V2_EQUIPMENT_DEFS,
  V2_RESEARCH_COST_CREDITS,
  V2_WAREHOUSE_CAPACITY,
  getMerchantBuybackPrice,
  getV2EquipmentDefByKind,
  type V2ArchetypeId,
  type V2EquipmentKind,
} from '../data/equipment';
import {
  V2_FACILITIES,
  V2_RELICS,
  V2_RELIC_ORDER,
  type V2FacilityId,
} from '../data/facilities';
import { V2_SHAPES } from '../data/shapes';
import { V2_SHIPS, V2_SHIP_ORDER, type V2ShipId } from '../data/ships';
import { createV2ShowcaseRun } from '../data/showcaseRun';
import {
  V2_TRIAL_BUILD_ORDER,
  V2_TRIAL_BUILDS,
  buildTrialPrepareSlots,
  getTrialDemoUnits,
} from '../data/trialBuilds';
import { V2_TUTORIAL_HINTS, createV2TutorialRun } from '../data/tutorialV2';
import {
  commitV2EliteTacticDecision,
  completeV2CombatAtCurrentNode,
  previewV2CombatNode,
  simulateV2Combat,
  startV2CombatAtCurrentNode,
} from '../domain/combatV2';
import {
  abortActiveV2Contract,
  canPerformSurveyAtCurrentNode,
  computeV2JumpFuelCost,
  countEscapePodsInBay,
  getAvailableContractBoard,
  isContractReadyForDelivery,
  performSurveyAtCurrentNode,
} from '../domain/contracts';
import {
  abandonV2EventAndReturn,
  applyV2EngineerSwap,
  areAllEventOptionsUnaffordable,
  buyV2MerchantFuel,
  buyV2MerchantOffer,
  buyV2MerchantRepair,
  finishV2ArrangeAndProceed,
  finishV2MerchantVisit,
  getReachableNextNodeIds,
  initiateV2SafeReturnFromMap,
  isAtTerminalLayer,
  pickV2CombatReward,
  resolveV2AnomalyChoice,
  resolveV2DistressChoice,
  resolveV2WreckChoice,
  selectV2MapNode,
  sellV2ItemToMerchant,
} from '../domain/encounter';
import { findFirstLegalV2Placement } from '../domain/inventoryV2';
import { createV2EquipmentInstance, getAnyV2ItemDef } from '../domain/itemCatalog';
import {
  V2_MAX_SAVED_PRESETS,
  buildFreeFallbackPrepareSlots,
  deleteV2LoadoutPreset,
  launchV2Expedition,
  resolveV2PresetAgainstWarehouse,
  saveV2LoadoutPreset,
  validateV2PrepareLoadout,
  type V2PrepareSlotEntry,
  type V2ResolvedPresetSlot,
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
import { applyV2Settlement, calculateV2Settlement } from '../domain/settlementV2';
import { deriveV2ShipVisualSpec } from '../domain/shipVisualSpec';
import { computeV2PlacementTacticalDelta } from '../domain/tacticalDelta';
import {
  V2_TAB_CHANNEL,
  V2_TAB_LOCK_KEY,
  type V2CargoBayState,
  type V2CombatRoundLog,
  type V2EliteTacticChoice,
  type V2MapNode,
  type V2NodeType,
  type V2PlacedItem,
  type V2ProfileState,
  type V2RunState,
  type V2SaveData,
  type V2SettlementDisposition,
  type V2TargetPolicy,
  type V2TrialBuildId,
  type V2WreckChoice,
} from '../domain/types';
import {
  CargoGridV2Component,
  originTagText,
  renderV2MiniMaskHtml,
} from './CargoGridV2';
import { svgIcon, type V2IconName } from './icons';
import {
  openV1MigrationModal,
  openV2BackupRecoveryModal,
  openV2CargoPeekModal,
  openV2CodexModal,
  openV2ContractsDrawerModal,
  openV2DiscardConfirmModal,
  openV2FacilitiesDrawerModal,
  openV2HelpModal,
  openV2RelicGalleryModal,
  openV2SettingsModal,
  openV2ShowcasePickerModal,
  openV2WarehouseModal,
} from './V2Modals';

const V2_TITLE_SESSION_KEY = 'starline_v2_title_entered';

interface V2PrepareDraft {
  contractTemplateId: string;
  shipId: V2ShipId;
  crewId: V2CrewId | null;
  primaryArchetype: V2ArchetypeId;
  trialBuildId: V2TrialBuildId | null;
  playingDemo: boolean;
  demoPlaybackKey: string | null;
  slots: V2PrepareSlotEntry[];
  missingPresetEntries: readonly V2ResolvedPresetSlot[];
  presetNotice: string | null;
}

interface V2ReturnDockingNotice {
  readonly creditsBefore: number;
  readonly creditsAfter: number;
  readonly earnedCredits: number;
  readonly contractCompleted: boolean;
  readonly unlockedText: string | null;
  readonly crateCount: number;
  readonly hasKeptRelic: boolean;
  readonly wasDefeat: boolean;
  animating: boolean;
  progress: number;
}

interface NextBaseGoal {
  readonly title: string;
  readonly detail: string;
  readonly actionKind: 'facilities' | 'warehouse' | 'relics';
  readonly targetCost?: number;
  readonly ready: boolean;
}

const NODE_TYPE_META: Record<
  V2NodeType,
  { readonly label: string; readonly icon: V2IconName; readonly cls: string }
> = {
  combat: { label: '敌舰巡逻', icon: 'combat', cls: 'node-combat' },
  elite: { label: '精英旗舰', icon: 'elite', cls: 'node-elite' },
  wreck: { label: '废船打捞', icon: 'wreck', cls: 'node-wreck' },
  merchant: { label: '流动商人', icon: 'merchant', cls: 'node-merchant' },
  anomaly: { label: '异常星区', icon: 'anomaly', cls: 'node-anomaly' },
  distress: { label: '求救信号', icon: 'distress', cls: 'node-distress' },
};

const ARCHETYPE_ORDER: readonly V2ArchetypeId[] = ['laser', 'heavy', 'hangar', 'counter'];

export interface V2ControllerOptions {
  readonly onSwitchToV1: () => void;
}

export class V2AppController {
  private readonly mountEl: HTMLElement;
  private readonly options: V2ControllerOptions;

  private save: V2SaveData;
  /** Isolated 4-node showcase run (strictly in-memory; NEVER mutates formal profile/save!) */
  private showcaseRun: V2RunState | null = null;
  private phaserHost: PhaserHost | null = null;
  private cargoGrid: CargoGridV2Component | null = null;
  private tabGuard: MultiTabGuard;

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

  // Interactive focus states for unified Map & 3-hotspot Wreck
  private selectedMapNodeId: string | null = null;
  private selectedWreckHotspot: 'armory' | 'reactor' | 'cargo' = 'armory';

  // Live combat playback display telemetry (pure presentation)
  private activeCombatPlaybackKey: string | null = null;
  private liveCombatRound = 0;
  private liveCombatPlayerHp = 30;
  private liveCombatPlayerShield = 0;
  private liveCombatEnemiesAlive = 0;
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
    this.save = { ...this.save, activeRun: next };
    this.persist();
  }

  init(): void {
    this.buildShellDom();
    this.titleEntered = this.readTitleSession();

    const loaded = loadV2SaveData(window.localStorage);
    if (loaded.status === 'loaded' || loaded.status === 'fresh') {
      this.save = loaded.data;
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

    this.tabGuard.start();
    this.isReadOnlyTab = !this.tabGuard.canWrite();

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
    this.applyViewportClasses();
    this.phaserHost?.resize();
    this.renderTopHud();
  };

  private canMutate(): boolean {
    if (this.showcaseRun) return !hasOpenModal();
    return !this.isReadOnlyTab && this.tabGuard.canWrite() && !hasOpenModal();
  }

  private isCompactViewport(): boolean {
    return window.innerWidth < 820 || window.innerHeight <= 700;
  }

  private isArrangeSceneCollapsed(): boolean {
    if (this.sceneCollapseOverride !== null) return this.sceneCollapseOverride;
    return this.isCompactViewport();
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
    // 1. Any researchable equipment ready in warehouse?
    if (p.buildings.research_lab) {
      const researchable = p.equipmentWarehouse.find((w) => canResearchV2Instance(p, w.instanceId).canResearch);
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

    // 2. Any restorable relic waiting in gallery?
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

    // 3. Closest unbuilt paid facility
    const priorityOrder: V2FacilityId[] = [
      'research_lab',
      'drydock',
      'display',
      'drydock_tier2',
    ];
    for (const fid of priorityOrder) {
      if (p.buildings[fid]) continue;
      const fac = V2_FACILITIES[fid];
      const chk = canBuildV2Facility(p, fid);
      const diff = Math.max(0, fac.cost - projectedCredits);
      return {
        title: `扩建目标：${fac.name}`,
        detail:
          chk.canBuild || diff === 0
            ? `${fac.effectSummary.slice(0, 22)}（资金已够！）`
            : `还差 ${diff}¤ · ${fac.effectSummary.slice(0, 18)}`,
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
    const isLiveCombat = Boolean(run?.phase === 'ENCOUNTER' && run.activeCombat);
    const isPreCombat = Boolean(run?.phase === 'ENCOUNTER' && curNode?.combat && !run.activeCombat);
    const isWreckHero = Boolean(run?.phase === 'ENCOUNTER' && curNode?.type === 'wreck');
    const isMapHero = Boolean(run?.phase === 'MAP');
    const collapsed = isArrange && this.isArrangeSceneCollapsed();

    this.sceneWrapEl.classList.toggle('scene-collapsed', collapsed);
    this.appShellEl.classList.toggle('phase-base-hero', isBaseHero);
    this.appShellEl.classList.toggle('phase-prepare', isPrepare);
    this.appShellEl.classList.toggle('phase-arrange', Boolean(isArrange));
    this.appShellEl.classList.toggle('phase-combat', isLiveCombat || isPreCombat);
    this.appShellEl.classList.toggle('phase-combat-live', isLiveCombat);
    this.appShellEl.classList.toggle('phase-wreck-hero', isWreckHero);
    this.appShellEl.classList.toggle('phase-map-hero', isMapHero);
  }

  private syncAll(): void {
    this.v1Inspection = inspectV1SaveForMigration(window.localStorage);
    this.applyViewportClasses();
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
    const p = this.save.profile;
    const relicSum = getV2RelicSummary(p);
    const hasProgress =
      p.totalRuns > 0 || p.tutorialCompleted || p.credits > 0 || Boolean(p.migrationRecord);
    const ctaText = hasProgress ? '进入拆解站 · 继续远航' : '进入拆解站 · 开启首航';

    this.titleHostEl.innerHTML = `
      <div class="title-screen-backdrop" style="background-image:url('${getTitleKeyArtUrl()}')">
        <div class="title-screen-scrim">
          <div class="title-card v2-title-card">
            <div class="title-eyebrow">STARLINE SALVAGE STATION</div>
            <h1 class="title-heading">星际拆解站</h1>
            <p class="title-tagline">选舰配装 · 航路探索 · 船舱取舍 · 返航扩建</p>

            <div class="title-telemetry">
              <div class="title-stat"><span>信用点</span><strong class="num">${p.credits}¤</strong></div>
              <div class="title-stat"><span>舰船</span><strong class="num">${p.unlockedShips.length}/3</strong></div>
              <div class="title-stat"><span>蓝图</span><strong class="num">${p.blueprints.length}/10</strong></div>
              <div class="title-stat"><span>藏品馆</span><strong class="num">${relicSum.restoredCount}/${relicSum.totalCount}</strong></div>
            </div>

            <div class="title-actions">
              <button type="button" class="btn btn-primary btn-launch-hero" id="v2-title-enter">${svgIcon('rocket', 16)} ${ctaText}</button>
              <button type="button" class="btn btn-secondary btn-showcase-hero" id="v2-title-showcase">${svgIcon('bolt', 15)} 4 站精华试玩（试航三流派 · 不改正式档）</button>
              <div class="title-sub-actions">
                ${
                  this.shouldOfferMigrationPrompt()
                    ? `<button type="button" class="btn btn-secondary" id="v2-title-migrate">导入经典旧档</button>`
                    : ''
                }
                <button type="button" class="btn btn-ghost" id="v2-title-help">${svgIcon('help', 14)} 远航指南</button>
                <button type="button" class="btn btn-ghost" id="v2-title-v1">经典模式</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.titleHostEl.querySelector('#v2-title-enter')?.addEventListener('click', () => {
      soundEngine.play('click');
      this.titleEntered = true;
      this.writeTitleSession(true);
      this.syncAll();
    });
    this.titleHostEl.querySelector('#v2-title-showcase')?.addEventListener('click', () => {
      soundEngine.play('click');
      openV2ShowcasePickerModal(this.modalHostEl, (trialId) => {
        this.startShowcaseRun(trialId);
      });
    });
    this.titleHostEl.querySelector('#v2-title-migrate')?.addEventListener('click', () => {
      soundEngine.play('click');
      this.titleEntered = true;
      this.writeTitleSession(true);
      this.syncAll();
      this.openMigrationWizard();
    });
    this.titleHostEl.querySelector('#v2-title-help')?.addEventListener('click', () => {
      soundEngine.play('click');
      openV2HelpModal(this.modalHostEl);
    });
    this.titleHostEl.querySelector('#v2-title-v1')?.addEventListener('click', () => {
      soundEngine.play('click');
      this.options.onSwitchToV1();
    });
  }

  private startShowcaseRun(trialId: V2TrialBuildId): void {
    this.titleEntered = true;
    this.writeTitleSession(true);
    this.prepareDraft = null;
    this.activeDockingNotice = null;
    this.settlementDispositions = {};
    this.selectedMapNodeId = null;
    this.selectedWreckHotspot = 'armory';
    this.awaitingEliteDecision = false;
    this.showcaseRun = createV2ShowcaseRun(trialId);
    soundEngine.play('warpJump');
    this.syncAll();
  }

  // --- Top HUD (Clean, icon-unified, zero dev jargon) ---

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
        ${
          run?.isShowcase
            ? `<span class="v2-showcase-chip">4 站试玩</span>`
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

    // 1. BASE HERO STAGE (Interactive Orbital Station Diorama!)
    if (!run && !this.prepareDraft) {
      this.activeCombatPlaybackKey = null;
      this.awaitingEliteDecision = false;
      const p = this.save.profile;
      const relicSum = getV2RelicSummary(p);
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
          showAllPins: true,
        },
      });
      this.renderBaseHeroOverlay();
      return;
    }

    // 2. PREPARE Stage (Live Modular Ship Exterior OR 5-second Skippable Trial Demo!)
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
          // Cap demo playback to first 3 action-packed rounds (~3-4 seconds!)
          const shortSim = { ...demoSim, rounds: demoSim.rounds.slice(0, 3) };
          this.phaserHost.showV2Stage({
            shipId: draft.shipId,
            shipVisualSpec: visualSpec,
            sectorIndex: draft.trialBuildId === 'trial_heavy' ? 4 : draft.trialBuildId === 'trial_hangar' ? 2 : 5,
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
      this.phaserHost.showV2Stage({
        shipId: draft.shipId,
        shipVisualSpec: visualSpec,
        sectorIndex: 1,
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
        <div class="scene-stage-tag">${svgIcon('rocket', 13)} ${ship.name} · 外部挂点实时联动</div>
        <div class="v2-mount-strip">${mountChips}</div>
      `;
      return;
    }

    if (!run) return;

    const currentNode = run.currentNodeId ? run.graph.nodes[run.currentNodeId] : null;
    const sectorIndex = currentNode?.sectorBg ?? 1;
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
        const prevLog = resumeRound > 0 ? sim.rounds[resumeRound - 1] : null;
        this.liveCombatPlayerHp = prevLog ? prevLog.playerHpAfter : sim.startingPlayerHp;
        this.liveCombatPlayerShield = prevLog ? prevLog.playerShieldAfter : sim.startingPlayerShield;
        this.liveCombatEnemiesAlive = prevLog
          ? prevLog.enemiesAfter.filter((e) => e.hp > 0).length
          : sim.initialEnemies.length;

        this.phaserHost.showV2Stage({
          shipId: run.shipId,
          shipVisualSpec: visualSpec,
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
            this.renderCombatPlaybackOverlay(this.getCurrentRun() ?? run);
          },
          onComplete: () => {
            const activeRun = this.getCurrentRun();
            if (!activeRun || !activeRun.activeCombat) return;
            const res = completeV2CombatAtCurrentNode(
              activeRun,
              this.save.profile.unlockedFamilies
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
        sectorIndex,
        eventBackdrop: 'wreck',
        units: [],
        simulation: null,
        settings: this.save.settings,
      });
      this.renderWreckHotspotOverlay(run, currentNode);
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
      sectorIndex,
      eventBackdrop: eventBg,
      units: previewUnits,
      simulation: null,
      settings: this.save.settings,
    });

    const stageLabel =
      run.phase === 'MAP'
        ? `${svgIcon('radar', 13)} 航路第 ${currentNode ? currentNode.layer : 0}/${run.graph.maxLayers} 层`
        : run.phase === 'SHOP'
        ? `${svgIcon('merchant', 13)} 流动商人 · 航行钱包 ${run.wallet}¤`
        : run.phase === 'REWARD'
        ? `${svgIcon('crate', 13)} 战利品打捞 · 选择 1 项补给`
        : run.phase === 'ARRANGE'
        ? `${svgIcon('grid', 13)} ${V2_SHIPS[run.shipId].name} · 船舱外观联动`
        : run.phase === 'SETTLEMENT'
        ? `${svgIcon('beacon', 13)} ${run.settlementReason === 'defeat' ? '紧急拖回结算' : '安全靠泊清点'}`
        : currentNode
        ? `${svgIcon(NODE_TYPE_META[currentNode.type].icon, 13)} 第 ${currentNode.layer} 层 · ${
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

  // --- BASE HERO OVERLAY (Space Station = 72%+ Hero Viewport, Zero Dashboard!) ---

  private renderBaseHeroOverlay(): void {
    const p = this.save.profile;
    const readOnly = this.isReadOnlyTab;
    const relicSum = getV2RelicSummary(p);
    const nextGoal = this.computeNextBaseGoal(p);
    const recContractId = this.pickRecommendedContractId(p);
    const recTpl = V2_CONTRACT_TEMPLATES[recContractId] ?? V2_CONTRACT_TEMPLATES.transport_std;

    const dockingHtml = this.activeDockingNotice
      ? (() => {
          const n = this.activeDockingNotice!;
          const shownCredits = n.animating
            ? Math.round(n.creditsBefore + (n.creditsAfter - n.creditsBefore) * n.progress)
            : n.creditsAfter;
          return `
            <div class="docking-overlay-card">
              <div class="docking-title">${
                n.wasDefeat
                  ? '拖船已将受损舰体拖回拆解站'
                  : n.contractCompleted
                  ? '委托交付完成 · 货船安全靠泊'
                  : '货船安全返航 · 卸货入账完毕'
              }</div>
              <div class="docking-stats">
                <span>本次入账 <strong class="num">+${n.earnedCredits}¤</strong></span>
                <span>基地余额 <strong class="num">${shownCredits}¤</strong></span>
              </div>
              ${n.unlockedText ? `<div class="docking-unlock">${n.unlockedText}</div>` : ''}
              <div class="docking-actions">
                ${
                  n.animating
                    ? `<button type="button" class="btn btn-sm btn-secondary" id="v2-skip-dock">跳过靠泊</button>`
                    : `<button type="button" class="btn btn-sm btn-primary" id="v2-close-dock">收起</button>`
                }
              </div>
            </div>
          `;
        })()
      : '';

    const commandCardHtml = !p.tutorialCompleted
      ? `
        <div class="v2-base-cmd-card">
          <div class="v2-cmd-eyebrow">${svgIcon('star', 13)} 推荐首航</div>
          <div class="v2-cmd-title">首航教学 · 2×3 密封反应堆</div>
          <div class="v2-cmd-desc">3 层示范航路，亲手体验空间取舍、旋转拼装与安全返航，完成后免费解锁工作台并奖 +40¤。</div>
          <div class="v2-cmd-actions">
            <button type="button" class="btn btn-primary btn-launch-hero" id="v2-base-start-tut" ${
              readOnly ? 'disabled' : ''
            }>${svgIcon('rocket', 16)} 启动首航教学</button>
            <button type="button" class="btn btn-secondary" id="v2-base-all-contracts">委托终端</button>
          </div>
        </div>
      `
      : `
        <div class="v2-base-cmd-card">
          <div class="v2-cmd-eyebrow">${svgIcon('star', 13)} 当前推荐委托 · ${
          recTpl.rewardCredits > 0 ? `+${recTpl.rewardCredits}¤` : '自由打捞'
        }</div>
          <div class="v2-cmd-title">${recTpl.name}</div>
          <div class="v2-cmd-desc">${recTpl.gameplayNote}</div>
          <div class="v2-cmd-actions">
            <button type="button" class="btn btn-primary btn-launch-hero" id="v2-base-launch-rec" ${
              readOnly ? 'disabled' : ''
            }>${svgIcon('rocket', 16)} 接取并整备出航</button>
            <button type="button" class="btn btn-secondary" id="v2-base-all-contracts">全部委托</button>
          </div>
        </div>
      `;

    const utilityDockHtml = `
      <div class="v2-base-utility-col">
        <button type="button" class="v2-next-goal-pill ${nextGoal.ready ? 'is-ready' : ''}" id="v2-base-next-goal">
          <span class="v2-goal-k">${nextGoal.ready ? '下一步就绪' : '下一个基地目标'}</span>
          <strong>${nextGoal.title}</strong>
          <small>${nextGoal.detail}</small>
        </button>
        <div class="v2-station-dock" role="toolbar" aria-label="空间站功能区">
          <button type="button" class="v2-dock-btn" id="v2-dock-wh">
            ${svgIcon('warehouse', 17)}
            <span>设备库</span>
            <small class="num">${p.equipmentWarehouse.length}/${V2_WAREHOUSE_CAPACITY}${
      p.pendingGiftQueue.length > 0 ? ` +${p.pendingGiftQueue.length}` : ''
    }</small>
          </button>
          <button type="button" class="v2-dock-btn" id="v2-dock-fac">
            ${svgIcon('wrench', 17)}
            <span>设施扩建</span>
            <small class="num">${p.unlockedShips.length}/3 舰</small>
          </button>
          <button type="button" class="v2-dock-btn" id="v2-dock-relics">
            ${svgIcon('museum', 17)}
            <span>藏品馆</span>
            <small class="num">${relicSum.restoredCount}/${relicSum.totalCount}</small>
          </button>
          <button type="button" class="v2-dock-btn" id="v2-dock-codex">
            ${svgIcon('book', 17)}
            <span>图鉴</span>
            <small class="num">${p.blueprints.length}/10 蓝图</small>
          </button>
        </div>
      </div>
    `;

    this.sceneOverlayEl.innerHTML = `
      <div class="scene-stage-tag">${svgIcon('beacon', 13)} 星际拆解站 · 点击站内设施或下方指令泊位管理</div>
      ${dockingHtml}
      <div class="v2-base-hero-hud">
        ${commandCardHtml}
        ${utilityDockHtml}
      </div>
    `;

    this.sceneOverlayEl.querySelector('#v2-skip-dock')?.addEventListener('click', () => {
      this.phaserHost?.skipBaseReturnDocking();
    });
    this.sceneOverlayEl.querySelector('#v2-close-dock')?.addEventListener('click', () => {
      this.activeDockingNotice = null;
      this.renderBaseHeroOverlay();
    });
    this.sceneOverlayEl.querySelector('#v2-base-start-tut')?.addEventListener('click', () => {
      this.startTutorialRun();
    });
    this.sceneOverlayEl.querySelector('#v2-base-launch-rec')?.addEventListener('click', () => {
      if (!this.canMutate()) return;
      soundEngine.play('click');
      this.openPrepareForContract(recTpl.templateId);
    });
    this.sceneOverlayEl.querySelector('#v2-base-all-contracts')?.addEventListener('click', () => {
      soundEngine.play('click');
      openV2ContractsDrawerModal(this.modalHostEl, this.save.profile, {
        readOnly: this.isReadOnlyTab,
        onSelectContract: (tplId) => {
          if (!this.canMutate()) return;
          this.openPrepareForContract(tplId);
        },
        onStartTutorial: () => this.startTutorialRun(),
      });
    });
    this.sceneOverlayEl.querySelector('#v2-base-next-goal')?.addEventListener('click', () => {
      soundEngine.play('click');
      if (nextGoal.actionKind === 'warehouse') this.openWarehouseModal('warehouse');
      else if (nextGoal.actionKind === 'relics') this.openRelicGalleryModal();
      else this.openFacilitiesModal();
    });
    this.sceneOverlayEl.querySelector('#v2-dock-wh')?.addEventListener('click', () => {
      soundEngine.play('click');
      this.openWarehouseModal('warehouse');
    });
    this.sceneOverlayEl.querySelector('#v2-dock-fac')?.addEventListener('click', () => {
      soundEngine.play('click');
      this.openFacilitiesModal();
    });
    this.sceneOverlayEl.querySelector('#v2-dock-relics')?.addEventListener('click', () => {
      soundEngine.play('click');
      this.openRelicGalleryModal();
    });
    this.sceneOverlayEl.querySelector('#v2-dock-codex')?.addEventListener('click', () => {
      soundEngine.play('click');
      openV2CodexModal(this.modalHostEl, this.save.profile);
    });
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

  // --- COMBAT LIVE HERO OVERLAY (72%+ Battlefield + Elite Round-2 Tactic Decision!) ---

  private renderCombatPlaybackOverlay(run: V2RunState): void {
    const sim = run.activeCombat?.simulation;
    if (!sim) return;
    const pending = run.activeCombat?.pendingDecision;
    const showDecisionBar = Boolean(this.awaitingEliteDecision && pending && pending.chosen === null);
    const hpPct = Math.max(0, Math.min(100, Math.round((this.liveCombatPlayerHp / run.maxHp) * 100)));

    const decisionHtml = showDecisionBar
      ? `
        <div class="v2-elite-tactic-overlay" role="region" aria-label="精英战第2回合战术抉择">
          <div class="v2-et-head">
            <strong>${svgIcon('bolt', 15)} 第 ${pending!.roundNumber} 回合战术抉择</strong>
            <span>我方 ${pending!.playerHpAtPause} HP / ${pending!.playerShieldAtPause} 盾 · 敌方本轮齐射 <strong class="text-danger">${pending!.enemyThreatDamage}</strong> 伤</span>
          </div>
          <div class="v2-et-options">
            ${pending!.options
              .map(
                (opt) => `<button type="button" class="v2-et-btn ${
                  opt.choice === 'overload' ? 'is-amber' : opt.choice === 'emergency_defense' ? 'is-cyan' : ''
                }" data-elite-tactic="${opt.choice}" ${!opt.enabled ? 'disabled' : ''}>
                  <div class="v2-et-btn-head">
                    <strong>${opt.label}</strong>
                    <span class="v2-et-pred ${opt.predictedOutcome === 'victory' ? 'ok' : 'risk'}">${
                  opt.predictedOutcome === 'victory'
                    ? `预计胜 · 余 ${opt.predictedFinalHp} HP (${opt.predictedRounds}轮)`
                    : `预计危 (${opt.predictedRounds}轮)`
                }</span>
                  </div>
                  <div class="v2-et-btn-sub">${opt.enabled ? opt.summary : opt.disabledReason ?? '当前不可用'}</div>
                </button>`
              )
              .join('')}
          </div>
        </div>
      `
      : '';

    this.sceneOverlayEl.innerHTML = `
      <div class="combat-hud-bar v2-combat-hero-hud">
        <div class="v2-combat-status-group">
          <span class="combat-pill">回合 <strong class="num">${this.liveCombatRound}/${sim.roundsCount}</strong></span>
          <span class="combat-pill v2-hp-pill">
            ${svgIcon('hull', 13)}
            <span class="v2-mini-bar"><span style="width:${hpPct}%"></span></span>
            <strong class="num">${this.liveCombatPlayerHp}/${run.maxHp}</strong>
          </span>
          <span class="combat-pill">${svgIcon('shield', 13)} <strong class="num">${this.liveCombatPlayerShield}</strong></span>
          <span class="combat-pill">${svgIcon('combat', 13)} 敌 <strong class="num">${this.liveCombatEnemiesAlive}</strong></span>
        </div>
        <div class="v2-combat-ctrl-group">
          <button type="button" class="btn btn-sm btn-ghost" id="v2-combat-peek-bay">${svgIcon('grid', 13)} 查看船舱</button>
          <button type="button" class="btn btn-sm btn-secondary" id="v2-combat-speed">${
            this.save.settings.combatSpeed
          }×</button>
          <button type="button" class="btn btn-sm btn-primary" id="v2-combat-skip" ${
            showDecisionBar ? 'disabled' : ''
          }>${showDecisionBar ? '等待指令' : '跳过演出'}</button>
        </div>
      </div>
      ${decisionHtml}
    `;

    this.sceneOverlayEl.querySelector('#v2-combat-peek-bay')?.addEventListener('click', () => {
      soundEngine.play('click');
      openV2CargoPeekModal(this.modalHostEl, run.bay, `参战配装 · ${V2_SHIPS[run.shipId].name}`);
    });
    this.sceneOverlayEl.querySelector('#v2-combat-speed')?.addEventListener('click', () => {
      const nextSpd = this.save.settings.combatSpeed === 1 ? 2 : 1;
      this.save = {
        ...this.save,
        settings: { ...this.save.settings, combatSpeed: nextSpd },
      };
      this.applySettingsEffects();
      this.persist();
      this.renderCombatPlaybackOverlay(run);
    });
    this.sceneOverlayEl.querySelector('#v2-combat-skip')?.addEventListener('click', () => {
      if (showDecisionBar) return;
      this.phaserHost?.skipCombatPlayback();
    });
    this.sceneOverlayEl.querySelectorAll<HTMLButtonElement>('[data-elite-tactic]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.canMutate() || !pending) return;
        const choice = btn.dataset.eliteTactic as V2EliteTacticChoice;
        const cur = this.getCurrentRun();
        if (!cur) return;
        const res = commitV2EliteTacticDecision(cur, pending.decisionId, choice);
        if (!res.ok) {
          this.showToast(res.error ?? '战术指令无效');
          return;
        }
        this.awaitingEliteDecision = false;
        this.activeCombatPlaybackKey = null; // Force seamless resume from Round 2
        this.setCurrentRun(res.run);
        soundEngine.play('energyLink');
        this.syncAll();
      });
    });
  }

  // --- WRECK 3-HOTSPOT SPATIAL OVERLAY (Anchored on event_wreck.webp!) ---

  private renderWreckHotspotOverlay(run: V2RunState, node: V2MapNode): void {
    const w = node.wreck;
    if (!w) return;
    const readOnly = this.isReadOnlyTab && !run.isShowcase;
    const peek = run.crewId === 'salvager';
    const armDef = getAnyV2ItemDef(w.armoryItem.definitionId);
    const cargoSummary = w.cargoItems
      .map((c) => `${getAnyV2ItemDef(c.definitionId)?.name ?? c.definitionId}(${c.fixedValue}¤)`)
      .join(' + ');
    const fuelGain = Math.min(w.reactorFuelGain ?? 2, run.maxFuel - run.fuel);
    const repairGain = Math.min(w.reactorRepairGain ?? 8, run.maxHp - run.hp);

    const sel = this.selectedWreckHotspot;

    let detailHtml = '';
    if (sel === 'armory') {
      detailHtml = `
        <div class="v2-wh-confirm-text">
          <strong>军械舱（1 件设备）</strong>
          <span>${
            peek && armDef
              ? `拆解专家透视：${armDef.name}（${w.armoryItem.quality === 'improved' ? '优良' : '普通'} · ${V2_SHAPES[armDef.shapeId].label} · 回收 ${w.armoryItem.fixedValue}¤）`
              : `预计占格 ${w.armorySizeRange} · ${w.armoryValueRange}`
          }</span>
        </div>
        <button type="button" class="btn btn-primary" data-cut-wreck="armory" ${
          readOnly ? 'disabled' : ''
        }>${svgIcon('cannon', 15)} 切开军械舱</button>
      `;
    } else if (sel === 'reactor') {
      detailHtml = `
        <div class="v2-wh-confirm-text">
          <strong>反应舱（深潜续航补给）</strong>
          <span>不占船舱格位：可抽取剩余燃料 +${w.reactorFuelGain ?? 2} 或应急抢修 +${w.reactorRepairGain ?? 8} 耐久</span>
        </div>
        <div class="v2-wh-reactor-btns">
          <button type="button" class="btn btn-primary" data-cut-wreck="reactor_fuel" ${
            readOnly || fuelGain <= 0 ? 'disabled' : ''
          }>${svgIcon('fuel', 14)} ${fuelGain > 0 ? `抽取 +${fuelGain} 燃料` : '燃料已满'}</button>
          <button type="button" class="btn btn-secondary" data-cut-wreck="reactor_repair" ${
            readOnly || repairGain <= 0 ? 'disabled' : ''
          }>${svgIcon('wrench', 14)} ${repairGain > 0 ? `抢修 +${repairGain} 耐久` : '耐久已满'}</button>
        </div>
      `;
    } else {
      detailHtml = `
        <div class="v2-wh-confirm-text">
          <strong>货舱（${w.cargoItems.length} 件货物）</strong>
          <span>${
            peek ? `拆解专家透视：${cargoSummary}` : `预计占格 ${w.cargoSizeRange} · ${w.cargoValueRange}`
          }</span>
        </div>
        <button type="button" class="btn btn-primary" data-cut-wreck="cargo" ${
          readOnly ? 'disabled' : ''
        }>${svgIcon('crate', 15)} 切开货舱</button>
      `;
    }

    this.sceneOverlayEl.innerHTML = `
      <div class="scene-stage-tag">${svgIcon('wreck', 13)} 第 ${node.layer} 层 · 漂流残骸（选择 1 处舱室切开）</div>

      <button type="button" class="v2-wreck-hotspot ${sel === 'armory' ? 'active' : ''}"
        style="left:22%;top:48%;" data-wreck-spot="armory" aria-pressed="${sel === 'armory'}">
        <span class="v2-hotspot-ring"></span>
        <span class="v2-hotspot-tag">${svgIcon('cannon', 13)} 军械舱</span>
      </button>

      <button type="button" class="v2-wreck-hotspot ${sel === 'reactor' ? 'active' : ''}"
        style="left:50%;top:46%;" data-wreck-spot="reactor" aria-pressed="${sel === 'reactor'}">
        <span class="v2-hotspot-ring"></span>
        <span class="v2-hotspot-tag">${svgIcon('fuel', 13)} 反应舱</span>
      </button>

      <button type="button" class="v2-wreck-hotspot ${sel === 'cargo' ? 'active' : ''}"
        style="left:79%;top:51%;" data-wreck-spot="cargo" aria-pressed="${sel === 'cargo'}">
        <span class="v2-hotspot-ring"></span>
        <span class="v2-hotspot-tag">${svgIcon('crate', 13)} 货舱</span>
      </button>

      <div class="v2-wreck-confirm-dock">
        ${detailHtml}
      </div>
    `;

    this.sceneOverlayEl.querySelectorAll<HTMLButtonElement>('[data-wreck-spot]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedWreckHotspot = btn.dataset.wreckSpot as 'armory' | 'reactor' | 'cargo';
        soundEngine.play('click');
        this.renderWreckHotspotOverlay(run, node);
      });
    });

    this.sceneOverlayEl.querySelectorAll<HTMLButtonElement>('[data-cut-wreck]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.canMutate()) return;
        const room = btn.dataset.cutWreck as V2WreckChoice;
        const spotCoords =
          room === 'armory' ? [0.22, 0.48] : room === 'cargo' ? [0.79, 0.51] : [0.5, 0.46];
        this.phaserHost?.triggerV2WreckCutFx(spotCoords[0], spotCoords[1]);
        const res = resolveV2WreckChoice(run, room, this.save.profile.unlockedFamilies);
        if (!res.ok) return this.showToast(res.error ?? '无法切割该舱室');
        this.setCurrentRun(res.run);
        soundEngine.play('place');
        this.syncAll();
      });
    });
  }

  // --- Main Panel Dispatcher ---

  private renderPanels(): void {
    const run = this.getCurrentRun();
    if (!run) {
      if (this.prepareDraft) {
        this.renderPreparePanels();
      } else {
        // Base Hero mode: Station canvas & overlay carry the full experience!
        this.leftPanelEl.innerHTML = '';
        this.rightPanelEl.innerHTML = '';
      }
      return;
    }

    switch (run.phase) {
      case 'MAP':
        this.renderMapPhase(run);
        break;
      case 'ENCOUNTER':
        this.renderEncounterPhase(run);
        break;
      case 'SHOP':
        this.renderShopPhase(run);
        break;
      case 'REWARD':
        this.renderRewardPhase(run);
        break;
      case 'ARRANGE':
        this.renderArrangePhase(run);
        break;
      case 'SETTLEMENT':
        this.renderSettlementPhase(run);
        break;
    }
  }

  // --- 2. PREPARE Panels (3 Trial Builds + Live Modular Ship + Custom Bay) ---

  private openPrepareForContract(contractTemplateId: string): void {
    const p = this.save.profile;
    const shipId = p.unlockedShips.includes(p.selectedShipId) ? p.selectedShipId : 'cannon_skiff';
    const crewId =
      p.selectedCrewId && p.unlockedCrew.includes(p.selectedCrewId)
        ? p.selectedCrewId
        : p.unlockedCrew[0] ?? null;
    const slots = [...buildFreeFallbackPrepareSlots(shipId, p.blueprints)];
    this.prepareDraft = {
      contractTemplateId,
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

  private renderPreparePanels(): void {
    const draft = this.prepareDraft;
    if (!draft) return;
    const p = this.save.profile;
    const readOnly = this.isReadOnlyTab;
    const contractTpl =
      V2_CONTRACT_TEMPLATES[draft.contractTemplateId] ?? V2_CONTRACT_TEMPLATES.free_salvage;
    const check = validateV2PrepareLoadout(
      p,
      draft.shipId,
      draft.crewId,
      draft.slots,
      draft.trialBuildId
    );
    const usedOwnedIds = new Set(check.ownedInstancesUsed);
    const previewBay = this.buildPreparePreviewBay(draft);

    this.leftPanelEl.innerHTML = `
      <div class="panel-header">
        <h2>出航整备 · ${contractTpl.name}</h2>
        <button type="button" class="btn btn-sm btn-ghost" id="v2-prep-back">← 返回基地</button>
      </div>

      <div class="v2-prep-group v2-trial-section">
        <div class="v2-prep-label-row">
          <span class="v2-prep-label">${svgIcon('bolt', 13)} 零门槛试航方案（一键试玩三大流派 + 实战微演示）</span>
          ${
            draft.trialBuildId
              ? `<button type="button" class="btn btn-sm btn-ghost" id="v2-trial-exit">切回自由配装</button>`
              : ''
          }
        </div>
        <div class="v2-trial-strip">
          ${V2_TRIAL_BUILD_ORDER.map((tid) => {
            const spec = V2_TRIAL_BUILDS[tid];
            const active = draft.trialBuildId === tid;
            const ico = tid === 'trial_heavy' ? 'cannon' : tid === 'trial_hangar' ? 'drone' : 'counter';
            return `<button type="button" class="v2-trial-mini-card ${active ? 'active' : ''}" data-pick-trial="${tid}" ${
              readOnly ? 'disabled' : ''
            }>
              <div class="v2-tm-head">${svgIcon(ico, 15)} <strong>${spec.shortName}</strong></div>
              <div class="v2-tm-pro">${spec.advantage}</div>
              <div class="v2-tm-con">${spec.tradeoff}</div>
            </button>`;
          }).join('')}
        </div>
      </div>

      <div class="v2-prep-group">
        <div class="v2-prep-label">舰船与船员</div>
        <div class="v2-ship-cards">
          ${V2_SHIP_ORDER.map((sid) => {
            const s = V2_SHIPS[sid];
            const unlocked = p.unlockedShips.includes(sid);
            const active = draft.shipId === sid;
            return `<button type="button" class="v2-choice-pill ${active ? 'active' : ''}" data-prep-ship="${sid}" ${
              !unlocked ? 'disabled' : ''
            }>
              <img class="v2-ship-mini" src="${getPlayerShipImageUrl(sid)}" alt="${s.name}" />
              <span class="v2-choice-main">
                <strong>${s.name}</strong>
                <small>${s.cols}×${s.rows} (${s.validCellCount}格) · HP ${s.maxHp} · 预算 ${s.loadoutBudget}${
              s.bonusShield > 0 ? ` · +${s.bonusShield}盾` : ''
            }${!unlocked ? ' · 未解锁' : ''}</small>
              </span>
            </button>`;
          }).join('')}
        </div>
        <div class="v2-crew-row" style="margin-top:6px;">
          ${V2_CREW_ORDER.map((cid) => {
            const c = V2_CREW[cid];
            const unlocked = p.unlockedCrew.includes(cid);
            const active = draft.crewId === cid;
            return `<button type="button" class="v2-crew-pill ${active ? 'active' : ''}" data-prep-crew="${cid}" ${
              !unlocked ? 'disabled' : ''
            }>
              <strong>${c.name}</strong>
              <small>${unlocked ? c.abilitySummary : c.unlockHint}</small>
            </button>`;
          }).join('')}
        </div>
      </div>

      <div class="v2-prep-group">
        <div class="v2-prep-label">航路支援倾向（第 2–4 层保底出现对应配件）</div>
        <div class="v2-arch-row">
          ${ARCHETYPE_ORDER.map((aid) => {
            const info = V2_ARCHETYPE_LABELS[aid];
            return `<button type="button" class="btn btn-sm ${
              draft.primaryArchetype === aid ? 'btn-primary' : 'btn-secondary'
            }" data-prep-arch="${aid}">${info.name}（${info.supportName}）</button>`;
          }).join('')}
        </div>
      </div>

      <div class="v2-prep-group">
        <div class="v2-prep-label-row">
          <span class="v2-prep-label">装配预算 <strong class="num">${check.totalBudget}/${
      check.maxBudget
    }</strong></span>
          <div style="display:flex;gap:6px;">
            <button type="button" class="btn btn-sm btn-ghost" id="v2-prep-fallback">标准配装</button>
            <button type="button" class="btn btn-sm btn-ghost" id="v2-prep-clear">清空</button>
          </div>
        </div>

        <div class="v2-pool-subtitle">永久蓝图借用（免费 · 返航归还）</div>
        <div class="v2-pool-chips">
          ${p.blueprints
            .map((kind) => {
              const def = getV2EquipmentDefByKind(kind, 'common');
              const overBudget = check.totalBudget + def.budgetCost > check.maxBudget;
              return `<button type="button" class="v2-pool-btn" data-add-loan="${def.defId}" ${
                overBudget || readOnly ? 'disabled' : ''
              }>
                <span class="v2-origin-badge origin-loan">借</span>
                <img src="${getItemImageUrl(def.defId)}" alt="${def.name}" />
                <span>${def.name}<small>${V2_SHAPES[def.shapeId].label} · 预算${def.budgetCost}</small></span>
              </button>`;
            })
            .join('')}
        </div>

        <div class="v2-pool-subtitle">仓库自有设备（${p.equipmentWarehouse.length} 件 · 战败将损失实物）</div>
        <div class="v2-pool-chips">
          ${
            p.equipmentWarehouse.length === 0
              ? `<span class="v2-empty-inline">设备库暂无自有设备（可返航入库或研究台制造）</span>`
              : p.equipmentWarehouse
                  .map((w) => {
                    const def = V2_EQUIPMENT_DEFS[w.definitionId];
                    if (!def) return '';
                    const alreadyUsed = usedOwnedIds.has(w.instanceId);
                    const overBudget = check.totalBudget + def.budgetCost > check.maxBudget;
                    return `<button type="button" class="v2-pool-btn origin-owned" data-add-owned="${
                      w.instanceId
                    }" ${alreadyUsed || overBudget || readOnly ? 'disabled' : ''}>
                      <span class="v2-origin-badge origin-owned">自</span>
                      <img src="${getItemImageUrl(w.definitionId)}" alt="${def.name}" />
                      <span>${def.name} <em class="v2-q-tag">${
                      w.quality === 'improved' ? '良' : '普'
                    }</em><small>${alreadyUsed ? '已装载' : `预算${def.budgetCost}`}</small></span>
                    </button>`;
                  })
                  .join('')
          }
        </div>
      </div>

      <div class="v2-prep-group v2-preset-box">
        <div class="v2-prep-label-row">
          <span class="v2-prep-label">配装预设 (${p.loadoutPresets.length}/${V2_MAX_SAVED_PRESETS})</span>
          <div style="display:flex;gap:6px;align-items:center;">
            <input type="text" id="v2-preset-name" class="v2-preset-input" maxlength="16" placeholder="预设名称" value="${
              V2_SHIPS[draft.shipId].name.slice(0, 4)
            }-${V2_ARCHETYPE_LABELS[draft.primaryArchetype].name.slice(0, 2)}" />
            <button type="button" class="btn btn-sm btn-secondary" id="v2-preset-save" ${
              readOnly || draft.slots.length === 0 ? 'disabled' : ''
            }>保存预设</button>
          </div>
        </div>
        ${
          draft.presetNotice
            ? `<div class="system-banner banner-warn" style="margin:6px 0;">
                <span>${draft.presetNotice}</span>
                ${
                  draft.missingPresetEntries.some((m) => m.canSubstituteCommonLoan)
                    ? `<button type="button" class="btn btn-sm btn-primary" id="v2-preset-sub-loan">用借用普通版补位</button>`
                    : ''
                }
              </div>`
            : ''
        }
        ${
          p.loadoutPresets.length > 0
            ? `<div class="v2-preset-list">
                ${p.loadoutPresets
                  .map(
                    (pr) => `<div class="v2-preset-item">
                      <span><strong>${pr.name}</strong> <small>(${V2_SHIPS[pr.shipId].name} · ${pr.slots.length}件)</small></span>
                      <div style="display:flex;gap:4px;">
                        <button type="button" class="btn btn-sm btn-secondary" data-load-preset="${pr.presetId}">载入</button>
                        <button type="button" class="btn btn-sm btn-ghost" data-del-preset="${pr.presetId}" ${
                      readOnly ? 'disabled' : ''
                    }>删</button>
                      </div>
                    </div>`
                  )
                  .join('')}
              </div>`
            : ''
        }
      </div>

      ${
        !check.valid
          ? `<div class="system-banner banner-danger" style="margin:6px 0;">${check.errors.join('；')}</div>`
          : ''
      }
      <button type="button" class="btn btn-primary btn-launch-hero" id="v2-btn-launch-run" ${
        readOnly || !check.valid ? 'disabled' : ''
      }>${svgIcon('rocket', 16)} 确认整备 · 启动远航</button>
    `;

    // Wire prepare controls
    this.leftPanelEl.querySelector('#v2-prep-back')?.addEventListener('click', () => {
      this.prepareDraft = null;
      soundEngine.play('click');
      this.syncAll();
    });

    this.leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-pick-trial]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tid = btn.dataset.pickTrial as V2TrialBuildId;
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
      });
    });

    this.leftPanelEl.querySelector('#v2-trial-exit')?.addEventListener('click', () => {
      draft.trialBuildId = null;
      draft.playingDemo = false;
      draft.demoPlaybackKey = null;
      draft.slots = [...buildFreeFallbackPrepareSlots(draft.shipId, p.blueprints)];
      soundEngine.play('click');
      this.syncAll();
    });

    this.leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-prep-ship]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextShip = btn.dataset.prepShip as V2ShipId;
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
      });
    });

    this.leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-prep-crew]').forEach((btn) => {
      btn.addEventListener('click', () => {
        draft.crewId = btn.dataset.prepCrew as V2CrewId;
        soundEngine.play('click');
        this.syncAll();
      });
    });

    this.leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-prep-arch]').forEach((btn) => {
      btn.addEventListener('click', () => {
        draft.primaryArchetype = btn.dataset.prepArch as V2ArchetypeId;
        soundEngine.play('click');
        this.syncAll();
      });
    });

    this.leftPanelEl.querySelector('#v2-prep-fallback')?.addEventListener('click', () => {
      draft.trialBuildId = null;
      draft.playingDemo = false;
      draft.demoPlaybackKey = null;
      draft.slots = [...buildFreeFallbackPrepareSlots(draft.shipId, p.blueprints)];
      draft.missingPresetEntries = [];
      draft.presetNotice = null;
      soundEngine.play('click');
      this.syncAll();
    });

    this.leftPanelEl.querySelector('#v2-prep-clear')?.addEventListener('click', () => {
      draft.trialBuildId = null;
      draft.playingDemo = false;
      draft.demoPlaybackKey = null;
      draft.slots = [];
      draft.missingPresetEntries = [];
      draft.presetNotice = null;
      soundEngine.play('click');
      this.syncAll();
    });

    this.leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-add-loan]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const defId = btn.dataset.addLoan!;
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
      });
    });

    this.leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-add-owned]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const instId = btn.dataset.addOwned!;
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
      });
    });

    this.leftPanelEl.querySelector('#v2-preset-save')?.addEventListener('click', () => {
      if (!this.canMutate()) return;
      const input = this.leftPanelEl.querySelector<HTMLInputElement>('#v2-preset-name');
      const name = input?.value.trim() || `预设 ${p.loadoutPresets.length + 1}`;
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
    });

    this.leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-load-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pr = p.loadoutPresets.find((item) => item.presetId === btn.dataset.loadPreset);
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
      });
    });

    this.leftPanelEl.querySelector('#v2-preset-sub-loan')?.addEventListener('click', () => {
      let tempBay = this.buildPreparePreviewBay(draft);
      const added: V2PrepareSlotEntry[] = [...draft.slots];
      for (const m of draft.missingPresetEntries) {
        if (!m.canSubstituteCommonLoan) continue;
        const origDef = V2_EQUIPMENT_DEFS[m.presetSlot.definitionId];
        if (!origDef) continue;
        const commonDef = getV2EquipmentDefByKind(origDef.kind, 'common');
        const spot = findFirstLegalV2Placement(tempBay, commonDef.defId);
        if (!spot) continue;
        const slotKey = `sub_${Date.now().toString(36)}_${added.length}`;
        added.push({
          slotKey,
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
    });

    this.leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-del-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.canMutate()) return;
        this.save = {
          ...this.save,
          profile: deleteV2LoadoutPreset(this.save.profile, btn.dataset.delPreset!),
        };
        this.persist();
        soundEngine.play('click');
        this.syncAll();
      });
    });

    this.leftPanelEl.querySelector('#v2-btn-launch-run')?.addEventListener('click', () => {
      if (!this.canMutate()) return;
      const res = launchV2Expedition({
        profile: this.save.profile,
        contractTemplateId: draft.contractTemplateId,
        shipId: draft.shipId,
        crewId: draft.crewId,
        primaryArchetype: draft.primaryArchetype,
        slots: draft.slots,
        trialBuildId: draft.trialBuildId,
      });
      if (!res.ok || !res.run) {
        this.showToast(res.errors.join('；') || '无法出航');
        return;
      }
      this.save = {
        ...this.save,
        profile: res.profile,
        activeRun: res.run,
      };
      this.prepareDraft = null;
      this.settlementDispositions = {};
      this.selectedMapNodeId = null;
      this.persist();
      soundEngine.play('warpJump');
      this.syncAll();
    });

    // Right Panel: Interactive Prepare Bay with live Modular Ship sync & Instant Tactical Delta!
    const shipMaxHp = V2_SHIPS[draft.shipId].maxHp;
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
      onPrepareRemove: (instanceId) => {
        draft.playingDemo = false;
        draft.demoPlaybackKey = null;
        draft.slots = draft.slots.filter(
          (s) => s.slotKey !== instanceId && s.warehouseInstanceId !== instanceId
        );
        this.syncAll();
      },
    });
  }

  // --- 3. MAP Phase (Unified Interactive Star Map — Zero Duplication!) ---

  private renderMapPhase(run: V2RunState): void {
    const readOnly = this.isReadOnlyTab && !run.isShowcase;
    const reachableIds = getReachableNextNodeIds(run);
    const fuelInfo = computeV2JumpFuelCost(run);
    const canJump = run.fuel >= fuelInfo.totalCost;

    // Auto-select first reachable node if current selection isn't valid
    if (!this.selectedMapNodeId || !reachableIds.includes(this.selectedMapNodeId)) {
      this.selectedMapNodeId = reachableIds[0] ?? null;
    }

    // Build unified interactive star map graph with connecting edges SVG!
    const layers = Array.from({ length: run.graph.maxLayers }, (_, i) => i + 1);
    const colW = 100 / layers.length;

    const nodeCoord = (layer: number, lane: 0 | 1) => ({
      x: (layer - 0.5) * colW,
      y: lane === 0 ? 28 : 74,
    });

    const edgeLines: string[] = [];
    for (const node of Object.values(run.graph.nodes)) {
      const from = nodeCoord(node.layer, node.lane);
      const isFromCurrent = run.currentNodeId === node.nodeId;
      for (const nxtId of node.nextNodeIds) {
        const target = run.graph.nodes[nxtId];
        if (!target) continue;
        const to = nodeCoord(target.layer, target.lane);
        const activeEdge = isFromCurrent && reachableIds.includes(nxtId);
        const visitedEdge =
          run.visitedNodeIds.includes(node.nodeId) && run.visitedNodeIds.includes(nxtId);
        const stroke = activeEdge ? '#F6B852' : visitedEdge ? '#62D6DF' : 'rgba(148,163,184,0.28)';
        const sw = activeEdge ? '1.3' : '0.8';
        edgeLines.push(
          `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${stroke}" stroke-width="${sw}" ${
            activeEdge ? '' : 'stroke-dasharray="2 2"'
          } />`
        );
      }
    }

    const layerColsHtml = layers
      .map((layer) => {
        const laneA = Object.values(run.graph.nodes).find((n) => n.layer === layer && n.lane === 0);
        const laneB = Object.values(run.graph.nodes).find((n) => n.layer === layer && n.lane === 1);
        const renderNodeBtn = (n?: V2MapNode) => {
          if (!n) return `<div class="v2-dag-spacer"></div>`;
          const meta = NODE_TYPE_META[n.type];
          const visited = run.visitedNodeIds.includes(n.nodeId);
          const isCur = run.currentNodeId === n.nodeId;
          const isNext = reachableIds.includes(n.nodeId);
          const isSelected = this.selectedMapNodeId === n.nodeId;
          return `<button type="button" class="v2-dag-node ${meta.cls} ${visited ? 'visited' : ''} ${
            isCur ? 'current' : ''
          } ${isNext ? 'reachable' : ''} ${isSelected ? 'selected' : ''}" data-select-node="${
            n.nodeId
          }" ${!isNext ? 'disabled' : ''} title="第${n.layer}层 ${meta.label}">
            <span class="v2-dag-icon">${svgIcon(meta.icon, 16)}</span>
            <span class="v2-dag-name">${meta.label}</span>
            ${n.contractMarker ? `<span class="v2-dag-star" aria-label="委托目标">${svgIcon('star', 11)}</span>` : ''}
            ${n.hasSupportGuarantee ? `<span class="v2-dag-sup">配</span>` : ''}
          </button>`;
        };
        return `
          <div class="v2-dag-col">
            <div class="v2-dag-layer-lbl">L${layer}</div>
            <div class="v2-dag-pair">
              ${renderNodeBtn(laneA)}
              ${renderNodeBtn(laneB)}
            </div>
          </div>
        `;
      })
      .join('');

    // Single sleek comparison card for the currently selected reachable node
    const selNode = this.selectedMapNodeId ? run.graph.nodes[this.selectedMapNodeId] : null;
    let selectedCardHtml = `<div class="v2-empty-hint">已抵达最深层，点击下方免费安全返航完成结算！</div>`;

    if (selNode) {
      const meta = NODE_TYPE_META[selNode.type];
      let forecastHtml = '';
      if (selNode.combat) {
        const pv = previewV2CombatNode(run, selNode.nodeId, run.targetPolicy);
        const unitBrief = selNode.combat.units
          .map((u) => `${u.name}(${u.maxHp}HP/${u.damagePerRound}攻${u.armor ? `/甲${u.armor}` : ''}${u.pierceRatio ? '/穿盾' : ''})`)
          .join(' + ');
        forecastHtml = `
          <div class="v2-map-combat-preview ${pv?.outcome === 'victory' ? 'ok' : 'risk'}">
            <span>${unitBrief}</span>
            <strong>${
              pv?.outcome === 'victory'
                ? `预计获胜 · 余 ${pv.finalPlayerHpAfterRepair} HP (${pv.roundsCount} 轮)`
                : `高危战败风险 (${pv?.roundsCount ?? '?'} 轮)`
            } · 赏金 +${selNode.combat.bounty}¤</strong>
          </div>
        `;
      } else if (selNode.type === 'wreck') {
        forecastHtml = `<div class="v2-map-event-hint">漂流残骸三热点：军械舱（设备）/ 反应舱（+2 燃料或 +8 耐久）/ 货舱（2 件货物）${
          run.crewId === 'salvager' ? ' · 拆解专家已透视全明细' : ''
        }</div>`;
      } else if (selNode.type === 'merchant') {
        forecastHtml = `<div class="v2-map-event-hint">2 件固定设备 / +2 燃料(12¤) / +10 耐久(15¤) / 变卖拾获物</div>`;
      } else if (selNode.type === 'anomaly') {
        forecastHtml = `<div class="v2-map-event-hint">安全穿越 (-1 燃料得 1 货) 或 强行切入 (-4 耐久得 2 货)</div>`;
      } else if (selNode.type === 'distress') {
        forecastHtml = `<div class="v2-map-event-hint">施救船员 (-1 燃料回 10 耐久) 或 免费打捞高价货物</div>`;
      }

      // Also provide quick switch pills if 2 nodes are reachable (great for 1-tap mobile & comparison!)
      const quickTabs =
        reachableIds.length > 1
          ? `<div class="v2-map-switch-row">
              ${reachableIds
                .map((rid) => {
                  const rn = run.graph.nodes[rid];
                  if (!rn) return '';
                  const rm = NODE_TYPE_META[rn.type];
                  return `<button type="button" class="v2-map-tab-pill ${
                    rid === selNode.nodeId ? 'active' : ''
                  }" data-select-node="${rid}">${svgIcon(rm.icon, 13)} ${
                    rn.lane === 0 ? 'A线' : 'B线'
                  }·${rm.label}${rn.contractMarker ? ' ★' : ''}</button>`;
                })
                .join('')}
            </div>`
          : '';

      selectedCardHtml = `
        ${quickTabs}
        <div class="v2-next-node-card ${meta.cls} ${selNode.contractMarker ? 'is-contract' : ''}">
          <div class="v2-next-node-head">
            <span class="v2-node-title">${svgIcon(meta.icon, 16)} 第 ${selNode.layer} 层 ${
        selNode.lane === 0 ? 'A线' : 'B线'
      } · ${meta.label}</span>
            <span class="v2-fuel-tag ${canJump ? '' : 'no-fuel'}">${svgIcon('fuel', 13)} 耗油 ${
        fuelInfo.totalCost
      }</span>
          </div>
          <div class="v2-node-badges">
            ${selNode.contractMarker ? `<span class="v2-badge-contract">${svgIcon('star', 11)} 委托目标</span>` : ''}
            ${
              selNode.hasSupportGuarantee
                ? `<span class="v2-badge-support">${V2_ARCHETYPE_LABELS[run.primaryArchetype].supportName}保底</span>`
                : ''
            }
            ${fuelInfo.navigatorDiscountApplied ? `<span class="v2-badge-info">领航员首跳省油</span>` : ''}
            ${fuelInfo.rescueSurcharge > 0 ? `<span class="v2-badge-warn">救生舱负载 +1 油</span>` : ''}
          </div>
          ${forecastHtml}
          <button type="button" class="btn btn-primary btn-launch-hero" data-jump-node="${
            selNode.nodeId
          }" ${readOnly || !canJump ? 'disabled' : ''}>${
        canJump
          ? `${svgIcon('rocket', 15)} 跃迁至第 ${selNode.layer} 层 · ${meta.label}`
          : '燃料不足 · 请免费安全返航'
      }</button>
        </div>
      `;
    }

    const canAbort =
      run.contract.status === 'active' &&
      run.contract.type !== 'free' &&
      !run.isTutorial &&
      !isContractReadyForDelivery(run, 'safe_return');

    this.leftPanelEl.innerHTML = `
      <div class="panel-header">
        <h2>${svgIcon('radar', 16)} 星际航路 · ${run.contract.name}</h2>
        <span class="panel-sub">航行钱包 <strong class="num">${run.wallet}¤</strong></span>
      </div>

      <div class="v2-dag-box v2-dag-hero">
        <div class="v2-dag-scroll">
          <div class="v2-dag-stage">
            <svg class="v2-dag-edges-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              ${edgeLines.join('')}
            </svg>
            <div class="v2-dag-grid">${layerColsHtml}</div>
          </div>
        </div>
      </div>

      <div class="v2-selected-node-deck">${selectedCardHtml}</div>

      <div class="v2-map-footer-actions">
        <button type="button" class="btn btn-secondary" id="v2-btn-safe-return" ${
          readOnly ? 'disabled' : ''
        }>${svgIcon('beacon', 14)} 免费安全返航</button>
        ${
          canAbort
            ? `<button type="button" class="btn btn-ghost" id="v2-btn-abort-contract" ${
                readOnly ? 'disabled' : ''
              }>放弃当前委托</button>`
            : ''
        }
      </div>
    `;

    this.leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-select-node]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nid = btn.dataset.selectNode!;
        if (!reachableIds.includes(nid)) return;
        this.selectedMapNodeId = nid;
        soundEngine.play('click');
        this.renderMapPhase(run);
      });
    });

    this.leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-jump-node]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.canMutate()) return;
        const nid = btn.dataset.jumpNode!;
        const res = selectV2MapNode(run, nid);
        if (!res.ok) {
          this.showToast(res.error ?? '无法跃迁至该节点');
          return;
        }
        this.selectedMapNodeId = null;
        this.selectedWreckHotspot = 'armory';
        this.setCurrentRun(res.run);
        soundEngine.play('warpJump');
        this.syncAll();
      });
    });

    this.leftPanelEl.querySelector('#v2-btn-safe-return')?.addEventListener('click', () => {
      if (!this.canMutate()) return;
      const res = initiateV2SafeReturnFromMap(run);
      if (!res.ok) return this.showToast(res.error ?? '当前无法返航');
      this.settlementDispositions = {};
      this.setCurrentRun(res.run);
      soundEngine.play('returnDock');
      this.syncAll();
    });

    this.leftPanelEl.querySelector('#v2-btn-abort-contract')?.addEventListener('click', () => {
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
    });

    this.mountV2CargoBay(run.bay, false, {
      title: `当前船舱 · ${V2_SHIPS[run.shipId].name}`,
      statusBadge: '航行中',
    });
  }

  // --- 4. ENCOUNTER Phase (Combat Hero / Wreck 3-Hotspot / Anomaly / Distress) ---

  private renderEncounterPhase(run: V2RunState): void {
    const node = run.currentNodeId ? run.graph.nodes[run.currentNodeId] : null;
    if (!node) return;
    const readOnly = this.isReadOnlyTab && !run.isShowcase;

    // 4a. Combat / Elite Node
    if (node.combat) {
      if (run.activeCombat) {
        // Live combat hero mode: Battlefield fills 72%+ of screen, cargo grid collapsed into modal button!
        this.leftPanelEl.innerHTML = '';
        this.rightPanelEl.innerHTML = '';
        return;
      }

      // Pre-combat compact tactical bar
      const pv = previewV2CombatNode(run, node.nodeId, run.targetPolicy);
      const isEliteWithTactic =
        node.type === 'elite' && Boolean(this.save.settings.eliteTacticExperiment);

      this.leftPanelEl.innerHTML = `
        <div class="panel-header">
          <h2>${svgIcon(NODE_TYPE_META[node.type].icon, 16)} 第 ${node.layer} 层 · ${NODE_TYPE_META[node.type].label}</h2>
          <span class="panel-sub">击破赏金 <strong class="num">+${node.combat.bounty}¤</strong></span>
        </div>

        <div class="v2-enemy-roster">
          ${node.combat.units
            .map(
              (u) => `<div class="v2-enemy-chip ${u.isBoss ? 'is-boss' : ''}">
                <strong>${u.name}</strong>
                <span>HP ${u.maxHp} · 攻 ${u.damagePerRound}${u.armor > 0 ? ` · 甲 ${u.armor}` : ''}${
                u.pierceRatio > 0 ? ` · 穿盾 ${Math.round(u.pierceRatio * 100)}%` : ''
              }</span>
              </div>`
            )
            .join('')}
        </div>

        <div class="v2-policy-box">
          <span class="v2-prep-label">集火策略</span>
          <div style="display:flex;gap:8px;margin-top:6px;">
            <button type="button" class="btn btn-sm ${
              run.targetPolicy === 'weakest' ? 'btn-primary' : 'btn-secondary'
            }" data-policy="weakest" ${readOnly ? 'disabled' : ''}>优先最弱</button>
            <button type="button" class="btn btn-sm ${
              run.targetPolicy === 'highest_threat' ? 'btn-primary' : 'btn-secondary'
            }" data-policy="highest_threat" ${readOnly ? 'disabled' : ''}>优先最大威胁</button>
          </div>
        </div>

        ${
          pv
            ? `<div class="v2-combat-preview-card ${pv.outcome === 'victory' ? 'ok' : 'danger'}">
                <div class="v2-cp-head">
                  <strong>${pv.outcome === 'victory' ? '战果预估：获胜' : '战果预估：有战败风险'}</strong>
                  <span class="num">${pv.roundsCount} 回合</span>
                </div>
                <div class="v2-cp-body">
                  耐久 ${pv.startingPlayerHp} · 护盾 ${pv.startingPlayerShield} → 战后 <strong>${
                pv.finalPlayerHpAfterRepair
              }</strong>${pv.repairApplied > 0 ? `（含维修 +${pv.repairApplied}）` : ''}
                  ${isEliteWithTactic ? ' · <strong>第 2 回合可发战术指令</strong>' : ''}
                </div>
                <button type="button" class="btn btn-sm btn-ghost" id="v2-toggle-log" style="margin-top:4px;">${
                  this.showCombatLogDetails ? '收起回合推演' : '查看回合推演'
                }</button>
                ${
                  this.showCombatLogDetails
                    ? `<div class="v2-combat-log-list">
                        ${pv.rounds
                          .slice(0, 10)
                          .map(
                            (r) => `<div class="v2-log-row">R${r.round}: 我方 ${
                              r.playerAttacks.reduce((s, a) => s + a.appliedDamage, 0)
                            }伤${r.counterAttack ? `+反击${r.counterAttack.appliedDamage}` : ''} · 敌方 ${
                              r.enemyAttacks.reduce((s, a) => s + a.hullDamage, 0)
                            }直伤(盾吸${r.shieldAbsorbedTotal}) → ${r.playerHpAfter}HP</div>`
                          )
                          .join('')}
                      </div>`
                    : ''
                }
              </div>`
            : ''
        }

        <button type="button" class="btn btn-primary btn-launch-hero" id="v2-btn-start-combat" ${
          readOnly ? 'disabled' : ''
        }>${svgIcon('combat', 16)} 开始交火</button>
      `;

      this.leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-policy]').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (!this.canMutate()) return;
          const policy = btn.dataset.policy as V2TargetPolicy;
          this.setCurrentRun({ ...run, targetPolicy: policy });
          soundEngine.play('click');
          this.syncAll();
        });
      });

      this.leftPanelEl.querySelector('#v2-toggle-log')?.addEventListener('click', () => {
        this.showCombatLogDetails = !this.showCombatLogDetails;
        this.renderEncounterPhase(run);
      });

      this.leftPanelEl.querySelector('#v2-btn-start-combat')?.addEventListener('click', () => {
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
      });

      this.mountV2CargoBay(run.bay, false, {
        title: `参战船舱 · ${V2_SHIPS[run.shipId].name}`,
        statusBadge: '战前锁定',
      });
      return;
    }

    // 4b. Wreck 3-Hotspot Hero Mode (Main choice happens directly on the wreck image!)
    if (node.type === 'wreck' && node.wreck) {
      this.leftPanelEl.innerHTML = `
        <div class="panel-header">
          <h2>${svgIcon('wreck', 16)} 废船打捞 · 空间与续航抉择</h2>
          <button type="button" class="btn btn-sm btn-ghost" id="v2-btn-abandon-event" ${
            readOnly ? 'disabled' : ''
          }>放弃并返航</button>
        </div>
        <div class="v2-empty-hint">
          直接在上方残骸画面中点击<strong>军械舱</strong>、<strong>反应舱</strong>或<strong>货舱</strong>切开对应舱室（只能选一处）。
        </div>
      `;
      this.leftPanelEl.querySelector('#v2-btn-abandon-event')?.addEventListener('click', () => {
        if (!this.canMutate()) return;
        const res = abandonV2EventAndReturn(run);
        if (!res.ok) return this.showToast(res.error ?? '无法放弃返航');
        this.settlementDispositions = {};
        this.setCurrentRun(res.run);
        soundEngine.play('returnDock');
        this.syncAll();
      });
      this.mountV2CargoBay(run.bay, false, { title: '当前船舱参考', statusBadge: '参考空位' });
      return;
    }

    // 4c. Anomaly / Distress Non-Combat Events
    const unaffordable = areAllEventOptionsUnaffordable(run);
    let eventBodyHtml = '';

    if (node.type === 'anomaly' && node.anomaly) {
      const a = node.anomaly;
      const canTraverse = run.fuel >= a.safeFuelCost;
      const canBreach = run.hp > a.breachHpCost;
      eventBodyHtml = `
        <div class="v2-event-desc">电离云团中漂浮着稀有 ${a.cargoCategoryLabel} 信号。选择平稳穿越或顶着电弧硬闯：</div>
        <div class="v2-event-choices">
          <div class="v2-event-choice-card">
            <div class="v2-ec-title">${svgIcon('fuel', 15)} 安全穿越（耗 ${a.safeFuelCost} 燃料）</div>
            <div class="v2-ec-meta">无损获取 1 件高价货物（${
              getAnyV2ItemDef(a.safeCargoItem.definitionId)?.name ?? '货物'
            } · ${a.safeCargoItem.fixedValue}¤）</div>
            <button type="button" class="btn btn-primary" data-anomaly-opt="traverse" ${
              readOnly || !canTraverse ? 'disabled' : ''
            }>${canTraverse ? `耗 ${a.safeFuelCost} 燃料穿越` : '燃料不足'}</button>
          </div>
          <div class="v2-event-choice-card">
            <div class="v2-ec-title">${svgIcon('bolt', 15)} 强行破入（扣 ${a.breachHpCost} 耐久）</div>
            <div class="v2-ec-meta">不耗燃料，直接带走 2 件货物（共 ${a.breachCargoItems.reduce(
              (s, c) => s + c.fixedValue,
              0
            )}¤）</div>
            <button type="button" class="btn btn-danger" data-anomaly-opt="breach" ${
              readOnly || !canBreach ? 'disabled' : ''
            }>${canBreach ? `硬闯破入 (-${a.breachHpCost} HP)` : `耐久需 > ${a.breachHpCost}`}</button>
          </div>
        </div>
      `;
    } else if (node.type === 'distress' && node.distress) {
      const d = node.distress;
      const canRescue = run.fuel >= d.rescueFuelCost;
      eventBodyHtml = `
        <div class="v2-event-desc">收到近轨道民船求救信标。可耗油施救换取现场抢修，或直接打捞漂散货箱：</div>
        <div class="v2-event-choices">
          <div class="v2-event-choice-card">
            <div class="v2-ec-title">${svgIcon('wrench', 15)} 救援遇险船员（耗 ${d.rescueFuelCost} 燃料）</div>
            <div class="v2-ec-meta">立即抢修恢复 <strong>+${d.repairAmount} 耐久</strong>（不超过上限）</div>
            <button type="button" class="btn btn-primary" data-distress-opt="rescue_crew" ${
              readOnly || !canRescue ? 'disabled' : ''
            }>${canRescue ? `施救 (-${d.rescueFuelCost} 油 · +${d.repairAmount} HP)` : '燃料不足'}</button>
          </div>
          <div class="v2-event-choice-card">
            <div class="v2-ec-title">${svgIcon('crate', 15)} 打捞高价货舱（0 燃料）</div>
            <div class="v2-ec-meta">带走 1 件高价货物（${
              getAnyV2ItemDef(d.haulCargoItem.definitionId)?.name ?? '货物'
            } · ${d.haulCargoItem.fixedValue}¤）</div>
            <button type="button" class="btn btn-secondary" data-distress-opt="haul_cargo" ${
              readOnly ? 'disabled' : ''
            }>打捞货舱</button>
          </div>
        </div>
      `;
    }

    this.leftPanelEl.innerHTML = `
      <div class="panel-header">
        <h2>${svgIcon(NODE_TYPE_META[node.type].icon, 16)} 第 ${node.layer} 层 · ${NODE_TYPE_META[node.type].label}</h2>
        <span class="panel-sub">星区事件</span>
      </div>
      ${eventBodyHtml}
      ${
        unaffordable
          ? `<div class="system-banner banner-warn" style="margin-top:10px;">
              <span>当前资源不足以支付任何选项，可放弃事件并免费返航。</span>
              <button type="button" class="btn btn-sm btn-primary" id="v2-btn-abandon-event" ${
                readOnly ? 'disabled' : ''
              }>放弃并安全返航</button>
            </div>`
          : `<div style="margin-top:10px;display:flex;justify-content:flex-end;">
              <button type="button" class="btn btn-sm btn-ghost" id="v2-btn-abandon-event" ${
                readOnly ? 'disabled' : ''
              }>放弃事件并免费返航</button>
            </div>`
      }
    `;

    this.leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-anomaly-opt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.canMutate()) return;
        const res = resolveV2AnomalyChoice(run, btn.dataset.anomalyOpt as 'traverse' | 'breach');
        if (!res.ok) return this.showToast(res.error ?? '操作失败');
        this.setCurrentRun(res.run);
        soundEngine.play('place');
        this.syncAll();
      });
    });

    this.leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-distress-opt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.canMutate()) return;
        const res = resolveV2DistressChoice(
          run,
          btn.dataset.distressOpt as 'rescue_crew' | 'haul_cargo'
        );
        if (!res.ok) return this.showToast(res.error ?? '操作失败');
        this.setCurrentRun(res.run);
        soundEngine.play('place');
        this.syncAll();
      });
    });

    this.leftPanelEl.querySelector('#v2-btn-abandon-event')?.addEventListener('click', () => {
      if (!this.canMutate()) return;
      const res = abandonV2EventAndReturn(run);
      if (!res.ok) return this.showToast(res.error ?? '无法放弃返航');
      this.settlementDispositions = {};
      this.setCurrentRun(res.run);
      soundEngine.play('returnDock');
      this.syncAll();
    });

    this.mountV2CargoBay(run.bay, false, { title: '当前船舱一览', statusBadge: '参考空位' });
  }

  // --- 5. SHOP Phase (Mobile Merchant) ---

  private renderShopPhase(run: V2RunState): void {
    const node = run.currentNodeId ? run.graph.nodes[run.currentNodeId] : null;
    const shop = node?.merchant;
    if (!node || !shop) return;
    const readOnly = this.isReadOnlyTab && !run.isShowcase;

    const sellableLoot = [
      ...run.bay.placed.map((p) => p.item),
      ...run.bay.staging.map((s) => s.item),
    ].filter((it) => it.origin === 'loot');

    this.leftPanelEl.innerHTML = `
      <div class="panel-header">
        <h2>${svgIcon('merchant', 16)} 流动商人补给站</h2>
        <span class="panel-sub">航行钱包 <strong class="num">${run.wallet}¤</strong></span>
      </div>

      <div class="v2-shop-section">
        <div class="v2-prep-label">限购设备</div>
        <div class="v2-shop-offers">
          ${shop.offers
            .map((off) => {
              const def = V2_EQUIPMENT_DEFS[off.item.definitionId];
              const canBuy = !off.sold && run.wallet >= off.buyPrice;
              return `<div class="v2-shop-card ${off.sold ? 'sold' : ''}">
                <img class="v2-wh-icon" src="${getItemImageUrl(off.item.definitionId)}" alt="${def?.name ?? ''}" />
                <div class="v2-wh-info">
                  <div class="v2-wh-name">${def?.name ?? off.item.definitionId} <span class="v2-quality-chip ${
                off.item.quality
              }">${off.item.quality === 'improved' ? '优良' : '普通'}</span></div>
                  <div class="v2-wh-sub">${
                    def ? `${renderV2MiniMaskHtml(def.shapeId)} ${def.summary}` : ''
                  }</div>
                </div>
                <button type="button" class="btn btn-sm btn-primary" data-buy-offer="${off.offerId}" ${
                readOnly || !canBuy ? 'disabled' : ''
              }>${off.sold ? '已购' : `购买 ${off.buyPrice}¤`}</button>
              </div>`;
            })
            .join('')}
        </div>
      </div>

      <div class="v2-shop-section">
        <div class="v2-prep-label">航行补给（每项限购 1 次）</div>
        <div class="v2-shop-supplies">
          <button type="button" class="btn btn-sm btn-secondary" id="v2-shop-fuel" ${
            readOnly || shop.fuelBought || run.wallet < shop.fuelPrice || run.fuel >= run.maxFuel
              ? 'disabled'
              : ''
          }>${svgIcon('fuel', 13)} 燃料 +${shop.fuelAmount}（${shop.fuelBought ? '已购' : `${shop.fuelPrice}¤`}）</button>
          <button type="button" class="btn btn-sm btn-secondary" id="v2-shop-repair" ${
            readOnly || shop.repairBought || run.wallet < shop.repairPrice || run.hp >= run.maxHp
              ? 'disabled'
              : ''
          }>${svgIcon('wrench', 13)} 维修 +${shop.repairAmount} HP（${shop.repairBought ? '已购' : `${shop.repairPrice}¤`}）</button>
        </div>
      </div>

      <div class="v2-shop-section">
        <div class="v2-prep-label">向商人变卖拾获物（80% 折价收购）</div>
        ${
          sellableLoot.length === 0
            ? `<div class="v2-empty-inline">当前舱内无拾获物可向商人出售。</div>`
            : `<div class="v2-shop-sell-list">
                ${sellableLoot
                  .map((it) => {
                    const def = getAnyV2ItemDef(it.definitionId);
                    const buyback = getMerchantBuybackPrice(it.fixedValue);
                    return `<div class="v2-shop-sell-row">
                      <span><span class="v2-origin-badge origin-loot">拾</span> ${
                        def?.name ?? it.definitionId
                      } <small>(原值 ${it.fixedValue}¤)</small></span>
                      <button type="button" class="btn btn-sm btn-ghost" data-sell-loot="${it.instanceId}" ${
                      readOnly ? 'disabled' : ''
                    }>卖出 +${buyback}¤</button>
                    </div>`;
                  })
                  .join('')}
              </div>`
        }
      </div>

      <button type="button" class="btn btn-primary btn-launch-hero" id="v2-shop-finish" ${
        readOnly ? 'disabled' : ''
      }>完成交易 · 整理船舱</button>
    `;

    this.leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-buy-offer]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.canMutate()) return;
        const oid = btn.dataset.buyOffer!;
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
      });
    });

    this.leftPanelEl.querySelector('#v2-shop-fuel')?.addEventListener('click', () => {
      if (!this.canMutate()) return;
      const res = buyV2MerchantFuel(run, `tx_fuel_${node.nodeId}`);
      if (!res.ok) return this.showToast(res.error ?? '无法购买燃料');
      this.setCurrentRun(res.run);
      soundEngine.play('click');
      this.syncAll();
    });

    this.leftPanelEl.querySelector('#v2-shop-repair')?.addEventListener('click', () => {
      if (!this.canMutate()) return;
      const res = buyV2MerchantRepair(run, `tx_repair_${node.nodeId}`);
      if (!res.ok) return this.showToast(res.error ?? '无法购买维修');
      this.setCurrentRun(res.run);
      soundEngine.play('click');
      this.syncAll();
    });

    this.leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-sell-loot]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.canMutate()) return;
        const iid = btn.dataset.sellLoot!;
        const res = sellV2ItemToMerchant(run, iid, `tx_sell_${node.nodeId}_${iid}`);
        if (!res.ok) return this.showToast(res.error ?? '出售失败');
        this.setCurrentRun(res.run);
        soundEngine.play('click');
        this.syncAll();
      });
    });

    this.leftPanelEl.querySelector('#v2-shop-finish')?.addEventListener('click', () => {
      if (!this.canMutate()) return;
      const res = finishV2MerchantVisit(run);
      if (!res.ok) return this.showToast(res.error ?? '无法离开商人节点');
      this.setCurrentRun(res.run);
      soundEngine.play('click');
      this.syncAll();
    });

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

  // --- 6. REWARD Phase (Post-Combat 3-Choice Salvage with Build Motivation!) ---

  private renderRewardPhase(run: V2RunState): void {
    const bundle = run.pendingReward;
    if (!bundle) return;
    const readOnly = this.isReadOnlyTab && !run.isShowcase;
    const eqDef = V2_EQUIPMENT_DEFS[bundle.equipmentOption.definitionId];
    const cargoDef = getAnyV2ItemDef(bundle.cargoOption.definitionId);

    // Quick simulated tactical delta for the equipment option so player sees WHY taking it changes next fight!
    const eqDelta = computeV2PlacementTacticalDelta({
      run,
      bay: run.bay,
      startingHp: run.hp,
      maxHp: run.maxHp,
      targetPolicy: run.targetPolicy,
      item: bundle.equipmentOption,
      zone: 'staging',
    });

    this.leftPanelEl.innerHTML = `
      <div class="panel-header">
        <h2>${svgIcon('star', 16)} 战斗胜利 · 3 选 1 战利品</h2>
        <span class="panel-sub">航行钱包 <strong class="num">${run.wallet}¤</strong></span>
      </div>

      <div class="v2-reward-cards">
        <button type="button" class="v2-reward-card" data-pick-reward="equipment" ${
          readOnly ? 'disabled' : ''
        }>
          <img class="v2-reward-img" src="${getItemImageUrl(bundle.equipmentOption.definitionId)}" alt="${eqDef?.name ?? ''}" />
          <div class="v2-reward-info">
            <div class="v2-reward-title">设备：${eqDef?.name ?? bundle.equipmentOption.definitionId} <span class="v2-quality-chip ${
      bundle.equipmentOption.quality
    }">${bundle.equipmentOption.quality === 'improved' ? '优良' : '普通'}</span></div>
            <div class="v2-reward-sub">${
              eqDef ? `${renderV2MiniMaskHtml(eqDef.shapeId)} ${V2_SHAPES[eqDef.shapeId].label} · ${eqDelta.synergyLine}` : ''
            }</div>
            <div class="v2-reward-val">${eqDelta.combatDeltaLine}</div>
          </div>
        </button>

        <button type="button" class="v2-reward-card" data-pick-reward="cargo" ${
          readOnly ? 'disabled' : ''
        }>
          <img class="v2-reward-img" src="${getItemImageUrl(bundle.cargoOption.definitionId)}" alt="${cargoDef?.name ?? ''}" />
          <div class="v2-reward-info">
            <div class="v2-reward-title">货物：${cargoDef?.name ?? bundle.cargoOption.definitionId}</div>
            <div class="v2-reward-sub">${
              cargoDef ? `${renderV2MiniMaskHtml(cargoDef.shapeId)} ${V2_SHAPES[cargoDef.shapeId].label} · ${cargoDef.summary}` : ''
            }</div>
            <div class="v2-reward-val">返航售价 <strong>+${bundle.cargoOption.fixedValue}¤</strong></div>
          </div>
        </button>

        <button type="button" class="v2-reward-card" data-pick-reward="repair" ${
          readOnly ? 'disabled' : ''
        }>
          <div class="v2-reward-repair-icon">${svgIcon('wrench', 24)}</div>
          <div class="v2-reward-info">
            <div class="v2-reward-title">战地抢修：恢复 +${bundle.repairAmount} 耐久</div>
            <div class="v2-reward-sub">当前耐久 ${run.hp}/${run.maxHp} · 不占船舱格位</div>
            <div class="v2-reward-val">保住血线继续向深层推进</div>
          </div>
        </button>
      </div>
    `;

    this.leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-pick-reward]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.canMutate()) return;
        const choice = btn.dataset.pickReward as 'equipment' | 'cargo' | 'repair';
        const res = pickV2CombatReward(run, choice, this.save.profile.unlockedFamilies);
        if (!res.ok) return this.showToast(res.error ?? '领取奖励失败');
        this.setCurrentRun(res.run);
        soundEngine.play('place');
        this.syncAll();
      });
    });

    this.mountV2CargoBay(run.bay, false, { title: '当前船舱参考', statusBadge: '参考空位' });
  }

  // --- 7. ARRANGE Phase (Cargo Board Hero + Instant Tactical Delta + Modular Exterior!) ---

  private renderArrangePhase(run: V2RunState): void {
    const readOnly = this.isReadOnlyTab && !run.isShowcase;
    const surveyCheck = canPerformSurveyAtCurrentNode(run);
    const terminal = isAtTerminalLayer(run);
    const hasStaging = run.bay.staging.length > 0;
    const engOffer =
      run.activeEngineerOffer && !run.activeEngineerOffer.used ? run.activeEngineerOffer : null;
    const currentLayer = run.currentNodeId ? run.graph.nodes[run.currentNodeId]?.layer ?? 0 : 0;
    const canAbort =
      run.contract.status === 'active' &&
      run.contract.type !== 'free' &&
      (!run.isTutorial || currentLayer >= 3) &&
      !isContractReadyForDelivery(run, 'safe_return');

    const hasMissionInStaging = run.bay.staging.some((s) => s.item.origin === 'mission');
    const goalLine = hasMissionInStaging
      ? '委托大件在暂存区：请腾出对应连续格位装舱，或放弃委托带货返航'
      : hasStaging
      ? `暂存区还有 ${run.bay.staging.length} 件待处理，点选即可查看下一战收益差值`
      : '船舱整理就绪 · 调整相邻位置可立即点亮联动并同步更新舰体外挂';

    this.leftPanelEl.innerHTML = `
      <div class="panel-header">
        <h2>${svgIcon('grid', 16)} 船舱整理</h2>
        <span class="panel-sub">${hasStaging ? `待处理 ${run.bay.staging.length} 件` : '已清空暂存区'}</span>
      </div>

      <div class="v2-arrange-goal-strip ${hasMissionInStaging ? 'is-mission' : ''}">
        ${goalLine}
      </div>

      ${
        engOffer
          ? `<div class="v2-engineer-banner">
              <div class="v2-eng-title">${svgIcon('swap', 14)} 工程师现场改装（每趟 1 次）</div>
              <div class="v2-eng-btns">
                ${engOffer.candidates
                  .map((kind) => {
                    const def = getV2EquipmentDefByKind(kind, 'common');
                    return `<button type="button" class="btn btn-sm btn-secondary" data-eng-swap="${kind}" ${
                      readOnly ? 'disabled' : ''
                    }>改为 ${def.name} (${V2_SHAPES[def.shapeId].label})</button>`;
                  })
                  .join('')}
              </div>
            </div>`
          : ''
      }

      ${
        surveyCheck.canSurvey
          ? `<div class="v2-survey-banner">
              <div>
                <strong>${svgIcon('radar', 14)} 委托勘测点</strong>
                <div style="font-size:12px;color:var(--text-secondary);">消耗 ${run.contract.surveyFuelCost} 燃料完成测绘（${run.contract.completedNodeIds.length}/${run.contract.requiredCompletions}）</div>
              </div>
              <button type="button" class="btn btn-sm btn-primary" id="v2-btn-survey-scan" ${
                readOnly ? 'disabled' : ''
              }>执行勘测 (-${run.contract.surveyFuelCost} 油)</button>
            </div>`
          : ''
      }

      <div class="v2-arrange-actions">
        <button type="button" class="btn btn-primary btn-launch-hero" id="v2-btn-leave-arrange" ${
          readOnly || hasStaging ? 'disabled' : ''
        }>${
      hasStaging
        ? '请先放置或舍弃暂存区物品'
        : terminal
        ? `${svgIcon('beacon', 15)} 抵达终层 · 进入返航结算`
        : `${svgIcon('rocket', 15)} 整理完毕 · 返回航路`
    }</button>
        ${
          canAbort
            ? `<button type="button" class="btn btn-sm btn-ghost" id="v2-arrange-abort" ${
                readOnly ? 'disabled' : ''
              }>放弃当前委托</button>`
            : ''
        }
      </div>
    `;

    this.leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-eng-swap]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.canMutate()) return;
        const kind = btn.dataset.engSwap as V2EquipmentKind;
        const res = applyV2EngineerSwap(run, kind);
        if (!res.ok) return this.showToast(res.error ?? '改装失败');
        this.setCurrentRun(res.run);
        soundEngine.play('place');
        this.showToast(`工程师已改装为「${getV2EquipmentDefByKind(kind, 'common').name}」。`);
        this.syncAll();
      });
    });

    this.leftPanelEl.querySelector('#v2-btn-survey-scan')?.addEventListener('click', () => {
      if (!this.canMutate()) return;
      const res = performSurveyAtCurrentNode(run);
      if (!res.ok) return this.showToast(res.reason ?? '无法执行勘测');
      this.setCurrentRun(res.run);
      soundEngine.play('energyLink');
      this.showToast('航迹勘测完成！');
      this.syncAll();
    });

    this.leftPanelEl.querySelector('#v2-arrange-abort')?.addEventListener('click', () => {
      if (!this.canMutate()) return;
      const nextRun = abortActiveV2Contract(run);
      this.setCurrentRun(nextRun);
      soundEngine.play('click');
      this.showToast('已放弃当前委托。');
      this.syncAll();
    });

    this.leftPanelEl.querySelector('#v2-btn-leave-arrange')?.addEventListener('click', () => {
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
    });

    this.mountV2CargoBay(run.bay, !readOnly, {
      title: `整舱拼装 · ${V2_SHIPS[run.shipId].name}`,
      statusBadge: '可调整',
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

  // --- 8. SETTLEMENT Phase (Next-Run Motivation + Side-by-Side Comparison + Showcase Isolation!) ---

  private dispositionLabel(
    d: V2SettlementDisposition,
    item: V2PlacedItem['item'],
    profile: V2ProfileState
  ): string {
    switch (d) {
      case 'deliver':
        return '交付委托';
      case 'sell':
        return `出售 +${item.fixedValue}¤`;
      case 'store': {
        const eq = V2_EQUIPMENT_DEFS[item.definitionId];
        if (eq && !profile.blueprints.includes(eq.kind)) {
          return '入库（可研究蓝图）';
        }
        if (item.quality === 'improved') {
          return '入库（下趟自带优良）';
        }
        return '入设备库';
      }
      case 'keep_relic':
        return '保留藏品（展台修复）';
      case 'return_loan':
        return '归还借用';
    }
  }

  private renderSettlementPhase(run: V2RunState): void {
    const p = this.save.profile;
    const readOnly = this.isReadOnlyTab && !run.isShowcase;
    const summary = calculateV2Settlement(run, p, this.settlementDispositions);
    const isSafe = summary.reason === 'safe_return';
    const projectedCredits = p.credits + summary.finalCreditsEarned;
    const nextGoal = this.computeNextBaseGoal(p, projectedCredits);

    this.leftPanelEl.innerHTML = `
      <div class="panel-header">
        <h2>${svgIcon('beacon', 16)} ${
      run.isShowcase
        ? '4 站精华试玩结算'
        : isSafe
        ? '安全返航清点'
        : '紧急拖回结算'
    }</h2>
        <span class="panel-sub">${
          run.isShowcase ? '独立试玩 · 不影响正式存档' : '每件战利品择一去向'
        }</span>
      </div>

      ${
        isSafe
          ? `<div class="v2-settle-banner ${summary.contractCompleted ? 'ok' : ''}">
              <strong>${
                summary.contractCompleted
                  ? run.isTutorial
                    ? '首航教学交付成功！免费启用工作台并获得额外悬赏'
                    : `委托「${run.contract.name}」交付完成！`
                  : run.contract.type === 'free'
                  ? '自由打捞安全返航'
                  : `委托「${run.contract.name}」未完成（无信用点罚金）`
              }</strong>
            </div>`
          : `<div class="system-banner banner-danger" style="margin-bottom:8px;">
              舰体损毁由拖船拖回。按规则折算 40% 回收，本次带出的 ${summary.lostOwnedCount} 件自有设备与 ${summary.lostLootCount} 件拾获物已损失；基地仓库原有库存不受影响。
            </div>`
      }

      <div class="v2-settle-totals">
        <div class="v2-mig-row"><span>航行钱包结余</span><strong class="num">${summary.walletCredits}¤</strong></div>
        ${
          isSafe
            ? `
              <div class="v2-mig-row"><span>出售物品收益</span><strong class="num">+${summary.soldItemsCredits}¤</strong></div>
              ${
                summary.contractRewardCredits > 0
                  ? `<div class="v2-mig-row"><span>委托悬赏奖金</span><strong class="num">+${summary.contractRewardCredits}¤</strong></div>`
                  : ''
              }
              ${
                summary.tutorialBonusCredits > 0
                  ? `<div class="v2-mig-row"><span>首航交付奖励</span><strong class="num">+${summary.tutorialBonusCredits}¤</strong></div>`
                  : ''
              }
              ${
                !run.isShowcase
                  ? `<div class="v2-mig-row"><span>入库后仓库容量</span><strong class="num ${
                      summary.warehouseOverflow ? 'text-danger' : ''
                    }">${summary.warehouseProjectedCount}/${V2_WAREHOUSE_CAPACITY}</strong></div>`
                  : ''
              }
            `
            : `<div class="v2-mig-row"><span>可回收总额 × 40%</span><strong class="num">${summary.defeatRecoverableBase} × 40%</strong></div>`
        }
        <div class="v2-mig-row total"><span>本次实得总计</span><strong class="num">+${summary.finalCreditsEarned}¤</strong></div>
      </div>

      ${
        !run.isShowcase
          ? `<div class="v2-settle-goal-hint ${nextGoal.ready ? 'is-ready' : ''}">
              <span>下一基地目标：<strong>${nextGoal.title}</strong></span>
              <small>${nextGoal.detail}</small>
            </div>`
          : ''
      }

      ${
        summary.warehouseOverflow && !run.isShowcase
          ? `<div class="system-banner banner-danger" style="margin:8px 0;">
              设备库容量超出上限（${summary.warehouseProjectedCount}/${V2_WAREHOUSE_CAPACITY}），请将部分「入库」改为「出售」。
            </div>`
          : ''
      }

      <div class="v2-settle-items">
        <div class="v2-prep-label">战利品去向对比（变现 vs 留用推进下趟）</div>
        ${
          summary.lines.length === 0
            ? `<div class="v2-empty-inline">本次船舱为空。</div>`
            : summary.lines
                .map(
                  (line) => `<div class="v2-settle-row">
                    <div class="v2-settle-item-info">
                      <span class="v2-origin-badge origin-${line.item.origin}">${originTagText(
                    line.item.origin
                  )}</span>
                      <strong>${line.name}</strong>
                      ${
                        line.item.category === 'equipment'
                          ? `<span class="v2-q-tag">${
                              line.item.quality === 'improved' ? '良' : '普'
                            }</span>`
                          : ''
                      }
                    </div>
                    <div class="v2-settle-disp-btns">
                      ${line.allowedDispositions
                        .map(
                          (d) => `<button type="button" class="btn btn-sm ${
                            line.selectedDisposition === d ? 'btn-primary' : 'btn-secondary'
                          }" data-settle-item="${line.item.instanceId}" data-settle-disp="${d}" ${
                            readOnly || line.allowedDispositions.length <= 1 ? 'disabled' : ''
                          }>${this.dispositionLabel(d, line.item, p)}</button>`
                        )
                        .join('')}
                    </div>
                  </div>`
                )
                .join('')
        }
      </div>

      ${
        run.isShowcase
          ? `<div class="v2-showcase-finish-actions">
              <button type="button" class="btn btn-secondary" id="v2-showcase-retry">${svgIcon('bolt', 14)} 换套流派再试一次</button>
              <button type="button" class="btn btn-primary btn-launch-hero" id="v2-showcase-to-base">${svgIcon('rocket', 15)} 进入正式拆解站</button>
            </div>`
          : `<button type="button" class="btn btn-primary btn-launch-hero" id="v2-btn-confirm-settle" ${
              readOnly || summary.warehouseOverflow ? 'disabled' : ''
            }>${readOnly ? '只读锁定' : `${svgIcon('beacon', 15)} 确认入账 · 靠泊拆解站`}</button>`
      }
    `;

    this.leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-settle-item]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.canMutate()) return;
        const iid = btn.dataset.settleItem!;
        const disp = btn.dataset.settleDisp as V2SettlementDisposition;
        this.settlementDispositions[iid] = disp;
        soundEngine.play('click');
        this.renderTopHud();
        this.renderSettlementPhase(run);
      });
    });

    this.leftPanelEl.querySelector('#v2-showcase-retry')?.addEventListener('click', () => {
      soundEngine.play('click');
      openV2ShowcasePickerModal(this.modalHostEl, (tid) => this.startShowcaseRun(tid));
    });

    this.leftPanelEl.querySelector('#v2-showcase-to-base')?.addEventListener('click', () => {
      soundEngine.play('click');
      this.showcaseRun = null;
      this.settlementDispositions = {};
      this.syncAll();
    });

    this.leftPanelEl.querySelector('#v2-btn-confirm-settle')?.addEventListener('click', () => {
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
        result.unlockedFamilyName ? `解锁体系：${result.unlockedFamilyName}` : null,
        result.unlockedCrewName ? `新船员加入：${result.unlockedCrewName}` : null,
      ].filter(Boolean);

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
    });

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
    });
    this.cargoGrid.render(bay, editable, { prepareMode: opts.prepareMode });
  }

  // --- Modal Launchers ---

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
          soundEngine.play('buildComplete');
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
