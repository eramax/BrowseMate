// Microsoft Edge Read Aloud (أصوات عصبية) — البروتوكول + إدارة offscreen + تمويه UA.
// الصوت نفسه يُشغّل في offscreen.html، والـ SW ينسّق الاتصال وأحداث الكلمات.
import { logSystemDebug } from './debug';

export interface EdgeVoice {
  name: string;
  lang: string;
  gender: string;
  friendlyName: string;
  engine: 'edge';
}

const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WSS_BASE = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const VOICES_URL = 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list';
const SEC_MS_GEC_VERSION = '2-143.0.3650.96';
const EDGE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0';
const COPYRIGHT = 'Copyright (C) Microsoft Corporation. All rights reserved.';
const CACHE_KEY = 'edgeVoicesV1';
const CACHE_TTL = 24 * 60 * 60 * 1000;

const SWAP_FIRST_WORD = { swappedWord: 0xef0569fb, swappedSum: 0x76f50f34, swappedProduct: 0xc3efea97 };
const SWAP_SECOND_WORD = { swappedWord: 0xc31713db, swappedSum: 0x1881ce3c, swappedProduct: 0x35bd1ec9 };
const MIX_FIRST_WORD = [0xcf98b111, 0x87085b9f, 0x12ceb96d, 0x257e1d83];
const MIX_SECOND_WORD = [0xa27416f5, 0xd38396ff, 0x7c932b89, 0xbfa49f69];

let memoryVoices: EdgeVoice[] | null = null;
let edgeActiveTabId: number | null = null;
let connecting: Promise<{ ok: boolean; error?: string }> | null = null;
let edgeEpoch = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function msgOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function toUpperHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function swapHalves(v: number): number {
  return ((v << 16) | (v >>> 16)) >>> 0;
}

function swapTerm(word: number, key: number, m: { swappedWord: number; swappedSum: number; swappedProduct: number }): number {
  const sum = Math.imul(word, key) + Math.imul(swapHalves(word), m.swappedWord);
  const product = Math.imul(swapHalves(sum), m.swappedSum) >>> 0;
  return (Math.imul(swapHalves(product), m.swappedProduct) + product) >>> 0;
}

function swapAndMultiply(value: number, multipliers: number[]): number {
  for (const m of multipliers) value = Math.imul(swapHalves(value), m) >>> 0;
  return value;
}

function cs64(message: Uint8Array, digest: Uint8Array): Uint8Array {
  const dv = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);
  const firstKey = (dv.getUint32(0, true) | 1) >>> 0;
  const secondKey = (dv.getUint32(4, true) | 1) >>> 0;
  const padded = new Uint8Array(Math.ceil(message.length / 8) * 8);
  padded.set(message);
  const words = new DataView(padded.buffer);
  let swapSum = 0;
  let lastSwap = 0;
  let mix = 0;
  let mixSum = 0;
  for (let offset = 0; offset < padded.length; offset += 8) {
    const firstWord = words.getUint32(offset, true);
    const secondWord = words.getUint32(offset + 4, true);
    const firstSwap = swapTerm(firstWord, firstKey, SWAP_FIRST_WORD);
    lastSwap = swapTerm(secondWord, secondKey, SWAP_SECOND_WORD);
    swapSum = (swapSum + firstSwap + lastSwap) >>> 0;
    mix = swapAndMultiply(Math.imul(mix + firstWord, firstKey) >>> 0, MIX_FIRST_WORD);
    mixSum = (mixSum + mix) >>> 0;
    mix = swapAndMultiply(Math.imul(mix + secondWord, secondKey) >>> 0, MIX_SECOND_WORD);
    mixSum = (mixSum + mix) >>> 0;
  }
  const checksum = new Uint8Array(8);
  const cv = new DataView(checksum.buffer);
  cv.setUint32(0, lastSwap ^ mix, true);
  cv.setUint32(4, swapSum ^ mixSum, true);
  return checksum;
}

export async function hashSecMsGecV2(ticksAndToken: string): Promise<string> {
  const message = new TextEncoder().encode(COPYRIGHT + ticksAndToken);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', message));
  return `${toUpperHex(cs64(message, digest))}-${toUpperHex(digest)}`;
}

