// أدوات الصفحة النشطة — read/summarize (قراءة) و fill/click (حساسة)
import { z } from 'zod';
import { register } from './registry';
import { withPage } from '../inject';

register({
  name: 'read_page',
  description:
    'يقرأ التبويب النشط: العنوان، URL، نص مقتضب، والعناصر التفاعلية (حقول/أزرار/روابط بمعرفات ta-N). اقرأه قبل أي تعديل.',
  sensitive: false,
  idempotent: true,
  schema: z.object({}),
  execute: async (_a, ctx) => withPage((await ctx.getActiveTab()).id!, 'read'),
});

register({
  name: 'summarize_page',
  description: 'يستخرج نص المقال من التبويب النشط — خذ النتيجة ولخّصها في ردك.',
  sensitive: false,
  idempotent: true,
  schema: z.object({}),
  execute: async (_a, ctx) => withPage((await ctx.getActiveTab()).id!, 'read'),
});

register({
  name: 'fill_fields',
  description: 'يملأ حقول النموذج في التبويب النشط. مرّر قيمًا بمعرفات العناصر من read_page.',
  sensitive: true,
  schema: z.object({
    values: z.array(z.object({ id: z.string(), value: z.string() })).min(1),
  }),
  execute: async (a, ctx) => withPage((await ctx.getActiveTab()).id!, 'fill', { values: a.values }),
});

register({
  name: 'click_element',
  description: 'ينقر عنصرًا في التبويب النشط بمعرفه ta-N أو بجزء من نصه.',
  sensitive: true,
  schema: z.object({ id: z.string().optional(), label: z.string().optional() }),
  execute: async (a, ctx) => withPage((await ctx.getActiveTab()).id!, 'click', { id: a.id, label: a.label }),
});
