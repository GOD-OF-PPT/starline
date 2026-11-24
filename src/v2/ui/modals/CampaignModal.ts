import {
  CAMPAIGN_ACT_ORDER,
  CAMPAIGN_CHAPTERS,
  CAMPAIGN_MILESTONES,
  RELIC_PITY_THRESHOLD,
} from '../../data/campaign';
import { V2_CREW, V2_CREW_ORDER, getV2CrewMasteryTierDef } from '../../data/crew';
import { V3_SECTORS, V3_SECTOR_ORDER, getV3SectorDef } from '../../data/sectors';
import {
  getCampaignActRank,
  getRestoredRelicCount,
  getUnlockedCampaignComms,
  hasCampaignMilestone,
  isFinalCampaignMissionUnlocked,
  shouldTriggerRelicPitySignal,
} from '../../domain/campaign';
import type { SectorId, V2ProfileState } from '../../domain/types';
import { crewPortraitSvg, svgIcon } from '../icons';
import { openTitledV2Modal } from '../V2Modals';

export type CampaignModalTab = 'roadmap' | 'comms' | 'crew';

export interface OpenCampaignModalOptions {
  readonly readOnly: boolean;
  readonly initialTab?: CampaignModalTab;
  readonly onMarkCommRead: (commId: string) => void;
  readonly onMarkCommsRead?: (commIds: readonly string[]) => void;
  readonly onSelectSectorFromCampaign?: (sectorId: SectorId) => void;
  readonly onLaunchFinalMission?: () => void;
  readonly onOpenEndless?: () => void;
}

