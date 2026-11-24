import { getItemImageUrl, getPlayerShipImageUrl } from '../../../assets/itemArt';
import { V2_CONTRACT_TEMPLATES } from '../../data/contracts';
import { V2_CREW, V2_CREW_ORDER, getV2CrewMasteryTierDef, type V2CrewId } from '../../data/crew';
import {
  V2_ARCHETYPE_LABELS,
  V2_EQUIPMENT_DEFS,
  getEffectiveV2EquipmentBudgetCost,
  getV2EquipmentDefByKind,
  type V2ArchetypeId,
  type V2EquipmentKind,
} from '../../data/equipment';
import { V3_FACTIONS } from '../../data/factions';
import { V3_RELIC_PASSIVES } from '../../data/facilities';
import { getV3GadgetDef } from '../../data/gadgets';
import {
  MAX_ENDLESS_THREAT,
  V3_SECTORS,
  V3_SECTOR_ORDER,
  describeEndlessThreatScaling,
  getV3EndlessMutatorDef,
  getV3SectorDef,
  rollEndlessMutators,
} from '../../data/sectors';
import { V2_SHAPES } from '../../data/shapes';
import { V2_SHIPS, V2_SHIP_ORDER, type V2ShipId } from '../../data/ships';
import { V2_TRIAL_BUILD_ORDER, V2_TRIAL_BUILDS } from '../../data/trialBuilds';
import {
  isFinalCampaignMissionUnlocked,
  shouldTriggerRelicPitySignal,
} from '../../domain/campaign';
import { previewContractBonusHint } from '../../domain/contracts';
import { getEffectiveShipLoadoutBudget, getEffectiveShipMaxHp } from '../../domain/dismantle';
import { parseV3CustomSeedInput, type V2PrepareValidation } from '../../domain/loadout';
import { getActiveRelicPassives, getEffectiveMaxPresets } from '../../domain/progressionV2';
import type { SectorId, V2ProfileState, V2TrialBuildId } from '../../domain/types';
import { crewPortraitSvg, svgIcon } from '../icons';
import { ARCHETYPE_ORDER, type PhaseView, type V2PrepareDraft } from './screenTypes';

export interface PrepareViewProps {
  readonly profile: V2ProfileState;
  readonly draft: V2PrepareDraft;
  readonly readOnly: boolean;
  readonly validation: V2PrepareValidation;
  readonly effectivePreviewSeed: number;
  readonly fallbackPreviewSeed?: number;
}

export interface PrepareViewActions {
  readonly onBack: () => void;
  readonly onPickTrial: (trialId: V2TrialBuildId) => void;
  readonly onExitTrial: () => void;
  readonly onSelectSector: (sectorId: SectorId) => void;
  readonly onSelectStandardMode: () => void;
  readonly onSelectFinalMissionMode: () => void;
  readonly onSelectEndlessMode: () => void;
  readonly onSelectEndlessThreat: (threat: number) => void;
  readonly onChangeCustomSeed: (raw: string) => void;
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

interface OwnedBtnRefs {
  readonly btnEl: HTMLButtonElement;
  readonly smallEl: HTMLElement;
}

interface PresetRowRefs {
  readonly rowEl: HTMLDivElement;
  readonly labelEl: HTMLSpanElement;
  readonly loadBtnEl: HTMLButtonElement;
  readonly delBtnEl: HTMLButtonElement;
  infoKey: string;
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

function syncInputDisabled(input: HTMLInputElement, disabled: boolean): void {
  if (input.disabled !== disabled) {
    input.disabled = disabled;
  }
  if (disabled) {
    input.setAttribute('disabled', '');
  } else {
    input.removeAttribute('disabled');
  }
}

function buildEndlessMutatorPreviewInnerHtml(seed: number, threat: number): string {
  const scaling = describeEndlessThreatScaling(threat);
  const mutatorIds = rollEndlessMutators(seed, threat);
  const mutatorItemsHtml = mutatorIds
    .map((mid) => {
      const def = getV3EndlessMutatorDef(mid);
      if (!def) return '';
      return `<div class="v3-emp-mut-item"><strong>词条 · ${def.name}</strong><span>${def.combatRuleSummary}</span></div>`;
    })
    .join('');

  return `
    <div class="v3-emp-head">
      <span>${svgIcon('bolt', 12)} 威压 ${scaling.threat} 词条与突变预览（种子 #${seed >>> 0}）</span>
      <span class="num">敌耐久 +${scaling.hpBonusPct}% · 敌攻 +${scaling.dmgAdd} · 赏金 +${scaling.bountyBonusPct}%</span>
    </div>
    <div class="v3-emp-mut-list">${mutatorItemsHtml}</div>
  `;
}

export class PreparePhaseView implements PhaseView<PrepareViewProps, PrepareViewActions> {
  private hostEl: HTMLElement | null = null;
  private rootEl: HTMLDivElement | null = null;
  private titleEl: HTMLHeadingElement | null = null;
  private scrollBodyEl: HTMLDivElement | null = null;

  // Contract card
  private contractCardEl: HTMLDivElement | null = null;
  private lastContractKey: string | null = null;

  // Sector section
  private readonly sectorBtns = new Map<SectorId, HTMLButtonElement>();
  private readonly sectorContentKeys = new Map<SectorId, string>();
  private sectorEnvCardEl: HTMLDivElement | null = null;
  private lastSectorEnvKey: string | null = null;

  // Mode selector section
  private modeSectionEl: HTMLDivElement | null = null;
  private modeStdBtnEl: HTMLButtonElement | null = null;
  private modeFinalBtnEl: HTMLButtonElement | null = null;
  private modeEndlessBtnEl: HTMLButtonElement | null = null;
  private lastFinalModeContentKey: string | null = null;
  private lastEndlessModeContentKey: string | null = null;
  private climaxCardEl: HTMLDivElement | null = null;
  private endlessLockedHintEl: HTMLDivElement | null = null;
  private endlessPanelEl: HTMLDivElement | null = null;
  private endlessMaxLabelEl: HTMLSpanElement | null = null;
  private readonly threatBtns = new Map<number, HTMLButtonElement>();
  private mutatorPreviewEl: HTMLDivElement | null = null;
  private seedInputEl: HTMLInputElement | null = null;
  private lastMutatorPreviewKey: string | null = null;

  // Trial section
  private trialHeaderRowEl: HTMLDivElement | null = null;
  private trialExitBtnEl: HTMLButtonElement | null = null;
  private readonly trialBtns = new Map<V2TrialBuildId, HTMLButtonElement>();

  // Ship & Crew section
  private shipCrewGroupEl: HTMLDivElement | null = null;
  private relicStripEl: HTMLDivElement | null = null;
  private shipCardsEl: HTMLDivElement | null = null;
  private lastRelicStripKey: string | null = null;
  private readonly shipBtns = new Map<V2ShipId, HTMLButtonElement>();
  private readonly shipSmallEls = new Map<V2ShipId, HTMLElement>();
  private readonly crewBtns = new Map<V2CrewId, HTMLButtonElement>();
  private readonly crewContentKeys = new Map<V2CrewId, string>();

  // Archetypes
  private readonly archBtns = new Map<V2ArchetypeId, HTMLButtonElement>();

  // Budget & Equipment Pools
  private budgetValEl: HTMLElement | null = null;
  private fallbackBtnEl: HTMLButtonElement | null = null;
  private clearBtnEl: HTMLButtonElement | null = null;
  private trialWarnAnchorEl: HTMLDivElement | null = null;
  private trialWarnBannerEl: HTMLDivElement | null = null;
  private loanPoolEl: HTMLDivElement | null = null;
  private readonly loanBtns = new Map<V2EquipmentKind, HTMLButtonElement>();
  private ownedSubtitleEl: HTMLDivElement | null = null;
  private ownedPoolEl: HTMLDivElement | null = null;
  private ownedEmptyEl: HTMLSpanElement | null = null;
  private readonly ownedBtns = new Map<string, OwnedBtnRefs>();

