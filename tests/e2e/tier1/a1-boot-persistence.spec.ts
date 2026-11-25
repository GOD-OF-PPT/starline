import { expect, test } from '@playwright/test';
import {
  STORAGE_KEYS,
  TEST_IDS,
  V3_0_RULES_VERSION,
  V3_RULES_VERSION,
  V3_SCHEMA_VERSION,
  assertRootSyncedWithInspect,
  attachZeroErrorMonitors,
  createAppDriver,
  createV3_0SaveFixture,
  presetPostTutorialV3,
} from '../helpers';
import type { V3_0SaveData, V3SaveData } from '../helpers';

test.describe('Tier 1 · A1: Boot, Persistence & Mode Coexistence', () => {
  test('T1-A1-01 @p0-core Fresh boot renders de-demo Title Screen with secondary modes tucked into drawer', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({ clearAll: true });
    await app.boot({ seed: 1001 });

    const titleScreen = app.byTestId(TEST_IDS.TITLE_SCREEN);
    await expect(titleScreen).toBeVisible();

    const snap = await app.inspect();
    expect(snap.mode).toBe('v2');
    expect(snap.schemaVersion).toBe(V3_SCHEMA_VERSION);
    expect(snap.screen).toBe('title');

    await assertRootSyncedWithInspect(page, snap);

    const enterBtn = app.byTestId(TEST_IDS.BTN_ENTER_STATION);
    const moreModesBtn = app.byTestId(TEST_IDS.BTN_MORE_MODES);
    await expect(enterBtn).toBeVisible();
    await expect(moreModesBtn).toBeVisible();

    // Demo/classic entries must NOT compete as primary visible hero buttons before opening the drawer
    await expect(titleScreen.getByRole('button', { name: /4\s*站精华试玩/ })).toBeHidden();
    await expect(titleScreen.getByRole('button', { name: /经典模式/ })).toBeHidden();

    monitor.assertClean(snap);
  });

  test('T1-A1-02 @p0-core Enter Station transitions to BaseScene in Prologue with fresh V3 state', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({ clearAll: true });
    await app.boot({ seed: 1002 });
    await app.enterStation();

    await expect(app.byTestId(TEST_IDS.BASE_SCREEN)).toBeVisible();

    const snap = await app.waitForInspect(
      (s) => s.screen === 'base' && s.phaserScene === 'BaseScene',
      15_000,
      'BaseScene ready on base screen',
    );

    expect(snap.campaignAct).toBe('prologue');
    expect(snap.bgmTrack).toBe('base');
    expect(snap.credits).toBe(0);
    expect(snap.salvageParts).toBe(0);
    expect(snap.unlockedSectors).toContain('near_orbit');
    expect(snap.activeRun).toBeNull();

    await assertRootSyncedWithInspect(page, snap);
    monitor.assertClean(snap);
  });

  test('T1-A1-03 @p0-core Deterministic ?seed= forwards identical seed and 6-layer map DAG across isolated contexts', async ({
    browser,
  }) => {
    const launchAndCollectMap = async () => {
      const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      const page = await context.newPage();
      const monitor = attachZeroErrorMonitors(page);
      const app = createAppDriver(page);

      try {
        await app.seedStorage({
          v2Save: presetPostTutorialV3(),
          skipTitleScreen: true,
        });
        await app.boot({ seed: 424242, enterStation: true });
        await app.openPrepareFromBase();
        await app.launchExpedition();

        const snap = await app.waitForInspect(
          (s) => s.screen === 'run' && s.phase === 'MAP' && s.activeRun !== null,
          15_000,
          'expedition map loaded',
        );

        const nodes = await page.locator('[data-testid^="map-node-"]').evaluateAll((els) =>
          els.map((el) => ({
            testId: el.getAttribute('data-testid'),
            text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
          })),
        );

        expect(nodes.length).toBeGreaterThanOrEqual(6);
        monitor.assertClean(snap);

        return {
          seed: snap.activeRun?.seed ?? null,
          nodes,
        };
      } finally {
        await context.close();
      }
    };

    const first = await launchAndCollectMap();
    const second = await launchAndCollectMap();

    expect(first.seed).toBe(424242);
    expect(second.seed).toBe(first.seed);
    expect(second.nodes).toEqual(first.nodes);
  });

  test('T1-A1-04 @p0-core Secondary mode drawer exposes Showcase & Classic V1 and isolates Showcase from main save', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);
    const seededSave = presetPostTutorialV3({ credits: 145, totalRuns: 3 });

    await app.seedStorage({ v2Save: seededSave, skipTitleScreen: false });
    await app.boot({ seed: 1004 });

    const drawer = await app.openMoreModes();

    const showcaseEntry = drawer
      .locator('[data-testid="btn-mode-showcase"], #v3-btn-mode-showcase')
      .or(drawer.getByRole('button', { name: /4\s*站精华试玩|选择试航构筑/ }))
      .first();
    const classicEntry = drawer
      .locator('[data-testid="btn-mode-v1"], #v3-btn-mode-v1')
      .or(drawer.getByRole('button', { name: /经典模式/ }))
      .first();
    await expect(showcaseEntry).toBeVisible();
    await expect(classicEntry).toBeVisible();

    await showcaseEntry.click();

    // If a trial build picker appears, pick the first available trial kit
    const trialPicker = page
      .locator('[data-showcase-trial], [data-testid^="showcase-trial-"]')
      .first();
    await expect(trialPicker.or(app.byTestId(TEST_IDS.MAP_SCREEN))).toBeVisible();
    if (await trialPicker.isVisible()) {
      await trialPicker.click();
    }

    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();

    const savedAfter = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(savedAfter).not.toBeNull();
    expect(savedAfter?.profile.credits).toBe(145);
    expect(savedAfter?.profile.totalRuns).toBe(3);
    expect(savedAfter?.activeRun).toBeNull();

    const snap = await app.inspect();
    monitor.assertClean(snap);
  });

  test('T1-A1-05 @p0-core Read-only __STARLINE_INSPECT__ telemetry stays synced with root DOM attributes across screens', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({ v2Save: presetPostTutorialV3(), skipTitleScreen: false });
    await app.boot({ seed: 1005 });

    // Title
    const titleSnap = await app.inspect();
    expect(titleSnap.screen).toBe('title');
    await assertRootSyncedWithInspect(page, titleSnap);

    // Ensure inspect object has zero mutator functions exposed
    const mutatorMethods = await page.evaluate(() => {
      const snap = (
        window as unknown as { __STARLINE_INSPECT__: () => Record<string, unknown> }
      ).__STARLINE_INSPECT__();
      return Object.entries(snap)
        .filter(([, value]) => typeof value === 'function')
        .map(([key]) => key);
    });
    expect(mutatorMethods).toEqual([]);

    // Base
    await app.enterStation();
    const baseSnap = await app.inspect();
    expect(baseSnap.screen).toBe('base');
    await assertRootSyncedWithInspect(page, baseSnap);

    // Prepare
    await app.openPrepareFromBase();
    const prepareSnap = await app.inspect();
    expect(prepareSnap.screen).toBe('prepare');
    await assertRootSyncedWithInspect(page, prepareSnap);

    // Map
    await app.launchExpedition();
    const mapSnap = await app.inspect();
    expect(mapSnap.screen).toBe('run');
    expect(mapSnap.phase).toBe('MAP');
    await assertRootSyncedWithInspect(page, mapSnap);

    monitor.assertClean(mapSnap);
  });

  test('T1-A1-06 @p0-core Rules 3.0.0 save migrates non-destructively to 3.1.0 with write-once backup, combat rewind, beacon backfill, and reload idempotency', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const legacyV3_0 = createV3_0SaveFixture({
      withInFlightCombat: true,
      runStartingHp: 28,
      runCurrentHp: 21,
    });
    expect(legacyV3_0.rulesVersion).toBe(V3_0_RULES_VERSION);
    expect(legacyV3_0.activeRun?.activeCombat).not.toBeNull();
    expect(legacyV3_0.activeRun?.graph.nodes.L3A.isBeacon).toBeUndefined();

    // Active run skips Title Screen and immediately resumes the rewound L1B encounter
    await app.seedStorage({ v2Save: legacyV3_0, skipTitleScreen: true });
    await app.boot({ seed: 1006 });

    await expect(app.byTestId(TEST_IDS.COMBAT_SCREEN)).toBeVisible();
    // Contract #9 + S05: Migration boot pauses auto-engage so rewound pre-combat state is never auto-mutated
    await expect(app.byTestId(TEST_IDS.BTN_PAUSE_AUTO_COMBAT)).toHaveAttribute('aria-pressed', 'true');

    const migrated = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(migrated).not.toBeNull();
    expect(migrated?.schemaVersion).toBe(V3_SCHEMA_VERSION);
    expect(migrated?.rulesVersion).toBe(V3_RULES_VERSION);
    expect(migrated?.profile.credits).toBe(185);
    expect(migrated?.profile.salvageParts).toBe(35);

    // In-flight 3.0.0 activeCombat rewound safely back to pre-combat L1B with startingHp restored & legacy claim stripped
    expect(migrated?.activeRun).not.toBeNull();
    expect(migrated?.activeRun?.rulesVersion).toBe(V3_RULES_VERSION);
    expect(migrated?.activeRun?.phase).toBe('ENCOUNTER');
    expect(migrated?.activeRun?.currentNodeId).toBe('L1B');
    expect(migrated?.activeRun?.activeCombat).toBeNull();
    expect(migrated?.activeRun?.hp).toBe(28);
    expect(migrated?.activeRun?.wallet).toBe(33);
    expect(migrated?.activeRun?.fuel).toBe(7);
    expect(migrated?.activeRun?.tacticalChargesUsed).toBe(0);
    expect(migrated?.activeRun?.claimedEventIds).not.toContain('tactic_commit_tactic_run_v3_0_mig_1_L1B_1');

    // Legacy 6-layer graph backfilled with L3A & L5A Recovery Beacons
    expect(migrated?.activeRun?.graph.nodes.L3A.isBeacon).toBe(true);
    expect(migrated?.activeRun?.graph.nodes.L5A.isBeacon).toBe(true);
    expect(migrated?.activeRun?.graph.nodes.L1A.isBeacon).toBe(false);

    // Write-once 3.0.0 backup preserved verbatim
    const backupRawBeforeReload = await app.readStorageRaw(STORAGE_KEYS.V3_0_BACKUP);
    expect(backupRawBeforeReload).not.toBeNull();
    const backupParsed = JSON.parse(backupRawBeforeReload!) as V3_0SaveData;
    expect(backupParsed.rulesVersion).toBe(V3_0_RULES_VERSION);
    expect(backupParsed.activeRun?.activeCombat?.simulation?.resultId).toBe('sim_v3_0_legacy_1');

    // Reload idempotency: pause S05 immediately on reloaded 3.1.0 pre-combat and confirm write-once backup + activeCombat === null survive intact
    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.pauseAutoCombat();
    await expect(app.byTestId(TEST_IDS.COMBAT_SCREEN)).toBeVisible();

    const backupRawAfterReload = await app.readStorageRaw(STORAGE_KEYS.V3_0_BACKUP);
    expect(backupRawAfterReload).toBe(backupRawBeforeReload);
    const afterReload = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(afterReload?.rulesVersion).toBe(V3_RULES_VERSION);
    expect(afterReload?.activeRun?.hp).toBe(28);
    expect(afterReload?.activeRun?.activeCombat).toBeNull();

    const snap = await app.inspect();
    expect(snap.activeRun?.hp).toBe(28);
    expect(snap.activeRun?.combatRound).toBeNull();

    monitor.assertClean(snap);
  });

  test('T1-A1-07 @p0-core T01 opt-in ?playtest=1 telemetry writes structured log & exposes Settings export/clear while default mode writes zero bytes', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Part A: Default boot (no ?playtest=1) MUST perform strictly zero writes & hide telemetry UI
    await app.seedStorage({ v2Save: presetPostTutorialV3(), skipTitleScreen: true });
    await app.boot({ seed: 1007, enterStation: true });
    await expect(app.byTestId(TEST_IDS.BASE_SCREEN)).toBeVisible();

    expect(await app.readStorageRaw(STORAGE_KEYS.PLAYTEST_LOG)).toBeNull();

    const settingsBtn = page.getByRole('button', { name: /设置/ }).first();
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();
    await expect(page.locator('[role="dialog"]').first()).toBeVisible();
    await expect(app.byTestId(TEST_IDS.PLAYTEST_TELEMETRY_ROW)).toHaveCount(0);
    await app.closeModal();

    expect(await app.readStorageRaw(STORAGE_KEYS.PLAYTEST_LOG)).toBeNull();

    // Part B: Opt-in ?playtest=1 records phase/click events and enables export + clear in Settings
    await app.seedStorage({ v2Save: presetPostTutorialV3(), skipTitleScreen: true });
    await app.boot({ seed: 1008, playtest: true, enterStation: true });
    await expect(app.byTestId(TEST_IDS.BASE_SCREEN)).toBeVisible();

    await app.openPrepareFromBase();
    await expect(app.byTestId(TEST_IDS.PREPARE_SCREEN)).toBeVisible();

    const logData = await app.readStorageJson<{
      schemaVersion: number;
      events: Array<{ type: string }>;
    }>(STORAGE_KEYS.PLAYTEST_LOG);
    expect(logData).not.toBeNull();
    expect(logData?.schemaVersion).toBe(1);
    expect(logData?.events.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(logData?.events.some((ev) => ev.type === 'phase_enter')).toBe(true);
    expect(logData?.events.some((ev) => ev.type === 'click')).toBe(true);

    await settingsBtn.click();
    await expect(app.byTestId(TEST_IDS.PLAYTEST_TELEMETRY_ROW)).toBeVisible();
    const exportBtn = app.byTestId(TEST_IDS.BTN_EXPORT_PLAYTEST_LOG);
    const clearBtn = app.byTestId(TEST_IDS.BTN_CLEAR_PLAYTEST_LOG);
    await expect(exportBtn).toBeVisible();
    await expect(clearBtn).toBeVisible();

    await exportBtn.click();
    await clearBtn.click();

    await expect
      .poll(async () => app.readStorageRaw(STORAGE_KEYS.PLAYTEST_LOG), {
        timeout: 5_000,
        message: 'Clearing playtest telemetry must remove starline_playtest_log from localStorage',
      })
      .toBeNull();

    await app.closeModal();
    monitor.assertClean(await app.inspect());
  });
});
