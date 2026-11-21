import { getItemImageUrl } from '../assets/itemArt';
import { RELICS } from '../data/buildings';
import { CARGO_DEFINITIONS, EQUIPMENT_DEFINITIONS } from '../data/items';
import { SHAPES } from '../data/shapes';
import {
  getCodexSummary,
  type BaseProgression,
  type GameSettings,
} from '../domain/progression';
import { renderMiniMaskHtml } from './CargoGrid';

export function createModalBackdrop(onClose?: () => void): HTMLElement {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop && onClose) {
      onClose();
    }
  });
  return backdrop;
}

export function renderCodexModal(
  progression: BaseProgression,
  onClose: () => void
): HTMLElement {
  const backdrop = createModalBackdrop(onClose);
  const summary = getCodexSummary(progression);
  const discovered = new Set(progression.discoveredItems);

  const card = document.createElement('div');
  card.className = 'modal-card';
  card.innerHTML = `
    <div class="panel-header">
      <div>
        <h2 class="panel-title">站内图鉴与设备档案</h2>
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
    ${Object.values(RELICS)
      .map((relic) => {
        const st = progression.relics[relic.id] ?? { storedCount: 0, restored: false };
        const seen = discovered.has(relic.cargoDefId);
        return `
          <div class="facility-card ${st.restored ? 'built' : ''}">
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
        `;
      })
      .join('')}
  `;

  card.querySelector('#btn-close-codex')?.addEventListener('click', onClose);
  backdrop.appendChild(card);
  return backdrop;
}

export function renderHelpModal(onClose: () => void): HTMLElement {
  const backdrop = createModalBackdrop(onClose);
  const card = document.createElement('div');
  card.className = 'modal-card';
  card.innerHTML = `
    <div class="panel-header">
      <h2 class="panel-title">操作与规则图示说明</h2>
      <button type="button" class="btn btn-compact" id="btn-close-help">关闭</button>
    </div>

    <div class="inspector-card">
      <strong>1. 4×4 船舱拼装（无倒计时）</strong>
      <div style="font-size:13px;color:var(--text-secondary);">
        支持<strong>拖拽摆放</strong>，也支持<strong>点选物品 → 点击空位</strong>摆放。点击已选物品或按 <code>R</code> 可顺时针旋转 90°。
        选中奖励先进入暂存区（不加属性、不计估值），离开整理前需全部放入或舍弃。
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
        • 每趟最多 6 个节点。任意整理阶段可免费<strong>安全返航</strong>拿走全部悬赏与货款；若战败仅保留 40% 现金折算，但基地、已解锁设施和图鉴记录全部保留。
      </div>
    </div>
  `;

  card.querySelector('#btn-close-help')?.addEventListener('click', onClose);
  backdrop.appendChild(card);
  return backdrop;
}

