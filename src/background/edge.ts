// Microsoft Edge Read Aloud (أصوات عصبية) — البروتوكول + إدارة offscreen.
// تم استبدال تمويه UA عبر chrome.debugger بقاعدة declarativeNetRequest:
// أخف، بلا شريط "يتم تصحيح الأخطاء"، وبلا سباقات attach/detach.
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
const UA_RULE_ID = 910731;
const OFFSCREEN_URL = 'offscreen.html';

const SWAP_FIRST_WORD = { swappedWord: 0xef0569fb, swappedSum: 0x76f50f34, swappedProduct: 0xc3efea97 };
const SWAP_SECOND_WORD = { swappedWord: 0xc31713db, swappedSum: 0x1881ce3c, swappedProduct: 0x35bd1ec9 };
const MIX_FIRST_WORD = [0xcf98b111, 0x87085b9f, 0x12ceb96d, 0x257e1d83];
const MIX_SECOND_WORD = [0xa27416f5, 0xd38396ff, 0x7c932b89, 0xbfa49f69];

let memoryVoices: EdgeVoice[] | null = null;
let connecting: Promise<{ ok: boolean; error?: string }> | null = null;
// timestamp-based حتى يبقى متزايداً عبر إعادة تشغيل الـ service worker
let edgeEpoch = Date.now();
let uaRule: Promise<void> | null = null;

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
  await ensureEdgeUaRule();
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

// ===== UA override via declarativeNetRequest =====
// صوت Edge يرفض UA الخاص بـ Chrome. القاعدة تُثبت رأس user-agent لطلبات
// speech.platform.bing.com فقط، وتبقى طوال جلسة المتصفح.
export async function ensureEdgeUaRule(): Promise<void> {
  if (uaRule) return uaRule;
  uaRule = (async () => {
    const dnr = (chrome as any).declarativeNetRequest;
    if (!dnr?.updateSessionRules) return;
    try {
      // لا تحذف القاعدة وتعيد إضافتها إن كانت موجودة بنفس القيمة:
      // إعادة الإضافة تخلق نافذة قصيرة قد يفشل فيها أول اتصال بعد إعادة تشغيل الـ SW.
      if (dnr.getSessionRules) {
        const rules = await dnr.getSessionRules();
        const existing = Array.isArray(rules) ? rules.find((r: any) => r.id === UA_RULE_ID) : null;
        const ua = existing?.action?.requestHeaders?.find((h: any) => h.header === 'user-agent')?.value;
        if (ua === EDGE_UA) return;
      }
      await dnr.updateSessionRules({
        removeRuleIds: [UA_RULE_ID],
        addRules: [
          {
            id: UA_RULE_ID,
            priority: 1,
            action: {
              type: 'modifyHeaders',
              requestHeaders: [{ header: 'user-agent', operation: 'set', value: EDGE_UA }],
            },
            condition: {
              urlFilter: '||speech.platform.bing.com',
              resourceTypes: ['websocket', 'xmlhttprequest'],
            },
          },
        ],
      });
      // امنح DNR لحظة لتطبيق القاعدة قبل أول handshake
      await sleep(60);
    } catch (e) {
      uaRule = null;
      void logSystemDebug('tts:ua-rule-failed', { error: msgOf(e) }, 'warn');
    }
  })().finally(() => {
    // أبقِ الوعد المحلول: القاعدة تُثبّت مرة واحدة لكل جلسة SW
  });
  return uaRule;
}

function isConnectionError(error: unknown): boolean {
  return /OFFSCREEN_TIMEOUT|OFFSCREEN_NOT_READY|Receiving end|message port closed|channel closed|EDGE_NO_WS|EDGE_WS_CLOSED|EDGE_WS_ERROR|EDGE_SEND_FAILED|EDGE_CONNECT_FAILED|EDGE_WS_TIMEOUT|EDGE_NO_OFFSCREEN/i.test(
    String(error || ''),
  );
}

function isRetryableSpeakError(error: unknown): boolean {
  return isConnectionError(error) || /^(EDGE_TIMEOUT|EDGE_NO_AUDIO)$/.test(String(error || ''));
}

