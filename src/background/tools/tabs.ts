// أدوات التبويبات والتنقل — list (قراءة) و navigate/open/close (حساسة) و group_tabs (قراءة)
import { z } from 'zod';
import { register } from './registry';
import { isGroupableUrl } from '../intent';
import { planGroups } from '../tab-grouping';
import { resolveTabId } from './tab-id';

register({
  name: 'list_tabs',
  description:
    'يعرض كل النوافذ والتبويبات (id, title, url, pinned, groupId, windowId, index, active). التبويبات المثبتة تظهر هنا لكن group_tabs يستثنيها افتراضياً.',
  sensitive: false,
  idempotent: true,
  schema: z.object({}),
  execute: async () =>
    (await chrome.tabs.query({})).map((t) => ({
      id: t.id,
      title: (t.title ?? '').slice(0, 160),
      url: (t.url ?? '').slice(0, 240),
      pinned: Boolean(t.pinned),
      groupable: isGroupableUrl(t.url),
      groupId: t.groupId,
      windowId: t.windowId,
      index: t.index,
      active: t.active,
    })),
});

register({
  name: 'navigate',
  description:
    'ينقل التبويب النشط أو تبويباً محدداً (tabId) إلى رابط وينتظر اكتمال التحميل (أو 15 ثانية). مع tabId لا يفعّل التبويب — مناسب للعمل في الخلفية. للقراءة فقط استخدم read_page بنفس tabId.',
  sensitive: true,
  schema: z.object({ url: z.string().url(), tabId: z.number().optional() }),
  execute: async (a, ctx) => {
    const targetId = await resolveTabId(a.tabId, ctx);
    if (targetId == null) return { error: 'NO_ACTIVE_TAB', message: 'لا يوجد تبويب نشط.' };
    const tab = await chrome.tabs.get(targetId);
    // المستمع قبل التنقل حتى لا تفوتنا صفحة تُحمّل فوراً
    await new Promise<void>((resolve) => {
      const timer = setTimeout(finish, 15000);
      function finish() { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(done); resolve(); }
      const done = (tabId: number, info: { status?: string }) => {
        if (tabId === tab.id && info.status === 'complete') finish();
      };
      chrome.tabs.onUpdated.addListener(done);
      chrome.tabs.update(tab.id!, { url: a.url }).catch(() => finish());
    });
    return { navigated: a.url, tabId: tab.id };
  },
});

register({
  name: 'open_tab',
  description:
    'يفتح تبويباً جديداً في الخلفية افتراضياً ويعيد tabId. اقرأه بـ read_page({tabId}) أو انقله بـ navigate({tabId})، وأغلقه بـ close_tab. لا يغيّر التبويب النشط.',
  sensitive: true,
  schema: z.object({ url: z.string().url(), active: z.boolean().optional() }),
  execute: async (a) => {
    const tab = await chrome.tabs.create({ url: a.url, active: a.active ?? false });
    return { tabId: tab.id, url: tab.url, active: tab.active };
  },
});

register({
  name: 'close_tab',
  description: 'يغلق تبويبًا بمعرفه (من list_tabs).',
  sensitive: true,
  schema: z.object({ tabId: z.number() }),
  execute: async (a) => {
    if (!a.tabId || a.tabId <= 0) return { error: 'BAD_TAB_ID', message: 'tabId غير صالح.' };
    await chrome.tabs.remove(a.tabId);
    return { closed: a.tabId };
  },
});

const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'] as const;

const groupSpec = z.object({
  title: z.string().optional().describe('اسم المجموعة'),
  color: z.enum(GROUP_COLORS).optional().describe('لون المجموعة'),
  tabIds: z.array(z.number()).min(1).describe('معرفات التبويبات من list_tabs'),
});

