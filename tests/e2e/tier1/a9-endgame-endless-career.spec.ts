import { expect, test } from '@playwright/test';
import {
  ENDING_NAMES,
  STORAGE_KEYS,
  TEST_IDS,
  attachZeroErrorMonitors,
  createAppDriver,
  presetAct3ClimaxV3,
  presetBossEncounterV3,
  presetEndlessReadyV3,
} from '../helpers';
import type { V3SaveData } from '../helpers';

test.describe('Tier 1 · A9: Act III Climax, 3 Endings, Endless Abyss & Career Archive', () => {
  test('T1-A9-01 @p2-late Act III Climax mission (星门重启远征) launches with isFinalCampaignRun flag on stargate_abyss', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({ v2Save: presetAct3ClimaxV3(), skipTitleScreen: true });
    await app.boot({ seed: 9001, enterStation: true });

    await app.openPrepareFromBase();
    const finalMissionBtn = page
      .getByRole('button', { name: /星门重启远征|决战|终章远征/ })
      .first();
    await expect(finalMissionBtn).toBeVisible();
    await finalMissionBtn.click();

    await app.launchExpedition();

    const snap = await app.waitForInspect(
      (s) => s.phase === 'MAP' && s.activeRun?.isFinalCampaignRun === true,
      15_000,
      'final campaign mission launched',
    );
    expect(snap.activeRun?.sectorId).toBe('stargate_abyss');
    expect((await app.getRootAttributes()).sector).toBe('stargate_abyss');

    monitor.assertClean(snap);
  });

  test('T1-A9-02 @p2-late Climax victory opens Ending choice, unlocks Endless Abyss, and returns non-destructively to Base', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const climaxSave = presetBossEncounterV3(3, { credits: 1450, salvageParts: 260 });
    climaxSave.settings.pureAutoCombat = true;

    await app.seedStorage({ v2Save: climaxSave, skipTitleScreen: true });
    await app.boot({ seed: 9002 });

    await expect(app.byTestId(TEST_IDS.COMBAT_SCREEN)).toBeVisible();
    await app.startCombat();
    await app.skipCombat();

    await expect(app.byTestId(TEST_IDS.ENDING_SCREEN)).toBeVisible({ timeout: 20_000 });
    await app.selectEnding('stargate_reignited');
    await expect(app.byTestId(TEST_IDS.ENDING_SCREEN)).toContainText(
      ENDING_NAMES.stargate_reignited,
    );

    await app.continueFromEnding();
    await expect(app.byTestId(TEST_IDS.BASE_SCREEN)).toBeVisible();

    const baseSnap = await app.waitForInspect(
      (s) => s.screen === 'base' && s.endingsUnlocked.includes('stargate_reignited'),
      15_000,
      'ending persisted on base return',
    );
    expect(baseSnap.campaignAct).toBe('endless');
    expect(baseSnap.credits).toBeGreaterThanOrEqual(1450);
    expect(baseSnap.salvageParts).toBeGreaterThanOrEqual(260);

    const stored = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(stored?.profile.campaign.endlessUnlocked).toBe(true);

    monitor.assertClean(baseSnap);
  });

  test('T1-A9-03 @p2-late Endless Abyss (威压 1-10) activates mutators and supports deterministic seeded launch', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({ v2Save: presetEndlessReadyV3(), skipTitleScreen: true });
    await app.boot({ seed: 9003, enterStation: true });
    await app.openPrepareFromBase();

    const endlessToggle = page
      .getByRole('button', { name: /无尽深渊|威压|无尽模式/ })
      .first();
    await expect(endlessToggle).toBeVisible();
    await endlessToggle.click();

    await expect(app.byTestId(TEST_IDS.PREPARE_SCREEN)).toContainText(/威压|词条|突变/);
    await app.launchExpedition();

    const snap = await app.waitForInspect(
      (s) => s.phase === 'MAP' && (s.activeRun?.endlessThreat ?? 0) >= 1,
      15_000,
      'endless abyss launched with threat >= 1',
    );
    expect(snap.activeRun?.endlessThreat).toBeGreaterThanOrEqual(1);
    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toContainText(/威压|词条/);

    monitor.assertClean(snap);
  });

  test('T1-A9-04 @p1-mid Career Ledger displays aggregate career statistics and 30-run history log', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const save = presetEndlessReadyV3({
      runHistory: [
        {
          runId: 'hist_1',
          finishedAt: '2026-11-22T12:00:00.000Z',
          sectorId: 'stargate_abyss',
          contractTemplateId: 'bounty_std',
          contractName: '星门重启远征',
          shipId: 'stargate_cruiser',
          crewId: 'engineer',
          outcome: 'safe_return',
          contractCompleted: true,
          maxLayerReached: 6,
          creditsEarned: 320,
          salvagePartsEarned: 45,
          endlessThreat: 0,
          isFinalCampaignRun: true,
        },
      ],
    });

    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 9004, enterStation: true });

    const modal = await app.openBaseModal(TEST_IDS.BTN_OPEN_CAREER);
    await expect(modal).toContainText(/星门重启远征/);
    await expect(modal).toContainText(/2400|380|胜|远航/);

    await app.closeModal();
    monitor.assertClean(await app.inspect());
  });

  test('T1-A9-05 @p1-mid Career & Codex expose Enemy Bestiary, Boss Dossier, Story Archive, Ending Gallery & 18 Achievements', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({ v2Save: presetEndlessReadyV3(), skipTitleScreen: true });
    await app.boot({ seed: 9005, enterStation: true });

    const modal = await app.openBaseModal(TEST_IDS.BTN_OPEN_CAREER);

    const achievementsTab = modal.getByRole('button', { name: /成就|勋章/ }).first();
    await expect(achievementsTab).toBeVisible();
    await achievementsTab.click();
    await expect(modal).toContainText(/18|成就|解锁/);

    const bestiaryTab = modal.getByRole('button', { name: /图鉴|敌舰|首领档案|怪物/ }).first();
    await expect(bestiaryTab).toBeVisible();
    await bestiaryTab.click();
    await expect(modal).toContainText(/铁砧号|铁壁无畏|黑曜利维坦/);

    const endingsTab = modal.getByRole('button', { name: /结局|回廊/ }).first();
    await expect(endingsTab).toBeVisible();
    await endingsTab.click();
    await expect(modal).toContainText(ENDING_NAMES.stargate_reignited);

    await app.closeModal();
    monitor.assertClean(await app.inspect());
  });
});
