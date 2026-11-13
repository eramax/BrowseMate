import { describe, it, expect } from 'vitest';
import { applyEdits, editOnce } from '../src/background/site-edit';

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

describe('editOnce (OpenCode-style edit)', () => {
  it('replaces a unique oldString', () => {
    const r = editOnce('a\nb\nc', 'b', 'B');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.html).toBe('a\nB\nc');
  });
  it('rejects ambiguous matches unless replaceAll', () => {
    const bad = editOnce('x x', 'x', 'y');
    expect(bad.ok).toBe(false);
    const good = editOnce('x x', 'x', 'y', true);
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.html).toBe('y y');
  });
  it('rejects missing oldString and no-op edits', () => {
    expect(editOnce('abc', 'zzz', 'y').ok).toBe(false);
    expect(editOnce('abc', 'a', 'a').ok).toBe(false);
  });
});
