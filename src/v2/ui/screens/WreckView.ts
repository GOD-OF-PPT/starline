import { getItemImageUrl } from '../../../assets/itemArt';
import { getV3GadgetDef } from '../../data/gadgets';
import { getV3SectorDef } from '../../data/sectors';
import { V2_SHAPES } from '../../data/shapes';
import { buildActiveWreckStateForNode, evaluateWreckHotspotCut } from '../../domain/dismantle';
import { canUseV3GadgetInRun } from '../../domain/encounter';
import { getAnyV2ItemDef } from '../../domain/itemCatalog';
import type {
  V2ItemInstance,
  V2MapNode,
  V2ProfileState,
  V2RunState,
  V2WreckHotspot,
  V2WreckSpotId,
} from '../../domain/types';
import { crewPortraitSvg, svgIcon, type V2IconName } from '../icons';

export type WreckHotspotId = V2WreckSpotId;

export interface WreckHotspotOverlayProps {
  readonly run: V2RunState;
  readonly node: V2MapNode;
  readonly profile?: V2ProfileState;
  readonly readOnly: boolean;
  readonly selectedHotspot: WreckHotspotId;
  readonly cuttingSpotId?: WreckHotspotId | null;
}

export interface WreckHotspotOverlayActions {
  readonly onSelectHotspot: (spot: WreckHotspotId) => void;
  readonly onCutHotspot?: (spot: WreckHotspotId) => void;
  readonly onSkipCut?: () => void;
}

export const WRECK_SPOT_COORDS: Record<
  V2WreckSpotId,
  {
    readonly normX: number;
    readonly normY: number;
    readonly left: string;
    readonly top: string;
    readonly icon: V2IconName;
  }
> = {
  armory: { normX: 0.22, normY: 0.48, left: '22%', top: '38%', icon: 'cannon' },
  reactor: { normX: 0.5, normY: 0.45, left: '50%', top: '34%', icon: 'fuel' },
  cargo: { normX: 0.78, normY: 0.5, left: '78%', top: '39%', icon: 'crate' },
};

function describeItemForSalvager(item: V2ItemInstance): string {
  const def = getAnyV2ItemDef(item.definitionId);
  const name = def?.name ?? item.definitionId;
  const shapeLbl = def ? V2_SHAPES[def.shapeId].label : '';
  const qualityTag =
    item.category === 'equipment' ? (item.quality === 'improved' ? '优良' : '普通') : '';
  const parts = [qualityTag, shapeLbl, `${item.fixedValue}¤`].filter(Boolean);
  return `${name}（${parts.join(' · ')}）`;
}

function getSpotItems(spot: V2WreckHotspot): readonly V2ItemInstance[] {
  if (spot.rewardItems && spot.rewardItems.length > 0) return spot.rewardItems;
  if (spot.rewardItem) return [spot.rewardItem];
  return [];
}

/**
 * Top Phaser canvas overlay for derelict dissection (S08 + A07-code):
 * - Renders closed / cutting / cutaway compartment clamp pins with bundled item silhouette layer (0 broken URLs).
 * - Clicking a legal clamp pin directly initiates the 600ms skippable plasma cut FX!
 * - Strictly omits `data-testid="wreck-screen"` so the DOM contains exactly ONE wreck-screen root (in leftPanelEl).
 */
