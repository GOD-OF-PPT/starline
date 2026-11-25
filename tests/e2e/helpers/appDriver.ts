import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { STORAGE_KEYS, TEST_IDS } from './contracts';
import type {
  EndingId,
  SectorId,
  StarlineInspectSnapshot,
  V1SaveData,
  V2CrewId,
  V2RewardChoiceId,
  V2SaveData,
  V2WreckSpotId,
  V3_0SaveData,
  V3SaveData,
  V3ShipId,
} from './contracts';

export interface SeedStorageOptions {
  v2Save?: V2SaveData | V3SaveData | V3_0SaveData | string | null;
  v2Backup?: V2SaveData | V3SaveData | V3_0SaveData | string | null;
  v3Backup?: V3SaveData | string | null;
  v3_0Backup?: V3_0SaveData | string | null;
  playtestLog?: string | null;
  v1Save?: V1SaveData | string | null;
  v1Backup?: V1SaveData | string | null;
  tabLock?: { tabId: string; updatedAt: number } | string | null;
  sessionMode?: 'v1' | 'v2' | null;
  skipTitleScreen?: boolean;
  clearAll?: boolean;
}

export interface BootOptions {
  seed?: number | string;
  mode?: 'v1' | 'v2';
  playtest?: boolean;
  enterStation?: boolean;
  path?: string;
  timeoutMs?: number;
}

export interface RootDomAttributes {
  screen: string | null;
  phase: string | null;
  act: string | null;
  sector: string | null;
}

