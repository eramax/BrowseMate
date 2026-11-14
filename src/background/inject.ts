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

export async function ensureInjected(tabId: number, ns = 'page-tools'): Promise<boolean> {
  if (await ping(tabId, ns)) return true;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: contentScriptFiles() });
  } catch {
    return false; // صفحات chrome:// وغيرها مقيّدة
  }
  return ping(tabId, ns);
}

export async function withPage<T = unknown>(
  tabId: number,
  op: string,
  extra: Record<string, unknown> = {},
): Promise<{ ok: boolean; data?: T; error?: string }> {
  if (!(await ensureInjected(tabId, 'page-tools')))
    return { ok: false, error: 'PAGE_RESTRICTED: هذه الصفحة لا يمكن التحكم بها (مقيّدة من كروم)' };
  return chrome.tabs.sendMessage(tabId, { __ta: 'page-tools', op, ...extra });
}

export async function withReader<T = unknown>(
  tabId: number,
  op: string,
  extra: Record<string, unknown> = {},
): Promise<{ ok: boolean; data?: T; error?: string; message?: string }> {
  if (!(await ensureInjected(tabId, 'reader')))
    return { ok: false, error: 'PAGE_RESTRICTED', message: 'هذه الصفحة لا تسمح بحقن القارئ (chrome:// أو متجر الإضافات).' };
  return chrome.tabs.sendMessage(tabId, { __ta: 'reader', op, ...extra });
}
