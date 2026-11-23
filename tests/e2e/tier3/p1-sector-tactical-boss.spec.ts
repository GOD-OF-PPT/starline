import { expect, test } from '@playwright/test';
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

async function readPreviewFinalHp(page: import('@playwright/test').Page): Promise<number | null> {
  return page.getByTestId(TEST_IDS.COMBAT_SCREEN).evaluate((el) => {
    const attrEl = el.querySelector('[data-preview-final-hp]');
    if (attrEl) {
      const parsed = Number(attrEl.getAttribute('data-preview-final-hp'));
      if (Number.isFinite(parsed)) return parsed;
    }
    const text = el.textContent ?? '';
    const match =
      text.match(/战后[^\d]*(\d+)/) ??
      text.match(/(?:预计[^0-9]{0,8}|剩余\s*|余\s*)(\d+)\s*(?:HP|血量|船体)/i) ??
      text.match(/(?:战后|预计|剩余)\s*(?:HP|血量|船体|耐久)?\s*[:：]?\s*(\d+)/i);
    return match ? Number(match[1]) : null;
  });
}

async function readOrderPredictedHp(
  orderBtn: import('@playwright/test').Locator,
): Promise<number | null> {
  return orderBtn.evaluate((el) => {
    const attr = el.getAttribute('data-preview-final-hp');
    if (attr !== null) {
      const parsed = Number(attr);
      if (Number.isFinite(parsed)) return parsed;
    }
    const text = el.textContent ?? '';
    const match =
      text.match(/(?:余|剩余|战后)[^\d]*(\d+)\s*(?:HP|血量|船体)?/i) ??
      text.match(/预计[^0-9]{0,8}(\d+)\s*(?:HP|血量|船体)/i);
    return match ? Number(match[1]) : null;
  });
}

