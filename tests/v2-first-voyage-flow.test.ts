import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal Third-Party Phaser WebGL Stub (ONLY 'phaser' is mocked — ALL real
// project classes: PhaserHost, BaseScene, CombatScene, V2CombatScene,
// V2AppController, CargoGridV2Component, MapPhaseView, ArrangePhaseView run!)
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
    blendMode = 0;

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
        queueMicrotask(() => {
          this.emitReady();
        });
      }
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

vi.mock('phaser', () => ({
  default: {
    AUTO: 0,
    BlendModes: { SKIP_CHECK: -1, NORMAL: 0, ADD: 1, MULTIPLY: 2, SCREEN: 3 },
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

import { PhaserHost } from '../src/scenes/PhaserHost';
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
import { evaluateWreckHotspotCut } from '../src/v2/domain/dismantle';
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
  findFirstLegalV2Placement,
  placeV2FromStaging,
  removeV2ItemById,
  verifyV2SpatialConflict,
} from '../src/v2/domain/inventoryV2';
import {
  createV2CargoInstance,
  createV2EquipmentInstance,
  createV3GadgetInstance,
  getAnyV2ItemDef,
} from '../src/v2/domain/itemCatalog';
import { buildFreeFallbackPrepareSlots, launchV2Expedition } from '../src/v2/domain/loadout';
import {
  createFreshV2SaveData,
  loadV2SaveData,
  persistV2SaveData,
  validateV2SaveDataDetailed,
} from '../src/v2/domain/persistenceV2';
import { applyV2Settlement } from '../src/v2/domain/settlementV2';
import {
  classifyV2CombatThreat,
  computeV2ItemSacrificePreview,
  summarizeV2DiscardedSacrifices,
  summarizeV2MissionSacrificeOptions,
} from '../src/v2/domain/tacticalDelta';
import { V2_TAB_LOCK_KEY, type V2MapNode, type V2RunState, type V2SaveData } from '../src/v2/domain/types';
import { V2CombatScene } from '../src/v2/scenes/V2CombatScene';
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
  readonly newValue: string | null;
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
      newValue?: string | null;
      button?: number;
      pointerType?: string;
      clientX?: number;
      clientY?: number;
    } = {}
  ) {
    this.type = type;
    this.bubbles = init.bubbles ?? false;
    this.key = init.key ?? '';
    this.newValue = init.newValue ?? null;
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
  private nextRafId = 1;
  requestAnimationFrame = (_cb: () => void): number => this.nextRafId++;
  cancelAnimationFrame = (_id: number): void => {};
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
    requestAnimationFrame: g.requestAnimationFrame,
    cancelAnimationFrame: g.cancelAnimationFrame,
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
  g.requestAnimationFrame = win.requestAnimationFrame;
  g.cancelAnimationFrame = win.cancelAnimationFrame;
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
      g.requestAnimationFrame = prev.requestAnimationFrame;
      g.cancelAnimationFrame = prev.cancelAnimationFrame;
    },
  };
}

