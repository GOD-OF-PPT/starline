import { getItemImageUrl } from '../../../assets/itemArt';
import { V2_CARGO_DEFS } from '../../data/cargo';
import { V2_EQUIPMENT_DEFS } from '../../data/equipment';
import { V2_SHAPES } from '../../data/shapes';
import { evaluateV2RewardSynergies } from '../../domain/buildStatsV2';
import { getAnyV2ItemDef } from '../../domain/itemCatalog';
import {
  computeV2PlacementTacticalDelta,
  type V2TacticalDelta,
} from '../../domain/tacticalDelta';
import type { V2RewardChoiceId, V2RunState } from '../../domain/types';
import { renderV2MiniMaskHtml } from '../CargoGridV2';
import { svgIcon } from '../icons';
import type { PhaseView } from './screenTypes';

export interface RewardViewProps {
  readonly run: V2RunState;
  readonly readOnly: boolean;
  readonly stargateRelayTier?: number;
}

export interface RewardViewActions {
  readonly onPickReward: (choice: V2RewardChoiceId) => void;
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

interface EqCardRefs {
  readonly btnEl: HTMLButtonElement;
  readonly imgEl: HTMLImageElement;
  readonly repairIconEl: HTMLDivElement;
  readonly titleEl: HTMLDivElement;
  readonly synergyEl: HTMLDivElement;
  readonly subEl: HTMLDivElement;
  readonly valEl: HTMLDivElement;
  lastDeltaKey: string | null;
  cachedDelta: V2TacticalDelta | null;
  lastCardKey: string | null;
}

export class RewardPhaseView implements PhaseView<RewardViewProps, RewardViewActions> {
  private hostEl: HTMLElement | null = null;
  private rootEl: HTMLDivElement | null = null;
  private walletValEl: HTMLElement | null = null;
  private bonusBannerEl: HTMLDivElement | null = null;
  private cardsWrapEl: HTMLDivElement | null = null;
  private slots: EqCardRefs[] = [];
  private skipWrapEl: HTMLDivElement | null = null;
  private skipBtnEl: HTMLButtonElement | null = null;

  private latestActions: RewardViewActions | null = null;
  private lastBonusKey: string | null = null;

  private readonly handleRootClick = (ev: Event): void => {
    if (!this.rootEl || !this.latestActions) return;
    const target = ev.target as HTMLElement | null;
    if (!target || typeof target.closest !== 'function') return;
    const btn = target.closest('[data-pick-reward]') as HTMLButtonElement | null;
    if (!btn || !this.rootEl.contains(btn) || btn.disabled) return;
    const choice = btn.dataset.pickReward as V2RewardChoiceId | undefined;
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
    h2.innerHTML = `${svgIcon('star', 16)} 战斗胜利 · 3 选 1 装备战利品`;
    const sub = document.createElement('span');
    sub.className = 'panel-sub';
    sub.textContent = '航行钱包 ';
    const walletVal = document.createElement('strong');
    walletVal.className = 'num';
    sub.appendChild(walletVal);
    header.appendChild(h2);
    header.appendChild(sub);
    root.appendChild(header);

    // Optional guaranteed relic / D06 salvage bonus banner (detached when empty)
    const bonusBanner = document.createElement('div');
    bonusBanner.className = 'v3-reward-bonus-banner';
    bonusBanner.dataset.testid = 'reward-relic-bonus';

    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'v2-reward-cards';

    // Mount 3 persistent card slots ONCE so DOM === identity holds across all updates!
    const slots: EqCardRefs[] = [];
    for (let i = 0; i < 3; i += 1) {
      const btnEl = document.createElement('button');
      btnEl.type = 'button';
      btnEl.className = 'v2-reward-card';
      btnEl.dataset.pickReward = `equipment_${i}`;
      btnEl.dataset.testid = `reward-choice-${i}`;

      const imgEl = document.createElement('img');
      imgEl.className = 'v2-reward-img';

      const repairIconEl = document.createElement('div');
      repairIconEl.className = 'v2-reward-repair-icon';
      repairIconEl.innerHTML = svgIcon('wrench', 24);
      repairIconEl.style.display = 'none';

      const infoEl = document.createElement('div');
      infoEl.className = 'v2-reward-info';

      const titleEl = document.createElement('div');
      titleEl.className = 'v2-reward-title';

      const synergyEl = document.createElement('div');
      synergyEl.className = 'v3-reward-synergy-badge is-unmatched';
      synergyEl.dataset.testid = `reward-synergy-badge-${i}`;

      const subEl = document.createElement('div');
      subEl.className = 'v2-reward-sub';

      const valEl = document.createElement('div');
      valEl.className = 'v2-reward-val';

      infoEl.appendChild(titleEl);
      infoEl.appendChild(synergyEl);
      infoEl.appendChild(subEl);
      infoEl.appendChild(valEl);

      btnEl.appendChild(imgEl);
      btnEl.appendChild(repairIconEl);
      btnEl.appendChild(infoEl);
      cardsWrap.appendChild(btnEl);

      slots.push({
        btnEl,
        imgEl,
        repairIconEl,
        titleEl,
        synergyEl,
        subEl,
        valEl,
        lastDeltaKey: null,
        cachedDelta: null,
        lastCardKey: null,
      });
    }

    // Compact zero-heal skip button (D07: replaces flat free HP repair)
    const skipWrap = document.createElement('div');
    skipWrap.className = 'v3-reward-skip-wrap';
    const skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.className = 'btn btn-sm btn-ghost v3-reward-skip-btn';
    skipBtn.dataset.pickReward = 'skip';
    skipBtn.dataset.testid = 'btn-reward-skip';
    skipBtn.textContent = '暂不领取装备 · 直接返回航路（不回血）';
    skipWrap.appendChild(skipBtn);

    root.appendChild(cardsWrap);
    root.appendChild(skipWrap);
    host.appendChild(root);

    root.addEventListener('click', this.handleRootClick);

    this.rootEl = root;
    this.walletValEl = walletVal;
    this.bonusBannerEl = bonusBanner;
    this.cardsWrapEl = cardsWrap;
    this.slots = slots;
    this.skipWrapEl = skipWrap;
    this.skipBtnEl = skipBtn;
  }

