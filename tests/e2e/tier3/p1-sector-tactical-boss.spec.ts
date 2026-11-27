import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import {
  BOSS_NAMES,
  SECTOR_NAMES,
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
} from '../helpers';
import type { V3SaveData } from '../helpers';

function toWarmBootBossSave(save: V3SaveData): V3SaveData {
  if (!save.activeRun) {
    throw new Error('Expected presetBossEncounterV3 to include activeRun');
  }
  const l5a = save.activeRun.graph.nodes.L5A;
  const l6a = save.activeRun.graph.nodes.L6A;
  if (!l5a || !l6a) {
    throw new Error('Expected boss graph to include L5A and L6A nodes');
  }
  return {
    ...save,
    settings: {
      ...save.settings,
      combatSpeed: 2,
      pureAutoCombat: false,
    },
    activeRun: {
      ...save.activeRun,
      phase: 'MAP',
      currentNodeId: 'L5A',
      fuel: 5,
      visitedNodeIds: ['L1A', 'L2A', 'L3A', 'L4A', 'L5A'],
      tacticalChargesUsed: 0,
      activeCombat: null,
      graph: {
        ...save.activeRun.graph,
        nodes: {
          ...save.activeRun.graph.nodes,
          L5A: { ...l5a, visited: true, resolved: true },
          L6A: { ...l6a, visited: false, resolved: false },
        },
      },
    },
  };
}

async function readRequiredPreviewFinalHp(page: Page): Promise<number> {
  const attr = await page
    .getByTestId(TEST_IDS.COMBAT_SCREEN)
    .locator('[data-preview-final-hp]')
    .first()
    .getAttribute('data-preview-final-hp');
  expect(attr, 'Pre-combat preview card must expose numeric data-preview-final-hp').not.toBeNull();
  const parsed = Number(attr);
  expect(Number.isFinite(parsed), `Invalid data-preview-final-hp value: ${String(attr)}`).toBe(true);
  return parsed;
}

async function readRequiredOrderPredictedHp(orderBtn: Locator): Promise<number> {
  const attr = await orderBtn.getAttribute('data-preview-final-hp');
  expect(attr, 'Tactical order button must expose numeric data-preview-final-hp').not.toBeNull();
  const parsed = Number(attr);
  expect(Number.isFinite(parsed), `Invalid tactical order data-preview-final-hp: ${String(attr)}`).toBe(true);
  return parsed;
}

