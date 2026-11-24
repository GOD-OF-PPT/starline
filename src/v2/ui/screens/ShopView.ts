import { getItemImageUrl } from '../../../assets/itemArt';
import {
  getMerchantBuybackPrice,
  getV2EquipmentDefByKind,
  type V2EquipmentKind,
} from '../../data/equipment';
import { V2_SHAPES } from '../../data/shapes';
import {
  getEffectiveMerchantEquipmentPrice,
  getEffectiveMerchantServicePrice,
  getFactionRank,
  getMerchantDiscountRate,
} from '../../domain/factions';
import { getAnyV2ItemDef } from '../../domain/itemCatalog';
import type { V2MapNode, V2RunState } from '../../domain/types';
import { renderV2MiniMaskHtml } from '../CargoGridV2';
import { crewPortraitSvg, svgIcon } from '../icons';
import { findEngineerSwapTargetInBay, type PhaseView } from './screenTypes';

export interface ShopViewProps {
  readonly run: V2RunState;
  readonly node: V2MapNode;
  readonly readOnly: boolean;
  readonly starportGuildRep?: number;
}

export interface ShopViewActions {
  readonly onBuyOffer: (offerId: string) => void;
  readonly onBuyFuel: () => void;
  readonly onBuyRepair: () => void;
  readonly onSellLoot: (instanceId: string) => void;
  readonly onEngineerSwap: (kind: V2EquipmentKind) => void;
  readonly onFinish: () => void;
}

interface OfferCardRefs {
  readonly cardEl: HTMLDivElement;
  readonly imgEl: HTMLImageElement;
  readonly nameEl: HTMLDivElement;
  readonly subEl: HTMLDivElement;
  readonly buyBtnEl: HTMLButtonElement;
  infoKey: string;
}

interface SellRowRefs {
  readonly rowEl: HTMLDivElement;
  readonly labelSpanEl: HTMLSpanElement;
  readonly sellBtnEl: HTMLButtonElement;
  infoKey: string;
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

export class ShopPhaseView implements PhaseView<ShopViewProps, ShopViewActions> {
  private hostEl: HTMLElement | null = null;
  private rootEl: HTMLDivElement | null = null;
  private walletValEl: HTMLElement | null = null;

  private guildBannerEl: HTMLDivElement | null = null;
  private guildBannerTextEl: HTMLSpanElement | null = null;
  private lastGuildKey: string | null = null;

  private offersSectionEl: HTMLDivElement | null = null;
  private offersListEl: HTMLDivElement | null = null;
  private readonly offerCards = new Map<string, OfferCardRefs>();

  // Engineer swap banner (reconciled in-place, preserving button identity)
  private engineerSlotEl: HTMLDivElement | null = null;
  private engineerBannerEl: HTMLDivElement | null = null;
  private engineerTitleEl: HTMLDivElement | null = null;
  private engineerBtnsWrapEl: HTMLDivElement | null = null;
  private readonly engineerBtns = new Map<V2EquipmentKind, HTMLButtonElement>();
  private lastEngineerTitleKey: string | null = null;

  // Supplies
  private fuelBtnEl: HTMLButtonElement | null = null;
  private fuelLabelEl: HTMLSpanElement | null = null;
  private repairBtnEl: HTMLButtonElement | null = null;
  private repairLabelEl: HTMLSpanElement | null = null;

  // Sellable loot
  private sellSectionEl: HTMLDivElement | null = null;
  private sellEmptyEl: HTMLDivElement | null = null;
  private sellListEl: HTMLDivElement | null = null;
  private readonly sellRows = new Map<string, SellRowRefs>();

  private finishBtnEl: HTMLButtonElement | null = null;

  private latestActions: ShopViewActions | null = null;

