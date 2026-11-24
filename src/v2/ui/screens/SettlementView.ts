import { getItemImageUrl } from '../../../assets/itemArt';
import { soundEngine } from '../../../audio/soundEngine';
import { V2_EQUIPMENT_DEFS } from '../../data/equipment';
import { V3_FACTIONS } from '../../data/factions';
import { getV3EndlessMutatorDef } from '../../data/sectors';
import { previewSettlementCampaignOutcomes } from '../../domain/campaign';
import { getDismantleSalvagePartsYield } from '../../domain/dismantle';
import { getEffectiveWarehouseCapacity } from '../../domain/progressionV2';
import type { V2SettlementSummary } from '../../domain/settlementV2';
import type {
  FactionId,
  V2PlacedItem,
  V2ProfileState,
  V2RunState,
  V2SettlementDisposition,
} from '../../domain/types';
import { originTagText } from '../CargoGridV2';
import { svgIcon } from '../icons';
import type { NextBaseGoal } from './screenTypes';

export interface SettlementViewProps {
  readonly run: V2RunState;
  readonly profile: V2ProfileState;
  readonly summary: V2SettlementSummary;
  readonly nextGoal: NextBaseGoal;
  readonly readOnly: boolean;
}

export interface SettlementViewActions {
  readonly onChangeDisposition: (instanceId: string, disp: V2SettlementDisposition) => void;
  readonly onShowcaseRetry: () => void;
  readonly onShowcaseToBase: () => void;
  readonly onConfirmSettlement: () => void;
  readonly onSkipRollup?: () => void;
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
    this.totalEl = containerEl.querySelector<HTMLElement>('[data-testid="settlement-total-credits"]');
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
  shipId: V2RunState['shipId']
): string {
  switch (d) {
    case 'deliver':
      return '交付委托';
    case 'sell':
      return `出售 +${item.fixedValue}¤`;
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

export function renderSettlementView(
  leftPanelEl: HTMLElement,
  props: SettlementViewProps,
  actions: SettlementViewActions
): void {
  const { run, profile: p, summary, nextGoal, readOnly } = props;
  const isSafe = summary.reason === 'safe_return';
  const warehouseCap = getEffectiveWarehouseCapacity(p);

  // S09 3-bucket partition:
  // 1) decisionLines: allowedDispositions.length > 1 (real player choice, <= 1 <button> each!)
  // 2) autoNonLoanLines: allowedDispositions.length <= 1 && origin !== 'loan' (0 <button>s!)
  // 3) loanLines: allowedDispositions.length <= 1 && origin === 'loan' (0 <button>s!)
  const decisionLines = summary.lines.filter((l) => l.allowedDispositions.length > 1);
  const autoNonLoanLines = summary.lines.filter(
    (l) => l.allowedDispositions.length <= 1 && l.item.origin !== 'loan'
  );
  const loanLines = summary.lines.filter(
    (l) => l.allowedDispositions.length <= 1 && l.item.origin === 'loan'
  );

  const loanCollapseHtml =
    loanLines.length > 0
      ? `<details class="v3-loan-summary-collapse" data-testid="settlement-loan-summary">
          <summary>
            <span class="v2-origin-badge origin-loan">借</span>
            <span>归还借用设备 ×${loanLines.length}</span>
            <small class="v3-loan-summary-hint">点击展开明细</small>
          </summary>
          <div class="v3-loan-summary-chips">
            ${loanLines
              .map((l) => `<span class="v3-loan-chip">${l.name}</span>`)
              .join('')}
          </div>
        </details>`
      : '';

  const autoResolvedHtml =
    autoNonLoanLines.length > 0
      ? `<div class="v3-auto-resolved-list" data-testid="settlement-auto-resolved">
          <div class="v3-auto-resolved-head">已自动归档（${autoNonLoanLines.length} 件无需手动确认）</div>
          ${autoNonLoanLines
            .map(
              (line) => `<div class="v2-settle-row is-auto-resolved">
                <div class="v2-settle-item-info">
                  <img class="v3-settle-thumb" src="${getItemImageUrl(line.item.definitionId)}" alt="" draggable="false" />
                  <span class="v2-origin-badge origin-${line.item.origin}">${originTagText(
                line.item.origin
              )}</span>
                  <strong>${line.name}</strong>
                </div>
                <span class="v2-settle-auto-badge">自动：${dispositionLabel(
                  line.selectedDisposition,
                  line.item,
                  p,
                  run.shipId
                )}</span>
              </div>`
            )
            .join('')}
        </div>`
      : '';

  const decisionRowsHtml = decisionLines
    .map((line) => {
      const id = line.item.instanceId;
      const lockHintHtml =
        isSafe &&
        !run.isShowcase &&
        line.item.category === 'equipment' &&
        line.item.origin === 'loot' &&
        !p.buildings.research_lab
          ? `<span class="v2-settle-lock-hint" title="在基地花费 100¤ 建造研究台后，可将拾获设备入库并研究永久蓝图">建成研究台(100¤)可入库</span>`
          : '';

      let controlsHtml = '';
      if (line.allowedDispositions.length === 2) {
        const alt = line.allowedDispositions.find((d) => d !== line.selectedDisposition) ?? line.allowedDispositions[0];
        const altTestId =
          alt === 'dismantle'
            ? `data-testid="btn-dismantle-${id}"`
            : alt === 'store'
            ? `data-testid="btn-store-${id}"`
            : '';
        const altAction = alt === 'dismantle' ? 'dismantle' : `settle-${alt}`;
        controlsHtml = `
          <span class="v2-settle-current-choice">当前：${dispositionLabel(
            line.selectedDisposition,
            line.item,
            p,
            run.shipId
          )}</span>
          <button type="button" class="btn btn-sm btn-secondary" data-settle-item="${id}" data-settle-disp="${alt}" data-action="${altAction}" ${altTestId} ${
          readOnly ? 'disabled' : ''
        }>改为${dispositionLabel(alt, line.item, p, run.shipId)}</button>
          ${lockHintHtml}
        `;
      } else {
        // 3+ legal dispositions: accessible tactile segmented radio group (0 <button> elements!)
        controlsHtml = `
          <div class="v2-settle-disp-seg" role="radiogroup" aria-label="选择「${line.name}」去向">
            ${line.allowedDispositions
              .map((d) => {
                const selected = line.selectedDisposition === d;
                const optTestId =
                  d === 'dismantle'
                    ? `data-testid="btn-dismantle-${id}"`
                    : d === 'store'
                    ? `data-testid="btn-store-${id}"`
                    : '';
                const optAction = d === 'dismantle' ? 'dismantle' : `settle-${d}`;
                return `<label class="v2-settle-seg-opt ${
                  selected ? 'is-selected' : ''
                }" data-settle-item="${id}" data-settle-disp="${d}" data-action="${optAction}" ${optTestId}>
                  <input type="radio" data-settle-radio="1" data-settle-item="${id}" data-settle-disp="${d}" name="settle_disp_${id}" value="${d}" ${
                  selected ? 'checked' : ''
                } ${readOnly ? 'disabled' : ''} />
                  <span>${dispositionLabel(d, line.item, p, run.shipId)}</span>
                </label>`;
              })
              .join('')}
          </div>
          ${lockHintHtml}
        `;
      }

      return `<div class="v2-settle-row is-decision-row">
        <div class="v2-settle-item-info">
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
        </div>
        <div class="v2-settle-disp-btns">
          ${controlsHtml}
        </div>
      </div>`;
    })
    .join('');

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

  const factionRepEntries = Object.entries(summary.factionRepGains ?? {}).filter(
    ([, val]) => typeof val === 'number' && val > 0
  ) as [FactionId, number][];

  const factionRepRowsHtml =
    factionRepEntries.length > 0
      ? factionRepEntries
          .map(
            ([fid, delta]) =>
              `<div class="v2-mig-row v3-faction-rep-row" ${nextStepAttr(0)}><span>${svgIcon('faction', 12)} ${
                V3_FACTIONS[fid]?.name ?? fid
              } 声望</span><strong class="num">+${delta}</strong></div>`
          )
          .join('')
      : '';

  const partsRowHtml =
    summary.totalSalvagePartsEarned > 0
      ? `<div class="v2-mig-row v3-parts-row" ${nextStepAttr(0)}><span>${svgIcon('parts', 12)} 精密零件入账${
          summary.dismantledPartsEarned > 0
            ? `（含现场分解 +${summary.dismantledPartsEarned}）`
            : ''
        }</span><strong class="num">+${summary.totalSalvagePartsEarned} 精密零件</strong></div>`
      : '';

  leftPanelEl.innerHTML = `
    <div class="v3-screen-root v3-sticky-panel-root" data-testid="settlement-screen">
      <div class="panel-header">
        <h2>${svgIcon('beacon', 16)} ${
    run.isShowcase
      ? '4 站精华试玩结算'
      : isSafe
      ? '安全返航清点'
      : '战败 · 紧急拖回结算'
  }</h2>
        <span class="panel-sub">${
          run.isShowcase
            ? '独立试玩 · 不影响正式存档'
            : decisionLines.length > 0
            ? `仅 ${decisionLines.length} 件需选择去向`
            : '全部物资已自动清点完毕'
        }</span>
      </div>

      <div class="v3-panel-scroll-body">
        ${
          (run.endlessThreat ?? 0) >= 1
            ? `<div class="v3-endless-hud-banner" data-testid="settlement-endless-banner">
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
              </div>`
            : ''
        }
        ${
          isSafe
            ? `<div class="v2-settle-banner ${summary.contractCompleted ? 'ok' : ''}">
                <strong>${
                  summary.contractCompleted
                    ? run.isTutorial
                      ? '首航教学交付成功！免费启用工作台并获得额外悬赏'
                      : `委托「${run.contract.name}」交付完成！`
                    : run.contract.type === 'free'
                    ? '自由打捞安全返航'
                    : `委托「${run.contract.name}」未完成（无信用点罚金）`
                }</strong>
              </div>`
            : `<div class="system-banner banner-danger" style="margin-bottom:4px;">
                舰体损毁由拖船拖回。按规则折算 40% 回收，本次带出的 ${summary.lostOwnedCount} 件自有设备与 ${summary.lostLootCount} 件拾获物已损失；基地仓库原有库存不受影响。
              </div>`
        }

        <div class="v2-settle-totals">
          <div class="v2-mig-row" ${nextStepAttr(summary.walletCredits)}><span>航行钱包结余</span><strong class="num">${
    summary.walletCredits
  }¤</strong></div>
          ${
            isSafe
              ? `
                <div class="v2-mig-row" ${nextStepAttr(summary.soldItemsCredits)}><span>出售物品收益</span><strong class="num">+${
                  summary.soldItemsCredits
                }¤</strong></div>
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
                )}><span>可回收总额 × 40%</span><strong class="num">${
                  summary.defeatRecoverableBase
                } × 40%</strong></div>
                 ${partsRowHtml}`
          }
          <div class="v2-mig-row total"><span>本次实得总计</span><strong class="num" data-testid="settlement-total-credits" data-final-credits="${
            summary.finalCreditsEarned
          }">+${summary.finalCreditsEarned}¤</strong></div>
        </div>

        ${
          !run.isShowcase
            ? (() => {
                const campPreview = previewSettlementCampaignOutcomes(p, run, summary);
                const campCard =
                  campPreview.headlines.length > 0 || campPreview.pityLine
                    ? `<div class="v3-settle-campaign-card">
                        <div class="v3-sc-title">${svgIcon('campaign', 13)} 战役与专精推进预览</div>
                        ${campPreview.headlines
                          .map((h) => `<div class="v3-sc-line">${h}</div>`)
                          .join('')}
                        ${
                          campPreview.pityLine
                            ? `<div class="v3-sc-pity">${campPreview.pityLine}</div>`
                            : ''
                        }
                      </div>`
                    : '';
                return `
                  <div class="v2-settle-goal-hint ${nextGoal.ready ? 'is-ready' : ''}">
                    <span>下一基地目标：<strong>${nextGoal.title}</strong></span>
                    <small>${nextGoal.detail}</small>
                  </div>
                  ${campCard}
                `;
              })()
            : ''
        }

        <div class="v2-settle-items">
          <div class="v2-prep-label">战利品清点清单</div>
          ${
            summary.lines.length === 0
              ? `<div class="v2-empty-inline">本次船舱为空。</div>`
              : `${decisionRowsHtml}${autoResolvedHtml}${loanCollapseHtml}`
          }
        </div>
      </div>

      <div class="v3-sticky-cta-footer">
        ${
          summary.warehouseOverflow && !run.isShowcase
            ? `<div class="system-banner banner-danger">
                设备库容量超出上限（${summary.warehouseProjectedCount}/${warehouseCap}），请将部分「入库」改为「出售」或转为零件。
              </div>`
            : ''
        }
        ${
          run.isShowcase
            ? `<div class="v2-showcase-finish-actions">
                <button type="button" class="btn btn-secondary" id="v2-showcase-retry">${svgIcon('bolt', 14)} 换套流派再试一次</button>
                <button type="button" class="btn btn-primary btn-launch-hero" id="v2-showcase-to-base">${svgIcon('rocket', 15)} 进入正式星港基地</button>
              </div>`
            : `<button type="button" class="btn btn-primary btn-launch-hero" id="v2-btn-confirm-settle" data-testid="btn-confirm-settlement" data-action="confirm-settlement" ${
                readOnly || summary.warehouseOverflow ? 'disabled' : ''
              }>${readOnly ? '只读锁定' : `${svgIcon('beacon', 15)} 确认入账 · 返回星港基地`}</button>`
        }
      </div>
    </div>
  `;

  const selectedByItem = new Map<string, V2SettlementDisposition>(
    summary.lines.map((l) => [l.item.instanceId, l.selectedDisposition])
  );

  leftPanelEl
    .querySelectorAll<HTMLElement>('button[data-settle-item], label[data-settle-item]')
    .forEach((el) => {
      el.addEventListener('click', () => {
        if (readOnly) return;
        const iid = el.dataset.settleItem;
        const disp = el.dataset.settleDisp as V2SettlementDisposition | undefined;
        if (!iid || !disp) return;
        if (selectedByItem.get(iid) === disp) return;
        actions.onChangeDisposition(iid, disp);
      });
    });

  leftPanelEl.querySelectorAll<HTMLInputElement>('input[data-settle-radio]').forEach((input) => {
    input.addEventListener('change', () => {
      if (readOnly || !input.checked) return;
      const iid = input.dataset.settleItem;
      const disp = input.dataset.settleDisp as V2SettlementDisposition | undefined;
      if (!iid || !disp) return;
      if (selectedByItem.get(iid) === disp) return;
      actions.onChangeDisposition(iid, disp);
    });
  });

  leftPanelEl.querySelector<HTMLElement>('.v2-settle-totals')?.addEventListener('click', () => {
    actions.onSkipRollup?.();
  });

  leftPanelEl
    .querySelector('#v2-showcase-retry')
    ?.addEventListener('click', actions.onShowcaseRetry);
  leftPanelEl
    .querySelector('#v2-showcase-to-base')
    ?.addEventListener('click', actions.onShowcaseToBase);
  leftPanelEl
    .querySelector('#v2-btn-confirm-settle')
    ?.addEventListener('click', actions.onConfirmSettlement);
}
