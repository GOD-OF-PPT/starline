import { expect, test } from '@playwright/test';
import {
  STORAGE_KEYS,
  TEST_IDS,
  attachZeroErrorMonitors,
  createAppDriver,
  presetAct2V3,
  presetBossEncounterV3,
  presetSettlementV3,
} from '../helpers';
import type { V3SaveData } from '../helpers';

test.describe('Tier 5 · White-Box Adversarial Hardening (M7 Phase 2)', () => {
  test('T5-01 Rapid post-boot combat launch resists PhaserHost mid-preload race and keeps #v2-combat-skip DOM identity stable across rounds', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const bossSave = presetBossEncounterV3(1);
    bossSave.settings.pureAutoCombat = true;
    bossSave.settings.combatSpeed = 2;

    await app.seedStorage({ v2Save: bossSave, skipTitleScreen: true });
    await app.boot({ seed: 95001 });

    // Immediately click Start Combat without waiting for Phaser asset preload to finish
    await app.startCombat();

    // Stamp the live #v2-combat-skip button DOM node and confirm combat advances past Round 0
    // WITHOUT detaching/recreating the skip button across round updates.
    const skipBtn = app.byTestId(TEST_IDS.BTN_COMBAT_SKIP);
    await expect(skipBtn).toBeVisible({ timeout: 15_000 });
    await skipBtn.evaluate((el) => {
      (el as HTMLElement & { __t5IdentityToken?: string }).__t5IdentityToken = 'stable_skip_node';
    });

    await app.waitForInspect(
      (s) =>
        (s.activeRun?.combatRound !== null && (s.activeRun?.combatRound ?? 0) >= 2) ||
        s.phase === 'REWARD',
      15_000,
      'Boss combat advances past Round 2 without mid-preload Round-0 freeze',
    );

    if ((await app.inspect()).phase === 'ENCOUNTER') {
      const stillSameNode = await skipBtn.evaluate(
        (el) =>
          (el as HTMLElement & { __t5IdentityToken?: string }).__t5IdentityToken ===
          'stable_skip_node',
      );
      expect(stillSameNode).toBe(true);
      await skipBtn.click();
    }

    await app.waitForInspect(
      (s) => s.phase === 'REWARD' || s.phase === 'SETTLEMENT',
      15_000,
      'Combat finishes cleanly after stable skip click',
    );

    monitor.assertClean(await app.inspect());
  });

  test('T5-02 Base station dock buttons stay mounted and clickable during active return-docking animation', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const settlementSave = presetSettlementV3({ reason: 'safe_return', wallet: 60 });
    settlementSave.settings.reducedMotion = false;

    await app.seedStorage({ v2Save: settlementSave, skipTitleScreen: true });
    await app.boot({ seed: 95002 });

    await expect(app.byTestId(TEST_IDS.SETTLEMENT_SCREEN)).toBeVisible();
    await app.confirmSettlement();

    // Immediately verify dock button identity remains stable while BaseScene docking progress animates
    const whBtn = app.byTestId(TEST_IDS.BTN_OPEN_WAREHOUSE);
    await expect(whBtn).toBeVisible();
    await whBtn.evaluate((el) => {
      (el as HTMLElement & { __t5DockToken?: string }).__t5DockToken = 'stable_dock_node';
    });

    await page.waitForTimeout(350);
    const sameDockNode = await whBtn.evaluate(
      (el) =>
        (el as HTMLElement & { __t5DockToken?: string }).__t5DockToken === 'stable_dock_node',
    );
    expect(sameDockNode).toBe(true);

    const dialog = await app.openBaseModal(TEST_IDS.BTN_OPEN_WAREHOUSE);
    await expect(dialog).toBeVisible();
    await app.closeModal();

    monitor.assertClean(await app.inspect());
  });

  test('T5-03 Rapid double-click on Relic restoration debits credits strictly once and prevents double-mutation', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const save = presetAct2V3({ credits: 300 });
    save.profile.relics.ancient_navigator = { storedCount: 1, restored: false };

    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 95003, enterStation: true });

    const creditsBefore = (await app.inspect()).credits;
    const relicsModal = await app.openBaseModal(TEST_IDS.BTN_OPEN_RELICS);
    const restoreBtn = relicsModal
      .locator('[data-restore-relic="ancient_navigator"]')
      .or(relicsModal.locator('button:not([disabled])').filter({ hasText: /修复|陈列/ }))
      .first();
    await expect(restoreBtn).toBeVisible();

    // Rapid double-click simulation
    await restoreBtn.dblclick();

    await expect
      .poll(async () => (await app.inspect()).credits, {
        timeout: 5_000,
        message: 'Relic restoration debits credits atomically once',
      })
      .toBeLessThan(creditsBefore);

    const creditsAfter = (await app.inspect()).credits;
    expect(creditsAfter).toBe(creditsBefore - 60);

    const stored = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(stored?.profile.relics.ancient_navigator.restored).toBe(true);
    expect(stored?.profile.credits).toBe(creditsBefore - 60);

    await app.closeModal();
    monitor.assertClean(await app.inspect());
  });

  test('T5-04 window.__STARLINE_INSPECT__() is strictly read-only and returns isolated defensive copies', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({ v2Save: presetAct2V3({ credits: 500 }), skipTitleScreen: true });
    await app.boot({ seed: 95004, enterStation: true });

    const tamperProbe = await page.evaluate(() => {
      const fn = (window as unknown as { __STARLINE_INSPECT__?: () => Record<string, unknown> })
        .__STARLINE_INSPECT__;
      if (typeof fn !== 'function') return { ok: false, reason: 'missing' };

      const ownKeys = Object.keys(fn);
      const snap1 = fn() as {
        credits: number;
        unlockedSectors: string[];
        endingsUnlocked: string[];
        failedAssets: string[];
      };
      const origSectors = [...snap1.unlockedSectors];
      const origEndings = [...snap1.endingsUnlocked];
      const origCredits = snap1.credits;

      // Attempt to tamper with returned snapshot arrays & fields
      snap1.unlockedSectors.push('tampered_sector');
      snap1.endingsUnlocked.push('tampered_ending');
      snap1.failedAssets.push('tampered_asset');
      snap1.credits = 999999;

      const snap2 = fn() as typeof snap1;
      return {
        ok: true,
        ownKeys,
        sectorsUnchanged: JSON.stringify(snap2.unlockedSectors) === JSON.stringify(origSectors),
        endingsUnchanged: JSON.stringify(snap2.endingsUnlocked) === JSON.stringify(origEndings),
        failedAssetsEmpty: snap2.failedAssets.length === 0,
        creditsUnchanged: snap2.credits === origCredits,
      };
    });

    expect(tamperProbe.ok).toBe(true);
    expect(tamperProbe.ownKeys).toEqual([]);
    expect(tamperProbe.sectorsUnchanged).toBe(true);
    expect(tamperProbe.endingsUnchanged).toBe(true);
    expect(tamperProbe.failedAssetsEmpty).toBe(true);
    expect(tamperProbe.creditsUnchanged).toBe(true);

    monitor.assertClean(await app.inspect());
  });
});
