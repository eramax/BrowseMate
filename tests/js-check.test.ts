import { describe, it, expect } from 'vitest';
import { checkInlineScripts, checkInlineScriptsDetailed } from '../src/background/js-check';

describe('checkInlineScripts', () => {
  it('passes valid inline JS', () => {
    expect(checkInlineScripts('<script>const x = 1; console.log(x)</script>')).toEqual([]);
  });
  it('detects the real-world broken quotes', () => {
    const errs = checkInlineScripts("<script>const s = ''';</script>");
    expect(errs.length).toBe(1);
    expect(errs[0]).toMatch(/script #1/);
  });
  it('reports the absolute HTML line, the broken source line, and a hint', () => {
    const html = `<html>
<head><title>x</title></head>
<body>
<script>
const s = ''';</script>
</body></html>`;
    const issues = checkInlineScriptsDetailed(html);
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBe(5);
    expect(issues[0].source).toContain("const s = ''';");
    expect(issues[0].hint).toMatch(/ثلاث علامات/);
    expect(checkInlineScripts(html)[0]).toContain('HTML سطر 5');
  });
  it('counts lines correctly when the script is not on the first line', () => {
    const html = ['<body>', '<p>hi</p>', '<script>', 'let a = 1;', 'let b = ;', '</script>'].join('\n');
    const issues = checkInlineScriptsDetailed(html);
    expect(issues[0].line).toBe(5);
  });
  it('hints to delete an identity escape map instead of patching it char by char', () => {
    const html = `<script>\nconst esc = (s) => ({'&':'&','<':'<'}[s]) let x = 1;\n</script>`;
    const issues = checkInlineScriptsDetailed(html);
    expect(issues).toHaveLength(1);
    expect(issues[0].hint).toMatch(/احذف دالة escape/);
  });
  it('supports module scripts', () => {
    expect(checkInlineScripts('<script type="module">import x from "y"; x()</script>')).toEqual([]);
  });
  it('ignores external scripts and empty blocks', () => {
    expect(checkInlineScripts('<script src="https://cdn.example/x.js"></script><script></script>')).toEqual([]);
  });
});
