// إعدادات المستخدم — تُحفظ محلياً على الجهاز فقط (المواصفة §6)
import { chromeKV } from '../shared/storage';

export interface Settings {
  baseUrl: string;
  apiKey: string;
  model: string;
  lang: 'ar' | 'en';
  approvalMode: 'sensitive' | 'always' | 'never';
  /** تسجيل تشخيصي مفصل لكل جلسة */
  debug: boolean;
}

const DEFAULTS: Settings = { baseUrl: '', apiKey: '', model: '', lang: 'en', approvalMode: 'sensitive', debug: false };

export async function loadSettings(): Promise<Settings> {
  return { ...DEFAULTS, ...(await chromeKV.get<Partial<Settings>>('settings')) };
}

export async function saveSettings(patch: Partial<Settings>) {
  await chromeKV.set('settings', { ...DEFAULTS, ...(await loadSettings()), ...patch });
}

export function isConfigured(s: Settings) {
  return Boolean(s.baseUrl && s.apiKey && s.model);
}
