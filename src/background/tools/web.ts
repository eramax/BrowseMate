// أدوات الموقع: render_site (قالب منظم) + preview_html (حر) + preview_diagnostics
import { z } from 'zod';
import { register } from './registry';
import { renderSiteHtml, type SiteData } from '../site-template';
import { openPreview } from '../preview';
import { chromeKV } from '../../shared/storage';
import { getSite, saveSite, undoSite } from '../site-store';
import { applyEdits, type Edit } from '../site-edit';

const item = <T extends z.ZodTypeAny>(x: T) => z.array(x);

register({
  name: 'render_site',
  description:
    'يبني موقعاً/صفحة هبوط كاملة بملف HTML واحد من بيانات منظمة (سريع وموثوق، تصميم احترافي responsive). استخدمه بدل كتابة HTML. الأقسام المتاحة: hero, features, about, pricing, testimonials, faq, gallery, contact, cta. بعد المعاينة استدعِ preview_diagnostics لأخطاء console.',
  sensitive: false,
  schema: z.object({
    brand: z.string().describe('اسم العلامة/الموقع'),
    tagline: z.string().optional(),
    theme: z.enum(['dark', 'light']).optional(),
    accent: z.string().optional().describe('لون hex مثل #7c9cff'),
    nav: z.array(z.string()).optional().describe('عناصر القائمة'),
    footer: z.string().optional(),
    filename: z.string().optional().describe('مثل index.html'),
    sections: z.array(z.union([
      z.object({ type: z.literal('hero'), title: z.string(), subtitle: z.string().optional(), badge: z.string().optional(), cta: z.string().optional(), secondary: z.string().optional() }),
      z.object({ type: z.literal('features'), title: z.string().optional(), items: z.array(z.object({ icon: z.string().optional(), title: z.string(), text: z.string() })) }),
      z.object({ type: z.literal('about'), title: z.string().optional(), text: z.string(), bullets: z.array(z.string()).optional() }),
      z.object({ type: z.literal('pricing'), title: z.string().optional(), plans: z.array(z.object({ name: z.string(), price: z.string(), period: z.string().optional(), features: z.array(z.string()), cta: z.string().optional(), featured: z.boolean().optional() })) }),
      z.object({ type: z.literal('testimonials'), title: z.string().optional(), items: z.array(z.object({ quote: z.string(), name: z.string(), role: z.string().optional() })) }),
      z.object({ type: z.literal('faq'), title: z.string().optional(), items: z.array(z.object({ q: z.string(), a: z.string() })) }),
      z.object({ type: z.literal('gallery'), title: z.string().optional(), images: z.array(z.object({ url: z.string(), alt: z.string().optional() })) }),
      z.object({ type: z.literal('contact'), title: z.string().optional(), text: z.string().optional(), email: z.string().optional(), phone: z.string().optional() }),
      z.object({ type: z.literal('cta'), title: z.string(), text: z.string().optional(), button: z.string().optional() }),
    ])).min(1),
  }),
  execute: async (a) => {
    const html = renderSiteHtml(a as unknown as SiteData);
    const filename = a.filename || 'index.html';
    const result = await openPreview(html, filename);
    await saveSite({ id: result.artifact.id, filename, html, version: 1, updatedAt: Date.now() }, false);
    return result;
  },
});

register({
  name: 'preview_html',
  description:
    'يعاين HTML كامل كتبته بنفسك (للتصاميم المخصصة) في تبويب ويضيف زر تحميل. فضّل render_site للصفحات القياسية. بعد المعاينة استدعِ preview_diagnostics.',
  sensitive: false,
  schema: z.object({
    html: z.string().min(50).describe('مستند HTML كامل يبدأ بـ <!doctype html>'),
    filename: z.string().optional(),
  }),
  execute: async (a) => {
    const filename = (a.filename || 'index.html').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
    const result = await openPreview(String(a.html), filename);
    await saveSite({ id: result.artifact.id, filename, html: String(a.html), version: 1, updatedAt: Date.now() }, false);
    return result;
  },
});

