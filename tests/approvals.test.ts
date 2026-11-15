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

describe('approval ownership/timeout', () => {
  it('rejects only the requested run', async () => {
    const m = createApprovalManager();
    const a = m.request('a', {}, undefined, undefined, { runId: 'r1', sessionId: 's1' });
    const b = m.request('b', {}, undefined, undefined, { runId: 'r2', sessionId: 's1' });
    m.rejectRun('r1');
    await expect(a).resolves.toBe(false);
    expect(m.pending().map((x) => x.tool)).toEqual(['b']);
    m.resolve(m.pending()[0].id, true);
    await expect(b).resolves.toBe(true);
  });

  it('rejects all pending approvals of a session', async () => {
    const m = createApprovalManager();
    const a = m.request('a', {}, undefined, undefined, { sessionId: 's1' });
    const b = m.request('b', {}, undefined, undefined, { sessionId: 's2' });
    m.rejectSession('s1');
    await expect(a).resolves.toBe(false);
    expect(m.pending()).toHaveLength(1);
    m.resolve(m.pending()[0].id, false);
    await expect(b).resolves.toBe(false);
  });

  it('times out instead of hanging forever', async () => {
    const m = createApprovalManager();
    const p = m.request('a', {}, undefined, undefined, { timeoutMs: 120 });
    await expect(p).resolves.toBe(false);
    expect(m.pending()).toHaveLength(0);
  });
});
