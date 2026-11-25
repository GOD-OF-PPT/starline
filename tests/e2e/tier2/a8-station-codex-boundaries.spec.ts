import { expect, test } from '@playwright/test';
import {
  ITEM_CATALOG,
  RESEARCH_COST_CREDITS,
  STARTING_FUEL,
  STORAGE_KEYS,
  TEST_IDS,
  WAREHOUSE_BASE_CAPACITY,
  attachZeroErrorMonitors,
  createAppDriver,
  createCargoBay,
  createCargoItem,
  createDefaultRelics,
  presetAct1V3,
  presetAct2V3,
  presetAct3ClimaxV3,
  presetPostTutorialV3,
  presetSettlementV3,
} from '../helpers';
import type { V3SaveData } from '../helpers';

test.describe('Tier 2 · A8: Station, Warehouse Cap, Codex & Relic Boundaries', () => {
  test('T2-A8-01 @p1-mid Codex achieves 100% reachability (N/N) with zero unobtainable ghost entries (fixes V2 29/31 bug)', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const allCatalogDefIds = Object.keys(ITEM_CATALOG);
    await app.seedStorage({
      v2Save: presetAct3ClimaxV3({
        discoveredItems: allCatalogDefIds,
        seenItems: allCatalogDefIds,
      }),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 28001, enterStation: true });

    const codexDialog = await app.openBaseModal(TEST_IDS.BTN_OPEN_CODEX);
    const text = await codexDialog.innerText();

    // Extract discovered/total ratio e.g. "45 / 45" or "31/31"
    const ratioMatch = text.match(/(\d+)\s*\/\s*(\d+)/);
    expect(ratioMatch, `Codex must display discovered/total ratio (got: ${text.slice(0, 120)})`).not.toBeNull();
    if (ratioMatch) {
      const discovered = Number(ratioMatch[1]);
      const total = Number(ratioMatch[2]);
      expect(total).toBeGreaterThanOrEqual(29);
      expect(discovered, `Codex must reach 100% (${total}/${total}) without ghost entries`).toBe(
        total,
      );
    }

    await expect(codexDialog).toContainText(/100%/);
    await app.closeModal();

    monitor.assertClean(await app.inspect());
  });

  test('T2-A8-02 @p1-mid Full warehouse blocks storing overflow equipment with explicit notice and never silently deletes pending gifts', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const fullWarehouse = Array.from({ length: WAREHOUSE_BASE_CAPACITY }, (_, idx) =>
      createCargoItem({
        instanceId: `wh_full_${idx + 1}`,
        definitionId: idx % 2 === 0 ? 'equipment.laser.common' : 'equipment.shield.common',
        origin: 'owned',
      }),
    );

    const pendingGift = createCargoItem({
      instanceId: 'pending_gift_heavy_1',
      definitionId: 'equipment.heavy.common',
      origin: 'owned',
    });

    const settleSave = presetSettlementV3({
      reason: 'safe_return',
      bay: createCargoBay({
        shipId: 'cannon_skiff',
        placed: [
          {
            item: createCargoItem({
              instanceId: 'settle_overflow_eq',
              definitionId: 'equipment.battery.common',
              origin: 'loot',
              fixedValue: 8,
              acquiredDepth: 2,
            }),
            x: 0,
            y: 0,
          },
        ],
      }),
    });
    settleSave.profile.buildings.research_lab = true;
    settleSave.profile.facilityTiers.research_lab = 1;
    settleSave.profile.equipmentWarehouse = fullWarehouse;
    settleSave.profile.pendingGiftQueue = [pendingGift];

    await app.seedStorage({
      v2Save: settleSave,
      skipTitleScreen: true,
    });
    await app.boot({ seed: 28002 });

    const settlementScreen = app.byTestId(TEST_IDS.SETTLEMENT_SCREEN);
    await expect(settlementScreen).toBeVisible();

    const storeBtn = app.byTestId(TEST_IDS.btnStore('settle_overflow_eq'));
    await expect(storeBtn, 'Settlement loot equipment must render a store control').toBeVisible();

    // Selecting store on a full 12/12 warehouse triggers overflow notice (13/12) and strictly disables Confirm Settlement
    await storeBtn.click();
    await expect(settlementScreen).toContainText(/超出上限|设备库已满|13\s*\/\s*12/);
    await expect(app.byTestId(TEST_IDS.BTN_CONFIRM_SETTLEMENT)).toBeDisabled();

    // Switching back to sell clears overflow and re-enables Confirm Settlement
    const sellBtn = settlementScreen
      .locator('[data-settle-item="settle_overflow_eq"][data-settle-disp="sell"]')
      .first();
    await expect(sellBtn).toBeVisible();
    await sellBtn.click();
    await expect(app.byTestId(TEST_IDS.BTN_CONFIRM_SETTLEMENT)).toBeEnabled();

    await app.confirmSettlement();

    const saved = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(saved?.profile.equipmentWarehouse).toHaveLength(WAREHOUSE_BASE_CAPACITY);
    expect(saved?.profile.pendingGiftQueue.map((i) => i.instanceId)).toContain(
      'pending_gift_heavy_1',
    );

    monitor.assertClean(await app.inspect());
  });

  test('T2-A8-03 @p1-mid Blueprint research rapid double-click debits 30 credits strictly once and blocks duplicate research', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({
      v2Save: presetAct1V3({
        credits: RESEARCH_COST_CREDITS * 2, // 60¤ so a double-debit bug would leave 0 instead of 30
        buildings: {
          workbench: true,
          contract_hub: true,
          drydock: true,
          research_lab: true,
          display: false,
          drydock_tier2: false,
        },
        blueprints: ['laser', 'battery', 'shield', 'repair'],
        equipmentWarehouse: [
          createCargoItem({
            instanceId: 'res_heavy_1',
            definitionId: 'equipment.heavy.common',
            origin: 'owned',
          }),
          createCargoItem({
            instanceId: 'res_heavy_2',
            definitionId: 'equipment.heavy.common',
            origin: 'owned',
          }),
        ],
      }),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 28003, enterStation: true });

    const dialog = await app.openBaseModal(TEST_IDS.BTN_OPEN_WAREHOUSE);
    const researchBtn = dialog
      .locator(
        '[data-research-id="res_heavy_1"], [data-testid="btn-research-res_heavy_1"], [data-instance-id="res_heavy_1"] button:has-text("研究")',
      )
      .or(dialog.getByRole('button', { name: /研究蓝图|研究/ }))
      .first();
    await expect(researchBtn).toBeVisible();
    await expect(researchBtn).toBeEnabled();

    // Rapid double-click research trigger
    await researchBtn.dblclick();

    // If a confirmation button appears, rapid double-click confirm as well
    const confirmBtn = page
      .locator('[data-testid="btn-confirm-research"], button:has-text("确认研究")')
      .first();
    if (await confirmBtn.isVisible()) {
      await confirmBtn.dblclick();
    }

    await app.waitForInspect(
      (s) => s.credits === RESEARCH_COST_CREDITS,
      15_000,
      'research deducted 30 credits once',
    );

    const saved = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(saved?.profile.credits).toBe(RESEARCH_COST_CREDITS);
    expect(saved?.profile.blueprints.filter((b) => b === 'heavy')).toHaveLength(1);
    expect(saved?.profile.equipmentWarehouse).toHaveLength(1);

    // Remaining heavy copy must remain visible and expose ZERO enabled research controls
    const remainingHeavyRow = dialog
      .locator('.v2-wh-row, .warehouse-item, .v2-warehouse-row')
      .filter({ hasText: /重炮/ })
      .first();
    await expect(remainingHeavyRow).toBeVisible();
    await expect(
      dialog.locator(
        '[data-research-id="res_heavy_2"]:not([disabled]), [data-testid="btn-research-res_heavy_2"]:not([disabled])',
      ),
    ).toHaveCount(0);
    await expect(dialog.locator('button:not([disabled])').filter({ hasText: /研究/ })).toHaveCount(0);

    await app.closeModal();
    monitor.assertClean(await app.inspect());
  });

  test('T2-A8-04 @p0-core Unmet facility prerequisites and insufficient credits disable construction without mutating state', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({
      v2Save: presetPostTutorialV3({
        credits: 20,
        salvageParts: 0,
        completedContractTypes: [],
        buildings: {
          workbench: true,
          contract_hub: true,
          drydock: false,
          research_lab: false,
          display: false,
          drydock_tier2: false,
        },
        facilityTiers: {
          workbench: 1,
          contract_hub: 1,
          drydock: 0,
          research_lab: 0,
          display: 0,
          drydock_tier2: 0,
          stargate_relay: 0,
        },
      }),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 28004, enterStation: true });

    const facilitiesDialog = await app.openBaseModal(TEST_IDS.BTN_OPEN_FACILITIES);
    await expect(facilitiesDialog).toContainText(/信用点不足|前置|条件|需要/);

    const allBuildButtons = facilitiesDialog
      .locator('[data-modal-build], [data-testid^="btn-build-"], button')
      .filter({ hasText: /建造|升级|扩建/ });
    expect(
      await allBuildButtons.count(),
      'Locked facilities must render build/upgrade controls',
    ).toBeGreaterThanOrEqual(4);

    const enabledBuildButtons = facilitiesDialog
      .locator('button:not(.modal-close-btn):not([disabled])')
      .filter({ hasText: /建造|升级|扩建/ });
    await expect(enabledBuildButtons).toHaveCount(0);

    expect((await app.inspect()).credits).toBe(20);
    await app.closeModal();

    const saved = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(saved?.profile.buildings.research_lab).toBe(false);
    expect(saved?.profile.buildings.drydock).toBe(false);
    expect(saved?.profile.facilityTiers.stargate_relay).toBe(0);

    monitor.assertClean(await app.inspect());
  });

  test('T2-A8-05 @p2-late Unrestored stored relics grant zero passive bonuses until explicitly restored', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({
      v2Save: presetAct2V3({
        selectedShipId: 'cannon_skiff',
        relics: createDefaultRelics({
          ancient_navigator: { storedCount: 1, restored: false },
          quantum_core: { storedCount: 1, restored: false },
          cryo_amber: { storedCount: 1, restored: false },
          obsidian_crown: { storedCount: 1, restored: false },
        }),
      }),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 28005, enterStation: true });

    await app.openPrepareFromBase();
    await app.selectShip('cannon_skiff');

    // Unrestored quantum_core must NOT increase cannon_skiff budget from 6 to 7
    const prepareText = await app.byTestId(TEST_IDS.PREPARE_SCREEN).innerText();
    expect(prepareText).toMatch(/\/\s*6\b|预算[^\d]*6\b/);
    expect(prepareText).not.toMatch(/\/\s*7\b/);

    await app.launchExpedition();

    const mapSnap = await app.waitForInspect(
      (s) => s.screen === 'run' && s.phase === 'MAP' && s.activeRun !== null,
      15_000,
      'launched with unrestored relics',
    );
    // Unrestored ancient_navigator must NOT add +1 fuel; unrestored cryo_amber must NOT add +4 maxHp
    expect(mapSnap.activeRun?.fuel).toBe(STARTING_FUEL);
    expect(mapSnap.activeRun?.maxHp).toBe(30);

    monitor.assertClean(mapSnap);
  });

  test('T2-A8-06 @p1-mid D07 Run-1 pending family unlock persists across reload with single-claim guard and defeat suppression, plus D03 Codex Synergy Journal redaction (0/10 vs 10/10)', async ({
    page,
  }) => {
    test.slow();
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Part A1: Run-1 safe_return confirmed WITHOUT picking a family -> persists 3 choices across reload on Base; single claim removes card
    const run1SafeSettle = presetSettlementV3({ reason: 'safe_return', wallet: 25 });
    run1SafeSettle.profile.totalRuns = 0;
    run1SafeSettle.profile.unlockedFamilies = ['core'];
    run1SafeSettle.profile.completedContractTypes = [];
    run1SafeSettle.profile.completedContractIds = [];
    run1SafeSettle.profile.pendingFamilyUnlockChoices = [];

    await app.seedStorage({ v2Save: run1SafeSettle, skipTitleScreen: true });
    await app.boot({ seed: 28006 });

    await expect(app.byTestId(TEST_IDS.SETTLEMENT_SCREEN)).toBeVisible();
    const settleFamSection = app.byTestId(TEST_IDS.SETTLEMENT_FAMILY_UNLOCK);
    await expect(settleFamSection).toBeVisible();
    await expect(app.byTestId(TEST_IDS.familyUnlockOption('heavy_kit'))).toBeVisible();
    await expect(app.byTestId(TEST_IDS.familyUnlockOption('hangar_kit'))).toBeVisible();
    await expect(app.byTestId(TEST_IDS.familyUnlockOption('counter_kit'))).toBeVisible();

    // Confirm settlement WITHOUT choosing any family -> pending choices persist onto Base fallback card
    await app.confirmSettlement();
    await expect(app.byTestId(TEST_IDS.BASE_FAMILY_UNLOCK_CARD)).toBeVisible();

    // Reload Base -> all 3 pending choices MUST survive reload intact
    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.waitForInspect((s) => s.screen === 'base', 30_000, 'base ready after reload');
    await expect(app.byTestId(TEST_IDS.BASE_FAMILY_UNLOCK_CARD)).toBeVisible();
    await expect(app.byTestId(TEST_IDS.btnPickFamily('heavy_kit'))).toBeVisible();
    await expect(app.byTestId(TEST_IDS.btnPickFamily('hangar_kit'))).toBeVisible();
    await expect(app.byTestId(TEST_IDS.btnPickFamily('counter_kit'))).toBeVisible();

    const savedBeforeClaim = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(savedBeforeClaim?.profile.pendingFamilyUnlockChoices).toHaveLength(3);

    // Single claim unlocks heavy_kit, clears pendingFamilyUnlockChoices, and detaches base-family-unlock-card
    await app.byTestId(TEST_IDS.btnPickFamily('heavy_kit')).click();
    await expect(app.byTestId(TEST_IDS.BASE_FAMILY_UNLOCK_CARD)).toHaveCount(0);

    const savedAfterClaim = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(savedAfterClaim?.profile.unlockedFamilies.filter((f) => f === 'heavy_kit')).toHaveLength(1);
    expect(savedAfterClaim?.profile.pendingFamilyUnlockChoices ?? []).toHaveLength(0);

    // Part A2: Run-1 defeat strictly suppresses settlement-family-unlock and leaves pending choices empty
    const run1DefeatSettle = presetSettlementV3({ reason: 'defeat', wallet: 25 });
    run1DefeatSettle.profile.totalRuns = 0;
    run1DefeatSettle.profile.unlockedFamilies = ['core'];
    run1DefeatSettle.profile.completedContractTypes = [];
    run1DefeatSettle.profile.completedContractIds = [];
    run1DefeatSettle.profile.pendingFamilyUnlockChoices = [];

    await app.seedStorage({ v2Save: run1DefeatSettle, skipTitleScreen: true });
    await app.boot({ seed: 28007 });

    await expect(app.byTestId(TEST_IDS.SETTLEMENT_SCREEN)).toBeVisible();
    await expect(app.byTestId(TEST_IDS.SETTLEMENT_FAMILY_UNLOCK)).toHaveCount(0);
    await app.confirmSettlement();
    await expect(app.byTestId(TEST_IDS.BASE_FAMILY_UNLOCK_CARD)).toHaveCount(0);

    const savedAfterDefeat = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(savedAfterDefeat?.profile.pendingFamilyUnlockChoices ?? []).toHaveLength(0);

    // Part B: D03 Codex Synergy Journal redaction (0/10 locked vs 10/10 discovered with 跨类 tags)
    await app.seedStorage({
      v2Save: presetAct1V3({ discoveredSynergies: [] }),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 28008, enterStation: true });

    const codexEmpty = await app.openBaseModal(TEST_IDS.BTN_OPEN_CODEX);
    const synEmpty = codexEmpty.getByTestId(TEST_IDS.CODEX_SYNERGY_SECTION);
    await expect(synEmpty).toBeVisible();
    await expect(synEmpty).toContainText('联动图鉴 (0/10)');
    await expect(synEmpty.locator('[data-synergy-state="locked"]')).toHaveCount(10);
    await expect(synEmpty.locator('[data-synergy-state="discovered"]')).toHaveCount(0);
    await expect(synEmpty).toContainText('未发现联动');
    await app.closeModal();

    const allTenSynergies = [
      'battery_laser',
      'coolant_heavy',
      'capacitor_heavy',
      'relay_hangar',
      'shield_counter',
      'coolant_vent_heavy',
      'coolant_vent_salvo',
      'support_salvo',
      'overdrive_weapon',
      'cargo_amp_cargo',
    ];
    await app.seedStorage({
      v2Save: presetAct3ClimaxV3({ discoveredSynergies: allTenSynergies }),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 28009, enterStation: true });

    const codexFull = await app.openBaseModal(TEST_IDS.BTN_OPEN_CODEX);
    const synFull = codexFull.getByTestId(TEST_IDS.CODEX_SYNERGY_SECTION);
    await expect(synFull).toBeVisible();
    await expect(synFull).toContainText('联动图鉴 (10/10)');
    await expect(synFull.locator('[data-synergy-state="discovered"]')).toHaveCount(10);
    await expect(synFull.locator('[data-synergy-state="locked"]')).toHaveCount(0);
    await expect(synFull.locator('[data-synergy-id="coolant_heavy"]')).toContainText('跨类');
    await expect(synFull.locator('[data-synergy-id="cargo_amp_cargo"]')).toContainText('跨类');
    await app.closeModal();

    monitor.assertClean(await app.inspect());
  });
});
