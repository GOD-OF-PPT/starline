import { resolveV3BossDefForEncounter, type V3EnemyIntent } from '../../data/bosses';
import {
  getUnitIntentCyclePreview,
  getV2EncounterTemplate,
  resolveUnitInitialShield,
} from '../../data/enemies';
import { getV3GadgetDef } from '../../data/gadgets';
import {
  aggregateEndlessMutatorEffects,
  getV3EndlessMutatorDef,
  getV3SectorDef,
} from '../../data/sectors';
import { V2_SHAPES } from '../../data/shapes';
import { getShipSignatureCommand } from '../../data/ships';
import {
  computeCombatTacticalChargesMax,
  getEffectiveV2CombatBounty,
  previewV2CombatNode,
  resolveNodeBossId,
} from '../../domain/combatV2';
import { canUseV3GadgetInRun } from '../../domain/encounter';
import { getAnyV2ItemDef } from '../../domain/itemCatalog';
import {
  classifyV2CombatDeltaTrend,
  classifyV2CombatThreat,
  getV2ThreatTierMeta,
} from '../../domain/tacticalDelta';
import type {
  V2CombatUnitSnapshot,
  V2EliteTacticChoice,
  V2MapNode,
  V2RunState,
  V2TargetPolicy,
} from '../../domain/types';
import { svgIcon } from '../icons';
import { NODE_TYPE_META, type PhaseView } from './screenTypes';

export const PRE_COMBAT_AUTO_ENGAGE_MS = 1500;
export const PRE_COMBAT_TICK_MS = 100;

export type PreCombatAutoEngageStatus = 'idle' | 'countdown' | 'paused' | 'engaged';
export type PreCombatPauseReason =
  | 'manual'
  | 'policy'
  | 'gadget'
  | 'details'
  | 'modal'
  | 'hidden'
  | 'readonly';

export interface PreCombatAutoEngageSnapshot {
  readonly status: PreCombatAutoEngageStatus;
  readonly nodeKey: string | null;
  readonly durationMs: number;
  readonly remainingMs: number;
  readonly pauseReason: PreCombatPauseReason | null;
}

export interface PreCombatAutoEngageSyncContext {
  readonly eligible: boolean;
  readonly nodeKey: string | null;
  readonly canMutate: boolean;
  readonly modalOpen: boolean;
  readonly hidden: boolean;
}

export interface PreCombatAutoEngageOptions {
  readonly durationMs?: number;
  readonly tickMs?: number;
  readonly onEngage: (nodeKey: string, source: 'timer' | 'manual') => boolean;
  readonly onChange?: (snapshot: PreCombatAutoEngageSnapshot) => void;
  readonly isLiveEligible?: (nodeKey: string) => {
    readonly eligible: boolean;
    readonly canMutate: boolean;
    readonly modalOpen: boolean;
    readonly hidden: boolean;
  };
  readonly now?: () => number;
  readonly setTimeoutFn?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  readonly clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
  readonly setIntervalFn?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  readonly clearIntervalFn?: (handle: ReturnType<typeof setInterval>) => void;
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

/**
 * Deterministic, RAF-free pre-combat 1.5s auto-engage state machine (S05).
 * Strictly idempotent against timer vs manual click races, safe under `vi.useFakeTimers()`,
 * and auto-pauses cleanly on pause click, policy/gadget/details/modal/hidden/readonly events.
 */
export class PreCombatAutoEngageController {
  private readonly durationMs: number;
  private readonly tickMs: number;
  private readonly onEngage: (nodeKey: string, source: 'timer' | 'manual') => boolean;
  private readonly onChange?: (snapshot: PreCombatAutoEngageSnapshot) => void;
  private readonly isLiveEligible?: PreCombatAutoEngageOptions['isLiveEligible'];
  private readonly now: () => number;
  private readonly setTimeoutFn: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimeoutFn: (handle: ReturnType<typeof setTimeout>) => void;
  private readonly setIntervalFn: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  private readonly clearIntervalFn: (handle: ReturnType<typeof setInterval>) => void;

  private status: PreCombatAutoEngageStatus = 'idle';
  private nodeKey: string | null = null;
  private engagedNodeKey: string | null = null;
  private pauseReason: PreCombatPauseReason | null = null;
  private startedAtMs = 0;
  private remainingMs: number;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(options: PreCombatAutoEngageOptions) {
    this.durationMs = Math.max(50, Math.floor(options.durationMs ?? PRE_COMBAT_AUTO_ENGAGE_MS));
    this.tickMs = Math.max(16, Math.floor(options.tickMs ?? PRE_COMBAT_TICK_MS));
    this.remainingMs = this.durationMs;
    this.onEngage = options.onEngage;
    this.onChange = options.onChange;
    this.isLiveEligible = options.isLiveEligible;
    this.now = options.now ?? (() => Date.now());
    this.setTimeoutFn = options.setTimeoutFn ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
    this.clearTimeoutFn = options.clearTimeoutFn ?? ((h) => globalThis.clearTimeout(h));
    this.setIntervalFn = options.setIntervalFn ?? ((fn, ms) => globalThis.setInterval(fn, ms));
    this.clearIntervalFn = options.clearIntervalFn ?? ((h) => globalThis.clearInterval(h));
  }

  getSnapshot(): PreCombatAutoEngageSnapshot {
    return {
      status: this.status,
      nodeKey: this.nodeKey,
      durationMs: this.durationMs,
      remainingMs: this.remainingMs,
      pauseReason: this.pauseReason,
    };
  }

