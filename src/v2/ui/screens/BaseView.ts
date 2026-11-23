import { V2_CONTRACT_TEMPLATES } from '../../data/contracts';
import { V2_ALL_EQUIPMENT_KINDS } from '../../data/equipment';
import { V3_RELIC_PASSIVES } from '../../data/facilities';
import { V2_SHIP_ORDER } from '../../data/ships';
import { getClaimableAchievementCount } from '../../domain/achievements';
import type { ActiveCampaignObjective } from '../../domain/campaign';
import {
  getActiveRelicPassives,
  getEffectiveWarehouseCapacity,
  getV2RelicSummary,
} from '../../domain/progressionV2';
import type { V2ProfileState } from '../../domain/types';
import { svgIcon } from '../icons';
import type { NextBaseGoal, V2ReturnDockingNotice } from './screenTypes';

export interface BaseViewProps {
  readonly profile: V2ProfileState;
  readonly readOnly: boolean;
  readonly nextGoal: NextBaseGoal;
  readonly recommendedContractId: string;
  readonly activeDockingNotice: V2ReturnDockingNotice | null;
  readonly campaignBannerCollapsed: boolean;
  readonly campaignObjective: ActiveCampaignObjective;
}

export interface BaseViewActions {
  readonly onSkipDocking: () => void;
  readonly onCloseDocking: () => void;
  readonly onStartTutorial: () => void;
  readonly onLaunchRecommended: (contractTemplateId: string) => void;
  readonly onOpenContracts: () => void;
  readonly onToggleCampaignBanner: () => void;
  readonly onOpenCampaign: () => void;
  readonly onOpenGoal: (kind: NextBaseGoal['actionKind']) => void;
  readonly onOpenWarehouse: () => void;
  readonly onOpenFacilities: () => void;
  readonly onOpenRelics: () => void;
  readonly onOpenCodex: () => void;
  readonly onOpenCareer: () => void;
}

