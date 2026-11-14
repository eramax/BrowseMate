// منسّق القارئ داخل الصفحة: يستقبل اختيار الوكيل من page_outline/read_aloud
// يشغّل chrome.tts عبر الـ SW، ويُظهر أزرار التحكم داخل الصفحة (مقتبسة من Nova TTS).

import { getOutline, resolveRead } from './extractor';
import type { ReaderBlock } from './extractor';
import { ReaderHighlighter } from './range-highlighter';
import { ReaderOverlay } from './overlay';
import { TtsPlayer } from './player';
import { clearPageHighlights, highlightInPage } from './pointer';

const highlighter = new ReaderHighlighter();
const overlay = new ReaderOverlay();
const player = new TtsPlayer();

let blocks: ReaderBlock[] = [];
let currentPara = 0;
let isActive = false;
let ready = false;
let edgeVoice = '';
let browserVoice = '';
const DEFAULT_EDGE_AR = 'ar-EG-SalmaNeural';
const DEFAULT_EDGE_EN = 'en-US-EmmaMultilingualNeural';

function notify(message: string): void {
  try { console.info('[BrowseMate Reader]', message); } catch { /* ignore */ }
}

function stopReading(): void {
  player.stop();
  highlighter.clearAll();
  overlay.setPlaying(false);
  overlay.hide();
  isActive = false;
  blocks = [];
  currentPara = 0;
}

function readParagraph(index: number): void {
  if (!isActive || index < 0 || index >= blocks.length) {
    stopReading();
    return;
  }
  currentPara = index;
  const block = blocks[index];
  if (!block) { stopReading(); return; }
  highlighter.clearWord();
  if (block.element?.isConnected) {
    highlighter.highlightParagraph(block.element, block.text);
  } else {
    highlighter.clearAll();
  }
  overlay.setParaInfo(index, blocks.length);
  player.speak(block.text, index);
}

function startReading(
  items: ReaderBlock[],
  options: { rate?: number; voice?: string; engine?: 'edge' | 'browser' } = {},
): {
  count: number;
  total: number;
  first: string;
  voice: string;
  rate: number;
  engine: 'edge' | 'browser';
} {
  const usable = items.filter((b) => Boolean(b.text?.trim()));
  if (!usable.length) return { count: 0, total: 0, first: '', voice: '', rate: 1, engine: 'edge' };

  player.stop();
  highlighter.clearAll();
  blocks = usable;
  currentPara = 0;
  isActive = true;

  if (options.rate != null) {
    player.setSettings({ rate: options.rate });
    overlay.setSpeed(options.rate);
    try { chrome.storage.local.set({ rate: options.rate }); } catch { /* ignore */ }
  }
  const engine: 'edge' | 'browser' = options.engine ?? player.getSettings().engine;
  if (options.engine) {
    player.setSettings({ engine: options.engine });
    try { chrome.storage.local.set({ engine: options.engine }); } catch { /* ignore */ }
  }

  if (options.voice) {
    player.setSettings({ voice: options.voice });
    if (engine === 'edge') {
      edgeVoice = options.voice;
      try { chrome.storage.local.set({ edgeVoice: options.voice }); } catch { /* ignore */ }
    } else {
      browserVoice = options.voice;
      try { chrome.storage.local.set({ browserVoice: options.voice }); } catch { /* ignore */ }
    }
  } else if (engine === 'edge') {
    // اختيار تلقائي حسب لغة النص — يمنع قراءة العربية بصوت إنجليزي محفوظ
    const sample = usable.slice(0, 4).map((b) => b.text).join(' ').slice(0, 6000);
    const arCount = (sample.match(/[\u0600-\u06FF]/g) || []).length;
    const enCount = (sample.match(/[A-Za-z]/g) || []).length;
    const docLang = (document.documentElement.lang || '').toLowerCase();
    const isArabic = arCount > enCount || (arCount > 0 && docLang.startsWith('ar'));
    const wantedPrefix = isArabic ? 'ar-' : 'en-';
    const fallback = isArabic ? DEFAULT_EDGE_AR : DEFAULT_EDGE_EN;
    const saved = edgeVoice && edgeVoice.toLowerCase().startsWith(wantedPrefix) ? edgeVoice : fallback;
    player.setSettings({ voice: saved });
  } else if (options.engine) {
    player.setSettings({ voice: browserVoice });
  }

  overlay.show();
  overlay.setPlaying(true);
  overlay.setParaInfo(0, blocks.length);
  readParagraph(0);
  return {
    count: blocks.length,
    total: blocks.length,
    first: blocks[0].text.slice(0, 120),
    voice: player.getSettings().voice,
    rate: player.getSettings().rate,
    engine: player.getSettings().engine,
  };
}

function togglePlayPause(): void {
  const state = player.getState();
  if (state === 'speaking') {
    player.pause();
    overlay.setPlaying(false);
  } else if (state === 'paused') {
    player.resume();
    overlay.setPlaying(true);
  } else if (isActive && blocks.length) {
    readParagraph(currentPara);
  }
}

