import { describe, expect, it } from 'vitest';
import { buildEncounterUnits } from '../src/v2/data/enemies';
import { V2_EQUIPMENT_DEFS, type V2ArchetypeId } from '../src/v2/data/equipment';
import type { V2ShipId } from '../src/v2/data/ships';
import { evaluateV2RewardSynergies } from '../src/v2/domain/buildStatsV2';
import {
  completeV2CombatAtCurrentNode,
  previewV2CombatNode,
  simulateV2Combat,
  startV2CombatAtCurrentNode,
} from '../src/v2/domain/combatV2';
import {
  canPerformSurveyAtCurrentNode,
  computeV2JumpFuelCost,
  isContractReadyForDelivery,
  performSurveyAtCurrentNode,
} from '../src/v2/domain/contracts';
import {
  abandonV2EventAndReturn,
  buyV2MerchantFuel,
  buyV2MerchantRepair,
  cutV2WreckHotspot,
  evaluateV2EventOption,
  extractV2Wreck,
  finishV2ArrangeAndProceed,
  finishV2MerchantVisit,
  getReachableNextNodeIds,
  getV2SafeReturnStatus,
  initiateV2EmergencyTowReturn,
  initiateV2SafeReturnFromMap,
  pickV2CombatReward,
  resolveV2EventOption,
  selectV2MapNode,
} from '../src/v2/domain/encounter';
import { shouldAutoSkipArrange } from '../src/v2/domain/events';
import {
  createEmptyV2Bay,
  discardV2Item,
  findFirstLegalV2Placement,
  placeV2FromStaging,
} from '../src/v2/domain/inventoryV2';
import { createV2EquipmentInstance } from '../src/v2/domain/itemCatalog';
import {
  buildFreeFallbackPrepareSlots,
  launchV2Expedition,
  type V2PrepareSlotEntry,
} from '../src/v2/domain/loadout';
import { createFreshV2Profile } from '../src/v2/domain/persistenceV2';
import { applyV2Settlement, calculateV2Settlement } from '../src/v2/domain/settlementV2';
import type { SectorId, V2ProfileState, V2RewardChoiceId, V2RunState } from '../src/v2/domain/types';

/**
 * §18 + R2-M6B D08 Full V3.1 Balance Simulation Matrix:
 * - Covers ALL 4 ships (cannon_skiff / shield_cruiser / heavy_freighter / stargate_cruiser)
 * - Covers ALL 5 archetypes (laser / heavy / hangar / counter / salvo)
 * - Covers ALL 5 standard contracts + deep contracts (transport / rescue / survey / bounty / derelict)
 * - Covers ALL 3 sectors (near_orbit / frozen_graveyard / stargate_abyss)
 * - Uses genuine V3.1 gameplay loops: multi-cut wrecks (`cutV2WreckHotspot` + `extractV2Wreck`),
 *   V3 crew-reactive events (`resolveV2EventOption`), D07 3-equipment synergy-tagged rewards
 *   (`equipment_0..2` / `skip`), and D04 Beacon-only free return vs Emergency Tow (-35%).
 */

type ExtendedSimArchetype = V2ArchetypeId | 'salvo';

interface SimPolicy {
  readonly name: string;
  readonly shipId: V2ShipId;
  readonly archetype: ExtendedSimArchetype;
  readonly contractId: string;
  readonly pushToLayer6: boolean;
  readonly allowImproved: boolean;
  readonly sectorId?: SectorId;
  readonly greedyWreckCuts?: boolean;
  readonly forceEarlyTow?: boolean;
  /** Optional free Beacon exit layer (e.g. 3 for Early Beacon Cash-Out, 5 for Balanced L5) */
  readonly earlyBeaconExitLayer?: number;
  /** Disable omniscient exact-defeat combat preview dodging (models realistic player risk) */
  readonly realisticNoDodge?: boolean;
  /** Optional explicit starting slots override (e.g. minimal 5-cell wired loadout or 0¤ fallback) */
  readonly customSlots?: readonly V2PrepareSlotEntry[];
  /** Optional explicit profile override (e.g. 0¤ bankrupt profile) */
  readonly customProfile?: V2ProfileState;
}

interface SimMetrics {
  readonly label: string;
  readonly runs: number;
  readonly contractRate: number;
  readonly defeatRate: number;
  readonly earlyRetreatRate: number;
  readonly beaconReturnRate: number;
  readonly emergencyTowRate: number;
  readonly layer6Rate: number;
  readonly spatialConflictRate: number;
  readonly avgConflicts: number;
  readonly avgCredits: number;
  readonly stdDevCredits: number;
  readonly emptyArranges: number;
}

function toPrimaryArchetype(arch: ExtendedSimArchetype): V2ArchetypeId {
  return arch === 'salvo' ? 'hangar' : arch;
}

