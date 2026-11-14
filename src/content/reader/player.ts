// جسر التشغيل بين content script وchrome.tts في الـ service worker
// الأحداث تعود من الخلفية: start/word/end/interrupted/error

export type PlayerState = 'idle' | 'speaking' | 'paused';

export interface PlayerSettings {
  rate: number;
  voice: string;
  engine: 'edge' | 'browser';
}

export class TtsPlayer {
  private state: PlayerState = 'idle';
  private settings: PlayerSettings = { rate: 1, voice: '', engine: 'edge' };
  private speakSeq = 0;
  private actualEngine: 'edge' | 'browser' | null = null;

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

  speak(
    text: string,
    _index: number,
    opts: {
      key?: string;
      prefetch?: Array<{ key: string; text: string }>;
      index?: number;
      total?: number;
      title?: string;
    } = {},
  ): void {
    const seq = ++this.speakSeq;
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
    };
    try {
      chrome.runtime.sendMessage(payload, (res: any) => {
        // تجاهل ردود الطلبات القديمة بعد stop/قراءة جديدة
        if (seq !== this.speakSeq) return;
        if (chrome.runtime.lastError || !res?.ok) {
          this.setState('idle');
          this.onError?.(chrome.runtime.lastError?.message ?? res?.error);
          return;
        }
        this.actualEngine = res.engine === 'browser' ? 'browser' : 'edge';
        this.setState('speaking');
      });
    } catch (e) {
      if (seq !== this.speakSeq) return;
      this.setState('idle');
      this.onError?.(e instanceof Error ? e.message : String(e));
    }
  }

  pause(): void {
    if (this.state !== 'speaking') return;
    try { chrome.runtime.sendMessage({ type: 'tts-pause' }); } catch { /* ignore */ }
    this.setState('paused');
  }

  resume(): void {
    if (this.state !== 'paused') return;
    try { chrome.runtime.sendMessage({ type: 'tts-resume' }); } catch { /* ignore */ }
    this.setState('speaking');
  }

  stop(): void {
    this.speakSeq++;
    this.actualEngine = null;
    try { chrome.runtime.sendMessage({ type: 'tts-stop' }); } catch { /* ignore */ }
    this.setState('idle');
  }

  /** إيقاف محلي بدون إرسال tts-stop (للانتقال بين الفقرات) */
  silence(): void {
    this.speakSeq++;
    this.actualEngine = null;
    this.setState('idle');
  }
}