function sendOffscreen(msg: Record<string, unknown>, timeoutMs = 15_000): Promise<any> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => finish({ ok: false, error: 'OFFSCREEN_TIMEOUT' }), timeoutMs);
    function finish(value: any): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }
    try {
      chrome.runtime.sendMessage({ target: 'offscreen', ...msg }, (res) => {
        if (chrome.runtime.lastError) finish({ ok: false, error: chrome.runtime.lastError.message });
        else finish(res);
      });
    } catch (e) {
      finish({ ok: false, error: msgOf(e) });
    }
  });
}

let offscreenJob: Promise<void> = Promise.resolve();

async function doEnsureOffscreen(force: boolean): Promise<void> {
  const exists = await chrome.offscreen.hasDocument().catch(() => false);
  if (exists) {
    if (!force) {
      const st = await sendOffscreen({ type: 'edge-ping' }, 2500);
      if (st?.ok) return;
      console.warn('[EdgeTTS] offscreen not responding, recreating');
    }
    try { await chrome.offscreen.closeDocument(); } catch { /* ignore */ }
  }
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Microsoft Edge neural text-to-speech playback',
    });
  } catch (e) {
    // سباق مع منشئ آخر — المهم أن المستند موجود في النهاية
    if (!/single offscreen document/i.test(msgOf(e))) throw e;
  }
  for (let i = 0; i < 50; i++) {
    const st = await sendOffscreen({ type: 'edge-ping' }, 1000);
    if (st?.ok) return;
    await sleep(100);
  }
  throw new Error('OFFSCREEN_NOT_READY');
}

/** إنشاء/إحياء مستند offscreen — عمليات متسلسلة تمنع سباق "مستند واحد فقط". */
export async function ensureOffscreen(force = false): Promise<void> {
  const run = offscreenJob.catch(() => {}).then(() => doEnsureOffscreen(force));
  offscreenJob = run.catch(() => {});
  return run;
}

/** يتصل بـ Edge WS. القاعدة تثبت UA، لذا لا حاجة لأي debugger. */
export async function ensureEdgeConnected(): Promise<{ ok: boolean; error?: string }> {
  if (connecting) return connecting;
  let p: Promise<{ ok: boolean; error?: string }>;
  p = (async () => {
    await ensureEdgeUaRule();
    const state = await sendOffscreen({ type: 'edge-state' }, 2500);
    if (state?.ok && state.open) return { ok: true };

    // لو لم يرد المستند أصلاً، أعد إنشاءه — وإلا اكتفِ بفتح اتصال جديد
    try {
      await ensureOffscreen(!state?.ok);
    } catch (e) {
      return { ok: false, error: msgOf(e) };
    }
    const res = await sendOffscreen({ type: 'edge-connect', wsUrl: await buildEdgeWsUrl() }, 20_000);
    if (!res?.ok) return { ok: false, error: res?.error || 'EDGE_CONNECT_FAILED' };
    console.log('[EdgeTTS] websocket connected');
    return { ok: true };
  })().finally(() => {
    // لا تمسح وعد اتصال أحدث بدأ بعد resetEdgeConnection
    if (connecting === p) connecting = null;
  });
  connecting = p;
  return p;
}

/** إعادة فتح الـ WS دون إعادة إنشاء المستند أو مسح الكاش. */
export async function resetEdgeConnection(): Promise<{ ok: boolean; error?: string }> {
  connecting = null;
  await sendOffscreen({ type: 'edge-reset' }, 3000);
  await sleep(60);
  return ensureEdgeConnected();
}

/** إعادة إنشاء المحرك بالكامل — آخر حل فقط. */
export async function resetEdge(): Promise<{ ok: boolean; error?: string }> {
  connecting = null;
  const epoch = ++edgeEpoch;
  await sendOffscreen({ type: 'edge-stop', epoch }, 3000);
  try {
    await ensureOffscreen(true);
  } catch (e) {
    return { ok: false, error: msgOf(e) };
  }
  return ensureEdgeConnected();
}

