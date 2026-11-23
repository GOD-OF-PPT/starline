import { V2_EQUIPMENT_DEFS, V2_WAREHOUSE_CAPACITY } from '../../data/equipment';
import { V3_FACTIONS } from '../../data/factions';
import { previewSettlementCampaignOutcomes } from '../../domain/campaign';
import { getDismantleSalvagePartsYield } from '../../domain/dismantle';
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

  // Partition strictly loan items into a compact 1-line collapsible summary; keep mission/loot/owned visible!
  const actionableLines = summary.lines.filter((l) => l.item.origin !== 'loan');
  const loanLines = summary.lines.filter((l) => l.item.origin === 'loan');

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

  const bonusRowHtml =
    isSafe && summary.bonusObjective && !run.isTutorial
      ? summary.bonusObjective.completed && summary.contractCompleted
        ? `<div class="v2-mig-row v3-bonus-row is-done"><span>额外目标（已达成 · ${summary.bonusObjective.label}）</span><strong class="num">+${summary.bonusObjectiveCredits}¤ 加赏</strong></div>`
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
              `<div class="v2-mig-row v3-faction-rep-row"><span>${svgIcon('faction', 12)} ${
                V3_FACTIONS[fid]?.name ?? fid
              } 声望</span><strong class="num">+${delta}</strong></div>`
          )
          .join('')
      : '';

  const partsRowHtml =
    summary.totalSalvagePartsEarned > 0
      ? `<div class="v2-mig-row v3-parts-row"><span>${svgIcon('parts', 12)} 精密零件入账${
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
      : '紧急拖回结算'
  }</h2>
        <span class="panel-sub">${
          run.isShowcase ? '独立试玩 · 不影响正式存档' : '每件战利品择一去向'
        }</span>
      </div>

      <div class="v3-panel-scroll-body">
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
          <div class="v2-mig-row"><span>航行钱包结余</span><strong class="num">${summary.walletCredits}¤</strong></div>
          ${
            isSafe
              ? `
                <div class="v2-mig-row"><span>出售物品收益</span><strong class="num">+${summary.soldItemsCredits}¤</strong></div>
                ${
                  (summary.crewMasteryBonusCredits ?? 0) > 0
                    ? `<div class="v2-mig-row"><span>苏岚专精估价加成 (+15%)</span><strong class="num">+${summary.crewMasteryBonusCredits}¤</strong></div>`
                    : ''
                }
                ${
                  summary.contractRewardCredits > 0
                    ? `<div class="v2-mig-row"><span>委托悬赏奖金</span><strong class="num">+${summary.contractRewardCredits}¤</strong></div>`
                    : ''
                }
                ${bonusRowHtml}
                ${
                  (summary.factionContractBonusCredits ?? 0) > 0
                    ? `<div class="v2-mig-row"><span>星港行会 Lv.3 委托加赏 (+10%)</span><strong class="num">+${summary.factionContractBonusCredits}¤</strong></div>`
                    : ''
                }
                ${
                  summary.tutorialBonusCredits > 0
                    ? `<div class="v2-mig-row"><span>首航交付奖励</span><strong class="num">+${summary.tutorialBonusCredits}¤</strong></div>`
                    : ''
                }
                ${partsRowHtml}
                ${factionRepRowsHtml}
                ${
                  !run.isShowcase
                    ? `<div class="v2-mig-row"><span>入库后仓库容量</span><strong class="num ${
                        summary.warehouseOverflow ? 'text-danger' : ''
                      }">${summary.warehouseProjectedCount}/${V2_WAREHOUSE_CAPACITY}</strong></div>`
                    : ''
                }
              `
              : `<div class="v2-mig-row"><span>可回收总额 × 40%</span><strong class="num">${summary.defeatRecoverableBase} × 40%</strong></div>
                 ${partsRowHtml}`
          }
          <div class="v2-mig-row total"><span>本次实得总计</span><strong class="num">+${summary.finalCreditsEarned}¤</strong></div>
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
          <div class="v2-prep-label">战利品去向对比（出售 / 入库 / 转化为精密零件）</div>
          ${
            summary.lines.length === 0
              ? `<div class="v2-empty-inline">本次船舱为空。</div>`
              : `${
                  actionableLines.length === 0
                    ? `<div class="v2-empty-inline">本次无额外拾获物或任务物资。</div>`
                    : actionableLines
                        .map(
                          (line) => `<div class="v2-settle-row">
                            <div class="v2-settle-item-info">
                              <span class="v2-origin-badge origin-${line.item.origin}">${originTagText(
                            line.item.origin
                          )}</span>
                              <strong>${line.name}</strong>
                              ${
                                line.item.category === 'equipment'
                                  ? `<span class="v2-q-tag">${
                                      line.item.quality === 'improved' ? '良' : '普'
                                    }</span>`
                                  : ''
                              }
                            </div>
                            <div class="v2-settle-disp-btns">
                              ${line.allowedDispositions
                                .map((d) => {
                                  const isDismantle = d === 'dismantle';
                                  return `<button type="button" class="btn btn-sm ${
                                    line.selectedDisposition === d ? 'btn-primary' : 'btn-secondary'
                                  }" data-settle-item="${line.item.instanceId}" data-settle-disp="${d}" ${
                                    isDismantle
                                      ? `data-testid="btn-dismantle-${line.item.instanceId}" data-action="dismantle"`
                                      : ''
                                  } ${
                                    readOnly || line.allowedDispositions.length <= 1 ? 'disabled' : ''
                                  }>${dispositionLabel(d, line.item, p, run.shipId)}</button>`;
                                })
                                .join('')}
                              ${
                                isSafe &&
                                !run.isShowcase &&
                                line.item.category === 'equipment' &&
                                line.item.origin === 'loot' &&
                                !p.buildings.research_lab
                                  ? `<button type="button" class="btn btn-sm btn-ghost" disabled title="在基地花费 100¤ 建造研究台后，可将拾获设备入库并研究永久蓝图">建成研究台(100¤)可入库</button>`
                                  : ''
                              }
                            </div>
                          </div>`
                        )
                        .join('')
                }
                ${loanCollapseHtml}`
          }
        </div>
      </div>

      <div class="v3-sticky-cta-footer">
        ${
          summary.warehouseOverflow && !run.isShowcase
            ? `<div class="system-banner banner-danger">
                设备库容量超出上限（${summary.warehouseProjectedCount}/${V2_WAREHOUSE_CAPACITY}），请将部分「入库」改为「出售」或转为零件。
              </div>`
            : ''
        }
        ${
          run.isShowcase
            ? `<div class="v2-showcase-finish-actions">
                <button type="button" class="btn btn-secondary" id="v2-showcase-retry">${svgIcon('bolt', 14)} 换套流派再试一次</button>
                <button type="button" class="btn btn-primary btn-launch-hero" id="v2-showcase-to-base">${svgIcon('rocket', 15)} 进入正式星港基地</button>
              </div>`
            : `<button type="button" class="btn btn-primary btn-launch-hero" id="v2-btn-confirm-settle" data-testid="btn-confirm-settlement" ${
                readOnly || summary.warehouseOverflow ? 'disabled' : ''
              }>${readOnly ? '只读锁定' : `${svgIcon('beacon', 15)} 确认入账 · 返回星港基地`}</button>`
        }
      </div>
    </div>
  `;

  leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-settle-item]').forEach((btn) => {
    btn.addEventListener('click', () => {
      actions.onChangeDisposition(
        btn.dataset.settleItem!,
        btn.dataset.settleDisp as V2SettlementDisposition
      );
    });
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