export function renderWreckHotspotOverlay(
  overlayEl: HTMLElement,
  props: WreckHotspotOverlayProps,
  actions: WreckHotspotOverlayActions
): void {
  const { run, node, profile, readOnly, selectedHotspot: sel, cuttingSpotId = null } = props;
  const wreck = buildActiveWreckStateForNode(run, node, profile).wreck;
  const sector = getV3SectorDef(run.sectorId);
  const peek = run.crewId === 'salvager';
  const pct =
    wreck.maxStability > 0 ? Math.max(0, Math.min(100, Math.round((wreck.stability / wreck.maxStability) * 100))) : 0;
  const toneCls = pct >= 70 ? 'tone-safe' : pct >= 35 ? 'tone-warn' : 'tone-critical';

  const pinsHtml = wreck.hotspots
    .map((spot) => {
      const pos = WRECK_SPOT_COORDS[spot.spotId] ?? {
        normX: 0.5,
        normY: 0.45,
        left: '50%',
        top: '36%',
        icon: 'wreck' as V2IconName,
      };
      const evalRes = evaluateWreckHotspotCut(run, wreck, spot.spotId);
      const isCuttingThis = cuttingSpotId === spot.spotId;
      const compartmentState: 'closed' | 'cutting' | 'cutaway' = spot.cut
        ? 'cutaway'
        : isCuttingThis
        ? 'cutting'
        : 'closed';
      const stateCls = spot.cut
        ? 'is-cut'
        : isCuttingThis
        ? 'is-cutting'
        : evalRes.isLethal
        ? 'is-lethal'
        : wreck.cutsMade >= 1
        ? 'is-risky'
        : '';
      const badgeText = spot.cut
        ? '已切开'
        : isCuttingThis
        ? '切割中…'
        : evalRes.isLethal
        ? '致命'
        : wreck.cutsMade === 0
        ? '点击切开'
        : '贪刀切开';

      const items = getSpotItems(spot);
      const silhouetteHtml =
        items.length > 0
          ? `<span class="v3-wreck-silhouette-layer" data-silhouette-state="${
              peek || spot.cut ? 'revealed' : 'masked'
            }"><img class="v3-wreck-silhouette-img ${
              peek || spot.cut ? 'is-revealed' : 'is-masked'
            }" src="${getItemImageUrl(items[0].definitionId)}" alt="" draggable="false" /></span>`
          : `<span class="v3-wreck-silhouette-layer" data-silhouette-state="${
              spot.cut ? 'revealed' : 'masked'
            }">${svgIcon('fuel', 18)}</span>`;

      const canDirectCut = !readOnly && !spot.cut && evalRes.canCut && cuttingSpotId === null;

      return `
        <button type="button" class="v2-wreck-hotspot v3-wreck-hotspot-pin v3-wreck-compartment-pin ${
          sel === spot.spotId ? 'active' : ''
        } ${stateCls}"
          style="left:${pos.left};top:${pos.top};"
          data-wreck-spot="${spot.spotId}"
          data-testid="wreck-spot-${spot.spotId}"
          data-compartment-state="${compartmentState}"
          data-can-direct-cut="${canDirectCut ? 'true' : 'false'}"
          data-action="wreck-cut"
          aria-pressed="${sel === spot.spotId}"
          ${spot.cut && cuttingSpotId === null ? 'disabled' : ''}>
          <span class="v3-clamp-bracket left" aria-hidden="true"></span>
          <span class="v3-clamp-bracket right" aria-hidden="true"></span>
          <span class="v2-hotspot-ring"></span>
          ${silhouetteHtml}
          <span class="v2-hotspot-tag">${svgIcon(pos.icon, 13)} ${spot.label} · <em>${badgeText}</em></span>
        </button>
      `;
    })
    .join('');

  const cuttingBannerHtml = cuttingSpotId
    ? `<div class="v3-wreck-cut-skip-bar">
        <button type="button" class="btn btn-sm btn-secondary v3-wreck-skip-btn" data-testid="btn-skip-wreck-cut">
          ${svgIcon('cut', 13)} 等离子切割中… 点击或按空格跳过
        </button>
      </div>`
    : '';

  overlayEl.innerHTML = `
    <div class="v3-overlay-screen v3-wreck-stage-overlay ${cuttingSpotId ? 'is-cutting-active' : ''}">
      <div class="v3-wreck-stage-head">
        <div class="scene-stage-tag">${svgIcon('wreck', 13)} ${sector.name} · 第 ${node.layer} 层 漂流残骸 · 多刀拆解</div>
        <div class="v3-wreck-stage-meter ${toneCls}">
          ${svgIcon('cut', 12)} 稳定度 <strong class="num">${wreck.stability}/${wreck.maxStability}</strong> · 已切 ${wreck.cutsMade} 刀
        </div>
      </div>
      ${pinsHtml}
      ${cuttingBannerHtml}
    </div>
  `;

  overlayEl.querySelectorAll<HTMLButtonElement>('[data-wreck-spot]').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const spotId = btn.dataset.wreckSpot as WreckHotspotId;
      if (cuttingSpotId !== null) {
        actions.onSkipCut?.();
        return;
      }
      if (btn.dataset.canDirectCut === 'true' && actions.onCutHotspot) {
        actions.onCutHotspot(spotId);
        return;
      }
      actions.onSelectHotspot(spotId);
    });
  });

  if (cuttingSpotId !== null) {
    overlayEl
      .querySelector<HTMLButtonElement>('[data-testid="btn-skip-wreck-cut"]')
      ?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        actions.onSkipCut?.();
      });
    overlayEl
      .querySelector<HTMLElement>('.v3-wreck-stage-overlay')
      ?.addEventListener('click', () => {
        actions.onSkipCut?.();
      });
  }
}

