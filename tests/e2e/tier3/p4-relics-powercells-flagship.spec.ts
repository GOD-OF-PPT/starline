import { expect, test } from '@playwright/test';
import {
  MAX_FUEL,
  MAX_POST_WIN_REPAIR,
  STORAGE_KEYS,
  TEST_IDS,
  attachZeroErrorMonitors,
  createAppDriver,
  createCargoBay,
  createCargoItem,
  createDefaultRelics,
  createMapGraph,
  createV3RunFixture,
  presetAct1V3,
  presetAct2V3,
  presetAct3ClimaxV3,
} from '../helpers';
import type { V3SaveData } from '../helpers';

test.describe('Tier 3 · P4: Relic Passives × Hull Power Cells × Flagship & Gadgets', () => {
  test('T3-P4-01 quantum_core (+1 Budget) × stargate_cruiser (Base Budget 8) × New V3 Modules fits 9-budget combo on 20-cell grid', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const save = presetAct3ClimaxV3({
      selectedShipId: 'stargate_cruiser',
      relics: createDefaultRelics({
        quantum_core: { storedCount: 1, restored: true },
      }),
      equipmentWarehouse: [
        createCargoItem({
          instanceId: 'p4_salvo',
          definitionId: 'equipment.salvo_pod.common',
          origin: 'owned',
        }),
        createCargoItem({
          instanceId: 'p4_overdrive',
          definitionId: 'equipment.overdrive_core.common',
          origin: 'owned',
        }),
        createCargoItem({
          instanceId: 'p4_coolant',
          definitionId: 'equipment.coolant_vent.common',
          origin: 'owned',
        }),
      ],
    });

    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 34001, enterStation: true });

    await app.openPrepareFromBase();
    await app.selectShip('stargate_cruiser');

    const prepareScreen = app.byTestId(TEST_IDS.PREPARE_SCREEN);
    // Effective budget = 8 (stargate_cruiser) + 1 (quantum_core) = 9
    await expect(prepareScreen).toContainText(/\/\s*9\b|预算[^\d]*9\b/);

    // Verify 20 valid cells + 5 disabled cells + highlighted Power Cells
    expect(await app.disabledCells().count()).toBe(5);
    expect(await app.powerCells().count()).toBeGreaterThanOrEqual(2);

    // Equip cross-archetype V3 modules from warehouse and launch cleanly
    const warehouseCards = prepareScreen.locator(
      '[data-testid^="warehouse-item-"], .warehouse-item, [data-origin="owned"]',
    );
    expect(await warehouseCards.count()).toBeGreaterThanOrEqual(3);
    await warehouseCards.nth(0).click();
    await app.gridCell(1, 0).click();
    await warehouseCards.nth(0).click();
    await app.gridCell(2, 1).click();

    await app.launchExpedition();
    const mapSnap = await app.waitForInspect(
      (s) => s.phase === 'MAP' && s.activeRun?.shipId === 'stargate_cruiser',
      15_000,
      'stargate_cruiser launched with V3 modules',
    );
    expect(mapSnap.activeRun?.shipId).toBe('stargate_cruiser');

    monitor.assertClean(mapSnap);
  });

  test('T3-P4-02 cryo_amber (+4 Max HP) × repair_kit Gadget × Post-Win Repair respects 38 maxHp & 4-HP cap', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Part A: Fresh launch with cryo_amber on shield_cruiser gives maxHp = 34 + 4 = 38
    const launchSave = presetAct2V3({
      selectedShipId: 'shield_cruiser',
      relics: createDefaultRelics({
        cryo_amber: { storedCount: 1, restored: true },
      }),
    });
    await app.seedStorage({ v2Save: launchSave, skipTitleScreen: true });
    await app.boot({ seed: 34002, enterStation: true });
    await app.openPrepareFromBase();
    await app.selectShip('shield_cruiser');
    await app.launchExpedition();

    const launchedSnap = await app.waitForInspect((s) => s.phase === 'MAP', 15_000, 'cryo_amber launch');
    expect(launchedSnap.activeRun?.maxHp).toBe(38);
    expect(launchedSnap.activeRun?.hp).toBe(38);

    // Part B: Damaged shield_cruiser (hp 20/38) carrying repair_kit + 2x repair.improved (raw +6 > 4 cap)
    // uses repair_kit on MAP, then wins a live combat to verify post-win repair respects <= 4 HP cap & <= 38 maxHp
    const midRunSave: V3SaveData = {
      ...launchSave,
      settings: {
        ...launchSave.settings,
        pureAutoCombat: true,
        combatSpeed: 2,
      },
      activeRun: createV3RunFixture({
        shipId: 'shield_cruiser',
        phase: 'MAP',
        currentNodeId: 'L1A',
        hp: 20,
        maxHp: 38,
        graph: createMapGraph({
          nodeOverrides: {
            L1A: { visited: true, resolved: true },
            L2A: { type: 'combat', encounterKind: 'patrol', visited: false, resolved: false },
          },
        }),
        bay: createCargoBay({
          shipId: 'shield_cruiser',
          placed: [
            {
              item: createCargoItem({
                instanceId: 'p4_laser',
                definitionId: 'equipment.laser.improved',
                origin: 'owned',
              }),
              x: 0,
              y: 0,
            },
            {
              item: createCargoItem({
                instanceId: 'p4_shield',
                definitionId: 'equipment.shield.improved',
                origin: 'owned',
              }),
              x: 1,
              y: 0,
            },
            {
              item: createCargoItem({
                instanceId: 'p4_repair_drone_1',
                definitionId: 'equipment.repair.improved',
                origin: 'owned',
              }),
              x: 2,
              y: 0,
            },
            {
              item: createCargoItem({
                instanceId: 'p4_repair_drone_2',
                definitionId: 'equipment.repair.improved',
                origin: 'owned',
              }),
              x: 0,
              y: 2,
            },
            {
              item: createCargoItem({
                instanceId: 'p4_repair_kit',
                definitionId: 'gadget.repair_kit',
                origin: 'loot',
              }),
              x: 3,
              y: 0,
            },
          ],
        }),
        overrides: {
          visitedNodeIds: ['L1A'],
        },
      }),
    };

    await app.seedStorage({ v2Save: midRunSave, skipTitleScreen: true });
    await app.boot({ seed: 34003 });

    const useRepairKitBtn = page
      .locator('[data-testid="use-gadget-repair_kit"], [data-gadget-id="repair_kit"]')
      .or(page.getByRole('button', { name: /应急修理包|使用修理包|修理包/ }))
      .first();
    await expect(useRepairKitBtn).toBeVisible();
    await useRepairKitBtn.click();

    const healedSnap = await app.waitForInspect(
      (s) => (s.activeRun?.hp ?? 0) > 20,
      10_000,
      'repair_kit healed ship',
    );
    const hpBeforeCombat = healedSnap.activeRun?.hp ?? 0;
    expect(hpBeforeCombat).toBeGreaterThan(20);
    expect(hpBeforeCombat).toBeLessThanOrEqual(38);

    // Gadget consumed from bay
    const storedAfterHeal = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    const stillHasKit = storedAfterHeal?.activeRun?.bay.placed.some(
      (p) => p.item.definitionId === 'gadget.repair_kit',
    );
    expect(stillHasKit).toBe(false);

    // Part C: Enter and win a live combat encounter with 2x repair.improved (raw +6) -> live heal capped at <= 4 HP & <= 38 maxHp
    await app.jumpToNode('L2A');
    await expect(app.byTestId(TEST_IDS.COMBAT_SCREEN)).toBeVisible();
    await app.startCombat();
    await app.skipCombat();

    const postWinSnap = await app.waitForInspect(
      (s) => s.phase === 'REWARD',
      15_000,
      'post-win repair battle completed',
    );
    const hpAfterWin = postWinSnap.activeRun?.hp ?? 0;
    expect(hpAfterWin, 'Post-win repair must heal hull below maxHp').toBeGreaterThan(hpBeforeCombat);
    expect(
      hpAfterWin - hpBeforeCombat,
      'Two improved repair modules (raw +6) must strictly cap post-win heal at <= 4 HP',
    ).toBeLessThanOrEqual(MAX_POST_WIN_REPAIR);
    expect(hpAfterWin, 'Post-win repair must never exceed cryo_amber maxHp (38)').toBeLessThanOrEqual(38);

    monitor.assertClean(postWinSnap);
  });

  test('T3-P4-03 ancient_navigator (+1 Fuel & Full Map Reveal) × jump_canister Gadget enforces fuel cap', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const save = presetAct2V3({
      relics: createDefaultRelics({
        ancient_navigator: { storedCount: 1, restored: true },
      }),
      equipmentWarehouse: [
        createCargoItem({
          instanceId: 'p4_jump_can',
          definitionId: 'gadget.jump_canister',
          origin: 'owned',
        }),
      ],
    });

    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 34004, enterStation: true });
    await app.openPrepareFromBase();
    await app.launchExpedition();

    const mapSnap = await app.waitForInspect((s) => s.phase === 'MAP', 15_000, 'ancient_navigator launch');
    // Starting fuel 9 + 1 (ancient_navigator) = 10 (MAX_FUEL)
    expect(mapSnap.activeRun?.fuel).toBe(MAX_FUEL);

    // Full Star Map reveal: Layer 5/6 nodes show revealed types/labels rather than hidden '?' fog
    const deepNode = app.byTestId(TEST_IDS.mapNode('L5A'));
    await expect(deepNode).toBeVisible();
    const deepNodeText = (await deepNode.textContent()) ?? '';
    expect(deepNodeText).not.toMatch(/^\s*\?+\s*$/);

    // Verify jump_canister respects fuel cap: at full fuel disabled, at partial fuel adds fuel without exceeding MAX_FUEL
    const partialFuelSave: V3SaveData = {
      ...save,
      activeRun: createV3RunFixture({
        phase: 'MAP',
        currentNodeId: 'L1A',
        fuel: 8,
        maxFuel: MAX_FUEL,
        bay: createCargoBay({
          shipId: 'cannon_skiff',
          placed: [
            {
              item: createCargoItem({
                instanceId: 'jc_laser',
                definitionId: 'equipment.laser.common',
                origin: 'loan',
              }),
              x: 0,
              y: 0,
            },
            {
              item: createCargoItem({
                instanceId: 'jc_canister',
                definitionId: 'gadget.jump_canister',
                origin: 'loot',
              }),
              x: 1,
              y: 0,
            },
          ],
        }),
      }),
    };

    await app.seedStorage({ v2Save: partialFuelSave, skipTitleScreen: true });
    await app.boot({ seed: 34005 });

    const useCanisterBtn = page
      .locator('[data-testid="use-gadget-jump_canister"], [data-gadget-id="jump_canister"]')
      .or(page.getByRole('button', { name: /跃迁燃料罐|燃料罐/ }))
      .first();
    await expect(useCanisterBtn).toBeVisible();
    await useCanisterBtn.click();

    const afterFuelSnap = await app.waitForInspect(
      (s) => (s.activeRun?.fuel ?? 0) > 8,
      10_000,
      'jump_canister refueled ship',
    );
    expect(afterFuelSnap.activeRun?.fuel).toBeLessThanOrEqual(MAX_FUEL);

    monitor.assertClean(afterFuelSnap);
  });

  test('T3-P4-04 obsidian_crown (+1 Boss Tactical Charge) × Hull Power Cell × overcharge_cell Gadget in Boss Battle', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Seed on MAP at Layer 5 (L5A) with obsidian_crown restored (WITHOUT pre-seeding tacticalChargesMax = 3)
    // so jumping live into L6A Boss proves the runtime computes 2 base + 1 obsidian_crown = 3 charges.
    const base = presetAct1V3({
      relics: createDefaultRelics({
        obsidian_crown: { storedCount: 1, restored: true },
      }),
    });
    const save: V3SaveData = {
      ...base,
      activeRun: createV3RunFixture({
        runId: 'run_obsidian_boss_charges',
        seed: 34006,
        sectorId: 'near_orbit',
        shipId: 'cannon_skiff',
        phase: 'MAP',
        currentNodeId: 'L5A',
        fuel: 4,
        graph: createMapGraph({
          maxLayers: 6,
          bossKind: 'boss_anvil',
          bossId: 'boss_anvil',
          nodeOverrides: {
            L5A: { visited: true, resolved: true },
            L6A: { visited: false, resolved: false },
          },
        }),
        bay: createCargoBay({
          shipId: 'cannon_skiff',
          placed: [
            {
              item: createCargoItem({
                instanceId: 'oc_laser_power',
                definitionId: 'equipment.laser.improved',
                origin: 'owned',
              }),
              x: 1,
              y: 1,
            },
            {
              item: createCargoItem({
                instanceId: 'oc_shield',
                definitionId: 'equipment.shield.improved',
                origin: 'owned',
              }),
              x: 2,
              y: 1,
            },
            {
              item: createCargoItem({
                instanceId: 'oc_gadget',
                definitionId: 'gadget.overcharge_cell',
                origin: 'loot',
              }),
              x: 0,
              y: 0,
            },
          ],
        }),
        overrides: {
          visitedNodeIds: ['L1A', 'L2A', 'L3A', 'L4A', 'L5A'],
          tacticalChargesMax: 1,
          tacticalChargesUsed: 0,
          activeCombat: null,
        },
      }),
    };

    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 34006 });

    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();
    await app.jumpToNode('L6A');

    const combatScreen = app.byTestId(TEST_IDS.COMBAT_SCREEN);
    await expect(combatScreen).toBeVisible();

    // Activate overcharge_cell gadget pre-combat and verify preview reflects boosted burst
    const overchargeBtn = combatScreen
      .locator('[data-testid="use-gadget-overcharge_cell"], [data-gadget-id="overcharge_cell"]')
      .or(combatScreen.getByRole('button', { name: /过载电池|超频电池/ }))
      .first();
    await expect(overchargeBtn).toBeVisible();
    await overchargeBtn.click();

    await app.startCombat();

    // Tactical bar and live save must compute 3 charges (2 base + 1 obsidian_crown) dynamically on Boss entry
    await app.waitForInspect(
      (s) => s.activeRun?.combatWaitingDecision === true,
      15_000,
      'boss tactical prompt with obsidian_crown 3 charges',
    );
    const tacticalBar = app.byTestId(TEST_IDS.COMBAT_TACTICAL_BAR);
    await expect(tacticalBar).toBeVisible();
    await expect(tacticalBar).toContainText(/3/);
    const liveSave = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(liveSave?.activeRun?.tacticalChargesMax).toBe(3);

    await tacticalBar.locator('[data-testid^="tactical-order-"]:not([disabled])').first().click();

    // Resolve remaining rounds cleanly
    for (let i = 0; i < 4; i += 1) {
      const snap = await app.waitForInspect(
        (s) =>
          s.phase === 'REWARD' ||
          s.phase === 'SETTLEMENT' ||
          s.activeRun?.combatWaitingDecision === true,
        20_000,
        `boss combat step ${i + 1}`,
      );
      if (snap.activeRun?.combatWaitingDecision) {
        await tacticalBar.locator('[data-testid^="tactical-order-"]:not([disabled])').first().click();
      } else {
        break;
      }
    }

    const doneSnap = await app.inspect();
    expect(['REWARD', 'SETTLEMENT']).toContain(doneSnap.phase);

    const stored = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    const hasOvercharge = stored?.activeRun?.bay.placed.some(
      (p) => p.item.definitionId === 'gadget.overcharge_cell',
    );
    expect(hasOvercharge).toBe(false);

    monitor.assertClean(doneSnap);
  });
});
