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
    await expect(prepareScreen).toContainText(/\/\s*9\b/);

    // Verify 20 valid cells (5 disabled) + 3 highlighted Power Cells
    await expect(app.disabledCells()).toHaveCount(5);
    await expect(app.powerCells()).toHaveCount(3);

    // Clicking warehouse items auto-places onto stargate_cruiser power cells: 5/9 -> 7/9 -> 9/9
    const salvoBtn = prepareScreen.getByTestId('warehouse-item-p4_salvo');
    const overdriveBtn = prepareScreen.getByTestId('warehouse-item-p4_overdrive');
    const coolantBtn = prepareScreen.getByTestId('warehouse-item-p4_coolant');
    await expect(salvoBtn).toBeVisible();
    await expect(overdriveBtn).toBeVisible();
    await expect(coolantBtn).toBeEnabled();

    await salvoBtn.click();
    await overdriveBtn.click();

    // Exact 9/9 budget cap disables 3rd warehouse module (p4_coolant) and illuminates all 3 power cells
    await expect(prepareScreen).toContainText('9/9');
    await expect(coolantBtn).toBeDisabled();
    await expect(page.locator('.placed-item.power-cell-boosted')).toHaveCount(3);

    await app.launchExpedition();
    const mapSnap = await app.waitForInspect(
      (s) => s.phase === 'MAP' && s.activeRun?.shipId === 'stargate_cruiser',
      15_000,
      'stargate_cruiser launched with V3 modules',
    );
    expect(mapSnap.activeRun?.shipId).toBe('stargate_cruiser');

    const stored = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    const placedDefs = stored?.activeRun?.bay.placed.map((p) => p.item.definitionId) ?? [];
    expect(placedDefs).toContain('equipment.salvo_pod.common');
    expect(placedDefs).toContain('equipment.overdrive_core.common');

    monitor.assertClean(mapSnap);
  });

  test('T3-P4-02 cryo_amber (+4 Max HP) × repair_kit Gadget × Post-Win Repair respects 38 maxHp & 4-HP cap', async ({
    page,
  }) => {
    test.slow();
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

    // Part B: Damaged shield_cruiser (hp 20/38) carrying repair_kit + 2x repair.improved (raw +7 > 4 cap)
    // uses repair_kit on MAP (20 -> 30), then wins a live combat to verify exact +4 cap (30 -> 34 <= 38)
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

    const useRepairKitBtn = page.getByTestId('btn-use-gadget-repair_kit');
    await expect(useRepairKitBtn).toBeVisible();
    await expect(useRepairKitBtn).toContainText('维修包');
    await useRepairKitBtn.click();

    const healedSnap = await app.waitForInspect(
      (s) => s.activeRun?.hp === 30,
      10_000,
      'repair_kit healed ship 20 -> 30',
    );
    const hpBeforeCombat = healedSnap.activeRun?.hp ?? 0;
    expect(hpBeforeCombat).toBe(30);

    // Gadget consumed from bay
    const storedAfterHeal = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(
      storedAfterHeal?.activeRun?.bay.placed.some((p) => p.item.definitionId === 'gadget.repair_kit'),
    ).toBe(false);

    // Part C: Enter and win live combat with 2x repair.improved (raw +7) -> exact +4 cap (30 -> 34)
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
    expect(hpAfterWin).toBe(30 + MAX_POST_WIN_REPAIR);
    expect(hpAfterWin).toBeLessThanOrEqual(38);

    monitor.assertClean(postWinSnap);
  });

  test('T3-P4-03 ancient_navigator (+1 Fuel & Full Map Reveal) × jump_canister Gadget enforces fuel cap', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const save = presetAct2V3({
      selectedShipId: 'cannon_skiff',
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

    // Equip owned jump_canister (budget 5 + 1 = 6/6) so Part A also proves full-fuel disable on MAP
    const canisterWarehouseBtn = app.byTestId(TEST_IDS.PREPARE_SCREEN).getByTestId('warehouse-item-p4_jump_can');
    await expect(canisterWarehouseBtn).toBeVisible();
    await canisterWarehouseBtn.click();

    await app.launchExpedition();

    const mapSnap = await app.waitForInspect((s) => s.phase === 'MAP', 15_000, 'ancient_navigator launch');
    // Starting fuel 9 + 1 (ancient_navigator) = 10 (MAX_FUEL)
    expect(mapSnap.activeRun?.fuel).toBe(MAX_FUEL);

    // Full Star Map reveal banner + Layer 5 node exposes full title intel (no hidden '?' fog)
    await expect(page.getByTestId('relic-passive-navigator')).toBeVisible();
    const deepNode = app.byTestId(TEST_IDS.mapNode('L5A'));
    await expect(deepNode).toBeVisible();
    const deepNodeText = (await deepNode.textContent()) ?? '';
    expect(deepNodeText).not.toMatch(/^\s*\?+\s*$/);
    const deepNodeTitle = (await deepNode.getAttribute('title')) ?? '';
    expect(deepNodeTitle.trim().length).toBeGreaterThan(0);

    // At full fuel (10/10), jump_canister MUST be disabled
    const fullFuelCanisterBtn = page.getByTestId('btn-use-gadget-jump_canister');
    await expect(fullFuelCanisterBtn).toBeVisible();
    await expect(fullFuelCanisterBtn).toBeDisabled();

    // Part B: At partial fuel (9/10), using +2 jump_canister strictly clamps 9 + 2 -> 10 (MAX_FUEL) and consumes canister
    const partialFuelSave: V3SaveData = {
      ...save,
      activeRun: createV3RunFixture({
        phase: 'MAP',
        currentNodeId: 'L1A',
        fuel: 9,
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

    const useCanisterBtn = page.getByTestId('btn-use-gadget-jump_canister');
    await expect(useCanisterBtn).toBeVisible();
    await expect(useCanisterBtn).toBeEnabled();
    await useCanisterBtn.click();

    const afterFuelSnap = await app.waitForInspect(
      (s) => s.activeRun?.fuel === MAX_FUEL,
      10_000,
      'jump_canister refueled 9 -> 10 (clamped at MAX_FUEL)',
    );
    expect(afterFuelSnap.activeRun?.fuel).toBe(MAX_FUEL);

    const storedAfterUse = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(
      storedAfterUse?.activeRun?.bay.placed.some((p) => p.item.definitionId === 'gadget.jump_canister'),
    ).toBe(false);

    monitor.assertClean(afterFuelSnap);
  });

  test('T3-P4-04 obsidian_crown (+1 Boss Tactical Charge) × Hull Power Cell × overcharge_cell Gadget in Boss Battle', async ({
    page,
  }) => {
    test.slow();
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Seed on MAP at Layer 5 (L5A) with obsidian_crown restored (WITHOUT pre-seeding tacticalChargesMax = 3)
    // so jumping live into L6A Boss proves runtime computes 2 base + 1 obsidian_crown = 3 charges.
    const base = presetAct1V3({
      relics: createDefaultRelics({
        obsidian_crown: { storedCount: 1, restored: true },
      }),
    });
    const save: V3SaveData = {
      ...base,
      settings: {
        ...base.settings,
        combatSpeed: 2,
        pureAutoCombat: false,
      },
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
    await app.pauseAutoCombat();

    const combatScreen = app.byTestId(TEST_IDS.COMBAT_SCREEN);
    await expect(combatScreen).toBeVisible();

    // Verify cannon_skiff Power Cell (1,2) actively boosts oc_laser_power
    await expect(
      page.locator('.placed-item[data-instance-id="oc_laser_power"][data-power-boosted="true"]'),
    ).toBeVisible();

    // Open S06 Details Drawer before overcharge_cell: un-assisted preview is 0 HP (10轮)
    const previewCard = combatScreen.locator('[data-preview-final-hp]').first();
    await expect(previewCard).toHaveAttribute('data-preview-final-hp', '0');
    const drawerBefore = await app.openForecastDetails();
    await expect(drawerBefore).toContainText('10轮');

    const overchargeBtn = combatScreen.getByTestId('use-gadget-overcharge_cell');
    await expect(overchargeBtn).toBeVisible();
    await overchargeBtn.click();

    await expect(combatScreen.getByTestId('overcharge-active-banner')).toBeVisible();
    const afterGadgetSave = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(
      afterGadgetSave?.activeRun?.bay.placed.some((p) => p.item.instanceId === 'oc_gadget'),
    ).toBe(false);
    expect(
      afterGadgetSave?.activeRun?.bay.placed.some((p) => p.item.definitionId === 'gadget.overcharge_cell'),
    ).toBe(false);

    // S06 Details Drawer must reflect real overcharge_cell survival jump: 10轮 -> 14轮
    const drawerAfter = await app.openForecastDetails();
    await expect(drawerAfter).toContainText('14轮');
    await expect(drawerAfter).not.toContainText('10轮');

    await app.startCombat();

    // Tactical bar and live save must compute 3/3 charges (2 base + 1 obsidian_crown) dynamically on Boss entry
    const pause1 = await app.waitForInspect(
      (s) => s.activeRun?.combatWaitingDecision === true,
      30_000,
      'boss tactical prompt with obsidian_crown 3 charges',
    );
    let lastPauseRound = pause1.activeRun?.combatRound ?? 0;

    const tacticalBar = app.byTestId(TEST_IDS.COMBAT_TACTICAL_BAR);
    await expect(tacticalBar).toBeVisible();
    await expect(app.byTestId(TEST_IDS.COMBAT_TACTICAL_CHARGES)).toContainText('3/3');
    const liveSave = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(liveSave?.activeRun?.tacticalChargesMax).toBe(3);

    await app.issueTacticalOrder('overload');

    // Resolve remaining tactical pause(s) cleanly to victory REWARD screen
    for (let step = 0; step < 3; step += 1) {
      const snap = await app.waitForInspect(
        (s) =>
          s.phase === 'REWARD' ||
          (s.activeRun?.combatWaitingDecision === true &&
            (s.activeRun?.combatRound ?? 0) > lastPauseRound),
        30_000,
        `boss combat resolution step ${step + 1}`,
      );
      if (snap.phase === 'REWARD') {
        break;
      }
      lastPauseRound = snap.activeRun?.combatRound ?? lastPauseRound;
      await app.issueTacticalOrder('overload');
    }

    const doneSnap = await app.waitForInspect(
      (s) => s.phase === 'REWARD',
      30_000,
      'Act I Boss victory with obsidian_crown + power cell + overcharge_cell',
    );
    expect(doneSnap.phase).toBe('REWARD');
    expect(doneSnap.activeRun?.hp).toBe(1);

    const stored = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(stored?.activeRun?.tacticalChargesMax).toBe(3);
    expect(stored?.activeRun?.tacticalChargesUsed).toBe(3);
    expect(
      stored?.activeRun?.bay.placed.some((p) => p.item.definitionId === 'gadget.overcharge_cell'),
    ).toBe(false);

    monitor.assertClean(doneSnap);
  });

  test('T3-P4-05 stargate_cruiser 3 Power Cells × D03 Battery Cap & coolant_tank↔heavy × D01 Battery 4-Neighbor Overload × D02 Target Lock × obsidian_crown 3 Charges', async ({
    page,
  }) => {
    test.slow();
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const base = presetAct3ClimaxV3({
      selectedShipId: 'stargate_cruiser',
      discoveredSynergies: ['battery_laser', 'coolant_heavy'],
      relics: createDefaultRelics({
        ancient_navigator: { storedCount: 1, restored: true },
        quantum_core: { storedCount: 1, restored: true },
        cryo_amber: { storedCount: 1, restored: true },
        obsidian_crown: { storedCount: 1, restored: true },
      }),
    });

    const bay = createCargoBay({
      shipId: 'stargate_cruiser',
      placed: [
        {
          item: createCargoItem({
            instanceId: 'p4_05_laser_1',
            definitionId: 'equipment.laser.common',
            origin: 'owned',
          }),
          x: 1,
          y: 1,
        },
        {
          item: createCargoItem({
            instanceId: 'p4_05_laser_2',
            definitionId: 'equipment.laser.common',
            origin: 'owned',
          }),
          x: 3,
          y: 1,
        },
        {
          item: createCargoItem({
            instanceId: 'p4_05_shield',
            definitionId: 'equipment.shield.improved',
            origin: 'owned',
          }),
          x: 2,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'p4_05_bat_common',
            definitionId: 'equipment.battery.common',
            origin: 'owned',
          }),
          x: 2,
          y: 2,
        },
        {
          item: createCargoItem({
            instanceId: 'p4_05_heavy',
            definitionId: 'equipment.heavy.common',
            origin: 'owned',
          }),
          x: 1,
          y: 3,
          rotation: 1,
        },
        {
          item: createCargoItem({
            instanceId: 'p4_05_coolant',
            definitionId: 'cargo.coolant_tank',
            origin: 'loot',
            acquiredDepth: 3,
          }),
          x: 0,
          y: 1,
        },
      ],
    });

    const save: V3SaveData = {
      ...base,
      settings: {
        ...base.settings,
        pureAutoCombat: false,
        combatSpeed: 2,
      },
      activeRun: createV3RunFixture({
        runId: 'run_t3_p4_05',
        seed: 34007,
        sectorId: 'near_orbit',
        shipId: 'stargate_cruiser',
        phase: 'MAP',
        currentNodeId: 'L5A',
        hp: 38,
        maxHp: 38,
        fuel: 5,
        graph: createMapGraph({
          maxLayers: 6,
          bossKind: 'boss_anvil',
          bossId: 'boss_anvil',
          nodeOverrides: {
            L5A: { visited: true, resolved: true },
            L6A: { visited: false, resolved: false },
          },
        }),
        bay,
        overrides: {
          visitedNodeIds: ['L1A', 'L2A', 'L3A', 'L4A', 'L5A'],
          tacticalChargesMax: 1,
          tacticalChargesUsed: 0,
          activeCombat: null,
        },
      }),
    };

    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 34007 });

    // Step 1: Enter Boss L6A, pause S05 immediately, verify all 3 Power Cells + D03 battery cap + coolant_heavy synergy
    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();
    await app.jumpToNode('L6A');
    await app.pauseAutoCombat();

    await expect(app.byTestId(TEST_IDS.COMBAT_SCREEN)).toBeVisible();
    await expect(page.locator('.placed-item.power-cell-boosted')).toHaveCount(3);
    await expect(page.locator('.placed-item.battery-capped')).toHaveCount(1);
    expect(
      await page.locator('[data-synergy-id="coolant_heavy"][data-link-status="active"]').count(),
    ).toBeGreaterThanOrEqual(1);
    expect(
      await page.locator('[data-synergy-id="battery_laser"][data-link-status="capped"]').count(),
    ).toBeGreaterThanOrEqual(1);

    // Step 2: D02 Target Lock on L6A_anvil_escort_2 + start live combat -> 3/3 charges from obsidian_crown
    await app.lockEnemy('L6A_anvil_escort_2');
    await app.startCombat();

    const pause1 = await app.waitForInspect(
      (s) => s.activeRun?.combatWaitingDecision === true,
      30_000,
      'Boss Pause #1 for 4-neighbor battery overload',
    );
    let lastPauseRound = pause1.activeRun?.combatRound ?? 0;
    await expect(app.byTestId(TEST_IDS.COMBAT_TACTICAL_CHARGES)).toContainText('3/3');

    // Step 3: D01 Battery 4-Neighbor Component Overload simultaneously boosts 4 orthogonally adjacent modules
    const batOverloadBtn = app.byTestId(TEST_IDS.overloadModule('p4_05_bat_common'));
    await expect(batOverloadBtn).toBeVisible();
    await expect(batOverloadBtn).toBeEnabled();
    await expect(batOverloadBtn).toContainText('相邻超载供能');
    await expect(batOverloadBtn).toContainText('4 件正交相邻模块');
    await app.overloadModule('p4_05_bat_common');

    await expect
      .poll(
        async () => {
          const st = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
          const hasBatOverload =
            st?.activeRun?.activeCombat?.interventions?.some(
              (iv) =>
                iv.kind === 'overload_module' &&
                iv.moduleInstanceId === 'p4_05_bat_common' &&
                iv.moduleKind === 'battery',
            ) ?? false;
          return (
            st?.activeRun?.tacticalChargesUsed === 1 &&
            st?.activeRun?.lockedEnemyId === 'L6A_anvil_escort_2' &&
            hasBatOverload
          );
        },
        { timeout: 10_000, message: '4-neighbor battery overload & target lock must persist cleanly' },
      )
      .toBe(true);

    // Step 4: Finish boss fight cleanly into D07 3-equipment REWARD screen
    for (let step = 0; step < 3; step += 1) {
      const snap = await app.waitForInspect(
        (s) =>
          s.phase === 'REWARD' ||
          (s.activeRun?.combatWaitingDecision === true &&
            (s.activeRun?.combatRound ?? 0) > lastPauseRound),
        30_000,
        `stargate_cruiser boss step ${step + 1}`,
      );
      if (snap.phase === 'REWARD') {
        break;
      }
      lastPauseRound = snap.activeRun?.combatRound ?? lastPauseRound;
      await app.issueTacticalOrder('focus_calibrate');
    }

    const rewardSnap = await app.waitForInspect(
      (s) => s.phase === 'REWARD',
      30_000,
      'Boss victory enters D07 3-equipment REWARD screen',
    );
    expect(rewardSnap.activeRun?.hp).toBe(38);
    const afterWinSave = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(afterWinSave?.activeRun?.tacticalChargesUsed).toBe(1);

    await expect(app.byTestId(TEST_IDS.REWARD_SCREEN)).toBeVisible();
    await expect(app.byTestId(TEST_IDS.rewardChoice(0))).toBeVisible();
    await expect(app.byTestId(TEST_IDS.rewardChoice(1))).toBeVisible();
    await expect(app.byTestId(TEST_IDS.rewardChoice(2))).toBeVisible();

    monitor.assertClean(rewardSnap);
  });
});
