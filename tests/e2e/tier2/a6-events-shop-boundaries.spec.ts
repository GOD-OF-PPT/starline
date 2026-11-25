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
  presetAct1V3,
  presetEventEncounterV3,
  presetSettlementV3,
  presetShopEncounterV3,
} from '../helpers';
import type { V3SaveData } from '../helpers';

test.describe('Tier 2 · A6: Events, Shop, Factions & Contracts Negative Cases', () => {
  test('T2-A6-01 @p1-mid Unaffordable event options disable cleanly while safe fallback prevents run softlock', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Zero fuel, low HP (3), zero wallet, and non-engineer crew so ALL non-fallback options are unaffordable
    const unaffordableEvent = presetEventEncounterV3({
      crewId: 'salvager',
      fuel: 0,
      hp: 3,
      wallet: 0,
    });
    if (unaffordableEvent.activeRun?.activeEvent) {
      unaffordableEvent.activeRun.activeEvent.options = [
        {
          index: 0,
          label: '强行撬开外壳（消耗 1 燃料）',
          costSummary: '-1 燃料',
          rewardSummary: '+18¤',
          fuelCost: 1,
        },
        {
          index: 1,
          label: '付费黑市解码（消耗 25¤）',
          costSummary: '-25¤',
          rewardSummary: '稀有模块',
          walletCost: 25,
        },
        {
          index: 2,
          label: '记录坐标后安全撤离',
          costSummary: '无消耗',
          rewardSummary: '安全离开',
          isFallback: true,
        },
      ];
    }

    await app.seedStorage({
      v2Save: unaffordableEvent,
      skipTitleScreen: true,
    });
    await app.boot({ seed: 26001 });

    const eventScreen = app.byTestId(TEST_IDS.EVENT_SCREEN);
    await expect(eventScreen).toBeVisible();

    const opt0 = app.byTestId(TEST_IDS.eventChoice(0));
    const opt1 = app.byTestId(TEST_IDS.eventChoice(1));
    const optFallback = app.byTestId(TEST_IDS.eventChoice(2));

    await expect(opt0).toBeDisabled();
    await expect(opt1).toBeDisabled();
    await expect(optFallback).toBeVisible();
    await expect(optFallback).toBeEnabled();

    await app.chooseEventOption(2);

    const afterExit = await app.waitForInspect(
      (s) => s.phase === 'MAP' && s.activeRun !== null,
      15_000,
      'clean fallback exit from unaffordable event',
    );
    expect(afterExit.activeRun?.fuel).toBe(0);
    expect(afterExit.activeRun?.hp).toBe(3);
    expect(afterExit.activeRun?.wallet).toBe(0);

    monitor.assertClean(afterExit);
  });

  test('T2-A6-02 @p0-core Merchant enforces anti-arbitrage pricing and rejects selling owned, loan, and mission items', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const shopSave = presetShopEncounterV3({ wallet: 80 });
    if (shopSave.activeRun) {
      shopSave.activeRun.bay = createCargoBay({
        shipId: 'cannon_skiff',
        placed: [
          {
            item: createCargoItem({
              instanceId: 'shop_no_sell_loan',
              definitionId: 'equipment.laser.common',
              origin: 'loan',
            }),
            x: 0,
            y: 0,
          },
          {
            item: createCargoItem({
              instanceId: 'shop_no_sell_owned',
              definitionId: 'equipment.shield.common',
              origin: 'owned',
              fixedValue: 10,
            }),
            x: 1,
            y: 0,
          },
          {
            item: createCargoItem({
              instanceId: 'shop_no_sell_mission',
              definitionId: 'mission.sealed_reactor',
              origin: 'mission',
            }),
            x: 0,
            y: 2,
            rotation: 1,
          },
          {
            item: createCargoItem({
              instanceId: 'shop_sellable_loot',
              definitionId: 'cargo.alloy_bar',
              origin: 'loot',
              fixedValue: 15,
              acquiredDepth: 1,
            }),
            x: 2,
            y: 0,
          },
        ],
      });
      shopSave.activeRun.activeEngineerOffer = null;
    }

    await app.seedStorage({
      v2Save: shopSave,
      skipTitleScreen: true,
    });
    await app.boot({ seed: 26002 });

    const shopScreen = app.byTestId(TEST_IDS.SHOP_SCREEN);
    await expect(shopScreen).toBeVisible();

    // Buy offer_1 (equipment.shield.common, recycle=10, buy price=25)
    const buyOffer1 = shopScreen
      .locator('[data-buy-offer="offer_1"], [data-offer-id="offer_1"] button, [data-testid="shop-buy-offer_1"]')
      .or(shopScreen.getByRole('button', { name: /购买.*25|25\s*¤/ }))
      .first();
    await expect(buyOffer1).toBeVisible();
    await buyOffer1.click();

    await app.waitForInspect(
      (s) => s.activeRun?.wallet === 55,
      15_000,
      'wallet debited 25 for offer_1',
    );

    // Bought offer item (origin: 'loot', fixedValue: 10) must appear in sell list and pay strictly < buy price 25
    const sellBoughtBtn = shopScreen
      .locator('[data-sell-loot="shop_offer_shield"], [data-testid="shop-sell-shop_offer_shield"]')
      .or(
        shopScreen
          .locator('.v2-shop-sell-row')
          .filter({ hasText: /护盾/ })
          .getByRole('button', { name: /卖出|出售/ }),
      )
      .first();
    await expect(sellBoughtBtn).toBeVisible();
    await expect(sellBoughtBtn).toBeEnabled();

    // Pre-existing loot cargo (shop_sellable_loot) must ALSO be visible & sellable
    const sellLootBtn = shopScreen
      .locator('[data-sell-loot="shop_sellable_loot"], [data-testid="shop-sell-shop_sellable_loot"]')
      .or(
        shopScreen
          .locator('.v2-shop-sell-row')
          .filter({ hasText: /合金/ })
          .getByRole('button', { name: /卖出|出售/ }),
      )
      .first();
    await expect(sellLootBtn).toBeVisible();
    await expect(sellLootBtn).toBeEnabled();

    // Exactly 2 enabled sell buttons exist (shop_offer_shield + shop_sellable_loot); loan/owned/mission are strictly excluded
    const allEnabledSellBtns = shopScreen
      .locator('[data-sell-loot]:not([disabled]), [data-testid^="shop-sell-"]:not([disabled])')
      .or(shopScreen.locator('.v2-shop-sell-row button:not([disabled])'));
    await expect(allEnabledSellBtns).toHaveCount(2);

    // Sell back bought item -> wallet must rise from 55 to 63 (strictly < starting 80, proving zero arbitrage)
    await sellBoughtBtn.click();
    const afterSellSnap = await app.waitForInspect(
      (s) => (s.activeRun?.wallet ?? 0) > 55,
      10_000,
      'bought item sold back at anti-arbitrage discount',
    );
    expect(afterSellSnap.activeRun?.wallet).toBe(63); // 55 + floor(10 * 0.8) = 63 < 80
    expect(afterSellSnap.activeRun?.wallet ?? 80).toBeLessThan(80);

    // After selling bought item, ONLY shop_sellable_loot remains sellable (count === 1), zero forbidden items sellable
    await expect(allEnabledSellBtns).toHaveCount(1);
    for (const forbiddenId of [
      'shop_no_sell_loan',
      'shop_no_sell_owned',
      'shop_no_sell_mission',
    ]) {
      await expect(
        shopScreen.locator(
          `[data-sell-loot="${forbiddenId}"]:not([disabled]), [data-testid="shop-sell-${forbiddenId}"]:not([disabled])`,
        ),
      ).toHaveCount(0);
    }

    monitor.assertClean(await app.inspect());
  });

  test('T2-A6-03 @p0-core Merchant disables fuel/repair at cap and persists limit-1 sold-out cap across reload', async ({
    page,
  }) => {
    test.slow();
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Part 1: Full fuel (10/10) and full HP (30/30) -> both zero-benefit services must be disabled
    await app.seedStorage({
      v2Save: presetShopEncounterV3({ wallet: 80, fuel: 10, hp: 30 }),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 26003 });

    const shopScreen = app.byTestId(TEST_IDS.SHOP_SCREEN);
    await expect(shopScreen).toBeVisible();

    const fuelBtnFull = shopScreen
      .locator('#v2-shop-fuel, [data-testid="shop-buy-fuel"]')
      .or(shopScreen.locator('button').filter({ hasText: /补给燃料|燃料|加注/ }))
      .first();
    const repairBtnFull = shopScreen
      .locator('#v2-shop-repair, [data-testid="shop-buy-repair"]')
      .or(shopScreen.locator('button').filter({ hasText: /维修|修复船体/ }))
      .first();
    await expect(fuelBtnFull).toBeDisabled();
    await expect(repairBtnFull).toBeDisabled();

    // Part 2: Damaged ship buys repair once -> switches to sold-out and stays sold-out across reload
    await app.seedStorage({
      v2Save: presetShopEncounterV3({ wallet: 80, fuel: 6, hp: 18 }),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 26004 });

    const repairBtn = app
      .byTestId(TEST_IDS.SHOP_SCREEN)
      .locator('#v2-shop-repair, [data-testid="shop-buy-repair"]')
      .or(
        app
          .byTestId(TEST_IDS.SHOP_SCREEN)
          .locator('button')
          .filter({ hasText: /维修|修复船体/ }),
      )
      .first();
    await expect(repairBtn).toBeEnabled();
    await repairBtn.click();

    await app.waitForInspect(
      (s) => (s.activeRun?.hp ?? 0) > 18 && (s.activeRun?.wallet ?? 80) < 80,
      15_000,
      'repair purchased once',
    );
    await expect(repairBtn).toBeDisabled();

    const saveAfterBuy = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(saveAfterBuy?.activeRun?.transactionIds.length).toBeGreaterThan(0);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.waitForInspect((s) => s.phase === 'SHOP', 30_000, 'shop restored after reload');
    await expect(app.byTestId(TEST_IDS.SHOP_SCREEN)).toBeVisible();
    await expect(repairBtn).toBeDisabled();

    monitor.assertClean(await app.inspect());
  });

  test('T2-A6-04 @p0-core Shop reload idempotency preserves exact offers, prices, sold status, and wallet', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({
      v2Save: presetShopEncounterV3({ wallet: 80 }),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 26005 });

    const shopScreen = app.byTestId(TEST_IDS.SHOP_SCREEN);
    await expect(shopScreen).toBeVisible();

    const saveBeforeBuy = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    const merchantNodeId = saveBeforeBuy?.activeRun?.currentNodeId ?? 'L2A';
    const initialOffers = saveBeforeBuy?.activeRun?.graph.nodes[merchantNodeId]?.merchant?.offers.map(
      (o) => ({
        offerId: o.offerId,
        defId: o.item.definitionId,
        buyPrice: o.buyPrice,
      }),
    );
    expect(initialOffers?.length).toBeGreaterThanOrEqual(2);

    const buyOffer1 = shopScreen
      .locator('[data-buy-offer="offer_1"], [data-offer-id="offer_1"] button, [data-testid="shop-buy-offer_1"]')
      .or(shopScreen.getByRole('button', { name: /购买.*25|25\s*¤/ }))
      .first();
    await buyOffer1.click();

    await app.waitForInspect((s) => s.activeRun?.wallet === 55, 15_000, 'offer_1 purchased');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.waitForInspect((s) => s.phase === 'SHOP', 30_000, 'shop restored after reload');
    await expect(app.byTestId(TEST_IDS.SHOP_SCREEN)).toBeVisible();

    const snapAfterReload = await app.inspect();
    expect(snapAfterReload.activeRun?.wallet).toBe(55);

    const saveAfterReload = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    const reloadedMerchant = saveAfterReload?.activeRun?.graph.nodes[merchantNodeId]?.merchant;
    const reloadedOffers = reloadedMerchant?.offers.map((o) => ({
      offerId: o.offerId,
      defId: o.item.definitionId,
      buyPrice: o.buyPrice,
    }));
    expect(reloadedOffers).toEqual(initialOffers);
    expect(reloadedMerchant?.offers[0]?.sold).toBe(true);

    monitor.assertClean(snapAfterReload);
  });

  test('T2-A6-05 @p1-mid Failed optional bonus objective pays main contract reward only and excludes bonus credits', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const loanOnlyBay = createCargoBay({
      shipId: 'cannon_skiff',
      placed: [
        {
          item: createCargoItem({
            instanceId: 'bonus_fail_loan_laser',
            definitionId: 'equipment.laser.common',
            origin: 'loan',
          }),
          x: 0,
          y: 0,
        },
      ],
    });

    const failedBonus = {
      id: 'bonus_no_discard',
      label: '全程不丢弃任何物资',
      completed: false,
      rewardCredits: 26,
    };

    const settleSave = presetSettlementV3({
      reason: 'safe_return',
      wallet: 20,
      bay: loanOnlyBay,
      contract: createContractInstance('bounty_std', {
        bonusObjective: failedBonus,
        overrides: {
          status: 'active',
          completedNodeIds: ['L3A'],
          requiredCompletions: 1,
          rewardCredits: 85,
        },
      }),
      bonusObjective: failedBonus,
    });
    settleSave.profile.credits = 260;

    await app.seedStorage({
      v2Save: settleSave,
      skipTitleScreen: true,
    });
    await app.boot({ seed: 26006 });

    const settlementScreen = app.byTestId(TEST_IDS.SETTLEMENT_SCREEN);
    await expect(settlementScreen).toBeVisible();
    await expect(settlementScreen).toContainText(/85/);
    await expect(settlementScreen).toContainText(/未达成|失败|额外目标/);

    await app.confirmSettlement();

    const baseSnap = await app.waitForInspect(
      (s) => s.screen === 'base' && s.activeRun === null,
      15_000,
      'settled with base contract only',
    );
    // Must equal 260 + 85 (main contract) + 20 (wallet) = 365, strictly excluding the missed +26 bonus
    expect(baseSnap.credits).toBe(365);

    monitor.assertClean(baseSnap);
  });

  test('T2-A6-06 @p1-mid D07 zero-heal reward skip preserves guaranteed collectible relic while dropping equipment and D06 crates, and lethal event hpCost disables option cleanly', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Part A: D07 REWARD with hp: 18/30 + bonusLootItems [ancient_navigator (collectible relic), data_box (D06 crate)]
    const rewEq0 = createCargoItem({
      instanceId: 'skip_rew_eq_0',
      definitionId: 'equipment.laser.common',
      origin: 'loot',
      acquiredDepth: 3,
      location: 'staging',
    });
    const rewEq1 = createCargoItem({
      instanceId: 'skip_rew_eq_1',
      definitionId: 'equipment.battery.common',
      origin: 'loot',
      acquiredDepth: 3,
      location: 'staging',
    });
    const rewEq2 = createCargoItem({
      instanceId: 'skip_rew_eq_2',
      definitionId: 'equipment.shield.common',
      origin: 'loot',
      acquiredDepth: 3,
      location: 'staging',
    });
    const rewRelic = createCargoItem({
      instanceId: 'skip_rew_relic_nav',
      definitionId: 'cargo.ancient_navigator',
      origin: 'loot',
      fixedValue: 48,
      acquiredDepth: 3,
      location: 'staging',
    });
    const rewCrate = createCargoItem({
      instanceId: 'skip_rew_d06_crate',
      definitionId: 'cargo.data_box',
      origin: 'loot',
      fixedValue: 7,
      acquiredDepth: 3,
      location: 'staging',
    });

    const rewardRun = createV3RunFixture({
      phase: 'REWARD',
      currentNodeId: 'L3A',
      hp: 18,
      maxHp: 30,
      contract: createContractInstance('free_salvage'),
      graph: createMapGraph({
        nodeOverrides: {
          L3A: { type: 'combat', encounterKind: 'patrol', visited: true, resolved: false },
        },
      }),
      overrides: {
        visitedNodeIds: ['L1A', 'L2A', 'L3A'],
        pendingReward: {
          nodeId: 'L3A',
          equipmentOptions: [rewEq0, rewEq1, rewEq2],
          bonusLootItems: [rewRelic, rewCrate],
          equipmentOption: rewEq0,
          cargoOption: rewCrate,
          repairAmount: 0,
          chosen: null,
        },
      },
    });

    await app.seedStorage({
      v2Save: { ...presetAct1V3(), activeRun: rewardRun },
      skipTitleScreen: true,
    });
    await app.boot({ seed: 26007 });

    await expect(app.byTestId(TEST_IDS.REWARD_SCREEN)).toBeVisible();
    await expect(app.byTestId(TEST_IDS.REWARD_RELIC_BONUS)).toBeVisible();

    await app.pickReward('skip');

    // Guaranteed collectible relic forces ARRANGE with strictly 0 HP healed and 0 equipment / 0 D06 crates
    const arrangeSnap = await app.waitForInspect(
      (s) => s.phase === 'ARRANGE' && s.activeRun !== null,
      15_000,
      'zero-heal skip staged guaranteed relic into ARRANGE',
    );
    expect(arrangeSnap.activeRun?.hp).toBe(18);

    const savedAfterSkip = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    const stagedIds = savedAfterSkip?.activeRun?.bay.staging.map((s) => s.item.instanceId) ?? [];
    expect(stagedIds).toEqual(['skip_rew_relic_nav']);

    // Part B: Lethal event hpCost guard (hp: 4 vs option hpCost: 4 -> disabled; safe fallback resolves cleanly)
    const lethalEvent = presetEventEncounterV3({
      crewId: 'salvager',
      hp: 4,
      fuel: 5,
      wallet: 50,
    });
    if (lethalEvent.activeRun?.activeEvent) {
      lethalEvent.activeRun.activeEvent.options = [
        {
          index: 0,
          label: '强行顶盾突破残骸风暴（消耗 4 耐久）',
          costSummary: '-4 船体耐久',
          rewardSummary: '高价货物箱',
          hpCost: 4,
        },
        {
          index: 1,
          label: '绕道安全撤离',
          costSummary: '无消耗',
          rewardSummary: '安全离开',
          isFallback: true,
        },
      ];
    }

    await app.seedStorage({ v2Save: lethalEvent, skipTitleScreen: true });
    await app.boot({ seed: 26008 });

    await expect(app.byTestId(TEST_IDS.EVENT_SCREEN)).toBeVisible();
    await expect(app.byTestId(TEST_IDS.eventChoice(0))).toBeDisabled();
    await expect(app.byTestId(TEST_IDS.eventChoice(1))).toBeEnabled();

    await app.chooseEventOption(1);
    const mapAfterEvent = await app.waitForInspect(
      (s) => s.phase === 'MAP' && s.activeRun !== null,
      15_000,
      'safe fallback exited lethal-hpCost event cleanly',
    );
    expect(mapAfterEvent.activeRun?.hp).toBe(4);

    monitor.assertClean(mapAfterEvent);
  });
});