  // Presets
  private presetBoxEl: HTMLDivElement | null = null;
  private presetCountLabelEl: HTMLSpanElement | null = null;
  private presetNameInputEl: HTMLInputElement | null = null;
  private presetSaveBtnEl: HTMLButtonElement | null = null;
  private presetNoticeBannerEl: HTMLDivElement | null = null;
  private presetNoticeTextEl: HTMLSpanElement | null = null;
  private presetSubLoanBtnEl: HTMLButtonElement | null = null;
  private presetListEl: HTMLDivElement | null = null;
  private readonly presetRows = new Map<string, PresetRowRefs>();

  // Sticky CTA Footer
  private footerEl: HTMLDivElement | null = null;
  private validationBannerEl: HTMLDivElement | null = null;
  private launchBtnEl: HTMLButtonElement | null = null;

  // Dynamic runtime state (avoids stale closures & preserves user input)
  private latestActions: PrepareViewActions | null = null;
  private latestReadOnly = false;
  private latestFinalUnlocked = false;
  private latestEndlessUnlocked = false;
  private latestEndlessThreat = 0;
  private latestFallbackPreviewSeed = 1;
  private latestPresetCount = 0;
  private lastAutoPresetName: string | null = null;
  private userEditedPresetName = false;

  private readonly handleRootClick = (ev: Event): void => {
    if (!this.rootEl || !this.latestActions) return;
    const target = ev.target as HTMLElement | null;
    if (!target || typeof target.closest !== 'function') return;
    const btn = target.closest('button') as HTMLButtonElement | null;
    if (!btn || !this.rootEl.contains(btn) || btn.disabled) return;

    const actions = this.latestActions;

    if (btn.id === 'v2-prep-back') {
      actions.onBack();
      return;
    }
    if (btn.id === 'v2-trial-exit') {
      actions.onExitTrial();
      return;
    }
    if (btn.id === 'v2-prep-fallback') {
      actions.onFallback();
      return;
    }
    if (btn.id === 'v2-prep-clear') {
      actions.onClear();
      return;
    }
    if (btn.id === 'v2-preset-save') {
      const name =
        this.presetNameInputEl?.value.trim() || `预设 ${this.latestPresetCount + 1}`;
      this.userEditedPresetName = false;
      actions.onSavePreset(name);
      return;
    }
    if (btn.id === 'v2-preset-sub-loan') {
      actions.onSubLoan();
      return;
    }
    if (btn.id === 'v2-btn-launch-run') {
      actions.onLaunch();
      return;
    }

    const sectorId = btn.dataset.prepSector as SectorId | undefined;
    if (sectorId) {
      actions.onSelectSector(sectorId);
      return;
    }

    const mode = btn.dataset.mode;
    if (mode === 'standard') {
      actions.onSelectStandardMode();
      return;
    }
    if (mode === 'final') {
      if (!this.latestFinalUnlocked || this.latestReadOnly) return;
      actions.onSelectFinalMissionMode();
      return;
    }
    if (mode === 'endless') {
      if (!this.latestEndlessUnlocked || this.latestReadOnly) return;
      actions.onSelectEndlessMode();
      return;
    }

    const threatRaw = btn.dataset.endlessThreat;
    if (threatRaw !== undefined) {
      const lvl = Number(threatRaw);
      if (Number.isInteger(lvl) && lvl >= 1 && lvl <= MAX_ENDLESS_THREAT) {
        actions.onSelectEndlessThreat(lvl);
      }
      return;
    }

    const trialId = btn.dataset.pickTrial as V2TrialBuildId | undefined;
    if (trialId) {
      actions.onPickTrial(trialId);
      return;
    }

    const shipId = btn.dataset.prepShip as V2ShipId | undefined;
    if (shipId) {
      actions.onSelectShip(shipId);
      return;
    }

    const crewId = btn.dataset.prepCrew as V2CrewId | undefined;
    if (crewId) {
      actions.onSelectCrew(crewId);
      return;
    }

    const archId = btn.dataset.prepArch as V2ArchetypeId | undefined;
    if (archId) {
      actions.onSelectArchetype(archId);
      return;
    }

    const loanDefId = btn.dataset.addLoan;
    if (loanDefId) {
      actions.onAddLoan(loanDefId);
      return;
    }

    const ownedId = btn.dataset.addOwned;
    if (ownedId) {
      actions.onAddOwned(ownedId);
      return;
    }

    const loadPresetId = btn.dataset.loadPreset;
    if (loadPresetId) {
      actions.onLoadPreset(loadPresetId);
      return;
    }

    const delPresetId = btn.dataset.delPreset;
    if (delPresetId) {
      actions.onDeletePreset(delPresetId);
    }
  };

  private readonly handleSeedInput = (): void => {
    if (
      !this.rootEl ||
      !this.seedInputEl ||
      !this.latestActions ||
      this.latestReadOnly ||
      this.seedInputEl.disabled
    ) {
      return;
    }
    const raw = this.seedInputEl.value;
    this.latestActions.onChangeCustomSeed(raw);
    if (this.mutatorPreviewEl && this.latestEndlessThreat >= 1) {
      const nextSeed = parseV3CustomSeedInput(raw) ?? this.latestFallbackPreviewSeed;
      const previewKey = `${nextSeed >>> 0}:${this.latestEndlessThreat}`;
      if (this.lastMutatorPreviewKey !== previewKey) {
        this.lastMutatorPreviewKey = previewKey;
        this.mutatorPreviewEl.innerHTML = buildEndlessMutatorPreviewInnerHtml(
          nextSeed,
          this.latestEndlessThreat
        );
      }
    }
  };

  private readonly handlePresetNameInput = (): void => {
    if (
      !this.rootEl ||
      !this.presetNameInputEl ||
      this.latestReadOnly ||
      this.presetNameInputEl.disabled
    ) {
      return;
    }
    this.userEditedPresetName = true;
  };

  isMountedIn(host: HTMLElement): boolean {
    return Boolean(this.hostEl === host && this.rootEl && this.rootEl.parentElement === host);
  }

  getScrollContainer(): HTMLDivElement | null {
    return this.scrollBodyEl;
  }

  mount(host: HTMLElement): void {
    if (this.isMountedIn(host)) return;
    if (this.rootEl || this.hostEl) {
      this.unmount();
    }
    this.hostEl = host;
    host.innerHTML = '';

    const root = document.createElement('div');
    root.className = 'v3-screen-root v3-sticky-panel-root';
    root.dataset.testid = 'prepare-screen';

    // Header
    const header = document.createElement('div');
    header.className = 'panel-header';
    const title = document.createElement('h2');
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'btn btn-sm btn-ghost';
    backBtn.id = 'v2-prep-back';
    backBtn.textContent = '← 返回基地';
    header.appendChild(title);
    header.appendChild(backBtn);
    root.appendChild(header);

    // Scrollable Body (persistent across all updates!)
    const scrollBody = document.createElement('div');
    scrollBody.className = 'v3-panel-scroll-body';

    // Contract Card
    const contractCard = document.createElement('div');
    contractCard.className = 'v3-prep-contract-card';
    scrollBody.appendChild(contractCard);

    // Sector Group
    const sectorGroup = document.createElement('div');
    sectorGroup.className = 'v2-prep-group';
    const sectorLbl = document.createElement('div');
    sectorLbl.className = 'v2-prep-label';
    sectorLbl.textContent = '目标星区（共 3 星区 · 击败首领逐幕解锁）';
    sectorGroup.appendChild(sectorLbl);

    const sectorRow = document.createElement('div');
    sectorRow.className = 'v2-sector-row';
    sectorRow.dataset.testid = 'sector-selector';
    for (const sid of V3_SECTOR_ORDER) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.prepSector = sid;
      btn.dataset.sectorId = sid;
      btn.dataset.testid = `sector-option-${sid}`;
      sectorRow.appendChild(btn);
      this.sectorBtns.set(sid, btn);
    }
    sectorGroup.appendChild(sectorRow);

