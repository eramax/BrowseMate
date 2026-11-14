import { describe, expect, it } from 'vitest';
import { resolveTabId } from '../src/background/tools/tab-id';

const ctx = {
  getActiveTab: async () => ({ id: 42 }),
} as any;

describe('resolveTabId', () => {
  it('treats 0, negative and undefined as the active tab', async () => {
    expect(await resolveTabId(0, ctx)).toBe(42);
    expect(await resolveTabId(-1, ctx)).toBe(42);
    expect(await resolveTabId(undefined, ctx)).toBe(42);
  });

  it('keeps a valid positive tabId', async () => {
    expect(await resolveTabId(7, ctx)).toBe(7);
  });
});
