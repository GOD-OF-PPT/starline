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
import type { NextBaseGoal, PhaseView, V2ReturnDockingNotice } from './screenTypes';

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

type DockingNoticeActions = Pick<BaseViewActions, 'onSkipDocking' | 'onCloseDocking'>;

function syncButtonDisabled(btn: HTMLButtonElement, disabled: boolean): void {
  if (btn.disabled !== disabled) {
    btn.disabled = disabled;
  }
  if (disabled) {
    btn.setAttribute('disabled', '');
  } else {
    btn.removeAttribute('disabled');
  }
}

const mountedBaseViews = new WeakMap<HTMLElement, BasePhaseView>();

export class BasePhaseView implements PhaseView<BaseViewProps, BaseViewActions> {
  private hostEl: HTMLElement | null = null;
  private rootEl: HTMLDivElement | null = null;
  private stageTagEl: HTMLDivElement | null = null;

  // Docking notice persistent elements (60fps in-place credit ticks)
  private dockingSlotEl: HTMLDivElement | null = null;
  private dockingCardEl: HTMLDivElement | null = null;
  private dockingTitleEl: HTMLDivElement | null = null;
  private dockingStatsEl: HTMLDivElement | null = null;
  private dockingEarnedValEl: HTMLElement | null = null;
  private dockingPartsWrapEl: HTMLSpanElement | null = null;
  private dockingPartsValEl: HTMLElement | null = null;
  private dockingBalanceWrapEl: HTMLSpanElement | null = null;
  private dockingBalanceValEl: HTMLElement | null = null;
  private dockingUnlockEl: HTMLDivElement | null = null;
  private dockingActionsEl: HTMLDivElement | null = null;
  private skipDockBtnEl: HTMLButtonElement | null = null;
  private closeDockBtnEl: HTMLButtonElement | null = null;

  // Command card persistent elements
  private cmdEyebrowEl: HTMLDivElement | null = null;
  private cmdTitleEl: HTMLDivElement | null = null;
  private cmdDescEl: HTMLDivElement | null = null;
  private cmdActionsEl: HTMLDivElement | null = null;
  private startTutBtnEl: HTMLButtonElement | null = null;
  private launchRecBtnEl: HTMLButtonElement | null = null;
  private allContractsBtnEl: HTMLButtonElement | null = null;

  // Utility column persistent elements
  private utilityColEl: HTMLDivElement | null = null;
  private campaignBannerEl: HTMLDivElement | null = null;
  private cbToggleBtnEl: HTMLButtonElement | null = null;
  private cbEyebrowEl: HTMLSpanElement | null = null;
  private cbChevronEl: HTMLSpanElement | null = null;
  private cbOpenBtnEl: HTMLButtonElement | null = null;
  private cbUnreadDotEl: HTMLSpanElement | null = null;
  private cbBodyEl: HTMLDivElement | null = null;
  private cbHeadlineEl: HTMLElement | null = null;
  private cbDetailEl: HTMLElement | null = null;
  private cbProgressFillEl: HTMLSpanElement | null = null;

  private relicStripEl: HTMLDivElement | null = null;
  private nextGoalBtnEl: HTMLButtonElement | null = null;
  private nextGoalKEl: HTMLSpanElement | null = null;
  private nextGoalTitleEl: HTMLElement | null = null;
  private nextGoalDetailEl: HTMLElement | null = null;

  private stationDockEl: HTMLDivElement | null = null;
  private dockWhBtnEl: HTMLButtonElement | null = null;
  private dockWhNumEl: HTMLElement | null = null;
  private dockFacBtnEl: HTMLButtonElement | null = null;
  private dockFacNumEl: HTMLElement | null = null;
  private dockRelicsBtnEl: HTMLButtonElement | null = null;
  private dockRelicsNumEl: HTMLElement | null = null;
  private dockCodexBtnEl: HTMLButtonElement | null = null;
  private dockCodexNumEl: HTMLElement | null = null;
  private dockCareerBtnEl: HTMLButtonElement | null = null;
  private dockCareerNumEl: HTMLElement | null = null;
  private dockCareerBadgeEl: HTMLSpanElement | null = null;

  private latestActions: BaseViewActions | null = null;
  private latestDockingActions: DockingNoticeActions | null = null;
  private latestRecContractId = 'rescue_std';
  private latestNextGoalKind: NextBaseGoal['actionKind'] = 'facilities';

  private lastStageTagMode: boolean | null = null;
  private lastCmdEyebrowKey: string | null = null;
  private lastCbEyebrowKey: string | null = null;
  private lastCbCollapsed: boolean | null = null;
  private lastRelicStripKey: string | null = null;

