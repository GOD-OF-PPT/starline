import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal Third-Party Phaser WebGL Stub (ONLY 'phaser' is mocked — ALL real
// project modules run untouched: PhaserHost, BaseScene, V2CombatScene,
// V2AppController, CargoGridV2Component, MapPhaseView, ArrangePhaseView,
// SettlementBillRollupController, PlaytestTelemetryLogger, soundEngine!)
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
    width = 192;
    height = 192;
    displayWidth = 192;
    displayHeight = 192;
    visible = true;
    alpha = 1;
    depth = 0;
    textureKey: string;
    text: string;
    tint: number | null = null;
    blendMode = 0;
    angle = 0;

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
    setBlendMode(mode: number): this {
      this.blendMode = mode;
      return this;
    }
    setPosition(x: number, y: number): this {
      this.x = x;
      this.y = y;
      return this;
    }
    setX(x: number): this {
      this.x = x;
      return this;
    }
    setY(y: number): this {
      this.y = y;
      return this;
    }
    setScale(sx: number, sy?: number): this {
      this.displayWidth = this.width * sx;
      this.displayHeight = this.height * (sy ?? sx);
      return this;
    }
    setDisplaySize(w: number, h: number): this {
      this.displayWidth = w;
      this.displayHeight = h;
      return this;
    }
    setAngle(a: number): this {
      this.angle = a;
      return this;
    }
    setFlipX(_f: boolean): this {
      return this;
    }
    setTint(t: number): this {
      this.tint = t;
      return this;
    }
    clearTint(): this {
      this.tint = null;
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
    setStyle(_style: Record<string, unknown>): this {
      return this;
    }
    setCrop(..._args: unknown[]): this {
      return this;
    }
    setSize(w: number, h: number): this {
      this.width = w;
      this.height = h;
      return this;
    }
    setInteractive(_opts?: unknown): this {
      return this;
    }
    on(_event: string, _fn: (...args: unknown[]) => void): this {
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
    fillCircle(_x: number, _y: number, _r: number): this {
      return this;
    }
    strokeCircle(_x: number, _y: number, _r: number): this {
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
    fillEllipse(_x: number, _y: number, _w: number, _h: number): this {
      return this;
    }
    strokeEllipse(_x: number, _y: number, _w: number, _h: number): this {
      return this;
    }
    fillTriangle(..._args: number[]): this {
      return this;
    }
    strokeTriangle(..._args: number[]): this {
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
    arc(..._args: unknown[]): this {
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
    destroy(): void {
      this.scene = null;
      this.visible = false;
    }
  }

  class MockPhaserScene {
    readonly __key: string;
    readonly events = new MockEventEmitter();
    readonly sys: { settings: { status: number }; isActive: () => boolean } = {
      settings: { status: MOCK_SCENE_STATUS.PENDING },
      isActive: () => this.sys.settings.status === MOCK_SCENE_STATUS.RUNNING,
    };
    readonly texturesSet = new Set<string>();
    readonly loadedImages: Array<{ readonly key: string; readonly url: string }> = [];
    game!: MockPhaserGame;
    scale!: MockPhaserGame['scale'];
    readonly cameras = {
      main: {
        setViewport: () => {},
        setZoom: () => {},
        setScroll: () => {},
        centerOn: () => {},
        setBackgroundColor: () => {},
      },
    };
    readonly load = {
      on: (_ev: string, _fn: (...args: unknown[]) => void) => {},
      image: (key: string, url: string) => {
        this.loadedImages.push({ key, url });
        if (phaserTestHarness.autoLoadDynamicTextures) {
          this.texturesSet.add(key);
        }
      },
      start: () => {},
    };
    readonly textures = {
      exists: (key: string) => this.texturesSet.has(key),
      addBase64: (key: string, _data: string) => {
        if (phaserTestHarness.autoLoadDynamicTextures) {
          this.texturesSet.add(key);
        }
      },
    };
    readonly time = {
      delayedCall: (delayMs: number, fn: () => void) => {
        const id = globalThis.setTimeout(fn, delayMs);
        return {
          remove: (_dispatch?: boolean) => globalThis.clearTimeout(id),
        };
      },
      removeEvent: (handle?: { remove?: (dispatch?: boolean) => void }) => {
        handle?.remove?.(false);
      },
    };
    readonly add = {
      graphics: () => new MockDisplayObject(this),
      image: (x: number, y: number, key: string) => new MockDisplayObject(this, x, y, key),
      text: (x: number, y: number, txt: string) => new MockDisplayObject(this, x, y, '', txt),
      zone: (x: number, y: number, w: number, h: number) => {
        const z = new MockDisplayObject(this, x, y);
        z.width = w;
        z.height = h;
        return z;
      },
    };
    readonly scene = {
      isActive: () => this.sys.settings.status === MOCK_SCENE_STATUS.RUNNING,
      start: (key: string, data?: unknown) => this.game.scene.start(key, data),
      stop: (key: string) => this.game.scene.stop(key),
    };

    constructor(config?: { key?: string } | string) {
      this.__key = typeof config === 'string' ? config : config?.key ?? 'Scene';
    }
  }

  class MockPhaserGame {
    readonly events = new MockEventEmitter();
    readonly registryMap = new Map<string, unknown>();
    readonly registry = {
      get: (k: string) => this.registryMap.get(k),
      set: (k: string, v: unknown) => {
        this.registryMap.set(k, v);
      },
    };
    readonly canvas: {
      parentElement: HTMLElement | null;
      style: Record<string, string>;
      width: number;
      height: number;
    };
    readonly scale: {
      width: number;
      height: number;
      readonly emitter: MockEventEmitter;
      on: (ev: string, fn: (...args: unknown[]) => void, ctx?: unknown) => void;
      off: (ev: string, fn?: (...args: unknown[]) => void, ctx?: unknown) => void;
      resize: (w: number, h: number) => void;
    };
    readonly loop = { rawDelta: 16 };
    readonly sceneMap = new Map<string, MockPhaserScene>();
    readonly scene = {
      isActive: (key: string) =>
        this.sceneMap.get(key)?.sys.settings.status === MOCK_SCENE_STATUS.RUNNING,
      start: (key: string, data?: unknown) => {
        const sc = this.sceneMap.get(key);
        if (!sc) return;
        if (sc.sys.settings.status === MOCK_SCENE_STATUS.RUNNING) {
          sc.events.emit('shutdown');
        }
        sc.sys.settings.status = MOCK_SCENE_STATUS.START;
        (sc as unknown as { init?: (d?: unknown) => void }).init?.(data);
        (sc as unknown as { preload?: () => void }).preload?.();
        sc.sys.settings.status = MOCK_SCENE_STATUS.RUNNING;
        (sc as unknown as { create?: () => void }).create?.();
      },
      stop: (key: string) => {
        const sc = this.sceneMap.get(key);
        if (!sc) return;
        if (sc.sys.settings.status === MOCK_SCENE_STATUS.RUNNING) {
          sc.events.emit('shutdown');
        }
        sc.sys.settings.status = MOCK_SCENE_STATUS.SHUTDOWN;
      },
    };

    constructor(config: {
      parent?: HTMLElement;
      width?: number;
      height?: number;
      scene?: MockPhaserScene[];
    }) {
      const scaleEmitter = new MockEventEmitter();
      this.canvas = {
        parentElement: config.parent ?? null,
        style: {},
        width: config.width ?? 640,
        height: config.height ?? 360,
      };
      this.scale = {
        width: config.width ?? 640,
        height: config.height ?? 360,
        emitter: scaleEmitter,
        on: (ev, fn, ctx) => {
          scaleEmitter.on(ev, fn, ctx);
        },
        off: (ev, fn, ctx) => {
          scaleEmitter.off(ev, fn, ctx);
        },
        resize: (w: number, h: number) => {
          this.scale.width = w;
          this.scale.height = h;
          this.canvas.width = w;
          this.canvas.height = h;
          scaleEmitter.emit('resize', { width: w, height: h });
        },
      };
      for (const sc of config.scene ?? []) {
        sc.game = this;
        sc.scale = this.scale;
        this.sceneMap.set(sc.__key, sc);
      }
      phaserTestHarness.lastGame = this;
      if (phaserTestHarness.autoReady) {
        queueMicrotask(() => {
          this.events.emit('ready');
        });
      }
    }

    getScene<T = MockPhaserScene>(key: string): T | undefined {
      return this.sceneMap.get(key) as T | undefined;
    }

    destroy(_removeCanvas?: boolean): void {
      for (const sc of this.sceneMap.values()) {
        if (sc.sys.settings.status === MOCK_SCENE_STATUS.RUNNING) {
          sc.events.emit('shutdown');
        }
        sc.sys.settings.status = MOCK_SCENE_STATUS.DESTROYED;
      }
    }
  }

  const phaserTestHarness: {
    lastGame: MockPhaserGame | null;
    autoReady: boolean;
    autoLoadDynamicTextures: boolean;
  } = {
    lastGame: null,
    autoReady: true,
    autoLoadDynamicTextures: true,
  };

  return { MOCK_SCENE_STATUS, MockPhaserScene, MockPhaserGame, phaserTestHarness };
});

vi.mock('phaser', () => ({
  default: {
    AUTO: 0,
    CANVAS: 1,
    WEBGL: 2,
    Scale: { NONE: 0 },
    BlendModes: { NORMAL: 0, ADD: 1 },
    Core: {
      Events: { READY: 'ready' },
    },
    Scenes: {
      ...MOCK_SCENE_STATUS,
      Events: { SHUTDOWN: 'shutdown' },
    },
    Scene: MockPhaserScene,
    Game: MockPhaserGame,
  },
  AUTO: 0,
  CANVAS: 1,
  WEBGL: 2,
  Scale: { NONE: 0 },
  BlendModes: { NORMAL: 0, ADD: 1 },
  Core: {
    Events: { READY: 'ready' },
  },
  Scenes: {
    ...MOCK_SCENE_STATUS,
    Events: { SHUTDOWN: 'shutdown' },
  },
  Scene: MockPhaserScene,
  Game: MockPhaserGame,
}));

import { getItemImageUrl } from '../src/assets/itemArt';
import { soundEngine, type SfxKind } from '../src/audio/soundEngine';
import { BaseScene, getDockingItemTextureKey } from '../src/scenes/BaseScene';
import { PhaserHost } from '../src/scenes/PhaserHost';
import { V2_SHIP_ORDER } from '../src/v2/data/ships';
import { createV2TutorialRun } from '../src/v2/data/tutorialV2';
import { calculateV2BuildStats } from '../src/v2/domain/buildStatsV2';
import * as combatV2 from '../src/v2/domain/combatV2';
import { createV2EquipmentInstance, createV2CargoInstance } from '../src/v2/domain/itemCatalog';
import {
  buildFreeFallbackPrepareSlots,
  launchV2Expedition,
  validateV2PrepareLoadout,
} from '../src/v2/domain/loadout';
import { createFreshV2SaveData, persistV2SaveData } from '../src/v2/domain/persistenceV2';
import { calculateV2Settlement } from '../src/v2/domain/settlementV2';
import {
  classifyV2CombatDeltaTrend,
  classifyV2CombatThreat,
  clearTacticalDeltaCache,
  computeV2PlacementTacticalDelta,
  getV2ThreatTierMeta,
} from '../src/v2/domain/tacticalDelta';
import type { V2CargoBayState, V2PlacedItem, V2RunState, V2SaveData } from '../src/v2/domain/types';
import { computeWreckCutTimeline, VFX_WRECK_CLAMP_POP_RATIO, VFX_WRECK_CUT_DURATION_MS } from '../src/v2/scenes/v2CombatVfx';
import { V2CombatScene } from '../src/v2/scenes/V2CombatScene';
import { CargoGridV2Component } from '../src/v2/ui/CargoGridV2';
import {
  PLAYTEST_LOG_STORAGE_KEY,
  PlaytestTelemetryLogger,
  classifyPureConfirmAction,
  computePlaytestSummary,
  isPlaytestParamEnabled,
} from '../src/v2/ui/playtestTelemetry';
import { SettlementBillRollupController, renderSettlementView } from '../src/v2/ui/screens/SettlementView';
import { V2AppController } from '../src/v2/ui/V2AppController';

// ---------------------------------------------------------------------------
// Minimal Pure-JS Fake DOM for Node-environment Integration Testing
// ---------------------------------------------------------------------------
class MiniEvent {
  readonly type: string;
  readonly bubbles: boolean;
  readonly key: string;
  readonly button: number;
  readonly pointerId: number;
  readonly pointerType: string;
  readonly clientX: number;
  readonly clientY: number;
  target: unknown = null;
  currentTarget: unknown = null;
  defaultPrevented = false;
  private stopped = false;

  constructor(
    type: string,
    init: {
      bubbles?: boolean;
      key?: string;
      button?: number;
      pointerId?: number;
      pointerType?: string;
      clientX?: number;
      clientY?: number;
    } = {}
  ) {
    this.type = type;
    this.bubbles = init.bubbles ?? false;
    this.key = init.key ?? '';
    this.button = init.button ?? 0;
    this.pointerId = init.pointerId ?? 1;
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
  protected readonly captureListeners = new Map<string, Set<(ev: MiniEvent) => void>>();

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
  addEventListener(type: string, fn: (ev: MiniEvent) => void, capture?: boolean | { capture?: boolean }): void {
    const isCap = typeof capture === 'boolean' ? capture : Boolean(capture?.capture);
    const map = isCap ? this.captureListeners : this.listeners;
    let set = map.get(type);
    if (!set) {
      set = new Set();
      map.set(type, set);
    }
    set.add(fn);
  }
  removeEventListener(type: string, fn: (ev: MiniEvent) => void, capture?: boolean | { capture?: boolean }): void {
    const isCap = typeof capture === 'boolean' ? capture : Boolean(capture?.capture);
    (isCap ? this.captureListeners : this.listeners).get(type)?.delete(fn);
  }
  dispatchEvent(ev: MiniEvent): boolean {
    if (ev.target === null) ev.target = this;
    // Build ancestor path snapshot before target handlers potentially mutate DOM
    const path: MiniNode[] = [];
    let cur: MiniNode | null = this;
    while (cur) {
      path.push(cur);
      cur = cur.parentNode;
    }
    // 1. Capture phase (outermost ancestor -> target)
    for (let i = path.length - 1; i >= 0; i--) {
      const node = path[i];
      ev.currentTarget = node;
      const capSet = node.captureListeners.get(ev.type);
      if (capSet) {
        for (const fn of [...capSet]) fn(ev);
      }
      if (ev.isStopped()) return !ev.defaultPrevented;
    }
    // 2. Target + Bubble phase (target -> outermost ancestor)
    for (let i = 0; i < path.length; i++) {
      const node = path[i];
      ev.currentTarget = node;
      const set = node.listeners.get(ev.type);
      if (set) {
        for (const fn of [...set]) fn(ev);
      }
      if (!ev.bubbles || ev.isStopped()) break;
    }
    return !ev.defaultPrevented;
  }
}

class MiniTextNode extends MiniNode {
  constructor(public nodeValue: string) {
    super();
  }
}

function decodeMiniEntities(raw: string): string {
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseHtmlIntoMini(doc: MiniDocument, parent: MiniElement, html: string): void {
  const voidTags = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source']);
  const stack: MiniElement[] = [parent];
  const tokenRe = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9:-]+)\s*>|<([a-zA-Z0-9:-]+)((?:\s+[^<>]*?)?)\s*(\/?)>|([^<]+)/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(html)) !== null) {
    const [, closeTag, openTag, attrStr, selfClose, text] = match;
    if (text !== undefined) {
      stack[stack.length - 1].appendChild(new MiniTextNode(decodeMiniEntities(text)));
    } else if (closeTag) {
      const upper = closeTag.toUpperCase();
      for (let i = stack.length - 1; i >= 1; i--) {
        if (stack[i].tagName === upper) {
          stack.length = i;
          break;
        }
      }
    } else if (openTag) {
      const el = doc.createElement(openTag);
      if (attrStr) {
        const attrRe = /([a-zA-Z0-9_:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
        let am: RegExpExecArray | null;
        while ((am = attrRe.exec(attrStr)) !== null) {
          const name = am[1];
          const val = am[2] ?? am[3] ?? am[4] ?? '';
          el.setAttribute(name, decodeMiniEntities(val));
        }
      }
      stack[stack.length - 1].appendChild(el);
      if (!selfClose && !voidTags.has(openTag.toLowerCase())) {
        stack.push(el);
      }
    }
  }
}

function matchesSimpleSelector(el: MiniElement, sel: string): boolean {
  const s = sel.trim();
  if (!s) return false;
  let rest = s;
  const tagMatch = rest.match(/^[a-zA-Z][a-zA-Z0-9-]*/);
  if (tagMatch) {
    if (el.tagName !== tagMatch[0].toUpperCase()) return false;
    rest = rest.slice(tagMatch[0].length);
  }
  while (rest.length > 0) {
    if (rest.startsWith('#')) {
      const m = rest.match(/^#([a-zA-Z0-9_-]+)/);
      if (!m || el.id !== m[1]) return false;
      rest = rest.slice(m[0].length);
    } else if (rest.startsWith('.')) {
      const m = rest.match(/^\.([a-zA-Z0-9_-]+)/);
      if (!m || !el.classList.contains(m[1])) return false;
      rest = rest.slice(m[0].length);
    } else if (rest.startsWith('[')) {
      const m = rest.match(/^\[([a-zA-Z0-9_:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/);
      if (!m) return false;
      const attrName = m[1];
      const expected = m[2] ?? m[3] ?? m[4];
      const actual = el.getAttribute(attrName);
      if (actual === null) return false;
      if (expected !== undefined && actual !== expected) return false;
      rest = rest.slice(m[0].length);
    } else {
      return false;
    }
  }
  return true;
}

function matchesSingleCompound(el: MiniElement, selector: string, scopeEl?: MiniElement): boolean {
  const normalized = selector.trim().replace(/\s*>\s*/g, ' > ');
  const rawTokens = normalized.split(/\s+/).filter(Boolean);
  if (rawTokens.length === 0) return false;
  if (rawTokens[0] === ':scope' && rawTokens[1] === '>') {
    if (!scopeEl || el.parentElement !== scopeEl) return false;
    return matchesSingleCompound(el, rawTokens.slice(2).join(' '));
  }
  const parts = rawTokens.filter((t) => t !== '>' && t !== ':scope');
  if (parts.length === 0) return false;
  if (!matchesSimpleSelector(el, parts[parts.length - 1])) return false;
  let cur = el.parentElement;
  for (let i = parts.length - 2; i >= 0; i--) {
    let found = false;
    while (cur) {
      if (matchesSimpleSelector(cur, parts[i])) {
        found = true;
        cur = cur.parentElement;
        break;
      }
      cur = cur.parentElement;
    }
    if (!found) return false;
  }
  return true;
}

function matchesSelectorList(el: MiniElement, selectorList: string, scopeEl?: MiniElement): boolean {
  return selectorList
    .split(',')
    .map((s) => s.trim())
    .some((part) => matchesSingleCompound(el, part, scopeEl));
}

class MiniElement extends MiniNode {
  readonly tagName: string;
  readonly attrs = new Map<string, string>();
  readonly styleMap = new Map<string, string>();
  readonly style: Record<string, string> & { setProperty: (k: string, v: string) => void };
  readonly classList: MiniClassList;
  readonly dataset: Record<string, string | undefined>;
  value = '';
  checked = false;
  inert = false;
  scrollLeft = 0;
  scrollTop = 0;
  private customRect: { left: number; top: number; width: number; height: number } | null = null;

  constructor(private readonly doc: MiniDocument, tagName: string) {
    super();
    this.tagName = tagName.toUpperCase();
    this.classList = new MiniClassList(this);
    const styleObj: Record<string, unknown> = {
      setProperty: (k: string, v: string) => {
        this.styleMap.set(k, String(v));
      },
    };
    this.style = new Proxy(styleObj, {
      get: (target, prop: string) => {
        if (prop in target) return target[prop];
        return this.styleMap.get(prop) ?? '';
      },
      set: (target, prop: string, val: unknown) => {
        if (prop in target) {
          target[prop] = val;
          return true;
        }
        this.styleMap.set(prop, String(val ?? ''));
        return true;
      },
    }) as Record<string, string> & { setProperty: (k: string, v: string) => void };

    this.dataset = new Proxy({} as Record<string, string | undefined>, {
      get: (_t, prop: string) => {
        const v = this.getAttribute(`data-${camelToKebab(prop)}`);
        return v === null ? undefined : v;
      },
      set: (_t, prop: string, val: unknown) => {
        if (val === undefined || val === null) {
          this.removeAttribute(`data-${camelToKebab(prop)}`);
        } else {
          this.setAttribute(`data-${camelToKebab(prop)}`, String(val));
        }
        return true;
      },
      deleteProperty: (_t, prop: string) => {
        this.removeAttribute(`data-${camelToKebab(prop)}`);
        return true;
      },
      ownKeys: () =>
        [...this.attrs.keys()]
          .filter((k) => k.startsWith('data-'))
          .map((k) => kebabToCamel(k.slice(5))),
      getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true }),
    });
  }

  get id(): string {
    return this.attrs.get('id') ?? '';
  }
  set id(val: string) {
    this.setAttribute('id', val);
  }
  get className(): string {
    return this.attrs.get('class') ?? '';
  }
  set className(val: string) {
    this.setAttribute('class', val);
  }
  get disabled(): boolean {
    return this.attrs.has('disabled');
  }
  set disabled(val: boolean) {
    if (val) this.attrs.set('disabled', '');
    else this.attrs.delete('disabled');
  }
  get tabIndex(): number {
    const raw = this.attrs.get('tabindex');
    return raw === undefined ? -1 : Number(raw);
  }
  set tabIndex(v: number) {
    this.attrs.set('tabindex', String(v));
  }
  get src(): string {
    return this.attrs.get('src') ?? '';
  }
  set src(v: string) {
    this.attrs.set('src', v);
  }
  get alt(): string {
    return this.attrs.get('alt') ?? '';
  }
  set alt(v: string) {
    this.attrs.set('alt', v);
  }
  get title(): string {
    return this.attrs.get('title') ?? '';
  }
  set title(v: string) {
    this.attrs.set('title', v);
  }
  get type(): string {
    return this.attrs.get('type') ?? '';
  }
  set type(v: string) {
    this.attrs.set('type', v);
  }
  get draggable(): boolean {
    return this.attrs.get('draggable') !== 'false';
  }
  set draggable(v: boolean) {
    this.attrs.set('draggable', String(v));
  }

  setAttribute(name: string, value: string): void {
    const low = name.toLowerCase();
    this.attrs.set(low, String(value));
    if (low === 'value') this.value = String(value);
    if (low === 'checked') this.checked = true;
    if (low === 'style') {
      for (const part of String(value).split(';')) {
        const idx = part.indexOf(':');
        if (idx > 0) {
          const k = part.slice(0, idx).trim();
          const v = part.slice(idx + 1).trim();
          if (k) this.styleMap.set(kebabToCamel(k), v);
        }
      }
    }
  }
  getAttribute(name: string): string | null {
    const low = name.toLowerCase();
    return this.attrs.has(low) ? this.attrs.get(low)! : null;
  }
  removeAttribute(name: string): void {
    const low = name.toLowerCase();
    this.attrs.delete(low);
    if (low === 'checked') this.checked = false;
  }

  get textContent(): string {
    let out = '';
    for (const c of this.childNodes) {
      if (c instanceof MiniTextNode) out += c.nodeValue;
      else if (c instanceof MiniElement) out += c.textContent;
    }
    return out;
  }
  set textContent(v: string) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes.length = 0;
    if (v) this.appendChild(new MiniTextNode(String(v)));
  }

  get innerHTML(): string {
    let out = '';
    for (const c of this.childNodes) {
      if (c instanceof MiniTextNode) out += c.nodeValue;
      else if (c instanceof MiniElement) out += c.outerHTML;
    }
    return out;
  }
  set innerHTML(html: string) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes.length = 0;
    if (html) parseHtmlIntoMini(this.doc, this, String(html));
  }

  get outerHTML(): string {
    const tag = this.tagName.toLowerCase();
    const attrs = [...this.attrs.entries()].map(([k, v]) => `${k}="${v}"`).join(' ');
    return `<${tag}${attrs ? ` ${attrs}` : ''}>${this.innerHTML}</${tag}>`;
  }

  setMockRect(rect: { left: number; top: number; width: number; height: number }): void {
    this.customRect = rect;
  }

  getBoundingClientRect(): DOMRect {
    if (this.customRect) {
      const r = this.customRect;
      return {
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        right: r.left + r.width,
        bottom: r.top + r.height,
        x: r.left,
        y: r.top,
        toJSON: () => r,
      } as DOMRect;
    }
    const isBoard = this.classList.contains('v2-cargo-board');
    const w = isBoard ? 256 : 640;
    const h = isBoard ? 256 : 360;
    return {
      left: 0,
      top: 0,
      width: w,
      height: h,
      right: w,
      bottom: h,
      x: 0,
      y: 0,
      toJSON: () => ({ left: 0, top: 0, width: w, height: h }),
    } as DOMRect;
  }

  focus(_opts?: unknown): void {
    this.doc.activeElement = this;
    this.dispatchEvent(new MiniEvent('focusin', { bubbles: true }));
  }

  click(): void {
    if (this.disabled) return;
    this.dispatchEvent(new MiniEvent('click', { bubbles: true }));
  }

  closest(selector: string): MiniElement | null {
    let cur: MiniElement | null = this;
    while (cur) {
      if (matchesSelectorList(cur, selector)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  querySelectorAll(selector: string): MiniElement[] {
    const out: MiniElement[] = [];
    const walk = (node: MiniElement) => {
      for (const ch of node.children) {
        if (matchesSelectorList(ch, selector, this)) out.push(ch);
        walk(ch);
      }
    };
    walk(this);
    return out;
  }

  querySelector(selector: string): MiniElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

class MiniStorage {
  private readonly store = new Map<string, string>();
  quotaFailKey: string | null = null;
  readonly getCalls: string[] = [];
  readonly setCalls: string[] = [];
  readonly removeCalls: string[] = [];

  get length(): number {
    return this.store.size;
  }
  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }
  getItem(k: string): string | null {
    this.getCalls.push(k);
    return this.store.has(k) ? this.store.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.setCalls.push(k);
    if (this.quotaFailKey === k) {
      const err = new Error('QuotaExceededError');
      err.name = 'QuotaExceededError';
      throw err;
    }
    this.store.set(k, String(v));
  }
  removeItem(k: string): void {
    this.removeCalls.push(k);
    this.store.delete(k);
  }
  clear(): void {
    this.store.clear();
  }
}

class MiniDocument {
  readonly body: MiniElement;
  readonly documentElement: MiniElement;
  activeElement: MiniElement | null = null;
  hidden = false;
  private readonly listeners = new Map<string, Set<(ev: MiniEvent) => void>>();

  constructor() {
    this.documentElement = new MiniElement(this, 'html');
    this.body = new MiniElement(this, 'body');
    this.documentElement.appendChild(this.body);
  }

  createElement(tag: string): MiniElement {
    return new MiniElement(this, tag);
  }
  createElementNS(_ns: string, tag: string): MiniElement {
    return new MiniElement(this, tag);
  }
  querySelector(sel: string): MiniElement | null {
    return this.body.querySelector(sel);
  }
  querySelectorAll(sel: string): MiniElement[] {
    return this.body.querySelectorAll(sel);
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
    const set = this.listeners.get(ev.type);
    if (set) {
      for (const fn of [...set]) fn(ev);
    }
    return !ev.defaultPrevented;
  }
}

class MiniWindow {
  readonly document: MiniDocument;
  readonly localStorage = new MiniStorage();
  readonly sessionStorage = new MiniStorage();
  readonly location: { search: string; href: string };
  innerWidth = 1366;
  innerHeight = 768;
  devicePixelRatio = 1;
  __STARLINE_INSPECT__?: () => unknown;
  private readonly listeners = new Map<string, Set<(ev: MiniEvent) => void>>();

  constructor(doc: MiniDocument, search = '') {
    this.document = doc;
    this.location = { search, href: `http://localhost:5173/${search}` };
  }

  setTimeout = (fn: (...args: unknown[]) => void, ms?: number) =>
    globalThis.setTimeout(fn, ms) as unknown as number;
  clearTimeout = (id?: number) => globalThis.clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
  setInterval = (fn: (...args: unknown[]) => void, ms?: number) =>
    globalThis.setInterval(fn, ms) as unknown as number;
  clearInterval = (id?: number) =>
    globalThis.clearInterval(id as unknown as ReturnType<typeof setInterval>);
  requestAnimationFrame = (fn: FrameRequestCallback) =>
    globalThis.setTimeout(() => fn(Date.now()), 16) as unknown as number;
  cancelAnimationFrame = (id: number) =>
    globalThis.clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
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
    const set = this.listeners.get(ev.type);
    if (set) {
      for (const fn of [...set]) fn(ev);
    }
    return !ev.defaultPrevented;
  }
}

function installMiniDom(search = ''): { readonly window: MiniWindow; readonly document: MiniDocument } {
  const doc = new MiniDocument();
  const win = new MiniWindow(doc, search);
  (globalThis as Record<string, unknown>).window = win;
  (globalThis as Record<string, unknown>).document = doc;
  (globalThis as Record<string, unknown>).HTMLElement = MiniElement;
  (globalThis as Record<string, unknown>).Element = MiniElement;
  (globalThis as Record<string, unknown>).requestAnimationFrame = win.requestAnimationFrame;
  (globalThis as Record<string, unknown>).cancelAnimationFrame = win.cancelAnimationFrame;
  (globalThis as Record<string, unknown>).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  return { window: win, document: doc };
}

function teardownMiniDom(): void {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).document;
  delete (globalThis as Record<string, unknown>).HTMLElement;
  delete (globalThis as Record<string, unknown>).Element;
  delete (globalThis as Record<string, unknown>).requestAnimationFrame;
  delete (globalThis as Record<string, unknown>).cancelAnimationFrame;
  delete (globalThis as Record<string, unknown>).ResizeObserver;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function cellCenter(cols: number, rows: number, cx: number, cy: number): { x: number; y: number } {
  const cellW = 256 / cols;
  const cellH = 256 / rows;
  return { x: (cx + 0.5) * cellW, y: (cy + 0.5) * cellH };
}

function createWreckTestRun(): V2RunState {
  const tut = createV2TutorialRun('run_s08_wreck');
  return {
    ...tut,
    phase: 'ENCOUNTER',
    currentNodeId: 'L2A',
    visitedNodeIds: ['L1A', 'L2A'],
  };
}

function createSettlementTestRun(opts?: {
  readonly withLootEquipment?: boolean;
  readonly withExtraCargo?: boolean;
  readonly withRelic?: boolean;
  readonly withMission?: boolean;
}): V2RunState {
  const tut = createV2TutorialRun('run_s09_settle');
  const placed: V2PlacedItem[] = [
    {
      item: createV2EquipmentInstance({
        instanceId: 'loan_laser_1',
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
  ];
  if (opts?.withLootEquipment) {
    placed.push({
      item: createV2EquipmentInstance({
        instanceId: 'loot_eq_1',
        kind: 'shield',
        quality: 'improved',
        origin: 'loot',
        acquiredDepth: 2,
        location: 'bay',
      }),
      x: 2,
      y: 0,
      rotation: 0,
    });
  }
  if (opts?.withExtraCargo) {
    placed.push({
      item: createV2CargoInstance({
        instanceId: 'loot_cargo_1',
        defId: 'cargo.alloy_bar',
        origin: 'loot',
        acquiredDepth: 2,
        location: 'bay',
      }),
      x: 0,
      y: 2,
      rotation: 0,
    });
  }
  if (opts?.withRelic) {
    placed.push({
      item: createV2CargoInstance({
        instanceId: 'loot_relic_1',
        defId: 'cargo.ancient_navigator',
        origin: 'loot',
        acquiredDepth: 4,
        location: 'bay',
      }),
      x: 1,
      y: 2,
      rotation: 0,
    });
  }
  if (opts?.withMission) {
    placed.push({
      item: createV2CargoInstance({
        instanceId: 'mission_reactor_1',
        defId: 'mission.sealed_reactor',
        origin: 'mission',
        acquiredDepth: 3,
        location: 'bay',
      }),
      x: 2,
      y: 1,
      rotation: 0,
    });
  }
  return {
    ...tut,
    phase: 'SETTLEMENT',
    settlementReason: 'safe_return',
    wallet: 25,
    bay: {
      shipId: 'cannon_skiff',
      placed,
      staging: [],
      discardedThisArrange: [],
    },
  };
}

// ---------------------------------------------------------------------------
// M1B Verification Suite (S03, S06, S07, S08, A07-code, S09, A10-callers, T01)
// ---------------------------------------------------------------------------
describe('M1B Stage, Feel, Feedback & Telemetry Suite (S03, S06, S07, S08, S09, T01)', () => {
  let dom: { readonly window: MiniWindow; readonly document: MiniDocument };
  const activeControllers: V2AppController[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    clearTacticalDeltaCache();
    phaserTestHarness.lastGame = null;
    phaserTestHarness.autoReady = true;
    phaserTestHarness.autoLoadDynamicTextures = true;
    dom = installMiniDom('');
    dom.window.sessionStorage.setItem('starline_v2_title_entered', '1');
  });

  afterEach(() => {
    while (activeControllers.length > 0) {
      activeControllers.pop()!.destroy();
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
    teardownMiniDom();
  });

  function mountController(saveData?: V2SaveData): {
    readonly mountEl: MiniElement;
    readonly controller: V2AppController;
  } {
    if (saveData) {
      persistV2SaveData(dom.window.localStorage as unknown as Storage, saveData);
    }
    const mountEl = dom.document.createElement('div');
    dom.document.body.appendChild(mountEl);
    const controller = new V2AppController(mountEl as unknown as HTMLElement, {
      onSwitchToV1: () => {},
    });
    activeControllers.push(controller);
    controller.init();
    return { mountEl, controller };
  }

  // =========================================================================
  // S03 — Persistent Stage Layout (ShipStage + HoldView + ContextDock)
  // =========================================================================
  describe('S03: Persistent Stage Layout & Slim HUD', () => {
    it('keeps 1 persistent CargoGridV2 mounted across ARRANGE -> MAP -> ENCOUNTER(pre) -> ENCOUNTER(live) -> REWARD -> SETTLEMENT with expanded ARRANGE default and slim HUD', async () => {
      const destroySpy = vi.spyOn(CargoGridV2Component.prototype, 'destroy');
      const run = createV2TutorialRun('run_s03_stage');
      const save: V2SaveData = { ...createFreshV2SaveData(), activeRun: run };
      const { mountEl } = mountController(save);
      await flushMicrotasks();

      const shell = mountEl.querySelector('.v2-shell')!;
      const shipStage = mountEl.querySelector('[data-testid="ship-stage"]')!;
      const contextDock = mountEl.querySelector('[data-testid="context-dock"]')!;
      const holdView = mountEl.querySelector('[data-testid="hold-view"]')!;
      const topHud = mountEl.querySelector('.v2-top-hud')!;
      const initialBoard = mountEl.querySelector('.v2-cargo-board')!;

      expect(shipStage).not.toBeNull();
      expect(contextDock).not.toBeNull();
      expect(holdView).not.toBeNull();
      expect(shell.classList.contains('phase-voyage')).toBe(true);
      expect(shell.classList.contains('phase-arrange')).toBe(true);
      expect(topHud.classList.contains('is-voyage-slim')).toBe(true);
      // ARRANGE defaults to EXPANDED ShipStage (not collapsed!) and duplicate Top HUD toggle is removed
      expect(shipStage.classList.contains('scene-collapsed')).toBe(false);
      expect(mountEl.querySelector('#v2-btn-toggle-scene')).toBeNull();
      expect(mountEl.querySelector('#v2-arrange-toggle-ship')).not.toBeNull();

      // Place staged battery at (1,0) and leave ARRANGE -> MAP
      const boardPt = cellCenter(4, 4, 1, 0);
      initialBoard.dispatchEvent(new MiniEvent('pointerdown', { bubbles: true, clientX: boardPt.x, clientY: boardPt.y }));
      initialBoard.dispatchEvent(new MiniEvent('pointerup', { bubbles: true, clientX: boardPt.x, clientY: boardPt.y }));
      mountEl.querySelector('[data-testid="btn-leave-arrange"]')!.click();

      expect(shell.classList.contains('phase-voyage')).toBe(true);
      expect(shell.classList.contains('phase-map')).toBe(true);
      expect(mountEl.querySelector('.v2-cargo-board')).toBe(initialBoard);

      // Jump to L1A (ENCOUNTER pre-combat)
      mountEl.querySelector('[data-testid="btn-jump-node"]')!.click();
      expect(shell.classList.contains('phase-encounter')).toBe(true);
      expect(shell.classList.contains('phase-combat')).toBe(true);
      expect(shell.classList.contains('phase-combat-live')).toBe(false);
      expect(mountEl.querySelector('.v2-cargo-board')).toBe(initialBoard);

      // Start live combat: HoldView stays persistently mounted in DOM (0 teardown mid-voyage!)
      mountEl.querySelector('[data-testid="btn-start-combat"]')!.click();
      expect(shell.classList.contains('phase-combat-live')).toBe(true);
      expect(mountEl.querySelector('.v2-cargo-board')).toBe(initialBoard);
      expect(destroySpy).toHaveBeenCalledTimes(0);

      // Skip to tactical pause -> issue overload order -> skip remaining -> REWARD -> repair -> MAP -> safe return -> SETTLEMENT
      mountEl.querySelector('[data-testid="btn-combat-skip"]')!.click();
      mountEl.querySelector('[data-testid="tactical-order-overload"]')!.click();
      mountEl.querySelector('[data-testid="btn-combat-skip"]')!.click();
      expect(shell.classList.contains('phase-reward')).toBe(true);
      expect(mountEl.querySelector('.v2-cargo-board')).toBe(initialBoard);

      mountEl.querySelector('[data-pick-reward="repair"]')!.click();
      expect(shell.classList.contains('phase-map')).toBe(true);
      expect(mountEl.querySelector('.v2-cargo-board')).toBe(initialBoard);

      mountEl.querySelector('[data-testid="btn-safe-return"]')!.click();
      expect(shell.classList.contains('phase-settlement')).toBe(true);
      expect(mountEl.querySelector('.v2-cargo-board')).toBe(initialBoard);
      expect(destroySpy).toHaveBeenCalledTimes(0);
    });

    it('toggles mobile HoldView zoom cleanly, resets on phase transition, and enforces V2-only stage CSS rules', async () => {
      dom.window.innerWidth = 390;
      dom.window.innerHeight = 844;
      const run = createV2TutorialRun('run_s03_mobile');
      const mapRun: V2RunState = {
        ...run,
        phase: 'MAP',
        bay: { ...run.bay, staging: [] },
      };
      const { mountEl } = mountController({ ...createFreshV2SaveData(), activeRun: mapRun });
      await flushMicrotasks();

      const shell = mountEl.querySelector('.v2-shell')!;
      const toggleBtn = mountEl.querySelector('[data-testid="btn-toggle-mobile-hold"]')!;
      expect(toggleBtn).not.toBeNull();
      expect(shell.classList.contains('is-hold-zoomed')).toBe(false);
      expect(toggleBtn.getAttribute('aria-pressed')).toBe('false');

      toggleBtn.click();
      expect(shell.classList.contains('is-hold-zoomed')).toBe(true);
      expect(mountEl.querySelector('[data-testid="btn-toggle-mobile-hold"]')!.getAttribute('aria-pressed')).toBe('true');

      // Transition MAP -> ENCOUNTER resets mobileHoldZoomed cleanly
      mountEl.querySelector('[data-testid="btn-jump-node"]')!.click();
      expect(shell.classList.contains('phase-encounter')).toBe(true);
      expect(shell.classList.contains('is-hold-zoomed')).toBe(false);

      // Verify stage region anchors and desktop/mobile-landscape resize remain mounted cleanly
      dom.window.innerWidth = 844;
      dom.window.innerHeight = 390;
      dom.window.dispatchEvent(new MiniEvent('resize'));
      expect(shell.classList.contains('phase-voyage')).toBe(true);
      expect(mountEl.querySelector('[data-testid="ship-stage"]')!.getAttribute('data-stage-region')).toBe('ship-stage');
      expect(mountEl.querySelector('[data-testid="context-dock"]')!.getAttribute('data-stage-region')).toBe('context-dock');
      expect(mountEl.querySelector('[data-testid="hold-view"]')!.getAttribute('data-stage-region')).toBe('hold-view');
    });
  });

  // =========================================================================
  // S06 — Qualitative Threat Tiers, On-Demand Details Drawer & 1-Row Stats
  // =========================================================================
  describe('S06: Qualitative Threat Tiers, On-Demand Details Drawer & 1-Row Compact Stats', () => {
    it('classifies all 4 qualitative threat tiers with distinct colorblind-safe symbols and strips exact HP/rounds/per-cell from Layer-1 deltas', () => {
      const tiers = [
        classifyV2CombatThreat({ outcome: 'victory', playerFinalHp: 25 }, 30),
        classifyV2CombatThreat({ outcome: 'victory', playerFinalHp: 14 }, 30),
        classifyV2CombatThreat({ outcome: 'victory', playerFinalHp: 6 }, 30),
        classifyV2CombatThreat({ outcome: 'defeat', playerFinalHp: 0 }, 30),
      ];
      expect(tiers.map((t) => t.tier)).toEqual(['steady', 'strained', 'danger', 'lethal']);
      const metas = tiers.map((t) => getV2ThreatTierMeta(t.tier));
      expect(new Set(metas.map((m) => m.symbol)).size).toBe(4);
      expect(metas.map((m) => m.label)).toEqual(['稳', '吃力', '危险', '致命']);

      expect(
        classifyV2CombatDeltaTrend({
          beforeOutcome: 'victory',
          afterOutcome: 'victory',
          beforeHp: 12,
          afterHp: 22,
          beforeRounds: 4,
          afterRounds: 2,
          maxHp: 30,
        })
      ).toBe('up');
      expect(
        classifyV2CombatDeltaTrend({
          beforeOutcome: 'victory',
          afterOutcome: 'defeat',
          beforeHp: 10,
          afterHp: 0,
          beforeRounds: 3,
          afterRounds: 4,
          maxHp: 30,
        })
      ).toBe('down');

      const run = createV2TutorialRun('run_s06_domain');
      const stagedBattery = run.bay.staging[0].item;
      const eqDelta = computeV2PlacementTacticalDelta({
        run,
        bay: run.bay,
        startingHp: run.hp,
        maxHp: run.maxHp,
        targetPolicy: run.targetPolicy,
        item: stagedBattery,
        zone: 'staging',
      });
      expect(eqDelta.qualitativeDeltaLine).toBeDefined();
      expect(eqDelta.qualitativeDeltaLine!).not.toMatch(/余\s*\d+\s*(HP|耐久)/);
      expect(eqDelta.qualitativeDeltaLine!).not.toMatch(/\d+\s*[轮回合]/);
      expect(eqDelta.detailSummary).toContain('不干预时结果');
      expect(eqDelta.trendDirection).toBe('up');

      const cargoItem = createV2CargoInstance({
        instanceId: 'cargo_s06',
        defId: 'cargo.alloy_bar',
        origin: 'loot',
        acquiredDepth: 1,
        location: 'bay',
      });
      const cargoDelta = computeV2PlacementTacticalDelta({
        run,
        bay: run.bay,
        startingHp: run.hp,
        maxHp: run.maxHp,
        targetPolicy: run.targetPolicy,
        item: cargoItem,
        zone: 'grid',
      });
      expect(cargoDelta.synergyLine).not.toContain('¤/格');
      expect(cargoDelta.detailSummary).toContain('¤/格');
      expect(cargoDelta.detailSummary).toContain('不干预时结果');
    });

    it('renders qualitative Layer-1 forecasts, Details Drawer labeled 不干预时结果, 1-row compact CargoGrid stats, and qualitative live tactical bar', async () => {
      const tut = createV2TutorialRun('run_s06_ui');
      const mapRun: V2RunState = {
        ...tut,
        phase: 'MAP',
        bay: { ...tut.bay, staging: [] },
      };
      const { mountEl } = mountController({ ...createFreshV2SaveData(), activeRun: mapRun });
      await flushMicrotasks();

      // 1-row compact telemetry bar (0 .stat-chip elements!)
      expect(mountEl.querySelectorAll('.stat-chip').length).toBe(0);
      const compactStats = mountEl.querySelector('[data-testid="cargo-compact-stats"]')!;
      expect(compactStats).not.toBeNull();
      expect(compactStats.querySelectorAll('.v3-stat-cell').length).toBe(4);

      // Map card Layer 1: qualitative Threat Tier, ZERO raw 余xxHP / (n轮), preserves data-preview-final-hp
      const mapCard = mountEl.querySelector('[data-testid="map-node-L1A"]')!;
      expect(mapCard.getAttribute('data-preview-final-hp')).toBe('24');
      expect(mapCard.getAttribute('data-threat-tier')).toBe('steady');
      expect(mapCard.textContent).toContain('● 稳');
      expect(mapCard.textContent).not.toMatch(/余\s*\d+\s*HP/);
      expect(mapCard.textContent).not.toMatch(/\(\d+轮\)/);
      expect(mountEl.querySelector('[data-testid="forecast-details-drawer"]')).toBeNull();

      // Expanding Map Details Drawer reveals 不干预时结果 + exact 24HP
      mountEl.querySelector('[data-testid="btn-toggle-forecast-details"]')!.click();
      const mapDrawer = mountEl.querySelector('[data-testid="forecast-details-drawer"]')!;
      expect(mapDrawer).not.toBeNull();
      expect(mapDrawer.textContent).toContain('不干预时结果');
      expect(mapDrawer.textContent).toContain('24HP');

      // Jump to L1A pre-combat: Details Drawer resets to collapsed, Layer 1 shows qualitative tier & preserves data-preview-final-hp
      mountEl.querySelector('[data-testid="btn-jump-node"]')!.click();
      const preScreen = mountEl.querySelector('[data-testid="combat-screen"]')!;
      expect(mountEl.querySelector('[data-testid="forecast-details-drawer"]')).toBeNull();
      expect(preScreen.querySelector('[data-testid="combat-threat-tier"]')!.textContent).toContain('● 稳');
      expect(preScreen.querySelector('[data-preview-final-hp]')!.getAttribute('data-preview-final-hp')).toBe('24');
      expect(preScreen.textContent).not.toMatch(/余\s*\d+\s*HP/);
      expect(preScreen.textContent).not.toMatch(/战后\s*\d+/);

      // Opening pre-combat Details Drawer pauses S05 auto-engage and reveals exact simulation labeled 不干预时结果
      const preDetailsBtn = mountEl.querySelector('[data-testid="btn-toggle-forecast-details"]')!;
      preDetailsBtn.click();
      const preDrawer = mountEl.querySelector('[data-testid="forecast-details-drawer"]')!;
      expect(preDrawer.textContent).toContain('不干预时结果');
      expect(preDrawer.textContent).toContain('24HP');
      expect(mountEl.querySelector('[data-testid="btn-start-combat"]')!.getAttribute('data-auto-engage-status')).toBe('paused');

      // Read-only item details drawer on CargoGridV2 works when selecting an item on MAP/ENCOUNTER
      const board = mountEl.querySelector('.v2-cargo-board')!;
      const laserPt = cellCenter(4, 4, 0, 0);
      board.dispatchEvent(new MiniEvent('pointerdown', { bubbles: true, clientX: laserPt.x, clientY: laserPt.y }));
      vi.advanceTimersByTime(50);
      expect(mountEl.querySelector('[data-testid="item-details-drawer"]')).toBeNull();
      mountEl.querySelector('[data-testid="btn-toggle-item-details"]')!.click();
      expect(mountEl.querySelector('[data-testid="item-details-drawer"]')!.textContent).toContain('不干预时结果');

      // Live combat tactical bar renders qualitative Threat Tiers & preserves data-preview-final-hp (ZERO 余 xx HP / n轮!)
      mountEl.querySelector('[data-testid="btn-start-combat"]')!.click();
      mountEl.querySelector('[data-testid="btn-combat-skip"]')!.click();
      const tacticBar = mountEl.querySelector('[data-testid="combat-tactical-bar"]')!;
      expect(tacticBar).not.toBeNull();
      const tacticButtons = tacticBar.querySelectorAll('[data-elite-tactic]');
      expect(tacticButtons.length).toBeGreaterThanOrEqual(2);
      for (const tb of tacticButtons) {
        expect(tb.getAttribute('data-preview-final-hp')).not.toBeNull();
        expect(tb.getAttribute('data-threat-tier')).not.toBeNull();
        expect(tb.textContent).not.toMatch(/余\s*\d+\s*HP/);
        expect(tb.textContent).not.toMatch(/\(\d+轮\)/);
      }
    });
  });

  // =========================================================================
  // S07 — Tactile Drag-Drop, Opt-In recommendedSpot, Un-Linked Fallback & SFX
  // =========================================================================
  describe('S07: Tactile Drag-Drop, Live Hover Links, Opt-In recommendedSpot & Un-Linked Fallback', () => {
    it('places default fallback laser & battery non-adjacently (0 initial links) across all 4 ship hulls with legal budget & bounds', () => {
      const baseProfile = createFreshV2SaveData().profile;
      const unlockedProfile = {
        ...baseProfile,
        unlockedShips: [...V2_SHIP_ORDER],
      };

      for (const shipId of V2_SHIP_ORDER) {
        const slots = buildFreeFallbackPrepareSlots(shipId, unlockedProfile.blueprints);
        const validation = validateV2PrepareLoadout(unlockedProfile, shipId, null, slots);
        expect(validation.valid).toBe(true);
        expect(validation.errors).toEqual([]);

        const placed: V2PlacedItem[] = slots.map((s) => {
          const kind = s.definitionId.split('.')[1] as 'laser' | 'battery' | 'shield';
          return {
            item: createV2EquipmentInstance({
              instanceId: s.slotKey,
              kind,
              quality: 'common',
              origin: 'loan',
              acquiredDepth: 0,
              location: 'bay',
            }),
            x: s.x,
            y: s.y,
            rotation: s.rotation,
          };
        });
        const bay: V2CargoBayState = {
          shipId,
          placed,
          staging: [],
          discardedThisArrange: [],
        };
        const stats = calculateV2BuildStats(bay);
        // Zero pre-linked laser+battery synergies on initial fallback across ALL 4 hulls!
        expect(stats.links.length).toBe(0);

        // Verify laser & battery both exist and at least 1 empty adjacent cell exists next to laser for 1-drag discovery
        const laserSlot = slots.find((s) => s.definitionId.startsWith('equipment.laser.'))!;
        const batterySlot = slots.find((s) => s.definitionId.startsWith('equipment.battery.'))!;
        expect(laserSlot).toBeDefined();
        expect(batterySlot).toBeDefined();
      }
    });

    it('implements pixel grab offset, touch lift >= 56px, L3 occupied-cell-mask ghost, live hover synergy preview with 0 combat sims, invalid spring-back, opt-in recommendedSpot, and distinct A10 SFX', () => {
      const sfxCalls: SfxKind[] = [];
      vi.spyOn(soundEngine, 'play').mockImplementation((k: SfxKind) => {
        sfxCalls.push(k);
      });
      const simSpy = vi.spyOn(combatV2, 'simulateV2Combat');

      const laserItem = createV2EquipmentInstance({
        instanceId: 'eq_laser',
        kind: 'laser',
        quality: 'common',
        origin: 'loan',
        acquiredDepth: 0,
        location: 'bay',
      });
      const batteryItem = createV2EquipmentInstance({
        instanceId: 'eq_batt',
        kind: 'battery',
        quality: 'common',
        origin: 'loan',
        acquiredDepth: 0,
        location: 'bay',
      });
      const repairL3 = createV2EquipmentInstance({
        instanceId: 'eq_repair_l3',
        kind: 'repair',
        quality: 'common',
        origin: 'loot',
        acquiredDepth: 1,
        location: 'staging',
      });
      const heavyItem = createV2EquipmentInstance({
        instanceId: 'eq_heavy',
        kind: 'heavy',
        quality: 'common',
        origin: 'loot',
        acquiredDepth: 1,
        location: 'staging',
      });

      let bay: V2CargoBayState = {
        shipId: 'cannon_skiff',
        placed: [
          { item: laserItem, x: 0, y: 0, rotation: 0 },
          { item: batteryItem, x: 3, y: 3, rotation: 0 },
        ],
        staging: [
          { item: repairL3, rotation: 0 },
          { item: heavyItem, rotation: 0 },
        ],
        discardedThisArrange: [],
      };

      const mount = dom.document.createElement('div');
      dom.document.body.appendChild(mount);
      const run = createV2TutorialRun('run_s07_grid');
      const grid = new CargoGridV2Component(mount as unknown as HTMLElement, {
        onBayChange: (nextBay) => {
          bay = nextBay;
          grid.render(bay, true);
        },
        getTacticalDelta: (item, zone) =>
          computeV2PlacementTacticalDelta({
            run,
            bay,
            startingHp: 30,
            maxHp: 30,
            targetPolicy: 'weakest',
            item,
            zone,
          }),
      });
      grid.render(bay, true);
      vi.advanceTimersByTime(50);

      // 1. Opt-in recommendedSpot is OFF by default!
      expect(mount.querySelectorAll('.cell-recommended').length).toBe(0);
      expect(mount.querySelector('[data-testid="btn-install-recommended"]')).toBeNull();

      // 2. Click battery at (3,3) -> still OFF until player clicks [data-testid="btn-toggle-recommend-hint"]
      const board = mount.querySelector('.v2-cargo-board')!;
      const battPt = cellCenter(4, 4, 3, 3);
      board.dispatchEvent(new MiniEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: battPt.x, clientY: battPt.y }));
      dom.window.dispatchEvent(new MiniEvent('pointerup', { bubbles: true, pointerId: 1, clientX: battPt.x, clientY: battPt.y }));
      vi.advanceTimersByTime(50);
      expect(mount.querySelectorAll('.cell-recommended').length).toBe(0);
      expect(mount.querySelector('[data-testid="btn-install-recommended"]')).toBeNull();

      // Toggle opt-in recommend hint ON -> lights .cell-recommended & shows install-recommended CTA
      mount.querySelector('[data-testid="btn-toggle-recommend-hint"]')!.click();
      expect(mount.querySelectorAll('.cell-recommended').length).toBeGreaterThan(0);
      expect(mount.querySelector('[data-testid="btn-install-recommended"]')).not.toBeNull();
      // Toggle back OFF -> clears .cell-recommended cleanly
      mount.querySelector('[data-testid="btn-toggle-recommend-hint"]')!.click();
      expect(mount.querySelectorAll('.cell-recommended').length).toBe(0);

      // 3. Pointer drag battery from (3,3) over (1,0) adjacent to laser:
      //    Verifies pickup SFX, hoverValid SFX, live hover .energy-link-line.is-preview, partner glow, and 0 simulateV2Combat calls!
      sfxCalls.length = 0;
      simSpy.mockClear();
      const grabX = 3 * 64 + 44; // off-center pixel grab inside cell (3,3)
      const grabY = 3 * 64 + 40;
      board.dispatchEvent(
        new MiniEvent('pointerdown', { bubbles: true, pointerId: 2, pointerType: 'mouse', clientX: grabX, clientY: grabY })
      );
      const targetX = 1 * 64 + 44; // keeps exact pixel offset inside cell (1,0)
      const targetY = 0 * 64 + 40;
      dom.window.dispatchEvent(
        new MiniEvent('pointermove', { bubbles: true, pointerId: 2, pointerType: 'mouse', clientX: targetX, clientY: targetY })
      );

      const ghost = dom.document.querySelector('.v2-drag-ghost')!;
      expect(ghost).not.toBeNull();
      expect(ghost.style.left).toBe('64px'); // grab offset preserved!
      expect(ghost.style.top).toBe('0px');
      expect(sfxCalls).toContain('pickup');
      expect(sfxCalls).toContain('hoverValid');
      expect(simSpy).toHaveBeenCalledTimes(0);

      const previewLine = mount.querySelector('.energy-link-line.is-preview')!;
      expect(previewLine).not.toBeNull();
      expect(previewLine.getAttribute('data-link-preview')).toBe('true');
      const laserTile = mount.querySelector('[data-instance-id="eq_laser"]')!;
      expect(laserTile.classList.contains('synergy-preview-partner')).toBe(true);

      // Drop on (1,0) -> places battery + fires place + energyLink!
      dom.window.dispatchEvent(
        new MiniEvent('pointerup', { bubbles: true, pointerId: 2, pointerType: 'mouse', clientX: targetX, clientY: targetY })
      );
      expect(sfxCalls).toContain('place');
      expect(sfxCalls).toContain('energyLink');

      // 4. Touch drag L3 repair drone from staging: verifies 3 occupied subcells (L3 cutout!), >=56px touch lift, & invalid drop spring-back onto occupied (0,0)
      const l3Chip = mount.querySelector('[data-staging-id="eq_repair_l3"]')!;
      l3Chip.dispatchEvent(
        new MiniEvent('pointerdown', { bubbles: true, pointerId: 3, pointerType: 'touch', clientX: 20, clientY: 320 })
      );
      const touchClientX = 32;
      const touchClientY = 96; // lifted by >=56px lands on row 0 (occupied by laser!)
      dom.window.dispatchEvent(
        new MiniEvent('pointermove', { bubbles: true, pointerId: 3, pointerType: 'touch', clientX: touchClientX, clientY: touchClientY })
      );
      const l3Ghost = dom.document.querySelector('.v2-drag-ghost')!;
      expect(l3Ghost).not.toBeNull();
      expect(l3Ghost.classList.contains('is-touch-lifted')).toBe(true);
      expect(l3Ghost.querySelectorAll('.drag-ghost-subcell').length).toBe(3); // L3 exact 3 occupied cells!
      // Verify touch lift raised ghost strictly above finger grab (top < touchClientY - 56 - halfHeight + tolerance)
      expect(parseFloat(l3Ghost.style.top)).toBeLessThan(touchClientY - 56);

      // Invalid drop onto occupied (0,0) launches .is-spring-back & fires 'invalid' SFX, then cleans up cleanly
      sfxCalls.length = 0;
      dom.window.dispatchEvent(
        new MiniEvent('pointerup', { bubbles: true, pointerId: 3, pointerType: 'touch', clientX: touchClientX, clientY: touchClientY })
      );
      expect(sfxCalls).toContain('invalid');
      const springing = dom.document.querySelector('.v2-drag-ghost.is-spring-back');
      expect(springing).not.toBeNull();
      vi.advanceTimersByTime(260);
      expect(dom.document.querySelector('.v2-drag-ghost')).toBeNull();

      // 5. Heavy weapon placement fires 'placeHeavy' SFX & discard fires 'clampPop' SFX!
      sfxCalls.length = 0;
      mount.querySelector('[data-staging-id="eq_heavy"]')!.click();
      const freeHeavyPt = cellCenter(4, 4, 2, 1);
      board.dispatchEvent(new MiniEvent('pointerdown', { bubbles: true, clientX: freeHeavyPt.x, clientY: freeHeavyPt.y }));
      board.dispatchEvent(new MiniEvent('pointerup', { bubbles: true, clientX: freeHeavyPt.x, clientY: freeHeavyPt.y }));
      expect(sfxCalls).toContain('placeHeavy');

      sfxCalls.length = 0;
      mount.querySelector('#btn-v2-discard')!.click();
      expect(sfxCalls).toContain('clampPop');

      grid.destroy();
    });
  });

  // =========================================================================
  // S08 + A07-code — Direct Wreck Clamp Cut, 600ms Skippable FX & FLIP Flight
  // =========================================================================
  describe('S08 & A07-code: Direct Wreck Clamp Cut, Cutaway/Silhouette & FLIP-to-Staging', () => {
    it('evaluates computeWreckCutTimeline boundaries deterministically across normal and reducedMotion', () => {
      const t0 = computeWreckCutTimeline(0, VFX_WRECK_CUT_DURATION_MS, false);
      expect(t0.progress).toBe(0);
      expect(t0.clampPopped).toBe(false);
      expect(t0.complete).toBe(false);

      const tClamp = computeWreckCutTimeline(
        VFX_WRECK_CUT_DURATION_MS * VFX_WRECK_CLAMP_POP_RATIO,
        VFX_WRECK_CUT_DURATION_MS,
        false
      );
      expect(tClamp.clampPopped).toBe(true);
      expect(tClamp.seamProgress).toBe(1);
      expect(tClamp.complete).toBe(false);

      const tEnd = computeWreckCutTimeline(VFX_WRECK_CUT_DURATION_MS, VFX_WRECK_CUT_DURATION_MS, false);
      expect(tEnd.complete).toBe(true);

      const tRed = computeWreckCutTimeline(0, VFX_WRECK_CUT_DURATION_MS, true);
      expect(tRed.complete).toBe(true);
      expect(tRed.clampPopped).toBe(true);
    });

    it('runs direct clamp click -> 600ms cut -> clampPop -> FLIP ghost -> staging commit, blocks double-clicks, supports Space/click skip, and commits instantaneously in reducedMotion', async () => {
      const sfxCalls: SfxKind[] = [];
      vi.spyOn(soundEngine, 'play').mockImplementation((k: SfxKind) => {
        sfxCalls.push(k);
      });
      const showStageSpy = vi.spyOn(PhaserHost.prototype, 'showV2Stage');

      const { mountEl } = mountController({
        ...createFreshV2SaveData(),
        activeRun: createWreckTestRun(),
      });
      await flushMicrotasks();

      expect(showStageSpy).toHaveBeenCalledTimes(1);
      showStageSpy.mockClear();

      // A07-code: closed compartment pin with masked item silhouette (non-salvager)
      const armoryPin = mountEl.querySelector('[data-testid="wreck-spot-armory"]')!;
      expect(armoryPin.getAttribute('data-compartment-state')).toBe('closed');
      expect(armoryPin.querySelector('.v3-wreck-silhouette-img.is-masked')).not.toBeNull();
      expect(armoryPin.querySelectorAll('.v3-clamp-bracket').length).toBe(2);

      // Direct click on clamp pin starts 600ms cut sequence!
      sfxCalls.length = 0;
      armoryPin.click();
      expect(sfxCalls).toContain('wreckCut');
      expect(showStageSpy).toHaveBeenCalledTimes(0);

      // Mid-cut: state is 'cutting', extract & other cut buttons disabled (double-click proof!)
      expect(mountEl.querySelector('[data-testid="wreck-spot-armory"]')!.getAttribute('data-compartment-state')).toBe('cutting');
      expect(mountEl.querySelector('[data-testid="wreck-cut-cargo"]')!.disabled).toBe(true);
      expect(mountEl.querySelector('[data-testid="btn-wreck-extract"]')!.disabled).toBe(true);
      expect(mountEl.querySelector('[data-testid="btn-skip-wreck-cut"]')).not.toBeNull();

      // Advance to 432ms -> clampPop beat fires!
      vi.advanceTimersByTime(440);
      expect(sfxCalls).toContain('clampPop');

      // Advance past 600ms -> FLIP ghost spawns!
      vi.advanceTimersByTime(170);
      expect(dom.document.querySelectorAll('[data-testid="wreck-flip-ghost"]').length).toBeGreaterThan(0);

      // Advance past 260ms FLIP -> item committed to staging, cutaway rendered, silhouette revealed, 0 ghosts left, 0 showV2Stage resets!
      vi.advanceTimersByTime(270);
      expect(dom.document.querySelectorAll('[data-testid="wreck-flip-ghost"]').length).toBe(0);
      expect(showStageSpy).toHaveBeenCalledTimes(0);
      const cutArmoryPin = mountEl.querySelector('[data-testid="wreck-spot-armory"]')!;
      expect(cutArmoryPin.getAttribute('data-compartment-state')).toBe('cutaway');
      expect(cutArmoryPin.querySelector('.v3-wreck-silhouette-img.is-revealed')).not.toBeNull();

      const liveScene = phaserTestHarness.lastGame?.getScene<V2CombatScene>('V2CombatScene');
      expect(liveScene).toBeDefined();
      expect(liveScene!.getStagePresentationSnapshot().wreckCompartmentsCut).toBe(1);

      // Second cut skipped via Space key -> commits immediately with 0 ghosts & 0 showV2Stage resets!
      sfxCalls.length = 0;
      mountEl.querySelector('[data-testid="wreck-spot-reactor"]')!.click();
      expect(mountEl.querySelector('[data-testid="wreck-spot-reactor"]')!.getAttribute('data-compartment-state')).toBe('cutting');
      dom.window.dispatchEvent(new MiniEvent('keydown', { key: ' ' }));
      expect(sfxCalls).toContain('clampPop');
      expect(mountEl.querySelector('[data-testid="wreck-spot-reactor"]')!.getAttribute('data-compartment-state')).toBe('cutaway');
      expect(dom.document.querySelectorAll('[data-testid="wreck-flip-ghost"]').length).toBe(0);
      expect(showStageSpy).toHaveBeenCalledTimes(0);

      // Reduced-motion mode: direct clamp click commits instantaneously at 0ms with 0 FLIP ghosts!
      const redSave = createFreshV2SaveData();
      const { mountEl: redMount } = mountController({
        ...redSave,
        settings: { ...redSave.settings, reducedMotion: true },
        activeRun: createWreckTestRun(),
      });
      await flushMicrotasks();
      sfxCalls.length = 0;
      redMount.querySelector('[data-testid="wreck-spot-armory"]')!.click();
      expect(sfxCalls).toContain('wreckCut');
      expect(sfxCalls).toContain('clampPop');
      expect(redMount.querySelector('[data-testid="wreck-spot-armory"]')!.getAttribute('data-compartment-state')).toBe('cutaway');
      expect(dom.document.querySelectorAll('[data-testid="wreck-flip-ghost"]').length).toBe(0);
    });
  });

  // =========================================================================
  // S09 + A10-callers — Real Item Artwork on Crane, Auto-Disposition & Rollup
  // =========================================================================
  describe('S09 & A10-callers: Crane Item Artwork, Auto-Disposition Settlement & creditTick Rollup', () => {
    it('loads and renders real brought-back item artwork under BaseScene 4-joint crane, falls back cleanly when texture missing, and cleans up on skip', async () => {
      const baseScene = new BaseScene();
      const game = new MockPhaserGame({ scene: [baseScene as unknown as InstanceType<typeof MockPhaserScene>] });
      game.scene.start('BaseScene', {
        v2State: {
          credits: 120,
          selectedShipId: 'cannon_skiff',
          campaignAct: 'act1',
          stargatePowered: false,
          facilityTiers: {
            workbench: 1,
            display: 1,
            drydock: 0,
            research_lab: 0,
            warehouse: 0,
            stargate_relay: 0,
          },
          restoredRelicIds: [],
          restoredRelicsCount: 0,
          totalRelicsCount: 3,
          settings: createFreshV2SaveData().settings,
        },
      });

      const items = [
        {
          instanceId: 'i1',
          definitionId: 'mission.sealed_reactor',
          name: '密封反应堆',
          artUrl: getItemImageUrl('mission.sealed_reactor'),
          isRelic: false,
          isMission: true,
        },
        {
          instanceId: 'i2',
          definitionId: 'cargo.ancient_navigator',
          name: '古代导航仪',
          artUrl: getItemImageUrl('cargo.ancient_navigator'),
          isRelic: true,
          isMission: false,
          toDisplay: true,
        },
      ];
      baseScene.startReturnDocking({
        earnedCredits: 85,
        crateCount: 2,
        hasKeptRelic: true,
        wasDefeat: false,
        items,
      });

      // Advance into active unload window (p ~ 0.65 => 910ms / 1400ms)
      baseScene.update(0, 450);
      baseScene.update(450, 460);
      const midSnap = baseScene.getDockingVisualSnapshot();
      expect(midSnap.active).toBe(true);
      expect(midSnap.renderedItemKeys).toContain(getDockingItemTextureKey('mission.sealed_reactor'));
      expect(midSnap.fallbackCrateCount).toBe(0);

      // Skip docking clears sprites & visual snapshot cleanly
      baseScene.skipReturnDocking();
      const afterSkip = baseScene.getDockingVisualSnapshot();
      expect(afterSkip.active).toBe(false);
      expect(afterSkip.renderedItemKeys).toEqual([]);

      // Fallback path when dynamic texture fails/absent: renders procedural crate cleanly without throwing!
      phaserTestHarness.autoLoadDynamicTextures = false;
      baseScene.startReturnDocking({
        earnedCredits: 20,
        crateCount: 1,
        hasKeptRelic: false,
        wasDefeat: false,
        items: [
          {
            instanceId: 'missing_1',
            definitionId: 'cargo.unloaded_art_test',
            name: '未知货箱',
            artUrl: '/missing.webp',
            isRelic: false,
            isMission: false,
          },
        ],
      });
      baseScene.update(1000, 450);
      baseScene.update(1450, 460);
      const fallbackSnap = baseScene.getDockingVisualSnapshot();
      expect(fallbackSnap.active).toBe(true);
      expect(fallbackSnap.fallbackCrateCount).toBeGreaterThan(0);

      game.destroy();
    });

    it('enforces settlement button count <= decisionItems + 1 across 0-decision, 2-option, and 3-option inventories, preserves overflow guard, runs skippable creditTick -> cashRegister rollup, and passes real items to docking', async () => {
      const sfxCalls: SfxKind[] = [];
      vi.spyOn(soundEngine, 'play').mockImplementation((k: SfxKind) => {
        sfxCalls.push(k);
      });

      // Case A: 0-decision inventory (only loan + mission) => <= 1 total <button> (only confirm!)
      const run0 = createSettlementTestRun({ withMission: true });
      const profile0 = createFreshV2SaveData().profile;
      const sum0 = calculateV2Settlement(run0, profile0, {});
      const decisionCount0 = sum0.lines.filter((l) => l.allowedDispositions.length > 1).length;
      expect(decisionCount0).toBe(0);
      const host0 = dom.document.createElement('div');
      renderSettlementView(
        host0 as unknown as HTMLElement,
        {
          run: run0,
          profile: profile0,
          summary: sum0,
          nextGoal: { title: 't', detail: 'd', actionKind: 'facilities', ready: true },
          readOnly: false,
        },
        {
          onChangeDisposition: () => {},
          onShowcaseRetry: () => {},
          onShowcaseToBase: () => {},
          onConfirmSettlement: () => {},
        }
      );
      expect(host0.querySelectorAll('button').length).toBeLessThanOrEqual(decisionCount0 + 1);
      expect(host0.querySelector('[data-testid="settlement-auto-resolved"]')!.querySelectorAll('button').length).toBe(0);
      expect(host0.querySelector('[data-testid="settlement-loan-summary"]')!.querySelectorAll('button').length).toBe(0);

      // Case B: 3-option loot equipment (with research_lab built) + 2-option relic + 2-option cargo => buttons <= decisionItems + 1, radios switch dispositions cleanly!
      const profile3 = {
        ...profile0,
        buildings: { ...profile0.buildings, research_lab: true },
      };
      const run3 = createSettlementTestRun({ withLootEquipment: true, withRelic: true, withExtraCargo: true });
      const sum3 = calculateV2Settlement(run3, profile3, {});
      const decisionCount3 = sum3.lines.filter((l) => l.allowedDispositions.length > 1).length;
      expect(decisionCount3).toBe(3);
      const host3 = dom.document.createElement('div');
      let lastChanged: { id: string; disp: string } | null = null;
      renderSettlementView(
        host3 as unknown as HTMLElement,
        {
          run: run3,
          profile: profile3,
          summary: sum3,
          nextGoal: { title: 't', detail: 'd', actionKind: 'facilities', ready: true },
          readOnly: false,
        },
        {
          onChangeDisposition: (id, disp) => {
            lastChanged = { id, disp };
          },
          onShowcaseRetry: () => {},
          onShowcaseToBase: () => {},
          onConfirmSettlement: () => {},
        }
      );
      expect(host3.querySelectorAll('button').length).toBeLessThanOrEqual(decisionCount3 + 1);
      // Preserves [data-testid="btn-dismantle-loot_eq_1"] and switches cleanly
      host3.querySelector('[data-testid="btn-dismantle-loot_eq_1"]')!.click();
      expect(lastChanged).toEqual({ id: 'loot_eq_1', disp: 'dismantle' });

      // Rollup controller: staggered creditTick -> single cashRegister, skippable with 0 trailing ticks, instant in reducedMotion
      const rollup = new SettlementBillRollupController();
      sfxCalls.length = 0;
      rollup.start(host3 as unknown as HTMLElement, sum3.finalCreditsEarned, false);
      expect(rollup.isActive()).toBe(true);
      vi.advanceTimersByTime(150);
      expect(sfxCalls.filter((s) => s === 'creditTick').length).toBeGreaterThanOrEqual(1);
      rollup.skip();
      expect(rollup.isActive()).toBe(false);
      expect(sfxCalls.filter((s) => s === 'cashRegister').length).toBe(1);
      const tickCountAtSkip = sfxCalls.filter((s) => s === 'creditTick').length;
      vi.advanceTimersByTime(1500);
      expect(sfxCalls.filter((s) => s === 'creditTick').length).toBe(tickCountAtSkip);

      // Reduced motion rollup: instant, 0 creditTick, 1 cashRegister
      sfxCalls.length = 0;
      rollup.start(host3 as unknown as HTMLElement, sum3.finalCreditsEarned, true);
      expect(rollup.isActive()).toBe(false);
      expect(sfxCalls.filter((s) => s === 'creditTick').length).toBe(0);
      expect(sfxCalls.filter((s) => s === 'cashRegister').length).toBe(1);

      // Case C: Warehouse overflow cleanly disables [data-testid="btn-confirm-settlement"]!
      const fullWarehouse = Array.from({ length: 12 }, (_, idx) =>
        createV2EquipmentInstance({
          instanceId: `wh_fill_${idx}`,
          kind: 'battery',
          quality: 'common',
          origin: 'owned',
          acquiredDepth: 1,
          location: 'warehouse',
        })
      );
      const overflowProfile = {
        ...profile3,
        equipmentWarehouse: fullWarehouse,
      };
      const sumOverflow = calculateV2Settlement(run3, overflowProfile, { loot_eq_1: 'store' });
      expect(sumOverflow.warehouseOverflow).toBe(true);
      const hostOverflow = dom.document.createElement('div');
      renderSettlementView(
        hostOverflow as unknown as HTMLElement,
        {
          run: run3,
          profile: overflowProfile,
          summary: sumOverflow,
          nextGoal: { title: 't', detail: 'd', actionKind: 'facilities', ready: true },
          readOnly: false,
        },
        {
          onChangeDisposition: () => {},
          onShowcaseRetry: () => {},
          onShowcaseToBase: () => {},
          onConfirmSettlement: () => {},
        }
      );
      expect(hostOverflow.querySelector('[data-testid="btn-confirm-settlement"]')!.disabled).toBe(true);

      // End-to-end V2AppController confirm settlement passes real items to playBaseReturnDocking!
      const dockSpy = vi.spyOn(PhaserHost.prototype, 'playBaseReturnDocking');
      const { mountEl } = mountController({
        ...createFreshV2SaveData(),
        profile: profile3,
        activeRun: run3,
      });
      await flushMicrotasks();
      mountEl.querySelector('[data-testid="btn-confirm-settlement"]')!.click();
      expect(dockSpy).toHaveBeenCalledTimes(1);
      const dockArg = dockSpy.mock.calls[0][0];
      expect(dockArg.items).toBeDefined();
      expect(dockArg.items!.length).toBeGreaterThan(0);
      expect(dockArg.items!.some((it) => it.definitionId === 'cargo.ancient_navigator')).toBe(true);
    });
  });

  // =========================================================================
  // T01 — Opt-In Local Playtest Telemetry (?playtest=1) & JSON Export
  // =========================================================================
  describe('T01: Opt-In Playtest Telemetry (?playtest=1) & Zero Default Side Effects', () => {
    it('performs ZERO localStorage accesses and renders ZERO export buttons when ?playtest=1 is absent', async () => {
      expect(isPlaytestParamEnabled('')).toBe(false);
      expect(isPlaytestParamEnabled('?playtest=0')).toBe(false);
      expect(isPlaytestParamEnabled('?seed=42')).toBe(false);
      expect(isPlaytestParamEnabled('?playtest=1')).toBe(true);
      expect(isPlaytestParamEnabled('?seed=42&playtest=1')).toBe(true);

      const { mountEl, controller } = mountController(createFreshV2SaveData());
      await flushMicrotasks();

      // Open Settings modal -> export button MUST NOT exist!
      mountEl.querySelector('#v2-hud-settings')!.click();
      expect(mountEl.querySelector('[data-testid="btn-export-playtest-log"]')).toBeNull();
      expect(controller.getPlaytestTelemetryExportJson()).toBeNull();
      mountEl.querySelector('#v2-set-done')!.click();

      // Verify ZERO reads or writes to starline_playtest_log!
      expect(dom.window.localStorage.getCalls.includes(PLAYTEST_LOG_STORAGE_KEY)).toBe(false);
      expect(dom.window.localStorage.setCalls.includes(PLAYTEST_LOG_STORAGE_KEY)).toBe(false);
      expect(dom.window.localStorage.removeCalls.includes(PLAYTEST_LOG_STORAGE_KEY)).toBe(false);
    });

    it('records phase dwell, pure-confirm clicks, drag success/fail reasons, safe-vs-risk branches, post-settlement replay starts, survives quota errors, and exports valid JSON via Settings when ?playtest=1', async () => {
      // Pure unit check on PlaytestTelemetryLogger quota isolation & summary math
      const storage = new MiniStorage();
      let fakeNow = 1000;
      const logger = new PlaytestTelemetryLogger({
        enabled: true,
        storage: storage as unknown as Storage,
        now: () => fakeNow,
      });
      logger.recordPhase('MAP');
      fakeNow += 2500;
      logger.recordPhase('ENCOUNTER:WRECK');
      logger.recordClick('confirm-settlement', 'btn-confirm-settlement');
      logger.recordClick('wreck-cut', 'wreck-spot-armory');
      logger.recordDragAttempt({ zone: 'grid', itemDefId: 'equipment.battery.common', success: true });
      logger.recordDragAttempt({
        zone: 'staging',
        itemDefId: 'mission.sealed_reactor',
        success: false,
        reason: 'overlap',
      });
      logger.recordBranchChoice('L4B', 'risk_branch');
      logger.recordReplayStart(1, 'expedition');

      const summary = computePlaytestSummary(logger.getEvents());
      expect(summary.phaseDwellMs.MAP).toBe(2500);
      expect(summary.totalClicks).toBe(2);
      expect(summary.pureConfirmClicks).toBe(1);
      expect(summary.pureConfirmRatio).toBe(0.5);
      expect(summary.dragAttempts).toBe(2);
      expect(summary.dragFailures).toBe(1);
      expect(summary.dragFailureRate).toBe(0.5);
      expect(summary.dragFailureReasons.overlap).toBe(1);
      expect(summary.branchChoices.riskBranch).toBe(1);
      expect(summary.postSettlementReplayStarts).toBe(1);
      expect(classifyPureConfirmAction('leave-arrange')).toBe(true);
      expect(classifyPureConfirmAction('wreck-cut')).toBe(false);

      // QuotaExceededError MUST NOT throw or corrupt other keys!
      storage.setItem('starline_save_v2', '{"ok":true}');
      storage.quotaFailKey = PLAYTEST_LOG_STORAGE_KEY;
      expect(() => logger.recordClick('jump-node', 'btn-jump-node')).not.toThrow();
      expect(storage.getItem('starline_save_v2')).toBe('{"ok":true}');

      // Integration test with V2AppController under ?playtest=1
      teardownMiniDom();
      dom = installMiniDom('?playtest=1');
      dom.window.sessionStorage.setItem('starline_v2_title_entered', '1');

      const baseFresh = createFreshV2SaveData();
      const settleRun = createSettlementTestRun({ withMission: true });
      const { mountEl, controller } = mountController({
        ...baseFresh,
        profile: { ...baseFresh.profile, tutorialCompleted: true },
        activeRun: settleRun,
      });
      await flushMicrotasks();

      // Confirm settlement -> returns to base -> launches second voyage (replay_start!)
      const confirmBtn = mountEl.querySelector('[data-testid="btn-confirm-settlement"]')!;
      expect(confirmBtn).not.toBeNull();
      expect(confirmBtn.disabled).toBe(false);
      confirmBtn.click();
      const baseScreen = mountEl.querySelector('[data-testid="base-screen"]');
      expect(baseScreen).not.toBeNull();
      const baseRunBtn = mountEl.querySelector('[data-testid="btn-start-recommended"]');
      expect(baseRunBtn).not.toBeNull();
      baseRunBtn!.click();
      // Launch directly from Prepare screen
      const launchBtn = mountEl.querySelector('[data-testid="btn-launch-expedition"]')!;
      expect(launchBtn).not.toBeNull();
      launchBtn.click();

      // Open Settings modal -> [data-testid="btn-export-playtest-log"] IS rendered and exports valid JSON!
      mountEl.querySelector('#v2-hud-settings')!.click();
      const exportBtn = mountEl.querySelector('[data-testid="btn-export-playtest-log"]')!;
      expect(exportBtn).not.toBeNull();
      exportBtn.click();
      mountEl.querySelector('#v2-set-done')!.click();

      const exportedRaw = controller.getPlaytestTelemetryExportJson();
      expect(exportedRaw).not.toBeNull();
      const parsed = JSON.parse(exportedRaw!);
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.summary.totalClicks).toBeGreaterThanOrEqual(3);
      expect(parsed.summary.pureConfirmClicks).toBeGreaterThanOrEqual(1);
      expect(parsed.summary.postSettlementReplayStarts).toBe(1);
      expect(dom.window.localStorage.getItem(PLAYTEST_LOG_STORAGE_KEY)).not.toBeNull();

      // Launch expedition helper check (ensures launchV2Expedition stays pure & clean)
      const launchCheck = launchV2Expedition({
        profile: createFreshV2SaveData().profile,
        contractTemplateId: 'c_free',
        shipId: 'cannon_skiff',
        crewId: 'engineer',
        primaryArchetype: 'laser',
        slots: buildFreeFallbackPrepareSlots('cannon_skiff', createFreshV2SaveData().profile.blueprints),
        trialBuildId: null,
        sectorId: 'near_orbit',
        seed: 12345,
      });
      expect(launchCheck.ok).toBe(true);
    });
  });
});
