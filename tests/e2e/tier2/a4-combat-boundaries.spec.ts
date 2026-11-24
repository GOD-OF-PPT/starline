import { expect, test } from '@playwright/test';
import {
  STORAGE_KEYS,
  TEST_IDS,
  attachZeroErrorMonitors,
  createAppDriver,
  createCargoBay,
  createCargoItem,
  createMapGraph,
  createV3RunFixture,
  presetAct1V3,
  presetBossEncounterV3,
  presetMidRunMapV3,
} from '../helpers';
import type { V3SaveData } from '../helpers';

test.describe('Tier 2 · A4: Combat Determinism, Reload Idempotency & Edge Cases', () => {
  test('T2-A4-01 @p1-mid Mid-combat tactical decision reload restores pending pause before choice and never double-applies after choice', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const bossSave = presetBossEncounterV3(1);
    bossSave.settings.pureAutoCombat = false;
    await app.seedStorage({
      v2Save: bossSave,
      skipTitleScreen: true,
    });
    await app.boot({ seed: 24001 });

    await app.startCombat();

    const pausedBeforeReload = await app.waitForInspect(
      (s) => s.activeRun?.combatWaitingDecision === true,
      15_000,
      'tactical decision pause before reload',
    );
    const pausedRound = pausedBeforeReload.activeRun?.combatRound;
    const pausedHp = pausedBeforeReload.activeRun?.hp;
    expect(pausedRound).not.toBeNull();

    // Reload BEFORE choosing tactical order -> exact decision pause restored with skip disabled
    await page.reload({ waitUntil: 'domcontentloaded' });
    const pausedAfterReload = await app.waitForInspect(
      (s) => s.activeRun?.combatWaitingDecision === true,
      15_000,
      'tactical decision pause restored after reload',
    );
    expect(pausedAfterReload.activeRun?.combatRound).toBe(pausedRound);
    expect(pausedAfterReload.activeRun?.hp).toBe(pausedHp);
    await expect(app.byTestId(TEST_IDS.COMBAT_TACTICAL_BAR)).toBeVisible();
    await expect(app.byTestId(TEST_IDS.BTN_COMBAT_SKIP)).toBeDisabled();

    // Issue a tactical order, then immediately reload to verify idempotency (no re-prompt or double charge)
    await app.issueTacticalOrder('focus_calibrate');

    await app.waitForInspect(
      (s) => s.activeRun?.combatWaitingDecision === false || s.phase !== 'ENCOUNTER',
      15_000,
      'tactical order committed',
    );

    const saveAfterCommit = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    const chargesAfterCommit = saveAfterCommit?.activeRun?.tacticalChargesUsed ?? 0;
    expect(chargesAfterCommit).toBeGreaterThanOrEqual(1);

    await page.reload({ waitUntil: 'domcontentloaded' });
    const afterCommitReload = await app.waitForInspect(
      (s) => s.screen === 'run',
      15_000,
      'combat resumed after post-commit reload',
    );
    const saveAfterSecondReload = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);

    if (afterCommitReload.activeRun?.combatWaitingDecision) {
      // If a later round prompted a second charge, it must be strictly later than pausedRound
      expect(afterCommitReload.activeRun.combatRound).not.toBe(pausedRound);
    }
    expect(saveAfterSecondReload?.activeRun).not.toBeNull();
    expect(saveAfterSecondReload?.activeRun?.tacticalChargesUsed).toBe(chargesAfterCommit);

    monitor.assertClean(afterCommitReload);
  });

  test('T2-A4-02 @p1-mid Skip button stays strictly disabled during pending tactical decision and unlocks after commitment', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const bossSave = presetBossEncounterV3(1);
    bossSave.settings.pureAutoCombat = false;
    await app.seedStorage({
      v2Save: bossSave,
      skipTitleScreen: true,
    });
    await app.boot({ seed: 24002 });

    await app.startCombat();
    const pausedSnap = await app.waitForInspect(
      (s) => s.activeRun?.combatWaitingDecision === true,
      15_000,
      'combat paused at tactical decision',
    );

    const skipBtn = app.byTestId(TEST_IDS.BTN_COMBAT_SKIP);
    await expect(skipBtn).toBeVisible();
    await expect(skipBtn).toBeDisabled();

    // Even attempting a forced DOM click on disabled button must NOT resolve the decision
    await skipBtn.click({ force: true });
    const stillPaused = await app.inspect();
    expect(stillPaused.activeRun?.combatWaitingDecision).toBe(true);
    expect(stillPaused.activeRun?.combatRound).toBe(pausedSnap.activeRun?.combatRound);

    // Committing a tactical order unblocks execution and re-enables skip (or completes combat)
    await app.issueTacticalOrder('emergency_shield');
    const resumed = await app.waitForInspect(
      (s) => s.activeRun?.combatWaitingDecision === false || s.phase !== 'ENCOUNTER',
      15_000,
      'tactical decision resolved',
    );
    if (resumed.phase === 'ENCOUNTER' && resumed.activeRun && !resumed.activeRun.combatWaitingDecision) {
      await expect(skipBtn).toBeEnabled();
    }

    monitor.assertClean(resumed);
  });

  test('T2-A4-03 @p1-mid Tactical orders disable overload at lethal HP+shield threshold and block all orders at 0 charges', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Sub-case A: playerHp + playerShield <= 3 -> overload self-damage would be lethal
    const lowHpCombat = presetBossEncounterV3(1);
    lowHpCombat.settings.pureAutoCombat = false;
    if (lowHpCombat.activeRun) {
      const bossUnits = lowHpCombat.activeRun.graph.nodes.L6A?.combat?.units ?? [];
      const initialEnemies = bossUnits.map((u) => ({ ...u, hp: u.maxHp }));
      lowHpCombat.activeRun.hp = 2;
      lowHpCombat.activeRun.tacticalChargesMax = 1;
      lowHpCombat.activeRun.tacticalChargesUsed = 0;
      lowHpCombat.activeRun.activeCombat = {
        nodeId: 'L6A',
        startingHp: 2,
        targetPolicy: 'weakest',
        simulation: {
          resultId: 'sim_low_hp_r1',
          outcome: 'defeat',
          stalemate: false,
          targetPolicy: 'weakest',
          roundsCount: 2,
          startingPlayerHp: 2,
          startingPlayerShield: 0,
          finalPlayerHp: 0,
          repairApplied: 0,
          finalPlayerHpAfterRepair: 0,
          initialEnemies,
          rounds: [],
        },
        pendingDecision: {
          decisionId: 'dec_low_hp_r1',
          roundNumber: 1,
          playerHpAtPause: 2,
          playerShieldAtPause: 0,
          enemyThreatDamage: 4,
          enemiesAlive: Math.max(1, initialEnemies.length),
          options: [
            {
              choice: 'overload',
              label: '火力过载',
              summary: '消耗 3 船体强化火力',
              enabled: false,
              disabledReason: '船体与护盾总和不足，强攻会自毁',
              predictedOutcome: 'defeat',
              predictedFinalHp: 0,
              predictedRounds: 1,
            },
            {
              choice: 'emergency_shield',
              label: '紧急护盾',
              summary: '立即获得临时护盾',
              enabled: true,
              predictedOutcome: 'victory',
              predictedFinalHp: 2,
              predictedRounds: 3,
            },
            {
              choice: 'focus_calibrate',
              label: '聚焦校准',
              summary: '提升本回合命中与穿甲',
              enabled: true,
              predictedOutcome: 'victory',
              predictedFinalHp: 1,
              predictedRounds: 3,
            },
            {
              choice: 'normal',
              label: '常规推进',
              summary: '保持原定火力',
              enabled: true,
              predictedOutcome: 'defeat',
              predictedFinalHp: 0,
              predictedRounds: 2,
            },
          ],
          chosen: null,
        },
      };
    }

    await app.seedStorage({
      v2Save: lowHpCombat,
      skipTitleScreen: true,
    });
    await app.boot({ seed: 24003 });

    const tacticalBar = app.byTestId(TEST_IDS.COMBAT_TACTICAL_BAR);
    await expect(tacticalBar).toBeVisible();

    const overloadBtn = app.byTestId(TEST_IDS.tacticalOrder('overload'));
    await expect(overloadBtn).toBeVisible();
    await expect(overloadBtn).toBeDisabled();

    const shieldBtn = app.byTestId(TEST_IDS.tacticalOrder('emergency_shield'));
    await expect(shieldBtn).toBeVisible();
    await expect(shieldBtn).toBeEnabled();

    // Sub-case B: 0 charges remaining (tacticalChargesUsed >= tacticalChargesMax)
    const zeroChargeCombat = presetBossEncounterV3(1);
    zeroChargeCombat.settings.pureAutoCombat = false;
    if (zeroChargeCombat.activeRun) {
      const bossUnits = zeroChargeCombat.activeRun.graph.nodes.L6A?.combat?.units ?? [];
      const initialEnemies = bossUnits.map((u) => ({ ...u, hp: u.maxHp }));
      zeroChargeCombat.activeRun.tacticalChargesMax = 1;
      zeroChargeCombat.activeRun.tacticalChargesUsed = 1;
      zeroChargeCombat.activeRun.activeCombat = {
        nodeId: 'L6A',
        startingHp: 24,
        targetPolicy: 'weakest',
        simulation: {
          resultId: 'sim_zero_charge_r2',
          outcome: 'victory',
          stalemate: false,
          targetPolicy: 'weakest',
          roundsCount: 3,
          startingPlayerHp: 24,
          startingPlayerShield: 6,
          finalPlayerHp: 20,
          repairApplied: 0,
          finalPlayerHpAfterRepair: 20,
          initialEnemies,
          rounds: [],
        },
        pendingDecision: null,
      };
    }

    await app.seedStorage({
      v2Save: zeroChargeCombat,
      skipTitleScreen: true,
    });
    await app.boot({ seed: 24004 });

    await expect(
      app.byTestId(TEST_IDS.COMBAT_SCREEN).or(app.byTestId(TEST_IDS.REWARD_SCREEN)),
    ).toBeVisible();
    await expect(page.locator('[data-testid^="tactical-order-"]:not([disabled])')).toHaveCount(0);
    expect((await app.inspect()).activeRun?.combatWaitingDecision).toBe(false);

    monitor.assertClean(await app.inspect());
  });

  test('T2-A4-04 @p0-core Consecutive 3-battle combat lifecycle advances past Round 0 without scene freeze or sprite handle errors', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const strongBay = createCargoBay({
      shipId: 'cannon_skiff',
      placed: [
        {
          item: createCargoItem({
            instanceId: 'multi_wpn_1',
            definitionId: 'equipment.laser.improved',
            origin: 'owned',
          }),
          x: 0,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'multi_bat_1',
            definitionId: 'equipment.battery.improved',
            origin: 'owned',
          }),
          x: 1,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'multi_shd_1',
            definitionId: 'equipment.shield.improved',
            origin: 'owned',
          }),
          x: 2,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'multi_rep_1',
            definitionId: 'equipment.repair.improved',
            origin: 'owned',
          }),
          x: 0,
          y: 2,
        },
      ],
    });

    const threeBattleSave = presetMidRunMapV3({
      bay: strongBay,
      fuel: 9,
      graph: createMapGraph({
        nodeOverrides: {
          L1A: { type: 'combat', encounterKind: 'patrol' },
          L2A: { type: 'combat', encounterKind: 'patrol' },
          L3A: { type: 'combat', encounterKind: 'swarm' },
        },
      }),
    });
    threeBattleSave.settings.pureAutoCombat = true;
    threeBattleSave.settings.combatSpeed = 2;

    await app.seedStorage({
      v2Save: threeBattleSave,
      skipTitleScreen: true,
    });
    await app.boot({ seed: 24005 });

    for (const nodeId of ['L1A', 'L2A', 'L3A']) {
      await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();
      await app.jumpToNode(nodeId);
      await expect(app.byTestId(TEST_IDS.COMBAT_SCREEN)).toBeVisible();

      await app.startCombat();

      // Verify combat genuinely advances past Round 0 (catches Phaser sprite-destroy round-0 freeze)
      const progressed = await app.waitForInspect(
        (s) =>
          (s.activeRun?.combatRound !== null && (s.activeRun?.combatRound ?? 0) >= 1) ||
          s.phase === 'REWARD',
        15_000,
        `battle at ${nodeId} advances past Round 0`,
      );

      if (progressed.phase === 'ENCOUNTER') {
        await app.skipCombat();
      }

      await app.waitForInspect(
        (s) => s.phase === 'REWARD' || s.phase === 'MAP',
        15_000,
        `battle at ${nodeId} reaches reward`,
      );

      // Claim non-staging repair/parts reward to return cleanly to Map
      if ((await app.inspect()).phase === 'REWARD') {
        const rewardScreen = app.byTestId(TEST_IDS.REWARD_SCREEN);
        await expect(rewardScreen).toBeVisible();
        const repairOrSkip = rewardScreen
          .locator('button[data-pick-reward="repair"]')
          .or(rewardScreen.getByRole('button', { name: /抢修|维修|跳过|继续|零件/ }))
          .or(rewardScreen.locator('button').first())
          .first();
        await repairOrSkip.click();
      }

      if ((await app.inspect()).phase === 'ARRANGE') {
        const leaveBtn = app.byTestId(TEST_IDS.BTN_LEAVE_ARRANGE);
        for (let step = 0; step < 4 && (await leaveBtn.isDisabled()); step += 1) {
          const stagingCard = page
            .locator('.v2-staging-card, .staging-card, [data-testid^="staging-item"]')
            .first();
          if (await stagingCard.isVisible()) {
            await stagingCard.click();
          }
          const resolveBtn = app
            .byTestId(TEST_IDS.ARRANGE_SCREEN)
            .locator('button:not([disabled])')
            .filter({ hasText: /装入推荐位|舍弃/ })
            .first();
          if (await resolveBtn.isVisible()) {
            await resolveBtn.click();
          } else {
            break;
          }
        }
        await app.leaveArrange();
      }
    }

    expect(monitor.pageErrors).toEqual([]);
    monitor.assertClean(await app.inspect());
  });

  test('T2-A4-05 @p1-mid 30-round stalemate and mutual destruction both resolve strictly as defeat', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Sub-case A: 0-weapon high-defense bay vs armored enemy -> 30-round stalemate MUST be defeat
    const stalemateBay = createCargoBay({
      shipId: 'shield_cruiser',
      placed: [
        {
          item: createCargoItem({
            instanceId: 'stale_shd_1',
            definitionId: 'equipment.shield.improved',
            origin: 'owned',
          }),
          x: 0,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'stale_shd_2',
            definitionId: 'equipment.shield.improved',
            origin: 'owned',
          }),
          x: 1,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'stale_rep_1',
            definitionId: 'equipment.repair.improved',
            origin: 'owned',
          }),
          x: 2,
          y: 0,
        },
      ],
    });

    const stalemateRun = createV3RunFixture({
      shipId: 'shield_cruiser',
      phase: 'ENCOUNTER',
      currentNodeId: 'L5B',
      bay: stalemateBay,
      hp: 34,
      maxHp: 34,
      graph: createMapGraph({
        nodeOverrides: {
          L5B: { type: 'elite', encounterKind: 'armored', visited: true, resolved: false },
        },
      }),
      overrides: {
        visitedNodeIds: ['L1A', 'L2A', 'L3A', 'L4A', 'L5B'],
        activeCombat: null,
      },
    });
    const stalemateSave = {
      ...presetAct1V3(),
      activeRun: stalemateRun,
      settings: {
        ...presetAct1V3().settings,
        pureAutoCombat: true,
        combatSpeed: 2 as const,
      },
    };

    await app.seedStorage({ v2Save: stalemateSave, skipTitleScreen: true });
    await app.boot({ seed: 24006 });

    await app.startCombat();
    await app.skipCombat();

    await app.waitForInspect(
      (s) => s.phase === 'SETTLEMENT',
      15_000,
      '30-round stalemate resolves as defeat settlement',
    );
    const stalemateSaved = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(stalemateSaved?.activeRun?.settlementReason).toBe('defeat');
    await expect(app.byTestId(TEST_IDS.SETTLEMENT_SCREEN)).toContainText(/战败|僵局|拖曳/);

    // Sub-case B: Mutual destruction (player at 1 HP with counter module vs lethal enemy hit) -> defeat
    const mutualBay = createCargoBay({
      shipId: 'cannon_skiff',
      placed: [
        {
          item: createCargoItem({
            instanceId: 'mutual_counter_1',
            definitionId: 'equipment.counter.improved',
            origin: 'owned',
          }),
          x: 0,
          y: 0,
        },
      ],
    });
    const mutualRun = createV3RunFixture({
      shipId: 'cannon_skiff',
      phase: 'ENCOUNTER',
      currentNodeId: 'L1B',
      bay: mutualBay,
      hp: 1,
      maxHp: 30,
      graph: createMapGraph({
        nodeOverrides: {
          L1B: { type: 'combat', encounterKind: 'piercer', visited: true, resolved: false },
        },
      }),
      overrides: {
        visitedNodeIds: ['L1B'],
        activeCombat: null,
      },
    });

    await app.seedStorage({
      v2Save: {
        ...presetAct1V3(),
        activeRun: mutualRun,
        settings: { ...presetAct1V3().settings, pureAutoCombat: true, combatSpeed: 2 },
      },
      skipTitleScreen: true,
    });
    await app.boot({ seed: 24007 });

    await app.startCombat();
    if ((await app.inspect()).phase === 'ENCOUNTER') {
      const skipBtn = app.byTestId(TEST_IDS.BTN_COMBAT_SKIP);
      if (await skipBtn.isVisible()) {
        await skipBtn.click().catch(() => {
          // 1-round mutual destruction may finish immediately into SETTLEMENT
        });
      }
    }

    await app.waitForInspect(
      (s) => s.phase === 'SETTLEMENT',
      15_000,
      'mutual destruction resolves strictly as defeat',
    );
    const mutualSaved = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(mutualSaved?.activeRun?.settlementReason).toBe('defeat');

    monitor.assertClean(await app.inspect());
  });

  test('T2-A4-06 @p1-mid Anti-repeat equipment pool guard prevents 3 consecutive identical kinds across Layers 1-3 and persists across reload', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const runSave = presetMidRunMapV3({
      graph: createMapGraph({
        nodeOverrides: {
          L1A: { type: 'combat', encounterKind: 'patrol' },
        },
      }),
      overrides: {
        recentEquipmentKinds: ['laser', 'laser'],
      },
    });
    runSave.settings.pureAutoCombat = true;
    runSave.settings.combatSpeed = 2;

    await app.seedStorage({
      v2Save: runSave,
      skipTitleScreen: true,
    });
    await app.boot({ seed: 24008 });

    await app.jumpToNode('L1A');
    await app.startCombat();
    await app.skipCombat();

    await app.waitForInspect(
      (s) => s.phase === 'REWARD',
      15_000,
      'reward phase reached after L1 combat',
    );

    const savedAtReward = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    const eqOption = savedAtReward?.activeRun?.pendingReward?.equipmentOption;
    expect(eqOption, 'Reward bundle must offer an equipmentOption').toBeDefined();
    expect(
      eqOption?.definitionId,
      'Anti-repeat guard must NOT roll a 3rd consecutive laser in L1-L3',
    ).not.toMatch(/^equipment\.laser\./);

    // Verify recentEquipmentKinds persists across reload
    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.waitForInspect((s) => s.phase === 'REWARD', 15_000, 'reward persists after reload');
    const savedAfterReload = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(savedAfterReload?.activeRun?.recentEquipmentKinds.length).toBeGreaterThanOrEqual(2);

    monitor.assertClean(await app.inspect());
  });
});
