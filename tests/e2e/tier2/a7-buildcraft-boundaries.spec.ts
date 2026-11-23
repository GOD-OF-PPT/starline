import { expect, test } from '@playwright/test';
import {
  ITEM_CATALOG,
  MAX_BATTLE_SHIELD,
  MAX_POST_WIN_REPAIR,
  SHIP_SPECS,
  STORAGE_KEYS,
  TEST_IDS,
  attachZeroErrorMonitors,
  createAppDriver,
  createCargoBay,
  createCargoItem,
  createMapGraph,
  createStagingItem,
  createV3RunFixture,
  getOccupiedCells,
  presetAct1V3,
  presetAct3ClimaxV3,
  presetMidRunMapV3,
} from '../helpers';
import type { V3SaveData } from '../helpers';

test.describe('Tier 2 · A7: Grid, Gadgets & Flagship Boundaries', () => {
  test('T2-A7-01 @p1-mid Disabled bulkhead cells on heavy_freighter and stargate_cruiser reject item placement cleanly', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Part 1: heavy_freighter disabled (4,0) and (0,3)
    const hfRun = createV3RunFixture({
      shipId: 'heavy_freighter',
      phase: 'ARRANGE',
      currentNodeId: 'L1A',
      bay: createCargoBay({
        shipId: 'heavy_freighter',
        placed: [
          {
            item: createCargoItem({
              instanceId: 'hf_laser_1',
              definitionId: 'equipment.laser.common',
              origin: 'loan',
            }),
            x: 0,
            y: 0,
          },
        ],
        staging: [
          createStagingItem(
            createCargoItem({
              instanceId: 'hf_stg_bat',
              definitionId: 'equipment.battery.common',
              origin: 'loot',
              acquiredDepth: 1,
              location: 'staging',
            }),
            0,
          ),
        ],
      }),
    });

    await app.seedStorage({
      v2Save: { ...presetAct3ClimaxV3(), activeRun: hfRun },
      skipTitleScreen: true,
    });
    await app.boot({ seed: 27001 });

    await expect(app.byTestId(TEST_IDS.ARRANGE_SCREEN)).toBeVisible();
    await expect(app.disabledCells()).toHaveCount(SHIP_SPECS.heavy_freighter.disabledCells.length);

    const stagingCard = page
      .locator('.staging-card, .v2-staging-card, [data-testid^="staging-item"]')
      .first();
    await expect(stagingCard).toBeVisible();
    await stagingCard.click();

    // Attempt to place onto disabled bulkhead (4,0)
    await app.gridCell(4, 0).click({ force: true });

    const hfSaveAfter = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(hfSaveAfter?.activeRun?.bay.staging.map((s) => s.item.instanceId)).toContain(
      'hf_stg_bat',
    );
    expect(
      hfSaveAfter?.activeRun?.bay.placed.some((p) => p.x === 4 && p.y === 0),
    ).toBe(false);

    // Part 2: stargate_cruiser 5 disabled bulkhead cells
    const sgRun = createV3RunFixture({
      shipId: 'stargate_cruiser',
      phase: 'ARRANGE',
      currentNodeId: 'L1A',
      bay: createCargoBay({
        shipId: 'stargate_cruiser',
        placed: [
          {
            item: createCargoItem({
              instanceId: 'sg_laser_1',
              definitionId: 'equipment.laser.common',
              origin: 'owned',
            }),
            x: 1,
            y: 1,
          },
        ],
        staging: [
          createStagingItem(
            createCargoItem({
              instanceId: 'sg_stg_bat',
              definitionId: 'equipment.battery.common',
              origin: 'loot',
              acquiredDepth: 1,
              location: 'staging',
            }),
            0,
          ),
        ],
      }),
    });

    await app.seedStorage({
      v2Save: { ...presetAct3ClimaxV3(), activeRun: sgRun },
      skipTitleScreen: true,
    });
    await app.boot({ seed: 27002 });

    await expect(app.byTestId(TEST_IDS.ARRANGE_SCREEN)).toBeVisible();
    await expect(app.disabledCells()).toHaveCount(SHIP_SPECS.stargate_cruiser.disabledCells.length);

    const sgStagingCard = page
      .locator('.staging-card, .v2-staging-card, [data-testid^="staging-item"]')
      .first();
    await sgStagingCard.click();
    await app.gridCell(0, 0).click({ force: true });

    const sgSaveAfter = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(sgSaveAfter?.activeRun?.bay.staging.map((s) => s.item.instanceId)).toContain(
      'sg_stg_bat',
    );

    monitor.assertClean(await app.inspect());
  });

  test('T2-A7-02 @p0-core Item overlap and out-of-bounds edge rotation reject invalid placement without violating bay invariants', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const run = createV3RunFixture({
      shipId: 'cannon_skiff',
      phase: 'ARRANGE',
      currentNodeId: 'L1A',
      bay: createCargoBay({
        shipId: 'cannon_skiff',
        placed: [
          {
            item: createCargoItem({
              instanceId: 'edge_existing_laser',
              definitionId: 'equipment.laser.common',
              origin: 'loan',
            }),
            x: 0,
            y: 0,
          },
        ],
        staging: [
          createStagingItem(
            createCargoItem({
              instanceId: 'edge_stg_heavy',
              definitionId: 'equipment.heavy.common',
              origin: 'loot',
              acquiredDepth: 2,
              location: 'staging',
            }),
            0,
          ),
        ],
      }),
    });

    await app.seedStorage({
      v2Save: { ...presetAct1V3(), activeRun: run },
      skipTitleScreen: true,
    });
    await app.boot({ seed: 27003 });

    const stagingCard = page
      .locator('.staging-card, .v2-staging-card, [data-testid^="staging-item"]')
      .first();
    await expect(stagingCard).toBeVisible();
    await stagingCard.click();

    // Attempt 1: overlap existing laser at (0,0)
    await app.gridCell(0, 0).click();
    let saved = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(saved?.activeRun?.bay.staging.map((s) => s.item.instanceId)).toContain('edge_stg_heavy');

    // Attempt 2: vertical 1x3 at bottom edge (3,2) -> extends to y=4 OOB
    await app.gridCell(3, 2).click();
    saved = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(saved?.activeRun?.bay.staging.map((s) => s.item.instanceId)).toContain('edge_stg_heavy');

    // Attempt 3: press R to rotate to 3x1 horizontal and click right edge (2,3) -> extends to x=4 OOB
    await page.keyboard.press('r');
    await app.gridCell(2, 3).click();
    saved = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(saved?.activeRun?.bay.staging.map((s) => s.item.instanceId)).toContain('edge_stg_heavy');

    // Verify strict non-overlap & in-bounds bay invariant holds
    const occupied = new Set<string>();
    for (const placed of saved?.activeRun?.bay.placed ?? []) {
      const meta = ITEM_CATALOG[placed.item.definitionId];
      expect(meta).toBeDefined();
      const cells = getOccupiedCells(meta.shapeId, placed.x, placed.y, placed.rotation);
      for (const cell of cells) {
        expect(cell.x).toBeGreaterThanOrEqual(0);
        expect(cell.x).toBeLessThan(SHIP_SPECS.cannon_skiff.cols);
        expect(cell.y).toBeGreaterThanOrEqual(0);
        expect(cell.y).toBeLessThan(SHIP_SPECS.cannon_skiff.rows);
        const key = `${cell.x},${cell.y}`;
        expect(occupied.has(key)).toBe(false);
        occupied.add(key);
      }
    }

    monitor.assertClean(await app.inspect());
  });

  test('T2-A7-03 @p1-mid Consumable gadgets repair_kit and jump_canister are guarded at full HP and full fuel', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const gadgetBay = createCargoBay({
      shipId: 'cannon_skiff',
      placed: [
        {
          item: createCargoItem({
            instanceId: 'gdg_loan_laser',
            definitionId: 'equipment.laser.common',
            origin: 'loan',
          }),
          x: 0,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'gdg_repair_kit_1',
            definitionId: 'gadget.repair_kit',
            origin: 'loot',
            fixedValue: 12,
            acquiredDepth: 1,
          }),
          x: 1,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'gdg_jump_can_1',
            definitionId: 'gadget.jump_canister',
            origin: 'loot',
            fixedValue: 12,
            acquiredDepth: 1,
          }),
          x: 2,
          y: 0,
        },
      ],
    });

    const fullCapRun = presetMidRunMapV3({
      fuel: 10,
      maxFuel: 10,
      hp: 30,
      maxHp: 30,
      bay: gadgetBay,
    });

    await app.seedStorage({
      v2Save: fullCapRun,
      skipTitleScreen: true,
    });
    await app.boot({ seed: 27004 });

    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();

    const repairGadgetBtn = page
      .locator('[data-testid="btn-use-gadget-repair_kit"], [data-gadget-id="repair_kit"] button')
      .or(page.getByRole('button', { name: /维修包|应急维修包/ }))
      .first();
    const jumpGadgetBtn = page
      .locator('[data-testid="btn-use-gadget-jump_canister"], [data-gadget-id="jump_canister"] button')
      .or(page.getByRole('button', { name: /跃迁燃料罐|燃料罐/ }))
      .first();

    await expect(repairGadgetBtn).toBeVisible();
    await expect(jumpGadgetBtn).toBeVisible();
    await expect(repairGadgetBtn).toBeDisabled();
    await expect(jumpGadgetBtn).toBeDisabled();

    // Both gadgets must remain intact in bay
    const saved = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    const placedIds = saved?.activeRun?.bay.placed.map((p) => p.item.instanceId) ?? [];
    expect(placedIds).toContain('gdg_repair_kit_1');
    expect(placedIds).toContain('gdg_jump_can_1');

    monitor.assertClean(await app.inspect());
  });

  test('T2-A7-04 @p1-mid Holodeck tactical template locks unauthorized mix-and-match and preset saving until exiting template mode', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({
      v2Save: presetAct1V3(),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 27005, enterStation: true });
    await app.openPrepareFromBase();

    const prepareScreen = app.byTestId(TEST_IDS.PREPARE_SCREEN);
    await expect(prepareScreen).toBeVisible();

    const templateBtn = prepareScreen
      .locator('[data-pick-trial], [data-trial-build], [data-testid^="btn-trial-template-"]')
      .or(
        prepareScreen
          .locator('button')
          .filter({ hasText: /全息|战术模板|试玩模板|重炮|无人机|反击/ }),
      )
      .first();
    await expect(templateBtn).toBeVisible();
    await templateBtn.click();

    // Save custom preset & warehouse mix-and-match controls must be unconditionally disabled while template is active
    const savePresetBtn = prepareScreen
      .locator('#v2-preset-save, [data-testid="btn-save-preset"]')
      .or(prepareScreen.getByRole('button', { name: /保存预设|保存配装|保存方案/ }))
      .first();
    await expect(savePresetBtn).toBeVisible();
    await expect(savePresetBtn).toBeDisabled();

    const enabledMixBtns = prepareScreen.locator(
      '[data-add-loan]:not([disabled]), [data-add-owned]:not([disabled])',
    );
    await expect(enabledMixBtns).toHaveCount(0);

    const exitTemplateBtn = prepareScreen
      .locator('#v2-trial-exit, [data-testid="btn-exit-template"]')
      .or(prepareScreen.locator('button').filter({ hasText: /切回自由配装|退出模板|自由配装/ }))
      .first();
    await expect(exitTemplateBtn).toBeVisible();
    await exitTemplateBtn.click();

    // Warehouse remains untouched (template did not sneak items into warehouse)
    const saved = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(saved?.profile.equipmentWarehouse).toHaveLength(2);

    monitor.assertClean(await app.inspect());
  });

  test('T2-A7-05 @p1-mid Combat starting shield strictly caps at 20 and post-win passive repair strictly caps at 4', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // shield_cruiser (+4 shield, maxHp=34, starting hp=20 so repair gain is strictly measurable)
    // Equipped raw shield > 20 and raw post-win repair > 4
    const capBay = createCargoBay({
      shipId: 'shield_cruiser',
      placed: [
        {
          item: createCargoItem({
            instanceId: 'cap_shd_1',
            definitionId: 'equipment.shield.improved',
            origin: 'owned',
          }),
          x: 0,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'cap_shd_2',
            definitionId: 'equipment.shield.improved',
            origin: 'owned',
          }),
          x: 1,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'cap_cnt_1',
            definitionId: 'equipment.counter.improved',
            origin: 'owned',
          }),
          x: 2,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'cap_wpn_1',
            definitionId: 'equipment.laser.improved',
            origin: 'owned',
          }),
          x: 3,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'cap_rep_1',
            definitionId: 'equipment.repair.improved',
            origin: 'owned',
          }),
          x: 0,
          y: 2,
        },
        {
          item: createCargoItem({
            instanceId: 'cap_rep_2',
            definitionId: 'equipment.repair.improved',
            origin: 'owned',
          }),
          x: 2,
          y: 2,
        },
      ],
    });

    const combatRun = createV3RunFixture({
      shipId: 'shield_cruiser',
      phase: 'ENCOUNTER',
      currentNodeId: 'L1B',
      bay: capBay,
      hp: 20,
      maxHp: 34,
      graph: createMapGraph({
        nodeOverrides: {
          L1B: { type: 'combat', encounterKind: 'patrol', visited: true, resolved: false },
        },
      }),
      overrides: {
        visitedNodeIds: ['L1B'],
        activeCombat: null,
      },
    });

    await app.seedStorage({
      v2Save: {
        ...presetAct1V3(),
        activeRun: combatRun,
        settings: { ...presetAct1V3().settings, pureAutoCombat: true, combatSpeed: 2 },
      },
      skipTitleScreen: true,
    });
    await app.boot({ seed: 27006 });

    const combatScreen = app.byTestId(TEST_IDS.COMBAT_SCREEN);
    await expect(combatScreen).toBeVisible();

    // Preview shield value must be capped at <= 20
    const shieldText = await combatScreen.innerText();
    const shieldMatch = shieldText.match(/护盾[^\d]*(\d+)/);
    expect(shieldMatch, 'Combat preview must display starting shield value').not.toBeNull();
    if (shieldMatch) {
      expect(Number(shieldMatch[1])).toBeLessThanOrEqual(MAX_BATTLE_SHIELD);
    }

    await app.startCombat();
    await app.skipCombat();

    const afterWin = await app.waitForInspect(
      (s) => s.phase === 'REWARD',
      15_000,
      'shield/repair cap battle won',
    );
    // Starting HP was 20, shield absorbed patrol damage -> post-win repair caps at +4 => HP <= 24
    expect(afterWin.activeRun?.hp ?? 0).toBeLessThanOrEqual(20 + MAX_POST_WIN_REPAIR);
    expect(afterWin.activeRun?.hp ?? 0).toBeLessThanOrEqual(34);

    monitor.assertClean(afterWin);
  });
});
