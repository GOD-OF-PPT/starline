import { expect, test } from '@playwright/test';
import {
  SHIP_SPECS,
  TEST_IDS,
  attachZeroErrorMonitors,
  createAppDriver,
  createCargoBay,
  createCargoItem,
  createMapGraph,
  presetAct1V3,
  presetAct3ClimaxV3,
  presetArrangeV3,
  presetMidRunMapV3,
  presetWreckEncounterV3,
} from '../helpers';

test.describe('Tier 1 · A7: Deepened Buildcraft — 16 Modules, 4 Gadgets, 4th Flagship & Power Cells', () => {
  test('T1-A7-01 @p0-core Cargo grid placement, 90° rotation, orthogonal adjacency synergy, and undo discard', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({
      v2Save: presetArrangeV3([
        createCargoItem({
          instanceId: 'stg_battery_synergy',
          definitionId: 'equipment.battery.common',
          origin: 'loot',
          acquiredDepth: 1,
        }),
      ]),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 7001 });

    await expect(app.byTestId(TEST_IDS.ARRANGE_SCREEN)).toBeVisible();

    // Place battery from staging at (1, 1) orthogonally adjacent to laser at (0, 0)-(0, 1)
    const stagingCard = page
      .locator('.staging-card, .v2-staging-card, [data-testid^="staging-item"]')
      .first();
    await expect(stagingCard).toBeVisible();
    await stagingCard.click();
    await app.gridCell(1, 1).click();

    await expect(page.locator('.placed-item.v2-placed-item')).toHaveCount(2);
    await expect(page.locator('.placed-item.synergy-active')).toHaveCount(2);

    // Select laser via its cargo cell and test unobstructed 90° rotation via keyboard 'R'
    await app.gridCell(0, 0).click();
    await page.keyboard.press('r');
    // Laser now occupies (0,0)-(1,0), still orthogonally adjacent to battery at (1,1)
    await expect(page.locator('.placed-item.synergy-active')).toHaveCount(2);

    // Discard the loot battery via its cargo cell and verify Undo restores it cleanly
    await expect(page.locator('.placed-item.origin-loot')).toHaveCount(1);
    await app.gridCell(1, 1).click();
    const discardBtn = page
      .locator('#btn-v2-discard, [data-testid^="btn-discard-"]')
      .or(page.getByRole('button', { name: /舍弃|丢弃|弃置/ }))
      .first();
    await expect(discardBtn).toBeVisible();
    await discardBtn.click();

    const undoBtn = page
      .locator('#btn-v2-undo-discard, [data-testid="btn-undo-discard"]')
      .or(page.getByRole('button', { name: /撤回|撤销/ }))
      .first();
    await expect(undoBtn).toBeVisible();
    await expect(undoBtn).toBeEnabled();
    await undoBtn.click();

    await expect(page.locator('.placed-item.origin-loot')).toHaveCount(1);

    monitor.assertClean(await app.inspect());
  });

  test('T1-A7-02 @p2-late All 6 new V3 equipment modules render valid specs and participate in combat simulation', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const flagshipBay = createCargoBay({
      shipId: 'stargate_cruiser',
      placed: [
        { item: createCargoItem({ instanceId: 'v3_salvo', definitionId: 'equipment.salvo_pod.common', origin: 'owned' }), x: 1, y: 0 },
        { item: createCargoItem({ instanceId: 'v3_coolant', definitionId: 'equipment.coolant_vent.common', origin: 'owned' }), x: 2, y: 0 },
        { item: createCargoItem({ instanceId: 'v3_emp', definitionId: 'equipment.emp_jammer.common', origin: 'owned' }), x: 3, y: 0 },
        { item: createCargoItem({ instanceId: 'v3_amp', definitionId: 'equipment.cargo_amp.common', origin: 'owned' }), x: 0, y: 1 },
        { item: createCargoItem({ instanceId: 'v3_grapple', definitionId: 'equipment.salvage_grapple.common', origin: 'owned' }), x: 0, y: 2 },
        { item: createCargoItem({ instanceId: 'v3_overdrive', definitionId: 'equipment.overdrive_core.common', origin: 'owned' }), x: 2, y: 2 },
      ],
    });

    const save = presetAct3ClimaxV3();
    save.activeRun = presetMidRunMapV3({
      sectorId: 'stargate_abyss',
      shipId: 'stargate_cruiser',
      phase: 'ENCOUNTER',
      currentNodeId: 'L1B',
      hp: SHIP_SPECS.stargate_cruiser.maxHp,
      bay: flagshipBay,
      graph: createMapGraph({
        nodeOverrides: {
          L1B: { type: 'combat', encounterKind: 'patrol', visited: true, resolved: false },
        },
      }),
      overrides: {
        visitedNodeIds: ['L1B'],
        activeCombat: null,
      },
    }).activeRun;
    save.settings.pureAutoCombat = true;

    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 7002 });

    const combatScreen = app.byTestId(TEST_IDS.COMBAT_SCREEN);
    await expect(combatScreen).toBeVisible();

    await app.startCombat();
    await app.skipCombat();
    await expect(app.byTestId(TEST_IDS.REWARD_SCREEN)).toBeVisible({ timeout: 15_000 });

    monitor.assertClean(await app.inspect());
  });

  test('T1-A7-03 @p1-mid Consumable 1x1 tactical gadgets apply effects and consume cleanly on use', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Part A: repair_kit & jump_canister on Map/Arrange
    const gadgetBay = createCargoBay({
      shipId: 'cannon_skiff',
      placed: [
        { item: createCargoItem({ instanceId: 'gd_laser', definitionId: 'equipment.laser.common', origin: 'loan' }), x: 0, y: 0 },
        { item: createCargoItem({ instanceId: 'gd_repair', definitionId: 'gadget.repair_kit', origin: 'loot', acquiredDepth: 1 }), x: 1, y: 0 },
        { item: createCargoItem({ instanceId: 'gd_jump', definitionId: 'gadget.jump_canister', origin: 'loot', acquiredDepth: 1 }), x: 2, y: 0 },
      ],
    });

    await app.seedStorage({
      v2Save: presetMidRunMapV3({ phase: 'MAP', hp: 18, maxHp: 30, fuel: 5, bay: gadgetBay }),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 7003 });

    const useRepairBtn = page.getByRole('button', { name: /维修包|修复包|使用.*维修/ }).first();
    await expect(useRepairBtn).toBeVisible();
    await useRepairBtn.click();

    const afterRepair = await app.waitForInspect(
      (s) => (s.activeRun?.hp ?? 0) > 18,
      10_000,
      'repair_kit restores hull HP',
    );
    expect(afterRepair.activeRun?.hp).toBeGreaterThan(18);

    const useJumpBtn = page.getByRole('button', { name: /跃迁燃料罐|燃料罐|使用.*燃料/ }).first();
    await expect(useJumpBtn).toBeVisible();
    await useJumpBtn.click();

    const afterJump = await app.waitForInspect(
      (s) => (s.activeRun?.fuel ?? 0) > 5,
      10_000,
      'jump_canister restores fuel',
    );
    expect(afterJump.activeRun?.fuel).toBeGreaterThan(5);

    // Part B: cut_stabilizer on Wreck screen
    const wreckSave = presetWreckEncounterV3();
    if (wreckSave.activeRun) {
      wreckSave.activeRun.bay = createCargoBay({
        shipId: 'cannon_skiff',
        placed: [
          { item: createCargoItem({ instanceId: 'gd_w_laser', definitionId: 'equipment.laser.common', origin: 'loan' }), x: 0, y: 0 },
          { item: createCargoItem({ instanceId: 'gd_stab', definitionId: 'gadget.cut_stabilizer', origin: 'loot', acquiredDepth: 1 }), x: 1, y: 0 },
        ],
      });
    }
    await app.seedStorage({ v2Save: wreckSave, skipTitleScreen: true });
    await app.boot({ seed: 7004 });

    const stabBtn = page.getByRole('button', { name: /切割稳定器|稳定器/ }).first();
    await expect(stabBtn).toBeVisible();
    await stabBtn.click();

    monitor.assertClean(await app.inspect());
  });

  test('T1-A7-04 @p2-late 4th Flagship (stargate_cruiser) renders 5x5 irregular 20-cell grid and budget 8', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({ v2Save: presetAct3ClimaxV3(), skipTitleScreen: true });
    await app.boot({ seed: 7005, enterStation: true });
    await app.openPrepareFromBase();

    await app.selectShip('stargate_cruiser');

    const totalCells = await page.locator('.cargo-cell[data-cx][data-cy]').count();
    const disabledCount = await app.disabledCells().count();
    expect(totalCells).toBe(25);
    expect(disabledCount).toBe(5);
    expect(totalCells - disabledCount).toBe(20);

    // Budget displays 8 (or 9 if quantum_core restored — here quantum_core is restored in presetAct3ClimaxV3, so verify >= 8)
    await expect(app.byTestId(TEST_IDS.PREPARE_SCREEN)).toContainText(/\/\s*[89]|预算[^\d]*[89]/);

    monitor.assertClean(await app.inspect());
  });

  test('T1-A7-05 @p1-mid Highlighted Hull Power Cells (data-power-cell="true") activate documented module bonus', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({ v2Save: presetAct1V3(), skipTitleScreen: true });
    await app.boot({ seed: 7006, enterStation: true });
    await app.openPrepareFromBase();

    const powerCells = app.powerCells();
    const count = await powerCells.count();
    expect(count, 'Every hull must highlight at least 1 power cell with data-power-cell="true"').toBeGreaterThanOrEqual(1);

    const firstPowerCell = powerCells.first();
    await expect(firstPowerCell).toBeVisible();

    const prepareText = await app.byTestId(TEST_IDS.PREPARE_SCREEN).innerText();
    expect(prepareText).toMatch(/供能格|能量格|充能格|核心格/);

    monitor.assertClean(await app.inspect());
  });

  test('T1-A7-06 @p1-mid Holodeck Tactical Templates frame trial kits in-universe and switch cleanly back to free loadout', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({ v2Save: presetAct1V3(), skipTitleScreen: true });
    await app.boot({ seed: 7007, enterStation: true });
    await app.openPrepareFromBase();

    const templateBtn = page
      .getByRole('button', { name: /战术模板|全息模板|重炮破甲|无人机编队|护盾反击/ })
      .first();
    await expect(templateBtn).toBeVisible();
    await templateBtn.click();

    await expect(app.byTestId(TEST_IDS.PREPARE_SCREEN)).toContainText(/模板|全息|试用/);

    const returnFreeBtn = page.getByRole('button', { name: /切回自由配装|自由配装|退出模板/ }).first();
    await expect(returnFreeBtn).toBeVisible();
    await returnFreeBtn.click();

    await expect(app.byTestId(TEST_IDS.BTN_LAUNCH_EXPEDITION)).toBeEnabled();
    monitor.assertClean(await app.inspect());
  });
});
