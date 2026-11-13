// أدوات التبويبات والتنقل — list (قراءة) و navigate/open/close (حساسة) و group_tabs (قراءة)
import { z } from 'zod';
import { register } from './registry';

register({
  name: 'list_tabs',
  description: 'يعرض كل النوافذ والتبويبات وحالتها (مجموعة/غير مجمع، النشط منها).',
  sensitive: false,
  schema: z.object({}),
  execute: async () =>
    (await chrome.tabs.query({})).map((t) => ({
      id: t.id, title: t.title, url: t.url, groupId: t.groupId, active: t.active,
    })),
});

register({
  name: 'navigate',
  description: 'ينقل التبويب النشط إلى رابط وينتظر اكتمال التحميل (أو 15 ثانية).',
  sensitive: true,
  schema: z.object({ url: z.string().url() }),
  execute: async (a, ctx) => {
    const tab = await ctx.getActiveTab();
    await chrome.tabs.update(tab.id!, { url: a.url });
    await new Promise<void>((resolve) => {
      const timer = setTimeout(finish, 15000);
      function finish() { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(done); resolve(); }
      const done = (tabId: number, info: chrome.tabs.TabChangeInfo) => {
        if (tabId === tab.id && info.status === 'complete') finish();
      };
      chrome.tabs.onUpdated.addListener(done);
    });
    return { navigated: a.url };
  },
});

register({
  name: 'open_tab',
  description: 'يفتح تبويبًا جديدًا (في الخلفية افتراضيًا).',
  sensitive: true,
  schema: z.object({ url: z.string().url(), active: z.boolean().optional() }),
  execute: async (a) => chrome.tabs.create({ url: a.url, active: a.active ?? false }),
});

register({
  name: 'close_tab',
  description: 'يغلق تبويبًا بمعرفه (من list_tabs).',
  sensitive: true,
  schema: z.object({ tabId: z.number() }),
  execute: async (a) => { await chrome.tabs.remove(a.tabId); return { closed: a.tabId }; },
});

register({
  name: 'group_tabs',
  description: 'ينشئ مجموعة تبويبات باسم ولون من قائمة معرفات تبويبات.',
  sensitive: false,
  schema: z.object({
    tabIds: z.array(z.number()).min(1),
    title: z.string().optional(),
    color: z.enum(['grey','blue','red','yellow','green','pink','purple','cyan','orange']).optional(),
  }),
  execute: async (a) => {
    const groupId = await chrome.tabs.group({ tabIds: a.tabIds });
    await chrome.tabGroups.update(groupId, { title: a.title, color: a.color });
    return { groupId, title: a.title };
  },
});
