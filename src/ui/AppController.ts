import {
  getEnemyShipImageUrl,
  getItemImageUrl,
  getPlayerShipImageUrl,
  getTitleKeyArtUrl,
} from '../assets/itemArt';
import { soundEngine } from '../audio/soundEngine';
import { BUILDINGS, RELICS, RELIC_ORDER, type BuildingId } from '../data/buildings';
import { LOADOUTS, getItemDef, type LoadoutId } from '../data/items';
import {
  REGIONS,
  getNodeConfig,
  type RegionId,
  type RouteType,
  type SectorBgIndex,
} from '../data/nodes';
import { SHAPES } from '../data/shapes';
import { TUTORIAL_MAX_RECOMMENDED_NODE, TUTORIAL_SCRIPT } from '../data/tutorial';
import { calculateBuildStats } from '../domain/buildStats';
import type { CombatRoundEvent } from '../domain/combat';
import {
  applyExpeditionSettlement,
  calculateSettlement,
  purchaseBuilding,
  restoreRelic,
} from '../domain/economy';
import {
  canLeaveArrange,
  completeCombat,
  getRoutePreview,
  initiateSafeReturn,
  isAtFinalNode,
  isCargoBayEditable,
  proceedToNextNode,
  selectReward,
  selectRoute,
  startExpedition,
  updateArrangeBay,
  type ExpeditionState,
} from '../domain/expedition';
import {
  clearSaveData,
  createFreshSaveData,
  loadSaveData,
  persistSaveData,
  type SaveData,
} from '../domain/persistence';
import {
  canBuildFacility,
  getCodexSummary,
  getRelicCollectionSummary,
  getVisibleBuildings,
  isLoadoutUnlocked,
  isRegionUnlocked,
  type GameSettings,
} from '../domain/progression';
import { MultiTabGuard } from '../domain/tabLock';
import { PhaserHost } from '../scenes/PhaserHost';
import { CargoGridComponent, renderMiniMaskHtml } from './CargoGrid';
import {
  hasOpenModal,
  openBackupRecoveryModal,
  openCodexModal,
  openDiscardConfirmModal,
  openHelpModal,
  openRelicGalleryModal,
  openSettingsModal,
  registerModalBackgroundRoot,
} from './Modals';

const TITLE_SESSION_KEY = 'starline_title_entered_v3';

interface ReturnDockingNotice {
  readonly creditsBefore: number;
  readonly creditsAfter: number;
  readonly earnedCredits: number;
  readonly crateCount: number;
  readonly hasKeptRelic: boolean;
  readonly wasDefeat: boolean;
  readonly goalHint: string;
  animating: boolean;
  progress: number;
}

export class AppController {
  private readonly mountEl: HTMLElement;
  private save: SaveData;
  private phaserHost: PhaserHost | null = null;
  private cargoGrid: CargoGridComponent | null = null;
  private tabGuard: MultiTabGuard;

  private isReadOnlyTab = false;
  private storageError: string | null = null;
  private recentlyBuiltId: BuildingId | null = null;
  private keptCollectibleIds = new Set<string>();
  /** null = automatic responsive default (collapsed on compact viewports during ARRANGE, F06) */
  private sceneCollapseOverride: boolean | null = null;
  /** Pure presentation state for F11 return-to-port docking & unloading (never owns payout!) */
  private activeDockingNotice: ReturnDockingNotice | null = null;
  /** True once the player enters from the Title Screen in the current browser session */
  private titleEntered = false;

  // Live combat playback display values
  private liveCombatPlayerHp = 30;
  private liveCombatPlayerShield = 0;
  private liveCombatEnemyHp = 0;
  private liveCombatRound = 0;
  private activeCombatPlaybackKey: string | null = null;

  // Persistent DOM containers so Phaser canvas stays mounted without flicker!
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

  constructor(mountEl: HTMLElement) {
    this.mountEl = mountEl;
    this.save = createFreshSaveData();

    this.tabGuard = new MultiTabGuard((isOwner) => {
      this.isReadOnlyTab = !isOwner;
      this.phaserHost?.setCombatPaused(this.isReadOnlyTab);
      this.syncAll();
    });
  }

  private canMutate(): boolean {
    return !this.isReadOnlyTab && this.tabGuard.canWrite();
  }

  private isCompactViewport(): boolean {
    return window.innerWidth < 820 || window.innerHeight <= 700;
  }

  private isArrangeSceneCollapsed(): boolean {
    if (this.sceneCollapseOverride !== null) return this.sceneCollapseOverride;
    return this.isCompactViewport();
  }

  private readTitleEnteredSession(): boolean {
    try {
      return window.sessionStorage.getItem(TITLE_SESSION_KEY) === '1';
    } catch {
      return false;
    }
  }

  private writeTitleEnteredSession(entered: boolean): void {
    try {
      if (entered) window.sessionStorage.setItem(TITLE_SESSION_KEY, '1');
      else window.sessionStorage.removeItem(TITLE_SESSION_KEY);
    } catch {
      // Ignore restricted sessionStorage
    }
  }

  init(): void {
    this.buildShellDom();
    this.titleEntered = this.readTitleEnteredSession();

    const loaded = loadSaveData(window.localStorage);
    if (loaded.status === 'loaded' || loaded.status === 'fresh') {
      this.save = loaded.data;
    } else if (loaded.status === 'corrupt_with_backup') {
      this.save = loaded.backup;
      // Never hide F03 backup recovery dialog behind Title Screen
      this.titleEntered = true;
      openBackupRecoveryModal(
        this.modalHostEl,
        loaded.error,
        loaded.backup.progression.credits,
        () => {
          this.save = loaded.backup;
          this.persist();
          this.syncAll();
        },
        () => {
          this.save = createFreshSaveData();
          this.persist();
          this.syncAll();
        }
      );
    } else {
      this.save = loaded.data;
      this.storageError = `存档异常已启用新档：${loaded.error}`;
    }

    this.isReadOnlyTab = !this.tabGuard.start();
    this.applyBodySettings(this.save.settings);
    soundEngine.setMute(this.save.settings.sfxMuted, this.save.settings.bgmMuted);

    // Mount Phaser inside persistent canvas host (PhaserHost owns ResizeObserver, F07)
    this.phaserHost = new PhaserHost(this.sceneCanvasHostEl);
    this.phaserHost.setCombatPaused(this.isReadOnlyTab);
    this.phaserHost.onBuildingClick((buildingId) => {
      if (this.save.activeExpedition) return;
      this.handleBuildingInteract(buildingId);
    });

    // Re-evaluate compact ARRANGE scene collapse automatically on orientation/viewport transitions
    window.addEventListener('resize', () => {
      if (this.save.activeExpedition?.phase === 'ARRANGE' && this.sceneCollapseOverride === null) {
        const collapsed = this.isArrangeSceneCollapsed();
        const shouldHide = collapsed;
        const currentlyHidden = this.sceneWrapEl.classList.contains('collapsed');
        if (shouldHide !== currentlyHidden) {
          this.sceneWrapEl.className = `scene-stage-wrap mode-arrange ${shouldHide ? 'collapsed' : ''}`;
          this.renderTopHud();
          this.phaserHost?.resize();
        }
      }
    });

    this.syncAll();
  }

  private buildShellDom(): void {
    this.mountEl.innerHTML = '';
    const shell = document.createElement('div');
    shell.className = 'app-shell';
    this.appShellEl = shell;

    this.topHudEl = document.createElement('header');
    this.topHudEl.className = 'top-hud';

    this.bannersEl = document.createElement('div');
    this.bannersEl.style.display = 'flex';
    this.bannersEl.style.flexDirection = 'column';
    this.bannersEl.style.gap = '6px';

    const mainLayout = document.createElement('main');
    mainLayout.className = 'main-layout';
    this.mainLayoutEl = mainLayout;

    const sceneCol = document.createElement('section');
    sceneCol.className = 'scene-column';

    this.sceneWrapEl = document.createElement('div');
    this.sceneWrapEl.className = 'scene-stage-wrap mode-base';

    this.sceneCanvasHostEl = document.createElement('div');
    this.sceneCanvasHostEl.id = 'scene-canvas-host';

    this.sceneOverlayEl = document.createElement('div');

    this.sceneWrapEl.appendChild(this.sceneCanvasHostEl);
    this.sceneWrapEl.appendChild(this.sceneOverlayEl);

    this.leftPanelEl = document.createElement('div');
    this.leftPanelEl.className = 'left-panel-slot';
    this.leftPanelEl.style.display = 'flex';
    this.leftPanelEl.style.flexDirection = 'column';
    this.leftPanelEl.style.gap = '10px';

    sceneCol.appendChild(this.sceneWrapEl);
    sceneCol.appendChild(this.leftPanelEl);

    this.rightPanelEl = document.createElement('section');
    this.rightPanelEl.className = 'work-column';

    mainLayout.appendChild(sceneCol);
    mainLayout.appendChild(this.rightPanelEl);

    shell.appendChild(this.topHudEl);
    shell.appendChild(this.bannersEl);
    shell.appendChild(mainLayout);

    // Full-viewport Title Screen overlay sibling (does not unmount Phaser canvas!)
    this.titleHostEl = document.createElement('div');
    this.titleHostEl.id = 'title-host';
    this.titleHostEl.hidden = true;

    // Mount modalHostEl as a SIBLING of app-shell so making app-shell inert isolates background cleanly!
    this.modalHostEl = document.createElement('div');
    this.modalHostEl.id = 'modal-host';

    this.mountEl.appendChild(shell);
    this.mountEl.appendChild(this.titleHostEl);
    this.mountEl.appendChild(this.modalHostEl);
    registerModalBackgroundRoot([this.appShellEl, this.titleHostEl]);
  }

