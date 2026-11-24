import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal PhaserHost mock ONLY for V2AppController DOM integration tests.
// All real domain modules, screen views, CargoGridV2, PreCombatAutoEngageController,
// and V2AppController run unmocked!
// ---------------------------------------------------------------------------
const phaserHostSpies = vi.hoisted(() => ({
  showV2Stage: vi.fn(),
  updateV2ShipVisualSpec: vi.fn(),
  setCombatPaused: vi.fn(),
  resize: vi.fn(),
  destroy: vi.fn(),
  updateCombatSettings: vi.fn(),
  showV2BaseScene: vi.fn(),
  playV2CombatPlayback: vi.fn(),
  triggerV2WreckCutFx: vi.fn(),
}));

vi.mock('../src/scenes/PhaserHost', () => {
  class MockPhaserHost {
    constructor(_host: HTMLElement) {}
    onBuildingClick(_cb: (id: string) => void): void {}
    onBerthClick(_cb: () => void): void {}
    onAssetLoadError(_cb: (keys: string[]) => void): void {}
    getActiveSceneKey(): string {
      return 'V2CombatScene';
    }
    showV2BaseScene(...args: unknown[]): void {
      phaserHostSpies.showV2BaseScene(...args);
    }
    showV2Stage(...args: unknown[]): void {
      phaserHostSpies.showV2Stage(...args);
    }
    updateV2ShipVisualSpec(...args: unknown[]): void {
      phaserHostSpies.updateV2ShipVisualSpec(...args);
    }
    setCombatPaused(...args: unknown[]): void {
      phaserHostSpies.setCombatPaused(...args);
    }
    updateCombatSettings(...args: unknown[]): void {
      phaserHostSpies.updateCombatSettings(...args);
    }
    playV2CombatPlayback(...args: unknown[]): void {
      phaserHostSpies.playV2CombatPlayback(...args);
    }
    triggerV2WreckCutFx(...args: unknown[]): void {
      phaserHostSpies.triggerV2WreckCutFx(...args);
    }
    skipV2CombatPlayback(): void {}
    playBaseReturnDocking(_opts: unknown): void {}
    skipBaseReturnDocking(): void {}
    resize(): void {
      phaserHostSpies.resize();
    }
    destroy(): void {
      phaserHostSpies.destroy();
    }
  }
  return { PhaserHost: MockPhaserHost };
});

import { V2_REGULAR_ENCOUNTER_KINDS, buildEncounterUnits } from '../src/v2/data/enemies';
import { V3_BESTIARY_NOTES } from '../src/v2/data/lore';
import { V2_TUTORIAL_HINTS, createV2TutorialRun } from '../src/v2/data/tutorialV2';
import { getActiveCampaignObjective } from '../src/v2/domain/campaign';
import * as combatV2 from '../src/v2/domain/combatV2';
import {
  canPerformSurveyAtCurrentNode,
  createV2ContractInstance,
  getAvailableContractBoard,
  pickRecommendedV2ContractId,
} from '../src/v2/domain/contracts';
import {
  applyV2EngineerSwap,
  buyV2MerchantOffer,
  cutV2WreckHotspot,
  extractV2Wreck,
  finishV2ArrangeAndProceed,
  finishV2MerchantVisit,
  pickV2CombatReward,
  resolvePostEncounterPhase,
  resolveV2AnomalyChoice,
  resolveV2DistressChoice,
  resolveV2EventOption,
  resolveV2WreckChoice,
  selectV2MapNode,
  sellV2ItemToMerchant,
  shouldAutoSkipArrange,
} from '../src/v2/domain/encounter';
import {
  discardV2Item,
  placeV2FromStaging,
  removeV2ItemById,
  verifyV2SpatialConflict,
} from '../src/v2/domain/inventoryV2';
import { createV2CargoInstance, createV2EquipmentInstance, getAnyV2ItemDef } from '../src/v2/domain/itemCatalog';
import { buildFreeFallbackPrepareSlots, launchV2Expedition } from '../src/v2/domain/loadout';
import {
  createFreshV2SaveData,
  persistV2SaveData,
  validateV2SaveDataDetailed,
} from '../src/v2/domain/persistenceV2';
import { applyV2Settlement } from '../src/v2/domain/settlementV2';
import {
  classifyV2CombatThreat,
  computeV2ItemSacrificePreview,
  summarizeV2MissionSacrificeOptions,
} from '../src/v2/domain/tacticalDelta';
import type { V2MapNode, V2RunState } from '../src/v2/domain/types';
import { CargoGridV2Component } from '../src/v2/ui/CargoGridV2';
import { ArrangePhaseView } from '../src/v2/ui/screens/ArrangeView';
import { renderBaseHeroView } from '../src/v2/ui/screens/BaseView';
import {
  PRE_COMBAT_AUTO_ENGAGE_MS,
  PreCombatAutoEngageController,
  renderCombatPreView,
} from '../src/v2/ui/screens/CombatView';
import { MapPhaseView } from '../src/v2/ui/screens/MapView';
import { V2AppController } from '../src/v2/ui/V2AppController';

// ---------------------------------------------------------------------------
// Compact Self-Contained Fake DOM (supports dynamic fake timers & visibility)
// ---------------------------------------------------------------------------

class MiniEvent {
  readonly type: string;
  readonly bubbles: boolean;
  readonly key: string;
  readonly button: number;
  readonly pointerType: string;
  readonly clientX: number;
  readonly clientY: number;
  target: MiniNode | null = null;
  currentTarget: MiniNode | null = null;
  defaultPrevented = false;
  private stopped = false;

  constructor(
    type: string,
    init: {
      bubbles?: boolean;
      key?: string;
      button?: number;
      pointerType?: string;
      clientX?: number;
      clientY?: number;
    } = {}
  ) {
    this.type = type;
    this.bubbles = init.bubbles ?? false;
    this.key = init.key ?? '';
    this.button = init.button ?? 0;
    this.pointerType = init.pointerType ?? 'mouse';
    this.clientX = init.clientX ?? 0;
    this.clientY = init.clientY ?? 0;
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }
  stopPropagation(): void {
    this.stopped = true;
  }
  isStopped(): boolean {
    return this.stopped;
  }
}

class MiniClassList {
  constructor(private readonly el: MiniElement) {}
  private tokens(): string[] {
    const raw = this.el.getAttribute('class') ?? '';
    return raw.trim() ? raw.trim().split(/\s+/) : [];
  }
  private save(list: string[]): void {
    this.el.setAttribute('class', list.join(' '));
  }
  contains(token: string): boolean {
    return this.tokens().includes(token);
  }
  add(...names: string[]): void {
    const cur = this.tokens();
    for (const n of names) {
      if (n && !cur.includes(n)) cur.push(n);
    }
    this.save(cur);
  }
  remove(...names: string[]): void {
    const rm = new Set(names);
    this.save(this.tokens().filter((t) => !rm.has(t)));
  }
  toggle(name: string, force?: boolean): boolean {
    const has = this.contains(name);
    const shouldHave = force !== undefined ? force : !has;
    if (shouldHave && !has) this.add(name);
    else if (!shouldHave && has) this.remove(name);
    return shouldHave;
  }
}

