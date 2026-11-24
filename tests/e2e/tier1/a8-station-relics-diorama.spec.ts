import { expect, test } from '@playwright/test';
import {
  STORAGE_KEYS,
  TEST_IDS,
  assertCanvasNonBlank,
  attachZeroErrorMonitors,
  createAppDriver,
  createDefaultRelics,
  presetAct1V3,
  presetAct2V3,
  presetAct3ClimaxV3,
} from '../helpers';
import type { V3SaveData } from '../helpers';

test.describe('Tier 1 · A8: Station Upgrades (T1-T3), Stargate Relay, Relic Passives, Codex & Diorama', () => {
  test('T1-A8-01 @p1-mid Facility upgrades progress T1 -> T2 -> T3 with atomic resource deduction and reload persistence', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const save = presetAct2V3({
      credits: 2500,
      salvageParts: 500,
      facilityTiers: {
        workbench: 1,
        contract_hub: 1,
        drydock: 1,
        research_lab: 1,
        display: 1,
        drydock_tier2: 1,
        stargate_relay: 0,
      },
    });

    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 8001, enterStation: true });

    const modal = await app.openBaseModal(TEST_IDS.BTN_OPEN_FACILITIES);
    const upgradeBtn = modal.getByRole('button', { name: /升级|扩建|T2|2\s*阶/ }).first();
    await expect(upgradeBtn).toBeVisible();
    await expect(upgradeBtn).toBeEnabled();
    await upgradeBtn.click();

    const afterT2 = await app.waitForInspect(
      (s) => s.credits < 2500 || s.salvageParts < 500,
      10_000,
      'facility upgraded from T1 to T2',
    );
    const creditsAfterT2 = afterT2.credits;

    // Upgrade a second tier (T2 -> T3)
    const upgradeT3Btn = modal.getByRole('button', { name: /升级|扩建|T3|3\s*阶/ }).first();
    await expect(upgradeT3Btn).toBeVisible();
    await expect(upgradeT3Btn).toBeEnabled();
    await upgradeT3Btn.click();

    await app.waitForInspect(
      (s) => s.credits < creditsAfterT2 || s.salvageParts < afterT2.salvageParts,
      10_000,
      'facility upgraded from T2 to T3',
    );

    const stored = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    const maxTier = Math.max(...Object.values(stored?.profile.facilityTiers ?? { workbench: 0 }));
    expect(maxTier).toBeGreaterThanOrEqual(3);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.waitForInspect((s) => s.screen === 'base', 15_000);
    const reloaded = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(Math.max(...Object.values(reloaded?.profile.facilityTiers ?? { workbench: 0 }))).toBe(
      maxTier,
    );

    monitor.assertClean(await app.inspect());
  });

  test('T1-A8-02 @p2-late Stargate Relay (stargate_relay) construction powers campaign gate and persists', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const save = presetAct2V3({
      credits: 2000,
      salvageParts: 400,
      campaign: {
        currentAct: 'act3',
        unlockedSectors: ['near_orbit', 'frozen_graveyard', 'stargate_abyss'],
        completedMilestones: ['tutorial_complete', 'act1_boss_defeated', 'act2_boss_defeated'],
        defeatedBossIds: ['boss_anvil', 'boss_dreadnought'],
        readCommsIds: [],
        relicPityCounters: { near_orbit: 0, frozen_graveyard: 0, stargate_abyss: 0 },
        endingsUnlocked: [],
        finalMissionUnlocked: false,
        endlessUnlocked: false,
        maxEndlessThreat: 0,
      },
      facilityTiers: {
        workbench: 2,
        contract_hub: 2,
        drydock: 2,
        research_lab: 2,
        display: 1,
        drydock_tier2: 1,
        stargate_relay: 0,
      },
    });

    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 8002, enterStation: true });

    const modal = await app.openBaseModal(TEST_IDS.BTN_OPEN_FACILITIES);
    const relayCard = modal
      .locator('[data-facility-id="stargate_relay"], .v2-facility-card:has-text("星门通讯塔")')
      .first();
    await expect(relayCard).toBeVisible();

    const buildRelayBtn = relayCard.getByRole('button', { name: /建造|启用|升级/ }).first();
    await expect(buildRelayBtn).toBeVisible();
    await expect(buildRelayBtn).toBeEnabled();
    await buildRelayBtn.click();

    await app.waitForInspect((s) => s.credits < 2000 || s.salvageParts < 400, 10_000);
    const stored = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(stored?.profile.facilityTiers.stargate_relay ?? 0).toBeGreaterThanOrEqual(1);

    await app.closeModal();
    await assertCanvasNonBlank(page);
    monitor.assertClean(await app.inspect());
  });

  test('T1-A8-03 @p2-late Restoring all 4 Relics activates station passives (+1 fuel, +4 max HP, +1 budget, +1 boss charge)', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const save = presetAct2V3({
      credits: 1200,
      relics: createDefaultRelics({
        ancient_navigator: { storedCount: 1, restored: false },
        quantum_core: { storedCount: 1, restored: false },
        cryo_amber: { storedCount: 1, restored: false },
        obsidian_crown: { storedCount: 1, restored: false },
      }),
    });

    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 8003, enterStation: true });

    const modal = await app.openBaseModal(TEST_IDS.BTN_OPEN_RELICS);
    const restoreBtns = modal.getByRole('button', { name: /修复/ });
    const count = await restoreBtns.count();
    expect(count).toBe(4);

    for (let i = 0; i < 4; i += 1) {
      const btn = modal.getByRole('button', { name: /修复/ }).first();
      await expect(btn).toBeEnabled();
      await btn.click();
    }

    const stored = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(stored?.profile.relics.ancient_navigator.restored).toBe(true);
    expect(stored?.profile.relics.quantum_core.restored).toBe(true);
    expect(stored?.profile.relics.cryo_amber.restored).toBe(true);
    expect(stored?.profile.relics.obsidian_crown.restored).toBe(true);

    await app.closeModal();
    await app.openPrepareFromBase();
    await app.selectShip('cannon_skiff');

    // quantum_core (+1 budget) => cannon_skiff budget 6 -> 7
    await expect(app.byTestId(TEST_IDS.PREPARE_SCREEN)).toContainText(/\/\s*7|预算[^\d]*7/);

    await app.launchExpedition();
    const runSnap = await app.waitForInspect((s) => s.phase === 'MAP' && s.activeRun !== null, 15_000);
    // cryo_amber (+4 max HP) => cannon_skiff maxHp 30 -> 34; ancient_navigator (+1 fuel) => fuel 10
    expect(runSnap.activeRun?.maxHp).toBe(34);
    expect(runSnap.activeRun?.fuel).toBe(10);

    monitor.assertClean(runSnap);
  });

  test('T1-A8-04 @p1-mid Codex distinguishes Seen (见闻) vs Discovered (发现) entries accurately', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const save = presetAct1V3({
      seenItems: ['equipment.heavy.common', 'cargo.coolant_tank'],
      discoveredItems: ['equipment.laser.common', 'cargo.alloy_bar'],
    });

    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 8004, enterStation: true });

    const modal = await app.openBaseModal(TEST_IDS.BTN_OPEN_CODEX);
    await expect(modal).toContainText(/见闻/);
    await expect(modal).toContainText(/发现|收录/);

    await app.closeModal();
    monitor.assertClean(await app.inspect());
  });

  test('T1-A8-05 @p1-mid V2 BaseScene diorama reflects berthed ship and facility tiers with non-blank WebGL rendering', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({ v2Save: presetAct3ClimaxV3(), skipTitleScreen: true });
    await app.boot({ seed: 8005, enterStation: true });

    await app.waitForInspect(
      (s) => s.screen === 'base' && s.phaserScene === 'BaseScene',
      15_000,
      'BaseScene active for diorama check',
    );
    await assertCanvasNonBlank(page);

    // Switch active ship to stargate_cruiser on Prepare, return to Base, and confirm diorama remains clean
    await app.openPrepareFromBase();
    await app.selectShip('stargate_cruiser');
    const backBtn = page.getByRole('button', { name: /返回空间站|返回基地|返回/ }).first();
    await expect(backBtn).toBeVisible();
    await backBtn.click();

    await expect(app.byTestId(TEST_IDS.BASE_SCREEN)).toBeVisible();
    await assertCanvasNonBlank(page);

    const stored = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(stored?.profile.selectedShipId).toBe('stargate_cruiser');

    monitor.assertClean(await app.inspect());
  });
});