async function generateSecMsGecV2(): Promise<string> {
  const ticks = Math.floor(Date.now() / 1000) + 11644473600;
  const rounded = ticks - (ticks % 300);
  return hashSecMsGecV2(`${rounded * 10_000_000}${TOKEN}`);
}

async function buildEdgeWsUrl(): Promise<string> {
  const gec = await generateSecMsGecV2();
  const connectionId = crypto.randomUUID();
  return `${WSS_BASE}?TrustedClientToken=${TOKEN}&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}&ConnectionId=${connectionId}`;
}

function storageGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(key, (data) => resolve(data?.[key] as T | undefined));
    } catch {
      resolve(undefined);
    }
  });
}

export async function fetchEdgeVoices(force = false): Promise<EdgeVoice[]> {
  if (!force && memoryVoices) return memoryVoices;
  if (!force) {
    const cached = await storageGet<{ ts: number; voices: EdgeVoice[] }>(CACHE_KEY);
    if (cached && Array.isArray(cached.voices) && Date.now() - cached.ts < CACHE_TTL) {
      memoryVoices = cached.voices;
      return cached.voices;
    }
  }
  const res = await fetch(`${VOICES_URL}?trustedclienttoken=${TOKEN}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`EDGE_VOICES_HTTP_${res.status}`);
  const data: any = await res.json();
  const voices: EdgeVoice[] = (Array.isArray(data) ? data : [])
    .filter((v: any) => v?.ShortName)
    .map((v: any) => ({
      name: String(v.ShortName),
      lang: String(v.Locale || ''),
      gender: String(v.Gender || ''),
      friendlyName: String(v.FriendlyName || v.ShortName),
      engine: 'edge' as const,
    }));
  memoryVoices = voices;
  try { await chrome.storage.local.set({ [CACHE_KEY]: { ts: Date.now(), voices } }); } catch { /* ignore */ }
  return voices;
}

function sendOffscreen(msg: Record<string, unknown>): Promise<any> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ target: 'offscreen', ...msg }, (res) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
        else resolve(res);
      });
    } catch (e) {
      resolve({ ok: false, error: msgOf(e) });
    }
  });
}

async function ensureOffscreen(force = false): Promise<void> {
  const exists = await chrome.offscreen.hasDocument().catch(() => false);
  if (exists && !force) {
    const st = await sendOffscreen({ type: 'edge-ping' });
    if (st?.ok) return;
    // المستند موجود لكنه لا يستجيب (SW أُعيد تشغيله/انقطاع) — أعد إنشاءه
    console.warn('[EdgeTTS] offscreen not responding, recreating');
    try { await chrome.offscreen.closeDocument(); } catch { /* ignore */ }
  } else if (exists) {
    try { await chrome.offscreen.closeDocument(); } catch { /* ignore */ }
  }
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Microsoft Edge neural text-to-speech playback',
  });
  for (let i = 0; i < 30; i++) {
    const st = await sendOffscreen({ type: 'edge-ping' });
    if (st?.ok) return;
    await sleep(100);
  }
}

async function findOffscreenTarget(): Promise<chrome.debugger.Debuggee & { id: string; attached?: boolean } | null> {
  for (let i = 0; i < 20; i++) {
    const targets = await chrome.debugger.getTargets();
    const target = targets.find((t) => (t.url || '').includes('/offscreen.html'));
    if (target) return target as chrome.debugger.Debuggee & { id: string; attached?: boolean };
    await sleep(100);
  }
  return null;
}

/** يتصل بـ Edge WS مع تمويه UA عبر debugger (ثم يفصل فوراً) */
export async function ensureEdgeConnected(): Promise<{ ok: boolean; error?: string }> {
  if (connecting) return connecting;
  connecting = (async () => {
    const state = await sendOffscreen({ type: 'edge-state' });
    if (state?.ok && state.open) return { ok: true };

    // لو لم يرد المستند أصلاً، أعد إنشاءه
    await ensureOffscreen(!state?.ok);
    const target = await findOffscreenTarget();
    if (!target) return { ok: false, error: 'EDGE_OFFSCREEN_NOT_FOUND' };

    let attached = false;
    try {
      try {
        await chrome.debugger.attach({ targetId: target.id }, '1.3');
        attached = true;
      } catch (e) {
        if (!target.attached) return { ok: false, error: `EDGE_DEBUGGER_ATTACH_FAILED: ${msgOf(e)}` };
      }
      await chrome.debugger.sendCommand({ targetId: target.id }, 'Network.enable');
      await chrome.debugger.sendCommand({ targetId: target.id }, 'Network.setUserAgentOverride', {
        userAgent: EDGE_UA,
      });
      const wsUrl = await buildEdgeWsUrl();
      const res = await sendOffscreen({ type: 'edge-connect', wsUrl });
      if (!res?.ok) return { ok: false, error: res?.error || 'EDGE_CONNECT_FAILED' };
      console.log('[EdgeTTS] websocket connected');
      return { ok: true };
    } catch (e) {
      void logSystemDebug('tts:edge-connect-failed', { error: msgOf(e) }, 'warn');
      return { ok: false, error: msgOf(e) };
    } finally {
      if (attached) await chrome.debugger.detach({ targetId: target.id }).catch(() => {});
    }
  })().finally(() => {
    connecting = null;
  });
  return connecting;
}

export async function edgeSpeak(
  text: string,
  voice: string | undefined,
  rate: number | undefined,
  tabId: number | null,
  key = '',
  prefetch: Array<{ key: string; text: string }> = [],
): Promise<{ ok: boolean; error?: string }> {
  const previousTabId = edgeActiveTabId;
  const epoch = edgeEpoch;
  const c = await ensureEdgeConnected();
  if (epoch !== edgeEpoch) return { ok: false, error: 'EDGE_STOPPED' };
  if (!c.ok) return { ok: false, error: c.error };
  const res = await sendOffscreen({
    type: 'edge-speak',
    text,
    voice: voice || '',
    rate: rate ?? 1,
    tabId,
    key,
    prefetch,
  });
  if (epoch !== edgeEpoch) return { ok: false, error: 'EDGE_STOPPED' };
  if (!res?.ok) {
    console.warn('[EdgeTTS] speak failed:', res?.error);
    void logSystemDebug('tts:edge-speak-failed', { error: res?.error, voice }, 'warn');
    return { ok: false, error: res?.error || 'EDGE_SPEAK_FAILED' };
  }
  console.log('[EdgeTTS] playing', voice || 'auto', 'words', res.words);
  if (previousTabId != null && previousTabId !== tabId) {
    // الصوت الجديد بدأ — أغلق واجهة القارئ القديمة في التبويب السابق
    try { void chrome.tabs.sendMessage(previousTabId, { __ta: 'reader', op: 'stop' }).catch(() => {}); } catch { /* ignore */ }
  }
  edgeActiveTabId = tabId;
  return { ok: true };
}

export function edgeStop(): void {
  edgeEpoch++;
  void sendOffscreen({ type: 'edge-stop' });
  edgeActiveTabId = null;
}

/** إيقاف فوري مع انتظار إغلاق الـ WS — يُستخدم قبل إعادة القراءة بسرعة جديدة */
export async function edgeCancel(): Promise<void> {
  edgeEpoch++;
  await sendOffscreen({ type: 'edge-stop' }).catch(() => {});
  edgeActiveTabId = null;
}

export function edgePause(): void {
  void sendOffscreen({ type: 'edge-pause' });
}

export function edgeResume(): void {
  void sendOffscreen({ type: 'edge-resume' });
}

export function edgeSeek(time: number): void {
  void sendOffscreen({ type: 'edge-seek', time });
}

export async function edgeState(): Promise<{ open: boolean; playing: boolean } | null> {
  const res = await sendOffscreen({ type: 'edge-state' });
  if (!res?.ok) return null;
  return { open: Boolean(res.open), playing: Boolean(res.playing) };
}

// أوقف صوت Edge عند إغلاق/انتقال التبويب الذي يقرأ
try {
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === edgeActiveTabId) edgeStop();
  });
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (tabId === edgeActiveTabId && info.status === 'loading') edgeStop();
  });
} catch {
  /* بيئة اختبار */
}