  private readonly handleRootClick = (ev: Event): void => {
    if (!this.rootEl) return;
    const target = ev.target as HTMLElement | null;
    if (!target || typeof target.closest !== 'function') return;
    const btn = target.closest('button') as HTMLButtonElement | null;
    if (!btn || !this.rootEl.contains(btn) || btn.disabled) return;

    if (btn === this.skipDockBtnEl || btn.id === 'v2-skip-dock') {
      (this.latestDockingActions ?? this.latestActions)?.onSkipDocking();
      return;
    }
    if (btn === this.closeDockBtnEl || btn.id === 'v2-close-dock') {
      (this.latestDockingActions ?? this.latestActions)?.onCloseDocking();
      return;
    }

    const actions = this.latestActions;
    if (!actions) return;

    if (btn === this.startTutBtnEl || btn.id === 'v2-base-start-tut') {
      actions.onStartTutorial();
    } else if (btn === this.launchRecBtnEl || btn.id === 'v2-base-launch-rec') {
      actions.onLaunchRecommended(this.latestRecContractId);
    } else if (btn === this.allContractsBtnEl || btn.id === 'v2-base-all-contracts') {
      actions.onOpenContracts();
    } else if (btn === this.cbToggleBtnEl || btn.id === 'v3-cb-toggle') {
      actions.onToggleCampaignBanner();
    } else if (btn === this.cbOpenBtnEl || btn.id === 'v3-btn-open-campaign') {
      actions.onOpenCampaign();
    } else if (btn === this.nextGoalBtnEl || btn.id === 'v2-base-next-goal') {
      actions.onOpenGoal(this.latestNextGoalKind);
    } else if (btn === this.dockWhBtnEl || btn.id === 'v2-dock-wh') {
      actions.onOpenWarehouse();
    } else if (btn === this.dockFacBtnEl || btn.id === 'v2-dock-fac') {
      actions.onOpenFacilities();
    } else if (btn === this.dockRelicsBtnEl || btn.id === 'v2-dock-relics') {
      actions.onOpenRelics();
    } else if (btn === this.dockCodexBtnEl || btn.id === 'v2-dock-codex') {
      actions.onOpenCodex();
    } else if (btn === this.dockCareerBtnEl || btn.id === 'v2-dock-career') {
      actions.onOpenCareer();
    }
  };

  isMountedIn(host: HTMLElement): boolean {
    return Boolean(this.hostEl === host && this.rootEl && this.rootEl.parentElement === host);
  }

