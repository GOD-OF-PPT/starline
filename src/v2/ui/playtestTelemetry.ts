/**
 * T01 — Opt-In Local Playtest Telemetry (`?playtest=1`) & JSON Export.
 *
 * Strictly inert by default: when `?playtest=1` is NOT present in `window.location.search`,
 * this module NEVER reads from or writes to `localStorage`, attaches 0 listeners, and exposes
 * 0 UI controls. Storage failures (`QuotaExceededError`, `SecurityError`) are completely
 * isolated and NEVER interfere with formal save data (`starline_save_v2`).
 */

export const PLAYTEST_LOG_STORAGE_KEY = 'starline_playtest_log';
export const MAX_PLAYTEST_EVENTS = 2000;

export type PlaytestDragFailReason =
  | 'out_of_bounds'
  | 'disabled_cell'
  | 'overlap'
  | 'outside_board';

export type PlaytestBranchKind = 'safe_return' | 'risk_branch' | 'other';

export type PlaytestEvent =
  | {
      readonly type: 'phase_enter';
      readonly ts: number;
      readonly phase: string;
      readonly runId?: string | null;
      readonly nodeId?: string | null;
      readonly isTutorial?: boolean;
    }
  | {
      readonly type: 'phase_leave';
      readonly ts: number;
      readonly phase: string;
      readonly dwellMs: number;
      readonly runId?: string | null;
      readonly nodeId?: string | null;
    }
  | {
      readonly type: 'click';
      readonly ts: number;
      readonly phase: string;
      readonly nodeId?: string | null;
      readonly action: string;
      readonly testId?: string | null;
      readonly isPureConfirm: boolean;
    }
  | {
      readonly type: 'drag_attempt';
      readonly ts: number;
      readonly phase: string;
      readonly zone: 'grid' | 'staging';
      readonly itemDefId: string;
      readonly success: boolean;
      readonly reason?: PlaytestDragFailReason;
    }
  | {
      readonly type: 'branch_choice';
      readonly ts: number;
      readonly phase: string;
      readonly nodeId: string | null;
      readonly choiceKind: PlaytestBranchKind;
    }
  | {
      readonly type: 'replay_start';
      readonly ts: number;
      readonly afterSettlementCount: number;
      readonly nextMode: 'prepare' | 'tutorial' | 'expedition';
    };

export interface PlaytestSummary {
  readonly totalEvents: number;
  readonly phaseDwellMs: Readonly<Record<string, number>>;
  /**
   * Elapsed ms from session start (earliest `phase_enter` timestamp, falling back to earliest
   * event timestamp) to the first meaningful player action (non-pure-confirm `click`,
   * `drag_attempt`, or `branch_choice`), or `null` if none recorded yet.
   */
  readonly timeToFirstMeaningfulActionMs: number | null;
  readonly totalClicks: number;
  readonly pureConfirmClicks: number;
  readonly pureConfirmRatio: number;
  /** Pure-confirm clicks grouped by non-empty voyage `nodeId`. */
  readonly pureConfirmClicksByNode: Readonly<Record<string, number>>;
  /**
   * Average pure-confirm clicks per distinct non-empty voyage node encountered across
   * `phase_enter` / `phase_leave` / `click` / `branch_choice` events (`0` when no nodes encountered).
   */
  readonly avgPureConfirmPerNode: number;
  readonly dragAttempts: number;
  readonly dragSuccesses: number;
  readonly dragFailures: number;
  readonly dragFailureRate: number;
  readonly dragFailureReasons: Readonly<Record<string, number>>;
  readonly branchChoices: {
    readonly safeReturn: number;
    readonly riskBranch: number;
    readonly other: number;
  };
  readonly postSettlementReplayStarts: number;
  readonly replayedAfterSettlement: boolean;
}

export interface PlaytestExportPayload {
  readonly schemaVersion: 1;
  readonly exportedAt: string;
  readonly sessionId: string;
  readonly summary: PlaytestSummary;
  readonly events: readonly PlaytestEvent[];
}

