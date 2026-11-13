// مخزن الجلسات — كامل المنطق معزول عن chrome عبر KV (المواصفة §4/§8)
import type { Session, ChatMessage } from '../shared/types';
import type { KV } from '../shared/storage';

const PREFIX = 'session:';
export const MAX_MSGS_PER_SESSION = 200;

export function createSessionStore(kv: KV) {
  const get = async (id: string): Promise<Session | undefined> => kv.get(PREFIX + id);

  return {
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
      return s;
    },
    async list() {
      const out: Array<Pick<Session, 'id' | 'title' | 'updatedAt'>> = [];
      for (const k of await kv.keys()) {
        if (!k.startsWith(PREFIX)) continue;
        const s = await kv.get<Session>(k);
        if (s) out.push({ id: s.id, title: s.title, updatedAt: s.updatedAt });
      }
      return out.sort((a, b) => b.updatedAt - a.updatedAt); // الأحدث أولاً
    },
    async append(id: string, msg: ChatMessage) {
      const s = await get(id);
      if (!s) throw new Error(`session ${id} not found`);
      s.messages.push(msg);
      s.updatedAt = Date.now();
      await kv.set(PREFIX + id, s);
    },
    async update(id: string, patch: Partial<Session>) {
      const s = await get(id);
      if (!s) throw new Error('not found');
      await kv.set(PREFIX + id, { ...s, ...patch, updatedAt: Date.now() });
    },
    async remove(id: string) {
      await kv.remove(PREFIX + id);
    },
    /** قص حصة التخزين: أقدم جلسات أولاً — لا حذف جلسات، فقط قص رسائلها (المواصفة §8) */
    async enforceQuota() {
      const ids = (await this.list()).map((x) => x.id);
      for (const id of ids.reverse()) {
        const s = await get(id);
        if (!s || s.messages.length <= MAX_MSGS_PER_SESSION) continue;
        const cut = s.messages.length - MAX_MSGS_PER_SESSION;
        s.messages = [
          { id: 'trim', role: 'system', content: `[trimmed] ${cut} earlier messages removed`, ts: Date.now() },
          ...s.messages.slice(cut, cut + MAX_MSGS_PER_SESSION - 1),
        ];
        await kv.set(PREFIX + id, s);
      }
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
