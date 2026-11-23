import { V2_ALL_FORMAL_CONTRACT_TYPES, V2_CONTRACT_TEMPLATES } from '../../data/contracts';
import { V3_FACTIONS, V3_FACTION_MAX_REP, V3_FACTION_ORDER } from '../../data/factions';
import {
  getAvailableContractBoard,
  previewContractBonusHint,
} from '../../domain/contracts';
import { getFactionProgress } from '../../domain/factions';
import type { V2ProfileState } from '../../domain/types';
import { svgIcon } from '../icons';
import { openTitledV2Modal } from '../V2Modals';

export interface V3ContractsModalOptions {
  readonly readOnly: boolean;
  readonly onSelectContract: (templateId: string) => void;
  readonly onStartTutorial: () => void;
}

export function openV3ContractsModal(
  host: HTMLElement,
  profile: V2ProfileState,
  options: V3ContractsModalOptions
): void {
  const board = getAvailableContractBoard(profile);

  const factionStripHtml = `
    <div class="v3-faction-strip" data-testid="factions-overview">
      ${V3_FACTION_ORDER.map((fid) => {
        const def = V3_FACTIONS[fid];
        const prog = getFactionProgress(profile.factionRep[fid] ?? 0);
        const activePerk = def.perksByRank[prog.rank];
        const nextNote =
          prog.nextThreshold !== null
            ? `距 Lv.${prog.rank + 1} 还差 ${Math.max(0, prog.nextThreshold - prog.rep)}`
            : '已达最高声望等级';

        return `<div class="v3-faction-card faction-${fid}" data-testid="faction-card-${fid}">
          <div class="v3-fc-head">
            <span class="v3-fc-name" style="color:${def.accentColor}">${svgIcon('faction', 14)} ${
          def.name
        }</span>
            <span class="v3-rank-badge rank-${prog.rank}">Lv.${prog.rank}</span>
          </div>
          <div class="v3-fc-rep-row">
            <span>声望 <strong class="num">${prog.rep}/${V3_FACTION_MAX_REP}</strong></span>
            <small>${nextNote}</small>
          </div>
          <div class="v3-rep-bar" role="progressbar" aria-valuenow="${prog.rep}" aria-valuemin="0" aria-valuemax="${V3_FACTION_MAX_REP}">
            <div class="v3-rep-fill" style="width:${prog.progressPct}%;background:${def.accentColor}"></div>
          </div>
          <div class="v3-fc-perk">${activePerk}</div>
        </div>`;
      }).join('')}
    </div>
  `;

  const renderCard = (tplId: string, lockedReason?: string) => {
    const tpl = V2_CONTRACT_TEMPLATES[tplId];
    if (!tpl) return '';
    const completedBefore = profile.completedContractIds.includes(tpl.templateId);
    const isDeep = tpl.tier === 'deep';
    const factionDef = tpl.factionId ? V3_FACTIONS[tpl.factionId] : null;
    const bonusHint = previewContractBonusHint(tpl);

    return `
      <div class="v2-contract-card ${isDeep ? 'tier-deep' : ''} ${lockedReason ? 'is-locked' : ''}" ${
      lockedReason ? 'data-contract-locked="true"' : ''
    }>
        <div class="v2-contract-head">
          <span class="v2-contract-name">${tpl.name}</span>
          <span class="v2-contract-reward num">${
            tpl.rewardCredits > 0 ? `+${tpl.rewardCredits}¤` : '按货结算'
          }</span>
        </div>
        ${
          factionDef && tpl.factionRepReward
            ? `<div class="v3-contract-tags">
                <span class="v3-faction-chip faction-${factionDef.id}">${svgIcon('faction', 11)} ${
                factionDef.name
              } +${tpl.factionRepReward} 声望</span>
                ${
                  bonusHint
                    ? `<span class="v3-bonus-obj-pill">额外目标：${bonusHint.label}（+30% 加赏 +${bonusHint.rewardCredits}¤）</span>`
                    : ''
                }
              </div>`
            : ''
        }
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
    {
      title: `委托终端与轨道阵营（已完成 ${profile.completedContractTypes.length}/${V2_ALL_FORMAL_CONTRACT_TYPES.length} 类标准合同）`,
      cardClass: 'v3-contracts-modal',
      dismissible: true,
    },
    (body, modal) => {
      body.innerHTML = `
        <div class="v3-contracts-root" data-testid="contracts-modal">
          <div class="v2-contract-section-title">三大轨道阵营声望与特权（Lv.1: 0 · Lv.2: 100 · Lv.3: 220）</div>
          ${factionStripHtml}

          <div class="v2-contract-section-title">标准委托（第 1–4 层 · 5 大合同类型 · 均附 +30% 额外目标加赏）</div>
          <div class="v2-contract-grid">
            ${board.standardTemplates.map((c) => renderCard(c.templateId)).join('')}
          </div>

          <div class="v2-contract-section-title">深入委托（第 5–6 层高危悬赏${
            board.deepLockReason ? ` · ${board.deepLockReason}` : ''
          }）</div>
          <div class="v2-contract-grid">
            ${board.deepEntries
              .map((entry) =>
                renderCard(
                  entry.template.templateId,
                  entry.locked ? entry.lockReason ?? undefined : undefined
                )
              )
              .join('')}
          </div>

          <div class="v2-contract-section-title">自由航线与首航教学</div>
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
