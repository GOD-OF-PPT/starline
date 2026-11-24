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
import { getShipSignatureCommand } from '../../data/ships';
import {
  computeCombatTacticalChargesMax,
  getEffectiveV2CombatBounty,
  previewV2CombatNode,
  resolveNodeBossId,
} from '../../domain/combatV2';
import { canUseV3GadgetInRun } from '../../domain/encounter';
import type {
  V2CombatUnitSnapshot,
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
  readonly pureAutoCombat: boolean;
  readonly bonusBossCharges?: number;
  readonly stargateRelayTier?: number;
}

export interface CombatPreViewActions {
  readonly onSelectPolicy: (policy: V2TargetPolicy) => void;
  readonly onToggleLog: () => void;
  readonly onUseGadget?: (instanceId: string) => void;
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

export function renderCombatPreView(
  leftPanelEl: HTMLElement,
  props: CombatPreViewProps,
  actions: CombatPreViewActions
): void {
  const {
    run,
    node,
    readOnly,
    showCombatLogDetails,
    pureAutoCombat,
    bonusBossCharges = 0,
    stargateRelayTier = 0,
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
  const headerLabel = bossDef ? bossDef.title : bossId ? encounterTpl.name : NODE_TYPE_META[node.type].label;
  const chargesMax = computeCombatTacticalChargesMax(node, run, bonusBossCharges);
  const sigDef = getShipSignatureCommand(run.shipId);
  const effectiveBounty = getEffectiveV2CombatBounty(run, node.combat.bounty);

  const tacticalSummaryHtml = pureAutoCombat
    ? `<div class="v3-tactical-mode-strip is-auto" data-testid="combat-tactical-preview">
        <span class="v3-tactic-pill muted">${svgIcon('bolt', 12)} 纯自动战斗模式</span>
        <span class="v3-tactic-desc">按当前配装自动完成全轮交火（可在设置中切回主动战术指令）</span>
      </div>`
    : `<div class="v3-tactical-mode-strip is-active" data-testid="combat-tactical-preview">
        <span class="v3-tactic-pill">${svgIcon('bolt', 12)} 主动战术 · 指令充能 ${chargesMax}/${chargesMax}</span>
        <span class="v3-tactic-desc">通用指令（火力过载 / 紧急护盾 / 聚焦校准）+ 专属「${sigDef.label}」</span>
      </div>`;

  const bossOverviewHtml = bossDef
    ? `<div class="v3-boss-dossier" data-testid="boss-phase-overview">
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
      </div>`
    : '';

  const mutFx = aggregateEndlessMutatorEffects(run.endlessMutatorIds);

  const rosterHtml = node.combat.units
    .map((u) => {
      const initSnap = pv?.initialEnemies.find((s) => s.enemyId === u.enemyId);
      const cycle = getUnitIntentCyclePreview(u, node.combat!.encounterKind, bossId);
      const initShield = resolveUnitInitialShield(u, node.combat!.encounterKind, bossId);
      const dispMaxHp = initSnap?.maxHp ?? u.maxHp;
      const dispShield = initSnap?.shield ?? initShield.shield;
      const dispDmg = u.damagePerRound + mutFx.enemyDamageBonus;
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
          return `<span class="enemy-intent-badge ${getIntentToneClass(dispIntent.kind)}" data-enemy-intent="${
            dispIntent.kind
          }" ${idx === 0 ? `data-testid="enemy-intent-${u.enemyId}"` : ''}>R${idx + 1} ${formatIntentShortText(
            dispIntent
          )}</span>`;
        })
        .join('');
      return `<div class="v2-enemy-chip v3-enemy-card ${u.isBoss ? 'is-boss' : ''}">
        <div class="v3-enemy-card-head">
          <strong>${u.name}</strong>
          <span class="v3-enemy-stats">HP ${dispMaxHp}${dispShield > 0 ? ` · 盾 ${dispShield}` : ''} · 攻 ${dispDmg}${
        dispArmor > 0 ? ` · 甲 ${dispArmor}` : ''
      }${dispPierce > 0 ? ` · 穿盾 ${Math.round(dispPierce * 100)}%` : ''}</span>
        </div>
        <div class="intent-cycle">
          <span class="v3-intent-prefix">行动意图</span>
          ${intentCycleHtml}
        </div>
      </div>`;
    })
    .join('');

