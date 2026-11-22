import { getItemImageUrl } from '../../assets/itemArt';
import type { GameSettings } from '../../domain/progression';
import { openManagedModal, type ManagedModalHandle } from '../../ui/Modals';
import { V2_CARGO_DEFS } from '../data/cargo';
import { V2_CONTRACT_TEMPLATES } from '../data/contracts';
import {
  V2_ALL_EQUIPMENT_KINDS,
  V2_EQUIPMENT_DEFS,
  V2_RESEARCH_COST_CREDITS,
  V2_WAREHOUSE_CAPACITY,
  getEffectiveV2EquipmentBudgetCost,
  getV2EquipmentDefByKind,
  type V2EquipmentKind,
} from '../data/equipment';
import {
  V2_FACILITIES,
  V2_FACILITY_ORDER,
  V2_RELICS,
  V2_RELIC_ORDER,
  type V2FacilityId,
} from '../data/facilities';
import { V2_SHAPES } from '../data/shapes';
import { V2_TRIAL_BUILD_ORDER, V2_TRIAL_BUILDS } from '../data/trialBuilds';
import { getAvailableContractBoard } from '../domain/contracts';
import { getAnyV2ItemDef } from '../domain/itemCatalog';
import type { V1MigrationInspection } from '../domain/migration';
import {
  canBuildV2Facility,
  canResearchV2Instance,
  canRestoreV2Relic,
  getV2RelicSummary,
} from '../domain/progressionV2';
import type {
  V2CargoBayState,
  V2DiscardedRecord,
  V2ProfileState,
  V2TrialBuildId,
} from '../domain/types';
import {
  CargoGridV2Component,
  originFullLabel,
  originTagText,
  renderV2MiniMaskHtml,
} from './CargoGridV2';
import { svgIcon } from './icons';

let v2ModalSeq = 1;

function openTitledV2Modal(
  host: HTMLElement,
  opts: { readonly title: string; readonly dismissible?: boolean; readonly onClose?: () => void },
  buildBody: (body: HTMLElement, modal: ManagedModalHandle) => void
): ManagedModalHandle {
  const titleId = `v2-modal-title-${v2ModalSeq++}`;
  const dismissible = opts.dismissible ?? true;
  const modal = openManagedModal(host, { titleId, dismissible, onClose: opts.onClose });

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
  options: {
    readonly readOnly: boolean;
    readonly onSelectContract: (templateId: string) => void;
    readonly onStartTutorial: () => void;
  }
): void {
  const board = getAvailableContractBoard(profile);

  const renderCard = (tplId: string, lockedReason?: string) => {
    const tpl = V2_CONTRACT_TEMPLATES[tplId];
    if (!tpl) return '';
    const completedBefore = profile.completedContractIds.includes(tpl.templateId);
    const isDeep = tpl.tier === 'deep';
    return `
      <div class="v2-contract-card ${isDeep ? 'tier-deep' : ''} ${lockedReason ? 'is-locked' : ''}">
        <div class="v2-contract-head">
          <span class="v2-contract-name">${tpl.name}</span>
          <span class="v2-contract-reward num">${
            tpl.rewardCredits > 0 ? `+${tpl.rewardCredits}¤` : '按货结算'
          }</span>
        </div>
        <div class="v2-contract-desc">${tpl.gameplayNote}</div>
        <div class="v2-contract-meta">
          <span>${tpl.spaceNote}</span>
          ${completedBefore ? '<span class="v2-done-chip">已达成</span>' : ''}
        </div>
        <div class="v2-contract-foot">
          ${
            lockedReason
              ? `<span class="v2-lock-note">${svgIcon('lock', 13)} ${lockedReason}</span>`
              : `<button type="button" class="btn btn-sm btn-primary" data-modal-contract="${tpl.templateId}" ${
                  options.readOnly ? 'disabled' : ''
                }>接取并整备</button>`
          }
        </div>
      </div>
    `;
  };

  openTitledV2Modal(
    host,
    { title: `委托终端（已完成 ${profile.completedContractTypes.length}/3 类标准合同）`, dismissible: true },
    (body, modal) => {
      body.innerHTML = `
        <div class="v2-contract-section-title">标准委托（第 1–4 层 · 首次完成解锁新体系与船员）</div>
        <div class="v2-contract-grid">
          ${board.standardTemplates.map((c) => renderCard(c.templateId)).join('')}
        </div>
        <div class="v2-contract-section-title">深入委托（第 5–6 层高危悬赏${
          board.deepUnlocked ? '' : ' · 完成任意 1 份标准委托解锁'
        }）</div>
        <div class="v2-contract-grid">
          ${board.deepTemplates
            .map((c) =>
              renderCard(c.templateId, board.deepUnlocked ? undefined : '需先完成任意 1 份标准委托')
            )
            .join('')}
        </div>
        <div class="v2-contract-section-title">自由航线与教学</div>
        <div class="v2-contract-grid">
          ${renderCard(board.freeTemplate.templateId)}
          <div class="v2-contract-card">
            <div class="v2-contract-head">
              <span class="v2-contract-name">首航教学航次</span>
              <span class="v2-contract-reward num">3 层示范</span>
            </div>
            <div class="v2-contract-desc">重温 2×3 密封反应堆装舱冲突、旋转拼装与免费安全返航。</div>
            <div class="v2-contract-foot">
              <button type="button" class="btn btn-sm btn-secondary" id="v2-modal-start-tut" ${
                options.readOnly ? 'disabled' : ''
              }>${profile.tutorialCompleted ? '重玩首航教学' : '启动首航教学'}</button>
            </div>
          </div>
        </div>
      `;

      body.querySelectorAll<HTMLButtonElement>('[data-modal-contract]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const tplId = btn.dataset.modalContract!;
          modal.close();
          options.onSelectContract(tplId);
        });
      });

      body.querySelector('#v2-modal-start-tut')?.addEventListener('click', () => {
        modal.close();
        options.onStartTutorial();
      });
    }
  );
}

