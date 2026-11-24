import { getItemImageUrl } from '../../../assets/itemArt';
import { V2_EQUIPMENT_DEFS } from '../../data/equipment';
import { V2_SHAPES } from '../../data/shapes';
import { getAnyV2ItemDef } from '../../domain/itemCatalog';
import {
  computeV2PlacementTacticalDelta,
  type V2TacticalDelta,
} from '../../domain/tacticalDelta';
import type { V2RunState } from '../../domain/types';
import { renderV2MiniMaskHtml } from '../CargoGridV2';
import { svgIcon } from '../icons';
import type { PhaseView } from './screenTypes';

export interface RewardViewProps {
  readonly run: V2RunState;
  readonly readOnly: boolean;
  readonly stargateRelayTier?: number;
}

export interface RewardViewActions {
  readonly onPickReward: (choice: 'equipment' | 'cargo' | 'repair') => void;
}

function syncButtonDisabled(btn: HTMLButtonElement, disabled: boolean): void {
  if (btn.disabled !== disabled) {
    btn.disabled = disabled;
  }
  if (disabled) {
    btn.setAttribute('disabled', '');
  } else {
    btn.removeAttribute('disabled');
  }
}

export class RewardPhaseView implements PhaseView<RewardViewProps, RewardViewActions> {
  private hostEl: HTMLElement | null = null;
  private rootEl: HTMLDivElement | null = null;
  private walletValEl: HTMLElement | null = null;

  private eqBtnEl: HTMLButtonElement | null = null;
  private eqImgEl: HTMLImageElement | null = null;
  private eqTitleEl: HTMLDivElement | null = null;
  private eqSubEl: HTMLDivElement | null = null;
  private eqValEl: HTMLDivElement | null = null;

  private cargoBtnEl: HTMLButtonElement | null = null;
  private cargoImgEl: HTMLImageElement | null = null;
  private cargoTitleEl: HTMLDivElement | null = null;
  private cargoSubEl: HTMLDivElement | null = null;
  private cargoValEl: HTMLDivElement | null = null;

  private repairBtnEl: HTMLButtonElement | null = null;
  private repairTitleEl: HTMLDivElement | null = null;
  private repairSubEl: HTMLDivElement | null = null;

  private latestActions: RewardViewActions | null = null;
  private lastDeltaKey: string | null = null;
  private cachedDelta: V2TacticalDelta | null = null;
  private lastEqCardKey: string | null = null;
  private lastCargoCardKey: string | null = null;

  private readonly handleRootClick = (ev: Event): void => {
    if (!this.rootEl || !this.latestActions) return;
    const target = ev.target as HTMLElement | null;
    if (!target || typeof target.closest !== 'function') return;
    const btn = target.closest('[data-pick-reward]') as HTMLButtonElement | null;
    if (!btn || !this.rootEl.contains(btn) || btn.disabled) return;
    const choice = btn.dataset.pickReward as 'equipment' | 'cargo' | 'repair' | undefined;
    if (choice) {
      this.latestActions.onPickReward(choice);
    }
  };

  isMountedIn(host: HTMLElement): boolean {
    return Boolean(this.hostEl === host && this.rootEl && this.rootEl.parentElement === host);
  }

