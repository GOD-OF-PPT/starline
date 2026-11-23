import { V2_CREW } from '../../data/crew';
import { getV3SectorDef } from '../../data/sectors';
import { areAllEventOptionsUnaffordable } from '../../domain/encounter';
import {
  buildFallbackEventStateFromLegacyNode,
  evaluateV2EventOption,
} from '../../domain/events';
import { getAnyV2ItemDef } from '../../domain/itemCatalog';
import type { V2MapNode, V2RunState } from '../../domain/types';
import { crewPortraitSvg, svgIcon } from '../icons';
import { NODE_TYPE_META } from './screenTypes';

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

export function renderEventView(
  leftPanelEl: HTMLElement,
  props: EventViewProps,
  actions: EventViewActions
): void {
  const { run, node, readOnly } = props;
  const sector = getV3SectorDef(run.sectorId);
  const activeEvent =
    run.activeEvent && run.activeEvent.nodeId === node.nodeId
      ? run.activeEvent
      : node.eventState ?? buildFallbackEventStateFromLegacyNode(run, node);

  if (activeEvent) {
    const unaffordable = areAllEventOptionsUnaffordable(run);
    const choicesHtml = activeEvent.options
      .map((opt) => {
        const evalRes = evaluateV2EventOption(run, opt);
        const isCrewOpt = Boolean(opt.requiredCrewId);
        const crewDef = opt.requiredCrewId ? V2_CREW[opt.requiredCrewId] : null;
        const crewMatched = !opt.requiredCrewId || run.crewId === opt.requiredCrewId;
        const isDisabled = readOnly || !evalRes.enabled;

        const btnClass = opt.isFallback
          ? 'v3-event-choice-btn is-fallback'
          : isCrewOpt
          ? `v3-event-choice-btn is-crew-bonus ${crewMatched ? 'is-matched' : 'is-locked'}`
          : 'v3-event-choice-btn';

        return `
          <button type="button" class="${btnClass} ${
          !evalRes.enabled ? 'is-unaffordable' : ''
        }" data-event-option="${opt.index}" data-testid="event-choice-${opt.index}" ${
          isDisabled ? 'disabled' : ''
        }>
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
          </button>
        `;
      })
      .join('');

    leftPanelEl.innerHTML = `
      <div class="v3-screen-root" data-testid="event-screen">
        <div class="panel-header">
          <h2>${svgIcon(NODE_TYPE_META[node.type].icon, 16)} ${activeEvent.title}</h2>
          <span class="panel-sub">${sector.name} · ${
      activeEvent.flavorTag ?? NODE_TYPE_META[node.type].label
    }</span>
        </div>

        ${
          node.hasRelicSignal
            ? `<div class="v3-relic-pity-banner">${svgIcon('museum', 13)} 保底遗物信号源：选择回收货物分支即可获取本星区古代遗物！</div>`
            : ''
        }

        <div class="v3-event-narrative">
          <p>${activeEvent.description}</p>
        </div>

        <div class="v3-event-choices">
          ${choicesHtml}
        </div>

        ${
          unaffordable
            ? `<div class="system-banner banner-warn" style="margin-top:8px;">
                <span>当前资源不足以执行任何分支，可放弃事件并免费安全返航。</span>
                <button type="button" class="btn btn-sm btn-primary" id="v2-btn-abandon-event" ${
                  readOnly ? 'disabled' : ''
                }>放弃并安全返航</button>
              </div>`
            : `<div style="margin-top:8px;display:flex;justify-content:flex-end;">
                <button type="button" class="btn btn-sm btn-ghost" id="v2-btn-abandon-event" ${
                  readOnly ? 'disabled' : ''
                }>放弃事件并免费返航</button>
              </div>`
        }
      </div>
    `;

    leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-event-option]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.eventOption);
        if (Number.isFinite(idx)) {
          actions.onSelectEventOption(idx);
        }
      });
    });

    leftPanelEl.querySelector('#v2-btn-abandon-event')?.addEventListener('click', actions.onAbandon);
    return;
  }

  // Legacy fallback (only used if a node lacks both activeEvent and eventState)
  const unaffordable = areAllEventOptionsUnaffordable(run);
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
          <button type="button" class="btn btn-primary" data-anomaly-opt="traverse" data-testid="event-choice-0" ${
            readOnly || !canTraverse ? 'disabled' : ''
          }>${canTraverse ? `耗 ${a.safeFuelCost} 燃料穿越` : '燃料不足'}</button>
        </div>
        <div class="v2-event-choice-card">
          <div class="v2-ec-title">${svgIcon('bolt', 15)} 强行破入（扣 ${a.breachHpCost} 耐久）</div>
          <div class="v2-ec-meta">不耗燃料，直接带走 2 件货物（共 ${a.breachCargoItems.reduce(
            (s, c) => s + c.fixedValue,
            0
          )}¤）</div>
          <button type="button" class="btn btn-danger" data-anomaly-opt="breach" data-testid="event-choice-1" ${
            readOnly || !canBreach ? 'disabled' : ''
          }>${canBreach ? `硬闯破入 (-${a.breachHpCost} HP)` : `耐久需 > ${a.breachHpCost}`}</button>
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
          <button type="button" class="btn btn-primary" data-distress-opt="rescue_crew" data-testid="event-choice-0" ${
            readOnly || !canRescue ? 'disabled' : ''
          }>${canRescue ? `施救 (-${d.rescueFuelCost} 油 · +${d.repairAmount} HP)` : '燃料不足'}</button>
        </div>
        <div class="v2-event-choice-card">
          <div class="v2-ec-title">${svgIcon('crate', 15)} 打捞高价货舱（0 燃料）</div>
          <div class="v2-ec-meta">带走 1 件高价货物（${
            getAnyV2ItemDef(d.haulCargoItem.definitionId)?.name ?? '货物'
          } · ${d.haulCargoItem.fixedValue}¤）</div>
          <button type="button" class="btn btn-secondary" data-distress-opt="haul_cargo" data-testid="event-choice-1" ${
            readOnly ? 'disabled' : ''
          }>打捞货舱</button>
        </div>
      </div>
    `;
  }

  leftPanelEl.innerHTML = `
    <div class="v3-screen-root" data-testid="event-screen">
      <div class="panel-header">
        <h2>${svgIcon(NODE_TYPE_META[node.type].icon, 16)} 第 ${node.layer} 层 · ${NODE_TYPE_META[node.type].label}</h2>
        <span class="panel-sub">${sector.name} · 星区事件</span>
      </div>
      ${eventBodyHtml}
      ${
        unaffordable
          ? `<div class="system-banner banner-warn" style="margin-top:10px;">
              <span>当前资源不足以支付任何选项，可放弃事件并免费返航。</span>
              <button type="button" class="btn btn-sm btn-primary" id="v2-btn-abandon-event" ${
                readOnly ? 'disabled' : ''
              }>放弃并安全返航</button>
            </div>`
          : `<div style="margin-top:10px;display:flex;justify-content:flex-end;">
              <button type="button" class="btn btn-sm btn-ghost" id="v2-btn-abandon-event" ${
                readOnly ? 'disabled' : ''
              }>放弃事件并免费返航</button>
            </div>`
      }
    </div>
  `;

  leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-anomaly-opt]').forEach((btn) => {
    btn.addEventListener('click', () => {
      actions.onAnomalyChoice(btn.dataset.anomalyOpt as 'traverse' | 'breach');
    });
  });

  leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-distress-opt]').forEach((btn) => {
    btn.addEventListener('click', () => {
      actions.onDistressChoice(btn.dataset.distressOpt as 'rescue_crew' | 'haul_cargo');
    });
  });

  leftPanelEl.querySelector('#v2-btn-abandon-event')?.addEventListener('click', actions.onAbandon);
}
