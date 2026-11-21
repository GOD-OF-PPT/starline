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
  V2_WAREHOUSE_CAPACITY,
  getMerchantBuybackPrice,
  getV2EquipmentDefByKind,
  type V2ArchetypeId,
  type V2EquipmentKind,
} from '../data/equipment';
import {
  V2_FACILITIES,
  V2_FACILITY_ORDER,
  type V2FacilityId,
} from '../data/facilities';
import { V2_SHAPES } from '../data/shapes';
import { V2_SHIPS, V2_SHIP_ORDER, type V2ShipId } from '../data/ships';
import { V2_TUTORIAL_HINTS, createV2TutorialRun } from '../data/tutorialV2';
import { previewV2CombatNode, completeV2CombatAtCurrentNode, startV2CombatAtCurrentNode } from '../domain/combatV2';
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
import { createEmptyV2Bay, findFirstLegalV2Placement } from '../domain/inventoryV2';
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
import {
  V2_TAB_CHANNEL,
  V2_TAB_LOCK_KEY,
  type V2CargoBayState,
  type V2CombatRoundLog,
  type V2MapNode,
  type V2NodeType,
  type V2PlacedItem,
  type V2RunState,
  type V2SaveData,
  type V2SettlementDisposition,
  type V2TargetPolicy,
} from '../domain/types';
import {
  CargoGridV2Component,
  originTagText,
  renderV2MiniMaskHtml,
} from './CargoGridV2';
import {
  openV1MigrationModal,
  openV2BackupRecoveryModal,
  openV2CodexModal,
  openV2DiscardConfirmModal,
  openV2HelpModal,
  openV2RelicGalleryModal,
  openV2SettingsModal,
  openV2WarehouseModal,
} from './V2Modals';

const V2_TITLE_SESSION_KEY = 'starline_v2_title_entered';

interface V2PrepareDraft {
  contractTemplateId: string;
  shipId: V2ShipId;
  crewId: V2CrewId | null;
  primaryArchetype: V2ArchetypeId;
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

const NODE_TYPE_META: Record<V2NodeType, { readonly label: string; readonly icon: string; readonly cls: string }> = {
  combat: { label: '敌舰巡逻', icon: '⚔', cls: 'node-combat' },
  elite: { label: '精英旗舰', icon: '☠', cls: 'node-elite' },
  wreck: { label: '废船打捞', icon: '🔧', cls: 'node-wreck' },
  merchant: { label: '流动商人', icon: '⚖', cls: 'node-merchant' },
  anomaly: { label: '异常星区', icon: '✦', cls: 'node-anomaly' },
  distress: { label: '求救信号', icon: '📡', cls: 'node-distress' },
};

const ARCHETYPE_ORDER: readonly V2ArchetypeId[] = ['laser', 'heavy', 'hangar', 'counter'];

export interface V2ControllerOptions {
  readonly onSwitchToV1: () => void;
}

export class V2AppController {
  private readonly mountEl: HTMLElement;
  private readonly options: V2ControllerOptions;

  private save: V2SaveData;
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

  // Live combat playback display telemetry (pure presentation)
  private activeCombatPlaybackKey: string | null = null;
  private liveCombatRound = 0;
  private liveCombatPlayerHp = 30;
  private liveCombatPlayerShield = 0;
  private liveCombatEnemiesAlive = 0;
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

    // Active run skips title overlay immediately so refresh lands straight back into voyage
    if (this.save.activeRun) {
      this.titleEntered = true;
      this.writeTitleSession(true);
    }

    this.applySettingsEffects();

    this.phaserHost = new PhaserHost(this.sceneCanvasHostEl);
    this.phaserHost.onBuildingClick((buildingId) => {
      if (hasOpenModal() || this.save.activeRun || this.prepareDraft) return;
      soundEngine.play('click');
      if (buildingId === 'workbench') {
        this.openWarehouseModal('warehouse');
      } else if (buildingId === 'display') {
        this.openRelicGalleryModal();
      } else if (buildingId === 'drydock') {
        this.leftPanelEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        this.showToast('在基地经营面板可扩建船坞并解锁护盾巡洋舰与重型货船。');
      }
    });

    this.tabGuard.start();
    this.isReadOnlyTab = !this.tabGuard.canWrite();

    window.addEventListener('resize', this.handleWindowResize);
    window.addEventListener('orientationchange', this.handleWindowResize);

    this.syncAll();

    // Auto-prompt V1 migration once if player has V1 save and fresh V2 (no runs, no migration record)
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
      !this.save.activeRun
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
    const run = this.save.activeRun;
    const isArrange = run?.phase === 'ARRANGE';
    const collapsed = isArrange && this.isArrangeSceneCollapsed();
    this.sceneWrapEl.classList.toggle('scene-collapsed', collapsed);
    this.appShellEl.classList.toggle('phase-arrange', Boolean(isArrange));
    this.appShellEl.classList.toggle('phase-combat', Boolean(run?.phase === 'ENCOUNTER' && run.activeCombat));
    this.appShellEl.classList.toggle('phase-prepare', Boolean(!run && this.prepareDraft));
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
    const showTitle = !this.titleEntered && !this.save.activeRun;
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
    const hasProgress = p.totalRuns > 0 || p.tutorialCompleted || p.credits > 0 || Boolean(p.migrationRecord);
    const ctaText = hasProgress ? '▶ 继续远航经营' : '▶ 开始首航（V2 远航经营）';

    this.titleHostEl.innerHTML = `
      <div class="title-screen-backdrop" style="background-image:url('${getTitleKeyArtUrl()}')">
        <div class="title-screen-scrim">
          <div class="title-card v2-title-card">
            <div class="title-eyebrow">STARLINE SALVAGE · V2 VOYAGE MANAGEMENT</div>
            <h1 class="title-heading">星际拆解站</h1>
            <p class="title-tagline">接取委托 · 选舰配装 · 六层分支探索 · 拼装取舍 · 返航研究扩建</p>

            <div class="title-telemetry">
              <div class="title-stat"><span>信用点</span><strong class="num">${p.credits}¤</strong></div>
              <div class="title-stat"><span>舰船</span><strong class="num">${p.unlockedShips.length}/3</strong></div>
              <div class="title-stat"><span>蓝图</span><strong class="num">${p.blueprints.length}/10</strong></div>
              <div class="title-stat"><span>藏品馆</span><strong class="num">${relicSum.restoredCount}/${relicSum.totalCount}</strong></div>
            </div>

            <div class="title-actions">
              <button type="button" class="btn btn-primary btn-launch-hero" id="v2-title-enter">${ctaText}</button>
              <div class="title-sub-actions">
                ${
                  this.shouldOfferMigrationPrompt()
                    ? `<button type="button" class="btn btn-secondary" id="v2-title-migrate">导入旧版 V1 存档</button>`
                    : ''
                }
                <button type="button" class="btn btn-ghost" id="v2-title-help">规则说明</button>
                <button type="button" class="btn btn-ghost" id="v2-title-v1">切回 V1 经典模式</button>
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

  // --- Top HUD (Clean 3-pill max during runs, §13) ---

  private formatContractHudPill(run: V2RunState): string {
    const c = run.contract;
    if (c.status === 'aborted') return '已弃约 · 自由返航';
    if (c.type === 'free') return '自由打捞';
    if (c.type === 'transport') {
      const hasReactor = run.bay.placed.some(
        (p) => p.item.origin === 'mission' && p.item.definitionId === 'mission.sealed_reactor'
      );
      return hasReactor ? '大件运输 · 已装载 ✓' : '大件运输 · 待取反应堆';
    }
    if (c.type === 'rescue') {
      const pods = countEscapePodsInBay(run.bay);
      return `失联救援 · 救生舱 ${pods}/${c.missionItemCount}`;
    }
    if (c.type === 'survey') {
      return `航迹勘测 · ${c.completedNodeIds.length}/${c.requiredCompletions}`;
    }
    return c.name;
  }

  private renderTopHud(): void {
    const run = this.save.activeRun;
    const p = this.save.profile;
    const relicSum = getV2RelicSummary(p);

    let pillsHtml = '';
    if (run) {
      const fuelLow = run.fuel <= 2;
      if (run.phase === 'SETTLEMENT') {
        const sum = calculateV2Settlement(run, p, this.settlementDispositions);
        pillsHtml = `
          <div class="hud-pill"><span class="k">状态</span><strong class="v">${
            sum.reason === 'defeat' ? '战败拖回' : '安全返航'
          }</strong></div>
          <div class="hud-pill"><span class="k">委托</span><strong class="v">${
            sum.contractCompleted ? '可交付 ✓' : run.contract.type === 'free' ? '自由打捞' : '未完成'
          }</strong></div>
          <div class="hud-pill pill-accent"><span class="k">本次实得</span><strong class="v num">+${
            sum.finalCreditsEarned
          }¤</strong></div>
        `;
      } else {
        pillsHtml = `
          <div class="hud-pill ${run.hp <= 8 ? 'pill-danger' : ''}"><span class="k">耐久</span><strong class="v num">${
            run.hp
          }/${run.maxHp}</strong></div>
          <div class="hud-pill ${fuelLow ? 'pill-warn' : ''}"><span class="k">燃料</span><strong class="v num">${
            run.fuel
          }/${run.maxFuel}</strong></div>
          <div class="hud-pill"><span class="k">委托</span><strong class="v">${this.formatContractHudPill(
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
        <div class="hud-pill pill-accent"><span class="k">信用点</span><strong class="v num">${displayCredits}¤</strong></div>
        <div class="hud-pill"><span class="k">设备库</span><strong class="v num">${p.equipmentWarehouse.length}/${V2_WAREHOUSE_CAPACITY}</strong></div>
        <div class="hud-pill"><span class="k">蓝图/藏品</span><strong class="v num">${p.blueprints.length}/10 · ${relicSum.restoredCount}/${relicSum.totalCount}</strong></div>
      `;
    }

    const showCollapseBtn = run?.phase === 'ARRANGE';
    const collapsed = this.isArrangeSceneCollapsed();

    this.topHudEl.innerHTML = `
      <div class="hud-brand">
        <span class="hud-logo-dot"></span>
        <span class="hud-title">星际拆解站</span>
        <span class="v2-ver-chip">V2</span>
      </div>
      <div class="hud-actions">
        ${
          showCollapseBtn
            ? `<button type="button" class="btn btn-sm btn-secondary" id="v2-btn-toggle-scene">${
                collapsed ? '展开场景' : '收起场景'
              }</button>`
            : ''
        }
        ${
          !run
            ? `<button type="button" class="btn btn-sm btn-secondary" id="v2-hud-warehouse">设备库${
                p.pendingGiftQueue.length > 0 ? ` (+${p.pendingGiftQueue.length})` : ''
              }</button>`
            : ''
        }
        <button type="button" class="btn btn-sm btn-ghost" id="v2-hud-help" aria-label="帮助">规则</button>
        <button type="button" class="btn btn-sm btn-ghost" id="v2-hud-settings" aria-label="设置">设置</button>
      </div>
      <div class="hud-pills">${pillsHtml}</div>
    `;

    this.topHudEl.querySelector('#v2-btn-toggle-scene')?.addEventListener('click', () => {
      this.sceneCollapseOverride = !collapsed;
      this.applyViewportClasses();
      this.renderTopHud();
      this.phaserHost?.resize();
    });
    this.topHudEl.querySelector('#v2-hud-warehouse')?.addEventListener('click', () => {
      soundEngine.play('click');
      this.openWarehouseModal('warehouse');
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

    if (this.isReadOnlyTab) {
      items.push(`
        <div class="system-banner banner-warn" role="alert">
          <span>🔒 当前标签页为<strong>只读保护模式</strong>（检测到另一个活动标签页正在写入进度）。</span>
          <button type="button" class="btn btn-sm btn-primary" id="v2-btn-takeover">接管控制权</button>
        </div>
      `);
    }

    if (this.storageError) {
      items.push(`<div class="system-banner banner-danger" role="alert">⚠ ${this.storageError}</div>`);
    }

    if (this.actionToast) {
      items.push(`<div class="system-banner banner-warn" role="status">${this.actionToast}</div>`);
    }

    const run = this.save.activeRun;
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
          <span class="tutorial-badge">教学 L${currentLayer}/3</span>
          <span>${hintText}</span>
        </div>
      `);
    }

