import { describe, it, expect } from 'vitest';
import { createDebugStore, DebugLogger, sanitizeDebug } from '../src/background/debug';
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

describe('debug logger', () => {
  it('batches entries, redacts secrets and truncates huge strings', async () => {
    const store = createDebugStore(memKV());
    const logger = new DebugLogger('s1', true, store);
    logger.log('run:start', {
      apiKey: 'super-secret',
      nested: { password: 'hunter2', text: 'x'.repeat(25000) },
      ok: true,
    });
    logger.log('tool:end', { result: { ok: true } }, 'debug');
    await logger.flush();

    const log = await store.read('s1');
    expect(log?.entries).toHaveLength(2);
    const json = JSON.stringify(log);
    expect(json).not.toContain('super-secret');
    expect(json).not.toContain('hunter2');
    expect(json).toContain('[redacted]');
    expect(json).toContain('chars truncated');
    expect(log?.entries[0].event).toBe('run:start');
    expect(log?.entries[1].level).toBe('debug');
  });

  it('does nothing when disabled', async () => {
    const store = createDebugStore(memKV());
    const logger = new DebugLogger('s2', false, store);
    logger.log('run:start', { ok: true });
    await logger.flush();
    expect(await store.read('s2')).toBeUndefined();
  });

  it('clears one or all logs', async () => {
    const store = createDebugStore(memKV());
    for (const id of ['a', 'b']) {
      const l = new DebugLogger(id, true, store);
      l.log('x', { id });
      await l.flush();
    }
    expect((await store.all()).map((l) => l.sessionId).sort()).toEqual(['a', 'b']);
    await store.clear('a');
    expect(await store.read('a')).toBeUndefined();
    expect((await store.all()).map((l) => l.sessionId)).toEqual(['b']);
    await store.clearAll();
    expect(await store.all()).toEqual([]);
  });

  it('sanitizes circular references and errors', () => {
    const obj: any = { name: 'x' };
    obj.self = obj;
    const err = new Error('boom');
    const out = sanitizeDebug({ obj, err });
    expect(JSON.stringify(out)).toContain('[circular]');
    expect(JSON.stringify(out)).toContain('boom');
  });
});
