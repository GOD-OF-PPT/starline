import { getItemImageUrl } from '../../../assets/itemArt';
import { getV3GadgetDef } from '../../data/gadgets';
import { getV3SectorDef } from '../../data/sectors';
import { V2_SHAPES } from '../../data/shapes';
import { buildActiveWreckStateForNode, evaluateWreckHotspotCut } from '../../domain/dismantle';
import { canUseV3GadgetInRun, isAtTerminalLayer } from '../../domain/encounter';
import { getAnyV2ItemDef } from '../../domain/itemCatalog';
import type {
  V2ItemInstance,
  V2MapNode,
  V2ProfileState,
  V2RunState,
  V2WreckHotspot,
  V2WreckSpotId,
} from '../../domain/types';
import { crewPortraitSvg, svgIcon, type V2IconName } from '../icons';
import type { PhaseView } from './screenTypes';

export type WreckHotspotId = V2WreckSpotId;

export interface WreckHotspotOverlayProps {
  readonly run: V2RunState;
  readonly node: V2MapNode;
  readonly profile?: V2ProfileState;
  readonly readOnly: boolean;
  readonly selectedHotspot: WreckHotspotId;
  readonly cuttingSpotId?: WreckHotspotId | null;
}

export interface WreckHotspotOverlayActions {
  readonly onSelectHotspot: (spot: WreckHotspotId) => void;
  readonly onCutHotspot?: (spot: WreckHotspotId) => void;
  readonly onSkipCut?: () => void;
}

export const WRECK_SPOT_COORDS: Record<
  V2WreckSpotId,
  {
    readonly normX: number;
    readonly normY: number;
    readonly left: string;
    readonly top: string;
    readonly icon: V2IconName;
  }
> = {
  armory: { normX: 0.22, normY: 0.48, left: '18%', top: '20%', icon: 'cannon' },
  reactor: { normX: 0.5, normY: 0.45, left: '50%', top: '18%', icon: 'fuel' },
  cargo: { normX: 0.78, normY: 0.5, left: '82%', top: '20%', icon: 'crate' },
  vault: { normX: 0.36, normY: 0.52, left: '31%', top: '38%', icon: 'star' },
  aux_bay: { normX: 0.64, normY: 0.52, left: '69%', top: '38%', icon: 'wrench' },
};

function syncButtonDisabled(btn: HTMLButtonElement, disabled: boolean): void {
  if (btn.disabled !== disabled) {
    btn.disabled = disabled;
  }
  if (disabled) {
    btn.setAttribute('disabled', '');
  } else {
    btn.removeAttribute('disabled');
  }
}

function describeItemForSalvager(item: V2ItemInstance): string {
  const def = getAnyV2ItemDef(item.definitionId);
  const name = def?.name ?? item.definitionId;
  const shapeLbl = def ? V2_SHAPES[def.shapeId].label : '';
  const qualityTag =
    item.category === 'equipment' ? (item.quality === 'improved' ? '优良' : '普通') : '';
  const parts = [qualityTag, shapeLbl, `${item.fixedValue}¤`].filter(Boolean);
  return `${name}（${parts.join(' · ')}）`;
}

function getSpotItems(spot: V2WreckHotspot): readonly V2ItemInstance[] {
  if (spot.rewardItems && spot.rewardItems.length > 0) return spot.rewardItems;
  if (spot.rewardItem) return [spot.rewardItem];
  return [];
}

interface WreckPinRefs {
  readonly btnEl: HTMLButtonElement;
  readonly silLayerEl: HTMLSpanElement;
  readonly tagEl: HTMLSpanElement;
  readonly badgeEmEl: HTMLElement;
  silKey: string;
  tagPrefixKey: string;
}

/**
 * Stateful top Phaser canvas overlay for derelict dissection (S08 + A07-code + M5-4):
 * - Preserves keyed hotspot pin <button> DOM identity across closed -> cutting -> cutaway & modal cancel.
 * - Strictly omits `data-testid="wreck-screen"` so the DOM contains exactly ONE wreck-screen root (in leftPanelEl).
 */