    if (!run && this.shouldOfferMigrationPrompt()) {
      items.push(`
        <div class="system-banner banner-warn">
          <span>检测到旧版 V1 存档（信用点 ${this.v1Inspection.baseCredits}¤${
        this.v1Inspection.activeRunPreview ? ' · 含进行中航次' : ''
      }），可随时安全导入并保留旧档。</span>
          <button type="button" class="btn btn-sm btn-primary" id="v2-banner-migrate">打开迁移向导</button>
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
      this.showToast('已接管 V2 存档写权限并同步最新状态。');
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
    const run = this.save.activeRun;

    // 1. BASE Diorama (reuses 2:1 isometric BaseScene + V2 pins & 3-ship docking!)
    if (!run && !this.prepareDraft) {
      this.activeCombatPlaybackKey = null;
      const p = this.save.profile;
      const relicSum = getV2RelicSummary(p);
      this.phaserHost.showBase({
        progression: this.adaptProfileToV1BaseProgression(),
        settings: this.save.settings,
        recentlyBuiltId: this.recentlyBuiltPin,
        v2Override: {
          shipId: p.selectedShipId,
          wbText: p.buildings.research_lab
            ? `工作台 · 研究台 ✓`
            : p.buildings.workbench
            ? `工作台 · 设备库 (${p.equipmentWarehouse.length}/12)`
            : '首航后免费启用工作台',
          dispText: p.buildings.display
            ? `藏品馆 ${relicSum.restoredCount}/${relicSum.totalCount}`
            : '收藏展台 · 120¤',
          dockText: p.buildings.drydock_tier2
            ? '船坞二阶 · 3/3 舰 ✓'
            : p.buildings.drydock
            ? '船坞一阶 · 2/3 舰'
            : '船坞一阶 · 80¤',
          showAllPins: true,
        },
      });
      this.renderBaseSceneOverlay();
      return;
    }

    // 2. PREPARE Preview Stage (shows chosen hull floating in orbital sector!)
    if (!run && this.prepareDraft) {
      this.activeCombatPlaybackKey = null;
      this.phaserHost.showV2Stage({
        shipId: this.prepareDraft.shipId,
        sectorIndex: 1,
        eventBackdrop: null,
        units: [],
        simulation: null,
        settings: this.save.settings,
      });
      const ship = V2_SHIPS[this.prepareDraft.shipId];
      this.sceneOverlayEl.innerHTML = `
        <div class="scene-stage-tag">出航整备 · ${ship.name} (${ship.cols}×${ship.rows} · ${ship.validCellCount}可用格)</div>
      `;
      return;
    }

    if (!run) return;

    const currentNode = run.currentNodeId ? run.graph.nodes[run.currentNodeId] : null;
    const sectorIndex = currentNode?.sectorBg ?? 1;

    // 3. Active Combat Playback
    if (run.phase === 'ENCOUNTER' && run.activeCombat && currentNode?.combat) {
      const sim = run.activeCombat.simulation;
      const pbKey = `${run.runId}_${currentNode.nodeId}_${sim.resultId}`;
      if (this.activeCombatPlaybackKey !== pbKey) {
        this.activeCombatPlaybackKey = pbKey;
        this.liveCombatRound = 0;
        this.liveCombatPlayerHp = sim.startingPlayerHp;
        this.liveCombatPlayerShield = sim.startingPlayerShield;
        this.liveCombatEnemiesAlive = sim.initialEnemies.length;

        this.phaserHost.showV2Stage({
          shipId: run.shipId,
          sectorIndex,
          eventBackdrop: null,
          units: currentNode.combat.units,
          simulation: sim,
          settings: this.save.settings,
          onRoundStep: (_idx: number, log: V2CombatRoundLog) => {
            this.liveCombatRound = log.round;
            this.liveCombatPlayerHp = log.playerHpAfter;
            this.liveCombatPlayerShield = log.playerShieldAfter;
            this.liveCombatEnemiesAlive = log.enemiesAfter.filter((e) => e.hp > 0).length;
            this.renderCombatPlaybackOverlay(run);
          },
          onComplete: () => {
            if (!this.save.activeRun || !this.save.activeRun.activeCombat) return;
            const res = completeV2CombatAtCurrentNode(
              this.save.activeRun,
              this.save.profile.unlockedFamilies
            );
            if (res.ok) {
              this.save = { ...this.save, activeRun: res.run };
              this.activeCombatPlaybackKey = null;
              this.persist();
              soundEngine.play(sim.outcome === 'victory' ? 'enemyDestroy' : 'hullHit');
              this.syncAll();
            }
          },
        });
      }
      this.renderCombatPlaybackOverlay(run);
      return;
    }

    // 4. Static Event / Pre-Combat / Map / Arrange / Settlement Stage
    this.activeCombatPlaybackKey = null;
    const eventBg =
      currentNode &&
      (currentNode.type === 'wreck' ||
        currentNode.type === 'merchant' ||
        currentNode.type === 'anomaly' ||
        currentNode.type === 'distress')
        ? currentNode.type
        : null;
    const previewUnits =
      run.phase === 'ENCOUNTER' && currentNode?.combat ? currentNode.combat.units : [];

    this.phaserHost.showV2Stage({
      shipId: run.shipId,
      sectorIndex,
      eventBackdrop: eventBg,
      units: previewUnits,
      simulation: null,
      settings: this.save.settings,
    });

    const stageLabel =
      run.phase === 'MAP'
        ? `六层航路 · 第 ${currentNode ? currentNode.layer : 0}/${run.graph.maxLayers} 层`
        : run.phase === 'SHOP'
        ? `流动商人 · 航行钱包 ${run.wallet}¤`
        : run.phase === 'REWARD'
        ? `战利品打捞 · 选择 1 项战后补给`
        : run.phase === 'ARRANGE'
        ? `船舱整理 · ${V2_SHIPS[run.shipId].name}`
        : run.phase === 'SETTLEMENT'
        ? `远航结算 · ${run.settlementReason === 'defeat' ? '战败折算' : '安全返航'}`
        : currentNode
        ? `${NODE_TYPE_META[currentNode.type].icon} 第 ${currentNode.layer} 层 · ${
            NODE_TYPE_META[currentNode.type].label
          }`
        : '远航执行中';

    this.sceneOverlayEl.innerHTML = `<div class="scene-stage-tag">${stageLabel}</div>`;
  }

  private renderBaseSceneOverlay(): void {
    if (!this.activeDockingNotice) {
      this.sceneOverlayEl.innerHTML = `<div class="scene-stage-tag">2:1 星际拆解站 · 点击设施图标快速管理</div>`;
      return;
    }
    const n = this.activeDockingNotice;
    const shownCredits = n.animating
      ? Math.round(n.creditsBefore + (n.creditsAfter - n.creditsBefore) * n.progress)
      : n.creditsAfter;
    this.sceneOverlayEl.innerHTML = `
      <div class="docking-overlay-card">
        <div class="docking-title">${
          n.wasDefeat
            ? '拖船已将残骸拖回拆解站'
            : n.contractCompleted
            ? '✦ 委托交付完成 · 货船安全靠泊'
            : '⚓ 货船安全返航 · 卸货入账完毕'
        }</div>
        <div class="docking-stats">
          <span>本次入账 <strong class="num">+${n.earnedCredits}¤</strong></span>
          <span>基地余额 <strong class="num">${shownCredits}¤</strong></span>
        </div>
        ${n.unlockedText ? `<div class="docking-unlock">✦ ${n.unlockedText}</div>` : ''}
        <div class="docking-actions">
          ${
            n.animating
              ? `<button type="button" class="btn btn-sm btn-secondary" id="v2-skip-dock">跳过靠泊演出</button>`
              : `<button type="button" class="btn btn-sm btn-primary" id="v2-close-dock">收起通知</button>`
          }
        </div>
      </div>
    `;
    this.sceneOverlayEl.querySelector('#v2-skip-dock')?.addEventListener('click', () => {
      this.phaserHost?.skipBaseReturnDocking();
    });
    this.sceneOverlayEl.querySelector('#v2-close-dock')?.addEventListener('click', () => {
      this.activeDockingNotice = null;
      this.renderBaseSceneOverlay();
    });
  }

  private renderCombatPlaybackOverlay(run: V2RunState): void {
    const sim = run.activeCombat?.simulation;
    if (!sim) return;
    this.sceneOverlayEl.innerHTML = `
      <div class="combat-hud-bar">
        <span class="combat-pill">回合 <strong class="num">${this.liveCombatRound}/${sim.roundsCount}</strong></span>
        <span class="combat-pill">我方 <strong class="num">${this.liveCombatPlayerHp} HP · ${this.liveCombatPlayerShield} 盾</strong></span>
        <span class="combat-pill">敌方存活 <strong class="num">${this.liveCombatEnemiesAlive}</strong></span>
        <div style="display:flex;gap:6px;">
          <button type="button" class="btn btn-sm btn-secondary" id="v2-combat-speed">${
            this.save.settings.combatSpeed
          }×</button>
          <button type="button" class="btn btn-sm btn-primary" id="v2-combat-skip">跳过演出</button>
        </div>
      </div>
    `;
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
      this.phaserHost?.skipCombatPlayback();
    });
  }

  // --- Main Panel Dispatcher ---

  private renderPanels(): void {
    const run = this.save.activeRun;
    if (!run) {
      if (this.prepareDraft) {
        this.renderPreparePanels();
      } else {
        this.renderBasePanels();
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

  // --- 1. BASE Panels (Contract Board + Facilities Management) ---

  private renderBasePanels(): void {
    const p = this.save.profile;
    const readOnly = this.isReadOnlyTab;
    const board = getAvailableContractBoard(p);
    const relicSum = getV2RelicSummary(p);

    // Left Panel: Contract Board & Tutorial
    const renderContractCard = (tplId: string, lockedReason?: string) => {
      const tpl = V2_CONTRACT_TEMPLATES[tplId];
      if (!tpl) return '';
      const completedBefore = p.completedContractIds.includes(tpl.templateId);
      const isDeep = tpl.tier === 'deep';
      return `
        <div class="v2-contract-card ${isDeep ? 'tier-deep' : ''} ${lockedReason ? 'is-locked' : ''}">
          <div class="v2-contract-head">
            <span class="v2-contract-name">${tpl.name}</span>
            <span class="v2-contract-reward num">${
              tpl.rewardCredits > 0 ? `+${tpl.rewardCredits}¤` : '按货物结算'
            }</span>
          </div>
          <div class="v2-contract-desc">${tpl.gameplayNote}</div>
          <div class="v2-contract-meta">
            <span>${tpl.spaceNote}</span>
            ${completedBefore ? '<span class="v2-done-chip">已通关 ✓</span>' : ''}
          </div>
          <div class="v2-contract-foot">
            ${
              lockedReason
                ? `<span class="v2-lock-note">🔒 ${lockedReason}</span>`
                : `<button type="button" class="btn btn-sm btn-primary" data-pick-contract="${tpl.templateId}" ${
                    readOnly ? 'disabled' : ''
                  }>接取并整备</button>`
            }
          </div>
        </div>
      `;
    };

    this.leftPanelEl.innerHTML = `
      <div class="panel-header">
        <h2>委托终端 · 选择远航合同</h2>
        <span class="panel-sub">${
          p.completedContractTypes.length
        }/3 种标准委托已达成</span>
      </div>
      ${
        !p.tutorialCompleted
          ? `<div class="v2-tutorial-hero">
              <div class="v2-tut-title">★ 首航教学 · 2×3 密封反应堆装舱演示</div>
              <div class="v2-tut-desc">3 层固定示范航路，亲身体验空间取舍、旋转拼装与安全返航；完成后免费启用「拆解工作台」与「委托终端」，交付成功额外奖 +40¤！</div>
              <button type="button" class="btn btn-primary btn-launch-hero" id="v2-btn-start-tutorial" ${
                readOnly ? 'disabled' : ''
              }>▶ 启动首航教学（免费）</button>
            </div>`
          : ''
      }
      <div class="v2-contract-section-title">标准委托（第 1–4 层目标 · 首次完成解锁新设备体系与船员）</div>
      <div class="v2-contract-grid">
        ${board.standardTemplates.map((c) => renderContractCard(c.templateId)).join('')}
      </div>
      <div class="v2-contract-section-title">深入委托（第 5–6 层高风险高回报${
        board.deepUnlocked ? ' · 已解锁' : ' · 完成任意 1 份标准委托解锁'
      }）</div>
      <div class="v2-contract-grid">
        ${board.deepTemplates
          .map((c) =>
            renderContractCard(
              c.templateId,
              board.deepUnlocked ? undefined : '需先完成任意 1 份标准委托'
            )
          )
          .join('')}
      </div>
      <div class="v2-contract-section-title">免费兜底与重玩</div>
      <div class="v2-contract-grid">
        ${renderContractCard(board.freeTemplate.templateId)}
      </div>
      ${
        p.tutorialCompleted
          ? `<div style="margin-top:8px;display:flex;justify-content:flex-end;">
              <button type="button" class="btn btn-sm btn-ghost" id="v2-btn-start-tutorial" ${
                readOnly ? 'disabled' : ''
              }>重玩 3 层首航教学</button>
            </div>`
          : ''
      }
    `;

    this.leftPanelEl.querySelector('#v2-btn-start-tutorial')?.addEventListener('click', () => {
      if (!this.canMutate()) return;
      const run = createV2TutorialRun(`v2tut_${Date.now().toString(36)}`);
      this.save = { ...this.save, activeRun: run };
      this.activeDockingNotice = null;
      this.persist();
      soundEngine.play('warpJump');
      this.syncAll();
    });

    this.leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-pick-contract]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.canMutate()) return;
        const tplId = btn.dataset.pickContract!;
        soundEngine.play('click');
        this.openPrepareForContract(tplId);
      });
    });

    // Right Panel: Base Facilities, Warehouse, Museum & Codex
    this.rightPanelEl.innerHTML = `
      <div class="panel-header">
        <h2>基地经营 · 设施与研究</h2>
        <span class="panel-sub">已解锁舰船 ${p.unlockedShips.length}/3 · 船员 ${p.unlockedCrew.length}/3</span>
      </div>
      <div class="v2-base-quick-bar">
        <button type="button" class="btn btn-sm btn-secondary" id="v2-open-wh">📦 设备库 (${p.equipmentWarehouse.length}/${V2_WAREHOUSE_CAPACITY})${
      p.pendingGiftQueue.length > 0 ? ` 🎁${p.pendingGiftQueue.length}` : ''
    }</button>
        <button type="button" class="btn btn-sm btn-secondary" id="v2-open-res">🔬 蓝图研究 (${p.blueprints.length}/10)</button>
        <button type="button" class="btn btn-sm btn-secondary" id="v2-open-relics">🏛 藏品展馆 (${relicSum.restoredCount}/${relicSum.totalCount})</button>
        <button type="button" class="btn btn-sm btn-ghost" id="v2-open-codex">📖 图鉴</button>
      </div>
      <div class="v2-facility-list">
        ${V2_FACILITY_ORDER.map((fid) => {
          const def = V2_FACILITIES[fid];
          const built = p.buildings[fid];
          const check = canBuildV2Facility(p, fid);
          return `<div class="v2-facility-card ${built ? 'built' : ''}">
            <div class="v2-fac-main">
              <div class="v2-fac-title">
                <strong>${def.name}</strong>
                <span class="v2-fac-badge ${built ? 'done' : ''}">${
            built ? '已启用 ✓' : def.cost === 0 ? '教学免费' : `${def.cost}¤`
          }</span>
              </div>
              <div class="v2-fac-desc">${def.effectSummary}</div>
              ${!built && check.reason ? `<div class="v2-fac-req">${check.reason}</div>` : ''}
            </div>
            <div class="v2-fac-act">
              ${
                built
                  ? `<span class="v2-built-ok">运行中</span>`
                  : `<button type="button" class="btn btn-sm btn-primary" data-build-fac="${fid}" ${
                      readOnly || !check.canBuild ? 'disabled' : ''
                    }>${def.cost === 0 ? '首航解锁' : `建造 ${def.cost}¤`}</button>`
              }
            </div>
          </div>`;
        }).join('')}
      </div>
    `;

    this.rightPanelEl.querySelector('#v2-open-wh')?.addEventListener('click', () => {
      soundEngine.play('click');
      this.openWarehouseModal('warehouse');
    });
    this.rightPanelEl.querySelector('#v2-open-res')?.addEventListener('click', () => {
      soundEngine.play('click');
      this.openWarehouseModal('research');
    });
    this.rightPanelEl.querySelector('#v2-open-relics')?.addEventListener('click', () => {
      soundEngine.play('click');
      this.openRelicGalleryModal();
    });
    this.rightPanelEl.querySelector('#v2-open-codex')?.addEventListener('click', () => {
      soundEngine.play('click');
      openV2CodexModal(this.modalHostEl, this.save.profile);
    });
    this.rightPanelEl.querySelectorAll<HTMLButtonElement>('[data-build-fac]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.canMutate()) return;
        const fid = btn.dataset.buildFac as V2FacilityId;
        const res = purchaseV2Facility(this.save.profile, fid);
        if (!res.ok) {
          this.showToast(res.error ?? '无法建造该设施');
          return;
        }
        this.save = { ...this.save, profile: res.profile };
        this.recentlyBuiltPin =
          fid === 'display' ? 'display' : fid === 'drydock' || fid === 'drydock_tier2' ? 'drydock' : 'workbench';
        this.persist();
        soundEngine.play('buildComplete');
        this.showToast(`「${V2_FACILITIES[fid].name}」建成启用！`);
        this.syncAll();
      });
    });
  }

  // --- 2. PREPARE Panels (Ship + Crew + Archetype + Budget + Presets + Interactive Bay) ---

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
    const check = validateV2PrepareLoadout(p, draft.shipId, draft.crewId, draft.slots);
    const usedOwnedIds = new Set(check.ownedInstancesUsed);
    const previewBay = this.buildPreparePreviewBay(draft);

    this.leftPanelEl.innerHTML = `
      <div class="panel-header">
        <h2>出航整备 · ${contractTpl.name}</h2>
        <button type="button" class="btn btn-sm btn-ghost" id="v2-prep-back">← 返回基地</button>
      </div>

      <div class="v2-prep-contract-strip">
        <strong>${contractTpl.name}</strong>
        <span>${contractTpl.gameplayNote}</span>
        ${
          contractTpl.rewardCredits > 0
            ? `<span class="v2-contract-reward num">+${contractTpl.rewardCredits}¤</span>`
            : ''
        }
      </div>

      <div class="v2-prep-group">
        <div class="v2-prep-label">1. 选择舰船</div>
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
      </div>

      <div class="v2-prep-group">
        <div class="v2-prep-label">2. 选择船员</div>
        <div class="v2-crew-row">
          ${V2_CREW_ORDER.map((cid) => {
            const c = V2_CREW[cid];
            const unlocked = p.unlockedCrew.includes(cid);
            const active = draft.crewId === cid;
            return `<button type="button" class="v2-crew-pill ${active ? 'active' : ''}" data-prep-crew="${cid}" ${
              !unlocked ? 'disabled' : ''
            }>
              <strong>${c.name}</strong>
              <small>${unlocked ? c.abilitySummary : `🔒 ${c.unlockHint}`}</small>
            </button>`;
          }).join('')}
        </div>
      </div>

      <div class="v2-prep-group">
        <div class="v2-prep-label">3. 主构筑倾向（保底航路至少 1 次出现对应支援件）</div>
        <div class="v2-arch-row">
          ${ARCHETYPE_ORDER.map((aid) => {
            const info = V2_ARCHETYPE_LABELS[aid];
            return `<button type="button" class="btn btn-sm ${
              draft.primaryArchetype === aid ? 'btn-primary' : 'btn-secondary'
            }" data-prep-arch="${aid}">${info.name}（保底${info.supportName}）</button>`;
          }).join('')}
        </div>
      </div>

      <div class="v2-prep-group">
        <div class="v2-prep-label-row">
          <span class="v2-prep-label">4. 装配预算 <strong class="num">${check.totalBudget}/${
      check.maxBudget
    }</strong></span>
          <div style="display:flex;gap:6px;">
            <button type="button" class="btn btn-sm btn-ghost" id="v2-prep-fallback">免费推荐配装</button>
            <button type="button" class="btn btn-sm btn-ghost" id="v2-prep-clear">清空</button>
          </div>
        </div>
        <div class="v2-risk-note">⚠ <strong>自有设备</strong>战败将损失实物；<strong>借用设备</strong>免费且返航自动归还。</div>

        <div class="v2-pool-subtitle">借用普通蓝图（免费 · 计预算）</div>
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

        <div class="v2-pool-subtitle">仓库自有设备（${p.equipmentWarehouse.length} 件 · 优良/普通均可用）</div>
        <div class="v2-pool-chips">
          ${
            p.equipmentWarehouse.length === 0
              ? `<span class="v2-empty-inline">设备库暂无自有设备（可从航路入库或在研究台制造）</span>`
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
          <span class="v2-prep-label">5. 配装预设 (${p.loadoutPresets.length}/${V2_MAX_SAVED_PRESETS})</span>
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
            : `<div class="v2-empty-inline">保存最多 3 套常用配装，下次出航一键装载（绝不静默替换缺失的自有件）。</div>`
        }
      </div>

      ${
        !check.valid
          ? `<div class="system-banner banner-danger" style="margin:6px 0;">${check.errors.join('；')}</div>`
          : ''
      }
      <button type="button" class="btn btn-primary btn-launch-hero" id="v2-btn-launch-run" ${
        readOnly || !check.valid ? 'disabled' : ''
      }>▶ 确认整备 · 启动六层远航</button>
    `;

    // Wire prepare controls
    this.leftPanelEl.querySelector('#v2-prep-back')?.addEventListener('click', () => {
      this.prepareDraft = null;
      soundEngine.play('click');
      this.syncAll();
    });

    this.leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-prep-ship]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextShip = btn.dataset.prepShip as V2ShipId;
        if (nextShip === draft.shipId) return;
        draft.shipId = nextShip;
        draft.slots = [...buildFreeFallbackPrepareSlots(nextShip, p.blueprints)];
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
      draft.slots = [...buildFreeFallbackPrepareSlots(draft.shipId, p.blueprints)];
      draft.missingPresetEntries = [];
      draft.presetNotice = null;
      soundEngine.play('click');
      this.syncAll();
    });

    this.leftPanelEl.querySelector('#v2-prep-clear')?.addEventListener('click', () => {
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
          this.showToast('当前船舱没有足够空位放入该设备，请先调整或移出其他设备。');
          return;
        }
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
        draft.slots = goodSlots;
        draft.missingPresetEntries = missing;
        draft.presetNotice =
          missing.length > 0
            ? `预设「${pr.name}」有 ${missing.length} 件自有设备当前不在仓库中，已空出对应槽位（未自动替换）。`
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
      this.persist();
      soundEngine.play('warpJump');
      this.syncAll();
    });

    // Right Panel: Interactive Prepare Bay
    this.mountV2CargoBay(previewBay, !readOnly, {
      title: `整备船舱 · ${V2_SHIPS[draft.shipId].name}`,
      prepareMode: true,
      onChange: (nextBay) => {
        // Map updated placed coordinates back to draft.slots
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
        draft.slots = draft.slots.filter(
          (s) => s.slotKey !== instanceId && s.warehouseInstanceId !== instanceId
        );
        this.syncAll();
      },
    });
  }

  // --- 3. MAP Phase (6-Layer Branching DAG + Reachable Cards + Safe Return) ---

  private renderMapPhase(run: V2RunState): void {
    const readOnly = this.isReadOnlyTab;
    const reachableIds = getReachableNextNodeIds(run);
    const fuelInfo = computeV2JumpFuelCost(run);
    const canJump = run.fuel >= fuelInfo.totalCost;

    // Next-hop prominent decision cards
    const nextCardsHtml = reachableIds
      .map((nid) => {
        const node = run.graph.nodes[nid];
        if (!node) return '';
        const meta = NODE_TYPE_META[node.type];
        let previewHtml = '';
        if (node.combat) {
          const pv = previewV2CombatNode(run, node.nodeId, run.targetPolicy);
          const unitList = node.combat.units
            .map((u) => `${u.name}(${u.maxHp}HP/${u.damagePerRound}攻${u.armor ? `/${u.armor}甲` : ''}${u.pierceRatio ? '/穿盾' : ''})`)
            .join(' + ');
          previewHtml = `
            <div class="v2-map-combat-preview ${pv?.outcome === 'victory' ? 'ok' : 'risk'}">
              <span>${unitList}</span>
              <strong>预测：${
                pv?.outcome === 'victory'
                  ? `胜 · 剩 ${pv.finalPlayerHpAfterRepair} HP (${pv.roundsCount}回合)`
                  : `⚠ 战败风险 (${pv?.roundsCount ?? '?'}回合)`
              } · 赏金 ${node.combat.bounty}¤</strong>
            </div>
          `;
        } else if (node.type === 'wreck') {
          previewHtml = `<div class="v2-map-event-hint">二选一：军械舱（设备）或 货舱（高价货物）${
            run.crewId === 'salvager' ? ' · 拆解专家已透视全明细' : ''
          }</div>`;
        } else if (node.type === 'merchant') {
          previewHtml = `<div class="v2-map-event-hint">可购 2 件设备 / +2 燃料(12¤) / +10 耐久(15¤) / 折价出售拾获物</div>`;
        } else if (node.type === 'anomaly') {
          previewHtml = `<div class="v2-map-event-hint">安全穿越(-1燃料) 或 强行破入(-4耐久得双份货物)</div>`;
        } else if (node.type === 'distress') {
          previewHtml = `<div class="v2-map-event-hint">救援船员(-1燃料回8耐久) 或 打捞高价货舱</div>`;
        }

        return `
          <div class="v2-next-node-card ${meta.cls} ${node.contractMarker ? 'is-contract' : ''}">
            <div class="v2-next-node-head">
              <span class="v2-node-title">${meta.icon} 第 ${node.layer} 层 ${
          node.lane === 0 ? 'A路' : 'B路'
        } · ${meta.label}</span>
              <span class="v2-fuel-tag ${canJump ? '' : 'no-fuel'}">⛽ 耗燃料 ${fuelInfo.totalCost}</span>
            </div>
            <div class="v2-node-badges">
              ${
                node.contractMarker
                  ? `<span class="v2-badge-contract">★ 委托目标点</span>`
                  : ''
              }
              ${
                node.hasSupportGuarantee
                  ? `<span class="v2-badge-support">⚙ ${
                      V2_ARCHETYPE_LABELS[run.primaryArchetype].supportName
                    }保底</span>`
                  : ''
              }
              ${
                fuelInfo.navigatorDiscountApplied
                  ? `<span class="v2-badge-info">领航员首跳免基础燃料</span>`
                  : ''
              }
              ${
                fuelInfo.rescueSurcharge > 0
                  ? `<span class="v2-badge-warn">救生舱负载 +1 燃料</span>`
                  : ''
              }
            </div>
            ${previewHtml}
            <button type="button" class="btn btn-sm btn-primary v2-jump-btn" data-jump-node="${nid}" ${
          readOnly || !canJump ? 'disabled' : ''
        }>${canJump ? `跃迁至第 ${node.layer} 层 · ${meta.label}` : '燃料不足，请安全返航'}</button>
          </div>
        `;
      })
      .join('');

    // Full 6-layer interactive DAG overview
    const layers = Array.from({ length: run.graph.maxLayers }, (_, i) => i + 1);
    const layerColsHtml = layers
      .map((layer) => {
        const laneA = Object.values(run.graph.nodes).find((n) => n.layer === layer && n.lane === 0);
        const laneB = Object.values(run.graph.nodes).find((n) => n.layer === layer && n.lane === 1);
        const renderChip = (n?: V2MapNode) => {
          if (!n) return `<div class="v2-dag-spacer"></div>`;
          const meta = NODE_TYPE_META[n.type];
          const visited = run.visitedNodeIds.includes(n.nodeId);
          const isCur = run.currentNodeId === n.nodeId;
          const isNext = reachableIds.includes(n.nodeId);
          return `<button type="button" class="v2-dag-node ${meta.cls} ${visited ? 'visited' : ''} ${
            isCur ? 'current' : ''
          } ${isNext ? 'reachable' : ''}" data-dag-node="${n.nodeId}" ${
            !isNext || readOnly || !canJump ? 'disabled' : ''
          } title="第${n.layer}层 ${meta.label}">
            <span class="v2-dag-icon">${meta.icon}</span>
            <span class="v2-dag-name">${meta.label.slice(0, 4)}</span>
            ${n.contractMarker ? '<span class="v2-dag-star" aria-label="委托目标">★</span>' : ''}
          </button>`;
        };
        return `
          <div class="v2-dag-col">
            <div class="v2-dag-layer-lbl">L${layer}</div>
            <div class="v2-dag-pair">
              ${renderChip(laneA)}
              ${renderChip(laneB)}
            </div>
          </div>
        `;
      })
      .join('');

    const canAbort =
      run.contract.status === 'active' &&
      run.contract.type !== 'free' &&
      !run.isTutorial &&
      !isContractReadyForDelivery(run, 'safe_return');

    this.leftPanelEl.innerHTML = `
      <div class="panel-header">
        <h2>分支航路图 · ${run.contract.name}</h2>
        <span class="panel-sub">航行钱包 <strong class="num">${run.wallet}¤</strong></span>
      </div>

