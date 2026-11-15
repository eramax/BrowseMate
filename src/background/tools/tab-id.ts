// تبويب الهدف: tabId=0 أو سالب/غير صالح يعني التبويب النشط.
// بعض النماذج تمرر 0 بدل حذف الحقل، وكان ذلك يسبب PAGE_RESTRICTED على صفحات عادية.
import type { ToolContext } from '../../shared/types';

export async function resolveTabId(tabId: number | undefined, ctx: ToolContext): Promise<number | null> {
  if (typeof tabId === 'number' && Number.isFinite(tabId) && tabId > 0) return tabId;
  // تبويب التشغيل: لا ننتقل إلى تبويب آخر إذا غيّر المستخدم التركيز أثناء العمل
  if (typeof ctx.defaultTabId === 'number' && ctx.defaultTabId > 0) {
    const still = await chrome.tabs.get(ctx.defaultTabId).catch(() => null);
    if (still?.id) return still.id;
  }
  const tab = await ctx.getActiveTab();
  return tab?.id ?? null;
}