export class WreckOverlayPhaseView
  implements PhaseView<WreckHotspotOverlayProps, WreckHotspotOverlayActions>
{
  private hostEl: HTMLElement | null = null;
  private rootEl: HTMLDivElement | null = null;
  private stageTagEl: HTMLDivElement | null = null;
  private stageMeterEl: HTMLDivElement | null = null;
  private skipBarEl: HTMLDivElement | null = null;
  private readonly pins = new Map<V2WreckSpotId, WreckPinRefs>();

  private latestActions: WreckHotspotOverlayActions | null = null;
  private latestCuttingSpotId: WreckHotspotId | null = null;
  private lastStageTagKey: string | null = null;
  private lastMeterKey: string | null = null;

  private readonly handleRootClick = (ev: Event): void => {
    if (!this.rootEl || !this.latestActions) return;
    if (this.latestCuttingSpotId !== null) {
      ev.stopPropagation();
      this.latestActions.onSkipCut?.();
      return;
    }
    const target = ev.target as HTMLElement | null;
    if (!target || typeof target.closest !== 'function') return;
    const pinBtn = target.closest('[data-wreck-spot]') as HTMLButtonElement | null;
    if (!pinBtn || !this.rootEl.contains(pinBtn) || pinBtn.disabled) return;
    ev.stopPropagation();
    const spotId = pinBtn.dataset.wreckSpot as WreckHotspotId;
    if (pinBtn.dataset.canDirectCut === 'true' && this.latestActions.onCutHotspot) {
      this.latestActions.onCutHotspot(spotId);
      return;
    }
    this.latestActions.onSelectHotspot(spotId);
  };

  isMountedIn(host: HTMLElement): boolean {
    return Boolean(this.hostEl === host && this.rootEl && this.rootEl.parentElement === host);
  }

  mount(host: HTMLElement): void {
    if (this.isMountedIn(host)) return;
    if (this.rootEl || this.hostEl) {
      this.unmount();
    }
    this.hostEl = host;
    host.innerHTML = '';

    // Strictly OMIT data-testid="wreck-screen" here!
    const root = document.createElement('div');
    root.className = 'v3-overlay-screen v3-wreck-stage-overlay';

    const head = document.createElement('div');
    head.className = 'v3-wreck-stage-head';
    const stageTag = document.createElement('div');
    stageTag.className = 'scene-stage-tag';
    const stageMeter = document.createElement('div');
    stageMeter.className = 'v3-wreck-stage-meter';
    head.appendChild(stageTag);
    head.appendChild(stageMeter);
    root.appendChild(head);

    const skipBar = document.createElement('div');
    skipBar.className = 'v3-wreck-cut-skip-bar';
    const skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.className = 'btn btn-sm btn-secondary v3-wreck-skip-btn';
    skipBtn.dataset.testid = 'btn-skip-wreck-cut';
    skipBtn.innerHTML = `${svgIcon('cut', 13)} 等离子切割中… 点击或按空格跳过`;
    skipBar.appendChild(skipBtn);

    host.appendChild(root);
    root.addEventListener('click', this.handleRootClick);

    this.rootEl = root;
    this.stageTagEl = stageTag;
    this.stageMeterEl = stageMeter;
    this.skipBarEl = skipBar;
  }

  update(props: WreckHotspotOverlayProps, actions: WreckHotspotOverlayActions): void {
    this.latestActions = actions;
    if (!this.rootEl || !this.stageTagEl || !this.stageMeterEl || !this.skipBarEl) return;

    const { run, node, profile, readOnly, selectedHotspot: sel, cuttingSpotId = null } = props;
    this.latestCuttingSpotId = cuttingSpotId;

    const wreck = buildActiveWreckStateForNode(run, node, profile).wreck;
    const sector = getV3SectorDef(run.sectorId);
    const peek = run.crewId === 'salvager';
    const pct =
      wreck.maxStability > 0
        ? Math.max(0, Math.min(100, Math.round((wreck.stability / wreck.maxStability) * 100)))
        : 0;
    const toneCls = wreck.collapsed
      ? 'tone-critical'
      : pct >= 70
      ? 'tone-safe'
      : pct >= 35
      ? 'tone-warn'
      : 'tone-critical';

    this.rootEl.classList.toggle('is-cutting-active', cuttingSpotId !== null);

    const stageTagKey = `${sector.name}:${node.layer}`;
    if (this.lastStageTagKey !== stageTagKey) {
      this.lastStageTagKey = stageTagKey;
      this.stageTagEl.innerHTML = `${svgIcon('wreck', 13)} ${sector.name} · 第 ${node.layer} 层 漂流残骸 · 多刀拆解`;
    }

    const meterKey = `${toneCls}:${wreck.stability}/${wreck.maxStability}:${wreck.cutsMade}:${
      wreck.collapsed ? 1 : 0
    }`;
    if (this.lastMeterKey !== meterKey) {
      this.lastMeterKey = meterKey;
      this.stageMeterEl.className = `v3-wreck-stage-meter ${toneCls}`;
      this.stageMeterEl.innerHTML = `${svgIcon('cut', 12)} 稳定度 <strong class="num">${wreck.stability}/${wreck.maxStability}</strong> · 已切 ${wreck.cutsMade} 刀${
        wreck.collapsed ? ' · 已坍塌' : ''
      }`;
    }

    // Prune removed spotIds first
    const nextSpotIds = new Set<V2WreckSpotId>(wreck.hotspots.map((s) => s.spotId));
    for (const [sid, refs] of this.pins.entries()) {
      if (!nextSpotIds.has(sid)) {
        refs.btnEl.remove();
        this.pins.delete(sid);
      }
    }

    // Reconcile keyed pins in order (inserted before skipBarEl if attached)
    const skipAttached = this.skipBarEl.parentElement === this.rootEl;
    wreck.hotspots.forEach((spot) => {
      const pos = WRECK_SPOT_COORDS[spot.spotId] ?? {
        normX: 0.5,
        normY: 0.45,
        left: '50%',
        top: '36%',
        icon: 'wreck' as V2IconName,
      };
      const evalRes = evaluateWreckHotspotCut(run, wreck, spot.spotId);
      const isCuttingThis = cuttingSpotId === spot.spotId;
      const compartmentState: 'closed' | 'cutting' | 'cutaway' = spot.cut
        ? 'cutaway'
        : isCuttingThis
        ? 'cutting'
        : 'closed';
      const isCollapsedLocked = Boolean(wreck.collapsed && !spot.cut);
      const isNonLethalBlocked = Boolean(
        !spot.cut && !isCuttingThis && !isCollapsedLocked && !evalRes.isLethal && !evalRes.canCut
      );
      const stateCls = spot.cut
        ? 'is-cut'
        : isCuttingThis
        ? 'is-cutting'
        : isCollapsedLocked || evalRes.isLethal
        ? 'is-lethal'
        : isNonLethalBlocked || wreck.cutsMade >= 1
        ? 'is-risky'
        : '';
      const badgeText = spot.cut
        ? '已切开'
        : isCuttingThis
        ? '切割中…'
        : isCollapsedLocked
        ? '已坍塌'
        : evalRes.isLethal
        ? '致命'
        : isNonLethalBlocked
        ? '不可切'
        : wreck.cutsMade === 0
        ? '点击切开'
        : '贪刀切开';

      const items = getSpotItems(spot);
      const canDirectCut =
        !readOnly && !spot.cut && !wreck.collapsed && evalRes.canCut && cuttingSpotId === null;

      let refs = this.pins.get(spot.spotId);
      if (!refs) {
        const btnEl = document.createElement('button');
        btnEl.type = 'button';
        btnEl.style.left = pos.left;
        btnEl.style.top = pos.top;
        btnEl.dataset.wreckSpot = spot.spotId;
        btnEl.dataset.testid = `wreck-spot-${spot.spotId}`;
        btnEl.dataset.action = 'wreck-cut';

        const leftBracket = document.createElement('span');
        leftBracket.className = 'v3-clamp-bracket left';
        leftBracket.setAttribute('aria-hidden', 'true');
        const rightBracket = document.createElement('span');
        rightBracket.className = 'v3-clamp-bracket right';
        rightBracket.setAttribute('aria-hidden', 'true');
        const ring = document.createElement('span');
        ring.className = 'v2-hotspot-ring';

        const silLayerEl = document.createElement('span');
        silLayerEl.className = 'v3-wreck-silhouette-layer';

        const tagEl = document.createElement('span');
        tagEl.className = 'v2-hotspot-tag';
        const badgeEmEl = document.createElement('em');

        btnEl.appendChild(leftBracket);
        btnEl.appendChild(rightBracket);
        btnEl.appendChild(ring);
        btnEl.appendChild(silLayerEl);
        btnEl.appendChild(tagEl);

        refs = { btnEl, silLayerEl, tagEl, badgeEmEl, silKey: '', tagPrefixKey: '' };
        this.pins.set(spot.spotId, refs);
      }

      const nextCls = `v2-wreck-hotspot v3-wreck-hotspot-pin v3-wreck-compartment-pin${
        sel === spot.spotId ? ' active' : ''
      }${stateCls ? ` ${stateCls}` : ''}`;
      if (refs.btnEl.className !== nextCls) refs.btnEl.className = nextCls;
      if (refs.btnEl.dataset.compartmentState !== compartmentState) {
        refs.btnEl.dataset.compartmentState = compartmentState;
      }
      const canCutStr = canDirectCut ? 'true' : 'false';
      if (refs.btnEl.dataset.canDirectCut !== canCutStr) {
        refs.btnEl.dataset.canDirectCut = canCutStr;
      }
      const pinTitle = isCollapsedLocked
        ? evalRes.disabledReason ?? '残骸结构已坍塌，无法继续切割'
        : !spot.cut && !evalRes.canCut
        ? evalRes.disabledReason ?? ''
        : '';
      if (refs.btnEl.title !== pinTitle) {
        refs.btnEl.title = pinTitle;
      }
      refs.btnEl.setAttribute('aria-pressed', sel === spot.spotId ? 'true' : 'false');
      syncButtonDisabled(
        refs.btnEl,
        Boolean((spot.cut || isCollapsedLocked || isNonLethalBlocked) && cuttingSpotId === null)
      );

      const silState =
        items.length > 0 ? (peek || spot.cut ? 'revealed' : 'masked') : spot.cut ? 'revealed' : 'masked';
      const silKey = `${items[0]?.definitionId ?? 'fuel'}:${silState}`;
      if (refs.silKey !== silKey) {
        refs.silKey = silKey;
        refs.silLayerEl.dataset.silhouetteState = silState;
        if (items.length > 0) {
          refs.silLayerEl.innerHTML = `<img class="v3-wreck-silhouette-img ${
            silState === 'revealed' ? 'is-revealed' : 'is-masked'
          }" src="${getItemImageUrl(items[0].definitionId)}" alt="" draggable="false" />`;
        } else {
          refs.silLayerEl.innerHTML = svgIcon('fuel', 18);
        }
      }

      const tagPrefixKey = `${pos.icon}:${spot.label}`;
      if (refs.tagPrefixKey !== tagPrefixKey) {
        refs.tagPrefixKey = tagPrefixKey;
        refs.tagEl.innerHTML = `${svgIcon(pos.icon, 13)} ${spot.label} · `;
        refs.tagEl.appendChild(refs.badgeEmEl);
      }
      if (refs.badgeEmEl.textContent !== badgeText) {
        refs.badgeEmEl.textContent = badgeText;
      }

      if (refs.btnEl.parentElement !== this.rootEl) {
        this.rootEl!.insertBefore(refs.btnEl, skipAttached ? this.skipBarEl : null);
      }
    });

    // Attach / detach cutting skip bar
    if (cuttingSpotId !== null) {
      if (this.skipBarEl.parentElement !== this.rootEl) {
        this.rootEl.appendChild(this.skipBarEl);
      }
    } else if (this.skipBarEl.parentElement) {
      this.skipBarEl.remove();
    }
  }

  unmount(): void {
    this.rootEl?.removeEventListener('click', this.handleRootClick);
    this.rootEl?.remove();
    this.pins.clear();
    this.hostEl = null;
    this.rootEl = null;
    this.stageTagEl = null;
    this.stageMeterEl = null;
    this.skipBarEl = null;
    this.latestActions = null;
    this.latestCuttingSpotId = null;
    this.lastStageTagKey = null;
    this.lastMeterKey = null;
  }
}

