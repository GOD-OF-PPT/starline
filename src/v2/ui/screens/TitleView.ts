import { getTitleKeyArtUrl } from '../../../assets/itemArt';
import { CAMPAIGN_CHAPTERS } from '../../data/campaign';
import { V2_ALL_EQUIPMENT_KINDS } from '../../data/equipment';
import { V2_SHIP_ORDER } from '../../data/ships';
import { getV2RelicSummary } from '../../domain/progressionV2';
import type { V2ProfileState } from '../../domain/types';
import { svgIcon } from '../icons';

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

export function renderTitleView(
  hostEl: HTMLElement,
  props: TitleViewProps,
  actions: TitleViewActions
): void {
  const { profile: p, shouldOfferMigration } = props;
  const relicSum = getV2RelicSummary(p);
  const hasProgress =
    p.totalRuns > 0 || p.tutorialCompleted || p.credits > 0 || Boolean(p.migrationRecord);
  const actLabel =
    CAMPAIGN_CHAPTERS[p.campaign?.currentAct ?? 'prologue']?.title ??
    CAMPAIGN_CHAPTERS.prologue.title;
  const ctaText = hasProgress ? '继续远航' : '开启新征程';

  hostEl.innerHTML = `
    <div class="title-screen-backdrop" data-testid="title-screen" style="background-image:url('${getTitleKeyArtUrl()}')">
      <div class="title-screen-scrim">
        <div class="title-card v2-title-card">
          <div class="title-eyebrow">STARLINE SALVAGE STATION</div>
          <div class="v3-title-act-row">
            <span class="v3-title-act-badge" data-testid="title-act-badge">${actLabel}</span>
          </div>
          <h1 class="title-heading">星际拆解站</h1>
          <p class="title-tagline">选舰配装 · 航路探索 · 船舱取舍 · 返航扩建</p>

          <div class="title-telemetry">
            <div class="title-stat"><span>信用点</span><strong class="num">${p.credits}¤</strong></div>
            <div class="title-stat"><span>舰船</span><strong class="num">${p.unlockedShips.length}/${V2_SHIP_ORDER.length}</strong></div>
            <div class="title-stat"><span>蓝图</span><strong class="num">${p.blueprints.length}/${V2_ALL_EQUIPMENT_KINDS.length}</strong></div>
            <div class="title-stat"><span>藏品馆</span><strong class="num">${relicSum.restoredCount}/${relicSum.totalCount}</strong></div>
          </div>

          <div class="title-actions">
            <button type="button" class="btn btn-primary btn-launch-hero" id="v2-title-enter" data-testid="btn-enter-station">
              ${svgIcon('rocket', 16)} ${ctaText}
            </button>
            <div class="title-sub-actions">
              <button type="button" class="btn btn-secondary" id="v2-title-more-modes" data-testid="btn-more-modes">
                ${svgIcon('grid', 14)} 更多模式 / 试航演练
              </button>
              ${
                shouldOfferMigration
                  ? `<button type="button" class="btn btn-secondary" id="v2-title-migrate">导入经典旧档</button>`
                  : ''
              }
              <button type="button" class="btn btn-ghost" id="v2-title-help">${svgIcon('help', 14)} 远航指南</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  hostEl.querySelector('#v2-title-enter')?.addEventListener('click', actions.onEnterStation);
  hostEl.querySelector('#v2-title-more-modes')?.addEventListener('click', actions.onOpenMoreModes);
  hostEl.querySelector('#v2-title-migrate')?.addEventListener('click', actions.onOpenMigration);
  hostEl.querySelector('#v2-title-help')?.addEventListener('click', actions.onOpenHelp);
}
