import type { V2EquipmentKind } from '../../data/equipment';
import { getV3GadgetDef } from '../../data/gadgets';
import { V2_SHIPS } from '../../data/ships';
import { canPerformSurveyAtCurrentNode, isContractReadyForDelivery } from '../../domain/contracts';
import { canUseV3GadgetInRun, isAtTerminalLayer } from '../../domain/encounter';
import { deriveV2ShipVisualSpec } from '../../domain/shipVisualSpec';
import type { V2RunState } from '../../domain/types';
import { svgIcon } from '../icons';
import { bindEngineerSwapHandlers, renderEngineerSwapBannerHtml } from './screenTypes';

export interface ArrangeViewProps {
  readonly run: V2RunState;
  readonly readOnly: boolean;
  readonly sceneCollapsed: boolean;
}

export interface ArrangeViewActions {
  readonly onToggleShipPreview: () => void;
  readonly onEngineerSwap: (kind: V2EquipmentKind) => void;
  readonly onSurveyScan: () => void;
  readonly onUseGadget?: (instanceId: string) => void;
  readonly onAbortContract: () => void;
  readonly onLeaveArrange: (terminal: boolean) => void;
}

export function renderArrangeView(
  leftPanelEl: HTMLElement,
  props: ArrangeViewProps,
  actions: ArrangeViewActions
): void {
  const { run, readOnly, sceneCollapsed: collapsed } = props;
  const surveyCheck = canPerformSurveyAtCurrentNode(run);
  const terminal = isAtTerminalLayer(run);
  const hasStaging = run.bay.staging.length > 0;
  const currentLayer = run.currentNodeId ? run.graph.nodes[run.currentNodeId]?.layer ?? 0 : 0;
  const canAbort =
    run.contract.status === 'active' &&
    run.contract.type !== 'free' &&
    (!run.isTutorial || currentLayer >= 3) &&
    !isContractReadyForDelivery(run, 'safe_return');

  const hasMissionInStaging = run.bay.staging.some((s) => s.item.origin === 'mission');
  const goalLine = hasMissionInStaging
    ? '委托大件在暂存区：请腾出对应连续格位装舱，或放弃委托带货返航'
    : hasStaging
    ? `暂存区还有 ${run.bay.staging.length} 件待处理，点选即可查看下一战收益差值`
    : '船舱整理就绪 · 调整相邻位置可立即点亮联动并同步更新舰体外挂';
  const visualSpec = deriveV2ShipVisualSpec(run.bay);
  const engineerBannerHtml = renderEngineerSwapBannerHtml(run, readOnly);

  const arrangeGadgets = run.bay.placed
    .map((p) => ({ item: p.item, def: getV3GadgetDef(p.item.definitionId) }))
    .filter(
      (entry): entry is { item: typeof entry.item; def: NonNullable<typeof entry.def> } =>
        Boolean(entry.def && entry.def.usableIn === 'map_arrange')
    );

  const arrangeGadgetBarHtml =
    arrangeGadgets.length > 0 && actions.onUseGadget
      ? `<div class="v3-gadget-bar" data-testid="arrange-gadget-bar">
          <span class="v3-gadget-bar-label">${svgIcon('bolt', 12)} 战术消耗装置</span>
          <div class="v3-gadget-bar-btns">
            ${arrangeGadgets
              .map(({ item, def }) => {
                const chk = canUseV3GadgetInRun(run, item.instanceId);
                return `<button type="button" class="btn btn-sm btn-secondary v3-gadget-use-btn" data-use-gadget="${item.instanceId}" data-gadget-kind="${def.kind}" data-gadget-id="${def.kind}" data-testid="btn-use-gadget-${def.kind}" title="${chk.reason ?? def.summary}" ${
                  readOnly || !chk.usable ? 'disabled' : ''
                }>使用 ${def.buttonLabel}</button>`;
              })
              .join('')}
          </div>
        </div>`
      : '';

  leftPanelEl.innerHTML = `
    <div class="v3-screen-root" data-testid="arrange-screen">
      <div class="panel-header">
        <h2>${svgIcon('grid', 16)} 船舱整理</h2>
        <span class="panel-sub">${hasStaging ? `待处理 ${run.bay.staging.length} 件` : '已清空暂存区'}</span>
      </div>

      <div class="v2-arrange-goal-strip ${hasMissionInStaging ? 'is-mission' : ''}">
        ${goalLine}
      </div>

      <div class="v2-arrange-exterior-bar">
        <div class="v2-arrange-exterior-pills">
          ${svgIcon('rocket', 13)}
          <span>${V2_SHIPS[run.shipId].name}外挂：</span>
          ${
            visualSpec.mountSummaryTags.length > 0
              ? visualSpec.mountSummaryTags.map((t) => `<span class="v2-mount-pill">${t}</span>`).join('')
              : `<span class="v2-mount-pill muted">核心炮</span>`
          }
        </div>
        <button type="button" class="btn btn-sm btn-ghost" id="v2-arrange-toggle-ship">${
          collapsed ? '展开舰体预览' : '收起舰体预览'
        }</button>
      </div>

      ${engineerBannerHtml}
      ${arrangeGadgetBarHtml}

      ${
        surveyCheck.canSurvey
          ? `<div class="v2-survey-banner">
              <div>
                <strong>${svgIcon('radar', 14)} 委托勘测点</strong>
                <div style="font-size:12px;color:var(--text-secondary);">消耗 ${run.contract.surveyFuelCost} 燃料完成测绘（${run.contract.completedNodeIds.length}/${run.contract.requiredCompletions}）</div>
              </div>
              <button type="button" class="btn btn-sm btn-primary" id="v2-btn-survey-scan" ${
                readOnly ? 'disabled' : ''
              }>执行勘测 (-${run.contract.surveyFuelCost} 油)</button>
            </div>`
          : ''
      }

      <div class="v3-arrange-inspector-slot" id="v3-arrange-inspector-slot" data-testid="arrange-inspector-slot"></div>

      <div class="v2-arrange-actions">
        <button type="button" class="btn btn-primary btn-launch-hero" id="v2-btn-leave-arrange" data-testid="btn-leave-arrange" ${
          readOnly || hasStaging ? 'disabled' : ''
        }>${
    hasStaging
      ? '请先放置或舍弃暂存区物品'
      : terminal
      ? `${svgIcon('beacon', 15)} 抵达终层 · 进入返航结算`
      : `${svgIcon('rocket', 15)} 整理完毕 · 返回航路`
  }</button>
        ${
          canAbort
            ? `<button type="button" class="btn btn-sm btn-ghost" id="v2-arrange-abort" ${
                readOnly ? 'disabled' : ''
              }>放弃当前委托</button>`
            : ''
        }
      </div>
    </div>
  `;

  leftPanelEl
    .querySelector('#v2-arrange-toggle-ship')
    ?.addEventListener('click', actions.onToggleShipPreview);

  bindEngineerSwapHandlers(leftPanelEl, actions.onEngineerSwap);

  leftPanelEl
    .querySelector('#v2-btn-survey-scan')
    ?.addEventListener('click', actions.onSurveyScan);

  leftPanelEl
    .querySelector('#v2-arrange-abort')
    ?.addEventListener('click', actions.onAbortContract);

  leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-use-gadget]').forEach((btn) => {
    btn.addEventListener('click', () => {
      actions.onUseGadget?.(btn.dataset.useGadget!);
    });
  });

  leftPanelEl
    .querySelector('#v2-btn-leave-arrange')
    ?.addEventListener('click', () => actions.onLeaveArrange(terminal));
}
