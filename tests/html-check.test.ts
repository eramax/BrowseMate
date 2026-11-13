import { describe, it, expect } from 'vitest';
import { repairHtml } from '../src/background/html-check';

describe('repairHtml', () => {
  it('fixes the real-world broken title (</meta> instead of </title>)', () => {
    const good = '<!doctype html><html><head><title>Todo</title></head><body><h1>x</h1></body></html>';
    const bad = '<!doctype html><html><head><title>Todo</meta><style>body{}</style></head><body><h1>Hi</h1></body></html>';
    const r = repairHtml(bad);
    expect(r.fatal).toEqual([]);
    expect(r.html).toContain('<title>Todo</title>');
    expect(r.html).not.toContain('</meta>');
    expect(r.repairs.length).toBeGreaterThan(0);
    expect(repairHtml(good).repairs).toEqual([]);
    expect(repairHtml(good).fatal).toEqual([]);
  });
  it('closes unclosed style/script and body/html', () => {
    const r = repairHtml('<html><head><style>body{</head><body><script>let a=1;');
    expect(r.fatal).toEqual([]);
    expect(r.html).toContain('</style>');
    expect(r.html).toContain('</script>');
    expect(r.html).toContain('</body>');
    expect(r.html).toContain('</html>');
  });
  it('flags missing body as fatal', () => {
    const r = repairHtml('<html><head><title>x</title></head></html>');
    expect(r.fatal.length).toBeGreaterThan(0);
  });
});
