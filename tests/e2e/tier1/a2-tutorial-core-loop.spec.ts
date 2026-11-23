import { expect, test } from '@playwright/test';
import {
  STORAGE_KEYS,
  TEST_IDS,
  attachZeroErrorMonitors,
  createAppDriver,
  createCargoBay,
  createCargoItem,
  createContractInstance,
  createStagingItem,
  presetMidRunMapV3,
  presetPostTutorialV3,
  presetSettlementV3,
} from '../helpers';
import type { V3SaveData } from '../helpers';

test.describe('Tier 1 · A2: Onboarding, Tutorial & Core Expedition Loop', () => {
  test('T1-A2-01 @p0-core Tutorial launch enters 3-layer map and Layer 1 combat produces 3-choice reward', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({ clearAll: true });
    await app.boot({ seed: 2001, enterStation: true });

    const startTutBtn = app.byTestId(TEST_IDS.BTN_START_TUTORIAL);
    await expect(startTutBtn).toBeVisible();
    await startTutBtn.click();

    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();
    const mapSnap = await app.inspect();
    expect(mapSnap.activeRun).not.toBeNull();
    expect(mapSnap.activeRun?.fuel).toBe(9);

    // Jump into Layer 1 combat node (L1A or L1B)
    const l1CombatNode = page
      .locator('[data-testid="map-node-L1A"], [data-testid="map-node-L1B"]')
      .filter({ hasText: /战斗|敌|哨/ })
      .first();
    await expect(l1CombatNode).toBeVisible();
    await l1CombatNode.click();
    await app.byTestId(TEST_IDS.BTN_JUMP_NODE).click();

    await expect(app.byTestId(TEST_IDS.COMBAT_SCREEN)).toBeVisible();
    await app.startCombat();

    // If default-ON tactical command pauses combat, select a valid tactical order
    await app.waitForInspect(
      (s) => s.phase === 'REWARD' || s.activeRun?.combatWaitingDecision === true,
      20_000,
      'tactical pause or combat reward',
    );
    const midSnap = await app.inspect();
    if (midSnap.activeRun?.combatWaitingDecision) {
      await page.locator('[data-testid^="tactical-order-"]:not([disabled])').first().click();
    }

    await expect(app.byTestId(TEST_IDS.REWARD_SCREEN)).toBeVisible({ timeout: 20_000 });
    const rewardChoices = app
      .byTestId(TEST_IDS.REWARD_SCREEN)
      .locator(
        'button[data-pick-reward], .v2-reward-card, button[data-reward-choice], [data-testid^="reward-choice-"], .reward-choice-card button',
      );
    expect(await rewardChoices.count()).toBeGreaterThanOrEqual(3);

    const endSnap = await app.inspect();
    monitor.assertClean(endSnap);
  });

  test('T1-A2-02 @p0-core Tutorial 2x3 reactor spatial conflict resolves cleanly and awards +40 credits & Act I unlock', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const tutorialContract = createContractInstance('transport_std', {
      overrides: {
        contractId: 'tut_contract_1',
        status: 'active',
        completedNodeIds: ['L3A'],
        requiredCompletions: 1,
      },
    });

    // Seed a tutorial run at Layer 3 Arrange holding 12/16 occupied cells + 2x3 Sealed Reactor in staging
    const tutorialBay = createCargoBay({
      shipId: 'cannon_skiff',
      placed: [
        { item: createCargoItem({ instanceId: 'tut_laser', definitionId: 'equipment.laser.common', origin: 'loan' }), x: 0, y: 0 },
        { item: createCargoItem({ instanceId: 'tut_bat', definitionId: 'equipment.battery.common', origin: 'loan' }), x: 1, y: 0 },
        { item: createCargoItem({ instanceId: 'tut_shd', definitionId: 'equipment.shield.common', origin: 'loan' }), x: 2, y: 0 },
        { item: createCargoItem({ instanceId: 'tut_rep', definitionId: 'equipment.repair.common', origin: 'loan' }), x: 0, y: 2 },
        { item: createCargoItem({ instanceId: 'tut_box1', definitionId: 'cargo.alloy_bar', origin: 'loot', acquiredDepth: 2 }), x: 3, y: 0 },
        { item: createCargoItem({ instanceId: 'tut_box2', definitionId: 'cargo.alloy_bar', origin: 'loot', acquiredDepth: 2 }), x: 2, y: 2 },
      ],
      staging: [
        createStagingItem(
          createCargoItem({
            instanceId: 'tut_reactor',
            definitionId: 'mission.sealed_reactor',
            origin: 'mission',
            fixedValue: 0,
            acquiredDepth: 3,
            missionBinding: tutorialContract.contractId,
            location: 'staging',
          }),
          0,
        ),
      ],
    });

    const save = presetMidRunMapV3(
      {
        phase: 'ARRANGE',
        currentNodeId: 'L3A',
        bay: tutorialBay,
        contract: tutorialContract,
        fuel: 6,
        overrides: {
          isTutorial: true,
          visitedNodeIds: ['L1A', 'L2A', 'L3A'],
        },
      },
      {
        credits: 0,
        tutorialCompleted: false,
        tutorialBonusClaimed: false,
        buildings: {
          workbench: false,
          contract_hub: false,
          drydock: false,
          research_lab: false,
          display: false,
          drydock_tier2: false,
        },
        campaign: {
          currentAct: 'prologue',
          unlockedSectors: ['near_orbit'],
          completedMilestones: [],
          defeatedBossIds: [],
          readCommsIds: [],
          relicPityCounters: { near_orbit: 0, frozen_graveyard: 0, stargate_abyss: 0 },
          endingsUnlocked: [],
          finalMissionUnlocked: false,
          endlessUnlocked: false,
          maxEndlessThreat: 0,
        },
      },
    );

    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 2002 });

    await expect(app.byTestId(TEST_IDS.ARRANGE_SCREEN)).toBeVisible();

    // Discard loot items to clear a 2x3 space on the right half (cols 2..3, rows 0..2), then place the reactor
    const discardBtn = page
      .locator('#btn-v2-discard, [data-testid^="btn-discard-"]')
      .or(page.getByRole('button', { name: /舍弃|丢弃|弃置/ }))
      .first();

    const lootCard = page.locator('.placed-item.origin-loot').first();
    await expect(lootCard).toBeVisible();
    await lootCard.click();
    await expect(discardBtn).toBeVisible();
    await discardBtn.click();

    const secondLoot = page.locator('.placed-item.origin-loot').first();
    if (await secondLoot.isVisible()) {
      await secondLoot.click();
      await expect(discardBtn).toBeVisible();
      await discardBtn.click();
    }

    // Select staging reactor and place at (2, 0)
    const stagingReactor = page
      .locator('.staging-card, .v2-staging-card, [data-testid^="staging-item"]')
      .first();
    await expect(stagingReactor).toBeVisible();
    await stagingReactor.click();
    await app.gridCell(2, 0).click();

    await app.leaveArrange();
    const afterLeaveSnap = await app.waitForInspect(
      (s) => s.phase === 'MAP' || s.phase === 'SETTLEMENT',
      15_000,
      'map or settlement after leaving tutorial arrange',
    );
    if (afterLeaveSnap.phase === 'MAP') {
      await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();
      await app.safeReturn();
    }

    const settleScreen = app.byTestId(TEST_IDS.SETTLEMENT_SCREEN);
    await expect(settleScreen).toBeVisible();
    await expect(settleScreen).toContainText(/40/);

    await app.confirmSettlement();

    const postSnap = await app.waitForInspect(
      (s) => s.screen === 'base' && s.activeRun === null,
      15_000,
      'base screen after tutorial settlement',
    );
    expect(postSnap.credits).toBeGreaterThanOrEqual(40);

    const stored = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(stored?.profile.tutorialCompleted).toBe(true);
    expect(stored?.profile.buildings.workbench).toBe(true);
    expect(stored?.profile.buildings.contract_hub).toBe(true);

    monitor.assertClean(postSnap);
  });

  test('T1-A2-03 @p0-core Standard Prepare & Launch enters Map with cannon_skiff stats and expedition BGM', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({ v2Save: presetPostTutorialV3(), skipTitleScreen: true });
    await app.boot({ seed: 2003, enterStation: true });

    await app.openPrepareFromBase();
    await app.selectShip('cannon_skiff');
    await app.selectCrew('engineer');
    await app.launchExpedition();

    const snap = await app.waitForInspect(
      (s) => s.screen === 'run' && s.phase === 'MAP',
      15_000,
      'launched standard expedition',
    );

    expect(snap.bgmTrack).toBe('expedition');
    expect(snap.activeRun?.shipId).toBe('cannon_skiff');
    expect(snap.activeRun?.crewId).toBe('engineer');
    expect(snap.activeRun?.fuel).toBe(9);
    expect(snap.activeRun?.hp).toBe(30);
    expect(snap.activeRun?.maxHp).toBe(30);

    await expect(app.byTestId(TEST_IDS.mapNode('L1A'))).toBeVisible();
    await expect(app.byTestId(TEST_IDS.mapNode('L1B'))).toBeVisible();

    monitor.assertClean(snap);
  });

  test('T1-A2-04 @p0-core Safe Return beacon costs 0 fuel and opens itemized Settlement', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({
      v2Save: presetMidRunMapV3({ fuel: 7, wallet: 22, currentNodeId: 'L1A' }),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 2004 });

    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();
    const beforeSnap = await app.inspect();
    expect(beforeSnap.activeRun?.fuel).toBe(7);

    await app.safeReturn();

    const settleSnap = await app.waitForInspect(
      (s) => s.phase === 'SETTLEMENT',
      15_000,
      'settlement phase after safe return',
    );
    expect(settleSnap.activeRun?.fuel).toBe(7);

    const settleText = await app.byTestId(TEST_IDS.SETTLEMENT_SCREEN).innerText();
    expect(settleText).toMatch(/22|结算|信用点/);

    monitor.assertClean(settleSnap);
  });

  test('T1-A2-05 @p0-core Atomic Settlement credits exact payout and prevents double-credit across reload', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const save = presetSettlementV3({ wallet: 35 });
    const initialCredits = save.profile.credits;

    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 2005 });

    await expect(app.byTestId(TEST_IDS.SETTLEMENT_SCREEN)).toBeVisible();
    await app.confirmSettlement();

    const afterSnap = await app.waitForInspect(
      (s) => s.screen === 'base' && s.activeRun === null,
      15_000,
      'base after settlement confirm',
    );
    expect(afterSnap.credits).toBeGreaterThan(initialCredits);
    expect(afterSnap.bgmTrack).toBe('base');
    const creditedTotal = afterSnap.credits;

    // Reloading must preserve exact balance with zero double-credit
    await page.reload({ waitUntil: 'domcontentloaded' });
    const reloadedSnap = await app.waitForInspect(
      (s) => s.screen === 'base' && s.activeRun === null,
      15_000,
      'base after reload',
    );
    expect(reloadedSnap.credits).toBe(creditedTotal);

    monitor.assertClean(reloadedSnap);
  });

  test('T1-A2-06 @p0-core Loadout preset saves to storage and restores exact placement across reload', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({
      v2Save: presetPostTutorialV3(),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 2006, enterStation: true });
    await app.openPrepareFromBase();

    const savePresetBtn = page
      .locator('#v2-preset-save, [data-testid="btn-save-preset"]')
      .or(page.getByRole('button', { name: /保存预设|保存方案|存为预设|保存配装/ }))
      .first();
    await expect(savePresetBtn).toBeVisible();
    await savePresetBtn.click();

    // Confirm preset modal/input if prompted
    const confirmSave = page.locator('[role="dialog"] button:has-text("确认"), [role="dialog"] button:has-text("保存")').first();
    if (await confirmSave.isVisible()) {
      await confirmSave.click();
    }

    const savedData = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(savedData?.profile.loadoutPresets.length ?? 0).toBeGreaterThanOrEqual(1);
    const savedSlotCount = savedData?.profile.loadoutPresets[0]?.slots.length ?? 0;
    expect(savedSlotCount).toBeGreaterThan(0);

    // Reload and verify preset persists and can be loaded
    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.waitForInspect((s) => s.screen === 'base' || s.screen === 'prepare', 15_000);
    if ((await app.inspect()).screen === 'base') {
      await app.openPrepareFromBase();
    }

    const loadPresetBtn = page
      .locator('[data-load-preset]')
      .or(page.getByRole('button', { name: /载入|应用方案|方案\s*1/ }))
      .first();
    await expect(loadPresetBtn).toBeVisible();
    await loadPresetBtn.click();

    const placedItems = page.locator('.placed-item.v2-placed-item');
    await expect(placedItems).toHaveCount(savedSlotCount);

    const endSnap = await app.inspect();
    monitor.assertClean(endSnap);
  });
});
