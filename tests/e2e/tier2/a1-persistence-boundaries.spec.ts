import { expect, test } from '@playwright/test';
import {
  STORAGE_KEYS,
  TEST_IDS,
  V2_RULES_VERSION,
  V2_SCHEMA_VERSION,
  V3_0_RULES_VERSION,
  V3_RULES_VERSION,
  V3_SCHEMA_VERSION,
  assertNoDevJargon,
  attachZeroErrorMonitors,
  createAppDriver,
  createCargoBay,
  createCargoItem,
  createDefaultRelics,
  createV2SaveFixture,
  createV3_0SaveFixture,
  createV3RunFixture,
  createV3SaveFixture,
  presetAct1V3,
  presetMidRunMapV3,
  presetPostTutorialV3,
} from '../helpers';
import type { V2SaveData, V3_0SaveData, V3SaveData } from '../helpers';

test.describe('Tier 2 · A1: Persistence, Migration, Corruption & Concurrency Boundaries', () => {
  test('T2-A1-01 @p0-core V2 to V3 automatic migration preserves all progress, creates V2 backup, and is reload-idempotent', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const v2Fixture = createV2SaveFixture({
      profile: {
        credits: 340,
        buildings: {
          workbench: true,
          contract_hub: true,
          drydock: true,
          research_lab: true,
          display: true,
          drydock_tier2: false,
        },
        unlockedShips: ['cannon_skiff', 'shield_cruiser'],
        unlockedCrew: ['engineer', 'salvager'],
        completedContractTypes: ['transport', 'survey'],
        completedContractIds: ['transport_std', 'survey_std'],
        deepestLayerReached: 4,
        totalRuns: 4,
        tutorialCompleted: true,
        tutorialBonusClaimed: true,
        relics: createDefaultRelics({
          ancient_navigator: { storedCount: 1, restored: true },
        }),
        equipmentWarehouse: [
          createCargoItem({
            instanceId: 'v2_mig_laser_1',
            definitionId: 'equipment.laser.improved',
            origin: 'owned',
          }),
          createCargoItem({
            instanceId: 'v2_mig_shield_1',
            definitionId: 'equipment.shield.common',
            origin: 'owned',
          }),
        ],
        loadoutPresets: [
          {
            presetId: 'preset_v2_legacy',
            name: 'V2标准炮艇',
            shipId: 'cannon_skiff',
            crewId: 'engineer',
            primaryArchetype: 'laser',
            updatedAt: '2026-11-22T00:00:00.000Z',
            slots: [
              {
                definitionId: 'equipment.laser.common',
                quality: 'common',
                preferOrigin: 'loan',
                x: 0,
                y: 0,
                rotation: 0,
              },
            ],
          },
        ],
      },
    });

    await app.seedStorage({
      v2Save: v2Fixture,
      v2Backup: null,
      skipTitleScreen: true,
    });
    await app.boot({ seed: 21001, enterStation: true });

    const snap = await app.waitForInspect(
      (s) => s.screen === 'base' && s.schemaVersion === V3_SCHEMA_VERSION,
      15_000,
      'V2->V3 migration complete',
    );

    expect(snap.schemaVersion).toBe(V3_SCHEMA_VERSION);
    expect(snap.credits).toBe(340);
    expect(snap.campaignAct).not.toBe('prologue');

    const migrated = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(migrated).not.toBeNull();
    expect(migrated?.schemaVersion).toBe(V3_SCHEMA_VERSION);
    expect(migrated?.rulesVersion).toBe(V3_RULES_VERSION);
    expect(migrated?.profile.credits).toBe(340);
    expect(migrated?.profile.buildings.drydock).toBe(true);
    expect(migrated?.profile.buildings.research_lab).toBe(true);
    expect(migrated?.profile.unlockedShips).toEqual(
      expect.arrayContaining(['cannon_skiff', 'shield_cruiser']),
    );
    expect(migrated?.profile.unlockedCrew).toEqual(
      expect.arrayContaining(['engineer', 'salvager']),
    );
    expect(migrated?.profile.relics.ancient_navigator.restored).toBe(true);
    expect(migrated?.profile.equipmentWarehouse.map((i) => i.instanceId)).toEqual([
      'v2_mig_laser_1',
      'v2_mig_shield_1',
    ]);
    expect(migrated?.profile.loadoutPresets.map((p) => p.presetId)).toContain('preset_v2_legacy');
    expect(migrated?.profile.campaign).toBeDefined();
    expect(migrated?.profile.facilityTiers).toBeDefined();
    expect(migrated?.profile.career).toBeDefined();

    // Non-destructive backup created with original schemaVersion: 2 JSON
    const backupRawBeforeReload = await app.readStorageRaw(STORAGE_KEYS.V2_BACKUP);
    expect(backupRawBeforeReload).not.toBeNull();
    const backupParsed = JSON.parse(backupRawBeforeReload ?? '{}') as V2SaveData;
    expect(backupParsed.schemaVersion).toBe(V2_SCHEMA_VERSION);
    expect(backupParsed.rulesVersion).toBe(V2_RULES_VERSION);
    expect(backupParsed.profile.credits).toBe(340);

    // Reload idempotency: must NOT overwrite V2 backup or duplicate warehouse/preset entries
    await page.reload({ waitUntil: 'domcontentloaded' });
    const snapAfterReload = await app.waitForInspect(
      (s) => s.screen === 'base' && s.schemaVersion === V3_SCHEMA_VERSION,
      30_000,
      'post-reload migrated save',
    );
    expect(snapAfterReload.credits).toBe(340);

    const backupRawAfterReload = await app.readStorageRaw(STORAGE_KEYS.V2_BACKUP);
    expect(backupRawAfterReload).toBe(backupRawBeforeReload);

    const migratedAfterReload = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(migratedAfterReload?.profile.equipmentWarehouse).toHaveLength(2);
    expect(migratedAfterReload?.profile.loadoutPresets).toHaveLength(1);

    monitor.assertClean(snapAfterReload);
  });

  test('T2-A1-02 @p0-core Corrupt primary save with valid backup surfaces recovery modal and restores intact V3 profile', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const intactBackup = presetAct1V3({
      credits: 410,
      salvageParts: 55,
      totalRuns: 5,
    });

    await app.seedStorage({
      v2Save: '{corrupt-json-primary',
      v2Backup: intactBackup,
      skipTitleScreen: false,
    });
    await app.boot({ seed: 21002 });

    const recoveryDialog = page.locator('.modal-card[role="dialog"], [role="dialog"]').first();
    await expect(recoveryDialog).toBeVisible();
    await expect(recoveryDialog).toContainText(/存档异常|备份|损坏/);

    const restoreBackupBtn = recoveryDialog
      .locator('#v2-rec-backup, [data-testid="btn-recover-backup"]')
      .or(recoveryDialog.getByRole('button', { name: /恢复.*备份/ }))
      .first();
    await expect(restoreBackupBtn).toBeVisible();
    await expect(restoreBackupBtn).toBeEnabled();
    await restoreBackupBtn.click();

    const snap = await app.waitForInspect(
      (s) => !s.modalOpen && s.credits === 410,
      15_000,
      'backup restored cleanly',
    );
    expect(snap.schemaVersion).toBe(V3_SCHEMA_VERSION);
    expect(snap.credits).toBe(410);
    expect(snap.salvageParts).toBe(55);

    const restoredSave = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(restoredSave?.schemaVersion).toBe(V3_SCHEMA_VERSION);
    expect(restoredSave?.profile.credits).toBe(410);
    expect(restoredSave?.profile.totalRuns).toBe(5);

    monitor.assertClean(snap);
  });

  test('T2-A1-03 @p0-core Corrupt save without backup rejects truncated JSON, negative resources, and overlapping/unknown bay items cleanly', async ({
    page,
  }) => {
    test.slow();
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Sub-case (b): schema violation with negative credits and negative fuel (mutated post-build to test live validator)
    const negativeResourceSave = createV3SaveFixture({
      profile: { credits: 0 },
      activeRun: createV3RunFixture({ fuel: 3 }),
    });
    negativeResourceSave.profile.credits = -50;
    if (negativeResourceSave.activeRun) {
      negativeResourceSave.activeRun.fuel = -2;
    }

    // Sub-case (c): overlapping bay.placed coordinates & unknown definitionId (skipValidation: true, assigned post-build)
    const overlappingBay = createCargoBay({
      shipId: 'cannon_skiff',
      skipValidation: true,
      placed: [
        {
          item: createCargoItem({
            instanceId: 'corrupt_overlap_1',
            definitionId: 'equipment.laser.common',
            origin: 'loan',
            skipValidation: true,
          }),
          x: 0,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'corrupt_overlap_2',
            definitionId: 'equipment.ghost_unknown.common',
            origin: 'loot',
            fixedValue: 10,
            skipValidation: true,
          }),
          x: 0,
          y: 0,
        },
      ],
    });
    const badBaySave = createV3SaveFixture({
      activeRun: createV3RunFixture(),
    });
    if (badBaySave.activeRun) {
      badBaySave.activeRun.bay = overlappingBay;
    }

    const corruptPayloads: { label: string; raw: string }[] = [
      { label: 'truncated-json', raw: '{"schemaVersion":3,"profile":{"credits":' },
      { label: 'negative-credits-and-fuel', raw: JSON.stringify(negativeResourceSave) },
      { label: 'overlapping-bay-and-unknown-defId', raw: JSON.stringify(badBaySave) },
    ];

    for (const payload of corruptPayloads) {
      await app.seedStorage({
        v2Save: payload.raw,
        v2Backup: null,
        skipTitleScreen: false,
      });
      await app.boot({ seed: 21003 });

      const recoveryDialog = page.locator('.modal-card[role="dialog"], [role="dialog"]').first();
      await expect(
        recoveryDialog,
        `Recovery modal must appear for ${payload.label}`,
      ).toBeVisible();

      const restoreBackupBtn = recoveryDialog
        .locator('#v2-rec-backup, [data-testid="btn-recover-backup"]')
        .or(recoveryDialog.getByRole('button', { name: /恢复.*备份/ }));
      await expect(
        restoreBackupBtn,
        `Backup restore button must NOT appear without backup (${payload.label})`,
      ).toHaveCount(0);

      const resetFreshBtn = recoveryDialog
        .locator('#v2-rec-fresh, [data-testid="btn-recover-fresh"]')
        .or(recoveryDialog.getByRole('button', { name: /新建进度|重置/ }))
        .first();
      await expect(resetFreshBtn).toBeVisible();
      await resetFreshBtn.click();

      const snap = await app.waitForInspect(
        (s) => !s.modalOpen && s.schemaVersion === V3_SCHEMA_VERSION,
        15_000,
        `fresh reset after ${payload.label}`,
      );
      expect(snap.credits).toBe(0);
      expect(snap.activeRun).toBeNull();

      const cleanedSave = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
      expect(cleanedSave?.schemaVersion).toBe(V3_SCHEMA_VERSION);
      expect(cleanedSave?.profile.credits).toBe(0);
      expect(cleanedSave?.activeRun).toBeNull();
    }

    monitor.assertClean(await app.inspect());
  });

  test('T2-A1-04 @p0-core Multi-tab write lock enforces read-only mode on second tab and transfers ownership cleanly on takeover', async ({
    browser,
  }) => {
    test.slow();
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const pageA = await context.newPage();
    const monitorA = attachZeroErrorMonitors(pageA);
    const appA = createAppDriver(pageA);

    try {
      await appA.seedStorage({
        v2Save: presetAct1V3({ credits: 260 }),
        skipTitleScreen: true,
      });
      await appA.boot({ seed: 21004, enterStation: true });
      await expect(appA.byTestId(TEST_IDS.BASE_SCREEN)).toBeVisible();

      const lockOwnedByA = await appA.readStorageJson<{ tabId: string; updatedAt: number }>(
        STORAGE_KEYS.V2_TAB_LOCK,
      );
      expect(lockOwnedByA?.tabId).toBeTruthy();

      const readOnlyBannerA = pageA
        .locator('.system-banner.banner-warn[role="alert"], [data-testid="readonly-banner"]')
        .filter({ hasText: /只读/ });
      await expect(readOnlyBannerA).toHaveCount(0);

      // Open Tab B in same BrowserContext (shared localStorage + BroadcastChannel, distinct sessionStorage)
      const pageB = await context.newPage();
      const monitorB = attachZeroErrorMonitors(pageB);
      const appB = createAppDriver(pageB);

      await appB.boot({ seed: 21004, enterStation: true });

      const readOnlyBannerB = pageB
        .locator('.system-banner.banner-warn[role="alert"], [data-testid="readonly-banner"]')
        .filter({ hasText: /只读/ })
        .first();
      await expect(readOnlyBannerB).toBeVisible();

      const takeoverBtnB = pageB
        .locator('#v2-btn-takeover, [data-testid="btn-takeover-tab"]')
        .or(pageB.getByRole('button', { name: /切换至此窗口|接管/ }))
        .first();
      await expect(takeoverBtnB).toBeVisible();

      // While read-only, lock must still belong to Tab A
      const lockBeforeTakeover = await appB.readStorageJson<{ tabId: string; updatedAt: number }>(
        STORAGE_KEYS.V2_TAB_LOCK,
      );
      expect(lockBeforeTakeover?.tabId).toBe(lockOwnedByA?.tabId);

      // Click takeover on Tab B
      await takeoverBtnB.click();

      await expect(readOnlyBannerB).toHaveCount(0);

      const lockAfterTakeover = await appB.readStorageJson<{ tabId: string; updatedAt: number }>(
        STORAGE_KEYS.V2_TAB_LOCK,
      );
      expect(lockAfterTakeover?.tabId).toBeTruthy();
      expect(lockAfterTakeover?.tabId).not.toBe(lockOwnedByA?.tabId);

      // Tab A must flip to read-only upon losing lock
      await expect(readOnlyBannerA.first()).toBeVisible();

      monitorA.assertClean(await appA.inspect());
      monitorB.assertClean(await appB.inspect());
    } finally {
      await context.close();
    }
  });

  test('T2-A1-05 @p0-core Consecutive single-tab F5 refreshes retain tab ownership and never false-trigger read-only lock', async ({
    page,
  }) => {
    test.slow();
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({
      v2Save: presetMidRunMapV3(),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 21005 });
    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();

    const readOnlyBanner = page
      .locator('.system-banner.banner-warn[role="alert"], [data-testid="readonly-banner"]')
      .filter({ hasText: /只读/ });

    for (let reloadIdx = 1; reloadIdx <= 3; reloadIdx += 1) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await app.waitForInspect(
        (s) => s.screen === 'run' && s.phase === 'MAP',
        30_000,
        `map ready after reload #${reloadIdx}`,
      );
      await expect(readOnlyBanner, `Reload #${reloadIdx} must NOT show read-only banner`).toHaveCount(
        0,
      );
      await expect(app.byTestId(TEST_IDS.BTN_SAFE_RETURN)).toBeEnabled();
    }

    const selfTabId = await app.readSessionStorage(STORAGE_KEYS.SESSION_V2_TAB_SELF_ID);
    const currentLock = await app.readStorageJson<{ tabId: string; updatedAt: number }>(
      STORAGE_KEYS.V2_TAB_LOCK,
    );
    expect(selfTabId).toBeTruthy();
    expect(currentLock?.tabId).toBe(selfTabId);

    monitor.assertClean(await app.inspect());
  });

  test('T2-A1-06 @p0-core Invalid ?seed= query parameters sanitize cleanly to valid uint32 seeds without NaN', async ({
    page,
  }) => {
    test.slow();
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);
    const invalidSeeds = ['abc', '-99', '99999999999999999'];

    for (const rawSeed of invalidSeeds) {
      await app.seedStorage({
        v2Save: presetPostTutorialV3(),
        skipTitleScreen: true,
      });
      await app.boot({ seed: rawSeed, enterStation: true });
      await app.openPrepareFromBase();
      await app.launchExpedition();

      const snap = await app.waitForInspect(
        (s) => s.screen === 'run' && s.phase === 'MAP' && s.activeRun !== null,
        15_000,
        `valid sanitized run for seed=${rawSeed}`,
      );

      const activeSeed = snap.activeRun?.seed;
      expect(typeof activeSeed).toBe('number');
      expect(Number.isFinite(activeSeed)).toBe(true);
      expect(Number.isInteger(activeSeed)).toBe(true);
      expect(activeSeed).toBeGreaterThanOrEqual(0);
      expect(activeSeed).toBeLessThanOrEqual(0xffffffff);

      await assertNoDevJargon(page);
    }

    monitor.assertClean(await app.inspect());
  });

  test('T2-A1-07 @p0-core Corrupt primary save recovers from V3_0_BACKUP, migrates cleanly to Rules 3.1.0 with rewound combat, and preserves V3_0_BACKUP', async ({
    page,
  }) => {
    test.slow();
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

    // Corrupt primary with V3_BACKUP & V2_BACKUP absent -> MUST recover via V3_0_BACKUP fallback
    await app.seedStorage({
      v2Save: '{corrupt-primary-v3-json',
      v2Backup: null,
      v3Backup: null,
      v3_0Backup: legacyV3_0,
      skipTitleScreen: false,
    });
    await app.boot({ seed: 21007 });

    const recoveryDialog = page.locator('.modal-card[role="dialog"], [role="dialog"]').first();
    await expect(recoveryDialog).toBeVisible();
    await expect(recoveryDialog).toContainText(/存档异常|备份|损坏/);

    const restoreBackupBtn = recoveryDialog
      .locator('#v2-rec-backup, [data-testid="btn-recover-backup"]')
      .or(recoveryDialog.getByRole('button', { name: /恢复.*备份/ }))
      .first();
    await expect(restoreBackupBtn).toBeVisible();
    await expect(restoreBackupBtn).toBeEnabled();
    await restoreBackupBtn.click();

    await app.waitForInspect(
      (s) => !s.modalOpen && s.screen === 'run' && s.phase === 'ENCOUNTER' && s.credits === 185,
      15_000,
      'V3_0_BACKUP recovered and migrated to Rules 3.1.0 pre-combat',
    );
    await app.pauseAutoCombat({ allowAlreadyPaused: true });
    await expect(app.byTestId(TEST_IDS.COMBAT_SCREEN)).toBeVisible();

    const migrated = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(migrated).not.toBeNull();
    expect(migrated?.schemaVersion).toBe(V3_SCHEMA_VERSION);
    expect(migrated?.rulesVersion).toBe(V3_RULES_VERSION);
    expect(migrated?.profile.credits).toBe(185);
    expect(migrated?.profile.salvageParts).toBe(35);

    // In-flight 3.0.0 combat safely rewound to pre-combat L1B with startingHp restored and beacons backfilled
    expect(migrated?.activeRun?.rulesVersion).toBe(V3_RULES_VERSION);
    expect(migrated?.activeRun?.phase).toBe('ENCOUNTER');
    expect(migrated?.activeRun?.currentNodeId).toBe('L1B');
    expect(migrated?.activeRun?.activeCombat).toBeNull();
    expect(migrated?.activeRun?.hp).toBe(28);
    expect(migrated?.activeRun?.tacticalChargesUsed).toBe(0);
    expect(migrated?.activeRun?.claimedEventIds).not.toContain(
      'tactic_commit_tactic_run_v3_0_mig_1_L1B_1',
    );
    expect(migrated?.activeRun?.graph.nodes.L3A.isBeacon).toBe(true);
    expect(migrated?.activeRun?.graph.nodes.L5A.isBeacon).toBe(true);
    expect(migrated?.activeRun?.graph.nodes.L1A.isBeacon).toBe(false);

    // Original 3.0.0 backup preserved intact (non-destructive)
    const backupRawBeforeReload = await app.readStorageRaw(STORAGE_KEYS.V3_0_BACKUP);
    expect(backupRawBeforeReload).not.toBeNull();
    const backupParsed = JSON.parse(backupRawBeforeReload!) as V3_0SaveData;
    expect(backupParsed.rulesVersion).toBe(V3_0_RULES_VERSION);
    expect(backupParsed.activeRun?.activeCombat?.simulation?.resultId).toBe('sim_v3_0_legacy_1');

    // Reload idempotency: migrated 3.1.0 save & intact V3_0_BACKUP both survive reload cleanly
    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.pauseAutoCombat();
    await expect(app.byTestId(TEST_IDS.COMBAT_SCREEN)).toBeVisible();

    const backupRawAfterReload = await app.readStorageRaw(STORAGE_KEYS.V3_0_BACKUP);
    expect(backupRawAfterReload).toBe(backupRawBeforeReload);
    const afterReload = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(afterReload?.rulesVersion).toBe(V3_RULES_VERSION);
    expect(afterReload?.activeRun?.hp).toBe(28);
    expect(afterReload?.activeRun?.activeCombat).toBeNull();

    monitor.assertClean(await app.inspect());
  });
});