function buildArchetypeSlots(shipId: V2ShipId, archetype: ExtendedSimArchetype): readonly V2PrepareSlotEntry[] {
  const isFreighter = shipId === 'heavy_freighter'; // budget 5 (vs 6 on skiff/shield, 8 on stargate_cruiser)
  const isCruiser = shipId === 'stargate_cruiser';
  const ox = isCruiser ? 1 : 0; // stargate_cruiser disables (0,0)/(4,0); columns 1..3 rows 0..3 are all valid!

  if (archetype === 'laser') {
    const base: V2PrepareSlotEntry[] = [
      { slotKey: 'l1', origin: 'loan', definitionId: 'equipment.laser.common', x: ox + 0, y: 0, rotation: 0 },
      { slotKey: 'b1', origin: 'loan', definitionId: 'equipment.battery.common', x: ox + 1, y: 0, rotation: 0 },
      { slotKey: 's1', origin: 'loan', definitionId: 'equipment.shield.common', x: ox + 2, y: 0, rotation: 0 },
    ];
    if (!isFreighter) {
      base.push({ slotKey: 'ca1', origin: 'loan', definitionId: 'equipment.cargo_amp.common', x: ox + 1, y: 1, rotation: 0 });
    }
    if (isCruiser) {
      base.push({ slotKey: 'l2', origin: 'loan', definitionId: 'equipment.laser.common', x: 0, y: 1, rotation: 0 });
    }
    return base;
  }

  if (archetype === 'heavy') {
    const base: V2PrepareSlotEntry[] = [
      { slotKey: 'h1', origin: 'loan', definitionId: 'equipment.heavy.common', x: ox + 0, y: 0, rotation: 0 },
      { slotKey: 'c1', origin: 'loan', definitionId: 'equipment.capacitor.common', x: ox + 1, y: 0, rotation: 0 },
    ];
    if (!isFreighter) {
      base.push({ slotKey: 'cv1', origin: 'loan', definitionId: 'equipment.coolant_vent.common', x: ox + 1, y: 1, rotation: 0 });
      if (isCruiser) {
        base.push({ slotKey: 's1', origin: 'loan', definitionId: 'equipment.shield.common', x: 0, y: 1, rotation: 0 });
      }
    } else {
      base.push({ slotKey: 'ca1', origin: 'loan', definitionId: 'equipment.cargo_amp.common', x: ox + 1, y: 1, rotation: 0 });
    }
    return base;
  }

  if (archetype === 'hangar') {
    const base: V2PrepareSlotEntry[] = [
      { slotKey: 'hg1', origin: 'loan', definitionId: 'equipment.hangar.common', x: ox + 0, y: 0, rotation: 0 },
      { slotKey: 'rl1', origin: 'loan', definitionId: 'equipment.relay.common', x: ox + 2, y: 0, rotation: 0 },
    ];
    if (!isFreighter) {
      base.push({ slotKey: 'rp1', origin: 'loan', definitionId: 'equipment.repair.common', x: ox + 2, y: 1, rotation: 0 });
      if (isCruiser) {
        base.push({ slotKey: 's1', origin: 'loan', definitionId: 'equipment.shield.common', x: 0, y: 1, rotation: 0 });
      }
    } else {
      base.push({ slotKey: 'ca1', origin: 'loan', definitionId: 'equipment.cargo_amp.common', x: ox + 2, y: 1, rotation: 0 });
    }
    return base;
  }

  if (archetype === 'salvo') {
    const base: V2PrepareSlotEntry[] = [
      { slotKey: 'sv1', origin: 'loan', definitionId: 'equipment.salvo_pod.common', x: ox + 0, y: 0, rotation: 0 },
      { slotKey: 'cp1', origin: 'loan', definitionId: 'equipment.capacitor.common', x: ox + 1, y: 0, rotation: 0 },
    ];
    if (!isFreighter) {
      base.push({ slotKey: 'cv1', origin: 'loan', definitionId: 'equipment.coolant_vent.common', x: ox + 1, y: 1, rotation: 0 });
      if (isCruiser) {
        base.push({ slotKey: 's1', origin: 'loan', definitionId: 'equipment.shield.common', x: ox + 2, y: 0, rotation: 0 });
      }
    } else {
      base.push({ slotKey: 'ca1', origin: 'loan', definitionId: 'equipment.cargo_amp.common', x: ox + 1, y: 1, rotation: 0 });
    }
    return base;
  }

  // counter: shield(2) + counter(2) = 4; + laser(2) if budget >= 6; on freighter align shield onto (2,1) power cell!
  if (isFreighter) {
    return [
      { slotKey: 's1', origin: 'loan', definitionId: 'equipment.shield.common', x: 2, y: 1, rotation: 0 },
      { slotKey: 'ct1', origin: 'loan', definitionId: 'equipment.counter.common', x: 1, y: 1, rotation: 0 },
      { slotKey: 'ca1', origin: 'loan', definitionId: 'equipment.cargo_amp.common', x: 2, y: 0, rotation: 0 },
    ];
  }
  const base: V2PrepareSlotEntry[] = [
    { slotKey: 's1', origin: 'loan', definitionId: 'equipment.shield.common', x: ox + 0, y: 0, rotation: 0 },
    { slotKey: 'ct1', origin: 'loan', definitionId: 'equipment.counter.common', x: ox + 1, y: 0, rotation: 0 },
    { slotKey: 'l1', origin: 'loan', definitionId: 'equipment.laser.common', x: ox + 2, y: 0, rotation: 0 },
  ];
  if (isCruiser) {
    base.push({ slotKey: 'emp1', origin: 'loan', definitionId: 'equipment.emp_jammer.common', x: 0, y: 1, rotation: 0 });
  }
  return base;
}

function packStagingItems(run: V2RunState): V2RunState {
  let bay = run.bay;
  // Realistic player priority: 1) mission items, 2) combat equipment upgrades (up to 5 eqs), 3) highest-value cargo!
  const sorted = [...bay.staging].sort((a, b) => {
    const rank = (it: typeof a.item) =>
      it.origin === 'mission' ? 0 : it.category === 'equipment' ? 1 : 2;
    const ra = rank(a.item);
    const rb = rank(b.item);
    if (ra !== rb) return ra - rb;
    return b.item.fixedValue - a.item.fixedValue;
  });

  for (const st of sorted) {
    let spot = findFirstLegalV2Placement(bay, st.item.definitionId);
    if (!spot && st.item.origin === 'mission') {
      const removable = [...bay.placed]
        .filter((p) => p.item.origin !== 'mission')
        .sort((a, b) => a.item.fixedValue - b.item.fixedValue);
      for (const rem of removable) {
        bay = discardV2Item(bay, rem.item.instanceId).bay;
        spot = findFirstLegalV2Placement(bay, st.item.definitionId);
        if (spot) break;
      }
    } else if (
      !spot &&
      st.item.category === 'equipment' &&
      bay.placed.filter((p) => p.item.category === 'equipment').length < 5
    ) {
      // Trade a lower-value regular cargo to mount newly won combat equipment!
      const removableCargo = [...bay.placed]
        .filter((p) => p.item.category === 'cargo' && p.item.origin === 'loot')
        .sort((a, b) => a.item.fixedValue - b.item.fixedValue);
      for (const rem of removableCargo) {
        bay = discardV2Item(bay, rem.item.instanceId).bay;
        spot = findFirstLegalV2Placement(bay, st.item.definitionId);
        if (spot) break;
      }
    }
    if (spot) {
      bay = placeV2FromStaging(bay, st.item.instanceId, spot.x, spot.y, spot.rotation).bay;
    } else {
      bay = discardV2Item(bay, st.item.instanceId).bay;
    }
  }
  return { ...run, bay };
}

function returnHomeRespectingBeacons(run: V2RunState): V2RunState {
  const status = getV2SafeReturnStatus(run);
  return (
    status.isFreeBeacon
      ? initiateV2SafeReturnFromMap(run)
      : initiateV2EmergencyTowReturn(run)
  ).run;
}

