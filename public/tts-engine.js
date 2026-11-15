// محرك Microsoft Edge Read Aloud داخل iframe في البانل (ليس offscreen API).
// - يستقبل WS URL من الـ SW بعد تثبيت UA عبر declarativeNetRequest.
// - يركّب SSML، يجمع MP3 + WordBoundary، يشغّل الصوت ويرسل أحداث الكلمات.
// - يسبق تجهيز الفقرتين التاليتين (prefetch) فيخزّنهما ويشغّلهما فوراً.
// - التشغيل الجديد يُسكت القديم فوراً (لا صوتان متداخلان)، مع إبقاء WS والكاش.
// - كل حدث يحمل playbackId حتى يتجاهل الـ SW أحداث التشغيلات القديمة.

(() => {
  'use strict';

  const TAG = '[BrowseMate][EdgeTTS]';
  const AUDIO_DELIM = new TextEncoder().encode('Path:audio\r\n');
  const DEFAULT_AR = 'ar-EG-ShakirNeural';
  const DEFAULT_EN = 'en-US-EmmaMultilingualNeural';
  const CACHE_MAX = 48;
  const SYNTH_TIMEOUT = 20_000;

  /** @type {WebSocket|null} */
  let ws = null;
  /** @type {HTMLAudioElement|null} */
  let audio = null;
  let blobUrl = null;
  /** @type {ReturnType<typeof setInterval>|null} */
  let timer = null;
  /** @type {{charIndex:number,length:number,word:string,start:number,end:number}[]} */
  let boundaries = [];
  let lastWordIndex = -1;
  let currentTabId = null;
  let currentText = '';
  let currentKey = '';
  let currentPlaybackId = '';
  let currentEpoch = 0;
  /** Port مباشر مع SW — لا chrome.offscreen ولا رسائل عامة */
  let enginePort = null;

  function postToSw(msg) {
    try { enginePort?.postMessage(msg); } catch {}
  }

  function engineLog(event, data) {
    postToSw({ type: 'edge-log', event, data });
  }

  function connectEnginePort() {
    try {
      enginePort = chrome.runtime.connect({ name: 'tts-engine' });
      enginePort.onMessage.addListener((msg) => {
        const respond = (res) => postToSw({ type: 'edge-result', id: msg?.id, res });
        handleEngineMessage(msg, respond);
      });
      enginePort.onDisconnect.addListener(() => {
        enginePort = null;
        setTimeout(connectEnginePort, 150);
      });
      postToSw({ type: 'engine-ready' });
    } catch {
      setTimeout(connectEnginePort, 500);
    }
  }
  /**
   * @type {null | {
   *   requestId:string, text:string, voice:string, rate:number, tabId:number|null,
   *   chunks:Uint8Array[], metadata:any[], resolve:(v:any)=>void, timeout:any,
   *   prefetch:boolean, key:string, playbackId:string
   * }}
   */
  let pending = null;
  /** تصدير صوت (تحميل) — لا يشغّل الصوت */
  let exporting = false;
  /** @type {{key:string,text:string,voice:string,rate:number,tabId:number|null}[]} */
  let prefetchQueue = [];
  /** @type {Map<string,{url:string,boundaries:any[],text:string,voice:string,rate:number}>} */
  const cache = new Map();

  function log(...args) {
    try { console.log(TAG, ...args); } catch {}
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // ===== cache =====
  function cacheGet(key) {
    if (!key) return null;
    const hit = cache.get(key);
    if (!hit) return null;
    // LRU: أعِد ترتيبه ليبقى الأحدث
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  function cacheSet(key, entry) {
    if (!key) return;
    const old = cache.get(key);
    if (old && old.url !== entry.url) {
      try { URL.revokeObjectURL(old.url); } catch {}
    }
    cache.set(key, entry);
    if (cache.size > CACHE_MAX) {
      for (const [k, v] of cache) {
        if (cache.size <= CACHE_MAX) break;
        if (k === currentKey || k === key) continue;
        cache.delete(k);
        try { URL.revokeObjectURL(v.url); } catch {}
      }
    }
  }

  function clearCache() {
    for (const v of cache.values()) {
      try { URL.revokeObjectURL(v.url); } catch {}
    }
    cache.clear();
  }

  function clearPrefetch() {
    prefetchQueue = [];
  }

  // ===== audio/timer =====
  function ensureAudio() {
    if (audio) return audio;
    audio = new Audio();
    audio.preload = 'auto';
    audio.style.display = 'none';
    audio.addEventListener('ended', () => {
      stopTimer();
      sendEvent('end', { duration: audio?.duration || 0 });
    });
    audio.addEventListener('error', () => {
      stopTimer();
      sendEvent('error', { error: 'AUDIO_ERROR' });
    });
    document.body.appendChild(audio);
    return audio;
  }

  function sendMessage(msg) {
    postToSw(msg);
  }

  function sendEvent(type, extra) {
    sendMessage({
      target: 'sw',
      type: 'edge-event',
      tabId: currentTabId,
      playbackId: currentPlaybackId,
      event: { action: 'tts-event', type, ...(extra || {}) },
    });
  }

  function sendWord(b) {
    sendEvent('word', { charIndex: b.charIndex, length: b.length, word: b.word });
  }

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function startTimer() {
    stopTimer();
    lastWordIndex = -1;
    let lastProgressAt = 0;
    timer = setInterval(() => {
      if (!audio || audio.paused) return;
      const t = audio.currentTime;
      let idx = -1;
      for (let i = 0; i < boundaries.length; i++) {
        if (boundaries[i].start <= t + 0.03) idx = i;
        else break;
      }
      if (idx !== lastWordIndex) {
        lastWordIndex = idx;
        if (idx >= 0) sendWord(boundaries[idx]);
      }
      if (Date.now() - lastProgressAt > 250) {
        lastProgressAt = Date.now();
        sendEvent('progress', { currentTime: t, duration: audio.duration || 0 });
      }
    }, 60);
  }

  function resetAudio() {
    stopTimer();
    if (audio) {
      try { audio.pause(); } catch {}
      try { audio.removeAttribute('src'); audio.load(); } catch {}
    }
    if (blobUrl) {
      try { URL.revokeObjectURL(blobUrl); } catch {}
      blobUrl = null;
    }
    boundaries = [];
    lastWordIndex = -1;
    currentKey = '';
  }

  // ===== SSML =====
  function escapeXml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function buildSSML(text, voice, rate) {
    const v = voice || (/[\u0600-\u06FF]/.test(text) ? DEFAULT_AR : DEFAULT_EN);
    const lang = v.split('-').slice(0, 2).join('-') || 'en-US';
    const pct = Math.round((Math.min(2, Math.max(0.5, Number(rate) || 1)) - 1) * 100);
    const rateStr = (pct >= 0 ? '+' : '') + pct + '%';
    return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${lang}"><voice name="${v}"><prosody pitch="+0Hz" rate="${rateStr}" volume="+0%">${escapeXml(text)}</prosody></voice></speak>`;
  }

  function speechConfig() {
    return (
      `X-Timestamp:${new Date().toUTCString()}\r\n` +
      'Content-Type:application/json; charset=utf-8\r\n' +
      'Path:speech.config\r\n\r\n' +
      JSON.stringify({
        context: {
          synthesis: {
            audio: {
              metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: true },
              outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
            },
          },
        },
      })
    );
  }

  // ===== message parsing =====
  function findNeedle(bytes, needle) {
    outer: for (let i = 0; i <= bytes.length - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) {
        if (bytes[i + j] !== needle[j]) continue outer;
      }
      return i;
    }
    return -1;
  }

  function decode(bytes) {
    try { return new TextDecoder().decode(bytes); } catch { return ''; }
  }

  function requestIdOf(header) {
    const m = /X-RequestId:(.*?)\r\n/.exec(header);
    return m ? m[1].trim() : '';
  }

  function handleText(data) {
    const text = String(data);
    const rid = requestIdOf(text);
    // تجاهل ردود turn قديم — لا تقتل الطلب الحالي
    if (pending && rid && rid !== pending.requestId) return;
    if (text.includes('Path:turn.end')) {
      finalize();
      return;
    }
    if (text.includes('Path:audio.metadata')) {
      const idx = text.indexOf('\r\n\r\n');
      if (idx < 0) return;
      try {
        const json = JSON.parse(text.slice(idx + 4));
        const items = Array.isArray(json.Metadata) ? json.Metadata : [];
        for (const item of items) {
          const d = item && item.Data ? item.Data : item;
          if (d && (d.text || d.Text) && pending) pending.metadata.push(d);
        }
      } catch {}
      return;
    }
    if (text.includes('Path:turn.start')) {
      if (pending) armTimeout(pending);
    }
  }

  function handleBinary(data) {
    const bytes = new Uint8Array(data);
    const at = findNeedle(bytes, AUDIO_DELIM);
    if (at < 0) return;
    const header = decode(bytes.subarray(0, at + AUDIO_DELIM.length));
    const rid = requestIdOf(header);
    if (pending && rid && rid !== pending.requestId) return;
    if (pending) pending.chunks.push(bytes.subarray(at + AUDIO_DELIM.length));
  }

  /**
   * مهلة كل طلب مرتبطة بكائن الطلب نفسه — وليس بالمتغير العام pending.
   * هذا يمنع مؤقت طلب قديم من قتل طلب جديد (السبب الجذري لبعض حالات الصمت).
   */
  function armTimeout(req) {
    if (!req) return;
    clearTimeout(req.timeout);
    const timeoutMs = Math.max(SYNTH_TIMEOUT, Math.min(60_000, String(req.text || '').length * 10));
    req.timeout = setTimeout(() => {
      if (pending !== req) return;
      pending = null;
      req.timeout = null;
      if (req.prefetch) {
        log('prefetch timeout');
        runPrefetch();
        return;
      }
      try { req.resolve({ ok: false, error: 'EDGE_TIMEOUT' }); } catch {}
      // اتصال ميت محتمل: أغلقه ليعيد الـ SW فتحه في المحاولة التالية
      resetSocket('EDGE_TIMEOUT');
    }, timeoutMs);
  }

  function buildBoundaries(text, metadata) {
    const out = [];
    let cursor = 0;
    for (const m of metadata) {
      const t = (m && m.text && m.text.Text) || (m && m.Text) || '';
      if (!t) continue;
      let idx = text.indexOf(t, cursor);
      if (idx < 0) idx = text.toLowerCase().indexOf(t.toLowerCase(), cursor);
      if (idx < 0) idx = cursor;
      const offset = Number(m.Offset) || 0;
      const duration = Number(m.Duration) || 0;
      out.push({
        charIndex: Math.max(0, idx),
        length: t.length,
        word: t,
        start: offset / 1e7,
        end: (offset + duration) / 1e7,
      });
      cursor = Math.min(text.length, idx + t.length);
    }
    out.sort((a, b) => a.start - b.start);
    return out;
  }

  function mergedAudio(chunks) {
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    return merged;
  }

  // ===== play/cache =====
  function buildPrefetchQueue(list, voice, rate, tabId, mainKey) {
    const seen = new Set();
    prefetchQueue = (Array.isArray(list) ? list : [])
      .filter((j) => j && j.key && j.text && j.key !== mainKey && !cache.has(j.key) && !seen.has(j.key) && seen.add(j.key))
      .map((j) => ({ key: String(j.key), text: String(j.text), voice, rate, tabId }));
  }

  function playEntry(req, entry, owned) {
    resetAudio();
    currentKey = req.key;
    currentText = entry.text;
    currentTabId = req.tabId;
    currentPlaybackId = req.playbackId || '';
    boundaries = entry.boundaries;
    if (owned) blobUrl = entry.url;
    const player = ensureAudio();
    player.src = entry.url;
    player.playbackRate = 1;
    player
      .play()
      .then(() => {
        sendEvent('start', { duration: player.duration || 0 });
        startTimer();
        try {
          req.resolve({
            ok: true,
            bytes: entry.bytes ? entry.bytes.length : 0,
            words: boundaries.length,
            voice: req.voice || '',
            cached: !owned,
            playbackId: currentPlaybackId,
          });
        } catch {}
        runPrefetch();
      })
      .catch((e) => {
        stopTimer();
        try { req.resolve({ ok: false, error: 'EDGE_PLAY_FAILED: ' + (e && e.message ? e.message : e) }); } catch {}
        sendEvent('error', { error: 'EDGE_PLAY_FAILED' });
        clearPrefetch();
      });
  }

  // ===== synthesis =====
  function sendSynthesis(job) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      if (job.prefetch) return;
      try { job.resolve({ ok: false, error: 'EDGE_NO_WS' }); } catch {}
      return;
    }
    const req = {
      requestId: uuid(),
      text: job.text,
      voice: job.voice,
      rate: job.rate,
      tabId: job.tabId,
      chunks: [],
      metadata: [],
      resolve: job.resolve,
      timeout: null,
      prefetch: Boolean(job.prefetch),
      export: Boolean(job.export),
      key: job.key || '',
      playbackId: job.playbackId || '',
    };
    pending = req;
    armTimeout(req);
    try {
      ws.send(speechConfig());
      ws.send(
        `X-RequestId:${req.requestId}\r\n` +
          'Content-Type:application/ssml+xml\r\n' +
          `X-Timestamp:${new Date().toUTCString()}\r\n` +
          'Path:ssml\r\n\r\n' +
          buildSSML(job.text, job.voice, job.rate),
      );
      log(job.prefetch ? 'prefetch' : 'synth', req.requestId, job.text.slice(0, 45));
    } catch (e) {
      if (pending === req) pending = null;
      clearTimeout(req.timeout);
      if (req.prefetch) {
        log('prefetch send failed', e);
      } else {
        try { req.resolve({ ok: false, error: 'EDGE_SEND_FAILED: ' + (e && e.message ? e.message : e) }); } catch {}
        resetSocket('EDGE_SEND_FAILED');
      }
    }
  }

  function startMain(req) {
    buildPrefetchQueue(req.prefetch, req.voice, req.rate, req.tabId, req.key);
    sendSynthesis({ ...req, prefetch: false });
  }

  function runPrefetch() {
    if (pending || !ws || ws.readyState !== WebSocket.OPEN) return;
    while (prefetchQueue.length && cache.has(prefetchQueue[0].key)) prefetchQueue.shift();
    const job = prefetchQueue.shift();
    if (!job) return;
    sendSynthesis({ ...job, prefetch: true, resolve: () => {}, playbackId: '' });
  }

  function finalize() {
    if (!pending) return;
    const req = pending;
    pending = null;
    clearTimeout(req.timeout);
    req.timeout = null;

    if (!req.chunks.length) {
      if (req.prefetch) {
        log('prefetch empty');
        runPrefetch();
      } else {
        try { req.resolve({ ok: false, error: 'EDGE_NO_AUDIO' }); } catch {}
        clearPrefetch();
      }
      return;
    }

    const merged = mergedAudio(req.chunks);
    const blob = new Blob([merged], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    const bounds = buildBoundaries(req.text, req.metadata);

    if (req.prefetch) {
      cacheSet(req.key, { url, boundaries: bounds, text: req.text, voice: req.voice, rate: req.rate, bytes: merged });
      log('prefetched', req.key.slice(0, 40), 'words', bounds.length);
      runPrefetch();
      return;
    }

    // تصدير للتحميل: خزّن الصوت ولا تشغّله
    if (req.export) {
      cacheSet(req.key, { url, boundaries: bounds, text: req.text, voice: req.voice, rate: req.rate, bytes: merged });
      try { req.resolve({ ok: true, bytes: merged.length }); } catch {}
      return;
    }

    // خزّن الصوت الرئيسي أيضاً إن كان له مفتاح، ليصبح التحميل/الإعادة فورياً
    const cacheEntry = { url, boundaries: bounds, text: req.text, voice: req.voice, rate: req.rate, bytes: merged };
    if (req.key) {
      cacheSet(req.key, cacheEntry);
      playEntry(req, cacheEntry, false);
    } else {
      playEntry(req, cacheEntry, true);
    }
  }



  // ===== export (download) =====
  function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function synthChunk(item, voice, rate) {
    return new Promise((resolve) => {
      sendSynthesis({
        text: item.text,
        voice,
        rate,
        tabId: null,
        key: item.key,
        playbackId: 'export',
        prefetch: false,
        export: true,
        resolve,
      });
    });
  }

  async function exportAudio(items, voice, rate, sendResponse) {
    if (exporting) {
      sendResponse({ ok: false, error: 'EXPORT_BUSY' });
      return;
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      sendResponse({ ok: false, error: 'EDGE_NO_WS' });
      return;
    }
    exporting = true;
    log('export start', items.length);
    try {
      const parts = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        let entry = cacheGet(item.key);
        if (!entry || !entry.bytes) {
          log('export synth', i, item.text.slice(0, 30));
          const r = await synthChunk(item, voice, rate);
          if (!r || !r.ok) throw new Error(r?.error || 'EDGE_EXPORT_CHUNK_FAILED');
          entry = cacheGet(item.key);
        }
        if (!entry || !entry.bytes) throw new Error('EDGE_EXPORT_CACHE_MISS');
        parts.push(entry.bytes);
        log('export part', i, entry.bytes.length);
        // فاصل صغير يقلل rate-limit من Edge عند التصدير المتتابع
        if (i + 1 < items.length) await new Promise((r) => setTimeout(r, 120));
      }
      const merged = mergedAudio(parts);
      if (!merged.length) throw new Error('EDGE_EXPORT_EMPTY');
      const base64 = bytesToBase64(merged);
      log('export done', merged.length, base64.length);
      sendResponse({ ok: true, base64, mime: 'audio/mpeg', bytes: merged.length });
    } catch (e) {
      log('export failed', e && e.message ? e.message : String(e));
      sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
    } finally {
      exporting = false;
    }
  }

  // ===== public ops =====
  /** إسكات فوري + إبطال أي طلب جارٍ.
   *  hard=true (من edge-halt/stop) يغلق WS إن كان هناك turn نشط حتى لا يختلط
   *  turn ملغى مع turn جديد. الكاش يبقى. */
  function haltAudio(hard = false) {
    const wasBusy = Boolean(pending) || Boolean(audio && !audio.paused);
    clearPrefetch();
    if (pending) {
      const p = pending;
      pending = null;
      clearTimeout(p.timeout);
      p.timeout = null;
      if (!p.prefetch) {
        try { p.resolve({ ok: false, error: 'EDGE_REPLACED' }); } catch {}
      }
    }
    if (audio && !audio.paused) sendEvent('interrupted');
    resetAudio();
    if (hard && wasBusy && ws) {
      const old = ws;
      ws = null;
      try {
        old.onopen = null;
        old.onmessage = null;
        old.onerror = null;
        old.onclose = null;
        old.close();
      } catch {}
    }
    currentPlaybackId = '';
    currentTabId = null;
  }

  function resetSocket(error) {
    clearPrefetch();
    if (pending) {
      const p = pending;
      pending = null;
      clearTimeout(p.timeout);
      p.timeout = null;
      if (!p.prefetch) {
        try { p.resolve({ ok: false, error: error || 'EDGE_WS_CLOSED' }); } catch {}
      }
    }
    if (audio && !audio.paused) sendEvent('error', { error: error || 'EDGE_WS_CLOSED' });
    if (ws) {
      const old = ws;
      ws = null;
      try {
        old.onopen = null;
        old.onmessage = null;
        old.onerror = null;
        old.onclose = null;
        old.close();
      } catch {}
    }
    resetAudio();
    currentPlaybackId = '';
    currentTabId = null;
  }

  function speak(msg, sendResponse) {
    const req = {
      text: String(msg.text || ''),
      voice: String(msg.voice || ''),
      rate: Number(msg.rate) || 1,
      tabId: msg.tabId == null ? null : Number(msg.tabId),
      key: String(msg.key || ''),
      prefetch: Array.isArray(msg.prefetch) ? msg.prefetch : [],
      playbackId: String(msg.playbackId || ''),
      resolve: sendResponse,
    };
    if (!req.text.trim()) {
      sendResponse({ ok: false, error: 'EMPTY_TEXT' });
      return;
    }

    // طلب قديم وصل بعد halt/stop جديد: لا تشغّله
    const epoch = Number(msg.epoch) || 0;
    if (epoch && currentEpoch && epoch < currentEpoch) {
      sendResponse({ ok: false, error: 'EDGE_STOPPED' });
      return;
    }
    if (epoch) currentEpoch = Math.max(currentEpoch, epoch);

    // أي تشغيل جديد يوقف الصوت السابق فوراً — حتى أثناء التركيب.
    // الإغلاق الفعلي للـ WS يحدث في edge-halt (hard) قبل وصول الطلب الجديد.
    haltAudio(false);
    currentPlaybackId = req.playbackId;
    currentTabId = req.tabId;

    const cached = cacheGet(req.key);
    if (cached) {
      log('cached play', req.key.slice(0, 40));
      buildPrefetchQueue(req.prefetch, req.voice, req.rate, req.tabId, req.key);
      playEntry(req, cached, false);
      return;
    }
    startMain(req);
  }

  function connect(msg, sendResponse) {
    const url = String(msg.wsUrl || '');
    if (!url) { sendResponse({ ok: false, error: 'NO_WS_URL' }); return; }
    if (ws && ws.readyState === WebSocket.OPEN) {
      sendResponse({ ok: true, reused: true });
      return;
    }
    if (ws) {
      const old = ws;
      ws = null;
      try {
        old.onopen = null;
        old.onmessage = null;
        old.onerror = null;
        old.onclose = null;
        old.close();
      } catch {}
    }
    const socket = new WebSocket(url);
    ws = socket;
    socket.binaryType = 'arraybuffer';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch {}
      sendResponse({ ok: false, error: 'EDGE_WS_TIMEOUT' });
    }, 12000);

    socket.onopen = () => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      log('ws open');
      sendResponse({ ok: true });
    };
    socket.onmessage = (ev) => {
      if (ws !== socket) return;
      if (typeof ev.data === 'string') handleText(ev.data);
      else handleBinary(ev.data);
    };
    socket.onerror = () => {
      if (ws !== socket) return;
      engineLog('ws-error', { online: typeof navigator !== 'undefined' ? navigator.onLine : null });
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        sendResponse({ ok: false, error: 'EDGE_WS_ERROR' });
      }
      resetSocket('EDGE_WS_ERROR');
    };
    socket.onclose = (e) => {
      if (ws !== socket) return;
      ws = null;
      engineLog('ws-close', {
        code: Number(e?.code) || 0,
        reason: String(e?.reason || '').slice(0, 200),
        online: typeof navigator !== 'undefined' ? navigator.onLine : null,
      });
      const err = `EDGE_WS_CLOSED:${Number(e?.code) || 0}`;
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        sendResponse({ ok: false, error: err });
      }
      resetSocket(err);
    };
  }

  function stopAudio() {
    haltAudio();
    clearCache();
    resetSocket('EDGE_STOPPED');
  }

  function handleEngineMessage(msg, sendResponse) {
    if (!msg) return;
    switch (msg.type) {
      case 'edge-connect':
        connect(msg, sendResponse);
        return true;
      case 'edge-speak':
        speak(msg, sendResponse);
        return true;
      case 'edge-state':
        sendResponse({
          ok: true,
          open: Boolean(ws && ws.readyState === WebSocket.OPEN),
          playing: Boolean(audio && !audio.paused),
          playbackId: currentPlaybackId,
          currentTime: Number(audio?.currentTime) || 0,
          duration: Number(audio?.duration) || 0,
          words: boundaries.length,
          cached: cache.size,
          prefetch: prefetchQueue.length,
        });
        return true;
      case 'edge-halt':
        currentEpoch = Math.max(currentEpoch, Number(msg.epoch) || 0);
        haltAudio(true);
        sendResponse({ ok: true });
        return true;
      case 'edge-reset':
        currentEpoch = Math.max(currentEpoch, Number(msg.epoch) || 0);
        resetSocket('EDGE_RESET');
        sendResponse({ ok: true });
        return true;
      case 'edge-stop':
        currentEpoch = Math.max(currentEpoch, Number(msg.epoch) || 0);
        stopAudio();
        sendResponse({ ok: true });
        return true;
      case 'edge-pause':
        if (audio) {
          try { audio.pause(); } catch {}
          sendEvent('paused');
        }
        sendResponse({ ok: true });
        return true;
      case 'edge-resume':
        if (audio) {
          audio.play().then(() => {
            startTimer();
            sendEvent('resumed');
          }).catch(() => {});
        }
        sendResponse({ ok: true });
        return true;
      case 'edge-seek':
        if (audio) {
          const raw = Number(msg.time);
          const max = Number.isFinite(audio.duration) ? audio.duration : 0;
          const t = Math.max(0, Math.min(Number.isFinite(raw) ? raw : 0, max || 0));
          try { audio.currentTime = t; } catch {}
          lastWordIndex = -1;
          sendEvent('progress', { currentTime: audio.currentTime || t, duration: max });
          if (!audio.paused) startTimer();
        }
        sendResponse({ ok: true });
        return true;
      case 'edge-export':
        void exportAudio(Array.isArray(msg.items) ? msg.items : [], String(msg.voice || ''), Number(msg.rate) || 1, sendResponse);
        return true;
      case 'edge-ping':
        sendResponse({ ok: true, tag: TAG });
        return true;
      default:
        return;
    }
  }

  connectEnginePort();
  log('edge engine ready');
})();
