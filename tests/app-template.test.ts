import { describe, it, expect } from 'vitest';
import { renderTodoApp } from '../src/background/app-template';
import { checkInlineScripts } from '../src/background/js-check';

describe('renderTodoApp', () => {
  it('produces valid HTML/JS with no inline syntax errors', () => {
    const html = renderTodoApp({ lang: 'ar', title: 'مهامي' });
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('<title>مهامي</title>');
    expect(checkInlineScripts(html)).toEqual([]);
  });
  it('escapes user-visible strings', () => {
    const html = renderTodoApp({ title: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
  it('supports english + light theme + custom accent', () => {
    const html = renderTodoApp({ lang: 'en', theme: 'light', accent: '#22c55e', title: 'Tasks' });
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('--accent:#22c55e');
    expect(html).toContain('--bg:#f6f7fb');
  });
  it('does not contain innerHTML or escapeHtml patterns (avoids the old failure)', () => {
    const html = renderTodoApp({ lang: 'ar' });
    expect(html).not.toContain('innerHTML');
    expect(html).not.toContain('escapeHtml');
  });
});
