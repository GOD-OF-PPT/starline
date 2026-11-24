import { expect, test } from '@playwright/test';
import {
  STORAGE_KEYS,
  TEST_IDS,
  attachZeroErrorMonitors,
  createAppDriver,
  presetAct2V3,
} from '../helpers';
import type { V3SaveData } from '../helpers';

async function advanceShowcaseStation(
  app: ReturnType<typeof createAppDriver>,
  page: import('@playwright/test').Page,
): Promise<void> {
  for (let guard = 0; guard < 8; guard += 1) {
    const snap = await app.inspect();
    if (snap.phase === 'MAP' || snap.phase === 'SETTLEMENT' || snap.screen === 'base' || snap.screen === 'title') {
      return;
    }
    if (snap.phase === 'ENCOUNTER') {
      if (await app.byTestId(TEST_IDS.COMBAT_SCREEN).isVisible()) {
        await app.startCombat();
        for (let step = 0; step < 4; step += 1) {
          const s = await app.waitForInspect(
            (cur) =>
              cur.phase === 'REWARD' ||
              cur.phase === 'SETTLEMENT' ||
              cur.phase === 'MAP' ||
              cur.activeRun?.combatWaitingDecision === true,
            20_000,
            'showcase combat progress',
          );
          if (s.activeRun?.combatWaitingDecision) {
            await app
              .byTestId(TEST_IDS.COMBAT_TACTICAL_BAR)
              .locator('[data-testid^="tactical-order-"]:not([disabled])')
              .first()
              .click();
          } else {
            break;
          }
        }
      } else if (await app.byTestId(TEST_IDS.WRECK_SCREEN).isVisible()) {
        const cutBtn = page.locator('[data-testid^="wreck-cut-"]:not([disabled])').first();
        await expect(cutBtn).toBeVisible();
        await cutBtn.click();
        const afterCutSnap = await app.waitForInspect(
          (s) => s.phase !== 'ENCOUNTER' || s.activeRun?.wreckStability !== null,
          10_000,
          'showcase wreck cut progressed',
        );
        if (
          afterCutSnap.phase === 'ENCOUNTER' &&
          (await app.byTestId(TEST_IDS.BTN_WRECK_EXTRACT).isVisible())
        ) {
          await app.extractWreck();
        }
      } else if (await app.byTestId(TEST_IDS.EVENT_SCREEN).isVisible()) {
        const opt = page.locator('[data-testid^="event-choice-"]:not([disabled])').first();
        await expect(opt).toBeVisible();
        await opt.click();
      }
    } else if (snap.phase === 'REWARD') {
      const choice = app
        .byTestId(TEST_IDS.REWARD_SCREEN)
        .locator('button[data-pick-reward], .v2-reward-card, [data-testid^="reward-choice-"], button:not([disabled])')
        .first();
      await expect(choice).toBeVisible();
      await choice.click();
    } else if (snap.phase === 'SHOP') {
      const shopScreen = app.byTestId(TEST_IDS.SHOP_SCREEN);
      const leaveBtn = shopScreen
        .locator('#v2-shop-finish')
        .or(shopScreen.getByRole('button', { name: /完成交易|离开|返回星图|继续/ }))
        .first();
      await expect(leaveBtn).toBeVisible();
      await leaveBtn.click();
    } else if (snap.phase === 'ARRANGE') {
      const arrangeScreen = app.byTestId(TEST_IDS.ARRANGE_SCREEN);
      const leaveBtn = app.byTestId(TEST_IDS.BTN_LEAVE_ARRANGE);
      const stagingCards = arrangeScreen.locator(
        '.v2-staging-card, .staging-card, [data-testid^="staging-item"]',
      );
      let discardGuard = 0;
      while (!(await leaveBtn.isEnabled()) && (await stagingCards.count()) > 0 && discardGuard < 8) {
        await stagingCards.first().click();
        const discardBtn = arrangeScreen
          .locator('#btn-v2-discard, [data-testid^="btn-discard-"], button:has-text("舍弃"), button:has-text("丢弃")')
          .first();
        await expect(discardBtn).toBeVisible();
        await discardBtn.click();
        discardGuard += 1;
      }
      await app.leaveArrange();
    }
  }
}

