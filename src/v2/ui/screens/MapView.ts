import { resolveV3BossDefForEncounter } from '../../data/bosses';
import { getV2EncounterTemplate } from '../../data/enemies';
import { V2_ARCHETYPE_LABELS } from '../../data/equipment';
import { getV3GadgetDef } from '../../data/gadgets';
import { getV3EndlessMutatorDef, getV3SectorDef } from '../../data/sectors';
import {
  computeCombatTacticalChargesMax,
  getEffectiveV2CombatBounty,
  previewV2CombatNode,
  resolveNodeBossId,
} from '../../domain/combatV2';
import {
  computeV2JumpFuelCost,
  evaluateRunBonusObjective,
  isContractReadyForDelivery,
} from '../../domain/contracts';
import { canUseV3GadgetInRun, getReachableNextNodeIds } from '../../domain/encounter';
import { getAnyV2ItemDef } from '../../domain/itemCatalog';
import type { V2MapNode, V2RunState } from '../../domain/types';
import { svgIcon } from '../icons';
import { NODE_TYPE_META, type PhaseView } from './screenTypes';

export interface MapViewProps {
  readonly run: V2RunState;
  readonly readOnly: boolean;
  readonly selectedMapNodeId: string | null;
  readonly mobileMapShowFull: boolean;
  readonly isCompactViewport: boolean;
  readonly pureAutoCombat: boolean;
  readonly bonusBossCharges?: number;
  readonly fullMapReveal?: boolean;
  readonly stargateRelayTier?: number;
}

export interface MapViewActions {
  readonly onToggleMobileMap: () => void;
  readonly onSelectNode: (nodeId: string) => void;
  readonly onJumpNode: (nodeId: string) => void;
  readonly onUseGadget?: (instanceId: string) => void;
  readonly onSafeReturn: () => void;
  readonly onAbortContract: () => void;
}

interface NodeForecastSummary {
  readonly brief: string;
  readonly cls: string;
  readonly detail: string;
  readonly traitBadge?: string;
}

function describeNodeForecast(
  run: V2RunState,
  n: V2MapNode,
  pureAutoCombat: boolean,
  bonusBossCharges: number,
  stargateRelayTier: number
): NodeForecastSummary {
  if (n.combat) {
    const pv = previewV2CombatNode(run, n.nodeId, run.targetPolicy, { stargateRelayTier });
    const chargesMax = computeCombatTacticalChargesMax(n, run, bonusBossCharges);
    const tacticPrefix = !pureAutoCombat ? `基础推演(含${chargesMax}指令)：` : '';
    const bossId = resolveNodeBossId(n, run);
    const bossDef = resolveV3BossDefForEncounter({
      encounterKind: n.combat.encounterKind,
      bossId,
      units: n.combat.units,
    });
    const tpl = getV2EncounterTemplate(n.combat.encounterKind);
    const traitBadge = bossDef
      ? `首领 · ${bossDef.name} (${bossDef.phaseCountLabel})`
      : tpl.badge;
    const unitBrief = n.combat.units
      .map(
        (u) =>
          `${u.name}(${u.maxHp}HP/${u.damagePerRound}攻${u.armor ? `/甲${u.armor}` : ''}${
            u.pierceRatio ? '/穿盾' : ''
          })`
      )
      .join(' + ');
    const effectiveBounty = getEffectiveV2CombatBounty(run, n.combat.bounty);
    const brief =
      pv?.outcome === 'victory'
        ? `${tacticPrefix}预计胜 · 余 ${pv.finalPlayerHpAfterRepair}HP (${pv.roundsCount}轮) · +${effectiveBounty}¤`
        : `${tacticPrefix}高危战败风险 (${pv?.roundsCount ?? '?'}轮) · +${effectiveBounty}¤`;
    return {
      brief,
      cls: pv?.outcome === 'victory' ? 'ok' : 'risk',
      detail: unitBrief,
      traitBadge,
    };
  }
  if (n.type === 'wreck') {
    return {
      brief: '多刀残骸拆解：首刀无伤，贪刀追高收益与精密零件',
      cls: '',
      detail: run.crewId === 'salvager' ? '苏岚已透视全明细' : '含船体/燃料/伏击风险预警',
    };
  }
  if (n.type === 'merchant') {
    return {
      brief: '补给交易：2 件设备 / +2油 / +10耐久',
      cls: '',
      detail: '可出售拾获物换取信用点',
    };
  }
  if (n.type === 'anomaly') {
    return {
      brief: n.eventState ? `星区事件：${n.eventState.title}` : '星区异常事件：多分支抉择',
      cls: '',
      detail: '含船员专属选项与安全撤离退路',
    };
  }
  return {
    brief: n.eventState ? `求救事件：${n.eventState.title}` : '星区求救信号：多分支抉择',
    cls: '',
    detail: '可换取声望、修船或零损耗撤离',
  };
}

/**
 * Stateful Star Map PhaseView (F04 / PROJECT.md § Interface Contracts #6).
 * Preserves `.v2-dag-scroll` scroll offsets, node & compare-card DOM identity, focus,
 * and enforces strictly <= 1 DOM element per `[data-testid="map-node-<id>"]`.
 */
export class MapPhaseView implements PhaseView<MapViewProps, MapViewActions> {
  private hostEl: HTMLElement | null = null;
  private rootEl: HTMLElement | null = null;
  private contractTitleEl: HTMLElement | null = null;
  private walletNumEl: HTMLElement | null = null;

  private sectorStripEl: HTMLElement | null = null;
  private sectorBadgeEl: HTMLElement | null = null;
  private sectorDescEl: HTMLElement | null = null;
  private lastSectorId: string | null = null;

  private finalMissionSlotEl: HTMLElement | null = null;
  private endlessSlotEl: HTMLElement | null = null;
  private navigatorRevealSlotEl: HTMLElement | null = null;
  private bonusTrackerSlotEl: HTMLElement | null = null;
  private relicSignalSlotEl: HTMLElement | null = null;

  private lastFinalMissionKey: string | null = null;
  private lastEndlessKey: string | null = null;
  private lastNavigatorRevealKey: string | null = null;
  private lastBonusTrackerKey: string | null = null;
  private lastRelicSignalKey: string | null = null;

  private gadgetSlotEl: HTMLElement | null = null;
  private gadgetBarEl: HTMLElement | null = null;
  private gadgetBtnsWrapEl: HTMLElement | null = null;
  private readonly gadgetBtns = new Map<string, HTMLButtonElement>();

  private mobileToggleSlotEl: HTMLElement | null = null;
  private mobileToggleBarEl: HTMLElement | null = null;
  private mobileToggleLabelEl: HTMLElement | null = null;
  private mobileToggleBtn: HTMLButtonElement | null = null;

