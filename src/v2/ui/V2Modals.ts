import { getItemImageUrl } from '../../assets/itemArt';
import { openManagedModal, type ManagedModalHandle } from '../../ui/Modals';
import { V2_CARGO_DEFS } from '../data/cargo';
import { V2_EQUIPMENT_DEFS } from '../data/equipment';
import {
  V2_RELICS,
  V2_RELIC_ORDER,
  V3_RELIC_PASSIVES,
  V3_STATION_FACILITIES,
  V3_STATION_FACILITY_ORDER,
  type V3StationFacilityId,
} from '../data/facilities';
import { V3_GADGET_DEFS } from '../data/gadgets';
import { V2_SHAPES } from '../data/shapes';
import { V2_SHIP_ORDER } from '../data/ships';
import { V2_TRIAL_BUILD_ORDER, V2_TRIAL_BUILDS } from '../data/trialBuilds';
import { getAnyV2ItemDef } from '../domain/itemCatalog';
import type { V1MigrationInspection } from '../domain/migration';
import {
  canRestoreV2Relic,
  canUpgradeV3Facility,
  getEffectiveWarehouseCapacity,
  getV2RelicSummary,
} from '../domain/progressionV2';
import {
  isPureAutoCombat,
  type V2CargoBayState,
  type V2DiscardedRecord,
  type V2GameSettings,
  type V2ProfileState,
  type V2TrialBuildId,
} from '../domain/types';
import {
  CargoGridV2Component,
  originFullLabel,
  originTagText,
  renderV2MiniMaskHtml,
} from './CargoGridV2';
import { svgIcon } from './icons';
import {
  openV3ContractsModal,
  type V3ContractsModalOptions,
} from './modals/ContractsModal';
import {
  openV3WorkshopModal,
  type V3WorkshopModalOptions,
} from './modals/WorkshopModal';

let v2ModalSeq = 1;
const v2ModalOpenListeners = new Set<() => void>();

export function subscribeV2ModalOpen(listener: () => void): () => void {
  v2ModalOpenListeners.add(listener);
  return () => {
    v2ModalOpenListeners.delete(listener);
  };
}