export async function edgeSpeak(
  text: string,
  voice: string | undefined,
  rate: number | undefined,
  tabId: number | null,
  key = '',
  prefetch: Array<{ key: string; text: string }> = [],
  playbackId = '',
): Promise<{ ok: boolean; error?: string; voice?: string }> {
  let epoch = edgeEpoch;
  let connect = await ensureEdgeConnected();
  if (!connect.ok && isConnectionError(connect.error)) {
    void logSystemDebug('tts:edge-retry', { stage: 'connect', error: connect.error }, 'warn');
    await sleep(150);
    connect = await resetEdgeConnection();
  }
  if (epoch !== edgeEpoch) return { ok: false, error: 'EDGE_STOPPED' };
  if (!connect.ok) return { ok: false, error: connect.error };

  const payload = {
    type: 'edge-speak',
    text,
    voice: voice || '',
    rate: rate ?? 1,
    tabId,
    key,
    prefetch,
    playbackId,
    epoch,
  };

  let res: any = await sendOffscreen(payload, 70_000);
  if (!res?.ok && isRetryableSpeakError(res?.error)) {
    void logSystemDebug('tts:edge-retry', { stage: 'reconnect', error: res?.error }, 'warn');
    await sleep(120);
    const retry = await resetEdgeConnection();
    if (!retry.ok) return { ok: false, error: retry.error };
    if (epoch !== edgeEpoch) return { ok: false, error: 'EDGE_STOPPED' };
    res = await sendOffscreen(payload, 70_000);
  }
  if (!res?.ok && isRetryableSpeakError(res?.error)) {
    void logSystemDebug('tts:edge-retry', { stage: 'recreate', error: res?.error }, 'warn');
    await sleep(120);
    const beforeReset = edgeEpoch;
    const retry = await resetEdge();
    if (!retry.ok) return { ok: false, error: retry.error };
    // resetEdge يزيد epoch مرة واحدة. لو زاد أكثر فهذا يعني أن المستخدم أوقف/بدأ تشغيلاً جديداً.
    if (edgeEpoch !== beforeReset + 1) return { ok: false, error: 'EDGE_STOPPED' };
    epoch = edgeEpoch;
    payload.epoch = epoch;
    res = await sendOffscreen(payload, 70_000);
  }
  if (epoch !== edgeEpoch) return { ok: false, error: 'EDGE_STOPPED' };
  if (!res?.ok) {
    console.warn('[EdgeTTS] speak failed:', res?.error);
    void logSystemDebug('tts:edge-speak-failed', { error: res?.error, voice, text: text.slice(0, 80) }, 'warn');
    return { ok: false, error: res?.error || 'EDGE_SPEAK_FAILED' };
  }
  console.log('[EdgeTTS] playing', res.voice || voice || 'auto', 'words', res.words);
  return { ok: true, voice: res.voice || voice || '' };
}

/** إسكات فوري مع إبقاء WS والكاش — للانتقال بين الفقرات وتغيير السرعة. */
export async function edgeHalt(): Promise<void> {
  const epoch = ++edgeEpoch;
  await sendOffscreen({ type: 'edge-halt', epoch }, 3000);
}

export async function edgeStop(): Promise<void> {
  const epoch = ++edgeEpoch;
  await sendOffscreen({ type: 'edge-stop', epoch }, 3000);
}

export function edgePause(): void {
  void sendOffscreen({ type: 'edge-pause' }, 3000);
}

export function edgeResume(): void {
  void sendOffscreen({ type: 'edge-resume' }, 3000);
}

export function edgeSeek(time: number): void {
  void sendOffscreen({ type: 'edge-seek', time }, 3000);
}

export async function edgeState(): Promise<{
  open: boolean;
  playing: boolean;
  playbackId: string;
  currentTime: number;
  duration: number;
} | null> {
  const res = await sendOffscreen({ type: 'edge-state' }, 2500);
  if (!res?.ok) return null;
  return {
    open: Boolean(res.open),
    playing: Boolean(res.playing),
    playbackId: String(res.playbackId || ''),
    currentTime: Number(res.currentTime) || 0,
    duration: Number(res.duration) || 0,
  };
}

/** تسخين اتصال Edge وإبقاء مستند offscreen حياً أثناء فتح البانل. */
export async function edgeWarm(): Promise<void> {
  await sendOffscreen({ type: 'edge-warm' }, 3000);
}

export async function edgeCold(): Promise<void> {
  await sendOffscreen({ type: 'edge-cold' }, 3000);
}

/** توليد/جمع MP3 كامل لرسالة صوتية (للتحميل) دون تشغيله. */
export async function edgeExport(
  items: Array<{ key: string; text: string }>,
  voice: string,
  rate: number,
): Promise<{ ok: boolean; base64?: string; error?: string; bytes?: number }> {
  const connect = await ensureEdgeConnected();
  if (!connect.ok) return { ok: false, error: connect.error };
  return sendOffscreen({ type: 'edge-export', items, voice, rate }, 180_000);
}