const legacyWreckOverlayViews = new WeakMap<HTMLElement, WreckOverlayPhaseView>();

export function renderWreckHotspotOverlay(
  overlayEl: HTMLElement,
  props: WreckHotspotOverlayProps,
  actions: WreckHotspotOverlayActions
): void {
  let view = legacyWreckOverlayViews.get(overlayEl);
  if (!view) {
    view = new WreckOverlayPhaseView();
    legacyWreckOverlayViews.set(overlayEl, view);
  }
  if (!view.isMountedIn(overlayEl)) {
    view.mount(overlayEl);
  }
  view.update(props, actions);
}

export interface WreckLeftPanelProps {
  readonly run: V2RunState;
  readonly node: V2MapNode;
  readonly profile?: V2ProfileState;
  readonly readOnly: boolean;
  readonly selectedHotspot: WreckHotspotId;
  readonly cuttingSpotId?: WreckHotspotId | null;
}

export interface WreckLeftPanelActions {
  readonly onSelectHotspot: (spot: WreckHotspotId) => void;
  readonly onCutSpot: (spotId: V2WreckSpotId) => void;
  readonly onSkipCut?: () => void;
  readonly onUseGadget?: (instanceId: string) => void;
  readonly onExtract: () => void;
  readonly onAbandon: () => void;
}

interface WreckCardRefs {
  readonly cardEl: HTMLDivElement;
  readonly titleEl: HTMLDivElement;
  readonly statusEl: HTMLSpanElement;
  readonly previewEl: HTMLDivElement;
  readonly riskPillsEl: HTMLDivElement;
  readonly cutBtnEl: HTMLButtonElement;
  titleKey: string;
  riskKey: string;
  btnLabelKey: string;
}

/**
 * Stateful primary multi-cut derelict dissection panel (`[data-testid="wreck-screen"]`):
 * - Preserves keyed hotspot cut cards, cut buttons, extract CTA, and scroll position in-place.
 */
export class WreckPhaseView implements PhaseView<WreckLeftPanelProps, WreckLeftPanelActions> {
  private hostEl: HTMLElement | null = null;
  private rootEl: HTMLDivElement | null = null;
  private abandonBtnEl: HTMLButtonElement | null = null;
  private scrollBodyEl: HTMLDivElement | null = null;

  // Stability card
  private stabilityCardEl: HTMLDivElement | null = null;
  private stabilityValEl: HTMLElement | null = null;
  private alarmLabelEl: HTMLSpanElement | null = null;
  private stabilityTrackEl: HTMLDivElement | null = null;
  private stabilityFillEl: HTMLDivElement | null = null;
  private cutsMadeValEl: HTMLElement | null = null;
  private stagingCountValEl: HTMLElement | null = null;
  private salvagePartsValEl: HTMLElement | null = null;

  // Optional slots
  private stabilizerActiveEl: HTMLDivElement | null = null;
  private gadgetBarEl: HTMLDivElement | null = null;
  private gadgetBtnsWrapEl: HTMLDivElement | null = null;
  private readonly gadgetBtns = new Map<string, HTMLButtonElement>();
  private salvagerIntelEl: HTMLDivElement | null = null;
  private contractBannerEl: HTMLDivElement | null = null;
  private lastCutBannerEl: HTMLDivElement | null = null;
  private lastContractBannerKey: string | null = null;
  private lastCutSummaryKey: string | null = null;