export class StarlineAppDriver {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Reload-safe opaque-box storage seeding.
   * Uses a one-shot sessionStorage sentinel so subsequent `page.reload()` calls
   * do NOT overwrite localStorage mutations made by the game.
   */
  async seedStorage(options: SeedStorageOptions = {}): Promise<void> {
    const serializeOpt = (val: unknown): string | null | undefined => {
      if (val === undefined) return undefined;
      if (val === null) return null;
      return typeof val === 'string' ? val : JSON.stringify(val);
    };

    const payload = {
      clearAll: options.clearAll ?? true,
      v2Save: serializeOpt(options.v2Save),
      v2Backup: serializeOpt(options.v2Backup),
      v3Backup: serializeOpt(options.v3Backup),
      v3_0Backup: serializeOpt(options.v3_0Backup),
      playtestLog: serializeOpt(options.playtestLog),
      v1Save: serializeOpt(options.v1Save),
      v1Backup: serializeOpt(options.v1Backup),
      tabLock: serializeOpt(options.tabLock),
      sessionMode: options.sessionMode,
      skipTitleScreen: options.skipTitleScreen ?? false,
      keys: STORAGE_KEYS,
    };

    const applySeed = (arg: typeof payload) => {
      if (arg.clearAll) {
        window.localStorage.clear();
        window.sessionStorage.clear();
      }
      const setOrRemove = (key: string, val: string | null | undefined) => {
        if (val === undefined) return;
        if (val === null) {
          window.localStorage.removeItem(key);
        } else {
          window.localStorage.setItem(key, val);
        }
      };

      setOrRemove(arg.keys.V2_SAVE, arg.v2Save);
      setOrRemove(arg.keys.V2_BACKUP, arg.v2Backup);
      setOrRemove(arg.keys.V3_BACKUP, arg.v3Backup);
      setOrRemove(arg.keys.V3_0_BACKUP, arg.v3_0Backup);
      setOrRemove(arg.keys.PLAYTEST_LOG, arg.playtestLog);
      setOrRemove(arg.keys.V1_SAVE, arg.v1Save);
      setOrRemove(arg.keys.V1_BACKUP, arg.v1Backup);
      setOrRemove(arg.keys.V2_TAB_LOCK, arg.tabLock);

      if (arg.sessionMode === 'v1' || arg.sessionMode === 'v2') {
        window.sessionStorage.setItem(arg.keys.SESSION_ACTIVE_MODE, arg.sessionMode);
      } else if (arg.sessionMode === null) {
        window.sessionStorage.removeItem(arg.keys.SESSION_ACTIVE_MODE);
      }

      if (arg.skipTitleScreen) {
        window.sessionStorage.setItem(arg.keys.SESSION_V2_TITLE_ENTERED, '1');
      }

      window.sessionStorage.setItem(arg.keys.SESSION_E2E_SEEDED, '1');
    };

    if (/^https?:\/\//i.test(this.page.url())) {
      await this.page.evaluate(applySeed, payload);
      return;
    }

    await this.page.addInitScript((arg) => {
      const win = window as unknown as { __starlineE2eSeededThisNav?: boolean };
      const alreadySeeded = window.sessionStorage.getItem(arg.keys.SESSION_E2E_SEEDED) === '1';
      if (alreadySeeded && !win.__starlineE2eSeededThisNav) {
        return;
      }
      win.__starlineE2eSeededThisNav = true;
      if (arg.clearAll) {
        window.localStorage.clear();
        window.sessionStorage.clear();
      }
      const setOrRemove = (key: string, val: string | null | undefined) => {
        if (val === undefined) return;
        if (val === null) {
          window.localStorage.removeItem(key);
        } else {
          window.localStorage.setItem(key, val);
        }
      };

      setOrRemove(arg.keys.V2_SAVE, arg.v2Save);
      setOrRemove(arg.keys.V2_BACKUP, arg.v2Backup);
      setOrRemove(arg.keys.V3_BACKUP, arg.v3Backup);
      setOrRemove(arg.keys.V3_0_BACKUP, arg.v3_0Backup);
      setOrRemove(arg.keys.PLAYTEST_LOG, arg.playtestLog);
      setOrRemove(arg.keys.V1_SAVE, arg.v1Save);
      setOrRemove(arg.keys.V1_BACKUP, arg.v1Backup);
      setOrRemove(arg.keys.V2_TAB_LOCK, arg.tabLock);

      if (arg.sessionMode === 'v1' || arg.sessionMode === 'v2') {
        window.sessionStorage.setItem(arg.keys.SESSION_ACTIVE_MODE, arg.sessionMode);
      } else if (arg.sessionMode === null) {
        window.sessionStorage.removeItem(arg.keys.SESSION_ACTIVE_MODE);
      }

      if (arg.skipTitleScreen) {
        window.sessionStorage.setItem(arg.keys.SESSION_V2_TITLE_ENTERED, '1');
      }

      window.sessionStorage.setItem(arg.keys.SESSION_E2E_SEEDED, '1');
    }, payload);
  }

  /**
   * Navigates to the game with optional deterministic `?seed=`, `?mode=`, and `?playtest=1` query params.
   */
  async boot(options: BootOptions = {}): Promise<void> {
    const params = new URLSearchParams();
    if (options.mode) {
      params.set('mode', options.mode);
    }
    if (options.seed !== undefined) {
      params.set('seed', String(options.seed));
    }
    if (options.playtest) {
      params.set('playtest', '1');
    }
    const basePath = options.path ?? '/';
    const qs = params.toString();
    const url = qs ? `${basePath}?${qs}` : basePath;

    const bootTimeout = options.timeoutMs ?? 30_000;
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    await this.page
      .locator('#app .app-shell')
      .first()
      .waitFor({ state: 'attached', timeout: bootTimeout });

    if (options.mode !== 'v1') {
      await this.page.waitForFunction(
        () =>
          typeof (window as unknown as { __STARLINE_INSPECT__?: unknown }).__STARLINE_INSPECT__ ===
          'function',
        undefined,
        { timeout: bootTimeout },
      );
    }

    if (options.enterStation && options.mode !== 'v1') {
      const snap = await this.inspect();
      if (snap.screen === 'title') {
        await this.enterStation();
      }
    }
  }

