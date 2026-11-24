import { expect, test } from '@playwright/test';
import {
  STORAGE_KEYS,
  TEST_IDS,
  V3_SCHEMA_VERSION,
  attachZeroErrorMonitors,
  createAppDriver,
  createV1SaveFixture,
  presetAct2V3,
} from '../helpers';
import type { V1SaveData, V3SaveData } from '../helpers';

test.describe('Tier 4 · J4: Legacy V1 (?mode=v1) Coexistence & Non-Interference', () => {
  test('T4-04 Switching to ?mode=v1 and playing V1 leaves V3 save, credits, campaign act & diorama 100% untouched upon ?mode=v2 return', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Establish a rich V3 save in starline_save_v2 plus an initial V1 save in starline_save_v1
    const v3Initial = presetAct2V3({
      credits: 777,
      salvageParts: 155,
      totalRuns: 9,
    });
    const v1Initial = createV1SaveFixture({ credits: 140, totalExpeditions: 2 });

    await app.seedStorage({
      v2Save: v3Initial,
      v1Save: v1Initial,
      skipTitleScreen: true,
    });

    // Boot V3 first and verify baseline V3 state
    await app.boot({ mode: 'v2', seed: 44001, enterStation: true });
    const v3BeforeSnap = await app.inspect();
    expect(v3BeforeSnap.mode).toBe('v2');
    expect(v3BeforeSnap.schemaVersion).toBe(V3_SCHEMA_VERSION);
    expect(v3BeforeSnap.credits).toBe(777);
    expect(v3BeforeSnap.campaignAct).toBe('act2');
    const v3RawBefore = await app.readStorageRaw(STORAGE_KEYS.V2_SAVE);
    expect(v3RawBefore).not.toBeNull();

    // Navigate to legacy V1 mode via ?mode=v1
    await app.boot({ mode: 'v1' });
    expect(await app.readSessionStorage(STORAGE_KEYS.SESSION_ACTIVE_MODE)).toBe('v1');

    // Verify V1 DOM indicators: .app-shell without .v2-shell, plus #btn-return-to-v2 pill
    await expect(page.locator('#app .app-shell:not(.v2-shell)')).toBeVisible();
    const returnV2Pill = page.locator('#btn-return-to-v2');
    await expect(returnV2Pill).toBeVisible();

    // Enter V1 station & launch a V1 expedition unconditionally to exercise V1 persistence path
    const v1EnterBtn = page
      .locator('#btn-enter-game, .title-screen button')
      .or(page.getByRole('button', { name: /进入|开始|继续/ }))
      .first();
    await expect(v1EnterBtn).toBeVisible();
    await v1EnterBtn.click();

    const v1LaunchBtn = page
      .locator('#btn-launch-expedition')
      .or(page.getByRole('button', { name: /出发|启航|开始远航/ }))
      .first();
    await expect(v1LaunchBtn).toBeVisible();
    await expect(v1LaunchBtn).toBeEnabled();
    await v1LaunchBtn.click();

    // Confirm V1 actively persisted its own starline_save_v1 state
    await expect
      .poll(
        async () => {
          const s = await app.readStorageJson<V1SaveData>(STORAGE_KEYS.V1_SAVE);
          return s?.schemaVersion === 1 && s?.activeExpedition !== null;
        },
        { timeout: 10_000, message: 'V1 launch must persist activeExpedition into starline_save_v1' },
      )
      .toBe(true);

    // Explicitly pass ?mode=v2 to override sessionStorage['starline_active_mode'] === 'v1'
    await app.boot({ mode: 'v2', seed: 44002, enterStation: true });
    expect(await app.readSessionStorage(STORAGE_KEYS.SESSION_ACTIVE_MODE)).toBe('v2');
    await expect(page.locator('#btn-return-to-v2')).toHaveCount(0);
    await expect(app.byTestId(TEST_IDS.BASE_SCREEN)).toBeVisible();

    const v3AfterSnap = await app.inspect();
    expect(v3AfterSnap.mode).toBe('v2');
    expect(v3AfterSnap.schemaVersion).toBe(V3_SCHEMA_VERSION);
    expect(v3AfterSnap.credits).toBe(777);
    expect(v3AfterSnap.salvageParts).toBe(155);
    expect(v3AfterSnap.campaignAct).toBe('act2');

    const v3StoredAfter = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(v3StoredAfter?.profile.credits).toBe(777);
    expect(v3StoredAfter?.profile.totalRuns).toBe(9);
    expect(v3StoredAfter?.profile.campaign.currentAct).toBe('act2');
    expect(v3StoredAfter?.profile.campaign.defeatedBossIds).toContain('boss_anvil');

    monitor.assertClean(v3AfterSnap);
  });
});
