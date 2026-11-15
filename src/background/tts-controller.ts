// آلة حالة تشغيل الصوت — مصدر الحقيقة الوحيد لحالة القراءة.
// كل تشغيل جديد يوقف المحركين فوراً، ولا يوجد تشغيلان متوازيان.
// الربط بالجلسة والتبويب صريح، لذا لا تنتقل البطاقة بين الجلسات.
import type { TtsPanelState } from '../shared/types';
import { edgeVoiceFor } from './tts-voice';

export type TtsEngineName = 'edge' | 'browser';
export type TtsStatus = 'idle' | 'starting' | 'playing' | 'paused' | 'ended' | 'error';

export type StopScope =
  | { kind: 'all' }
  | { kind: 'tab'; tabId: number }
  | { kind: 'session'; sessionId: string };

export interface PrefetchItem {
  key: string;
  text: string;
}

export interface TtsStartRequest {
  text: string;
  voice?: string;
  rate?: number;
  engine?: TtsEngineName;
  /** جلسة المحادثة التي طلبت الصوت — إلزامية منطقياً، لكن قد تكون فارغة في مسارات قديمة */
  sessionId: string;
  /** معرّف الرسالة الصوتية المحفوظة — يبقى ثابتاً بين فقرات القراءة الواحدة */
  voiceId?: string;
  /** إعادة تشغيل مقصودة من المستخدم — تتجاوز إلغاء voiceId السابق */
  replay?: boolean;
  /** null = نص حر داخل البانل بدون صفحة */
  tabId: number | null;
  title?: string;
  index?: number;
  total?: number;
  key?: string;
  prefetch?: PrefetchItem[];
}

export interface TtsStartResult {
  ok: boolean;
  engine?: TtsEngineName;
  voice?: string;
  error?: string;
  edgeError?: string;
  fallback?: boolean;
  playbackId?: string;
  voiceId?: string;
}

export interface TtsEngineRequest {
  text: string;
  voice: string;
  rate: number;
  tabId: number | null;
  playbackId: string;
  key: string;
  prefetch: PrefetchItem[];
}

export interface TtsEngineResult {
  ok: boolean;
  error?: string;
  voice?: string;
}

export interface TtsEngine {
  speak(req: TtsEngineRequest): Promise<TtsEngineResult>;
  /** إسكات فوري مع إبقاء الاتصال والكاش (للانتقال/تغيير السرعة) */
  halt(): void | Promise<void>;
  /** إيقاف كامل مع إغلاق الاتصال (إعادة ضبط) */
  stop(): void | Promise<void>;
  pause(): void;
  resume(): void;
  seek?(time: number): void;
}

export interface TtsControllerDeps {
  edge: TtsEngine;
  browser: TtsEngine;
  pickBrowserVoice: (text: string, requested?: string) => Promise<string> | string;
  emitState?: (state: TtsPanelState) => void;
  sendToTab?: (tabId: number, msg: Record<string, unknown>) => void | Promise<void>;
  log?: (event: string, data?: unknown, level?: 'debug' | 'info' | 'warn' | 'error') => void;
  now?: () => number;
  uuid?: () => string;
}

export interface EngineEvent {
  playbackId?: string;
  tabId?: number | null;
  event: {
    type: string;
    currentTime?: number;
    duration?: number;
    charIndex?: number;
    length?: number;
    word?: string;
    error?: string;
  };
}

interface ActivePlayback {
  playbackId: string;
  voiceId: string;
  sessionId: string;
  tabId: number | null;
  engine: TtsEngineName;
  text: string;
  voice: string;
  rate: number;
  title: string;
  index: number;
  total: number;
}

const EMPTY_STATE: TtsPanelState = {
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
  status: 'idle',
};

const STOP_ERRORS = /^(EDGE_STOPPED|TTS_STOPPED|TTS_SUPERSEDED|EDGE_REPLACED)$/;

function clampRate(rate: number | undefined): number {
  const n = Number(rate);
  if (!Number.isFinite(n)) return 1;
  return Math.min(2, Math.max(0.5, n));
}

function msgOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function createTtsController(deps: TtsControllerDeps) {
  const now = deps.now ?? (() => Date.now());
  const uuid = deps.uuid ?? (() => crypto.randomUUID());
  let state: TtsPanelState = { ...EMPTY_STATE };
  let active: ActivePlayback | null = null;
  /** بدء قيد التنفيذ (قبل نشر active) — يسمح لـ Stop بإلغائه أثناء الاتصال/التركيب */
  let starting: { token: number; sessionId: string; tabId: number | null; voiceId: string } | null = null;
  /** يزداد مع كل تشغيل/إيقاف — يبطل أي بدء قديم انتهى متأخراً */
  let seq = 0;
  /** voiceIds أُوقفت — تمنع طلب فقرة كان في الطريق من بدء صوت جديد */
  const cancelledVoices = new Map<string, number>();
  const CANCEL_TTL = 120_000;

  function pruneCancelled(): void {
    const t = now();
    for (const [id, at] of cancelledVoices) {
      if (t - at > CANCEL_TTL) cancelledVoices.delete(id);
    }
  }

  function cancelVoice(voiceId: string): void {
    if (!voiceId) return;
    cancelledVoices.set(voiceId, now());
    pruneCancelled();
  }

  function isVoiceCancelled(voiceId: string): boolean {
    if (!voiceId) return false;
    const at = cancelledVoices.get(voiceId);
    if (!at) return false;
    if (now() - at > CANCEL_TTL) {
      cancelledVoices.delete(voiceId);
      return false;
    }
    return true;
  }

  function snapshot(): TtsPanelState {
    return { ...state };
  }

  function publish(patch: Partial<TtsPanelState>): void {
    state = { ...state, ...patch, updatedAt: now() };
    deps.emitState?.(snapshot());
  }

  function resetState(): void {
    state = { ...EMPTY_STATE, updatedAt: now() };
    deps.emitState?.(snapshot());
  }

  async function haltEngines(): Promise<void> {
    await Promise.allSettled([
      Promise.resolve(deps.edge.halt()).catch((e) => deps.log?.('tts:edge-halt-failed', { error: msgOf(e) }, 'warn')),
      Promise.resolve(deps.browser.stop()).catch((e) => deps.log?.('tts:browser-stop-failed', { error: msgOf(e) }, 'warn')),
    ]);
  }

  function stopPageUi(tabId: number | null): void {
    if (tabId == null) return;
    try {
      void deps.sendToTab?.(tabId, { __ta: 'reader', op: 'remote-stop' });
    } catch {
      /* التبويب أُغلق */
    }
  }

  function matchesIds(sessionId: string, tabId: number | null, scope: StopScope): boolean {
    if (scope.kind === 'all') return true;
    if (scope.kind === 'tab') return tabId === scope.tabId;
    return sessionId === scope.sessionId;
  }

  function matches(a: ActivePlayback, scope: StopScope): boolean {
    return matchesIds(a.sessionId, a.tabId, scope);
  }

  /** بدء تشغيل جديد — يوقف السابق فوراً حتى لا يتداخل صوتان. */
  async function start(req: TtsStartRequest): Promise<TtsStartResult> {
    const text = String(req.text || '').trim();
    if (!text) return { ok: false, error: 'EMPTY_TEXT' };

    // طلب فقرة/page قديم كان في الطريق بعد الإيقاف — لا تبدأ به ولا تلمس التشغيل الحالي
    const requestedVoiceId = String(req.voiceId || '');
    if (!req.replay && requestedVoiceId && isVoiceCancelled(requestedVoiceId)) {
      return { ok: false, error: 'TTS_STOPPED' };
    }

    const my = ++seq;
    const previous = active;
    const targetTab = req.tabId == null ? null : Number(req.tabId);
    active = null;
    starting = { token: my, sessionId: String(req.sessionId || ''), tabId: targetTab, voiceId: requestedVoiceId };

    if (previous?.voiceId && previous.voiceId !== requestedVoiceId) cancelVoice(previous.voiceId);

    // 1) إسكات فوري قبل أي انتظار (اتصال/تركيب)
    await haltEngines();
    if (my !== seq) return { ok: false, error: 'TTS_SUPERSEDED' };
    // 2) إغلاق واجهة القارئ في التبويب السابق إن اختلف التبويب
    if (previous?.tabId != null && previous.tabId !== targetTab) stopPageUi(previous.tabId);

    const engine: TtsEngineName = req.engine === 'browser' ? 'browser' : 'edge';
    const rate = clampRate(req.rate);
    const playbackId = uuid();
    const voiceId = String(req.voiceId || '') || playbackId;
    const sessionId = String(req.sessionId || '');
    const title = String(req.title || '');
    const voice = engine === 'edge'
      ? edgeVoiceFor(text, req.voice)
      : await deps.pickBrowserVoice(text, req.voice);
    if (my !== seq) return { ok: false, error: 'TTS_SUPERSEDED' };

    active = {
      playbackId,
      voiceId,
      sessionId,
      tabId: targetTab,
      engine,
      text,
      voice,
      rate,
      title,
      index: Number.isFinite(Number(req.index)) ? Number(req.index) : 0,
      total: Number.isFinite(Number(req.total)) ? Number(req.total) : 1,
    };

    publish({
      active: true,
      playing: true,
      status: 'starting',
      engine,
      title,
      text,
      index: active.index,
      total: active.total,
      currentTime: 0,
      duration: 0,
      tabId: targetTab,
      voice,
      rate,
      sessionId,
      playbackId,
      voiceId,
    });
    if (starting?.token === my) starting = null;

    const started = await runEngine(engine, { text, voice, rate, tabId: targetTab, playbackId, key: req.key || '', prefetch: req.prefetch ?? [] });
    if (my !== seq) return { ok: false, error: 'TTS_SUPERSEDED', playbackId, voiceId };

    if (started.ok) {
      if (active) {
        active.voice = started.voice || active.voice;
        publish({ playing: true, status: 'playing', voice: active.voice });
      }
      return { ok: true, engine, voice: active?.voice || voice, playbackId, voiceId };
    }

    if (STOP_ERRORS.test(String(started.error || ''))) {
      active = null;
      resetState();
      return { ok: false, error: 'TTS_STOPPED', playbackId, voiceId };
    }

    // 3) السقوط من Edge: صوت متصفح مناسب للغة النص — وليس الصوت الافتراضي الفارغ
    if (engine === 'edge') {
      deps.log?.('tts:edge-fallback', { error: started.error, voice }, 'warn');
      const fallbackVoice = await deps.pickBrowserVoice(text);
      if (my !== seq) return { ok: false, error: 'TTS_SUPERSEDED', playbackId, voiceId };
      const fallback = await runEngine('browser', {
        text,
        voice: fallbackVoice,
        rate,
        tabId: targetTab,
        playbackId,
        key: '',
        prefetch: [],
      });
      if (my !== seq) return { ok: false, error: 'TTS_SUPERSEDED', playbackId, voiceId };

      if (fallback.ok) {
        if (active) {
          active.engine = 'browser';
          active.voice = fallback.voice || fallbackVoice;
          publish({ engine: 'browser', voice: active.voice, playing: true, status: 'playing' });
        }
        return {
          ok: true,
          engine: 'browser',
          voice: active?.voice || fallbackVoice,
          fallback: true,
          edgeError: started.error,
          playbackId,
          voiceId,
        };
      }

      active = null;
      publish({ active: false, playing: false, status: 'error' });
      return {
        ok: false,
        error: fallback.error || 'TTS_FAILED',
        edgeError: started.error,
        playbackId,
        voiceId,
      };
    }

    active = null;
    publish({ active: false, playing: false, status: 'error' });
    return { ok: false, error: started.error || 'TTS_FAILED', playbackId, voiceId };
  }

  async function runEngine(engine: TtsEngineName, req: TtsEngineRequest): Promise<TtsEngineResult> {
    const impl = engine === 'edge' ? deps.edge : deps.browser;
    try {
      const res = await impl.speak(req);
      return res || { ok: false, error: 'TTS_EMPTY_RESULT' };
    } catch (e) {
      return { ok: false, error: msgOf(e) };
    }
  }

  /** إيقاف مشروط بالملكية: تبويب لا يوقف نصاً حراً، وجلسة لا توقف جلسة أخرى. */
  async function stop(scope: StopScope, opts: { remoteStop?: boolean } = {}): Promise<boolean> {
    const activeMatch = Boolean(active && matches(active, scope));
    const startingMatch = Boolean(starting && matchesIds(starting.sessionId, starting.tabId, scope));
    if (!activeMatch && !startingMatch) return false;

    const remote = opts.remoteStop !== false && scope.kind !== 'tab';
    const closeOldPage = (tabId: number | null): void => {
      if (!remote || tabId == null) return;
      // لا تغلق قارئاً جديداً بدأ في نفس التبويب أثناء انتظار halt
      if (active?.tabId === tabId || starting?.tabId === tabId) return;
      stopPageUi(tabId);
    };

    if (startingMatch) {
      // ألغِ البدء القيد التنفيذ قبل أن ينشر active
      const startTab = starting?.tabId ?? null;
      if (starting?.voiceId) cancelVoice(starting.voiceId);
      seq++;
      starting = null;
      await haltEngines();
      if (active || starting) {
        closeOldPage(startTab);
        return true;
      }
      resetState();
      closeOldPage(startTab);
      return true;
    }

    const tabId = active!.tabId;
    cancelVoice(active!.voiceId);
    seq++;
    active = null;
    await haltEngines();
    if (active || starting) {
      closeOldPage(tabId);
      return true;
    }
    resetState();
    closeOldPage(tabId);
    return true;
  }

  /** إيقاف بلا لمس المحركات — لمسار خطأ داخلي فقط. */
  function reset(): void {
    if (active?.voiceId) cancelVoice(active.voiceId);
    seq++;
    active = null;
    starting = null;
    resetState();
  }

  function pause(sessionId = ''): boolean {
    if (!active) return false;
    if (sessionId && active.sessionId !== sessionId) return false;
    if (state.status === 'ended' || state.status === 'error') return false;
    if (active.engine === 'edge') deps.edge.pause();
    else deps.browser.pause();
    publish({ playing: false, status: 'paused' });
    return true;
  }

  function resume(sessionId = ''): boolean {
    if (!active) return false;
    if (sessionId && active.sessionId !== sessionId) return false;
    if (state.status === 'ended') return false;
    if (active.engine === 'edge') deps.edge.resume();
    else deps.browser.resume();
    publish({ playing: true, status: 'playing' });
    return true;
  }

  function seek(time: number, sessionId = ''): boolean {
    if (!active) return false;
    if (sessionId && active.sessionId !== sessionId) return false;
    const max = Number.isFinite(state.duration) && state.duration > 0 ? state.duration : Number.POSITIVE_INFINITY;
    const t = Math.max(0, Math.min(Number(time) || 0, max));
    deps.edge.seek?.(t);
    publish({ currentTime: t });
    return true;
  }

  /** أحداث المحرك — تُتجاهل إن كانت تخص تشغيلاً سابقاً. */
  function handleEvent(evt: EngineEvent): void {
    if (!active) return;
    if (evt.playbackId && evt.playbackId !== active.playbackId) return;
    const e = evt.event || ({} as EngineEvent['event']);
    switch (e.type) {
      case 'start':
        publish({
          playing: true,
          status: 'playing',
          ...(Number.isFinite(Number(e.duration)) && Number(e.duration) > 0 ? { duration: Number(e.duration) } : {}),
        });
        break;
      case 'progress':
        publish({
          currentTime: Number(e.currentTime) || 0,
          ...(Number(e.duration) ? { duration: Number(e.duration) } : {}),
        });
        break;
      case 'end':
        publish({
          playing: false,
          status: 'ended',
          ...(Number.isFinite(Number(e.duration)) && Number(e.duration) > 0
            ? { duration: Number(e.duration), currentTime: Number(e.duration) }
            : {}),
        });
        break;
      case 'paused':
        publish({ playing: false, status: 'paused' });
        break;
      case 'resumed':
        publish({ playing: true, status: 'playing' });
        break;
      case 'interrupted':
      case 'cancelled':
        publish({ playing: false, status: 'ended' });
        break;
      case 'error':
        deps.log?.('tts:engine-error', { error: e.error, tabId: evt.tabId }, 'warn');
        if (state.status === 'starting') {
          // أثناء البدء قد يكون هذا خطأ Edge قبل السقوط إلى المتصفح — لا نمحو active بعد
          publish({ playing: false, status: 'error' });
        } else {
          // خطأ بعد بدء التشغيل: لا نترك بطاقة مشغل ميتة
          active = null;
          publish({ active: false, playing: false, status: 'error' });
        }
        break;
      default:
        break;
    }
  }

  function getState(): TtsPanelState {
    return snapshot();
  }

  /** إلغاء voiceId قادم من قراءة معلّقة (قبل أن يصل tts-speak) */
  function cancel(voiceId: string): void {
    cancelVoice(String(voiceId || ''));
  }

  function isActive(): boolean {
    return Boolean(active || starting);
  }

  return {
    start,
    stop,
    reset,
    pause,
    resume,
    seek,
    handleEvent,
    getState,
    isActive,
    snapshot,
    cancel,
  };
}

export type TtsController = ReturnType<typeof createTtsController>;
