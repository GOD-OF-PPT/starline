import { getItemImageUrl } from '../assets/itemArt';
import { RELICS, RELIC_ORDER } from '../data/buildings';
import { CARGO_DEFINITIONS, EQUIPMENT_DEFINITIONS, getItemDef } from '../data/items';
import { SHAPES } from '../data/shapes';
import type { DiscardedRecord } from '../domain/inventory';
import {
  canRestoreRelic,
  getCodexSummary,
  getRelicCollectionSummary,
  type BaseProgression,
  type GameSettings,
} from '../domain/progression';
import { renderMiniMaskHtml } from './CargoGrid';

interface ActiveModalEntry {
  readonly backdrop: HTMLElement;
  readonly card: HTMLElement;
  readonly dismissible: boolean;
  readonly opener: HTMLElement | null;
  readonly close: () => void;
}

const modalStack: ActiveModalEntry[] = [];
let appBackgroundEls: HTMLElement[] = [];
let globalKeyListenerAttached = false;

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function registerModalBackgroundRoot(el: HTMLElement | HTMLElement[]): void {
  appBackgroundEls = Array.isArray(el) ? el : [el];
}

export function hasOpenModal(): boolean {
  return modalStack.length > 0;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement
  );
}

function syncBackgroundInert(): void {
  const modalLocked = modalStack.length > 0;
  for (const el of appBackgroundEls) {
    const locked = modalLocked || el.dataset.titleLocked === '1';
    if ('inert' in el) {
      (el as HTMLElement & { inert: boolean }).inert = locked;
    }
    if (locked) {
      el.setAttribute('aria-hidden', 'true');
    } else {
      el.removeAttribute('aria-hidden');
    }
  }
}

function handleGlobalModalKeyDown(e: KeyboardEvent): void {
  if (modalStack.length === 0) return;
  const top = modalStack[modalStack.length - 1];

  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (top.dismissible) {
      top.close();
    }
    return;
  }

  if (e.key === 'Tab') {
    const focusables = getFocusableElements(top.card);
    if (focusables.length === 0) {
      e.preventDefault();
      top.card.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;

    if (e.shiftKey) {
      if (!active || active === first || !top.card.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (!active || active === last || !top.card.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
    return;
  }

  // Isolate background shortcuts (e.g. R, Arrows, Space, Enter) from leaking outside the modal
  if (!top.card.contains(e.target as Node)) {
    e.stopPropagation();
  }
}

function ensureGlobalKeyListener(): void {
  if (globalKeyListenerAttached || typeof window === 'undefined') return;
  // Capture phase ensures modal handles Escape/Tab before ANY game/grid key listeners
  window.addEventListener('keydown', handleGlobalModalKeyDown, true);
  globalKeyListenerAttached = true;
}

export interface ManagedModalHandle {
  readonly backdrop: HTMLElement;
  readonly card: HTMLElement;
  readonly close: () => void;
}

/**
 * Mounts an accessible modal dialog with full input isolation, focus trapping, Escape close,
 * and automatic focus restoration to the invoking control (F01).
 */
export function openManagedModal(
  host: HTMLElement,
  options: {
    readonly titleId: string;
    readonly dismissible?: boolean;
    readonly onClose?: () => void;
  }
): ManagedModalHandle {
  ensureGlobalKeyListener();
  const dismissible = options.dismissible ?? true;
  const opener =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const card = document.createElement('div');
  card.className = 'modal-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', options.titleId);
  card.tabIndex = -1;

  backdrop.appendChild(card);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    const idx = modalStack.findIndex((m) => m.backdrop === backdrop);
    if (idx >= 0) {
      modalStack.splice(idx, 1);
    }
    backdrop.remove();
    syncBackgroundInert();
    options.onClose?.();

    // Restore focus to previous modal or original opener
    if (modalStack.length > 0) {
      const prevTop = modalStack[modalStack.length - 1];
      prevTop.card.focus();
    } else if (opener && document.body.contains(opener) && !opener.hasAttribute('disabled')) {
      opener.focus();
    }
  };

  if (dismissible) {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        close();
      }
    });
  }

  modalStack.push({ backdrop, card, dismissible, opener, close });
  host.appendChild(backdrop);
  syncBackgroundInert();

  // Defer initial focus until caller finishes populating card DOM; focus the dialog card container
  // rather than the header Close button so Space/Enter cannot accidentally dismiss the dialog.
  queueMicrotask(() => {
    if (closed) return;
    card.focus();
  });

  return { backdrop, card, close };
}