function camelToKebab(prop: string): string {
  return prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function kebabToCamel(attr: string): string {
  return attr.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

class MiniNode {
  parentNode: MiniNode | null = null;
  readonly childNodes: MiniNode[] = [];
  protected readonly listeners = new Map<string, Set<(ev: MiniEvent) => void>>();

  get parentElement(): MiniElement | null {
    return this.parentNode instanceof MiniElement ? this.parentNode : null;
  }
  get children(): MiniElement[] {
    return this.childNodes.filter((c): c is MiniElement => c instanceof MiniElement);
  }
  appendChild<T extends MiniNode>(child: T): T {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  insertBefore<T extends MiniNode>(child: T, ref: MiniNode | null): T {
    if (child.parentNode) child.parentNode.removeChild(child);
    if (!ref) return this.appendChild(child);
    const idx = this.childNodes.indexOf(ref);
    if (idx < 0) return this.appendChild(child);
    child.parentNode = this;
    this.childNodes.splice(idx, 0, child);
    return child;
  }
  removeChild<T extends MiniNode>(child: T): T {
    const idx = this.childNodes.indexOf(child);
    if (idx >= 0) {
      this.childNodes.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }
  remove(): void {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
  contains(other: MiniNode | null): boolean {
    let cur: MiniNode | null = other;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentNode;
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
  getListenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
  dispatchEvent(ev: MiniEvent): boolean {
    if (!ev.target) ev.target = this;
    let cur: MiniNode | null = this;
    while (cur) {
      ev.currentTarget = cur;
      const set = cur.listeners.get(ev.type);
      if (set) {
        for (const fn of [...set]) fn(ev);
      }
      if (!ev.bubbles || ev.isStopped()) break;
      cur = cur.parentNode;
    }
    return !ev.defaultPrevented;
  }
}

class MiniTextNode extends MiniNode {
  constructor(public data: string) {
    super();
  }
}

function matchesSimpleSelector(el: MiniElement, sel: string): boolean {
  const tokens = sel.match(/(\[[^\]]+\]|#[A-Za-z0-9_-]+|\.[A-Za-z0-9_-]+|[A-Za-z0-9_-]+)/g);
  if (!tokens) return false;
  for (const tok of tokens) {
    if (tok.startsWith('[')) {
      const inner = tok.slice(1, -1).trim();
      const m = inner.match(/^([A-Za-z0-9_:-]+)\s*(\^=|\$=|\*=|=)\s*(?:"([^"]*)"|'([^']*)'|([^\]]+))$/);
      if (m) {
        const [, attr, op, dq, sq, bare] = m;
        const expected = dq ?? sq ?? bare ?? '';
        const actual = el.getAttribute(attr);
        if (actual === null) return false;
        if (op === '=' && actual !== expected) return false;
        if (op === '^=' && !actual.startsWith(expected)) return false;
        if (op === '$=' && !actual.endsWith(expected)) return false;
        if (op === '*=' && !actual.includes(expected)) return false;
      } else if (!el.hasAttribute(inner)) {
        return false;
      }
    } else if (tok.startsWith('#')) {
      if (el.id !== tok.slice(1)) return false;
    } else if (tok.startsWith('.')) {
      if (!el.classList.contains(tok.slice(1))) return false;
    } else if (el.tagName !== tok.toUpperCase()) {
      return false;
    }
  }
  return true;
}

function matchesSelectorList(el: MiniElement, selector: string): boolean {
  for (const raw of selector.split(',')) {
    const chain = raw.trim().replace(/\s*>\s*/g, ' > ');
    if (!chain) continue;
    const toks = chain.split(/\s+/);
    const parts: { sel: string; comb: ' ' | '>' | null }[] = [];
    let pend: ' ' | '>' | null = null;
    for (const t of toks) {
      if (t === '>') pend = '>';
      else {
        parts.push({ sel: t, comb: pend ?? (parts.length > 0 ? ' ' : null) });
        pend = null;
      }
    }
    if (parts.length === 0) continue;
    const walk = (node: MiniElement, idx: number): boolean => {
      if (!matchesSimpleSelector(node, parts[idx].sel)) return false;
      if (idx === 0) return true;
      const comb = parts[idx].comb;
      if (comb === '>') {
        const p = node.parentElement;
        return p ? walk(p, idx - 1) : false;
      }
      let p = node.parentElement;
      while (p) {
        if (walk(p, idx - 1)) return true;
        p = p.parentElement;
      }
      return false;
    };
    if (walk(el, parts.length - 1)) return true;
  }
  return false;
}

function parseMiniHtml(html: string, doc: MiniDocument, container: MiniElement): void {
  const stack: MiniElement[] = [container];
  const voidTags = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'path', 'line', 'rect', 'circle']);
  const tagRe = /<!--[\s\S]*?-->|<\/([A-Za-z][A-Za-z0-9:-]*)\s*>|<([A-Za-z][A-Za-z0-9:-]*)([^>]*?)(\/?)>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html)) !== null) {
    if (match.index > lastIndex) {
      const txt = html.slice(lastIndex, match.index);
      if (txt) stack[stack.length - 1].appendChild(new MiniTextNode(txt));
    }
    lastIndex = tagRe.lastIndex;
    if (match[0].startsWith('<!--')) continue;
    if (match[1]) {
      const closing = match[1].toUpperCase();
      for (let i = stack.length - 1; i >= 1; i--) {
        if (stack[i].tagName === closing) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const tagName = match[2];
    const rawAttrs = match[3] ?? '';
    const selfClosing = Boolean(match[4]) || voidTags.has(tagName.toLowerCase());
    const el = doc.createElement(tagName);
    const attrRe = /([A-Za-z_:][A-Za-z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(rawAttrs)) !== null) {
      el.setAttribute(am[1], am[2] ?? am[3] ?? am[4] ?? '');
    }
    stack[stack.length - 1].appendChild(el);
    if (!selfClosing) stack.push(el);
  }
  if (lastIndex < html.length) {
    const rest = html.slice(lastIndex);
    if (rest) stack[stack.length - 1].appendChild(new MiniTextNode(rest));
  }
}

class MiniElement extends MiniNode {
  readonly tagName: string;
  readonly ownerDocument: MiniDocument;
  private readonly attributes = new Map<string, string>();
  readonly style: Record<string, string> = {};
  readonly classList: MiniClassList;
  readonly dataset: Record<string, string | undefined>;
  scrollTop = 0;
  scrollLeft = 0;
  tabIndex = -1;
  inert = false;

  constructor(tagName: string, ownerDocument: MiniDocument) {
    super();
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.classList = new MiniClassList(this);
    this.dataset = new Proxy<Record<string, string | undefined>>(
      {},
      {
        get: (_t, prop) => {
          if (typeof prop !== 'string') return undefined;
          return this.attributes.get(`data-${camelToKebab(prop)}`);
        },
        set: (_t, prop, value) => {
          if (typeof prop === 'string') {
            if (value === undefined) this.attributes.delete(`data-${camelToKebab(prop)}`);
            else this.attributes.set(`data-${camelToKebab(prop)}`, String(value));
          }
          return true;
        },
        deleteProperty: (_t, prop) => {
          if (typeof prop === 'string') this.attributes.delete(`data-${camelToKebab(prop)}`);
          return true;
        },
        ownKeys: () =>
          [...this.attributes.keys()]
            .filter((k) => k.startsWith('data-'))
            .map((k) => kebabToCamel(k.slice(5))),
      }
    );
  }

  get id(): string {
    return this.attributes.get('id') ?? '';
  }
  set id(v: string) {
    this.setAttribute('id', v);
  }
  get className(): string {
    return this.attributes.get('class') ?? '';
  }
  set className(v: string) {
    this.setAttribute('class', v);
  }
  get type(): string {
    return this.attributes.get('type') ?? '';
  }
  set type(v: string) {
    this.setAttribute('type', v);
  }
  get title(): string {
    return this.attributes.get('title') ?? '';
  }
  set title(v: string) {
    this.setAttribute('title', v);
  }
  get disabled(): boolean {
    return this.attributes.has('disabled');
  }
  set disabled(v: boolean) {
    if (v) this.attributes.set('disabled', '');
    else this.attributes.delete('disabled');
  }
  setAttribute(name: string, value: string): void {
    const key = name.toLowerCase();
    this.attributes.set(key, String(value));
    if (key === 'style') {
      for (const part of String(value).split(';')) {
        const idx = part.indexOf(':');
        if (idx > 0) {
          this.style[kebabToCamel(part.slice(0, idx).trim())] = part.slice(idx + 1).trim();
        }
      }
    }
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name.toLowerCase()) ?? null;
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name.toLowerCase());
  }
  hasAttribute(name: string): boolean {
    return this.attributes.has(name.toLowerCase());
  }
  get textContent(): string {
    return this.childNodes
      .map((c) => (c instanceof MiniTextNode ? c.data : c instanceof MiniElement ? c.textContent : ''))
      .join('');
  }
  set textContent(val: string) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes.length = 0;
    if (val) this.appendChild(new MiniTextNode(String(val)));
  }
  get innerHTML(): string {
    return this.textContent;
  }
  set innerHTML(html: string) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes.length = 0;
    if (html) parseMiniHtml(html, this.ownerDocument, this);
  }
  querySelector(selector: string): MiniElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  querySelectorAll(selector: string): MiniElement[] {
    const out: MiniElement[] = [];
    const walk = (n: MiniNode): void => {
      for (const c of n.childNodes) {
        if (c instanceof MiniElement) {
          if (matchesSelectorList(c, selector)) out.push(c);
          walk(c);
        }
      }
    };
    walk(this);
    return out;
  }
  closest(selector: string): MiniElement | null {
    let cur: MiniElement | null = this;
    while (cur) {
      if (matchesSelectorList(cur, selector)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number; right: number; bottom: number } {
    return { left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320 };
  }
  click(): void {
    if (this.disabled) return;
    this.dispatchEvent(new MiniEvent('click', { bubbles: true }));
  }
  focus(): void {
    this.ownerDocument.activeElement = this;
  }
  setPointerCapture(_id: number): void {}
  releasePointerCapture(_id: number): void {}
}

class MiniStorage {
  private readonly store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }
}

class MiniDocument extends MiniNode {
  readonly body: MiniElement;
  activeElement: MiniElement | null = null;
  hidden = false;
  constructor() {
    super();
    this.body = new MiniElement('body', this);
    this.appendChild(this.body);
  }
  createElement(tag: string): MiniElement {
    return new MiniElement(tag, this);
  }
  createElementNS(_ns: string, tag: string): MiniElement {
    return new MiniElement(tag, this);
  }
  querySelector(sel: string): MiniElement | null {
    return this.body.querySelector(sel);
  }
  querySelectorAll(sel: string): MiniElement[] {
    return this.body.querySelectorAll(sel);
  }
}

class MiniWindow extends MiniNode {
  innerWidth = 1366;
  innerHeight = 768;
  devicePixelRatio = 1;
  location = { search: '' };
  readonly localStorage = new MiniStorage();
  readonly sessionStorage = new MiniStorage();
  readonly document: MiniDocument;
  __STARLINE_INSPECT__?: () => unknown;
  constructor(doc: MiniDocument) {
    super();
    this.document = doc;
  }
  setTimeout(fn: (...args: unknown[]) => void, ms?: number): ReturnType<typeof setTimeout> {
    return globalThis.setTimeout(fn, ms);
  }
  clearTimeout(id?: ReturnType<typeof setTimeout>): void {
    globalThis.clearTimeout(id);
  }
  setInterval(fn: (...args: unknown[]) => void, ms?: number): ReturnType<typeof setInterval> {
    return globalThis.setInterval(fn, ms);
  }
  clearInterval(id?: ReturnType<typeof setInterval>): void {
    globalThis.clearInterval(id);
  }
  requestAnimationFrame(_cb: () => void): number {
    return 1;
  }
  cancelAnimationFrame(_id: number): void {}
}

function installMiniDom(): { window: MiniWindow; document: MiniDocument; restore: () => void } {
  const g = globalThis as Record<string, unknown>;
  const prev = {
    window: g.window,
    document: g.document,
    localStorage: g.localStorage,
    sessionStorage: g.sessionStorage,
    HTMLElement: g.HTMLElement,
    HTMLButtonElement: g.HTMLButtonElement,
    Event: g.Event,
    MouseEvent: g.MouseEvent,
    KeyboardEvent: g.KeyboardEvent,
  };
  const doc = new MiniDocument();
  const win = new MiniWindow(doc);
  g.window = win;
  g.document = doc;
  g.localStorage = win.localStorage;
  g.sessionStorage = win.sessionStorage;
  g.HTMLElement = MiniElement;
  g.HTMLButtonElement = MiniElement;
  g.Event = MiniEvent;
  g.MouseEvent = MiniEvent;
  g.KeyboardEvent = MiniEvent;
  return {
    window: win,
    document: doc,
    restore: () => {
      g.window = prev.window;
      g.document = prev.document;
      g.localStorage = prev.localStorage;
      g.sessionStorage = prev.sessionStorage;
      g.HTMLElement = prev.HTMLElement;
      g.HTMLButtonElement = prev.HTMLButtonElement;
      g.Event = prev.Event;
      g.MouseEvent = prev.MouseEvent;
      g.KeyboardEvent = prev.KeyboardEvent;
    },
  };
}

function cellCenterPoint(cols: number, rows: number, cx: number, cy: number): { x: number; y: number } {
  const cellW = 320 / cols;
  const cellH = 320 / rows;
  return { x: cx * cellW + cellW * 0.5, y: cy * cellH + cellH * 0.5 };
}

function findFormalRunWithNodeType(
  nodeType: V2MapNode['type'],
  contractTemplateId = 'free_salvage',
  seedStart = 1000
): { run: V2RunState; node: V2MapNode } {
  const profile = createFreshV2SaveData().profile;
  const slots = buildFreeFallbackPrepareSlots('cannon_skiff', profile.blueprints, 6);
  for (let seed = seedStart; seed < seedStart + 80; seed++) {
    const res = launchV2Expedition({
      profile,
      contractTemplateId,
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots,
      trialBuildId: null,
      sectorId: 'near_orbit',
      seed,
    });
    if (!res.ok || !res.run) continue;
    const node = Object.values(res.run.graph.nodes).find(
      (n) => n.type === nodeType && n.nextNodeIds.length > 0
    );
    if (node) return { run: res.run, node };
  }
  throw new Error(`Could not find formal run with non-terminal ${nodeType}`);
}

// ===========================================================================
// M1A First-Voyage Gameplay & Flow Verification Suite (S01, S02, S04, S05, S10)
// ===========================================================================

describe('M1A First-Voyage Gameplay & Flow Suite (S01, S02, S04, S05, S10)', () => {
  let dom: ReturnType<typeof installMiniDom>;

  beforeEach(() => {
    dom = installMiniDom();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    dom.restore();
  });

  // -------------------------------------------------------------------------
  // S01 — First-Voyage Tutorial Rewrite
  // -------------------------------------------------------------------------
  describe('S01: 5-Minute First-Voyage Tutorial, 14HP Target, Penultimate Reactor & Base Focus', () => {
    it('launches in ARRANGE with battery in staging, 11/16 placed cells, engineerSwapAvailable=true, 4-layer graph, valid save & isolated RNG', () => {
      const tut = createV2TutorialRun('tut_s01_init');
      expect(tut.phase).toBe('ARRANGE');
      expect(tut.currentNodeId).toBeNull();
      expect(tut.engineerSwapAvailable).toBe(true);
      expect(tut.graph.maxLayers).toBe(4);
      expect(tut.graph.startNextNodeIds).toEqual(['L1A']);
      expect(tut.graph.guaranteedPathNodeIds).toEqual(['L1A', 'L2A', 'L3A', 'L4A']);

      // Battery is in staging (NOT pre-placed!)
      expect(tut.bay.staging).toHaveLength(1);
      expect(tut.bay.staging[0].item.definitionId).toBe('equipment.battery.common');
      expect(tut.bay.staging[0].item.origin).toBe('loan');
      expect(tut.bay.placed.some((p) => p.item.definitionId.includes('battery'))).toBe(false);
      expect(tut.bay.placed).toHaveLength(4);

      // Step-0 & Step-4 tutorial hints populated
      expect(V2_TUTORIAL_HINTS[0].arrangeHint.length).toBeGreaterThan(10);
      expect(V2_TUTORIAL_HINTS[4].encounterHint.length).toBeGreaterThan(10);

      // Passes strict V2/V3 save validation right at Step-1 ARRANGE launch
      const save = { ...createFreshV2SaveData(), activeRun: tut };
      expect(validateV2SaveDataDetailed(save).ok).toBe(true);

      // RNG isolation: creating tutorial does not perturb formal expedition RNG streams
      const profile = createFreshV2SaveData().profile;
      const slots = buildFreeFallbackPrepareSlots('cannon_skiff', profile.blueprints, 6);
      const formal1 = launchV2Expedition({
        profile,
        contractTemplateId: 'rescue_std',
        shipId: 'cannon_skiff',
        crewId: 'engineer',
        primaryArchetype: 'laser',
        slots,
        trialBuildId: null,
        sectorId: 'near_orbit',
        seed: 77777,
      });
      createV2TutorialRun('tut_rng_probe');
      const formal2 = launchV2Expedition({
        profile,
        contractTemplateId: 'rescue_std',
        shipId: 'cannon_skiff',
        crewId: 'engineer',
        primaryArchetype: 'laser',
        slots,
        trialBuildId: null,
        sectorId: 'near_orbit',
        seed: 77777,
      });
      expect(formal1.run!.rngStreams).toEqual(formal2.run!.rngStreams);
    });

    it('proves exact L1 patrol_tutorial 14HP combat math (wired 2R/26HP vs unwired 3R/24HP) while preserving standard patrol, regular roster & bestiary', () => {
      // Guardrails: V2_REGULAR_ENCOUNTER_KINDS stays exact 9, V3_BESTIARY_NOTES stays exact 13, standard patrol untouched!
      expect(V2_REGULAR_ENCOUNTER_KINDS).toHaveLength(9);
      expect(V2_REGULAR_ENCOUNTER_KINDS).not.toContain('patrol_tutorial');
      expect(V2_REGULAR_ENCOUNTER_KINDS).not.toContain('tutorial_raider');
      expect(Object.keys(V3_BESTIARY_NOTES)).toHaveLength(13);

      const stdPatrolL1 = buildEncounterUnits('patrol', 1, 'STD_L1');
      expect(stdPatrolL1).toHaveLength(1);
      expect(stdPatrolL1[0].maxHp).toBe(15);
      expect(stdPatrolL1[0].damagePerRound).toBe(2);

      const tut = createV2TutorialRun('tut_s01_l1');
      const l1 = tut.graph.nodes['L1A'];
      expect(l1.combat?.encounterKind).toBe('patrol_tutorial');
      expect(l1.combat?.units).toHaveLength(1);
      expect(l1.combat?.units[0].maxHp).toBe(14);
      expect(l1.combat?.units[0].damagePerRound).toBe(2);
      expect(l1.combat?.units[0].armor).toBe(0);

      const batId = tut.bay.staging[0].item.instanceId;

      // Wired: battery at (1,0) adjacent to laser at (0,0)-(0,1) -> 7 dmg/r -> 2 rounds, 26 HP!
      const wiredPlace = placeV2FromStaging(tut.bay, batId, 1, 0, 0);
      expect(wiredPlace.ok).toBe(true);
      const simWired = combatV2.simulateV2Combat({
        resultId: 'tut_wired',
        bay: wiredPlace.bay,
        startingHp: 30,
        maxHp: 30,
        units: l1.combat!.units,
        targetPolicy: 'weakest',
        sectorId: 'near_orbit',
        crewId: 'engineer',
      });
      expect(simWired.outcome).toBe('victory');
      expect(simWired.roundsCount).toBe(2);
      expect(simWired.finalPlayerHpAfterRepair).toBe(26);

      // Unwired: battery at (3,3) -> 5 dmg/r -> 3 rounds, 24 HP!
      const unwiredPlace = placeV2FromStaging(tut.bay, batId, 3, 3, 0);
      expect(unwiredPlace.ok).toBe(true);
      const simUnwired = combatV2.simulateV2Combat({
        resultId: 'tut_unwired',
        bay: unwiredPlace.bay,
        startingHp: 30,
        maxHp: 30,
        units: l1.combat!.units,
        targetPolicy: 'weakest',
        sectorId: 'near_orbit',
        crewId: 'engineer',
      });
      expect(simUnwired.outcome).toBe('victory');
      expect(simUnwired.roundsCount).toBe(3);
      expect(simUnwired.finalPlayerHpAfterRepair).toBe(24);

      // Discarded battery -> still winnable in 3 rounds, 24 HP (zero softlock)
      const discarded = discardV2Item(tut.bay, batId);
      expect(discarded.ok).toBe(true);
      const simNoBat = combatV2.simulateV2Combat({
        resultId: 'tut_nobat',
        bay: discarded.bay,
        startingHp: 30,
        maxHp: 30,
        units: l1.combat!.units,
        targetPolicy: 'weakest',
        sectorId: 'near_orbit',
        crewId: 'engineer',
      });
      expect(simNoBat.outcome).toBe('victory');
      expect(simNoBat.roundsCount).toBe(3);
      expect(simNoBat.finalPlayerHpAfterRepair).toBe(24);
    });

    it('runs L2 wreck clamp cut + Engineer Swap, L3 penultimate 2x3 Sealed Reactor conflict + live sacrifice preview, and L4 fork (L4A safe vs L4B ancient_navigator)', () => {
      let run = createV2TutorialRun('tut_s01_full');
      const batId = run.bay.staging[0].item.instanceId;

      // Step 1: wire battery at (1,0) and leave ARRANGE -> MAP
      const wired = placeV2FromStaging(run.bay, batId, 1, 0, 0);
      expect(wired.ok).toBe(true);
      run = { ...run, bay: wired.bay };
      const leave1 = finishV2ArrangeAndProceed(run, 'map');
      expect(leave1.ok).toBe(true);
      expect(leave1.run.phase).toBe('MAP');
      run = leave1.run;

      // Step 2: L1A combat -> pick repair -> auto-skips empty ARRANGE straight to MAP!
      const enterL1 = selectV2MapNode(run, 'L1A');
      expect(enterL1.ok).toBe(true);
      const startL1 = combatV2.startV2CombatAtCurrentNode(enterL1.run, 'weakest');
      expect(startL1.ok).toBe(true);
      const doneL1 = combatV2.completeV2CombatAtCurrentNode(startL1.run, ['core']);
      expect(doneL1.ok).toBe(true);
      expect(doneL1.run.phase).toBe('REWARD');
      const rewL1 = pickV2CombatReward(doneL1.run, 'repair', ['core']);
      expect(rewL1.ok).toBe(true);
      expect(rewL1.run.phase).toBe('MAP'); // S02 auto-skip!
      run = rewL1.run;

      // Step 3: L2A wreck clamp cut -> Armory triggers Lin Gong Engineer Swap!
      const enterL2 = selectV2MapNode(run, 'L2A');
      expect(enterL2.ok).toBe(true);
      const cutL2 = cutV2WreckHotspot(enterL2.run, 'armory', ['core']);
      expect(cutL2.ok).toBe(true);
      expect(cutL2.run.activeEngineerOffer).not.toBeNull();
      expect(cutL2.run.activeEngineerOffer!.used).toBe(false);
      expect(cutL2.run.activeEngineerOffer!.candidates.length).toBe(3);

      // Extract L2A -> enters ARRANGE; discard L2 shield to test clean L3A reactor baseline
      const extL2 = extractV2Wreck(cutL2.run);
      expect(extL2.ok).toBe(true);
      expect(extL2.run.phase).toBe('ARRANGE');
      const l2ShieldId = extL2.run.bay.staging[0].item.instanceId;
      const dropL2 = discardV2Item(extL2.run.bay, l2ShieldId);
      expect(dropL2.ok).toBe(true);
      const leaveL2 = finishV2ArrangeAndProceed({ ...extL2.run, bay: dropL2.bay }, 'map');
      expect(leaveL2.ok).toBe(true);
      expect(leaveL2.run.phase).toBe('MAP');
      run = leaveL2.run;

      // Step 4: L3A penultimate objective wreck (nextNodeIds: ['L4A', 'L4B'])
      expect(run.graph.nodes['L3A'].nextNodeIds).toEqual(['L4A', 'L4B']);
      expect(run.graph.nodes['L3A'].contractMarker).toBe(true);
      const enterL3 = selectV2MapNode(run, 'L3A');
      expect(enterL3.ok).toBe(true);

      // Even with 0 cuts, extractV2Wreck grants 2x3 Sealed Reactor BEFORE shouldAutoSkipArrange -> NEVER auto-skipped!
      const extL3 = extractV2Wreck(enterL3.run);
      expect(extL3.ok).toBe(true);
      expect(extL3.run.phase).toBe('ARRANGE');
      expect(
        extL3.run.bay.staging.some((s) => s.item.definitionId === 'mission.sealed_reactor')
      ).toBe(true);

      // Verify exact spatial conflict & sacrifice preview labels!
      const existingShapes = extL3.run.bay.placed.map((p) => ({
        id: p.item.instanceId,
        shapeId: getAnyV2ItemDef(p.item.definitionId)!.shapeId,
      }));
      const conflict = verifyV2SpatialConflict('cannon_skiff', existingShapes, '2x3');
      expect(conflict.allFitTogether).toBe(false);
      expect(conflict.feasibleSingleDiscardIds).toHaveLength(4);

      const laserId = `${run.runId}_tut_laser`;
      const engId = `${run.runId}_tut_eng`;
      const coolId = `${run.runId}_tut_cool`;
      expect(computeV2ItemSacrificePreview(extL3.run.bay, laserId)?.fullLabel).toBe('激光炮（火力 -5）');
      expect(computeV2ItemSacrificePreview(extL3.run.bay, coolId)?.fullLabel).toBe('冷却罐（-18¤）');
      expect(computeV2ItemSacrificePreview(extL3.run.bay, engId)?.fullLabel).toBe('旧引擎（-24¤）');

      const missionSummary = summarizeV2MissionSacrificeOptions(extL3.run.bay);
      expect(missionSummary).not.toBeNull();
      expect(missionSummary!.needsSpace).toBe(true);
      expect(missionSummary!.summaryText).toContain('将损失：');
      expect(missionSummary!.summaryText).toContain('激光炮（火力 -5）');
      expect(missionSummary!.summaryText).toContain('旧引擎（-24¤）');
      expect(missionSummary!.summaryText).toContain('冷却罐（-18¤）');

      // ArrangePhaseView displays persistent [data-testid="arrange-sacrifice-banner"]
      const arrangeHost = dom.document.createElement('div');
      dom.document.body.appendChild(arrangeHost);
      const arrangeView = new ArrangePhaseView();
      arrangeView.mount(arrangeHost as unknown as HTMLElement);
      arrangeView.update(
        { run: extL3.run, readOnly: false, sceneCollapsed: false },
        {
          onToggleShipPreview: vi.fn(),
          onEngineerSwap: vi.fn(),
          onSurveyScan: vi.fn(),
          onAbortContract: vi.fn(),
          onLeaveArrange: vi.fn(),
        }
      );
      const bannerEl = arrangeHost.querySelector('[data-testid="arrange-sacrifice-banner"]')!;
      expect(bannerEl).not.toBeNull();
      expect(bannerEl.textContent).toContain('激光炮（火力 -5）');
      arrangeView.unmount();

      // CargoGridV2 inspector renders live [data-testid="sacrifice-preview"] for both mission staging & placed laser
      const gridHost = dom.document.createElement('div');
      dom.document.body.appendChild(gridHost);
      const grid = new CargoGridV2Component(gridHost as unknown as HTMLElement, {
        onBayChange: vi.fn(),
      });
      grid.render(extL3.run.bay, true);
      const stagingSacrifice = gridHost.querySelector('[data-testid="sacrifice-preview"]');
      expect(stagingSacrifice).not.toBeNull();
      expect(stagingSacrifice!.textContent).toContain('激光炮（火力 -5）');
      // Select placed laser at (0,0)
      const boardEl = gridHost.querySelector('.v2-cargo-board')!;
      const laserPt = cellCenterPoint(4, 4, 0, 0);
      boardEl.dispatchEvent(
        new MiniEvent('pointerdown', { bubbles: true, clientX: laserPt.x, clientY: laserPt.y })
      );
      boardEl.dispatchEvent(
        new MiniEvent('pointerup', { bubbles: true, clientX: laserPt.x, clientY: laserPt.y })
      );
      const laserSacrifice = gridHost.querySelector('[data-testid="sacrifice-preview"]');
      expect(laserSacrifice).not.toBeNull();
      expect(laserSacrifice!.textContent).toContain('若舍弃，将损失：激光炮（火力 -5）');
      grid.destroy();

      // Branch A (keep Laser+Battery, discard old_engine -> fit 2x3 reactor at (2,0) -> leave to L4 Fork MAP!)
      const dropEng = discardV2Item(extL3.run.bay, engId);
      expect(dropEng.ok).toBe(true);
      const reactorId = dropEng.bay.staging.find(
        (s) => s.item.definitionId === 'mission.sealed_reactor'
      )!.item.instanceId;
      const placeReactor = placeV2FromStaging(dropEng.bay, reactorId, 2, 0, 0);
      expect(placeReactor.ok).toBe(true);
      const leaveL3 = finishV2ArrangeAndProceed({ ...extL3.run, bay: placeReactor.bay }, 'map');
      expect(leaveL3.ok).toBe(true);
      expect(leaveL3.run.phase).toBe('MAP');
      expect(leaveL3.run.currentNodeId).toBe('L3A');

      // Step 5A: L4A Safe Return Beacon settles cleanly directly to SETTLEMENT -> completes tutorial!
      const enterL4A = selectV2MapNode(leaveL3.run, 'L4A');
      expect(enterL4A.ok).toBe(true);
      const resolveL4A = resolveV2EventOption(enterL4A.run, 0, ['core']);
      expect(resolveL4A.ok).toBe(true);
      expect(resolveL4A.run.phase).toBe('SETTLEMENT');
      expect(resolveL4A.run.settlementReason).toBe('safe_return');
      const settled = applyV2Settlement(createFreshV2SaveData().profile, resolveL4A.run, {});
      expect(settled.ok).toBe(true);
      expect(settled.summary.contractCompleted).toBe(true);
      expect(settled.profile.tutorialCompleted).toBe(true);
      expect(settled.profile.buildings.workbench).toBe(true);

      // Step 5B: L4B Risk Branch (tutorial_raider 14HP/4dmg + guaranteed cargo.ancient_navigator)
      const l4bNode = leaveL3.run.graph.nodes['L4B'];
      expect(l4bNode.combat?.encounterKind).toBe('tutorial_raider');
      expect(l4bNode.hasRelicSignal).toBe(true);
      expect(l4bNode.relicSignalDefId).toBe('cargo.ancient_navigator');

      // With Laser+Battery kept -> 稳 (22 HP at 30 HP / 18 HP at 26 HP, 2 rounds)
      const simKeep30 = combatV2.simulateV2Combat({
        resultId: 'l4b_keep_30',
        bay: leaveL3.run.bay,
        startingHp: 30,
        maxHp: 30,
        units: l4bNode.combat!.units,
        targetPolicy: 'weakest',
        sectorId: 'near_orbit',
        crewId: 'engineer',
      });
      expect(simKeep30.outcome).toBe('victory');
      expect(simKeep30.roundsCount).toBe(2);
      expect(simKeep30.finalPlayerHpAfterRepair).toBe(22);
      expect(
        classifyV2CombatThreat(
          { outcome: simKeep30.outcome, playerFinalHp: simKeep30.finalPlayerHpAfterRepair },
          30
        ).label
      ).toBe('稳');

      // With Laser discarded -> 危险 (2 HP at 30 HP) / 致命 (0 HP defeat at 26 HP)!
      const bayNoLaser = removeV2ItemById(leaveL3.run.bay, laserId);
      const simDrop30 = combatV2.simulateV2Combat({
        resultId: 'l4b_drop_30',
        bay: bayNoLaser,
        startingHp: 30,
        maxHp: 30,
        units: l4bNode.combat!.units,
        targetPolicy: 'weakest',
        sectorId: 'near_orbit',
        crewId: 'engineer',
      });
      expect(
        classifyV2CombatThreat(
          { outcome: simDrop30.outcome, playerFinalHp: simDrop30.finalPlayerHpAfterRepair },
          30
        ).label
      ).toBe('危险');

      const simDrop26 = combatV2.simulateV2Combat({
        resultId: 'l4b_drop_26',
        bay: bayNoLaser,
        startingHp: 26,
        maxHp: 30,
        units: l4bNode.combat!.units,
        targetPolicy: 'weakest',
        sectorId: 'near_orbit',
        crewId: 'engineer',
      });
      expect(simDrop26.outcome).toBe('defeat');
      expect(
        classifyV2CombatThreat(
          { outcome: simDrop26.outcome, playerFinalHp: simDrop26.finalPlayerHpAfterRepair },
          30
        ).label
      ).toBe('致命');

      // Winning L4B guarantees cargo.ancient_navigator in REWARD
      const enterL4B = selectV2MapNode(leaveL3.run, 'L4B');
      expect(enterL4B.ok).toBe(true);
      const startL4B = combatV2.startV2CombatAtCurrentNode(enterL4B.run, 'weakest');
      expect(startL4B.ok).toBe(true);
      const doneL4B = combatV2.completeV2CombatAtCurrentNode(startL4B.run, ['core']);
      expect(doneL4B.ok).toBe(true);
      expect(doneL4B.run.pendingReward?.cargoOption.definitionId).toBe('cargo.ancient_navigator');
    });

    it('renders Step-0 Base focus when !tutorialCompleted without facility price clutter while keeping all 10 E2E anchors clickable', () => {
      const host = dom.document.createElement('div');
      dom.document.body.appendChild(host);
      const freshProfile = createFreshV2SaveData().profile;
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
      };

      renderBaseHeroView(
        host as unknown as HTMLElement,
        {
          profile: freshProfile,
          readOnly: false,
          nextGoal: {
            title: '首航目标：启动拆解工作台',
            detail: '完成首航教学带回密封反应堆，免费通电工作台并奖 +40¤',
            actionKind: 'facilities',
            ready: true,
          },
          recommendedContractId: 'rescue_std',
          activeDockingNotice: null,
          campaignBannerCollapsed: true,
          campaignObjective: getActiveCampaignObjective(freshProfile),
        },
        baseActions
      );

      const screen = host.querySelector('[data-testid="base-screen"]')!;
      expect(screen.classList.contains('is-tutorial-focus')).toBe(true);
      expect(screen.dataset.tutorialFocus).toBe('true');
      expect(host.querySelector('#v2-base-next-goal')).toBeNull();
      expect(host.querySelectorAll('.v2-dock-btn small.num')).toHaveLength(0);
      expect(screen.textContent).not.toContain('还差 100¤');

      // All 10 required E2E anchors remain mounted & clickable!
      const requiredAnchors = [
        'base-screen',
        'campaign-banner',
        'btn-toggle-campaign-banner',
        'btn-open-campaign',
        'btn-start-tutorial',
        'btn-open-contracts',
        'btn-open-warehouse',
        'btn-open-facilities',
        'btn-open-relics',
        'btn-open-codex',
        'btn-open-career',
      ];
      for (const tid of requiredAnchors) {
        expect(host.querySelector(`[data-testid="${tid}"]`)).not.toBeNull();
      }
      host.querySelector('[data-testid="btn-start-tutorial"]')!.click();
      expect(baseActions.onStartTutorial).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // S02 — Auto-Skip Empty Arrange & Editable Cargo Bay on MAP
  // -------------------------------------------------------------------------
  describe('S02: shouldAutoSkipArrange across all 7 post-encounter paths & editable MAP CargoGridV2', () => {
    it('evaluates shouldAutoSkipArrange truth table accurately', () => {
      const { run: baseFormal } = findFormalRunWithNodeType('wreck', 'free_salvage', 1001);
      const emptyMapRun: V2RunState = {
        ...baseFormal,
        bay: { ...baseFormal.bay, staging: [] },
        activeEngineerOffer: null,
      };
      expect(shouldAutoSkipArrange(emptyMapRun)).toBe(true);

      // Non-empty staging -> false
      const stagedItem = createV2CargoInstance({
        instanceId: 's02_staged_1',
        defId: 'cargo.data_box',
        origin: 'loot',
        acquiredDepth: 1,
        location: 'staging',
      });
      expect(
        shouldAutoSkipArrange({
          ...emptyMapRun,
          bay: { ...emptyMapRun.bay, staging: [{ item: stagedItem, rotation: 0 }] },
        })
      ).toBe(false);

      // Unused activeEngineerOffer -> false; used activeEngineerOffer -> true
      expect(
        shouldAutoSkipArrange({
          ...emptyMapRun,
          activeEngineerOffer: { targetInstanceId: 'eq_x', candidates: ['shield'], used: false },
        })
      ).toBe(false);
      expect(
        shouldAutoSkipArrange({
          ...emptyMapRun,
          activeEngineerOffer: { targetInstanceId: 'eq_x', candidates: ['shield'], used: true },
        })
      ).toBe(true);

      // Survey available at current resolved marked node -> false
      const firstNodeId = baseFormal.graph.startNextNodeIds[0];
      const surveyRun: V2RunState = {
        ...emptyMapRun,
        currentNodeId: firstNodeId,
        contract: createV2ContractInstance('survey_std', [firstNodeId], emptyMapRun.runId),
        graph: {
          ...emptyMapRun.graph,
          nodes: {
            ...emptyMapRun.graph.nodes,
            [firstNodeId]: { ...emptyMapRun.graph.nodes[firstNodeId], resolved: true, contractMarker: true },
          },
        },
      };
      expect(canPerformSurveyAtCurrentNode(surveyRun).canSurvey).toBe(true);
      expect(shouldAutoSkipArrange(surveyRun)).toBe(false);
    });

    it('enforces resolvePostEncounterPhase across all 7 resolution paths (non-terminal -> MAP, terminal -> SETTLEMENT, mission/ambush/offer -> ARRANGE)', () => {
      // 1 & 2. extractV2Wreck & resolveV2WreckChoice
      const { run: wreckBase, node: wreckNode } = findFormalRunWithNodeType('wreck', 'free_salvage', 1010);
      const inWreck: V2RunState = {
        ...wreckBase,
        phase: 'ENCOUNTER',
        currentNodeId: wreckNode.nodeId,
        visitedNodeIds: [wreckNode.nodeId],
        fuel: 6,
        hp: 20,
        bay: { ...wreckBase.bay, staging: [] },
        activeWreck: {
          nodeId: wreckNode.nodeId,
          stability: 100,
          maxStability: 100,
          cutsMade: 0,
          extracted: false,
          ambushTriggered: false,
          stabilizerActive: false,
          hotspots: [],
          stashedItems: [],
        },
      };
      expect(extractV2Wreck(inWreck).run.phase).toBe('MAP');
      expect(
        extractV2Wreck({
          ...inWreck,
          graph: {
            ...inWreck.graph,
            nodes: {
              ...inWreck.graph.nodes,
              [wreckNode.nodeId]: { ...wreckNode, nextNodeIds: [], layer: inWreck.graph.maxLayers },
            },
          },
        }).run.phase
      ).toBe('SETTLEMENT');
      // 0-cut extract on derelict marked node -> black_box granted FIRST -> ARRANGE!
      const derelictWreck: V2RunState = {
        ...inWreck,
        contract: createV2ContractInstance('derelict_std', [wreckNode.nodeId], inWreck.runId),
        graph: {
          ...inWreck.graph,
          nodes: {
            ...inWreck.graph.nodes,
            [wreckNode.nodeId]: { ...wreckNode, contractMarker: true },
          },
        },
      };
      const extDerelict = extractV2Wreck(derelictWreck);
      expect(extDerelict.run.phase).toBe('ARRANGE');
      expect(extDerelict.run.bay.staging.some((s) => s.item.definitionId === 'mission.black_box')).toBe(true);

      // resolveV2WreckChoice: reactor_fuel -> MAP; armory -> ARRANGE; terminal reactor -> SETTLEMENT
      expect(resolveV2WreckChoice(inWreck, 'reactor_fuel', ['core']).run.phase).toBe('MAP');
      expect(resolveV2WreckChoice(inWreck, 'armory', ['core']).run.phase).toBe('ARRANGE');
      expect(
        resolveV2WreckChoice(
          {
            ...inWreck,
            graph: {
              ...inWreck.graph,
              nodes: {
                ...inWreck.graph.nodes,
                [wreckNode.nodeId]: { ...wreckNode, nextNodeIds: [], layer: inWreck.graph.maxLayers },
              },
            },
          },
          'reactor_fuel',
          ['core']
        ).run.phase
      ).toBe('SETTLEMENT');

      // 3 & 4. resolveV2AnomalyChoice & resolveV2DistressChoice
      const { run: anomalyBase, node: anomalyNode } = findFormalRunWithNodeType('anomaly', 'free_salvage', 1020);
      const inAnomaly: V2RunState = {
        ...anomalyBase,
        phase: 'ENCOUNTER',
        currentNodeId: anomalyNode.nodeId,
        visitedNodeIds: [anomalyNode.nodeId],
        fuel: 8,
        hp: 24,
        bay: { ...anomalyBase.bay, staging: [] },
      };
      expect(resolveV2AnomalyChoice(inAnomaly, 'traverse').run.phase).toBe('ARRANGE');

      const { run: distressBase, node: distressNode } = findFormalRunWithNodeType('distress', 'free_salvage', 1030);
      const inDistress: V2RunState = {
        ...distressBase,
        phase: 'ENCOUNTER',
        currentNodeId: distressNode.nodeId,
        visitedNodeIds: [distressNode.nodeId],
        fuel: 8,
        hp: 18,
        bay: { ...distressBase.bay, staging: [] },
      };
      expect(resolveV2DistressChoice(inDistress, 'rescue_crew').run.phase).toBe('MAP');
      expect(resolveV2DistressChoice(inDistress, 'haul_cargo').run.phase).toBe('ARRANGE');
      // Distress rescue_crew on marked transport node -> Sealed Reactor granted FIRST -> ARRANGE!
      const markedDistress: V2RunState = {
        ...inDistress,
        contract: createV2ContractInstance('transport_std', [distressNode.nodeId], inDistress.runId),
        graph: {
          ...inDistress.graph,
          nodes: {
            ...inDistress.graph.nodes,
            [distressNode.nodeId]: { ...distressNode, contractMarker: true },
          },
        },
      };
      expect(resolveV2DistressChoice(markedDistress, 'rescue_crew').run.phase).toBe('ARRANGE');

      // 5. finishV2MerchantVisit (empty -> MAP; unused engineer offer -> ARRANGE; used swap -> MAP; resell expires offer -> MAP)
      const { run: shopBase, node: shopNode } = findFormalRunWithNodeType('merchant', 'free_salvage', 1040);
      const inShop: V2RunState = {
        ...shopBase,
        phase: 'SHOP',
        currentNodeId: shopNode.nodeId,
        visitedNodeIds: [shopNode.nodeId],
        wallet: 200,
        engineerSwapAvailable: true,
        bay: { ...shopBase.bay, staging: [] },
      };
      expect(finishV2MerchantVisit(inShop).run.phase).toBe('MAP');
      const offer = shopNode.merchant!.offers[0];
      const bought = buyV2MerchantOffer(inShop, offer.offerId, 'tx_s02_buy', ['core']);
      expect(bought.ok).toBe(true);
      expect(bought.run.activeEngineerOffer?.used).toBe(false);
      // Place bought item so staging is empty, keeping offer UNUSED -> still enters ARRANGE!
      const placedInShop = placeV2FromStaging(bought.run.bay, offer.item.instanceId, 2, 0, 0);
      if (placedInShop.ok) {
        expect(finishV2MerchantVisit({ ...bought.run, bay: placedInShop.bay }).run.phase).toBe('ARRANGE');
      }
      // Use engineer swap + discard swapped item -> offer.used === true & empty staging -> MAP!
      const swapped = applyV2EngineerSwap(bought.run, bought.run.activeEngineerOffer!.candidates[0]);
      expect(swapped.ok).toBe(true);
      const droppedSwap = discardV2Item(swapped.run.bay, swapped.run.bay.staging[0].item.instanceId);
      expect(finishV2MerchantVisit({ ...swapped.run, bay: droppedSwap.bay }).run.phase).toBe('MAP');
      // Sell bought item back to merchant -> expires dangling offer -> MAP!
      const resold = sellV2ItemToMerchant(bought.run, offer.item.instanceId, 'tx_s02_resell');
      expect(resold.ok).toBe(true);
      expect(resold.run.activeEngineerOffer?.used).toBe(true);
      expect(finishV2MerchantVisit(resold.run).run.phase).toBe('MAP');

      // 6. pickV2CombatReward (repair -> MAP; terminal -> SETTLEMENT; ambush stashedItems -> ARRANGE)
      const { run: cmbBase, node: cmbNode } = findFormalRunWithNodeType('combat', 'free_salvage', 1050);
      const rewardRun: V2RunState = {
        ...cmbBase,
        phase: 'REWARD',
        currentNodeId: cmbNode.nodeId,
        visitedNodeIds: [cmbNode.nodeId],
        hp: 20,
        bay: { ...cmbBase.bay, staging: [] },
        pendingReward: {
          nodeId: cmbNode.nodeId,
          equipmentOption: createV2EquipmentInstance({
            instanceId: 's02_rew_eq',
            kind: 'shield',
            quality: 'common',
            origin: 'loot',
            acquiredDepth: 1,
            location: 'staging',
          }),
          cargoOption: createV2CargoInstance({
            instanceId: 's02_rew_cg',
            defId: 'cargo.data_box',
            origin: 'loot',
            acquiredDepth: 1,
            location: 'staging',
          }),
          repairAmount: 10,
          chosen: null,
        },
      };
      expect(pickV2CombatReward(rewardRun, 'repair', ['core']).run.phase).toBe('MAP');
      expect(pickV2CombatReward(rewardRun, 'cargo', ['core']).run.phase).toBe('ARRANGE');
      const ambushReward: V2RunState = {
        ...rewardRun,
        activeWreck: {
          nodeId: cmbNode.nodeId,
          stability: 20,
          maxStability: 100,
          cutsMade: 2,
          extracted: false,
          ambushTriggered: true,
          stabilizerActive: false,
          hotspots: [],
          stashedItems: [
            createV2CargoInstance({
              instanceId: 's02_stashed_1',
              defId: 'cargo.alloy_bar',
              origin: 'loot',
              acquiredDepth: 1,
              location: 'staging',
            }),
          ],
        },
      };
      const pickedAmbush = pickV2CombatReward(ambushReward, 'repair', ['core']);
      expect(pickedAmbush.run.phase).toBe('ARRANGE');
      expect(pickedAmbush.run.bay.staging).toHaveLength(1);

      // 7. resolveV2EventOption (fallback -> MAP; terminal -> SETTLEMENT; unused offer -> ARRANGE)
      const eventNodeId = distressNode.nodeId;
      const inEvent: V2RunState = {
        ...inDistress,
        activeEvent: {
          nodeId: eventNodeId,
          eventId: 'test_evt_s02',
          title: '测试事件',
          description: 'desc',
          resolved: false,
          chosenIndex: null,
          options: [
            { index: 0, label: '绕行', costSummary: '无', rewardSummary: '无', isFallback: true },
          ],
        },
      };
      expect(resolveV2EventOption(inEvent, 0, ['core']).run.phase).toBe('MAP');
      expect(
        resolveV2EventOption(
          {
            ...inEvent,
            activeEngineerOffer: { targetInstanceId: 'x', candidates: ['shield'], used: false },
          },
          0,
          ['core']
        ).run.phase
      ).toBe('ARRANGE');

      // Defensive defeat guard in resolvePostEncounterPhase
      expect(resolvePostEncounterPhase({ ...inWreck, hp: 0 }).phase).toBe('SETTLEMENT');
      expect(resolvePostEncounterPhase({ ...inWreck, hp: 0 }).settlementReason).toBe('defeat');
    });

    it('flushes bay.discardedThisArrange into discardedCountThisRun on selectV2MapNode jump', () => {
      const rawTut = createV2TutorialRun('tut_s02_flush');
      const batId = rawTut.bay.staging[0].item.instanceId;
      const placed = placeV2FromStaging(rawTut.bay, batId, 1, 0, 0);
      const dropped = discardV2Item(placed.bay, `${rawTut.runId}_tut_alloy`);
      expect(dropped.ok).toBe(true);
      expect(dropped.bay.discardedThisArrange).toHaveLength(1);

      const mapRun: V2RunState = { ...rawTut, phase: 'MAP', bay: dropped.bay };
      const jumped = selectV2MapNode(mapRun, 'L1A');
      expect(jumped.ok).toBe(true);
      expect(jumped.run.bay.discardedThisArrange).toHaveLength(0);
      expect(jumped.run.discardedCountThisRun).toBe(1);
    });

    it('allows live CargoGridV2 editing on MAP via syncMapLocal (0 destroys, 0 MapPhaseView remounts, 0 showV2Stage resets, live forecast & staging guard)', () => {
      // Build tutorial MAP run with battery initially UNWIRED at (3,3) -> L1A forecast is 24HP (3轮)
      const rawTut = createV2TutorialRun('tut_s02_map_edit');
      const batId = rawTut.bay.staging[0].item.instanceId;
      const unwired = placeV2FromStaging(rawTut.bay, batId, 3, 3, 0);
      expect(unwired.ok).toBe(true);
      const mapRun: V2RunState = { ...rawTut, phase: 'MAP', bay: unwired.bay };

      const save = { ...createFreshV2SaveData(), activeRun: mapRun };
      persistV2SaveData(dom.window.localStorage as unknown as Storage, save);
      dom.window.sessionStorage.setItem('starline_v2_title_entered', '1');

      const mapMountSpy = vi.spyOn(MapPhaseView.prototype, 'mount');
      const gridDestroySpy = vi.spyOn(CargoGridV2Component.prototype, 'destroy');

      const mountEl = dom.document.createElement('div');
      dom.document.body.appendChild(mountEl);
      const controller = new V2AppController(mountEl as unknown as HTMLElement, {
        onSwitchToV1: () => {},
      });
      controller.init();

      expect(mapMountSpy).toHaveBeenCalledTimes(1);
      expect(mountEl.querySelector('[data-testid="map-node-L1A"]')!.textContent).toContain('24HP');
      phaserHostSpies.showV2Stage.mockClear();
      phaserHostSpies.updateV2ShipVisualSpec.mockClear();

      // Drag/click battery from (3,3) to (1,0) directly on MAP!
      const board = mountEl.querySelector('.v2-cargo-board')!;
      const pickPt = cellCenterPoint(4, 4, 3, 3);
      board.dispatchEvent(
        new MiniEvent('pointerdown', { bubbles: true, clientX: pickPt.x, clientY: pickPt.y })
      );
      board.dispatchEvent(
        new MiniEvent('pointerup', { bubbles: true, clientX: pickPt.x, clientY: pickPt.y })
      );
      const dropPt = cellCenterPoint(4, 4, 1, 0);
      board.dispatchEvent(
        new MiniEvent('pointerdown', { bubbles: true, clientX: dropPt.x, clientY: dropPt.y })
      );
      board.dispatchEvent(
        new MiniEvent('pointerup', { bubbles: true, clientX: dropPt.x, clientY: dropPt.y })
      );

      // Forecast updated LIVE from 24HP (3轮) -> 26HP (2轮), 0 destroys, 0 remounts, 0 stage resets!
      expect(mountEl.querySelector('[data-testid="map-node-L1A"]')!.textContent).toContain('26HP');
      expect(mapMountSpy).toHaveBeenCalledTimes(1);
      expect(gridDestroySpy).toHaveBeenCalledTimes(0);
      expect(phaserHostSpies.showV2Stage).toHaveBeenCalledTimes(0);
      expect(phaserHostSpies.updateV2ShipVisualSpec).toHaveBeenCalled();

      // Moving item to staging on MAP disables jump & safe-return buttons with explicit reason!
      const toStagingBtn = mountEl.querySelector('#btn-v2-to-staging');
      expect(toStagingBtn).not.toBeNull();
      toStagingBtn!.click();
      const jumpBtn = mountEl.querySelector('[data-testid="btn-jump-node"]')!;
      const safeBtn = mountEl.querySelector('[data-testid="btn-safe-return"]')!;
      expect(jumpBtn.disabled).toBe(true);
      expect(jumpBtn.textContent).toContain('请先清空暂存区');
      expect(safeBtn.disabled).toBe(true);

      controller.destroy();
    });
  });

  // -------------------------------------------------------------------------
  // S04 — Unified 1-Click Star Map & Hide Single-Enemy Target Policy
  // -------------------------------------------------------------------------
  describe('S04: Unified 1-Click Star Map & Hide Single-Enemy Target Policy', () => {
    it('renders unified 1-click destination cards with zero compare duplicates, zero double-fire, fuel-disabled reason, and clean unmount', () => {
      const host = dom.document.createElement('div');
      dom.document.body.appendChild(host);
      const rawTut = createV2TutorialRun('tut_s04_map');
      const batId = rawTut.bay.staging[0].item.instanceId;
      const wired = placeV2FromStaging(rawTut.bay, batId, 1, 0, 0);
      const forkRun: V2RunState = {
        ...rawTut,
        phase: 'MAP',
        currentNodeId: 'L3A',
        visitedNodeIds: ['L1A', 'L2A', 'L3A'],
        bay: wired.bay,
      };
      const actions = {
        onToggleMobileMap: vi.fn(),
        onSelectNode: vi.fn(),
        onJumpNode: vi.fn(),
        onUseGadget: vi.fn(),
        onSafeReturn: vi.fn(),
        onAbortContract: vi.fn(),
      };

      const view = new MapPhaseView();
      view.mount(host as unknown as HTMLElement);
      view.update(
        {
          run: forkRun,
          readOnly: false,
          selectedMapNodeId: 'L4A',
          mobileMapShowFull: false,
          isCompactViewport: false,
          pureAutoCombat: false,
        },
        actions
      );

      // Zero map-compare-* cards; strictly 1 map-node-<id> for each node; strictly 1 btn-jump-node
      expect(host.querySelectorAll('[data-testid^="map-compare-"]')).toHaveLength(0);
      for (const nid of Object.keys(forkRun.graph.nodes)) {
        expect(host.querySelectorAll(`[data-testid="map-node-${nid}"]`)).toHaveLength(1);
      }
      expect(host.querySelectorAll('[data-testid="btn-jump-node"]')).toHaveLength(1);
      expect(host.querySelector('[data-testid="map-node-L4B"]')!.textContent).toContain('古代导航仪');

      // 1-click jump on NON-selected L4B invokes onJumpNode('L4B') ONCE and onSelectNode 0 times!
      const jumpL4B = host.querySelector('[data-jump-node="L4B"]')!;
      jumpL4B.click();
      expect(actions.onJumpNode).toHaveBeenCalledTimes(1);
      expect(actions.onJumpNode).toHaveBeenCalledWith('L4B');
      expect(actions.onSelectNode).toHaveBeenCalledTimes(0);

      // Clicking card body selects without jumping
      host.querySelector('[data-testid="map-node-L4B"]')!.click();
      expect(actions.onSelectNode).toHaveBeenCalledTimes(1);
      expect(actions.onSelectNode).toHaveBeenCalledWith('L4B');
      expect(actions.onJumpNode).toHaveBeenCalledTimes(1);

      // Fuel-insufficient disables jump button with explicit "燃料不足" reason
      view.update(
        {
          run: { ...forkRun, fuel: 0 },
          readOnly: false,
          selectedMapNodeId: 'L4B',
          mobileMapShowFull: false,
          isCompactViewport: false,
          pureAutoCombat: false,
        },
        actions
      );
      expect(jumpL4B.disabled).toBe(true);
      expect(jumpL4B.textContent).toContain('燃料不足');

      // Terminal layer -> 0 btn-jump-node
      view.update(
        {
          run: { ...forkRun, currentNodeId: 'L4A', visitedNodeIds: ['L1A', 'L2A', 'L3A', 'L4A'] },
          readOnly: false,
          selectedMapNodeId: null,
          mobileMapShowFull: false,
          isCompactViewport: false,
          pureAutoCombat: false,
        },
        actions
      );
      expect(host.querySelectorAll('[data-testid="btn-jump-node"]')).toHaveLength(0);

      const rootRef = host.querySelector('[data-testid="map-screen"]')!;
      view.unmount();
      expect(host.children).toHaveLength(0);
      expect(rootRef.getListenerCount('click')).toBe(0);
      expect(rootRef.getListenerCount('keydown')).toBe(0);
    });

    it('hides .v2-policy-box on single-enemy encounters and renders it on multi-enemy encounters', () => {
      const host = dom.document.createElement('div');
      dom.document.body.appendChild(host);
      const rawTut = createV2TutorialRun('tut_s04_combat');
      const batId = rawTut.bay.staging[0].item.instanceId;
      const wired = placeV2FromStaging(rawTut.bay, batId, 1, 0, 0);
      const baseRun: V2RunState = {
        ...rawTut,
        phase: 'ENCOUNTER',
        currentNodeId: 'L1A',
        bay: wired.bay,
      };
      const onSelectPolicy = vi.fn();

      // Single-enemy (patrol_tutorial: 1 unit) -> hidden!
      renderCombatPreView(
        host as unknown as HTMLElement,
        {
          run: baseRun,
          node: baseRun.graph.nodes['L1A'],
          readOnly: false,
          showCombatLogDetails: false,
          pureAutoCombat: false,
        },
        { onSelectPolicy, onToggleLog: vi.fn(), onStartCombat: vi.fn() }
      );
      expect(host.querySelector('.v2-policy-box')).toBeNull();
      expect(host.querySelectorAll('[data-policy]')).toHaveLength(0);

      // Multi-enemy (swarm: 4 units) -> visible & interactive!
      const swarmNode: V2MapNode = {
        ...baseRun.graph.nodes['L1A'],
        combat: {
          encounterKind: 'swarm',
          units: buildEncounterUnits('swarm', 2, 'L1A'),
          bounty: 10,
          improvedProb: 0,
        },
      };
      renderCombatPreView(
        host as unknown as HTMLElement,
        {
          run: { ...baseRun, graph: { ...baseRun.graph, nodes: { ...baseRun.graph.nodes, L1A: swarmNode } } },
          node: swarmNode,
          readOnly: false,
          showCombatLogDetails: false,
          pureAutoCombat: false,
        },
        { onSelectPolicy, onToggleLog: vi.fn(), onStartCombat: vi.fn() }
      );
      expect(host.querySelector('.v2-policy-box')).not.toBeNull();
      expect(host.querySelectorAll('[data-policy]')).toHaveLength(2);
      host.querySelector('[data-policy="highest_threat"]')!.click();
      expect(onSelectPolicy).toHaveBeenCalledWith('highest_threat');
    });
  });

  // -------------------------------------------------------------------------
  // S05 — Pausable 1.5s Pre-Combat Auto-Engage & Strict Idempotency
  // -------------------------------------------------------------------------
  describe('S05: Pausable 1.5s Pre-Combat Auto-Engage Countdown & Strict Idempotency', () => {
    it('exercises PreCombatAutoEngageController state machine deterministically with vi.useFakeTimers()', () => {
      vi.useFakeTimers();
      const onEngage = vi.fn(() => true);
      const ctrl = new PreCombatAutoEngageController({ onEngage });

      // Starts 1500ms countdown on entering eligible pre-combat node
      ctrl.sync({ eligible: true, nodeKey: 'run1:L1A', canMutate: true, modalOpen: false, hidden: false });
      expect(ctrl.getSnapshot().status).toBe('countdown');
      expect(ctrl.getSnapshot().durationMs).toBe(PRE_COMBAT_AUTO_ENGAGE_MS);

      // Does not fire at 1499ms; fires strictly ONCE at 1500ms!
      vi.advanceTimersByTime(1499);
      expect(onEngage).toHaveBeenCalledTimes(0);
      vi.advanceTimersByTime(1);
      expect(onEngage).toHaveBeenCalledTimes(1);
      expect(onEngage).toHaveBeenCalledWith('run1:L1A', 'timer');
      vi.advanceTimersByTime(5000);
      expect(onEngage).toHaveBeenCalledTimes(1);

      // Manual engageNow() at 400ms cancels timer & double-click fires strictly ONCE
      onEngage.mockClear();
      ctrl.sync({ eligible: true, nodeKey: 'run1:L2A', canMutate: true, modalOpen: false, hidden: false });
      vi.advanceTimersByTime(400);
      expect(ctrl.engageNow()).toBe(true);
      expect(ctrl.engageNow()).toBe(false);
      vi.advanceTimersByTime(5000);
      expect(onEngage).toHaveBeenCalledTimes(1);
      expect(onEngage).toHaveBeenCalledWith('run1:L2A', 'manual');

      // Pause/Resume + same-node sync preservation
      onEngage.mockClear();
      ctrl.sync({ eligible: true, nodeKey: 'run1:L3A', canMutate: true, modalOpen: false, hidden: false });
      vi.advanceTimersByTime(500);
      // Same-node sync during countdown preserves remaining time (~1000ms)
      ctrl.sync({ eligible: true, nodeKey: 'run1:L3A', canMutate: true, modalOpen: false, hidden: false });
      expect(ctrl.getSnapshot().remainingMs).toBeLessThanOrEqual(1000);
      expect(ctrl.togglePause()).toBe(true);
      expect(ctrl.getSnapshot().status).toBe('paused');
      expect(ctrl.getSnapshot().pauseReason).toBe('manual');
      // Same-node sync during paused does NOT clobber paused state
      ctrl.sync({ eligible: true, nodeKey: 'run1:L3A', canMutate: true, modalOpen: false, hidden: false });
      expect(ctrl.getSnapshot().status).toBe('paused');
      vi.advanceTimersByTime(10000);
      expect(onEngage).toHaveBeenCalledTimes(0);
      // Resume starts fresh 1500ms countdown
      expect(ctrl.togglePause()).toBe(true);
      expect(ctrl.getSnapshot().status).toBe('countdown');
      vi.advanceTimersByTime(1500);
      expect(onEngage).toHaveBeenCalledTimes(1);

      // All pause triggers: policy, gadget, details, modal, hidden, readonly + ineligible reset
      for (const reason of ['policy', 'gadget', 'details', 'modal', 'hidden', 'readonly'] as const) {
        onEngage.mockClear();
        ctrl.sync({ eligible: true, nodeKey: `run1:node_${reason}`, canMutate: true, modalOpen: false, hidden: false });
        expect(ctrl.pause(reason)).toBe(true);
        expect(ctrl.getSnapshot().status).toBe('paused');
        expect(ctrl.getSnapshot().pauseReason).toBe(reason);
        vi.advanceTimersByTime(5000);
        expect(onEngage).toHaveBeenCalledTimes(0);
      }

      // Entering new node while modal/hidden/readonly enters paused immediately with 0 timer
      onEngage.mockClear();
      ctrl.sync({ eligible: true, nodeKey: 'run1:blocked', canMutate: false, modalOpen: false, hidden: false });
      expect(ctrl.getSnapshot().status).toBe('paused');
      expect(ctrl.getSnapshot().pauseReason).toBe('readonly');
      vi.advanceTimersByTime(5000);
      expect(onEngage).toHaveBeenCalledTimes(0);

      // Destroy cancels active countdown cleanly
      ctrl.sync({ eligible: true, nodeKey: 'run1:teardown', canMutate: true, modalOpen: false, hidden: false });
      ctrl.destroy();
      vi.advanceTimersByTime(5000);
      expect(onEngage).toHaveBeenCalledTimes(0);
    });

    it('enforces startV2CombatAtCurrentNode domain idempotency and V2AppController S05 integration', () => {
      // 1. Domain idempotency checks
      const rawTut = createV2TutorialRun('tut_s05_dom');
      const batId = rawTut.bay.staging[0].item.instanceId;
      const wired = placeV2FromStaging(rawTut.bay, batId, 1, 0, 0);
      const entered = selectV2MapNode({ ...rawTut, phase: 'MAP', bay: wired.bay }, 'L1A');
      expect(entered.ok).toBe(true);

      const started1 = combatV2.startV2CombatAtCurrentNode(entered.run, 'weakest');
      expect(started1.ok).toBe(true);
      // Same nodeId -> idempotent { ok: true, run }
      const startedDup = combatV2.startV2CombatAtCurrentNode(started1.run, 'weakest');
      expect(startedDup.ok).toBe(true);
      expect(startedDup.run).toBe(started1.run);
      // Mismatched activeCombat.nodeId -> rejected!
      const mismatched = combatV2.startV2CombatAtCurrentNode(
        { ...started1.run, activeCombat: { ...started1.run.activeCombat!, nodeId: 'L4B' } },
        'weakest'
      );
      expect(mismatched.ok).toBe(false);
      // Already claimed combat_done_L1A -> rejected!
      const claimed = combatV2.startV2CombatAtCurrentNode(
        { ...entered.run, claimedEventIds: ['combat_done_L1A'] },
        'weakest'
      );
      expect(claimed.ok).toBe(false);

      // 2. Full V2AppController S05 integration with vi.useFakeTimers()
      vi.useFakeTimers();
      const save = { ...createFreshV2SaveData(), activeRun: entered.run };
      persistV2SaveData(dom.window.localStorage as unknown as Storage, save);
      dom.window.sessionStorage.setItem('starline_v2_title_entered', '1');

      const startSpy = vi.spyOn(combatV2, 'startV2CombatAtCurrentNode');

      const mountEl = dom.document.createElement('div');
      dom.document.body.appendChild(mountEl);
      const controller = new V2AppController(mountEl as unknown as HTMLElement, {
        onSwitchToV1: () => {},
      });
      controller.init();

      const startBtn = mountEl.querySelector('[data-testid="btn-start-combat"]')!;
      const pauseBtn = mountEl.querySelector('[data-testid="btn-pause-auto-combat"]')!;
      expect(startBtn).not.toBeNull();
      expect(pauseBtn).not.toBeNull();
      expect(startBtn.textContent).toContain('1.5s 后自动交火');
      expect(pauseBtn.textContent).toContain('暂停 / 调整');

      // Pause toggle prevents auto-engage
      pauseBtn.click();
      expect(pauseBtn.textContent).toContain('继续自动交火');
      vi.advanceTimersByTime(5000);
      expect(startSpy).toHaveBeenCalledTimes(0);

      // Resume -> open details (#v2-toggle-log) pauses automatically
      pauseBtn.click();
      expect(mountEl.querySelector('[data-testid="btn-pause-auto-combat"]')!.textContent).toContain('暂停 / 调整');
      mountEl.querySelector('#v2-toggle-log')!.click();
      expect(mountEl.querySelector('[data-testid="btn-pause-auto-combat"]')!.textContent).toContain('继续自动交火');
      vi.advanceTimersByTime(5000);
      expect(startSpy).toHaveBeenCalledTimes(0);

      // Resume -> visibilitychange(hidden=true) pauses automatically
      mountEl.querySelector('[data-testid="btn-pause-auto-combat"]')!.click();
      dom.document.hidden = true;
      dom.document.dispatchEvent(new MiniEvent('visibilitychange'));
      expect(mountEl.querySelector('[data-testid="btn-pause-auto-combat"]')!.textContent).toContain('继续自动交火');
      vi.advanceTimersByTime(5000);
      expect(startSpy).toHaveBeenCalledTimes(0);
      dom.document.hidden = false;

      // Resume -> open modal (#v2-hud-help) pauses automatically
      mountEl.querySelector('[data-testid="btn-pause-auto-combat"]')!.click();
      mountEl.querySelector('#v2-hud-help')!.click();
      expect(mountEl.querySelector('[data-testid="btn-pause-auto-combat"]')!.textContent).toContain('继续自动交火');
      // Close modal
      mountEl.querySelector('.modal-close-btn')?.click();
      vi.advanceTimersByTime(5000);
      expect(startSpy).toHaveBeenCalledTimes(0);

      // Resume -> let 1500ms expire -> engages strictly ONCE!
      mountEl.querySelector('[data-testid="btn-pause-auto-combat"]')!.click();
      vi.advanceTimersByTime(1500);
      expect(startSpy).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(5000);
      expect(startSpy).toHaveBeenCalledTimes(1);
      controller.destroy();

      // 3. Manual click at 300ms + timer race fires strictly ONCE, and destroy() leaks 0 timers
      startSpy.mockClear();
      persistV2SaveData(dom.window.localStorage as unknown as Storage, save);
      const mountEl2 = dom.document.createElement('div');
      dom.document.body.appendChild(mountEl2);
      const controller2 = new V2AppController(mountEl2 as unknown as HTMLElement, {
        onSwitchToV1: () => {},
      });
      controller2.init();
      vi.advanceTimersByTime(300);
      mountEl2.querySelector('[data-testid="btn-start-combat"]')!.click();
      expect(startSpy).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(5000);
      expect(startSpy).toHaveBeenCalledTimes(1);
      controller2.destroy();

      // Destroy during active countdown leaks 0 calls
      startSpy.mockClear();
      persistV2SaveData(dom.window.localStorage as unknown as Storage, save);
      const mountEl3 = dom.document.createElement('div');
      dom.document.body.appendChild(mountEl3);
      const controller3 = new V2AppController(mountEl3 as unknown as HTMLElement, {
        onSwitchToV1: () => {},
      });
      controller3.init();
      vi.advanceTimersByTime(500);
      controller3.destroy();
      vi.advanceTimersByTime(5000);
      expect(startSpy).toHaveBeenCalledTimes(0);
    });
  });

  // -------------------------------------------------------------------------
  // S10 — Post-First-Voyage Distinct Contract Recommendation
  // -------------------------------------------------------------------------
  describe('S10: Post-First-Voyage Distinct Contract Recommendation', () => {
    it('recommends rescue_std (NOT transport_std) on fresh post-tutorial 0¤ profile, launches cleanly, and progresses across contracts', () => {
      const base = createFreshV2SaveData().profile;
      const postTutProfile = {
        ...base,
        tutorialCompleted: true,
        completedContractIds: [] as string[],
        completedContractTypes: [] as typeof base.completedContractTypes,
        credits: 0,
      };

      const rec1 = pickRecommendedV2ContractId(postTutProfile);
      expect(rec1).toBe('rescue_std');
      expect(rec1).not.toBe('transport_std');

      // Unlocked on contract board and immediately launchable at 0¤
      const board = getAvailableContractBoard(postTutProfile);
      expect(board.standardTemplates.some((c) => c.templateId === rec1)).toBe(true);
      const slots = buildFreeFallbackPrepareSlots('cannon_skiff', postTutProfile.blueprints, 6);
      const launched = launchV2Expedition({
        profile: postTutProfile,
        contractTemplateId: rec1,
        shipId: 'cannon_skiff',
        crewId: 'engineer',
        primaryArchetype: 'laser',
        slots,
        trialBuildId: null,
        sectorId: 'near_orbit',
        seed: 20261124,
      });
      expect(launched.ok).toBe(true);
      expect(launched.run?.contract.templateId).toBe('rescue_std');
      expect(launched.run?.contract.type).toBe('rescue');

      // BaseView displays rescue_std name & Escape Pod space/fuel tradeoff
      const host = dom.document.createElement('div');
      dom.document.body.appendChild(host);
      renderBaseHeroView(
        host as unknown as HTMLElement,
        {
          profile: postTutProfile,
          readOnly: false,
          nextGoal: { title: 't', detail: 'd', actionKind: 'facilities', ready: false },
          recommendedContractId: rec1,
          activeDockingNotice: null,
          campaignBannerCollapsed: false,
          campaignObjective: getActiveCampaignObjective(postTutProfile),
        },
        {
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
        }
      );
      expect(host.textContent).toContain('标准失联救援');
      expect(host.textContent).toContain('救生舱');
      expect(host.textContent).toContain('+1 油');

      // Progresses cleanly after completing rescue_std -> survey_std -> bounty_std -> derelict_std -> transport_std
      expect(
        pickRecommendedV2ContractId({ ...postTutProfile, completedContractIds: ['rescue_std'] })
      ).toBe('survey_std');
      expect(
        pickRecommendedV2ContractId({
          ...postTutProfile,
          completedContractIds: ['rescue_std', 'survey_std'],
        })
      ).toBe('bounty_std');
      expect(
        pickRecommendedV2ContractId({
          ...postTutProfile,
          completedContractIds: ['rescue_std', 'survey_std', 'bounty_std', 'derelict_std'],
        })
      ).toBe('transport_std');
    });
  });
});
