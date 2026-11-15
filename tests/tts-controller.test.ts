import { describe, expect, it, vi } from 'vitest';
import {
  createTtsController,
  type TtsEngine,
  type TtsEngineRequest,
  type TtsEngineResult,
} from '../src/background/tts-controller';
import type { TtsPanelState } from '../src/shared/types';

class FakeEngine implements TtsEngine {
  calls: TtsEngineRequest[] = [];
  halts = 0;
  stops = 0;
  pauses = 0;
  resumes = 0;
  seeks: number[] = [];
  result: TtsEngineResult = { ok: true };
  async speak(req: TtsEngineRequest): Promise<TtsEngineResult> {
    this.calls.push(req);
    return this.result;
  }
  halt(): void { this.halts++; }
  stop(): void { this.stops++; }
  pause(): void { this.pauses++; }
  resume(): void { this.resumes++; }
  seek(time: number): void { this.seeks.push(time); }
}

function setup() {
  const edge = new FakeEngine();
  const browser = new FakeEngine();
  let state: TtsPanelState | null = null;
  const states: TtsPanelState[] = [];
  const tabs: Array<{ tabId: number; msg: any }> = [];
  let id = 0;
  const controller = createTtsController({
    edge,
    browser,
    pickBrowserVoice: vi.fn(async () => 'ar-EG-BrowserVoice'),
    emitState: (s) => { state = s; states.push(s); },
    sendToTab: (tabId, msg) => { tabs.push({ tabId, msg }); },
    uuid: () => `p${++id}`,
    now: () => 1000,
  });
  return { controller, edge, browser, tabs, states, get state() { return state!; } };
}

