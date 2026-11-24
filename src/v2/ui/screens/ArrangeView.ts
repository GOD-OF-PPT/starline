import { getV2EquipmentDefByKind, type V2EquipmentKind } from '../../data/equipment';
import { getV3GadgetDef } from '../../data/gadgets';
import { V2_SHAPES } from '../../data/shapes';
import { V2_SHIPS } from '../../data/ships';
import { canPerformSurveyAtCurrentNode, isContractReadyForDelivery } from '../../domain/contracts';
import { canUseV3GadgetInRun, isAtTerminalLayer } from '../../domain/encounter';
import { deriveV2ShipVisualSpec } from '../../domain/shipVisualSpec';
import type { V2RunState } from '../../domain/types';
import { crewPortraitSvg, svgIcon } from '../icons';
import { findEngineerSwapTargetInBay, type PhaseView } from './screenTypes';

export interface ArrangeViewProps {
  readonly run: V2RunState;
  readonly readOnly: boolean;
  readonly sceneCollapsed: boolean;
}

export interface ArrangeViewActions {
  readonly onToggleShipPreview: () => void;
  readonly onEngineerSwap: (kind: V2EquipmentKind) => void;
  readonly onSurveyScan: () => void;
  readonly onUseGadget?: (instanceId: string) => void;
  readonly onAbortContract: () => void;
  readonly onLeaveArrange: (terminal: boolean) => void;
}

/**
 * Stateful Arrange PhaseView (F04 / PROJECT.md § Interface Contracts #6).
 * Preserves DOM identity across repeated in-phase updates and keeps
 * `#v3-arrange-inspector-slot` untouched for CargoGridV2's mounted inspector.
 */
export class ArrangePhaseView implements PhaseView<ArrangeViewProps, ArrangeViewActions> {
  private hostEl: HTMLElement | null = null;
  private rootEl: HTMLElement | null = null;
  private subEl: HTMLElement | null = null;
  private goalStripEl: HTMLElement | null = null;
  private shipNameEl: HTMLElement | null = null;
  private mountPillsHostEl: HTMLElement | null = null;
  private toggleShipBtn: HTMLButtonElement | null = null;

  private engineerSlotEl: HTMLElement | null = null;
  private engineerBannerEl: HTMLElement | null = null;
  private engineerTitleEl: HTMLElement | null = null;
  private engineerBtnsWrapEl: HTMLElement | null = null;
  private readonly engineerBtns = new Map<V2EquipmentKind, HTMLButtonElement>();

  private gadgetSlotEl: HTMLElement | null = null;
  private gadgetBarEl: HTMLElement | null = null;
  private gadgetBtnsWrapEl: HTMLElement | null = null;
  private readonly gadgetBtns = new Map<string, HTMLButtonElement>();

  private surveySlotEl: HTMLElement | null = null;
  private surveyBannerEl: HTMLElement | null = null;
  private surveyDescEl: HTMLElement | null = null;
  private surveyBtn: HTMLButtonElement | null = null;

  private inspectorSlotEl: HTMLElement | null = null;
  private actionsRowEl: HTMLElement | null = null;
  private leaveBtn: HTMLButtonElement | null = null;
  private abortBtn: HTMLButtonElement | null = null;

  private latestActions: ArrangeViewActions | null = null;
  private latestTerminal = false;
  private lastMountTagsKey = '';
  private lastLeaveBtnKey = '';
  private lastEngineerTitleKey = '';

  private readonly handleToggleShip = (): void => {
    if (!this.rootEl || !this.latestActions) return;
    this.latestActions.onToggleShipPreview();
  };

  private readonly handleLeave = (): void => {
    if (!this.rootEl || !this.leaveBtn || this.leaveBtn.disabled || !this.latestActions) return;
    this.latestActions.onLeaveArrange(this.latestTerminal);
  };

  private readonly handleAbort = (): void => {
    if (!this.rootEl || !this.abortBtn || this.abortBtn.disabled || !this.latestActions) return;
    this.latestActions.onAbortContract();
  };

  private readonly handleSurvey = (): void => {
    if (!this.rootEl || !this.surveyBtn || this.surveyBtn.disabled || !this.latestActions) return;
    this.latestActions.onSurveyScan();
  };