  private readonly handleRootClick = (ev: Event): void => {
    if (!this.rootEl || !this.latestActions) return;
    const target = ev.target as HTMLElement | null;
    if (!target || typeof target.closest !== 'function') return;
    const btn = target.closest('button') as HTMLButtonElement | null;
    if (!btn || !this.rootEl.contains(btn) || btn.disabled) return;

    if (btn === this.fuelBtnEl || btn.id === 'v2-shop-fuel') {
      this.latestActions.onBuyFuel();
      return;
    }
    if (btn === this.repairBtnEl || btn.id === 'v2-shop-repair') {
      this.latestActions.onBuyRepair();
      return;
    }
    if (btn === this.finishBtnEl || btn.id === 'v2-shop-finish') {
      this.latestActions.onFinish();
      return;
    }
    const offerId = btn.dataset.buyOffer;
    if (offerId) {
      this.latestActions.onBuyOffer(offerId);
      return;
    }
    const engKind = btn.dataset.engSwap as V2EquipmentKind | undefined;
    if (engKind) {
      this.latestActions.onEngineerSwap(engKind);
      return;
    }
    const sellId = btn.dataset.sellLoot;
    if (sellId) {
      this.latestActions.onSellLoot(sellId);
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
    root.dataset.testid = 'shop-screen';

    // Header
    const header = document.createElement('div');
    header.className = 'panel-header';
    const h2 = document.createElement('h2');
    h2.innerHTML = `${svgIcon('merchant', 16)} 流动商人补给站`;
    const sub = document.createElement('span');
    sub.className = 'panel-sub';
    sub.textContent = '航行钱包 ';
    const walletVal = document.createElement('strong');
    walletVal.className = 'num';
    sub.appendChild(walletVal);
    header.appendChild(h2);
    header.appendChild(sub);
    root.appendChild(header);

    // Optional guild discount banner (detached until discountPct > 0)
    const guildBanner = document.createElement('div');
    guildBanner.className = 'v3-shop-faction-banner';
    guildBanner.dataset.testid = 'shop-faction-discount';
    guildBanner.innerHTML = svgIcon('faction', 14);
    const guildBannerText = document.createElement('span');
    guildBanner.appendChild(guildBannerText);

    // Offers section
    const offersSection = document.createElement('div');
    offersSection.className = 'v2-shop-section';
    const offersLabel = document.createElement('div');
    offersLabel.className = 'v2-prep-label';
    offersLabel.textContent = '限购设备与消耗装置';
    const offersList = document.createElement('div');
    offersList.className = 'v2-shop-offers';
    offersSection.appendChild(offersLabel);
    offersSection.appendChild(offersList);
    root.appendChild(offersSection);

    // Engineer swap slot (display: none when inactive -> zero flex gap)
    const engineerSlot = document.createElement('div');
    engineerSlot.dataset.slot = 'engineer-swap';
    engineerSlot.style.display = 'none';
    const engineerBanner = document.createElement('div');
    engineerBanner.className = 'v2-engineer-banner';
    engineerBanner.dataset.testid = 'engineer-swap-banner';
    const engineerTitle = document.createElement('div');
    engineerTitle.className = 'v2-eng-title';
    const engineerBtnsWrap = document.createElement('div');
    engineerBtnsWrap.className = 'v2-eng-btns';
    engineerBanner.appendChild(engineerTitle);
    engineerBanner.appendChild(engineerBtnsWrap);
    root.appendChild(engineerSlot);

    // Supplies section
    const suppliesSection = document.createElement('div');
    suppliesSection.className = 'v2-shop-section';
    const suppliesLabel = document.createElement('div');
    suppliesLabel.className = 'v2-prep-label';
    suppliesLabel.textContent = '航行补给（每项限购 1 次）';
    const suppliesWrap = document.createElement('div');
    suppliesWrap.className = 'v2-shop-supplies';

    const fuelBtn = document.createElement('button');
    fuelBtn.type = 'button';
    fuelBtn.className = 'btn btn-sm btn-secondary';
    fuelBtn.id = 'v2-shop-fuel';
    fuelBtn.innerHTML = `${svgIcon('fuel', 13)} `;
    const fuelLabel = document.createElement('span');
    fuelBtn.appendChild(fuelLabel);

    const repairBtn = document.createElement('button');
    repairBtn.type = 'button';
    repairBtn.className = 'btn btn-sm btn-secondary';
    repairBtn.id = 'v2-shop-repair';
    repairBtn.innerHTML = `${svgIcon('wrench', 13)} `;
    const repairLabel = document.createElement('span');
    repairBtn.appendChild(repairLabel);

    suppliesWrap.appendChild(fuelBtn);
    suppliesWrap.appendChild(repairBtn);
    suppliesSection.appendChild(suppliesLabel);
    suppliesSection.appendChild(suppliesWrap);
    root.appendChild(suppliesSection);

    // Sellable loot section
    const sellSection = document.createElement('div');
    sellSection.className = 'v2-shop-section';
    const sellLabel = document.createElement('div');
    sellLabel.className = 'v2-prep-label';
    sellLabel.textContent = '向商人变卖拾获物（80% 折价收购）';
    sellSection.appendChild(sellLabel);

    const sellEmpty = document.createElement('div');
    sellEmpty.className = 'v2-empty-inline';
    sellEmpty.textContent = '当前舱内无拾获物可向商人出售。';

    const sellList = document.createElement('div');
    sellList.className = 'v2-shop-sell-list';
    root.appendChild(sellSection);

    // Finish CTA
    const finishBtn = document.createElement('button');
    finishBtn.type = 'button';
    finishBtn.className = 'btn btn-primary btn-launch-hero';
    finishBtn.id = 'v2-shop-finish';
    finishBtn.textContent = '完成交易 · 整理船舱';
    root.appendChild(finishBtn);

    host.appendChild(root);
    root.addEventListener('click', this.handleRootClick);

    this.rootEl = root;
    this.walletValEl = walletVal;
    this.guildBannerEl = guildBanner;
    this.guildBannerTextEl = guildBannerText;
    this.offersSectionEl = offersSection;
    this.offersListEl = offersList;
    this.engineerSlotEl = engineerSlot;
    this.engineerBannerEl = engineerBanner;
    this.engineerTitleEl = engineerTitle;
    this.engineerBtnsWrapEl = engineerBtnsWrap;
    this.fuelBtnEl = fuelBtn;
    this.fuelLabelEl = fuelLabel;
    this.repairBtnEl = repairBtn;
    this.repairLabelEl = repairLabel;
    this.sellSectionEl = sellSection;
    this.sellEmptyEl = sellEmpty;
    this.sellListEl = sellList;
    this.finishBtnEl = finishBtn;
  }

  update(props: ShopViewProps, actions: ShopViewActions): void {
    this.latestActions = actions;
    if (!this.rootEl) return;

    const { run, node, readOnly, starportGuildRep = 0 } = props;
    const shop = node.merchant;
    if (!shop) return;

    const walletText = `${run.wallet}¤`;
    if (this.walletValEl && this.walletValEl.textContent !== walletText) {
      this.walletValEl.textContent = walletText;
    }

    const guildRank = getFactionRank(starportGuildRep);
    const discountRate = getMerchantDiscountRate(starportGuildRep);
    const discountPct = Math.round(discountRate * 100);
    const effFuelPrice = getEffectiveMerchantServicePrice(shop.fuelPrice, starportGuildRep);
    const effRepairPrice = getEffectiveMerchantServicePrice(shop.repairPrice, starportGuildRep);

    // Guild discount banner
    if (this.guildBannerEl && this.guildBannerTextEl && this.offersSectionEl) {
      if (discountPct > 0) {
        const key = `${guildRank}:${discountPct}`;
        if (this.lastGuildKey !== key) {
          this.lastGuildKey = key;
          this.guildBannerTextEl.innerHTML = `<strong>星港行会 Lv${guildRank} 声望特权</strong>：流动商人设备与补给享 <strong>${discountPct}% 折扣</strong>（反套利底价生效）`;
        }
        if (this.guildBannerEl.parentElement !== this.rootEl) {
          this.rootEl.insertBefore(this.guildBannerEl, this.offersSectionEl);
        }
      } else {
        this.lastGuildKey = null;
        if (this.guildBannerEl.parentElement) {
          this.guildBannerEl.remove();
        }
      }
    }

    // Reconcile keyed offers
    if (this.offersListEl) {
      const nextOfferIds = new Set<string>(shop.offers.map((o) => o.offerId));
      for (const [oid, refs] of this.offerCards.entries()) {
        if (!nextOfferIds.has(oid)) {
          refs.cardEl.remove();
          this.offerCards.delete(oid);
        }
      }

      shop.offers.forEach((off, idx) => {
        const def = getAnyV2ItemDef(off.item.definitionId);
        const effPrice = getEffectiveMerchantEquipmentPrice(
          off.buyPrice,
          off.item.fixedValue,
          starportGuildRep
        );
        const discounted = effPrice < off.buyPrice;
        const canBuy = !off.sold && run.wallet >= effPrice;
        const isGadget = off.item.category === 'gadget';

        let refs = this.offerCards.get(off.offerId);
        if (!refs) {
          const cardEl = document.createElement('div');
          cardEl.className = 'v2-shop-card';

          const imgEl = document.createElement('img');
          imgEl.className = 'v2-wh-icon';
          cardEl.appendChild(imgEl);

          const infoEl = document.createElement('div');
          infoEl.className = 'v2-wh-info';
          const nameEl = document.createElement('div');
          nameEl.className = 'v2-wh-name';
          const subEl = document.createElement('div');
          subEl.className = 'v2-wh-sub';
          infoEl.appendChild(nameEl);
          infoEl.appendChild(subEl);
          cardEl.appendChild(infoEl);

          const buyBtnEl = document.createElement('button');
          buyBtnEl.type = 'button';
          buyBtnEl.className = 'btn btn-sm btn-primary';
          buyBtnEl.dataset.buyOffer = off.offerId;
          cardEl.appendChild(buyBtnEl);

          refs = { cardEl, imgEl, nameEl, subEl, buyBtnEl, infoKey: '' };
          this.offerCards.set(off.offerId, refs);
        }

        refs.cardEl.classList.toggle('sold', off.sold);
        const infoKey = `${off.item.definitionId}:${off.item.quality}:${off.buyPrice}:${effPrice}:${isGadget ? 1 : 0}`;
        if (refs.infoKey !== infoKey) {
          refs.infoKey = infoKey;
          refs.imgEl.src = getItemImageUrl(off.item.definitionId);
          refs.imgEl.alt = def?.name ?? '';
          const tagHtml = isGadget
            ? `<span class="v2-quality-chip common">消耗装置</span>`
            : `<span class="v2-quality-chip ${off.item.quality}">${
                off.item.quality === 'improved' ? '优良' : '普通'
              }</span>`;
          refs.nameEl.innerHTML = `${def?.name ?? off.item.definitionId} ${tagHtml}`;
          refs.subEl.innerHTML = `${
            def ? `${renderV2MiniMaskHtml(def.shapeId)} ${def.summary}` : ''
          }${discounted ? ` · 原价 <s>${off.buyPrice}¤</s>` : ''}`;
        }

        const btnText = off.sold ? '已购' : `购买 ${effPrice}¤`;
        if (refs.buyBtnEl.textContent !== btnText) {
          refs.buyBtnEl.textContent = btnText;
        }
        syncButtonDisabled(refs.buyBtnEl, readOnly || !canBuy);

        const curAtIdx = this.offersListEl!.children[idx];
        if (curAtIdx !== refs.cardEl) {
          this.offersListEl!.insertBefore(refs.cardEl, curAtIdx ?? null);
        }
      });
    }

    // Reconcile Engineer Swap banner in-place
    this.reconcileEngineerSwap(run, readOnly);

    // Supplies
    if (this.fuelBtnEl && this.fuelLabelEl) {
      const fuelText = `燃料 +${shop.fuelAmount}（${shop.fuelBought ? '已购' : `${effFuelPrice}¤`}）`;
      if (this.fuelLabelEl.textContent !== fuelText) {
        this.fuelLabelEl.textContent = fuelText;
      }
      syncButtonDisabled(
        this.fuelBtnEl,
        readOnly || shop.fuelBought || run.wallet < effFuelPrice || run.fuel >= run.maxFuel
      );
    }

    if (this.repairBtnEl && this.repairLabelEl) {
      const repText = `维修 +${shop.repairAmount} HP（${
        shop.repairBought ? '已购' : `${effRepairPrice}¤`
      }）`;
      if (this.repairLabelEl.textContent !== repText) {
        this.repairLabelEl.textContent = repText;
      }
      syncButtonDisabled(
        this.repairBtnEl,
        readOnly || shop.repairBought || run.wallet < effRepairPrice || run.hp >= run.maxHp
      );
    }

    // Reconcile keyed sellable loot rows (preserves DOM identity across CargoGrid drags!)
    const sellableLoot = [
      ...run.bay.placed.map((p) => p.item),
      ...run.bay.staging.map((s) => s.item),
    ].filter((it) => it.origin === 'loot');

    if (this.sellSectionEl && this.sellEmptyEl && this.sellListEl) {
      if (sellableLoot.length === 0) {
        if (this.sellListEl.parentElement) this.sellListEl.remove();
        for (const refs of this.sellRows.values()) {
          refs.rowEl.remove();
        }
        this.sellRows.clear();
        if (this.sellEmptyEl.parentElement !== this.sellSectionEl) {
          this.sellSectionEl.appendChild(this.sellEmptyEl);
        }
      } else {
        if (this.sellEmptyEl.parentElement) this.sellEmptyEl.remove();
        if (this.sellListEl.parentElement !== this.sellSectionEl) {
          this.sellSectionEl.appendChild(this.sellListEl);
        }

        const nextSellIds = new Set<string>(sellableLoot.map((it) => it.instanceId));
        for (const [iid, refs] of this.sellRows.entries()) {
          if (!nextSellIds.has(iid)) {
            refs.rowEl.remove();
            this.sellRows.delete(iid);
          }
        }

        sellableLoot.forEach((it, idx) => {
          const def = getAnyV2ItemDef(it.definitionId);
          const buyback = getMerchantBuybackPrice(it.fixedValue);
          let refs = this.sellRows.get(it.instanceId);
          if (!refs) {
            const rowEl = document.createElement('div');
            rowEl.className = 'v2-shop-sell-row';
            const labelSpanEl = document.createElement('span');
            const sellBtnEl = document.createElement('button');
            sellBtnEl.type = 'button';
            sellBtnEl.className = 'btn btn-sm btn-ghost';
            sellBtnEl.dataset.sellLoot = it.instanceId;
            rowEl.appendChild(labelSpanEl);
            rowEl.appendChild(sellBtnEl);
            refs = { rowEl, labelSpanEl, sellBtnEl, infoKey: '' };
            this.sellRows.set(it.instanceId, refs);
          }

          const infoKey = `${it.definitionId}:${it.fixedValue}:${buyback}`;
          if (refs.infoKey !== infoKey) {
            refs.infoKey = infoKey;
            refs.labelSpanEl.innerHTML = `<span class="v2-origin-badge origin-loot">拾</span> ${
              def?.name ?? it.definitionId
            } <small>(原值 ${it.fixedValue}¤)</small>`;
            refs.sellBtnEl.textContent = `卖出 +${buyback}¤`;
          }
          syncButtonDisabled(refs.sellBtnEl, readOnly);

          const curAtIdx = this.sellListEl!.children[idx];
          if (curAtIdx !== refs.rowEl) {
            this.sellListEl!.insertBefore(refs.rowEl, curAtIdx ?? null);
          }
        });
      }
    }

    if (this.finishBtnEl) {
      syncButtonDisabled(this.finishBtnEl, readOnly);
    }
  }

  private reconcileEngineerSwap(run: V2RunState, readOnly: boolean): void {
    if (!this.engineerSlotEl || !this.engineerBannerEl || !this.engineerTitleEl || !this.engineerBtnsWrapEl) {
      return;
    }
    const offer = run.activeEngineerOffer;
    const target =
      offer && !offer.used ? findEngineerSwapTargetInBay(run.bay, offer.targetInstanceId) : null;

    if (!offer || offer.used || !target) {
      if (this.engineerBannerEl.parentElement) {
        this.engineerBannerEl.remove();
      }
      this.engineerSlotEl.style.display = 'none';
      return;
    }

    this.engineerSlotEl.style.display = 'contents';
    if (this.engineerBannerEl.parentElement !== this.engineerSlotEl) {
      this.engineerSlotEl.appendChild(this.engineerBannerEl);
    }

    const preservesImproved =
      run.crewId === 'engineer' &&
      (run.crewMasteryTier ?? 0) >= 2 &&
      target.quality === 'improved';
    const qualityForButtons = preservesImproved ? 'improved' : 'common';

    const titleKey = `${target.name}|${preservesImproved ? 1 : 0}`;
    if (this.lastEngineerTitleKey !== titleKey) {
      this.lastEngineerTitleKey = titleKey;
      this.engineerTitleEl.innerHTML = `${crewPortraitSvg('engineer', 20)} ${svgIcon(
        'swap',
        14
      )} 林工 · 工程师现场改装（每趟 1 次 · 可将「${target.name}」改为${
        preservesImproved ? '优良件' : ''
      }）`;
    }

    const nextKinds = new Set<V2EquipmentKind>(offer.candidates);
    for (const [kind, btn] of this.engineerBtns.entries()) {
      if (!nextKinds.has(kind)) {
        btn.remove();
        this.engineerBtns.delete(kind);
      }
    }

    offer.candidates.forEach((kind, idx) => {
      const def = getV2EquipmentDefByKind(kind, qualityForButtons);
      let btn = this.engineerBtns.get(kind);
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-sm btn-secondary';
        btn.dataset.engSwap = kind;
        this.engineerBtns.set(kind, btn);
      }
      const label = `改为 ${def.name}${preservesImproved ? '（良）' : ''} (${V2_SHAPES[def.shapeId].label})`;
      if (btn.textContent !== label) {
        btn.textContent = label;
      }
      syncButtonDisabled(btn, readOnly);

      const curAtIdx = this.engineerBtnsWrapEl!.children[idx];
      if (curAtIdx !== btn) {
        this.engineerBtnsWrapEl!.insertBefore(btn, curAtIdx ?? null);
      }
    });
  }