export function openCodexModal(
  host: HTMLElement,
  progression: BaseProgression,
  onClose?: () => void
): ManagedModalHandle {
  const modal = openManagedModal(host, {
    titleId: 'modal-title-codex',
    dismissible: true,
    onClose,
  });
  const summary = getCodexSummary(progression);
  const discovered = new Set(progression.discoveredItems);

  modal.card.innerHTML = `
    <div class="panel-header">
      <div>
        <h2 class="panel-title" id="modal-title-codex">站内图鉴与设备档案</h2>
        <p class="panel-subtitle">
          完成度 ${summary.completionPercent}% · 设备 ${summary.equipmentDiscovered}/${summary.equipmentTotal} ·
          货物 ${summary.cargoDiscovered}/${summary.cargoTotal} · 修复藏品 ${summary.relicsRestored}/${summary.relicsTotal}
        </p>
      </div>
      <button type="button" class="btn btn-compact" id="btn-close-codex">关闭</button>
    </div>

    <div style="font-size:13px;font-weight:700;color:var(--accent-energy);">设备档案 (${summary.equipmentDiscovered}/${summary.equipmentTotal})</div>
    <div class="codex-grid">
      ${Object.values(EQUIPMENT_DEFINITIONS)
        .map((eq) => {
          const found = discovered.has(eq.defId);
          return `
            <div class="codex-card ${found ? '' : 'undiscovered'}">
              <div class="codex-card-img">
                <img src="${getItemImageUrl(eq.defId)}" alt="${eq.name}" style="${
            found ? '' : 'filter:brightness(0.25) grayscale(1);'
          }"/>
              </div>
              <div style="display:flex;align-items:center;justify-content:space-between;gap:4px;">
                <strong>${found ? eq.name : '未发现设备'}</strong>
                <span class="tag ${eq.quality === 'improved' ? 'tag-energy' : ''}">${
            eq.quality === 'improved' ? '‖ 优良' : '| 普通'
          }</span>
              </div>
              <div style="display:flex;align-items:center;justify-content:space-between;color:var(--text-secondary);">
                <span>${found ? eq.summary : SHAPES[eq.shapeId].label}</span>
                ${renderMiniMaskHtml(eq.defId)}
              </div>
              ${found ? `<div style="color:var(--text-secondary);">回收 ${eq.recycleValue} 信用点</div>` : ''}
            </div>
          `;
        })
        .join('')}
    </div>

    <div style="font-size:13px;font-weight:700;color:var(--accent-action);margin-top:4px;">打捞货物 (${summary.cargoDiscovered}/${summary.cargoTotal})</div>
    <div class="codex-grid">
      ${Object.values(CARGO_DEFINITIONS)
        .map((cg) => {
          const found = discovered.has(cg.defId);
          return `
            <div class="codex-card ${found ? '' : 'undiscovered'}">
              <div class="codex-card-img">
                <img src="${getItemImageUrl(cg.defId)}" alt="${cg.name}" style="${
            found ? '' : 'filter:brightness(0.25) grayscale(1);'
          }"/>
              </div>
              <div style="display:flex;align-items:center;justify-content:space-between;gap:4px;">
                <strong>${found ? cg.name : '未发现货物'}</strong>
                ${cg.isCollectible ? '<span class="tag tag-amber">可收藏</span>' : ''}
              </div>
              <div style="display:flex;align-items:center;justify-content:space-between;color:var(--text-secondary);">
                <span>${found ? cg.summary : SHAPES[cg.shapeId].label}</span>
                ${renderMiniMaskHtml(cg.defId)}
              </div>
            </div>
          `;
        })
        .join('')}
    </div>

    <div style="font-size:13px;font-weight:700;color:var(--accent-action);margin-top:4px;">展台藏品 (${summary.relicsRestored}/${summary.relicsTotal})</div>
    ${RELIC_ORDER.map((rid) => RELICS[rid])
      .map((relic) => {
        const st = progression.relics[relic.id] ?? { storedCount: 0, restored: false };
        const seen = discovered.has(relic.cargoDefId);
        return `
          <div class="facility-card ${st.restored ? 'built' : ''}">
            <div style="display:flex;align-items:center;gap:10px;min-width:0;">
              <img class="relic-codex-thumb ${st.restored || seen ? '' : 'dim'}" src="${getItemImageUrl(relic.cargoDefId)}" alt="${relic.name}" />
              <div class="facility-info">
                <div class="facility-name-row">
                  <span>${relic.name}</span>
                  <span class="tag ${st.restored ? 'tag-energy' : st.storedCount > 0 ? 'tag-amber' : ''}">
                    ${st.restored ? '已修复展示' : st.storedCount > 0 ? `已入库 ${st.storedCount} 件` : seen ? '已发现（未带回实物）' : '未发现'}
                  </span>
                </div>
                <div style="font-size:12px;color:var(--text-secondary);">${st.restored ? relic.lore : relic.description}</div>
              </div>
            </div>
          </div>
        `;
      })
      .join('')}
  `;

  modal.card.querySelector('#btn-close-codex')?.addEventListener('click', modal.close);
  return modal;
}

