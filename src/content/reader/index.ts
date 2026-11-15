// منسّق القارئ داخل الصفحة: يستقبل اختيار الوكيل من page_outline/read_aloud
// يشغّل chrome.tts عبر الـ SW، ويُظهر أزرار التحكم داخل الصفحة (مقتبسة من Nova TTS).

import { getOutline, resolveRead } from './extractor';
import type { ReaderBlock } from './extractor';
import { ReaderHighlighter } from './range-highlighter';
import { ReaderOverlay } from './overlay';
import { TtsPlayer } from './player';
import type { SpeakResult } from './player';
import { clearPageHighlights, highlightInPage } from './pointer';

const highlighter = new ReaderHighlighter();
const overlay = new ReaderOverlay();
const player = new TtsPlayer();

let blocks: ReaderBlock[] = [];
let currentPara = 0;
let isActive = false;
let ready = false;
let readSeq = 0;
let edgeVoiceAr = '';
let edgeVoiceEn = '';
let edgeVoiceOther = '';
let browserVoice = '';
let readerSession = '';
let readerVoiceId = '';
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

function stopReading(notify = true): void {
  readSeq++;
  if (notify) player.stop(); else player.silence();
  highlighter.clearAll();
  overlay.setPlaying(false);
  overlay.hide();
  isActive = false;
  blocks = [];
  currentPara = 0;
  readerSession = '';
  readerVoiceId = '';
}

async function readParagraph(index: number): Promise<SpeakResult> {
  if (!isActive || index < 0 || index >= blocks.length) {
    stopReading();
    return { ok: false, error: 'NOT_ACTIVE' };
  }
  currentPara = index;
  const block = blocks[index];
  if (!block) { stopReading(); return { ok: false, error: 'NO_BLOCK' }; }
  highlighter.clearWord();
  if (block.element?.isConnected) {
    highlighter.highlightParagraph(block.element, block.text);
  } else {
    highlighter.clearAll();
  }
  overlay.setParaInfo(index, blocks.length);

  const settings = player.getSettings();
  const keyOf = (b: ReaderBlock) => `${b.id}|${settings.engine}|${settings.voice}|${settings.rate}`;
  const key = keyOf(block);
  const prefetch = blocks
    .slice(index + 1, index + 3)
    .filter((b) => b.text?.trim())
    .map((b) => ({ key: keyOf(b), text: b.text }));
  return player.speak(block.text, index, {
    key,
    prefetch,
    index,
    total: blocks.length,
    title: document.title,
    sessionId: readerSession,
    voiceId: readerVoiceId,
  });
}

