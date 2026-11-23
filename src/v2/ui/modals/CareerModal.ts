import { getEnemyShipImageUrl } from '../../../assets/itemArt';
import { V3_BOSS_DEFS, V3_BOSS_ORDER } from '../../data/bosses';
import { CAMPAIGN_CHAPTERS } from '../../data/campaign';
import { V2_CREW } from '../../data/crew';
import {
  V2_ENCOUNTER_TEMPLATES,
  V2_REGULAR_ENCOUNTER_KINDS,
} from '../../data/enemies';
import {
  V3_BESTIARY_NOTES,
  V3_ENDINGS,
  V3_ENDING_ORDER,
  V3_LORE_ENTRIES,
} from '../../data/lore';
import { getV3EndlessMutatorDef, getV3SectorDef } from '../../data/sectors';
import { V2_SHIPS } from '../../data/ships';
import { evaluateV3Achievements } from '../../domain/achievements';
import { getUnlockedCampaignComms } from '../../domain/campaign';
import type { EndingId, V2ProfileState } from '../../domain/types';
import { crewPortraitSvg, svgIcon } from '../icons';
import { openTitledV2Modal } from '../V2Modals';

export type CareerModalTab =
  | 'overview'
  | 'bestiary'
  | 'endings'
  | 'lore'
  | 'achievements';

export interface OpenCareerModalOptions {
  readonly readOnly: boolean;
  readonly initialTab?: CareerModalTab;
  readonly onClaimAchievement: (achievementId: string) => {
    readonly ok: boolean;
    readonly rewardCredits: number;
    readonly rewardParts: number;
    readonly error?: string;
  };
  readonly onReplayEnding: (endingId: EndingId) => void;
}

