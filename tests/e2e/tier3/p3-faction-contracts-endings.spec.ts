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
  createMapGraph,
  presetAct3ClimaxV3,
  presetBossEncounterV3,
  presetMidRunMapV3,
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

    // Part A: Shop discount under Starport Guild Lv3 Rep (>= 220) gives 15% discount (25 -> 21¤) and enforces no-arbitrage (sell-back 8¤ < 21¤)
    const shopSave = presetShopEncounterV3({ wallet: 120 });
    shopSave.profile.factionRep.starport_guild = 240;
    if (shopSave.activeRun) {
      shopSave.activeRun.contract = createContractInstance('bounty_std', {
        bonusObjective: {
          id: 'bonus_high_hp',
          label: '返航时船体耐久 ≥ 60%',
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
    const discountBanner = shopScreen.getByTestId('shop-faction-discount');
    await expect(discountBanner).toBeVisible();
    await expect(discountBanner).toContainText(FACTION_NAMES.starport_guild);
    await expect(discountBanner).toContainText('15%');

    // Buy offer_1 (shop_offer_shield): 25¤ * 0.85 = 21¤ -> wallet 120 -> 99
    const buyOffer1Btn = shopScreen.locator('[data-buy-offer="offer_1"]');
    await expect(buyOffer1Btn).toBeVisible();
    const buyPriceMatch = ((await buyOffer1Btn.textContent()) ?? '').match(/(\d+)\s*¤/);
    expect(buyPriceMatch, 'offer_1 button must display discounted credit price').not.toBeNull();
    const discountedBuyPrice = Number(buyPriceMatch?.[1] ?? 0);
    expect(discountedBuyPrice).toBe(21);

    await buyOffer1Btn.click();
    await app.waitForInspect((s) => s.activeRun?.wallet === 99, 10_000, 'wallet debited 120 -> 99 after buying offer_1');

    // Sell back the EXACT bought item (shop_offer_shield, 8¤ < 21¤) -> wallet 99 -> 107 (< 120 net loss)
    const sellBoughtBtn = shopScreen.locator('[data-sell-loot="shop_offer_shield"]');
    await expect(sellBoughtBtn).toBeVisible();
    const sellPriceMatch = ((await sellBoughtBtn.textContent()) ?? '').match(/(\d+)\s*¤/);
    expect(sellPriceMatch, 'Sell button for shop_offer_shield must display buyback price').not.toBeNull();
    const sellBackPrice = Number(sellPriceMatch?.[1] ?? 0);
    expect(sellBackPrice).toBe(8);
    expect(sellBackPrice, 'Anti-arbitrage must hold even with Guild Lv3 discount').toBeLessThan(
      discountedBuyPrice,
    );

    await sellBoughtBtn.click();
    const afterResellSnap = await app.waitForInspect(
      (s) => s.activeRun?.wallet === 107,
      10_000,
      'wallet credited 99 -> 107 after reselling shop_offer_shield',
    );
    expect(afterResellSnap.activeRun?.wallet ?? 0).toBeLessThan(120);

    // Part B: Settlement of Bounty contract with completed +30% bonus objective, D04 depth (+2¤), and Guild Lv3 +10% (+9¤)
    const bountyContract = createContractInstance('bounty_std', {
      bonusObjective: {
        id: 'bonus_high_hp',
        label: '返航时船体耐久 ≥ 60%',
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
    await expect(settleScreen).toContainText('星港行会 Lv.3 委托加赏');
    await expect(settleScreen).toContainText('+9¤');
    await expect(settleScreen).toContainText('85');
    await expect(settleScreen).toContainText('26');
    await expect(app.byTestId(TEST_IDS.SETTLEMENT_TOTAL_CREDITS)).toHaveAttribute('data-final-credits', '202');

    await app.confirmSettlement();
    const baseSnap = await app.waitForInspect((s) => s.screen === 'base', 15_000, 'base after bounty settlement');
    // 200 base + 50 wallet + 30 items + 2 depth + 85 bounty + 26 bonus + 9 Guild Lv3 = 402¤
    expect(baseSnap.credits).toBe(402);

    const stored = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(stored?.profile.factionRep.starport_guild).toBe(270);

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

    // S09: Mission black box is auto-resolved as delivery with ZERO dismantle buttons/labels/radios
    const autoResolved = app.byTestId(TEST_IDS.SETTLEMENT_AUTO_RESOLVED);
    await expect(autoResolved).toBeVisible();
    await expect(autoResolved).toContainText('黑匣');
    await expect(autoResolved).toContainText('自动：交付委托');

    const missionRow = autoResolved.locator('.v2-settle-row').filter({ hasText: /黑匣/ }).first();
    await expect(missionRow, 'Mission black box row must be visible inside auto-resolved list').toBeVisible();
    await expect(
      missionRow.locator('button, [data-settle-disp="dismantle"], [data-testid^="btn-dismantle-"], input[value="dismantle"]'),
      'Mission black box must NOT expose any dismantle button, label, or radio control',
    ).toHaveCount(0);

    // S09 segmented radiogroup label uniquely exposes btn-dismantle-der_loot_shield with Free Salvagers Lv2 1.2x yield (ceil(8 * 1.2) = 10)
    const dismantleLabel = app.byTestId(TEST_IDS.btnDismantle('der_loot_shield'));
    await expect(dismantleLabel).toBeVisible();
    await expect(dismantleLabel).toContainText('拆解 +10 精密零件');
    await dismantleLabel.click();

    // Selling and dismantling are mutually exclusive: 30 wallet + 85 derelict = 115¤ (excludes 10¤ shield sale)
    await expect(app.byTestId(TEST_IDS.SETTLEMENT_TOTAL_CREDITS)).toHaveAttribute('data-final-credits', '115');

    await app.confirmSettlement();
    const baseSnap = await app.waitForInspect((s) => s.screen === 'base', 15_000, 'base after derelict dismantle');
    expect(baseSnap.salvageParts).toBe(20);

    const stored = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(stored?.profile.factionRep.free_salvagers).toBe(180);
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
    climaxSave.settings.combatSpeed = 2;

    await app.seedStorage({ v2Save: climaxSave, skipTitleScreen: true });
    await app.boot({ seed: 33004 });

    await app.startCombat();
    await app.skipCombat();

    const endingScreen = app.byTestId(TEST_IDS.ENDING_SCREEN);
    await expect(endingScreen).toBeVisible({ timeout: 20_000 });
    await app.selectEnding('stargate_reignited');

    await expect(endingScreen).toContainText(ENDING_NAMES.stargate_reignited);
    await expect(endingScreen).toContainText(FACTION_NAMES.deep_institute);
    await expect(endingScreen).toContainText('280');
    await expect(endingScreen).toContainText(/4\s*\/\s*4/);

    await app.continueFromEnding();
    const baseSnap = await app.waitForInspect(
      (s) => s.screen === 'base' && s.endingsUnlocked.includes('stargate_reignited'),
      15_000,
      'stargate_reignited persisted on base',
    );
    expect(baseSnap.endingsUnlocked).toContain('stargate_reignited');
    expect(baseSnap.campaignAct).toBe('endless');

    const stored = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(stored?.profile.campaign.endlessUnlocked).toBe(true);

    monitor.assertClean(baseSnap);
  });

  test('T3-P3-04 Alternate Faction Alignments × Alternate Climax Endings (free_haven & fleet_heir) coexist without overwrite', async ({
    page,
  }) => {
    test.slow();
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
      save.settings.combatSpeed = 2;

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

    expect(freeHavenText).toContain(FACTION_NAMES.free_salvagers);
    expect(freeHavenText).toContain('290');
    expect(fleetHeirText).toContain(FACTION_NAMES.starport_guild);
    expect(fleetHeirText).toContain('290');
    expect(freeHavenText).not.toBe(fleetHeirText);

    const finalSnap = await app.inspect();
    expect(finalSnap.endingsUnlocked).toEqual(
      expect.arrayContaining(['stargate_reignited', 'free_haven', 'fleet_heir']),
    );
    expect(new Set(finalSnap.endingsUnlocked).size).toBe(3);

    // Reload Base and verify all 3 unlocked endings survive persistence with zero duplicates
    await page.reload({ waitUntil: 'domcontentloaded' });
    const reloadedSnap = await app.waitForInspect(
      (s) => s.screen === 'base' && s.endingsUnlocked.length === 3,
      30_000,
      'all 3 endings survive reload',
    );
    expect(reloadedSnap.endingsUnlocked).toEqual(
      expect.arrayContaining(['stargate_reignited', 'free_haven', 'fleet_heir']),
    );
    expect(new Set(reloadedSnap.endingsUnlocked).size).toBe(3);

    monitor.assertClean(reloadedSnap);
  });

  test('T3-P3-05 D04 Recovery Beacon vs Emergency Tow × Faction Lv3 Perks × Bonus Objective Freeze × D07 2-Pick-1 Family Unlock', async ({
    page,
  }) => {
    test.slow();
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const sharedBay = () =>
      createCargoBay({
        shipId: 'cannon_skiff',
        placed: [
          {
            item: createCargoItem({
              instanceId: 'p305_loan_laser',
              definitionId: 'equipment.laser.common',
              origin: 'loan',
            }),
            x: 0,
            y: 0,
          },
          {
            item: createCargoItem({
              instanceId: 'p305_alloy',
              definitionId: 'cargo.alloy_bar',
              origin: 'loot',
              fixedValue: 20,
              acquiredDepth: 1,
            }),
            x: 1,
            y: 0,
          },
        ],
      });

    // Sub-scenario A: Beacon Free Return (L5A, isBeacon: true) + Guild Lv3 (+9¤) + live Bonus Objective freeze (+26¤) + D07 2-Pick-1 Unlock
    const bountyContract = createContractInstance('bounty_std', {
      bonusObjective: {
        id: 'bonus_high_hp',
        label: '返航时船体耐久 ≥ 60%',
        completed: false,
        rewardCredits: 26,
      },
      overrides: {
        status: 'active',
        completedNodeIds: ['L3A'],
        requiredCompletions: 1,
        rewardCredits: 85,
        factionId: 'starport_guild',
        factionRepReward: 40,
      },
    });
    const beaconSave = presetMidRunMapV3(
      {
        runId: 'run_t3_p3_05_beacon',
        phase: 'MAP',
        currentNodeId: 'L5A',
        hp: 24,
        maxHp: 30,
        fuel: 5,
        wallet: 30,
        contract: bountyContract,
        graph: createMapGraph({
          nodeOverrides: {
            L5A: { visited: true, resolved: true, isBeacon: true },
          },
        }),
        bay: sharedBay(),
        overrides: {
          visitedNodeIds: ['L1A', 'L2A', 'L3A', 'L4A', 'L5A'],
          bonusObjective: bountyContract.bonusObjective,
        },
      },
      {
        credits: 200,
        salvageParts: 10,
        totalRuns: 1,
        completedContractTypes: ['transport'],
        completedContractIds: ['transport_std'],
        unlockedFamilies: ['core', 'heavy_kit'],
        pendingFamilyUnlockChoices: [],
        factionRep: { starport_guild: 220, deep_institute: 0, free_salvagers: 0 },
        buildings: {
          workbench: true,
          contract_hub: true,
          drydock: true,
          research_lab: true,
          display: false,
          drydock_tier2: false,
        },
        facilityTiers: {
          workbench: 1,
          contract_hub: 1,
          drydock: 1,
          research_lab: 1,
          display: 0,
          drydock_tier2: 0,
          stargate_relay: 0,
        },
      },
    );

    await app.seedStorage({ v2Save: beaconSave, skipTitleScreen: true });
    await app.boot({ seed: 33007 });

    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();
    await expect(page.getByTestId('bonus-objective-tracker')).toContainText('当前满足');
    await expect(app.byTestId(TEST_IDS.BTN_SAFE_RETURN)).toHaveAttribute('data-return-mode', 'beacon_free');

    await app.safeReturn();
    const settleA = app.byTestId(TEST_IDS.SETTLEMENT_SCREEN);
    await expect(settleA).toBeVisible();

    // 30 wallet + 20 alloy + 16 D04 depth (L1->L5) + 85 bounty + 26 frozen bonus + 9 Guild Lv3 = 186¤
    await expect(settleA.locator('.v3-depth-bonus-row')).toContainText('+16¤');
    await expect(settleA.locator('.v3-tow-fee-row')).toHaveCount(0);
    await expect(settleA.locator('.v3-bonus-row.is-done')).toContainText('+26¤');
    await expect(settleA).toContainText('星港行会 Lv.3 委托加赏');
    await expect(settleA).toContainText('+9¤');
    await expect(app.byTestId(TEST_IDS.SETTLEMENT_TOTAL_CREDITS)).toHaveAttribute('data-final-credits', '186');

    // D07 2-pick-1 family unlock renders as 0-<button> radiogroup; pick counter_kit -> unlocks flak
    const familyCard = app.byTestId(TEST_IDS.SETTLEMENT_FAMILY_UNLOCK);
    await expect(familyCard).toBeVisible();
    await expect(familyCard.locator('button')).toHaveCount(0);
    await expect(app.byTestId(TEST_IDS.familyUnlockOption('hangar_kit'))).toBeVisible();
    const counterOption = app.byTestId(TEST_IDS.familyUnlockOption('counter_kit'));
    await expect(counterOption).toBeVisible();
    await counterOption.click();

    await app.confirmSettlement();
    const baseSnapA = await app.waitForInspect((s) => s.screen === 'base', 15_000, 'base after beacon settlement');
    expect(baseSnapA.credits).toBe(386);
    await expect(app.byTestId(TEST_IDS.BASE_FAMILY_UNLOCK_CARD)).toHaveCount(0);

    const savedA = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(savedA?.profile.factionRep.starport_guild).toBe(270);
    expect(savedA?.profile.unlockedFamilies).toContain('counter_kit');
    expect(savedA?.profile.unlockedFamilies).not.toContain('hangar_kit');
    expect(savedA?.profile.blueprints).toContain('flak');

    // Reload to prove D07 unlock, Guild rep, and beacon credits persist cleanly
    await page.reload({ waitUntil: 'domcontentloaded' });
    const reloadedA = await app.waitForInspect(
      (s) => s.screen === 'base' && s.credits === 386,
      30_000,
      'beacon settlement persisted across reload',
    );
    const reloadedSaveA = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(reloadedSaveA?.profile.factionRep.starport_guild).toBe(270);
    expect(reloadedSaveA?.profile.unlockedFamilies).toContain('counter_kit');
    monitor.assertClean(reloadedA);

    // Sub-scenario B: Non-Beacon Emergency Tow (L5B, isBeacon: false) + Deep Institute Lv3 Survey Parts Haircut (6 -> 3)
    const surveyContract = createContractInstance('survey_std', {
      bonusObjective: {
        id: 'bonus_high_hp',
        label: '返航时船体耐久 ≥ 60%',
        completed: false,
        rewardCredits: 21,
      },
      overrides: {
        status: 'active',
        completedNodeIds: ['L2A', 'L3A'],
        requiredCompletions: 2,
        rewardCredits: 70,
        factionId: 'deep_institute',
        factionRepReward: 35,
      },
    });
    const towSave = presetMidRunMapV3(
      {
        runId: 'run_t3_p3_05_tow',
        phase: 'MAP',
        currentNodeId: 'L5B',
        hp: 24,
        maxHp: 30,
        fuel: 5,
        wallet: 30,
        contract: surveyContract,
        graph: createMapGraph({
          nodeOverrides: {
            L5B: { visited: true, resolved: true, isBeacon: false },
          },
        }),
        bay: sharedBay(),
        overrides: {
          visitedNodeIds: ['L1A', 'L2A', 'L3A', 'L4A', 'L5B'],
          bonusObjective: surveyContract.bonusObjective,
        },
      },
      {
        credits: 200,
        salvageParts: 10,
        unlockedFamilies: ['core', 'heavy_kit', 'hangar_kit', 'counter_kit'],
        factionRep: { starport_guild: 0, deep_institute: 220, free_salvagers: 0 },
        buildings: {
          workbench: true,
          contract_hub: true,
          drydock: true,
          research_lab: true,
          display: false,
          drydock_tier2: false,
        },
        facilityTiers: {
          workbench: 1,
          contract_hub: 1,
          drydock: 1,
          research_lab: 1,
          display: 0,
          drydock_tier2: 0,
          stargate_relay: 0,
        },
      },
    );

    await app.seedStorage({ v2Save: towSave, skipTitleScreen: true });
    await app.boot({ seed: 33008 });

    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();
    await expect(app.byTestId(TEST_IDS.BTN_SAFE_RETURN)).toHaveAttribute('data-return-mode', 'emergency_tow');

    await app.safeReturn();
    const settleB = app.byTestId(TEST_IDS.SETTLEMENT_SCREEN);
    await expect(settleB).toBeVisible();

    // Emergency tow: 0 depth, 0 bonus, gross 30+20+70=120 -> floor(120*0.65)=78¤ (-42¤ tow fee), Institute 6 parts -> floor(6*0.65)=3
    await expect(settleB.locator('.v3-depth-bonus-row')).toHaveCount(0);
    await expect(settleB.locator('.v3-tow-fee-row')).toContainText('-42¤');
    await expect(settleB.locator('.v3-bonus-row.is-missed')).toContainText('+0¤');
    await expect(app.byTestId(TEST_IDS.SETTLEMENT_TOTAL_CREDITS)).toHaveAttribute('data-final-credits', '78');
    await expect(settleB).toContainText('+3 精密零件');

    await app.confirmSettlement();
    const baseSnapB = await app.waitForInspect((s) => s.screen === 'base', 15_000, 'base after emergency tow');
    expect(baseSnapB.credits).toBe(278);
    expect(baseSnapB.salvageParts).toBe(13);

    const savedB = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    expect(savedB?.profile.factionRep.deep_institute).toBe(255);

    monitor.assertClean(baseSnapB);
  });
});
