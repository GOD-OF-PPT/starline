import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Third-Party Phaser Mock (ONLY 'phaser' is mocked — ALL real project classes
// V2CombatScene, BaseScene, PhaserHost, SoundEngine, manifest, combatV2 execute!)
// ---------------------------------------------------------------------------

const { MOCK_SCENE_STATUS, MockPhaserScene, MockPhaserGame, mockTexturesDisabled } = vi.hoisted(() => {
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

  const mockTexturesDisabled = new Set<string>();

  interface Listener {
    readonly fn: (...args: unknown[]) => void;
    readonly ctx: unknown;
    readonly once: boolean;
  }

  class MockEventEmitter {
    private readonly map = new Map<string, Listener[]>();

    on(event: string, fn: (...args: unknown[]) => void, ctx?: unknown): this {
      const list = this.map.get(event) ?? [];
      list.push({ fn, ctx, once: false });
      this.map.set(event, list);
      return this;
    }

    once(event: string, fn: (...args: unknown[]) => void, ctx?: unknown): this {
      const list = this.map.get(event) ?? [];
      list.push({ fn, ctx, once: true });
      this.map.set(event, list);
      return this;
    }

    off(event: string, fn?: (...args: unknown[]) => void, ctx?: unknown): this {
      if (!fn) {
        this.map.delete(event);
        return this;
      }
      const list = this.map.get(event);
      if (!list) return this;
      this.map.set(
        event,
        list.filter((l) => !(l.fn === fn && (ctx === undefined || l.ctx === ctx)))
      );
      return this;
    }

    emit(event: string, ...args: unknown[]): boolean {
      const list = this.map.get(event);
      if (!list || list.length === 0) return false;
      const copy = [...list];
      this.map.set(
        event,
        list.filter((l) => !l.once)
      );
      for (const l of copy) {
        l.fn.apply(l.ctx, args);
      }
      return true;
    }
  }

  interface DrawOp {
    readonly kind: string;
    readonly color?: number;
    readonly width?: number;
    readonly alpha?: number;
    readonly args: readonly number[];
  }

  class MockDisplayObject {
    scene: MockPhaserScene | null;
    readonly kind: 'image' | 'text' | 'graphics' | 'zone';
    x: number;
    y: number;
    width = 512;
    height = 256;
    displayWidth = 512;
    displayHeight = 256;
    visible = true;
    alpha = 1;
    depth = 0;
    angle = 0;
    blendMode = 0;
    textureKey: string;
    text: string;
    style: Record<string, unknown>;
    tint: number | null = null;
    readonly tintCalls: number[] = [];
    readonly tintFillCalls: number[] = [];
    readonly cropCalls: (readonly [number, number, number, number] | null)[] = [];
    lastCrop: readonly [number, number, number, number] | null = null;
    drawOps: DrawOp[] = [];
    private currentLineColor = 0xffffff;
    private currentLineWidth = 1;
    private currentLineAlpha = 1;
    private currentFillColor = 0xffffff;
    private currentFillAlpha = 1;
    readonly events = new MockEventEmitter();
    destroyed = false;

    constructor(
      scene: MockPhaserScene,
      kind: 'image' | 'text' | 'graphics' | 'zone',
      x = 0,
      y = 0,
      textureKey = '',
      text = '',
      style: Record<string, unknown> = {}
    ) {
      this.scene = scene;
      this.kind = kind;
      this.x = x;
      this.y = y;
      this.textureKey = textureKey;
      this.text = text;
      this.style = { ...style };
      if (textureKey.startsWith('base.')) {
        this.width = 1280;
        this.height = 720;
        this.displayWidth = 1280;
        this.displayHeight = 720;
      } else if (textureKey.startsWith('ship.mod.')) {
        this.width = 256;
        this.height = 128;
        this.displayWidth = 256;
        this.displayHeight = 128;
      }
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
    setAngle(deg: number): this {
      this.angle = deg;
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
    setColor(c: string): this {
      this.style.color = c;
      return this;
    }
    setBackgroundColor(c: string): this {
      this.style.backgroundColor = c;
      return this;
    }
    setTint(t: number): this {
      this.tint = t;
      this.tintCalls.push(t);
      return this;
    }
    setTintFill(t: number): this {
      this.tint = t;
      this.tintFillCalls.push(t);
      return this;
    }
    clearTint(): this {
      this.tint = null;
      return this;
    }
    setCrop(x?: number, y?: number, w?: number, h?: number): this {
      if (x === undefined || y === undefined || w === undefined || h === undefined) {
        this.lastCrop = null;
        this.cropCalls.push(null);
      } else {
        this.lastCrop = [x, y, w, h];
        this.cropCalls.push([x, y, w, h]);
      }
      return this;
    }
    setInteractive(_opts?: unknown): this {
      return this;
    }
    on(event: string, fn: (...args: unknown[]) => void, ctx?: unknown): this {
      this.events.on(event, fn, ctx);
      return this;
    }
    off(event: string, fn?: (...args: unknown[]) => void, ctx?: unknown): this {
      this.events.off(event, fn, ctx);
      return this;
    }
    clear(): this {
      this.drawOps = [];
      return this;
    }
    fillStyle(c: number, a = 1): this {
      this.currentFillColor = c;
      this.currentFillAlpha = a;
      return this;
    }
    lineStyle(w: number, c: number, a = 1): this {
      this.currentLineWidth = w;
      this.currentLineColor = c;
      this.currentLineAlpha = a;
      return this;
    }
    fillRect(x: number, y: number, w: number, h: number): this {
      this.drawOps.push({ kind: 'fillRect', color: this.currentFillColor, alpha: this.currentFillAlpha, args: [x, y, w, h] });
      return this;
    }
    strokeRect(x: number, y: number, w: number, h: number): this {
      this.drawOps.push({ kind: 'strokeRect', color: this.currentLineColor, width: this.currentLineWidth, alpha: this.currentLineAlpha, args: [x, y, w, h] });
      return this;
    }
    fillRoundedRect(x: number, y: number, w: number, h: number, r = 0): this {
      this.drawOps.push({ kind: 'fillRoundedRect', color: this.currentFillColor, alpha: this.currentFillAlpha, args: [x, y, w, h, r] });
      return this;
    }
    strokeRoundedRect(x: number, y: number, w: number, h: number, r = 0): this {
      this.drawOps.push({ kind: 'strokeRoundedRect', color: this.currentLineColor, width: this.currentLineWidth, alpha: this.currentLineAlpha, args: [x, y, w, h, r] });
      return this;
    }
    fillCircle(x: number, y: number, r: number): this {
      this.drawOps.push({ kind: 'fillCircle', color: this.currentFillColor, alpha: this.currentFillAlpha, args: [x, y, r] });
      return this;
    }
    strokeCircle(x: number, y: number, r: number): this {
      this.drawOps.push({ kind: 'strokeCircle', color: this.currentLineColor, width: this.currentLineWidth, alpha: this.currentLineAlpha, args: [x, y, r] });
      return this;
    }
    fillEllipse(x: number, y: number, w: number, h: number): this {
      this.drawOps.push({ kind: 'fillEllipse', color: this.currentFillColor, alpha: this.currentFillAlpha, args: [x, y, w, h] });
      return this;
    }
    strokeEllipse(x: number, y: number, w: number, h: number): this {
      this.drawOps.push({ kind: 'strokeEllipse', color: this.currentLineColor, width: this.currentLineWidth, alpha: this.currentLineAlpha, args: [x, y, w, h] });
      return this;
    }
    lineBetween(x1: number, y1: number, x2: number, y2: number): this {
      this.drawOps.push({ kind: 'lineBetween', color: this.currentLineColor, width: this.currentLineWidth, alpha: this.currentLineAlpha, args: [x1, y1, x2, y2] });
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
      this.drawOps.push({ kind: 'fillPath', color: this.currentFillColor, alpha: this.currentFillAlpha, args: [] });
      return this;
    }
    strokePath(): this {
      this.drawOps.push({ kind: 'strokePath', color: this.currentLineColor, width: this.currentLineWidth, alpha: this.currentLineAlpha, args: [] });
      return this;
    }
    fillTriangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): this {
      this.drawOps.push({ kind: 'fillTriangle', color: this.currentFillColor, alpha: this.currentFillAlpha, args: [x1, y1, x2, y2, x3, y3] });
      return this;
    }
    strokeTriangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): this {
      this.drawOps.push({ kind: 'strokeTriangle', color: this.currentLineColor, width: this.currentLineWidth, alpha: this.currentLineAlpha, args: [x1, y1, x2, y2, x3, y3] });
      return this;
    }
    arc(x: number, y: number, r: number, startAngle: number, endAngle: number): this {
      this.drawOps.push({ kind: 'arc', color: this.currentLineColor, width: this.currentLineWidth, alpha: this.currentLineAlpha, args: [x, y, r, startAngle, endAngle] });
      return this;
    }
    destroy(): void {
      this.destroyed = true;
      this.scene = null;
    }
  }

  interface MockTimerEvent {
    readonly delay: number;
    dueAt: number;
    readonly callback: () => void;
    removed: boolean;
    fired: boolean;
    remove: (dispatchCallback?: boolean) => void;
  }

  class MockClock {
    nowMs = 0;
    paused = false;
    private events: MockTimerEvent[] = [];
    readonly scheduledDelays: number[] = [];

    delayedCall(delay: number, callback: () => void): MockTimerEvent {
      const safeDelay = Math.max(0, delay);
      this.scheduledDelays.push(safeDelay);
      const ev: MockTimerEvent = {
        delay: safeDelay,
        dueAt: this.nowMs + safeDelay,
        callback,
        removed: false,
        fired: false,
        remove: (dispatchCallback = false) => {
          if (ev.removed || ev.fired) return;
          ev.removed = true;
          this.events = this.events.filter((item) => item !== ev);
          if (dispatchCallback) {
            ev.fired = true;
            ev.callback();
          }
        },
      };
      this.events.push(ev);
      return ev;
    }

    removeEvent(ev: MockTimerEvent): void {
      ev.removed = true;
      this.events = this.events.filter((item) => item !== ev);
    }

    advance(ms: number): void {
      if (this.paused) return;
      this.nowMs += Math.max(0, ms);
      while (true) {
        const due = this.events
          .filter((e) => !e.removed && !e.fired && e.dueAt <= this.nowMs)
          .sort((a, b) => a.dueAt - b.dueAt);
        if (due.length === 0) break;
        const next = due[0];
        next.fired = true;
        this.events = this.events.filter((item) => item !== next);
        next.callback();
      }
    }

    getPendingCount(): number {
      return this.events.filter((e) => !e.removed && !e.fired).length;
    }

    resetHistory(): void {
      this.scheduledDelays.length = 0;
    }
  }

  class MockPhaserScene {
    readonly sceneKey: string;
    game!: MockPhaserGame;
    events = new MockEventEmitter();
    time = new MockClock();
    createdObjects: MockDisplayObject[] = [];
    cameraCenters: { readonly x: number; readonly y: number }[] = [];
    load = {
      on: (_event: string, _fn: (...args: unknown[]) => void) => this.load,
      image: (_key: string, _url: string) => this.load,
    };
    textures = {
      exists: (key: string) => !mockTexturesDisabled.has(key),
    };
    cameras = {
      main: {
        setViewport: () => {},
        setZoom: () => {},
        centerOn: (x: number, y: number) => {
          this.cameraCenters.push({ x, y });
        },
        setBackgroundColor: () => {},
      },
    };
    scale = {
      width: 1280,
      height: 720,
      resize: (w: number, h: number) => {
        this.scale.width = w;
        this.scale.height = h;
      },
      on: (_event: string, _fn: (...args: unknown[]) => void, _ctx?: unknown) => {},
      off: (_event: string, _fn?: (...args: unknown[]) => void, _ctx?: unknown) => {},
    };
    add = {
      image: (x: number, y: number, key: string) => {
        const obj = new MockDisplayObject(this, 'image', x, y, key);
        this.createdObjects.push(obj);
        return obj;
      },
      text: (x: number, y: number, text: string, style?: Record<string, unknown>) => {
        const obj = new MockDisplayObject(this, 'text', x, y, '', text, style);
        this.createdObjects.push(obj);
        return obj;
      },
      graphics: () => {
        const obj = new MockDisplayObject(this, 'graphics');
        this.createdObjects.push(obj);
        return obj;
      },
      zone: (x: number, y: number, w: number, h: number) => {
        const obj = new MockDisplayObject(this, 'zone', x, y).setSize(w, h);
        this.createdObjects.push(obj);
        return obj;
      },
    };
    private active = false;
    sys = {
      settings: { status: MOCK_SCENE_STATUS.PENDING as number },
      isActive: () => this.active,
    };
    scene = {
      isActive: () => this.active,
    };

    constructor(config?: { key?: string }) {
      this.sceneKey = config?.key ?? 'MockScene';
    }

    __setActive(v: boolean): void {
      this.active = v;
      this.sys.settings.status = v ? MOCK_SCENE_STATUS.RUNNING : MOCK_SCENE_STATUS.SHUTDOWN;
    }
  }

  class MockPhaserGame {
    events = new MockEventEmitter();
    canvas = {
      width: 1280,
      height: 720,
      style: { display: '', width: '', height: '' },
      parentElement: {
        getBoundingClientRect: () => ({ width: 1280, height: 720 }),
      },
    };
    loop = { rawDelta: 16 };
    registryMap = new Map<string, unknown>();
    registry = {
      set: (k: string, v: unknown) => this.registryMap.set(k, v),
      get: (k: string) => this.registryMap.get(k),
    };
    scale = {
      width: 1280,
      height: 720,
      resize: (w: number, h: number) => {
        this.scale.width = w;
        this.scale.height = h;
        this.canvas.width = w;
        this.canvas.height = h;
      },
    };
    renderer = {
      width: 1280,
      height: 720,
      resize: (w: number, h: number) => {
        this.renderer.width = w;
        this.renderer.height = h;
      },
    };
    private readonly scenes = new Map<string, MockPhaserScene>();
    scene = {
      isActive: (key: string) => this.scenes.get(key)?.scene.isActive() ?? false,
      start: (key: string, data?: unknown) => {
        const s = this.scenes.get(key) as
          | (MockPhaserScene & {
              init?: (d?: unknown) => void;
              preload?: () => void;
              create?: () => void;
            })
          | undefined;
        if (!s) return;
        s.createdObjects = [];
        s.cameraCenters = [];
        s.time = new MockClock();
        s.__setActive(true);
        s.init?.(data);
        s.preload?.();
        s.create?.();
      },
      stop: (key: string) => {
        const s = this.scenes.get(key);
        if (!s) return;
        s.__setActive(false);
        s.events.emit('shutdown');
      },
    };

    constructor(config: { scene?: MockPhaserScene[] }) {
      for (const s of config.scene ?? []) {
        s.game = this;
        this.scenes.set(s.sceneKey, s);
      }
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

  return { MOCK_SCENE_STATUS, MockPhaserScene, MockPhaserGame, mockTexturesDisabled };
});

vi.mock('phaser', () => ({
  default: {
    AUTO: 0,
    BlendModes: {
      SKIP_CHECK: -1,
      NORMAL: 0,
      ADD: 1,
      MULTIPLY: 2,
      SCREEN: 3,
    },
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

import {
  ASSET_MANIFEST,
  getShipHardpoints,
  getShipSplitSlice,
  normalizeShipManifestKey,
} from '../src/assets/manifest';
import {
  ALL_SFX_KINDS,
  SoundEngine,
  soundEngine,
  type SfxKind,
} from '../src/audio/soundEngine';
import type { EnemyArchetype } from '../src/data/nodes';
import { DEFAULT_SETTINGS, createInitialProgression, type GameSettings } from '../src/domain/progression';
import {
  BaseScene,
  OVERLAY_QUADRANT_BOUNDS,
  solveArticulatedCranePose,
  stepOverlayTransition,
  type V2BaseDioramaState,
} from '../src/scenes/BaseScene';
import { PhaserHost } from '../src/scenes/PhaserHost';
import type { V2EnemyUnitSpec } from '../src/v2/data/enemies';
import { V2_SHIP_ORDER } from '../src/v2/data/ships';
import type { V2CombatRoundLog, V2CombatSimulation } from '../src/v2/domain/types';
import {
  VFX_HIT_FLASH_DURATION_MS,
  VFX_HIT_MILD_TINT,
  VFX_MAX_ACTIVE_PARTICLES,
  VFX_MAX_PARTICLES_PER_BURST,
  VFX_MAX_SHAKE_MS,
  VFX_MAX_SHAKE_PX,
  V2CombatScene,
  VfxParticlePool,
  allocateNonOverlappingPopupPos,
  computeHitstopDurationMs,
  computeHpBarTickRatios,
  computeThreeLayerBeamStrokes,
  getDamagePopupStyle,
  resolveHitFlashDecision,
  type V2StagePlayback,
} from '../src/v2/scenes/V2CombatScene';

// ---------------------------------------------------------------------------
// Self-Contained Mock WebAudio Context (for A10 verification in Node)
// ---------------------------------------------------------------------------

interface ParamEvent {
  readonly op: 'setValueAtTime' | 'linearRampToValueAtTime' | 'exponentialRampToValueAtTime' | 'setTargetAtTime' | 'cancelScheduledValues';
  readonly value: number;
  readonly time: number;
  readonly tau?: number;
}

class MockAudioParam {
  value: number;
  readonly events: ParamEvent[] = [];

  constructor(initial = 0) {
    this.value = initial;
  }

  setValueAtTime(value: number, startTime: number): this {
    this.value = value;
    this.events.push({ op: 'setValueAtTime', value, time: startTime });
    return this;
  }

  linearRampToValueAtTime(value: number, endTime: number): this {
    this.value = value;
    this.events.push({ op: 'linearRampToValueAtTime', value, time: endTime });
    return this;
  }

  exponentialRampToValueAtTime(value: number, endTime: number): this {
    this.value = value;
    this.events.push({ op: 'exponentialRampToValueAtTime', value, time: endTime });
    return this;
  }

  setTargetAtTime(target: number, startTime: number, timeConstant: number): this {
    this.value = target;
    this.events.push({ op: 'setTargetAtTime', value: target, time: startTime, tau: timeConstant });
    return this;
  }

  cancelScheduledValues(cancelTime: number): this {
    this.events.push({ op: 'cancelScheduledValues', value: this.value, time: cancelTime });
    return this;
  }
}

class MockAudioNode {
  readonly nodeKind: string;
  readonly connections: MockAudioNode[] = [];
  disconnected = false;

  constructor(kind: string) {
    this.nodeKind = kind;
  }

  connect(dest: MockAudioNode): MockAudioNode {
    this.connections.push(dest);
    return dest;
  }

  disconnect(): void {
    this.disconnected = true;
    this.connections.length = 0;
  }
}

class MockGainNode extends MockAudioNode {
  readonly gain = new MockAudioParam(1);
  constructor() {
    super('GainNode');
  }
}

class MockCompressorNode extends MockAudioNode {
  readonly threshold = new MockAudioParam(-24);
  readonly knee = new MockAudioParam(30);
  readonly ratio = new MockAudioParam(12);
  readonly attack = new MockAudioParam(0.003);
  readonly release = new MockAudioParam(0.25);
  constructor() {
    super('DynamicsCompressorNode');
  }
}

class MockBiquadFilterNode extends MockAudioNode {
  type: BiquadFilterType = 'lowpass';
  readonly frequency = new MockAudioParam(350);
  readonly Q = new MockAudioParam(1);
  constructor() {
    super('BiquadFilterNode');
  }
}

class MockOscillatorNode extends MockAudioNode {
  type: OscillatorType = 'sine';
  readonly frequency = new MockAudioParam(440);
  startedAt: number | null = null;
  stoppedAt: number | null = null;

  constructor() {
    super('OscillatorNode');
  }

  start(when = 0): void {
    this.startedAt = when;
  }

  stop(when = 0): void {
    this.stoppedAt = when;
  }
}

class MockAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private readonly channels: Float32Array[];

  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.channels = Array.from({ length: channels }, () => new Float32Array(length));
  }

  getChannelData(idx: number): Float32Array {
    return this.channels[idx];
  }
}

class MockBufferSourceNode extends MockAudioNode {
  buffer: MockAudioBuffer | null = null;
  loop = false;
  startedAt: number | null = null;
  stopped = false;

  constructor() {
    super('AudioBufferSourceNode');
  }

  start(when = 0): void {
    this.startedAt = when;
  }

  stop(): void {
    this.stopped = true;
  }
}

class MockAudioContext {
  state: AudioContextState = 'running';
  currentTime = 10.0;
  sampleRate = 44100;
  readonly destination = new MockAudioNode('AudioDestinationNode');
  readonly gains: MockGainNode[] = [];
  readonly compressors: MockCompressorNode[] = [];
  readonly filters: MockBiquadFilterNode[] = [];
  readonly oscillators: MockOscillatorNode[] = [];
  readonly bufferSources: MockBufferSourceNode[] = [];
  resumeCalls = 0;

  createGain(): MockGainNode {
    const g = new MockGainNode();
    this.gains.push(g);
    return g;
  }

  createDynamicsCompressor(): MockCompressorNode {
    const c = new MockCompressorNode();
    this.compressors.push(c);
    return c;
  }

  createBiquadFilter(): MockBiquadFilterNode {
    const f = new MockBiquadFilterNode();
    this.filters.push(f);
    return f;
  }

  createOscillator(): MockOscillatorNode {
    const o = new MockOscillatorNode();
    this.oscillators.push(o);
    return o;
  }

  createBuffer(channels: number, length: number, sampleRate: number): MockAudioBuffer {
    return new MockAudioBuffer(channels, length, sampleRate);
  }

  createBufferSource(): MockBufferSourceNode {
    const s = new MockBufferSourceNode();
    this.bufferSources.push(s);
    return s;
  }

  resume(): Promise<void> {
    this.resumeCalls += 1;
    this.state = 'running';
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Test Fixture Builders
// ---------------------------------------------------------------------------

interface SceneTestAccess {
  readonly createdObjects: {
    readonly kind: string;
    readonly depth: number;
    readonly blendMode: number;
    readonly visible: boolean;
    readonly alpha: number;
    readonly angle: number;
    readonly x: number;
    readonly y: number;
    readonly text: string;
    readonly style: Record<string, unknown>;
    readonly textureKey: string;
    readonly tint: number | null;
    readonly tintCalls: number[];
    readonly tintFillCalls: number[];
    readonly cropCalls: (readonly [number, number, number, number] | null)[];
    readonly lastCrop: readonly [number, number, number, number] | null;
    readonly drawOps: {
      readonly kind: string;
      readonly color?: number;
      readonly width?: number;
      readonly alpha?: number;
      readonly args: readonly number[];
    }[];
    readonly events: { emit: (ev: string, ...args: unknown[]) => boolean };
    readonly destroyed: boolean;
  }[];
  readonly cameraCenters: { readonly x: number; readonly y: number }[];
  readonly time: {
    readonly scheduledDelays: number[];
    readonly paused: boolean;
    advance: (ms: number) => void;
    getPendingCount: () => number;
    resetHistory: () => void;
  };
}

function asAccess(scene: unknown): SceneTestAccess {
  return scene as unknown as SceneTestAccess;
}

function makeEnemyUnit(overrides: Partial<V2EnemyUnitSpec> = {}): V2EnemyUnitSpec {
  return {
    enemyId: overrides.enemyId ?? 'enemy_1',
    name: overrides.name ?? '巡逻艇',
    spriteArchetype: overrides.spriteArchetype ?? 'scout',
    maxHp: overrides.maxHp ?? 20,
    damagePerRound: overrides.damagePerRound ?? 5,
    armor: overrides.armor ?? 0,
    pierceRatio: overrides.pierceRatio ?? 0,
    isBoss: overrides.isBoss ?? false,
    initialShield: overrides.initialShield ?? 0,
    maxShield: overrides.maxShield ?? 0,
    role: overrides.role,
  };
}

function makeSettings(overrides: Partial<GameSettings> = {}): GameSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
  };
}

function makeSimulation(
  units: readonly V2EnemyUnitSpec[],
  rounds: readonly V2CombatRoundLog[],
  overrides: Partial<V2CombatSimulation> = {}
): V2CombatSimulation {
  const lastRound = rounds[rounds.length - 1];
  return {
    resultId: overrides.resultId ?? 'test_sim',
    outcome: overrides.outcome ?? 'victory',
    stalemate: overrides.stalemate ?? false,
    targetPolicy: overrides.targetPolicy ?? 'weakest',
    roundsCount: rounds.length,
    startingPlayerHp: overrides.startingPlayerHp ?? 30,
    startingPlayerShield: overrides.startingPlayerShield ?? 8,
    finalPlayerHp: overrides.finalPlayerHp ?? (lastRound?.playerHpAfter ?? 30),
    repairApplied: overrides.repairApplied ?? 0,
    finalPlayerHpAfterRepair: overrides.finalPlayerHpAfterRepair ?? (lastRound?.playerHpAfter ?? 30),
    initialEnemies: units.map((u) => ({
      enemyId: u.enemyId,
      name: u.name,
      spriteArchetype: u.spriteArchetype,
      hp: u.maxHp,
      maxHp: u.maxHp,
      damagePerRound: u.damagePerRound,
      armor: u.armor,
      pierceRatio: u.pierceRatio,
      isBoss: u.isBoss,
      shield: u.initialShield ?? 0,
      maxShield: u.maxShield ?? u.initialShield ?? 0,
    })),
    rounds,
  };
}

function createWindowAudioHarness(options?: {
  audioCtxFactory?: () => MockAudioContext;
  omitAudioContext?: boolean;
}) {
  const originalWindow = (globalThis as { window?: unknown }).window;
  const createdContexts: MockAudioContext[] = [];
  const intervals = new Map<number, { fn: () => void; ms: number }>();
  let nextIntervalId = 1;

  const mockWindow: Record<string, unknown> = {
    setInterval: (fn: () => void, ms: number) => {
      const id = nextIntervalId++;
      intervals.set(id, { fn, ms });
      return id;
    },
    clearInterval: (id: number) => {
      intervals.delete(id);
    },
  };

  if (!options?.omitAudioContext) {
    mockWindow.AudioContext = function MockAudioContextCtor() {
      const ctx = options?.audioCtxFactory ? options.audioCtxFactory() : new MockAudioContext();
      createdContexts.push(ctx);
      return ctx;
    };
  }

  (globalThis as { window?: unknown }).window = mockWindow;

  return {
    createdContexts,
    intervals,
    tickIntervals: (times = 1) => {
      for (let i = 0; i < times; i++) {
        for (const entry of [...intervals.values()]) {
          entry.fn();
        }
      }
    },
    restore: () => {
      intervals.clear();
      if (originalWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = originalWindow;
      }
    },
  };
}

function mountCombatScene(playback: V2StagePlayback) {
  const scene = new V2CombatScene();
  const game = new MockPhaserGame({ scene: [scene as unknown as InstanceType<typeof MockPhaserScene>] });
  game.scene.start('V2CombatScene', { playback });
  return { scene, game, access: asAccess(scene) };
}

function mountBaseScene(initData: {
  v2State?: V2BaseDioramaState;
  state?: Parameters<BaseScene['setState']>[0];
  onBuildingClick?: (id: 'workbench' | 'display' | 'drydock') => void;
  onBerthClick?: () => void;
}) {
  const scene = new BaseScene();
  const game = new MockPhaserGame({ scene: [scene as unknown as InstanceType<typeof MockPhaserScene>] });
  game.scene.start('BaseScene', initData);
  return { scene, game, access: asAccess(scene) };
}

// ---------------------------------------------------------------------------
// Global Cleanup
// ---------------------------------------------------------------------------

let activeWindowCleanup: (() => void) | null = null;
const originalDocument = (globalThis as { document?: unknown }).document;

beforeEach(() => {
  mockTexturesDisabled.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  soundEngine.dispose();
  if (activeWindowCleanup) {
    activeWindowCleanup();
    activeWindowCleanup = null;
  }
  if (originalDocument === undefined) {
    delete (globalThis as { document?: unknown }).document;
  } else {
    (globalThis as { document?: unknown }).document = originalDocument;
  }
});

// ===========================================================================
// 1. A01 — Localized ADD Hit VFX, <=40ms Warm Tint & Shield-Only Absorb
// ===========================================================================
describe('A01 — Localized Hit VFX & Shield-Only Absorb (V2CombatScene)', () => {
  it('resolveHitFlashDecision enforces <=40ms warm tint on hull hits, zero hull tint on shield-only absorb, and no strobe in reducedMotion', () => {
    const hullHit = resolveHitFlashDecision({ shieldAbsorbed: 0, hullDamage: 6, reducedMotion: false });
    expect(hullHit.applyHullWarmTint).toBe(true);
    expect(hullHit.hullTintColor).toBe(VFX_HIT_MILD_TINT);
    expect(hullHit.hullTintDurationMs).toBeLessThanOrEqual(40);
    expect(hullHit.hullTintDurationMs).toBe(VFX_HIT_FLASH_DURATION_MS);
    expect(hullHit.spawnLocalizedGlow).toBe(true);
    expect(hullHit.glowKind).toBe('hull');

    const shieldOnly = resolveHitFlashDecision({ shieldAbsorbed: 5, hullDamage: 0, reducedMotion: false });
    expect(shieldOnly.flashShieldOnly).toBe(true);
    expect(shieldOnly.applyHullWarmTint).toBe(false);
    expect(shieldOnly.hullTintDurationMs).toBe(0);
    expect(shieldOnly.spawnLocalizedGlow).toBe(true);
    expect(shieldOnly.glowKind).toBe('shield');

    const reducedHull = resolveHitFlashDecision({ shieldAbsorbed: 0, hullDamage: 6, reducedMotion: true });
    expect(reducedHull.applyHullWarmTint).toBe(false);
    expect(reducedHull.hullTintDurationMs).toBe(0);
    expect(reducedHull.spawnLocalizedGlow).toBe(true);
  });

  it('never calls setTintFill on player, modules, or enemies; uses ADD impact glow, <=40ms warm tint, preserves stargate tint, and flashes ONLY shield on shield-only absorb', () => {
    const enemy = makeEnemyUnit({ enemyId: 'e_shield', maxHp: 20, initialShield: 10, maxShield: 10, spriteArchetype: 'frigate' });
    const round1ShieldOnly: V2CombatRoundLog = {
      round: 1,
      droneCountsByHangar: {},
      heavyChargingIds: [],
      playerAttacks: [
        {
          sourceKind: 'laser',
          sourceInstanceId: 'l1',
          targetEnemyId: 'e_shield',
          rawDamage: 4,
          appliedDamage: 4,
          armorBlocked: 0,
          shieldDamaged: 4, // 100% absorbed by enemy shield -> hullDmg === 0!
          targetHpAfter: 20,
          targetKilled: false,
        },
      ],
      enemyAttacks: [
        {
          enemyId: 'e_shield',
          rawDamage: 5,
          pierceDamage: 0,
          shieldAbsorbed: 5,
          hullDamage: 0, // 100% absorbed by player shield -> hullDamage === 0!
        },
      ],
      counterAttack: null,
      shieldAbsorbedTotal: 5,
      playerHpAfter: 30,
      playerShieldAfter: 3,
      enemiesAfter: [
        {
          enemyId: 'e_shield',
          name: enemy.name,
          spriteArchetype: 'frigate',
          hp: 20,
          maxHp: 20,
          damagePerRound: 5,
          armor: 0,
          pierceRatio: 0,
          shield: 6,
          maxShield: 10,
        },
      ],
    };

    const round2HullHit: V2CombatRoundLog = {
      round: 2,
      droneCountsByHangar: {},
      heavyChargingIds: [],
      playerAttacks: [
        {
          sourceKind: 'heavy',
          sourceInstanceId: 'h1',
          targetEnemyId: 'e_shield',
          rawDamage: 12,
          appliedDamage: 12,
          armorBlocked: 0,
          shieldDamaged: 6, // 6 shield + 6 hull
          targetHpAfter: 14,
          targetKilled: false,
        },
      ],
      enemyAttacks: [
        {
          enemyId: 'e_shield',
          rawDamage: 8,
          pierceDamage: 0,
          shieldAbsorbed: 3,
          hullDamage: 5,
          intentKind: 'heavy_volley',
        },
      ],
      counterAttack: null,
      shieldAbsorbedTotal: 3,
      playerHpAfter: 25,
      playerShieldAfter: 0,
      enemiesAfter: [
        {
          enemyId: 'e_shield',
          name: enemy.name,
          spriteArchetype: 'frigate',
          hp: 14,
          maxHp: 20,
          damagePerRound: 5,
          armor: 0,
          pierceRatio: 0,
          shield: 0,
          maxShield: 10,
        },
      ],
    };

    const sim = makeSimulation([enemy], [round1ShieldOnly, round2HullHit], {
      startingPlayerHp: 30,
      startingPlayerShield: 8,
    });

    const { scene, access } = mountCombatScene({
      shipId: 'stargate_cruiser',
      shipVisualSpec: {
        shipId: 'stargate_cruiser',
        laserCount: 1,
        laserBoosted: false,
        laserImproved: false,
        heavyCount: 1,
        heavyBoosted: false,
        heavyImproved: false,
        hangarCount: 0,
        hangarBoosted: false,
        hangarMaxDrones: 0,
        flakCount: 0,
        shieldCount: 1,
        effectiveShield: 8,
        hasCounter: false,
        counterActive: false,
        counterImproved: false,
        hasRepairDrone: false,
        hasSealedReactor: false,
        escapePodCount: 0,
        cargoCellCount: 0,
        cargoMassTier: 0,
        mountSummaryTags: [],
      },
      sectorIndex: 1,
      eventBackdrop: null,
      units: [enemy],
      simulation: sim,
      settings: makeSettings({ reducedMotion: false, combatSpeed: 1 }),
    });

    // Trigger Round 1 (shield-only absorb on BOTH sides!)
    scene.update(0, 260);
    // Advance through player_impact (180ms)
    access.time.advance(180);
    scene.update(180, 16);
    const snapR1PlayerImpact = scene.getStagePresentationSnapshot();
    expect(snapR1PlayerImpact.enemiesState[0].shieldArcLife).toBeGreaterThan(0);
    expect(snapR1PlayerImpact.enemiesState[0].flashMs).toBe(0); // NEVER tint enemy hull on shield-only absorb!
    expect(snapR1PlayerImpact.activeImpactGlows).toBeGreaterThan(0);

    // Advance through enemy_impact (510ms)
    access.time.advance(330);
    scene.update(510, 16);
    const snapR1EnemyImpact = scene.getStagePresentationSnapshot();
    expect(snapR1EnemyImpact.playerTint).toBe(0xe6f8ff); // stargate_cruiser base tint preserved, NO hit flash!

    const addGfx = access.createdObjects.find((o) => o.kind === 'graphics' && o.depth === 8);
    expect(addGfx).toBeDefined();
    expect(addGfx!.blendMode).toBe(1); // Phaser.BlendModes.ADD
    expect(addGfx!.drawOps.some((op) => op.kind === 'arc')).toBe(true); // Curved shield barrier flashed!

    // Finish Round 1 and trigger Round 2 (actual hull damage on BOTH sides)
    access.time.advance(100);
    scene.update(610, 400);
    scene.update(1010, 400);
    scene.update(1410, 200);
    // Beat 2: player_impact (180ms) -> enemy gets <=40ms mild warm tint
    access.time.advance(180);
    scene.update(1590, 16);
    const snapR2EnemyHit = scene.getStagePresentationSnapshot();
    expect(snapR2EnemyHit.enemiesState[0].flashMs).toBeGreaterThan(0);
    expect(snapR2EnemyHit.enemiesState[0].flashMs).toBeLessThanOrEqual(40);
    // After 40ms more, enemy warm tint MUST have cleared!
    scene.update(1630, 40);
    expect(scene.getStagePresentationSnapshot().enemiesState[0].flashMs).toBe(0);

    // Beat 4: enemy_impact (510ms) -> player gets <=40ms mild warm tint
    access.time.advance(330);
    scene.update(1920, 16);
    expect(scene.getStagePresentationSnapshot().playerTint).toBe(VFX_HIT_MILD_TINT);
    // Verify camera shake stays strictly within Art Spec §10 (<= 3.0px from viewport center 640, 360)
    for (const c of access.cameraCenters) {
      expect(Math.abs(c.x - 640)).toBeLessThanOrEqual(VFX_MAX_SHAKE_PX + 1e-6);
      expect(Math.abs(c.y - 360)).toBeLessThanOrEqual(VFX_MAX_SHAKE_PX + 1e-6);
    }
    // After 40ms, player warm tint expires and restores stargate_cruiser base tint 0xe6f8ff!
    scene.update(1960, 40);
    expect(scene.getStagePresentationSnapshot().playerTint).toBe(0xe6f8ff);

    // ZERO setTintFill calls anywhere across ALL sprites created in the scene!
    const allTintFillCalls = access.createdObjects.flatMap((o) => o.tintFillCalls);
    expect(allTintFillCalls).toEqual([]);
  });

  it('respects reducedMotion by suppressing hull strobing and camera shake while keeping localized impact glow', () => {
    const enemy = makeEnemyUnit({ enemyId: 'e_rm', maxHp: 15 });
    const r1: V2CombatRoundLog = {
      round: 1,
      droneCountsByHangar: {},
      heavyChargingIds: [],
      playerAttacks: [
        { sourceKind: 'heavy', sourceInstanceId: 'h1', targetEnemyId: 'e_rm', rawDamage: 8, appliedDamage: 8, armorBlocked: 0, targetHpAfter: 7, targetKilled: false },
      ],
      enemyAttacks: [
        { enemyId: 'e_rm', rawDamage: 5, pierceDamage: 0, shieldAbsorbed: 0, hullDamage: 5, intentKind: 'heavy_volley' },
      ],
      counterAttack: null,
      shieldAbsorbedTotal: 0,
      playerHpAfter: 25,
      playerShieldAfter: 0,
      enemiesAfter: [{ enemyId: 'e_rm', name: enemy.name, spriteArchetype: 'scout', hp: 7, maxHp: 15, damagePerRound: 5, armor: 0, pierceRatio: 0 }],
    };
    const sim = makeSimulation([enemy], [r1], { startingPlayerHp: 30, startingPlayerShield: 0 });
    const { scene, access } = mountCombatScene({
      shipId: 'cannon_skiff',
      sectorIndex: 1,
      eventBackdrop: null,
      units: [enemy],
      simulation: sim,
      settings: makeSettings({ reducedMotion: true }),
    });

    scene.update(0, 260);
    access.time.advance(180);
    scene.update(180, 16);
    expect(scene.getStagePresentationSnapshot().enemiesState[0].flashMs).toBe(0);
    expect(scene.getStagePresentationSnapshot().activeImpactGlows).toBeGreaterThan(0);

    access.time.advance(330);
    scene.update(510, 16);
    expect(scene.getStagePresentationSnapshot().playerTint).toBeNull();
    for (const c of access.cameraCenters) {
      expect(c.x).toBe(640);
      expect(c.y).toBe(360);
    }
    expect(VFX_MAX_SHAKE_MS).toBeLessThanOrEqual(120);
  });
});

// ===========================================================================
// 2. A02 — Multi-Beat Combat Choreography & Timer Hygiene
// ===========================================================================
describe('A02 — Multi-Beat Combat Choreography & Timer Hygiene (V2CombatScene)', () => {
  function buildThreeRoundScenario() {
    const enemy = makeEnemyUnit({ enemyId: 'e_multi', maxHp: 24, damagePerRound: 4 });
    const makeRound = (round: number, enemyHp: number, playerHp: number, enemyFires = true): V2CombatRoundLog => ({
      round,
      droneCountsByHangar: {},
      heavyChargingIds: [],
      playerAttacks: [
        {
          sourceKind: 'laser',
          sourceInstanceId: 'l1',
          targetEnemyId: 'e_multi',
          rawDamage: 8,
          appliedDamage: 8,
          armorBlocked: 0,
          targetHpAfter: enemyHp,
          targetKilled: enemyHp <= 0,
        },
      ],
      enemyAttacks: enemyFires
        ? [{ enemyId: 'e_multi', rawDamage: 4, pierceDamage: 0, shieldAbsorbed: 0, hullDamage: 4 }]
        : [],
      counterAttack: null,
      shieldAbsorbedTotal: 0,
      playerHpAfter: playerHp,
      playerShieldAfter: 0,
      enemiesAfter: [
        {
          enemyId: 'e_multi',
          name: enemy.name,
          spriteArchetype: 'scout',
          hp: enemyHp,
          maxHp: 24,
          damagePerRound: 4,
          armor: 0,
          pierceRatio: 0,
        },
      ],
    });

    // Note: Round 3 tests simultaneous combat death (enemy reduced to 0 HP STILL fires in enemyAttacks!)
    const rounds = [makeRound(1, 16, 26, true), makeRound(2, 8, 22, true), makeRound(3, 0, 18, true)];
    return {
      enemy,
      sim: makeSimulation([enemy], rounds, { startingPlayerHp: 30, startingPlayerShield: 0 }),
    };
  }

  it('schedules >= 3 timed beats per round via delayedCall, halves delays at 2x speed, and handles simultaneous death cleanly', () => {
    const { enemy, sim } = buildThreeRoundScenario();
    const stepLog1x: number[] = [];
    const { scene: scene1x, access: acc1x } = mountCombatScene({
      shipId: 'cannon_skiff',
      sectorIndex: 1,
      eventBackdrop: null,
      units: [enemy],
      simulation: sim,
      settings: makeSettings({ combatSpeed: 1 }),
      onRoundStep: (idx) => stepLog1x.push(idx),
    });

    acc1x.time.resetHistory();
    scene1x.update(0, 260); // triggers Round 0
    const delays1x = [...acc1x.time.scheduledDelays];
    expect(delays1x.length).toBeGreaterThanOrEqual(4);
    expect(delays1x).toEqual([0, 120, 180, 450, 510, 590]);
    expect(delays1x[2] - delays1x[1]).toBeLessThanOrEqual(200); // Fire -> Impact <= 200ms

    // 2x speed must halve every non-zero delay cleanly
    const { scene: scene2x, access: acc2x } = mountCombatScene({
      shipId: 'cannon_skiff',
      sectorIndex: 1,
      eventBackdrop: null,
      units: [enemy],
      simulation: sim,
      settings: makeSettings({ combatSpeed: 2 }),
    });
    acc2x.time.resetHistory();
    scene2x.update(0, 260);
    expect(acc2x.time.scheduledDelays).toEqual([0, 60, 90, 225, 255, 295]);

    // Step full 1x battle to Round 3 simultaneous death: enemy stays alive through Beat 3 (450ms) and dies at Beat 5 (590ms)
    acc1x.time.advance(600);
    scene1x.update(600, 400);
    scene1x.update(1000, 400);
    scene1x.update(1400, 200); // triggers Round 1
    acc1x.time.advance(600);
    scene1x.update(2000, 400);
    scene1x.update(2400, 400);
    scene1x.update(2800, 200); // triggers Round 2 (simultaneous kill!)
    acc1x.time.advance(450); // through enemy_fire
    scene1x.update(3250, 16);
    expect(scene1x.getStagePresentationSnapshot().enemiesState[0].dead).toBe(false); // still fires parting shot!
    acc1x.time.advance(160); // through resolve (590ms)
    scene1x.update(3410, 16);
    expect(scene1x.getStagePresentationSnapshot().enemiesState[0].dead).toBe(true);
    expect(stepLog1x).toEqual([0, 1, 2]);
    expect(scene1x.getStagePresentationSnapshot().playerHp).toBe(18);
  });

  it('skipPlayback(), setPaused(true), setPlayback(), and SHUTDOWN cancel all pending timers with zero double-application and identical outcomes', () => {
    const { enemy, sim } = buildThreeRoundScenario();
    const stepsSkip: number[] = [];
    const onCompleteSkip = vi.fn();
    const { scene, access } = mountCombatScene({
      shipId: 'cannon_skiff',
      sectorIndex: 1,
      eventBackdrop: null,
      units: [enemy],
      simulation: sim,
      settings: makeSettings({ combatSpeed: 1 }),
      onRoundStep: (idx) => stepsSkip.push(idx),
      onComplete: onCompleteSkip,
    });

    // Trigger Round 0, advance partway (150ms — mid-round!), then skipPlayback()
    scene.update(0, 260);
    access.time.advance(150);
    expect(access.time.getPendingCount()).toBeGreaterThan(0);

    scene.skipPlayback();
    expect(access.time.getPendingCount()).toBe(0);
    expect(scene.getStagePresentationSnapshot().pendingTimers).toBe(0);
    expect(stepsSkip).toEqual([0, 1, 2]); // Exact once-per-round reporting!
    expect(onCompleteSkip).toHaveBeenCalledTimes(1);
    expect(scene.getStagePresentationSnapshot().playerHp).toBe(18);
    expect(scene.getStagePresentationSnapshot().enemiesState[0].hp).toBe(0);

    // Advancing clock 2000ms after skip MUST NOT fire any leaked callback
    access.time.advance(2000);
    expect(stepsSkip).toEqual([0, 1, 2]);
    expect(onCompleteSkip).toHaveBeenCalledTimes(1);

    // Test mid-round setPaused(true) + resume
    const stepsPause: number[] = [];
    const { scene: sceneP, access: accP, game: gameP } = mountCombatScene({
      shipId: 'cannon_skiff',
      sectorIndex: 1,
      eventBackdrop: null,
      units: [enemy],
      simulation: sim,
      settings: makeSettings({ combatSpeed: 1 }),
      onRoundStep: (idx) => stepsPause.push(idx),
    });
    sceneP.update(0, 260);
    accP.time.advance(130);
    expect(accP.time.getPendingCount()).toBeGreaterThan(0);
    sceneP.setPaused(true);
    expect(accP.time.getPendingCount()).toBe(0);
    expect(stepsPause).toEqual([0]);

    // Test SHUTDOWN cleanup mid-round
    sceneP.setPaused(false);
    sceneP.update(1000, 500);
    sceneP.update(1500, 500); // launches Round 1
    expect(accP.time.getPendingCount()).toBeGreaterThan(0);
    gameP.scene.stop('V2CombatScene');
    expect(accP.time.getPendingCount()).toBe(0);
    accP.time.advance(2000);
    expect(stepsPause).toEqual([0]); // Round 1 aborted on SHUTDOWN, never leaked!
  });

  it('preserves tactical pauseAtRound boundary, SwiftShader rawDelta pacing, and document.hidden pause guard', () => {
    const { enemy, sim } = buildThreeRoundScenario();
    const steps: number[] = [];
    const onPause = vi.fn();
    const onComplete = vi.fn();

    const { scene, game, access } = mountCombatScene({
      shipId: 'cannon_skiff',
      sectorIndex: 1,
      eventBackdrop: null,
      units: [enemy],
      simulation: sim,
      pauseAtRound: 2, // Pause BEFORE Round 2 (1-indexed)
      settings: makeSettings({ combatSpeed: 1 }),
      onRoundStep: (idx) => steps.push(idx),
      onPauseForDecision: onPause,
      onComplete,
    });

    // document.hidden = true must pause progression completely
    (globalThis as { document?: unknown }).document = { hidden: true };
    game.loop.rawDelta = 400;
    scene.update(0, 400);
    expect(access.time.scheduledDelays).toHaveLength(0);

    // Visible + SwiftShader low-FPS (rawDelta=350ms, delta=16ms) advances cleanly without skipping pauseAtRound
    (globalThis as { document?: unknown }).document = { hidden: false };
    game.loop.rawDelta = 350;
    scene.update(16, 16); // executes Round 0
    scene.update(32, 16);
    scene.update(48, 16);
    scene.update(64, 16); // roundTimerMs crosses 0 -> flushes Round 0, hits pauseAtRound=2!

    expect(steps).toEqual([0]);
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();

    // Calling skipPlayback while decisionPaused MUST NOT bypass decision
    scene.skipPlayback();
    expect(steps).toEqual([0]);
    expect(onComplete).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3. A03 — 3-Layer Beams, Tracers, Muzzle Flashes, Capped Particle Pool & Hitstop
// ===========================================================================
describe('A03 — 3-Layer Beams, Tracers, Muzzle Flashes, Particle Budget & Hitstop', () => {
  it('enforces Art Spec §10 particle pool caps (<= 24/burst, <= 100 active, 0 in lowQuality)', () => {
    const pool = new VfxParticlePool();

    // Single oversized burst request strictly capped at 24
    const firstBurst = pool.spawnBurst({
      kind: 'spark',
      x: 100,
      y: 100,
      count: 60,
      color: 0xf6b852,
      lowQuality: false,
    });
    expect(firstBurst).toBe(VFX_MAX_PARTICLES_PER_BURST);
    expect(firstBurst).toBeLessThanOrEqual(24);
    expect(pool.getActiveCount()).toBe(24);

    // Rapid stress bursts strictly cap total active particles at <= 100
    for (let i = 0; i < 15; i++) {
      const spawned = pool.spawnBurst({
        kind: i % 2 === 0 ? 'shield_shard' : 'debris',
        x: 200,
        y: 150,
        count: 24,
        color: 0x62d6df,
        lowQuality: false,
      });
      expect(spawned).toBeLessThanOrEqual(24);
      expect(pool.getActiveCount()).toBeLessThanOrEqual(VFX_MAX_ACTIVE_PARTICLES);
    }
    expect(pool.getActiveCount()).toBe(100);

    // lowQuality spawns 0 decorative particles
    pool.clear();
    const lowQSpawned = pool.spawnBurst({
      kind: 'spark',
      x: 100,
      y: 100,
      count: 24,
      color: 0xf6b852,
      lowQuality: true,
    });
    expect(lowQSpawned).toBe(0);
    expect(pool.getActiveCount()).toBe(0);
  });

  it('computes 3-layer composite beam strokes & hitstop durations in [40, 80]ms (0ms in reducedMotion)', () => {
    const strokes = computeThreeLayerBeamStrokes(6, 0xf6b852, 1);
    expect(strokes.outerGlow.width).toBeGreaterThan(strokes.coloredCore.width);
    expect(strokes.coloredCore.width).toBeGreaterThan(strokes.whiteCenter.width);
    expect(strokes.whiteCenter.color).toBe(0xffffff);

    const heavyHs = computeHitstopDurationMs({ hasHeavyHit: true, hasLethalKill: false, hasBossPhase: false, isBossKill: false, reducedMotion: false });
    const lethalHs = computeHitstopDurationMs({ hasHeavyHit: false, hasLethalKill: true, hasBossPhase: false, isBossKill: false, reducedMotion: false });
    const bossHs = computeHitstopDurationMs({ hasHeavyHit: false, hasLethalKill: true, hasBossPhase: false, isBossKill: true, reducedMotion: false });
    const reducedHs = computeHitstopDurationMs({ hasHeavyHit: true, hasLethalKill: true, hasBossPhase: true, isBossKill: true, reducedMotion: true });

    expect(heavyHs).toBeGreaterThanOrEqual(40);
    expect(heavyHs).toBeLessThanOrEqual(80);
    expect(lethalHs).toBeGreaterThanOrEqual(40);
    expect(lethalHs).toBeLessThanOrEqual(80);
    expect(bossHs).toBeGreaterThanOrEqual(40);
    expect(bossHs).toBeLessThanOrEqual(80);
    expect(reducedHs).toBe(0);
  });

  it('renders 3-layer beams, heavy tracers, muzzle flashes, pooled particles & hitstop in live V2CombatScene, and disables particles in lowQuality', () => {
    const enemy = makeEnemyUnit({ enemyId: 'e_heavy', maxHp: 12, initialShield: 4, maxShield: 4 });
    const round1: V2CombatRoundLog = {
      round: 1,
      droneCountsByHangar: {},
      heavyChargingIds: [],
      playerAttacks: [
        { sourceKind: 'heavy', sourceInstanceId: 'h1', targetEnemyId: 'e_heavy', rawDamage: 16, appliedDamage: 16, armorBlocked: 0, shieldDamaged: 4, targetHpAfter: 0, targetKilled: true },
      ],
      enemyAttacks: [],
      counterAttack: null,
      shieldAbsorbedTotal: 0,
      playerHpAfter: 30,
      playerShieldAfter: 0,
      enemiesAfter: [{ enemyId: 'e_heavy', name: enemy.name, spriteArchetype: 'scout', hp: 0, maxHp: 12, damagePerRound: 5, armor: 0, pierceRatio: 0 }],
    };
    const sim = makeSimulation([enemy], [round1]);

    // Normal quality
    const { scene, access } = mountCombatScene({
      shipId: 'cannon_skiff',
      sectorIndex: 1,
      eventBackdrop: null,
      units: [enemy],
      simulation: sim,
      settings: makeSettings({ lowQuality: false, reducedMotion: false }),
    });
    scene.update(0, 260);
    access.time.advance(120); // player_fire
    scene.update(120, 16);
    const snapFire = scene.getStagePresentationSnapshot();
    expect(snapFire.activeBeams).toBe(1);
    expect(snapFire.activeTracers).toBe(1);
    expect(snapFire.activeMuzzleFlashes).toBe(1);

    // Check 3-layer beam draw ops across addFxGraphics (depth 8) & fxGraphics (depth 7)
    const fxGfx = access.createdObjects.find((o) => o.kind === 'graphics' && o.depth === 7)!;
    const addGfx = access.createdObjects.find((o) => o.kind === 'graphics' && o.depth === 8)!;
    const addBeamStrokes = addGfx.drawOps.filter((op) => op.kind === 'strokePath');
    const fxBeamStrokes = fxGfx.drawOps.filter((op) => op.kind === 'strokePath');
    expect(addBeamStrokes.length).toBeGreaterThanOrEqual(2); // outer glow + white center
    expect(addBeamStrokes.some((op) => op.color === 0xffffff)).toBe(true);
    expect(fxBeamStrokes.length).toBeGreaterThanOrEqual(1); // colored mid core

    // player_impact -> sparks + shield shards + hitstop (40-80ms)
    access.time.advance(60);
    const snapImpact = scene.getStagePresentationSnapshot();
    expect(snapImpact.activeParticles).toBeGreaterThan(0);
    expect(snapImpact.activeParticles).toBeLessThanOrEqual(100);
    expect(snapImpact.lastTriggeredHitstopMs).toBeGreaterThanOrEqual(40);
    expect(snapImpact.lastTriggeredHitstopMs).toBeLessThanOrEqual(80);
    expect(snapImpact.hitstopRemainingMs).toBeGreaterThan(0);

    // lowQuality: 0 decorative particles while beams & outcomes remain intact
    const { scene: lowQScene, access: lowQAcc } = mountCombatScene({
      shipId: 'cannon_skiff',
      sectorIndex: 1,
      eventBackdrop: null,
      units: [enemy],
      simulation: sim,
      settings: makeSettings({ lowQuality: true, reducedMotion: false }),
    });
    lowQScene.update(0, 260);
    lowQAcc.time.advance(120);
    lowQScene.update(120, 16);
    expect(lowQScene.getStagePresentationSnapshot().activeBeams).toBe(1);
    lowQAcc.time.advance(60);
    lowQScene.update(180, 16);
    expect(lowQScene.getStagePresentationSnapshot().activeParticles).toBe(0);
  });
});

// ===========================================================================
// 4. A04 + A06-code — Death Choreography, Trailing HP Bars & Tiered Popups
// ===========================================================================
describe('A04 + A06-code — Split-Hull Death Breakup, Trailing HP Bars & Tiered Non-Overlapping Popups', () => {
  it('spawns cropped split-hull drifting halves & micro-explosions on death, supports future A06 dedicated plate keys, and snaps cleanly in reducedMotion', () => {
    const boss = makeEnemyUnit({ enemyId: 'b_hulk', name: '铁砧号', spriteArchetype: 'hulk', maxHp: 10, isBoss: true });
    const roundKill: V2CombatRoundLog = {
      round: 1,
      droneCountsByHangar: {},
      heavyChargingIds: [],
      playerAttacks: [
        { sourceKind: 'heavy', sourceInstanceId: 'h1', targetEnemyId: 'b_hulk', rawDamage: 12, appliedDamage: 12, armorBlocked: 0, targetHpAfter: 0, targetKilled: true },
      ],
      enemyAttacks: [],
      counterAttack: null,
      shieldAbsorbedTotal: 0,
      playerHpAfter: 30,
      playerShieldAfter: 0,
      enemiesAfter: [{ enemyId: 'b_hulk', name: boss.name, spriteArchetype: 'hulk', hp: 0, maxHp: 10, damagePerRound: 6, armor: 0, pierceRatio: 0, isBoss: true }],
    };
    const sim = makeSimulation([boss], [roundKill]);

    // Standard cropped split-hull breakup
    const { scene, access } = mountCombatScene({
      shipId: 'cannon_skiff',
      sectorIndex: 1,
      eventBackdrop: null,
      units: [boss],
      simulation: sim,
      settings: makeSettings({ reducedMotion: false }),
    });
    scene.update(0, 260);
    access.time.advance(180); // kills boss immediately (no enemyAttacks)
    expect(scene.getStagePresentationSnapshot().activeDeathChoreos).toBe(1);

    const croppedImages = access.createdObjects.filter((o) => o.kind === 'image' && o.cropCalls.length > 0);
    expect(croppedImages).toHaveLength(2);
    const [foreImg, aftImg] = croppedImages;
    const foreCrop = foreImg.lastCrop!;
    const aftCrop = aftImg.lastCrop!;
    expect(foreCrop[0]).toBe(0);
    expect(aftCrop[0]).toBe(foreCrop[2]); // contiguous non-overlapping split!
    expect(foreCrop[2] + aftCrop[2]).toBe(512);

    // Advance past hitstop & verify halves drift apart + rotate + stagger micro-explosions
    const startForeX = foreImg.x;
    const startAftX = aftImg.x;
    scene.update(260, 100); // clear 80ms hitstop
    scene.update(400, 120);
    scene.update(540, 120);
    expect(foreImg.x).toBeLessThan(startForeX);
    expect(aftImg.x).toBeGreaterThan(startAftX);
    expect(foreImg.angle).toBeLessThan(0);
    expect(aftImg.angle).toBeGreaterThan(0);
    expect(scene.getStagePresentationSnapshot().activeRings).toBeGreaterThanOrEqual(2);

    // Future A06 dedicated plate key hook (without touching unbacked files on disk!)
    const originalHulkSlice = ASSET_MANIFEST['ship.enemy.hulk'].splitSlice;
    try {
      (ASSET_MANIFEST['ship.enemy.hulk'] as { splitSlice?: unknown }).splitSlice = {
        splitRatioX: 0.52,
        foreHalfKey: 'ship.enemy.hulk.fore_a06',
        aftHalfKey: 'ship.enemy.hulk.aft_a06',
      };
      const { scene: a06Scene, access: a06Acc } = mountCombatScene({
        shipId: 'cannon_skiff',
        sectorIndex: 1,
        eventBackdrop: null,
        units: [boss],
        simulation: sim,
        settings: makeSettings({ reducedMotion: false }),
      });
      a06Scene.update(0, 260);
      a06Acc.time.advance(180);
      const plateFore = a06Acc.createdObjects.find((o) => o.textureKey === 'ship.enemy.hulk.fore_a06');
      const plateAft = a06Acc.createdObjects.find((o) => o.textureKey === 'ship.enemy.hulk.aft_a06');
      expect(plateFore).toBeDefined();
      expect(plateAft).toBeDefined();
      expect(plateFore!.cropCalls).toHaveLength(0);
      expect(plateAft!.cropCalls).toHaveLength(0);
    } finally {
      (ASSET_MANIFEST['ship.enemy.hulk'] as { splitSlice?: unknown }).splitSlice = originalHulkSlice;
    }

    // reducedMotion: instant clean defeat, 0 split-hull drift sprites
    const { scene: rmScene, access: rmAcc } = mountCombatScene({
      shipId: 'cannon_skiff',
      sectorIndex: 1,
      eventBackdrop: null,
      units: [boss],
      simulation: sim,
      settings: makeSettings({ reducedMotion: true }),
    });
    rmScene.update(0, 260);
    rmAcc.time.advance(180);
    expect(rmScene.getStagePresentationSnapshot().activeDeathChoreos).toBe(0);
    expect(rmScene.getStagePresentationSnapshot().enemiesState[0].dead).toBe(true);
  });

  it('drains trailing damage ghost HP bars smoothly with tick marks and emits distinct non-overlapping tiered popups', () => {
    expect(computeHpBarTickRatios(30)).toEqual([5 / 30, 10 / 30, 15 / 30, 20 / 30, 25 / 30]);
    expect(computeHpBarTickRatios(120).length).toBeLessThanOrEqual(8);

    // Verify all 4 core damage tiers have distinct visual styles
    const styles = (['normal', 'armor', 'pierce', 'counter'] as const).map(getDamagePopupStyle);
    expect(new Set(styles.map((s) => s.color)).size).toBe(4);
    expect(new Set(styles.map((s) => s.fontSize)).size).toBeGreaterThanOrEqual(3);

    // Pure non-overlapping allocator check
    const placed: { x: number; y: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const p = allocateNonOverlappingPopupPos({
        desiredX: 600,
        desiredY: 200,
        existing: placed,
        viewW: 1280,
        viewH: 720,
      });
      for (const prev of placed) {
        expect(Math.abs(p.x - prev.x) >= 42 || Math.abs(p.y - prev.y) >= 18).toBe(true);
      }
      placed.push(p);
    }

    // Live V2CombatScene: simultaneous normal + armor + pierce + counter hits on same enemy + enemy damage to player
    const enemy = makeEnemyUnit({ enemyId: 'e_tank', maxHp: 40, armor: 2, spriteArchetype: 'frigate' });
    const mixedRound: V2CombatRoundLog = {
      round: 1,
      droneCountsByHangar: {},
      heavyChargingIds: [],
      playerAttacks: [
        { sourceKind: 'laser', sourceInstanceId: 'l1', targetEnemyId: 'e_tank', rawDamage: 6, appliedDamage: 4, armorBlocked: 2, targetHpAfter: 36, targetKilled: false },
        { sourceKind: 'core', sourceInstanceId: 'c1', targetEnemyId: 'e_tank', rawDamage: 5, appliedDamage: 5, armorBlocked: 0, targetHpAfter: 31, targetKilled: false },
        { sourceKind: 'heavy', sourceInstanceId: 'tactic_overload', targetEnemyId: 'e_tank', rawDamage: 10, appliedDamage: 10, armorBlocked: 0, targetHpAfter: 21, targetKilled: false },
      ],
      enemyAttacks: [
        { enemyId: 'e_tank', rawDamage: 7, pierceDamage: 3, shieldAbsorbed: 0, hullDamage: 7 },
      ],
      counterAttack: {
        sourceKind: 'counter',
        sourceInstanceId: 'cnt1',
        targetEnemyId: 'e_tank',
        rawDamage: 6,
        appliedDamage: 6,
        armorBlocked: 0,
        targetHpAfter: 15,
        targetKilled: false,
      },
      shieldAbsorbedTotal: 0,
      playerHpAfter: 23,
      playerShieldAfter: 0,
      enemiesAfter: [{ enemyId: 'e_tank', name: enemy.name, spriteArchetype: 'frigate', hp: 15, maxHp: 40, damagePerRound: 7, armor: 2, pierceRatio: 0 }],
    };

    const sim = makeSimulation([enemy], [mixedRound], { startingPlayerHp: 30, startingPlayerShield: 0 });
    const { scene, access } = mountCombatScene({
      shipId: 'cannon_skiff',
      sectorIndex: 1,
      eventBackdrop: null,
      units: [enemy],
      simulation: sim,
      settings: makeSettings({ reducedMotion: false }),
    });

    scene.update(0, 260);
    access.time.advance(180); // player_impact -> enemy HP drops 40 -> 21, trailHp lags at 40!
    const afterHitSnap = scene.getStagePresentationSnapshot();
    expect(afterHitSnap.enemiesState[0].hp).toBe(21);
    expect(afterHitSnap.enemiesState[0].trailHp).toBe(40);

    // Step past holdMs (150ms) and verify smooth drain toward 21
    scene.update(240, 80); // clears 50ms hitstop
    scene.update(340, 100);
    scene.update(440, 100);
    scene.update(540, 100);
    const drainingSnap = scene.getStagePresentationSnapshot();
    expect(drainingSnap.enemiesState[0].trailHp).toBeLessThan(40);
    expect(drainingSnap.enemiesState[0].trailHp).toBeGreaterThanOrEqual(21);

    // Advance to enemy_impact (510ms) -> player HP drops 30 -> 23 with trail + counter popup!
    access.time.advance(330);
    const postEnemyImpactSnap = scene.getStagePresentationSnapshot();
    expect(postEnemyImpactSnap.playerHp).toBe(23);
    expect(postEnemyImpactSnap.playerTrailHp).toBe(30);

    // Check all active popups at depth 9 have zero overlap!
    const popupObjs = access.createdObjects.filter((o) => o.kind === 'text' && o.depth === 9 && !o.destroyed);
    expect(popupObjs.length).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < popupObjs.length; i++) {
      for (let j = i + 1; j < popupObjs.length; j++) {
        const dx = Math.abs(popupObjs[i].x - popupObjs[j].x);
        const dy = Math.abs(popupObjs[i].y - popupObjs[j].y);
        expect(dx >= 42 || dy >= 18).toBe(true);
      }
    }
  });
});

// ===========================================================================
// 5. A05 — Engine Exhaust Plumes, Manifest Audit & Idle Micro-Tilt
// ===========================================================================
describe('A05 — Engine Exhaust Plumes, Manifest Hardpoint Audit & Idle Micro-Tilt', () => {
  it('audits ALL 4 player ships (both ship.player.* and v2.ship.player.*) and ALL 6 enemy archetypes in manifest.ts', () => {
    expect(normalizeShipManifestKey('v2.ship.player.cannon_skiff')).toBe('ship.player.cannon_skiff');
    expect(normalizeShipManifestKey('ship.player.cannon_skiff')).toBe('ship.player.cannon_skiff');

    for (const shipId of V2_SHIP_ORDER) {
      const bare = getShipHardpoints(`ship.player.${shipId}`);
      const prefixed = getShipHardpoints(`v2.ship.player.${shipId}`);
      expect(prefixed).toEqual(bare);
      expect(bare.engine.x).toBeGreaterThan(0);
      expect(bare.engine.x).toBeLessThan(0.25);
      expect(bare.engine.y).toBeGreaterThan(0.2);
      expect(bare.engine.y).toBeLessThan(0.8);

      const slice = getShipSplitSlice(`v2.ship.player.${shipId}`);
      expect(slice.splitRatioX).toBeGreaterThan(0.2);
      expect(slice.splitRatioX).toBeLessThan(0.8);
    }

    // Calibrated stern engines on shield_cruiser & stargate_cruiser
    expect(getShipHardpoints('ship.player.shield_cruiser').engine.x).toBeGreaterThanOrEqual(0.1);
    expect(getShipHardpoints('ship.player.stargate_cruiser').engine.x).toBeGreaterThanOrEqual(0.1);

    const archetypes: EnemyArchetype[] = [
      'scout',
      'interceptor',
      'frigate',
      'hulk',
      'boss_dreadnought',
      'boss_leviathan',
    ];
    for (const arch of archetypes) {
      const hp = getShipHardpoints(`ship.enemy.${arch}`);
      expect(hp.engine.x).toBeGreaterThan(0.75);
      expect(hp.engine.x).toBeLessThan(0.98);
      expect(hp.engine.y).toBeGreaterThan(0.2);
      expect(hp.engine.y).toBeLessThan(0.8);

      const slice = getShipSplitSlice(`ship.enemy.${arch}`);
      expect(slice.splitRatioX).toBeGreaterThan(0.2);
      expect(slice.splitRatioX).toBeLessThan(0.8);
    }

    // Calibrated stern engines on frigate & hulk (attached within opaque stern edge)
    expect(getShipHardpoints('ship.enemy.frigate').engine.x).toBeLessThanOrEqual(0.88);
    expect(getShipHardpoints('ship.enemy.hulk').engine.x).toBeLessThanOrEqual(0.88);

    // Unknown key falls back cleanly
    expect(getShipSplitSlice('ship.unknown.probe')).toEqual({ splitRatioX: 0.5 });
  });

  it('renders engine plumes on live player & alive enemies, skips wreck/dead ships, and disables tilt/flicker in reducedMotion & lowQuality', () => {
    const aliveEnemy = makeEnemyUnit({ enemyId: 'e_alive', spriteArchetype: 'frigate', maxHp: 20 });
    const deadEnemy = makeEnemyUnit({ enemyId: 'e_dead', spriteArchetype: 'scout', maxHp: 10 });
    const sim = makeSimulation([aliveEnemy, deadEnemy], [], { startingPlayerHp: 30, startingPlayerShield: 0 });
    const simWithDead: V2CombatSimulation = {
      ...sim,
      initialEnemies: [
        sim.initialEnemies[0],
        { ...sim.initialEnemies[1], hp: 0 },
      ],
    };

    // Normal mode: plumes on player + 1 alive enemy (NOT dead enemy!), active idle micro-tilt
    const { scene, access } = mountCombatScene({
      shipId: 'cannon_skiff',
      sectorIndex: 1,
      eventBackdrop: null,
      units: [aliveEnemy, deadEnemy],
      simulation: simWithDead,
      settings: makeSettings({ reducedMotion: false, lowQuality: false }),
    });
    scene.update(0, 120);
    scene.update(120, 120);
    const snapNorm = scene.getStagePresentationSnapshot();
    expect(snapNorm.plumesRendered).toBe(2); // player + aliveEnemy only!
    expect(Math.abs(snapNorm.playerAngle)).toBeGreaterThan(0);
    expect(Math.abs(snapNorm.playerAngle)).toBeLessThanOrEqual(2);
    expect(Math.abs(snapNorm.enemiesState[0].angle)).toBeGreaterThan(0);

    const addGfx = access.createdObjects.find((o) => o.kind === 'graphics' && o.depth === 8)!;
    const plumeTriangles = addGfx.drawOps.filter((op) => op.kind === 'fillTriangle');
    expect(plumeTriangles.length).toBeGreaterThanOrEqual(4); // 2 triangles per plume

    // reducedMotion & lowQuality: angle === 0 and static non-flickering plume across elapsed ticks
    for (const modeSettings of [
      makeSettings({ reducedMotion: true, lowQuality: false }),
      makeSettings({ reducedMotion: false, lowQuality: true }),
    ]) {
      const { scene: staticScene, access: staticAcc } = mountCombatScene({
        shipId: 'cannon_skiff',
        sectorIndex: 1,
        eventBackdrop: null,
        units: [aliveEnemy],
        simulation: null,
        settings: modeSettings,
      });
      staticScene.update(0, 100);
      const addStatic = staticAcc.createdObjects.find((o) => o.kind === 'graphics' && o.depth === 8)!;
      const triFrame1 = addStatic.drawOps.filter((op) => op.kind === 'fillTriangle').map((op) => op.args);
      staticScene.update(100, 100);
      const triFrame2 = addStatic.drawOps.filter((op) => op.kind === 'fillTriangle').map((op) => op.args);

      const staticSnap = staticScene.getStagePresentationSnapshot();
      expect(staticSnap.plumesRendered).toBe(2);
      expect(staticSnap.playerAngle).toBe(0);
      expect(staticSnap.enemiesState[0].angle).toBe(0);
      // Plume length & width MUST stay 100% constant across frames (zero flicker in reducedMotion & lowQuality)
      const dims = (tris: readonly (readonly number[])[]) =>
        tris.map((t) => [Math.abs(t[4] - t[0]), Math.abs(t[3] - t[1])]);
      expect(dims(triFrame2)).toEqual(dims(triFrame1));
      if (modeSettings.reducedMotion) {
        expect(triFrame2).toEqual(triFrame1); // Zero vertical bobbing too in reducedMotion!
      }
    }

    // Wreck backdrop: player hidden -> 0 plumes rendered
    const { scene: wreckScene } = mountCombatScene({
      playbackKey: 'wreck|test',
      shipId: 'cannon_skiff',
      sectorIndex: 2,
      eventBackdrop: 'wreck',
      units: [],
      simulation: null,
      settings: makeSettings(),
    });
    wreckScene.update(0, 100);
    const wreckSnap = wreckScene.getStagePresentationSnapshot();
    expect(wreckSnap.playerVisible).toBe(false);
    expect(wreckSnap.plumesRendered).toBe(0);
  });
});

// ===========================================================================
// 6. A08-code — BaseScene 4-Joint Articulated Crane, Overlay Cross-Fade & Guard
// ===========================================================================
describe('A08-code — BaseScene 4-Joint Articulated Crane, Smooth Overlay Cross-Fade & Pointer Guard', () => {
  it('solveArticulatedCranePose returns 5 finite vertices & 4 continuous segments across reach, stow & vertical cases', () => {
    const base = { x: 435, y: 410 };
    const cases: { name: string; target: { x: number; y: number }; mode: 'stowed' | 'idle' | 'docking' }[] = [
      { name: 'workbench_left', target: { x: 281, y: 310 }, mode: 'docking' },
      { name: 'pad_right', target: { x: 659, y: 515 }, mode: 'docking' },
      { name: 'display_high_right_telescope', target: { x: 640, y: 144 }, mode: 'docking' },
      { name: 'stowed_close_retract', target: { x: 467, y: 400 }, mode: 'stowed' },
      { name: 'vertical_dx_zero', target: { x: 435, y: 260 }, mode: 'idle' },
    ];

    for (const c of cases) {
      const pose = solveArticulatedCranePose({ base, target: c.target, scale: 1, mode: c.mode });
      expect(pose.segments).toHaveLength(4);

      const verts = [pose.turntable, pose.shoulder, pose.elbow, pose.trolley, pose.hook];
      for (const v of verts) {
        expect(Number.isFinite(v.x)).toBe(true);
        expect(Number.isFinite(v.y)).toBe(true);
      }

      // Segment continuity: seg[i].to === seg[i+1].from
      for (let i = 0; i < 3; i++) {
        expect(pose.segments[i].to).toEqual(pose.segments[i + 1].from);
      }

      // Exact IK boom/jib lengths within 1e-3
      const actualBoom = Math.hypot(pose.elbow.x - pose.shoulder.x, pose.elbow.y - pose.shoulder.y);
      const actualJib = Math.hypot(pose.trolley.x - pose.elbow.x, pose.trolley.y - pose.elbow.y);
      expect(actualBoom).toBeCloseTo(pose.lowerBoomLength, 3);
      expect(actualJib).toBeCloseTo(pose.upperJibLength, 3);

      // Overhead elbow preference (never hangs upside-down below the chord)
      const chordMidY = (pose.shoulder.y + pose.trolley.y) * 0.5;
      expect(pose.elbow.y).toBeLessThanOrEqual(chordMidY + 1e-3);
    }
  });

  it('smoothly cross-fades & scanline-illuminates overlays in V2 & V1, is idempotent, snaps in reducedMotion, and resets on SHUTDOWN', () => {
    // Pure stepper sanity
    const mid = stepOverlayTransition({ alpha: 0, targetAlpha: 1, scanProgress: 0, poweringUp: true }, 0.25, false);
    expect(mid.alpha).toBeGreaterThan(0);
    expect(mid.alpha).toBeLessThan(1);
    expect(mid.scanProgress).toBeGreaterThan(0);
    expect(mid.scanProgress).toBeLessThan(1);
    expect(mid.poweringUp).toBe(true);
    expect(OVERLAY_QUADRANT_BOUNDS.workbench.nx1).toBeGreaterThan(OVERLAY_QUADRANT_BOUNDS.workbench.nx0);

    // V2 live BaseScene: initial mount snaps existing built facilities except recentlyBuiltId
    const baseV2: V2BaseDioramaState = {
      activeShipId: 'cannon_skiff',
      facilityTiers: { workbench: 1, display: 0, drydock: 0, stargate_relay: 0 },
      restoredRelicIds: [],
      campaignAct: 'act1',
      stargatePowered: false,
      settings: makeSettings({ reducedMotion: false }),
    };

    const { scene, game, access } = mountBaseScene({ v2State: baseV2 });
    let ovSnap = scene.getOverlayTransitionSnapshot();
    expect(ovSnap.workbench.alpha).toBe(1);
    expect(ovSnap.workbench.poweringUp).toBe(false);
    expect(ovSnap.display_empty.alpha).toBe(0);
    expect(scene.getLastCranePose()?.mode).toBe('idle');
    expect(scene.getLastCranePose()?.segments).toHaveLength(4);

    // Upgrade display facility live -> starts smooth cross-fade + scanline sweep!
    const withDisplay: V2BaseDioramaState = {
      ...baseV2,
      facilityTiers: { ...baseV2.facilityTiers, display: 1 },
    };
    scene.setV2StationState(withDisplay);
    scene.update(0, 180); // 0.18s into transition
    ovSnap = scene.getOverlayTransitionSnapshot();
    expect(ovSnap.display_empty.alpha).toBeGreaterThan(0);
    expect(ovSnap.display_empty.alpha).toBeLessThan(1);
    expect(ovSnap.display_empty.poweringUp).toBe(true);
    expect(ovSnap.display_empty.scanProgress).toBeGreaterThan(0);
    expect(ovSnap.display_empty.scanProgress).toBeLessThan(1);

    // Scanline graphics (depth 3.5) actively draws scanline sweep!
    const scanGfx = access.createdObjects.find((o) => o.kind === 'graphics' && o.depth === 3.5)!;
    expect(scanGfx.drawOps.some((op) => op.kind === 'lineBetween')).toBe(true);

    // Idempotency: re-applying identical state MUST NOT reset in-flight progress!
    const savedAlpha = ovSnap.display_empty.alpha;
    const savedScan = ovSnap.display_empty.scanProgress;
    scene.setV2StationState(withDisplay);
    expect(scene.getOverlayTransitionSnapshot().display_empty.alpha).toBeCloseTo(savedAlpha, 6);
    expect(scene.getOverlayTransitionSnapshot().display_empty.scanProgress).toBeCloseTo(savedScan, 6);

    // Complete transition -> alpha=1, scanProgress=1, crop reset to null!
    for (let i = 0; i < 6; i++) scene.update(200 + i * 150, 150);
    ovSnap = scene.getOverlayTransitionSnapshot();
    expect(ovSnap.display_empty.alpha).toBe(1);
    expect(ovSnap.display_empty.poweringUp).toBe(false);
    const dispEmptyImg = access.createdObjects.find((o) => o.textureKey === 'base.overlay.display_empty')!;
    expect(dispEmptyImg.lastCrop).toBeNull();

    // Restore first relic -> smooth cross-fade display_empty (1->0) & display_relic (0->1)!
    scene.setV2StationState({ ...withDisplay, restoredRelicIds: ['ancient_navigator'] });
    scene.update(1200, 160);
    ovSnap = scene.getOverlayTransitionSnapshot();
    expect(ovSnap.display_empty.alpha).toBeGreaterThan(0);
    expect(ovSnap.display_empty.alpha).toBeLessThan(1);
    expect(ovSnap.display_relic.alpha).toBeGreaterThan(0);
    expect(ovSnap.display_relic.alpha).toBeLessThan(1);
    expect(ovSnap.display_relic.poweringUp).toBe(true);

    // Toggling reducedMotion mid-transition via updateSettings snaps immediately & clears crops!
    scene.updateSettings(makeSettings({ reducedMotion: true }));
    ovSnap = scene.getOverlayTransitionSnapshot();
    expect(ovSnap.display_empty.alpha).toBe(0);
    expect(ovSnap.display_relic.alpha).toBe(1);
    expect(ovSnap.display_relic.poweringUp).toBe(false);
    const dispRelicImg = access.createdObjects.find((o) => o.textureKey === 'base.overlay.display_relic')!;
    expect(dispRelicImg.lastCrop).toBeNull();

    // SHUTDOWN cleanly resets state
    game.scene.stop('BaseScene');
    expect(scene.getLastCranePose()).toBeNull();

    // Legacy V1 parity via setProgression()
    const v1Prog = createInitialProgression();
    const { scene: v1Scene } = mountBaseScene({
      state: { progression: v1Prog, settings: makeSettings({ reducedMotion: false }), recentlyBuiltId: null },
    });
    expect(v1Scene.getLastCranePose()?.mode).toBe('stowed'); // workbench worn -> stowed!
    v1Scene.setProgression({
      ...v1Prog,
      buildings: { ...v1Prog.buildings, workbench: true },
    });
    v1Scene.update(0, 160);
    expect(v1Scene.getOverlayTransitionSnapshot().workbench.poweringUp).toBe(true);
    expect(v1Scene.getLastCranePose()?.mode).toBe('idle');
  });

  it('preserves PR #4 mobile pointer pass-through guard, forwards settings via PhaserHost, and stage-gates craneServo SFX', async () => {
    const playSpy = vi.spyOn(soundEngine, 'play').mockImplementation(() => {});
    const onBuildingClick = vi.fn();
    const onBerthClick = vi.fn();

    const { scene, game, access } = mountBaseScene({
      v2State: {
        activeShipId: 'cannon_skiff',
        facilityTiers: { workbench: 1, display: 1, drydock: 1, stargate_relay: 0 },
        restoredRelicIds: [],
        campaignAct: 'act1',
        stargatePowered: false,
        settings: makeSettings({ reducedMotion: false }),
      },
      onBuildingClick,
      onBerthClick,
    });

    // PR #4 pointer pass-through guard: clicks whose event.target !== game.canvas MUST be ignored!
    const zones = access.createdObjects.filter((o) => o.kind === 'zone');
    expect(zones.length).toBeGreaterThanOrEqual(4);
    const fakeDomBtn = { tagName: 'BUTTON' };
    zones[0].events.emit('pointerdown', { event: { target: fakeDomBtn } });
    zones[zones.length - 1].events.emit('pointerdown', { event: { target: fakeDomBtn } });
    expect(onBuildingClick).not.toHaveBeenCalled();
    expect(onBerthClick).not.toHaveBeenCalled();

    // Direct canvas clicks invoke handlers cleanly
    zones[0].events.emit('pointerdown', { event: { target: game.canvas } });
    zones[zones.length - 1].events.emit('pointerdown', { event: { target: game.canvas } });
    expect(onBuildingClick).toHaveBeenCalledTimes(1);
    expect(onBerthClick).toHaveBeenCalledTimes(1);

    // 100 frames of quiet idle base -> ZERO craneServo calls!
    playSpy.mockClear();
    for (let i = 0; i < 100; i++) {
      scene.update(i * 16, 16);
    }
    expect(playSpy.mock.calls.filter(([k]) => k === 'craneServo')).toHaveLength(0);

    // Full return-docking sequence across 95 frames -> 1..3 craneServo triggers + active 4-joint docking crane
    const onFinish = vi.fn();
    scene.startReturnDocking({
      earnedCredits: 220,
      crateCount: 4,
      hasKeptRelic: true,
      wasDefeat: false,
      onFinish,
    });
    let sawDockingPose = false;
    for (let i = 0; i < 95; i++) {
      scene.update(2000 + i * 16, 16);
      if (scene.getLastCranePose()?.mode === 'docking') {
        sawDockingPose = true;
      }
    }
    expect(sawDockingPose).toBe(true);
    expect(onFinish).toHaveBeenCalledTimes(1);
    const dockingServoCalls = playSpy.mock.calls.filter(([k]) => k === 'craneServo').length;
    expect(dockingServoCalls).toBeGreaterThanOrEqual(1);
    expect(dockingServoCalls).toBeLessThanOrEqual(3);

    // skipReturnDocking() -> ZERO post-skip craneServo calls
    playSpy.mockClear();
    scene.startReturnDocking({
      earnedCredits: 100,
      crateCount: 3,
      hasKeptRelic: false,
      wasDefeat: false,
    });
    scene.skipReturnDocking();
    for (let i = 0; i < 20; i++) scene.update(4000 + i * 16, 16);
    expect(playSpy.mock.calls.filter(([k]) => k === 'craneServo')).toHaveLength(0);

    // PhaserHost.updateCombatSettings forwards live settings to BaseScene without throwing
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancelRaf = globalThis.cancelAnimationFrame;
    (globalThis as { window?: unknown }).window = {
      devicePixelRatio: 1,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    globalThis.requestAnimationFrame = (() => 1) as unknown as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => {}) as unknown as typeof cancelAnimationFrame;
    try {
      const container = {
        getBoundingClientRect: () => ({ width: 1280, height: 720 }),
      } as unknown as HTMLElement;
      const host = new PhaserHost(container);
      await Promise.resolve();
      host.showV2Base({
        activeShipId: 'cannon_skiff',
        facilityTiers: { workbench: 0, display: 0, drydock: 0, stargate_relay: 0 },
        restoredRelicIds: [],
        campaignAct: 'act1',
        stargatePowered: false,
        settings: makeSettings({ reducedMotion: false }),
      });
      expect(() => host.updateCombatSettings(makeSettings({ reducedMotion: true }))).not.toThrow();
      host.destroy();
    } finally {
      if (originalWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = originalWindow;
      }
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCancelRaf;
    }
  });
});

// ===========================================================================
// 7. A10 — SoundEngine Bus Graph, Compressor, Ambient Bed, Pitch & 34 SFX
// ===========================================================================
describe('A10 — WebAudio Bus Graph, Compressor, Ambient Bed, Pitch Jitter & 34 Distinct SFX', () => {
  it('routes sfxBus + bgmBus + ambientBus -> DynamicsCompressorNode -> masterGain -> ctx.destination with zero direct-to-destination nodes', () => {
    const harness = createWindowAudioHarness();
    activeWindowCleanup = harness.restore;

    const engine = new SoundEngine({ randomFn: () => 0.5 });
    engine.setTrack('base');
    engine.unlock();
    engine.play('heavyBlast');
    harness.tickIntervals(1);

    expect(harness.createdContexts).toHaveLength(1);
    const ctx = harness.createdContexts[0];
    expect(ctx.compressors).toHaveLength(1);
    const compressor = ctx.compressors[0];

    // masterGain -> destination (ONLY node connected directly to ctx.destination!)
    const directToDest = [
      ...ctx.gains,
      ...ctx.compressors,
      ...ctx.filters,
      ...ctx.oscillators,
      ...ctx.bufferSources,
    ].filter((n) => n.connections.includes(ctx.destination));
    expect(directToDest).toHaveLength(1);
    const masterGain = directToDest[0];
    expect(masterGain.nodeKind).toBe('GainNode');

    // compressor -> masterGain
    expect(compressor.connections).toContain(masterGain);

    // sfxBus, bgmBus, ambientBus all connect to compressor (exactly 3 bus GainNodes!)
    const busesToCompressor = ctx.gains.filter((g) => g.connections.includes(compressor));
    expect(busesToCompressor).toHaveLength(3);

    // Every SFX & BGM oscillator connects to a per-voice gain which connects to a bus (NEVER ctx.destination)
    expect(ctx.oscillators.length).toBeGreaterThan(0);
    for (const osc of ctx.oscillators) {
      expect(osc.connections).not.toContain(ctx.destination);
      const voiceGain = osc.connections[0];
      expect(voiceGain.nodeKind).toBe('GainNode');
      expect(busesToCompressor).toContain(voiceGain.connections[0] as MockGainNode);
    }

    const graphSnap = engine.getAudioGraphState();
    expect(graphSnap.initialized).toBe(true);
    expect(graphSnap.hasCompressor).toBe(true);
    expect(graphSnap.hasSfxBus).toBe(true);
    expect(graphSnap.hasBgmBus).toBe(true);
    expect(graphSnap.hasAmbientBus).toBe(true);
    expect(graphSnap.hasMasterGain).toBe(true);
    expect(graphSnap.ambientRunning).toBe(true);

    engine.dispose();
  });

  it('degrades gracefully when window, AudioContext, or createDynamicsCompressor is missing/throws/suspended', async () => {
    // 1. No window at all (pure Node)
    const origWin = (globalThis as { window?: unknown }).window;
    delete (globalThis as { window?: unknown }).window;
    try {
      const headless = new SoundEngine();
      expect(() => headless.unlock()).not.toThrow();
      expect(() => headless.setTrack('expedition')).not.toThrow();
      expect(headless.getCurrentTrack()).toBe('expedition');
      expect(() => headless.play('click')).not.toThrow();
      expect(headless.getAudioGraphState().initialized).toBe(false);
      headless.dispose();
    } finally {
      if (origWin !== undefined) (globalThis as { window?: unknown }).window = origWin;
    }

    // 2. AudioContext missing
    const hMissing = createWindowAudioHarness({ omitAudioContext: true });
    activeWindowCleanup = hMissing.restore;
    const noCtxEngine = new SoundEngine();
    expect(() => noCtxEngine.play('laserFire')).not.toThrow();
    expect(noCtxEngine.getAudioGraphState().initialized).toBe(false);
    noCtxEngine.dispose();
    hMissing.restore();

    // 3. AudioContext constructor throws
    const hThrows = createWindowAudioHarness({
      audioCtxFactory: () => {
        throw new Error('Blocked by autoplay policy');
      },
    });
    activeWindowCleanup = hThrows.restore;
    const throwingEngine = new SoundEngine();
    expect(() => throwingEngine.play('enemyFire')).not.toThrow();
    expect(throwingEngine.getAudioGraphState().initialized).toBe(false);
    throwingEngine.dispose();
    hThrows.restore();

    // 4. createDynamicsCompressor absent -> clean fallback to bus -> masterGain -> ctx.destination
    const hNoComp = createWindowAudioHarness({
      audioCtxFactory: () => {
        const ctx = new MockAudioContext();
        (ctx as unknown as { createDynamicsCompressor?: unknown }).createDynamicsCompressor = undefined;
        return ctx;
      },
    });
    activeWindowCleanup = hNoComp.restore;
    const fallbackEngine = new SoundEngine();
    fallbackEngine.unlock();
    fallbackEngine.play('pickup');
    expect(fallbackEngine.getAudioGraphState().initialized).toBe(true);
    expect(fallbackEngine.getAudioGraphState().hasCompressor).toBe(false);
    expect(hNoComp.createdContexts[0].oscillators.length).toBeGreaterThan(0);
    fallbackEngine.dispose();
    hNoComp.restore();

    // 5. Suspended context resumes asynchronously and starts ambient bed cleanly
    const hSuspended = createWindowAudioHarness({
      audioCtxFactory: () => {
        const ctx = new MockAudioContext();
        ctx.state = 'suspended';
        return ctx;
      },
    });
    activeWindowCleanup = hSuspended.restore;
    const suspEngine = new SoundEngine();
    suspEngine.setTrack('boss');
    suspEngine.unlock();
    await Promise.resolve();
    expect(hSuspended.createdContexts[0].resumeCalls).toBe(1);
    expect(suspEngine.getAudioGraphState().ambientRunning).toBe(true);
    suspEngine.dispose();
  });

  it('supports independent SFX/BGM/ambient mute controls and track-adapted looping ambient noise bed', () => {
    const harness = createWindowAudioHarness();
    activeWindowCleanup = harness.restore;

    const engine = new SoundEngine({ randomFn: () => 0.5 });
    // Mute SFX ONLY while keeping BGM & ambient active -> unlock & setTrack MUST still work!
    engine.setMute(true, false);
    engine.setTrack('base');
    engine.unlock();
    const ctx = harness.createdContexts[0];
    const oscBeforeSfx = ctx.oscillators.length;
    engine.play('heavyBlast'); // muted!
    expect(ctx.oscillators.length).toBe(oscBeforeSfx);
    expect(engine.isSfxMuted()).toBe(true);
    expect(engine.isBgmMuted()).toBe(false);
    expect(engine.isAmbientMuted()).toBe(false);
    expect(engine.getAudioGraphState().ambientRunning).toBe(true);
    expect(engine.getAudioGraphState().ambientCutoffHz).toBe(240);

    // BGM plays while SFX is muted
    harness.tickIntervals(1);
    expect(ctx.oscillators.length).toBeGreaterThan(oscBeforeSfx);

    // Track switch adapts ambient filter cutoff & gain smoothly
    engine.setTrack('expedition');
    expect(engine.getAudioGraphState().ambientCutoffHz).toBe(380);
    engine.setTrack('boss');
    expect(engine.getAudioGraphState().ambientCutoffHz).toBe(150);

    // Independent ambient mute stops ambient bed while BGM continues
    engine.setAmbientMuted(true);
    expect(engine.isAmbientMuted()).toBe(true);
    expect(engine.isBgmMuted()).toBe(false);
    expect(engine.getAudioGraphState().ambientRunning).toBe(false);
    const oscBeforeBossTick = ctx.oscillators.length;
    harness.tickIntervals(1);
    expect(ctx.oscillators.length).toBeGreaterThan(oscBeforeBossTick);

    // Re-enable ambient and switch to 'none' -> ambient source stops cleanly
    engine.setAmbientMuted(false);
    expect(engine.getAudioGraphState().ambientRunning).toBe(true);
    engine.setTrack('none');
    expect(engine.getAudioGraphState().ambientRunning).toBe(false);
    expect(harness.intervals.size).toBe(0);

    engine.dispose();
  });

  it('applies ±3–5% pitch randomization to repeated SFX while keeping internal chime ratios and BGM strictly unrandomized', () => {
    const harness = createWindowAudioHarness();
    activeWindowCleanup = harness.restore;

    const seq = [0.0, 0.5, 1.0]; // yields exact pitch factors [0.96, 1.00, 1.04]
    let seqIdx = 0;
    const engine = new SoundEngine({ randomFn: () => seq[seqIdx++ % seq.length] });
    engine.unlock();
    const ctx = harness.createdContexts[0];

    // Play 'click' (nominal 540Hz) 3 times
    engine.play('click');
    engine.play('click');
    engine.play('click');
    const clickFreqs = ctx.oscillators.map((o) => o.frequency.events[0].value);
    expect(clickFreqs[0]).toBeCloseTo(540 * 0.96, 4);
    expect(clickFreqs[1]).toBeCloseTo(540 * 1.0, 4);
    expect(clickFreqs[2]).toBeCloseTo(540 * 1.04, 4);
    for (const f of clickFreqs) {
      const ratio = f / 540;
      expect(ratio).toBeGreaterThanOrEqual(0.95);
      expect(ratio).toBeLessThanOrEqual(1.05);
    }

    // Multi-note chime ('energyLink') keeps exact internal ratio within a single call
    const startIdx = ctx.oscillators.length;
    engine.play('energyLink'); // uses seq[0] = 0.0 -> 0.96
    const linkOscs = ctx.oscillators.slice(startIdx);
    expect(linkOscs).toHaveLength(3);
    const f0 = linkOscs[0].frequency.events[0].value;
    const f1 = linkOscs[1].frequency.events[0].value;
    const f2 = linkOscs[2].frequency.events[0].value;
    expect(f1 / f0).toBeCloseTo(784 / 523, 5);
    expect(f2 / f0).toBeCloseTo(1046 / 523, 5);

    // BGM melody notes stay strictly unrandomized (nominal 130.81Hz on step 0)
    const bgmStartIdx = ctx.oscillators.length;
    engine.setTrack('base');
    harness.tickIntervals(1);
    const bgmOscs = ctx.oscillators.slice(bgmStartIdx);
    expect(bgmOscs[0].frequency.events[0].value).toBeCloseTo(130.81, 4);

    engine.dispose();
  });

  it('synthesizes ALL 34 SfxKinds cleanly with >= 20 (34/34) distinct acoustic signatures and wires enemyFire + wreckCut in V2CombatScene', () => {
    const harness = createWindowAudioHarness();
    activeWindowCleanup = harness.restore;

    expect(ALL_SFX_KINDS).toHaveLength(34);
    const requiredNewKinds: SfxKind[] = [
      'pickup',
      'hoverValid',
      'placeHeavy',
      'wreckCut',
      'clampPop',
      'craneServo',
      'cashRegister',
      'enemyFire',
    ];
    for (const k of requiredNewKinds) {
      expect(ALL_SFX_KINDS).toContain(k);
    }

    const signatures = new Set<string>();
    const engine = new SoundEngine({ randomFn: () => 0.5 }); // nominal pitch 1.0 for clean signature fingerprinting
    engine.unlock();
    const ctx = harness.createdContexts[0];

    for (const kind of ALL_SFX_KINDS) {
      const oscStart = ctx.oscillators.length;
      const filterStart = ctx.filters.length;
      engine.play(kind);
      const oscs = ctx.oscillators.slice(oscStart);
      const filters = ctx.filters.slice(filterStart);
      expect(oscs.length + filters.length).toBeGreaterThan(0);

      const oscSig = oscs
        .map((o) => {
          const fEvents = o.frequency.events.map((e) => `${Math.round(e.value * 10)}`).join('>');
          const dur = Math.round(((o.stoppedAt ?? 0) - (o.startedAt ?? 0)) * 1000);
          return `${o.type}:${fEvents}:${dur}`;
        })
        .join('|');
      const noiseSig = filters
        .map((f) => `${f.type}:${Math.round(f.frequency.events[0]?.value ?? 0)}`)
        .join('|');
      signatures.add(`${oscSig}#${noiseSig}`);
    }

    expect(signatures.size).toBeGreaterThanOrEqual(20);
    expect(signatures.size).toBe(34); // Every single one of all 34 SFX kinds is acoustically distinct!
    engine.dispose();

    // Verify live V2CombatScene wires 'enemyFire' on Enemy Retaliation beat AND 'wreckCut' on triggerWreckCutFx
    const playSpy = vi.spyOn(soundEngine, 'play').mockImplementation(() => {});
    const enemy = makeEnemyUnit({ enemyId: 'e_sfx', maxHp: 20 });
    const roundWithEnemyFire: V2CombatRoundLog = {
      round: 1,
      droneCountsByHangar: {},
      heavyChargingIds: [],
      playerAttacks: [],
      enemyAttacks: [{ enemyId: 'e_sfx', rawDamage: 4, pierceDamage: 0, shieldAbsorbed: 0, hullDamage: 4 }],
      counterAttack: null,
      shieldAbsorbedTotal: 0,
      playerHpAfter: 26,
      playerShieldAfter: 0,
      enemiesAfter: [{ enemyId: 'e_sfx', name: enemy.name, spriteArchetype: 'scout', hp: 20, maxHp: 20, damagePerRound: 4, armor: 0, pierceRatio: 0 }],
    };
    const sim = makeSimulation([enemy], [roundWithEnemyFire], { startingPlayerHp: 30, startingPlayerShield: 0 });
    const { scene, access } = mountCombatScene({
      shipId: 'cannon_skiff',
      sectorIndex: 1,
      eventBackdrop: null,
      units: [enemy],
      simulation: sim,
      settings: makeSettings(),
    });

    scene.update(0, 260);
    access.time.advance(450); // Beat 3: enemy_fire
    expect(playSpy).toHaveBeenCalledWith('enemyFire');

    playSpy.mockClear();
    scene.triggerWreckCutFx(0.5, 0.5);
    expect(playSpy).toHaveBeenCalledWith('wreckCut');
  });
});