export interface WreckLeftPanelProps {
  readonly run: V2RunState;
  readonly node: V2MapNode;
  readonly profile?: V2ProfileState;
  readonly readOnly: boolean;
  readonly selectedHotspot: WreckHotspotId;
  readonly cuttingSpotId?: WreckHotspotId | null;
}

export interface WreckLeftPanelActions {
  readonly onSelectHotspot: (spot: WreckHotspotId) => void;
  readonly onCutSpot: (spotId: V2WreckSpotId) => void;
  readonly onSkipCut?: () => void;
  readonly onUseGadget?: (instanceId: string) => void;
  readonly onExtract: () => void;
  readonly onAbandon: () => void;
}

/**
 * Primary multi-cut derelict dissection panel (`[data-testid="wreck-screen"]`):
 * - Displays live Structural Stability / Alarm Meter (`[data-testid="wreck-stability"]`)
 * - Simultaneously mounts ALL hotspot cut cards (`[data-testid="wreck-cut-<spotId>"]`, >= 44x44px)
 * - Discloses greedy-cut hull/fuel/ambush risks, disables lethal cuts & in-flight double-clicks cleanly
 * - Keeps sticky Extract CTA (`[data-testid="btn-wreck-extract"]`) above fold on 1366x768 & 390x844
 */