    const sectorEnvCard = document.createElement('div');
    sectorEnvCard.dataset.testid = 'sector-env-card';
    sectorGroup.appendChild(sectorEnvCard);
    scrollBody.appendChild(sectorGroup);

    // Mode Selector Section
    const modeSection = document.createElement('div');
    modeSection.className = 'v2-prep-group v3-mode-section';
    const modeLbl = document.createElement('div');
    modeLbl.className = 'v2-prep-label';
    modeLbl.innerHTML = `${svgIcon('star', 13)} 出航模式（常规远征 / 第三幕终战 / 无尽深渊）`;
    modeSection.appendChild(modeLbl);

    const modeRow = document.createElement('div');
    modeRow.className = 'v3-mode-selector-row';
    modeRow.setAttribute('role', 'group');
    modeRow.setAttribute('aria-label', '出航模式');

    const modeStdBtn = document.createElement('button');
    modeStdBtn.type = 'button';
    modeStdBtn.dataset.testid = 'btn-mode-standard';
    modeStdBtn.dataset.mode = 'standard';
    modeStdBtn.innerHTML = `<strong>${svgIcon('radar', 13)} 常规远征</strong><small>自由选区与委托推进</small>`;

    const modeFinalBtn = document.createElement('button');
    modeFinalBtn.type = 'button';
    modeFinalBtn.dataset.testid = 'btn-mode-final';
    modeFinalBtn.dataset.mode = 'final';

    const modeEndlessBtn = document.createElement('button');
    modeEndlessBtn.type = 'button';
    modeEndlessBtn.dataset.testid = 'btn-mode-endless';
    modeEndlessBtn.dataset.mode = 'endless';

    modeRow.appendChild(modeStdBtn);
    modeRow.appendChild(modeFinalBtn);
    modeRow.appendChild(modeEndlessBtn);
    modeSection.appendChild(modeRow);

    const climaxCard = document.createElement('div');
    climaxCard.className = 'v3-prep-climax-card';
    climaxCard.dataset.testid = 'final-mission-prep-card';
    climaxCard.innerHTML = `<strong>${svgIcon('star', 13)} 第三幕终局远征已就绪 · 古代星门禁区</strong><span>第 6 层必可抵达三阶段终局首领「黑曜利维坦」，击溃后直接进入星门终局抉择（3 种结局）并解锁无尽深渊。</span>`;

    const endlessLockedHint = document.createElement('div');
    endlessLockedHint.className = 'v3-endless-locked-hint';
    endlessLockedHint.dataset.endlessLocked = 'true';
    endlessLockedHint.innerHTML = `${svgIcon('lock', 12)} <span>无尽深渊尚未解锁：通关第三幕「星门重启远征」后解锁威压 1–10 词条与种子挑战。</span>`;

    const endlessPanel = document.createElement('div');
    endlessPanel.className = 'v3-prep-endless-panel';
    endlessPanel.dataset.testid = 'endless-config-panel';

    const endlessHeadRow = document.createElement('div');
    endlessHeadRow.className = 'v2-prep-label-row';
    const endlessMaxLabel = document.createElement('span');
    endlessMaxLabel.className = 'v2-prep-label';
    endlessHeadRow.appendChild(endlessMaxLabel);
    endlessPanel.appendChild(endlessHeadRow);

    const threatPillsWrap = document.createElement('div');
    threatPillsWrap.className = 'v3-threat-pills';
    threatPillsWrap.setAttribute('role', 'group');
    threatPillsWrap.setAttribute('aria-label', '无尽深渊威压等级');
    for (let lvl = 1; lvl <= MAX_ENDLESS_THREAT; lvl++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'v3-threat-pill';
      btn.dataset.endlessThreat = String(lvl);
      btn.dataset.threat = String(lvl);
      btn.dataset.testid = `endless-threat-${lvl}`;
      btn.textContent = `威压 ${lvl}`;
      threatPillsWrap.appendChild(btn);
      this.threatBtns.set(lvl, btn);
    }
    endlessPanel.appendChild(threatPillsWrap);

    const mutatorPreview = document.createElement('div');
    mutatorPreview.className = 'v3-endless-mutator-preview';
    mutatorPreview.dataset.testid = 'endless-mutator-preview';
    endlessPanel.appendChild(mutatorPreview);

    const seedRow = document.createElement('div');
    seedRow.className = 'v3-seed-row';
    const seedLabel = document.createElement('label');
    seedLabel.setAttribute('for', 'v3-endless-seed-input');
    seedLabel.textContent = '挑战种子';
    const seedInput = document.createElement('input');
    seedInput.type = 'text';
    seedInput.setAttribute('inputmode', 'numeric');
    seedInput.id = 'v3-endless-seed-input';
    seedInput.className = 'v3-seed-input';
    seedInput.dataset.testid = 'endless-seed-input';
    seedInput.setAttribute('name', 'seed');
    seedInput.setAttribute('maxlength', '12');
    seedInput.setAttribute('placeholder', '输入挑战种子（留空随机）');
    seedRow.appendChild(seedLabel);
    seedRow.appendChild(seedInput);
    endlessPanel.appendChild(seedRow);
    scrollBody.appendChild(modeSection);

    // Holodeck Trial Section
    const trialGroup = document.createElement('div');
    trialGroup.className = 'v2-prep-group v2-trial-section';
    const trialHeaderRow = document.createElement('div');
    trialHeaderRow.className = 'v2-prep-label-row';
    const trialLbl = document.createElement('span');
    trialLbl.className = 'v2-prep-label';
    trialLbl.innerHTML = `${svgIcon('bolt', 13)} 全息战术模板（整套模拟体验 + 实战微演示）`;
    trialHeaderRow.appendChild(trialLbl);
    const trialExitBtn = document.createElement('button');
    trialExitBtn.type = 'button';
    trialExitBtn.className = 'btn btn-sm btn-ghost';
    trialExitBtn.id = 'v2-trial-exit';
    trialExitBtn.dataset.testid = 'btn-exit-template';
    trialExitBtn.textContent = '切回自由配装';
    trialGroup.appendChild(trialHeaderRow);

    const trialStrip = document.createElement('div');
    trialStrip.className = 'v2-trial-strip';
    for (const tid of V2_TRIAL_BUILD_ORDER) {
      const spec = V2_TRIAL_BUILDS[tid];
      const ico = tid === 'trial_heavy' ? 'cannon' : tid === 'trial_hangar' ? 'drone' : 'counter';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'v2-trial-mini-card';
      btn.dataset.pickTrial = tid;
      btn.dataset.testid = `btn-trial-template-${tid}`;
      btn.innerHTML = `
        <div class="v2-tm-head">${svgIcon(ico, 15)} <strong>${spec.shortName}</strong></div>
        <div class="v2-tm-pro">${spec.advantage}</div>
        <div class="v2-tm-con">${spec.tradeoff}</div>
      `;
      trialStrip.appendChild(btn);
      this.trialBtns.set(tid, btn);
    }
    trialGroup.appendChild(trialStrip);
    const trialNote = document.createElement('div');
    trialNote.className = 'v2-trial-bp-note';
    trialNote.textContent =
      '全息战术模板为普通品质整套借用（返航归还，不可混搭外部件）；已研究永久蓝图可自由混搭、在工坊制造自有设备（出航预算 -1）并保存预设。';
    trialGroup.appendChild(trialNote);
    scrollBody.appendChild(trialGroup);

    // Ship & Crew Group
    const shipCrewGroup = document.createElement('div');
    shipCrewGroup.className = 'v2-prep-group';
    const scLabelRow = document.createElement('div');
    scLabelRow.className = 'v2-prep-label-row';
    const scLabel = document.createElement('span');
    scLabel.className = 'v2-prep-label';
    scLabel.textContent = `舰船与具名船员（共 ${V2_SHIP_ORDER.length} 舰 · 含船体供能格）`;
    scLabelRow.appendChild(scLabel);
    shipCrewGroup.appendChild(scLabelRow);

