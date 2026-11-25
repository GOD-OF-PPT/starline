import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Self-Contained Pure-JS MiniDOM (matches repo Vitest node environment;
// ZERO internal project modules are mocked!)
// ---------------------------------------------------------------------------

class MiniEvent {
  readonly type: string;
  readonly bubbles: boolean;
  readonly key: string;
  readonly button: number;
  readonly pointerType: string;
  readonly pointerId: number;
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
      pointerType?: string;
      pointerId?: number;
      clientX?: number;
      clientY?: number;
    } = {}
  ) {
    this.type = type;
    this.bubbles = init.bubbles ?? false;
    this.key = init.key ?? '';
    this.button = init.button ?? 0;
    this.pointerType = init.pointerType ?? 'mouse';
    this.pointerId = init.pointerId ?? 1;
    this.clientX = init.clientX ?? 0;
    this.clientY = init.clientY ?? 0;
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
      if (capSet) for (const fn of [...capSet]) fn(ev);
      if (ev.isStopped()) return !ev.defaultPrevented;
    }
    for (let i = 0; i < path.length; i++) {
      const node = path[i];
      ev.currentTarget = node;
      const set = node.listeners.get(ev.type);
      if (set) for (const fn of [...set]) fn(ev);
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
          el.setAttribute(am[1], decodeEntities(am[2] ?? am[3] ?? am[4] ?? ''));
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
      const actual = el.getAttribute(m[1]);
      if (actual === null) return false;
      const expected = m[2] ?? m[3] ?? m[4];
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
  width = 640;
  height = 360;

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

  get id(): string { return this.attrs.get('id') ?? ''; }
  set id(val: string) { this.setAttribute('id', val); }
  get className(): string { return this.attrs.get('class') ?? ''; }
  set className(val: string) { this.setAttribute('class', val); }
  get disabled(): boolean { return this.attrs.has('disabled'); }
  set disabled(val: boolean) {
    if (val) this.attrs.set('disabled', '');
    else this.attrs.delete('disabled');
  }
  get tabIndex(): number {
    const raw = this.attrs.get('tabindex');
    return raw === undefined ? -1 : Number(raw);
  }
  set tabIndex(v: number) { this.attrs.set('tabindex', String(v)); }
  get src(): string { return this.attrs.get('src') ?? ''; }
  set src(v: string) { this.attrs.set('src', v); }
  get alt(): string { return this.attrs.get('alt') ?? ''; }
  set alt(v: string) { this.attrs.set('alt', v); }
  get title(): string { return this.attrs.get('title') ?? ''; }
  set title(v: string) { this.attrs.set('title', v); }
  get type(): string { return this.attrs.get('type') ?? ''; }
  set type(v: string) { this.attrs.set('type', v); }
  get name(): string { return this.attrs.get('name') ?? ''; }
  set name(v: string) { this.attrs.set('name', v); }
  get draggable(): boolean { return this.attrs.get('draggable') !== 'false'; }
  set draggable(v: boolean) { this.attrs.set('draggable', String(v)); }

  setAttribute(name: string, value: string): void {
    const low = name.toLowerCase();
    this.attrs.set(low, String(value));
    if (low === 'value') this.value = String(value);
    if (low === 'checked') this.checked = true;
    if (low === 'open') this.open = true;
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
  get length(): number { return this.store.size; }
  key(index: number): string | null { return [...this.store.keys()][index] ?? null; }
  getItem(k: string): string | null { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string): void { this.store.set(k, String(v)); }
  removeItem(k: string): void { this.store.delete(k); }
  clear(): void { this.store.clear(); }
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
  createElement(tag: string): MiniElement { return new MiniElement(this, tag); }
  createElementNS(_ns: string, tag: string): MiniElement { return new MiniElement(this, tag); }
  querySelector(sel: string): MiniElement | null { return this.body.querySelector(sel); }
  querySelectorAll(sel: string): MiniElement[] { return this.body.querySelectorAll(sel); }
  addEventListener(type: string, fn: (ev: MiniEvent) => void): void {
    let set = this.listeners.get(type);
    if (!set) { set = new Set(); this.listeners.set(type, set); }
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
    if (!set) { set = new Set(); map.set(type, set); }
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

function installMiniDom(search = ''): { readonly doc: MiniDocument; readonly win: MiniWindow; readonly restore: () => void } {
  const prevWin = (globalThis as Record<string, unknown>).window;
  const prevDoc = (globalThis as Record<string, unknown>).document;
  const prevHTMLElement = (globalThis as Record<string, unknown>).HTMLElement;
  const prevNode = (globalThis as Record<string, unknown>).Node;
  const prevEvent = (globalThis as Record<string, unknown>).Event;
  const prevKeyboardEvent = (globalThis as Record<string, unknown>).KeyboardEvent;
  const prevStorage = (globalThis as Record<string, unknown>).localStorage;
  const prevSessionStorage = (globalThis as Record<string, unknown>).sessionStorage;
  const prevRaf = (globalThis as Record<string, unknown>).requestAnimationFrame;
  const prevCaf = (globalThis as Record<string, unknown>).cancelAnimationFrame;

  const doc = new MiniDocument();
  const win = new MiniWindow(doc, search);
  (globalThis as Record<string, unknown>).window = win;
  (globalThis as Record<string, unknown>).document = doc;
  (globalThis as Record<string, unknown>).HTMLElement = MiniElement;
  (globalThis as Record<string, unknown>).Node = MiniNode;
  (globalThis as Record<string, unknown>).Event = MiniEvent;
  (globalThis as Record<string, unknown>).KeyboardEvent = MiniEvent;
  (globalThis as Record<string, unknown>).localStorage = win.localStorage;
  (globalThis as Record<string, unknown>).sessionStorage = win.sessionStorage;
  (globalThis as Record<string, unknown>).requestAnimationFrame = win.requestAnimationFrame;
  (globalThis as Record<string, unknown>).cancelAnimationFrame = win.cancelAnimationFrame;

  return {
    doc,
    win,
    restore: () => {
      (globalThis as Record<string, unknown>).window = prevWin;
      (globalThis as Record<string, unknown>).document = prevDoc;
      (globalThis as Record<string, unknown>).HTMLElement = prevHTMLElement;
      (globalThis as Record<string, unknown>).Node = prevNode;
      (globalThis as Record<string, unknown>).Event = prevEvent;
      (globalThis as Record<string, unknown>).KeyboardEvent = prevKeyboardEvent;
      (globalThis as Record<string, unknown>).localStorage = prevStorage;
      (globalThis as Record<string, unknown>).sessionStorage = prevSessionStorage;
      (globalThis as Record<string, unknown>).requestAnimationFrame = prevRaf;
      (globalThis as Record<string, unknown>).cancelAnimationFrame = prevCaf;
    },
  };
}

let activeDom: ReturnType<typeof installMiniDom> | null = null;
beforeEach(() => {
  activeDom = installMiniDom();
});
afterEach(() => {
  activeDom?.win.dispatchEvent(new MiniEvent('keydown', { key: 'Escape', bubbles: true }));
  activeDom?.restore();
  activeDom = null;
});

// ---------------------------------------------------------------------------
// Minimal Third-Party Phaser WebGL Stub (ONLY 'phaser' is stubbed — ALL real
// project modules execute genuinely without internal mocks!)
// ---------------------------------------------------------------------------

const { MOCK_SCENE_STATUS, MockPhaserScene, MockPhaserGame, phaserHarness } = vi.hoisted(() => {
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

  interface ListenerEntry {
    readonly fn: (...args: unknown[]) => void;
    readonly ctx: unknown;
    readonly once: boolean;
  }

  class MockEmitter {
    private readonly listeners = new Map<string, ListenerEntry[]>();

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
        list.filter((e) => !(e.fn === fn && (ctx === undefined || e.ctx === ctx)))
      );
      return this;
    }

    emit(event: string, ...args: unknown[]): boolean {
      const list = this.listeners.get(event);
      if (!list || list.length === 0) return false;
      const snap = [...list];
      this.listeners.set(
        event,
        list.filter((e) => !e.once)
      );
      for (const e of snap) {
        e.fn.apply(e.ctx, args);
      }
      return true;
    }
  }

  const phaserHarness = {
    createdDisplayObjects: [] as MockDisplayObject[],
    setTintFillCalls: 0,
    lastGame: null as MockPhaserGame | null,
    lastV2CombatScene: null as MockSceneInstance | null,
    reset() {
      this.createdDisplayObjects = [];
      this.setTintFillCalls = 0;
      this.lastGame = null;
      this.lastV2CombatScene = null;
    },
  };

  class MockDisplayObject extends MockEmitter {
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
    interactive = false;

    constructor(scene: MockPhaserScene, x = 0, y = 0, textureKey = '', text = '') {
      super();
      this.scene = scene;
      this.x = x;
      this.y = y;
      this.textureKey = textureKey;
      this.text = text;
      phaserHarness.createdDisplayObjects.push(this);
    }

    get texture(): { readonly key: string } {
      return { key: this.textureKey };
    }
    setOrigin(_x?: number, _y?: number): this { return this; }
    setDepth(d: number): this { this.depth = d; return this; }
    setVisible(v: boolean): this { this.visible = v; return this; }
    setAlpha(a: number): this { this.alpha = a; return this; }
    setScale(sx: number, sy?: number): this {
      this.displayWidth = this.width * sx;
      this.displayHeight = this.height * (sy ?? sx);
      return this;
    }
    setPosition(x: number, y: number): this { this.x = x; this.y = y; return this; }
    setY(y: number): this { this.y = y; return this; }
    setAngle(_deg: number): this { return this; }
    setSize(w: number, h: number): this {
      this.width = w;
      this.height = h;
      this.displayWidth = w;
      this.displayHeight = h;
      return this;
    }
    setTexture(key: string): this { this.textureKey = key; return this; }
    setText(t: string): this { this.text = t; return this; }
    setColor(_c: string): this { return this; }
    setBackgroundColor(_c: string): this { return this; }
    setTint(t: number): this { this.tint = t; return this; }
    setTintFill(t: number): this {
      phaserHarness.setTintFillCalls += 1;
      this.tint = t;
      return this;
    }
    clearTint(): this { this.tint = null; return this; }
    setCrop(): this { return this; }
    setBlendMode(): this { return this; }
    setInteractive(_opts?: unknown): this { this.interactive = true; return this; }
    clear(): this { return this; }
    fillStyle(_c: number, _a?: number): this { return this; }
    lineStyle(_w: number, _c: number, _a?: number): this { return this; }
    fillRect(_x: number, _y: number, _w: number, _h: number): this { return this; }
    strokeRect(_x: number, _y: number, _w: number, _h: number): this { return this; }
    fillRoundedRect(_x: number, _y: number, _w: number, _h: number, _r?: number): this { return this; }
    strokeRoundedRect(_x: number, _y: number, _w: number, _h: number, _r?: number): this { return this; }
    fillCircle(_x: number, _y: number, _r: number): this { return this; }
    strokeCircle(_x: number, _y: number, _r: number): this { return this; }
    fillEllipse(_x: number, _y: number, _w: number, _h: number): this { return this; }
    strokeEllipse(_x: number, _y: number, _w: number, _h: number): this { return this; }
    lineBetween(_x1: number, _y1: number, _x2: number, _y2: number): this { return this; }
    beginPath(): this { return this; }
    moveTo(_x: number, _y: number): this { return this; }
    lineTo(_x: number, _y: number): this { return this; }
    closePath(): this { return this; }
    fillPath(): this { return this; }
    strokePath(): this { return this; }
    fillTriangle(): this { return this; }
    strokeTriangle(): this { return this; }
    arc(): this { return this; }
    destroy(): void {
      this.scene = null;
    }
  }

  class MockPhaserScene {
    readonly sceneKey: string;
    game!: MockPhaserGame;
    events = new MockEmitter();
    load = {
      on: (_event: string, _fn: (...args: unknown[]) => void) => this.load,
      image: (_key: string, _url: string) => this.load,
    };
    textures = { exists: (_key: string) => true };
    cameras = {
      main: {
        setViewport: () => {},
        setZoom: () => {},
        centerOn: () => {},
        setBackgroundColor: () => {},
      },
    };
    scale = new (class extends MockEmitter {
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
    sys: { isActive: () => boolean; settings: { status: number } };
    scene: { isActive: () => boolean };

    constructor(config?: { readonly key?: string }) {
      this.sceneKey = config?.key ?? 'Scene';
      const isActive = () => Boolean(this.game?.scene.isActive(this.sceneKey));
      this.sys = { isActive, settings: { status: MOCK_SCENE_STATUS.PENDING } };
      this.scene = { isActive };
    }
  }

  interface MockSceneInstance extends MockPhaserScene {
    init?: (data?: unknown) => void;
    preload?: () => void;
    create?: () => void;
  }

  class MockPhaserGame {
    readonly events = new MockEmitter();
    readonly registry = new Map<string, unknown>();
    readonly canvas: HTMLCanvasElement;
    readonly renderer = {
      width: 640,
      height: 360,
      resize(w: number, h: number): void {
        this.width = w;
        this.height = h;
      },
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
    private readonly scenesByKey = new Map<string, MockSceneInstance>();
    private readonly activeKeys = new Set<string>();
    readonly scene: {
      isActive: (key: string) => boolean;
      start: (key: string, data?: unknown) => void;
      stop: (key: string) => void;
    };

    constructor(config: { readonly parent?: HTMLElement; readonly scene?: readonly MockSceneInstance[] }) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = 640;
      this.canvas.height = 360;
      if (config.parent) {
        config.parent.appendChild(this.canvas);
      }
      phaserHarness.lastGame = this;
      for (const s of config.scene ?? []) {
        s.game = this;
        this.scenesByKey.set(s.sceneKey, s);
        if (s.sceneKey === 'V2CombatScene') {
          phaserHarness.lastV2CombatScene = s;
        }
      }
      this.scene = {
        isActive: (key: string) => this.activeKeys.has(key),
        start: (key: string, data?: unknown) => {
          const s = this.scenesByKey.get(key);
          if (!s) return;
          this.activeKeys.add(key);
          s.sys.settings.status = MOCK_SCENE_STATUS.RUNNING;
          s.init?.(data);
          s.preload?.();
          s.create?.();
        },
        stop: (key: string) => {
          const s = this.scenesByKey.get(key);
          if (!s || !this.activeKeys.has(key)) return;
          this.activeKeys.delete(key);
          s.sys.settings.status = MOCK_SCENE_STATUS.SHUTDOWN;
          s.events.emit('shutdown');
        },
      };
      this.events.emit('ready');
    }

    destroy(): void {
      for (const key of [...this.activeKeys]) {
        this.scene.stop(key);
      }
      this.canvas.remove();
    }
  }

  return { MOCK_SCENE_STATUS, MockPhaserScene, MockPhaserGame, phaserHarness };
});

vi.mock('phaser', () => ({
  default: {
    AUTO: 0,
    BlendModes: { ADD: 1 },
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

import { ALL_SFX_KINDS, soundEngine, type SfxKind } from '../src/audio/soundEngine';
import { DEFAULT_SETTINGS } from '../src/domain/progression';
import { PhaserHost } from '../src/scenes/PhaserHost';
import { buildEncounterUnits } from '../src/v2/data/enemies';
import { createV2TutorialRun } from '../src/v2/data/tutorialV2';
import {
  calculateV2BuildStats,
  detectNewlyActivatedSynergies,
  recordV2DiscoveredSynergies,
  V2_SYNERGY_ORDER,
} from '../src/v2/domain/buildStatsV2';
import {
  commitV2EliteTacticDecision,
  commitV2ModuleOverload,
  completeV2CombatAtCurrentNode,
  listV2OverloadableModules,
  markV2CombatDecisionPaused,
  previewV2CombatNode,
  setV2LiveCombatLockedEnemy,
  setV2PreCombatLockedEnemy,
  simulateV2Combat,
  startV2CombatAtCurrentNode,
} from '../src/v2/domain/combatV2';
import { selectV2MapNode } from '../src/v2/domain/encounter';
import { createEmptyV2Bay, placeV2FromStaging } from '../src/v2/domain/inventoryV2';
import {
  createV2CargoInstance,
  createV2EquipmentInstance,
} from '../src/v2/domain/itemCatalog';
import { launchV2Expedition, saveV2LoadoutPreset } from '../src/v2/domain/loadout';
import {
  clearV2SaveData,
  createFreshV2Profile,
  createFreshV2SaveData,
  loadV2SaveData,
  migrateV3_0ToV3_1SaveData,
  persistV2SaveData,
  type V2StorageLike,
} from '../src/v2/domain/persistenceV2';
import { deriveV2ShipVisualSpec } from '../src/v2/domain/shipVisualSpec';
import {
  classifyV2CombatThreat,
  clearTacticalDeltaCache,
  computeV2PlacementTacticalDelta,
  getTacticalDeltaCacheStats,
  getV2ThreatTierMeta,
} from '../src/v2/domain/tacticalDelta';
import {
  V2_RULES_VERSION,
  V2_SAVE_KEY,
  V2_SCHEMA_VERSION,
  V3_0_BACKUP_KEY,
  V3_0_RULES_VERSION,
  V3_BACKUP_KEY,
  type V2CargoBayState,
  type V2CombatIntervention,
  type V2ProfileState,
  type V2RunState,
  type V2SaveData,
} from '../src/v2/domain/types';
import { V2CombatScene, type V2StagePlayback } from '../src/v2/scenes/V2CombatScene';
import { VFX_BEAT_TIMINGS_MS } from '../src/v2/scenes/v2CombatVfx';
import { CargoGridV2Component } from '../src/v2/ui/CargoGridV2';
import { CombatLivePhaseView, CombatPrePhaseView } from '../src/v2/ui/screens/CombatView';
import { V2AppController } from '../src/v2/ui/V2AppController';
import { openV2CodexModal } from '../src/v2/ui/V2Modals';

function createMemStorage(): V2StorageLike & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

const mkEq = (
  id: string,
  kind: Parameters<typeof createV2EquipmentInstance>[0]['kind'],
  quality: 'common' | 'improved' = 'common'
) =>
  createV2EquipmentInstance({
    instanceId: id,
    kind,
    quality,
    origin: 'loan',
    acquiredDepth: 0,
    location: 'bay',
  });

const mkCargo = (id: string, defId: string, location: 'bay' | 'staging' = 'bay') =>
  createV2CargoInstance({
    instanceId: id,
    defId,
    origin: 'loot',
    acquiredDepth: 1,
    location,
  });

function buildRunAtEncounter(
  bay: V2CargoBayState,
  encounterKind: Parameters<typeof buildEncounterUnits>[0],
  layer: number,
  startingHp: number,
  maxHp = 30
): V2RunState {
  const baseProfile = {
    ...createFreshV2Profile(),
    tutorialCompleted: true,
    unlockedShips: [
      'cannon_skiff' as const,
      'shield_cruiser' as const,
      'heavy_freighter' as const,
    ],
    unlockedFamilies: ['core' as const, 'heavy_kit' as const, 'hangar_kit' as const, 'counter_kit' as const],
    blueprints: [
      'laser' as const,
      'battery' as const,
      'shield' as const,
      'repair' as const,
      'heavy' as const,
      'capacitor' as const,
      'hangar' as const,
      'relay' as const,
      'counter' as const,
      'flak' as const,
    ],
  };
  const launched = launchV2Expedition({
    profile: baseProfile,
    contractTemplateId: 'free_salvage',
    shipId: bay.shipId,
    crewId: 'engineer',
    primaryArchetype: 'heavy',
    slots: [],
    seed: 4242,
    allowImproved: false,
  });
  if (!launched.ok || !launched.run) {
    throw new Error('Failed to launch test run');
  }
  const units = buildEncounterUnits(encounterKind, layer, `t_${encounterKind}_${layer}`);
  const isBossEnc =
    encounterKind === 'boss_anvil' ||
    encounterKind === 'boss_dreadnought' ||
    encounterKind === 'boss_leviathan';
  const nodeId = 'L2A';
  const node = {
    nodeId,
    layer,
    slotIndex: 0,
    lane: 0 as const,
    contractMarker: false,
    type: isBossEnc
      ? ('boss' as const)
      : encounterKind === 'elite'
      ? ('elite' as const)
      : ('combat' as const),
    ...(isBossEnc ? { bossId: encounterKind } : {}),
    sectorBg: 2 as const,
    nextNodeIds: [],
    resolved: false,
    abandoned: false,
    combat: {
      encounterKind,
      units,
      bounty: 25,
      improvedProb: 0,
    },
  };
  return {
    ...launched.run,
    hp: startingHp,
    maxHp,
    bay,
    phase: 'ENCOUNTER',
    currentNodeId: nodeId,
    lockedEnemyId: null,
    graph: {
      ...launched.run.graph,
      nodes: {
        ...launched.run.graph.nodes,
        [nodeId]: node,
      },
    },
  };
}

// ===========================================================================
// 1. D01 — Component Overload (Domain + Reload + DOM + Canvas)
// ===========================================================================

describe('R2-M6A D01: Component Overload, Shared Charge Pool, Threat Lift & Canvas/DOM Wiring', () => {
  beforeEach(() => {
    phaserHarness.reset();
    clearTacticalDeltaCache();
  });

  it('executes genuine deterministic per-module overloads (laser, heavy off-round, shield, repair, battery adjacent surge)', () => {
    const units = buildEncounterUnits('armored', 4, 'd01_arm');

    // 1) Laser overload: extra burst strike (isOverload: true) + main shot boost
    const laserBay: V2CargoBayState = {
      ...createEmptyV2Bay('cannon_skiff'),
      placed: [{ item: mkEq('l1', 'laser'), x: 0, y: 0, rotation: 0 }],
    };
    const laserBase = simulateV2Combat({
      resultId: 'l_base',
      bay: laserBay,
      startingHp: 30,
      maxHp: 30,
      units,
      targetPolicy: 'weakest',
    });
    const laserOv = simulateV2Combat({
      resultId: 'l_ov',
      bay: laserBay,
      startingHp: 30,
      maxHp: 30,
      units,
      targetPolicy: 'weakest',
      interventions: [
        { interventionId: 'iv_l', roundNumber: 2, kind: 'overload_module', moduleInstanceId: 'l1', moduleKind: 'laser' },
      ],
    });
    const r2LaserAttacks = laserOv.rounds[1].playerAttacks.filter((a) => a.sourceKind === 'laser');
    expect(r2LaserAttacks.length).toBe(2);
    expect(r2LaserAttacks.every((a) => a.isOverload === true)).toBe(true);
    expect(laserOv.rounds[1].enemiesAfter[0].hp).toBeLessThan(laserBase.rounds[1].enemiesAfter[0].hp);

    // 2) Heavy overload on off-round cooldown (Round 2 when capacitor makes heavy fire on odd rounds!)
    const heavyBay: V2CargoBayState = {
      ...createEmptyV2Bay('cannon_skiff'),
      placed: [
        { item: mkEq('h1', 'heavy'), x: 0, y: 0, rotation: 0 },
        { item: mkEq('c1', 'capacitor'), x: 1, y: 0, rotation: 0 },
        { item: mkEq('s1', 'shield'), x: 2, y: 0, rotation: 0 },
      ],
    };
    const heavyBase = simulateV2Combat({
      resultId: 'h_base',
      bay: heavyBay,
      startingHp: 30,
      maxHp: 30,
      units,
      targetPolicy: 'weakest',
    });
    expect(heavyBase.rounds[1].heavyChargingIds).toContain('h1'); // Round 2 normally charging!
    const heavyOv = simulateV2Combat({
      resultId: 'h_ov',
      bay: heavyBay,
      startingHp: 30,
      maxHp: 30,
      units,
      targetPolicy: 'weakest',
      interventions: [
        { interventionId: 'iv_h', roundNumber: 2, kind: 'overload_module', moduleInstanceId: 'h1', moduleKind: 'heavy' },
      ],
    });
    expect(heavyOv.rounds[1].heavyChargingIds).not.toContain('h1');
    const r2HeavyHit = heavyOv.rounds[1].playerAttacks.find((a) => a.sourceKind === 'heavy');
    expect(r2HeavyHit?.isOverload).toBe(true);
    expect(r2HeavyHit?.armorBlocked).toBe(0);

    // 3) Shield overload: immediate shield surge + halved enemy pierce
    const piercerUnits = buildEncounterUnits('piercer', 4, 'd01_prc');
    const shieldBase = simulateV2Combat({
      resultId: 's_base',
      bay: heavyBay,
      startingHp: 22,
      maxHp: 30,
      units: piercerUnits,
      targetPolicy: 'weakest',
    });
    const shieldOv = simulateV2Combat({
      resultId: 's_ov',
      bay: heavyBay,
      startingHp: 22,
      maxHp: 30,
      units: piercerUnits,
      targetPolicy: 'weakest',
      interventions: [
        { interventionId: 'iv_s', roundNumber: 2, kind: 'overload_module', moduleInstanceId: 's1', moduleKind: 'shield' },
      ],
    });
    expect(shieldOv.rounds[1].enemyAttacks[0].pierceDamage).toBeLessThan(
      shieldBase.rounds[1].enemyAttacks[0].pierceDamage
    );
    expect(shieldOv.finalPlayerHpAfterRepair).toBeGreaterThan(shieldBase.finalPlayerHpAfterRepair);

    // 4) Repair overload: immediate mid-combat HP patch clamped at maxHp + 3 shield
    const repairBay: V2CargoBayState = {
      ...createEmptyV2Bay('cannon_skiff'),
      placed: [
        { item: mkEq('l1', 'laser'), x: 0, y: 0, rotation: 0 },
        { item: mkEq('rp1', 'repair'), x: 1, y: 0, rotation: 0 },
      ],
    };
    const repBase = simulateV2Combat({
      resultId: 'rp_base',
      bay: repairBay,
      startingHp: 18,
      maxHp: 30,
      units,
      targetPolicy: 'weakest',
    });
    const repOv = simulateV2Combat({
      resultId: 'rp_ov',
      bay: repairBay,
      startingHp: 18,
      maxHp: 30,
      units,
      targetPolicy: 'weakest',
      interventions: [
        { interventionId: 'iv_rp', roundNumber: 2, kind: 'overload_module', moduleInstanceId: 'rp1', moduleKind: 'repair' },
      ],
    });
    expect(repOv.rounds[1].playerHpAfter).toBeGreaterThan(repBase.rounds[1].playerHpAfter);
    expect(repOv.rounds[1].playerHpAfter).toBeLessThanOrEqual(30);

    // 5) Battery overload: surges ALL orthogonally adjacent equipment modules together (even passive-capped laser + heavy + shield!)
    const batBay: V2CargoBayState = {
      ...createEmptyV2Bay('cannon_skiff'),
      placed: [
        { item: mkEq('l1', 'laser'), x: 0, y: 0, rotation: 0 },
        { item: mkEq('b1', 'battery'), x: 1, y: 0, rotation: 0 },
        { item: mkEq('l2', 'laser'), x: 2, y: 0, rotation: 0 }, // Starved passively by common battery cap=1!
        { item: mkEq('s1', 'shield'), x: 1, y: 1, rotation: 0 }, // Adjacent below battery!
      ],
    };
    expect(calculateV2BuildStats(batBay).cappedLinks.length).toBe(1);
    const batBase = simulateV2Combat({
      resultId: 'bat_base',
      bay: batBay,
      startingHp: 22,
      maxHp: 30,
      units,
      targetPolicy: 'weakest',
    });
    const batOv = simulateV2Combat({
      resultId: 'bat_ov',
      bay: batBay,
      startingHp: 22,
      maxHp: 30,
      units,
      targetPolicy: 'weakest',
      interventions: [
        { interventionId: 'iv_b', roundNumber: 2, kind: 'overload_module', moduleInstanceId: 'b1', moduleKind: 'battery' },
      ],
    });
    const r2OvLasers = batOv.rounds[1].playerAttacks.filter((a) => a.sourceKind === 'laser' && a.isOverload);
    // BOTH l1 AND starved l2 get surged (main + extra burst each = 4 overload laser events) AND shield surges!
    expect(r2OvLasers.length).toBe(4);
    expect(batOv.rounds[1].playerShieldAfter + batOv.rounds[1].shieldAbsorbedTotal).toBeGreaterThan(
      batBase.rounds[1].playerShieldAfter + batBase.rounds[1].shieldAbsorbedTotal
    );
  });

  it('lifts strained/dangerous/lethal fights by >= 1 Threat Tier via smart component overload', () => {
    const heavyBay: V2CargoBayState = {
      ...createEmptyV2Bay('cannon_skiff'),
      placed: [
        { item: mkEq('h1', 'heavy'), x: 0, y: 0, rotation: 0 },
        { item: mkEq('c1', 'capacitor'), x: 1, y: 0, rotation: 0 },
        { item: mkEq('s1', 'shield'), x: 2, y: 0, rotation: 0 },
      ],
    };
    const artUnits = buildEncounterUnits('artillery', 4, 'd01_lift_art');
    const baseArt = simulateV2Combat({
      resultId: 'lift_base',
      bay: heavyBay,
      startingHp: 18,
      maxHp: 30,
      units: artUnits,
      targetPolicy: 'weakest',
      encounterKind: 'artillery',
    });
    const ovArt = simulateV2Combat({
      resultId: 'lift_ov',
      bay: heavyBay,
      startingHp: 18,
      maxHp: 30,
      units: artUnits,
      targetPolicy: 'weakest',
      encounterKind: 'artillery',
      interventions: [
        { interventionId: 'iv_lift', roundNumber: 2, kind: 'overload_module', moduleInstanceId: 's1', moduleKind: 'shield' },
      ],
    });
    const baseRank = getV2ThreatTierMeta(
      classifyV2CombatThreat({ outcome: baseArt.outcome, playerFinalHp: baseArt.finalPlayerHpAfterRepair }, 30).tier
    ).rank;
    const ovRank = getV2ThreatTierMeta(
      classifyV2CombatThreat({ outcome: ovArt.outcome, playerFinalHp: ovArt.finalPlayerHpAfterRepair }, 30).tier
    ).rank;
    expect(baseRank - ovRank).toBeGreaterThanOrEqual(1);

    // Lethal -> Victory survival lift with battery adjacent surge!
    const sandwichBay: V2CargoBayState = {
      ...createEmptyV2Bay('cannon_skiff'),
      placed: [
        { item: mkEq('l1', 'laser'), x: 0, y: 0, rotation: 0 },
        { item: mkEq('b1', 'battery'), x: 1, y: 0, rotation: 0 },
        { item: mkEq('l2', 'laser'), x: 2, y: 0, rotation: 0 },
      ],
    };
    const baseSw = simulateV2Combat({
      resultId: 'sw_base',
      bay: sandwichBay,
      startingHp: 20,
      maxHp: 30,
      units: artUnits,
      targetPolicy: 'weakest',
      encounterKind: 'artillery',
    });
    const ovSw = simulateV2Combat({
      resultId: 'sw_ov',
      bay: sandwichBay,
      startingHp: 20,
      maxHp: 30,
      units: artUnits,
      targetPolicy: 'weakest',
      encounterKind: 'artillery',
      interventions: [
        { interventionId: 'iv_bat', roundNumber: 2, kind: 'overload_module', moduleInstanceId: 'b1', moduleKind: 'battery' },
      ],
    });
    expect(baseSw.outcome).toBe('defeat');
    expect(ovSw.outcome).toBe('victory');
    const baseSwRank = getV2ThreatTierMeta(
      classifyV2CombatThreat({ outcome: baseSw.outcome, playerFinalHp: baseSw.finalPlayerHpAfterRepair }, 30).tier
    ).rank;
    const ovSwRank = getV2ThreatTierMeta(
      classifyV2CombatThreat({ outcome: ovSw.outcome, playerFinalHp: ovSw.finalPlayerHpAfterRepair }, 30).tier
    ).rank;
    expect(baseSwRank - ovSwRank).toBeGreaterThanOrEqual(1);
  });

  it('enforces shared charge pool, idempotency, null pendingDecision (never corrupting chosen), and bit-for-bit reload replay', () => {
    const bay: V2CargoBayState = {
      ...createEmptyV2Bay('cannon_skiff'),
      placed: [
        { item: mkEq('h1', 'heavy'), x: 0, y: 0, rotation: 0 },
        { item: mkEq('c1', 'capacitor'), x: 1, y: 0, rotation: 0 },
        { item: mkEq('s1', 'shield'), x: 2, y: 0, rotation: 0 },
      ],
    };
    const run = buildRunAtEncounter(bay, 'armored', 4, 24, 30);
    const started = startV2CombatAtCurrentNode(run, 'weakest', { enableTacticalCommands: true });
    expect(started.ok).toBe(true);
    const decisionId = started.run.activeCombat!.pendingDecision!.decisionId;

    // Cannot complete while unresolved
    expect(completeV2CombatAtCurrentNode(started.run, ['core']).ok).toBe(false);

    // Commit module overload consumes 1 charge & clears pendingDecision cleanly (never writing 'overload_module' into chosen!)
    const committed = commitV2ModuleOverload(started.run, decisionId, 'h1');
    expect(committed.ok).toBe(true);
    expect(committed.run.tacticalChargesUsed).toBe(1);
    expect(committed.run.tacticalChargesMax).toBe(1);
    expect(committed.run.activeCombat!.pendingDecision).toBeNull();
    expect(committed.run.activeCombat!.interventions).toHaveLength(1);
    expect(committed.run.activeCombat!.interventions![0]).toMatchObject({
      interventionId: decisionId,
      roundNumber: 2,
      kind: 'overload_module',
      moduleInstanceId: 'h1',
      moduleKind: 'heavy',
    });

    // Double commit (overload OR tactical command on same decisionId) is strictly rejected!
    expect(commitV2ModuleOverload(committed.run, decisionId, 's1').ok).toBe(false);
    expect(commitV2EliteTacticDecision(committed.run, decisionId, 'overload').ok).toBe(false);

    // Persist mid-combat & reload via persistenceV2 -> bit-for-bit replay parity!
    const storage = createMemStorage();
    const savePayload: V2SaveData = {
      ...createFreshV2SaveData(),
      activeRun: committed.run,
    };
    expect(persistV2SaveData(storage, savePayload).ok).toBe(true);
    const loaded = loadV2SaveData(storage);
    expect(loaded.status).toBe('loaded');
    if (loaded.status !== 'loaded') throw new Error('expected loaded');
    const reloadedRun = loaded.data.activeRun!;
    expect(reloadedRun.activeCombat!.interventions).toEqual(committed.run.activeCombat!.interventions);

    const node = reloadedRun.graph.nodes[reloadedRun.currentNodeId!]!;
    const replayedSim = simulateV2Combat({
      resultId: reloadedRun.activeCombat!.simulation.resultId,
      bay: reloadedRun.bay,
      startingHp: reloadedRun.activeCombat!.startingHp,
      maxHp: reloadedRun.maxHp,
      units: node.combat!.units,
      targetPolicy: reloadedRun.activeCombat!.targetPolicy,
      lockedEnemyId: reloadedRun.activeCombat!.lockedEnemyId ?? null,
      interventions: reloadedRun.activeCombat!.interventions ?? [],
      sectorId: reloadedRun.sectorId,
      crewId: reloadedRun.crewId,
      crewMasteryTier: reloadedRun.crewMasteryTier ?? 0,
      encounterKind: node.combat!.encounterKind,
    });
    expect(replayedSim).toEqual(reloadedRun.activeCombat!.simulation);

    // Now completeV2CombatAtCurrentNode succeeds cleanly!
    const done = completeV2CombatAtCurrentNode(reloadedRun, ['core']);
    expect(done.ok).toBe(true);
    expect(done.run.activeCombat).toBeNull();
    expect(done.run.lockedEnemyId).toBeNull();
  });

  it('wires CombatLivePhaseView overload buttons & V2CombatScene clickable modules (0 setTintFill, PR #4 canvas guard, exact VFX timings & 34 SFX)', () => {
    expect([
      VFX_BEAT_TIMINGS_MS.charge,
      VFX_BEAT_TIMINGS_MS.playerFire,
      VFX_BEAT_TIMINGS_MS.playerImpact,
      VFX_BEAT_TIMINGS_MS.enemyFire,
      VFX_BEAT_TIMINGS_MS.enemyImpact,
      VFX_BEAT_TIMINGS_MS.resolve,
    ]).toEqual([0, 120, 180, 450, 510, 590]);
    expect(ALL_SFX_KINDS.length).toBe(34);

    const bay: V2CargoBayState = {
      ...createEmptyV2Bay('cannon_skiff'),
      placed: [
        { item: mkEq('h1', 'heavy'), x: 0, y: 0, rotation: 0 },
        { item: mkEq('b1', 'battery'), x: 1, y: 0, rotation: 0 },
        { item: mkEq('l1', 'laser'), x: 2, y: 0, rotation: 0 },
      ],
    };
    const run = buildRunAtEncounter(bay, 'armored', 4, 24, 30);
    const started = startV2CombatAtCurrentNode(run, 'weakest', { enableTacticalCommands: true }).run;
    const decisionId = started.activeCombat!.pendingDecision!.decisionId;

    // 1) CombatLivePhaseView renders 4 tactical orders + keyed overload-module-* buttons with 0 raw HP/rounds on Layer 1
    const host = document.createElement('div');
    const liveView = new CombatLivePhaseView();
    liveView.mount(host);
    const overloadedCalls: [string, string][] = [];
    const actions = {
      onPeekBay: () => {},
      onToggleSpeed: () => {},
      onSkipPlayback: () => {},
      onCommitEliteTactic: () => {},
      onOverloadModule: (did: string, mid: string) => overloadedCalls.push([did, mid]),
    };
    const props = {
      run: started,
      liveCombatRound: 2,
      liveCombatPlayerHp: 21,
      liveCombatPlayerShield: 0,
      liveCombatEnemiesAlive: 1,
      liveCombatEventLine: '',
      liveEnemySnapshots: started.activeCombat!.simulation.rounds[0].enemiesAfter,
      livePhaseBannerText: null,
      awaitingEliteDecision: true,
      combatSpeed: 1 as const,
    };
    liveView.update(props, actions);

    expect(host.querySelectorAll('[data-elite-tactic]').length).toBe(4);
    const heavyBtn = host.querySelector<HTMLButtonElement>('[data-testid="overload-module-h1"]')!;
    const batBtn = host.querySelector<HTMLButtonElement>('[data-testid="overload-module-b1"]')!;
    expect(heavyBtn).not.toBeNull();
    expect(batBtn).not.toBeNull();
    // Layer-1 qualitative threat only (no raw HP/round leaks)
    expect(heavyBtn.textContent).not.toMatch(/余\s*\d+\s*HP/);
    expect(heavyBtn.textContent).not.toMatch(/\(\d+轮\)/);

    // Re-update preserves exact DOM node identity
    liveView.update(props, actions);
    expect(host.querySelector('[data-testid="overload-module-h1"]')).toBe(heavyBtn);

    heavyBtn.click();
    expect(overloadedCalls).toEqual([[decisionId, 'h1']]);
    liveView.unmount();

    // 2) V2CombatScene clickable mounted ship modules + PR #4 canvas target guard + 0 setTintFill
    const scene = new V2CombatScene();
    const game = new MockPhaserGame({
      scene: [scene as unknown as InstanceType<typeof MockPhaserScene>],
    });
    const canvasOverloads: string[] = [];
    const pb: V2StagePlayback = {
      shipId: 'cannon_skiff',
      shipVisualSpec: deriveV2ShipVisualSpec(bay),
      sectorId: 'near_orbit',
      sectorIndex: 2,
      eventBackdrop: null,
      units: started.graph.nodes[started.currentNodeId!]!.combat!.units,
      simulation: started.activeCombat!.simulation,
      settings: DEFAULT_SETTINGS,
      pauseAtRound: 2,
      overloadableModules: listV2OverloadableModules(bay).map((m) => ({
        instanceId: m.instanceId,
        kind: m.kind,
        label: m.name,
      })),
      canOverloadModules: true,
      onModuleOverload: (mid) => canvasOverloads.push(mid),
    };
    game.scene.start('V2CombatScene', { playback: pb });

    const snap = scene.getStagePresentationSnapshot();
    expect(snap.canOverloadModules).toBe(true);
    expect(snap.clickableModuleIds).toContain('h1');
    expect(snap.clickableModuleIds).toContain('b1');

    const heavySprite = phaserHarness.createdDisplayObjects.find(
      (obj) => obj.textureKey === 'ship.mod.heavy_railgun' && obj.scene !== null
    )!;
    // Non-canvas DOM target MUST be ignored (PR #4 guard)
    const fakeOverlayEl = document.createElement('button');
    heavySprite.emit('pointerdown', { event: { target: fakeOverlayEl } });
    expect(canvasOverloads).toEqual([]);

    // Genuine canvas target triggers overload callback!
    heavySprite.emit('pointerdown', { event: { target: game.canvas } });
    expect(canvasOverloads).toEqual(['h1']);

    // Battery hull node tag is also clickable directly on canvas!
    const batTag = phaserHarness.createdDisplayObjects.find(
      (obj) => obj.text.includes('能量电池') && obj.scene !== null
    )!;
    batTag.emit('pointerdown', { event: { target: game.canvas } });
    expect(canvasOverloads).toEqual(['h1', 'b1']);

    // Step update frame -> verify 0 setTintFill calls
    scene.update(100, 16);
    expect(phaserHarness.setTintFillCalls).toBe(0);
    game.destroy();
  });
});

// ===========================================================================
// 2. D02 — Multi-Unit Enemy Intent Telegraphs & Specific-Enemy Target Lock
// ===========================================================================

describe('R2-M6A D02: Enemy Intent Telegraphs, Specific-Enemy Target Lock & 150-Battle Flip Matrix', () => {
  beforeEach(() => {
    phaserHarness.reset();
    clearTacticalDeltaCache();
  });

  it('executes allyShieldGain escort telegraphs and honors lockedEnemyId with auto-fallback on death and immutable Round-1 mid-combat lock', () => {
    const bay: V2CargoBayState = {
      ...createEmptyV2Bay('cannon_skiff'),
      placed: [
        { item: mkEq('h1', 'heavy'), x: 0, y: 0, rotation: 0 },
        { item: mkEq('c1', 'capacitor'), x: 1, y: 0, rotation: 0 },
        { item: mkEq('s1', 'shield'), x: 2, y: 0, rotation: 0 },
      ],
    };
    const artUnits = buildEncounterUnits('artillery', 3, 'd02_art');
    expect(artUnits.length).toBe(2);
    const cannonId = artUnits[0].enemyId;
    const escortId = artUnits[1].enemyId;

    // Locking the main artillery cannon leaves escort alive on R1 -> escort projects +3 ally shield onto artillery cannon!
    const simLockCannon = simulateV2Combat({
      resultId: 'lock_cannon',
      bay,
      startingHp: 30,
      maxHp: 30,
      units: artUnits,
      targetPolicy: 'weakest',
      lockedEnemyId: cannonId,
      encounterKind: 'artillery',
    });
    expect(simLockCannon.rounds[0].playerAttacks.every((a) => a.targetEnemyId === cannonId)).toBe(true);
    expect(simLockCannon.rounds[0].lockedEnemyIdUsed).toBe(cannonId);
    expect(simLockCannon.rounds[0].enemiesAfter[0].shield).toBe(3); // Escort projected +3 shield!

    // Locking the escort kills escort on R1 -> no ally shield projection AND subsequent rounds auto-fallback to cannon!
    const simLockEscort = simulateV2Combat({
      resultId: 'lock_escort',
      bay,
      startingHp: 30,
      maxHp: 30,
      units: artUnits,
      targetPolicy: 'highest_threat',
      lockedEnemyId: escortId,
      encounterKind: 'artillery',
    });
    expect(simLockEscort.rounds[0].enemiesAfter[1].hp).toBe(0);
    expect(simLockEscort.rounds[0].enemiesAfter[0].shield ?? 0).toBe(0);
    expect(simLockEscort.rounds[1].playerAttacks[0].targetEnemyId).toBe(cannonId); // Auto-fallback!

    // Mid-combat retargeting NEVER retroactively mutates Round 1!
    const run = buildRunAtEncounter(bay, 'artillery', 3, 28, 30);
    const runUnits = run.graph.nodes[run.currentNodeId!]!.combat!.units;
    const runCannonId = runUnits[0].enemyId;
    const runEscortId = runUnits[1].enemyId;

    const preLocked = setV2PreCombatLockedEnemy(run, runCannonId);
    expect(preLocked.ok).toBe(true);
    expect(preLocked.run.lockedEnemyId).toBe(runCannonId);

    const started = startV2CombatAtCurrentNode(preLocked.run, 'weakest', {
      enableTacticalCommands: true,
    });
    const round1Before = structuredClone(started.run.activeCombat!.simulation.rounds[0]);

    const retargeted = setV2LiveCombatLockedEnemy(started.run, runEscortId, 1);
    expect(retargeted.ok).toBe(true);
    // Opening lock stays immutable on activeCombat.lockedEnemyId; Round 1 is bit-for-bit unchanged!
    expect(retargeted.run.activeCombat!.lockedEnemyId).toBe(runCannonId);
    expect(retargeted.run.lockedEnemyId).toBe(runEscortId);
    expect(retargeted.run.activeCombat!.simulation.rounds[0]).toEqual(round1Before);
    // Round 2 switches cleanly to runEscortId via target_lock intervention!
    expect(retargeted.run.activeCombat!.simulation.rounds[1].lockedEnemyIdUsed).toBe(runEscortId);
    expect(retargeted.run.activeCombat!.interventions).toContainEqual(
      expect.objectContaining({ roundNumber: 2, kind: 'target_lock', targetEnemyId: runEscortId })
    );

    // Dead enemy lock is rejected cleanly (weakest kills escort in R1 -> trying to lock dead escort on R2 fails!)
    const startedWeakest = startV2CombatAtCurrentNode(run, 'weakest', {
      enableTacticalCommands: true,
    });
    expect(startedWeakest.run.activeCombat!.simulation.rounds[0].enemiesAfter[1].hp).toBe(0);
    expect(setV2LiveCombatLockedEnemy(startedWeakest.run, runEscortId, 1).ok).toBe(false);

    // Node-isolation guard in previewV2CombatNode (unconditional)
    const otherNodeId = Object.keys(run.graph.nodes).find(
      (nid) => nid !== run.currentNodeId && Boolean(run.graph.nodes[nid].combat)
    );
    expect(otherNodeId).toBeDefined();
    const otherPv = previewV2CombatNode(preLocked.run, otherNodeId!);
    expect(otherPv?.lockedEnemyId).toBeNull();
  });

  it('G4 / D02 Quantitative Gate: switching targetPolicy / lockedEnemyId flips win/loss in >= 10% (>= 15/150) across 5 builds x 6 layers x 5 encounters', () => {
    const builds: { readonly name: string; readonly hp: number; readonly bay: V2CargoBayState }[] = [
      {
        name: 'sandwich',
        hp: 30,
        bay: {
          ...createEmptyV2Bay('cannon_skiff'),
          placed: [
            { item: mkEq('l1', 'laser'), x: 0, y: 0, rotation: 0 },
            { item: mkEq('b1', 'battery'), x: 1, y: 0, rotation: 0 },
            { item: mkEq('l2', 'laser'), x: 2, y: 0, rotation: 0 },
          ],
        },
      },
      {
        name: 'heavy_cap_shield',
        hp: 30,
        bay: {
          ...createEmptyV2Bay('cannon_skiff'),
          placed: [
            { item: mkEq('h1', 'heavy'), x: 0, y: 0, rotation: 0 },
            { item: mkEq('c1', 'capacitor'), x: 1, y: 0, rotation: 0 },
            { item: mkEq('s1', 'shield'), x: 2, y: 0, rotation: 0 },
          ],
        },
      },
      {
        name: 'hangar_relay_repair',
        hp: 30,
        bay: {
          ...createEmptyV2Bay('cannon_skiff'),
          placed: [
            { item: mkEq('hg1', 'hangar'), x: 0, y: 0, rotation: 0 },
            { item: mkEq('rl1', 'relay'), x: 2, y: 0, rotation: 0 },
            { item: mkEq('rp1', 'repair'), x: 2, y: 1, rotation: 0 },
          ],
        },
      },
      {
        name: 'shield_counter_laser',
        hp: 34,
        bay: {
          ...createEmptyV2Bay('shield_cruiser'),
          placed: [
            { item: mkEq('s1', 'shield'), x: 0, y: 0, rotation: 0 },
            { item: mkEq('ct1', 'counter'), x: 1, y: 0, rotation: 0 },
            { item: mkEq('l1', 'laser'), x: 2, y: 0, rotation: 0 },
          ],
        },
      },
      {
        name: 'flak_laser',
        hp: 30,
        bay: {
          ...createEmptyV2Bay('cannon_skiff'),
          placed: [
            { item: mkEq('fl1', 'flak'), x: 0, y: 0, rotation: 0 },
            { item: mkEq('l1', 'laser'), x: 3, y: 0, rotation: 0 },
          ],
        },
      },
    ];

    const encKinds = ['artillery', 'shield_regen', 'drone_carrier', 'rammer', 'elite'] as const;
    let totalBattles = 0;
    let winLossFlips = 0;

    for (const b of builds) {
      for (let layer = 1; layer <= 6; layer++) {
        for (const kind of encKinds) {
          totalBattles += 1;
          const units = buildEncounterUnits(kind, layer, `g4_${kind}_${layer}`);
          const outcomes = new Set<'victory' | 'defeat'>();
          for (const pol of ['weakest', 'highest_threat'] as const) {
            outcomes.add(
              simulateV2Combat({
                resultId: 'g4_pol',
                bay: b.bay,
                startingHp: b.hp,
                maxHp: b.hp,
                units,
                targetPolicy: pol,
                encounterKind: kind,
              }).outcome
            );
          }
          for (const u of units) {
            outcomes.add(
              simulateV2Combat({
                resultId: 'g4_lock',
                bay: b.bay,
                startingHp: b.hp,
                maxHp: b.hp,
                units,
                targetPolicy: 'weakest',
                lockedEnemyId: u.enemyId,
                encounterKind: kind,
              }).outcome
            );
          }
          if (outcomes.size > 1) {
            winLossFlips += 1;
          }
        }
      }
    }

    expect(totalBattles).toBe(150);
    expect(winLossFlips).toBeGreaterThanOrEqual(15); // >= 10%
  });

  it('wires CombatPrePhaseView & CombatLivePhaseView lock buttons + V2CombatScene canvas enemy click & in-place lock update without S04 regression', () => {
    const bay: V2CargoBayState = {
      ...createEmptyV2Bay('cannon_skiff'),
      placed: [{ item: mkEq('l1', 'laser'), x: 0, y: 0, rotation: 0 }],
    };

    // Single-enemy S04 check: .v2-policy-box stays null AND no enemy-lock clutter
    const singleRun = buildRunAtEncounter(bay, 'armored', 2, 30, 30);
    const preHost = document.createElement('div');
    const preView = new CombatPrePhaseView();
    preView.mount(preHost);
    preView.update(
      {
        run: singleRun,
        node: singleRun.graph.nodes[singleRun.currentNodeId!]!,
        readOnly: false,
        showCombatLogDetails: false,
        pureAutoCombat: false,
      },
      {
        onSelectPolicy: () => {},
        onToggleLog: () => {},
        onStartCombat: () => {},
      }
    );
    expect(preHost.querySelector('.v2-policy-box')).toBeNull();

    // Multi-enemy pre-combat renders enemy-lock-<id> toggles + handles click
    const multiRun = buildRunAtEncounter(bay, 'artillery', 3, 30, 30);
    const multiNode = multiRun.graph.nodes[multiRun.currentNodeId!]!;
    const targetEnemyId = multiNode.combat!.units[1].enemyId;
    const lockedClicks: string[] = [];
    preView.update(
      {
        run: multiRun,
        node: multiNode,
        readOnly: false,
        showCombatLogDetails: false,
        pureAutoCombat: false,
      },
      {
        onSelectPolicy: () => {},
        onToggleLog: () => {},
        onToggleLockEnemy: (eid) => lockedClicks.push(eid),
        onStartCombat: () => {},
      }
    );
    expect(preHost.querySelector('.v2-policy-box')).not.toBeNull();
    const lockBtn = preHost.querySelector<HTMLButtonElement>(`[data-testid="enemy-lock-${targetEnemyId}"]`)!;
    expect(lockBtn).not.toBeNull();
    expect(lockBtn.getAttribute('aria-pressed')).toBe('false');
    lockBtn.click();
    expect(lockedClicks).toEqual([targetEnemyId]);
    preView.unmount();

    // V2CombatScene clickable enemy sprite + in-place updateLockedEnemy
    const scene = new V2CombatScene();
    const game = new MockPhaserGame({
      scene: [scene as unknown as InstanceType<typeof MockPhaserScene>],
    });
    const canvasLocks: string[] = [];
    game.scene.start('V2CombatScene', {
      playback: {
        playbackKey: 'pre_combat|test',
        shipId: 'cannon_skiff',
        shipVisualSpec: deriveV2ShipVisualSpec(bay),
        sectorId: 'near_orbit',
        sectorIndex: 2,
        eventBackdrop: null,
        units: multiNode.combat!.units,
        simulation: null,
        settings: DEFAULT_SETTINGS,
        lockedEnemyId: null,
        onEnemyLock: (eid) => canvasLocks.push(eid),
      } satisfies V2StagePlayback,
    });
    const enemySprites = phaserHarness.createdDisplayObjects.filter(
      (o) => o.textureKey.startsWith('ship.enemy.') && o.scene !== null
    );
    expect(enemySprites.length).toBe(2);
    enemySprites[1].emit('pointerdown', { event: { target: game.canvas } });
    expect(canvasLocks).toEqual([targetEnemyId]);

    scene.updateLockedEnemy(targetEnemyId);
    expect(scene.getStagePresentationSnapshot().lockedEnemyId).toBe(targetEnemyId);
    scene.update(100, 16);
    expect(phaserHarness.setTintFillCalls).toBe(0);
    game.destroy();
  });
});

// ===========================================================================
// 3. D03 — Battery Supply Cap, Cross-Category coolant_tank↔heavy, Anti-Dominance,
//          Tutorial Preservation, CargoGridV2 Visuals, Discovery Toast & Codex
// ===========================================================================

describe('R2-M6A D03: Battery Cap, coolant_tank↔heavy Cross-Category Synergy, Anti-Dominance & Discovery', () => {
  beforeEach(() => {
    phaserHarness.reset();
    clearTacticalDeltaCache();
  });

  it('enforces battery supply capacity cap (common=1, improved=2, Kuhn optimal matching, passive laser-only)', () => {
    // Common sandwich: 1 supplied (+2) + 1 capped (✕ 上限)
    const commonSandwich: V2CargoBayState = {
      ...createEmptyV2Bay('cannon_skiff'),
      placed: [
        { item: mkEq('l1', 'laser'), x: 0, y: 0, rotation: 0 },
        { item: mkEq('b1', 'battery', 'common'), x: 1, y: 0, rotation: 0 },
        { item: mkEq('l2', 'laser'), x: 2, y: 0, rotation: 0 },
      ],
    };
    const stCommon = calculateV2BuildStats(commonSandwich);
    expect(stCommon.links).toHaveLength(1);
    expect(stCommon.cappedLinks).toHaveLength(1);
    expect(stCommon.cappedLinks[0].label).toBe('✕ 上限');
    expect(stCommon.lasers.filter((l) => l.batteryBonus > 0)).toHaveLength(1);
    expect(stCommon.lasers.filter((l) => l.batteryCapped)).toHaveLength(1);
    expect(stCommon.nominalRound1SingleDmg).toBe(2 + 5 + 3); // Core 2 + boosted 5 + starved 3 = 10

    // Improved battery supplies 2 lasers (+3 each), starves 3rd laser (strictly legal non-overlapping 4x4)
    const improvedTri: V2CargoBayState = {
      ...createEmptyV2Bay('cannon_skiff'),
      placed: [
        { item: mkEq('l1', 'laser'), x: 0, y: 1, rotation: 0 },
        { item: mkEq('b1', 'battery', 'improved'), x: 1, y: 1, rotation: 0 },
        { item: mkEq('l2', 'laser'), x: 2, y: 1, rotation: 0 },
        { item: mkEq('l3', 'laser'), x: 1, y: 0, rotation: 1 },
      ],
    };
    const stImp = calculateV2BuildStats(improvedTri);
    expect(stImp.links).toHaveLength(2);
    expect(stImp.cappedLinks).toHaveLength(1);
    expect(stImp.lasers.filter((l) => l.batteryBonus === 3)).toHaveLength(2);
    expect(stImp.lasers.filter((l) => l.batteryCapped)).toHaveLength(1);

    // Kuhn 2-phase optimal matching beats greedy lexicographic matching! (strictly legal non-overlapping 4x4)
    // b_imp (cap 2) adjacent to l_a, l_b, l_c; b_com (cap 1) adjacent ONLY to l_a.
    // Optimal assigns b_com -> l_a (+2) and b_imp -> l_b, l_c (+3, +3) = +8 total across all 3 lasers!
    const kuhnBay: V2CargoBayState = {
      ...createEmptyV2Bay('cannon_skiff'),
      placed: [
        { item: mkEq('b_com', 'battery', 'common'), x: 0, y: 0, rotation: 0 },
        { item: mkEq('l_a', 'laser'), x: 1, y: 0, rotation: 1 },
        { item: mkEq('b_imp', 'battery', 'improved'), x: 1, y: 1, rotation: 0 },
        { item: mkEq('l_b', 'laser'), x: 1, y: 2, rotation: 0 },
        { item: mkEq('l_c', 'laser'), x: 2, y: 1, rotation: 0 },
      ],
    };
    const stKuhn = calculateV2BuildStats(kuhnBay);
    expect(stKuhn.lasers.reduce((sum, l) => sum + l.batteryBonus, 0)).toBe(8);
    expect(stKuhn.lasers.every((l) => !l.batteryCapped)).toBe(true);

    // Passive battery MUST remain laser-only (preserves S07 fallback heavy+battery links.length === 0)
    const heavyBatBay: V2CargoBayState = {
      ...createEmptyV2Bay('cannon_skiff'),
      placed: [
        { item: mkEq('h1', 'heavy'), x: 0, y: 0, rotation: 0 },
        { item: mkEq('b1', 'battery', 'common'), x: 1, y: 0, rotation: 0 },
      ],
    };
    const stHB = calculateV2BuildStats(heavyBatBay);
    expect(stHB.links).toHaveLength(0);
    expect(stHB.cappedLinks).toHaveLength(0);
  });

  it('activates cargo.coolant_tank ↔ heavy (+4, non-stacking) and computes tacticalDelta while keeping data_box 0-sim fast path', () => {
    const heavyCoolantBay: V2CargoBayState = {
      ...createEmptyV2Bay('cannon_skiff'),
      placed: [
        { item: mkEq('h1', 'heavy'), x: 0, y: 0, rotation: 0 },
        { item: mkCargo('ct1', 'cargo.coolant_tank'), x: 1, y: 0, rotation: 0 },
        { item: mkCargo('ct2', 'cargo.coolant_tank'), x: 0, y: 3, rotation: 1 }, // Legal 2nd adjacent coolant tank must NOT stack!
      ],
    };
    const st = calculateV2BuildStats(heavyCoolantBay);
    expect(st.heavies[0].baseDamage).toBe(16); // 12 common base + 4 coolant_tank (non-stacking across 2 tanks!)
    expect(st.links).toHaveLength(1);
    expect(st.links[0]).toMatchObject({
      sourceKind: 'cargo',
      targetKind: 'heavy',
      synergyId: 'coolant_heavy',
      label: '液冷+4',
    });

    // tacticalDelta for staging coolant_tank with heavy in bay computes real combat delta & recommendedSpot
    const heavyOnlyBay: V2CargoBayState = {
      ...createEmptyV2Bay('cannon_skiff'),
      placed: [{ item: mkEq('h1', 'heavy'), x: 0, y: 0, rotation: 0 }],
    };
    clearTacticalDeltaCache();
    const coolantDelta = computeV2PlacementTacticalDelta({
      run: null,
      bay: heavyOnlyBay,
      startingHp: 30,
      maxHp: 30,
      targetPolicy: 'weakest',
      item: mkCargo('ct_stage', 'cargo.coolant_tank', 'staging'),
      zone: 'staging',
    });
    expect(coolantDelta.recommendedSpot).toBeDefined();
    expect(coolantDelta.synergyLine).toContain('液冷+4');
    expect(getTacticalDeltaCacheStats().simulationCalls).toBeGreaterThan(0);

    // cargo.data_box remains strictly on 0-sim fast path with NO recommendedSpot
    clearTacticalDeltaCache();
    const dataBoxDelta = computeV2PlacementTacticalDelta({
      run: null,
      bay: heavyOnlyBay,
      startingHp: 30,
      maxHp: 30,
      targetPolicy: 'weakest',
      item: mkCargo('db_stage', 'cargo.data_box', 'staging'),
      zone: 'staging',
    });
    expect('recommendedSpot' in dataBoxDelta).toBe(false);
    expect(getTacticalDeltaCacheStats().simulationCalls).toBe(0);
  });

  it('G3 / D03 Quantitative Gate: NO single budget-6 common build exceeds 60% optimal share across classic V2 and V3 13-encounter matrices', () => {
    const builds: { readonly name: string; readonly hp: number; readonly bay: V2CargoBayState }[] = [
      {
        name: 'sandwich',
        hp: 30,
        bay: {
          ...createEmptyV2Bay('cannon_skiff'),
          placed: [
            { item: mkEq('l1', 'laser'), x: 0, y: 0, rotation: 0 },
            { item: mkEq('b1', 'battery'), x: 1, y: 0, rotation: 0 },
            { item: mkEq('l2', 'laser'), x: 2, y: 0, rotation: 0 },
          ],
        },
      },
      {
        name: 'heavy_cap_shield',
        hp: 30,
        bay: {
          ...createEmptyV2Bay('cannon_skiff'),
          placed: [
            { item: mkEq('h1', 'heavy'), x: 0, y: 0, rotation: 0 },
            { item: mkEq('c1', 'capacitor'), x: 1, y: 0, rotation: 0 },
            { item: mkEq('s1', 'shield'), x: 2, y: 0, rotation: 0 },
          ],
        },
      },
      {
        name: 'hangar_relay_shield',
        hp: 30,
        bay: {
          ...createEmptyV2Bay('cannon_skiff'),
          placed: [
            { item: mkEq('hg1', 'hangar'), x: 0, y: 0, rotation: 0 },
            { item: mkEq('rl1', 'relay'), x: 2, y: 0, rotation: 0 },
            { item: mkEq('s1', 'shield'), x: 2, y: 1, rotation: 0 },
          ],
        },
      },
      {
        name: 'shield_counter_laser',
        hp: 34,
        bay: {
          ...createEmptyV2Bay('shield_cruiser'),
          placed: [
            { item: mkEq('s1', 'shield'), x: 0, y: 0, rotation: 0 },
            { item: mkEq('ct1', 'counter'), x: 1, y: 0, rotation: 0 },
            { item: mkEq('l1', 'laser'), x: 2, y: 0, rotation: 0 },
          ],
        },
      },
      {
        name: 'salvo_cap_shield',
        hp: 30,
        bay: {
          ...createEmptyV2Bay('cannon_skiff'),
          placed: [
            { item: mkEq('sv1', 'salvo_pod'), x: 0, y: 0, rotation: 0 },
            { item: mkEq('c1', 'capacitor'), x: 2, y: 0, rotation: 0 },
            { item: mkEq('s1', 'shield'), x: 2, y: 1, rotation: 0 },
          ],
        },
      },
      {
        name: 'emp_laser_shield',
        hp: 30,
        bay: {
          ...createEmptyV2Bay('cannon_skiff'),
          placed: [
            { item: mkEq('em1', 'emp_jammer'), x: 0, y: 0, rotation: 0 },
            { item: mkEq('l1', 'laser'), x: 1, y: 0, rotation: 0 },
            { item: mkEq('s1', 'shield'), x: 2, y: 0, rotation: 0 },
          ],
        },
      },
      {
        name: 'flak_laser_bat',
        hp: 30,
        bay: {
          ...createEmptyV2Bay('cannon_skiff'),
          placed: [
            { item: mkEq('fl1', 'flak'), x: 0, y: 0, rotation: 0 },
            { item: mkEq('b1', 'battery'), x: 2, y: 1, rotation: 0 },
            { item: mkEq('l1', 'laser'), x: 3, y: 0, rotation: 0 },
          ],
        },
      },
    ];

    const checkMatrix = (encList: readonly { readonly kind: Parameters<typeof buildEncounterUnits>[0]; readonly layer: number }[]) => {
      const shares: Record<string, number> = {};
      for (const b of builds) shares[b.name] = 0;
      for (const e of encList) {
        const units = buildEncounterUnits(e.kind, e.layer, `d03_${e.kind}_${e.layer}`);
        const scored = builds.map((b) => {
          const s = simulateV2Combat({
            resultId: 'd03',
            bay: b.bay,
            startingHp: b.hp,
            maxHp: b.hp,
            units,
            targetPolicy: 'weakest',
            encounterKind: e.kind,
          });
          const hpLost = b.hp - s.finalPlayerHpAfterRepair;
          return { name: b.name, score: (s.outcome === 'victory' ? 10_000 : 0) - hpLost * 100 - s.roundsCount * 5 };
        });
        scored.sort((a, b) => b.score - a.score);
        const winners = scored.filter((x) => x.score === scored[0].score);
        for (const w of winners) shares[w.name] += 1 / winners.length;
      }
      const maxShare = Math.max(...Object.values(shares)) / encList.length;
      expect(maxShare).toBeLessThanOrEqual(0.6);
      expect(shares.sandwich / encList.length).toBeLessThanOrEqual(0.15);
    };

    // Classic V2 13-encounter matrix
    checkMatrix([
      { kind: 'patrol', layer: 1 },
      { kind: 'swarm', layer: 1 },
      { kind: 'armored', layer: 1 },
      { kind: 'piercer', layer: 1 },
      { kind: 'patrol', layer: 3 },
      { kind: 'swarm', layer: 3 },
      { kind: 'armored', layer: 3 },
      { kind: 'piercer', layer: 3 },
      { kind: 'patrol', layer: 5 },
      { kind: 'swarm', layer: 5 },
      { kind: 'armored', layer: 5 },
      { kind: 'piercer', layer: 5 },
      { kind: 'elite', layer: 6 },
    ]);

    // V3 full 13-encounter matrix
    checkMatrix([
      { kind: 'patrol', layer: 1 },
      { kind: 'swarm', layer: 2 },
      { kind: 'armored', layer: 2 },
      { kind: 'piercer', layer: 3 },
      { kind: 'artillery', layer: 3 },
      { kind: 'shield_regen', layer: 3 },
      { kind: 'drone_carrier', layer: 4 },
      { kind: 'emp_disruptor', layer: 4 },
      { kind: 'rammer', layer: 4 },
      { kind: 'swarm', layer: 5 },
      { kind: 'armored', layer: 5 },
      { kind: 'piercer', layer: 5 },
      { kind: 'elite', layer: 6 },
    ]);
  });

  it('preserves Tutorial Step 1 (2R/26HP wired vs 3R/24HP unwired) and L4B fork threat tiers', () => {
    const tutRun = createV2TutorialRun('tut_d03_check');
    const batId = tutRun.bay.staging[0].item.instanceId;
    const wiredBay = placeV2FromStaging(tutRun.bay, batId, 1, 0, 0).bay;
    const unwiredBay = placeV2FromStaging(tutRun.bay, batId, 3, 3, 0).bay;

    const l1Units = tutRun.graph.nodes['L1A'].combat!.units;
    const simWired = simulateV2Combat({
      resultId: 'tut_w',
      bay: wiredBay,
      startingHp: 30,
      maxHp: 30,
      units: l1Units,
      targetPolicy: 'weakest',
      encounterKind: 'patrol_tutorial',
    });
    const simUnwired = simulateV2Combat({
      resultId: 'tut_u',
      bay: unwiredBay,
      startingHp: 30,
      maxHp: 30,
      units: l1Units,
      targetPolicy: 'weakest',
      encounterKind: 'patrol_tutorial',
    });
    expect(simWired.roundsCount).toBe(2);
    expect(simWired.finalPlayerHpAfterRepair).toBe(26);
    expect(simUnwired.roundsCount).toBe(3);
    expect(simUnwired.finalPlayerHpAfterRepair).toBe(24);

    // L4B Raider fork: wired is steady ('稳'), dropped laser is danger/lethal
    const l4bUnits = tutRun.graph.nodes['L4B'].combat!.units;
    const simL4Wired = simulateV2Combat({
      resultId: 'tut_l4_w',
      bay: wiredBay,
      startingHp: 26,
      maxHp: 30,
      units: l4bUnits,
      targetPolicy: 'weakest',
      encounterKind: 'tutorial_raider',
    });
    expect(
      classifyV2CombatThreat({ outcome: simL4Wired.outcome, playerFinalHp: simL4Wired.finalPlayerHpAfterRepair }, 30)
        .tier
    ).toBe('steady');

    const droppedLaserBay: V2CargoBayState = {
      ...wiredBay,
      placed: wiredBay.placed.filter((p) => p.item.definitionId !== 'equipment.laser.common'),
    };
    const simL4Drop = simulateV2Combat({
      resultId: 'tut_l4_d',
      bay: droppedLaserBay,
      startingHp: 26,
      maxHp: 30,
      units: l4bUnits,
      targetPolicy: 'weakest',
      encounterKind: 'tutorial_raider',
    });
    const dropTier = classifyV2CombatThreat(
      { outcome: simL4Drop.outcome, playerFinalHp: simL4Drop.finalPlayerHpAfterRepair },
      30
    ).tier;
    expect(['danger', 'lethal']).toContain(dropTier);
  });

  it('renders active vs capped battery links in CargoGridV2 (data-battery-capped, .energy-link-capped, ✕ 上限) and Synergy Codex section with all 48 item cards', () => {
    const sandwichBay: V2CargoBayState = {
      ...createEmptyV2Bay('cannon_skiff'),
      placed: [
        { item: mkEq('l1', 'laser'), x: 0, y: 0, rotation: 0 },
        { item: mkEq('b1', 'battery', 'common'), x: 1, y: 0, rotation: 0 },
        { item: mkEq('l2', 'laser'), x: 2, y: 0, rotation: 0 },
      ],
    };
    const root = document.createElement('div');
    const grid = new CargoGridV2Component(root, { onBayChange: () => {} });
    grid.render(sandwichBay, true);

    expect(root.querySelectorAll('[data-testid="cargo-compact-stats"] .v3-stat-cell').length).toBe(4);
    expect(root.querySelectorAll('[data-link-status="active"]').length).toBeGreaterThanOrEqual(1);
    expect(root.querySelectorAll('.energy-link-capped[data-link-status="capped"]').length).toBe(1);
    expect(root.textContent).toContain('✕ 上限');
    expect(root.querySelectorAll('[data-battery-capped="true"]').length).toBe(1);
    grid.destroy();

    // Codex modal preserves all 48 item cards AND renders codex-synergy-section with discovered vs locked states
    const profile = recordV2DiscoveredSynergies(createFreshV2Profile(), ['battery_laser', 'coolant_heavy']);
    expect(profile.discoveredSynergies).toEqual(['battery_laser', 'coolant_heavy']);
    expect(detectNewlyActivatedSynergies(calculateV2BuildStats(sandwichBay), profile.discoveredSynergies)).toHaveLength(0);

    const modalHost = document.createElement('div');
    openV2CodexModal(modalHost, profile);
    expect(modalHost.querySelectorAll('[data-def-id]').length).toBe(48);
    const synSec = modalHost.querySelector('[data-testid="codex-synergy-section"]')!;
    expect(synSec).not.toBeNull();
    expect(synSec.querySelectorAll('[data-synergy-id]').length).toBe(V2_SYNERGY_ORDER.length);
    expect(synSec.querySelector('[data-synergy-id="coolant_heavy"]')?.getAttribute('data-synergy-state')).toBe(
      'discovered'
    );
    expect(synSec.querySelector('[data-synergy-id="capacitor_heavy"]')?.getAttribute('data-synergy-state')).toBe(
      'locked'
    );
    modalHost.querySelector<HTMLButtonElement>('.modal-close-btn, [data-action="close-modal"]')?.click();
  });

  it('triggers non-blocking "新联动！" toast ONCE on player-initiated bay edit via V2AppController and never re-toasts on repeat/reload', () => {
    window.localStorage.clear();
    window.sessionStorage.setItem('starline_v2_title_entered', '1');

    // Seed an active ARRANGE run with laser at (0,0) and battery in staging (0 prior discoveredSynergies!)
    const baseSave = createFreshV2SaveData();
    const tutRun = createV2TutorialRun('tut_syn_toast');
    const seededSave: V2SaveData = {
      ...baseSave,
      profile: {
        ...baseSave.profile,
        tutorialCompleted: true,
        discoveredSynergies: [],
      },
      activeRun: tutRun,
    };
    persistV2SaveData(window.localStorage, seededSave);

    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const ctrl = new V2AppController(mount, { onSwitchToV1: () => {} });
    ctrl.init();

    // No toast on initial boot before player places battery!
    expect(mount.querySelector('[data-testid="synergy-discovery-toast"]')).toBeNull();

    // Select staged battery chip, then place at free cell (1,0) adjacent to tutorial laser at (0,0)-(0,1)!
    const stagingChip = mount.querySelector<HTMLButtonElement>('[data-staging-id]')!;
    expect(stagingChip).not.toBeNull();
    stagingChip.click();

    // Board bounding rect is 256x256 for 4x4 grid (64px/cell) -> cell (1,0) center is (96, 32).
    const boardEl = mount.querySelector<HTMLElement>('.v2-cargo-board')!;
    expect(boardEl).not.toBeNull();
    boardEl.dispatchEvent(
      new MiniEvent('pointerdown', {
        bubbles: true,
        button: 0,
        pointerType: 'mouse',
        clientX: 96,
        clientY: 32,
      }) as unknown as Event
    );

    const toast = mount.querySelector('[data-testid="synergy-discovery-toast"]');
    expect(toast).not.toBeNull();
    expect(toast!.textContent).toContain('新联动！');
    expect(toast!.getAttribute('data-synergy-ids')).toBe('battery_laser');

    // Persisted immediately to localStorage
    const reloaded = loadV2SaveData(window.localStorage);
    expect(reloaded.status).toBe('loaded');
    if (reloaded.status !== 'loaded') throw new Error('expected loaded');
    expect(reloaded.data.profile.discoveredSynergies).toContain('battery_laser');

    // Dismiss toast, reload fresh controller -> MUST NOT re-toast!
    mount.querySelector<HTMLButtonElement>('#v3-synergy-toast-dismiss')?.click();
    expect(mount.querySelector('[data-testid="synergy-discovery-toast"]')).toBeNull();
    ctrl.destroy();

    const ctrl2 = new V2AppController(mount, { onSwitchToV1: () => {} });
    ctrl2.init();
    expect(mount.querySelector('[data-testid="synergy-discovery-toast"]')).toBeNull();
    ctrl2.destroy();
    mount.remove();
  });
});

// ===========================================================================
// 4. Contract #9 — Rules '3.1.0' & Non-Destructive '3.0.0' -> '3.1.0' Migration
// ===========================================================================

describe('R2-M6A Contract #9: Rules 3.1.0, Non-Destructive 3.0.0->3.1.0 Migration & ActiveCombat Rewind', () => {
  it('upgrades 3.0.0 save (including in-flight activeCombat) to 3.1.0 with write-once backup, stripped claims, and V1 isolation', () => {
    expect(V2_SCHEMA_VERSION).toBe(3);
    expect(V2_RULES_VERSION).toBe('3.1.0');
    expect(V3_0_RULES_VERSION).toBe('3.0.0');
    expect(V3_0_BACKUP_KEY).toBe('starline_save_backup_v3_0');

    const storage = createMemStorage();
    // Seed unrelated V1 save to prove 100% isolation
    const v1Sentinel = '{"schemaVersion":1,"credits":999}';
    storage.setItem('starline_save_v1', v1Sentinel);

    const bay: V2CargoBayState = {
      ...createEmptyV2Bay('cannon_skiff'),
      placed: [
        { item: mkEq('h1', 'heavy'), x: 0, y: 0, rotation: 0 },
        { item: mkEq('s1', 'shield'), x: 2, y: 0, rotation: 0 },
      ],
    };
    const combatRun = startV2CombatAtCurrentNode(
      {
        ...buildRunAtEncounter(bay, 'armored', 3, 25, 30),
        wallet: 77,
        fuel: 6,
        salvagePartsEarned: 4,
        overchargeCellActive: true,
        claimedEventIds: ['non_combat_claim_1'],
      },
      'weakest',
      { enableTacticalCommands: true }
    ).run;
    const decId = combatRun.activeCombat!.pendingDecision!.decisionId;
    const midCombatRun = commitV2EliteTacticDecision(combatRun, decId, 'overload').run;

    // Craft authentic 3.0.0 save snapshot (no discoveredSynergies, rulesVersion: '3.0.0')
    const baseProfile = createFreshV2Profile();
    const { discoveredSynergies: _omit, ...v3_0Profile } = baseProfile;
    const v3_0Save = {
      schemaVersion: 3,
      rulesVersion: '3.0.0',
      savedAt: '2026-04-01T00:00:00.000Z',
      profile: {
        ...v3_0Profile,
        credits: 450,
        salvageParts: 18,
      },
      activeRun: {
        ...midCombatRun,
        rulesVersion: '3.0.0',
        hp: 12, // Mid-combat damaged HP before rewind
      },
      settings: { ...DEFAULT_SETTINGS },
    };
    const v3_0Raw = JSON.stringify(v3_0Save);
    storage.setItem(V2_SAVE_KEY, v3_0Raw);

    // 1) Direct migrate helper & loadV2SaveData upgrade cleanly
    const directMig = migrateV3_0ToV3_1SaveData(v3_0Save);
    expect(directMig.ok).toBe(true);
    expect(directMig.data!.rulesVersion).toBe('3.1.0');

    const loaded = loadV2SaveData(storage);
    expect(loaded.status).toBe('loaded');
    if (loaded.status !== 'loaded') throw new Error('expected loaded');
    expect(loaded.migratedFromV3_0).toBe(true);
    expect(loaded.data.rulesVersion).toBe('3.1.0');
    expect(loaded.data.profile.credits).toBe(450);
    expect(loaded.data.profile.salvageParts).toBe(18);
    expect(loaded.data.profile.discoveredSynergies).toEqual([]);

    // Active combat rewound safely to pre-combat at exact same node with resources intact & aborted combat claims stripped!
    const rewoundRun = loaded.data.activeRun!;
    expect(rewoundRun.rulesVersion).toBe('3.1.0');
    expect(rewoundRun.phase).toBe('ENCOUNTER');
    expect(rewoundRun.currentNodeId).toBe(midCombatRun.currentNodeId);
    expect(rewoundRun.activeCombat).toBeNull();
    expect(rewoundRun.lockedEnemyId).toBeNull();
    expect(rewoundRun.hp).toBe(25); // Restored to activeCombat.startingHp
    expect(rewoundRun.tacticalChargesUsed).toBe(0);
    expect(rewoundRun.wallet).toBe(77);
    expect(rewoundRun.fuel).toBe(6);
    expect(rewoundRun.salvagePartsEarned).toBe(4);
    expect(rewoundRun.overchargeCellActive).toBe(true);
    expect(rewoundRun.claimedEventIds).toEqual(['non_combat_claim_1']);

    // Write-once backup captured exact pre-migration 3.0.0 JSON
    expect(storage.getItem(V3_0_BACKUP_KEY)).toBe(v3_0Raw);

    // Subsequent 3.1.0 persist rotates into V3_BACKUP_KEY without ever overwriting V3_0_BACKUP_KEY!
    expect(persistV2SaveData(storage, loaded.data).ok).toBe(true);
    expect(storage.getItem(V3_0_BACKUP_KEY)).toBe(v3_0Raw);

    const updated31: V2SaveData = {
      ...loaded.data,
      profile: { ...loaded.data.profile, credits: 500 },
    };
    expect(persistV2SaveData(storage, updated31).ok).toBe(true);
    expect(storage.getItem(V3_0_BACKUP_KEY)).toBe(v3_0Raw);
    expect(storage.getItem(V3_BACKUP_KEY)).not.toBeNull();

    // Corrupt primary & missing V3_BACKUP_KEY falls back to V3_0_BACKUP_KEY and migrates seamlessly!
    storage.removeItem(V3_BACKUP_KEY);
    storage.setItem(V2_SAVE_KEY, '{corrupt json');
    const recovered = loadV2SaveData(storage);
    expect(recovered.status).toBe('corrupt_with_backup');
    if (recovered.status !== 'corrupt_with_backup') throw new Error('expected backup');
    expect(recovered.backup.rulesVersion).toBe('3.1.0');
    expect(recovered.backup.profile.credits).toBe(450);

    // clearV2SaveData clears V2/V3/V3_0 keys while preserving starline_save_v1 untouched!
    clearV2SaveData(storage);
    expect(storage.getItem(V2_SAVE_KEY)).toBeNull();
    expect(storage.getItem(V3_0_BACKUP_KEY)).toBeNull();
    expect(storage.getItem('starline_save_v1')).toBe(v1Sentinel);
  });

  it('clears lockedEnemyId across selectV2MapNode node transitions', () => {
    const tutRun = createV2TutorialRun('tut_clear_lock');
    const batId = tutRun.bay.staging[0].item.instanceId;
    const mapRun: V2RunState = {
      ...tutRun,
      phase: 'MAP',
      bay: placeV2FromStaging(tutRun.bay, batId, 1, 0, 0).bay,
      lockedEnemyId: 'stale_enemy_id',
    };
    const jumped = selectV2MapNode(mapRun, 'L1A');
    expect(jumped.ok).toBe(true);
    expect(jumped.run.lockedEnemyId).toBeNull();
  });

  it('rejects malformed interventions arrays during persistence validation', () => {
    const storage = createMemStorage();
    const bay: V2CargoBayState = {
      ...createEmptyV2Bay('cannon_skiff'),
      placed: [{ item: mkEq('l1', 'laser'), x: 0, y: 0, rotation: 0 }],
    };
    const started = startV2CombatAtCurrentNode(
      buildRunAtEncounter(bay, 'armored', 2, 30, 30),
      'weakest',
      { enableTacticalCommands: true }
    ).run;
    const badSave: V2SaveData = {
      ...createFreshV2SaveData(),
      activeRun: {
        ...started,
        activeCombat: {
          ...started.activeCombat!,
          interventions: [
            {
              interventionId: 'bad',
              roundNumber: 0, // Invalid round < 1!
              kind: 'overload_module',
              moduleInstanceId: 'l1',
            } as V2CombatIntervention,
          ],
        },
      },
    };
    expect(persistV2SaveData(storage, badSave).ok).toBe(false);
  });

  it('auto-persists migrated 3.0.0 -> 3.1.0 save on V2AppController boot while preserving write-once starline_save_backup_v3_0', () => {
    window.localStorage.clear();
    window.sessionStorage.setItem('starline_v2_title_entered', '1');
    const baseProfile = createFreshV2Profile();
    const { discoveredSynergies: _omit, ...v3_0Profile } = baseProfile;
    const v3_0Raw = JSON.stringify({
      schemaVersion: 3,
      rulesVersion: '3.0.0',
      savedAt: '2026-04-01T00:00:00.000Z',
      profile: { ...v3_0Profile, credits: 320, tutorialCompleted: true },
      activeRun: null,
      settings: { ...DEFAULT_SETTINGS },
    });
    window.localStorage.setItem(V2_SAVE_KEY, v3_0Raw);

    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const ctrl = new V2AppController(mount, { onSwitchToV1: () => {} });
    ctrl.init();

    // Primary save is auto-persisted as 3.1.0 on boot AND write-once 3.0.0 backup stays intact!
    const storedAfterBoot = JSON.parse(window.localStorage.getItem(V2_SAVE_KEY)!) as V2SaveData;
    expect(storedAfterBoot.rulesVersion).toBe('3.1.0');
    expect(storedAfterBoot.profile.credits).toBe(320);
    expect(storedAfterBoot.profile.discoveredSynergies).toEqual([]);
    expect(window.localStorage.getItem(V3_0_BACKUP_KEY)).toBe(v3_0Raw);

    ctrl.destroy();
    mount.remove();
  });
});

// ===========================================================================
// 5. Iteration-2 Regressions (Fixes 1–8)
// ===========================================================================

function captureSfxCalls(fn: (played: SfxKind[]) => void): SfxKind[] {
  const played: SfxKind[] = [];
  const origPlay = soundEngine.play.bind(soundEngine);
  soundEngine.play = ((kind: SfxKind) => {
    played.push(kind);
    return origPlay(kind);
  }) as typeof soundEngine.play;
  try {
    fn(played);
  } finally {
    soundEngine.play = origPlay;
  }
  return played;
}

describe('R2-M6A Iteration-2 Regressions: Causality, Handler Clearing, D03 Discovery SFX & Polish', () => {
  beforeEach(() => {
    phaserHarness.reset();
    clearTacticalDeltaCache();
  });

  it('Fix 1: Boss inter-pause live target lock applies at Round 3, allows locking living escorts, and recomputes/clears future pendingDecision without completion deadlock', () => {
    const bossBay: V2CargoBayState = {
      ...createEmptyV2Bay('heavy_freighter'),
      placed: [
        { item: mkEq('l1', 'laser'), x: 0, y: 0, rotation: 0 },
        { item: mkEq('b1', 'battery', 'common'), x: 1, y: 0, rotation: 0 },
        { item: mkEq('s1', 'shield', 'improved'), x: 2, y: 0, rotation: 0 },
      ],
    };
    const bossRun = buildRunAtEncounter(bossBay, 'boss_dreadnought', 6, 38, 38);
    const started = startV2CombatAtCurrentNode(bossRun, 'weakest', {
      enableTacticalCommands: true,
    });
    expect(started.ok).toBe(true);
    expect(started.run.tacticalChargesMax).toBe(2);
    const pause1 = started.run.activeCombat!.pendingDecision!;
    expect(pause1.roundNumber).toBe(2);

    // Commit Charge 1 (shield overload at R2) -> chains open pendingDecision to future Pause #2 (> R3) with pausedAtDecisionId: null
    const afterC1 = commitV2ModuleOverload(started.run, pause1.decisionId, 's1');
    expect(afterC1.ok).toBe(true);
    const futurePending = afterC1.run.activeCombat!.pendingDecision!;
    expect(futurePending).not.toBeNull();
    expect(futurePending.chosen).toBeNull();
    expect(futurePending.roundNumber).toBeGreaterThan(3);
    expect(afterC1.run.activeCombat!.pausedAtDecisionId).toBeNull();

    // At end of Round 2 (currentRound = 2), both Boss Core and Escort 2 are ALIVE
    const r2Enemies = afterC1.run.activeCombat!.simulation.rounds[1].enemiesAfter;
    const bossCore = r2Enemies.find((e) => e.isBoss && e.hp > 0)!;
    const livingEscort = r2Enemies.find((e) => !e.isBoss && e.hp > 0)!;
    expect(bossCore).toBeDefined();
    expect(livingEscort).toBeDefined();

    // Sub-case A: Locking Boss Core during Round 2 MUST apply on Round 3 (NOT jump to futurePending.roundNumber!)
    const lockBoss = setV2LiveCombatLockedEnemy(afterC1.run, bossCore.enemyId, 2);
    expect(lockBoss.ok).toBe(true);
    expect(lockBoss.run.lockedEnemyId).toBe(bossCore.enemyId);
    const lockIvBoss = lockBoss.run.activeCombat!.interventions!.find(
      (iv) => iv.kind === 'target_lock'
    )!;
    expect(lockIvBoss.roundNumber).toBe(3);
    expect(lockBoss.run.activeCombat!.simulation.rounds[2].lockedEnemyIdUsed).toBe(
      bossCore.enemyId
    );
    expect(lockBoss.run.activeCombat!.simulation.rounds[0]).toEqual(
      afterC1.run.activeCombat!.simulation.rounds[0]
    );
    expect(lockBoss.run.activeCombat!.simulation.rounds[1]).toEqual(
      afterC1.run.activeCombat!.simulation.rounds[1]
    );
    // Future Pause #2 round must stay strictly valid within nextSimulation bounds
    const recomputedPending = lockBoss.run.activeCombat!.pendingDecision;
    expect(recomputedPending).not.toBeNull();
    expect(recomputedPending!.roundNumber).toBeLessThanOrEqual(
      lockBoss.run.activeCombat!.simulation.rounds.length
    );

    // Sub-case B: Locking living escort at Round 2 MUST succeed (never falsely rejected by far-future round snapshot!)
    const lockEscort = setV2LiveCombatLockedEnemy(afterC1.run, livingEscort.enemyId, 2);
    expect(lockEscort.ok).toBe(true);
    expect(lockEscort.run.activeCombat!.simulation.rounds[2].lockedEnemyIdUsed).toBe(
      livingEscort.enemyId
    );

    // Sub-case C: Inter-pause retarget that ends combat BEFORE pre-scheduled Pause #2 MUST clear pendingDecision so completeV2CombatAtCurrentNode never deadlocks!
    // Exact overkill-avoidance scenario:
    // - Player has heavy+capacitor (18 dmg R1/R3), salvo_pod+relay (5x2=10 dynamic retargeting missiles/R), core (2 dmg/R), shield.
    // - Boss Dreadnought (42 HP, 4 initial shield -> enters P2 on R1 with +6 shield -> 10 HP at end of R2) + Escort (20 HP).
    // - Staying locked on Boss on R3 wastes 10 heavy overkill, leaving Escort at 10 HP -> 4 rounds (Pause #2 pre-scheduled at Round 4!).
    // - Retargeting onto Escort during R2 (applyRound = 3) exact-kills Escort (2+18=20) and redirects salvo(10) onto Boss (10 HP) -> Victory in 3 rounds, clearing Pause #2!
    const highDpsBay: V2CargoBayState = {
      ...createEmptyV2Bay('heavy_freighter'),
      placed: [
        { item: mkEq('h1', 'heavy', 'improved'), x: 0, y: 0, rotation: 0 },
        { item: mkEq('c1', 'capacitor', 'improved'), x: 1, y: 0, rotation: 0 },
        { item: mkEq('sv1', 'salvo_pod', 'improved'), x: 2, y: 0, rotation: 0 },
        { item: mkEq('rl1', 'relay', 'common'), x: 3, y: 0, rotation: 0 },
        { item: mkEq('s1', 'shield', 'improved'), x: 4, y: 0, rotation: 0 },
      ],
    };
    const fastBossBase = buildRunAtEncounter(highDpsBay, 'boss_dreadnought', 6, 38, 38);
    const fastNode = fastBossBase.graph.nodes[fastBossBase.currentNodeId!]!;
    const tunedUnits = [
      { ...fastNode.combat!.units[0], maxHp: 42, armor: 0 },
      { ...fastNode.combat!.units[1], maxHp: 20, armor: 0 },
    ];
    const shortRun: V2RunState = {
      ...fastBossBase,
      hp: 38,
      maxHp: 38,
      lockedEnemyId: tunedUnits[0].enemyId,
      graph: {
        ...fastBossBase.graph,
        nodes: {
          ...fastBossBase.graph.nodes,
          [fastNode.nodeId]: {
            ...fastNode,
            combat: { ...fastNode.combat!, units: tunedUnits },
          },
        },
      },
    };
    const shortStarted = startV2CombatAtCurrentNode(shortRun, 'weakest', {
      enableTacticalCommands: true,
    });
    expect(shortStarted.ok).toBe(true);
    const shortC1 = commitV2ModuleOverload(
      shortStarted.run,
      shortStarted.run.activeCombat!.pendingDecision!.decisionId,
      's1'
    );
    expect(shortC1.ok).toBe(true);
    expect(shortC1.run.activeCombat!.pendingDecision).not.toBeNull();
    expect(shortC1.run.activeCombat!.pendingDecision!.roundNumber).toBe(4);
    expect(shortC1.run.activeCombat!.simulation.rounds.length).toBe(4);

    // Retarget to Escort during Round 2 (applyRound = 3) -> combat now finishes in 3 rounds (< 4)!
    // Instead of keeping stale unreachable Round-4 pendingDecision (which would deadlock completion!),
    // Fix 1 recomputes Pause #2 via findNextPauseRoundAfterCommit to valid Round 3 (before Round 3 executes).
    const retargetShort = setV2LiveCombatLockedEnemy(shortC1.run, tunedUnits[1].enemyId, 2);
    expect(retargetShort.ok).toBe(true);
    expect(retargetShort.run.activeCombat!.simulation.outcome).toBe('victory');
    expect(retargetShort.run.activeCombat!.simulation.rounds.length).toBe(3);
    const movedPause = retargetShort.run.activeCombat!.pendingDecision!;
    expect(movedPause).not.toBeNull();
    expect(movedPause.roundNumber).toBe(3);
    expect(movedPause.roundNumber).toBeLessThanOrEqual(
      retargetShort.run.activeCombat!.simulation.rounds.length
    );

    // Committing Charge 2 at the recomputed Round-3 pause settles cleanly with ZERO deadlock!
    const committedR3 = commitV2EliteTacticDecision(
      retargetShort.run,
      movedPause.decisionId,
      'focus_calibrate'
    );
    expect(committedR3.ok).toBe(true);
    const settled = completeV2CombatAtCurrentNode(committedR3.run, ['core']);
    expect(settled.ok).toBe(true);
    expect(settled.run.activeCombat).toBeNull();

    // Also verify: if an open pendingDecision targets a round beyond nextSimulation.rounds.length (rebuilt === null),
    // setV2LiveCombatLockedEnemy explicitly clears pendingDecision to null so completion NEVER deadlocks!
    const unreachablePendingRun: V2RunState = {
      ...retargetShort.run,
      activeCombat: {
        ...retargetShort.run.activeCombat!,
        pendingDecision: {
          ...movedPause,
          decisionId: `${movedPause.decisionId}_stale5`,
          roundNumber: 5,
        },
        pausedAtDecisionId: null,
      },
    };
    const clearedUnreachable = setV2LiveCombatLockedEnemy(
      unreachablePendingRun,
      null,
      4
    );
    expect(clearedUnreachable.ok).toBe(true);
    expect(clearedUnreachable.run.activeCombat!.pendingDecision).toBeNull();
    expect(clearedUnreachable.run.activeCombat!.pausedAtDecisionId).toBeNull();
    expect(completeV2CombatAtCurrentNode(clearedUnreachable.run, ['core']).ok).toBe(true);
  });

  it('Fix 2: In-flight Round 2+ live lock click respects V2CombatScene.getCurrentDispatchedRound() and never retroactively mutates an animating round', () => {
    window.localStorage.clear();
    window.sessionStorage.setItem('starline_v2_title_entered', '1');

    const bay: V2CargoBayState = {
      ...createEmptyV2Bay('cannon_skiff'),
      placed: [
        { item: mkEq('l1', 'laser'), x: 0, y: 0, rotation: 0 },
        { item: mkEq('s1', 'shield'), x: 1, y: 0, rotation: 0 },
      ],
    };
    const baseRun = buildRunAtEncounter(bay, 'artillery', 4, 30, 30);
    const units = baseRun.graph.nodes[baseRun.currentNodeId!]!.combat!.units;
    const artilleryId = units[0].enemyId;
    const escortId = units[1].enemyId;
    const started = startV2CombatAtCurrentNode(
      { ...baseRun, lockedEnemyId: artilleryId },
      'weakest',
      { enableTacticalCommands: false }
    ).run;

    const baseSave = createFreshV2SaveData();
    persistV2SaveData(window.localStorage, {
      ...baseSave,
      profile: { ...baseSave.profile, tutorialCompleted: true },
      settings: { ...DEFAULT_SETTINGS, pureAutoCombat: true },
      activeRun: started,
    });

    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const ctrl = new V2AppController(mount, { onSwitchToV1: () => {} });
    ctrl.init();
    phaserHarness.lastGame!.events.emit('ready');

    const scene = phaserHarness.lastV2CombatScene as unknown as V2CombatScene;
    expect(scene).not.toBeNull();

    // Step Round 1 synchronously (no scene.time yet -> Round 1 beats execute immediately & onRoundStep sets liveCombatRound = 1)
    scene.update(100, 400);
    expect(scene.getCurrentDispatchedRound()).toBe(1);

    // Now attach a mock Phaser timer queue to hold Round 2's beats IN FLIGHT (0..590ms before resolve beat!)
    const queuedBeats: Array<{ readonly delayMs: number; readonly cb: () => void; removed: boolean }> = [];
    (scene as unknown as {
      time: {
        paused: boolean;
        delayedCall: (delayMs: number, cb: () => void) => { remove: () => void };
      };
    }).time = {
      paused: false,
      delayedCall: (delayMs: number, cb: () => void) => {
        const entry = { delayMs, cb, removed: false };
        queuedBeats.push(entry);
        return {
          remove: () => {
            entry.removed = true;
          },
        };
      },
    };

    // Advance enough delta to dispatch Round 2 (`nextRoundIdx` becomes 2), while Round 2 resolve beat has NOT fired yet!
    scene.update(1100, 500);
    scene.update(1600, 500);
    expect(scene.getCurrentDispatchedRound()).toBe(2);
    expect(queuedBeats.length).toBeGreaterThan(0);

    const beforeSave = loadV2SaveData(window.localStorage);
    expect(beforeSave.status).toBe('loaded');
    if (beforeSave.status !== 'loaded') throw new Error('expected loaded');
    const round2Before = beforeSave.data.activeRun!.activeCombat!.simulation.rounds[1];
    expect(round2Before.lockedEnemyIdUsed).toBe(artilleryId);

    // Click live lock button for escort while Round 2 is STILL animating in-flight!
    const lockBtn = mount.querySelector<HTMLButtonElement>(`[data-testid="enemy-lock-${escortId}"]`);
    expect(lockBtn).not.toBeNull();
    lockBtn!.click();

    const afterSave = loadV2SaveData(window.localStorage);
    expect(afterSave.status).toBe('loaded');
    if (afterSave.status !== 'loaded') throw new Error('expected loaded');
    const acAfter = afterSave.data.activeRun!.activeCombat!;
    // Round 2 MUST remain bit-for-bit identical (NEVER retroactively mutated while animating!)
    expect(acAfter.simulation.rounds[1]).toEqual(round2Before);
    // New lock intervention MUST be scheduled for Round 3 (>= dispatchedRound + 1)
    const lockIv = acAfter.interventions!.find((iv) => iv.kind === 'target_lock')!;
    expect(lockIv.roundNumber).toBe(3);
    expect(acAfter.simulation.rounds[2].lockedEnemyIdUsed).toBe(escortId);

    ctrl.destroy();
    mount.remove();
  });

  it('Fix 3: Clears stale onEnemyLockHandler/onModuleOverloadHandler across multi->single transitions, syncs same-key lockedEnemyId: null, and blocks single-enemy Pre-Combat lock', () => {
    const multiUnits = buildEncounterUnits('artillery', 3, 'fix3_multi');
    const singleUnits = buildEncounterUnits('patrol', 1, 'fix3_single');
    const bay: V2CargoBayState = {
      ...createEmptyV2Bay('cannon_skiff'),
      placed: [{ item: mkEq('h1', 'heavy'), x: 0, y: 0, rotation: 0 }],
    };

    // 1) Domain guard: setV2PreCombatLockedEnemy rejects non-null lock on 1-enemy node, but still allows clearing stale lock to null
    const singleRun = buildRunAtEncounter(bay, 'patrol', 1, 30, 30);
    const loneId = singleRun.graph.nodes[singleRun.currentNodeId!]!.combat!.units[0].enemyId;
    expect(setV2PreCombatLockedEnemy(singleRun, loneId).ok).toBe(false);
    const clearedSingle = setV2PreCombatLockedEnemy({ ...singleRun, lockedEnemyId: loneId }, null);
    expect(clearedSingle.ok).toBe(true);
    expect(clearedSingle.run.lockedEnemyId).toBeNull();

    // 2) V2CombatScene same-key lockedEnemyId: null + callback clearing + multi->single transition
    const scene = new V2CombatScene();
    const game = new MockPhaserGame({
      scene: [scene as unknown as InstanceType<typeof MockPhaserScene>],
    });
    const lockClicks: string[] = [];
    const ovClicks: string[] = [];
    const pbMulti: V2StagePlayback = {
      playbackKey: 'pre_multi',
      shipId: 'cannon_skiff',
      shipVisualSpec: deriveV2ShipVisualSpec(bay),
      sectorId: 'near_orbit',
      sectorIndex: 1,
      eventBackdrop: null,
      units: multiUnits,
      simulation: null,
      settings: { ...DEFAULT_SETTINGS },
      lockedEnemyId: multiUnits[0].enemyId,
      canOverloadModules: true,
      overloadableModules: [{ instanceId: 'h1', kind: 'heavy', label: '重炮' }],
      onEnemyLock: (eid) => lockClicks.push(eid),
      onModuleOverload: (mid) => ovClicks.push(mid),
    };
    game.scene.start('V2CombatScene', { playback: pbMulti });
    expect(scene.getStagePresentationSnapshot().lockedEnemyId).toBe(multiUnits[0].enemyId);

    // Same-key setPlayback with lockedEnemyId: null + undefined callbacks + canOverloadModules: false
    scene.setPlayback({
      ...pbMulti,
      lockedEnemyId: null,
      canOverloadModules: false,
      overloadableModules: [],
      onEnemyLock: undefined,
      onModuleOverload: undefined,
    });
    expect(scene.getStagePresentationSnapshot().lockedEnemyId).toBeNull();
    expect(scene.getStagePresentationSnapshot().canOverloadModules).toBe(false);
    expect((scene as unknown as { playback?: V2StagePlayback }).playback?.lockedEnemyId).toBeNull();
    // Clicking enemy sprite MUST NOT invoke cleared handler!
    const multiEnemySprite = phaserHarness.createdDisplayObjects.find(
      (obj) => obj.textureKey.startsWith('ship.enemy.') && obj.scene !== null
    )!;
    multiEnemySprite.emit('pointerdown', { event: { target: game.canvas } });
    expect(lockClicks).toEqual([]);

    // Re-bind handler on multi-enemy stage, verify click fires, then transition to single-enemy stage with onEnemyLock: undefined
    scene.setInteractionCallbacks({ onEnemyLock: (eid) => lockClicks.push(eid) });
    multiEnemySprite.emit('pointerdown', { event: { target: game.canvas } });
    expect(lockClicks).toEqual([multiUnits[0].enemyId]);

    scene.setPlayback({
      playbackKey: 'pre_single',
      shipId: 'cannon_skiff',
      shipVisualSpec: deriveV2ShipVisualSpec(bay),
      sectorId: 'near_orbit',
      sectorIndex: 1,
      eventBackdrop: null,
      units: singleUnits,
      simulation: null,
      settings: { ...DEFAULT_SETTINGS },
      lockedEnemyId: null,
      onEnemyLock: undefined,
    });
    const singleEnemySprite = [...phaserHarness.createdDisplayObjects]
      .reverse()
      .find((obj) => obj.textureKey.startsWith('ship.enemy.') && obj.scene !== null)!;
    singleEnemySprite.emit('pointerdown', { event: { target: game.canvas } });
    expect(lockClicks).toEqual([multiUnits[0].enemyId]); // ZERO new calls on single-enemy stage!

    // Explicit setInteractionCallbacks({ onEnemyLock: null }) clears active handler
    scene.setInteractionCallbacks({ onEnemyLock: (eid) => lockClicks.push(eid) });
    scene.setInteractionCallbacks({ onEnemyLock: null });
    singleEnemySprite.emit('pointerdown', { event: { target: game.canvas } });
    expect(lockClicks).toEqual([multiUnits[0].enemyId]);
    game.destroy();

    // 3) PhaserHost multi-enemy -> single-enemy transition + same-key static reuse clearing
    phaserHarness.reset();
    const hostContainer = document.createElement('div');
    document.body.appendChild(hostContainer);
    const host = new PhaserHost(hostContainer);
    phaserHarness.lastGame!.events.emit('ready');
    const hostLockCalls: string[] = [];
    host.showV2Stage({
      ...pbMulti,
      playbackKey: 'host_multi',
      onEnemyLock: (eid) => hostLockCalls.push(eid),
    });
    // Same-key static reuse with undefined callbacks & lockedEnemyId: null MUST clear handler and lock
    host.showV2Stage({
      ...pbMulti,
      playbackKey: 'host_multi',
      lockedEnemyId: null,
      canOverloadModules: false,
      overloadableModules: [],
      onEnemyLock: undefined,
      onModuleOverload: undefined,
    });
    const hostMultiSprite = phaserHarness.createdDisplayObjects.find(
      (obj) => obj.textureKey.startsWith('ship.enemy.') && obj.scene !== null
    )!;
    hostMultiSprite.emit('pointerdown', { event: { target: phaserHarness.lastGame!.canvas } });
    expect(hostLockCalls).toEqual([]);

    // Re-bind via setV2StageCallbacks, then transition to single-enemy stage with onEnemyLock: undefined -> strict no-op
    host.setV2StageCallbacks({ onEnemyLock: (eid) => hostLockCalls.push(eid) });
    hostMultiSprite.emit('pointerdown', { event: { target: phaserHarness.lastGame!.canvas } });
    expect(hostLockCalls).toEqual([multiUnits[0].enemyId]);

    host.showV2Stage({
      playbackKey: 'host_single',
      shipId: 'cannon_skiff',
      shipVisualSpec: deriveV2ShipVisualSpec(bay),
      sectorId: 'near_orbit',
      sectorIndex: 1,
      eventBackdrop: null,
      units: singleUnits,
      simulation: null,
      settings: { ...DEFAULT_SETTINGS },
      lockedEnemyId: null,
      onEnemyLock: undefined,
    });
    const hostSingleSprite = [...phaserHarness.createdDisplayObjects]
      .reverse()
      .find((obj) => obj.textureKey.startsWith('ship.enemy.') && obj.scene !== null)!;
    hostSingleSprite.emit('pointerdown', { event: { target: phaserHarness.lastGame!.canvas } });
    expect(hostLockCalls).toEqual([multiUnits[0].enemyId]);
    host.destroy();
    hostContainer.remove();
  });

  it('Fix 4: PREPARE (non-trial) onAddLoan, onAddOwned, and onSubLoan trigger "新联动！" toast, persist discoveredSynergies, and play energyLink SFX', () => {
    window.localStorage.clear();
    window.sessionStorage.setItem('starline_v2_title_entered', '1');

    const ownedBat = createV2EquipmentInstance({
      instanceId: 'owned_bat_prep',
      kind: 'battery',
      quality: 'common',
      origin: 'owned',
      acquiredDepth: 1,
      location: 'warehouse',
    });
    let profile: V2ProfileState = {
      ...createFreshV2Profile(),
      tutorialCompleted: true,
      discoveredSynergies: [],
      unlockedShips: ['cannon_skiff'],
      unlockedFamilies: ['core', 'heavy_kit', 'counter_kit'],
      blueprints: ['laser', 'battery', 'heavy', 'capacitor', 'shield', 'counter'],
      equipmentWarehouse: [ownedBat],
    };
    // Save a preset containing counter + a missing owned shield so #v2-preset-sub-loan substitutes shield next to counter!
    const presetRes = saveV2LoadoutPreset(profile, {
      name: '反击补齐预设',
      shipId: 'cannon_skiff',
      crewId: 'engineer',
      primaryArchetype: 'heavy',
      slots: [
        {
          slotKey: 'loan_cnt_1',
          origin: 'loan',
          definitionId: 'equipment.counter.common',
          x: 0,
          y: 0,
          rotation: 0,
        },
        {
          slotKey: 'missing_owned_shield',
          origin: 'owned',
          definitionId: 'equipment.shield.improved',
          warehouseInstanceId: 'missing_owned_shield',
          x: 1,
          y: 0,
          rotation: 0,
        },
      ],
    });
    expect(presetRes.ok).toBe(true);
    profile = { ...presetRes.profile, discoveredSynergies: [] };

    const baseSave = createFreshV2SaveData();
    persistV2SaveData(window.localStorage, {
      ...baseSave,
      profile,
      activeRun: null,
    });

    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const ctrl = new V2AppController(mount, { onSwitchToV1: () => {} });
    ctrl.init();

    // Enter PREPARE from BASE
    const prepBtn = mount.querySelector<HTMLButtonElement>('#v2-base-launch-rec');
    expect(prepBtn).not.toBeNull();
    prepBtn!.click();

    // 4A: onAddLoan (heavy + capacitor -> capacitor_heavy)
    mount.querySelector<HTMLButtonElement>('#v2-prep-clear')!.click();
    const sfxLoan = captureSfxCalls(() => {
      mount.querySelector<HTMLButtonElement>('[data-add-loan="equipment.heavy.common"]')!.click();
      mount.querySelector<HTMLButtonElement>('[data-add-loan="equipment.capacitor.common"]')!.click();
    });
    const toastA = mount.querySelector('[data-testid="synergy-discovery-toast"]');
    expect(toastA).not.toBeNull();
    expect(toastA!.getAttribute('data-synergy-ids')).toContain('capacitor_heavy');
    expect(sfxLoan.filter((k) => k === 'energyLink').length).toBe(1);
    const savedA = loadV2SaveData(window.localStorage);
    expect(savedA.status).toBe('loaded');
    if (savedA.status !== 'loaded') throw new Error('expected loaded');
    expect(savedA.data.profile.discoveredSynergies).toContain('capacitor_heavy');

    // 4B: onAddOwned (laser + owned battery -> battery_laser)
    mount.querySelector<HTMLButtonElement>('#v2-prep-clear')!.click();
    const sfxOwned = captureSfxCalls(() => {
      mount.querySelector<HTMLButtonElement>('[data-add-loan="equipment.laser.common"]')!.click();
      mount.querySelector<HTMLButtonElement>('[data-add-owned="owned_bat_prep"]')!.click();
    });
    const toastB = mount.querySelector('[data-testid="synergy-discovery-toast"]');
    expect(toastB).not.toBeNull();
    expect(toastB!.getAttribute('data-synergy-ids')).toContain('battery_laser');
    expect(sfxOwned.filter((k) => k === 'energyLink').length).toBe(1);
    const savedB = loadV2SaveData(window.localStorage);
    expect(savedB.status).toBe('loaded');
    if (savedB.status !== 'loaded') throw new Error('expected loaded');
    expect(savedB.data.profile.discoveredSynergies).toContain('battery_laser');

    // 4C: onSubLoan (preset missing shield substituted next to counter -> shield_counter)
    const presetLoadBtn = mount.querySelector<HTMLButtonElement>('[data-load-preset]');
    expect(presetLoadBtn).not.toBeNull();
    presetLoadBtn!.click();
    const subBtn = mount.querySelector<HTMLButtonElement>('#v2-preset-sub-loan');
    expect(subBtn).not.toBeNull();
    const sfxSub = captureSfxCalls(() => {
      subBtn!.click();
    });
    const toastC = mount.querySelector('[data-testid="synergy-discovery-toast"]');
    expect(toastC).not.toBeNull();
    expect(toastC!.getAttribute('data-synergy-ids')).toContain('shield_counter');
    expect(sfxSub.filter((k) => k === 'energyLink').length).toBe(1);
    const savedC = loadV2SaveData(window.localStorage);
    expect(savedC.status).toBe('loaded');
    if (savedC.status !== 'loaded') throw new Error('expected loaded');
    expect(savedC.data.profile.discoveredSynergies).toContain('shield_counter');

    ctrl.destroy();
    mount.remove();
  });

  it('Fix 5: ARRANGE #btn-v2-undo-discard AND migrated pre-linked bay move both emit energyLink SFX alongside "新联动！" toast', () => {
    window.localStorage.clear();
    window.sessionStorage.setItem('starline_v2_title_entered', '1');

    // 5A: #btn-v2-undo-discard restores coolant_tank adjacent to heavy -> toast + energyLink SFX!
    const tutBase = createV2TutorialRun('fix5_undo');
    const coolant = mkCargo('ct_undo', 'cargo.coolant_tank', 'bay');
    const undoRun: V2RunState = {
      ...tutBase,
      isTutorial: false,
      phase: 'ARRANGE',
      bay: {
        ...createEmptyV2Bay('cannon_skiff'),
        placed: [{ item: mkEq('h1', 'heavy'), x: 0, y: 0, rotation: 0 }],
        staging: [],
        discardedThisArrange: [
          {
            item: coolant,
            previousLocation: { zone: 'grid', x: 1, y: 0, rotation: 0 },
          },
        ],
      },
    };
    const baseSave = createFreshV2SaveData();
    persistV2SaveData(window.localStorage, {
      ...baseSave,
      profile: { ...baseSave.profile, tutorialCompleted: true, discoveredSynergies: [] },
      activeRun: undoRun,
    });

    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const ctrl = new V2AppController(mount, { onSwitchToV1: () => {} });
    ctrl.init();

    const undoBtn = mount.querySelector<HTMLButtonElement>('#btn-v2-undo-discard');
    expect(undoBtn).not.toBeNull();
    const sfxUndo = captureSfxCalls(() => {
      undoBtn!.click();
    });
    const toastUndo = mount.querySelector('[data-testid="synergy-discovery-toast"]');
    expect(toastUndo).not.toBeNull();
    expect(toastUndo!.getAttribute('data-synergy-ids')).toContain('coolant_heavy');
    expect(sfxUndo.filter((k) => k === 'energyLink').length).toBe(1);
    ctrl.destroy();

    // 5B: Migrated bay with pre-existing laser+battery link (discoveredSynergies: []) -> moving unrelated shield discovers + plays energyLink!
    window.localStorage.clear();
    const migratedRun: V2RunState = {
      ...tutBase,
      isTutorial: false,
      phase: 'ARRANGE',
      bay: {
        ...createEmptyV2Bay('cannon_skiff'),
        placed: [
          { item: mkEq('l1', 'laser'), x: 0, y: 0, rotation: 0 },
          { item: mkEq('b1', 'battery'), x: 1, y: 0, rotation: 0 },
          { item: mkEq('s1', 'shield'), x: 3, y: 0, rotation: 0 },
        ],
        staging: [],
        discardedThisArrange: [],
      },
    };
    persistV2SaveData(window.localStorage, {
      ...baseSave,
      profile: { ...baseSave.profile, tutorialCompleted: true, discoveredSynergies: [] },
      activeRun: migratedRun,
    });

    const ctrl2 = new V2AppController(mount, { onSwitchToV1: () => {} });
    const bootSfx = captureSfxCalls(() => {
      ctrl2.init();
    });
    expect(mount.querySelector('[data-testid="synergy-discovery-toast"]')).toBeNull();
    expect(bootSfx.filter((k) => k === 'energyLink').length).toBe(0);

    // Select shield at (3,0) (center x=224, y=32 on 256x256 4x4 board) and place at (3,2) (center x=224, y=160)
    const board = mount.querySelector<HTMLElement>('.v2-cargo-board')!;
    const sfxMigrated = captureSfxCalls(() => {
      board.dispatchEvent(
        new MiniEvent('pointerdown', {
          bubbles: true,
          button: 0,
          pointerType: 'mouse',
          clientX: 224,
          clientY: 32,
        }) as unknown as Event
      );
      window.dispatchEvent(
        new MiniEvent('pointerup', {
          bubbles: true,
          button: 0,
          pointerType: 'mouse',
          clientX: 224,
          clientY: 32,
        }) as unknown as Event
      );
      board.dispatchEvent(
        new MiniEvent('pointerdown', {
          bubbles: true,
          button: 0,
          pointerType: 'mouse',
          clientX: 224,
          clientY: 160,
        }) as unknown as Event
      );
    });
    const toastMig = mount.querySelector('[data-testid="synergy-discovery-toast"]');
    expect(toastMig).not.toBeNull();
    expect(toastMig!.getAttribute('data-synergy-ids')).toContain('battery_laser');
    expect(sfxMigrated.filter((k) => k === 'energyLink').length).toBe(1);

    ctrl2.destroy();
    mount.remove();
  });

  it('Fix 6: Live-lock defeat -> victory flip plays enemyDestroy SFX (NOT stale defeat hullHit SFX) on combat completion', () => {
    window.localStorage.clear();
    window.sessionStorage.setItem('starline_v2_title_entered', '1');

    const sandwichBay: V2CargoBayState = {
      ...createEmptyV2Bay('cannon_skiff'),
      placed: [
        { item: mkEq('l1', 'laser'), x: 0, y: 0, rotation: 0 },
        { item: mkEq('b1', 'battery', 'common'), x: 1, y: 0, rotation: 0 },
        { item: mkEq('l2', 'laser'), x: 2, y: 0, rotation: 0 },
      ],
    };
    const baseRun = buildRunAtEncounter(sandwichBay, 'artillery', 3, 22, 30);
    const units = baseRun.graph.nodes[baseRun.currentNodeId!]!.combat!.units;
    const artilleryId = units[0].enemyId;

    const started = startV2CombatAtCurrentNode(baseRun, 'weakest', {
      enableTacticalCommands: false,
    }).run;
    expect(started.activeCombat!.simulation.outcome).toBe('defeat');

    const baseSave = createFreshV2SaveData();
    persistV2SaveData(window.localStorage, {
      ...baseSave,
      profile: { ...baseSave.profile, tutorialCompleted: true },
      settings: { ...DEFAULT_SETTINGS, pureAutoCombat: true },
      activeRun: started,
    });

    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const ctrl = new V2AppController(mount, { onSwitchToV1: () => {} });
    ctrl.init();
    phaserHarness.lastGame!.events.emit('ready');

    // Toggle live lock onto artillery cannon -> flips activeCombat.simulation.outcome in-place to 'victory'!
    const lockBtn = mount.querySelector<HTMLButtonElement>(`[data-testid="enemy-lock-${artilleryId}"]`);
    expect(lockBtn).not.toBeNull();
    lockBtn!.click();

    const midSave = loadV2SaveData(window.localStorage);
    expect(midSave.status).toBe('loaded');
    if (midSave.status !== 'loaded') throw new Error('expected loaded');
    expect(midSave.data.activeRun!.activeCombat!.simulation.outcome).toBe('victory');

    // Skip to complete combat -> MUST enter REWARD and play 'enemyDestroy' (NOT 'hullHit')!
    const skipBtn = mount.querySelector<HTMLButtonElement>('#v2-combat-skip');
    expect(skipBtn).not.toBeNull();
    const completionSfx = captureSfxCalls(() => {
      skipBtn!.click();
    });
    const endSave = loadV2SaveData(window.localStorage);
    expect(endSave.status).toBe('loaded');
    if (endSave.status !== 'loaded') throw new Error('expected loaded');
    expect(endSave.data.activeRun!.phase).toBe('REWARD');
    expect(completionSfx).toContain('enemyDestroy');
    expect(completionSfx).not.toContain('hullHit');

    ctrl.destroy();
    mount.remove();
  });

  it('Fix 7: CombatPrePhaseView details drawer refreshes per-round logs when lock toggle keeps identical final HP and round count', () => {
    const bay: V2CargoBayState = {
      ...createEmptyV2Bay('cannon_skiff'),
      placed: [
        { item: mkEq('l1', 'laser'), x: 0, y: 0, rotation: 0 },
        { item: mkEq('b1', 'battery', 'common'), x: 1, y: 0, rotation: 0 },
      ],
    };
    const baseRun = buildRunAtEncounter(bay, 'patrol', 2, 30, 30);
    const node = baseRun.graph.nodes[baseRun.currentNodeId!]!;

    // Asymmetric armor (0 vs 1) with tuned HP on standard units so BOTH locks finish in 4 rounds & identical final HP,
    // while Round-1 damage dealt differs (7 vs 5)!
    const drUnits = [
      { ...node.combat!.units[0], enemyId: 'dr_u0', name: '侦察艇 A', maxHp: 14, damagePerRound: 3, armor: 0, pierceRatio: 0, role: 'standard' as const },
      { ...node.combat!.units[0], enemyId: 'dr_u1', name: '装甲艇 B', maxHp: 10, damagePerRound: 3, armor: 1, pierceRatio: 0, role: 'standard' as const },
    ];
    const drNode = {
      ...node,
      combat: { ...node.combat!, encounterKind: 'patrol' as const, units: drUnits },
    };
    const drRun: V2RunState = {
      ...baseRun,
      graph: { ...baseRun.graph, nodes: { ...baseRun.graph.nodes, [node.nodeId]: drNode } },
    };
    const drLock0: V2RunState = { ...drRun, lockedEnemyId: 'dr_u0' };
    const drLock1: V2RunState = { ...drRun, lockedEnemyId: 'dr_u1' };
    const drPv0 = previewV2CombatNode(drLock0, node.nodeId)!;
    const drPv1 = previewV2CombatNode(drLock1, node.nodeId)!;

    expect(drPv0.outcome).toBe(drPv1.outcome);
    expect(drPv0.finalPlayerHpAfterRepair).toBe(drPv1.finalPlayerHpAfterRepair);
    expect(drPv0.roundsCount).toBe(drPv1.roundsCount);
    const r1Dmg0 = drPv0.rounds[0].playerAttacks.reduce((s, a) => s + a.appliedDamage, 0);
    const r1Dmg1 = drPv1.rounds[0].playerAttacks.reduce((s, a) => s + a.appliedDamage, 0);
    expect(r1Dmg0).not.toBe(r1Dmg1);

    const host = document.createElement('div');
    const preView = new CombatPrePhaseView();
    preView.mount(host);
    const noopActions = {
      onSelectPolicy: () => {},
      onToggleLog: () => {},
      onUseGadget: () => {},
      onTogglePauseAutoEngage: () => {},
      onToggleLockEnemy: () => {},
      onStartCombat: () => {},
    };

    preView.update(
      {
        run: drLock0,
        node: drNode,
        readOnly: false,
        showCombatLogDetails: true,
        pureAutoCombat: false,
        bonusBossCharges: 0,
        stargateRelayTier: 0,
        autoEngage: undefined,
      },
      noopActions
    );
    const html0 = host.querySelector('[data-testid="forecast-details-drawer"]')!.innerHTML;

    preView.update(
      {
        run: drLock1,
        node: drNode,
        readOnly: false,
        showCombatLogDetails: true,
        pureAutoCombat: false,
        bonusBossCharges: 0,
        stargateRelayTier: 0,
        autoEngage: undefined,
      },
      noopActions
    );
    const html1 = host.querySelector('[data-testid="forecast-details-drawer"]')!.innerHTML;
    expect(html0).not.toBe(html1);
    expect(html0).toContain(`R1: 我方 ${r1Dmg0}伤`);
    expect(html1).toContain(`R1: 我方 ${r1Dmg1}伤`);
    preView.unmount();
  });

  it('Fix 8: 2-charge Boss liveCombatEventLine shows chronologically latest non-target_lock intervention AND CombatLivePhaseView disables tactical orders when readOnly', () => {
    window.localStorage.clear();
    window.sessionStorage.setItem('starline_v2_title_entered', '1');

    const bossBay: V2CargoBayState = {
      ...createEmptyV2Bay('heavy_freighter'),
      placed: [
        { item: mkEq('l1', 'laser'), x: 0, y: 0, rotation: 0 },
        { item: mkEq('b1', 'battery', 'common'), x: 1, y: 0, rotation: 0 },
        { item: mkEq('s1', 'shield', 'improved'), x: 2, y: 0, rotation: 0 },
      ],
    };
    const bossRun = buildRunAtEncounter(bossBay, 'boss_dreadnought', 6, 38, 38);
    const started = startV2CombatAtCurrentNode(bossRun, 'weakest', {
      enableTacticalCommands: true,
    }).run;

    // Verify CombatLivePhaseView disables ALL [data-elite-tactic] buttons when readOnly === true
    const paused1 = markV2CombatDecisionPaused(
      started,
      started.activeCombat!.pendingDecision!.decisionId
    );
    const liveHost = document.createElement('div');
    const liveView = new CombatLivePhaseView();
    liveView.mount(liveHost);
    liveView.update(
      {
        run: paused1,
        liveCombatRound: 2,
        liveCombatPlayerHp: 35,
        liveCombatPlayerShield: 4,
        liveCombatEnemiesAlive: 3,
        liveCombatEventLine: '',
        livePhaseBannerText: null,
        liveEnemySnapshots: paused1.activeCombat!.simulation.rounds[0].enemiesAfter,
        awaitingEliteDecision: true,
        combatSpeed: 1,
        readOnly: true,
      },
      {
        onPeekBay: () => {},
        onToggleSpeed: () => {},
        onSkipPlayback: () => {},
        onCommitEliteTactic: () => {},
        onOverloadModule: () => {},
      }
    );
    const tacticBtns = Array.from(
      liveHost.querySelectorAll<HTMLButtonElement>('[data-elite-tactic]')
    );
    expect(tacticBtns.length).toBe(4);
    expect(tacticBtns.every((b) => b.disabled)).toBe(true);
    liveView.unmount();

    // Commit Charge 1 = module overload ('s1') at R2, then Charge 2 = tactical command ('emergency_shield') at Pause #2
    const afterC1 = commitV2ModuleOverload(
      paused1,
      paused1.activeCombat!.pendingDecision!.decisionId,
      's1'
    );
    expect(afterC1.ok).toBe(true);
    const pause2Id = afterC1.run.activeCombat!.pendingDecision!.decisionId;
    const afterC2 = commitV2EliteTacticDecision(afterC1.run, pause2Id, 'emergency_shield');
    expect(afterC2.ok).toBe(true);

    // Mount in V2AppController (with a queued mock timer so initial resume line is inspected before Round N+1 step fires)
    const baseSave = createFreshV2SaveData();
    persistV2SaveData(window.localStorage, {
      ...baseSave,
      profile: { ...baseSave.profile, tutorialCompleted: true },
      activeRun: afterC2.run,
    });
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const ctrl = new V2AppController(mount, { onSwitchToV1: () => {} });
    ctrl.init();

    // Event line MUST show Charge 2 ('指令生效：紧急护盾'), NOT stale Charge 1 ('部件过载：护盾发生器')!
    const eventText = mount.textContent ?? '';
    expect(eventText).toContain('指令生效：紧急护盾');
    expect(eventText).not.toContain('部件过载：护盾发生器');

    ctrl.destroy();
    mount.remove();
  });
});