  const overchargeGadgets = run.bay.placed
    .map((p) => ({ item: p.item, def: getV3GadgetDef(p.item.definitionId) }))
    .filter(
      (entry): entry is { item: typeof entry.item; def: NonNullable<typeof entry.def> } =>
        Boolean(entry.def && entry.def.usableIn === 'combat_pre')
    );

  const overchargeBannerHtml = run.overchargeCellActive
    ? `<div class="v3-overcharge-banner" data-testid="overcharge-active-banner">
        ${svgIcon('bolt', 14)} <strong>过载电池已充能</strong>：首轮追加 +6 无视护甲能量爆发与 +4 护盾（已同步至下方预估）
      </div>`
    : overchargeGadgets.length > 0 && actions.onUseGadget
    ? `<div class="v3-gadget-bar" data-testid="combat-gadget-bar">
        <span class="v3-gadget-bar-label">${svgIcon('bolt', 12)} 战前消耗装置</span>
        <div class="v3-gadget-bar-btns">
          ${overchargeGadgets
            .map(({ item, def }) => {
              const chk = canUseV3GadgetInRun(run, item.instanceId);
              return `<button type="button" class="btn btn-sm btn-primary v3-gadget-use-btn" data-use-gadget="${item.instanceId}" data-gadget-kind="${def.kind}" data-gadget-id="${def.kind}" data-testid="use-gadget-${def.kind}" ${
                readOnly || !chk.usable ? 'disabled' : ''
              }>⚡ 使用${def.buttonLabel}（${def.shortEffectLabel}）</button>`;
            })
            .join('')}
        </div>
      </div>`
    : '';

  const endlessThreat = run.endlessThreat ?? 0;
  const endlessCombatBannerHtml =
    endlessThreat >= 1
      ? `<div class="v3-endless-hud-banner" data-testid="combat-endless-banner">
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
        </div>`
      : '';

  const finalCombatBannerHtml = run.isFinalCampaignRun
    ? `<div class="v3-final-mission-banner" data-testid="combat-final-banner">
        <strong>${svgIcon('star', 12)} 星门重启远征</strong>
        <span>终局战役节点</span>
      </div>`
    : '';

