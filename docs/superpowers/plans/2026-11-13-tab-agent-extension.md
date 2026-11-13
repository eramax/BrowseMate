# Tab Agent — خطة تنفيذ إضافة كروم

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** إضافة كروم MV3 تعرض وكيل AI في side panel يتحكم في المتصفح (التبويب النشط، الجروبات، ملء الحقول، تلخيص، فحص كود، بحث أسعار) + نظام مهارات JSON — بدون backend.

**Architecture:** Service worker يحتوي حلقة الوكيل (AI SDK 5 + function calling) ومنفّذ أدوات بنمط MCP وطبقة موافقات؛ Svelte 5 side panel يتحدث معه عبر Port مع بث الأحداث؛ content script يُحقن عند الطلب لقراءة/تعديل الصفحات؛ chrome.debugger (CDP) لفحص الكود.

**Tech Stack:** TypeScript, Vite + @crxjs/vite-plugin, Svelte 5, `ai` + `@ai-sdk/openai-compatible`, `@localix-ai/flowdown`, zod, Vitest, highlight.js.

**Spec:** `docs/superpowers/specs/2026-11-13-browser-agent-extension-design.md`

---

## File Structure

```
grouping-tabs/
├── manifest (عبر vite.config.ts + crxjs)
├── package.json / tsconfig.json / vitest.config.ts
├── src/
│   ├── shared/
│   │   ├── types.ts            أنواع مشتركة (رسائل البروتوكول، Session، Skill، ToolDef)
│   │   ├── i18n.ts             قواميس ar/en + دالة t()
│   │   ├── template.ts         محرك {{param}} (نقي، قابل للاختبار)
│   │   └── storage.ts          غلاف chrome.storage.local قابل للحقن (للاختبار)
│   ├── background/
│   │   ├── index.ts            نقطة دخول SW: مستمعو الرسائل + Port
│   │   ├── llm.ts              createOpenAICompatible + listModels
│   │   ├── agent.ts            حلقة الوكيل streamText + fullStream
│   │   ├── approvals.ts        إدارة انتظار الموافقات
│   │   ├── sessions.ts         CRUD الجلسات + قص الحصة
│   │   ├── skills.ts           محرك تشغيل المهارات + CRUD ملفات JSON
│   │   ├── inject.ts           ضمان حقن content script
│   │   └── tools/
│   │       ├── registry.ts     تسجيل الأدوات + تحويلها لصيغة AI SDK tools
│   │       ├── page.ts         read_page, summarize_page, fill_fields, click_element
│   │       ├── tabs.ts         list_tabs, navigate, open_tab, close_tab, group_tabs
│   │       ├── inspect.ts      inspect_code (chrome.debugger)
│   │       ├── misc.ts         screenshot
│   │       └── skillTools.ts   run_skill, save_skill, list_skills, delete_skill
│   ├── content/
│   │   └── page-tools.ts       مستمع رسائل: read/fill/click + سجل عناصر
│   └── sidepanel/
│       ├── index.html / main.ts / app.css
│       ├── App.svelte
│       ├── lib/port.ts         اتصال Port مع SW
│       ├── lib/flowdown.ts     ربط mount() لعرض markdown متدفق
│       └── components/
│           ├── ChatView.svelte / Message.svelte / Composer.svelte
│           ├── ApprovalCard.svelte / SessionList.svelte / SettingsView.svelte / SkillList.svelte
├── tests/  (Vitest: template, sessions, skills engine, approvals)
└── docs/
```

---

### Task 1: هيكل المشروع والبناء الأول

**Files:** Create `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `src/sidepanel/index.html`, `src/sidepanel/main.ts`, `src/sidepanel/App.svelte`, `src/background/index.ts`, `.gitignore`

- [ ] **Step 1: إنشاء ملفات الإعداد**

`package.json`:
```json
{
  "name": "grouping-tabs",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@ai-sdk/openai-compatible": "^1.0.0",
    "@localix-ai/flowdown": "^0.14.0",
    "ai": "^5.0.0",
    "highlight.js": "^11.11.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@crxjs/vite-plugin": "^2.0.0",
    "@sveltejs/vite-plugin-svelte": "^6.0.0",
    "@tsconfig/svelte": "^5.0.4",
    "jsdom": "^26.0.0",
    "svelte": "^5.0.0",
    "tslib": "^2.8.1",
    "typescript": "^5.7.0",
    "vite": "^7.0.0",
    "vitest": "^3.0.0"
  }
}
```

`tsconfig.json`:
```json
{
  "extends": "@tsconfig/svelte/tsconfig.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["chrome", "vite/client"],
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src", "tests"]
}
```

`vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { crx } from '@crxjs/vite-plugin';

const manifest = {
  manifest_version: 3,
  name: 'Tab Agent',
  version: '0.1.0',
  side_panel: { default_path: 'src/sidepanel/index.html' },
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  permissions: ['sidePanel', 'tabs', 'tabGroups', 'storage', 'scripting', 'debugger', 'activeTab'],
  host_permissions: ['<all_urls>'],
  action: { default_title: 'Tab Agent' },
  icons: { '128': 'src/assets/icon128.png' },
  web_accessible_resources: [
    { resources: ['src/content/*'], matches: ['<all_urls>'] },
  ],
} as const;

export default defineConfig({
  plugins: [svelte(), crx({ manifest })],
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts'] },
});
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts'] },
});
```

`.gitignore`:
```
node_modules/
dist/
.vite/
```

نقطة دخول SW مؤقتة `src/background/index.ts`:
```ts
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});
```

`src/sidepanel/index.html`:
```html
<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Tab Agent</title></head>
  <body><div id="app"></div><script type="module" src="/src/sidepanel/main.ts"></script></body>
</html>
```

`src/sidepanel/main.ts`:
```ts
import { mount } from 'svelte';
import App from './App.svelte';
mount(App, { target: document.getElementById('app')! });
```

`src/sidepanel/App.svelte` (مؤقت):
```svelte
<main>Tab Agent — scaffold OK</main>
```

- [ ] **Step 2: إضافة أيقونة مؤقتة** — أي PNG 128×128 في `src/assets/icon128.png` (يُولَّد بأي صورة؛ يمكن placeholder).
- [ ] **Step 3: تثبيت الاعتماديات** — `npm install`
- [ ] **Step 4: تثبيت نوع chrome API** — `npm i -D @types/chrome`
- [ ] **Step 5: بناء** — `npm run build` → النتيجة: مجلد `dist/` بدون أخطاء.
- [ ] **Step 6: تحقق يدوي** — `chrome://extensions` → Developer mode → Load unpacked → `dist/` → أيقونة الإضافة تفتح side panel بمحتوى "scaffold OK".
- [ ] **Step 7: Commit** — `git add -A && git commit -m "chore: scaffold MV3 extension with Vite+CRXJS+Svelte5"`

---

### Task 2: الأنواع المشتركة و i18n

**Files:** Create `src/shared/types.ts`, `src/shared/i18n.ts`

- [ ] **Step 1: كتابة types.ts**

```ts
// src/shared/types.ts
export type Role = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;          // نص/ markdown
  ts: number;
  toolCalls?: ToolCallInfo[]; // للعرض فقط
}

export interface ToolCallInfo {
  name: string;
  args: unknown;
  status: 'running' | 'ok' | 'error' | 'refused';
  summary?: string;
}

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

// بروتوكول Port بين panel و SW
export type PanelToWorker =
  | { type: 'chat'; sessionId: string; text: string }
  | { type: 'approval-response'; id: string; approved: boolean }
  | { type: 'stop'; runId: string }
  | { type: 'session-switch'; sessionId: string };

export type WorkerToPanel =
  | { type: 'chat-started'; runId: string; sessionId: string }
  | { type: 'delta'; runId: string; text: string }
  | { type: 'tool-start'; runId: string; info: ToolCallInfo }
  | { type: 'tool-end'; runId: string; info: ToolCallInfo }
  | { type: 'plan'; runId: string; steps: string[] }
  | { type: 'skill-progress'; runId?: string; skill: string; step: number; total: number }
  | { type: 'approval-request'; id: string; tool: string; args: unknown; steps?: string[] }
  | { type: 'done'; runId: string }
  | { type: 'error'; runId?: string; message: string }
  | { type: 'session-data'; session: Session }
  | { type: 'sessions-list'; sessions: Array<Pick<Session, 'id' | 'title' | 'updatedAt'>> };

// تعريف أداة بنمط MCP
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema (للتوثيق/العرض الخارجي)
  sensitive: boolean;
  zod: never; // يُستبدل في التنفيذ بـ zod schema — راجع registry.ts
  execute: (args: any, ctx: ToolContext) => Promise<unknown>;
}

export interface ToolContext {
  getActiveTab: () => Promise<chrome.tabs.Tab>;
  emit: (evt: WorkerToPanel) => void;
  requestApproval: (tool: string, args: unknown, steps?: string[]) => Promise<boolean>;
}

// ملف مهارة
export interface SkillStep {
  tool: string;
  args: Record<string, unknown>;
  approval?: boolean;
}
export interface SkillParam {
  name: string;
  type: 'string' | 'number';
  required?: boolean;
}
export interface SkillFile {
  name: string;            // معرف بالـ kebab-case
  description: string;
  params: SkillParam[];
  steps: SkillStep[];
}
```