  private readonly handleEngineerClick = (ev: MouseEvent): void => {
    if (!this.rootEl || !this.latestActions) return;
    const target = ev.target as HTMLElement | null;
    const btn = target?.closest<HTMLButtonElement>('[data-eng-swap]');
    if (!btn || btn.disabled) return;
    const kind = btn.dataset.engSwap as V2EquipmentKind | undefined;
    if (kind) {
      this.latestActions.onEngineerSwap(kind);
    }
  };

  private readonly handleGadgetClick = (ev: MouseEvent): void => {
    if (!this.rootEl || !this.latestActions?.onUseGadget) return;
    const target = ev.target as HTMLElement | null;
    const btn = target?.closest<HTMLButtonElement>('[data-use-gadget]');
    if (!btn || btn.disabled) return;
    const instanceId = btn.dataset.useGadget;
    if (instanceId) {
      this.latestActions.onUseGadget(instanceId);
    }
  };

  isMountedIn(host: HTMLElement): boolean {
    return this.hostEl === host && this.rootEl !== null && host.contains(this.rootEl);
  }

  getInspectorSlot(): HTMLElement | null {
    return this.inspectorSlotEl;
  }

  mount(host: HTMLElement): void {
    if (this.isMountedIn(host)) return;
    if (this.rootEl || this.hostEl) {
      this.unmount();
    }

    const rootEl = document.createElement('div');
    rootEl.className = 'v3-screen-root';
    rootEl.dataset.testid = 'arrange-screen';

    // Header
    const header = document.createElement('div');
    header.className = 'panel-header';
    const h2 = document.createElement('h2');
    h2.innerHTML = `${svgIcon('grid', 16)} 船舱整理`;
    const subEl = document.createElement('span');
    subEl.className = 'panel-sub';
    header.appendChild(h2);
    header.appendChild(subEl);
    rootEl.appendChild(header);

    // Goal strip
    const goalStripEl = document.createElement('div');
    goalStripEl.className = 'v2-arrange-goal-strip';
    rootEl.appendChild(goalStripEl);

    // Exterior mount summary bar
    const exteriorBar = document.createElement('div');
    exteriorBar.className = 'v2-arrange-exterior-bar';

    const exteriorPills = document.createElement('div');
    exteriorPills.className = 'v2-arrange-exterior-pills';
    const rocketWrap = document.createElement('span');
    rocketWrap.style.display = 'contents';
    rocketWrap.innerHTML = svgIcon('rocket', 13);
    const shipNameEl = document.createElement('span');
    const mountPillsHostEl = document.createElement('span');
    mountPillsHostEl.style.display = 'contents';
    exteriorPills.appendChild(rocketWrap);
    exteriorPills.appendChild(shipNameEl);
    exteriorPills.appendChild(mountPillsHostEl);

    const toggleShipBtn = document.createElement('button');
    toggleShipBtn.type = 'button';
    toggleShipBtn.className = 'btn btn-sm btn-ghost';
    toggleShipBtn.id = 'v2-arrange-toggle-ship';

    exteriorBar.appendChild(exteriorPills);
    exteriorBar.appendChild(toggleShipBtn);
    rootEl.appendChild(exteriorBar);

    // Optional Engineer Swap slot
    const engineerSlotEl = document.createElement('div');
    engineerSlotEl.dataset.slot = 'engineer-swap';
    engineerSlotEl.style.display = 'none';
    const engineerBannerEl = document.createElement('div');
    engineerBannerEl.className = 'v2-engineer-banner';
    engineerBannerEl.dataset.testid = 'engineer-swap-banner';
    const engineerTitleEl = document.createElement('div');
    engineerTitleEl.className = 'v2-eng-title';
    const engineerBtnsWrapEl = document.createElement('div');
    engineerBtnsWrapEl.className = 'v2-eng-btns';
    engineerBannerEl.appendChild(engineerTitleEl);
    engineerBannerEl.appendChild(engineerBtnsWrapEl);
    rootEl.appendChild(engineerSlotEl);

    // Optional Arrange Gadgets slot
    const gadgetSlotEl = document.createElement('div');
    gadgetSlotEl.dataset.slot = 'arrange-gadgets';
    gadgetSlotEl.style.display = 'none';
    const gadgetBarEl = document.createElement('div');
    gadgetBarEl.className = 'v3-gadget-bar';
    gadgetBarEl.dataset.testid = 'arrange-gadget-bar';
    const gadgetLabelEl = document.createElement('span');
    gadgetLabelEl.className = 'v3-gadget-bar-label';
    gadgetLabelEl.innerHTML = `${svgIcon('bolt', 12)} 战术消耗装置`;
    const gadgetBtnsWrapEl = document.createElement('div');
    gadgetBtnsWrapEl.className = 'v3-gadget-bar-btns';
    gadgetBarEl.appendChild(gadgetLabelEl);
    gadgetBarEl.appendChild(gadgetBtnsWrapEl);
    rootEl.appendChild(gadgetSlotEl);

    // Optional Survey Scan slot
    const surveySlotEl = document.createElement('div');
    surveySlotEl.dataset.slot = 'survey-scan';
    surveySlotEl.style.display = 'none';
    const surveyBannerEl = document.createElement('div');
    surveyBannerEl.className = 'v2-survey-banner';
    const surveyInfoWrap = document.createElement('div');
    const surveyTitleEl = document.createElement('strong');
    surveyTitleEl.innerHTML = `${svgIcon('radar', 14)} 委托勘测点`;
    const surveyDescEl = document.createElement('div');
    surveyDescEl.style.fontSize = '12px';
    surveyDescEl.style.color = 'var(--text-secondary)';
    surveyInfoWrap.appendChild(surveyTitleEl);
    surveyInfoWrap.appendChild(surveyDescEl);
    const surveyBtn = document.createElement('button');
    surveyBtn.type = 'button';
    surveyBtn.className = 'btn btn-sm btn-primary';
    surveyBtn.id = 'v2-btn-survey-scan';
    surveyBannerEl.appendChild(surveyInfoWrap);
    surveyBannerEl.appendChild(surveyBtn);
    rootEl.appendChild(surveySlotEl);

    // Persistent desktop inspector slot (NEVER cleared/replaced on update!)
    const inspectorSlotEl = document.createElement('div');
    inspectorSlotEl.className = 'v3-arrange-inspector-slot';
    inspectorSlotEl.id = 'v3-arrange-inspector-slot';
    inspectorSlotEl.dataset.testid = 'arrange-inspector-slot';
    rootEl.appendChild(inspectorSlotEl);

    // Actions row
    const actionsRowEl = document.createElement('div');
    actionsRowEl.className = 'v2-arrange-actions';

    const leaveBtn = document.createElement('button');
    leaveBtn.type = 'button';
    leaveBtn.className = 'btn btn-primary btn-launch-hero';
    leaveBtn.id = 'v2-btn-leave-arrange';
    leaveBtn.dataset.testid = 'btn-leave-arrange';

    const abortBtn = document.createElement('button');
    abortBtn.type = 'button';
    abortBtn.className = 'btn btn-sm btn-ghost';
    abortBtn.id = 'v2-arrange-abort';
    abortBtn.textContent = '放弃当前委托';

    actionsRowEl.appendChild(leaveBtn);
    rootEl.appendChild(actionsRowEl);

    // Bind listeners ONCE (delegating through latestActions to prevent stale closures)
    toggleShipBtn.addEventListener('click', this.handleToggleShip);
    leaveBtn.addEventListener('click', this.handleLeave);
    abortBtn.addEventListener('click', this.handleAbort);
    surveyBtn.addEventListener('click', this.handleSurvey);
    engineerSlotEl.addEventListener('click', this.handleEngineerClick);
    gadgetSlotEl.addEventListener('click', this.handleGadgetClick);

    host.appendChild(rootEl);

    this.hostEl = host;
    this.rootEl = rootEl;
    this.subEl = subEl;
    this.goalStripEl = goalStripEl;
    this.shipNameEl = shipNameEl;
    this.mountPillsHostEl = mountPillsHostEl;
    this.toggleShipBtn = toggleShipBtn;
    this.engineerSlotEl = engineerSlotEl;
    this.engineerBannerEl = engineerBannerEl;
    this.engineerTitleEl = engineerTitleEl;
    this.engineerBtnsWrapEl = engineerBtnsWrapEl;
    this.gadgetSlotEl = gadgetSlotEl;
    this.gadgetBarEl = gadgetBarEl;
    this.gadgetBtnsWrapEl = gadgetBtnsWrapEl;
    this.surveySlotEl = surveySlotEl;
    this.surveyBannerEl = surveyBannerEl;
    this.surveyDescEl = surveyDescEl;
    this.surveyBtn = surveyBtn;
    this.inspectorSlotEl = inspectorSlotEl;
    this.actionsRowEl = actionsRowEl;
    this.leaveBtn = leaveBtn;
    this.abortBtn = abortBtn;
    this.lastMountTagsKey = '';
    this.lastLeaveBtnKey = '';
    this.lastEngineerTitleKey = '';
  }