  mount(host: HTMLElement): void {
    if (this.isMountedIn(host)) return;
    if (this.rootEl || this.hostEl) {
      this.unmount();
    }
    this.hostEl = host;
    host.innerHTML = '';

    // Root strictly preserves PR #3 .v3-overlay-screen direct children contract:
    // 1. .scene-stage-tag, 2. [data-slot="docking-notice"], 3. .v2-base-hero-hud
    const root = document.createElement('div');
    root.className = 'v3-overlay-screen v2-base-screen-root';
    root.dataset.testid = 'base-screen';
    root.dataset.tutorialFocus = 'false';

    const stageTag = document.createElement('div');
    stageTag.className = 'scene-stage-tag';
    root.appendChild(stageTag);

    // Docking notice slot & persistent card (detached until notice !== null)
    const dockingSlot = document.createElement('div');
    dockingSlot.dataset.slot = 'docking-notice';
    root.appendChild(dockingSlot);

    const dockingCard = document.createElement('div');
    dockingCard.className = 'docking-overlay-card';
    const dockingTitle = document.createElement('div');
    dockingTitle.className = 'docking-title';
    dockingCard.appendChild(dockingTitle);

    const dockingStats = document.createElement('div');
    dockingStats.className = 'docking-stats';

    const dockingEarnedWrap = document.createElement('span');
    dockingEarnedWrap.textContent = '本次入账 ';
    const dockingEarnedVal = document.createElement('strong');
    dockingEarnedVal.className = 'num';
    dockingEarnedWrap.appendChild(dockingEarnedVal);
    dockingStats.appendChild(dockingEarnedWrap);

    const dockingPartsWrap = document.createElement('span');
    dockingPartsWrap.textContent = '精密零件 ';
    const dockingPartsVal = document.createElement('strong');
    dockingPartsVal.className = 'num';
    dockingPartsWrap.appendChild(dockingPartsVal);

    const dockingBalanceWrap = document.createElement('span');
    dockingBalanceWrap.textContent = '基地余额 ';
    const dockingBalanceVal = document.createElement('strong');
    dockingBalanceVal.className = 'num';
    dockingBalanceWrap.appendChild(dockingBalanceVal);
    dockingStats.appendChild(dockingBalanceWrap);
    dockingCard.appendChild(dockingStats);

    const dockingUnlock = document.createElement('div');
    dockingUnlock.className = 'docking-unlock';

    const dockingActions = document.createElement('div');
    dockingActions.className = 'docking-actions';

    const skipDockBtn = document.createElement('button');
    skipDockBtn.type = 'button';
    skipDockBtn.className = 'btn btn-sm btn-secondary';
    skipDockBtn.id = 'v2-skip-dock';
    skipDockBtn.textContent = '跳过靠泊';

    const closeDockBtn = document.createElement('button');
    closeDockBtn.type = 'button';
    closeDockBtn.className = 'btn btn-sm btn-primary';
    closeDockBtn.id = 'v2-close-dock';
    closeDockBtn.textContent = '收起';

    dockingCard.appendChild(dockingActions);

    // Base Hero HUD
    const heroHud = document.createElement('div');
    heroHud.className = 'v2-base-hero-hud';

    // Command Card
    const cmdCard = document.createElement('div');
    cmdCard.className = 'v2-base-cmd-card';

    const cmdEyebrow = document.createElement('div');
    cmdEyebrow.className = 'v2-cmd-eyebrow';
    cmdCard.appendChild(cmdEyebrow);

    const cmdTitle = document.createElement('div');
    cmdTitle.className = 'v2-cmd-title';
    cmdCard.appendChild(cmdTitle);

    const cmdDesc = document.createElement('div');
    cmdDesc.className = 'v2-cmd-desc';
    cmdCard.appendChild(cmdDesc);

    const cmdActions = document.createElement('div');
    cmdActions.className = 'v2-cmd-actions';

    const startTutBtn = document.createElement('button');
    startTutBtn.type = 'button';
    startTutBtn.className = 'btn btn-primary btn-launch-hero';
    startTutBtn.id = 'v2-base-start-tut';
    startTutBtn.dataset.testid = 'btn-start-tutorial';
    startTutBtn.innerHTML = `${svgIcon('rocket', 16)} 启动首航教学`;

    const launchRecBtn = document.createElement('button');
    launchRecBtn.type = 'button';
    launchRecBtn.className = 'btn btn-primary btn-launch-hero';
    launchRecBtn.id = 'v2-base-launch-rec';
    launchRecBtn.dataset.testid = 'btn-start-recommended';
    launchRecBtn.dataset.action = 'start-recommended';
    launchRecBtn.innerHTML = `${svgIcon('rocket', 16)} 接取并整备出航`;

    const allContractsBtn = document.createElement('button');
    allContractsBtn.type = 'button';
    allContractsBtn.className = 'btn btn-secondary';
    allContractsBtn.id = 'v2-base-all-contracts';
    allContractsBtn.dataset.testid = 'btn-open-contracts';
    cmdActions.appendChild(allContractsBtn);

    cmdCard.appendChild(cmdActions);
    heroHud.appendChild(cmdCard);

    // Utility Column
    const utilityCol = document.createElement('div');
    utilityCol.className = 'v2-base-utility-col';

    // Campaign Banner
    const campaignBanner = document.createElement('div');
    campaignBanner.className = 'v3-campaign-banner';
    campaignBanner.dataset.testid = 'campaign-banner';

    const cbHeader = document.createElement('div');
    cbHeader.className = 'v3-cb-header';

    const cbToggleBtn = document.createElement('button');
    cbToggleBtn.type = 'button';
    cbToggleBtn.className = 'v3-cb-toggle';
    cbToggleBtn.id = 'v3-cb-toggle';
    cbToggleBtn.dataset.testid = 'btn-toggle-campaign-banner';
    const cbEyebrow = document.createElement('span');
    cbEyebrow.className = 'v3-cb-eyebrow';
    const cbChevron = document.createElement('span');
    cbChevron.className = 'v3-cb-chevron';
    cbToggleBtn.appendChild(cbEyebrow);
    cbToggleBtn.appendChild(cbChevron);
    cbHeader.appendChild(cbToggleBtn);

    const cbOpenBtn = document.createElement('button');
    cbOpenBtn.type = 'button';
    cbOpenBtn.className = 'btn btn-sm btn-secondary v3-cb-open-btn';
    cbOpenBtn.id = 'v3-btn-open-campaign';
    cbOpenBtn.dataset.testid = 'btn-open-campaign';
    const cbOpenText = document.createElement('span');
    cbOpenText.textContent = '主线档案';
    cbOpenBtn.appendChild(cbOpenText);
    const cbUnreadDot = document.createElement('span');
    cbUnreadDot.className = 'v3-unread-dot';
    cbUnreadDot.setAttribute('aria-label', '未读通讯');
    cbHeader.appendChild(cbOpenBtn);
    campaignBanner.appendChild(cbHeader);

    const cbBody = document.createElement('div');
    cbBody.className = 'v3-cb-body';
    const cbObj = document.createElement('div');
    cbObj.className = 'v3-cb-obj';
    const cbHeadline = document.createElement('strong');
    const cbDetail = document.createElement('small');
    cbObj.appendChild(cbHeadline);
    cbObj.appendChild(cbDetail);
    const cbTrack = document.createElement('div');
    cbTrack.className = 'v3-cb-progress-track';
    cbTrack.setAttribute('aria-label', '主线推进进度');
    const cbFill = document.createElement('span');
    cbTrack.appendChild(cbFill);
    cbBody.appendChild(cbObj);
    cbBody.appendChild(cbTrack);
    utilityCol.appendChild(campaignBanner);

    // Relic passives strip (detached when empty)
    const relicStrip = document.createElement('div');
    relicStrip.className = 'v3-relic-passive-strip';
    relicStrip.dataset.testid = 'active-relic-passives';

    // Next goal button (detached during tutorial focus!)
    const nextGoalBtn = document.createElement('button');
    nextGoalBtn.type = 'button';
    nextGoalBtn.className = 'v2-next-goal-pill';
    nextGoalBtn.id = 'v2-base-next-goal';
    const nextGoalK = document.createElement('span');
    nextGoalK.className = 'v2-goal-k';
    const nextGoalTitle = document.createElement('strong');
    const nextGoalDetail = document.createElement('small');
    nextGoalBtn.appendChild(nextGoalK);
    nextGoalBtn.appendChild(nextGoalTitle);
    nextGoalBtn.appendChild(nextGoalDetail);

    // Station Dock (5 persistent buttons; <small class="num"> detached during tutorial focus!)
    const stationDock = document.createElement('div');
    stationDock.className = 'v2-station-dock';
    stationDock.setAttribute('role', 'toolbar');
    stationDock.setAttribute('aria-label', '空间站功能区');

    const makeDockBtn = (
      id: string,
      testid: string,
      iconName: 'warehouse' | 'wrench' | 'museum' | 'book' | 'medal',
      label: string
    ): { btn: HTMLButtonElement; num: HTMLElement } => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'v2-dock-btn';
      btn.id = id;
      btn.dataset.testid = testid;
      btn.innerHTML = `${svgIcon(iconName, 17)}<span>${label}</span>`;
      const num = document.createElement('small');
      num.className = 'num';
      stationDock.appendChild(btn);
      return { btn, num };
    };

