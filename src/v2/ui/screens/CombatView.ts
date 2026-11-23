import { previewV2CombatNode } from '../../domain/combatV2';
import type {
  V2EliteTacticChoice,
  V2MapNode,
  V2RunState,
  V2TargetPolicy,
} from '../../domain/types';
import { svgIcon } from '../icons';
import { NODE_TYPE_META } from './screenTypes';

export interface CombatPreViewProps {
  readonly run: V2RunState;
  readonly node: V2MapNode;
  readonly readOnly: boolean;
  readonly showCombatLogDetails: boolean;
  readonly eliteTacticEnabled: boolean;
}

export interface CombatPreViewActions {
  readonly onSelectPolicy: (policy: V2TargetPolicy) => void;
  readonly onToggleLog: () => void;
  readonly onStartCombat: () => void;
}

export function renderCombatPreView(
  leftPanelEl: HTMLElement,
  props: CombatPreViewProps,
  actions: CombatPreViewActions
): void {
  const { run, node, readOnly, showCombatLogDetails, eliteTacticEnabled } = props;
  if (!node.combat) return;

  const pv = previewV2CombatNode(run, node.nodeId, run.targetPolicy);
  const isEliteWithTactic = node.type === 'elite' && eliteTacticEnabled;

  leftPanelEl.innerHTML = `
    <div class="v3-screen-root" data-testid="combat-screen">
      <div class="panel-header">
        <h2>${svgIcon(NODE_TYPE_META[node.type].icon, 16)} 第 ${node.layer} 层 · ${NODE_TYPE_META[node.type].label}</h2>
        <span class="panel-sub">击破赏金 <strong class="num">+${node.combat.bounty}¤</strong></span>
      </div>

      <div class="v2-enemy-roster">
        ${node.combat.units
          .map(
            (u) => `<div class="v2-enemy-chip ${u.isBoss ? 'is-boss' : ''}">
              <strong>${u.name}</strong>
              <span>HP ${u.maxHp} · 攻 ${u.damagePerRound}${u.armor > 0 ? ` · 甲 ${u.armor}` : ''}${
              u.pierceRatio > 0 ? ` · 穿盾 ${Math.round(u.pierceRatio * 100)}%` : ''
            }</span>
            </div>`
          )
          .join('')}
      </div>

      <div class="v2-policy-box">
        <span class="v2-prep-label">集火策略</span>
        <div style="display:flex;gap:8px;margin-top:6px;">
          <button type="button" class="btn btn-sm ${
            run.targetPolicy === 'weakest' ? 'btn-primary' : 'btn-secondary'
          }" data-policy="weakest" ${readOnly ? 'disabled' : ''}>优先最弱</button>
          <button type="button" class="btn btn-sm ${
            run.targetPolicy === 'highest_threat' ? 'btn-primary' : 'btn-secondary'
          }" data-policy="highest_threat" ${readOnly ? 'disabled' : ''}>优先最大威胁</button>
        </div>
      </div>

      ${
        pv
          ? `<div class="v2-combat-preview-card ${pv.outcome === 'victory' ? 'ok' : 'danger'}">
              <div class="v2-cp-head">
                <strong>${isEliteWithTactic ? '按正常执行推演：' : '战果预估：'}${
              pv.outcome === 'victory' ? '预计获胜' : '有战败风险'
            }</strong>
                <span class="num">${pv.roundsCount} 回合</span>
              </div>
              <div class="v2-cp-body">
                耐久 ${pv.startingPlayerHp} · 护盾 ${pv.startingPlayerShield} → 战后 <strong>${
              pv.finalPlayerHpAfterRepair
            }</strong>${pv.repairApplied > 0 ? `（含维修 +${pv.repairApplied}）` : ''}
                ${isEliteWithTactic ? ' · <strong>第 2 回合可改战术指令并重新推演</strong>' : ''}
              </div>
              <button type="button" class="btn btn-sm btn-ghost" id="v2-toggle-log" style="margin-top:4px;">${
                showCombatLogDetails ? '收起回合推演' : '查看回合推演'
              }</button>
              ${
                showCombatLogDetails
                  ? `<div class="v2-combat-log-list">
                      ${pv.rounds
                        .slice(0, 10)
                        .map(
                          (r) => `<div class="v2-log-row">R${r.round}: 我方 ${
                            r.playerAttacks.reduce((s, a) => s + a.appliedDamage, 0)
                          }伤${r.counterAttack ? `+反击${r.counterAttack.appliedDamage}` : ''} · 敌方 ${
                            r.enemyAttacks.reduce((s, a) => s + a.hullDamage, 0)
                          }直伤(盾吸${r.shieldAbsorbedTotal}) → ${r.playerHpAfter}HP</div>`
                        )
                        .join('')}
                    </div>`
                  : ''
              }
            </div>`
          : ''
      }

      <button type="button" class="btn btn-primary btn-launch-hero" id="v2-btn-start-combat" data-testid="btn-start-combat" ${
        readOnly ? 'disabled' : ''
      }>${svgIcon('combat', 16)} 开始交火</button>
    </div>
  `;

  leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-policy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      actions.onSelectPolicy(btn.dataset.policy as V2TargetPolicy);
    });
  });

  leftPanelEl.querySelector('#v2-toggle-log')?.addEventListener('click', actions.onToggleLog);
  leftPanelEl.querySelector('#v2-btn-start-combat')?.addEventListener('click', actions.onStartCombat);
}

