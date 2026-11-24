import { expect, test } from '@playwright/test';
import {
  STORAGE_KEYS,
  TEST_IDS,
  attachZeroErrorMonitors,
  createAppDriver,
  createCargoBay,
  createCargoItem,
  presetAct1V3,
  presetAct2V3,
  presetSettlementV3,
  presetWreckEncounterV3,
} from '../helpers';
import type { V3SaveData } from '../helpers';

test.describe('Tier 2 · A5: Derelict Dissection & Dismantle Protection Boundaries', () => {
  test('T2-A5-01 @p1-mid Lethal wreck cut guard blocks cuts that would destroy hull while keeping safe extraction enabled', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const lowHpWreck = presetWreckEncounterV3({ hp: 4, fuel: 8 });
    if (lowHpWreck.activeRun?.activeWreck) {
      lowHpWreck.activeRun.activeWreck.cutsMade = 1;
      lowHpWreck.activeRun.activeWreck.stability = 60;
      lowHpWreck.activeRun.activeWreck.hotspots[0].cut = true;
      // cargo riskHullDamage=4 and reactor riskHullDamage=6 are both lethal at hp=4
    }

    await app.seedStorage({
      v2Save: lowHpWreck,
      skipTitleScreen: true,
    });
    await app.boot({ seed: 25001 });

    const wreckScreen = app.byTestId(TEST_IDS.WRECK_SCREEN);
    await expect(wreckScreen).toBeVisible();
    expect((await app.inspect()).activeRun?.hp).toBe(4);

    const cargoCutBtn = app.byTestId(TEST_IDS.wreckCut('cargo'));
    const reactorCutBtn = app.byTestId(TEST_IDS.wreckCut('reactor'));
    await expect(cargoCutBtn).toBeDisabled();
    await expect(reactorCutBtn).toBeDisabled();
    await expect(wreckScreen).toContainText(/致命|船体不足|危险|无法切割/);

    // Safe extraction MUST remain enabled and keep ship alive
    const extractBtn = app.byTestId(TEST_IDS.BTN_WRECK_EXTRACT);
    await expect(extractBtn).toBeEnabled();
    await extractBtn.click();

    const afterExtract = await app.waitForInspect(
      (s) => s.phase !== 'ENCOUNTER' && s.activeRun !== null,
      15_000,
      'safe extraction from lethal wreck',
    );
    expect(afterExtract.activeRun?.hp).toBe(4);
    expect(afterExtract.phase).not.toBe('SETTLEMENT');

    monitor.assertClean(afterExtract);
  });

  test('T2-A5-02 @p1-mid Loan and mission items are strictly protected from dismantling on Settlement and Workbench', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const mixedBay = createCargoBay({
      shipId: 'cannon_skiff',
      placed: [
        {
          item: createCargoItem({
            instanceId: 'prot_loan_laser',
            definitionId: 'equipment.laser.common',
            origin: 'loan',
          }),
          x: 0,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'prot_loot_shield',
            definitionId: 'equipment.shield.common',
            origin: 'loot',
            fixedValue: 10,
            acquiredDepth: 2,
          }),
          x: 1,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'prot_mission_reactor',
            definitionId: 'mission.sealed_reactor',
            origin: 'mission',
          }),
          x: 0,
          y: 2,
          rotation: 1,
        },
      ],
    });

    const settleSave = presetSettlementV3({
      reason: 'safe_return',
      bay: mixedBay,
    });

    await app.seedStorage({
      v2Save: settleSave,
      skipTitleScreen: true,
    });
    await app.boot({ seed: 25002 });

    const settlementScreen = app.byTestId(TEST_IDS.SETTLEMENT_SCREEN);
    await expect(settlementScreen).toBeVisible();

    // Loan & mission rows must be visibly rendered and expose ZERO enabled dismantle buttons
    const loanSummary = settlementScreen
      .locator('[data-testid="settlement-loan-summary"], .v2-settle-row:has(.origin-loan)')
      .first();
    await expect(loanSummary, 'Loan summary or row must be visible on Settlement').toBeVisible();
    await expect(
      loanSummary.locator('button:not([disabled])').filter({ hasText: /拆解/ }),
      'Loan items must NOT expose any enabled dismantle button',
    ).toHaveCount(0);

    const missionRow = settlementScreen
      .locator('.v2-settle-row')
      .filter({ hasText: /反应堆|密封/ })
      .first();
    await expect(missionRow, 'Mission reactor row must be visible on Settlement').toBeVisible();
    await expect(
      missionRow.locator('button:not([disabled])').filter({ hasText: /拆解/ }),
      'Mission items must NOT expose any enabled dismantle button',
    ).toHaveCount(0);

    // Loot equipment row MUST expose the ONLY enabled dismantle action on Settlement
    const lootDismantle = settlementScreen
      .locator(
        '[data-settle-item="prot_loot_shield"][data-settle-disp="dismantle"], [data-testid="btn-dismantle-prot_loot_shield"]',
      )
      .or(
        settlementScreen
          .locator('.v2-settle-row')
          .filter({ hasText: /护盾/ })
          .getByRole('button', { name: /拆解/ }),
      )
      .first();
    await expect(lootDismantle).toBeVisible();
    await expect(lootDismantle).toBeEnabled();
    await expect(
      settlementScreen.locator('button:not([disabled])').filter({ hasText: /拆解/ }),
    ).toHaveCount(1);

    const partsBefore = (await app.inspect()).salvageParts;
    await app.confirmSettlement();
    expect((await app.inspect()).salvageParts).toBe(partsBefore);

    // Open Warehouse/Workbench modal: loan/mission items must never appear as dismantlable inventory
    const warehouseDialog = await app.openBaseModal(TEST_IDS.BTN_OPEN_WAREHOUSE);
    await expect(
      warehouseDialog.locator('.origin-loan, .origin-mission, [data-origin="loan"], [data-origin="mission"]'),
    ).toHaveCount(0);
    await app.closeModal();

    monitor.assertClean(await app.inspect());
  });

  test('T2-A5-03 @p1-mid Already-improved equipment rejects further upgrade and spends zero Salvage Parts', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({
      v2Save: presetAct2V3({
        credits: 500,
        salvageParts: 200,
        equipmentWarehouse: [
          createCargoItem({
            instanceId: 'wh_already_improved',
            definitionId: 'equipment.laser.improved',
            origin: 'owned',
          }),
        ],
      }),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 25003, enterStation: true });

    const dialog = await app.openBaseModal(TEST_IDS.BTN_OPEN_WAREHOUSE);
    const itemCard = dialog
      .locator('[data-instance-id="wh_already_improved"], [data-testid="warehouse-item-wh_already_improved"]')
      .or(dialog.locator('.v2-wh-row, .warehouse-item, .v2-warehouse-row').filter({ hasText: /优良|激光炮/ }))
      .first();
    await expect(itemCard).toBeVisible();
    await expect(itemCard).toContainText(/已达最高品质|最高品质|优良/);

    await expect(
      itemCard
        .locator('[data-testid^="btn-upgrade-"]:not([disabled]), button:not([disabled])')
        .filter({ hasText: /升级|强化/ }),
    ).toHaveCount(0);

    expect((await app.inspect()).salvageParts).toBe(200);
    await app.closeModal();

    monitor.assertClean(await app.inspect());
  });

  test('T2-A5-04 @p1-mid Insufficient Salvage Parts and credits disable Workbench upgrade and craft without mutating balances', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({
      v2Save: presetAct1V3({
        credits: 0,
        salvageParts: 0,
        equipmentWarehouse: [
          createCargoItem({
            instanceId: 'wh_common_no_parts',
            definitionId: 'equipment.laser.common',
            origin: 'owned',
          }),
        ],
      }),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 25004, enterStation: true });

    const dialog = await app.openBaseModal(TEST_IDS.BTN_OPEN_WAREHOUSE);

    const upgradeBtn = dialog
      .locator(
        '[data-testid="btn-upgrade-wh_common_no_parts"], [data-instance-id="wh_common_no_parts"] button:has-text("升级")',
      )
      .or(dialog.getByRole('button', { name: /升级.*优良|升级/ }))
      .first();
    await expect(upgradeBtn).toBeVisible();
    await expect(upgradeBtn).toBeDisabled();
    await expect(dialog).toContainText(/零件|不足|需要/);

    // Switch to Blueprint & Craft tab unconditionally so craft buttons are present and verified disabled
    const craftTab = dialog
      .locator('#v2-tab-res')
      .or(dialog.getByRole('button', { name: /蓝图|制造|工坊/ }))
      .first();
    await expect(craftTab).toBeVisible();
    await craftTab.click();

    const craftBtns = dialog.locator(
      '[data-craft-kind], [data-testid^="btn-craft-"], button:has-text("制造"), button:has-text("合成")',
    );
    const craftCount = await craftBtns.count();
    expect(craftCount, 'Craft buttons must be rendered on craft tab').toBeGreaterThan(0);
    for (let i = 0; i < craftCount; i += 1) {
      await expect(craftBtns.nth(i)).toBeDisabled();
    }

    const snap = await app.inspect();
    expect(snap.salvageParts).toBe(0);
    expect(snap.credits).toBe(0);

    await app.closeModal();
    monitor.assertClean(snap);
  });

  test('T2-A5-05 @p1-mid Mid-dissection reload restores exact post-1st-cut stability and prevents re-cutting or double loot', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({
      v2Save: presetWreckEncounterV3({ hp: 30, fuel: 8 }),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 25005 });

    await expect(app.byTestId(TEST_IDS.WRECK_SCREEN)).toBeVisible();
    const initialSnap = await app.inspect();
    expect(initialSnap.activeRun?.wreckStability).toBe(100);

    // Perform 1st cut on armory
    await app.cutWreckSpot('armory');

    const afterCut1 = await app.waitForInspect(
      (s) => s.activeRun?.wreckStability !== null && (s.activeRun?.wreckStability ?? 100) < 100,
      15_000,
      'wreck stability reduced after 1st cut',
    );
    const stabilityAfterCut1 = afterCut1.activeRun?.wreckStability;
    const saveAfterCut1 = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    const stagingIdsAfterCut1 =
      saveAfterCut1?.activeRun?.bay.staging.map((s) => s.item.instanceId) ?? [];

    // Reload mid-dissection
    await page.reload({ waitUntil: 'domcontentloaded' });
    const afterReload = await app.waitForInspect(
      (s) => s.screen === 'run' && s.phase === 'ENCOUNTER' && s.activeRun?.wreckStability !== null,
      15_000,
      'wreck state restored after reload',
    );

    expect(afterReload.activeRun?.wreckStability).toBe(stabilityAfterCut1);
    await expect(app.byTestId(TEST_IDS.wreckCut('armory'))).toBeDisabled();

    const saveAfterReload = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(saveAfterReload?.activeRun?.bay.staging.map((s) => s.item.instanceId)).toEqual(
      stagingIdsAfterCut1,
    );
    expect(saveAfterReload?.activeRun?.activeWreck?.cutsMade).toBe(1);

    monitor.assertClean(afterReload);
  });
});