    const wh = makeDockBtn('v2-dock-wh', 'btn-open-warehouse', 'warehouse', '设备工坊');
    const fac = makeDockBtn('v2-dock-fac', 'btn-open-facilities', 'wrench', '设施扩建');
    const rel = makeDockBtn('v2-dock-relics', 'btn-open-relics', 'museum', '藏品馆');
    const cod = makeDockBtn('v2-dock-codex', 'btn-open-codex', 'book', '图鉴');
    const car = makeDockBtn('v2-dock-career', 'btn-open-career', 'medal', '生涯档案');

    const careerBadge = document.createElement('span');
    careerBadge.className = 'v3-dock-badge-dot';
    careerBadge.setAttribute('aria-label', '可领取成就');

    utilityCol.appendChild(stationDock);
    heroHud.appendChild(utilityCol);
    root.appendChild(heroHud);
    host.appendChild(root);

    root.addEventListener('click', this.handleRootClick);

    this.rootEl = root;
    this.stageTagEl = stageTag;
    this.dockingSlotEl = dockingSlot;
    this.dockingCardEl = dockingCard;
    this.dockingTitleEl = dockingTitle;
    this.dockingStatsEl = dockingStats;
    this.dockingEarnedValEl = dockingEarnedVal;
    this.dockingPartsWrapEl = dockingPartsWrap;
    this.dockingPartsValEl = dockingPartsVal;
    this.dockingBalanceWrapEl = dockingBalanceWrap;
    this.dockingBalanceValEl = dockingBalanceVal;
    this.dockingUnlockEl = dockingUnlock;
    this.dockingActionsEl = dockingActions;
    this.skipDockBtnEl = skipDockBtn;
    this.closeDockBtnEl = closeDockBtn;
    this.cmdEyebrowEl = cmdEyebrow;
    this.cmdTitleEl = cmdTitle;
    this.cmdDescEl = cmdDesc;
    this.cmdActionsEl = cmdActions;
    this.startTutBtnEl = startTutBtn;
    this.launchRecBtnEl = launchRecBtn;
    this.allContractsBtnEl = allContractsBtn;
    this.utilityColEl = utilityCol;
    this.campaignBannerEl = campaignBanner;
    this.cbToggleBtnEl = cbToggleBtn;
    this.cbEyebrowEl = cbEyebrow;
    this.cbChevronEl = cbChevron;
    this.cbOpenBtnEl = cbOpenBtn;
    this.cbUnreadDotEl = cbUnreadDot;
    this.cbBodyEl = cbBody;
    this.cbHeadlineEl = cbHeadline;
    this.cbDetailEl = cbDetail;
    this.cbProgressFillEl = cbFill;
    this.relicStripEl = relicStrip;
    this.nextGoalBtnEl = nextGoalBtn;
    this.nextGoalKEl = nextGoalK;
    this.nextGoalTitleEl = nextGoalTitle;
    this.nextGoalDetailEl = nextGoalDetail;
    this.stationDockEl = stationDock;
    this.dockWhBtnEl = wh.btn;
    this.dockWhNumEl = wh.num;
    this.dockFacBtnEl = fac.btn;
    this.dockFacNumEl = fac.num;
    this.dockRelicsBtnEl = rel.btn;
    this.dockRelicsNumEl = rel.num;
    this.dockCodexBtnEl = cod.btn;
    this.dockCodexNumEl = cod.num;
    this.dockCareerBtnEl = car.btn;
    this.dockCareerNumEl = car.num;
    this.dockCareerBadgeEl = careerBadge;