  // Keyed cut cards
  private cutGridEl: HTMLDivElement | null = null;
  private readonly cards = new Map<V2WreckSpotId, WreckCardRefs>();

  // Sticky footer
  private footerEl: HTMLDivElement | null = null;
  private skipPanelBtnEl: HTMLButtonElement | null = null;
  private extractBtnEl: HTMLButtonElement | null = null;
  private extractLabelEl: HTMLSpanElement | null = null;

  private latestActions: WreckLeftPanelActions | null = null;
  private latestBusyCutting = false;

  private readonly handleRootClick = (ev: Event): void => {
    if (!this.rootEl || !this.latestActions) return;
    const target = ev.target as HTMLElement | null;
    if (!target || typeof target.closest !== 'function') return;

    const btn = target.closest('button') as HTMLButtonElement | null;
    if (btn && this.rootEl.contains(btn)) {
      if (btn.disabled) return;
      if (btn === this.abandonBtnEl || btn.id === 'v2-btn-abandon-event') {
        this.latestActions.onAbandon();
        return;
      }
      if (btn === this.extractBtnEl || btn.id === 'v3-btn-wreck-extract') {
        this.latestActions.onExtract();
        return;
      }
      if (btn === this.skipPanelBtnEl || btn.dataset.testid === 'btn-skip-wreck-cut-panel') {
        this.latestActions.onSkipCut?.();
        return;
      }
      const cutSpot = btn.dataset.cutSpot as V2WreckSpotId | undefined;
      if (cutSpot) {
        this.latestActions.onCutSpot(cutSpot);
        return;
      }
      const gadgetId = btn.dataset.useGadget;
      if (gadgetId) {
        this.latestActions.onUseGadget?.(gadgetId);
        return;
      }
      return;
    }

    const card = target.closest('[data-wreck-card]') as HTMLElement | null;
    if (card && this.rootEl.contains(card)) {
      if (this.latestBusyCutting) {
        this.latestActions.onSkipCut?.();
        return;
      }
      const spot = card.dataset.wreckCard as WreckHotspotId | undefined;
      if (spot) {
        this.latestActions.onSelectHotspot(spot);
      }
    }
  };

  isMountedIn(host: HTMLElement): boolean {
    return Boolean(this.hostEl === host && this.rootEl && this.rootEl.parentElement === host);
  }

  getScrollContainer(): HTMLDivElement | null {
    return this.scrollBodyEl;
  }

  mount(host: HTMLElement): void {
    if (this.isMountedIn(host)) return;
    if (this.rootEl || this.hostEl) {
      this.unmount();
    }
    this.hostEl = host;
    host.innerHTML = '';

    const root = document.createElement('div');
    root.className = 'v3-screen-root v3-sticky-panel-root';
    root.dataset.testid = 'wreck-screen';

    // Header
    const header = document.createElement('div');
    header.className = 'panel-header';
    const h2 = document.createElement('h2');
    h2.innerHTML = `${svgIcon('wreck', 16)} 漂流残骸 · 多刀拆解`;
    const abandonBtn = document.createElement('button');
    abandonBtn.type = 'button';
    abandonBtn.className = 'btn btn-sm btn-ghost';
    abandonBtn.id = 'v2-btn-abandon-event';
    abandonBtn.textContent = '放弃并返航';
    header.appendChild(h2);
    header.appendChild(abandonBtn);
    root.appendChild(header);

    // Scroll body
    const scrollBody = document.createElement('div');
    scrollBody.className = 'v3-panel-scroll-body';

    // Stability card
    const stabilityCard = document.createElement('div');
    stabilityCard.className = 'v3-wreck-stability-card';
    stabilityCard.dataset.testid = 'wreck-stability';

    const wsRow = document.createElement('div');
    wsRow.className = 'v3-ws-row';
    const wsLabel = document.createElement('span');
    wsLabel.className = 'v3-ws-label';
    wsLabel.innerHTML = `${svgIcon('cut', 14)} 结构稳定度 `;
    const stabilityVal = document.createElement('strong');
    stabilityVal.className = 'num';
    wsLabel.appendChild(stabilityVal);
    const alarmLabel = document.createElement('span');
    alarmLabel.className = 'v3-ws-alarm';
    wsRow.appendChild(wsLabel);
    wsRow.appendChild(alarmLabel);
    stabilityCard.appendChild(wsRow);

    const stabilityTrack = document.createElement('div');
    stabilityTrack.className = 'v3-stability-track';
    stabilityTrack.setAttribute('role', 'progressbar');
    stabilityTrack.setAttribute('aria-valuemin', '0');
    const stabilityFill = document.createElement('div');
    stabilityFill.className = 'v3-stability-fill';
    stabilityTrack.appendChild(stabilityFill);
    stabilityCard.appendChild(stabilityTrack);

    const wsMeta = document.createElement('div');
    wsMeta.className = 'v3-ws-meta';
    const makeMeta = (prefix: string, suffix: string): HTMLElement => {
      const span = document.createElement('span');
      span.innerHTML = `${prefix}<strong class="num"></strong>${suffix}`;
      wsMeta.appendChild(span);
      return span.querySelector('strong')!;
    };
    this.cutsMadeValEl = makeMeta('已切割 ', ' 刀');
    this.stagingCountValEl = makeMeta('暂存物资 ', ' 件');
    this.salvagePartsValEl = makeMeta('本趟精密零件 ', '');
    stabilityCard.appendChild(wsMeta);
    scrollBody.appendChild(stabilityCard);

    // Optional elements (detached until needed)
    const stabilizerActive = document.createElement('div');
    stabilizerActive.className = 'v3-stabilizer-banner';
    stabilizerActive.dataset.testid = 'wreck-stabilizer-active';
    stabilizerActive.innerHTML = `${svgIcon(
      'shield',
      14
    )} <strong>切割稳定器已启用</strong>：下一次风险切割免疫船体损伤、燃料消耗与伏击警报！`;

    const gadgetBar = document.createElement('div');
    gadgetBar.className = 'v3-gadget-bar';
    gadgetBar.dataset.testid = 'wreck-gadget-bar';
    const gadgetBarLabel = document.createElement('span');
    gadgetBarLabel.className = 'v3-gadget-bar-label';
    gadgetBarLabel.innerHTML = `${svgIcon('shield', 12)} 拆解消耗装置`;
    const gadgetBtnsWrap = document.createElement('div');
    gadgetBtnsWrap.className = 'v3-gadget-bar-btns';
    gadgetBar.appendChild(gadgetBarLabel);
    gadgetBar.appendChild(gadgetBtnsWrap);

    const salvagerIntel = document.createElement('div');
    salvagerIntel.className = 'v3-salvager-intel-bar';
    salvagerIntel.innerHTML = `${crewPortraitSvg(
      'salvager',
      24
    )}<span><strong>打捞师·苏岚</strong> 扫描全透视已激活：以下显示各舱室确切物资、占格与回收估价。</span>`;

    const contractBanner = document.createElement('div');
    contractBanner.className = 'v3-relic-pity-banner';

    const lastCutBanner = document.createElement('div');
    lastCutBanner.className = 'v3-wreck-last-cut';

    const cutGrid = document.createElement('div');
    cutGrid.className = 'v3-wreck-cut-grid';
    scrollBody.appendChild(cutGrid);
    root.appendChild(scrollBody);

    // Sticky Footer
    const footer = document.createElement('div');
    footer.className = 'v3-sticky-cta-footer';

    const skipPanelBtn = document.createElement('button');
    skipPanelBtn.type = 'button';
    skipPanelBtn.className = 'btn btn-secondary v3-wreck-skip-panel-btn';
    skipPanelBtn.dataset.testid = 'btn-skip-wreck-cut-panel';
    skipPanelBtn.innerHTML = `${svgIcon('cut', 14)} 跳过切割动画`;

    const extractBtn = document.createElement('button');
    extractBtn.type = 'button';
    extractBtn.className = 'btn btn-primary btn-launch-hero v3-wreck-extract-btn';
    extractBtn.id = 'v3-btn-wreck-extract';
    extractBtn.dataset.testid = 'btn-wreck-extract';
    extractBtn.dataset.action = 'wreck-extract';
    extractBtn.innerHTML = `${svgIcon('rocket', 15)} `;
    const extractLabel = document.createElement('span');
    extractBtn.appendChild(extractLabel);

    footer.appendChild(extractBtn);
    root.appendChild(footer);

    host.appendChild(root);
    root.addEventListener('click', this.handleRootClick);

    this.rootEl = root;
    this.abandonBtnEl = abandonBtn;
    this.scrollBodyEl = scrollBody;
    this.stabilityCardEl = stabilityCard;
    this.stabilityValEl = stabilityVal;
    this.alarmLabelEl = alarmLabel;
    this.stabilityTrackEl = stabilityTrack;
    this.stabilityFillEl = stabilityFill;
    this.stabilizerActiveEl = stabilizerActive;
    this.gadgetBarEl = gadgetBar;
    this.gadgetBtnsWrapEl = gadgetBtnsWrap;
    this.salvagerIntelEl = salvagerIntel;
    this.contractBannerEl = contractBanner;
    this.lastCutBannerEl = lastCutBanner;
    this.cutGridEl = cutGrid;
    this.footerEl = footer;
    this.skipPanelBtnEl = skipPanelBtn;
    this.extractBtnEl = extractBtn;
    this.extractLabelEl = extractLabel;
  }

