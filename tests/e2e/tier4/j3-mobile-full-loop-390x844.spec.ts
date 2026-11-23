import { expect, test } from '@playwright/test';
import {
  TEST_IDS,
  assertStagingCardsBounded,
  assertTouchTargetMinSize,
  assertZeroHorizontalOverflow,
  attachZeroErrorMonitors,
  createAppDriver,
  createMapGraph,
  presetArrangeV3,
  presetEventEncounterV3,
  presetMidRunMapV3,
  presetPostTutorialV3,
  presetSettlementV3,
  presetWreckEncounterV3,
} from '../helpers';

test.describe('Tier 4 · J3: Mobile 390×844 Full Touch Gameplay Loop', () => {
  test('T4-03 @mobile-only Mobile 390×844 completes full touch loop across Title -> Base -> Prepare -> Map -> Combat -> Wreck -> Event -> Arrange -> Settlement -> Base with zero overflow', async ({
    page,
  }) => {
    test.slow();
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // 1. Title Screen (390x844)
    await app.seedStorage({ v2Save: presetPostTutorialV3(), skipTitleScreen: false });
    await app.boot({ seed: 43001 });
    await expect(app.byTestId(TEST_IDS.TITLE_SCREEN)).toBeVisible();
    await assertZeroHorizontalOverflow(page, 390);
    await assertTouchTargetMinSize(app.byTestId(TEST_IDS.BTN_ENTER_STATION), 44);

    // 2. Base Screen
    await app.enterStation();
    await expect(app.byTestId(TEST_IDS.BASE_SCREEN)).toBeVisible();
    await assertZeroHorizontalOverflow(page, 390);
    await assertTouchTargetMinSize(app.byTestId(TEST_IDS.BTN_START_RECOMMENDED), 44);

    // 3. Prepare Screen
    await app.openPrepareFromBase();
    await expect(app.byTestId(TEST_IDS.PREPARE_SCREEN)).toBeVisible();
    await assertZeroHorizontalOverflow(page, 390);
    await assertTouchTargetMinSize(app.byTestId(TEST_IDS.BTN_LAUNCH_EXPEDITION), 44);

    // 4. Map Screen (2-layer focus)
    await app.launchExpedition();
    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();
    await assertZeroHorizontalOverflow(page, 390);
    await assertTouchTargetMinSize(app.byTestId(TEST_IDS.BTN_SAFE_RETURN), 44);

    // 5. Combat Screen (active tactical bar on mobile)
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
    await app.boot({ seed: 43002 });
    await expect(app.byTestId(TEST_IDS.COMBAT_SCREEN)).toBeVisible();
    await assertZeroHorizontalOverflow(page, 390);
    await assertTouchTargetMinSize(app.byTestId(TEST_IDS.BTN_START_COMBAT), 44);

    await app.startCombat();
    const combatPause = await app.waitForInspect(
      (s) => s.activeRun?.combatWaitingDecision === true,
      20_000,
      'mobile combat tactical bar must appear',
    );
    expect(combatPause.activeRun?.combatWaitingDecision).toBe(true);
    await assertZeroHorizontalOverflow(page, 390);
    const orderBtn = app
      .byTestId(TEST_IDS.COMBAT_TACTICAL_BAR)
      .locator('[data-testid^="tactical-order-"]:not([disabled])')
      .first();
    await assertTouchTargetMinSize(orderBtn, 44);
    await orderBtn.click();
    await app.waitForInspect((s) => s.phase === 'REWARD' || s.phase === 'SETTLEMENT', 20_000, 'mobile combat done');

    // 6. Wreck Screen (3 hotspots >= 44px touch targets)
    await app.seedStorage({ v2Save: presetWreckEncounterV3(), skipTitleScreen: true });
    await app.boot({ seed: 43003 });
    await expect(app.byTestId(TEST_IDS.WRECK_SCREEN)).toBeVisible();
    await assertZeroHorizontalOverflow(page, 390);
    await assertTouchTargetMinSize(app.byTestId(TEST_IDS.wreckCut('armory')), 44);
    await assertTouchTargetMinSize(app.byTestId(TEST_IDS.wreckCut('cargo')), 44);
    await assertTouchTargetMinSize(app.byTestId(TEST_IDS.wreckCut('reactor')), 44);
    await app.cutWreckSpot('armory');
    await app.extractWreck();

    // 7. Event Screen
    await app.seedStorage({ v2Save: presetEventEncounterV3(), skipTitleScreen: true });
    await app.boot({ seed: 43004 });
    await expect(app.byTestId(TEST_IDS.EVENT_SCREEN)).toBeVisible();
    await assertZeroHorizontalOverflow(page, 390);
    await assertTouchTargetMinSize(app.byTestId(TEST_IDS.eventChoice(2)), 44);
    await app.chooseEventOption(2);

    // 8. Arrange Screen (rotate + place + bounded staging cards)
    await app.seedStorage({ v2Save: presetArrangeV3(), skipTitleScreen: true });
    await app.boot({ seed: 43005 });
    const arrangeScreen = app.byTestId(TEST_IDS.ARRANGE_SCREEN);
    await expect(arrangeScreen).toBeVisible();
    await assertZeroHorizontalOverflow(page, 390);
    await assertStagingCardsBounded(page);

    const stagingCard = arrangeScreen
      .locator('.staging-card, .v2-staging-card, [data-testid^="staging-item"]')
      .first();
    await expect(stagingCard).toBeVisible();
    await stagingCard.click();

    const rotateBtn = arrangeScreen.getByRole('button', { name: /旋转/ }).first();
    await expect(rotateBtn).toBeVisible();
    await rotateBtn.click();
    await app.gridCell(1, 0).click();
    await assertZeroHorizontalOverflow(page, 390);
    await app.leaveArrange();

    // 9. Settlement Screen -> Base Screen
    await app.seedStorage({ v2Save: presetSettlementV3(), skipTitleScreen: true });
    await app.boot({ seed: 43006 });
    await expect(app.byTestId(TEST_IDS.SETTLEMENT_SCREEN)).toBeVisible();
    await assertZeroHorizontalOverflow(page, 390);
    await assertTouchTargetMinSize(app.byTestId(TEST_IDS.BTN_CONFIRM_SETTLEMENT), 44);
    await app.confirmSettlement();

    await expect(app.byTestId(TEST_IDS.BASE_SCREEN)).toBeVisible();
    await assertZeroHorizontalOverflow(page, 390);

    monitor.assertClean(await app.inspect());
  });
});