    mountedBaseViews.set(host, this);
  }

  updateDockingNotice(
    activeDockingNotice: V2ReturnDockingNotice | null,
    actions?: DockingNoticeActions
  ): boolean {
    if (actions) {
      this.latestDockingActions = actions;
    }
    if (
      !this.dockingSlotEl ||
      !this.dockingCardEl ||
      !this.dockingTitleEl ||
      !this.dockingStatsEl ||
      !this.dockingEarnedValEl ||
      !this.dockingPartsWrapEl ||
      !this.dockingPartsValEl ||
      !this.dockingBalanceWrapEl ||
      !this.dockingBalanceValEl ||
      !this.dockingUnlockEl ||
      !this.dockingActionsEl ||
      !this.skipDockBtnEl ||
      !this.closeDockBtnEl
    ) {
      return false;
    }

    if (!activeDockingNotice) {
      if (this.dockingCardEl.parentElement) {
        this.dockingCardEl.remove();
      }
      return true;
    }

    const n = activeDockingNotice;
    if (this.dockingCardEl.parentElement !== this.dockingSlotEl) {
      this.dockingSlotEl.appendChild(this.dockingCardEl);
    }

    const titleText = n.wasDefeat
      ? '拖船已将受损舰体拖回拆解站'
      : n.contractCompleted
      ? '委托交付完成 · 货船安全靠泊'
      : '货船安全返航 · 卸货入账完毕';
    if (this.dockingTitleEl.textContent !== titleText) {
      this.dockingTitleEl.textContent = titleText;
    }

    const earnedText = `+${n.earnedCredits}¤`;
    if (this.dockingEarnedValEl.textContent !== earnedText) {
      this.dockingEarnedValEl.textContent = earnedText;
    }

    if ((n.earnedParts ?? 0) > 0) {
      const partsText = `+${n.earnedParts}`;
      if (this.dockingPartsValEl.textContent !== partsText) {
        this.dockingPartsValEl.textContent = partsText;
      }
      if (this.dockingPartsWrapEl.parentElement !== this.dockingStatsEl) {
        this.dockingStatsEl.insertBefore(this.dockingPartsWrapEl, this.dockingBalanceWrapEl);
      }
    } else if (this.dockingPartsWrapEl.parentElement) {
      this.dockingPartsWrapEl.remove();
    }

    const shownCredits = n.animating
      ? Math.round(n.creditsBefore + (n.creditsAfter - n.creditsBefore) * n.progress)
      : n.creditsAfter;
    const balanceText = `${shownCredits}¤`;
    if (this.dockingBalanceValEl.textContent !== balanceText) {
      this.dockingBalanceValEl.textContent = balanceText;
    }

    if (n.unlockedText) {
      if (this.dockingUnlockEl.textContent !== n.unlockedText) {
        this.dockingUnlockEl.textContent = n.unlockedText;
      }
      if (this.dockingUnlockEl.parentElement !== this.dockingCardEl) {
        this.dockingCardEl.insertBefore(this.dockingUnlockEl, this.dockingActionsEl);
      }
    } else if (this.dockingUnlockEl.parentElement) {
      this.dockingUnlockEl.remove();
    }

    if (n.animating) {
      if (this.closeDockBtnEl.parentElement) this.closeDockBtnEl.remove();
      if (this.skipDockBtnEl.parentElement !== this.dockingActionsEl) {
        this.dockingActionsEl.appendChild(this.skipDockBtnEl);
      }
    } else {
      if (this.skipDockBtnEl.parentElement) this.skipDockBtnEl.remove();
      if (this.closeDockBtnEl.parentElement !== this.dockingActionsEl) {
        this.dockingActionsEl.appendChild(this.closeDockBtnEl);
      }
    }
    return true;
  }

  update(props: BaseViewProps, actions: BaseViewActions): void {
    this.latestActions = actions;
    this.latestDockingActions = {
      onSkipDocking: actions.onSkipDocking,
      onCloseDocking: actions.onCloseDocking,
    };
    if (!this.rootEl) return;

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
    const recTpl = V2_CONTRACT_TEMPLATES[recommendedContractId] ?? V2_CONTRACT_TEMPLATES.rescue_std;
    const isTutorialFocus = !p.tutorialCompleted;
    this.latestRecContractId = recTpl.templateId;
    this.latestNextGoalKind = nextGoal.actionKind;

    // Root classes & tutorial focus attribute
    this.rootEl.classList.toggle('is-tutorial-focus', isTutorialFocus);
    const tfVal = isTutorialFocus ? 'true' : 'false';
    if (this.rootEl.dataset.tutorialFocus !== tfVal) {
      this.rootEl.dataset.tutorialFocus = tfVal;
    }

    // Stage tag
    if (this.stageTagEl && this.lastStageTagMode !== isTutorialFocus) {
      this.lastStageTagMode = isTutorialFocus;
      this.stageTagEl.innerHTML = `${svgIcon('beacon', 13)} ${
        isTutorialFocus
          ? '星际拆解站 · 首航待命，点击下方启动首航教学'
          : '星际拆解站 · 点击站内设施或下方指令泊位管理'
      }`;
    }

    // Docking notice
    this.updateDockingNotice(activeDockingNotice, this.latestDockingActions);

    // Command card
    const cmdEyebrowText = isTutorialFocus
      ? '推荐首航'
      : `当前推荐委托 · ${recTpl.rewardCredits > 0 ? `+${recTpl.rewardCredits}¤` : '自由打捞'}`;
    if (this.cmdEyebrowEl && this.lastCmdEyebrowKey !== cmdEyebrowText) {
      this.lastCmdEyebrowKey = cmdEyebrowText;
      this.cmdEyebrowEl.innerHTML = `${svgIcon('star', 13)} ${cmdEyebrowText}`;
    }

    const cmdTitleText = isTutorialFocus ? '首航教学 · 2×3 密封反应堆' : recTpl.name;
    if (this.cmdTitleEl && this.cmdTitleEl.textContent !== cmdTitleText) {
      this.cmdTitleEl.textContent = cmdTitleText;
    }

    const cmdDescText = isTutorialFocus
      ? '4 层首航教学：亲手装电池接通激光炮、切开残骸、取舍 2×3 密封反应堆，完成后免费通电工作台并奖 +40¤。'
      : `${recTpl.gameplayNote}${recTpl.spaceNote ? ` · ${recTpl.spaceNote}` : ''}`;
    if (this.cmdDescEl && this.cmdDescEl.textContent !== cmdDescText) {
      this.cmdDescEl.textContent = cmdDescText;
    }

    if (this.cmdActionsEl && this.startTutBtnEl && this.launchRecBtnEl && this.allContractsBtnEl) {
      if (isTutorialFocus) {
        if (this.launchRecBtnEl.parentElement) this.launchRecBtnEl.remove();
        if (this.startTutBtnEl.parentElement !== this.cmdActionsEl) {
          this.cmdActionsEl.insertBefore(this.startTutBtnEl, this.allContractsBtnEl);
        }
        syncButtonDisabled(this.startTutBtnEl, readOnly);
        if (this.allContractsBtnEl.textContent !== '委托终端') {
          this.allContractsBtnEl.textContent = '委托终端';
        }
      } else {
        if (this.startTutBtnEl.parentElement) this.startTutBtnEl.remove();
        if (this.launchRecBtnEl.parentElement !== this.cmdActionsEl) {
          this.cmdActionsEl.insertBefore(this.launchRecBtnEl, this.allContractsBtnEl);
        }
        syncButtonDisabled(this.launchRecBtnEl, readOnly);
        if (this.allContractsBtnEl.textContent !== '全部委托') {
          this.allContractsBtnEl.textContent = '全部委托';
        }
      }
    }

    // Campaign banner
    if (
      this.campaignBannerEl &&
      this.cbToggleBtnEl &&
      this.cbEyebrowEl &&
      this.cbChevronEl &&
      this.cbOpenBtnEl &&
      this.cbUnreadDotEl &&
      this.cbBodyEl &&
      this.cbHeadlineEl &&
      this.cbDetailEl &&
      this.cbProgressFillEl
    ) {
      this.campaignBannerEl.classList.toggle('is-collapsed', collapsed);
      const expandedStr = String(!collapsed);
      if (this.cbToggleBtnEl.getAttribute('aria-expanded') !== expandedStr) {
        this.cbToggleBtnEl.setAttribute('aria-expanded', expandedStr);
      }

      if (this.lastCbEyebrowKey !== camp.actLabel) {
        this.lastCbEyebrowKey = camp.actLabel;
        this.cbEyebrowEl.innerHTML = `${svgIcon('campaign', 13)} 星门重启计划 · ${camp.actLabel}`;
      }
      if (this.lastCbCollapsed !== collapsed) {
        this.lastCbCollapsed = collapsed;
        this.cbChevronEl.innerHTML = svgIcon(collapsed ? 'chevronUp' : 'chevronDown', 13);
      }

      if (camp.unreadCommsCount > 0) {
        const cntStr = String(camp.unreadCommsCount);
        if (this.cbUnreadDotEl.textContent !== cntStr) {
          this.cbUnreadDotEl.textContent = cntStr;
        }
        if (this.cbUnreadDotEl.parentElement !== this.cbOpenBtnEl) {
          this.cbOpenBtnEl.appendChild(this.cbUnreadDotEl);
        }
      } else if (this.cbUnreadDotEl.parentElement) {
        this.cbUnreadDotEl.remove();
      }

      if (!collapsed) {
        if (this.cbHeadlineEl.textContent !== camp.headline) {
          this.cbHeadlineEl.textContent = camp.headline;
        }
        if (this.cbDetailEl.textContent !== camp.detail) {
          this.cbDetailEl.textContent = camp.detail;
        }
        const pctWidth = `${camp.progressPct}%`;
        if (this.cbProgressFillEl.style.width !== pctWidth) {
          this.cbProgressFillEl.style.width = pctWidth;
        }
        if (this.cbBodyEl.parentElement !== this.campaignBannerEl) {
          this.campaignBannerEl.appendChild(this.cbBodyEl);
        }
      } else if (this.cbBodyEl.parentElement) {
        this.cbBodyEl.remove();
      }
    }

    // Active relic passives strip
    const relicPassives = getActiveRelicPassives(p);
    if (this.utilityColEl && this.relicStripEl && this.stationDockEl) {
      if (relicPassives.activeRelicIds.length > 0) {
        const key = relicPassives.activeRelicIds.join(',');
        if (this.lastRelicStripKey !== key) {
          this.lastRelicStripKey = key;
          this.relicStripEl.innerHTML = relicPassives.activeRelicIds
            .map(
              (rid) =>
                `<span class="v3-relic-passive-pill">${svgIcon('museum', 11)} ${
                  V3_RELIC_PASSIVES[rid]?.shortBadge ?? rid
                }</span>`
            )
            .join('');
        }
        const anchor =
          this.nextGoalBtnEl && this.nextGoalBtnEl.parentElement === this.utilityColEl
            ? this.nextGoalBtnEl
            : this.stationDockEl;
        if (this.relicStripEl.parentElement !== this.utilityColEl) {
          this.utilityColEl.insertBefore(this.relicStripEl, anchor);
        }
      } else {
        this.lastRelicStripKey = null;
        if (this.relicStripEl.parentElement) {
          this.relicStripEl.remove();
        }
      }
    }

    // Next goal button (strictly detached during Step-0 tutorial focus)
    if (
      this.utilityColEl &&
      this.nextGoalBtnEl &&
      this.nextGoalKEl &&
      this.nextGoalTitleEl &&
      this.nextGoalDetailEl &&
      this.stationDockEl
    ) {
      if (isTutorialFocus) {
        if (this.nextGoalBtnEl.parentElement) {
          this.nextGoalBtnEl.remove();
        }
      } else {
        this.nextGoalBtnEl.classList.toggle('is-ready', nextGoal.ready);
        const kText = nextGoal.ready ? '下一步就绪' : '下一个基地目标';
        if (this.nextGoalKEl.textContent !== kText) this.nextGoalKEl.textContent = kText;
        if (this.nextGoalTitleEl.textContent !== nextGoal.title) {
          this.nextGoalTitleEl.textContent = nextGoal.title;
        }
        if (this.nextGoalDetailEl.textContent !== nextGoal.detail) {
          this.nextGoalDetailEl.textContent = nextGoal.detail;
        }
        if (this.nextGoalBtnEl.parentElement !== this.utilityColEl) {
          this.utilityColEl.insertBefore(this.nextGoalBtnEl, this.stationDockEl);
        }
      }
    }

    // Station dock counts (strictly detached during Step-0 tutorial focus!)
    const warehouseCap = getEffectiveWarehouseCapacity(p);
    const claimableAchCount = getClaimableAchievementCount(p);

    const syncDockNum = (
      btn: HTMLButtonElement | null,
      numEl: HTMLElement | null,
      text: string
    ): void => {
      if (!btn || !numEl) return;
      if (isTutorialFocus) {
        if (numEl.parentElement) numEl.remove();
      } else {
        if (numEl.textContent !== text) numEl.textContent = text;
        if (numEl.parentElement !== btn) btn.appendChild(numEl);
      }
    };

    syncDockNum(
      this.dockWhBtnEl,
      this.dockWhNumEl,
      `${p.equipmentWarehouse.length}/${warehouseCap} · ${p.salvageParts}零件${
        p.pendingGiftQueue.length > 0 ? ` +${p.pendingGiftQueue.length}` : ''
      }`
    );
    syncDockNum(
      this.dockFacBtnEl,
      this.dockFacNumEl,
      `${p.unlockedShips.length}/${V2_SHIP_ORDER.length} 舰`
    );
    syncDockNum(
      this.dockRelicsBtnEl,
      this.dockRelicsNumEl,
      `${relicSum.restoredCount}/${relicSum.totalCount}`
    );
    syncDockNum(
      this.dockCodexBtnEl,
      this.dockCodexNumEl,
      `${p.blueprints.length}/${V2_ALL_EQUIPMENT_KINDS.length} 蓝图`
    );
    syncDockNum(
      this.dockCareerBtnEl,
      this.dockCareerNumEl,
      `${p.achievementsUnlocked.length}/18 成就`
    );

    if (this.dockCareerBtnEl && this.dockCareerBadgeEl) {
      if (!isTutorialFocus && claimableAchCount > 0) {
        const badgeText = String(claimableAchCount);
        if (this.dockCareerBadgeEl.textContent !== badgeText) {
          this.dockCareerBadgeEl.textContent = badgeText;
        }
        if (this.dockCareerBadgeEl.parentElement !== this.dockCareerBtnEl) {
          this.dockCareerBtnEl.insertBefore(
            this.dockCareerBadgeEl,
            this.dockCareerBtnEl.childNodes[0] ?? null
          );
        }
      } else if (this.dockCareerBadgeEl.parentElement) {
        this.dockCareerBadgeEl.remove();
      }
    }
  }

  unmount(): void {
    if (this.hostEl && mountedBaseViews.get(this.hostEl) === this) {
      mountedBaseViews.delete(this.hostEl);
    }
    this.rootEl?.removeEventListener('click', this.handleRootClick);
    this.rootEl?.remove();
    this.hostEl = null;
    this.rootEl = null;
    this.stageTagEl = null;
    this.dockingSlotEl = null;
    this.dockingCardEl = null;
    this.dockingTitleEl = null;
    this.dockingStatsEl = null;
    this.dockingEarnedValEl = null;
    this.dockingPartsWrapEl = null;
    this.dockingPartsValEl = null;
    this.dockingBalanceWrapEl = null;
    this.dockingBalanceValEl = null;
    this.dockingUnlockEl = null;
    this.dockingActionsEl = null;
    this.skipDockBtnEl = null;
    this.closeDockBtnEl = null;
    this.cmdEyebrowEl = null;
    this.cmdTitleEl = null;
    this.cmdDescEl = null;
    this.cmdActionsEl = null;
    this.startTutBtnEl = null;
    this.launchRecBtnEl = null;
    this.allContractsBtnEl = null;
    this.utilityColEl = null;
    this.campaignBannerEl = null;
    this.cbToggleBtnEl = null;
    this.cbEyebrowEl = null;
    this.cbChevronEl = null;
    this.cbOpenBtnEl = null;
    this.cbUnreadDotEl = null;
    this.cbBodyEl = null;
    this.cbHeadlineEl = null;
    this.cbDetailEl = null;
    this.cbProgressFillEl = null;
    this.relicStripEl = null;
    this.nextGoalBtnEl = null;
    this.nextGoalKEl = null;
    this.nextGoalTitleEl = null;
    this.nextGoalDetailEl = null;
    this.stationDockEl = null;
    this.dockWhBtnEl = null;
    this.dockWhNumEl = null;
    this.dockFacBtnEl = null;
    this.dockFacNumEl = null;
    this.dockRelicsBtnEl = null;
    this.dockRelicsNumEl = null;
    this.dockCodexBtnEl = null;
    this.dockCodexNumEl = null;
    this.dockCareerBtnEl = null;
    this.dockCareerNumEl = null;
    this.dockCareerBadgeEl = null;
    this.latestActions = null;
    this.latestDockingActions = null;
    this.lastStageTagMode = null;
    this.lastCmdEyebrowKey = null;
    this.lastCbEyebrowKey = null;
    this.lastCbCollapsed = null;
    this.lastRelicStripKey = null;
  }
}

