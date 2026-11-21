import { getItemImageUrl } from '../../assets/itemArt';
import type { GameSettings } from '../../domain/progression';
import { openManagedModal, type ManagedModalHandle } from '../../ui/Modals';
import { V2_CARGO_DEFS } from '../data/cargo';
import {
  V2_ALL_EQUIPMENT_KINDS,
  V2_EQUIPMENT_DEFS,
  V2_RESEARCH_COST_CREDITS,
  V2_WAREHOUSE_CAPACITY,
  getV2EquipmentDefByKind,
  type V2EquipmentKind,
} from '../data/equipment';
import { V2_RELICS, V2_RELIC_ORDER } from '../data/facilities';
import { V2_SHAPES } from '../data/shapes';
import { getAnyV2ItemDef } from '../domain/itemCatalog';
import type { V1MigrationInspection } from '../domain/migration';
import {
  canResearchV2Instance,
  canRestoreV2Relic,
  getV2RelicSummary,
} from '../domain/progressionV2';
import type { V2DiscardedRecord, V2ProfileState } from '../domain/types';
import { originFullLabel, originTagText, renderV2MiniMaskHtml } from './CargoGridV2';

let v2ModalSeq = 1;

function openTitledV2Modal(
  host: HTMLElement,
  opts: { readonly title: string; readonly dismissible?: boolean },
  buildBody: (body: HTMLElement, modal: ManagedModalHandle) => void
): ManagedModalHandle {
  const titleId = `v2-modal-title-${v2ModalSeq++}`;
  const dismissible = opts.dismissible ?? true;
  const modal = openManagedModal(host, { titleId, dismissible });

  const header = document.createElement('div');
  header.className = 'modal-header';
  header.innerHTML = `
    <h2 id="${titleId}" class="modal-title">${opts.title}</h2>
    ${
      dismissible
        ? `<button type="button" class="btn btn-sm btn-ghost modal-close-btn" aria-label="关闭弹层">✕</button>`
        : ''
    }
  `;
  header.querySelector('.modal-close-btn')?.addEventListener('click', () => modal.close());

  const body = document.createElement('div');
  body.className = 'modal-body';

  modal.card.appendChild(header);
  modal.card.appendChild(body);
  buildBody(body, modal);
  return modal;
}

