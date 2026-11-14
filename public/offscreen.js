// محرك Microsoft Edge Read Aloud داخل offscreen document مخفي.
// يستقبل WS URL من الـ SW (بعد تمويه User-Agent)، يركّب SSML، يجمع MP3 + WordBoundary،
// يشغّل الصوت ويرسل أحداث الكلمات إلى الـ SW ثم إلى content script.
(() => {
  'use strict';

  const TAG = '[BrowseMate][EdgeTTS]';
  const AUDIO_DELIM = new TextEncoder().encode('Path:audio\r\n');
  const DEFAULT_AR = 'ar-EG-SalmaNeural';
  const DEFAULT_EN = 'en-US-EmmaMultilingualNeural';

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
  /** @type {null | {requestId:string,text:string,voice:string,rate:number,tabId:number|null,chunks:Uint8Array[],metadata:any[],resolve:(v:any)=>void,timeout:any}} */
  let pending = null;
  /** @type {null | {text:string,voice:string,rate:number,tabId:number|null,resolve:(v:any)=>void}} */
  let nextRequest = null;

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

  function ensureAudio() {
    if (audio) return audio;
    audio = new Audio();
    audio.preload = 'auto';
    audio.style.display = 'none';
    audio.addEventListener('ended', () => {
      stopTimer();
      sendEvent('end');
      if (nextRequest) {
        const n = nextRequest;
        nextRequest = null;
        setTimeout(() => startRequest(n), 200);
      }
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
    if (currentTabId == null) return;
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

  function failQueued(error) {
    if (!nextRequest) return;
    const n = nextRequest;
    nextRequest = null;
    try { n.resolve({ ok: false, error }); } catch {}
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
  }

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
      try { p.resolve({ ok: false, error: 'EDGE_TIMEOUT' }); } catch {}
      failQueued('EDGE_TIMEOUT');
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

  function finalize() {
    if (!pending) return;
    const req = pending;
    pending = null;
    clearTimeout(req.timeout);
    if (!req.chunks.length) {
      try { req.resolve({ ok: false, error: 'EDGE_NO_AUDIO' }); } catch {}
      failQueued('EDGE_NO_AUDIO');
      return;
    }

    const total = req.chunks.reduce((n, c) => n + c.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of req.chunks) {
      merged.set(c, offset);
      offset += c.length;
    }

    const blob = new Blob([merged], { type: 'audio/mpeg' });
    if (blobUrl) { try { URL.revokeObjectURL(blobUrl); } catch {} }
    blobUrl = URL.createObjectURL(blob);
    boundaries = buildBoundaries(req.text, req.metadata);
    currentText = req.text;
    currentTabId = req.tabId;

    const player = ensureAudio();
    player.src = blobUrl;
    player.playbackRate = 1;
    player
      .play()
      .then(() => {
        sendEvent('start');
        startTimer();
        try { req.resolve({ ok: true, bytes: blob.size, words: boundaries.length, voice: req.voice || '' }); } catch {}
      })
      .catch((e) => {
        stopTimer();
        try { req.resolve({ ok: false, error: 'EDGE_PLAY_FAILED: ' + (e && e.message ? e.message : e) }); } catch {}
        failQueued('EDGE_PLAY_FAILED');
        sendEvent('error', { error: 'EDGE_PLAY_FAILED' });
      });
  }

  function startRequest(req) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      try { req.resolve({ ok: false, error: 'EDGE_NO_WS' }); } catch {}
      failQueued('EDGE_NO_WS');
      return;
    }
    resetAudio();
    pending = {
      requestId: uuid(),
      text: req.text,
      voice: req.voice,
      rate: req.rate,
      tabId: req.tabId,
      chunks: [],
      metadata: [],
      resolve: req.resolve,
      timeout: null,
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
          buildSSML(req.text, req.voice, req.rate),
      );
      log('synth', rid, req.text.slice(0, 50));
    } catch (e) {
      const p = pending;
      pending = null;
      try { p.resolve({ ok: false, error: 'EDGE_SEND_FAILED: ' + (e && e.message ? e.message : e) }); } catch {}
      failQueued('EDGE_SEND_FAILED');
    }
  }

  function speak(msg, sendResponse) {
    const req = {
      text: String(msg.text || ''),
      voice: String(msg.voice || ''),
      rate: Number(msg.rate) || 1,
      tabId: msg.tabId == null ? null : Number(msg.tabId),
      resolve: sendResponse,
    };
    if (!req.text.trim()) {
      sendResponse({ ok: false, error: 'EMPTY_TEXT' });
      return;
    }
    if (pending) {
      failQueued('EDGE_REPLACED');
      nextRequest = req;
      return;
    }
    // طلب أحدث يتفوق على أي طلب كان في الانتظار
    failQueued('EDGE_REPLACED');
    startRequest(req);
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
        try { p.resolve({ ok: false, error: 'EDGE_WS_ERROR' }); } catch {}
      }
      failQueued('EDGE_WS_ERROR');
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
        try { p.resolve({ ok: false, error: 'EDGE_WS_CLOSED' }); } catch {}
      }
      failQueued('EDGE_WS_CLOSED');
    };
  }

  function stopAudio() {
    failQueued('EDGE_STOPPED');
    if (pending) {
      const p = pending;
      pending = null;
      clearTimeout(p.timeout);
      try { p.resolve({ ok: false, error: 'EDGE_STOPPED' }); } catch {}
    }
    resetAudio();
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
      case 'edge-ping':
        sendResponse({ ok: true, tag: TAG });
        return true;
      default:
        return;
    }
  });

  log('offscreen ready');
})();
