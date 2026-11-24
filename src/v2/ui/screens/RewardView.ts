import { getItemImageUrl } from '../../../assets/itemArt';
import { V2_EQUIPMENT_DEFS } from '../../data/equipment';
import { V2_SHAPES } from '../../data/shapes';
import { getAnyV2ItemDef } from '../../domain/itemCatalog';
import { computeV2PlacementTacticalDelta } from '../../domain/tacticalDelta';
import type { V2RunState } from '../../domain/types';
import { renderV2MiniMaskHtml } from '../CargoGridV2';
import { svgIcon } from '../icons';

export interface RewardViewProps {
  readonly run: V2RunState;
  readonly readOnly: boolean;
  readonly stargateRelayTier?: number;
}

export interface RewardViewActions {
  readonly onPickReward: (choice: 'equipment' | 'cargo' | 'repair') => void;
}

export function renderRewardView(
  leftPanelEl: HTMLElement,
  props: RewardViewProps,
  actions: RewardViewActions
): void {
  const { run, readOnly, stargateRelayTier = 0 } = props;
  const bundle = run.pendingReward;
  if (!bundle) return;

  const eqDef = V2_EQUIPMENT_DEFS[bundle.equipmentOption.definitionId];
  const cargoDef = getAnyV2ItemDef(bundle.cargoOption.definitionId);

  const eqDelta = computeV2PlacementTacticalDelta({
    run,
    bay: run.bay,
    startingHp: run.hp,
    maxHp: run.maxHp,
    targetPolicy: run.targetPolicy,
    item: bundle.equipmentOption,
    zone: 'staging',
    stargateRelayTier,
  });

  leftPanelEl.innerHTML = `
    <div class="v3-screen-root" data-testid="reward-screen">
      <div class="panel-header">
        <h2>${svgIcon('star', 16)} 战斗胜利 · 3 选 1 战利品</h2>
        <span class="panel-sub">航行钱包 <strong class="num">${run.wallet}¤</strong></span>
      </div>

      <div class="v2-reward-cards">
        <button type="button" class="v2-reward-card" data-pick-reward="equipment" ${
          readOnly ? 'disabled' : ''
        }>
          <img class="v2-reward-img" src="${getItemImageUrl(bundle.equipmentOption.definitionId)}" alt="${eqDef?.name ?? ''}" />
          <div class="v2-reward-info">
            <div class="v2-reward-title">设备：${eqDef?.name ?? bundle.equipmentOption.definitionId} <span class="v2-quality-chip ${
    bundle.equipmentOption.quality
  }">${bundle.equipmentOption.quality === 'improved' ? '优良' : '普通'}</span></div>
            <div class="v2-reward-sub">${
              eqDef ? `${renderV2MiniMaskHtml(eqDef.shapeId)} ${V2_SHAPES[eqDef.shapeId].label} · ${eqDelta.synergyLine}` : ''
            }</div>
            <div class="v2-reward-val">${eqDelta.qualitativeDeltaLine ?? eqDelta.combatDeltaLine}</div>
          </div>
        </button>

        <button type="button" class="v2-reward-card" data-pick-reward="cargo" ${
          readOnly ? 'disabled' : ''
        }>
          <img class="v2-reward-img" src="${getItemImageUrl(bundle.cargoOption.definitionId)}" alt="${cargoDef?.name ?? ''}" />
          <div class="v2-reward-info">
            <div class="v2-reward-title">货物：${cargoDef?.name ?? bundle.cargoOption.definitionId}</div>
            <div class="v2-reward-sub">${
              cargoDef ? `${renderV2MiniMaskHtml(cargoDef.shapeId)} ${V2_SHAPES[cargoDef.shapeId].label} · ${cargoDef.summary}` : ''
            }</div>
            <div class="v2-reward-val">返航售价 <strong>+${bundle.cargoOption.fixedValue}¤</strong></div>
          </div>
        </button>

        <button type="button" class="v2-reward-card" data-pick-reward="repair" ${
          readOnly ? 'disabled' : ''
        }>
          <div class="v2-reward-repair-icon">${svgIcon('wrench', 24)}</div>
          <div class="v2-reward-info">
            <div class="v2-reward-title">战地抢修：恢复 +${bundle.repairAmount} 耐久</div>
            <div class="v2-reward-sub">当前耐久 ${run.hp}/${run.maxHp} · 不占船舱格位</div>
            <div class="v2-reward-val">保住血线继续向深层推进</div>
          </div>
        </button>
      </div>
    </div>
  `;

  leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-pick-reward]').forEach((btn) => {
    btn.addEventListener('click', () => {
      actions.onPickReward(btn.dataset.pickReward as 'equipment' | 'cargo' | 'repair');
    });
  });
}