  private graphSlotEl: HTMLElement | null = null;
  private desktopDagBoxEl: HTMLElement | null = null;
  private dagScrollEl: HTMLElement | null = null;
  private svgHostEl: HTMLElement | null = null;
  private dagGridEl: HTMLElement | null = null;
  private mobileFocusEl: HTMLElement | null = null;

  private renderedGraphMode: 'desktop' | 'mobile' | null = null;
  private renderedDesktopStructureKey: string | null = null;
  private renderedMobileStructureKey: string | null = null;
  private lastEdgesKey: string | null = null;

  private readonly nodeButtons = new Map<string, HTMLButtonElement>();
  private readonly nodeButtonInnerKeys = new Map<string, string>();

  private selectedDeckEl: HTMLElement | null = null;
  private emptyHintEl: HTMLElement | null = null;
  private compareGridEl: HTMLElement | null = null;
  private jumpBtnEl: HTMLButtonElement | null = null;
  private lastJumpBtnKey: string | null = null;
  private readonly compareCards = new Map<string, HTMLButtonElement>();
  private readonly compareCardContentKeys = new Map<string, string>();

  private footerEl: HTMLElement | null = null;
  private safeReturnBtn: HTMLButtonElement | null = null;
  private abortBtn: HTMLButtonElement | null = null;

  private latestActions: MapViewActions | null = null;
  private latestEffectiveSelectedId: string | null = null;
  private readonly latestReachableSet = new Set<string>();

  private readonly handleRootClick = (ev: MouseEvent): void => {
    if (!this.rootEl || !this.latestActions) return;
    const target = ev.target as HTMLElement | null;
    if (!target) return;

    const selectBtn = target.closest<HTMLButtonElement>('[data-select-node]');
    if (selectBtn) {
      if (selectBtn.disabled) return;
      const nid = selectBtn.dataset.selectNode;
      if (nid && this.latestReachableSet.has(nid)) {
        this.latestActions.onSelectNode(nid);
      }
      return;
    }

    const gadgetBtn = target.closest<HTMLButtonElement>('[data-use-gadget]');
    if (gadgetBtn) {
      if (gadgetBtn.disabled) return;
      const iid = gadgetBtn.dataset.useGadget;
      if (iid) {
        this.latestActions.onUseGadget?.(iid);
      }
    }
  };

  private readonly handleMobileToggle = (): void => {
    if (!this.rootEl || !this.latestActions) return;
    this.latestActions.onToggleMobileMap();
  };

  private readonly handleJump = (): void => {
    if (!this.rootEl || !this.jumpBtnEl || this.jumpBtnEl.disabled || !this.latestActions) return;
    const nid = this.latestEffectiveSelectedId;
    if (nid && this.latestReachableSet.has(nid)) {
      this.latestActions.onJumpNode(nid);
    }
  };

  private readonly handleSafeReturn = (): void => {
    if (!this.rootEl || !this.safeReturnBtn || this.safeReturnBtn.disabled || !this.latestActions) {
      return;
    }
    this.latestActions.onSafeReturn();
  };

  private readonly handleAbort = (): void => {
    if (!this.rootEl || !this.abortBtn || this.abortBtn.disabled || !this.latestActions) return;
    this.latestActions.onAbortContract();
  };

  isMountedIn(host: HTMLElement): boolean {
    return this.hostEl === host && this.rootEl !== null && host.contains(this.rootEl);
  }

  getDagScrollContainer(): HTMLElement | null {
    return this.dagScrollEl;
  }