    const relicStrip = document.createElement('div');
    relicStrip.className = 'v3-relic-passive-strip';
    relicStrip.style.marginBottom = '6px';
    relicStrip.dataset.testid = 'prepare-relic-passives';

    const shipCards = document.createElement('div');
    shipCards.className = 'v2-ship-cards';
    shipCards.dataset.testid = 'ship-selector';
    for (const sid of V2_SHIP_ORDER) {
      const s = V2_SHIPS[sid];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'v2-choice-pill';
      btn.dataset.prepShip = sid;
      btn.dataset.testid = `ship-option-${sid}`;

      const img = document.createElement('img');
      img.className = 'v2-ship-mini';
      img.src = getPlayerShipImageUrl(sid);
      img.alt = s.name;
      const mainSpan = document.createElement('span');
      mainSpan.className = 'v2-choice-main';
      const strong = document.createElement('strong');
      strong.textContent = s.name;
      const small = document.createElement('small');
      mainSpan.appendChild(strong);
      mainSpan.appendChild(small);
      btn.appendChild(img);
      btn.appendChild(mainSpan);
      shipCards.appendChild(btn);
      this.shipBtns.set(sid, btn);
      this.shipSmallEls.set(sid, small);
    }
    shipCrewGroup.appendChild(shipCards);

    const crewRow = document.createElement('div');
    crewRow.className = 'v2-crew-row';
    crewRow.dataset.testid = 'crew-selector';
    crewRow.style.marginTop = '6px';
    for (const cid of V2_CREW_ORDER) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.prepCrew = cid;
      btn.dataset.crewId = cid;
      btn.dataset.testid = `crew-option-${cid}`;
      crewRow.appendChild(btn);
      this.crewBtns.set(cid, btn);
    }
    shipCrewGroup.appendChild(crewRow);
    scrollBody.appendChild(shipCrewGroup);

    // Archetype Group
    const archGroup = document.createElement('div');
    archGroup.className = 'v2-prep-group';
    const archLbl = document.createElement('div');
    archLbl.className = 'v2-prep-label';
    archLbl.textContent = '航路支援倾向（第 2–4 层保底出现对应配件）';
    archGroup.appendChild(archLbl);
    const archRow = document.createElement('div');
    archRow.className = 'v2-arch-row';
    for (const aid of ARCHETYPE_ORDER) {
      const info = V2_ARCHETYPE_LABELS[aid];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm btn-secondary';
      btn.dataset.prepArch = aid;
      btn.textContent = `${info.name}（${info.supportName}）`;
      archRow.appendChild(btn);
      this.archBtns.set(aid, btn);
    }
    archGroup.appendChild(archRow);
    scrollBody.appendChild(archGroup);

    // Budget & Equipment Pools Group
    const poolGroup = document.createElement('div');
    poolGroup.className = 'v2-prep-group';

    const budgetRow = document.createElement('div');
    budgetRow.className = 'v2-prep-label-row';
    const budgetLbl = document.createElement('span');
    budgetLbl.className = 'v2-prep-label';
    budgetLbl.textContent = '装配预算 ';
    const budgetVal = document.createElement('strong');
    budgetVal.className = 'num';
    budgetLbl.appendChild(budgetVal);
    budgetRow.appendChild(budgetLbl);

    const budgetCtrlWrap = document.createElement('div');
    budgetCtrlWrap.style.display = 'flex';
    budgetCtrlWrap.style.gap = '6px';
    const fallbackBtn = document.createElement('button');
    fallbackBtn.type = 'button';
    fallbackBtn.className = 'btn btn-sm btn-ghost';
    fallbackBtn.id = 'v2-prep-fallback';
    fallbackBtn.textContent = '标准配装';
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn btn-sm btn-ghost';
    clearBtn.id = 'v2-prep-clear';
    clearBtn.textContent = '清空';
    budgetCtrlWrap.appendChild(fallbackBtn);
    budgetCtrlWrap.appendChild(clearBtn);
    budgetRow.appendChild(budgetCtrlWrap);
    poolGroup.appendChild(budgetRow);

    const trialWarnBanner = document.createElement('div');
    trialWarnBanner.className = 'system-banner banner-warn';
    trialWarnBanner.style.margin = '4px 0 8px 0';

    const loanSubtitle = document.createElement('div');
    loanSubtitle.className = 'v2-pool-subtitle';
    loanSubtitle.textContent = '永久蓝图借用（免费 · 返航归还）';
    poolGroup.appendChild(loanSubtitle);

    const loanPool = document.createElement('div');
    loanPool.className = 'v2-pool-chips';
    poolGroup.appendChild(loanPool);

    const ownedSubtitle = document.createElement('div');
    ownedSubtitle.className = 'v2-pool-subtitle';
    poolGroup.appendChild(ownedSubtitle);

    const ownedPool = document.createElement('div');
    ownedPool.className = 'v2-pool-chips';
    poolGroup.appendChild(ownedPool);

    const ownedEmpty = document.createElement('span');
    ownedEmpty.className = 'v2-empty-inline';
    ownedEmpty.textContent = '设备库暂无自有设备（可返航入库或工坊制造）';
    scrollBody.appendChild(poolGroup);

    // Loadout Presets Group
    const presetBox = document.createElement('div');
    presetBox.className = 'v2-prep-group v2-preset-box';
    const presetRow = document.createElement('div');
    presetRow.className = 'v2-prep-label-row';
    const presetCountLabel = document.createElement('span');
    presetCountLabel.className = 'v2-prep-label';
    presetRow.appendChild(presetCountLabel);

    const presetInputWrap = document.createElement('div');
    presetInputWrap.style.display = 'flex';
    presetInputWrap.style.gap = '6px';
    presetInputWrap.style.alignItems = 'center';

    const presetNameInput = document.createElement('input');
    presetNameInput.type = 'text';
    presetNameInput.id = 'v2-preset-name';
    presetNameInput.className = 'v2-preset-input';
    presetNameInput.setAttribute('maxlength', '16');
    presetNameInput.setAttribute('placeholder', '预设名称');

    const presetSaveBtn = document.createElement('button');
    presetSaveBtn.type = 'button';
    presetSaveBtn.className = 'btn btn-sm btn-secondary';
    presetSaveBtn.id = 'v2-preset-save';
    presetSaveBtn.dataset.testid = 'btn-save-preset';
    presetSaveBtn.textContent = '保存预设';

    presetInputWrap.appendChild(presetNameInput);
    presetInputWrap.appendChild(presetSaveBtn);
    presetRow.appendChild(presetInputWrap);
    presetBox.appendChild(presetRow);

    const presetNoticeBanner = document.createElement('div');
    presetNoticeBanner.className = 'system-banner banner-warn';
    presetNoticeBanner.style.margin = '6px 0';
    const presetNoticeText = document.createElement('span');
    presetNoticeBanner.appendChild(presetNoticeText);
    const presetSubLoanBtn = document.createElement('button');
    presetSubLoanBtn.type = 'button';
    presetSubLoanBtn.className = 'btn btn-sm btn-primary';
    presetSubLoanBtn.id = 'v2-preset-sub-loan';
    presetSubLoanBtn.textContent = '用借用普通版补位';

    const presetList = document.createElement('div');
    presetList.className = 'v2-preset-list';
    scrollBody.appendChild(presetBox);

    root.appendChild(scrollBody);

    // Sticky CTA Footer
    const footer = document.createElement('div');
    footer.className = 'v3-sticky-cta-footer';
    const validationBanner = document.createElement('div');
    validationBanner.className = 'system-banner banner-danger';
    const launchBtn = document.createElement('button');
    launchBtn.type = 'button';
    launchBtn.className = 'btn btn-primary btn-launch-hero';
    launchBtn.id = 'v2-btn-launch-run';
    launchBtn.dataset.testid = 'btn-launch-expedition';
    launchBtn.innerHTML = `${svgIcon('rocket', 16)} 确认整备 · 启动远航`;
    footer.appendChild(launchBtn);
    root.appendChild(footer);

    host.appendChild(root);

