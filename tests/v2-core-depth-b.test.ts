import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  V2_CARGO_DEFS,
  V2_NON_COLLECTIBLE_CARGO_DEF_IDS,
  computeV2CargoDepthAppreciation,
} from '../src/v2/data/cargo';
import {
  V2_CONTRACT_FAMILY_UNLOCK_ORDER,
  V2_EQUIPMENT_DEFS,
  type V2EquipmentKind,
  type V2UnlockFamilyId,
} from '../src/v2/data/equipment';
import { V3_EVENT_CATALOG } from '../src/v2/data/events';
import { createV2ShowcaseRun } from '../src/v2/data/showcaseRun';
import { createV2TutorialRun } from '../src/v2/data/tutorialV2';
import {
  V2_SYNERGY_ORDER,
  evaluateV2RewardSynergies,
} from '../src/v2/domain/buildStatsV2';
import { getActiveCampaignObjective } from '../src/v2/domain/campaign';
import {
  completeV2CombatAtCurrentNode,
  startV2CombatAtCurrentNode,
} from '../src/v2/domain/combatV2';
import {
  buildActiveWreckStateForNode,
  evaluateWreckHotspotCut,
} from '../src/v2/domain/dismantle';
import {
  abandonV2EventAndReturn,
  cutV2WreckHotspot,
  extractV2Wreck,
  finishV2ArrangeAndProceed,
  generateV2CombatRewardBundle,
  getV2SafeReturnStatus,
  initiateV2EmergencyTowReturn,
  initiateV2SafeReturnFromMap,
  pickV2CombatReward,
} from '../src/v2/domain/encounter';
import {
  addV2ItemToStaging,
  composeConflictCargoBundle,
  createEmptyV2Bay,
  detectV2BaySpatialConflict,
} from '../src/v2/domain/inventoryV2';
import {
  createV2CargoInstance,
  createV2EquipmentInstance,
} from '../src/v2/domain/itemCatalog';
import {
  buildFreeFallbackPrepareSlots,
  launchV2Expedition,
} from '../src/v2/domain/loadout';
import {
  createFreshV2Profile,
  createFreshV2SaveData,
  loadV2SaveData,
  migrateV3_0ToV3_1SaveData,
  persistV2SaveData,
  validateV2SaveDataDetailed,
  type V2StorageLike,
} from '../src/v2/domain/persistenceV2';
import {
  choosePendingV2FamilyUnlock,
  getLockedUnlockableFamilies,
  unlockV2EquipmentFamily,
} from '../src/v2/domain/progressionV2';
import { createV2RngStreams, withV2Stream } from '../src/v2/domain/rngStreams';
import {
  generateV2StarGraph,
  verifyV2GraphInvariants,
} from '../src/v2/domain/routeGenerator';
import {
  V2_DEFEAT_SALVAGE_FLOOR_RATE,
  V2_EMERGENCY_TOW_RETENTION_RATE,
  applyV2Settlement,
  calculateV2Settlement,
} from '../src/v2/domain/settlementV2';
import {
  V3_0_RULES_VERSION,
  type V2CargoBayState,
  type V2ProfileState,
  type V2RunState,
} from '../src/v2/domain/types';
import { BasePhaseView } from '../src/v2/ui/screens/BaseView';
import { MapPhaseView } from '../src/v2/ui/screens/MapView';
import { RewardPhaseView } from '../src/v2/ui/screens/RewardView';
import { SettlementPhaseView } from '../src/v2/ui/screens/SettlementView';

