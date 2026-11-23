import { getItemImageUrl, getPlayerShipImageUrl } from '../../../assets/itemArt';
import { V2_CONTRACT_TEMPLATES } from '../../data/contracts';
import { V2_CREW, V2_CREW_ORDER, getV2CrewMasteryTierDef, type V2CrewId } from '../../data/crew';
import {
  V2_ARCHETYPE_LABELS,
  V2_EQUIPMENT_DEFS,
  getEffectiveV2EquipmentBudgetCost,
  getV2EquipmentDefByKind,
  type V2ArchetypeId,
} from '../../data/equipment';
import { V3_FACTIONS } from '../../data/factions';
import { V3_RELIC_PASSIVES } from '../../data/facilities';
import { getV3GadgetDef } from '../../data/gadgets';
import { V3_SECTORS, V3_SECTOR_ORDER, getV3SectorDef } from '../../data/sectors';
import { V2_SHAPES } from '../../data/shapes';
import { V2_SHIPS, V2_SHIP_ORDER, type V2ShipId } from '../../data/ships';
import { V2_TRIAL_BUILD_ORDER, V2_TRIAL_BUILDS } from '../../data/trialBuilds';
import { shouldTriggerRelicPitySignal } from '../../domain/campaign';
import { previewContractBonusHint } from '../../domain/contracts';
import { getEffectiveShipLoadoutBudget, getEffectiveShipMaxHp } from '../../domain/dismantle';
import type { V2PrepareValidation } from '../../domain/loadout';
import { getActiveRelicPassives, getEffectiveMaxPresets } from '../../domain/progressionV2';
import type { SectorId, V2ProfileState, V2TrialBuildId } from '../../domain/types';
import { crewPortraitSvg, svgIcon } from '../icons';
import { ARCHETYPE_ORDER, type V2PrepareDraft } from './screenTypes';

export interface PrepareViewProps {
  readonly profile: V2ProfileState;
  readonly draft: V2PrepareDraft;
  readonly readOnly: boolean;
  readonly validation: V2PrepareValidation;
}

export interface PrepareViewActions {
  readonly onBack: () => void;
  readonly onPickTrial: (trialId: V2TrialBuildId) => void;
  readonly onExitTrial: () => void;
  readonly onSelectSector: (sectorId: SectorId) => void;
  readonly onSelectShip: (shipId: V2ShipId) => void;
  readonly onSelectCrew: (crewId: V2CrewId) => void;
  readonly onSelectArchetype: (archetypeId: V2ArchetypeId) => void;
  readonly onFallback: () => void;
  readonly onClear: () => void;
  readonly onAddLoan: (defId: string) => void;
  readonly onAddOwned: (instanceId: string) => void;
  readonly onSavePreset: (name: string) => void;
  readonly onLoadPreset: (presetId: string) => void;
  readonly onSubLoan: () => void;
  readonly onDeletePreset: (presetId: string) => void;
  readonly onLaunch: () => void;
}