  private applyBodySettings(settings: GameSettings): void {
    document.body.classList.toggle('reduced-motion', settings.reducedMotion);
    document.body.classList.toggle('low-quality', settings.lowQuality);
    soundEngine.setMute(settings.sfxMuted, settings.bgmMuted);
    this.phaserHost?.updateCombatSettings(settings);
  }

  private persist(): void {
    if (!this.canMutate()) return;
    const res = persistSaveData(window.localStorage, this.save);
    if (!res.ok) {
      this.storageError = `存档写入失败：${res.error ?? '未知错误'}（当前进度仅保留在内存）`;
    } else {
      this.storageError = null;
    }
  }

  private computeNextBuildGoalHint(): string {
    const prog = this.save.progression;
    const order: BuildingId[] = ['workbench', 'display', 'drydock'];
    for (const id of order) {
      if (!prog.buildings[id]) {
        const def = BUILDINGS[id];
        if (prog.credits >= def.cost) {
          return `余额已够修复「${def.name}」(${def.cost} 信用点)！`;
        }
        return `距「${def.name}」还差 ${def.cost - prog.credits} 信用点`;
      }
    }
    const relicSum = getRelicCollectionSummary(prog);
    if (prog.buildings.display && relicSum.restoredCount < relicSum.totalCount) {
      if (relicSum.restorableIds.length > 0) {
        const first = RELICS[relicSum.restorableIds[0]];
        return `陈列馆可修复「${first.name}」(${first.restoreCost}¤)！`;
      }
      for (const rid of RELIC_ORDER) {
        const st = prog.relics[rid];
        if (st && !st.restored && st.storedCount > 0) {
          const def = RELICS[rid];
          return `距修复「${def.name}」还差 ${def.restoreCost - prog.credits} 信用点`;
        }
      }
      return `深空打捞稀有废宝可点亮展台 (${relicSum.restoredCount}/${relicSum.totalCount})`;
    }
    return '拆解站设施与 4 件深空藏品已全部点亮！';
  }

  private renderDockingOverlay(): void {
    const notice = this.activeDockingNotice;
    if (!notice || !notice.animating || this.save.activeExpedition) {
      if (!this.save.activeExpedition) {
        this.sceneOverlayEl.innerHTML = '';
      }
      return;
    }

    const p = Math.max(0, Math.min(1, notice.progress));
    const stageText =
      p < 0.48
        ? notice.wasDefeat
          ? '救援拖船护送进港中…'
          : '打捞船正在靠泊停机坪…'
        : p < 0.86
        ? '自动卸载货物并清点入账…'
        : '信用点已汇入基地账户！';
    const displayCredits = Math.round(
      notice.creditsBefore + (notice.creditsAfter - notice.creditsBefore) * Math.min(1, p / 0.9)
    );

    const hudCredits = this.topHudEl.querySelector('#hud-credits');
    if (hudCredits) {
      hudCredits.textContent = String(displayCredits);
    }

    let overlay = this.sceneOverlayEl.querySelector<HTMLElement>('.docking-overlay');
    if (!overlay) {
      this.sceneOverlayEl.innerHTML = `
        <div class="docking-overlay" role="status" aria-live="polite">
          <div class="docking-banner">
            <div>
              <div id="docking-stage-text" style="font-weight:700;font-size:13px;color:var(--accent-action);"></div>
              <div style="font-size:12px;color:var(--text-primary);">
                本次入账 <strong class="num" style="color:var(--accent-action);">+${notice.earnedCredits}</strong>${
                  notice.hasKeptRelic ? ' · 藏品已转入展台仓库' : ''
                } · ${notice.goalHint}
              </div>
            </div>
            <button type="button" class="btn btn-compact" id="btn-skip-docking">跳过演出</button>
          </div>
          <div class="docking-progress-track">
            <div class="docking-progress-fill" id="docking-progress-fill" style="width:0%"></div>
          </div>
        </div>
      `;
      this.sceneOverlayEl.querySelector('#btn-skip-docking')?.addEventListener('click', () => {
        this.phaserHost?.skipBaseReturnDocking();
      });
      overlay = this.sceneOverlayEl.querySelector<HTMLElement>('.docking-overlay');
    }

    const stageEl = overlay?.querySelector<HTMLElement>('#docking-stage-text');
    if (stageEl) stageEl.textContent = stageText;
    const fillEl = overlay?.querySelector<HTMLElement>('#docking-progress-fill');
    if (fillEl) fillEl.style.width = `${Math.round(p * 100)}%`;
  }

  private getSectorIndex(exp: ExpeditionState): SectorBgIndex {
    const cfg = getNodeConfig(exp.currentNode);
    return (exp.regionId ?? 'standard') === 'abyssal' ? cfg.abyssalSectorBg : cfg.sectorBg;
  }

  private performTabTakeover(): void {
    this.tabGuard.takeOver();
    this.isReadOnlyTab = false;
    this.activeCombatPlaybackKey = null;
    this.keptCollectibleIds.clear();
    // Reload latest persisted valid state from storage on takeover (F02)
    const reloaded = loadSaveData(window.localStorage);
    if (reloaded.status === 'loaded' || reloaded.status === 'fresh') {
      this.save = reloaded.data;
    } else if (reloaded.status === 'corrupt_with_backup') {
      this.save = reloaded.backup;
      this.titleEntered = true;
      openBackupRecoveryModal(
        this.modalHostEl,
        reloaded.error,
        reloaded.backup.progression.credits,
        () => {
          this.save = reloaded.backup;
          this.persist();
          this.syncAll();
        },
        () => {
          this.save = createFreshSaveData();
          this.persist();
          this.syncAll();
        }
      );
    }
    this.applyBodySettings(this.save.settings);
    this.phaserHost?.setCombatPaused(false);
    this.syncAll();
  }

  private renderTitleScreen(): void {
    const shell = this.appShellEl as HTMLElement & { inert?: boolean };
    if (this.titleEntered) {
      delete this.appShellEl.dataset.titleLocked;
      if (!hasOpenModal()) {
        if ('inert' in shell) shell.inert = false;
        this.appShellEl.removeAttribute('aria-hidden');
      }
      this.titleHostEl.hidden = true;
      this.titleHostEl.innerHTML = '';
      return;
    }

    this.appShellEl.dataset.titleLocked = '1';
    if ('inert' in shell) shell.inert = true;
    this.appShellEl.setAttribute('aria-hidden', 'true');

    const prog = this.save.progression;
    const exp = this.save.activeExpedition;
    const codex = getCodexSummary(prog);
    const relicSum = getRelicCollectionSummary(prog);
    const hasProgress =
      Boolean(exp) ||
      prog.totalExpeditions > 0 ||
      prog.credits > 0 ||
      prog.buildings.workbench;

    const primaryLabel = exp
      ? `▶ 恢复航次（第 ${exp.currentNode}/${exp.maxNodes} 站）`
      : hasProgress
      ? '▶ 进入拆解站'
      : '▶ 启动打捞航程';

    this.titleHostEl.hidden = false;
    this.titleHostEl.innerHTML = `
      <div class="title-screen" role="region" aria-label="游戏开场标题界面">
        <img class="title-bg-art" src="${getTitleKeyArtUrl()}" alt="星际拆解站轨道港湾与出航打捞船" />
        <div class="title-scrim"></div>
        <div class="title-content">
          <div class="title-top-bar">
            <span class="title-edition-badge">STARLINE · 深空拓荒版</span>
            <div class="title-top-actions">
              ${
                prog.buildings.workbench
                  ? `<button type="button" class="btn btn-compact title-ghost-btn" id="btn-title-codex">图鉴</button>`
                  : ''
              }
              <button type="button" class="btn btn-compact title-ghost-btn" id="btn-title-help">说明</button>
              <button type="button" class="btn btn-compact title-ghost-btn" id="btn-title-settings">设置</button>
            </div>
          </div>

          <div class="title-hero-block">
            <div class="title-kicker">ORBITAL SALVAGE · 4×4 TACTICAL BAY</div>
            <h1 class="title-main-heading">星际拆解站</h1>
            <p class="title-tagline">拼装 4×4 船舱 · 穿梭六大残骸星域 · 击溃旗舰 BOSS · 点亮深空藏品馆</p>

            ${
              this.isReadOnlyTab
                ? `<div class="system-banner banner-warn title-ro-banner" role="status">
                    <span>检测到另一标签页运行中（当前为只读模式）</span>
                    <button type="button" class="btn btn-primary btn-compact" id="btn-title-takeover">接管控制权</button>
                  </div>`
                : ''
            }

            ${
              hasProgress
                ? `<div class="title-archive-pills num">
                    <span class="title-stat-pill accent">信用点 <strong>${prog.credits}</strong></span>
                    <span class="title-stat-pill energy">藏品 <strong>${relicSum.restoredCount}/${relicSum.totalCount}</strong></span>
                    <span class="title-stat-pill">图鉴 <strong>${codex.completionPercent}%</strong></span>
                    <span class="title-stat-pill">最深 <strong>${prog.deepestNodeReached}/6</strong></span>
                  </div>`
                : `<div class="title-feature-chips">
                    <span>6 大手绘星域</span>
                    <span>双 BOSS 旗舰</span>
                    <span>4 件稀有藏品</span>
                    <span>离线本地存档</span>
                  </div>`
            }

            <div class="title-cta-row">
              <button type="button" class="btn btn-primary title-start-btn" id="btn-enter-game">
                ${primaryLabel}
              </button>
            </div>
          </div>

          <div class="title-footer-meta">
            <span>支持触控 / 鼠标 / 纯键盘操作</span>
            <span>点击「进入」即开启深空环境音</span>
          </div>
        </div>
      </div>
    `;

    this.titleHostEl.querySelector('#btn-enter-game')?.addEventListener('click', () => {
      soundEngine.unlock();
      soundEngine.play('warpJump');
      this.titleEntered = true;
      this.writeTitleEnteredSession(true);
      this.syncAll();
    });

    this.titleHostEl.querySelector('#btn-title-takeover')?.addEventListener('click', () => {
      this.performTabTakeover();
    });

    this.titleHostEl.querySelector('#btn-title-codex')?.addEventListener('click', () => {
      soundEngine.play('click');
      this.openCodexModal();
    });

    this.titleHostEl.querySelector('#btn-title-help')?.addEventListener('click', () => {
      soundEngine.play('click');
      openHelpModal(this.modalHostEl);
    });

    this.titleHostEl.querySelector('#btn-title-settings')?.addEventListener('click', () => {
      soundEngine.play('click');
      this.openSettings();
    });
  }

