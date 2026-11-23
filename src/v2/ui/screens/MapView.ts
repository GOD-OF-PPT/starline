import { resolveV3BossDefForEncounter } from '../../data/bosses';
import { getV2EncounterTemplate } from '../../data/enemies';
import { V2_ARCHETYPE_LABELS } from '../../data/equipment';
import { getV3GadgetDef } from '../../data/gadgets';
import { getV3EndlessMutatorDef, getV3SectorDef } from '../../data/sectors';
import {
  computeCombatTacticalChargesMax,
  getEffectiveV2CombatBounty,
  previewV2CombatNode,
  resolveNodeBossId,
} from '../../domain/combatV2';
import {
  computeV2JumpFuelCost,
  evaluateRunBonusObjective,
  isContractReadyForDelivery,
} from '../../domain/contracts';
import { canUseV3GadgetInRun, getReachableNextNodeIds } from '../../domain/encounter';
import { getAnyV2ItemDef } from '../../domain/itemCatalog';
import type { V2MapNode, V2RunState } from '../../domain/types';
import { svgIcon } from '../icons';
import { NODE_TYPE_META } from './screenTypes';

export interface MapViewProps {
  readonly run: V2RunState;
  readonly readOnly: boolean;
  readonly selectedMapNodeId: string | null;
  readonly mobileMapShowFull: boolean;
  readonly isCompactViewport: boolean;
  readonly pureAutoCombat: boolean;
  readonly bonusBossCharges?: number;
  readonly fullMapReveal?: boolean;
  readonly stargateRelayTier?: number;
}

export interface MapViewActions {
  readonly onToggleMobileMap: () => void;
  readonly onSelectNode: (nodeId: string) => void;
  readonly onJumpNode: (nodeId: string) => void;
  readonly onUseGadget?: (instanceId: string) => void;
  readonly onSafeReturn: () => void;
  readonly onAbortContract: () => void;
}