export function updateBaseDockingNotice(
  overlayEl: HTMLElement,
  activeDockingNotice: V2ReturnDockingNotice | null,
  actions: DockingNoticeActions
): boolean {
  const mounted = mountedBaseViews.get(overlayEl);
  if (mounted && mounted.isMountedIn(overlayEl)) {
    return mounted.updateDockingNotice(activeDockingNotice, actions);
  }
  const slot = overlayEl.querySelector<HTMLElement>('[data-slot="docking-notice"]');
  if (!slot) return false;
  if (!activeDockingNotice) {
    slot.innerHTML = '';
    return true;
  }
  const n = activeDockingNotice;
  const shownCredits = n.animating
    ? Math.round(n.creditsBefore + (n.creditsAfter - n.creditsBefore) * n.progress)
    : n.creditsAfter;
  slot.innerHTML = `
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
  slot.querySelector('#v2-skip-dock')?.addEventListener('click', actions.onSkipDocking);
  slot.querySelector('#v2-close-dock')?.addEventListener('click', actions.onCloseDocking);
  return true;
}

const legacyBaseViews = new WeakMap<HTMLElement, BasePhaseView>();

export function renderBaseHeroView(
  overlayEl: HTMLElement,
  props: BaseViewProps,
  actions: BaseViewActions
): void {
  let view = legacyBaseViews.get(overlayEl);
  if (!view) {
    view = new BasePhaseView();
    legacyBaseViews.set(overlayEl, view);
  }
  if (!view.isMountedIn(overlayEl)) {
    view.mount(overlayEl);
  }
  view.update(props, actions);
}