test.describe('Tier 4 · J7: 4-Station Showcase Journey from Secondary Drawer + Save Isolation', () => {
  test('T4-07 Completing 4-station Showcase from Title secondary drawer leaves main V3 save 100% unpolluted', async ({
    page,
  }) => {
    test.slow();
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const mainSave = presetAct2V3({
      credits: 642,
      salvageParts: 118,
      totalRuns: 7,
      settledRunIds: ['main_run_1', 'main_run_2'],
    });

    await app.seedStorage({ v2Save: mainSave, skipTitleScreen: false });
    await app.boot({ seed: 47001 });

    // Capture exact pre-showcase V3 save snapshot
    const saveBefore = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(saveBefore?.profile.credits).toBe(642);
    expect(saveBefore?.profile.totalRuns).toBe(7);

    // Title Screen keeps Showcase tucked inside secondary drawer [data-testid="btn-more-modes"]
    await expect(app.byTestId(TEST_IDS.TITLE_SCREEN)).toBeVisible();
    await app.openMoreModes();

    const showcaseLaunchBtn = page
      .locator('[data-testid="btn-mode-showcase"], #v3-btn-mode-showcase, #v2-title-showcase, [data-testid="btn-open-showcase"]')
      .or(page.getByRole('button', { name: /选择试航构筑|4\s*站精华试玩|精华试玩/ }))
      .first();
    await expect(showcaseLaunchBtn).toBeVisible();
    await showcaseLaunchBtn.click();

    // Unconditionally select a trial kit inside the showcase picker modal
    const trialPicker = page.locator('[data-showcase-trial="trial_heavy"], [data-showcase-trial]').first();
    await expect(trialPicker).toBeVisible();
    await trialPicker.click();

    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible({ timeout: 15_000 });

    // Play through all 4 showcase stations to Showcase Settlement
    for (let station = 0; station < 4; station += 1) {
      const snap = await app.inspect();
      if (snap.phase === 'SETTLEMENT') break;
      const nextNode = page
        .locator('[data-testid^="map-node-"][data-reachable="true"], [data-testid^="map-node-"]:not([disabled])')
        .first();
      await expect(nextNode).toBeVisible();
      await nextNode.click();
      await app.byTestId(TEST_IDS.BTN_JUMP_NODE).click();
      await advanceShowcaseStation(app, page);
    }

    if ((await app.inspect()).phase === 'MAP') {
      await app.safeReturn();
    }
    await expect(app.byTestId(TEST_IDS.SETTLEMENT_SCREEN)).toBeVisible({ timeout: 15_000 });

    // Exit showcase back to Base / Title
    const exitShowcaseBtn = page
      .locator('#v2-showcase-to-base, #v2-btn-exit-showcase, [data-testid="btn-confirm-settlement"]')
      .or(page.getByRole('button', { name: /返回主站|结束试玩|回到基地|返回标题/ }))
      .first();
    await expect(exitShowcaseBtn).toBeVisible();
    await exitShowcaseBtn.click();

    await app.waitForInspect(
      (s) => s.screen === 'base' || s.screen === 'title',
      15_000,
      'returned to base/title from showcase',
    );

    // Main V3 save JSON must remain completely unpolluted by Showcase run
    const saveAfter = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(saveAfter?.profile.credits).toBe(642);
    expect(saveAfter?.profile.salvageParts).toBe(118);
    expect(saveAfter?.profile.totalRuns).toBe(7);
    expect(saveAfter?.profile.settledRunIds).toEqual(['main_run_1', 'main_run_2']);
    expect(saveAfter?.profile.campaign).toEqual(saveBefore?.profile.campaign);
    expect(saveAfter?.activeRun).toBeNull();

    monitor.assertClean(await app.inspect());
  });
});
