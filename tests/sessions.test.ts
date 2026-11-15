import { describe, it, expect } from 'vitest';
import { createSessionStore } from '../src/background/sessions';
import type { KV } from '../src/shared/storage';

function memKV(): KV {
  const m = new Map<string, unknown>();
  return {
    get: async (k) => m.get(k) as any,
    set: async (k, v) => { m.set(k, v); },
    remove: async (k) => { m.delete(k); },
    keys: async () => [...m.keys()],
  };
}

describe('sessions store', () => {
  it('creates session, appends message, lists by recency', async () => {
    const s = createSessionStore(memKV());
    const s1 = await s.create('my chat');
    await s.append(s1.id, { id: 'm1', role: 'user', content: 'hi', ts: 1 });
    const list = await s.list();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('my chat');
    expect((await s.get(s1.id))!.messages).toHaveLength(1);
  });

  it('caps messages per session (200) with a trim marker, iterates oldest sessions first', async () => {
    const s = createSessionStore(memKV());
    const a = await s.create('old');
    const b = await s.create('new');
    for (let i = 0; i < 250; i++)
      await s.append(b.id, { id: `m${i}`, role: 'user', content: 'x'.repeat(100), ts: i });
    await s.append(a.id, { id: 'a1', role: 'user', content: 'y', ts: 1 });
    await s.enforceQuota();
    const trimmed = (await s.get(b.id))!.messages;
    expect(trimmed.length).toBeLessThanOrEqual(200);
    expect(trimmed[0].content.startsWith('[trimmed]')).toBe(true);
    expect((await s.get(a.id))!.messages).toHaveLength(1);
  });
});

describe('sessions concurrency', () => {
  it('does not lose concurrent appends', async () => {
    const s = createSessionStore(memKV());
    const sess = await s.create('concurrent');
    await Promise.all(
      Array.from({ length: 80 }, (_, i) =>
        s.append(sess.id, { id: `m${i}`, role: 'user', content: `msg-${i}`, ts: i }),
      ),
    );
    const after = await s.get(sess.id);
    expect(after!.messages).toHaveLength(80);
    expect(after!.messages.map((m) => m.id).sort()).toEqual(
      Array.from({ length: 80 }, (_, i) => `m${i}`).sort(),
    );
  });

  it('returns clones so callers cannot mutate stored history', async () => {
    const s = createSessionStore(memKV());
    const sess = await s.create('clone');
    await s.append(sess.id, { id: 'm1', role: 'user', content: 'hi', ts: 1 });
    const a = await s.get(sess.id);
    a!.messages.push({ id: 'evil', role: 'user', content: 'x', ts: 2 });
    expect((await s.get(sess.id))!.messages).toHaveLength(1);
  });
});
