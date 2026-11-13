// تصدير PDF — HTML يُفتح في تبويب معزول ثم Page.printToPDF عبر CDP (دعم عربي كامل من محرك كروم)
import { z } from 'zod';
import { register } from './registry';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitComplete(tabId: number, timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t) return;
    if (t.status === 'complete') return;
    await sleep(150);
  }
}

register({
  name: 'export_pdf',
  description:
    'يولّد ملف PDF من HTML كامل (A4) ويحمّله كملف. استخدمه لتوليد السيرة الذاتية: مرّر مستند HTML كاملاً (مع <style>) واسم ملف مناسب.',
  sensitive: true,
  schema: z.object({
    html: z.string().min(20).describe('مستند HTML كامل مع التنسيق'),
    filename: z.string().describe('اسم الملف بدون مسار، ينتهي بـ .pdf'),
  }),
  execute: async (a) => {
    const filename = String(a.filename || 'document.pdf').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
    const url = 'data:text/html;charset=utf-8,' + encodeURIComponent(String(a.html));
    if (url.length > 1_800_000) return { error: 'HTML كبير جداً (حد ~1.8MB)' };

    const tab = await chrome.tabs.create({ url, active: false });
    const tabId = tab.id!;
    await waitComplete(tabId);
    const target = { tabId };
    let attached = false;
    try {
      await chrome.debugger.attach(target, '1.3');
      attached = true;
      await chrome.debugger.sendCommand(target, 'Page.enable');
      // انتظار قصير للخطوط/التنسيق
      await sleep(350);
      const res: any = await chrome.debugger.sendCommand(target, 'Page.printToPDF', {
        printBackground: true,
        paperWidth: 8.27,
        paperHeight: 11.69,
        marginTop: 0.35,
        marginBottom: 0.35,
        marginLeft: 0.35,
        marginRight: 0.35,
      });
      const base64 = res?.data as string;
      if (!base64) return { error: 'فشل توليد PDF من الصفحة' };
      const dataUrl = 'data:application/pdf;base64,' + base64;
      try {
        const downloadId = await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
        return { downloaded: true, filename, downloadId, sizeKb: Math.round((base64.length * 3) / 4 / 1024) };
      } catch {
        // بديل: افتح PDF في تبويب ليحفظه المستخدم من عارض كروم
        await chrome.tabs.create({ url: dataUrl, active: true });
        return { downloaded: false, openedInTab: true, filename, note: 'اضغط تنزيل في عارض PDF' };
      }
    } catch (e: any) {
      return { error: 'PDF_FAILED', message: `تعذر توليد PDF: ${e?.message ?? e}` };
    } finally {
      if (attached) await chrome.debugger.detach(target).catch(() => {});
      await chrome.tabs.remove(tabId).catch(() => {});
    }
  },
});