export function renderMapView(
  leftPanelEl: HTMLElement,
  props: MapViewProps,
  actions: MapViewActions
): void {
  const {
    run,
    readOnly,
    selectedMapNodeId,
    mobileMapShowFull,
    isCompactViewport,
    pureAutoCombat,
    bonusBossCharges = 0,
    fullMapReveal = false,
    stargateRelayTier = 0,
  } = props;

  const reachableIds = getReachableNextNodeIds(run);
  const fuelInfo = computeV2JumpFuelCost(run);
  const canJump = run.fuel >= fuelInfo.totalCost;

  const effectiveSelectedId =
    selectedMapNodeId && reachableIds.includes(selectedMapNodeId)
      ? selectedMapNodeId
      : reachableIds[0] ?? null;

  const layers = Array.from({ length: run.graph.maxLayers }, (_, i) => i + 1);
  const currentLayerNum = run.currentNodeId ? run.graph.nodes[run.currentNodeId]?.layer ?? 0 : 0;
  const focusLayers = [currentLayerNum + 1, currentLayerNum + 2].filter(
    (ly) => ly >= 1 && ly <= run.graph.maxLayers
  );

  // Guarantee strictly 1 DOM element per `[data-testid="map-node-<id>"]` across desktop & mobile!
  const useMobileFocus = isCompactViewport && !mobileMapShowFull && focusLayers.length > 0;

  // High-contrast proportional SVG DAG edges with directional <marker> arrowheads
  const colUnit = 86;
  const gapUnit = 20;
  const step = colUnit + gapUnit;
  const svgW = layers.length * colUnit + Math.max(0, layers.length - 1) * gapUnit;
  const svgH = 120;

  const edgePaths: string[] = [];
  for (const node of Object.values(run.graph.nodes)) {
    const isFromCurrent = run.currentNodeId === node.nodeId;
    const x1 = (node.layer - 1) * step + colUnit;
    const y1 = node.lane === 0 ? 30 : 90;
    for (const nxtId of node.nextNodeIds) {
      const target = run.graph.nodes[nxtId];
      if (!target) continue;
      const x2 = (target.layer - 1) * step - 1;
      const y2 = target.lane === 0 ? 30 : 90;
      const midX = (x1 + x2) / 2;

      const activeEdge = isFromCurrent && reachableIds.includes(nxtId);
      const visitedEdge =
        run.visitedNodeIds.includes(node.nodeId) && run.visitedNodeIds.includes(nxtId);
      const stroke = activeEdge
        ? '#F6B852'
        : visitedEdge
        ? '#62D6DF'
        : 'rgba(173, 198, 228, 0.62)';
      const sw = activeEdge ? '2.6' : visitedEdge ? '2.2' : '1.6';
      const markerId = activeEdge
        ? 'v3-dag-arrow-active'
        : visitedEdge
        ? 'v3-dag-arrow-visited'
        : 'v3-dag-arrow-future';
      const edgeCls = activeEdge
        ? 'v3-dag-edge is-active'
        : visitedEdge
        ? 'v3-dag-edge is-visited'
        : 'v3-dag-edge is-future';
      const dashAttr = activeEdge || visitedEdge ? '' : 'stroke-dasharray="4 3"';

      edgePaths.push(
        `<path class="${edgeCls}" d="M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}" fill="none" stroke="${stroke}" stroke-width="${sw}" ${dashAttr} vector-effect="non-scaling-stroke" marker-end="url(#${markerId})" />`
      );
    }
  }

  const renderMapNodeButton = (n: V2MapNode | undefined, compact: boolean): string => {
    if (!n) return `<div class="v2-dag-spacer"></div>`;
    const meta = NODE_TYPE_META[n.type];
    const visited = run.visitedNodeIds.includes(n.nodeId);
    const isCur = run.currentNodeId === n.nodeId;
    const isNext = reachableIds.includes(n.nodeId);
    const isSelected = effectiveSelectedId === n.nodeId;
    const intelTitle = fullMapReveal
      ? n.combat
        ? `第${n.layer}层 ${meta.label} · ${getV2EncounterTemplate(n.combat.encounterKind).name}`
        : n.eventState
        ? `第${n.layer}层 ${meta.label} · ${n.eventState.title}`
        : `第${n.layer}层 ${meta.label}`
      : `第${n.layer}层 ${meta.label}`;
    return `<button type="button" class="v2-dag-node ${meta.cls} ${visited ? 'visited' : ''} ${
      isCur ? 'current' : ''
    } ${isNext ? 'reachable' : ''} ${isSelected ? 'selected' : ''}" data-select-node="${
      n.nodeId
    }" data-reachable="${isNext ? 'true' : 'false'}" data-testid="map-node-${n.nodeId}" ${
      !isNext ? 'disabled' : ''
    } title="${intelTitle}">
      <span class="v2-dag-icon">${svgIcon(meta.icon, compact ? 15 : 16)}</span>
      <span class="v2-dag-name">${meta.label}</span>
      ${n.contractMarker ? `<span class="v2-dag-star" aria-label="委托目标">${svgIcon('star', 11)}</span>` : ''}
      ${n.hasSupportGuarantee ? `<span class="v2-dag-sup">配</span>` : ''}
      ${n.hasRelicSignal ? `<span class="v3-dag-relic" title="保底遗物信号">遗</span>` : ''}
    </button>`;
  };

  const mapGraphHtml = useMobileFocus
    ? `<div class="v2-map-mobile-focus">
        ${focusLayers
          .map((ly) => {
            const laneA = Object.values(run.graph.nodes).find((n) => n.layer === ly && n.lane === 0);
            const laneB = Object.values(run.graph.nodes).find((n) => n.layer === ly && n.lane === 1);
            return `<div class="v2-mmf-layer">
              <div class="v2-mmf-layer-head">第 ${ly} 层${ly === currentLayerNum + 1 ? '（下一步可达）' : '（后续预告）'}</div>
              <div class="v2-mmf-nodes">
                ${renderMapNodeButton(laneA, true)}
                ${renderMapNodeButton(laneB, true)}
              </div>
            </div>`;
          })
          .join('')}
      </div>`
    : `<div class="v2-dag-box v2-dag-hero">
        <div class="v2-dag-scroll">
          <div class="v2-dag-stage">
            <svg class="v2-dag-edges-svg" viewBox="0 0 ${svgW} ${svgH}" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <marker id="v3-dag-arrow-active" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">
                  <path d="M 0 1 L 7 4 L 0 7 z" fill="#F6B852" />
                </marker>
                <marker id="v3-dag-arrow-visited" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">
                  <path d="M 0 1 L 7 4 L 0 7 z" fill="#62D6DF" />
                </marker>
                <marker id="v3-dag-arrow-future" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="userSpaceOnUse">
                  <path d="M 0 1 L 6 3.5 L 0 6 z" fill="#9FB6D1" />
                </marker>
              </defs>
              ${edgePaths.join('')}
            </svg>
            <div class="v2-dag-grid">
              ${layers
                .map((layer) => {
                  const laneA = Object.values(run.graph.nodes).find((n) => n.layer === layer && n.lane === 0);
                  const laneB = Object.values(run.graph.nodes).find((n) => n.layer === layer && n.lane === 1);
                  return `<div class="v2-dag-col">
                    <div class="v2-dag-layer-lbl">L${layer}</div>
                    <div class="v2-dag-pair">
                      ${renderMapNodeButton(laneA, false)}
                      ${renderMapNodeButton(laneB, false)}
                    </div>
                  </div>`;
                })
                .join('')}
            </div>
          </div>
        </div>
      </div>`;

  const describeNodeForecast = (
    n: V2MapNode
  ): { brief: string; cls: string; detail: string; traitBadge?: string } => {
    if (n.combat) {
      const pv = previewV2CombatNode(run, n.nodeId, run.targetPolicy, { stargateRelayTier });
      const chargesMax = computeCombatTacticalChargesMax(n, run, bonusBossCharges);
      const tacticPrefix = !pureAutoCombat ? `基础推演(含${chargesMax}指令)：` : '';
      const bossId = resolveNodeBossId(n, run);
      const bossDef = resolveV3BossDefForEncounter({
        encounterKind: n.combat.encounterKind,
        bossId,
        units: n.combat.units,
      });
      const tpl = getV2EncounterTemplate(n.combat.encounterKind);
      const traitBadge = bossDef
        ? `首领 · ${bossDef.name} (${bossDef.phaseCountLabel})`
        : tpl.badge;
      const unitBrief = n.combat.units
        .map(
          (u) =>
            `${u.name}(${u.maxHp}HP/${u.damagePerRound}攻${u.armor ? `/甲${u.armor}` : ''}${
              u.pierceRatio ? '/穿盾' : ''
            })`
        )
        .join(' + ');
      const effectiveBounty = getEffectiveV2CombatBounty(run, n.combat.bounty);
      const brief =
        pv?.outcome === 'victory'
          ? `${tacticPrefix}预计胜 · 余 ${pv.finalPlayerHpAfterRepair}HP (${pv.roundsCount}轮) · +${effectiveBounty}¤`
          : `${tacticPrefix}高危战败风险 (${pv?.roundsCount ?? '?'}轮) · +${effectiveBounty}¤`;
      return {
        brief,
        cls: pv?.outcome === 'victory' ? 'ok' : 'risk',
        detail: unitBrief,
        traitBadge,
      };
    }
    if (n.type === 'wreck') {
      return {
        brief: '多刀残骸拆解：首刀无伤，贪刀追高收益与精密零件',
        cls: '',
        detail: run.crewId === 'salvager' ? '苏岚已透视全明细' : '含船体/燃料/伏击风险预警',
      };
    }
    if (n.type === 'merchant') {
      return {
        brief: '补给交易：2 件设备 / +2油 / +10耐久',
        cls: '',
        detail: '可出售拾获物换取信用点',
      };
    }
    if (n.type === 'anomaly') {
      return {
        brief: n.eventState ? `星区事件：${n.eventState.title}` : '星区异常事件：多分支抉择',
        cls: '',
        detail: '含船员专属选项与安全撤离退路',
      };
    }
    return {
      brief: n.eventState ? `求救事件：${n.eventState.title}` : '星区求救信号：多分支抉择',
      cls: '',
      detail: '可换取声望、修船或零损耗撤离',
    };
  };

  const selNode = effectiveSelectedId ? run.graph.nodes[effectiveSelectedId] : null;
  let selectedCardHtml = `<div class="v2-empty-hint">已抵达最深层，点击下方免费安全返航完成结算！</div>`;

  if (selNode) {
    const selMeta = NODE_TYPE_META[selNode.type];
    const compareCardsHtml =
      reachableIds.length > 0
        ? `<div class="v2-map-compare-grid">
            ${reachableIds
              .map((rid) => {
                const rn = run.graph.nodes[rid];
                if (!rn) return '';
                const rm = NODE_TYPE_META[rn.type];
                const fc = describeNodeForecast(rn);
                const active = rid === selNode.nodeId;
                return `<button type="button" class="v2-map-compare-card ${active ? 'selected' : ''}" data-select-node="${rid}" data-testid="map-compare-${rid}">
                  <div class="v2-mc-head">
                    <span class="v2-mc-head-left">${svgIcon(rm.icon, 14)} ${rn.lane === 0 ? 'A线' : 'B线'} · ${rm.label}</span>
                    <span class="v2-fuel-tag ${canJump ? '' : 'no-fuel'}">${svgIcon('fuel', 11)} ${fuelInfo.totalCost}</span>
                  </div>
                  <div class="v2-mc-tags v3-map-intent-tags">
                    ${rn.contractMarker ? `<span class="v2-badge-contract">${svgIcon('star', 10)} 委托目标</span>` : ''}
                    ${rn.hasRelicSignal ? `<span class="v3-badge-relic">${svgIcon('museum', 10)} 保底遗物信号</span>` : ''}
                    ${fc.traitBadge ? `<span class="v3-badge-intent">${fc.traitBadge}</span>` : ''}
                    ${
                      rn.hasSupportGuarantee
                        ? `<span class="v2-badge-support">${V2_ARCHETYPE_LABELS[run.primaryArchetype].supportName}保底</span>`
                        : ''
                    }
                    ${fuelInfo.navigatorDiscountApplied ? `<span class="v2-badge-info">首跳省油</span>` : ''}
                    ${fuelInfo.rescueSurcharge > 0 ? `<span class="v2-badge-warn">救生舱+1油</span>` : ''}
                  </div>
                  <div class="v2-mc-forecast ${fc.cls}">${fc.brief}</div>
                  <small style="color:var(--text-secondary);font-size:11px;">${fc.detail}</small>
                </button>`;
              })
              .join('')}
          </div>`
        : '';

    selectedCardHtml = `
      ${compareCardsHtml}
      <button type="button" class="btn btn-primary btn-launch-hero" data-jump-node="${
        selNode.nodeId
      }" data-testid="btn-jump-node" ${readOnly || !canJump ? 'disabled' : ''}>${
      canJump
        ? `${svgIcon('rocket', 15)} 跃迁至第 ${selNode.layer} 层 ${selNode.lane === 0 ? 'A线' : 'B线'} · ${selMeta.label}`
        : '燃料不足 · 请免费安全返航'
    }</button>
    `;
  }

  const canAbort =
    run.contract.status === 'active' &&
    run.contract.type !== 'free' &&
    !run.isTutorial &&
    !isContractReadyForDelivery(run, 'safe_return');

  const sector = getV3SectorDef(run.sectorId);
  const envIcon =
    sector.envModifier.id === 'cryo_ion'
      ? 'cryo'
      : sector.envModifier.id === 'gravity_tide'
      ? 'gravity'
      : 'radar';
  const relicSignalNodes = Object.values(run.graph.nodes).filter((n) => Boolean(n.hasRelicSignal));
  const relicSignalBannerHtml =
    relicSignalNodes.length > 0
      ? (() => {
          const target = relicSignalNodes[0];
          const relicName = target.relicSignalDefId
            ? getAnyV2ItemDef(target.relicSignalDefId)?.name ?? '古代遗物'
            : '古代遗物';
          return `<div class="v3-relic-pity-banner" data-testid="relic-pity-banner">
            ${svgIcon('museum', 14)}
            <span>保底遗物信号已锁定：第 ${target.layer} 层 ${target.lane === 0 ? 'A线' : 'B线'} 探测到「${relicName}」高能信号</span>
          </div>`;
        })()
      : '';

  const activeBonus = run.bonusObjective ?? run.contract.bonusObjective ?? null;
  const bonusTrackerHtml =
    activeBonus && !run.isTutorial
      ? (() => {
          const currentlyMet = evaluateRunBonusObjective(run, 'safe_return');
          const failedDiscard =
            activeBonus.id === 'bonus_no_discard' && (run.discardedCountThisRun ?? 0) > 0;
          const statusCls = failedDiscard ? 'is-failed' : currentlyMet ? 'is-met' : 'is-pending';
          const statusText = failedDiscard ? '已失格' : currentlyMet ? '当前满足' : '进行中';
          return `<div class="v3-bonus-tracker-strip ${statusCls}" data-testid="bonus-objective-tracker">
            <span>${svgIcon('target', 12)} 额外目标：<strong>${activeBonus.label}</strong>（+${activeBonus.rewardCredits}¤）</span>
            <span class="v3-bonus-status-chip">${statusText}</span>
          </div>`;
        })()
      : '';

  const mapGadgets = run.bay.placed
    .map((p) => ({ item: p.item, def: getV3GadgetDef(p.item.definitionId) }))
    .filter(
      (entry): entry is { item: typeof entry.item; def: NonNullable<typeof entry.def> } =>
        Boolean(entry.def && entry.def.usableIn === 'map_arrange')
    );

  const mapGadgetBarHtml =
    mapGadgets.length > 0 && actions.onUseGadget
      ? `<div class="v3-gadget-bar" data-testid="map-gadget-bar">
          <span class="v3-gadget-bar-label">${svgIcon('bolt', 12)} 战术消耗装置</span>
          <div class="v3-gadget-bar-btns">
            ${mapGadgets
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

  const navigatorRevealHtml = fullMapReveal
    ? `<div class="v3-relic-passive-banner" data-testid="relic-passive-navigator">
        ${svgIcon('museum', 13)} <strong>古代星盘常驻被动已生效</strong>：全图 ${run.graph.maxLayers} 层航路情报透视 · 出航燃料 +1
      </div>`
    : '';

  const finalMissionBannerHtml = run.isFinalCampaignRun
    ? `<div class="v3-final-mission-banner" data-testid="final-mission-banner">
        <strong>${svgIcon('star', 13)} 星门重启远征 · 第三幕终局任务</strong>
        <span>终局目标：第 6 层击溃三阶段「黑曜利维坦」</span>
      </div>`
    : '';

  const endlessThreat = run.endlessThreat ?? 0;
  const endlessBannerHtml =
    endlessThreat >= 1
      ? `<div class="v3-endless-hud-banner" data-testid="endless-hud-banner">
          <div class="v3-endless-hud-head">
            <span>${svgIcon('bolt', 13)} 无尽深渊 · 威压 ${endlessThreat}</span>
            <span class="num">挑战种子 #${run.seed}</span>
          </div>
          ${
            run.endlessMutatorIds && run.endlessMutatorIds.length > 0
              ? `<div class="v3-endless-mut-chips">
                  ${run.endlessMutatorIds
                    .map((mid) => {
                      const def = getV3EndlessMutatorDef(mid);
                      return `<span class="v3-endless-mut-chip">词条 · ${def?.name ?? mid}（${
                        def?.shortBadge ?? mid
                      }）</span>`;
                    })
                    .join('')}
                </div>`
              : `<div class="v3-endless-mut-chips"><span class="v3-endless-mut-chip">深渊威压词条激活中</span></div>`
          }
        </div>`
      : '';

  leftPanelEl.innerHTML = `
    <div class="v3-screen-root" data-testid="map-screen">
      <div class="panel-header">
        <h2>${svgIcon('radar', 16)} 星际航路 · ${run.contract.name}</h2>
        <span class="panel-sub">航行钱包 <strong class="num">${run.wallet}¤</strong></span>
      </div>

      <div class="v3-run-sector-strip env-${sector.envModifier.id}" data-testid="sector-modifier-badge">
        <span class="v3-sector-mod-badge">${svgIcon(envIcon, 13)} ${sector.name} · ${sector.envModifier.name}</span>
        <span class="v3-sector-mod-desc">${sector.envModifier.combatRuleSummary}</span>
      </div>

      ${finalMissionBannerHtml}

      ${endlessBannerHtml}

      ${navigatorRevealHtml}

      ${bonusTrackerHtml}

      ${relicSignalBannerHtml}

      ${mapGadgetBarHtml}

      ${
        isCompactViewport && focusLayers.length > 0
          ? `<div class="v2-map-mobile-toggle">
              <span class="v2-prep-label">${mobileMapShowFull ? `完整 ${run.graph.maxLayers} 层航图` : '接下来 2 层预览'}</span>
              <button type="button" class="btn btn-sm btn-ghost" id="v2-toggle-mobile-map">${
                mobileMapShowFull ? '切回近 2 层' : `展开完整 ${run.graph.maxLayers} 层`
              }</button>
            </div>`
          : ''
      }

      ${mapGraphHtml}

      <div class="v2-selected-node-deck">${selectedCardHtml}</div>

      <div class="v2-map-footer-actions">
        <button type="button" class="btn btn-secondary" id="v2-btn-safe-return" data-testid="btn-safe-return" ${
          readOnly ? 'disabled' : ''
        }>${svgIcon('beacon', 14)} 免费安全返航</button>
        ${
          canAbort
            ? `<button type="button" class="btn btn-ghost" id="v2-btn-abort-contract" ${
                readOnly ? 'disabled' : ''
              }>放弃当前委托</button>`
            : ''
        }
      </div>
    </div>
  `;

  leftPanelEl
    .querySelector('#v2-toggle-mobile-map')
    ?.addEventListener('click', actions.onToggleMobileMap);

  leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-select-node]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nid = btn.dataset.selectNode!;
      if (!reachableIds.includes(nid)) return;
      actions.onSelectNode(nid);
    });
  });

  leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-jump-node]').forEach((btn) => {
    btn.addEventListener('click', () => {
      actions.onJumpNode(btn.dataset.jumpNode!);
    });
  });

  leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-use-gadget]').forEach((btn) => {
    btn.addEventListener('click', () => {
      actions.onUseGadget?.(btn.dataset.useGadget!);
    });
  });

  leftPanelEl.querySelector('#v2-btn-safe-return')?.addEventListener('click', actions.onSafeReturn);
  leftPanelEl
    .querySelector('#v2-btn-abort-contract')
    ?.addEventListener('click', actions.onAbortContract);
}
