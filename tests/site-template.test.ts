import { describe, it, expect } from 'vitest';
import { renderSiteHtml, type SiteData } from '../src/background/site-template';

const site: SiteData = {
  brand: 'متجر نور',
  tagline: 'أفضل المنتجات',
  theme: 'dark',
  accent: '#22c55e',
  nav: ['المميزات', 'الأسعار', 'اتصل بنا'],
  sections: [
    { type: 'hero', title: 'مرحباً بك', subtitle: 'وصف', badge: 'جديد', cta: 'ابدأ', secondary: 'اعرف أكثر' },
    { type: 'features', title: 'المميزات', items: [{ icon: '⚡', title: 'سريع', text: 'أداء عالٍ' }] },
    { type: 'pricing', title: 'الأسعار', plans: [{ name: 'أساسي', price: '99', period: 'شهر', features: ['ميزة'], featured: true }] },
    { type: 'faq', title: 'أسئلة', items: [{ q: 'سؤال؟', a: 'جواب' }] },
    { type: 'contact', title: 'اتصل', email: 'a@b.com' },
  ],
};

describe('renderSiteHtml', () => {
  it('renders all requested sections with A4-independent responsive CSS', () => {
    const html = renderSiteHtml(site);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('viewport');
    expect(html).toContain('id="hero"');
    expect(html).toContain('id="features"');
    expect(html).toContain('id="pricing"');
    expect(html).toContain('id="faq"');
    expect(html).toContain('id="contact"');
    expect(html).toContain('--accent:#22c55e');
    expect(html).toContain('dir="rtl"');
  });
  it('escapes untrusted content', () => {
    const html = renderSiteHtml({ ...site, brand: '<img src=x onerror=alert(1)>', sections: [{ type: 'hero', title: '<script>x</script>' }] });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
  it('works with light theme and no nav', () => {
    const html = renderSiteHtml({ brand: 'X', theme: 'light', sections: [{ type: 'cta', title: 'ابدأ' }] });
    expect(html).toContain('--bg:#f7f8fb');
    expect(html).not.toContain('<nav class="links">');
  });
});