const PURE_CONFIRM_ACTIONS = new Set<string>([
  'enter-station',
  'leave-arrange',
  'confirm-settlement',
  'start-combat',
  'wreck-extract',
  'finish-shop',
  'skip-docking',
  'close-docking',
  'close-modal',
  'btn-enter-station',
  'btn-leave-arrange',
  'btn-confirm-settlement',
  'btn-start-combat',
  'btn-wreck-extract',
]);

export function isPlaytestParamEnabled(search?: string): boolean {
  const raw =
    typeof search === 'string'
      ? search
      : typeof window !== 'undefined' && typeof window.location?.search === 'string'
      ? window.location.search
      : '';
  if (!raw) return false;
  try {
    const params = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);
    return params.get('playtest') === '1';
  } catch {
    return false;
  }
}

export function classifyPureConfirmAction(
  action: string,
  testId?: string | null
): boolean {
  const normAction = action.trim().toLowerCase();
  if (PURE_CONFIRM_ACTIONS.has(normAction)) return true;
  if (testId && PURE_CONFIRM_ACTIONS.has(testId.trim().toLowerCase())) return true;
  return false;
}

export function computePlaytestSummary(events: readonly PlaytestEvent[]): PlaytestSummary {
  const phaseDwellMs: Record<string, number> = {};
  let totalClicks = 0;
  let pureConfirmClicks = 0;
  const pureConfirmClicksByNode: Record<string, number> = {};
  const encounteredNodeIds = new Set<string>();
  let nodePureConfirmTotal = 0;
  let dragAttempts = 0;
  let dragFailures = 0;
  const dragFailureReasons: Record<string, number> = {};
  let safeReturn = 0;
  let riskBranch = 0;
  let other = 0;
  let postSettlementReplayStarts = 0;

  let earliestEventTs: number | null = null;
  let earliestPhaseEnterTs: number | null = null;
  let firstMeaningfulActionTs: number | null = null;

  const trackNodeId = (nodeId?: string | null): string | null => {
    if (typeof nodeId !== 'string') return null;
    const trimmed = nodeId.trim();
    if (!trimmed) return null;
    encounteredNodeIds.add(trimmed);
    return trimmed;
  };

  for (const ev of events) {
    if (Number.isFinite(ev.ts)) {
      if (earliestEventTs === null || ev.ts < earliestEventTs) {
        earliestEventTs = ev.ts;
      }
    }
    switch (ev.type) {
      case 'phase_enter': {
        if (Number.isFinite(ev.ts)) {
          if (earliestPhaseEnterTs === null || ev.ts < earliestPhaseEnterTs) {
            earliestPhaseEnterTs = ev.ts;
          }
        }
        trackNodeId(ev.nodeId);
        break;
      }
      case 'phase_leave': {
        const ms = Number.isFinite(ev.dwellMs) && ev.dwellMs > 0 ? ev.dwellMs : 0;
        phaseDwellMs[ev.phase] = (phaseDwellMs[ev.phase] ?? 0) + ms;
        trackNodeId(ev.nodeId);
        break;
      }
      case 'click': {
        totalClicks += 1;
        const nid = trackNodeId(ev.nodeId);
        if (ev.isPureConfirm) {
          pureConfirmClicks += 1;
          if (nid !== null) {
            pureConfirmClicksByNode[nid] = (pureConfirmClicksByNode[nid] ?? 0) + 1;
            nodePureConfirmTotal += 1;
          }
        } else if (Number.isFinite(ev.ts)) {
          if (firstMeaningfulActionTs === null || ev.ts < firstMeaningfulActionTs) {
            firstMeaningfulActionTs = ev.ts;
          }
        }
        break;
      }
      case 'drag_attempt': {
        dragAttempts += 1;
        if (Number.isFinite(ev.ts)) {
          if (firstMeaningfulActionTs === null || ev.ts < firstMeaningfulActionTs) {
            firstMeaningfulActionTs = ev.ts;
          }
        }
        if (!ev.success) {
          dragFailures += 1;
          const r = ev.reason ?? 'unknown';
          dragFailureReasons[r] = (dragFailureReasons[r] ?? 0) + 1;
        }
        break;
      }
      case 'branch_choice': {
        trackNodeId(ev.nodeId);
        if (Number.isFinite(ev.ts)) {
          if (firstMeaningfulActionTs === null || ev.ts < firstMeaningfulActionTs) {
            firstMeaningfulActionTs = ev.ts;
          }
        }
        if (ev.choiceKind === 'safe_return') safeReturn += 1;
        else if (ev.choiceKind === 'risk_branch') riskBranch += 1;
        else other += 1;
        break;
      }
      case 'replay_start': {
        postSettlementReplayStarts += 1;
        break;
      }
    }
  }

  const startTs = earliestPhaseEnterTs ?? earliestEventTs;
  const timeToFirstMeaningfulActionMs =
    startTs !== null && firstMeaningfulActionTs !== null
      ? Math.max(0, firstMeaningfulActionTs - startTs)
      : null;
  const dragSuccesses = Math.max(0, dragAttempts - dragFailures);
  const avgPureConfirmPerNode =
    encounteredNodeIds.size > 0
      ? Number((nodePureConfirmTotal / encounteredNodeIds.size).toFixed(4))
      : 0;

  return {
    totalEvents: events.length,
    phaseDwellMs,
    timeToFirstMeaningfulActionMs,
    totalClicks,
    pureConfirmClicks,
    pureConfirmRatio: totalClicks > 0 ? Number((pureConfirmClicks / totalClicks).toFixed(4)) : 0,
    pureConfirmClicksByNode,
    avgPureConfirmPerNode,
    dragAttempts,
    dragSuccesses,
    dragFailures,
    dragFailureRate: dragAttempts > 0 ? Number((dragFailures / dragAttempts).toFixed(4)) : 0,
    dragFailureReasons,
    branchChoices: { safeReturn, riskBranch, other },
    postSettlementReplayStarts,
    replayedAfterSettlement: postSettlementReplayStarts > 0,
  };
}