export function openV2HelpModal(host: HTMLElement): void {
  openTitledV2Modal(host, { title: '远航经营 · V2 规则说明', dismissible: true }, (body, modal) => {
    body.innerHTML = `
      <div class="help-section">
        <h3>一、完整远航闭环</h3>
        <ul>
          <li><strong>接取委托</strong>：大件运输（2×3 密封反应堆）、失联救援（1×2 救生舱，携带时每跳燃料额外 +1 封顶）、航迹勘测（标定星点消耗 1 燃料扫描）。</li>
          <li><strong>整备出航</strong>：挑选 3 艘舰船与 3 名船员，在装配预算内组合<strong>借用设备</strong>或仓库<strong>自有设备</strong>（支持最多 3 套预设）。</li>
          <li><strong>六层分支航路</strong>：初始燃料 9（上限 10），任何节点均可随时<strong>免费安全返航</strong>；非战斗事件（废船/商人/异常区/求救信号）提供真实取舍。</li>
          <li><strong>返航结算</strong>：每件物品只能择一去向（交付 / 出售 / 入库 / 保留藏品 / 归还借用）；战败按「(航行钱包 + 非借用物品估价) × 40%」折算并损失本次带出的自有与拾获实物。</li>
        </ul>
      </div>
      <div class="help-section">
        <h3>二、三种核心构筑与邻接联动</h3>
        <ul>
          <li><strong>重炮爆发</strong>：重炮每 2 回合充能爆发穿甲，相邻<strong>聚能电容</strong> +4 伤害（优良 +6）。</li>
          <li><strong>无人机编队</strong>：无人机库每回合自动释放无人机（多段打击压制蜂群），相邻<strong>指挥中继</strong>提升部署上限；搭配<strong>近防机炮</strong>同时扫射 2 目标。</li>
          <li><strong>护盾反击</strong>：护盾发生器（上限 20）吸收常规伤害，相邻<strong>反击模块</strong>可将本回合护盾吸收量按比例反弹给敌方（穿盾伤害不计入吸收）。</li>
        </ul>
      </div>
      <div class="help-section">
        <h3>三、物品来源标记（非纯颜色表达）</h3>
        <ul>
          <li><span class="v2-origin-chip origin-loan">借</span> 借用设备：出航免费借用，返航自动归还，不可售卖或入库。</li>
          <li><span class="v2-origin-chip origin-owned">自</span> 自有设备：来自基地设备库，战败将损失，安全返航可免费回库或出售。</li>
          <li><span class="v2-origin-chip origin-loot">拾</span> 拾获物品：途中获取，可在商人处折价卖或安全返航后出售/入库。</li>
          <li><span class="v2-origin-chip origin-mission">任</span> 任务物品：估价 0¤，仅用于完成委托交付，不可出售或入库。</li>
        </ul>
      </div>
      <div class="help-section">
        <h3>四、键盘与触控操作</h3>
        <p>船舱整理支持拖拽、点选放置，以及完整键盘操作：<kbd>↑↓←→</kbd> 移动格位、<kbd>Enter</kbd>/<kbd>Space</kbd> 拿取与放置、<kbd>R</kbd> 旋转 90°、<kbd>Delete</kbd> 舍弃、<kbd>Esc</kbd> 取消或关闭弹层。</p>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:8px;">
        <button type="button" class="btn btn-primary" id="btn-v2-help-ok">知道了</button>
      </div>
    `;
    body.querySelector('#btn-v2-help-ok')?.addEventListener('click', () => modal.close());
  });
}