test.describe('Tier 3 · P1: Sector Modifiers × Tactical Commands × Multi-Phase Bosses', () => {
  test('T3-P1-01 Sector 2 Cryo/Ion modifier × 紧急护盾/聚焦校准 × Act II Boss (铁壁无畏) preserves preview-execution parity', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const save = toWarmBootBossSave(presetBossEncounterV3(2));
    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 31001 });

    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();
    await app.jumpToNode('L6A');
    await app.pauseAutoCombat();

    const combatScreen = app.byTestId(TEST_IDS.COMBAT_SCREEN);
    await expect(combatScreen).toBeVisible();
    await expect(combatScreen).toContainText(BOSS_NAMES.act2);
    await expect(combatScreen).toContainText(new RegExp(`${SECTOR_NAMES.frozen_graveyard}|低温电离场`));

    const preSnap = await app.inspect();
    expect(preSnap.bgmTrack).toBe('boss');
    expect(preSnap.activeRun?.sectorId).toBe('frozen_graveyard');
    expect((await app.getRootAttributes()).sector).toBe('frozen_graveyard');

    // S06 Layer-2 Details Drawer must disclose Cryo/Ion -2 shield drain (4 + 8 -> 10) and exact 5 HP baseline
    const drawer = await app.openForecastDetails();
    await expect(drawer).toContainText('不干预时结果');
    await expect(drawer).toContainText('低温电离场');
    await expect(drawer).toContainText('起始耐久 34 · 护盾 10');
    const baselineHp = await readRequiredPreviewFinalHp(page);
    expect(baselineHp).toBe(5);

    await app.startCombat();

    // Pause #1 (R2): verify 2/2 charges, issue 紧急护盾 (predicts 10 HP > 5 HP baseline)
    const pause1 = await app.waitForInspect(
      (s) => s.activeRun?.combatWaitingDecision === true,
      30_000,
      'Act II Boss first tactical decision pause',
    );
    const pause1Round = pause1.activeRun?.combatRound ?? 0;
    expect(pause1Round).toBeGreaterThanOrEqual(1);

    const tacticalBar = app.byTestId(TEST_IDS.COMBAT_TACTICAL_BAR);
    await expect(tacticalBar).toBeVisible();
    await expect(app.byTestId(TEST_IDS.COMBAT_TACTICAL_CHARGES)).toContainText('2/2');

    const emergencyShieldBtn = app.byTestId(TEST_IDS.tacticalOrder('emergency_shield'));
    await expect(emergencyShieldBtn).toBeVisible();
    await expect(emergencyShieldBtn).toBeEnabled();
    const afterEmergencyPredicted = await readRequiredOrderPredictedHp(emergencyShieldBtn);
    expect(afterEmergencyPredicted).toBe(10);
    expect(afterEmergencyPredicted).toBeGreaterThan(baselineHp);
    await app.issueTacticalOrder('emergency_shield');

    // Unconditionally require Pause #2 (R11, Boss Phase 2) and issue 聚焦校准
    const pause2 = await app.waitForInspect(
      (s) =>
        s.activeRun?.combatWaitingDecision === true &&
        (s.activeRun?.combatRound ?? 0) > pause1Round,
      30_000,
      'Act II Boss Phase 2 tactical decision pause',
    );
    expect(pause2.activeRun?.combatWaitingDecision).toBe(true);
    await expect(app.byTestId(TEST_IDS.COMBAT_TACTICAL_CHARGES)).toContainText('1/2');

    const focusBtn = app.byTestId(TEST_IDS.tacticalOrder('focus_calibrate'));
    await expect(focusBtn).toBeVisible();
    await expect(focusBtn).toBeEnabled();
    const afterFocusPredicted = await readRequiredOrderPredictedHp(focusBtn);
    expect(afterFocusPredicted).toBe(10);
    await app.issueTacticalOrder('focus_calibrate');

    const doneSnap = await app.waitForInspect(
      (s) => s.phase === 'REWARD',
      30_000,
      'Act II Boss victory reward screen',
    );
    expect(doneSnap.activeRun?.combatWaitingDecision).toBe(false);
    expect(doneSnap.activeRun?.hp).toBe(10);

    const stored = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(stored?.activeRun?.tacticalChargesUsed).toBe(2);
    expect(stored?.activeRun?.sectorId).toBe('frozen_graveyard');

    monitor.assertClean(doneSnap);
  });

  test('T3-P1-02 Sector 3 Gravity Tide × 火力过载 × Act III 3-Phase Boss (黑曜利维坦) survives mid-Phase-2 reload without drift', async ({
    page,
  }) => {
    test.slow();
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const save = toWarmBootBossSave(presetBossEncounterV3(3));
    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 31002 });

    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();
    await app.jumpToNode('L6A');
    await app.pauseAutoCombat();

    const combatScreen = app.byTestId(TEST_IDS.COMBAT_SCREEN);
    await expect(combatScreen).toBeVisible();
    await expect(combatScreen).toContainText(BOSS_NAMES.act3);
    await expect(combatScreen).toContainText(new RegExp(`${SECTOR_NAMES.stargate_abyss}|引力潮汐`));

    const preSnap = await app.inspect();
    expect(preSnap.bgmTrack).toBe('boss');
    expect(preSnap.activeRun?.sectorId).toBe('stargate_abyss');
    expect(preSnap.activeRun?.isFinalCampaignRun).toBe(true);

    await app.startCombat();

    // Pause #1 (R2): issue 火力过载
    const pause1 = await app.waitForInspect(
      (s) => s.activeRun?.combatWaitingDecision === true,
      30_000,
      'Leviathan Phase 1 tactical pause',
    );
    const pause1Round = pause1.activeRun?.combatRound ?? 0;
    await app.issueTacticalOrder('overload');

    // Unconditionally require Phase 2 tactical pause (R7, P2/3, 19 HP) on 3-phase Leviathan
    const pause2 = await app.waitForInspect(
      (s) =>
        s.activeRun?.combatWaitingDecision === true &&
        (s.activeRun?.combatRound ?? 0) > pause1Round,
      30_000,
      'Leviathan Phase 2 tactical pause must trigger before battle ends',
    );
    const phase2Round = pause2.activeRun?.combatRound;
    const phase2RunHp = pause2.activeRun?.hp;
    expect(phase2Round).toBe(7);
    await expect(page.getByTestId('boss-phase-badge')).toContainText('P2/3');

    const beforeReloadSave = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    const phase2PauseHp = beforeReloadSave?.activeRun?.activeCombat?.pendingDecision?.playerHpAtPause;
    expect(phase2PauseHp).toBe(19);
    expect(beforeReloadSave?.activeRun?.tacticalChargesUsed).toBe(1);

    // Real browser reload mid-boss-decision must restore exact phase, round, pause HP & charges
    await page.reload({ waitUntil: 'domcontentloaded' });
    const afterReload = await app.waitForInspect(
      (s) => s.activeRun?.combatWaitingDecision === true && s.phase === 'ENCOUNTER',
      30_000,
      'Leviathan Phase 2 tactical pause restored after reload',
    );
    expect(afterReload.activeRun?.combatRound).toBe(phase2Round);
    expect(afterReload.activeRun?.hp).toBe(phase2RunHp);
    expect(afterReload.activeRun?.sectorId).toBe('stargate_abyss');
    await expect(page.getByTestId('boss-phase-badge')).toContainText('P2/3');
    await expect(app.byTestId(TEST_IDS.BTN_COMBAT_SKIP)).toBeDisabled();

    const afterReloadSave = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(afterReloadSave?.activeRun?.activeCombat?.pendingDecision?.playerHpAtPause).toBe(phase2PauseHp);
    expect(afterReloadSave?.activeRun?.tacticalChargesUsed).toBe(1);

    // Issue stargate_cruiser Signature Command (predicts 10 HP) and unconditionally reach Ending screen
    const sigBtn = app.byTestId(TEST_IDS.tacticalOrder('signature_stargate_cruiser'));
    await expect(sigBtn).toBeVisible();
    await expect(sigBtn).toBeEnabled();
    const predictedFinalHp = await readRequiredOrderPredictedHp(sigBtn);
    expect(predictedFinalHp).toBe(10);
    await app.issueTacticalOrder('signature_stargate_cruiser');

    const endSnap = await app.waitForInspect(
      (s) => s.screen === 'ending',
      30_000,
      'Act III Leviathan victory transitions unconditionally to Ending screen',
    );
    await expect(app.byTestId(TEST_IDS.ENDING_SCREEN)).toBeVisible();
    expect(endSnap.activeRun?.hp).toBe(10);

    const endSave = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(endSave?.activeRun?.tacticalChargesUsed).toBe(2);

    monitor.assertClean(endSnap);
  });

  test('T3-P1-03 Sector 1 Baseline × Hull Signature Commands (cannon_skiff vs shield_cruiser) × Act I Boss (铁砧号)', async ({
    browser,
  }) => {
    test.slow();

    const buildAct1BossSave = (shipId: 'cannon_skiff' | 'shield_cruiser'): V3SaveData => {
      const base = presetAct1V3({
        selectedShipId: shipId,
        unlockedShips: ['cannon_skiff', 'shield_cruiser'],
      });
      const graph = createMapGraph({
        maxLayers: 6,
        bossKind: 'boss_anvil',
        bossId: 'boss_anvil',
        nodeOverrides: {
          L5A: { visited: true, resolved: true },
          L6A: { visited: false, resolved: false },
        },
      });
      const bay = createCargoBay({
        shipId,
        placed: [
          {
            item: createCargoItem({
              instanceId: `${shipId}_laser`,
              definitionId: 'equipment.laser.improved',
              origin: 'owned',
            }),
            x: 0,
            y: 0,
          },
          {
            item: createCargoItem({
              instanceId: `${shipId}_bat`,
              definitionId: 'equipment.battery.improved',
              origin: 'owned',
            }),
            x: 1,
            y: 0,
          },
          {
            item: createCargoItem({
              instanceId: `${shipId}_shd`,
              definitionId: 'equipment.shield.improved',
              origin: 'owned',
            }),
            x: 2,
            y: 0,
          },
        ],
      });
      return {
        ...base,
        settings: {
          ...base.settings,
          combatSpeed: 2,
          pureAutoCombat: false,
        },
        activeRun: createV3RunFixture({
          runId: `run_sig_${shipId}`,
          seed: 31003,
          sectorId: 'near_orbit',
          shipId,
          phase: 'MAP',
          currentNodeId: 'L5A',
          fuel: 5,
          graph,
          bay,
          overrides: {
            visitedNodeIds: ['L1A', 'L2A', 'L3A', 'L4A', 'L5A'],
            tacticalChargesMax: 2,
            tacticalChargesUsed: 0,
            activeCombat: null,
          },
        }),
      };
    };

    const runWithHull = async (
      shipId: 'cannon_skiff' | 'shield_cruiser',
      expectedSignatureName: string,
    ): Promise<{ signatureLabel: string; finalHp: number; predictedHp: number }> => {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      try {
        const p = await ctx.newPage();
        const mon = attachZeroErrorMonitors(p);
        const drv = createAppDriver(p);

        await drv.seedStorage({ v2Save: buildAct1BossSave(shipId), skipTitleScreen: true });
        await drv.boot({ seed: 31003 });

        await expect(drv.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();
        await drv.jumpToNode('L6A');
        await drv.pauseAutoCombat();

        const screen = drv.byTestId(TEST_IDS.COMBAT_SCREEN);
        await expect(screen).toBeVisible();
        await expect(screen).toContainText(BOSS_NAMES.act1);

        await drv.startCombat();
        const pause1 = await drv.waitForInspect(
          (s) => s.activeRun?.combatWaitingDecision === true,
          30_000,
          `${shipId} Act I boss first tactical prompt`,
        );
        const pause1Round = pause1.activeRun?.combatRound ?? 0;

        const bar = drv.byTestId(TEST_IDS.COMBAT_TACTICAL_BAR);
        await expect(bar).toBeVisible();
        expect(await bar.locator('[data-testid^="tactical-order-"]').count()).toBeGreaterThanOrEqual(4);

        const sigOrderId = `signature_${shipId}`;
        const sigBtn = drv.byTestId(TEST_IDS.tacticalOrder(sigOrderId));
        await expect(sigBtn).toBeVisible();
        await expect(sigBtn).toHaveAttribute('data-tactical-signature', 'true');
        await expect(sigBtn).toContainText(expectedSignatureName);
        const signatureLabel = ((await sigBtn.textContent()) ?? '').trim();
        await drv.issueTacticalOrder(sigOrderId);

        // Unconditionally reach Pause #2 and issue overload
        await drv.waitForInspect(
          (s) =>
            s.activeRun?.combatWaitingDecision === true &&
            (s.activeRun?.combatRound ?? 0) > pause1Round,
          30_000,
          `${shipId} Act I boss second tactical prompt`,
        );
        const overloadBtn = drv.byTestId(TEST_IDS.tacticalOrder('overload'));
        await expect(overloadBtn).toBeVisible();
        const predictedHp = await readRequiredOrderPredictedHp(overloadBtn);
        await drv.issueTacticalOrder('overload');

        const doneSnap = await drv.waitForInspect(
          (s) => s.phase === 'REWARD',
          30_000,
          `${shipId} Act I boss victory reward screen`,
        );
        const finalHp = doneSnap.activeRun?.hp ?? -1;
        expect(finalHp).toBe(predictedHp);
        mon.assertClean(doneSnap);

        return {
          signatureLabel,
          finalHp,
          predictedHp,
        };
      } finally {
        await ctx.close();
      }
    };

    const skiffResult = await runWithHull('cannon_skiff', '双联超频');
    const cruiserResult = await runWithHull('shield_cruiser', '相位反震');

    expect(skiffResult.signatureLabel).not.toBe(cruiserResult.signatureLabel);
    expect(skiffResult.finalHp).toBe(3);
    expect(cruiserResult.finalHp).toBe(21);
    expect(cruiserResult.finalHp).toBeGreaterThan(skiffResult.finalHp);
  });

  test('T3-P1-04 Pure-Auto toggle × Sector 2 modifier × Multi-Phase Boss executes seamlessly with exact preview HP', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const save = toWarmBootBossSave(presetBossEncounterV3(2));
    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 31004 });

    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();
    await app.jumpToNode('L6A');
    await app.pauseAutoCombat();

    // Enable Pure-Auto via Settings modal while S05 countdown is paused
    const settingsBtn = page.locator('#v2-hud-settings');
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();

    const pureAutoToggle = page.getByTestId('toggle-pure-auto');
    await expect(pureAutoToggle).toBeVisible();
    await expect(pureAutoToggle).toHaveAttribute('aria-pressed', 'false');
    await pureAutoToggle.click();
    await expect(pureAutoToggle).toHaveAttribute('aria-pressed', 'true');
    await app.closeModal();

    const combatScreen = app.byTestId(TEST_IDS.COMBAT_SCREEN);
    await expect(combatScreen).toBeVisible();
    await expect(combatScreen).toContainText(BOSS_NAMES.act2);
    await expect(combatScreen).toContainText('纯自动战斗模式');

    const drawer = await app.openForecastDetails();
    await expect(drawer).toContainText('不干预时结果');
    await expect(drawer).toContainText('余 5HP');
    const predictedHp = await readRequiredPreviewFinalHp(page);
    expect(predictedHp).toBe(5);

    await app.startCombat();
    await app.skipCombat();

    const doneSnap = await app.waitForInspect(
      (s) => s.phase === 'REWARD',
      20_000,
      'Pure-Auto multi-phase boss resolution without decision stall',
    );
    expect(doneSnap.activeRun?.combatWaitingDecision).toBe(false);
    expect(doneSnap.activeRun?.hp).toBe(5);

    const stored = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(stored?.activeRun?.tacticalChargesUsed).toBe(0);
    expect(stored?.settings.pureAutoCombat).toBe(true);

    monitor.assertClean(doneSnap);
  });

  test('T3-P1-05 Sector 3 Gravity Tide × 3-Phase Leviathan × D02 Target Lock S06 Flip × D01 Battery Adjacent Overload + Chained Order', async ({
    page,
  }) => {
    test.slow();
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const save = toWarmBootBossSave(presetBossEncounterV3(3));
    const batId = save.activeRun?.bay.placed.find(
      (p) => p.item.definitionId === 'equipment.battery.improved',
    )?.item.instanceId;
    expect(batId, 'Act III boss preset must mount an improved battery').toBeTruthy();

    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 31005 });

    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();
    await app.jumpToNode('L6A');
    await app.pauseAutoCombat();

    // S06 Layer-1 + Layer-2 baseline under Sector 3 Gravity Tide
    await expect(app.byTestId(TEST_IDS.COMBAT_THREAT_TIER)).toContainText('危险');
    await expect(app.byTestId(TEST_IDS.FORECAST_DETAILS_DRAWER)).toHaveCount(0);

    const drawer = await app.openForecastDetails();
    await expect(drawer).toContainText('不干预时结果');
    await expect(drawer).toContainText('余 7HP (11轮)');
    await expect(drawer).toContainText('引力潮汐高潮');
    expect(await readRequiredPreviewFinalHp(page)).toBe(7);

    // D02 pre-combat Boss Lock flips S06 forecast from 危险 (7 HP) -> 致命 (0 HP)
    await app.lockEnemy('boss_leviathan');
    await expect(app.byTestId(TEST_IDS.COMBAT_THREAT_TIER)).toContainText('致命');
    await expect(drawer).toContainText('预计战败 · 余 0HP (7轮)');
    expect(await readRequiredPreviewFinalHp(page)).toBe(0);

    const lockedSave = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(lockedSave?.activeRun?.lockedEnemyId).toBe('boss_leviathan');

    // Pause #1 (R2): D02 mid-combat retarget to escort (0 charge) + D01 Battery Adjacent Overload (1 charge)
    await app.startCombat();
    const pause1 = await app.waitForInspect(
      (s) => s.activeRun?.combatWaitingDecision === true,
      30_000,
      'Leviathan Pause #1 for mid-combat retarget & battery overload',
    );
    const pause1Round = pause1.activeRun?.combatRound ?? 0;
    await expect(app.byTestId(TEST_IDS.COMBAT_TACTICAL_CHARGES)).toContainText('2/2');

    await app.lockEnemy('L6A_lev_escort_1');
    await expect(app.byTestId(TEST_IDS.COMBAT_TACTICAL_CHARGES)).toContainText('2/2');

    await expect
      .poll(
        async () => {
          const st = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
          return (
            st?.activeRun?.activeCombat?.interventions?.some(
              (iv) => iv.kind === 'target_lock' && iv.targetEnemyId === 'L6A_lev_escort_1',
            ) ?? false
          );
        },
        { timeout: 10_000, message: 'Mid-combat target_lock intervention must persist in storage' },
      )
      .toBe(true);

    const batOverloadBtn = app.byTestId(TEST_IDS.overloadModule(batId!));
    await expect(batOverloadBtn).toBeVisible();
    await expect(batOverloadBtn).toContainText('相邻超载供能');
    await app.overloadModule(batId!);

    await expect
      .poll(
        async () => {
          const st = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
          const hasBatOverload =
            st?.activeRun?.activeCombat?.interventions?.some(
              (iv) =>
                iv.kind === 'overload_module' &&
                iv.moduleInstanceId === batId &&
                iv.moduleKind === 'battery',
            ) ?? false;
          return st?.activeRun?.tacticalChargesUsed === 1 && hasBatOverload;
        },
        { timeout: 10_000, message: 'Battery adjacent overload must spend 1 charge and persist' },
      )
      .toBe(true);

    // Pause #2 (Phase 2): verify P2/3 & 1/2 charges, chain focus_calibrate (predicts 19 HP >> 7 HP baseline)
    await app.waitForInspect(
      (s) =>
        s.activeRun?.combatWaitingDecision === true &&
        (s.activeRun?.combatRound ?? 0) > pause1Round,
      30_000,
      'Leviathan Phase 2 pause after battery overload',
    );
    await expect(app.byTestId(TEST_IDS.COMBAT_TACTICAL_CHARGES)).toContainText('1/2');
    await expect(page.getByTestId('boss-phase-badge')).toContainText('P2/3');

    const focusBtn = app.byTestId(TEST_IDS.tacticalOrder('focus_calibrate'));
    await expect(focusBtn).toBeVisible();
    const predictedFinalHp = await readRequiredOrderPredictedHp(focusBtn);
    expect(predictedFinalHp).toBe(19);
    await app.issueTacticalOrder('focus_calibrate');

    const endSnap = await app.waitForInspect(
      (s) => s.screen === 'ending',
      30_000,
      'Leviathan victory transitions unconditionally to Ending screen after D02+D01+tactical chain',
    );
    await expect(app.byTestId(TEST_IDS.ENDING_SCREEN)).toBeVisible();
    expect(endSnap.activeRun?.hp).toBe(19);

    const endSave = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(endSave?.activeRun?.tacticalChargesUsed).toBe(2);

    monitor.assertClean(endSnap);
  });
});
