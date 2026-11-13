export type Lang = 'ar' | 'en';

export const dict = {
  ar: {
    appName: 'BrowseMate',
    tabs: { chat: 'شات', sessions: 'الجلسات', skills: 'المهارات', settings: 'الإعدادات' },
    chat: { placeholder: 'اطلب أي شيء… مثل: لخص هذه الصفحة', stop: 'إيقاف', send: 'إرسال', retry: 'إعادة المحاولة', approvePlan: 'موافقة على الخطة', refused: 'رفضت — الوكيل سيعيد التخطيط', thinking: 'يعمل…' },
    approval: { title: 'إجراء حساس', batchTitle: 'موافقة على تسلسل كامل', approve: 'موافقة', refuse: 'رفض', approveAll: 'موافقة على الكل' },
    sessions: { new: 'جلسة جديدة', delete: 'حذف', empty: 'لا جلسات بعد' },
    skills: { run: 'تشغيل', delete: 'حذف', export: 'تصدير', import: 'استيراد JSON', importPlaceholder: 'الصق ملف المهارة JSON هنا', none: 'لا مهارات محفوظة', params: 'معاملات' },
    settings: { title: 'الإعدادات', baseUrl: 'Base URL', apiKey: 'API Key', model: 'النموذج', fetchModels: 'جلب النماذج', language: 'اللغة', save: 'حفظ', saved: 'تم الحفظ ✓', fillFirst: 'أكمل Base URL وAPI Key أولاً' },
    errors: { generic: 'خطأ', settingsMissing: 'أكمل الإعدادات أولاً: Base URL + API key + النموذج.', refusedByUser: 'المستخدم رفض هذا الإجراء — أعد التخطيط أو اسأل.', userCancelled: 'ألغى المستخدم', debuggerDenied: 'لا يمكن فحص هذه الصفحة (مقيّدة من كروم)' },
  },
  en: {
    appName: 'BrowseMate',
    tabs: { chat: 'Chat', sessions: 'Sessions', skills: 'Skills', settings: 'Settings' },
    chat: { placeholder: 'Ask anything… e.g. summarize this page', stop: 'Stop', send: 'Send', retry: 'Retry', approvePlan: 'Approve plan', refused: 'Refused — agent will replan', thinking: 'Working…' },
    approval: { title: 'Sensitive action', batchTitle: 'Approve full sequence', approve: 'Approve', refuse: 'Refuse', approveAll: 'Approve all' },
    sessions: { new: 'New session', delete: 'Delete', empty: 'No sessions yet' },
    skills: { run: 'Run', delete: 'Delete', export: 'Export', import: 'Import JSON', importPlaceholder: 'Paste skill JSON here', none: 'No saved skills', params: 'Params' },
    settings: { title: 'Settings', baseUrl: 'Base URL', apiKey: 'API Key', model: 'Model', fetchModels: 'Fetch models', language: 'Language', save: 'Save', saved: 'Saved ✓', fillFirst: 'Fill Base URL and API Key first' },
    errors: { generic: 'Error', settingsMissing: 'Complete settings first: Base URL + API key + model.', refusedByUser: 'You refused this action — replanning or asking.', userCancelled: 'Cancelled by user', debuggerDenied: 'This page cannot be inspected (restricted by Chrome)' },
  },
} as const;

export type Dict = typeof dict.ar;

const pref: { lang: Lang } = { lang: 'ar' };
export function setLang(l: Lang) { pref.lang = l; }
export function t(key: string): string {
  let cur: unknown = dict[pref.lang];
  for (const part of key.split('.')) cur = (cur as any)?.[part];
  return typeof cur === 'string' ? cur : key;
}
export function isRtl(lang: Lang) { return lang === 'ar'; }
/** كشف لغة نص حر (رسالة) لتوجيه dir لكل رسالة على حدة */
export function textDir(text: string): 'rtl' | 'ltr' {
  const arabic = (text.match(/[\u0600-\u06FF]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return arabic > latin ? 'rtl' : 'ltr';
}
