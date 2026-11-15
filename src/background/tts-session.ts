// حالة مشغل الصوت داخل البانل + تشغيل نص حر مباشرة من الـ SW.
// الأدوات تعمل داخل الـ SW؛ لا تستخدم chrome.runtime.sendMessage إلى نفسها.
import type { TtsPanelState } from '../shared/types';
import { edgeSpeak, edgeStop } from './edge';
import { getTtsVoices, ttsSpeak, ttsStop } from './tts';

const EMPTY_TTS_STATE: TtsPanelState = {
  active: false,
  playing: false,
  engine: 'edge',
  title: '',
  text: '',
  index: 0,
  total: 1,
  currentTime: 0,
  duration: 0,
  tabId: null,
  voice: '',
  rate: 1,
  sessionId: '',
};

let state: TtsPanelState = { ...EMPTY_TTS_STATE };
let emit: ((s: TtsPanelState) => void) | null = null;
let chatSessionId = '';

export function setTtsChatSession(id: string): void {
  chatSessionId = id;
}

export function getTtsChatSession(): string {
  return chatSessionId;
}

export function setTtsEmitter(fn: (s: TtsPanelState) => void): void {
  emit = fn;
}

export function getTtsState(): TtsPanelState {
  return state;
}

export function setTtsState(patch: Partial<TtsPanelState>): void {
  state = { ...state, ...patch };
  emit?.(state);
}

export function resetTtsState(): void {
  state = { ...EMPTY_TTS_STATE };
  emit?.(state);
}

/** أحداث مشغل Edge (تعمل حتى بدون تبويب عند قراءة نص حر) */
export function handleEdgeEvent(msg: any): void {
  const e = msg?.event;
  if (!e) return;
  const type = e.type;
  if (type === 'start') {
    setTtsState({ playing: true, ...(Number.isFinite(Number(e.duration)) ? { duration: Number(e.duration) } : {}) });
  } else if (type === 'progress') {
    setTtsState({ currentTime: Number(e.currentTime) || 0, duration: Number(e.duration) || 0 });
  } else if (type === 'end' || type === 'error' || type === 'interrupted' || type === 'cancelled') {
    setTtsState({ playing: false });
  } else if (type === 'paused') {
    setTtsState({ playing: false });
  } else if (type === 'resumed') {
    setTtsState({ playing: true });
  }
  if (msg.tabId != null) chrome.tabs.sendMessage(msg.tabId, e).catch(() => {});
}

/** اختيار صوت متصفح مناسب للغة النص عند السقوط من Edge */
async function browserVoiceFor(text: string, requested?: string): Promise<string> {
  if (requested) return requested;
  const voices = await getTtsVoices().catch(() => []);
  if (!voices.length) return '';
  const isArabic = /[\u0600-\u06FF]/.test(text);
  const prefix = isArabic ? 'ar' : 'en';
  const matches = voices.filter((v) => v.lang.toLowerCase().startsWith(prefix));
  return (matches.find((v) => v.supportsWord) || matches[0] || voices[0])?.name || '';
}

/** قراءة نص حر في مشغل البانل بدون الحاجة لصفحة أو content script */
export async function speakTextDirect(
  text: string,
  voice: string | undefined,
  rate: number | undefined,
  engine: 'edge' | 'browser' | undefined,
  sessionId?: string,
): Promise<any> {
  const eng: 'edge' | 'browser' = engine === 'browser' ? 'browser' : 'edge';
  const edgeVoice = String(voice || '') || (/[\u0600-\u06FF]/.test(text) ? 'ar-EG-ShakirNeural' : 'en-US-EmmaMultilingualNeural');
  const chosenVoice = eng === 'edge' ? edgeVoice : await browserVoiceFor(text, voice);
  state = {
    active: true,
    playing: true,
    engine: eng,
    title: '',
    text,
    index: 0,
    total: 1,
    currentTime: 0,
    duration: 0,
    tabId: null,
    voice: chosenVoice,
    rate: Number(rate) || 1,
    sessionId: sessionId || chatSessionId,
  };
  emit?.(state);

  if (eng === 'edge') {
    ttsStop();
    const r = await edgeSpeak(text, chosenVoice, rate, null);
    if (r.ok) return { ok: true, engine: 'edge', voice: chosenVoice };
    if (r.error === 'EDGE_STOPPED') {
      resetTtsState();
      return { ok: false, error: 'EDGE_STOPPED' };
    }
    const fallbackVoice = await browserVoiceFor(text);
    const b = ttsSpeak(text, rate, fallbackVoice || undefined, null);
    if (!b.ok) resetTtsState();
    else setTtsState({ engine: 'browser', voice: fallbackVoice });
    return { ...b, engine: 'browser', voice: fallbackVoice, fallback: true, edgeError: r.error };
  }

  edgeStop();
  const b = ttsSpeak(text, rate, chosenVoice || undefined, null);
  if (!b.ok) resetTtsState();
  else setTtsState({ engine: 'browser', voice: chosenVoice });
  return { ...b, engine: 'browser', voice: chosenVoice };
}