      <div class="v2-next-nodes-list">
        ${
          nextCardsHtml ||
          `<div class="v2-empty-hint">已抵达本航次最深层，点击下方免费安全返航完成结算！</div>`
        }
      </div>

      <div class="v2-dag-box">
        <div class="v2-dag-title">全航路预览（L1–L${run.graph.maxLayers} · ★ 为委托目标节点）</div>
        <div class="v2-dag-scroll">
          <div class="v2-dag-grid">${layerColsHtml}</div>
        </div>
      </div>

      <div class="v2-map-footer-actions">
        <button type="button" class="btn btn-secondary" id="v2-btn-safe-return" ${
          readOnly ? 'disabled' : ''
        }>⚓ 免费安全返航结算</button>
        ${
          canAbort
            ? `<button type="button" class="btn btn-ghost" id="v2-btn-abort-contract" ${
                readOnly ? 'disabled' : ''
              }>放弃当前委托</button>`
            : ''
        }
      </div>
    `;

    const handleJump = (nid: string) => {
      if (!this.canMutate()) return;
      const res = selectV2MapNode(run, nid);
      if (!res.ok) {
        this.showToast(res.error ?? '无法跃迁至该节点');
        return;
      }
      this.save = { ...this.save, activeRun: res.run };
      this.persist();
      soundEngine.play('click');
      this.syncAll();
    };

    this.leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-jump-node]').forEach((btn) => {
      btn.addEventListener('click', () => handleJump(btn.dataset.jumpNode!));
    });
    this.leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-dag-node]').forEach((btn) => {
      btn.addEventListener('click', () => handleJump(btn.dataset.dagNode!));
    });

    this.leftPanelEl.querySelector('#v2-btn-safe-return')?.addEventListener('click', () => {
      if (!this.canMutate()) return;
      const res = initiateV2SafeReturnFromMap(run);
      if (!res.ok) {
        this.showToast(res.error ?? '当前无法返航');
        return;
      }
      this.save = { ...this.save, activeRun: res.run };
      this.settlementDispositions = {};
      this.persist();
      soundEngine.play('returnDock');
      this.syncAll();
    });

    this.leftPanelEl.querySelector('#v2-btn-abort-contract')?.addEventListener('click', () => {
      if (!this.canMutate()) return;
      const nextRun = abortActiveV2Contract(run);
      this.save = { ...this.save, activeRun: nextRun };
      this.persist();
      soundEngine.play('click');
      this.showToast(
        run.contract.type === 'rescue'
          ? '已放弃救援委托：已发射信标安全移交救生舱并释放船舱空位与额外燃料消耗。'
          : '已放弃当前委托（无信用点罚金），可继续自由探索或安全返航。'
      );
      this.syncAll();
    });

    this.mountV2CargoBay(run.bay, false, {
      title: `当前船舱状态 · ${V2_SHIPS[run.shipId].name}`,
      prepareMode: false,
    });
  }

  // --- 4. ENCOUNTER Phase (Combat Pre/Live + Wreck / Anomaly / Distress) ---

  private renderEncounterPhase(run: V2RunState): void {
    const node = run.currentNodeId ? run.graph.nodes[run.currentNodeId] : null;
    if (!node) return;
    const readOnly = this.isReadOnlyTab;

    // 4a. Combat / Elite Node
    if (node.combat) {
      if (run.activeCombat) {
        const sim = run.activeCombat.simulation;
        this.leftPanelEl.innerHTML = `
          <div class="panel-header">
            <h2>交火进行中 · ${NODE_TYPE_META[node.type].label}</h2>
            <span class="panel-sub">目标策略：${
              run.activeCombat.targetPolicy === 'weakest' ? '优先最弱' : '优先最大威胁'
            }</span>
          </div>
          <div class="v2-empty-hint">
            正在按确定性战斗结果回放交火演出（${sim.roundsCount} 回合）。可随时点击上方「跳过演出」直接进入战后打捞或结算。
          </div>
        `;
        this.mountV2CargoBay(run.bay, false, { title: '参战船舱配置（战斗锁定）' });
        return;
      }

      // Pre-combat tactical screen with target policy switch & exact preview
      const pv = previewV2CombatNode(run, node.nodeId, run.targetPolicy);
      this.leftPanelEl.innerHTML = `
        <div class="panel-header">
          <h2>${NODE_TYPE_META[node.type].icon} 第 ${node.layer} 层 · ${NODE_TYPE_META[node.type].label}</h2>
          <span class="panel-sub">击破赏金 +${node.combat.bounty}¤</span>
        </div>

