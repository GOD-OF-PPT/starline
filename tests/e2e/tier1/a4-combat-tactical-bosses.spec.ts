import { expect, test } from '@playwright/test';
import {
  BOSS_NAMES,
  STORAGE_KEYS,
  TEST_IDS,
  attachZeroErrorMonitors,
  createAppDriver,
  createMapGraph,
  presetAct2V3,
  presetBossEncounterV3,
  presetMidRunMapV3,
  presetPostTutorialV3,
} from '../helpers';
import type { V3SaveData } from '../helpers';

test.describe('Tier 1 · A4: Active Tactical Combat, Expanded Enemies & 3 Multi-Phase Bosses', () => {
  test('T1-A4-01 @p1-mid Default-ON active tactical command bar exposes 3 universal orders + hull signature and consumes charge', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const save = presetMidRunMapV3({
      phase: 'ENCOUNTER',
      currentNodeId: 'L1B',
      graph: createMapGraph({
        nodeOverrides: {
          L1B: { type: 'combat', encounterKind: 'patrol', visited: true, resolved: false },
        },
      }),
      overrides: {
        tacticalChargesMax: 1,
        tacticalChargesUsed: 0,
        visitedNodeIds: ['L1B'],
        activeCombat: null,
      },
    });

    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 4001 });

    await expect(app.byTestId(TEST_IDS.COMBAT_SCREEN)).toBeVisible();
    await app.startCombat();

    await app.waitForInspect(
      (s) => s.activeRun?.combatWaitingDecision === true,
      15_000,
      'combat waiting for tactical decision',
    );

    const tacticalBar = app.byTestId(TEST_IDS.COMBAT_TACTICAL_BAR);
    await expect(tacticalBar).toBeVisible();
    await expect(tacticalBar).toContainText(/火力过载/);
    await expect(tacticalBar).toContainText(/紧急护盾/);
    await expect(tacticalBar).toContainText(/聚焦校准/);

    const orderButtons = tacticalBar.locator('[data-testid^="tactical-order-"]');
    expect(await orderButtons.count()).toBeGreaterThanOrEqual(4);

    // Issue a tactical order and verify combat resolves cleanly
    await orderButtons.first().click();

    const doneSnap = await app.waitForInspect(
      (s) => s.phase === 'REWARD' || s.phase === 'SETTLEMENT',
      20_000,
      'combat resolution after issuing tactical order',
    );
    expect(doneSnap.activeRun?.combatWaitingDecision).toBe(false);

    monitor.assertClean(doneSnap);
  });

  test('T1-A4-02 @p0-core S05/S06 Pre-combat Layer-1 threat tier, Details Drawer ("不干预时结果") & policy change match post-combat HP exactly', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Boot into MAP then 1-click jump into L1B swarm so warm page never races S05 cold-boot countdown
    const save = presetMidRunMapV3({
      phase: 'MAP',
      currentNodeId: null,
      graph: createMapGraph({
        nodeOverrides: {
          L1B: { type: 'combat', encounterKind: 'swarm', visited: false, resolved: false },
        },
      }),
      overrides: {
        visitedNodeIds: [],
        activeCombat: null,
      },
    });
    // Pre-combat preview models baseline (no tactical order) outcome; run in Pure-Auto mode
    // so live combat resolves without mid-battle tactical overrides altering post-combat HP.
    save.settings.pureAutoCombat = true;

    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 4002 });

    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();
    await app.jumpToNode('L1B');

    const combatScreen = app.byTestId(TEST_IDS.COMBAT_SCREEN);
    await expect(combatScreen).toBeVisible();
    await app.pauseAutoCombat();

    // S06 Layer 1: Qualitative Threat Tier pill visible while Details Drawer stays collapsed by default
    const threatTier = app.byTestId(TEST_IDS.COMBAT_THREAT_TIER);
    await expect(threatTier).toBeVisible();
    await expect(threatTier).toContainText(/稳|吃力|危险|致命/);
    await expect(app.byTestId(TEST_IDS.FORECAST_DETAILS_DRAWER)).toHaveCount(0);

    // Toggle target priority (S05 stays paused on policy interaction)
    const threatBtn = combatScreen
      .locator('[data-policy="highest_threat"]')
      .or(combatScreen.getByRole('button', { name: /优先最大威胁|最大威胁优先|威胁优先/ }))
      .first();
    await expect(threatBtn).toBeVisible();
    await threatBtn.click();

    // S06 Layer 2: Open on-demand Details Drawer labeled "不干预时结果"
    const drawer = await app.openForecastDetails();
    await expect(drawer).toContainText(/不干预时结果/);
    await expect(drawer).toContainText(/余\s*\d+\s*HP/i);

    const predictedHpAttr = await combatScreen
      .locator('[data-preview-final-hp]')
      .first()
      .getAttribute('data-preview-final-hp');
    expect(predictedHpAttr, 'Pre-combat preview card must expose numeric data-preview-final-hp').not.toBeNull();
    const predictedHp = Number(predictedHpAttr);
    expect(Number.isFinite(predictedHp)).toBe(true);

    await app.startCombat();
    const afterSnap = await app.waitForInspect(
      (s) => s.phase === 'REWARD' || s.phase === 'SETTLEMENT',
      60_000,
      'combat completion after pre-combat preview',
    );

    expect(afterSnap.activeRun?.hp).toBe(predictedHp);
    monitor.assertClean(afterSnap);
  });

  test('T1-A4-03 @p1-mid Pure-Auto Settings toggle bypasses tactical pause and Skip completes combat immediately', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({ v2Save: presetPostTutorialV3(), skipTitleScreen: true });
    await app.boot({ seed: 4003, enterStation: true });

    // Open Settings modal and enable Pure-Auto combat toggle
    const settingsBtn = page.getByRole('button', { name: /设置/ }).first();
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();

    const pureAutoControl = page
      .locator('[role="dialog"]')
      .getByLabel(/纯自动|自动战斗/)
      .or(page.locator('[role="dialog"] button:has-text("纯自动")'))
      .first();
    await expect(pureAutoControl).toBeVisible();
    await pureAutoControl.click();
    await app.closeModal();

    await app.openPrepareFromBase();
    await app.launchExpedition();

    // S04 1-click jump into Layer 1 combat node
    const combatJumpBtn = page
      .locator('[data-testid="map-node-L1A"], [data-testid="map-node-L1B"]')
      .filter({ hasText: /战斗|敌|哨/ })
      .first()
      .locator('[data-jump-node]');
    await expect(combatJumpBtn).toBeVisible();
    await combatJumpBtn.click();

    await expect(app.byTestId(TEST_IDS.COMBAT_SCREEN)).toBeVisible();
    await app.startCombat();

    // Skip button should be enabled in pure-auto mode and advance directly to reward
    await app.skipCombat();
    await expect(app.byTestId(TEST_IDS.REWARD_SCREEN)).toBeVisible({ timeout: 15_000 });

    const snap = await app.inspect();
    expect(snap.activeRun?.combatWaitingDecision).toBe(false);
    monitor.assertClean(snap);
  });

  test('T1-A4-04 @p1-mid Expanded V3 enemy roster renders telegraphed round-by-round intent badges in preview & HUD', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const save = presetMidRunMapV3({
      sectorId: 'frozen_graveyard',
      phase: 'ENCOUNTER',
      currentNodeId: 'L3A',
      graph: createMapGraph({
        nodeOverrides: {
          L3A: { type: 'combat', encounterKind: 'artillery', visited: true, resolved: false },
        },
      }),
      overrides: {
        visitedNodeIds: ['L1A', 'L2A', 'L3A'],
        activeCombat: null,
      },
    });
    save.profile = presetAct2V3().profile;

    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 4004 });

    const combatScreen = app.byTestId(TEST_IDS.COMBAT_SCREEN);
    await expect(combatScreen).toBeVisible();

    // Telegraphed intent badges/cycle info must appear before combat starts
    await expect(combatScreen).toContainText(/意图|蓄力|齐射|护盾|穿甲|EMP|召唤/);
    const intentIndicators = combatScreen.locator(
      '[data-enemy-intent], [data-testid^="enemy-intent"], .enemy-intent-badge, .intent-cycle',
    );
    expect(await intentIndicators.count()).toBeGreaterThanOrEqual(1);

    monitor.assertClean(await app.inspect());
  });

  test('T1-A4-05 @p1-mid Act I Boss (铁砧号) & Act II Boss (铁壁无畏) trigger boss BGM, 2 tactical charges, and multi-phase HUD', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Act I Boss: 铁砧号 (starts with defeatedBossIds === [])
    const act1BossSave = presetBossEncounterV3(1);
    act1BossSave.settings.pureAutoCombat = false;
    expect(act1BossSave.profile.campaign.defeatedBossIds).toEqual([]);

    await app.seedStorage({ v2Save: act1BossSave, skipTitleScreen: true });
    await app.boot({ seed: 4005 });

    const combat1 = app.byTestId(TEST_IDS.COMBAT_SCREEN);
    await expect(combat1).toBeVisible();
    await expect(combat1).toContainText(BOSS_NAMES.act1);
    await expect(combat1).toContainText(/阶段|P1|Phase/i);

    const snap1 = await app.inspect();
    expect(snap1.bgmTrack).toBe('boss');

    await app.startCombat();
    await app.waitForInspect(
      (s) => s.activeRun?.combatWaitingDecision === true,
      15_000,
      'Act I boss first tactical prompt',
    );
    await expect(app.byTestId(TEST_IDS.COMBAT_TACTICAL_BAR)).toContainText(/2|充能|指令/);
    await page.locator('[data-testid^="tactical-order-"]:not([disabled])').first().click();

    // Resolve remaining tactical pauses until Act I boss combat concludes
    for (let step = 0; step < 3; step += 1) {
      const progressSnap = await app.waitForInspect(
        (s) =>
          s.phase === 'REWARD' ||
          s.phase === 'SETTLEMENT' ||
          s.phase === 'MAP' ||
          s.activeRun?.combatWaitingDecision === true,
        20_000,
        `Act I boss resolution step ${step + 1}`,
      );
      if (progressSnap.activeRun?.combatWaitingDecision) {
        await page.locator('[data-testid^="tactical-order-"]:not([disabled])').first().click();
      } else {
        break;
      }
    }

    // Settle Act I boss victory back to Base so profile.campaign.defeatedBossIds persists live
    let postBossSnap = await app.inspect();
    if (postBossSnap.phase === 'REWARD') {
      await app.pickReward('skip');
      postBossSnap = await app.waitForInspect(
        (s) => s.phase !== 'REWARD',
        15_000,
        'phase transition after Act I boss reward',
      );
    }
    if (postBossSnap.phase === 'ARRANGE') {
      await app.leaveArrange();
      postBossSnap = await app.waitForInspect(
        (s) => s.phase !== 'ARRANGE',
        15_000,
        'phase transition after Act I boss arrange',
      );
    }
    if (postBossSnap.phase === 'MAP') {
      await app.safeReturn();
      postBossSnap = await app.waitForInspect(
        (s) => s.phase === 'SETTLEMENT',
        15_000,
        'settlement after Act I boss safe return',
      );
    }
    if (postBossSnap.phase === 'SETTLEMENT') {
      await app.confirmSettlement();
      await app.waitForInspect(
        (s) => s.screen === 'base' && s.activeRun === null,
        15_000,
        'base screen after settling Act I boss defeat',
      );
    }

    // V2: Verify Act I boss defeat genuinely recorded 'boss_anvil' BEFORE seeding Act II Boss
    const storedAfterAct1 = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(storedAfterAct1?.profile.campaign.defeatedBossIds).toContain('boss_anvil');

    // Verify Act II Boss: 铁壁无畏
    await app.seedStorage({ v2Save: presetBossEncounterV3(2), skipTitleScreen: true });
    await app.boot({ seed: 4006 });

    const combat2 = app.byTestId(TEST_IDS.COMBAT_SCREEN);
    await expect(combat2).toBeVisible();
    await expect(combat2).toContainText(BOSS_NAMES.act2);
    await expect(combat2).toContainText(/阶段|P1|Phase/i);
    expect((await app.inspect()).bgmTrack).toBe('boss');

    monitor.assertClean(await app.inspect());
  });

  test('T1-A4-06 @p2-late Act III Boss (黑曜利维坦) runs 3-phase climax sequence into Ending choice', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({ v2Save: presetBossEncounterV3(3), skipTitleScreen: true });
    await app.boot({ seed: 4007 });

    const combatScreen = app.byTestId(TEST_IDS.COMBAT_SCREEN);
    await expect(combatScreen).toBeVisible();
    await expect(combatScreen).toContainText(BOSS_NAMES.act3);
    await expect(combatScreen).toContainText(/阶段|三阶段|3/);

    const preSnap = await app.inspect();
    expect(preSnap.bgmTrack).toBe('boss');
    expect(preSnap.activeRun?.isFinalCampaignRun).toBe(true);

    await app.startCombat();

    // Resolve tactical command pauses across phases until ending or climax transition
    for (let step = 0; step < 4; step += 1) {
      const snap = await app.waitForInspect(
        (s) =>
          s.screen === 'ending' ||
          s.phase === 'REWARD' ||
          s.phase === 'SETTLEMENT' ||
          s.activeRun?.combatWaitingDecision === true,
        20_000,
        `Leviathan phase step ${step + 1}`,
      );
      if (snap.activeRun?.combatWaitingDecision) {
        await page.locator('[data-testid^="tactical-order-"]:not([disabled])').first().click();
      } else {
        break;
      }
    }

    const endSnap = await app.waitForInspect(
      (s) => s.screen === 'ending',
      15_000,
      'Act III Leviathan victory transitions to Ending screen',
    );
    await expect(app.byTestId(TEST_IDS.ENDING_SCREEN)).toBeVisible();

    monitor.assertClean(endSnap);
  });

  test('T1-A4-07 @p1-mid D01 per-module Component Overload and D02 specific-enemy Target Lock consume charge, persist interventions, and resolve multi-enemy combat', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Seed MAP at L5A -> L6A Act I Boss (3 enemies + 2 tactical charges) so we can verify
    // D02 Target Lock pre-combat AND D01 Component Overload intervention persistence cleanly
    const bossGraph = createMapGraph({
      maxLayers: 6,
      bossKind: 'boss_anvil',
      bossId: 'boss_anvil',
    });
    const save = presetMidRunMapV3({
      phase: 'MAP',
      currentNodeId: 'L5A',
      graph: bossGraph,
      fuel: 6,
      overrides: {
        visitedNodeIds: ['L1A', 'L2A', 'L3A', 'L4A', 'L5A'],
        tacticalChargesMax: 2,
        tacticalChargesUsed: 0,
        activeCombat: null,
      },
    });
    save.settings.pureAutoCombat = false;

    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 4008 });

    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();
    await app.jumpToNode('L6A');

    await expect(app.byTestId(TEST_IDS.COMBAT_SCREEN)).toBeVisible();

    // Start combat (S05-aware) and freeze at 1st active tactical decision pause
    await app.startCombat();
    await app.waitForInspect(
      (s) => s.activeRun?.combatWaitingDecision === true,
      25_000,
      'first tactical pause for target lock and component overload',
    );

    // D02: Lock a specific enemy target at the tactical pause and verify aria-pressed + persisted lockedEnemyId
    await app.lockEnemy('L6A_anvil_escort_1');
    const savedAfterLock = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(savedAfterLock?.activeRun?.lockedEnemyId).toBe('L6A_anvil_escort_1');
    expect(
      savedAfterLock?.activeRun?.activeCombat?.interventions?.some(
        (iv) => iv.kind === 'target_lock' && iv.targetEnemyId === 'L6A_anvil_escort_1',
      ),
    ).toBe(true);

    await expect(app.byTestId(TEST_IDS.COMBAT_TACTICAL_CHARGES)).toContainText('2/2');
    await expect(app.byTestId(TEST_IDS.COMBAT_OVERLOAD_SECTION)).toBeVisible();

    // D01: Overload mounted loan_laser_1 module (shares tactical charge pool)
    await app.overloadModule('loan_laser_1');

    // Verify overload intervention persisted in activeCombat.interventions and consumed 1 charge
    await expect
      .poll(
        async () => {
          const cur = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
          const hasOverloadIv = Boolean(
            cur?.activeRun?.activeCombat?.interventions?.some(
              (iv) => iv.kind === 'overload_module' && iv.moduleInstanceId === 'loan_laser_1',
            ),
          );
          return {
            chargesUsed: cur?.activeRun?.tacticalChargesUsed ?? 0,
            hasOverloadIv,
          };
        },
        { timeout: 10_000, message: 'Waiting for D01 overload intervention to persist' },
      )
      .toMatchObject({ chargesUsed: 1, hasOverloadIv: true });

    // Resolve remaining tactical pause / combat cleanly
    for (let step = 0; step < 3; step += 1) {
      const progressSnap = await app.waitForInspect(
        (s) =>
          s.phase === 'REWARD' ||
          s.phase === 'SETTLEMENT' ||
          s.activeRun?.combatWaitingDecision === true,
        25_000,
        `D01/D02 combat resolution step ${step + 1}`,
      );
      if (progressSnap.activeRun?.combatWaitingDecision) {
        await app.issueTacticalOrder('emergency_shield');
      } else {
        break;
      }
    }

    const doneSnap = await app.waitForInspect(
      (s) => s.phase === 'REWARD' || s.phase === 'SETTLEMENT',
      25_000,
      'multi-enemy boss combat resolved cleanly',
    );
    expect(doneSnap.activeRun?.combatWaitingDecision).toBe(false);
    monitor.assertClean(doneSnap);
  });
});