async function startReading(
  items: ReaderBlock[],
  options: { rate?: number; voice?: string; engine?: 'edge' | 'browser'; sessionId?: string; voiceId?: string } = {},
): Promise<{
  count: number;
  total: number;
  first: string;
  voice: string;
  rate: number;
  engine: 'edge' | 'browser';
  text: string;
  error?: string;
  voiceId?: string;
  fallback?: boolean;
  edgeError?: string;
}> {
  const usable = items.filter((b) => Boolean(b.text?.trim()));
  if (!usable.length) return { count: 0, total: 0, first: '', voice: '', rate: 1, engine: 'edge', text: '', error: 'NO_BLOCKS' };

  const myRead = ++readSeq;
  // لا نرسل tts-stop هنا: بدء التشغيل الجديد في الـ SW يوقف الصوت السابق فوراً.
  player.silence();
  highlighter.clearAll();
  blocks = usable;
  currentPara = 0;
  isActive = true;
  readerSession = String(options.sessionId || '');
  readerVoiceId = String(options.voiceId || '') || (globalThis.crypto?.randomUUID?.() || `voice-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  if (options.rate != null) {
    player.setSettings({ rate: options.rate });
    overlay.setSpeed(options.rate);
    try { chrome.storage.local.set({ rate: options.rate }); } catch { /* ignore */ }
  }
  const sample = usable.slice(0, 4).map((b) => b.text).join(' ').slice(0, 6000);
  const textLang = detectTextLang(sample);
  // Edge فقط — إعدادات قديمة قد تحتوي browser، نتجاهلها
  const engine: 'edge' = 'edge';
  if (options.engine) {
    player.setSettings({ engine: options.engine });
    try { chrome.storage.local.set({ engine: options.engine }); } catch { /* ignore */ }
  }

  if (options.voice && /Neural$/i.test(options.voice)) {
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
  const first = await readParagraph(0);
  // قراءة جديدة أو إيقاف أثناء انتظار أول فقرة: لا تُرجع نجاحاً كاذباً
  if (myRead !== readSeq) {
    return {
      count: 0,
      total: 0,
      first: '',
      voice: player.getSettings().voice,
      rate: player.getSettings().rate,
      engine: player.getSettings().engine,
      text: '',
      error: 'SUPERSEDED',
      voiceId: readerVoiceId,
    };
  }
  const supersededByNext = !first.ok && first.error === 'SUPERSEDED' && isActive;
  if (!first.ok && !supersededByNext) {
    const settings = player.getSettings();
    stopReading(false);
    return {
      count: 0,
      total: 0,
      first: '',
      voice: settings.voice,
      rate: settings.rate,
      engine: settings.engine,
      text: '',
      error: first.error || 'TTS_START_FAILED',
      voiceId: readerVoiceId,
    };
  }
  return {
    count: blocks.length,
    total: blocks.length,
    first: blocks[0].text.slice(0, 120),
    voice: first.voice ?? player.getSettings().voice,
    rate: player.getSettings().rate,
    engine: first.engine ?? player.getSettings().engine,
    text: usable.map((b) => b.text).join('\n\n'),
    voiceId: first.voiceId || readerVoiceId,
    ...(first.fallback ? { fallback: true, edgeError: first.edgeError } : {}),
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
        const before = player.getSettings();
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
        // Edge فقط — نتجاهل أي إعداد browser قديم
        const engine: 'edge' = 'edge';
        player.setSettings({ engine });

        // الصوت يتبع لغة النص الحالي (فقرات القراءة إن كانت نشطة، وإلا الصفحة)
        const sample = (isActive && blocks.length
          ? blocks.map((b) => b.text).join(' ')
          : document.body?.innerText || '').slice(0, 6000);
        const textLang = detectTextLang(sample);
        player.setSettings({
          voice: engine === 'edge' ? edgeVoiceFor(textLang) : browserVoice,
        });

        const after = player.getSettings();
        if (isActive && (after.rate !== before.rate || after.engine !== before.engine || after.voice !== before.voice)) {
          // بدء التشغيل الجديد في الـ SW يوقف الصوت القديم فوراً
          player.silence();
          readParagraph(currentPara);
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
  onPrev: () => { if (currentPara > 0) { player.silence(); readParagraph(currentPara - 1); } },
  onNext: () => { if (currentPara < blocks.length - 1) { player.silence(); readParagraph(currentPara + 1); } },
  onSpeedChange: (rate) => {
    player.setSettings({ rate });
    try { chrome.storage.local.set({ rate }); } catch { /* ignore */ }
    if (isActive && player.getState() !== 'idle') {
      // بدء التشغيل الجديد يوقف القديم فوراً — لا حاجة لرسالة إلغاء منفصلة
      player.silence();
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
        const requestSeq = readSeq;
        void (async () => {
          // انتظر تحميل إعدادات القارئ حتى لا يبدأ بصوت افتراضي ثم يُعاد تشغيله
          if (!ready) {
            await new Promise<void>((resolve) => {
              const started = Date.now();
              const t = setInterval(() => {
                if (ready || Date.now() - started > 1500) {
                  clearInterval(t);
                  resolve();
                }
              }, 50);
            });
          }
          // أُوقف/استُبدل قبل أن يبدأ — لا تبدأ قراءة متأخرة
          if (requestSeq !== readSeq) {
            send({ ok: false, error: 'TTS_STOPPED', message: 'أُوقف التشغيل قبل بدء القراءة.' });
            return;
          }
          const res = resolveRead(document, msg);
          if (res.error || !res.blocks?.length) {
            send({ ok: false, error: res.error ?? 'NO_BLOCKS', message: res.message ?? 'لا توجد فقرات للقراءة.' });
            return;
          }
          // ننتظر نتيجة أول فقرة حتى تعرف الأداة المحرك/الصوت الفعليين (Edge أو احتياطي)
          try {
            const started = await startReading(res.blocks, {
              rate: msg.rate,
              voice: msg.voice,
              engine: msg.engine,
              sessionId: msg.sessionId,
              voiceId: msg.voiceId,
            });
            if (!started.count) {
              send({
                ok: false,
                error: started.error || 'TTS_START_FAILED',
                message: 'تعذر بدء القراءة الصوتية للفقرات المختارة.',
              });
              return;
            }
            send({ ok: true, data: started });
          } catch (e) {
            send({ ok: false, error: 'READER_ERROR', message: e instanceof Error ? e.message : String(e) });
          }
        })().catch((e) => {
          send({ ok: false, error: 'READER_ERROR', message: e instanceof Error ? e.message : String(e) });
        });
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

      case 'remote-stop':
        stopReading(false);
        send({ ok: true });
        return true;

      case 'replay':
        if (isActive) {
          player.silence();
          readParagraph(currentPara);
        }
        send({ ok: true });
        return true;

      case 'next':
        if (isActive && currentPara < blocks.length - 1) {
          player.silence();
          readParagraph(currentPara + 1);
        }
        send({ ok: true });
        return true;

      case 'prev':
        if (isActive && currentPara > 0) {
          player.silence();
          readParagraph(currentPara - 1);
        }
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
          const prev = player.getSettings().rate;
          player.setSettings({ rate });
          overlay.setSpeed(rate);
          try { chrome.storage.local.set({ rate }); } catch { /* ignore */ }
          if (isActive && rate !== prev && player.getState() !== 'idle') {
            player.silence();
            readParagraph(currentPara);
          }
          send({ ok: true });
        } else {
          send({ ok: false, error: 'BAD_RATE', message: 'السرعة يجب أن تكون بين 0.5 و2.' });
        }
        return true;
      }

      case 'set-voice':
        if (typeof msg.voice === 'string' && /Neural$/i.test(msg.voice)) {
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

// إيقاف الصوت عند مغادرة الصفحة — ملك هذا التبويب فقط، ولا يمس نصاً حراً في البانل
window.addEventListener('pagehide', () => {
  if (!isActive) return;
  try { chrome.runtime.sendMessage({ type: 'tts-stop', scope: 'tab' }); } catch { /* ignore */ }
});

loadSettings();
notify('loaded');
