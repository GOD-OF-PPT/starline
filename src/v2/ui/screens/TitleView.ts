import { getTitleKeyArtUrl } from '../../../assets/itemArt';
import { CAMPAIGN_CHAPTERS } from '../../data/campaign';
import { V2_ALL_EQUIPMENT_KINDS } from '../../data/equipment';
import { V2_SHIP_ORDER } from '../../data/ships';
import { getV2RelicSummary } from '../../domain/progressionV2';
import type { V2ProfileState } from '../../domain/types';
import { svgIcon } from '../icons';
import type { PhaseView } from './screenTypes';

export interface TitleViewProps {
  readonly profile: V2ProfileState;
  readonly shouldOfferMigration: boolean;
}

export interface TitleViewActions {
  readonly onEnterStation: () => void;
  readonly onOpenMoreModes: () => void;
  readonly onOpenHelp: () => void;
  readonly onOpenMigration: () => void;
}

export class TitlePhaseView implements PhaseView<TitleViewProps, TitleViewActions> {
  private hostEl: HTMLElement | null = null;
  private rootEl: HTMLDivElement | null = null;
  private actBadgeEl: HTMLSpanElement | null = null;
  private creditsValEl: HTMLElement | null = null;
  private shipsValEl: HTMLElement | null = null;
  private blueprintsValEl: HTMLElement | null = null;
  private relicsValEl: HTMLElement | null = null;
  private enterBtnEl: HTMLButtonElement | null = null;
  private enterLabelEl: HTMLSpanElement | null = null;
  private subActionsEl: HTMLDivElement | null = null;
  private moreModesBtnEl: HTMLButtonElement | null = null;
  private migrateBtnEl: HTMLButtonElement | null = null;
  private helpBtnEl: HTMLButtonElement | null = null;

  private latestActions: TitleViewActions | null = null;

