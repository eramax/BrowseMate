// الإشارة إلى موضع في الصفحة دون تعديل DOM — CSS Custom Highlight API
// يستخدمه الوكيل ليقول "هنا" أو لتظليل نص/عناصر قبل أو أثناء القراءة.

export interface PointRequest {
  text?: string;
  blockIds?: string[];
  selector?: string;
  color?: string;
  all?: boolean;
  scroll?: boolean;
}

export interface PointResult {
  count: number;
  mode: 'text' | 'blocks' | 'selector';
  fallback?: boolean;
}

const HIGHLIGHT_NAME = 'bm-reader-point';
const STYLE_ID = 'bm-reader-point-styles';
const EL_CLASS = 'bm-reader-point-el';
const SKIP_SELECTOR = 'script,style,noscript,svg,canvas';
let pointedEls: HTMLElement[] = [];
let pointStyle: HTMLStyleElement | null = null;
let scrollTarget: Range | null = null;

function cssApi(): any {
  return (globalThis as any).CSS;
}

function highlightCtor(): any {
  return (globalThis as any).Highlight;
}

function normalize(s: string): string {
  return s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function visible(el: Element | null): boolean {
  if (!el) return false;
  const he = el as HTMLElement;
  if (he.hidden || he.getAttribute('aria-hidden') === 'true') return false;
  try {
    const cs = getComputedStyle(he);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  } catch {
    return true;
  }
}

function ensureStyle(doc: Document, color: string): void {
  if (pointStyle?.isConnected && pointStyle.dataset.color === color) return;
  pointStyle?.remove();
  pointStyle = doc.createElement('style');
  pointStyle.id = STYLE_ID;
  pointStyle.dataset.color = color;
  pointStyle.textContent = `
    ::highlight(${HIGHLIGHT_NAME}) {
      background-color: ${color};
      color: #111;
    }
    .${EL_CLASS} {
      outline: 2px solid ${color} !important;
      outline-offset: 2px !important;
      border-radius: 3px !important;
      background-color: ${color}33 !important;
    }
  `;
  (doc.head || doc.documentElement).appendChild(pointStyle);
}

function textNodesUnder(root: Node): Text[] {
  const out: Text[] = [];
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
      if (!visible(parent)) return NodeFilter.FILTER_REJECT;
      return (node.nodeValue ?? '').trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  let n = walker.nextNode();
  while (n) {
    out.push(n as Text);
    n = walker.nextNode();
  }
  return out;
}

interface CharRef { node: Text; offset: number }

/** خريطة نصية مع مراجع العقد — للبحث عبر عناصر inline متعددة */
function textMap(nodes: Text[]): { text: string; refs: CharRef[] } {
  let text = '';
  const refs: CharRef[] = [];
  for (const node of nodes) {
    const value = node.nodeValue ?? '';
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (/\s/.test(ch)) {
        if (!text || text.endsWith(' ')) continue;
        text += ' ';
      } else {
        text += ch;
      }
      refs.push({ node, offset: i });
    }
  }
  // trim
  let start = 0;
  let end = text.length;
  while (start < end && text[start] === ' ') start++;
  while (end > start && text[end - 1] === ' ') end--;
  return { text: text.slice(start, end), refs: refs.slice(start, end) };
}

function rangeForQuery(doc: Document, nodes: Text[], query: string): Range | null {
  const map = textMap(nodes);
  const hay = map.text.toLowerCase();
  const needle = normalize(query).toLowerCase();
  if (!needle) return null;
  const idx = hay.indexOf(needle);
  if (idx < 0) return null;
  const start = map.refs[idx];
  const end = map.refs[idx + needle.length - 1];
  if (!start || !end) return null;
  const range = doc.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, Math.min(end.offset + 1, end.node.nodeValue?.length ?? 0));
  } catch {
    return null;
  }
  return range;
}

/** Range لكلمة داخل عنصر بالاعتماد على إزاحة النص المطبّع (charIndex من chrome.tts) */
export function rangeForTextOffset(el: HTMLElement, start: number, length: number): Range | null {
  const map = textMap(textNodesUnder(el));
  if (!map.text) return null;
  const s = Math.max(0, Math.min(start, map.text.length - 1));
  const e = Math.max(0, Math.min(start + Math.max(1, length) - 1, map.text.length - 1));
  const startRef = map.refs[s];
  const endRef = map.refs[e];
  if (!startRef || !endRef) return null;
  const doc = el.ownerDocument;
  const range = doc.createRange();
  try {
    range.setStart(startRef.node, startRef.offset);
    range.setEnd(endRef.node, Math.min(endRef.offset + 1, endRef.node.nodeValue?.length ?? 0));
  } catch {
    return null;
  }
  return range;
}