export function openV2SettingsModal(
  host: HTMLElement,
  settings: GameSettings,
  options: {
    readonly readOnly: boolean;
    readonly hasV1Save: boolean;
    readonly onChange: (next: GameSettings) => void;
    readonly onSwitchToV1: () => void;
    readonly onOpenMigration?: () => void;
    readonly onResetV2Save: () => void;
  }
): void {
  let current: GameSettings = { ...settings };
  openTitledV2Modal(host, { title: 'V2 设置与版本管理', dismissible: true }, (body, modal) => {
    const renderBody = () => {
      body.innerHTML = `
        <div class="settings-list">
          <div class="setting-row">
            <div>
              <div class="setting-label">战斗播放倍速</div>
              <div class="setting-sub">纯表现倍速，绝不影响确定性战斗胜负结果</div>
            </div>
            <div style="display:flex;gap:6px;">
              <button type="button" class="btn btn-sm ${
                current.combatSpeed === 1 ? 'btn-primary' : 'btn-secondary'
              }" id="v2-set-spd-1">1×</button>
              <button type="button" class="btn btn-sm ${
                current.combatSpeed === 2 ? 'btn-primary' : 'btn-secondary'
              }" id="v2-set-spd-2">2×</button>
            </div>
          </div>
          <div class="setting-row">
            <div>
              <div class="setting-label">音效开关 (SFX)</div>
              <div class="setting-sub">控制交互、装舱、武器与结算音效</div>
            </div>
            <button type="button" class="btn btn-sm ${
              current.sfxMuted ? 'btn-secondary' : 'btn-primary'
            }" id="v2-set-sfx">${current.sfxMuted ? '已静音' : '开启中'}</button>
          </div>
          <div class="setting-row">
            <div>
              <div class="setting-label">环境音乐开关 (BGM)</div>
              <div class="setting-sub">控制基地与远航环境合成音轨</div>
            </div>
            <button type="button" class="btn btn-sm ${
              current.bgmMuted ? 'btn-secondary' : 'btn-primary'
            }" id="v2-set-bgm">${current.bgmMuted ? '已静音' : '开启中'}</button>
          </div>
          <div class="setting-row">
            <div>
              <div class="setting-label">低动效模式</div>
              <div class="setting-sub">关闭震屏、火花粒子与返航长动画，加速结算</div>
            </div>
            <button type="button" class="btn btn-sm ${
              current.reducedMotion ? 'btn-primary' : 'btn-secondary'
            }" id="v2-set-motion">${current.reducedMotion ? '已开启' : '关闭'}</button>
          </div>
          <div class="setting-row">
            <div>
              <div class="setting-label">低画质省电模式</div>
              <div class="setting-sub">减少粒子与背景动效负载</div>
            </div>
            <button type="button" class="btn btn-sm ${
              current.lowQuality ? 'btn-primary' : 'btn-secondary'
            }" id="v2-set-quality">${current.lowQuality ? '已开启' : '关闭'}</button>
          </div>
          <div class="setting-row v2-rollback-row">
            <div>
              <div class="setting-label">旧版 V1 回退与迁移</div>
              <div class="setting-sub">V2 与 V1 存档完全独立隔离（starline_save_v1 永不覆盖）</div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
              ${
                options.hasV1Save && options.onOpenMigration
                  ? `<button type="button" class="btn btn-sm btn-secondary" id="v2-btn-open-mig">导入 V1 存档</button>`
                  : ''
              }
              <button type="button" class="btn btn-sm btn-secondary" id="v2-btn-rollback-v1">切换回 V1 经典模式</button>
            </div>
          </div>
          <div class="setting-row">
            <div>
              <div class="setting-label" style="color:var(--state-danger);">重置 V2 存档</div>
              <div class="setting-sub">仅清空 V2（starline_save_v2），不会影响旧版 V1 存档</div>
            </div>
            <button type="button" class="btn btn-sm btn-danger" id="v2-btn-reset" ${
              options.readOnly ? 'disabled' : ''
            }>重置 V2</button>
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:12px;">
          <button type="button" class="btn btn-primary" id="v2-set-done">完成</button>
        </div>
      `;

      const update = (patch: Partial<GameSettings>) => {
        current = { ...current, ...patch };
        options.onChange(current);
        renderBody();
      };

      body.querySelector('#v2-set-spd-1')?.addEventListener('click', () => update({ combatSpeed: 1 }));
      body.querySelector('#v2-set-spd-2')?.addEventListener('click', () => update({ combatSpeed: 2 }));
      body.querySelector('#v2-set-sfx')?.addEventListener('click', () =>
        update({ sfxMuted: !current.sfxMuted })
      );
      body.querySelector('#v2-set-bgm')?.addEventListener('click', () =>
        update({ bgmMuted: !current.bgmMuted })
      );
      body.querySelector('#v2-set-motion')?.addEventListener('click', () =>
        update({ reducedMotion: !current.reducedMotion })
      );
      body.querySelector('#v2-set-quality')?.addEventListener('click', () =>
        update({ lowQuality: !current.lowQuality })
      );
      body.querySelector('#v2-btn-rollback-v1')?.addEventListener('click', () => {
        modal.close();
        options.onSwitchToV1();
      });
      body.querySelector('#v2-btn-open-mig')?.addEventListener('click', () => {
        modal.close();
        options.onOpenMigration?.();
      });
      body.querySelector('#v2-btn-reset')?.addEventListener('click', () => {
        if (options.readOnly) return;
        const btn = body.querySelector<HTMLButtonElement>('#v2-btn-reset');
        if (!btn) return;
        if (btn.dataset.armed !== '1') {
          btn.dataset.armed = '1';
          btn.textContent = '再次点击确认清空 V2';
          return;
        }
        modal.close();
        options.onResetV2Save();
      });
      body.querySelector('#v2-set-done')?.addEventListener('click', () => modal.close());
    };

    renderBody();
  });
}