        <div class="v2-enemy-roster">
          ${node.combat.units
            .map(
              (u) => `<div class="v2-enemy-chip ${u.isBoss ? 'is-boss' : ''}">
                <strong>${u.name}</strong>
                <span>HP ${u.maxHp} · 攻 ${u.damagePerRound}${u.armor > 0 ? ` · 护甲 ${u.armor}` : ''}${
                u.pierceRatio > 0 ? ` · 穿盾 ${Math.round(u.pierceRatio * 100)}%` : ''
              }</span>
              </div>`
            )
            .join('')}
        </div>

        <div class="v2-policy-box">
          <span class="v2-prep-label">集火目标策略（预测与实战严格同源）</span>
          <div style="display:flex;gap:8px;margin-top:6px;">
            <button type="button" class="btn btn-sm ${
              run.targetPolicy === 'weakest' ? 'btn-primary' : 'btn-secondary'
            }" data-policy="weakest" ${readOnly ? 'disabled' : ''}>优先最弱（快速减员）</button>
            <button type="button" class="btn btn-sm ${
              run.targetPolicy === 'highest_threat' ? 'btn-primary' : 'btn-secondary'
            }" data-policy="highest_threat" ${readOnly ? 'disabled' : ''}>优先最大威胁（压制高攻）</button>
          </div>
        </div>

        ${
          pv
            ? `<div class="v2-combat-preview-card ${pv.outcome === 'victory' ? 'ok' : 'danger'}">
                <div class="v2-cp-head">
                  <strong>${pv.outcome === 'victory' ? '✓ 战术推演：我方获胜' : '⚠ 战术推演：我方战败'}</strong>
                  <span class="num">${pv.roundsCount} 回合</span>
                </div>
                <div class="v2-cp-body">
                  起始耐久 ${pv.startingPlayerHp} · 护盾 ${pv.startingPlayerShield} → 战后耐久 <strong>${
                pv.finalPlayerHpAfterRepair
              }</strong>${pv.repairApplied > 0 ? `（含胜后维修 +${pv.repairApplied}）` : ''}
                </div>
                <button type="button" class="btn btn-sm btn-ghost" id="v2-toggle-log" style="margin-top:6px;">${
                  this.showCombatLogDetails ? '收起逐回合推演' : '展开逐回合推演'
                }</button>
                ${
                  this.showCombatLogDetails
                    ? `<div class="v2-combat-log-list">
                        ${pv.rounds
                          .slice(0, 12)
                          .map(
                            (r) => `<div class="v2-log-row">R${r.round}: 我方 ${
                              r.playerAttacks.reduce((s, a) => s + a.appliedDamage, 0)
                            }伤${r.counterAttack ? `+反击${r.counterAttack.appliedDamage}` : ''} · 敌方 ${
                              r.enemyAttacks.reduce((s, a) => s + a.hullDamage, 0)
                            }直伤(盾吸${r.shieldAbsorbedTotal}) → 我方 ${r.playerHpAfter}HP</div>`
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
        }>⚔ 确认战术 · 开始交火</button>
      `;

      this.leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-policy]').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (!this.canMutate()) return;
          const policy = btn.dataset.policy as V2TargetPolicy;
          this.save = {
            ...this.save,
            activeRun: { ...run, targetPolicy: policy },
          };
          this.persist();
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
        const res = startV2CombatAtCurrentNode(run, run.targetPolicy);
        if (!res.ok) {
          this.showToast(res.error ?? '无法开始战斗');
          return;
        }
        this.save = { ...this.save, activeRun: res.run };
        this.persist();
        soundEngine.play('click');
        this.syncAll();
      });

      this.mountV2CargoBay(run.bay, false, { title: '参战船舱配置' });
      return;
    }

    // 4b. Non-Combat Events (Wreck / Anomaly / Distress)
    const unaffordable = areAllEventOptionsUnaffordable(run);
    let eventBodyHtml = '';

    if (node.type === 'wreck' && node.wreck) {
      const w = node.wreck;
      const peek = run.crewId === 'salvager';
      const armDef = getAnyV2ItemDef(w.armoryItem.definitionId);
      const cargoSummary = w.cargoItems
        .map((c) => `${getAnyV2ItemDef(c.definitionId)?.name ?? c.definitionId}(${c.fixedValue}¤)`)
        .join(' + ');
      eventBodyHtml = `
        <div class="v2-event-desc">一艘失去动力的轨道运输残骸正缓缓漂过。你只有时间切开其中一个主舱室：</div>
        <div class="v2-event-choices">
          <div class="v2-event-choice-card">
            <div class="v2-ec-title">🔫 切开军械舱（获得 1 件设备）</div>
            <div class="v2-ec-meta">${
              peek && armDef
                ? `👁 拆解专家透视：<strong>${armDef.name}</strong>（${
                    w.armoryItem.quality === 'improved' ? '优良' : '普通'
                  } · ${V2_SHAPES[armDef.shapeId].label} · 回收 ${w.armoryItem.fixedValue}¤）`
                : `预计占格 ${w.armorySizeRange} · 回收区间 ${w.armoryValueRange}`
            }</div>
            <button type="button" class="btn btn-primary" data-wreck-room="armory" ${
              readOnly ? 'disabled' : ''
            }>切开军械舱</button>
          </div>
          <div class="v2-event-choice-card">
            <div class="v2-ec-title">📦 切开货舱（获得 ${w.cargoItems.length} 件货物）</div>
            <div class="v2-ec-meta">${
              peek
                ? `👁 拆解专家透视：<strong>${cargoSummary}</strong>`
                : `预计占格 ${w.cargoSizeRange} · 价值区间 ${w.cargoValueRange}`
            }</div>
            <button type="button" class="btn btn-secondary" data-wreck-room="cargo" ${
              readOnly ? 'disabled' : ''
            }>切开货舱</button>
          </div>
        </div>
      `;
    } else if (node.type === 'anomaly' && node.anomaly) {
      const a = node.anomaly;
      const canTraverse = run.fuel >= a.safeFuelCost;
      const canBreach = run.hp > a.breachHpCost;
      eventBodyHtml = `
        <div class="v2-event-desc">高能电离云团中漂浮着稀有 ${a.cargoCategoryLabel} 信号。选择平稳绕行或顶着电弧硬闯：</div>
        <div class="v2-event-choices">
          <div class="v2-event-choice-card">
            <div class="v2-ec-title">🧭 安全穿越（消耗 ${a.safeFuelCost} 燃料）</div>
            <div class="v2-ec-meta">无损获取 1 件高价货物（${
              getAnyV2ItemDef(a.safeCargoItem.definitionId)?.name ?? '货物'
            } · ${a.safeCargoItem.fixedValue}¤）</div>
            <button type="button" class="btn btn-primary" data-anomaly-opt="traverse" ${
              readOnly || !canTraverse ? 'disabled' : ''
            }>${canTraverse ? `消耗 ${a.safeFuelCost} 燃料穿越` : '燃料不足'}</button>
          </div>
          <div class="v2-event-choice-card">
            <div class="v2-ec-title">⚡ 强行破入（扣 ${a.breachHpCost} 耐久 · 需 HP > ${a.breachHpCost}）</div>
            <div class="v2-ec-meta">不耗燃料，直接带走 2 件货物（共 ${a.breachCargoItems.reduce(
              (s, c) => s + c.fixedValue,
              0
            )}¤）</div>
            <button type="button" class="btn btn-danger" data-anomaly-opt="breach" ${
              readOnly || !canBreach ? 'disabled' : ''
            }>${canBreach ? `硬闯破入 (-${a.breachHpCost} HP)` : `耐久不足（需 > ${a.breachHpCost}）`}</button>
          </div>
        </div>
      `;
    } else if (node.type === 'distress' && node.distress) {
      const d = node.distress;
      const canRescue = run.fuel >= d.rescueFuelCost;
      eventBodyHtml = `
        <div class="v2-event-desc">收到近轨道民船的断续求救信标。你可以耗油施救换取现场抢修，或优先打捞漂散货箱：</div>
        <div class="v2-event-choices">
          <div class="v2-event-choice-card">
            <div class="v2-ec-title">🚑 救援遇险船员（消耗 ${d.rescueFuelCost} 燃料）</div>
            <div class="v2-ec-meta">获救技师协助抢修舰体：立即恢复 <strong>+${d.repairAmount} 耐久</strong>（不超过上限）</div>
            <button type="button" class="btn btn-primary" data-distress-opt="rescue_crew" ${
              readOnly || !canRescue ? 'disabled' : ''
            }>${canRescue ? `施救 (-${d.rescueFuelCost} 燃料 · +${d.repairAmount} HP)` : '燃料不足'}</button>
          </div>
          <div class="v2-event-choice-card">
            <div class="v2-ec-title">📦 打捞高价货舱（不耗燃料）</div>
            <div class="v2-ec-meta">带走 1 件高价货物（${
              getAnyV2ItemDef(d.haulCargoItem.definitionId)?.name ?? '货物'
            } · ${d.haulCargoItem.fixedValue}¤）</div>
            <button type="button" class="btn btn-secondary" data-distress-opt="haul_cargo" ${
              readOnly ? 'disabled' : ''
            }>打捞高价货舱</button>
          </div>
        </div>
      `;
    }

    this.leftPanelEl.innerHTML = `
      <div class="panel-header">
        <h2>${NODE_TYPE_META[node.type].icon} 第 ${node.layer} 层 · ${NODE_TYPE_META[node.type].label}</h2>
        <span class="panel-sub">非战斗抉择</span>
      </div>
      ${eventBodyHtml}
      ${
        unaffordable
          ? `<div class="system-banner banner-warn" style="margin-top:10px;">
              <span>当前资源不足以支付任何选项，你可以安全放弃本次事件并免费返航。</span>
              <button type="button" class="btn btn-sm btn-primary" id="v2-btn-abandon-event" ${
                readOnly ? 'disabled' : ''
              }>放弃事件并安全返航</button>
            </div>`
          : `<div style="margin-top:10px;display:flex;justify-content:flex-end;">
              <button type="button" class="btn btn-sm btn-ghost" id="v2-btn-abandon-event" ${
                readOnly ? 'disabled' : ''
              }>放弃事件并免费返航</button>
            </div>`
      }
    `;

    this.leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-wreck-room]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.canMutate()) return;
        const res = resolveV2WreckChoice(
          run,
          btn.dataset.wreckRoom as 'armory' | 'cargo',
          this.save.profile.unlockedFamilies
        );
        if (!res.ok) return this.showToast(res.error ?? '操作失败');
        this.save = { ...this.save, activeRun: res.run };
        this.persist();
        soundEngine.play('place');
        this.syncAll();
      });
    });

    this.leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-anomaly-opt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.canMutate()) return;
        const res = resolveV2AnomalyChoice(run, btn.dataset.anomalyOpt as 'traverse' | 'breach');
        if (!res.ok) return this.showToast(res.error ?? '操作失败');
        this.save = { ...this.save, activeRun: res.run };
        this.persist();
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
        this.save = { ...this.save, activeRun: res.run };
        this.persist();
        soundEngine.play('place');
        this.syncAll();
      });
    });

    this.leftPanelEl.querySelector('#v2-btn-abandon-event')?.addEventListener('click', () => {
      if (!this.canMutate()) return;
      const res = abandonV2EventAndReturn(run);
      if (!res.ok) return this.showToast(res.error ?? '无法放弃返航');
      this.save = { ...this.save, activeRun: res.run };
      this.settlementDispositions = {};
      this.persist();
      soundEngine.play('returnDock');
      this.syncAll();
    });

    this.mountV2CargoBay(run.bay, false, { title: '当前船舱一览' });
  }

  // --- 5. SHOP Phase (Mobile Merchant) ---

  private renderShopPhase(run: V2RunState): void {
    const node = run.currentNodeId ? run.graph.nodes[run.currentNodeId] : null;
    const shop = node?.merchant;
    if (!node || !shop) return;
    const readOnly = this.isReadOnlyTab;

    // Only loot items are sellable at Merchant (strictly excludes loan/owned/mission, AC06!)
    const sellableLoot = [
      ...run.bay.placed.map((p) => p.item),
      ...run.bay.staging.map((s) => s.item),
    ].filter((it) => it.origin === 'loot');

    this.leftPanelEl.innerHTML = `
      <div class="panel-header">
        <h2>⚖ 流动商人补给站</h2>
        <span class="panel-sub">航行钱包 <strong class="num">${run.wallet}¤</strong></span>
      </div>

      <div class="v2-shop-section">
        <div class="v2-prep-label">限购设备（2 件固定货单 · 刷新不变）</div>
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
          }>⛽ 燃料 +${shop.fuelAmount}（${shop.fuelBought ? '已购' : `${shop.fuelPrice}¤`}）</button>
          <button type="button" class="btn btn-sm btn-secondary" id="v2-shop-repair" ${
            readOnly || shop.repairBought || run.wallet < shop.repairPrice || run.hp >= run.maxHp
              ? 'disabled'
              : ''
          }>🔧 维修 +${shop.repairAmount} HP（${shop.repairBought ? '已购' : `${shop.repairPrice}¤`}）</button>
        </div>
      </div>

      <div class="v2-shop-section">
        <div class="v2-prep-label">向商人变卖拾获物（按 50% 收购 · 借用/自有/任务物禁售）</div>
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
        this.save = { ...this.save, activeRun: res.run };
        this.persist();
        soundEngine.play('place');
        this.syncAll();
      });
    });

    this.leftPanelEl.querySelector('#v2-shop-fuel')?.addEventListener('click', () => {
      if (!this.canMutate()) return;
      const res = buyV2MerchantFuel(run, `tx_fuel_${node.nodeId}`);
      if (!res.ok) return this.showToast(res.error ?? '无法购买燃料');
      this.save = { ...this.save, activeRun: res.run };
      this.persist();
      soundEngine.play('click');
      this.syncAll();
    });

    this.leftPanelEl.querySelector('#v2-shop-repair')?.addEventListener('click', () => {
      if (!this.canMutate()) return;
      const res = buyV2MerchantRepair(run, `tx_repair_${node.nodeId}`);
      if (!res.ok) return this.showToast(res.error ?? '无法购买维修');
      this.save = { ...this.save, activeRun: res.run };
      this.persist();
      soundEngine.play('click');
      this.syncAll();
    });

    this.leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-sell-loot]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.canMutate()) return;
        const iid = btn.dataset.sellLoot!;
        const res = sellV2ItemToMerchant(run, iid, `tx_sell_${node.nodeId}_${iid}`);
        if (!res.ok) return this.showToast(res.error ?? '出售失败');
        this.save = { ...this.save, activeRun: res.run };
        this.persist();
        soundEngine.play('click');
        this.syncAll();
      });
    });

    this.leftPanelEl.querySelector('#v2-shop-finish')?.addEventListener('click', () => {
      if (!this.canMutate()) return;
      const res = finishV2MerchantVisit(run);
      if (!res.ok) return this.showToast(res.error ?? '无法离开商人节点');
      this.save = { ...this.save, activeRun: res.run };
      this.persist();
      soundEngine.play('click');
      this.syncAll();
    });

    this.mountV2CargoBay(run.bay, !readOnly, {
      title: '商人节点船舱整理',
      onChange: (nextBay) => {
        if (!this.canMutate()) return;
        this.save = { ...this.save, activeRun: { ...run, bay: nextBay } };
        this.persist();
        this.syncAll();
      },
    });
  }

  // --- 6. REWARD Phase (Post-Combat 3-Choice Salvage) ---

  private renderRewardPhase(run: V2RunState): void {
    const bundle = run.pendingReward;
    if (!bundle) return;
    const readOnly = this.isReadOnlyTab;
    const eqDef = V2_EQUIPMENT_DEFS[bundle.equipmentOption.definitionId];
    const cargoDef = getAnyV2ItemDef(bundle.cargoOption.definitionId);

    this.leftPanelEl.innerHTML = `
      <div class="panel-header">
        <h2>✦ 战斗胜利 · 3 选 1 战利品</h2>
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
              eqDef ? `${renderV2MiniMaskHtml(eqDef.shapeId)} ${V2_SHAPES[eqDef.shapeId].label} · ${eqDef.summary}` : ''
            }</div>
            <div class="v2-reward-val">回收价 ${bundle.equipmentOption.fixedValue}¤ · 返航可入库/研究</div>
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
            <div class="v2-reward-val">返航售价 <strong>${bundle.cargoOption.fixedValue}¤</strong></div>
          </div>
        </button>

        <button type="button" class="v2-reward-card" data-pick-reward="repair" ${
          readOnly ? 'disabled' : ''
        }>
          <div class="v2-reward-repair-icon">🔧</div>
          <div class="v2-reward-info">
            <div class="v2-reward-title">战地抢修：恢复 +${bundle.repairAmount} 耐久</div>
            <div class="v2-reward-sub">当前耐久 ${run.hp}/${run.maxHp} · 不占船舱格位</div>
            <div class="v2-reward-val">稳健推进深层的可靠选择</div>
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
        this.save = { ...this.save, activeRun: res.run };
        this.persist();
        soundEngine.play('place');
        this.syncAll();
      });
    });

    this.mountV2CargoBay(run.bay, false, { title: '当前船舱参考（规划空间）' });
  }

  // --- 7. ARRANGE Phase (Full Grid + Engineer Swap + Survey Scan + Discard Confirm) ---

  private renderArrangePhase(run: V2RunState): void {
    const readOnly = this.isReadOnlyTab;
    const surveyCheck = canPerformSurveyAtCurrentNode(run);
    const terminal = isAtTerminalLayer(run);
    const hasStaging = run.bay.staging.length > 0;
    const engOffer = run.activeEngineerOffer && !run.activeEngineerOffer.used ? run.activeEngineerOffer : null;
    const currentLayer = run.currentNodeId ? run.graph.nodes[run.currentNodeId]?.layer ?? 0 : 0;
    const canAbort =
      run.contract.status === 'active' &&
      run.contract.type !== 'free' &&
      (!run.isTutorial || currentLayer >= 3) &&
      !isContractReadyForDelivery(run, 'safe_return');

    this.leftPanelEl.innerHTML = `
      <div class="panel-header">
        <h2>船舱整理 · 空间与联动取舍</h2>
        <span class="panel-sub">${
          hasStaging ? `⚠ 暂存区剩 ${run.bay.staging.length} 件待处理` : '✓ 暂存区已清空'
        }</span>
      </div>

      ${
        engOffer
          ? `<div class="v2-engineer-banner">
              <div class="v2-eng-title">🛠 改装工程师技能：将本趟首件获得设备免费改装为其他普通蓝图（每趟 1 次）</div>
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
                <strong>📡 委托标定勘测点</strong>
                <div style="font-size:12px;color:var(--text-secondary);">消耗 ${run.contract.surveyFuelCost} 燃料完成本点位测绘（已完成 ${run.contract.completedNodeIds.length}/${run.contract.requiredCompletions}）</div>
              </div>
              <button type="button" class="btn btn-sm btn-primary" id="v2-btn-survey-scan" ${
                readOnly ? 'disabled' : ''
              }>执行勘测 (-${run.contract.surveyFuelCost} 燃料)</button>
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
        ? '⚓ 抵达终层 · 进入返航结算'
        : '▶ 整理完毕 · 返回分支航路'
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
        this.save = { ...this.save, activeRun: res.run };
        this.persist();
        soundEngine.play('place');
        this.showToast(`工程师已将设备改装为「${getV2EquipmentDefByKind(kind, 'common').name}」！`);
        this.syncAll();
      });
    });

    this.leftPanelEl.querySelector('#v2-btn-survey-scan')?.addEventListener('click', () => {
      if (!this.canMutate()) return;
      const res = performSurveyAtCurrentNode(run);
      if (!res.ok) return this.showToast(res.reason ?? '无法执行勘测');
      this.save = { ...this.save, activeRun: res.run };
      this.persist();
      soundEngine.play('energyLink');
      this.showToast('航迹勘测完成！进度已记录。');
      this.syncAll();
    });

    this.leftPanelEl.querySelector('#v2-arrange-abort')?.addEventListener('click', () => {
      if (!this.canMutate()) return;
      const nextRun = abortActiveV2Contract(run);
      this.save = { ...this.save, activeRun: nextRun };
      this.persist();
      soundEngine.play('click');
      this.showToast('已放弃当前委托。');
      this.syncAll();
    });

    this.leftPanelEl.querySelector('#v2-btn-leave-arrange')?.addEventListener('click', () => {
      if (!this.canMutate()) return;
      const proceed = () => {
        const res = finishV2ArrangeAndProceed(run, terminal ? 'safe_return' : 'map');
        if (!res.ok) {
          this.showToast(res.error ?? '当前无法离开整理');
          return;
        }
        this.save = { ...this.save, activeRun: res.run };
        if (res.run.phase === 'SETTLEMENT') {
          this.settlementDispositions = {};
        }
        this.persist();
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
      onChange: (nextBay) => {
        if (!this.canMutate()) return;
        this.save = { ...this.save, activeRun: { ...run, bay: nextBay } };
        this.persist();
        this.syncAll();
      },
    });
  }

  // --- 8. SETTLEMENT Phase (Unified Receipt + Mutually Exclusive Per-Item Disposition) ---

  private dispositionLabel(d: V2SettlementDisposition, fixedValue: number): string {
    switch (d) {
      case 'deliver':
        return '交付委托';
      case 'sell':
        return `出售 +${fixedValue}¤`;
      case 'store':
        return '入设备库';
      case 'keep_relic':
        return '保留藏品';
      case 'return_loan':
        return '归还借用';
    }
  }

  private renderSettlementPhase(run: V2RunState): void {
    const p = this.save.profile;
    const readOnly = this.isReadOnlyTab;
    const summary = calculateV2Settlement(run, p, this.settlementDispositions);
    const isSafe = summary.reason === 'safe_return';

    this.leftPanelEl.innerHTML = `
      <div class="panel-header">
        <h2>${isSafe ? '⚓ 安全返航结算单' : '⚠ 战败紧急回收结算'}</h2>
        <span class="panel-sub">单一口径 · 与顶部 HUD 实时同步</span>
      </div>

      ${
        isSafe
          ? `<div class="v2-settle-banner ${summary.contractCompleted ? 'ok' : ''}">
              <strong>${
                summary.contractCompleted
                  ? run.isTutorial
                    ? '✦ 首航教学大件交付成功！免费启用工作台与委托终端'
                    : `✦ 委托「${run.contract.name}」交付成功！`
                  : run.contract.type === 'free'
                  ? '自由打捞安全返航'
                  : `委托「${run.contract.name}」未完成（无信用点罚金）`
              }</strong>
            </div>`
          : `<div class="system-banner banner-danger" style="margin-bottom:8px;">
              舰体损毁由拖船拖回。按规则折算 40%（含钱包与非借用物估价），本次携带的 ${summary.lostOwnedCount} 件自有设备与 ${summary.lostLootCount} 件拾获物已损失；<strong>基地设备库原有库存不受影响</strong>。
            </div>`
      }

      <div class="v2-settle-totals">
        <div class="v2-mig-row"><span>航行钱包结余</span><strong class="num">${summary.walletCredits}¤</strong></div>
        ${
          isSafe
            ? `
              <div class="v2-mig-row"><span>本次出售物品收益</span><strong class="num">+${summary.soldItemsCredits}¤</strong></div>
              ${
                summary.contractRewardCredits > 0
                  ? `<div class="v2-mig-row"><span>委托交付奖金</span><strong class="num">+${summary.contractRewardCredits}¤</strong></div>`
                  : ''
              }
              ${
                summary.tutorialBonusCredits > 0
                  ? `<div class="v2-mig-row"><span>首航教学交付奖励</span><strong class="num">+${summary.tutorialBonusCredits}¤</strong></div>`
                  : ''
              }
              <div class="v2-mig-row"><span>入库后设备库容量</span><strong class="num ${
                summary.warehouseOverflow ? 'text-danger' : ''
              }">${summary.warehouseProjectedCount}/${V2_WAREHOUSE_CAPACITY}</strong></div>
            `
            : `<div class="v2-mig-row"><span>可回收总额 × 40%</span><strong class="num">${summary.defeatRecoverableBase} × 40%</strong></div>`
        }
        <div class="v2-mig-row total"><span>本次实得总计</span><strong class="num">+${summary.finalCreditsEarned}¤</strong></div>
      </div>

      ${
        summary.warehouseOverflow
          ? `<div class="system-banner banner-danger" style="margin:8px 0;">
              设备库容量超出上限（${summary.warehouseProjectedCount}/${V2_WAREHOUSE_CAPACITY}），请将下方部分「入设备库」改为「出售」后再确认入账。
            </div>`
          : ''
      }

      <div class="v2-settle-items">
        <div class="v2-prep-label">舱内物品去向清点（每件互斥择一）</div>
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
                          }>${this.dispositionLabel(d, line.item.fixedValue)}</button>`
                        )
                        .join('')}
                    </div>
                  </div>`
                )
                .join('')
        }
      </div>

      <button type="button" class="btn btn-primary btn-launch-hero" id="v2-btn-confirm-settle" ${
        readOnly || summary.warehouseOverflow ? 'disabled' : ''
      }>${readOnly ? '只读锁定' : '▶ 确认入账 · 返回拆解站'}</button>
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

      // Authoritative payout & persistence strictly BEFORE visual docking playback!
      this.save = {
        ...this.save,
        profile: result.profile,
        activeRun: null,
      };
      this.settlementDispositions = {};
      this.persist();

      soundEngine.play(result.summary.contractCompleted ? 'contractDeliver' : 'returnDock');

      const unlockedParts = [
        result.unlockedFamilyName ? `解锁设备体系：${result.unlockedFamilyName}` : null,
        result.unlockedCrewName ? `解锁船员：${result.unlockedCrewName}` : null,
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
            this.renderBaseSceneOverlay();
          },
          onFinish: () => {
            if (this.activeDockingNotice !== notice) return;
            notice.animating = false;
            notice.progress = 1;
            this.renderTopHud();
            this.renderBaseSceneOverlay();
          },
        });
      }
    });

    this.mountV2CargoBay(run.bay, false, {
      title: isSafe ? '返航船舱清点' : '战败前最终布局',
    });
  }

  // --- Shared Right-Panel CargoGridV2 Mount ---

  private mountV2CargoBay(
    bay: V2CargoBayState,
    editable: boolean,
    opts: {
      readonly title: string;
      readonly prepareMode?: boolean;
      readonly onChange?: (nextBay: V2CargoBayState) => void;
      readonly onPrepareRemove?: (instanceId: string) => void;
    }
  ): void {
    this.rightPanelEl.innerHTML = `
      <div class="panel-header">
        <h2>${opts.title}</h2>
        <span class="panel-sub">${editable ? '可编辑' : '只读预览'}</span>
      </div>
      <div class="cargo-mount-root" id="v2-cargo-mount"></div>
    `;
    const mount = this.rightPanelEl.querySelector<HTMLElement>('#v2-cargo-mount')!;
    this.cargoGrid?.destroy();
    this.cargoGrid = new CargoGridV2Component(mount, {
      onBayChange: (nextBay) => opts.onChange?.(nextBay),
      onPrepareRemoveItem: (id) => opts.onPrepareRemove?.(id),
    });
    this.cargoGrid.render(bay, editable, { prepareMode: opts.prepareMode });
  }

  // --- Modal Launchers ---

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
        this.prepareDraft = null;
        this.activeDockingNotice = null;
        this.persist();
        soundEngine.play('click');
        this.showToast('V2 存档已重置（旧版 V1 存档不受影响）。');
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
          return { ok: false, error: '当前标签页为只读模式' };
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
          return { ok: false, error: '当前标签页为只读模式' };
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
          return { ok: false, error: '当前标签页为只读模式' };
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
          return { ok: false, error: '当前标签页为只读模式' };
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
          return { ok: false, error: '当前标签页为只读模式' };
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
          return { ok: false, error: '当前标签页为只读模式' };
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
      onStartFreshV2: () => {
        this.migrationPromptDismissed = true;
        this.syncAll();
      },
      onConfirmMigrate: () => {
        if (this.isReadOnlyTab || !this.tabGuard.canWrite()) return;
        if (!this.v1Inspection.v1Save) return;
        const migrated = migrateV1ToV2SaveData(this.v1Inspection.v1Save, this.save);
        this.save = migrated;
        this.prepareDraft = null;
        this.persist();
        soundEngine.play('contractDeliver');
        this.showToast(
          `V1 存档迁移完成！当前 V2 信用点 ${migrated.profile.credits}¤（旧版 starline_save_v1 原样保留）。`
        );
        this.syncAll();
      },
    });
  }
}

export function createEmptyV2BayForDebug(shipId: V2ShipId): V2CargoBayState {
  return createEmptyV2Bay(shipId);
}
