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
  createV3RunFixture,
  presetPostTutorialV3,
  presetSettlementV3,
} from '../helpers';
import type { V3SaveData } from '../helpers';

test.describe('Tier 4 · J6: Zero-Credit Defeat -> Tow-Back -> Free-Loan Comeback Loop', () => {
  test('T4-06 Bankruptcy-proof comeback: 0¤ launch -> lethal defeat tow-back (40% floor) -> free loan re-launch -> contract -> Research Lab -> Run #3', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // =========================================================================
    // Run #1: Start at 0¤ with completely empty equipmentWarehouse -> free loan launch
    // =========================================================================
    const zeroCreditBase = presetPostTutorialV3({
      credits: 0,
      salvageParts: 0,
      equipmentWarehouse: [],
      completedContractTypes: [],
      completedContractIds: [],
    });

    await app.seedStorage({ v2Save: zeroCreditBase, skipTitleScreen: true });
    await app.boot({ seed: 46001, enterStation: true });
    expect((await app.inspect()).credits).toBe(0);

    await app.openPrepareFromBase();
    await app.launchExpedition();
    const run1Map = await app.waitForInspect((s) => s.phase === 'MAP', 15_000, 'Run #1 free loan launched at 0¤');
    expect(run1Map.activeRun?.fuel).toBeGreaterThan(0);

    // Deliberately enter a lethal battle (1 HP vs elite/boss with minimal stripped bay) to trigger defeat tow-back
    const lethalSave: V3SaveData = {
      ...zeroCreditBase,
      settings: { ...zeroCreditBase.settings, pureAutoCombat: true },
      activeRun: createV3RunFixture({
        runId: 'run_bankrupt_defeat_1',
        seed: 46002,
        phase: 'ENCOUNTER',
        currentNodeId: 'L5B',
        hp: 1,
        maxHp: 30,
        wallet: 50,
        graph: createMapGraph({
          nodeOverrides: {
            L5B: { type: 'elite', encounterKind: 'elite', visited: true, resolved: false },
          },
        }),
        bay: createCargoBay({
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
                instanceId: 'defeat_loot_engine',
                definitionId: 'cargo.old_engine',
                origin: 'loot',
                fixedValue: 50,
                acquiredDepth: 3,
              }),
              x: 1,
              y: 0,
            },
          ],
        }),
        overrides: {
          visitedNodeIds: ['L1A', 'L2A', 'L3A', 'L4A', 'L5B'],
          activeCombat: null,
        },
      }),
    };

    await app.seedStorage({ v2Save: lethalSave, skipTitleScreen: true });
    await app.boot({ seed: 46002 });

    await expect(app.byTestId(TEST_IDS.COMBAT_SCREEN)).toBeVisible();
    await app.startCombat();
    await app.skipCombat();

    const defeatSettle = await app.waitForInspect(
      (s) => s.phase === 'SETTLEMENT',
      20_000,
      'defeat tow-back settlement',
    );
    expect(defeatSettle.activeRun?.hp).toBe(0);
    await expect(app.byTestId(TEST_IDS.SETTLEMENT_SCREEN)).toContainText(/拖航|失利|40%|保底/);
    await app.confirmSettlement();

    const afterDefeatBase = await app.waitForInspect((s) => s.screen === 'base', 15_000, 'base after tow-back');
    // 40% tow-back payout preserves non-zero salvage recovery & never corrupts base integrity
    expect(afterDefeatBase.credits).toBeGreaterThan(0);

    // =========================================================================
    // Run #2: Immediate re-launch with free loan kit -> complete standard contract -> earn >= 100¤
    // =========================================================================
    await app.openPrepareFromBase();
    await app.launchExpedition();
    await app.waitForInspect((s) => s.phase === 'MAP', 15_000, 'Run #2 free loan comeback launch');

    // Complete standard transport contract safely & confirm settlement (missionBinding matches contractId)
    const comebackContract = createContractInstance('transport_std', {
      overrides: { status: 'active', completedNodeIds: ['L3A'], requiredCompletions: 1 },
    });
    const comebackBay = createCargoBay({
      shipId: 'cannon_skiff',
      placed: [
        {
          item: createCargoItem({
            instanceId: 'comeback_mission_reactor',
            definitionId: 'mission.sealed_reactor',
            origin: 'mission',
            fixedValue: 0,
            missionBinding: comebackContract.contractId,
          }),
          x: 0,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'comeback_loan_laser',
            definitionId: 'equipment.laser.common',
            origin: 'loan',
          }),
          x: 2,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'comeback_loot_alloy',
            definitionId: 'cargo.alloy_bar',
            origin: 'loot',
            fixedValue: 20,
            acquiredDepth: 2,
          }),
          x: 3,
          y: 0,
        },
      ],
    });
    const comebackSettle = presetSettlementV3({
      reason: 'safe_return',
      wallet: 35,
      bay: comebackBay,
      contract: comebackContract,
    });
    comebackSettle.profile = {
      ...zeroCreditBase.profile,
      credits: Math.max(afterDefeatBase.credits, 40),
    };

    await app.seedStorage({ v2Save: comebackSettle, skipTitleScreen: true });
    await app.boot({ seed: 46003 });
    await expect(app.byTestId(TEST_IDS.SETTLEMENT_SCREEN)).toBeVisible();
    await app.confirmSettlement();

    const postComebackBase = await app.waitForInspect((s) => s.screen === 'base', 15_000, 'base after comeback');
    expect(postComebackBase.credits).toBeGreaterThanOrEqual(100);

    const savedBeforeBuild = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(savedBeforeBuild?.profile.completedContractTypes).toContain('transport');

    // =========================================================================
    // Build research_lab (100¤) & Launch Run #3 cleanly
    // =========================================================================
    const facModal = await app.openBaseModal(TEST_IDS.BTN_OPEN_FACILITIES);
    const buildResearchBtn = facModal
      .locator(
        '[data-modal-build="research_lab"], [data-facility-id="research_lab"] button, [data-testid="build-facility-research_lab"]',
      )
      .or(facModal.locator('section, article, div').filter({ hasText: /研发|研究所/ }).getByRole('button', { name: /建造|启用/ }))
      .first();
    await expect(buildResearchBtn).toBeVisible();
    await expect(buildResearchBtn).toBeEnabled();
    await buildResearchBtn.click();
    await app.closeModal();

    const savedAfterBuild = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(savedAfterBuild?.profile.buildings.research_lab).toBe(true);

    // Launch Run #3 verifying comeback loop continues cleanly
    await app.openPrepareFromBase();
    await app.launchExpedition();
    const run3Snap = await app.waitForInspect((s) => s.phase === 'MAP', 15_000, 'Run #3 launched cleanly');
    expect(run3Snap.activeRun).not.toBeNull();

    monitor.assertClean(run3Snap);
  });
});