class MemoryStorage implements V2StorageLike {
  private readonly store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

class MiniEvent {
  readonly type: string;
  readonly bubbles: boolean;
  defaultPrevented = false;
  target: MiniEl | null = null;
  currentTarget: MiniEl | null = null;
  constructor(type: string, opts?: { bubbles?: boolean }) {
    this.type = type;
    this.bubbles = Boolean(opts?.bubbles);
  }
  preventDefault(): void {
    this.defaultPrevented = true;
  }
}

class MiniClassList {
  private readonly set = new Set<string>();
  syncFromString(str: string): void {
    this.set.clear();
    for (const part of str.split(/\s+/).filter(Boolean)) this.set.add(part);
  }
  toString(): string {
    return Array.from(this.set).join(' ');
  }
  add(...tokens: string[]): void {
    for (const t of tokens) if (t) this.set.add(t);
  }
  remove(...tokens: string[]): void {
    for (const t of tokens) this.set.delete(t);
  }
  toggle(token: string, force?: boolean): boolean {
    if (force === true) {
      this.set.add(token);
      return true;
    }
    if (force === false) {
      this.set.delete(token);
      return false;
    }
    if (this.set.has(token)) {
      this.set.delete(token);
      return false;
    }
    this.set.add(token);
    return true;
  }
  contains(token: string): boolean {
    return this.set.has(token);
  }
}

function camelToKebab(k: string): string {
  return k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

class MiniEl {
  readonly tagName: string;
  id = '';
  title = '';
  type = '';
  name = '';
  value = '';
  src = '';
  alt = '';
  tabIndex = 0;
  disabled = false;
  checked = false;
  style: Record<string, string> = {};
  parentElement: MiniEl | null = null;
  readonly childNodes: MiniEl[] = [];
  readonly attrs = new Map<string, string>();
  readonly listeners = new Map<string, Set<(ev: MiniEvent) => void>>();
  readonly classList: MiniClassList;
  readonly dataset: Record<string, string | undefined>;
  private _text = '';
  private _html = '';

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
    this.classList = new MiniClassList();
    this.dataset = new Proxy({} as Record<string, string | undefined>, {
      get: (_t, prop) => {
        if (typeof prop !== 'string') return undefined;
        return this.attrs.get(`data-${camelToKebab(prop)}`);
      },
      set: (_t, prop, val) => {
        if (typeof prop !== 'string') return false;
        const attrName = `data-${camelToKebab(prop)}`;
        if (val === undefined) this.attrs.delete(attrName);
        else this.attrs.set(attrName, String(val));
        return true;
      },
      deleteProperty: (_t, prop) => {
        if (typeof prop !== 'string') return false;
        this.attrs.delete(`data-${camelToKebab(prop)}`);
        return true;
      },
    });
  }

  get parentNode(): MiniEl | null {
    return this.parentElement;
  }
  get children(): MiniEl[] {
    return this.childNodes;
  }
  get className(): string {
    return this.classList.toString();
  }
  set className(v: string) {
    this.classList.syncFromString(v);
  }
  get textContent(): string {
    if (this.childNodes.length === 0) return this._text || this._html.replace(/<[^>]+>/g, '');
    return this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(v: string) {
    this.childNodes.length = 0;
    this._html = '';
    this._text = v;
  }
  get innerHTML(): string {
    return this._html || this.childNodes.map((c) => c.innerHTML || c.textContent).join('');
  }
  set innerHTML(v: string) {
    this.childNodes.length = 0;
    this._text = '';
    this._html = v;
  }
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
    if (k === 'id') this.id = v;
    if (k === 'name') this.name = v;
    if (k === 'value') this.value = v;
    if (k === 'disabled') this.disabled = true;
    if (k === 'checked') this.checked = true;
  }
  getAttribute(k: string): string | null {
    if (k === 'id') return this.id || null;
    if (k === 'class') return this.className || null;
    return this.attrs.has(k) ? this.attrs.get(k)! : null;
  }
  removeAttribute(k: string): void {
    this.attrs.delete(k);
    if (k === 'disabled') this.disabled = false;
    if (k === 'checked') this.checked = false;
  }
  appendChild(child: MiniEl): MiniEl {
    if (child.parentElement) child.remove();
    child.parentElement = this;
    this.childNodes.push(child);
    return child;
  }
  insertBefore(child: MiniEl, ref: MiniEl | null): MiniEl {
    if (child.parentElement) child.remove();
    child.parentElement = this;
    if (!ref) {
      this.childNodes.push(child);
      return child;
    }
    const idx = this.childNodes.indexOf(ref);
    if (idx < 0) this.childNodes.push(child);
    else this.childNodes.splice(idx, 0, child);
    return child;
  }
  removeChild(child: MiniEl): MiniEl {
    const idx = this.childNodes.indexOf(child);
    if (idx >= 0) this.childNodes.splice(idx, 1);
    child.parentElement = null;
    return child;
  }
  remove(): void {
    this.parentElement?.removeChild(this);
  }
  contains(other: MiniEl | null): boolean {
    let cur = other;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentElement;
    }
    return false;
  }
  addEventListener(type: string, fn: (ev: MiniEvent) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }
  removeEventListener(type: string, fn: (ev: MiniEvent) => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  dispatchEvent(ev: MiniEvent): boolean {
    ev.target = this;
    let cur: MiniEl | null = this;
    while (cur) {
      ev.currentTarget = cur;
      const fns = cur.listeners.get(ev.type);
      if (fns) {
        for (const fn of Array.from(fns)) fn(ev);
      }
      if (!ev.bubbles) break;
      cur = cur.parentElement;
    }
    return !ev.defaultPrevented;
  }
  click(): void {
    if (this.disabled) return;
    this.dispatchEvent(new MiniEvent('click', { bubbles: true }));
  }
  matches(selector: string): boolean {
    for (const part of selector.split(',').map((s) => s.trim())) {
      if (this.matchesSingle(part)) return true;
    }
    return false;
  }
  private matchesSingle(sel: string): boolean {
    const attrMatch = sel.match(/^([a-z0-9_-]*)\[([a-z0-9_-]+)(?:="([^"]*)")?\]$/i);
    if (attrMatch) {
      const [, tag, attr, val] = attrMatch;
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      const got = this.getAttribute(attr);
      if (got === null) return false;
      return val === undefined ? true : got === val;
    }
    if (sel.startsWith('#')) return this.id === sel.slice(1);
    if (sel.startsWith('.')) return this.classList.contains(sel.slice(1));
    return this.tagName === sel.toUpperCase();
  }
  closest(selector: string): MiniEl | null {
    let cur: MiniEl | null = this;
    while (cur) {
      if (cur.matches(selector)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
  querySelectorAll(selector: string): MiniEl[] {
    const out: MiniEl[] = [];
    const walk = (node: MiniEl) => {
      for (const child of node.childNodes) {
        if (child.matches(selector)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector: string): MiniEl | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

function installMiniDom(): { readonly body: MiniEl; readonly restore: () => void } {
  const prevDoc = globalThis.document;
  const body = new MiniEl('body');
  const doc = {
    body,
    createElement: (tag: string) => new MiniEl(tag),
  };
  (globalThis as unknown as { document: unknown }).document = doc;
  return {
    body,
    restore: () => {
      (globalThis as unknown as { document: unknown }).document = prevDoc;
    },
  };
}

function makeAllUnlockedProfile(overrides?: Partial<V2ProfileState>): V2ProfileState {
  const base = createFreshV2Profile();
  return {
    ...base,
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
    unlockedFamilies: ['core', 'heavy_kit', 'hangar_kit', 'counter_kit'],
    blueprints: Object.keys(V2_EQUIPMENT_DEFS)
      .filter((k) => k.endsWith('.common'))
      .map((k) => k.split('.')[1] as V2EquipmentKind),
    tutorialCompleted: true,
    deepestLayerReached: 6,
    totalRuns: 3,
    ...overrides,
  };
}

let restoreDom: (() => void) | null = null;
afterEach(() => {
  restoreDom?.();
  restoreDom = null;
});

describe('R2-M6B D04: Recovery Beacons, Emergency Tow, Depth Appreciation & Restrained Healing', () => {
  it('places deterministic Recovery Beacons on Layer 3 & Layer 5 with dual incoming edges across 100 seeds', () => {
    const contracts = ['transport_std', 'rescue_std', 'survey_std', 'bounty_std', 'derelict_std', 'free_salvage'];
    for (let seed = 1; seed <= 100; seed += 1) {
      const tplId = contracts[seed % contracts.length];
      const gen = generateV2StarGraph({
        runId: `bcn_${seed}`,
        contractTemplateId: tplId,
        primaryArchetype: 'laser',
        unlockedFamilies: ['core', 'heavy_kit', 'hangar_kit', 'counter_kit'],
        streams: createV2RngStreams(seed * 97 + 13),
        allowImproved: true,
      });

      const l3Beacons = [gen.graph.nodes.L3A, gen.graph.nodes.L3B].filter((n) => n?.isBeacon);
      const l5Beacons = [gen.graph.nodes.L5A, gen.graph.nodes.L5B].filter((n) => n?.isBeacon);
      expect(l3Beacons.length).toBeGreaterThanOrEqual(1);
      expect(l5Beacons.length).toBeGreaterThanOrEqual(1);

      // Both lanes at L2 reach L3 Beacon; both lanes at L4 reach L5 Beacon
      const l3Ids = new Set(l3Beacons.map((b) => b.nodeId));
      const l5Ids = new Set(l5Beacons.map((b) => b.nodeId));
      expect(gen.graph.nodes.L2A.nextNodeIds.some((id) => l3Ids.has(id))).toBe(true);
      expect(gen.graph.nodes.L2B.nextNodeIds.some((id) => l3Ids.has(id))).toBe(true);
      expect(gen.graph.nodes.L4A.nextNodeIds.some((id) => l5Ids.has(id))).toBe(true);
      expect(gen.graph.nodes.L4B.nextNodeIds.some((id) => l5Ids.has(id))).toBe(true);

      const inv = verifyV2GraphInvariants(
        gen.graph,
        {
          contractId: `c_${seed}`,
          templateId: tplId,
          type: tplId === 'free_salvage' ? 'free' : (tplId.split('_')[0] as 'transport'),
          tier: 'standard',
          name: tplId,
          rewardCredits: 70,
          markedNodeIds: gen.markedNodeIds,
          requiredCompletions: tplId === 'survey_std' ? 2 : tplId === 'free_salvage' ? 0 : 1,
          completedNodeIds: [],
          missionItemCount: 0,
          surveyFuelCost: tplId === 'survey_std' ? 1 : 0,
          status: 'active',
          rewardClaimed: false,
        },
        'laser'
      );
      expect(inv.ok, `seed ${seed} violations: ${inv.violations.join('; ')}`).toBe(true);
    }

    // Tutorial & Showcase beacons
    const tut = createV2TutorialRun('tut_bcn');
    expect(tut.graph.nodes.L4A.isBeacon).toBe(true);
    const sc = createV2ShowcaseRun('trial_heavy', 'sc_bcn');
    expect(sc.graph.nodes.L3A.isBeacon).toBe(true);
    expect(sc.graph.nodes.L4B.isBeacon).toBe(true);
  });

  it('enforces 3-state safe return, blocks non-beacon free return, allows zero-fuel stranded tow, and closes abandon loophole', () => {
    const profile = makeAllUnlockedProfile();
    const launch = launchV2Expedition({
      profile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: buildFreeFallbackPrepareSlots('cannon_skiff', profile.blueprints),
      seed: 6101,
    });
    expect(launch.ok && launch.run).toBeTruthy();
    const run = launch.run!;

    // L0 staging is free beacon
    expect(getV2SafeReturnStatus(run).mode).toBe('beacon_free');
    expect(initiateV2SafeReturnFromMap(run).ok).toBe(true);

    // Non-beacon L1 node rejects free return & ARRANGE safe_return, succeeds on Emergency Tow
    const nonBeaconNode = Object.values(run.graph.nodes).find((n) => n.layer === 1 && !n.isBeacon)!;
    const atNonBeacon: V2RunState = {
      ...run,
      currentNodeId: nonBeaconNode.nodeId,
      visitedNodeIds: [nonBeaconNode.nodeId],
      phase: 'MAP',
      fuel: 5,
    };
    const statusNonBeacon = getV2SafeReturnStatus(atNonBeacon);
    expect(statusNonBeacon.mode).toBe('emergency_tow');
    expect(statusNonBeacon.isFreeBeacon).toBe(false);
    expect(statusNonBeacon.towPenaltyRate).toBe(0.35);

    expect(initiateV2SafeReturnFromMap(atNonBeacon).ok).toBe(false);
    expect(finishV2ArrangeAndProceed({ ...atNonBeacon, phase: 'ARRANGE' }, 'safe_return').ok).toBe(false);

    const towed = initiateV2EmergencyTowReturn(atNonBeacon);
    expect(towed.ok).toBe(true);
    expect(towed.run.phase).toBe('SETTLEMENT');
    expect(towed.run.emergencyTowUsed).toBe(true);
    expect(towed.run.returnMode).toBe('emergency_tow');

    // Stranded (0 fuel, 0 credits) on non-beacon -> stranded_tow, ALWAYS returns cleanly (zero softlock!)
    const strandedRun: V2RunState = { ...atNonBeacon, fuel: 0, wallet: 0 };
    const statusStranded = getV2SafeReturnStatus(strandedRun);
    expect(statusStranded.mode).toBe('stranded_tow');
    expect(statusStranded.isStranded).toBe(true);
    const strandedTow = initiateV2EmergencyTowReturn(strandedRun);
    expect(strandedTow.ok).toBe(true);
    expect(strandedTow.run.emergencyTowUsed).toBe(true);
    expect(strandedTow.run.returnMode).toBe('stranded_tow');

    // Beacon node L3 succeeds on free return
    const l3Beacon = Object.values(run.graph.nodes).find((n) => n.layer === 3 && n.isBeacon)!;
    const atBeacon: V2RunState = {
      ...run,
      currentNodeId: l3Beacon.nodeId,
      visitedNodeIds: [nonBeaconNode.nodeId, l3Beacon.nodeId],
      phase: 'MAP',
    };
    expect(getV2SafeReturnStatus(atBeacon).mode).toBe('beacon_free');
    const freeRet = initiateV2SafeReturnFromMap(atBeacon);
    expect(freeRet.ok).toBe(true);
    expect(freeRet.run.emergencyTowUsed).toBe(false);
    expect(freeRet.run.returnMode).toBe('beacon_free');

    // Abandon loophole closed: abandoning non-beacon wreck sets emergencyTowUsed: true & clears staging!
    const nonBeaconWreck = Object.values(run.graph.nodes).find(
      (n) => n.type === 'wreck' && !n.isBeacon && n.layer < 6
    )!;
    const stagedLoot = createV2CargoInstance({
      instanceId: 'ab_staged_1',
      defId: 'cargo.data_box',
      origin: 'loot',
      acquiredDepth: nonBeaconWreck.layer,
      location: 'staging',
    });
    const abandoned = abandonV2EventAndReturn({
      ...run,
      currentNodeId: nonBeaconWreck.nodeId,
      visitedNodeIds: [nonBeaconWreck.nodeId],
      phase: 'ENCOUNTER',
      bay: addV2ItemToStaging(run.bay, stagedLoot, 0),
    });
    expect(abandoned.ok).toBe(true);
    expect(abandoned.run.emergencyTowUsed).toBe(true);
    expect(abandoned.run.bay.staging).toHaveLength(0);
  });

  it('computes 20% defeat floor, -35% emergency tow fee (excluding unspent stipend), depth cargo appreciation & restrained heals', () => {
    expect(V2_DEFEAT_SALVAGE_FLOOR_RATE).toBe(0.2);
    expect(V2_EMERGENCY_TOW_RETENTION_RATE).toBe(0.65);

    const profile = makeAllUnlockedProfile({
      facilityTiers: {
        workbench: 1,
        contract_hub: 1,
        drydock: 2,
        research_lab: 1,
        display: 1,
        stargate_relay: 3, // 50¤ starting stipend!
      },
    });
    const launch = launchV2Expedition({
      profile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: [],
      seed: 6102,
    });
    const run = launch.run!;
    expect(run.startingStipendCredits).toBe(50);

    const l1Cargo = createV2CargoInstance({
      instanceId: 'dep_cg_1',
      defId: 'cargo.old_engine', // 32¤ at L1
      origin: 'loot',
      acquiredDepth: 1,
      location: 'bay',
    });
    const ownedEq = createV2EquipmentInstance({
      instanceId: 'dep_own_1',
      kind: 'laser',
      quality: 'common',
      origin: 'owned',
      acquiredDepth: 0,
      location: 'bay',
    });

    // Pure appreciation formula monotonic by depth
    const appL1 = computeV2CargoDepthAppreciation(l1Cargo, 1);
    const appL3 = computeV2CargoDepthAppreciation(l1Cargo, 3);
    const appL5 = computeV2CargoDepthAppreciation(l1Cargo, 5);
    const appL6 = computeV2CargoDepthAppreciation(l1Cargo, 6);
    expect(appL1.bonusCredits).toBe(0);
    expect(appL3.bonusCredits).toBeGreaterThan(0);
    expect(appL5.bonusCredits).toBeGreaterThan(appL3.bonusCredits);
    expect(appL6.bonusCredits).toBeGreaterThan(appL5.bonusCredits);
    // Owned equipment gets 0 depth appreciation
    expect(computeV2CargoDepthAppreciation(ownedEq, 6).bonusCredits).toBe(0);

    // Beacon L5 return includes depth appreciation; unspent 50¤ stipend is excluded
    const l5Beacon = Object.values(run.graph.nodes).find((n) => n.layer === 5 && n.isBeacon)!;
    const beaconRun: V2RunState = {
      ...run,
      wallet: 70, // 50 unspent stipend + 20 real earned
      salvagePartsEarned: 20,
      currentNodeId: l5Beacon.nodeId,
      visitedNodeIds: ['L1A', 'L2A', 'L3A', 'L4A', l5Beacon.nodeId],
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
      emergencyTowUsed: false,
      bay: {
        ...createEmptyV2Bay('cannon_skiff'),
        placed: [
          { item: l1Cargo, x: 0, y: 0, rotation: 0 },
          { item: ownedEq, x: 2, y: 0, rotation: 0 },
        ],
      },
    };
    const beaconSum = calculateV2Settlement(beaconRun, profile);
    expect(beaconSum.walletCredits).toBe(20);
    expect(beaconSum.depthAppreciationCredits).toBe(appL5.bonusCredits);
    expect(beaconSum.finalCreditsEarned).toBe(20 + 32 + appL5.bonusCredits);
    expect(beaconSum.storedToWarehouseItems).toHaveLength(1);

    // Emergency Tow at L5: 0 depth appreciation, 0 bonus objective, -35% tow fee, stipend excluded BEFORE 0.65, owned gear still storable!
    const towRun: V2RunState = {
      ...beaconRun,
      emergencyTowUsed: true,
      returnMode: 'emergency_tow',
      bonusObjective: { id: 'bonus_high_hp', label: 'test', completed: true, rewardCredits: 30 },
    };
    const towSum = calculateV2Settlement(towRun, profile);
    expect(towSum.depthAppreciationCredits).toBe(0);
    expect(towSum.bonusObjectiveCredits).toBe(0);
    expect(towSum.walletCredits).toBe(20); // Unspent 50¤ stipend still excluded!
    expect(towSum.finalCreditsEarned).toBe(Math.floor((20 + 32) * 0.65)); // 33
    expect(towSum.emergencyTowFeeCredits).toBe(52 - 33);
    expect(towSum.runSalvagePartsEarned).toBe(Math.floor(20 * 0.65)); // 13
    expect(towSum.storedToWarehouseItems).toHaveLength(1); // Owned gear safe!

    // Defeat: 20% floor on credits & parts
    const defeatSum = calculateV2Settlement(
      { ...beaconRun, settlementReason: 'defeat', hp: 0 },
      profile
    );
    expect(defeatSum.finalCreditsEarned).toBe(Math.floor((20 + 32 + ownedEq.fixedValue) * 0.2));
    expect(defeatSum.runSalvagePartsEarned).toBe(Math.floor(20 * 0.2));

    // Restrained healing checks: all V3 events heal <= 8 HP, formal merchant repair = 18¤ / 8 HP, formal multi-cut reactor = 5 HP
    for (const evt of V3_EVENT_CATALOG) {
      for (const opt of evt.options) {
        if (opt.rewardHp !== undefined) {
          expect(opt.rewardHp).toBeLessThanOrEqual(8);
        }
      }
    }
    const merchNode = Object.values(run.graph.nodes).find((n) => n.type === 'merchant' && n.merchant)!;
    expect(merchNode.merchant!.repairPrice).toBe(18);
    expect(merchNode.merchant!.repairAmount).toBe(8);
    const wrkNode = Object.values(run.graph.nodes).find((n) => n.type === 'wreck' && n.wreck)!;
    const builtWrk = buildActiveWreckStateForNode(run, wrkNode, profile).wreck;
    expect(builtWrk.hotspots.find((h) => h.spotId === 'reactor')!.reactorRepairGain).toBe(5);
  });
});

describe('R2-M6B D05: Multi-Cut Wreck (3-5 Compartments) & Deterministic Structural Collapse', () => {
  it('generates 3 spots on L1-L2, 4 spots (+vault) on L3-L4, and 4-5 spots (+aux_bay) on L5-L6 with deterministic collapse protection', () => {
    const profile = makeAllUnlockedProfile({
      hullTuning: {},
      factionRep: { starport_guild: 0, deep_institute: 0, free_salvagers: 0 },
    });

    let sawL1Count3 = false;
    let sawL3Count4 = false;
    let sawL5Count5 = false;

    for (let seed = 7001; seed <= 7030; seed += 1) {
      const launch = launchV2Expedition({
        profile,
        contractTemplateId: 'free_salvage',
        shipId: 'cannon_skiff',
        crewId: 'engineer',
        primaryArchetype: 'laser',
        slots: buildFreeFallbackPrepareSlots('cannon_skiff', profile.blueprints),
        seed,
      });
      const run = launch.run!;
      for (const node of Object.values(run.graph.nodes)) {
        if (node.type !== 'wreck' || !node.wreck) continue;
        const wreck = buildActiveWreckStateForNode(run, node, profile).wreck;
        if (node.layer <= 2) {
          expect(wreck.hotspots.length).toBe(3);
          sawL1Count3 = true;
        } else if (node.layer <= 4) {
          expect(wreck.hotspots.length).toBe(4);
          expect(wreck.hotspots.some((h) => h.spotId === 'vault')).toBe(true);
          sawL3Count4 = true;
        } else {
          expect(wreck.hotspots.length).toBeGreaterThanOrEqual(4);
          expect(wreck.hotspots.length).toBeLessThanOrEqual(5);
          if (wreck.hotspots.length === 5) {
            expect(wreck.hotspots.some((h) => h.spotId === 'aux_bay')).toBe(true);
            sawL5Count5 = true;
          }
        }
      }
      if (sawL1Count3 && sawL3Count4 && sawL5Count5) break;
    }
    expect(sawL1Count3).toBe(true);
    expect(sawL3Count4).toBe(true);
    expect(sawL5Count5).toBe(true);

    // Deterministic Structural Collapse on stability -> 0: forfeits ONLY wreckLootInstanceIds, keeps placed gear & mission items, HP >= 1, extractable!
    const launch = launchV2Expedition({
      profile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: buildFreeFallbackPrepareSlots('cannon_skiff', profile.blueprints),
      seed: 7101,
    });
    const run = launch.run!;
    const wreckNode = Object.values(run.graph.nodes).find((n) => n.layer === 1 && n.type === 'wreck')!;
    const built = buildActiveWreckStateForNode(run, wreckNode, profile).wreck;
    expect(built.maxStability).toBe(100);

    // Disable ambush so we isolate pure structural collapse across 3 cuts (100 -> 60 -> 25 -> 0)
    const noAmbushWreck = {
      ...built,
      hotspots: built.hotspots.map((h) => ({ ...h, riskAmbush: false })),
    };
    const missionInStaging = createV2CargoInstance({
      instanceId: 'pre_existing_mission',
      defId: 'mission.black_box',
      origin: 'mission',
      acquiredDepth: 1,
      location: 'staging',
      missionBinding: run.contract.contractId,
    });
    const atWreck: V2RunState = {
      ...run,
      currentNodeId: wreckNode.nodeId,
      visitedNodeIds: [wreckNode.nodeId],
      phase: 'ENCOUNTER',
      hp: 25,
      fuel: 8,
      bay: addV2ItemToStaging(run.bay, missionInStaging, 0),
      activeWreck: noAmbushWreck,
    };
    const placedBefore = atWreck.bay.placed.length;

    // Cut 1: SAFE (stability 100 -> 60, collapseRiskPct = 0)
    expect(evaluateWreckHotspotCut(atWreck, noAmbushWreck, 'armory').collapseRiskPct).toBe(0);
    const c1 = cutV2WreckHotspot(atWreck, 'armory', profile.unlockedFamilies, undefined, profile);
    expect(c1.ok).toBe(true);
    expect(c1.collapsed).toBe(false);
    expect(c1.run.activeWreck!.stability).toBe(60);

    // Cut 2: force stability to 25 (with stabilizer active -> 0% collapse!)
    const withStab: V2RunState = {
      ...c1.run,
      activeWreck: { ...c1.run.activeWreck!, stabilizerActive: true },
    };
    expect(evaluateWreckHotspotCut(withStab, withStab.activeWreck!, 'cargo').collapseRiskPct).toBe(0);
    const c2 = cutV2WreckHotspot(withStab, 'cargo', profile.unlockedFamilies, undefined, profile);
    expect(c2.ok).toBe(true);
    expect(c2.collapsed).toBe(false);
    expect(c2.run.activeWreck!.stability).toBe(25);
    expect(c2.run.activeWreck!.wreckLootInstanceIds!.length).toBeGreaterThanOrEqual(2);

    // Cut 3 on reactor: nextStability = 25 - 25 = 0 -> willGuaranteedCollapse = true!
    const eval3 = evaluateWreckHotspotCut(c2.run, c2.run.activeWreck!, 'reactor');
    expect(eval3.canCut).toBe(true);
    expect(eval3.collapseRiskPct).toBe(100);
    expect(eval3.willGuaranteedCollapse).toBe(true);

    const c3 = cutV2WreckHotspot(c2.run, 'reactor', profile.unlockedFamilies, 'fuel', profile);
    expect(c3.ok).toBe(true);
    expect(c3.collapsed).toBe(true);
    expect(c3.run.activeWreck!.collapsed).toBe(true);
    expect(c3.run.hp).toBeGreaterThanOrEqual(1); // Never lethal!
    // Placed ship gear & pre-existing mission item preserved, while wreckLootInstanceIds were forfeited!
    expect(c3.run.bay.placed.length).toBe(placedBefore);
    expect(c3.run.bay.staging.some((s) => s.item.instanceId === 'pre_existing_mission')).toBe(true);
    expect(c3.run.bay.staging.length).toBe(1);

    // Persists & reloads cleanly mid-collapse
    const storage = new MemoryStorage();
    const save = { ...createFreshV2SaveData(), profile, activeRun: c3.run };
    expect(validateV2SaveDataDetailed(save).ok).toBe(true);
    expect(persistV2SaveData(storage, save).ok).toBe(true);
    const loaded = loadV2SaveData(storage);
    expect(loaded.status).toBe('loaded');
    if (loaded.status === 'loaded') {
      expect(loaded.data.activeRun!.activeWreck!.collapsed).toBe(true);
    }

    // Extraction remains 100% playable after collapse
    const ext = extractV2Wreck(c3.run);
    expect(ext.ok).toBe(true);
  });
});

describe('R2-M6B D06: Dynamic Spatial Conflict Detector & 2-Stage Calibrator', () => {
  it('separates genuine packing conflicts from fragmentation and calibrates non-collectible conflict bundles', () => {
    // Fragmented bay (12 cells free on 16-cell ship) -> NOT a spatial conflict!
    const eq1 = createV2EquipmentInstance({
      instanceId: 'd06_l1',
      kind: 'laser',
      quality: 'common',
      origin: 'loan',
      acquiredDepth: 0,
      location: 'bay',
    });
    const incoming2x2 = createV2CargoInstance({
      instanceId: 'd06_in_1',
      defId: 'cargo.old_engine',
      origin: 'loot',
      acquiredDepth: 2,
      location: 'staging',
    });
    const roomyBay: V2CargoBayState = {
      shipId: 'cannon_skiff',
      placed: [{ item: eq1, x: 1, y: 1, rotation: 0 }],
      staging: [{ item: incoming2x2, rotation: 0 }],
      discardedThisArrange: [],
    };
    expect(detectV2BaySpatialConflict(roomyBay).hasConflict).toBe(false);

    // Packed bay (14 cells occupied) + 2x2 incoming (4 cells -> 18 > 16) -> GENUINE conflict!
    const tightBay: V2CargoBayState = {
      shipId: 'cannon_skiff',
      placed: [
        { item: createV2CargoInstance({ instanceId: 'p1', defId: 'cargo.old_engine', origin: 'loot', acquiredDepth: 1, location: 'bay' }), x: 0, y: 0, rotation: 0 },
        { item: createV2CargoInstance({ instanceId: 'p2', defId: 'cargo.old_engine', origin: 'loot', acquiredDepth: 1, location: 'bay' }), x: 2, y: 0, rotation: 0 },
        { item: createV2CargoInstance({ instanceId: 'p3', defId: 'cargo.old_engine', origin: 'loot', acquiredDepth: 1, location: 'bay' }), x: 0, y: 2, rotation: 0 },
        { item: createV2CargoInstance({ instanceId: 'p4', defId: 'cargo.alloy_bar', origin: 'loot', acquiredDepth: 1, location: 'bay' }), x: 2, y: 2, rotation: 0 },
      ],
      staging: [{ item: incoming2x2, rotation: 0 }],
      discardedThisArrange: [],
    };
    const tightRes = detectV2BaySpatialConflict(tightBay);
    expect(tightRes.hasConflict).toBe(true);
    expect(tightRes.allFitTogether).toBe(false);
    expect(tightRes.feasibleSingleDiscardIds.length).toBeGreaterThanOrEqual(1);

    // composeConflictCargoBundle produces non-collectible cargo ONLY and resolves true conflict on L3
    const streams = createV2RngStreams(8080);
    const res = withV2Stream(streams, 'events', (rng) =>
      composeConflictCargoBundle({
        shipId: 'cannon_skiff',
        placedItems: tightBay.placed.slice(0, 3), // 12 cells used, 4 free
        layer: 3,
        sectorPriceMult: 1,
        maxItems: 3,
        minItems: 2,
        forceConflict: true,
        rng,
        idPrefix: 'd06_test',
      })
    ).value;
    expect(res.triggersConflict).toBe(true);
    for (const item of res.items) {
      expect(V2_NON_COLLECTIBLE_CARGO_DEF_IDS).toContain(item.definitionId);
      expect(V2_CARGO_DEFS[item.definitionId].isCollectible).toBe(false);
    }
  });
});

describe('R2-M6B D07: 3-Equipment Rewards, All 10 Synergy Rules & Run-1 3-Pick-1 Family Unlock', () => {
  it('generates 3 distinct equipment options with repairAmount: 0, rejects legacy cargo/repair on formal runs, and protects relics on skip', () => {
    const profile = makeAllUnlockedProfile();
    const launch = launchV2Expedition({
      profile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: buildFreeFallbackPrepareSlots('cannon_skiff', profile.blueprints),
      seed: 9101,
    });
    const run = launch.run!;
    const l1Combat = Object.values(run.graph.nodes).find((n) => n.layer === 1 && n.combat)!;
    const relicCombat = {
      ...l1Combat,
      hasRelicSignal: true,
      relicSignalDefId: 'cargo.ancient_navigator',
    };

    const { bundle } = generateV2CombatRewardBundle(
      run,
      relicCombat,
      profile.unlockedFamilies,
      ['laser', 'laser']
    );
    expect(bundle.repairAmount).toBe(0);
    expect(bundle.equipmentOptions).toHaveLength(3);
    const kinds = bundle.equipmentOptions!.map((e) => e.definitionId.split('.')[1]);
    expect(new Set(kinds).size).toBe(3);
    expect(kinds[0]).not.toBe('laser'); // L1-L3 anti-repeat respected!
    expect(bundle.bonusLootItems?.some((b) => b.definitionId === 'cargo.ancient_navigator')).toBe(true);
    expect(bundle.cargoOption.definitionId).toBe('cargo.ancient_navigator');

    const rewardRun: V2RunState = {
      ...run,
      currentNodeId: l1Combat.nodeId,
      visitedNodeIds: [l1Combat.nodeId],
      phase: 'REWARD',
      hp: 15,
      pendingReward: bundle,
    };

    // Rejects legacy 'cargo' and 'repair' on formal 3.1.0 bundles!
    expect(pickV2CombatReward(rewardRun, 'cargo', profile.unlockedFamilies).ok).toBe(false);
    expect(pickV2CombatReward(rewardRun, 'repair', profile.unlockedFamilies).ok).toBe(false);

    // Zero-heal skip stages 0 equipment, heals 0 HP, and STILL preserves guaranteed relic!
    const skipped = pickV2CombatReward(rewardRun, 'skip', profile.unlockedFamilies);
    expect(skipped.ok).toBe(true);
    expect(skipped.run.hp).toBe(15);
    expect(skipped.run.bay.staging.some((s) => s.item.definitionId === 'cargo.ancient_navigator')).toBe(true);
    expect(skipped.run.bay.staging.filter((s) => s.item.category === 'equipment')).toHaveLength(0);

    // Picking equipment_1 stages option 1 + bonus relic
    const picked1 = pickV2CombatReward(rewardRun, 'equipment_1', profile.unlockedFamilies);
    expect(picked1.ok).toBe(true);
    expect(
      picked1.run.bay.staging.some(
        (s) => s.item.instanceId === bundle.equipmentOptions![1].instanceId
      )
    ).toBe(true);
    expect(
      picked1.run.bay.staging.some((s) => s.item.definitionId === 'cargo.ancient_navigator')
    ).toBe(true);
  });

  it('evaluates ALL 10 V2SynergyTypeId rules accurately including D03 battery capacity warning & cross-category pairs', () => {
    const mkEq = (id: string, kind: V2EquipmentKind, quality: 'common' | 'improved' = 'common') =>
      createV2EquipmentInstance({
        instanceId: id,
        kind,
        quality,
        origin: 'loan',
        acquiredDepth: 0,
        location: 'bay',
      });
    const mkCg = (id: string, defId: string) =>
      createV2CargoInstance({
        instanceId: id,
        defId,
        origin: 'loot',
        acquiredDepth: 1,
        location: 'bay',
      });

    const cases: ReadonlyArray<{
      readonly synergyId: (typeof V2_SYNERGY_ORDER)[number];
      readonly bay: V2CargoBayState;
      readonly rewardDefId: string;
    }> = [
      {
        synergyId: 'battery_laser',
        bay: { ...createEmptyV2Bay('cannon_skiff'), placed: [{ item: mkEq('l1', 'laser'), x: 0, y: 0, rotation: 0 }] },
        rewardDefId: 'equipment.battery.common',
      },
      {
        synergyId: 'coolant_heavy',
        bay: { ...createEmptyV2Bay('cannon_skiff'), placed: [{ item: mkCg('c1', 'cargo.coolant_tank'), x: 0, y: 0, rotation: 0 }] },
        rewardDefId: 'equipment.heavy.common',
      },
      {
        synergyId: 'capacitor_heavy',
        bay: { ...createEmptyV2Bay('cannon_skiff'), placed: [{ item: mkEq('h1', 'heavy'), x: 0, y: 0, rotation: 0 }] },
        rewardDefId: 'equipment.capacitor.common',
      },
      {
        synergyId: 'relay_hangar',
        bay: { ...createEmptyV2Bay('cannon_skiff'), placed: [{ item: mkEq('hg1', 'hangar'), x: 0, y: 0, rotation: 0 }] },
        rewardDefId: 'equipment.relay.common',
      },
      {
        synergyId: 'shield_counter',
        bay: { ...createEmptyV2Bay('cannon_skiff'), placed: [{ item: mkEq('s1', 'shield'), x: 0, y: 0, rotation: 0 }] },
        rewardDefId: 'equipment.counter.common',
      },
      {
        synergyId: 'coolant_vent_heavy',
        bay: { ...createEmptyV2Bay('cannon_skiff'), placed: [{ item: mkEq('h1', 'heavy'), x: 0, y: 0, rotation: 0 }] },
        rewardDefId: 'equipment.coolant_vent.common',
      },
      {
        synergyId: 'coolant_vent_salvo',
        bay: { ...createEmptyV2Bay('cannon_skiff'), placed: [{ item: mkEq('sv1', 'salvo_pod'), x: 0, y: 0, rotation: 0 }] },
        rewardDefId: 'equipment.coolant_vent.common',
      },
      {
        synergyId: 'support_salvo',
        bay: { ...createEmptyV2Bay('cannon_skiff'), placed: [{ item: mkEq('sv1', 'salvo_pod'), x: 0, y: 0, rotation: 0 }] },
        rewardDefId: 'equipment.capacitor.common',
      },
      {
        synergyId: 'overdrive_weapon',
        bay: { ...createEmptyV2Bay('cannon_skiff'), placed: [{ item: mkEq('l1', 'laser'), x: 0, y: 0, rotation: 0 }] },
        rewardDefId: 'equipment.overdrive_core.common',
      },
      {
        synergyId: 'cargo_amp_cargo',
        bay: { ...createEmptyV2Bay('cannon_skiff'), placed: [{ item: mkCg('cg1', 'cargo.old_engine'), x: 0, y: 0, rotation: 0 }] },
        rewardDefId: 'equipment.cargo_amp.common',
      },
    ];

    const covered = new Set<string>();
    for (const tc of cases) {
      const ev = evaluateV2RewardSynergies(tc.bay, tc.rewardDefId);
      expect(ev.hasSynergy).toBe(true);
      expect(ev.matches.some((m) => m.synergyId === tc.synergyId)).toBe(true);
      covered.add(tc.synergyId);
    }
    expect(covered.size).toBe(V2_SYNERGY_ORDER.length);

    // D03 battery capacity warning: common battery already supplying 1 adjacent laser -> another laser triggers batteryCappedWarning!
    const fullBatBay: V2CargoBayState = {
      ...createEmptyV2Bay('cannon_skiff'),
      placed: [
        { item: mkEq('l1', 'laser'), x: 0, y: 0, rotation: 0 },
        { item: mkEq('b1', 'battery', 'common'), x: 1, y: 0, rotation: 0 },
      ],
    };
    const cappedEval = evaluateV2RewardSynergies(fullBatBay, 'equipment.laser.common');
    expect(cappedEval.hasSynergy).toBe(true);
    expect(cappedEval.matches[0].batteryCappedWarning).toBe(true);
  });

  it('supports Run-1 3-pick-1 family unlock in Settlement AND reload-safe deferred choice on Base + 2-pick-1 / final auto-unlock', () => {
    const fresh = createFreshV2Profile();
    expect(getLockedUnlockableFamilies(fresh)).toEqual(['heavy_kit', 'hangar_kit', 'counter_kit']);

    // Path A: Immediate pick during Run-1 Settlement
    const launch1 = launchV2Expedition({
      profile: fresh,
      contractTemplateId: 'transport_std',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: buildFreeFallbackPrepareSlots('cannon_skiff', fresh.blueprints),
      seed: 9201,
    });
    const run1: V2RunState = {
      ...launch1.run!,
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
    };
    const sum1 = calculateV2Settlement(run1, launch1.profile);
    expect(sum1.pendingFamilyUnlockChoices).toEqual(['heavy_kit', 'hangar_kit', 'counter_kit']);

    const pickedInSettle = applyV2Settlement(launch1.profile, run1, {}, { chosenFamily: 'hangar_kit' });
    expect(pickedInSettle.ok).toBe(true);
    expect(pickedInSettle.profile.unlockedFamilies).toContain('hangar_kit');
    expect(pickedInSettle.profile.blueprints).toContain('relay');
    expect(pickedInSettle.profile.pendingGiftQueue.some((g) => g.definitionId === 'equipment.hangar.common')).toBe(true);
    expect(pickedInSettle.profile.pendingFamilyUnlockChoices).toBeUndefined();

    // Path B: Deferred pick persists across save/load round-trip and claims cleanly on Base!
    const deferred = applyV2Settlement(launch1.profile, run1, {});
    expect(deferred.ok).toBe(true);
    expect(deferred.profile.unlockedFamilies).toEqual(['core']);
    expect(deferred.profile.pendingFamilyUnlockChoices).toEqual([
      'heavy_kit',
      'hangar_kit',
      'counter_kit',
    ]);

    const storage = new MemoryStorage();
    const save = { ...createFreshV2SaveData(), profile: deferred.profile, activeRun: null };
    expect(validateV2SaveDataDetailed(save).ok).toBe(true);
    expect(persistV2SaveData(storage, save).ok).toBe(true);
    const reloaded = loadV2SaveData(storage);
    expect(reloaded.status).toBe('loaded');
    if (reloaded.status !== 'loaded') return;
    expect(reloaded.data.profile.pendingFamilyUnlockChoices).toEqual([
      'heavy_kit',
      'hangar_kit',
      'counter_kit',
    ]);

    // Choose counter_kit from Base; duplicate claim rejected!
    const claimed = choosePendingV2FamilyUnlock(reloaded.data.profile, 'counter_kit', 'base_pick_1');
    expect(claimed.ok).toBe(true);
    expect(claimed.profile.unlockedFamilies).toContain('counter_kit');
    expect(claimed.profile.blueprints).toContain('flak');
    expect(
      claimed.profile.pendingGiftQueue.some((g) => g.definitionId === 'equipment.counter.common')
    ).toBe(true);
    expect(claimed.profile.pendingFamilyUnlockChoices).toBeUndefined();
    expect(choosePendingV2FamilyUnlock(claimed.profile, 'heavy_kit').ok).toBe(false);

    // Direct helper rejects already-unlocked family
    expect(unlockV2EquipmentFamily(claimed.profile, 'counter_kit', 'dup').ok).toBe(false);
    expect(V2_CONTRACT_FAMILY_UNLOCK_ORDER).toHaveLength(3);
  });

  it('migrates legacy 3.0.0 active run cleanly by backfilling Recovery Beacons while preserving legacy pendingReward', () => {
    const profile = makeAllUnlockedProfile();
    const launch = launchV2Expedition({
      profile,
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: buildFreeFallbackPrepareSlots('cannon_skiff', profile.blueprints),
      seed: 9301,
    });
    const run = launch.run!;
    // Strip isBeacon from all nodes to emulate a '3.0.0' save
    const legacyNodes = Object.fromEntries(
      Object.entries(run.graph.nodes).map(([k, n]) => {
        const copy = { ...n } as Record<string, unknown>;
        delete copy.isBeacon;
        return [k, copy];
      })
    );
    const rawV3_0 = {
      ...createFreshV2SaveData(),
      rulesVersion: V3_0_RULES_VERSION,
      profile,
      activeRun: {
        ...run,
        rulesVersion: V3_0_RULES_VERSION,
        graph: { ...run.graph, nodes: legacyNodes },
      },
    };
    const migrated = migrateV3_0ToV3_1SaveData(rawV3_0);
    expect(migrated.ok).toBe(true);
    const mRun = migrated.data!.activeRun!;
    expect(Object.values(mRun.graph.nodes).some((n) => n.layer === 3 && n.isBeacon)).toBe(true);
    expect(Object.values(mRun.graph.nodes).some((n) => n.layer === 5 && n.isBeacon)).toBe(true);
  });
});

describe('R2-M6B UI Views: MapPhaseView, RewardPhaseView, SettlementPhaseView (0-button S09 radiogroup) & BasePhaseView', () => {
  it('renders Beacon badges, in-place btn-safe-return, 3-eq synergy reward cards, 0-button Settlement family radiogroup, and Base fallback card', () => {
    const dom = installMiniDom();
    restoreDom = dom.restore;

    const freshProfile = createFreshV2Profile();
    const launch = launchV2Expedition({
      profile: makeAllUnlockedProfile(),
      contractTemplateId: 'free_salvage',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: buildFreeFallbackPrepareSlots('cannon_skiff', freshProfile.blueprints),
      seed: 9401,
    });
    const run = launch.run!;

    // 1. MapPhaseView: beacon badge + in-place btn-safe-return identity across beacon_free -> emergency_tow -> stranded_tow
    const mapHost = new MiniEl('div');
    dom.body.appendChild(mapHost);
    const mapView = new MapPhaseView();
    const mapActions = {
      onToggleMobileMap: vi.fn(),
      onSelectNode: vi.fn(),
      onJumpNode: vi.fn(),
      onSafeReturn: vi.fn(),
      onAbortContract: vi.fn(),
    };
    mapView.mount(mapHost as unknown as HTMLElement);
    const l2Node = run.graph.nodes.L2A;
    const l3BeaconId = [run.graph.nodes.L3A, run.graph.nodes.L3B].find((n) => n.isBeacon)!.nodeId;
    mapView.update(
      {
        run: { ...run, currentNodeId: l2Node.nodeId, visitedNodeIds: ['L1A', l2Node.nodeId], phase: 'MAP', fuel: 5 },
        readOnly: false,
        selectedMapNodeId: l3BeaconId,
        isCompactViewport: false,
        mobileMapShowFull: false,
        pureAutoCombat: false,
      },
      mapActions
    );
    const safeBtn = mapHost.querySelector('[data-testid="btn-safe-return"]')!;
    expect(safeBtn).not.toBeNull();
    expect(safeBtn.dataset.returnMode).toBe('emergency_tow');
    expect(safeBtn.textContent).toContain('紧急拖航返航');
    // Destination card HTML contains beacon-badge testid
    expect(mapHost.querySelector(`[data-testid="map-node-${l3BeaconId}"]`)!.innerHTML).toContain(
      `beacon-badge-${l3BeaconId}`
    );

    // Stranded (0 fuel) preserves === button identity!
    mapView.update(
      {
        run: { ...run, currentNodeId: l2Node.nodeId, visitedNodeIds: ['L1A', l2Node.nodeId], phase: 'MAP', fuel: 0 },
        readOnly: false,
        selectedMapNodeId: l3BeaconId,
        isCompactViewport: false,
        mobileMapShowFull: false,
        pureAutoCombat: false,
      },
      mapActions
    );
    expect(mapHost.querySelector('[data-testid="btn-safe-return"]')).toBe(safeBtn);
    expect(safeBtn.dataset.returnMode).toBe('stranded_tow');
    expect(safeBtn.disabled).toBe(false);
    mapView.unmount();

    // 2. RewardPhaseView: 3 equipment choices + synergy badges + zero-heal skip + DOM === preservation
    const combatNode = Object.values(run.graph.nodes).find((n) => n.layer === 1 && n.combat)!;
    const started = startV2CombatAtCurrentNode(
      { ...run, currentNodeId: combatNode.nodeId, phase: 'ENCOUNTER' },
      'weakest',
      { pureAutoCombat: true }
    );
    const completed = completeV2CombatAtCurrentNode(started.run, ['core', 'heavy_kit', 'hangar_kit', 'counter_kit']);
    const rewHost = new MiniEl('div');
    dom.body.appendChild(rewHost);
    const rewView = new RewardPhaseView();
    const rewActions = { onPickReward: vi.fn() };
    rewView.mount(rewHost as unknown as HTMLElement);
    rewView.update({ run: completed.run, readOnly: false }, rewActions);

    const c0 = rewHost.querySelector('[data-testid="reward-choice-0"]')!;
    const c1 = rewHost.querySelector('[data-testid="reward-choice-1"]')!;
    const c2 = rewHost.querySelector('[data-testid="reward-choice-2"]')!;
    const skip = rewHost.querySelector('[data-testid="btn-reward-skip"]')!;
    expect(c0 && c1 && c2 && skip).toBeTruthy();
    expect(rewHost.querySelector('[data-testid="reward-synergy-badge-0"]')).not.toBeNull();
    expect(rewHost.querySelector('[data-pick-reward="repair"]')).toBeNull();

    // Re-update preserves === identity
    rewView.update({ run: completed.run, readOnly: false }, rewActions);
    expect(rewHost.querySelector('[data-testid="reward-choice-0"]')).toBe(c0);
    c1.click();
    expect(rewActions.onPickReward).toHaveBeenCalledWith('equipment_1');
    skip.click();
    expect(rewActions.onPickReward).toHaveBeenCalledWith('skip');
    rewView.unmount();

    // 3. SettlementPhaseView: Run-1 3-pick-1 family unlock renders with ZERO <button> elements (S09 compliant!)
    const settleRun: V2RunState = {
      ...run,
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
      bay: { ...createEmptyV2Bay('cannon_skiff'), placed: [] },
    };
    const settleSummary = calculateV2Settlement(settleRun, freshProfile);
    expect(settleSummary.pendingFamilyUnlockChoices).toEqual(['heavy_kit', 'hangar_kit', 'counter_kit']);

    const settleHost = new MiniEl('div');
    dom.body.appendChild(settleHost);
    const settleView = new SettlementPhaseView();
    const onSelectFamilyUnlock = vi.fn();
    settleView.mount(settleHost as unknown as HTMLElement);
    settleView.update(
      {
        run: settleRun,
        profile: freshProfile,
        summary: settleSummary,
        nextGoal: { title: 't', detail: 'd', actionKind: 'facilities', ready: false },
        readOnly: false,
        selectedFamilyUnlock: null,
      },
      {
        onChangeDisposition: vi.fn(),
        onShowcaseRetry: vi.fn(),
        onShowcaseToBase: vi.fn(),
        onConfirmSettlement: vi.fn(),
        onSelectFamilyUnlock,
      }
    );
    const famSection = settleHost.querySelector('[data-testid="settlement-family-unlock"]')!;
    expect(famSection).not.toBeNull();
    // STRICT S09 invariant: 0 <button> elements inside family unlock selector!
    expect(famSection.querySelectorAll('button')).toHaveLength(0);
    const hangarOpt = settleHost.querySelector('[data-testid="family-unlock-option-hangar_kit"]')!;
    expect(hangarOpt).not.toBeNull();
    hangarOpt.click();
    expect(onSelectFamilyUnlock).toHaveBeenCalledWith('hangar_kit');
    // Confirm CTA stays enabled even before selecting!
    expect(settleHost.querySelector('[data-testid="btn-confirm-settlement"]')!.disabled).toBe(false);
    settleView.unmount();

    // 4. BasePhaseView: shows base-family-unlock-card ONLY when pendingFamilyUnlockChoices non-empty & preserves 3 root children
    const baseHost = new MiniEl('div');
    dom.body.appendChild(baseHost);
    const baseView = new BasePhaseView();
    const onChoosePendingFamilyUnlock = vi.fn();
    const baseActions = {
      onSkipDocking: vi.fn(),
      onCloseDocking: vi.fn(),
      onStartTutorial: vi.fn(),
      onLaunchRecommended: vi.fn(),
      onOpenContracts: vi.fn(),
      onToggleCampaignBanner: vi.fn(),
      onOpenCampaign: vi.fn(),
      onOpenGoal: vi.fn(),
      onOpenWarehouse: vi.fn(),
      onOpenFacilities: vi.fn(),
      onOpenRelics: vi.fn(),
      onOpenCodex: vi.fn(),
      onOpenCareer: vi.fn(),
      onChoosePendingFamilyUnlock,
    };
    const pendingProfile: V2ProfileState = {
      ...freshProfile,
      tutorialCompleted: true,
      pendingFamilyUnlockChoices: ['heavy_kit', 'hangar_kit', 'counter_kit'] as readonly V2UnlockFamilyId[],
    };
    baseView.mount(baseHost as unknown as HTMLElement);
    baseView.update(
      {
        profile: pendingProfile,
        readOnly: false,
        nextGoal: { title: 't', detail: 'd', actionKind: 'facilities', ready: false },
        recommendedContractId: 'rescue_std',
        activeDockingNotice: null,
        campaignBannerCollapsed: false,
        campaignObjective: getActiveCampaignObjective(pendingProfile),
      },
      baseActions
    );
    const baseRoot = baseHost.querySelector('[data-testid="base-screen"]')!;
    expect(baseRoot.children).toHaveLength(3); // Strict PR #3 3-direct-children contract!
    expect(baseHost.querySelector('[data-testid="base-family-unlock-card"]')).not.toBeNull();
    const pickHeavyBtn = baseHost.querySelector('[data-testid="btn-pick-family-heavy_kit"]')!;
    pickHeavyBtn.click();
    expect(onChoosePendingFamilyUnlock).toHaveBeenCalledWith('heavy_kit');

    // Detached cleanly once pendingFamilyUnlockChoices is cleared
    baseView.update(
      {
        profile: { ...pendingProfile, pendingFamilyUnlockChoices: undefined },
        readOnly: false,
        nextGoal: { title: 't', detail: 'd', actionKind: 'facilities', ready: false },
        recommendedContractId: 'rescue_std',
        activeDockingNotice: null,
        campaignBannerCollapsed: false,
        campaignObjective: getActiveCampaignObjective(pendingProfile),
      },
      baseActions
    );
    expect(baseHost.querySelector('[data-testid="base-family-unlock-card"]')).toBeNull();
    baseView.unmount();
  });
});
