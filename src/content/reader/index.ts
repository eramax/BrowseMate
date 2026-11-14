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
let edgeVoiceAr = '';
let edgeVoiceEn = '';
let edgeVoiceOther = '';
let browserVoice = '';
const DEFAULT_EDGE_AR = 'ar-EG-ShakirNeural';
const DEFAULT_EDGE_EN = 'en-US-EmmaMultilingualNeural';
const DEFAULT_EDGE_OTHER = 'en-US-EmmaMultilingualNeural';

type TextLang = 'ar' | 'en' | 'other';

function detectTextLang(sample: string): TextLang {
  const arCount = (sample.match(/[\u0600-\u06FF]/g) || []).length;
  const enCount = (sample.match(/[A-Za-z]/g) || []).length;
  const docLang = (document.documentElement.lang || '').toLowerCase();
  // النص نفسه هو الحكم الأول (عربي مقابل لاتيني)
  if (arCount > 0 && arCount >= enCount) return 'ar';
  if (docLang.startsWith('en') && enCount > 0) return 'en';
  // لغة صفحة غير عربية/إنجليزية → استخدم صوت اللغات الأخرى (Multilingual)
  if (docLang && !docLang.startsWith('ar') && !docLang.startsWith('en')) return 'other';
  if (enCount > 0) return 'en';
  if (arCount > 0) return 'ar';
  return 'other';
}

function edgeVoiceFor(lang: TextLang): string {
  if (lang === 'ar') return edgeVoiceAr || DEFAULT_EDGE_AR;
  if (lang === 'en') return edgeVoiceEn || DEFAULT_EDGE_EN;
  return edgeVoiceOther || DEFAULT_EDGE_OTHER;
}

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
  const sample = usable.slice(0, 4).map((b) => b.text).join(' ').slice(0, 6000);
  const textLang = detectTextLang(sample);
  const engine: 'edge' | 'browser' = options.engine ?? player.getSettings().engine;
  if (options.engine) {
    player.setSettings({ engine: options.engine });
    try { chrome.storage.local.set({ engine: options.engine }); } catch { /* ignore */ }
  }

  if (options.voice) {
    player.setSettings({ voice: options.voice });
    if (engine === 'edge') {
      if (textLang === 'ar') {
        edgeVoiceAr = options.voice;
        try { chrome.storage.local.set({ edgeVoiceAr: options.voice }); } catch { /* ignore */ }
      } else if (textLang === 'en') {
        edgeVoiceEn = options.voice;
        try { chrome.storage.local.set({ edgeVoiceEn: options.voice }); } catch { /* ignore */ }
      } else {
        edgeVoiceOther = options.voice;
        try { chrome.storage.local.set({ edgeVoiceOther: options.voice }); } catch { /* ignore */ }
      }
    } else {
      browserVoice = options.voice;
      try { chrome.storage.local.set({ browserVoice: options.voice }); } catch { /* ignore */ }
    }
  } else if (engine === 'edge') {
    player.setSettings({ voice: edgeVoiceFor(textLang) });
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
        engine: 'edge',
        edgeVoiceAr: '',
        edgeVoiceEn: '',
        edgeVoiceOther: '',
        browserVoice: '',
        paraColor: '#ffc107',
        wordColor: '#00bcd4',
      },
      (data) => {
        const rate = Number(data?.rate);
        if (Number.isFinite(rate) && rate >= 0.5 && rate <= 2) {
          player.setSettings({ rate });
          overlay.setSpeed(rate);
        }
        const legacy = typeof data?.voice === 'string' ? data.voice : '';
        // العربية: Shakir افتراضياً حتى لو كان هناك صوت قديم محفوظ
        edgeVoiceAr = typeof data?.edgeVoiceAr === 'string' && data.edgeVoiceAr
          ? data.edgeVoiceAr
          : DEFAULT_EDGE_AR;
        edgeVoiceEn = typeof data?.edgeVoiceEn === 'string' && data.edgeVoiceEn
          ? data.edgeVoiceEn
          : (/^en-/i.test(legacy) ? legacy : DEFAULT_EDGE_EN);
        edgeVoiceOther = typeof data?.edgeVoiceOther === 'string' && data.edgeVoiceOther
          ? data.edgeVoiceOther
          : DEFAULT_EDGE_OTHER;
        browserVoice = typeof data?.browserVoice === 'string' && data.browserVoice
          ? data.browserVoice
          : legacy && !/Neural$/i.test(legacy) ? legacy : '';
        const engine = data?.engine === 'browser' ? 'browser' : 'edge';
        player.setSettings({ engine });
        if (!isActive) {
          if (engine === 'edge') {
            const pageLang = detectTextLang((document.body?.innerText || '').slice(0, 4000));
            player.setSettings({ voice: edgeVoiceFor(pageLang) });
          } else if (browserVoice) {
            player.setSettings({ voice: browserVoice });
          }
        }
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
        if (typeof msg.voice === 'string' && msg.voice) {
          player.setSettings({ voice: msg.voice });
          const sample = (blocks.length ? blocks.map((b) => b.text).join(' ') : document.body?.innerText || '').slice(0, 6000);
          const textLang = detectTextLang(sample);
          if (player.getSettings().engine === 'edge') {
            if (textLang === 'ar') edgeVoiceAr = msg.voice;
            else if (textLang === 'en') edgeVoiceEn = msg.voice;
            else edgeVoiceOther = msg.voice;
            try {
              const patch: Record<string, string> = textLang === 'ar'
                ? { edgeVoiceAr: msg.voice }
                : textLang === 'en' ? { edgeVoiceEn: msg.voice } : { edgeVoiceOther: msg.voice };
              chrome.storage.local.set(patch);
            } catch { /* ignore */ }
          } else {
            browserVoice = msg.voice;
            try { chrome.storage.local.set({ browserVoice: msg.voice }); } catch { /* ignore */ }
          }
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

// تحديث إعدادات القارئ عند تغييرها من الإعدادات
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (['rate', 'engine', 'edgeVoiceAr', 'edgeVoiceEn', 'edgeVoiceOther', 'browserVoice', 'paraColor', 'wordColor'].some((k) => k in changes)) {
      loadSettings();
    }
  });
} catch { /* ignore */ }

// إيقاف الصوت عند مغادرة الصفحة — أفضل جهد
window.addEventListener('pagehide', () => {
  try { chrome.runtime.sendMessage({ type: 'tts-stop' }); } catch { /* ignore */ }
});

loadSettings();
notify('loaded');