export function openV2WarehouseModal(
  host: HTMLElement,
  getProfile: () => V2ProfileState,
  options: {
    readonly readOnly: boolean;
    readonly initialTab?: 'warehouse' | 'research';
    readonly onResearch: (instanceId: string) => { readonly ok: boolean; readonly error?: string };
    readonly onCraft: (kind: V2EquipmentKind) => { readonly ok: boolean; readonly error?: string };
    readonly onSellItem: (instanceId: string) => { readonly ok: boolean; readonly error?: string };
    readonly onClaimGift: (instanceId: string) => { readonly ok: boolean; readonly error?: string };
    readonly onSellGift: (instanceId: string) => { readonly ok: boolean; readonly error?: string };
  }
): void {
  let activeTab: 'warehouse' | 'research' = options.initialTab ?? 'warehouse';
  let feedbackMsg: { readonly text: string; readonly isError: boolean } | null = null;

  openTitledV2Modal(host, { title: '设备库与研究台', dismissible: true }, (body) => {
    const renderBody = () => {
      const profile = getProfile();
      const hasLab = profile.buildings.research_lab;

      const giftHtml =
        profile.pendingGiftQueue.length > 0
          ? `<div class="v2-gift-box">
              <div class="v2-section-mini-title">🎁 待领取赠品队列 (${profile.pendingGiftQueue.length})</div>
              <div class="v2-wh-list">
                ${profile.pendingGiftQueue
                  .map((g) => {
                    const def = getAnyV2ItemDef(g.definitionId);
                    return `<div class="v2-wh-row">
                      <img class="v2-wh-icon" src="${getItemImageUrl(g.definitionId)}" alt="${def?.name ?? g.definitionId}" />
                      <div class="v2-wh-info">
                        <div class="v2-wh-name">${def?.name ?? g.definitionId} <span class="v2-q-tag">${
                      g.quality === 'improved' ? '优良' : '普通'
                    }</span></div>
                        <div class="v2-wh-sub">回收价 ${g.fixedValue}¤ · 满库时暂存于此绝不丢失</div>
                      </div>
                      <div class="v2-wh-actions">
                        <button type="button" class="btn btn-sm btn-primary" data-claim-gift="${g.instanceId}" ${
                      options.readOnly || profile.equipmentWarehouse.length >= V2_WAREHOUSE_CAPACITY
                        ? 'disabled'
                        : ''
                    }>收入库</button>
                        <button type="button" class="btn btn-sm btn-ghost" data-sell-gift="${g.instanceId}" ${
                      options.readOnly ? 'disabled' : ''
                    }>出售 +${g.fixedValue}¤</button>
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
          <span>仓库容量：<strong class="num">${profile.equipmentWarehouse.length}/${V2_WAREHOUSE_CAPACITY}</strong></span>
          <span>当前信用点：<strong class="num">${profile.credits}¤</strong></span>
          <span>研究台：<strong>${hasLab ? '已建成 ✓' : '未建成（需 100¤）'}</strong></span>
        </div>
        ${
          profile.equipmentWarehouse.length === 0
            ? `<div class="v2-empty-hint">设备库当前为空。安全返航时可将拾获的设备选为「入库」，或在此制造已解锁蓝图的普通自有设备。</div>`
            : `<div class="v2-wh-list">
                ${profile.equipmentWarehouse
                  .map((item) => {
                    const def = V2_EQUIPMENT_DEFS[item.definitionId];
                    const resCheck = canResearchV2Instance(profile, item.instanceId);
                    return `<div class="v2-wh-row">
                      <img class="v2-wh-icon" src="${getItemImageUrl(item.definitionId)}" alt="${def?.name ?? item.definitionId}" />
                      <div class="v2-wh-info">
                        <div class="v2-wh-name">
                          <span class="v2-origin-badge origin-${item.origin}">${originTagText(item.origin)}</span>
                          ${def?.name ?? item.definitionId}
                          <span class="v2-quality-chip ${item.quality}">${
                      item.quality === 'improved' ? '优良' : '普通'
                    }</span>
                        </div>
                        <div class="v2-wh-sub">${
                          def ? `${V2_SHAPES[def.shapeId].label} · 预算 ${def.budgetCost} · 回收 ${item.fixedValue}¤` : ''
                        }${
                          resCheck.canResearch && resCheck.isImproved
                            ? ' · ⚠ 研究优良设备仅解锁普通蓝图'
                            : !resCheck.canResearch && resCheck.reason
                            ? ` · ${resCheck.reason}`
                            : ''
                        }</div>
                      </div>
                      <div class="v2-wh-actions">
                        <button type="button" class="btn btn-sm btn-secondary" data-research-id="${item.instanceId}" ${
                      options.readOnly || !resCheck.canResearch ? 'disabled' : ''
                    }>研究 (-${V2_RESEARCH_COST_CREDITS}¤)</button>
                        <button type="button" class="btn btn-sm btn-ghost" data-sell-wh="${item.instanceId}" ${
                      options.readOnly ? 'disabled' : ''
                    }>出售 +${item.fixedValue}¤</button>
                      </div>
                    </div>`;
                  })
                  .join('')}
              </div>`
        }
      `;

      const researchHtml = `
        <div class="v2-wh-summary">
          <span>已解锁普通蓝图：<strong class="num">${profile.blueprints.length}/${V2_ALL_EQUIPMENT_KINDS.length}</strong></span>
          <span>当前信用点：<strong class="num">${profile.credits}¤</strong></span>
        </div>
        <div class="v2-empty-hint" style="margin-bottom:8px;">
          已解锁蓝图可直接出航<strong>免费借用（普通）</strong>，也可在此花钱即时制造<strong>自有普通实例</strong>入库。优良品质设备无法制造，仅可从航路拾获或流动商人购得。
        </div>
        <div class="v2-wh-list">
          ${V2_ALL_EQUIPMENT_KINDS.map((kind) => {
            const def = getV2EquipmentDefByKind(kind, 'common');
            const unlocked = profile.blueprints.includes(kind);
            const canCraft =
              hasLab &&
              unlocked &&
              profile.credits >= def.craftCost &&
              profile.equipmentWarehouse.length < V2_WAREHOUSE_CAPACITY;
            return `<div class="v2-wh-row">
              <img class="v2-wh-icon" src="${getItemImageUrl(def.defId)}" alt="${def.name}" />
              <div class="v2-wh-info">
                <div class="v2-wh-name">
                  ${def.name}
                  <span class="v2-bp-badge ${unlocked ? 'unlocked' : 'locked'}">${
              unlocked ? '蓝图已解锁' : '待研究解锁'
            }</span>
                </div>
                <div class="v2-wh-sub">${renderV2MiniMaskHtml(def.shapeId)} ${def.summary} · 预算 ${
              def.budgetCost
            }</div>
              </div>
              <div class="v2-wh-actions">
                <button type="button" class="btn btn-sm btn-primary" data-craft-kind="${kind}" ${
              options.readOnly || !canCraft ? 'disabled' : ''
            }>制造 ${def.craftCost}¤</button>
              </div>
            </div>`;
          }).join('')}
        </div>
      `;

      body.innerHTML = `
        <div class="v2-modal-tabs">
          <button type="button" class="btn btn-sm ${
            activeTab === 'warehouse' ? 'btn-primary' : 'btn-secondary'
          }" id="v2-tab-wh">设备库 (${profile.equipmentWarehouse.length}/${V2_WAREHOUSE_CAPACITY})</button>
          <button type="button" class="btn btn-sm ${
            activeTab === 'research' ? 'btn-primary' : 'btn-secondary'
          }" id="v2-tab-res">蓝图与制造 (${profile.blueprints.length}/10)</button>
        </div>
        ${
          feedbackMsg
            ? `<div class="system-banner ${
                feedbackMsg.isError ? 'banner-danger' : 'banner-warn'
              }" style="margin:8px 0;">${feedbackMsg.text}</div>`
            : ''
        }
        ${activeTab === 'warehouse' ? warehouseHtml : researchHtml}
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
      body.querySelectorAll<HTMLButtonElement>('[data-research-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const res = options.onResearch(btn.dataset.researchId!);
          feedbackMsg = res.ok
            ? { text: '研究完成！已永久解锁该设备普通蓝图（可出航借用与制造）。', isError: false }
            : { text: res.error ?? '无法研究', isError: true };
          renderBody();
        });
      });
      body.querySelectorAll<HTMLButtonElement>('[data-sell-wh]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const res = options.onSellItem(btn.dataset.sellWh!);
          feedbackMsg = res.ok
            ? { text: '已出售仓库设备并计入信用点。', isError: false }
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
            ? { text: '已折价出售赠品并计入信用点。', isError: false }
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
    };

    renderBody();
  });
}

