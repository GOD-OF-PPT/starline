import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal Third-Party Phaser WebGL Stub (ONLY 'phaser' is mocked — ALL real
// project modules run untouched: PhaserHost, BaseScene, V2CombatScene,
// V2AppController, CargoGridV2Component, all 14 PhaseView classes, V2Modals,
// soundEngine, PlaytestTelemetryLogger!)
// ---------------------------------------------------------------------------
const { MOCK_SCENE_STATUS, MockPhaserScene, MockPhaserGame } = vi.hoisted(() => {
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
      for (const entry of snapshot) entry.fn.apply(entry.ctx, args);
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
    strokePath(): this {
      return this;
    }
    fillPath(): this {
      return this;
    }
    closePath(): this {
      return this;
    }
    destroy(): void {
      this.scene = null;
    }
  }

  class MockContainer extends MockDisplayObject {
    readonly list: MockDisplayObject[] = [];
    constructor(scene: MockPhaserScene, x = 0, y = 0, children: MockDisplayObject[] = []) {
      super(scene, x, y);
      this.list.push(...children);
    }
    add(child: MockDisplayObject | MockDisplayObject[]): this {
      if (Array.isArray(child)) this.list.push(...child);
      else this.list.push(child);
      return this;
    }
    removeAll(destroyChild = false): this {
      if (destroyChild) for (const c of this.list) c.destroy();
      this.list.length = 0;
      return this;
    }
  }

  class MockPhaserScene {
    readonly key: string;
    game!: MockPhaserGame;
    readonly events = new MockEventEmitter();
    readonly sys: {
      readonly settings: { status: number; active: boolean; visible: boolean };
      readonly events: MockEventEmitter;
      isActive: () => boolean;
    };
    scale: {
      width: number;
      height: number;
      on: (ev: string, fn: (...args: unknown[]) => void, ctx?: unknown) => void;
      off: (ev: string, fn?: (...args: unknown[]) => void, ctx?: unknown) => void;
    } = { width: 640, height: 360, on: () => {}, off: () => {} };
    readonly cameras = {
      main: {
        width: 640,
        height: 360,
        setViewport: () => {},
        setZoom: () => {},
        setScroll: () => {},
        centerOn: () => {},
        setBackgroundColor: () => {},
        shake: () => {},
        flash: () => {},
      },
    };
    readonly textures = {
      exists: (_key: string) => true,
      addBase64: (_key: string, _data: string) => {},
      get: (_key: string) => ({
        getSourceImage: () => ({ width: 512, height: 256 }),
      }),
    };
    readonly load = {
      image: (_key: string, _url: string) => {},
      on: (_ev: string, _fn: (...args: unknown[]) => void) => {},
      once: (_ev: string, _fn: (...args: unknown[]) => void) => {},
      start: () => {},
      isLoading: () => false,
    };
    readonly add = {
      image: (x: number, y: number, key: string) => new MockDisplayObject(this, x, y, key),
      sprite: (x: number, y: number, key: string) => new MockDisplayObject(this, x, y, key),
      text: (x: number, y: number, txt: string) => new MockDisplayObject(this, x, y, '', txt),
      graphics: () => new MockDisplayObject(this),
      container: (x = 0, y = 0, children: MockDisplayObject[] = []) =>
        new MockContainer(this, x, y, children),
      rectangle: (x = 0, y = 0, w = 10, h = 10) => {
        const obj = new MockDisplayObject(this, x, y);
        obj.setSize(w, h);
        return obj;
      },
      circle: (x = 0, y: number, r = 5) => {
        const obj = new MockDisplayObject(this, x, y);
        obj.setSize(r * 2, r * 2);
        return obj;
      },
      zone: (x = 0, y = 0, w = 10, h = 10) => {
        const obj = new MockDisplayObject(this, x, y);
        obj.setSize(w, h);
        return obj;
      },
      line: () => new MockDisplayObject(this),
    };
    readonly tweens = {
      add: (cfg: {
        onUpdate?: (tw: { getValue: () => number }) => void;
        onComplete?: () => void;
      }) => {
        const handle = {
          stop: () => {},
          remove: () => {},
          isPlaying: () => false,
        };
        if (cfg.onUpdate) cfg.onUpdate({ getValue: () => 1 });
        if (cfg.onComplete) cfg.onComplete();
        return handle;
      },
      killTweensOf: () => {},
      killAll: () => {},
    };
    readonly time = {
      delayedCall: (delay: number, cb: (...args: unknown[]) => void, args?: unknown[], scope?: unknown) => {
        let removed = false;
        const tid = globalThis.setTimeout(() => {
          if (!removed) cb.apply(scope, args ?? []);
        }, Math.max(0, delay));
        return {
          remove: () => {
            removed = true;
            globalThis.clearTimeout(tid);
          },
        };
      },
      removeAllEvents: () => {},
    };
    readonly input = {
      setDefaultCursor: () => {},
      on: () => {},
      off: () => {},
    };
    readonly scene: {
      start: (key: string, data?: unknown) => void;
      stop: (key: string) => void;
      sleep: (key: string) => void;
      wake: (key: string) => void;
      isActive: (key: string) => boolean;
      get: (key: string) => MockPhaserScene | undefined;
    };

    constructor(config: string | { readonly key: string }) {
      this.key = typeof config === 'string' ? config : config.key;
      this.sys = {
        settings: { status: MOCK_SCENE_STATUS.PENDING, active: false, visible: false },
        events: this.events,
        isActive: () => this.sys.settings.status === MOCK_SCENE_STATUS.RUNNING,
      };
      this.scene = {
        start: (k, d) => this.game?.scene.start(k, d),
        stop: (k) => this.game?.scene.stop(k),
        sleep: (k) => this.game?.scene.sleep(k),
        wake: (k) => this.game?.scene.wake(k),
        isActive: (k?: string) =>
          k !== undefined
            ? Boolean(this.game?.scene.isActive(k))
            : this.sys.settings.status === MOCK_SCENE_STATUS.RUNNING,
        get: (k) => this.game?.scene.getScene(k),
      };
    }

    attachGame(game: MockPhaserGame): void {
      this.game = game;
      this.scale = game.scale;
    }
  }

  class MockPhaserGame {
    readonly scenes = new Map<string, MockPhaserScene>();
    readonly events = new MockEventEmitter();
    readonly registryMap = new Map<string, unknown>();
    readonly registry = {
      get: (k: string) => this.registryMap.get(k),
      set: (k: string, v: unknown) => {
        this.registryMap.set(k, v);
      },
    };
    readonly loop = { rawDelta: 16 };
    readonly canvas: {
      parentElement: HTMLElement | null;
      style: Record<string, string>;
      width: number;
      height: number;
    };
    readonly scale: {
      width: number;
      height: number;
      on: (ev: string, fn: (...args: unknown[]) => void, ctx?: unknown) => void;
      off: (ev: string, fn?: (...args: unknown[]) => void, ctx?: unknown) => void;
      resize: (w: number, h: number) => void;
      refresh: () => void;
    };
    readonly scene = {
      getScene: (key: string) => this.scenes.get(key),
      isActive: (key: string) => Boolean(this.scenes.get(key)?.sys.settings.active),
      start: (key: string, data?: unknown) => {
        const sc = this.scenes.get(key);
        if (!sc) return;
        if (sc.sys.settings.status === MOCK_SCENE_STATUS.RUNNING) {
          sc.events.emit('shutdown');
        }
        sc.sys.settings.active = true;
        sc.sys.settings.visible = true;
        sc.sys.settings.status = MOCK_SCENE_STATUS.START;
        const anySc = sc as unknown as {
          init?: (d?: unknown) => void;
          preload?: () => void;
          create?: (d?: unknown) => void;
        };
        anySc.init?.(data);
        anySc.preload?.();
        sc.sys.settings.status = MOCK_SCENE_STATUS.RUNNING;
        anySc.create?.(data);
        sc.events.emit('create');
      },
      stop: (key: string) => {
        const sc = this.scenes.get(key);
        if (!sc) return;
        sc.sys.settings.active = false;
        sc.sys.settings.visible = false;
        sc.sys.settings.status = MOCK_SCENE_STATUS.SHUTDOWN;
        sc.events.emit('shutdown');
      },
      sleep: (key: string) => {
        const sc = this.scenes.get(key);
        if (!sc) return;
        sc.sys.settings.active = false;
        sc.sys.settings.visible = false;
        sc.sys.settings.status = MOCK_SCENE_STATUS.SLEEPING;
      },
      wake: (key: string) => {
        const sc = this.scenes.get(key);
        if (!sc) return;
        sc.sys.settings.active = true;
        sc.sys.settings.visible = true;
        sc.sys.settings.status = MOCK_SCENE_STATUS.RUNNING;
      },
    };

    constructor(config: {
      readonly parent?: HTMLElement;
      readonly width?: number;
      readonly height?: number;
      readonly scene?: MockPhaserScene[];
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
        refresh: () => {},
      };
      const list = config.scene ?? [];
      for (const sc of list) {
        sc.attachGame(this);
        this.scenes.set(sc.key, sc);
      }
      phaserTestHarness.lastGame = this;
      queueMicrotask(() => {
        this.events.emit('ready');
      });
    }

    destroy(_removeCanvas?: boolean): void {
      for (const key of this.scenes.keys()) {
        this.scene.stop(key);
      }
    }
  }

  const phaserTestHarness: { lastGame: MockPhaserGame | null } = { lastGame: null };
  return { MOCK_SCENE_STATUS, MockPhaserScene, MockPhaserGame, phaserTestHarness };
});

vi.mock('phaser', () => ({
  default: {
    AUTO: 0,
    CANVAS: 1,
    WEBGL: 2,
    HEADLESS: 3,
    Core: { Events: { READY: 'ready' } },
    Scale: { NONE: 0, RESIZE: 0, FIT: 1, CENTER_BOTH: 2 },
    BlendModes: { NORMAL: 0, ADD: 1, SCREEN: 2 },
    Scenes: {
      ...MOCK_SCENE_STATUS,
      Events: { SHUTDOWN: 'shutdown', DESTROY: 'destroy' },
    },
    Math: {
      Clamp: (v: number, min: number, max: number) => Math.max(min, Math.min(max, v)),
      Between: (min: number, max: number) => Math.floor((min + max) / 2),
      DegToRad: (deg: number) => (deg * Math.PI) / 180,
      RadToDeg: (rad: number) => (rad * 180) / Math.PI,
      Linear: (a: number, b: number, t: number) => a + (b - a) * t,
    },
    Scene: MockPhaserScene,
    Game: MockPhaserGame,
  },
}));

import { PhaserHost } from '../src/scenes/PhaserHost';
import { openManagedModal } from '../src/ui/Modals';
import { createV2TutorialRun } from '../src/v2/data/tutorialV2';
import { getActiveCampaignObjective } from '../src/v2/domain/campaign';
import { startV2CombatAtCurrentNode, completeV2CombatAtCurrentNode } from '../src/v2/domain/combatV2';
import {
  buildFreeFallbackPrepareSlots,
  launchV2Expedition,
  validateV2PrepareLoadout,
} from '../src/v2/domain/loadout';
import { createFreshV2SaveData, persistV2SaveData } from '../src/v2/domain/persistenceV2';
import { calculateV2Settlement } from '../src/v2/domain/settlementV2';
import { createV2CargoInstance, createV2EquipmentInstance } from '../src/v2/domain/itemCatalog';
import type {
  EndingId,
  V2CargoBayState,
  V2MapNode,
  V2ProfileState,
  V2RunState,
  V2SaveData,
} from '../src/v2/domain/types';
import { CargoGridV2Component } from '../src/v2/ui/CargoGridV2';
import { openV3CampaignModal } from '../src/v2/ui/modals/CampaignModal';
import { openV3CareerModal } from '../src/v2/ui/modals/CareerModal';
import { PLAYTEST_LOG_STORAGE_KEY } from '../src/v2/ui/playtestTelemetry';
import { ArrangePhaseView } from '../src/v2/ui/screens/ArrangeView';
import { BasePhaseView, renderBaseHeroView, updateBaseDockingNotice } from '../src/v2/ui/screens/BaseView';
import {
  CombatLivePhaseView,
  CombatPrePhaseView,
  PRE_COMBAT_AUTO_ENGAGE_MS,
  renderCombatLiveOverlay,
  renderCombatPreView,
  updateCombatPreAutoEngageUi,
} from '../src/v2/ui/screens/CombatView';
import { EndingPhaseView, renderEndingView } from '../src/v2/ui/screens/EndingView';
import { EventPhaseView, renderEventView } from '../src/v2/ui/screens/EventView';
import { MapPhaseView } from '../src/v2/ui/screens/MapView';
import { PreparePhaseView, renderPrepareView } from '../src/v2/ui/screens/PrepareView';
import { RewardPhaseView, renderRewardView } from '../src/v2/ui/screens/RewardView';
import { ManagedViewSlot, type NextBaseGoal, type PhaseView, type V2PrepareDraft } from '../src/v2/ui/screens/screenTypes';
import {
  SettlementBillRollupController,
  SettlementPhaseView,
  renderSettlementView,
} from '../src/v2/ui/screens/SettlementView';
import { ShopPhaseView, renderShopView } from '../src/v2/ui/screens/ShopView';
import { TitlePhaseView, renderTitleView } from '../src/v2/ui/screens/TitleView';
import {
  WreckOverlayPhaseView,
  WreckPhaseView,
  renderWreckHotspotOverlay,
  renderWreckLeftPanel,
} from '../src/v2/ui/screens/WreckView';
import { V2AppController } from '../src/v2/ui/V2AppController';
import {
  openV2BackupRecoveryModal,
  openV2CodexModal,
  openV2ContractsDrawerModal,
  openV2DiscardConfirmModal,
  openV2FacilitiesDrawerModal,
  openV2HelpModal,
  openV2RelicGalleryModal,
  openV2SettingsModal,
  openV2WarehouseModal,
} from '../src/v2/ui/V2Modals';

// ---------------------------------------------------------------------------
// Self-Contained Pure-JS MiniDOM with Listener Counting, Focus & Scroll
// ---------------------------------------------------------------------------
class MiniEvent {
  readonly type: string;
  readonly bubbles: boolean;
  readonly key: string;
  target: unknown = null;
  currentTarget: unknown = null;
  defaultPrevented = false;
  private stopped = false;