  mount(host: HTMLElement): void {
    if (this.isMountedIn(host)) return;
    if (this.rootEl || this.hostEl) {
      this.unmount();
    }
    this.hostEl = host;
    host.innerHTML = '';

    const root = document.createElement('div');
    root.className = 'v3-screen-root';
    root.dataset.testid = 'reward-screen';

    const header = document.createElement('div');
    header.className = 'panel-header';
    const h2 = document.createElement('h2');
    h2.innerHTML = `${svgIcon('star', 16)} 战斗胜利 · 3 选 1 战利品`;
    const sub = document.createElement('span');
    sub.className = 'panel-sub';
    sub.textContent = '航行钱包 ';
    const walletVal = document.createElement('strong');
    walletVal.className = 'num';
    sub.appendChild(walletVal);
    header.appendChild(h2);
    header.appendChild(sub);
    root.appendChild(header);

    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'v2-reward-cards';

    // Equipment card
    const eqBtn = document.createElement('button');
    eqBtn.type = 'button';
    eqBtn.className = 'v2-reward-card';
    eqBtn.dataset.pickReward = 'equipment';
    const eqImg = document.createElement('img');
    eqImg.className = 'v2-reward-img';
    const eqInfo = document.createElement('div');
    eqInfo.className = 'v2-reward-info';
    const eqTitle = document.createElement('div');
    eqTitle.className = 'v2-reward-title';
    const eqSub = document.createElement('div');
    eqSub.className = 'v2-reward-sub';
    const eqVal = document.createElement('div');
    eqVal.className = 'v2-reward-val';
    eqInfo.appendChild(eqTitle);
    eqInfo.appendChild(eqSub);
    eqInfo.appendChild(eqVal);
    eqBtn.appendChild(eqImg);
    eqBtn.appendChild(eqInfo);
    cardsWrap.appendChild(eqBtn);

    // Cargo card
    const cargoBtn = document.createElement('button');
    cargoBtn.type = 'button';
    cargoBtn.className = 'v2-reward-card';
    cargoBtn.dataset.pickReward = 'cargo';
    const cargoImg = document.createElement('img');
    cargoImg.className = 'v2-reward-img';
    const cargoInfo = document.createElement('div');
    cargoInfo.className = 'v2-reward-info';
    const cargoTitle = document.createElement('div');
    cargoTitle.className = 'v2-reward-title';
    const cargoSub = document.createElement('div');
    cargoSub.className = 'v2-reward-sub';
    const cargoVal = document.createElement('div');
    cargoVal.className = 'v2-reward-val';
    cargoInfo.appendChild(cargoTitle);
    cargoInfo.appendChild(cargoSub);
    cargoInfo.appendChild(cargoVal);
    cargoBtn.appendChild(cargoImg);
    cargoBtn.appendChild(cargoInfo);
    cardsWrap.appendChild(cargoBtn);

    // Repair card
    const repairBtn = document.createElement('button');
    repairBtn.type = 'button';
    repairBtn.className = 'v2-reward-card';
    repairBtn.dataset.pickReward = 'repair';
    const repairIcon = document.createElement('div');
    repairIcon.className = 'v2-reward-repair-icon';
    repairIcon.innerHTML = svgIcon('wrench', 24);
    const repairInfo = document.createElement('div');
    repairInfo.className = 'v2-reward-info';
    const repairTitle = document.createElement('div');
    repairTitle.className = 'v2-reward-title';
    const repairSub = document.createElement('div');
    repairSub.className = 'v2-reward-sub';
    const repairVal = document.createElement('div');
    repairVal.className = 'v2-reward-val';
    repairVal.textContent = '保住血线继续向深层推进';
    repairInfo.appendChild(repairTitle);
    repairInfo.appendChild(repairSub);
    repairInfo.appendChild(repairVal);
    repairBtn.appendChild(repairIcon);
    repairBtn.appendChild(repairInfo);
    cardsWrap.appendChild(repairBtn);

    root.appendChild(cardsWrap);
    host.appendChild(root);

    root.addEventListener('click', this.handleRootClick);

    this.rootEl = root;
    this.walletValEl = walletVal;
    this.eqBtnEl = eqBtn;
    this.eqImgEl = eqImg;
    this.eqTitleEl = eqTitle;
    this.eqSubEl = eqSub;
    this.eqValEl = eqVal;
    this.cargoBtnEl = cargoBtn;
    this.cargoImgEl = cargoImg;
    this.cargoTitleEl = cargoTitle;
    this.cargoSubEl = cargoSub;
    this.cargoValEl = cargoVal;
    this.repairBtnEl = repairBtn;
    this.repairTitleEl = repairTitle;
    this.repairSubEl = repairSub;
  }

