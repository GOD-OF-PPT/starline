import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal Third-Party Phaser WebGL Stub (ONLY 'phaser' is mocked — ALL real
// project classes: V2AppController, PhaserHost, V2CombatScene, BaseScene,
// CargoGridV2Component, tacticalDelta, ArrangePhaseView, MapPhaseView execute!)
// ---------------------------------------------------------------------------

const { MOCK_SCENE_STATUS, MockPhaserScene, MockPhaserGame, phaserTestHarness } = vi.hoisted(() => {
const MOCK_SCENE_STATUS = {
  PENDING: 0,
  INIT: 1,
  START: 2,
  LOADING: 3,
  CREATING: 4,
  RUNNING: 5,
  PAUSED: 6,
  SLEEPING: 7,
  SHUTDOWN: 8,
  DESTROYED: 9,
} as const;

interface MockListener {
  readonly fn: (...args: unknown[]) => void;
  readonly ctx: unknown;
  readonly once: boolean;
}

class MockEventEmitter {
  private readonly listeners = new Map<string, MockListener[]>();

  on(event: string, fn: (...args: unknown[]) => void, ctx?: unknown): this {
    const list = this.listeners.get(event) ?? [];
    list.push({ fn, ctx, once: false });
    this.listeners.set(event, list);
    return this;
  }

  once(event: string, fn: (...args: unknown[]) => void, ctx?: unknown): this {
    const list = this.listeners.get(event) ?? [];
    list.push({ fn, ctx, once: true });
    this.listeners.set(event, list);
    return this;
  }

  off(event: string, fn?: (...args: unknown[]) => void, ctx?: unknown): this {
    if (!fn) {
      this.listeners.delete(event);
      return this;
    }
    const list = this.listeners.get(event);
    if (!list) return this;
    this.listeners.set(
      event,
      list.filter((entry) => !(entry.fn === fn && (ctx === undefined || entry.ctx === ctx)))
    );
    return this;
  }

  emit(event: string, ...args: unknown[]): boolean {
    const list = this.listeners.get(event);
    if (!list || list.length === 0) return false;
    const snapshot = [...list];
    this.listeners.set(
      event,
      list.filter((entry) => !entry.once)
    );
    for (const entry of snapshot) {
      entry.fn.apply(entry.ctx, args);
    }
    return true;
  }
}

class MockDisplayObject {
  scene: MockPhaserScene | null;
  x: number;
  y: number;
  width = 256;
  height = 128;
  displayWidth = 256;
  displayHeight = 128;
  visible = true;
  alpha = 1;
  depth = 0;
  textureKey: string;
  text: string;
  tint: number | null = null;

  constructor(scene: MockPhaserScene, x = 0, y = 0, textureKey = '', text = '') {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.textureKey = textureKey;
    this.text = text;
  }

  get texture(): { readonly key: string } {
    return { key: this.textureKey };
  }

  setOrigin(_x?: number, _y?: number): this {
    return this;
  }
  setDepth(d: number): this {
    this.depth = d;
    return this;
  }
  setVisible(v: boolean): this {
    this.visible = v;
    return this;
  }
  setAlpha(a: number): this {
    this.alpha = a;
    return this;
  }
  setScale(sx: number, sy?: number): this {
    this.displayWidth = this.width * sx;
    this.displayHeight = this.height * (sy ?? sx);
    return this;
  }
  setPosition(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }
  setY(y: number): this {
    this.y = y;
    return this;
  }
  setAngle(_deg: number): this {
    return this;
  }
  setSize(w: number, h: number): this {
    this.width = w;
    this.height = h;
    this.displayWidth = w;
    this.displayHeight = h;
    return this;
  }
  setTexture(key: string): this {
    this.textureKey = key;
    return this;
  }
  setText(t: string): this {
    this.text = t;
    return this;
  }
  setColor(_c: string): this {
    return this;
  }
  setBackgroundColor(_c: string): this {
    return this;
  }
  setTint(t: number): this {
    this.tint = t;
    return this;
  }
  setTintFill(t: number): this {
    this.tint = t;
    return this;
  }
  clearTint(): this {
    this.tint = null;
    return this;
  }
  setCrop(): this {
    return this;
  }
  setInteractive(_opts?: unknown): this {
    return this;
  }
  on(_event: string, _fn: (...args: unknown[]) => void): this {
    return this;
  }
  off(_event: string, _fn?: (...args: unknown[]) => void): this {
    return this;
  }
  clear(): this {
    return this;
  }
  fillStyle(_c: number, _a?: number): this {
    return this;
  }
  lineStyle(_w: number, _c: number, _a?: number): this {
    return this;
  }
  fillRect(_x: number, _y: number, _w: number, _h: number): this {
    return this;
  }
  strokeRect(_x: number, _y: number, _w: number, _h: number): this {
    return this;
  }
  fillRoundedRect(_x: number, _y: number, _w: number, _h: number, _r?: number): this {
    return this;
  }
  strokeRoundedRect(_x: number, _y: number, _w: number, _h: number, _r?: number): this {
    return this;
  }
  fillCircle(_x: number, _y: number, _r: number): this {
    return this;
  }
  strokeCircle(_x: number, _y: number, _r: number): this {
    return this;
  }
  fillEllipse(_x: number, _y: number, _w: number, _h: number): this {
    return this;
  }
  strokeEllipse(_x: number, _y: number, _w: number, _h: number): this {
    return this;
  }
  lineBetween(_x1: number, _y1: number, _x2: number, _y2: number): this {
    return this;
  }
  beginPath(): this {
    return this;
  }
  moveTo(_x: number, _y: number): this {
    return this;
  }
  lineTo(_x: number, _y: number): this {
    return this;
  }
  closePath(): this {
    return this;
  }
  fillPath(): this {
    return this;
  }
  strokePath(): this {
    return this;
  }
  fillTriangle(): this {
    return this;
  }
  strokeTriangle(): this {
    return this;
  }
  arc(): this {
    return this;
  }
  destroy(): void {
    this.scene = null;
  }
}

class MockPhaserScene {
  readonly sceneKey: string;
  game!: MockPhaserGame;
  events = new MockEventEmitter();
  load = {
    on: (_event: string, _fn: (...args: unknown[]) => void) => this.load,
    image: (_key: string, _url: string) => this.load,
  };
  textures = {
    exists: (_key: string) => true,
  };
  cameras = {
    main: {
      setViewport: () => {},
      setZoom: () => {},
      centerOn: () => {},
      setBackgroundColor: () => {},
    },
  };
  scale = new (class extends MockEventEmitter {
    width = 640;
    height = 360;
    resize(w: number, h: number): void {
      this.width = w;
      this.height = h;
    }
  })();
  add = {
    image: (x: number, y: number, key: string) => new MockDisplayObject(this, x, y, key),
    text: (x: number, y: number, text: string, _style?: unknown) =>
      new MockDisplayObject(this, x, y, '', text),
    graphics: () => new MockDisplayObject(this),
    zone: (x: number, y: number, w: number, h: number) =>
      new MockDisplayObject(this, x, y).setSize(w, h),
  };
  sys: {
    isActive: () => boolean;
    settings: { status: number };
  };
  scene: { isActive: () => boolean };

  constructor(config?: { readonly key?: string }) {
    this.sceneKey = config?.key ?? 'Scene';
    const isActive = () => Boolean(this.game?.scene.isActive(this.sceneKey));
    this.sys = {
      isActive,
      settings: { status: MOCK_SCENE_STATUS.PENDING },
    };
    this.scene = { isActive };
  }

  init?(_data?: unknown): void;
  preload?(): void;
  create?(): void;
}

const phaserTestHarness = {
  autoReady: true,
  lastGame: null as MockPhaserGame | null,
  deferCreateKeys: new Set<string>(),
};

class MockPhaserGame {
  readonly events = new MockEventEmitter();
  readonly registryMap = new Map<string, unknown>();
  readonly registry = {
    set: (k: string, v: unknown) => {
      this.registryMap.set(k, v);
    },
    get: (k: string) => this.registryMap.get(k),
  };
  readonly scale = {
    width: 640,
    height: 360,
    resize: (w: number, h: number) => {
      this.scale.width = w;
      this.scale.height = h;
      this.canvas.width = w;
      this.canvas.height = h;
    },
  };
  readonly renderer = {
    width: 640,
    height: 360,
    resize: (w: number, h: number) => {
      this.renderer.width = w;
      this.renderer.height = h;
    },
  };
  readonly loop = { rawDelta: 16 };
  readonly canvas: {
    width: number;
    height: number;
    style: Record<string, string>;
    parentElement: HTMLElement | null;
  };
  private readonly sceneMap = new Map<string, MockPhaserScene>();
  private readonly activeScenes = new Set<string>();
  readonly startedScenes: { readonly key: string; readonly data: unknown }[] = [];

  readonly scene = {
    isActive: (key: string) => this.activeScenes.has(key),
    start: (key: string, data?: unknown) => {
      this.startedScenes.push({ key, data });
      const target = this.sceneMap.get(key);
      if (!target) return;
      // Mirror real Phaser 3.90 SceneManager.start guard: silently drops start() during START..CREATING
      if (
        target.sys.settings.status >= MOCK_SCENE_STATUS.START &&
        target.sys.settings.status <= MOCK_SCENE_STATUS.CREATING
      ) {
        return;
      }
      if (this.activeScenes.has(key)) {
        this.activeScenes.delete(key);
        target.sys.settings.status = MOCK_SCENE_STATUS.SHUTDOWN;
        target.events.emit('shutdown');
      }
      target.scale.width = this.scale.width;
      target.scale.height = this.scale.height;
      target.sys.settings.status = MOCK_SCENE_STATUS.INIT;
      target.init?.(data);
      target.sys.settings.status = MOCK_SCENE_STATUS.LOADING;
      target.preload?.();
      if (phaserTestHarness.deferCreateKeys.has(key)) {
        return;
      }
      this.finishPreload(key);
    },
    stop: (key: string) => {
      const target = this.sceneMap.get(key);
      const isLiveOrStarting =
        this.activeScenes.has(key) ||
        (target !== undefined &&
          target.sys.settings.status >= MOCK_SCENE_STATUS.INIT &&
          target.sys.settings.status <= MOCK_SCENE_STATUS.RUNNING);
      if (!isLiveOrStarting) return;
      this.activeScenes.delete(key);
      if (target) {
        target.sys.settings.status = MOCK_SCENE_STATUS.SHUTDOWN;
        target.events.emit('shutdown');
      }
    },
  };

  constructor(config: {
    readonly parent?: HTMLElement;
    readonly width?: number;
    readonly height?: number;
    readonly scene?: readonly MockPhaserScene[];
  }) {
    const w = config.width ?? 640;
    const h = config.height ?? 360;
    this.scale.width = w;
    this.scale.height = h;
    this.renderer.width = w;
    this.renderer.height = h;
    this.canvas = {
      width: w,
      height: h,
      style: {},
      parentElement: config.parent ?? null,
    };
    for (const sc of config.scene ?? []) {
      sc.game = this;
      this.sceneMap.set(sc.sceneKey, sc);
    }
    phaserTestHarness.lastGame = this;
    if (phaserTestHarness.autoReady) {
      // Allow PhaserHost constructor to finish binding events.once(READY) first
      queueMicrotask(() => {
        this.emitReady();
      });
    }
  }

  getScene<T extends MockPhaserScene>(key: string): T | undefined {
    return this.sceneMap.get(key) as T | undefined;
  }

  finishPreload(key: string): void {
    const target = this.sceneMap.get(key);
    if (!target || target.sys.settings.status !== MOCK_SCENE_STATUS.LOADING) return;
    target.sys.settings.status = MOCK_SCENE_STATUS.CREATING;
    this.activeScenes.add(key);
    target.create?.();
    target.sys.settings.status = MOCK_SCENE_STATUS.RUNNING;
  }

  emitReady(): void {
    this.events.emit('ready');
  }

  destroy(_removeCanvas?: boolean): void {
    for (const key of [...this.sceneMap.keys()]) {
      this.scene.stop(key);
    }
  }
}

  return { MOCK_SCENE_STATUS, MockPhaserScene, MockPhaserGame, phaserTestHarness };
});

type MockPhaserSceneInstance = InstanceType<typeof MockPhaserScene>;

vi.mock('phaser', () => ({
  default: {
    AUTO: 0,
    Scale: { NONE: 0, NO_CENTER: 0 },
    Core: { Events: { READY: 'ready' } },
    Scenes: {
      ...MOCK_SCENE_STATUS,
      Events: { SHUTDOWN: 'shutdown' },
    },
    Scene: MockPhaserScene,
    Game: MockPhaserGame,
  },
}));

// ---------------------------------------------------------------------------
// Imports of REAL project modules (zero mocks of our own codebase!)
// ---------------------------------------------------------------------------

import { soundEngine } from '../src/audio/soundEngine';
import { DEFAULT_SETTINGS } from '../src/domain/progression';
import { PhaserHost } from '../src/scenes/PhaserHost';
import { buildEncounterUnits } from '../src/v2/data/enemies';
import { createV2TutorialRun } from '../src/v2/data/tutorialV2';
import { simulateV2Combat } from '../src/v2/domain/combatV2';
import { selectV2MapNode } from '../src/v2/domain/encounter';
import { launchV2Expedition, buildFreeFallbackPrepareSlots } from '../src/v2/domain/loadout';
import {
  createV2CargoInstance,
  createV2EquipmentInstance,
  createV3GadgetInstance,
} from '../src/v2/domain/itemCatalog';
import { createFreshV2SaveData, persistV2SaveData } from '../src/v2/domain/persistenceV2';
import { deriveV2ShipVisualSpec } from '../src/v2/domain/shipVisualSpec';
import {
  clearTacticalDeltaCache,
  computeV2BayHash,
  computeV2PlacementTacticalDelta,
  findBestPlacementForItem,
  getTacticalDeltaCacheStats,
} from '../src/v2/domain/tacticalDelta';
import type { V2CargoBayState, V2RunState } from '../src/v2/domain/types';
import { V2CombatScene, type V2StagePlayback } from '../src/v2/scenes/V2CombatScene';
import { CargoGridV2Component } from '../src/v2/ui/CargoGridV2';
import { ArrangePhaseView } from '../src/v2/ui/screens/ArrangeView';
import { MapPhaseView } from '../src/v2/ui/screens/MapView';
import {
  buildV2StaticStagePlaybackKey,
  V2StaticStageSyncTracker,
  type V2StaticStageHostLike,
} from '../src/v2/ui/screens/screenTypes';
import { V2AppController } from '../src/v2/ui/V2AppController';

// ---------------------------------------------------------------------------
// Minimal Strictly-Typed Node DOM Shim (Zero External Dependencies)
// ---------------------------------------------------------------------------

interface FakeEventInit {
  readonly bubbles?: boolean;
  readonly key?: string;
  readonly clientX?: number;
  readonly clientY?: number;
  readonly button?: number;
  readonly pointerId?: number;
  readonly pointerType?: string;
}

class FakeEvent {
  readonly type: string;
  readonly bubbles: boolean;
  target: FakeNode | null = null;
  currentTarget: FakeNode | null = null;
  defaultPrevented = false;
  propagationStopped = false;
  readonly key: string;
  readonly clientX: number;
  readonly clientY: number;
  readonly button: number;
  readonly pointerId: number;
  readonly pointerType: string;

  constructor(type: string, init: FakeEventInit = {}) {
    this.type = type;
    this.bubbles = init.bubbles ?? false;
    this.key = init.key ?? '';
    this.clientX = init.clientX ?? 0;
    this.clientY = init.clientY ?? 0;
    this.button = init.button ?? 0;
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'mouse';
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }

  stopPropagation(): void {
    this.propagationStopped = true;
  }
}

class FakeClassList {
  private readonly owner: FakeElement;
  constructor(owner: FakeElement) {
    this.owner = owner;
  }
  private tokens(): string[] {
    const raw = this.owner.getAttribute('class') ?? '';
    return raw.trim() ? raw.trim().split(/\s+/) : [];
  }
  private save(tokens: string[]): void {
    this.owner.setAttribute('class', tokens.join(' '));
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

class FakeNode {
  parentNode: FakeNode | null = null;
  readonly childNodes: FakeNode[] = [];
  protected readonly listeners = new Map<string, Set<(ev: FakeEvent) => void>>();

  get parentElement(): FakeElement | null {
    return this.parentNode instanceof FakeElement ? this.parentNode : null;
  }

  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }

  get children(): FakeElement[] {
    return this.childNodes.filter((n): n is FakeElement => n instanceof FakeElement);
  }

  get firstElementChild(): FakeElement | null {
    return this.children[0] ?? null;
  }

  appendChild<T extends FakeNode>(child: T): T {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  insertBefore<T extends FakeNode>(child: T, ref: FakeNode | null): T {
    if (!ref) return this.appendChild(child);
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    const idx = this.childNodes.indexOf(ref);
    if (idx === -1) {
      return this.appendChild(child);
    }
    child.parentNode = this;
    this.childNodes.splice(idx, 0, child);
    return child;
  }

  removeChild<T extends FakeNode>(child: T): T {
    const idx = this.childNodes.indexOf(child);
    if (idx >= 0) {
      this.childNodes.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  remove(): void {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  replaceChildren(...nodes: FakeNode[]): void {
    for (const c of [...this.childNodes]) {
      c.parentNode = null;
    }
    this.childNodes.length = 0;
    for (const n of nodes) {
      this.appendChild(n);
    }
  }

  contains(other: FakeNode | null): boolean {
    let cur: FakeNode | null = other;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentNode;
    }
    return false;
  }

  addEventListener(type: string, fn: (ev: FakeEvent) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }

  removeEventListener(type: string, fn: (ev: FakeEvent) => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  getListenerCount(type?: string): number {
    if (type) return this.listeners.get(type)?.size ?? 0;
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }

  dispatchEvent(ev: FakeEvent): boolean {
    if (!ev.target) ev.target = this;
    let cur: FakeNode | null = this;
    while (cur) {
      ev.currentTarget = cur;
      const handlers = cur.listeners.get(ev.type);
      if (handlers) {
        for (const fn of [...handlers]) {
          fn(ev);
        }
      }
      if (!ev.bubbles || ev.propagationStopped) break;
      cur = cur.parentNode;
    }
    return !ev.defaultPrevented;
  }
}

class FakeTextNode extends FakeNode {
  data: string;
  constructor(data: string) {
    super();
    this.data = data;
  }
}

const VOID_TAGS = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'path', 'line', 'circle', 'rect']);

function parseHtmlFragment(html: string, doc: FakeDocument): FakeNode[] {
  const root = new FakeElement('div', doc);
  const stack: FakeElement[] = [root];
  const tokenRe = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9_-]+)\s*>|<([a-zA-Z0-9_-]+)((?:\s+[^<>]*?)?)\s*(\/?)>|([^<]+)/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(html)) !== null) {
    const [, closeTag, openTag, rawAttrs, selfClose, textPart] = match;
    const parent = stack[stack.length - 1];
    if (closeTag) {
      const upper = closeTag.toUpperCase();
      for (let i = stack.length - 1; i >= 1; i--) {
        if (stack[i].tagName === upper) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    if (openTag) {
      const el = new FakeElement(openTag, doc);
      if (rawAttrs) {
        const attrRe = /([a-zA-Z0-9_:@.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
        let am: RegExpExecArray | null;
        while ((am = attrRe.exec(rawAttrs)) !== null) {
          const attrName = am[1];
          const attrVal = am[2] ?? am[3] ?? am[4] ?? '';
          el.setAttribute(attrName, attrVal);
        }
      }
      parent.appendChild(el);
      if (!selfClose && !VOID_TAGS.has(openTag.toLowerCase())) {
        stack.push(el);
      }
      continue;
    }
    if (textPart !== undefined) {
      parent.appendChild(new FakeTextNode(textPart));
    }
  }
  const out = [...root.childNodes];
  for (const n of out) n.parentNode = null;
  return out;
}

function matchesSimpleSelector(el: FakeElement, simple: string): boolean {
  let rest = simple.trim();
  if (!rest || rest === '*') return true;

  // Handle :not([disabled]) or :not(.cls)
  const notRe = /:not\(([^)]+)\)/g;
  let nm: RegExpExecArray | null;
  const negations: string[] = [];
  while ((nm = notRe.exec(rest)) !== null) {
    negations.push(nm[1]);
  }
  rest = rest.replace(notRe, '');
  for (const neg of negations) {
    if (matchesSimpleSelector(el, neg)) return false;
  }

  // Extract attribute selectors
  const attrRe = /\[\s*([a-zA-Z0-9_-]+)(?:\s*(\^?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\s*\]/g;
  let am: RegExpExecArray | null;
  while ((am = attrRe.exec(rest)) !== null) {
    const [, name, op, dq, sq, bare] = am;
    const expected = dq ?? sq ?? bare;
    if (!op) {
      if (!el.hasAttribute(name)) return false;
    } else {
      const actual = el.getAttribute(name);
      if (actual === null) return false;
      if (op === '=' && actual !== expected) return false;
      if (op === '^=' && !actual.startsWith(expected ?? '')) return false;
    }
  }
  rest = rest.replace(attrRe, '');

  // Extract tag, #id, .class
  const partRe = /([#.]?[a-zA-Z0-9_-]+)/g;
  let pm: RegExpExecArray | null;
  while ((pm = partRe.exec(rest)) !== null) {
    const tok = pm[1];
    if (tok.startsWith('#')) {
      if (el.id !== tok.slice(1)) return false;
    } else if (tok.startsWith('.')) {
      if (!el.classList.contains(tok.slice(1))) return false;
    } else {
      if (el.tagName !== tok.toUpperCase()) return false;
    }
  }
  return true;
}

function matchesSingleChain(el: FakeElement, chain: string, scopeEl?: FakeElement): boolean {
  const normalized = chain.trim().replace(/\s*>\s*/g, ' > ');
  if (!normalized) return false;
  const tokens = normalized.split(/\s+/);
  // Build (combinator, selector) pairs from right to left
  const parts: { readonly selector: string; readonly combinator: ' ' | '>' | null }[] = [];
  let pendingComb: ' ' | '>' | null = null;
  for (const tok of tokens) {
    if (tok === '>') {
      pendingComb = '>';
    } else {
      parts.push({ selector: tok, combinator: pendingComb });
      pendingComb = ' ';
    }
  }
  if (parts.length === 0) return false;

  const matchAt = (node: FakeElement | null, idx: number): boolean => {
    if (!node || idx < 0) return false;
    const part = parts[idx];
    if (part.selector === ':scope') {
      return scopeEl !== undefined && node === scopeEl && idx === 0;
    }
    if (!matchesSimpleSelector(node, part.selector)) return false;
    if (idx === 0) return true;
    const comb = part.combinator;
    if (comb === '>') {
      return matchAt(node.parentElement, idx - 1);
    }
    let anc = node.parentElement;
    while (anc) {
      if (matchAt(anc, idx - 1)) return true;
      anc = anc.parentElement;
    }
    return false;
  };

  return matchAt(el, parts.length - 1);
}

function matchesSelector(el: FakeElement, selector: string, scopeEl?: FakeElement): boolean {
  return selector
    .split(',')
    .some((s) => matchesSingleChain(el, s.trim(), scopeEl));
}

class FakeElement extends FakeNode {
  readonly tagName: string;
  readonly ownerDocument: FakeDocument;
  readonly attributes = new Map<string, string>();
  readonly classList: FakeClassList;
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string | undefined>;
  hidden = false;
  inert = false;
  draggable = false;
  scrollTop = 0;
  scrollLeft = 0;
  tabIndex = -1;
  private _innerHtmlWriteCount = 0;

  constructor(tagName: string, ownerDocument: FakeDocument) {
    super();
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.classList = new FakeClassList(this);
    this.dataset = new Proxy<Record<string, string | undefined>>(
      {},
      {
        get: (_target, prop) => {
          if (typeof prop !== 'string') return undefined;
          return this.attributes.get(`data-${camelToKebab(prop)}`);
        },
        set: (_target, prop, value) => {
          if (typeof prop === 'string') {
            const attrName = `data-${camelToKebab(prop)}`;
            if (value === undefined) this.attributes.delete(attrName);
            else this.attributes.set(attrName, String(value));
          }
          return true;
        },
        ownKeys: () => {
          const keys: string[] = [];
          for (const k of this.attributes.keys()) {
            if (k.startsWith('data-')) keys.push(kebabToCamel(k.slice(5)));
          }
          return keys;
        },
        getOwnPropertyDescriptor: (_target, prop) => {
          if (typeof prop === 'string' && this.attributes.has(`data-${camelToKebab(prop)}`)) {
            return { enumerable: true, configurable: true };
          }
          return undefined;
        },
      }
    );
  }

  get innerHtmlWriteCount(): number {
    return this._innerHtmlWriteCount;
  }

  resetInnerHtmlWriteCount(): void {
    this._innerHtmlWriteCount = 0;
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

  get title(): string {
    return this.attributes.get('title') ?? '';
  }
  set title(v: string) {
    this.setAttribute('title', v);
  }

  get type(): string {
    return this.attributes.get('type') ?? '';
  }
  set type(v: string) {
    this.setAttribute('type', v);
  }

  get src(): string {
    return this.attributes.get('src') ?? '';
  }
  set src(v: string) {
    this.setAttribute('src', v);
  }

  get alt(): string {
    return this.attributes.get('alt') ?? '';
  }
  set alt(v: string) {
    this.setAttribute('alt', v);
  }

  get disabled(): boolean {
    return this.attributes.has('disabled');
  }
  set disabled(v: boolean) {
    if (v) this.attributes.set('disabled', '');
    else this.attributes.delete('disabled');
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
  }

  getAttribute(name: string): string | null {
    return this.attributes.has(name) ? this.attributes.get(name)! : null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  get textContent(): string {
    const parts: string[] = [];
    for (const c of this.childNodes) {
      if (c instanceof FakeTextNode) parts.push(c.data);
      else if (c instanceof FakeElement) parts.push(c.textContent);
    }
    return parts.join('');
  }

  set textContent(v: string) {
    for (const c of [...this.childNodes]) c.parentNode = null;
    this.childNodes.length = 0;
    if (v !== '') {
      this.appendChild(new FakeTextNode(String(v)));
    }
  }

  get innerHTML(): string {
    return this.childNodes
      .map((c) => {
        if (c instanceof FakeTextNode) return c.data;
        if (c instanceof FakeElement) {
          const attrs = [...c.attributes.entries()]
            .map(([k, val]) => `${k}="${val}"`)
            .join(' ');
          const tag = c.tagName.toLowerCase();
          return `<${tag}${attrs ? ` ${attrs}` : ''}>${c.innerHTML}</${tag}>`;
        }
        return '';
      })
      .join('');
  }

  set innerHTML(html: string) {
    this._innerHtmlWriteCount += 1;
    for (const c of [...this.childNodes]) c.parentNode = null;
    this.childNodes.length = 0;
    if (!html) return;
    for (const node of parseHtmlFragment(html, this.ownerDocument)) {
      this.appendChild(node);
    }
  }

  matches(selector: string): boolean {
    return matchesSelector(this, selector);
  }

  closest(selector: string): FakeElement | null {
    let cur: FakeElement | null = this;
    while (cur) {
      if (cur.matches(selector)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const out: FakeElement[] = [];
    const visit = (node: FakeElement): void => {
      for (const child of node.children) {
        if (matchesSelector(child, selector, this)) {
          out.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return out;
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  click(): void {
    if (this.disabled) return;
    this.dispatchEvent(new FakeEvent('click', { bubbles: true }));
  }

  focus(_opts?: { readonly preventScroll?: boolean }): void {
    const prev = this.ownerDocument.activeElement;
    if (prev && prev !== this) {
      this.ownerDocument.activeElement = this;
      prev.dispatchEvent(new FakeEvent('blur', { bubbles: false }));
    } else {
      this.ownerDocument.activeElement = this;
    }
    this.dispatchEvent(new FakeEvent('focus', { bubbles: false }));
  }

  blur(): void {
    if (this.ownerDocument.activeElement === this) {
      this.ownerDocument.activeElement = null;
      this.dispatchEvent(new FakeEvent('blur', { bubbles: false }));
    }
  }

  getBoundingClientRect(): {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
    x: number;
    y: number;
    toJSON: () => Record<string, never>;
  } {
    return {
      left: 0,
      top: 0,
      right: 320,
      bottom: 320,
      width: 320,
      height: 320,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
  }
}

class FakeStorage {
  private readonly store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
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

class FakeDocument extends FakeNode {
  readonly body: FakeElement;
  activeElement: FakeElement | null = null;
  hidden = false;

  constructor() {
    super();
    this.body = new FakeElement('body', this);
    this.appendChild(this.body);
  }

  createElement(tag: string): FakeElement {
    return new FakeElement(tag, this);
  }

  createElementNS(_ns: string, tag: string): FakeElement {
    return new FakeElement(tag, this);
  }

  querySelector(selector: string): FakeElement | null {
    return this.body.querySelector(selector);
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.body.querySelectorAll(selector);
  }
}

interface IdleQueueEntry {
  readonly id: number;
  readonly cb: () => void;
  cancelled: boolean;
}

class FakeWindow extends FakeNode {
  innerWidth = 1366;
  innerHeight = 768;
  devicePixelRatio = 1;
  location = { search: '' };
  readonly localStorage = new FakeStorage();
  readonly sessionStorage = new FakeStorage();
  readonly document: FakeDocument;
  __STARLINE_INSPECT__?: () => unknown;

  private nextIdleId = 1;
  readonly idleQueue: IdleQueueEntry[] = [];
  private nextRafId = 1;

  constructor(doc: FakeDocument) {
    super();
    this.document = doc;
  }

  setTimeout = globalThis.setTimeout.bind(globalThis);
  clearTimeout = globalThis.clearTimeout.bind(globalThis);
  setInterval = globalThis.setInterval.bind(globalThis);
  clearInterval = globalThis.clearInterval.bind(globalThis);

  requestAnimationFrame = (_cb: () => void): number => {
    return this.nextRafId++;
  };
  cancelAnimationFrame = (_id: number): void => {};

  requestIdleCallback = (cb: () => void, _opts?: { readonly timeout?: number }): number => {
    const id = this.nextIdleId++;
    this.idleQueue.push({ id, cb, cancelled: false });
    return id;
  };

  cancelIdleCallback = (id: number): void => {
    const entry = this.idleQueue.find((e) => e.id === id);
    if (entry) entry.cancelled = true;
  };

  flushIdleCallbacks(): number {
    let executed = 0;
    while (this.idleQueue.length > 0) {
      const entry = this.idleQueue.shift()!;
      if (!entry.cancelled) {
        entry.cb();
        executed += 1;
      }
    }
    return executed;
  }
}

interface InstalledDomEnv {
  readonly window: FakeWindow;
  readonly document: FakeDocument;
  restore: () => void;
}

function installFakeDom(): InstalledDomEnv {
  const g = globalThis as Record<string, unknown>;
  const prevWindow = g.window;
  const prevDocument = g.document;
  const prevLocalStorage = g.localStorage;
  const prevSessionStorage = g.sessionStorage;
  const prevRaf = g.requestAnimationFrame;
  const prevCancelRaf = g.cancelAnimationFrame;
  const prevRic = g.requestIdleCallback;
  const prevCancelRic = g.cancelIdleCallback;

  const doc = new FakeDocument();
  const win = new FakeWindow(doc);

  g.window = win;
  g.document = doc;
  g.localStorage = win.localStorage;
  g.sessionStorage = win.sessionStorage;
  g.requestAnimationFrame = win.requestAnimationFrame;
  g.cancelAnimationFrame = win.cancelAnimationFrame;
  g.requestIdleCallback = win.requestIdleCallback;
  g.cancelIdleCallback = win.cancelIdleCallback;

  return {
    window: win,
    document: doc,
    restore: () => {
      g.window = prevWindow;
      g.document = prevDocument;
      g.localStorage = prevLocalStorage;
      g.sessionStorage = prevSessionStorage;
      g.requestAnimationFrame = prevRaf;
      g.cancelAnimationFrame = prevCancelRaf;
      g.requestIdleCallback = prevRic;
      g.cancelIdleCallback = prevCancelRic;
    },
  };
}

// ---------------------------------------------------------------------------
// Shared Test Fixture Builders
// ---------------------------------------------------------------------------

function buildArrangeBay(): V2CargoBayState {
  const laser = createV2EquipmentInstance({
    instanceId: 'eq_laser_1',
    kind: 'laser',
    quality: 'common',
    origin: 'loan',
    acquiredDepth: 0,
    location: 'bay',
  });
  const battery = createV2EquipmentInstance({
    instanceId: 'eq_battery_1',
    kind: 'battery',
    quality: 'common',
    origin: 'loot',
    acquiredDepth: 1,
    location: 'staging',
  });
  return {
    shipId: 'cannon_skiff',
    placed: [{ item: laser, x: 0, y: 0, rotation: 0 }],
    staging: [{ item: battery, rotation: 0 }],
    discardedThisArrange: [],
  };
}

function buildArrangeRun(overrides?: Partial<V2RunState>): V2RunState {
  const base = createV2TutorialRun('run_persist_test');
  return {
    ...base,
    phase: 'ARRANGE',
    currentNodeId: 'L1A',
    visitedNodeIds: ['L1A'],
    bay: buildArrangeBay(),
    ...overrides,
  };
}

function buildWreckRun(): V2RunState {
  const raw = createV2TutorialRun('run_wreck_test');
  const readyForWreck: V2RunState = {
    ...raw,
    phase: 'MAP',
    currentNodeId: 'L1A',
    visitedNodeIds: ['L1A'],
    bay: { ...raw.bay, staging: [] },
  };
  const res = selectV2MapNode(readyForWreck, 'L2A');
  if (!res.ok) {
    throw new Error(res.error ?? 'Failed to enter tutorial wreck L2A');
  }
  return res.run;
}

function cellCenterPoint(cols: number, rows: number, cx: number, cy: number): { x: number; y: number } {
  const cellW = 320 / cols;
  const cellH = 320 / rows;
  return {
    x: cx * cellW + cellW * 0.5,
    y: cy * cellH + cellH * 0.5,
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Test Suites (F01, F02, F03, F04)
// ---------------------------------------------------------------------------

describe('M0 Foundation UI Persistence & Performance Suite (F01-F04)', () => {
  let dom: InstalledDomEnv;

  beforeEach(() => {
    phaserTestHarness.autoReady = true;
    phaserTestHarness.lastGame = null;
    phaserTestHarness.deferCreateKeys.clear();
    clearTacticalDeltaCache();
    dom = installFakeDom();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    dom.restore();
    clearTacticalDeltaCache();
  });

  // =========================================================================
  // F01 — Persistent CargoGridV2Component & Local Arrange Refresh
  // =========================================================================
  describe('F01: Persistent CargoGridV2Component & Local Refresh', () => {
    it('keeps exactly 1 CargoGridV2Component instance across 10 consecutive drops in ARRANGE, preserving selected/focusedCell/prevLinkCount/lastSnappedId and firing energyLink SFX', async () => {
      const save = { ...createFreshV2SaveData(), activeRun: buildArrangeRun() };
      persistV2SaveData(dom.window.localStorage as unknown as Storage, save);
      dom.window.sessionStorage.setItem('starline_v2_title_entered', '1');

      const destroySpy = vi.spyOn(CargoGridV2Component.prototype, 'destroy');
      const setCallbacksSpy = vi.spyOn(CargoGridV2Component.prototype, 'setCallbacks');
      const showStageSpy = vi.spyOn(PhaserHost.prototype, 'showV2Stage');
      const updateVisualSpy = vi.spyOn(PhaserHost.prototype, 'updateV2ShipVisualSpec');
      const playSfxSpy = vi.spyOn(soundEngine, 'play');

      const mountEl = dom.document.createElement('div');
      dom.document.body.appendChild(mountEl);

      const controller = new V2AppController(mountEl as unknown as HTMLElement, {
        onSwitchToV1: () => {},
      });
      controller.init();
      await flushMicrotasks();

      const initialCargoMount = mountEl.querySelector('#v2-cargo-mount')!;
      const initialBoard = mountEl.querySelector('.v2-cargo-board')!;
      expect(initialCargoMount).not.toBeNull();
      expect(initialBoard).not.toBeNull();

      showStageSpy.mockClear();
      updateVisualSpy.mockClear();
      setCallbacksSpy.mockClear();
      playSfxSpy.mockClear();

      // Drop #1: Staging battery (auto-selected) placed at (1,0) adjacent to laser at (0,0) -> triggers energyLink!
      const dropTargets: readonly [number, number][] = [
        [1, 0], // Drop 1: from staging -> links with laser (0,0) -> prevLinkCount 0 -> 1 -> energyLink!
        [2, 0], // Drop 2: move grid -> (2,0)
        [3, 0], // Drop 3
        [3, 1], // Drop 4
        [2, 1], // Drop 5
        [2, 2], // Drop 6
        [3, 2], // Drop 7
        [3, 3], // Drop 8
        [2, 3], // Drop 9
        [1, 0], // Drop 10: re-adjacent to laser -> links again -> energyLink!
      ];

      for (let i = 0; i < dropTargets.length; i++) {
        const [tx, ty] = dropTargets[i];
        const pt = cellCenterPoint(4, 4, tx, ty);
        initialBoard.dispatchEvent(
          new FakeEvent('pointerdown', {
            bubbles: true,
            button: 0,
            pointerType: 'mouse',
            clientX: pt.x,
            clientY: pt.y,
          })
        );
        // Same mount & board DOM identity on every single drop
        expect(mountEl.querySelector('#v2-cargo-mount')).toBe(initialCargoMount);
        expect(mountEl.querySelector('.v2-cargo-board')).toBe(initialBoard);

        const droppedTile = initialBoard.querySelector('[data-instance-id="eq_battery_1"]')!;
        expect(droppedTile).not.toBeNull();
        expect(droppedTile.classList.contains('selected')).toBe(true);
        expect(droppedTile.classList.contains('just-snapped')).toBe(true);
      }

      // Instance count === 1 (0 destroys across all 10 drops; reused via setCallbacks 10 times)
      expect(destroySpy).toHaveBeenCalledTimes(0);
      expect(setCallbacksSpy).toHaveBeenCalledTimes(10);

      // Local Arrange refresh skipped showV2Stage() completely and updated hardpoints via updateV2ShipVisualSpec
      expect(showStageSpy).toHaveBeenCalledTimes(0);
      expect(updateVisualSpy).toHaveBeenCalledTimes(10);

      // energyLink SFX fired when battery linked with laser on drop #1 and drop #10
      const energyLinkCalls = playSfxSpy.mock.calls.filter((args) => args[0] === 'energyLink');
      expect(energyLinkCalls.length).toBeGreaterThanOrEqual(2);

      // Focused cell & selection survived onto final drop target (1,0)
      const focusedCell = initialBoard.querySelector('.cargo-cell[data-cx="1"][data-cy="0"]')!;
      expect(focusedCell.tabIndex).toBe(0);

      // Clean teardown on destroy() removes all CargoGridV2 window listeners
      controller.destroy();
      expect(destroySpy).toHaveBeenCalledTimes(1);
      expect(dom.window.getListenerCount('pointermove')).toBe(0);
      expect(dom.window.getListenerCount('pointerup')).toBe(0);
      expect(dom.window.getListenerCount('pointercancel')).toBe(0);
      expect(dom.window.getListenerCount('keydown')).toBe(0);
    });

    it('reuses CargoGridV2 across ship switches without spurious energyLink and fixes trial prepare lock banner', async () => {
      const mount = dom.document.createElement('div');
      dom.document.body.appendChild(mount);
      const playSfxSpy = vi.spyOn(soundEngine, 'play');

      let currentBay = buildArrangeBay();
      const grid = new CargoGridV2Component(mount as unknown as HTMLElement, {
        onBayChange: (next) => {
          currentBay = next;
        },
        onPrepareRemoveItem: undefined,
      });

      // Render in prepareMode with trial lock (onPrepareRemoveItem === undefined)
      const trialBay: V2CargoBayState = {
        shipId: 'cannon_skiff',
        placed: [
          {
            item: createV2EquipmentInstance({
              instanceId: 'trial_laser',
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
      grid.render(trialBay, true, { prepareMode: true });

      // Click placed trial laser -> inspector must show trial-lock chip, NOT #btn-v2-prep-remove!
      const board = mount.querySelector('.v2-cargo-board')!;
      const pt = cellCenterPoint(4, 4, 0, 0);
      board.dispatchEvent(
        new FakeEvent('pointerdown', {
          bubbles: true,
          button: 0,
          pointerType: 'mouse',
          clientX: pt.x,
          clientY: pt.y,
        })
      );
      expect(mount.querySelector('#btn-v2-prep-remove')).toBeNull();
      expect(mount.textContent).toContain('全息模板锁定');

      // Switch ship from cannon_skiff (4x4) to heavy_freighter (5x4) with pre-linked items -> NO spurious energyLink!
      playSfxSpy.mockClear();
      const linkedFreighterBay: V2CargoBayState = {
        shipId: 'heavy_freighter',
        placed: [
          trialBay.placed[0],
          {
            item: createV2EquipmentInstance({
              instanceId: 'trial_bat',
              kind: 'battery',
              quality: 'common',
              origin: 'loan',
              acquiredDepth: 0,
              location: 'bay',
            }),
            x: 1,
            y: 0,
            rotation: 0,
          },
        ],
        staging: [],
        discardedThisArrange: [],
      };
      grid.render(linkedFreighterBay, true, { prepareMode: true });
      expect(board.dataset.cols).toBe('5');
      expect(board.dataset.rows).toBe('4');
      expect(playSfxSpy.mock.calls.filter((a) => a[0] === 'energyLink')).toHaveLength(0);
      expect(grid.getUiStateSnapshot().prevLinkCount).toBeGreaterThan(0);
      expect(currentBay.shipId).toBe('cannon_skiff');

      grid.destroy();
    });
  });

  // =========================================================================
  // F02 — Phaser Stage playbackKey Deduplication & Wreck Cut FX Survival
  // =========================================================================
  describe('F02: Phaser Stage playbackKey Deduplication', () => {
    it('buildV2StaticStagePlaybackKey varies on every visual axis (including sectorId on shared sectorIndex=4) and ignores non-stage state', () => {
      const unitA = buildEncounterUnits('armored', 2, 'uA');
      const unitB = buildEncounterUnits('swarm', 2, 'uB');

      const base = {
        mode: 'arrange' as const,
        runId: 'run_1',
        nodeId: 'L1A',
        shipId: 'cannon_skiff' as const,
        sectorId: 'near_orbit' as const,
        sectorIndex: 4 as const,
        eventBackdrop: null,
        units: [] as readonly typeof unitA[number][],
      };

      const baseKey = buildV2StaticStagePlaybackKey(base);
      expect(buildV2StaticStagePlaybackKey({ ...base })).toBe(baseKey);

      // Vary each axis independently
      expect(buildV2StaticStagePlaybackKey({ ...base, mode: 'map' })).not.toBe(baseKey);
      expect(buildV2StaticStagePlaybackKey({ ...base, runId: 'run_2' })).not.toBe(baseKey);
      expect(buildV2StaticStagePlaybackKey({ ...base, nodeId: 'L2A' })).not.toBe(baseKey);
      expect(buildV2StaticStagePlaybackKey({ ...base, shipId: 'shield_cruiser' })).not.toBe(baseKey);
      // Critical V3 tint distinction on shared sectorIndex = 4!
      expect(buildV2StaticStagePlaybackKey({ ...base, sectorId: 'frozen_graveyard' })).not.toBe(baseKey);
      expect(buildV2StaticStagePlaybackKey({ ...base, sectorIndex: 2 })).not.toBe(baseKey);
      expect(buildV2StaticStagePlaybackKey({ ...base, eventBackdrop: 'wreck' })).not.toBe(baseKey);
      expect(buildV2StaticStagePlaybackKey({ ...base, units: unitA })).not.toBe(baseKey);
      expect(buildV2StaticStagePlaybackKey({ ...base, units: unitA })).not.toBe(
        buildV2StaticStagePlaybackKey({ ...base, units: unitB })
      );
    });

    it('V2StaticStageSyncTracker deduplicates static refreshes, handles ambush misses, mode desyncs, and resets', () => {
      const tracker = new V2StaticStageSyncTracker();
      let inV2Stage = false;
      let showCount = 0;
      let updateSpecCount = 0;
      const host: V2StaticStageHostLike<V2StagePlayback> = {
        isV2StageMode: () => inV2Stage,
        showV2Stage: () => {
          inV2Stage = true;
          showCount += 1;
        },
        updateV2ShipVisualSpec: () => {
          updateSpecCount += 1;
        },
      };

      const spec = deriveV2ShipVisualSpec(buildArrangeBay());
      const wreckInput = {
        mode: 'wreck' as const,
        runId: 'run_w',
        nodeId: 'L2A',
        shipId: 'cannon_skiff' as const,
        sectorId: 'near_orbit' as const,
        sectorIndex: 2 as const,
        eventBackdrop: 'wreck' as const,
        units: [] as const,
      };
      const mkPb = (key: string): V2StagePlayback => ({
        playbackKey: key,
        shipId: 'cannon_skiff',
        shipVisualSpec: spec,
        sectorId: 'near_orbit',
        sectorIndex: 2,
        eventBackdrop: 'wreck',
        units: [],
        simulation: null,
        settings: DEFAULT_SETTINGS,
      });

      expect(tracker.sync(host, wreckInput, spec, mkPb).reused).toBe(false);
      expect(showCount).toBe(1);

      // 3 post-cut refreshes on same wreck node
      for (let i = 0; i < 3; i++) {
        expect(tracker.sync(host, wreckInput, spec, mkPb).reused).toBe(true);
      }
      expect(showCount).toBe(1);
      expect(updateSpecCount).toBe(3);

      // Ambush transition on SAME nodeId: mode -> pre_combat, backdrop -> null, units non-empty
      const ambushUnits = buildEncounterUnits('patrol', 2, 'ambush');
      const ambushRes = tracker.sync(
        host,
        { ...wreckInput, mode: 'pre_combat', eventBackdrop: null, units: ambushUnits },
        spec,
        (key) => ({ ...mkPb(key), eventBackdrop: null, units: ambushUnits })
      );
      expect(ambushRes.reused).toBe(false);
      expect(showCount).toBe(2);

      // Arrange edits: 1 initial + 10 drags -> 1 showV2Stage, 10 updateV2ShipVisualSpec
      showCount = 0;
      updateSpecCount = 0;
      const arrangeInput = { ...wreckInput, mode: 'arrange' as const, eventBackdrop: null };
      expect(tracker.sync(host, arrangeInput, spec, mkPb).reused).toBe(false);
      for (let i = 0; i < 10; i++) {
        expect(tracker.sync(host, arrangeInput, spec, mkPb).reused).toBe(true);
      }
      expect(showCount).toBe(1);
      expect(updateSpecCount).toBe(10);

      // Scene mode desync (host switched to BaseScene) forces showV2Stage
      inV2Stage = false;
      expect(tracker.sync(host, arrangeInput, spec, mkPb).reused).toBe(false);
      expect(showCount).toBe(2);

      // Explicit reset (Base / Prepare Demo / Live Combat) forces showV2Stage
      tracker.reset();
      expect(tracker.getActiveKey()).toBeNull();
      expect(tracker.sync(host, arrangeInput, spec, mkPb).reused).toBe(false);
      expect(showCount).toBe(3);
    });

    it('real V2CombatScene preserves wreck cut rings across deduplicated refresh and NEVER spawns orphan turrets on wreck backdrop', () => {
      const scene = new V2CombatScene();
      const game = new MockPhaserGame({ scene: [scene as unknown as MockPhaserSceneInstance] });
      const nonEmptySpec = deriveV2ShipVisualSpec(buildArrangeBay());

      const wreckPb: V2StagePlayback = {
        playbackKey: 'wreck|run_1|L2A|cannon_skiff|near_orbit|2|wreck|none',
        shipId: 'cannon_skiff',
        shipVisualSpec: nonEmptySpec,
        sectorId: 'near_orbit',
        sectorIndex: 2,
        eventBackdrop: 'wreck',
        units: [],
        simulation: null,
        settings: DEFAULT_SETTINGS,
      };
      game.scene.start('V2CombatScene', { playback: wreckPb });

      let snap = scene.getStagePresentationSnapshot();
      expect(snap.playerVisible).toBe(false);
      expect(snap.moduleCount).toBe(0);
      expect(snap.activeRings).toBe(0);

      // Cut sparks pushed on frame 0
      scene.triggerWreckCutFx(0.5, 0.45);
      expect(scene.getStagePresentationSnapshot().activeRings).toBe(2);

      // Deduplicated setPlayback + updateShipVisualSpec must NOT wipe rings AND must NOT spawn orphan modules!
      scene.setPlayback(wreckPb);
      scene.updateShipVisualSpec(nonEmptySpec);
      snap = scene.getStagePresentationSnapshot();
      expect(snap.activeRings).toBe(2);
      expect(snap.moduleCount).toBe(0);
      expect(snap.playerVisible).toBe(false);

      // Genuine transition to pre_combat (different playbackKey + units) resets FX & mounts player ship + modules
      const enemyUnits = buildEncounterUnits('patrol', 1, 'e1');
      const preCombatPb: V2StagePlayback = {
        playbackKey: 'pre_combat|run_1|L2A|cannon_skiff|near_orbit|2|none|e1',
        shipId: 'cannon_skiff',
        shipVisualSpec: nonEmptySpec,
        sectorId: 'near_orbit',
        sectorIndex: 2,
        eventBackdrop: null,
        units: enemyUnits,
        simulation: null,
        settings: DEFAULT_SETTINGS,
      };
      scene.setPlayback(preCombatPb);
      snap = scene.getStagePresentationSnapshot();
      expect(snap.playerVisible).toBe(true);
      expect(snap.enemyCount).toBe(1);
      expect(snap.moduleCount).toBeGreaterThan(0);
      expect(snap.activeRings).toBe(0);

      // Updating ship visual spec during active stage preserves enemies and active FX rings
      scene.triggerWreckCutFx(0.3, 0.5);
      const emptySpec = deriveV2ShipVisualSpec({
        shipId: 'cannon_skiff',
        placed: [],
        staging: [],
        discardedThisArrange: [],
      });
      scene.updateShipVisualSpec(emptySpec);
      snap = scene.getStagePresentationSnapshot();
      expect(snap.enemyCount).toBe(1);
      expect(snap.activeRings).toBe(2);
      expect(snap.moduleCount).toBe(0);
    });

    it('real V2AppController wreck onCutSpot fires cut FX without frame-0 wipe and invalidates key on extract', async () => {
      const save = { ...createFreshV2SaveData(), activeRun: buildWreckRun() };
      persistV2SaveData(dom.window.localStorage as unknown as Storage, save);
      dom.window.sessionStorage.setItem('starline_v2_title_entered', '1');

      const showStageSpy = vi.spyOn(PhaserHost.prototype, 'showV2Stage');
      const cutFxSpy = vi.spyOn(PhaserHost.prototype, 'triggerV2WreckCutFx');

      const mountEl = dom.document.createElement('div');
      dom.document.body.appendChild(mountEl);

      const controller = new V2AppController(mountEl as unknown as HTMLElement, {
        onSwitchToV1: () => {},
      });
      controller.init();
      await flushMicrotasks();

      expect(showStageSpy).toHaveBeenCalledTimes(1);
      showStageSpy.mockClear();
      cutFxSpy.mockClear();

      const cutBtn = mountEl.querySelector('[data-testid="wreck-cut-reactor"]')!;
      expect(cutBtn).not.toBeNull();
      cutBtn.click();

      // Cut FX fired and survived syncAll() with ZERO showV2Stage resets!
      expect(cutFxSpy).toHaveBeenCalledTimes(1);
      expect(cutFxSpy).toHaveBeenCalledWith(0.5, 0.45);
      expect(showStageSpy).toHaveBeenCalledTimes(0);

      const liveScene = phaserTestHarness.lastGame?.getScene<MockPhaserSceneInstance>('V2CombatScene') as
        | V2CombatScene
        | undefined;
      expect(liveScene).toBeDefined();
      const postCutSnap = liveScene!.getStagePresentationSnapshot();
      expect(postCutSnap.activeRings).toBe(2);
      expect(postCutSnap.moduleCount).toBe(0);

      // S08: Complete in-flight cut via skip cue (still ZERO showV2Stage resets!) before extracting
      const skipCutBtn = mountEl.querySelector('[data-testid="btn-skip-wreck-cut"]');
      expect(skipCutBtn).not.toBeNull();
      skipCutBtn!.click();
      expect(showStageSpy).toHaveBeenCalledTimes(0);

      // Genuine transition: extract from wreck -> leaves wreck stage -> calls showV2Stage!
      const extractBtn = mountEl.querySelector('[data-testid="btn-wreck-extract"]')!;
      expect(extractBtn).not.toBeNull();
      expect(extractBtn.disabled).toBe(false);
      extractBtn.click();
      expect(showStageSpy).toHaveBeenCalledTimes(1);

      controller.destroy();
    });

    it('PhaserHost applies latest updateV2ShipVisualSpec when patched before READY fires', () => {
      phaserTestHarness.autoReady = false;
      const container = dom.document.createElement('div');
      dom.document.body.appendChild(container);
      const host = new PhaserHost(container as unknown as HTMLElement);

      const emptySpec = deriveV2ShipVisualSpec({
        shipId: 'cannon_skiff',
        placed: [],
        staging: [],
        discardedThisArrange: [],
      });
      const armedSpec = deriveV2ShipVisualSpec(buildArrangeBay());

      host.showV2Stage({
        playbackKey: 'arrange|run_boot|L1A|cannon_skiff|near_orbit|1|none|none',
        shipId: 'cannon_skiff',
        shipVisualSpec: emptySpec,
        sectorId: 'near_orbit',
        sectorIndex: 1,
        eventBackdrop: null,
        units: [],
        simulation: null,
        settings: DEFAULT_SETTINGS,
      });

      // Mutate ship visual spec BEFORE Phaser READY fires
      host.updateV2ShipVisualSpec(armedSpec);

      // Now boot completes
      phaserTestHarness.lastGame!.emitReady();

      const scene = phaserTestHarness.lastGame!.getScene<MockPhaserSceneInstance>('V2CombatScene') as
        | V2CombatScene
        | undefined;
      expect(scene).toBeDefined();
      expect(scene!.getStagePresentationSnapshot().moduleCount).toBeGreaterThan(0);

      host.destroy();
    });

    it('PhaserHost guards mid-preload V2CombatScene against Phaser 3.90 start() drop, applies live combat handoff on preload finish, and stops LOADING scene on mode switch', async () => {
      phaserTestHarness.deferCreateKeys.add('V2CombatScene');
      const container = dom.document.createElement('div');
      dom.document.body.appendChild(container);
      const host = new PhaserHost(container as unknown as HTMLElement);
      await flushMicrotasks();

      const game = phaserTestHarness.lastGame!;
      const scene = game.getScene<MockPhaserSceneInstance>('V2CombatScene') as unknown as V2CombatScene &
        MockPhaserSceneInstance;
      const bay = buildArrangeBay();
      const emptySpec = deriveV2ShipVisualSpec({
        shipId: 'cannon_skiff',
        placed: [],
        staging: [],
        discardedThisArrange: [],
      });
      const armedSpec = deriveV2ShipVisualSpec(bay);
      const units = buildEncounterUnits('patrol', 1, 'preload_e1');

      // Different enemy names with identical stats MUST yield distinct playbackKeys (role fallback tint)
      const renamedUnits = units.map((u) => ({ ...u, name: '火炮哨兵' }));
      expect(
        buildV2StaticStagePlaybackKey({
          mode: 'pre_combat',
          runId: 'run_preload',
          nodeId: 'L1A',
          shipId: 'cannon_skiff',
          sectorId: 'near_orbit',
          sectorIndex: 1,
          eventBackdrop: null,
          units,
        })
      ).not.toBe(
        buildV2StaticStagePlaybackKey({
          mode: 'pre_combat',
          runId: 'run_preload',
          nodeId: 'L1A',
          shipId: 'cannon_skiff',
          sectorId: 'near_orbit',
          sectorIndex: 1,
          eventBackdrop: null,
          units: renamedUnits,
        })
      );

      const preCombatKey = buildV2StaticStagePlaybackKey({
        mode: 'pre_combat',
        runId: 'run_preload',
        nodeId: 'L1A',
        shipId: 'cannon_skiff',
        sectorId: 'near_orbit',
        sectorIndex: 1,
        eventBackdrop: null,
        units,
      });

      host.showV2Stage({
        playbackKey: preCombatKey,
        shipId: 'cannon_skiff',
        shipVisualSpec: emptySpec,
        sectorId: 'near_orbit',
        sectorIndex: 1,
        eventBackdrop: null,
        units,
        simulation: null,
        settings: DEFAULT_SETTINGS,
      });

      const v2Starts = () => game.startedScenes.filter((s) => s.key === 'V2CombatScene').length;
      expect(scene.sys.settings.status).toBe(MOCK_SCENE_STATUS.LOADING);
      expect(game.scene.isActive('V2CombatScene')).toBe(false);
      expect(host.isV2StageMode()).toBe(true);
      expect(v2Starts()).toBe(1);

      // Same-key static update while still LOADING deduplicates without calling scene.start again
      host.showV2Stage({
        playbackKey: preCombatKey,
        shipId: 'cannon_skiff',
        shipVisualSpec: armedSpec,
        sectorId: 'near_orbit',
        sectorIndex: 1,
        eventBackdrop: null,
        units,
        simulation: null,
        settings: DEFAULT_SETTINGS,
      });
      expect(v2Starts()).toBe(1);

      // Rapid live-combat launch (T5-01 scenario) while still LOADING MUST NOT call scene.start() again
      const sim = simulateV2Combat({
        resultId: 'preload_live_sim',
        bay,
        startingHp: 30,
        maxHp: 30,
        units,
        targetPolicy: 'weakest',
        sectorId: 'near_orbit',
      });
      const onComplete = vi.fn();
      host.showV2Stage({
        shipId: 'cannon_skiff',
        shipVisualSpec: armedSpec,
        sectorId: 'near_orbit',
        sectorIndex: 1,
        eventBackdrop: null,
        units,
        simulation: sim,
        settings: DEFAULT_SETTINGS,
        onComplete,
      });
      expect(v2Starts()).toBe(1);
      expect(scene.sys.settings.status).toBe(MOCK_SCENE_STATUS.LOADING);

      // When preload completes, create() runs live combat simulation cleanly (NOT frozen on pre_combat!)
      game.finishPreload('V2CombatScene');
      expect(scene.sys.settings.status).toBe(MOCK_SCENE_STATUS.RUNNING);
      expect(game.scene.isActive('V2CombatScene')).toBe(true);
      const snap = scene.getStagePresentationSnapshot();
      expect(snap.appliedPlaybackKey).toBeNull();
      expect(snap.enemyCount).toBe(units.length);
      expect(snap.moduleCount).toBeGreaterThan(0);

      host.skipCombatPlayback();
      expect(onComplete).toHaveBeenCalledTimes(1);

      // Switch to V2 Base, then re-enter LOADING V2CombatScene and immediately switch back to V2 Base:
      // in-flight LOADING V2CombatScene MUST be stopped cleanly!
      const dioramaState = {
        activeShipId: 'cannon_skiff' as const,
        facilityTiers: { contract_hub: 1, research_lab: 0, drydock_tier2: 0, stargate_relay: 0 },
        restoredRelicIds: [],
        campaignAct: 'act1' as const,
        stargatePowered: false,
      };
      host.showV2Base(dioramaState);
      expect(scene.sys.settings.status).toBe(MOCK_SCENE_STATUS.SHUTDOWN);
      expect(game.scene.isActive('BaseScene')).toBe(true);

      host.showV2Stage({
        playbackKey: preCombatKey,
        shipId: 'cannon_skiff',
        shipVisualSpec: armedSpec,
        sectorId: 'near_orbit',
        sectorIndex: 1,
        eventBackdrop: null,
        units,
        simulation: null,
        settings: DEFAULT_SETTINGS,
      });
      expect(scene.sys.settings.status).toBe(MOCK_SCENE_STATUS.LOADING);
      expect(v2Starts()).toBe(2);

      host.showV2Base(dioramaState);
      expect(scene.sys.settings.status).toBe(MOCK_SCENE_STATUS.SHUTDOWN);
      expect(game.scene.isActive('BaseScene')).toBe(true);

      host.destroy();
    });

    it('PhaserHost recovers cleanly when V2CombatScene is externally stopped and showV2Stage is called with the same playbackKey', async () => {
      const container = dom.document.createElement('div');
      dom.document.body.appendChild(container);
      const host = new PhaserHost(container as unknown as HTMLElement);
      await flushMicrotasks();

      const game = phaserTestHarness.lastGame!;
      const spec = deriveV2ShipVisualSpec(buildArrangeBay());
      const staticPb: V2StagePlayback = {
        playbackKey: 'arrange|run_ext_stop|L1A|cannon_skiff|near_orbit|1|none|none',
        shipId: 'cannon_skiff',
        shipVisualSpec: spec,
        sectorId: 'near_orbit',
        sectorIndex: 1,
        eventBackdrop: null,
        units: [],
        simulation: null,
        settings: DEFAULT_SETTINGS,
      };

      host.showV2Stage(staticPb);
      expect(host.isV2StageMode()).toBe(true);
      expect(game.scene.isActive('V2CombatScene')).toBe(true);
      expect(game.startedScenes.filter((s) => s.key === 'V2CombatScene')).toHaveLength(1);

      // External stop transitions scene to SHUTDOWN -> isV2StageMode() MUST immediately report false
      game.scene.stop('V2CombatScene');
      expect(game.scene.isActive('V2CombatScene')).toBe(false);
      expect(host.isV2StageMode()).toBe(false);

      // Calling showV2Stage with the identical static playbackKey MUST bypass dedup and restart scene!
      host.showV2Stage(staticPb);
      expect(game.startedScenes.filter((s) => s.key === 'V2CombatScene')).toHaveLength(2);
      expect(game.scene.isActive('V2CombatScene')).toBe(true);
      expect(host.isV2StageMode()).toBe(true);

      host.destroy();
    });
  });

  // =========================================================================
  // F03 — tacticalDelta LRU Cache, Idle Scheduling & CargoGridV2 Sub-Render Split
  // =========================================================================
  describe('F03: tacticalDelta Cache & CargoGridV2 Sub-Render Split', () => {
    it('memoizes computeV2PlacementTacticalDelta and findBestPlacementForItem and invalidates cleanly on every pure input change', () => {
      clearTacticalDeltaCache();
      const run = buildArrangeRun();
      const bay = run.bay;
      const stagingItem = bay.staging[0].item;

      type DeltaParams = Parameters<typeof computeV2PlacementTacticalDelta>[0];
      const baseParams: DeltaParams = {
        run,
        bay,
        startingHp: 30,
        maxHp: 30,
        targetPolicy: 'weakest',
        item: stagingItem,
        zone: 'staging',
        sectorId: 'near_orbit',
        crewId: 'engineer',
        crewMasteryTier: 0,
        stargateRelayTier: 0,
      };

      const first = computeV2PlacementTacticalDelta(baseParams);
      const statsAfterFirst = getTacticalDeltaCacheStats();
      expect(statsAfterFirst.deltaMisses).toBe(1);
      expect(statsAfterFirst.deltaHits).toBe(0);
      expect(statsAfterFirst.simulationCalls).toBeGreaterThan(0);

      // Identical call hits cache with 0 additional simulateV2Combat calls
      const second = computeV2PlacementTacticalDelta(baseParams);
      const statsAfterSecond = getTacticalDeltaCacheStats();
      expect(second).toEqual(first);
      expect(statsAfterSecond.deltaHits).toBe(1);
      expect(statsAfterSecond.simulationCalls).toBe(statsAfterFirst.simulationCalls);

      // Direct findBestPlacementForItem cache hit check
      const units = buildEncounterUnits('armored', 2, 'probe');
      const bp1 = findBestPlacementForItem(bay, stagingItem, 30, 30, 'weakest', units, {
        sectorId: 'near_orbit',
      });
      const simCountBeforeBp2 = getTacticalDeltaCacheStats().simulationCalls;
      const bp2 = findBestPlacementForItem(bay, stagingItem, 30, 30, 'weakest', units, {
        sectorId: 'near_orbit',
      });
      expect(bp2).toEqual(bp1);
      expect(getTacticalDeltaCacheStats().bestPlacementHits).toBeGreaterThanOrEqual(1);
      expect(getTacticalDeltaCacheStats().simulationCalls).toBe(simCountBeforeBp2);

      // Verify EVERY pure input mutation triggers a cache miss (ZERO false hits!)
      const mutations: { readonly label: string; readonly params: DeltaParams }[] = [
        {
          label: 'bay placement changed',
          params: {
            ...baseParams,
            bay: {
              ...bay,
              placed: [{ ...bay.placed[0], x: 2, y: 2 }],
            },
          },
        },
        { label: 'startingHp changed', params: { ...baseParams, startingHp: 18 } },
        { label: 'maxHp changed', params: { ...baseParams, maxHp: 40 } },
        { label: 'targetPolicy changed', params: { ...baseParams, targetPolicy: 'highest_threat' } },
        { label: 'sectorId changed', params: { ...baseParams, sectorId: 'frozen_graveyard' } },
        { label: 'crewId changed', params: { ...baseParams, crewId: 'navigator' } },
        { label: 'crewMasteryTier changed', params: { ...baseParams, crewMasteryTier: 2 } },
        { label: 'stargateRelayTier changed', params: { ...baseParams, stargateRelayTier: 2 } },
        {
          label: 'candidateSpot changed',
          params: { ...baseParams, candidateSpot: { x: 1, y: 0, rotation: 0 } },
        },
        {
          label: 'endlessThreat/mutators changed',
          params: {
            ...baseParams,
            run: { ...run, endlessThreat: 3, endlessMutatorIds: ['shield_surge'] },
          },
        },
        {
          label: 'zone changed (placed item)',
          params: { ...baseParams, item: bay.placed[0].item, zone: 'grid' },
        },
      ];

      for (const m of mutations) {
        const beforeMisses = getTacticalDeltaCacheStats().deltaMisses;
        computeV2PlacementTacticalDelta(m.params);
        expect(getTacticalDeltaCacheStats().deltaMisses, m.label).toBe(beforeMisses + 1);
      }

      // bayHash ignores staging rotation changes
      const rotatedStagingBay: V2CargoBayState = {
        ...bay,
        staging: [{ ...bay.staging[0], rotation: 1 }],
      };
      expect(computeV2BayHash(rotatedStagingBay)).toBe(computeV2BayHash(bay));

      clearTacticalDeltaCache();
      const cleared = getTacticalDeltaCacheStats();
      expect(cleared.deltaSize).toBe(0);
      expect(cleared.bestPlacementSize).toBe(0);
      expect(cleared.simulationCalls).toBe(0);
    });

    it('arrow-key navigation triggers 0 DOM container rebuilds, 0 cell innerHTML writes, and 0 simulateV2Combat calls', () => {
      const mount = dom.document.createElement('div');
      dom.document.body.appendChild(mount);

      const run = buildArrangeRun();
      const getTacticalDeltaSpy = vi.fn((item, zone) =>
        computeV2PlacementTacticalDelta({
          run,
          bay: run.bay,
          startingHp: run.hp,
          maxHp: run.maxHp,
          targetPolicy: run.targetPolicy,
          item,
          zone,
        })
      );

      const grid = new CargoGridV2Component(mount as unknown as HTMLElement, {
        onBayChange: () => {},
        getTacticalDelta: getTacticalDeltaSpy,
      });

      grid.render(run.bay, true);
      dom.window.flushIdleCallbacks();

      // Capture persistent sub-container identities and all 16 cell identities
      const statsEl = mount.querySelector('[data-cargo-slot="stats"]')!;
      const boardEl = mount.querySelector('[data-cargo-slot="board"]')!;
      const cellsWrapEl = mount.querySelector('[data-cargo-slot="cells"]')!;
      const itemLayerEl = mount.querySelector('[data-cargo-slot="items"]')!;
      const synergySvgEl = mount.querySelector('[data-cargo-slot="synergy"]')!;
      const stagingEl = mount.querySelector('[data-cargo-slot="staging"]')!;
      const inspectorEl = mount.querySelector('[data-cargo-slot="inspector"]')!;
      const allCells = mount.querySelectorAll('.cargo-cell');
      expect(allCells).toHaveLength(16);

      // Focus cell (0,0)
      const cell00 = mount.querySelector('.cargo-cell[data-cx="0"][data-cy="0"]')!;
      cell00.focus();

      // Reset spies & innerHTML write counters before arrow navigation
      getTacticalDeltaSpy.mockClear();
      const simsBefore = getTacticalDeltaCacheStats().simulationCalls;
      for (const c of allCells) c.resetInnerHtmlWriteCount();

      // Navigate Right -> Down -> Left -> Up
      const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
      const expectedCoords = [
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ];

      for (let i = 0; i < keys.length; i++) {
        dom.window.dispatchEvent(new FakeEvent('keydown', { key: keys[i] }));
        const [ex, ey] = expectedCoords[i];
        const expectedCell = mount.querySelector(`.cargo-cell[data-cx="${ex}"][data-cy="${ey}"]`)!;
        expect(dom.document.activeElement).toBe(expectedCell);
        expect(expectedCell.tabIndex).toBe(0);
        expect(expectedCell.classList.contains('kb-focused')).toBe(true);
      }

      // Assert ZERO delta/sim calls, ZERO DOM rebuilds, ZERO cell innerHTML writes!
      expect(getTacticalDeltaSpy).toHaveBeenCalledTimes(0);
      expect(getTacticalDeltaCacheStats().simulationCalls).toBe(simsBefore);
      expect(dom.window.idleQueue).toHaveLength(0);
      expect(mount.querySelector('[data-cargo-slot="stats"]')).toBe(statsEl);
      expect(mount.querySelector('[data-cargo-slot="board"]')).toBe(boardEl);
      expect(mount.querySelector('[data-cargo-slot="cells"]')).toBe(cellsWrapEl);
      expect(mount.querySelector('[data-cargo-slot="items"]')).toBe(itemLayerEl);
      expect(mount.querySelector('[data-cargo-slot="synergy"]')).toBe(synergySvgEl);
      expect(mount.querySelector('[data-cargo-slot="staging"]')).toBe(stagingEl);
      expect(mount.querySelector('[data-cargo-slot="inspector"]')).toBe(inspectorEl);
      const cellsAfter = mount.querySelectorAll('.cargo-cell');
      for (let i = 0; i < allCells.length; i++) {
        expect(cellsAfter[i]).toBe(allCells[i]);
        expect(allCells[i].innerHtmlWriteCount).toBe(0);
      }

      grid.destroy();
    });

    it('discards stale requestIdleCallback delta results when bay mutates before idle executes', () => {
      const mount = dom.document.createElement('div');
      dom.document.body.appendChild(mount);

      const bayA = buildArrangeBay();
      const bayB: V2CargoBayState = {
        ...bayA,
        placed: [{ ...bayA.placed[0], x: 2, y: 2 }],
      };

      const providerA = vi.fn(() => ({
        synergyLine: 'STALE_BAY_A',
        combatDeltaLine: 'STALE_DELTA_A',
        spaceLine: 'STALE_SPACE_A',
        positiveImpact: false,
      }));
      const providerB = vi.fn(() => ({
        synergyLine: 'FRESH_BAY_B',
        combatDeltaLine: 'FRESH_DELTA_B',
        spaceLine: 'FRESH_SPACE_B',
        positiveImpact: true,
      }));

      const grid = new CargoGridV2Component(mount as unknown as HTMLElement, {
        onBayChange: () => {},
        getTacticalDelta: providerA,
      });

      // Render bayA -> queues idle callback #1; inspector MUST NOT have [data-testid="tactical-delta"] yet!
      grid.render(bayA, true);
      expect(mount.querySelector('[data-testid="tactical-delta"]')).toBeNull();
      expect(dom.window.idleQueue).toHaveLength(1);
      const staleEntry = dom.window.idleQueue[0];

      // Mutate to bayB BEFORE flushing idle callback #1
      grid.setCallbacks({ onBayChange: () => {}, getTacticalDelta: providerB });
      grid.render(bayB, true);
      expect(staleEntry.cancelled).toBe(true);

      // Even if the stale callback fires anyway (ignoring cancel), token & bayHash guard MUST discard it!
      staleEntry.cb();
      expect(providerA).toHaveBeenCalledTimes(0);
      expect(mount.querySelector('[data-testid="tactical-delta"]')).toBeNull();

      // Now flush bayB's fresh idle callback -> fresh delta renders cleanly!
      dom.window.flushIdleCallbacks();
      expect(providerB).toHaveBeenCalledTimes(1);
      const deltaEl = mount.querySelector('[data-testid="tactical-delta"]')!;
      expect(deltaEl).not.toBeNull();
      expect(deltaEl.textContent).toContain('FRESH_BAY_B');
      expect(deltaEl.textContent).not.toContain('STALE_BAY_A');

      grid.destroy();
    });

    it('clones cached V2TacticalDelta values so caller mutations never poison deltaCache (equipment + recommendedSpot, non-equipment, and grid parity)', () => {
      clearTacticalDeltaCache();
      const run = buildArrangeRun();
      const bay = run.bay;
      const stagingItem = bay.staging[0].item;
      const eqParams = {
        run,
        bay,
        startingHp: 30,
        maxHp: 30,
        targetPolicy: 'weakest' as const,
        item: stagingItem,
        zone: 'staging' as const,
        sectorId: 'near_orbit' as const,
        crewId: 'engineer' as const,
        crewMasteryTier: 0,
        stargateRelayTier: 0,
      };

      const d1 = computeV2PlacementTacticalDelta(eqParams);
      expect(d1.recommendedSpot).toBeDefined();
      const origSynergy = d1.synergyLine;
      const origCombat = d1.combatDeltaLine;
      const origSpot = { ...d1.recommendedSpot! };
      const simsAfterMiss = getTacticalDeltaCacheStats().simulationCalls;

      // Mutate returned miss object & nested recommendedSpot
      (d1 as { synergyLine: string }).synergyLine = 'POISON_MISS';
      (d1 as { combatDeltaLine: string }).combatDeltaLine = 'POISON_COMBAT';
      (d1.recommendedSpot as { x: number; y: number }).x = 999;
      (d1.recommendedSpot as { x: number; y: number }).y = 888;

      const d2 = computeV2PlacementTacticalDelta(eqParams);
      expect(getTacticalDeltaCacheStats().deltaHits).toBe(1);
      expect(getTacticalDeltaCacheStats().simulationCalls).toBe(simsAfterMiss);
      expect(d2).not.toBe(d1);
      expect(d2.recommendedSpot).not.toBe(d1.recommendedSpot);
      expect(d2.synergyLine).toBe(origSynergy);
      expect(d2.combatDeltaLine).toBe(origCombat);
      expect(d2.recommendedSpot).toStrictEqual(origSpot);

      // Mutate returned hit object & nested recommendedSpot
      (d2 as { synergyLine: string }).synergyLine = 'POISON_HIT';
      (d2.recommendedSpot as { x: number }).x = 777;

      const d3 = computeV2PlacementTacticalDelta(eqParams);
      expect(getTacticalDeltaCacheStats().deltaHits).toBe(2);
      expect(d3).not.toBe(d2);
      expect(d3.recommendedSpot).not.toBe(d2.recommendedSpot);
      expect(d3.synergyLine).toBe(origSynergy);
      expect(d3.recommendedSpot).toStrictEqual(origSpot);

      // Non-equipment item (cargo) miss/hit clone isolation & shape parity
      const cargoItem = createV2CargoInstance({
        instanceId: 'cargo_clone_1',
        defId: 'cargo.data_box',
        origin: 'loot',
        acquiredDepth: 1,
        location: 'staging',
      });
      const nonEqParams = { ...eqParams, item: cargoItem };
      const c1 = computeV2PlacementTacticalDelta(nonEqParams);
      const origSpace = c1.spaceLine;
      expect('recommendedSpot' in c1).toBe(false);
      (c1 as { spaceLine: string }).spaceLine = 'POISON_NON_EQ';

      const c2 = computeV2PlacementTacticalDelta(nonEqParams);
      expect(c2).not.toBe(c1);
      expect(c2.spaceLine).toBe(origSpace);
      expect('recommendedSpot' in c2).toBe(false);
      (c2 as { spaceLine: string }).spaceLine = 'POISON_NON_EQ_HIT';

      const c3 = computeV2PlacementTacticalDelta(nonEqParams);
      expect(c3).not.toBe(c2);
      expect(c3.spaceLine).toBe(origSpace);

      // Grid item without recommendedSpot has identical own-property shape across miss & hit
      const gridParams = { ...eqParams, item: bay.placed[0].item, zone: 'grid' as const };
      const g1 = computeV2PlacementTacticalDelta(gridParams);
      const g2 = computeV2PlacementTacticalDelta(gridParams);
      expect(g2).not.toBe(g1);
      expect(g2).toStrictEqual(g1);
      expect('recommendedSpot' in g1).toBe(false);
      expect('recommendedSpot' in g2).toBe(false);
    });

    it('enforces bounded LRU eviction (> 256 entries) on both deltaCache and bestPlacementCache', () => {
      clearTacticalDeltaCache();
      const run = buildArrangeRun();
      const bay = run.bay;

      // 1) deltaCache bounded LRU (256 cap) using zero-sim cargo items
      const mkCargo = (val: number) =>
        createV2CargoInstance({
          instanceId: `cargo_lru_${val}`,
          defId: 'cargo.data_box',
          origin: 'loot',
          acquiredDepth: 1,
          location: 'staging',
          fixedValueOverride: val,
        });
      const queryCargo = (val: number) =>
        computeV2PlacementTacticalDelta({
          run,
          bay,
          startingHp: 30,
          maxHp: 30,
          targetPolicy: 'weakest',
          item: mkCargo(val),
          zone: 'staging',
        });

      queryCargo(1); // K1 (miss #1)
      queryCargo(2); // K2 (miss #2)
      queryCargo(1); // Promote K1 to MRU (hit #1)
      expect(getTacticalDeltaCacheStats().deltaHits).toBe(1);

      // Insert 255 more distinct keys (total 257 > 256) -> K2 MUST be evicted, K1 MUST survive
      for (let v = 3; v <= 257; v += 1) {
        queryCargo(v);
      }
      expect(getTacticalDeltaCacheStats().deltaSize).toBe(256);

      const beforeK1 = getTacticalDeltaCacheStats();
      queryCargo(1);
      const afterK1 = getTacticalDeltaCacheStats();
      expect(afterK1.deltaHits).toBe(beforeK1.deltaHits + 1);
      expect(afterK1.deltaMisses).toBe(beforeK1.deltaMisses);

      queryCargo(2);
      const afterK2 = getTacticalDeltaCacheStats();
      expect(afterK2.deltaMisses).toBe(afterK1.deltaMisses + 1);
      expect(afterK2.deltaSize).toBe(256);

      // 2) bestPlacementCache bounded LRU (256 cap) using completely full 16/16 cannon_skiff bay (0 sims per call)
      clearTacticalDeltaCache();
      const fullPlaced = [];
      for (let y = 0; y < 4; y += 1) {
        for (let x = 0; x < 4; x += 1) {
          fullPlaced.push({
            item: createV3GadgetInstance({
              instanceId: `gd_full_${x}_${y}`,
              kind: 'repair_kit',
              origin: 'owned',
              acquiredDepth: 0,
              location: 'bay',
            }),
            x,
            y,
            rotation: 0 as const,
          });
        }
      }
      const fullBay: V2CargoBayState = {
        shipId: 'cannon_skiff',
        placed: fullPlaced,
        staging: [],
        discardedThisArrange: [],
      };
      const units = buildEncounterUnits('armored', 1, 'lru_best');
      const probeItem = bay.staging[0].item;

      expect(findBestPlacementForItem(fullBay, probeItem, 1, 30, 'weakest', units)).toBeNull();
      expect(findBestPlacementForItem(fullBay, probeItem, 2, 30, 'weakest', units)).toBeNull();
      // Promote startingHp=1 to MRU
      expect(findBestPlacementForItem(fullBay, probeItem, 1, 30, 'weakest', units)).toBeNull();
      expect(getTacticalDeltaCacheStats().bestPlacementHits).toBe(1);

      for (let hp = 3; hp <= 257; hp += 1) {
        findBestPlacementForItem(fullBay, probeItem, hp, 30, 'weakest', units);
      }
      expect(getTacticalDeltaCacheStats().bestPlacementSize).toBe(256);

      const beforeBestK1 = getTacticalDeltaCacheStats();
      findBestPlacementForItem(fullBay, probeItem, 1, 30, 'weakest', units);
      const afterBestK1 = getTacticalDeltaCacheStats();
      expect(afterBestK1.bestPlacementHits).toBe(beforeBestK1.bestPlacementHits + 1);
      expect(afterBestK1.bestPlacementMisses).toBe(beforeBestK1.bestPlacementMisses);

      findBestPlacementForItem(fullBay, probeItem, 2, 30, 'weakest', units);
      const afterBestK2 = getTacticalDeltaCacheStats();
      expect(afterBestK2.bestPlacementMisses).toBe(afterBestK1.bestPlacementMisses + 1);
      expect(afterBestK2.bestPlacementSize).toBe(256);
    });

    it('preserves active pendingDeltaHandle when a stale out-of-order requestIdleCallback fires', () => {
      const mount = dom.document.createElement('div');
      dom.document.body.appendChild(mount);

      const bayA = buildArrangeBay();
      const bayB: V2CargoBayState = {
        ...bayA,
        placed: [{ ...bayA.placed[0], x: 2, y: 0 }],
      };
      const bayC: V2CargoBayState = {
        ...bayA,
        placed: [{ ...bayA.placed[0], x: 3, y: 0 }],
      };

      const provider = vi.fn(() => ({
        synergyLine: 'LIVE_DELTA',
        combatDeltaLine: 'LIVE_COMBAT',
        spaceLine: 'LIVE_SPACE',
        positiveImpact: true,
      }));

      // Scenario 1: stale job1 runs out-of-order, then destroy() MUST still cancel job2
      const grid1 = new CargoGridV2Component(mount as unknown as HTMLElement, {
        onBayChange: () => {},
        getTacticalDelta: provider,
      });
      grid1.render(bayA, true);
      const job1 = dom.window.idleQueue[0];
      grid1.render(bayB, true);
      const job2 = dom.window.idleQueue[1];
      expect(job1.cancelled).toBe(true);
      expect(job2.cancelled).toBe(false);

      // Fire stale job1 out-of-order — MUST NOT clobber job2's pendingDeltaHandle
      job1.cb();
      expect(provider).toHaveBeenCalledTimes(0);

      grid1.destroy();
      expect(job2.cancelled).toBe(true);

      // Scenario 2: stale job runs out-of-order, then render(bayC) MUST still cancel active job & flush bayC cleanly
      dom.window.idleQueue.length = 0;
      const mount2 = dom.document.createElement('div');
      dom.document.body.appendChild(mount2);
      const grid2 = new CargoGridV2Component(mount2 as unknown as HTMLElement, {
        onBayChange: () => {},
        getTacticalDelta: provider,
      });
      grid2.render(bayA, true);
      const jA = dom.window.idleQueue[0];
      grid2.render(bayB, true);
      const jB = dom.window.idleQueue[1];
      expect(jA.cancelled).toBe(true);
      expect(jB.cancelled).toBe(false);

      jA.cb();
      expect(provider).toHaveBeenCalledTimes(0);

      grid2.render(bayC, true);
      expect(jB.cancelled).toBe(true);
      const jC = dom.window.idleQueue[2];
      expect(jC.cancelled).toBe(false);

      dom.window.flushIdleCallbacks();
      expect(provider).toHaveBeenCalledTimes(1);
      expect(mount2.querySelector('[data-testid="tactical-delta"]')?.textContent).toContain('LIVE_DELTA');

      grid2.destroy();
    });

    it('clears keyboard carrying .preview-valid/.preview-invalid and cell marks on grid blur without DOM rebuilds or delta calls', async () => {
      const mount = dom.document.createElement('div');
      dom.document.body.appendChild(mount);
      const outsideBtn = dom.document.createElement('button');
      outsideBtn.type = 'button';
      dom.document.body.appendChild(outsideBtn);

      const deltaSpy = vi.fn(() => ({
        synergyLine: 'DELTA',
        combatDeltaLine: 'COMBAT',
        spaceLine: 'SPACE',
        positiveImpact: true,
      }));
      const grid = new CargoGridV2Component(mount as unknown as HTMLElement, {
        onBayChange: () => {},
        getTacticalDelta: deltaSpy,
      });

      // Part 1: valid carrying preview on cannon_skiff clears cleanly on blur
      grid.render(buildArrangeBay(), true);
      dom.window.flushIdleCallbacks();
      const cells = mount.querySelectorAll('.cargo-cell');
      expect(cells).toHaveLength(16);

      const cell00 = mount.querySelector('.cargo-cell[data-cx="0"][data-cy="0"]')!;
      cell00.focus();
      dom.window.dispatchEvent(new FakeEvent('keydown', { key: 'Enter' }));
      dom.window.dispatchEvent(new FakeEvent('keydown', { key: 'ArrowRight' }));
      expect(mount.querySelectorAll('.cargo-cell.preview-valid')).toHaveLength(2);
      expect(mount.querySelectorAll('.cargo-cell[data-mark-state="valid"]')).toHaveLength(2);

      deltaSpy.mockClear();
      outsideBtn.focus();
      await flushMicrotasks();

      expect(mount.querySelectorAll('.cargo-cell.kb-focused')).toHaveLength(0);
      expect(mount.querySelectorAll('.cargo-cell.preview-valid')).toHaveLength(0);
      expect(mount.querySelectorAll('.cargo-cell.preview-invalid')).toHaveLength(0);
      expect(mount.querySelectorAll('.cargo-cell[data-mark-state="valid"]')).toHaveLength(0);
      expect(mount.querySelectorAll('.cargo-cell[data-mark-state="invalid"]')).toHaveLength(0);
      expect(deltaSpy).toHaveBeenCalledTimes(0);
      const cellsAfterBlur = mount.querySelectorAll('.cargo-cell');
      expect(cellsAfterBlur).toHaveLength(cells.length);
      for (let i = 0; i < cells.length; i += 1) {
        expect(cellsAfterBlur[i]).toBe(cells[i]);
      }

      // Part 2: invalid carrying preview overlapping occupied power cell (1,2) & bulkhead (2,4) on stargate_cruiser
      const cruiserBay: V2CargoBayState = {
        shipId: 'stargate_cruiser',
        placed: [
          {
            item: createV2EquipmentInstance({
              instanceId: 'eq_cruiser_laser',
              kind: 'laser',
              quality: 'common',
              origin: 'owned',
              acquiredDepth: 0,
              location: 'bay',
            }),
            x: 2,
            y: 1,
            rotation: 0,
          },
          {
            item: createV2EquipmentInstance({
              instanceId: 'eq_cruiser_bat',
              kind: 'battery',
              quality: 'common',
              origin: 'owned',
              acquiredDepth: 0,
              location: 'bay',
            }),
            x: 1,
            y: 2,
            rotation: 0,
          },
        ],
        staging: [],
        discardedThisArrange: [],
      };
      grid.render(cruiserBay, true);
      dom.window.flushIdleCallbacks();

      const cruiserCells = mount.querySelectorAll('.cargo-cell');
      expect(cruiserCells).toHaveLength(25);
      const powerCell12 = mount.querySelector('.cargo-cell[data-cx="1"][data-cy="2"]')!;
      const bulkhead24 = mount.querySelector('.cargo-cell[data-cx="2"][data-cy="4"]')!;
      expect(powerCell12.dataset.markState).toBe('power');
      expect(bulkhead24.dataset.markState).toBe('bulkhead');

      // Pick up laser at (2,1) and move left to (1,1) -> overlaps battery on power cell (1,2) -> invalid!
      mount.querySelector('.cargo-cell[data-cx="2"][data-cy="1"]')!.focus();
      dom.window.dispatchEvent(new FakeEvent('keydown', { key: 'Enter' }));
      dom.window.dispatchEvent(new FakeEvent('keydown', { key: 'ArrowLeft' }));
      expect(mount.querySelectorAll('.cargo-cell.preview-invalid').length).toBeGreaterThan(0);
      expect(powerCell12.dataset.markState).toBe('invalid');

      deltaSpy.mockClear();
      outsideBtn.focus();
      await flushMicrotasks();

      expect(mount.querySelectorAll('.cargo-cell.preview-invalid')).toHaveLength(0);
      expect(mount.querySelectorAll('.cargo-cell[data-mark-state="invalid"]')).toHaveLength(0);
      expect(powerCell12.dataset.markState).toBe('power');
      expect(bulkhead24.dataset.markState).toBe('bulkhead');
      expect(deltaSpy).toHaveBeenCalledTimes(0);

      // Re-focus at (1,1) (still carrying), move right+down+down to (2,3) -> overlaps bulkhead (2,4) -> invalid!
      mount.querySelector('.cargo-cell[data-cx="2"][data-cy="3"]')!.focus();
      expect(bulkhead24.classList.contains('preview-invalid')).toBe(true);
      expect(bulkhead24.dataset.markState).toBe('bulkhead');

      outsideBtn.focus();
      await flushMicrotasks();
      expect(mount.querySelectorAll('.cargo-cell.preview-invalid')).toHaveLength(0);
      expect(bulkhead24.dataset.markState).toBe('bulkhead');
      expect(powerCell12.dataset.markState).toBe('power');
      expect(deltaSpy).toHaveBeenCalledTimes(0);

      grid.destroy();
    });

    it('re-renders selected inspector when item origin, category, or fixedValue changes on the same instanceId', () => {
      // Case 1: without getTacticalDelta (placed item origin changes loan -> owned on same instanceId)
      const mount1 = dom.document.createElement('div');
      dom.document.body.appendChild(mount1);
      const grid1 = new CargoGridV2Component(mount1 as unknown as HTMLElement, {
        onBayChange: () => {},
      });
      const baseBay = buildArrangeBay();
      grid1.render(baseBay, true);

      const board1 = mount1.querySelector('.v2-cargo-board')!;
      const p00 = cellCenterPoint(4, 4, 0, 0);
      board1.dispatchEvent(
        new FakeEvent('pointerdown', {
          bubbles: true,
          button: 0,
          pointerType: 'mouse',
          clientX: p00.x,
          clientY: p00.y,
        })
      );
      dom.window.dispatchEvent(
        new FakeEvent('pointerup', { bubbles: true, button: 0, clientX: p00.x, clientY: p00.y })
      );

      expect(mount1.querySelector('.v2-origin-chip.origin-loan')?.textContent).toContain('借用');

      const ownedLaserBay: V2CargoBayState = {
        ...baseBay,
        placed: [
          {
            ...baseBay.placed[0],
            item: { ...baseBay.placed[0].item, origin: 'owned' },
          },
        ],
      };
      grid1.render(ownedLaserBay, true);
      const ownedChip = mount1.querySelector('.v2-origin-chip.origin-owned');
      expect(ownedChip).not.toBeNull();
      expect(ownedChip!.textContent).toContain('自有');
      expect(mount1.querySelector('.v2-origin-chip.origin-loan')).toBeNull();
      grid1.destroy();

      // Case 2: with getTacticalDelta (staging item mutates origin & fixedValue on same instanceId)
      const mount2 = dom.document.createElement('div');
      dom.document.body.appendChild(mount2);
      const deltaProvider = vi.fn((item: V2CargoBayState['staging'][number]['item']) => ({
        synergyLine: `SYN:${item.origin}`,
        combatDeltaLine: `VAL:${item.fixedValue}`,
        spaceLine: `CAT:${item.category}`,
        positiveImpact: true,
      }));
      const grid2 = new CargoGridV2Component(mount2 as unknown as HTMLElement, {
        onBayChange: () => {},
        getTacticalDelta: deltaProvider,
      });

      const stagingBay1: V2CargoBayState = {
        ...baseBay,
        staging: [
          {
            ...baseBay.staging[0],
            item: { ...baseBay.staging[0].item, origin: 'loot', fixedValue: 30 },
          },
        ],
      };
      grid2.render(stagingBay1, true);
      dom.window.flushIdleCallbacks();
      expect(deltaProvider).toHaveBeenCalledTimes(1);
      expect(mount2.querySelector('.v2-origin-chip.origin-loot')?.textContent).toContain('拾获 · 可出售/入库');
      expect(mount2.querySelector('[data-testid="tactical-delta"]')?.textContent).toContain('VAL:30');

      const stagingBay2: V2CargoBayState = {
        ...stagingBay1,
        staging: [
          {
            ...stagingBay1.staging[0],
            item: { ...stagingBay1.staging[0].item, origin: 'owned', fixedValue: 95 },
          },
        ],
      };
      grid2.render(stagingBay2, true);
      // Inspector immediately updates origin & value before idle completes, and schedules a fresh delta
      expect(mount2.querySelector('.v2-origin-chip.origin-owned')?.textContent).toContain('自有');
      expect(mount2.querySelector('.inspector-desc')?.textContent).toContain('95¤');

      dom.window.flushIdleCallbacks();
      expect(deltaProvider).toHaveBeenCalledTimes(2);
      const freshDelta = mount2.querySelector('[data-testid="tactical-delta"]')!;
      expect(freshDelta.textContent).toContain('SYN:owned');
      expect(freshDelta.textContent).toContain('VAL:95');

      // Mutating category on the same instanceId (e.g. equipment -> gadget) also refreshes inspector badge
      const stagingBay3: V2CargoBayState = {
        ...stagingBay2,
        staging: [
          {
            ...stagingBay2.staging[0],
            item: {
              ...stagingBay2.staging[0].item,
              definitionId: 'gadget.repair_kit',
              category: 'gadget',
            },
          },
        ],
      };
      grid2.render(stagingBay3, true);
      expect(mount2.querySelector('.v2-quality-chip')?.textContent).toContain('一次性装置');
      dom.window.flushIdleCallbacks();
      expect(mount2.querySelector('[data-testid="tactical-delta"]')?.textContent).toContain('CAT:gadget');

      grid2.destroy();
    });

    it('cancels active pointer drag cleanly on Escape without leaving ghost, dragging-source, or hover preview', () => {
      const mount = dom.document.createElement('div');
      dom.document.body.appendChild(mount);
      const onBayChange = vi.fn();
      const grid = new CargoGridV2Component(mount as unknown as HTMLElement, {
        onBayChange,
      });
      grid.render(buildArrangeBay(), true);

      // Start dragging placed laser from (0,0) to (2,0)
      const board = mount.querySelector('.v2-cargo-board')!;
      const startPt = cellCenterPoint(4, 4, 0, 0);
      const movePt = cellCenterPoint(4, 4, 2, 0);

      board.dispatchEvent(
        new FakeEvent('pointerdown', {
          bubbles: true,
          button: 0,
          pointerType: 'mouse',
          clientX: startPt.x,
          clientY: startPt.y,
        })
      );
      dom.window.dispatchEvent(
        new FakeEvent('pointermove', {
          bubbles: true,
          clientX: movePt.x,
          clientY: movePt.y,
        })
      );

      expect(dom.document.body.querySelector('.drag-ghost')).not.toBeNull();
      expect(mount.querySelectorAll('.dragging-source')).toHaveLength(1);
      expect(mount.querySelectorAll('.cargo-cell.preview-valid')).toHaveLength(2);

      // Press Escape mid-drag -> ghost, dragging-source, and previews MUST all clear immediately
      const escDuringDrag = new FakeEvent('keydown', { key: 'Escape' });
      dom.window.dispatchEvent(escDuringDrag);
      expect(escDuringDrag.defaultPrevented).toBe(true);
      expect(dom.document.body.querySelector('.drag-ghost')).toBeNull();
      expect(mount.querySelectorAll('.dragging-source')).toHaveLength(0);
      expect(mount.querySelectorAll('.cargo-cell.preview-valid')).toHaveLength(0);
      expect(mount.querySelectorAll('.cargo-cell.preview-invalid')).toHaveLength(0);

      // Subsequent pointerup MUST NOT commit any move
      dom.window.dispatchEvent(
        new FakeEvent('pointerup', {
          bubbles: true,
          button: 0,
          clientX: movePt.x,
          clientY: movePt.y,
        })
      );
      expect(onBayChange).toHaveBeenCalledTimes(0);

      // Pressing Escape when completely idle (no drag, no carrying, no selection) MUST NOT preventDefault
      const escIdle = new FakeEvent('keydown', { key: 'Escape' });
      dom.window.dispatchEvent(escIdle);
      expect(escIdle.defaultPrevented).toBe(false);

      grid.destroy();
    });
  });

  // =========================================================================
  // F04 — Stateful PhaseView Lifecycle (ArrangePhaseView, MapPhaseView, Controller)
  // =========================================================================
  describe('F04: Stateful PhaseView Lifecycle (ArrangeView & MapView)', () => {
    it('ArrangePhaseView preserves DOM identity, #v3-arrange-inspector-slot children, scroll/focus, uses latest actions, and cleans up on unmount', () => {
      const host = dom.document.createElement('div');
      dom.document.body.appendChild(host);

      const gadget = createV3GadgetInstance({
        instanceId: 'gd_repair_1',
        kind: 'repair_kit',
        origin: 'owned',
        acquiredDepth: 0,
        location: 'bay',
      });
      const baseRun = buildArrangeRun();
      const surveyNodeId = 'L1A';
      const runWithAll: V2RunState = {
        ...baseRun,
        hp: 15,
        maxHp: 30,
        isTutorial: false,
        contract: {
          ...baseRun.contract,
          type: 'survey',
          status: 'active',
          requiredCompletions: 2,
          completedNodeIds: [],
          surveyFuelCost: 1,
        },
        graph: {
          ...baseRun.graph,
          nodes: {
            ...baseRun.graph.nodes,
            [surveyNodeId]: {
              ...baseRun.graph.nodes[surveyNodeId],
              contractMarker: true,
              resolved: true,
            },
          },
        },
        bay: {
          ...baseRun.bay,
          placed: [...baseRun.bay.placed, { item: gadget, x: 3, y: 3, rotation: 0 }],
        },
        activeEngineerOffer: {
          targetInstanceId: baseRun.bay.placed[0].item.instanceId,
          candidates: ['heavy', 'shield'],
          used: false,
        },
      };

      const a1 = {
        onToggleShipPreview: vi.fn(),
        onEngineerSwap: vi.fn(),
        onSurveyScan: vi.fn(),
        onUseGadget: vi.fn(),
        onAbortContract: vi.fn(),
        onLeaveArrange: vi.fn(),
      };
      const a2 = {
        onToggleShipPreview: vi.fn(),
        onEngineerSwap: vi.fn(),
        onSurveyScan: vi.fn(),
        onUseGadget: vi.fn(),
        onAbortContract: vi.fn(),
        onLeaveArrange: vi.fn(),
      };

      const view = new ArrangePhaseView();
      view.mount(host as unknown as HTMLElement);
      view.update({ run: runWithAll, readOnly: false, sceneCollapsed: true }, a1);

      const rootRef = host.querySelector('[data-testid="arrange-screen"]')!;
      const leaveBtnRef = host.querySelector('[data-testid="btn-leave-arrange"]')!;
      const toggleBtnRef = host.querySelector('#v2-arrange-toggle-ship')!;
      const inspectorSlotRef = host.querySelector('#v3-arrange-inspector-slot')!;
      const abortBtnRef = host.querySelector('#v2-arrange-abort')!;
      const surveyBtnRef = host.querySelector('#v2-btn-survey-scan')!;
      const gadgetBtnRef = host.querySelector('[data-testid="btn-use-gadget-repair_kit"]')!;
      const swapBtnRef = host.querySelector('[data-eng-swap="heavy"]')!;

      // Attach a sentinel child inside #v3-arrange-inspector-slot (simulating CargoGridV2's mounted inspector)
      const sentinel = dom.document.createElement('div');
      sentinel.id = 'inspector-sentinel';
      inspectorSlotRef.appendChild(sentinel);

      expect(leaveBtnRef.disabled).toBe(true); // staging non-empty
      host.scrollTop = 140;
      toggleBtnRef.focus();

      // Update with cleared staging, flipped sceneCollapsed, and fresh a2 callbacks
      const runClearedStaging: V2RunState = {
        ...runWithAll,
        bay: { ...runWithAll.bay, staging: [] },
      };
      view.update({ run: runClearedStaging, readOnly: false, sceneCollapsed: false }, a2);

      // Exact DOM node identity preserved!
      expect(host.querySelector('[data-testid="arrange-screen"]')).toBe(rootRef);
      expect(host.querySelector('[data-testid="btn-leave-arrange"]')).toBe(leaveBtnRef);
      expect(host.querySelector('#v2-arrange-toggle-ship')).toBe(toggleBtnRef);
      expect(host.querySelector('#v3-arrange-inspector-slot')).toBe(inspectorSlotRef);
      expect(host.querySelector('#v2-arrange-abort')).toBe(abortBtnRef);
      expect(host.querySelector('#v2-btn-survey-scan')).toBe(surveyBtnRef);
      expect(host.querySelector('[data-testid="btn-use-gadget-repair_kit"]')).toBe(gadgetBtnRef);
      expect(host.querySelector('[data-eng-swap="heavy"]')).toBe(swapBtnRef);

      // Sentinel child inside #v3-arrange-inspector-slot untouched; scroll & focus preserved!
      expect(inspectorSlotRef.querySelector('#inspector-sentinel')).toBe(sentinel);
      expect(host.scrollTop).toBe(140);
      expect(dom.document.activeElement).toBe(toggleBtnRef);
      expect(leaveBtnRef.disabled).toBe(false);

      // Clicking invokes latest a2 callbacks (ZERO stale a1 calls!)
      toggleBtnRef.click();
      leaveBtnRef.click();
      swapBtnRef.click();
      gadgetBtnRef.click();
      surveyBtnRef.click();
      abortBtnRef.click();
      expect(a1.onToggleShipPreview).toHaveBeenCalledTimes(0);
      expect(a1.onLeaveArrange).toHaveBeenCalledTimes(0);
      expect(a2.onToggleShipPreview).toHaveBeenCalledTimes(1);
      expect(a2.onLeaveArrange).toHaveBeenCalledTimes(1);
      expect(a2.onEngineerSwap).toHaveBeenCalledWith('heavy');
      expect(a2.onUseGadget).toHaveBeenCalledWith('gd_repair_1');
      expect(a2.onSurveyScan).toHaveBeenCalledTimes(1);
      expect(a2.onAbortContract).toHaveBeenCalledTimes(1);

      // readOnly toggle updates .disabled in-place without recreating buttons
      view.update({ run: runClearedStaging, readOnly: true, sceneCollapsed: false }, a2);
      expect(host.querySelector('[data-testid="btn-leave-arrange"]')).toBe(leaveBtnRef);
      expect(leaveBtnRef.disabled).toBe(true);
      expect(surveyBtnRef.disabled).toBe(true);
      expect(swapBtnRef.disabled).toBe(true);

      // Unmount removes DOM and all listeners cleanly (idempotent + re-mountable)
      view.unmount();
      expect(host.children).toHaveLength(0);
      expect(toggleBtnRef.getListenerCount('click')).toBe(0);
      expect(leaveBtnRef.getListenerCount('click')).toBe(0);
      expect(abortBtnRef.getListenerCount('click')).toBe(0);
      expect(surveyBtnRef.getListenerCount('click')).toBe(0);
      toggleBtnRef.click();
      expect(a2.onToggleShipPreview).toHaveBeenCalledTimes(1);

      // Double unmount is safe & remount works
      view.unmount();
      view.mount(host as unknown as HTMLElement);
      view.update({ run: runClearedStaging, readOnly: false, sceneCollapsed: true }, a2);
      expect(host.querySelector('[data-testid="arrange-screen"]')).not.toBeNull();
      view.unmount();
    });

    it('MapPhaseView preserves DOM identity, scrollLeft/focus, enforces 1-node-per-testid desktop<->mobile, prunes stale nodes on graph switch, and cleans up on unmount', () => {
      const host = dom.document.createElement('div');
      dom.document.body.appendChild(host);

      const rawTut = createV2TutorialRun('run_map_tut');
      // Position tutorial run at penultimate L3A fork where BOTH L4A and L4B are reachable
      const tutRun: V2RunState = {
        ...rawTut,
        phase: 'MAP',
        currentNodeId: 'L3A',
        visitedNodeIds: ['L1A', 'L2A', 'L3A'],
        bay: { ...rawTut.bay, staging: [] },
      };
      const a1 = {
        onToggleMobileMap: vi.fn(),
        onSelectNode: vi.fn(),
        onJumpNode: vi.fn(),
        onUseGadget: vi.fn(),
        onSafeReturn: vi.fn(),
        onAbortContract: vi.fn(),
      };
      const a2 = {
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
          run: tutRun,
          readOnly: false,
          selectedMapNodeId: 'L4A',
          mobileMapShowFull: false,
          isCompactViewport: false,
          pureAutoCombat: false,
        },
        a1
      );

      const rootRef = host.querySelector('[data-testid="map-screen"]')!;
      const dagScrollRef = host.querySelector('.v2-dag-scroll')!;
      const nodeL4ARef = host.querySelector('[data-testid="map-node-L4A"]')!;
      const nodeL4BRef = host.querySelector('[data-testid="map-node-L4B"]')!;
      const jumpL4ARef = host.querySelector('[data-jump-node="L4A"]')!;
      const jumpL4BRef = host.querySelector('[data-jump-node="L4B"]')!;
      const safeReturnRef = host.querySelector('[data-testid="btn-safe-return"]')!;

      // S04: zero duplicate map-compare-* cards; strictly 1 btn-jump-node on selected card L4A
      expect(host.querySelector('[data-testid="map-compare-L4B"]')).toBeNull();
      expect(host.querySelectorAll('[data-testid="btn-jump-node"]')).toHaveLength(1);
      expect(host.querySelector('[data-testid="btn-jump-node"]')).toBe(jumpL4ARef);

      host.scrollTop = 88;
      dagScrollRef.scrollLeft = 120;
      nodeL4BRef.focus();

      // Select L4B with fresh a2 actions -> ALL refs strictly ===, scroll & focus preserved!
      view.update(
        {
          run: tutRun,
          readOnly: false,
          selectedMapNodeId: 'L4B',
          mobileMapShowFull: false,
          isCompactViewport: false,
          pureAutoCombat: false,
        },
        a2
      );

      expect(host.querySelector('[data-testid="map-screen"]')).toBe(rootRef);
      expect(host.querySelector('.v2-dag-scroll')).toBe(dagScrollRef);
      expect(host.querySelector('[data-testid="map-node-L4A"]')).toBe(nodeL4ARef);
      expect(host.querySelector('[data-testid="map-node-L4B"]')).toBe(nodeL4BRef);
      expect(host.querySelector('[data-jump-node="L4A"]')).toBe(jumpL4ARef);
      expect(host.querySelector('[data-jump-node="L4B"]')).toBe(jumpL4BRef);
      expect(host.querySelectorAll('[data-testid="btn-jump-node"]')).toHaveLength(1);
      expect(host.querySelector('[data-testid="btn-jump-node"]')).toBe(jumpL4BRef);
      expect(host.querySelector('[data-testid="btn-safe-return"]')).toBe(safeReturnRef);
      expect(host.scrollTop).toBe(88);
      expect(dagScrollRef.scrollLeft).toBe(120);
      expect(dom.document.activeElement).toBe(nodeL4BRef);
      expect(nodeL4BRef.classList.contains('selected')).toBe(true);
      expect(nodeL4ARef.classList.contains('selected')).toBe(false);

      // Jump button invokes latest a2.onJumpNode('L4B') with 0 stale a1 calls and 0 double-fire select calls!
      jumpL4BRef.click();
      expect(a1.onJumpNode).toHaveBeenCalledTimes(0);
      expect(a2.onSelectNode).toHaveBeenCalledTimes(0);
      expect(a2.onJumpNode).toHaveBeenCalledTimes(1);
      expect(a2.onJumpNode).toHaveBeenCalledWith('L4B');

      // Desktop <-> Mobile Focus toggle strictly preserves <= 1 DOM node per map-node-<id>
      view.update(
        {
          run: tutRun,
          readOnly: false,
          selectedMapNodeId: 'L4B',
          mobileMapShowFull: false,
          isCompactViewport: true,
          pureAutoCombat: false,
        },
        a2
      );
      expect(host.querySelectorAll('[data-testid="map-node-L4A"]')).toHaveLength(1);
      expect(host.querySelectorAll('[data-testid="map-node-L4B"]')).toHaveLength(1);
      expect(host.querySelector('.v2-dag-scroll')).toBeNull();
      expect(host.querySelector('.v2-map-mobile-focus')).not.toBeNull();

      // Expand full graph on mobile -> still strictly 1 node per testid!
      view.update(
        {
          run: tutRun,
          readOnly: false,
          selectedMapNodeId: 'L4A',
          mobileMapShowFull: true,
          isCompactViewport: true,
          pureAutoCombat: false,
        },
        a2
      );
      expect(host.querySelectorAll('[data-testid="map-node-L4A"]')).toHaveLength(1);
      expect(host.querySelectorAll('[data-testid="map-node-L4B"]')).toHaveLength(1);
      expect(host.querySelector('.v2-dag-scroll')).toBe(dagScrollRef);

      // Switch to a different 6-layer run -> stale nodes pruned cleanly
      const freshSave = createFreshV2SaveData();
      const slots = buildFreeFallbackPrepareSlots('cannon_skiff', freshSave.profile.blueprints, 6);
      const launched = launchV2Expedition({
        profile: freshSave.profile,
        contractTemplateId: 'free_salvage',
        shipId: 'cannon_skiff',
        crewId: 'engineer',
        primaryArchetype: 'laser',
        slots,
        trialBuildId: null,
        sectorId: 'near_orbit',
        seed: 424242,
      });
      expect(launched.ok && launched.run).toBeTruthy();
      view.update(
        {
          run: launched.run!,
          readOnly: false,
          selectedMapNodeId: null,
          mobileMapShowFull: false,
          isCompactViewport: false,
          pureAutoCombat: false,
        },
        a2
      );
      const renderedNodeIds = host
        .querySelectorAll('[data-select-node]')
        .map((el) => el.dataset.selectNode);
      for (const nid of renderedNodeIds) {
        expect(launched.run!.graph.nodes[nid!]).toBeDefined();
      }

      // Clean unmount removes DOM and all listeners
      view.unmount();
      expect(host.children).toHaveLength(0);
      expect(rootRef.getListenerCount('click')).toBe(0);
      expect(rootRef.getListenerCount('keydown')).toBe(0);
      expect(jumpL4BRef.getListenerCount('click')).toBe(0);
      expect(safeReturnRef.getListenerCount('click')).toBe(0);
    });

    it('V2AppController coordinates MapPhaseView <-> ENCOUNTER <-> ArrangePhaseView mount/update/unmount transitions', async () => {
      const save = createFreshV2SaveData();
      persistV2SaveData(dom.window.localStorage as unknown as Storage, save);
      dom.window.sessionStorage.setItem('starline_v2_title_entered', '1');

      const mapMountSpy = vi.spyOn(MapPhaseView.prototype, 'mount');
      const mapUnmountSpy = vi.spyOn(MapPhaseView.prototype, 'unmount');
      const arrangeMountSpy = vi.spyOn(ArrangePhaseView.prototype, 'mount');
      const arrangeUnmountSpy = vi.spyOn(ArrangePhaseView.prototype, 'unmount');

      const mountEl = dom.document.createElement('div');
      dom.document.body.appendChild(mountEl);

      const controller = new V2AppController(mountEl as unknown as HTMLElement, {
        onSwitchToV1: () => {},
      });
      controller.init();
      await flushMicrotasks();

      // Start tutorial -> S01 enters Step-1 ARRANGE (battery in staging, mounts ArrangePhaseView once)
      const tutBtn = mountEl.querySelector('[data-testid="btn-start-tutorial"]')!;
      expect(tutBtn).not.toBeNull();
      tutBtn.click();
      expect(arrangeMountSpy).toHaveBeenCalledTimes(1);
      const tutArrangeRoot = mountEl.querySelector('[data-testid="arrange-screen"]')!;
      expect(tutArrangeRoot).not.toBeNull();

      // Place staged battery at (1,0) adjacent to Laser -> ArrangePhaseView stays mounted without remount!
      const tutBoard = mountEl.querySelector('.v2-cargo-board')!;
      const tutPt = cellCenterPoint(4, 4, 1, 0);
      tutBoard.dispatchEvent(
        new FakeEvent('pointerdown', {
          bubbles: true,
          button: 0,
          pointerType: 'mouse',
          clientX: tutPt.x,
          clientY: tutPt.y,
        })
      );
      expect(mountEl.querySelector('[data-testid="arrange-screen"]')).toBe(tutArrangeRoot);
      expect(arrangeMountSpy).toHaveBeenCalledTimes(1);

      // Leave Step-1 ARRANGE -> unmounts ArrangePhaseView & mounts MapPhaseView once!
      const tutLeaveBtn = mountEl.querySelector('[data-testid="btn-leave-arrange"]')!;
      expect(tutLeaveBtn.disabled).toBe(false);
      tutLeaveBtn.click();
      expect(arrangeUnmountSpy).toHaveBeenCalledTimes(1);
      expect(mapMountSpy).toHaveBeenCalledTimes(1);
      const mapRoot1 = mountEl.querySelector('[data-testid="map-screen"]')!;

      // Select L1A card body -> reuses same MapPhaseView & DOM root without remounting
      mountEl.querySelector('[data-testid="map-node-L1A"]')!.click();
      expect(mountEl.querySelector('[data-testid="map-screen"]')).toBe(mapRoot1);
      expect(mapMountSpy).toHaveBeenCalledTimes(1);

      // 1-click jump to L1A -> enters ENCOUNTER (unmounts MapPhaseView!)
      mountEl.querySelector('[data-testid="btn-jump-node"]')!.click();
      expect(mapUnmountSpy).toHaveBeenCalledTimes(1);
      expect(mountEl.querySelector('[data-testid="map-screen"]')).toBeNull();
      expect(mountEl.querySelector('[data-testid="combat-screen"]')).not.toBeNull();

      // Boot a second controller in ARRANGE to verify ArrangePhaseView mount -> repeated bay edits -> leave to MAP
      controller.destroy();

      const arrangeSave = { ...createFreshV2SaveData(), activeRun: buildArrangeRun() };
      persistV2SaveData(dom.window.localStorage as unknown as Storage, arrangeSave);

      const mountEl2 = dom.document.createElement('div');
      dom.document.body.appendChild(mountEl2);
      const controller2 = new V2AppController(mountEl2 as unknown as HTMLElement, {
        onSwitchToV1: () => {},
      });
      controller2.init();
      await flushMicrotasks();

      expect(arrangeMountSpy).toHaveBeenCalledTimes(2);
      const arrangeRoot = mountEl2.querySelector('[data-testid="arrange-screen"]')!;
      const inspectorSlot = mountEl2.querySelector('#v3-arrange-inspector-slot')!;
      expect(arrangeRoot).not.toBeNull();
      expect(inspectorSlot).not.toBeNull();

      // Place staging battery into bay -> ArrangePhaseView & #v3-arrange-inspector-slot stay identical!
      const board = mountEl2.querySelector('.v2-cargo-board')!;
      const pt = cellCenterPoint(4, 4, 1, 0);
      board.dispatchEvent(
        new FakeEvent('pointerdown', {
          bubbles: true,
          button: 0,
          pointerType: 'mouse',
          clientX: pt.x,
          clientY: pt.y,
        })
      );
      expect(mountEl2.querySelector('[data-testid="arrange-screen"]')).toBe(arrangeRoot);
      expect(mountEl2.querySelector('#v3-arrange-inspector-slot')).toBe(inspectorSlot);
      expect(arrangeMountSpy).toHaveBeenCalledTimes(2);
      expect(arrangeUnmountSpy).toHaveBeenCalledTimes(1);

      // Leave ARRANGE -> unmounts ArrangePhaseView & mounts MapPhaseView!
      const leaveBtn = mountEl2.querySelector('[data-testid="btn-leave-arrange"]')!;
      expect(leaveBtn.disabled).toBe(false);
      leaveBtn.click();
      expect(arrangeUnmountSpy).toHaveBeenCalledTimes(2);
      expect(mapMountSpy).toHaveBeenCalledTimes(2);
      expect(mountEl2.querySelector('[data-testid="map-screen"]')).not.toBeNull();

      controller2.destroy();
      expect(mapUnmountSpy).toHaveBeenCalledTimes(2);
    });

    it('ArrangePhaseView renders fallback 核心炮 pill on initial mount and remount with unarmed bay, and transitions unarmed -> armed -> unarmed cleanly', () => {
      const host = dom.document.createElement('div');
      dom.document.body.appendChild(host);

      const batteryOnly = createV2EquipmentInstance({
        instanceId: 'eq_unarmed_bat_1',
        kind: 'battery',
        quality: 'common',
        origin: 'owned',
        acquiredDepth: 0,
        location: 'bay',
      });
      const armedLaser = createV2EquipmentInstance({
        instanceId: 'eq_armed_laser_1',
        kind: 'laser',
        quality: 'common',
        origin: 'loan',
        acquiredDepth: 0,
        location: 'bay',
      });

      const baseRun = buildArrangeRun();
      const unarmedRun: V2RunState = {
        ...baseRun,
        bay: { ...baseRun.bay, placed: [{ item: batteryOnly, x: 0, y: 0, rotation: 0 }], staging: [] },
      };
      const emptyBayRun: V2RunState = {
        ...baseRun,
        bay: { ...baseRun.bay, placed: [], staging: [] },
      };
      const armedRun: V2RunState = {
        ...baseRun,
        bay: { ...baseRun.bay, placed: [{ item: armedLaser, x: 0, y: 0, rotation: 0 }], staging: [] },
      };

      expect(deriveV2ShipVisualSpec(unarmedRun.bay).mountSummaryTags).toEqual([]);
      expect(deriveV2ShipVisualSpec(emptyBayRun.bay).mountSummaryTags).toEqual([]);
      expect(deriveV2ShipVisualSpec(armedRun.bay).mountSummaryTags.length).toBeGreaterThan(0);

      const actions = {
        onToggleShipPreview: vi.fn(),
        onEngineerSwap: vi.fn(),
        onSurveyScan: vi.fn(),
        onUseGadget: vi.fn(),
        onAbortContract: vi.fn(),
        onLeaveArrange: vi.fn(),
      };

      const view = new ArrangePhaseView();
      view.mount(host as unknown as HTMLElement);

      // 1. Initial mount with unarmed (battery-only) bay MUST render fallback 核心炮 pill
      view.update({ run: unarmedRun, readOnly: false, sceneCollapsed: false }, actions);
      const initialPills = host.querySelectorAll('.v2-mount-pill');
      expect(initialPills).toHaveLength(1);
      expect(initialPills[0].classList.contains('muted')).toBe(true);
      expect(initialPills[0].textContent).toBe('核心炮');

      // 2. Repeated update with unchanged unarmed bay performs 0 redundant innerHTML writes
      const pillsHost = initialPills[0].parentElement!;
      pillsHost.resetInnerHtmlWriteCount();
      view.update({ run: unarmedRun, readOnly: false, sceneCollapsed: false }, actions);
      expect(pillsHost.innerHtmlWriteCount).toBe(0);
      expect(host.querySelectorAll('.v2-mount-pill')).toHaveLength(1);

      // 3. Unarmed -> Armed renders real weapon mount pill (non-muted)
      view.update({ run: armedRun, readOnly: false, sceneCollapsed: false }, actions);
      const armedPills = host.querySelectorAll('.v2-mount-pill');
      expect(armedPills).toHaveLength(1);
      expect(armedPills[0].classList.contains('muted')).toBe(false);
      expect(armedPills[0].textContent).toContain('脉冲炮塔');

      // 4. Armed -> Unarmed (empty bay) restores fallback 核心炮 pill
      view.update({ run: emptyBayRun, readOnly: false, sceneCollapsed: false }, actions);
      const backUnarmedPills = host.querySelectorAll('.v2-mount-pill');
      expect(backUnarmedPills).toHaveLength(1);
      expect(backUnarmedPills[0].classList.contains('muted')).toBe(true);
      expect(backUnarmedPills[0].textContent).toBe('核心炮');

      // 5. Armed -> unmount() -> mount() -> update(unarmed) MUST render fallback 核心炮 pill
      view.update({ run: armedRun, readOnly: false, sceneCollapsed: false }, actions);
      view.unmount();
      view.mount(host as unknown as HTMLElement);
      view.update({ run: unarmedRun, readOnly: false, sceneCollapsed: false }, actions);
      const remountPills = host.querySelectorAll('.v2-mount-pill');
      expect(remountPills).toHaveLength(1);
      expect(remountPills[0].classList.contains('muted')).toBe(true);
      expect(remountPills[0].textContent).toBe('核心炮');

      view.unmount();
    });

    it('MapPhaseView toggles optional banner slots cleanly with null keys and blocks stale clicks on detached jumpBtn', () => {
      const host = dom.document.createElement('div');
      dom.document.body.appendChild(host);

      const rawTut = createV2TutorialRun('run_map_slots_test');
      const baseRun: V2RunState = {
        ...rawTut,
        phase: 'MAP',
        bay: { ...rawTut.bay, staging: [] },
      };
      const onJumpNode = vi.fn();
      const actions = {
        onSelectNode: vi.fn(),
        onJumpNode,
        onToggleMobileMap: vi.fn(),
        onSafeReturn: vi.fn(),
        onAbortContract: vi.fn(),
        onUseGadget: vi.fn(),
      };

      const view = new MapPhaseView();
      view.mount(host as unknown as HTMLElement);

      // 1. Initial mount with inactive optional banners -> all 5 slots MUST stay display:none with 0 children
      view.update(
        {
          run: baseRun,
          readOnly: false,
          selectedMapNodeId: 'L1A',
          mobileMapShowFull: true,
          isCompactViewport: false,
          pureAutoCombat: false,
          fullMapReveal: false,
        },
        actions
      );
      const slotNames = [
        'final-mission',
        'endless',
        'navigator-reveal',
        'bonus-tracker',
        'relic-signal',
      ] as const;
      for (const slot of slotNames) {
        const el = host.querySelector(`[data-slot="${slot}"]`)!;
        expect(el).not.toBeNull();
        expect(el.style.display).toBe('none');
        expect(el.children).toHaveLength(0);
      }

      // Activate final-mission + navigator-reveal -> slots switch to display:contents with children
      view.update(
        {
          run: { ...baseRun, isFinalCampaignRun: true },
          readOnly: false,
          selectedMapNodeId: 'L1A',
          mobileMapShowFull: true,
          isCompactViewport: false,
          pureAutoCombat: false,
          fullMapReveal: true,
        },
        actions
      );
      const finalSlot = host.querySelector('[data-slot="final-mission"]')!;
      const navSlot = host.querySelector('[data-slot="navigator-reveal"]')!;
      expect(finalSlot.style.display).toBe('contents');
      expect(finalSlot.children.length).toBeGreaterThan(0);
      expect(navSlot.style.display).toBe('contents');
      expect(navSlot.children.length).toBeGreaterThan(0);

      // Deactivate back -> slots cleanly return to display:none with 0 children
      view.update(
        {
          run: baseRun,
          readOnly: false,
          selectedMapNodeId: 'L1A',
          mobileMapShowFull: true,
          isCompactViewport: false,
          pureAutoCombat: false,
          fullMapReveal: false,
        },
        actions
      );
      expect(finalSlot.style.display).toBe('none');
      expect(finalSlot.children).toHaveLength(0);
      expect(navSlot.style.display).toBe('none');
      expect(navSlot.children).toHaveLength(0);

      // 2. Capture jumpBtnRef while L1A is reachable, then move to terminal node (0 reachable nodes)
      const jumpBtnRef = host.querySelector('[data-testid="btn-jump-node"]')!;
      expect(jumpBtnRef).not.toBeNull();
      expect(jumpBtnRef.disabled).toBe(false);
      expect(jumpBtnRef.dataset.jumpNode).toBe('L1A');

      const terminalNodeId = Object.values(baseRun.graph.nodes).find(
        (n) => n.nextNodeIds.length === 0
      )!.nodeId;
      const terminalRun: V2RunState = {
        ...baseRun,
        currentNodeId: terminalNodeId,
        visitedNodeIds: ['L1A', 'L2A', 'L3A', terminalNodeId],
      };
      view.update(
        {
          run: terminalRun,
          readOnly: false,
          selectedMapNodeId: null,
          mobileMapShowFull: true,
          isCompactViewport: false,
          pureAutoCombat: false,
          fullMapReveal: false,
        },
        actions
      );

      expect(host.querySelector('[data-testid="btn-jump-node"]')).toBeNull();
      expect(jumpBtnRef.disabled).toBe(true);
      expect(jumpBtnRef.dataset.jumpNode).toBeUndefined();

      // Even if a stale caller forces disabled=false and clicks the detached node, handleJump MUST NOT fire!
      jumpBtnRef.disabled = false;
      jumpBtnRef.click();
      expect(onJumpNode).toHaveBeenCalledTimes(0);

      view.unmount();
    });
  });
});
