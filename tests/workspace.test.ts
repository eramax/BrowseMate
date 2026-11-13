import { describe, it, expect } from 'vitest';
import { createWorkspaceStore, composeHtml, safePath } from '../src/background/workspace';
import type { KV } from '../src/shared/storage';

function memKV(): KV {
  const m = new Map<string, unknown>();
  return {
    get: async (k) => m.get(k) as any,
    set: async (k, v) => { m.set(k, v); },
    remove: async (k) => { m.delete(k); },
    keys: async () => [...m.keys()],
  };
}

describe('workspace store', () => {
  it('writes, reads, appends and deletes files', async () => {
    const ws = createWorkspaceStore(memKV());
    await ws.writeFile('index.html', '<!doctype html>');
    await ws.writeFile('styles.css', 'body{}');
    await ws.appendFile('styles.css', '\nhtml{}');
    expect(await ws.readFile('styles.css')).toBe('body{}\nhtml{}');
    expect((await ws.listFiles()).map((f) => f.path)).toEqual(['index.html', 'styles.css']);
    await ws.deleteFile('index.html');
    expect(await ws.readFile('index.html')).toBeUndefined();
    expect((await ws.listFiles()).map((f) => f.path)).toEqual(['styles.css']);
  });

  it('tracks the entry file and resets', async () => {
    const ws = createWorkspaceStore(memKV());
    expect(await ws.getEntry()).toBe('index.html');
    await ws.setEntry('main.html');
    expect(await ws.getEntry()).toBe('main.html');
    await ws.writeFile('main.html', '<html></html>');
    await ws.reset();
    expect(await ws.getEntry()).toBe('index.html');
    expect(await ws.listFiles()).toEqual([]);
  });

  it('rejects paths that escape the workspace', () => {
    expect(() => safePath('../secret.txt')).toThrow();
    expect(() => safePath('a/../../b')).toThrow();
    expect(() => safePath('')).toThrow();
    expect(safePath('./styles.css')).toBe('styles.css');
    expect(safePath('/styles.css')).toBe('styles.css');
    expect(safePath('src\\app.js')).toBe('src/app.js');
  });
});

describe('composeHtml', () => {
  const files = {
    'index.html': `<!doctype html><html><head>
<link rel="stylesheet" href="styles.css">
<link rel="icon" href="favicon.ico">
</head><body>
<script src="app.js"></script>
<script src="https://cdn.example/lib.js"></script>
</body></html>`,
    'styles.css': 'body{color:red}',
    'app.js': 'console.log("ok")',
  };

  it('inlines local CSS/JS and keeps external/non-stylesheet links', () => {
    const r = composeHtml('index.html', files);
    expect(r.missing).toEqual([]);
    expect(r.inlined.sort()).toEqual(['app.js', 'styles.css']);
    expect(r.html).toContain('<style>\nbody{color:red}\n</style>');
    expect(r.html).toContain('<script>\nconsole.log("ok")\n</script>');
    expect(r.html).toContain('https://cdn.example/lib.js');
    expect(r.html).toContain('favicon.ico');
  });

  it('reports missing local files without crashing', () => {
    const r = composeHtml('index.html', { 'index.html': '<link rel="stylesheet" href="missing.css"><script src="missing.js"></script>' });
    expect(r.missing.sort()).toEqual(['missing.css', 'missing.js']);
    expect(r.html).toContain('missing.css');
  });

  it('preserves module/type attributes on inlined scripts', () => {
    const r = composeHtml('index.html', {
      'index.html': '<script type="module" src="./app.js"></script>',
      'app.js': 'export const x = 1;',
    });
    expect(r.html).toContain('<script type="module">');
    expect(r.html).toContain('export const x = 1;');
  });

  it('handles link tags with href before rel', () => {
    const r = composeHtml('index.html', {
      'index.html': '<link href="styles.css" rel="stylesheet">',
      'styles.css': 'a{}',
    });
    expect(r.html).toContain('<style>\na{}\n</style>');
  });

  it('returns missing entry when there is no index file', () => {
    const r = composeHtml('index.html', {});
    expect(r.missing).toEqual(['index.html']);
    expect(r.html).toBe('');
  });
});