export function openRelicGalleryModal(
  host: HTMLElement,
  initialProgression: BaseProgression,
  readOnly: boolean,
  onRestoreRelic: (relicId: string) => BaseProgression | null,
  onClose?: () => void
): ManagedModalHandle {
  const modal = openManagedModal(host, {
    titleId: 'modal-title-relic-gallery',
    dismissible: true,
    onClose,
  });

  const renderGallery = (prog: BaseProgression, focusId?: string) => {
    const sum = getRelicCollectionSummary(prog);
    const discovered = new Set(prog.discoveredItems);

    modal.card.innerHTML = `
      <div class="panel-header">
        <div>
          <h2 class="panel-title" id="modal-title-relic-gallery">星际藏品陈列馆 (${sum.restoredCount}/${sum.totalCount})</h2>
          <p class="panel-subtitle">安全返航留存稀有废宝即可入库修复，永久点亮拆解站玻璃展台。</p>
        </div>
        <button type="button" class="btn btn-compact" id="btn-close-relic-gallery">关闭</button>
      </div>

      ${
        readOnly
          ? `<div class="system-banner banner-warn"><span>当前处于只读模式，请先接管控制权再修复藏品。</span></div>`
          : ''
      }

      <div class="relic-gallery-grid">
        ${RELIC_ORDER.map((rid) => {
          const def = RELICS[rid];
          const cargoDef = getItemDef(def.cargoDefId);
          const st = prog.relics[rid] ?? { storedCount: 0, restored: false };
          const check = canRestoreRelic(prog, rid);
          const canDo = check.canRestore && !readOnly;
          const seen = discovered.has(def.cargoDefId) || st.storedCount > 0 || st.restored;

          return `
            <div class="relic-showcase-card ${st.restored ? 'restored' : canDo ? 'affordable' : ''}" style="--relic-accent:${def.accentColor};">
              <div class="relic-showcase-art">
                <img src="${getItemImageUrl(def.cargoDefId)}" alt="${def.name}" class="${st.restored || seen ? '' : 'silhouette'}" />
              </div>
              <div class="relic-showcase-head">
                <strong>${def.name}</strong>
                <span class="tag ${st.restored ? 'tag-energy' : st.storedCount > 0 ? 'tag-amber' : ''}">
                  ${st.restored ? '展示中 ✦' : st.storedCount > 0 ? `库存 ${st.storedCount}` : SHAPES[cargoDef.shapeId].label}
                </span>
              </div>
              <p class="relic-showcase-desc">${st.restored ? def.lore : def.description}</p>
              ${
                st.restored
                  ? `<div class="relic-showcase-foot"><span class="tag tag-energy">已点亮展柜 ✓</span></div>`
                  : `<div class="relic-showcase-foot">
                      <button type="button" class="btn ${canDo ? 'btn-primary' : ''} btn-compact" id="btn-restore-relic-${rid}" data-restore-relic="${rid}" ${
                        canDo ? '' : 'disabled'
                      }>
                        ${
                          readOnly
                            ? '只读锁定'
                            : st.storedCount <= 0
                            ? '待深空打捞'
                            : `${def.restoreCost}¤ 修复展示`
                        }
                      </button>
                    </div>`
              }
            </div>
          `;
        }).join('')}
      </div>
    `;

    modal.card.querySelector('#btn-close-relic-gallery')?.addEventListener('click', modal.close);
    modal.card.querySelectorAll<HTMLButtonElement>('[data-restore-relic]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rid = btn.dataset.restoreRelic!;
        const updated = onRestoreRelic(rid);
        if (updated) {
          renderGallery(updated, 'btn-close-relic-gallery');
        }
      });
    });

    if (focusId) {
      modal.card.querySelector<HTMLElement>(`#${focusId}`)?.focus();
    }
  };

  renderGallery(initialProgression);
  return modal;
}

