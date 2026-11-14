// تشغيل النطق عبر chrome.tts (أصوات المتصفح) وإرسال أحداث الكلمات للتظليل.
// المحتوى/الأزرار في content script، والصوت هنا لأن content scripts لا تملك chrome.tts.

export interface TtsVoice {
  name: string;
  lang: string;
  remote: boolean;
  supportsWord: boolean;
}

let activeTabId: number | null = null;

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

/** بدء قراءة نص في تبويب محدد — يوقف أي قراءة سابقة */
export function ttsSpeak(
  text: string,
  rate: number | undefined,
  voice: string | undefined,
  tabId: number | null,
): { ok: boolean; error?: string } {
  const clean = (text ?? '').trim();
  if (!clean) return { ok: false, error: 'EMPTY_TEXT' };

  if (activeTabId != null && activeTabId !== tabId) {
    // أغلق واجهة القارئ في التبويب السابق قبل نقل الصوت
    sendToTab(activeTabId, { __ta: 'reader', op: 'stop' });
  }
  activeTabId = tabId;

  try {
    chrome.tts.stop();
  } catch {
    /* ignore */
  }

  const options: chrome.tts.TtsOptions = {
    rate: Math.min(2, Math.max(0.5, Number(rate) || 1)),
    enqueue: false,
    requiredEventTypes: ['word'],
    desiredEventTypes: ['start', 'word', 'end', 'interrupted', 'cancelled', 'error'],
    onEvent: (event) => {
      switch (event.type) {
        case 'start':
          sendToTab(tabId, { action: 'tts-event', type: 'start' });
          break;
        case 'word':
          sendToTab(tabId, {
            action: 'tts-event',
            type: 'word',
            charIndex: event.charIndex || 0,
            length: event.length || 0,
            word: (event as any).word || wordAt(clean, event.charIndex || 0, event.length || 0),
          });
          break;
        case 'end':
          sendToTab(tabId, { action: 'tts-event', type: 'end' });
          break;
        case 'interrupted':
        case 'cancelled':
          sendToTab(tabId, { action: 'tts-event', type: 'interrupted' });
          break;
        case 'error':
          sendToTab(tabId, { action: 'tts-event', type: 'error', error: event.errorMessage || 'TTS_ERROR' });
          break;
      }
    },
  };
  if (voice) options.voiceName = voice;

  try {
    chrome.tts.speak(clean, options, () => {
      if (!chrome.runtime.lastError) return;
      // بعض الأصوات لا تدعم word events — أعد المحاولة بدون اشتراطها
      const fallback: chrome.tts.TtsOptions = { ...options };
      delete fallback.requiredEventTypes;
      try {
        chrome.tts.speak(clean, fallback, () => {
          if (chrome.runtime.lastError) {
            sendToTab(tabId, {
              action: 'tts-event',
              type: 'error',
              error: chrome.runtime.lastError.message,
            });
          }
        });
      } catch (e) {
        sendToTab(tabId, {
          action: 'tts-event',
          type: 'error',
          error: e instanceof Error ? e.message : String(e),
        });
      }
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function ttsStop(): void {
  try { chrome.tts.stop(); } catch { /* ignore */ }
  activeTabId = null;
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

// إن أُغلق التبويب أو انتقل أثناء القراءة، أوقف الصوت فوراً
try {
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === activeTabId) {
      try { chrome.tts.stop(); } catch { /* ignore */ }
      activeTabId = null;
    }
  });
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (tabId === activeTabId && info.status === 'loading') {
      try { chrome.tts.stop(); } catch { /* ignore */ }
      activeTabId = null;
    }
  });
} catch {
  /* بيئة اختبار */
}