  private openSettings(): void {
    openSettingsModal(
      this.modalHostEl,
      this.save.settings,
      !this.canMutate(),
      (nextSettings) => {
        if (!this.canMutate()) return;
        this.save = { ...this.save, settings: nextSettings };
        this.applyBodySettings(nextSettings);
        this.persist();
        this.syncAll();
      },
      () => {
        if (!this.canMutate()) return;
        clearSaveData(window.localStorage);
        this.save = createFreshSaveData();
        this.recentlyBuiltId = null;
        this.keptCollectibleIds.clear();
        this.persist();
        this.syncAll();
      }
    );
  }

  private syncAll(): void {
    this.renderTitleScreen();
    this.renderTopHud();
    this.renderBanners();
    this.phaserHost?.setCombatPaused(this.isReadOnlyTab || !this.titleEntered);

    const exp = this.save.activeExpedition;
    this.mainLayoutEl.classList.toggle('phase-base', !exp);
    this.mainLayoutEl.classList.toggle('phase-arrange', Boolean(exp && exp.phase === 'ARRANGE'));
    this.mainLayoutEl.classList.toggle('phase-combat', Boolean(exp && exp.phase === 'COMBAT'));
    this.mainLayoutEl.classList.toggle('phase-route', Boolean(exp && exp.phase === 'ROUTE_SELECT'));
    if (!exp) {
      if (this.titleEntered) soundEngine.setTrack('base');
      this.activeCombatPlaybackKey = null;
      this.sceneCollapseOverride = null;
      this.sceneWrapEl.className = 'scene-stage-wrap mode-base';
      this.phaserHost?.resize();
      this.phaserHost?.showBase({
        progression: this.save.progression,
        settings: this.save.settings,
        recentlyBuiltId: this.recentlyBuiltId,
      });
      this.renderDockingOverlay();
      this.renderBasePanels();
    } else {
      if (this.titleEntered) soundEngine.setTrack('expedition');
      this.renderExpeditionView(exp);
    }
  }

  private renderTopHud(): void {
    const exp = this.save.activeExpedition;
    const prog = this.save.progression;

    let leftPills = '';
    if (!exp) {
      const codex = getCodexSummary(prog);
      leftPills = `
        <div class="hud-pill accent">
          <span class="label">信用点</span>
          <span class="val" id="hud-credits">${prog.credits}</span>
        </div>
        <div class="hud-pill">
          <span class="label">状态</span>
          <span class="val">基地停泊</span>
        </div>
        ${
          prog.buildings.workbench
            ? `<div class="hud-pill energy"><span class="label">图鉴</span><span class="val">${codex.completionPercent}%</span></div>`
            : ''
        }
      `;
    } else if (exp.phase === 'SETTLEMENT') {
      // F12: Exact single source of truth between HUD and settlement summary
      const summary = calculateSettlement(exp, prog, Array.from(this.keptCollectibleIds));
      const hpDanger = exp.currentHp <= 10;
      leftPills = `
        <div class="hud-pill">
          <span class="label">节点</span>
          <span class="val" id="hud-node">${exp.currentNode}/${exp.maxNodes}</span>
        </div>
        <div class="hud-pill ${hpDanger ? 'danger' : ''}">
          <span class="label">耐久</span>
          <span class="val" id="hud-hp">${exp.currentHp}/${exp.maxHp}</span>
        </div>
        <div class="hud-pill ${summary.reason === 'defeat' ? 'danger' : 'accent'}">
          <span class="label">本次实得</span>
          <span class="val" id="hud-est-return">+${summary.finalCreditsEarned}</span>
        </div>
      `;
    } else {
      const stats = calculateBuildStats(exp.bay);
      const estReturn = exp.accumulatedBounty + stats.totalBayValue;
      const hpDanger = exp.currentHp <= 10;
      leftPills = `
        <div class="hud-pill">
          <span class="label">节点</span>
          <span class="val" id="hud-node">${exp.currentNode}/${exp.maxNodes}</span>
        </div>
        <div class="hud-pill ${hpDanger ? 'danger' : ''}">
          <span class="label">耐久</span>
          <span class="val" id="hud-hp">${exp.currentHp}/${exp.maxHp}</span>
        </div>
        <div class="hud-pill accent">
          <span class="label">返航</span>
          <span class="val" id="hud-est-return">+${estReturn}</span>
        </div>
      `;
    }

    const arrangeCollapsed = this.isArrangeSceneCollapsed();

    this.topHudEl.innerHTML = `
      ${
        !exp
          ? `<button type="button" class="hud-brand-btn" id="btn-return-title" title="返回标题界面">星际拆解站</button>`
          : `<h1 class="hud-brand">星际拆解站</h1>`
      }
      <div class="hud-pills">
        ${leftPills}
      </div>
      <div class="hud-actions">
        ${
          exp && exp.phase === 'ARRANGE'
            ? `<button type="button" class="btn btn-icon" id="btn-toggle-scene" title="展开或收起舰船视图">${
                arrangeCollapsed ? '舰船' : '收起'
              }</button>`
            : ''
        }
        ${
          !exp && prog.buildings.workbench
            ? `<button type="button" class="btn btn-icon" id="btn-open-codex">图鉴</button>`
            : ''
        }
        <button type="button" class="btn btn-icon" id="btn-open-help" aria-label="规则说明">说明</button>
        <button type="button" class="btn btn-icon" id="btn-open-settings" aria-label="设置">设置</button>
      </div>
    `;

    this.topHudEl.querySelector('#btn-return-title')?.addEventListener('click', () => {
      soundEngine.play('click');
      this.titleEntered = false;
      this.writeTitleEnteredSession(false);
      this.syncAll();
    });
    this.topHudEl.querySelector('#btn-toggle-scene')?.addEventListener('click', () => {
      this.sceneCollapseOverride = !this.isArrangeSceneCollapsed();
      soundEngine.play('click');
      this.syncAll();
    });
    this.topHudEl.querySelector('#btn-open-codex')?.addEventListener('click', () => {
      soundEngine.play('click');
      this.openCodexModal();
    });
    this.topHudEl.querySelector('#btn-open-help')?.addEventListener('click', () => {
      soundEngine.play('click');
      openHelpModal(this.modalHostEl);
    });
    this.topHudEl.querySelector('#btn-open-settings')?.addEventListener('click', () => {
      soundEngine.play('click');
      this.openSettings();
    });
  }