export function openTitledV2Modal(
  host: HTMLElement,
  opts: {
    readonly title: string;
    readonly dismissible?: boolean;
    readonly cardClass?: string;
    readonly onClose?: () => void;
  },
  buildBody: (body: HTMLElement, modal: ManagedModalHandle) => void
): ManagedModalHandle {
  const titleId = `v2-modal-title-${v2ModalSeq++}`;
  const dismissible = opts.dismissible ?? true;
  const modal = openManagedModal(host, { titleId, dismissible, onClose: opts.onClose });
  for (const listener of v2ModalOpenListeners) {
    try {
      listener();
    } catch {
      // ignore subscriber errors
    }
  }
  if (opts.cardClass) {
    modal.card.classList.add(opts.cardClass);
  }

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

export function openV2ContractsDrawerModal(
  host: HTMLElement,
  profile: V2ProfileState,
  options: V3ContractsModalOptions
): void {
  openV3ContractsModal(host, profile, options);
}

export function openV2FacilitiesDrawerModal(
  host: HTMLElement,
  getProfile: () => V2ProfileState,
  options: {
    readonly readOnly: boolean;
    readonly onUpgrade: (
      fid: V3StationFacilityId
    ) => { readonly ok: boolean; readonly error?: string; readonly newTier?: number };
  }
): void {
  let feedback: { readonly text: string; readonly isError: boolean } | null = null;
  openTitledV2Modal(
    host,
    { title: '空间站设施扩建（T1–T3 阶升级）', cardClass: 'v3-facilities-modal', dismissible: true },
    (body) => {
      const renderBody = () => {
        const p = getProfile();
        const warehouseCap = getEffectiveWarehouseCapacity(p);
        body.innerHTML = `
          <div class="v2-wh-summary">
            <span>信用点：<strong class="num">${p.credits}¤</strong></span>
            <span class="v3-parts-pill">${svgIcon('parts', 13)} 精密零件：<strong class="num">${p.salvageParts}</strong></span>
            <span>舰船：<strong class="num">${p.unlockedShips.length}/${V2_SHIP_ORDER.length}</strong></span>
            <span>设备库上限：<strong class="num">${warehouseCap}</strong></span>
          </div>
          ${
            feedback
              ? `<div class="system-banner ${
                  feedback.isError ? 'banner-danger' : 'banner-warn'
                }" style="margin:8px 0;">${feedback.text}</div>`
              : ''
          }
          <div class="v2-facility-list v3-facility-list">
            ${V3_STATION_FACILITY_ORDER.map((fid) => {
              const def = V3_STATION_FACILITIES[fid];
              const check = canUpgradeV3Facility(p, fid);
              const curTier = check.currentTier;
              const isMax = curTier >= 3;
              const nextSpec = check.nextSpec;
              const costParts: string[] = [];
              if (nextSpec) {
                if (nextSpec.creditCost > 0) costParts.push(`${nextSpec.creditCost}¤`);
                if (nextSpec.partsCost > 0) costParts.push(`${nextSpec.partsCost} 精密零件`);
              }
              const costText = costParts.length > 0 ? costParts.join(' + ') : '首航免费';
              const btnLabel = !nextSpec
                ? '已满级 T3'
                : nextSpec.creditCost === 0 && nextSpec.partsCost === 0
                ? '首航解锁'
                : nextSpec.tier === 1
                ? `建造 T1（${costText}）`
                : `升级 T${nextSpec.tier}（${costText}）`;
              const activeDesc =
                curTier > 0
                  ? `当前 T${curTier}：${def.tiers[curTier - 1].effectSummary}`
                  : `未建 · T1 效果：${def.tiers[0].effectSummary}`;
              const nextDesc =
                nextSpec && curTier > 0
                  ? `<div class="v3-fac-next-desc">下一阶 T${nextSpec.tier}：${nextSpec.effectSummary}</div>`
                  : '';

              return `<div class="v2-facility-card v3-facility-card ${curTier > 0 ? 'built' : ''} ${
                isMax ? 'is-max-tier' : ''
              }" data-facility-id="${fid}" data-facility-tier="${curTier}">
                <div class="v2-fac-main">
                  <div class="v2-fac-title">
                    <strong>${def.name}</strong>
                    <span class="v2-fac-badge ${curTier > 0 ? 'done' : ''}">${
                isMax ? '已满级 T3' : curTier > 0 ? `T${curTier}/T3` : '未建'
              }</span>
                    <span class="v3-fac-tier-pips" aria-hidden="true">
                      <i class="${curTier >= 1 ? 'on' : ''}">T1</i>
                      <i class="${curTier >= 2 ? 'on' : ''}">T2</i>
                      <i class="${curTier >= 3 ? 'on' : ''}">T3</i>
                    </span>
                  </div>
                  <div class="v2-fac-desc">${activeDesc}</div>
                  ${nextDesc}
                  ${!isMax && check.reason ? `<div class="v2-fac-req">${check.reason}</div>` : ''}
                </div>
                <div class="v2-fac-act">
                  ${
                    isMax
                      ? `<span class="v2-built-ok">满级运行中</span>`
                      : `<button type="button" class="btn btn-sm btn-primary" data-modal-build="${fid}" data-testid="btn-build-${fid}" ${
                          options.readOnly || !check.canUpgrade ? 'disabled' : ''
                        }>${btnLabel}</button>`
                  }
                </div>
              </div>`;
            }).join('')}
          </div>
        `;

        body.querySelectorAll<HTMLButtonElement>('[data-modal-build]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const fid = btn.dataset.modalBuild as V3StationFacilityId;
            const res = options.onUpgrade(fid);
            const name = V3_STATION_FACILITIES[fid]?.name ?? fid;
            feedback = res.ok
              ? {
                  text: `「${name}」已升至 T${res.newTier ?? 1} 阶并立即生效！`,
                  isError: false,
                }
              : { text: res.error ?? '无法扩建或升级', isError: true };
            renderBody();
          });
        });
      };
      renderBody();
    }
  );
}

export function openV2ShowcasePickerModal(
  host: HTMLElement,
  onPickTrial: (trialId: V2TrialBuildId) => void
): void {
  openTitledV2Modal(
    host,
    { title: '4 站精华试玩 · 选择试航构筑', dismissible: true },
    (body, modal) => {
      body.innerHTML = `
        <p style="margin:0 0 10px 0;font-size:13px;color:var(--text-secondary);">
          10 分钟浓缩体验：试航成型构筑 → 克制交火 → 废船三热点切割 → 2×3 密封反应堆腾舱 → 可选末层精英战。<strong>独立试玩，不修改你的正式存档进度。</strong>
        </p>
        <div class="v2-trial-grid">
          ${V2_TRIAL_BUILD_ORDER.map((tid) => {
            const spec = V2_TRIAL_BUILDS[tid];
            const ico = tid === 'trial_heavy' ? 'cannon' : tid === 'trial_hangar' ? 'drone' : 'counter';
            return `<button type="button" class="v2-trial-card" data-showcase-trial="${tid}">
              <div class="v2-trial-head">
                <span class="v2-trial-ico">${svgIcon(ico, 18)}</span>
                <strong>${spec.name}</strong>
              </div>
              <div class="v2-trial-tag">${spec.tagline}</div>
              <div class="v2-trial-pros">优势：${spec.advantage}</div>
              <div class="v2-trial-cons">代价：${spec.tradeoff}</div>
            </button>`;
          }).join('')}
        </div>
      `;

      body.querySelectorAll<HTMLButtonElement>('[data-showcase-trial]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const tid = btn.dataset.showcaseTrial as V2TrialBuildId;
          modal.close();
          onPickTrial(tid);
        });
      });
    }
  );
}

export function openV2MoreModesModal(
  host: HTMLElement,
  options: {
    readonly onStartShowcase: (trialId: V2TrialBuildId) => void;
    readonly onSwitchToV1: () => void;
  }
): void {
  openTitledV2Modal(
    host,
    { title: '更多模式 / 试航演练', dismissible: true },
    (body, modal) => {
      body.innerHTML = `
        <div class="v3-more-modes-list">
          <div class="v3-mode-card">
            <div class="v3-mode-card-head">
              <strong>${svgIcon('bolt', 15)} 4 站精华试玩（独立演练）</strong>
              <span class="v2-origin-chip origin-loan">不改正式存档</span>
            </div>
            <p class="v3-mode-card-desc">
              直接选用成型三流派构筑体验完整 4 站循环：克制交火 → 废船切割 → 2×3 反应堆腾舱 → 末层精英战。
            </p>
            <button type="button" class="btn btn-primary btn-sm" id="v3-btn-mode-showcase" data-testid="btn-mode-showcase">
              选择试航构筑 →
            </button>
          </div>
          <div class="v3-mode-card">
            <div class="v3-mode-card-head">
              <strong>${svgIcon('rocket', 15)} 经典模式（V1 初代版本）</strong>
              <span class="v2-origin-chip origin-owned">独立存档</span>
            </div>
            <p class="v3-mode-card-desc">
              切换回初代《星际拆解站》经典流程体验；原有 V1 存档与新版远征存档完全独立互不覆盖。
            </p>
            <button type="button" class="btn btn-secondary btn-sm" id="v3-btn-mode-v1" data-testid="btn-mode-v1">
              切换至经典模式
            </button>
          </div>
        </div>
      `;

      body.querySelector('#v3-btn-mode-showcase')?.addEventListener('click', () => {
        modal.close();
        openV2ShowcasePickerModal(host, options.onStartShowcase);
      });

      body.querySelector('#v3-btn-mode-v1')?.addEventListener('click', () => {
        modal.close();
        options.onSwitchToV1();
      });
    }
  );
}

export function openV2CargoPeekModal(
  host: HTMLElement,
  bay: V2CargoBayState,
  title: string
): void {
  let grid: CargoGridV2Component | null = null;
  openTitledV2Modal(
    host,
    {
      title,
      dismissible: true,
      onClose: () => {
        grid?.destroy();
        grid = null;
      },
    },
    (body) => {
      const mount = document.createElement('div');
      mount.className = 'cargo-mount-root';
      body.appendChild(mount);
      grid = new CargoGridV2Component(mount, { onBayChange: () => {} });
      grid.render(bay, false);
    }
  );
}

export function openV2HelpModal(host: HTMLElement): void {
  openTitledV2Modal(host, { title: '远航指南', dismissible: true }, (body, modal) => {
    body.innerHTML = `
      <div class="help-section">
        <h3>一、远航经营循环</h3>
        <ul>
          <li><strong>接取委托</strong>：大件运输（2×3 密封反应堆）、失联救援（1×2 救生舱）、航迹勘测（标定星点消耗燃料扫描）。</li>
          <li><strong>试航与配装</strong>：整备期可一键体验重炮破甲、无人机编队、护盾反击三套试航方案，也可自由组合自有设备与永久蓝图。</li>
          <li><strong>六层分支航路</strong>：初始燃料 9（上限 10），任何节点均可随时<strong>免费安全返航</strong>；废船残骸提供军械舱、反应舱、货舱三处独立切割点。</li>
          <li><strong>返航结算</strong>：每件战利品可择一出售、入库研究或保留藏品；战败按 40% 折算回收并损失当次携带的自有与拾获实物。</li>
        </ul>
      </div>
      <div class="help-section">
        <h3>二、主动战术指令、敌人意图与首领阶段</h3>
        <ul>
          <li><strong>主动战术指令（默认开启）</strong>：常规战拥有 <strong>1 次</strong>指令充能，星区首领战拥有 <strong>2 次</strong>充能（复原「黑曜冠徽」后提升至 <strong>3 次</strong>）；可在 <strong>火力过载 / 紧急护盾 / 聚焦校准</strong> 与当前艇体的<strong>专属指令</strong>间择机施放，也可在设置中切换为纯自动战斗。</li>
          <li><strong>敌人意图预告</strong>：战前与战中实时展示敌舰多轮行动节拍（蓄力重炮、护盾再生、无人机召唤、EMP 削盾、加速撞击），可提前抬盾或破甲反制。</li>
          <li><strong>三大星区多阶段首领</strong>：第一幕「铁砧号」（2 阶段）、第二幕「铁壁无畏」（2 阶段）、第三幕「黑曜利维坦」（3 阶段）会在血线阈值切换形态并触发新攻击节奏。</li>
        </ul>
      </div>
      <div class="help-section">
        <h3>三、船体供能格、新模块、消耗装置与藏品被动</h3>
        <ul>
          <li><strong>船体供能格（⚡）</strong>：4 艘舰船均配有高亮供能格，装备覆盖供能格即可获得超导增幅（激光+1伤、重炮+3伤、护盾+2盾、导弹舱+1发、排热阀+1回盾等）。</li>
          <li><strong>跨体系模块与 1×1 消耗装置</strong>：含冷却排热阀、货舱谐振仪、EMP 干扰器、超频核心、磁力拆解爪、齐射导弹舱，以及 4 种一次性消耗装置（应急维修包 / 过载电池 / 跃迁燃料罐 / 切割稳定器）。</li>
          <li><strong>空间站 T1–T3 扩建与遗物被动</strong>：6 大部门可升至 T3，船坞 T3 解锁旗舰「星门巡洋舰」；4 件遗物在藏品馆<strong>修复陈列后</strong>立即激活全局被动（星盘+1油全图透视、冻珀+4HP、量子核+1预算、黑曜冠徽首领+1指令）。</li>
        </ul>
      </div>
      <div class="help-section">
        <h3>四、物品来源标记与操作</h3>
        <ul>
          <li><span class="v2-origin-chip origin-loan">借</span> 借用设备 · <span class="v2-origin-chip origin-owned">自</span> 自有设备（战败损毁） · <span class="v2-origin-chip origin-loot">拾</span> 拾获战利品 · <span class="v2-origin-chip origin-mission">任</span> 委托任务件。</li>
          <li>船舱整理支持拖拽、点选与键盘：<kbd>↑↓←→</kbd> 移格、<kbd>Enter</kbd>/<kbd>Space</kbd> 拿放、<kbd>R</kbd> 旋转、<kbd>Delete</kbd> 舍弃、<kbd>Esc</kbd> 关闭弹层。</li>
        </ul>
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
  settings: V2GameSettings,
  options: {
    readonly readOnly: boolean;
    readonly hasV1Save: boolean;
    readonly onChange: (next: V2GameSettings) => void;
    readonly onSwitchToV1: () => void;
    readonly onOpenMigration?: () => void;
    readonly onResetV2Save: () => void;
    readonly playtestTelemetry?: {
      readonly enabled: boolean;
      readonly onExport: () => string;
      readonly onClear?: () => void;
    };
  }
): void {
  let current: V2GameSettings = { ...settings };
  openTitledV2Modal(host, { title: '游戏设置', dismissible: true }, (body, modal) => {
    const renderBody = () => {
      const pureAutoOn = isPureAutoCombat(current);
      body.innerHTML = `
        <div class="settings-list">
          <div class="setting-row">
            <div>
              <div class="setting-label">战斗播放倍速</div>
              <div class="setting-sub">仅加快演出节奏，不影响交火胜负结果</div>
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
              <label for="v2-set-pure-auto" class="setting-label">纯自动战斗模式</label>
              <div class="setting-sub">默认关闭（主动战术指令开启）；开启后跳过战中战术暂停，按配装自动交火</div>
            </div>
            <button type="button" class="btn btn-sm ${
              pureAutoOn ? 'btn-primary' : 'btn-secondary'
            }" id="v2-set-pure-auto" data-testid="toggle-pure-auto" aria-label="纯自动战斗模式" aria-pressed="${pureAutoOn}">${
        pureAutoOn ? '纯自动：已开启' : '纯自动：关闭（主动战术）'
      }</button>
          </div>
          <div class="setting-row">
            <div>
              <div class="setting-label">音效开关 (SFX)</div>
              <div class="setting-sub">控制装舱、武器开火与靠泊音效</div>
            </div>
            <button type="button" class="btn btn-sm ${
              current.sfxMuted ? 'btn-secondary' : 'btn-primary'
            }" id="v2-set-sfx">${current.sfxMuted ? '已静音' : '开启中'}</button>
          </div>
          <div class="setting-row">
            <div>
              <div class="setting-label">环境音乐 (BGM)</div>
              <div class="setting-sub">控制空间站与深空环境合成音轨</div>
            </div>
            <button type="button" class="btn btn-sm ${
              current.bgmMuted ? 'btn-secondary' : 'btn-primary'
            }" id="v2-set-bgm">${current.bgmMuted ? '已静音' : '开启中'}</button>
          </div>
          <div class="setting-row">
            <div>
              <div class="setting-label">低动效模式</div>
              <div class="setting-sub">关闭震屏、火花粒子与长返航动画</div>
            </div>
            <button type="button" class="btn btn-sm ${
              current.reducedMotion ? 'btn-primary' : 'btn-secondary'
            }" id="v2-set-motion">${current.reducedMotion ? '已开启' : '关闭'}</button>
          </div>
          <div class="setting-row">
            <div>
              <div class="setting-label">低画质省电模式</div>
              <div class="setting-sub">将场景画布切换至 1× 渲染并减少背景粒子</div>
            </div>
            <button type="button" class="btn btn-sm ${
              current.lowQuality ? 'btn-primary' : 'btn-secondary'
            }" id="v2-set-quality">${current.lowQuality ? '已开启' : '关闭'}</button>
          </div>
          <div class="setting-row v2-rollback-row">
            <div>
              <div class="setting-label">经典模式与旧档迁移</div>
              <div class="setting-sub">旧版存档完全独立保留，可随时切换体验</div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
              ${
                options.hasV1Save && options.onOpenMigration
                  ? `<button type="button" class="btn btn-sm btn-secondary" id="v2-btn-open-mig">导入旧版存档</button>`
                  : ''
              }
              <button type="button" class="btn btn-sm btn-secondary" id="v2-btn-rollback-v1">切换回经典模式</button>
            </div>
          </div>
          ${
            options.playtestTelemetry?.enabled
              ? `<div class="setting-row" data-testid="playtest-telemetry-row">
                  <div>
                    <div class="setting-label">试玩日志导出 (Playtest)</div>
                    <div class="setting-sub">仅本地记录当前试玩会话的阶段停留、交互与拖放数据（无网络上报）</div>
                  </div>
                  <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
                    <button type="button" class="btn btn-sm btn-secondary" id="v2-btn-export-playtest-log" data-testid="btn-export-playtest-log">导出试玩日志 (JSON)</button>
                    ${
                      options.playtestTelemetry.onClear
                        ? `<button type="button" class="btn btn-sm btn-ghost" id="v2-btn-clear-playtest-log" data-testid="btn-clear-playtest-log">清空日志</button>`
                        : ''
                    }
                  </div>
                </div>`
              : ''
          }
          <div class="setting-row">
            <div>
              <div class="setting-label" style="color:var(--state-danger);">重置当前远航进度</div>
              <div class="setting-sub">仅清空当前远航档，不会影响旧版经典档</div>
            </div>
            <button type="button" class="btn btn-sm btn-danger" id="v2-btn-reset" ${
              options.readOnly ? 'disabled' : ''
            }>重置进度</button>
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:12px;">
          <button type="button" class="btn btn-primary" id="v2-set-done" data-action="close-modal">完成</button>
        </div>
      `;

      const update = (patch: Partial<V2GameSettings>) => {
        current = { ...current, ...patch };
        options.onChange(current);
        renderBody();
      };

      body.querySelector('#v2-set-spd-1')?.addEventListener('click', () => update({ combatSpeed: 1 }));
      body.querySelector('#v2-set-spd-2')?.addEventListener('click', () => update({ combatSpeed: 2 }));
      body.querySelector('#v2-set-pure-auto')?.addEventListener('click', () =>
        update({ pureAutoCombat: !isPureAutoCombat(current) })
      );
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
          btn.textContent = '再次点击确认重置';
          return;
        }
        modal.close();
        options.onResetV2Save();
      });
      body.querySelector('#v2-btn-export-playtest-log')?.addEventListener('click', () => {
        options.playtestTelemetry?.onExport();
      });
      body.querySelector('#v2-btn-clear-playtest-log')?.addEventListener('click', () => {
        options.playtestTelemetry?.onClear?.();
      });
      body.querySelector('#v2-set-done')?.addEventListener('click', () => modal.close());
    };

    renderBody();
  });
}

