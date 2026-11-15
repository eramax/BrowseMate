// واجهة التشغيل الصوتي داخل الـ service worker.
// كل المنطق في tts-controller (آلة حالة نقية)، وهنا نربطها بمحركي Edge والمتصفح.
import type { TtsPanelState } from '../shared/types';
import type { TtsStartRequest, TtsStartResult, StopScope } from './tts-controller';
import { createTtsController } from './tts-controller';
import {
  edgeHalt,
  edgeExport,
  edgePause,
  edgeResume,
  resetEdgeConnection,
  edgeSeek,
  edgeSpeak,
  edgeState,
  edgeStop,
} from './edge';
import { getTtsVoices, ttsPause, ttsResume, ttsSpeak, ttsStop } from './tts';
import { pickBrowserVoice, edgeVoiceFor } from './tts-voice';
import { buildSpeechSegments } from './tts-split';
import { logSystemDebug } from './debug';

let emit: ((s: TtsPanelState) => void) | null = null;
/** احتياط للرسائل القديمة التي لا تمرر sessionId — لا يُعتمد عليه في المسارات الجديدة */
let chatSessionId = '';

const controller = createTtsController({
  edge: {
    speak: (req) => edgeSpeak(req.text, req.voice, req.rate, req.tabId, req.key, req.prefetch, req.playbackId),
    halt: edgeHalt,
    stop: edgeStop,
    pause: edgePause,
    resume: edgeResume,
    seek: edgeSeek,
  },
  browser: {
    speak: async (req) => {
      const res = await ttsSpeak(req.text, req.rate, req.voice, req.tabId, (event) => {
        controller.handleEvent({ playbackId: req.playbackId, tabId: req.tabId, event });
      });
      return { ok: res.ok, error: res.error, voice: res.voice };
    },
    stop: ttsStop,
    halt: ttsStop,
    pause: ttsPause,
    resume: ttsResume,
  },
  pickBrowserVoice: async (text, requested) => {
    const voices = await getTtsVoices().catch(() => []);
    return pickBrowserVoice(text, voices, requested);
  },
  emitState: (state) => emit?.(state),
  sendToTab: (tabId, msg) => chrome.tabs.sendMessage(tabId, msg),
  log: (event, data, level) => void logSystemDebug(event, data, level),
});

interface PendingPageRead {
  tabId: number;
  sessionId: string;
  voiceId: string;
  at: number;
}

/** قراءات صفحة بدأت أداة read_aloud لكن أول tts-speak لم يصل بعد. */
const pendingReads = new Map<number, PendingPageRead>();
const PENDING_TTL = 90_000;

function prunePending(): void {
  const now = Date.now();
  for (const [tabId, p] of pendingReads) {
    if (now - p.at > PENDING_TTL) {
      controller.cancel(p.voiceId);
      pendingReads.delete(tabId);
    }
  }
}

/** قبل withReader('read'): يسجّل نية القراءة حتى يستطيع Stop إلغاءها قبل وصول tts-speak. */
export function registerPendingPageRead(tabId: number, sessionId: string, voiceId: string): void {
  prunePending();
  const prev = pendingReads.get(tabId);
  if (prev && prev.voiceId !== voiceId) {
    controller.cancel(prev.voiceId);
    try { void chrome.tabs.sendMessage(tabId, { __ta: 'reader', op: 'remote-stop' }).catch(() => {}); } catch { /* ignore */ }
  }
  pendingReads.set(tabId, { tabId, sessionId: String(sessionId || ''), voiceId, at: Date.now() });
}

export function clearPendingPageRead(tabId: number, voiceId: string): void {
  const p = pendingReads.get(tabId);
  if (p && (!voiceId || p.voiceId === voiceId)) pendingReads.delete(tabId);
}

function pendingMatches(p: PendingPageRead, scope: StopScope): boolean {
  if (scope.kind === 'all') return true;
  if (scope.kind === 'tab') return p.tabId === scope.tabId;
  return p.sessionId === scope.sessionId;
}

export function setTtsEmitter(fn: (s: TtsPanelState) => void): void {
  emit = fn;
}

export function setTtsChatSession(id: string): void {
  chatSessionId = id;
}

export function getTtsState(): TtsPanelState {
  return controller.getState();
}

