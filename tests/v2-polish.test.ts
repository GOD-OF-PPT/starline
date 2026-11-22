import { describe, expect, it } from 'vitest';
import { V2_SHIP_ORDER } from '../src/v2/data/ships';
import { createV2ShowcaseRun } from '../src/v2/data/showcaseRun';
import {
  buildTrialPrepareSlots,
  getTrialDemoUnits,
  V2_TRIAL_BUILD_ORDER,
  V2_TRIAL_BUILDS,
} from '../src/v2/data/trialBuilds';
import { calculateV2BuildStats } from '../src/v2/domain/buildStatsV2';
import {
  commitV2EliteTacticDecision,
  completeV2CombatAtCurrentNode,
  simulateV2Combat,
  startV2CombatAtCurrentNode,
} from '../src/v2/domain/combatV2';
import {
  resolveV2WreckChoice,
  selectV2MapNode,
} from '../src/v2/domain/encounter';
import { createV2CargoInstance, createV2EquipmentInstance } from '../src/v2/domain/itemCatalog';
import { launchV2Expedition, validateV2PrepareLoadout } from '../src/v2/domain/loadout';
import {
  createFreshV2Profile,
  createFreshV2SaveData,
  validateV2SaveDataDetailed,
} from '../src/v2/domain/persistenceV2';
import { deriveV2ShipVisualSpec } from '../src/v2/domain/shipVisualSpec';
import { computeV2PlacementTacticalDelta } from '../src/v2/domain/tacticalDelta';
import type { V2CargoBayState, V2RunState } from '../src/v2/domain/types';

