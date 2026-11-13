// render_cv — النموذج يملأ بيانات JSON فقط، والتنسيق والتصدير هنا (أسرع كثيراً من كتابة HTML)
import { z } from 'zod';
import { register } from './registry';
import { renderCvHtml, type CvData } from '../cv-template';
import { saveArtifact } from '../artifacts';

const item = z.object({
  company: z.string(), role: z.string(), start: z.string().optional(), end: z.string().optional(),
  location: z.string().optional(), bullets: z.array(z.string()).min(1),
});

register({
  name: 'render_cv',
  description:
    'يبني سيرة ذاتية احترافية A4 من بيانات JSON منظمة (تنسيق ثابت ATS-friendly) ويعيد زر تحميل/طباعة. استخدمه بدل كتابة HTML. املأ الحقول من سيرة المستخدم المرفقة مع إعادة صياغة/ترتيب مناسبين للوظيفة. لا تختلق خبرات.',
  sensitive: false,
  schema: z.object({
    name: z.string().describe('الاسم الكامل'),
    title: z.string().optional().describe('المسمى المهني المستهدف'),
    email: z.string().optional(), phone: z.string().optional(), location: z.string().optional(),
    links: z.array(z.string()).optional(),
    summary: z.string().optional().describe('2-3 أسطر مخصصة للوظيفة'),
    skills: z.array(z.string()).optional().describe('مهارات مرتبة حسب صلة الوظيفة'),
    experience: z.array(item).optional(),
    education: z.array(z.object({
      school: z.string(), degree: z.string().optional(), start: z.string().optional(),
      end: z.string().optional(), details: z.string().optional(),
    })).optional(),
    projects: z.array(z.object({ name: z.string(), description: z.string().optional(), bullets: z.array(z.string()).optional() })).optional(),
    certifications: z.array(z.string()).optional(),
    languages: z.array(z.string()).optional(),
    filename: z.string().optional().describe('اسم الملف مثل CV-Company-Role.html'),
  }),
  execute: async (a) => {
    const d = a as CvData & { filename?: string };
    const html = renderCvHtml(d);
    const base = (d.filename || `CV-${d.name || 'Resume'}`).replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 70);
    const meta = await saveArtifact(base + '.html', html);
    return {
      artifact: meta,
      note: 'أرفقت زر تحميل وزر طباعة/PDF في الشات. لا حاجة لأي أداة أخرى.',
    };
  },
});