/** حدث من محرك Edge داخل البانل — يُمرر للبطاقة وللقارئ داخل الصفحة فقط إن كان للتشغيل الحالي. */
export function handleEdgeEvent(msg: any): void {
  const event = msg?.event;
  if (!event) return;
  const before = controller.getState();
  const current = Boolean(before.active) && (!msg.playbackId || (before.playbackId && msg.playbackId === before.playbackId));
  if (current) controller.handleEvent({ playbackId: msg.playbackId, tabId: msg.tabId, event });
  if (!current || msg.tabId == null) return;
  // أحداث الكلمات/البداية/النهاية فقط — لا نغرق content script بتقدم كل 250ms
  if (!['start', 'word', 'end', 'error', 'paused', 'resumed', 'interrupted'].includes(String(event.type))) return;
  try {
    void chrome.tabs.sendMessage(msg.tabId, event).catch(() => {});
  } catch {
    /* التبويب أُغلق */
  }
}

/** تشغيل نص حر في البانل — بدون صفحة أو content script. */
export async function speakTextDirect(
  text: string,
  voice: string | undefined,
  rate: number | undefined,
  engine: 'edge' | 'browser' | undefined,
  sessionId?: string,
  voiceId?: string,
  replay = false,
): Promise<TtsStartResult> {
  const engineName: 'edge' | 'browser' = engine === 'browser' ? 'browser' : 'edge';
  const rateValue = Number(rate) || 1;
  const edgeVoice = edgeVoiceFor(text, voice);
  // Edge فقط يُقسّم النص؛ الأصوات الأخرى لا تمر بهذا المسار في الإنتاج
  const playlist = engineName === 'edge' ? buildSpeechSegments(text, edgeVoice, rateValue) : undefined;
  return controller.start({
    text,
    voice: engineName === 'edge' ? edgeVoice : voice,
    rate: rateValue,
    engine: engineName,
    sessionId: sessionId || chatSessionId,
    voiceId,
    replay,
    playlist,
    tabId: null,
    title: '',
    index: 0,
    total: 1,
  });
}

/** تشغيل قراءة صفحة — يصل من content script عبر tts-speak. */
export async function startPagePlayback(msg: any, tabId: number | null): Promise<TtsStartResult> {
  const voiceId = msg?.voiceId ? String(msg.voiceId) : '';
  const res = await controller.start({
    text: String(msg?.text || ''),
    voice: msg?.voice,
    rate: msg?.rate,
    engine: 'edge',
    sessionId: String(msg?.sessionId || chatSessionId || ''),
    voiceId: voiceId || undefined,
    replay: Boolean(msg?.replay),
    tabId,
    title: String(msg?.title || ''),
    index: Number(msg?.index) || 0,
    total: Number(msg?.total) || 1,
    key: String(msg?.key || ''),
    prefetch: Array.isArray(msg?.prefetch) ? msg.prefetch : [],
  });
  if (tabId != null && voiceId) clearPendingPageRead(tabId, voiceId);
  return res;
}

export async function stopTts(scope: StopScope): Promise<boolean> {
  prunePending();
  let cancelledPending = false;
  for (const [tabId, p] of pendingReads) {
    if (!pendingMatches(p, scope)) continue;
    controller.cancel(p.voiceId);
    pendingReads.delete(tabId);
    cancelledPending = true;
    try { void chrome.tabs.sendMessage(tabId, { __ta: 'reader', op: 'remote-stop' }).catch(() => {}); } catch { /* ignore */ }
  }
  const stopped = await controller.stop(scope);
  return stopped || cancelledPending;
}

export function pauseTts(sessionId = ''): boolean {
  return controller.pause(sessionId);
}

export function resumeTts(sessionId = ''): boolean {
  return controller.resume(sessionId);
}

export function seekTts(time: number, sessionId = ''): boolean {
  return controller.seek(time, sessionId);
}

/** إعادة تشغيل الصوت الحالي: يفضّل القارئ داخل الصفحة إن كان حياً، وإلا نصاً حراً. */
export async function replayTts(sessionId = ''): Promise<any> {
  const st = controller.getState();
  if (!st.active || !st.text) return { ok: false, error: 'NO_REPLAY' };
  if (sessionId && st.sessionId !== sessionId) return { ok: false, error: 'NOT_OWNER' };
  if (st.tabId != null) {
    try {
      const status: any = await chrome.tabs.sendMessage(st.tabId, { __ta: 'reader', op: 'status' });
      if (status?.ok && status.data?.active) {
        await chrome.tabs.sendMessage(st.tabId, { __ta: 'reader', op: 'replay' });
        return { ok: true, engine: st.engine, voice: st.voice };
      }
    } catch {
      /* التبويب أُغلق أو القارئ غير موجود — نعود إلى النص */
    }
  }
  return speakTextDirect(
    st.text,
    st.engine === 'edge' ? st.voice : '',
    st.rate,
    'edge',
    st.sessionId,
    st.voiceId,
    true,
  );
}

