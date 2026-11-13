// أدوات الموقع: preview_html (حر) + site_read/site_edit/site_undo + preview_diagnostics
import { z } from 'zod';
import { register } from './registry';
import { openPreview } from '../preview';
import { chromeKV } from '../../shared/storage';
import { getSite, saveSite, undoSite } from '../site-store';
import { applyEdits, type Edit } from '../site-edit';

register({
  name: 'preview_html',
  description:
    'يعاين HTML كاملاً كتبته بنفسك (أي صفحة أو تطبيق) في تبويب ويضيف زر تحميل. اكتب الكود كاملاً، ثم استدعِ preview_diagnostics بعد المعاينة.',
  sensitive: false,
  schema: z.object({
    html: z.string().min(50).describe('مستند HTML كامل يبدأ بـ <!doctype html>'),
    filename: z.string().optional(),
  }),
  execute: async (a) => {
    const filename = (a.filename || 'index.html').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
    const result = await openPreview(String(a.html), filename);
    if (!result.error) await saveSite({ id: result.artifact.id, filename, html: String(a.html), version: 1, updatedAt: Date.now() }, false);
    return result;
  },
});

register({
  name: 'site_read',
  description:
    'يقرأ الملف الحالي للموقع (HTML) لتحريره بـ site_edit. استخدمه مرة واحدة عند الحاجة للتعديل، ولا تعد كتابة الملف كاملاً.',
  sensitive: false,
  idempotent: true,
  schema: z.object({}),
  execute: async () => {
    const ws = await getSite();
    if (!ws) return { error: 'لا يوجد ملف حالي — استخدم preview_html أولاً.' };
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
    if (!ws) return { error: 'لا يوجد ملف حالي — استخدم preview_html أولاً.' };
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
  idempotent: true,
  schema: z.object({}),
  execute: async () => {
    const info = await chromeKV.get<{ tabId: number; artifactId: string; filename: string }>('previewTab');
    const logs = await chromeKV.get<{ id: string; entries: Array<{ level: string; args: string[]; ts: number }> }>('previewLogs');
    if (logs?.entries?.length && (!info?.artifactId || logs.id === info.artifactId)) {
      const errors = logs.entries.filter((e) => e.level === 'error').map((e) => (e.args || []).join(' ')).slice(-25);
      const warnings = logs.entries.filter((e) => e.level === 'warn').map((e) => (e.args || []).join(' ')).slice(-25);
      return {
        errors: errors.length,
        warnings: warnings.length,
        errorMessages: errors,
        warningMessages: warnings,
        filename: info?.filename,
        verdict: errors.length ? 'أصلح الأخطاء ثم أعد المعاينة' : warnings.length ? 'تعمل، لكن راجع التحذيرات' : 'تعمل بلا أخطاء',
      };
    }
    if (!info?.tabId) return { errors: 0, warnings: 0, note: 'لا توجد معاينة مفتوحة.' };
    const tab = await chrome.tabs.get(info.tabId).catch(() => null);
    if (!tab) return { errors: 0, warnings: 0, note: 'تبويب المعاينة أُغلق. أعد المعاينة إن لزم.' };
    const title = tab.title || '';
    if (title.length > 220 || /<(style|body|script)\b/i.test(title)) {
      return {
        errors: 1,
        warnings: 0,
        lastError: 'HTML غير صالح: وسم <title> غير مغلق فابتلع بقية الصفحة (صفحة بيضاء)',
        filename: info.filename,
        verdict: 'أصلح بنية HTML ثم أعد preview_html أو استخدم site_read/site_edit',
      };
    }
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
