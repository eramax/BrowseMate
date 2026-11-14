// فحص كود الموقع — chrome.debugger (CDP): أخطاء console + طلبات الشبكة + السكربتات (+ مصدر سكربت عند الطلب)
import { z } from 'zod';
import { register } from './registry';
import { t } from '../../shared/i18n';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

register({
  name: 'inspect_code',
  description:
    'يفحص التبويب النشط أو تبويباً محدداً (tabId): أخطاء console، طلبات الشبكة (url/status)، وقائمة السكربتات (ids). اختياريًا scriptId يجلب مصدر ذلك السكربت.',
  sensitive: false,
  idempotent: true,
  schema: z.object({
    scriptId: z.string().optional(),
    tabId: z.number().optional().describe('معرف تبويب خلفي (اختياري)'),
  }),
  execute: async (a, ctx) => {
    const tab = a.tabId !== undefined ? await chrome.tabs.get(a.tabId) : await ctx.getActiveTab();
    const target = { tabId: tab.id! };
    const c = { console: [] as string[], requests: [] as { url: string; status?: number; type: string }[], scripts: [] as { id: string; url: string }[] };
    try {
      await chrome.debugger.attach(target, '1.3');
    } catch {
      return { error: 'DEBUGGER_DENIED', message: t('errors.debuggerDenied') };
    }
    const onEvent = (src: chrome.debugger.Debuggee, method: string, params: any) => {
      if (src.tabId !== tab.id) return;
      if (method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(params.type))
        c.console.push(`${params.type}: ${params.args.map((x: any) => x.value ?? x.description).join(' ')}`);
      else if (method === 'Log.entryAdded') c.console.push(`${params.entry.level}: ${params.entry.text}`);
      else if (method === 'Network.responseReceived')
        c.requests.push({ url: params.response.url, status: params.response.status, type: params.type });
      else if (method === 'Runtime.scriptParsed') c.scripts.push({ id: params.scriptId, url: params.url });
    };
    chrome.debugger.onEvent.addListener(onEvent);
    try {
      await chrome.debugger.sendCommand(target, 'Runtime.enable');
      await chrome.debugger.sendCommand(target, 'Log.enable');
      await chrome.debugger.sendCommand(target, 'Network.enable');
      await chrome.debugger.sendCommand(target, 'Runtime.evaluate', { expression: 'void 0' }); // نبضة لجمع الموجود
      await sleep(500);
      if (a.scriptId) {
        const src: any = await chrome.debugger.sendCommand(target, 'Runtime.getScriptSource', { scriptId: a.scriptId });
        return { ...c, source: src?.scriptSource?.slice(0, 20000) };
      }
      return c;
    } finally {
      chrome.debugger.onEvent.removeListener(onEvent);
      await chrome.debugger.detach(target).catch(() => {});
    }
  },
});