function makeSimProfile(): V2ProfileState {
  const allFamilies = ['core', 'heavy_kit', 'hangar_kit', 'counter_kit'] as const;
  const fresh = createFreshV2Profile();
  return {
    ...fresh,
    buildings: {
      workbench: true,
      contract_hub: true,
      drydock: true,
      drydock_tier2: true,
      research_lab: true,
      display: true,
    },
    facilityTiers: {
      workbench: 1,
      contract_hub: 1,
      drydock: 2,
      research_lab: 1,
      display: 1,
      stargate_relay: 0,
    },
    unlockedShips: ['cannon_skiff', 'shield_cruiser', 'heavy_freighter', 'stargate_cruiser'],
    unlockedCrew: ['engineer', 'navigator', 'salvager'],
    unlockedFamilies: [...allFamilies],
    blueprints: Object.keys(V2_EQUIPMENT_DEFS)
      .filter((k) => k.endsWith('.common'))
      .map((k) => k.split('.')[1]) as ReturnType<typeof createFreshV2Profile>['blueprints'],
    campaign: {
      ...fresh.campaign,
      currentAct: 'act3',
      unlockedSectors: ['near_orbit', 'frozen_graveyard', 'stargate_abyss'],
    },
    tutorialCompleted: true,
    deepestLayerReached: 6,
    totalRuns: 5,
  };
}