export interface PlaytestTelemetryOptions {
  readonly enabled: boolean;
  readonly storage?: Storage | null;
  readonly now?: () => number;
}

export class PlaytestTelemetryLogger {
  private readonly enabled: boolean;
  private readonly storage: Storage | null;
  private readonly now: () => number;
  private readonly sessionId: string;
  private events: PlaytestEvent[] = [];
  private activePhase: {
    readonly phase: string;
    readonly enteredAt: number;
    readonly runId: string | null;
    readonly nodeId: string | null;
  } | null = null;
  private lastExportedJson: string | null = null;

  constructor(options: PlaytestTelemetryOptions) {
    this.enabled = options.enabled;
    this.storage = options.enabled ? (options.storage ?? null) : null;
    this.now = options.now ?? (() => Date.now());
    this.sessionId = `pt_${this.now().toString(36)}`;

    // Strictly ZERO storage reads when disabled!
    if (this.enabled && this.storage) {
      this.events = this.safeReadEvents();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getLastExportedJson(): string | null {
    return this.lastExportedJson;
  }

  getEvents(): readonly PlaytestEvent[] {
    if (!this.enabled) return [];
    return [...this.events];
  }

  recordPhase(
    nextPhase: string,
    ctx?: { readonly runId?: string | null; readonly nodeId?: string | null; readonly isTutorial?: boolean }
  ): void {
    if (!this.enabled) return;
    const runId = ctx?.runId ?? null;
    const nodeId = ctx?.nodeId ?? null;
    if (
      this.activePhase &&
      this.activePhase.phase === nextPhase &&
      this.activePhase.runId === runId &&
      this.activePhase.nodeId === nodeId
    ) {
      return;
    }
    const ts = this.now();
    if (this.activePhase) {
      this.pushEvent({
        type: 'phase_leave',
        ts,
        phase: this.activePhase.phase,
        dwellMs: Math.max(0, ts - this.activePhase.enteredAt),
        runId: this.activePhase.runId,
        nodeId: this.activePhase.nodeId,
      });
    }
    this.activePhase = { phase: nextPhase, enteredAt: ts, runId, nodeId };
    this.pushEvent({
      type: 'phase_enter',
      ts,
      phase: nextPhase,
      runId,
      nodeId,
      isTutorial: ctx?.isTutorial,
    });
  }

  recordClick(action: string, testId?: string | null): void {
    if (!this.enabled) return;
    this.pushEvent({
      type: 'click',
      ts: this.now(),
      phase: this.activePhase?.phase ?? 'unknown',
      nodeId: this.activePhase?.nodeId ?? null,
      action,
      testId: testId ?? null,
      isPureConfirm: classifyPureConfirmAction(action, testId),
    });
  }

  recordDragAttempt(attempt: {
    readonly zone: 'grid' | 'staging';
    readonly itemDefId: string;
    readonly success: boolean;
    readonly reason?: PlaytestDragFailReason;
  }): void {
    if (!this.enabled) return;
    this.pushEvent({
      type: 'drag_attempt',
      ts: this.now(),
      phase: this.activePhase?.phase ?? 'unknown',
      zone: attempt.zone,
      itemDefId: attempt.itemDefId,
      success: attempt.success,
      reason: attempt.success ? undefined : attempt.reason,
    });
  }

  recordBranchChoice(nodeId: string | null, choiceKind: PlaytestBranchKind): void {
    if (!this.enabled) return;
    this.pushEvent({
      type: 'branch_choice',
      ts: this.now(),
      phase: this.activePhase?.phase ?? 'MAP',
      nodeId,
      choiceKind,
    });
  }

  recordReplayStart(
    afterSettlementCount: number,
    nextMode: 'prepare' | 'tutorial' | 'expedition'
  ): void {
    if (!this.enabled) return;
    this.pushEvent({
      type: 'replay_start',
      ts: this.now(),
      afterSettlementCount,
      nextMode,
    });
  }

  clear(): void {
    if (!this.enabled) return;
    this.events = [];
    this.activePhase = null;
    if (this.storage) {
      try {
        this.storage.removeItem(PLAYTEST_LOG_STORAGE_KEY);
      } catch {
        // Never throw on storage errors
      }
    }
  }

  buildExportPayload(): PlaytestExportPayload {
    const snapshotEvents = this.enabled ? [...this.events] : [];
    return {
      schemaVersion: 1,
      exportedAt: new Date(this.now()).toISOString(),
      sessionId: this.sessionId,
      summary: computePlaytestSummary(snapshotEvents),
      events: snapshotEvents,
    };
  }

  exportJson(): string {
    const json = JSON.stringify(this.buildExportPayload(), null, 2);
    this.lastExportedJson = json;
    return json;
  }

  downloadJson(): string {
    const json = this.exportJson();
    if (!this.enabled || typeof document === 'undefined') return json;
    try {
      if (typeof Blob !== 'undefined' && typeof URL?.createObjectURL === 'function') {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.setAttribute('href', url);
        a.setAttribute('download', `starline-playtest-${this.sessionId}.json`);
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    } catch {
      // Headless/FakeDOM fallback: lastExportedJson is still populated cleanly
    }
    return json;
  }

  private pushEvent(event: PlaytestEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_PLAYTEST_EVENTS) {
      this.events = this.events.slice(this.events.length - MAX_PLAYTEST_EVENTS);
    }
    this.safePersist();
  }

  private safeReadEvents(): PlaytestEvent[] {
    if (!this.storage) return [];
    try {
      const raw = this.storage.getItem(PLAYTEST_LOG_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return (parsed as PlaytestEvent[]).slice(-MAX_PLAYTEST_EVENTS);
      }
      if (
        parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { events?: unknown }).events)
      ) {
        return ((parsed as { events: PlaytestEvent[] }).events).slice(-MAX_PLAYTEST_EVENTS);
      }
      return [];
    } catch {
      return [];
    }
  }

  private safePersist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(
        PLAYTEST_LOG_STORAGE_KEY,
        JSON.stringify({ schemaVersion: 1, events: this.events })
      );
    } catch {
      // QuotaExceededError / SecurityError isolation: trim 50% and retry once, then silence
      if (this.events.length > 20) {
        this.events = this.events.slice(Math.floor(this.events.length / 2));
        try {
          this.storage.setItem(
            PLAYTEST_LOG_STORAGE_KEY,
            JSON.stringify({ schemaVersion: 1, events: this.events })
          );
        } catch {
          // Silently degrade to in-memory log; NEVER affect starline_save_v2!
        }
      }
    }
  }
}
