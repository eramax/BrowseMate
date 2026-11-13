import { describe, it, expect } from 'vitest';
import { applyEdits, applyEditsPartial, editOnce } from '../src/background/site-edit';

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


describe('partial edits + nearby', () => {
  const text = '.a { color: red; }\n.b { color: blue; }\n.c { color: green; }';

  it('keeps successful edits and reports the failed one with nearby text', () => {
    const r = applyEditsPartial(text, [
      { oldText: '.a { color: red; }', newText: '.a { color: gray; }' },
      { oldText: '.b {\n  color: purple;\n}', newText: '.b { color: gray; }' },
      { oldText: '.c { color: green; }', newText: '.c { color: #333; }' },
    ]);
    expect(r.applied).toBe(2);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].index).toBe(1);
    expect(r.failed[0].nearby).toContain('.b { color: blue; }');
    expect(r.html).toContain('.a { color: gray; }');
    expect(r.html).toContain('.c { color: #333; }');
    expect(r.html).toContain('.b { color: blue; }');
  });

  it('returns the actual nearby block for an atomic missing edit', () => {
    const r = applyEdits('.task-checkbox:checked {\n  background: gray;\n}', [
      { oldText: '.task-checkbox:checked {\n  background: purple;\n}', newText: '.task-checkbox:checked {\n  background: black;\n}' },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.nearby).toContain('background: gray;');
  });

  it('returns nearby for a missing single edit', () => {
    const r = editOnce(text, '.b {\n  color: purple;\n}', '.b { color: gray; }');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.nearby).toContain('.b { color: blue; }');
  });
});