  update(props: RewardViewProps, actions: RewardViewActions): void {
    this.latestActions = actions;
    if (!this.rootEl) return;

    const { run, readOnly, stargateRelayTier = 0 } = props;
    const bundle = run.pendingReward;
    if (!bundle) return;

    const walletText = `${run.wallet}¤`;
    if (this.walletValEl && this.walletValEl.textContent !== walletText) {
      this.walletValEl.textContent = walletText;
    }

    const eqDef = V2_EQUIPMENT_DEFS[bundle.equipmentOption.definitionId];
    const cargoDef = getAnyV2ItemDef(bundle.cargoOption.definitionId);

    // Memoize combat delta simulation across readOnly / resize refreshes
    const baySig = run.bay.placed
      .map((p) => `${p.item.instanceId}@${p.x},${p.y}:${p.rotation}`)
      .join('|');
    const deltaKey = `${run.runId}:${run.currentNodeId ?? ''}:${bundle.equipmentOption.instanceId}:${
      run.hp
    }:${run.maxHp}:${run.targetPolicy}:${stargateRelayTier}:${baySig}`;
    if (this.lastDeltaKey !== deltaKey || !this.cachedDelta) {
      this.lastDeltaKey = deltaKey;
      this.cachedDelta = computeV2PlacementTacticalDelta({
        run,
        bay: run.bay,
        startingHp: run.hp,
        maxHp: run.maxHp,
        targetPolicy: run.targetPolicy,
        item: bundle.equipmentOption,
        zone: 'staging',
        stargateRelayTier,
      });
    }
    const eqDelta = this.cachedDelta;

    if (this.eqBtnEl && this.eqImgEl && this.eqTitleEl && this.eqSubEl && this.eqValEl) {
      syncButtonDisabled(this.eqBtnEl, readOnly);
      const eqKey = `${bundle.equipmentOption.instanceId}:${bundle.equipmentOption.definitionId}:${
        bundle.equipmentOption.quality
      }:${eqDelta.synergyLine}:${eqDelta.qualitativeDeltaLine ?? eqDelta.combatDeltaLine}`;
      if (this.lastEqCardKey !== eqKey) {
        this.lastEqCardKey = eqKey;
        this.eqImgEl.src = getItemImageUrl(bundle.equipmentOption.definitionId);
        this.eqImgEl.alt = eqDef?.name ?? '';
        this.eqTitleEl.innerHTML = `设备：${eqDef?.name ?? bundle.equipmentOption.definitionId} <span class="v2-quality-chip ${
          bundle.equipmentOption.quality
        }">${bundle.equipmentOption.quality === 'improved' ? '优良' : '普通'}</span>`;
        this.eqSubEl.innerHTML = eqDef
          ? `${renderV2MiniMaskHtml(eqDef.shapeId)} ${V2_SHAPES[eqDef.shapeId].label} · ${eqDelta.synergyLine}`
          : '';
        this.eqValEl.textContent = eqDelta.qualitativeDeltaLine ?? eqDelta.combatDeltaLine;
      }
    }

    if (this.cargoBtnEl && this.cargoImgEl && this.cargoTitleEl && this.cargoSubEl && this.cargoValEl) {
      syncButtonDisabled(this.cargoBtnEl, readOnly);
      const cargoKey = `${bundle.cargoOption.instanceId}:${bundle.cargoOption.definitionId}:${bundle.cargoOption.fixedValue}`;
      if (this.lastCargoCardKey !== cargoKey) {
        this.lastCargoCardKey = cargoKey;
        this.cargoImgEl.src = getItemImageUrl(bundle.cargoOption.definitionId);
        this.cargoImgEl.alt = cargoDef?.name ?? '';
        this.cargoTitleEl.textContent = `货物：${cargoDef?.name ?? bundle.cargoOption.definitionId}`;
        this.cargoSubEl.innerHTML = cargoDef
          ? `${renderV2MiniMaskHtml(cargoDef.shapeId)} ${V2_SHAPES[cargoDef.shapeId].label} · ${cargoDef.summary}`
          : '';
        this.cargoValEl.innerHTML = `返航售价 <strong>+${bundle.cargoOption.fixedValue}¤</strong>`;
      }
    }

    if (this.repairBtnEl && this.repairTitleEl && this.repairSubEl) {
      syncButtonDisabled(this.repairBtnEl, readOnly);
      const repTitle = `战地抢修：恢复 +${bundle.repairAmount} 耐久`;
      if (this.repairTitleEl.textContent !== repTitle) {
        this.repairTitleEl.textContent = repTitle;
      }
      const repSub = `当前耐久 ${run.hp}/${run.maxHp} · 不占船舱格位`;
      if (this.repairSubEl.textContent !== repSub) {
        this.repairSubEl.textContent = repSub;
      }
    }
  }

  unmount(): void {
    this.rootEl?.removeEventListener('click', this.handleRootClick);
    this.rootEl?.remove();
    this.hostEl = null;
    this.rootEl = null;
    this.walletValEl = null;
    this.eqBtnEl = null;
    this.eqImgEl = null;
    this.eqTitleEl = null;
    this.eqSubEl = null;
    this.eqValEl = null;
    this.cargoBtnEl = null;
    this.cargoImgEl = null;
    this.cargoTitleEl = null;
    this.cargoSubEl = null;
    this.cargoValEl = null;
    this.repairBtnEl = null;
    this.repairTitleEl = null;
    this.repairSubEl = null;
    this.latestActions = null;
    this.lastDeltaKey = null;
    this.cachedDelta = null;
    this.lastEqCardKey = null;
    this.lastCargoCardKey = null;
  }
}

const legacyRewardViews = new WeakMap<HTMLElement, RewardPhaseView>();

export function renderRewardView(
  leftPanelEl: HTMLElement,
  props: RewardViewProps,
  actions: RewardViewActions
): void {
  let view = legacyRewardViews.get(leftPanelEl);
  if (!view) {
    view = new RewardPhaseView();
    legacyRewardViews.set(leftPanelEl, view);
  }
  if (!view.isMountedIn(leftPanelEl)) {
    view.mount(leftPanelEl);
  }
  view.update(props, actions);
}
