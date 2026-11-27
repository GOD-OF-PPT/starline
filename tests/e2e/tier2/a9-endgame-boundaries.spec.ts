import { expect, test } from '@playwright/test';
import {
  ENDING_NAMES,
  MAX_ENDLESS_THREAT,
  RUN_HISTORY_MAX_ENTRIES,
  STORAGE_KEYS,
  TEST_IDS,
  attachZeroErrorMonitors,
  createAppDriver,
  presetAct2V3,
  presetAct3ClimaxV3,
  presetBossEncounterV3,
  presetEndlessReadyV3,
  presetSettlementV3,
} from '../helpers';
import type { V3RunHistoryEntry, V3SaveData } from '../helpers';

test.describe('Tier 2 · A9: Endgame, Endless Abyss & Career Boundaries', () => {
  test('T2-A9-01 @p2-late Endless Abyss remains locked before first campaign completion and cannot launch with threat > 0', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const preClearSave = presetAct3ClimaxV3();
    preClearSave.profile.campaign.endlessUnlocked = false;
    preClearSave.profile.campaign.endingsUnlocked = [];
    preClearSave.profile.campaign.maxEndlessThreat = 0;

    await app.seedStorage({
      v2Save: preClearSave,
      skipTitleScreen: true,
    });
    await app.boot({ seed: 29001, enterStation: true });

    await app.openPrepareFromBase();
    const prepareScreen = app.byTestId(TEST_IDS.PREPARE_SCREEN);
    await expect(prepareScreen).toBeVisible();

    const endlessToggle = prepareScreen
      .locator('[data-testid="btn-mode-endless"], [data-mode="endless"], button:has-text("无尽深渊")')
      .first();
    await expect(endlessToggle).toBeVisible();
    await expect(endlessToggle).toBeDisabled();
    await expect(prepareScreen).toContainText(/通关第三幕|解锁|未解锁/);

    await app.launchExpedition();
    const snap = await app.inspect();
    expect(snap.activeRun?.endlessThreat).toBe(0);

    monitor.assertClean(snap);
  });

  test('T2-A9-02 @p2-late Endless Threat level enforces 1..10 range cap and rejects locked higher threat tiers', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const endlessSave = presetEndlessReadyV3();
    endlessSave.profile.campaign.endlessUnlocked = true;
    endlessSave.profile.campaign.maxEndlessThreat = 1;

    await app.seedStorage({
      v2Save: endlessSave,
      skipTitleScreen: true,
    });
    await app.boot({ seed: 29002, enterStation: true });
    await app.openPrepareFromBase();

    const prepareScreen = app.byTestId(TEST_IDS.PREPARE_SCREEN);
    const endlessToggle = prepareScreen
      .locator('[data-testid="btn-mode-endless"], [data-mode="endless"]')
      .or(prepareScreen.getByRole('button', { name: /无尽深渊/ }))
      .first();
    await expect(endlessToggle).toBeVisible();
    await endlessToggle.click();

    // Threat 1 must be selectable; Threat 5 (locked) must be disabled; Threat 11 (>10) must not exist or be disabled
    const threat1 = prepareScreen
      .locator('[data-testid="endless-threat-1"], [data-threat="1"]')
      .or(prepareScreen.getByRole('button', { name: /威压\s*1\b/ }))
      .first();
    await expect(threat1).toBeVisible();
    await expect(threat1).toBeEnabled();

    const threat5 = prepareScreen
      .locator('[data-testid="endless-threat-5"], [data-threat="5"]')
      .or(prepareScreen.getByRole('button', { name: /威压\s*5\b/ }))
      .first();
    await expect(threat5).toBeVisible();
    await expect(threat5).toBeDisabled();

    const outOfRange11 = prepareScreen.locator(
      '[data-testid="endless-threat-11"], [data-threat="11"]',
    );
    await expect(outOfRange11).toHaveCount(0);

    // Select valid Threat 1 and launch
    await threat1.click();
    await app.launchExpedition();

    const snap = await app.inspect();
    expect(snap.activeRun?.endlessThreat).toBe(1);
    expect(snap.activeRun?.endlessThreat ?? 0).toBeLessThanOrEqual(MAX_ENDLESS_THREAT);

    monitor.assertClean(snap);
  });

  test('T2-A9-03 @p2-late Career runHistory stays capped at 30-entry ring buffer while aggregate career counters keep incrementing', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Build 30 existing history entries (newest at index 0 -> oldest hist_run_30 at index 29)
    const existingHistory: V3RunHistoryEntry[] = Array.from(
      { length: RUN_HISTORY_MAX_ENTRIES },
      (_, idx) => ({
        runId: `hist_run_${idx + 1}`,
        finishedAt: `2026-11-${String(Math.max(1, 30 - idx)).padStart(2, '0')}T12:00:00.000Z`,
        sectorId: 'near_orbit',
        contractTemplateId: 'transport_std',
        contractName: `历史远航 #${idx + 1}`,
        shipId: 'cannon_skiff',
        crewId: 'engineer',
        outcome: 'safe_return',
        contractCompleted: true,
        maxLayerReached: 3,
        creditsEarned: 50,
        salvagePartsEarned: 5,
        endlessThreat: 0,
      }),
    );

    const settleSave = presetSettlementV3({ reason: 'safe_return', wallet: 30 });
    const incomingRunId = 'run_ring_buffer_31st';
    if (settleSave.activeRun) {
      settleSave.activeRun.runId = incomingRunId;
    }
    settleSave.profile.totalRuns = 30;
    settleSave.profile.runHistory = existingHistory;
    settleSave.profile.career.totalSafeReturns = 30;

    await app.seedStorage({
      v2Save: settleSave,
      skipTitleScreen: true,
    });
    await app.boot({ seed: 29003 });

    await app.confirmSettlement();

    const saved = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(saved?.profile.runHistory).toHaveLength(RUN_HISTORY_MAX_ENTRIES);
    expect(saved?.profile.runHistory[0]?.runId).toBe(incomingRunId);
    expect(saved?.profile.runHistory.some((h) => h.runId === 'hist_run_30')).toBe(false);
    expect(saved?.profile.career.totalSafeReturns).toBeGreaterThanOrEqual(31);
    expect(saved?.profile.totalRuns).toBeGreaterThanOrEqual(31);

    monitor.assertClean(await app.inspect());
  });

  test('T2-A9-04 @p2-late Ending gallery masks locked endings and re-completing an unlocked ending does not duplicate endingsUnlocked', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Part 1: Ending gallery with 1/3 endings unlocked masks the remaining 2
    const oneEndingSave = presetEndlessReadyV3();
    oneEndingSave.profile.campaign.endingsUnlocked = ['stargate_reignited'];

    await app.seedStorage({
      v2Save: oneEndingSave,
      skipTitleScreen: true,
    });
    await app.boot({ seed: 29004, enterStation: true });

    const careerDialog = await app.openBaseModal(TEST_IDS.BTN_OPEN_CAREER);
    const endingsTab = careerDialog
      .locator('[data-testid="career-tab-endings"], button')
      .filter({ hasText: /结局|画廊/ })
      .first();
    await expect(endingsTab).toBeVisible();
    await endingsTab.click();

    await expect(careerDialog).toContainText(ENDING_NAMES.stargate_reignited);
    await expect(careerDialog).toContainText(/未解锁|锁定|\?\?\?|1\s*\/\s*3/);
    await app.closeModal();

    // Part 2: Re-completing Act III Leviathan and choosing stargate_reignited again must NOT duplicate it
    const replayClimax = presetBossEncounterV3(3, {
      campaign: {
        ...presetAct3ClimaxV3().profile.campaign,
        endingsUnlocked: ['stargate_reignited'],
        finalMissionUnlocked: true,
        endlessUnlocked: true,
      },
    });
    replayClimax.settings.pureAutoCombat = true;
    replayClimax.settings.combatSpeed = 2;

    await app.seedStorage({
      v2Save: replayClimax,
      skipTitleScreen: true,
    });
    await app.boot({ seed: 29005 });

    await app.startCombat();
    await app.skipCombat();

    await app.waitForInspect(
      (s) => s.screen === 'ending',
      20_000,
      'ending screen reached on climax replay',
    );

    await app.selectEnding('stargate_reignited');
    await app.continueFromEnding();

    const afterBase = await app.waitForInspect(
      (s) => s.screen === 'base',
      15_000,
      'returned to base from duplicate ending',
    );

    expect(afterBase.endingsUnlocked.filter((e) => e === 'stargate_reignited')).toHaveLength(1);
    const saved = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(
      saved?.profile.campaign.endingsUnlocked.filter((e) => e === 'stargate_reignited'),
    ).toHaveLength(1);

    monitor.assertClean(afterBase);
  });

  test('T2-A9-05 @p2-late Achievement claim idempotency grants reward strictly once and stores unique achievement IDs across reload', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Seed completed milestones with achievementsUnlocked: [] so achievements are deterministically claimable
    const achSave = presetAct2V3({
      credits: 400,
      salvageParts: 50,
      totalRuns: 6,
      achievementsUnlocked: [],
      career: {
        totalWins: 5,
        totalDefeats: 1,
        totalSafeReturns: 5,
        totalCreditsEarned: 900,
        totalSalvagePartsEarned: 120,
        totalBossesDefeated: 1,
        totalWrecksDissected: 6,
        totalItemsDismantled: 4,
        deepestEndlessCleared: 0,
      },
    });

    await app.seedStorage({
      v2Save: achSave,
      skipTitleScreen: true,
    });
    await app.boot({ seed: 29006, enterStation: true });

    const careerDialog = await app.openBaseModal(TEST_IDS.BTN_OPEN_CAREER);
    const achTab = careerDialog
      .locator('[data-testid="career-tab-achievements"], button')
      .filter({ hasText: /成就|勋章/ })
      .first();
    await expect(achTab).toBeVisible();
    await achTab.click();

    // Verify full 18-achievement catalog renders inside Career modal
    const achCards = careerDialog.locator(
      '[data-testid^="achievement-card-"], .achievement-card, .v3-achievement-item',
    );
    expect(await achCards.count()).toBeGreaterThanOrEqual(18);

    // Unconditionally verify a claimable achievement button exists, double-click it, and assert single grant across reload
    const claimBtn = careerDialog
      .locator('[data-testid^="btn-claim-achievement-"]')
      .first();
    await expect(
      claimBtn,
      'Unclaimed achievement with met criteria must expose a visible 领取 button',
    ).toBeVisible();
    await expect(claimBtn).toBeEnabled();

    const achId = await claimBtn.getAttribute('data-claim-ach');
    expect(achId, 'Claim button must expose data-claim-ach ID').toBeTruthy();
    const claimLabel = await claimBtn.innerText();
    const rewardMatch = claimLabel.match(/\+(\d+)\s*¤\s*\/\s*\+(\d+)\s*零件/);
    expect(
      rewardMatch,
      `Claim button must disclose exact reward credits/parts (got "${claimLabel}")`,
    ).not.toBeNull();
    const expectedCredits = Number(rewardMatch![1]);
    const expectedParts = Number(rewardMatch![2]);

    const creditsBefore = (await app.inspect()).credits;
    const partsBefore = (await app.inspect()).salvageParts;
    await claimBtn.dblclick();

    const snapAfterClaim = await app.waitForInspect(
      (s) => s.credits === creditsBefore + expectedCredits && s.salvageParts === partsBefore + expectedParts,
      10_000,
      'achievement exact single-grant reward applied after double-click',
    );
    const creditDelta = snapAfterClaim.credits - creditsBefore;
    const partsDelta = snapAfterClaim.salvageParts - partsBefore;
    expect(creditDelta).toBe(expectedCredits);
    expect(partsDelta).toBe(expectedParts);

    // Claim button for this achievement must be removed immediately after claiming
    await expect(
      careerDialog.locator(`[data-testid="btn-claim-achievement-${achId}"]`),
    ).toHaveCount(0);

    await page.reload({ waitUntil: 'domcontentloaded' });
    const snapAfterReload = await app.waitForInspect(
      (s) => s.screen === 'base',
      30_000,
      'reloaded after achievement claim',
    );
    expect(snapAfterReload.credits).toBe(creditsBefore + expectedCredits);
    expect(snapAfterReload.salvageParts).toBe(partsBefore + expectedParts);

    const saved = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    const unlocked = saved?.profile.achievementsUnlocked ?? [];
    const claimed = saved?.profile.achievementsClaimed ?? [];
    expect(unlocked).toContain(achId);
    expect(new Set(unlocked).size).toBe(unlocked.length);
    expect(claimed.filter((id) => id === achId)).toHaveLength(1);
    expect(new Set(claimed).size).toBe(claimed.length);

    monitor.assertClean(snapAfterReload);
  });
});