function runSingleSimulation(policy: SimPolicy, seed: number): {
  readonly contractCompleted: boolean;
  readonly defeated: boolean;
  readonly earlyRetreat: boolean;
  readonly beaconReturn: boolean;
  readonly emergencyTow: boolean;
  readonly reachedLayer6: boolean;
  readonly spatialConflicts: number;
  readonly emptyArranges: number;
  readonly credits: number;
  readonly finalRun: V2RunState;
  readonly profileUsed: V2ProfileState;
} {
  const profile = policy.customProfile ?? makeSimProfile();
  const sectorId = policy.sectorId ?? 'near_orbit';
  const preferredCrew = policy.contractId.startsWith('survey') ? 'navigator' : 'salvager';
  const crewId = profile.unlockedCrew.includes(preferredCrew)
    ? preferredCrew
    : profile.unlockedCrew[0] ?? 'engineer';

  const launched = launchV2Expedition({
    profile,
    contractTemplateId: policy.contractId,
    shipId: policy.shipId,
    crewId,
    primaryArchetype: toPrimaryArchetype(policy.archetype),
    slots: policy.customSlots ?? buildArchetypeSlots(policy.shipId, policy.archetype),
    sectorId,
    seed,
    allowImproved: policy.allowImproved,
  });
  if (!launched.ok || !launched.run) {
    throw new Error(`Simulation launch failed (${policy.name}, seed=${seed}): ${launched.errors.join('; ')}`);
  }
  let run = launched.run;
  let emptyArranges = 0;

  for (let guard = 0; guard < 40 && run.phase !== 'SETTLEMENT'; guard++) {
    if (run.phase === 'MAP') {
      const nextIds = getReachableNextNodeIds(run);
      const jumpCost = computeV2JumpFuelCost(run).totalCost;
      const curNode = run.currentNodeId ? run.graph.nodes[run.currentNodeId] : null;
      const curLayer = curNode?.layer ?? 0;

      // Stranded or terminal -> return home (free if beacon/terminal, else stranded_tow!)
      if (nextIds.length === 0 || run.fuel < jumpCost) {
        run = returnHomeRespectingBeacons(run);
        break;
      }

      // Optional early emergency-tow bailout policy (used for D04 Beacon vs Tow payoff comparison!)
      if (policy.forceEarlyTow && curLayer === 2 && !curNode?.isBeacon) {
        run = initiateV2EmergencyTowReturn(run).run;
        break;
      }

      const cDone = isContractReadyForDelivery(run, 'safe_return');
      const retStatus = getV2SafeReturnStatus(run);

      // Explicit Early/Balanced Beacon Cash-Out policy (exits FREE at target Beacon layer)
      if (
        policy.earlyBeaconExitLayer !== undefined &&
        retStatus.isFreeBeacon &&
        curLayer >= policy.earlyBeaconExitLayer
      ) {
        run = initiateV2SafeReturnFromMap(run).run;
        break;
      }

      // Smart D04 Beacon-aware return: if contract complete and not pushing Layer 6, extract FREE on Beacon!
      if (
        policy.earlyBeaconExitLayer === undefined &&
        cDone &&
        !policy.pushToLayer6 &&
        retStatus.isFreeBeacon &&
        curLayer >= 3
      ) {
        run = initiateV2SafeReturnFromMap(run).run;
        break;
      }

      // Pick next node: prioritize contract backbone, then Beacon if exiting early or contract done
      const gSet = new Set(run.graph.guaranteedPathNodeIds);
      let chosenId = nextIds[0];
      const onGuaranteed = nextIds.find((id) => gSet.has(id));
      const nextBeacon = nextIds.find((id) => run.graph.nodes[id]?.isBeacon);
      const wantsBeaconNext =
        Boolean(nextBeacon) &&
        ((policy.earlyBeaconExitLayer !== undefined && curLayer + 1 >= policy.earlyBeaconExitLayer) ||
          (policy.earlyBeaconExitLayer === undefined && cDone && !policy.pushToLayer6));

      if (wantsBeaconNext && nextBeacon) {
        chosenId = nextBeacon;
      } else if (!cDone && onGuaranteed) {
        if (policy.realisticNoDodge) {
          chosenId = onGuaranteed;
        } else {
          const gNode = run.graph.nodes[onGuaranteed];
          const gPreview = previewV2CombatNode(run, onGuaranteed);
          const altId = nextIds.find((id) => id !== onGuaranteed);
          if (
            !gNode?.contractMarker &&
            gPreview?.outcome === 'defeat' &&
            altId &&
            previewV2CombatNode(run, altId)?.outcome !== 'defeat'
          ) {
            chosenId = altId;
          } else {
            chosenId = onGuaranteed;
          }
        }
      } else {
        const nonCombat = nextIds.find((id) => {
          const t = run.graph.nodes[id].type;
          return t !== 'combat' && t !== 'elite' && t !== 'boss';
        });
        if (nonCombat && !policy.pushToLayer6) {
          chosenId = nonCombat;
        } else if (policy.realisticNoDodge) {
          chosenId = onGuaranteed ?? nextIds[0];
        } else {
          chosenId = [...nextIds].sort((a, b) => {
            const pa = previewV2CombatNode(run, a);
            const pb = previewV2CombatNode(run, b);
            const scoreA = pa ? pa.finalPlayerHpAfterRepair : run.hp + 5;
            const scoreB = pb ? pb.finalPlayerHpAfterRepair : run.hp + 5;
            return scoreB - scoreA;
          })[0];
        }
      }

      // Non-pushing omniscient-preview strategies bail out on guaranteed lethal; realisticNoDodge faces normal risk!
      if (!policy.realisticNoDodge && !policy.pushToLayer6) {
        const chosenPreview = previewV2CombatNode(run, chosenId);
        if (chosenPreview && chosenPreview.outcome === 'defeat') {
          run = returnHomeRespectingBeacons(run);
          break;
        }
      }

      const entered = selectV2MapNode(run, chosenId, { profile });
      if (!entered.ok) {
        run = returnHomeRespectingBeacons(run);
        break;
      }
      run = entered.run;
    } else if (run.phase === 'ENCOUNTER' && run.currentNodeId) {
      const node = run.graph.nodes[run.currentNodeId];
      if (node.combat) {
        const started = startV2CombatAtCurrentNode(run, 'weakest', { pureAutoCombat: true });
        run = completeV2CombatAtCurrentNode(started.run, profile.unlockedFamilies).run;
      } else if (node.type === 'wreck') {
        // Real V3 multi-cut wreck dissection (Cut #1 safe: reactor repair when damaged, else cargo/armory; optional greedy Cut #2)
        const needHeal = run.hp <= Math.ceil(run.maxHp * 0.55);
        const firstSpot = needHeal ? 'reactor' : run.bay.placed.length < 4 ? 'armory' : 'cargo';
        const c1 = cutV2WreckHotspot(
          run,
          firstSpot,
          profile.unlockedFamilies,
          needHeal ? 'repair' : undefined,
          profile
        );
        if (c1.ok) run = c1.run;

        if (
          (policy.greedyWreckCuts || firstSpot === 'reactor') &&
          run.activeWreck &&
          !run.activeWreck.ambushTriggered &&
          !run.activeWreck.collapsed &&
          run.hp >= Math.ceil(run.maxHp * 0.55) &&
          run.activeWreck.stability >= 55
        ) {
          const secondSpot = firstSpot === 'cargo' ? 'armory' : 'cargo';
          const c2 = cutV2WreckHotspot(run, secondSpot, profile.unlockedFamilies, undefined, profile);
          if (c2.ok) run = c2.run;
        }

        if (run.activeWreck?.ambushTriggered || run.graph.nodes[node.nodeId]?.combat) {
          const started = startV2CombatAtCurrentNode(run, 'weakest', { pureAutoCombat: true });
          run = completeV2CombatAtCurrentNode(started.run, profile.unlockedFamilies).run;
        } else {
          const ext = extractV2Wreck(run);
          run = ext.ok ? ext.run : abandonV2EventAndReturn(run).run;
        }
      } else if (node.type === 'anomaly' || node.type === 'distress') {
        const opts = (run.activeEvent ?? node.eventState)?.options ?? [];
        const healOpt =
          run.hp <= Math.ceil(run.maxHp * 0.65)
            ? opts.find((o) => (o.rewardHp ?? 0) > 0 && evaluateV2EventOption(run, o).enabled)
            : undefined;
        const nonFallback = opts.find((o) => !o.isFallback && evaluateV2EventOption(run, o).enabled);
        const fallback = opts.find((o) => o.isFallback && evaluateV2EventOption(run, o).enabled);
        const chosenOpt = healOpt ?? nonFallback ?? fallback ?? opts[0];
        if (chosenOpt) {
          const res = resolveV2EventOption(run, chosenOpt.index, profile.unlockedFamilies);
          run = res.ok ? res.run : abandonV2EventAndReturn(run).run;
        } else {
          run = abandonV2EventAndReturn(run).run;
        }
      } else {
        run = returnHomeRespectingBeacons(run);
      }
    } else if (run.phase === 'SHOP') {
      // Realistic D04 survival trade-off: pay merchant credits for repair / fuel when low!
      if (run.hp <= run.maxHp - 8) {
        const rep = buyV2MerchantRepair(run, `sim_rep_${guard}`, 0);
        if (rep.ok) run = rep.run;
      }
      if (run.fuel <= 3) {
        const fl = buyV2MerchantFuel(run, `sim_fuel_${guard}`, 0);
        if (fl.ok) run = fl.run;
      }
      run = finishV2MerchantVisit(run).run;
    } else if (run.phase === 'REWARD') {
      const options = run.pendingReward?.equipmentOptions ?? [];
      let choice: V2RewardChoiceId = 'equipment_0';
      if (options.length > 0) {
        // Pick the equipment option with the strongest bay synergy (real D07 buildcraft decision!)
        let bestIdx = 0;
        let bestScore = -1;
        for (let i = 0; i < options.length; i += 1) {
          const syn = evaluateV2RewardSynergies(run.bay, options[i].definitionId);
          const score =
            (syn.hasSynergy ? 10 : 0) +
            (options[i].quality === 'improved' ? 5 : 0) +
            options[i].fixedValue / 20;
          if (score > bestScore) {
            bestScore = score;
            bestIdx = i;
          }
        }
        choice = (`equipment_${bestIdx}` as V2RewardChoiceId);
      }
      run = pickV2CombatReward(run, choice, profile.unlockedFamilies).run;
    } else if (run.phase === 'ARRANGE') {
      if (shouldAutoSkipArrange(run)) {
        emptyArranges += 1;
      }
      if (canPerformSurveyAtCurrentNode(run).canSurvey) {
        run = performSurveyAtCurrentNode(run).run;
      }
      run = packStagingItems(run);
      const curLayer = run.currentNodeId ? run.graph.nodes[run.currentNodeId]?.layer ?? 1 : 1;
      run = finishV2ArrangeAndProceed(
        run,
        curLayer >= run.graph.maxLayers ? 'safe_return' : 'map'
      ).run;
    }
  }

  expect(run.phase, `Simulation must reach SETTLEMENT cleanly (${policy.name}, seed=${seed})`).toBe(
    'SETTLEMENT'
  );

  const summary = calculateV2Settlement(run, launched.profile);
  const maxLayer = Math.max(0, ...run.visitedNodeIds.map((id) => run.graph.nodes[id]?.layer ?? 0));
  const isSafe = summary.reason === 'safe_return';
  return {
    contractCompleted: summary.contractCompleted,
    defeated: summary.reason === 'defeat',
    earlyRetreat: isSafe && maxLayer < 6,
    beaconReturn: isSafe && !summary.emergencyTowUsed,
    emergencyTow: isSafe && Boolean(summary.emergencyTowUsed),
    reachedLayer6: maxLayer >= 6,
    spatialConflicts: run.spatialConflictCount ?? 0,
    emptyArranges,
    credits: summary.finalCreditsEarned,
    finalRun: run,
    profileUsed: launched.profile,
  };
}