export function renderBaseHeroView(
  overlayEl: HTMLElement,
  props: BaseViewProps,
  actions: BaseViewActions
): void {
  const {
    profile: p,
    readOnly,
    nextGoal,
    recommendedContractId,
    activeDockingNotice,
    campaignBannerCollapsed: collapsed,
    campaignObjective: camp,
  } = props;
  const relicSum = getV2RelicSummary(p);
  const recTpl = V2_CONTRACT_TEMPLATES[recommendedContractId] ?? V2_CONTRACT_TEMPLATES.transport_std;

  const dockingHtml = activeDockingNotice
    ? (() => {
        const n = activeDockingNotice;
        const shownCredits = n.animating
          ? Math.round(n.creditsBefore + (n.creditsAfter - n.creditsBefore) * n.progress)
          : n.creditsAfter;
        return `
          <div class="docking-overlay-card">
            <div class="docking-title">${
              n.wasDefeat
                ? '拖船已将受损舰体拖回拆解站'
                : n.contractCompleted
                ? '委托交付完成 · 货船安全靠泊'
                : '货船安全返航 · 卸货入账完毕'
            }</div>
            <div class="docking-stats">
              <span>本次入账 <strong class="num">+${n.earnedCredits}¤</strong></span>
              ${
                (n.earnedParts ?? 0) > 0
                  ? `<span>精密零件 <strong class="num">+${n.earnedParts}</strong></span>`
                  : ''
              }
              <span>基地余额 <strong class="num">${shownCredits}¤</strong></span>
            </div>
            ${n.unlockedText ? `<div class="docking-unlock">${n.unlockedText}</div>` : ''}
            <div class="docking-actions">
              ${
                n.animating
                  ? `<button type="button" class="btn btn-sm btn-secondary" id="v2-skip-dock">跳过靠泊</button>`
                  : `<button type="button" class="btn btn-sm btn-primary" id="v2-close-dock">收起</button>`
              }
            </div>
          </div>
        `;
      })()
    : '';

  const commandCardHtml = !p.tutorialCompleted
    ? `
      <div class="v2-base-cmd-card">
        <div class="v2-cmd-eyebrow">${svgIcon('star', 13)} 推荐首航</div>
        <div class="v2-cmd-title">首航教学 · 2×3 密封反应堆</div>
        <div class="v2-cmd-desc">3 层示范航路，亲手体验空间取舍、旋转拼装与安全返航，完成后免费解锁工作台并奖 +40¤。</div>
        <div class="v2-cmd-actions">
          <button type="button" class="btn btn-primary btn-launch-hero" id="v2-base-start-tut" data-testid="btn-start-tutorial" ${
            readOnly ? 'disabled' : ''
          }>${svgIcon('rocket', 16)} 启动首航教学</button>
          <button type="button" class="btn btn-secondary" id="v2-base-all-contracts" data-testid="btn-open-contracts">委托终端</button>
        </div>
      </div>
    `
    : `
      <div class="v2-base-cmd-card">
        <div class="v2-cmd-eyebrow">${svgIcon('star', 13)} 当前推荐委托 · ${
        recTpl.rewardCredits > 0 ? `+${recTpl.rewardCredits}¤` : '自由打捞'
      }</div>
        <div class="v2-cmd-title">${recTpl.name}</div>
        <div class="v2-cmd-desc">${recTpl.gameplayNote}</div>
        <div class="v2-cmd-actions">
          <button type="button" class="btn btn-primary btn-launch-hero" id="v2-base-launch-rec" data-testid="btn-start-recommended" ${
            readOnly ? 'disabled' : ''
          }>${svgIcon('rocket', 16)} 接取并整备出航</button>
          <button type="button" class="btn btn-secondary" id="v2-base-all-contracts" data-testid="btn-open-contracts">全部委托</button>
        </div>
      </div>
    `;

  const campaignBannerHtml = `
    <div class="v3-campaign-banner ${collapsed ? 'is-collapsed' : ''}" data-testid="campaign-banner">
      <div class="v3-cb-header">
        <button type="button" class="v3-cb-toggle" id="v3-cb-toggle" data-testid="btn-toggle-campaign-banner" aria-expanded="${!collapsed}">
          <span class="v3-cb-eyebrow">${svgIcon('campaign', 13)} 星门重启计划 · ${camp.actLabel}</span>
          <span class="v3-cb-chevron">${svgIcon(collapsed ? 'chevronUp' : 'chevronDown', 13)}</span>
        </button>
        <button type="button" class="btn btn-sm btn-secondary v3-cb-open-btn" id="v3-btn-open-campaign" data-testid="btn-open-campaign">
          主线档案${camp.unreadCommsCount > 0 ? `<span class="v3-unread-dot" aria-label="未读通讯">${camp.unreadCommsCount}</span>` : ''}
        </button>
      </div>
      ${
        !collapsed
          ? `<div class="v3-cb-body">
              <div class="v3-cb-obj">
                <strong>${camp.headline}</strong>
                <small>${camp.detail}</small>
              </div>
              <div class="v3-cb-progress-track" aria-label="主线推进进度"><span style="width:${camp.progressPct}%"></span></div>
            </div>`
          : ''
      }
    </div>
  `;

  const warehouseCap = getEffectiveWarehouseCapacity(p);
  const claimableAchCount = getClaimableAchievementCount(p);
  const relicPassives = getActiveRelicPassives(p);
  const activeRelicStripHtml =
    relicPassives.activeRelicIds.length > 0
      ? `<div class="v3-relic-passive-strip" data-testid="active-relic-passives">
          ${relicPassives.activeRelicIds
            .map(
              (rid) =>
                `<span class="v3-relic-passive-pill">${svgIcon('museum', 11)} ${
                  V3_RELIC_PASSIVES[rid]?.shortBadge ?? rid
                }</span>`
            )
            .join('')}
        </div>`
      : '';

  const utilityDockHtml = `
    <div class="v2-base-utility-col">
      ${campaignBannerHtml}
      ${activeRelicStripHtml}
      <button type="button" class="v2-next-goal-pill ${nextGoal.ready ? 'is-ready' : ''}" id="v2-base-next-goal">
        <span class="v2-goal-k">${nextGoal.ready ? '下一步就绪' : '下一个基地目标'}</span>
        <strong>${nextGoal.title}</strong>
        <small>${nextGoal.detail}</small>
      </button>
      <div class="v2-station-dock" role="toolbar" aria-label="空间站功能区">
        <button type="button" class="v2-dock-btn" id="v2-dock-wh" data-testid="btn-open-warehouse">
          ${svgIcon('warehouse', 17)}
          <span>设备工坊</span>
          <small class="num">${p.equipmentWarehouse.length}/${warehouseCap} · ${p.salvageParts}零件${
    p.pendingGiftQueue.length > 0 ? ` +${p.pendingGiftQueue.length}` : ''
  }</small>
        </button>
        <button type="button" class="v2-dock-btn" id="v2-dock-fac" data-testid="btn-open-facilities">
          ${svgIcon('wrench', 17)}
          <span>设施扩建</span>
          <small class="num">${p.unlockedShips.length}/${V2_SHIP_ORDER.length} 舰</small>
        </button>
        <button type="button" class="v2-dock-btn" id="v2-dock-relics" data-testid="btn-open-relics">
          ${svgIcon('museum', 17)}
          <span>藏品馆</span>
          <small class="num">${relicSum.restoredCount}/${relicSum.totalCount}</small>
        </button>
        <button type="button" class="v2-dock-btn" id="v2-dock-codex" data-testid="btn-open-codex">
          ${svgIcon('book', 17)}
          <span>图鉴</span>
          <small class="num">${p.blueprints.length}/${V2_ALL_EQUIPMENT_KINDS.length} 蓝图</small>
        </button>
        <button type="button" class="v2-dock-btn" id="v2-dock-career" data-testid="btn-open-career">
          ${
            claimableAchCount > 0
              ? `<span class="v3-dock-badge-dot" aria-label="可领取成就">${claimableAchCount}</span>`
              : ''
          }
          ${svgIcon('medal', 17)}
          <span>生涯档案</span>
          <small class="num">${p.achievementsUnlocked.length}/18 成就</small>
        </button>
      </div>
    </div>
  `;

  overlayEl.innerHTML = `
    <div class="v3-overlay-screen v2-base-screen-root" data-testid="base-screen">
      <div class="scene-stage-tag">${svgIcon('beacon', 13)} 星际拆解站 · 点击站内设施或下方指令泊位管理</div>
      ${dockingHtml}
      <div class="v2-base-hero-hud">
        ${commandCardHtml}
        ${utilityDockHtml}
      </div>
    </div>
  `;

  overlayEl.querySelector('#v2-skip-dock')?.addEventListener('click', actions.onSkipDocking);
  overlayEl.querySelector('#v2-close-dock')?.addEventListener('click', actions.onCloseDocking);
  overlayEl.querySelector('#v2-base-start-tut')?.addEventListener('click', actions.onStartTutorial);
  overlayEl
    .querySelector('#v2-base-launch-rec')
    ?.addEventListener('click', () => actions.onLaunchRecommended(recTpl.templateId));
  overlayEl
    .querySelector('#v2-base-all-contracts')
    ?.addEventListener('click', actions.onOpenContracts);
  overlayEl
    .querySelector('#v3-cb-toggle')
    ?.addEventListener('click', actions.onToggleCampaignBanner);
  overlayEl
    .querySelector('#v3-btn-open-campaign')
    ?.addEventListener('click', actions.onOpenCampaign);
  overlayEl
    .querySelector('#v2-base-next-goal')
    ?.addEventListener('click', () => actions.onOpenGoal(nextGoal.actionKind));
  overlayEl.querySelector('#v2-dock-wh')?.addEventListener('click', actions.onOpenWarehouse);
  overlayEl.querySelector('#v2-dock-fac')?.addEventListener('click', actions.onOpenFacilities);
  overlayEl.querySelector('#v2-dock-relics')?.addEventListener('click', actions.onOpenRelics);
  overlayEl.querySelector('#v2-dock-codex')?.addEventListener('click', actions.onOpenCodex);
  overlayEl.querySelector('#v2-dock-career')?.addEventListener('click', actions.onOpenCareer);
}
