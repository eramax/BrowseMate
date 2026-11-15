import { describe, expect, it } from 'vitest';
import { withDebugger } from '../src/background/debugger-lock';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('debugger lock', () => {
  it('serializes inspect/pdf work instead of attaching twice', async () => {
    const order: string[] = [];
    const first = withDebugger(async () => {
      order.push('inspect:start');
      await delay(20);
      order.push('inspect:end');
    });
    const second = withDebugger(async () => {
      order.push('pdf:start');
      await delay(5);
      order.push('pdf:end');
    });
    await Promise.all([first, second]);
    expect(order).toEqual(['inspect:start', 'inspect:end', 'pdf:start', 'pdf:end']);
  });

  it('releases the lock after a failure', async () => {
    await expect(withDebugger(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    let ran = false;
    await withDebugger(async () => { ran = true; });
    expect(ran).toBe(true);
  });
});