  private renderBanners(): void {
    this.bannersEl.innerHTML = '';

    if (this.isReadOnlyTab) {
      const b = document.createElement('div');
      b.className = 'system-banner banner-warn';
      b.setAttribute('role', 'status');
      b.innerHTML = `
        <span>检测到另一标签页正在运行，当前处于<strong>只读模式</strong>（操作已锁定，防止存档冲突）。</span>
        <button type="button" class="btn btn-primary btn-compact" id="btn-takeover-tab">接管控制权</button>
      `;
      b.querySelector('#btn-takeover-tab')?.addEventListener('click', () => {
        this.performTabTakeover();
      });
      this.bannersEl.appendChild(b);
    }

    if (this.storageError) {
      const b = document.createElement('div');
      b.className = 'system-banner banner-danger';
      b.setAttribute('role', 'alert');
      b.innerHTML = `<span>${this.storageError}</span>`;
      this.bannersEl.appendChild(b);
    }

    // F11 static receipt banner (shown immediately in reducedMotion or after docking animation finishes)
    const exp = this.save.activeExpedition;
    if (!exp && this.activeDockingNotice && !this.activeDockingNotice.animating) {
      const n = this.activeDockingNotice;
      const b = document.createElement('div');
      b.className = 'system-banner';
      b.style.borderColor = n.wasDefeat ? 'var(--state-danger)' : 'var(--accent-action)';
      b.setAttribute('role', 'status');
      b.innerHTML = `
        <span>
          <strong>${n.wasDefeat ? '已拖回基地' : '满载返航入账'}</strong>
          <strong class="num" style="color:var(--accent-action);margin:0 4px;">+${n.earnedCredits}</strong>信用点
          ${n.hasKeptRelic ? ' · 稀有藏品已存入展台仓库' : ''}
          · ${n.goalHint}
        </span>
        <button type="button" class="btn btn-compact" id="btn-dismiss-docking-receipt">知道了</button>
      `;
      b.querySelector('#btn-dismiss-docking-receipt')?.addEventListener('click', () => {
        this.activeDockingNotice = null;
        this.renderBanners();
      });
      this.bannersEl.appendChild(b);
    }

    // First-5-minute tutorial contextual hint (non-blocking, disappears once tutorial completes)
    if (exp && exp.isTutorial) {
      const step = TUTORIAL_SCRIPT[exp.currentNode];
      if (step) {
        let hintText = '';
        if (exp.phase === 'ROUTE_SELECT') hintText = step.routeHint;
        else if (exp.phase === 'REWARD') hintText = step.rewardHint;
        else if (exp.phase === 'ARRANGE') hintText = step.arrangeHint;
        if (hintText) {
          const tb = document.createElement('div');
          tb.className = 'tutorial-banner';
          tb.innerHTML = `<span class="tutorial-badge">新手引导</span><span>${hintText}</span>`;
          this.bannersEl.appendChild(tb);
        }
      }
    }
  }

