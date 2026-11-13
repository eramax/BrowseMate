// ضمان الحقن وإرسال الأوامر للصفحة — إعادة حقن تلقائية للصفحات المعاد تحميلها
export async function ensureInjected(tabId: number) {
  try {
    await chrome.tabs.sendMessage(tabId, { __ta: 'page-tools', op: 'ping' });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content/page-tools.ts'] });
  }
}

export function sendToPage<T = unknown>(
  tabId: number,
  op: string,
  extra: Record<string, unknown> = {},
): Promise<{ ok: boolean; data?: T; error?: string }> {
  return chrome.tabs.sendMessage(tabId, { __ta: 'page-tools', op, ...extra });
}

export async function withPage<T>(tabId: number, op: string, extra: Record<string, unknown> = {}): Promise<{ ok: boolean; data?: T; error?: string }> {
  await ensureInjected(tabId);
  try {
    return await sendToPage<T>(tabId, op, extra);
  } catch {
    await ensureInjected(tabId); // الصفحة أُعيد تحميلها → حقن جديد ثم محاولة أخيرة
    return sendToPage<T>(tabId, op, extra);
  }
}
