// اختيار الصوت المناسب حسب لغة النص — منطق نقي بلا chrome ليكون قابلاً للاختبار.
// يستخدمه مشغّل Edge ومشغّل المتصفح معاً حتى لا يختلف الاختيار بين المسارين.

export type TextLang = 'ar' | 'en' | 'other';

export const DEFAULT_EDGE_AR = 'ar-EG-ShakirNeural';
export const DEFAULT_EDGE_EN = 'en-US-EmmaMultilingualNeural';
export const DEFAULT_EDGE_OTHER = 'en-US-EmmaMultilingualNeural';

export interface BrowserVoiceLike {
  name: string;
  lang: string;
  supportsWord?: boolean;
}

/** لغة النص هي الحكم الأول: عربي إن كانت حروفه العربية ≥ اللاتينية. */
export function detectTextLang(text: string): TextLang {
  const sample = (text || '').slice(0, 8000);
  const ar = (sample.match(/[\u0600-\u06FF]/g) || []).length;
  const latin = (sample.match(/[A-Za-z]/g) || []).length;
  if (ar > 0 && ar >= latin) return 'ar';
  if (latin > 0) return 'en';
  return 'other';
}

/** صوت Edge الافتراضي حسب النص (أو الصوت المطلوب إن وُجد). */
export function edgeVoiceFor(text: string, requested?: string): string {
  if (requested) return requested;
  const lang = detectTextLang(text);
  if (lang === 'ar') return DEFAULT_EDGE_AR;
  if (lang === 'en') return DEFAULT_EDGE_EN;
  return DEFAULT_EDGE_OTHER;
}

/**
 * صوت المتصفح الاحتياطي.
 * - لا نثق بصوت Edge مطلوب عند السقوط إلى المتصفح: نتحقق أنه صوت متصفح فعلاً.
 * - إن لم يوجد صوت يطابق اللغة نعود إلى أي صوت متاح بدل الصوت الافتراضي الفارغ.
 */
export function pickBrowserVoice(
  text: string,
  voices: BrowserVoiceLike[],
  requested?: string,
): string {
  if (!Array.isArray(voices) || !voices.length) return '';
  if (requested && voices.some((v) => v.name === requested)) return requested;

  const lang = detectTextLang(text);
  const prefix = lang === 'ar' ? 'ar' : lang === 'en' ? 'en' : '';
  let matches = prefix ? voices.filter((v) => String(v.lang || '').toLowerCase().startsWith(prefix)) : voices;

  if (!matches.length) {
    // نص بلغة أخرى: فضّل الأصوات متعددة اللغات ثم الإنجليزية
    matches = voices.filter((v) => /multilingual/i.test(v.name));
    if (!matches.length) matches = voices.filter((v) => String(v.lang || '').toLowerCase().startsWith('en'));
    if (!matches.length) matches = voices;
  }

  const preferred = lang === 'ar'
    ? ['ar-eg', 'ar-sa', 'ar-ae']
    : lang === 'en'
      ? ['en-us', 'en-gb']
      : [];
  const inPreferred = (v: BrowserVoiceLike) =>
    preferred.some((p) => String(v.lang || '').toLowerCase().startsWith(p));

  return (
    matches.find((v) => v.supportsWord && inPreferred(v)) ||
    matches.find((v) => v.supportsWord) ||
    matches.find(inPreferred) ||
    matches[0]
  ).name;
}
