// استخراج فقرات الصفحة القابلة للقراءة مع معرّفات ثابتة — مقتبس ومعدّل من Nova TTS
// الوكيل يرى هذه الفقرات ثم يختار ما يُقرأ. لا نقرأ الصفحة كاملة تلقائياً.

export interface ReaderBlock {
  id: string;
  element: HTMLElement | null;
  text: string;
  tag: string;
  heading?: string;
}

export interface OutlineItem {
  id: string;
  tag: string;
  text: string;
  chars: number;
  heading?: string;
}

export interface OutlineResult {
  title: string;
  url: string;
  lang: string;
  dir: string;
  total: number;
  chars: number;
  offset: number;
  maxBlocks: number;
  hasMore: boolean;
  blocks: OutlineItem[];
}

export interface ReadRequest {
  blockIds?: string[];
  fromBlockId?: string;
  toBlockId?: string;
  selector?: string;
  selection?: boolean;
  text?: string;
}

export interface ReadResult {
  blocks?: ReaderBlock[];
  error?: 'NO_TARGET' | 'NO_SELECTION' | 'NO_BLOCKS' | 'BAD_SELECTOR';
  message?: string;
}

const BLOCK_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE',
  'TD', 'TH', 'FIGCAPTION', 'PRE', 'DT', 'DD', 'CAPTION', 'ADDRESS', 'SUMMARY',
  'DIV', 'SECTION',
]);
// عناصر تحتوي على بلوكات أخرى: نتخطاها ونقرأ أبناءها لتجنّب التكرار
const CONTAINER_TAGS = new Set(['DIV', 'SECTION', 'LI', 'TD', 'TH', 'BLOCKQUOTE']);
const NESTED_BLOCK_SELECTOR = [...BLOCK_TAGS].map((t) => t.toLowerCase()).join(',') + ',ul,ol,table,figure';
const NARROW_BLOCK_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th,figcaption,pre,dt,dd';
const SKIP_TAGS = new Set([
  'NAV', 'FOOTER', 'ASIDE', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS',
  'FORM', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'IFRAME', 'VIDEO', 'AUDIO',
]);
const SKIP_ROLES = new Set([
  'navigation', 'banner', 'contentinfo', 'complementary', 'search',
  'menu', 'menubar', 'toolbar',
]);
const AD_CLASS = /(?:^|\s|[-_])(ad|ads|advert|sponsor|promo|sidebar|widget|menu|nav|footer|cookie|banner|social|share|related|recommended)(?:$|\s|[-_])/i;
const MAIN_SELECTORS = [
  'article', 'main', '[role="main"]', '#main', '#content',
  '.post-content', '.entry-content', '.article-body', '.markdown-body', '.bbWrapper',
];
const ID_ATTR = 'data-browsemate-block';
const PREFIX = 'bm-' + Math.random().toString(36).slice(2, 8) + '-';
let nextId = 0;

/** نص العنصر المرئي — innerText أدق، وtextContent احتياطي (jsdom/الصفحات القديمة) */
export function textOf(el: HTMLElement): string {
  const t = el.innerText;
  return typeof t === 'string' ? t : (el.textContent ?? '');
}

export function normalizeText(raw: string, preserveLines = false): string {
  const t = raw.replace(/\u00a0/g, ' ').replace(/\u200b/g, '');
  return preserveLines
    ? t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
    : t.replace(/\s+/g, ' ').trim();
}

function isHidden(el: HTMLElement): boolean {
  if (el.hidden || el.getAttribute('aria-hidden') === 'true') return true;
  try {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return true;
  } catch {
    /* بيئة اختبار بلا layout */
  }
  return false;
}

function shouldSkip(el: Element): boolean {
  if (SKIP_TAGS.has(el.tagName)) return true;
  if (el.getAttribute('aria-hidden') === 'true' || (el as HTMLElement).hidden) return true;
  const role = el.getAttribute('role');
  if (role && SKIP_ROLES.has(role)) return true;
  const cls = typeof el.className === 'string' ? el.className : '';
  if (cls && AD_CLASS.test(cls)) return true;
  if (el.id && AD_CLASS.test(el.id)) return true;
  return isHidden(el as HTMLElement);
}