- [ ] **Step 2: كتابة i18n.ts** — قاموسان `ar` و `en` يغطيان مفاتيح الواجهة (`chat.placeholder`, `settings.title`, `approve`, `refuse`, `sessions.new`, `skills.title`…~25 مفتاحاً) + دالة:
```ts
export type Lang = 'ar' | 'en';
export const dict = { ar: {...}, en: {...} } as const;
export function t(lang: Lang, key: keyof typeof dict.ar): string { return dict[lang][key]; }
export function isRtl(lang: Lang) { return lang === 'ar'; }
```
اللغة تُحفظ في `chrome.storage.local` تحت `lang` (افتراضي `ar`).

- [ ] **Step 3: Commit** — `git add -A && git commit -m "feat: shared types and i18n dictionaries"`

---

### Task 3: محرك قوالب {{param}} (TDD)

**Files:** Create `src/shared/template.ts`, `tests/template.test.ts`

- [ ] **Step 1: اختبار فاشل**

```ts
// tests/template.test.ts
import { describe, it, expect } from 'vitest';
import { substitute } from '../src/shared/template';

describe('substitute', () => {
  it('replaces {{var}} inside strings', () => {
    expect(substitute({ url: 'https://x.com/search?q={{q}}' }, { q: 'oneplus 16' }))
      .toEqual({ url: 'https://x.com/search?q=oneplus 16' });
  });
  it('deep substitution in nested args', () => {
    const args = { a: { b: ['{{x}}', 1] } };
    expect(substitute(args, { x: 'v' })).toEqual({ a: { b: ['v', 1] } });
  });
  it('coerces number when whole value is a single var and param type is number', () => {
    expect(substitute({ page: '{{p}}' }, { p: { value: '3', type: 'number' } })).toEqual({ page: 3 });
  });
  it('keeps string when embedded', () => {
    expect(substitute({ s: 'page {{p}}' }, { p: { value: '3', type: 'number' } })).toEqual({ s: 'page 3' });
  });
  it('leaves unknown vars untouched', () => {
    expect(substitute({ s: '{{nope}}' }, {})).toEqual({ s: '{{nope}}' });
  });
});
```

- [ ] **Step 2: تشغيل** — `npm test` → FAIL (module not found).
- [ ] **Step 3: التنفيذ**

```ts
// src/shared/template.ts
import type { SkillParam } from './types';

export type ParamValue = { value: string | number; type?: SkillParam['type'] };
export type Params = Record<string, ParamValue>;

const VAR = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g;

export function substitute<T>(args: T, params: Params): T {
  return walk(args, params);
}
function walk(v: unknown, params: Params): unknown {
  if (typeof v === 'string') {
    const m = v.trim().match(/^\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}$/);
    if (m && params[m[1]] && params[m[1]].type === 'number') return Number(params[m[1]].value);
    return v.replace(VAR, (_, name) => (params[name] ? String(params[name].value) : `{{${name}}}`));
  }
  if (Array.isArray(v)) return v.map((x) => walk(x, params));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = walk(val, params);
    return out;
  }
  return v;
}
```

- [ ] **Step 4: تشغيل** — `npm test` → PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: skill template substitution engine"`

---

### Task 4: غلاف التخزين + مخزن الجلسات (TDD)

**Files:** Create `src/shared/storage.ts`, `src/background/sessions.ts`, `tests/sessions.test.ts`

- [ ] **Step 1: storage.ts** — غلاف حقن-الاعتمادية:

```ts
// src/shared/storage.ts
export interface KV {
  get: <T>(key: string) => Promise<T | undefined>;
  set: (key: string, value: unknown) => Promise<void>;
  remove: (key: string) => Promise<void>;
  keys: () => Promise<string[]>;
}
export const chromeKV: KV = {
  get: async (k) => (await chrome.storage.local.get(k))[k],
  set: async (k, v) => { await chrome.storage.local.set({ [k]: v }); },
  remove: async (k) => { await chrome.storage.local.remove(k); },
  keys: async () => Object.keys(await chrome.storage.local.get(null)),
};
```

- [ ] **Step 2: اختبار فاشل للجلسات**

```ts
// tests/sessions.test.ts
import { describe, it, expect } from 'vitest';
import { createSessionStore } from '../src/background/sessions';

function memKV(): KV { const m = new Map(); return {
  get: async (k) => m.get(k), set: async (k, v) => { m.set(k, v); },
  remove: async (k) => { m.delete(k); }, keys: async () => [...m.keys()],
}; }

describe('sessions store', () => {
  it('creates session, appends message, lists by recency', async () => {
    const s = createSessionStore(memKV());
    const s1 = await s.create('my chat');
    await s.append(s1.id, { id: 'm1', role: 'user', content: 'hi', ts: 1 });
    const list = await s.list();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('my chat');
    expect((await s.get(s1.id))!.messages).toHaveLength(1);
  });
  it('caps messages per session (200) with a trim marker, iterates oldest sessions first', async () => {
    const s = createSessionStore(memKV());
    const a = await s.create('old'); const b = await s.create('new');
    for (let i = 0; i < 250; i++) await s.append(b.id, { id: `m${i}`, role: 'user', content: 'x'.repeat(100), ts: i });
    await s.append(a.id, { id: 'a1', role: 'user', content: 'y', ts: 1 });
    await s.enforceQuota();
    expect((await s.get(b.id))!.messages.length).toBeLessThanOrEqual(200);
    expect((await s.get(b.id))!.messages[0].content.startsWith('[trimmed]')).toBe(true);
    expect((await s.get(a.id))!.messages).toHaveLength(1);
  });
});
```

- [ ] **Step 3: تشغيل** — `npm test` → FAIL.
- [ ] **Step 4: التنفيذ**

```ts
// src/background/sessions.ts
import type { Session, ChatMessage } from '../shared/types';
import type { KV } from '../shared/storage';

const PREFIX = 'session:';
export const MAX_MSGS_PER_SESSION = 200;

export function createSessionStore(kv: KV) {
  const get = async (id: string): Promise<Session | undefined> => kv.get(PREFIX + id);
  return {
    async create(title: string): Promise<Session> {
      const s: Session = { id: crypto.randomUUID(), title, createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
      await kv.set(PREFIX + s.id, s); return s;
    },
    get,
    async list() {
      const out: Array<Pick<Session, 'id' | 'title' | 'updatedAt'>> = [];
      for (const k of await kv.keys()) if (k.startsWith(PREFIX)) {
        const s = await kv.get<Session>(k); if (s) out.push({ id: s.id, title: s.title, updatedAt: s.updatedAt });
      }
      return out.sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async append(id: string, msg: ChatMessage) {
      const s = await get(id); if (!s) throw new Error(`session ${id} not found`);
      s.messages.push(msg); s.updatedAt = Date.now();
      await kv.set(PREFIX + id, s);
    },
    async update(id: string, patch: Partial<Session>) {
      const s = await get(id); if (!s) throw new Error('not found');
      await kv.set(PREFIX + id, { ...s, ...patch, updatedAt: Date.now() });
    },
    async remove(id: string) { await kv.remove(PREFIX + id); },
    async enforceQuota() {
      const all = (await this.list()).map((x) => x.id);
      for (const id of all) {
        const s = await get(id); if (!s || s.messages.length <= MAX_MSGS_PER_SESSION) continue;
        const cut = s.messages.length - MAX_MSGS_PER_SESSION;
        s.messages = [{ id: 'trim', role: 'system', content: `[trimmed] ${cut} earlier messages removed`, ts: Date.now() },
          ...s.messages.slice(cut)];
        await kv.set(PREFIX + id, s);
      }
    },
  };
}
export type SessionStore = ReturnType<typeof createSessionStore>;
```