export function openHelpModal(host: HTMLElement, onClose?: () => void): ManagedModalHandle {
  const modal = openManagedModal(host, {
    titleId: 'modal-title-help',
    dismissible: true,
    onClose,
  });

  modal.card.innerHTML = `
    <div class="panel-header">
      <h2 class="panel-title" id="modal-title-help">操作与规则图示说明</h2>
      <button type="button" class="btn btn-compact" id="btn-close-help">关闭</button>
    </div>

    <div class="inspector-card">
      <strong>1. 4×4 船舱拼装（无倒计时 · 支持触控/鼠标/纯键盘）</strong>
      <div style="font-size:13px;color:var(--text-secondary);">
        • <strong>拖拽 / 点选</strong>：拖入船舱，或点选物品再点空位摆放；点击已选物品旋转 90°。<br/>
        • <strong>纯键盘操作</strong>：用 <code>Tab</code> 进入暂存区或 4×4 棋盘，方向键移动焦点格，<code>Enter</code>/<code>Space</code> 选中或放入，<code>R</code> 旋转，<code>Esc</code> 取消选中或关闭弹层。<br/>
        • 选中奖励先入暂存区（不加属性、不计估值）；离开整理前若有舍弃物品会弹出清单确认。
      </div>
    </div>

    <div class="inspector-card">
      <strong>2. 四类设备协同</strong>
      <div style="font-size:13px;color:var(--text-secondary);">
        • <strong>激光炮 (1×2)</strong>：直接增加攻击（普通 +3 / 优良 +5），所有炮叠加。<br/>
        • <strong>能量电池 (1×1)</strong>：正交贴邻（上下左右，斜角不算）给每门炮 +2 / +3 攻击；同一门炮仅取相邻电池最高值，一块电池可服务多门炮。<br/>
        • <strong>护盾板 (1×2)</strong>：每战重新生成 +6 / +9 护盾，总上限 18。<br/>
        • <strong>维修无人机 (L形)</strong>：获胜后回复 +2 / +3 耐久，每战上限 4（战败不触发）。
      </div>
    </div>

    <div class="inspector-card">
      <strong>3. 同步交火与返航决策</strong>
      <div style="font-size:13px;color:var(--text-secondary);">
        • 路线选择前公开敌舰耐久、每轮伤害、预计战后耐久与奖励范围。<br/>
        • 每轮双方同时造成固定伤害；先扣护盾再扣耐久；<strong>同归于尽判失败</strong>。<br/>
        • 每趟最多 6 个节点。任意整理阶段可免费<strong>安全返航</strong>；完成第 6 节点整理确认后自动返航结算。战败保留 40% 折算，基地、建筑与图鉴记录不受影响。
      </div>
    </div>
  `;

  modal.card.querySelector('#btn-close-help')?.addEventListener('click', modal.close);
  return modal;
}

