// الصفحة مُحقنة تلقائياً عبر manifest content_scripts — هذه طبقة أمان للصفحات المفتوحة قبل تثبيت الإضافة
// المسار المبني يختلف (hash) — نقرأه من manifest مباشرة
function contentScriptFile(): string {
  return chrome.runtime.getManifest().content_scripts![0].js![0];
}

export async function ensureInjected(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, { __ta: 'page-tools', op: 'ping' });
    return true;
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: [contentScriptFile()] });
      return true;
    } catch {
      return false; // صفحات chrome:// وغيرها مقيّدة
    }
  }
}

export async function withPage<T = unknown>(
  tabId: number,
  op: string,
  extra: Record<string, unknown> = {},
): Promise<{ ok: boolean; data?: T; error?: string }> {
  if (!(await ensureInjected(tabId)))
    return { ok: false, error: 'PAGE_RESTRICTED', message: 'هذه الصفحة لا يمكن التحكم بها (مقيّدة من كروم)' };
  return chrome.tabs.sendMessage(tabId, { __ta: 'page-tools', op, ...extra });
}