export function openV2CodexModal(host: HTMLElement, profile: V2ProfileState): void {
  const eqList = Object.values(V2_EQUIPMENT_DEFS);
  const cargoList = Object.values(V2_CARGO_DEFS);
  const allDefs = [...eqList, ...cargoList];
  const discovered = new Set(profile.discoveredItems);
  const count = allDefs.filter((d) => discovered.has(d.defId)).length;

  openTitledV2Modal(
    host,
    { title: `V2 装备与货物图鉴 (${count}/${allDefs.length})`, dismissible: true },
    (body) => {
      body.innerHTML = `
        <div class="codex-grid">
          ${allDefs
            .map((d) => {
              const found = discovered.has(d.defId);
              const isEq = d.defId.startsWith('equipment.');
              return `<div class="codex-card ${found ? 'found' : 'locked'}">
                <img class="codex-icon" src="${getItemImageUrl(d.defId)}" alt="${d.name}" />
                <div class="codex-meta">
                  <div class="codex-name">${found ? d.name : '未发现模块'}</div>
                  <div class="codex-sub">${renderV2MiniMaskHtml(d.shapeId)} ${V2_SHAPES[d.shapeId].label} · ${
                isEq ? (d.defId.endsWith('.improved') ? '优良设备' : '普通设备') : '货物/藏品'
              }</div>
                  <div class="codex-desc">${found ? d.summary : '完成探索并安全带回后解锁完整记录'}</div>
                </div>
              </div>`;
            })
            .join('')}
        </div>
      `;
    }
  );
}

