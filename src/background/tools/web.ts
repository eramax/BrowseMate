// preview_html — معاينة موقع/صفحة HTML واحدة في تبويب + زر تحميل في الشات
import { z } from 'zod';
import { register } from './registry';
import { saveArtifact } from '../artifacts';

register({
  name: 'preview_html',
  description:
    'يعاين صفحة/موقع HTML كامل (single-file) في تبويب جديد ويضيف زر تحميل في الشات. استخدمه بعد كتابة HTML كامل (CDN مسموح، بدون build).',
  sensitive: false,
  schema: z.object({
    html: z.string().min(50).describe('مستند HTML كامل يبدأ بـ <!doctype html>'),
    filename: z.string().optional().describe('اسم الملف مثل index.html'),
  }),
  execute: async (a) => {
    const html = String(a.html);
    const filename = (a.filename || 'index.html').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
    const artifact = await saveArtifact(filename, html);
    const url = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    let previewOpened = false;
    if (url.length < 1_800_000) {
      await chrome.tabs.create({ url, active: true });
      previewOpened = true;
    }
    return {
      artifact,
      previewOpened,
      note: previewOpened
        ? 'فُتحت المعاينة في تبويب جديد، وزر التحميل ظاهر في الشات.'
        : 'الملف كبير للمعاينة المباشرة — استخدم زر التحميل ثم افتحه محلياً.',
    };
  },
});
