// هيكل صفحة A4 مشترك لكل المستندات (CV، خطاب تقديم، تقارير…) + طباعة/تحميل بدون debugger
export function pageShell(opts: { title: string; body: string; css?: string; lang?: string }): string {
  const lang = opts.lang ?? 'en';
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<title>${escapeHtml(opts.title)}</title>
<style>
  @page { size: A4; margin: 14mm 15mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font: 10.8pt/1.45 "Helvetica Neue", Arial, system-ui, sans-serif; color: #16181d; }
  h1 { margin: 0; font-size: 21pt; letter-spacing: .2px; }
  h2 { font-size: 9.6pt; text-transform: uppercase; letter-spacing: .9px; color: #1d2430;
       border-bottom: 1px solid #c9ced8; padding-bottom: 2px; margin: 0 0 6px; }
  p { margin: 0 0 7px; }
  ul { margin: 3px 0 0; padding-inline-start: 17px; }
  li { margin: 0 0 2px; }
  section { margin: 0 0 10px; }
  .muted { color: #4a505e; }
  .toolbar { position: fixed; top: 10px; inset-inline-end: 10px; z-index: 9; }
  .toolbar button { font: 600 12px system-ui; padding: 9px 14px; border: none; border-radius: 9px;
    background: #1d2430; color: #fff; cursor: pointer; box-shadow: 0 6px 18px rgba(0,0,0,.2); }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .toolbar { display: none !important; }
  }
  ${opts.css ?? ''}
</style></head><body>
<div class="toolbar"><button onclick="window.print()">🖨 Print / Save as PDF</button></div>
<script>if (location.hash === '#print') { window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 300); }); }</script>
${opts.body}
</body></html>`;
}

export function escapeHtml(s: string | undefined | null): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** مستند عام: عنوان + فقرات + أقسام (عنوان/فقرات/نقاط) — للخطابات والتقارير */
export interface DocData {
  title: string;
  subtitle?: string;
  meta?: string[]; // سطور معلومات (التاريخ، إلى، من…)
  paragraphs?: string[];
  sections?: Array<{ heading: string; paragraphs?: string[]; bullets?: string[] }>;
  signature?: string;
  lang?: string;
}

export function renderDocHtml(d: DocData): string {
  const esc = escapeHtml;
  const meta = (d.meta ?? []).filter(Boolean);
  const paras = (d.paragraphs ?? []).filter(Boolean);
  const sections = (d.sections ?? [])
    .map((s) => {
      const body = [
        ...(s.paragraphs ?? []).filter(Boolean).map((p) => `<p>${esc(p)}</p>`),
        (s.bullets ?? []).length ? `<ul>${(s.bullets ?? []).filter(Boolean).map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : '',
      ].join('');
      return body.trim() ? `<section><h2>${esc(s.heading)}</h2>${body}</section>` : '';
    })
    .join('');

  const body = `
<header style="border-bottom:1.5px solid #16181d;padding-bottom:8px;margin-bottom:14px">
  <h1>${esc(d.title)}</h1>
  ${d.subtitle ? `<div class="muted" style="font-size:11pt;margin-top:2px">${esc(d.subtitle)}</div>` : ''}
  ${meta.length ? `<div class="muted" style="font-size:9.4pt;margin-top:5px">${meta.map(esc).join(' · ')}</div>` : ''}
</header>
${paras.map((p) => `<p>${esc(p)}</p>`).join('')}
${sections}
${d.signature ? `<p style="margin-top:16px">${esc(d.signature)}</p>` : ''}`;

  return pageShell({ title: d.title, body, lang: d.lang ?? 'en' });
}