  update(props: ArrangeViewProps, actions: ArrangeViewActions): void {
    if (!this.rootEl) return;
    const { run, readOnly, sceneCollapsed: collapsed } = props;
    const surveyCheck = canPerformSurveyAtCurrentNode(run);
    const terminal = isAtTerminalLayer(run);

    this.latestActions = actions;
    this.latestTerminal = terminal;

    const hasStaging = run.bay.staging.length > 0;
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
    const visualSpec = deriveV2ShipVisualSpec(run.bay);

    if (this.subEl) {
      const subText = hasStaging ? `待处理 ${run.bay.staging.length} 件` : '已清空暂存区';
      if (this.subEl.textContent !== subText) this.subEl.textContent = subText;
    }

    if (this.goalStripEl) {
      this.goalStripEl.classList.toggle('is-mission', hasMissionInStaging);
      if (this.goalStripEl.textContent !== goalLine) this.goalStripEl.textContent = goalLine;
    }

    if (this.shipNameEl) {
      const shipLabel = `${V2_SHIPS[run.shipId].name}外挂：`;
      if (this.shipNameEl.textContent !== shipLabel) this.shipNameEl.textContent = shipLabel;
    }

    if (this.mountPillsHostEl) {
      const mountTagsKey = visualSpec.mountSummaryTags.join('|');
      if (mountTagsKey !== this.lastMountTagsKey) {
        this.lastMountTagsKey = mountTagsKey;
        this.mountPillsHostEl.innerHTML =
          visualSpec.mountSummaryTags.length > 0
            ? visualSpec.mountSummaryTags.map((t) => `<span class="v2-mount-pill">${t}</span>`).join('')
            : `<span class="v2-mount-pill muted">核心炮</span>`;
      }
    }

    if (this.toggleShipBtn) {
      const toggleLabel = collapsed ? '展开舰体预览' : '收起舰体预览';
      if (this.toggleShipBtn.textContent !== toggleLabel) {
        this.toggleShipBtn.textContent = toggleLabel;
      }
    }

    // Reconcile Engineer Swap Banner
    this.reconcileEngineerSwap(run, readOnly);

    // Reconcile Arrange Gadget Bar
    this.reconcileGadgetBar(run, readOnly, actions);

    // Reconcile Survey Scan Banner
    if (this.surveySlotEl && this.surveyBannerEl && this.surveyDescEl && this.surveyBtn) {
      if (surveyCheck.canSurvey) {
        if (this.surveyBannerEl.parentNode !== this.surveySlotEl) {
          this.surveySlotEl.appendChild(this.surveyBannerEl);
        }
        this.surveySlotEl.style.display = 'contents';
        const descText = `消耗 ${run.contract.surveyFuelCost} 燃料完成测绘（${run.contract.completedNodeIds.length}/${run.contract.requiredCompletions}）`;
        if (this.surveyDescEl.textContent !== descText) this.surveyDescEl.textContent = descText;
        this.surveyBtn.disabled = readOnly;
        const btnText = `执行勘测 (-${run.contract.surveyFuelCost} 油)`;
        if (this.surveyBtn.textContent !== btnText) this.surveyBtn.textContent = btnText;
      } else {
        if (this.surveyBannerEl.parentNode === this.surveySlotEl) {
          this.surveySlotEl.removeChild(this.surveyBannerEl);
        }
        this.surveySlotEl.style.display = 'none';
      }
    }

    // Note: this.inspectorSlotEl is intentionally NEVER cleared or replaced on update!

    // Leave Arrange button
    if (this.leaveBtn) {
      this.leaveBtn.disabled = readOnly || hasStaging;
      const leaveKey = `${hasStaging ? 1 : 0}:${terminal ? 1 : 0}`;
      if (leaveKey !== this.lastLeaveBtnKey) {
        this.lastLeaveBtnKey = leaveKey;
        this.leaveBtn.innerHTML = hasStaging
          ? '请先放置或舍弃暂存区物品'
          : terminal
          ? `${svgIcon('beacon', 15)} 抵达终层 · 进入返航结算`
          : `${svgIcon('rocket', 15)} 整理完毕 · 返回航路`;
      }
    }

    // Optional Abort Contract button
    if (this.actionsRowEl && this.abortBtn) {
      if (canAbort) {
        this.abortBtn.disabled = readOnly;
        if (this.abortBtn.parentNode !== this.actionsRowEl) {
          this.actionsRowEl.appendChild(this.abortBtn);
        }
      } else if (this.abortBtn.parentNode === this.actionsRowEl) {
        this.actionsRowEl.removeChild(this.abortBtn);
      }
    }
  }