  private renderBasePanels(): void {
    this.cargoGrid?.destroy();
    this.cargoGrid = null;

    const prog = this.save.progression;
    const readOnly = !this.canMutate();
    const isFirstRun = !prog.tutorialCompleted && prog.totalExpeditions === 0;
    const activeLoadout = isLoadoutUnlocked(prog, prog.selectedLoadout)
      ? prog.selectedLoadout
      : 'cannon_skiff';
    const rawRegion: RegionId = prog.selectedRegion ?? 'standard';
    const activeRegion: RegionId =
      !isFirstRun && isRegionUnlocked(prog, rawRegion) ? rawRegion : 'standard';

    // Sleek Ship Switcher + Star Region Toggle + Launch Command Dock (Zero prose!)
    this.leftPanelEl.innerHTML = `
      <div class="panel panel-game-dock">
        <div class="ship-picker-row">
          ${(['cannon_skiff', 'shield_cruiser'] as LoadoutId[])
            .map((id) => {
              const def = LOADOUTS[id];
              const unlocked = isLoadoutUnlocked(prog, id);
              const selected = activeLoadout === id;
              const statLine = id === 'cannon_skiff' ? '攻 7 · 盾 0' : '攻 4 · 盾 6';
              return `
                <button type="button" class="ship-slot-card ${selected ? 'selected' : ''} ${unlocked ? '' : 'locked'}"
                  data-loadout="${id}" ${unlocked && !readOnly ? '' : 'disabled'}>
                  <div class="ship-slot-visual-row">
                    <div class="ship-slot-art">
                      <img src="${getPlayerShipImageUrl(id)}" alt="${def.name}" />
                    </div>
                    <span class="tag ${selected ? 'tag-amber' : ''}">${
                      unlocked ? (selected ? '出战' : '切换') : '需船坞'
                    }</span>
                  </div>
                  <div class="ship-slot-meta">
                    <strong class="ship-slot-name">${def.name}</strong>
                    <span class="ship-slot-stats num">${statLine}</span>
                  </div>
                </button>
              `;
            })
            .join('')}
        </div>

        ${
          !isFirstRun
            ? `
            <div class="region-picker-row" role="group" aria-label="选择出航星域">
              ${(['standard', 'abyssal'] as RegionId[])
                .map((rid) => {
                  const rdef = REGIONS[rid];
                  const unlocked = isRegionUnlocked(prog, rid);
                  const selected = activeRegion === rid;
                  return `
                    <button type="button" class="region-pill-btn ${selected ? 'selected' : ''} ${rid === 'abyssal' ? 'abyssal' : ''} ${unlocked ? '' : 'locked'}"
                      data-region="${rid}" ${unlocked && !readOnly ? '' : 'disabled'} title="${unlocked ? rdef.badge : rdef.unlockHint}">
                      <strong>${rdef.shortName}</strong>
                      <span class="region-pill-sub">${unlocked ? rdef.badge : '需工作台/3站'}</span>
                    </button>
                  `;
                })
                .join('')}
            </div>
          `
            : ''
        }

        <button type="button" class="btn btn-primary btn-launch-hero ${activeRegion === 'abyssal' ? 'btn-launch-abyssal' : ''}" id="btn-launch-expedition" ${
          readOnly ? 'disabled' : ''
        }>
          ${
            readOnly
              ? '只读模式 · 请先接管控制权'
              : isFirstRun
              ? '▶ 第一次打捞（新手航次）'
              : activeRegion === 'abyssal'
              ? `▶ 深入「星渊禁区」· ${LOADOUTS[activeLoadout].name}`
              : `▶ 驾驶「${LOADOUTS[activeLoadout].name}」出发打捞`
          }
        </button>
      </div>
    `;

    this.leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-loadout]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.canMutate()) return;
        const id = btn.dataset.loadout as LoadoutId;
        if (!isLoadoutUnlocked(this.save.progression, id)) return;
        soundEngine.play('click');
        this.save = {
          ...this.save,
          progression: { ...this.save.progression, selectedLoadout: id },
        };
        this.persist();
        this.syncAll();
      });
    });

    this.leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-region]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.canMutate()) return;
        const rid = btn.dataset.region as RegionId;
        if (!isRegionUnlocked(this.save.progression, rid)) return;
        soundEngine.play('click');
        this.save = {
          ...this.save,
          progression: { ...this.save.progression, selectedRegion: rid },
        };
        this.persist();
        this.syncAll();
      });
    });

    this.leftPanelEl.querySelector('#btn-launch-expedition')?.addEventListener('click', () => {
      if (!this.canMutate()) return;
      soundEngine.unlock();
      soundEngine.play('warpJump');
      this.phaserHost?.skipBaseReturnDocking();
      this.activeDockingNotice = null;
      this.recentlyBuiltId = null;
      this.keptCollectibleIds.clear();
      const exp = startExpedition({
        loadoutId: activeLoadout,
        regionId: activeRegion,
        isTutorial: !this.save.progression.tutorialCompleted,
      });
      this.save = { ...this.save, activeExpedition: exp };
      this.persist();
      this.syncAll();
    });

    // Compact Facility Upgrade Strip + 4-Relic Museum Showcase Card (Clicking station diorama pins ALSO triggers these!)
    const visibleBuildings = getVisibleBuildings(prog);
    const relicSum = getRelicCollectionSummary(prog);
    const hasRestorableRelic = relicSum.restorableIds.length > 0 && !readOnly;

    const iconForBuilding: Record<BuildingId, string> = {
      workbench: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4l-5.6 5.6a1.5 1.5 0 0 0 2.1 2.1l5.6-5.6a4 4 0 0 0 5.4-5.4l-2.1 2.1-2.1-2.1z"/></svg>`,
      display: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 3 19 8 19 16 12 21 5 16 5 8 12 3"/><circle cx="12" cy="12" r="2.5"/></svg>`,
      drydock: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10l9-6 9 6v9a1 1 0 0 1-1 1h-3v-6H7v6H4a1 1 0 0 1-1-1z"/><path d="M9 17h6"/></svg>`,
    };
    const tagForBuilding: Record<BuildingId, string> = {
      workbench: '解锁图鉴与星渊禁区',
      display: '展示 4 件深空藏品',
      drydock: '解锁护盾工程艇',
    };

    this.rightPanelEl.innerHTML = `
      <div class="panel panel-game-dock">
        <div class="facility-strip">
          ${visibleBuildings
            .map((bid) => {
              const def = BUILDINGS[bid];
              const built = prog.buildings[bid];
              const check = canBuildFacility(prog, bid);
              const affordable = !built && check.canBuild && !readOnly;
              return `
                <div class="facility-chip ${built ? 'built' : ''} ${affordable ? 'affordable' : ''}">
                  <div class="facility-chip-head">
                    <span class="facility-icon ${built ? 'active' : ''}" aria-hidden="true">${iconForBuilding[bid]}</span>
                    <div class="facility-chip-title">
                      <strong>${def.name}</strong>
                      <span class="facility-chip-sub">${tagForBuilding[bid]}</span>
                    </div>
                  </div>
                  ${
                    built
                      ? bid === 'workbench'
                        ? `<button type="button" class="btn btn-energy btn-compact" data-open-codex="1">图鉴</button>`
                        : bid === 'display'
                        ? `<button type="button" class="btn btn-energy btn-compact" data-open-gallery="1">陈列馆</button>`
                        : `<span class="tag tag-energy">已运转 ✓</span>`
                      : `<button type="button" class="btn ${affordable ? 'btn-primary' : ''} btn-compact" data-build="${bid}" ${
                          affordable ? '' : 'disabled'
                        }>${readOnly ? '锁定' : `${def.cost}¤ 修复`}</button>`
                  }
                </div>
              `;
            })
            .join('')}

          ${
            prog.buildings.display
              ? `
                <div class="facility-chip relic-chip ${
                  relicSum.restoredCount >= relicSum.totalCount
                    ? 'built'
                    : hasRestorableRelic
                    ? 'affordable'
                    : ''
                }">
                  <div class="facility-chip-head">
                    <div class="relic-dock-strip" aria-label="藏品进度">
                      ${RELIC_ORDER.map((rid) => {
                        const rdef = RELICS[rid];
                        const st = prog.relics[rid] ?? { storedCount: 0, restored: false };
                        return `<img class="relic-dock-pip ${st.restored ? 'lit' : st.storedCount > 0 ? 'stored' : 'dim'}" src="${getItemImageUrl(rdef.cargoDefId)}" alt="${rdef.name}" title="${rdef.name}" />`;
                      }).join('')}
                    </div>
                    <div class="facility-chip-title">
                      <strong>藏品 ${relicSum.restoredCount}/${relicSum.totalCount}</strong>
                      <span class="facility-chip-sub">${
                        relicSum.restoredCount >= relicSum.totalCount
                          ? '全藏品已点亮 ✦'
                          : hasRestorableRelic
                          ? `${relicSum.restorableIds.length} 件可立即修复`
                          : relicSum.storedTotal > 0
                          ? `库存 ${relicSum.storedTotal} 件待筹款`
                          : '深空打捞收集'
                      }</span>
                    </div>
                  </div>
                  <button type="button" class="btn ${hasRestorableRelic ? 'btn-primary' : 'btn-energy'} btn-compact" id="btn-open-relic-gallery">
                    ${hasRestorableRelic ? '修复' : '查看'}
                  </button>
                </div>
              `
              : ''
          }
        </div>
      </div>
    `;

    this.rightPanelEl.querySelectorAll<HTMLButtonElement>('[data-build]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.handleBuildingInteract(btn.dataset.build as BuildingId);
      });
    });

    this.rightPanelEl.querySelector('[data-open-codex]')?.addEventListener('click', () => {
      soundEngine.play('click');
      this.openCodexModal();
    });

    this.rightPanelEl.querySelectorAll('[data-open-gallery], #btn-open-relic-gallery').forEach((btn) => {
      btn.addEventListener('click', () => {
        soundEngine.play('click');
        this.openRelicGallery();
      });
    });
  }

  private handleRestoreRelic(relicId: string) {
    if (!this.canMutate()) return null;
    const res = restoreRelic(this.save.progression, relicId);
    if (res.ok) {
      soundEngine.play('relicRestore');
      this.recentlyBuiltId = 'display';
      this.save = { ...this.save, progression: res.progression };
      this.persist();
      this.syncAll();
      return res.progression;
    }
    soundEngine.play('invalid');
    return null;
  }

  private openRelicGallery(): void {
    openRelicGalleryModal(
      this.modalHostEl,
      this.save.progression,
      !this.canMutate(),
      (relicId) => this.handleRestoreRelic(relicId)
    );
  }

  private handleBuildingInteract(buildingId: BuildingId): void {
    const prog = this.save.progression;
    if (prog.buildings[buildingId]) {
      if (buildingId === 'workbench') {
        soundEngine.play('click');
        this.openCodexModal();
      } else if (buildingId === 'display') {
        soundEngine.play('click');
        this.openRelicGallery();
      }
      return;
    }
    if (!this.canMutate()) {
      soundEngine.play('invalid');
      return;
    }
    const res = purchaseBuilding(prog, buildingId);
    if (res.ok) {
      soundEngine.play('buildComplete');
      this.recentlyBuiltId = buildingId;
      this.save = { ...this.save, progression: res.progression };
      this.persist();
      this.syncAll();
    } else {
      soundEngine.play('invalid');
    }
  }

  private openCodexModal(): void {
    openCodexModal(this.modalHostEl, this.save.progression);
  }

  private renderExpeditionView(exp: ExpeditionState): void {
    const sectorIdx = this.getSectorIndex(exp);
    if (exp.phase === 'ARRANGE') {
      const collapsed = this.isArrangeSceneCollapsed();
      this.sceneWrapEl.className = `scene-stage-wrap mode-arrange ${collapsed ? 'collapsed' : ''}`;
    } else if (exp.phase === 'ROUTE_SELECT') {
      this.sceneWrapEl.className = 'scene-stage-wrap mode-route';
    } else if (exp.phase === 'COMBAT') {
      this.sceneWrapEl.className = 'scene-stage-wrap mode-combat';
    } else {
      this.sceneWrapEl.className = 'scene-stage-wrap';
    }
    this.phaserHost?.resize();

    if (exp.phase === 'ROUTE_SELECT') {
      this.activeCombatPlaybackKey = null;
      this.sceneOverlayEl.innerHTML = '';
      const normalPrev = getRoutePreview(exp, 'normal');
      this.phaserHost?.showCombat({
        loadoutId: exp.loadoutId,
        enemy: normalPrev.routeSpec.enemy,
        sectorIndex: normalPrev.routeSpec.sectorBg ?? sectorIdx,
        simulation: null,
        settings: this.save.settings,
      });
      this.renderRouteSelect(exp);
    } else if (exp.phase === 'COMBAT' && exp.activeCombat) {
      this.renderCombatPhase(exp);
    } else if (exp.phase === 'REWARD' && exp.pendingRewards) {
      this.activeCombatPlaybackKey = null;
      this.sceneOverlayEl.innerHTML = '';
      this.phaserHost?.showCombat({
        loadoutId: exp.loadoutId,
        enemy: null,
        sectorIndex: sectorIdx,
        simulation: null,
        settings: this.save.settings,
      });
      this.renderRewardPhase(exp);
    } else if (exp.phase === 'ARRANGE') {
      this.activeCombatPlaybackKey = null;
      this.sceneOverlayEl.innerHTML = '';
      this.phaserHost?.showCombat({
        loadoutId: exp.loadoutId,
        enemy: null,
        sectorIndex: sectorIdx,
        simulation: null,
        settings: this.save.settings,
      });
      this.renderArrangePhase(exp);
    } else if (exp.phase === 'SETTLEMENT') {
      this.activeCombatPlaybackKey = null;
      this.sceneOverlayEl.innerHTML = '';
      this.phaserHost?.showCombat({
        loadoutId: exp.loadoutId,
        enemy: null,
        sectorIndex: sectorIdx,
        simulation: null,
        settings: this.save.settings,
      });
      this.renderSettlementPhase(exp);
    }
  }

  private mountCargoBayPanel(exp: ExpeditionState, title: string): void {
    const editable = isCargoBayEditable(exp) && this.canMutate();
    this.rightPanelEl.innerHTML = `
      <div class="panel panel-cargo-bay">
        <div class="panel-header">
          <h2 class="panel-title">${title}</h2>
          <span class="tag ${editable ? 'tag-amber' : ''}">
            ${editable ? '拖放 · 点选 · 键盘' : this.isReadOnlyTab ? '只读锁定' : '航行锁定'}
          </span>
        </div>
        <div id="cargo-bay-mount" class="bay-section"></div>
      </div>
    `;
    const bayMount = this.rightPanelEl.querySelector<HTMLElement>('#cargo-bay-mount')!;
    this.cargoGrid?.destroy();
    this.cargoGrid = new CargoGridComponent(bayMount, {
      onBayChange: (nextBay) => {
        if (!this.canMutate()) return;
        if (!this.save.activeExpedition || !isCargoBayEditable(this.save.activeExpedition)) return;
        const updatedExp = updateArrangeBay(this.save.activeExpedition, nextBay);
        this.save = {
          ...this.save,
          activeExpedition: updatedExp,
        };
        this.persist();
        this.renderTopHud();
        this.renderArrangeDecisionDock(updatedExp);
        this.cargoGrid?.render(updatedExp.bay, true);
      },
    });
    this.cargoGrid.render(exp.bay, editable);
  }

  private renderRouteSelect(exp: ExpeditionState): void {
    const readOnly = !this.canMutate();
    const normal = getRoutePreview(exp, 'normal');
    const danger = getRoutePreview(exp, 'danger');
    const tutorialOnlyNormal = exp.isTutorial && exp.currentNode === 1;
    const isAbyssal = (exp.regionId ?? 'standard') === 'abyssal';

    const renderRouteCard = (
      routeType: RouteType,
      data: ReturnType<typeof getRoutePreview>,
      lockedForTutorial = false
    ) => {
      const { routeSpec, prediction } = data;
      const isDanger = routeType === 'danger';
      const isBoss = Boolean(routeSpec.enemy.isBoss);
      const lethal = prediction.outcome === 'defeat';
      const hasBespokeDangerArt =
        routeSpec.enemy.archetype === 'interceptor' ||
        routeSpec.enemy.archetype === 'boss_dreadnought' ||
        routeSpec.enemy.archetype === 'boss_leviathan';

      const badgeClass = isBoss ? 'tag-boss' : isDanger ? 'tag-danger' : 'tag-energy';
      const badgeLabel = isBoss
        ? isDanger
          ? '★ 终极 BOSS'
          : '★ 旗舰 BOSS'
        : isDanger
        ? '⚠ 危险航道'
        : '✦ 普通航道';

      return `
        <div class="route-beacon ${isDanger ? 'danger' : ''} ${isBoss ? 'boss' : ''}">
          <div class="route-beacon-head">
            <span class="tag ${badgeClass}">${badgeLabel}</span>
            <strong class="route-enemy-name">${routeSpec.enemy.name}</strong>
          </div>

          <div class="route-enemy-visual ${isDanger ? 'danger' : ''} ${isBoss ? 'boss' : ''} ${
            hasBespokeDangerArt ? 'bespoke-art' : ''
          }">
            <img src="${getEnemyShipImageUrl(routeSpec.enemy.archetype)}" alt="${routeSpec.enemy.name}" />
          </div>

          <div class="route-icon-stats num">
            <span title="敌方耐久">♥${routeSpec.enemy.maxHp}</span>
            <span title="每轮伤害">攻${routeSpec.enemy.damagePerRound}</span>
            <span style="color:var(--accent-action);" title="胜利悬赏">+${routeSpec.bounty}¤</span>
            <span style="color:var(--accent-energy);" title="优良设备率">★${Math.round(routeSpec.improvedEquipmentProb * 100)}%</span>
          </div>

          <div class="route-prediction ${lethal ? 'lethal' : ''}">
            ${
              lethal
                ? `<strong style="color:var(--state-danger);">⚠ 预计战败（${prediction.roundsCount}轮）</strong>`
                : `<span>${prediction.roundsCount}轮 · 战后 <strong class="num" style="color:var(--accent-energy);">♥${prediction.finalPlayerHp}/${exp.maxHp}</strong>${
                    prediction.repairApplied > 0 ? ` (+${prediction.repairApplied})` : ''
                  }</span>`
            }
          </div>

          <button type="button" class="btn ${isDanger || isBoss ? 'btn-danger' : 'btn-primary'}"
            data-select-route="${routeType}" ${lockedForTutorial || readOnly ? 'disabled' : ''}>
            ${
              readOnly
                ? '只读锁定'
                : lockedForTutorial
                ? '第 2 站解锁'
                : lethal
                ? '冒险跃迁 →'
                : isBoss
                ? '挑战 BOSS →'
                : '跃迁交火 →'
            }
          </button>
        </div>
      `;
    };

    this.leftPanelEl.innerHTML = `
      <div class="panel panel-game-dock">
        <div class="panel-header">
          <h2 class="panel-title">星图跃迁 · ${normal.routeSpec.sectorName} (${exp.currentNode}/${exp.maxNodes})</h2>
          <div style="display:flex;gap:5px;align-items:center;">
            ${isAbyssal ? `<span class="tag tag-danger">星渊禁区</span>` : ''}
            <span class="tag tag-amber">悬赏 +${exp.accumulatedBounty}¤</span>
          </div>
        </div>
        <div class="route-grid">
          ${renderRouteCard('normal', normal, false)}
          ${renderRouteCard('danger', danger, tutorialOnlyNormal)}
        </div>
      </div>
    `;

    this.leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-select-route]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.canMutate()) return;
        const routeType = btn.dataset.selectRoute as RouteType;
        soundEngine.unlock();
        soundEngine.play('warpJump');
        const nextExp = selectRoute(exp, routeType);
        this.save = { ...this.save, activeExpedition: nextExp };
        this.persist();
        this.syncAll();
      });
    });

    this.mountCargoBayPanel(exp, '船舱配置');
  }

  private renderCombatPhase(exp: ExpeditionState): void {
    const readOnly = !this.canMutate();
    const combat = exp.activeCombat!;
    const playbackKey = `${exp.expeditionId}_${exp.currentNode}_${combat.routeSpec.routeType}`;
    const sectorIdx = combat.routeSpec.sectorBg ?? this.getSectorIndex(exp);

    if (this.activeCombatPlaybackKey !== playbackKey) {
      this.activeCombatPlaybackKey = playbackKey;
      this.liveCombatPlayerHp = combat.startingHp;
      this.liveCombatPlayerShield = combat.simulation.startingPlayerShield;
      this.liveCombatEnemyHp = combat.simulation.startingEnemyHp;
      this.liveCombatRound = 0;

      this.phaserHost?.showCombat({
        loadoutId: exp.loadoutId,
        enemy: combat.routeSpec.enemy,
        sectorIndex: sectorIdx,
        simulation: combat.simulation,
        settings: this.save.settings,
        onRoundStep: (_idx, ev: CombatRoundEvent) => {
          this.liveCombatRound = ev.round;
          this.liveCombatPlayerHp = ev.playerHpAfter;
          this.liveCombatPlayerShield = ev.playerShieldAfter;
          this.liveCombatEnemyHp = ev.enemyHpAfter;
          this.updateCombatOverlayBars(exp);
        },
        onComplete: () => {
          if (!this.canMutate()) return;
          if (!this.save.activeExpedition || this.save.activeExpedition.phase !== 'COMBAT') return;
          const after = completeCombat(this.save.activeExpedition);
          this.save = { ...this.save, activeExpedition: after };
          this.persist();
          this.syncAll();
        },
      });
      this.phaserHost?.setCombatPaused(readOnly || !this.titleEntered);
    }

    this.updateCombatOverlayBars(exp);

    this.leftPanelEl.innerHTML = `
      <div class="panel panel-compact combat-control-bar">
        <div class="combat-bar-status">
          <span class="tag tag-energy" id="combat-round-tag">第 ${this.liveCombatRound}/${combat.simulation.roundsCount} 轮</span>
          <span class="combat-stat-inline num">攻${combat.statsSnapshot.totalAttack} · 盾${combat.statsSnapshot.effectiveShield}</span>
          ${combat.routeSpec.enemy.isBoss ? `<span class="tag tag-boss">BOSS 战</span>` : ''}
          ${readOnly ? `<span class="tag tag-danger">已暂停</span>` : ''}
        </div>
        <div class="combat-bar-btns">
          <button type="button" class="btn btn-compact ${this.save.settings.combatSpeed === 2 ? 'btn-energy' : ''}" id="btn-combat-speed" ${
            readOnly ? 'disabled' : ''
          }>
            ${this.save.settings.combatSpeed}× 速度
          </button>
          <button type="button" class="btn btn-compact" id="btn-skip-combat" ${readOnly ? 'disabled' : ''}>跳过 »</button>
        </div>
      </div>
    `;

    this.leftPanelEl.querySelector('#btn-combat-speed')?.addEventListener('click', () => {
      if (!this.canMutate()) return;
      const nextSpeed: 1 | 2 = this.save.settings.combatSpeed === 1 ? 2 : 1;
      const nextSettings: GameSettings = { ...this.save.settings, combatSpeed: nextSpeed };
      this.save = { ...this.save, settings: nextSettings };
      this.applyBodySettings(nextSettings);
      this.persist();
      const btn = this.leftPanelEl.querySelector('#btn-combat-speed');
      if (btn) btn.textContent = `${nextSpeed}× 速度`;
    });

    this.leftPanelEl.querySelector('#btn-skip-combat')?.addEventListener('click', () => {
      if (!this.canMutate()) return;
      soundEngine.play('click');
      this.phaserHost?.skipCombatPlayback();
    });

    this.mountCargoBayPanel(exp, '船舱配置');
  }

  private updateCombatOverlayBars(exp: ExpeditionState): void {
    const combat = exp.activeCombat;
    if (!combat) return;
    const pHpPct = Math.max(0, Math.min(100, (this.liveCombatPlayerHp / exp.maxHp) * 100));
    const pShPct =
      combat.simulation.startingPlayerShield > 0
        ? Math.max(
            0,
            Math.min(100, (this.liveCombatPlayerShield / combat.simulation.startingPlayerShield) * 100)
          )
        : 0;
    const eHpPct = Math.max(
      0,
      Math.min(100, (this.liveCombatEnemyHp / combat.routeSpec.enemy.maxHp) * 100)
    );
    const isBoss = Boolean(combat.routeSpec.enemy.isBoss);

    this.sceneOverlayEl.innerHTML = `
      <div class="combat-hud-bars">
        <div class="unit-bar-card">
          <div class="unit-bar-header">
            <span class="name">${LOADOUTS[exp.loadoutId].name}</span>
            <span class="unit-bar-vals num">♥${this.liveCombatPlayerHp}/${exp.maxHp}${
              this.liveCombatPlayerShield > 0
                ? `<span class="unit-shield-val">盾${this.liveCombatPlayerShield}</span>`
                : ''
            }</span>
          </div>
          <div class="hp-track"><div class="hp-fill" style="width:${pHpPct}%"></div></div>
          ${
            combat.simulation.startingPlayerShield > 0
              ? `<div class="shield-track"><div class="shield-fill" style="width:${pShPct}%"></div></div>`
              : ''
          }
        </div>
        <div class="unit-bar-card ${isBoss ? 'boss-bar-card' : ''}">
          <div class="unit-bar-header">
            <span class="name">${isBoss ? `<span class="boss-mini-badge">BOSS</span> ` : ''}${combat.routeSpec.enemy.name}</span>
            <span class="unit-bar-vals num">♥${this.liveCombatEnemyHp}/${combat.routeSpec.enemy.maxHp}</span>
          </div>
          <div class="hp-track"><div class="hp-fill enemy ${isBoss ? 'boss' : ''}" style="width:${eHpPct}%"></div></div>
        </div>
      </div>
    `;

    const roundTag = this.leftPanelEl.querySelector('#combat-round-tag');
    if (roundTag) {
      roundTag.textContent = `第 ${this.liveCombatRound}/${combat.simulation.roundsCount} 轮`;
    }
  }

  private renderRewardPhase(exp: ExpeditionState): void {
    const readOnly = !this.canMutate();
    const rewards = exp.pendingRewards!;
    const lastSim = exp.lastCombat?.simulation;

    const hasRare = rewards.some(
      (r) =>
        r.kind === 'cargo' &&
        getItemDef(r.item.defId).category === 'cargo' &&
        (r.item.value >= 40 || getItemDef(r.item.defId).defId === 'cargo.ancient_navigator')
    );
    if (hasRare) {
      soundEngine.play('rewardRare');
    }

    this.leftPanelEl.innerHTML = `
      <div class="panel panel-game-dock">
        <div class="panel-header">
          <h2 class="panel-title">打捞战利品 · 三选一</h2>
          <div style="display:flex;gap:6px;align-items:center;">
            <span class="tag tag-amber">悬赏 +${lastSim?.bountyEarned ?? 0}¤</span>
            ${
              lastSim && lastSim.repairApplied > 0
                ? `<span class="tag tag-energy">修 +${lastSim.repairApplied}</span>`
                : ''
            }
          </div>
        </div>

        <div class="reward-grid">
          ${rewards
            .map((opt) => {
              if (opt.kind === 'repair') {
                const afterHp = Math.min(exp.maxHp, exp.currentHp + opt.healAmount);
                return `
                  <div class="reward-pod">
                    <div class="reward-pod-art repair-art">
                      <span>♥ +${opt.healAmount}</span>
                    </div>
                    <div class="reward-pod-info">
                      <strong>紧急维修</strong>
                      <span class="reward-pod-stat num" style="color:var(--accent-energy);">♥ ${exp.currentHp} → ${afterHp} · 0格</span>
                    </div>
                    <button type="button" class="btn btn-energy" data-pick-reward="repair" ${
                      readOnly ? 'disabled' : ''
                    }>${readOnly ? '锁定' : '立即维修'}</button>
                  </div>
                `;
              }

              const def = getItemDef(opt.item.defId);
              const shape = SHAPES[def.shapeId];
              const isCollectible = def.category === 'cargo' && def.isCollectible;
              const statBadge =
                def.category === 'equipment'
                  ? `<span class="reward-pod-stat" style="color:var(--accent-energy);">${def.summary}</span>`
                  : `<span class="reward-pod-stat num" style="color:var(--accent-action);">${opt.item.value}¤ · ${Math.round(opt.item.value / shape.cells.length)}/格</span>`;

              return `
                <div class="reward-pod ${isCollectible ? 'highlight-collectible' : ''}">
                  <div class="reward-pod-art">
                    <img src="${getItemImageUrl(def.defId)}" alt="${def.name}" />
                  </div>
                  <div class="reward-pod-info">
                    <div class="reward-pod-title">
                      <strong>${def.name}</strong>
                      ${
                        def.category === 'equipment'
                          ? `<span class="tag ${def.quality === 'improved' ? 'tag-energy' : ''}">${
                              def.quality === 'improved' ? '‖ 优良' : '| 普通'
                            }</span>`
                          : isCollectible
                          ? `<span class="tag tag-amber">★ 藏品</span>`
                          : ''
                      }
                    </div>
                    <div class="reward-pod-shape">
                      ${renderMiniMaskHtml(def.defId)}
                      ${statBadge}
                    </div>
                  </div>
                  <button type="button" class="btn btn-primary" data-pick-reward="${opt.optionId}" ${
                    readOnly ? 'disabled' : ''
                  }>${readOnly ? '锁定' : '收入暂存'}</button>
                </div>
              `;
            })
            .join('')}
        </div>
      </div>
    `;

    this.leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-pick-reward]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.canMutate()) return;
        const optionId = btn.dataset.pickReward as 'equipment' | 'cargo' | 'repair';
        soundEngine.play(optionId === 'repair' ? 'repairPulse' : 'place');
        const nextExp = selectReward(exp, optionId);
        this.save = { ...this.save, activeExpedition: nextExp };
        this.persist();
        this.syncAll();
      });
    });

    this.mountCargoBayPanel(exp, '当前船舱');
  }

  private confirmPendingDiscardsIfNeeded(
    exp: ExpeditionState,
    exitLabel: string,
    onConfirm: () => void
  ): void {
    if (!this.canMutate()) return;
    if (exp.bay.discardedThisArrange.length === 0) {
      onConfirm();
      return;
    }
    openDiscardConfirmModal(
      this.modalHostEl,
      exp.bay.discardedThisArrange,
      exitLabel,
      onConfirm
    );
  }

  private renderArrangePhase(exp: ExpeditionState): void {
    this.renderArrangeDecisionDock(exp);
    this.mountCargoBayPanel(exp, '4×4 船舱整理');
  }

  private renderArrangeDecisionDock(exp: ExpeditionState): void {
    const readOnly = !this.canMutate();
    const leaveCheck = canLeaveArrange(exp);
    const finalNode = isAtFinalNode(exp);
    const stats = calculateBuildStats(exp.bay);
    const estReturn = exp.accumulatedBounty + stats.totalBayValue;
    const canExit = leaveCheck.ok && !readOnly;

    let nextNodeHtml = '';
    if (!finalNode) {
      const nextPreviewExp: ExpeditionState = { ...exp, currentNode: exp.currentNode + 1 };
      const nextNormal = getRoutePreview(nextPreviewExp, 'normal');
      const lethal = nextNormal.prediction.outcome === 'defeat';
      nextNodeHtml = `
        <div class="route-prediction ${lethal ? 'lethal' : ''}">
          <strong>下站(${exp.currentNode + 1}/${exp.maxNodes})：</strong>
          ${
            lethal
              ? `<span style="color:var(--state-danger);font-weight:700;">预计战败！</span>建议调装或返航`
              : `敌 ${nextNormal.routeSpec.enemy.maxHp}血/${nextNormal.routeSpec.enemy.damagePerRound}伤 · 战后耐久 <strong>${nextNormal.prediction.finalPlayerHp}/${exp.maxHp}</strong>`
          }
        </div>
      `;
    } else {
      nextNodeHtml = `
        <div class="route-prediction">
          <strong>最终站 (${exp.maxNodes}/${exp.maxNodes}) 已通关！</strong>整理完毕后点击确认，将自动启航返港结算。
        </div>
      `;
    }

    const tutorialReturnPrompt =
      exp.isTutorial && exp.currentNode >= TUTORIAL_MAX_RECOMMENDED_NODE && !finalNode;

    this.leftPanelEl.innerHTML = `
      <div class="panel panel-compact">
        <div class="panel-header">
          <h2 class="panel-title">整理决策</h2>
          <span class="tag tag-amber">带回 +${estReturn}</span>
        </div>

        ${nextNodeHtml}

        ${
          !leaveCheck.ok
            ? `<div class="system-banner banner-warn"><span>${leaveCheck.reason}</span></div>`
            : ''
        }

        <div class="action-dock ${finalNode ? 'single' : ''}">
          <button type="button" class="btn ${finalNode || tutorialReturnPrompt ? 'btn-primary' : 'btn-energy'}"
            id="btn-safe-return" ${canExit ? '' : 'disabled'}>
            ${
              readOnly
                ? '只读锁定'
                : !leaveCheck.ok
                ? '先整理暂存奖励'
                : finalNode
                ? `完成整理 · 自动返航 (+${estReturn})`
                : `安全返航 (+${estReturn})`
            }
          </button>

          ${
            !finalNode
              ? `<button type="button" class="btn ${tutorialReturnPrompt ? '' : 'btn-primary'}"
                  id="btn-next-node" ${canExit ? '' : 'disabled'}>
                  ${readOnly ? '只读锁定' : !leaveCheck.ok ? '先整理暂存奖励' : `继续 · 节点 ${exp.currentNode + 1}`}
                </button>`
              : ''
          }
        </div>
      </div>
    `;

    this.leftPanelEl.querySelector('#btn-safe-return')?.addEventListener('click', () => {
      const cur = this.save.activeExpedition;
      if (!cur || !this.canMutate()) return;
      this.confirmPendingDiscardsIfNeeded(cur, '安全返航', () => {
        const latest = this.save.activeExpedition;
        if (!latest || !this.canMutate()) return;
        soundEngine.play('returnDock');
        const nextExp = initiateSafeReturn(latest);
        this.keptCollectibleIds.clear();
        this.save = { ...this.save, activeExpedition: nextExp };
        this.persist();
        this.syncAll();
      });
    });

    this.leftPanelEl.querySelector('#btn-next-node')?.addEventListener('click', () => {
      const cur = this.save.activeExpedition;
      if (!cur || !this.canMutate()) return;
      this.confirmPendingDiscardsIfNeeded(cur, '继续深入', () => {
        const latest = this.save.activeExpedition;
        if (!latest || !this.canMutate()) return;
        soundEngine.play('click');
        const nextExp = proceedToNextNode(latest);
        this.save = { ...this.save, activeExpedition: nextExp };
        this.persist();
        this.syncAll();
      });
    });
  }

  private renderSettlementPhase(exp: ExpeditionState): void {
    const readOnly = !this.canMutate();
    const summary = calculateSettlement(
      exp,
      this.save.progression,
      Array.from(this.keptCollectibleIds)
    );
    const isSafe = summary.reason === 'safe_return';
    const lastCombat = exp.lastCombat;

    this.leftPanelEl.innerHTML = `
      <div class="panel panel-game-dock">
        <div class="panel-header">
          <h2 class="panel-title" style="color:${isSafe ? 'var(--accent-action)' : 'var(--state-danger)'};">
            ${isSafe ? '✦ 安全返航 · 物资清点' : '⚠ 紧急拖回 · 40%折算'}
          </h2>
          <span class="tag ${isSafe ? 'tag-amber' : 'tag-danger'}">完成 ${exp.completedNodes} 站</span>
        </div>

        ${
          !isSafe && lastCombat
            ? `
            <div class="defeat-recap-strip">
              <strong style="color:var(--state-danger);">战损记录</strong>
              <span class="num">${lastCombat.routeSpec.enemy.name} (♥${lastCombat.routeSpec.enemy.maxHp} 攻${lastCombat.routeSpec.enemy.damagePerRound}) · 我方 ♥${lastCombat.startingHp} 攻${lastCombat.statsSnapshot.totalAttack} 盾${lastCombat.statsSnapshot.effectiveShield} · ${lastCombat.simulation.roundsCount}轮</span>
            </div>
          `
            : ''
        }

        <div class="settlement-list">
          <div class="settlement-row">
            <span>✦ 战斗悬赏</span>
            <strong class="num">+${summary.bountyCredits}¤</strong>
          </div>
          ${
            summary.tutorialBonusCredits > 0
              ? `<div class="settlement-row">
                  <span>✦ 首航启动补贴</span>
                  <strong class="num" style="color:var(--accent-action);">+${summary.tutorialBonusCredits}¤</strong>
                </div>`
              : ''
          }
          ${summary.lineItems
            .map((line) => {
              const toggleBtn =
                isSafe && line.isCollectible
                  ? `<button type="button" class="btn btn-compact ${
                      line.keptForCollection ? 'btn-energy' : 'btn-primary'
                    }" data-toggle-keep="${line.item.instanceId}" ${readOnly ? 'disabled' : ''}>
                      ${line.keptForCollection ? '留作收藏 (0¤)' : `出售 (+${line.item.value}¤)`}
                    </button>`
                  : `<strong class="num">+${line.creditsValue}¤</strong>`;
              return `
                <div class="settlement-row">
                  <div class="settlement-item-left">
                    <img class="settlement-thumb" src="${getItemImageUrl(line.item.defId)}" alt="${line.name}" />
                    <strong>${line.name}</strong>
                    ${line.isCollectible ? `<span class="tag tag-amber">藏品</span>` : ''}
                  </div>
                  ${toggleBtn}
                </div>
              `;
            })
            .join('')}
          ${exp.bay.placed
            .filter((p) => p.item.isBorrowed)
            .map((p) => {
              const def = getItemDef(p.item.defId);
              return `
                <div class="settlement-row" style="opacity:0.65;">
                  <div class="settlement-item-left">
                    <img class="settlement-thumb" src="${getItemImageUrl(p.item.defId)}" alt="${def.name}" />
                    <span>${def.name}</span>
                  </div>
                  <span class="tag">借用归还</span>
                </div>
              `;
            })
            .join('')}
          ${
            !isSafe
              ? `<div class="settlement-row" style="border-color:var(--state-danger);">
                  <span>拖回折算 (40%)</span>
                  <strong class="num">floor(${summary.rawRecoverableTotal} × 40%)</strong>
                </div>`
              : ''
          }
        </div>

        <div class="settlement-total">
          <span>本次实得</span>
          <span class="num" style="color:var(--accent-action);" id="settlement-final-credits">+${summary.finalCreditsEarned}</span>
        </div>

        ${
          summary.newlyDiscoveredDefIds.length > 0
            ? `<div style="font-size:12px;color:var(--accent-energy);">✦ 新图鉴发现 +${summary.newlyDiscoveredDefIds.length}</div>`
            : ''
        }

        <button type="button" class="btn btn-primary btn-launch-hero" id="btn-confirm-settlement" ${
          readOnly ? 'disabled' : ''
        }>
          ${readOnly ? '只读锁定' : '▶ 确认入账 · 返回拆解站'}
        </button>
      </div>
    `;

    this.leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-toggle-keep]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.canMutate()) return;
        const id = btn.dataset.toggleKeep!;
        if (this.keptCollectibleIds.has(id)) {
          this.keptCollectibleIds.delete(id);
        } else {
          this.keptCollectibleIds.add(id);
        }
        soundEngine.play('click');
        // F12: Keep HUD and settlement total strictly synchronized on toggle
        this.renderTopHud();
        this.renderSettlementPhase(exp);
      });
    });

    this.leftPanelEl.querySelector('#btn-confirm-settlement')?.addEventListener('click', () => {
      if (!this.canMutate()) return;
      if (!this.save.activeExpedition || this.save.activeExpedition.phase !== 'SETTLEMENT') return;

      const creditsBefore = this.save.progression.credits;
      const result = applyExpeditionSettlement(
        this.save.progression,
        this.save.activeExpedition,
        Array.from(this.keptCollectibleIds)
      );
      this.keptCollectibleIds.clear();

      // Authoritative payout & persistence happen IMMEDIATELY BEFORE any animation (F11)
      this.save = {
        ...this.save,
        progression: result.progression,
        activeExpedition: null,
      };
      this.persist();
      soundEngine.play('returnDock');

      const reduced = this.save.settings.reducedMotion;
      const notice: ReturnDockingNotice = {
        creditsBefore,
        creditsAfter: result.progression.credits,
        earnedCredits: result.summary.finalCreditsEarned,
        crateCount: Math.max(1, result.summary.lineItems.length),
        hasKeptRelic: result.summary.keptRelicCount > 0,
        wasDefeat: result.summary.reason === 'defeat',
        goalHint: this.computeNextBuildGoalHint(),
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
          onProgress: (p) => {
            if (this.activeDockingNotice !== notice) return;
            notice.progress = p;
            this.renderDockingOverlay();
          },
          onFinish: () => {
            if (this.activeDockingNotice !== notice) return;
            notice.animating = false;
            notice.progress = 1;
            this.renderTopHud();
            this.renderDockingOverlay();
            this.renderBanners();
          },
        });
      }
    });

    this.mountCargoBayPanel(exp, isSafe ? '返航船舱清点' : '战败前最终船舱布局');
  }
}