  private readonly handleRootClick = (ev: Event): void => {
    if (!this.rootEl || !this.latestActions) return;
    const target = ev.target as HTMLElement | null;
    if (!target || typeof target.closest !== 'function') return;
    const btn = target.closest('button') as HTMLButtonElement | null;
    if (!btn || !this.rootEl.contains(btn) || btn.disabled) return;
    if (btn === this.enterBtnEl || btn.id === 'v2-title-enter') {
      this.latestActions.onEnterStation();
    } else if (btn === this.moreModesBtnEl || btn.id === 'v2-title-more-modes') {
      this.latestActions.onOpenMoreModes();
    } else if (btn === this.migrateBtnEl || btn.id === 'v2-title-migrate') {
      this.latestActions.onOpenMigration();
    } else if (btn === this.helpBtnEl || btn.id === 'v2-title-help') {
      this.latestActions.onOpenHelp();
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

    const root = document.createElement('div');
    root.className = 'title-screen-backdrop v2-title-backdrop';
    root.dataset.testid = 'title-screen';
    root.style.backgroundImage = `url('${getTitleKeyArtUrl()}')`;

    const scrim = document.createElement('div');
    scrim.className = 'title-screen-scrim';

    const card = document.createElement('div');
    card.className = 'title-card v2-title-card';

    const eyebrow = document.createElement('div');
    eyebrow.className = 'title-eyebrow';
    eyebrow.textContent = 'STARLINE SALVAGE STATION';
    card.appendChild(eyebrow);

    const actRow = document.createElement('div');
    actRow.className = 'v3-title-act-row';
    const actBadge = document.createElement('span');
    actBadge.className = 'v3-title-act-badge';
    actBadge.dataset.testid = 'title-act-badge';
    actRow.appendChild(actBadge);
    card.appendChild(actRow);

    const heading = document.createElement('h1');
    heading.className = 'title-heading';
    heading.textContent = '星际拆解站';
    card.appendChild(heading);

    const tagline = document.createElement('p');
    tagline.className = 'title-tagline';
    tagline.textContent = '选舰配装 · 航路探索 · 船舱取舍 · 返航扩建';
    card.appendChild(tagline);

    const telemetry = document.createElement('div');
    telemetry.className = 'title-telemetry';
    const makeStat = (label: string): HTMLElement => {
      const cell = document.createElement('div');
      cell.className = 'title-stat';
      const span = document.createElement('span');
      span.textContent = label;
      const strong = document.createElement('strong');
      strong.className = 'num';
      cell.appendChild(span);
      cell.appendChild(strong);
      telemetry.appendChild(cell);
      return strong;
    };
    this.creditsValEl = makeStat('信用点');
    this.shipsValEl = makeStat('舰船');
    this.blueprintsValEl = makeStat('蓝图');
    this.relicsValEl = makeStat('藏品馆');
    card.appendChild(telemetry);

    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'title-actions';

    const enterBtn = document.createElement('button');
    enterBtn.type = 'button';
    enterBtn.className = 'btn btn-primary btn-launch-hero';
    enterBtn.id = 'v2-title-enter';
    enterBtn.dataset.testid = 'btn-enter-station';
    enterBtn.dataset.action = 'enter-station';
    enterBtn.innerHTML = `${svgIcon('rocket', 16)} `;
    const enterLabel = document.createElement('span');
    enterBtn.appendChild(enterLabel);
    actionsWrap.appendChild(enterBtn);

    const subActions = document.createElement('div');
    subActions.className = 'title-sub-actions';

    const moreModesBtn = document.createElement('button');
    moreModesBtn.type = 'button';
    moreModesBtn.className = 'btn btn-secondary';
    moreModesBtn.id = 'v2-title-more-modes';
    moreModesBtn.dataset.testid = 'btn-more-modes';
    moreModesBtn.innerHTML = `${svgIcon('grid', 14)} 更多模式 / 试航演练`;
    subActions.appendChild(moreModesBtn);

    const migrateBtn = document.createElement('button');
    migrateBtn.type = 'button';
    migrateBtn.className = 'btn btn-secondary';
    migrateBtn.id = 'v2-title-migrate';
    migrateBtn.textContent = '导入经典旧档';

    const helpBtn = document.createElement('button');
    helpBtn.type = 'button';
    helpBtn.className = 'btn btn-ghost';
    helpBtn.id = 'v2-title-help';
    helpBtn.innerHTML = `${svgIcon('help', 14)} 远航指南`;
    subActions.appendChild(helpBtn);

    actionsWrap.appendChild(subActions);
    card.appendChild(actionsWrap);
    scrim.appendChild(card);
    root.appendChild(scrim);
    host.appendChild(root);

    root.addEventListener('click', this.handleRootClick);

    this.rootEl = root;
    this.actBadgeEl = actBadge;
    this.enterBtnEl = enterBtn;
    this.enterLabelEl = enterLabel;
    this.subActionsEl = subActions;
    this.moreModesBtnEl = moreModesBtn;
    this.migrateBtnEl = migrateBtn;
    this.helpBtnEl = helpBtn;
  }

  update(props: TitleViewProps, actions: TitleViewActions): void {
    this.latestActions = actions;
    if (!this.rootEl) return;

    const { profile: p, shouldOfferMigration } = props;
    const relicSum = getV2RelicSummary(p);
    const hasProgress =
      p.totalRuns > 0 || p.tutorialCompleted || p.credits > 0 || Boolean(p.migrationRecord);
    const actLabel =
      CAMPAIGN_CHAPTERS[p.campaign?.currentAct ?? 'prologue']?.title ??
      CAMPAIGN_CHAPTERS.prologue.title;
    const ctaText = hasProgress ? '继续远航' : '开启新征程';

    if (this.actBadgeEl && this.actBadgeEl.textContent !== actLabel) {
      this.actBadgeEl.textContent = actLabel;
    }
    const creditsText = `${p.credits}¤`;
    if (this.creditsValEl && this.creditsValEl.textContent !== creditsText) {
      this.creditsValEl.textContent = creditsText;
    }
    const shipsText = `${p.unlockedShips.length}/${V2_SHIP_ORDER.length}`;
    if (this.shipsValEl && this.shipsValEl.textContent !== shipsText) {
      this.shipsValEl.textContent = shipsText;
    }
    const blueprintsText = `${p.blueprints.length}/${V2_ALL_EQUIPMENT_KINDS.length}`;
    if (this.blueprintsValEl && this.blueprintsValEl.textContent !== blueprintsText) {
      this.blueprintsValEl.textContent = blueprintsText;
    }
    const relicsText = `${relicSum.restoredCount}/${relicSum.totalCount}`;
    if (this.relicsValEl && this.relicsValEl.textContent !== relicsText) {
      this.relicsValEl.textContent = relicsText;
    }
    if (this.enterLabelEl && this.enterLabelEl.textContent !== ctaText) {
      this.enterLabelEl.textContent = ctaText;
    }

    if (this.subActionsEl && this.migrateBtnEl && this.helpBtnEl) {
      if (shouldOfferMigration) {
        if (this.migrateBtnEl.parentElement !== this.subActionsEl) {
          this.subActionsEl.insertBefore(this.migrateBtnEl, this.helpBtnEl);
        }
      } else if (this.migrateBtnEl.parentElement) {
        this.migrateBtnEl.remove();
      }
    }
  }

  unmount(): void {
    this.rootEl?.removeEventListener('click', this.handleRootClick);
    this.rootEl?.remove();
    this.hostEl = null;
    this.rootEl = null;
    this.actBadgeEl = null;
    this.creditsValEl = null;
    this.shipsValEl = null;
    this.blueprintsValEl = null;
    this.relicsValEl = null;
    this.enterBtnEl = null;
    this.enterLabelEl = null;
    this.subActionsEl = null;
    this.moreModesBtnEl = null;
    this.migrateBtnEl = null;
    this.helpBtnEl = null;
    this.latestActions = null;
  }
}

const legacyTitleViews = new WeakMap<HTMLElement, TitlePhaseView>();

export function renderTitleView(
  hostEl: HTMLElement,
  props: TitleViewProps,
  actions: TitleViewActions
): void {
  let view = legacyTitleViews.get(hostEl);
  if (!view) {
    view = new TitlePhaseView();
    legacyTitleViews.set(hostEl, view);
  }
  if (!view.isMountedIn(hostEl)) {
    view.mount(hostEl);
  }
  view.update(props, actions);
}
