import { getItemImageUrl } from '../../../assets/itemArt';
import {
  V2_EQUIPMENT_DEFS,
  getMerchantBuybackPrice,
  type V2EquipmentKind,
} from '../../data/equipment';
import { getAnyV2ItemDef } from '../../domain/itemCatalog';
import type { V2MapNode, V2RunState } from '../../domain/types';
import { renderV2MiniMaskHtml } from '../CargoGridV2';
import { svgIcon } from '../icons';
import { bindEngineerSwapHandlers, renderEngineerSwapBannerHtml } from './screenTypes';

export interface ShopViewProps {
  readonly run: V2RunState;
  readonly node: V2MapNode;
  readonly readOnly: boolean;
}

export interface ShopViewActions {
  readonly onBuyOffer: (offerId: string) => void;
  readonly onBuyFuel: () => void;
  readonly onBuyRepair: () => void;
  readonly onSellLoot: (instanceId: string) => void;
  readonly onEngineerSwap: (kind: V2EquipmentKind) => void;
  readonly onFinish: () => void;
}

export function renderShopView(
  leftPanelEl: HTMLElement,
  props: ShopViewProps,
  actions: ShopViewActions
): void {
  const { run, node, readOnly } = props;
  const shop = node.merchant;
  if (!shop) return;

  const sellableLoot = [
    ...run.bay.placed.map((p) => p.item),
    ...run.bay.staging.map((s) => s.item),
  ].filter((it) => it.origin === 'loot');

  const engineerBannerHtml = renderEngineerSwapBannerHtml(run, readOnly);

  leftPanelEl.innerHTML = `
    <div class="v3-screen-root" data-testid="shop-screen">
      <div class="panel-header">
        <h2>${svgIcon('merchant', 16)} 流动商人补给站</h2>
        <span class="panel-sub">航行钱包 <strong class="num">${run.wallet}¤</strong></span>
      </div>

      <div class="v2-shop-section">
        <div class="v2-prep-label">限购设备</div>
        <div class="v2-shop-offers">
          ${shop.offers
            .map((off) => {
              const def = V2_EQUIPMENT_DEFS[off.item.definitionId];
              const canBuy = !off.sold && run.wallet >= off.buyPrice;
              return `<div class="v2-shop-card ${off.sold ? 'sold' : ''}">
                <img class="v2-wh-icon" src="${getItemImageUrl(off.item.definitionId)}" alt="${def?.name ?? ''}" />
                <div class="v2-wh-info">
                  <div class="v2-wh-name">${def?.name ?? off.item.definitionId} <span class="v2-quality-chip ${
                off.item.quality
              }">${off.item.quality === 'improved' ? '优良' : '普通'}</span></div>
                  <div class="v2-wh-sub">${
                    def ? `${renderV2MiniMaskHtml(def.shapeId)} ${def.summary}` : ''
                  }</div>
                </div>
                <button type="button" class="btn btn-sm btn-primary" data-buy-offer="${off.offerId}" ${
                readOnly || !canBuy ? 'disabled' : ''
              }>${off.sold ? '已购' : `购买 ${off.buyPrice}¤`}</button>
              </div>`;
            })
            .join('')}
        </div>
      </div>

      ${engineerBannerHtml}

      <div class="v2-shop-section">
        <div class="v2-prep-label">航行补给（每项限购 1 次）</div>
        <div class="v2-shop-supplies">
          <button type="button" class="btn btn-sm btn-secondary" id="v2-shop-fuel" ${
            readOnly || shop.fuelBought || run.wallet < shop.fuelPrice || run.fuel >= run.maxFuel
              ? 'disabled'
              : ''
          }>${svgIcon('fuel', 13)} 燃料 +${shop.fuelAmount}（${shop.fuelBought ? '已购' : `${shop.fuelPrice}¤`}）</button>
          <button type="button" class="btn btn-sm btn-secondary" id="v2-shop-repair" ${
            readOnly || shop.repairBought || run.wallet < shop.repairPrice || run.hp >= run.maxHp
              ? 'disabled'
              : ''
          }>${svgIcon('wrench', 13)} 维修 +${shop.repairAmount} HP（${shop.repairBought ? '已购' : `${shop.repairPrice}¤`}）</button>
        </div>
      </div>

      <div class="v2-shop-section">
        <div class="v2-prep-label">向商人变卖拾获物（80% 折价收购）</div>
        ${
          sellableLoot.length === 0
            ? `<div class="v2-empty-inline">当前舱内无拾获物可向商人出售。</div>`
            : `<div class="v2-shop-sell-list">
                ${sellableLoot
                  .map((it) => {
                    const def = getAnyV2ItemDef(it.definitionId);
                    const buyback = getMerchantBuybackPrice(it.fixedValue);
                    return `<div class="v2-shop-sell-row">
                      <span><span class="v2-origin-badge origin-loot">拾</span> ${
                        def?.name ?? it.definitionId
                      } <small>(原值 ${it.fixedValue}¤)</small></span>
                      <button type="button" class="btn btn-sm btn-ghost" data-sell-loot="${it.instanceId}" ${
                      readOnly ? 'disabled' : ''
                    }>卖出 +${buyback}¤</button>
                    </div>`;
                  })
                  .join('')}
              </div>`
        }
      </div>

      <button type="button" class="btn btn-primary btn-launch-hero" id="v2-shop-finish" ${
        readOnly ? 'disabled' : ''
      }>完成交易 · 整理船舱</button>
    </div>
  `;

  leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-buy-offer]').forEach((btn) => {
    btn.addEventListener('click', () => {
      actions.onBuyOffer(btn.dataset.buyOffer!);
    });
  });

  bindEngineerSwapHandlers(leftPanelEl, actions.onEngineerSwap);

  leftPanelEl.querySelector('#v2-shop-fuel')?.addEventListener('click', actions.onBuyFuel);
  leftPanelEl.querySelector('#v2-shop-repair')?.addEventListener('click', actions.onBuyRepair);

  leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-sell-loot]').forEach((btn) => {
    btn.addEventListener('click', () => {
      actions.onSellLoot(btn.dataset.sellLoot!);
    });
  });

  leftPanelEl.querySelector('#v2-shop-finish')?.addEventListener('click', actions.onFinish);
}