export function openV3CareerModal(
  host: HTMLElement,
  getProfile: () => V2ProfileState,
  options: OpenCareerModalOptions
): void {
  let activeTab: CareerModalTab = options.initialTab ?? 'overview';
  let statusNotice: string | null = null;

  openTitledV2Modal(
    host,
    {
      title: `${svgIcon('medal', 17)} 远航生涯档案 · 图鉴 · 成就勋章`,
      cardClass: 'v3-career-modal',
    },
    (body, modal) => {
      const render = () => {
        const p = getProfile();
        const c = p.career;
        const achEvals = evaluateV3Achievements(p);
        const unlockedAchCount = achEvals.filter((e) => e.unlocked).length;
        const claimableAchCount = achEvals.filter((e) => e.claimable).length;
        const claimedAchCount = achEvals.filter((e) => e.claimed).length;
        const unlockedEndings = p.campaign.endingsUnlocked;

        // CRITICAL: Plain <button type="button"> tabs (NO role="tab"!) with aria-pressed
        const tabsHtml = `
          <div class="v3-career-tabs" aria-label="生涯档案分栏">
            <button
              type="button"
              class="btn btn-sm ${activeTab === 'overview' ? 'btn-primary' : 'btn-secondary'}"
              data-career-tab="overview"
              data-testid="career-tab-overview"
              aria-pressed="${activeTab === 'overview'}"
            >${svgIcon('radar', 13)} 生涯与日志</button>
            <button
              type="button"
              class="btn btn-sm ${activeTab === 'bestiary' ? 'btn-primary' : 'btn-secondary'}"
              data-career-tab="bestiary"
              data-testid="career-tab-bestiary"
              aria-pressed="${activeTab === 'bestiary'}"
            >${svgIcon('boss', 13)} 敌舰图鉴与首领档案</button>
            <button
              type="button"
              class="btn btn-sm ${activeTab === 'endings' ? 'btn-primary' : 'btn-secondary'}"
              data-career-tab="endings"
              data-testid="career-tab-endings"
              aria-pressed="${activeTab === 'endings'}"
            >${svgIcon('star', 13)} 结局回廊 (${unlockedEndings.length}/3)</button>
            <button
              type="button"
              class="btn btn-sm ${activeTab === 'lore' ? 'btn-primary' : 'btn-secondary'}"
              data-career-tab="lore"
              data-testid="career-tab-lore"
              aria-pressed="${activeTab === 'lore'}"
            >${svgIcon('book', 13)} 剧情档案</button>
            <button
              type="button"
              class="btn btn-sm ${activeTab === 'achievements' ? 'btn-primary' : 'btn-secondary'}"
              data-career-tab="achievements"
              data-testid="career-tab-achievements"
              aria-pressed="${activeTab === 'achievements'}"
            >${svgIcon('medal', 13)} 成就勋章 (${unlockedAchCount}/18)${
              claimableAchCount > 0
                ? ` <span class="v3-unread-dot">${claimableAchCount}</span>`
                : ''
            }</button>
          </div>
        `;

        let panelHtml = '';

        if (activeTab === 'overview') {
          const statsHtml = `
            <div class="v3-career-stats-grid" data-testid="career-stats-grid">
              <div class="v3-cstat-card">
                <span>累计远航</span>
                <strong class="num">${p.totalRuns} 次</strong>
              </div>
              <div class="v3-cstat-card">
                <span>委托胜场</span>
                <strong class="num">${c.totalWins} 胜</strong>
              </div>
              <div class="v3-cstat-card">
                <span>安全返航</span>
                <strong class="num">${c.totalSafeReturns} 次</strong>
              </div>
              <div class="v3-cstat-card">
                <span>战败拖回</span>
                <strong class="num">${c.totalDefeats} 次</strong>
              </div>
              <div class="v3-cstat-card">
                <span>累计信用点收益</span>
                <strong class="num">${c.totalCreditsEarned}¤</strong>
              </div>
              <div class="v3-cstat-card">
                <span>累计精密零件</span>
                <strong class="num">${c.totalSalvagePartsEarned}</strong>
              </div>
              <div class="v3-cstat-card">
                <span>首领击破总数</span>
                <strong class="num">${c.totalBossesDefeated}</strong>
              </div>
              <div class="v3-cstat-card">
                <span>残骸拆解次数</span>
                <strong class="num">${c.totalWrecksDissected}</strong>
              </div>
              <div class="v3-cstat-card">
                <span>精密分解件数</span>
                <strong class="num">${c.totalItemsDismantled}</strong>
              </div>
              <div class="v3-cstat-card">
                <span>无尽最高通关</span>
                <strong class="num">威压 ${c.deepestEndlessCleared}/10</strong>
              </div>
            </div>
          `;

          const historyRowsHtml =
            p.runHistory.length === 0
              ? `<div class="v2-empty-inline">暂无已归档航行记录，完成一次远航后将在此保留最近 30 场远征日志。</div>`
              : p.runHistory
                  .map((entry, idx) => {
                    const sec = getV3SectorDef(entry.sectorId);
                    const ship = V2_SHIPS[entry.shipId];
                    const crew = entry.crewId ? V2_CREW[entry.crewId] : null;
                    const mutatorTags = (entry.endlessMutatorIds ?? [])
                      .map((mid) => getV3EndlessMutatorDef(mid)?.name ?? mid)
                      .join(' · ');
                    return `
                      <div class="v3-history-row ${
                        entry.outcome === 'safe_return' ? 'is-safe' : 'is-defeat'
                      }" data-run-history-index="${idx}">
                        <div class="v3-hr-main">
                          <div class="v3-hr-head">
                            <strong>${entry.contractName}</strong>
                            <span class="v3-hr-badge ${
                              entry.outcome === 'safe_return' ? 'ok' : 'danger'
                            }">${entry.outcome === 'safe_return' ? '安全返航' : '战败拖回'}</span>
                            ${
                              entry.isFinalCampaignRun
                                ? `<span class="v3-hr-badge climax">终局远征</span>`
                                : ''
                            }
                            ${
                              entry.endlessThreat >= 1
                                ? `<span class="v3-hr-badge endless">无尽深渊 · 威压 ${entry.endlessThreat}</span>`
                                : ''
                            }
                          </div>
                          <div class="v3-hr-meta">
                            <span>${sec.name}</span>
                            <span>${ship?.name ?? entry.shipId}</span>
                            <span>${crew ? `${crew.name}` : '单舰巡航'}</span>
                            <span>抵达第 ${entry.maxLayerReached} 层</span>
                            ${
                              entry.seed !== undefined
                                ? `<span class="num">种子 #${entry.seed}</span>`
                                : ''
                            }
                            ${mutatorTags ? `<span>词条：${mutatorTags}</span>` : ''}
                          </div>
                        </div>
                        <div class="v3-hr-payout">
                          <strong class="num">+${entry.creditsEarned}¤</strong>
                          ${
                            entry.salvagePartsEarned > 0
                              ? `<small class="num">+${entry.salvagePartsEarned} 零件</small>`
                              : `<small>${entry.contractCompleted ? '委托交付' : '自由清点'}</small>`
                          }
                        </div>
                      </div>
                    `;
                  })
                  .join('');

          panelHtml = `
            <div class="v3-career-section">
              <div class="v3-career-sec-title">${svgIcon('radar', 14)} 舰长生涯总览</div>
              ${statsHtml}
            </div>
            <div class="v3-career-section">
              <div class="v3-career-sec-title">${svgIcon('book', 14)} 航行日志（最近 ${p.runHistory.length} / 30 场）</div>
              <div class="v3-history-list" data-testid="career-run-history">
                ${historyRowsHtml}
              </div>
            </div>
          `;
        } else if (activeTab === 'bestiary') {
          const bossSet = new Set([
            ...p.campaign.defeatedBossIds,
            ...p.defeatedEnemyKinds,
          ]);
          const defeatedKindSet = new Set([
            ...p.defeatedEnemyKinds,
            ...p.campaign.defeatedBossIds,
          ]);

          const bossesHtml = V3_BOSS_ORDER.map((bid) => {
            const boss = V3_BOSS_DEFS[bid];
            const tpl = V2_ENCOUNTER_TEMPLATES[bid];
            const defeated = bossSet.has(bid);
            const note = V3_BESTIARY_NOTES[bid];
            return `
              <div class="v3-bestiary-card is-boss ${defeated ? 'is-defeated' : 'is-unseen'}" data-bestiary-id="${bid}">
                <div class="v3-bc-art">
                  <img src="${getEnemyShipImageUrl(boss.spriteArchetype)}" alt="${boss.name}" />
                </div>
                <div class="v3-bc-info">
                  <div class="v3-bc-head">
                    <strong>${boss.name}</strong>
                    <span class="v3-bc-tag">第 ${boss.actNumber} 幕首领 · ${boss.phaseCountLabel}</span>
                    <span class="v3-bc-status ${defeated ? 'ok' : 'locked'}">${
                      defeated ? '已击破' : '未击破'
                    }</span>
                  </div>
                  <p class="v3-bc-overview">${note?.lore ?? boss.tacticalOverview}</p>
                  <div class="v3-bc-phases">
                    ${boss.phases
                      .map(
                        (ph) =>
                          `<span class="v3-bc-phase-chip">P${ph.phaseNumber} ${ph.name}</span>`
                      )
                      .join('')}
                  </div>
                  <div class="v3-bc-tip"><strong>应对要点：</strong>${
                    note?.counterTip ?? tpl.tacticHint
                  }</div>
                </div>
              </div>
            `;
          }).join('');

          const regularKinds: readonly string[] = [...V2_REGULAR_ENCOUNTER_KINDS, 'elite'];
          const regularsHtml = regularKinds
            .map((kind) => {
              const tpl = V2_ENCOUNTER_TEMPLATES[kind as keyof typeof V2_ENCOUNTER_TEMPLATES];
              if (!tpl) return '';
              const defeated = defeatedKindSet.has(kind);
              const primaryUnit = tpl.units[0];
              const note = V3_BESTIARY_NOTES[kind];
              return `
                <div class="v3-bestiary-card ${defeated ? 'is-defeated' : 'is-unseen'}" data-bestiary-id="${kind}">
                  <div class="v3-bc-art">
                    <img src="${getEnemyShipImageUrl(primaryUnit.spriteArchetype)}" alt="${tpl.name}" />
                  </div>
                  <div class="v3-bc-info">
                    <div class="v3-bc-head">
                      <strong>${tpl.name}</strong>
                      <span class="v3-bc-tag">${tpl.badge}</span>
                      <span class="v3-bc-status ${defeated ? 'ok' : 'locked'}">${
                        defeated ? '已记录' : '未击破'
                      }</span>
                    </div>
                    <p class="v3-bc-overview">${
                      defeated ? note?.lore ?? tpl.tacticHint : '击败该编队后解锁完整战术观测日志。'
                    }</p>
                    <div class="v3-bc-tip">${
                      defeated
                        ? `<strong>战术反制：</strong>${note?.counterTip ?? tpl.tacticHint}`
                        : `特征提示：${tpl.tacticHint}`
                    }</div>
                  </div>
                </div>
              `;
            })
            .join('');

          panelHtml = `
            <div class="v3-career-section">
              <div class="v3-career-sec-title">${svgIcon('boss', 14)} 大区首领档案（${
                V3_BOSS_ORDER.filter((id) => bossSet.has(id)).length
              } / 3 已击破）</div>
              <div class="v3-bestiary-list">${bossesHtml}</div>
            </div>
            <div class="v3-career-section">
              <div class="v3-career-sec-title">${svgIcon('combat', 14)} 常规与精英敌舰图鉴（${
                regularKinds.filter((k) => defeatedKindSet.has(k)).length
              } / ${regularKinds.length} 已记录）</div>
              <div class="v3-bestiary-grid">${regularsHtml}</div>
            </div>
          `;
        } else if (activeTab === 'endings') {
          const unlockedSet = new Set<EndingId>(unlockedEndings);
          const cardsHtml = V3_ENDING_ORDER.map((eid) => {
            const unlocked = unlockedSet.has(eid);
            const def = V3_ENDINGS[eid];
            if (!unlocked) {
              return `
                <div class="v3-ending-gallery-card is-locked" data-ending-gallery="${eid}">
                  <div class="v3-egc-head">
                    <strong>${svgIcon('lock', 14)} ??? · 未解锁结局</strong>
                    <span class="v3-egc-badge locked">未解锁 · 锁定</span>
                  </div>
                  <p class="v3-egc-desc">通关第三幕「星门重启远征」并在终局抉择中选择该航向后解锁完整史册与尾声重温。</p>
                </div>
              `;
            }
            return `
              <div class="v3-ending-gallery-card is-unlocked tone-${eid}" data-ending-gallery="${eid}">
                <div class="v3-egc-head">
                  <strong>${svgIcon('star', 14)} ${def.title}</strong>
                  <span class="v3-egc-badge ok">已解锁</span>
                </div>
                <div class="v3-egc-sub">${def.subtitle}</div>
                <p class="v3-egc-desc">${def.summary}</p>
                <div class="v3-egc-foot">
                  <button type="button" class="btn btn-sm btn-primary" data-replay-ending="${eid}">重温结局尾声</button>
                </div>
              </div>
            `;
          }).join('');

          panelHtml = `
            <div class="v3-career-section">
              <div class="v3-career-sec-title">${svgIcon('star', 14)} 星门终局回廊 · 已解锁 ${unlockedEndings.length} / 3</div>
              <div class="v3-ending-gallery-list">${cardsHtml}</div>
            </div>
          `;
        } else if (activeTab === 'lore') {
          const unlockedLoreCount = V3_LORE_ENTRIES.filter((l) => l.isUnlocked(p)).length;
          const loreCardsHtml = V3_LORE_ENTRIES.map((entry) => {
            const unlocked = entry.isUnlocked(p);
            return `
              <div class="v3-lore-card ${unlocked ? 'is-unlocked' : 'is-locked'}">
                <div class="v3-lc-head">
                  <span class="v3-lc-cat">${entry.category}</span>
                  <strong>${unlocked ? entry.title : '??? · 加密星港档案'}</strong>
                  <span class="v3-lc-status">${unlocked ? '已解密' : '未解锁'}</span>
                </div>
                <p class="v3-lc-body">${
                  unlocked ? entry.body : `解密条件：${entry.unlockHint}`
                }</p>
              </div>
            `;
          }).join('');

          const comms = getUnlockedCampaignComms(p);
          const commsHtml = comms
            .map((cm) => {
              const crew = V2_CREW[cm.speakerId];
              const chapter = CAMPAIGN_CHAPTERS[cm.actId];
              return `
                <div class="v3-comm-card">
                  <div class="v3-comm-avatar">${crewPortraitSvg(cm.speakerId, 34)}</div>
                  <div class="v3-comm-content">
                    <div class="v3-comm-head">
                      <strong>${cm.title}</strong>
                      <span class="v3-comm-tag">${chapter.shortLabel} · ${crew.roleTitle}</span>
                    </div>
                    <p class="v3-comm-text">「${cm.text}」</p>
                  </div>
                </div>
              `;
            })
            .join('');

          panelHtml = `
            <div class="v3-career-section">
              <div class="v3-career-sec-title">${svgIcon('book', 14)} 星门世界观档案（${unlockedLoreCount} / ${V3_LORE_ENTRIES.length}）</div>
              <div class="v3-lore-grid">${loreCardsHtml}</div>
            </div>
            <div class="v3-career-section">
              <div class="v3-career-sec-title">${svgIcon('comms', 14)} 已归档无线电通讯（${comms.length} 条）</div>
              <div class="v3-comms-list">${commsHtml}</div>
            </div>
          `;
        } else {
          // Achievements tab (exact 18 achievements)
          const cardsHtml = achEvals
            .map((ev) => {
              const stateCls = ev.claimed
                ? 'is-claimed'
                : ev.claimable
                ? 'is-claimable'
                : 'is-locked';
              const actionHtml = ev.claimable
                ? `<button
                    type="button"
                    class="btn btn-sm btn-primary v3-ach-claim-btn"
                    data-testid="btn-claim-achievement-${ev.def.id}"
                    data-claim-ach="${ev.def.id}"
                    ${options.readOnly ? 'disabled' : ''}
                  >领取 +${ev.def.rewardCredits}¤ / +${ev.def.rewardParts}零件</button>`
                : ev.claimed
                ? `<button type="button" class="btn btn-sm btn-ghost" disabled>已解锁 · 已领取</button>`
                : `<span class="v3-ach-locked-badge">未达成</span>`;

              return `
                <div
                  class="achievement-card v3-achievement-item ${stateCls}"
                  data-testid="achievement-card-${ev.def.id}"
                  data-unlocked="${ev.unlocked ? 'true' : 'false'}"
                  data-claimed="${ev.claimed ? 'true' : 'false'}"
                >
                  <div class="v3-ach-head">
                    <span class="v3-ach-cat">${ev.def.category}</span>
                    <strong>${ev.def.title}</strong>
                    <span class="v3-ach-progress num">${ev.progressLabel}</span>
                  </div>
                  <p class="v3-ach-desc">${ev.def.description}</p>
                  <div class="v3-ach-foot">
                    <span class="v3-ach-reward num">奖励：+${ev.def.rewardCredits}¤ · +${ev.def.rewardParts} 精密零件</span>
                    ${actionHtml}
                  </div>
                </div>
              `;
            })
            .join('');

          panelHtml = `
            <div class="v3-career-section">
              <div class="v3-ach-summary-bar">
                <span>成就勋章：<strong>已解锁 ${unlockedAchCount} / 18</strong></span>
                <span>已领取 <strong class="num">${claimedAchCount} / 18</strong></span>
                ${
                  claimableAchCount > 0
                    ? `<span class="v3-ach-claimable-pill">有 ${claimableAchCount} 项奖励可领取</span>`
                    : ''
                }
              </div>
              ${
                statusNotice
                  ? `<div class="system-banner banner-warn" role="status">${statusNotice}</div>`
                  : ''
              }
              <div class="v3-achievements-grid" data-testid="career-achievements-list">
                ${cardsHtml}
              </div>
            </div>
          `;
        }

        body.innerHTML = `
          <div class="v3-career-modal-body" data-testid="career-modal">
            ${tabsHtml}
            <div class="v3-career-tab-panel">${panelHtml}</div>
          </div>
        `;

        body.querySelectorAll<HTMLButtonElement>('[data-career-tab]').forEach((btn) => {
          btn.addEventListener('click', () => {
            activeTab = btn.dataset.careerTab as CareerModalTab;
            statusNotice = null;
            render();
          });
        });

        body.querySelectorAll<HTMLButtonElement>('[data-claim-ach]').forEach((btn) => {
          btn.addEventListener('click', () => {
            if (btn.disabled || options.readOnly) return;
            // Immediate synchronous disable prevents dblclick double-firing before re-render
            btn.disabled = true;
            const achId = btn.dataset.claimAch!;
            const res = options.onClaimAchievement(achId);
            if (res.ok) {
              statusNotice = `成就奖励已入账：+${res.rewardCredits}¤、+${res.rewardParts} 精密零件！`;
            } else {
              statusNotice = res.error ?? '无法领取该成就奖励';
            }
            render();
          });
        });

        body.querySelectorAll<HTMLButtonElement>('[data-replay-ending]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const eid = btn.dataset.replayEnding as EndingId;
            modal.close();
            options.onReplayEnding(eid);
          });
        });
      };

      render();
    }
  );
}
