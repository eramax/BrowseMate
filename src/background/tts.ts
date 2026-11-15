// تشغيل النطق عبر chrome.tts (أصوات المتصفح) وإرسال أحداث الكلمات للتظليل.
// المحتوى/الأزرار في content script، والصوت هنا لأن content scripts لا تملك chrome.tts.

export interface TtsVoice {
  name: string;
  lang: string;
  remote: boolean;
  supportsWord: boolean;
}

export interface BrowserTtsEvent {
  type: 'start' | 'word' | 'end' | 'interrupted' | 'cancelled' | 'error' | 'paused' | 'resumed';
  charIndex?: number;
  length?: number;
  word?: string;
  error?: string;
}

export interface TtsSpeakResult {
  ok: boolean;
  error?: string;
  /** الصوت الفعلي المستخدم (قد يكون فارغاً = الصوت الافتراضي) */
  voice?: string;
}

function sendToTab(tabId: number | null, data: unknown): void {
  if (tabId == null) return;
  try {
    void chrome.tabs.sendMessage(tabId, data).catch(() => {});
  } catch {
    /* التبويب أُغلق */
  }
}

function wordAt(text: string, charIndex: number, length: number): string {
  const start = Math.max(0, Math.min(charIndex || 0, text.length));
  if (length > 0) return text.substring(start, Math.min(text.length, start + length));
  let i = start;
  while (i < text.length && /\s/.test(text[i])) i++;
  let end = i;
  while (end < text.length && !/\s/.test(text[end])) end++;
  return text.substring(i, end);
}

function emit(
  tabId: number | null,
  onEvent: ((e: BrowserTtsEvent) => void) | undefined,
  event: BrowserTtsEvent,
): void {
  try { onEvent?.(event); } catch { /* ignore */ }
  if (!event.type) return;
  if (event.type === 'word') {
    sendToTab(tabId, {
      action: 'tts-event',
      type: 'word',
      charIndex: event.charIndex || 0,
      length: event.length || 0,
      word: event.word || '',
    });
    return;
  }
  sendToTab(tabId, { action: 'tts-event', type: event.type, ...(event.error ? { error: event.error } : {}) });
}

/**
 * بدء قراءة نص عبر أصوات المتصفح.
 * - يوقف أي نطق سابق أولاً (مصدر واحد للحقيقة).
 * - إن فشل الصوت المطلوب يعيد المحاولة بدون voiceName، ثم بدون اشتراط word events.
 * - يعيد الصوت الفعلي حتى تعرض البطاقة الصوت الصحيح لا اسماً فارغاً.
 */
