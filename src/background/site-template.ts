// قالب موقع منظم (Landing/One-page) — النموذج يملأ JSON فيُنتج HTML موثوقاً بدل كتابة HTML حر
export type SiteSection =
  | { type: 'hero'; title: string; subtitle?: string; badge?: string; cta?: string; secondary?: string }
  | { type: 'features'; title?: string; items: Array<{ icon?: string; title: string; text: string }> }
  | { type: 'about'; title?: string; text: string; bullets?: string[] }
  | { type: 'pricing'; title?: string; plans: Array<{ name: string; price: string; period?: string; features: string[]; cta?: string; featured?: boolean }> }
  | { type: 'testimonials'; title?: string; items: Array<{ quote: string; name: string; role?: string }> }
  | { type: 'faq'; title?: string; items: Array<{ q: string; a: string }> }
  | { type: 'gallery'; title?: string; images: Array<{ url: string; alt?: string }> }
  | { type: 'contact'; title?: string; text?: string; email?: string; phone?: string }
  | { type: 'cta'; title: string; text?: string; button?: string };

export interface SiteData {
  brand: string;
  tagline?: string;
  theme?: 'dark' | 'light';
  accent?: string;
  nav?: string[];
  sections: SiteSection[];
  footer?: string;
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const safeAccent = (a?: string) => (/^#[0-9a-fA-F]{3,8}$/.test(a ?? '') ? a! : '#7c9cff');

function sectionHtml(s: SiteSection, i: number): string {
  switch (s.type) {
    case 'hero':
      return `<section class="hero reveal" id="hero">
        <div class="glow g1"></div><div class="glow g2"></div>
        <div class="container hero-inner">
          ${s.badge ? `<span class="badge">${esc(s.badge)}</span>` : ''}
          <h1>${esc(s.title)}</h1>
          ${s.subtitle ? `<p class="lead">${esc(s.subtitle)}</p>` : ''}
          <div class="actions">
            ${s.cta ? `<a class="btn" href="#contact">${esc(s.cta)}</a>` : ''}
            ${s.secondary ? `<a class="btn ghost" href="#features">${esc(s.secondary)}</a>` : ''}
          </div>
        </div>
      </section>`;
    case 'features':
      return `<section class="reveal" id="features">
        <div class="container">
          ${s.title ? `<h2>${esc(s.title)}</h2>` : ''}
          <div class="grid cols-3">${s.items
            .map((it) => `<article class="card"><div class="icon">${esc(it.icon ?? '✦')}</div><h3>${esc(it.title)}</h3><p>${esc(it.text)}</p></article>`)
            .join('')}</div>
        </div>
      </section>`;
    case 'about':
      return `<section class="reveal" id="about"><div class="container narrow">
        ${s.title ? `<h2>${esc(s.title)}</h2>` : ''}
        <p class="lead">${esc(s.text)}</p>
        ${s.bullets?.length ? `<ul class="checks">${s.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
      </div></section>`;
    case 'pricing':
      return `<section class="reveal" id="pricing"><div class="container">
        ${s.title ? `<h2>${esc(s.title)}</h2>` : ''}
        <div class="grid cols-3">${s.plans
          .map(
            (p) => `<article class="card plan ${p.featured ? 'featured' : ''}">
            <h3>${esc(p.name)}</h3>
            <div class="price">${esc(p.price)}${p.period ? `<span>/${esc(p.period)}</span>` : ''}</div>
            <ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
            <a class="btn ${p.featured ? '' : 'ghost'}" href="#contact">${esc(p.cta ?? 'اختر')}</a>
          </article>`,
          )
          .join('')}</div>
      </div></section>`;
    case 'testimonials':
      return `<section class="reveal" id="testimonials"><div class="container">
        ${s.title ? `<h2>${esc(s.title)}</h2>` : ''}
        <div class="grid cols-3">${s.items
          .map((t) => `<blockquote class="card"><p>“${esc(t.quote)}”</p><footer><b>${esc(t.name)}</b>${t.role ? `<span> — ${esc(t.role)}</span>` : ''}</footer></blockquote>`)
          .join('')}</div>
      </div></section>`;
    case 'faq':
      return `<section class="reveal" id="faq"><div class="container narrow">
        ${s.title ? `<h2>${esc(s.title)}</h2>` : ''}
        ${s.items.map((f) => `<details class="card"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}
      </div></section>`;
    case 'gallery':
      return `<section class="reveal" id="gallery"><div class="container">
        ${s.title ? `<h2>${esc(s.title)}</h2>` : ''}
        <div class="grid cols-3">${s.images.map((im) => `<figure class="shot"><img src="${esc(im.url)}" alt="${esc(im.alt ?? '')}" loading="lazy" /></figure>`).join('')}</div>
      </div></section>`;
    case 'contact':
      return `<section class="reveal" id="contact"><div class="container narrow">
        ${s.title ? `<h2>${esc(s.title)}</h2>` : ''}
        ${s.text ? `<p class="lead">${esc(s.text)}</p>` : ''}
        <div class="actions">
          ${s.email ? `<a class="btn" href="mailto:${esc(s.email)}">${esc(s.email)}</a>` : ''}
          ${s.phone ? `<a class="btn ghost" href="tel:${esc(s.phone)}">${esc(s.phone)}</a>` : ''}
        </div>
      </div></section>`;
    case 'cta':
      return `<section class="reveal cta-band"><div class="container narrow">
        <h2>${esc(s.title)}</h2>${s.text ? `<p class="lead">${esc(s.text)}</p>` : ''}
        <a class="btn" href="#contact">${esc(s.button ?? 'ابدأ الآن')}</a>
      </div></section>`;
    default:
      return '';
  }
}

export function renderSiteHtml(d: SiteData): string {
  const theme = d.theme === 'light' ? 'light' : 'dark';
  const accent = safeAccent(d.accent);
  const nav = (d.nav ?? []).slice(0, 6);
  const anchorTypes = d.sections
    .map((s) => s.type)
    .filter((t) => ['features', 'about', 'pricing', 'testimonials', 'faq', 'gallery', 'contact'].includes(t));
  const navLinks = nav.map((label, i) => ({ label, href: `#${anchorTypes[i] ?? 'contact'}` }));
  const title = d.brand || 'My Website';
  const body = d.sections.map(sectionHtml).join('\n');

  return `<!doctype html><html lang="ar" dir="rtl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(d.tagline ?? '')}">
<style>
  :root{--accent:${accent};--bg:${theme === 'light' ? '#f7f8fb' : '#0b0e14'};--surface:${theme === 'light' ? '#ffffff' : '#121724'};--surface2:${theme === 'light' ? '#eef1f7' : '#1a2132'};--text:${theme === 'light' ? '#141821' : '#eef2fb'};--muted:${theme === 'light' ? '#5b6376' : '#9aa4b8'};--border:${theme === 'light' ? '#dfe3ec' : '#242c3d'};--radius:16px}
  *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.7 system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif}
  .container{width:min(1120px,92%);margin-inline:auto}.narrow{max-width:760px}
  header{position:sticky;top:0;z-index:20;backdrop-filter:blur(12px);background:color-mix(in srgb,var(--bg) 82%,transparent);border-bottom:1px solid var(--border)}
  .nav{display:flex;align-items:center;justify-content:space-between;padding:14px 0;gap:16px}
  .brand{font-weight:800;font-size:18px;letter-spacing:.2px}.brand span{color:var(--accent)}
  .links{display:flex;gap:18px;flex-wrap:wrap}.links a{color:var(--muted);text-decoration:none;font-size:14px}.links a:hover{color:var(--text)}
  section{padding:72px 0;border-bottom:1px solid color-mix(in srgb,var(--border) 55%,transparent)}
  .hero{position:relative;overflow:hidden;padding:96px 0 84px;border-bottom:1px solid var(--border)}
  .hero-inner{position:relative;z-index:2;max-width:820px}
  .glow{position:absolute;width:420px;height:420px;border-radius:50%;filter:blur(90px);opacity:.35;background:var(--accent)}
  .g1{top:-160px;inset-inline-start:-80px}.g2{bottom:-220px;inset-inline-end:-60px;opacity:.22}
  h1{font-size:clamp(30px,5vw,52px);line-height:1.15;margin:14px 0 12px;letter-spacing:-.5px}
  h2{font-size:clamp(22px,3vw,32px);margin:0 0 26px;letter-spacing:-.3px}
  h3{margin:0 0 8px;font-size:17px}
  .lead{color:var(--muted);font-size:clamp(15px,2vw,18px);margin:0 0 18px}
  .badge{display:inline-block;font-size:12px;color:var(--accent);border:1px solid color-mix(in srgb,var(--accent) 45%,transparent);background:color-mix(in srgb,var(--accent) 12%,transparent);padding:5px 12px;border-radius:99px}
  .actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:12px 22px;border-radius:12px;background:var(--accent);color:#0b0e14;font-weight:700;text-decoration:none;border:1px solid transparent;transition:.2s}
  .btn:hover{filter:brightness(1.08);transform:translateY(-1px)}
  .btn.ghost{background:transparent;color:var(--text);border-color:var(--border)}
  .grid{display:grid;gap:18px}.cols-3{grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:22px}
  .card .icon{width:38px;height:38px;border-radius:10px;display:grid;place-items:center;background:var(--surface2);color:var(--accent);font-size:18px;margin-bottom:12px}
  .card p{color:var(--muted);margin:0}
  .checks{list-style:none;padding:0;margin:18px 0 0;display:grid;gap:10px}
  .checks li{padding-inline-start:26px;position:relative;color:var(--muted)}
  .checks li::before{content:"✓";position:absolute;inset-inline-start:0;color:var(--accent);font-weight:800}
  .plan .price{font-size:34px;font-weight:800;margin:6px 0 14px}.plan .price span{font-size:14px;color:var(--muted);font-weight:500}
  .plan ul{list-style:none;padding:0;margin:0 0 18px;display:grid;gap:8px;color:var(--muted);font-size:14px}
  .plan.featured{border-color:var(--accent);box-shadow:0 18px 50px color-mix(in srgb,var(--accent) 18%,transparent)}
  blockquote{margin:0}blockquote p{color:var(--text);font-size:15px}blockquote footer{margin-top:10px;font-size:13px;color:var(--muted)}
  details.card{margin-bottom:12px}summary{cursor:pointer;font-weight:600}details p{margin-top:10px}
  .shot{margin:0;border-radius:14px;overflow:hidden;border:1px solid var(--border);aspect-ratio:4/3;background:var(--surface2)}
  .shot img{width:100%;height:100%;object-fit:cover;display:block}
  .cta-band{background:linear-gradient(140deg,color-mix(in srgb,var(--accent) 20%,transparent),transparent 60%);text-align:center}
  footer.site{padding:34px 0;color:var(--muted);font-size:13px;text-align:center}
  .reveal{opacity:0;transform:translateY(14px);transition:opacity .5s ease,transform .5s ease}
  .reveal.in{opacity:1;transform:none}
  @media (prefers-reduced-motion:reduce){.reveal{transition:none;opacity:1;transform:none}}
</style></head><body>
<header><div class="container nav">
  <div class="brand">${esc(title)}<span>.</span></div>
  ${nav.length ? `<nav class="links">${navLinks.map((n) => `<a href="${n.href}">${esc(n.label)}</a>`).join('')}</nav>` : ''}
</div></header>
${body}
<footer class="site"><div class="container">${esc(d.footer ?? `© ${new Date().getFullYear()} ${title} — جميع الحقوق محفوظة`)}</div></footer>
<script>
  (function(){
    var els=document.querySelectorAll('.reveal');
    if(!('IntersectionObserver' in window)){els.forEach(function(e){e.classList.add('in')});return}
    var io=new IntersectionObserver(function(entries){entries.forEach(function(en){if(en.isIntersecting){en.target.classList.add('in');io.unobserve(en.target)}})},{threshold:.12});
    els.forEach(function(e){io.observe(e)});
  })();
</script>
</body></html>`;
}