- [ ] **Step 5: تشغيل** — `npm test` → PASS.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: storage wrapper and session store with quota trimming"`

---

### Task 5: عميل LLM والإعدادات

**Files:** Create `src/background/llm.ts`, `src/background/settings.ts`, `src/sidepanel/components/SettingsView.svelte`

- [ ] **Step 1: settings.ts**

```ts
// src/background/settings.ts
import { chromeKV } from '../shared/storage';
export interface Settings { baseUrl: string; apiKey: string; model: string; lang: 'ar' | 'en' }
const DEFAULTS: Settings = { baseUrl: '', apiKey: '', model: '', lang: 'ar' };
export async function loadSettings(): Promise<Settings> {
  return { ...DEFAULTS, ...await chromeKV.get<Partial<Settings>>('settings') };
}
export async function saveSettings(patch: Partial<Settings>) {
  await chromeKV.set('settings', { ...DEFAULTS, ...await loadSettings(), ...patch });
}
```

- [ ] **Step 2: llm.ts**

```ts
// src/background/llm.ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { loadSettings } from './settings';

export async function makeProvider() {
  const { baseUrl, apiKey, model } = await loadSettings();
  if (!baseUrl || !apiKey || !model) throw new Error('SETTINGS_MISSING');
  const provider = createOpenAICompatible({ name: 'provider', baseURL: baseUrl, apiKey });
  return { provider: provider.chatModel(model), model };
}

export async function listModels(): Promise<string[]> {
  const { baseUrl, apiKey } = await loadSettings();
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`models fetch failed: ${res.status}`);
  const data = await res.json();
  return (data.data ?? data.models ?? []).map((m: any) => m.id).filter(Boolean).sort();
}
```

- [ ] **Step 3: SettingsView.svelte** — نموذج يعرض/يحفظ baseUrl وapiKey (password input) وزر "جلب النماذج" يعبّئ `<select>` من `listModels()` واختيار النموذج + تبديل اللغة. استدعاء SW عبر `chrome.runtime.sendMessage({type:'list-models'})` (يُضاف معالجه في Task 9 أو الآن مؤقتاً في index.ts). رسائل خطأ تظهر داخل الصفحة.
- [ ] **Step 4: تحقق يدوي** — `npm run build` ينجح، panel يعرض نموذج الإعدادات؛ مع مزود حقيقي: حفظ الإعدادات وجلب النماذج يملأ القائمة.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: settings storage, openai-compatible provider, models listing"`

---

### Task 6: content script أدوات الصفحة

**Files:** Create `src/content/page-tools.ts`, `src/background/inject.ts`

- [ ] **Step 1: page-tools.ts**

```ts
// src/content/page-tools.ts
interface Elem { id: string; tag: string; kind: 'input' | 'button' | 'link' | 'other'; label: string; placeholder?: string; value?: string; }

const registry = new Map<string, HTMLElement>();
let nextId = 1;

function labelOf(el: HTMLElement): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria;
  if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) return l.textContent?.trim() ?? ''; }
  const inner = el.closest('label'); if (inner) return inner.textContent?.trim() ?? '';
  const ph = (el as HTMLInputElement).placeholder; if (ph) return ph;
  return el.textContent?.trim().slice(0, 60) ?? '';
}

function collectInteractive(): Elem[] {
  const out: Elem[] = [];
  const sel = 'input, textarea, select, button, a[href], [role="button"]';
  document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
    if (!el.offsetParent && el.tagName !== 'A') return; // تخطي المخفي (selects داخل <select>)
    const kind = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ? 'input'
      : el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' ? 'button' : el.tagName === 'A' ? 'link' : 'other';
    const id = `ta-${nextId++}`;
    el.setAttribute('data-ta-id', id);
    registry.set(id, el);
    out.push({ id, tag: el.tagName.toLowerCase(), kind,
      label: labelOf(el), placeholder: (el as HTMLInputElement).placeholder || undefined,
      value: (el as HTMLInputElement).value || undefined });
  });
  return out.slice(0, 200);
}

chrome.runtime.onMessage.addListener((msg: any, _s, send) => {
  if (msg.__ta !== 'page-tools') return;
  (async () => {
    if (msg.op === 'read') {
      const text = document.body.innerText.replace(/\n{3,}/g, '\n\n').slice(0, 6000);
      send({ ok: true, data: { title: document.title, url: location.href, text, elements: collectInteractive() } });
    } else if (msg.op === 'fill') {
      for (const { id, value } of msg.values) {
        const el = registry.get(id) as HTMLInputElement | undefined;
        if (!el) { send({ ok: false, error: `element ${id} not found` }); return; }
        el.focus();
        (el as any).value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.blur();
      }
      send({ ok: true, data: { filled: msg.values.length } });
    } else if (msg.op === 'click') {
      const el = msg.id ? registry.get(msg.id)
        : [...document.querySelectorAll<HTMLElement>('button, a[href], [role="button"]')]
            .find((e) => (e.textContent?.trim() || e.getAttribute('aria-label') || '').includes(msg.label));
      if (!el) { send({ ok: false, error: 'element not found' }); return; }
      el.scrollIntoView({ block: 'center' });
      el.click();
      send({ ok: true, data: { clicked: true } });
    }
  })();
  return true; // async response
});
```

- [ ] **Step 2: inject.ts**

```ts
// src/background/inject.ts
export async function ensureInjected(tabId: number) {
  try {
    await chrome.tabs.sendMessage(tabId, { __ta: 'page-tools', op: 'ping' });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content/page-tools.ts'] });
  }
}
export function sendToPage<T>(tabId: number, op: string, extra: Record<string, unknown> = {}): Promise<{ ok: boolean; data?: T; error?: string }> {
  return chrome.tabs.sendMessage(tabId, { __ta: 'page-tools', op, ...extra });
}
```

- [ ] **Step 3: تحقق يدوي** — بناء، فتح أي صفحة عادية، من console الخاص بالـ service worker: `chrome.scripting` حقن يدوي واختبار op=read.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: content script page tools (read/fill/click) with element registry"`

---

### Task 7: سجل الأدوات (نمط MCP)

**Files:** Create `src/background/tools/registry.ts`, `src/background/tools/page.ts`, `src/background/tools/tabs.ts`, `src/background/tools/misc.ts`

- [ ] **Step 1: registry.ts**

```ts
// src/background/tools/registry.ts
import { z } from 'zod';
import type { ToolContext } from '../../shared/types';

export interface RegisteredTool {
  name: string;
  description: string;
  sensitive: boolean;
  schema: z.ZodTypeAny;         // مدخل AI SDK
  jsonSchema: Record<string, unknown>; // صيغة MCP للعرض/التصدير
  execute: (args: any, ctx: ToolContext) => Promise<unknown>;
}

const tools = new Map<string, RegisteredTool>();
export function register(t: RegisteredTool) { tools.set(t.name, t); }
export function getTool(name: string) { return tools.get(name); }
export function allTools() { return [...tools.values()]; }

/** بناء أدوات AI SDK مع بوابة الموافقة للأدوات الحساسة */
export function asAISDKTools(ctx: ToolContext): Record<string, any> {
  const out: Record<string, any> = {};
  for (const t of allTools()) {
    out[t.name] = {
      description: t.description,
      inputSchema: t.schema,
      execute: async (args: any) => {
        if (t.sensitive) {
          const ok = await ctx.requestApproval(t.name, args);
          if (!ok) return { error: 'REFUSED_BY_USER', message: 'المستخدم رفض هذا الإجراء الحساس — أعد التخطيط أو اسأل.' };
        }
        return t.execute(args, ctx);
      },
    };
  }
  return out;
}
```

- [ ] **Step 2: page.ts** — أدوات الصفحة الأربع (read_page غير حساسة؛ fill_fields و click_element حساسان):

