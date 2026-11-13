import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { register, asAISDKTools } from '../src/background/tools/registry';

describe('repeat guard', () => {
  it('allows read-only/preview tools to repeat after state changes, but blocks mutating repeats', async () => {
    register({
      name: 'test_read_ro',
      description: 'read-only',
      sensitive: false,
      idempotent: true,
      schema: z.object({}),
      execute: async () => ({ ok: true }),
    });
    register({
      name: 'test_write_rw',
      description: 'mutating',
      sensitive: false,
      schema: z.object({}),
      execute: async () => ({ ok: true }),
    });

    const ctx: any = {
      approvalMode: 'never',
      seenCalls: new Map(),
      callCount: { value: 0 },
      requestApproval: async () => true,
    };
    const tools = asAISDKTools(ctx, () => true);

    expect(await tools.test_read_ro.execute({})).toEqual({ ok: true });
    expect(await tools.test_read_ro.execute({})).toEqual({ ok: true });
    expect(await tools.test_write_rw.execute({})).toEqual({ ok: true });
    expect((await tools.test_write_rw.execute({})).error).toBe('REPEATED_IDENTICAL_CALL');
  });
});
