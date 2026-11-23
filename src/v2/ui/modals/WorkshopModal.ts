import { getItemImageUrl } from '../../../assets/itemArt';
import {
  V2_ALL_EQUIPMENT_KINDS,
  V2_EQUIPMENT_DEFS,
  V2_WAREHOUSE_CAPACITY,
  getEffectiveV2EquipmentBudgetCost,
  getV2EquipmentDefByKind,
  type V2EquipmentKind,
} from '../../data/equipment';
import { V2_SHAPES } from '../../data/shapes';
import { V2_SHIPS, type V2ShipId } from '../../data/ships';
import {
  V3_HULL_TUNING_LABELS,
  canCraftV2EquipmentWithParts,
  canDismantleV2Item,
  canTuneV2ShipHull,
  canUpgradeV2Equipment,
  getDismantleSalvagePartsYield,
  getEffectiveShipLoadoutBudget,
  getEffectiveShipMaxHp,
  getUpgradeToImprovedCost,
} from '../../domain/dismantle';
import { getFactionRank, getWorkshopDiscountRate } from '../../domain/factions';
import { getAnyV2ItemDef } from '../../domain/itemCatalog';
import {
  canResearchV2Instance,
  getEffectiveV2CraftCost,
  getEffectiveV2ResearchCost,
} from '../../domain/progressionV2';
import type { V2ProfileState, V3HullTuningTrack } from '../../domain/types';
import { originTagText, renderV2MiniMaskHtml } from '../CargoGridV2';
import { svgIcon } from '../icons';
import { openTitledV2Modal } from '../V2Modals';

export interface V3WorkshopModalOptions {
  readonly readOnly: boolean;
  readonly initialTab?: 'warehouse' | 'research';
  readonly onResearch: (instanceId: string) => { readonly ok: boolean; readonly error?: string };
  readonly onCraft: (kind: V2EquipmentKind) => { readonly ok: boolean; readonly error?: string };
  readonly onCraftWithParts?: (
    kind: V2EquipmentKind
  ) => { readonly ok: boolean; readonly error?: string };
  readonly onUpgradeItem?: (
    instanceId: string
  ) => { readonly ok: boolean; readonly error?: string };
  readonly onDismantleItem?: (
    instanceId: string
  ) => { readonly ok: boolean; readonly error?: string; readonly partsGained?: number };
  readonly onTuneHull?: (
    shipId: V2ShipId,
    track: V3HullTuningTrack
  ) => { readonly ok: boolean; readonly error?: string };
  readonly onSellItem: (instanceId: string) => { readonly ok: boolean; readonly error?: string };
  readonly onClaimGift: (instanceId: string) => { readonly ok: boolean; readonly error?: string };
  readonly onSellGift: (instanceId: string) => { readonly ok: boolean; readonly error?: string };
}

const HULL_TUNING_TRACKS: readonly V3HullTuningTrack[] = ['hp', 'salvage', 'budget'];