```ts
// src/background/tools/page.ts
import { z } from 'zod';
import { register } from './registry';
import { ensureInjected, sendToPage } from '../inject';
import type { ToolContext } from '../../shared/types';

async function activeTab(ctx: ToolContext) { return ctx.getActiveTab(); }

register({
  name: 'read_page',
  description: 'يقرأ التبويب النشط: العنوان، URL، نص مقتضب، والعناصر التفاعلية (حقول/أزرار/روابط بمعرفات ta-N).',
  sensitive: false,
  schema: z.object({}),
  jsonSchema: { type: 'object', properties: {} },
  execute: async (_a, ctx) => {
    const tab = await activeTab(ctx);
    await ensureInjected(tab.id!);
    return sendToPage(tab.id!, 'read');
  },
});

register({
  name: 'summarize_page',
  description: 'يستخرج نص المقال من التبويب النشط ويجمعه في سياقك لكي تلخصه في ردك.',
  sensitive: false,
  schema: z.object({}),
  jsonSchema: { type: 'object', properties: {} },
  execute: async (_a, ctx) => {
    const tab = await activeTab(ctx);
    await ensureInjected(tab.id!);
    return sendToPage(tab.id!, 'read');
  },
});

register({
  name: 'fill_fields',
  description: 'يملأ حقول النموذج في التبويب النشط. مرر قيمًا مرتبطة بمعرفات العناصر من read_page.',
  sensitive: true,
  schema: z.object({ values: z.array(z.object({ id: z.string(), value: z.string() })).min(1) }),
  jsonSchema: { type: 'object', required: ['values'], properties: { values: { type: 'array', items: { type: 'object', required: ['id', 'value'], properties: { id: { type: 'string' }, value: { type: 'string' } } } } } },
  execute: async (a, ctx) => {
    const tab = await activeTab(ctx);
    await ensureInjected(tab.id!);
    return sendToPage(tab.id!, 'fill', { values: a.values });
  },
});

register({
  name: 'click_element',
  description: 'ينقر عنصرًا في التبويب النشط بمعرفه ta-N أو بجزء من نصه.',
  sensitive: true,
  schema: z.object({ id: z.string().optional(), label: z.string().optional() }),
  jsonSchema: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' } } },
  execute: async (a, ctx) => {
    const tab = await activeTab(ctx);
    await ensureInjected(tab.id!);
    return sendToPage(tab.id!, 'click', { id: a.id, label: a.label });
  },
});
```

- [ ] **Step 3: tabs.ts** — الأدوات الخمس:

```ts
// src/background/tools/tabs.ts
import { z } from 'zod';
import { register } from './registry';

register({
  name: 'list_tabs',
  description: 'يعرض كل النوافذ والتبويبات وحالتها (مجموعة/غير مجمع).',
  sensitive: false, schema: z.object({}),
  jsonSchema: { type: 'object', properties: {} },
  execute: async () => (await chrome.tabs.query({})).map((t) => ({ id: t.id, title: t.title, url: t.url, groupId: t.groupId, active: t.active })),
});

register({
  name: 'navigate',
  description: 'ينقل التبويب النشط إلى رابط وينتظر اكتمال التحميل.',
  sensitive: true,
  schema: z.object({ url: z.string().url() }),
  jsonSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string' } } },
  execute: async (a, ctx) => {
    const tab = await ctx.getActiveTab();
    await chrome.tabs.update(tab.id!, { url: a.url });
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(done); resolve(); }, 15000); // مهلة أمان
      const done = (tabId: number, info: chrome.tabs.TabChangeInfo) => {
        if (tabId === tab.id && info.status === 'complete') { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(done); resolve(); }
      };
      chrome.tabs.onUpdated.addListener(done);
    });
    return { navigated: a.url };
  },
});

register({
  name: 'open_tab', description: 'يفتح تبويبًا جديدًا في الخلفية.',
  sensitive: true, schema: z.object({ url: z.string().url(), active: z.boolean().optional() }),
  jsonSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string' }, active: { type: 'boolean' } } },
  execute: async (a) => chrome.tabs.create({ url: a.url, active: a.active ?? false }),
});

register({
  name: 'close_tab', description: 'يغلق تبويبًا بمعرفه.',
  sensitive: true, schema: z.object({ tabId: z.number() }),
  jsonSchema: { type: 'object', required: ['tabId'], properties: { tabId: { type: 'number' } } },
  execute: async (a) => { await chrome.tabs.remove(a.tabId); return { closed: a.tabId }; },
});

register({
  name: 'group_tabs', description: 'ينشئ مجموعة تبويبات باسم ولون، أو يضيف تبويبات لمجموعة قائمة.',
  sensitive: false,
  schema: z.object({ tabIds: z.array(z.number()).min(1), title: z.string().optional(), color: z.enum(['grey','blue','red','yellow','green','pink','purple','cyan','orange']).optional() }),
  jsonSchema: { type: 'object', required: ['tabIds'], properties: { tabIds: { type: 'array', items: { type: 'number' } }, title: { type: 'string' }, color: { type: 'string', enum: ['grey','blue','red','yellow','green','pink','purple','cyan','orange'] } } },
  execute: async (a) => {
    const groupId = await chrome.tabs.group({ tabIds: a.tabIds });
    await chrome.tabGroups.update(groupId, { title: a.title, color: a.color });
    return { groupId, title: a.title };
  },
});
```

- [ ] **Step 4: misc.ts — screenshot**

```ts
// src/background/tools/misc.ts
import { z } from 'zod';
import { register } from './registry';
register({
  name: 'screenshot', description: 'لقطة للتبويب النشط (dataURL) للتأكد من حالة الصفحة.',
  sensitive: false, schema: z.object({}),
  jsonSchema: { type: 'object', properties: {} },
  execute: async (_a, ctx) => {
    const tab = await ctx.getActiveTab();
    return { dataUrl: await chrome.tabs.captureVisibleTab(tab.windowId!, { format: 'png' }) };
  },
});
```

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: MCP-style tool registry with page, tab, screenshot tools"`

---

### Task 8: إدارة الموافقات (TDD)

**Files:** Create `src/background/approvals.ts`, `tests/approvals.test.ts`

- [ ] **Step 1: اختبار فاشل**

```ts
// tests/approvals.test.ts
import { describe, it, expect } from 'vitest';
import { createApprovalManager } from '../src/background/approvals';

describe('approval manager', () => {
  it('resolves when panel approves', async () => {
    const m = createApprovalManager();
    const p = m.request('navigate', { url: 'x' });
    const req = m.pending();
    expect(req).toHaveLength(1);
    m.resolve(req[0].id, true);
    await expect(p).resolves.toBe(true);
  });
  it('refusal resolves false', async () => {
    const m = createApprovalManager();
    const p = m.request('navigate', { url: 'x' });
    m.resolve(m.pending()[0].id, false);
    await expect(p).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: تشغيل** — `npm test` → FAIL.
- [ ] **Step 3: التنفيذ**

```ts
// src/background/approvals.ts
export interface PendingApproval { id: string; tool: string; args: unknown; steps?: string[] }
export function createApprovalManager() {
  const pending = new Map<string, { p: Promise<boolean>; res: (ok: boolean) => void; info: PendingApproval }>();
  return {
    request(tool: string, args: unknown, steps?: string[]): Promise<boolean> {
      const id = crypto.randomUUID();
      let res!: (ok: boolean) => void;
      const p = new Promise<boolean>((r) => (res = r));
      pending.set(id, { p, res, info: { id, tool, args, steps } });
      return p;
    },
    pending(): PendingApproval[] { return [...pending.values()].map((x) => x.info); },
    resolve(id: string, ok: boolean) {
      const e = pending.get(id); if (!e) return false;
      pending.delete(id); e.res(ok); return true;
    },
  };
}
```

- [ ] **Step 4: تشغيل** — `npm test` → PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: approval manager"`

---

### Task 9: حلقة الوكيل + نقطة دخول SW

**Files:** Create `src/background/agent.ts`; Modify `src/background/index.ts`

- [ ] **Step 1: agent.ts**