function hasNestedBlock(el: Element): boolean {
  try {
    return el.querySelector(NESTED_BLOCK_SELECTOR) !== null;
  } catch {
    return false;
  }
}

/** أكبر حاوية محتوى مرئية — نتجنب القوائم والتذييل */
export function pickRoot(doc: Document): HTMLElement {
  const body = doc.body;
  let best: HTMLElement = body;
  let bestLen = 0;
  for (const sel of MAIN_SELECTORS) {
    let nodes: NodeListOf<Element>;
    try { nodes = doc.querySelectorAll(sel); } catch { continue; }
    for (const node of Array.from(nodes)) {
      const el = node as HTMLElement;
      if (isHidden(el)) continue;
      const len = normalizeText(textOf(el)).length;
      if (len > bestLen) { best = el; bestLen = len; }
    }
  }
  // لا نستبدل body بمقال صغير جداً
  if (best !== body && bestLen < 200) return body;
  return best;
}

function ensureId(el: HTMLElement): string {
  let id = el.getAttribute(ID_ATTR);
  if (!id || !id.startsWith('bm-')) {
    id = PREFIX + (++nextId);
    el.setAttribute(ID_ATTR, id);
  }
  return id;
}

function makeBlock(el: HTMLElement, text: string, heading?: string): ReaderBlock {
  return {
    id: ensureId(el),
    element: el,
    text,
    tag: el.tagName.toLowerCase(),
    ...(heading ? { heading } : {}),
  };
}

