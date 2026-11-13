// مساحة عمل عامة لمشاريع الويب: ملفات متعددة + تجميع للمعاينة (بدون أي قالب تطبيق).
// التخزين عبر KV قابل للحقن (اختبارات) — والافتراضي chrome.storage.local.
import { chromeKV, type KV } from '../shared/storage';

export type Files = Record<string, string>;

const FILES_KEY = 'wsFiles';
const ENTRY_KEY = 'wsEntry';

export interface WorkspaceStore {
  getFiles: () => Promise<Files>;
  writeFile: (path: string, content: string) => Promise<void>;
  appendFile: (path: string, content: string) => Promise<void>;
  readFile: (path: string) => Promise<string | undefined>;
  deleteFile: (path: string) => Promise<void>;
  listFiles: () => Promise<Array<{ path: string; bytes: number }>>;
  reset: () => Promise<void>;
  getEntry: () => Promise<string>;
  setEntry: (path: string) => Promise<void>;
}

export function createWorkspaceStore(kv: KV): WorkspaceStore {
  const getFiles = async (): Promise<Files> => (await kv.get<Files>(FILES_KEY)) ?? {};

  const writeFile = async (path: string, content: string) => {
    const files = await getFiles();
    files[safePath(path)] = String(content ?? '');
    await kv.set(FILES_KEY, files);
  };

  const appendFile = async (path: string, content: string) => {
    const files = await getFiles();
    const p = safePath(path);
    files[p] = (files[p] ?? '') + String(content ?? '');
    await kv.set(FILES_KEY, files);
  };

  const readFile = async (path: string) => (await getFiles())[safePath(path)];

  const deleteFile = async (path: string) => {
    const files = await getFiles();
    const p = safePath(path);
    delete files[p];
    await kv.set(FILES_KEY, files);
    if ((await getEntry()) === p) {
      const next = Object.keys(files).sort()[0];
      await kv.set(ENTRY_KEY, next ?? 'index.html');
    }
  };

  const listFiles = async () => {
    const files = await getFiles();
    return Object.entries(files)
      .map(([path, content]) => ({ path, bytes: content.length }))
      .sort((a, b) => a.path.localeCompare(b.path));
  };

  const reset = async () => {
    await kv.set(FILES_KEY, {});
    await kv.set(ENTRY_KEY, 'index.html');
  };

  const getEntry = async () => (await kv.get<string>(ENTRY_KEY)) ?? 'index.html';
  const setEntry = async (path: string) => {
    await kv.set(ENTRY_KEY, safePath(path));
  };

  return { getFiles, writeFile, appendFile, readFile, deleteFile, listFiles, reset, getEntry, setEntry };
}

export const workspace = createWorkspaceStore(chromeKV);

/** مسار نسبي آمن داخل مساحة العمل (لا جذر مطلق، لا ..، لا شرطة مائلة أخيرة) */
export function safePath(p: string): string {
  const cleaned = String(p ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .trim();
  if (!cleaned || cleaned.endsWith('/') || cleaned.length > 200) throw new Error(`مسار غير صالح: ${p}`);
  if (cleaned.split('/').some((seg) => !seg || seg === '.' || seg === '..')) throw new Error(`مسار غير صالح: ${p}`);
  if (/[\0-\x1f]/.test(cleaned)) throw new Error(`مسار غير صالح: ${p}`);
  return cleaned;
}

export interface ComposeResult {
  html: string;
  missing: string[];
  inlined: string[];
}

function localTarget(ref: string): string | null {
  const raw = String(ref ?? '').trim();
  if (!raw || raw.startsWith('#')) return null;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) return null; // http:, https:, data:, blob:, mailto:...
  const clean = raw.split(/[?#]/)[0];
  try {
    return safePath(clean);
  } catch {
    return null;
  }
}

/** يجمع index.html مع CSS/JS المحلية داخل مستند واحد للمعاينة (روابط CDN تبقى كما هي) */
export function composeHtml(entry: string, files: Files): ComposeResult {
  const missing = new Set<string>();
  const inlined: string[] = [];
  const base = safePath(entry);
  let html = files[base];
  if (html === undefined) return { html: '', missing: [base], inlined };

  // <link rel="stylesheet" href="styles.css"> — أي ترتيب للسمات
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/\brel\s*=\s*["'][^"']*\bstylesheet\b/i.test(tag)) return tag;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    const target = href ? localTarget(href) : null;
    if (!target) return tag;
    if (files[target] === undefined) { missing.add(target); return tag; }
    inlined.push(target);
    return `<style>\n${files[target]}\n</style>`;
  });

  // <script src="app.js"></script> — مع الحفاظ على السمات الأخرى (type="module" مثلاً)
  html = html.replace(/<script\b([^>]*?)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, before, src, after) => {
    const target = localTarget(src);
    if (!target) return tag;
    if (files[target] === undefined) { missing.add(target); return tag; }
    inlined.push(target);
    const attrs = `${before ?? ''} ${after ?? ''}`.replace(/\s+/g, ' ').trim();
    return `<script${attrs ? ' ' + attrs : ''}>\n${files[target]}\n</script>`;
  });

  return { html, missing: [...missing], inlined };
}