  /**
   * Strictly read-only telemetry read via `window.__STARLINE_INSPECT__()`.
   */
  async inspect(): Promise<StarlineInspectSnapshot> {
    const snapshot = await this.page.evaluate(() => {
      const fn = (
        window as unknown as {
          __STARLINE_INSPECT__?: () => StarlineInspectSnapshot;
        }
      ).__STARLINE_INSPECT__;
      if (typeof fn !== 'function') {
        return null;
      }
      return fn();
    });
    if (!snapshot) {
      throw new Error('window.__STARLINE_INSPECT__() is not available on window.');
    }
    return snapshot;
  }

  async waitForInspect(
    predicate: (snapshot: StarlineInspectSnapshot) => boolean,
    timeoutMs = 15_000,
    description = 'inspect snapshot condition',
  ): Promise<StarlineInspectSnapshot> {
    let latest: StarlineInspectSnapshot | null = null;
    await expect
      .poll(
        async () => {
          const snapshot = await this.page.evaluate(() => {
            const fn = (
              window as unknown as {
                __STARLINE_INSPECT__?: () => StarlineInspectSnapshot;
              }
            ).__STARLINE_INSPECT__;
            return typeof fn === 'function' ? fn() : null;
          });
          if (!snapshot) return false;
          latest = snapshot;
          return predicate(latest);
        },
        { timeout: timeoutMs, message: `Timed out waiting for ${description}` },
      )
      .toBe(true);
    if (!latest) {
      throw new Error(`Snapshot unavailable after waiting for ${description}`);
    }
    return latest;
  }

  async readStorageRaw(key: string): Promise<string | null> {
    return this.page.evaluate((k) => window.localStorage.getItem(k), key);
  }

  async readStorageJson<T>(key: string): Promise<T | null> {
    const raw = await this.readStorageRaw(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  }

  async readSessionStorage(key: string): Promise<string | null> {
    return this.page.evaluate((k) => window.sessionStorage.getItem(k), key);
  }

  async getRootAttributes(): Promise<RootDomAttributes> {
    return this.page.locator('.app-shell.v2-shell').first().evaluate((el) => ({
      screen: el.getAttribute('data-screen'),
      phase: el.getAttribute('data-phase'),
      act: el.getAttribute('data-act'),
      sector: el.getAttribute('data-sector'),
    }));
  }

  byTestId(testId: string): Locator {
    return this.page.getByTestId(testId);
  }

  gridCell(cx: number, cy: number): Locator {
    return this.page.locator(`.cargo-cell[data-cx="${cx}"][data-cy="${cy}"]`).first();
  }

  powerCells(): Locator {
    return this.page.locator('.cargo-cell[data-power-cell="true"]');
  }

  disabledCells(): Locator {
    return this.page.locator('.cargo-cell[aria-disabled="true"], .cargo-cell.v2-cell-disabled');
  }

  async enterStation(): Promise<void> {
    const btn = this.byTestId(TEST_IDS.BTN_ENTER_STATION);
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(this.byTestId(TEST_IDS.BASE_SCREEN)).toBeVisible();
  }

  async openMoreModes(): Promise<Locator> {
    const btn = this.byTestId(TEST_IDS.BTN_MORE_MODES);
    await expect(btn).toBeVisible();
    await btn.click();
    const dialog = this.page.locator('.modal-card[role="dialog"], [role="dialog"]').first();
    await expect(dialog).toBeVisible();
    return dialog;
  }

  async openBaseModal(buttonTestId: string): Promise<Locator> {
    const btn = this.byTestId(buttonTestId);
    await expect(btn).toBeVisible();
    await btn.click();
    const dialog = this.page.locator('.modal-card[role="dialog"], [role="dialog"]').first();
    await expect(dialog).toBeVisible();
    return dialog;
  }

  async closeModal(): Promise<void> {
    const closeBtn = this.page
      .locator('.modal-close-btn, [role="dialog"] button[aria-label*="关"], [role="dialog"] button:has-text("关闭")')
      .first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
    } else {
      await this.page.keyboard.press('Escape');
    }
    await expect(this.page.locator('.modal-card[role="dialog"]')).toHaveCount(0);
  }