```ts
// src/background/agent.ts
import { streamText, stepCountIs } from 'ai';
import { makeProvider } from './llm';
import { asAISDKTools } from './tools/registry';
import type { ChatMessage, PanelToWorker, WorkerToPanel, Session } from '../shared/types';
import type { SessionStore } from './sessions';

export interface AgentDeps {
  sessions: SessionStore;
  emit: (sessionId: string, evt: WorkerToPanel) => void;
  getActiveTab: () => Promise<chrome.tabs.Tab>;
  approvals: { request: (tool: string, args: unknown, steps?: string[]) => Promise<boolean> };
  runs: Map<string, AbortController>;
}

const SYSTEM = `أنت وكيل متصفح داخل إضافة كروم. تتحكم بالتبويب النشط عبر الأدوات المتاحة.
القواعد:
- اشرح خطتك باختصار قبل التنفيذ (سطران كحد أقصى) — ستظهر كمعلنة خطة للموافقة المجمعة.
- اقرأ الصفحة (read_page) قبل أي تعديل للحصول على معرفات العناصر.
- لا تكرر أداة فشلت بنفس الوسائط؛ غيّر النهج واسأل المستخدم عند الحاجة.
- الردود markdown بالعربية (أو لغة المستخدم).`;

export async function runChat(deps: AgentDeps, sessionId: string, userText: string) {
  const runId = crypto.randomUUID();
  const ac = new AbortController(); deps.runs.set(runId, ac);
  const { provider } = await makeProvider();
  const session = await deps.sessions.get(sessionId);
  if (!session) throw new Error('session not found');

  const tab = await deps.getActiveTab();
  deps.emit(sessionId, { type: 'chat-started', runId, sessionId });

  const history = [...session.messages, { id: runId, role: 'user' as const, content: userText, ts: Date.now() }];
  await deps.sessions.append(sessionId, history[history.length - 1]);

  const ctx = {
    getActiveTab: deps.getActiveTab,
    emit: (e: WorkerToPanel) => deps.emit(sessionId, e),
    requestApproval: (tool: string, args: unknown, steps?: string[]) => {
      deps.emit(sessionId, { type: 'approval-request', id: crypto.randomUUID(), tool, args, steps });
      // ملاحظة: يُستبدل لاحقًا بالربط مع approvals manager (Step 3)
      return deps.approvals.request(tool, args, steps);
    },
  };

  let full = '';
  try {
    const result = streamText({
      model: provider,
      system: SYSTEM + `\n\nسياق التبويب النشط الآن: title="${tab.title}", url="${tab.url}"`,
      abortSignal: ac.signal,
      stopWhen: stepCountIs(15),
      messages: history.map((m) => ({ role: m.role, content: m.content })),
      tools: asAISDKTools(ctx),
    });
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') { full += part.text; deps.emit(sessionId, { type: 'delta', runId, text: part.text }); }
      else if (part.type === 'tool-call') deps.emit(sessionId, { type: 'tool-start', runId, info: { name: part.toolName, args: part.input, status: 'running' } });
      else if (part.type === 'tool-result') {
        const info = { name: part.toolName, args: part.input, status: 'ok' as const };
        deps.emit(sessionId, { type: 'tool-end', runId, info });
        if (part.toolName === 'run_skill') {
          const r: any = part.output;
          if (r?.planSteps) deps.emit(sessionId, { type: 'plan', runId, steps: r.planSteps });
        }
      }
    }
    await deps.sessions.append(sessionId, { id: crypto.randomUUID(), role: 'assistant', content: full, ts: Date.now() });
    deps.emit(sessionId, { type: 'done', runId });
  } catch (e: any) {
    if (ac.signal.aborted) { deps.emit(sessionId, { type: 'done', runId }); return; }
    // إعادة محاولة بتراجع أسي للـ 429/5xx
    if (/429|5\d\d/.test(String(e?.message))) {
      await retryWithBackoff(() => runOnce(deps, sessionId, runId, provider, history, ac.signal));
      return;
    }
    deps.emit(sessionId, { type: 'error', runId, message: friendlyError(e) });
    if (full) await deps.sessions.append(sessionId, { id: crypto.randomUUID(), role: 'assistant', content: full + `\n\n> ⚠️ ${friendlyError(e)}`, ts: Date.now() });
  } finally {
    deps.runs.delete(runId);
  }
}

function friendlyError(e: any): string {
  if (e?.message === 'SETTINGS_MISSING') return 'أكمل الإعدادات أولاً: Base URL + API key + النموذج.';
  return `خطأ: ${e?.message ?? String(e)}`;
}
async function retryWithBackoff(fn: () => Promise<void>, tries = 3) {
  for (let i = 0; i < tries; i++) { try { return await fn(); } catch { await new Promise((r) => setTimeout(r, 1000 * 2 ** i)); } }
}
// runOnce: نفس جسم streamText أعلاه مستخرج لدالة (تُنفَّذ بالنسخ المعاملتين عند التنفيذ)
```

- [ ] **Step 2: تفكيك runOnce فعلياً** — أثناء التنفيذ: استخرج كود streamText إلى دالة `runOnce(deps, sessionId, runId, provider, history, signal)` واجعل `runChat` يستدعيها مباشرة (لا تكرار كود).
- [ ] **Step 2b: تنفيذ planArmed في ctx** — داخل `runOnce` أنشئ `let planArmed = false` و `planApproved: Promise<boolean> | null = null`؛ وctx يُبنى كالتالي:
```ts
const ctx = {
  getActiveTab: deps.getActiveTab,
  emit: (e) => deps.emit(sessionId, e),
  signal: ac.signal,
  requestApproval: async (tool: string, args: unknown, steps?: string[]) => {
    if (planArmed) return true; // خطة معتمدة تغطي الأدوات الحساسة لهذا run
    if (tool === 'plan') {
      const ok = await deps.approvals.request('plan', { steps }, steps, (info) =>
        deps.emit(sessionId, { type: 'approval-request', id: info.id, tool: 'plan', args: { steps }, steps }));
      if (ok) planArmed = true;
      return ok;
    }
    return deps.approvals.request(tool, args, steps, (info) =>
      deps.emit(sessionId, { type: 'approval-request', id: info.id, tool, args, steps }));
  },
};
```
وفي حلقة البث: عند ظهور `::plan ... ::endplan` كاملاً في النص المتراكم، استخرج الخطوات وأرسل `{type:'plan'}` ثم نفّذ `await ctx.requestApproval('plan', {steps}, steps)` (يُحلّ أثناء أول انتظار موافقة/أداة). ونزّع الوسم من النص المعروض. أضف `signal?: AbortSignal` إلى `ToolContext` في types.ts.
- [ ] **Step 3: ربط approvals بالـ emit + آلية الموافقة المجمعة للخطط** — في index.ts: عند `'approval-request'` emit للـ panel، وعند `approval-response` استدعِ `approvalsManager.resolve`. يجب أن يمرر ctx.requestApproval **معرف الطلب** المولد في approvals manager بدل UUID جديد — عدّل `requestApproval` في approvals.ts ليستقبل callback `notify(info)`:
```ts
// في agent.ts (الصيغة الصحيحة):
requestApproval: (tool, args, steps) =>
  deps.approvals.request(tool, args, steps, (info) =>
    deps.emit(sessionId, { type: 'approval-request', id: info.id, tool, args, steps })),
```
```ts
// في approvals.ts — التوقيع يصبح:
request(tool, args, steps?, notify?: (info: PendingApproval) => void)
  // يستدعي notify(info) بعد التسجيل
```

**موافقة الخطة المجمعة (خطط الوكيل المعلنة نصياً):**
- SYSTEM prompt يوجّه الوكيل: عند التخطيط لعمل حساس متعدد الخطوات، ابدأ ردك بوسم:
```
::plan
خطوة أولى
خطوة ثانية
::endplan
```
- في حلقة البث (fullStream): عند اكتمال أول `::plan ... ::endplan` في نص الرد، استخرج الأسطر، أرسل `{type:'plan', runId, steps}` إلى الـ panel، واطلب **موافقة مجمعة واحدة** عبر `approvals.request('plan', {steps}, steps)` — لا تنفذ أي أداة حساسة قبل حلّها (احجز أول استدعاء حساس مؤقتاً: إذا جاء tool-call حساس قبل حل الموافقة، انتظره).
- **تسليح الخطة**: عند الموافقة، ضع `planArmed = true` لهذا run؛ كل استدعاء حساس لاحق في نفس run يتخطى البوابة الفردية (يعود كأنه `"ok"`). عند الرفض: `planArmed = false` والوكيل يرى `REFUSED_BY_USER` في أول أداة حساسة.
- الوسم لا يعرض للمستخدم نصاً خاماً — يرندر كبطاقة خطة (Task 10/11)، و`::plan` يُنزع من النص المعروض.
- هذا يغطي سيناريو المواصفة §4: "خطة + موافقة مجمعة + navigate/read متكرر" لحلقة بحث الأسعار بدون مهارة محفوظة.
- [ ] **Step 4: index.ts الكامل**