  private reconcileEngineerSwap(run: V2RunState, readOnly: boolean): void {
    if (!this.engineerSlotEl || !this.engineerBannerEl || !this.engineerTitleEl || !this.engineerBtnsWrapEl) {
      return;
    }
    const offer = run.activeEngineerOffer;
    const target = offer && !offer.used ? findEngineerSwapTargetInBay(run.bay, offer.targetInstanceId) : null;
    if (!offer || offer.used || !target) {
      if (this.engineerBannerEl.parentNode === this.engineerSlotEl) {
        this.engineerSlotEl.removeChild(this.engineerBannerEl);
      }
      this.engineerSlotEl.style.display = 'none';
      return;
    }

    const preservesImproved =
      run.crewId === 'engineer' &&
      (run.crewMasteryTier ?? 0) >= 2 &&
      target.quality === 'improved';
    const qualityForButtons = preservesImproved ? 'improved' : 'common';

    if (this.engineerBannerEl.parentNode !== this.engineerSlotEl) {
      this.engineerSlotEl.appendChild(this.engineerBannerEl);
    }
    this.engineerSlotEl.style.display = 'contents';

    const titleKey = `${target.name}:${preservesImproved ? 1 : 0}`;
    if (titleKey !== this.lastEngineerTitleKey) {
      this.lastEngineerTitleKey = titleKey;
      this.engineerTitleEl.innerHTML = `${crewPortraitSvg('engineer', 20)} ${svgIcon('swap', 14)} 林工 · 工程师现场改装（每趟 1 次 · 可将「${target.name}」改为${
        preservesImproved ? '优良件' : ''
      }）`;
    }

    const activeKinds = new Set<V2EquipmentKind>(offer.candidates);
    for (const [kind, btn] of this.engineerBtns.entries()) {
      if (!activeKinds.has(kind)) {
        btn.remove();
        this.engineerBtns.delete(kind);
      }
    }

    offer.candidates.forEach((kind, idx) => {
      const def = getV2EquipmentDefByKind(kind, qualityForButtons);
      let btn = this.engineerBtns.get(kind);
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-sm btn-secondary';
        btn.dataset.engSwap = kind;
        this.engineerBtns.set(kind, btn);
      }
      btn.disabled = readOnly;
      const label = `改为 ${def.name}${preservesImproved ? '（良）' : ''} (${V2_SHAPES[def.shapeId].label})`;
      if (btn.textContent !== label) btn.textContent = label;
      const currentChild = this.engineerBtnsWrapEl!.children[idx] as HTMLElement | undefined;
      if (currentChild !== btn) {
        this.engineerBtnsWrapEl!.insertBefore(btn, currentChild ?? null);
      }
    });
  }

  private reconcileGadgetBar(
    run: V2RunState,
    readOnly: boolean,
    actions: ArrangeViewActions
  ): void {
    if (!this.gadgetSlotEl || !this.gadgetBarEl || !this.gadgetBtnsWrapEl) return;

    const arrangeGadgets = run.bay.placed
      .map((p) => ({ item: p.item, def: getV3GadgetDef(p.item.definitionId) }))
      .filter(
        (entry): entry is { item: typeof entry.item; def: NonNullable<typeof entry.def> } =>
          Boolean(entry.def && entry.def.usableIn === 'map_arrange')
      );

    if (arrangeGadgets.length === 0 || !actions.onUseGadget) {
      if (this.gadgetBarEl.parentNode === this.gadgetSlotEl) {
        this.gadgetSlotEl.removeChild(this.gadgetBarEl);
      }
      this.gadgetSlotEl.style.display = 'none';
      return;
    }

    if (this.gadgetBarEl.parentNode !== this.gadgetSlotEl) {
      this.gadgetSlotEl.appendChild(this.gadgetBarEl);
    }
    this.gadgetSlotEl.style.display = 'contents';

    const activeIds = new Set(arrangeGadgets.map((g) => g.item.instanceId));
    for (const [iid, btn] of this.gadgetBtns.entries()) {
      if (!activeIds.has(iid)) {
        btn.remove();
        this.gadgetBtns.delete(iid);
      }
    }

    arrangeGadgets.forEach(({ item, def }, idx) => {
      const chk = canUseV3GadgetInRun(run, item.instanceId);
      let btn = this.gadgetBtns.get(item.instanceId);
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-sm btn-secondary v3-gadget-use-btn';
        this.gadgetBtns.set(item.instanceId, btn);
      }
      btn.dataset.useGadget = item.instanceId;
      btn.dataset.gadgetKind = def.kind;
      btn.dataset.gadgetId = def.kind;
      btn.dataset.testid = `btn-use-gadget-${def.kind}`;
      btn.title = chk.reason ?? def.summary;
      btn.disabled = readOnly || !chk.usable;
      const label = `使用 ${def.buttonLabel}`;
      if (btn.textContent !== label) btn.textContent = label;
      const currentChild = this.gadgetBtnsWrapEl!.children[idx] as HTMLElement | undefined;
      if (currentChild !== btn) {
        this.gadgetBtnsWrapEl!.insertBefore(btn, currentChild ?? null);
      }
    });
  }

  unmount(): void {
    this.toggleShipBtn?.removeEventListener('click', this.handleToggleShip);
    this.leaveBtn?.removeEventListener('click', this.handleLeave);
    this.abortBtn?.removeEventListener('click', this.handleAbort);
    this.surveyBtn?.removeEventListener('click', this.handleSurvey);
    this.engineerSlotEl?.removeEventListener('click', this.handleEngineerClick);
    this.gadgetSlotEl?.removeEventListener('click', this.handleGadgetClick);

    this.rootEl?.remove();
    this.engineerBtns.clear();
    this.gadgetBtns.clear();

    this.hostEl = null;
    this.rootEl = null;
    this.subEl = null;
    this.goalStripEl = null;
    this.shipNameEl = null;
    this.mountPillsHostEl = null;
    this.toggleShipBtn = null;
    this.engineerSlotEl = null;
    this.engineerBannerEl = null;
    this.engineerTitleEl = null;
    this.engineerBtnsWrapEl = null;
    this.gadgetSlotEl = null;
    this.gadgetBarEl = null;
    this.gadgetBtnsWrapEl = null;
    this.surveySlotEl = null;
    this.surveyBannerEl = null;
    this.surveyDescEl = null;
    this.surveyBtn = null;
    this.inspectorSlotEl = null;
    this.actionsRowEl = null;
    this.leaveBtn = null;
    this.abortBtn = null;
    this.latestActions = null;
    this.latestTerminal = false;
    this.lastMountTagsKey = '';
    this.lastLeaveBtnKey = '';
    this.lastEngineerTitleKey = '';
  }
}

const legacyArrangeViews = new WeakMap<HTMLElement, ArrangePhaseView>();

export function renderArrangeView(
  leftPanelEl: HTMLElement,
  props: ArrangeViewProps,
  actions: ArrangeViewActions
): void {
  let view = legacyArrangeViews.get(leftPanelEl);
  if (!view || !view.isMountedIn(leftPanelEl)) {
    view?.unmount();
    leftPanelEl.innerHTML = '';
    view = new ArrangePhaseView();
    view.mount(leftPanelEl);
    legacyArrangeViews.set(leftPanelEl, view);
  }
  view.update(props, actions);
}
