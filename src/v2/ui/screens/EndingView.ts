import { getSectorBgImageUrl } from '../../../assets/itemArt';
import {
  V3_ENDINGS,
  V3_ENDING_ORDER,
  buildDynamicEndingEpilogue,
} from '../../data/lore';
import { V3_FACTIONS } from '../../data/factions';
import { getRestoredRelicCount } from '../../domain/campaign';
import type { EndingId, V2ProfileState, V2RunState } from '../../domain/types';
import { crewPortraitSvg, svgIcon } from '../icons';

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

export function renderEndingView(
  hostEl: HTMLElement,
  props: EndingViewProps,
  actions: EndingViewActions
): void {
  const { profile, mode, selectedEndingId, climaxRun, readOnly } = props;
  const bgUrl = getSectorBgImageUrl(6);
  const unlockedSet = new Set<EndingId>(profile.campaign.endingsUnlocked);
  const restoredRelics = getRestoredRelicCount(profile);
  const totalRunsShown = profile.totalRuns + (mode === 'climax' ? 1 : 0);

  if (selectedEndingId === null && mode === 'climax') {
    // Stage 1: Victory Ceremony & 3-Way Climax Narrative Choice
    const choiceCardsHtml = V3_ENDING_ORDER.map((eid) => {
      const def = V3_ENDINGS[eid];
      const faction = V3_FACTIONS[def.factionTheme];
      const alreadyAchieved = unlockedSet.has(eid);
      return `
        <button
          type="button"
          class="v3-ending-choice-card tone-${eid}"
          data-ending-choice="${eid}"
          data-testid="ending-choice-${eid}"
          aria-pressed="false"
          ${readOnly ? 'disabled' : ''}
        >
          <div class="v3-ec-top">
            <span class="v3-ec-faction">${svgIcon('faction', 12)} ${faction.name}共鸣路线</span>
            ${
              alreadyAchieved
                ? `<span class="v3-ec-achieved">${svgIcon('check', 11)} 已达成</span>`
                : `<span class="v3-ec-new">新结局</span>`
            }
          </div>
          <h3 class="v3-ec-title">${def.title}</h3>
          <div class="v3-ec-sub">${def.subtitle}</div>
          <p class="v3-ec-summary">${def.summary}</p>
          <div class="v3-ec-cta">选择「${def.title}」 →</div>
        </button>
      `;
    }).join('');

    hostEl.innerHTML = `
      <div class="v3-ending-backdrop" data-testid="ending-screen" role="region" aria-label="星门终局庆典">
        <div class="v3-ending-bg" style="background-image:url('${bgUrl}')" aria-hidden="true"></div>
        <div class="v3-ending-card v3-ending-stage-choice">
          <div class="v3-ending-eyebrow">${svgIcon('star', 14)} 第三幕终局凯旋 · 星门重启远征胜利</div>
          <h1 class="v3-ending-headline">黑曜利维坦已击溃 · 星门核心归你执掌</h1>
          <p class="v3-ending-lead">
            古代星门主环在引力潮汐平息后重新向你的旗舰敞开。决定星门与轨道拆解站的最终命运——所有舰船、蓝图、信用点与遗物均将完整保留，并随之开启「无尽深渊（威压 1–10）」。
          </p>

          <div class="v3-ending-ceremony-stats">
            <div class="v3-ecs-pill"><span>累计远航</span><strong class="num">${totalRunsShown} 次</strong></div>
            <div class="v3-ecs-pill"><span>修复古代遗物</span><strong class="num">${restoredRelics} / 4</strong></div>
            <div class="v3-ecs-pill"><span>已解锁结局</span><strong class="num">${unlockedSet.size} / 3</strong></div>
            ${
              climaxRun
                ? `<div class="v3-ecs-pill"><span>终战钱包收获</span><strong class="num">+${climaxRun.wallet}¤</strong></div>`
                : ''
            }
          </div>

          <div class="v3-ending-choices-grid" role="group" aria-label="终局抉择路线">
            ${choiceCardsHtml}
          </div>
        </div>
      </div>
    `;

    hostEl.querySelectorAll<HTMLButtonElement>('[data-ending-choice]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        actions.onSelectEnding(btn.dataset.endingChoice as EndingId);
      });
    });
    return;
  }

  // Stage 2: Chosen Ending Victory Ceremony & Dynamic Epilogue (stays inside ending-screen!)
  const activeId: EndingId = selectedEndingId ?? 'stargate_reignited';
  const epilogue = buildDynamicEndingEpilogue(activeId, profile);
  const projectedEndingsCount =
    mode === 'climax'
      ? new Set([...profile.campaign.endingsUnlocked, activeId]).size
      : unlockedSet.size;

  hostEl.innerHTML = `
    <div class="v3-ending-backdrop" data-testid="ending-screen" role="region" aria-label="星门终局尾声">
      <div class="v3-ending-bg" style="background-image:url('${bgUrl}')" aria-hidden="true"></div>
      <div class="v3-ending-card v3-ending-stage-epilogue tone-${activeId}">
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

        <div class="v3-ending-footer-actions">
          ${
            mode === 'climax'
              ? `<button type="button" class="btn btn-secondary" id="v3-btn-ending-rechoose" ${
                  readOnly ? 'disabled' : ''
                }>← 重新比较其他结局</button>`
              : ''
          }
          <button
            type="button"
            class="btn btn-primary btn-launch-hero"
            id="v3-btn-ending-continue"
            data-testid="btn-ending-continue"
            ${mode === 'climax' && readOnly ? 'disabled' : ''}
          >${svgIcon('rocket', 16)} ${
    mode === 'gallery' ? '返回空间站基地' : '返回空间站 · 开启无尽深渊'
  }</button>
        </div>
      </div>
    </div>
  `;

  hostEl.querySelector('#v3-btn-ending-rechoose')?.addEventListener('click', () => {
    actions.onClearSelection();
  });
  hostEl.querySelector('#v3-btn-ending-continue')?.addEventListener('click', () => {
    actions.onContinueToBase();
  });
}
