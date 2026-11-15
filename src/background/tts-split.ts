// تقسيم النص إلى مقاطع قصيرة لـ Edge.
// Edge Read Aloud يتوقف/ينتهي مهلته مع النصوص الطويلة (~1000 حرف)،
// لذا نقرأ كل مقطع (<= 280 حرفاً) على حدة ثم ننتقل للتالي مع prefetch.
// المفاتيح تسمح بإعادة استخدام الصوت المخزّن عند التكرار أو التحميل.

export interface SpeechSegment {
  text: string;
  key: string;
}

const MAX_SEGMENT = 280;

function hash(text: string): number {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

export function speechKey(text: string, voice: string, rate: number): string {
  return `tts:${hash(text).toString(36)}:${hash(`${voice}|${rate}`).toString(36)}:${text.length}`;
}

function bestBreak(s: string, max: number): number {
  const window = s.slice(0, max);
  const markers = ['\n\n', '\n', '. ', '؟ ', '! ', '? ', '。', '، ', ', ', '; ', '؛ '];
  for (const m of markers) {
    const i = window.lastIndexOf(m);
    if (i > max * 0.35) return i + m.length;
  }
  const space = window.lastIndexOf(' ');
  if (space > max * 0.35) return space + 1;
  return max;
}

/** تقسيم يحافظ على أكبر قدر من النص، دون مقاطع فارغة. */
export function splitForSpeech(text: string, max = MAX_SEGMENT): string[] {
  const clean = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!clean) return [];
  if (clean.length <= max) return [clean];

  const out: string[] = [];
  let rest = clean;
  while (rest.length > max) {
    const cut = Math.max(1, Math.min(rest.length, bestBreak(rest, max)));
    const part = rest.slice(0, cut).trim();
    if (part) out.push(part);
    rest = rest.slice(cut).replace(/^\s+/, '');
  }
  if (rest.trim()) out.push(rest.trim());
  return out;
}

export function buildSpeechSegments(text: string, voice: string, rate: number): SpeechSegment[] {
  return splitForSpeech(text).map((part) => ({ text: part, key: speechKey(part, voice, rate) }));
}
