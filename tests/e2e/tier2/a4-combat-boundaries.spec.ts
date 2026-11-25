import { expect, test } from '@playwright/test';
import {
  STORAGE_KEYS,
  TEST_IDS,
  attachZeroErrorMonitors,
  createAppDriver,
  createCargoBay,
  createCargoItem,
  createContractInstance,
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
      30_000,
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
      30_000,
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
    test.slow();
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
      contract: createContractInstance('free_salvage'),
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
        (s) => s.phase === 'REWARD',
        15_000,
        `battle at ${nodeId} reaches reward`,
      );

      // Canonical Round-2 D07 + S02 flow: zero-heal skip returns directly to MAP with empty staging
      await expect(app.byTestId(TEST_IDS.REWARD_SCREEN)).toBeVisible();
      await app.pickReward('skip');
      await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();
    }

    expect(monitor.pageErrors).toEqual([]);
    monitor.assertClean(await app.inspect());
  });

  test('T2-A4-05 @p1-mid 30-round stalemate and mutual destruction both resolve strictly as defeat', async ({
    page,
  }) => {
    test.slow();
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Sub-case A: 2x coolant_vent.improved (+4 shield regen/round vs 4 dmg/round L5 armored; coreAttack=1 vs armor=2 -> 30 < 35)
    // Player survives all 30 rounds with 0 hull dmg while enemy survives at 5 HP -> genuine 30-round stalemate defeat!
    const stalemateBay = createCargoBay({
      shipId: 'shield_cruiser',
      placed: [
        {
          item: createCargoItem({
            instanceId: 'stale_vent_1',
            definitionId: 'equipment.coolant_vent.improved',
            origin: 'owned',
          }),
          x: 0,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'stale_vent_2',
            definitionId: 'equipment.coolant_vent.improved',
            origin: 'owned',
          }),
          x: 1,
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
    await app.pauseAutoCombat();

    // Verify deterministic preview genuinely reaches 30 rounds stalemate defeat (NOT early hull death)
    const stalemateDrawer = await app.openForecastDetails();
    await expect(stalemateDrawer).toContainText(/预计战败/);
    await expect(stalemateDrawer).toContainText(/30\s*轮/);

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

    // Sub-case B: Simultaneous mutual KO — 1-HP cannon_skiff (coreAttack=2) vs 2-HP piercer (damagePerRound=3, pierceRatio=0.5)
    // Round 1 kills enemy (2->0) AND kills player simultaneously via pierce (1->0) -> strictly resolves as defeat!
    const mutualBay = createCargoBay({
      shipId: 'cannon_skiff',
      placed: [],
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
          L1B: {
            type: 'combat',
            encounterKind: 'piercer',
            visited: true,
            resolved: false,
            combat: {
              encounterKind: 'piercer',
              units: [
                {
                  enemyId: 'L1B_mutual_piercer',
                  name: '穿盾猎杀艇',
                  spriteArchetype: 'interceptor',
                  maxHp: 2,
                  damagePerRound: 3,
                  armor: 0,
                  pierceRatio: 0.5,
                },
              ],
              bounty: 6,
              improvedProb: 0,
            },
          },
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
    await app.pauseAutoCombat();

    const mutualDrawer = await app.openForecastDetails();
    await expect(mutualDrawer).toContainText(/预计战败/);
    await expect(mutualDrawer).toContainText(/1\s*轮/);
    await expect(mutualDrawer).toContainText(/我方\s*2\s*伤/);

    await app.startCombat();
    await app.skipCombat();

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

    // D07: All 3 equipmentOptions must respect anti-repeat exclusion for laser
    const eqOptions = savedAtReward?.activeRun?.pendingReward?.equipmentOptions ?? [];
    expect(eqOptions, 'D07 reward bundle must provide 3 equipmentOptions').toHaveLength(3);
    for (const opt of eqOptions) {
      expect(
        opt.definitionId,
        `D07 option ${opt.instanceId} must exclude 3rd consecutive laser`,
      ).not.toMatch(/^equipment\.laser\./);
    }

    // Verify recentEquipmentKinds persists across reload
    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.waitForInspect((s) => s.phase === 'REWARD', 30_000, 'reward persists after reload');
    const savedAfterReload = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(savedAfterReload?.activeRun?.recentEquipmentKinds.length).toBeGreaterThanOrEqual(2);

    monitor.assertClean(await app.inspect());
  });

  test('T2-A4-07 @p1-mid S04 single-enemy hides target policy, S05 Settings modal pauses auto-engage, and D01/D02 lock + overload persist across reload with 0-charge disable', async ({
    page,
  }) => {
    test.slow();
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Part A: S04 single-enemy hides target policy selector & S05 opening Settings modal pauses auto-engage with 0 ambush
    const singleEnemyMap = presetMidRunMapV3({
      phase: 'MAP',
      currentNodeId: 'L1A',
      graph: createMapGraph({
        nodeOverrides: {
          L1A: { visited: true, resolved: true },
          L2B: { type: 'combat', encounterKind: 'patrol' },
        },
      }),
      overrides: {
        visitedNodeIds: ['L1A'],
      },
    });
    singleEnemyMap.settings.pureAutoCombat = false;

    await app.seedStorage({ v2Save: singleEnemyMap, skipTitleScreen: true });
    await app.boot({ seed: 24009 });
    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();

    // Jump into single-enemy L2B and immediately open Settings modal during S05's 1.5s countdown
    await app.jumpToNode('L2B');
    const settingsBtn = page.locator('#v2-hud-settings, button[aria-label="设置"]').first();
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();

    const settingsDialog = page.locator('.modal-card[role="dialog"], [role="dialog"]').first();
    await expect(settingsDialog).toBeVisible();

    // Wait beyond S05's 1.5s countdown window while Settings modal is open -> must NEVER auto-engage in background
    await page.waitForTimeout(1800);
    const duringModalSnap = await app.inspect();
    expect(duringModalSnap.modalOpen).toBe(true);
    expect(duringModalSnap.phase).toBe('ENCOUNTER');
    expect(duringModalSnap.activeRun?.combatRound).toBeNull();

    await app.closeModal();
    await expect(app.byTestId(TEST_IDS.COMBAT_SCREEN)).toBeVisible();
    await expect(app.byTestId(TEST_IDS.BTN_PAUSE_AUTO_COMBAT)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // S04: Single-enemy encounter strictly detaches target policy selector & multi-enemy lock controls
    await expect(page.locator('.v2-policy-box')).toHaveCount(0);
    await expect(page.locator('[data-policy]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="enemy-lock-"]')).toHaveCount(0);

    // Part B: Multi-enemy target lock + D01 overload_module persistence across mid-combat reload
    const bossGraph = createMapGraph({
      maxLayers: 6,
      bossKind: 'boss_anvil',
      bossId: 'boss_anvil',
    });
    const multiEnemySave = presetMidRunMapV3({
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
    multiEnemySave.settings.pureAutoCombat = false;

    await app.seedStorage({ v2Save: multiEnemySave, skipTitleScreen: true });
    await app.boot({ seed: 24010 });
    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();

    await app.jumpToNode('L6A');
    await app.pauseAutoCombat();
    await expect(app.byTestId(TEST_IDS.COMBAT_SCREEN)).toBeVisible();
    await expect(page.locator('.v2-policy-box')).toHaveCount(1);

    await app.lockEnemy('L6A_anvil_escort_2');
    await app.startCombat();
    await app.waitForInspect(
      (s) => s.activeRun?.combatWaitingDecision === true,
      20_000,
      'multi-enemy tactical decision pause for overload',
    );

    await app.overloadModule('loan_laser_1');
    await expect
      .poll(
        async () => {
          const cur = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
          return {
            chargesUsed: cur?.activeRun?.tacticalChargesUsed ?? 0,
            hasOverload: Boolean(
              cur?.activeRun?.activeCombat?.interventions?.some(
                (iv) => iv.kind === 'overload_module' && iv.moduleInstanceId === 'loan_laser_1',
              ),
            ),
          };
        },
        { timeout: 10_000, message: 'overload_module intervention persisted before reload' },
      )
      .toEqual({ chargesUsed: 1, hasOverload: true });

    const beforeReloadSave = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    const interventionsBefore = beforeReloadSave?.activeRun?.activeCombat?.interventions ?? [];

    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.waitForInspect(
      (s) => s.screen === 'run' && s.activeRun !== null,
      30_000,
      'mid-combat state restored after reload',
    );
    const afterReloadSave = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(afterReloadSave?.activeRun?.tacticalChargesUsed).toBe(1);
    expect(afterReloadSave?.activeRun?.lockedEnemyId).toBe('L6A_anvil_escort_2');
    expect(afterReloadSave?.activeRun?.activeCombat?.interventions).toEqual(interventionsBefore);

    // Part C: At 0 remaining charges, ALL [data-testid^="overload-module-"] controls are strictly disabled
    const zeroChargeOverload = presetBossEncounterV3(1);
    zeroChargeOverload.settings.pureAutoCombat = false;
    if (zeroChargeOverload.activeRun) {
      const bossUnits = zeroChargeOverload.activeRun.graph.nodes.L6A?.combat?.units ?? [];
      const initialEnemies = bossUnits.map((u) => ({ ...u, hp: u.maxHp }));
      zeroChargeOverload.activeRun.tacticalChargesMax = 1;
      zeroChargeOverload.activeRun.tacticalChargesUsed = 1;
      zeroChargeOverload.activeRun.activeCombat = {
        nodeId: 'L6A',
        startingHp: 24,
        targetPolicy: 'weakest',
        simulation: {
          resultId: 'sim_zero_charge_overload_guard',
          outcome: 'victory',
          stalemate: false,
          targetPolicy: 'weakest',
          roundsCount: 3,
          startingPlayerHp: 24,
          startingPlayerShield: 6,
          finalPlayerHp: 18,
          repairApplied: 0,
          finalPlayerHpAfterRepair: 18,
          initialEnemies,
          rounds: [],
        },
        pendingDecision: {
          decisionId: 'dec_zero_charge_ov_r1',
          roundNumber: 1,
          playerHpAtPause: 24,
          playerShieldAtPause: 6,
          enemyThreatDamage: 4,
          enemiesAlive: Math.max(1, initialEnemies.length),
          options: [
            {
              choice: 'normal',
              label: '常规推进',
              summary: '保持原定火力',
              enabled: true,
              predictedOutcome: 'victory',
              predictedFinalHp: 18,
              predictedRounds: 3,
            },
          ],
          chosen: null,
        },
      };
    }

    await app.seedStorage({ v2Save: zeroChargeOverload, skipTitleScreen: true });
    await app.boot({ seed: 24011 });

    await expect(app.byTestId(TEST_IDS.COMBAT_TACTICAL_BAR)).toBeVisible();
    await expect(app.byTestId(TEST_IDS.COMBAT_TACTICAL_CHARGES)).toContainText('0/1');
    await expect(app.byTestId(TEST_IDS.COMBAT_OVERLOAD_SECTION)).toBeVisible();

    const overloadBtns = page.locator('[data-testid^="overload-module-"]');
    const overloadCount = await overloadBtns.count();
    expect(overloadCount, 'Mounted modules must render overload buttons').toBeGreaterThanOrEqual(1);
    for (let i = 0; i < overloadCount; i += 1) {
      await expect(overloadBtns.nth(i)).toBeDisabled();
    }
    await expect(page.locator('[data-testid^="overload-module-"]:not([disabled])')).toHaveCount(0);

    monitor.assertClean(await app.inspect());
  });
});