test.describe('Tier 3 · P1: Sector Modifiers × Tactical Commands × Multi-Phase Bosses', () => {
  test('T3-P1-01 Sector 2 Cryo/Ion modifier × 紧急护盾/聚焦校准 × Act II Boss (铁壁无畏) preserves preview-execution parity', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const save = presetBossEncounterV3(2);
    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 31001 });

    const combatScreen = app.byTestId(TEST_IDS.COMBAT_SCREEN);
    await expect(combatScreen).toBeVisible();
    await expect(combatScreen).toContainText(BOSS_NAMES.act2);
    await expect(combatScreen).toContainText(new RegExp(`${SECTOR_NAMES.frozen_graveyard}|冰晶|离子|低温|护盾过载`));

    const preSnap = await app.inspect();
    expect(preSnap.bgmTrack).toBe('boss');
    expect(preSnap.activeRun?.sectorId).toBe('frozen_graveyard');
    expect((await app.getRootAttributes()).sector).toBe('frozen_graveyard');

    await app.startCombat();

    // First tactical decision pause: verify Sector 2 modifier & 2 charges, issue 紧急护盾
    const pause1 = await app.waitForInspect(
      (s) => s.activeRun?.combatWaitingDecision === true,
      15_000,
      'Act II Boss first tactical decision pause',
    );
    expect(pause1.activeRun?.combatWaitingDecision).toBe(true);

    const tacticalBar = app.byTestId(TEST_IDS.COMBAT_TACTICAL_BAR);
    await expect(tacticalBar).toBeVisible();
    await expect(tacticalBar).toContainText(/紧急护盾/);
    await expect(tacticalBar).toContainText(/聚焦校准/);

    const emergencyShieldBtn = tacticalBar
      .locator('[data-testid="tactical-order-emergency_shield"], [data-testid="tactical-order-emergency_defense"]')
      .or(tacticalBar.getByRole('button', { name: /紧急护盾/ }))
      .first();
    await expect(emergencyShieldBtn).toBeVisible();
    await expect(emergencyShieldBtn).toBeEnabled();
    let predictedAfterLastOrder: number | null =
      (await readOrderPredictedHp(emergencyShieldBtn)) ?? (await readPreviewFinalHp(page));
    await emergencyShieldBtn.click();

    // Advance to second decision pause or finish; if second pause arrives, issue 聚焦校准 and record updated preview HP
    const midSnap = await app.waitForInspect(
      (s) =>
        s.activeRun?.combatWaitingDecision === true ||
        s.phase === 'REWARD' ||
        s.phase === 'SETTLEMENT',
      20_000,
      'Act II Boss phase shift or completion after 紧急护盾',
    );

    if (midSnap.activeRun?.combatWaitingDecision) {
      const focusBtn = tacticalBar
        .locator('[data-testid="tactical-order-focus_calibrate"]')
        .or(tacticalBar.getByRole('button', { name: /聚焦校准/ }))
        .first();
      await expect(focusBtn).toBeVisible();
      await expect(focusBtn).toBeEnabled();
      const focusPredicted =
        (await readOrderPredictedHp(focusBtn)) ?? (await readPreviewFinalHp(page));
      await focusBtn.click();
      predictedAfterLastOrder =
        focusPredicted ?? (await readPreviewFinalHp(page)) ?? predictedAfterLastOrder;
    }

    const doneSnap = await app.waitForInspect(
      (s) => s.phase === 'REWARD' || s.phase === 'SETTLEMENT',
      20_000,
      'Act II Boss battle completion',
    );
    expect(doneSnap.activeRun?.combatWaitingDecision).toBe(false);
    expect(
      predictedAfterLastOrder,
      'Tactical preview must expose numeric predicted post-combat HP',
    ).not.toBeNull();
    expect(doneSnap.activeRun?.hp).toBe(predictedAfterLastOrder);

    const stored = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(stored?.activeRun?.tacticalChargesUsed).toBeGreaterThanOrEqual(1);
    expect(stored?.activeRun?.sectorId).toBe('frozen_graveyard');

    monitor.assertClean(doneSnap);
  });

  test('T3-P1-02 Sector 3 Gravity Tide × 火力过载 × Act III 3-Phase Boss (黑曜利维坦) survives mid-Phase-2 reload without drift', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const save = presetBossEncounterV3(3);
    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 31002 });

    const combatScreen = app.byTestId(TEST_IDS.COMBAT_SCREEN);
    await expect(combatScreen).toBeVisible();
    await expect(combatScreen).toContainText(BOSS_NAMES.act3);
    await expect(combatScreen).toContainText(new RegExp(`${SECTOR_NAMES.stargate_abyss}|引力|潮汐|黑曜`));

    const preSnap = await app.inspect();
    expect(preSnap.bgmTrack).toBe('boss');
    expect(preSnap.activeRun?.sectorId).toBe('stargate_abyss');
    expect(preSnap.activeRun?.isFinalCampaignRun).toBe(true);

    await app.startCombat();

    // Pause #1: issue 火力过载
    const pause1 = await app.waitForInspect(
      (s) => s.activeRun?.combatWaitingDecision === true,
      15_000,
      'Leviathan Phase 1 tactical pause',
    );
    expect(pause1.activeRun?.combatWaitingDecision).toBe(true);

    const tacticalBar = app.byTestId(TEST_IDS.COMBAT_TACTICAL_BAR);
    const overloadBtn = tacticalBar
      .locator('[data-testid="tactical-order-overload"]')
      .or(tacticalBar.getByRole('button', { name: /火力过载/ }))
      .first();
    await expect(overloadBtn).toBeVisible();
    await overloadBtn.click();

    // Unconditionally require Phase 2 tactical pause on 3-phase Leviathan (2 charges)
    const pause2 = await app.waitForInspect(
      (s) => s.activeRun?.combatWaitingDecision === true,
      20_000,
      'Leviathan Phase 2 tactical pause must trigger before battle ends',
    );
    expect(pause2.activeRun?.combatWaitingDecision).toBe(true);

    const beforeReloadSave = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    const savedRound = pause2.activeRun?.combatRound;
    const savedHp = pause2.activeRun?.hp;
    const savedChargesUsed = beforeReloadSave?.activeRun?.tacticalChargesUsed ?? 0;

    // Real browser reload mid-boss-decision must restore exact phase, round, HP & charges
    await page.reload({ waitUntil: 'domcontentloaded' });
    const afterReload = await app.waitForInspect(
      (s) => s.activeRun?.combatWaitingDecision === true && s.phase === 'ENCOUNTER',
      15_000,
      'Leviathan Phase 2 tactical pause restored after reload',
    );
    expect(afterReload.activeRun?.combatRound).toBe(savedRound);
    expect(afterReload.activeRun?.hp).toBe(savedHp);
    expect(afterReload.activeRun?.sectorId).toBe('stargate_abyss');

    const afterReloadSave = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(afterReloadSave?.activeRun?.tacticalChargesUsed).toBe(savedChargesUsed);

    // Issue Hull Signature Command (4th order button in tactical bar)
    const sigBtn = app
      .byTestId(TEST_IDS.COMBAT_TACTICAL_BAR)
      .locator('[data-testid^="tactical-order-"]:not([disabled])')
      .last();
    await expect(sigBtn).toBeVisible();
    await sigBtn.click();

    // Complete remaining phases cleanly
    for (let step = 0; step < 3; step += 1) {
      const snap = await app.waitForInspect(
        (s) =>
          s.screen === 'ending' ||
          s.phase === 'REWARD' ||
          s.phase === 'SETTLEMENT' ||
          s.activeRun?.combatWaitingDecision === true,
        20_000,
        `Leviathan final phase resolution step ${step + 1}`,
      );
      if (snap.activeRun?.combatWaitingDecision) {
        await app
          .byTestId(TEST_IDS.COMBAT_TACTICAL_BAR)
          .locator('[data-testid^="tactical-order-"]:not([disabled])')
          .first()
          .click();
      } else {
        break;
      }
    }

    const endSnap = await app.inspect();
    expect(
      endSnap.screen === 'ending' || endSnap.phase === 'REWARD' || endSnap.phase === 'SETTLEMENT',
    ).toBe(true);
    monitor.assertClean(endSnap);
  });

  test('T3-P1-03 Sector 1 Baseline × Hull Signature Commands (cannon_skiff vs shield_cruiser) × Act I Boss (铁砧号)', async ({
    browser,
  }) => {
    const buildAct1BossSave = (shipId: 'cannon_skiff' | 'shield_cruiser'): V3SaveData => {
      const base = presetAct1V3({
        selectedShipId: shipId,
        unlockedShips: ['cannon_skiff', 'shield_cruiser'],
      });
      const graph = createMapGraph({
        maxLayers: 6,
        bossKind: 'boss_anvil',
        bossId: 'boss_anvil',
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
        activeRun: createV3RunFixture({
          runId: `run_sig_${shipId}`,
          seed: 31003,
          sectorId: 'near_orbit',
          shipId,
          phase: 'ENCOUNTER',
          currentNodeId: 'L6A',
          graph,
          bay,
          overrides: {
            visitedNodeIds: ['L1A', 'L2A', 'L3A', 'L4A', 'L5A', 'L6A'],
            tacticalChargesMax: 2,
            tacticalChargesUsed: 0,
            activeCombat: null,
          },
        }),
      };
    };

    const runWithHull = async (
      shipId: 'cannon_skiff' | 'shield_cruiser',
    ): Promise<{ signatureLabel: string; finalHp: number; predictedHp: number | null }> => {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      const p = await ctx.newPage();
      const mon = attachZeroErrorMonitors(p);
      const drv = createAppDriver(p);

      await drv.seedStorage({ v2Save: buildAct1BossSave(shipId), skipTitleScreen: true });
      await drv.boot({ seed: 31003 });

      const screen = drv.byTestId(TEST_IDS.COMBAT_SCREEN);
      await expect(screen).toBeVisible();
      await expect(screen).toContainText(BOSS_NAMES.act1);

      await drv.startCombat();
      await drv.waitForInspect(
        (s) => s.activeRun?.combatWaitingDecision === true,
        15_000,
        `${shipId} Act I boss tactical prompt`,
      );

      const bar = drv.byTestId(TEST_IDS.COMBAT_TACTICAL_BAR);
      const orderBtns = bar.locator('[data-testid^="tactical-order-"]');
      expect(await orderBtns.count()).toBeGreaterThanOrEqual(4);

      // The hull Signature Command is distinct from the 3 universal orders
      const sigBtn = bar
        .locator('[data-testid^="tactical-order-signature"], [data-tactical-signature="true"]')
        .or(orderBtns.nth(3))
        .first();
      await expect(sigBtn).toBeVisible();
      const signatureLabel = ((await sigBtn.textContent()) ?? '').trim();
      expect(signatureLabel.length).toBeGreaterThan(0);

      let predictedHp: number | null =
        (await readOrderPredictedHp(sigBtn)) ?? (await readPreviewFinalHp(p));
      await sigBtn.click();

      // Finish battle (handling optional 2nd tactical prompt)
      for (let i = 0; i < 3; i += 1) {
        const snap = await drv.waitForInspect(
          (s) =>
            s.phase === 'REWARD' ||
            s.phase === 'SETTLEMENT' ||
            s.activeRun?.combatWaitingDecision === true,
          20_000,
          `${shipId} Act I boss step ${i + 1}`,
        );
        if (snap.activeRun?.combatWaitingDecision) {
          const nextOrderBtn = bar.locator('[data-testid^="tactical-order-"]:not([disabled])').first();
          await expect(nextOrderBtn).toBeVisible();
          const nextPredicted =
            (await readOrderPredictedHp(nextOrderBtn)) ?? (await readPreviewFinalHp(p));
          await nextOrderBtn.click();
          predictedHp = nextPredicted ?? (await readPreviewFinalHp(p)) ?? predictedHp;
        } else {
          break;
        }
      }

      const finalSnap = await drv.inspect();
      mon.assertClean(finalSnap);
      await ctx.close();
      return {
        signatureLabel,
        finalHp: finalSnap.activeRun?.hp ?? -1,
        predictedHp,
      };
    };

    const skiffResult = await runWithHull('cannon_skiff');
    const cruiserResult = await runWithHull('shield_cruiser');

    // Distinct hulls MUST present distinct Signature Command labels/mechanics & exact preview parity
    expect(skiffResult.signatureLabel).not.toBe(cruiserResult.signatureLabel);
    expect(
      skiffResult.predictedHp,
      'cannon_skiff must report numeric predicted post-combat HP',
    ).not.toBeNull();
    expect(
      cruiserResult.predictedHp,
      'shield_cruiser must report numeric predicted post-combat HP',
    ).not.toBeNull();
    expect(skiffResult.finalHp).toBe(skiffResult.predictedHp);
    expect(cruiserResult.finalHp).toBe(cruiserResult.predictedHp);
  });

  test('T3-P1-04 Pure-Auto toggle × Sector 2 modifier × Multi-Phase Boss executes seamlessly with exact preview HP', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const save = presetBossEncounterV3(2);
    save.settings.pureAutoCombat = false;
    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 31004 });

    // Enable Pure-Auto via Settings UI before starting combat
    const settingsBtn = page.getByRole('button', { name: /设置/ }).first();
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();

    const pureAutoToggle = page
      .locator('[role="dialog"]')
      .getByLabel(/纯自动|自动战斗/)
      .or(page.locator('[role="dialog"] button:has-text("纯自动")'))
      .first();
    await expect(pureAutoToggle).toBeVisible();
    await pureAutoToggle.click();
    await app.closeModal();

    const combatScreen = app.byTestId(TEST_IDS.COMBAT_SCREEN);
    await expect(combatScreen).toBeVisible();
    await expect(combatScreen).toContainText(BOSS_NAMES.act2);

    const predictedHp = await readPreviewFinalHp(page);
    expect(predictedHp, 'Boss preview must render numeric predicted HP under Sector 2 modifier').not.toBeNull();

    await app.startCombat();
    await app.skipCombat();

    const doneSnap = await app.waitForInspect(
      (s) => s.phase === 'REWARD' || s.phase === 'SETTLEMENT',
      20_000,
      'Pure-Auto multi-phase boss resolution without decision stall',
    );
    expect(doneSnap.activeRun?.combatWaitingDecision).toBe(false);
    expect(doneSnap.activeRun?.hp).toBe(predictedHp);

    monitor.assertClean(doneSnap);
  });
});