export interface CombatLiveOverlayProps {
  readonly run: V2RunState;
  readonly liveCombatRound: number;
  readonly liveCombatPlayerHp: number;
  readonly liveCombatPlayerShield: number;
  readonly liveCombatEnemiesAlive: number;
  readonly liveCombatEventLine: string;
  readonly awaitingEliteDecision: boolean;
  readonly combatSpeed: 1 | 2;
}

export interface CombatLiveOverlayActions {
  readonly onPeekBay: () => void;
  readonly onToggleSpeed: () => void;
  readonly onSkipPlayback: () => void;
  readonly onCommitEliteTactic: (decisionId: string, choice: V2EliteTacticChoice) => void;
}

export function renderCombatLiveOverlay(
  overlayEl: HTMLElement,
  props: CombatLiveOverlayProps,
  actions: CombatLiveOverlayActions
): void {
  const {
    run,
    liveCombatRound,
    liveCombatPlayerHp,
    liveCombatPlayerShield,
    liveCombatEnemiesAlive,
    liveCombatEventLine,
    awaitingEliteDecision,
    combatSpeed,
  } = props;
  const sim = run.activeCombat?.simulation;
  if (!sim) return;

  const pending = run.activeCombat?.pendingDecision;
  const showDecisionBar = Boolean(awaitingEliteDecision && pending && pending.chosen === null);
  const hpPct = Math.max(0, Math.min(100, Math.round((liveCombatPlayerHp / run.maxHp) * 100)));

  const decisionHtml = showDecisionBar
    ? `
      <div class="v2-elite-tactic-overlay" data-testid="combat-tactical-bar" role="region" aria-label="精英战第2回合战术抉择">
        <div class="v2-et-head">
          <strong>${svgIcon('bolt', 15)} 第 ${pending!.roundNumber} 回合战术抉择</strong>
          <span>我方 ${pending!.playerHpAtPause} HP / ${pending!.playerShieldAtPause} 盾 · 敌方本轮齐射 <strong class="text-danger">${pending!.enemyThreatDamage}</strong> 伤</span>
        </div>
        <div class="v2-et-options">
          ${pending!.options
            .map(
              (opt) => `<button type="button" class="v2-et-btn ${
                opt.choice === 'overload' ? 'is-amber' : opt.choice === 'emergency_defense' ? 'is-cyan' : ''
              }" data-elite-tactic="${opt.choice}" data-testid="tactical-order-${opt.choice}" ${
                !opt.enabled ? 'disabled' : ''
              }>
                <div class="v2-et-btn-head">
                  <strong>${opt.label}</strong>
                  <span class="v2-et-pred ${opt.predictedOutcome === 'victory' ? 'ok' : 'risk'}">${
                opt.predictedOutcome === 'victory'
                  ? `预计胜 · 余 ${opt.predictedFinalHp} HP (${opt.predictedRounds}轮)`
                  : `预计危 (${opt.predictedRounds}轮)`
              }</span>
                </div>
                <div class="v2-et-btn-sub">${opt.enabled ? opt.summary : opt.disabledReason ?? '当前不可用'}</div>
              </button>`
            )
            .join('')}
        </div>
      </div>
    `
    : '';

  overlayEl.innerHTML = `
    <div class="v3-overlay-screen" data-testid="combat-screen">
      <div class="combat-hud-bar v2-combat-hero-hud">
        <div class="v2-combat-status-group">
          <span class="combat-pill">回合 <strong class="num">${liveCombatRound}/${sim.roundsCount}</strong></span>
          <span class="combat-pill v2-hp-pill">
            ${svgIcon('hull', 13)}
            <span class="v2-mini-bar"><span style="width:${hpPct}%"></span></span>
            <strong class="num">${liveCombatPlayerHp}/${run.maxHp}</strong>
          </span>
          <span class="combat-pill">${svgIcon('shield', 13)} <strong class="num">${liveCombatPlayerShield}</strong></span>
          <span class="combat-pill">${svgIcon('combat', 13)} 敌 <strong class="num">${liveCombatEnemiesAlive}</strong></span>
        </div>
        <div class="v2-combat-ctrl-group">
          <button type="button" class="btn btn-sm btn-ghost" id="v2-combat-peek-bay">${svgIcon('grid', 13)} 查看船舱</button>
          <button type="button" class="btn btn-sm btn-secondary" id="v2-combat-speed">${combatSpeed}×</button>
          <button type="button" class="btn btn-sm btn-primary" id="v2-combat-skip" data-testid="btn-combat-skip" ${
            showDecisionBar ? 'disabled' : ''
          }>${showDecisionBar ? '等待指令' : '跳过演出'}</button>
        </div>
      </div>
      ${
        !showDecisionBar && liveCombatEventLine
          ? `<div class="v2-combat-event-ticker">${liveCombatEventLine}</div>`
          : ''
      }
      ${decisionHtml}
    </div>
  `;

  overlayEl.querySelector('#v2-combat-peek-bay')?.addEventListener('click', actions.onPeekBay);
  overlayEl.querySelector('#v2-combat-speed')?.addEventListener('click', actions.onToggleSpeed);
  overlayEl.querySelector('#v2-combat-skip')?.addEventListener('click', () => {
    if (showDecisionBar) return;
    actions.onSkipPlayback();
  });
  overlayEl.querySelectorAll<HTMLButtonElement>('[data-elite-tactic]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!pending) return;
      actions.onCommitEliteTactic(pending.decisionId, btn.dataset.eliteTactic as V2EliteTacticChoice);
    });
  });
}
