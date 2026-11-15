// حقن/استدعاء content scripts — يدعم أكثر من مساحة أسماء (page-tools / reader)
// الصفحة مُحقنة تلقائياً عبر manifest content_scripts، وهذا احتياط للصفحات المفتوحة قبل التثبيت.
// إعادة الحقن مرة واحدة عند سباق التنقل تمنع أخطاء "Receiving end does not exist".

function contentScriptFiles(): string[] {
  const scripts = chrome.runtime.getManifest().content_scripts ?? [];
  return scripts.flatMap((s) => s.js ?? []);
}

async function ping(tabId: number, ns: string): Promise<boolean> {
  try {
    const res: any = await chrome.tabs.sendMessage(tabId, { __ta: ns, op: 'ping' });
    return Boolean(res?.ok);
  } catch {
    return false;
  }
}

export async function ensureInjected(
  tabId: number,
  ns = 'page-tools',
): Promise<{ ok: boolean; error?: string }> {
  if (await ping(tabId, ns)) return { ok: true };
  let injectError = '';
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: contentScriptFiles() });
  } catch (e) {
    injectError = e instanceof Error ? e.message : String(e);
  }
  if (await ping(tabId, ns)) return { ok: true };
  return { ok: false, error: injectError };
}

async function tabInfo(tabId: number): Promise<string> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.url || tab.title || '';
  } catch {
    return '';
  }
}

function isMissingReceiver(e: unknown): boolean {
  return /Receiving end does not exist|Could not establish connection|message port closed/i.test(
    e instanceof Error ? e.message : String(e),
  );
}

/** إرسال مع إعادة حقن واحدة عند تغيّر الصفحة بين الفحص والإرسال. */
async function sendWithRetry<T>(
  tabId: number,
  ns: string,
  msg: Record<string, unknown>,
): Promise<{ ok: boolean; data?: T; error?: string; message?: string }> {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch (e) {
    if (!isMissingReceiver(e)) throw e;
    const inj = await ensureInjected(tabId, ns);
    if (!inj.ok) return { ok: false, error: 'PAGE_RESTRICTED', message: inj.error };
    return chrome.tabs.sendMessage(tabId, msg);
  }
}

export async function withPage<T = unknown>(
  tabId: number,
  op: string,
  extra: Record<string, unknown> = {},
): Promise<{ ok: boolean; data?: T; error?: string; message?: string }> {
  const inj = await ensureInjected(tabId, 'page-tools');
  if (!inj.ok) {
    const info = await tabInfo(tabId);
    return {
      ok: false,
      error: 'PAGE_RESTRICTED',
      message: `هذه الصفحة لا يمكن التحكم بها${info ? ` (${info})` : ''}${inj.error ? ` — ${inj.error}` : ''}`,
    };
  }
  try {
    return await sendWithRetry<T>(tabId, 'page-tools', { __ta: 'page-tools', op, ...extra });
  } catch (e) {
    const info = await tabInfo(tabId);
    return {
      ok: false,
      error: 'PAGE_RESTRICTED',
      message: `تعذر الوصول إلى الصفحة${info ? ` (${info})` : ''}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export async function withReader<T = unknown>(
  tabId: number,
  op: string,
  extra: Record<string, unknown> = {},
): Promise<{ ok: boolean; data?: T; error?: string; message?: string }> {
  const inj = await ensureInjected(tabId, 'reader');
  if (!inj.ok) {
    const info = await tabInfo(tabId);
    return {
      ok: false,
      error: 'PAGE_RESTRICTED',
      message: `هذه الصفحة لا تسمح بحقن القارئ${info ? ` (${info})` : ''}${inj.error ? ` — ${inj.error}` : ''}. جرّب فتح الرابط في تبويب عادي.`,
    };
  }
  try {
    return await sendWithRetry<T>(tabId, 'reader', { __ta: 'reader', op, ...extra });
  } catch (e) {
    const info = await tabInfo(tabId);
    return {
      ok: false,
      error: 'PAGE_RESTRICTED',
      message: `تعذر الوصول إلى قارئ الصفحة${info ? ` (${info})` : ''}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
