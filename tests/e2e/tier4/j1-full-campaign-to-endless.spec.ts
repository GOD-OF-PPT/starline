import { expect, test } from '@playwright/test';
import {
  BOSS_NAMES,
  ENDING_NAMES,
  STORAGE_KEYS,
  TEST_IDS,
  assertCanvasNonBlank,
  assertRootSyncedWithInspect,
  attachZeroErrorMonitors,
  createAppDriver,
  presetBossEncounterV3,
  presetFreshV3,
} from '../helpers';
import type { V3SaveData } from '../helpers';

async function resolveCombatToExit(
  app: ReturnType<typeof createAppDriver>,
): Promise<void> {
  await expect(app.byTestId(TEST_IDS.COMBAT_SCREEN)).toBeVisible();
  await app.startCombat();

  for (let step = 0; step < 5; step += 1) {
    const snap = await app.waitForInspect(
      (s) =>
        s.screen === 'ending' ||
        s.phase === 'REWARD' ||
        s.phase === 'SETTLEMENT' ||
        s.phase === 'MAP' ||
        s.activeRun?.combatWaitingDecision === true,
      20_000,
      `combat step ${step + 1}`,
    );
    if (snap.activeRun?.combatWaitingDecision) {
      const orderBtn = app
        .byTestId(TEST_IDS.COMBAT_TACTICAL_BAR)
        .locator('[data-testid^="tactical-order-"]:not([disabled])')
        .first();
      await expect(orderBtn).toBeVisible();
      await orderBtn.click();
    } else {
      break;
    }
  }
}

async function resolveCurrentNodeToMapOrSettlement(
  app: ReturnType<typeof createAppDriver>,
  page: import('@playwright/test').Page,
): Promise<void> {
  for (let guard = 0; guard < 8; guard += 1) {
    const snap = await app.inspect();
    if (snap.phase === 'MAP' || snap.phase === 'SETTLEMENT' || snap.screen === 'ending') {
      return;
    }
    if (snap.phase === 'ENCOUNTER') {
      if (await app.byTestId(TEST_IDS.COMBAT_SCREEN).isVisible()) {
        await resolveCombatToExit(app);
      } else if (await app.byTestId(TEST_IDS.WRECK_SCREEN).isVisible()) {
        const cutBtn = page.locator('[data-testid^="wreck-cut-"]:not([disabled])').first();
        await expect(cutBtn).toBeVisible();
        await cutBtn.click();
        const afterCutSnap = await app.waitForInspect(
          (s) => s.phase !== 'ENCOUNTER' || s.activeRun?.wreckStability !== null,
          10_000,
          'wreck cut progressed',
        );
        if (
          afterCutSnap.phase === 'ENCOUNTER' &&
          (await app.byTestId(TEST_IDS.BTN_WRECK_EXTRACT).isVisible())
        ) {
          await app.extractWreck();
        }
      } else if (await app.byTestId(TEST_IDS.EVENT_SCREEN).isVisible()) {
        const choiceBtn = page.locator('[data-testid^="event-choice-"]:not([disabled])').first();
        await expect(choiceBtn).toBeVisible();
        await choiceBtn.click();
      }
    } else if (snap.phase === 'REWARD') {
      const rewardChoice = app
        .byTestId(TEST_IDS.REWARD_SCREEN)
        .locator('button[data-pick-reward], .v2-reward-card, [data-testid^="reward-choice-"], button:not([disabled])')
        .first();
      await expect(rewardChoice).toBeVisible();
      await rewardChoice.click();
    } else if (snap.phase === 'SHOP') {
      const shopScreen = app.byTestId(TEST_IDS.SHOP_SCREEN);
      const leaveShop = shopScreen
        .locator('#v2-shop-finish')
        .or(shopScreen.getByRole('button', { name: /完成交易|离开|返回星图|继续/ }))
        .first();
      await expect(leaveShop).toBeVisible();
      await leaveShop.click();
    } else if (snap.phase === 'ARRANGE') {
      const arrangeScreen = app.byTestId(TEST_IDS.ARRANGE_SCREEN);
      const leaveBtn = app.byTestId(TEST_IDS.BTN_LEAVE_ARRANGE);
      // Select staging card first so live CargoGridV2 renders #btn-v2-discard, resolving any spatial conflict cleanly
      const stagingCards = page.locator(
        '.v2-staging-card, .staging-card, [data-testid^="staging-item"]',
      );
      let discardGuard = 0;
      while (!(await leaveBtn.isEnabled()) && (await stagingCards.count()) > 0 && discardGuard < 6) {
        await stagingCards.first().click();
        const discardBtn = arrangeScreen
          .locator('#btn-v2-discard, [data-testid^="btn-discard-"], button:has-text("舍弃"), button:has-text("丢弃")')
          .first();
        if (await discardBtn.isVisible()) {
          await discardBtn.click();
        } else {
          await app.gridCell(0, 0).click();
        }
        discardGuard += 1;
      }
      await app.leaveArrange();
    }
  }
}