export function openV3WorkshopModal(
  host: HTMLElement,
  getProfile: () => V2ProfileState,
  options: V3WorkshopModalOptions
): void {
  let activeTab: 'warehouse' | 'research' = options.initialTab ?? 'warehouse';
  let feedbackMsg: { readonly text: string; readonly isError: boolean } | null = null;

  openTitledV2Modal(
    host,
    {
      title: '设备工坊与精炼台',
      cardClass: 'v3-workshop-modal',
      dismissible: true,
    },
    (body) => {
      const renderBody = () => {
        const profile = getProfile();
        const hasLab = profile.buildings.research_lab;
        const researchCost = getEffectiveV2ResearchCost(profile);
        const instituteRank = getFactionRank(profile.factionRep.deep_institute);
        const workshopDiscountPct = Math.round(
          getWorkshopDiscountRate(profile.factionRep.deep_institute) * 100
        );
        const safeWarehouseItems = profile.equipmentWarehouse.filter(
          (w) => w.origin !== 'loan' && w.origin !== 'mission'
        );

        const discountBannerHtml =
          workshopDiscountPct > 0
            ? `<div class="v3-workshop-discount-bar">
                ${svgIcon('faction', 13)} 深空研究院 Lv.${instituteRank} 声望加成：蓝图研究、精炼升级、零件组装与船体调校费用享 <strong>-${workshopDiscountPct}% 优惠</strong>
              </div>`
            : '';

        const giftHtml =
          profile.pendingGiftQueue.length > 0
            ? `<div class="v2-gift-box">
                <div class="v2-section-mini-title">${svgIcon('crate', 14)} 待领取赠品队列 (${
                profile.pendingGiftQueue.length
              })</div>
                <div class="v2-wh-list">
                  ${profile.pendingGiftQueue
                    .map((g) => {
                      const def = getAnyV2ItemDef(g.definitionId);
                      return `<div class="v2-wh-row" data-instance-id="${g.instanceId}" data-origin="${g.origin}">
                        <img class="v2-wh-icon" src="${getItemImageUrl(g.definitionId)}" alt="${
                        def?.name ?? g.definitionId
                      }" />
                        <div class="v2-wh-info">
                          <div class="v2-wh-name">${def?.name ?? g.definitionId} <span class="v2-q-tag">${
                        g.quality === 'improved' ? '优良' : '普通'
                      }</span></div>
                          <div class="v2-wh-sub">回收价 ${g.fixedValue}¤ · 满库时暂存于此不会丢失</div>
                        </div>
                        <div class="v2-wh-actions">
                          <button type="button" class="btn btn-sm btn-primary" data-claim-gift="${
                            g.instanceId
                          }" ${
                        options.readOnly || profile.equipmentWarehouse.length >= V2_WAREHOUSE_CAPACITY
                          ? 'disabled'
                          : ''
                      }>收入库</button>
                          <button type="button" class="btn btn-sm btn-ghost" data-sell-gift="${
                            g.instanceId
                          }" ${options.readOnly ? 'disabled' : ''}>出售 +${g.fixedValue}¤</button>
                        </div>
                      </div>`;
                    })
                    .join('')}
                </div>
              </div>`
            : '';

        const warehouseHtml = `
          ${giftHtml}
          <div class="v2-wh-summary">
            <span>仓库容量：<strong class="num">${safeWarehouseItems.length}/${V2_WAREHOUSE_CAPACITY}</strong></span>
            <span class="v3-parts-pill">${svgIcon('parts', 13)} 精密零件：<strong class="num">${
          profile.salvageParts
        }</strong></span>
            <span>信用点：<strong class="num">${profile.credits}¤</strong></span>
            <span>研究台：<strong>${hasLab ? '已建成' : '未建成（需 100¤）'}</strong></span>
          </div>
          ${discountBannerHtml}
          ${
            safeWarehouseItems.length === 0
              ? `<div class="v2-empty-hint">设备库当前为空。安全返航时可将拾获设备选为「入库」，或前往蓝图工坊消耗信用点/精密零件组装自有设备。</div>`
              : `<div class="v2-wh-list">
                  ${safeWarehouseItems
                    .map((item) => {
                      const def = V2_EQUIPMENT_DEFS[item.definitionId];
                      const resCheck = canResearchV2Instance(profile, item.instanceId);
                      const upgCheck = canUpgradeV2Equipment(profile, item.instanceId);
                      const upgCost = def ? getUpgradeToImprovedCost(def, profile).parts : 0;
                      const dismantleOk = canDismantleV2Item(item).ok;
                      const partsYield = getDismantleSalvagePartsYield(
                        item,
                        profile,
                        profile.selectedShipId
                      );
                      const effBudget = def ? getEffectiveV2EquipmentBudgetCost(def, 'owned') : 0;
                      const discountTag = def && effBudget < def.budgetCost ? '（自有-1）' : '';

                      const upgradeNote =
                        item.quality === 'common' && !upgCheck.canUpgrade && upgCost > 0
                          ? `<div class="v3-wh-upgrade-note">精炼升级需要 ${upgCost} 精密零件（零件不足）</div>`
                          : '';

                      return `<div class="v2-wh-row" data-instance-id="${item.instanceId}" data-testid="warehouse-item-${item.instanceId}" data-origin="${item.origin}">
                        <img class="v2-wh-icon" src="${getItemImageUrl(item.definitionId)}" alt="${
                        def?.name ?? item.definitionId
                      }" />
                        <div class="v2-wh-info">
                          <div class="v2-wh-name">
                            <span class="v2-origin-badge origin-${item.origin}">${originTagText(
                        item.origin
                      )}</span>
                            ${def?.name ?? item.definitionId}
                            ${
                              item.quality === 'improved'
                                ? `<span class="v3-max-quality-chip">优良 · 已达最高品质</span>`
                                : `<span class="v2-quality-chip common">普通</span>`
                            }
                          </div>
                          <div class="v2-wh-sub">${
                            def
                              ? `${V2_SHAPES[def.shapeId].label} · 出航预算 ${effBudget}${discountTag} · 回收 ${item.fixedValue}¤`
                              : ''
                          }${
                        resCheck.canResearch && resCheck.isImproved
                          ? ' · 提示：研究优良件仅解锁普通蓝图'
                          : !resCheck.canResearch && resCheck.reason
                          ? ` · ${resCheck.reason}`
                          : ''
                      }</div>
                          ${upgradeNote}
                        </div>
                        <div class="v2-wh-actions">
                          ${
                            item.quality === 'common' && options.onUpgradeItem
                              ? `<button type="button" class="btn btn-sm btn-primary v3-btn-upgrade" data-upgrade-id="${
                                  item.instanceId
                                }" data-testid="btn-upgrade-${item.instanceId}" ${
                                  options.readOnly || !upgCheck.canUpgrade ? 'disabled' : ''
                                }>${svgIcon('upgrade', 12)} 升级优良 (-${upgCost} 零件)</button>`
                              : ''
                          }
                          ${
                            dismantleOk && options.onDismantleItem
                              ? `<button type="button" class="btn btn-sm btn-secondary" data-dismantle-wh="${
                                  item.instanceId
                                }" data-testid="btn-dismantle-wh-${item.instanceId}" ${
                                  options.readOnly ? 'disabled' : ''
                                }>${svgIcon('cut', 12)} 拆解 +${partsYield} 零件</button>`
                              : ''
                          }
                          <button type="button" class="btn btn-sm btn-secondary" data-research-id="${
                            item.instanceId
                          }" data-testid="btn-research-${item.instanceId}" ${
                        options.readOnly || !resCheck.canResearch ? 'disabled' : ''
                      }>研究 (-${researchCost}¤)</button>
                          <button type="button" class="btn btn-sm btn-ghost" data-sell-wh="${
                            item.instanceId
                          }" ${options.readOnly ? 'disabled' : ''}>出售 +${item.fixedValue}¤</button>
                        </div>
                      </div>`;
                    })
                    .join('')}
                </div>`
          }
        `;

        const hullTuningHtml = options.onTuneHull
          ? `<div class="v3-hull-tuning-section">
              <div class="v2-section-mini-title">${svgIcon('wrench', 14)} 船体专项调校（消耗精密零件 · 永久生效）</div>
              <div class="v3-hull-tuning-grid">
                ${profile.unlockedShips
                  .map((sid) => {
                    const ship = V2_SHIPS[sid];
                    const effHp = getEffectiveShipMaxHp(profile, sid);
                    const effBudget = getEffectiveShipLoadoutBudget(profile, sid);
                    return `<div class="v3-hull-tune-card">
                      <div class="v3-htc-head">
                        <strong>${ship.name}</strong>
                        <small class="num">当前耐久 ${effHp} HP · 预算 ${effBudget}</small>
                      </div>
                      <div class="v3-htc-tracks">
                        ${HULL_TUNING_TRACKS.map((track) => {
                          const chk = canTuneV2ShipHull(profile, sid, track);
                          const info = V3_HULL_TUNING_LABELS[track];
                          const btnText =
                            chk.currentLevel >= chk.maxLevel
                              ? `已满级 (${chk.currentLevel}/${chk.maxLevel})`
                              : `调校 (-${chk.cost?.parts ?? 0} 零件)`;
                          return `<div class="v3-htc-track-row">
                            <div class="v3-htc-track-info">
                              <span>${info.title} <strong class="num">Lv.${chk.currentLevel}/${chk.maxLevel}</strong></span>
                              <small>${info.perkPerLevel}</small>
                            </div>
                            <button type="button" class="btn btn-sm btn-secondary" data-tune-ship="${sid}" data-tune-track="${track}" data-testid="btn-tune-${sid}-${track}" ${
                            options.readOnly || !chk.canTune ? 'disabled' : ''
                          }>${btnText}</button>
                          </div>`;
                        }).join('')}
                      </div>
                    </div>`;
                  })
                  .join('')}
              </div>
            </div>`
          : '';

        const researchHtml = `
          <div class="v2-wh-summary">
            <span>永久蓝图：<strong class="num">${profile.blueprints.length}/${V2_ALL_EQUIPMENT_KINDS.length}</strong></span>
            <span class="v3-parts-pill">${svgIcon('parts', 13)} 精密零件：<strong class="num">${
          profile.salvageParts
        }</strong></span>
            <span>信用点：<strong class="num">${profile.credits}¤</strong></span>
          </div>
          ${discountBannerHtml}
          <div class="v2-empty-hint" style="margin-bottom:8px;">
            已掌握蓝图可消耗信用点或精密零件组装自有普通设备入库（<strong>出航预算 -1，最低 1</strong>）；入库后可在「设备库」页消耗精密零件精炼升级至优良品质。
          </div>
          <div class="v2-wh-list">
            ${V2_ALL_EQUIPMENT_KINDS.map((kind) => {
              const def = getV2EquipmentDefByKind(kind, 'common');
              const ownedBudget = getEffectiveV2EquipmentBudgetCost(def, 'owned');
              const unlocked = profile.blueprints.includes(kind);
              const craftCost = getEffectiveV2CraftCost(profile, kind);
              const canCraftCredits =
                hasLab &&
                unlocked &&
                profile.credits >= craftCost &&
                profile.equipmentWarehouse.length < V2_WAREHOUSE_CAPACITY;
              const partsCheck = canCraftV2EquipmentWithParts(profile, kind);

              return `<div class="v2-wh-row">
                <img class="v2-wh-icon" src="${getItemImageUrl(def.defId)}" alt="${def.name}" />
                <div class="v2-wh-info">
                  <div class="v2-wh-name">
                    ${def.name}
                    <span class="v2-bp-badge ${unlocked ? 'unlocked' : 'locked'}">${
                unlocked ? '已掌握' : '待研究'
              }</span>
                  </div>
                  <div class="v2-wh-sub">${renderV2MiniMaskHtml(def.shapeId)} ${def.summary} · 借用预算 ${
                def.budgetCost
              }${ownedBudget < def.budgetCost ? ` → 自有预算 ${ownedBudget}` : ''}</div>
                </div>
                <div class="v2-wh-actions">
                  ${
                    options.onCraftWithParts
                      ? `<button type="button" class="btn btn-sm btn-primary" data-craft-parts-kind="${kind}" data-testid="btn-craft-parts-${kind}" ${
                          options.readOnly || !partsCheck.canCraft ? 'disabled' : ''
                        }>零件组装 (-${partsCheck.cost.parts} 零件)</button>`
                      : ''
                  }
                  <button type="button" class="btn btn-sm btn-secondary" data-craft-kind="${kind}" data-testid="btn-craft-${kind}" ${
                options.readOnly || !canCraftCredits ? 'disabled' : ''
              }>制造 ${craftCost}¤</button>
                </div>
              </div>`;
            }).join('')}
          </div>
          ${hullTuningHtml}
        `;

        body.innerHTML = `
          <div class="v3-workshop-root" data-testid="workshop-modal">
            <div class="v2-modal-tabs">
              <button type="button" class="btn btn-sm ${
                activeTab === 'warehouse' ? 'btn-primary' : 'btn-secondary'
              }" id="v2-tab-wh">设备库 (${safeWarehouseItems.length}/${V2_WAREHOUSE_CAPACITY})</button>
              <button type="button" class="btn btn-sm ${
                activeTab === 'research' ? 'btn-primary' : 'btn-secondary'
              }" id="v2-tab-res">蓝图工坊 (${profile.blueprints.length}/${V2_ALL_EQUIPMENT_KINDS.length})</button>
            </div>
            ${
              feedbackMsg
                ? `<div class="system-banner ${
                    feedbackMsg.isError ? 'banner-danger' : 'banner-warn'
                  }" style="margin:8px 0;">${feedbackMsg.text}</div>`
                : ''
            }
            ${activeTab === 'warehouse' ? warehouseHtml : researchHtml}
          </div>
        `;

        body.querySelector('#v2-tab-wh')?.addEventListener('click', () => {
          activeTab = 'warehouse';
          feedbackMsg = null;
          renderBody();
        });
        body.querySelector('#v2-tab-res')?.addEventListener('click', () => {
          activeTab = 'research';
          feedbackMsg = null;
          renderBody();
        });
        body.querySelectorAll<HTMLButtonElement>('[data-upgrade-id]').forEach((btn) => {
          btn.addEventListener('click', () => {
            if (!options.onUpgradeItem) return;
            const res = options.onUpgradeItem(btn.dataset.upgradeId!);
            feedbackMsg = res.ok
              ? { text: '精炼完成！设备已进阶至优良品质。', isError: false }
              : { text: res.error ?? '精炼升级失败', isError: true };
            renderBody();
          });
        });
        body.querySelectorAll<HTMLButtonElement>('[data-dismantle-wh]').forEach((btn) => {
          btn.addEventListener('click', () => {
            if (!options.onDismantleItem) return;
            const res = options.onDismantleItem(btn.dataset.dismantleWh!);
            feedbackMsg = res.ok
              ? {
                  text: `已拆解设备并回收 +${res.partsGained ?? 0} 精密零件。`,
                  isError: false,
                }
              : { text: res.error ?? '拆解失败', isError: true };
            renderBody();
          });
        });
        body.querySelectorAll<HTMLButtonElement>('[data-research-id]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const res = options.onResearch(btn.dataset.researchId!);
            feedbackMsg = res.ok
              ? { text: '研究完成！已永久解锁该设备普通蓝图。', isError: false }
              : { text: res.error ?? '无法研究', isError: true };
            renderBody();
          });
        });
        body.querySelectorAll<HTMLButtonElement>('[data-sell-wh]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const res = options.onSellItem(btn.dataset.sellWh!);
            feedbackMsg = res.ok
              ? { text: '已出售库存设备并计入信用点。', isError: false }
              : { text: res.error ?? '出售失败', isError: true };
            renderBody();
          });
        });
        body.querySelectorAll<HTMLButtonElement>('[data-claim-gift]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const res = options.onClaimGift(btn.dataset.claimGift!);
            feedbackMsg = res.ok
              ? { text: '赠品已安全收入设备库。', isError: false }
              : { text: res.error ?? '领取失败', isError: true };
            renderBody();
          });
        });
        body.querySelectorAll<HTMLButtonElement>('[data-sell-gift]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const res = options.onSellGift(btn.dataset.sellGift!);
            feedbackMsg = res.ok
              ? { text: '已出售赠品并计入信用点。', isError: false }
              : { text: res.error ?? '出售失败', isError: true };
            renderBody();
          });
        });
        body.querySelectorAll<HTMLButtonElement>('[data-craft-kind]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const res = options.onCraft(btn.dataset.craftKind as V2EquipmentKind);
            feedbackMsg = res.ok
              ? { text: '制造完成！自有设备已放入设备库。', isError: false }
              : { text: res.error ?? '制造失败', isError: true };
            renderBody();
          });
        });
        body.querySelectorAll<HTMLButtonElement>('[data-craft-parts-kind]').forEach((btn) => {
          btn.addEventListener('click', () => {
            if (!options.onCraftWithParts) return;
            const res = options.onCraftWithParts(btn.dataset.craftPartsKind as V2EquipmentKind);
            feedbackMsg = res.ok
              ? { text: '零件组装完成！自有设备已放入设备库。', isError: false }
              : { text: res.error ?? '组装失败', isError: true };
            renderBody();
          });
        });
        body.querySelectorAll<HTMLButtonElement>('[data-tune-ship]').forEach((btn) => {
          btn.addEventListener('click', () => {
            if (!options.onTuneHull) return;
            const sid = btn.dataset.tuneShip as V2ShipId;
            const track = btn.dataset.tuneTrack as V3HullTuningTrack;
            const res = options.onTuneHull(sid, track);
            feedbackMsg = res.ok
              ? { text: `${V2_SHIPS[sid].name}「${V3_HULL_TUNING_LABELS[track].title}」调校升级成功！`, isError: false }
              : { text: res.error ?? '调校失败', isError: true };
            renderBody();
          });
        });
      };

      renderBody();
    }
  );
}
