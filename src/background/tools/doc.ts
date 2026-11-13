// render_document — مستند PDF/HTML منسق عام (خطاب تقديم، تقرير، مذكرة…) بنفس سرعة قالب CV
import { z } from 'zod';
import { register } from './registry';
import { renderDocHtml } from '../doc-template';
import { saveArtifact } from '../artifacts';

register({
  name: 'render_document',
  description:
    'ينشئ مستنداً منسقاً A4 (خطاب تقديم، تقرير، مذكرة…) من بيانات منظمة ويعيد زر تحميل/طباعة بدون كتابة HTML. استخدم render_cv للسيرة الذاتية.',
  sensitive: false,
  schema: z.object({
    title: z.string().describe('عنوان المستند (مثل: Cover Letter — Software Engineer)'),
    subtitle: z.string().optional(),
    meta: z.array(z.string()).optional().describe('سطور معلومات: التاريخ، إلى، من، الشركة'),
    paragraphs: z.array(z.string()).optional().describe('فقرات النص الأساسي بالترتيب'),
    sections: z.array(z.object({
      heading: z.string(),
      paragraphs: z.array(z.string()).optional(),
      bullets: z.array(z.string()).optional(),
    })).optional(),
    signature: z.string().optional(),
    filename: z.string().optional().describe('اسم الملف مثل CoverLetter-Company.html'),
  }),
  execute: async (a) => {
    const html = renderDocHtml({
      title: a.title,
      subtitle: a.subtitle,
      meta: a.meta,
      paragraphs: a.paragraphs,
      sections: a.sections,
      signature: a.signature,
    });
    const base = (a.filename || a.title || 'Document')
      .replace(/\.(pdf|html)$/i, '')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .slice(0, 70);
    const meta = await saveArtifact(base + '.html', html);
    return { artifact: meta, note: 'أرفقت زر تحميل وزر طباعة/PDF في الشات.' };
  },
});
