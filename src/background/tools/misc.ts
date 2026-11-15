// لقطة الشاشة — للتأكد البصري من حالة الصفحة
import { z } from 'zod';
import { register } from './registry';
import { resolveTabId } from './tab-id';

register({
  name: 'screenshot',
  description: 'لقطة PNG للتبويب النشط (dataURL) للتأكد من حالة الصفحة.',
  sensitive: false,
  idempotent: true,
  schema: z.object({}),
  execute: async (_a, ctx) => {
    const tabId = await resolveTabId(undefined, ctx);
    if (tabId == null) return { error: 'NO_ACTIVE_TAB', message: 'لا يوجد تبويب.' };
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active) return { error: 'TAB_NOT_ACTIVE', message: 'تبويب التشغيل ليس نشطاً؛ لا يمكن أخذ لقطة مرئية صحيحة. اطلب من المستخدم تنشيطه.' };
    return { dataUrl: await chrome.tabs.captureVisibleTab(tab.windowId!, { format: 'png' }) };
  },
});
