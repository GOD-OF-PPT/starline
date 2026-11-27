import { expect, test } from '@playwright/test';
import {
  CREW_NAMES,
  ITEM_CATALOG,
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
  getOccupiedCells,
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

    // 苏岚 reveals exact catalog item names across all 3 compartments BEFORE cutting
    await expect(wreckScreen).toContainText('激光炮');
    await expect(wreckScreen).toContainText('合金条');
    await expect(wreckScreen).toContainText('旧引擎');
    await expect(wreckScreen).toContainText(/1×2|2×2|¤/);

    const stabilityBefore = (await app.inspect()).activeRun?.wreckStability ?? 0;
    expect(stabilityBefore).toBe(100);

    // Perform 1st (safe) cut and 2nd (greedy) cut under deterministic seed 202601 (0 collapse)
    await app.cutWreckSpot('armory');
    const afterCut1 = await app.waitForInspect(
      (s) => s.activeRun?.wreckStability === 60,
      10_000,
      'stability 100 -> 60 after 1st safe cut',
    );
    expect(afterCut1.activeRun?.hp).toBe(28);

    await app.cutWreckSpot('cargo');
    const afterCut2 = await app.waitForInspect(
      (s) => s.activeRun?.wreckStability === 25,
      10_000,
      'stability 60 -> 25 after 2nd greedy cut',
    );
    expect(afterCut2.activeRun?.hp).toBe(24);
    const afterCut2Save = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(afterCut2Save?.activeRun?.activeWreck?.collapsed).toBe(false);

    // Extract to Arrange on heavy_freighter (disabled bulkheads (4,0) and (0,3))
    await app.extractWreck();
    const arrangeScreen = app.byTestId(TEST_IDS.ARRANGE_SCREEN);
    await expect(arrangeScreen).toBeVisible();

    await expect(app.disabledCells()).toHaveCount(2);
    await expect(app.gridCell(4, 0)).toHaveAttribute('aria-disabled', 'true');
    await expect(app.gridCell(0, 3)).toHaveAttribute('aria-disabled', 'true');

    // S07: default autoplace button (`#btn-v2-autoplace` = ↓ 放入船舱) places each staging item onto legal cells
    const stagingCards = page.locator('[data-staging-id]');
    await expect(stagingCards).toHaveCount(2);
    const autoPlaceBtn = arrangeScreen.locator('#btn-v2-autoplace');

    for (let remaining = 2; remaining > 0; remaining -= 1) {
      await stagingCards.first().click();
      await expect(autoPlaceBtn).toBeVisible();
      await expect(autoPlaceBtn).toBeEnabled();
      await autoPlaceBtn.click();
      await expect(stagingCards).toHaveCount(remaining - 1);
    }

    await app.leaveArrange();
    const mapSnap = await app.waitForInspect((s) => s.phase === 'MAP', 10_000, 'return to MAP after arrange');

    const stored = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    const placed = stored?.activeRun?.bay.placed ?? [];
    expect(placed).toHaveLength(5);
    expect(stored?.activeRun?.bay.staging).toHaveLength(0);
    expect(placed.some((p) => p.item.instanceId === 'wreck_armory_laser')).toBe(true);
    expect(placed.some((p) => p.item.instanceId === 'wreck_cargo_alloy')).toBe(true);

    // Validate EVERY occupied cell of every multi-cell placed shape against heavy_freighter bounds & disabled bulkheads
    for (const p of placed) {
      const meta = ITEM_CATALOG[p.item.definitionId];
      expect(meta, `Unknown definitionId ${p.item.definitionId}`).toBeDefined();
      const cells = getOccupiedCells(meta!.shapeId, p.x, p.y, p.rotation);
      for (const cell of cells) {
        expect(cell.x).toBeGreaterThanOrEqual(0);
        expect(cell.x).toBeLessThan(5);
        expect(cell.y).toBeGreaterThanOrEqual(0);
        expect(cell.y).toBeLessThan(4);
        expect(!(cell.x === 4 && cell.y === 0)).toBe(true);
        expect(!(cell.x === 0 && cell.y === 3)).toBe(true);
      }
    }

    monitor.assertClean(mapSnap);
  });

  test('T3-P2-02 Engineer (林工) Swap × Wreck Armory Cut × S06 Tactical Delta & S07 Opt-In Recommended Placement', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const save = presetWreckEncounterV3({
      crewId: 'engineer',
      shipId: 'cannon_skiff',
      hp: 30,
      fuel: 8,
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
    const swapBanner = app.byTestId(TEST_IDS.ENGINEER_SWAP_BANNER);
    await expect(swapBanner).toBeVisible();
    const swapChoices = arrangeScreen.locator('[data-eng-swap]');
    expect(
      await swapChoices.count(),
      'Engineer swap banner must present >= 3 candidate choices',
    ).toBeGreaterThanOrEqual(3);

    const chosenKind = await swapChoices.first().getAttribute('data-eng-swap');
    expect(chosenKind, 'Engineer swap option must expose data-eng-swap kind').toBeTruthy();
    await swapChoices.first().click();

    await expect(swapBanner).toHaveCount(0);
    const afterSwapSave = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(afterSwapSave?.activeRun?.activeEngineerOffer?.used).toBe(true);

    // Select swapped staging item and verify S06 qualitative Tactical Delta + Layer-2 Details Drawer
    const stagingCards = page.locator('[data-staging-id]');
    await expect(stagingCards).toHaveCount(1);
    await stagingCards.first().click();

    const deltaPanel = arrangeScreen.getByTestId('tactical-delta');
    await expect(deltaPanel).toBeVisible();
    await expect(deltaPanel).toContainText(/联动|趋势|舱位/);

    const detailsToggle = arrangeScreen.getByTestId('btn-toggle-item-details');
    await expect(detailsToggle).toBeVisible();
    await detailsToggle.click();
    const itemDrawer = arrangeScreen.getByTestId('item-details-drawer');
    await expect(itemDrawer).toBeVisible();
    await expect(itemDrawer).toContainText('不干预时结果');

    // S07 opt-in recommended placement: hidden by default until btn-toggle-recommend-hint is toggled ON
    const installRecBtn = arrangeScreen.getByTestId('btn-install-recommended');
    await expect(installRecBtn).toHaveCount(0);

    const recHintToggle = arrangeScreen.getByTestId('btn-toggle-recommend-hint');
    await expect(recHintToggle).toBeVisible();
    await recHintToggle.click();
    await expect(recHintToggle).toHaveAttribute('aria-pressed', 'true');

    await expect(installRecBtn).toBeVisible();
    await expect(installRecBtn).toContainText('装入推荐位');
    await installRecBtn.click();

    await expect(stagingCards).toHaveCount(0);
    await app.leaveArrange();
    const mapSnap = await app.waitForInspect((s) => s.phase === 'MAP', 10_000, 'MAP after engineer swap');

    const stored = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(stored?.activeRun?.bay.placed).toHaveLength(4);
    expect(
      stored?.activeRun?.bay.placed.some(
        (p) =>
          p.item.instanceId === 'wreck_armory_laser_eng' &&
          p.item.definitionId === `equipment.${chosenKind}.common` &&
          p.item.origin === 'loot',
      ),
    ).toBe(true);
    expect(
      stored?.activeRun?.bay.placed.some((p) => p.item.instanceId === 'wreck_armory_laser'),
    ).toBe(false);
    expect(stored?.activeRun?.engineerSwapAvailable).toBe(false);
    expect(stored?.activeRun?.activeEngineerOffer?.used).toBe(true);

    monitor.assertClean(mapSnap);
  });

  test('T3-P2-03 Navigator (陆衡) Free Jump × Multi-Cut Fuel Risk Disclosure × Rescue Escape Pod (+1 Fuel)', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const base = presetAct2V3({ selectedCrewId: 'navigator' });
    const rescueContract = createContractInstance('rescue_std');
    const navWreckBat = createCargoItem({
      instanceId: 'nav_wreck_bat',
      definitionId: 'equipment.battery.common',
      origin: 'loot',
      acquiredDepth: 1,
      location: 'staging',
    });
    const navWreckAlloy = createCargoItem({
      instanceId: 'nav_wreck_alloy',
      definitionId: 'cargo.alloy_bar',
      origin: 'loot',
      acquiredDepth: 1,
      location: 'staging',
    });
    const graph = createMapGraph({
      nodeOverrides: {
        L1A: {
          type: 'wreck',
          visited: false,
          resolved: false,
          wreck: {
            armoryItem: navWreckBat,
            cargoItems: [navWreckAlloy],
            armorySizeRange: '1 格设备',
            armoryValueRange: '回收 8¤',
            cargoSizeRange: '2 格货品',
            cargoValueRange: '15¤',
            reactorFuelGain: 2,
            reactorRepairGain: 5,
            chosenRoom: null,
          },
        },
        L2A: {
          type: 'merchant',
          visited: false,
          resolved: false,
        },
      },
    });
    const navBay = createCargoBay({
      shipId: 'cannon_skiff',
      placed: [
        {
          item: createCargoItem({
            instanceId: 'nav_loan_laser',
            definitionId: 'equipment.laser.common',
            origin: 'loan',
          }),
          x: 0,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'nav_escape_pod',
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
      phase: 'MAP',
      currentNodeId: null,
      graph,
      bay: navBay,
      fuel: 6,
      contract: rescueContract,
      overrides: {
        visitedNodeIds: [],
        navigatorFreeJumpUsed: false,
      },
    });

    await app.seedStorage({ v2Save: { ...base, activeRun: run }, skipTitleScreen: true });
    await app.boot({ seed: 32003 });

    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();
    expect((await app.inspect()).activeRun?.fuel).toBe(6);

    // Jump 1 (start -> L1A): Navigator waives base 1 fuel, Escape Pod +1 surcharge STILL applies -> 6 -> 5 fuel
    await app.jumpToNode('L1A');
    await expect(app.byTestId(TEST_IDS.WRECK_SCREEN)).toBeVisible();
    const afterL1 = await app.inspect();
    expect(afterL1.activeRun?.fuel).toBe(5);
    const savedAfterL1 = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(savedAfterL1?.activeRun?.navigatorFreeJumpUsed).toBe(true);

    // Cut #1 (armory): safe cut keeps fuel at 5 and drops stability 100 -> 60
    await app.cutWreckSpot('armory');
    const afterCut1 = await app.waitForInspect(
      (s) => s.activeRun?.wreckStability === 60,
      10_000,
      'armory safe cut stability 100 -> 60',
    );
    expect(afterCut1.activeRun?.fuel).toBe(5);

    // Cut #2 multi-cut fuel risk warning MUST be explicitly disclosed on the reactor card
    const reactorCard = page.locator('[data-wreck-card="reactor"]');
    await expect(reactorCard).toBeVisible();
    await expect(reactorCard).toContainText('燃料消耗 -1');

    // Extract to ARRANGE unconditionally and place nav_wreck_bat via #btn-v2-autoplace (never discard!)
    await app.extractWreck();
    const arrangeScreen = app.byTestId(TEST_IDS.ARRANGE_SCREEN);
    await expect(arrangeScreen).toBeVisible();

    const batStaging = page.locator('[data-staging-id="nav_wreck_bat"]');
    await expect(batStaging).toBeVisible();
    await batStaging.click();
    const autoPlaceBtn = arrangeScreen.locator('#btn-v2-autoplace');
    await expect(autoPlaceBtn).toBeEnabled();
    await autoPlaceBtn.click();
    await expect(page.locator('[data-staging-id]')).toHaveCount(0);

    await app.leaveArrange();
    const mapSnap = await app.waitForInspect((s) => s.phase === 'MAP', 10_000, 'MAP after placing battery');
    expect(mapSnap.activeRun?.fuel).toBe(5);

    const savedAfterArrange = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(
      savedAfterArrange?.activeRun?.bay.placed.some((p) => p.item.instanceId === 'nav_wreck_bat'),
      'Extracted battery must be placed in bay, not discarded',
    ).toBe(true);

    // Jump 2 (L1A -> L2A): free jump already spent, so base 1 + pod 1 = -2 fuel (5 -> 3)
    await app.jumpToNode('L2A');
    await expect(app.byTestId(TEST_IDS.SHOP_SCREEN)).toBeVisible();
    const afterL2 = await app.inspect();
    expect(afterL2.activeRun?.layer).toBe(2);
    expect(afterL2.activeRun?.fuel).toBe(3);

    monitor.assertClean(afterL2);
  });

  test('T3-P2-04 Multi-Cut Wreck loot overflow × 2×3 Mission Reactor spatial conflict preserves staging bounds and discard-undo', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const save = presetWreckEncounterV3({ shipId: 'cannon_skiff' });
    if (save.activeRun) {
      // Pre-occupy 12 of 16 cells including 2x3 mission.sealed_reactor so bulky 2x2 + 1x2 wreck loot forces spatial conflict
      save.activeRun.bay = createCargoBay({
        shipId: 'cannon_skiff',
        placed: [
          {
            item: createCargoItem({
              instanceId: 'p2_reactor',
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
    await app.waitForInspect((s) => s.activeRun?.wreckStability === 60, 10_000, 'cut 1 cargo stability 60');
    await app.cutWreckSpot('reactor');
    await app.waitForInspect((s) => s.activeRun?.wreckStability === 25, 10_000, 'cut 2 reactor stability 25');

    const beforeExtractSave = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(beforeExtractSave?.activeRun?.activeWreck?.collapsed).toBe(false);

    await app.extractWreck();

    const arrangeScreen = app.byTestId(TEST_IDS.ARRANGE_SCREEN);
    await expect(arrangeScreen).toBeVisible();
    await expect(app.byTestId(TEST_IDS.BTN_LEAVE_ARRANGE)).toBeDisabled();

    // Staging cards must stay strictly bounded with <= 48x48 thumbnails
    const stagingCards = page.locator('[data-staging-id]');
    await expect(stagingCards).toHaveCount(2);
    await assertStagingCardsBounded(page);

    // Discard 1st staging item (2 -> 1), then Undo (1 -> 2)
    await stagingCards.first().click();
    const discardBtn = arrangeScreen.locator('#btn-v2-discard');
    await expect(discardBtn).toBeVisible();
    await discardBtn.click();
    await expect(stagingCards).toHaveCount(1);

    const undoBtn = page.locator('#btn-v2-undo-discard');
    await expect(undoBtn).toBeVisible();
    await undoBtn.click();
    await expect(stagingCards).toHaveCount(2);

    // Bounded discard of remaining overflow items so mission reactor + weapons remain intact
    for (let step = 0; step < 2; step += 1) {
      const beforeCount = await stagingCards.count();
      expect(beforeCount).toBe(2 - step);
      await stagingCards.first().click();
      await expect(discardBtn).toBeVisible();
      await discardBtn.click();
      await expect(stagingCards).toHaveCount(beforeCount - 1);
    }

    await app.leaveArrange({ confirmDiscards: true });
    const mapSnap = await app.waitForInspect((s) => s.phase === 'MAP', 10_000, 'MAP after resolving spatial conflict');

    const stored = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(
      stored?.activeRun?.bay.placed.some(
        (p) => p.item.instanceId === 'p2_reactor' && p.item.definitionId === 'mission.sealed_reactor',
      ),
    ).toBe(true);
    expect(stored?.activeRun?.bay.staging).toHaveLength(0);
    expect(stored?.activeRun?.bay.discardedThisArrange).toHaveLength(0);

    monitor.assertClean(mapSnap);
  });

  test('T3-P2-05 S08 Direct Stage Clamp Cut & D05 Vault × D03 Battery Cap + coolant_tank↔heavy Synergy Discovery × S02 Auto-Skip Empty Arrange', async ({
    page,
  }) => {
    test.slow();
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const p205VaultCoolant = createCargoItem({
      instanceId: 'p205_vault_coolant',
      definitionId: 'cargo.coolant_tank',
      origin: 'loot',
      acquiredDepth: 3,
      location: 'staging',
    });
    const p205ArmoryImpBat = createCargoItem({
      instanceId: 'p205_armory_imp_bat',
      definitionId: 'equipment.battery.improved',
      origin: 'loot',
      acquiredDepth: 3,
      location: 'staging',
    });
    const p205CargoAlloy = createCargoItem({
      instanceId: 'p205_cargo_alloy',
      definitionId: 'cargo.alloy_bar',
      origin: 'loot',
      acquiredDepth: 3,
      location: 'staging',
    });

    const base = presetAct2V3({
      selectedShipId: 'heavy_freighter',
      selectedCrewId: 'salvager',
      discoveredSynergies: ['battery_laser'],
    });
    const graph = createMapGraph({
      nodeOverrides: {
        L3A: {
          type: 'wreck',
          visited: true,
          resolved: false,
          wreck: {
            armoryItem: p205ArmoryImpBat,
            cargoItems: [p205CargoAlloy],
            armorySizeRange: '1 格设备',
            armoryValueRange: '回收 12¤',
            cargoSizeRange: '2 格货品',
            cargoValueRange: '15¤',
            reactorFuelGain: 2,
            reactorRepairGain: 5,
            chosenRoom: null,
          },
        },
        L4A: {
          type: 'wreck',
          visited: false,
          resolved: false,
        },
      },
    });
    const bay = createCargoBay({
      shipId: 'heavy_freighter',
      placed: [
        {
          item: createCargoItem({
            instanceId: 'p205_laser_1',
            definitionId: 'equipment.laser.common',
            origin: 'loan',
          }),
          x: 0,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'p205_bat_common',
            definitionId: 'equipment.battery.common',
            origin: 'loan',
          }),
          x: 1,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'p205_laser_2',
            definitionId: 'equipment.laser.common',
            origin: 'owned',
          }),
          x: 2,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'p205_heavy_1',
            definitionId: 'equipment.heavy.common',
            origin: 'owned',
          }),
          x: 1,
          y: 3,
          rotation: 1,
        },
      ],
    });

    const save: V3SaveData = {
      ...base,
      settings: {
        ...base.settings,
        reducedMotion: false,
      },
      activeRun: createV3RunFixture({
        runId: 'run_t3_p2_05',
        seed: 202601,
        sectorId: 'frozen_graveyard',
        shipId: 'heavy_freighter',
        crewId: 'salvager',
        phase: 'ENCOUNTER',
        currentNodeId: 'L3A',
        hp: 28,
        maxHp: 28,
        fuel: 6,
        graph,
        bay,
        contract: createContractInstance('free_salvage'),
        overrides: {
          visitedNodeIds: ['L1A', 'L2A', 'L3A'],
          activeWreck: {
            nodeId: 'L3A',
            stability: 110,
            maxStability: 110,
            cutsMade: 0,
            extracted: false,
            collapsed: false,
            wreckLootInstanceIds: [],
            hotspots: [
              {
                spotId: 'armory',
                label: '军械舱',
                cut: false,
                riskHullDamage: 4,
                riskFuelCost: 0,
                riskAmbush: false,
                rewardItem: p205ArmoryImpBat,
              },
              {
                spotId: 'cargo',
                label: '主货舱',
                cut: false,
                riskHullDamage: 4,
                riskFuelCost: 0,
                riskAmbush: false,
                rewardItem: p205CargoAlloy,
                rewardParts: 8,
              },
              {
                spotId: 'reactor',
                label: '反应堆舱',
                cut: false,
                riskHullDamage: 5,
                riskFuelCost: 1,
                riskAmbush: false,
                rewardParts: 12,
              },
              {
                spotId: 'vault',
                label: '密封金库',
                cut: false,
                riskHullDamage: 4,
                riskFuelCost: 0,
                riskAmbush: false,
                rewardItem: p205VaultCoolant,
                rewardItems: [p205VaultCoolant],
                rewardParts: 10,
                rewardCredits: 12,
              },
            ],
          },
        },
      }),
    };

    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 32005 });

    // Part A: Salvager reveals vault coolant & improved battery; S08 direct stage clamp cut on vault
    const wreckScreen = app.byTestId(TEST_IDS.WRECK_SCREEN);
    await expect(wreckScreen).toBeVisible();
    await expect(wreckScreen).toContainText('冷却罐');
    await expect(wreckScreen).toContainText('优良能量电池');

    const vaultClamp = app.byTestId(TEST_IDS.wreckSpot('vault'));
    await expect(vaultClamp).toBeVisible();
    await expect(vaultClamp).toHaveAttribute('data-can-direct-cut', 'true');
    await vaultClamp.click();

    const skipOverlayBtn = app.byTestId(TEST_IDS.BTN_SKIP_WRECK_CUT);
    try {
      await skipOverlayBtn.click({ timeout: 2_000 });
    } catch (err) {
      // Fail-closed: tolerate skip button detaching ONLY if the 600ms S08 cut already committed 110 -> 70
      const snapAfterSkipErr = await app.inspect();
      if (snapAfterSkipErr.activeRun?.wreckStability !== 70) {
        throw err;
      }
    }

    const afterCut1 = await app.waitForInspect(
      (s) => s.activeRun?.wreckStability === 70,
      10_000,
      'S08 direct vault clamp cut committed stability 110 -> 70',
    );
    expect(afterCut1.activeRun?.hp).toBe(28);

    // Cut #2 (armory): stability 70 -> 35 (>= 30 -> 0% collapse), hp 28 -> 24
    await app.cutWreckSpot('armory');
    const afterCut2 = await app.waitForInspect(
      (s) => s.activeRun?.wreckStability === 35,
      10_000,
      'Cut #2 armory committed stability 70 -> 35',
    );
    expect(afterCut2.activeRun?.hp).toBe(24);
    const savedAfterCut2 = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(savedAfterCut2?.activeRun?.activeWreck?.collapsed).toBe(false);

    await app.extractWreck();
    await expect(app.byTestId(TEST_IDS.ARRANGE_SCREEN)).toBeVisible();

    // D03 Common Battery Cap active: p205_bat_common supplies laser_1, leaving laser_2 capped
    await expect(page.locator('.placed-item.battery-capped')).toHaveCount(1);
    expect(await page.locator('[data-link-status="capped"]').count()).toBeGreaterThanOrEqual(1);

    // Place coolant_tank (rotated horizontal 3x1) at (1,2)-(3,2) adjacent to heavy cannon at (1,3)-(3,3)
    const coolantStaging = page.locator('[data-staging-id="p205_vault_coolant"]');
    await expect(coolantStaging).toBeVisible();
    await coolantStaging.click();
    await page.locator('#btn-v2-rotate').click();
    await app.gridCell(1, 2).click();

    expect(
      await page.locator('[data-synergy-id="coolant_heavy"][data-link-status="active"]').count(),
    ).toBeGreaterThanOrEqual(1);
    const toast = app.byTestId(TEST_IDS.SYNERGY_DISCOVERY_TOAST);
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(/新联动/);
    await expect(toast).toHaveAttribute('data-synergy-ids', 'coolant_heavy');

    await expect
      .poll(
        async () =>
          (await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE))?.profile.discoveredSynergies?.includes(
            'coolant_heavy',
          ) ?? false,
        { timeout: 5_000, message: 'coolant_heavy discovery must persist in profile.discoveredSynergies' },
      )
      .toBe(true);

    // Place improved battery at (3,0) adjacent to laser_2 -> resolves D03 cap to 0 capped items
    const impBatStaging = page.locator('[data-staging-id="p205_armory_imp_bat"]');
    await expect(impBatStaging).toBeVisible();
    await impBatStaging.click();
    await app.gridCell(3, 0).click();

    await expect(page.locator('.placed-item.battery-capped')).toHaveCount(0);
    await expect(page.locator('[data-link-status="capped"]')).toHaveCount(0);

    await app.leaveArrange();
    await app.waitForInspect((s) => s.phase === 'MAP', 10_000, 'MAP after resolving D03 battery cap');

    // Part B: Jump to L4A wreck -> verify dynamic D05 vault -> 0-cut Extract auto-skips ARRANGE (S02) + reload parity
    await app.jumpToNode('L4A');
    await expect(app.byTestId(TEST_IDS.WRECK_SCREEN)).toBeVisible();
    await expect(app.byTestId(TEST_IDS.wreckCut('vault'))).toBeVisible();

    await app.extractWreck();
    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();
    const afterSkipSnap = await app.waitForInspect(
      (s) => s.phase === 'MAP' && s.activeRun?.layer === 4,
      10_000,
      'S02 auto-skips empty ARRANGE directly to MAP on Layer 4',
    );
    expect(afterSkipSnap.phase).toBe('MAP');

    await page.reload({ waitUntil: 'domcontentloaded' });
    const reloadedSnap = await app.waitForInspect(
      (s) => s.screen === 'run' && s.phase === 'MAP' && s.activeRun?.layer === 4,
      30_000,
      'MAP Layer 4 restored after reload',
    );
    const reloadedSave = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(reloadedSave?.profile.discoveredSynergies).toContain('coolant_heavy');
    expect(
      reloadedSave?.activeRun?.bay.placed.some((p) => p.item.instanceId === 'p205_vault_coolant'),
    ).toBe(true);
    expect(
      reloadedSave?.activeRun?.bay.placed.some((p) => p.item.instanceId === 'p205_armory_imp_bat'),
    ).toBe(true);

    monitor.assertClean(reloadedSnap);
  });
});
