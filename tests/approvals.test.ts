import { describe, it, expect } from 'vitest';
import { createApprovalManager } from '../src/background/approvals';

describe('approval manager', () => {
  it('notifies panel and resolves when approved', async () => {
    const m = createApprovalManager();
    const p = m.request('navigate', { url: 'x' }, undefined, (info) => m.resolve(info.id, true));
    await expect(p).resolves.toBe(true);
  });
  it('refusal resolves false', async () => {
    const m = createApprovalManager();
    const p = m.request('navigate', { url: 'x' });
    m.resolve(m.pending()[0].id, false);
    await expect(p).resolves.toBe(false);
  });
  it('tracks multiple pending', () => {
    const m = createApprovalManager();
    m.request('a', {}); m.request('b', {});
    expect(m.pending()).toHaveLength(2);
    m.resolve(m.pending()[0].id, true);
    expect(m.pending()).toHaveLength(1);
  });
});
