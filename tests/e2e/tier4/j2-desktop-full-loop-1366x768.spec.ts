import { expect, test } from '@playwright/test';
import {
  STORAGE_KEYS,
  TEST_IDS,
  assertAboveFold,
  assertStagingCardsBounded,
  assertZeroHorizontalOverflow,
  attachZeroErrorMonitors,
  createAppDriver,
  createCargoItem,
  createDefaultRelics,
  presetAct2V3,
  presetEventEncounterV3,
  presetSettlementV3,
  presetShopEncounterV3,
  presetWreckEncounterV3,
} from '../helpers';
import type { V3SaveData } from '../helpers';

test.describe('Tier 4 · J2: Desktop 1366×768 Full Multi-Run Economic & Craft Loop', () => {
  test('T4-02 Desktop 1366×768 completes Base -> Contract -> Prepare -> Map -> Combat -> Wreck -> Event -> Shop -> Arrange -> Settlement -> Upgrade/Craft/Relic -> Run #2', async ({
    page,
  }) => {
    test.slow();
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Step 1: Base -> accept Contract with Bonus Objective
    const baseSave = presetAct2V3({
      credits: 700,
      salvageParts: 140,
      relics: createDefaultRelics({
        ancient_navigator: { storedCount: 1, restored: false },
      }),
      equipmentWarehouse: [
        createCargoItem({
          instanceId: 'j2_wh_laser',
          definitionId: 'equipment.laser.common',
          origin: 'owned',
        }),
        createCargoItem({
          instanceId: 'j2_wh_shield',
          definitionId: 'equipment.shield.common',
          origin: 'owned',
        }),
      ],
    });

    await app.seedStorage({ v2Save: baseSave, skipTitleScreen: true });
    await app.boot({ seed: 42001, enterStation: true });
    await assertZeroHorizontalOverflow(page, 1366);

    const contractsModal = await app.openBaseModal(TEST_IDS.BTN_OPEN_CONTRACTS);
    await expect(contractsModal).toContainText(/额外目标|契约|赏金|转运|黑匣/);
    const acceptContractBtn = contractsModal
      .getByRole('button', { name: /接取|选择|出航|整备/ })
      .first();
    await expect(acceptContractBtn).toBeVisible();
    await acceptContractBtn.click();

    // Step 2: Prepare -> ship/crew/power-cell placement + sticky CTA above fold
    if ((await app.inspect()).screen !== 'prepare') {
      await app.openPrepareFromBase();
    }
    await expect(app.byTestId(TEST_IDS.PREPARE_SCREEN)).toBeVisible();
    await assertZeroHorizontalOverflow(page, 1366);
    await assertAboveFold(app.byTestId(TEST_IDS.BTN_LAUNCH_EXPEDITION), 768);

    await app.selectShip('cannon_skiff');
    await app.selectCrew('engineer');
    expect(await app.powerCells().count()).toBeGreaterThanOrEqual(1);

    await app.launchExpedition();

    // Step 3: Map -> verify DAG arrows & side-by-side layer comparison
    const mapScreen = app.byTestId(TEST_IDS.MAP_SCREEN);
    await expect(mapScreen).toBeVisible();
    await assertZeroHorizontalOverflow(page, 1366);
    const edgeCount = await mapScreen
      .locator('svg path, svg line, .map-dag-edge, .star-map-edge')
      .count();
    expect(edgeCount).toBeGreaterThan(0);

    // Step 4: Combat -> unconditionally enter L1 combat node, issue Active Tactical Command, reach REWARD
    const combatNode = page
      .locator('[data-testid="map-node-L1A"], [data-testid="map-node-L1B"]')
      .filter({ hasText: /战斗|哨|敌/ })
      .first();
    await expect(combatNode, 'Layer 1 must expose a visible combat node').toBeVisible();
    await combatNode.click();
    await expect(app.byTestId(TEST_IDS.BTN_JUMP_NODE)).toBeEnabled();
    await app.byTestId(TEST_IDS.BTN_JUMP_NODE).click();

    await expect(app.byTestId(TEST_IDS.COMBAT_SCREEN)).toBeVisible();
    await assertZeroHorizontalOverflow(page, 1366);
    await app.startCombat();

    const pauseSnap = await app.waitForInspect(
      (s) => s.activeRun?.combatWaitingDecision === true,
      20_000,
      'combat tactical pause in default-ON tactical mode',
    );
    expect(pauseSnap.activeRun?.combatWaitingDecision).toBe(true);

    const tacticalOrder = app
      .byTestId(TEST_IDS.COMBAT_TACTICAL_BAR)
      .locator('[data-testid^="tactical-order-"]:not([disabled])')
      .first();
    await expect(tacticalOrder).toBeVisible();
    await tacticalOrder.click();

    await app.waitForInspect(
      (s) => s.phase === 'REWARD',
      20_000,
      'combat victory reaches REWARD screen',
    );
    await expect(app.byTestId(TEST_IDS.REWARD_SCREEN)).toBeVisible();

    // Step 5: Wreck (2-cut dissection + extract -> Arrange bounds + above-fold CTA)
    await app.seedStorage({ v2Save: presetWreckEncounterV3({ crewId: 'engineer' }), skipTitleScreen: true });
    await app.boot({ seed: 42002 });
    await expect(app.byTestId(TEST_IDS.WRECK_SCREEN)).toBeVisible();
    await assertZeroHorizontalOverflow(page, 1366);
    await app.cutWreckSpot('armory');
    await app.cutWreckSpot('cargo');
    await app.extractWreck();

    await expect(app.byTestId(TEST_IDS.ARRANGE_SCREEN)).toBeVisible();
    await assertZeroHorizontalOverflow(page, 1366);
    await assertStagingCardsBounded(page);
    await assertAboveFold(app.byTestId(TEST_IDS.BTN_LEAVE_ARRANGE), 768);

    // Step 6: Event (crew bonus choice)
    await app.seedStorage({ v2Save: presetEventEncounterV3({ crewId: 'engineer' }), skipTitleScreen: true });
    await app.boot({ seed: 42003 });
    await expect(app.byTestId(TEST_IDS.EVENT_SCREEN)).toBeVisible();
    await assertZeroHorizontalOverflow(page, 1366);
    await app.chooseEventOption(1);

    // Step 7: Shop (buy offer + Engineer Swap visible in SHOP)
    await app.seedStorage({
      v2Save: presetShopEncounterV3({ crewId: 'engineer', engineerSwapAvailable: true, wallet: 100 }),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 42004 });
    const shopScreen = app.byTestId(TEST_IDS.SHOP_SCREEN);
    await expect(shopScreen).toBeVisible();
    await assertZeroHorizontalOverflow(page, 1366);
    const buyBtn = shopScreen
      .locator('[data-buy-offer], [data-testid^="shop-buy-offer-"], [data-offer-id]')
      .or(shopScreen.getByRole('button', { name: /购买/ }))
      .first();
    await expect(buyBtn).toBeVisible();
    await buyBtn.click();

    // Step 8: Settlement (dismantle 1 looted equipment into Salvage Parts + confirm CTA above fold)
    const settleSave = presetSettlementV3({ wallet: 60 });
    settleSave.profile = baseSave.profile;
    await app.seedStorage({ v2Save: settleSave, skipTitleScreen: true });
    await app.boot({ seed: 42005 });

    const settleScreen = app.byTestId(TEST_IDS.SETTLEMENT_SCREEN);
    await expect(settleScreen).toBeVisible();
    await assertZeroHorizontalOverflow(page, 1366);
    await assertAboveFold(app.byTestId(TEST_IDS.BTN_CONFIRM_SETTLEMENT), 768);

    const dismantleBtn = settleScreen
      .locator('[data-settle-disp="dismantle"], [data-testid^="btn-dismantle-"], [data-action="dismantle"]')
      .or(settleScreen.getByRole('button', { name: /拆解/ }))
      .first();
    await expect(dismantleBtn).toBeVisible();
    await dismantleBtn.click();
    await app.confirmSettlement();

    const afterSettleSnap = await app.inspect();
    expect(afterSettleSnap.salvageParts).toBeGreaterThan(140);

    // Step 9: Base Economic Sinks — Facility Tier Upgrade + Workbench Common->Improved + Restore Relic
    const facModal = await app.openBaseModal(TEST_IDS.BTN_OPEN_FACILITIES);
    const upgradeFacBtn = facModal
      .locator('button:not([disabled])')
      .filter({ hasText: /升级|建造|扩建/ })
      .first();
    await expect(upgradeFacBtn).toBeVisible();
    await upgradeFacBtn.click();
    await app.closeModal();

    const whModal = await app.openBaseModal(TEST_IDS.BTN_OPEN_WAREHOUSE);
    const upgradeEqBtn = whModal
      .locator('button:not([disabled])')
      .filter({ hasText: /升级|精炼|优良/ })
      .first();
    await expect(upgradeEqBtn).toBeVisible();
    await upgradeEqBtn.click();
    await app.closeModal();

    const relicModal = await app.openBaseModal(TEST_IDS.BTN_OPEN_RELICS);
    const restoreRelicBtn = relicModal
      .locator('button:not([disabled])')
      .filter({ hasText: /修复|激活/ })
      .first();
    await expect(restoreRelicBtn).toBeVisible();
    await restoreRelicBtn.click();
    await app.closeModal();

    // Verify upgraded state persisted & carries into Run #2
    const upgradedSave = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(upgradedSave?.profile.relics.ancient_navigator.restored).toBe(true);
    const hasImproved = upgradedSave?.profile.equipmentWarehouse.some((item) =>
      item.definitionId.endsWith('.improved'),
    );
    expect(hasImproved).toBe(true);

    // Step 10: Launch Run #2 verifying restored relic (+1 fuel = 10) carries into live expedition
    await app.openPrepareFromBase();
    await app.launchExpedition();
    const run2Snap = await app.waitForInspect((s) => s.phase === 'MAP', 15_000, 'Run #2 launched');
    expect(run2Snap.activeRun?.fuel).toBe(10);

    monitor.assertClean(run2Snap);
  });
});