  update(props: WreckLeftPanelProps, actions: WreckLeftPanelActions): void {
    this.latestActions = actions;
    if (!this.rootEl || !this.scrollBodyEl || !this.cutGridEl) return;

    const { run, node, profile, readOnly, selectedHotspot, cuttingSpotId = null } = props;
    const wreck = buildActiveWreckStateForNode(run, node, profile).wreck;
    const peek = run.crewId === 'salvager';
    const salvagerT2 = peek && (run.crewMasteryTier ?? 0) >= 2;
    const isBusyCutting = cuttingSpotId !== null;
    this.latestBusyCutting = isBusyCutting;

    if (this.abandonBtnEl) {
      syncButtonDisabled(this.abandonBtnEl, readOnly || isBusyCutting);
      const isFreeBeacon = Boolean(node.isBeacon) || isAtTerminalLayer(run);
      const abandonLabel = isFreeBeacon ? '放弃并返航' : '紧急拖航撤离（-35% 费用）';
      const abandonTitle = isFreeBeacon
        ? '放弃当前残骸并从回收信标免费返航（丢弃本船未整理暂存物资）'
        : '非信标节点放弃残骸将呼叫紧急拖航（扣除 35% 拖航费、无深潜升值，丢弃本船未整理暂存物资）';
      if (this.abandonBtnEl.textContent !== abandonLabel) {
        this.abandonBtnEl.textContent = abandonLabel;
      }
      if (this.abandonBtnEl.title !== abandonTitle) {
        this.abandonBtnEl.title = abandonTitle;
      }
    }

    const pct =
      wreck.maxStability > 0
        ? Math.max(0, Math.min(100, Math.round((wreck.stability / wreck.maxStability) * 100)))
        : 0;
    const toneCls = wreck.collapsed
      ? 'tone-critical'
      : pct >= 70
      ? 'tone-safe'
      : pct >= 35
      ? 'tone-warn'
      : 'tone-critical';
    const alarmLabel = wreck.collapsed
      ? '结构已坍塌 · 剩余舱室封锁，请立即撤离'
      : wreck.cutsMade === 0
      ? '首刀无伤 · 零风险切割'
      : pct >= 35
      ? '警戒状态 · 贪刀将触发结构风险'
      : '临界警报 · 结构极不稳定（贪刀有坍塌风险）';

    if (this.stabilityCardEl) {
      const sCls = `v3-wreck-stability-card ${toneCls}`;
      if (this.stabilityCardEl.className !== sCls) this.stabilityCardEl.className = sCls;
    }
    const stabRatio = `${wreck.stability}/${wreck.maxStability}`;
    if (this.stabilityValEl && this.stabilityValEl.textContent !== stabRatio) {
      this.stabilityValEl.textContent = stabRatio;
    }
    if (this.alarmLabelEl && this.alarmLabelEl.textContent !== alarmLabel) {
      this.alarmLabelEl.textContent = alarmLabel;
    }
    if (this.stabilityTrackEl) {
      this.stabilityTrackEl.setAttribute('aria-valuenow', String(wreck.stability));
      this.stabilityTrackEl.setAttribute('aria-valuemax', String(wreck.maxStability));
    }
    if (this.stabilityFillEl) {
      const fillCls = `v3-stability-fill ${toneCls}`;
      if (this.stabilityFillEl.className !== fillCls) this.stabilityFillEl.className = fillCls;
      const wStr = `${pct}%`;
      if (this.stabilityFillEl.style.width !== wStr) this.stabilityFillEl.style.width = wStr;
    }
    const cutsStr = String(wreck.cutsMade);
    if (this.cutsMadeValEl && this.cutsMadeValEl.textContent !== cutsStr) {
      this.cutsMadeValEl.textContent = cutsStr;
    }
    const stagingStr = String(run.bay.staging.length);
    if (this.stagingCountValEl && this.stagingCountValEl.textContent !== stagingStr) {
      this.stagingCountValEl.textContent = stagingStr;
    }
    const partsStr = `+${run.salvagePartsEarned}`;
    if (this.salvagePartsValEl && this.salvagePartsValEl.textContent !== partsStr) {
      this.salvagePartsValEl.textContent = partsStr;
    }

    // Optional banners inserted cleanly before cutGridEl
    const stabilizerGadgets = run.bay.placed
      .map((p) => ({ item: p.item, def: getV3GadgetDef(p.item.definitionId) }))
      .filter(
        (entry): entry is { item: typeof entry.item; def: NonNullable<typeof entry.def> } =>
          Boolean(entry.def && entry.def.usableIn === 'wreck')
      );

    if (this.stabilizerActiveEl && this.gadgetBarEl && this.gadgetBtnsWrapEl) {
      if (wreck.stabilizerActive) {
        if (this.gadgetBarEl.parentElement) this.gadgetBarEl.remove();
        if (this.stabilizerActiveEl.parentElement !== this.scrollBodyEl) {
          this.scrollBodyEl.insertBefore(this.stabilizerActiveEl, this.cutGridEl);
        }
      } else if (stabilizerGadgets.length > 0 && actions.onUseGadget) {
        if (this.stabilizerActiveEl.parentElement) this.stabilizerActiveEl.remove();
        const nextGadgetIds = new Set<string>(stabilizerGadgets.map((g) => g.item.instanceId));
        for (const [gid, btn] of this.gadgetBtns.entries()) {
          if (!nextGadgetIds.has(gid)) {
            btn.remove();
            this.gadgetBtns.delete(gid);
          }
        }
        stabilizerGadgets.forEach(({ item, def }, idx) => {
          const chk = canUseV3GadgetInRun(run, item.instanceId);
          let btn = this.gadgetBtns.get(item.instanceId);
          if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-sm btn-primary v3-gadget-use-btn';
            btn.dataset.useGadget = item.instanceId;
            btn.dataset.gadgetKind = def.kind;
            btn.dataset.gadgetId = def.kind;
            btn.dataset.testid = `btn-use-gadget-${def.kind}`;
            btn.textContent = `使用${def.buttonLabel}（${def.shortEffectLabel}）`;
            this.gadgetBtns.set(item.instanceId, btn);
          }
          syncButtonDisabled(btn, readOnly || isBusyCutting || !chk.usable);
          const curAtIdx = this.gadgetBtnsWrapEl!.children[idx];
          if (curAtIdx !== btn) {
            this.gadgetBtnsWrapEl!.insertBefore(btn, curAtIdx ?? null);
          }
        });
        if (this.gadgetBarEl.parentElement !== this.scrollBodyEl) {
          this.scrollBodyEl.insertBefore(this.gadgetBarEl, this.cutGridEl);
        }
      } else {
        if (this.stabilizerActiveEl.parentElement) this.stabilizerActiveEl.remove();
        if (this.gadgetBarEl.parentElement) this.gadgetBarEl.remove();
      }
    }

