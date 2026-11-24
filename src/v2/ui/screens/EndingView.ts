import { getSectorBgImageUrl } from '../../../assets/itemArt';
import { V3_FACTIONS } from '../../data/factions';
import {
  V3_ENDINGS,
  V3_ENDING_ORDER,
  buildDynamicEndingEpilogue,
} from '../../data/lore';
import { getRestoredRelicCount } from '../../domain/campaign';
import type { EndingId, V2ProfileState, V2RunState } from '../../domain/types';
import { crewPortraitSvg, svgIcon } from '../icons';
import type { PhaseView } from './screenTypes';

export interface EndingViewProps {
  readonly profile: V2ProfileState;
  readonly mode: 'climax' | 'gallery';
  readonly selectedEndingId: EndingId | null;
  readonly climaxRun: V2RunState | null;
  readonly readOnly: boolean;
}

export interface EndingViewActions {
  readonly onSelectEnding: (endingId: EndingId) => void;
  readonly onClearSelection: () => void;
  readonly onContinueToBase: () => void;
}

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

export class EndingPhaseView implements PhaseView<EndingViewProps, EndingViewActions> {
  private hostEl: HTMLElement | null = null;
  private rootEl: HTMLDivElement | null = null;

  // Stage 1: Victory Ceremony & 3-Way Climax Choice
  private choiceCardEl: HTMLDivElement | null = null;
  private choiceStatsEl: HTMLDivElement | null = null;
  private readonly choiceBtns = new Map<EndingId, HTMLButtonElement>();
  private readonly choiceStatusEls = new Map<EndingId, HTMLSpanElement>();
  private lastChoiceStatsKey: string | null = null;

  // Stage 2: Chosen Ending Epilogue
  private epilogueCardEl: HTMLDivElement | null = null;
  private epilogueBodyHostEl: HTMLDivElement | null = null;
  private epilogueFooterEl: HTMLDivElement | null = null;
  private rechooseBtnEl: HTMLButtonElement | null = null;
  private continueBtnEl: HTMLButtonElement | null = null;
  private continueLabelEl: HTMLSpanElement | null = null;
  private lastEpilogueKey: string | null = null;

  private latestActions: EndingViewActions | null = null;