export function openSettingsModal(
  host: HTMLElement,
  settings: GameSettings,
  readOnly: boolean,
  onUpdate: (next: GameSettings) => void,
  onResetSave: () => void,
  onClose?: () => void
): ManagedModalHandle {
  const modal = openManagedModal(host, {
    titleId: 'modal-title-settings',
    dismissible: true,
    onClose,
  });

  const renderContent = (cur: GameSettings, focusId?: string) => {
    modal.card.innerHTML = `
      <div class="panel-header">
        <h2 class="panel-title" id="modal-title-settings">系统设置</h2>
        <button type="button" class="btn btn-compact" id="btn-close-settings">关闭</button>
      </div>

      ${
        readOnly
          ? `<div class="system-banner banner-warn"><span>当前处于只读模式，请先接管控制权再修改保存设置或重置存档。</span></div>`
          : ''
      }

      <div class="setting-row">
        <div>
          <div style="font-weight:700;">战斗播放速度</div>
          <div style="font-size:12px;color:var(--text-secondary);">仅改变演出节奏，不改变任何战斗结果</div>
        </div>
        <button type="button" class="btn btn-compact ${cur.combatSpeed === 2 ? 'btn-energy' : ''}" id="set-speed" ${
          readOnly ? 'disabled' : ''
        }>
          ${cur.combatSpeed === 2 ? '2 倍速' : '1 倍速'}
        </button>
      </div>

      <div class="setting-row">
        <div>
          <div style="font-weight:700;">减少动效（低动效模式）</div>
          <div style="font-size:12px;color:var(--text-secondary);">关闭微震、粒子与漂浮，保留全部状态变化</div>
        </div>
        <button type="button" class="btn btn-compact ${cur.reducedMotion ? 'btn-energy' : ''}" id="set-motion" ${
          readOnly ? 'disabled' : ''
        }>
          ${cur.reducedMotion ? '已开启' : '已关闭'}
        </button>
      </div>

      <div class="setting-row">
        <div>
          <div style="font-weight:700;">低画质模式</div>
          <div style="font-size:12px;color:var(--text-secondary);">关闭阴影与装饰粒子，优先保证流畅度</div>
        </div>
        <button type="button" class="btn btn-compact ${cur.lowQuality ? 'btn-energy' : ''}" id="set-quality" ${
          readOnly ? 'disabled' : ''
        }>
          ${cur.lowQuality ? '已开启' : '已关闭'}
        </button>
      </div>

      <div class="setting-row">
        <div>
          <div style="font-weight:700;">音效 (SFX)</div>
          <div style="font-size:12px;color:var(--text-secondary);">静音时全部规则与状态仍清晰可读</div>
        </div>
        <button type="button" class="btn btn-compact ${!cur.sfxMuted ? 'btn-energy' : ''}" id="set-sfx" ${
          readOnly ? 'disabled' : ''
        }>
          ${cur.sfxMuted ? '已静音' : '已开启'}
        </button>
      </div>

      <div class="setting-row">
        <div>
          <div style="font-weight:700;">环境音乐 (BGM)</div>
          <div style="font-size:12px;color:var(--text-secondary);">基地与出航循环背景音</div>
        </div>
        <button type="button" class="btn btn-compact ${!cur.bgmMuted ? 'btn-energy' : ''}" id="set-bgm" ${
          readOnly ? 'disabled' : ''
        }>
          ${cur.bgmMuted ? '已静音' : '已开启'}
        </button>
      </div>

      <div class="setting-row" style="border-color:rgba(242,117,100,0.45);">
        <div>
          <div style="font-weight:700;color:var(--state-danger);">重置本地存档</div>
          <div style="font-size:12px;color:var(--text-secondary);">清空基地进度、图鉴与当前航次并重新开始教学</div>
        </div>
        <button type="button" class="btn btn-danger btn-compact" id="set-reset" ${readOnly ? 'disabled' : ''}>重置存档</button>
      </div>
    `;

    modal.card.querySelector('#btn-close-settings')?.addEventListener('click', modal.close);
    if (!readOnly) {
      modal.card.querySelector('#set-speed')?.addEventListener('click', () => {
        const next: GameSettings = { ...cur, combatSpeed: cur.combatSpeed === 1 ? 2 : 1 };
        onUpdate(next);
        renderContent(next, 'set-speed');
      });
      modal.card.querySelector('#set-motion')?.addEventListener('click', () => {
        const next: GameSettings = { ...cur, reducedMotion: !cur.reducedMotion };
        onUpdate(next);
        renderContent(next, 'set-motion');
      });
      modal.card.querySelector('#set-quality')?.addEventListener('click', () => {
        const next: GameSettings = { ...cur, lowQuality: !cur.lowQuality };
        onUpdate(next);
        renderContent(next, 'set-quality');
      });
      modal.card.querySelector('#set-sfx')?.addEventListener('click', () => {
        const next: GameSettings = { ...cur, sfxMuted: !cur.sfxMuted };
        onUpdate(next);
        renderContent(next, 'set-sfx');
      });
      modal.card.querySelector('#set-bgm')?.addEventListener('click', () => {
        const next: GameSettings = { ...cur, bgmMuted: !cur.bgmMuted };
        onUpdate(next);
        renderContent(next, 'set-bgm');
      });

      let confirmReset = false;
      const resetBtn = modal.card.querySelector<HTMLButtonElement>('#set-reset');
      resetBtn?.addEventListener('click', () => {
        if (!confirmReset) {
          confirmReset = true;
          resetBtn.textContent = '再点一次确认清空';
        } else {
          onResetSave();
          modal.close();
        }
      });
    }

    if (focusId) {
      modal.card.querySelector<HTMLElement>(`#${focusId}`)?.focus();
    }
  };

  renderContent(settings);
  return modal;
}

