import { expect, test } from '@playwright/test';
import {
  STARTING_FUEL,
  STORAGE_KEYS,
  TEST_IDS,
  attachZeroErrorMonitors,
  createAppDriver,
  createCargoBay,
  createCargoItem,
  createContractInstance,
  createDefaultRelics,
  createMapGraph,
  createV3RunFixture,
  presetAct1V3,
  presetArrangeV3,
  presetMidRunMapV3,
  presetPostTutorialV3,
  presetSettlementV3,
} from '../helpers';
import type { V3SaveData } from '../helpers';

test.describe('Tier 2 · A2: Core Loop, Bankruptcy, Fuel & Loadout Boundaries', () => {
  test('T2-A2-01 @p0-core 0-credit bankruptcy-proof free launch works with empty warehouse and starter skiff', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({
      v2Save: presetPostTutorialV3({
        credits: 0,
        salvageParts: 0,
        equipmentWarehouse: [],
        unlockedShips: ['cannon_skiff'],
        unlockedCrew: ['engineer'],
        selectedShipId: 'cannon_skiff',
        selectedCrewId: 'engineer',
      }),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 22001, enterStation: true });

    const baseSnap = await app.inspect();
    expect(baseSnap.credits).toBe(0);
    expect(baseSnap.salvageParts).toBe(0);

    await app.openPrepareFromBase();
    await expect(app.byTestId(TEST_IDS.BTN_LAUNCH_EXPEDITION)).toBeEnabled();
    await app.launchExpedition();

    const mapSnap = await app.waitForInspect(
      (s) => s.screen === 'run' && s.phase === 'MAP' && s.activeRun !== null,
      15_000,
      'free launch expedition started',
    );

    expect(mapSnap.credits).toBe(0);
    expect(mapSnap.activeRun?.shipId).toBe('cannon_skiff');
    expect(mapSnap.activeRun?.sectorId).toBe('near_orbit');
    expect(mapSnap.activeRun?.fuel).toBe(STARTING_FUEL);

    monitor.assertClean(mapSnap);
  });

  test('T2-A2-02 @p0-core Loadout budget overflow blocks excess gear and missing preset owned item flags缺件 instead of silent cloning', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Preset references an owned improved laser that no longer exists in warehouse
    const presetSave = presetAct1V3({
      selectedShipId: 'cannon_skiff',
      equipmentWarehouse: [],
      loadoutPresets: [
        {
          presetId: 'preset_missing_owned',
          name: '缺件校验方案',
          shipId: 'cannon_skiff',
          crewId: 'engineer',
          primaryArchetype: 'laser',
          updatedAt: '2026-11-22T00:00:00.000Z',
          slots: [
            {
              definitionId: 'equipment.laser.improved',
              quality: 'improved',
              preferOrigin: 'owned',
              x: 0,
              y: 0,
              rotation: 0,
            },
          ],
        },
      ],
    });

    await app.seedStorage({
      v2Save: presetSave,
      skipTitleScreen: true,
    });
    await app.boot({ seed: 22002, enterStation: true });
    await app.openPrepareFromBase();

    const prepareScreen = app.byTestId(TEST_IDS.PREPARE_SCREEN);
    await expect(prepareScreen).toBeVisible();

    // Expand loan/equipment catalog if collapsed, then try adding gear until budget cap (6) is hit
    const expandLoanBtn = prepareScreen
      .locator('[data-testid="btn-toggle-loan-catalog"], summary, button')
      .filter({ hasText: /租借|装备库|基础配装|展开/ })
      .first();
    if (await expandLoanBtn.isVisible()) {
      await expandLoanBtn.click();
    }

    // Attempt to click add buttons repeatedly until a budget-capped/disabled state is enforced
    const addEquipBtns = prepareScreen.locator(
      '[data-add-loan], [data-add-owned], [data-testid^="btn-add-loan-"], [data-testid^="btn-add-equip-"], button:has-text("装配"), button:has-text("添加")',
    );
    const addCount = await addEquipBtns.count();
    expect(addCount, 'Prepare screen must expose add-equipment controls').toBeGreaterThan(0);

    for (let i = 0; i < 6; i += 1) {
      const enabledAdd = prepareScreen
        .locator(
          '[data-add-loan]:not([disabled]), [data-add-owned]:not([disabled]), [data-testid^="btn-add-loan-"]:not([disabled]), [data-testid^="btn-add-equip-"]:not([disabled])',
        )
        .first();
      if ((await enabledAdd.count()) === 0) break;
      await enabledAdd.click();
    }

    // At budget cap (6/6), remaining cost-bearing add buttons must be disabled or budget feedback visible
    const disabledAddCount = await prepareScreen
      .locator(
        '[data-add-loan][disabled], [data-add-owned][disabled], [data-testid^="btn-add-loan-"][disabled], [data-testid^="btn-add-equip-"][disabled], button:has-text("预算不足"), button:has-text("超额")',
      )
      .count();
    const budgetText = await prepareScreen.innerText();
    expect(
      disabledAddCount > 0 || /6\s*\/\s*6|预算已满|预算不足|超额/.test(budgetText),
      'Budget cap of 6 on cannon_skiff must block overflow additions',
    ).toBe(true);

    // Apply saved preset whose owned item is missing -> must flag缺件/substitute, never silently clone into warehouse
    const presetBtn = prepareScreen
      .locator(
        '[data-load-preset="preset_missing_owned"], [data-testid="preset-preset_missing_owned"], [data-preset-id="preset_missing_owned"]',
      )
      .or(prepareScreen.getByRole('button', { name: /缺件校验方案/ }))
      .first();
    await expect(presetBtn).toBeVisible();
    await presetBtn.click();

    await expect(page.locator('body')).toContainText(/缺件|缺失|借用普通版|补位|已不在仓库|租借替代|借用替代/);

    const saveAfterPreset = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(saveAfterPreset?.profile.equipmentWarehouse).toHaveLength(0);

    monitor.assertClean(await app.inspect());
  });

  test('T2-A2-03 @p0-core Zero fuel does not auto-defeat, rejects insufficient-fuel jumps, and keeps 0-cost safe return enabled', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Sub-case A: fuel === 0 at L1A
    const zeroFuelRun = createV3RunFixture({
      phase: 'MAP',
      currentNodeId: 'L1A',
      fuel: 0,
      graph: createMapGraph({
        nodeOverrides: {
          L1A: { visited: true, resolved: true },
        },
      }),
    });
    await app.seedStorage({
      v2Save: { ...presetAct1V3(), activeRun: zeroFuelRun },
      skipTitleScreen: true,
    });
    await app.boot({ seed: 22003 });

    const snapA = await app.inspect();
    expect(snapA.phase).toBe('MAP');
    expect(snapA.activeRun?.fuel).toBe(0);

    await app.byTestId(TEST_IDS.mapNode('L2A')).click();
    const jumpBtn = app.byTestId(TEST_IDS.BTN_JUMP_NODE);
    await expect(jumpBtn).toBeDisabled();
    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toContainText(/燃料不足|需要\s*1|0/);
    expect((await app.inspect()).activeRun?.fuel).toBe(0);
    await expect(app.byTestId(TEST_IDS.BTN_SAFE_RETURN)).toBeEnabled();

    // Sub-case B: fuel === 1 while carrying Escape Pod (requires 1 + 1 = 2 fuel)
    const podBay = createCargoBay({
      shipId: 'cannon_skiff',
      placed: [
        {
          item: createCargoItem({
            instanceId: 'pod_fuel_check_1',
            definitionId: 'mission.escape_pod',
            origin: 'mission',
          }),
          x: 0,
          y: 0,
        },
      ],
    });
    const oneFuelPodRun = createV3RunFixture({
      phase: 'MAP',
      currentNodeId: 'L1A',
      fuel: 1,
      bay: podBay,
      contract: createContractInstance('rescue_std'),
      graph: createMapGraph({
        nodeOverrides: {
          L1A: { visited: true, resolved: true },
        },
      }),
    });
    await app.seedStorage({
      v2Save: { ...presetAct1V3(), activeRun: oneFuelPodRun },
      skipTitleScreen: true,
    });
    await app.boot({ seed: 22004 });

    await app.byTestId(TEST_IDS.mapNode('L2A')).click();
    await expect(app.byTestId(TEST_IDS.BTN_JUMP_NODE)).toBeDisabled();
    expect((await app.inspect()).activeRun?.fuel).toBe(1);

    // Safe return at 0 fuel cost must still succeed cleanly
    await app.safeReturn();
    const settleSnap = await app.inspect();
    expect(settleSnap.phase).toBe('SETTLEMENT');

    monitor.assertClean(settleSnap);
  });

  test('T2-A2-04 @p0-core Defeat tow-back pays exact 40% floor formula Math.floor((15+10+26)*0.4)=20 and protects Base assets', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const defeatBay = createCargoBay({
      shipId: 'cannon_skiff',
      placed: [
        {
          item: createCargoItem({
            instanceId: 'defeat_loan_laser',
            definitionId: 'equipment.laser.common',
            origin: 'loan',
          }),
          x: 0,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'defeat_owned_laser',
            definitionId: 'equipment.laser.common',
            origin: 'owned',
            fixedValue: 10,
          }),
          x: 1,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'defeat_loot_cargo',
            definitionId: 'cargo.alloy_bar',
            origin: 'loot',
            fixedValue: 26,
            acquiredDepth: 3,
          }),
          x: 2,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'defeat_mission_reactor',
            definitionId: 'mission.sealed_reactor',
            origin: 'mission',
          }),
          x: 0,
          y: 2,
          rotation: 1,
        },
      ],
    });

    const baseSave = presetSettlementV3({
      reason: 'defeat',
      wallet: 15,
      bay: defeatBay,
      contract: createContractInstance('transport_std', {
        overrides: { status: 'failed' },
      }),
    });

    // Customize Base profile assets that MUST stay 100% protected on defeat
    baseSave.profile.credits = 120;
    baseSave.profile.buildings.research_lab = true;
    baseSave.profile.relics = createDefaultRelics({
      ancient_navigator: { storedCount: 1, restored: true },
    });
    baseSave.profile.equipmentWarehouse = [
      createCargoItem({
        instanceId: 'base_protected_shield',
        definitionId: 'equipment.shield.improved',
        origin: 'owned',
      }),
    ];

    await app.seedStorage({
      v2Save: baseSave,
      skipTitleScreen: true,
    });
    await app.boot({ seed: 22005 });

    const settlementScreen = app.byTestId(TEST_IDS.SETTLEMENT_SCREEN);
    await expect(settlementScreen).toBeVisible();
    await expect(settlementScreen).toContainText(/战败|拖曳|40%/);
    await expect(settlementScreen).toContainText(/20/);

    await app.confirmSettlement();

    const postBaseSnap = await app.waitForInspect(
      (s) => s.screen === 'base' && s.activeRun === null,
      15_000,
      'returned to base after defeat settlement',
    );

    // 120 base + Math.floor((15 wallet + 10 owned + 26 loot) * 0.4) = 120 + 20 = 140
    expect(postBaseSnap.credits).toBe(140);

    const saved = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(saved?.profile.credits).toBe(140);
    expect(saved?.profile.buildings.research_lab).toBe(true);
    expect(saved?.profile.relics.ancient_navigator.restored).toBe(true);
    expect(saved?.profile.equipmentWarehouse.map((i) => i.instanceId)).toEqual([
      'base_protected_shield',
    ]);

    monitor.assertClean(postBaseSnap);
  });

  test('T2-A2-05 @p0-core Non-empty staging area blocks silent exit from Arrange and requires explicit confirmation', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const arrangeSave = presetArrangeV3([
      createCargoItem({
        instanceId: 'stg_unplaced_alloy',
        definitionId: 'cargo.alloy_bar',
        origin: 'loot',
        fixedValue: 15,
        acquiredDepth: 1,
      }),
    ]);

    await app.seedStorage({
      v2Save: arrangeSave,
      skipTitleScreen: true,
    });
    await app.boot({ seed: 22006 });

    const arrangeScreen = app.byTestId(TEST_IDS.ARRANGE_SCREEN);
    await expect(arrangeScreen).toBeVisible();

    // Non-empty staging strictly disables silent exit on ArrangeView
    const leaveBtn = app.byTestId(TEST_IDS.BTN_LEAVE_ARRANGE);
    await expect(leaveBtn).toBeVisible();
    await expect(leaveBtn).toBeDisabled();
    await expect(arrangeScreen).toContainText(/请先放置或舍弃暂存区物品|暂存区/);

    const snapWhileBlocked = await app.inspect();
    expect(snapWhileBlocked.phase).toBe('ARRANGE');

    const savedWhileBlocked = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(savedWhileBlocked?.activeRun?.bay.staging.map((s) => s.item.instanceId)).toContain(
      'stg_unplaced_alloy',
    );

    // Explicitly discarding the staging item unlocks leave, which then requires discard confirmation
    const stagingCard = page
      .locator('.v2-staging-card, .staging-card, [data-testid^="staging-item"]')
      .first();
    await expect(stagingCard).toBeVisible();
    await stagingCard.click();

    const discardBtn = page
      .locator('#btn-v2-discard, [data-testid^="btn-discard-"]')
      .or(page.getByRole('button', { name: /舍弃|丢弃|弃置/ }))
      .first();
    await expect(discardBtn).toBeVisible();
    await discardBtn.click();

    await expect(leaveBtn).toBeEnabled();
    await leaveBtn.click();

    const confirmPrompt = page.locator('.modal-card[role="dialog"], [role="dialog"]').first();
    await expect(confirmPrompt).toBeVisible();
    await expect(confirmPrompt).toContainText(/舍弃|永久|弃置/);

    // Cancel leaving -> stay on ARRANGE and undo discard to confirm item remains recoverable
    const cancelBtn = confirmPrompt
      .locator('#v2-discard-cancel')
      .or(confirmPrompt.getByRole('button', { name: /取消|返回整理|留下/ }))
      .first();
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();

    await expect(arrangeScreen).toBeVisible();
    expect((await app.inspect()).phase).toBe('ARRANGE');

    const undoBtn = page
      .locator('#btn-v2-undo-discard, [data-testid="btn-undo-discard"]')
      .or(page.getByRole('button', { name: /撤回|撤销/ }))
      .first();
    await expect(undoBtn).toBeVisible();
    await undoBtn.click();

    const savedAfterUndo = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(savedAfterUndo?.activeRun?.bay.staging.map((s) => s.item.instanceId)).toContain(
      'stg_unplaced_alloy',
    );

    monitor.assertClean(await app.inspect());
  });

  test('T2-A2-06 @p0-core Double Escape Pods cap fuel surcharge at +1 (total 2 not 3) and aborting uses humane rescue beacon', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const doublePodBay = createCargoBay({
      shipId: 'cannon_skiff',
      placed: [
        {
          item: createCargoItem({
            instanceId: 'pod_double_1',
            definitionId: 'mission.escape_pod',
            origin: 'mission',
          }),
          x: 0,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'pod_double_2',
            definitionId: 'mission.escape_pod',
            origin: 'mission',
          }),
          x: 1,
          y: 0,
        },
      ],
    });

    const rescueRun = presetMidRunMapV3({
      currentNodeId: 'L1A',
      fuel: 6,
      bay: doublePodBay,
      contract: createContractInstance('rescue_deep'),
      graph: createMapGraph({
        nodeOverrides: {
          L1A: { visited: true, resolved: true },
          L2A: { type: 'merchant', fuelCost: 1 },
        },
      }),
    });

    await app.seedStorage({
      v2Save: rescueRun,
      skipTitleScreen: true,
    });
    await app.boot({ seed: 22007 });

    await app.byTestId(TEST_IDS.mapNode('L2A')).click();
    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toContainText(/2\s*燃料|消耗\s*2/);
    await app.byTestId(TEST_IDS.BTN_JUMP_NODE).click();

    const afterJump = await app.waitForInspect(
      (s) => s.activeRun !== null && s.activeRun.fuel === 4,
      15_000,
      'double escape pod jump costs exactly 2 fuel (6 -> 4)',
    );
    expect(afterJump.activeRun?.fuel).toBe(4);

    // Verify humane beacon abort / 0 sell value in Arrange when aborting a rescue contract holding an escape pod
    const rescueAbortContract = createContractInstance('rescue_std', {
      overrides: { contractId: 'rescue_humane_abort_1' },
    });
    const podArrange = presetArrangeV3([
      createCargoItem({
        instanceId: 'pod_humane_abort',
        definitionId: 'mission.escape_pod',
        origin: 'mission',
        missionBinding: rescueAbortContract.contractId,
        location: 'staging',
      }),
    ]);
    if (podArrange.activeRun) {
      podArrange.activeRun.contract = rescueAbortContract;
    }
    const creditsBeforeAbort = podArrange.profile.credits;

    await app.seedStorage({
      v2Save: podArrange,
      skipTitleScreen: true,
    });
    await app.boot({ seed: 22008 });

    const arrangeScreen = app.byTestId(TEST_IDS.ARRANGE_SCREEN);
    await expect(arrangeScreen).toBeVisible();

    const stagingPod = arrangeScreen
      .locator('.v2-staging-card, .staging-card, [data-testid^="staging-item"]')
      .first();
    await expect(stagingPod).toBeVisible();
    await stagingPod.click();

    const abortOrDiscardBtn = arrangeScreen
      .locator('#v2-arrange-abort, #btn-v2-discard, [data-testid^="btn-discard-"]')
      .or(arrangeScreen.getByRole('button', { name: /放弃当前委托|移交|信标|舍弃|丢弃|放弃/ }))
      .first();
    await expect(abortOrDiscardBtn).toBeVisible();
    await abortOrDiscardBtn.click();

    // Confirm abort modal if prompted
    const confirmAbortBtn = page
      .locator('[role="dialog"] button')
      .filter({ hasText: /确认|放弃|移交|释放/ })
      .first();
    if (await confirmAbortBtn.isVisible()) {
      await confirmAbortBtn.click();
    }

    await expect(page.locator('body')).toContainText(/救援信标|移交|安全信标|放弃委托|已放弃/);

    const savedAfterAbort = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(savedAfterAbort?.profile.credits).toBe(creditsBeforeAbort);
    expect(savedAfterAbort?.activeRun?.contract.status).toBe('aborted');
    expect(
      savedAfterAbort?.activeRun?.bay.staging.some(
        (s) => s.item.instanceId === 'pod_humane_abort',
      ),
    ).toBe(false);

    monitor.assertClean(await app.inspect());
  });
});
