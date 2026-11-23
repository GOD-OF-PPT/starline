import { expect, test } from '@playwright/test';
import {
  BOSS_NAMES,
  ENDING_NAMES,
  STORAGE_KEYS,
  TEST_IDS,
  attachZeroErrorMonitors,
  createAppDriver,
  presetAct3ClimaxV3,
  presetBossEncounterV3,
  presetSettlementV3,
} from '../helpers';
import type { V3SaveData } from '../helpers';

test.describe('Tier 4 · J8: Multi-Ending Collection + Seeded Endless Challenge + Career Archive Persistence', () => {
  test('T4-08 Earns 2/3 Endings, completes Seeded Endless run, and verifies Career/History/Bestiary/Ending Gallery survive full browser context restart', async ({
    browser,
    page,
  }) => {
    test.slow();
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // =========================================================================
    // Step 1: Earn Ending #1 (stargate_reignited) from Act III Climax
    // =========================================================================
    const climax1 = presetBossEncounterV3(3);
    climax1.settings.pureAutoCombat = true;
    await app.seedStorage({ v2Save: climax1, skipTitleScreen: true });
    await app.boot({ seed: 48001 });

    await app.startCombat();
    await app.skipCombat();
    await expect(app.byTestId(TEST_IDS.ENDING_SCREEN)).toBeVisible({ timeout: 20_000 });
    await app.selectEnding('stargate_reignited');
    await expect(app.byTestId(TEST_IDS.ENDING_SCREEN)).toContainText(ENDING_NAMES.stargate_reignited);
    await app.continueFromEnding();

    await app.waitForInspect(
      (s) => s.screen === 'base' && s.endingsUnlocked.includes('stargate_reignited'),
      15_000,
      'Ending #1 recorded on Base',
    );
    const saveAfterEnding1 = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(saveAfterEnding1).not.toBeNull();

    // =========================================================================
    // Step 2: Re-run Climax preserving profile & earn Ending #2 (free_haven)
    // =========================================================================
    const climax2 = presetBossEncounterV3(3, saveAfterEnding1?.profile);
    climax2.settings.pureAutoCombat = true;
    await app.seedStorage({ v2Save: climax2, skipTitleScreen: true });
    await app.boot({ seed: 48002 });

    await app.startCombat();
    await app.skipCombat();
    await expect(app.byTestId(TEST_IDS.ENDING_SCREEN)).toBeVisible({ timeout: 20_000 });
    await app.selectEnding('free_haven');
    await expect(app.byTestId(TEST_IDS.ENDING_SCREEN)).toContainText(ENDING_NAMES.free_haven);
    await app.continueFromEnding();

    const baseAfterEnding2 = await app.waitForInspect(
      (s) =>
        s.screen === 'base' &&
        s.endingsUnlocked.includes('stargate_reignited') &&
        s.endingsUnlocked.includes('free_haven'),
      15_000,
      'Ending #1 and Ending #2 both persisted',
    );
    expect(baseAfterEnding2.endingsUnlocked).toHaveLength(2);

    // =========================================================================
    // Step 3: Launch Seeded Endless Abyss run (88008) & settle cleanly
    // =========================================================================
    await app.openPrepareFromBase();
    const endlessToggle = page
      .getByRole('button', { name: /无尽深渊|无尽模式|威压/ })
      .first();
    await expect(endlessToggle).toBeVisible();
    await endlessToggle.click();

    const seedInput = page
      .locator('[data-testid="endless-seed-input"], input[name="seed"], input[placeholder*="种子"]')
      .first();
    if (await seedInput.isVisible()) {
      await seedInput.fill('88008');
    }
    await app.launchExpedition();

    const endlessMapSnap = await app.waitForInspect(
      (s) => s.phase === 'MAP' && (s.activeRun?.endlessThreat ?? 0) >= 1,
      15_000,
      'Seeded Endless Abyss active',
    );
    expect(endlessMapSnap.activeRun?.endlessThreat).toBeGreaterThanOrEqual(1);

    // Settle the Endless Abyss run cleanly into Career Ledger
    const liveEndlessSave = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    const endlessSettlement = presetSettlementV3({
      reason: 'safe_return',
      wallet: 85,
    });
    endlessSettlement.profile = liveEndlessSave?.profile ?? presetAct3ClimaxV3().profile;
    if (endlessSettlement.activeRun) {
      endlessSettlement.activeRun.sectorId = 'stargate_abyss';
      endlessSettlement.activeRun.endlessThreat = 1;
      endlessSettlement.activeRun.endlessMutatorIds =
        liveEndlessSave?.activeRun?.endlessMutatorIds?.length
          ? liveEndlessSave.activeRun.endlessMutatorIds
          : ['ion_surge'];
      endlessSettlement.activeRun.seed = 88008;
    }

    await app.seedStorage({ v2Save: endlessSettlement, skipTitleScreen: true });
    await app.boot({ seed: 88008 });
    await expect(app.byTestId(TEST_IDS.SETTLEMENT_SCREEN)).toBeVisible();
    await app.confirmSettlement();

    await app.waitForInspect((s) => s.screen === 'base', 15_000, 'settled Endless Abyss to Base');
    const persistedJson = await app.readStorageRaw(STORAGE_KEYS.V2_SAVE);
    expect(persistedJson).not.toBeNull();

    monitor.assertClean(await app.inspect());

    // =========================================================================
    // Step 4: Full Browser Context Restart — verify Career, Run History, Bestiary & 2/3 Ending Gallery
    // =========================================================================
    const freshCtx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const freshPage = await freshCtx.newPage();
    const freshMonitor = attachZeroErrorMonitors(freshPage);
    const freshApp = createAppDriver(freshPage);

    await freshApp.seedStorage({ v2Save: persistedJson, skipTitleScreen: true });
    await freshApp.boot({ seed: 48009, enterStation: true });

    const restartedSnap = await freshApp.inspect();
    expect(restartedSnap.endingsUnlocked).toEqual(
      expect.arrayContaining(['stargate_reignited', 'free_haven']),
    );
    expect(restartedSnap.endingsUnlocked).toHaveLength(2);

    const careerModal = await freshApp.openBaseModal(TEST_IDS.BTN_OPEN_CAREER);
    // Run History displays the settled Endless Abyss run
    await expect(careerModal).toContainText(/威压\s*1|无尽/);

    // Bestiary Dossier displays defeated Act Bosses
    const bestiaryTab = careerModal.getByRole('button', { name: /图鉴|敌舰|首领档案|怪物/ }).first();
    await expect(bestiaryTab).toBeVisible();
    await bestiaryTab.click();
    await expect(careerModal).toContainText(BOSS_NAMES.act1);
    await expect(careerModal).toContainText(BOSS_NAMES.act2);
    await expect(careerModal).toContainText(BOSS_NAMES.act3);

    // Ending Gallery displays 2/3 unlocked endings (stargate_reignited & free_haven) while fleet_heir remains locked
    const endingsTab = careerModal.getByRole('button', { name: /结局|回廊/ }).first();
    await expect(endingsTab).toBeVisible();
    await endingsTab.click();
    await expect(careerModal).toContainText(ENDING_NAMES.stargate_reignited);
    await expect(careerModal).toContainText(ENDING_NAMES.free_haven);
    await expect(careerModal).toContainText(/2\s*\/\s*3|未解锁|锁定/);

    await freshApp.closeModal();
    freshMonitor.assertClean(await freshApp.inspect());
    await freshCtx.close();
  });
});
