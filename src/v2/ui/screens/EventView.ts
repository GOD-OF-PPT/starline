import { V2_CREW } from '../../data/crew';
import { getV3SectorDef } from '../../data/sectors';
import { areAllEventOptionsUnaffordable, isAtTerminalLayer } from '../../domain/encounter';
import {
  buildFallbackEventStateFromLegacyNode,
  evaluateV2EventOption,
} from '../../domain/events';
import { getAnyV2ItemDef } from '../../domain/itemCatalog';
import type { V2MapNode, V2RunState } from '../../domain/types';
import { crewPortraitSvg, svgIcon } from '../icons';
import { NODE_TYPE_META, type PhaseView } from './screenTypes';

export interface EventViewProps {
  readonly run: V2RunState;
  readonly node: V2MapNode;
  readonly readOnly: boolean;
}

export interface EventViewActions {
  readonly onSelectEventOption: (optionIndex: number) => void;
  readonly onAnomalyChoice: (choice: 'traverse' | 'breach') => void;
  readonly onDistressChoice: (choice: 'rescue_crew' | 'haul_cargo') => void;
  readonly onAbandon: () => void;
}

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

export class EventPhaseView implements PhaseView<EventViewProps, EventViewActions> {
  private hostEl: HTMLElement | null = null;
  private rootEl: HTMLDivElement | null = null;
  private titleEl: HTMLHeadingElement | null = null;
  private subEl: HTMLSpanElement | null = null;
  private relicBannerEl: HTMLDivElement | null = null;

  // Modern V3 event body
  private modernBodyEl: HTMLDivElement | null = null;
  private narrativePEl: HTMLParagraphElement | null = null;
  private choicesWrapEl: HTMLDivElement | null = null;
  private readonly choiceBtns = new Map<number, HTMLButtonElement>();
  private readonly choiceContentKeys = new Map<number, string>();

  // Legacy anomaly/distress fallback body
  private legacyBodyEl: HTMLDivElement | null = null;
  private lastLegacyKey: string | null = null;

  // Shared abandon footer
  private abandonWrapEl: HTMLDivElement | null = null;
  private abandonMsgEl: HTMLSpanElement | null = null;
  private abandonBtnEl: HTMLButtonElement | null = null;

  private latestActions: EventViewActions | null = null;
  private lastTitleKey: string | null = null;

  private readonly handleRootClick = (ev: Event): void => {
    if (!this.rootEl || !this.latestActions) return;
    const target = ev.target as HTMLElement | null;
    if (!target || typeof target.closest !== 'function') return;
    const btn = target.closest('button') as HTMLButtonElement | null;
    if (!btn || !this.rootEl.contains(btn) || btn.disabled) return;

    if (btn === this.abandonBtnEl || btn.id === 'v2-btn-abandon-event') {
      this.latestActions.onAbandon();
      return;
    }

    const optRaw = btn.dataset.eventOption;
    if (optRaw !== undefined) {
      const idx = Number(optRaw);
      if (Number.isFinite(idx)) {
        this.latestActions.onSelectEventOption(idx);
      }
      return;
    }

    const anomalyOpt = btn.dataset.anomalyOpt as 'traverse' | 'breach' | undefined;
    if (anomalyOpt) {
      this.latestActions.onAnomalyChoice(anomalyOpt);
      return;
    }

    const distressOpt = btn.dataset.distressOpt as 'rescue_crew' | 'haul_cargo' | undefined;
    if (distressOpt) {
      this.latestActions.onDistressChoice(distressOpt);
    }
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

    const root = document.createElement('div');
    root.className = 'v3-screen-root';
    root.dataset.testid = 'event-screen';

    const header = document.createElement('div');
    header.className = 'panel-header';
    const title = document.createElement('h2');
    const sub = document.createElement('span');
    sub.className = 'panel-sub';
    header.appendChild(title);
    header.appendChild(sub);
    root.appendChild(header);

    const relicBanner = document.createElement('div');
    relicBanner.className = 'v3-relic-pity-banner';
    relicBanner.innerHTML = `${svgIcon('museum', 13)} 保底遗物信号源：选择回收货物分支即可获取本星区古代遗物！`;

    // Modern branch container
    const modernBody = document.createElement('div');
    modernBody.style.display = 'contents';
    const narrative = document.createElement('div');
    narrative.className = 'v3-event-narrative';
    const narrativeP = document.createElement('p');
    narrative.appendChild(narrativeP);
    const choicesWrap = document.createElement('div');
    choicesWrap.className = 'v3-event-choices';
    modernBody.appendChild(narrative);
    modernBody.appendChild(choicesWrap);

    // Legacy fallback container
    const legacyBody = document.createElement('div');
    legacyBody.style.display = 'contents';

    // Persistent abandon footer
    const abandonWrap = document.createElement('div');
    const abandonMsg = document.createElement('span');
    const abandonBtn = document.createElement('button');
    abandonBtn.type = 'button';
    abandonBtn.id = 'v2-btn-abandon-event';
    abandonWrap.appendChild(abandonBtn);
    root.appendChild(abandonWrap);

    host.appendChild(root);
    root.addEventListener('click', this.handleRootClick);

    this.rootEl = root;
    this.titleEl = title;
    this.subEl = sub;
    this.relicBannerEl = relicBanner;
    this.modernBodyEl = modernBody;
    this.narrativePEl = narrativeP;
    this.choicesWrapEl = choicesWrap;
    this.legacyBodyEl = legacyBody;
    this.abandonWrapEl = abandonWrap;
    this.abandonMsgEl = abandonMsg;
    this.abandonBtnEl = abandonBtn;
  }

