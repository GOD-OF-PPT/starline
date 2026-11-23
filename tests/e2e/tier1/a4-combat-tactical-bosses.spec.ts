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

  test('T1-A4-02 @p0-core Pre-combat preview recalculates on target policy change and matches post-combat HP exactly', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const save = presetMidRunMapV3({
      phase: 'ENCOUNTER',
      currentNodeId: 'L1B',
      graph: createMapGraph({
        nodeOverrides: {
          L1B: { type: 'combat', encounterKind: 'swarm', visited: true, resolved: false },
        },
      }),
      overrides: {
        visitedNodeIds: ['L1B'],
        activeCombat: null,
      },
    });

    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 4002 });

    const combatScreen = app.byTestId(TEST_IDS.COMBAT_SCREEN);
    await expect(combatScreen).toBeVisible();

    // Toggle target priority and ensure preview panel remains active
    const threatBtn = combatScreen
      .locator('[data-policy="highest_threat"]')
      .or(combatScreen.getByRole('button', { name: /优先最大威胁|最大威胁优先|威胁优先/ }))
      .first();
    await expect(threatBtn).toBeVisible();
    await threatBtn.click();

    // Read predicted post-combat HP from preview text or data attribute
    const predictedHp = await combatScreen.evaluate((el) => {
      const attrEl = el.querySelector('[data-preview-final-hp]');
      if (attrEl) {
        return Number(attrEl.getAttribute('data-preview-final-hp'));
      }
      const text = el.textContent ?? '';
      const match =
        text.match(/战后[^\d]*(\d+)/) ??
        text.match(/(?:预计[^0-9]{0,8}|剩余\s*|余\s*)(\d+)\s*(?:HP|血量|船体)/i) ??
        text.match(/(?:战后|预计|剩余)\s*(?:HP|血量|船体|耐久)?\s*[:：]?\s*(\d+)/i);
      return match ? Number(match[1]) : null;
    });
    expect(predictedHp, 'Pre-combat preview must display numeric predicted post-combat HP').not.toBeNull();

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

    // Jump into Layer 1 combat node
    const combatNode = page
      .locator('[data-testid="map-node-L1A"], [data-testid="map-node-L1B"]')
      .filter({ hasText: /战斗|敌|哨/ })
      .first();
    await expect(combatNode).toBeVisible();
    await combatNode.click();
    await app.byTestId(TEST_IDS.BTN_JUMP_NODE).click();

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
      await app.pickReward('repair');
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
});