  mount(host: HTMLElement): void {
    if (this.isMountedIn(host)) return;
    if (this.rootEl || this.hostEl) {
      this.unmount();
    }

    const rootEl = document.createElement('div');
    rootEl.className = 'v3-screen-root';
    rootEl.dataset.testid = 'map-screen';

    // Header
    const header = document.createElement('div');
    header.className = 'panel-header';
    const h2 = document.createElement('h2');
    const radarWrap = document.createElement('span');
    radarWrap.style.display = 'contents';
    radarWrap.innerHTML = `${svgIcon('radar', 16)} `;
    const contractTitleEl = document.createElement('span');
    contractTitleEl.style.display = 'contents';
    h2.appendChild(radarWrap);
    h2.appendChild(contractTitleEl);

    const sub = document.createElement('span');
    sub.className = 'panel-sub';
    const walletLabel = document.createElement('span');
    walletLabel.style.display = 'contents';
    walletLabel.textContent = '航行钱包 ';
    const walletNumEl = document.createElement('strong');
    walletNumEl.className = 'num';
    sub.appendChild(walletLabel);
    sub.appendChild(walletNumEl);

    header.appendChild(h2);
    header.appendChild(sub);
    rootEl.appendChild(header);

    // Sector modifier strip
    const sectorStripEl = document.createElement('div');
    sectorStripEl.className = 'v3-run-sector-strip';
    sectorStripEl.dataset.testid = 'sector-modifier-badge';
    const sectorBadgeEl = document.createElement('span');
    sectorBadgeEl.className = 'v3-sector-mod-badge';
    const sectorDescEl = document.createElement('span');
    sectorDescEl.className = 'v3-sector-mod-desc';
    sectorStripEl.appendChild(sectorBadgeEl);
    sectorStripEl.appendChild(sectorDescEl);
    rootEl.appendChild(sectorStripEl);

    // 5 optional banner slots (display: none when empty so zero flex gaps!)
    const makeOptionalSlot = (name: string): HTMLElement => {
      const slot = document.createElement('div');
      slot.dataset.slot = name;
      slot.style.display = 'none';
      rootEl.appendChild(slot);
      return slot;
    };
    const finalMissionSlotEl = makeOptionalSlot('final-mission');
    const endlessSlotEl = makeOptionalSlot('endless');
    const navigatorRevealSlotEl = makeOptionalSlot('navigator-reveal');
    const bonusTrackerSlotEl = makeOptionalSlot('bonus-tracker');
    const relicSignalSlotEl = makeOptionalSlot('relic-signal');

    // Optional Map Gadgets slot
    const gadgetSlotEl = document.createElement('div');
    gadgetSlotEl.dataset.slot = 'map-gadgets';
    gadgetSlotEl.style.display = 'none';
    const gadgetBarEl = document.createElement('div');
    gadgetBarEl.className = 'v3-gadget-bar';
    gadgetBarEl.dataset.testid = 'map-gadget-bar';
    const gadgetLabelEl = document.createElement('span');
    gadgetLabelEl.className = 'v3-gadget-bar-label';
    gadgetLabelEl.innerHTML = `${svgIcon('bolt', 12)} 战术消耗装置`;
    const gadgetBtnsWrapEl = document.createElement('div');
    gadgetBtnsWrapEl.className = 'v3-gadget-bar-btns';
    gadgetBarEl.appendChild(gadgetLabelEl);
    gadgetBarEl.appendChild(gadgetBtnsWrapEl);
    rootEl.appendChild(gadgetSlotEl);

    // Optional Mobile Toggle slot
    const mobileToggleSlotEl = document.createElement('div');
    mobileToggleSlotEl.dataset.slot = 'mobile-toggle';
    mobileToggleSlotEl.style.display = 'none';
    const mobileToggleBarEl = document.createElement('div');
    mobileToggleBarEl.className = 'v2-map-mobile-toggle';
    const mobileToggleLabelEl = document.createElement('span');
    mobileToggleLabelEl.className = 'v2-prep-label';
    const mobileToggleBtn = document.createElement('button');
    mobileToggleBtn.type = 'button';
    mobileToggleBtn.className = 'btn btn-sm btn-ghost';
    mobileToggleBtn.id = 'v2-toggle-mobile-map';
    mobileToggleBarEl.appendChild(mobileToggleLabelEl);
    mobileToggleBarEl.appendChild(mobileToggleBtn);
    rootEl.appendChild(mobileToggleSlotEl);

    // Graph slot (holds EITHER desktop DAG OR mobile focus — NEVER both!)
    const graphSlotEl = document.createElement('div');
    graphSlotEl.dataset.slot = 'map-graph';
    graphSlotEl.style.display = 'contents';
    rootEl.appendChild(graphSlotEl);

    const desktopDagBoxEl = document.createElement('div');
    desktopDagBoxEl.className = 'v2-dag-box v2-dag-hero';
    const dagScrollEl = document.createElement('div');
    dagScrollEl.className = 'v2-dag-scroll';
    const dagStageEl = document.createElement('div');
    dagStageEl.className = 'v2-dag-stage';
    const svgHostEl = document.createElement('div');
    svgHostEl.style.display = 'contents';
    const dagGridEl = document.createElement('div');
    dagGridEl.className = 'v2-dag-grid';
    dagStageEl.appendChild(svgHostEl);
    dagStageEl.appendChild(dagGridEl);
    dagScrollEl.appendChild(dagStageEl);
    desktopDagBoxEl.appendChild(dagScrollEl);

    const mobileFocusEl = document.createElement('div');
    mobileFocusEl.className = 'v2-map-mobile-focus';

    // Selected node deck
    const selectedDeckEl = document.createElement('div');
    selectedDeckEl.className = 'v2-selected-node-deck';
    const emptyHintEl = document.createElement('div');
    emptyHintEl.className = 'v2-empty-hint';
    emptyHintEl.textContent = '已抵达最深层，点击下方免费安全返航完成结算！';
    const compareGridEl = document.createElement('div');
    compareGridEl.className = 'v2-map-compare-grid';
    const jumpBtnEl = document.createElement('button');
    jumpBtnEl.type = 'button';
    jumpBtnEl.className = 'btn btn-primary btn-launch-hero';
    jumpBtnEl.dataset.testid = 'btn-jump-node';
    rootEl.appendChild(selectedDeckEl);

    // Footer actions
    const footerEl = document.createElement('div');
    footerEl.className = 'v2-map-footer-actions';
    const safeReturnBtn = document.createElement('button');
    safeReturnBtn.type = 'button';
    safeReturnBtn.className = 'btn btn-secondary';
    safeReturnBtn.id = 'v2-btn-safe-return';
    safeReturnBtn.dataset.testid = 'btn-safe-return';
    safeReturnBtn.innerHTML = `${svgIcon('beacon', 14)} 免费安全返航`;

    const abortBtn = document.createElement('button');
    abortBtn.type = 'button';
    abortBtn.className = 'btn btn-ghost';
    abortBtn.id = 'v2-btn-abort-contract';
    abortBtn.textContent = '放弃当前委托';

    footerEl.appendChild(safeReturnBtn);
    rootEl.appendChild(footerEl);

    // Attach listeners ONCE
    rootEl.addEventListener('click', this.handleRootClick);
    mobileToggleBtn.addEventListener('click', this.handleMobileToggle);
    jumpBtnEl.addEventListener('click', this.handleJump);
    safeReturnBtn.addEventListener('click', this.handleSafeReturn);
    abortBtn.addEventListener('click', this.handleAbort);

    host.appendChild(rootEl);

    this.hostEl = host;
    this.rootEl = rootEl;
    this.contractTitleEl = contractTitleEl;
    this.walletNumEl = walletNumEl;
    this.sectorStripEl = sectorStripEl;
    this.sectorBadgeEl = sectorBadgeEl;
    this.sectorDescEl = sectorDescEl;
    this.finalMissionSlotEl = finalMissionSlotEl;
    this.endlessSlotEl = endlessSlotEl;
    this.navigatorRevealSlotEl = navigatorRevealSlotEl;
    this.bonusTrackerSlotEl = bonusTrackerSlotEl;
    this.relicSignalSlotEl = relicSignalSlotEl;
    this.gadgetSlotEl = gadgetSlotEl;
    this.gadgetBarEl = gadgetBarEl;
    this.gadgetBtnsWrapEl = gadgetBtnsWrapEl;
    this.mobileToggleSlotEl = mobileToggleSlotEl;
    this.mobileToggleBarEl = mobileToggleBarEl;
    this.mobileToggleLabelEl = mobileToggleLabelEl;
    this.mobileToggleBtn = mobileToggleBtn;
    this.graphSlotEl = graphSlotEl;
    this.desktopDagBoxEl = desktopDagBoxEl;
    this.dagScrollEl = dagScrollEl;
    this.svgHostEl = svgHostEl;
    this.dagGridEl = dagGridEl;
    this.mobileFocusEl = mobileFocusEl;
    this.selectedDeckEl = selectedDeckEl;
    this.emptyHintEl = emptyHintEl;
    this.compareGridEl = compareGridEl;
    this.jumpBtnEl = jumpBtnEl;
    this.footerEl = footerEl;
    this.safeReturnBtn = safeReturnBtn;
    this.abortBtn = abortBtn;
    this.lastSectorId = null;
    this.lastFinalMissionKey = null;
    this.lastEndlessKey = null;
    this.lastNavigatorRevealKey = null;
    this.lastBonusTrackerKey = null;
    this.lastRelicSignalKey = null;
    this.renderedGraphMode = null;
    this.renderedDesktopStructureKey = null;
    this.renderedMobileStructureKey = null;
    this.lastEdgesKey = null;
    this.lastJumpBtnKey = null;
    this.latestEffectiveSelectedId = null;
  }