export function renderSettingsModal(
  settings: GameSettings,
  onUpdate: (next: GameSettings) => void,
  onResetSave: () => void,
  onClose: () => void
): HTMLElement {
  const backdrop = createModalBackdrop(onClose);
  const card = document.createElement('div');
  card.className = 'modal-card';

  const renderContent = (cur: GameSettings) => {
    card.innerHTML = `
      <div class="panel-header">
        <h2 class="panel-title">系统设置</h2>
        <button type="button" class="btn btn-compact" id="btn-close-settings">关闭</button>
      </div>

      <div class="setting-row">
        <div>
          <div style="font-weight:700;">战斗播放速度</div>
          <div style="font-size:12px;color:var(--text-secondary);">仅改变演出节奏，不改变任何战斗结果</div>
        </div>
        <button type="button" class="btn btn-compact ${cur.combatSpeed === 2 ? 'btn-energy' : ''}" id="set-speed">
          ${cur.combatSpeed === 2 ? '2 倍速' : '1 倍速'}
        </button>
      </div>

      <div class="setting-row">
        <div>
          <div style="font-weight:700;">减少动效（低动效模式）</div>
          <div style="font-size:12px;color:var(--text-secondary);">关闭微震、粒子与漂浮，保留全部状态变化</div>
        </div>
        <button type="button" class="btn btn-compact ${cur.reducedMotion ? 'btn-energy' : ''}" id="set-motion">
          ${cur.reducedMotion ? '已开启' : '已关闭'}
        </button>
      </div>

      <div class="setting-row">
        <div>
          <div style="font-weight:700;">低画质模式</div>
          <div style="font-size:12px;color:var(--text-secondary);">关闭阴影与装饰粒子，优先保证流畅度</div>
        </div>
        <button type="button" class="btn btn-compact ${cur.lowQuality ? 'btn-energy' : ''}" id="set-quality">
          ${cur.lowQuality ? '已开启' : '已关闭'}
        </button>
      </div>

      <div class="setting-row">
        <div>
          <div style="font-weight:700;">音效 (SFX)</div>
          <div style="font-size:12px;color:var(--text-secondary);">静音时全部规则与状态仍清晰可读</div>
        </div>
        <button type="button" class="btn btn-compact ${!cur.sfxMuted ? 'btn-energy' : ''}" id="set-sfx">
          ${cur.sfxMuted ? '已静音' : '已开启'}
        </button>
      </div>

      <div class="setting-row">
        <div>
          <div style="font-weight:700;">环境音乐 (BGM)</div>
          <div style="font-size:12px;color:var(--text-secondary);">基地与出航循环背景音</div>
        </div>
        <button type="button" class="btn btn-compact ${!cur.bgmMuted ? 'btn-energy' : ''}" id="set-bgm">
          ${cur.bgmMuted ? '已静音' : '已开启'}
        </button>
      </div>

      <div class="setting-row" style="border-color:rgba(242,117,100,0.45);">
        <div>
          <div style="font-weight:700;color:var(--state-danger);">重置本地存档</div>
          <div style="font-size:12px;color:var(--text-secondary);">清空基地进度、图鉴与当前航次并重新开始教学</div>
        </div>
        <button type="button" class="btn btn-danger btn-compact" id="set-reset">重置存档</button>
      </div>
    `;

    card.querySelector('#btn-close-settings')?.addEventListener('click', onClose);
    card.querySelector('#set-speed')?.addEventListener('click', () => {
      const next: GameSettings = { ...cur, combatSpeed: cur.combatSpeed === 1 ? 2 : 1 };
      onUpdate(next);
      renderContent(next);
    });
    card.querySelector('#set-motion')?.addEventListener('click', () => {
      const next: GameSettings = { ...cur, reducedMotion: !cur.reducedMotion };
      onUpdate(next);
      renderContent(next);
    });
    card.querySelector('#set-quality')?.addEventListener('click', () => {
      const next: GameSettings = { ...cur, lowQuality: !cur.lowQuality };
      onUpdate(next);
      renderContent(next);
    });
    card.querySelector('#set-sfx')?.addEventListener('click', () => {
      const next: GameSettings = { ...cur, sfxMuted: !cur.sfxMuted };
      onUpdate(next);
      renderContent(next);
    });
    card.querySelector('#set-bgm')?.addEventListener('click', () => {
      const next: GameSettings = { ...cur, bgmMuted: !cur.bgmMuted };
      onUpdate(next);
      renderContent(next);
    });

    let confirmReset = false;
    const resetBtn = card.querySelector<HTMLButtonElement>('#set-reset');
    resetBtn?.addEventListener('click', () => {
      if (!confirmReset) {
        confirmReset = true;
        resetBtn.textContent = '再点一次确认清空';
      } else {
        onResetSave();
        onClose();
      }
    });
  };

  renderContent(settings);
  backdrop.appendChild(card);
  return backdrop;
}

export function renderBackupRecoveryModal(
  errorMsg: string,
  backupCredits: number,
  onRestore: () => void,
  onStartFresh: () => void
): HTMLElement {
  const backdrop = createModalBackdrop();
  const card = document.createElement('div');
  card.className = 'modal-card';
  card.innerHTML = `
    <h2 class="panel-title" style="color:var(--accent-action);">检测到主存档异常</h2>
    <p class="panel-subtitle">主存档读取失败（${errorMsg}），但系统保留了一份最近的有效备份（信用点：${backupCredits}）。</p>
    <div class="action-dock">
      <button type="button" class="btn btn-primary" id="btn-restore-backup">恢复最近备份</button>
      <button type="button" class="btn btn-danger" id="btn-reset-fresh">放弃并开新档</button>
    </div>
  `;
  card.querySelector('#btn-restore-backup')?.addEventListener('click', () => {
    backdrop.remove();
    onRestore();
  });
  card.querySelector('#btn-reset-fresh')?.addEventListener('click', () => {
    backdrop.remove();
    onStartFresh();
  });
  backdrop.appendChild(card);
  return backdrop;
}
