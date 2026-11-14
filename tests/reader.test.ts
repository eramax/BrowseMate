// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { extractBlocks, getOutline, normalizeText, resolveRead } from '../src/content/reader/extractor';
import { clearPageHighlights, highlightInPage } from '../src/content/reader/pointer';

const PAGE = `
<nav><a href="#">الرئيسية</a><a href="#">من نحن</a></nav>
<header><h1>عنوان الموقع</h1></header>
<main>
  <article>
    <h1>مقدمة في الذكاء الاصطناعي</h1>
    <p>هذا هو الفقرة الأولى التي يجب أن يقرأها القارئ.</p>
    <p>الفقرة الثانية تتحدث عن التعلم الآلي.</p>
    <h2>التطبيقات العملية</h2>
    <ul><li>المساعدات الصوتية</li><li>الترجمة الآلية</li></ul>
    <p>اضغط على <strong>تسجيل الدخول</strong> للوصول إلى حسابك.</p>
    <pre>const x = 1;
console.log(x);</pre>
  </article>
  <aside>إعلان جانبي يجب تجاهله</aside>
</main>
<footer>حقوق النشر 2026 — تذييل يجب تجاهله</footer>
`;

describe('reader extractor', () => {
  beforeEach(() => {
    document.body.innerHTML = PAGE;
  });

  it('normalizes whitespace and Arabic NBSP', () => {
    expect(normalizeText('  أهلاً\u00a0 \n\n  بالعالم  ')).toBe('أهلاً بالعالم');
  });

  it('extracts only main article blocks and skips nav/footer/aside', () => {
    const { blocks } = extractBlocks(document);
    const texts = blocks.map((b) => b.text);
    expect(texts.some((t) => t.includes('الرئيسية'))).toBe(false);
    expect(texts.some((t) => t.includes('تذييل يجب تجاهله'))).toBe(false);
    expect(texts.some((t) => t.includes('إعلان جانبي'))).toBe(false);
    expect(texts).toContain('مقدمة في الذكاء الاصطناعي');
    expect(texts).toContain('هذا هو الفقرة الأولى التي يجب أن يقرأها القارئ.');
    expect(texts.some((t) => t.startsWith('const x = 1'))).toBe(true);
  });

  it('keeps stable block ids across extractions', () => {
    const a = extractBlocks(document).blocks;
    const b = extractBlocks(document).blocks;
    expect(b.map((x) => x.id)).toEqual(a.map((x) => x.id));
  });

  it('returns outline snippets and heading context', () => {
    const outline = getOutline(document, { maxBlocks: 20 });
    expect(outline.total).toBeGreaterThan(3);
    expect(outline.blocks[0].text).toContain('مقدمة');
    const second = outline.blocks.find((b) => b.tag === 'p');
    expect(second?.heading).toContain('مقدمة');
    const li = outline.blocks.find((b) => b.tag === 'li');
    expect(li?.heading).toBe('التطبيقات العملية');
  });

  it('returns full text for requested ids', () => {
    const outline = getOutline(document, { maxBlocks: 20 });
    const id = outline.blocks[1].id;
    const full = getOutline(document, { ids: [id] });
    expect(full.blocks[0].text).toBe('هذا هو الفقرة الأولى التي يجب أن يقرأها القارئ.');
  });

  it('resolves blockIds, selector and text', () => {
    const outline = getOutline(document, { maxBlocks: 20 });
    const ids = outline.blocks.filter((b) => b.tag === 'p').slice(0, 2).map((b) => b.id);
    const byIds = resolveRead(document, { blockIds: ids });
    expect(byIds.blocks?.map((b) => b.tag)).toEqual(['p', 'p']);

    const bySelector = resolveRead(document, { selector: 'article p' });
    expect(bySelector.blocks?.length).toBe(3);

    const byText = resolveRead(document, { text: 'نص حر' });
    expect(byText.blocks?.[0].text).toBe('نص حر');
    expect(byText.blocks?.[0].element).toBeNull();
  });

  it('returns a range for a block range', () => {
    const outline = getOutline(document, { maxBlocks: 20 });
    const from = outline.blocks[1].id;
    const to = outline.blocks[2].id;
    const res = resolveRead(document, { fromBlockId: from, toBlockId: to });
    expect(res.blocks?.map((b) => b.id)).toEqual([from, to]);
  });
});

describe('pointer', () => {
  beforeEach(() => {
    document.body.innerHTML = PAGE;
    clearPageHighlights();
  });

  it('highlights text and injects the style', () => {
    const res = highlightInPage(document, { text: 'تسجيل الدخول' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.count).toBe(1);
    expect(document.getElementById('bm-reader-point-styles')).not.toBeNull();
    // jsdom لا يدعم CSS.highlights — يسقط إلى فئة العنصر
    expect(document.querySelector('.bm-reader-point-el')).not.toBeNull();
  });

  it('highlights selected blocks with outline class', () => {
    const outline = getOutline(document, { maxBlocks: 20 });
    const id = outline.blocks.find((b) => b.tag === 'p')!.id;
    const res = highlightInPage(document, { blockIds: [id] });
    expect(res.ok).toBe(true);
    expect(document.querySelector('.bm-reader-point-el')?.getAttribute('data-browsemate-block')).toBe(id);
  });

  it('returns TEXT_NOT_FOUND for missing text and clears on request', () => {
    const res = highlightInPage(document, { text: 'كلام غير موجود إطلاقاً' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('TEXT_NOT_FOUND');
    clearPageHighlights();
    expect(document.getElementById('bm-reader-point-styles')).toBeNull();
  });
});