export function openV2RelicGalleryModal(
  host: HTMLElement,
  getProfile: () => V2ProfileState,
  options: {
    readonly readOnly: boolean;
    readonly onRestore: (relicId: string) => { readonly ok: boolean; readonly error?: string };
  }
): void {
  let msg: string | null = null;
  openTitledV2Modal(host, { title: '星际藏品展馆 (4 件稀世遗物)', dismissible: true }, (body) => {
    const renderBody = () => {
      const profile = getProfile();
      const sum = getV2RelicSummary(profile);
      body.innerHTML = `
        <div class="v2-wh-summary">
          <span>已修复陈列：<strong class="num">${sum.restoredCount}/${sum.totalCount}</strong></span>
          <span>库存待修：<strong class="num">${sum.storedTotal}</strong></span>
          <span>当前信用点：<strong class="num">${profile.credits}¤</strong></span>
        </div>
        ${msg ? `<div class="system-banner banner-warn" style="margin:8px 0;">${msg}</div>` : ''}
        <div class="relic-gallery-grid">
          ${V2_RELIC_ORDER.map((rid) => {
            const def = V2_RELICS[rid];
            const st = profile.relics[rid] ?? { storedCount: 0, restored: false };
            const check = canRestoreV2Relic(profile, rid);
            const itemDefId = `cargo.${rid}`;
            return `<div class="relic-card ${st.restored ? 'restored' : ''}">
              <img class="relic-thumb" src="${getItemImageUrl(itemDefId)}" alt="${def.name}" />
              <div class="relic-info">
                <div class="relic-title">${def.name} ${
              st.restored ? '<span class="v2-bp-badge unlocked">已修复陈列 ★</span>' : ''
            }</div>
                <div class="relic-lore">${def.lore}</div>
                <div class="relic-status">库藏实物：${st.storedCount} · 修复费用：${def.restoreCost}¤</div>
              </div>
              <div>
                ${
                  st.restored
                    ? `<span style="color:var(--accent-energy);font-size:12px;font-weight:700;">展台陈列中</span>`
                    : `<button type="button" class="btn btn-sm btn-primary" data-restore-relic="${rid}" ${
                        options.readOnly || !check.canRestore ? 'disabled' : ''
                      }>${check.canRestore ? `修复 (${def.restoreCost}¤)` : check.reason ?? '暂不可修'}</button>`
                }
              </div>
            </div>`;
          }).join('')}
        </div>
      `;

      body.querySelectorAll<HTMLButtonElement>('[data-restore-relic]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const res = options.onRestore(btn.dataset.restoreRelic!);
          msg = res.ok ? '藏品修复成功！已陈列至拆解站主展台。' : res.error ?? '修复失败';
          renderBody();
        });
      });
    };
    renderBody();
  });
}

