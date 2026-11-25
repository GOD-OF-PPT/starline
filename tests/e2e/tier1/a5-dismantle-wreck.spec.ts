import { expect, test } from '@playwright/test';
import {
  STORAGE_KEYS,
  TEST_IDS,
  attachZeroErrorMonitors,
  createAppDriver,
  createCargoItem,
  createContractInstance,
  createMapGraph,
  presetAct1V3,
  presetMidRunMapV3,
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

  test('T1-A5-03 @p1-mid S09 Settlement 3-option segmented radiogroup dismantles looted equipment into Salvage Parts with 0 extra buttons', async ({
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

    // S09: 3-option equipment row (settle_loot_eq) uses a 0-<button> segmented radiogroup
    const eqRadiogroup = settleScreen.locator('[role="radiogroup"]').first();
    await expect(eqRadiogroup).toBeVisible();
    await expect(eqRadiogroup.locator('button')).toHaveCount(0);

    const dismantleOpt = app.byTestId(TEST_IDS.btnDismantle('settle_loot_eq'));
    await expect(dismantleOpt).toBeVisible();
    await dismantleOpt.click();
    await expect(dismantleOpt).toHaveClass(/is-selected/);

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

  test('T1-A5-06 @p1-mid S08 direct stage clamp cut & skip + D05 L3+ vault low-stability Structural Collapse forfeits wreck loot while preserving bay gear', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const armoryItem = createCargoItem({
      instanceId: 'd05_armory_eq',
      definitionId: 'equipment.laser.common',
      origin: 'loot',
      acquiredDepth: 3,
      location: 'staging',
    });
    const cargoItem = createCargoItem({
      instanceId: 'd05_cargo_bar',
      definitionId: 'cargo.alloy_bar',
      origin: 'loot',
      acquiredDepth: 3,
      location: 'staging',
    });
    const vaultItem = createCargoItem({
      instanceId: 'd05_vault_engine',
      definitionId: 'cargo.old_engine',
      origin: 'loot',
      acquiredDepth: 3,
      location: 'staging',
    });

    const graph = createMapGraph({
      nodeOverrides: {
        L3A: {
          type: 'wreck',
          isBeacon: true,
          visited: true,
          resolved: false,
          wreck: {
            armoryItem,
            cargoItems: [cargoItem],
            armorySizeRange: '1×2',
            armoryValueRange: '10¤',
            cargoSizeRange: '1×2',
            cargoValueRange: '15¤',
            reactorFuelGain: 2,
            reactorRepairGain: 5,
            chosenRoom: null,
          },
        },
      },
    });

    const save = presetMidRunMapV3({
      phase: 'ENCOUNTER',
      currentNodeId: 'L3A',
      graph,
      contract: createContractInstance('free_salvage'),
      hp: 26,
      maxHp: 30,
      fuel: 8,
      overrides: {
        visitedNodeIds: ['L1A', 'L2A', 'L3A'],
        activeWreck: {
          nodeId: 'L3A',
          stability: 55,
          maxStability: 100,
          cutsMade: 0,
          extracted: false,
          collapsed: false,
          wreckLootInstanceIds: [],
          hotspots: [
            {
              spotId: 'armory',
              label: '军械舱',
              cut: false,
              riskHullDamage: 4,
              riskFuelCost: 0,
              riskAmbush: false,
              rewardItem: armoryItem,
              rewardParts: 6,
            },
            {
              spotId: 'cargo',
              label: '主货舱',
              cut: false,
              riskHullDamage: 4,
              riskFuelCost: 0,
              riskAmbush: false,
              rewardItem: cargoItem,
              rewardParts: 7,
            },
            {
              spotId: 'reactor',
              label: '反应堆舱',
              cut: false,
              riskHullDamage: 5,
              riskFuelCost: 1,
              riskAmbush: false,
              rewardParts: 10,
              reactorFuelGain: 2,
              reactorRepairGain: 5,
            },
            {
              spotId: 'vault',
              label: '密封金库',
              cut: false,
              riskHullDamage: 4,
              riskFuelCost: 0,
              riskAmbush: false,
              rewardItem: vaultItem,
              rewardItems: [vaultItem],
              rewardParts: 11,
              rewardCredits: 14,
            },
          ],
        },
      },
    });
    save.settings.reducedMotion = false;

    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 5006 });

    await expect(app.byTestId(TEST_IDS.WRECK_SCREEN)).toBeVisible();
    await expect(app.byTestId(TEST_IDS.wreckCut('vault'))).toBeVisible();

    // S08: Direct stage clamp click triggers skippable plasma cut FX on armory (55 -> 15 stability, 0 HP loss)
    const armoryClamp = app.byTestId(TEST_IDS.wreckSpot('armory'));
    await expect(armoryClamp).toBeVisible();
    await expect(armoryClamp).toHaveAttribute('data-can-direct-cut', 'true');
    await armoryClamp.click();

    const skipOverlayBtn = app.byTestId(TEST_IDS.BTN_SKIP_WRECK_CUT);
    await expect(skipOverlayBtn).toBeVisible();
    await skipOverlayBtn.click();

    const afterCut1 = await app.waitForInspect(
      (s) => s.activeRun?.wreckStability === 15,
      10_000,
      'first safe clamp cut committed via skip',
    );
    expect(afterCut1.activeRun?.hp).toBe(26);

    const savedAfterCut1 = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(savedAfterCut1?.activeRun?.bay.staging.some((s) => s.item.instanceId === 'd05_armory_eq')).toBe(true);
    expect(savedAfterCut1?.activeRun?.activeWreck?.wreckLootInstanceIds).toContain('d05_armory_eq');
    const placedBeforeCollapse = savedAfterCut1?.activeRun?.bay.placed.length ?? 0;
    expect(placedBeforeCollapse).toBe(3);

    // D05: Remaining stability 15 - 35 <= 0 discloses guaranteed Structural Collapse on vault
    await expect(app.byTestId(TEST_IDS.WRECK_SCREEN)).toContainText(/结构坍塌警告/);

    await app.cutWreckSpot('vault');

    const afterCollapse = await app.waitForInspect(
      (s) => s.activeRun?.wreckStability === 0,
      10_000,
      'greedy vault cut triggers structural collapse',
    );
    expect(afterCollapse.activeRun?.hp ?? 0).toBeGreaterThanOrEqual(1);

    const savedAfterCollapse = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(savedAfterCollapse?.activeRun?.activeWreck?.collapsed).toBe(true);
    // THIS wreck's staged loot forfeited while placed ship bay gear stays 100% intact
    expect(savedAfterCollapse?.activeRun?.bay.staging).toHaveLength(0);
    expect(savedAfterCollapse?.activeRun?.bay.placed).toHaveLength(placedBeforeCollapse);

    // Remaining uncut compartments locked, but Extract stays enabled (zero softlock)
    await expect(app.byTestId(TEST_IDS.wreckCut('cargo'))).toBeDisabled();
    await expect(app.byTestId(TEST_IDS.wreckCut('reactor'))).toBeDisabled();
    await expect(app.byTestId(TEST_IDS.BTN_WRECK_EXTRACT)).toBeEnabled();

    await app.extractWreck();
    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();

    monitor.assertClean(await app.inspect());
  });
});
