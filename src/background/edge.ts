// Microsoft Edge Read Aloud (أصوات عصبية) — البروتوكول + النقل عبر Port إلى iframe البانل.
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
// الخادم القديم speech.platform.bing.com يرفض التركيب منذ أكتوبر 2026.
// Edge 155+ يستخدم api.msedgeservices.com بنفس التوكن القديم كمفتاح اشتراك.
const WSS_BASE = 'wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1';
const VOICES_URL = 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list';
const SEC_MS_GEC_VERSION = '2-143.0.3650.96';
const EDGE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0';
const COPYRIGHT = 'Copyright (C) Microsoft Corporation. All rights reserved.';
const CACHE_KEY = 'edgeVoicesV1';
const CACHE_TTL = 24 * 60 * 60 * 1000;
const UA_RULE_ID = 910731;
const UA_RULE_ID_NEW = 910732;
// أعلى أولوية ممكنة: أي إضافة أخرى (مثل User Agent Switcher) قد تغيّر
// user-agent بقاعدة priority=110، وعندها يرفض Edge الاتصال. الأولوية
// القصوى تجعل قاعدتنا هي الفائزة.
const UA_RULE_PRIORITY = 2_147_483_647;
// Edge يحدّ عدد الاتصالات من نفس الشبكة. بعد فشلين متتاليين نوقف
// المحاولات دقيقة كاملة بدل مهاجمة الخدمة (circuit breaker).
const EDGE_RATE_RETRY_MS = 5_000;
const EDGE_COOLDOWN_MS = 60_000;

const SWAP_FIRST_WORD = { swappedWord: 0xef0569fb, swappedSum: 0x76f50f34, swappedProduct: 0xc3efea97 };
const SWAP_SECOND_WORD = { swappedWord: 0xc31713db, swappedSum: 0x1881ce3c, swappedProduct: 0x35bd1ec9 };
const MIX_FIRST_WORD = [0xcf98b111, 0x87085b9f, 0x12ceb96d, 0x257e1d83];
const MIX_SECOND_WORD = [0xa27416f5, 0xd38396ff, 0x7c932b89, 0xbfa49f69];

let memoryVoices: EdgeVoice[] | null = null;
let connecting: Promise<EdgeConnectResult> | null = null;
// timestamp-based حتى يبقى متزايداً عبر إعادة تشغيل الـ service worker
let edgeEpoch = Date.now();
let edgeCooldownUntil = 0;
let uaRule: Promise<void> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function msgOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface EdgeConnectResult {
  ok: boolean;
  error?: string;
  /** هل نجح handshake ثم أُغلق الاتصال؟ (مؤشر rate-limit وليس UA) */
  opened?: boolean;
  bytes?: number;
  retryAfterMs?: number;
}

function cooldownResult(): EdgeConnectResult | null {
  const left = edgeCooldownUntil - Date.now();
  if (left <= 0) return null;
  return { ok: false, error: 'EDGE_COOLDOWN', retryAfterMs: left };
}