  update(props: RewardViewProps, actions: RewardViewActions): void {
    this.latestActions = actions;
    if (!this.rootEl || !this.cardsWrapEl || this.slots.length < 3) return;

    const { run, readOnly, stargateRelayTier = 0 } = props;
    const bundle = run.pendingReward;
    if (!bundle) return;

    const walletText = `${run.wallet}¤`;
    if (this.walletValEl && this.walletValEl.textContent !== walletText) {
      this.walletValEl.textContent = walletText;
    }

    const isModern3Eq = Boolean(bundle.equipmentOptions && bundle.equipmentOptions.length > 0);
    const baySig = run.bay.placed
      .map((p) => `${p.item.instanceId}@${p.x},${p.y}:${p.rotation}`)
      .join('|');

    if (isModern3Eq) {
      const options = bundle.equipmentOptions!;

      // Optional guaranteed relic / D06 bonus salvage banner
      const bonusItems = bundle.bonusLootItems ?? [];
      if (this.bonusBannerEl) {
        if (bonusItems.length > 0) {
          const hasRelic = bonusItems.some((b) => V2_CARGO_DEFS[b.definitionId]?.isCollectible);
          const names = bonusItems
            .map((b) => getAnyV2ItemDef(b.definitionId)?.name ?? b.definitionId)
            .join('、');
          const bKey = `${hasRelic ? 1 : 0}:${names}`;
          if (this.lastBonusKey !== bKey) {
            this.lastBonusKey = bKey;
            this.bonusBannerEl.className = `v3-reward-bonus-banner${
              hasRelic ? ' is-relic' : ' is-salvage'
            }`;
            this.bonusBannerEl.innerHTML = hasRelic
              ? `${svgIcon('museum', 13)} <strong>必得遗物随船入舱：${names}</strong>（选择任一装备或跳过均可同步带走）`
              : `${svgIcon('crate', 13)} <strong>附加战利品货箱：${names}</strong>（选择任一装备将同步入暂存区，注意船舱空间取舍）`;
          }
          if (this.bonusBannerEl.parentElement !== this.rootEl) {
            this.rootEl.insertBefore(this.bonusBannerEl, this.cardsWrapEl);
          }
        } else {
          this.lastBonusKey = null;
          if (this.bonusBannerEl.parentElement) this.bonusBannerEl.remove();
        }
      }

      // Render 3 persistent equipment cards with live bay synergy badges & memoized tactical delta
      for (let i = 0; i < 3; i += 1) {
        const slot = this.slots[i];
        const item = options[i];
        if (!item) {
          slot.btnEl.style.display = 'none';
          syncButtonDisabled(slot.btnEl, true);
          continue;
        }
        slot.btnEl.style.display = '';
        slot.btnEl.dataset.pickReward = `equipment_${i}`;
        slot.btnEl.dataset.testid = `reward-choice-${i}`;
        slot.imgEl.style.display = '';
        slot.repairIconEl.style.display = 'none';
        slot.synergyEl.style.display = '';
        syncButtonDisabled(slot.btnEl, readOnly);

        const eqDef = V2_EQUIPMENT_DEFS[item.definitionId];
        const synEval = evaluateV2RewardSynergies(run.bay, item.definitionId);
        const primaryMatch = synEval.matches[0];
        const isCapped = Boolean(primaryMatch?.batteryCappedWarning);

        const deltaKey = `${run.runId}:${run.currentNodeId ?? ''}:${item.instanceId}:${run.hp}:${
          run.maxHp
        }:${run.targetPolicy}:${stargateRelayTier}:${baySig}`;
        if (slot.lastDeltaKey !== deltaKey || !slot.cachedDelta) {
          slot.lastDeltaKey = deltaKey;
          slot.cachedDelta = computeV2PlacementTacticalDelta({
            run,
            bay: run.bay,
            startingHp: run.hp,
            maxHp: run.maxHp,
            targetPolicy: run.targetPolicy,
            item,
            zone: 'staging',
            stargateRelayTier,
          });
        }
        const eqDelta = slot.cachedDelta;
        const deltaText = eqDelta.qualitativeDeltaLine ?? eqDelta.combatDeltaLine;

        const badgeCls = synEval.hasSynergy
          ? isCapped
            ? 'v3-reward-synergy-badge is-capped'
            : 'v3-reward-synergy-badge is-matched'
          : 'v3-reward-synergy-badge is-unmatched';
        const badgeSymbol = synEval.hasSynergy ? (isCapped ? '▲' : '◆') : '○';
        const badgeText = synEval.hasSynergy
          ? `${badgeSymbol} ${synEval.primaryBadgeText}`
          : `${badgeSymbol} ${synEval.summaryText}`;

        const cardKey = `eq3:${item.instanceId}:${item.definitionId}:${item.quality}:${badgeCls}:${badgeText}:${deltaText}`;
        if (slot.lastCardKey !== cardKey) {
          slot.lastCardKey = cardKey;
          slot.btnEl.className = `v2-reward-card${
            synEval.hasSynergy && !isCapped ? ' has-synergy' : ''
          }`;
          slot.imgEl.src = getItemImageUrl(item.definitionId);
          slot.imgEl.alt = eqDef?.name ?? '';
          slot.titleEl.innerHTML = `${eqDef?.name ?? item.definitionId} <span class="v2-quality-chip ${
            item.quality
          }">${item.quality === 'improved' ? '优良' : '普通'}</span>`;
          slot.synergyEl.className = badgeCls;
          slot.synergyEl.dataset.synergyState = synEval.hasSynergy
            ? isCapped
              ? 'capped'
              : 'matched'
            : 'unmatched';
          slot.synergyEl.innerHTML = `${
            synEval.hasSynergy ? svgIcon('bolt', 11) : ''
          }<span>${badgeText}</span>`;
          slot.subEl.innerHTML = eqDef
            ? `${renderV2MiniMaskHtml(eqDef.shapeId)} ${V2_SHAPES[eqDef.shapeId].label} · 预算 ${
                eqDef.budgetCost
              } · 回收 ${item.fixedValue}¤`
            : '';
          slot.valEl.textContent = deltaText;
        }
      }

      if (this.skipWrapEl && this.skipBtnEl) {
        if (this.skipWrapEl.parentElement !== this.rootEl) {
          this.rootEl.appendChild(this.skipWrapEl);
        }
        syncButtonDisabled(this.skipBtnEl, readOnly);
      }
      return;
    }

    // Legacy '3.0.0' bundle fallback (1 equipment / 1 cargo / 1 repair)
    if (this.bonusBannerEl?.parentElement) {
      this.bonusBannerEl.remove();
      this.lastBonusKey = null;
    }
    if (this.skipWrapEl?.parentElement) {
      this.skipWrapEl.remove();
    }

    // Slot 0: legacy equipment
    const slot0 = this.slots[0];
    const eqDef = V2_EQUIPMENT_DEFS[bundle.equipmentOption.definitionId];
    const d0Key = `leg0:${run.runId}:${run.currentNodeId ?? ''}:${bundle.equipmentOption.instanceId}:${
      run.hp
    }:${run.maxHp}:${run.targetPolicy}:${stargateRelayTier}:${baySig}`;
    if (slot0.lastDeltaKey !== d0Key || !slot0.cachedDelta) {
      slot0.lastDeltaKey = d0Key;
      slot0.cachedDelta = computeV2PlacementTacticalDelta({
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
    const eqDelta = slot0.cachedDelta;
    slot0.btnEl.style.display = '';
    slot0.btnEl.dataset.pickReward = 'equipment';
    slot0.btnEl.dataset.testid = 'reward-choice-0';
    slot0.imgEl.style.display = '';
    slot0.repairIconEl.style.display = 'none';
    slot0.synergyEl.style.display = 'none';
    syncButtonDisabled(slot0.btnEl, readOnly);
    const legEqKey = `leg_eq:${bundle.equipmentOption.instanceId}:${bundle.equipmentOption.quality}:${
      eqDelta.synergyLine
    }:${eqDelta.qualitativeDeltaLine ?? eqDelta.combatDeltaLine}`;
    if (slot0.lastCardKey !== legEqKey) {
      slot0.lastCardKey = legEqKey;
      slot0.imgEl.src = getItemImageUrl(bundle.equipmentOption.definitionId);
      slot0.imgEl.alt = eqDef?.name ?? '';
      slot0.titleEl.innerHTML = `设备：${eqDef?.name ?? bundle.equipmentOption.definitionId} <span class="v2-quality-chip ${
        bundle.equipmentOption.quality
      }">${bundle.equipmentOption.quality === 'improved' ? '优良' : '普通'}</span>`;
      slot0.subEl.innerHTML = eqDef
        ? `${renderV2MiniMaskHtml(eqDef.shapeId)} ${V2_SHAPES[eqDef.shapeId].label} · ${eqDelta.synergyLine}`
        : '';
      slot0.valEl.textContent = eqDelta.qualitativeDeltaLine ?? eqDelta.combatDeltaLine;
    }

    // Slot 1: legacy cargo
    const slot1 = this.slots[1];
    const cargoDef = getAnyV2ItemDef(bundle.cargoOption.definitionId);
    slot1.btnEl.style.display = '';
    slot1.btnEl.dataset.pickReward = 'cargo';
    slot1.btnEl.dataset.testid = 'reward-choice-1';
    slot1.imgEl.style.display = '';
    slot1.repairIconEl.style.display = 'none';
    slot1.synergyEl.style.display = 'none';
    syncButtonDisabled(slot1.btnEl, readOnly);
    const legCgKey = `leg_cg:${bundle.cargoOption.instanceId}:${bundle.cargoOption.definitionId}:${bundle.cargoOption.fixedValue}`;
    if (slot1.lastCardKey !== legCgKey) {
      slot1.lastCardKey = legCgKey;
      slot1.imgEl.src = getItemImageUrl(bundle.cargoOption.definitionId);
      slot1.imgEl.alt = cargoDef?.name ?? '';
      slot1.titleEl.textContent = `货物：${cargoDef?.name ?? bundle.cargoOption.definitionId}`;
      slot1.subEl.innerHTML = cargoDef
        ? `${renderV2MiniMaskHtml(cargoDef.shapeId)} ${V2_SHAPES[cargoDef.shapeId].label} · ${cargoDef.summary}`
        : '';
      slot1.valEl.innerHTML = `返航售价 <strong>+${bundle.cargoOption.fixedValue}¤</strong>`;
    }

    // Slot 2: legacy repair
    const slot2 = this.slots[2];
    slot2.btnEl.style.display = '';
    slot2.btnEl.dataset.pickReward = 'repair';
    slot2.btnEl.dataset.testid = 'reward-choice-2';
    slot2.imgEl.style.display = 'none';
    slot2.repairIconEl.style.display = '';
    slot2.synergyEl.style.display = 'none';
    syncButtonDisabled(slot2.btnEl, readOnly);
    const legRepKey = `leg_rep:${bundle.repairAmount}:${run.hp}:${run.maxHp}`;
    if (slot2.lastCardKey !== legRepKey) {
      slot2.lastCardKey = legRepKey;
      slot2.titleEl.textContent = `战地抢修：恢复 +${bundle.repairAmount} 耐久`;
      slot2.subEl.textContent = `当前耐久 ${run.hp}/${run.maxHp} · 不占船舱格位`;
      slot2.valEl.textContent = '保住血线继续向深层推进';
    }
  }

  unmount(): void {
    this.rootEl?.removeEventListener('click', this.handleRootClick);
    this.rootEl?.remove();
    this.hostEl = null;
    this.rootEl = null;
    this.walletValEl = null;
    this.bonusBannerEl = null;
    this.cardsWrapEl = null;
    this.slots = [];
    this.skipWrapEl = null;
    this.skipBtnEl = null;
    this.latestActions = null;
    this.lastBonusKey = null;
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