describe('V2 Polish Phase B & D Domain Rules', () => {
  it('Trial builds are budget-legal, orthogonally linked, and launchable on all 3 ships without unlocking blueprints', () => {
    const baseProfile = {
      ...createFreshV2Profile(),
      unlockedShips: [...V2_SHIP_ORDER],
      tutorialCompleted: true,
    };

    for (const shipId of V2_SHIP_ORDER) {
      for (const trialId of V2_TRIAL_BUILD_ORDER) {
        const slots = buildTrialPrepareSlots(trialId, shipId);
        expect(slots.length).toBeGreaterThanOrEqual(2);

        // Without trialBuildId, locked heavy/hangar/counter blueprints MUST still be rejected!
        const withoutTrial = validateV2PrepareLoadout(baseProfile, shipId, 'engineer', slots, null);
        expect(withoutTrial.valid).toBe(false);

        // With trialBuildId, exact common loan kit within budget is authorized
        const withTrial = validateV2PrepareLoadout(baseProfile, shipId, 'engineer', slots, trialId);
        expect(withTrial.valid).toBe(true);
        expect(withTrial.totalBudget).toBeLessThanOrEqual(withTrial.maxBudget);

        const launched = launchV2Expedition({
          profile: baseProfile,
          contractTemplateId: 'free_salvage',
          shipId,
          crewId: 'engineer',
          primaryArchetype: V2_TRIAL_BUILDS[trialId].archetypeId,
          slots,
          trialBuildId: trialId,
          seed: 778899,
        });
        expect(launched.ok).toBe(true);
        expect(launched.run).not.toBeNull();
        expect(launched.run!.trialBuildId).toBe(trialId);

        // Every trial build must have >= 1 active synergy link right out of the box!
        const stats = calculateV2BuildStats(launched.run!.bay);
        expect(stats.links.length).toBeGreaterThanOrEqual(1);
        for (const placed of launched.run!.bay.placed) {
          expect(placed.item.origin).toBe('loan');
          expect(placed.item.fixedValue).toBe(0);
          expect(placed.item.quality).toBe('common');
        }

        // Demo units must simulate cleanly
        const demoSim = simulateV2Combat({
          resultId: `demo_${shipId}_${trialId}`,
          bay: launched.run!.bay,
          startingHp: launched.run!.maxHp,
          maxHp: launched.run!.maxHp,
          units: getTrialDemoUnits(trialId),
          targetPolicy: 'weakest',
        });
        expect(demoSim.roundsCount).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('Trial builds strictly reject improved loans or unauthorized locked equipment mixing', () => {
    const profile = createFreshV2Profile();
    const badImproved = [
      {
        slotKey: 'bad_1',
        origin: 'loan' as const,
        definitionId: 'equipment.heavy.improved',
        x: 0,
        y: 0,
        rotation: 0 as const,
      },
    ];
    expect(
      validateV2PrepareLoadout(profile, 'cannon_skiff', 'engineer', badImproved, 'trial_heavy').valid
    ).toBe(false);

    const badCrossMix = [
      {
        slotKey: 'bad_2',
        origin: 'loan' as const,
        definitionId: 'equipment.hangar.common',
        x: 0,
        y: 0,
        rotation: 0 as const,
      },
    ];
    expect(
      validateV2PrepareLoadout(profile, 'cannon_skiff', 'engineer', badCrossMix, 'trial_heavy').valid
    ).toBe(false);
  });

  it('3-room Wreck salvage supports Reactor Fuel (+2) and Reactor Repair (+8) with zero-gain guard and idempotency', () => {
    let run = createV2ShowcaseRun('trial_heavy', 'wreck_test');
    // Jump to L1B (wreck) -> fuel becomes 8/10
    const enter = selectV2MapNode(run, 'L1B');
    expect(enter.ok).toBe(true);
    run = { ...enter.run, hp: 20 };

    // Reactor fuel grants +2 fuel (8 -> 10)
    const fuelRes = resolveV2WreckChoice(run, 'reactor_fuel', ['core']);
    expect(fuelRes.ok).toBe(true);
    expect(fuelRes.run.fuel).toBe(10);
    expect(fuelRes.run.phase).toBe('ARRANGE');
    expect(fuelRes.run.graph.nodes['L1B'].wreck?.chosenRoom).toBe('reactor_fuel');

    // Re-claiming same wreck is rejected (idempotent)
    const dupRes = resolveV2WreckChoice(
      { ...fuelRes.run, phase: 'ENCOUNTER' },
      'armory',
      ['core']
    );
    expect(dupRes.ok).toBe(false);

    // Zero-gain guard: at full fuel (10/10), reactor_fuel must refuse rather than waste room
    const fullFuelRun: V2RunState = { ...run, fuel: run.maxFuel };
    const refusedFuel = resolveV2WreckChoice(fullFuelRun, 'reactor_fuel', ['core']);
    expect(refusedFuel.ok).toBe(false);

    // Reactor repair grants +8 HP (20 -> 28)
    const repairRes = resolveV2WreckChoice(run, 'reactor_repair', ['core']);
    expect(repairRes.ok).toBe(true);
    expect(repairRes.run.hp).toBe(28);
    expect(repairRes.run.graph.nodes['L1B'].wreck?.chosenRoom).toBe('reactor_repair');
  });

  it('deriveV2ShipVisualSpec maps placed cargo bay equipment & mission cargo accurately without guessing', () => {
    const bay: V2CargoBayState = {
      shipId: 'cannon_skiff',
      placed: [
        {
          item: createV2EquipmentInstance({
            instanceId: 'h1',
            kind: 'heavy',
            quality: 'common',
            origin: 'loan',
            acquiredDepth: 0,
            location: 'bay',
          }),
          x: 0,
          y: 0,
          rotation: 0,
        },
        {
          item: createV2EquipmentInstance({
            instanceId: 'c1',
            kind: 'capacitor',
            quality: 'common',
            origin: 'loan',
            acquiredDepth: 0,
            location: 'bay',
          }),
          x: 1,
          y: 0,
          rotation: 0,
        },
        {
          item: createV2CargoInstance({
            instanceId: 'm1',
            defId: 'mission.sealed_reactor',
            origin: 'mission',
            acquiredDepth: 3,
            location: 'bay',
            missionBinding: 'c_1',
          }),
          x: 2,
          y: 0,
          rotation: 0,
        },
      ],
      staging: [],
      discardedThisArrange: [],
    };

    const spec = deriveV2ShipVisualSpec(bay);
    expect(spec.heavyCount).toBe(1);
    expect(spec.heavyBoosted).toBe(true);
    expect(spec.hasSealedReactor).toBe(true);
    expect(spec.cargoMassTier).toBe(2);
    expect(spec.mountSummaryTags.some((t) => t.includes('磁轨重炮'))).toBe(true);
    expect(spec.mountSummaryTags.some((t) => t.includes('密封反应堆'))).toBe(true);
  });

  it('computeV2PlacementTacticalDelta reports concrete simulated round/HP delta and recommended synergy slot', () => {
    const baseBay: V2CargoBayState = {
      shipId: 'cannon_skiff',
      placed: [
        {
          item: createV2EquipmentInstance({
            instanceId: 'h1',
            kind: 'heavy',
            quality: 'common',
            origin: 'loan',
            acquiredDepth: 0,
            location: 'bay',
          }),
          x: 0,
          y: 0,
          rotation: 0,
        },
      ],
      staging: [],
      discardedThisArrange: [],
    };
    const cap = createV2EquipmentInstance({
      instanceId: 'cap_stage',
      kind: 'capacitor',
      quality: 'common',
      origin: 'loot',
      acquiredDepth: 1,
      location: 'staging',
    });

    const delta = computeV2PlacementTacticalDelta({
      run: null,
      bay: baseBay,
      startingHp: 30,
      maxHp: 30,
      targetPolicy: 'weakest',
      item: cap,
      zone: 'staging',
    });

    expect(delta.recommendedSpot).toBeDefined();
    expect(delta.synergyLine).toContain('先手');
    expect(delta.combatDeltaLine).toMatch(/少打|少损|由败转胜/);
    expect(delta.positiveImpact).toBe(true);
  });

  it('4-layer Showcase run validates cleanly and spans all 4 layers without corrupting save validation', () => {
    for (const trialId of V2_TRIAL_BUILD_ORDER) {
      const run = createV2ShowcaseRun(trialId, `sc_${trialId}`);
      expect(run.isShowcase).toBe(true);
      expect(run.graph.maxLayers).toBe(4);
      expect(Object.keys(run.graph.nodes).length).toBe(8);
      const save = { ...createFreshV2SaveData(), activeRun: run };
      expect(validateV2SaveDataDetailed(save).ok).toBe(true);
    }
  });

  it('Phase D Elite Round-2 tactical decision triggers cleanly, enforces shield cost, blocks premature completion, and is idempotent', () => {
    // Build a showcase run with trial_counter (12 starting shield!) and teleport cleanly into Elite L4A
    const baseRun = createV2ShowcaseRun('trial_counter', 'elite_tactic_test');
    const atElite: V2RunState = {
      ...baseRun,
      currentNodeId: 'L4A',
      visitedNodeIds: ['L1A', 'L2A', 'L3A', 'L4A'],
      phase: 'ENCOUNTER',
    };

    const started = startV2CombatAtCurrentNode(atElite, 'weakest', { enableEliteTactic: true });
    expect(started.ok).toBe(true);
    const pending = started.run.activeCombat?.pendingDecision;
    expect(pending).not.toBeNull();
    expect(pending!.roundNumber).toBe(2);
    expect(pending!.chosen).toBeNull();
    expect(pending!.options.length).toBe(3);

    // Starting shield 12, Elite R1 enemy total dmg = 4 + 1 + 1 = 6 -> R1 end shield = 6 >= 4, so Overload MUST be enabled!
    expect(pending!.playerShieldAtPause).toBe(6);
    const overloadOpt = pending!.options.find((o) => o.choice === 'overload')!;
    expect(overloadOpt.enabled).toBe(true);

    // Completing combat BEFORE deciding MUST be rejected!
    const premature = completeV2CombatAtCurrentNode(started.run, ['core']);
    expect(premature.ok).toBe(false);

    // Emergency Defense test: +8 shield (6 -> 14), halts equipment weapons in R2, preserves core attack & counter!
    const defSim = simulateV2Combat({
      resultId: 'chk_def',
      bay: atElite.bay,
      startingHp: atElite.hp,
      maxHp: atElite.maxHp,
      units: atElite.graph.nodes['L4A'].combat!.units,
      targetPolicy: 'weakest',
      round2Tactic: 'emergency_defense',
    });
    const r2Def = defSim.rounds[1];
    expect(r2Def).toBeDefined();
    expect(r2Def.playerAttacks.every((a) => a.sourceKind === 'core')).toBe(true);
    expect(r2Def.counterAttack).not.toBeNull(); // Counter retained!
    expect(r2Def.playerShieldAfter).toBeGreaterThan(pending!.playerShieldAtPause - 6);

    // Commit Overload decision
    const committed = commitV2EliteTacticDecision(started.run, pending!.decisionId, 'overload');
    expect(committed.ok).toBe(true);
    expect(committed.run.activeCombat!.pendingDecision!.chosen).toBe('overload');
    expect(committed.run.activeCombat!.simulation.appliedTactic).toBe('overload');
    expect(
      committed.run.activeCombat!.simulation.rounds[1].playerAttacks.some(
        (a) => a.sourceInstanceId === 'tactic_overload'
      )
    ).toBe(true);

    // Save validation passes with pendingDecision committed
    const saveCheck = validateV2SaveDataDetailed({
      ...createFreshV2SaveData(),
      activeRun: committed.run,
    });
    expect(saveCheck.ok).toBe(true);

    // Duplicate commit MUST be rejected (idempotency on refresh/double-click!)
    const dupCommit = commitV2EliteTacticDecision(
      committed.run,
      pending!.decisionId,
      'emergency_defense'
    );
    expect(dupCommit.ok).toBe(false);

    // Now completing combat succeeds cleanly!
    const finished = completeV2CombatAtCurrentNode(committed.run, ['core']);
    expect(finished.ok).toBe(true);

    // Also verify Overload is disabled when Round-1 remaining shield < 4
    const noShieldBay: V2CargoBayState = {
      shipId: 'cannon_skiff',
      placed: [
        {
          item: createV2EquipmentInstance({
            instanceId: 'l1',
            kind: 'laser',
            quality: 'common',
            origin: 'loan',
            acquiredDepth: 0,
            location: 'bay',
          }),
          x: 0,
          y: 0,
          rotation: 0,
        },
      ],
      staging: [],
      discardedThisArrange: [],
    };
    const lowShieldStart = startV2CombatAtCurrentNode(
      { ...atElite, bay: noShieldBay },
      'weakest',
      { enableEliteTactic: true }
    );
    const lowOverload = lowShieldStart.run.activeCombat?.pendingDecision?.options.find(
      (o) => o.choice === 'overload'
    );
    expect(lowOverload?.enabled).toBe(false);
  });
});