```ts
// src/background/index.ts
import { loadSettings, saveSettings } from './settings';
import { listModels } from './llm';
import { createSessionStore } from './sessions';
import { createApprovalManager } from './approvals';
import { runChat } from './agent';
import { chromeKV } from '../shared/storage';
import './tools/page'; import './tools/tabs'; import './tools/misc';
import './tools/skillTools'; import './tools/inspect';

const sessions = createSessionStore(chromeKV);
const approvals = createApprovalManager();
const runs = new Map<string, AbortController>();
const ports = new Map<string, chrome.runtime.Port>(); // per session
let activeSessionId = '';

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'panel') return;
  ports.set(port.name, port);
  port.onMessage.addListener(async (msg: PanelToWorker) => {
    if (msg.type === 'chat') {
      activeSessionId = msg.sessionId;
      runChat({ sessions, emit, getActiveTab, approvals, runs }, msg.sessionId, msg.text).catch((e) =>
        emit(msg.sessionId, { type: 'error', message: String(e) }));
    } else if (msg.type === 'approval-response') approvals.resolve(msg.id, msg.approved);
    else if (msg.type === 'stop') { const ac = [...runs.values()][0]; ac?.abort(); }
    else if (msg.type === 'session-switch') activeSessionId = msg.sessionId;
  });
});

function emit(sessionId: string, evt: any) { ports.get('panel')?.postMessage({ ...evt, sessionId }); }

chrome.runtime.onMessage.addListener((msg: any, _s, send) => {
  (async () => {
    if (msg.type === 'list-models') { try { send({ ok: true, models: await listModels() }); } catch (e: any) { send({ ok: false, error: e.message }); } }
    else if (msg.type === 'save-settings') { await saveSettings(msg.patch); send({ ok: true }); }
    else if (msg.type === 'get-settings') send({ ok: true, settings: await loadSettings() });
    else if (msg.type === 'ensure-session') {
      let id = (await sessions.list())[0]?.id;
      if (!id) id = (await sessions.create('جلسة جديدة')).id;
      send({ ok: true, id });
    }
    else if (msg.type === 'get-session') send({ ok: true, session: await sessions.get(msg.id) });
    else if (msg.type === 'list-sessions') send({ ok: true, sessions: await sessions.list() });
    else if (msg.type === 'new-session') {
      const s = await sessions.create(msg.title || 'جلسة جديدة');
      send({ ok: true, session: s });
    }
  })();
  return true;
});

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
```

- [ ] **Step 5: بناء** — `npm run build` → نجاح.
- [ ] **Step 6: اختبار تكاملي يدوي** — مع مزود حقيقي: اكتب في الشات "لخص هذه الصفحة" → يظهر streaming للرد، و"اقرأ الصفحة" → يظهر tool-start/tool-end في الواجهة (مؤقتاً نص خام).
- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: agent loop with streaming, tool calls and approvals wiring"`

---

### Task 10: واجهة الشات (Svelte 5 + Flowdown)

**Files:** Create `src/sidepanel/lib/port.ts`, `src/sidepanel/lib/flowdown.ts`, `src/sidepanel/components/{Message,Composer,ChatView}.svelte`; Modify `App.svelte`

- [ ] **Step 1: port.ts**

```ts
// src/sidepanel/lib/port.ts
import type { PanelToWorker, WorkerToPanel } from '../../shared/types';

export function openPanelPort(onEvent: (e: WorkerToPanel) => void) {
  const port = chrome.runtime.connect({ name: 'panel' });
  port.onMessage.addListener(onEvent);
  return {
    send: (msg: PanelToWorker) => port.postMessage(msg),
    disconnect: () => port.disconnect(),
  };
}
export function rpc<T>(type: string, extra: Record<string, unknown> = {}): Promise<T> {
  return chrome.runtime.sendMessage({ type, ...extra });
}
```

- [ ] **Step 2: flowdown.ts** — ربط mount() لكل رسالة assistant:

```ts
// src/sidepanel/lib/flowdown.ts
import { mount } from '@localix-ai/flowdown/dom';
import hljs from 'highlight.js/lib/common';
import 'highlight.js/styles/github.css';

export type FlowView = ReturnType<typeof mount> & { update: (t: string, o?: any) => void };
export function attach(el: HTMLElement, text = '', streaming = false): FlowView {
  const view = mount(el);
  view.update(text, { streaming, highlight: (code: string, lang: string) =>
    lang && hljs.getLanguage(lang) ? hljs.highlight(code, { language: lang }).value : code });
  return view as FlowView;
}
```

- [ ] **Step 3: Message.svelte** — يعرض رسالة user كفقرة، وassistant عبر Flowdown (RTL: `dir` حسب اللغة)، مع قائمة toolCalls مصغّرة (اسم + حالة ✓/✗) وبطاقة الخطة عند وجود `plan`. **ملاحظة**: قبل التعميم، افحص API الحزمة المثبتة (`node_modules/@localix-ai/flowdown/dist/*.d.ts`) — إن اختلفت توقيعات `mount/update` عن المفترض أعلاه كيّف الربط مع الواقع؛ الفصل في `flowdown.ts` يوجد لذلك تحديداً.
- [ ] **Step 4: Composer.svelte** — textarea + زر إرسال (Enter يرسل، Shift+Enter سطر)، وزر إيقاف أثناء البث (يرسل `{type:'stop'}`)، placeholder من i18n.
- [ ] **Step 5: ChatView.svelte** — قائمة رسائل مع auto-scroll لأسفل، يستهلك أحداث Port: `delta` يلحق النص بالرسالة الحية (Flowdown view.update(text, {streaming:true}))، `done` يثبتها، `error` يعرض رسالة. زر "إعادة المحاولة" على آخر رسالة خطأ (يعيد إرسال آخر رسالة مستخدم).
- [ ] **Step 6: App.svelte** — tabs (شات / جلسات / مهارات / إعدادات) + سجل الجلسة النشطة في `$state`، عند الإقلاع: `ensure-session` ثم `get-session` وعرض السجل.
- [ ] **Step 7: تحقق يدوي** — streaming حقيقي يظهر مرسوماً بـ Flowdown مع RTL عربي، كتل كود ملونة.
- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat: chat UI with Flowdown streaming, composer and stop button"`

---

### Task 11: بطاقات الموافقة + الجلسات UI

**Files:** Create `src/sidepanel/components/{ApprovalCard,SessionList}.svelte`; Modify `ChatView.svelte`

- [ ] **Step 1: ApprovalCard.svelte** — يعرض `approval-request`: اسم الأداة + args (JSON منسق) + عند وجود `steps`: قائمة خطوات + عنوان "موافقة على التسلسل كاملاً". زرا "موافقة" / "رفض" يرسلان `{type:'approval-response', id, approved}`. عند وجود أكثر من طلب معلق تُعرض دفعة واحدة بأزرار "موافقة على الكل".
- [ ] **Step 2: SessionList.svelte** — قائمة الجلسات (الأحدث أولاً) + زر "جلسة جديدة" + حذف. التبديل يرسل `session-switch` ويطلب `get-session`.
- [ ] **Step 3: ربط ChatView** — أثناء الانتظار على موافقة: يظهر الـ card مكان المؤشر. رفض = إظهار ملاحظة "رفضت — الوكيل سيعيد التخطيط".
- [ ] **Step 4: تحقق يدوي** — "اذهب إلى example.com" → بطاقة موافقة → موافقة → تنقل فعلي. سيناريو "خطط للبحث عن أسعار oneplus 16 في ثلاثة مواقع" → بطاقة مجمعة بخطوات.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: approval cards (single and batch) and sessions UI"`

---

### Task 12: فحص الكود عبر chrome.debugger

**Files:** Create `src/background/tools/inspect.ts`

