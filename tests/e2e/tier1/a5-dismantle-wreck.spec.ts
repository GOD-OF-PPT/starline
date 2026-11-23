import { expect, test } from '@playwright/test';
import {
  STORAGE_KEYS,
  TEST_IDS,
  attachZeroErrorMonitors,
  createAppDriver,
  createCargoItem,
  presetAct1V3,
  presetSettlementV3,
  presetWreckEncounterV3,
} from '../helpers';
import type { V3SaveData } from '../helpers';

test.describe('Tier 1 · A5: True Dismantling Loop — Multi-Cut Derelicts & Scrap Refining', () => {
  test('T1-A5-01 @p1-mid Safe 1st derelict cut decrements stability with 0 hull penalty and unlocks extract or greedy cut', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({
      v2Save: presetWreckEncounterV3({ hp: 30 }),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 5001 });

    await expect(app.byTestId(TEST_IDS.WRECK_SCREEN)).toBeVisible();
    await expect(app.byTestId(TEST_IDS.WRECK_STABILITY)).toBeVisible();

    const beforeSnap = await app.inspect();
    expect(beforeSnap.activeRun?.wreckStability).not.toBeNull();
    const initialStability = beforeSnap.activeRun?.wreckStability ?? 100;
    const initialHp = beforeSnap.activeRun?.hp ?? 30;

    await app.cutWreckSpot('armory');

    const afterSnap = await app.waitForInspect(
      (s) =>
        s.activeRun !== null &&
        s.activeRun.wreckStability !== null &&
        s.activeRun.wreckStability < initialStability,
      10_000,
      'stability decremented after first wreck cut',
    );

    // 1st cut is guaranteed safe with zero hull loss
    expect(afterSnap.activeRun?.hp).toBe(initialHp);
    await expect(app.byTestId(TEST_IDS.BTN_WRECK_EXTRACT)).toBeVisible();
    await expect(app.byTestId(TEST_IDS.BTN_WRECK_EXTRACT)).toBeEnabled();

    monitor.assertClean(afterSnap);
  });

  test('T1-A5-02 @p1-mid Greedy 2nd cut discloses hull/fuel risk beforehand and Extract moves loot to Arrange staging', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({
      v2Save: presetWreckEncounterV3({ hp: 30, fuel: 8 }),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 5002 });

    await app.cutWreckSpot('armory');

    // Remaining hotspot must explicitly disclose greedy cut risk before clicking
    const cargoSpot = app.byTestId(TEST_IDS.wreckCut('cargo'));
    await expect(cargoSpot).toBeVisible();
    await expect(app.byTestId(TEST_IDS.WRECK_SCREEN)).toContainText(/风险|受损|警告|船体|燃料|伏击/);

    await app.cutWreckSpot('cargo');
    await app.extractWreck();

    await expect(app.byTestId(TEST_IDS.ARRANGE_SCREEN)).toBeVisible();
    const stagingCards = page.locator(
      '.staging-card, .v2-staging-card, [data-testid^="staging-item"]',
    );
    expect(await stagingCards.count()).toBeGreaterThanOrEqual(1);

    monitor.assertClean(await app.inspect());
  });

  test('T1-A5-03 @p1-mid Settlement Dismantle disposition converts looted equipment into Salvage Parts', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const save = presetSettlementV3({ wallet: 20 });
    const initialParts = save.profile.salvageParts;

    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 5003 });

    const settleScreen = app.byTestId(TEST_IDS.SETTLEMENT_SCREEN);
    await expect(settleScreen).toBeVisible();

    const dismantleBtn = settleScreen.getByRole('button', { name: /拆解/ }).first();
    await expect(dismantleBtn).toBeVisible();
    await dismantleBtn.click();

    await expect(settleScreen).toContainText(/精密零件/);
    await app.confirmSettlement();

    const postSnap = await app.waitForInspect(
      (s) => s.screen === 'base' && s.salvageParts > initialParts,
      15_000,
      'salvageParts increased after settlement dismantle',
    );
    expect(postSnap.salvageParts).toBeGreaterThan(initialParts);

    monitor.assertClean(postSnap);
  });

  test('T1-A5-04 @p1-mid Workbench upgrades owned Common module to Improved using Salvage Parts and persists across reload', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const save = presetAct1V3({
      credits: 300,
      salvageParts: 120,
      equipmentWarehouse: [
        createCargoItem({
          instanceId: 'upg_laser_common',
          definitionId: 'equipment.laser.common',
          origin: 'owned',
        }),
      ],
    });

    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 5004, enterStation: true });

    const modal = await app.openBaseModal(TEST_IDS.BTN_OPEN_WAREHOUSE);
    const upgradeBtn = modal.getByRole('button', { name: /升级|精炼|进阶|优良/ }).first();
    await expect(upgradeBtn).toBeVisible();
    await expect(upgradeBtn).toBeEnabled();
    await upgradeBtn.click();

    const afterSnap = await app.waitForInspect(
      (s) => s.salvageParts < 120,
      10_000,
      'salvageParts deducted for module upgrade',
    );

    const savedBeforeReload = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(
      savedBeforeReload?.profile.equipmentWarehouse.some(
        (item) => item.definitionId === 'equipment.laser.improved',
      ),
    ).toBe(true);

    // Reload and verify upgraded item persists
    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.waitForInspect((s) => s.screen === 'base', 15_000);
    const savedAfterReload = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(
      savedAfterReload?.profile.equipmentWarehouse.some(
        (item) => item.definitionId === 'equipment.laser.improved',
      ),
    ).toBe(true);
    expect(savedAfterReload?.profile.salvageParts).toBe(afterSnap.salvageParts);

    monitor.assertClean(await app.inspect());
  });

  test('T1-A5-05 @p1-mid Workbench crafts module or tunes hull with Salvage Parts atomically across reload', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const save = presetAct1V3({
      credits: 400,
      salvageParts: 150,
      equipmentWarehouse: [],
    });

    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 5005, enterStation: true });

    const modal = await app.openBaseModal(TEST_IDS.BTN_OPEN_WAREHOUSE);
    const craftTab = modal.getByRole('button', { name: /制造|工坊|蓝图制造|船体调校/ }).first();
    if (await craftTab.isVisible()) {
      await craftTab.click();
    }

    const craftAction = modal.getByRole('button', { name: /制造|组装|调校/ }).first();
    await expect(craftAction).toBeVisible();
    await expect(craftAction).toBeEnabled();
    await craftAction.click();

    const afterSnap = await app.waitForInspect(
      (s) => s.salvageParts < 150 || s.credits < 400,
      10_000,
      'resources deducted for workbench craft/tuning',
    );

    await page.reload({ waitUntil: 'domcontentloaded' });
    const reloadedSnap = await app.waitForInspect((s) => s.screen === 'base', 15_000);
    expect(reloadedSnap.salvageParts).toBe(afterSnap.salvageParts);
    expect(reloadedSnap.credits).toBe(afterSnap.credits);

    monitor.assertClean(reloadedSnap);
  });
});