  private syncHtmlSlot(
    slotEl: HTMLElement | null,
    nextKey: string | null,
    prevKey: string | null,
    buildHtml: () => string
  ): string | null {
    if (!slotEl) return prevKey;
    if (nextKey === null) {
      if (prevKey !== null || slotEl.style.display !== 'none' || slotEl.innerHTML !== '') {
        slotEl.innerHTML = '';
        slotEl.style.display = 'none';
      }
      return null;
    }
    if (nextKey !== prevKey) {
      slotEl.innerHTML = buildHtml();
      slotEl.style.display = 'contents';
    }
    return nextKey;
  }

  private getOrUpdateNodeButton(
    run: V2RunState,
    n: V2MapNode,
    compact: boolean,
    reachableSet: ReadonlySet<string>,
    effectiveSelectedId: string | null,
    fullMapReveal: boolean
  ): HTMLButtonElement {
    let btn = this.nodeButtons.get(n.nodeId);
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.selectNode = n.nodeId;
      btn.dataset.testid = `map-node-${n.nodeId}`;
      this.nodeButtons.set(n.nodeId, btn);
    }

    const meta = NODE_TYPE_META[n.type];
    const visited = run.visitedNodeIds.includes(n.nodeId);
    const isCur = run.currentNodeId === n.nodeId;
    const isNext = reachableSet.has(n.nodeId);
    const isSelected = effectiveSelectedId === n.nodeId;

    const nextClass = `v2-dag-node ${meta.cls}${visited ? ' visited' : ''}${
      isCur ? ' current' : ''
    }${isNext ? ' reachable' : ''}${isSelected ? ' selected' : ''}`;
    if (btn.className !== nextClass) {
      btn.className = nextClass;
    }
    const nextReachableAttr = isNext ? 'true' : 'false';
    if (btn.dataset.reachable !== nextReachableAttr) {
      btn.dataset.reachable = nextReachableAttr;
    }
    if (btn.disabled !== !isNext) {
      btn.disabled = !isNext;
    }

    const intelTitle = fullMapReveal
      ? n.combat
        ? `第${n.layer}层 ${meta.label} · ${getV2EncounterTemplate(n.combat.encounterKind).name}`
        : n.eventState
        ? `第${n.layer}层 ${meta.label} · ${n.eventState.title}`
        : `第${n.layer}层 ${meta.label}`
      : `第${n.layer}层 ${meta.label}`;
    if (btn.title !== intelTitle) {
      btn.title = intelTitle;
    }

    const innerKey = `${n.type}:${compact ? 1 : 0}:${n.contractMarker ? 1 : 0}:${
      n.hasSupportGuarantee ? 1 : 0
    }:${n.hasRelicSignal ? 1 : 0}`;
    if (this.nodeButtonInnerKeys.get(n.nodeId) !== innerKey) {
      this.nodeButtonInnerKeys.set(n.nodeId, innerKey);
      btn.innerHTML = `
        <span class="v2-dag-icon">${svgIcon(meta.icon, compact ? 15 : 16)}</span>
        <span class="v2-dag-name">${meta.label}</span>
        ${n.contractMarker ? `<span class="v2-dag-star" aria-label="委托目标">${svgIcon('star', 11)}</span>` : ''}
        ${n.hasSupportGuarantee ? `<span class="v2-dag-sup">配</span>` : ''}
        ${n.hasRelicSignal ? `<span class="v3-dag-relic" title="保底遗物信号">遗</span>` : ''}
      `;
    }

