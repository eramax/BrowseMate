// مخزن الجلسات — كامل المنطق معزول عن chrome عبر KV (المواصفة §4/§8)
// كل تعديل على جلسة يمر عبر قفل واحد؛ append/patch لا يمكن أن يتداخلا ويمسح أحدهما الآخر.
import type { Session, ChatMessage } from '../shared/types';
import type { KV } from '../shared/storage';

const PREFIX = 'session:';
export const MAX_MSGS_PER_SESSION = 200;

function clone<T>(v: T): T {
  try {
    return structuredClone(v);
  } catch {
    return JSON.parse(JSON.stringify(v)) as T;
  }
}

export function createSessionStore(kv: KV) {
  const locks = new Map<string, Promise<unknown>>();

  function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(id) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    // خزّن نسخة لا ترفض حتى لا تكسر السلسلة
    locks.set(id, run.then(() => undefined, () => undefined));
    return run;
  }

  const get = async (id: string): Promise<Session | undefined> => {
    const s = await kv.get<Session>(PREFIX + id);
    return s ? clone(s) : undefined;
  };

  function trimMessages(s: Session): void {
    if (s.messages.length <= MAX_MSGS_PER_SESSION) return;
    const cut = s.messages.length - MAX_MSGS_PER_SESSION;
    s.messages = [
      { id: 'trim', role: 'system', content: `[trimmed] ${cut} earlier messages removed`, ts: Date.now() },
      ...s.messages.slice(cut, cut + MAX_MSGS_PER_SESSION - 1),
    ];
  }

  const store = {
    get,
    async create(title: string): Promise<Session> {
      const s: Session = {
        id: crypto.randomUUID(),
        title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
      };
      await kv.set(PREFIX + s.id, s);
      return clone(s);
    },
    async list() {
      const out: Array<Pick<Session, 'id' | 'title' | 'updatedAt' | 'createdAt'>> = [];
      for (const k of await kv.keys()) {
        if (!k.startsWith(PREFIX)) continue;
        const s = await kv.get<Session>(k);
        if (s) out.push({ id: s.id, title: s.title, updatedAt: s.updatedAt, createdAt: s.createdAt });
      }
      return out.sort((a, b) => b.updatedAt - a.updatedAt); // الأحدث أولاً
    },
    async append(id: string, msg: ChatMessage) {
      await withLock(id, async () => {
        const s = await kv.get<Session>(PREFIX + id);
        if (!s) throw new Error(`session ${id} not found`);
        s.messages.push(msg);
        trimMessages(s);
        s.updatedAt = Date.now();
        await kv.set(PREFIX + id, s);
      });
    },
    /** تعديل رسالة موجودة أثناء البث (مسودة الرد) — لا يمسح تعديلات أخرى */
    async patchMessage(id: string, msgId: string, patch: Partial<ChatMessage>) {
      await withLock(id, async () => {
        const s = await kv.get<Session>(PREFIX + id);
        if (!s) return;
        const i = s.messages.findIndex((m) => m.id === msgId);
        if (i < 0) return;
        s.messages[i] = { ...s.messages[i], ...patch };
        s.updatedAt = Date.now();
        await kv.set(PREFIX + id, s);
      });
    },
    async removeMessage(id: string, msgId: string) {
      await withLock(id, async () => {
        const s = await kv.get<Session>(PREFIX + id);
        if (!s) return;
        s.messages = s.messages.filter((m) => m.id !== msgId);
        s.updatedAt = Date.now();
        await kv.set(PREFIX + id, s);
      });
    },
    async update(id: string, patch: Partial<Session>) {
      await withLock(id, async () => {
        const s = await kv.get<Session>(PREFIX + id);
        if (!s) throw new Error('not found');
        await kv.set(PREFIX + id, { ...s, ...patch, updatedAt: Date.now() });
      });
    },
    async remove(id: string) {
      await withLock(id, async () => { await kv.remove(PREFIX + id); });
    },
    /** قص حصة التخزين: أقدم جلسات أولاً — لا حذف جلسات، فقط قص رسائلها (المواصفة §8) */
    async enforceQuota() {
      for (const id of (await store.list()).map((x) => x.id)) {
        await withLock(id, async () => {
          const s = await kv.get<Session>(PREFIX + id);
          if (!s) return;
          trimMessages(s);
          await kv.set(PREFIX + id, s);
        });
      }
    },
  };

  return store;
}

export type SessionStore = ReturnType<typeof createSessionStore>;