export function openV3CampaignModal(
  host: HTMLElement,
  getProfile: () => V2ProfileState,
  options: OpenCampaignModalOptions
): void {
  let activeTab: CampaignModalTab = options.initialTab ?? 'roadmap';

  openTitledV2Modal(
    host,
    {
      title: `${svgIcon('campaign', 17)} 星门重启计划 · 主线战役档案`,
      cardClass: 'v3-campaign-modal',
    },
    (body, modal) => {
      const render = () => {
        const p = getProfile();
        const curRank = getCampaignActRank(p.campaign.currentAct);
        const restoredRelics = getRestoredRelicCount(p);
        const unlockedComms = getUnlockedCampaignComms(p);
        const readSet = new Set(p.campaign.readCommsIds);
        const unreadCount = unlockedComms.filter((c) => !readSet.has(c.id)).length;
        const finalGate = isFinalCampaignMissionUnlocked(p);

        const tabsHtml = `
          <div class="v3-campaign-tabs" role="tablist" aria-label="主线战役分栏">
            <button type="button" role="tab" aria-selected="${activeTab === 'roadmap'}" class="btn btn-sm ${
          activeTab === 'roadmap' ? 'btn-primary' : 'btn-secondary'
        }" data-camp-tab="roadmap">${svgIcon('campaign', 13)} 星门重启路线图</button>
            <button type="button" role="tab" aria-selected="${activeTab === 'comms'}" class="btn btn-sm ${
          activeTab === 'comms' ? 'btn-primary' : 'btn-secondary'
        }" data-camp-tab="comms">${svgIcon('comms', 13)} 船员通讯${
          unreadCount > 0 ? ` <span class="v3-unread-dot">${unreadCount}</span>` : ''
        }</button>
            <button type="button" role="tab" aria-selected="${activeTab === 'crew'}" class="btn btn-sm ${
          activeTab === 'crew' ? 'btn-primary' : 'btn-secondary'
        }" data-camp-tab="crew">${svgIcon('medal', 13)} 具名船员与专精</button>
          </div>
        `;

        let panelHtml = '';

        if (activeTab === 'roadmap') {
          const summaryBar = `
            <div class="v3-camp-summary-strip">
              <div class="v3-cs-stat"><span>当前幕次</span><strong>${CAMPAIGN_CHAPTERS[p.campaign.currentAct].shortLabel}</strong></div>
              <div class="v3-cs-stat"><span>已开放星区</span><strong class="num">${p.campaign.unlockedSectors.length}/3</strong></div>
              <div class="v3-cs-stat"><span>首领击破</span><strong class="num">${p.campaign.defeatedBossIds.length}/3</strong></div>
              <div class="v3-cs-stat"><span>修复遗物</span><strong class="num">${restoredRelics}/4</strong></div>
            </div>
          `;

          const timelineHtml = CAMPAIGN_ACT_ORDER.map((actId) => {
            const chapter = CAMPAIGN_CHAPTERS[actId];
            const rank = getCampaignActRank(actId);
            const isCurrent = p.campaign.currentAct === actId;
            const isCompleted = rank < curRank;
            const isLocked =
              actId === 'endless'
                ? !p.campaign.endlessUnlocked
                : rank > curRank;

            const statusLabel = isCurrent
              ? '进行中'
              : isCompleted
              ? '已完成'
              : isLocked
              ? '未解锁'
              : '已开放';
            const cardStateCls = isCurrent
              ? 'is-active'
              : isCompleted
              ? 'is-completed'
              : 'is-locked';

            const sectorInfo = chapter.sectorId ? getV3SectorDef(chapter.sectorId) : null;
            const bossCleared = Boolean(
              chapter.targetBossId && p.campaign.defeatedBossIds.includes(chapter.targetBossId)
            );
            const actMilestones = CAMPAIGN_MILESTONES.filter((m) => m.actId === actId);

            const endlessLockHtml =
              actId === 'endless'
                ? !p.campaign.endlessUnlocked
                  ? `<div class="v3-act-lock-note">${svgIcon('lock', 12)} 通关第三幕后解锁 · 未解锁（威压 1–10 终局无尽深渊）</div>`
                  : `<div class="v3-act-meta">
                      <span>已解锁结局：<strong>${p.campaign.endingsUnlocked.length}/3</strong></span>
                      <span>最高可选威压：<strong>威压 ${Math.max(1, p.campaign.maxEndlessThreat)}/10</strong></span>
                      <span>最高通关记录：<strong>威压 ${p.career.deepestEndlessCleared}/10</strong></span>
                    </div>
                    ${
                      options.onOpenEndless && !options.readOnly
                        ? `<div class="v3-cg-actions" style="margin-top:6px;">
                            <button type="button" class="btn btn-sm btn-primary" data-camp-open-endless="1">${svgIcon('bolt', 13)} 前往无尽深渊整备</button>
                          </div>`
                        : ''
                    }`
                : '';

            const climaxGateHtml =
              actId === 'act3'
                ? `
                  <div class="v3-climax-gate-card ${finalGate.unlocked ? 'is-ready' : 'is-locked'}">
                    <div class="v3-cg-head">
                      <strong>${svgIcon('star', 13)} 第三幕终战 · 星门重启远征</strong>
                      <span class="v3-cg-pill">${finalGate.unlocked ? '前置已达成' : '前置未满足 · 未解锁'}</span>
                    </div>
                    <ul class="v3-cg-checks">
                      ${finalGate.checks
                        .map(
                          (chk) =>
                            `<li class="${chk.met ? 'is-met' : ''}">${
                              chk.met ? svgIcon('check', 12) : svgIcon('lock', 12)
                            } <span>${chk.label}</span></li>`
                        )
                        .join('')}
                    </ul>
                    <div class="v3-cg-actions">
                      ${
                        finalGate.unlocked
                          ? `<button type="button" class="btn btn-sm btn-primary" data-testid="btn-launch-final-mission" id="v3-camp-launch-final" ${
                              options.readOnly ? 'disabled' : ''
                            }>${svgIcon('rocket', 13)} 启动星门重启远征（终局决战）</button>`
                          : `<button type="button" class="btn btn-sm btn-primary" data-testid="btn-launch-final-mission" disabled>${svgIcon('lock', 12)} 星门重启远征（前置未满足 · 未解锁）</button>`
                      }
                    </div>
                  </div>
                `
                : '';

            const sectorJumpBtn =
              sectorInfo &&
              actId !== 'prologue' &&
              actId !== 'endless' &&
              p.campaign.unlockedSectors.includes(sectorInfo.id) &&
              options.onSelectSectorFromCampaign &&
              !options.readOnly
                ? `<button type="button" class="btn btn-sm btn-secondary" data-camp-goto-sector="${sectorInfo.id}">前往「${sectorInfo.name}」整备</button>`
                : '';

            return `
              <div class="v3-act-card ${cardStateCls}" data-act-card="${actId}">
                <div class="v3-act-head">
                  <div class="v3-act-title-wrap">
                    <strong>${chapter.title}</strong>
                    <small>${chapter.subtitle}</small>
                  </div>
                  <span class="v3-act-status ${cardStateCls}">${statusLabel}</span>
                </div>
                <p class="v3-act-brief">${chapter.briefing}</p>
                ${
                  sectorInfo && actId !== 'prologue' && actId !== 'endless'
                    ? `<div class="v3-act-meta">
                        <span>星区：<strong>${sectorInfo.name}</strong></span>
                        <span>环境：${sectorInfo.envModifier.name}</span>
                        <span>首领：${sectorInfo.bossName}${bossCleared ? '（已击败）' : ''}</span>
                      </div>`
                    : ''
                }
                ${
                  actMilestones.length > 0
                    ? `<div class="v3-act-milestones">
                        ${actMilestones
                          .map((m) => {
                            const done = hasCampaignMilestone(p.campaign, m.id);
                            return `<span class="v3-ms-chip ${done ? 'done' : ''}">${
                              done ? svgIcon('check', 11) : svgIcon('radar', 11)
                            } ${m.title}</span>`;
                          })
                          .join('')}
                      </div>`
                    : ''
                }
                ${endlessLockHtml}
                ${climaxGateHtml}
                ${sectorJumpBtn ? `<div class="v3-act-foot">${sectorJumpBtn}</div>` : ''}
              </div>
            `;
          }).join('');

          const pityStripHtml = `
            <div class="v3-pity-tracker-box">
              <div class="v2-prep-label">${svgIcon('radar', 13)} 星区古代遗物保底信号追踪（满 ${RELIC_PITY_THRESHOLD} 趟未获遗物，下趟必出可见信号）</div>
              <div class="v3-pity-grid">
                ${V3_SECTOR_ORDER.map((sid) => {
                  const sec = V3_SECTORS[sid];
                  const unlocked = p.campaign.unlockedSectors.includes(sid);
                  const pity = shouldTriggerRelicPitySignal(p, sid);
                  return `<div class="v3-pity-cell ${pity.triggered ? 'is-ready' : ''} ${
                    unlocked ? '' : 'is-locked'
                  }">
                    <strong>${sec.name}</strong>
                    <span>${
                      !unlocked
                        ? '星区未解锁'
                        : pity.triggered
                        ? '保底遗物信号已锁定！'
                        : `计数 ${pity.counter}/${pity.threshold}`
                    }</span>
                  </div>`;
                }).join('')}
              </div>
            </div>
          `;

          panelHtml = `${summaryBar}<div class="v3-act-timeline">${timelineHtml}</div>${pityStripHtml}`;
        } else if (activeTab === 'comms') {
          // Batch-mark currently displayed unlocked comms as read (single persist!)
          if (!options.readOnly) {
            const unreadIds = unlockedComms
              .filter((c) => !readSet.has(c.id))
              .map((c) => c.id);
            if (unreadIds.length > 0) {
              if (options.onMarkCommsRead) {
                options.onMarkCommsRead(unreadIds);
              } else {
                for (const id of unreadIds) {
                  options.onMarkCommRead(id);
                }
              }
            }
          }
          panelHtml = `
            <div class="v3-comms-list">
              ${unlockedComms
                .map((c) => {
                  const crew = V2_CREW[c.speakerId];
                  const chapter = CAMPAIGN_CHAPTERS[c.actId];
                  const wasUnread = !readSet.has(c.id);
                  return `<div class="v3-comm-card ${wasUnread ? 'is-new' : ''}">
                    <div class="v3-comm-avatar">${crewPortraitSvg(c.speakerId, 40)}</div>
                    <div class="v3-comm-content">
                      <div class="v3-comm-head">
                        <strong>${c.title}</strong>
                        <span class="v3-comm-tag">${chapter.shortLabel} · ${crew.roleTitle}</span>
                      </div>
                      <p class="v3-comm-text">「${c.text}」</p>
                    </div>
                  </div>`;
                })
                .join('')}
            </div>
          `;
        } else {
          panelHtml = `
            <div class="v3-crew-roster-list">
              ${V2_CREW_ORDER.map((cid) => {
                const c = V2_CREW[cid];
                const unlocked = p.unlockedCrew.includes(cid);
                const tier = Math.max(0, Math.min(2, Math.floor(p.crewMastery[cid] ?? 0)));
                const curDef = getV2CrewMasteryTierDef(cid, tier);
                const stars = `${'★'.repeat(tier)}${'☆'.repeat(2 - tier)}`;
                return `<div class="v3-crew-roster-card ${unlocked ? '' : 'is-locked'}">
                  <div class="v3-cr-top">
                    ${crewPortraitSvg(cid, 46)}
                    <div class="v3-cr-ident">
                      <div class="v3-cr-name-row">
                        <strong>${c.name}</strong>
                        <span class="v3-cr-role">${c.roleTitle}</span>
                        <span class="v3-mastery-badge">专精 Lv.${tier} ${stars}</span>
                      </div>
                      <small class="v3-cr-bio">${c.bio}</small>
                      <div class="v3-cr-status">${
                        unlocked
                          ? `当前称号：<strong>${curDef.title}</strong> · ${c.abilityTitle}`
                          : `${svgIcon('lock', 12)} ${c.unlockHint}`
                      }</div>
                    </div>
                  </div>
                  <div class="v3-cr-tiers">
                    ${c.masteryTiers
                      .map((td) => {
                        const reached = unlocked && tier >= td.tier;
                        return `<div class="v3-cr-tier-row ${reached ? 'is-reached' : ''}">
                          <span class="v3-tier-lvl">Lv.${td.tier} · ${td.title}</span>
                          <span class="v3-tier-perk">${td.perkSummary}</span>
                          <small class="v3-tier-cond">${
                            reached ? '已激活' : `达成条件：${td.unlockCondition}`
                          }</small>
                        </div>`;
                      })
                      .join('')}
                  </div>
                </div>`;
              }).join('')}
            </div>
          `;
        }

        body.innerHTML = `
          <div class="v3-campaign-modal-body" data-testid="campaign-modal">
            ${tabsHtml}
            <div class="v3-campaign-tab-panel">${panelHtml}</div>
          </div>
        `;

        body.querySelectorAll<HTMLButtonElement>('[data-camp-tab]').forEach((btn) => {
          btn.addEventListener('click', () => {
            activeTab = btn.dataset.campTab as CampaignModalTab;
            render();
          });
        });

        body.querySelectorAll<HTMLButtonElement>('[data-camp-goto-sector]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const sid = btn.dataset.campGotoSector as SectorId;
            modal.close();
            options.onSelectSectorFromCampaign?.(sid);
          });
        });

        body.querySelector('#v3-camp-launch-final')?.addEventListener('click', () => {
          if (options.readOnly || !finalGate.unlocked) return;
          modal.close();
          options.onLaunchFinalMission?.();
        });

        body.querySelector('[data-camp-open-endless]')?.addEventListener('click', () => {
          if (options.readOnly || !p.campaign.endlessUnlocked) return;
          modal.close();
          options.onOpenEndless?.();
        });
      };

      render();
    }
  );
}
