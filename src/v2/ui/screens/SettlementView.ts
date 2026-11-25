import { getItemImageUrl } from '../../../assets/itemArt';
import { soundEngine } from '../../../audio/soundEngine';
import {
  V2_CONTRACT_FAMILY_UNLOCK_ORDER,
  V2_EQUIPMENT_DEFS,
  getV2EquipmentDefByKind,
  type V2UnlockFamilyId,
} from '../../data/equipment';
import { V3_FACTIONS } from '../../data/factions';
import { getV3EndlessMutatorDef } from '../../data/sectors';
import { previewSettlementCampaignOutcomes } from '../../domain/campaign';
import { getDismantleSalvagePartsYield } from '../../domain/dismantle';
import { getEffectiveWarehouseCapacity } from '../../domain/progressionV2';
import {
  V2_DEFEAT_SALVAGE_FLOOR_RATE,
  V2_EMERGENCY_TOW_RETENTION_RATE,
  type V2SettlementSummary,
} from '../../domain/settlementV2';
import type {
  FactionId,
  V2PlacedItem,
  V2ProfileState,
  V2RunState,
  V2SettlementDisposition,
} from '../../domain/types';
import { originTagText } from '../CargoGridV2';
import { svgIcon } from '../icons';
import type { NextBaseGoal, PhaseView } from './screenTypes';

export interface SettlementViewProps {
  readonly run: V2RunState;
  readonly profile: V2ProfileState;
  readonly summary: V2SettlementSummary;
  readonly nextGoal: NextBaseGoal;
  readonly readOnly: boolean;
  /** D07 optional Run-1 / Run-2 chosen equipment family during settlement */
  readonly selectedFamilyUnlock?: V2UnlockFamilyId | null;
}

export interface SettlementViewActions {
  readonly onChangeDisposition: (instanceId: string, disp: V2SettlementDisposition) => void;
  readonly onShowcaseRetry: () => void;
  readonly onShowcaseToBase: () => void;
  readonly onConfirmSettlement: () => void;
  readonly onSkipRollup?: () => void;
  /** D07 optional callback when user picks an equipment family radio option */
  readonly onSelectFamilyUnlock?: (family: V2UnlockFamilyId) => void;
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

function syncInputDisabled(input: HTMLInputElement, disabled: boolean): void {
  if (input.disabled !== disabled) {
    input.disabled = disabled;
  }
  if (disabled) {
    input.setAttribute('disabled', '');
  } else {
    input.removeAttribute('disabled');
  }
}

/**
 * Deterministic, RAF-free sequential settlement bill rollup controller (S09):
 * - Plays staggered `creditTick` SFX as bill rows reveal, ending with a single `cashRegister`.
 * - Instant & 0 timers in `reducedMotion`.
 * - Skippable on click/key/disposition-change with 0 trailing audio or leaked timers.
 */
export class SettlementBillRollupController {
  private timers: ReturnType<typeof globalThis.setTimeout>[] = [];
  private active = false;
  private finalCredits = 0;
  private cashRegisterPlayed = false;
  private stepEls: HTMLElement[] = [];
  private totalEl: HTMLElement | null = null;
  private onCompleteCb: (() => void) | null = null;

  isActive(): boolean {
    return this.active;
  }

  start(
    containerEl: HTMLElement,
    finalCredits: number,
    reducedMotion: boolean,
    opts?: { readonly onComplete?: () => void }
  ): void {
    this.cancel();
    this.finalCredits = Math.max(0, Math.round(finalCredits));
    this.cashRegisterPlayed = false;
    this.onCompleteCb = opts?.onComplete ?? null;
    this.totalEl = containerEl.querySelector<HTMLElement>(
      '[data-testid="settlement-total-credits"]'
    );
    const totalsBox = containerEl.querySelector<HTMLElement>('.v2-settle-totals');
    this.stepEls = totalsBox
      ? Array.from(totalsBox.querySelectorAll<HTMLElement>('[data-bill-step]'))
      : [];

    if (reducedMotion || this.stepEls.length === 0) {
      for (const el of this.stepEls) {
        el.classList.remove('is-rollup-pending');
        el.classList.add('is-rollup-revealed');
      }
      if (this.totalEl) {
        this.totalEl.textContent = `+${this.finalCredits}¤`;
        this.totalEl.dataset.rollupDone = 'true';
      }
      if (this.finalCredits > 0) {
        this.cashRegisterPlayed = true;
        soundEngine.play('cashRegister');
      }
      this.active = false;
      this.onCompleteCb?.();
      this.onCompleteCb = null;
      return;
    }

    this.active = true;
    for (const el of this.stepEls) {
      el.classList.add('is-rollup-pending');
      el.classList.remove('is-rollup-revealed');
    }
    if (this.totalEl) {
      this.totalEl.textContent = '+0¤';
      this.totalEl.dataset.rollupDone = 'false';
    }

    const stepCount = this.stepEls.length;
    const intervalMs = Math.max(55, Math.min(110, Math.floor(620 / Math.max(1, stepCount))));
    let runningCredits = 0;

    this.stepEls.forEach((stepEl, idx) => {
      const delayMs = intervalMs * (idx + 1);
      const stepCredits = Number(stepEl.dataset.stepCredits ?? '0') || 0;
      const tid = globalThis.setTimeout(() => {
        if (!this.active) return;
        stepEl.classList.remove('is-rollup-pending');
        stepEl.classList.add('is-rollup-revealed');
        runningCredits = Math.min(this.finalCredits, runningCredits + Math.max(0, stepCredits));
        if (this.totalEl) {
          this.totalEl.textContent = `+${runningCredits}¤`;
        }
        soundEngine.play('creditTick');
      }, delayMs);
      this.timers.push(tid);
    });

    const finalDelayMs = Math.min(750, intervalMs * (stepCount + 1));
    const finalTid = globalThis.setTimeout(() => {
      if (!this.active) return;
      this.finishRollup(false);
    }, finalDelayMs);
    this.timers.push(finalTid);
  }

  skip(opts?: { readonly silentCashRegister?: boolean }): void {
    if (!this.active) return;
    this.finishRollup(Boolean(opts?.silentCashRegister));
  }

  cancel(): void {
    for (const tid of this.timers) {
      globalThis.clearTimeout(tid);
    }
    this.timers = [];
    this.active = false;
    this.stepEls = [];
    this.totalEl = null;
    this.onCompleteCb = null;
  }