    return btn;
  }

  update(props: MapViewProps, actions: MapViewActions): void {
    if (!this.rootEl) return;
    const {
      run,
      readOnly,
      selectedMapNodeId,
      mobileMapShowFull,
      isCompactViewport,
      pureAutoCombat,
      bonusBossCharges = 0,
      fullMapReveal = false,
      stargateRelayTier = 0,
    } = props;

    this.latestActions = actions;

    const reachableIds = getReachableNextNodeIds(run);
    this.latestReachableSet.clear();
    for (const rid of reachableIds) this.latestReachableSet.add(rid);

    const fuelInfo = computeV2JumpFuelCost(run);
    const canJump = run.fuel >= fuelInfo.totalCost;

    const effectiveSelectedId =
      selectedMapNodeId && this.latestReachableSet.has(selectedMapNodeId)
        ? selectedMapNodeId
        : reachableIds[0] ?? null;
    this.latestEffectiveSelectedId = effectiveSelectedId;

    // Header
    if (this.contractTitleEl) {
      const titleText = `星际航路 · ${run.contract.name}`;
      if (this.contractTitleEl.textContent !== titleText) {
        this.contractTitleEl.textContent = titleText;
      }
    }
    if (this.walletNumEl) {
      const walletText = `${run.wallet}¤`;
      if (this.walletNumEl.textContent !== walletText) {
        this.walletNumEl.textContent = walletText;
      }
    }

    // Sector modifier strip
    if (this.sectorStripEl && this.sectorBadgeEl && this.sectorDescEl) {
      if (this.lastSectorId !== run.sectorId) {
        this.lastSectorId = run.sectorId;
        const sector = getV3SectorDef(run.sectorId);
        const envIcon =
          sector.envModifier.id === 'cryo_ion'
            ? 'cryo'
            : sector.envModifier.id === 'gravity_tide'
            ? 'gravity'
            : 'radar';
        this.sectorStripEl.className = `v3-run-sector-strip env-${sector.envModifier.id}`;
        this.sectorBadgeEl.innerHTML = `${svgIcon(envIcon, 13)} ${sector.name} · ${sector.envModifier.name}`;
        this.sectorDescEl.textContent = sector.envModifier.combatRuleSummary;
      }
    }

    // Optional banners
    this.lastFinalMissionKey = this.syncHtmlSlot(
      this.finalMissionSlotEl,
      run.isFinalCampaignRun ? '1' : null,
      this.lastFinalMissionKey,
      () => `<div class="v3-final-mission-banner" data-testid="final-mission-banner">
        <strong>${svgIcon('star', 13)} 星门重启远征 · 第三幕终局任务</strong>
        <span>终局目标：第 6 层击溃三阶段「黑曜利维坦」</span>
      </div>`
    );

    const endlessThreat = run.endlessThreat ?? 0;
    const endlessKey =
      endlessThreat >= 1
        ? `${endlessThreat}:${run.seed}:${(run.endlessMutatorIds ?? []).join(',')}`
        : null;
    this.lastEndlessKey = this.syncHtmlSlot(
      this.endlessSlotEl,
      endlessKey,
      this.lastEndlessKey,
      () => `<div class="v3-endless-hud-banner" data-testid="endless-hud-banner">
        <div class="v3-endless-hud-head">
          <span>${svgIcon('bolt', 13)} 无尽深渊 · 威压 ${endlessThreat}</span>
          <span class="num">挑战种子 #${run.seed}</span>
        </div>
        ${
          run.endlessMutatorIds && run.endlessMutatorIds.length > 0
            ? `<div class="v3-endless-mut-chips">
                ${run.endlessMutatorIds
                  .map((mid) => {
                    const def = getV3EndlessMutatorDef(mid);
                    return `<span class="v3-endless-mut-chip">词条 · ${def?.name ?? mid}（${
                      def?.shortBadge ?? mid
                    }）</span>`;
                  })
                  .join('')}
              </div>`
            : `<div class="v3-endless-mut-chips"><span class="v3-endless-mut-chip">深渊威压词条激活中</span></div>`
        }
      </div>`
    );

    this.lastNavigatorRevealKey = this.syncHtmlSlot(
      this.navigatorRevealSlotEl,
      fullMapReveal ? String(run.graph.maxLayers) : null,
      this.lastNavigatorRevealKey,
      () => `<div class="v3-relic-passive-banner" data-testid="relic-passive-navigator">
        ${svgIcon('museum', 13)} <strong>古代星盘常驻被动已生效</strong>：全图 ${run.graph.maxLayers} 层航路情报透视 · 出航燃料 +1
      </div>`
    );

    const activeBonus = run.bonusObjective ?? run.contract.bonusObjective ?? null;
    const bonusKey =
      activeBonus && !run.isTutorial
        ? (() => {
            const currentlyMet = evaluateRunBonusObjective(run, 'safe_return');
            const failedDiscard =
              activeBonus.id === 'bonus_no_discard' && (run.discardedCountThisRun ?? 0) > 0;
            return `${activeBonus.id}:${activeBonus.label}:${activeBonus.rewardCredits}:${
              failedDiscard ? 'f' : currentlyMet ? 'm' : 'p'
            }`;
          })()
        : null;
    this.lastBonusTrackerKey = this.syncHtmlSlot(
      this.bonusTrackerSlotEl,
      bonusKey,
      this.lastBonusTrackerKey,
      () => {
        const currentlyMet = evaluateRunBonusObjective(run, 'safe_return');
        const failedDiscard =
          activeBonus!.id === 'bonus_no_discard' && (run.discardedCountThisRun ?? 0) > 0;
        const statusCls = failedDiscard ? 'is-failed' : currentlyMet ? 'is-met' : 'is-pending';
        const statusText = failedDiscard ? '已失格' : currentlyMet ? '当前满足' : '进行中';
        return `<div class="v3-bonus-tracker-strip ${statusCls}" data-testid="bonus-objective-tracker">
          <span>${svgIcon('target', 12)} 额外目标：<strong>${activeBonus!.label}</strong>（+${activeBonus!.rewardCredits}¤）</span>
          <span class="v3-bonus-status-chip">${statusText}</span>
        </div>`;
      }
    );

    const allNodes = Object.values(run.graph.nodes);
    const relicSignalNodes = allNodes.filter((n) => Boolean(n.hasRelicSignal));
    const relicSignalTarget = relicSignalNodes[0] ?? null;
    const relicSignalKey = relicSignalTarget
      ? `${relicSignalTarget.nodeId}:${relicSignalTarget.layer}:${relicSignalTarget.lane}:${
          relicSignalTarget.relicSignalDefId ?? ''
        }`
      : null;
    this.lastRelicSignalKey = this.syncHtmlSlot(
      this.relicSignalSlotEl,
      relicSignalKey,
      this.lastRelicSignalKey,
      () => {
        const target = relicSignalTarget!;
        const relicName = target.relicSignalDefId
          ? getAnyV2ItemDef(target.relicSignalDefId)?.name ?? '古代遗物'
          : '古代遗物';
        return `<div class="v3-relic-pity-banner" data-testid="relic-pity-banner">
          ${svgIcon('museum', 14)}
          <span>保底遗物信号已锁定：第 ${target.layer} 层 ${target.lane === 0 ? 'A线' : 'B线'} 探测到「${relicName}」高能信号</span>
        </div>`;
      }
    );

    // Map Gadgets bar
    this.reconcileGadgetBar(run, readOnly, actions);

    // Mobile toggle bar
    const layers = Array.from({ length: run.graph.maxLayers }, (_, i) => i + 1);
    const currentLayerNum = run.currentNodeId ? run.graph.nodes[run.currentNodeId]?.layer ?? 0 : 0;
    const focusLayers = [currentLayerNum + 1, currentLayerNum + 2].filter(
      (ly) => ly >= 1 && ly <= run.graph.maxLayers
    );
    const showMobileToggle = isCompactViewport && focusLayers.length > 0;
    if (
      this.mobileToggleSlotEl &&
      this.mobileToggleBarEl &&
      this.mobileToggleLabelEl &&
      this.mobileToggleBtn
    ) {
      if (showMobileToggle) {
        if (this.mobileToggleBarEl.parentNode !== this.mobileToggleSlotEl) {
          this.mobileToggleSlotEl.appendChild(this.mobileToggleBarEl);
        }
        this.mobileToggleSlotEl.style.display = 'contents';
        const lblText = mobileMapShowFull ? `完整 ${run.graph.maxLayers} 层航图` : '接下来 2 层预览';
        if (this.mobileToggleLabelEl.textContent !== lblText) {
          this.mobileToggleLabelEl.textContent = lblText;
        }
        const btnText = mobileMapShowFull ? '切回近 2 层' : `展开完整 ${run.graph.maxLayers} 层`;
        if (this.mobileToggleBtn.textContent !== btnText) {
          this.mobileToggleBtn.textContent = btnText;
        }
      } else {
        if (this.mobileToggleBarEl.parentNode === this.mobileToggleSlotEl) {
          this.mobileToggleSlotEl.removeChild(this.mobileToggleBarEl);
        }
        this.mobileToggleSlotEl.style.display = 'none';
      }
    }

    // Prune stale nodeButtons from previous runs/graphs
    for (const [nid, btn] of this.nodeButtons.entries()) {
      if (!run.graph.nodes[nid]) {
        btn.remove();
        this.nodeButtons.delete(nid);
        this.nodeButtonInnerKeys.delete(nid);
      }
    }

    // Reconcile Graph (strictly 1 DOM element per [data-testid="map-node-<id>"]!)
    const useMobileFocus = isCompactViewport && !mobileMapShowFull && focusLayers.length > 0;
    this.reconcileGraph(
      run,
      allNodes,
      layers,
      currentLayerNum,
      focusLayers,
      useMobileFocus,
      reachableIds,
      effectiveSelectedId,
      fullMapReveal
    );

    // Reconcile Selected Node Deck (compare cards + jump button)
    this.reconcileSelectedDeck(
      run,
      reachableIds,
      effectiveSelectedId,
      fuelInfo,
      canJump,
      readOnly,
      pureAutoCombat,
      bonusBossCharges,
      stargateRelayTier
    );

    // Footer actions
    const canAbort =
      run.contract.status === 'active' &&
      run.contract.type !== 'free' &&
      !run.isTutorial &&
      !isContractReadyForDelivery(run, 'safe_return');

    if (this.safeReturnBtn) {
      this.safeReturnBtn.disabled = readOnly;
    }
    if (this.footerEl && this.abortBtn) {
      if (canAbort) {
        this.abortBtn.disabled = readOnly;
        if (this.abortBtn.parentNode !== this.footerEl) {
          this.footerEl.appendChild(this.abortBtn);
        }
      } else if (this.abortBtn.parentNode === this.footerEl) {
        this.footerEl.removeChild(this.abortBtn);
      }
    }
  }

  private reconcileGadgetBar(run: V2RunState, readOnly: boolean, actions: MapViewActions): void {
    if (!this.gadgetSlotEl || !this.gadgetBarEl || !this.gadgetBtnsWrapEl) return;

    const mapGadgets = run.bay.placed
      .map((p) => ({ item: p.item, def: getV3GadgetDef(p.item.definitionId) }))
      .filter(
        (entry): entry is { item: typeof entry.item; def: NonNullable<typeof entry.def> } =>
          Boolean(entry.def && entry.def.usableIn === 'map_arrange')
      );

    if (mapGadgets.length === 0 || !actions.onUseGadget) {
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

    const activeIds = new Set(mapGadgets.map((g) => g.item.instanceId));
    for (const [iid, btn] of this.gadgetBtns.entries()) {
      if (!activeIds.has(iid)) {
        btn.remove();
        this.gadgetBtns.delete(iid);
      }
    }

    mapGadgets.forEach(({ item, def }, idx) => {
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

  private reconcileGraph(
    run: V2RunState,
    allNodes: readonly V2MapNode[],
    layers: readonly number[],
    currentLayerNum: number,
    focusLayers: readonly number[],
    useMobileFocus: boolean,
    reachableIds: readonly string[],
    effectiveSelectedId: string | null,
    fullMapReveal: boolean
  ): void {
    if (!this.graphSlotEl || !this.desktopDagBoxEl || !this.svgHostEl || !this.dagGridEl || !this.mobileFocusEl) {
      return;
    }

    const nodeBySlot = new Map<string, V2MapNode>();
    for (const n of allNodes) {
      nodeBySlot.set(`${n.layer}:${n.lane}`, n);
    }

    if (useMobileFocus) {
      // Strictly detach desktop container FIRST so zero duplicate testids can exist
      if (this.desktopDagBoxEl.parentNode === this.graphSlotEl) {
        this.graphSlotEl.removeChild(this.desktopDagBoxEl);
      }
      if (this.mobileFocusEl.parentNode !== this.graphSlotEl) {
        this.graphSlotEl.appendChild(this.mobileFocusEl);
      }

      const mobileStructKey = `${run.runId}|${currentLayerNum}|${focusLayers
        .map((ly) => {
          const a = nodeBySlot.get(`${ly}:0`);
          const b = nodeBySlot.get(`${ly}:1`);
          return `${ly}:${a?.nodeId ?? ''}:${b?.nodeId ?? ''}`;
        })
        .join(';')}`;

      if (this.renderedGraphMode !== 'mobile' || this.renderedMobileStructureKey !== mobileStructKey) {
        this.mobileFocusEl.innerHTML = '';
        for (const ly of focusLayers) {
          const layerEl = document.createElement('div');
          layerEl.className = 'v2-mmf-layer';
          const headEl = document.createElement('div');
          headEl.className = 'v2-mmf-layer-head';
          headEl.textContent = `第 ${ly} 层${ly === currentLayerNum + 1 ? '（下一步可达）' : '（后续预告）'}`;
          const nodesWrap = document.createElement('div');
          nodesWrap.className = 'v2-mmf-nodes';

          const laneA = nodeBySlot.get(`${ly}:0`);
          const laneB = nodeBySlot.get(`${ly}:1`);
          for (const laneNode of [laneA, laneB]) {
            if (laneNode) {
              nodesWrap.appendChild(
                this.getOrUpdateNodeButton(
                  run,
                  laneNode,
                  true,
                  this.latestReachableSet,
                  effectiveSelectedId,
                  fullMapReveal
                )
              );
            } else {
              const spacer = document.createElement('div');
              spacer.className = 'v2-dag-spacer';
              nodesWrap.appendChild(spacer);
            }
          }

          layerEl.appendChild(headEl);
          layerEl.appendChild(nodesWrap);
          this.mobileFocusEl.appendChild(layerEl);
        }
        this.renderedMobileStructureKey = mobileStructKey;
      } else {
        for (const ly of focusLayers) {
          const laneA = nodeBySlot.get(`${ly}:0`);
          const laneB = nodeBySlot.get(`${ly}:1`);
          if (laneA) {
            this.getOrUpdateNodeButton(
              run,
              laneA,
              true,
              this.latestReachableSet,
              effectiveSelectedId,
              fullMapReveal
            );
          }
          if (laneB) {
            this.getOrUpdateNodeButton(
              run,
              laneB,
              true,
              this.latestReachableSet,
              effectiveSelectedId,
              fullMapReveal
            );
          }
        }
      }

      this.renderedGraphMode = 'mobile';
      return;
    }

    // Desktop DAG mode: detach mobile focus FIRST so zero duplicate testids can exist
    if (this.mobileFocusEl.parentNode === this.graphSlotEl) {
      this.graphSlotEl.removeChild(this.mobileFocusEl);
    }
    if (this.desktopDagBoxEl.parentNode !== this.graphSlotEl) {
      this.graphSlotEl.appendChild(this.desktopDagBoxEl);
    }

    // Update SVG edges ONLY when topology/visited/current/reachable changes (NEVER on selection click!)
    const colUnit = 86;
    const gapUnit = 20;
    const step = colUnit + gapUnit;
    const svgW = layers.length * colUnit + Math.max(0, layers.length - 1) * gapUnit;
    const svgH = 120;
    const edgesKey = `${run.runId}|${svgW}x${svgH}|c=${run.currentNodeId ?? ''}|v=${run.visitedNodeIds.join(
      ','
    )}|r=${reachableIds.join(',')}`;

    if (edgesKey !== this.lastEdgesKey) {
      this.lastEdgesKey = edgesKey;
      const edgePaths: string[] = [];
      for (const node of allNodes) {
        const isFromCurrent = run.currentNodeId === node.nodeId;
        const x1 = (node.layer - 1) * step + colUnit;
        const y1 = node.lane === 0 ? 30 : 90;
        for (const nxtId of node.nextNodeIds) {
          const target = run.graph.nodes[nxtId];
          if (!target) continue;
          const x2 = (target.layer - 1) * step - 1;
          const y2 = target.lane === 0 ? 30 : 90;
          const midX = (x1 + x2) / 2;

          const activeEdge = isFromCurrent && this.latestReachableSet.has(nxtId);
          const visitedEdge =
            run.visitedNodeIds.includes(node.nodeId) && run.visitedNodeIds.includes(nxtId);
          const stroke = activeEdge
            ? '#F6B852'
            : visitedEdge
            ? '#62D6DF'
            : 'rgba(173, 198, 228, 0.62)';
          const sw = activeEdge ? '2.6' : visitedEdge ? '2.2' : '1.6';
          const markerId = activeEdge
            ? 'v3-dag-arrow-active'
            : visitedEdge
            ? 'v3-dag-arrow-visited'
            : 'v3-dag-arrow-future';
          const edgeCls = activeEdge
            ? 'v3-dag-edge is-active'
            : visitedEdge
            ? 'v3-dag-edge is-visited'
            : 'v3-dag-edge is-future';
          const dashAttr = activeEdge || visitedEdge ? '' : 'stroke-dasharray="4 3"';

          edgePaths.push(
            `<path class="${edgeCls}" d="M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}" fill="none" stroke="${stroke}" stroke-width="${sw}" ${dashAttr} vector-effect="non-scaling-stroke" marker-end="url(#${markerId})" />`
          );
        }
      }

      this.svgHostEl.innerHTML = `<svg class="v2-dag-edges-svg" viewBox="0 0 ${svgW} ${svgH}" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <marker id="v3-dag-arrow-active" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M 0 1 L 7 4 L 0 7 z" fill="#F6B852" />
          </marker>
          <marker id="v3-dag-arrow-visited" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M 0 1 L 7 4 L 0 7 z" fill="#62D6DF" />
          </marker>
          <marker id="v3-dag-arrow-future" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M 0 1 L 6 3.5 L 0 6 z" fill="#9FB6D1" />
          </marker>
        </defs>
        ${edgePaths.join('')}
      </svg>`;
    }

    const desktopStructKey = `${run.runId}|${layers
      .map((ly) => {
        const a = nodeBySlot.get(`${ly}:0`);
        const b = nodeBySlot.get(`${ly}:1`);
        return `${ly}:${a?.nodeId ?? ''}:${b?.nodeId ?? ''}`;
      })
      .join(';')}`;

    if (this.renderedGraphMode !== 'desktop' || this.renderedDesktopStructureKey !== desktopStructKey) {
      this.dagGridEl.innerHTML = '';
      for (const layer of layers) {
        const colEl = document.createElement('div');
        colEl.className = 'v2-dag-col';
        const lblEl = document.createElement('div');
        lblEl.className = 'v2-dag-layer-lbl';
        lblEl.textContent = `L${layer}`;
        const pairEl = document.createElement('div');
        pairEl.className = 'v2-dag-pair';

        const laneA = nodeBySlot.get(`${layer}:0`);
        const laneB = nodeBySlot.get(`${layer}:1`);
        for (const laneNode of [laneA, laneB]) {
          if (laneNode) {
            pairEl.appendChild(
              this.getOrUpdateNodeButton(
                run,
                laneNode,
                false,
                this.latestReachableSet,
                effectiveSelectedId,
                fullMapReveal
              )
            );
          } else {
            const spacer = document.createElement('div');
            spacer.className = 'v2-dag-spacer';
            pairEl.appendChild(spacer);
          }
        }

        colEl.appendChild(lblEl);
        colEl.appendChild(pairEl);
        this.dagGridEl.appendChild(colEl);
      }
      this.renderedDesktopStructureKey = desktopStructKey;
    } else {
      for (const n of allNodes) {
        this.getOrUpdateNodeButton(
          run,
          n,
          false,
          this.latestReachableSet,
          effectiveSelectedId,
          fullMapReveal
        );
      }
    }

    this.renderedGraphMode = 'desktop';
  }

  private reconcileSelectedDeck(
    run: V2RunState,
    reachableIds: readonly string[],
    effectiveSelectedId: string | null,
    fuelInfo: ReturnType<typeof computeV2JumpFuelCost>,
    canJump: boolean,
    readOnly: boolean,
    pureAutoCombat: boolean,
    bonusBossCharges: number,
    stargateRelayTier: number
  ): void {
    if (!this.selectedDeckEl || !this.emptyHintEl || !this.compareGridEl || !this.jumpBtnEl) return;

    const selNode = effectiveSelectedId ? run.graph.nodes[effectiveSelectedId] ?? null : null;
    if (!selNode) {
      if (this.compareGridEl.parentNode === this.selectedDeckEl) {
        this.selectedDeckEl.removeChild(this.compareGridEl);
      }
      if (this.jumpBtnEl.parentNode === this.selectedDeckEl) {
        this.selectedDeckEl.removeChild(this.jumpBtnEl);
      }
      this.jumpBtnEl.disabled = true;
      this.jumpBtnEl.removeAttribute('data-jump-node');
      if (this.emptyHintEl.parentNode !== this.selectedDeckEl) {
        this.selectedDeckEl.appendChild(this.emptyHintEl);
      }
      return;
    }

    if (this.emptyHintEl.parentNode === this.selectedDeckEl) {
      this.selectedDeckEl.removeChild(this.emptyHintEl);
    }

    if (reachableIds.length > 0) {
      // Prune stale compare cards
      for (const [rid, card] of this.compareCards.entries()) {
        if (!this.latestReachableSet.has(rid)) {
          card.remove();
          this.compareCards.delete(rid);
          this.compareCardContentKeys.delete(rid);
        }
      }

      const orderedCards: HTMLButtonElement[] = [];
      for (const rid of reachableIds) {
        const rn = run.graph.nodes[rid];
        if (!rn) continue;
        const rm = NODE_TYPE_META[rn.type];
        const fc = describeNodeForecast(run, rn, pureAutoCombat, bonusBossCharges, stargateRelayTier);
        const active = rid === selNode.nodeId;

        let card = this.compareCards.get(rid);
        if (!card) {
          card = document.createElement('button');
          card.type = 'button';
          card.className = 'v2-map-compare-card';
          card.dataset.selectNode = rid;
          card.dataset.testid = `map-compare-${rid}`;
          this.compareCards.set(rid, card);
        }
        card.classList.toggle('selected', active);

        const contentKey = [
          rn.type,
          rn.lane,
          fuelInfo.totalCost,
          canJump ? 1 : 0,
          rn.contractMarker ? 1 : 0,
          rn.hasRelicSignal ? 1 : 0,
          fc.traitBadge ?? '',
          rn.hasSupportGuarantee ? run.primaryArchetype : '',
          fuelInfo.navigatorDiscountApplied ? 1 : 0,
          fuelInfo.rescueSurcharge,
          fc.cls,
          fc.brief,
          fc.detail,
        ].join('|');

        if (this.compareCardContentKeys.get(rid) !== contentKey) {
          this.compareCardContentKeys.set(rid, contentKey);
          card.innerHTML = `
            <div class="v2-mc-head">
              <span class="v2-mc-head-left">${svgIcon(rm.icon, 14)} ${rn.lane === 0 ? 'A线' : 'B线'} · ${rm.label}</span>
              <span class="v2-fuel-tag ${canJump ? '' : 'no-fuel'}" title="本次跃迁消耗 ${fuelInfo.totalCost} 燃料">${svgIcon('fuel', 11)} ${fuelInfo.totalCost} 燃料</span>
            </div>
            <div class="v2-mc-tags v3-map-intent-tags">
              ${rn.contractMarker ? `<span class="v2-badge-contract">${svgIcon('star', 10)} 委托目标</span>` : ''}
              ${rn.hasRelicSignal ? `<span class="v3-badge-relic">${svgIcon('museum', 10)} 保底遗物信号</span>` : ''}
              ${fc.traitBadge ? `<span class="v3-badge-intent">${fc.traitBadge}</span>` : ''}
              ${
                rn.hasSupportGuarantee
                  ? `<span class="v2-badge-support">${V2_ARCHETYPE_LABELS[run.primaryArchetype].supportName}保底</span>`
                  : ''
              }
              ${fuelInfo.navigatorDiscountApplied ? `<span class="v2-badge-info">首跳省油</span>` : ''}
              ${fuelInfo.rescueSurcharge > 0 ? `<span class="v2-badge-warn">救生舱+1油</span>` : ''}
            </div>
            <div class="v2-mc-forecast ${fc.cls}">${fc.brief}</div>
            <small style="color:var(--text-secondary);font-size:11px;">${fc.detail}</small>
          `;
        }
        orderedCards.push(card);
      }

      orderedCards.forEach((card, idx) => {
        const currentChild = this.compareGridEl!.children[idx] as HTMLElement | undefined;
        if (currentChild !== card) {
          this.compareGridEl!.insertBefore(card, currentChild ?? null);
        }
      });

      if (this.compareGridEl.parentNode !== this.selectedDeckEl) {
        this.selectedDeckEl.insertBefore(this.compareGridEl, this.jumpBtnEl.parentNode === this.selectedDeckEl ? this.jumpBtnEl : null);
      }
    } else if (this.compareGridEl.parentNode === this.selectedDeckEl) {
      this.selectedDeckEl.removeChild(this.compareGridEl);
    }

    const selMeta = NODE_TYPE_META[selNode.type];
    this.jumpBtnEl.dataset.jumpNode = selNode.nodeId;
    this.jumpBtnEl.disabled = readOnly || !canJump;
    const jumpKey = `${canJump ? 1 : 0}:${selNode.nodeId}:${selNode.layer}:${selNode.lane}:${selNode.type}`;
    if (jumpKey !== this.lastJumpBtnKey) {
      this.lastJumpBtnKey = jumpKey;
      this.jumpBtnEl.innerHTML = canJump
        ? `${svgIcon('rocket', 15)} 跃迁至第 ${selNode.layer} 层 ${selNode.lane === 0 ? 'A线' : 'B线'} · ${selMeta.label}`
        : '燃料不足 · 请免费安全返航';
    }
    if (this.jumpBtnEl.parentNode !== this.selectedDeckEl) {
      this.selectedDeckEl.appendChild(this.jumpBtnEl);
    }
  }

  unmount(): void {
    this.rootEl?.removeEventListener('click', this.handleRootClick);
    this.mobileToggleBtn?.removeEventListener('click', this.handleMobileToggle);
    this.jumpBtnEl?.removeEventListener('click', this.handleJump);
    this.safeReturnBtn?.removeEventListener('click', this.handleSafeReturn);
    this.abortBtn?.removeEventListener('click', this.handleAbort);

    this.rootEl?.remove();
    this.nodeButtons.clear();
    this.nodeButtonInnerKeys.clear();
    this.compareCards.clear();
    this.compareCardContentKeys.clear();
    this.gadgetBtns.clear();
    this.latestReachableSet.clear();

    this.hostEl = null;
    this.rootEl = null;
    this.contractTitleEl = null;
    this.walletNumEl = null;
    this.sectorStripEl = null;
    this.sectorBadgeEl = null;
    this.sectorDescEl = null;
    this.lastSectorId = null;
    this.finalMissionSlotEl = null;
    this.endlessSlotEl = null;
    this.navigatorRevealSlotEl = null;
    this.bonusTrackerSlotEl = null;
    this.relicSignalSlotEl = null;
    this.lastFinalMissionKey = null;
    this.lastEndlessKey = null;
    this.lastNavigatorRevealKey = null;
    this.lastBonusTrackerKey = null;
    this.lastRelicSignalKey = null;
    this.gadgetSlotEl = null;
    this.gadgetBarEl = null;
    this.gadgetBtnsWrapEl = null;
    this.mobileToggleSlotEl = null;
    this.mobileToggleBarEl = null;
    this.mobileToggleLabelEl = null;
    this.mobileToggleBtn = null;
    this.graphSlotEl = null;
    this.desktopDagBoxEl = null;
    this.dagScrollEl = null;
    this.svgHostEl = null;
    this.dagGridEl = null;
    this.mobileFocusEl = null;
    this.renderedGraphMode = null;
    this.renderedDesktopStructureKey = null;
    this.renderedMobileStructureKey = null;
    this.lastEdgesKey = null;
    this.selectedDeckEl = null;
    this.emptyHintEl = null;
    this.compareGridEl = null;
    this.jumpBtnEl = null;
    this.lastJumpBtnKey = null;
    this.footerEl = null;
    this.safeReturnBtn = null;
    this.abortBtn = null;
    this.latestActions = null;
    this.latestEffectiveSelectedId = null;
  }
}

const legacyMapViews = new WeakMap<HTMLElement, MapPhaseView>();

export function renderMapView(
  leftPanelEl: HTMLElement,
  props: MapViewProps,
  actions: MapViewActions
): void {
  let view = legacyMapViews.get(leftPanelEl);
  if (!view || !view.isMountedIn(leftPanelEl)) {
    view?.unmount();
    leftPanelEl.innerHTML = '';
    view = new MapPhaseView();
    view.mount(leftPanelEl);
    legacyMapViews.set(leftPanelEl, view);
  }
  view.update(props, actions);
}