export function renderWreckLeftPanel(
  leftPanelEl: HTMLElement,
  props: WreckLeftPanelProps,
  actions: WreckLeftPanelActions
): void {
  const { run, node, profile, readOnly, selectedHotspot, cuttingSpotId = null } = props;
  const wreck = buildActiveWreckStateForNode(run, node, profile).wreck;
  const peek = run.crewId === 'salvager';
  const salvagerT2 = peek && (run.crewMasteryTier ?? 0) >= 2;
  const isBusyCutting = cuttingSpotId !== null;

  const pct =
    wreck.maxStability > 0
      ? Math.max(0, Math.min(100, Math.round((wreck.stability / wreck.maxStability) * 100)))
      : 0;
  const toneCls = pct >= 70 ? 'tone-safe' : pct >= 35 ? 'tone-warn' : 'tone-critical';
  const alarmLabel =
    wreck.cutsMade === 0
      ? '首刀无伤 · 零风险切割'
      : pct >= 35
      ? '警戒状态 · 贪刀将触发结构风险'
      : '临界警报 · 结构极不稳定';

  const cardsHtml = wreck.hotspots
    .map((spot) => {
      const evalRes = evaluateWreckHotspotCut(run, wreck, spot.spotId);
      const pos = WRECK_SPOT_COORDS[spot.spotId] ?? { icon: 'wreck' as V2IconName };
      const items = getSpotItems(spot);
      const isSelected = selectedHotspot === spot.spotId;
      const isCuttingThis = cuttingSpotId === spot.spotId;

      // Build loot preview (Salvager full reveal vs shrouded range)
      let previewLine = '';
      if (items.length > 0 && (peek || spot.cut)) {
        previewLine = items.map(describeItemForSalvager).join(' + ');
      } else if (spot.spotId === 'armory' && node.wreck) {
        previewLine = `未知设备 · ${node.wreck.armorySizeRange} · ${node.wreck.armoryValueRange}`;
      } else if (spot.spotId === 'cargo' && node.wreck) {
        previewLine = `未知货箱 · ${node.wreck.cargoSizeRange} · ${node.wreck.cargoValueRange}`;
      } else if (spot.spotId === 'reactor') {
        const fuelG = (spot.reactorFuelGain ?? 0) + (salvagerT2 && (spot.reactorFuelGain ?? 0) > 0 ? 1 : 0);
        const repG = (spot.reactorRepairGain ?? 0) + (salvagerT2 && (spot.reactorRepairGain ?? 0) > 0 ? 2 : 0);
        const rParts: string[] = [];
        if (fuelG > 0) rParts.push(`燃料 +${fuelG}`);
        if (repG > 0) rParts.push(`应急修船 +${repG} HP`);
        if ((spot.rewardParts ?? 0) > 0) rParts.push(`精密零件 +${spot.rewardParts}`);
        previewLine = rParts.length > 0 ? rParts.join(' · ') : '拆解反应堆精密构件';
      } else {
        previewLine = items.length > 0 ? `封存物资 ×${items.length}` : '精密构件回收';
      }

      const bonusPills: string[] = [];
      if ((spot.rewardParts ?? 0) > 0 && spot.spotId !== 'reactor') {
        bonusPills.push(`+${spot.rewardParts} 精密零件`);
      }
      if ((spot.rewardCredits ?? 0) > 0) {
        bonusPills.push(`+${spot.rewardCredits}¤`);
      }

      let riskHtml = '';
      if (spot.cut) {
        riskHtml = `<span class="v3-risk-pill risk-done">${svgIcon('check', 12)} 舱室已切开</span>`;
      } else if (isCuttingThis) {
        riskHtml = `<span class="v3-risk-pill risk-warn">${svgIcon('cut', 12)} 等离子割枪切割中…</span>`;
      } else if (evalRes.isFirstSafeCut) {
        riskHtml = `<span class="v3-risk-pill risk-safe">${svgIcon('check', 12)} 首刀无伤（0 耐久 / 0 燃料消耗）</span>`;
      } else if (wreck.stabilizerActive) {
        riskHtml = `<span class="v3-risk-pill risk-safe">${svgIcon('check', 12)} 稳定器护航：下刀免伤防伏击（0 耐久 / 0 燃料）</span>`;
      } else {
        const pills: string[] = [];
        if (evalRes.isLethal) {
          pills.push(
            `<span class="v3-risk-pill risk-lethal">${svgIcon('warning', 12)} 致命风险：船体不足（需 &gt;${evalRes.effectiveHullDamage} HP，无法切割）</span>`
          );
        } else if (evalRes.effectiveHullDamage > 0) {
          pills.push(
            `<span class="v3-risk-pill risk-hull">${svgIcon('warning', 12)} 船体受损风险 -${evalRes.effectiveHullDamage} HP</span>`
          );
        }
        if (evalRes.effectiveFuelCost > 0) {
          pills.push(
            `<span class="v3-risk-pill risk-fuel">${svgIcon('fuel', 12)} 燃料消耗 -${evalRes.effectiveFuelCost}</span>`
          );
        }
        if (evalRes.effectiveAmbushRisk) {
          pills.push(
            `<span class="v3-risk-pill risk-ambush">${svgIcon('warning', 12)} 警报警告：可能触发敌舰伏击</span>`
          );
        }
        if (pills.length === 0) {
          pills.push(`<span class="v3-risk-pill risk-warn">贪刀损耗稳定度 -${evalRes.stabilityCost}</span>`);
        }
        riskHtml = pills.join('');
      }

      const btnLabel = spot.cut
        ? '已切开'
        : isCuttingThis
        ? `${svgIcon('cut', 14)} 等离子切割中…`
        : evalRes.isLethal
        ? `${svgIcon('warning', 14)} 船体不足 · 无法切割`
        : !evalRes.canCut
        ? `无法切割`
        : evalRes.isFirstSafeCut
        ? `${svgIcon('cut', 14)} 安全切开${spot.label}`
        : `${svgIcon('cut', 14)} 贪刀切开${spot.label}`;

      return `
        <div class="v3-wreck-cut-card ${isSelected ? 'is-selected' : ''} ${
        spot.cut ? 'is-cut' : ''
      } ${isCuttingThis ? 'is-cutting' : ''} ${evalRes.isLethal ? 'is-lethal' : ''}" data-wreck-card="${spot.spotId}">
          <div class="v3-wcc-head">
            <div class="v3-wcc-title">
              ${svgIcon(pos.icon, 15)}
              <strong>${spot.label}</strong>
              ${
                bonusPills.length > 0
                  ? `<span class="v3-parts-chip">${bonusPills.join(' · ')}</span>`
                  : ''
              }
            </div>
            <span class="v3-wcc-status ${
              spot.cut
                ? 'done'
                : isCuttingThis
                ? 'warn'
                : evalRes.isLethal
                ? 'lethal'
                : evalRes.isFirstSafeCut
                ? 'safe'
                : 'warn'
            }">${
        spot.cut
          ? '已切开'
          : isCuttingThis
          ? '切割中'
          : evalRes.isLethal
          ? '致命风险'
          : evalRes.isFirstSafeCut
          ? '首刀安全'
          : '贪刀风险'
      }</span>
          </div>
          <div class="v3-wcc-preview">${previewLine}</div>
          <div class="v3-risk-pills">${riskHtml}</div>
          <div class="v3-wcc-actions">
            <button type="button" class="btn ${
              spot.cut
                ? 'btn-ghost'
                : evalRes.isLethal
                ? 'btn-danger'
                : evalRes.isFirstSafeCut
                ? 'btn-primary'
                : 'btn-secondary'
            } v3-wreck-cut-btn" data-cut-spot="${spot.spotId}" data-testid="wreck-cut-${
        spot.spotId
      }" data-action="wreck-cut" ${readOnly || isBusyCutting || !evalRes.canCut ? 'disabled' : ''}>${btnLabel}</button>
          </div>
        </div>
      `;
    })
    .join('');

  const stabilizerGadgets = run.bay.placed
    .map((p) => ({ item: p.item, def: getV3GadgetDef(p.item.definitionId) }))
    .filter(
      (entry): entry is { item: typeof entry.item; def: NonNullable<typeof entry.def> } =>
        Boolean(entry.def && entry.def.usableIn === 'wreck')
    );

  const stabilizerBarHtml = wreck.stabilizerActive
    ? `<div class="v3-stabilizer-banner" data-testid="wreck-stabilizer-active">
        ${svgIcon('shield', 14)} <strong>切割稳定器已启用</strong>：下一次风险切割免疫船体损伤、燃料消耗与伏击警报！
      </div>`
    : stabilizerGadgets.length > 0 && actions.onUseGadget
    ? `<div class="v3-gadget-bar" data-testid="wreck-gadget-bar">
        <span class="v3-gadget-bar-label">${svgIcon('shield', 12)} 拆解消耗装置</span>
        <div class="v3-gadget-bar-btns">
          ${stabilizerGadgets
            .map(({ item, def }) => {
              const chk = canUseV3GadgetInRun(run, item.instanceId);
              return `<button type="button" class="btn btn-sm btn-primary v3-gadget-use-btn" data-use-gadget="${item.instanceId}" data-gadget-kind="${def.kind}" data-gadget-id="${def.kind}" data-testid="btn-use-gadget-${def.kind}" ${
                readOnly || isBusyCutting || !chk.usable ? 'disabled' : ''
              }>使用${def.buttonLabel}（${def.shortEffectLabel}）</button>`;
            })
            .join('')}
        </div>
      </div>`
    : '';

  leftPanelEl.innerHTML = `
    <div class="v3-screen-root v3-sticky-panel-root" data-testid="wreck-screen">
      <div class="panel-header">
        <h2>${svgIcon('wreck', 16)} 漂流残骸 · 多刀拆解</h2>
        <button type="button" class="btn btn-sm btn-ghost" id="v2-btn-abandon-event" ${
          readOnly || isBusyCutting ? 'disabled' : ''
        }>放弃并返航</button>
      </div>

      <div class="v3-panel-scroll-body">
        <div class="v3-wreck-stability-card ${toneCls}" data-testid="wreck-stability">
          <div class="v3-ws-row">
            <span class="v3-ws-label">${svgIcon('cut', 14)} 结构稳定度 <strong class="num">${
    wreck.stability
  }/${wreck.maxStability}</strong></span>
            <span class="v3-ws-alarm">${alarmLabel}</span>
          </div>
          <div class="v3-stability-track" role="progressbar" aria-valuenow="${wreck.stability}" aria-valuemin="0" aria-valuemax="${wreck.maxStability}">
            <div class="v3-stability-fill ${toneCls}" style="width:${pct}%"></div>
          </div>
          <div class="v3-ws-meta">
            <span>已切割 <strong class="num">${wreck.cutsMade}</strong> 刀</span>
            <span>暂存物资 <strong class="num">${run.bay.staging.length}</strong> 件</span>
            <span>本趟精密零件 <strong class="num">+${run.salvagePartsEarned}</strong></span>
          </div>
        </div>

        ${stabilizerBarHtml}

        ${
          peek
            ? `<div class="v3-salvager-intel-bar">
                ${crewPortraitSvg('salvager', 24)}
                <span><strong>打捞师·苏岚</strong> 扫描全透视已激活：以下显示各舱室确切物资、占格与回收估价。</span>
              </div>`
            : ''
        }

        ${
          node.contractMarker && run.contract.type === 'derelict'
            ? `<div class="v3-relic-pity-banner">${svgIcon('star', 13)} 黑匣打捞目标残骸：撤离时将同步回收 1×2 加密黑匣记录仪！</div>`
            : node.contractMarker && run.contract.type === 'transport'
            ? `<div class="v3-relic-pity-banner">${svgIcon('star', 13)} 委托目标封存舱：撤离时将同步回收 2×3 密封反应堆（占 6 格）！</div>`
            : ''
        }

        ${
          wreck.lastCutSummary
            ? `<div class="v3-wreck-last-cut">${svgIcon('parts', 13)} ${wreck.lastCutSummary}</div>`
            : ''
        }

        <div class="v3-wreck-cut-grid">
          ${cardsHtml}
        </div>
      </div>

      <div class="v3-sticky-cta-footer">
        ${
          isBusyCutting
            ? `<button type="button" class="btn btn-secondary v3-wreck-skip-panel-btn" data-testid="btn-skip-wreck-cut-panel">${svgIcon('cut', 14)} 跳过切割动画</button>`
            : ''
        }
        <button type="button" class="btn btn-primary btn-launch-hero v3-wreck-extract-btn" id="v3-btn-wreck-extract" data-testid="btn-wreck-extract" data-action="wreck-extract" ${
          readOnly || isBusyCutting ? 'disabled' : ''
        }>${svgIcon('rocket', 15)} ${
    wreck.cutsMade > 0 ? '安全撤离并整理战利品 →' : '暂不切割 · 直接撤离'
  }</button>
      </div>
    </div>
  `;

  leftPanelEl.querySelectorAll<HTMLElement>('[data-wreck-card]').forEach((card) => {
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      if (isBusyCutting) {
        actions.onSkipCut?.();
        return;
      }
      actions.onSelectHotspot(card.dataset.wreckCard as WreckHotspotId);
    });
  });

  leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-cut-spot]').forEach((btn) => {
    btn.addEventListener('click', () => {
      actions.onCutSpot(btn.dataset.cutSpot as V2WreckSpotId);
    });
  });

  leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-use-gadget]').forEach((btn) => {
    btn.addEventListener('click', () => {
      actions.onUseGadget?.(btn.dataset.useGadget!);
    });
  });

  leftPanelEl
    .querySelector<HTMLButtonElement>('[data-testid="btn-skip-wreck-cut-panel"]')
    ?.addEventListener('click', () => actions.onSkipCut?.());
  leftPanelEl.querySelector('#v3-btn-wreck-extract')?.addEventListener('click', actions.onExtract);
  leftPanelEl.querySelector('#v2-btn-abandon-event')?.addEventListener('click', actions.onAbandon);
}