test.describe('Tier 4 · J1: Full Campaign Spine to Endless Abyss', () => {
  test('T4-01 Complete campaign spine: Fresh Launch -> Tutorial -> Act I -> Act II -> Act III Leviathan -> Ending -> Endless Abyss', async ({
    page,
  }) => {
    test.slow();
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // =========================================================================
    // Stage 1: Fresh Launch -> Title -> Base -> 3-Layer Tutorial -> Act I Unlock
    // =========================================================================
    await app.seedStorage({ v2Save: presetFreshV3(), skipTitleScreen: false });
    await app.boot({ seed: 20261 });

    await expect(app.byTestId(TEST_IDS.TITLE_SCREEN)).toBeVisible();
    await assertCanvasNonBlank(page);
    await app.enterStation();

    const freshBase = await app.inspect();
    expect(freshBase.campaignAct).toBe('prologue');
    await assertRootSyncedWithInspect(page, freshBase);

    // Launch 3-layer tutorial expedition
    const startTutBtn = app.byTestId(TEST_IDS.BTN_START_TUTORIAL);
    await expect(startTutBtn).toBeVisible();
    await startTutBtn.click();
    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();

    // Traverse tutorial nodes L1 -> L2 -> L3
    for (let layerStep = 0; layerStep < 4; layerStep += 1) {
      const snap = await app.inspect();
      if (snap.phase === 'SETTLEMENT') break;
      const reachableNode = page
        .locator('[data-testid^="map-node-"][data-reachable="true"], [data-testid^="map-node-"]:not([disabled])')
        .first();
      if (await reachableNode.isVisible()) {
        await reachableNode.click();
        const jumpBtn = app.byTestId(TEST_IDS.BTN_JUMP_NODE);
        if (await jumpBtn.isEnabled()) {
          await jumpBtn.click();
          await resolveCurrentNodeToMapOrSettlement(app, page);
        } else {
          break;
        }
      } else {
        break;
      }
    }

    if ((await app.inspect()).phase === 'MAP') {
      await app.safeReturn();
    }
    await expect(app.byTestId(TEST_IDS.SETTLEMENT_SCREEN)).toBeVisible();
    await app.confirmSettlement();

    const postTutSave = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(postTutSave?.profile.tutorialCompleted).toBe(true);
    expect(postTutSave?.profile.buildings.workbench).toBe(true);
    expect(postTutSave?.profile.buildings.contract_hub).toBe(true);
    expect(postTutSave?.profile.campaign.currentAct).toBe('act1');

    // =========================================================================
    // Stage 2: Act I Boss (铁砧号) -> Sector 2 Unlock -> Act II Boss (铁壁无畏) -> Sector 3 Unlock
    // =========================================================================
    const act1BossSave = presetBossEncounterV3(1);
    await app.seedStorage({ v2Save: act1BossSave, skipTitleScreen: true });
    await app.boot({ seed: 20262 });
    await expect(app.byTestId(TEST_IDS.COMBAT_SCREEN)).toContainText(BOSS_NAMES.act1);
    expect((await app.inspect()).bgmTrack).toBe('boss');

    await resolveCombatToExit(app);
    await resolveCurrentNodeToMapOrSettlement(app, page);
    if ((await app.inspect()).phase === 'MAP') {
      await app.safeReturn();
    }
    await app.confirmSettlement();

    const postAct1Save = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(postAct1Save?.profile.campaign.defeatedBossIds).toContain('boss_anvil');
    expect(postAct1Save?.profile.campaign.unlockedSectors).toContain('frozen_graveyard');

    // Act II Boss (铁壁无畏) on frozen_graveyard
    const act2BossSave = presetBossEncounterV3(2);
    await app.seedStorage({ v2Save: act2BossSave, skipTitleScreen: true });
    await app.boot({ seed: 20263 });
    await expect(app.byTestId(TEST_IDS.COMBAT_SCREEN)).toContainText(BOSS_NAMES.act2);
    expect((await app.inspect()).bgmTrack).toBe('boss');

    await resolveCombatToExit(app);
    await resolveCurrentNodeToMapOrSettlement(app, page);
    if ((await app.inspect()).phase === 'MAP') {
      await app.safeReturn();
    }
    await app.confirmSettlement();

    const postAct2Save = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(postAct2Save?.profile.campaign.defeatedBossIds).toContain('boss_dreadnought');
    expect(postAct2Save?.profile.campaign.unlockedSectors).toContain('stargate_abyss');

    // =========================================================================
    // Stage 3: Act III Climax (黑曜利维坦) -> Ending Ceremony -> Base -> Endless Abyss (威压 1)
    // =========================================================================
    const act3ClimaxSave = presetBossEncounterV3(3);
    await app.seedStorage({ v2Save: act3ClimaxSave, skipTitleScreen: true });
    await app.boot({ seed: 20264 });

    await expect(app.byTestId(TEST_IDS.COMBAT_SCREEN)).toContainText(BOSS_NAMES.act3);
    const climaxSnap = await app.inspect();
    expect(climaxSnap.bgmTrack).toBe('boss');
    expect(climaxSnap.activeRun?.isFinalCampaignRun).toBe(true);

    await resolveCombatToExit(app);

    const endingScreen = app.byTestId(TEST_IDS.ENDING_SCREEN);
    await expect(endingScreen).toBeVisible({ timeout: 20_000 });
    await app.selectEnding('stargate_reignited');
    await expect(endingScreen).toContainText(ENDING_NAMES.stargate_reignited);
    await app.continueFromEnding();

    const postEndingBase = await app.waitForInspect(
      (s) => s.screen === 'base' && s.campaignAct === 'endless',
      15_000,
      'non-destructive return to base in endless post-game',
    );
    expect(postEndingBase.endingsUnlocked).toContain('stargate_reignited');

    // Launch Endless Abyss Threat 1 from Prepare
    await app.openPrepareFromBase();
    const endlessToggle = page
      .getByRole('button', { name: /无尽深渊|无尽模式|威压/ })
      .first();
    await expect(endlessToggle).toBeVisible();
    await endlessToggle.click();
    await app.launchExpedition();

    const endlessMapSnap = await app.waitForInspect(
      (s) => s.phase === 'MAP' && (s.activeRun?.endlessThreat ?? 0) >= 1,
      15_000,
      'Endless Abyss Threat 1 active on Map',
    );
    expect(endlessMapSnap.activeRun?.endlessThreat).toBeGreaterThanOrEqual(1);

    monitor.assertClean(endlessMapSnap);
  });
});