export function openV2FacilitiesDrawerModal(
  host: HTMLElement,
  getProfile: () => V2ProfileState,
  options: {
    readonly readOnly: boolean;
    readonly onBuild: (fid: V2FacilityId) => { readonly ok: boolean; readonly error?: string };
  }
): void {
  let feedback: { readonly text: string; readonly isError: boolean } | null = null;
  openTitledV2Modal(host, { title: '空间站扩建与船坞设施', dismissible: true }, (body) => {
    const renderBody = () => {
      const p = getProfile();
      body.innerHTML = `
        <div class="v2-wh-summary">
          <span>当前信用点：<strong class="num">${p.credits}¤</strong></span>
          <span>已解锁舰船：<strong class="num">${p.unlockedShips.length}/3</strong></span>
          <span>船员名册：<strong class="num">${p.unlockedCrew.length}/3</strong></span>
        </div>
        ${
          feedback
            ? `<div class="system-banner ${
                feedback.isError ? 'banner-danger' : 'banner-warn'
              }" style="margin:8px 0;">${feedback.text}</div>`
            : ''
        }
        <div class="v2-facility-list">
          ${V2_FACILITY_ORDER.map((fid) => {
            const def = V2_FACILITIES[fid];
            const built = p.buildings[fid];
            const check = canBuildV2Facility(p, fid);
            return `<div class="v2-facility-card ${built ? 'built' : ''}">
              <div class="v2-fac-main">
                <div class="v2-fac-title">
                  <strong>${def.name}</strong>
                  <span class="v2-fac-badge ${built ? 'done' : ''}">${
              built ? '已启用' : def.cost === 0 ? '教学免费' : `${def.cost}¤`
            }</span>
                </div>
                <div class="v2-fac-desc">${def.effectSummary}</div>
                ${!built && check.reason ? `<div class="v2-fac-req">${check.reason}</div>` : ''}
              </div>
              <div class="v2-fac-act">
                ${
                  built
                    ? `<span class="v2-built-ok">运行中</span>`
                    : `<button type="button" class="btn btn-sm btn-primary" data-modal-build="${fid}" ${
                        options.readOnly || !check.canBuild ? 'disabled' : ''
                      }>${def.cost === 0 ? '首航解锁' : `建造 ${def.cost}¤`}</button>`
                }
              </div>
            </div>`;
          }).join('')}
        </div>
      `;

      body.querySelectorAll<HTMLButtonElement>('[data-modal-build]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const fid = btn.dataset.modalBuild as V2FacilityId;
          const res = options.onBuild(fid);
          feedback = res.ok
            ? { text: `「${V2_FACILITIES[fid].name}」已建成启用！`, isError: false }
            : { text: res.error ?? '无法建造', isError: true };
          renderBody();
        });
      });
    };
    renderBody();
  });
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
        <h3>二、三种主要打法与邻接联动</h3>
        <ul>
          <li><strong>重炮破甲</strong>：单发高伤击穿重甲；贴邻<strong>蓄能器</strong>抢占第 1、3、5 轮先手开火。</li>
          <li><strong>无人机编队</strong>：机库每轮自动扩编可数无人机群；贴邻<strong>编队中继</strong>将上限升至 4 架。</li>
          <li><strong>护盾反击</strong>：厚盾吸收敌弹后，贴邻<strong>反击器</strong>按实吸护盾比例劈出反击电弧（穿盾伤害不计入吸收）。</li>
        </ul>
      </div>
      <div class="help-section">
        <h3>三、物品来源标记</h3>
        <ul>
          <li><span class="v2-origin-chip origin-loan">借</span> 借用设备：出航免费借用，返航自动归还，不可售卖或入库。</li>
          <li><span class="v2-origin-chip origin-owned">自</span> 自有设备：来自基地设备库，普通自有件出航预算 -1（最低 1），战败将损失实物，安全返航可回库或出售。</li>
          <li><span class="v2-origin-chip origin-loot">拾</span> 拾获物品：途中获取，可向商人折价变卖或返航后出售/入库研究。</li>
          <li><span class="v2-origin-chip origin-mission">任</span> 任务物品：仅用于完成委托交付，不可出售或入库。</li>
        </ul>
      </div>
      <div class="help-section">
        <h3>四、键盘与触控</h3>
        <p>船舱整理支持拖拽、点选与键盘操作：<kbd>↑↓←→</kbd> 移格、<kbd>Enter</kbd>/<kbd>Space</kbd> 拿放、<kbd>R</kbd> 旋转、<kbd>Delete</kbd> 舍弃、<kbd>Esc</kbd> 关闭弹层。</p>
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
  openTitledV2Modal(host, { title: '游戏设置', dismissible: true }, (body, modal) => {
    const renderBody = () => {
      const eliteTacticOn = Boolean(current.eliteTacticExperiment);
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
              <div class="setting-label">精英战第 2 回合战术抉择（实验）</div>
              <div class="setting-sub">开启后仅在精英战第 2 回合暂停一次，可在正常/火力过载/紧急防御间抉择</div>
            </div>
            <button type="button" class="btn btn-sm ${
              eliteTacticOn ? 'btn-primary' : 'btn-secondary'
            }" id="v2-set-elite-tactic">${eliteTacticOn ? '已开启' : '纯自动'}</button>
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
      body.querySelector('#v2-set-elite-tactic')?.addEventListener('click', () =>
        update({ eliteTacticExperiment: !current.eliteTacticExperiment })
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
              <div class="v2-section-mini-title">${svgIcon('crate', 14)} 待领取赠品队列 (${profile.pendingGiftQueue.length})</div>
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
                        <div class="v2-wh-sub">回收价 ${g.fixedValue}¤ · 满库时暂存于此不会丢失</div>
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
          <span>研究台：<strong>${hasLab ? '已建成' : '未建成（需 100¤）'}</strong></span>
        </div>
        ${
          profile.equipmentWarehouse.length === 0
            ? `<div class="v2-empty-hint">设备库当前为空。安全返航时可将拾获设备选为「入库」，或前往蓝图页制造自有设备。</div>`
            : `<div class="v2-wh-list">
                ${profile.equipmentWarehouse
                  .map((item) => {
                    const def = V2_EQUIPMENT_DEFS[item.definitionId];
                    const resCheck = canResearchV2Instance(profile, item.instanceId);
                    const effBudget = def ? getEffectiveV2EquipmentBudgetCost(def, 'owned') : 0;
                    const discountTag =
                      def && effBudget < def.budgetCost ? '（自有-1）' : '';
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
                          def
                            ? `${V2_SHAPES[def.shapeId].label} · 出航预算 ${effBudget}${discountTag} · 回收 ${item.fixedValue}¤`
                            : ''
                        }${
                          resCheck.canResearch && resCheck.isImproved
                            ? ' · 注意：研究优良件仅解锁普通蓝图'
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
          <span>永久蓝图：<strong class="num">${profile.blueprints.length}/${V2_ALL_EQUIPMENT_KINDS.length}</strong></span>
          <span>当前信用点：<strong class="num">${profile.credits}¤</strong></span>
        </div>
        <div class="v2-empty-hint" style="margin-bottom:8px;">
          解锁永久蓝图后，可自由混搭、保存配装预设，或在此制造自有普通设备入库（<strong>出航预算 -1，最低 1</strong>，提升上限但战败损失实物）。优良品质设备仅可通过远航打捞或商人获得。
        </div>
        <div class="v2-wh-list">
          ${V2_ALL_EQUIPMENT_KINDS.map((kind) => {
            const def = getV2EquipmentDefByKind(kind, 'common');
            const ownedBudget = getEffectiveV2EquipmentBudgetCost(def, 'owned');
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
              unlocked ? '已掌握' : '待研究'
            }</span>
                </div>
                <div class="v2-wh-sub">${renderV2MiniMaskHtml(def.shapeId)} ${def.summary} · 借用预算 ${
              def.budgetCost
            }${ownedBudget < def.budgetCost ? ` → 自有预算 ${ownedBudget}` : ''}</div>
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
    { title: `装备与货物图鉴 (${count}/${allDefs.length})`, dismissible: true },
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
          <span>库藏待修：<strong class="num">${sum.storedTotal}</strong></span>
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
              st.restored ? '<span class="v2-bp-badge unlocked">展台陈列中</span>' : ''
            }</div>
                <div class="relic-lore">${def.lore}</div>
                <div class="relic-status">库藏实物：${st.storedCount} · 修复费用：${def.restoreCost}¤</div>
              </div>
              <div>
                ${
                  st.restored
                    ? `<span style="color:var(--accent-energy);font-size:12px;font-weight:700;">已修复</span>`
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
