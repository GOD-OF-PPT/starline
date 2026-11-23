import { expect, test } from '@playwright/test';
import {
  STORAGE_KEYS,
  TEST_IDS,
  attachZeroErrorMonitors,
  createAppDriver,
  createContractInstance,
  presetEndlessReadyV3,
  presetSettlementV3,
} from '../helpers';
import type { V3SaveData } from '../helpers';

test.describe('Tier 3 · P5: Endless Abyss Mutators × Seeded Challenge × Career & Achievements', () => {
  test('T3-P5-01 Endless Threat 1+ Mutators × Deterministic Seeded Challenge (90001) reproduces identical DAG, mutators & combat preview', async ({
    browser,
  }) => {
    const launchSeededEndless = async (): Promise<{
      mutators: string[];
      nodeTypes: Record<string, string>;
      l1PreviewText: string;
    }> => {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      const page = await ctx.newPage();
      const monitor = attachZeroErrorMonitors(page);
      const app = createAppDriver(page);

      await app.seedStorage({ v2Save: presetEndlessReadyV3(), skipTitleScreen: true });
      await app.boot({ seed: 90001, enterStation: true });
      await app.openPrepareFromBase();

      // Enable Endless Abyss Threat 1
      const endlessBtn = page
        .getByRole('button', { name: /无尽深渊|无尽模式|威压/ })
        .first();
      await expect(endlessBtn).toBeVisible();
      await endlessBtn.click();

      // Enter custom challenge seed if input is exposed (URL ?seed=90001 also feeds deterministically)
      const seedInput = page
        .locator('[data-testid="endless-seed-input"], input[name="seed"], input[placeholder*="种子"]')
        .first();
      if (await seedInput.isVisible()) {
        await seedInput.fill('90001');
      }

      await app.launchExpedition();

      const snap = await app.waitForInspect(
        (s) => s.phase === 'MAP' && (s.activeRun?.endlessThreat ?? 0) >= 1,
        15_000,
        'seeded endless run launched',
      );
      expect(snap.activeRun?.seed).toBe(90001);

      const stored = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);
      const run = stored?.activeRun;
      expect(run).not.toBeNull();
      const mutators = [...(run?.endlessMutatorIds ?? [])];
      expect(mutators.length).toBeGreaterThanOrEqual(1);

      const nodeTypes: Record<string, string> = {};
      for (const [id, node] of Object.entries(run?.graph.nodes ?? {})) {
        nodeTypes[id] = `${node.type}:${node.combat?.encounterKind ?? ''}`;
      }

      // Inspect Layer 1 combat node preview for deterministic enemy HP/damage scaling
      const l1CombatId = Object.values(run?.graph.nodes ?? {}).find(
        (n) => n.layer === 1 && (n.type === 'combat' || n.type === 'elite'),
      )?.nodeId;

      expect(l1CombatId, 'Seeded endless Layer 1 must contain a combat/elite node').toBeTruthy();
      await app.jumpToNode(l1CombatId!);
      const combatScreen = app.byTestId(TEST_IDS.COMBAT_SCREEN);
      await expect(combatScreen).toBeVisible();
      const l1PreviewText = ((await combatScreen.textContent()) ?? '').replace(/\s+/g, ' ').trim();
      expect(l1PreviewText.length).toBeGreaterThan(0);

      monitor.assertClean(await app.inspect());
      await ctx.close();
      return { mutators, nodeTypes, l1PreviewText };
    };

    const runA = await launchSeededEndless();
    const runB = await launchSeededEndless();

    expect(runA.mutators).toEqual(runB.mutators);
    expect(runA.nodeTypes).toEqual(runB.nodeTypes);
    expect(runA.l1PreviewText).toBe(runB.l1PreviewText);
  });

  test('T3-P5-02 Endless Abyss Threat 1 Clear increments maxEndlessThreat, updates career & runHistory, and unlocks Endless achievement', async ({
    page,
  }) => {
    const monitor = attachZeroErrorMonitors(page);
    const app = createAppDriver(page);

    const endlessProfile = presetEndlessReadyV3();
    const settleSave = presetSettlementV3({
      reason: 'safe_return',
      wallet: 95,
      contract: createContractInstance('bounty_std', {
        overrides: {
          status: 'active',
          completedNodeIds: ['L3A'],
          requiredCompletions: 1,
          name: '无尽深渊 · 威压 1',
        },
      }),
    });
    settleSave.profile = endlessProfile.profile;
    if (settleSave.activeRun) {
      settleSave.activeRun.sectorId = 'stargate_abyss';
      settleSave.activeRun.endlessThreat = 1;
      settleSave.activeRun.endlessMutatorIds = ['ion_surge'];
      settleSave.activeRun.currentNodeId = 'L6A';
      settleSave.activeRun.visitedNodeIds = ['L1A', 'L2A', 'L3A', 'L4A', 'L5A', 'L6A'];
    }

    await app.seedStorage({ v2Save: settleSave, skipTitleScreen: true });
    await app.boot({ seed: 35002 });

    await expect(app.byTestId(TEST_IDS.SETTLEMENT_SCREEN)).toBeVisible();
    await app.confirmSettlement();

    const baseSnap = await app.waitForInspect((s) => s.screen === 'base', 15_000, 'base after endless clear');
    const stored = await app.readStorageJson<V3SaveData>(STORAGE_KEYS.V2_SAVE);

    expect(stored?.profile.campaign.maxEndlessThreat).toBeGreaterThanOrEqual(2);
    expect(stored?.profile.career.deepestEndlessCleared).toBeGreaterThanOrEqual(1);
    expect(stored?.profile.runHistory.length).toBeGreaterThanOrEqual(1);
    expect(stored?.profile.runHistory[0]?.endlessThreat).toBe(1);
    expect(stored?.profile.achievementsUnlocked.length).toBeGreaterThan(
      endlessProfile.profile.achievementsUnlocked.length,
    );

    // Open Career modal and verify Endless history & achievement appear
    const careerModal = await app.openBaseModal(TEST_IDS.BTN_OPEN_CAREER);
    await expect(careerModal).toContainText(/威压\s*1|无尽/);

    const achTab = careerModal.getByRole('button', { name: /成就|勋章/ }).first();
    await expect(achTab).toBeVisible();
    await achTab.click();
    await expect(careerModal).toContainText(/无尽|深渊|解锁/);

    await app.closeModal();
    monitor.assertClean(baseSnap);
  });
});
