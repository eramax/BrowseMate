import { describe, it, expect } from 'vitest';
import { applyEdits } from '../src/background/site-edit';

const html = '<h1>Hello</h1><p class="x">A</p><p class="x">A</p>';

describe('applyEdits', () => {
  it('applies a unique replacement', () => {
    const r = applyEdits(html, [{ oldText: 'Hello', newText: 'مرحبا' }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.html).toContain('مرحبا');
  });
  it('rejects ambiguous oldText unless all:true', () => {
    const bad = applyEdits(html, [{ oldText: '<p class="x">A</p>', newText: 'B' }]);
    expect(bad.ok).toBe(false);
    const good = applyEdits(html, [{ oldText: '<p class="x">A</p>', newText: '<p class="x">B</p>', all: true }]);
    expect(good.ok).toBe(true);
    if (good.ok) expect((good.html.match(/>B</g) ?? []).length).toBe(2);
  });
  it('fails cleanly when text is missing', () => {
    const r = applyEdits(html, [{ oldText: 'Nope', newText: 'X' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/لم أجد/);
  });
  it('applies multiple edits sequentially', () => {
    const r = applyEdits(html, [
      { oldText: 'Hello', newText: 'Hi' },
      { oldText: 'Hi', newText: 'Hey' },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.html).toContain('Hey');
  });
});