  constructor(type: string, init: { bubbles?: boolean; key?: string } = {}) {
    this.type = type;
    this.bubbles = init.bubbles ?? false;
    this.key = init.key ?? '';
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }
  stopPropagation(): void {
    this.stopped = true;
  }
  stopImmediatePropagation(): void {
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
  getListenerCount(type: string): number {
    return (this.listeners.get(type)?.size ?? 0) + (this.captureListeners.get(type)?.size ?? 0);
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
    const path: MiniNode[] = [];
    let cur: MiniNode | null = this;
    while (cur) {
      path.push(cur);
      cur = cur.parentNode;
    }
    for (let i = path.length - 1; i >= 0; i--) {
      const node = path[i];
      ev.currentTarget = node;
      const capSet = node.captureListeners.get(ev.type);
      if (capSet) {
        for (const fn of [...capSet]) fn(ev);
      }
      if (ev.isStopped()) return !ev.defaultPrevented;
    }
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

function decodeEntities(raw: string): string {
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
      stack[stack.length - 1].appendChild(new MiniTextNode(decodeEntities(text)));
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
          el.setAttribute(name, decodeEntities(val));
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
  let rest = sel.trim();
  if (!rest) return false;
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
  open = false;
  inert = false;
  scrollLeft = 0;
  scrollTop = 0;

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
      get: (target, prop: string) =>
        prop in target ? target[prop] : this.styleMap.get(prop) ?? '',
      set: (target, prop: string, val: unknown) => {
        if (prop in target) target[prop] = val;
        else this.styleMap.set(prop, String(val ?? ''));
        return true;
      },
    }) as Record<string, string> & { setProperty: (k: string, v: string) => void };

    this.dataset = new Proxy({} as Record<string, string | undefined>, {
      get: (_t, prop: string) => {
        const v = this.getAttribute(`data-${camelToKebab(prop)}`);
        return v === null ? undefined : v;
      },
      set: (_t, prop: string, val: unknown) => {
        if (val === undefined || val === null) this.removeAttribute(`data-${camelToKebab(prop)}`);
        else this.setAttribute(`data-${camelToKebab(prop)}`, String(val));
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
  get name(): string {
    return this.attrs.get('name') ?? '';
  }
  set name(v: string) {
    this.attrs.set('name', v);
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
    if (low === 'open') this.open = true;
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
    if (low === 'open') this.open = false;
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
  getBoundingClientRect(): DOMRect {
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
  focus(): void {
    this.doc.activeElement = this;
    this.dispatchEvent(new MiniEvent('focus', { bubbles: false }));
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
  get length(): number {
    return this.store.size;
  }
  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }
  getItem(k: string): string | null {
    return this.store.has(k) ? this.store.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, String(v));
  }
  removeItem(k: string): void {
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
    if (set) for (const fn of [...set]) fn(ev);
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
  private readonly captureListeners = new Map<string, Set<(ev: MiniEvent) => void>>();

  constructor(doc: MiniDocument, search = '') {
    this.document = doc;
    this.location = { search, href: `http://localhost:5173/${search}` };
  }
  setTimeout = (fn: (...args: unknown[]) => void, ms?: number) =>
    globalThis.setTimeout(fn, ms) as unknown as number;
  clearTimeout = (id?: number) =>
    globalThis.clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
  setInterval = (fn: (...args: unknown[]) => void, ms?: number) =>
    globalThis.setInterval(fn, ms) as unknown as number;
  clearInterval = (id?: number) =>
    globalThis.clearInterval(id as unknown as ReturnType<typeof setInterval>);
  requestAnimationFrame = (cb: (t: number) => void) =>
    globalThis.setTimeout(() => cb(Date.now()), 16) as unknown as number;
  cancelAnimationFrame = (id: number) =>
    globalThis.clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
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
    const cap = this.captureListeners.get(ev.type);
    if (cap) for (const fn of [...cap]) fn(ev);
    const set = this.listeners.get(ev.type);
    if (set) for (const fn of [...set]) fn(ev);
    return !ev.defaultPrevented;
  }
}

interface MiniDomEnv {
  readonly doc: MiniDocument;
  readonly win: MiniWindow;
  readonly mountEl: MiniElement;
  restore: () => void;
}

function installMiniDom(search = ''): MiniDomEnv {
  const prevWin = (globalThis as Record<string, unknown>).window;
  const prevDoc = (globalThis as Record<string, unknown>).document;
  const prevHTMLElement = (globalThis as Record<string, unknown>).HTMLElement;
  const prevNode = (globalThis as Record<string, unknown>).Node;
  const prevEvent = (globalThis as Record<string, unknown>).Event;
  const prevKeyboardEvent = (globalThis as Record<string, unknown>).KeyboardEvent;
  const prevStorage = (globalThis as Record<string, unknown>).localStorage;
  const prevRaf = (globalThis as Record<string, unknown>).requestAnimationFrame;
  const prevCaf = (globalThis as Record<string, unknown>).cancelAnimationFrame;

  const doc = new MiniDocument();
  const win = new MiniWindow(doc, search);
  const mountEl = doc.createElement('div');
  mountEl.id = 'app';
  doc.body.appendChild(mountEl);

  (globalThis as Record<string, unknown>).window = win;
  (globalThis as Record<string, unknown>).document = doc;
  (globalThis as Record<string, unknown>).HTMLElement = MiniElement;
  (globalThis as Record<string, unknown>).Node = MiniNode;
  (globalThis as Record<string, unknown>).Event = MiniEvent;
  (globalThis as Record<string, unknown>).KeyboardEvent = MiniEvent;
  (globalThis as Record<string, unknown>).localStorage = win.localStorage;
  (globalThis as Record<string, unknown>).requestAnimationFrame = win.requestAnimationFrame;
  (globalThis as Record<string, unknown>).cancelAnimationFrame = win.cancelAnimationFrame;

  return {
    doc,
    win,
    mountEl,
    restore: () => {
      (globalThis as Record<string, unknown>).window = prevWin;
      (globalThis as Record<string, unknown>).document = prevDoc;
      (globalThis as Record<string, unknown>).HTMLElement = prevHTMLElement;
      (globalThis as Record<string, unknown>).Node = prevNode;
      (globalThis as Record<string, unknown>).Event = prevEvent;
      (globalThis as Record<string, unknown>).KeyboardEvent = prevKeyboardEvent;
      (globalThis as Record<string, unknown>).localStorage = prevStorage;
      (globalThis as Record<string, unknown>).requestAnimationFrame = prevRaf;
      (globalThis as Record<string, unknown>).cancelAnimationFrame = prevCaf;
    },
  };
}

// ---------------------------------------------------------------------------
// Clean Brace-Depth CSS Rule Parser for Suite A Static Audits
// ---------------------------------------------------------------------------
interface ParsedCssRule {
  readonly selectors: readonly string[];
  readonly body: string;
  readonly mediaQuery: string | null;
}

function parseCssRules(rawCss: string): ParsedCssRule[] {
  const cleaned = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: ParsedCssRule[] = [];
  let i = 0;

  function parseScope(end: number, mediaQuery: string | null): void {
    let buf = '';
    while (i < end) {
      const ch = cleaned[i++];
      if (ch === '{') {
        const header = buf.trim();
        buf = '';
        if (header.startsWith('@media') || header.startsWith('@supports')) {
          parseScope(end, header);
        } else if (header.startsWith('@keyframes') || header.startsWith('@-webkit-keyframes')) {
          let depth = 1;
          while (i < end && depth > 0) {
            if (cleaned[i] === '{') depth++;
            else if (cleaned[i] === '}') depth--;
            i++;
          }
        } else {
          const bodyStart = i;
          let depth = 1;
          while (i < end && depth > 0) {
            if (cleaned[i] === '{') depth++;
            else if (cleaned[i] === '}') depth--;
            i++;
          }
          const body = cleaned.slice(bodyStart, i - 1);
          out.push({
            selectors: header
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
            body,
            mediaQuery,
          });
        }
      } else if (ch === '}') {
        return;
      } else {
        buf += ch;
      }
    }
  }

  parseScope(cleaned.length, null);
  return out;
}

const V2_APPROVED_ROOTS = [
  '.v2-shell',
  '.v2-title-host',
  '.v2-title-backdrop',
  '.v2-ending-host',
  '.v3-ending-backdrop',
  '.v2-modal-host',
  '.v2-modal-backdrop',
  '.v2-modal-card',
  '.v2-drag-ghost',
  '.v3-wreck-flip-ghost',
] as const;

function isStrictlyV2ScopedSelector(sel: string): boolean {
  const trimmed = sel.trim();
  const core = trimmed.startsWith('body.reduced-motion ')
    ? trimmed.slice('body.reduced-motion '.length).trim()
    : trimmed;
  return V2_APPROVED_ROOTS.some(
    (root) =>
      core === root ||
      core.startsWith(`${root} `) ||
      core.startsWith(`${root}.`) ||
      core.startsWith(`${root}:`) ||
      core.startsWith(`${root}[`) ||
      core.startsWith(`${root}>`)
  );
}

// ---------------------------------------------------------------------------
// Shared Fixtures for Suite B & Suite C
// ---------------------------------------------------------------------------
function makeNextGoal(ready = false): NextBaseGoal {
  return {
    title: '扩建目标：研究台 T1',
    detail: ready ? '资金已就绪（100¤）' : '还差 40¤',
    actionKind: 'facilities',
    targetCost: 100,
    ready,
  };
}

function makeRichProfile(): V2ProfileState {
  const fresh = createFreshV2SaveData().profile;
  return {
    ...fresh,
    credits: 420,
    salvageParts: 12,
    tutorialCompleted: true,
    totalRuns: 5,
    buildings: { ...fresh.buildings, workbench: true, research_lab: true },
    facilityTiers: { ...fresh.facilityTiers, workbench: 1, research_lab: 1 },
    unlockedShips: ['cannon_skiff', 'shield_cruiser'],
    unlockedCrew: ['engineer', 'salvager', 'navigator'],
    equipmentWarehouse: [
      createV2EquipmentInstance({
        instanceId: 'wh_eq_1',
        kind: 'laser',
        quality: 'improved',
        origin: 'owned',
        acquiredDepth: 1,
        location: 'warehouse',
      }),
    ],
    campaign: {
      ...fresh.campaign,
      currentAct: 'act3',
      unlockedSectors: ['near_orbit', 'frozen_graveyard', 'stargate_abyss'],
      finalMissionUnlocked: true,
      endlessUnlocked: true,
      maxEndlessThreat: 4,
    },
  };
}

function makePrepareDraft(profile: V2ProfileState): V2PrepareDraft {
  return {
    contractTemplateId: 'rescue_std',
    sectorId: 'near_orbit',
    shipId: 'cannon_skiff',
    crewId: 'engineer',
    primaryArchetype: 'laser',
    trialBuildId: null,
    playingDemo: false,
    demoPlaybackKey: null,
    slots: [...buildFreeFallbackPrepareSlots('cannon_skiff', profile.blueprints, 5)],
    missingPresetEntries: [],
    presetNotice: null,
    isFinalCampaignRun: false,
    endlessThreat: 0,
    customSeedInput: '',
    defaultSeed: 424242,
  };
}

function makeLaunchedRun(profile: V2ProfileState, seed = 9001): V2RunState {
  const slots = buildFreeFallbackPrepareSlots('cannon_skiff', profile.blueprints, 5);
  const res = launchV2Expedition({
    profile,
    contractTemplateId: 'free_salvage',
    shipId: 'cannon_skiff',
    crewId: 'engineer',
    primaryArchetype: 'laser',
    slots,
    trialBuildId: null,
    sectorId: 'near_orbit',
    seed,
  });
  expect(res.ok).toBe(true);
  return res.run!;
}

async function readRepoText(relPath: string): Promise<string> {
  const fsModuleId = 'node:fs';
  const { readFileSync } = (await import(/* @vite-ignore */ fsModuleId)) as {
    readonly readFileSync: (fileUrl: URL, encoding: string) => string;
  };
  return readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf-8');
}

function findNodeByTypeOrThrow(
  run: V2RunState,
  predicate: (n: V2MapNode) => boolean,
  label: string
): V2MapNode {
  const found = Object.values(run.graph.nodes).find(predicate);
  if (found) return found;
  throw new Error(`Expected ${label} node in launched run graph`);
}

// ===========================================================================
// SUITE A — A09 + M5-3: Industrial Terminal Skin CSS, V1 Isolation,
// Zero Capsule Pills, Modal Scoping & Art Spec §8
// ===========================================================================
describe('Suite A — A09 + M5-3 Industrial Terminal UI Skin, V1 Isolation & Art Spec §8', () => {
  let env: MiniDomEnv;

  beforeEach(() => {
    env = installMiniDom();
  });

  afterEach(() => {
    env.restore();
    vi.restoreAllMocks();
  });

  it('imports v3-terminal-skin.css in src/main.ts strictly after all V3 stylesheets and scopes 100% of CSS rules to V2/V3 roots (0 Legacy V1 leakage)', async () => {
    const mainTs = await readRepoText('src/main.ts');
    const expectedOrder = [
      "import './ui/styles.css';",
      "import './v2/ui/styles/v3-layout.css';",
      "import './v2/ui/styles/v3-campaign.css';",
      "import './v2/ui/styles/v3-combat.css';",
      "import './v2/ui/styles/v3-dismantle.css';",
      "import './v2/ui/styles/v3-buildcraft.css';",
      "import './v2/ui/styles/v3-endgame.css';",
      "import './v2/ui/styles/v3-terminal-skin.css';",
    ];
    let prevPos = -1;
    for (const stmt of expectedOrder) {
      const idx = mainTs.indexOf(stmt);
      expect(idx).toBeGreaterThan(prevPos);
      prevPos = idx;
    }

    const skinCss = await readRepoText('src/v2/ui/styles/v3-terminal-skin.css');
    const rules = parseCssRules(skinCss);
    expect(rules.length).toBeGreaterThanOrEqual(50);

    const unscoped: string[] = [];
    for (const rule of rules) {
      for (const sel of rule.selectors) {
        if (!isStrictlyV2ScopedSelector(sel)) {
          unscoped.push(sel);
        }
      }
    }
    expect(unscoped).toEqual([]);
    expect(skinCss).not.toMatch(/:root\s*\{/);

    // Tokens (--radius-sm: 2px; --radius-md: 2px;) live strictly on V2/V3 roots
    const tokenRule = rules.find((r) => r.body.includes('--radius-sm: 2px'));
    expect(tokenRule).toBeDefined();
    expect(tokenRule!.body).toContain('--radius-md: 2px');
    expect(tokenRule!.selectors).toContain('.v2-shell');
    expect(tokenRule!.selectors).toContain('.v2-modal-card');
    expect(tokenRule!.selectors).toContain('.v2-title-host');
    expect(tokenRule!.selectors).toContain('.v2-ending-host');
  });

  it('implements all A09 visual primitives, clip-path-unsafe guards, S03 layout preservation, dual-use .v3-threat-pill isolation & reduced-motion support', async () => {
    const skinCss = await readRepoText('src/v2/ui/styles/v3-terminal-skin.css');
    const rules = parseCssRules(skinCss);

    // 1. 45° chamfered corners + rivets + top highlight / recessed bevel
    expect(skinCss).toMatch(/clip-path:\s*polygon\(/);
    expect(skinCss).toMatch(/radial-gradient\(circle at 9px 9px/);
    expect(skinCss).toMatch(/inset 0 1px 0 var\(--ts-bevel-light\)/);

    // 2. Recessed CRT scanlines (4-6% opacity) + tabular-nums + technical monospace
    expect(skinCss).toMatch(/--ts-crt-scan-cyan:\s*rgba\([^)]*,\s*0\.0[456]\)/);
    expect(skinCss).toMatch(/repeating-linear-gradient\(\s*0deg,\s*var\(--ts-crt-scan-cyan\)/);
    expect(skinCss).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(skinCss).toMatch(/--ts-mono-font:/);

    // 3. Tactile physical mechanical buttons (bottom thickness edge, active press depression, inset :focus-visible)
    const btnBase = rules.find((r) => r.selectors.includes('.v2-shell .btn'));
    expect(btnBase).toBeDefined();
    expect(btnBase!.body).toMatch(/border-bottom:\s*3px solid/);

    const btnActive = rules.find((r) => r.selectors.includes('.v2-shell .btn:active:not(:disabled)'));
    expect(btnActive).toBeDefined();
    expect(btnActive!.body).toMatch(/translateY\(2px\)/);

    const btnFocus = rules.find((r) => r.selectors.includes('.v2-shell .btn:focus-visible'));
    expect(btnFocus).toBeDefined();
    expect(btnFocus!.body).toMatch(/outline-offset:\s*-3px/);
    expect(btnFocus!.body).toMatch(/box-shadow:\s*inset/);

    // Complete mechanical switch family (.btn-primary, .btn-secondary, .btn-ghost, .btn-energy, .btn-danger, .btn-launch-hero, .btn-sm)
    for (const variant of [
      '.v2-shell .btn.btn-primary',
      '.v2-shell .btn.btn-secondary',
      '.v2-shell .btn.btn-ghost',
      '.v2-shell .btn.btn-energy',
      '.v2-shell .btn.btn-danger',
      '.v2-shell .btn.btn-launch-hero',
      '.v2-shell .btn-sm',
    ]) {
      expect(rules.some((r) => r.selectors.includes(variant))).toBe(true);
    }

    // 4. Hazard zebra stripes on destructive/lethal controls (class-only specificity — ZERO #id selectors so :disabled wins!)
    const dangerBtn = rules.find((r) => r.selectors.includes('.v2-shell .btn.btn-danger'));
    expect(dangerBtn).toBeDefined();
    expect(dangerBtn!.body).toMatch(/repeating-linear-gradient\(\s*-45deg/);
    expect(dangerBtn!.selectors).toContain('.v2-modal-card .btn.btn-danger');
    const idSelectors = rules.flatMap((r) => r.selectors).filter((s) => s.includes('#'));
    expect(idSelectors).toEqual([]);

    const dangerBanner = rules.find((r) =>
      r.selectors.includes('.v2-shell .system-banner.banner-danger')
    );
    expect(dangerBanner).toBeDefined();
    expect(dangerBanner!.body).toMatch(/repeating-linear-gradient\(\s*-45deg/);
    expect(dangerBanner!.selectors).toContain('.v2-shell .v3-wreck-cut-card.is-lethal');
    expect(dangerBanner!.selectors).toContain('.v2-shell .v2-arrange-sacrifice-banner');

    // 5. Powered-off cold-metal disabled states (unlit bg + dashed border + inset shadow + saturate, NOT bare opacity)
    const disabledRule = rules.find((r) => r.selectors.includes('.v2-shell .btn:disabled'));
    expect(disabledRule).toBeDefined();
    expect(disabledRule!.body).toMatch(/border:\s*1px dashed var\(--ts-off-border\)/);
    expect(disabledRule!.body).toMatch(/filter:\s*saturate\(0\.18\)/);
    expect(disabledRule!.body).toMatch(/box-shadow:\s*inset/);
    expect(disabledRule!.selectors).toContain('.v2-modal-card .codex-card.locked');
    expect(disabledRule!.selectors).toContain('.v2-modal-card .v3-achievement-item.is-locked');

    // 6. Dual-use .v3-threat-pill isolation (ZERO bare .v2-shell .v3-threat-pill rule!)
    const bareThreatPillRules = rules.filter((r) =>
      r.selectors.some((s) => s === '.v2-shell .v3-threat-pill')
    );
    expect(bareThreatPillRules).toHaveLength(0);
    expect(rules.some((r) => r.selectors.includes('.v2-shell .v3-threat-pill.threat-lethal'))).toBe(
      true
    );
    expect(
      rules.some((r) => r.selectors.includes('.v2-shell .v3-threat-pills .v3-threat-pill'))
    ).toBe(true);

    // 7. ZERO clip-path on all 6 clip-path-unsafe selectors
    const clipPathUnsafe = [
      '.v3-wreck-compartment-pin',
      '.v2-wreck-hotspot',
      '.v2-dag-node',
      '.cargo-board-outer',
      '.v2-drag-ghost',
      '.scene-card.v3-ship-stage',
      '.v2-settle-seg-opt',
    ];
    for (const unsafe of clipPathUnsafe) {
      const clipped = rules.filter(
        (r) => r.body.includes('clip-path') && r.selectors.some((s) => s.includes(unsafe))
      );
      expect(clipped).toHaveLength(0);
    }

    // 8. Reduced-motion support in BOTH body.reduced-motion AND @media (prefers-reduced-motion: reduce)
    const bodyReducedRules = rules.filter((r) =>
      r.selectors.some((s) => s.startsWith('body.reduced-motion '))
    );
    expect(bodyReducedRules.length).toBeGreaterThanOrEqual(1);
    expect(bodyReducedRules[0].body).toMatch(/animation:\s*none !important/);
    expect(bodyReducedRules[0].body).toMatch(/transition:\s*none !important/);

    const mediaReducedRules = rules.filter(
      (r) => r.mediaQuery !== null && r.mediaQuery.includes('prefers-reduced-motion: reduce')
    );
    expect(mediaReducedRules.length).toBeGreaterThanOrEqual(1);
    expect(mediaReducedRules[0].body).toMatch(/animation:\s*none !important/);
    expect(mediaReducedRules[0].body).toMatch(/transition:\s*none !important/);
  });

  it('eliminates 100% of functional capsule pills across all 7 stylesheets + CargoGridV2 SVG while keeping only <=10px decorative LEDs circular', async () => {
    const skinCss = await readRepoText('src/v2/ui/styles/v3-terminal-skin.css');
    const skinRules = parseCssRules(skinCss);

    // Zero 99px/999px/9999px inside v3-terminal-skin.css itself
    expect(skinCss).not.toMatch(/border-radius:\s*(99|999|9999)px/);

    // Only <=10px decorative LEDs (.hud-logo-dot, .v2-hotspot-ring) may use border-radius: 50%
    const circleRules = skinRules.filter((r) => /border-radius:\s*50%/.test(r.body));
    const circleSelectors = circleRules.flatMap((r) => r.selectors);
    expect(circleSelectors).toEqual(['.v2-shell .hud-logo-dot', '.v2-shell .v2-hotspot-ring']);

    // Audit every functional 99px/999px/16px selector across styles.css + all 6 v3-*.css
    const existingFiles = [
      'src/ui/styles.css',
      'src/v2/ui/styles/v3-layout.css',
      'src/v2/ui/styles/v3-campaign.css',
      'src/v2/ui/styles/v3-combat.css',
      'src/v2/ui/styles/v3-dismantle.css',
      'src/v2/ui/styles/v3-buildcraft.css',
      'src/v2/ui/styles/v3-endgame.css',
    ];
    const allowedNonFunctional = new Set([
      '.title-edition-badge', // Legacy V1 only
      '.v2-shell .hud-logo-dot', // <= 10px LED
      '.v2-hotspot-ring', // <= 10px LED
    ]);

    const missingOverrides: string[] = [];
    let functionalCount = 0;
    for (const relPath of existingFiles) {
      const content = await readRepoText(relPath);
      const parsed = parseCssRules(content);
      for (const r of parsed) {
        if (!/border-radius:\s*(99|999|9999|50%|16px)/.test(r.body)) continue;
        for (const sel of r.selectors) {
          if (allowedNonFunctional.has(sel)) continue;
          functionalCount++;
          const lastToken = sel.split(/\s+/).slice(-1)[0];
          const needle = sel.includes('>') ? sel : lastToken;
          const overridden = skinRules.some(
            (sr) =>
              /border-radius:\s*(0|1px|2px)\b/.test(sr.body) &&
              sr.selectors.some((s) => s.includes(needle))
          );
          if (!overridden) {
            missingOverrides.push(`${relPath} :: ${sel}`);
          }
        }
      }
    }
    expect(functionalCount).toBe(57);
    expect(missingOverrides).toEqual([]);

    // CargoGridV2 SVG synergy badge uses industrial bevel (rx <= 4, NOT 14)
    const gridHost = env.doc.createElement('div');
    env.doc.body.appendChild(gridHost);
    const laser = createV2EquipmentInstance({
      instanceId: 'svg_laser',
      kind: 'laser',
      quality: 'common',
      origin: 'loan',
      acquiredDepth: 0,
      location: 'bay',
    });
    const battery = createV2EquipmentInstance({
      instanceId: 'svg_batt',
      kind: 'battery',
      quality: 'common',
      origin: 'loan',
      acquiredDepth: 0,
      location: 'bay',
    });
    const bay: V2CargoBayState = {
      shipId: 'cannon_skiff',
      placed: [
        { item: laser, x: 0, y: 0, rotation: 0 },
        { item: battery, x: 1, y: 0, rotation: 0 },
      ],
      staging: [],
      discardedThisArrange: [],
    };
    const comp = new CargoGridV2Component(gridHost as unknown as HTMLElement, {
      onBayChange: () => {},
    });
    comp.render(bay, true);
    const svgRect = gridHost.querySelector('svg rect');
    expect(svgRect).not.toBeNull();
    const rxVal = Number(svgRect!.getAttribute('rx'));
    expect(rxVal).toBeGreaterThanOrEqual(0);
    expect(rxVal).toBeLessThanOrEqual(4);
    comp.destroy();
  });

  it('scopes all V2/V3 modals with .v2-modal-backdrop/.v2-modal-card while keeping Legacy V1 openManagedModal completely untouched', () => {
    const profile = makeRichProfile();
    const modalHost = env.doc.createElement('div');
    env.doc.body.appendChild(modalHost);

    const openAndAssertV2Modal = (opener: () => void): void => {
      opener();
      const backdrop = modalHost.querySelector('.modal-backdrop');
      const card = modalHost.querySelector('.modal-card');
      expect(backdrop).not.toBeNull();
      expect(card).not.toBeNull();
      expect(backdrop!.classList.contains('v2-modal-backdrop')).toBe(true);
      expect(card!.classList.contains('v2-modal-card')).toBe(true);
      const closeBtn = card!.querySelector('.modal-close-btn');
      expect(closeBtn).not.toBeNull();
      closeBtn!.click();
    };

    openAndAssertV2Modal(() => openV2HelpModal(modalHost as unknown as HTMLElement));
    openAndAssertV2Modal(() =>
      openV2SettingsModal(modalHost as unknown as HTMLElement, createFreshV2SaveData().settings, {
        readOnly: false,
        hasV1Save: false,
        onChange: () => {},
        onResetV2Save: () => {},
        onSwitchToV1: () => {},
        onOpenMigration: () => {},
      })
    );
    openAndAssertV2Modal(() =>
      openV2FacilitiesDrawerModal(modalHost as unknown as HTMLElement, () => profile, {
        readOnly: false,
        onUpgrade: () => ({ ok: false }),
      })
    );
    openAndAssertV2Modal(() =>
      openV2WarehouseModal(modalHost as unknown as HTMLElement, () => profile, {
        readOnly: false,
        onClaimGift: () => ({ ok: false }),
        onSellGift: () => ({ ok: false }),
        onResearch: () => ({ ok: false }),
        onSellItem: () => ({ ok: false }),
        onCraft: () => ({ ok: false }),
        onUpgradeItem: () => ({ ok: false }),
        onDismantleItem: () => ({ ok: false }),
        onCraftWithParts: () => ({ ok: false }),
        onCraftGadget: () => ({ ok: false }),
        onTuneHull: () => ({ ok: false }),
      })
    );
    openAndAssertV2Modal(() =>
      openV2RelicGalleryModal(modalHost as unknown as HTMLElement, () => profile, {
        readOnly: false,
        onRestore: () => ({ ok: false }),
      })
    );
    openAndAssertV2Modal(() => openV2CodexModal(modalHost as unknown as HTMLElement, profile));
    openAndAssertV2Modal(() =>
      openV2ContractsDrawerModal(modalHost as unknown as HTMLElement, profile, {
        readOnly: false,
        onSelectContract: () => {},
        onStartTutorial: () => {},
      })
    );
    openAndAssertV2Modal(() =>
      openV3CampaignModal(modalHost as unknown as HTMLElement, () => profile, {
        readOnly: false,
        onMarkCommRead: () => {},
        onMarkCommsRead: () => {},
        onSelectSectorFromCampaign: () => {},
        onLaunchFinalMission: () => {},
        onOpenEndless: () => {},
      })
    );
    openAndAssertV2Modal(() =>
      openV3CareerModal(modalHost as unknown as HTMLElement, () => profile, {
        readOnly: false,
        onClaimAchievement: () => ({ ok: false, rewardCredits: 0, rewardParts: 0 }),
        onReplayEnding: () => {},
      })
    );
    openAndAssertV2Modal(() =>
      openV2DiscardConfirmModal(modalHost as unknown as HTMLElement, [], () => {})
    );

    // Legacy V1 modal via openManagedModal MUST NOT receive V2 modal classes
    const v1Handle = openManagedModal(modalHost as unknown as HTMLElement, {
      titleId: 'v1-test-title',
      dismissible: true,
    });
    expect(v1Handle.backdrop.classList.contains('modal-backdrop')).toBe(true);
    expect(v1Handle.card.classList.contains('modal-card')).toBe(true);
    expect(v1Handle.backdrop.classList.contains('v2-modal-backdrop')).toBe(false);
    expect(v1Handle.card.classList.contains('v2-modal-card')).toBe(false);
    v1Handle.close();

    // V2AppController shell host scoping classes
    const ctrl = new V2AppController(env.mountEl as unknown as HTMLElement, {
      onSwitchToV1: () => {},
    });
    ctrl.init();
    expect(env.mountEl.querySelector('.title-host.v2-title-host')).not.toBeNull();
    expect(env.mountEl.querySelector('.ending-host.v2-ending-host')).not.toBeNull();
    expect(env.mountEl.querySelector('.modal-host.v2-modal-host')).not.toBeNull();
    expect(env.mountEl.querySelector('.title-screen-backdrop.v2-title-backdrop')).not.toBeNull();
    ctrl.destroy();
  });

  it('revises Art Spec §8 cleanly to codify Industrial Terminal UI standard and removes legacy rounded-corner clause', async () => {
    const specText = await readRepoText('docs/星际拆解站-美术制作与验收规范.md');
    const sec8Start = specText.indexOf('## 8. UI、字体与信息层级');
    const sec9Start = specText.indexOf('## 9. 场景分层与成长表现');
    expect(sec8Start).toBeGreaterThan(0);
    expect(sec9Start).toBeGreaterThan(sec8Start);

    const sec8 = specText.slice(sec8Start, sec9Start);
    expect(sec8).not.toContain('常规控件圆角 8px，面板 12px');
    expect(sec8).toContain('舰载工业终端');
    expect(sec8).toContain('45° 切角');
    expect(sec8).toContain('CRT');
    expect(sec8).toContain('扫描线');
    expect(sec8).toContain('胶囊');
    expect(sec8).toContain('实体机械按键');
    expect(sec8).toContain('斑马条');
    expect(sec8).toContain('断电冷金属');
    expect(sec8).toContain('灰度');
    expect(sec8).toContain('prefers-reduced-motion');
  });

  it('Iter-2 CSS cascade regression: enforces zero #id selectors, real DOM class alignment, active-vs-disabled ordering, preserved (0,3,0) state variants & V2-scoped reduced-motion wildcard', async () => {
    const skinCss = await readRepoText('src/v2/ui/styles/v3-terminal-skin.css');
    const rules = parseCssRules(skinCss);
    const allSelectors = rules.flatMap((r) => r.selectors);

    // 1. R2-B1 / C1-#1: ZERO #id selectors in v3-terminal-skin.css; real modal danger buttons carry .btn.btn-danger & hover uses :hover:not(:disabled)
    expect(allSelectors.filter((s) => s.includes('#'))).toEqual([]);
    const modalHost = env.doc.createElement('div');
    env.doc.body.appendChild(modalHost);

    openV2SettingsModal(modalHost as unknown as HTMLElement, createFreshV2SaveData().settings, {
      readOnly: true,
      hasV1Save: false,
      onChange: () => {},
      onSwitchToV1: () => {},
      onResetV2Save: () => {},
    });
    const resetBtn = modalHost.querySelector('#v2-btn-reset')!;
    expect(resetBtn).not.toBeNull();
    expect(resetBtn.classList.contains('btn')).toBe(true);
    expect(resetBtn.classList.contains('btn-danger')).toBe(true);
    expect(resetBtn.disabled).toBe(true);
    modalHost.querySelector('.modal-close-btn')!.click();

    openV2DiscardConfirmModal(modalHost as unknown as HTMLElement, [], () => {});
    const discardOk = modalHost.querySelector('#v2-discard-ok')!;
    expect(discardOk.classList.contains('btn')).toBe(true);
    expect(discardOk.classList.contains('btn-danger')).toBe(true);
    modalHost.querySelector('.modal-close-btn')!.click();

    openV2BackupRecoveryModal(modalHost as unknown as HTMLElement, {
      error: 'checksum',
      hasBackup: false,
      onResetFresh: () => {},
    });
    const recFresh = modalHost.querySelector('#v2-rec-fresh')!;
    expect(recFresh.classList.contains('btn')).toBe(true);
    expect(recFresh.classList.contains('btn-danger')).toBe(true);
    recFresh.click();
    expect(modalHost.children.length).toBe(0);

    expect(
      rules.some((r) => r.selectors.includes('.v2-modal-card .btn.btn-danger:hover:not(:disabled)'))
    ).toBe(true);
    expect(
      rules.some((r) => r.selectors.some((s) => s.endsWith('.btn.btn-danger:hover')))
    ).toBe(false);

    // 2. R2-B2 + R1 note: Real DOM class alignment against MapPhaseView, CargoGridV2, CareerModal & EndingPhaseView
    expect(skinCss).not.toContain('.v3-map-dest-card.is-selected');
    expect(skinCss).not.toContain('.v2-placed-item.is-synergy');
    expect(skinCss).not.toContain('.v3-cstat-v');

    const profile = makeRichProfile();
    const run = makeLaunchedRun(profile, 8881);
    const layer1Node = Object.values(run.graph.nodes).find((n) => n.layer === 1)!;
    const mapHost = env.doc.createElement('div');
    const mapView = new MapPhaseView();
    mapView.mount(mapHost as unknown as HTMLElement);
    mapView.update(
      {
        run,
        readOnly: false,
        selectedMapNodeId: layer1Node.nodeId,
        mobileMapShowFull: false,
        isCompactViewport: false,
        pureAutoCombat: true,
      },
      {
        onToggleMobileMap: () => {},
        onSelectNode: () => {},
        onJumpNode: () => {},
        onSafeReturn: () => {},
        onAbortContract: () => {},
      }
    );
    expect(mapHost.querySelector('.v3-map-dest-card.selected')).not.toBeNull();
    mapView.unmount();

    const gridHost = env.doc.createElement('div');
    const laser = createV2EquipmentInstance({
      instanceId: 'cls_laser',
      kind: 'laser',
      quality: 'common',
      origin: 'loan',
      acquiredDepth: 0,
      location: 'bay',
    });
    const battery = createV2EquipmentInstance({
      instanceId: 'cls_batt',
      kind: 'battery',
      quality: 'common',
      origin: 'loan',
      acquiredDepth: 0,
      location: 'bay',
    });
    const gridComp = new CargoGridV2Component(gridHost as unknown as HTMLElement, {
      onBayChange: () => {},
    });
    gridComp.render(
      {
        shipId: 'cannon_skiff',
        placed: [
          { item: laser, x: 0, y: 0, rotation: 0 },
          { item: battery, x: 1, y: 0, rotation: 0 },
        ],
        staging: [],
        discardedThisArrange: [],
      },
      true
    );
    expect(gridHost.querySelector('.v2-placed-item.synergy-active .placed-subcell')).not.toBeNull();
    gridComp.destroy();

    openV3CareerModal(modalHost as unknown as HTMLElement, () => profile, {
      readOnly: false,
      onClaimAchievement: () => ({ ok: false, rewardCredits: 0, rewardParts: 0 }),
      onReplayEnding: () => {},
    });
    expect(modalHost.querySelector('.v3-cstat-card strong')).not.toBeNull();
    modalHost.querySelector('.modal-close-btn')!.click();

    const endingHost = env.doc.createElement('div');
    const endingView = new EndingPhaseView();
    endingView.mount(endingHost as unknown as HTMLElement);
    endingView.update(
      { profile, mode: 'gallery', selectedEndingId: 'free_haven', climaxRun: null, readOnly: false },
      { onSelectEnding: () => {}, onClearSelection: () => {}, onContinueToBase: () => {} }
    );
    expect(endingHost.querySelector('.v3-ending-backdrop .v3-crew-portrait')).not.toBeNull();
    endingView.unmount();

    for (const alignedSel of [
      '.v2-shell .v3-map-dest-card.selected:not(:disabled):not(.is-locked):not(.is-blocked)',
      '.v2-shell .v2-placed-item.synergy-active .placed-subcell',
      '.v2-modal-card .v2-placed-item.synergy-active .placed-subcell',
      '.v2-shell .v2-placed-item.power-cell-boosted .placed-subcell',
      '.v2-modal-card .v2-placed-item.power-cell-boosted .placed-subcell',
      '.v2-modal-card .v3-cstat-card strong',
      '.v2-ending-host .v3-crew-portrait',
      '.v3-ending-backdrop .v3-crew-portrait',
    ]) {
      expect(allSelectors).toContain(alignedSel);
    }

    // 3. R2-B3 / C1-#2: Active/selected selectors guarded with :not(:disabled):not(.is-locked) AND Powered-Off Disabled appears STRICTLY AFTER them
    const threatActiveIdx = rules.findIndex((r) =>
      r.selectors.includes('.v2-shell .v3-threat-pills .v3-threat-pill.active:not(:disabled):not(.is-locked)')
    );
    const activeMultiCueIdx = rules.findIndex((r) =>
      r.selectors.includes('.v2-shell .v2-choice-pill.active:not(:disabled):not(.is-locked)')
    );
    const disabledRuleIdx = rules.findIndex((r) =>
      r.selectors.includes('.v2-shell .btn:disabled')
    );
    expect(threatActiveIdx).toBeGreaterThan(-1);
    expect(activeMultiCueIdx).toBeGreaterThan(-1);
    expect(disabledRuleIdx).toBeGreaterThan(threatActiveIdx);
    expect(disabledRuleIdx).toBeGreaterThan(activeMultiCueIdx);
    expect(rules[disabledRuleIdx]!.selectors).toContain('.v2-shell .v2-sector-chip.sector-frozen:disabled');
    expect(rules[disabledRuleIdx]!.selectors).toContain('.v2-shell .v2-sector-chip.sector-abyss:disabled');
    expect(rules[disabledRuleIdx]!.selectors).toContain('.v2-shell .v3-mode-btn.mode-final:disabled');
    expect(rules[disabledRuleIdx]!.selectors).toContain('.v2-shell .v3-mode-btn.mode-endless:disabled');
    expect(rules[disabledRuleIdx]!.selectors).toContain('.v2-shell .v3-tactical-options .v2-et-btn:disabled');
    expect(rules[disabledRuleIdx]!.selectors).toContain('.v2-shell .v3-threat-pills .v3-threat-pill:disabled');

    // 4. R2-B4: Base modal card framing does NOT clobber border-color, and ALL explicit (0,3,0) state variants are present
    const modalCardsBase = rules.find((r) =>
      r.selectors.includes('.v2-modal-card .v2-facility-card')
    );
    expect(modalCardsBase).toBeDefined();
    expect(modalCardsBase!.body).not.toContain('border-color:');

    for (const preservedVariant of [
      '.v2-shell .v2-wreck-hotspot.active:not(:disabled)',
      '.v2-shell .v2-dag-node.current',
      '.v2-shell .v2-dag-node.selected',
      '.v2-shell .v2-dock-btn:hover:not(:disabled)',
      '.v2-shell .v2-next-goal-pill.is-ready:not(:disabled)',
      '.v2-shell .v2-next-goal-pill:hover:not(:disabled)',
      '.v2-shell .v3-event-choice-btn.is-fallback:not(:disabled):not(.is-unaffordable):not(.is-locked)',
      '.v2-shell .v3-event-choice-btn.is-crew-bonus.is-matched:not(:disabled):not(.is-unaffordable):not(.is-locked)',
      '.v2-shell .v2-delta-strip.positive',
      '.v2-shell .v2-delta-strip.negative',
      '.v2-shell .v3-wreck-stability-card.tone-warn',
      '.v2-shell .v3-sector-env-card.env-cryo_ion',
      '.v2-shell .v3-sector-env-card.env-gravity_tide',
      '.v2-shell .v3-bonus-tracker-strip.is-met',
      '.v2-shell .v3-bonus-tracker-strip.is-failed',
      '.v2-shell .v3-wreck-cut-card.is-cut',
      '.v2-modal-card .v2-facility-card.built',
      '.v2-modal-card .relic-card.restored',
      '.v2-modal-card .codex-card.seen',
      '.v2-modal-card .v3-act-card.is-active',
      '.v2-modal-card .v3-act-card.is-completed',
      '.v2-modal-card .v3-pity-cell.is-ready',
      '.v2-modal-card .v3-bestiary-card.is-boss',
      '.v2-modal-card .v3-ending-gallery-card.is-unlocked',
      '.v2-modal-card .v3-achievement-item.is-claimable',
      '.v2-modal-card .v3-achievement-item.is-claimed',
      '.v2-modal-card .v2-trial-card:hover:not(:disabled)',
      '.v2-ending-host .v3-ending-card.tone-free_haven',
      '.v3-ending-backdrop .v3-ending-card.tone-free_haven',
      '.v2-ending-host .v3-ending-card.tone-fleet_heir',
      '.v3-ending-backdrop .v3-ending-card.tone-fleet_heir',
    ]) {
      expect(allSelectors).toContain(preservedVariant);
    }

    // 5. C1-#3: @media (prefers-reduced-motion: reduce) includes V2/V3-scoped wildcard animation/transition kill
    //    AND keeps transform: none !important OFF centered pins/ticker (.v3-wreck-compartment-pin, .v2-wreck-hotspot, .v2-combat-event-ticker)
    const mediaReducedRules = rules.filter(
      (r) => r.mediaQuery !== null && r.mediaQuery.includes('prefers-reduced-motion: reduce')
    );
    const wildcardKill = mediaReducedRules.find(
      (r) => r.selectors.includes('.v2-shell *') && r.selectors.includes('.v2-modal-card *')
    );
    expect(wildcardKill).toBeDefined();
    expect(wildcardKill!.body).toMatch(/animation:\s*none !important/);
    expect(wildcardKill!.body).toMatch(/transition:\s*none !important/);
    expect(wildcardKill!.body).not.toContain('transform:');
    for (const rootWildcard of [
      '.v2-shell *',
      '.v2-shell *::before',
      '.v2-shell *::after',
      '.v2-title-host *',
      '.v2-title-backdrop *',
      '.v2-ending-host *',
      '.v3-ending-backdrop *',
      '.v2-modal-host *',
      '.v2-modal-backdrop *',
      '.v2-modal-card *',
      '.v2-drag-ghost',
      '.v2-drag-ghost *',
      '.v3-wreck-flip-ghost',
      '.v3-wreck-flip-ghost *',
    ]) {
      expect(wildcardKill!.selectors).toContain(rootWildcard);
    }

    const mediaTransformKill = mediaReducedRules.filter((r) => r.body.includes('transform:'));
    expect(mediaTransformKill.length).toBeGreaterThanOrEqual(1);
    for (const centeredEl of [
      '.v3-wreck-compartment-pin',
      '.v2-wreck-hotspot',
      '.v2-combat-event-ticker',
    ]) {
      expect(
        mediaTransformKill.some((r) => r.selectors.some((s) => s.includes(centeredEl)))
      ).toBe(false);
    }
  });
});

// ===========================================================================
// SUITE B — M5-4: Stateful PhaseView<P, A> Unit Tests for ALL 12 Newly
// Upgraded Screen Views + ManagedViewSlot + Legacy WeakMap Wrappers
// ===========================================================================
describe('Suite B — M5-4 Stateful PhaseView Lifecycle Across All 12 Upgraded Views', () => {
  let env: MiniDomEnv;

  beforeEach(() => {
    env = installMiniDom();
  });

  afterEach(() => {
    vi.useRealTimers();
    env.restore();
    vi.restoreAllMocks();
  });

  it('ManagedViewSlot mounts/unmounts strictly on key/view changes and updates in-place otherwise', () => {
    const host = env.doc.createElement('div');
    const slot = new ManagedViewSlot<'A' | 'B'>(host as unknown as HTMLElement);
    const events: string[] = [];

    const makeMockView = (label: string): PhaseView<number, string> => ({
      mount: (h) => {
        events.push(`mount:${label}`);
        const el = env.doc.createElement('div');
        el.dataset.label = label;
        h.appendChild(el as unknown as HTMLElement);
      },
      update: (p, a) => events.push(`update:${label}:${p}:${a}`),
      unmount: () => events.push(`unmount:${label}`),
    });

    const viewA = makeMockView('A');
    const viewB = makeMockView('B');

    slot.sync('A', viewA, 1, 'x');
    slot.sync('A', viewA, 2, 'y');
    slot.sync('A', viewA, 3, 'z');
    expect(slot.getActiveKey()).toBe('A');
    slot.sync('B', viewB, 4, 'w');
    expect(slot.getActiveKey()).toBe('B');
    slot.unmount(true);
    expect(slot.getActiveKey()).toBeNull();
    expect(host.children.length).toBe(0);

    expect(events).toEqual([
      'mount:A',
      'update:A:1:x',
      'update:A:2:y',
      'update:A:3:z',
      'unmount:A',
      'mount:B',
      'update:B:4:w',
      'unmount:B',
    ]);
  });

  it('TitlePhaseView preserves DOM === identity, focus, latest-action routing, migration toggle & clean unmount/remount', () => {
    const host = env.doc.createElement('div');
    env.doc.body.appendChild(host);
    const profile1 = createFreshV2SaveData().profile;
    const profile2 = makeRichProfile();

    const a1 = {
      onEnterStation: vi.fn(),
      onOpenMoreModes: vi.fn(),
      onOpenHelp: vi.fn(),
      onOpenMigration: vi.fn(),
    };
    const a2 = {
      onEnterStation: vi.fn(),
      onOpenMoreModes: vi.fn(),
      onOpenHelp: vi.fn(),
      onOpenMigration: vi.fn(),
    };

    const view = new TitlePhaseView();
    view.mount(host as unknown as HTMLElement);
    view.update({ profile: profile1, shouldOfferMigration: false }, a1);

    const root1 = host.querySelector('[data-testid="title-screen"]')!;
    const enter1 = host.querySelector('#v2-title-enter')!;
    expect(root1.classList.contains('v2-title-backdrop')).toBe(true);
    expect(host.querySelector('#v2-title-migrate')).toBeNull();
    enter1.focus();

    for (let i = 0; i < 4; i++) {
      view.update({ profile: profile2, shouldOfferMigration: true }, a2);
    }

    expect(host.querySelector('[data-testid="title-screen"]')).toBe(root1);
    expect(host.querySelector('#v2-title-enter')).toBe(enter1);
    expect(env.doc.activeElement).toBe(enter1);
    expect(enter1.textContent).toContain('继续远航');
    const migrateBtn = host.querySelector('#v2-title-migrate');
    expect(migrateBtn).not.toBeNull();

    enter1.click();
    migrateBtn!.click();
    expect(a1.onEnterStation).toHaveBeenCalledTimes(0);
    expect(a2.onEnterStation).toHaveBeenCalledTimes(1);
    expect(a2.onOpenMigration).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(host.children.length).toBe(0);
    expect(root1.getListenerCount('click')).toBe(0);
    enter1.click();
    expect(a2.onEnterStation).toHaveBeenCalledTimes(1);
    view.unmount(); // idempotent

    // Clean remount
    view.mount(host as unknown as HTMLElement);
    view.update({ profile: profile2, shouldOfferMigration: false }, a2);
    host.querySelector('#v2-title-enter')!.click();
    expect(a2.onEnterStation).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it('BasePhaseView preserves DOM ===, focus on #v3-cb-toggle, Step-0 detachment, 60fps in-place docking ticks & clean unmount', () => {
    const host = env.doc.createElement('div');
    env.doc.body.appendChild(host);
    const freshProfile = createFreshV2SaveData().profile;
    const richProfile = makeRichProfile();

    const makeBaseActions = () => ({
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
    });
    const a1 = makeBaseActions();
    const a2 = makeBaseActions();

    const view = new BasePhaseView();
    view.mount(host as unknown as HTMLElement);

    // Step-0 tutorial focus
    view.update(
      {
        profile: freshProfile,
        readOnly: false,
        nextGoal: makeNextGoal(true),
        recommendedContractId: 'rescue_std',
        activeDockingNotice: null,
        campaignBannerCollapsed: false,
        campaignObjective: getActiveCampaignObjective(freshProfile),
      },
      a1
    );

    const root1 = host.querySelector('[data-testid="base-screen"]')!;
    const cbToggle1 = host.querySelector('#v3-cb-toggle')!;
    expect(root1.classList.contains('is-tutorial-focus')).toBe(true);
    expect(host.querySelector('#v2-base-next-goal')).toBeNull();
    expect(host.querySelectorAll('.v2-dock-btn small.num')).toHaveLength(0);
    cbToggle1.focus();

    // Post-tutorial + docking notice + collapsed banner
    const notice = {
      creditsBefore: 100,
      creditsAfter: 200,
      earnedCredits: 100,
      earnedParts: 3,
      contractCompleted: true,
      unlockedText: '解锁研究台',
      crateCount: 2,
      hasKeptRelic: false,
      wasDefeat: false,
      animating: true,
      progress: 0.25,
    };
    view.update(
      {
        profile: richProfile,
        readOnly: false,
        nextGoal: makeNextGoal(true),
        recommendedContractId: 'bounty_std',
        activeDockingNotice: notice,
        campaignBannerCollapsed: true,
        campaignObjective: getActiveCampaignObjective(richProfile),
      },
      a2
    );

    expect(host.querySelector('[data-testid="base-screen"]')).toBe(root1);
    expect(host.querySelector('#v3-cb-toggle')).toBe(cbToggle1);
    expect(env.doc.activeElement).toBe(cbToggle1);
    expect(host.querySelector('#v2-base-next-goal')).not.toBeNull();
    expect(host.querySelectorAll('.v2-dock-btn small.num')).toHaveLength(5);

    const dockCard1 = host.querySelector('.docking-overlay-card')!;
    const skipDock1 = host.querySelector('#v2-skip-dock')!;
    skipDock1.focus();

    // 60fps in-place progress update via updateBaseDockingNotice preserves === & focus!
    notice.progress = 0.75;
    const patched = updateBaseDockingNotice(host as unknown as HTMLElement, notice, {
      onSkipDocking: a2.onSkipDocking,
      onCloseDocking: a2.onCloseDocking,
    });
    expect(patched).toBe(true);
    expect(host.querySelector('.docking-overlay-card')).toBe(dockCard1);
    expect(host.querySelector('#v2-skip-dock')).toBe(skipDock1);
    expect(env.doc.activeElement).toBe(skipDock1);
    expect(dockCard1.textContent).toContain('175¤');

    skipDock1.click();
    expect(a2.onSkipDocking).toHaveBeenCalledTimes(1);

    // readOnly disables launch CTA in-place
    const launchBtn = host.querySelector('#v2-base-launch-rec')!;
    view.update(
      {
        profile: richProfile,
        readOnly: true,
        nextGoal: makeNextGoal(true),
        recommendedContractId: 'bounty_std',
        activeDockingNotice: null,
        campaignBannerCollapsed: true,
        campaignObjective: getActiveCampaignObjective(richProfile),
      },
      a2
    );
    expect(host.querySelector('#v2-base-launch-rec')).toBe(launchBtn);
    expect(launchBtn.disabled).toBe(true);

    view.unmount();
    expect(host.children.length).toBe(0);
    expect(root1.getListenerCount('click')).toBe(0);
  });

  it('PreparePhaseView preserves scrollTop, #v3-endless-seed-input live preview & focus, #v2-preset-name user edits & keyed controls', () => {
    const host = env.doc.createElement('div');
    env.doc.body.appendChild(host);
    const profile = makeRichProfile();
    const draft = makePrepareDraft(profile);
    draft.endlessThreat = 2;

    const makePrepActions = () => ({
      onBack: vi.fn(),
      onPickTrial: vi.fn(),
      onExitTrial: vi.fn(),
      onSelectSector: vi.fn(),
      onSelectStandardMode: vi.fn(),
      onSelectFinalMissionMode: vi.fn(),
      onSelectEndlessMode: vi.fn(),
      onSelectEndlessThreat: vi.fn(),
      onChangeCustomSeed: vi.fn(),
      onSelectShip: vi.fn(),
      onSelectCrew: vi.fn(),
      onSelectArchetype: vi.fn(),
      onFallback: vi.fn(),
      onClear: vi.fn(),
      onAddLoan: vi.fn(),
      onAddOwned: vi.fn(),
      onSavePreset: vi.fn(),
      onLoadPreset: vi.fn(),
      onSubLoan: vi.fn(),
      onDeletePreset: vi.fn(),
      onLaunch: vi.fn(),
    });
    const a1 = makePrepActions();
    const a2 = makePrepActions();

    const validation = validateV2PrepareLoadout(
      profile,
      draft.shipId,
      draft.crewId,
      draft.slots,
      draft.trialBuildId,
      draft.sectorId
    );

    const view = new PreparePhaseView();
    view.mount(host as unknown as HTMLElement);
    view.update(
      { profile, draft, readOnly: false, validation, effectivePreviewSeed: 424242 },
      a1
    );

    const root1 = host.querySelector('[data-testid="prepare-screen"]')!;
    const scrollEl = host.querySelector('.v3-panel-scroll-body')!;
    const seedInput = host.querySelector('#v3-endless-seed-input')!;
    const presetInput = host.querySelector('#v2-preset-name')!;
    const loanBtn = host.querySelector('[data-add-loan]')!;
    scrollEl.scrollTop = 140;

    // Live seed typing updates mutator preview while keeping input identity & focus
    seedInput.focus();
    seedInput.value = '778899';
    seedInput.dispatchEvent(new MiniEvent('input', { bubbles: true }));
    expect(a1.onChangeCustomSeed).toHaveBeenCalledWith('778899');
    expect(host.querySelector('[data-testid="endless-mutator-preview"]')!.textContent).toContain(
      '#778899'
    );

    // User edits preset name, then repeated update() must NOT clobber it or scrollTop!
    presetInput.focus();
    presetInput.value = '我的王牌激光舰';
    presetInput.dispatchEvent(new MiniEvent('input', { bubbles: true }));

    for (let i = 0; i < 4; i++) {
      view.update(
        { profile, draft, readOnly: false, validation, effectivePreviewSeed: 778899 },
        a2
      );
    }

    expect(host.querySelector('[data-testid="prepare-screen"]')).toBe(root1);
    expect(host.querySelector('#v3-endless-seed-input')).toBe(seedInput);
    expect(host.querySelector('#v2-preset-name')).toBe(presetInput);
    expect(host.querySelector('[data-add-loan]')).toBe(loanBtn);
    expect(scrollEl.scrollTop).toBe(140);
    expect(env.doc.activeElement).toBe(presetInput);
    expect(presetInput.value).toBe('我的王牌激光舰');

    // Latest action routing & zero duplicate fires
    host.querySelector('#v2-preset-save')!.click();
    expect(a1.onSavePreset).toHaveBeenCalledTimes(0);
    expect(a2.onSavePreset).toHaveBeenCalledTimes(1);
    expect(a2.onSavePreset).toHaveBeenCalledWith('我的王牌激光舰');

    // readOnly disables launch CTA in-place
    const launchBtn = host.querySelector('[data-testid="btn-launch-expedition"]')!;
    view.update(
      { profile, draft, readOnly: true, validation, effectivePreviewSeed: 778899 },
      a2
    );
    expect(host.querySelector('[data-testid="btn-launch-expedition"]')).toBe(launchBtn);
    expect(launchBtn.disabled).toBe(true);

    view.unmount();
    expect(host.children.length).toBe(0);
    expect(root1.getListenerCount('click')).toBe(0);
    expect(seedInput.getListenerCount('input')).toBe(0);
    expect(presetInput.getListenerCount('input')).toBe(0);
  });

  it('CombatPrePhaseView and CombatLivePhaseView preserve DOM ===, S04/S05/S06 invariants, keyed tactical orders & clean unmount', () => {
    const preHost = env.doc.createElement('div');
    const liveHost = env.doc.createElement('div');
    env.doc.body.appendChild(preHost);
    env.doc.body.appendChild(liveHost);

    const profile = makeRichProfile();
    const run = makeLaunchedRun(profile, 2026);

    // Find a multi-enemy combat node or synthesize one cleanly on the run graph
    const singleEnemyNode: V2MapNode = {
      ...Object.values(run.graph.nodes).find((n) => Boolean(n.combat))!,
      combat: {
        ...Object.values(run.graph.nodes).find((n) => Boolean(n.combat))!.combat!,
        units: [Object.values(run.graph.nodes).find((n) => Boolean(n.combat))!.combat!.units[0]],
      },
    };
    const multiEnemyNode: V2MapNode = {
      ...singleEnemyNode,
      combat: {
        ...singleEnemyNode.combat!,
        units: [
          { ...singleEnemyNode.combat!.units[0], maxHp: 35, damagePerRound: 4 },
          {
            ...singleEnemyNode.combat!.units[0],
            enemyId: 'e_extra',
            name: '僚机护卫',
            maxHp: 30,
            damagePerRound: 3,
          },
        ],
      },
    };
    const runSingle: V2RunState = {
      ...run,
      phase: 'ENCOUNTER',
      currentNodeId: singleEnemyNode.nodeId,
      graph: { ...run.graph, nodes: { ...run.graph.nodes, [singleEnemyNode.nodeId]: singleEnemyNode } },
    };
    const runMulti: V2RunState = {
      ...run,
      phase: 'ENCOUNTER',
      currentNodeId: multiEnemyNode.nodeId,
      graph: { ...run.graph, nodes: { ...run.graph.nodes, [multiEnemyNode.nodeId]: multiEnemyNode } },
    };

    const a1 = {
      onSelectPolicy: vi.fn(),
      onToggleLog: vi.fn(),
      onUseGadget: vi.fn(),
      onTogglePauseAutoEngage: vi.fn(),
      onStartCombat: vi.fn(),
    };
    const a2 = {
      onSelectPolicy: vi.fn(),
      onToggleLog: vi.fn(),
      onUseGadget: vi.fn(),
      onTogglePauseAutoEngage: vi.fn(),
      onStartCombat: vi.fn(),
    };

    const preView = new CombatPrePhaseView();
    preView.mount(preHost as unknown as HTMLElement);
    preView.update(
      {
        run: runSingle,
        node: singleEnemyNode,
        readOnly: false,
        showCombatLogDetails: false,
        pureAutoCombat: false,
        autoEngage: {
          status: 'countdown',
          nodeKey: `${runSingle.runId}:${singleEnemyNode.nodeId}`,
          durationMs: PRE_COMBAT_AUTO_ENGAGE_MS,
          remainingMs: 1200,
          pauseReason: null,
        },
      },
      a1
    );

    const preRoot = preHost.querySelector('[data-testid="combat-screen"]')!;
    const startBtn = preHost.querySelector('[data-testid="btn-start-combat"]')!;
    const pauseBtn = preHost.querySelector('[data-testid="btn-pause-auto-combat"]')!;
    const toggleLogBtn = preHost.querySelector('[data-testid="btn-toggle-forecast-details"]')!;
    const scrollEl = preHost.querySelector('.v3-panel-scroll-body')!;
    scrollEl.scrollTop = 95;
    toggleLogBtn.focus();

    // S04: single enemy detaches .v2-policy-box; S06: details drawer detached & 0 raw HP on Layer 1
    expect(preHost.querySelector('.v2-policy-box')).toBeNull();
    expect(preHost.querySelector('[data-testid="forecast-details-drawer"]')).toBeNull();
    expect(preHost.querySelector('[data-testid="combat-threat-tier"]')!.textContent).not.toMatch(
      /余\s*\d+HP/
    );

    // 100ms countdown tick keeps startBtn & pauseBtn ===
    updateCombatPreAutoEngageUi(
      preHost as unknown as HTMLElement,
      {
        status: 'countdown',
        nodeKey: `${runSingle.runId}:${singleEnemyNode.nodeId}`,
        durationMs: PRE_COMBAT_AUTO_ENGAGE_MS,
        remainingMs: 700,
        pauseReason: null,
      },
      false
    );
    expect(preHost.querySelector('[data-testid="btn-start-combat"]')).toBe(startBtn);
    expect(preHost.querySelector('[data-testid="btn-pause-auto-combat"]')).toBe(pauseBtn);
    expect(startBtn.textContent).toContain('0.7s');

    // Expand details drawer + switch to multi-enemy preserves DOM ===, focus & scrollTop
    preView.update(
      {
        run: runMulti,
        node: multiEnemyNode,
        readOnly: false,
        showCombatLogDetails: true,
        pureAutoCombat: false,
        autoEngage: {
          status: 'paused',
          nodeKey: `${runMulti.runId}:${multiEnemyNode.nodeId}`,
          durationMs: PRE_COMBAT_AUTO_ENGAGE_MS,
          remainingMs: 700,
          pauseReason: 'details',
        },
      },
      a2
    );

    expect(preHost.querySelector('[data-testid="combat-screen"]')).toBe(preRoot);
    expect(preHost.querySelector('[data-testid="btn-toggle-forecast-details"]')).toBe(toggleLogBtn);
    expect(env.doc.activeElement).toBe(toggleLogBtn);
    expect(scrollEl.scrollTop).toBe(95);
    expect(preHost.querySelector('.v2-policy-box')).not.toBeNull();
    expect(preHost.querySelector('[data-testid="forecast-details-drawer"]')).not.toBeNull();

    startBtn.click();
    expect(a1.onStartCombat).toHaveBeenCalledTimes(0);
    expect(a2.onStartCombat).toHaveBeenCalledTimes(1);

    preView.update(
      {
        run: runMulti,
        node: multiEnemyNode,
        readOnly: true,
        showCombatLogDetails: true,
        pureAutoCombat: false,
      },
      a2
    );
    expect(startBtn.disabled).toBe(true);
    preView.unmount();
    expect(preHost.children.length).toBe(0);
    expect(preRoot.getListenerCount('click')).toBe(0);

    // CombatLivePhaseView
    const combatStart = startV2CombatAtCurrentNode(runMulti, 'weakest', {
      enableTacticalCommands: true,
      pureAutoCombat: false,
    });
    expect(combatStart.ok).toBe(true);
    const liveRun = combatStart.run;
    const sim = liveRun.activeCombat!.simulation;
    const liveA1 = {
      onPeekBay: vi.fn(),
      onToggleSpeed: vi.fn(),
      onSkipPlayback: vi.fn(),
      onCommitEliteTactic: vi.fn(),
    };
    const liveA2 = {
      onPeekBay: vi.fn(),
      onToggleSpeed: vi.fn(),
      onSkipPlayback: vi.fn(),
      onCommitEliteTactic: vi.fn(),
    };

    const liveView = new CombatLivePhaseView();
    liveView.mount(liveHost as unknown as HTMLElement);
    liveView.update(
      {
        run: liveRun,
        liveCombatRound: 1,
        liveCombatPlayerHp: sim.startingPlayerHp,
        liveCombatPlayerShield: sim.startingPlayerShield,
        liveCombatEnemiesAlive: sim.initialEnemies.length,
        liveCombatEventLine: '第 1 轮交火',
        liveEnemySnapshots: sim.initialEnemies,
        livePhaseBannerText: null,
        awaitingEliteDecision: true,
        combatSpeed: 1,
      },
      liveA1
    );

    const liveRoot = liveHost.querySelector('[data-testid="combat-screen"]')!;
    const speedBtn = liveHost.querySelector('#v2-combat-speed')!;
    const skipBtn = liveHost.querySelector('[data-testid="btn-combat-skip"]')!;
    const shieldOrderBtn = liveHost.querySelector('[data-testid="tactical-order-emergency_shield"]')!;
    expect(shieldOrderBtn).not.toBeNull();
    expect(shieldOrderBtn.textContent).not.toMatch(/余\s*\d+HP/);
    speedBtn.focus();

    for (let r = 1; r <= 3; r++) {
      liveView.update(
        {
          run: liveRun,
          liveCombatRound: r,
          liveCombatPlayerHp: Math.max(1, sim.startingPlayerHp - r),
          liveCombatPlayerShield: 0,
          liveCombatEnemiesAlive: sim.initialEnemies.length,
          liveCombatEventLine: `第 ${r} 轮交火`,
          liveEnemySnapshots: sim.initialEnemies,
          livePhaseBannerText: null,
          awaitingEliteDecision: true,
          combatSpeed: 2,
        },
        liveA2
      );
    }

    expect(liveHost.querySelector('[data-testid="combat-screen"]')).toBe(liveRoot);
    expect(liveHost.querySelector('#v2-combat-speed')).toBe(speedBtn);
    expect(liveHost.querySelector('[data-testid="btn-combat-skip"]')).toBe(skipBtn);
    expect(liveHost.querySelector('[data-testid="tactical-order-emergency_shield"]')).toBe(
      shieldOrderBtn
    );
    expect(env.doc.activeElement).toBe(speedBtn);

    speedBtn.click();
    shieldOrderBtn.click();
    expect(liveA1.onToggleSpeed).toHaveBeenCalledTimes(0);
    expect(liveA2.onToggleSpeed).toHaveBeenCalledTimes(1);
    expect(liveA2.onCommitEliteTactic).toHaveBeenCalledTimes(1);

    liveView.unmount();
    expect(liveHost.children.length).toBe(0);
    expect(liveRoot.getListenerCount('click')).toBe(0);
  });

  it('WreckOverlayPhaseView and WreckPhaseView preserve pin/card DOM === across closed->cutting->cutaway and single-fire skip clicks', () => {
    const ovHost = env.doc.createElement('div');
    const leftHost = env.doc.createElement('div');
    env.doc.body.appendChild(ovHost);
    env.doc.body.appendChild(leftHost);

    const tutRun = createV2TutorialRun('wreck_unit_run');
    const wreckNode = Object.values(tutRun.graph.nodes).find((n) => n.type === 'wreck')!;
    const wreckRun: V2RunState = {
      ...tutRun,
      phase: 'ENCOUNTER',
      currentNodeId: wreckNode.nodeId,
    };

    const ovA1 = { onSelectHotspot: vi.fn(), onCutHotspot: vi.fn(), onSkipCut: vi.fn() };
    const ovA2 = { onSelectHotspot: vi.fn(), onCutHotspot: vi.fn(), onSkipCut: vi.fn() };
    const leftA1 = {
      onSelectHotspot: vi.fn(),
      onCutSpot: vi.fn(),
      onSkipCut: vi.fn(),
      onExtract: vi.fn(),
      onAbandon: vi.fn(),
    };
    const leftA2 = {
      onSelectHotspot: vi.fn(),
      onCutSpot: vi.fn(),
      onSkipCut: vi.fn(),
      onExtract: vi.fn(),
      onAbandon: vi.fn(),
    };

    const ovView = new WreckOverlayPhaseView();
    const leftView = new WreckPhaseView();
    ovView.mount(ovHost as unknown as HTMLElement);
    leftView.mount(leftHost as unknown as HTMLElement);

    // Closed state
    ovView.update(
      { run: wreckRun, node: wreckNode, readOnly: false, selectedHotspot: 'armory', cuttingSpotId: null },
      ovA1
    );
    leftView.update(
      { run: wreckRun, node: wreckNode, readOnly: false, selectedHotspot: 'armory', cuttingSpotId: null },
      leftA1
    );

    // Overlay strictly omits data-testid="wreck-screen"!
    expect(ovHost.querySelector('[data-testid="wreck-screen"]')).toBeNull();
    expect(leftHost.querySelector('[data-testid="wreck-screen"]')).not.toBeNull();

    const pin1 = ovHost.querySelector('[data-testid="wreck-spot-armory"]')!;
    const cardBtn1 = leftHost.querySelector('[data-testid="wreck-cut-armory"]')!;
    const extractBtn1 = leftHost.querySelector('[data-testid="btn-wreck-extract"]')!;
    const scrollEl = leftHost.querySelector('.v3-panel-scroll-body')!;
    scrollEl.scrollTop = 110;
    expect(pin1.querySelectorAll('.v3-clamp-bracket')).toHaveLength(2);
    expect(ovHost.querySelector('[data-testid="btn-skip-wreck-cut"]')).toBeNull();

    // Cutting state
    ovView.update(
      { run: wreckRun, node: wreckNode, readOnly: false, selectedHotspot: 'armory', cuttingSpotId: 'armory' },
      ovA2
    );
    leftView.update(
      { run: wreckRun, node: wreckNode, readOnly: false, selectedHotspot: 'armory', cuttingSpotId: 'armory' },
      leftA2
    );

    expect(ovHost.querySelector('[data-testid="wreck-spot-armory"]')).toBe(pin1);
    expect(pin1.dataset.compartmentState).toBe('cutting');
    expect(leftHost.querySelector('[data-testid="wreck-cut-armory"]')).toBe(cardBtn1);
    expect(leftHost.querySelector('[data-testid="btn-wreck-extract"]')).toBe(extractBtn1);
    expect(cardBtn1.disabled).toBe(true);
    expect(scrollEl.scrollTop).toBe(110);

    // Clicking skip button while cutting triggers onSkipCut strictly ONCE (zero double-fire!)
    const skipBtn = ovHost.querySelector('[data-testid="btn-skip-wreck-cut"]')!;
    skipBtn.click();
    expect(ovA1.onSkipCut).toHaveBeenCalledTimes(0);
    expect(ovA2.onSkipCut).toHaveBeenCalledTimes(1);

    // Modal cancel recovery back to closed state keeps pin === & detaches skip bar
    ovView.update(
      { run: wreckRun, node: wreckNode, readOnly: false, selectedHotspot: 'armory', cuttingSpotId: null },
      ovA2
    );
    expect(ovHost.querySelector('[data-testid="wreck-spot-armory"]')).toBe(pin1);
    expect(pin1.dataset.compartmentState).toBe('closed');
    expect(ovHost.querySelector('[data-testid="btn-skip-wreck-cut"]')).toBeNull();

    ovView.unmount();
    leftView.unmount();
    expect(ovHost.children.length).toBe(0);
    expect(leftHost.children.length).toBe(0);
  });

  it('EventPhaseView, ShopPhaseView and RewardPhaseView preserve DOM ===, keyed controls, readOnly & clean unmount', () => {
    const profile = makeRichProfile();
    const run = makeLaunchedRun(profile, 3131);

    // --- EventPhaseView ---
    const evHost = env.doc.createElement('div');
    env.doc.body.appendChild(evHost);
    const eventNode = findNodeByTypeOrThrow(
      run,
      (n) => n.type === 'anomaly' || n.type === 'distress',
      'event'
    );
    const evRun: V2RunState = {
      ...run,
      phase: 'ENCOUNTER',
      currentNodeId: eventNode.nodeId,
      graph: { ...run.graph, nodes: { ...run.graph.nodes, [eventNode.nodeId]: eventNode } },
    };
    const evA1 = {
      onSelectEventOption: vi.fn(),
      onAnomalyChoice: vi.fn(),
      onDistressChoice: vi.fn(),
      onAbandon: vi.fn(),
    };
    const evA2 = {
      onSelectEventOption: vi.fn(),
      onAnomalyChoice: vi.fn(),
      onDistressChoice: vi.fn(),
      onAbandon: vi.fn(),
    };
    const evView = new EventPhaseView();
    evView.mount(evHost as unknown as HTMLElement);
    evView.update({ run: evRun, node: eventNode, readOnly: false }, evA1);
    const evRoot = evHost.querySelector('[data-testid="event-screen"]')!;
    const enabledChoice = evHost
      .querySelectorAll('[data-event-option]')
      .find((b) => !b.disabled)!;
    expect(enabledChoice).toBeDefined();
    const enabledTestId = enabledChoice.dataset.testid!;
    enabledChoice.focus();
    evView.update({ run: evRun, node: eventNode, readOnly: false }, evA2);
    expect(evHost.querySelector('[data-testid="event-screen"]')).toBe(evRoot);
    expect(evHost.querySelector(`[data-testid="${enabledTestId}"]`)).toBe(enabledChoice);
    expect(env.doc.activeElement).toBe(enabledChoice);
    enabledChoice.click();
    expect(evA1.onSelectEventOption).toHaveBeenCalledTimes(0);
    expect(evA2.onSelectEventOption).toHaveBeenCalledTimes(1);
    evView.update({ run: evRun, node: eventNode, readOnly: true }, evA2);
    expect(enabledChoice.disabled).toBe(true);
    evView.unmount();
    expect(evHost.children.length).toBe(0);
    expect(evRoot.getListenerCount('click')).toBe(0);

    // --- ShopPhaseView ---
    const shopHost = env.doc.createElement('div');
    env.doc.body.appendChild(shopHost);
    const shopNode = findNodeByTypeOrThrow(
      run,
      (n) => n.type === 'merchant' && Boolean(n.merchant),
      'merchant'
    );
    const lootCargo = createV2CargoInstance({
      instanceId: 'loot_c1',
      defId: 'cargo.data_box',
      origin: 'loot',
      acquiredDepth: 1,
      location: 'staging',
    });
    const shopRun: V2RunState = {
      ...run,
      phase: 'SHOP',
      wallet: 300,
      currentNodeId: shopNode.nodeId,
      bay: { ...run.bay, staging: [{ item: lootCargo, rotation: 0 }] },
      graph: { ...run.graph, nodes: { ...run.graph.nodes, [shopNode.nodeId]: shopNode } },
    };
    const shA1 = {
      onBuyOffer: vi.fn(),
      onBuyFuel: vi.fn(),
      onBuyRepair: vi.fn(),
      onSellLoot: vi.fn(),
      onEngineerSwap: vi.fn(),
      onFinish: vi.fn(),
    };
    const shA2 = {
      onBuyOffer: vi.fn(),
      onBuyFuel: vi.fn(),
      onBuyRepair: vi.fn(),
      onSellLoot: vi.fn(),
      onEngineerSwap: vi.fn(),
      onFinish: vi.fn(),
    };
    const shView = new ShopPhaseView();
    shView.mount(shopHost as unknown as HTMLElement);
    shView.update({ run: shopRun, node: shopNode, readOnly: false, starportGuildRep: 120 }, shA1);
    const shRoot = shopHost.querySelector('[data-testid="shop-screen"]')!;
    const sellBtn = shopHost.querySelector('[data-sell-loot="loot_c1"]')!;
    const finishBtn = shopHost.querySelector('#v2-shop-finish')!;
    sellBtn.focus();

    // Moving loot from staging to placed during SHOP keeps sell row DOM ===!
    const shopRunDragged: V2RunState = {
      ...shopRun,
      bay: {
        ...shopRun.bay,
        staging: [],
        placed: [...shopRun.bay.placed, { item: lootCargo, x: 2, y: 2, rotation: 0 }],
      },
    };
    shView.update(
      { run: shopRunDragged, node: shopNode, readOnly: false, starportGuildRep: 120 },
      shA2
    );
    expect(shopHost.querySelector('[data-testid="shop-screen"]')).toBe(shRoot);
    expect(shopHost.querySelector('[data-sell-loot="loot_c1"]')).toBe(sellBtn);
    expect(shopHost.querySelector('#v2-shop-finish')).toBe(finishBtn);
    expect(env.doc.activeElement).toBe(sellBtn);
    sellBtn.click();
    expect(shA1.onSellLoot).toHaveBeenCalledTimes(0);
    expect(shA2.onSellLoot).toHaveBeenCalledTimes(1);
    shView.unmount();
    expect(shopHost.children.length).toBe(0);
    expect(shRoot.getListenerCount('click')).toBe(0);

    // --- RewardPhaseView ---
    const rewHost = env.doc.createElement('div');
    env.doc.body.appendChild(rewHost);
    const combatNode = Object.values(run.graph.nodes).find((n) => Boolean(n.combat))!;
    const started = startV2CombatAtCurrentNode(
      { ...run, phase: 'ENCOUNTER', currentNodeId: combatNode.nodeId },
      'weakest',
      { enableTacticalCommands: false, pureAutoCombat: true }
    );
    const completed = completeV2CombatAtCurrentNode(
      started.run,
      profile.unlockedFamilies,
      started.run.recentEquipmentKinds
    );
    const rewRun = completed.run;
    expect(rewRun.pendingReward).not.toBeNull();
    const rewA1 = { onPickReward: vi.fn() };
    const rewA2 = { onPickReward: vi.fn() };
    const rewView = new RewardPhaseView();
    rewView.mount(rewHost as unknown as HTMLElement);
    rewView.update({ run: rewRun, readOnly: false }, rewA1);
    const rewRoot = rewHost.querySelector('[data-testid="reward-screen"]')!;
    const eqCard = rewHost.querySelector('[data-pick-reward="equipment"]')!;
    eqCard.focus();
    rewView.update({ run: rewRun, readOnly: false }, rewA2);
    expect(rewHost.querySelector('[data-testid="reward-screen"]')).toBe(rewRoot);
    expect(rewHost.querySelector('[data-pick-reward="equipment"]')).toBe(eqCard);
    expect(env.doc.activeElement).toBe(eqCard);
    eqCard.click();
    expect(rewA1.onPickReward).toHaveBeenCalledTimes(0);
    expect(rewA2.onPickReward).toHaveBeenCalledTimes(1);
    expect(rewA2.onPickReward).toHaveBeenCalledWith('equipment');
    rewView.unmount();
    expect(rewHost.children.length).toBe(0);
    expect(rewRoot.getListenerCount('click')).toBe(0);
  });

  it('SettlementPhaseView preserves active bill rollup, <details> open state, S09 button budget, single-fire radios & clean unmount', () => {
    vi.useFakeTimers();
    const host = env.doc.createElement('div');
    env.doc.body.appendChild(host);

    const profile = makeRichProfile();
    const baseRun = makeLaunchedRun(profile, 4141);
    const lootEq = createV2EquipmentInstance({
      instanceId: 'settle_loot_eq',
      kind: 'shield',
      quality: 'common',
      origin: 'loot',
      acquiredDepth: 1,
      location: 'bay',
    });
    const lootCargo = createV2CargoInstance({
      instanceId: 'settle_loot_cargo',
      defId: 'cargo.data_box',
      origin: 'loot',
      acquiredDepth: 1,
      location: 'bay',
    });
    const missionReactor = createV2CargoInstance({
      instanceId: 'settle_mission_reactor',
      defId: 'mission.sealed_reactor',
      origin: 'mission',
      acquiredDepth: 1,
      location: 'bay',
    });
    const settleRun: V2RunState = {
      ...baseRun,
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
      wallet: 60,
      bay: {
        ...baseRun.bay,
        placed: [
          ...baseRun.bay.placed,
          { item: lootEq, x: 2, y: 2, rotation: 0 },
          { item: lootCargo, x: 3, y: 2, rotation: 0 },
          { item: missionReactor, x: 0, y: 1, rotation: 0 },
        ],
      },
    };
    const summary1 = calculateV2Settlement(settleRun, profile, {});
    const actions1 = {
      onChangeDisposition: vi.fn(),
      onShowcaseRetry: vi.fn(),
      onShowcaseToBase: vi.fn(),
      onConfirmSettlement: vi.fn(),
      onSkipRollup: vi.fn(),
    };

    const view = new SettlementPhaseView();
    view.mount(host as unknown as HTMLElement);
    view.update(
      { run: settleRun, profile, summary: summary1, nextGoal: makeNextGoal(), readOnly: false },
      actions1
    );

    const root1 = host.querySelector('[data-testid="settlement-screen"]')!;
    const scrollEl = host.querySelector('.v3-panel-scroll-body')!;
    const loanDetails = host.querySelector('[data-testid="settlement-loan-summary"]')!;
    const confirmBtn = host.querySelector('[data-testid="btn-confirm-settlement"]')!;
    scrollEl.scrollTop = 88;
    loanDetails.open = true;

    // S09 button budget: total <button> count <= decisionLines + 1
    const decisionCount = summary1.lines.filter((l) => l.allowedDispositions.length > 1).length;
    expect(host.querySelectorAll('button').length).toBeLessThanOrEqual(decisionCount + 1);
    expect(host.querySelector('[data-testid="settlement-auto-resolved"]')!.querySelectorAll('button')).toHaveLength(0);
    expect(loanDetails.querySelectorAll('button')).toHaveLength(0);

    // Start live rollup and verify unchanged-summary update() preserves rollup DOM refs!
    const rollup = new SettlementBillRollupController();
    rollup.start(host as unknown as HTMLElement, summary1.finalCreditsEarned, false);
    expect(rollup.isActive()).toBe(true);
    const totalElBefore = host.querySelector('[data-testid="settlement-total-credits"]')!;
    expect(totalElBefore.textContent).toBe('+0¤');

    // Unchanged totals update (e.g. readOnly flip) must NOT detach totalEl or kill rollup!
    view.update(
      { run: settleRun, profile, summary: summary1, nextGoal: makeNextGoal(), readOnly: true },
      actions1
    );
    expect(host.querySelector('[data-testid="settlement-total-credits"]')).toBe(totalElBefore);
    expect(confirmBtn.disabled).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(rollup.isActive()).toBe(false);
    expect(totalElBefore.textContent).toBe(`+${summary1.finalCreditsEarned}¤`);

    // Restore interactive mode & verify single-fire 3-option segmented radio <label> + <input> + change!
    view.update(
      { run: settleRun, profile, summary: summary1, nextGoal: makeNextGoal(), readOnly: false },
      actions1
    );
    const dismantleLabel = host.querySelector(`[data-testid="btn-dismantle-${lootEq.instanceId}"]`)!;
    const dismantleRadio = dismantleLabel.querySelector('input[data-settle-radio]')!;
    dismantleRadio.focus();

    // Simulate label click + synthetic bubbled input click + change event -> strictly 1 callback!
    const clickEv = new MiniEvent('click', { bubbles: true });
    dismantleLabel.dispatchEvent(clickEv);
    expect(clickEv.defaultPrevented).toBe(true);
    dismantleRadio.checked = true;
    dismantleRadio.dispatchEvent(new MiniEvent('change', { bubbles: true }));
    expect(actions1.onChangeDisposition).toHaveBeenCalledTimes(1);
    expect(actions1.onChangeDisposition).toHaveBeenCalledWith(lootEq.instanceId, 'dismantle');

    // Applying updated summary preserves <details> open state, scrollTop, focus, and label DOM ===!
    const summary2 = calculateV2Settlement(settleRun, profile, { [lootEq.instanceId]: 'dismantle' });
    view.update(
      { run: settleRun, profile, summary: summary2, nextGoal: makeNextGoal(), readOnly: false },
      actions1
    );
    expect(host.querySelector('[data-testid="settlement-loan-summary"]')).toBe(loanDetails);
    expect(loanDetails.open).toBe(true);
    expect(scrollEl.scrollTop).toBe(88);
    expect(host.querySelector(`[data-testid="btn-dismantle-${lootEq.instanceId}"]`)).toBe(
      dismantleLabel
    );
    expect(env.doc.activeElement).toBe(dismantleRadio);

    view.unmount();
    expect(host.children.length).toBe(0);
    expect(root1.getListenerCount('click')).toBe(0);
    expect(root1.getListenerCount('change')).toBe(0);
  });

  it('EndingPhaseView preserves outer backdrop & .v3-ending-bg === across Stage 1 Choice <-> Stage 2 Epilogue and cleans up on unmount', () => {
    const host = env.doc.createElement('div');
    env.doc.body.appendChild(host);
    const profile = makeRichProfile();
    const a1 = {
      onSelectEnding: vi.fn(),
      onClearSelection: vi.fn(),
      onContinueToBase: vi.fn(),
    };
    const a2 = {
      onSelectEnding: vi.fn(),
      onClearSelection: vi.fn(),
      onContinueToBase: vi.fn(),
    };

    const view = new EndingPhaseView();
    view.mount(host as unknown as HTMLElement);
    view.update(
      { profile, mode: 'climax', selectedEndingId: null, climaxRun: null, readOnly: false },
      a1
    );

    const backdrop1 = host.querySelector('[data-testid="ending-screen"]')!;
    const bg1 = host.querySelector('.v3-ending-bg')!;
    const choiceBtn = host.querySelector('[data-testid="ending-choice-stargate_reignited"]')!;
    choiceBtn.click();
    expect(a1.onSelectEnding).toHaveBeenCalledWith('stargate_reignited');

    // Stage 1 -> Stage 2 preserves backdrop & bg ===!
    view.update(
      {
        profile,
        mode: 'climax',
        selectedEndingId: 'stargate_reignited' as EndingId,
        climaxRun: null,
        readOnly: false,
      },
      a2
    );
    expect(host.querySelector('[data-testid="ending-screen"]')).toBe(backdrop1);
    expect(host.querySelector('.v3-ending-bg')).toBe(bg1);
    const rechooseBtn = host.querySelector('#v3-btn-ending-rechoose')!;
    const continueBtn = host.querySelector('[data-testid="btn-ending-continue"]')!;
    rechooseBtn.click();
    continueBtn.click();
    expect(a2.onClearSelection).toHaveBeenCalledTimes(1);
    expect(a2.onContinueToBase).toHaveBeenCalledTimes(1);

    // Stage 2 -> Stage 1 rechoose preserves backdrop & bg ===!
    view.update(
      { profile, mode: 'climax', selectedEndingId: null, climaxRun: null, readOnly: true },
      a2
    );
    expect(host.querySelector('[data-testid="ending-screen"]')).toBe(backdrop1);
    expect(host.querySelector('.v3-ending-bg')).toBe(bg1);
    expect(host.querySelector('[data-testid="ending-choice-stargate_reignited"]')!.disabled).toBe(
      true
    );

    view.unmount();
    expect(host.children.length).toBe(0);
    expect(backdrop1.getListenerCount('click')).toBe(0);
  });

  it('keeps all 12 backward-compatible render* WeakMap wrappers reusing their mounted PhaseView DOM roots (===)', () => {
    const profile = makeRichProfile();
    const run = makeLaunchedRun(profile, 5151);
    const draft = makePrepareDraft(profile);
    const validation = validateV2PrepareLoadout(
      profile,
      draft.shipId,
      draft.crewId,
      draft.slots,
      draft.trialBuildId,
      draft.sectorId
    );
    const combatNode = Object.values(run.graph.nodes).find((n) => Boolean(n.combat))!;
    const tutRun = createV2TutorialRun('compat_tut');
    const wreckNode = Object.values(tutRun.graph.nodes).find((n) => n.type === 'wreck')!;
    const eventNode = findNodeByTypeOrThrow(
      run,
      (n) => n.type === 'anomaly' || n.type === 'distress',
      'event'
    );
    const shopNode = findNodeByTypeOrThrow(
      run,
      (n) => n.type === 'merchant' && Boolean(n.merchant),
      'merchant'
    );

    const assertWrapperReusesRoot = (fn: (host: HTMLElement) => void): void => {
      const h = env.doc.createElement('div');
      env.doc.body.appendChild(h);
      fn(h as unknown as HTMLElement);
      const firstRoot = h.children[0];
      expect(firstRoot).toBeDefined();
      fn(h as unknown as HTMLElement);
      expect(h.children[0]).toBe(firstRoot);
    };

    assertWrapperReusesRoot((h) =>
      renderTitleView(
        h,
        { profile, shouldOfferMigration: false },
        { onEnterStation: () => {}, onOpenMoreModes: () => {}, onOpenHelp: () => {}, onOpenMigration: () => {} }
      )
    );
    assertWrapperReusesRoot((h) =>
      renderBaseHeroView(
        h,
        {
          profile,
          readOnly: false,
          nextGoal: makeNextGoal(),
          recommendedContractId: 'rescue_std',
          activeDockingNotice: null,
          campaignBannerCollapsed: false,
          campaignObjective: getActiveCampaignObjective(profile),
        },
        {
          onSkipDocking: () => {},
          onCloseDocking: () => {},
          onStartTutorial: () => {},
          onLaunchRecommended: () => {},
          onOpenContracts: () => {},
          onToggleCampaignBanner: () => {},
          onOpenCampaign: () => {},
          onOpenGoal: () => {},
          onOpenWarehouse: () => {},
          onOpenFacilities: () => {},
          onOpenRelics: () => {},
          onOpenCodex: () => {},
          onOpenCareer: () => {},
        }
      )
    );
    assertWrapperReusesRoot((h) =>
      renderPrepareView(
        h,
        { profile, draft, readOnly: false, validation, effectivePreviewSeed: 1234 },
        {
          onBack: () => {},
          onPickTrial: () => {},
          onExitTrial: () => {},
          onSelectSector: () => {},
          onSelectStandardMode: () => {},
          onSelectFinalMissionMode: () => {},
          onSelectEndlessMode: () => {},
          onSelectEndlessThreat: () => {},
          onChangeCustomSeed: () => {},
          onSelectShip: () => {},
          onSelectCrew: () => {},
          onSelectArchetype: () => {},
          onFallback: () => {},
          onClear: () => {},
          onAddLoan: () => {},
          onAddOwned: () => {},
          onSavePreset: () => {},
          onLoadPreset: () => {},
          onSubLoan: () => {},
          onDeletePreset: () => {},
          onLaunch: () => {},
        }
      )
    );
    assertWrapperReusesRoot((h) =>
      renderCombatPreView(
        h,
        {
          run: { ...run, phase: 'ENCOUNTER', currentNodeId: combatNode.nodeId },
          node: combatNode,
          readOnly: false,
          showCombatLogDetails: false,
          pureAutoCombat: false,
        },
        { onSelectPolicy: () => {}, onToggleLog: () => {}, onStartCombat: () => {} }
      )
    );
    const liveCombatRun = startV2CombatAtCurrentNode(
      { ...run, phase: 'ENCOUNTER', currentNodeId: combatNode.nodeId },
      'weakest',
      { enableTacticalCommands: false, pureAutoCombat: true }
    ).run;
    assertWrapperReusesRoot((h) =>
      renderCombatLiveOverlay(
        h,
        {
          run: liveCombatRun,
          liveCombatRound: 1,
          liveCombatPlayerHp: 20,
          liveCombatPlayerShield: 0,
          liveCombatEnemiesAlive: 1,
          liveCombatEventLine: '测试',
          liveEnemySnapshots: liveCombatRun.activeCombat!.simulation.initialEnemies,
          livePhaseBannerText: null,
          awaitingEliteDecision: false,
          combatSpeed: 1,
        },
        { onPeekBay: () => {}, onToggleSpeed: () => {}, onSkipPlayback: () => {}, onCommitEliteTactic: () => {} }
      )
    );
    assertWrapperReusesRoot((h) =>
      renderWreckHotspotOverlay(
        h,
        { run: { ...tutRun, phase: 'ENCOUNTER', currentNodeId: wreckNode.nodeId }, node: wreckNode, readOnly: false, selectedHotspot: 'armory' },
        { onSelectHotspot: () => {} }
      )
    );
    assertWrapperReusesRoot((h) =>
      renderWreckLeftPanel(
        h,
        { run: { ...tutRun, phase: 'ENCOUNTER', currentNodeId: wreckNode.nodeId }, node: wreckNode, readOnly: false, selectedHotspot: 'armory' },
        { onSelectHotspot: () => {}, onCutSpot: () => {}, onExtract: () => {}, onAbandon: () => {} }
      )
    );
    assertWrapperReusesRoot((h) =>
      renderEventView(
        h,
        { run: { ...run, phase: 'ENCOUNTER', currentNodeId: eventNode.nodeId }, node: eventNode, readOnly: false },
        { onSelectEventOption: () => {}, onAnomalyChoice: () => {}, onDistressChoice: () => {}, onAbandon: () => {} }
      )
    );
    assertWrapperReusesRoot((h) =>
      renderShopView(
        h,
        { run: { ...run, phase: 'SHOP', currentNodeId: shopNode.nodeId }, node: shopNode, readOnly: false },
        { onBuyOffer: () => {}, onBuyFuel: () => {}, onBuyRepair: () => {}, onSellLoot: () => {}, onEngineerSwap: () => {}, onFinish: () => {} }
      )
    );
    const rewRun = completeV2CombatAtCurrentNode(liveCombatRun, profile.unlockedFamilies, []).run;
    assertWrapperReusesRoot((h) =>
      renderRewardView(h, { run: rewRun, readOnly: false }, { onPickReward: () => {} })
    );
    const settleRun: V2RunState = { ...run, phase: 'SETTLEMENT', settlementReason: 'safe_return' };
    assertWrapperReusesRoot((h) =>
      renderSettlementView(
        h,
        {
          run: settleRun,
          profile,
          summary: calculateV2Settlement(settleRun, profile, {}),
          nextGoal: makeNextGoal(),
          readOnly: false,
        },
        { onChangeDisposition: () => {}, onShowcaseRetry: () => {}, onShowcaseToBase: () => {}, onConfirmSettlement: () => {} }
      )
    );
    assertWrapperReusesRoot((h) =>
      renderEndingView(
        h,
        { profile, mode: 'climax', selectedEndingId: null, climaxRun: null, readOnly: false },
        { onSelectEnding: () => {}, onClearSelection: () => {}, onContinueToBase: () => {} }
      )
    );
  });

  it('Iter-2 Fix 6 & 7: SettlementPhaseView allows direct <input type="radio"> activation without preventDefault() and never poisons selectedByItem on rejected !canMutate() callbacks', () => {
    const host = env.doc.createElement('div');
    env.doc.body.appendChild(host);

    const profile = makeRichProfile();
    const baseRun = makeLaunchedRun(profile, 4242);
    const lootEq = createV2EquipmentInstance({
      instanceId: 'iter2_settle_eq',
      kind: 'shield',
      quality: 'common',
      origin: 'loot',
      acquiredDepth: 1,
      location: 'bay',
    });
    const settleRun: V2RunState = {
      ...baseRun,
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
      bay: {
        ...baseRun.bay,
        placed: [...baseRun.bay.placed, { item: lootEq, x: 2, y: 2, rotation: 0 }],
      },
    };

    const disps: Record<string, 'sell' | 'store' | 'dismantle'> = {};
    let rejectCallbacks = false;
    const calls: Array<{ id: string; disp: string }> = [];
    const view = new SettlementPhaseView();
    view.mount(host as unknown as HTMLElement);

    const syncView = () => {
      const summary = calculateV2Settlement(settleRun, profile, disps);
      view.update(
        { run: settleRun, profile, summary, nextGoal: makeNextGoal(), readOnly: false },
        {
          onChangeDisposition: (id, disp) => {
            if (rejectCallbacks) return;
            calls.push({ id, disp });
            disps[id] = disp as 'sell' | 'store' | 'dismantle';
            syncView();
          },
          onShowcaseRetry: () => {},
          onShowcaseToBase: () => {},
          onConfirmSettlement: () => {},
        }
      );
    };
    syncView();

    const sellLabel = host.querySelector(`label[data-settle-item="${lootEq.instanceId}"][data-settle-disp="sell"]`)!;
    const storeLabel = host.querySelector(`label[data-settle-item="${lootEq.instanceId}"][data-settle-disp="store"]`)!;
    const dismantleLabel = host.querySelector(`label[data-settle-item="${lootEq.instanceId}"][data-settle-disp="dismantle"]`)!;
    const sellRadio = sellLabel.querySelector('input[data-settle-radio]')!;
    const storeRadio = storeLabel.querySelector('input[data-settle-radio]')!;
    const dismantleRadio = dismantleLabel.querySelector('input[data-settle-radio]')!;

    // 1. Direct <input type="radio"> activation (ArrowRight / radio.click): MUST NOT call preventDefault(), commits once even with paired change
    expect(sellRadio.checked).toBe(true);
    storeRadio.checked = true;
    const directRadioEv = new MiniEvent('click', { bubbles: true });
    storeRadio.dispatchEvent(directRadioEv);
    storeRadio.dispatchEvent(new MiniEvent('change', { bubbles: true }));
    expect(directRadioEv.defaultPrevented).toBe(false);
    expect(calls).toEqual([{ id: lootEq.instanceId, disp: 'store' }]);
    expect(storeRadio.checked).toBe(true);
    expect(sellRadio.checked).toBe(false);
    expect(storeLabel.classList.contains('is-selected')).toBe(true);

    // 2. Rejected (!canMutate) <label> click on dismantle: calls preventDefault(), does NOT poison selectedByItem, restores radio.checked to store!
    rejectCallbacks = true;
    const rejLabelEv = new MiniEvent('click', { bubbles: true });
    dismantleLabel.dispatchEvent(rejLabelEv);
    expect(rejLabelEv.defaultPrevented).toBe(true);
    expect(calls).toHaveLength(1);
    expect(dismantleRadio.checked).toBe(false);
    expect(storeRadio.checked).toBe(true);
    expect(dismantleLabel.classList.contains('is-selected')).toBe(false);

    // 3. Immediately retrying the EXACT same <label> after unlocking succeeds without being swallowed!
    rejectCallbacks = false;
    const retryLabelEv = new MiniEvent('click', { bubbles: true });
    dismantleLabel.dispatchEvent(retryLabelEv);
    expect(retryLabelEv.defaultPrevented).toBe(true);
    expect(calls).toEqual([
      { id: lootEq.instanceId, disp: 'store' },
      { id: lootEq.instanceId, disp: 'dismantle' },
    ]);
    expect(dismantleRadio.checked).toBe(true);
    expect(storeRadio.checked).toBe(false);
    expect(dismantleLabel.classList.contains('is-selected')).toBe(true);

    // 4. Rejected direct <input> click on sell restores checked to dismantle and retrying direct <input> succeeds immediately!
    rejectCallbacks = true;
    sellRadio.checked = true;
    const rejRadioEv = new MiniEvent('click', { bubbles: true });
    sellRadio.dispatchEvent(rejRadioEv);
    expect(rejRadioEv.defaultPrevented).toBe(false);
    expect(calls).toHaveLength(2);
    expect(sellRadio.checked).toBe(false);
    expect(dismantleRadio.checked).toBe(true);

    rejectCallbacks = false;
    sellRadio.checked = true;
    const retryRadioEv = new MiniEvent('click', { bubbles: true });
    sellRadio.dispatchEvent(retryRadioEv);
    sellRadio.dispatchEvent(new MiniEvent('change', { bubbles: true }));
    expect(retryRadioEv.defaultPrevented).toBe(false);
    expect(calls).toEqual([
      { id: lootEq.instanceId, disp: 'store' },
      { id: lootEq.instanceId, disp: 'dismantle' },
      { id: lootEq.instanceId, disp: 'sell' },
    ]);
    expect(sellRadio.checked).toBe(true);
    expect(dismantleRadio.checked).toBe(false);

    view.unmount();
  });

  it('Iter-2 Fix 9: PreparePhaseView ignores programmatic input events on seed & preset inputs when readOnly === true', () => {
    const host = env.doc.createElement('div');
    env.doc.body.appendChild(host);
    const profile = makeRichProfile();
    const draft: V2PrepareDraft = {
      ...makePrepareDraft(profile),
      endlessThreat: 2,
      customSeedInput: '884422',
    };
    const validation = validateV2PrepareLoadout(
      profile,
      draft.shipId,
      draft.crewId,
      draft.slots,
      draft.trialBuildId,
      draft.sectorId
    );
    const onChangeCustomSeed = vi.fn();
    const actions = {
      onBack: vi.fn(),
      onPickTrial: vi.fn(),
      onExitTrial: vi.fn(),
      onSelectSector: vi.fn(),
      onSelectStandardMode: vi.fn(),
      onSelectFinalMissionMode: vi.fn(),
      onSelectEndlessMode: vi.fn(),
      onSelectEndlessThreat: vi.fn(),
      onChangeCustomSeed,
      onSelectShip: vi.fn(),
      onSelectCrew: vi.fn(),
      onSelectArchetype: vi.fn(),
      onFallback: vi.fn(),
      onClear: vi.fn(),
      onAddLoan: vi.fn(),
      onAddOwned: vi.fn(),
      onSavePreset: vi.fn(),
      onLoadPreset: vi.fn(),
      onSubLoan: vi.fn(),
      onDeletePreset: vi.fn(),
      onLaunch: vi.fn(),
    };

    const view = new PreparePhaseView();
    view.mount(host as unknown as HTMLElement);
    view.update(
      { profile, draft, readOnly: true, validation, effectivePreviewSeed: 884422, fallbackPreviewSeed: 424242 },
      actions
    );

    const seedInput = host.querySelector('#v3-endless-seed-input')!;
    const previewEl = host.querySelector('[data-testid="endless-mutator-preview"]')!;
    const presetInput = host.querySelector('#v2-preset-name')!;
    const previewBefore = previewEl.innerHTML;
    expect(seedInput.disabled).toBe(true);
    expect(presetInput.disabled).toBe(true);

    // Programmatic input event while readOnly MUST be ignored!
    seedInput.value = '999999';
    seedInput.dispatchEvent(new MiniEvent('input', { bubbles: true }));
    expect(onChangeCustomSeed).toHaveBeenCalledTimes(0);
    expect(previewEl.innerHTML).toBe(previewBefore);

    // Preset input event while readOnly MUST NOT flip userEditedPresetName (subsequent ship change still updates auto name)
    presetInput.value = '篡改预设名';
    presetInput.dispatchEvent(new MiniEvent('input', { bubbles: true }));
    const nextDraft: V2PrepareDraft = { ...draft, shipId: 'shield_cruiser' };
    view.update(
      { profile, draft: nextDraft, readOnly: false, validation, effectivePreviewSeed: 884422, fallbackPreviewSeed: 424242 },
      actions
    );
    expect(presetInput.value).toContain('护盾工程');

    view.unmount();
  });

  it('Iter-2 Fix 11: EventPhaseView inserts relicBannerEl strictly BEFORE modernBodyEl when hasRelicSignal flips false -> true in-place', () => {
    const host = env.doc.createElement('div');
    env.doc.body.appendChild(host);
    const profile = makeRichProfile();
    const run = makeLaunchedRun(profile, 7373);
    const eventNode = findNodeByTypeOrThrow(
      run,
      (n) => (n.type === 'anomaly' || n.type === 'distress') && Boolean(n.eventState),
      'event'
    );
    const actions = {
      onSelectEventOption: vi.fn(),
      onAnomalyChoice: vi.fn(),
      onDistressChoice: vi.fn(),
      onAbandon: vi.fn(),
    };

    const view = new EventPhaseView();
    view.mount(host as unknown as HTMLElement);
    // First update with hasRelicSignal: false so modernBodyEl attaches first
    view.update(
      { run, node: { ...eventNode, hasRelicSignal: false }, readOnly: false },
      actions
    );
    expect(host.querySelector('.v3-relic-pity-banner')).toBeNull();

    // Flip hasRelicSignal -> true in-place
    view.update(
      { run, node: { ...eventNode, hasRelicSignal: true }, readOnly: false },
      actions
    );
    const root = host.querySelector('[data-testid="event-screen"]')!;
    const relicBanner = root.querySelector('.v3-relic-pity-banner')!;
    const narrativeWrap = root.querySelector('.v3-event-narrative')!.parentElement!;
    expect(relicBanner).not.toBeNull();
    const relicIdx = root.children.indexOf(relicBanner);
    const bodyIdx = root.children.indexOf(narrativeWrap);
    expect(relicIdx).toBeGreaterThan(0);
    expect(bodyIdx).toBeGreaterThan(relicIdx);

    view.unmount();
  });
});

// ===========================================================================
// SUITE C — Full V2AppController Multi-Screen Lifecycle Integration
// ===========================================================================
describe('Suite C — V2AppController Unified 4-Slot PhaseView Lifecycle Integration', () => {
  let env: MiniDomEnv;

  beforeEach(() => {
    env = installMiniDom('?seed=20261124&playtest=1');
  });

  afterEach(() => {
    vi.useRealTimers();
    env.restore();
    vi.restoreAllMocks();
  });

  it('mounts/unmounts views strictly on transitions across Title -> Base -> Prepare -> Map -> Combat -> Reward -> Arrange -> Settlement -> Base -> destroy with 0 CargoGrid mid-voyage teardown & T01 telemetry', async () => {
    vi.useFakeTimers();
    const save: V2SaveData = {
      ...createFreshV2SaveData(),
      profile: makeRichProfile(),
      settings: { ...createFreshV2SaveData().settings, reducedMotion: true, pureAutoCombat: true },
    };
    persistV2SaveData(env.win.localStorage as unknown as Storage, save);

    const titleMount = vi.spyOn(TitlePhaseView.prototype, 'mount');
    const titleUnmount = vi.spyOn(TitlePhaseView.prototype, 'unmount');
    const baseMount = vi.spyOn(BasePhaseView.prototype, 'mount');
    const baseUnmount = vi.spyOn(BasePhaseView.prototype, 'unmount');
    const prepMount = vi.spyOn(PreparePhaseView.prototype, 'mount');
    const prepUnmount = vi.spyOn(PreparePhaseView.prototype, 'unmount');
    const mapMount = vi.spyOn(MapPhaseView.prototype, 'mount');
    const mapUnmount = vi.spyOn(MapPhaseView.prototype, 'unmount');
    const preCombatMount = vi.spyOn(CombatPrePhaseView.prototype, 'mount');
    const preCombatUnmount = vi.spyOn(CombatPrePhaseView.prototype, 'unmount');
    const liveCombatMount = vi.spyOn(CombatLivePhaseView.prototype, 'mount');
    const liveCombatUnmount = vi.spyOn(CombatLivePhaseView.prototype, 'unmount');
    const rewardMount = vi.spyOn(RewardPhaseView.prototype, 'mount');
    const rewardUnmount = vi.spyOn(RewardPhaseView.prototype, 'unmount');
    const arrangeMount = vi.spyOn(ArrangePhaseView.prototype, 'mount');
    const arrangeUnmount = vi.spyOn(ArrangePhaseView.prototype, 'unmount');
    const settleMount = vi.spyOn(SettlementPhaseView.prototype, 'mount');
    const settleUnmount = vi.spyOn(SettlementPhaseView.prototype, 'unmount');
    const cargoDestroy = vi.spyOn(CargoGridV2Component.prototype, 'destroy');

    const ctrl = new V2AppController(env.mountEl as unknown as HTMLElement, {
      onSwitchToV1: () => {},
    });
    ctrl.init();
    await Promise.resolve();

    // 1. Title Screen: NO ghost BasePhaseView mounted behind Title!
    expect(titleMount).toHaveBeenCalledTimes(1);
    expect(baseMount).toHaveBeenCalledTimes(0);

    // 2. Title -> Base
    env.mountEl.querySelector('[data-testid="btn-enter-station"]')!.click();
    expect(titleUnmount).toHaveBeenCalledTimes(1);
    expect(baseMount).toHaveBeenCalledTimes(1);

    // In-phase Base interaction (campaign banner toggle): 0 remounts!
    const baseRoot = env.mountEl.querySelector('[data-testid="base-screen"]')!;
    env.mountEl.querySelector('#v3-cb-toggle')!.click();
    expect(baseMount).toHaveBeenCalledTimes(1);
    expect(env.mountEl.querySelector('[data-testid="base-screen"]')).toBe(baseRoot);

    // 3. Base -> Prepare
    env.mountEl.querySelector('[data-testid="btn-start-recommended"]')!.click();
    expect(baseUnmount).toHaveBeenCalledTimes(1);
    expect(prepMount).toHaveBeenCalledTimes(1);

    // In-phase Prepare interaction (select archetype): 0 remounts!
    const prepRoot = env.mountEl.querySelector('[data-testid="prepare-screen"]')!;
    env.mountEl.querySelector('[data-prep-arch="heavy"]')!.click();
    expect(prepMount).toHaveBeenCalledTimes(1);
    expect(env.mountEl.querySelector('[data-testid="prepare-screen"]')).toBe(prepRoot);

    // 4. Prepare -> Map (voyage begins; reset CargoGrid destroy counter for voyage check)
    env.mountEl.querySelector('[data-testid="btn-launch-expedition"]')!.click();
    expect(prepUnmount).toHaveBeenCalledTimes(1);
    expect(mapMount).toHaveBeenCalledTimes(1);
    cargoDestroy.mockClear();

    // 5. Map -> CombatPre (jump to layer-1 combat node via [data-jump-node])
    const allJumpBtns = env.mountEl.querySelectorAll('[data-jump-node]');
    expect(allJumpBtns.length).toBeGreaterThan(0);
    const combatJumpBtn = env.mountEl.querySelector('.node-combat [data-jump-node]')!;
    expect(combatJumpBtn).not.toBeNull();
    combatJumpBtn.click();
    expect(mapUnmount).toHaveBeenCalledTimes(1);

    // 6. CombatPre -> details toggle (0 remounts) -> CombatLive
    expect(preCombatMount).toHaveBeenCalledTimes(1);
    const preRoot = env.mountEl.querySelector('[data-testid="combat-screen"]')!;
    env.mountEl.querySelector('[data-testid="btn-toggle-forecast-details"]')!.click();
    expect(preCombatMount).toHaveBeenCalledTimes(1);
    expect(env.mountEl.querySelector('[data-testid="combat-screen"]')).toBe(preRoot);

    env.mountEl.querySelector('[data-testid="btn-start-combat"]')!.click();
    expect(preCombatUnmount).toHaveBeenCalledTimes(1);
    expect(liveCombatMount).toHaveBeenCalledTimes(1);

    // In-phase speed toggle: 0 remounts!
    const liveRoot = env.mountEl.querySelector('[data-testid="combat-screen"]')!;
    env.mountEl.querySelector('#v2-combat-speed')!.click();
    expect(liveCombatMount).toHaveBeenCalledTimes(1);
    expect(env.mountEl.querySelector('[data-testid="combat-screen"]')).toBe(liveRoot);

    // Skip playback cleanly -> Reward
    const skipBtn = env.mountEl.querySelector('[data-testid="btn-combat-skip"]')!;
    expect(skipBtn.disabled).toBe(false);
    skipBtn.click();
    vi.advanceTimersByTime(1000);
    expect(liveCombatUnmount).toHaveBeenCalledTimes(1);
    expect(rewardMount).toHaveBeenCalledTimes(1);

    // 7. Pick repair reward -> S02 fast-path returns straight to MAP (0 staging friction!) -> Safe Return -> SETTLEMENT -> BASE
    env.mountEl.querySelector('[data-pick-reward="repair"]')!.click();
    expect(rewardUnmount).toHaveBeenCalledTimes(1);
    expect(arrangeMount).toHaveBeenCalledTimes(0);
    expect(arrangeUnmount).toHaveBeenCalledTimes(0);
    expect(mapMount).toHaveBeenCalledTimes(2);

    // 8. Safe Return -> Settlement
    const safeReturnBtn = env.mountEl.querySelector('[data-testid="btn-safe-return"]')!;
    expect(safeReturnBtn).not.toBeNull();
    safeReturnBtn.click();
    expect(mapUnmount).toHaveBeenCalledTimes(2);
    expect(settleMount).toHaveBeenCalledTimes(1);

    // Verify 0 CargoGridV2.destroy calls across the entire voyage!
    expect(cargoDestroy).toHaveBeenCalledTimes(0);

    // 9. Confirm Settlement -> Base
    env.mountEl.querySelector('[data-testid="btn-confirm-settlement"]')!.click();
    expect(settleUnmount).toHaveBeenCalledTimes(1);
    expect(baseMount).toHaveBeenCalledTimes(2);

    // 10. Test T01 playtest telemetry recorded data-action clicks cleanly
    const rawTelemetry = env.win.localStorage.getItem(PLAYTEST_LOG_STORAGE_KEY);
    expect(rawTelemetry).not.toBeNull();
    expect(rawTelemetry!).toContain('enter-station');
    expect(rawTelemetry!).toContain('start-recommended');
    expect(rawTelemetry!).toContain('start-combat');
    expect(rawTelemetry!).toContain('confirm-settlement');

    // 11. Verify destroy() unmounts active BasePhaseView cleanly with 0 leaked timers
    ctrl.destroy();
    expect(baseUnmount).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(10000);
    expect(env.mountEl.children.length).toBe(0);
  });

  it('prevents ghost mounts behind Climax Ending and preserves EndingPhaseView === across choice <-> epilogue -> Base', () => {
    const profile = makeRichProfile();
    const run = makeLaunchedRun(profile, 7777);
    const climaxPendingRun: V2RunState = {
      ...run,
      isFinalCampaignRun: true,
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
      defeatedBossIdsThisRun: ['boss_leviathan'],
    };
    const save: V2SaveData = {
      ...createFreshV2SaveData(),
      profile,
      activeRun: climaxPendingRun,
    };
    persistV2SaveData(env.win.localStorage as unknown as Storage, save);
    env.win.sessionStorage.setItem('starline_v2_title_entered', '1');

    const endingMount = vi.spyOn(EndingPhaseView.prototype, 'mount');
    const endingUnmount = vi.spyOn(EndingPhaseView.prototype, 'unmount');
    const baseMount = vi.spyOn(BasePhaseView.prototype, 'mount');
    const settleMount = vi.spyOn(SettlementPhaseView.prototype, 'mount');

    const ctrl = new V2AppController(env.mountEl as unknown as HTMLElement, {
      onSwitchToV1: () => {},
    });
    ctrl.init();

    // Climax Ending mounts ONCE; ZERO ghost Base or Settlement mounts behind it!
    expect(endingMount).toHaveBeenCalledTimes(1);
    expect(baseMount).toHaveBeenCalledTimes(0);
    expect(settleMount).toHaveBeenCalledTimes(0);

    const backdrop = env.mountEl.querySelector('[data-testid="ending-screen"]')!;
    env.mountEl.querySelector('[data-testid="ending-choice-free_haven"]')!.click();
    expect(endingMount).toHaveBeenCalledTimes(1);
    expect(env.mountEl.querySelector('[data-testid="ending-screen"]')).toBe(backdrop);

    // Rechoose stays mounted in-place
    env.mountEl.querySelector('#v3-btn-ending-rechoose')!.click();
    expect(endingMount).toHaveBeenCalledTimes(1);
    expect(env.mountEl.querySelector('[data-testid="ending-screen"]')).toBe(backdrop);

    // Select ending & continue to Base -> Ending unmounts ONCE, Base mounts ONCE!
    env.mountEl.querySelector('[data-testid="ending-choice-free_haven"]')!.click();
    env.mountEl.querySelector('[data-testid="btn-ending-continue"]')!.click();
    expect(endingUnmount).toHaveBeenCalledTimes(1);
    expect(baseMount).toHaveBeenCalledTimes(1);

    ctrl.destroy();
  });

  it('preserves WreckPhaseView & WreckOverlayPhaseView === and 0 showV2Stage resets during in-phase wreck cut & Settlement transition', () => {
    vi.useFakeTimers();
    const tutRun = createV2TutorialRun('wreck_int_run');
    const wreckNode = Object.values(tutRun.graph.nodes).find((n) => n.type === 'wreck')!;
    const activeWreckRun: V2RunState = {
      ...tutRun,
      phase: 'ENCOUNTER',
      currentNodeId: wreckNode.nodeId,
    };
    const save: V2SaveData = {
      ...createFreshV2SaveData(),
      profile: makeRichProfile(),
      settings: { ...createFreshV2SaveData().settings, reducedMotion: true },
      activeRun: activeWreckRun,
    };
    persistV2SaveData(env.win.localStorage as unknown as Storage, save);
    env.win.sessionStorage.setItem('starline_v2_title_entered', '1');

    const ovMount = vi.spyOn(WreckOverlayPhaseView.prototype, 'mount');
    const ovUnmount = vi.spyOn(WreckOverlayPhaseView.prototype, 'unmount');
    const leftMount = vi.spyOn(WreckPhaseView.prototype, 'mount');
    const leftUnmount = vi.spyOn(WreckPhaseView.prototype, 'unmount');
    const arrangeMount = vi.spyOn(ArrangePhaseView.prototype, 'mount');
    const arrangeUnmount = vi.spyOn(ArrangePhaseView.prototype, 'unmount');
    const showStageSpy = vi.spyOn(PhaserHost.prototype, 'showV2Stage');

    const ctrl = new V2AppController(env.mountEl as unknown as HTMLElement, {
      onSwitchToV1: () => {},
    });
    ctrl.init();

    expect(ovMount).toHaveBeenCalledTimes(1);
    expect(leftMount).toHaveBeenCalledTimes(1);
    const pinEl = env.mountEl.querySelector('[data-testid="wreck-spot-armory"]')!;
    const cardBtnEl = env.mountEl.querySelector('[data-testid="wreck-cut-armory"]')!;
    showStageSpy.mockClear();

    // Direct clamp cut in reducedMotion -> instant commit with 0 remounts & 0 showV2Stage resets!
    pinEl.click();
    expect(ovMount).toHaveBeenCalledTimes(1);
    expect(leftMount).toHaveBeenCalledTimes(1);
    expect(showStageSpy).toHaveBeenCalledTimes(0);
    expect(env.mountEl.querySelector('[data-testid="wreck-spot-armory"]')).toBe(pinEl);
    expect(env.mountEl.querySelector('[data-testid="wreck-cut-armory"]')).toBe(cardBtnEl);
    expect(pinEl.dataset.compartmentState).toBe('cutaway');

    // Extract wreck -> unmounts Wreck overlay & panel ONCE, mounts ArrangePhaseView ONCE!
    env.mountEl.querySelector('[data-testid="btn-wreck-extract"]')!.click();
    expect(ovUnmount).toHaveBeenCalledTimes(1);
    expect(leftUnmount).toHaveBeenCalledTimes(1);
    expect(arrangeMount).toHaveBeenCalledTimes(1);

    ctrl.destroy();
    expect(arrangeUnmount).toHaveBeenCalledTimes(1);
  });

  it('patches active PhaseView in-place without tearing down DOM when MultiTabGuard flips read-only (!canMutate)', async () => {
    const save: V2SaveData = {
      ...createFreshV2SaveData(),
      profile: makeRichProfile(),
    };
    persistV2SaveData(env.win.localStorage as unknown as Storage, save);
    env.win.sessionStorage.setItem('starline_v2_title_entered', '1');

    const baseMount = vi.spyOn(BasePhaseView.prototype, 'mount');
    const ctrl = new V2AppController(env.mountEl as unknown as HTMLElement, {
      onSwitchToV1: () => {},
    });
    ctrl.init();
    await Promise.resolve();

    expect(baseMount).toHaveBeenCalledTimes(1);
    const baseRoot = env.mountEl.querySelector('[data-testid="base-screen"]')!;
    const launchBtn = env.mountEl.querySelector('[data-testid="btn-start-recommended"]')!;
    expect(launchBtn.disabled).toBe(false);

    // Simulate another tab taking over via MultiTabGuard storage event / direct read-only refresh
    (ctrl as unknown as { isReadOnlyTab: boolean; syncAll: () => void }).isReadOnlyTab = true;
    (ctrl as unknown as { syncAll: () => void }).syncAll();

    // BasePhaseView updated in-place: 0 remounts, DOM root & button ===, launch CTA disabled!
    expect(baseMount).toHaveBeenCalledTimes(1);
    expect(env.mountEl.querySelector('[data-testid="base-screen"]')).toBe(baseRoot);
    expect(env.mountEl.querySelector('[data-testid="btn-start-recommended"]')).toBe(launchBtn);
    expect(launchBtn.disabled).toBe(true);

    ctrl.destroy();
  });

  it('Iter-2 Fix 8 (C2-#2): tears down CargoGridV2 and empties right panel on live Act III Boss -> Climax Ending transition', async () => {
    vi.useFakeTimers();
    const baseProfile = makeRichProfile();
    const profile: V2ProfileState = {
      ...baseProfile,
      unlockedShips: ['cannon_skiff', 'shield_cruiser', 'stargate_cruiser'],
      buildings: {
        ...baseProfile.buildings,
        workbench: true,
        research_lab: true,
        contract_hub: true,
        drydock_tier2: true,
      },
      facilityTiers: {
        ...baseProfile.facilityTiers,
        workbench: 2,
        research_lab: 2,
        contract_hub: 2,
        drydock_tier2: 2,
        stargate_relay: 2,
      },
    };
    const launched = launchV2Expedition({
      profile,
      contractTemplateId: 'bounty_std',
      shipId: 'stargate_cruiser',
      crewId: 'engineer',
      primaryArchetype: 'laser',
      slots: [...buildFreeFallbackPrepareSlots('stargate_cruiser', profile.blueprints, 8)],
      trialBuildId: null,
      sectorId: 'stargate_abyss',
      isFinalCampaignRun: true,
      seed: 6201,
    });
    expect(launched.ok).toBe(true);
    const baseRun = launched.run!;
    const bossNode = Object.values(baseRun.graph.nodes).find(
      (n) => n.layer === 6 && n.bossId === 'boss_leviathan'
    )!;
    expect(bossNode).toBeDefined();

    // Guaranteed 1-round victory at boss_leviathan so live combat transitions directly to Climax Ending
    const bossUnit = bossNode.combat!.units.find((u) => u.isBoss) ?? bossNode.combat!.units[0]!;
    const easyBossNode: V2MapNode = {
      ...bossNode,
      combat: {
        ...bossNode.combat!,
        units: [
          { ...bossUnit, maxHp: 1, armor: 0, initialShield: 0, maxShield: 0, damagePerRound: 1 },
        ],
      },
    };
    const atClimaxBoss: V2RunState = {
      ...baseRun,
      phase: 'ENCOUNTER',
      currentNodeId: easyBossNode.nodeId,
      hp: 40,
      maxHp: 40,
      graph: {
        ...baseRun.graph,
        nodes: { ...baseRun.graph.nodes, [easyBossNode.nodeId]: easyBossNode },
      },
    };
    const save: V2SaveData = {
      ...createFreshV2SaveData(),
      profile,
      settings: { ...createFreshV2SaveData().settings, reducedMotion: true, pureAutoCombat: true },
      activeRun: atClimaxBoss,
    };
    persistV2SaveData(env.win.localStorage as unknown as Storage, save);
    env.win.sessionStorage.setItem('starline_v2_title_entered', '1');

    const cargoDestroy = vi.spyOn(CargoGridV2Component.prototype, 'destroy');
    const ctrl = new V2AppController(env.mountEl as unknown as HTMLElement, {
      onSwitchToV1: () => {},
    });
    ctrl.init();
    await Promise.resolve();

    // CargoGridV2 is mounted in .panel-right during pre-combat
    const rightPanel = env.mountEl.querySelector('.panel-right')!;
    expect(rightPanel.children.length).toBeGreaterThan(0);
    expect(cargoDestroy).toHaveBeenCalledTimes(0);

    // Start boss combat -> skip playback -> transitions LIVE from combat to Climax Ending!
    env.mountEl.querySelector('[data-testid="btn-start-combat"]')!.click();
    env.mountEl.querySelector('[data-testid="btn-combat-skip"]')!.click();
    vi.advanceTimersByTime(1000);

    expect(env.mountEl.querySelector('[data-testid="ending-screen"]')).not.toBeNull();
    expect(cargoDestroy).toHaveBeenCalledTimes(1);
    expect(rightPanel.children.length).toBe(0);

    ctrl.destroy();
  });

  it('Iter-2 Fix 7 (live modal !canMutate): rejecting settlement radio while modal is open does NOT poison selection after closing modal', () => {
    const profile = makeRichProfile();
    const baseRun = makeLaunchedRun(profile, 5151);
    const lootEq = createV2EquipmentInstance({
      instanceId: 'live_modal_eq',
      kind: 'shield',
      quality: 'common',
      origin: 'loot',
      acquiredDepth: 1,
      location: 'bay',
    });
    const settleRun: V2RunState = {
      ...baseRun,
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
      bay: {
        ...baseRun.bay,
        placed: [...baseRun.bay.placed, { item: lootEq, x: 2, y: 2, rotation: 0 }],
      },
    };
    const save: V2SaveData = {
      ...createFreshV2SaveData(),
      profile,
      settings: { ...createFreshV2SaveData().settings, reducedMotion: true },
      activeRun: settleRun,
    };
    persistV2SaveData(env.win.localStorage as unknown as Storage, save);
    env.win.sessionStorage.setItem('starline_v2_title_entered', '1');

    const ctrl = new V2AppController(env.mountEl as unknown as HTMLElement, {
      onSwitchToV1: () => {},
    });
    ctrl.init();

    const dismantleLabel = env.mountEl.querySelector(`[data-testid="btn-dismantle-${lootEq.instanceId}"]`)!;
    const dismantleRadio = dismantleLabel.querySelector('input[data-settle-radio]')!;
    expect(dismantleLabel.classList.contains('is-selected')).toBe(false);

    // Open Help modal (!canMutate()) and click dismantle -> rejected cleanly
    env.mountEl.querySelector('#v2-hud-help')!.click();
    dismantleLabel.click();
    expect(dismantleLabel.classList.contains('is-selected')).toBe(false);
    expect(dismantleRadio.checked).toBe(false);

    // Close Help modal and click dismantle again -> succeeds immediately!
    env.mountEl.querySelector('.modal-close-btn')!.click();
    dismantleLabel.click();
    expect(dismantleLabel.classList.contains('is-selected')).toBe(true);
    expect(dismantleRadio.checked).toBe(true);

    ctrl.destroy();
  });

  it('Iter-2 Fix 9 (live V2AppController): readOnly Prepare blocks custom seed input mutation and mutator preview rewrite', () => {
    const profile = makeRichProfile();
    const save: V2SaveData = {
      ...createFreshV2SaveData(),
      profile,
      settings: { ...createFreshV2SaveData().settings, reducedMotion: true },
    };
    persistV2SaveData(env.win.localStorage as unknown as Storage, save);
    env.win.sessionStorage.setItem('starline_v2_title_entered', '1');

    const ctrl = new V2AppController(env.mountEl as unknown as HTMLElement, {
      onSwitchToV1: () => {},
    });
    ctrl.init();

    env.mountEl.querySelector('[data-testid="btn-start-recommended"]')!.click();
    env.mountEl.querySelector('[data-testid="btn-mode-endless"]')!.click();
    const seedInput = env.mountEl.querySelector('#v3-endless-seed-input')!;
    const previewEl = env.mountEl.querySelector('[data-testid="endless-mutator-preview"]')!;
    seedInput.value = '884422';
    seedInput.dispatchEvent(new MiniEvent('input', { bubbles: true }));
    const lockedPreviewHtml = previewEl.innerHTML;

    // Flip readOnly & sync -> programmatic input MUST NOT mutate prepareDraft.customSeedInput or preview
    (ctrl as unknown as { isReadOnlyTab: boolean; syncAll: () => void }).isReadOnlyTab = true;
    (ctrl as unknown as { syncAll: () => void }).syncAll();
    expect(seedInput.disabled).toBe(true);

    seedInput.value = '999999';
    seedInput.dispatchEvent(new MiniEvent('input', { bubbles: true }));
    expect(
      (ctrl as unknown as { prepareDraft: V2PrepareDraft | null }).prepareDraft!.customSeedInput
    ).toBe('884422');
    expect(previewEl.innerHTML).toBe(lockedPreviewHtml);

    ctrl.destroy();
  });

  it('Iter-2 Fix 10 (C2-#5): entering Ending Gallery cancels active Base return docking animation/audio and destroy() clears activeDockingNotice', () => {
    vi.useFakeTimers();
    const baseProfile = makeRichProfile();
    const profile: V2ProfileState = {
      ...baseProfile,
      campaign: {
        ...baseProfile.campaign,
        endingsUnlocked: ['free_haven'],
      },
    };
    const baseRun = makeLaunchedRun(profile, 6161);
    const settleRun: V2RunState = {
      ...baseRun,
      phase: 'SETTLEMENT',
      settlementReason: 'safe_return',
      wallet: 90,
    };
    const save: V2SaveData = {
      ...createFreshV2SaveData(),
      profile,
      settings: { ...createFreshV2SaveData().settings, reducedMotion: false },
      activeRun: settleRun,
    };
    persistV2SaveData(env.win.localStorage as unknown as Storage, save);
    env.win.sessionStorage.setItem('starline_v2_title_entered', '1');

    const playDockingSpy = vi.spyOn(PhaserHost.prototype, 'playBaseReturnDocking');
    const skipDockingSpy = vi.spyOn(PhaserHost.prototype, 'skipBaseReturnDocking');

    const ctrl = new V2AppController(env.mountEl as unknown as HTMLElement, {
      onSwitchToV1: () => {},
    });
    ctrl.init();

    // Confirm settlement in non-reducedMotion -> starts Base return docking!
    env.mountEl.querySelector('[data-testid="btn-confirm-settlement"]')!.click();
    expect(playDockingSpy).toHaveBeenCalledTimes(1);
    expect((ctrl as unknown as { activeDockingNotice: unknown }).activeDockingNotice).not.toBeNull();

    // Open Career Modal -> Endings tab -> Replay unlocked ending mid-docking!
    env.mountEl.querySelector('[data-testid="btn-open-career"]')!.click();
    env.mountEl.querySelector('[data-testid="career-tab-endings"]')!.click();
    env.mountEl.querySelector('[data-replay-ending="free_haven"]')!.click();

    expect(skipDockingSpy).toHaveBeenCalledTimes(1);
    expect((ctrl as unknown as { activeDockingNotice: unknown }).activeDockingNotice).toBeNull();
    expect(env.mountEl.querySelector('[data-testid="ending-screen"]')).not.toBeNull();

    // Also verify destroy() clears activeDockingNotice unconditionally
    (ctrl as unknown as { activeDockingNotice: unknown }).activeDockingNotice = { animating: true };
    ctrl.destroy();
    expect((ctrl as unknown as { activeDockingNotice: unknown }).activeDockingNotice).toBeNull();
  });
});