function cellCenterPoint(cols: number, rows: number, cx: number, cy: number): { x: number; y: number } {
  const cellW = 320 / cols;
  const cellH = 320 / rows;
  return { x: cx * cellW + cellW * 0.5, y: cy * cellH + cellH * 0.5 };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function readLoadedSave(storage: Storage): V2SaveData {
  const loaded = loadV2SaveData(storage);
  if (loaded.status !== 'loaded') {
    throw new Error(`Expected loaded save status, got ${loaded.status}`);
  }
  return loaded.data;
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
    phaserTestHarness.autoReady = true;
    phaserTestHarness.lastGame = null;
    phaserTestHarness.deferCreateKeys.clear();
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

      // Step 5B: L4B Risk Branch (tutorial_raider 7HP/4穿盾攻/甲2 + guaranteed cargo.ancient_navigator)
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
      const spot = findFirstLegalV2Placement(bought.run.bay, offer.item.definitionId);
      expect(spot).not.toBeNull();
      const placedInShop = placeV2FromStaging(
        bought.run.bay,
        offer.item.instanceId,
        spot!.x,
        spot!.y,
        spot!.rotation
      );
      expect(placedInShop.ok).toBe(true);
      expect(placedInShop.bay.staging).toHaveLength(0);
      expect(finishV2MerchantVisit({ ...bought.run, bay: placedInShop.bay }).run.phase).toBe('ARRANGE');
      // Use engineer swap + discard swapped item -> offer.used === true & empty staging -> MAP!
      const swapped = applyV2EngineerSwap(bought.run, bought.run.activeEngineerOffer!.candidates[0]);
      expect(swapped.ok).toBe(true);
      const droppedSwap = discardV2Item(swapped.run.bay, swapped.run.bay.staging[0].item.instanceId);
      expect(droppedSwap.ok).toBe(true);
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

    it('allows live CargoGridV2 editing on MAP via syncMapLocal (0 destroys, 0 MapPhaseView remounts, 0 showV2Stage resets, real PhaserHost/V2CombatScene hardpoint sync, live forecast & staging guard)', async () => {
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
      const showStageSpy = vi.spyOn(PhaserHost.prototype, 'showV2Stage');
      const updateVisualSpy = vi.spyOn(PhaserHost.prototype, 'updateV2ShipVisualSpec');
      const sceneUpdateVisualSpy = vi.spyOn(V2CombatScene.prototype, 'updateShipVisualSpec');

      const mountEl = dom.document.createElement('div');
      dom.document.body.appendChild(mountEl);
      const controller = new V2AppController(mountEl as unknown as HTMLElement, {
        onSwitchToV1: () => {},
      });
      controller.init();
      await flushMicrotasks();

      expect(mapMountSpy).toHaveBeenCalledTimes(1);
      expect(showStageSpy).toHaveBeenCalledTimes(1);
      expect(
        (dom.window.__STARLINE_INSPECT__?.() as { phaserScene?: string | null } | undefined)
          ?.phaserScene
      ).toBe('V2CombatScene');
      const l1CardBefore = mountEl.querySelector('[data-testid="map-node-L1A"]')!;
      expect(l1CardBefore.getAttribute('data-preview-final-hp')).toBe('24');
      expect(l1CardBefore.textContent).not.toContain('24HP');
      showStageSpy.mockClear();
      updateVisualSpy.mockClear();
      sceneUpdateVisualSpy.mockClear();

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

      // Forecast updated LIVE from 24HP -> 26HP (via data-preview-final-hp & on-demand Details Drawer), 0 destroys, 0 remounts, 0 stage resets!
      const l1CardAfter = mountEl.querySelector('[data-testid="map-node-L1A"]')!;
      expect(l1CardAfter.getAttribute('data-preview-final-hp')).toBe('26');
      expect(l1CardAfter.textContent).not.toContain('26HP');
      const detailsBtn = l1CardAfter.querySelector('[data-testid="btn-toggle-forecast-details"]')!;
      expect(detailsBtn).not.toBeNull();
      detailsBtn.click();
      expect(mountEl.querySelector('[data-testid="forecast-details-drawer"]')!.textContent).toContain('26HP');
      expect(mapMountSpy).toHaveBeenCalledTimes(1);
      expect(gridDestroySpy).toHaveBeenCalledTimes(0);
      expect(showStageSpy).toHaveBeenCalledTimes(0);
      expect(updateVisualSpy).toHaveBeenCalledTimes(1);
      expect(sceneUpdateVisualSpy).toHaveBeenCalledTimes(1);

      // Moving item to staging on MAP disables jump & safe-return buttons with explicit reason!
      const toStagingBtn = mountEl.querySelector('#btn-v2-to-staging');
      expect(toStagingBtn).not.toBeNull();
      toStagingBtn!.click();
      const jumpBtn = mountEl.querySelector('[data-testid="btn-jump-node"]')!;
      const safeBtn = mountEl.querySelector('[data-testid="btn-safe-return"]')!;
      expect(jumpBtn.disabled).toBe(true);
      expect(jumpBtn.textContent).toContain('请先清空暂存区');
      expect(safeBtn.disabled).toBe(true);
      expect(safeBtn.textContent).toContain('需清空暂存区');

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

    it('enforces startV2CombatAtCurrentNode domain idempotency and V2AppController S05 integration with real PhaserHost/V2CombatScene playback', async () => {
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

      // 2. Full V2AppController S05 integration with vi.useFakeTimers() + real PhaserHost/V2CombatScene
      vi.useFakeTimers();
      const save = { ...createFreshV2SaveData(), activeRun: entered.run };
      persistV2SaveData(dom.window.localStorage as unknown as Storage, save);
      dom.window.sessionStorage.setItem('starline_v2_title_entered', '1');

      const startSpy = vi.spyOn(combatV2, 'startV2CombatAtCurrentNode');
      const showStageSpy = vi.spyOn(PhaserHost.prototype, 'showV2Stage');
      const sceneSetPlaybackSpy = vi.spyOn(V2CombatScene.prototype, 'setPlayback');

      const mountEl = dom.document.createElement('div');
      dom.document.body.appendChild(mountEl);
      const controller = new V2AppController(mountEl as unknown as HTMLElement, {
        onSwitchToV1: () => {},
      });
      controller.init();
      await flushMicrotasks();

      expect(
        (dom.window.__STARLINE_INSPECT__?.() as { phaserScene?: string | null } | undefined)
          ?.phaserScene
      ).toBe('V2CombatScene');

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
      // Close modal unconditionally
      const closeModalBtn = mountEl.querySelector('.modal-close-btn');
      expect(closeModalBtn).not.toBeNull();
      closeModalBtn!.click();
      vi.advanceTimersByTime(5000);
      expect(startSpy).toHaveBeenCalledTimes(0);

      // Resume -> let 1500ms expire -> engages strictly ONCE & launches real V2CombatScene playback!
      showStageSpy.mockClear();
      sceneSetPlaybackSpy.mockClear();
      mountEl.querySelector('[data-testid="btn-pause-auto-combat"]')!.click();
      vi.advanceTimersByTime(1500);
      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(showStageSpy).toHaveBeenCalledTimes(1);
      expect(showStageSpy.mock.calls[0][0].simulation).not.toBeNull();
      expect(sceneSetPlaybackSpy).toHaveBeenCalledTimes(1);
      expect(sceneSetPlaybackSpy.mock.calls[0][0].simulation).not.toBeNull();
      vi.advanceTimersByTime(5000);
      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(showStageSpy).toHaveBeenCalledTimes(1);
      controller.destroy();

      // 3. Manual click at 300ms + timer race fires strictly ONCE, and destroy() leaks 0 timers
      persistV2SaveData(dom.window.localStorage as unknown as Storage, save);
      const mountEl2 = dom.document.createElement('div');
      dom.document.body.appendChild(mountEl2);
      const controller2 = new V2AppController(mountEl2 as unknown as HTMLElement, {
        onSwitchToV1: () => {},
      });
      controller2.init();
      await flushMicrotasks();
      startSpy.mockClear();
      showStageSpy.mockClear();
      sceneSetPlaybackSpy.mockClear();
      vi.advanceTimersByTime(300);
      mountEl2.querySelector('[data-testid="btn-start-combat"]')!.click();
      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(showStageSpy).toHaveBeenCalledTimes(1);
      expect(showStageSpy.mock.calls[0][0].simulation).not.toBeNull();
      expect(sceneSetPlaybackSpy).toHaveBeenCalledTimes(1);
      expect(sceneSetPlaybackSpy.mock.calls[0][0].simulation).not.toBeNull();
      vi.advanceTimersByTime(5000);
      expect(startSpy).toHaveBeenCalledTimes(1);
      controller2.destroy();

      // Destroy during active countdown leaks 0 calls
      persistV2SaveData(dom.window.localStorage as unknown as Storage, save);
      const mountEl3 = dom.document.createElement('div');
      dom.document.body.appendChild(mountEl3);
      const controller3 = new V2AppController(mountEl3 as unknown as HTMLElement, {
        onSwitchToV1: () => {},
      });
      controller3.init();
      await flushMicrotasks();
      startSpy.mockClear();
      showStageSpy.mockClear();
      vi.advanceTimersByTime(500);
      controller3.destroy();
      vi.advanceTimersByTime(5000);
      expect(startSpy).toHaveBeenCalledTimes(0);
      expect(showStageSpy).toHaveBeenCalledTimes(0);
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

  // -------------------------------------------------------------------------
  // Iteration-2 Hardening & Defect Regression Suite
  // (C1-D1, C1-D2, [B1], C2-D1, C2-D2, extractV2Wreck, tacticalDelta, Polish)
  // -------------------------------------------------------------------------
  describe('Iteration-2 Regression Suite: Domain Guards, L4B Balance, SHOP/Multi-Tab Modals, engageNow & Polish', () => {
    it('C1-D1: prevents hp <= 0 resurrection in resolveV2EventOption, evaluateWreckHotspotCut, cutV2WreckHotspot, and legacy heal paths', () => {
      const { run: distressBase, node: distressNode } = findFormalRunWithNodeType('distress', 'free_salvage', 1030);
      const makeDeadEventRun = (
        option: NonNullable<V2RunState['activeEvent']>['options'][number],
        terminal = false
      ): V2RunState => {
        const nodeObj: V2MapNode = terminal
          ? { ...distressNode, nextNodeIds: [], resolved: false }
          : { ...distressNode, resolved: false };
        return {
          ...distressBase,
          phase: 'ENCOUNTER',
          currentNodeId: nodeObj.nodeId,
          visitedNodeIds: [nodeObj.nodeId],
          hp: 0,
          bay: { ...distressBase.bay, staging: [] },
          graph: {
            ...distressBase.graph,
            nodes: { ...distressBase.graph.nodes, [nodeObj.nodeId]: nodeObj },
          },
          activeEvent: {
            nodeId: nodeObj.nodeId,
            eventId: 'c1_d1_dead_evt',
            title: '死舰事件测试',
            description: 'hp=0 guard check',
            resolved: false,
            chosenIndex: null,
            options: [option],
          },
        };
      };

      // Non-terminal fallback, terminal fallback, cargo reward, and heal reward at hp=0 -> ALWAYS SETTLEMENT('defeat', hp: 0)
      const deadNonTerm = resolveV2EventOption(
        makeDeadEventRun({ index: 0, label: '绕行', costSummary: '无', rewardSummary: '无', isFallback: true }),
        0,
        ['core']
      );
      expect(deadNonTerm.ok).toBe(true);
      expect(deadNonTerm.run.hp).toBe(0);
      expect(deadNonTerm.run.phase).toBe('SETTLEMENT');
      expect(deadNonTerm.run.settlementReason).toBe('defeat');
      expect(deadNonTerm.hadHeal).toBe(false);

      const deadTerm = resolveV2EventOption(
        makeDeadEventRun({ index: 0, label: '终层绕行', costSummary: '无', rewardSummary: '无', isFallback: true }, true),
        0,
        ['core']
      );
      expect(deadTerm.ok).toBe(true);
      expect(deadTerm.run.hp).toBe(0);
      expect(deadTerm.run.phase).toBe('SETTLEMENT');
      expect(deadTerm.run.settlementReason).toBe('defeat');

      const deadCargo = resolveV2EventOption(
        makeDeadEventRun({
          index: 0,
          label: '捞货',
          costSummary: '无',
          rewardSummary: '货',
          rewardItems: [
            createV2CargoInstance({
              instanceId: 'c1_d1_dead_cargo',
              defId: 'cargo.alloy_bar',
              origin: 'loot',
              acquiredDepth: 1,
              location: 'staging',
            }),
          ],
        }),
        0,
        ['core']
      );
      expect(deadCargo.ok).toBe(true);
      expect(deadCargo.run.hp).toBe(0);
      expect(deadCargo.run.phase).toBe('SETTLEMENT');
      expect(deadCargo.run.settlementReason).toBe('defeat');

      const deadHeal = resolveV2EventOption(
        makeDeadEventRun({
          index: 0,
          label: '应急抢修',
          costSummary: '无',
          rewardSummary: '+12 HP',
          rewardHp: 12,
        }),
        0,
        ['core']
      );
      expect(deadHeal.ok).toBe(true);
      expect(deadHeal.run.hp).toBe(0);
      expect(deadHeal.run.phase).toBe('SETTLEMENT');
      expect(deadHeal.run.settlementReason).toBe('defeat');
      expect(deadHeal.hadHeal).toBe(false);

      // Wreck cut rejected at hp=0 (including reactor repair), while extractV2Wreck settles cleanly to defeat
      const { run: wreckBase, node: wreckNode } = findFormalRunWithNodeType('wreck', 'free_salvage', 1010);
      const deadWreck: V2RunState = {
        ...wreckBase,
        phase: 'ENCOUNTER',
        currentNodeId: wreckNode.nodeId,
        visitedNodeIds: [wreckNode.nodeId],
        hp: 0,
        bay: { ...wreckBase.bay, staging: [] },
      };
      const evalDeadCut = evaluateWreckHotspotCut(
        deadWreck,
        {
          nodeId: wreckNode.nodeId,
          stability: 100,
          maxStability: 100,
          cutsMade: 0,
          extracted: false,
          ambushTriggered: false,
          stabilizerActive: false,
          hotspots: [
            {
              spotId: 'reactor',
              label: '反应堆舱',
              cut: false,
              riskHullDamage: 0,
              riskFuelCost: 0,
              riskAmbush: false,
              reactorRepairGain: 8,
            },
          ],
        },
        'reactor'
      );
      expect(evalDeadCut.canCut).toBe(false);
      expect(evalDeadCut.isLethal).toBe(true);

      const cutDead = cutV2WreckHotspot(deadWreck, 'reactor', ['core'], 'repair');
      expect(cutDead.ok).toBe(false);
      expect(cutDead.run.hp).toBe(0);

      const extractedDead = extractV2Wreck(deadWreck);
      expect(extractedDead.ok).toBe(true);
      expect(extractedDead.run.hp).toBe(0);
      expect(extractedDead.run.phase).toBe('SETTLEMENT');
      expect(extractedDead.run.settlementReason).toBe('defeat');

      // Defensive hp <= 0 heal guards on legacy wreck/distress/combat-reward paths
      const deadLegacyWreck = resolveV2WreckChoice(deadWreck, 'reactor_repair', ['core']);
      expect(deadLegacyWreck.ok).toBe(true);
      expect(deadLegacyWreck.run.hp).toBe(0);
      expect(deadLegacyWreck.run.phase).toBe('SETTLEMENT');
      expect(deadLegacyWreck.run.settlementReason).toBe('defeat');

      const deadDistress = resolveV2DistressChoice(
        {
          ...distressBase,
          phase: 'ENCOUNTER',
          currentNodeId: distressNode.nodeId,
          visitedNodeIds: [distressNode.nodeId],
          hp: 0,
          fuel: 6,
          bay: { ...distressBase.bay, staging: [] },
        },
        'rescue_crew'
      );
      expect(deadDistress.ok).toBe(true);
      expect(deadDistress.run.hp).toBe(0);
      expect(deadDistress.run.phase).toBe('SETTLEMENT');
      expect(deadDistress.run.settlementReason).toBe('defeat');

      const { run: cmbBase, node: cmbNode } = findFormalRunWithNodeType('combat', 'free_salvage', 1050);
      const deadReward = pickV2CombatReward(
        {
          ...cmbBase,
          phase: 'REWARD',
          currentNodeId: cmbNode.nodeId,
          visitedNodeIds: [cmbNode.nodeId],
          hp: 0,
          bay: { ...cmbBase.bay, staging: [] },
          pendingReward: {
            nodeId: cmbNode.nodeId,
            equipmentOption: createV2EquipmentInstance({
              instanceId: 'c1_d1_eq',
              kind: 'shield',
              quality: 'common',
              origin: 'loot',
              acquiredDepth: 1,
              location: 'staging',
            }),
            cargoOption: createV2CargoInstance({
              instanceId: 'c1_d1_cg',
              defId: 'cargo.data_box',
              origin: 'loot',
              acquiredDepth: 1,
              location: 'staging',
            }),
            repairAmount: 10,
            chosen: null,
          },
        },
        'repair',
        ['core']
      );
      expect(deadReward.ok).toBe(true);
      expect(deadReward.run.hp).toBe(0);
      expect(deadReward.run.phase).toBe('SETTLEMENT');
      expect(deadReward.run.settlementReason).toBe('defeat');
    });

    it('C1-D2: L4B tutorial_raider (7HP/4 pierce/armor2) stays 稳 with wired Laser+Battery and is strictly 危险/致命 when Laser is dropped even with Shield or Repair + PowerCell Battery', () => {
      const tut = createV2TutorialRun('tut_c1_d2');
      const l4bUnits = tut.graph.nodes['L4B'].combat!.units;
      expect(l4bUnits).toHaveLength(1);
      expect(l4bUnits[0].maxHp).toBe(7);
      expect(l4bUnits[0].damagePerRound).toBe(4);
      expect(l4bUnits[0].armor).toBe(2);
      expect(l4bUnits[0].pierceRatio).toBe(1);

      // 1. Wired Laser + Battery -> 稳 (2R / 22HP @ 30HP; 2R / 18HP @ 26HP)
      const batId = tut.bay.staging[0].item.instanceId;
      const wired = placeV2FromStaging(tut.bay, batId, 1, 0, 0);
      expect(wired.ok).toBe(true);
      const keep30 = combatV2.simulateV2Combat({
        resultId: 'c1d2_keep30',
        bay: wired.bay,
        startingHp: 30,
        maxHp: 30,
        units: l4bUnits,
        targetPolicy: 'weakest',
        sectorId: 'near_orbit',
        crewId: 'engineer',
      });
      const keep26 = combatV2.simulateV2Combat({
        resultId: 'c1d2_keep26',
        bay: wired.bay,
        startingHp: 26,
        maxHp: 30,
        units: l4bUnits,
        targetPolicy: 'weakest',
        sectorId: 'near_orbit',
        crewId: 'engineer',
      });
      expect(keep30.outcome).toBe('victory');
      expect(keep30.roundsCount).toBe(2);
      expect(keep30.finalPlayerHpAfterRepair).toBe(22);
      expect(classifyV2CombatThreat({ outcome: keep30.outcome, playerFinalHp: keep30.finalPlayerHpAfterRepair }, 30).label).toBe('稳');
      expect(keep26.outcome).toBe('victory');
      expect(keep26.roundsCount).toBe(2);
      expect(keep26.finalPlayerHpAfterRepair).toBe(18);
      expect(classifyV2CombatThreat({ outcome: keep26.outcome, playerFinalHp: keep26.finalPlayerHpAfterRepair }, 30).label).toBe('稳');

      // 2. Dropped Laser + L2 Shield + Battery on PowerCell (1,2) -> 危险 (2HP @ 30HP) / 致命 (0HP @ 26HP)
      const shieldItem = createV2EquipmentInstance({
        instanceId: 'c1d2_shield',
        kind: 'shield',
        quality: 'common',
        origin: 'loot',
        acquiredDepth: 2,
        location: 'bay',
      });
      const batPcItem = createV2EquipmentInstance({
        instanceId: 'c1d2_bat_pc',
        kind: 'battery',
        quality: 'common',
        origin: 'loan',
        acquiredDepth: 0,
        location: 'bay',
      });
      const bayDropShieldPc = {
        ...tut.bay,
        staging: [],
        placed: [
          { item: shieldItem, x: 0, y: 2, rotation: 0 as const },
          { item: batPcItem, x: 1, y: 2, rotation: 0 as const }, // PowerCell (1,2)!
        ],
      };
      const dropShield30 = combatV2.simulateV2Combat({
        resultId: 'c1d2_drop_shd_30',
        bay: bayDropShieldPc,
        startingHp: 30,
        maxHp: 30,
        units: l4bUnits,
        targetPolicy: 'weakest',
        sectorId: 'near_orbit',
        crewId: 'engineer',
      });
      const dropShield26 = combatV2.simulateV2Combat({
        resultId: 'c1d2_drop_shd_26',
        bay: bayDropShieldPc,
        startingHp: 26,
        maxHp: 30,
        units: l4bUnits,
        targetPolicy: 'weakest',
        sectorId: 'near_orbit',
        crewId: 'engineer',
      });
      expect(dropShield30.finalPlayerHpAfterRepair).toBe(2);
      expect(classifyV2CombatThreat({ outcome: dropShield30.outcome, playerFinalHp: dropShield30.finalPlayerHpAfterRepair }, 30).label).toBe('危险');
      expect(dropShield26.outcome).toBe('defeat');
      expect(classifyV2CombatThreat({ outcome: dropShield26.outcome, playerFinalHp: dropShield26.finalPlayerHpAfterRepair }, 30).label).toBe('致命');

      // 3. Dropped Laser + Engineer-Swapped repair.common + Battery on PowerCell (1,2) -> 危险 (4HP @ 30HP) / 致命 (0HP @ 26HP)
      const repairItem = createV2EquipmentInstance({
        instanceId: 'c1d2_repair',
        kind: 'repair',
        quality: 'common',
        origin: 'loot',
        acquiredDepth: 2,
        location: 'bay',
      });
      const bayDropRepairPc = {
        ...tut.bay,
        staging: [],
        placed: [
          { item: repairItem, x: 0, y: 2, rotation: 0 as const },
          { item: batPcItem, x: 1, y: 2, rotation: 0 as const },
        ],
      };
      const dropRepair30 = combatV2.simulateV2Combat({
        resultId: 'c1d2_drop_rep_30',
        bay: bayDropRepairPc,
        startingHp: 30,
        maxHp: 30,
        units: l4bUnits,
        targetPolicy: 'weakest',
        sectorId: 'near_orbit',
        crewId: 'engineer',
      });
      const dropRepair26 = combatV2.simulateV2Combat({
        resultId: 'c1d2_drop_rep_26',
        bay: bayDropRepairPc,
        startingHp: 26,
        maxHp: 30,
        units: l4bUnits,
        targetPolicy: 'weakest',
        sectorId: 'near_orbit',
        crewId: 'engineer',
      });
      expect(dropRepair30.finalPlayerHpAfterRepair).toBe(4);
      expect(classifyV2CombatThreat({ outcome: dropRepair30.outcome, playerFinalHp: dropRepair30.finalPlayerHpAfterRepair }, 30).label).toBe('危险');
      expect(dropRepair26.outcome).toBe('defeat');
      expect(classifyV2CombatThreat({ outcome: dropRepair26.outcome, playerFinalHp: dropRepair26.finalPlayerHpAfterRepair }, 30).label).toBe('致命');
    });

    it('hardening: enforces extractV2Wreck double-call idempotency, multi-discard telescoping sacrifice deltas, and unlinked heavy firepower previews', () => {
      // 1. extractV2Wreck double-call idempotency (cannot double-increment wrecksDissectedThisRun)
      const { run: wreckBase, node: wreckNode } = findFormalRunWithNodeType('wreck', 'free_salvage', 1015);
      const inWreck: V2RunState = {
        ...wreckBase,
        phase: 'ENCOUNTER',
        currentNodeId: wreckNode.nodeId,
        visitedNodeIds: [wreckNode.nodeId],
        bay: { ...wreckBase.bay, staging: [] },
      };
      const cut1 = cutV2WreckHotspot(inWreck, 'armory', ['core']);
      expect(cut1.ok).toBe(true);
      const ext1 = extractV2Wreck(cut1.run);
      expect(ext1.ok).toBe(true);
      expect(ext1.run.wrecksDissectedThisRun).toBe(1);
      expect(ext1.run.claimedEventIds).toContain(`wreck_extract_${wreckNode.nodeId}`);
      // Even if a buggy caller forces phase back to ENCOUNTER, node.resolved + claimedEventIds rejects double extract!
      const ext2 = extractV2Wreck({ ...ext1.run, phase: 'ENCOUNTER' });
      expect(ext2.ok).toBe(false);
      expect(ext2.run.wrecksDissectedThisRun).toBe(1);

      // 2. summarizeV2DiscardedSacrifices multi-discard (laser + battery in BOTH orders => exact -5 total!)
      const tut = createV2TutorialRun('tut_multi_discard');
      const batId = tut.bay.staging[0].item.instanceId;
      const laserId = `${tut.runId}_tut_laser`;
      const wired = placeV2FromStaging(tut.bay, batId, 1, 0, 0);
      expect(wired.ok).toBe(true);

      // Order A: discard laser THEN battery
      const dLaser1 = discardV2Item(wired.bay, laserId);
      expect(dLaser1.ok).toBe(true);
      const dBat2 = discardV2Item(dLaser1.bay, batId);
      expect(dBat2.ok).toBe(true);
      const sumA = summarizeV2DiscardedSacrifices(dBat2.bay);
      expect(sumA).toContain('激光炮（火力 -5）');
      expect(sumA).toContain('能量电池（借用 · 0¤）');

      // Order B: discard battery THEN laser (no double-counting: -2 + -3 = -5)
      const dBat1 = discardV2Item(wired.bay, batId);
      expect(dBat1.ok).toBe(true);
      const dLaser2 = discardV2Item(dBat1.bay, laserId);
      expect(dLaser2.ok).toBe(true);
      const sumB = summarizeV2DiscardedSacrifices(dLaser2.bay);
      expect(sumB).toContain('能量电池（火力 -2）');
      expect(sumB).toContain('激光炮（火力 -3）');

      // 3. buildSacrificePreviewFromStatsDelta unlinked heavy cannon firepower (common=-6, improved=-8; laser wired=-5)
      const heavyCommon = createV2EquipmentInstance({
        instanceId: 'hv_common',
        kind: 'heavy',
        quality: 'common',
        origin: 'owned',
        acquiredDepth: 0,
        location: 'bay',
      });
      const heavyImproved = createV2EquipmentInstance({
        instanceId: 'hv_improved',
        kind: 'heavy',
        quality: 'improved',
        origin: 'owned',
        acquiredDepth: 0,
        location: 'bay',
      });
      const bayHeavyCommon = {
        ...tut.bay,
        staging: [],
        placed: [{ item: heavyCommon, x: 0, y: 0, rotation: 0 as const }],
      };
      const pvHeavyCommon = computeV2ItemSacrificePreview(bayHeavyCommon, 'hv_common');
      expect(pvHeavyCommon).not.toBeNull();
      expect(pvHeavyCommon!.firepowerLoss).toBe(6);
      expect(pvHeavyCommon!.fullLabel).toContain('火力 -6');

      const bayHeavyImproved = {
        ...tut.bay,
        staging: [],
        placed: [{ item: heavyImproved, x: 0, y: 0, rotation: 0 as const }],
      };
      const pvHeavyImproved = computeV2ItemSacrificePreview(bayHeavyImproved, 'hv_improved');
      expect(pvHeavyImproved).not.toBeNull();
      expect(pvHeavyImproved!.firepowerLoss).toBe(8);
      expect(pvHeavyImproved!.fullLabel).toContain('火力 -8');

      // Laser wired/unwired/battery unchanged
      const pvLaserWired = computeV2ItemSacrificePreview(wired.bay, laserId);
      expect(pvLaserWired!.firepowerLoss).toBe(5);
      const pvBatWired = computeV2ItemSacrificePreview(wired.bay, batId);
      expect(pvBatWired!.firepowerLoss).toBe(2);
    });

    it('[B1]: SHOP onFinish opens openV2DiscardConfirmModal on auto-skip (MAP & SETTLEMENT), keeps undoable on cancel, and skips modal when exiting to ARRANGE', async () => {
      const { run: shopBase, node: shopNode } = findFormalRunWithNodeType('merchant', 'free_salvage', 1040);
      const shopRun: V2RunState = {
        ...shopBase,
        phase: 'SHOP',
        currentNodeId: shopNode.nodeId,
        visitedNodeIds: [shopNode.nodeId],
        wallet: 200,
        bay: { ...shopBase.bay, staging: [], discardedThisArrange: [] },
      };

      const save = { ...createFreshV2SaveData(), activeRun: shopRun };
      persistV2SaveData(dom.window.localStorage as unknown as Storage, save);
      dom.window.sessionStorage.setItem('starline_v2_title_entered', '1');

      const mountEl = dom.document.createElement('div');
      dom.document.body.appendChild(mountEl);
      const controller = new V2AppController(mountEl as unknown as HTMLElement, {
        onSwitchToV1: () => {},
      });
      controller.init();
      await flushMicrotasks();

      // Select placed item at (0,0) and discard it inside SHOP
      const board = mountEl.querySelector('.v2-cargo-board')!;
      const pt = cellCenterPoint(4, 4, 0, 0);
      board.dispatchEvent(new MiniEvent('pointerdown', { bubbles: true, clientX: pt.x, clientY: pt.y }));
      dom.window.dispatchEvent(new MiniEvent('pointerup', { bubbles: true, clientX: pt.x, clientY: pt.y }));
      const discardBtn = mountEl.querySelector('#btn-v2-discard');
      expect(discardBtn).not.toBeNull();
      discardBtn!.click();

      // Click finish -> opens discard-confirm modal instead of silently deleting!
      const finishBtn = mountEl.querySelector('#v2-shop-finish');
      expect(finishBtn).not.toBeNull();
      finishBtn!.click();
      const cancelBtn = mountEl.querySelector('#v2-discard-cancel');
      const okBtn = mountEl.querySelector('#v2-discard-ok');
      expect(cancelBtn).not.toBeNull();
      expect(okBtn).not.toBeNull();
      expect(
        (dom.window.__STARLINE_INSPECT__?.() as { phase?: string | null } | undefined)?.phase
      ).toBe('SHOP');

      // Cancel keeps SHOP + undoable discard
      cancelBtn!.click();
      expect(mountEl.querySelector('#v2-discard-ok')).toBeNull();
      expect(
        (dom.window.__STARLINE_INSPECT__?.() as { phase?: string | null } | undefined)?.phase
      ).toBe('SHOP');
      const undoBtn = mountEl.querySelector('#btn-v2-undo-discard');
      expect(undoBtn).not.toBeNull();
      undoBtn!.click();

      // Re-select & discard, then confirm -> flushes and transitions to MAP
      board.dispatchEvent(new MiniEvent('pointerdown', { bubbles: true, clientX: pt.x, clientY: pt.y }));
      dom.window.dispatchEvent(new MiniEvent('pointerup', { bubbles: true, clientX: pt.x, clientY: pt.y }));
      mountEl.querySelector('#btn-v2-discard')!.click();
      mountEl.querySelector('#v2-shop-finish')!.click();
      const confirmBtn = mountEl.querySelector('#v2-discard-ok');
      expect(confirmBtn).not.toBeNull();
      confirmBtn!.click();

      expect(
        (dom.window.__STARLINE_INSPECT__?.() as { phase?: string | null } | undefined)?.phase
      ).toBe('MAP');
      const savedAfterMap = readLoadedSave(dom.window.localStorage as unknown as Storage);
      expect(savedAfterMap.activeRun!.bay.discardedThisArrange).toHaveLength(0);
      expect(savedAfterMap.activeRun!.discardedCountThisRun).toBe(1);
      controller.destroy();

      // Terminal SHOP auto-skip with discarded item -> confirm transitions to SETTLEMENT
      const termShopNode: V2MapNode = { ...shopNode, nextNodeIds: [], resolved: false };
      const termShopRun: V2RunState = {
        ...shopRun,
        graph: { ...shopRun.graph, nodes: { ...shopRun.graph.nodes, [termShopNode.nodeId]: termShopNode } },
      };
      persistV2SaveData(dom.window.localStorage as unknown as Storage, {
        ...createFreshV2SaveData(),
        activeRun: termShopRun,
      });
      const mountElTerm = dom.document.createElement('div');
      dom.document.body.appendChild(mountElTerm);
      const ctrlTerm = new V2AppController(mountElTerm as unknown as HTMLElement, {
        onSwitchToV1: () => {},
      });
      ctrlTerm.init();
      await flushMicrotasks();
      const termBoard = mountElTerm.querySelector('.v2-cargo-board')!;
      termBoard.dispatchEvent(new MiniEvent('pointerdown', { bubbles: true, clientX: pt.x, clientY: pt.y }));
      dom.window.dispatchEvent(new MiniEvent('pointerup', { bubbles: true, clientX: pt.x, clientY: pt.y }));
      mountElTerm.querySelector('#btn-v2-discard')!.click();
      mountElTerm.querySelector('#v2-shop-finish')!.click();
      const termOk = mountElTerm.querySelector('#v2-discard-ok');
      expect(termOk).not.toBeNull();
      termOk!.click();
      expect(
        (dom.window.__STARLINE_INSPECT__?.() as { phase?: string | null } | undefined)?.phase
      ).toBe('SETTLEMENT');
      ctrlTerm.destroy();

      // SHOP exiting to ARRANGE (bought item still in staging) -> skips confirm modal and keeps discard undoable!
      const offer = shopNode.merchant!.offers[0];
      const bought = buyV2MerchantOffer(shopRun, offer.offerId, 'tx_b1_arrange', ['core']);
      expect(bought.ok).toBe(true);
      const discardedInBought = discardV2Item(bought.run.bay, bought.run.bay.placed[0].item.instanceId);
      expect(discardedInBought.ok).toBe(true);
      persistV2SaveData(dom.window.localStorage as unknown as Storage, {
        ...createFreshV2SaveData(),
        activeRun: { ...bought.run, bay: discardedInBought.bay },
      });
      const mountElArr = dom.document.createElement('div');
      dom.document.body.appendChild(mountElArr);
      const ctrlArr = new V2AppController(mountElArr as unknown as HTMLElement, {
        onSwitchToV1: () => {},
      });
      ctrlArr.init();
      await flushMicrotasks();
      mountElArr.querySelector('#v2-shop-finish')!.click();
      expect(mountElArr.querySelector('#v2-discard-ok')).toBeNull();
      expect(
        (dom.window.__STARLINE_INSPECT__?.() as { phase?: string | null } | undefined)?.phase
      ).toBe('ARRANGE');
      const savedArr = readLoadedSave(dom.window.localStorage as unknown as Storage);
      expect(savedArr.activeRun!.bay.discardedThisArrange).toHaveLength(1);
      ctrlArr.destroy();
    });

    it('C2-D2: blocks multi-tab read-only takeover race across ALL 4 discard-confirm callbacks (MAP jump, MAP safe return, ARRANGE leave, SHOP finish)', async () => {
      const triggerForeignTakeover = (): void => {
        dom.window.dispatchEvent(
          new MiniEvent('storage', {
            key: V2_TAB_LOCK_KEY,
            newValue: JSON.stringify({ tabId: 'foreign_owner_tab', updatedAt: Date.now() }),
          })
        );
      };

      const rawTut = createV2TutorialRun('tut_c2_d2');
      const batId = rawTut.bay.staging[0].item.instanceId;
      const placed = placeV2FromStaging(rawTut.bay, batId, 1, 0, 0);
      expect(placed.ok).toBe(true);
      const discarded = discardV2Item(placed.bay, `${rawTut.runId}_tut_alloy`);
      expect(discarded.ok).toBe(true);

      // 1. MAP onJumpNode
      const mapRun: V2RunState = { ...rawTut, phase: 'MAP', bay: discarded.bay };
      persistV2SaveData(dom.window.localStorage as unknown as Storage, {
        ...createFreshV2SaveData(),
        activeRun: mapRun,
      });
      dom.window.sessionStorage.setItem('starline_v2_title_entered', '1');
      const elMapJump = dom.document.createElement('div');
      dom.document.body.appendChild(elMapJump);
      const ctrlMapJump = new V2AppController(elMapJump as unknown as HTMLElement, {
        onSwitchToV1: () => {},
      });
      ctrlMapJump.init();
      await flushMicrotasks();
      elMapJump.querySelector('[data-testid="btn-jump-node"]')!.click();
      const okMapJump = elMapJump.querySelector('#v2-discard-ok');
      expect(okMapJump).not.toBeNull();
      triggerForeignTakeover();
      okMapJump!.click();
      expect(
        (dom.window.__STARLINE_INSPECT__?.() as { phase?: string | null } | undefined)?.phase
      ).toBe('MAP');
      expect(readLoadedSave(dom.window.localStorage as unknown as Storage).activeRun!.bay.discardedThisArrange).toHaveLength(1);
      ctrlMapJump.destroy();

      // 2. MAP onSafeReturn
      persistV2SaveData(dom.window.localStorage as unknown as Storage, {
        ...createFreshV2SaveData(),
        activeRun: mapRun,
      });
      const elMapSafe = dom.document.createElement('div');
      dom.document.body.appendChild(elMapSafe);
      const ctrlMapSafe = new V2AppController(elMapSafe as unknown as HTMLElement, {
        onSwitchToV1: () => {},
      });
      ctrlMapSafe.init();
      await flushMicrotasks();
      elMapSafe.querySelector('[data-testid="btn-safe-return"]')!.click();
      const okMapSafe = elMapSafe.querySelector('#v2-discard-ok');
      expect(okMapSafe).not.toBeNull();
      triggerForeignTakeover();
      okMapSafe!.click();
      expect(
        (dom.window.__STARLINE_INSPECT__?.() as { phase?: string | null } | undefined)?.phase
      ).toBe('MAP');
      expect(readLoadedSave(dom.window.localStorage as unknown as Storage).activeRun!.bay.discardedThisArrange).toHaveLength(1);
      ctrlMapSafe.destroy();

      // 3. ARRANGE onLeaveArrange
      const arrRun: V2RunState = { ...rawTut, phase: 'ARRANGE', bay: discarded.bay };
      persistV2SaveData(dom.window.localStorage as unknown as Storage, {
        ...createFreshV2SaveData(),
        activeRun: arrRun,
      });
      const elArr = dom.document.createElement('div');
      dom.document.body.appendChild(elArr);
      const ctrlArr = new V2AppController(elArr as unknown as HTMLElement, {
        onSwitchToV1: () => {},
      });
      ctrlArr.init();
      await flushMicrotasks();
      elArr.querySelector('[data-testid="btn-leave-arrange"]')!.click();
      const okArr = elArr.querySelector('#v2-discard-ok');
      expect(okArr).not.toBeNull();
      triggerForeignTakeover();
      okArr!.click();
      expect(
        (dom.window.__STARLINE_INSPECT__?.() as { phase?: string | null } | undefined)?.phase
      ).toBe('ARRANGE');
      expect(readLoadedSave(dom.window.localStorage as unknown as Storage).activeRun!.bay.discardedThisArrange).toHaveLength(1);
      ctrlArr.destroy();

      // 4. SHOP onFinish (auto-skip)
      const { run: shopBase, node: shopNode } = findFormalRunWithNodeType('merchant', 'free_salvage', 1040);
      const shopDiscarded = discardV2Item(shopBase.bay, shopBase.bay.placed[0].item.instanceId);
      expect(shopDiscarded.ok).toBe(true);
      const shopRun: V2RunState = {
        ...shopBase,
        phase: 'SHOP',
        currentNodeId: shopNode.nodeId,
        visitedNodeIds: [shopNode.nodeId],
        bay: { ...shopDiscarded.bay, staging: [] },
      };
      persistV2SaveData(dom.window.localStorage as unknown as Storage, {
        ...createFreshV2SaveData(),
        activeRun: shopRun,
      });
      const elShop = dom.document.createElement('div');
      dom.document.body.appendChild(elShop);
      const ctrlShop = new V2AppController(elShop as unknown as HTMLElement, {
        onSwitchToV1: () => {},
      });
      ctrlShop.init();
      await flushMicrotasks();
      elShop.querySelector('#v2-shop-finish')!.click();
      const okShop = elShop.querySelector('#v2-discard-ok');
      expect(okShop).not.toBeNull();
      triggerForeignTakeover();
      okShop!.click();
      expect(
        (dom.window.__STARLINE_INSPECT__?.() as { phase?: string | null } | undefined)?.phase
      ).toBe('SHOP');
      expect(readLoadedSave(dom.window.localStorage as unknown as Storage).activeRun!.bay.discardedThisArrange).toHaveLength(1);
      ctrlShop.destroy();
    });

    it('C2-D1: PreCombatAutoEngageController.engageNow() never leaves zombie countdown state on modalOpen, !canMutate, or !eligible from countdown or paused', () => {
      vi.useFakeTimers();
      let liveState = { eligible: true, canMutate: true, modalOpen: false, hidden: false };
      const onEngage = vi.fn(() => true);
      const onChange = vi.fn();

      const ctrl = new PreCombatAutoEngageController({
        durationMs: PRE_COMBAT_AUTO_ENGAGE_MS,
        onEngage,
        onChange,
        isLiveEligible: () => liveState,
      });

      // (a) From countdown + modalOpen -> transitions cleanly to paused('modal'), 0 timers, onChange emitted
      ctrl.sync({ eligible: true, nodeKey: 'n1', canMutate: true, modalOpen: false, hidden: false });
      expect(ctrl.getSnapshot().status).toBe('countdown');
      onChange.mockClear();
      liveState = { eligible: true, canMutate: true, modalOpen: true, hidden: false };
      expect(ctrl.engageNow()).toBe(false);
      expect(ctrl.getSnapshot().status).toBe('paused');
      expect(ctrl.getSnapshot().pauseReason).toBe('modal');
      expect(vi.getTimerCount()).toBe(0);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onEngage).toHaveBeenCalledTimes(0);

      // (b) From countdown + !canMutate -> transitions cleanly to paused('readonly'), 0 timers, onChange emitted
      liveState = { eligible: true, canMutate: true, modalOpen: false, hidden: false };
      ctrl.sync({ eligible: true, nodeKey: 'n2', canMutate: true, modalOpen: false, hidden: false });
      expect(ctrl.getSnapshot().status).toBe('countdown');
      onChange.mockClear();
      liveState = { eligible: true, canMutate: false, modalOpen: false, hidden: false };
      expect(ctrl.engageNow()).toBe(false);
      expect(ctrl.getSnapshot().status).toBe('paused');
      expect(ctrl.getSnapshot().pauseReason).toBe('readonly');
      expect(vi.getTimerCount()).toBe(0);
      expect(onChange).toHaveBeenCalledTimes(1);

      // (c) From countdown + !eligible -> resets cleanly to idle(nodeKey=null), 0 timers, onChange emitted
      liveState = { eligible: true, canMutate: true, modalOpen: false, hidden: false };
      ctrl.sync({ eligible: true, nodeKey: 'n3', canMutate: true, modalOpen: false, hidden: false });
      expect(ctrl.getSnapshot().status).toBe('countdown');
      onChange.mockClear();
      liveState = { eligible: false, canMutate: true, modalOpen: false, hidden: false };
      expect(ctrl.engageNow()).toBe(false);
      expect(ctrl.getSnapshot().status).toBe('idle');
      expect(ctrl.getSnapshot().nodeKey).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
      expect(onChange).toHaveBeenCalledTimes(1);

      // (d) From paused('manual') + modalOpen / !canMutate -> preserves paused('manual') without clobbering
      liveState = { eligible: true, canMutate: true, modalOpen: false, hidden: false };
      ctrl.sync({ eligible: true, nodeKey: 'n4', canMutate: true, modalOpen: false, hidden: false });
      expect(ctrl.pause('manual')).toBe(true);
      onChange.mockClear();
      liveState = { eligible: true, canMutate: true, modalOpen: true, hidden: false };
      expect(ctrl.engageNow()).toBe(false);
      expect(ctrl.getSnapshot().status).toBe('paused');
      expect(ctrl.getSnapshot().pauseReason).toBe('manual');
      expect(vi.getTimerCount()).toBe(0);
      expect(onChange).toHaveBeenCalledTimes(0);

      // (e) From paused('manual') + !eligible -> resets cleanly to idle & emits onChange
      liveState = { eligible: false, canMutate: true, modalOpen: false, hidden: false };
      expect(ctrl.engageNow()).toBe(false);
      expect(ctrl.getSnapshot().status).toBe('idle');
      expect(ctrl.getSnapshot().nodeKey).toBeNull();
      expect(onChange).toHaveBeenCalledTimes(1);
      ctrl.destroy();
    });

    it('polish & S05 integration: resets campaignBannerCollapsed on save reset, updates btn-safe-return label preserving DOM === identity, and pauses S05 on policy/gadget & triggers on wreck ambush', async () => {
      // 1. Polish: onResetV2Save resets campaignBannerCollapsed -> aria-expanded="false"
      const postTutSave = createFreshV2SaveData();
      const completedProfile = { ...postTutSave.profile, tutorialCompleted: true };
      persistV2SaveData(dom.window.localStorage as unknown as Storage, {
        ...postTutSave,
        profile: completedProfile,
      });
      dom.window.sessionStorage.setItem('starline_v2_title_entered', '1');

      const resetMount = dom.document.createElement('div');
      dom.document.body.appendChild(resetMount);
      const ctrlReset = new V2AppController(resetMount as unknown as HTMLElement, {
        onSwitchToV1: () => {},
      });
      ctrlReset.init();
      await flushMicrotasks();
      expect(
        resetMount.querySelector('[data-testid="btn-toggle-campaign-banner"]')?.getAttribute('aria-expanded')
      ).toBe('true');

      // Open settings modal and double-click #v2-btn-reset
      resetMount.querySelector('#v2-hud-settings')!.click();
      const resetBtn = resetMount.querySelector('#v2-btn-reset');
      expect(resetBtn).not.toBeNull();
      resetBtn!.click(); // arm
      resetBtn!.click(); // confirm reset
      expect(
        resetMount.querySelector('[data-testid="btn-toggle-campaign-banner"]')?.getAttribute('aria-expanded')
      ).toBe('false');
      ctrlReset.destroy();

      // 2. Polish: MapPhaseView updates btn-safe-return text on staging while preserving === identity
      const mapHost = dom.document.createElement('div');
      dom.document.body.appendChild(mapHost);
      const rawTut = createV2TutorialRun('tut_safe_label');
      const batId = rawTut.bay.staging[0].item.instanceId;
      const wired = placeV2FromStaging(rawTut.bay, batId, 1, 0, 0);
      const mapView = new MapPhaseView();
      const noopMapActions = {
        onToggleMobileMap: () => {},
        onSelectNode: () => {},
        onJumpNode: () => {},
        onUseGadget: () => {},
        onSafeReturn: () => {},
        onAbortContract: () => {},
      };
      mapView.mount(mapHost as unknown as HTMLElement);
      mapView.update(
        {
          run: { ...rawTut, phase: 'MAP', bay: wired.bay },
          readOnly: false,
          selectedMapNodeId: 'L1A',
          isCompactViewport: false,
          mobileMapShowFull: false,
          pureAutoCombat: false,
          stargateRelayTier: 0,
          fullMapReveal: false,
        },
        noopMapActions
      );
      const safeBtnBefore = mapHost.querySelector('[data-testid="btn-safe-return"]');
      expect(safeBtnBefore).not.toBeNull();
      expect(safeBtnBefore!.disabled).toBe(false);
      expect(safeBtnBefore!.textContent).toContain('免费安全返航');
      expect(safeBtnBefore!.textContent).not.toContain('需清空暂存区');

      // Update with staged item present -> same DOM node, disabled + explicit reason
      mapView.update(
        {
          run: { ...rawTut, phase: 'MAP' },
          readOnly: false,
          selectedMapNodeId: 'L1A',
          isCompactViewport: false,
          mobileMapShowFull: false,
          pureAutoCombat: false,
          stargateRelayTier: 0,
          fullMapReveal: false,
        },
        noopMapActions
      );
      const safeBtnStaged = mapHost.querySelector('[data-testid="btn-safe-return"]');
      expect(safeBtnStaged).toBe(safeBtnBefore);
      expect(safeBtnStaged!.disabled).toBe(true);
      expect(safeBtnStaged!.textContent).toContain('免费安全返航（需清空暂存区）');

      // Clear staging again -> same DOM node, reverted text
      mapView.update(
        {
          run: { ...rawTut, phase: 'MAP', bay: wired.bay },
          readOnly: false,
          selectedMapNodeId: 'L1A',
          isCompactViewport: false,
          mobileMapShowFull: false,
          pureAutoCombat: false,
          stargateRelayTier: 0,
          fullMapReveal: false,
        },
        noopMapActions
      );
      const safeBtnAfter = mapHost.querySelector('[data-testid="btn-safe-return"]');
      expect(safeBtnAfter).toBe(safeBtnBefore);
      expect(safeBtnAfter!.disabled).toBe(false);
      expect(safeBtnAfter!.textContent).toContain('免费安全返航');
      expect(safeBtnAfter!.textContent).not.toContain('需清空暂存区');
      mapView.unmount();

      // 3. S05 Controller integration: policy click + overcharge_cell gadget click pause countdown
      vi.useFakeTimers();
      const startSpy = vi.spyOn(combatV2, 'startV2CombatAtCurrentNode');
      const { run: cmbBase, node: cmbNode } = findFormalRunWithNodeType('combat', 'free_salvage', 1060);
      const overchargeGadget = createV3GadgetInstance({
        instanceId: 's05_overcharge_1',
        kind: 'overcharge_cell',
        origin: 'owned',
        acquiredDepth: 0,
        location: 'bay',
      });
      const gadgetSpot = findFirstLegalV2Placement(cmbBase.bay, overchargeGadget.definitionId);
      expect(gadgetSpot).not.toBeNull();
      const swarmUnits = buildEncounterUnits('swarm', 2, cmbNode.nodeId);
      expect(swarmUnits.length).toBeGreaterThan(1);
      const multiEnemyNode: V2MapNode = {
        ...cmbNode,
        resolved: false,
        combat: {
          encounterKind: 'swarm',
          units: swarmUnits,
          bounty: 12,
          improvedProb: 0,
        },
      };
      const policyGadgetRun: V2RunState = {
        ...cmbBase,
        phase: 'ENCOUNTER',
        currentNodeId: multiEnemyNode.nodeId,
        visitedNodeIds: [multiEnemyNode.nodeId],
        activeCombat: null,
        targetPolicy: 'weakest',
        overchargeCellActive: false,
        bay: {
          ...cmbBase.bay,
          staging: [],
          placed: [
            ...cmbBase.bay.placed,
            {
              item: overchargeGadget,
              x: gadgetSpot!.x,
              y: gadgetSpot!.y,
              rotation: gadgetSpot!.rotation,
            },
          ],
        },
        graph: {
          ...cmbBase.graph,
          nodes: { ...cmbBase.graph.nodes, [multiEnemyNode.nodeId]: multiEnemyNode },
        },
      };
      persistV2SaveData(dom.window.localStorage as unknown as Storage, {
        ...createFreshV2SaveData(),
        activeRun: policyGadgetRun,
      });
      const pgMount = dom.document.createElement('div');
      dom.document.body.appendChild(pgMount);
      const ctrlPg = new V2AppController(pgMount as unknown as HTMLElement, {
        onSwitchToV1: () => {},
      });
      ctrlPg.init();
      await flushMicrotasks();

      // Clicking policy button pauses countdown cleanly
      const policyBtn = pgMount.querySelector('[data-policy="highest_threat"]');
      expect(policyBtn).not.toBeNull();
      policyBtn!.click();
      expect(pgMount.querySelector('[data-testid="btn-pause-auto-combat"]')!.textContent).toContain('继续自动交火');
      vi.advanceTimersByTime(5000);
      expect(startSpy).toHaveBeenCalledTimes(0);

      // Resume -> clicking overcharge_cell gadget pauses countdown cleanly and activates overchargeCellActive
      pgMount.querySelector('[data-testid="btn-pause-auto-combat"]')!.click();
      expect(pgMount.querySelector('[data-testid="btn-pause-auto-combat"]')!.textContent).toContain('暂停 / 调整');
      const gadgetBtn = pgMount.querySelector('[data-testid="use-gadget-overcharge_cell"]');
      expect(gadgetBtn).not.toBeNull();
      gadgetBtn!.click();
      expect(pgMount.querySelector('[data-testid="btn-pause-auto-combat"]')!.textContent).toContain('继续自动交火');
      expect(pgMount.querySelector('[data-testid="overcharge-active-banner"]')).not.toBeNull();
      vi.advanceTimersByTime(5000);
      expect(startSpy).toHaveBeenCalledTimes(0);
      ctrlPg.destroy();

      // 4. S05 Controller integration: wreck ambush triggers pre-combat 1.5s auto-engage countdown!
      startSpy.mockClear();
      const { run: wrkBase, node: wrkNode } = findFormalRunWithNodeType('wreck', 'free_salvage', 1070);
      const ambushWreckRun: V2RunState = {
        ...wrkBase,
        phase: 'ENCOUNTER',
        currentNodeId: wrkNode.nodeId,
        visitedNodeIds: [wrkNode.nodeId],
        hp: 30,
        fuel: 8,
        activeCombat: null,
        bay: { ...wrkBase.bay, staging: [] },
        activeWreck: {
          nodeId: wrkNode.nodeId,
          stability: 60,
          maxStability: 100,
          cutsMade: 1,
          extracted: false,
          ambushTriggered: false,
          stabilizerActive: false,
          hotspots: [
            {
              spotId: 'armory',
              label: '军械舱',
              cut: true,
              riskHullDamage: 0,
              riskFuelCost: 0,
              riskAmbush: false,
            },
            {
              spotId: 'cargo',
              label: '高危货舱',
              cut: false,
              riskHullDamage: 2,
              riskFuelCost: 0,
              riskAmbush: true,
              rewardItems: [
                createV2CargoInstance({
                  instanceId: 's05_ambush_loot',
                  defId: 'cargo.alloy_bar',
                  origin: 'loot',
                  acquiredDepth: wrkNode.layer,
                  location: 'staging',
                }),
              ],
            },
          ],
        },
      };
      persistV2SaveData(dom.window.localStorage as unknown as Storage, {
        ...createFreshV2SaveData(),
        activeRun: ambushWreckRun,
      });
      const ambMount = dom.document.createElement('div');
      dom.document.body.appendChild(ambMount);
      const ctrlAmb = new V2AppController(ambMount as unknown as HTMLElement, {
        onSwitchToV1: () => {},
      });
      ctrlAmb.init();
      await flushMicrotasks();

      const cutAmbushBtn = ambMount.querySelector('[data-testid="wreck-cut-cargo"]');
      expect(cutAmbushBtn).not.toBeNull();
      cutAmbushBtn!.click();
      // S08: Advance through the 600ms plasma cut FX before ambush combat pre-view engages
      vi.advanceTimersByTime(600);

      // Ambush switched ENCOUNTER panel directly into pre-combat with 1.5s auto-engage countdown!
      const ambStartBtn = ambMount.querySelector('[data-testid="btn-start-combat"]');
      expect(ambStartBtn).not.toBeNull();
      expect(ambStartBtn!.textContent).toContain('1.5s 后自动交火');
      expect(startSpy).toHaveBeenCalledTimes(0);

      vi.advanceTimersByTime(1500);
      expect(startSpy).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(5000);
      expect(startSpy).toHaveBeenCalledTimes(1);
      ctrlAmb.destroy();
    });
  });
});