    if (this.salvagerIntelEl) {
      if (peek) {
        if (this.salvagerIntelEl.parentElement !== this.scrollBodyEl) {
          this.scrollBodyEl.insertBefore(this.salvagerIntelEl, this.cutGridEl);
        }
      } else if (this.salvagerIntelEl.parentElement) {
        this.salvagerIntelEl.remove();
      }
    }

    if (this.contractBannerEl) {
      const cType =
        node.contractMarker && (run.contract.type === 'derelict' || run.contract.type === 'transport')
          ? run.contract.type
          : null;
      if (cType) {
        if (this.lastContractBannerKey !== cType) {
          this.lastContractBannerKey = cType;
          this.contractBannerEl.innerHTML =
            cType === 'derelict'
              ? `${svgIcon('star', 13)} 黑匣打捞目标残骸：撤离时将同步回收 1×2 加密黑匣记录仪！`
              : `${svgIcon('star', 13)} 委托目标封存舱：撤离时将同步回收 2×3 密封反应堆（占 6 格）！`;
        }
        if (this.contractBannerEl.parentElement !== this.scrollBodyEl) {
          this.scrollBodyEl.insertBefore(this.contractBannerEl, this.cutGridEl);
        }
      } else {
        this.lastContractBannerKey = null;
        if (this.contractBannerEl.parentElement) this.contractBannerEl.remove();
      }
    }

    if (this.lastCutBannerEl) {
      if (wreck.lastCutSummary) {
        if (this.lastCutSummaryKey !== wreck.lastCutSummary) {
          this.lastCutSummaryKey = wreck.lastCutSummary;
          this.lastCutBannerEl.innerHTML = `${svgIcon('parts', 13)} ${wreck.lastCutSummary}`;
        }
        if (this.lastCutBannerEl.parentElement !== this.scrollBodyEl) {
          this.scrollBodyEl.insertBefore(this.lastCutBannerEl, this.cutGridEl);
        }
      } else {
        this.lastCutSummaryKey = null;
        if (this.lastCutBannerEl.parentElement) this.lastCutBannerEl.remove();
      }
    }

    // Prune removed hotspot cards first
    const nextSpotIds = new Set<V2WreckSpotId>(wreck.hotspots.map((s) => s.spotId));
    for (const [sid, refs] of this.cards.entries()) {
      if (!nextSpotIds.has(sid)) {
        refs.cardEl.remove();
        this.cards.delete(sid);
      }
    }