    root.addEventListener('click', this.handleRootClick);
    seedInput.addEventListener('input', this.handleSeedInput);
    presetNameInput.addEventListener('input', this.handlePresetNameInput);

    this.rootEl = root;
    this.titleEl = title;
    this.scrollBodyEl = scrollBody;
    this.contractCardEl = contractCard;
    this.sectorEnvCardEl = sectorEnvCard;
    this.modeSectionEl = modeSection;
    this.modeStdBtnEl = modeStdBtn;
    this.modeFinalBtnEl = modeFinalBtn;
    this.modeEndlessBtnEl = modeEndlessBtn;
    this.climaxCardEl = climaxCard;
    this.endlessLockedHintEl = endlessLockedHint;
    this.endlessPanelEl = endlessPanel;
    this.endlessMaxLabelEl = endlessMaxLabel;
    this.mutatorPreviewEl = mutatorPreview;
    this.seedInputEl = seedInput;
    this.trialHeaderRowEl = trialHeaderRow;
    this.trialExitBtnEl = trialExitBtn;
    this.shipCrewGroupEl = shipCrewGroup;
    this.relicStripEl = relicStrip;
    this.shipCardsEl = shipCards;
    this.budgetValEl = budgetVal;
    this.fallbackBtnEl = fallbackBtn;
    this.clearBtnEl = clearBtn;
    this.trialWarnAnchorEl = loanSubtitle;
    this.trialWarnBannerEl = trialWarnBanner;
    this.loanPoolEl = loanPool;
    this.ownedSubtitleEl = ownedSubtitle;
    this.ownedPoolEl = ownedPool;
    this.ownedEmptyEl = ownedEmpty;
    this.presetBoxEl = presetBox;
    this.presetCountLabelEl = presetCountLabel;
    this.presetNameInputEl = presetNameInput;
    this.presetSaveBtnEl = presetSaveBtn;
    this.presetNoticeBannerEl = presetNoticeBanner;
    this.presetNoticeTextEl = presetNoticeText;
    this.presetSubLoanBtnEl = presetSubLoanBtn;
    this.presetListEl = presetList;
    this.footerEl = footer;
    this.validationBannerEl = validationBanner;
    this.launchBtnEl = launchBtn;
  }

