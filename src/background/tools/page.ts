// أدوات الصفحة النشطة — read/summarize (قراءة) و fill/click (حساسة)
import { z } from 'zod';
import { register } from './registry';
import { withPage } from '../inject';
import { resolveTabId } from './tab-id';

register({
  name: 'read_page',
  description:
    'يقرأ التبويب النشط أو تبويباً محدداً (tabId): العنوان، URL، نص مقتضب، والعناصر التفاعلية (حقول/أزرار/روابط بمعرفات ta-N). اقرأه قبل أي تعديل.',
  sensitive: false,
  idempotent: true,
  schema: z.object({ tabId: z.number().optional().describe('معرف تبويب خلفي (اختياري)') }),
  execute: async (a, ctx) => {
    const tabId = await resolveTabId(a.tabId, ctx);
    if (tabId == null) return { error: 'NO_ACTIVE_TAB', message: 'لا يوجد تبويب نشط.' };
    return withPage(tabId, 'read');
  },
});

register({
  name: 'summarize_page',
  description: 'يستخرج نص المقال من التبويب النشط أو تبويب محدد (tabId) — خذ النتيجة ولخّصها في ردك.',
  sensitive: false,
  idempotent: true,
  schema: z.object({ tabId: z.number().optional().describe('معرف تبويب خلفي (اختياري)') }),
  execute: async (a, ctx) => {
    const tabId = await resolveTabId(a.tabId, ctx);
    if (tabId == null) return { error: 'NO_ACTIVE_TAB', message: 'لا يوجد تبويب نشط.' };
    return withPage(tabId, 'read');
  },
});

register({
  name: 'fill_fields',
  description: 'يملأ حقول النموذج في التبويب النشط. مرّر قيمًا بمعرفات العناصر من read_page.',
  sensitive: true,
  schema: z.object({
    tabId: z.number().optional().describe('معرف تبويب خلفي (اختياري)'),
    values: z.array(z.object({ id: z.string(), value: z.string() })).min(1),
  }),
  execute: async (a, ctx) => {
    const tabId = await resolveTabId(a.tabId, ctx);
    if (tabId == null) return { error: 'NO_ACTIVE_TAB', message: 'لا يوجد تبويب نشط.' };
    return withPage(tabId, 'fill', { values: a.values });
  },
});

register({
  name: 'click_element',
  description: 'ينقر عنصرًا في التبويب النشط بمعرفه ta-N أو بجزء من نصه.',
  sensitive: true,
  schema: z.object({
    tabId: z.number().optional().describe('معرف تبويب خلفي (اختياري)'),
    id: z.string().optional(),
    label: z.string().optional(),
  }),
  execute: async (a, ctx) => {
    const tabId = await resolveTabId(a.tabId, ctx);
    if (tabId == null) return { error: 'NO_ACTIVE_TAB', message: 'لا يوجد تبويب نشط.' };
    return withPage(tabId, 'click', { id: a.id, label: a.label });
  },
});
