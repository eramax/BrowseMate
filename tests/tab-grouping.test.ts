import { describe, it, expect } from 'vitest';
import { planGroups } from '../src/background/tab-grouping';

const tabs = [
  { id: 1, title: 'Pinned AI', url: 'https://perplexity.ai', pinned: true, windowId: 1 },
  { id: 2, title: 'LinkedIn', url: 'https://linkedin.com/jobs', pinned: false, windowId: 1 },
  { id: 3, title: 'Qliro', url: 'https://qliro.com/jobs', pinned: false, windowId: 1 },
  { id: 4, title: 'Extensions', url: 'chrome://extensions', pinned: false, windowId: 1 },
  { id: 5, title: 'GitHub', url: 'https://github.com/ripienaar/free-for-dev', pinned: false, windowId: 2 },
];

describe('planGroups', () => {
  it('excludes pinned tabs by default', () => {
    const [g] = planGroups([{ title: 'Jobs', tabIds: [1, 2, 3] }], tabs);
    expect(g.eligible.map((t) => t.id)).toEqual([2, 3]);
    expect(g.skippedPinned.map((t) => t.id)).toEqual([1]);
  });

  it('includes pinned tabs only when includePinned is true', () => {
    const [g] = planGroups([{ title: 'Jobs', tabIds: [1, 2] }], tabs, true);
    expect(g.eligible.map((t) => t.id)).toEqual([1, 2]);
    expect(g.skippedPinned).toHaveLength(0);
  });

  it('skips browser-internal URLs and reports missing ids', () => {
    const [g] = planGroups([{ title: 'Mixed', tabIds: [2, 4, 99] }], tabs);
    expect(g.eligible.map((t) => t.id)).toEqual([2]);
    expect(g.skippedUnsupported.map((t) => t.id)).toEqual([4]);
    expect(g.missing).toEqual([99]);
  });

  it('explains when all tabs are pinned or unsupported', () => {
    const [pinned] = planGroups([{ tabIds: [1] }], tabs);
    expect(pinned.error).toBe('ALL_PINNED');
    const [unsupported] = planGroups([{ tabIds: [4] }], tabs);
    expect(unsupported.error).toBe('UNSUPPORTED_TABS');
  });

  it('keeps windows separate when grouping', () => {
    const [g] = planGroups([{ title: 'Dev', tabIds: [2, 5] }], tabs);
    expect(g.eligible.map((t) => `${t.id}@${t.windowId}`)).toEqual(['2@1', '5@2']);
  });
});
