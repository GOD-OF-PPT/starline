import { expect, test } from '@playwright/test';
import {
  TEST_IDS,
  assertAboveFold,
  assertCanvasNonBlank,
  assertStagingCardsBounded,
  assertZeroHorizontalOverflow,
  attachZeroErrorMonitors,
  createAppDriver,
  createCargoBay,
  createCargoItem,
  createMapGraph,
  presetAct2V3,
  presetArrangeV3,
  presetEventEncounterV3,
  presetMidRunMapV3,
  presetPostTutorialV3,
  presetSettlementV3,
  presetShopEncounterV3,
  presetWreckEncounterV3,
} from '../helpers';

test.describe('Tier 2 · A10: Responsive Layout, Staging Bounds & Input Isolation Boundaries', () => {
  test('T2-A10-01 @p0-core @mobile-only Mobile 390x844 enforces zero horizontal overflow across every screen and base modal', async ({
    page,
  }) => {
    test.slow();
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // 1. Title Screen
    await app.seedStorage({ v2Save: presetAct2V3(), skipTitleScreen: false });
    await app.boot({ seed: 30001 });
    await expect(app.byTestId(TEST_IDS.TITLE_SCREEN)).toBeVisible();
    await assertZeroHorizontalOverflow(page, 390);

    // 2. Base Screen + all 5 M1-live Base Modals (Contracts, Facilities, Warehouse, Relics, Codex)
    await app.enterStation();
    await assertZeroHorizontalOverflow(page, 390);

    const modalTriggers = [
      TEST_IDS.BTN_OPEN_CONTRACTS,
      TEST_IDS.BTN_OPEN_FACILITIES,
      TEST_IDS.BTN_OPEN_WAREHOUSE,
      TEST_IDS.BTN_OPEN_RELICS,
      TEST_IDS.BTN_OPEN_CODEX,
    ];
    for (const trigger of modalTriggers) {
      await app.openBaseModal(trigger);
      await assertZeroHorizontalOverflow(page, 390);
      await app.closeModal();
    }

    // 3. Prepare Screen
    await app.openPrepareFromBase();
    await assertZeroHorizontalOverflow(page, 390);
    const launchBox = await app.byTestId(TEST_IDS.BTN_LAUNCH_EXPEDITION).boundingBox();
    expect(launchBox).not.toBeNull();
    if (launchBox) {
      expect(launchBox.x + launchBox.width).toBeLessThanOrEqual(390);
    }

    // 4. Map Screen
    await app.launchExpedition();
    await assertZeroHorizontalOverflow(page, 390);

    // 5. Combat Screen (M1-valid pre-combat encounter)
    const combatSave = presetMidRunMapV3({
      phase: 'ENCOUNTER',
      currentNodeId: 'L1B',
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
    await app.seedStorage({ v2Save: combatSave, skipTitleScreen: true });
    await app.boot({ seed: 30002 });
    await expect(app.byTestId(TEST_IDS.COMBAT_SCREEN)).toBeVisible();
    await assertZeroHorizontalOverflow(page, 390);

    // 6. Wreck Screen
    await app.seedStorage({ v2Save: presetWreckEncounterV3(), skipTitleScreen: true });
    await app.boot({ seed: 30003 });
    await expect(app.byTestId(TEST_IDS.WRECK_SCREEN)).toBeVisible();
    await assertZeroHorizontalOverflow(page, 390);

    // 7. Event Screen
    await app.seedStorage({ v2Save: presetEventEncounterV3(), skipTitleScreen: true });
    await app.boot({ seed: 30004 });
    await expect(app.byTestId(TEST_IDS.EVENT_SCREEN)).toBeVisible();
    await assertZeroHorizontalOverflow(page, 390);

    // 8. Shop Screen
    await app.seedStorage({ v2Save: presetShopEncounterV3(), skipTitleScreen: true });
    await app.boot({ seed: 30005 });
    await expect(app.byTestId(TEST_IDS.SHOP_SCREEN)).toBeVisible();
    await assertZeroHorizontalOverflow(page, 390);

    // 9. Arrange Screen
    await app.seedStorage({ v2Save: presetArrangeV3(), skipTitleScreen: true });
    await app.boot({ seed: 30006 });
    await expect(app.byTestId(TEST_IDS.ARRANGE_SCREEN)).toBeVisible();
    await assertZeroHorizontalOverflow(page, 390);

    // 10. Settlement Screen
    await app.seedStorage({ v2Save: presetSettlementV3(), skipTitleScreen: true });
    await app.boot({ seed: 30007 });
    await expect(app.byTestId(TEST_IDS.SETTLEMENT_SCREEN)).toBeVisible();
    await assertZeroHorizontalOverflow(page, 390);

    monitor.assertClean(await app.inspect());
  });

  test('T2-A10-02 @p0-core Desktop 1366x768 keeps Prepare & Settlement CTAs sticky above fold with collapsed loan catalog', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Prepare with full unlocked M1 blueprint library (all 3 ships & 10 blueprints)
    await app.seedStorage({
      v2Save: presetAct2V3(),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 30008, enterStation: true });
    await app.openPrepareFromBase();

    await assertZeroHorizontalOverflow(page, 1366);
    await assertAboveFold(app.byTestId(TEST_IDS.BTN_LAUNCH_EXPEDITION), 768);
    // Ship grid must stay above fold because loan catalog defaults collapsed
    await assertAboveFold(app.gridCell(1, 1), 768);

    // Settlement with 8+ cargo/equipment items on heavy_freighter
    const crowdedBay = createCargoBay({
      shipId: 'heavy_freighter',
      placed: [
        {
          item: createCargoItem({ instanceId: 'c1', definitionId: 'cargo.data_box', origin: 'loot', fixedValue: 7 }),
          x: 0,
          y: 0,
        },
        {
          item: createCargoItem({ instanceId: 'c2', definitionId: 'cargo.data_box', origin: 'loot', fixedValue: 7 }),
          x: 1,
          y: 0,
        },
        {
          item: createCargoItem({ instanceId: 'c3', definitionId: 'cargo.data_box', origin: 'loot', fixedValue: 7 }),
          x: 2,
          y: 0,
        },
        {
          item: createCargoItem({ instanceId: 'c4', definitionId: 'cargo.data_box', origin: 'loot', fixedValue: 7 }),
          x: 3,
          y: 0,
        },
        {
          item: createCargoItem({ instanceId: 'c5', definitionId: 'cargo.data_box', origin: 'loot', fixedValue: 7 }),
          x: 0,
          y: 1,
        },
        {
          item: createCargoItem({ instanceId: 'c6', definitionId: 'cargo.data_box', origin: 'loot', fixedValue: 7 }),
          x: 1,
          y: 1,
        },
        {
          item: createCargoItem({ instanceId: 'c7', definitionId: 'cargo.data_box', origin: 'loot', fixedValue: 7 }),
          x: 2,
          y: 1,
        },
        {
          item: createCargoItem({ instanceId: 'c8', definitionId: 'cargo.data_box', origin: 'loot', fixedValue: 7 }),
          x: 3,
          y: 1,
        },
      ],
    });
    const crowdedSettle = presetSettlementV3({ bay: crowdedBay });

    await app.seedStorage({ v2Save: crowdedSettle, skipTitleScreen: true });
    await app.boot({ seed: 30009 });

    await expect(app.byTestId(TEST_IDS.SETTLEMENT_SCREEN)).toBeVisible();
    await assertZeroHorizontalOverflow(page, 1366);
    await assertAboveFold(app.byTestId(TEST_IDS.BTN_CONFIRM_SETTLEMENT), 768);

    monitor.assertClean(await app.inspect());
  });

  test('T2-A10-03 @p0-core Oversized staging shapes (2x3 Reactor, 1x3 Heavy, L3, T4) stay strictly bounded at 1366x768 and 390x844', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const oversizedArrange = presetArrangeV3([
      createCargoItem({
        instanceId: 'ovr_reactor_2x3',
        definitionId: 'mission.sealed_reactor',
        origin: 'mission',
      }),
      createCargoItem({
        instanceId: 'ovr_heavy_1x3',
        definitionId: 'equipment.heavy.common',
        origin: 'loot',
        acquiredDepth: 2,
      }),
      createCargoItem({
        instanceId: 'ovr_repair_l3',
        definitionId: 'equipment.repair.common',
        origin: 'loot',
        acquiredDepth: 2,
      }),
      createCargoItem({
        instanceId: 'ovr_flak_t4',
        definitionId: 'equipment.flak.common',
        origin: 'loot',
        acquiredDepth: 2,
      }),
    ]);

    await app.seedStorage({ v2Save: oversizedArrange, skipTitleScreen: true });
    await app.boot({ seed: 30010 });

    await expect(app.byTestId(TEST_IDS.ARRANGE_SCREEN)).toBeVisible();

    // Desktop 1366x768
    await assertZeroHorizontalOverflow(page, 1366);
    await assertStagingCardsBounded(page);

    // Mobile 390x844
    await page.setViewportSize({ width: 390, height: 844 });
    await assertZeroHorizontalOverflow(page, 390);
    await assertStagingCardsBounded(page);

    monitor.assertClean(await app.inspect());
  });

  test('T2-A10-04 @p0-core Modal input isolation blocks underlying keyboard shortcuts while open and closes cleanly on Escape', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({ v2Save: presetArrangeV3(), skipTitleScreen: true });
    await app.boot({ seed: 30011 });

    await expect(app.byTestId(TEST_IDS.ARRANGE_SCREEN)).toBeVisible();

    // Select a staging item before opening Settings modal
    const stagingCard = page
      .locator('.staging-card, .v2-staging-card, [data-testid^="staging-item"]')
      .first();
    await stagingCard.click();

    // Open Settings modal from topbar
    const settingsBtn = page
      .locator('[data-testid="btn-open-settings"], button[aria-label*="设置"], button:has-text("设置")')
      .first();
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();

    const dialog = page.locator('.modal-card[role="dialog"], [role="dialog"]').first();
    await expect(dialog).toBeVisible();
    expect((await app.inspect()).modalOpen).toBe(true);

    // Press game-layer shortcuts (R, Space) while modal is open -> must NOT leak through or close phase
    const phaseBefore = (await app.inspect()).phase;
    await page.keyboard.press('r');
    await page.keyboard.press('Space');

    const snapDuringModal = await app.inspect();
    expect(snapDuringModal.modalOpen).toBe(true);
    expect(snapDuringModal.phase).toBe(phaseBefore);

    // Escape closes modal cleanly
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal-card[role="dialog"]')).toHaveCount(0);
    expect((await app.inspect()).modalOpen).toBe(false);

    monitor.assertClean(await app.inspect());
  });

  test('T2-A10-05 @p0-core Dynamic viewport resize transitions (1366x768 <-> 390x844 <-> 844x390) reflow cleanly with non-blank canvas', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const viewports = [
      { width: 1366, height: 768 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
      { width: 1366, height: 768 },
    ];

    // Base screen
    await app.seedStorage({ v2Save: presetPostTutorialV3(), skipTitleScreen: true });
    await app.boot({ seed: 30012, enterStation: true });
    await app.waitForInspect((s) => s.phaserScene === 'BaseScene', 15_000, 'BaseScene active');

    for (const vp of viewports) {
      await page.setViewportSize(vp);
      await assertZeroHorizontalOverflow(page, vp.width);
      await assertCanvasNonBlank(page);
    }

    // Map screen
    await app.seedStorage({ v2Save: presetMidRunMapV3(), skipTitleScreen: true });
    await app.boot({ seed: 30013 });
    for (const vp of viewports) {
      await page.setViewportSize(vp);
      await assertZeroHorizontalOverflow(page, vp.width);
    }

    // Combat screen (M1-valid standard combat encounter)
    const resizeCombatSave = presetMidRunMapV3({
      phase: 'ENCOUNTER',
      currentNodeId: 'L1B',
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
    await app.seedStorage({ v2Save: resizeCombatSave, skipTitleScreen: true });
    await app.boot({ seed: 30014 });
    for (const vp of viewports) {
      await page.setViewportSize(vp);
      await assertZeroHorizontalOverflow(page, vp.width);
      await assertCanvasNonBlank(page);
    }

    expect(monitor.pageErrors).toEqual([]);
    monitor.assertClean(await app.inspect());
  });

  test('T2-A10-06 @p0-core Rapid Base modal open/close cycling never stacks duplicate dialogs or leaves blocking backdrops', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({ v2Save: presetAct2V3(), skipTitleScreen: true });
    await app.boot({ seed: 30015, enterStation: true });

    const modalButtons = [
      TEST_IDS.BTN_OPEN_CONTRACTS,
      TEST_IDS.BTN_OPEN_FACILITIES,
      TEST_IDS.BTN_OPEN_WAREHOUSE,
      TEST_IDS.BTN_OPEN_RELICS,
      TEST_IDS.BTN_OPEN_CODEX,
    ];

    for (const btnId of modalButtons) {
      await app.openBaseModal(btnId);
      expect(await page.locator('.modal-card[role="dialog"]').count()).toBe(1);
      expect((await app.inspect()).modalOpen).toBe(true);
      await app.closeModal();
      expect(await page.locator('.modal-card[role="dialog"]').count()).toBe(0);
      expect((await app.inspect()).modalOpen).toBe(false);
    }

    // Base primary CTA remains clickable with zero stray overlay interception
    await app.openPrepareFromBase();
    await expect(app.byTestId(TEST_IDS.PREPARE_SCREEN)).toBeVisible();

    monitor.assertClean(await app.inspect());
  });
});
