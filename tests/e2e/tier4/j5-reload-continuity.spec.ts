import { expect, test } from '@playwright/test';
import {
  STORAGE_KEYS,
  TEST_IDS,
  attachZeroErrorMonitors,
  createAppDriver,
  createMapGraph,
  presetArrangeV3,
  presetMidRunMapV3,
  presetSettlementV3,
  presetShopEncounterV3,
  presetWreckEncounterV3,
} from '../helpers';
import type { V3SaveData } from '../helpers';

test.describe('Tier 4 · J5: Mid-Voyage Save/Reload Continuity Across All 7 Phase Checkpoints', () => {
  test('T4-05 Real page.reload() at all 7 phase checkpoints preserves exact HP, fuel, wallet, phase & idempotency', async ({
    page,
  }) => {
    test.slow();
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    // =========================================================================
    // Checkpoint 1: MAP after L1 jump
    // =========================================================================
    const mapStart = presetMidRunMapV3({
      seed: 45001,
      phase: 'MAP',
      currentNodeId: 'L1A',
      fuel: 8,
      hp: 29,
      wallet: 14,
      overrides: {
        visitedNodeIds: ['L1A'],
      },
    });
    await app.seedStorage({ v2Save: mapStart, skipTitleScreen: true });
    await app.boot({ seed: 45001 });
    await expect(app.byTestId(TEST_IDS.MAP_SCREEN)).toBeVisible();

    const mapBefore = await app.inspect();
    await page.reload({ waitUntil: 'domcontentloaded' });
    const mapAfter = await app.waitForInspect((s) => s.phase === 'MAP', 15_000, 'MAP restored after reload');
    expect(mapAfter.activeRun?.layer).toBe(mapBefore.activeRun?.layer);
    expect(mapAfter.activeRun?.fuel).toBe(8);
    expect(mapAfter.activeRun?.hp).toBe(29);
    expect(mapAfter.activeRun?.wallet).toBe(14);

    // =========================================================================
    // Checkpoint 2: ENCOUNTER pre-combat
    // =========================================================================
    const preCombatSave = presetMidRunMapV3({
      seed: 45002,
      phase: 'ENCOUNTER',
      currentNodeId: 'L1B',
      fuel: 8,
      hp: 30,
      wallet: 10,
      graph: createMapGraph({
        nodeOverrides: {
          L1B: { type: 'combat', encounterKind: 'patrol', visited: true, resolved: false },
        },
      }),
      overrides: {
        visitedNodeIds: ['L1B'],
        activeCombat: null,
      },
    });
    await app.seedStorage({ v2Save: preCombatSave, skipTitleScreen: true });
    await app.boot({ seed: 45002 });
    await expect(app.byTestId(TEST_IDS.COMBAT_SCREEN)).toBeVisible();
    await expect(app.byTestId(TEST_IDS.BTN_START_COMBAT)).toBeVisible();

    await page.reload({ waitUntil: 'domcontentloaded' });
    const preCombatAfter = await app.waitForInspect(
      (s) => s.phase === 'ENCOUNTER',
      15_000,
      'pre-combat ENCOUNTER restored',
    );
    await expect(app.byTestId(TEST_IDS.BTN_START_COMBAT)).toBeVisible();
    expect(preCombatAfter.activeRun?.hp).toBe(30);
    expect(preCombatAfter.activeRun?.fuel).toBe(8);
    expect(preCombatAfter.activeRun?.wallet).toBe(10);

    // =========================================================================
    // Checkpoint 3: ENCOUNTER mid-combat tactical decision pause
    // =========================================================================
    await app.startCombat();
    const midCombatBefore = await app.waitForInspect(
      (s) => s.activeRun?.combatWaitingDecision === true,
      15_000,
      'mid-combat tactical decision pause',
    );
    const savedRound = midCombatBefore.activeRun?.combatRound;
    const savedMidHp = midCombatBefore.activeRun?.hp;

    await page.reload({ waitUntil: 'domcontentloaded' });
    const midCombatAfter = await app.waitForInspect(
      (s) => s.phase === 'ENCOUNTER' && s.activeRun?.combatWaitingDecision === true,
      15_000,
      'mid-combat tactical pause restored after reload',
    );
    await expect(app.byTestId(TEST_IDS.COMBAT_TACTICAL_BAR)).toBeVisible();
    expect(midCombatAfter.activeRun?.combatRound).toBe(savedRound);
    expect(midCombatAfter.activeRun?.hp).toBe(savedMidHp);

    // =========================================================================
    // Checkpoint 4: WRECK after 1st cut (no re-roll / cannot re-cut spot)
    // =========================================================================
    await app.seedStorage({ v2Save: presetWreckEncounterV3({ hp: 30, fuel: 8 }), skipTitleScreen: true });
    await app.boot({ seed: 45004 });
    await expect(app.byTestId(TEST_IDS.WRECK_SCREEN)).toBeVisible();

    const stabilityInitial = (await app.inspect()).activeRun?.wreckStability ?? 100;
    await app.cutWreckSpot('armory');
    const wreckAfterCut1 = await app.waitForInspect(
      (s) => (s.activeRun?.wreckStability ?? 100) < stabilityInitial,
      10_000,
      'wreck stability reduced after 1st cut',
    );
    const stabilityPostCut1 = wreckAfterCut1.activeRun?.wreckStability;

    await page.reload({ waitUntil: 'domcontentloaded' });
    const wreckAfterReload = await app.waitForInspect(
      (s) => s.phase === 'ENCOUNTER' && s.activeRun?.wreckStability !== null,
      15_000,
      'wreck restored post-reload',
    );
    expect(wreckAfterReload.activeRun?.wreckStability).toBe(stabilityPostCut1);
    await expect(app.byTestId(TEST_IDS.wreckCut('armory'))).toBeDisabled();

    // =========================================================================
    // Checkpoint 5: SHOP after buying 1 offer (same offers, offer #1 still sold, wallet unchanged)
    // =========================================================================
    await app.seedStorage({ v2Save: presetShopEncounterV3({ wallet: 80 }), skipTitleScreen: true });
    await app.boot({ seed: 45005 });
    const shopScreen = app.byTestId(TEST_IDS.SHOP_SCREEN);
    await expect(shopScreen).toBeVisible();

    const buyFirstOffer = shopScreen
      .locator('[data-buy-offer], [data-testid^="shop-buy-offer-"], [data-offer-id]')
      .or(shopScreen.getByRole('button', { name: /购买/ }))
      .first();
    await expect(buyFirstOffer).toBeVisible();
    await buyFirstOffer.click();

    const shopAfterBuy = await app.waitForInspect(
      (s) => (s.activeRun?.wallet ?? 80) < 80,
      10_000,
      'shop wallet debited after offer #1 purchase',
    );
    const walletAfterBuy = shopAfterBuy.activeRun?.wallet ?? 0;
    const shopSaveBeforeReload = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    const shopNodeIdBefore = shopSaveBeforeReload?.activeRun?.currentNodeId ?? 'L2A';
    const offersBefore =
      shopSaveBeforeReload?.activeRun?.graph.nodes[shopNodeIdBefore]?.merchant?.offers ?? [];
    const offerIdsBefore = offersBefore.map((o) => o.offerId);
    expect(offerIdsBefore.length).toBeGreaterThanOrEqual(1);

    await page.reload({ waitUntil: 'domcontentloaded' });
    const shopAfterReload = await app.waitForInspect((s) => s.phase === 'SHOP', 15_000, 'SHOP restored');
    expect(shopAfterReload.activeRun?.wallet).toBe(walletAfterBuy);

    const shopSaveAfterReload = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    const shopNodeIdAfter = shopSaveAfterReload?.activeRun?.currentNodeId ?? 'L2A';
    const offersAfter =
      shopSaveAfterReload?.activeRun?.graph.nodes[shopNodeIdAfter]?.merchant?.offers ?? [];
    const offerIdsAfter = offersAfter.map((o) => o.offerId);
    expect(offerIdsAfter).toEqual(offerIdsBefore);
    expect(offersAfter[0]?.sold).toBe(true);

    // =========================================================================
    // Checkpoint 6: ARRANGE with staging item
    // =========================================================================
    await app.seedStorage({ v2Save: presetArrangeV3(), skipTitleScreen: true });
    await app.boot({ seed: 45006 });
    await expect(app.byTestId(TEST_IDS.ARRANGE_SCREEN)).toBeVisible();

    const arrangeBeforeReload = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    const stagingIdsBefore = (arrangeBeforeReload?.activeRun?.bay.staging ?? []).map((s) => s.item.instanceId);
    expect(stagingIdsBefore.length).toBeGreaterThanOrEqual(1);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.waitForInspect((s) => s.phase === 'ARRANGE', 15_000, 'ARRANGE restored');
    await expect(app.byTestId(TEST_IDS.ARRANGE_SCREEN)).toBeVisible();

    const arrangeAfterReload = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
    const stagingIdsAfter = (arrangeAfterReload?.activeRun?.bay.staging ?? []).map((s) => s.item.instanceId);
    expect(stagingIdsAfter).toEqual(stagingIdsBefore);

    // =========================================================================
    // Checkpoint 7: SETTLEMENT before confirm (exact idempotent payout on confirm)
    // =========================================================================
    const settleSave = presetSettlementV3({ wallet: 45 });
    settleSave.profile.credits = 200;
    await app.seedStorage({ v2Save: settleSave, skipTitleScreen: true });
    await app.boot({ seed: 45007 });
    await expect(app.byTestId(TEST_IDS.SETTLEMENT_SCREEN)).toBeVisible();

    const settleTextBefore = ((await app.byTestId(TEST_IDS.SETTLEMENT_SCREEN).textContent()) ?? '').trim();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.waitForInspect((s) => s.phase === 'SETTLEMENT', 15_000, 'SETTLEMENT restored');
    const settleTextAfter = ((await app.byTestId(TEST_IDS.SETTLEMENT_SCREEN).textContent()) ?? '').trim();
    expect(settleTextAfter).toBe(settleTextBefore);

    await app.confirmSettlement();
    const finalBase = await app.waitForInspect((s) => s.screen === 'base', 15_000, 'settled to base once');
    expect(finalBase.credits).toBeGreaterThan(200);

    // Reloading on Base must NOT re-credit settlement
    const creditsAfterSettle = finalBase.credits;
    await page.reload({ waitUntil: 'domcontentloaded' });
    const baseAfterReload = await app.waitForInspect((s) => s.screen === 'base', 15_000, 'base post-reload');
    expect(baseAfterReload.credits).toBe(creditsAfterSettle);

    monitor.assertClean(baseAfterReload);
  });
});