  private clearTimers(): void {
    if (this.timeoutHandle !== null) {
      this.clearTimeoutFn(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    if (this.intervalHandle !== null) {
      this.clearIntervalFn(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private resolveBlockReason(ctx: {
    readonly canMutate: boolean;
    readonly modalOpen: boolean;
    readonly hidden: boolean;
  }): PreCombatPauseReason {
    if (ctx.modalOpen) return 'modal';
    if (ctx.hidden) return 'hidden';
    return 'readonly';
  }

  private startCountdown(): void {
    this.clearTimers();
    this.status = 'countdown';
    this.pauseReason = null;
    this.startedAtMs = this.now();
    this.remainingMs = this.durationMs;
    this.timeoutHandle = this.setTimeoutFn(() => this.handleTimerDone(), this.durationMs);
    this.intervalHandle = this.setIntervalFn(() => this.handleTick(), this.tickMs);
  }

  private handleTick(): void {
    if (this.status !== 'countdown' || !this.nodeKey) {
      this.clearTimers();
      return;
    }
    if (this.isLiveEligible) {
      const live = this.isLiveEligible(this.nodeKey);
      if (!live.eligible) {
        this.reset();
        this.onChange?.(this.getSnapshot());
        return;
      }
      if (!live.canMutate || live.modalOpen || live.hidden) {
        this.pause(this.resolveBlockReason(live));
        return;
      }
    }
    this.remainingMs = Math.max(0, this.durationMs - (this.now() - this.startedAtMs));
    this.onChange?.(this.getSnapshot());
  }

  private handleTimerDone(): void {
    this.clearTimers();
    if (this.status !== 'countdown' || !this.nodeKey || this.engagedNodeKey === this.nodeKey) {
      return;
    }
    const targetKey = this.nodeKey;
    if (this.isLiveEligible) {
      const live = this.isLiveEligible(targetKey);
      if (!live.eligible) {
        this.reset();
        this.onChange?.(this.getSnapshot());
        return;
      }
      if (!live.canMutate || live.modalOpen || live.hidden) {
        this.status = 'paused';
        this.pauseReason = this.resolveBlockReason(live);
        this.remainingMs = this.durationMs;
        this.onChange?.(this.getSnapshot());
        return;
      }
    }
    this.status = 'engaged';
    this.engagedNodeKey = targetKey;
    this.remainingMs = 0;
    this.pauseReason = null;
    this.onChange?.(this.getSnapshot());

    const ok = this.onEngage(targetKey, 'timer');
    if (!ok && this.nodeKey === targetKey) {
      this.status = 'paused';
      this.pauseReason = 'manual';
      this.engagedNodeKey = null;
      this.remainingMs = this.durationMs;
      this.onChange?.(this.getSnapshot());
    }
  }

  sync(ctx: PreCombatAutoEngageSyncContext): PreCombatAutoEngageSnapshot {
    if (!ctx.eligible || !ctx.nodeKey) {
      this.reset();
      return this.getSnapshot();
    }

    if (this.nodeKey !== ctx.nodeKey) {
      this.clearTimers();
      this.nodeKey = ctx.nodeKey;
      this.engagedNodeKey = null;
      if (!ctx.canMutate || ctx.modalOpen || ctx.hidden) {
        this.status = 'paused';
        this.pauseReason = this.resolveBlockReason(ctx);
        this.remainingMs = this.durationMs;
      } else {
        this.startCountdown();
      }
      return this.getSnapshot();
    }

    if (this.status === 'countdown') {
      if (!ctx.canMutate || ctx.modalOpen || ctx.hidden) {
        this.clearTimers();
        this.status = 'paused';
        this.pauseReason = this.resolveBlockReason(ctx);
      } else {
        this.remainingMs = Math.max(0, this.durationMs - (this.now() - this.startedAtMs));
      }
    }
    return this.getSnapshot();
  }

  pause(reason: PreCombatPauseReason): boolean {
    if (this.status !== 'countdown' || !this.nodeKey) {
      return false;
    }
    this.clearTimers();
    this.status = 'paused';
    this.pauseReason = reason;
    this.onChange?.(this.getSnapshot());
    return true;
  }

  resume(): boolean {
    if (this.status !== 'paused' || !this.nodeKey) {
      return false;
    }
    if (this.isLiveEligible) {
      const live = this.isLiveEligible(this.nodeKey);
      if (!live.eligible) {
        this.reset();
        this.onChange?.(this.getSnapshot());
        return false;
      }
      if (!live.canMutate || live.modalOpen || live.hidden) {
        return false;
      }
    }
    this.startCountdown();
    this.onChange?.(this.getSnapshot());
    return true;
  }

  togglePause(): boolean {
    if (this.status === 'countdown') {
      return this.pause('manual');
    }
    if (this.status === 'paused') {
      return this.resume();
    }
    return false;
  }

  engageNow(): boolean {
    if (!this.nodeKey || this.status === 'engaged' || this.engagedNodeKey === this.nodeKey) {
      this.clearTimers();
      return false;
    }
    const targetKey = this.nodeKey;
    if (this.isLiveEligible) {
      const live = this.isLiveEligible(targetKey);
      if (!live.eligible) {
        this.reset();
        this.onChange?.(this.getSnapshot());
        return false;
      }
      if (!live.canMutate || live.modalOpen) {
        if (this.status === 'countdown') {
          this.pause(this.resolveBlockReason(live));
        }
        return false;
      }
    }
    this.clearTimers();
    this.status = 'engaged';
    this.engagedNodeKey = targetKey;
    this.remainingMs = 0;
    this.pauseReason = null;
    this.onChange?.(this.getSnapshot());

    const ok = this.onEngage(targetKey, 'manual');
    if (!ok && this.nodeKey === targetKey) {
      this.status = 'paused';
      this.pauseReason = 'manual';
      this.engagedNodeKey = null;
      this.remainingMs = this.durationMs;
      this.onChange?.(this.getSnapshot());
    }
    return ok;
  }

  markEngaged(nodeKey: string): void {
    this.clearTimers();
    this.nodeKey = nodeKey;
    this.engagedNodeKey = nodeKey;
    this.status = 'engaged';
    this.remainingMs = 0;
    this.pauseReason = null;
  }

  reset(): void {
    this.clearTimers();
    this.nodeKey = null;
    this.engagedNodeKey = null;
    this.status = 'idle';
    this.pauseReason = null;
    this.remainingMs = this.durationMs;
  }

  destroy(): void {
    this.reset();
  }
}

function formatAutoEngageStartLabel(snapshot: PreCombatAutoEngageSnapshot | undefined): string {
  if (snapshot && snapshot.status === 'countdown') {
    const secs = Math.max(0, snapshot.remainingMs / 1000).toFixed(1);
    return `开始交火（${secs}s 后自动交火）`;
  }
  return '开始交火';
}

function computeAutoEngageProgressPct(snapshot: PreCombatAutoEngageSnapshot | undefined): number {
  if (!snapshot || snapshot.status !== 'countdown' || snapshot.durationMs <= 0) {
    return 0;
  }
  const elapsed = Math.max(0, snapshot.durationMs - snapshot.remainingMs);
  return Math.max(0, Math.min(100, Math.round((elapsed / snapshot.durationMs) * 100)));
}

/**
 * In-place non-destructive DOM patcher for 100ms countdown ticks (zero innerHTML rewrites!).
 */
export function updateCombatPreAutoEngageUi(
  leftPanelEl: HTMLElement,
  snapshot: PreCombatAutoEngageSnapshot,
  readOnly: boolean
): void {
  const startBtn = leftPanelEl.querySelector<HTMLButtonElement>('[data-testid="btn-start-combat"]');
  if (startBtn) {
    startBtn.dataset.autoEngageStatus = snapshot.status;
    startBtn.dataset.autoEngageRemainingMs = String(Math.max(0, Math.round(snapshot.remainingMs)));
    startBtn.classList.toggle('is-countdown', snapshot.status === 'countdown');
    const progressEl = startBtn.querySelector<HTMLElement>('[data-slot="auto-engage-progress"]');
    if (progressEl) {
      progressEl.style.width = `${computeAutoEngageProgressPct(snapshot)}%`;
    }
    const labelEl = startBtn.querySelector<HTMLElement>('[data-slot="auto-engage-label"]');
    const nextLabel = formatAutoEngageStartLabel(snapshot);
    if (labelEl && labelEl.textContent !== nextLabel) {
      labelEl.textContent = nextLabel;
    }
  }

  const pauseBtn = leftPanelEl.querySelector<HTMLButtonElement>(
    '[data-testid="btn-pause-auto-combat"]'
  );
  if (pauseBtn) {
    const isCountdown = snapshot.status === 'countdown';
    const isPaused = snapshot.status === 'paused';
    syncButtonDisabled(
      pauseBtn,
      readOnly || snapshot.status === 'engaged' || snapshot.status === 'idle'
    );
    pauseBtn.setAttribute('aria-pressed', isPaused ? 'true' : 'false');
    pauseBtn.classList.toggle('is-paused', isPaused);
    const nextPauseText = isCountdown ? '暂停 / 调整' : '继续自动交火';
    if (pauseBtn.textContent !== nextPauseText) {
      pauseBtn.textContent = nextPauseText;
    }
  }
}

export interface CombatPreViewProps {
  readonly run: V2RunState;
  readonly node: V2MapNode;
  readonly readOnly: boolean;
  readonly showCombatLogDetails: boolean;
  readonly pureAutoCombat: boolean;
  readonly bonusBossCharges?: number;
  readonly stargateRelayTier?: number;
  readonly autoEngage?: PreCombatAutoEngageSnapshot;
}

export interface CombatPreViewActions {
  readonly onSelectPolicy: (policy: V2TargetPolicy) => void;
  readonly onToggleLog: () => void;
  readonly onUseGadget?: (instanceId: string) => void;
  readonly onTogglePauseAutoEngage?: () => void;
  readonly onStartCombat: () => void;
}

function getIntentToneClass(kind: V3EnemyIntent['kind']): string {
  switch (kind) {
    case 'charge':
    case 'heavy_volley':
      return 'intent-charge';
    case 'pierce_beam':
    case 'ram':
      return 'intent-pierce';
    case 'shield_regen':
      return 'intent-shield';
    case 'emp':
      return 'intent-emp';
    case 'summon':
    case 'phase_shift':
      return 'intent-summon';
    default:
      return 'intent-attack';
  }
}

function formatIntentShortText(intent: V3EnemyIntent): string {
  const details: string[] = [];
  if (intent.damage > 0) {
    details.push(`${intent.damage}伤`);
  }
  if (intent.pierceRatio && intent.pierceRatio > 0 && intent.damage > 0) {
    details.push(`穿${Math.round(intent.pierceRatio * 100)}%`);
  }
  if (intent.shieldGain && intent.shieldGain > 0) {
    details.push(`+${intent.shieldGain}盾`);
  }
  if (intent.empShieldDrain && intent.empShieldDrain > 0) {
    details.push(`削${intent.empShieldDrain}盾`);
  }
  if (intent.summonCount && intent.summonCount > 0) {
    details.push(`+${intent.summonCount}机`);
  }
  return details.length > 0 ? `${intent.label} (${details.join(' · ')})` : intent.label;
}

function getTacticButtonClass(choice: string, isSignature?: boolean): string {
  if (isSignature || choice.startsWith('signature_')) return 'is-signature';
  if (choice === 'overload') return 'is-amber';
  if (choice === 'emergency_shield' || choice === 'emergency_defense') return 'is-cyan';
  if (choice === 'focus_calibrate') return 'is-emerald';
  return '';
}

export class CombatPrePhaseView implements PhaseView<CombatPreViewProps, CombatPreViewActions> {
  private hostEl: HTMLElement | null = null;
  private rootEl: HTMLDivElement | null = null;
  private scrollBodyEl: HTMLDivElement | null = null;
  private titleEl: HTMLHeadingElement | null = null;
  private bountyValEl: HTMLElement | null = null;
  private envBannerEl: HTMLDivElement | null = null;
  private finalBannerEl: HTMLDivElement | null = null;
  private endlessBannerEl: HTMLDivElement | null = null;
  private tacticalStripEl: HTMLDivElement | null = null;

  private overchargeBannerEl: HTMLDivElement | null = null;
  private gadgetBarEl: HTMLDivElement | null = null;
  private gadgetBtnsWrapEl: HTMLDivElement | null = null;
  private readonly gadgetBtns = new Map<string, HTMLButtonElement>();

  private bossDossierEl: HTMLDivElement | null = null;
  private rosterEl: HTMLDivElement | null = null;

  // S04 single-enemy detachable policy box
  private policyBoxEl: HTMLDivElement | null = null;
  private policyWeakestBtnEl: HTMLButtonElement | null = null;
  private policyThreatBtnEl: HTMLButtonElement | null = null;

  // S06 qualitative threat preview card + on-demand details drawer
  private previewCardEl: HTMLDivElement | null = null;
  private previewHeadTitleEl: HTMLElement | null = null;
  private threatPillEl: HTMLSpanElement | null = null;
  private previewBodyEl: HTMLDivElement | null = null;
  private toggleLogBtnEl: HTMLButtonElement | null = null;
  private detailsDrawerEl: HTMLDivElement | null = null;

  // Persistent sticky CTA buttons (preserve === identity across 100ms ticks!)
  private startBtnEl: HTMLButtonElement | null = null;
  private autoProgressEl: HTMLSpanElement | null = null;
  private autoLabelEl: HTMLSpanElement | null = null;
  private pauseBtnEl: HTMLButtonElement | null = null;

  private latestActions: CombatPreViewActions | null = null;

  private lastTitleKey: string | null = null;
  private lastEnvKey: string | null = null;
  private lastEndlessKey: string | null = null;
  private lastTacticalKey: string | null = null;
  private lastBossKey: string | null = null;
  private lastRosterKey: string | null = null;
  private lastPreviewBodyKey: string | null = null;
  private lastDrawerKey: string | null = null;

  private readonly handleRootClick = (ev: Event): void => {
    if (!this.rootEl || !this.latestActions) return;
    const target = ev.target as HTMLElement | null;
    if (!target || typeof target.closest !== 'function') return;
    const btn = target.closest('button') as HTMLButtonElement | null;
    if (!btn || !this.rootEl.contains(btn) || btn.disabled) return;

    if (btn === this.startBtnEl || btn.id === 'v2-btn-start-combat') {
      this.latestActions.onStartCombat();
      return;
    }
    if (btn === this.pauseBtnEl || btn.id === 'v2-btn-pause-auto-combat') {
      this.latestActions.onTogglePauseAutoEngage?.();
      return;
    }
    if (btn === this.toggleLogBtnEl || btn.id === 'v2-toggle-log') {
      this.latestActions.onToggleLog();
      return;
    }
    const policy = btn.dataset.policy as V2TargetPolicy | undefined;
    if (policy) {
      this.latestActions.onSelectPolicy(policy);
      return;
    }
    const gadgetId = btn.dataset.useGadget;
    if (gadgetId) {
      this.latestActions.onUseGadget?.(gadgetId);
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
    root.dataset.testid = 'combat-screen';

    const scrollBody = document.createElement('div');
    scrollBody.className = 'v3-panel-scroll-body';

    // Header
    const header = document.createElement('div');
    header.className = 'panel-header';
    const title = document.createElement('h2');
    const sub = document.createElement('span');
    sub.className = 'panel-sub';
    sub.textContent = '击破赏金 ';
    const bountyVal = document.createElement('strong');
    bountyVal.className = 'num';
    sub.appendChild(bountyVal);
    header.appendChild(title);
    header.appendChild(sub);
    scrollBody.appendChild(header);

    const envBanner = document.createElement('div');
    envBanner.dataset.testid = 'combat-sector-modifier';
    scrollBody.appendChild(envBanner);

    const finalBanner = document.createElement('div');
    finalBanner.className = 'v3-final-mission-banner';
    finalBanner.dataset.testid = 'combat-final-banner';
    finalBanner.innerHTML = `<strong>${svgIcon('star', 12)} 星门重启远征</strong><span>终局战役节点</span>`;

    const endlessBanner = document.createElement('div');
    endlessBanner.className = 'v3-endless-hud-banner';
    endlessBanner.dataset.testid = 'combat-endless-banner';

    const tacticalStrip = document.createElement('div');
    tacticalStrip.dataset.testid = 'combat-tactical-preview';
    scrollBody.appendChild(tacticalStrip);

    const overchargeBanner = document.createElement('div');
    overchargeBanner.className = 'v3-overcharge-banner';
    overchargeBanner.dataset.testid = 'overcharge-active-banner';
    overchargeBanner.innerHTML = `${svgIcon(
      'bolt',
      14
    )} <strong>过载电池已充能</strong>：首轮追加 +6 无视护甲能量爆发与 +4 护盾（已同步至下方预估）`;

    const gadgetBar = document.createElement('div');
    gadgetBar.className = 'v3-gadget-bar';
    gadgetBar.dataset.testid = 'combat-gadget-bar';
    const gadgetBarLabel = document.createElement('span');
    gadgetBarLabel.className = 'v3-gadget-bar-label';
    gadgetBarLabel.innerHTML = `${svgIcon('bolt', 12)} 战前消耗装置`;
    const gadgetBtnsWrap = document.createElement('div');
    gadgetBtnsWrap.className = 'v3-gadget-bar-btns';
    gadgetBar.appendChild(gadgetBarLabel);
    gadgetBar.appendChild(gadgetBtnsWrap);

    const bossDossier = document.createElement('div');
    bossDossier.className = 'v3-boss-dossier';
    bossDossier.dataset.testid = 'boss-phase-overview';

    const roster = document.createElement('div');
    roster.className = 'v2-enemy-roster v3-enemy-roster';
    scrollBody.appendChild(roster);

    // S04 detachable policy box (only attached when units.length > 1)
    const policyBox = document.createElement('div');
    policyBox.className = 'v2-policy-box';
    const policyLbl = document.createElement('span');
    policyLbl.className = 'v2-prep-label';
    policyLbl.textContent = '集火策略';
    const policyBtnRow = document.createElement('div');
    policyBtnRow.style.display = 'flex';
    policyBtnRow.style.gap = '8px';
    policyBtnRow.style.marginTop = '6px';
    const policyWeakestBtn = document.createElement('button');
    policyWeakestBtn.type = 'button';
    policyWeakestBtn.dataset.policy = 'weakest';
    policyWeakestBtn.textContent = '优先最弱';
    const policyThreatBtn = document.createElement('button');
    policyThreatBtn.type = 'button';
    policyThreatBtn.dataset.policy = 'highest_threat';
    policyThreatBtn.textContent = '优先最大威胁';
    policyBtnRow.appendChild(policyWeakestBtn);
    policyBtnRow.appendChild(policyThreatBtn);
    policyBox.appendChild(policyLbl);
    policyBox.appendChild(policyBtnRow);

    // S06 preview card (detached only if pv === null)
    const previewCard = document.createElement('div');
    const cpHead = document.createElement('div');
    cpHead.className = 'v2-cp-head';
    const previewHeadTitle = document.createElement('strong');
    const threatPill = document.createElement('span');
    threatPill.dataset.testid = 'combat-threat-tier';
    cpHead.appendChild(previewHeadTitle);
    cpHead.appendChild(threatPill);
    previewCard.appendChild(cpHead);

    const previewBody = document.createElement('div');
    previewBody.className = 'v2-cp-body';
    previewCard.appendChild(previewBody);

    const toggleLogBtn = document.createElement('button');
    toggleLogBtn.type = 'button';
    toggleLogBtn.className = 'btn btn-sm btn-ghost v3-forecast-details-btn';
    toggleLogBtn.id = 'v2-toggle-log';
    toggleLogBtn.dataset.testid = 'btn-toggle-forecast-details';
    toggleLogBtn.style.marginTop = '4px';
    previewCard.appendChild(toggleLogBtn);

    const detailsDrawer = document.createElement('div');
    detailsDrawer.className = 'v3-forecast-details-drawer';
    detailsDrawer.dataset.testid = 'forecast-details-drawer';

    root.appendChild(scrollBody);

    // Sticky CTA Footer
    const footer = document.createElement('div');
    footer.className = 'v3-sticky-cta-footer';
    const ctaRow = document.createElement('div');
    ctaRow.className = 'v3-precombat-cta-row';

    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.className = 'btn btn-primary btn-launch-hero v3-auto-engage-btn';
    startBtn.id = 'v2-btn-start-combat';
    startBtn.dataset.testid = 'btn-start-combat';
    startBtn.dataset.action = 'start-combat';
    const autoProgress = document.createElement('span');
    autoProgress.className = 'v3-auto-engage-progress';
    autoProgress.dataset.slot = 'auto-engage-progress';
    const btnContent = document.createElement('span');
    btnContent.className = 'v3-auto-engage-btn-content';
    btnContent.innerHTML = svgIcon('combat', 16);
    const autoLabel = document.createElement('span');
    autoLabel.dataset.slot = 'auto-engage-label';
    btnContent.appendChild(autoLabel);
    startBtn.appendChild(autoProgress);
    startBtn.appendChild(btnContent);

    const pauseBtn = document.createElement('button');
    pauseBtn.type = 'button';
    pauseBtn.className = 'btn btn-secondary v3-pause-auto-btn';
    pauseBtn.id = 'v2-btn-pause-auto-combat';
    pauseBtn.dataset.testid = 'btn-pause-auto-combat';

    ctaRow.appendChild(startBtn);
    ctaRow.appendChild(pauseBtn);
    footer.appendChild(ctaRow);
    root.appendChild(footer);

    host.appendChild(root);
    root.addEventListener('click', this.handleRootClick);

    this.rootEl = root;
    this.scrollBodyEl = scrollBody;
    this.titleEl = title;
    this.bountyValEl = bountyVal;
    this.envBannerEl = envBanner;
    this.finalBannerEl = finalBanner;
    this.endlessBannerEl = endlessBanner;
    this.tacticalStripEl = tacticalStrip;
    this.overchargeBannerEl = overchargeBanner;
    this.gadgetBarEl = gadgetBar;
    this.gadgetBtnsWrapEl = gadgetBtnsWrap;
    this.bossDossierEl = bossDossier;
    this.rosterEl = roster;
    this.policyBoxEl = policyBox;
    this.policyWeakestBtnEl = policyWeakestBtn;
    this.policyThreatBtnEl = policyThreatBtn;
    this.previewCardEl = previewCard;
    this.previewHeadTitleEl = previewHeadTitle;
    this.threatPillEl = threatPill;
    this.previewBodyEl = previewBody;
    this.toggleLogBtnEl = toggleLogBtn;
    this.detailsDrawerEl = detailsDrawer;
    this.startBtnEl = startBtn;
    this.autoProgressEl = autoProgress;
    this.autoLabelEl = autoLabel;
    this.pauseBtnEl = pauseBtn;
  }

  update(props: CombatPreViewProps, actions: CombatPreViewActions): void {
    this.latestActions = actions;
    if (!this.rootEl || !this.scrollBodyEl || !this.rosterEl) return;

    const {
      run,
      node,
      readOnly,
      showCombatLogDetails,
      pureAutoCombat,
      bonusBossCharges = 0,
      stargateRelayTier = 0,
      autoEngage,
    } = props;
    if (!node.combat) return;

    const pv = previewV2CombatNode(run, node.nodeId, run.targetPolicy, { stargateRelayTier });
    const sector = getV3SectorDef(run.sectorId);
    const envIcon =
      sector.envModifier.id === 'cryo_ion'
        ? 'cryo'
        : sector.envModifier.id === 'gravity_tide'
        ? 'gravity'
        : 'radar';
    const encounterTpl = getV2EncounterTemplate(node.combat.encounterKind);
    const bossId = resolveNodeBossId(node, run);
    const bossDef = resolveV3BossDefForEncounter({
      encounterKind: node.combat.encounterKind,
      bossId,
      units: node.combat.units,
    });
    const headerLabel = bossDef
      ? bossDef.title
      : bossId
      ? encounterTpl.name
      : NODE_TYPE_META[node.type].label;
    const chargesMax = computeCombatTacticalChargesMax(node, run, bonusBossCharges);
    const sigDef = getShipSignatureCommand(run.shipId);
    const effectiveBounty = getEffectiveV2CombatBounty(run, node.combat.bounty);

    // Header
    const titleKey = `${bossDef ? 'boss' : node.type}:${node.layer}:${headerLabel}`;
    if (this.titleEl && this.lastTitleKey !== titleKey) {
      this.lastTitleKey = titleKey;
      this.titleEl.innerHTML = `${svgIcon(
        bossDef ? 'boss' : NODE_TYPE_META[node.type].icon,
        16
      )} 第 ${node.layer} 层 · ${headerLabel}`;
    }
    const bountyText = `+${effectiveBounty}¤`;
    if (this.bountyValEl && this.bountyValEl.textContent !== bountyText) {
      this.bountyValEl.textContent = bountyText;
    }

    // Env banner
    const envKey = `${sector.id}:${sector.envModifier.id}`;
    if (this.envBannerEl && this.lastEnvKey !== envKey) {
      this.lastEnvKey = envKey;
      this.envBannerEl.className = `v3-combat-env-banner env-${sector.envModifier.id}`;
      this.envBannerEl.innerHTML = `<span class="v3-sector-mod-badge">${svgIcon(envIcon, 13)} ${
        sector.name
      } · ${sector.envModifier.name}</span><span class="v3-sector-mod-desc">${
        sector.envModifier.combatRuleSummary
      }</span>`;
    }

    // Final campaign banner (before tacticalStripEl)
    if (this.finalBannerEl && this.tacticalStripEl) {
      if (run.isFinalCampaignRun) {
        if (this.finalBannerEl.parentElement !== this.scrollBodyEl) {
          this.scrollBodyEl.insertBefore(this.finalBannerEl, this.tacticalStripEl);
        }
      } else if (this.finalBannerEl.parentElement) {
        this.finalBannerEl.remove();
      }
    }

    // Endless banner (before tacticalStripEl)
    const endlessThreat = run.endlessThreat ?? 0;
    if (this.endlessBannerEl && this.tacticalStripEl) {
      if (endlessThreat >= 1) {
        const eKey = `${endlessThreat}:${run.seed}:${(run.endlessMutatorIds ?? []).join(',')}`;
        if (this.lastEndlessKey !== eKey) {
          this.lastEndlessKey = eKey;
          this.endlessBannerEl.innerHTML = `
            <div class="v3-endless-hud-head">
              <span>${svgIcon('bolt', 12)} 无尽深渊 · 威压 ${endlessThreat}</span>
              <span class="num">种子 #${run.seed}</span>
            </div>
            ${
              run.endlessMutatorIds && run.endlessMutatorIds.length > 0
                ? `<div class="v3-endless-mut-chips">
                    ${run.endlessMutatorIds
                      .map((mid) => {
                        const def = getV3EndlessMutatorDef(mid);
                        return `<span class="v3-endless-mut-chip">词条 · ${def?.name ?? mid}：${
                          def?.combatRuleSummary ?? ''
                        }</span>`;
                      })
                      .join('')}
                  </div>`
                : ''
            }
          `;
        }
        if (this.endlessBannerEl.parentElement !== this.scrollBodyEl) {
          this.scrollBodyEl.insertBefore(this.endlessBannerEl, this.tacticalStripEl);
        }
      } else {
        this.lastEndlessKey = null;
        if (this.endlessBannerEl.parentElement) this.endlessBannerEl.remove();
      }
    }

    // Tactical mode strip
    const tacKey = `${pureAutoCombat ? 'auto' : 'active'}:${chargesMax}:${sigDef.label}`;
    if (this.tacticalStripEl && this.lastTacticalKey !== tacKey) {
      this.lastTacticalKey = tacKey;
      if (pureAutoCombat) {
        this.tacticalStripEl.className = 'v3-tactical-mode-strip is-auto';
        this.tacticalStripEl.innerHTML = `<span class="v3-tactic-pill muted">${svgIcon(
          'bolt',
          12
        )} 纯自动战斗模式</span><span class="v3-tactic-desc">按当前配装自动完成全轮交火（可在设置中切回主动战术指令）</span>`;
      } else {
        this.tacticalStripEl.className = 'v3-tactical-mode-strip is-active';
        this.tacticalStripEl.innerHTML = `<span class="v3-tactic-pill">${svgIcon(
          'bolt',
          12
        )} 主动战术 · 指令充能 ${chargesMax}/${chargesMax}</span><span class="v3-tactic-desc">通用指令（火力过载 / 紧急护盾 / 聚焦校准）+ 专属「${
          sigDef.label
        }」</span>`;
      }
    }

    // Overcharge banner / Pre-combat gadgets (before bossDossierEl or rosterEl)
    const overchargeGadgets = run.bay.placed
      .map((p) => ({ item: p.item, def: getV3GadgetDef(p.item.definitionId) }))
      .filter(
        (entry): entry is { item: typeof entry.item; def: NonNullable<typeof entry.def> } =>
          Boolean(entry.def && entry.def.usableIn === 'combat_pre')
      );

    if (this.overchargeBannerEl && this.gadgetBarEl && this.gadgetBtnsWrapEl) {
      const anchor =
        this.bossDossierEl && this.bossDossierEl.parentElement === this.scrollBodyEl
          ? this.bossDossierEl
          : this.rosterEl;
      if (run.overchargeCellActive) {
        if (this.gadgetBarEl.parentElement) this.gadgetBarEl.remove();
        if (this.overchargeBannerEl.parentElement !== this.scrollBodyEl) {
          this.scrollBodyEl.insertBefore(this.overchargeBannerEl, anchor);
        }
      } else if (overchargeGadgets.length > 0 && actions.onUseGadget) {
        if (this.overchargeBannerEl.parentElement) this.overchargeBannerEl.remove();
        const nextIds = new Set<string>(overchargeGadgets.map((g) => g.item.instanceId));
        for (const [gid, btn] of this.gadgetBtns.entries()) {
          if (!nextIds.has(gid)) {
            btn.remove();
            this.gadgetBtns.delete(gid);
          }
        }
        overchargeGadgets.forEach(({ item, def }, idx) => {
          const chk = canUseV3GadgetInRun(run, item.instanceId);
          let btn = this.gadgetBtns.get(item.instanceId);
          if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-sm btn-primary v3-gadget-use-btn';
            btn.dataset.useGadget = item.instanceId;
            btn.dataset.gadgetKind = def.kind;
            btn.dataset.gadgetId = def.kind;
            btn.dataset.testid = `use-gadget-${def.kind}`;
            btn.textContent = `⚡ 使用${def.buttonLabel}（${def.shortEffectLabel}）`;
            this.gadgetBtns.set(item.instanceId, btn);
          }
          syncButtonDisabled(btn, readOnly || !chk.usable);
          const curAtIdx = this.gadgetBtnsWrapEl!.children[idx];
          if (curAtIdx !== btn) {
            this.gadgetBtnsWrapEl!.insertBefore(btn, curAtIdx ?? null);
          }
        });
        if (this.gadgetBarEl.parentElement !== this.scrollBodyEl) {
          this.scrollBodyEl.insertBefore(this.gadgetBarEl, anchor);
        }
      } else {
        if (this.overchargeBannerEl.parentElement) this.overchargeBannerEl.remove();
        if (this.gadgetBarEl.parentElement) this.gadgetBarEl.remove();
      }
    }

    // Boss dossier (before rosterEl)
    if (this.bossDossierEl) {
      if (bossDef) {
        const bKey = bossDef.bossId;
        if (this.lastBossKey !== bKey) {
          this.lastBossKey = bKey;
          this.bossDossierEl.innerHTML = `
            <div class="v3-boss-dossier-head">
              <strong>${svgIcon('boss', 14)} ${bossDef.name}</strong>
              <span class="v3-boss-phase-pill">阶段 P1 / ${bossDef.phases.length} · ${bossDef.phaseCountLabel}</span>
            </div>
            <div class="v3-boss-dossier-sub">${bossDef.tacticalOverview}</div>
            <div class="v3-boss-phase-list">
              ${bossDef.phases
                .map(
                  (ph) => `<div class="v3-boss-phase-item">
                    <span class="v3-bp-tag">P${ph.phaseNumber} · ${ph.name}${
                    ph.hpThresholdRatio < 1 ? ` (≤${Math.round(ph.hpThresholdRatio * 100)}% HP)` : ''
                  }</span>
                    <span class="v3-bp-desc">${ph.summary}</span>
                  </div>`
                )
                .join('')}
            </div>
          `;
        }
        if (this.bossDossierEl.parentElement !== this.scrollBodyEl) {
          this.scrollBodyEl.insertBefore(this.bossDossierEl, this.rosterEl);
        }
      } else {
        this.lastBossKey = null;
        if (this.bossDossierEl.parentElement) this.bossDossierEl.remove();
      }
    }

    // Enemy roster
    const mutFx = aggregateEndlessMutatorEffects(run.endlessMutatorIds);
    const rosterKey = `${node.nodeId}:${bossId ?? ''}:${mutFx.enemyPierceBonus}:${node.combat.units
      .map((u) => {
        const s = pv?.initialEnemies.find((e) => e.enemyId === u.enemyId);
        return `${u.enemyId}:${s?.shield ?? u.initialShield ?? 0}:${s?.armor ?? u.armor}:${
          s?.pierceRatio ?? u.pierceRatio
        }`;
      })
      .join(',')}`;
    if (this.lastRosterKey !== rosterKey) {
      this.lastRosterKey = rosterKey;
      this.rosterEl.innerHTML = node.combat.units
        .map((u) => {
          const initSnap = pv?.initialEnemies.find((s) => s.enemyId === u.enemyId);
          const cycle = getUnitIntentCyclePreview(u, node.combat!.encounterKind, bossId);
          const initShield = resolveUnitInitialShield(u, node.combat!.encounterKind, bossId);
          const dispShield = initSnap?.shield ?? initShield.shield;
          const dispArmor = initSnap?.armor ?? u.armor;
          const dispPierce = initSnap?.pierceRatio ?? u.pierceRatio;
          const intentCycleHtml = cycle
            .map((intent, idx) => {
              const dispIntent: V3EnemyIntent =
                intent.damage > 0 && mutFx.enemyPierceBonus > 0
                  ? {
                      ...intent,
                      pierceRatio: Math.min(
                        0.65,
                        Number(
                          (
                            Math.max(0, Math.min(1, intent.pierceRatio ?? u.pierceRatio)) +
                            mutFx.enemyPierceBonus
                          ).toFixed(2)
                        )
                      ),
                    }
                  : intent;
              return `<span class="enemy-intent-badge ${getIntentToneClass(
                dispIntent.kind
              )}" data-enemy-intent="${dispIntent.kind}" ${
                idx === 0 ? `data-testid="enemy-intent-${u.enemyId}"` : ''
              }>R${idx + 1} ${formatIntentShortText(dispIntent)}</span>`;
            })
            .join('');
          const roleTag = u.isBoss
            ? '首领单位'
            : dispPierce > 0
            ? '穿盾火力'
            : dispArmor > 0
            ? '装甲单位'
            : dispShield > 0
            ? '护盾单位'
            : '常规编队';
          return `<div class="v2-enemy-chip v3-enemy-card ${u.isBoss ? 'is-boss' : ''}">
            <div class="v3-enemy-card-head">
              <strong>${u.name}</strong>
              <span class="v3-enemy-role-badge">${roleTag}</span>
            </div>
            <div class="intent-cycle">
              <span class="v3-intent-prefix">行动意图</span>
              ${intentCycleHtml}
            </div>
          </div>`;
        })
        .join('');
    }

    // S04 single-enemy policy box (STRICTLY detached when units.length <= 1!)
    if (this.policyBoxEl && this.policyWeakestBtnEl && this.policyThreatBtnEl) {
      if (node.combat.units.length > 1) {
        const weakCls = `btn btn-sm ${
          run.targetPolicy === 'weakest' ? 'btn-primary' : 'btn-secondary'
        }`;
        const threatCls = `btn btn-sm ${
          run.targetPolicy === 'highest_threat' ? 'btn-primary' : 'btn-secondary'
        }`;
        if (this.policyWeakestBtnEl.className !== weakCls) {
          this.policyWeakestBtnEl.className = weakCls;
        }
        if (this.policyThreatBtnEl.className !== threatCls) {
          this.policyThreatBtnEl.className = threatCls;
        }
        syncButtonDisabled(this.policyWeakestBtnEl, readOnly);
        syncButtonDisabled(this.policyThreatBtnEl, readOnly);
        if (this.policyBoxEl.parentElement !== this.scrollBodyEl) {
          const anchor =
            this.previewCardEl && this.previewCardEl.parentElement === this.scrollBodyEl
              ? this.previewCardEl
              : null;
          this.scrollBodyEl.insertBefore(this.policyBoxEl, anchor);
        }
      } else if (this.policyBoxEl.parentElement) {
        this.policyBoxEl.remove();
      }
    }

    // S06 Qualitative Threat Preview Card + Details Drawer
    const pvThreat = pv
      ? classifyV2CombatThreat(
          { outcome: pv.outcome, playerFinalHp: pv.finalPlayerHpAfterRepair },
          run.maxHp
        )
      : null;
    const pvThreatMeta = pvThreat ? getV2ThreatTierMeta(pvThreat.tier) : null;

    if (
      this.previewCardEl &&
      this.previewHeadTitleEl &&
      this.threatPillEl &&
      this.previewBodyEl &&
      this.toggleLogBtnEl &&
      this.detailsDrawerEl
    ) {
      if (pv && pvThreatMeta) {
        if (this.previewCardEl.parentElement !== this.scrollBodyEl) {
          this.scrollBodyEl.appendChild(this.previewCardEl);
        }
        const cardCls = `v2-combat-preview-card ${pvThreatMeta.riskClass} threat-${pvThreatMeta.tier}`;
        if (this.previewCardEl.className !== cardCls) this.previewCardEl.className = cardCls;
        const finalHpStr = String(pv.outcome === 'victory' ? pv.finalPlayerHpAfterRepair : 0);
        if (this.previewCardEl.dataset.previewFinalHp !== finalHpStr) {
          this.previewCardEl.dataset.previewFinalHp = finalHpStr;
        }
        if (this.previewCardEl.dataset.threatTier !== pvThreatMeta.tier) {
          this.previewCardEl.dataset.threatTier = pvThreatMeta.tier;
        }

        const headTitle = !pureAutoCombat ? '基础配装威胁评估' : '战前威胁评估';
        if (this.previewHeadTitleEl.textContent !== headTitle) {
          this.previewHeadTitleEl.textContent = headTitle;
        }

        const pillCls = `v3-threat-pill threat-${pvThreatMeta.tier}`;
        if (this.threatPillEl.className !== pillCls) this.threatPillEl.className = pillCls;
        const pillText = `${pvThreatMeta.symbol} ${pvThreatMeta.label}`;
        if (this.threatPillEl.textContent !== pillText) this.threatPillEl.textContent = pillText;

        const bodyKey = `${pvThreatMeta.layer1Summary}:${pureAutoCombat ? 1 : 0}:${chargesMax}`;
        if (this.lastPreviewBodyKey !== bodyKey) {
          this.lastPreviewBodyKey = bodyKey;
          this.previewBodyEl.innerHTML = `${pvThreatMeta.layer1Summary}${
            !pureAutoCombat
              ? ` · <strong>战中可施放 ${chargesMax} 次战术指令改写战局</strong>`
              : ''
          }`;
        }

        this.toggleLogBtnEl.setAttribute('aria-expanded', showCombatLogDetails ? 'true' : 'false');
        const toggleText = showCombatLogDetails ? '收起详细推演' : '查看不干预推演明细';
        if (this.toggleLogBtnEl.textContent !== toggleText) {
          this.toggleLogBtnEl.textContent = toggleText;
        }

        if (showCombatLogDetails) {
          const enemyDetailsListHtml = node.combat.units
            .map((u) => {
              const initSnap = pv.initialEnemies.find((e) => e.enemyId === u.enemyId);
              const initShield = resolveUnitInitialShield(u, node.combat!.encounterKind, bossId);
              const dispMaxHp = initSnap?.maxHp ?? u.maxHp;
              const dispShield = initSnap?.shield ?? initShield.shield;
              const dispDmg = initSnap?.damagePerRound ?? u.damagePerRound + mutFx.enemyDamageBonus;
              const dispArmor = initSnap?.armor ?? u.armor;
              const dispPierce = initSnap?.pierceRatio ?? u.pierceRatio;
              return `<div class="v3-drawer-enemy-row"><strong>${u.name}</strong>：HP ${dispMaxHp}${
                dispShield > 0 ? ` · 盾 ${dispShield}` : ''
              } · 攻 ${dispDmg}${dispArmor > 0 ? ` · 甲 ${dispArmor}` : ''}${
                dispPierce > 0 ? ` · 穿盾 ${Math.round(dispPierce * 100)}%` : ''
              }</div>`;
            })
            .join('');

          const cargoPerCellSummary = run.bay.placed
            .filter((p) => p.item.category === 'cargo' && p.item.fixedValue > 0)
            .map((p) => {
              const def = getAnyV2ItemDef(p.item.definitionId);
              const cells = def ? Math.max(1, V2_SHAPES[def.shapeId].cells.length) : 1;
              const perCell = (p.item.fixedValue / cells).toFixed(1);
              return `${def?.name ?? p.item.definitionId} ${perCell}¤/格`;
            })
            .join(' · ');

          const drawerKey = `${pv.outcome}:${pv.finalPlayerHpAfterRepair}:${pv.roundsCount}:${pv.startingPlayerHp}:${pv.startingPlayerShield}:${pv.repairApplied}:${enemyDetailsListHtml}:${cargoPerCellSummary}`;
          if (this.lastDrawerKey !== drawerKey) {
            this.lastDrawerKey = drawerKey;
            this.detailsDrawerEl.innerHTML = `
              <div class="v3-drawer-head">
                <span class="v3-drawer-tag">不干预时结果</span>
                <strong class="num">${
                  pv.outcome === 'victory'
                    ? `预计获胜 · 余 ${pv.finalPlayerHpAfterRepair}HP (${pv.roundsCount}轮)`
                    : `预计战败 · 余 0HP (${pv.roundsCount}轮)`
                }</strong>
              </div>
              <div class="v3-drawer-sub">
                起始耐久 ${pv.startingPlayerHp} · 护盾 ${pv.startingPlayerShield}${
              pv.repairApplied > 0 ? ` · 胜后维修 +${pv.repairApplied}` : ''
            }
              </div>
              <div class="v3-drawer-enemies">${enemyDetailsListHtml}</div>
              ${
                cargoPerCellSummary
                  ? `<div class="v3-drawer-cargo">当前货舱单格价值：${cargoPerCellSummary}</div>`
                  : ''
              }
              <div class="v2-combat-log-list">
                ${pv.rounds
                  .slice(0, 10)
                  .map((r) => {
                    const phaseNote = r.bossPhaseTransitions?.length
                      ? ` · ★ ${r.bossPhaseTransitions.map((t) => t.label).join(' / ')}`
                      : '';
                    const specialNote = r.enemySpecialNotes?.length
                      ? ` · ${r.enemySpecialNotes[0]}`
                      : '';
                    return `<div class="v2-log-row">R${r.round}: 我方 ${r.playerAttacks.reduce(
                      (s, a) => s + a.appliedDamage,
                      0
                    )}伤${r.counterAttack ? `+反击${r.counterAttack.appliedDamage}` : ''} · 敌方 ${r.enemyAttacks.reduce(
                      (s, a) => s + a.hullDamage,
                      0
                    )}直伤(盾吸${r.shieldAbsorbedTotal}) → ${r.playerHpAfter}HP${
                      r.envModifierEvent ? ` · [${r.envModifierEvent}]` : ''
                    }${phaseNote || specialNote}</div>`;
                  })
                  .join('')}
              </div>
            `;
          }
          if (this.detailsDrawerEl.parentElement !== this.previewCardEl) {
            this.previewCardEl.appendChild(this.detailsDrawerEl);
          }
        } else if (this.detailsDrawerEl.parentElement) {
          this.detailsDrawerEl.remove();
        }
      } else if (this.previewCardEl.parentElement) {
        this.previewCardEl.remove();
      }
    }

    // Sticky CTA Footer (auto-engage buttons stay === across all updates & ticks!)
    if (this.startBtnEl && this.autoProgressEl && this.autoLabelEl) {
      const status = autoEngage?.status ?? 'idle';
      this.startBtnEl.classList.toggle('is-countdown', status === 'countdown');
      this.startBtnEl.dataset.autoEngageStatus = status;
      this.startBtnEl.dataset.autoEngageRemainingMs = String(
        Math.max(0, Math.round(autoEngage?.remainingMs ?? PRE_COMBAT_AUTO_ENGAGE_MS))
      );
      syncButtonDisabled(this.startBtnEl, readOnly);
      const pctStr = `${computeAutoEngageProgressPct(autoEngage)}%`;
      if (this.autoProgressEl.style.width !== pctStr) {
        this.autoProgressEl.style.width = pctStr;
      }
      const nextLabel = formatAutoEngageStartLabel(autoEngage);
      if (this.autoLabelEl.textContent !== nextLabel) {
        this.autoLabelEl.textContent = nextLabel;
      }
    }

    if (this.pauseBtnEl) {
      const isPaused = autoEngage?.status === 'paused';
      const isCountdown = autoEngage?.status === 'countdown';
      this.pauseBtnEl.classList.toggle('is-paused', isPaused);
      this.pauseBtnEl.setAttribute('aria-pressed', isPaused ? 'true' : 'false');
      syncButtonDisabled(
        this.pauseBtnEl,
        readOnly || !autoEngage || autoEngage.status === 'engaged' || autoEngage.status === 'idle'
      );
      const pauseText = isCountdown ? '暂停 / 调整' : '继续自动交火';
      if (this.pauseBtnEl.textContent !== pauseText) {
        this.pauseBtnEl.textContent = pauseText;
      }
    }
  }

  unmount(): void {
    this.rootEl?.removeEventListener('click', this.handleRootClick);
    this.rootEl?.remove();
    this.gadgetBtns.clear();
    this.hostEl = null;
    this.rootEl = null;
    this.scrollBodyEl = null;
    this.titleEl = null;
    this.bountyValEl = null;
    this.envBannerEl = null;
    this.finalBannerEl = null;
    this.endlessBannerEl = null;
    this.tacticalStripEl = null;
    this.overchargeBannerEl = null;
    this.gadgetBarEl = null;
    this.gadgetBtnsWrapEl = null;
    this.bossDossierEl = null;
    this.rosterEl = null;
    this.policyBoxEl = null;
    this.policyWeakestBtnEl = null;
    this.policyThreatBtnEl = null;
    this.previewCardEl = null;
    this.previewHeadTitleEl = null;
    this.threatPillEl = null;
    this.previewBodyEl = null;
    this.toggleLogBtnEl = null;
    this.detailsDrawerEl = null;
    this.startBtnEl = null;
    this.autoProgressEl = null;
    this.autoLabelEl = null;
    this.pauseBtnEl = null;
    this.latestActions = null;
    this.lastTitleKey = null;
    this.lastEnvKey = null;
    this.lastEndlessKey = null;
    this.lastTacticalKey = null;
    this.lastBossKey = null;
    this.lastRosterKey = null;
    this.lastPreviewBodyKey = null;
    this.lastDrawerKey = null;
  }
}

const legacyCombatPreViews = new WeakMap<HTMLElement, CombatPrePhaseView>();

export function renderCombatPreView(
  leftPanelEl: HTMLElement,
  props: CombatPreViewProps,
  actions: CombatPreViewActions
): void {
  let view = legacyCombatPreViews.get(leftPanelEl);
  if (!view) {
    view = new CombatPrePhaseView();
    legacyCombatPreViews.set(leftPanelEl, view);
  }
  if (!view.isMountedIn(leftPanelEl)) {
    view.mount(leftPanelEl);
  }
  view.update(props, actions);
}

export interface CombatLiveOverlayProps {
  readonly run: V2RunState;
  readonly liveCombatRound: number;
  readonly liveCombatPlayerHp: number;
  readonly liveCombatPlayerShield: number;
  readonly liveCombatEnemiesAlive: number;
  readonly liveCombatEventLine: string;
  readonly liveEnemySnapshots: readonly V2CombatUnitSnapshot[];
  readonly livePhaseBannerText: string | null;
  readonly awaitingEliteDecision: boolean;
  readonly combatSpeed: 1 | 2;
}

export interface CombatLiveOverlayActions {
  readonly onPeekBay: () => void;
  readonly onToggleSpeed: () => void;
  readonly onSkipPlayback: () => void;
  readonly onCommitEliteTactic: (decisionId: string, choice: V2EliteTacticChoice) => void;
}

export class CombatLivePhaseView
  implements PhaseView<CombatLiveOverlayProps, CombatLiveOverlayActions>
{
  private hostEl: HTMLElement | null = null;
  private rootEl: HTMLDivElement | null = null;
  private statusGroupEl: HTMLDivElement | null = null;
  private peekBtnEl: HTMLButtonElement | null = null;
  private speedBtnEl: HTMLButtonElement | null = null;
  private skipBtnEl: HTMLButtonElement | null = null;

  private bossSlotEl: HTMLDivElement | null = null;
  private phaseSlotEl: HTMLDivElement | null = null;
  private intentSlotEl: HTMLDivElement | null = null;
  private tickerSlotEl: HTMLDivElement | null = null;
  private decisionSlotEl: HTMLDivElement | null = null;

  // Persistent tactical decision bar & keyed option buttons
  private decisionBarEl: HTMLDivElement | null = null;
  private decisionTitleEl: HTMLElement | null = null;
  private decisionChargesEl: HTMLSpanElement | null = null;
  private decisionThreatEl: HTMLSpanElement | null = null;
  private decisionOptionsEl: HTMLDivElement | null = null;
  private readonly tacticBtns = new Map<string, HTMLButtonElement>();
  private readonly tacticContentKeys = new Map<string, string>();

  private latestActions: CombatLiveOverlayActions | null = null;
  private latestShowDecisionBar = false;
  private latestPendingDecisionId: string | null = null;
  private lastStatusHtml: string | null = null;
  private lastBossHtml: string | null = null;
  private lastPhaseHtml: string | null = null;
  private lastIntentHtml: string | null = null;
  private lastTickerHtml: string | null = null;

  private readonly handleRootClick = (ev: Event): void => {
    if (!this.rootEl || !this.latestActions) return;
    const target = ev.target as HTMLElement | null;
    if (!target || typeof target.closest !== 'function') return;
    const btn = target.closest('button') as HTMLButtonElement | null;
    if (!btn || !this.rootEl.contains(btn) || btn.disabled) return;

    if (btn === this.peekBtnEl || btn.id === 'v2-combat-peek-bay') {
      this.latestActions.onPeekBay();
      return;
    }
    if (btn === this.speedBtnEl || btn.id === 'v2-combat-speed') {
      this.latestActions.onToggleSpeed();
      return;
    }
    if (btn === this.skipBtnEl || btn.id === 'v2-combat-skip') {
      if (this.latestShowDecisionBar) return;
      this.latestActions.onSkipPlayback();
      return;
    }
    const tacticChoice = btn.dataset.eliteTactic as V2EliteTacticChoice | undefined;
    if (tacticChoice && this.latestShowDecisionBar && this.latestPendingDecisionId) {
      this.latestActions.onCommitEliteTactic(this.latestPendingDecisionId, tacticChoice);
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
    root.className = 'v3-overlay-screen v3-combat-live-overlay';
    root.dataset.testid = 'combat-screen';
    root.dataset.liveMounted = '1';

    // Top Combat Hero HUD Bar
    const hudBar = document.createElement('div');
    hudBar.className = 'combat-hud-bar v2-combat-hero-hud';

    const statusGroup = document.createElement('div');
    statusGroup.className = 'v2-combat-status-group';
    statusGroup.dataset.slot = 'combat-status-group';
    hudBar.appendChild(statusGroup);

    const ctrlGroup = document.createElement('div');
    ctrlGroup.className = 'v2-combat-ctrl-group';

    const peekBtn = document.createElement('button');
    peekBtn.type = 'button';
    peekBtn.className = 'btn btn-sm btn-ghost';
    peekBtn.id = 'v2-combat-peek-bay';
    peekBtn.innerHTML = `${svgIcon('grid', 13)} 查看船舱`;

    const speedBtn = document.createElement('button');
    speedBtn.type = 'button';
    speedBtn.className = 'btn btn-sm btn-secondary';
    speedBtn.id = 'v2-combat-speed';
    speedBtn.textContent = '1×';

    const skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.className = 'btn btn-sm btn-primary';
    skipBtn.id = 'v2-combat-skip';
    skipBtn.dataset.testid = 'btn-combat-skip';
    skipBtn.textContent = '跳过演出';

    ctrlGroup.appendChild(peekBtn);
    ctrlGroup.appendChild(speedBtn);
    ctrlGroup.appendChild(skipBtn);
    hudBar.appendChild(ctrlGroup);
    root.appendChild(hudBar);

    const makeSlot = (name: string): HTMLDivElement => {
      const el = document.createElement('div');
      el.dataset.slot = name;
      root.appendChild(el);
      return el;
    };

    const bossSlot = makeSlot('boss-hud');
    const phaseSlot = makeSlot('phase-banner');
    const intentSlot = makeSlot('intent-strip');
    const tickerSlot = makeSlot('event-ticker');
    const decisionSlot = makeSlot('decision-bar');

    // Persistent Tactical Bar (detached until showDecisionBar === true)
    const decisionBar = document.createElement('div');
    decisionBar.className = 'v2-elite-tactic-overlay v3-tactical-bar';
    decisionBar.dataset.testid = 'combat-tactical-bar';
    decisionBar.setAttribute('role', 'region');
    decisionBar.setAttribute('aria-label', '主动战术指令面板');

    const etHead = document.createElement('div');
    etHead.className = 'v2-et-head v3-et-head';
    const titleGroup = document.createElement('div');
    titleGroup.className = 'v3-et-title-group';
    const decisionTitle = document.createElement('strong');
    const decisionCharges = document.createElement('span');
    decisionCharges.className = 'v3-tactical-charges-pill';
    decisionCharges.dataset.testid = 'combat-tactical-charges';
    titleGroup.appendChild(decisionTitle);
    titleGroup.appendChild(decisionCharges);
    const decisionThreat = document.createElement('span');
    decisionThreat.className = 'v3-et-threat';
    etHead.appendChild(titleGroup);
    etHead.appendChild(decisionThreat);
    decisionBar.appendChild(etHead);

    const decisionOptions = document.createElement('div');
    decisionOptions.className = 'v2-et-options v3-tactical-options';
    decisionBar.appendChild(decisionOptions);

    host.appendChild(root);
    root.addEventListener('click', this.handleRootClick);

    this.rootEl = root;
    this.statusGroupEl = statusGroup;
    this.peekBtnEl = peekBtn;
    this.speedBtnEl = speedBtn;
    this.skipBtnEl = skipBtn;
    this.bossSlotEl = bossSlot;
    this.phaseSlotEl = phaseSlot;
    this.intentSlotEl = intentSlot;
    this.tickerSlotEl = tickerSlot;
    this.decisionSlotEl = decisionSlot;
    this.decisionBarEl = decisionBar;
    this.decisionTitleEl = decisionTitle;
    this.decisionChargesEl = decisionCharges;
    this.decisionThreatEl = decisionThreat;
    this.decisionOptionsEl = decisionOptions;
  }

  update(props: CombatLiveOverlayProps, actions: CombatLiveOverlayActions): void {
    this.latestActions = actions;
    if (!this.rootEl) return;

    const {
      run,
      liveCombatRound,
      liveCombatPlayerHp,
      liveCombatPlayerShield,
      liveCombatEnemiesAlive,
      liveCombatEventLine,
      liveEnemySnapshots,
      livePhaseBannerText,
      awaitingEliteDecision,
      combatSpeed,
    } = props;
    const sim = run.activeCombat?.simulation;
    if (!sim) return;

    const currentNode = run.currentNodeId ? run.graph.nodes[run.currentNodeId] : null;
    const bossId = currentNode ? resolveNodeBossId(currentNode, run) : sim.bossId;
    const bossDef = resolveV3BossDefForEncounter({
      encounterKind: currentNode?.combat?.encounterKind,
      bossId,
      units: liveEnemySnapshots.length > 0 ? liveEnemySnapshots : sim.initialEnemies,
    });

    const pending = run.activeCombat?.pendingDecision;
    const showDecisionBar = Boolean(awaitingEliteDecision && pending && pending.chosen === null);
    this.latestShowDecisionBar = showDecisionBar;
    this.latestPendingDecisionId = pending?.decisionId ?? null;

    const hpPct = Math.max(
      0,
      Math.min(100, Math.round((liveCombatPlayerHp / Math.max(1, run.maxHp)) * 100))
    );
    const chargesMax = Math.max(0, pending?.chargesMax ?? run.tacticalChargesMax ?? 1);
    const chargesUsed = Math.max(0, run.tacticalChargesUsed ?? 0);
    const chargesRemaining = Math.max(0, chargesMax - chargesUsed);

    // Status strip
    const sector = getV3SectorDef(run.sectorId);
    const envPillHtml =
      sector.envModifier.id !== 'none'
        ? `<span class="combat-pill v3-env-pill env-${sector.envModifier.id}" data-testid="combat-sector-modifier">${svgIcon(
            sector.envModifier.id === 'cryo_ion' ? 'cryo' : 'gravity',
            12
          )} ${sector.name} · ${sector.envModifier.name}</span>`
        : '';

    const endlessLivePillHtml =
      (run.endlessThreat ?? 0) >= 1
        ? `<span class="combat-pill v3-hud-endless-chip" data-testid="combat-live-endless-pill">${svgIcon(
            'bolt',
            12
          )} 威压 ${run.endlessThreat}${
            run.endlessMutatorIds && run.endlessMutatorIds.length > 0
              ? ` · ${run.endlessMutatorIds
                  .map((mid) => getV3EndlessMutatorDef(mid)?.name ?? mid)
                  .join('/')}`
              : ''
          }</span>`
        : '';

    const statusGroupHtml = `
      <span class="combat-pill">回合 <strong class="num">${liveCombatRound}/${sim.roundsCount}</strong></span>
      <span class="combat-pill v2-hp-pill">
        ${svgIcon('hull', 13)}
        <span class="v2-mini-bar"><span style="width:${hpPct}%"></span></span>
        <strong class="num">${liveCombatPlayerHp}/${run.maxHp}</strong>
      </span>
      <span class="combat-pill">${svgIcon('shield', 13)} <strong class="num">${liveCombatPlayerShield}</strong></span>
      <span class="combat-pill">${svgIcon('combat', 13)} 敌 <strong class="num">${liveCombatEnemiesAlive}</strong></span>
      <span class="combat-pill v3-charge-pill">${svgIcon('bolt', 12)} 充能 <strong class="num">${chargesRemaining}/${chargesMax}</strong></span>
      ${envPillHtml}
      ${endlessLivePillHtml}
    `;
    if (this.statusGroupEl && this.lastStatusHtml !== statusGroupHtml) {
      this.lastStatusHtml = statusGroupHtml;
      this.statusGroupEl.innerHTML = statusGroupHtml;
    }

    // Persistent controls
    if (this.speedBtnEl) {
      const speedText = `${combatSpeed}×`;
      if (this.speedBtnEl.textContent !== speedText) this.speedBtnEl.textContent = speedText;
    }
    if (this.skipBtnEl) {
      syncButtonDisabled(this.skipBtnEl, showDecisionBar);
      const skipText = showDecisionBar ? '等待指令' : '跳过演出';
      if (this.skipBtnEl.textContent !== skipText) this.skipBtnEl.textContent = skipText;
    }

    // Boss HUD
    const bossSnap = liveEnemySnapshots.find((e) => e.isBoss);
    const bossHudHtml =
      bossDef && bossSnap
        ? (() => {
            const curPhase = bossSnap.currentPhase ?? 1;
            const totalPhases = bossSnap.totalPhases ?? bossDef.phases.length;
            const phaseDef = bossDef.phases[curPhase - 1] ?? bossDef.phases[0];
            const bossHpPct = Math.max(
              0,
              Math.min(100, Math.round((bossSnap.hp / Math.max(1, bossSnap.maxHp)) * 100))
            );
            const thresholdMarkers = bossDef.phases
              .filter((p) => p.hpThresholdRatio < 1)
              .map(
                (p) =>
                  `<span class="v3-boss-threshold-tick" style="left:${Math.round(
                    p.hpThresholdRatio * 100
                  )}%" title="阶段 P${p.phaseNumber} 阈值 ${Math.round(p.hpThresholdRatio * 100)}%"></span>`
              )
              .join('');
            return `<div class="v3-boss-phase-hud">
              <div class="v3-boss-hud-row">
                <span class="v3-boss-hud-name">${svgIcon('boss', 13)} ${bossDef.name}</span>
                <span class="v3-boss-phase-badge" data-testid="boss-phase-badge">阶段 P${curPhase}/${totalPhases} · ${phaseDef.name}</span>
                <span class="v3-boss-hud-hp num">${bossSnap.hp}/${bossSnap.maxHp} HP${
              bossSnap.shield && bossSnap.shield > 0 ? ` · 盾 ${bossSnap.shield}` : ''
            }${bossSnap.armor > 0 ? ` · 甲 ${bossSnap.armor}` : ''}</span>
              </div>
              <div class="v3-boss-hp-track">
                <div class="v3-boss-hp-fill" style="width:${bossHpPct}%"></div>
                ${thresholdMarkers}
              </div>
            </div>`;
          })()
        : '';
    if (this.bossSlotEl && this.lastBossHtml !== bossHudHtml) {
      this.lastBossHtml = bossHudHtml;
      this.bossSlotEl.innerHTML = bossHudHtml;
    }

    // Phase banner
    const phaseBannerHtml = livePhaseBannerText
      ? `<div class="v3-boss-phase-banner" data-testid="boss-phase-banner">${svgIcon(
          'boss',
          14
        )} ${livePhaseBannerText}</div>`
      : '';
    if (this.phaseSlotEl && this.lastPhaseHtml !== phaseBannerHtml) {
      this.lastPhaseHtml = phaseBannerHtml;
      this.phaseSlotEl.innerHTML = phaseBannerHtml;
    }

    // Live enemy intent strip
    const livingSnaps = liveEnemySnapshots.filter((e) => e.hp > 0);
    const liveIntentStripHtml =
      livingSnaps.length > 0
        ? `<div class="v3-live-intent-strip">
            ${livingSnaps
              .slice(0, 4)
              .map((e) => {
                const intent = e.nextIntent;
                const intentKind = intent?.kind ?? 'attack';
                const intentText = intent
                  ? formatIntentShortText(intent)
                  : `攻 ${e.damagePerRound}`;
                return `<span class="enemy-intent-badge ${getIntentToneClass(
                  intentKind
                )}" data-enemy-intent="${intentKind}" data-testid="enemy-intent-${e.enemyId}">
                  ${e.name}：${intentText}${e.shield && e.shield > 0 ? ` · 敌盾${e.shield}` : ''}
                </span>`;
              })
              .join('')}
          </div>`
        : '';
    if (this.intentSlotEl && this.lastIntentHtml !== liveIntentStripHtml) {
      this.lastIntentHtml = liveIntentStripHtml;
      this.intentSlotEl.innerHTML = liveIntentStripHtml;
    }

    // Event ticker
    const tickerHtml =
      !showDecisionBar && liveCombatEventLine
        ? `<div class="v2-combat-event-ticker v3-combat-event-ticker">${liveCombatEventLine}</div>`
        : '';
    if (this.tickerSlotEl && this.lastTickerHtml !== tickerHtml) {
      this.lastTickerHtml = tickerHtml;
      this.tickerSlotEl.innerHTML = tickerHtml;
    }

    // Keyed Tactical Orders Decision Bar
    if (
      this.decisionSlotEl &&
      this.decisionBarEl &&
      this.decisionTitleEl &&
      this.decisionChargesEl &&
      this.decisionThreatEl &&
      this.decisionOptionsEl
    ) {
      if (!showDecisionBar || !pending) {
        if (this.decisionBarEl.parentElement) {
          this.decisionBarEl.remove();
        }
      } else {
        if (this.decisionBarEl.parentElement !== this.decisionSlotEl) {
          this.decisionSlotEl.appendChild(this.decisionBarEl);
        }
        const titleHtml = `${svgIcon('bolt', 15)} 第 ${pending.roundNumber} 回合 · 战术指令`;
        if (this.decisionTitleEl.innerHTML !== titleHtml) {
          this.decisionTitleEl.innerHTML = titleHtml;
        }
        const chargesText = `指令充能 ${chargesRemaining}/${chargesMax}`;
        if (this.decisionChargesEl.textContent !== chargesText) {
          this.decisionChargesEl.textContent = chargesText;
        }
        const threatHtml = `我方 ${pending.playerHpAtPause} HP / ${pending.playerShieldAtPause} 盾 · 敌方本轮预计 <strong class="text-danger">${pending.enemyThreatDamage}</strong> 伤`;
        if (this.decisionThreatEl.innerHTML !== threatHtml) {
          this.decisionThreatEl.innerHTML = threatHtml;
        }

        const sigDef = getShipSignatureCommand(run.shipId);
        const baseOpt = pending.options.find((o) => o.choice === 'normal') ?? pending.options[0];
        const baseHp = baseOpt
          ? baseOpt.predictedOutcome === 'victory'
            ? baseOpt.predictedFinalHp
            : 0
          : 0;

        // Prune removed choices first
        const nextChoices = new Set<string>(pending.options.map((o) => o.choice));
        for (const [choice, btn] of this.tacticBtns.entries()) {
          if (!nextChoices.has(choice)) {
            btn.remove();
            this.tacticBtns.delete(choice);
            this.tacticContentKeys.delete(choice);
          }
        }

        pending.options.forEach((opt, idx) => {
          const isSig = Boolean(opt.isSignature || opt.choice.startsWith('signature_'));
          const predHp = opt.predictedOutcome === 'victory' ? opt.predictedFinalHp : 0;
          const optThreat = classifyV2CombatThreat(
            { outcome: opt.predictedOutcome, playerFinalHp: predHp },
            run.maxHp
          );
          const optMeta = getV2ThreatTierMeta(optThreat.tier);
          const trend =
            opt.choice === 'normal' || !baseOpt
              ? 'neutral'
              : classifyV2CombatDeltaTrend({
                  beforeOutcome: baseOpt.predictedOutcome,
                  afterOutcome: opt.predictedOutcome,
                  beforeHp: baseHp,
                  afterHp: predHp,
                  beforeRounds: baseOpt.predictedRounds,
                  afterRounds: opt.predictedRounds,
                  maxHp: run.maxHp,
                });
          const trendGlyph = trend === 'up' ? '↑ ' : trend === 'down' ? '↓ ' : '';

          let btn = this.tacticBtns.get(opt.choice);
          if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.dataset.eliteTactic = opt.choice;
            btn.dataset.testid = `tactical-order-${opt.choice}`;
            this.tacticBtns.set(opt.choice, btn);
          }

          const btnCls = `v2-et-btn${
            getTacticButtonClass(opt.choice, isSig)
              ? ` ${getTacticButtonClass(opt.choice, isSig)}`
              : ''
          }`;
          if (btn.className !== btnCls) btn.className = btnCls;
          const predHpStr = String(predHp);
          if (btn.dataset.previewFinalHp !== predHpStr) btn.dataset.previewFinalHp = predHpStr;
          if (btn.dataset.threatTier !== optMeta.tier) btn.dataset.threatTier = optMeta.tier;
          if (isSig) {
            btn.dataset.tacticalSignature = 'true';
          } else {
            btn.removeAttribute('data-tactical-signature');
          }
          syncButtonDisabled(btn, !opt.enabled);

          const cKey = `${isSig ? sigDef.badge : ''}|${opt.label}|${optMeta.tier}|${trend}|${
            opt.enabled ? opt.summary : opt.disabledReason ?? '当前不可用'
          }`;
          if (this.tacticContentKeys.get(opt.choice) !== cKey) {
            this.tacticContentKeys.set(opt.choice, cKey);
            btn.innerHTML = `
              <div class="v2-et-btn-head">
                <strong>${isSig ? `<span class="v3-sig-chip">${sigDef.badge}</span> ` : ''}${
              opt.label
            }</strong>
                <span class="v2-et-pred v3-threat-pill threat-${
                  optMeta.tier
                } trend-${trend}">${trendGlyph}${optMeta.symbol} ${optMeta.label}</span>
              </div>
              <div class="v2-et-btn-sub">${
                opt.enabled ? opt.summary : opt.disabledReason ?? '当前不可用'
              }</div>
            `;
          }

          const curAtIdx = this.decisionOptionsEl!.children[idx];
          if (curAtIdx !== btn) {
            this.decisionOptionsEl!.insertBefore(btn, curAtIdx ?? null);
          }
        });
      }
    }
  }

  unmount(): void {
    this.rootEl?.removeEventListener('click', this.handleRootClick);
    this.rootEl?.remove();
    this.tacticBtns.clear();
    this.tacticContentKeys.clear();
    this.hostEl = null;
    this.rootEl = null;
    this.statusGroupEl = null;
    this.peekBtnEl = null;
    this.speedBtnEl = null;
    this.skipBtnEl = null;
    this.bossSlotEl = null;
    this.phaseSlotEl = null;
    this.intentSlotEl = null;
    this.tickerSlotEl = null;
    this.decisionSlotEl = null;
    this.decisionBarEl = null;
    this.decisionTitleEl = null;
    this.decisionChargesEl = null;
    this.decisionThreatEl = null;
    this.decisionOptionsEl = null;
    this.latestActions = null;
    this.latestShowDecisionBar = false;
    this.latestPendingDecisionId = null;
    this.lastStatusHtml = null;
    this.lastBossHtml = null;
    this.lastPhaseHtml = null;
    this.lastIntentHtml = null;
    this.lastTickerHtml = null;
  }
}

const legacyCombatLiveViews = new WeakMap<HTMLElement, CombatLivePhaseView>();

export function renderCombatLiveOverlay(
  overlayEl: HTMLElement,
  props: CombatLiveOverlayProps,
  actions: CombatLiveOverlayActions
): void {
  let view = legacyCombatLiveViews.get(overlayEl);
  if (!view) {
    view = new CombatLivePhaseView();
    legacyCombatLiveViews.set(overlayEl, view);
  }
  if (!view.isMountedIn(overlayEl)) {
    view.mount(overlayEl);
  }
  view.update(props, actions);
}