export function ttsSpeak(
  text: string,
  rate: number | undefined,
  voice: string | undefined,
  tabId: number | null,
  onEvent?: (e: BrowserTtsEvent) => void,
): Promise<TtsSpeakResult> {
  const clean = (text ?? '').trim();
  if (!clean) return Promise.resolve({ ok: false, error: 'EMPTY_TEXT' });

  const usedVoice = String(voice || '');
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (result: TtsSpeakResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    // بعض الأصوات لا ترسل start أبداً؛ لا نعلّق الأداة إلى الأبد ولا ندّعي نجاحاً كاذباً
    timer = setTimeout(() => {
      try { chrome.tts.stop(); } catch { /* ignore */ }
      finish({ ok: false, error: 'TTS_START_TIMEOUT', voice: usedVoice });
    }, 4000);

    const handler = (event: BrowserTtsEvent): void => {
      try { onEvent?.(event); } catch { /* ignore */ }
      if (event.type === 'start') finish({ ok: true, voice: usedVoice });
      else if (event.type === 'error') finish({ ok: false, error: event.error || 'TTS_ERROR', voice: usedVoice });
    };

    try {
      chrome.tts.stop();
    } catch {
      /* ignore */
    }

    const base: chrome.tts.TtsOptions = {
      rate: Math.min(2, Math.max(0.5, Number(rate) || 1)),
      enqueue: false,
      requiredEventTypes: ['word'],
      desiredEventTypes: ['start', 'word', 'end', 'interrupted', 'cancelled', 'error', 'pause', 'resume'],
      onEvent: (event) => {
        const rawType = String(event.type);
        const type = rawType as BrowserTtsEvent['type'];
        if (type === 'start') emit(tabId, handler, { type: 'start' });
        else if (type === 'word') {
          emit(tabId, handler, {
            type: 'word',
            charIndex: event.charIndex || 0,
            length: event.length || 0,
            word: (event as any).word || wordAt(clean, event.charIndex || 0, event.length || 0),
          });
        } else if (type === 'end') emit(tabId, handler, { type: 'end' });
        else if (type === 'interrupted' || type === 'cancelled') {
          emit(tabId, handler, { type: 'interrupted' });
        } else if (type === 'error') {
          emit(tabId, handler, { type: 'error', error: event.errorMessage || 'TTS_ERROR' });
        } else if (rawType === 'pause' || rawType === 'paused') {
          emit(tabId, handler, { type: 'paused' });
        } else if (rawType === 'resume' || rawType === 'resumed') {
          emit(tabId, handler, { type: 'resumed' });
        }
      },
    };
    if (usedVoice) base.voiceName = usedVoice;

    const speak = (opts: chrome.tts.TtsOptions, fallback: 'voice' | 'events' | 'none'): void => {
      try {
        chrome.tts.speak(clean, opts, () => {
          if (!chrome.runtime.lastError) return;
          const error = chrome.runtime.lastError.message || 'TTS_ERROR';
          // خطأ صوت غير موجود → جرّب الصوت الافتراضي
          if (fallback === 'voice' && opts.voiceName) {
            const next: chrome.tts.TtsOptions = { ...opts };
            delete next.voiceName;
            speak(next, 'events');
            return;
          }
          // بعض الأصوات لا تدعم word events → جرّب بدون اشتراطها
          if (fallback === 'events' && opts.requiredEventTypes) {
            const next: chrome.tts.TtsOptions = { ...opts };
            delete next.requiredEventTypes;
            speak(next, 'none');
            return;
          }
          emit(tabId, handler, { type: 'error', error });
        });
      } catch (e) {
        emit(tabId, handler, { type: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    };

    speak(base, usedVoice ? 'voice' : 'events');
  });
}

export function ttsStop(): void {
  try { chrome.tts.stop(); } catch { /* ignore */ }
}

export function ttsPause(): void {
  try { chrome.tts.pause(); } catch { /* ignore */ }
}

export function ttsResume(): void {
  try { chrome.tts.resume(); } catch { /* ignore */ }
}

let voiceCache: TtsVoice[] | null = null;
let voiceCacheAt = 0;

function readVoices(): Promise<TtsVoice[]> {
  return new Promise((resolve) => {
    try {
      chrome.tts.getVoices((voices) => {
        const mapped = (voices || [])
          .filter((v) => Boolean(v.voiceName))
          .map((v) => ({
            name: String(v.voiceName),
            lang: String(v.lang || ''),
            remote: Boolean(v.remote),
            supportsWord: Boolean(v.eventTypes?.includes('word')),
          }))
          .sort((a, b) => {
            if (a.supportsWord !== b.supportsWord) return a.supportsWord ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
        resolve(mapped);
      });
    } catch {
      resolve([]);
    }
  });
}

export async function getTtsVoices(force = false): Promise<TtsVoice[]> {
  if (!force && voiceCache && Date.now() - voiceCacheAt < 30_000) return voiceCache;
  let voices = await readVoices();
  // محرك الصوت قد يتأخر لحظة عند أول استدعاء
  if (!voices.length) {
    await new Promise((r) => setTimeout(r, 300));
    voices = await readVoices();
  }
  voiceCache = voices;
  voiceCacheAt = Date.now();
  return voices;
}