export function extractBlocks(doc: Document): {
  root: HTMLElement;
  blocks: ReaderBlock[];
  map: Map<string, ReaderBlock>;
  chars: number;
} {
  const root = pickRoot(doc);
  const blocks: ReaderBlock[] = [];
  const map = new Map<string, ReaderBlock>();
  let currentHeading = '';
  let chars = 0;
  if (isHidden(root)) return { root, blocks, map, chars };

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (shouldSkip(node as Element)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node = walker.currentNode as Element | null;
  while (node && blocks.length < 500 && chars < 80_000) {
    if (BLOCK_TAGS.has(node.tagName)) {
      if (CONTAINER_TAGS.has(node.tagName) && hasNestedBlock(node)) {
        node = walker.nextNode() as Element | null;
        continue;
      }
      const tag = node.tagName;
      const text = normalizeText(textOf(node as HTMLElement), tag === 'PRE');
      const minLen = tag === 'DIV' || tag === 'SECTION' ? 30 : 2;
      if (text.length >= minLen) {
        const isHeading = /^H[1-6]$/.test(tag);
        if (isHeading) currentHeading = text;
        const block = makeBlock(node as HTMLElement, text, isHeading ? text : currentHeading || undefined);
        blocks.push(block);
        map.set(block.id, block);
        chars += text.length;
      }
    }
    node = walker.nextNode() as Element | null;
  }

  return { root, blocks, map, chars };
}

function snippet(text: string, max = 180): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

export function getOutline(
  doc: Document,
  opts: { offset?: number; maxBlocks?: number; ids?: string[] } = {},
): OutlineResult {
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const maxBlocks = Math.min(200, Math.max(1, Math.floor(opts.maxBlocks ?? 120)));
  const extracted = extractBlocks(doc);

  let items: OutlineItem[];
  let total = extracted.blocks.length;

  if (opts.ids?.length) {
    items = opts.ids.slice(0, 50).map((id) => {
      const b = extracted.map.get(id);
      if (!b) return { id, tag: '?', text: '', chars: 0, missing: true } as OutlineItem & { missing: boolean };
      return {
        id: b.id,
        tag: b.tag,
        chars: b.text.length,
        text: b.text,
        ...(b.heading ? { heading: snippet(b.heading, 100) } : {}),
      };
    });
    total = items.length;
  } else {
    const slice = extracted.blocks.slice(offset, offset + maxBlocks);
    items = slice.map((b) => ({
      id: b.id,
      tag: b.tag,
      chars: b.text.length,
      text: snippet(b.text),
      ...(b.heading ? { heading: snippet(b.heading, 100) } : {}),
    }));
  }

  return {
    title: doc.title || '',
    url: doc.location?.href || '',
    lang: doc.documentElement.lang || '',
    dir: doc.documentElement.dir || '',
    total,
    chars: extracted.chars,
    offset,
    maxBlocks,
    hasMore: !opts.ids?.length && offset + items.length < extracted.blocks.length,
    blocks: items,
  };
}

function blockFromIdInDom(doc: Document, id: string): ReaderBlock | null {
  let el: Element | null = null;
  try {
    el = doc.querySelector(`[${ID_ATTR}="${cssEscape(id)}"]`);
  } catch {
    el = null;
  }
  if (!(el instanceof HTMLElement)) return null;
  const text = normalizeText(textOf(el), el.tagName === 'PRE');
  if (!text) return null;
  return { id, element: el, text, tag: el.tagName.toLowerCase() };
}

function cssEscape(s: string): string {
  const w = globalThis as any;
  if (w.CSS?.escape) return w.CSS.escape(s);
  return s.replace(/["\\]/g, '\\$&');
}

function selectionBlocks(doc: Document, blocks: ReaderBlock[]): ReadResult {
  const sel = doc.defaultView?.getSelection();
  if (!sel || sel.isCollapsed) return { error: 'NO_SELECTION', message: 'لا يوجد تحديد نص في الصفحة.' };
  const range = sel.getRangeAt(0);
  const chosen = blocks.filter((b) => {
    if (!b.element?.isConnected) return false;
    try { return range.intersectsNode(b.element); } catch { return false; }
  });
  if (chosen.length) return { blocks: chosen };

  const parent = sel.anchorNode?.parentElement ?? null;
  const el = parent?.closest(NARROW_BLOCK_SELECTOR) as HTMLElement | null;
  if (el) {
    const text = normalizeText(textOf(el), el.tagName === 'PRE');
    if (text) return { blocks: [makeBlock(el, text)] };
  }
  const text = sel.toString().trim();
  if (text) return { blocks: [{ id: 'selection', element: null, text, tag: 'selection' }] };
  return { error: 'NO_SELECTION', message: 'التحديد فارغ أو غير قابل للقراءة.' };
}

/** يحوّل طلب القراءة إلى بلوكات فعلية (عناصر + نص) */
export function resolveRead(doc: Document, req: ReadRequest): ReadResult {
  const extracted = extractBlocks(doc);

  if (req.blockIds?.length) {
    const out: ReaderBlock[] = [];
    const seen = new Set<string>();
    for (const id of req.blockIds) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const b = extracted.map.get(id) ?? blockFromIdInDom(doc, id);
      if (b) out.push(b);
    }
    return out.length ? { blocks: out } : { error: 'NO_BLOCKS', message: 'لم أجد الفقرات المطلوبة — أعد page_outline.' };
  }

  if (req.fromBlockId || req.toBlockId) {
    const from = req.fromBlockId ? extracted.blocks.findIndex((b) => b.id === req.fromBlockId) : 0;
    const to = req.toBlockId ? extracted.blocks.findIndex((b) => b.id === req.toBlockId) : extracted.blocks.length - 1;
    if (from < 0 || to < 0 || from > to) return { error: 'NO_BLOCKS', message: 'نطاق الفقرات غير صالح.' };
    const out = extracted.blocks.slice(from, to + 1);
    return out.length ? { blocks: out } : { error: 'NO_BLOCKS', message: 'النطاق فارغ.' };
  }

  if (req.selector) {
    let nodes: NodeListOf<Element>;
    try { nodes = doc.querySelectorAll(req.selector); }
    catch { return { error: 'BAD_SELECTOR', message: 'محدد CSS غير صالح.' }; }
    const out: ReaderBlock[] = [];
    for (const node of Array.from(nodes).slice(0, 100)) {
      const el = node as HTMLElement;
      if (isHidden(el)) continue;
      const text = normalizeText(textOf(el), el.tagName === 'PRE');
      if (text) out.push(makeBlock(el, text));
    }
    return out.length ? { blocks: out } : { error: 'NO_BLOCKS', message: 'المحدد لم يطابق نصاً قابلاً للقراءة.' };
  }

  if (req.selection) return selectionBlocks(doc, extracted.blocks);

  if (req.text?.trim()) {
    return { blocks: [{ id: 'text', element: null, text: req.text.trim(), tag: 'text' }] };
  }

  return { error: 'NO_TARGET', message: 'حدد blockIds أو نطاقاً أو selector أو selection أو text.' };
}