register({
  name: 'site_read',
  description:
    'يقرأ الملف الحالي للموقع (HTML) لتحريره بـ site_edit. استخدمه مرة واحدة عند الحاجة للتعديل، ولا تعد كتابة الملف كاملاً.',
  sensitive: false,
  schema: z.object({}),
  execute: async () => {
    const ws = await getSite();
    if (!ws) return { error: 'لا يوجد موقع حالي — استخدم render_site أو preview_html أولاً.' };
    return { filename: ws.filename, version: ws.version, bytes: ws.html.length, html: ws.html.slice(0, 90000) };
  },
});

register({
  name: 'site_edit',
  description:
    'يعدّل الموقع الحالي بتعديلات diff دقيقة (oldText → newText) بدون إعادة كتابة الملف. كل التعديلات تُطبق أو لا شيء. بعد النجاح يُحدَّث نفس زر التحميل وتُفتح المعاينة. استخدم site_read أولاً لرؤية النص الحرفي.',
  sensitive: false,
  schema: z.object({
    edits: z.array(z.object({
      oldText: z.string().describe('نص موجود حرفياً في الملف (مع سياق كافٍ ليكون فريداً)'),
      newText: z.string().describe('البديل الجديد'),
      all: z.boolean().optional().describe('استبدل كل التكرارات'),
    })).min(1),
  }),
  execute: async (a) => {
    const ws = await getSite();
    if (!ws) return { error: 'لا يوجد موقع حالي — استخدم render_site أولاً.' };
    const r = applyEdits(ws.html, a.edits as Edit[]);
    if (!r.ok) return { error: r.error, failedIndex: r.failedIndex, hint: 'اقرأ الملف بـ site_read ثم أعد المحاولة.' };
    const next = { ...ws, html: r.html, version: ws.version + 1, updatedAt: Date.now() };
    await saveSite(next);
    const preview = await openPreview(next.html, next.filename, next.id);
    return { applied: r.applied, version: next.version, filename: next.filename, previewOpened: preview.previewOpened, note: 'طُبقت التعديلات. استدعِ preview_diagnostics للتحقق.' };
  },
});

register({
  name: 'site_undo',
  description: 'يتراجع عن آخر تعديل للموقع (سجل حتى 8 إصدارات) ويعيد المعاينة.',
  sensitive: false,
  schema: z.object({}),
  execute: async () => {
    const prev = await undoSite();
    if (!prev) return { error: 'لا يوجد إصدار سابق.' };
    const preview = await openPreview(prev.html, prev.filename, prev.id);
    return { revertedToVersion: prev.version, filename: prev.filename, previewOpened: preview.previewOpened };
  },
});

register({
  name: 'preview_diagnostics',
  description:
    'يقرأ أخطاء/تحذيرات console من آخر معاينة عبر عنوان تبويب المعاينة. استخدمه بعد كل معاينة: إن وُجدت أخطاء أصلح الموقع وأعد المعاينة (حتى مرتين).',
  sensitive: false,
  schema: z.object({}),
  execute: async () => {
    const info = await chromeKV.get<{ tabId: number; artifactId: string; filename: string }>('previewTab');
    if (!info?.tabId) return { errors: 0, warnings: 0, note: 'لا توجد معاينة مفتوحة.' };
    const tab = await chrome.tabs.get(info.tabId).catch(() => null);
    if (!tab) return { errors: 0, warnings: 0, note: 'تبويب المعاينة أُغلق. أعد المعاينة إن لزم.' };
    const title = tab.title || '';
    const m = title.match(/\[BM:err=(\d+),warn=(\d+)\]\s*(.*)$/);
    if (!m) return { errors: 0, warnings: 0, filename: info.filename, tabTitle: title.slice(0, 120), note: 'لا أخطاء مسجلة.' };
    const errors = Number(m[1]);
    const warnings = Number(m[2]);
    return {
      errors,
      warnings,
      lastError: m[3] || '',
      filename: info.filename,
      verdict: errors > 0 ? 'أصلح الخطأ ثم أعد المعاينة' : warnings > 0 ? 'تعمل، لكن راجع التحذيرات' : 'تعمل بلا أخطاء',
    };
  },
});