  async openPrepareFromBase(): Promise<void> {
    const recBtn = this.byTestId(TEST_IDS.BTN_START_RECOMMENDED);
    await expect(recBtn).toBeVisible();
    await recBtn.click();
    await expect(this.byTestId(TEST_IDS.PREPARE_SCREEN)).toBeVisible();
  }

  async selectSector(sectorId: SectorId): Promise<void> {
    const container = this.byTestId(TEST_IDS.SECTOR_SELECTOR);
    await expect(container).toBeVisible();
    const target = container
      .locator(
        `[data-prep-sector="${sectorId}"], [data-sector-id="${sectorId}"], [data-testid="sector-option-${sectorId}"], button[value="${sectorId}"]`,
      )
      .first();
    await expect(target).toBeVisible();
    await target.click();
  }

  async selectShip(shipId: V3ShipId): Promise<void> {
    const container = this.byTestId(TEST_IDS.SHIP_SELECTOR);
    await expect(container).toBeVisible();
    const target = container
      .locator(
        `[data-prep-ship="${shipId}"], [data-ship-id="${shipId}"], [data-testid="ship-option-${shipId}"], button[value="${shipId}"]`,
      )
      .first();
    await expect(target).toBeVisible();
    await target.click();
  }

  async selectCrew(crewId: V2CrewId): Promise<void> {
    const container = this.byTestId(TEST_IDS.CREW_SELECTOR);
    await expect(container).toBeVisible();
    const target = container
      .locator(
        `[data-prep-crew="${crewId}"], [data-crew-id="${crewId}"], [data-testid="crew-option-${crewId}"], button[value="${crewId}"]`,
      )
      .first();
    await expect(target).toBeVisible();
    await target.click();
  }