    // Reconcile keyed hotspot cut cards in order
    wreck.hotspots.forEach((spot, idx) => {
      const evalRes = evaluateWreckHotspotCut(run, wreck, spot.spotId);
      const pos = WRECK_SPOT_COORDS[spot.spotId] ?? { icon: 'wreck' as V2IconName };
      const items = getSpotItems(spot);
      const isSelected = selectedHotspot === spot.spotId;
      const isCuttingThis = cuttingSpotId === spot.spotId;

      let previewLine = '';
      if (items.length > 0 && (peek || spot.cut)) {
        previewLine = items.map(describeItemForSalvager).join(' + ');
      } else if (spot.spotId === 'armory' && node.wreck) {
        previewLine = `未知设备 · ${node.wreck.armorySizeRange} · ${node.wreck.armoryValueRange}`;
      } else if (spot.spotId === 'cargo' && node.wreck) {
        previewLine = `未知货箱 · ${node.wreck.cargoSizeRange} · ${node.wreck.cargoValueRange}`;
      } else if (spot.spotId === 'reactor') {
        const fuelG =
          (spot.reactorFuelGain ?? 0) + (salvagerT2 && (spot.reactorFuelGain ?? 0) > 0 ? 1 : 0);
        const repG =
          (spot.reactorRepairGain ?? 0) +
          (salvagerT2 && (spot.reactorRepairGain ?? 0) > 0 ? 1 : 0);
        const rParts: string[] = [];
        if (fuelG > 0 && repG > 0) {
          if (run.fuel < run.maxFuel) {
            rParts.push(`燃料 +${fuelG}（满油时转为应急抢修 +${repG} HP）`);
          } else {
            rParts.push(`应急抢修 +${repG} HP（当前满油）`);
          }
        } else if (fuelG > 0) {
          rParts.push(`燃料 +${fuelG}`);
        } else if (repG > 0) {
          rParts.push(`应急抢修 +${repG} HP`);
        }
        if ((spot.rewardParts ?? 0) > 0) rParts.push(`精密零件 +${spot.rewardParts}`);
        previewLine = rParts.length > 0 ? rParts.join(' · ') : '拆解反应堆精密构件';
      } else if (spot.spotId === 'vault') {
        previewLine = `密封高价货舱${items.length > 0 ? ` ×${items.length}` : ''} · 高额精密零件`;
      } else if (spot.spotId === 'aux_bay') {
        previewLine = `副舱备用设备${items.length > 0 ? ` ×${items.length}` : ''} · 精密零件`;
      } else {
        previewLine = items.length > 0 ? `封存物资 ×${items.length}` : '精密构件回收';
      }

      const bonusPills: string[] = [];
      if ((spot.rewardParts ?? 0) > 0 && spot.spotId !== 'reactor') {
        bonusPills.push(`+${spot.rewardParts} 精密零件`);
      }
      if ((spot.rewardCredits ?? 0) > 0) {
        bonusPills.push(`+${spot.rewardCredits}¤`);
      }

      let riskHtml = '';
      if (spot.cut) {
        riskHtml = `<span class="v3-risk-pill risk-done">${svgIcon('check', 12)} 舱室已切开</span>`;
      } else if (wreck.collapsed) {
        riskHtml = `<span class="v3-risk-pill risk-lethal">${svgIcon('warning', 12)} 残骸已坍塌 · 舱室封锁</span>`;
      } else if (isCuttingThis) {
        riskHtml = `<span class="v3-risk-pill risk-warn">${svgIcon('cut', 12)} 等离子割枪切割中…</span>`;
      } else if (evalRes.isFirstSafeCut) {
        riskHtml = `<span class="v3-risk-pill risk-safe">${svgIcon('check', 12)} 首刀无伤（0 耐久 / 0 燃料消耗）</span>`;
      } else if (wreck.stabilizerActive) {
        riskHtml = `<span class="v3-risk-pill risk-safe">${svgIcon('check', 12)} 稳定器护航：下刀免伤防伏击防坍塌（0 耐久 / 0 燃料）</span>`;
      } else {
        const pills: string[] = [];
        if (evalRes.isLethal) {
          pills.push(
            `<span class="v3-risk-pill risk-lethal">${svgIcon(
              'warning',
              12
            )} 致命风险：船体不足（需 &gt;${evalRes.effectiveHullDamage} HP，无法切割）</span>`
          );
        } else if (evalRes.effectiveHullDamage > 0) {
          pills.push(
            `<span class="v3-risk-pill risk-hull">${svgIcon('warning', 12)} 船体受损风险 -${
              evalRes.effectiveHullDamage
            } HP</span>`
          );
        }
        if (evalRes.effectiveFuelCost > 0) {
          pills.push(
            `<span class="v3-risk-pill risk-fuel">${svgIcon('fuel', 12)} 燃料消耗 -${
              evalRes.effectiveFuelCost
            }</span>`
          );
        }
        if (evalRes.effectiveAmbushRisk) {
          pills.push(
            `<span class="v3-risk-pill risk-ambush">${svgIcon(
              'warning',
              12
            )} 警报警告：可能触发敌舰伏击</span>`
          );
        }
        if ((evalRes.collapseRiskPct ?? 0) > 0) {
          pills.push(
            `<span class="v3-risk-pill risk-lethal">${svgIcon('warning', 12)} ${
              evalRes.willGuaranteedCollapse
                ? '结构坍塌警告：本刀必坍塌（损失本船未撤离物资）'
                : `结构坍塌风险 ${evalRes.collapseRiskPct}%（损失本船未撤离物资）`
            }</span>`
          );
        }
        if (pills.length === 0) {
          pills.push(
            `<span class="v3-risk-pill risk-warn">贪刀损耗稳定度 -${evalRes.stabilityCost}</span>`
          );
        }
        riskHtml = pills.join('');
      }

      const blockedShortReason = evalRes.disabledReason
        ? evalRes.disabledReason.includes('坍塌')
          ? '结构已坍塌'
          : evalRes.disabledReason.includes('燃料不足')
          ? '燃料不足'
          : evalRes.disabledReason.includes('稳定度归零')
          ? '稳定度归零'
          : evalRes.disabledReason
        : '无法切割';

      const btnLabel = spot.cut
        ? '已切开'
        : isCuttingThis
        ? `${svgIcon('cut', 14)} 等离子切割中…`
        : evalRes.isLethal
        ? `${svgIcon('warning', 14)} 船体不足 · 无法切割`
        : !evalRes.canCut
        ? `${svgIcon('warning', 14)} ${blockedShortReason}`
        : evalRes.isFirstSafeCut
        ? `${svgIcon('cut', 14)} 安全切开${spot.label}`
        : `${svgIcon('cut', 14)} 贪刀切开${spot.label}`;

      let refs = this.cards.get(spot.spotId);
      if (!refs) {
        const cardEl = document.createElement('div');
        cardEl.dataset.wreckCard = spot.spotId;

        const headEl = document.createElement('div');
        headEl.className = 'v3-wcc-head';
        const titleEl = document.createElement('div');
        titleEl.className = 'v3-wcc-title';
        const statusEl = document.createElement('span');
        headEl.appendChild(titleEl);
        headEl.appendChild(statusEl);
        cardEl.appendChild(headEl);

        const previewEl = document.createElement('div');
        previewEl.className = 'v3-wcc-preview';
        cardEl.appendChild(previewEl);

        const riskPillsEl = document.createElement('div');
        riskPillsEl.className = 'v3-risk-pills';
        cardEl.appendChild(riskPillsEl);

        const actionsEl = document.createElement('div');
        actionsEl.className = 'v3-wcc-actions';
        const cutBtnEl = document.createElement('button');
        cutBtnEl.type = 'button';
        cutBtnEl.dataset.cutSpot = spot.spotId;
        cutBtnEl.dataset.testid = `wreck-cut-${spot.spotId}`;
        cutBtnEl.dataset.action = 'wreck-cut';
        actionsEl.appendChild(cutBtnEl);
        cardEl.appendChild(actionsEl);

        refs = {
          cardEl,
          titleEl,
          statusEl,
          previewEl,
          riskPillsEl,
          cutBtnEl,
          titleKey: '',
          riskKey: '',
          btnLabelKey: '',
        };
        this.cards.set(spot.spotId, refs);
      }

      const isCollapsedLocked = Boolean(wreck.collapsed && !spot.cut);
      const cardCls = `v3-wreck-cut-card${isSelected ? ' is-selected' : ''}${
        spot.cut ? ' is-cut' : ''
      }${isCuttingThis ? ' is-cutting' : ''}${
        isCollapsedLocked || evalRes.isLethal ? ' is-lethal' : ''
      }`;
      if (refs.cardEl.className !== cardCls) refs.cardEl.className = cardCls;

      const titleKey = `${pos.icon}:${spot.label}:${bonusPills.join('|')}`;
      if (refs.titleKey !== titleKey) {
        refs.titleKey = titleKey;
        refs.titleEl.innerHTML = `${svgIcon(pos.icon, 15)}<strong>${spot.label}</strong>${
          bonusPills.length > 0 ? `<span class="v3-parts-chip">${bonusPills.join(' · ')}</span>` : ''
        }`;
      }

      const statusTone = spot.cut
        ? 'done'
        : isCuttingThis
        ? 'warn'
        : isCollapsedLocked || evalRes.isLethal
        ? 'lethal'
        : !evalRes.canCut
        ? 'warn'
        : evalRes.isFirstSafeCut
        ? 'safe'
        : 'warn';
      const statusText = spot.cut
        ? '已切开'
        : isCuttingThis
        ? '切割中'
        : isCollapsedLocked
        ? '已坍塌'
        : evalRes.isLethal
        ? '致命风险'
        : !evalRes.canCut
        ? '无法切割'
        : evalRes.isFirstSafeCut
        ? '首刀安全'
        : '贪刀风险';
      const statusCls = `v3-wcc-status ${statusTone}`;
      if (refs.statusEl.className !== statusCls) refs.statusEl.className = statusCls;
      if (refs.statusEl.textContent !== statusText) refs.statusEl.textContent = statusText;

      if (refs.previewEl.textContent !== previewLine) {
        refs.previewEl.textContent = previewLine;
      }

      if (refs.riskKey !== riskHtml) {
        refs.riskKey = riskHtml;
        refs.riskPillsEl.innerHTML = riskHtml;
      }

      const btnTone = spot.cut
        ? 'btn-ghost'
        : evalRes.isLethal
        ? 'btn-danger'
        : evalRes.isFirstSafeCut
        ? 'btn-primary'
        : 'btn-secondary';
      const btnCls = `btn ${btnTone} v3-wreck-cut-btn`;
      if (refs.cutBtnEl.className !== btnCls) refs.cutBtnEl.className = btnCls;
      const cutTitle = evalRes.disabledReason ?? '';
      if (refs.cutBtnEl.title !== cutTitle) refs.cutBtnEl.title = cutTitle;
      syncButtonDisabled(refs.cutBtnEl, readOnly || isBusyCutting || !evalRes.canCut);
      if (refs.btnLabelKey !== btnLabel) {
        refs.btnLabelKey = btnLabel;
        refs.cutBtnEl.innerHTML = btnLabel;
      }

      const curAtIdx = this.cutGridEl!.children[idx];
      if (curAtIdx !== refs.cardEl) {
        this.cutGridEl!.insertBefore(refs.cardEl, curAtIdx ?? null);
      }
    });

