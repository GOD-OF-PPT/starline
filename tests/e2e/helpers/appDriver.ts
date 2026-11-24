import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { STORAGE_KEYS, TEST_IDS } from './contracts';
import type {
  EndingId,
  SectorId,
  StarlineInspectSnapshot,
  V1SaveData,
  V2CrewId,
  V2SaveData,
  V3SaveData,
  V3ShipId,
} from './contracts';

export interface SeedStorageOptions {
  v2Save?: V2SaveData | V3SaveData | string | null;
  v2Backup?: V2SaveData | V3SaveData | string | null;
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
    const payload = {
      clearAll: options.clearAll ?? true,
      v2Save:
        options.v2Save === undefined
          ? undefined
          : options.v2Save === null
            ? null
            : typeof options.v2Save === 'string'
              ? options.v2Save
              : JSON.stringify(options.v2Save),
      v2Backup:
        options.v2Backup === undefined
          ? undefined
          : options.v2Backup === null
            ? null
            : typeof options.v2Backup === 'string'
              ? options.v2Backup
              : JSON.stringify(options.v2Backup),
      v1Save:
        options.v1Save === undefined
          ? undefined
          : options.v1Save === null
            ? null
            : typeof options.v1Save === 'string'
              ? options.v1Save
              : JSON.stringify(options.v1Save),
      v1Backup:
        options.v1Backup === undefined
          ? undefined
          : options.v1Backup === null
            ? null
            : typeof options.v1Backup === 'string'
              ? options.v1Backup
              : JSON.stringify(options.v1Backup),
      tabLock:
        options.tabLock === undefined
          ? undefined
          : options.tabLock === null
            ? null
            : typeof options.tabLock === 'string'
              ? options.tabLock
              : JSON.stringify(options.tabLock),
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
   * Navigates to the game with optional deterministic `?seed=` and `?mode=` query params.
   */
  async boot(options: BootOptions = {}): Promise<void> {
    const params = new URLSearchParams();
    if (options.mode) {
      params.set('mode', options.mode);
    }
    if (options.seed !== undefined) {
      params.set('seed', String(options.seed));
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
    const node = this.byTestId(TEST_IDS.mapNode(nodeId));
    await expect(node).toBeVisible();
    await node.click();
    const jumpBtn = this.byTestId(TEST_IDS.BTN_JUMP_NODE);
    await expect(jumpBtn).toBeVisible();
    await expect(jumpBtn).toBeEnabled();
    await jumpBtn.click();
  }

  async safeReturn(): Promise<void> {
    const btn = this.byTestId(TEST_IDS.BTN_SAFE_RETURN);
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    await btn.click();
    await expect(this.byTestId(TEST_IDS.SETTLEMENT_SCREEN)).toBeVisible();
  }

  async startCombat(): Promise<void> {
    const btn = this.byTestId(TEST_IDS.BTN_START_COMBAT);
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    await btn.click();
  }

  async issueTacticalOrder(orderId: string): Promise<void> {
    const bar = this.byTestId(TEST_IDS.COMBAT_TACTICAL_BAR);
    await expect(bar).toBeVisible();
    const btn = this.byTestId(TEST_IDS.tacticalOrder(orderId));
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    await btn.click();
  }

  async skipCombat(): Promise<void> {
    const btn = this.byTestId(TEST_IDS.BTN_COMBAT_SKIP);
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    await btn.click();
  }

  async cutWreckSpot(spot: string): Promise<void> {
    const hotspotKey = spot.startsWith('reactor') ? 'reactor' : spot;
    const cutSelector =
      spot === 'reactor'
        ? `[data-testid="${TEST_IDS.wreckCut(spot)}"], [data-testid="wreck-cut-reactor_fuel"], [data-testid="wreck-cut-reactor_repair"]`
        : `[data-testid="${TEST_IDS.wreckCut(spot)}"]`;
    const btn = this.page.locator(cutSelector).first();

    if (!(await btn.isVisible())) {
      const spotTab = this.page
        .locator(`[data-testid="wreck-spot-${hotspotKey}"], [data-wreck-spot="${hotspotKey}"]`)
        .first();
      if (await spotTab.isVisible()) {
        await spotTab.click();
      }
    }

    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    await btn.click();
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

  async pickReward(choice?: 'equipment' | 'cargo' | 'repair'): Promise<void> {
    const selector = choice
      ? `button[data-pick-reward="${choice}"], [data-testid="reward-choice-${choice}"]`
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