  leftPanelEl.innerHTML = `
    <div class="v3-screen-root v3-sticky-panel-root" data-testid="combat-screen">
      <div class="v3-panel-scroll-body">
        <div class="panel-header">
          <h2>${svgIcon(bossDef ? 'boss' : NODE_TYPE_META[node.type].icon, 16)} 第 ${node.layer} 层 · ${headerLabel}</h2>
          <span class="panel-sub">击破赏金 <strong class="num">+${effectiveBounty}¤</strong></span>
        </div>

        <div class="v3-combat-env-banner env-${sector.envModifier.id}" data-testid="combat-sector-modifier">
          <span class="v3-sector-mod-badge">${svgIcon(envIcon, 13)} ${sector.name} · ${sector.envModifier.name}</span>
          <span class="v3-sector-mod-desc">${sector.envModifier.combatRuleSummary}</span>
        </div>

        ${finalCombatBannerHtml}
        ${endlessCombatBannerHtml}
        ${tacticalSummaryHtml}
        ${overchargeBannerHtml}
        ${bossOverviewHtml}

        <div class="v2-enemy-roster v3-enemy-roster">
          ${rosterHtml}
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
            ? `<div class="v2-combat-preview-card ${pv.outcome === 'victory' ? 'ok' : 'danger'}" data-preview-final-hp="${
                pv.outcome === 'victory' ? pv.finalPlayerHpAfterRepair : 0
              }">
                <div class="v2-cp-head">
                  <strong>${!pureAutoCombat ? '基础配装预估：' : '战果预估：'}${
                pv.outcome === 'victory' ? '预计获胜' : '有战败风险'
              }</strong>
                  <span class="num">${pv.roundsCount} 回合</span>
                </div>
                <div class="v2-cp-body">
                  耐久 ${pv.startingPlayerHp} · 护盾 ${pv.startingPlayerShield} → 战后 <strong>${
                pv.outcome === 'victory' ? pv.finalPlayerHpAfterRepair : 0
              }</strong>${pv.repairApplied > 0 ? `（含维修 +${pv.repairApplied}）` : ''}
                  ${
                    !pureAutoCombat
                      ? ` · <strong>战中可施放 ${chargesMax} 次战术指令改写战局</strong>`
                      : ''
                  }
                </div>
                <button type="button" class="btn btn-sm btn-ghost" id="v2-toggle-log" style="margin-top:4px;">${
                  showCombatLogDetails ? '收起回合推演' : '查看回合推演'
                }</button>
                ${
                  showCombatLogDetails
                    ? `<div class="v2-combat-log-list">
                        ${pv.rounds
                          .slice(0, 10)
                          .map((r) => {
                            const phaseNote = r.bossPhaseTransitions?.length
                              ? ` · ★ ${r.bossPhaseTransitions.map((t) => t.label).join(' / ')}`
                              : '';
                            const specialNote = r.enemySpecialNotes?.length
                              ? ` · ${r.enemySpecialNotes[0]}`
                              : '';
                            return `<div class="v2-log-row">R${r.round}: 我方 ${
                              r.playerAttacks.reduce((s, a) => s + a.appliedDamage, 0)
                            }伤${r.counterAttack ? `+反击${r.counterAttack.appliedDamage}` : ''} · 敌方 ${
                              r.enemyAttacks.reduce((s, a) => s + a.hullDamage, 0)
                            }直伤(盾吸${r.shieldAbsorbedTotal}) → ${r.playerHpAfter}HP${
                              r.envModifierEvent ? ` · [${r.envModifierEvent}]` : ''
                            }${phaseNote || specialNote}</div>`;
                          })
                          .join('')}
                      </div>`
                    : ''
                }
              </div>`
            : ''
        }
      </div>

      <div class="v3-sticky-cta-footer">
        <button type="button" class="btn btn-primary btn-launch-hero" id="v2-btn-start-combat" data-testid="btn-start-combat" ${
          readOnly ? 'disabled' : ''
        }>${svgIcon('combat', 16)} 开始交火</button>
      </div>
    </div>
  `;

  leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-policy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      actions.onSelectPolicy(btn.dataset.policy as V2TargetPolicy);
    });
  });

  leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-use-gadget]').forEach((btn) => {
    btn.addEventListener('click', () => {
      actions.onUseGadget?.(btn.dataset.useGadget!);
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
  const hpPct = Math.max(0, Math.min(100, Math.round((liveCombatPlayerHp / Math.max(1, run.maxHp)) * 100)));

  const chargesMax = Math.max(0, pending?.chargesMax ?? run.tacticalChargesMax ?? 1);
  const chargesUsed = Math.max(0, run.tacticalChargesUsed ?? 0);
  const chargesRemaining = Math.max(0, chargesMax - chargesUsed);

  // Live Boss Multi-Phase HUD bar (flex-stacked cleanly below hero HUD)
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

  const phaseBannerHtml = livePhaseBannerText
    ? `<div class="v3-boss-phase-banner" data-testid="boss-phase-banner">${svgIcon('boss', 14)} ${livePhaseBannerText}</div>`
    : '';

  // Live Enemy Telegraphed Intent Strip (living enemies)
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
              return `<span class="enemy-intent-badge ${getIntentToneClass(intentKind)}" data-enemy-intent="${intentKind}" data-testid="enemy-intent-${e.enemyId}">
                ${e.name}：${intentText}${e.shield && e.shield > 0 ? ` · 敌盾${e.shield}` : ''}
              </span>`;
            })
            .join('')}
        </div>`
      : '';

  const sigDef = getShipSignatureCommand(run.shipId);

  const decisionHtml = showDecisionBar
    ? `
      <div class="v2-elite-tactic-overlay v3-tactical-bar" data-testid="combat-tactical-bar" role="region" aria-label="主动战术指令面板">
        <div class="v2-et-head v3-et-head">
          <div class="v3-et-title-group">
            <strong>${svgIcon('bolt', 15)} 第 ${pending!.roundNumber} 回合 · 战术指令</strong>
            <span class="v3-tactical-charges-pill" data-testid="combat-tactical-charges">指令充能 ${chargesRemaining}/${chargesMax}</span>
          </div>
          <span class="v3-et-threat">我方 ${pending!.playerHpAtPause} HP / ${pending!.playerShieldAtPause} 盾 · 敌方本轮预计 <strong class="text-danger">${pending!.enemyThreatDamage}</strong> 伤</span>
        </div>
        <div class="v2-et-options v3-tactical-options">
          ${pending!.options
            .map((opt) => {
              const isSig = Boolean(opt.isSignature || opt.choice.startsWith('signature_'));
              const predHp = opt.predictedOutcome === 'victory' ? opt.predictedFinalHp : 0;
              return `<button type="button" class="v2-et-btn ${getTacticButtonClass(
                opt.choice,
                isSig
              )}" data-elite-tactic="${opt.choice}" data-testid="tactical-order-${opt.choice}" data-preview-final-hp="${predHp}" ${
                isSig ? 'data-tactical-signature="true"' : ''
              } ${!opt.enabled ? 'disabled' : ''}>
                <div class="v2-et-btn-head">
                  <strong>${isSig ? `<span class="v3-sig-chip">${sigDef.badge}</span> ` : ''}${opt.label}</strong>
                  <span class="v2-et-pred ${opt.predictedOutcome === 'victory' ? 'ok' : 'risk'}">${
                opt.predictedOutcome === 'victory'
                  ? `余 ${predHp} HP (${opt.predictedRounds}轮)`
                  : `预计 0 HP (${opt.predictedRounds}轮)`
              }</span>
                </div>
                <div class="v2-et-btn-sub">${opt.enabled ? opt.summary : opt.disabledReason ?? '当前不可用'}</div>
              </button>`;
            })
            .join('')}
        </div>
      </div>
    `
    : '';

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

  overlayEl.innerHTML = `
    <div class="v3-overlay-screen v3-combat-live-overlay" data-testid="combat-screen">
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
          <span class="combat-pill v3-charge-pill">${svgIcon('bolt', 12)} 充能 <strong class="num">${chargesRemaining}/${chargesMax}</strong></span>
          ${envPillHtml}
          ${endlessLivePillHtml}
        </div>
        <div class="v2-combat-ctrl-group">
          <button type="button" class="btn btn-sm btn-ghost" id="v2-combat-peek-bay">${svgIcon('grid', 13)} 查看船舱</button>
          <button type="button" class="btn btn-sm btn-secondary" id="v2-combat-speed">${combatSpeed}×</button>
          <button type="button" class="btn btn-sm btn-primary" id="v2-combat-skip" data-testid="btn-combat-skip" ${
            showDecisionBar ? 'disabled' : ''
          }>${showDecisionBar ? '等待指令' : '跳过演出'}</button>
        </div>
      </div>
      ${bossHudHtml}
      ${phaseBannerHtml}
      ${liveIntentStripHtml}
      ${
        !showDecisionBar && liveCombatEventLine
          ? `<div class="v2-combat-event-ticker v3-combat-event-ticker">${liveCombatEventLine}</div>`
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
      if (!pending || btn.disabled) return;
      actions.onCommitEliteTactic(pending.decisionId, btn.dataset.eliteTactic as V2EliteTacticChoice);
    });
  });
}
