// لقطة الشاشة — للتأكد البصري من حالة الصفحة
import { z } from 'zod';
import { register } from './registry';

register({
  name: 'screenshot',
  description: 'لقطة PNG للتبويب النشط (dataURL) للتأكد من حالة الصفحة.',
  sensitive: false,
  schema: z.object({}),
  execute: async (_a, ctx) => {
    const tab = await ctx.getActiveTab();
    return { dataUrl: await chrome.tabs.captureVisibleTab(tab.windowId!, { format: 'png' }) };
  },
});
