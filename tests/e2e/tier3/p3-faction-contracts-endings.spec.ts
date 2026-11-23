import { expect, test } from '@playwright/test';
import {
  ENDING_NAMES,
  FACTION_NAMES,
  STORAGE_KEYS,
  TEST_IDS,
  attachZeroErrorMonitors,
  createAppDriver,
  createCargoBay,
  createCargoItem,
  createContractInstance,
  presetAct3ClimaxV3,
  presetBossEncounterV3,
  presetSettlementV3,
  presetShopEncounterV3,
} from '../helpers';
import type { V3SaveData } from '../helpers';

test.describe('Tier 3 · P3: Faction Reputation × Shop/Contracts/Bonus Objectives × Endings', () => {
  test('T3-P3-01 Starport Guild Lv3 Rep × Merchant Discount × Bounty Bonus Objective pays atomically with anti-arbitrage', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Part A: Shop discount under Starport Guild Lv3 Rep (>= 220) still enforces no-arbitrage
    const shopSave = presetShopEncounterV3({ wallet: 120 });
    shopSave.profile.factionRep.starport_guild = 240;
    if (shopSave.activeRun) {
      shopSave.activeRun.contract = createContractInstance('bounty_std', {
        bonusObjective: {
          id: 'bonus_hp_60',
          label: '返回时船体 ≥ 60%',
          completed: true,
          rewardCredits: 26,
        },
        overrides: { status: 'active', completedNodeIds: ['L3A'], requiredCompletions: 1 },
      });
      shopSave.activeRun.bonusObjective = shopSave.activeRun.contract.bonusObjective;
    }

    await app.seedStorage({ v2Save: shopSave, skipTitleScreen: true });
    await app.boot({ seed: 33001 });

    const shopScreen = app.byTestId(TEST_IDS.SHOP_SCREEN);
    await expect(shopScreen).toBeVisible();
    await expect(shopScreen).toContainText(new RegExp(`${FACTION_NAMES.starport_guild}|折扣|声望|Lv3`));

    // Read offer #1 discounted buy price & verify buying then checking sell-back yields strictly less
    const buyOfferBtn = shopScreen
      .locator('[data-buy-offer], [data-testid^="shop-buy-offer-"], [data-offer-id]')
      .or(shopScreen.getByRole('button', { name: /购买/ }))
      .first();
    await expect(buyOfferBtn).toBeVisible();
    const buyText = (await buyOfferBtn.textContent()) ?? '';
    const buyPriceMatch = buyText.match(/(\d+)\s*¤/);
    expect(buyPriceMatch, 'Offer button must display credit price').not.toBeNull();
    const discountedBuyPrice = Number(buyPriceMatch?.[1] ?? 0);
    expect(discountedBuyPrice).toBeGreaterThan(0);

    await buyOfferBtn.click();

    const sellOfferBtn = shopScreen
      .locator('[data-sell-loot], [data-testid^="shop-sell-"], button:has-text("卖出"), button:has-text("出售")')
      .first();
    await expect(sellOfferBtn).toBeVisible();
    const sellText = (await sellOfferBtn.textContent()) ?? '';
    const sellPriceMatch = sellText.match(/(\d+)\s*¤/);
    expect(sellPriceMatch, 'Sell button must display credit value').not.toBeNull();
    const sellBackPrice = Number(sellPriceMatch?.[1] ?? 0);
    expect(sellBackPrice, 'Anti-arbitrage must hold even with Guild Lv3 discount').toBeLessThan(
      discountedBuyPrice,
    );

    // Part B: Settlement of Bounty contract with completed +30% bonus objective & Guild Rep gain
    const bountyContract = createContractInstance('bounty_std', {
      bonusObjective: {
        id: 'bonus_hp_60',
        label: '返回时船体 ≥ 60%',
        completed: true,
        rewardCredits: 26,
      },
      overrides: { status: 'active', completedNodeIds: ['L3A'], requiredCompletions: 1 },
    });
    const settleSave = presetSettlementV3({
      wallet: 50,
      contract: bountyContract,
      bonusObjective: bountyContract.bonusObjective,
    });
    settleSave.profile.credits = 200;
    settleSave.profile.factionRep.starport_guild = 220;

    await app.seedStorage({ v2Save: settleSave, skipTitleScreen: true });
    await app.boot({ seed: 33002 });

    const settleScreen = app.byTestId(TEST_IDS.SETTLEMENT_SCREEN);
    await expect(settleScreen).toBeVisible();
    await expect(settleScreen).toContainText(/额外目标|奖励|85|26/);

    await app.confirmSettlement();
    const baseSnap = await app.waitForInspect((s) => s.screen === 'base', 15_000, 'base after bounty settlement');
    // Credits must include base 200 + wallet 50 + contract 85 + bonus 26 = >= 361
    expect(baseSnap.credits).toBeGreaterThanOrEqual(361);

    const stored = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(stored?.profile.factionRep.starport_guild).toBeGreaterThan(220);

    monitor.assertClean(baseSnap);
  });

  test('T3-P3-02 Free Salvagers Lv2+ Rep × Derelict Extraction Contract × Settlement Dismantle protects black box', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const derelictContract = createContractInstance('derelict_std', {
      overrides: { status: 'active', completedNodeIds: ['L4A'], requiredCompletions: 1 },
    });
    const bay = createCargoBay({
      shipId: 'cannon_skiff',
      placed: [
        {
          item: createCargoItem({
            instanceId: 'der_loan_laser',
            definitionId: 'equipment.laser.common',
            origin: 'loan',
          }),
          x: 0,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'der_mission_box',
            definitionId: 'mission.black_box',
            origin: 'mission',
            fixedValue: 0,
            missionBinding: derelictContract.contractId,
          }),
          x: 1,
          y: 0,
        },
        {
          item: createCargoItem({
            instanceId: 'der_loot_shield',
            definitionId: 'equipment.shield.common',
            origin: 'loot',
            fixedValue: 10,
            acquiredDepth: 3,
          }),
          x: 2,
          y: 0,
        },
      ],
    });

    const settleSave = presetSettlementV3({
      wallet: 30,
      bay,
      contract: derelictContract,
    });
    settleSave.profile.salvageParts = 10;
    settleSave.profile.factionRep.free_salvagers = 140;

    await app.seedStorage({ v2Save: settleSave, skipTitleScreen: true });
    await app.boot({ seed: 33003 });

    const settleScreen = app.byTestId(TEST_IDS.SETTLEMENT_SCREEN);
    await expect(settleScreen).toBeVisible();
    await expect(settleScreen).toContainText(/黑匣/);

    // Mission black box must be visible and MUST NOT expose any enabled dismantle button; looted equipment MUST offer dismantle -> Salvage Parts
    const missionRow = settleScreen
      .locator('.v2-settle-row, [data-testid^="settle-row-"], tr, li')
      .filter({ hasText: /黑匣/ })
      .first();
    await expect(missionRow, 'Mission black box row must be visible on Settlement').toBeVisible();
    await expect(
      missionRow.locator('button:not([disabled])').filter({ hasText: /拆解/ }),
      'Mission black box must NOT expose any enabled dismantle button',
    ).toHaveCount(0);

    const dismantleToggle = settleScreen
      .locator(
        '[data-settle-item="der_loot_shield"][data-settle-disp="dismantle"], [data-testid^="btn-dismantle-"], [data-action="dismantle"]',
      )
      .or(settleScreen.locator('.v2-settle-row').filter({ hasText: /护盾/ }).getByRole('button', { name: /拆解/ }))
      .or(settleScreen.getByRole('button', { name: /拆解/ }))
      .first();
    await expect(dismantleToggle).toBeVisible();
    await expect(dismantleToggle).toBeEnabled();
    await dismantleToggle.click();

    await app.confirmSettlement();
    const baseSnap = await app.waitForInspect((s) => s.screen === 'base', 15_000, 'base after derelict dismantle');
    expect(baseSnap.salvageParts).toBeGreaterThan(10);

    const stored = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(stored?.profile.factionRep.free_salvagers).toBeGreaterThan(140);
    expect(stored?.profile.completedContractTypes).toContain('derelict');

    monitor.assertClean(baseSnap);
  });

  test('T3-P3-03 Deep Institute Rep × Restored Relics × stargate_reignited Ending epilogue', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const climaxSave = presetBossEncounterV3(3, {
      factionRep: {
        starport_guild: 120,
        deep_institute: 280,
        free_salvagers: 110,
      },
      relics: {
        ancient_navigator: { storedCount: 1, restored: true },
        quantum_core: { storedCount: 1, restored: true },
        cryo_amber: { storedCount: 1, restored: true },
        obsidian_crown: { storedCount: 1, restored: true },
      },
    });
    climaxSave.settings.pureAutoCombat = true;

    await app.seedStorage({ v2Save: climaxSave, skipTitleScreen: true });
    await app.boot({ seed: 33004 });

    await app.startCombat();
    await app.skipCombat();

    const endingScreen = app.byTestId(TEST_IDS.ENDING_SCREEN);
    await expect(endingScreen).toBeVisible({ timeout: 20_000 });
    await app.selectEnding('stargate_reignited');

    await expect(endingScreen).toContainText(ENDING_NAMES.stargate_reignited);
    await expect(endingScreen).toContainText(new RegExp(`${FACTION_NAMES.deep_institute}|遗物|星门`));

    await app.continueFromEnding();
    const baseSnap = await app.waitForInspect(
      (s) => s.screen === 'base' && s.endingsUnlocked.includes('stargate_reignited'),
      15_000,
      'stargate_reignited persisted on base',
    );
    expect(baseSnap.endingsUnlocked).toContain('stargate_reignited');

    monitor.assertClean(baseSnap);
  });

  test('T3-P3-04 Alternate Faction Alignments × Alternate Climax Endings (free_haven & fleet_heir) coexist without overwrite', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const earnEnding = async (
      endingId: 'free_haven' | 'fleet_heir',
      existingEndings: ('stargate_reignited' | 'free_haven' | 'fleet_heir')[],
      seed: number,
    ): Promise<string> => {
      const baseClimax = presetAct3ClimaxV3();
      const save = presetBossEncounterV3(3, {
        campaign: {
          ...baseClimax.profile.campaign,
          endingsUnlocked: existingEndings,
        },
        factionRep:
          endingId === 'free_haven'
            ? { starport_guild: 100, deep_institute: 100, free_salvagers: 290 }
            : { starport_guild: 290, deep_institute: 150, free_salvagers: 100 },
      });
      save.settings.pureAutoCombat = true;

      await app.seedStorage({ v2Save: save, skipTitleScreen: true });
      await app.boot({ seed });

      await app.startCombat();
      await app.skipCombat();

      const endingScreen = app.byTestId(TEST_IDS.ENDING_SCREEN);
      await expect(endingScreen).toBeVisible({ timeout: 20_000 });
      await app.selectEnding(endingId);
      await expect(endingScreen).toContainText(ENDING_NAMES[endingId]);
      const epilogueText = (await endingScreen.textContent()) ?? '';

      await app.continueFromEnding();
      await app.waitForInspect(
        (s) => s.screen === 'base' && s.endingsUnlocked.includes(endingId),
        15_000,
        `${endingId} saved`,
      );
      return epilogueText;
    };

    const freeHavenText = await earnEnding('free_haven', ['stargate_reignited'], 33005);
    const fleetHeirText = await earnEnding('fleet_heir', ['stargate_reignited', 'free_haven'], 33006);

    expect(freeHavenText).not.toBe(fleetHeirText);

    const finalSnap = await app.inspect();
    expect(finalSnap.endingsUnlocked).toEqual(
      expect.arrayContaining(['stargate_reignited', 'free_haven', 'fleet_heir']),
    );
    expect(new Set(finalSnap.endingsUnlocked).size).toBe(3);

    monitor.assertClean(finalSnap);
  });
});
