// سجل تشخيصي مفصل لكل جلسة — يُفعَّل من الإعدادات.
// يخزّن في chrome.storage.local تحت debug:<sessionId>، مع تنظيف للأسرار وحد للحجم.
import { chromeKV, type KV } from '../shared/storage';

export type DebugLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DebugEntry {
  ts: number;
  level: DebugLevel;
  event: string;
  data?: unknown;
}

export interface DebugLog {
  sessionId: string;
  startedAt: number;
  updatedAt: number;
  entries: DebugEntry[];
  truncated?: boolean;
}

export interface DebugSink {
  log: (event: string, data?: unknown, level?: DebugLevel) => void;
}

const PREFIX = 'debug:';
const MAX_ENTRIES = 6000;
const MAX_CHARS = 2_000_000;
const MAX_STRING = 20_000;
const SECRET_KEY = /^(api[-_]?key|authorization|password|passwd|token|secret|cookie|set-cookie)$/i;

export function createDebugStore(kv: KV) {
  const key = (sessionId: string) => PREFIX + sessionId;
  return {
    read: (sessionId: string) => kv.get<DebugLog>(key(sessionId)),
    write: (log: DebugLog) => kv.set(key(log.sessionId), log),
    clear: (sessionId: string) => kv.remove(key(sessionId)),
    async clearAll(): Promise<void> {
      const keys = (await kv.keys()).filter((k) => k.startsWith(PREFIX));
      await Promise.all(keys.map((k) => kv.remove(k)));
    },
    async all(): Promise<DebugLog[]> {
      const keys = (await kv.keys()).filter((k) => k.startsWith(PREFIX));
      const logs: DebugLog[] = [];
      for (const k of keys) {
        const log = await kv.get<DebugLog>(k);
        if (log) logs.push(log);
      }
      return logs.sort((a, b) => b.updatedAt - a.updatedAt);
    },
    /** حماية حصة التخزين: يبقي أحدث السجلات ضمن ~6MB */
    async prune(maxTotal = 6_000_000): Promise<void> {
      const logs = await this.all();
      let total = logs.reduce((n, l) => n + JSON.stringify(l).length, 0);
      for (const log of logs.slice().reverse()) {
        if (total <= maxTotal) break;
        await kv.remove(PREFIX + log.sessionId);
        total -= JSON.stringify(log).length;
      }
    },
  };
}

export const debugStore = createDebugStore(chromeKV);

/** إخفاء الأسرار وتقليم النصوص الكبيرة قبل التخزين */
export function sanitizeDebug(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string')
    return value.length > MAX_STRING
      ? `${value.slice(0, MAX_STRING)}… [${value.length - MAX_STRING} chars truncated]`
      : value;
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (typeof value !== 'object') return String(value);
  if (depth > 6) return '[depth limit]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => sanitizeDebug(v, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(k)) out[k] = '[redacted]';
    else out[k] = sanitizeDebug(v, depth + 1, seen);
  }
  return out;
}

/**
 * Logger مجمّع: يكتب دفعة كل ~700ms بدل كل حدث، ويحتفظ بآخر ~2MB لكل جلسة.
 * flush() تُستدعى عند نهاية التشغيل/الخطأ.
 */
export class DebugLogger implements DebugSink {
  private pending: DebugEntry[] = [];
  private entries: DebugEntry[] = [];
  private startedAt = Date.now();
  private loaded = false;
  private truncated = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private chain: Promise<void> = Promise.resolve();
  private lastPrune = 0;

  constructor(
    public readonly sessionId: string,
    public readonly enabled: boolean,
    private readonly store = debugStore,
  ) {}

  log(event: string, data?: unknown, level: DebugLevel = 'info'): void {
    if (!this.enabled) return;
    this.pending.push({ ts: Date.now(), level, event, data: sanitizeDebug(data) });
    this.schedule();
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, 700);
  }

  flush(): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.chain = this.chain.then(() => this.doFlush()).catch(() => {});
    return this.chain;
  }

  private async doFlush(): Promise<void> {
    if (!this.loaded) {
      const prev = await this.store.read(this.sessionId);
      if (prev) {
        this.entries = prev.entries ?? [];
        this.startedAt = prev.startedAt ?? this.startedAt;
        this.truncated = Boolean(prev.truncated);
      }
      this.loaded = true;
    }
    if (this.pending.length) {
      this.entries.push(...this.pending);
      this.pending = [];
    }
    this.trim();
    await this.store.write({
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      updatedAt: Date.now(),
      entries: this.entries,
      ...(this.truncated ? { truncated: true } : {}),
    });
    if (Date.now() - this.lastPrune > 60_000) {
      this.lastPrune = Date.now();
      await this.store.prune().catch(() => {});
    }
  }

  private trim(): void {
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
      this.truncated = true;
    }
    let size = JSON.stringify(this.entries).length;
    while (size > MAX_CHARS && this.entries.length > 1) {
      this.entries.splice(0, Math.max(1, Math.ceil(this.entries.length / 10)));
      this.truncated = true;
      size = JSON.stringify(this.entries).length;
    }
  }
}

export function createDebugLogger(sessionId: string, enabled: boolean): DebugLogger {
  return new DebugLogger(sessionId, enabled);
}

/** للاستخدام خارج runChat (أحداث لوحة/إعدادات) */
export async function isDebugEnabled(): Promise<boolean> {
  const s = await chromeKV.get<{ debug?: boolean }>('settings');
  return Boolean(s?.debug);
}

/** سجل نظام مستقل (أخطاء service worker/init) — يظهر ضمن «تنزيل كل السجلات» */
export async function logSystemDebug(
  event: string,
  data?: unknown,
  level: DebugLevel = 'error',
): Promise<void> {
  try {
    if (!(await isDebugEnabled())) return;
    const logger = createDebugLogger('system', true);
    logger.log(event, data, level);
    await logger.flush();
  } catch {
    /* لا نكسر التطبيق بسبب التشخيص */
  }
}