  unmount(): void {
    this.rootEl?.removeEventListener('click', this.handleRootClick);
    this.rootEl?.remove();
    this.offerCards.clear();
    this.engineerBtns.clear();
    this.sellRows.clear();
    this.hostEl = null;
    this.rootEl = null;
    this.walletValEl = null;
    this.guildBannerEl = null;
    this.guildBannerTextEl = null;
    this.lastGuildKey = null;
    this.offersSectionEl = null;
    this.offersListEl = null;
    this.engineerSlotEl = null;
    this.engineerBannerEl = null;
    this.engineerTitleEl = null;
    this.engineerBtnsWrapEl = null;
    this.lastEngineerTitleKey = null;
    this.fuelBtnEl = null;
    this.fuelLabelEl = null;
    this.repairBtnEl = null;
    this.repairLabelEl = null;
    this.sellSectionEl = null;
    this.sellEmptyEl = null;
    this.sellListEl = null;
    this.finishBtnEl = null;
    this.latestActions = null;
  }
}

const legacyShopViews = new WeakMap<HTMLElement, ShopPhaseView>();

export function renderShopView(
  leftPanelEl: HTMLElement,
  props: ShopViewProps,
  actions: ShopViewActions
): void {
  let view = legacyShopViews.get(leftPanelEl);
  if (!view) {
    view = new ShopPhaseView();
    legacyShopViews.set(leftPanelEl, view);
  }
  if (!view.isMountedIn(leftPanelEl)) {
    view.mount(leftPanelEl);
  }
  view.update(props, actions);
}