  update(props: PrepareViewProps, actions: PrepareViewActions): void {
    this.latestActions = actions;
    if (!this.rootEl) return;

    const {
      profile: p,
      draft,
      readOnly,
      validation: check,
      effectivePreviewSeed,
      fallbackPreviewSeed = effectivePreviewSeed,
    } = props;

    this.latestReadOnly = readOnly;
    this.latestFallbackPreviewSeed = fallbackPreviewSeed;
    this.latestEndlessThreat = draft.endlessThreat;
    this.latestPresetCount = p.loadoutPresets.length;

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
    const finalGate = isFinalCampaignMissionUnlocked(p);
    const endlessUnlocked = Boolean(p.campaign.endlessUnlocked);
    this.latestFinalUnlocked = finalGate.unlocked;
    this.latestEndlessUnlocked = endlessUnlocked;

    const maxAllowedThreat = endlessUnlocked
      ? Math.max(1, Math.min(MAX_ENDLESS_THREAT, Math.floor(p.campaign.maxEndlessThreat || 1)))
      : 0;
    const isEndlessActive =
      !draft.isFinalCampaignRun && draft.endlessThreat >= 1 && endlessUnlocked;
    const isStandardActive = !draft.isFinalCampaignRun && !isEndlessActive;
    const displayContractName = draft.isFinalCampaignRun ? '星门重启远征' : contractTpl.name;
    const previewSeedForMutators =
      parseV3CustomSeedInput(draft.customSeedInput) ?? fallbackPreviewSeed;

    // Header title
    const titleText = `出航整备 · ${displayContractName}`;
    if (this.titleEl && this.titleEl.textContent !== titleText) {
      this.titleEl.textContent = titleText;
    }

    // Contract card
    const contractKey = `${contractTpl.templateId}`;
    if (this.contractCardEl && this.lastContractKey !== contractKey) {
      this.lastContractKey = contractKey;
      this.contractCardEl.innerHTML = `
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
      `;
    }

    // Sectors
    for (const sid of V3_SECTOR_ORDER) {
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
      const btn = this.sectorBtns.get(sid);
      if (btn) {
        const cls = `v2-sector-chip ${toneCls}${active ? ' active' : ''}${
          unlocked ? '' : ' is-locked'
        }`;
        if (btn.className !== cls) btn.className = cls;
        const lockedAttr = unlocked ? 'false' : 'true';
        if (btn.dataset.locked !== lockedAttr) btn.dataset.locked = lockedAttr;
        syncButtonDisabled(btn, !unlocked || readOnly);
        const cKey = `${unlocked ? 1 : 0}`;
        if (this.sectorContentKeys.get(sid) !== cKey) {
          this.sectorContentKeys.set(sid, cKey);
          btn.innerHTML = `<strong>${svgIcon(unlocked ? secIco : 'lock', 13)} ${sec.name}</strong><small>${
            unlocked ? sec.envModifier.shortBadge : `未解锁 · ${sec.unlockRequirementText}`
          }</small>`;
        }
      }
    }

    // Sector Env Card
    const sectorEnvKey = `${activeSector.id}:${activePity.triggered ? 1 : 0}:${activePity.counter}/${activePity.threshold}`;
    if (this.sectorEnvCardEl && this.lastSectorEnvKey !== sectorEnvKey) {
      this.lastSectorEnvKey = sectorEnvKey;
      this.sectorEnvCardEl.className = `v3-sector-env-card env-${activeSector.envModifier.id}`;
      this.sectorEnvCardEl.innerHTML = `
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
      `;
    }

    // Mode buttons
    if (this.modeStdBtnEl) {
      const stdCls = `v3-mode-btn mode-standard${isStandardActive ? ' active' : ''}`;
      if (this.modeStdBtnEl.className !== stdCls) this.modeStdBtnEl.className = stdCls;
      this.modeStdBtnEl.setAttribute('aria-pressed', String(isStandardActive));
      syncButtonDisabled(this.modeStdBtnEl, readOnly);
    }

    if (this.modeFinalBtnEl) {
      const finalCls = `v3-mode-btn mode-final${draft.isFinalCampaignRun ? ' active' : ''}`;
      if (this.modeFinalBtnEl.className !== finalCls) this.modeFinalBtnEl.className = finalCls;
      this.modeFinalBtnEl.setAttribute('aria-pressed', String(draft.isFinalCampaignRun));
      syncButtonDisabled(this.modeFinalBtnEl, !finalGate.unlocked || readOnly);
      const finalKey = `${finalGate.unlocked ? 1 : 0}:${finalGate.unmetReasons[0] ?? ''}`;
      if (this.lastFinalModeContentKey !== finalKey) {
        this.lastFinalModeContentKey = finalKey;
        this.modeFinalBtnEl.innerHTML = `
          <strong>${svgIcon(finalGate.unlocked ? 'boss' : 'lock', 13)} ${
          finalGate.unlocked ? '星门重启远征' : '星门重启远征（未解锁）'
        }</strong>
          <small>${
            finalGate.unlocked
              ? '古代星门禁区 · 三阶段终局决战'
              : finalGate.unmetReasons[0] ?? '需达成第三幕前置条件'
          }</small>
        `;
      }
    }

    if (this.modeEndlessBtnEl) {
      const endCls = `v3-mode-btn mode-endless${isEndlessActive ? ' active' : ''}`;
      if (this.modeEndlessBtnEl.className !== endCls) this.modeEndlessBtnEl.className = endCls;
      this.modeEndlessBtnEl.setAttribute('aria-pressed', String(isEndlessActive));
      syncButtonDisabled(this.modeEndlessBtnEl, !endlessUnlocked || readOnly);
      const endKey = `${endlessUnlocked ? 1 : 0}:${maxAllowedThreat}`;
      if (this.lastEndlessModeContentKey !== endKey) {
        this.lastEndlessModeContentKey = endKey;
        this.modeEndlessBtnEl.innerHTML = `
          <strong>${svgIcon(endlessUnlocked ? 'bolt' : 'lock', 13)} ${
          endlessUnlocked ? '无尽深渊' : '无尽深渊（通关第三幕解锁 · 未解锁）'
        }</strong>
          <small>${
            endlessUnlocked
              ? `当前开放至第 ${maxAllowedThreat} 阶 · 词条与种子挑战`
              : '通关第三幕「星门重启远征」后解锁'
          }</small>
        `;
      }
    }

    if (this.modeSectionEl && this.climaxCardEl) {
      if (draft.isFinalCampaignRun) {
        if (this.climaxCardEl.parentElement !== this.modeSectionEl) {
          this.modeSectionEl.appendChild(this.climaxCardEl);
        }
      } else if (this.climaxCardEl.parentElement) {
        this.climaxCardEl.remove();
      }
    }

    if (this.modeSectionEl && this.endlessLockedHintEl && this.endlessPanelEl) {
      if (!endlessUnlocked) {
        if (this.endlessPanelEl.parentElement) this.endlessPanelEl.remove();
        if (this.endlessLockedHintEl.parentElement !== this.modeSectionEl) {
          this.modeSectionEl.appendChild(this.endlessLockedHintEl);
        }
      } else if (isEndlessActive) {
        if (this.endlessLockedHintEl.parentElement) this.endlessLockedHintEl.remove();
        if (this.endlessPanelEl.parentElement !== this.modeSectionEl) {
          this.modeSectionEl.appendChild(this.endlessPanelEl);
        }
        if (this.endlessMaxLabelEl) {
          const maxLblHtml = `${svgIcon('bolt', 12)} 无尽深渊威压等级（当前开放 威压 1–${maxAllowedThreat} / 10）`;
          if (this.endlessMaxLabelEl.innerHTML !== maxLblHtml) {
            this.endlessMaxLabelEl.innerHTML = maxLblHtml;
          }
        }
        for (let lvl = 1; lvl <= MAX_ENDLESS_THREAT; lvl++) {
          const btn = this.threatBtns.get(lvl);
          if (!btn) continue;
          const allowed = lvl <= maxAllowedThreat;
          const selected = draft.endlessThreat === lvl;
          btn.classList.toggle('active', selected);
          btn.setAttribute('aria-pressed', String(selected));
          syncButtonDisabled(btn, !allowed || readOnly);
        }
        if (this.mutatorPreviewEl) {
          const mKey = `${previewSeedForMutators >>> 0}:${draft.endlessThreat}`;
          if (this.lastMutatorPreviewKey !== mKey) {
            this.lastMutatorPreviewKey = mKey;
            this.mutatorPreviewEl.innerHTML = buildEndlessMutatorPreviewInnerHtml(
              previewSeedForMutators,
              draft.endlessThreat
            );
          }
        }
        if (this.seedInputEl) {
          syncInputDisabled(this.seedInputEl, readOnly);
          const isFocused =
            typeof document !== 'undefined' && document.activeElement === this.seedInputEl;
          if (!isFocused && this.seedInputEl.value !== draft.customSeedInput) {
            this.seedInputEl.value = draft.customSeedInput;
            this.seedInputEl.setAttribute('value', draft.customSeedInput);
          }
        }
      } else {
        if (this.endlessLockedHintEl.parentElement) this.endlessLockedHintEl.remove();
        if (this.endlessPanelEl.parentElement) this.endlessPanelEl.remove();
      }
    }

    // Trials
    if (this.trialHeaderRowEl && this.trialExitBtnEl) {
      if (draft.trialBuildId) {
        if (this.trialExitBtnEl.parentElement !== this.trialHeaderRowEl) {
          this.trialHeaderRowEl.appendChild(this.trialExitBtnEl);
        }
        syncButtonDisabled(this.trialExitBtnEl, readOnly);
      } else if (this.trialExitBtnEl.parentElement) {
        this.trialExitBtnEl.remove();
      }
    }
    for (const tid of V2_TRIAL_BUILD_ORDER) {
      const btn = this.trialBtns.get(tid);
      if (!btn) continue;
      btn.classList.toggle('active', draft.trialBuildId === tid);
      syncButtonDisabled(btn, readOnly);
    }

    // Relic passives strip
    if (this.shipCrewGroupEl && this.relicStripEl && this.shipCardsEl) {
      if (relicPassives.activeRelicIds.length > 0) {
        const rKey = relicPassives.activeRelicIds.join(',');
        if (this.lastRelicStripKey !== rKey) {
          this.lastRelicStripKey = rKey;
          this.relicStripEl.innerHTML = relicPassives.activeRelicIds
            .map(
              (rid) =>
                `<span class="v3-relic-passive-pill">${svgIcon('museum', 11)} ${
                  V3_RELIC_PASSIVES[rid]?.shortBadge ?? rid
                }</span>`
            )
            .join('');
        }
        if (this.relicStripEl.parentElement !== this.shipCrewGroupEl) {
          this.shipCrewGroupEl.insertBefore(this.relicStripEl, this.shipCardsEl);
        }
      } else {
        this.lastRelicStripKey = null;
        if (this.relicStripEl.parentElement) this.relicStripEl.remove();
      }
    }

    // Ships
    for (const sid of V2_SHIP_ORDER) {
      const s = V2_SHIPS[sid];
      const unlocked = p.unlockedShips.includes(sid);
      const active = draft.shipId === sid;
      const effHp = getEffectiveShipMaxHp(p, sid);
      const effBudget = getEffectiveShipLoadoutBudget(p, sid);
      const btn = this.shipBtns.get(sid);
      const small = this.shipSmallEls.get(sid);
      if (btn) {
        btn.classList.toggle('active', active);
        syncButtonDisabled(btn, !unlocked || readOnly);
      }
      if (small) {
        const subText = `${s.cols}×${s.rows} (${s.validCellCount}格·⚡${s.powerCells.length}) · HP ${effHp} · 预算 ${effBudget}${
          s.bonusShield > 0 ? ` · +${s.bonusShield}盾` : ''
        }${!unlocked ? ' · 未解锁' : ''}`;
        if (small.textContent !== subText) small.textContent = subText;
      }
    }

    // Crew
    for (const cid of V2_CREW_ORDER) {
      const c = V2_CREW[cid];
      const unlocked = p.unlockedCrew.includes(cid);
      const active = draft.crewId === cid;
      const tier = Math.max(0, Math.min(2, Math.floor(p.crewMastery[cid] ?? 0)));
      const tierDef = getV2CrewMasteryTierDef(cid, tier);
      const stars = `${'★'.repeat(tier)}${'☆'.repeat(2 - tier)}`;
      const btn = this.crewBtns.get(cid);
      if (btn) {
        const cls = `v2-crew-pill${active ? ' active' : ''}${unlocked ? '' : ' is-locked'}`;
        if (btn.className !== cls) btn.className = cls;
        const lockedStr = unlocked ? 'false' : 'true';
        if (btn.dataset.locked !== lockedStr) btn.dataset.locked = lockedStr;
        syncButtonDisabled(btn, !unlocked || readOnly);

        const cKey = `${unlocked ? 1 : 0}:${tier}`;
        if (this.crewContentKeys.get(cid) !== cKey) {
          this.crewContentKeys.set(cid, cKey);
          btn.innerHTML = `
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
          `;
        }
      }
    }

    // Archetypes
    for (const aid of ARCHETYPE_ORDER) {
      const btn = this.archBtns.get(aid);
      if (!btn) continue;
      const cls = `btn btn-sm ${draft.primaryArchetype === aid ? 'btn-primary' : 'btn-secondary'}`;
      if (btn.className !== cls) btn.className = cls;
      syncButtonDisabled(btn, readOnly);
    }

    // Budget & Trial Warning Banner
    const budgetText = `${check.totalBudget}/${check.maxBudget}`;
    if (this.budgetValEl && this.budgetValEl.textContent !== budgetText) {
      this.budgetValEl.textContent = budgetText;
    }
    if (this.fallbackBtnEl) syncButtonDisabled(this.fallbackBtnEl, readOnly);
    if (this.clearBtnEl) syncButtonDisabled(this.clearBtnEl, readOnly);

    if (this.trialWarnBannerEl && this.trialWarnAnchorEl && this.trialWarnAnchorEl.parentElement) {
      if (draft.trialBuildId) {
        const msg = `当前处于「${V2_TRIAL_BUILDS[draft.trialBuildId].shortName}」整套试航模式：可在右侧舱内拖动/旋转体验联动，点击上方「切回自由配装」即可增删设备与保存预设。`;
        if (this.trialWarnBannerEl.textContent !== msg) this.trialWarnBannerEl.textContent = msg;
        if (this.trialWarnBannerEl.parentElement !== this.trialWarnAnchorEl.parentElement) {
          this.trialWarnAnchorEl.parentElement.insertBefore(
            this.trialWarnBannerEl,
            this.trialWarnAnchorEl
          );
        }
      } else if (this.trialWarnBannerEl.parentElement) {
        this.trialWarnBannerEl.remove();
      }
    }

    // Keyed Loan Blueprint Pool
    if (this.loanPoolEl) {
      const nextKinds = new Set<V2EquipmentKind>(p.blueprints);
      for (const [kind, btn] of this.loanBtns.entries()) {
        if (!nextKinds.has(kind)) {
          btn.remove();
          this.loanBtns.delete(kind);
        }
      }

      p.blueprints.forEach((kind, idx) => {
        const def = getV2EquipmentDefByKind(kind, 'common');
        const overBudget = check.totalBudget + def.budgetCost > check.maxBudget;
        let btn = this.loanBtns.get(kind);
        if (!btn) {
          btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'v2-pool-btn';
          btn.dataset.addLoan = def.defId;
          btn.innerHTML = `<span class="v2-origin-badge origin-loan">借</span><img src="${getItemImageUrl(
            def.defId
          )}" alt="${def.name}" /><span>${def.name}<small>${V2_SHAPES[def.shapeId].label} · 预算${
            def.budgetCost
          }</small></span>`;
          this.loanBtns.set(kind, btn);
        }
        syncButtonDisabled(btn, Boolean(draft.trialBuildId || overBudget || readOnly));
        const curAtIdx = this.loanPoolEl!.children[idx];
        if (curAtIdx !== btn) {
          this.loanPoolEl!.insertBefore(btn, curAtIdx ?? null);
        }
      });
    }

    // Keyed Owned Warehouse Pool
    const ownedSubText = `仓库自有设备与装置（${p.equipmentWarehouse.length} 件 · 普通自有预算 -1 · 战败损失实物）`;
    if (this.ownedSubtitleEl && this.ownedSubtitleEl.textContent !== ownedSubText) {
      this.ownedSubtitleEl.textContent = ownedSubText;
    }

    if (this.ownedPoolEl && this.ownedEmptyEl) {
      const validOwned = p.equipmentWarehouse.filter(
        (w) => Boolean(V2_EQUIPMENT_DEFS[w.definitionId] || getV3GadgetDef(w.definitionId))
      );

      if (validOwned.length === 0) {
        for (const refs of this.ownedBtns.values()) {
          refs.btnEl.remove();
        }
        this.ownedBtns.clear();
        if (this.ownedEmptyEl.parentElement !== this.ownedPoolEl) {
          this.ownedPoolEl.appendChild(this.ownedEmptyEl);
        }
      } else {
        if (this.ownedEmptyEl.parentElement) this.ownedEmptyEl.remove();
        const nextOwnedIds = new Set<string>(validOwned.map((w) => w.instanceId));
        for (const [iid, refs] of this.ownedBtns.entries()) {
          if (!nextOwnedIds.has(iid)) {
            refs.btnEl.remove();
            this.ownedBtns.delete(iid);
          }
        }

        validOwned.forEach((w, idx) => {
          const eqDef = V2_EQUIPMENT_DEFS[w.definitionId];
          const gdDef = eqDef ? undefined : getV3GadgetDef(w.definitionId);
          const alreadyUsed = usedOwnedIds.has(w.instanceId);
          const effBudget = eqDef
            ? getEffectiveV2EquipmentBudgetCost(eqDef, 'owned')
            : gdDef!.budgetCost;
          const overBudget = check.totalBudget + effBudget > check.maxBudget;
          const discountSuffix = eqDef && effBudget < eqDef.budgetCost ? '(-1)' : '';
          const name = eqDef?.name ?? gdDef!.name;
          const tagText = gdDef ? '耗' : w.quality === 'improved' ? '良' : '普';

          let refs = this.ownedBtns.get(w.instanceId);
          if (!refs) {
            const btnEl = document.createElement('button');
            btnEl.type = 'button';
            btnEl.dataset.addOwned = w.instanceId;
            const badge = document.createElement('span');
            badge.className = 'v2-origin-badge origin-owned';
            badge.textContent = '自';
            const img = document.createElement('img');
            img.src = getItemImageUrl(w.definitionId);
            img.alt = name;
            const textWrap = document.createElement('span');
            textWrap.innerHTML = `${name} <em class="v2-q-tag">${tagText}</em>`;
            const smallEl = document.createElement('small');
            textWrap.appendChild(smallEl);
            btnEl.appendChild(badge);
            btnEl.appendChild(img);
            btnEl.appendChild(textWrap);
            refs = { btnEl, smallEl };
            this.ownedBtns.set(w.instanceId, refs);
          }

          const nextCls = `v2-pool-btn origin-owned${alreadyUsed ? '' : ' warehouse-item'}`;
          if (refs.btnEl.className !== nextCls) refs.btnEl.className = nextCls;

          if (alreadyUsed) {
            refs.btnEl.removeAttribute('data-testid');
            refs.btnEl.removeAttribute('data-origin');
          } else {
            const tid = `warehouse-item-${w.instanceId}`;
            if (refs.btnEl.dataset.testid !== tid) refs.btnEl.dataset.testid = tid;
            if (refs.btnEl.dataset.origin !== 'owned') refs.btnEl.dataset.origin = 'owned';
          }

          const smallText = alreadyUsed ? '已装载' : `预算${effBudget}${discountSuffix}`;
          if (refs.smallEl.textContent !== smallText) refs.smallEl.textContent = smallText;
          syncButtonDisabled(
            refs.btnEl,
            Boolean(draft.trialBuildId || alreadyUsed || overBudget || readOnly)
          );

          const curAtIdx = this.ownedPoolEl!.children[idx];
          if (curAtIdx !== refs.btnEl) {
            this.ownedPoolEl!.insertBefore(refs.btnEl, curAtIdx ?? null);
          }
        });
      }
    }

    // Presets
    const presetLblText = `配装预设 (${p.loadoutPresets.length}/${maxPresets})`;
    if (this.presetCountLabelEl && this.presetCountLabelEl.textContent !== presetLblText) {
      this.presetCountLabelEl.textContent = presetLblText;
    }

    if (this.presetNameInputEl) {
      syncInputDisabled(this.presetNameInputEl, readOnly);
      const nextAutoName = `${V2_SHIPS[draft.shipId].name.slice(0, 4)}-${V2_ARCHETYPE_LABELS[
        draft.primaryArchetype
      ].name.slice(0, 2)}`;
      const isFocused =
        typeof document !== 'undefined' && document.activeElement === this.presetNameInputEl;
      if (!this.userEditedPresetName && !isFocused && this.lastAutoPresetName !== nextAutoName) {
        this.lastAutoPresetName = nextAutoName;
        this.presetNameInputEl.value = nextAutoName;
        this.presetNameInputEl.setAttribute('value', nextAutoName);
      } else if (this.lastAutoPresetName === null) {
        this.lastAutoPresetName = nextAutoName;
      }
    }

    if (this.presetSaveBtnEl) {
      syncButtonDisabled(
        this.presetSaveBtnEl,
        readOnly || draft.trialBuildId !== null || draft.slots.length === 0
      );
    }

    if (
      this.presetBoxEl &&
      this.presetNoticeBannerEl &&
      this.presetNoticeTextEl &&
      this.presetSubLoanBtnEl &&
      this.presetListEl
    ) {
      if (draft.presetNotice) {
        if (this.presetNoticeTextEl.textContent !== draft.presetNotice) {
          this.presetNoticeTextEl.textContent = draft.presetNotice;
        }
        const canSub = draft.missingPresetEntries.some((m) => m.canSubstituteCommonLoan);
        if (canSub) {
          if (this.presetSubLoanBtnEl.parentElement !== this.presetNoticeBannerEl) {
            this.presetNoticeBannerEl.appendChild(this.presetSubLoanBtnEl);
          }
          syncButtonDisabled(this.presetSubLoanBtnEl, readOnly);
        } else if (this.presetSubLoanBtnEl.parentElement) {
          this.presetSubLoanBtnEl.remove();
        }
        if (this.presetNoticeBannerEl.parentElement !== this.presetBoxEl) {
          const anchor =
            this.presetListEl.parentElement === this.presetBoxEl ? this.presetListEl : null;
          this.presetBoxEl.insertBefore(this.presetNoticeBannerEl, anchor);
        }
      } else if (this.presetNoticeBannerEl.parentElement) {
        this.presetNoticeBannerEl.remove();
      }

      if (p.loadoutPresets.length > 0) {
        if (this.presetListEl.parentElement !== this.presetBoxEl) {
          this.presetBoxEl.appendChild(this.presetListEl);
        }
        const nextPresetIds = new Set<string>(p.loadoutPresets.map((pr) => pr.presetId));
        for (const [pid, refs] of this.presetRows.entries()) {
          if (!nextPresetIds.has(pid)) {
            refs.rowEl.remove();
            this.presetRows.delete(pid);
          }
        }
        p.loadoutPresets.forEach((pr, idx) => {
          let refs = this.presetRows.get(pr.presetId);
          if (!refs) {
            const rowEl = document.createElement('div');
            rowEl.className = 'v2-preset-item';
            const labelEl = document.createElement('span');
            const btnsDiv = document.createElement('div');
            btnsDiv.style.display = 'flex';
            btnsDiv.style.gap = '4px';
            const loadBtnEl = document.createElement('button');
            loadBtnEl.type = 'button';
            loadBtnEl.className = 'btn btn-sm btn-secondary';
            loadBtnEl.dataset.loadPreset = pr.presetId;
            loadBtnEl.textContent = '载入';
            const delBtnEl = document.createElement('button');
            delBtnEl.type = 'button';
            delBtnEl.className = 'btn btn-sm btn-ghost';
            delBtnEl.dataset.delPreset = pr.presetId;
            delBtnEl.textContent = '删';
            btnsDiv.appendChild(loadBtnEl);
            btnsDiv.appendChild(delBtnEl);
            rowEl.appendChild(labelEl);
            rowEl.appendChild(btnsDiv);
            refs = { rowEl, labelEl, loadBtnEl, delBtnEl, infoKey: '' };
            this.presetRows.set(pr.presetId, refs);
          }
          const infoKey = `${pr.name}:${pr.shipId}:${pr.slots.length}`;
          if (refs.infoKey !== infoKey) {
            refs.infoKey = infoKey;
            refs.labelEl.innerHTML = `<strong>${pr.name}</strong> <small>(${
              V2_SHIPS[pr.shipId].name
            } · ${pr.slots.length}件)</small>`;
          }
          syncButtonDisabled(refs.loadBtnEl, readOnly);
          syncButtonDisabled(refs.delBtnEl, readOnly);
          const curAtIdx = this.presetListEl!.children[idx];
          if (curAtIdx !== refs.rowEl) {
            this.presetListEl!.insertBefore(refs.rowEl, curAtIdx ?? null);
          }
        });
      } else {
        for (const refs of this.presetRows.values()) {
          refs.rowEl.remove();
        }
        this.presetRows.clear();
        if (this.presetListEl.parentElement) this.presetListEl.remove();
      }
    }

    // Sticky CTA footer
    if (this.footerEl && this.validationBannerEl && this.launchBtnEl) {
      if (!check.valid) {
        const errMsg = check.errors.join('；');
        if (this.validationBannerEl.textContent !== errMsg) {
          this.validationBannerEl.textContent = errMsg;
        }
        if (this.validationBannerEl.parentElement !== this.footerEl) {
          this.footerEl.insertBefore(this.validationBannerEl, this.launchBtnEl);
        }
      } else if (this.validationBannerEl.parentElement) {
        this.validationBannerEl.remove();
      }
      syncButtonDisabled(this.launchBtnEl, readOnly || !check.valid);
    }
  }

