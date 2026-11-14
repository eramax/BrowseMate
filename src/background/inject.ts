// حقن/استدعاء content scripts — يدعم أكثر من مساحة أسماء (page-tools / reader)
// الصفحة مُحقنة تلقائياً عبر manifest content_scripts، وهذا احتياط للصفحات المفتوحة قبل التثبيت.

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

export async function withPage<T = unknown>(
  tabId: number,
  op: string,
  extra: Record<string, unknown> = {},
): Promise<{ ok: boolean; data?: T; error?: string }> {
  const inj = await ensureInjected(tabId, 'page-tools');
  if (!inj.ok) {
    const info = await tabInfo(tabId);
    return {
      ok: false,
      error: `PAGE_RESTRICTED: هذه الصفحة لا يمكن التحكم بها${info ? ` (${info})` : ''}${inj.error ? ` — ${inj.error}` : ''}`,
    };
  }
  return chrome.tabs.sendMessage(tabId, { __ta: 'page-tools', op, ...extra });
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
  return chrome.tabs.sendMessage(tabId, { __ta: 'reader', op, ...extra });
}