  private readonly handleRootClick = (ev: Event): void => {
    if (!this.rootEl || !this.latestActions) return;
    const target = ev.target as HTMLElement | null;
    if (!target || typeof target.closest !== 'function') return;
    const btn = target.closest('button') as HTMLButtonElement | null;
    if (!btn || !this.rootEl.contains(btn) || btn.disabled) return;

    const choiceId = btn.dataset.endingChoice as EndingId | undefined;
    if (choiceId) {
      this.latestActions.onSelectEnding(choiceId);
      return;
    }
    if (btn === this.rechooseBtnEl || btn.id === 'v3-btn-ending-rechoose') {
      this.latestActions.onClearSelection();
      return;
    }
    if (btn === this.continueBtnEl || btn.id === 'v3-btn-ending-continue') {
      this.latestActions.onContinueToBase();
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

    // Persistent outer backdrop & background image (zero flicker across Stage 1 <-> Stage 2!)
    const root = document.createElement('div');
    root.className = 'v3-ending-backdrop';
    root.dataset.testid = 'ending-screen';
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', '星门终局庆典');

    const bg = document.createElement('div');
    bg.className = 'v3-ending-bg';
    bg.style.backgroundImage = `url('${getSectorBgImageUrl(6)}')`;
    bg.setAttribute('aria-hidden', 'true');
    root.appendChild(bg);

    // Stage 1 card (detached when showing Stage 2)
    const choiceCard = document.createElement('div');
    choiceCard.className = 'v3-ending-card v3-ending-stage-choice';

    const eyebrow = document.createElement('div');
    eyebrow.className = 'v3-ending-eyebrow';
    eyebrow.innerHTML = `${svgIcon('star', 14)} 第三幕终局凯旋 · 星门重启远征胜利`;
    choiceCard.appendChild(eyebrow);

    const headline = document.createElement('h1');
    headline.className = 'v3-ending-headline';
    headline.textContent = '黑曜利维坦已击溃 · 星门核心归你执掌';
    choiceCard.appendChild(headline);

    const lead = document.createElement('p');
    lead.className = 'v3-ending-lead';
    lead.textContent =
      '古代星门主环在引力潮汐平息后重新向你的旗舰敞开。决定星门与轨道拆解站的最终命运——所有舰船、蓝图、信用点与遗物均将完整保留，并随之开启「无尽深渊（威压 1–10）」。';
    choiceCard.appendChild(lead);

    const choiceStats = document.createElement('div');
    choiceStats.className = 'v3-ending-ceremony-stats';
    choiceCard.appendChild(choiceStats);

    const choicesGrid = document.createElement('div');
    choicesGrid.className = 'v3-ending-choices-grid';
    choicesGrid.setAttribute('role', 'group');
    choicesGrid.setAttribute('aria-label', '终局抉择路线');

    for (const eid of V3_ENDING_ORDER) {
      const def = V3_ENDINGS[eid];
      const faction = V3_FACTIONS[def.factionTheme];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `v3-ending-choice-card tone-${eid}`;
      btn.dataset.endingChoice = eid;
      btn.dataset.testid = `ending-choice-${eid}`;
      btn.setAttribute('aria-pressed', 'false');

      const top = document.createElement('div');
      top.className = 'v3-ec-top';
      const facSpan = document.createElement('span');
      facSpan.className = 'v3-ec-faction';
      facSpan.innerHTML = `${svgIcon('faction', 12)} ${faction.name}共鸣路线`;
      const statusSpan = document.createElement('span');
      top.appendChild(facSpan);
      top.appendChild(statusSpan);
      btn.appendChild(top);

      const h3 = document.createElement('h3');
      h3.className = 'v3-ec-title';
      h3.textContent = def.title;
      btn.appendChild(h3);

      const sub = document.createElement('div');
      sub.className = 'v3-ec-sub';
      sub.textContent = def.subtitle;
      btn.appendChild(sub);

      const summary = document.createElement('p');
      summary.className = 'v3-ec-summary';
      summary.textContent = def.summary;
      btn.appendChild(summary);

      const cta = document.createElement('div');
      cta.className = 'v3-ec-cta';
      cta.textContent = `选择「${def.title}」 →`;
      btn.appendChild(cta);

      choicesGrid.appendChild(btn);
      this.choiceBtns.set(eid, btn);
      this.choiceStatusEls.set(eid, statusSpan);
    }
    choiceCard.appendChild(choicesGrid);

    // Stage 2 card (detached when showing Stage 1)
    const epilogueCard = document.createElement('div');
    epilogueCard.className = 'v3-ending-card v3-ending-stage-epilogue';

    const epilogueBodyHost = document.createElement('div');
    epilogueBodyHost.style.display = 'contents';
    epilogueCard.appendChild(epilogueBodyHost);

    const epilogueFooter = document.createElement('div');
    epilogueFooter.className = 'v3-ending-footer-actions';

    const rechooseBtn = document.createElement('button');
    rechooseBtn.type = 'button';
    rechooseBtn.className = 'btn btn-secondary';
    rechooseBtn.id = 'v3-btn-ending-rechoose';
    rechooseBtn.textContent = '← 重新比较其他结局';

    const continueBtn = document.createElement('button');
    continueBtn.type = 'button';
    continueBtn.className = 'btn btn-primary btn-launch-hero';
    continueBtn.id = 'v3-btn-ending-continue';
    continueBtn.dataset.testid = 'btn-ending-continue';
    continueBtn.innerHTML = `${svgIcon('rocket', 16)} `;
    const continueLabel = document.createElement('span');
    continueBtn.appendChild(continueLabel);

    epilogueFooter.appendChild(continueBtn);
    epilogueCard.appendChild(epilogueFooter);

    host.appendChild(root);
    root.addEventListener('click', this.handleRootClick);

    this.rootEl = root;
    this.choiceCardEl = choiceCard;
    this.choiceStatsEl = choiceStats;
    this.epilogueCardEl = epilogueCard;
    this.epilogueBodyHostEl = epilogueBodyHost;
    this.epilogueFooterEl = epilogueFooter;
    this.rechooseBtnEl = rechooseBtn;
    this.continueBtnEl = continueBtn;
    this.continueLabelEl = continueLabel;
  }

  update(props: EndingViewProps, actions: EndingViewActions): void {
    this.latestActions = actions;
    if (
      !this.rootEl ||
      !this.choiceCardEl ||
      !this.choiceStatsEl ||
      !this.epilogueCardEl ||
      !this.epilogueBodyHostEl ||
      !this.epilogueFooterEl ||
      !this.rechooseBtnEl ||
      !this.continueBtnEl ||
      !this.continueLabelEl
    ) {
      return;
    }

    const { profile, mode, selectedEndingId, climaxRun, readOnly } = props;
    const unlockedSet = new Set<EndingId>(profile.campaign.endingsUnlocked);
    const restoredRelics = getRestoredRelicCount(profile);
    const totalRunsShown = profile.totalRuns + (mode === 'climax' ? 1 : 0);

    if (selectedEndingId === null && mode === 'climax') {
      if (this.rootEl.getAttribute('aria-label') !== '星门终局庆典') {
        this.rootEl.setAttribute('aria-label', '星门终局庆典');
      }
      if (this.epilogueCardEl.parentElement) {
        this.epilogueCardEl.remove();
      }
      if (this.choiceCardEl.parentElement !== this.rootEl) {
        this.rootEl.appendChild(this.choiceCardEl);
      }

      const statsKey = `${totalRunsShown}:${restoredRelics}:${unlockedSet.size}:${
        climaxRun ? climaxRun.wallet : 'none'
      }`;
      if (this.lastChoiceStatsKey !== statsKey) {
        this.lastChoiceStatsKey = statsKey;
        this.choiceStatsEl.innerHTML = `
          <div class="v3-ecs-pill"><span>累计远航</span><strong class="num">${totalRunsShown} 次</strong></div>
          <div class="v3-ecs-pill"><span>修复古代遗物</span><strong class="num">${restoredRelics} / 4</strong></div>
          <div class="v3-ecs-pill"><span>已解锁结局</span><strong class="num">${unlockedSet.size} / 3</strong></div>
          ${
            climaxRun
              ? `<div class="v3-ecs-pill"><span>终战钱包收获</span><strong class="num">+${climaxRun.wallet}¤</strong></div>`
              : ''
          }
        `;
      }

      for (const eid of V3_ENDING_ORDER) {
        const btn = this.choiceBtns.get(eid);
        const statusEl = this.choiceStatusEls.get(eid);
        if (btn) {
          syncButtonDisabled(btn, readOnly);
        }
        if (statusEl) {
          const achieved = unlockedSet.has(eid);
          const nextCls = achieved ? 'v3-ec-achieved' : 'v3-ec-new';
          if (statusEl.className !== nextCls) {
            statusEl.className = nextCls;
            statusEl.innerHTML = achieved ? `${svgIcon('check', 11)} 已达成` : '新结局';
          }
        }
      }
      return;
    }

    // Stage 2: Chosen Ending Epilogue
    if (this.rootEl.getAttribute('aria-label') !== '星门终局尾声') {
      this.rootEl.setAttribute('aria-label', '星门终局尾声');
    }
    if (this.choiceCardEl.parentElement) {
      this.choiceCardEl.remove();
    }
    const activeId: EndingId = selectedEndingId ?? 'stargate_reignited';
    const nextCardCls = `v3-ending-card v3-ending-stage-epilogue tone-${activeId}`;
    if (this.epilogueCardEl.className !== nextCardCls) {
      this.epilogueCardEl.className = nextCardCls;
    }
    if (this.epilogueCardEl.parentElement !== this.rootEl) {
      this.rootEl.appendChild(this.epilogueCardEl);
    }

    const projectedEndingsCount =
      mode === 'climax'
        ? new Set([...profile.campaign.endingsUnlocked, activeId]).size
        : unlockedSet.size;
    const repSig = `${profile.factionRep.starport_guild ?? 0}:${
      profile.factionRep.deep_institute ?? 0
    }:${profile.factionRep.free_salvagers ?? 0}`;
    const epilogueKey = `${mode}:${activeId}:${projectedEndingsCount}:${profile.credits}:${profile.salvageParts}:${restoredRelics}:${repSig}`;

    if (this.lastEpilogueKey !== epilogueKey) {
      this.lastEpilogueKey = epilogueKey;
      const epilogue = buildDynamicEndingEpilogue(activeId, profile);
      this.epilogueBodyHostEl.innerHTML = `
        <div class="v3-ending-eyebrow">
          ${svgIcon('medal', 14)} ${
        mode === 'gallery' ? '结局回廊 · 史册重温' : '星门终局庆典 · 最终抉择已确立'
      } · 已收录结局 ${projectedEndingsCount} / 3
        </div>
        <h1 class="v3-ending-headline">${epilogue.ending.title}</h1>
        <div class="v3-ending-subline">${epilogue.ending.subtitle}</div>
        <blockquote class="v3-ending-quote">${epilogue.ending.openingQuote}</blockquote>

        <div class="v3-ending-epilogue-body">
          ${epilogue.paragraphs.map((para) => `<p>${para}</p>`).join('')}
        </div>

        <div class="v3-ending-ceremony-stats">
          <div class="v3-ecs-pill"><span>最高声望阵营</span><strong>${epilogue.topFactionName} (${epilogue.topFactionRep})</strong></div>
          <div class="v3-ecs-pill"><span>复原星门遗物</span><strong class="num">${epilogue.restoredRelicsCount} / 4 件遗物</strong></div>
          <div class="v3-ecs-pill"><span>基地资产</span><strong class="num">${profile.credits}¤ · ${profile.salvageParts} 精密零件</strong></div>
        </div>

        <div class="v3-ending-crew-section">
          <div class="v3-ending-crew-label">${svgIcon('comms', 13)} 乘组凯旋感言</div>
          <div class="v3-ending-crew-grid">
            ${epilogue.crewFarewells
              .map(
                (cf) => `
                <div class="v3-ending-crew-card">
                  ${crewPortraitSvg(cf.crewId, 38)}
                  <div class="v3-ecw-body">
                    <strong>${cf.name} · <span>${cf.roleTitle}</span></strong>
                    <p>「${cf.quote}」</p>
                  </div>
                </div>
              `
              )
              .join('')}
          </div>
        </div>

        ${
          mode === 'climax'
            ? `<div class="v3-ending-postgame-banner">
                ${svgIcon('bolt', 15)}
                <div>
                  <strong>无尽深渊（威压 1–10）已开启！</strong>
                  <span>${epilogue.ending.postGameNotice} 全部舰船、装备仓库、遗物与信用点将完整保留。</span>
                </div>
              </div>`
            : ''
        }
      `;
    }

    if (mode === 'climax') {
      if (this.rechooseBtnEl.parentElement !== this.epilogueFooterEl) {
        this.epilogueFooterEl.insertBefore(this.rechooseBtnEl, this.continueBtnEl);
      }
      syncButtonDisabled(this.rechooseBtnEl, readOnly);
    } else if (this.rechooseBtnEl.parentElement) {
      this.rechooseBtnEl.remove();
    }

    syncButtonDisabled(this.continueBtnEl, mode === 'climax' && readOnly);
    const continueText = mode === 'gallery' ? '返回空间站基地' : '返回空间站 · 开启无尽深渊';
    if (this.continueLabelEl.textContent !== continueText) {
      this.continueLabelEl.textContent = continueText;
    }
  }

  unmount(): void {
    this.rootEl?.removeEventListener('click', this.handleRootClick);
    this.rootEl?.remove();
    this.choiceBtns.clear();
    this.choiceStatusEls.clear();
    this.hostEl = null;
    this.rootEl = null;
    this.choiceCardEl = null;
    this.choiceStatsEl = null;
    this.epilogueCardEl = null;
    this.epilogueBodyHostEl = null;
    this.epilogueFooterEl = null;
    this.rechooseBtnEl = null;
    this.continueBtnEl = null;
    this.continueLabelEl = null;
    this.latestActions = null;
    this.lastChoiceStatsKey = null;
    this.lastEpilogueKey = null;
  }
}

const legacyEndingViews = new WeakMap<HTMLElement, EndingPhaseView>();

export function renderEndingView(
  hostEl: HTMLElement,
  props: EndingViewProps,
  actions: EndingViewActions
): void {
  let view = legacyEndingViews.get(hostEl);
  if (!view) {
    view = new EndingPhaseView();
    legacyEndingViews.set(hostEl, view);
  }
  if (!view.isMountedIn(hostEl)) {
    view.mount(hostEl);
  }
  view.update(props, actions);
}