/** تحميل إعدادات القارئ (سرعة/صوت/ألوان) من تخزين الإضافة */
function loadSettings(): void {
  try {
    chrome.storage.local.get(
      {
        rate: 1,
        voice: '',
        edgeVoice: '',
        browserVoice: '',
        engine: 'edge',
        paraColor: '#ffc107',
        wordColor: '#00bcd4',
      },
      (data) => {
        const rate = Number(data?.rate);
        if (Number.isFinite(rate) && rate >= 0.5 && rate <= 2) {
          player.setSettings({ rate });
          overlay.setSpeed(rate);
        }
        const oldVoice = typeof data?.voice === 'string' ? data.voice : '';
        edgeVoice = typeof data?.edgeVoice === 'string' && data.edgeVoice
          ? data.edgeVoice
          : /Neural$/i.test(oldVoice) ? oldVoice : '';
        browserVoice = typeof data?.browserVoice === 'string' && data.browserVoice
          ? data.browserVoice
          : oldVoice && !/Neural$/i.test(oldVoice) ? oldVoice : '';
        const engine = data?.engine === 'browser' ? 'browser' : 'edge';
        player.setSettings({ engine });
        const savedVoice = engine === 'edge' ? edgeVoice : browserVoice;
        if (savedVoice) player.setSettings({ voice: savedVoice });
        highlighter.setColors({
          ...(typeof data?.paraColor === 'string' ? { paragraph: data.paraColor } : {}),
          ...(typeof data?.wordColor === 'string' ? { word: data.wordColor } : {}),
        });
        ready = true;
        notify('settings loaded');
      },
    );
  } catch {
    ready = true;
  }
}

// ===== ربط الأحداث =====
player.onBoundary = (charIndex, _length, word) => highlighter.highlightWord(word, charIndex);
player.onEnd = () => {
  highlighter.clearWord();
  if (isActive && currentPara < blocks.length - 1) readParagraph(currentPara + 1);
  else stopReading();
};
player.onStateChange = (state) => overlay.setPlaying(state === 'speaking');
player.onError = (message) => {
  // لا نخفي الفقرة المظللة إذا فشل الصوت — نترك الأزرار حتى يستطيع المستخدم إعادة المحاولة.
  console.warn('[BrowseMate Reader] tts error:', message);
  overlay.setPlaying(false);
};

overlay.setCallbacks({
  onPlay: togglePlayPause,
  onPause: togglePlayPause,
  onStop: stopReading,
  onPrev: () => { if (currentPara > 0) { player.stop(); readParagraph(currentPara - 1); } },
  onNext: () => { if (currentPara < blocks.length - 1) { player.stop(); readParagraph(currentPara + 1); } },
  onSpeedChange: (rate) => {
    player.setSettings({ rate });
    try { chrome.storage.local.set({ rate }); } catch { /* ignore */ }
    if (isActive && player.getState() !== 'idle') {
      player.stop();
      readParagraph(currentPara);
    }
  },
});

// ===== رسائل الوكيل =====
chrome.runtime.onMessage.addListener((msg: any, _sender, send) => {
  if (!msg || msg.__ta !== 'reader') return;
  try {
    switch (msg.op) {
      case 'ping':
        send({ ok: true, ready });
        return true;

      case 'outline': {
        const data = getOutline(document, {
          offset: msg.offset,
          maxBlocks: msg.maxBlocks,
          ids: msg.ids,
        });
        send({ ok: true, data });
        return true;
      }

      case 'read': {
        const res = resolveRead(document, msg);
        if (res.error || !res.blocks?.length) {
          send({ ok: false, error: res.error ?? 'NO_BLOCKS', message: res.message ?? 'لا توجد فقرات للقراءة.' });
          return true;
        }
        const started = startReading(res.blocks, { rate: msg.rate, voice: msg.voice, engine: msg.engine });
        if (!started.count) {
          send({ ok: false, error: 'NO_BLOCKS', message: 'الفقرات المختارة فارغة.' });
          return true;
        }
        send({ ok: true, data: started });
        return true;
      }

      case 'highlight': {
        const res = highlightInPage(document, msg);
        send(res);
        return true;
      }

      case 'clear-highlights':
        clearPageHighlights();
        send({ ok: true });
        return true;

      case 'stop':
        stopReading();
        send({ ok: true });
        return true;

      case 'status':
        send({
          ok: true,
          data: {
            active: isActive,
            state: player.getState(),
            para: currentPara,
            total: blocks.length,
            text: blocks[currentPara]?.text.slice(0, 160) ?? '',
            voice: player.getSettings().voice,
            rate: player.getSettings().rate,
            engine: player.getActualEngine() ?? player.getSettings().engine,
          },
        });
        return true;

      case 'set-rate': {
        const rate = Number(msg.rate);
        if (Number.isFinite(rate) && rate >= 0.5 && rate <= 2) {
          player.setSettings({ rate });
          overlay.setSpeed(rate);
          try { chrome.storage.local.set({ rate }); } catch { /* ignore */ }
          send({ ok: true });
        } else {
          send({ ok: false, error: 'BAD_RATE', message: 'السرعة يجب أن تكون بين 0.5 و2.' });
        }
        return true;
      }

      case 'set-voice':
        if (typeof msg.voice === 'string') {
          player.setSettings({ voice: msg.voice });
          try { chrome.storage.local.set({ voice: msg.voice }); } catch { /* ignore */ }
          send({ ok: true });
        } else {
          send({ ok: false, error: 'BAD_VOICE' });
        }
        return true;

      default:
        send({ ok: false, error: 'UNKNOWN_READER_OP', message: String(msg.op) });
        return true;
    }
  } catch (e) {
    send({ ok: false, error: 'READER_ERROR', message: e instanceof Error ? e.message : String(e) });
    return true;
  }
});

// إيقاف الصوت عند مغادرة الصفحة — أفضل جهد
window.addEventListener('pagehide', () => {
  try { chrome.runtime.sendMessage({ type: 'tts-stop' }); } catch { /* ignore */ }
});

loadSettings();
notify('loaded');
