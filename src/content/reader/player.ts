// جسر التشغيل بين content script وchrome.tts/Edge في الـ service worker.
// الأحداث تعود من الخلفية: start/word/end/interrupted/error.
// speak() يعيد وعداً بنتيجة البدء الفعلية (المحرك/الصوت) حتى تُحفظ رسالة صوتية صادقة.

export type PlayerState = 'idle' | 'speaking' | 'paused';

export interface PlayerSettings {
  rate: number;
  voice: string;
  engine: 'edge' | 'browser';
}

export interface SpeakResult {
  ok: boolean;
  engine?: 'edge' | 'browser';
  voice?: string;
  voiceId?: string;
  fallback?: boolean;
  edgeError?: string;
  error?: string;
}

export class TtsPlayer {
  private state: PlayerState = 'idle';
  private settings: PlayerSettings = { rate: 1, voice: '', engine: 'edge' };
  private speakSeq = 0;
  private actualEngine: 'edge' | 'browser' | null = null;
  private sessionId = '';
  private pendingSpeak: ((r: SpeakResult) => void) | null = null;

  onBoundary: ((charIndex: number, length: number, word: string) => void) | null = null;
  onEnd: (() => void) | null = null;
  onStateChange: ((state: PlayerState) => void) | null = null;
  onError: ((message?: string) => void) | null = null;

  constructor() {
    chrome.runtime.onMessage.addListener((msg: any) => {
      if (!msg || msg.action !== 'tts-event') return;
      switch (msg.type) {
        case 'start':
          this.setState('speaking');
          break;
        case 'word':
          this.onBoundary?.(Number(msg.charIndex) || 0, Number(msg.length) || 0, String(msg.word || ''));
          break;
        case 'end':
          this.setState('idle');
          this.onEnd?.();
          break;
        case 'interrupted':
        case 'cancelled':
          this.setState('idle');
          break;
        case 'paused':
          this.setState('paused');
          break;
        case 'resumed':
          this.setState('speaking');
          break;
        case 'error':
          this.setState('idle');
          this.onError?.(msg.error);
          break;
      }
    });
  }

  setSettings(s: Partial<PlayerSettings>): void {
    if (s.rate != null && Number.isFinite(s.rate)) this.settings.rate = Math.min(2, Math.max(0.5, s.rate));
    if (s.voice != null) this.settings.voice = s.voice;
    if (s.engine === 'edge' || s.engine === 'browser') this.settings.engine = s.engine;
  }

  getSettings(): PlayerSettings {
    return { ...this.settings };
  }

  getState(): PlayerState {
    return this.state;
  }

  getActualEngine(): 'edge' | 'browser' | null {
    return this.actualEngine;
  }

  private setState(s: PlayerState): void {
    if (this.state === s) return;
    this.state = s;
    this.onStateChange?.(s);
  }

  private settlePending(result: SpeakResult): void {
    const fn = this.pendingSpeak;
    this.pendingSpeak = null;
    try { fn?.(result); } catch { /* ignore */ }
  }

  speak(
    text: string,
    _index: number,
    opts: {
      key?: string;
      prefetch?: Array<{ key: string; text: string }>;
      index?: number;
      total?: number;
      title?: string;
      sessionId?: string;
      voiceId?: string;
    } = {},
  ): Promise<SpeakResult> {
    const seq = ++this.speakSeq;
    this.settlePending({ ok: false, error: 'SUPERSEDED' });
    this.sessionId = String(opts.sessionId || '');
    const payload = {
      type: 'tts-speak',
      text,
      rate: this.settings.rate,
      engine: this.settings.engine,
      ...(this.settings.voice ? { voice: this.settings.voice } : {}),
      ...(opts.key ? { key: opts.key } : {}),
      ...(opts.prefetch?.length ? { prefetch: opts.prefetch } : {}),
      ...(opts.index != null ? { index: opts.index } : {}),
      ...(opts.total != null ? { total: opts.total } : {}),
      ...(opts.title ? { title: opts.title } : {}),
      ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
      ...(opts.voiceId ? { voiceId: opts.voiceId } : {}),
    };

    return new Promise<SpeakResult>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => finish({ ok: false, error: 'TTS_TIMEOUT' }), 60_000);
      const finish = (result: SpeakResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.pendingSpeak === finish) this.pendingSpeak = null;
        resolve(result);
      };
      this.pendingSpeak = finish;

      try {
        chrome.runtime.sendMessage(payload, (res: any) => {
          // تجاهل ردود الطلبات القديمة بعد stop/قراءة جديدة
          if (seq !== this.speakSeq) {
            finish({ ok: false, error: 'SUPERSEDED' });
            return;
          }
          if (chrome.runtime.lastError || !res?.ok) {
            const error = chrome.runtime.lastError?.message ?? res?.error;
            this.setState('idle');
            this.onError?.(error);
            finish({ ok: false, error });
            return;
          }
          this.actualEngine = res.engine === 'browser' ? 'browser' : 'edge';
          this.setState('speaking');
          finish({
            ok: true,
            engine: this.actualEngine,
            voice: typeof res.voice === 'string' ? res.voice : undefined,
            voiceId: typeof res.voiceId === 'string' ? res.voiceId : undefined,
            fallback: Boolean(res.fallback),
            edgeError: typeof res.edgeError === 'string' ? res.edgeError : undefined,
          });
        });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        this.setState('idle');
        this.onError?.(error);
        finish({ ok: false, error });
      }
    });
  }

  pause(): void {
    if (this.state !== 'speaking') return;
    const seq = this.speakSeq;
    try {
      chrome.runtime.sendMessage({ type: 'tts-pause', sessionId: this.sessionId }, (res: any) => {
        if (seq === this.speakSeq && res?.ok) this.setState('paused');
      });
    } catch { /* ignore */ }
  }

  resume(): void {
    if (this.state !== 'paused') return;
    const seq = this.speakSeq;
    try {
      chrome.runtime.sendMessage({ type: 'tts-resume', sessionId: this.sessionId }, (res: any) => {
        if (seq === this.speakSeq && res?.ok) this.setState('speaking');
      });
    } catch { /* ignore */ }
  }

  stop(): void {
    this.speakSeq++;
    this.actualEngine = null;
    this.sessionId = '';
    this.settlePending({ ok: false, error: 'STOPPED' });
    try { chrome.runtime.sendMessage({ type: 'tts-stop', scope: 'tab' }); } catch { /* ignore */ }
    this.setState('idle');
  }

  /** إيقاف محلي بدون إرسال tts-stop (للانتقال بين الفقرات) */
  silence(): void {
    this.speakSeq++;
    this.actualEngine = null;
    this.settlePending({ ok: false, error: 'SUPERSEDED' });
    this.setState('idle');
  }
}