- [ ] **Step 1: inspect_code** — يرفق debugger (CDP Runtime + Network + Log) ويجمع: أخطاء console (Runtime.consoleAPICalled + Log.entryAdded)، طلبات الشبكة (url + status + type، بدون بodies في MVP)، قائمة سكربتات الصفحة (Runtime.getScriptSource عند الطلب فقط لسكربت واحد بمعرف):

```ts
// src/background/tools/inspect.ts
import { z } from 'zod';
import { register } from './registry';

interface Ctx { console: string[]; requests: { url: string; status?: number; type: string }[]; scripts: string[] }

register({
  name: 'inspect_code',
  description: 'يفحص التبويب النشط: أخطاء console، طلبات الشبكة، وقائمة السكربتات. اختياريًا يجلب مصدر سكربت واحد.',
  sensitive: false,
  schema: z.object({ scriptId: z.string().optional() }),
  jsonSchema: { type: 'object', properties: { scriptId: { type: 'string' } } },
  execute: async (a, ctx) => {
    const tab = await ctx.getActiveTab();
    const debugId = { tabId: tab.id! };
    const c: Ctx = { console: [], requests: [], scripts: [] };
    await chrome.debugger.attach(debugId, '1.3');
    try {
      await chrome.debugger.sendCommand(debugId, 'Runtime.enable');
      await chrome.debugger.sendCommand(debugId, 'Log.enable');
      await chrome.debugger.sendCommand(debugId, 'Network.enable');
      chrome.debugger.onEvent.addListener(function onEvent(src, method, params: any) {
        if (src.tabId !== tab.id) return;
        if (method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(params.type))
          c.console.push(`${params.type}: ${params.args.map((x: any) => x.value ?? x.description).join(' ')}`);
        else if (method === 'Log.entryAdded') c.console.push(`${params.entry.level}: ${params.entry.text}`);
        else if (method === 'Network.responseReceived') c.requests.push({ url: params.response.url, status: params.response.status, type: params.type });
        else if (method === 'Runtime.scriptParsed') c.scripts.push({ id: params.scriptId, url: params.url } as any);
      });
      await chrome.debugger.sendCommand(debugId, 'Runtime.evaluate', { expression: 'void 0' }); // نبضة لجمع الموجود
      await sleep(500);
      if (a.scriptId) {
        const src: any = await chrome.debugger.sendCommand(debugId, 'Runtime.getScriptSource', { scriptId: a.scriptId });
        return { ...c, source: src?.scriptSource?.slice(0, 20000) };
      }
      return c;
    } finally {
      chrome.debugger.onEvent.removeListener(onEvent as any);
      await chrome.debugger.detach(debugId).catch(() => {});
    }
  },
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
```

- [ ] **Step 2: سؤال الكود في الشات** — لا كود إضافي: "ما كود هذا الزر ولماذا لا يعمل؟" → الوكيل يستدعي inspect_code ثم يرد بتحليل.
- [ ] **Step 3: تحقق يدوي** — صفحة فيها خطأ JS عمداً → "ما أخطاء هذه الصفحة؟" → الرد يذكر الخطأ الفعلي.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: inspect_code tool via chrome.debugger (console/network/scripts)"`

---

### Task 13: محرك المهارات (TDD) + أدوات المهارات

**Files:** Create `src/background/skills.ts`, `tests/skills.test.ts`, `src/background/tools/skillTools.ts`; Modify `src/background/index.ts` (معالج `import-skill`)

- [ ] **Step 1: اختبار فاشل للمحرك**

```ts
// tests/skills.test.ts
import { describe, it, expect } from 'vitest';
import { runSkill, validateSkill } from '../src/background/skills';

const skill = {
  name: 'test-skill', description: 'd', params: [{ name: 'q', type: 'string', required: true }],
  steps: [
    { tool: 'navigate', args: { url: 'https://x.com/?q={{q}}' } },
    { tool: 'read_page', args: {} },
  ],
};

describe('skill engine', () => {
  it('validates params and schema', () => {
    expect(validateSkill(skill)).toBeNull();
    expect(validateSkill({ ...skill, steps: [] })).toMatch(/steps/);
    expect(validateSkill({ ...skill, params: [{ name: 'bad name!', type: 'string' }] })).toMatch(/name/);
  });
  it('runs steps in order, substitutes params, aggregates results, stops on failure', async () => {
    const calls: any[] = [];
    const reg = new Map([
      ['navigate', { execute: async (a: any) => { calls.push(['navigate', a]); return { ok: true }; } }],
      ['read_page', { execute: async (a: any) => { calls.push(['read_page', a]); return { title: 't' }; } }],
    ]);
    const r = await runSkill(skill, { q: 'oneplus 16' }, {
      getTool: (n: string) => reg.get(n),
      emit: () => {},
      isSensitive: () => false,
      requestApproval: async () => true,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0][1].url).toBe('https://x.com/?q=oneplus 16');
    expect(r.ok).toBe(true);
    expect(r.results).toHaveLength(2);
    expect(r.results[1].result).toEqual({ title: 't' });
  });
  it('missing required param fails before running', async () => {
    const r = await runSkill(skill, {}, { getTool: () => undefined, emit: () => {}, isSensitive: () => false, requestApproval: async () => true });
    expect(r.ok).toBe(false); expect(r.error).toMatch(/q/);
  });
});
```

- [ ] **Step 2: تشغيل** — `npm test` → FAIL.
- [ ] **Step 3: التنفيذ**

```ts
// src/background/skills.ts
import type { SkillFile } from '../shared/types';
import { substitute, Params } from '../shared/template';

export function validateSkill(s: SkillFile): string | null {
  if (!s.name || !/^[a-z0-9-]+$/.test(s.name)) return 'name: kebab-case فقط';
  if (!Array.isArray(s.steps) || s.steps.length === 0) return 'steps: يجب أن تحتوي خطوة واحدة على الأقل';
  for (const p of s.params ?? []) if (!/^[a-zA-Z0-9_-]+$/.test(p.name)) return `param name غير صالح: ${p.name}`;
  return null;
}

export interface SkillRunDeps {
  getTool: (name: string) => { execute: (args: any, ctx: any) => Promise<unknown> } | undefined;
  emit: (evt: unknown) => void;
  isSensitive: (tool: string) => boolean;
  requestApproval: (tool: string, args: unknown, steps?: string[]) => Promise<boolean>;
  signal?: AbortSignal; // إلغاء المستخدم أثناء التشغيل
}

export async function runSkill(skill: SkillFile, params: Record<string, unknown>, deps: SkillRunDeps) {
  const missing = (skill.params ?? []).filter((p) => p.required && !(p.name in params));
  if (missing.length) return { ok: false, error: `معاملات ناقصة: ${missing.map((m) => m.name).join(', ')}`, results: [] };
  const typed: Params = {};
  for (const [k, v] of Object.entries(params)) typed[k] = { value: v as any, type: skill.params?.find((p) => p.name === k)?.type };
  const results: Array<{ step: number; tool: string; args: unknown; result?: unknown; error?: string; ts: number }> = [];
  for (let i = 0; i < skill.steps.length; i++) {
    if (deps.signal?.aborted) return { ok: false, error: 'ألغى المستخدم', results };
    const step = skill.steps[i];
    const args = substitute(step.args, typed) as Record<string, unknown>;
    const tool = deps.getTool(step.tool);
    if (!tool) return { ok: false, error: `أداة غير معروفة: ${step.tool}`, results };
    const needsApproval = step.approval === true || deps.isSensitive(step.tool);
    if (needsApproval && !(await deps.requestApproval(step.tool, args, skill.steps.map((s) => s.tool)))) {
      return { ok: false, error: 'ألغى المستخدم', results, results2: undefined };
    }
    try {
      const result = await tool.execute(args, {} as any);
      results.push({ step: i, tool: step.tool, args, result, ts: Date.now() });
      deps.emit({ type: 'skill-progress', skill: skill.name, step: i + 1, total: skill.steps.length });
    } catch (e: any) {
      return { ok: false, error: e?.message ?? String(e), results };
    }
  }
  return { ok: true, results };
}
```

