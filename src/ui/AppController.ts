import { getItemImageUrl } from '../assets/itemArt';
import { soundEngine } from '../audio/soundEngine';
import { BUILDINGS, RELICS, type BuildingId } from '../data/buildings';
import { LOADOUTS, getItemDef, type LoadoutId } from '../data/items';
import { MAX_EXPEDITION_NODES, type RouteType } from '../data/nodes';
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
  canRestoreRelic,
  getCodexSummary,
  getVisibleBuildings,
  isLoadoutUnlocked,
  type GameSettings,
} from '../domain/progression';
import { MultiTabGuard } from '../domain/tabLock';
import { PhaserHost } from '../scenes/PhaserHost';
import { CargoGridComponent, renderMiniMaskHtml } from './CargoGrid';
import {
  openBackupRecoveryModal,
  openCodexModal,
  openDiscardConfirmModal,
  openHelpModal,
  openSettingsModal,
  registerModalBackgroundRoot,
} from './Modals';

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

  // Live combat playback display values
  private liveCombatPlayerHp = 30;
  private liveCombatPlayerShield = 0;
  private liveCombatEnemyHp = 0;
  private liveCombatRound = 0;
  private activeCombatPlaybackKey: string | null = null;

  // Persistent DOM containers so Phaser canvas stays mounted without flicker!
  private appShellEl!: HTMLElement;
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

  init(): void {
    this.buildShellDom();

    const loaded = loadSaveData(window.localStorage);
    if (loaded.status === 'loaded' || loaded.status === 'fresh') {
      this.save = loaded.data;
    } else if (loaded.status === 'corrupt_with_backup') {
      this.save = loaded.backup;
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

    // Mount modalHostEl as a SIBLING of app-shell so making app-shell inert isolates background cleanly!
    this.modalHostEl = document.createElement('div');
    this.modalHostEl.id = 'modal-host';

    this.mountEl.appendChild(shell);
    this.mountEl.appendChild(this.modalHostEl);
    registerModalBackgroundRoot(this.appShellEl);
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

  private syncAll(): void {
    this.renderTopHud();
    this.renderBanners();
    this.phaserHost?.setCombatPaused(this.isReadOnlyTab);

    const exp = this.save.activeExpedition;
    this.mainLayoutEl.classList.toggle('phase-arrange', Boolean(exp && exp.phase === 'ARRANGE'));
    if (!exp) {
      soundEngine.setTrack('base');
      this.activeCombatPlaybackKey = null;
      this.sceneCollapseOverride = null;
      this.sceneWrapEl.className = 'scene-stage-wrap mode-base';
      this.sceneOverlayEl.innerHTML = '';
      this.phaserHost?.resize();
      this.phaserHost?.showBase({
        progression: this.save.progression,
        settings: this.save.settings,
        recentlyBuiltId: this.recentlyBuiltId,
      });
      this.renderBasePanels();
    } else {
      soundEngine.setTrack('expedition');
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
      <div class="hud-group">
        <h1 class="hud-brand">星际拆解站</h1>
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

    // First-5-minute tutorial contextual hint (non-blocking, disappears once tutorial completes)
    const exp = this.save.activeExpedition;
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

    // Left column (below Base Phaser scene): Loadout selector & Launch CTA
    this.leftPanelEl.innerHTML = `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">出航准备 · 选择打捞船方案</h2>
            <p class="panel-subtitle">出航免费，每次出发恢复满耐久 30，最多深入 ${MAX_EXPEDITION_NODES} 个节点。</p>
          </div>
          <span class="tag">${prog.totalExpeditions > 0 ? `已出航 ${prog.totalExpeditions} 次` : '待首航'}</span>
        </div>

        <div class="loadout-grid">
          ${(['cannon_skiff', 'shield_cruiser'] as LoadoutId[])
            .map((id) => {
              const def = LOADOUTS[id];
              const unlocked = isLoadoutUnlocked(prog, id);
              const selected = activeLoadout === id;
              return `
                <button type="button" class="loadout-card ${selected ? 'selected' : ''}"
                  data-loadout="${id}" ${unlocked && !readOnly ? '' : 'disabled'}>
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
                    <strong>${def.name}</strong>
                    <span class="tag ${selected ? 'tag-amber' : ''}">${
                      unlocked ? (selected ? '当前方案' : '可切换') : '需船坞扩建'
                    }</span>
                  </div>
                  <div style="font-size:13px;color:var(--accent-energy);font-weight:600;">${def.subtitle}</div>
                  <div style="font-size:12px;color:var(--text-secondary);">${def.description}</div>
                </button>
              `;
            })
            .join('')}
        </div>

        <button type="button" class="btn btn-primary" id="btn-launch-expedition" style="width:100%;font-size:16px;" ${
          readOnly ? 'disabled' : ''
        }>
          ${
            readOnly
              ? '只读模式 · 请先接管控制权后出航'
              : isFirstRun
              ? '第一次打捞（新手航次）'
              : `驾驶「${LOADOUTS[activeLoadout].name}」开始出航`
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

    this.leftPanelEl.querySelector('#btn-launch-expedition')?.addEventListener('click', () => {
      if (!this.canMutate()) return;
      soundEngine.unlock();
      soundEngine.play('click');
      this.recentlyBuiltId = null;
      this.keptCollectibleIds.clear();
      const exp = startExpedition({
        loadoutId: activeLoadout,
        isTutorial: !this.save.progression.tutorialCompleted,
      });
      this.save = { ...this.save, activeExpedition: exp };
      this.persist();
      this.syncAll();
    });

    // Right column: Base Facilities & Relic Restoration
    const visibleBuildings = getVisibleBuildings(prog);
    const navRelic = RELICS.ancient_navigator;
    const navState = prog.relics.ancient_navigator ?? { storedCount: 0, restored: false };
    const restoreCheck = canRestoreRelic(prog, 'ancient_navigator');

    this.rightPanelEl.innerHTML = `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">拆解站建设</h2>
            <p class="panel-subtitle">
              ${
                prog.buildings.workbench
                  ? '点击设施卡片或直接点击上方基地建筑进行修复与查看。'
                  : '先完成一次打捞带回 40 信用点，修复工作台点亮你的小站。'
              }
            </p>
          </div>
          <span class="tag tag-amber">余额 ${prog.credits}</span>
        </div>

        <div class="facility-list">
          ${visibleBuildings
            .map((bid) => {
              const def = BUILDINGS[bid];
              const built = prog.buildings[bid];
              const check = canBuildFacility(prog, bid);
              const disabledReason = readOnly ? '只读模式' : check.reason;
              return `
                <div class="facility-card ${built ? 'built' : ''}">
                  <div class="facility-info">
                    <div class="facility-name-row">
                      <span>${def.name}</span>
                      <span class="tag ${built ? 'tag-energy' : 'tag-amber'}">${
                        built ? '已修复运转' : `${def.cost} 信用点`
                      }</span>
                    </div>
                    <div style="font-size:13px;color:var(--text-primary);">${def.benefit}</div>
                    <div style="font-size:12px;color:var(--text-secondary);">
                      场景：${built ? def.repairedDescription : def.sceneChange}
                    </div>
                  </div>
                  <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;">
                    ${
                      built
                        ? bid === 'workbench'
                          ? `<button type="button" class="btn btn-energy btn-compact" data-open-codex="1">打开图鉴</button>`
                          : `<span class="tag tag-energy">已启用</span>`
                        : `<button type="button" class="btn btn-primary btn-compact" data-build="${bid}" ${
                            check.canBuild && !readOnly ? '' : 'disabled'
                          }>修复建造</button>
                           ${
                             (!check.canBuild || readOnly) && disabledReason
                               ? `<span style="font-size:12px;color:var(--text-secondary);">${disabledReason}</span>`
                               : ''
                           }`
                    }
                  </div>
                </div>
              `;
            })
            .join('')}
        </div>

        ${
          prog.buildings.display
            ? `
            <div class="inspector-card" style="border-color:rgba(246,184,82,0.45);">
              <div class="panel-header">
                <strong>收藏展台 · ${navRelic.name}</strong>
                <span class="tag ${navState.restored ? 'tag-energy' : 'tag-amber'}">
                  ${
                    navState.restored
                      ? '已修复展示中'
                      : navState.storedCount > 0
                      ? `库存 ${navState.storedCount} 件待修复`
                      : '尚未带回实物'
                  }
                </span>
              </div>
              <div style="font-size:13px;color:var(--text-secondary);">
                ${navState.restored ? navRelic.lore : navRelic.description}
              </div>
              ${
                !navState.restored
                  ? `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
                      <span style="font-size:12px;color:var(--text-secondary);">
                        ${
                          readOnly
                            ? '只读模式不可修复'
                            : restoreCheck.canRestore
                            ? `修复费用 ${navRelic.restoreCost} 信用点`
                            : restoreCheck.reason
                        }
                      </span>
                      <button type="button" class="btn btn-primary btn-compact" id="btn-restore-nav" ${
                        restoreCheck.canRestore && !readOnly ? '' : 'disabled'
                      }>支付 ${navRelic.restoreCost} 修复展示</button>
                    </div>`
                  : ''
              }
            </div>
          `
            : ''
        }
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

    this.rightPanelEl.querySelector('#btn-restore-nav')?.addEventListener('click', () => {
      if (!this.canMutate()) return;
      const res = restoreRelic(this.save.progression, 'ancient_navigator');
      if (res.ok) {
        soundEngine.play('buildComplete');
        this.recentlyBuiltId = 'display';
        this.save = { ...this.save, progression: res.progression };
        this.persist();
        this.syncAll();
      }
    });
  }

  private handleBuildingInteract(buildingId: BuildingId): void {
    const prog = this.save.progression;
    if (prog.buildings[buildingId]) {
      if (buildingId === 'workbench') {
        soundEngine.play('click');
        this.openCodexModal();
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
    // Configure scene viewport size & Phaser CombatScene state per phase
    if (exp.phase === 'ARRANGE') {
      const collapsed = this.isArrangeSceneCollapsed();
      this.sceneWrapEl.className = `scene-stage-wrap mode-arrange ${collapsed ? 'collapsed' : ''}`;
    } else if (exp.phase === 'ROUTE_SELECT') {
      this.sceneWrapEl.className = 'scene-stage-wrap mode-route';
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
        simulation: null,
        settings: this.save.settings,
      });
      this.renderSettlementPhase(exp);
    }
  }

  private mountCargoBayPanel(exp: ExpeditionState, title: string): void {
    const editable = isCargoBayEditable(exp) && this.canMutate();
    this.rightPanelEl.innerHTML = `
      <div class="panel">
        <div class="panel-header">
          <h2 class="panel-title">${title}</h2>
          <span class="tag ${editable ? 'tag-amber' : ''}">
            ${editable ? '可拖拽 / 点选 / 键盘整理' : this.isReadOnlyTab ? '只读锁定中' : '航行锁定中'}
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

    const renderRouteCard = (
      routeType: RouteType,
      data: ReturnType<typeof getRoutePreview>,
      lockedForTutorial = false
    ) => {
      const { routeSpec, prediction } = data;
      const isDanger = routeType === 'danger';
      const lethal = prediction.outcome === 'defeat';

      return `
        <div class="route-card ${isDanger ? 'danger' : ''}">
          <div class="route-header">
            <strong>${routeSpec.label}</strong>
            <span class="tag ${isDanger ? 'tag-danger' : 'tag-energy'}">${routeSpec.enemy.name}</span>
          </div>

          <div class="route-stats">
            <div class="route-stat-item"><span style="color:var(--text-secondary);">敌耐久</span><strong class="num">${routeSpec.enemy.maxHp}</strong></div>
            <div class="route-stat-item"><span style="color:var(--text-secondary);">敌伤害</span><strong class="num">${routeSpec.enemy.damagePerRound}/轮</strong></div>
            <div class="route-stat-item"><span style="color:var(--text-secondary);">胜利悬赏</span><strong class="num" style="color:var(--accent-action);">+${routeSpec.bounty}</strong></div>
            <div class="route-stat-item"><span style="color:var(--text-secondary);">优良率</span><strong class="num" style="color:var(--accent-energy);">${Math.round(routeSpec.improvedEquipmentProb * 100)}%</strong></div>
          </div>

          <div style="font-size:12px;color:var(--text-secondary);">
            货物报价范围：<strong class="num" style="color:var(--text-primary);">${routeSpec.cargoPriceRange.min}–${routeSpec.cargoPriceRange.max}</strong> 信用点
          </div>

          <div class="route-prediction ${lethal ? 'lethal' : ''}">
            ${
              lethal
                ? `<strong style="color:var(--state-danger);">⚠ 预计战败</strong>（${prediction.roundsCount} 轮后耐久归零）`
                : `<div>预计交火 <strong class="num">${prediction.roundsCount}</strong> 轮 · 护盾挡 <strong class="num">${prediction.totalShieldAbsorbed}</strong> · 掉血 <strong class="num">${prediction.totalHpLoss}</strong></div>
                   <div>战后耐久：<strong class="num" style="color:var(--accent-energy);">${prediction.finalPlayerHp}/${exp.maxHp}</strong>${
                     prediction.repairApplied > 0 ? `（含胜后修 +${prediction.repairApplied}）` : ''
                   }</div>`
            }
          </div>

          <button type="button" class="btn ${isDanger ? 'btn-danger' : 'btn-primary'}"
            data-select-route="${routeType}" ${lockedForTutorial || readOnly ? 'disabled' : ''}>
            ${
              readOnly
                ? '只读模式已锁定'
                : lockedForTutorial
                ? '第 2 站解锁危险航路'
                : lethal
                ? '仍冒险进入交火'
                : '确认进入交火'
            }
          </button>
        </div>
      `;
    };

    this.leftPanelEl.innerHTML = `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">节点 ${exp.currentNode}/${exp.maxNodes} · ${normal.routeSpec.sectorName}</h2>
            <p class="panel-subtitle">查看公开敌情与战后耐久预测，选择本次航路。</p>
          </div>
          <span class="tag tag-amber">累计悬赏 ${exp.accumulatedBounty}</span>
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
        soundEngine.play('click');
        const nextExp = selectRoute(exp, routeType);
        this.save = { ...this.save, activeExpedition: nextExp };
        this.persist();
        this.syncAll();
      });
    });

    this.mountCargoBayPanel(exp, '当前船舱配置（已锁定）');
  }

  private renderCombatPhase(exp: ExpeditionState): void {
    const readOnly = !this.canMutate();
    const combat = exp.activeCombat!;
    const playbackKey = `${exp.expeditionId}_${exp.currentNode}_${combat.routeSpec.routeType}`;

    if (this.activeCombatPlaybackKey !== playbackKey) {
      this.activeCombatPlaybackKey = playbackKey;
      this.liveCombatPlayerHp = combat.startingHp;
      this.liveCombatPlayerShield = combat.simulation.startingPlayerShield;
      this.liveCombatEnemyHp = combat.simulation.startingEnemyHp;
      this.liveCombatRound = 0;

      this.phaserHost?.showCombat({
        loadoutId: exp.loadoutId,
        enemy: combat.routeSpec.enemy,
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
      this.phaserHost?.setCombatPaused(readOnly);
    }

    this.updateCombatOverlayBars(exp);

    this.leftPanelEl.innerHTML = `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">${readOnly ? '同步交火已暂停（只读模式）' : `同步交火中 · ${combat.routeSpec.enemy.name}`}</h2>
            <p class="panel-subtitle">我方攻击 ${combat.statsSnapshot.totalAttack} / 初始护盾 ${combat.statsSnapshot.effectiveShield} · 敌方每轮伤害 ${combat.routeSpec.enemy.damagePerRound}</p>
          </div>
          <span class="tag tag-energy" id="combat-round-tag">第 ${this.liveCombatRound}/${combat.simulation.roundsCount} 轮</span>
        </div>
        <div class="action-dock">
          <button type="button" class="btn ${this.save.settings.combatSpeed === 2 ? 'btn-energy' : ''}" id="btn-combat-speed" ${
            readOnly ? 'disabled' : ''
          }>
            当前速度：${this.save.settings.combatSpeed}×（切换）
          </button>
          <button type="button" class="btn" id="btn-skip-combat" ${readOnly ? 'disabled' : ''}>快速结算本战</button>
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
      if (btn) btn.textContent = `当前速度：${nextSpeed}×（切换）`;
    });

    this.leftPanelEl.querySelector('#btn-skip-combat')?.addEventListener('click', () => {
      if (!this.canMutate()) return;
      soundEngine.play('click');
      this.phaserHost?.skipCombatPlayback();
    });

    this.mountCargoBayPanel(exp, '船舱配置（交火锁定）');
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

    this.sceneOverlayEl.innerHTML = `
      <div class="combat-hud-bars">
        <div class="unit-bar-card">
          <div class="unit-bar-header">
            <span class="name">我方打捞船</span>
            <span class="num">${this.liveCombatPlayerHp}/${exp.maxHp}${
              this.liveCombatPlayerShield > 0 ? ` · 盾 ${this.liveCombatPlayerShield}` : ''
            }</span>
          </div>
          <div class="hp-track"><div class="hp-fill" style="width:${pHpPct}%"></div></div>
          ${
            combat.simulation.startingPlayerShield > 0
              ? `<div class="shield-track"><div class="shield-fill" style="width:${pShPct}%"></div></div>`
              : ''
          }
        </div>
        <div class="unit-bar-card">
          <div class="unit-bar-header">
            <span class="name">${combat.routeSpec.enemy.name}</span>
            <span class="num">${this.liveCombatEnemyHp}/${combat.routeSpec.enemy.maxHp}</span>
          </div>
          <div class="hp-track"><div class="hp-fill enemy" style="width:${eHpPct}%"></div></div>
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

    // Trigger rare chime if collectible or high-value cargo appeared
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
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">交火胜利 · 战利品三选一</h2>
            <p class="panel-subtitle">
              已获悬赏 +${lastSim?.bountyEarned ?? 0}${
                lastSim && lastSim.repairApplied > 0 ? ` · 无人机修复 +${lastSim.repairApplied} 耐久` : ''
              }。先看清数值与占格再选择一项。
            </p>
          </div>
        </div>

        <div class="reward-grid">
          ${rewards
            .map((opt) => {
              if (opt.kind === 'repair') {
                const afterHp = Math.min(exp.maxHp, exp.currentHp + opt.healAmount);
                const actualGain = afterHp - exp.currentHp;
                return `
                  <div class="reward-card">
                    <div class="reward-top">
                      <div class="reward-thumb" style="font-size:24px;font-weight:800;color:var(--accent-energy);">+HP</div>
                      <div>
                        <div style="font-weight:700;font-size:15px;">紧急船体维修</div>
                        <div style="font-size:12px;color:var(--text-secondary);">不占船舱格子</div>
                      </div>
                    </div>
                    <div style="font-size:13px;">
                      恢复 <strong class="num" style="color:var(--accent-energy);">+${opt.healAmount}</strong> 耐久<br/>
                      <span style="color:var(--text-secondary);">耐久：${exp.currentHp} → ${afterHp}（实补 +${actualGain}）</span>
                    </div>
                    <button type="button" class="btn btn-energy" data-pick-reward="repair" ${
                      readOnly ? 'disabled' : ''
                    }>${readOnly ? '只读锁定' : '选择维修'}</button>
                  </div>
                `;
              }

              const def = getItemDef(opt.item.defId);
              const shape = SHAPES[def.shapeId];
              const isCollectible = def.category === 'cargo' && def.isCollectible;
              const perCell = Math.round(opt.item.value / shape.cells.length);

              return `
                <div class="reward-card ${isCollectible ? 'highlight-collectible' : ''}">
                  <div class="reward-top">
                    <div class="reward-thumb">
                      <img src="${getItemImageUrl(def.defId)}" alt="${def.name}" />
                    </div>
                    <div style="min-width:0;">
                      <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">
                        <strong style="font-size:15px;">${def.name}</strong>
                        ${
                          def.category === 'equipment'
                            ? `<span class="tag ${def.quality === 'improved' ? 'tag-energy' : ''}">${
                                def.quality === 'improved' ? '‖ 优良' : '| 普通'
                              }</span>`
                            : isCollectible
                            ? `<span class="tag tag-amber">可收藏</span>`
                            : `<span class="tag">货物</span>`
                        }
                      </div>
                      <div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
                        ${renderMiniMaskHtml(def.defId)}
                        <span style="font-size:12px;color:var(--text-secondary);">${shape.label}</span>
                      </div>
                    </div>
                  </div>
                  <div style="font-size:13px;">
                    ${
                      def.category === 'equipment'
                        ? `<strong style="color:var(--accent-energy);">${def.summary}</strong><br/><span style="color:var(--text-secondary);font-size:12px;">返航回收 ${opt.item.value} 信用点</span>`
                        : `<strong style="color:var(--accent-action);">估值 ${opt.item.value} 信用点</strong><br/><span style="color:var(--text-secondary);font-size:12px;">单格均价 ${perCell} · 无战斗加成</span>`
                    }
                  </div>
                  <button type="button" class="btn btn-primary" data-pick-reward="${opt.optionId}" ${
                    readOnly ? 'disabled' : ''
                  }>
                    ${readOnly ? '只读锁定' : '收入暂存区'}
                  </button>
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
        soundEngine.play('place');
        const nextExp = selectReward(exp, optionId);
        this.save = { ...this.save, activeExpedition: nextExp };
        this.persist();
        this.syncAll();
      });
    });

    this.mountCargoBayPanel(exp, '当前船舱一览（选定后进入整理）');
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
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title" style="color:${isSafe ? 'var(--accent-action)' : 'var(--state-danger)'};">
              ${isSafe ? '安全返航 · 收益结算' : '舰体损毁 · 紧急拖回结算'}
            </h2>
            <p class="panel-subtitle">
              ${
                isSafe
                  ? `顺利完成 ${exp.completedNodes} 个节点，所有带回物资已清点完毕。`
                  : `在节点 ${exp.currentNode} 战败，已按 40% 折算回收收益；基地建筑、资金与图鉴记录不受损失。`
              }
            </p>
          </div>
          <span class="tag ${isSafe ? 'tag-amber' : 'tag-danger'}">完成 ${exp.completedNodes} 站</span>
        </div>

        ${
          !isSafe && lastCombat
            ? `
            <div class="inspector-card" style="border-color:var(--state-danger);">
              <strong style="color:var(--state-danger);">战败复盘（可归因记录）</strong>
              <div style="font-size:13px;color:var(--text-secondary);">
                对手：${lastCombat.routeSpec.enemy.name}（${lastCombat.routeSpec.enemy.maxHp} 血 / 每轮 ${lastCombat.routeSpec.enemy.damagePerRound} 伤）<br/>
                我方开战配置：耐久 ${lastCombat.startingHp} · 攻击 ${lastCombat.statsSnapshot.totalAttack} · 护盾 ${lastCombat.statsSnapshot.effectiveShield} · 交火 ${lastCombat.simulation.roundsCount} 轮<br/>
                下趟建议：优先补足火力/护盾压低战损，或在耐久偏低时主动选择安全返航。
              </div>
            </div>
          `
            : ''
        }

        <div class="settlement-list">
          <div class="settlement-row">
            <span>累计战斗悬赏</span>
            <strong class="num">+${summary.bountyCredits}</strong>
          </div>
          ${
            summary.tutorialBonusCredits > 0
              ? `<div class="settlement-row">
                  <span>首次打捞站内启动补贴</span>
                  <strong class="num" style="color:var(--accent-action);">+${summary.tutorialBonusCredits}</strong>
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
                      ${
                        line.keptForCollection
                          ? '已选：留作收藏（0 信用点）'
                          : `已选：按 ${line.item.value} 出售`
                      }
                    </button>`
                  : `<strong class="num">+${line.creditsValue}</strong>`;
              return `
                <div class="settlement-row">
                  <div>
                    <strong>${line.name}</strong>
                    ${
                      line.isCollectible
                        ? `<span class="tag tag-amber" style="margin-left:6px;">稀有藏品</span>`
                        : ''
                    }
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
                <div class="settlement-row" style="opacity:0.7;">
                  <span>${def.name}（初始借用设备）</span>
                  <span class="tag">归还 · 不计价</span>
                </div>
              `;
            })
            .join('')}
          ${
            !isSafe
              ? `<div class="settlement-row" style="border-color:var(--state-danger);">
                  <span>战败折算比例（向下取整）</span>
                  <strong class="num">floor(${summary.rawRecoverableTotal} × 40%)</strong>
                </div>`
              : ''
          }
        </div>

        <div class="settlement-total">
          <span>本次实得信用点</span>
          <span class="num" style="color:var(--accent-action);" id="settlement-final-credits">+${summary.finalCreditsEarned}</span>
        </div>

        ${
          summary.newlyDiscoveredDefIds.length > 0
            ? `<div style="font-size:13px;color:var(--accent-energy);">新录入图鉴发现记录：${summary.newlyDiscoveredDefIds.length} 项</div>`
            : ''
        }

        <button type="button" class="btn btn-primary" id="btn-confirm-settlement" style="width:100%;font-size:16px;" ${
          readOnly ? 'disabled' : ''
        }>
          ${readOnly ? '只读模式 · 请先接管控制权再入账' : '确认入账并返回拆解站'}
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
      soundEngine.play('returnDock');
      const result = applyExpeditionSettlement(
        this.save.progression,
        this.save.activeExpedition,
        Array.from(this.keptCollectibleIds)
      );
      this.keptCollectibleIds.clear();
      this.save = {
        ...this.save,
        progression: result.progression,
        activeExpedition: null,
      };
      this.persist();
      this.syncAll();
    });

    this.mountCargoBayPanel(exp, isSafe ? '返航船舱清点' : '战败前最终船舱布局');
  }
}