  unmount(): void {
    this.rootEl?.removeEventListener('click', this.handleRootClick);
    this.seedInputEl?.removeEventListener('input', this.handleSeedInput);
    this.presetNameInputEl?.removeEventListener('input', this.handlePresetNameInput);
    this.rootEl?.remove();
    this.sectorBtns.clear();
    this.sectorContentKeys.clear();
    this.threatBtns.clear();
    this.trialBtns.clear();
    this.shipBtns.clear();
    this.shipSmallEls.clear();
    this.crewBtns.clear();
    this.crewContentKeys.clear();
    this.archBtns.clear();
    this.loanBtns.clear();
    this.ownedBtns.clear();
    this.presetRows.clear();
    this.hostEl = null;
    this.rootEl = null;
    this.titleEl = null;
    this.scrollBodyEl = null;
    this.contractCardEl = null;
    this.lastContractKey = null;
    this.sectorEnvCardEl = null;
    this.lastSectorEnvKey = null;
    this.modeSectionEl = null;
    this.modeStdBtnEl = null;
    this.modeFinalBtnEl = null;
    this.modeEndlessBtnEl = null;
    this.lastFinalModeContentKey = null;
    this.lastEndlessModeContentKey = null;
    this.climaxCardEl = null;
    this.endlessLockedHintEl = null;
    this.endlessPanelEl = null;
    this.endlessMaxLabelEl = null;
    this.mutatorPreviewEl = null;
    this.seedInputEl = null;
    this.lastMutatorPreviewKey = null;
    this.trialHeaderRowEl = null;
    this.trialExitBtnEl = null;
    this.shipCrewGroupEl = null;
    this.relicStripEl = null;
    this.shipCardsEl = null;
    this.lastRelicStripKey = null;
    this.budgetValEl = null;
    this.fallbackBtnEl = null;
    this.clearBtnEl = null;
    this.trialWarnAnchorEl = null;
    this.trialWarnBannerEl = null;
    this.loanPoolEl = null;
    this.ownedSubtitleEl = null;
    this.ownedPoolEl = null;
    this.ownedEmptyEl = null;
    this.presetBoxEl = null;
    this.presetCountLabelEl = null;
    this.presetNameInputEl = null;
    this.presetSaveBtnEl = null;
    this.presetNoticeBannerEl = null;
    this.presetNoticeTextEl = null;
    this.presetSubLoanBtnEl = null;
    this.presetListEl = null;
    this.footerEl = null;
    this.validationBannerEl = null;
    this.launchBtnEl = null;
    this.latestActions = null;
    this.lastAutoPresetName = null;
    this.userEditedPresetName = false;
  }
}

const legacyPrepareViews = new WeakMap<HTMLElement, PreparePhaseView>();

export function renderPrepareView(
  leftPanelEl: HTMLElement,
  props: PrepareViewProps,
  actions: PrepareViewActions
): void {
  let view = legacyPrepareViews.get(leftPanelEl);
  if (!view) {
    view = new PreparePhaseView();
    legacyPrepareViews.set(leftPanelEl, view);
  }
  if (!view.isMountedIn(leftPanelEl)) {
    view.mount(leftPanelEl);
  }
  view.update(props, actions);
}
