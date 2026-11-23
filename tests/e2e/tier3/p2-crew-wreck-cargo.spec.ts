import { expect, test } from '@playwright/test';
import {
  CREW_NAMES,
  STORAGE_KEYS,
  TEST_IDS,
  assertStagingCardsBounded,
  attachZeroErrorMonitors,
  createAppDriver,
  createCargoBay,
  createCargoItem,
  createContractInstance,
  createMapGraph,
  createV3RunFixture,
  presetAct2V3,
  presetWreckEncounterV3,
} from '../helpers';
import type { V3SaveData } from '../helpers';

test.describe('Tier 3 · P2: Named Crew Mastery × Multi-Cut Wreck × Cargo Grid', () => {
  test('T3-P2-01 Salvager (苏岚) full reveal + mastery × 2-cut Wreck × heavy_freighter irregular grid', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const save = presetWreckEncounterV3({
      crewId: 'salvager',
      shipId: 'heavy_freighter',
      hp: 28,
      fuel: 8,
    });
    save.profile = presetAct2V3({
      selectedShipId: 'heavy_freighter',
      selectedCrewId: 'salvager',
      crewMastery: { engineer: 1, navigator: 1, salvager: 2 },
    }).profile;

    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 32001 });

    const wreckScreen = app.byTestId(TEST_IDS.WRECK_SCREEN);
    await expect(wreckScreen).toBeVisible();
    await expect(wreckScreen).toContainText(CREW_NAMES.salvager);

    // 苏岚 reveals exact compartment loot previews (item names / values / shapes) BEFORE cutting
    await expect(wreckScreen).toContainText(/激光炮|合金锭|旧引擎/);
    await expect(wreckScreen).toContainText(/1×2|2×2|¤/);

    const stabilityBefore = (await app.inspect()).activeRun?.wreckStability ?? 100;
    expect(stabilityBefore).toBeGreaterThan(0);

    // Perform 1st (safe) cut and 2nd (greedy) cut
    await app.cutWreckSpot('armory');
    const afterCut1 = await app.waitForInspect(
      (s) => (s.activeRun?.wreckStability ?? 100) < stabilityBefore,
      10_000,
      'stability drop after 1st cut',
    );
    const stabilityAfter1 = afterCut1.activeRun?.wreckStability ?? 0;

    await app.cutWreckSpot('cargo');
    const afterCut2 = await app.waitForInspect(
      (s) => (s.activeRun?.wreckStability ?? 100) < stabilityAfter1,
      10_000,
      'stability drop after 2nd greedy cut',
    );
    expect(afterCut2.activeRun?.wreckStability ?? 0).toBeLessThan(stabilityAfter1);

    // Extract to Arrange on heavy_freighter (disabled cells (4,0) and (0,3))
    await app.extractWreck();
    await expect(app.byTestId(TEST_IDS.ARRANGE_SCREEN)).toBeVisible();

    await expect(app.gridCell(4, 0)).toHaveAttribute('aria-disabled', 'true');
    await expect(app.gridCell(0, 3)).toHaveAttribute('aria-disabled', 'true');

    // Place extracted staging item cleanly on valid cells (3,1) avoiding blocked cells
    const stagingCard = page
      .locator('.staging-card, .v2-staging-card, [data-testid^="staging-item"]')
      .first();
    await expect(stagingCard).toBeVisible();
    await stagingCard.click();
    await app.gridCell(3, 1).click();

    await app.leaveArrange();
    const mapSnap = await app.waitForInspect((s) => s.phase === 'MAP', 10_000, 'return to MAP after arrange');

    const stored = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    const placed = stored?.activeRun?.bay.placed ?? [];
    expect(placed.length).toBeGreaterThanOrEqual(4);
    for (const p of placed) {
      expect(!(p.x === 4 && p.y === 0)).toBe(true);
      expect(!(p.x === 0 && p.y === 3)).toBe(true);
    }

    monitor.assertClean(mapSnap);
  });

  test('T3-P2-02 Engineer (林工) Swap × Wreck Armory Cut × Tactical Delta Comparator', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const save = presetWreckEncounterV3({
      crewId: 'engineer',
      shipId: 'cannon_skiff',
    });
    if (save.activeRun) {
      save.activeRun.engineerSwapAvailable = true;
    }

    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 32002 });

    await expect(app.byTestId(TEST_IDS.WRECK_SCREEN)).toBeVisible();
    await app.cutWreckSpot('armory');
    await app.extractWreck();

    const arrangeScreen = app.byTestId(TEST_IDS.ARRANGE_SCREEN);
    await expect(arrangeScreen).toBeVisible();

    // First looted equipment activates Engineer 3-choice swap offer directly on Arrange
    const swapBanner = arrangeScreen.locator('[data-testid="engineer-swap-banner"], .v2-engineer-banner');
    await expect(swapBanner).toBeVisible();
    const swapChoices = arrangeScreen.locator(
      '[data-eng-swap], [data-testid^="engineer-swap-option-"], .engineer-swap-option, [data-swap-choice]',
    );
    expect(
      await swapChoices.count(),
      'Engineer swap banner must present >= 3 candidate choices',
    ).toBeGreaterThanOrEqual(3);
    await swapChoices.first().click();

    // Verify swap consumed in save state
    const afterSwapSave = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(
      afterSwapSave?.activeRun?.engineerSwapAvailable === false ||
        afterSwapSave?.activeRun?.activeEngineerOffer?.used === true,
    ).toBe(true);

    // Place swapped equipment adjacent to existing loan_laser_1 (0,0..0,1) -> at (1,1) and verify Tactical Delta updates
    const stagingCard = page
      .locator('.staging-card, .v2-staging-card, [data-testid^="staging-item"]')
      .first();
    await expect(stagingCard).toBeVisible();
    await stagingCard.click();

    const deltaPanel = arrangeScreen
      .locator('[data-testid="tactical-delta"], .tactical-delta, .delta-panel')
      .first();
    await expect(deltaPanel).toBeVisible();
    const deltaBefore = (await deltaPanel.textContent()) ?? '';

    await app.gridCell(1, 1).click();
    await expect
      .poll(async () => (await deltaPanel.textContent()) ?? '', {
        timeout: 5_000,
        message: 'Tactical Delta comparator should update after placing swapped module',
      })
      .not.toBe(deltaBefore);

    monitor.assertClean(await app.inspect());
  });

  test('T3-P2-03 Navigator (陆衡) Free Jump × Multi-Cut Fuel Risk × Rescue Escape Pod (+1 Fuel)', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const base = presetAct2V3({ selectedCrewId: 'navigator' });
    const graph = createMapGraph({
      nodeOverrides: {
        L1A: { type: 'wreck', visited: true, resolved: false },
      },
    });
    const rescueContract = createContractInstance('rescue_std');
    const bay = createCargoBay({
      shipId: 'cannon_skiff',
      placed: [
        {
          item: createCargoItem({
            instanceId: 'nav_laser',
            definitionId: 'equipment.laser.common',
            origin: 'loan',
          }),
          x: 0,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'nav_pod',
            definitionId: 'mission.escape_pod',
            origin: 'mission',
            fixedValue: 0,
            missionBinding: rescueContract.contractId,
          }),
          x: 1,
          y: 0,
        },
      ],
    });
    const run = createV3RunFixture({
      crewId: 'navigator',
      phase: 'ENCOUNTER',
      currentNodeId: 'L1A',
      graph,
      bay,
      fuel: 6,
      contract: rescueContract,
      overrides: {
        navigatorFreeJumpUsed: false,
        activeWreck: {
          nodeId: 'L1A',
          stability: 100,
          maxStability: 100,
          cutsMade: 0,
          extracted: false,
          hotspots: [
            {
              spotId: 'armory',
              label: '军械舱',
              cut: false,
              riskHullDamage: 0,
              riskFuelCost: 0,
              riskAmbush: false,
              rewardItem: createCargoItem({
                instanceId: 'nav_wreck_bat',
                definitionId: 'equipment.battery.common',
                origin: 'loot',
                acquiredDepth: 1,
              }),
            },
            {
              spotId: 'reactor',
              label: '反应堆舱',
              cut: false,
              riskHullDamage: 3,
              riskFuelCost: 1,
              riskAmbush: false,
              rewardParts: 10,
            },
          ],
        },
      },
    });

    await app.seedStorage({ v2Save: { ...base, activeRun: run }, skipTitleScreen: true });
    await app.boot({ seed: 32003 });

    await expect(app.byTestId(TEST_IDS.WRECK_SCREEN)).toBeVisible();
    // 1st cut safe, 2nd cut incurs fuel risk (-1 fuel)
    await app.cutWreckSpot('armory');
    await app.cutWreckSpot('reactor');
    await app.extractWreck();

    // Leave arrange back to MAP
    if ((await app.inspect()).phase === 'ARRANGE') {
      await app.leaveArrange();
    }

    const mapSnap = await app.waitForInspect((s) => s.phase === 'MAP', 10_000, 'MAP after wreck');
    const fuelBeforeJump = mapSnap.activeRun?.fuel ?? 0;
    expect(fuelBeforeJump).toBeGreaterThanOrEqual(2);

    // Jump L1A -> L2A: Base 1 fuel waived by Navigator (陆衡), Escape Pod +1 surcharge STILL applies -> net -1 fuel (not -2)
    await app.jumpToNode('L2A');
    const afterJumpSnap = await app.waitForInspect(
      (s) => s.activeRun?.layer === 2,
      15_000,
      'arrived at Layer 2 with navigator + escape pod',
    );
    expect(afterJumpSnap.activeRun?.fuel).toBe(fuelBeforeJump - 1);
    expect(afterJumpSnap.activeRun?.fuel ?? -1).toBeGreaterThanOrEqual(0);

    const stored = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(stored?.activeRun?.navigatorFreeJumpUsed).toBe(true);

    monitor.assertClean(afterJumpSnap);
  });

  test('T3-P2-04 Multi-Cut Wreck loot overflow × 2×3 Mission Reactor spatial conflict preserves staging bounds and discard-undo', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const save = presetWreckEncounterV3({ shipId: 'cannon_skiff' });
    if (save.activeRun) {
      // Pre-occupy 12 of 16 cells including 2x3 mission.sealed_reactor so bulky 2x2 + 1x3 wreck loot forces spatial conflict
      save.activeRun.bay = createCargoBay({
        shipId: 'cannon_skiff',
        placed: [
          {
            item: createCargoItem({
              instanceId: 'sc_reactor',
              definitionId: 'mission.sealed_reactor',
              origin: 'mission',
              fixedValue: 0,
            }),
            x: 0,
            y: 0,
          },
          {
            item: createCargoItem({
              instanceId: 'sc_laser',
              definitionId: 'equipment.laser.common',
              origin: 'loan',
            }),
            x: 2,
            y: 0,
          },
          {
            item: createCargoItem({
              instanceId: 'sc_shield',
              definitionId: 'equipment.shield.common',
              origin: 'loan',
            }),
            x: 3,
            y: 0,
          },
          {
            item: createCargoItem({
              instanceId: 'sc_cargo_fill',
              definitionId: 'cargo.alloy_bar',
              origin: 'loot',
              fixedValue: 15,
              acquiredDepth: 1,
            }),
            x: 2,
            y: 2,
          },
        ],
      });
    }

    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 32004 });

    await expect(app.byTestId(TEST_IDS.WRECK_SCREEN)).toBeVisible();
    await app.cutWreckSpot('cargo');
    await app.cutWreckSpot('reactor');
    await app.extractWreck();

    const arrangeScreen = app.byTestId(TEST_IDS.ARRANGE_SCREEN);
    await expect(arrangeScreen).toBeVisible();

    // Staging cards must stay strictly bounded with <= 48x48 thumbnails
    await assertStagingCardsBounded(page);

    // Select first staging card so inspector renders discard control, verify undo, then clear overflow to leave
    const stagingCards = arrangeScreen.locator('.v2-staging-card, .staging-card, [data-testid^="staging-item"]');
    await expect(stagingCards.first()).toBeVisible();
    await stagingCards.first().click();

    const discardBtn = arrangeScreen
      .locator('#btn-v2-discard, [data-testid^="btn-discard-"], button:has-text("舍弃"), button:has-text("丢弃")')
      .first();
    await expect(discardBtn).toBeVisible();
    await discardBtn.click();

    const undoBtn = arrangeScreen
      .locator('#btn-v2-undo-discard')
      .or(arrangeScreen.getByRole('button', { name: /撤回|撤销/ }))
      .first();
    await expect(undoBtn).toBeVisible();
    await undoBtn.click();

    // Now discard staging items that cannot fit so reactor + weapons stay intact
    let discardGuard = 0;
    while (!(await app.byTestId(TEST_IDS.BTN_LEAVE_ARRANGE).isEnabled()) && discardGuard < 8) {
      if ((await stagingCards.count()) > 0) {
        await stagingCards.first().click();
      }
      const nextDiscard = arrangeScreen
        .locator('#btn-v2-discard, [data-testid^="btn-discard-"], button:has-text("舍弃"), button:has-text("丢弃")')
        .first();
      await expect(nextDiscard).toBeVisible();
      await nextDiscard.click();
      discardGuard += 1;
    }

    await app.leaveArrange();
    const mapSnap = await app.waitForInspect((s) => s.phase === 'MAP', 10_000, 'MAP after resolving spatial conflict');

    const stored = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    const hasReactor = stored?.activeRun?.bay.placed.some(
      (p) => p.item.definitionId === 'mission.sealed_reactor',
    );
    expect(hasReactor).toBe(true);

    monitor.assertClean(mapSnap);
  });
});