describe('TTS controller — single playback, explicit ownership', () => {
  it('binds a text playback to its session and picks the Arabic Edge voice', async () => {
    const s = setup();
    const res = await s.controller.start({
      text: 'مرحباً بالعالم',
      sessionId: 'session-a',
      tabId: null,
    });
    expect(res.ok).toBe(true);
    expect(res.engine).toBe('edge');
    expect(res.voice).toBe('ar-EG-ShakirNeural');
    expect(s.edge.calls).toHaveLength(1);
    expect(s.edge.calls[0].voice).toBe('ar-EG-ShakirNeural');
    expect(s.state.sessionId).toBe('session-a');
    expect(s.state.tabId).toBeNull();
    expect(s.state.status).toBe('playing');
    expect(s.state.playbackId).toBe('p1');
  });

  it('halts both engines and closes the previous page UI when a new playback starts', async () => {
    const s = setup();
    await s.controller.start({ text: 'أولاً', sessionId: 'a', tabId: 7 });
    await s.controller.start({ text: 'ثانياً', sessionId: 'b', tabId: 9 });
    expect(s.edge.halts).toBe(2);
    expect(s.browser.stops).toBe(2);
    expect(s.tabs).toContainEqual({ tabId: 7, msg: { __ta: 'reader', op: 'remote-stop' } });
    expect(s.state.sessionId).toBe('b');
    expect(s.state.text).toBe('ثانياً');
  });

  it('falls back to a language-appropriate browser voice and reports edgeError', async () => {
    const s = setup();
    s.edge.result = { ok: false, error: 'EDGE_WS_ERROR' };
    s.browser.result = { ok: true, voice: 'ar-EG-BrowserVoice' };
    const res = await s.controller.start({ text: 'نص عربي', sessionId: 'a', tabId: null });
    expect(res.ok).toBe(true);
    expect(res.engine).toBe('browser');
    expect(res.fallback).toBe(true);
    expect(res.edgeError).toBe('EDGE_WS_ERROR');
    expect(res.voice).toBe('ar-EG-BrowserVoice');
    expect(s.state.engine).toBe('browser');
    expect(s.state.voice).toBe('ar-EG-BrowserVoice');
  });

  it('does not fall back when the user stopped Edge mid-start', async () => {
    const s = setup();
    s.edge.result = { ok: false, error: 'EDGE_STOPPED' };
    const res = await s.controller.start({ text: 'نص', sessionId: 'a', tabId: null });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('TTS_STOPPED');
    expect(s.browser.calls).toHaveLength(0);
    expect(s.state.active).toBe(false);
  });

  it('lets a tab stop only its own page playback, never a text-only playback', async () => {
    const s = setup();
    await s.controller.start({ text: 'نص حر', sessionId: 'a', tabId: null });
    expect(await s.controller.stop({ kind: 'tab', tabId: 3 })).toBe(false);
    expect(s.state.active).toBe(true);
    expect(s.edge.halts).toBe(1); // فقط halt البدء

    await s.controller.start({ text: 'صفحة', sessionId: 'a', tabId: 3 });
    expect(await s.controller.stop({ kind: 'tab', tabId: 3 })).toBe(true);
    expect(s.state.active).toBe(false);
  });

  it('scopes stops to the session that owns the playback', async () => {
    const s = setup();
    await s.controller.start({ text: 'نص', sessionId: 'a', tabId: null });
    expect(await s.controller.stop({ kind: 'session', sessionId: 'b' })).toBe(false);
    expect(s.state.active).toBe(true);
    expect(await s.controller.stop({ kind: 'session', sessionId: 'a' })).toBe(true);
    expect(s.state.active).toBe(false);
  });

  it('ignores events from an old playbackId', async () => {
    const s = setup();
    await s.controller.start({ text: 'أول', sessionId: 'a', tabId: null });
    await s.controller.start({ text: 'ثان', sessionId: 'a', tabId: null });
    const before = s.state;
    s.controller.handleEvent({ playbackId: 'p1', event: { type: 'end' } });
    expect(s.state.playing).toBe(before.playing);
    expect(s.state.status).toBe('playing');

    s.controller.handleEvent({ playbackId: 'p2', event: { type: 'end', duration: 4 } });
    expect(s.state.playing).toBe(false);
    expect(s.state.status).toBe('ended');
    expect(s.state.duration).toBe(4);
  });

  it('does not resume an ended playback and enforces session ownership for pause/seek', async () => {
    const s = setup();
    await s.controller.start({ text: 'نص', sessionId: 'a', tabId: null });
    expect(s.controller.pause('b')).toBe(false);
    expect(s.controller.pause('a')).toBe(true);
    expect(s.state.status).toBe('paused');
    expect(s.controller.seek(3, 'b')).toBe(false);
    expect(s.controller.seek(3, 'a')).toBe(true);
    expect(s.state.currentTime).toBe(3);
    expect(s.edge.seeks).toContain(3);

    s.controller.handleEvent({ playbackId: 'p1', event: { type: 'end' } });
    expect(s.controller.resume('a')).toBe(false);
    expect(s.controller.pause('a')).toBe(false);
    expect(s.state.status).toBe('ended');
  });

  it('keeps a stable voiceId across the paragraphs of one reading', async () => {
    const s = setup();
    const first = await s.controller.start({
      text: 'الفقرة الأولى',
      sessionId: 'a',
      tabId: 5,
      voiceId: 'voice-1',
      index: 0,
      total: 2,
    });
    expect(first.voiceId).toBe('voice-1');
    expect(s.state.voiceId).toBe('voice-1');
    const second = await s.controller.start({
      text: 'الفقرة الثانية',
      sessionId: 'a',
      tabId: 5,
      voiceId: 'voice-1',
      index: 1,
      total: 2,
    });
    expect(second.voiceId).toBe('voice-1');
    expect(s.state.voiceId).toBe('voice-1');
    expect(s.state.index).toBe(1);
  });

  it('uses the playbackId as voiceId for a standalone text message', async () => {
    const s = setup();
    const res = await s.controller.start({ text: 'نص', sessionId: 'a', tabId: null });
    expect(res.voiceId).toBe(res.playbackId);
    expect(s.state.voiceId).toBe(res.playbackId);
  });

  it('lets Stop cancel a start that is still waiting on the engine halt', async () => {
    const s = setup();
    const gate: { release: null | (() => void) } = { release: null };
    s.edge.halt = () => {
      if (!gate.release) return new Promise<void>((resolve) => { gate.release = resolve; });
      return Promise.resolve();
    };
    const pendingStart = s.controller.start({ text: 'نص', sessionId: 'a', tabId: null, voiceId: 'early-voice' });
    await Promise.resolve();
    expect(await s.controller.stop({ kind: 'session', sessionId: 'a' })).toBe(true);
    gate.release?.();
    const res = await pendingStart;
    expect(res.ok).toBe(false);
    expect(res.error).toBe('TTS_SUPERSEDED');
    expect(s.state.active).toBe(false);
    expect(s.edge.calls).toHaveLength(0);

    // حتى لو وصل الطلب متأخراً بعد الإيقاف، لا يبدأ
    const late = await s.controller.start({ text: 'نص', sessionId: 'a', tabId: null, voiceId: 'early-voice' });
    expect(late.ok).toBe(false);
    expect(late.error).toBe('TTS_STOPPED');
  });

  it('rejects an in-flight page paragraph after its voiceId was stopped, but allows replay', async () => {
    const s = setup();
    await s.controller.start({ text: 'الفقرة الأولى', sessionId: 'a', tabId: 8, voiceId: 'voice-1' });
    expect(await s.controller.stop({ kind: 'session', sessionId: 'a' })).toBe(true);

    const stale = await s.controller.start({ text: 'الفقرة الثانية', sessionId: 'a', tabId: 8, voiceId: 'voice-1' });
    expect(stale.ok).toBe(false);
    expect(stale.error).toBe('TTS_STOPPED');
    expect(s.state.active).toBe(false);
    expect(s.edge.calls).toHaveLength(1); // لم يبدأ طلب جديد

    const replay = await s.controller.start({
      text: 'الفقرة الأولى',
      sessionId: 'a',
      tabId: null,
      voiceId: 'voice-1',
      replay: true,
    });
    expect(replay.ok).toBe(true);
    expect(replay.voiceId).toBe('voice-1');
  });

  it('keeps accepting the next paragraph of the same live reading', async () => {
    const s = setup();
    await s.controller.start({ text: 'الفقرة الأولى', sessionId: 'a', tabId: 8, voiceId: 'voice-1', index: 0, total: 2 });
    const next = await s.controller.start({ text: 'الفقرة الثانية', sessionId: 'a', tabId: 8, voiceId: 'voice-1', index: 1, total: 2 });
    expect(next.ok).toBe(true);
    expect(s.state.index).toBe(1);
  });

  it('uses a real browser voice even when an Edge voice was requested for the browser engine', async () => {
    const s = setup();
    s.browser.result = { ok: true, voice: 'ar-EG-BrowserVoice' };
    const res = await s.controller.start({
      text: 'نص عربي',
      voice: 'ar-EG-ShakirNeural',
      engine: 'browser',
      sessionId: 'a',
      tabId: null,
    });
    expect(res.ok).toBe(true);
    expect(res.engine).toBe('browser');
    expect(s.browser.calls[0].voice).toBe('ar-EG-BrowserVoice');
    expect(s.state.voice).toBe('ar-EG-BrowserVoice');
  });
});