register({
  name: 'group_tabs',
  description:
    'ينشئ مجموعة أو عدة مجموعات تبويبات في نداء واحد. استخدم groups:[{title,color,tabIds},...] بعد list_tabs مرة واحدة. يستثني التبويبات المثبتة (pinned) افتراضياً؛ لا تمرر includePinned:true إلا إذا طلب المستخدم صراحةً ضم المثبتة. يرجع groupId لكل مجموعة — لا تدّعِ النجاح بدونه.',
  sensitive: false,
  schema: z.object({
    groups: z.array(groupSpec).min(1).optional().describe('مجموعات متعددة في نداء واحد (المفضّل)'),
    tabIds: z.array(z.number()).min(1).optional().describe('لمجموعة واحدة فقط (توافق قديم)'),
    title: z.string().optional(),
    color: z.enum(GROUP_COLORS).optional(),
    includePinned: z.boolean().optional().describe('ضم التبويبات المثبتة — فقط بطلب صريح'),
  }),
  execute: async (a) => {
    const specs = a.groups?.length
      ? a.groups
      : a.tabIds?.length
        ? [{ title: a.title, color: a.color, tabIds: a.tabIds }]
        : [];
    if (!specs.length) return { error: 'مرر groups أو tabIds — لا توجد تبويبات.' };

    const allTabs = await chrome.tabs.query({});
    const planned = planGroups(
      specs,
      allTabs.map((t) => ({
        id: t.id!,
        title: t.title,
        url: t.url,
        pinned: t.pinned,
        windowId: t.windowId,
      })),
      a.includePinned === true,
    );

    type GroupResult = {
      title?: string;
      color?: string;
      tabIds: number[];
      groupIds: Array<{ windowId: number; groupId: number; tabIds: number[] }>;
      skippedPinned: Array<{ id: number; title: string }>;
      skippedUnsupported: Array<{ id: number; title: string; url: string }>;
      missing: number[];
      error?: string;
      failures?: Array<{ windowId: number; error: string }>;
    };
    const results: GroupResult[] = [];

    for (const plan of planned) {
      const base = {
        title: plan.title,
        color: plan.color,
        skippedPinned: plan.skippedPinned,
        skippedUnsupported: plan.skippedUnsupported,
        missing: plan.missing,
      };

      if (!plan.eligible.length) {
        results.push({ ...base, tabIds: [], groupIds: [], error: plan.error ?? 'NO_ELIGIBLE_TABS' });
        continue;
      }

      // المجموعة لا تعبر النوافذ: نجمع تبويبات كل نافذة على حدة.
      const byWindow = new Map<number, number[]>();
      for (const t of plan.eligible) {
        const list = byWindow.get(t.windowId) ?? [];
        list.push(t.id);
        byWindow.set(t.windowId, list);
      }

      const groupIds: GroupResult['groupIds'] = [];
      const failures: Array<{ windowId: number; error: string }> = [];
      for (const [windowId, tabIds] of byWindow) {
        try {
          const groupId = (await chrome.tabs.group({ tabIds: tabIds as [number, ...number[]] })) as number;
          const props: Record<string, unknown> = {};
          if (plan.title !== undefined) props.title = plan.title;
          if (plan.color !== undefined) props.color = plan.color;
          if (Object.keys(props).length) await chrome.tabGroups.update(groupId, props as any);
          groupIds.push({ windowId, groupId, tabIds });
        } catch (e: any) {
          failures.push({ windowId, error: e?.message ?? String(e) });
        }
      }

      results.push({
        ...base,
        tabIds: plan.eligible.map((t) => t.id),
        groupIds,
        ...(failures.length
          ? { error: groupIds.length ? 'PARTIAL_GROUPING' : 'GROUPING_FAILED', failures }
          : {}),
      });
    }

    return {
      groups: results,
      grouped: results.reduce((n, r) => n + r.groupIds.reduce((m, g) => m + g.tabIds.length, 0), 0),
      skippedPinned: results.reduce((n, r) => n + r.skippedPinned.length, 0),
      skippedUnsupported: results.reduce((n, r) => n + r.skippedUnsupported.length, 0),
      missing: results.reduce((n, r) => n + r.missing.length, 0),
    };
  },
});
