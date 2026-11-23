import { getV3SectorDef } from '../../data/sectors';
import { V2_SHAPES } from '../../data/shapes';
import { getAnyV2ItemDef } from '../../domain/itemCatalog';
import type { V2MapNode, V2RunState, V2WreckChoice } from '../../domain/types';
import { svgIcon } from '../icons';

export type WreckHotspotId = 'armory' | 'reactor' | 'cargo';

export interface WreckHotspotOverlayProps {
  readonly run: V2RunState;
  readonly node: V2MapNode;
  readonly readOnly: boolean;
  readonly selectedHotspot: WreckHotspotId;
}

export interface WreckHotspotOverlayActions {
  readonly onSelectHotspot: (spot: WreckHotspotId) => void;
  readonly onCutWreck: (room: V2WreckChoice) => void;
}

export function renderWreckHotspotOverlay(
  overlayEl: HTMLElement,
  props: WreckHotspotOverlayProps,
  actions: WreckHotspotOverlayActions
): void {
  const { run, node, readOnly, selectedHotspot: sel } = props;
  const w = node.wreck;
  if (!w) return;

  const peek = run.crewId === 'salvager';
  const salvagerT2 = peek && (run.crewMasteryTier ?? 0) >= 2;
  const sector = getV3SectorDef(run.sectorId);
  const armDef = getAnyV2ItemDef(w.armoryItem.definitionId);
  const cargoSummary = w.cargoItems
    .map((c) => {
      const def = getAnyV2ItemDef(c.definitionId);
      const shapeLbl = def ? V2_SHAPES[def.shapeId].label : '';
      return `${def?.name ?? c.definitionId}(${shapeLbl ? `${shapeLbl} · ` : ''}${c.fixedValue}¤)`;
    })
    .join(' + ');
  const baseReactorFuel = (w.reactorFuelGain ?? 2) + (salvagerT2 ? 1 : 0);
  const baseReactorRepair = (w.reactorRepairGain ?? 8) + (salvagerT2 ? 2 : 0);
  const fuelGain = Math.min(baseReactorFuel, run.maxFuel - run.fuel);
  const repairGain = Math.min(baseReactorRepair, run.maxHp - run.hp);

  let detailHtml = '';
  if (sel === 'armory') {
    detailHtml = `
      <div class="v2-wh-confirm-text">
        <strong>军械舱（1 件设备）</strong>
        <span>${
          peek && armDef
            ? `打捞师·苏岚透视：${armDef.name}（${w.armoryItem.quality === 'improved' ? '优良' : '普通'} · ${V2_SHAPES[armDef.shapeId].label} · 回收 ${w.armoryItem.fixedValue}¤）`
            : `预计占格 ${w.armorySizeRange} · ${w.armoryValueRange}`
        }</span>
      </div>
      <button type="button" class="btn btn-primary" data-cut-wreck="armory" data-testid="wreck-cut-armory" ${
        readOnly ? 'disabled' : ''
      }>${svgIcon('cannon', 15)} 切开军械舱</button>
    `;
  } else if (sel === 'reactor') {
    detailHtml = `
      <div class="v2-wh-confirm-text">
        <strong>反应舱（深潜续航补给${salvagerT2 ? ' · 苏岚专精加成' : ''}）</strong>
        <span>不占船舱格位：可抽取剩余燃料 +${baseReactorFuel} 或应急抢修 +${baseReactorRepair} 耐久</span>
      </div>
      <div class="v2-wh-reactor-btns">
        <button type="button" class="btn btn-primary" data-cut-wreck="reactor_fuel" data-testid="wreck-cut-reactor_fuel" ${
          readOnly || fuelGain <= 0 ? 'disabled' : ''
        }>${svgIcon('fuel', 14)} ${fuelGain > 0 ? `抽取 +${fuelGain} 燃料` : '燃料已满'}</button>
        <button type="button" class="btn btn-secondary" data-cut-wreck="reactor_repair" data-testid="wreck-cut-reactor_repair" ${
          readOnly || repairGain <= 0 ? 'disabled' : ''
        }>${svgIcon('wrench', 14)} ${repairGain > 0 ? `抢修 +${repairGain} 耐久` : '耐久已满'}</button>
      </div>
    `;
  } else {
    detailHtml = `
      <div class="v2-wh-confirm-text">
        <strong>货舱（${w.cargoItems.length} 件货物）</strong>
        <span>${
          peek ? `打捞师·苏岚透视：${cargoSummary}` : `预计占格 ${w.cargoSizeRange} · ${w.cargoValueRange}`
        }</span>
      </div>
      <button type="button" class="btn btn-primary" data-cut-wreck="cargo" data-testid="wreck-cut-cargo" ${
        readOnly ? 'disabled' : ''
      }>${svgIcon('crate', 15)} 切开货舱</button>
    `;
  }

  overlayEl.innerHTML = `
    <div class="v3-overlay-screen" data-testid="wreck-screen">
      <div class="scene-stage-tag">${svgIcon('wreck', 13)} ${sector.name} · 第 ${node.layer} 层 漂流残骸（选择 1 处舱室切开）</div>
      <!-- M4 (F11) slot: [data-testid="wreck-stability"] & [data-testid="btn-wreck-extract"] -->

      <button type="button" class="v2-wreck-hotspot ${sel === 'armory' ? 'active' : ''}"
        style="left:22%;top:48%;" data-wreck-spot="armory" data-testid="wreck-spot-armory" aria-pressed="${sel === 'armory'}">
        <span class="v2-hotspot-ring"></span>
        <span class="v2-hotspot-tag">${svgIcon('cannon', 13)} 军械舱</span>
      </button>

      <button type="button" class="v2-wreck-hotspot ${sel === 'reactor' ? 'active' : ''}"
        style="left:50%;top:46%;" data-wreck-spot="reactor" data-testid="wreck-spot-reactor" aria-pressed="${sel === 'reactor'}">
        <span class="v2-hotspot-ring"></span>
        <span class="v2-hotspot-tag">${svgIcon('fuel', 13)} 反应舱</span>
      </button>

      <button type="button" class="v2-wreck-hotspot ${sel === 'cargo' ? 'active' : ''}"
        style="left:79%;top:51%;" data-wreck-spot="cargo" data-testid="wreck-spot-cargo" aria-pressed="${sel === 'cargo'}">
        <span class="v2-hotspot-ring"></span>
        <span class="v2-hotspot-tag">${svgIcon('crate', 13)} 货舱</span>
      </button>

      <div class="v2-wreck-confirm-dock">
        ${detailHtml}
      </div>
    </div>
  `;

  overlayEl.querySelectorAll<HTMLButtonElement>('[data-wreck-spot]').forEach((btn) => {
    btn.addEventListener('click', () => {
      actions.onSelectHotspot(btn.dataset.wreckSpot as WreckHotspotId);
    });
  });

  overlayEl.querySelectorAll<HTMLButtonElement>('[data-cut-wreck]').forEach((btn) => {
    btn.addEventListener('click', () => {
      actions.onCutWreck(btn.dataset.cutWreck as V2WreckChoice);
    });
  });
}

export function renderWreckLeftPanel(
  leftPanelEl: HTMLElement,
  props: { readonly readOnly: boolean },
  actions: { readonly onAbandon: () => void }
): void {
  leftPanelEl.innerHTML = `
    <div class="v3-screen-root">
      <div class="panel-header">
        <h2>${svgIcon('wreck', 16)} 废船打捞 · 空间与续航抉择</h2>
        <button type="button" class="btn btn-sm btn-ghost" id="v2-btn-abandon-event" ${
          props.readOnly ? 'disabled' : ''
        }>放弃并返航</button>
      </div>
      <div class="v2-empty-hint">
        直接在上方残骸画面中点击<strong>军械舱</strong>、<strong>反应舱</strong>或<strong>货舱</strong>切开对应舱室（只能选一处）。
      </div>
    </div>
  `;

  leftPanelEl.querySelector('#v2-btn-abandon-event')?.addEventListener('click', actions.onAbandon);
}
