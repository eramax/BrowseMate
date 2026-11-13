import { describe, it, expect } from 'vitest';
import { checkInlineScripts } from '../src/background/js-check';

describe('checkInlineScripts', () => {
  it('passes valid inline JS', () => {
    expect(checkInlineScripts('<script>const x = 1; console.log(x)</script>')).toEqual([]);
  });
  it('detects the real-world broken quotes', () => {
    const errs = checkInlineScripts("<script>const s = ''';</script>");
    expect(errs.length).toBe(1);
    expect(errs[0]).toMatch(/script #1/);
  });
  it('supports module scripts', () => {
    expect(checkInlineScripts('<script type="module">import x from "y"; x()</script>')).toEqual([]);
  });
  it('ignores external scripts and empty blocks', () => {
    expect(checkInlineScripts('<script src="https://cdn.example/x.js"></script><script></script>')).toEqual([]);
  });
});