function evaluatePolicy(policy: SimPolicy, seedsCount: number): SimMetrics {
  let contracts = 0;
  let defeats = 0;
  let earlyRetreats = 0;
  let beaconReturns = 0;
  let emergencyTows = 0;
  let layer6 = 0;
  let runsWithConflict = 0;
  let totalConflicts = 0;
  let totalEmptyArranges = 0;
  const creditsSamples: number[] = [];

  for (let i = 1; i <= seedsCount; i++) {
    const res = runSingleSimulation(policy, 50000 + i * 7919);
    if (res.contractCompleted) contracts += 1;
    if (res.defeated) defeats += 1;
    if (res.earlyRetreat) earlyRetreats += 1;
    if (res.beaconReturn) beaconReturns += 1;
    if (res.emergencyTow) emergencyTows += 1;
    if (res.reachedLayer6) layer6 += 1;
    if (res.spatialConflicts >= 1) runsWithConflict += 1;
    totalConflicts += res.spatialConflicts;
    totalEmptyArranges += res.emptyArranges;
    creditsSamples.push(res.credits);
  }

  const totalCredits = creditsSamples.reduce((s, c) => s + c, 0);
  const meanCredits = totalCredits / seedsCount;
  const variance =
    creditsSamples.reduce((s, c) => s + (c - meanCredits) ** 2, 0) / seedsCount;
  const stdDevCredits = Math.sqrt(variance);

  const pct = (n: number) => Number(((n / seedsCount) * 100).toFixed(1));
  return {
    label: policy.name,
    runs: seedsCount,
    contractRate: pct(contracts),
    defeatRate: pct(defeats),
    earlyRetreatRate: pct(earlyRetreats),
    beaconReturnRate: pct(beaconReturns),
    emergencyTowRate: pct(emergencyTows),
    layer6Rate: pct(layer6),
    spatialConflictRate: pct(runsWithConflict),
    avgConflicts: Number((totalConflicts / seedsCount).toFixed(2)),
    avgCredits: Number(meanCredits.toFixed(1)),
    stdDevCredits: Number(stdDevCredits.toFixed(1)),
    emptyArranges: totalEmptyArranges,
  };
}