export function openV2WarehouseModal(
  host: HTMLElement,
  getProfile: () => V2ProfileState,
  options: V3WorkshopModalOptions
): void {
  openV3WorkshopModal(host, getProfile, options);
}

export function openV2CodexModal(host: HTMLElement, profile: V2ProfileState): void {
  const eqList = Object.values(V2_EQUIPMENT_DEFS);
  const cargoList = Object.values(V2_CARGO_DEFS);
  const gadgetList = Object.values(V3_GADGET_DEFS);
  const allDefs = [...eqList, ...gadgetList, ...cargoList];
  const discovered = new Set(profile.discoveredItems);
  const seen = new Set([...profile.seenItems, ...profile.discoveredItems]);

  const discoveredCount = allDefs.filter((d) => discovered.has(d.defId)).length;
  const seenOnlyCount = allDefs.filter((d) => !discovered.has(d.defId) && seen.has(d.defId)).length;
  const unknownCount = allDefs.length - discoveredCount - seenOnlyCount;
  const pct = allDefs.length > 0 ? Math.round((discoveredCount / allDefs.length) * 100) : 0;

  openTitledV2Modal(
    host,
    {
      title: `装备、装置与货物图鉴 (${discoveredCount}/${allDefs.length} · ${pct}%)`,
      dismissible: true,
    },
    (body) => {
      body.innerHTML = `
        <div class="v2-wh-summary">
          <span>已获得 <strong>${discoveredCount}/${allDefs.length}</strong> (${pct}%)</span>
          <span>已见闻 <strong>${seenOnlyCount}</strong></span>
          <span>未发现 <strong>${unknownCount}</strong></span>
        </div>
        <div class="codex-grid">
          ${allDefs
            .map((d) => {
              const isFound = discovered.has(d.defId);
              const isSeen = !isFound && seen.has(d.defId);
              const state: 'found' | 'seen' | 'locked' = isFound
                ? 'found'
                : isSeen
                ? 'seen'
                : 'locked';
              const isEq = d.defId.startsWith('equipment.');
              const isGadget = d.defId.startsWith('gadget.');
              const isMission = d.defId.startsWith('mission.');
              const cargoDef = V2_CARGO_DEFS[d.defId];
              const categoryLabel = isEq
                ? d.defId.endsWith('.improved')
                  ? '优良设备'
                  : '普通设备'
                : isGadget
                ? '战术消耗装置'
                : isMission
                ? '任务物资'
                : cargoDef?.isCollectible
                ? '珍稀藏品'
                : '普通货物';
              const displayName =
                state === 'locked'
                  ? isEq
                    ? '未发现模块'
                    : isGadget
                    ? '未发现装置'
                    : isMission
                    ? '未知任务物资'
                    : '未知货物'
                  : d.name;
              const stateBadge =
                state === 'found'
                  ? '<span class="v3-codex-state found">已获得</span>'
                  : state === 'seen'
                  ? '<span class="v3-codex-state seen">已见闻</span>'
                  : '<span class="v3-codex-state locked">未发现</span>';
              const desc =
                state === 'found'
                  ? d.summary
                  : state === 'seen'
                  ? '曾在航路中目击 · 安全带回或完成交付后解锁完整档案'
                  : '尚未在航路中发现';
              const iconClass =
                state === 'found'
                  ? 'codex-icon'
                  : state === 'seen'
                  ? 'codex-icon is-seen'
                  : 'codex-icon is-locked';

              return `<div class="codex-card ${state}" data-codex-state="${state}" data-def-id="${d.defId}">
                <img class="${iconClass}" src="${getItemImageUrl(d.defId)}" alt="${displayName}" />
                <div class="codex-meta">
                  <div class="codex-name-row">
                    <span class="codex-name">${displayName}</span>
                    ${stateBadge}
                  </div>
                  <div class="codex-sub">${renderV2MiniMaskHtml(d.shapeId)} ${V2_SHAPES[d.shapeId].label} · ${categoryLabel}</div>
                  <div class="codex-desc">${desc}</div>
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
  openTitledV2Modal(host, { title: '星际藏品展馆 (4 件稀世遗物 · 修复激活全局被动)', dismissible: true }, (body) => {
    const renderBody = () => {
      const profile = getProfile();
      const sum = getV2RelicSummary(profile);
      body.innerHTML = `
        <div class="v2-wh-summary">
          <span>已修复陈列：<strong class="num">${sum.restoredCount}/${sum.totalCount}</strong></span>
          <span>库藏待修：<strong class="num">${sum.storedTotal}</strong></span>
          <span>当前信用点：<strong class="num">${profile.credits}¤</strong></span>
        </div>
        ${msg ? `<div class="system-banner banner-warn" style="margin:8px 0;">${msg}</div>` : ''}
        <div class="relic-gallery-grid">
          ${V2_RELIC_ORDER.map((rid) => {
            const def = V2_RELICS[rid];
            const passive = V3_RELIC_PASSIVES[rid];
            const st = profile.relics[rid] ?? { storedCount: 0, restored: false };
            const check = canRestoreV2Relic(profile, rid);
            const itemDefId = `cargo.${rid}`;
            return `<div class="relic-card ${st.restored ? 'restored' : ''}" data-relic-id="${rid}">
              <img class="relic-thumb" src="${getItemImageUrl(itemDefId)}" alt="${def.name}" />
              <div class="relic-info">
                <div class="relic-title">${def.name} ${
              st.restored
                ? '<span class="v2-bp-badge unlocked">展台陈列 · 被动激活</span>'
                : '<span class="v2-bp-badge locked">修复后激活被动</span>'
            }</div>
                <div class="relic-lore">${def.lore}</div>
                ${
                  passive
                    ? `<div class="v3-relic-passive-line ${st.restored ? 'active' : ''}">${svgIcon('bolt', 12)} ${passive.effectText}</div>`
                    : ''
                }
                <div class="relic-status">库藏实物：${st.storedCount} · 修复费用：${def.restoreCost}¤</div>
              </div>
              <div>
                ${
                  st.restored
                    ? `<span style="color:var(--accent-energy);font-size:12px;font-weight:700;">已修复</span>`
                    : `<button type="button" class="btn btn-sm btn-primary" data-restore-relic="${rid}" data-testid="btn-restore-relic-${rid}" ${
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
          msg = res.ok ? '藏品修复成功！已陈列至拆解站主展台并激活常驻被动。' : res.error ?? '修复失败';
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
          ? `<div class="system-banner banner-danger" style="margin-bottom:10px;">注意：包含<strong>自有设备或任务物品</strong>，永久舍弃后将无法找回或交付！</div>`
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
  openTitledV2Modal(host, { title: '存档异常保护', dismissible: false }, (body, modal) => {
    body.innerHTML = `
      <div class="system-banner banner-danger" style="margin-bottom:10px;">
        检测到主存档校验失败（${params.error}）。系统已阻止静默清空，请选择恢复方式：
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:12px;">
        ${
          params.hasBackup && params.onRestoreBackup
            ? `<button type="button" class="btn btn-primary" id="v2-rec-backup">恢复上一份完好备份</button>`
            : ''
        }
        <button type="button" class="btn btn-danger" id="v2-rec-fresh">放弃损坏主档，新建进度</button>
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
  openTitledV2Modal(host, { title: '发现经典版旧档 · 安全导入向导', dismissible: true }, (body, modal) => {
    const totalEstimated =
      inspection.baseCredits + (inspection.activeRunPreview?.estimatedCredits ?? 0);
    body.innerHTML = `
      <p style="margin:0 0 10px 0;font-size:13px;color:var(--text-secondary);">
        检测到浏览器中存有 <strong>《星际拆解站》经典版</strong> 存档。导入过程<strong>不会覆盖或删除</strong>旧版存档，随时可在设置中切回经典模式。
      </p>
      ${
        !inspection.v1Valid
          ? `<div class="system-banner banner-danger">旧版存档读取异常（${inspection.v1Error ?? '格式错误'}），建议切回经典模式检查或直接新建远航进度。</div>`
          : `<div class="v2-mig-preview-card">
              <div class="v2-mig-row"><span>基地原有信用点</span><strong class="num">${inspection.baseCredits}¤</strong></div>
              <div class="v2-mig-row"><span>保留藏品馆进度（4 件全兼容）</span><strong>已修复 ${inspection.relicsSummary.restored} · 库藏 ${inspection.relicsSummary.stored}</strong></div>
              <div class="v2-mig-row"><span>免费启用</span><strong>委托终端 + 4 项基础普通蓝图</strong></div>
              ${
                inspection.activeRunPreview
                  ? `<div class="v2-mig-active-run">
                      <strong>检测到进行中的经典航次：</strong>
                      <div>${inspection.activeRunPreview.summaryText}</div>
                    </div>`
                  : ''
              }
              <div class="v2-mig-row total"><span>导入后预计初始信用点</span><strong class="num">${totalEstimated}¤</strong></div>
            </div>`
      }
      <div class="v2-mig-actions">
        <button type="button" class="btn btn-secondary" id="v2-mig-v1">继续体验经典版</button>
        <button type="button" class="btn btn-ghost" id="v2-mig-fresh">暂不导入，全新开始</button>
        ${
          inspection.v1Valid
            ? `<button type="button" class="btn btn-primary" id="v2-mig-go">确认导入（保留旧档）</button>`
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