export function openDiscardConfirmModal(
  host: HTMLElement,
  discards: readonly DiscardedRecord[],
  exitLabel: string,
  onConfirm: () => void,
  onCancel?: () => void
): ManagedModalHandle {
  const modal = openManagedModal(host, {
    titleId: 'modal-title-discard',
    dismissible: true,
    onClose: onCancel,
  });

  // Group identical defId + borrowed + value entries cleanly while showing accurate count and total loss
  const totalValue = discards.reduce((sum, d) => sum + (d.item.isBorrowed ? 0 : d.item.value), 0);

  modal.card.innerHTML = `
    <div class="panel-header">
      <div>
        <h2 class="panel-title" id="modal-title-discard" style="color:var(--accent-action);">确认舍弃清单（${discards.length} 件）</h2>
        <p class="panel-subtitle">离开整理阶段后以下物品将永久丢弃，无法再撤销。取消可返回继续整理或撤销舍弃。</p>
      </div>
    </div>

    <div class="settlement-list">
      ${discards
        .map((rec) => {
          const def = getItemDef(rec.item.defId);
          const qualityText =
            def.category === 'equipment' ? ` · ${def.qualityLabel}` : '';
          const valText = rec.item.isBorrowed
            ? '借用设备（无回收价）'
            : `估值 ${rec.item.value} 信用点`;
          return `
            <div class="settlement-row">
              <div style="display:flex;align-items:center;gap:8px;">
                <img src="${getItemImageUrl(rec.item.defId)}" alt="${def.name}" style="width:28px;height:28px;object-fit:contain;" />
                <div>
                  <strong>${def.name}</strong><span style="font-size:12px;color:var(--text-secondary);">${qualityText}</span>
                  ${def.category === 'cargo' && def.isCollectible ? '<span class="tag tag-amber" style="margin-left:6px;">稀有藏品</span>' : ''}
                </div>
              </div>
              <span class="num" style="font-size:13px;color:var(--state-danger);">${valText}</span>
            </div>
          `;
        })
        .join('')}
    </div>

    <div class="settlement-row" style="border-color:rgba(242,117,100,0.5);">
      <span>放弃估值合计（共 ${discards.length} 件）</span>
      <strong class="num" style="color:var(--state-danger);">${totalValue} 信用点</strong>
    </div>

    <div class="action-dock">
      <button type="button" class="btn btn-energy" id="btn-discard-cancel">返回整理（可撤销）</button>
      <button type="button" class="btn btn-danger" id="btn-discard-confirm">确认舍弃并${exitLabel}</button>
    </div>
  `;

  modal.card.querySelector('#btn-discard-cancel')?.addEventListener('click', () => {
    modal.close();
  });
  modal.card.querySelector('#btn-discard-confirm')?.addEventListener('click', () => {
    modal.close();
    onConfirm();
  });

  return modal;
}

export function openBackupRecoveryModal(
  host: HTMLElement,
  errorMsg: string,
  backupCredits: number,
  onRestore: () => void,
  onStartFresh: () => void
): ManagedModalHandle {
  const modal = openManagedModal(host, {
    titleId: 'modal-title-backup',
    dismissible: false,
  });

  modal.card.innerHTML = `
    <h2 class="panel-title" id="modal-title-backup" style="color:var(--accent-action);">检测到主存档异常</h2>
    <p class="panel-subtitle">主存档校验未通过（${errorMsg}），但系统保留了一份最近的有效备份（信用点：${backupCredits}）。</p>
    <div class="action-dock">
      <button type="button" class="btn btn-primary" id="btn-restore-backup">恢复最近备份</button>
      <button type="button" class="btn btn-danger" id="btn-reset-fresh">放弃并开新档</button>
    </div>
  `;
  modal.card.querySelector('#btn-restore-backup')?.addEventListener('click', () => {
    modal.close();
    onRestore();
  });
  modal.card.querySelector('#btn-reset-fresh')?.addEventListener('click', () => {
    modal.close();
    onStartFresh();
  });
  return modal;
}