describe('V2 §18 & R2-M6B D08 平衡模拟矩阵（四船 × 五流派 × 五委托 × 三星区，600+ 局蒙特卡洛）', () => {
  it('核心 §18 矩阵（纯普通 / 优良对照）：三船与三构筑均具备可完成委托及深入路径，且 D04/D07 规则下无崩溃', () => {
    const SEEDS = 40;
    const matrix: SimPolicy[] = [
      // Common-only core matrix (T09 Gate C)
      { name: '炮艇·重炮·标准运输(纯普通)', shipId: 'cannon_skiff', archetype: 'heavy', contractId: 'transport_std', pushToLayer6: false, allowImproved: false },
      { name: '炮艇·机库·标准救援(纯普通)', shipId: 'cannon_skiff', archetype: 'hangar', contractId: 'rescue_std', pushToLayer6: false, allowImproved: false },
      { name: '护盾艇·反击·标准勘测(纯普通)', shipId: 'shield_cruiser', archetype: 'counter', contractId: 'survey_std', pushToLayer6: false, allowImproved: false },
      { name: '货船·重炮·深入运输·冲六层(纯普通)', shipId: 'heavy_freighter', archetype: 'heavy', contractId: 'transport_deep', pushToLayer6: true, allowImproved: false },
      { name: '护盾艇·反击·深入救援·冲六层(纯普通)', shipId: 'shield_cruiser', archetype: 'counter', contractId: 'rescue_deep', pushToLayer6: true, allowImproved: false },
      { name: '炮艇·机库·深入勘测·冲六层(纯普通)', shipId: 'cannon_skiff', archetype: 'hangar', contractId: 'survey_deep', pushToLayer6: true, allowImproved: false },
      // Improved-enabled comparison (T16)
      { name: '货船·重炮·深入运输·冲六层(含优良)', shipId: 'heavy_freighter', archetype: 'heavy', contractId: 'transport_deep', pushToLayer6: true, allowImproved: true },
      { name: '护盾艇·反击·深入救援·冲六层(含优良)', shipId: 'shield_cruiser', archetype: 'counter', contractId: 'rescue_deep', pushToLayer6: true, allowImproved: true },
      { name: '炮艇·机库·深入勘测·冲六层(含优良)', shipId: 'cannon_skiff', archetype: 'hangar', contractId: 'survey_deep', pushToLayer6: true, allowImproved: true },
    ];

    const report = matrix.map((p) => evaluatePolicy(p, SEEDS));
    console.log('\n[V2 §18 Core Balance Simulation Report (360 runs)]');
    console.table(report);

    for (const row of report) {
      expect(row.emptyArranges, `${row.label} emptyArranges (S02)`).toBe(0);
    }
    for (const row of report.slice(0, 3)) {
      expect(row.contractRate).toBeGreaterThanOrEqual(65);
      expect(row.avgCredits).toBeGreaterThanOrEqual(75);
    }
    const deepCommonRows = report.slice(3, 6);
    expect(deepCommonRows.some((r) => r.layer6Rate >= 40)).toBe(true);
    expect(deepCommonRows.every((r) => r.contractRate >= 40)).toBe(true);
  }, 20_000);

  it('D08 全量 4 舰 × 5 流派 × 5 标准委托（600 局）平衡矩阵：验证 D06 空间冲突率 >=90%、D04 深潜信标收益 > 早期拖航、且无单流派通解', () => {
    const SEEDS_PER_CELL = 24; // 25 cells × 24 seeds = 600 runs!
    const matrix: SimPolicy[] = [
      // All 5 standard contracts × 4 ships × 5 archetypes (Latin-balanced full coverage)
      { name: '炮艇·激光·标准运输', shipId: 'cannon_skiff', archetype: 'laser', contractId: 'transport_std', pushToLayer6: false, allowImproved: true },
      { name: '炮艇·重炮·标准救援', shipId: 'cannon_skiff', archetype: 'heavy', contractId: 'rescue_std', pushToLayer6: false, allowImproved: true },
      { name: '炮艇·机库·标准勘测', shipId: 'cannon_skiff', archetype: 'hangar', contractId: 'survey_std', pushToLayer6: false, allowImproved: true },
      { name: '炮艇·反击·标准清剿', shipId: 'cannon_skiff', archetype: 'counter', contractId: 'bounty_std', pushToLayer6: false, allowImproved: true },
      { name: '炮艇·齐射·标准黑匣', shipId: 'cannon_skiff', archetype: 'salvo', contractId: 'derelict_std', pushToLayer6: false, allowImproved: true },

      { name: '护盾艇·激光·标准黑匣', shipId: 'shield_cruiser', archetype: 'laser', contractId: 'derelict_std', pushToLayer6: false, allowImproved: true },
      { name: '护盾艇·重炮·标准运输', shipId: 'shield_cruiser', archetype: 'heavy', contractId: 'transport_std', pushToLayer6: false, allowImproved: true },
      { name: '护盾艇·机库·标准救援', shipId: 'shield_cruiser', archetype: 'hangar', contractId: 'rescue_std', pushToLayer6: false, allowImproved: true },
      { name: '护盾艇·反击·标准勘测', shipId: 'shield_cruiser', archetype: 'counter', contractId: 'survey_std', pushToLayer6: false, allowImproved: true },
      { name: '护盾艇·齐射·标准清剿', shipId: 'shield_cruiser', archetype: 'salvo', contractId: 'bounty_std', pushToLayer6: false, allowImproved: true },

      { name: '重货船·激光·标准清剿', shipId: 'heavy_freighter', archetype: 'laser', contractId: 'bounty_std', pushToLayer6: false, allowImproved: true },
      { name: '重货船·重炮·标准黑匣', shipId: 'heavy_freighter', archetype: 'heavy', contractId: 'derelict_std', pushToLayer6: false, allowImproved: true },
      { name: '重货船·机库·标准运输', shipId: 'heavy_freighter', archetype: 'hangar', contractId: 'transport_std', pushToLayer6: false, allowImproved: true },
      { name: '重货船·反击·标准救援', shipId: 'heavy_freighter', archetype: 'counter', contractId: 'rescue_std', pushToLayer6: false, allowImproved: true },
      { name: '重货船·齐射·标准勘测', shipId: 'heavy_freighter', archetype: 'salvo', contractId: 'survey_std', pushToLayer6: false, allowImproved: true },

      { name: '星门巡洋·激光·标准勘测', shipId: 'stargate_cruiser', archetype: 'laser', contractId: 'survey_std', pushToLayer6: true, allowImproved: true, sectorId: 'frozen_graveyard' },
      { name: '星门巡洋·重炮·标准清剿', shipId: 'stargate_cruiser', archetype: 'heavy', contractId: 'bounty_std', pushToLayer6: true, allowImproved: true, sectorId: 'frozen_graveyard' },
      { name: '星门巡洋·机库·标准黑匣', shipId: 'stargate_cruiser', archetype: 'hangar', contractId: 'derelict_std', pushToLayer6: true, allowImproved: true, sectorId: 'frozen_graveyard' },
      { name: '星门巡洋·反击·标准运输', shipId: 'stargate_cruiser', archetype: 'counter', contractId: 'transport_std', pushToLayer6: true, allowImproved: true, sectorId: 'stargate_abyss' },
      { name: '星门巡洋·齐射·标准救援', shipId: 'stargate_cruiser', archetype: 'salvo', contractId: 'rescue_std', pushToLayer6: true, allowImproved: true, sectorId: 'stargate_abyss' },

      // Greedy deep-dive + multi-cut risk cells across sectors
      { name: '深潜贪刀·炮艇·激光(冰晶)', shipId: 'cannon_skiff', archetype: 'laser', contractId: 'transport_deep', pushToLayer6: true, allowImproved: true, sectorId: 'frozen_graveyard', greedyWreckCuts: true },
      { name: '深潜贪刀·护盾艇·重炮(星门)', shipId: 'shield_cruiser', archetype: 'heavy', contractId: 'rescue_deep', pushToLayer6: true, allowImproved: true, sectorId: 'stargate_abyss', greedyWreckCuts: true },
      { name: '深潜贪刀·重货船·机库(冰晶)', shipId: 'heavy_freighter', archetype: 'hangar', contractId: 'survey_deep', pushToLayer6: true, allowImproved: true, sectorId: 'frozen_graveyard', greedyWreckCuts: true },
      { name: '深潜贪刀·星门巡洋·反击(星门)', shipId: 'stargate_cruiser', archetype: 'counter', contractId: 'transport_deep', pushToLayer6: true, allowImproved: true, sectorId: 'stargate_abyss', greedyWreckCuts: true },
      { name: '深潜贪刀·星门巡洋·齐射(星门)', shipId: 'stargate_cruiser', archetype: 'salvo', contractId: 'survey_deep', pushToLayer6: true, allowImproved: true, sectorId: 'stargate_abyss', greedyWreckCuts: true },
    ];

    const report = matrix.map((p) => evaluatePolicy(p, SEEDS_PER_CELL));
    const totalRuns = report.reduce((s, r) => s + r.runs, 0);
    expect(totalRuns).toBe(600);

    console.log(`\n[R2-M6B D08 Full Balance Matrix (${totalRuns} runs: 4 ships × 5 archetypes × 5 contracts × 3 sectors)]`);
    console.table(report);

    // 1. All 25 cells maintain S02 invariant (0 empty arranges); 20 standard-contract cells achieve viable completion & positive net credits
    for (const row of report) {
      expect(row.emptyArranges, `${row.label} emptyArranges (S02)`).toBe(0);
    }
    const standardCells = report.slice(0, 20);
    for (const row of standardCells) {
      expect(row.contractRate, `${row.label} contractRate`).toBeGreaterThanOrEqual(50);
      expect(row.avgCredits, `${row.label} avgCredits`).toBeGreaterThan(60);
    }

    // 2. D06 Spatial Conflict Gate: across ALL 5 standard contracts, >= 90% of runs experience >= 1 genuine spatial conflict
    //    AND unmasked 18-cell heavy_freighter with minimal 5-cell wired loadout achieves >= 1.0 avgConflicts on EVERY standard contract!
    const contractGroups = ['transport_std', 'rescue_std', 'survey_std', 'bounty_std', 'derelict_std'] as const;
    for (const ct of contractGroups) {
      const cells = matrix
        .map((p, idx) => ({ policy: p, metrics: report[idx] }))
        .filter((e) => e.policy.contractId === ct);
      const meanConflictRate =
        cells.reduce((s, c) => s + c.metrics.spatialConflictRate, 0) / cells.length;
      const meanConflicts =
        cells.reduce((s, c) => s + c.metrics.avgConflicts, 0) / cells.length;
      expect(
        meanConflictRate,
        `D06 spatialConflictRate for ${ct} (mean=${meanConflictRate.toFixed(1)}%, avg=${meanConflicts.toFixed(2)})`
      ).toBeGreaterThanOrEqual(90);
      expect(meanConflicts, `D06 avgConflicts for ${ct}`).toBeGreaterThanOrEqual(1.0);
    }

    const freighterMinimalSlots: readonly V2PrepareSlotEntry[] = [
      { slotKey: 'l1', origin: 'loan', definitionId: 'equipment.laser.common', x: 0, y: 0, rotation: 0 },
      { slotKey: 'b1', origin: 'loan', definitionId: 'equipment.battery.common', x: 1, y: 0, rotation: 0 },
      { slotKey: 's1', origin: 'loan', definitionId: 'equipment.shield.common', x: 2, y: 0, rotation: 0 },
    ];
    for (const ct of contractGroups) {
      const hfMetrics = evaluatePolicy(
        {
          name: `重货船5格最小配装·${ct}`,
          shipId: 'heavy_freighter',
          archetype: 'laser',
          contractId: ct,
          pushToLayer6: false,
          allowImproved: true,
          customSlots: freighterMinimalSlots,
        },
        24
      );
      console.log(
        `[Gate G3 D06 Unmasked heavy_freighter/${ct}] conflictRate=${hfMetrics.spatialConflictRate}%, avgConflicts=${hfMetrics.avgConflicts}, emptyArranges=${hfMetrics.emptyArranges}`
      );
      expect(hfMetrics.emptyArranges, `heavy_freighter/${ct} emptyArranges`).toBe(0);
      expect(
        hfMetrics.avgConflicts,
        `D06 unmasked heavy_freighter minimal avgConflicts for ${ct} (rate=${hfMetrics.spatialConflictRate}%)`
      ).toBeGreaterThanOrEqual(1.0);
    }

    // 3. D04 Risk/Reward Payoff Gate:
    //    (a) Paired identical-seed comparison of Early Layer-3 Beacon Cash-Out vs Deep Push (L5/L6)
    //        MUST show BOTH higher expected value (avgCredits) AND higher variance (stdDevCredits)!
    const pairedScenarios: readonly {
      readonly label: string;
      readonly shipId: V2ShipId;
      readonly archetype: ExtendedSimArchetype;
      readonly contractId: string;
    }[] = [
      { label: 'free_salvage/skiff/heavy', shipId: 'cannon_skiff', archetype: 'heavy', contractId: 'free_salvage' },
      { label: 'free_salvage/skiff/laser', shipId: 'cannon_skiff', archetype: 'laser', contractId: 'free_salvage' },
      { label: 'bounty_std/shield/counter', shipId: 'shield_cruiser', archetype: 'counter', contractId: 'bounty_std' },
    ];
    for (const sc of pairedScenarios) {
      const earlyBeacon = evaluatePolicy(
        {
          name: `早期L3信标兑现(${sc.label})`,
          shipId: sc.shipId,
          archetype: sc.archetype,
          contractId: sc.contractId,
          pushToLayer6: false,
          allowImproved: true,
          earlyBeaconExitLayer: 3,
          realisticNoDodge: true,
        },
        40
      );
      const deepPush = evaluatePolicy(
        {
          name: `深潜L6高风险推进(${sc.label})`,
          shipId: sc.shipId,
          archetype: sc.archetype,
          contractId: sc.contractId,
          pushToLayer6: true,
          allowImproved: true,
          realisticNoDodge: true,
        },
        40
      );
      console.log(
        `[Gate G3 Paired D04 ${sc.label}] Early L3 Beacon: ${earlyBeacon.avgCredits}¤ ± ${earlyBeacon.stdDevCredits}¤ (beacon=${earlyBeacon.beaconReturnRate}%, defeat=${earlyBeacon.defeatRate}%) | Deep Push: ${deepPush.avgCredits}¤ ± ${deepPush.stdDevCredits}¤ (defeat=${deepPush.defeatRate}%)`
      );
      expect(earlyBeacon.emptyArranges).toBe(0);
      expect(deepPush.emptyArranges).toBe(0);
      expect(earlyBeacon.beaconReturnRate).toBeGreaterThanOrEqual(85);
      expect(deepPush.avgCredits, `Deep EV > Early Beacon EV (${sc.label})`).toBeGreaterThan(
        earlyBeacon.avgCredits
      );
      expect(
        deepPush.stdDevCredits,
        `Deep stdDev > Early Beacon stdDev (${sc.label})`
      ).toBeGreaterThan(earlyBeacon.stdDevCredits);
    }

    //    (b) Additional check: Beacon/Deep-dive return pays strictly MORE than early Layer-2 Emergency Tow!
    const deepBeaconMetrics = evaluatePolicy(
      {
        name: '信标深潜对照',
        shipId: 'cannon_skiff',
        archetype: 'heavy',
        contractId: 'free_salvage',
        pushToLayer6: true,
        allowImproved: true,
      },
      30
    );
    const earlyTowMetrics = evaluatePolicy(
      {
        name: '早退紧急拖航对照',
        shipId: 'cannon_skiff',
        archetype: 'heavy',
        contractId: 'free_salvage',
        pushToLayer6: false,
        allowImproved: true,
        forceEarlyTow: true,
      },
      30
    );
    expect(earlyTowMetrics.emergencyTowRate).toBeGreaterThanOrEqual(80);
    expect(deepBeaconMetrics.avgCredits).toBeGreaterThan(earlyTowMetrics.avgCredits * 1.4);

    // 4. Gate G3 Realistic Unbiased Mixed-Policy Cohort Defeat Rate (10% - 25%) + 0¤ Bankruptcy Comeback Launch!
    //    Equal 1/3 mix of cautious Early L3 Beacon, Balanced L5 Beacon, and Deep Push L6 across ships/archetypes/contracts
    //    WITHOUT omniscient exact-HP defeat dodging (models real player risk under Threat Tiers).
    const cohortShips: readonly V2ShipId[] = ['cannon_skiff', 'shield_cruiser', 'heavy_freighter'];
    const cohortArchs: readonly ExtendedSimArchetype[] = ['laser', 'heavy', 'hangar', 'counter'];
    const cohortTiers: readonly {
      readonly tag: string;
      readonly pushToLayer6: boolean;
      readonly earlyBeaconExitLayer?: number;
    }[] = [
      { tag: 'early_beacon_l3', pushToLayer6: false, earlyBeaconExitLayer: 3 },
      { tag: 'balanced_l5', pushToLayer6: false, earlyBeaconExitLayer: 5 },
      { tag: 'deep_push_l6', pushToLayer6: true },
    ];
    let cohortTotalRuns = 0;
    let cohortDefeats = 0;
    let cohortEmptyArranges = 0;
    for (let tIdx = 0; tIdx < cohortTiers.length; tIdx += 1) {
      const tier = cohortTiers[tIdx];
      for (let i = 0; i < 60; i += 1) {
        const shipId = cohortShips[i % cohortShips.length];
        const archetype = cohortArchs[Math.floor(i / cohortShips.length) % cohortArchs.length];
        const contractId = contractGroups[i % contractGroups.length];
        const res = runSingleSimulation(
          {
            name: `realistic_${tier.tag}_${shipId}_${archetype}_${contractId}`,
            shipId,
            archetype,
            contractId,
            pushToLayer6: tier.pushToLayer6,
            earlyBeaconExitLayer: tier.earlyBeaconExitLayer,
            allowImproved: true,
            realisticNoDodge: true,
          },
          70000 + tIdx * 10000 + i * 3571
        );
        cohortTotalRuns += 1;
        if (res.defeated) cohortDefeats += 1;
        cohortEmptyArranges += res.emptyArranges;
      }
    }
    const cohortDefeatRate = Number(((cohortDefeats / cohortTotalRuns) * 100).toFixed(1));
    console.log(
      `[Gate G3 Realistic Unbiased Mixed Cohort] ${cohortDefeats}/${cohortTotalRuns} defeats (${cohortDefeatRate}%), emptyArranges=${cohortEmptyArranges}`
    );
    expect(cohortEmptyArranges).toBe(0);
    expect(cohortDefeatRate).toBeGreaterThanOrEqual(10);
    expect(cohortDefeatRate).toBeLessThanOrEqual(25);

    // 0¤ Bankruptcy-Proof Comeback Launch after defeat: 0 credits & empty warehouse still launches free and earns > 0¤!
    const bankruptProfile: V2ProfileState = {
      ...createFreshV2Profile(),
      credits: 0,
      equipmentWarehouse: [],
      tutorialCompleted: true,
      totalRuns: 1,
    };
    const fallbackSlots = buildFreeFallbackPrepareSlots('cannon_skiff', bankruptProfile.blueprints);
    const comebackRes = runSingleSimulation(
      {
        name: '0¤破产免费借用翻身出航',
        shipId: 'cannon_skiff',
        archetype: 'laser',
        contractId: 'free_salvage',
        pushToLayer6: false,
        earlyBeaconExitLayer: 3,
        allowImproved: false,
        customSlots: fallbackSlots,
        customProfile: bankruptProfile,
      },
      88001
    );
    expect(comebackRes.emptyArranges).toBe(0);
    expect(comebackRes.defeated).toBe(false);
    expect(comebackRes.credits).toBeGreaterThan(0);
    const comebackSettled = applyV2Settlement(comebackRes.profileUsed, comebackRes.finalRun, {});
    expect(comebackSettled.ok).toBe(true);
    expect(comebackSettled.profile.credits).toBeGreaterThan(0);

    // 4. Anti-Dominance Gate: across ALL 5 archetypes on 3 canonical enemy matchups (armored / swarm / piercer),
    //    NO single archetype wins #1 surviving HP across all 3 enemy types!
    const archetypes: readonly ExtendedSimArchetype[] = ['laser', 'heavy', 'hangar', 'counter', 'salvo'];
    const mkBay = (arch: ExtendedSimArchetype) => {
      const slots = buildArchetypeSlots('cannon_skiff', arch);
      return {
        ...createEmptyV2Bay('cannon_skiff'),
        placed: slots.map((s, idx) => ({
          item: createV2EquipmentInstance({
            instanceId: `ad_${arch}_${idx}`,
            kind: s.definitionId.split('.')[1] as Parameters<typeof createV2EquipmentInstance>[0]['kind'],
            quality: 'common',
            origin: 'loan',
            acquiredDepth: 0,
            location: 'bay',
          }),
          x: s.x,
          y: s.y,
          rotation: s.rotation,
        })),
      };
    };
    const matchups = [
      { id: 'armored', units: buildEncounterUnits('armored', 3, 'ad_arm') },
      { id: 'swarm', units: buildEncounterUnits('swarm', 3, 'ad_swm') },
      { id: 'piercer', units: buildEncounterUnits('piercer', 3, 'ad_prc') },
    ] as const;

    const topWinners = new Set<ExtendedSimArchetype>();
    for (const m of matchups) {
      let bestArch: ExtendedSimArchetype = 'laser';
      let bestScore = -999;
      for (const arch of archetypes) {
        const sim = simulateV2Combat({
          resultId: `ad_${m.id}_${arch}`,
          bay: mkBay(arch),
          startingHp: 30,
          maxHp: 30,
          units: m.units,
          targetPolicy: 'weakest',
        });
        // Score by surviving HP - rounds (faster cleaner kills win)
        const score = sim.finalPlayerHpAfterRepair * 10 - sim.roundsCount;
        if (score > bestScore) {
          bestScore = score;
          bestArch = arch;
        }
      }
      topWinners.add(bestArch);
    }
    expect(topWinners.size).toBeGreaterThanOrEqual(2); // Zero universal dominant archetype!
  }, 20_000);
});