function startEdgeCooldown(reason: string): void {
  edgeCooldownUntil = Date.now() + EDGE_COOLDOWN_MS;
  void logSystemDebug('tts:edge-service-unavailable', { reason, retryAfterMs: EDGE_COOLDOWN_MS }, 'warn');
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

export async function buildEdgeWsUrl(): Promise<string> {
  const gec = await generateSecMsGecV2();
  const connectionId = crypto.randomUUID();
  return `${WSS_BASE}?Ocp-Apim-Subscription-Key=${TOKEN}&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}&ConnectionId=${connectionId}`;
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
// صوت Edge يرفض UA الخاص بـ Chrome. القواعد تُثبت رأس user-agent
// لخادم الأصوات القديم وخادم التركيب الجديد، وتبقى طوال جلسة المتصفح.
/**
 * يثبّت قاعدة UA لأعلى أولوية. force=true يعيد إضافة القاعدة حتى لو
 * كانت موجودة — نستخدمه بعد فشل 1006/WS_ERROR لأن إضافة أخرى قد تكون
 * أضافت قاعدة منافسة بعد قاعدتنا.
 */
export async function ensureEdgeUaRule(force = false): Promise<void> {
  if (uaRule) return uaRule;
  uaRule = (async () => {
    const dnr = (chrome as any).declarativeNetRequest;
    if (!dnr?.updateSessionRules) return;
    try {
      const hosts = [
        { id: UA_RULE_ID, filter: '||speech.platform.bing.com' },
        { id: UA_RULE_ID_NEW, filter: '||api.msedgeservices.com' },
      ];
      let existing: any[] = [];
      if (dnr.getSessionRules) {
        const rules = await dnr.getSessionRules();
        existing = Array.isArray(rules) ? rules.filter((r: any) => hosts.some((h) => h.id === r.id)) : [];
      }
      const allOk = !force && hosts.every((h) => {
        const rule = existing.find((r: any) => r.id === h.id);
        const ua = rule?.action?.requestHeaders?.find((x: any) => x.header === 'user-agent')?.value;
        return ua === EDGE_UA && rule?.priority === UA_RULE_PRIORITY;
      });
      if (allOk) return;
      await dnr.updateSessionRules({
        removeRuleIds: hosts.map((h) => h.id),
        addRules: hosts.map((h) => ({
          id: h.id,
          priority: UA_RULE_PRIORITY,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [{ header: 'user-agent', operation: 'set', value: EDGE_UA }],
          },
          condition: {
            urlFilter: h.filter,
            resourceTypes: ['websocket', 'xmlhttprequest'],
          },
        })),
      });
      // امنح DNR لحظة لتطبيق القاعدة قبل أول handshake
      await sleep(60);
      void logSystemDebug('tts:ua-rule', { priority: UA_RULE_PRIORITY, forced: force, rules: existing.length }, 'info');
    } catch (e) {
      void logSystemDebug('tts:ua-rule-failed', { error: msgOf(e), forced: force }, 'warn');
    }
  })().finally(() => {
    // لا نُبقي الوعد: كل اتصال يتحقق من القاعدة again، لأن إضافة أخرى
    // قد تحذفها أو تتجاوزها أثناء عمل الـ SW.
    uaRule = null;
  });
  return uaRule;
}

function isConnectionError(error: unknown): boolean {
  return /ENGINE_TIMEOUT|Receiving end|message port closed|channel closed|EDGE_NO_WS|EDGE_WS_CLOSED|EDGE_WS_ERROR|EDGE_SEND_FAILED|EDGE_CONNECT_FAILED|EDGE_WS_TIMEOUT/i.test(
    String(error || ''),
  );
}

function isRetryableSpeakError(error: unknown): boolean {
  return isConnectionError(error) || /^(EDGE_TIMEOUT|EDGE_NO_AUDIO)$/.test(String(error || ''));
}

let enginePort: chrome.runtime.Port | null = null;
let engineReqId = 0;
const engineWaiters = new Map<number, { resolve: (v: any) => void; timer: ReturnType<typeof setTimeout> }>();

function settleWaiter(id: number, value: any): void {
  const w = engineWaiters.get(id);
  if (!w) return;
  engineWaiters.delete(id);
  clearTimeout(w.timer);
  w.resolve(value);
}

/** يسجّل iframe محرك الصوت داخل البانل كمنفذ مباشر. */
export function registerEnginePort(p: chrome.runtime.Port): boolean {
  const replaced = Boolean(enginePort && enginePort !== p);
  if (replaced) {
    try { enginePort!.postMessage({ type: 'edge-stop' }); } catch { /* ignore */ }
    for (const id of [...engineWaiters.keys()]) settleWaiter(id, { ok: false, error: 'NO_TTS_PANEL' });
  }
  enginePort = p;
  p.onMessage.addListener((msg: any) => {
    if (msg?.type === 'edge-result') settleWaiter(Number(msg.id), msg.res ?? { ok: false, error: 'EMPTY_ENGINE_RESULT' });
  });
  p.onDisconnect.addListener(() => {
    if (enginePort === p) {
      enginePort = null;
      for (const id of [...engineWaiters.keys()]) settleWaiter(id, { ok: false, error: 'NO_TTS_PANEL' });
    }
  });
  // لا نسخّن اتصالاً عند فتح البانل: Edge يحدّ الاتصالات، والاتصال
  // الخامل يُغلق غالباً. نفتح اتصالاً واحداً عند أول طلب فعلي.
  return replaced;
}

function sendEngine(msg: Record<string, unknown>, timeoutMs = 15_000): Promise<any> {
  return new Promise((resolve) => {
    if (!enginePort) { resolve({ ok: false, error: 'NO_TTS_PANEL' }); return; }
    const id = ++engineReqId;
    const timer = setTimeout(() => settleWaiter(id, { ok: false, error: 'ENGINE_TIMEOUT' }), timeoutMs);
    engineWaiters.set(id, { resolve, timer });
    try {
      enginePort.postMessage({ id, ...msg });
    } catch (e) {
      settleWaiter(id, { ok: false, error: msgOf(e) });
    }
  });
}

/** يتصل بـ Edge WS. القاعدة تثبت UA، لذا لا حاجة لأي debugger. */
export async function ensureEdgeConnected(): Promise<EdgeConnectResult> {
  const cool = cooldownResult();
  if (cool) return cool;
  if (connecting) return connecting;
  let p: Promise<EdgeConnectResult>;
  p = (async () => {
    if (!enginePort) return { ok: false, error: 'NO_TTS_PANEL' };
    await ensureEdgeUaRule();
    const state = await sendEngine({ type: 'edge-state' }, 2500);
    if (!state?.ok) return { ok: false, error: state?.error || 'NO_TTS_PANEL' };
    if (state.open) return { ok: true };
    const res = await sendEngine({ type: 'edge-connect', wsUrl: await buildEdgeWsUrl() }, 20_000);
    if (!res?.ok) {
      return { ok: false, error: res?.error || 'EDGE_CONNECT_FAILED', opened: res?.opened, bytes: res?.bytes };
    }
    console.log('[EdgeTTS] websocket connected');
    return { ok: true };
  })().finally(() => {
    if (connecting === p) connecting = null;
  });
  connecting = p;
  return p;
}

/** إعادة فتح الـ WS دون إعادة إنشاء المحرك أو مسح الكاش. */
export async function resetEdgeConnection(): Promise<EdgeConnectResult> {
  connecting = null;
  await sendEngine({ type: 'edge-reset' }, 3000);
  await sleep(400);
  return ensureEdgeConnected();
}

/** إعادة ضبط المحرك — أغلق/أعد فتح WS فقط. */
export async function resetEdge(): Promise<EdgeConnectResult> {
  connecting = null;
  const epoch = ++edgeEpoch;
  await sendEngine({ type: 'edge-stop', epoch }, 3000);
  await sleep(600);
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
): Promise<{ ok: boolean; error?: string; voice?: string; retryAfterMs?: number }> {
  const epoch = edgeEpoch;
  if (epoch !== edgeEpoch) return { ok: false, error: 'EDGE_STOPPED' };

  const cool = cooldownResult();
  if (cool) return { ok: false, error: 'EDGE_COOLDOWN', retryAfterMs: cool.retryAfterMs };

  let connect = await ensureEdgeConnected();
  if (!connect.ok) {
    if (connect.error === 'EDGE_COOLDOWN') {
      return { ok: false, error: 'EDGE_COOLDOWN', retryAfterMs: connect.retryAfterMs };
    }
    const rejected = connect.opened === false;
    void logSystemDebug('tts:edge-retry', { stage: 'connect', error: connect.error, rejected }, 'warn');
    if (rejected) {
      // handshake فشل: غالباً UA/حجب — أعد تثبيت القاعدة.
      await ensureEdgeUaRule(true).catch(() => {});
      await sleep(1500);
    } else {
      // handshake نجح ثم أُغلق: Edge يحدّ الاتصالات — انتظر أطول.
      await sleep(EDGE_RATE_RETRY_MS);
    }
    const retry = await resetEdgeConnection();
    if (!retry.ok) {
      if (retry.opened !== false) startEdgeCooldown('connect-retry');
      return { ok: false, error: retry.error || connect.error, retryAfterMs: retry.retryAfterMs };
    }
    connect = retry;
  }
  if (epoch !== edgeEpoch) return { ok: false, error: 'EDGE_STOPPED' };

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

  let res: any = await sendEngine(payload, 70_000);
  if (!res?.ok && isRetryableSpeakError(res?.error)) {
    const rejected = res?.opened === false;
    void logSystemDebug('tts:edge-retry', { stage: 'speak', error: res?.error, rejected, opened: res?.opened }, 'warn');
    if (rejected) {
      await ensureEdgeUaRule(true).catch(() => {});
      await sleep(1500);
    } else {
      await sleep(EDGE_RATE_RETRY_MS);
    }
    const retry = await resetEdgeConnection();
    if (!retry.ok) {
      if (retry.opened !== false) startEdgeCooldown('speak-reconnect');
      return { ok: false, error: retry.error || 'EDGE_CONNECT_FAILED', retryAfterMs: retry.retryAfterMs };
    }
    if (epoch !== edgeEpoch) return { ok: false, error: 'EDGE_STOPPED' };
    res = await sendEngine(payload, 70_000);
    if (!res?.ok && isRetryableSpeakError(res?.error)) {
      // فشل ثانٍ: لا محاولة ثالثة. أوقف الاتصالات دقيقة إن كان handshake قد نجح.
      if (res?.opened !== false) {
        startEdgeCooldown('speak-retry');
        return { ok: false, error: 'EDGE_SERVICE_UNAVAILABLE', retryAfterMs: EDGE_COOLDOWN_MS };
      }
    }
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
  await sendEngine({ type: 'edge-halt', epoch }, 3000);
}

export async function edgeStop(): Promise<void> {
  const epoch = ++edgeEpoch;
  await sendEngine({ type: 'edge-stop', epoch }, 3000);
}

export function edgePause(): void {
  void sendEngine({ type: 'edge-pause' }, 3000);
}

export function edgeResume(): void {
  void sendEngine({ type: 'edge-resume' }, 3000);
}

export function edgeSeek(time: number): void {
  void sendEngine({ type: 'edge-seek', time }, 3000);
}

export async function edgeState(): Promise<{
  open: boolean;
  playing: boolean;
  playbackId: string;
  currentTime: number;
  duration: number;
} | null> {
  const res = await sendEngine({ type: 'edge-state' }, 2500);
  if (!res?.ok) return null;
  return {
    open: Boolean(res.open),
    playing: Boolean(res.playing),
    playbackId: String(res.playbackId || ''),
    currentTime: Number(res.currentTime) || 0,
    duration: Number(res.duration) || 0,
  };
}

/** توليد/جمع MP3 كامل لرسالة صوتية (للتحميل) دون تشغيله. */
export async function edgeExport(
  items: Array<{ key: string; text: string }>,
  voice: string,
  rate: number,
): Promise<{ ok: boolean; base64?: string; error?: string; bytes?: number }> {
  const connect = await ensureEdgeConnected();
  if (!connect.ok) return { ok: false, error: connect.error };
  return sendEngine({ type: 'edge-export', items, voice, rate }, 180_000);
}