export function renderPrepareView(
  leftPanelEl: HTMLElement,
  props: PrepareViewProps,
  actions: PrepareViewActions
): void {
  const { profile: p, draft, readOnly, validation: check } = props;
  const contractTpl =
    V2_CONTRACT_TEMPLATES[draft.contractTemplateId] ?? V2_CONTRACT_TEMPLATES.free_salvage;
  const usedOwnedIds = new Set(check.ownedInstancesUsed);
  const unlockedSet = new Set<SectorId>(
    p.campaign.unlockedSectors.length > 0 ? p.campaign.unlockedSectors : ['near_orbit']
  );
  const activeSector = getV3SectorDef(draft.sectorId);
  const activePity = shouldTriggerRelicPitySignal(p, activeSector.id);
  const envIcon =
    activeSector.envModifier.id === 'cryo_ion'
      ? 'cryo'
      : activeSector.envModifier.id === 'gravity_tide'
      ? 'gravity'
      : 'radar';

  const contractFaction = contractTpl.factionId ? V3_FACTIONS[contractTpl.factionId] : null;
  const bonusHint = previewContractBonusHint(contractTpl);
  const relicPassives = getActiveRelicPassives(p);
  const maxPresets = getEffectiveMaxPresets(p);

  leftPanelEl.innerHTML = `
    <div class="v3-screen-root v3-sticky-panel-root" data-testid="prepare-screen">
      <div class="panel-header">
        <h2>出航整备 · ${contractTpl.name}</h2>
        <button type="button" class="btn btn-sm btn-ghost" id="v2-prep-back">← 返回基地</button>
      </div>

      <div class="v3-panel-scroll-body">
        <div class="v3-prep-contract-card">
          <div class="v3-pcc-head">
            <span class="v3-pcc-title">${svgIcon('star', 13)} ${contractTpl.name}</span>
            ${
              contractFaction && contractTpl.factionRepReward
                ? `<span class="v3-faction-chip faction-${contractFaction.id}">${svgIcon('faction', 11)} ${
                    contractFaction.name
                  } +${contractTpl.factionRepReward} 声望</span>`
                : ''
            }
          </div>
          <div class="v3-pcc-note">${contractTpl.gameplayNote} · ${contractTpl.spaceNote}</div>
          ${
            bonusHint
              ? `<div class="v3-pcc-bonus">额外目标（启航随机锁定）：${bonusHint.label} · <strong>+30% 加赏 (+${bonusHint.rewardCredits}¤)</strong></div>`
              : ''
          }
        </div>

        <div class="v2-prep-group">
          <div class="v2-prep-label">目标星区（共 3 星区 · 击败首领逐幕解锁）</div>
          <div class="v2-sector-row" data-testid="sector-selector">
            ${V3_SECTOR_ORDER.map((sid) => {
              const sec = V3_SECTORS[sid];
              const unlocked = unlockedSet.has(sid);
              const active = draft.sectorId === sid;
              const toneCls =
                sid === 'frozen_graveyard'
                  ? 'sector-frozen'
                  : sid === 'stargate_abyss'
                  ? 'sector-abyss'
                  : 'sector-near';
              const secIco =
                sec.envModifier.id === 'cryo_ion'
                  ? 'cryo'
                  : sec.envModifier.id === 'gravity_tide'
                  ? 'gravity'
                  : 'radar';
              return `<button type="button" class="v2-sector-chip ${toneCls} ${active ? 'active' : ''} ${
                unlocked ? '' : 'is-locked'
              }" data-prep-sector="${sid}" data-sector-id="${sid}" data-testid="sector-option-${sid}" data-locked="${
                unlocked ? 'false' : 'true'
              }" ${!unlocked || readOnly ? 'disabled' : ''}>
                <strong>${svgIcon(unlocked ? secIco : 'lock', 13)} ${sec.name}</strong>
                <small>${
                  unlocked
                    ? sec.envModifier.shortBadge
                    : `未解锁 · ${sec.unlockRequirementText}`
                }</small>
              </button>`;
            }).join('')}
          </div>
          <div class="v3-sector-env-card env-${activeSector.envModifier.id}" data-testid="sector-env-card">
            <div class="v3-sec-env-head">
              <strong>${svgIcon(envIcon, 14)} ${activeSector.name} · ${activeSector.envModifier.name}</strong>
              <span class="v3-sec-env-tag">首领：${activeSector.bossName}</span>
            </div>
            <div class="v3-sec-env-rule">${activeSector.envModifier.description}</div>
            <div class="v3-sec-env-foot">
              <span>赏金倍率 ${Math.round(activeSector.bountyMult * 100)}% · 货物估价 ${Math.round(
    activeSector.cargoPriceMult * 100
  )}%</span>
              <span class="${activePity.triggered ? 'v3-pity-ready-pill' : ''}">${
    activePity.triggered
      ? '本趟已触发保底遗物信号！'
      : `遗物信号保底 ${activePity.counter}/${activePity.threshold}`
  }</span>
            </div>
          </div>
        </div>

        <div class="v2-prep-group v2-trial-section">
          <div class="v2-prep-label-row">
            <span class="v2-prep-label">${svgIcon('bolt', 13)} 全息战术模板（整套模拟体验 + 实战微演示）</span>
            ${
              draft.trialBuildId
                ? `<button type="button" class="btn btn-sm btn-ghost" id="v2-trial-exit" data-testid="btn-exit-template">切回自由配装</button>`
                : ''
            }
          </div>
          <div class="v2-trial-strip">
            ${V2_TRIAL_BUILD_ORDER.map((tid) => {
              const spec = V2_TRIAL_BUILDS[tid];
              const active = draft.trialBuildId === tid;
              const ico = tid === 'trial_heavy' ? 'cannon' : tid === 'trial_hangar' ? 'drone' : 'counter';
              return `<button type="button" class="v2-trial-mini-card ${active ? 'active' : ''}" data-pick-trial="${tid}" data-testid="btn-trial-template-${tid}" ${
                readOnly ? 'disabled' : ''
              }>
                <div class="v2-tm-head">${svgIcon(ico, 15)} <strong>${spec.shortName}</strong></div>
                <div class="v2-tm-pro">${spec.advantage}</div>
                <div class="v2-tm-con">${spec.tradeoff}</div>
              </button>`;
            }).join('')}
          </div>
          <div class="v2-trial-bp-note">全息战术模板为普通品质整套借用（返航归还，不可混搭外部件）；已研究永久蓝图可自由混搭、在工坊制造自有设备（出航预算 -1）并保存预设。</div>
        </div>

        <div class="v2-prep-group">
          <div class="v2-prep-label-row">
            <span class="v2-prep-label">舰船与具名船员（共 ${V2_SHIP_ORDER.length} 舰 · 含船体供能格）</span>
          </div>
          ${
            relicPassives.activeRelicIds.length > 0
              ? `<div class="v3-relic-passive-strip" style="margin-bottom:6px;" data-testid="prepare-relic-passives">
                  ${relicPassives.activeRelicIds
                    .map(
                      (rid) =>
                        `<span class="v3-relic-passive-pill">${svgIcon('museum', 11)} ${
                          V3_RELIC_PASSIVES[rid]?.shortBadge ?? rid
                        }</span>`
                    )
                    .join('')}
                </div>`
              : ''
          }
          <div class="v2-ship-cards" data-testid="ship-selector">
            ${V2_SHIP_ORDER.map((sid) => {
              const s = V2_SHIPS[sid];
              const unlocked = p.unlockedShips.includes(sid);
              const active = draft.shipId === sid;
              const effHp = getEffectiveShipMaxHp(p, sid);
              const effBudget = getEffectiveShipLoadoutBudget(p, sid);
              return `<button type="button" class="v2-choice-pill ${active ? 'active' : ''}" data-prep-ship="${sid}" data-testid="ship-option-${sid}" ${
                !unlocked ? 'disabled' : ''
              }>
                <img class="v2-ship-mini" src="${getPlayerShipImageUrl(sid)}" alt="${s.name}" />
                <span class="v2-choice-main">
                  <strong>${s.name}</strong>
                  <small>${s.cols}×${s.rows} (${s.validCellCount}格·⚡${s.powerCells.length}) · HP ${effHp} · 预算 ${effBudget}${
                s.bonusShield > 0 ? ` · +${s.bonusShield}盾` : ''
              }${!unlocked ? ' · 未解锁' : ''}</small>
                </span>
              </button>`;
            }).join('')}
          </div>
          <div class="v2-crew-row" data-testid="crew-selector" style="margin-top:6px;">
            ${V2_CREW_ORDER.map((cid) => {
              const c = V2_CREW[cid];
              const unlocked = p.unlockedCrew.includes(cid);
              const active = draft.crewId === cid;
              const tier = Math.max(0, Math.min(2, Math.floor(p.crewMastery[cid] ?? 0)));
              const tierDef = getV2CrewMasteryTierDef(cid, tier);
              const stars = `${'★'.repeat(tier)}${'☆'.repeat(2 - tier)}`;
              return `<button type="button" class="v2-crew-pill ${active ? 'active' : ''} ${
                unlocked ? '' : 'is-locked'
              }" data-prep-crew="${cid}" data-crew-id="${cid}" data-testid="crew-option-${cid}" data-locked="${
                unlocked ? 'false' : 'true'
              }" ${!unlocked || readOnly ? 'disabled' : ''}>
                <div class="v3-crew-pill-inner">
                  ${crewPortraitSvg(cid, 32)}
                  <div class="v3-crew-pill-text">
                    <div class="v3-crew-pill-head">
                      <strong>${c.name} · ${c.roleTitle}</strong>
                      <span class="v3-mastery-badge">专精 Lv.${tier} ${stars}</span>
                    </div>
                    <small>${unlocked ? `${c.abilityTitle}：${c.abilitySummary}` : c.unlockHint}</small>
                    ${
                      unlocked && tier > 0
                        ? `<span class="v3-crew-perk-line">${tierDef.title}：${tierDef.perkSummary}</span>`
                        : ''
                    }
                  </div>
                </div>
              </button>`;
            }).join('')}
          </div>
        </div>

        <div class="v2-prep-group">
          <div class="v2-prep-label">航路支援倾向（第 2–4 层保底出现对应配件）</div>
          <div class="v2-arch-row">
            ${ARCHETYPE_ORDER.map((aid) => {
              const info = V2_ARCHETYPE_LABELS[aid];
              return `<button type="button" class="btn btn-sm ${
                draft.primaryArchetype === aid ? 'btn-primary' : 'btn-secondary'
              }" data-prep-arch="${aid}">${info.name}（${info.supportName}）</button>`;
            }).join('')}
          </div>
        </div>

        <div class="v2-prep-group">
          <div class="v2-prep-label-row">
            <span class="v2-prep-label">装配预算 <strong class="num">${check.totalBudget}/${
        check.maxBudget
      }</strong></span>
            <div style="display:flex;gap:6px;">
              <button type="button" class="btn btn-sm btn-ghost" id="v2-prep-fallback">标准配装</button>
              <button type="button" class="btn btn-sm btn-ghost" id="v2-prep-clear">清空</button>
            </div>
          </div>

          ${
            draft.trialBuildId
              ? `<div class="system-banner banner-warn" style="margin:4px 0 8px 0;">
                  当前处于「${V2_TRIAL_BUILDS[draft.trialBuildId].shortName}」整套试航模式：可在右侧舱内拖动/旋转体验联动，点击上方「切回自由配装」即可增删设备与保存预设。
                </div>`
              : ''
          }

          <div class="v2-pool-subtitle">永久蓝图借用（免费 · 返航归还）</div>
          <div class="v2-pool-chips">
            ${p.blueprints
              .map((kind) => {
                const def = getV2EquipmentDefByKind(kind, 'common');
                const overBudget = check.totalBudget + def.budgetCost > check.maxBudget;
                return `<button type="button" class="v2-pool-btn" data-add-loan="${def.defId}" ${
                  draft.trialBuildId || overBudget || readOnly ? 'disabled' : ''
                }>
                  <span class="v2-origin-badge origin-loan">借</span>
                  <img src="${getItemImageUrl(def.defId)}" alt="${def.name}" />
                  <span>${def.name}<small>${V2_SHAPES[def.shapeId].label} · 预算${def.budgetCost}</small></span>
                </button>`;
              })
              .join('')}
          </div>

          <div class="v2-pool-subtitle">仓库自有设备与装置（${p.equipmentWarehouse.length} 件 · 普通自有预算 -1 · 战败损失实物）</div>
          <div class="v2-pool-chips">
            ${
              p.equipmentWarehouse.length === 0
                ? `<span class="v2-empty-inline">设备库暂无自有设备（可返航入库或工坊制造）</span>`
                : p.equipmentWarehouse
                    .map((w) => {
                      const eqDef = V2_EQUIPMENT_DEFS[w.definitionId];
                      const gdDef = eqDef ? undefined : getV3GadgetDef(w.definitionId);
                      if (!eqDef && !gdDef) return '';
                      const alreadyUsed = usedOwnedIds.has(w.instanceId);
                      const effBudget = eqDef
                        ? getEffectiveV2EquipmentBudgetCost(eqDef, 'owned')
                        : gdDef!.budgetCost;
                      const overBudget = check.totalBudget + effBudget > check.maxBudget;
                      const discountSuffix = eqDef && effBudget < eqDef.budgetCost ? '(-1)' : '';
                      const name = eqDef?.name ?? gdDef!.name;
                      const tagText = gdDef ? '耗' : w.quality === 'improved' ? '良' : '普';
                      const availClass = alreadyUsed ? '' : ' warehouse-item';
                      const availAttrs = alreadyUsed
                        ? ''
                        : ` data-testid="warehouse-item-${w.instanceId}" data-origin="owned"`;
                      return `<button type="button" class="v2-pool-btn origin-owned${availClass}" data-add-owned="${
                        w.instanceId
                      }"${availAttrs} ${draft.trialBuildId || alreadyUsed || overBudget || readOnly ? 'disabled' : ''}>
                        <span class="v2-origin-badge origin-owned">自</span>
                        <img src="${getItemImageUrl(w.definitionId)}" alt="${name}" />
                        <span>${name} <em class="v2-q-tag">${tagText}</em><small>${
                        alreadyUsed ? '已装载' : `预算${effBudget}${discountSuffix}`
                      }</small></span>
                      </button>`;
                    })
                    .join('')
            }
          </div>
        </div>

        <div class="v2-prep-group v2-preset-box">
          <div class="v2-prep-label-row">
            <span class="v2-prep-label">配装预设 (${p.loadoutPresets.length}/${maxPresets})</span>
            <div style="display:flex;gap:6px;align-items:center;">
              <input type="text" id="v2-preset-name" class="v2-preset-input" maxlength="16" placeholder="预设名称" value="${
                V2_SHIPS[draft.shipId].name.slice(0, 4)
              }-${V2_ARCHETYPE_LABELS[draft.primaryArchetype].name.slice(0, 2)}" />
              <button type="button" class="btn btn-sm btn-secondary" id="v2-preset-save" data-testid="btn-save-preset" ${
                readOnly || draft.trialBuildId !== null || draft.slots.length === 0 ? 'disabled' : ''
              }>保存预设</button>
            </div>
          </div>
          ${
            draft.presetNotice
              ? `<div class="system-banner banner-warn" style="margin:6px 0;">
                  <span>${draft.presetNotice}</span>
                  ${
                    draft.missingPresetEntries.some((m) => m.canSubstituteCommonLoan)
                      ? `<button type="button" class="btn btn-sm btn-primary" id="v2-preset-sub-loan">用借用普通版补位</button>`
                      : ''
                  }
                </div>`
              : ''
          }
          ${
            p.loadoutPresets.length > 0
              ? `<div class="v2-preset-list">
                  ${p.loadoutPresets
                    .map(
                      (pr) => `<div class="v2-preset-item">
                        <span><strong>${pr.name}</strong> <small>(${V2_SHIPS[pr.shipId].name} · ${pr.slots.length}件)</small></span>
                        <div style="display:flex;gap:4px;">
                          <button type="button" class="btn btn-sm btn-secondary" data-load-preset="${pr.presetId}">载入</button>
                          <button type="button" class="btn btn-sm btn-ghost" data-del-preset="${pr.presetId}" ${
                        readOnly ? 'disabled' : ''
                      }>删</button>
                        </div>
                      </div>`
                    )
                    .join('')}
                </div>`
              : ''
          }
        </div>
      </div>

      <div class="v3-sticky-cta-footer">
        ${
          !check.valid
            ? `<div class="system-banner banner-danger">${check.errors.join('；')}</div>`
            : ''
        }
        <button type="button" class="btn btn-primary btn-launch-hero" id="v2-btn-launch-run" data-testid="btn-launch-expedition" ${
          readOnly || !check.valid ? 'disabled' : ''
        }>${svgIcon('rocket', 16)} 确认整备 · 启动远航</button>
      </div>
    </div>
  `;

  leftPanelEl.querySelector('#v2-prep-back')?.addEventListener('click', actions.onBack);

  leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-prep-sector]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      actions.onSelectSector(btn.dataset.prepSector as SectorId);
    });
  });

  leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-pick-trial]').forEach((btn) => {
    btn.addEventListener('click', () => {
      actions.onPickTrial(btn.dataset.pickTrial as V2TrialBuildId);
    });
  });

  leftPanelEl.querySelector('#v2-trial-exit')?.addEventListener('click', actions.onExitTrial);

  leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-prep-ship]').forEach((btn) => {
    btn.addEventListener('click', () => {
      actions.onSelectShip(btn.dataset.prepShip as V2ShipId);
    });
  });

  leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-prep-crew]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      actions.onSelectCrew(btn.dataset.prepCrew as V2CrewId);
    });
  });

  leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-prep-arch]').forEach((btn) => {
    btn.addEventListener('click', () => {
      actions.onSelectArchetype(btn.dataset.prepArch as V2ArchetypeId);
    });
  });

  leftPanelEl.querySelector('#v2-prep-fallback')?.addEventListener('click', actions.onFallback);
  leftPanelEl.querySelector('#v2-prep-clear')?.addEventListener('click', actions.onClear);

  leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-add-loan]').forEach((btn) => {
    btn.addEventListener('click', () => {
      actions.onAddLoan(btn.dataset.addLoan!);
    });
  });

  leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-add-owned]').forEach((btn) => {
    btn.addEventListener('click', () => {
      actions.onAddOwned(btn.dataset.addOwned!);
    });
  });

  leftPanelEl.querySelector('#v2-preset-save')?.addEventListener('click', () => {
    const input = leftPanelEl.querySelector<HTMLInputElement>('#v2-preset-name');
    actions.onSavePreset(input?.value.trim() || `预设 ${p.loadoutPresets.length + 1}`);
  });

  leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-load-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      actions.onLoadPreset(btn.dataset.loadPreset!);
    });
  });

  leftPanelEl.querySelector('#v2-preset-sub-loan')?.addEventListener('click', actions.onSubLoan);

  leftPanelEl.querySelectorAll<HTMLButtonElement>('[data-del-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      actions.onDeletePreset(btn.dataset.delPreset!);
    });
  });

  leftPanelEl.querySelector('#v2-btn-launch-run')?.addEventListener('click', actions.onLaunch);
}