  private finishRollup(silentCashRegister: boolean): void {
    for (const tid of this.timers) {
      globalThis.clearTimeout(tid);
    }
    this.timers = [];
    this.active = false;
    for (const el of this.stepEls) {
      el.classList.remove('is-rollup-pending');
      el.classList.add('is-rollup-revealed');
    }
    if (this.totalEl) {
      this.totalEl.textContent = `+${this.finalCredits}¤`;
      this.totalEl.dataset.rollupDone = 'true';
    }
    if (!silentCashRegister && !this.cashRegisterPlayed && this.finalCredits > 0) {
      this.cashRegisterPlayed = true;
      soundEngine.play('cashRegister');
    }
    const cb = this.onCompleteCb;
    this.onCompleteCb = null;
    cb?.();
  }
}

function dispositionLabel(
  d: V2SettlementDisposition,
  item: V2PlacedItem['item'],
  profile: V2ProfileState,
  shipId: V2RunState['shipId'],
  effectiveSellValue?: number,
  depthBonusCredits?: number
): string {
  switch (d) {
    case 'deliver':
      return '交付委托';
    case 'sell': {
      const sellVal = effectiveSellValue ?? item.fixedValue;
      return (depthBonusCredits ?? 0) > 0
        ? `出售 +${sellVal}¤ (深潜+${depthBonusCredits})`
        : `出售 +${sellVal}¤`;
    }
    case 'dismantle': {
      const parts = getDismantleSalvagePartsYield(item, profile, shipId);
      return `拆解 +${parts} 精密零件`;
    }
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

interface SegOptRefs {
  readonly labelEl: HTMLLabelElement;
  readonly radioEl: HTMLInputElement;
  readonly textEl: HTMLSpanElement;
}

interface DecisionRowRefs {
  readonly rowEl: HTMLDivElement;
  readonly infoEl: HTMLDivElement;
  readonly controlsEl: HTMLDivElement;
  mode: 'none' | 'two' | 'seg';
  // 2-option persistent elements
  currentChoiceEl?: HTMLSpanElement;
  toggleBtnEl?: HTMLButtonElement;
  // 3+-option segmented radio persistent elements
  segGroupEl?: HTMLDivElement;
  segOpts?: Map<V2SettlementDisposition, SegOptRefs>;
  lockHintEl?: HTMLSpanElement;
  infoKey: string;
}

export class SettlementPhaseView
  implements PhaseView<SettlementViewProps, SettlementViewActions>
{
  private hostEl: HTMLElement | null = null;
  private rootEl: HTMLDivElement | null = null;
  private titleEl: HTMLHeadingElement | null = null;
  private subEl: HTMLSpanElement | null = null;
  private scrollBodyEl: HTMLDivElement | null = null;

  private endlessBannerEl: HTMLDivElement | null = null;
  private lastEndlessKey: string | null = null;

  private statusBannerEl: HTMLDivElement | null = null;
  private lastStatusBannerKey: string | null = null;

  private totalsEl: HTMLDivElement | null = null;
  private lastTotalsKey: string | null = null;

  private goalHintEl: HTMLDivElement | null = null;
  private lastGoalHintKey: string | null = null;
  private campaignCardEl: HTMLDivElement | null = null;
  private lastCampaignCardKey: string | null = null;

  // D07 persistent 0-<button> radiogroup for Run-1 / Run-2 family unlock (S09 safe!)
  private familyUnlockSectionEl: HTMLDivElement | null = null;
  private familyUnlockGroupEl: HTMLDivElement | null = null;
  private readonly familyUnlockOpts = new Map<
    V2UnlockFamilyId,
    {
      readonly labelEl: HTMLLabelElement;
      readonly radioEl: HTMLInputElement;
      readonly bodyEl: HTMLDivElement;
    }
  >();
  private latestSelectedFamilyUnlock: V2UnlockFamilyId | null = null;
  private lastFamilyUnlockKey: string | null = null;

  private itemsSectionEl: HTMLDivElement | null = null;
  private emptyHintEl: HTMLDivElement | null = null;
  private decisionRowsWrapEl: HTMLDivElement | null = null;
  private readonly decisionRows = new Map<string, DecisionRowRefs>();

  private autoResolvedEl: HTMLDivElement | null = null;
  private lastAutoResolvedKey: string | null = null;

  // Persistent <details> so user-expanded loan summary stays open across updates!
  private loanDetailsEl: HTMLDetailsElement | null = null;
  private loanCountTextEl: HTMLSpanElement | null = null;
  private loanChipsWrapEl: HTMLDivElement | null = null;
  private lastLoanChipsKey: string | null = null;

  // Sticky footer
  private footerEl: HTMLDivElement | null = null;
  private overflowBannerEl: HTMLDivElement | null = null;
  private showcaseActionsEl: HTMLDivElement | null = null;
  private showcaseRetryBtnEl: HTMLButtonElement | null = null;
  private showcaseToBaseBtnEl: HTMLButtonElement | null = null;
  private confirmBtnEl: HTMLButtonElement | null = null;
  private lastConfirmLabelKey: string | null = null;

  private latestActions: SettlementViewActions | null = null;
  private latestReadOnly = false;
  private readonly selectedByItem = new Map<string, V2SettlementDisposition>();
  private updateRevision = 0;
  private clickDedupSeq = 0;
  private pendingClickDedup: {
    readonly itemId: string;
    readonly disp: V2SettlementDisposition;
    suppressInputClick: boolean;
    suppressChange: boolean;
    uncommitted: boolean;
    readonly token: number;
  } | null = null;
  private lastTitleKey: string | null = null;

  private syncRadiogroupChecked(
    itemId: string,
    selectedDisp: V2SettlementDisposition | undefined
  ): void {
    const refs = this.decisionRows.get(itemId);
    if (!refs || refs.mode !== 'seg' || !refs.segOpts) return;
    for (const [d, optRefs] of refs.segOpts.entries()) {
      const checked = d === selectedDisp;
      if (optRefs.radioEl.checked !== checked) {
        optRefs.radioEl.checked = checked;
      }
      if (checked) {
        optRefs.radioEl.setAttribute('checked', '');
      } else {
        optRefs.radioEl.removeAttribute('checked');
      }
    }
  }

  private armClickDedup(
    itemId: string,
    disp: V2SettlementDisposition,
    suppressInputClick: boolean
  ): void {
    const token = ++this.clickDedupSeq;
    this.pendingClickDedup = {
      itemId,
      disp,
      suppressInputClick,
      suppressChange: true,
      uncommitted: false,
      token,
    };
    Promise.resolve().then(() => {
      if (this.pendingClickDedup?.token === token) {
        this.pendingClickDedup = null;
      }
    });
  }

  private readonly handleRootClick = (ev: Event): void => {
    if (!this.rootEl || !this.latestActions) return;
    const target = ev.target as HTMLElement | null;
    if (!target || typeof target.closest !== 'function') return;

    const actions = this.latestActions;

    // 1. Clicking bill totals skips active rollup
    if (this.totalsEl && target.closest('.v2-settle-totals') === this.totalsEl) {
      actions.onSkipRollup?.();
      return;
    }

    // 2. Footer CTAs
    const btn = target.closest('button') as HTMLButtonElement | null;
    if (btn && this.rootEl.contains(btn)) {
      if (btn.id === 'v2-btn-confirm-settle') {
        if (!btn.disabled) actions.onConfirmSettlement();
        return;
      }
      if (btn.id === 'v2-showcase-retry') {
        if (!btn.disabled) actions.onShowcaseRetry();
        return;
      }
      if (btn.id === 'v2-showcase-to-base') {
        if (!btn.disabled) actions.onShowcaseToBase();
        return;
      }
    }

    // 2b. D07 Family unlock 0-<button> radiogroup controls
    const famCtrl = target.closest('label[data-family-unlock]') as HTMLLabelElement | null;
    if (famCtrl && this.rootEl.contains(famCtrl)) {
      if (this.latestReadOnly) return;
      const fam = famCtrl.dataset.familyUnlock as V2UnlockFamilyId | undefined;
      if (!fam) return;
      const famRadio = famCtrl.querySelector<HTMLInputElement>('input[data-family-radio]');
      if (famRadio?.disabled) return;
      const isDirectFamRadio = Boolean(famRadio && target === famRadio);
      if (!isDirectFamRadio) {
        ev.preventDefault();
      }
      if (this.latestSelectedFamilyUnlock === fam) return;
      this.latestSelectedFamilyUnlock = fam;
      for (const [fKey, fRefs] of this.familyUnlockOpts.entries()) {
        const isSel = fKey === fam;
        fRefs.labelEl.classList.toggle('is-selected', isSel);
        fRefs.radioEl.checked = isSel;
        if (isSel) fRefs.radioEl.setAttribute('checked', '');
        else fRefs.radioEl.removeAttribute('checked');
      }
      actions.onSelectFamilyUnlock?.(fam);
      return;
    }

    // 3. Disposition controls (2-option <button> or 3+-option <label> segmented radio)
    const ctrl = target.closest(
      'button[data-settle-item], label[data-settle-item]'
    ) as HTMLElement | null;
    if (!ctrl || !this.rootEl.contains(ctrl)) return;
    if (this.latestReadOnly) return;
    if (ctrl.tagName.toLowerCase() === 'button' && (ctrl as HTMLButtonElement).disabled) return;

    const iid = ctrl.dataset.settleItem;
    const disp = ctrl.dataset.settleDisp as V2SettlementDisposition | undefined;
    if (!iid || !disp) return;

    const isLabel = ctrl.tagName.toLowerCase() === 'label';
    const radio = isLabel
      ? ctrl.querySelector<HTMLInputElement>('input[data-settle-radio]')
      : null;
    const isDirectRadioClick = Boolean(radio && target === radio);

    if (isLabel && radio?.disabled) return;

    // Suppress synthetic forwarded <input> click triggered right after a <label> click in the same tick.
    // If the prior <label> click was uncommitted (e.g. rejected by !canMutate() so radio.checked was
    // reverted to false), a genuine same-tick direct radio.click() arrives with radio.checked === true
    // (native HTML5 pre-activation) and MUST NOT be swallowed, while synthetic forwarded clicks with
    // radio.checked === false remain deduplicated.
    if (
      isDirectRadioClick &&
      this.pendingClickDedup &&
      this.pendingClickDedup.itemId === iid &&
      this.pendingClickDedup.disp === disp &&
      this.pendingClickDedup.suppressInputClick &&
      (!this.pendingClickDedup.uncommitted || !radio?.checked)
    ) {
      this.pendingClickDedup.suppressInputClick = false;
      return;
    }

    // CRITICAL: Only call preventDefault() when clicking <label>/<span> (target !== radio).
    // Calling preventDefault() on direct <input type="radio"> activation (ArrowRight/ArrowLeft,
    // radio.click(), assistive tech) triggers HTML5 canceled-activation revert in browsers!
    if (isLabel && !isDirectRadioClick) {
      ev.preventDefault();
    }

    const prevDisp = this.selectedByItem.get(iid);
    if (prevDisp === disp) return;

    if (isLabel && !isDirectRadioClick && radio) {
      radio.checked = true;
      radio.setAttribute('checked', '');
    }

    const revBefore = this.updateRevision;
    if (isLabel) {
      this.armClickDedup(iid, disp, !isDirectRadioClick);
    }

    let threw = false;
    try {
      actions.onChangeDisposition(iid, disp);
    } catch (err) {
      threw = true;
      throw err;
    } finally {
      // If the controller rejected the mutation (e.g. !canMutate() while a modal is open)
      // or threw before calling update(), restore radio checked DOM to authoritative prevDisp
      // while keeping selectedByItem unpoisoned.
      if (this.updateRevision === revBefore && isLabel) {
        if (threw || isDirectRadioClick) {
          this.pendingClickDedup = null;
        } else if (
          this.pendingClickDedup &&
          this.pendingClickDedup.itemId === iid &&
          this.pendingClickDedup.disp === disp
        ) {
          this.pendingClickDedup.uncommitted = true;
        }
        this.syncRadiogroupChecked(iid, prevDisp);
      }
    }
  };

  private readonly handleRootChange = (ev: Event): void => {
    if (!this.rootEl || !this.latestActions || this.latestReadOnly) return;
    const target = ev.target as HTMLElement | null;
    if (!target || typeof target.closest !== 'function') return;

    const famInput = target.closest('input[data-family-radio]') as HTMLInputElement | null;
    if (famInput && this.rootEl.contains(famInput) && !famInput.disabled && famInput.checked) {
      const fam = famInput.value as V2UnlockFamilyId | undefined;
      if (fam && fam !== this.latestSelectedFamilyUnlock) {
        this.latestSelectedFamilyUnlock = fam;
        for (const [fKey, fRefs] of this.familyUnlockOpts.entries()) {
          const isSel = fKey === fam;
          fRefs.labelEl.classList.toggle('is-selected', isSel);
          fRefs.radioEl.checked = isSel;
          if (isSel) fRefs.radioEl.setAttribute('checked', '');
          else fRefs.radioEl.removeAttribute('checked');
        }
        this.latestActions.onSelectFamilyUnlock?.(fam);
      }
      return;
    }

    const input = target.closest('input[data-settle-radio]') as HTMLInputElement | null;
    if (!input || !this.rootEl.contains(input) || input.disabled || !input.checked) return;
    const iid = input.dataset.settleItem;
    const disp = input.dataset.settleDisp as V2SettlementDisposition | undefined;
    if (!iid || !disp) return;

    if (
      this.pendingClickDedup &&
      this.pendingClickDedup.itemId === iid &&
      this.pendingClickDedup.disp === disp &&
      this.pendingClickDedup.suppressChange
    ) {
      const wasUncommitted = this.pendingClickDedup.uncommitted;
      this.pendingClickDedup.suppressChange = false;
      if (wasUncommitted) {
        this.syncRadiogroupChecked(iid, this.selectedByItem.get(iid));
      }
      return;
    }

    const prevDisp = this.selectedByItem.get(iid);
    if (prevDisp === disp) return;

    const revBefore = this.updateRevision;
    try {
      this.latestActions.onChangeDisposition(iid, disp);
    } finally {
      if (this.updateRevision === revBefore) {
        this.pendingClickDedup = null;
        this.syncRadiogroupChecked(iid, prevDisp);
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
    root.dataset.testid = 'settlement-screen';

    // Header
    const header = document.createElement('div');
    header.className = 'panel-header';
    const title = document.createElement('h2');
    const sub = document.createElement('span');
    sub.className = 'panel-sub';
    header.appendChild(title);
    header.appendChild(sub);
    root.appendChild(header);

    // Persistent Scroll Body
    const scrollBody = document.createElement('div');
    scrollBody.className = 'v3-panel-scroll-body';

    const endlessBanner = document.createElement('div');
    endlessBanner.className = 'v3-endless-hud-banner';
    endlessBanner.dataset.testid = 'settlement-endless-banner';

    const statusBanner = document.createElement('div');
    scrollBody.appendChild(statusBanner);

    const totals = document.createElement('div');
    totals.className = 'v2-settle-totals';
    scrollBody.appendChild(totals);

    const goalHint = document.createElement('div');
    const campaignCard = document.createElement('div');
    campaignCard.className = 'v3-settle-campaign-card';

    // D07 persistent 3-pick-1 family unlock section (0 <button> elements; detached when empty!)
    const familyUnlockSection = document.createElement('div');
    familyUnlockSection.className = 'v3-settle-family-unlock';
    familyUnlockSection.dataset.testid = 'settlement-family-unlock';
    const famHead = document.createElement('div');
    famHead.className = 'v3-family-unlock-head';
    famHead.innerHTML = `${svgIcon('star', 14)} <strong>选择解锁新装备体系（含免费蓝图 + 首件赠品）</strong><small>可在此直接勾选，也可稍后回基地再选</small>`;
    const famGroup = document.createElement('div');
    famGroup.className = 'v3-family-unlock-group';
    famGroup.setAttribute('role', 'radiogroup');
    famGroup.setAttribute('aria-label', '选择解锁装备体系');
    familyUnlockSection.appendChild(famHead);
    familyUnlockSection.appendChild(famGroup);

    // Items Section
    const itemsSection = document.createElement('div');
    itemsSection.className = 'v2-settle-items';
    const itemsLbl = document.createElement('div');
    itemsLbl.className = 'v2-prep-label';
    itemsLbl.textContent = '战利品清点清单';
    itemsSection.appendChild(itemsLbl);

    const emptyHint = document.createElement('div');
    emptyHint.className = 'v2-empty-inline';
    emptyHint.textContent = '本次船舱为空。';

    const decisionRowsWrap = document.createElement('div');
    decisionRowsWrap.style.display = 'contents';

    const autoResolved = document.createElement('div');
    autoResolved.className = 'v3-auto-resolved-list';
    autoResolved.dataset.testid = 'settlement-auto-resolved';

    // Persistent <details> for loan summary (never loses open state!)
    const loanDetails = document.createElement('details');
    loanDetails.className = 'v3-loan-summary-collapse';
    loanDetails.dataset.testid = 'settlement-loan-summary';
    const loanSummary = document.createElement('summary');
    const loanBadge = document.createElement('span');
    loanBadge.className = 'v2-origin-badge origin-loan';
    loanBadge.textContent = '借';
    const loanCountText = document.createElement('span');
    const loanHint = document.createElement('small');
    loanHint.className = 'v3-loan-summary-hint';
    loanHint.textContent = '点击展开明细';
    loanSummary.appendChild(loanBadge);
    loanSummary.appendChild(loanCountText);
    loanSummary.appendChild(loanHint);
    const loanChipsWrap = document.createElement('div');
    loanChipsWrap.className = 'v3-loan-summary-chips';
    loanDetails.appendChild(loanSummary);
    loanDetails.appendChild(loanChipsWrap);

    scrollBody.appendChild(itemsSection);
    root.appendChild(scrollBody);

    // Sticky Footer
    const footer = document.createElement('div');
    footer.className = 'v3-sticky-cta-footer';

    const overflowBanner = document.createElement('div');
    overflowBanner.className = 'system-banner banner-danger';

    const showcaseActions = document.createElement('div');
    showcaseActions.className = 'v2-showcase-finish-actions';
    const showcaseRetryBtn = document.createElement('button');
    showcaseRetryBtn.type = 'button';
    showcaseRetryBtn.className = 'btn btn-secondary';
    showcaseRetryBtn.id = 'v2-showcase-retry';
    showcaseRetryBtn.innerHTML = `${svgIcon('bolt', 14)} 换套流派再试一次`;
    const showcaseToBaseBtn = document.createElement('button');
    showcaseToBaseBtn.type = 'button';
    showcaseToBaseBtn.className = 'btn btn-primary btn-launch-hero';
    showcaseToBaseBtn.id = 'v2-showcase-to-base';
    showcaseToBaseBtn.innerHTML = `${svgIcon('rocket', 15)} 进入正式星港基地`;
    showcaseActions.appendChild(showcaseRetryBtn);
    showcaseActions.appendChild(showcaseToBaseBtn);

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'btn btn-primary btn-launch-hero';
    confirmBtn.id = 'v2-btn-confirm-settle';
    confirmBtn.dataset.testid = 'btn-confirm-settlement';
    confirmBtn.dataset.action = 'confirm-settlement';

    root.appendChild(footer);
    host.appendChild(root);

    root.addEventListener('click', this.handleRootClick);
    root.addEventListener('change', this.handleRootChange);

    this.rootEl = root;
    this.titleEl = title;
    this.subEl = sub;
    this.scrollBodyEl = scrollBody;
    this.endlessBannerEl = endlessBanner;
    this.statusBannerEl = statusBanner;
    this.totalsEl = totals;
    this.goalHintEl = goalHint;
    this.campaignCardEl = campaignCard;
    this.familyUnlockSectionEl = familyUnlockSection;
    this.familyUnlockGroupEl = famGroup;
    this.itemsSectionEl = itemsSection;
    this.emptyHintEl = emptyHint;
    this.decisionRowsWrapEl = decisionRowsWrap;
    this.autoResolvedEl = autoResolved;
    this.loanDetailsEl = loanDetails;
    this.loanCountTextEl = loanCountText;
    this.loanChipsWrapEl = loanChipsWrap;
    this.footerEl = footer;
    this.overflowBannerEl = overflowBanner;
    this.showcaseActionsEl = showcaseActions;
    this.showcaseRetryBtnEl = showcaseRetryBtn;
    this.showcaseToBaseBtnEl = showcaseToBaseBtn;
    this.confirmBtnEl = confirmBtn;
  }

  update(props: SettlementViewProps, actions: SettlementViewActions): void {
    this.latestActions = actions;
    if (
      !this.rootEl ||
      !this.titleEl ||
      !this.subEl ||
      !this.scrollBodyEl ||
      !this.statusBannerEl ||
      !this.totalsEl ||
      !this.itemsSectionEl ||
      !this.footerEl
    ) {
      return;
    }

    const {
      run,
      profile: p,
      summary,
      nextGoal,
      readOnly,
      selectedFamilyUnlock = null,
    } = props;
    this.latestReadOnly = readOnly;
    this.latestSelectedFamilyUnlock = selectedFamilyUnlock;

    const isSafe = summary.reason === 'safe_return';
    const isEmergencyTow = isSafe && Boolean(summary.emergencyTowUsed);
    const defeatPct = Math.round(V2_DEFEAT_SALVAGE_FLOOR_RATE * 100);
    const towPenaltyPct = Math.round((1 - V2_EMERGENCY_TOW_RETENTION_RATE) * 100);
    const warehouseCap = getEffectiveWarehouseCapacity(p);

    // Sync authoritative selectedByItem map from props
    this.updateRevision += 1;
    this.selectedByItem.clear();
    for (const line of summary.lines) {
      this.selectedByItem.set(line.item.instanceId, line.selectedDisposition);
    }

    // S09 3-bucket partition
    const decisionLines = summary.lines.filter((l) => l.allowedDispositions.length > 1);
    const autoNonLoanLines = summary.lines.filter(
      (l) => l.allowedDispositions.length <= 1 && l.item.origin !== 'loan'
    );
    const loanLines = summary.lines.filter(
      (l) => l.allowedDispositions.length <= 1 && l.item.origin === 'loan'
    );

    // Header
    const titleKey = run.isShowcase
      ? 'showcase'
      : isEmergencyTow
      ? 'tow'
      : isSafe
      ? 'safe'
      : 'defeat';
    if (this.lastTitleKey !== titleKey) {
      this.lastTitleKey = titleKey;
      this.titleEl.innerHTML = `${svgIcon('beacon', 16)} ${
        run.isShowcase
          ? '4 站精华试玩结算'
          : isEmergencyTow
          ? '紧急拖航返航清点'
          : isSafe
          ? '安全返航清点'
          : '战败 · 紧急拖回结算'
      }`;
    }
    const subText = run.isShowcase
      ? '独立试玩 · 不影响正式存档'
      : decisionLines.length > 0
      ? `仅 ${decisionLines.length} 件需选择去向`
      : '全部物资已自动清点完毕';
    if (this.subEl.textContent !== subText) this.subEl.textContent = subText;

    // Endless banner
    if (this.endlessBannerEl) {
      if ((run.endlessThreat ?? 0) >= 1) {
        const eKey = `${run.endlessThreat}:${run.seed}:${(run.endlessMutatorIds ?? []).join(',')}`;
        if (this.lastEndlessKey !== eKey) {
          this.lastEndlessKey = eKey;
          this.endlessBannerEl.innerHTML = `
            <div class="v3-endless-hud-head">
              <span>${svgIcon('bolt', 13)} 无尽深渊 · 威压 ${run.endlessThreat} 远征清点</span>
              <span class="num">种子 #${run.seed}</span>
            </div>
            ${
              run.endlessMutatorIds && run.endlessMutatorIds.length > 0
                ? `<div class="v3-endless-mut-chips">
                    ${run.endlessMutatorIds
                      .map((mid) => {
                        const def = getV3EndlessMutatorDef(mid);
                        return `<span class="v3-endless-mut-chip">词条 · ${def?.name ?? mid}</span>`;
                      })
                      .join('')}
                  </div>`
                : ''
            }
          `;
        }
        if (this.endlessBannerEl.parentElement !== this.scrollBodyEl) {
          this.scrollBodyEl.insertBefore(this.endlessBannerEl, this.statusBannerEl);
        }
      } else {
        this.lastEndlessKey = null;
        if (this.endlessBannerEl.parentElement) this.endlessBannerEl.remove();
      }
    }

    // Status banner
    const statusKey = isSafe
      ? `safe:${isEmergencyTow ? 1 : 0}:${towPenaltyPct}:${summary.contractCompleted ? 1 : 0}:${
          run.isTutorial ? 1 : 0
        }:${run.contract.type}:${run.contract.name}`
      : `defeat:${defeatPct}:${summary.lostOwnedCount}:${summary.lostLootCount}`;
    if (this.lastStatusBannerKey !== statusKey) {
      this.lastStatusBannerKey = statusKey;
      if (isSafe) {
        this.statusBannerEl.className = isEmergencyTow
          ? 'system-banner banner-warn'
          : `v2-settle-banner${summary.contractCompleted ? ' ok' : ''}`;
        this.statusBannerEl.style.marginBottom = isEmergencyTow ? '4px' : '';
        if (isEmergencyTow) {
          this.statusBannerEl.innerHTML = `<strong>非信标紧急拖航返航（扣除 ${towPenaltyPct}% 拖航费 · 无深潜升值与额外目标加赏；自有装备安全入库）</strong>`;
        } else {
          this.statusBannerEl.innerHTML = `<strong>${
            summary.contractCompleted
              ? run.isTutorial
                ? '首航教学交付成功！免费启用工作台并获得额外悬赏'
                : `委托「${run.contract.name}」交付完成！`
              : run.contract.type === 'free'
              ? '自由打捞安全返航'
              : `委托「${run.contract.name}」未完成（无信用点罚金）`
          }</strong>`;
        }
      } else {
        this.statusBannerEl.className = 'system-banner banner-danger';
        this.statusBannerEl.style.marginBottom = '4px';
        this.statusBannerEl.textContent = `舰体损毁由拖船拖回。按规则折算 ${defeatPct}% 回收，本次带出的 ${summary.lostOwnedCount} 件自有设备与 ${summary.lostLootCount} 件拾获物已损失；基地仓库原有库存不受影响。`;
      }
    }

    // Bill totals — SKIP rewriting when totalsKey unchanged so active SettlementBillRollupController DOM refs survive!
    const factionRepEntries = Object.entries(summary.factionRepGains ?? {}).filter(
      ([, val]) => typeof val === 'number' && val > 0
    ) as [FactionId, number][];
    const factionRepKey = factionRepEntries.map(([fid, d]) => `${fid}:${d}`).join(',');
    const totalsKey = [
      run.runId,
      isSafe ? 1 : 0,
      isEmergencyTow ? 1 : 0,
      run.isShowcase ? 1 : 0,
      run.isTutorial ? 1 : 0,
      summary.walletCredits,
      summary.soldItemsCredits,
      summary.extractionDepth ?? 0,
      summary.depthAppreciationCredits ?? 0,
      summary.emergencyTowFeeCredits ?? 0,
      summary.crewMasteryBonusCredits ?? 0,
      summary.contractRewardCredits,
      summary.bonusObjective?.label ?? '',
      summary.bonusObjective?.completed ? 1 : 0,
      summary.contractCompleted ? 1 : 0,
      summary.bonusObjectiveCredits,
      summary.factionContractBonusCredits ?? 0,
      summary.tutorialBonusCredits,
      summary.totalSalvagePartsEarned,
      summary.dismantledPartsEarned,
      summary.defeatRecoverableBase,
      defeatPct,
      summary.warehouseProjectedCount,
      warehouseCap,
      summary.warehouseOverflow ? 1 : 0,
      summary.finalCreditsEarned,
      factionRepKey,
    ].join('|');

    if (this.lastTotalsKey !== totalsKey) {
      this.lastTotalsKey = totalsKey;
      let stepIdx = 0;
      const nextStepAttr = (credits: number) =>
        `data-bill-step="${stepIdx++}" data-step-credits="${Math.max(0, Math.round(credits))}"`;

      const bonusRowHtml =
        isSafe && summary.bonusObjective && !run.isTutorial
          ? summary.bonusObjective.completed && summary.contractCompleted
            ? `<div class="v2-mig-row v3-bonus-row is-done" ${nextStepAttr(
                summary.bonusObjectiveCredits
              )}><span>额外目标（已达成 · ${summary.bonusObjective.label}）</span><strong class="num">+${
                summary.bonusObjectiveCredits
              }¤ 加赏</strong></div>`
            : `<div class="v2-mig-row v3-bonus-row is-missed"><span>额外目标（未达成 · ${summary.bonusObjective.label}）</span><strong class="num">+0¤</strong></div>`
          : '';

      const factionRepRowsHtml =
        factionRepEntries.length > 0
          ? factionRepEntries
              .map(
                ([fid, delta]) =>
                  `<div class="v2-mig-row v3-faction-rep-row" ${nextStepAttr(0)}><span>${svgIcon(
                    'faction',
                    12
                  )} ${V3_FACTIONS[fid]?.name ?? fid} 声望</span><strong class="num">+${delta}</strong></div>`
              )
              .join('')
          : '';

      const partsRowHtml =
        summary.totalSalvagePartsEarned > 0
          ? `<div class="v2-mig-row v3-parts-row" ${nextStepAttr(0)}><span>${svgIcon(
              'parts',
              12
            )} 精密零件入账${
              summary.dismantledPartsEarned > 0
                ? `（含现场分解 +${summary.dismantledPartsEarned}）`
                : ''
            }</span><strong class="num">+${summary.totalSalvagePartsEarned} 精密零件</strong></div>`
          : '';

      this.totalsEl.innerHTML = `
        <div class="v2-mig-row" ${nextStepAttr(
          summary.walletCredits
        )}><span>航行钱包结余</span><strong class="num">${summary.walletCredits}¤</strong></div>
        ${
          isSafe
            ? `
              <div class="v2-mig-row" ${nextStepAttr(
                summary.soldItemsCredits
              )}><span>出售物品收益</span><strong class="num">+${summary.soldItemsCredits}¤</strong></div>
              ${
                (summary.depthAppreciationCredits ?? 0) > 0
                  ? `<div class="v2-mig-row v3-depth-bonus-row" ${nextStepAttr(
                      summary.depthAppreciationCredits ?? 0
                    )}><span>深潜携带升值（第 L${summary.extractionDepth ?? 1} 层信标返航）</span><strong class="num">+${
                      summary.depthAppreciationCredits
                    }¤</strong></div>`
                  : ''
              }
              ${
                (summary.crewMasteryBonusCredits ?? 0) > 0
                  ? `<div class="v2-mig-row" ${nextStepAttr(
                      summary.crewMasteryBonusCredits ?? 0
                    )}><span>苏岚专精估价加成 (+15%)</span><strong class="num">+${
                      summary.crewMasteryBonusCredits
                    }¤</strong></div>`
                  : ''
              }
              ${
                summary.contractRewardCredits > 0
                  ? `<div class="v2-mig-row" ${nextStepAttr(
                      summary.contractRewardCredits
                    )}><span>委托悬赏奖金</span><strong class="num">+${
                      summary.contractRewardCredits
                    }¤</strong></div>`
                  : ''
              }
              ${bonusRowHtml}
              ${
                (summary.factionContractBonusCredits ?? 0) > 0
                  ? `<div class="v2-mig-row" ${nextStepAttr(
                      summary.factionContractBonusCredits ?? 0
                    )}><span>星港行会 Lv.3 委托加赏 (+10%)</span><strong class="num">+${
                      summary.factionContractBonusCredits
                    }¤</strong></div>`
                  : ''
              }
              ${
                summary.tutorialBonusCredits > 0
                  ? `<div class="v2-mig-row" ${nextStepAttr(
                      summary.tutorialBonusCredits
                    )}><span>首航交付奖励</span><strong class="num">+${
                      summary.tutorialBonusCredits
                    }¤</strong></div>`
                  : ''
              }
              ${
                isEmergencyTow && (summary.emergencyTowFeeCredits ?? 0) > 0
                  ? `<div class="v2-mig-row v3-tow-fee-row" ${nextStepAttr(0)}><span>非信标紧急拖航费 (-${towPenaltyPct}%)</span><strong class="num text-danger">-${
                      summary.emergencyTowFeeCredits
                    }¤</strong></div>`
                  : ''
              }
              ${partsRowHtml}
              ${factionRepRowsHtml}
              ${
                !run.isShowcase
                  ? `<div class="v2-mig-row"><span>入库后仓库容量</span><strong class="num ${
                      summary.warehouseOverflow ? 'text-danger' : ''
                    }">${summary.warehouseProjectedCount}/${warehouseCap}</strong></div>`
                  : ''
              }
            `
            : `<div class="v2-mig-row" ${nextStepAttr(
                summary.finalCreditsEarned
              )}><span>可回收总额 × ${defeatPct}%</span><strong class="num">${
                summary.defeatRecoverableBase
              } × ${defeatPct}%</strong></div>
               ${partsRowHtml}`
        }
        <div class="v2-mig-row total"><span>本次实得总计</span><strong class="num" data-testid="settlement-total-credits" data-final-credits="${
          summary.finalCreditsEarned
        }">+${summary.finalCreditsEarned}¤</strong></div>
      `;
    }

    // Goal hint & Campaign preview card (hidden during showcase)
    if (this.goalHintEl && this.campaignCardEl) {
      if (!run.isShowcase) {
        const goalKey = `${nextGoal.ready ? 1 : 0}:${nextGoal.title}:${nextGoal.detail}`;
        if (this.lastGoalHintKey !== goalKey) {
          this.lastGoalHintKey = goalKey;
          this.goalHintEl.className = `v2-settle-goal-hint${nextGoal.ready ? ' is-ready' : ''}`;
          this.goalHintEl.innerHTML = `<span>下一基地目标：<strong>${nextGoal.title}</strong></span><small>${nextGoal.detail}</small>`;
        }
        if (this.goalHintEl.parentElement !== this.scrollBodyEl) {
          this.scrollBodyEl.insertBefore(this.goalHintEl, this.itemsSectionEl);
        }

        const campPreview = previewSettlementCampaignOutcomes(p, run, summary);
        if (campPreview.headlines.length > 0 || campPreview.pityLine) {
          const campKey = `${campPreview.headlines.join('|')}||${campPreview.pityLine ?? ''}`;
          if (this.lastCampaignCardKey !== campKey) {
            this.lastCampaignCardKey = campKey;
            this.campaignCardEl.innerHTML = `
              <div class="v3-sc-title">${svgIcon('campaign', 13)} 战役与专精推进预览</div>
              ${campPreview.headlines.map((h) => `<div class="v3-sc-line">${h}</div>`).join('')}
              ${campPreview.pityLine ? `<div class="v3-sc-pity">${campPreview.pityLine}</div>` : ''}
            `;
          }
          if (this.campaignCardEl.parentElement !== this.scrollBodyEl) {
            this.scrollBodyEl.insertBefore(this.campaignCardEl, this.itemsSectionEl);
          }
        } else {
          this.lastCampaignCardKey = null;
          if (this.campaignCardEl.parentElement) this.campaignCardEl.remove();
        }
      } else {
        this.lastGoalHintKey = null;
        this.lastCampaignCardKey = null;
        if (this.goalHintEl.parentElement) this.goalHintEl.remove();
        if (this.campaignCardEl.parentElement) this.campaignCardEl.remove();
      }
    }

    // D07 Run-1 / Run-2 Equipment Family Unlock Selector (0 <button> elements -> S09 100% safe!)
    if (this.familyUnlockSectionEl && this.familyUnlockGroupEl) {
      const famChoices =
        isSafe && !run.isShowcase ? summary.pendingFamilyUnlockChoices ?? [] : [];
      if (famChoices.length >= 2) {
        const famKey = `${famChoices.join(',')}|${selectedFamilyUnlock ?? ''}|${readOnly ? 1 : 0}`;
        if (this.lastFamilyUnlockKey !== famKey) {
          this.lastFamilyUnlockKey = famKey;
          const validSet = new Set<V2UnlockFamilyId>(famChoices);
          for (const [fKey, fRefs] of this.familyUnlockOpts.entries()) {
            if (!validSet.has(fKey)) {
              fRefs.labelEl.remove();
              this.familyUnlockOpts.delete(fKey);
            }
          }
          famChoices.forEach((fam, idx) => {
            const spec = V2_CONTRACT_FAMILY_UNLOCK_ORDER.find((u) => u.family === fam);
            let fRefs = this.familyUnlockOpts.get(fam);
            if (!fRefs) {
              const labelEl = document.createElement('label');
              labelEl.className = 'v3-family-unlock-opt';
              labelEl.dataset.familyUnlock = fam;
              labelEl.dataset.testid = `family-unlock-option-${fam}`;

              const radioEl = document.createElement('input');
              radioEl.type = 'radio';
              radioEl.name = 'settle_family_unlock';
              radioEl.setAttribute('name', 'settle_family_unlock');
              radioEl.value = fam;
              radioEl.setAttribute('value', fam);
              radioEl.dataset.familyRadio = '1';

              const bodyEl = document.createElement('div');
              bodyEl.className = 'v3-family-unlock-body';
              const giftName = spec
                ? getV2EquipmentDefByKind(spec.giftMainKind, 'common').name
                : fam;
              const bpName = spec
                ? getV2EquipmentDefByKind(spec.freeBlueprintKind, 'common').name
                : '';
              bodyEl.innerHTML = `
                <div class="v3-fu-title"><strong>${spec?.name ?? fam}</strong></div>
                <div class="v3-fu-meta">赠品：${giftName} · 免费蓝图：${bpName}</div>
              `;

              labelEl.appendChild(radioEl);
              labelEl.appendChild(bodyEl);
              fRefs = { labelEl, radioEl, bodyEl };
              this.familyUnlockOpts.set(fam, fRefs);
            }

            const isSelected = selectedFamilyUnlock === fam;
            fRefs.labelEl.classList.toggle('is-selected', isSelected);
            if (fRefs.radioEl.checked !== isSelected) fRefs.radioEl.checked = isSelected;
            if (isSelected) fRefs.radioEl.setAttribute('checked', '');
            else fRefs.radioEl.removeAttribute('checked');
            syncInputDisabled(fRefs.radioEl, readOnly);

            const curChild = this.familyUnlockGroupEl!.children[idx];
            if (curChild !== fRefs.labelEl) {
              this.familyUnlockGroupEl!.insertBefore(fRefs.labelEl, curChild ?? null);
            }
          });
        }
        if (this.familyUnlockSectionEl.parentElement !== this.scrollBodyEl) {
          this.scrollBodyEl.insertBefore(this.familyUnlockSectionEl, this.itemsSectionEl);
        }
      } else {
        this.lastFamilyUnlockKey = null;
        if (this.familyUnlockSectionEl.parentElement) {
          this.familyUnlockSectionEl.remove();
        }
      }
    }

    // Items清单
    if (
      this.emptyHintEl &&
      this.decisionRowsWrapEl &&
      this.autoResolvedEl &&
      this.loanDetailsEl &&
      this.loanCountTextEl &&
      this.loanChipsWrapEl
    ) {
      if (summary.lines.length === 0) {
        if (this.decisionRowsWrapEl.parentElement) this.decisionRowsWrapEl.remove();
        if (this.autoResolvedEl.parentElement) this.autoResolvedEl.remove();
        if (this.loanDetailsEl.parentElement) this.loanDetailsEl.remove();
        for (const refs of this.decisionRows.values()) refs.rowEl.remove();
        this.decisionRows.clear();
        if (this.emptyHintEl.parentElement !== this.itemsSectionEl) {
          this.itemsSectionEl.appendChild(this.emptyHintEl);
        }
      } else {
        if (this.emptyHintEl.parentElement) this.emptyHintEl.remove();

        // 1) Keyed decision rows
        if (this.decisionRowsWrapEl.parentElement !== this.itemsSectionEl) {
          this.itemsSectionEl.appendChild(this.decisionRowsWrapEl);
        }
        const nextDecisionIds = new Set<string>(decisionLines.map((l) => l.item.instanceId));
        for (const [iid, refs] of this.decisionRows.entries()) {
          if (!nextDecisionIds.has(iid)) {
            refs.rowEl.remove();
            this.decisionRows.delete(iid);
          }
        }

        decisionLines.forEach((line, idx) => {
          const id = line.item.instanceId;
          const showLockHint = Boolean(
            isSafe &&
              !run.isShowcase &&
              line.item.category === 'equipment' &&
              line.item.origin === 'loot' &&
              !p.buildings.research_lab
          );

          let refs = this.decisionRows.get(id);
          if (!refs) {
            const rowEl = document.createElement('div');
            rowEl.className = 'v2-settle-row is-decision-row';
            const infoEl = document.createElement('div');
            infoEl.className = 'v2-settle-item-info';
            const controlsEl = document.createElement('div');
            controlsEl.className = 'v2-settle-disp-btns';
            rowEl.appendChild(infoEl);
            rowEl.appendChild(controlsEl);
            refs = { rowEl, infoEl, controlsEl, mode: 'none', infoKey: '' };
            this.decisionRows.set(id, refs);
          }

          const infoKey = `${line.item.definitionId}:${line.item.origin}:${line.name}:${line.item.category}:${line.item.quality}`;
          if (refs.infoKey !== infoKey) {
            refs.infoKey = infoKey;
            refs.infoEl.innerHTML = `
              <img class="v3-settle-thumb" src="${getItemImageUrl(line.item.definitionId)}" alt="" draggable="false" />
              <span class="v2-origin-badge origin-${line.item.origin}">${originTagText(
              line.item.origin
            )}</span>
              <strong>${line.name}</strong>
              ${
                line.item.category === 'equipment'
                  ? `<span class="v2-q-tag">${line.item.quality === 'improved' ? '良' : '普'}</span>`
                  : line.item.category === 'gadget'
                  ? `<span class="v2-q-tag">装置</span>`
                  : ''
              }
            `;
          }

          if (line.allowedDispositions.length === 2) {
            if (refs.mode !== 'two') {
              refs.controlsEl.innerHTML = '';
              refs.mode = 'two';
              refs.segGroupEl = undefined;
              refs.segOpts = undefined;

              const curChoiceEl = document.createElement('span');
              curChoiceEl.className = 'v2-settle-current-choice';
              const toggleBtnEl = document.createElement('button');
              toggleBtnEl.type = 'button';
              toggleBtnEl.className = 'btn btn-sm btn-secondary';
              toggleBtnEl.dataset.settleItem = id;

              refs.controlsEl.appendChild(curChoiceEl);
              refs.controlsEl.appendChild(toggleBtnEl);
              refs.currentChoiceEl = curChoiceEl;
              refs.toggleBtnEl = toggleBtnEl;
              refs.lockHintEl = undefined;
            }

            const alt =
              line.allowedDispositions.find((d) => d !== line.selectedDisposition) ??
              line.allowedDispositions[0];
            const curText = `当前：${dispositionLabel(
              line.selectedDisposition,
              line.item,
              p,
              run.shipId,
              line.effectiveSellValue,
              line.depthBonusCredits
            )}`;
            if (refs.currentChoiceEl && refs.currentChoiceEl.textContent !== curText) {
              refs.currentChoiceEl.textContent = curText;
            }

            if (refs.toggleBtnEl) {
              refs.toggleBtnEl.dataset.settleDisp = alt;
              refs.toggleBtnEl.dataset.action = alt === 'dismantle' ? 'dismantle' : `settle-${alt}`;
              if (alt === 'dismantle') {
                refs.toggleBtnEl.dataset.testid = `btn-dismantle-${id}`;
              } else if (alt === 'store') {
                refs.toggleBtnEl.dataset.testid = `btn-store-${id}`;
              } else {
                refs.toggleBtnEl.removeAttribute('data-testid');
              }
              const altText = `改为${dispositionLabel(
                alt,
                line.item,
                p,
                run.shipId,
                line.effectiveSellValue,
                line.depthBonusCredits
              )}`;
              if (refs.toggleBtnEl.textContent !== altText) {
                refs.toggleBtnEl.textContent = altText;
              }
              syncButtonDisabled(refs.toggleBtnEl, readOnly);
            }
          } else {
            // 3+ legal dispositions: persistent segmented radio group (0 <button> elements!)
            if (refs.mode !== 'seg') {
              refs.controlsEl.innerHTML = '';
              refs.mode = 'seg';
              refs.currentChoiceEl = undefined;
              refs.toggleBtnEl = undefined;

              const segGroupEl = document.createElement('div');
              segGroupEl.className = 'v2-settle-disp-seg';
              segGroupEl.setAttribute('role', 'radiogroup');
              segGroupEl.setAttribute('aria-label', `选择「${line.name}」去向`);
              refs.controlsEl.appendChild(segGroupEl);
              refs.segGroupEl = segGroupEl;
              refs.segOpts = new Map<V2SettlementDisposition, SegOptRefs>();
              refs.lockHintEl = undefined;
            }

            const segGroupEl = refs.segGroupEl!;
            const segOpts = refs.segOpts!;
            const nextDisps = new Set<V2SettlementDisposition>(line.allowedDispositions);
            for (const [d, optRefs] of segOpts.entries()) {
              if (!nextDisps.has(d)) {
                optRefs.labelEl.remove();
                segOpts.delete(d);
              }
            }

            line.allowedDispositions.forEach((d, optIdx) => {
              const selected = line.selectedDisposition === d;
              let optRefs = segOpts.get(d);
              if (!optRefs) {
                const labelEl = document.createElement('label');
                labelEl.dataset.settleItem = id;
                labelEl.dataset.settleDisp = d;
                labelEl.dataset.action = d === 'dismantle' ? 'dismantle' : `settle-${d}`;
                if (d === 'dismantle') {
                  labelEl.dataset.testid = `btn-dismantle-${id}`;
                } else if (d === 'store') {
                  labelEl.dataset.testid = `btn-store-${id}`;
                }

                const radioEl = document.createElement('input');
                radioEl.type = 'radio';
                radioEl.dataset.settleRadio = '1';
                radioEl.dataset.settleItem = id;
                radioEl.dataset.settleDisp = d;
                radioEl.name = `settle_disp_${id}`;
                radioEl.setAttribute('name', `settle_disp_${id}`);
                radioEl.value = d;
                radioEl.setAttribute('value', d);

                const textEl = document.createElement('span');
                labelEl.appendChild(radioEl);
                labelEl.appendChild(textEl);
                optRefs = { labelEl, radioEl, textEl };
                segOpts.set(d, optRefs);
              }

              const lblCls = `v2-settle-seg-opt${selected ? ' is-selected' : ''}`;
              if (optRefs.labelEl.className !== lblCls) optRefs.labelEl.className = lblCls;
              if (optRefs.radioEl.checked !== selected) optRefs.radioEl.checked = selected;
              if (selected) {
                optRefs.radioEl.setAttribute('checked', '');
              } else {
                optRefs.radioEl.removeAttribute('checked');
              }
              syncInputDisabled(optRefs.radioEl, readOnly);

              const optText = dispositionLabel(
                d,
                line.item,
                p,
                run.shipId,
                line.effectiveSellValue,
                line.depthBonusCredits
              );
              if (optRefs.textEl.textContent !== optText) optRefs.textEl.textContent = optText;

              const curAtOptIdx = segGroupEl.children[optIdx];
              if (curAtOptIdx !== optRefs.labelEl) {
                segGroupEl.insertBefore(optRefs.labelEl, curAtOptIdx ?? null);
              }
            });
          }

          // Optional lock hint
          if (showLockHint) {
            if (!refs.lockHintEl) {
              const lockHintEl = document.createElement('span');
              lockHintEl.className = 'v2-settle-lock-hint';
              lockHintEl.title = '在基地花费 100¤ 建造研究台后，可将拾获设备入库并研究永久蓝图';
              lockHintEl.textContent = '建成研究台(100¤)可入库';
              refs.lockHintEl = lockHintEl;
            }
            if (refs.lockHintEl.parentElement !== refs.controlsEl) {
              refs.controlsEl.appendChild(refs.lockHintEl);
            }
          } else if (refs.lockHintEl && refs.lockHintEl.parentElement) {
            refs.lockHintEl.remove();
          }

          const curAtIdx = this.decisionRowsWrapEl!.children[idx];
          if (curAtIdx !== refs.rowEl) {
            this.decisionRowsWrapEl!.insertBefore(refs.rowEl, curAtIdx ?? null);
          }
        });

        // 2) Auto-resolved non-loan lines (0 <button>s)
        if (autoNonLoanLines.length > 0) {
          const autoKey = autoNonLoanLines
            .map(
              (l) =>
                `${l.item.instanceId}:${l.selectedDisposition}:${
                  l.effectiveSellValue ?? l.item.fixedValue
                }:${l.depthBonusCredits ?? 0}`
            )
            .join('|');
          if (this.lastAutoResolvedKey !== autoKey) {
            this.lastAutoResolvedKey = autoKey;
            this.autoResolvedEl.innerHTML = `
              <div class="v3-auto-resolved-head">已自动归档（${autoNonLoanLines.length} 件无需手动确认）</div>
              ${autoNonLoanLines
                .map(
                  (line) => `<div class="v2-settle-row is-auto-resolved">
                    <div class="v2-settle-item-info">
                      <img class="v3-settle-thumb" src="${getItemImageUrl(
                        line.item.definitionId
                      )}" alt="" draggable="false" />
                      <span class="v2-origin-badge origin-${line.item.origin}">${originTagText(
                    line.item.origin
                  )}</span>
                      <strong>${line.name}</strong>
                    </div>
                    <span class="v2-settle-auto-badge">自动：${dispositionLabel(
                      line.selectedDisposition,
                      line.item,
                      p,
                      run.shipId,
                      line.effectiveSellValue,
                      line.depthBonusCredits
                    )}</span>
                  </div>`
                )
                .join('')}
            `;
          }
          if (this.autoResolvedEl.parentElement !== this.itemsSectionEl) {
            this.itemsSectionEl.appendChild(this.autoResolvedEl);
          }
        } else {
          this.lastAutoResolvedKey = null;
          if (this.autoResolvedEl.parentElement) this.autoResolvedEl.remove();
        }

        // 3) Persistent <details> loan summary (0 <button>s; preserves open state!)
        if (loanLines.length > 0) {
          const countText = `归还借用设备 ×${loanLines.length}`;
          if (this.loanCountTextEl.textContent !== countText) {
            this.loanCountTextEl.textContent = countText;
          }
          const chipsKey = loanLines.map((l) => `${l.item.instanceId}:${l.name}`).join('|');
          if (this.lastLoanChipsKey !== chipsKey) {
            this.lastLoanChipsKey = chipsKey;
            this.loanChipsWrapEl.innerHTML = loanLines
              .map((l) => `<span class="v3-loan-chip">${l.name}</span>`)
              .join('');
          }
          if (this.loanDetailsEl.parentElement !== this.itemsSectionEl) {
            this.itemsSectionEl.appendChild(this.loanDetailsEl);
          }
        } else {
          this.lastLoanChipsKey = null;
          if (this.loanDetailsEl.parentElement) this.loanDetailsEl.remove();
        }
      }
    }

    // Sticky footer
    if (
      this.overflowBannerEl &&
      this.showcaseActionsEl &&
      this.showcaseRetryBtnEl &&
      this.showcaseToBaseBtnEl &&
      this.confirmBtnEl
    ) {
      if (summary.warehouseOverflow && !run.isShowcase) {
        const msg = `设备库容量超出上限（${summary.warehouseProjectedCount}/${warehouseCap}），请将部分「入库」改为「出售」或转为零件。`;
        if (this.overflowBannerEl.textContent !== msg) this.overflowBannerEl.textContent = msg;
        if (this.overflowBannerEl.parentElement !== this.footerEl) {
          this.footerEl.insertBefore(
            this.overflowBannerEl,
            this.footerEl.childNodes[0] ?? null
          );
        }
      } else if (this.overflowBannerEl.parentElement) {
        this.overflowBannerEl.remove();
      }

      if (run.isShowcase) {
        if (this.confirmBtnEl.parentElement) this.confirmBtnEl.remove();
        if (this.showcaseActionsEl.parentElement !== this.footerEl) {
          this.footerEl.appendChild(this.showcaseActionsEl);
        }
        syncButtonDisabled(this.showcaseRetryBtnEl, readOnly);
        syncButtonDisabled(this.showcaseToBaseBtnEl, readOnly);
      } else {
        if (this.showcaseActionsEl.parentElement) this.showcaseActionsEl.remove();
        if (this.confirmBtnEl.parentElement !== this.footerEl) {
          this.footerEl.appendChild(this.confirmBtnEl);
        }
        syncButtonDisabled(this.confirmBtnEl, readOnly || summary.warehouseOverflow);
        const confirmKey = readOnly ? 'ro' : 'ok';
        if (this.lastConfirmLabelKey !== confirmKey) {
          this.lastConfirmLabelKey = confirmKey;
          this.confirmBtnEl.innerHTML = readOnly
            ? '只读锁定'
            : `${svgIcon('beacon', 15)} 确认入账 · 返回星港基地`;
        }
      }
    }
  }

  unmount(): void {
    this.rootEl?.removeEventListener('click', this.handleRootClick);
    this.rootEl?.removeEventListener('change', this.handleRootChange);
    this.rootEl?.remove();
    this.decisionRows.clear();
    this.selectedByItem.clear();
    this.updateRevision = 0;
    this.clickDedupSeq += 1;
    this.pendingClickDedup = null;
    this.hostEl = null;
    this.rootEl = null;
    this.titleEl = null;
    this.subEl = null;
    this.scrollBodyEl = null;
    this.endlessBannerEl = null;
    this.lastEndlessKey = null;
    this.statusBannerEl = null;
    this.lastStatusBannerKey = null;
    this.totalsEl = null;
    this.lastTotalsKey = null;
    this.goalHintEl = null;
    this.lastGoalHintKey = null;
    this.campaignCardEl = null;
    this.lastCampaignCardKey = null;
    this.familyUnlockSectionEl = null;
    this.familyUnlockGroupEl = null;
    this.familyUnlockOpts.clear();
    this.latestSelectedFamilyUnlock = null;
    this.lastFamilyUnlockKey = null;
    this.itemsSectionEl = null;
    this.emptyHintEl = null;
    this.decisionRowsWrapEl = null;
    this.autoResolvedEl = null;
    this.lastAutoResolvedKey = null;
    this.loanDetailsEl = null;
    this.loanCountTextEl = null;
    this.loanChipsWrapEl = null;
    this.lastLoanChipsKey = null;
    this.footerEl = null;
    this.overflowBannerEl = null;
    this.showcaseActionsEl = null;
    this.showcaseRetryBtnEl = null;
    this.showcaseToBaseBtnEl = null;
    this.confirmBtnEl = null;
    this.lastConfirmLabelKey = null;
    this.latestActions = null;
    this.latestReadOnly = false;
    this.lastTitleKey = null;
  }
}

const legacySettlementViews = new WeakMap<HTMLElement, SettlementPhaseView>();

export function renderSettlementView(
  leftPanelEl: HTMLElement,
  props: SettlementViewProps,
  actions: SettlementViewActions
): void {
  let view = legacySettlementViews.get(leftPanelEl);
  if (!view) {
    view = new SettlementPhaseView();
    legacySettlementViews.set(leftPanelEl, view);
  }
  if (!view.isMountedIn(leftPanelEl)) {
    view.mount(leftPanelEl);
  }
  view.update(props, actions);
}