  update(props: EventViewProps, actions: EventViewActions): void {
    this.latestActions = actions;
    if (
      !this.rootEl ||
      !this.titleEl ||
      !this.subEl ||
      !this.relicBannerEl ||
      !this.modernBodyEl ||
      !this.narrativePEl ||
      !this.choicesWrapEl ||
      !this.legacyBodyEl ||
      !this.abandonWrapEl ||
      !this.abandonMsgEl ||
      !this.abandonBtnEl
    ) {
      return;
    }

    const { run, node, readOnly } = props;
    const sector = getV3SectorDef(run.sectorId);
    const activeEvent =
      run.activeEvent && run.activeEvent.nodeId === node.nodeId
        ? run.activeEvent
        : node.eventState ?? buildFallbackEventStateFromLegacyNode(run, node);

    const unaffordable = areAllEventOptionsUnaffordable(run);
    const isFreeBeacon = Boolean(node.isBeacon) || isAtTerminalLayer(run);

    if (activeEvent) {
      // Detach legacy branch first so zero duplicate event-choice-* testids exist
      if (this.legacyBodyEl.parentElement) {
        this.legacyBodyEl.remove();
        this.legacyBodyEl.innerHTML = '';
        this.lastLegacyKey = null;
      }

      const titleKey = `modern:${node.type}:${activeEvent.title}`;
      if (this.lastTitleKey !== titleKey) {
        this.lastTitleKey = titleKey;
        this.titleEl.innerHTML = `${svgIcon(NODE_TYPE_META[node.type].icon, 16)} ${activeEvent.title}`;
      }
      const subText = `${sector.name} · ${activeEvent.flavorTag ?? NODE_TYPE_META[node.type].label}`;
      if (this.subEl.textContent !== subText) {
        this.subEl.textContent = subText;
      }

      if (node.hasRelicSignal) {
        if (this.relicBannerEl.parentElement !== this.rootEl) {
          const anchor =
            this.modernBodyEl.parentElement === this.rootEl
              ? this.modernBodyEl
              : this.abandonWrapEl;
          this.rootEl.insertBefore(this.relicBannerEl, anchor);
        }
      } else if (this.relicBannerEl.parentElement) {
        this.relicBannerEl.remove();
      }

      if (this.modernBodyEl.parentElement !== this.rootEl) {
        this.rootEl.insertBefore(this.modernBodyEl, this.abandonWrapEl);
      }

      if (this.narrativePEl.textContent !== activeEvent.description) {
        this.narrativePEl.textContent = activeEvent.description;
      }

      // Prune removed option indices first
      const nextIndices = new Set<number>(activeEvent.options.map((o) => o.index));
      for (const [idx, btn] of this.choiceBtns.entries()) {
        if (!nextIndices.has(idx)) {
          btn.remove();
          this.choiceBtns.delete(idx);
          this.choiceContentKeys.delete(idx);
        }
      }

      // Reconcile keyed option buttons in order
      activeEvent.options.forEach((opt, pos) => {
        const evalRes = evaluateV2EventOption(run, opt);
        const isCrewOpt = Boolean(opt.requiredCrewId);
        const crewDef = opt.requiredCrewId ? V2_CREW[opt.requiredCrewId] : null;
        const crewMatched = !opt.requiredCrewId || run.crewId === opt.requiredCrewId;
        const isDisabled = readOnly || !evalRes.enabled;

        let btn = this.choiceBtns.get(opt.index);
        if (!btn) {
          btn = document.createElement('button');
          btn.type = 'button';
          btn.dataset.eventOption = String(opt.index);
          btn.dataset.testid = `event-choice-${opt.index}`;
          this.choiceBtns.set(opt.index, btn);
        }

        const baseCls = opt.isFallback
          ? 'v3-event-choice-btn is-fallback'
          : isCrewOpt
          ? `v3-event-choice-btn is-crew-bonus ${crewMatched ? 'is-matched' : 'is-locked'}`
          : 'v3-event-choice-btn';
        const fullCls = `${baseCls}${!evalRes.enabled ? ' is-unaffordable' : ''}`;
        if (btn.className !== fullCls) {
          btn.className = fullCls;
        }
        syncButtonDisabled(btn, isDisabled);

        const contentKey = `${opt.label}|${opt.requiredCrewId ?? ''}|${opt.isFallback ? 1 : 0}|${
          opt.costSummary
        }|${opt.rewardSummary}|${evalRes.enabled ? 1 : 0}|${evalRes.reason ?? ''}`;
        if (this.choiceContentKeys.get(opt.index) !== contentKey) {
          this.choiceContentKeys.set(opt.index, contentKey);
          btn.innerHTML = `
            <div class="v3-ec-btn-head">
              <span class="v3-ec-btn-label">${opt.label}</span>
              ${
                crewDef && opt.requiredCrewId
                  ? `<span class="v3-crew-event-tag">
                      ${crewPortraitSvg(opt.requiredCrewId, 20)}
                      <span>${crewDef.name} · ${crewDef.roleTitle}专属</span>
                    </span>`
                  : opt.isFallback
                  ? `<span class="v3-fallback-tag">安全退路</span>`
                  : ''
              }
            </div>
            <div class="v3-tradeoff-row">
              <span class="v3-cost-pill ${!evalRes.enabled ? 'is-blocked' : ''}">代价：${
            opt.costSummary
          }</span>
              <span class="v3-reward-pill">收益：${opt.rewardSummary}</span>
            </div>
            ${
              !evalRes.enabled && evalRes.reason
                ? `<div class="v3-ec-disabled-reason">${svgIcon('warning', 12)} ${evalRes.reason}</div>`
                : ''
            }
          `;
        }

        const curAtPos = this.choicesWrapEl!.children[pos];
        if (curAtPos !== btn) {
          this.choicesWrapEl!.insertBefore(btn, curAtPos ?? null);
        }
      });

      this.syncAbandonFooter(unaffordable, readOnly, false, isFreeBeacon);
      return;
    }

    // Legacy fallback branch (when neither activeEvent nor eventState exists)
    if (this.modernBodyEl.parentElement) {
      this.modernBodyEl.remove();
    }
    if (this.relicBannerEl.parentElement) {
      this.relicBannerEl.remove();
    }

    const legacyTitleKey = `legacy:${node.layer}:${node.type}`;
    if (this.lastTitleKey !== legacyTitleKey) {
      this.lastTitleKey = legacyTitleKey;
      this.titleEl.innerHTML = `${svgIcon(NODE_TYPE_META[node.type].icon, 16)} 第 ${node.layer} 层 · ${
        NODE_TYPE_META[node.type].label
      }`;
    }
    const legacySubText = `${sector.name} · 星区事件`;
    if (this.subEl.textContent !== legacySubText) {
      this.subEl.textContent = legacySubText;
    }

    if (this.legacyBodyEl.parentElement !== this.rootEl) {
      this.rootEl.insertBefore(this.legacyBodyEl, this.abandonWrapEl);
    }

    const legacyKey = `${node.nodeId}:${node.type}:${run.fuel}:${run.hp}`;
    if (this.lastLegacyKey !== legacyKey) {
      this.lastLegacyKey = legacyKey;
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
              <button type="button" class="btn btn-primary" data-anomaly-opt="traverse" data-testid="event-choice-0">${
                canTraverse ? `耗 ${a.safeFuelCost} 燃料穿越` : '燃料不足'
              }</button>
            </div>
            <div class="v2-event-choice-card">
              <div class="v2-ec-title">${svgIcon('bolt', 15)} 强行破入（扣 ${a.breachHpCost} 耐久）</div>
              <div class="v2-ec-meta">不耗燃料，直接带走 2 件货物（共 ${a.breachCargoItems.reduce(
                (s, c) => s + c.fixedValue,
                0
              )}¤）</div>
              <button type="button" class="btn btn-danger" data-anomaly-opt="breach" data-testid="event-choice-1">${
                canBreach ? `硬闯破入 (-${a.breachHpCost} HP)` : `耐久需 > ${a.breachHpCost}`
              }</button>
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
              <button type="button" class="btn btn-primary" data-distress-opt="rescue_crew" data-testid="event-choice-0">${
                canRescue ? `施救 (-${d.rescueFuelCost} 油 · +${d.repairAmount} HP)` : '燃料不足'
              }</button>
            </div>
            <div class="v2-event-choice-card">
              <div class="v2-ec-title">${svgIcon('crate', 15)} 打捞高价货舱（0 燃料）</div>
              <div class="v2-ec-meta">带走 1 件高价货物（${
                getAnyV2ItemDef(d.haulCargoItem.definitionId)?.name ?? '货物'
              } · ${d.haulCargoItem.fixedValue}¤）</div>
              <button type="button" class="btn btn-secondary" data-distress-opt="haul_cargo" data-testid="event-choice-1">打捞货舱</button>
            </div>
          </div>
        `;
      }
      this.legacyBodyEl.innerHTML = eventBodyHtml;
    }

    // Always patch legacy button disabled flags in-place without wiping DOM
    if (node.type === 'anomaly' && node.anomaly) {
      const tBtn = this.legacyBodyEl.querySelector<HTMLButtonElement>('[data-anomaly-opt="traverse"]');
      const bBtn = this.legacyBodyEl.querySelector<HTMLButtonElement>('[data-anomaly-opt="breach"]');
      if (tBtn) syncButtonDisabled(tBtn, readOnly || run.fuel < node.anomaly.safeFuelCost);
      if (bBtn) syncButtonDisabled(bBtn, readOnly || run.hp <= node.anomaly.breachHpCost);
    } else if (node.type === 'distress' && node.distress) {
      const rBtn = this.legacyBodyEl.querySelector<HTMLButtonElement>('[data-distress-opt="rescue_crew"]');
      const hBtn = this.legacyBodyEl.querySelector<HTMLButtonElement>('[data-distress-opt="haul_cargo"]');
      if (rBtn) syncButtonDisabled(rBtn, readOnly || run.fuel < node.distress.rescueFuelCost);
      if (hBtn) syncButtonDisabled(hBtn, readOnly);
    }

    this.syncAbandonFooter(unaffordable, readOnly, true, isFreeBeacon);
  }

  private syncAbandonFooter(
    unaffordable: boolean,
    readOnly: boolean,
    isLegacy: boolean,
    isFreeBeacon: boolean
  ): void {
    if (!this.abandonWrapEl || !this.abandonMsgEl || !this.abandonBtnEl) return;
    if (unaffordable) {
      this.abandonWrapEl.className = 'system-banner banner-warn';
      this.abandonWrapEl.style.marginTop = isLegacy ? '10px' : '8px';
      this.abandonWrapEl.style.display = '';
      this.abandonWrapEl.style.justifyContent = '';
      const msg = isFreeBeacon
        ? isLegacy
          ? '当前资源不足以支付任何选项，可放弃事件并免费返航。'
          : '当前资源不足以执行任何分支，可放弃事件并免费安全返航。'
        : '当前资源不足以执行任何分支，可放弃事件并呼叫紧急拖航返航（-35% 拖航费）。';
      if (this.abandonMsgEl.textContent !== msg) this.abandonMsgEl.textContent = msg;
      if (this.abandonMsgEl.parentElement !== this.abandonWrapEl) {
        this.abandonWrapEl.insertBefore(this.abandonMsgEl, this.abandonBtnEl);
      }
      if (this.abandonBtnEl.className !== 'btn btn-sm btn-primary') {
        this.abandonBtnEl.className = 'btn btn-sm btn-primary';
      }
      const btnText = isFreeBeacon ? '放弃并安全返航' : '紧急拖航撤离（-35% 费用）';
      if (this.abandonBtnEl.textContent !== btnText) {
        this.abandonBtnEl.textContent = btnText;
      }
    } else {
      this.abandonWrapEl.className = '';
      this.abandonWrapEl.style.marginTop = isLegacy ? '10px' : '8px';
      this.abandonWrapEl.style.display = 'flex';
      this.abandonWrapEl.style.justifyContent = 'flex-end';
      if (this.abandonMsgEl.parentElement) this.abandonMsgEl.remove();
      if (this.abandonBtnEl.className !== 'btn btn-sm btn-ghost') {
        this.abandonBtnEl.className = 'btn btn-sm btn-ghost';
      }
      const btnText = isFreeBeacon ? '放弃事件并免费返航' : '紧急拖航撤离（-35% 费用）';
      if (this.abandonBtnEl.textContent !== btnText) {
        this.abandonBtnEl.textContent = btnText;
      }
    }
    this.abandonBtnEl.title = isFreeBeacon
      ? '当前位于回收信标，可免费安全返航'
      : '非信标节点放弃事件将呼叫紧急拖航（扣除 35% 拖航费、无深潜升值与额外加赏）';
    syncButtonDisabled(this.abandonBtnEl, readOnly);
  }

  unmount(): void {
    this.rootEl?.removeEventListener('click', this.handleRootClick);
    this.rootEl?.remove();
    this.choiceBtns.clear();
    this.choiceContentKeys.clear();
    this.hostEl = null;
    this.rootEl = null;
    this.titleEl = null;
    this.subEl = null;
    this.relicBannerEl = null;
    this.modernBodyEl = null;
    this.narrativePEl = null;
    this.choicesWrapEl = null;
    this.legacyBodyEl = null;
    this.lastLegacyKey = null;
    this.abandonWrapEl = null;
    this.abandonMsgEl = null;
    this.abandonBtnEl = null;
    this.latestActions = null;
    this.lastTitleKey = null;
  }
}

const legacyEventViews = new WeakMap<HTMLElement, EventPhaseView>();

export function renderEventView(
  leftPanelEl: HTMLElement,
  props: EventViewProps,
  actions: EventViewActions
): void {
  let view = legacyEventViews.get(leftPanelEl);
  if (!view) {
    view = new EventPhaseView();
    legacyEventViews.set(leftPanelEl, view);
  }
  if (!view.isMountedIn(leftPanelEl)) {
    view.mount(leftPanelEl);
  }
  view.update(props, actions);
}