export function openV2DiscardConfirmModal(
  host: HTMLElement,
  discarded: readonly V2DiscardedRecord[],
  onConfirm: () => void
): void {
  const hasOwnedOrMission = discarded.some(
    (d) => d.item.origin === 'owned' || d.item.origin === 'mission'
  );
  openTitledV2Modal(host, { title: '确认永久舍弃物品', dismissible: true }, (body, modal) => {
    body.innerHTML = `
      <p style="margin:0 0 10px 0;font-size:13px;color:var(--text-secondary);">
        离开当前整理阶段后，以下 <strong>${discarded.length}</strong> 件舍弃物品将被永久清理且无法撤回：
      </p>
      ${
        hasOwnedOrMission
          ? `<div class="system-banner banner-danger" style="margin-bottom:10px;">⚠ 注意：包含<strong>自有设备或任务物品</strong>，永久舍弃后将无法找回或交付！</div>`
          : ''
      }
      <ul class="discard-confirm-list">
        ${discarded
          .map((rec) => {
            const def = getAnyV2ItemDef(rec.item.definitionId);
            return `<li>
              <span class="v2-origin-badge origin-${rec.item.origin}">${originTagText(rec.item.origin)}</span>
              <strong>${def?.name ?? rec.item.definitionId}</strong>
              <span>（${originFullLabel(rec.item.origin)}${
              rec.item.fixedValue > 0 ? ` · ${rec.item.fixedValue}¤` : ''
            }）</span>
            </li>`;
          })
          .join('')}
      </ul>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
        <button type="button" class="btn btn-secondary" id="v2-discard-cancel">取消返回整理</button>
        <button type="button" class="btn btn-danger" id="v2-discard-ok">确认永久舍弃并继续</button>
      </div>
    `;
    body.querySelector('#v2-discard-cancel')?.addEventListener('click', () => modal.close());
    body.querySelector('#v2-discard-ok')?.addEventListener('click', () => {
      modal.close();
      onConfirm();
    });
  });
}

