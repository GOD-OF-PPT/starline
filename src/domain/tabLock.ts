const DEFAULT_LOCK_KEY = 'starline_active_tab_lock_v1';
const DEFAULT_CHANNEL_NAME = 'starline_tab_sync_v1';
const LEASE_MS = 6000;
const HEARTBEAT_MS = 2000;

interface TabLockRecord {
  readonly tabId: string;
  readonly updatedAt: number;
}

export interface MultiTabGuardOptions {
  readonly lockKey?: string;
  readonly channelName?: string;
}

export class MultiTabGuard {
  private readonly tabId: string;
  private readonly lockKey: string;
  private readonly channelName: string;
  private channel: BroadcastChannel | null = null;
  private heartbeatTimer: number | null = null;
  private isOwner = true;
  private readonly onStatusChange: (isOwner: boolean) => void;

  constructor(onStatusChange: (isOwner: boolean) => void, options?: MultiTabGuardOptions) {
    this.lockKey = options?.lockKey ?? DEFAULT_LOCK_KEY;
    this.channelName = options?.channelName ?? DEFAULT_CHANNEL_NAME;
    this.tabId = this.resolvePerTabId();
    this.onStatusChange = onStatusChange;
  }

  private resolvePerTabId(): string {
    const fallback = `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    if (typeof window === 'undefined') return fallback;
    try {
      const selfKey = `${this.lockKey}_self_id`;
      const existing = window.sessionStorage.getItem(selfKey);
      if (existing && existing.length > 0) return existing;
      window.sessionStorage.setItem(selfKey, fallback);
      return fallback;
    } catch {
      return fallback;
    }
  }

  start(): boolean {
    if (typeof window === 'undefined') return true;

    const existing = this.readLock();
    const now = Date.now();
    if (existing && existing.tabId !== this.tabId && now - existing.updatedAt < LEASE_MS) {
      this.isOwner = false;
    } else {
      this.isOwner = true;
      this.writeLock();
    }

    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel(this.channelName);
        this.channel.onmessage = (event) => {
          const data = event.data as { type?: string; tabId?: string } | null;
          if (!data || data.tabId === this.tabId) return;
          if (data.type === 'claim') {
            this.isOwner = false;
            this.onStatusChange(false);
          } else if (data.type === 'ping' && this.isOwner) {
            this.channel?.postMessage({ type: 'pong', tabId: this.tabId });
          } else if (data.type === 'pong' && this.isOwner) {
            // Another owner already exists; yield until user explicitly takes over
            this.isOwner = false;
            this.onStatusChange(false);
          }
        };
        if (this.isOwner) {
          this.channel.postMessage({ type: 'ping', tabId: this.tabId });
        }
      } catch {
        this.channel = null;
      }
    }

    window.addEventListener('storage', this.handleStorageEvent);
    window.addEventListener('beforeunload', this.handleUnload);
    window.addEventListener('pagehide', this.handleUnload);

    this.heartbeatTimer = window.setInterval(() => {
      if (this.isOwner) {
        this.writeLock();
      }
    }, HEARTBEAT_MS);

    return this.isOwner;
  }

  takeOver(): void {
    this.isOwner = true;
    this.writeLock();
    this.channel?.postMessage({ type: 'claim', tabId: this.tabId });
    this.onStatusChange(true);
  }

  canWrite(): boolean {
    return this.isOwner;
  }

  destroy(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    window.removeEventListener('storage', this.handleStorageEvent);
    window.removeEventListener('beforeunload', this.handleUnload);
    window.removeEventListener('pagehide', this.handleUnload);
    this.releaseIfOwned();
    this.channel?.close();
    this.channel = null;
  }

  private handleStorageEvent = (e: StorageEvent): void => {
    if (e.key !== this.lockKey || !e.newValue) return;
    try {
      const parsed = JSON.parse(e.newValue) as TabLockRecord;
      if (parsed.tabId && parsed.tabId !== this.tabId && this.isOwner) {
        this.isOwner = false;
        this.onStatusChange(false);
      }
    } catch {
      // ignore malformed
    }
  };

  private handleUnload = (): void => {
    this.releaseIfOwned();
    this.channel?.close();
    this.channel = null;
  };

  private readLock(): TabLockRecord | null {
    try {
      const raw = window.localStorage.getItem(this.lockKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as TabLockRecord;
      if (typeof parsed.tabId === 'string' && typeof parsed.updatedAt === 'number') {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  private writeLock(): void {
    try {
      const record: TabLockRecord = { tabId: this.tabId, updatedAt: Date.now() };
      window.localStorage.setItem(this.lockKey, JSON.stringify(record));
    } catch {
      // ignore storage failure here; persistence layer reports write failures
    }
  }

  private releaseIfOwned(): void {
    if (!this.isOwner) return;
    const current = this.readLock();
    if (current?.tabId === this.tabId) {
      try {
        window.localStorage.removeItem(this.lockKey);
      } catch {
        // ignore
      }
    }
  }
}