function findTextRanges(doc: Document, query: string, all: boolean): Range[] {
  const ranges: Range[] = [];
  const limit = all ? 20 : 1;

  // 1) مطابقة مباشرة داخل عقدة نصية واحدة (الأكثر شيوعاً)
  const nodes = textNodesUnder(doc.body);
  const needle = normalize(query).toLowerCase();
  for (const node of nodes) {
    if (ranges.length >= limit) break;
    const value = node.nodeValue ?? '';
    const hay = value.toLowerCase();
    let from = 0;
    while (ranges.length < limit) {
      const idx = hay.indexOf(needle, from);
      if (idx < 0) break;
      const range = doc.createRange();
      try {
        range.setStart(node, idx);
        range.setEnd(node, Math.min(value.length, idx + needle.length));
        ranges.push(range);
      } catch {
        /* ignore */
      }
      from = idx + Math.max(1, needle.length);
    }
  }
  if (ranges.length) return ranges;

  // 2) مطابقة عبر inline elements (مثل "Hello <b>world</b>") — نجرّب أصغر العناصر
  const candidates = Array.from(
    doc.body.querySelectorAll('p,li,td,th,h1,h2,h3,h4,h5,h6,blockquote,figcaption,button,a,label,summary,span,div'),
  ).filter((el) => visible(el));
  candidates.sort((a, b) => (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0));
  for (const el of candidates) {
    if (ranges.length >= limit) break;
    const text = normalize(el.textContent ?? '');
    if (!text.toLowerCase().includes(needle)) continue;
    const range = rangeForQuery(doc, textNodesUnder(el), query);
    if (range) ranges.push(range);
  }
  return ranges;
}

function applyRanges(doc: Document, ranges: Range[]): boolean {
  const CSSH = cssApi();
  const Highlight = highlightCtor();
  if (!CSSH?.highlights || typeof Highlight !== 'function') {
    // احتياطي: ألصق الفئة بالعنصر الأب
    for (const r of ranges) {
      const container = r.startContainer;
      const el = (container.nodeType === 1
        ? container
        : (container.parentElement ?? container.parentNode)) as HTMLElement | null;
      if (el && !pointedEls.includes(el)) {
        el.classList.add(EL_CLASS);
        pointedEls.push(el);
      }
    }
    return true;
  }
  try {
    CSSH.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
    return true;
  } catch {
    return false;
  }
}

function scrollToRange(range: Range | null): void {
  if (!range) return;
  try {
    const rect = range.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      window.scrollBy({ top: rect.top - window.innerHeight / 3, behavior: 'smooth' });
    }
  } catch {
    /* ignore */
  }
}

export function highlightInPage(
  doc: Document,
  req: PointRequest,
): { ok: true; data: PointResult } | { ok: false; error: string; message: string } {
  const color = req.color && /^#[0-9a-f]{3,8}$/i.test(req.color) ? req.color : '#fde047';
  clearPageHighlights();
  ensureStyle(doc, color);

  const ranges: Range[] = [];
  let mode: PointResult['mode'] = 'text';

  if (req.text?.trim()) {
    mode = 'text';
    ranges.push(...findTextRanges(doc, req.text, Boolean(req.all)));
  } else if (req.blockIds?.length) {
    mode = 'blocks';
    const map = new Map<string, HTMLElement>();
    for (const id of req.blockIds) {
      if (!id) continue;
      try {
        const el = doc.querySelector(`[data-browsemate-block="${cssEscape(id)}"]`);
        if (el instanceof HTMLElement) map.set(id, el);
      } catch {
        /* ignore */
      }
    }
    for (const el of map.values()) {
      if (!visible(el)) continue;
      const r = doc.createRange();
      r.selectNodeContents(el);
      ranges.push(r);
      el.classList.add(EL_CLASS);
      pointedEls.push(el);
    }
  } else if (req.selector?.trim()) {
    mode = 'selector';
    let nodes: NodeListOf<Element>;
    try { nodes = doc.querySelectorAll(req.selector); }
    catch { return { ok: false, error: 'BAD_SELECTOR', message: 'محدد CSS غير صالح.' }; }
    for (const node of Array.from(nodes).slice(0, 30)) {
      if (!(node instanceof HTMLElement) || !visible(node)) continue;
      const r = doc.createRange();
      r.selectNodeContents(node);
      ranges.push(r);
      node.classList.add(EL_CLASS);
      pointedEls.push(node);
    }
  } else {
    return { ok: false, error: 'NO_TARGET', message: 'حدد text أو blockIds أو selector للإشارة.' };
  }

  if (!ranges.length) {
    clearPageHighlights();
    return { ok: false, error: 'TEXT_NOT_FOUND', message: 'لم أجد النص/العنصر المطلوب في الصفحة.' };
  }

  const applied = applyRanges(doc, ranges);
  if (!applied) {
    clearPageHighlights();
    return { ok: false, error: 'HIGHLIGHT_FAILED', message: 'تعذر تظليل النص في هذه الصفحة.' };
  }

  if (mode !== 'blocks' && mode !== 'selector') {
    scrollTarget = ranges[0];
    if (req.scroll !== false) scrollToRange(ranges[0]);
  } else if (req.scroll !== false) {
    try { pointedEls[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* ignore */ }
  }

  return { ok: true, data: { count: ranges.length, mode, ...(cssApi()?.highlights ? {} : { fallback: true }) } };
}

export function clearPageHighlights(): void {
  try {
    cssApi()?.highlights?.delete(HIGHLIGHT_NAME);
  } catch {
    /* ignore */
  }
  for (const el of pointedEls) el.classList.remove(EL_CLASS);
  pointedEls = [];
  scrollTarget = null;
  if (pointStyle) {
    pointStyle.remove();
    pointStyle = null;
  }
}

function cssEscape(s: string): string {
  const w = globalThis as any;
  if (w.CSS?.escape) return w.CSS.escape(s);
  return s.replace(/["\\]/g, '\\$&');
}