export function openV2BackupRecoveryModal(
  host: HTMLElement,
  params: {
    readonly error: string;
    readonly hasBackup: boolean;
    readonly onRestoreBackup?: () => void;
    readonly onResetFresh: () => void;
  }
): void {
  openTitledV2Modal(host, { title: 'V2 存档异常保护', dismissible: false }, (body, modal) => {
    body.innerHTML = `
      <div class="system-banner banner-danger" style="margin-bottom:10px;">
        检测到 V2 主存档校验失败（${params.error}）。系统已阻止静默清空，请选择恢复方式：
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:12px;">
        ${
          params.hasBackup && params.onRestoreBackup
            ? `<button type="button" class="btn btn-primary" id="v2-rec-backup">恢复上一份完好备份</button>`
            : ''
        }
        <button type="button" class="btn btn-danger" id="v2-rec-fresh">放弃损坏主档，新建 V2 进度</button>
      </div>
    `;
    body.querySelector('#v2-rec-backup')?.addEventListener('click', () => {
      modal.close();
      params.onRestoreBackup?.();
    });
    body.querySelector('#v2-rec-fresh')?.addEventListener('click', () => {
      modal.close();
      params.onResetFresh();
    });
  });
}

export function openV1MigrationModal(
  host: HTMLElement,
  inspection: V1MigrationInspection,
  callbacks: {
    readonly onContinueV1: () => void;
    readonly onConfirmMigrate: () => void;
    readonly onStartFreshV2: () => void;
  }
): void {
  openTitledV2Modal(host, { title: '发现旧版 V1 存档 · 迁移向导', dismissible: true }, (body, modal) => {
    const totalEstimated =
      inspection.baseCredits + (inspection.activeRunPreview?.estimatedCredits ?? 0);
    body.innerHTML = `
      <p style="margin:0 0 10px 0;font-size:13px;color:var(--text-secondary);">
        检测到浏览器中存有 <strong>《星际拆解站》V1</strong> 存档。迁移过程<strong>不会覆盖或删除</strong>旧版存档，随时可在设置中切回 V1 经典模式。
      </p>
      ${
        !inspection.v1Valid
          ? `<div class="system-banner banner-danger">旧版 V1 存档读取异常（${inspection.v1Error ?? '格式错误'}），建议先切回 V1 检查或直接开始全新 V2。</div>`
          : `<div class="v2-mig-preview-card">
              <div class="v2-mig-row"><span>基地原有信用点</span><strong class="num">${inspection.baseCredits}¤</strong></div>
              <div class="v2-mig-row"><span>已保留藏品馆进度（4 件全兼容）</span><strong>已修复 ${inspection.relicsSummary.restored} · 库藏 ${inspection.relicsSummary.stored}</strong></div>
              <div class="v2-mig-row"><span>V2 升级免费启用</span><strong>委托终端 + 4 项基础普通蓝图</strong></div>
              ${
                inspection.activeRunPreview
                  ? `<div class="v2-mig-active-run">
                      <strong>检测到进行中的 V1 航次：</strong>
                      <div>${inspection.activeRunPreview.summaryText}</div>
                    </div>`
                  : ''
              }
              <div class="v2-mig-row total"><span>迁移后预计 V2 初始信用点</span><strong class="num">${totalEstimated}¤</strong></div>
            </div>`
      }
      <div class="v2-mig-actions">
        <button type="button" class="btn btn-secondary" id="v2-mig-v1">继续体验旧版 V1</button>
        <button type="button" class="btn btn-ghost" id="v2-mig-fresh">暂不迁移，全新 V2</button>
        ${
          inspection.v1Valid
            ? `<button type="button" class="btn btn-primary" id="v2-mig-go">确认迁移到 V2（保留旧档）</button>`
            : ''
        }
      </div>
    `;

    body.querySelector('#v2-mig-v1')?.addEventListener('click', () => {
      modal.close();
      callbacks.onContinueV1();
    });
    body.querySelector('#v2-mig-fresh')?.addEventListener('click', () => {
      modal.close();
      callbacks.onStartFreshV2();
    });
    body.querySelector('#v2-mig-go')?.addEventListener('click', () => {
      modal.close();
      callbacks.onConfirmMigrate();
    });
  });
}