  async launchExpedition(): Promise<void> {
    const btn = this.byTestId(TEST_IDS.BTN_LAUNCH_EXPEDITION);
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    await btn.click();
    await expect(this.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();
  }

  async jumpToNode(nodeId: string): Promise<void> {
    // S04: Unified destination cards expose an inline 1-click `[data-jump-node="<id>"]` button;
    // MapView's click handler transitions phase synchronously before click() resolves.
    const directJumpBtn = this.page.locator(`[data-jump-node="${nodeId}"]`).first();
    await directJumpBtn.click();
  }

  async safeReturn(): Promise<void> {
    const btn = this.byTestId(TEST_IDS.BTN_SAFE_RETURN);
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    await btn.click();
    await expect(this.byTestId(TEST_IDS.SETTLEMENT_SCREEN)).toBeVisible();
  }

  async pauseAutoCombat(): Promise<void> {
    const btn = this.byTestId(TEST_IDS.BTN_PAUSE_AUTO_COMBAT);
    // Avoid redundant pre-click visibility/enabled CDP round-trips so S05's 1500ms
    // countdown cannot expire mid-pause under SwiftShader WebGL.
    const alreadyPaused = await btn.evaluate(
      (el) => el.getAttribute('aria-pressed') === 'true',
      undefined,
      { timeout: 30_000 },
    );
    if (!alreadyPaused) {
      await btn.click();
    }
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
  }

  async openForecastDetails(): Promise<Locator> {
    const drawer = this.byTestId(TEST_IDS.FORECAST_DETAILS_DRAWER);
    if (!(await drawer.isVisible())) {
      const toggleBtn = this.byTestId(TEST_IDS.BTN_TOGGLE_FORECAST_DETAILS);
      await expect(toggleBtn).toBeVisible();
      await toggleBtn.click();
    }
    await expect(drawer).toBeVisible();
    return drawer;
  }

  private static isPostCombatState(s: StarlineInspectSnapshot): boolean {
    return (
      s.screen === 'ending' ||
      (s.screen === 'run' && (s.phase === 'REWARD' || s.phase === 'SETTLEMENT'))
    );
  }

  private static isCombatEncounterState(s: StarlineInspectSnapshot): boolean {
    return (
      s.screen === 'run' &&
      s.phase === 'ENCOUNTER' &&
      s.activeRun !== null &&
      s.activeRun.wreckStability === null
    );
  }

  async startCombat(): Promise<void> {
    const hasCombatEngaged = (s: StarlineInspectSnapshot): boolean =>
      StarlineAppDriver.isPostCombatState(s) ||
      (StarlineAppDriver.isCombatEncounterState(s) &&
        (typeof s.activeRun?.combatRound === 'number' ||
          s.activeRun?.combatWaitingDecision === true));

    const initial = await this.inspect();
    if (
      !StarlineAppDriver.isPostCombatState(initial) &&
      !StarlineAppDriver.isCombatEncounterState(initial)
    ) {
      throw new Error(
        `startCombat() called outside combat encounter (screen=${initial.screen}, phase=${String(initial.phase)}, wreckStability=${String(initial.activeRun?.wreckStability ?? null)})`,
      );
    }
    if (hasCombatEngaged(initial)) {
      return;
    }

    const btn = this.byTestId(TEST_IDS.BTN_START_COMBAT);
    const pollBox: { state: 'pre' | 'engaged' | 'pending' } = { state: 'pending' };
    await expect
      .poll(
        async () => {
          const snap = await this.inspect();
          if (hasCombatEngaged(snap)) {
            pollBox.state = 'engaged';
            return true;
          }
          if (!StarlineAppDriver.isCombatEncounterState(snap)) {
            return false;
          }
          if ((await btn.isVisible()) && (await btn.isEnabled())) {
            pollBox.state = 'pre';
            return true;
          }
          return false;
        },
        { timeout: 15_000, message: 'Timed out waiting for pre-combat start button or S05 auto-engage' },
      )
      .toBe(true);

    if (pollBox.state === 'engaged') {
      return;
    }

    try {
      await btn.click({ timeout: 5_000 });
    } catch (err) {
      // S05 1.5s auto-engage may have fired and unmounted btn-start-combat mid-click
      const afterErr = await this.inspect();
      if (!hasCombatEngaged(afterErr)) {
        throw err;
      }
      return;
    }

    await this.waitForInspect(
      hasCombatEngaged,
      15_000,
      'combat engaged after clicking startCombat',
    );
  }

  async issueTacticalOrder(orderId: string): Promise<void> {
    const bar = this.byTestId(TEST_IDS.COMBAT_TACTICAL_BAR);
    await expect(bar).toBeVisible();
    const btn = this.byTestId(TEST_IDS.tacticalOrder(orderId));
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    await btn.click();
  }

  async overloadModule(instanceId: string): Promise<void> {
    const bar = this.byTestId(TEST_IDS.COMBAT_TACTICAL_BAR);
    await expect(bar).toBeVisible();
    const section = this.byTestId(TEST_IDS.COMBAT_OVERLOAD_SECTION);
    await expect(section).toBeVisible();
    const btn = this.byTestId(TEST_IDS.overloadModule(instanceId));
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    await btn.click();
  }

  async lockEnemy(enemyId: string): Promise<void> {
    const btn = this.byTestId(TEST_IDS.enemyLock(enemyId));
    await expect(btn).toBeVisible();
    if ((await btn.getAttribute('aria-pressed')) !== 'true') {
      await expect(btn).toBeEnabled();
      await btn.click();
    }
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
  }

  async skipCombat(): Promise<void> {
    const isCombatDoneOrPaused = (s: StarlineInspectSnapshot): boolean =>
      StarlineAppDriver.isPostCombatState(s) ||
      (StarlineAppDriver.isCombatEncounterState(s) && s.activeRun?.combatWaitingDecision === true);

    const initial = await this.inspect();
    if (
      !StarlineAppDriver.isPostCombatState(initial) &&
      !StarlineAppDriver.isCombatEncounterState(initial)
    ) {
      throw new Error(
        `skipCombat() called outside combat encounter (screen=${initial.screen}, phase=${String(initial.phase)}, wreckStability=${String(initial.activeRun?.wreckStability ?? null)})`,
      );
    }
    if (isCombatDoneOrPaused(initial)) {
      return;
    }

    const btn = this.byTestId(TEST_IDS.BTN_COMBAT_SKIP);
    const pollBox: { state: 'skip' | 'done' | 'pending' } = { state: 'pending' };
    await expect
      .poll(
        async () => {
          const snap = await this.inspect();
          if (isCombatDoneOrPaused(snap)) {
            pollBox.state = 'done';
            return true;
          }
          if (!StarlineAppDriver.isCombatEncounterState(snap)) {
            return false;
          }
          if ((await btn.isVisible()) && (await btn.isEnabled())) {
            pollBox.state = 'skip';
            return true;
          }
          return false;
        },
        { timeout: 15_000, message: 'Timed out waiting for combat skip button or combat completion' },
      )
      .toBe(true);

    if (pollBox.state === 'done') {
      return;
    }

    try {
      await btn.click({ timeout: 5_000 });
    } catch (err) {
      const afterErr = await this.inspect();
      if (!isCombatDoneOrPaused(afterErr)) {
        throw err;
      }
      return;
    }

    await this.waitForInspect(
      isCombatDoneOrPaused,
      15_000,
      'combat skipped to completion or tactical decision',
    );
  }

  async cutWreckSpot(
    spot: V2WreckSpotId | string,
    options?: { waitForCommit?: boolean },
  ): Promise<void> {
    const hotspotKey = spot.startsWith('reactor') ? 'reactor' : spot;
    const cutSelector =
      spot === 'reactor'
        ? `[data-testid="${TEST_IDS.wreckCut(spot)}"], [data-testid="wreck-cut-reactor_fuel"], [data-testid="wreck-cut-reactor_repair"]`
        : `[data-testid="${TEST_IDS.wreckCut(spot)}"]`;
    const btn = this.page.locator(cutSelector).first();

    // Only select a non-direct-cut left-panel card if needed (never click S08 direct-cut stage pins here)
    if (!(await btn.isVisible())) {
      const card = this.page.locator(`[data-wreck-card="${hotspotKey}"]`).first();
      if (await card.isVisible()) {
        await card.click();
      }
    }

    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    const beforeStability = (await this.inspect()).activeRun?.wreckStability ?? null;
    await btn.click();

    if (options?.waitForCommit !== false) {
      await expect
        .poll(
          async () =>
            this.page.evaluate(
              ({ sel, skipOverlayTid, skipPanelTid, extractTid, prevStability }) => {
                const inspectFn = (
                  window as unknown as { __STARLINE_INSPECT__?: () => StarlineInspectSnapshot }
                ).__STARLINE_INSPECT__;
                const snap = inspectFn ? inspectFn() : null;
                if (!snap) return false;
                // Ambush combat or phase exit completes the cut immediately
                if (
                  snap.screen !== 'run' ||
                  snap.phase !== 'ENCOUNTER' ||
                  snap.activeRun === null ||
                  snap.activeRun.wreckStability === null
                ) {
                  return true;
                }
                const isShown = (el: Element | null): boolean => {
                  if (!el) return false;
                  const rect = el.getBoundingClientRect();
                  return rect.width > 0 && rect.height > 0;
                };
                const skipOverlay = document.querySelector(`[data-testid="${skipOverlayTid}"]`);
                const skipPanel = document.querySelector(`[data-testid="${skipPanelTid}"]`);
                if (isShown(skipOverlay) || isShown(skipPanel)) {
                  return false;
                }
                const cutEl = document.querySelector(sel) as HTMLButtonElement | null;
                const extractEl = document.querySelector(
                  `[data-testid="${extractTid}"]`,
                ) as HTMLButtonElement | null;
                const stabilityChanged =
                  prevStability !== null && snap.activeRun.wreckStability !== prevStability;
                const cutDisabled = Boolean(cutEl && cutEl.disabled === true);
                const extractEnabled = Boolean(extractEl && extractEl.disabled === false);
                return extractEnabled && (stabilityChanged || cutDisabled);
              },
              {
                sel: cutSelector,
                skipOverlayTid: TEST_IDS.BTN_SKIP_WRECK_CUT,
                skipPanelTid: TEST_IDS.BTN_SKIP_WRECK_CUT_PANEL,
                extractTid: TEST_IDS.BTN_WRECK_EXTRACT,
                prevStability: beforeStability,
              },
            ),
          { timeout: 15_000, message: `Timed out waiting for S08 wreck cut commit on "${spot}"` },
        )
        .toBe(true);
    }
  }

  async extractWreck(): Promise<void> {
    const btn = this.byTestId(TEST_IDS.BTN_WRECK_EXTRACT);
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    await btn.click();
  }

  async chooseEventOption(index: number): Promise<void> {
    const btn = this.byTestId(TEST_IDS.eventChoice(index));
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    await btn.click();
  }

  async pickReward(choice?: V2RewardChoiceId): Promise<void> {
    const selectorByChoice: Record<V2RewardChoiceId, string> = {
      equipment_0: `button[data-pick-reward="equipment_0"], [data-testid="${TEST_IDS.rewardChoice(0)}"]`,
      equipment_1: `button[data-pick-reward="equipment_1"], [data-testid="${TEST_IDS.rewardChoice(1)}"]`,
      equipment_2: `button[data-pick-reward="equipment_2"], [data-testid="${TEST_IDS.rewardChoice(2)}"]`,
      skip: `[data-testid="${TEST_IDS.BTN_REWARD_SKIP}"], button[data-pick-reward="skip"]`,
      equipment: `button[data-pick-reward="equipment"], button[data-pick-reward="equipment_0"], [data-testid="${TEST_IDS.rewardChoice(0)}"]`,
      cargo: `button[data-pick-reward="cargo"], [data-testid="reward-choice-cargo"]`,
      repair: `button[data-pick-reward="repair"], [data-testid="reward-choice-repair"]`,
    };
    const selector = choice
      ? selectorByChoice[choice]
      : 'button[data-pick-reward], .v2-reward-card, button[data-reward-choice], [data-testid^="reward-choice-"]';
    const btn = this.page.locator(selector).first();
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    await btn.click();
  }

  async leaveArrange(options?: { confirmDiscards?: boolean }): Promise<void> {
    const btn = this.byTestId(TEST_IDS.BTN_LEAVE_ARRANGE);
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    await btn.click();

    if (options?.confirmDiscards ?? true) {
      const discardOk = this.page.locator('#v2-discard-ok').first();
      if (await discardOk.isVisible()) {
        await discardOk.click();
      }
    }
  }

  async confirmSettlement(): Promise<void> {
    const btn = this.byTestId(TEST_IDS.BTN_CONFIRM_SETTLEMENT);
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    await btn.click();
    await expect(this.byTestId(TEST_IDS.BASE_SCREEN)).toBeVisible();
  }

  async selectEnding(endingId: EndingId): Promise<void> {
    const btn = this.byTestId(TEST_IDS.endingChoice(endingId));
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    await btn.click();
  }

  async continueFromEnding(): Promise<void> {
    const btn = this.byTestId(TEST_IDS.BTN_ENDING_CONTINUE);
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    await btn.click();
  }
}

export function createAppDriver(page: Page): StarlineAppDriver {
  return new StarlineAppDriver(page);
}
