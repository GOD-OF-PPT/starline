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
  createStagingItem,
  presetMidRunMapV3,
  presetPostTutorialV3,
  presetSettlementV3,
} from '../helpers';
import type { V3SaveData } from '../helpers';

test.describe('Tier 1 · A2: Onboarding, Tutorial & Core Expedition Loop', () => {
  test('T1-A2-01 @p0-core Tutorial starts in ARRANGE to wire battery, enters 4-layer map, and Layer 1 combat yields D07 3-equipment reward + zero-heal skip', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({ clearAll: true });
    await app.boot({ seed: 2001, enterStation: true });

    await expect(app.byTestId(TEST_IDS.BASE_SCREEN)).toHaveAttribute('data-tutorial-focus', 'true');
    const startTutBtn = app.byTestId(TEST_IDS.BTN_START_TUTORIAL);
    await expect(startTutBtn).toBeVisible();
    await startTutBtn.click();

    // S01 Step 1: Tutorial starts in ARRANGE with battery.common in staging ready to wire at (1,0)
    await expect(app.byTestId(TEST_IDS.ARRANGE_SCREEN)).toBeVisible();
    const arrangeSnap = await app.inspect();
    expect(arrangeSnap.phase).toBe('ARRANGE');
    expect(arrangeSnap.activeRun?.fuel).toBe(9);

    const stagingBattery = page
      .locator('.staging-card, .v2-staging-card, [data-testid^="staging-item"]')
      .first();
    await expect(stagingBattery).toBeVisible();
    await stagingBattery.click();
    await app.gridCell(1, 0).click();

    // Wiring battery at (1,0) adjacent to laser at (0,0) activates orthogonal synergy
    await expect(page.locator('.placed-item.synergy-active')).toHaveCount(2);
    expect(await page.locator('[data-link-status="active"]').count()).toBeGreaterThanOrEqual(1);

    await app.leaveArrange();

    // S01 Step 2: 4-layer map with L1A (14HP tutorial target) -> L4A/L4B fork
    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();
    const mapSnap = await app.inspect();
    expect(mapSnap.phase).toBe('MAP');
    expect(mapSnap.activeRun?.fuel).toBe(9);
    const savedAtMap = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(savedAtMap?.activeRun?.graph.maxLayers).toBe(4);
    expect(savedAtMap?.activeRun?.graph.nodes.L1A?.combat?.units[0]?.maxHp).toBe(14);
    expect(savedAtMap?.activeRun?.graph.nodes.L4A?.isBeacon).toBe(true);
    expect(savedAtMap?.activeRun?.graph.nodes.L4B?.combat?.encounterKind).toBe('tutorial_raider');

    // S04 1-click jump into L1A tutorial combat
    await app.jumpToNode('L1A');
    await expect(app.byTestId(TEST_IDS.COMBAT_SCREEN)).toBeVisible();
    await app.startCombat();

    // If default-ON tactical command pauses combat, select a valid tactical order
    await app.waitForInspect(
      (s) => s.phase === 'REWARD' || s.activeRun?.combatWaitingDecision === true,
      60_000,
      'tactical pause or combat reward',
    );
    const midSnap = await app.inspect();
    if (midSnap.activeRun?.combatWaitingDecision) {
      await page.locator('[data-testid^="tactical-order-"]:not([disabled])').first().click();
    }

    // D07: 3-equipment synergy-tagged combat reward + zero-heal skip
    const rewardScreen = app.byTestId(TEST_IDS.REWARD_SCREEN);
    await expect(rewardScreen).toBeVisible({ timeout: 45_000 });
    await expect(app.byTestId(TEST_IDS.rewardChoice(0))).toBeVisible();
    await expect(app.byTestId(TEST_IDS.rewardChoice(1))).toBeVisible();
    await expect(app.byTestId(TEST_IDS.rewardChoice(2))).toBeVisible();
    await expect(app.byTestId(TEST_IDS.rewardSynergyBadge(0))).toBeVisible();
    await expect(app.byTestId(TEST_IDS.rewardSynergyBadge(1))).toBeVisible();
    await expect(app.byTestId(TEST_IDS.rewardSynergyBadge(2))).toBeVisible();
    await expect(app.byTestId(TEST_IDS.BTN_REWARD_SKIP)).toBeVisible();

    const hpBeforeSkip = (await app.inspect()).activeRun?.hp;
    await app.pickReward('skip');

    // S02: Zero-heal skip with empty staging auto-skips empty ARRANGE straight to MAP
    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();
    const endSnap = await app.inspect();
    expect(endSnap.phase).toBe('MAP');
    expect(endSnap.activeRun?.hp).toBe(hpBeforeSkip);
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

    // Seed a tutorial run at Layer 3 Arrange holding 13/16 occupied cells + 2x3 Sealed Reactor in staging
    // (13 + 6 = 19 > 16: guaranteed spatial conflict; discarding the 2 loot items clears cols 2..3 for the 2x3 reactor)
    const tutorialBay = createCargoBay({
      shipId: 'cannon_skiff',
      placed: [
        { item: createCargoItem({ instanceId: 'tut_laser', definitionId: 'equipment.laser.common', origin: 'loan' }), x: 0, y: 0 },
        { item: createCargoItem({ instanceId: 'tut_bat', definitionId: 'equipment.battery.common', origin: 'loan' }), x: 1, y: 0 },
        { item: createCargoItem({ instanceId: 'tut_shd', definitionId: 'equipment.shield.common', origin: 'loan' }), x: 1, y: 1 },
        { item: createCargoItem({ instanceId: 'tut_alloy', definitionId: 'cargo.alloy_bar', origin: 'loan' }), x: 0, y: 2 },
        { item: createCargoItem({ instanceId: 'tut_box1', definitionId: 'cargo.old_engine', origin: 'loot', acquiredDepth: 2 }), x: 2, y: 0 },
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

    // Valid 4-layer tutorial graph with L3A marked as Recovery Beacon so safe return is beacon_free
    const tutorialGraph = createMapGraph({
      maxLayers: 4,
      nodeOverrides: {
        L3A: { isBeacon: true, contractMarker: true, visited: true, resolved: true },
        L4A: { isBeacon: true },
      },
    });

    const save = presetMidRunMapV3(
      {
        phase: 'ARRANGE',
        currentNodeId: 'L3A',
        graph: tutorialGraph,
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
        totalRuns: 0,
        unlockedFamilies: ['core'],
        completedContractTypes: [],
        completedContractIds: [],
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

    // Discard both loot items via their cargo grid cells to clear cols 2..3 (rows 0..2), then place the 2x3 reactor
    const discardBtn = page
      .locator('#btn-v2-discard, [data-testid^="btn-discard-"]')
      .or(page.getByRole('button', { name: /舍弃|丢弃|弃置/ }))
      .first();

    await expect(page.locator('.placed-item.origin-loot')).toHaveCount(2);
    await app.gridCell(2, 0).click();
    await expect(discardBtn).toBeVisible();
    await discardBtn.click();

    await expect(page.locator('.placed-item.origin-loot')).toHaveCount(1);
    await app.gridCell(2, 2).click();
    await expect(discardBtn).toBeVisible();
    await discardBtn.click();
    await expect(page.locator('.placed-item.origin-loot')).toHaveCount(0);

    // Select staging reactor and place at (2, 0)
    const stagingReactor = page
      .locator('.staging-card, .v2-staging-card, [data-testid^="staging-item"]')
      .first();
    await expect(stagingReactor).toBeVisible();
    await stagingReactor.click();
    await app.gridCell(2, 0).click();

    await app.leaveArrange();
    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();
    await expect(app.byTestId(TEST_IDS.BTN_SAFE_RETURN)).toHaveAttribute(
      'data-return-mode',
      'beacon_free',
    );
    await app.safeReturn();

    const settleScreen = app.byTestId(TEST_IDS.SETTLEMENT_SCREEN);
    await expect(settleScreen).toBeVisible();
    await expect(settleScreen).toContainText(/40/);

    // D07 + S09: Run-1 3-pick-1 family unlock radiogroup (strictly 0 <button> elements inside)
    const familyUnlock = app.byTestId(TEST_IDS.SETTLEMENT_FAMILY_UNLOCK);
    await expect(familyUnlock).toBeVisible();
    await expect(familyUnlock.locator('button')).toHaveCount(0);
    await expect(app.byTestId(TEST_IDS.familyUnlockOption('heavy_kit'))).toBeVisible();
    await expect(app.byTestId(TEST_IDS.familyUnlockOption('hangar_kit'))).toBeVisible();
    await expect(app.byTestId(TEST_IDS.familyUnlockOption('counter_kit'))).toBeVisible();
    await app.byTestId(TEST_IDS.familyUnlockOption('heavy_kit')).click();

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
    expect(stored?.profile.unlockedFamilies).toContain('heavy_kit');

    // S10: Post-tutorial Base recommendation must differ from tutorial transport_std (密封反应堆)
    const baseCmdCard = page.locator('.v2-base-cmd-card').first();
    await expect(baseCmdCard).toBeVisible();
    await expect(baseCmdCard).not.toContainText(/密封反应堆/);
    await expect(baseCmdCard).toContainText(/救援|勘测|悬赏|黑匣/);

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

  test('T1-A2-04 @p0-core D04 Recovery Beacon grants 0-fuel free return while non-beacon triggers 0-fuel -35% Emergency Tow', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Part A: Beacon node (L3A has isBeacon: true) -> beacon_free (0 fuel, 0% tow fee)
    const beaconSave = presetMidRunMapV3({
      fuel: 7,
      wallet: 22,
      currentNodeId: 'L3A',
      overrides: { visitedNodeIds: ['L1A', 'L2A', 'L3A'] },
    });
    await app.seedStorage({ v2Save: beaconSave, skipTitleScreen: true });
    await app.boot({ seed: 2004 });

    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();
    await expect(app.byTestId(TEST_IDS.BTN_SAFE_RETURN)).toHaveAttribute(
      'data-return-mode',
      'beacon_free',
    );
    expect((await app.inspect()).activeRun?.fuel).toBe(7);

    await app.safeReturn();

    const beaconSettleSnap = await app.waitForInspect(
      (s) => s.phase === 'SETTLEMENT',
      15_000,
      'settlement phase after beacon free return',
    );
    expect(beaconSettleSnap.activeRun?.fuel).toBe(7);
    const beaconTotal = app.byTestId(TEST_IDS.SETTLEMENT_TOTAL_CREDITS);
    await expect(beaconTotal).toBeVisible();
    expect(Number(await beaconTotal.getAttribute('data-final-credits'))).toBe(22);
    await expect(app.byTestId(TEST_IDS.SETTLEMENT_SCREEN)).not.toContainText(/非信标紧急拖航费/);

    // Part B: Non-beacon node (L1A has isBeacon: false) -> emergency_tow (0 fuel, -35% tow fee)
    const nonBeaconSave = presetMidRunMapV3({
      fuel: 7,
      wallet: 40,
      currentNodeId: 'L1A',
      overrides: { visitedNodeIds: ['L1A'] },
    });
    await app.seedStorage({ v2Save: nonBeaconSave, skipTitleScreen: true });
    await app.boot({ seed: 20041 });

    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();
    await expect(app.byTestId(TEST_IDS.BTN_SAFE_RETURN)).toHaveAttribute(
      'data-return-mode',
      'emergency_tow',
    );

    await app.safeReturn();

    const towSettleSnap = await app.waitForInspect(
      (s) => s.phase === 'SETTLEMENT',
      15_000,
      'settlement phase after emergency tow return',
    );
    expect(towSettleSnap.activeRun?.fuel).toBe(7);
    await expect(app.byTestId(TEST_IDS.SETTLEMENT_SCREEN)).toContainText(/紧急拖航/);
    const towTotal = app.byTestId(TEST_IDS.SETTLEMENT_TOTAL_CREDITS);
    expect(Number(await towTotal.getAttribute('data-final-credits'))).toBe(26);

    monitor.assertClean(towSettleSnap);
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

  test('T1-A2-07 @p0-core S02 zero-heal reward skip auto-skips empty ARRANGE straight to MAP with editable CargoGrid', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Seed REWARD phase with empty staging and unwired Laser (0,0) + Battery (2,0)
    const unwiredBay = createCargoBay({
      shipId: 'cannon_skiff',
      placed: [
        {
          item: createCargoItem({
            instanceId: 's02_laser',
            definitionId: 'equipment.laser.common',
            origin: 'loan',
          }),
          x: 0,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 's02_battery',
            definitionId: 'equipment.battery.common',
            origin: 'loan',
          }),
          x: 2,
          y: 0,
        },
      ],
      staging: [],
    });

    const save = presetMidRunMapV3({
      phase: 'REWARD',
      currentNodeId: 'L1B',
      hp: 20,
      maxHp: 30,
      bay: unwiredBay,
      overrides: { visitedNodeIds: ['L1B'] },
    });

    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 2007 });

    await expect(app.byTestId(TEST_IDS.REWARD_SCREEN)).toBeVisible();
    await app.pickReward('skip');

    // Empty staging MUST auto-skip ARRANGE directly to MAP with zero HP heal
    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();
    await expect(app.byTestId(TEST_IDS.ARRANGE_SCREEN)).toHaveCount(0);
    const mapSnap = await app.inspect();
    expect(mapSnap.phase).toBe('MAP');
    expect(mapSnap.activeRun?.hp).toBe(20);

    // CargoGrid is directly editable on MAP: move battery from (2,0) to (1,0) adjacent to laser (0,0)
    await expect(page.locator('.placed-item.synergy-active')).toHaveCount(0);
    await app.gridCell(2, 0).click();
    await app.gridCell(1, 0).click();

    await expect(page.locator('.placed-item.synergy-active')).toHaveCount(2);
    const savedAfterMove = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    const movedBat = savedAfterMove?.activeRun?.bay.placed.find(
      (p) => p.item.instanceId === 's02_battery',
    );
    expect(movedBat?.x).toBe(1);
    expect(movedBat?.y).toBe(0);

    monitor.assertClean(await app.inspect());
  });
});
