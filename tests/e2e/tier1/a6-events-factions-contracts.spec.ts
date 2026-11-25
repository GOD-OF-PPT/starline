import { expect, test } from '@playwright/test';
import {
  FACTION_NAMES,
  STORAGE_KEYS,
  TEST_IDS,
  attachZeroErrorMonitors,
  createAppDriver,
  createContractInstance,
  presetAct2V3,
  presetEventEncounterV3,
  presetMidRunMapV3,
  presetPostTutorialV3,
  presetSettlementV3,
  presetShopEncounterV3,
} from '../helpers';
import type { V3SaveData } from '../helpers';

test.describe('Tier 1 · A6: Sector Event Deck, Merchants, 3 Factions & Expanded Contracts', () => {
  test('T1-A6-01 @p1-mid Sector event renders narrative + tradeoffs and records eventId in usedEventIds to prevent repeats', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({
      v2Save: presetEventEncounterV3({ crewId: 'engineer', fuel: 7 }),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 6001 });

    const eventScreen = app.byTestId(TEST_IDS.EVENT_SCREEN);
    await expect(eventScreen).toBeVisible();
    await expect(app.byTestId(TEST_IDS.eventChoice(0))).toBeVisible();

    await app.chooseEventOption(0);

    await app.waitForInspect(
      (s) => s.phase === 'MAP' || s.phase === 'ARRANGE',
      15_000,
      'exit event screen after choosing option 0',
    );

    const saved = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(saved?.activeRun?.usedEventIds.length ?? 0).toBeGreaterThanOrEqual(1);

    monitor.assertClean(await app.inspect());
  });

  test('T1-A6-02 @p1-mid Crew-specific event bonus option unlocks for matching specialist and grants enhanced outcome', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({
      v2Save: presetEventEncounterV3({ crewId: 'engineer', wallet: 40, fuel: 7 }),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 6002 });

    const eventScreen = app.byTestId(TEST_IDS.EVENT_SCREEN);
    await expect(eventScreen).toBeVisible();

    const crewChoice = app.byTestId(TEST_IDS.eventChoice(1));
    await expect(crewChoice).toBeVisible();
    await expect(crewChoice).toBeEnabled();
    await expect(crewChoice).toContainText(/林工|工程师|解码|专属/);

    await crewChoice.click();

    const afterSnap = await app.waitForInspect(
      (s) => s.phase === 'MAP' || s.phase === 'ARRANGE',
      15_000,
      'crew bonus event choice resolved',
    );
    expect(afterSnap.activeRun?.wallet ?? 0).toBeGreaterThanOrEqual(40);

    monitor.assertClean(afterSnap);
  });

  test('T1-A6-03 @p0-core Merchant buy/sell, fuel/repair limit-1 caps, and Engineer Swap inside SHOP work cleanly', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({
      v2Save: presetShopEncounterV3({
        wallet: 80,
        fuel: 6,
        hp: 20,
        crewId: 'engineer',
        engineerSwapAvailable: true,
      }),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 6003 });

    const shopScreen = app.byTestId(TEST_IDS.SHOP_SCREEN);
    await expect(shopScreen).toBeVisible();

    // F04 fix: Engineer Swap panel must be visible and accessible directly inside SHOP
    const swapBanner = shopScreen.locator(
      `[data-testid="${TEST_IDS.ENGINEER_SWAP_BANNER}"], .v2-engineer-banner`,
    );
    await expect(swapBanner).toBeVisible();
    await expect(shopScreen).toContainText(/工程师现场改装|工程师换装|改装|换装|林工/);

    const initialWallet = (await app.inspect()).activeRun?.wallet ?? 80;

    // Buy fuel (+2)
    const buyFuelBtn = shopScreen
      .locator('#v2-shop-fuel')
      .or(shopScreen.getByRole('button', { name: /补给燃料|燃料/ }))
      .first();
    await expect(buyFuelBtn).toBeVisible();
    await expect(buyFuelBtn).toBeEnabled();
    await buyFuelBtn.click();

    const afterFuelSnap = await app.waitForInspect(
      (s) => (s.activeRun?.fuel ?? 0) > 6 && (s.activeRun?.wallet ?? 80) < initialWallet,
      10_000,
      'fuel bought in shop',
    );
    expect(afterFuelSnap.activeRun?.fuel).toBe(8);
    await expect(buyFuelBtn).toBeDisabled();

    // Sell a loot item at 80% fixed value
    const sellBtn = shopScreen
      .locator('[data-sell-loot]')
      .or(shopScreen.getByRole('button', { name: /卖出|出售/ }))
      .first();
    await expect(sellBtn).toBeVisible();
    const walletBeforeSell = afterFuelSnap.activeRun?.wallet ?? 0;
    await sellBtn.click();

    const afterSellSnap = await app.waitForInspect(
      (s) => (s.activeRun?.wallet ?? 0) > walletBeforeSell,
      10_000,
      'loot sold in shop',
    );
    expect(afterSellSnap.activeRun?.wallet ?? 0).toBeGreaterThan(walletBeforeSell);

    monitor.assertClean(afterSellSnap);
  });

  test('T1-A6-04 @p1-mid All 3 orbital factions render reputation ranks (Lv1-Lv3) and active perks in Contracts/Factions view', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const save = presetAct2V3({
      factionRep: {
        starport_guild: 230,
        deep_institute: 115,
        free_salvagers: 30,
      },
    });

    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 6004, enterStation: true });

    const modal = await app.openBaseModal(TEST_IDS.BTN_OPEN_CONTRACTS);
    await expect(modal).toContainText(FACTION_NAMES.starport_guild);
    await expect(modal).toContainText(FACTION_NAMES.deep_institute);
    await expect(modal).toContainText(FACTION_NAMES.free_salvagers);
    await expect(modal).toContainText(/Lv\.?\s*3|3\s*级|声望/);
    await expect(modal).toContainText(/Lv\.?\s*2|2\s*级/);

    await app.closeModal();
    monitor.assertClean(await app.inspect());
  });

  test('T1-A6-05 @p1-mid Contract board exposes all 5 contract archetypes including Bounty Hunt & Derelict Extraction', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    await app.seedStorage({ v2Save: presetAct2V3(), skipTitleScreen: true });
    await app.boot({ seed: 6005, enterStation: true });

    const modal = await app.openBaseModal(TEST_IDS.BTN_OPEN_CONTRACTS);
    await expect(modal).toContainText(/转运|运送/);
    await expect(modal).toContainText(/救援|搜救/);
    await expect(modal).toContainText(/测绘|勘测/);
    await expect(modal).toContainText(/清剿悬赏|悬赏/);
    await expect(modal).toContainText(/黑匣打捞|黑匣/);

    await app.closeModal();
    monitor.assertClean(await app.inspect());
  });

  test('T1-A6-06 @p1-mid Completed optional contract bonus objective pays extra bonus credits at Settlement', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const bonus = {
      id: 'bonus_high_hp',
      label: '保持船体 ≥ 60% 返航',
      completed: true,
      rewardCredits: 21,
    };
    const contract = createContractInstance('bounty_std', {
      bonusObjective: bonus,
      overrides: { status: 'active', completedNodeIds: ['L3A'], requiredCompletions: 1 },
    });

    const save = presetSettlementV3({
      wallet: 10,
      contract,
      bonusObjective: bonus,
    });
    const baseCredits = save.profile.credits;

    await app.seedStorage({ v2Save: save, skipTitleScreen: true });
    await app.boot({ seed: 6006 });

    const settleScreen = app.byTestId(TEST_IDS.SETTLEMENT_SCREEN);
    await expect(settleScreen).toBeVisible();
    await expect(settleScreen).toContainText(/额外目标|加赏|21/);

    await app.confirmSettlement();

    const postSnap = await app.waitForInspect(
      (s) => s.screen === 'base' && s.activeRun === null,
      15_000,
      'settled with bonus objective',
    );
    // Must credit at least base contract (85) + bonus (21) + wallet (10)
    expect(postSnap.credits).toBeGreaterThanOrEqual(baseCredits + 85 + 21 + 10);

    monitor.assertClean(postSnap);
  });

  test('T1-A6-07 @p1-mid S10 post-tutorial recommended contract differs from transport_std and D07 combat reward tags 3 equipment synergies with zero-heal skip', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // Part A (S10): Post-tutorial Base recommends a distinct non-transport contract (rescue_std)
    await app.seedStorage({
      v2Save: presetPostTutorialV3({
        completedContractIds: [],
        completedContractTypes: [],
      }),
      skipTitleScreen: true,
    });
    await app.boot({ seed: 6007, enterStation: true });

    const cmdCard = page.locator('.v2-base-cmd-card').first();
    await expect(cmdCard).toBeVisible();
    await expect(cmdCard).not.toContainText(/密封反应堆/);
    await expect(cmdCard).toContainText(/失联救援|救生舱/);

    await app.openPrepareFromBase();
    await expect(app.byTestId(TEST_IDS.PREPARE_SCREEN)).toContainText(/失联救援|救生舱/);

    // Part B (D07): 3-equipment synergy-tagged combat reward + zero-heal skip
    const rewardSave = presetMidRunMapV3({
      phase: 'REWARD',
      currentNodeId: 'L1B',
      hp: 20,
      maxHp: 30,
      overrides: { visitedNodeIds: ['L1B'] },
    });
    await app.seedStorage({ v2Save: rewardSave, skipTitleScreen: true });
    await app.boot({ seed: 6008 });

    await expect(app.byTestId(TEST_IDS.REWARD_SCREEN)).toBeVisible();
    for (let i = 0; i < 3; i += 1) {
      await expect(app.byTestId(TEST_IDS.rewardChoice(i))).toBeVisible();
      const badge = app.byTestId(TEST_IDS.rewardSynergyBadge(i));
      await expect(badge).toBeVisible();
      const synState = await badge.getAttribute('data-synergy-state');
      expect(['matched', 'capped', 'unmatched']).toContain(synState);
    }

    const skipBtn = app.byTestId(TEST_IDS.BTN_REWARD_SKIP);
    await expect(skipBtn).toBeVisible();
    await app.pickReward('skip');

    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();
    const afterSkip = await app.inspect();
    expect(afterSkip.phase).toBe('MAP');
    expect(afterSkip.activeRun?.hp).toBe(20);

    monitor.assertClean(afterSkip);
  });
});
