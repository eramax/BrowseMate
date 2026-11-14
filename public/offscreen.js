// محرك Microsoft Edge Read Aloud داخل offscreen document مخفي.
// - يستقبل WS URL من الـ SW بعد تمويه UA.
// - يركّب SSML، يجمع MP3 + WordBoundary، يشغّل الصوت ويرسل أحداث الكلمات.
// - يسبق تجهيز الفقرتين التاليتين (prefetch) فيخزّنهما ويشغّلهما فوراً لتقليل التأخير.

(() => {
  'use strict';

  const TAG = '[BrowseMate][EdgeTTS]';
  const AUDIO_DELIM = new TextEncoder().encode('Path:audio\r\n');
  const DEFAULT_AR = 'ar-EG-ShakirNeural';
  const DEFAULT_EN = 'en-US-EmmaMultilingualNeural';
  const CACHE_MAX = 8;

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
  /** @type {null | {requestId:string,text:string,voice:string,rate:number,tabId:number|null,chunks:Uint8Array[],metadata:any[],resolve:(v:any)=>void,timeout:any,prefetch:boolean,key:string}} */
  let pending = null;
  /** طلب تشغيل رئيسي ينتظر انتهاء التركيب الحالي */
  /** @type {null | {text:string,voice:string,rate:number,tabId:number|null,key:string,prefetch:any[],resolve:(v:any)=>void}} */
  let nextRequest = null;
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
    return key ? cache.get(key) || null : null;
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

  function failQueued(error) {
    if (!nextRequest) return;
    const n = nextRequest;
    nextRequest = null;
    try { n.resolve({ ok: false, error }); } catch {}
  }

  // ===== audio/timer =====
  function ensureAudio() {
    if (audio) return audio;
    audio = new Audio();
    audio.preload = 'auto';
    audio.style.display = 'none';
    audio.addEventListener('ended', () => {
      stopTimer();
      sendEvent('end');
      maybeStartNext();
    });
    audio.addEventListener('error', () => {
      stopTimer();
      sendEvent('error', { error: 'AUDIO_ERROR' });
    });
    document.body.appendChild(audio);
    return audio;
  }

  function sendMessage(msg) {
    try {
      const p = chrome.runtime.sendMessage(msg);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {}
  }

  function sendEvent(type, extra) {
    // tabId قد يكون null عند قراءة نص حر من البانل بدون صفحة
    sendMessage({
      target: 'sw',
      type: 'edge-event',
      tabId: currentTabId,
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
          if (d && (d.text || d.Text)) pending && pending.metadata.push(d);
        }
      } catch {}
      return;
    }
    if (text.includes('Path:turn.start')) {
      if (pending) resetTimeout();
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

  function resetTimeout() {
    if (!pending) return;
    clearTimeout(pending.timeout);
    pending.timeout = setTimeout(() => {
      const p = pending;
      pending = null;
      if (p.prefetch) {
        log('prefetch timeout');
      } else {
        try { p.resolve({ ok: false, error: 'EDGE_TIMEOUT' }); } catch {}
        failQueued('EDGE_TIMEOUT');
      }
      runPrefetch();
    }, 25000);
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

  function maybeStartNext() {
    if (!nextRequest || pending) return;
    if (audio && !audio.paused) return;
    const n = nextRequest;
    nextRequest = null;
    startMain(n);
  }

  function playEntry(req, entry, owned) {
    resetAudio();
    currentKey = req.key;
    currentText = entry.text;
    currentTabId = req.tabId;
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
        try { req.resolve({ ok: true, bytes: entry.bytes || 0, words: boundaries.length, voice: req.voice || '', cached: !owned }); } catch {}
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
      failQueued('EDGE_NO_WS');
      return;
    }
    pending = {
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
      key: job.key || '',
    };
    resetTimeout();
    try {
      ws.send(speechConfig());
      const rid = pending.requestId;
      ws.send(
        `X-RequestId:${rid}\r\n` +
          'Content-Type:application/ssml+xml\r\n' +
          `X-Timestamp:${new Date().toUTCString()}\r\n` +
          'Path:ssml\r\n\r\n' +
          buildSSML(job.text, job.voice, job.rate),
      );
      log(job.prefetch ? 'prefetch' : 'synth', rid, job.text.slice(0, 45));
    } catch (e) {
      const p = pending;
      pending = null;
      if (p.prefetch) {
        log('prefetch send failed', e);
      } else {
        try { p.resolve({ ok: false, error: 'EDGE_SEND_FAILED: ' + (e && e.message ? e.message : e) }); } catch {}
        failQueued('EDGE_SEND_FAILED');
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
    sendSynthesis({ ...job, prefetch: true, resolve: () => {} });
  }

  function finalize() {
    if (!pending) return;
    const req = pending;
    pending = null;
    clearTimeout(req.timeout);

    if (!req.chunks.length) {
      if (req.prefetch) {
        log('prefetch empty');
        runPrefetch();
      } else {
        try { req.resolve({ ok: false, error: 'EDGE_NO_AUDIO' }); } catch {}
        failQueued('EDGE_NO_AUDIO');
        clearPrefetch();
      }
      return;
    }

    const merged = mergedAudio(req.chunks);
    const blob = new Blob([merged], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    const bounds = buildBoundaries(req.text, req.metadata);

    if (req.prefetch) {
      cacheSet(req.key, { url, boundaries: bounds, text: req.text, voice: req.voice, rate: req.rate });
      log('prefetched', req.key.slice(0, 40), 'words', bounds.length);
      maybeStartNext();
      runPrefetch();
      return;
    }

    playEntry(
      req,
      { url, boundaries: bounds, text: req.text, bytes: blob.size },
      true,
    );
  }

  // ===== public ops =====
  function speak(msg, sendResponse) {
    const req = {
      text: String(msg.text || ''),
      voice: String(msg.voice || ''),
      rate: Number(msg.rate) || 1,
      tabId: msg.tabId == null ? null : Number(msg.tabId),
      key: String(msg.key || ''),
      prefetch: Array.isArray(msg.prefetch) ? msg.prefetch : [],
      resolve: sendResponse,
    };
    if (!req.text.trim()) {
      sendResponse({ ok: false, error: 'EMPTY_TEXT' });
      return;
    }
    const cached = cacheGet(req.key);
    // إذا كان الجاري prefetch فقط والصوت المطلوب جاهز، شغّله فوراً دون انتظار الـ prefetch
    if (cached && (!pending || pending.prefetch)) {
      log('cached play', req.key.slice(0, 40));
      failQueued('EDGE_REPLACED');
      buildPrefetchQueue(req.prefetch, req.voice, req.rate, req.tabId, req.key);
      playEntry(req, cached, false);
      return;
    }
    if (pending) {
      failQueued('EDGE_REPLACED');
      nextRequest = req;
      return;
    }
    failQueued('EDGE_REPLACED');
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
    try { if (ws) ws.close(); } catch {}
    const socket = new WebSocket(url);
    ws = socket;
    socket.binaryType = 'arraybuffer';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch {}
      sendResponse({ ok: false, error: 'EDGE_WS_TIMEOUT' });
    }, 10000);

    socket.onopen = () => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      log('ws open');
      sendResponse({ ok: true });
    };
    socket.onmessage = (ev) => {
      if (typeof ev.data === 'string') handleText(ev.data);
      else handleBinary(ev.data);
    };
    socket.onerror = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        sendResponse({ ok: false, error: 'EDGE_WS_ERROR' });
      }
      if (pending) {
        const p = pending;
        pending = null;
        clearTimeout(p.timeout);
        if (!p.prefetch) {
          try { p.resolve({ ok: false, error: 'EDGE_WS_ERROR' }); } catch {}
        }
      }
      failQueued('EDGE_WS_ERROR');
      clearPrefetch();
    };
    socket.onclose = () => {
      ws = null;
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        sendResponse({ ok: false, error: 'EDGE_WS_CLOSED' });
      }
      if (pending) {
        const p = pending;
        pending = null;
        clearTimeout(p.timeout);
        if (!p.prefetch) {
          try { p.resolve({ ok: false, error: 'EDGE_WS_CLOSED' }); } catch {}
        }
      }
      failQueued('EDGE_WS_CLOSED');
      clearPrefetch();
    };
  }

  function stopAudio() {
    failQueued('EDGE_STOPPED');
    clearPrefetch();
    if (pending) {
      const p = pending;
      pending = null;
      clearTimeout(p.timeout);
      if (!p.prefetch) {
        try { p.resolve({ ok: false, error: 'EDGE_STOPPED' }); } catch {}
      }
    }
    resetAudio();
    clearCache();
    // أغلق الاتصال لإنهاء أي turn جارٍ قبل قراءة جديدة (يمنع تداخل SSML)
    if (ws) {
      try {
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.close();
      } catch {}
      ws = null;
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.target !== 'offscreen') return;
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
          words: boundaries.length,
          cached: cache.size,
          prefetch: prefetchQueue.length,
        });
        return true;
      case 'edge-stop':
        stopAudio();
        sendResponse({ ok: true });
        return true;
      case 'edge-pause':
        if (audio) { try { audio.pause(); } catch {} }
        sendResponse({ ok: true });
        return true;
      case 'edge-resume':
        if (audio) {
          audio.play().then(() => startTimer()).catch(() => {});
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
      case 'edge-ping':
        sendResponse({ ok: true, tag: TAG });
        return true;
      default:
        return;
    }
  });

  log('offscreen ready');
})();