- [ ] **Step 4: تشغيل** — `npm test` → PASS (احذف حقل `results2` الزائد إن ظهر من النسخ أعلاه).
**Fix 2 — تقدم المهارات يصل للـ panel:** في `skillTools.ts` مرر `emit` الحقيقي من ToolContext (أضف `emit: (evt) => void` إلى `ToolContext` — موجود فعلاً) بدل `() => {}`:
```ts
emit: (evt) => ctx.emit(evt as WorkerToPanel),
```
وفي `runSkill` مرر runId ضمن الحدث، وفي ChatView.svelte أضف سطر تقدم حي "خطوة 2/3: جاري القراءة…" يظهر أثناء عمل مهارة ويختفي عند done.

- [ ] **Step 5: skillTools.ts** — أربع أدوات:

```ts
// src/background/tools/skillTools.ts
import { z } from 'zod';
import { register, getTool, allTools } from './registry';
import { runSkill, validateSkill } from '../skills';
import { chromeKV } from '../../shared/storage';
import type { SkillFile, ToolContext } from '../../shared/types';

const skillKV = {
  async all(): Promise<Record<string, SkillFile>> { return (await chromeKV.get('skills')) ?? {}; },
  async save(s: SkillFile) { const all = await this.all(); all[s.name] = s; await chromeKV.set('skills', all); },
  async remove(name: string) { const all = await this.all(); delete all[name]; await chromeKV.set('skills', all); },
};

register({
  name: 'run_skill', description: 'ينفذ مهارة محفوظة بالاسم مع معاملاتها ويعيد نتائج كل الخطوات.',
  sensitive: false,
  schema: z.object({ name: z.string(), params: z.record(z.string(), z.union([z.string(), z.number()])).optional() }),
  jsonSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, params: { type: 'object' } } },
  execute: async (a, ctx: ToolContext) => {
    const skill = (await skillKV.all())[a.name];
    if (!skill) return { error: `مهارة غير موجودة: ${a.name}` };
    const planSteps = skill.steps.map((s) => s.tool);
    const ok = await ctx.requestApproval(a.name, { params: a.params }, planSteps); // موافقة مجمعة
    if (!ok) return { error: 'REFUSED_BY_USER' };
    return { ...(await runSkill(skill, a.params ?? {}, {
      getTool, emit: (evt: any) => ctx.emit({ ...evt, runId: undefined }),
      isSensitive: (t) => allTools().find((x) => x.name === t)?.sensitive ?? false,
      requestApproval: async () => true, // بوابة الدفعة تغطي الخطوات (وفق المواصفة)
      signal: ctx.signal,
    })), planSteps };
  },
});

register({
  name: 'save_skill', description: 'يحفظ مهارة JSON (بعد التحقق) من خطوات إجراء ناقشه المستخدم. استخرج الأدوات والوسائط من المحادثة.',
  sensitive: false,
  schema: z.object({ skill: z.any() }),
  jsonSchema: { type: 'object', required: ['skill'], properties: { skill: { type: 'object' } } },
  execute: async (a) => {
    const err = validateSkill(a.skill);
    if (err) return { error: err };
    await skillKV.save(a.skill);
    return { saved: a.skill.name };
  },
});

register({
  name: 'list_skills', description: 'يسرد المهارات المحفوظة (اسم ووصف ومعاملات).',
  sensitive: false, schema: z.object({}), jsonSchema: { type: 'object', properties: {} },
  execute: async () => Object.values(await skillKV.all()).map((s) => ({ name: s.name, description: s.description, params: s.params })),
});

register({
  name: 'delete_skill', description: 'يحذف مهارة بالاسم.',
  sensitive: true, schema: z.object({ name: z.string() }), jsonSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
  execute: async (a) => { await skillKV.remove(a.name); return { deleted: a.name }; },
});
```

- [ ] **Step 6: SkillList.svelte** — تبويب في الـ panel يعرض المهارات من `list_skills` مع أزرار "تشغيل" (يملأ params من حقول نصية ثم يرسل رسالة شات `شغّل المهارة <name> بمعاملات …`) و"حذف"، وزر "استيراد JSON" (لصق + حفظ عبر save_settings-نمط رسالة جديدة `import-skill` في index.ts تستدعي validateSkill ثم تحفظ).
- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: skill engine (run/validate) and skill tools with UI"`

---

### Task 14: توليد مهارة من محادثة + إكمال التكامل

**Files:** Modify `src/background/agent.ts` (SYSTEM prompt), `src/sidepanel/components/SkillList.svelte`

- [ ] **Step 1: تعليمات التوليد في SYSTEM** — أضف إلى SYSTEM:
```
عندما يطلب المستخدم حفظ إجراء كمهارة: استخرج تسلسل الأدوات التي نفذتها للتو (أو الخطوات المخططة) في ملف JSON يطابق { name (kebab-case), description, params, steps:[{tool,args,approval?}] } واستدعِ save_skill. اعرض JSON على المستخدم للتأكيد قبل الحفظ. قواعد args: وسائط ثابتة، وقيم المتغيرة كـ {{param}} داخل النصوص.
```
- [ ] **Step 2: تحقق يدوي** — نفّذ "اذهب إلى example.com واقرأ العنوان" ثم "احفظ هذا كمهارة اسمها check-site" → الوكيل يقترح JSON → "وافق" → تظهر في قائمة المهارات → "شغّل check-site" تعمل.
- [ ] **Step 3: Commit** — `git add -A && git commit -m "feat: agent-generated skills from conversation"`

---

### Task 15: متانة الأخطاء + فحص يدوي نهائي

**Files:** Modify `src/background/inject.ts`, `src/background/agent.ts`

- [ ] **Step 1: إعادة الحقن والرسائل الودية** — في inject.ts: التقط فشل `sendMessage` بعد الحقن الأولي وأعد الحقن مرة واحدة (للصفحات المُعاد تحميلها). في agent.ts: عند `chrome.debugger` المرفوض أعد كأداة فشلت برسالة `{ error: 'DEBUGGER_DENIED' }` (المواقع المقيدة chrome:// وغيرها).
- [ ] **Step 2: اختبار وحدة نهائي** — `npm test` → كل الاختبارات خضراء (template, sessions, approvals, skills).
- [ ] **Step 3: بناء نهائي** — `npm run build` → نجاح بدون تحذيرات حرجة.
- [ ] **Step 4: قائمة فحص يدوية (كلها تمر):**
  - [ ] ملء نموذج حقيقي (بحث جوجل مثلاً): "اكتب hello في حقل البحث واضغط زر البحث" → بطاقة موافقة → تنفيذ فعلي.
  - [ ] تلخيص مقال في صفحة إخبارية.
  - [ ] "ما أخطاء console في هذه الصفحة؟" على صفحة فيها خطأ.
  - [ ] "ابحث عن سعر oneplus 16 في نوفا ويب" → خطة + موافقة مجمعة + navigate/read متكرر + رد بأسعار.
  - [ ] "جمّع تبويباتي المفتوحة في جروبات حسب الموضوع" → group_tabs فعلي.
  - [ ] جلسة جديدة ↔ تبديل بين جلستين؛ المحتوى محفوظ.
  - [ ] إنشاء/تشغيل/حذف مهارة؛ استيراد JSON.
  - [ ] رفض إجراء حساس → الوكيل يعيد التخطيط ولا يكسر الجلسة.
  - [ ] تبديل اللغة عربي↔إنجليزي يقلب الاتجاه RTL/LTR والنصوص.
  - [ ] انقطاع الشبكة أثناء البث → رسالة خطأ + زر إعادة محاولة يعمل.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "chore: error hardening and final manual verification"`

---

## ملاحظات للمنفذ

- واجهات chrome.* غير قابلة للاختبار في Vitest — كل المنطق القابل للاختبار معزول في `shared/` و `skills.ts` و `approvals.ts` و `sessions.ts` (حقن الاعتماديات).
- إصدارات الحزم أعلاه أقرب تقدير؛ استخدم الأحدث المتاح (`npm view <pkg> version`) واحتفظ بـ API: AI SDK v5 (`streamText`, `stepCountIs`, `fullStream`، `tool-call`/`tool-result` في الأحداث، `input`/`output` في v5 بدل args/result).
- إن فشل CRXJS مع Vite المثبت: الثابت المعروف هو اقتران إصدار plugin بإصدار Vite — جرّب أحدث `@crxjs/vite-plugin` مع Vite 6/7، والبديل المخطط: Vite multi-entry يدوي بدون crxjs (انظر المواصفة §8).
- التزم بالمواصفة: عقد نتيجة run_skill، دقة الموافقات (§4)، حدود التخزين (§8).
