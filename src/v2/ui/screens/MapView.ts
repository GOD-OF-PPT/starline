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
import {
  canUseV3GadgetInRun,
  getReachableNextNodeIds,
  getV2SafeReturnStatus,
} from '../../domain/encounter';
import { getAnyV2ItemDef } from '../../domain/itemCatalog';
import {
  classifyV2CombatThreat,
  getV2ThreatTierMeta,
  type V2CombatThreatTier,
} from '../../domain/tacticalDelta';
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
  readonly threatTier?: V2CombatThreatTier;
  readonly threatLabel?: '稳' | '吃力' | '危险' | '致命';
  readonly threatSymbol?: '●' | '▲' | '◆' | '✕';
  readonly previewFinalHp?: number;
  readonly detailsDrawerHtml?: string;
  readonly relicRewardName?: string;
}

interface DestCardRefs {
  readonly cardEl: HTMLDivElement;
  readonly bodyEl: HTMLDivElement;
  readonly footerEl: HTMLDivElement;
  readonly jumpBtnEl: HTMLButtonElement;
  bodyKey: string | null;
  jumpKey: string | null;
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
    const unitNamesBrief = n.combat.units.map((u) => u.name).join(' + ');
    const unitStatsBrief = n.combat.units
      .map(
        (u) =>
          `${u.name}(${u.maxHp}HP/${u.damagePerRound}攻${u.armor ? `/甲${u.armor}` : ''}${
            u.pierceRatio ? '/穿盾' : ''
          })`
      )
      .join(' + ');
    const effectiveBounty = getEffectiveV2CombatBounty(run, n.combat.bounty);
    const threat = pv
      ? classifyV2CombatThreat(
          { outcome: pv.outcome, playerFinalHp: pv.finalPlayerHpAfterRepair },
          run.maxHp
        )
      : { tier: 'danger' as const, label: '危险' as const, riskClass: 'risk' as const };
    const threatMeta = getV2ThreatTierMeta(threat.tier);
    const previewFinalHp = pv ? (pv.outcome === 'victory' ? pv.finalPlayerHpAfterRepair : 0) : 0;
    const relicRewardDef =
      n.hasRelicSignal && n.relicSignalDefId ? getAnyV2ItemDef(n.relicSignalDefId) : null;
    const relicRewardNote = relicRewardDef ? ` · 奖励实物：${relicRewardDef.name}` : '';
    const tacticNote = !pureAutoCombat ? `（含${chargesMax}战术指令）` : '';
    const brief = `${threatMeta.symbol} ${threatMeta.label} · ${threatMeta.layer1Summary}${tacticNote} · +${effectiveBounty}¤`;
    const roundsHtml = pv
      ? pv.rounds
          .slice(0, 6)
          .map(
            (r) =>
              `<div class="v2-log-row">R${r.round}: 我方 ${r.playerAttacks.reduce(
                (s, a) => s + a.appliedDamage,
                0
              )}伤 · 敌方 ${r.enemyAttacks.reduce((s, a) => s + a.hullDamage, 0)}直伤(盾吸${
                r.shieldAbsorbedTotal
              }) → ${r.playerHpAfter}HP</div>`
          )
          .join('')
      : '';
    const exactLine = pv
      ? pv.outcome === 'victory'
        ? `预计获胜 · 余 ${pv.finalPlayerHpAfterRepair}HP (${pv.roundsCount}轮)`
        : `预计战败 · 余 0HP (${pv.roundsCount}轮)`
      : '暂无推演数据';
    const detailsDrawerHtml = `
      <div class="v3-drawer-head">
        <span class="v3-drawer-tag">不干预时结果</span>
        <strong class="num">${exactLine}</strong>
      </div>
      <div class="v3-drawer-sub">敌方明细：${unitStatsBrief}</div>
      ${roundsHtml ? `<div class="v2-combat-log-list">${roundsHtml}</div>` : ''}
    `;
    return {
      brief,
      cls: threatMeta.riskClass,
      detail: `敌舰编队：${unitNamesBrief}${relicRewardNote}`,
      traitBadge,
      threatTier: threatMeta.tier,
      threatLabel: threatMeta.label,
      threatSymbol: threatMeta.symbol,
      previewFinalHp,
      detailsDrawerHtml,
      relicRewardName: relicRewardDef?.name,
    };
  }
  if (n.eventState?.eventId === 'tutorial_safe_beacon' || n.eventId === 'tutorial_safe_beacon') {
    return {
      brief: '安全回港 · 零战斗风险交付密封反应堆',
      cls: 'ok',
      detail: '直接接驳回收信标返回拆解站',
      traitBadge: '安全回港',
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
      brief: `补给交易：2 件设备 / +2油 / +${n.merchant?.repairAmount ?? 8}耐久`,
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
 * Stateful Star Map PhaseView (F04 + S04 / PROJECT.md § Interface Contracts #6 & #7).
 * - Eliminates 3x duplication (no separate compare grid or bottom jump button).
 * - Renders ONE unified destination card (`[data-testid="map-node-<id>"]`) per reachable node
 *   with an inline 1-click jump button (`[data-jump-node="<id>"]`, carrying `[data-testid="btn-jump-node"]`
 *   strictly on the selected card).
 * - Preserves `.v2-dag-scroll` scroll offsets, card DOM identity, focus, zero listener leaks,
 *   and strictly <= 1 DOM element per `[data-testid="map-node-<id>"]`.
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

  // Unified Reachable Destination Deck (S04)
  private destDeckEl: HTMLElement | null = null;
  private destDeckHeadEl: HTMLElement | null = null;
  private destGridEl: HTMLElement | null = null;
  private emptyHintEl: HTMLElement | null = null;
  private readonly destCards = new Map<string, DestCardRefs>();

  // Compact Route Overview Strip
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

  private readonly overviewNodeButtons = new Map<string, HTMLButtonElement>();
  private readonly overviewNodeInnerKeys = new Map<string, string>();
  private readonly routeWaypoints = new Map<string, HTMLSpanElement>();

  private footerEl: HTMLElement | null = null;
  private safeReturnBtn: HTMLButtonElement | null = null;
  private safeReturnLabelEl: HTMLSpanElement | null = null;
  private abortBtn: HTMLButtonElement | null = null;

  private latestProps: MapViewProps | null = null;
  private latestActions: MapViewActions | null = null;
  private latestHasStagedItems = false;
  private expandedDetailsNodeId: string | null = null;
  private readonly latestReachableSet = new Set<string>();

  private readonly handleRootClick = (ev: MouseEvent): void => {
    if (!this.rootEl || !this.latestActions) return;
    const target = ev.target as HTMLElement | null;
    if (!target) return;

    // 1. Check inline 1-click jump button FIRST (prevents double-fire with parent card's data-select-node!)
    const jumpBtn = target.closest<HTMLButtonElement>('[data-jump-node]');
    if (jumpBtn) {
      if (!this.rootEl.contains(jumpBtn) || jumpBtn.disabled || this.latestHasStagedItems) {
        return;
      }
      const nid = jumpBtn.dataset.jumpNode;
      if (nid && this.latestReachableSet.has(nid)) {
        this.latestActions.onJumpNode(nid);
      }
      return;
    }

    // 1.5 Check on-demand Details Drawer toggle BEFORE card selection (S06)
    const detailsBtn = target.closest<HTMLButtonElement>('[data-toggle-map-details]');
    if (detailsBtn) {
      if (!this.rootEl.contains(detailsBtn)) return;
      const nid = detailsBtn.dataset.toggleMapDetails;
      if (nid && this.latestProps && this.latestActions) {
        this.expandedDetailsNodeId = this.expandedDetailsNodeId === nid ? null : nid;
        this.update(this.latestProps, this.latestActions);
      }
      return;
    }

    // 2. Clicking card body selects node without jumping
    const selectCard = target.closest<HTMLElement>('[data-select-node]');
    if (selectCard) {
      if (!this.rootEl.contains(selectCard)) return;
      if ((selectCard as HTMLButtonElement).disabled) return;
      const nid = selectCard.dataset.selectNode;
      if (nid && this.latestReachableSet.has(nid)) {
        this.latestActions.onSelectNode(nid);
      }
      return;
    }

    // 3. Map gadgets bar
    const gadgetBtn = target.closest<HTMLButtonElement>('[data-use-gadget]');
    if (gadgetBtn) {
      if (!this.rootEl.contains(gadgetBtn) || gadgetBtn.disabled) return;
      const iid = gadgetBtn.dataset.useGadget;
      if (iid) {
        this.latestActions.onUseGadget?.(iid);
      }
    }
  };

  private readonly handleRootKeyDown = (ev: KeyboardEvent): void => {
    if (!this.rootEl || !this.latestActions) return;
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const target = ev.target as HTMLElement | null;
    if (!target || target.tagName === 'BUTTON') return;
    const selectCard = target.closest<HTMLElement>('[data-select-node]');
    if (!selectCard || selectCard !== target || !this.rootEl.contains(selectCard)) return;
    const nid = selectCard.dataset.selectNode;
    if (nid && this.latestReachableSet.has(nid)) {
      ev.preventDefault();
      this.latestActions.onSelectNode(nid);
    }
  };

  private readonly handleMobileToggle = (): void => {
    if (!this.rootEl || !this.latestActions) return;
    this.latestActions.onToggleMobileMap();
  };

  private readonly handleSafeReturn = (): void => {
    if (
      !this.rootEl ||
      !this.safeReturnBtn ||
      this.safeReturnBtn.disabled ||
      this.latestHasStagedItems ||
      !this.latestActions
    ) {
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

    // 1. Header
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

    // 2. Sector modifier strip
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

    // 3. 5 optional banner slots (display: none when empty so zero flex gaps!)
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

    // 4. Optional Map Gadgets slot
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

    // 5. PRIMARY — Unified Reachable Destination Deck (S04)
    const destDeckEl = document.createElement('div');
    destDeckEl.className = 'v3-map-dest-deck';
    const destDeckHeadEl = document.createElement('div');
    destDeckHeadEl.className = 'v3-map-dest-head';
    const destGridEl = document.createElement('div');
    destGridEl.className = 'v3-map-dest-grid';
    const emptyHintEl = document.createElement('div');
    emptyHintEl.className = 'v2-empty-hint';
    emptyHintEl.textContent = '已抵达最深层，点击下方免费安全返航完成结算！';
    rootEl.appendChild(destDeckEl);

    // 6. Optional Mobile Toggle slot
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

    // 7. Compact Non-Duplicating Route Overview Strip (holds EITHER desktop DAG OR mobile preview — NEVER both!)
    const graphSlotEl = document.createElement('div');
    graphSlotEl.dataset.slot = 'map-graph';
    graphSlotEl.style.display = 'contents';
    rootEl.appendChild(graphSlotEl);

    const desktopDagBoxEl = document.createElement('div');
    desktopDagBoxEl.className = 'v2-dag-box v2-dag-hero v3-route-overview';
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

    // 8. Footer actions
    const footerEl = document.createElement('div');
    footerEl.className = 'v2-map-footer-actions';
    const safeReturnBtn = document.createElement('button');
    safeReturnBtn.type = 'button';
    safeReturnBtn.className = 'btn btn-secondary';
    safeReturnBtn.id = 'v2-btn-safe-return';
    safeReturnBtn.dataset.testid = 'btn-safe-return';
    const safeReturnIconEl = document.createElement('span');
    safeReturnIconEl.style.display = 'contents';
    safeReturnIconEl.innerHTML = `${svgIcon('beacon', 14)} `;
    const safeReturnLabelEl = document.createElement('span');
    safeReturnLabelEl.style.display = 'contents';
    safeReturnLabelEl.textContent = '免费安全返航';
    safeReturnBtn.appendChild(safeReturnIconEl);
    safeReturnBtn.appendChild(safeReturnLabelEl);

    const abortBtn = document.createElement('button');
    abortBtn.type = 'button';
    abortBtn.className = 'btn btn-ghost';
    abortBtn.id = 'v2-btn-abort-contract';
    abortBtn.textContent = '放弃当前委托';

    footerEl.appendChild(safeReturnBtn);
    rootEl.appendChild(footerEl);

    // Attach delegated listeners ONCE (zero per-card listeners!)
    rootEl.addEventListener('click', this.handleRootClick);
    rootEl.addEventListener('keydown', this.handleRootKeyDown);
    mobileToggleBtn.addEventListener('click', this.handleMobileToggle);
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
    this.destDeckEl = destDeckEl;
    this.destDeckHeadEl = destDeckHeadEl;
    this.destGridEl = destGridEl;
    this.emptyHintEl = emptyHintEl;
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
    this.footerEl = footerEl;
    this.safeReturnBtn = safeReturnBtn;
    this.safeReturnLabelEl = safeReturnLabelEl;
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
    this.latestHasStagedItems = false;
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

  private detachDestCard(rid: string, refs: DestCardRefs): void {
    refs.jumpBtnEl.disabled = true;
    refs.jumpBtnEl.removeAttribute('data-jump-node');
    refs.jumpBtnEl.removeAttribute('data-testid');
    refs.cardEl.remove();
    this.destCards.delete(rid);
  }

  private getOrUpdateOverviewButton(
    run: V2RunState,
    n: V2MapNode,
    compact: boolean,
    fullMapReveal: boolean
  ): HTMLButtonElement {
    let btn = this.overviewNodeButtons.get(n.nodeId);
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.testid = `map-node-${n.nodeId}`;
      this.overviewNodeButtons.set(n.nodeId, btn);
    }

    const meta = NODE_TYPE_META[n.type];
    const visited = run.visitedNodeIds.includes(n.nodeId);
    const isCur = run.currentNodeId === n.nodeId;

    const nextClass = `v2-dag-node ${meta.cls}${visited ? ' visited' : ''}${
      isCur ? ' current' : ''
    }${n.isBeacon ? ' is-beacon' : ''}`;
    if (btn.className !== nextClass) {
      btn.className = nextClass;
    }
    if (btn.dataset.reachable !== 'false') {
      btn.dataset.reachable = 'false';
    }
    if (!btn.disabled) {
      btn.disabled = true;
    }

    const beaconNote = n.isBeacon ? ' · 回收信标（免费返航）' : '';
    const intelTitle = fullMapReveal
      ? n.combat
        ? `第${n.layer}层 ${meta.label} · ${getV2EncounterTemplate(n.combat.encounterKind).name}${beaconNote}`
        : n.eventState
        ? `第${n.layer}层 ${meta.label} · ${n.eventState.title}${beaconNote}`
        : `第${n.layer}层 ${meta.label}${beaconNote}`
      : `第${n.layer}层 ${meta.label}${beaconNote}`;
    if (btn.title !== intelTitle) {
      btn.title = intelTitle;
    }

    const innerKey = `${n.type}:${compact ? 1 : 0}:${n.contractMarker ? 1 : 0}:${
      n.hasSupportGuarantee ? 1 : 0
    }:${n.hasRelicSignal ? 1 : 0}:${n.isBeacon ? 1 : 0}:${run.isTutorial ? 1 : 0}`;
    if (this.overviewNodeInnerKeys.get(n.nodeId) !== innerKey) {
      this.overviewNodeInnerKeys.set(n.nodeId, innerKey);
      btn.innerHTML = `
        <span class="v2-dag-icon">${svgIcon(meta.icon, compact ? 14 : 15)}</span>
        <span class="v2-dag-name">${meta.label}</span>
        ${n.isBeacon ? `<span class="v3-dag-beacon" title="回收信标：可免费安全返航">标</span>` : ''}
        ${n.contractMarker ? `<span class="v2-dag-star" aria-label="委托目标">${svgIcon('star', 11)}</span>` : ''}
        ${n.hasSupportGuarantee ? `<span class="v2-dag-sup">配</span>` : ''}
        ${n.hasRelicSignal ? `<span class="v3-dag-relic" title="${run.isTutorial ? '稀有遗物信号' : '保底遗物信号'}">遗</span>` : ''}
      `;
    }

    return btn;
  }

  private getOrUpdateRouteWaypoint(
    n: V2MapNode,
    effectiveSelectedId: string | null
  ): HTMLSpanElement {
    let wp = this.routeWaypoints.get(n.nodeId);
    if (!wp) {
      wp = document.createElement('span');
      wp.dataset.routeWaypoint = n.nodeId;
      this.routeWaypoints.set(n.nodeId, wp);
    }
    const isSelected = effectiveSelectedId === n.nodeId;
    const nextCls = `v3-route-waypoint${isSelected ? ' selected' : ''}${
      n.isBeacon ? ' is-beacon' : ''
    }`;
    if (wp.className !== nextCls) {
      wp.className = nextCls;
    }
    const label = `${n.lane === 0 ? 'A线' : 'B线'} · 下一跳${n.isBeacon ? ' · 信标' : ''}`;
    if (wp.textContent !== label) {
      wp.textContent = label;
    }
    return wp;
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

    this.latestProps = props;
    this.latestActions = actions;

    const reachableIds = getReachableNextNodeIds(run);
    this.latestReachableSet.clear();
    for (const rid of reachableIds) this.latestReachableSet.add(rid);

    const hasStagedItems = run.bay.staging.length > 0;
    this.latestHasStagedItems = hasStagedItems;

    const fuelInfo = computeV2JumpFuelCost(run);
    const canJump = run.fuel >= fuelInfo.totalCost;

    const effectiveSelectedId =
      selectedMapNodeId && this.latestReachableSet.has(selectedMapNodeId)
        ? selectedMapNodeId
        : reachableIds[0] ?? null;

    if (this.expandedDetailsNodeId !== null && this.expandedDetailsNodeId !== effectiveSelectedId) {
      this.expandedDetailsNodeId = null;
    }

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
    const hasDiscardedAny =
      (run.discardedCountThisRun ?? 0) > 0 || run.bay.discardedThisArrange.length > 0;
    const bonusKey =
      activeBonus && !run.isTutorial
        ? (() => {
            const currentlyMet = evaluateRunBonusObjective(run, 'safe_return');
            const failedDiscard = activeBonus.id === 'bonus_no_discard' && hasDiscardedAny;
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
        const failedDiscard = activeBonus!.id === 'bonus_no_discard' && hasDiscardedAny;
        const statusCls = failedDiscard ? 'is-failed' : currentlyMet ? 'is-met' : 'is-pending';
        const statusText = failedDiscard ? '已失格' : currentlyMet ? '当前满足' : '进行中';
        return `<div class="v3-bonus-tracker-strip ${statusCls}" data-testid="bonus-objective-tracker">
          <span>${svgIcon('target', 12)} 额外目标：<strong>${activeBonus!.label}</strong>（+${activeBonus!.rewardCredits}¤）</span>
          <span class="v3-bonus-status-chip">${statusText}</span>
        </div>`;
      }
    );

    const allNodes = Object.values(run.graph.nodes);
    const relicSignalNodes = run.isTutorial ? [] : allNodes.filter((n) => Boolean(n.hasRelicSignal));
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

    // STRICT PRUNE-BEFORE-ATTACH ORDERING (zero transient duplicate data-testids!)
    // 1. Prune nodes that no longer exist in the current graph
    for (const [rid, refs] of this.destCards.entries()) {
      if (!run.graph.nodes[rid] || !this.latestReachableSet.has(rid)) {
        this.detachDestCard(rid, refs);
      }
    }
    for (const [nid, btn] of this.overviewNodeButtons.entries()) {
      if (!run.graph.nodes[nid] || this.latestReachableSet.has(nid)) {
        btn.remove();
        this.overviewNodeButtons.delete(nid);
        this.overviewNodeInnerKeys.delete(nid);
      }
    }
    for (const [nid, wp] of this.routeWaypoints.entries()) {
      if (!run.graph.nodes[nid] || !this.latestReachableSet.has(nid)) {
        wp.remove();
        this.routeWaypoints.delete(nid);
      }
    }

    // 2. Reconcile Unified Reachable Destination Deck (ONE card per reachable node + inline 1-click jump)
    this.reconcileDestinationDeck(
      run,
      reachableIds,
      effectiveSelectedId,
      fuelInfo,
      canJump,
      hasStagedItems,
      readOnly,
      pureAutoCombat,
      bonusBossCharges,
      stargateRelayTier
    );

    // 3. Mobile toggle bar
    const layers = Array.from({ length: run.graph.maxLayers }, (_, i) => i + 1);
    const currentLayerNum = run.currentNodeId ? run.graph.nodes[run.currentNodeId]?.layer ?? 0 : 0;
    const upcomingLayers = [currentLayerNum + 2].filter(
      (ly) => ly >= 1 && ly <= run.graph.maxLayers
    );
    const showMobileToggle = isCompactViewport && run.graph.maxLayers > 1;
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
        const lblText = mobileMapShowFull ? `完整 ${run.graph.maxLayers} 层航路总览` : '后续航路预告';
        if (this.mobileToggleLabelEl.textContent !== lblText) {
          this.mobileToggleLabelEl.textContent = lblText;
        }
        const btnText = mobileMapShowFull ? '收起总览' : `展开完整 ${run.graph.maxLayers} 层`;
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

    // 4. Reconcile Compact Non-Duplicating Route Overview Strip
    const useMobileFocus = isCompactViewport && !mobileMapShowFull && run.graph.maxLayers > 1;
    this.reconcileGraph(
      run,
      allNodes,
      layers,
      currentLayerNum,
      upcomingLayers,
      useMobileFocus,
      reachableIds,
      effectiveSelectedId,
      fullMapReveal
    );

    // 5. Footer actions
    const canAbort =
      run.contract.status === 'active' &&
      run.contract.type !== 'free' &&
      !run.isTutorial &&
      !isContractReadyForDelivery(run, 'safe_return');

    if (this.safeReturnBtn) {
      const returnStatus = getV2SafeReturnStatus(run);
      const towPct = Math.round(returnStatus.towPenaltyRate * 100);
      this.safeReturnBtn.disabled = readOnly || hasStagedItems;
      this.safeReturnBtn.dataset.returnMode = returnStatus.mode;

      if (returnStatus.isFreeBeacon) {
        const freeCls = 'btn btn-secondary';
        if (this.safeReturnBtn.className !== freeCls) this.safeReturnBtn.className = freeCls;
        this.safeReturnBtn.title = hasStagedItems
          ? `请先处理暂存区 ${run.bay.staging.length} 件物品再返航`
          : '当前位于回收信标 · 免费安全返航（保留全额货值与深层升值）';
        const nextSafeLabel = hasStagedItems ? '免费安全返航（需清空暂存区）' : '免费安全返航';
        if (this.safeReturnLabelEl && this.safeReturnLabelEl.textContent !== nextSafeLabel) {
          this.safeReturnLabelEl.textContent = nextSafeLabel;
        }
      } else {
        const towCls = returnStatus.isStranded
          ? 'btn btn-danger v3-btn-emergency-tow is-stranded'
          : 'btn btn-secondary v3-btn-emergency-tow';
        if (this.safeReturnBtn.className !== towCls) this.safeReturnBtn.className = towCls;
        const beaconHint = returnStatus.nextBeaconLayer
          ? ` · 下一回收信标：第 ${returnStatus.nextBeaconLayer} 层`
          : '';
        this.safeReturnBtn.title = hasStagedItems
          ? `请先处理暂存区 ${run.bay.staging.length} 件物品再返航`
          : `非信标节点仅支持紧急拖航（扣除 ${towPct}% 拖航费，无深潜升值与额外加赏，保留自有装备）${beaconHint}`;
        const nextTowLabel = hasStagedItems
          ? '紧急拖航返航（需清空暂存区）'
          : returnStatus.isStranded
          ? `燃料耗尽 · 紧急拖航返航（-${towPct}% 费用）`
          : `紧急拖航返航（非信标 · -${towPct}% 费用）`;
        if (this.safeReturnLabelEl && this.safeReturnLabelEl.textContent !== nextTowLabel) {
          this.safeReturnLabelEl.textContent = nextTowLabel;
        }
      }
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

  private reconcileDestinationDeck(
    run: V2RunState,
    reachableIds: readonly string[],
    effectiveSelectedId: string | null,
    fuelInfo: ReturnType<typeof computeV2JumpFuelCost>,
    canJump: boolean,
    hasStagedItems: boolean,
    readOnly: boolean,
    pureAutoCombat: boolean,
    bonusBossCharges: number,
    stargateRelayTier: number
  ): void {
    if (!this.destDeckEl || !this.destDeckHeadEl || !this.destGridEl || !this.emptyHintEl) return;

    if (reachableIds.length === 0) {
      if (this.destDeckHeadEl.parentNode === this.destDeckEl) {
        this.destDeckEl.removeChild(this.destDeckHeadEl);
      }
      if (this.destGridEl.parentNode === this.destDeckEl) {
        this.destDeckEl.removeChild(this.destGridEl);
      }
      if (this.emptyHintEl.parentNode !== this.destDeckEl) {
        this.destDeckEl.appendChild(this.emptyHintEl);
      }
      return;
    }

    if (this.emptyHintEl.parentNode === this.destDeckEl) {
      this.destDeckEl.removeChild(this.emptyHintEl);
    }

    const firstNode = run.graph.nodes[reachableIds[0]];
    const nextLayer = firstNode?.layer ?? 1;
    const headText = `下一跳航路 · 第 ${nextLayer}/${run.graph.maxLayers} 层（点击卡片按钮一键跃迁）`;
    if (this.destDeckHeadEl.textContent !== headText) {
      this.destDeckHeadEl.textContent = headText;
    }
    if (this.destDeckHeadEl.parentNode !== this.destDeckEl) {
      this.destDeckEl.insertBefore(this.destDeckHeadEl, this.destGridEl.parentNode === this.destDeckEl ? this.destGridEl : null);
    }

    const canActuallyJump = !readOnly && canJump && !hasStagedItems;

    // Remove btn-jump-node testid from non-selected cards FIRST so never >1 exists transiently
    for (const [rid, refs] of this.destCards.entries()) {
      if (rid !== effectiveSelectedId) {
        refs.jumpBtnEl.removeAttribute('data-testid');
      }
    }

    const orderedCards: HTMLDivElement[] = [];
    for (const rid of reachableIds) {
      const rn = run.graph.nodes[rid];
      if (!rn) continue;
      const rm = NODE_TYPE_META[rn.type];
      const fc = describeNodeForecast(run, rn, pureAutoCombat, bonusBossCharges, stargateRelayTier);
      const active = rid === effectiveSelectedId;

      let refs = this.destCards.get(rid);
      if (!refs) {
        const cardEl = document.createElement('div');
        cardEl.tabIndex = 0;
        cardEl.dataset.testid = `map-node-${rid}`;
        cardEl.dataset.selectNode = rid;
        cardEl.dataset.reachable = 'true';

        const bodyEl = document.createElement('div');
        bodyEl.className = 'v3-map-card-body';

        const footerEl = document.createElement('div');
        footerEl.className = 'v3-map-card-footer';

        const jumpBtnEl = document.createElement('button');
        jumpBtnEl.type = 'button';
        jumpBtnEl.dataset.jumpNode = rid;
        jumpBtnEl.dataset.action = 'jump-node';

        footerEl.appendChild(jumpBtnEl);
        cardEl.appendChild(bodyEl);
        cardEl.appendChild(footerEl);

        refs = { cardEl, bodyEl, footerEl, jumpBtnEl, bodyKey: null, jumpKey: null };
        this.destCards.set(rid, refs);
      }

      const nextCardClass = `v3-map-dest-card ${rm.cls} reachable${active ? ' selected' : ''}${
        rn.isBeacon ? ' is-beacon-node' : ''
      }${canActuallyJump ? '' : ' is-blocked'}`;
      if (refs.cardEl.className !== nextCardClass) {
        refs.cardEl.className = nextCardClass;
      }
      refs.cardEl.dataset.reachable = 'true';
      refs.cardEl.dataset.canJump = canActuallyJump ? 'true' : 'false';
      refs.cardEl.dataset.isBeacon = rn.isBeacon ? 'true' : 'false';
      if (rn.combat && fc.previewFinalHp !== undefined) {
        refs.cardEl.dataset.previewFinalHp = String(fc.previewFinalHp);
      } else {
        delete refs.cardEl.dataset.previewFinalHp;
      }
      if (rn.combat && fc.threatTier) {
        refs.cardEl.dataset.threatTier = fc.threatTier;
      } else {
        delete refs.cardEl.dataset.threatTier;
      }

      const showDetailsToggle = Boolean(active && rn.combat && fc.detailsDrawerHtml);
      const isDetailsOpen = showDetailsToggle && this.expandedDetailsNodeId === rid;

      const bodyKey = [
        rn.type,
        rn.lane,
        fuelInfo.totalCost,
        canJump ? 1 : 0,
        rn.isBeacon ? 1 : 0,
        rn.contractMarker ? 1 : 0,
        rn.hasRelicSignal ? 1 : 0,
        run.isTutorial ? 1 : 0,
        fc.relicRewardName ?? '',
        fc.traitBadge ?? '',
        fc.threatTier ?? '',
        fc.threatLabel ?? '',
        fc.threatSymbol ?? '',
        fc.previewFinalHp ?? '',
        rn.hasSupportGuarantee ? run.primaryArchetype : '',
        fuelInfo.navigatorDiscountApplied ? 1 : 0,
        fuelInfo.rescueSurcharge,
        fc.cls,
        fc.brief,
        fc.detail,
        showDetailsToggle ? 1 : 0,
        isDetailsOpen ? 1 : 0,
        isDetailsOpen ? fc.detailsDrawerHtml ?? '' : '',
      ].join('|');

      if (refs.bodyKey !== bodyKey) {
        refs.bodyKey = bodyKey;
        const beaconBadgeHtml = rn.isBeacon
          ? `<span class="v3-badge-beacon" data-testid="beacon-badge-${rid}">${svgIcon(
              'beacon',
              10
            )} 回收信标 · 免费返航</span>`
          : '';
        const relicBadgeHtml = rn.hasRelicSignal
          ? `<span class="v3-badge-relic">${svgIcon('museum', 10)} ${
              fc.relicRewardName
                ? `奖励实物：${fc.relicRewardName}`
                : run.isTutorial
                ? '稀有遗物信号'
                : '保底遗物信号'
            }</span>`
          : '';
        const threatBadgeHtml =
          rn.combat && fc.threatLabel && fc.threatTier
            ? `<span class="v3-threat-pill threat-${fc.threatTier}" data-threat-tier="${fc.threatTier}">${
                fc.threatSymbol ?? ''
              } ${fc.threatLabel}</span>`
            : '';
        const detailsBlockHtml = showDetailsToggle
          ? `<div class="v3-map-details-wrap">
              <button type="button" class="btn btn-sm btn-ghost v3-forecast-details-btn" data-toggle-map-details="${rid}" data-testid="btn-toggle-forecast-details" aria-expanded="${
                isDetailsOpen ? 'true' : 'false'
              }">${isDetailsOpen ? '收起详细推演' : '查看不干预推演明细'}</button>
              ${
                isDetailsOpen
                  ? `<div class="v3-forecast-details-drawer" data-testid="forecast-details-drawer">${fc.detailsDrawerHtml}</div>`
                  : ''
              }
            </div>`
          : '';
        refs.bodyEl.innerHTML = `
          <div class="v2-mc-head">
            <span class="v2-mc-head-left">${svgIcon(rm.icon, 14)} ${rn.lane === 0 ? 'A线' : 'B线'} · ${rm.label}</span>
            <span class="v2-fuel-tag ${canJump ? '' : 'no-fuel'}" title="本次跃迁消耗 ${fuelInfo.totalCost} 燃料">${svgIcon('fuel', 11)} ${fuelInfo.totalCost} 油</span>
          </div>
          <div class="v2-mc-tags v3-map-intent-tags">
            ${beaconBadgeHtml}
            ${rn.contractMarker ? `<span class="v2-badge-contract">${svgIcon('star', 10)} 委托目标</span>` : ''}
            ${relicBadgeHtml}
            ${threatBadgeHtml}
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
          <div class="v3-map-card-detail">${fc.detail}</div>
          ${detailsBlockHtml}
        `;
      }

      // Inline 1-click jump button (strictly 1 [data-testid="btn-jump-node"] on selected card)
      refs.jumpBtnEl.dataset.jumpNode = rid;
      if (active) {
        refs.jumpBtnEl.dataset.testid = 'btn-jump-node';
      } else {
        refs.jumpBtnEl.removeAttribute('data-testid');
      }
      refs.jumpBtnEl.disabled = !canActuallyJump;
      const nextBtnClass = `btn btn-sm v3-map-card-jump-btn ${
        active ? 'btn-primary' : 'btn-secondary'
      }`;
      if (refs.jumpBtnEl.className !== nextBtnClass) {
        refs.jumpBtnEl.className = nextBtnClass;
      }

      const jumpKey = `${hasStagedItems ? run.bay.staging.length : 0}:${canJump ? 1 : 0}:${
        fuelInfo.totalCost
      }:${run.fuel}:${readOnly ? 1 : 0}`;
      if (refs.jumpKey !== jumpKey) {
        refs.jumpKey = jumpKey;
        if (hasStagedItems) {
          refs.jumpBtnEl.textContent = `请先清空暂存区 (${run.bay.staging.length})`;
        } else if (!canJump) {
          refs.jumpBtnEl.textContent = `燃料不足（需 ${fuelInfo.totalCost} / 现有 ${run.fuel}）`;
        } else {
          refs.jumpBtnEl.innerHTML = `${svgIcon('rocket', 14)} 跃迁前往（${fuelInfo.totalCost} 油）`;
        }
      }

      orderedCards.push(refs.cardEl);
    }

    orderedCards.forEach((cardEl, idx) => {
      const currentChild = this.destGridEl!.children[idx] as HTMLElement | undefined;
      if (currentChild !== cardEl) {
        this.destGridEl!.insertBefore(cardEl, currentChild ?? null);
      }
    });

    if (this.destGridEl.parentNode !== this.destDeckEl) {
      this.destDeckEl.appendChild(this.destGridEl);
    }
  }

  private reconcileGraph(
    run: V2RunState,
    allNodes: readonly V2MapNode[],
    layers: readonly number[],
    currentLayerNum: number,
    upcomingLayers: readonly number[],
    useMobileFocus: boolean,
    reachableIds: readonly string[],
    effectiveSelectedId: string | null,
    fullMapReveal: boolean
  ): void {
    if (
      !this.graphSlotEl ||
      !this.desktopDagBoxEl ||
      !this.svgHostEl ||
      !this.dagGridEl ||
      !this.mobileFocusEl
    ) {
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

      const mobileStructKey = `${run.runId}|${currentLayerNum}|r=${reachableIds.join(',')}|u=${upcomingLayers
        .map((ly) => {
          const a = nodeBySlot.get(`${ly}:0`);
          const b = nodeBySlot.get(`${ly}:1`);
          return `${ly}:${a?.nodeId ?? ''}:${b?.nodeId ?? ''}`;
        })
        .join(';')}`;

      if (
        this.renderedGraphMode !== 'mobile' ||
        this.renderedMobileStructureKey !== mobileStructKey
      ) {
        this.mobileFocusEl.innerHTML = '';
        if (upcomingLayers.length === 0) {
          const hint = document.createElement('div');
          hint.className = 'v2-empty-hint';
          hint.textContent = '已临近终层，可从上方航路卡片直接跃迁';
          this.mobileFocusEl.appendChild(hint);
        } else {
          for (const ly of upcomingLayers) {
            const layerEl = document.createElement('div');
            layerEl.className = 'v2-mmf-layer';
            const headEl = document.createElement('div');
            headEl.className = 'v2-mmf-layer-head';
            headEl.textContent = `第 ${ly} 层（后续预告）`;
            const nodesWrap = document.createElement('div');
            nodesWrap.className = 'v2-mmf-nodes';

            const laneA = nodeBySlot.get(`${ly}:0`);
            const laneB = nodeBySlot.get(`${ly}:1`);
            for (const laneNode of [laneA, laneB]) {
              if (laneNode && !this.latestReachableSet.has(laneNode.nodeId)) {
                nodesWrap.appendChild(
                  this.getOrUpdateOverviewButton(run, laneNode, true, fullMapReveal)
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
        }
        this.renderedMobileStructureKey = mobileStructKey;
      } else {
        for (const ly of upcomingLayers) {
          const laneA = nodeBySlot.get(`${ly}:0`);
          const laneB = nodeBySlot.get(`${ly}:1`);
          if (laneA && !this.latestReachableSet.has(laneA.nodeId)) {
            this.getOrUpdateOverviewButton(run, laneA, true, fullMapReveal);
          }
          if (laneB && !this.latestReachableSet.has(laneB.nodeId)) {
            this.getOrUpdateOverviewButton(run, laneB, true, fullMapReveal);
          }
        }
      }

      this.renderedGraphMode = 'mobile';
      return;
    }

    // Desktop / Mobile Expanded Route Overview: detach mobile focus FIRST
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

    const desktopStructKey = `${run.runId}|r=${reachableIds.join(',')}|${layers
      .map((ly) => {
        const a = nodeBySlot.get(`${ly}:0`);
        const b = nodeBySlot.get(`${ly}:1`);
        return `${ly}:${a?.nodeId ?? ''}:${b?.nodeId ?? ''}`;
      })
      .join(';')}`;

    if (
      this.renderedGraphMode !== 'desktop' ||
      this.renderedDesktopStructureKey !== desktopStructKey
    ) {
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
            if (this.latestReachableSet.has(laneNode.nodeId)) {
              pairEl.appendChild(this.getOrUpdateRouteWaypoint(laneNode, effectiveSelectedId));
            } else {
              pairEl.appendChild(
                this.getOrUpdateOverviewButton(run, laneNode, false, fullMapReveal)
              );
            }
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
        if (this.latestReachableSet.has(n.nodeId)) {
          this.getOrUpdateRouteWaypoint(n, effectiveSelectedId);
        } else {
          this.getOrUpdateOverviewButton(run, n, false, fullMapReveal);
        }
      }
    }

    this.renderedGraphMode = 'desktop';
  }

  unmount(): void {
    this.rootEl?.removeEventListener('click', this.handleRootClick);
    this.rootEl?.removeEventListener('keydown', this.handleRootKeyDown);
    this.mobileToggleBtn?.removeEventListener('click', this.handleMobileToggle);
    this.safeReturnBtn?.removeEventListener('click', this.handleSafeReturn);
    this.abortBtn?.removeEventListener('click', this.handleAbort);

    for (const [rid, refs] of this.destCards.entries()) {
      this.detachDestCard(rid, refs);
    }
    this.rootEl?.remove();
    this.overviewNodeButtons.clear();
    this.overviewNodeInnerKeys.clear();
    this.routeWaypoints.clear();
    this.destCards.clear();
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
    this.destDeckEl = null;
    this.destDeckHeadEl = null;
    this.destGridEl = null;
    this.emptyHintEl = null;
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
    this.footerEl = null;
    this.safeReturnBtn = null;
    this.safeReturnLabelEl = null;
    this.abortBtn = null;
    this.latestProps = null;
    this.latestActions = null;
    this.latestHasStagedItems = false;
    this.expandedDetailsNodeId = null;
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