export async function nextTts(sessionId = ''): Promise<any> {
  const st = controller.getState();
  if (!st.active || st.tabId == null) return { ok: false, error: 'NO_PAGE' };
  if (sessionId && st.sessionId !== sessionId) return { ok: false, error: 'NOT_OWNER' };
  try {
    await chrome.tabs.sendMessage(st.tabId, { __ta: 'reader', op: 'next' });
    return { ok: true };
  } catch {
    return { ok: false, error: 'TAB_GONE' };
  }
}

export async function prevTts(sessionId = ''): Promise<any> {
  const st = controller.getState();
  if (!st.active || st.tabId == null) return { ok: false, error: 'NO_PAGE' };
  if (sessionId && st.sessionId !== sessionId) return { ok: false, error: 'NOT_OWNER' };
  try {
    await chrome.tabs.sendMessage(st.tabId, { __ta: 'reader', op: 'prev' });
    return { ok: true };
  } catch {
    return { ok: false, error: 'TAB_GONE' };
  }
}


/** تحميل الرسالة الصوتية كملف MP3 كامل — يوقف التشغيل أولاً لتفادي تعارض WS. */
export async function downloadTts(
  text: string,
  voice: string | undefined,
  rate: number | undefined,
  sessionId?: string,
): Promise<{ ok: boolean; downloadId?: number; filename?: string; error?: string; bytes?: number }> {
  const clean = String(text || '').trim();
  if (!clean) return { ok: false, error: 'EMPTY_TEXT' };
  await stopTts({ kind: 'all' });
  // نظّف أي prefetch/تشغيل عالق قبل التصدير (بدون مسح الكاش)
  await edgeHalt();
  const rateValue = Number(rate) || 1;
  const edgeVoice = edgeVoiceFor(clean, voice);
  const segments = buildSpeechSegments(clean, edgeVoice, rateValue);
  if (!segments.length) return { ok: false, error: 'NO_SEGMENTS' };
  const items = segments.map(({ key, text: part }) => ({ key, text: part }));
  let res = await edgeExport(items, edgeVoice, rateValue);
  // المقاطع الناجحة تُخزّن في الكاش؛ إعادة المحاولة تكمل من المقطع الفاشل فقط
  if (!res.ok && /EDGE_TIMEOUT|EDGE_NO_WS|EDGE_WS|ENGINE_TIMEOUT|EDGE_SEND_FAILED/i.test(String(res.error || ''))) {
    await resetEdgeConnection();
    await new Promise((r) => setTimeout(r, 250));
    res = await edgeExport(items, edgeVoice, rateValue);
  }
  if (!res.ok || !res.base64) return { ok: false, error: res.error || 'EXPORT_FAILED' };
  const filename = `browsemate-voice-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.mp3`;
  try {
    const downloadId = await chrome.downloads.download({
      url: `data:audio/mpeg;base64,${res.base64}`,
      filename,
      saveAs: false,
    });
    return { ok: true, downloadId, filename, bytes: res.bytes };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), bytes: res.bytes };
  }
}

/** دورة حياة التبويبات + تنظيف صوت يتيم بعد إعادة تشغيل الـ SW. */
export function initTtsLifecycle(): void {
  try {
    chrome.tabs.onRemoved.addListener((tabId) => {
      clearPendingPageRead(tabId, '');
      void controller.stop({ kind: 'tab', tabId });
    });
    chrome.tabs.onUpdated.addListener((tabId, info) => {
      if (info.status === 'loading' || info.discarded) {
        clearPendingPageRead(tabId, '');
        void controller.stop({ kind: 'tab', tabId });
      }
    });
  } catch {
    /* بيئة اختبار */
  }
  setTimeout(() => {
    void (async () => {
      if (controller.isActive()) return;
      // بعد إعادة تشغيل الـ SW قد يبقى صوت بلا أي بطاقة تحكم — أوقفه
      ttsStop();
      const st = await edgeState().catch(() => null);
      if (st?.playing) await edgeStop().catch(() => {});
    })();
  }, 1500);
}