    // Sticky Footer
    if (this.footerEl && this.skipPanelBtnEl && this.extractBtnEl && this.extractLabelEl) {
      if (isBusyCutting) {
        if (this.skipPanelBtnEl.parentElement !== this.footerEl) {
          this.footerEl.insertBefore(this.skipPanelBtnEl, this.extractBtnEl);
        }
      } else if (this.skipPanelBtnEl.parentElement) {
        this.skipPanelBtnEl.remove();
      }
      syncButtonDisabled(this.extractBtnEl, readOnly || isBusyCutting);
      const extractText =
        wreck.cutsMade > 0 ? '安全撤离并整理战利品 →' : '暂不切割 · 直接撤离';
      if (this.extractLabelEl.textContent !== extractText) {
        this.extractLabelEl.textContent = extractText;
      }
    }
  }

  unmount(): void {
    this.rootEl?.removeEventListener('click', this.handleRootClick);
    this.rootEl?.remove();
    this.cards.clear();
    this.gadgetBtns.clear();
    this.hostEl = null;
    this.rootEl = null;
    this.abandonBtnEl = null;
    this.scrollBodyEl = null;
    this.stabilityCardEl = null;
    this.stabilityValEl = null;
    this.alarmLabelEl = null;
    this.stabilityTrackEl = null;
    this.stabilityFillEl = null;
    this.cutsMadeValEl = null;
    this.stagingCountValEl = null;
    this.salvagePartsValEl = null;
    this.stabilizerActiveEl = null;
    this.gadgetBarEl = null;
    this.gadgetBtnsWrapEl = null;
    this.salvagerIntelEl = null;
    this.contractBannerEl = null;
    this.lastCutBannerEl = null;
    this.lastContractBannerKey = null;
    this.lastCutSummaryKey = null;
    this.cutGridEl = null;
    this.footerEl = null;
    this.skipPanelBtnEl = null;
    this.extractBtnEl = null;
    this.extractLabelEl = null;
    this.latestActions = null;
    this.latestBusyCutting = false;
  }
}

const legacyWreckLeftViews = new WeakMap<HTMLElement, WreckPhaseView>();

export function renderWreckLeftPanel(
  leftPanelEl: HTMLElement,
  props: WreckLeftPanelProps,
  actions: WreckLeftPanelActions
): void {
  let view = legacyWreckLeftViews.get(leftPanelEl);
  if (!view) {
    view = new WreckPhaseView();
    legacyWreckLeftViews.set(leftPanelEl, view);
  }
  if (!view.isMountedIn(leftPanelEl)) {
    view.mount(leftPanelEl);
  }
  view.update(props, actions);
}
