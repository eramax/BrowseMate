// أدوات القراءة الصوتية الذكية — الوكيل يختار الفقرات، والقارئ المدمج (المقتبس من Nova TTS) يقرأها داخل الصفحة.
import { z } from 'zod';
import { register } from './registry';
import { withReader } from '../inject';
import { resolveTabId } from './tab-id';
import { getTtsVoices } from '../tts';
import { fetchEdgeVoices, type EdgeVoice } from '../edge';

register({
  name: 'page_outline',
  description:
    'يعرض فقرات الصفحة القابلة للقراءة مع معرّفات (IDs) وعناوينها. استخدمه قبل read_aloud لاختيار الأجزاء المناسبة فقط — لا تقرأ القوائم أو التذييل أو الإعلانات. يدعم offset/maxBlocks للتنقل، وids لجلب النص الكامل لفقرة محددة.',
  sensitive: false,
  idempotent: true,
  schema: z.object({
    tabId: z.number().optional().describe('معرف التبويب (اختياري — الافتراضي النشط)'),
    offset: z.number().int().min(0).max(10000).optional().describe('بداية العرض في قائمة الفقرات'),
    maxBlocks: z.number().int().min(1).max(200).optional().describe('أقصى عدد فقرات (افتراضي 120)'),
    ids: z.array(z.string()).max(50).optional().describe('معرّفات لجلب نصها الكامل بدل القائمة'),
  }),
  execute: async (a, ctx) => {
    const tabId = await resolveTabId(a.tabId, ctx);
    if (tabId == null) return { error: 'NO_ACTIVE_TAB', message: 'لا يوجد تبويب نشط.' };
    return withReader(tabId, 'outline', { offset: a.offset, maxBlocks: a.maxBlocks, ids: a.ids });
  },
});

register({
  name: 'read_aloud',
  description:
    'يقرأ بصوت عالٍ الأجزاء التي يختارها الوكيل. text يُقرأ مباشرة في مشغل البانل بدون فتح صفحة (لا تظليل)؛ أما blockIds/from-to/selector/selection فتعمل داخل الصفحة مع أزرار عائمة وتظليل الفقرة والكلمة. اختر هدفاً واحداً فقط. لا تقرأ الصفحة كلها افتراضياً؛ اختر المحتوى الرئيسي. يستخدم أصوات Microsoft Edge العصبية افتراضياً، مع أصوات المتصفح كاحتياط.',
  sensitive: false,
  idempotent: true,
  schema: z.object({
    tabId: z.number().optional().describe('معرف التبويب (اختياري — الافتراضي النشط)'),
    blockIds: z.array(z.string()).min(1).max(100).optional().describe('معرّفات فقرات من page_outline بالترتيب'),
    fromBlockId: z.string().optional().describe('ابدأ من هذه الفقرة (شاملة)'),
    toBlockId: z.string().optional().describe('انتهِ عند هذه الفقرة (شاملة)'),
    selector: z.string().max(300).optional().describe('محدد CSS لعناصر تُقرأ، مثل article p'),
    selection: z.boolean().optional().describe('اقرأ الفقرات المتقاطعة مع التحديد الحالي'),
    text: z.string().min(1).max(20000).optional().describe('نص حر يُقرأ مباشرة كرسالة صوتية في المحادثة بدون فتح صفحة وبدون تظليل'),
    rate: z.number().min(0.5).max(2).optional().describe('سرعة القراءة (0.5–2، افتراضي 1)'),
    engine: z.enum(['edge', 'browser']).optional().describe('edge = أصوات Microsoft Edge العصبية (افتراضي)، browser = أصوات chrome.tts'),
    voice: z.string().max(200).optional().describe('اسم صوت من list_tts_voices (مثل ar-EG-ShakirNeural)'),
  }),
  execute: async (a, ctx) => {
    const modes = [
      Boolean(a.blockIds?.length),
      Boolean(a.fromBlockId || a.toBlockId),
      Boolean(a.selector?.trim()),
      a.selection === true,
      Boolean(a.text?.trim()),
    ].filter(Boolean).length;
    if (modes === 0) {
      return {
        error: 'NO_TARGET',
        message: 'حدد ما يُقرأ: blockIds من page_outline، أو fromBlockId/toBlockId، أو selector، أو selection، أو text.',
      };
    }
    if (modes > 1) {
      return {
        error: 'MULTIPLE_TARGETS',
        message: 'اختر هدفاً واحداً فقط: blockIds أو نطاق أو selector أو selection أو text.',
      };
    }
    const engine: 'edge' | 'browser' = a.engine === 'browser' ? 'browser' : 'edge';

    if (engine === 'edge') {
      // نتحقق من الصوت إن أمكن، لكن لا نمنع المحاولة إذا فشل جلب القائمة
      try {
        const edgeVoices = await fetchEdgeVoices();
        if (edgeVoices.length && a.voice && !edgeVoices.some((v) => v.name === a.voice)) {
          const arabic = edgeVoices
            .filter((v) => v.lang.toLowerCase().startsWith('ar'))
            .sort((a, b) => (a.lang === 'ar-EG' ? 0 : 1) - (b.lang === 'ar-EG' ? 0 : 1) || a.name.localeCompare(b.name))
            .slice(0, 8);
          return {
            error: 'EDGE_VOICE_NOT_FOUND',
            message: `صوت Edge «${a.voice}» غير موجود. استخدم list_tts_voices({engine:'edge'}) لاختيار صوت.`,
            voices: (arabic.length ? arabic : edgeVoices.slice(0, 8)).map((v) => ({
              name: v.name,
              lang: v.lang,
              gender: v.gender,
            })),
          };
        }
      } catch {
        /* دع محرك Edge يحاول؛ SW سيسقط إلى صوت المتصفح عند الفشل */
      }
    } else {
      const voices = await getTtsVoices();
      if (!voices.length) {
        return {
          error: 'TTS_NO_VOICES',
          message:
            'لا توجد أصوات TTS متاحة في المتصفح. ثبّت صوتاً في النظام (مثلاً صوت عربي) أو فعّل إضافة Google Network Speech، أو استخدم engine:edge.',
        };
      }
      if (a.voice && !voices.some((v) => v.name === a.voice)) {
        return {
          error: 'VOICE_NOT_FOUND',
          message: `الصوت «${a.voice}» غير متاح. استخدم list_tts_voices({engine:'browser'}) لاختيار صوت موجود.`,
          voices: voices.slice(0, 10).map((v) => ({ name: v.name, lang: v.lang, supportsWord: v.supportsWord })),
        };
      }
    }

    // نص حر: يُقرأ مباشرة في مشغل البانل بدون فتح صفحة
    const isTextOnly =
      Boolean(a.text?.trim()) &&
      !a.blockIds?.length &&
      !a.fromBlockId &&
      !a.toBlockId &&
      !a.selector?.trim() &&
      a.selection !== true;
    if (isTextOnly) {
      const text = String(a.text || '');
      const res: any = await chrome.runtime.sendMessage({
        type: 'tts-speak-text',
        text,
        voice: a.voice,
        rate: a.rate,
        engine,
      });
      if (res?.ok) {
        return {
          ok: true,
          data: {
            count: 1,
            total: 1,
            engine: res.engine || engine,
            voice: res.voice ?? a.voice ?? '',
            rate: a.rate ?? 1,
            first: text.slice(0, 120),
            text: text.slice(0, 12000),
          },
        };
      }
      return res;
    }

    const tabId = await resolveTabId(a.tabId, ctx);
    if (tabId == null) return { error: 'NO_ACTIVE_TAB', message: 'لا يوجد تبويب نشط.' };
    const { tabId: _omit, ...payload } = a;
    return withReader(tabId, 'read', { ...payload, engine });
  },
});

register({
  name: 'highlight_in_page',
  description:
    'يشير بصرياً إلى موضع في الصفحة (نص أو فقرة أو عنصر) دون قراءة صوتية. استخدمه عندما يقول المستخدم «أين…؟» أو «أشر إلى…». اختر هدفاً واحداً: text للبحث عن نص (حتى داخل زر/رابط)، أو blockIds من page_outline، أو selector. التظليل يبقى حتى clear_highlights أو تغيير الصفحة.',
  sensitive: false,
  idempotent: true,
  schema: z.object({
    tabId: z.number().optional().describe('معرف التبويب (اختياري — الافتراضي النشط)'),
    text: z.string().min(1).max(2000).optional().describe('النص المراد تظليله (بحث غير حساس لحالة الأحرف)'),
    blockIds: z.array(z.string()).min(1).max(100).optional().describe('معرّفات فقرات من page_outline'),
    selector: z.string().max(300).optional().describe('محدد CSS لعناصر مثل button.login أو article p'),
    color: z.string().max(20).optional().describe('لون HEX اختياري، افتراضي #fde047'),
    all: z.boolean().optional().describe('ظلّل كل التطابقات وليس الأول فقط'),
    scroll: z.boolean().optional().describe('مرّر إلى الموضع (افتراضي true)'),
  }),
  execute: async (a, ctx) => {
    const modes = [Boolean(a.text?.trim()), Boolean(a.blockIds?.length), Boolean(a.selector?.trim())].filter(Boolean).length;
    if (modes === 0) return { error: 'NO_TARGET', message: 'حدد text أو blockIds أو selector.' };
    if (modes > 1) return { error: 'MULTIPLE_TARGETS', message: 'اختر هدفاً واحداً فقط: text أو blockIds أو selector.' };
    const tabId = await resolveTabId(a.tabId, ctx);
    if (tabId == null) return { error: 'NO_ACTIVE_TAB', message: 'لا يوجد تبويب نشط.' };
    const { tabId: _omit, ...payload } = a;
    return withReader(tabId, 'highlight', payload);
  },
});

register({
  name: 'clear_highlights',
  description: 'يمسح تظليل المواضع الذي أضافته highlight_in_page (لا يوقف القراءة الصوتية).',
  sensitive: false,
  idempotent: true,
  schema: z.object({ tabId: z.number().optional() }),
  execute: async (a, ctx) => {
    const tabId = await resolveTabId(a.tabId, ctx);
    if (tabId == null) return { error: 'NO_ACTIVE_TAB', message: 'لا يوجد تبويب نشط.' };
    return withReader(tabId, 'clear-highlights');
  },
});

register({
  name: 'stop_reading',
  description: 'يوقف القراءة الصوتية الحالية ويغلق أزرار التحكم داخل الصفحة.',
  sensitive: false,
  idempotent: true,
  schema: z.object({ tabId: z.number().optional() }),
  execute: async (a, ctx) => {
    const tabId = await resolveTabId(a.tabId, ctx);
    if (tabId == null) return { error: 'NO_ACTIVE_TAB', message: 'لا يوجد تبويب نشط.' };
    return withReader(tabId, 'stop');
  },
});

register({
  name: 'reading_status',
  description: 'يعرض حالة القراءة الصوتية: هل هي نشطة، الفقرة الحالية، والعدد الكلي.',
  sensitive: false,
  idempotent: true,
  schema: z.object({ tabId: z.number().optional() }),
  execute: async (a, ctx) => {
    const tabId = await resolveTabId(a.tabId, ctx);
    if (tabId == null) return { error: 'NO_ACTIVE_TAB', message: 'لا يوجد تبويب نشط.' };
    return withReader(tabId, 'status');
  },
});

register({
  name: 'list_tts_voices',
  description:
    'يعرض أصوات Microsoft Edge العصبية (افتراضي) أو أصوات chrome.tts في المتصفح. استخدمه لاختيار صوت عربي/إنجليزي قبل read_aloud. للعربية المصرية: ar-EG-ShakirNeural (ذكر — المفضل) أو ar-EG-SalmaNeural (أنثى). الأصوات المتعددة اللغات (Multilingual) تعمل مع كل اللغات.',
  sensitive: false,
  idempotent: true,
  schema: z.object({
    lang: z.string().max(12).optional().describe('بادئة اللغة مثل ar أو ar-EG أو en'),
    engine: z.enum(['edge', 'browser']).optional().describe('edge (افتراضي) أو browser'),
  }),
  execute: async (a) => {
    const lang = (a.lang ?? '').trim().toLowerCase();
    const engine: 'edge' | 'browser' = a.engine === 'browser' ? 'browser' : 'edge';

    if (engine === 'browser') {
      let voices = await getTtsVoices();
      if (lang) voices = voices.filter((v) => v.lang.toLowerCase().startsWith(lang));
      const preferred = lang.startsWith('ar')
        ? ['ar-eg', 'ar-sa', 'ar-ae']
        : lang.startsWith('en')
          ? ['en-us', 'en-gb']
          : [];
      if (preferred.length) {
        voices.sort((x, y) => {
          const xi = preferred.findIndex((p) => x.lang.toLowerCase().startsWith(p));
          const yi = preferred.findIndex((p) => y.lang.toLowerCase().startsWith(p));
          return (xi < 0 ? 99 : xi) - (yi < 0 ? 99 : yi);
        });
      }
      return {
        engine: 'browser',
        total: voices.length,
        voices: voices.slice(0, 40),
        ...(voices[0] ? { recommended: voices[0].name } : {}),
        ...(voices.length ? {} : { message: 'لا توجد أصوات TTS مطابقة في المتصفح. استخدم engine:edge.' }),
      };
    }

    let voices: EdgeVoice[];
    try {
      voices = await fetchEdgeVoices();
    } catch (e: any) {
      return {
        error: 'EDGE_VOICES_FAILED',
        message: 'تعذر جلب أصوات Edge. تحقق من الشبكة أو استخدم engine:browser.',
        detail: e?.message ?? String(e),
      };
    }
    let filtered = lang
      ? voices.filter((v) => v.lang.toLowerCase().startsWith(lang))
      : voices.filter((v) => /^ar-/i.test(v.lang) || /^en-/i.test(v.lang));
    const preferred = lang.startsWith('ar')
      ? ['ar-eg', 'ar-sa', 'ar-ae']
      : lang.startsWith('en')
        ? ['en-us', 'en-gb']
        : ['ar-eg', 'ar-sa', 'ar-ae', 'en-us', 'en-gb'];
    const preferredNames = lang.startsWith('ar')
      ? ['ar-eg-shakir', 'ar-eg-salma']
      : lang.startsWith('en')
        ? ['en-us-emma', 'en-us-aria', 'en-us-guy', 'en-gb-sonia']
        : [];
    filtered = filtered.slice().sort((x, y) => {
      const xn = preferredNames.findIndex((n) => x.name.toLowerCase().startsWith(n));
      const yn = preferredNames.findIndex((n) => y.name.toLowerCase().startsWith(n));
      if (xn >= 0 || yn >= 0) return (xn < 0 ? 99 : xn) - (yn < 0 ? 99 : yn);
      const xi = preferred.findIndex((p) => x.lang.toLowerCase().startsWith(p));
      const yi = preferred.findIndex((p) => y.lang.toLowerCase().startsWith(p));
      if ((xi < 0 ? 99 : xi) !== (yi < 0 ? 99 : yi)) return (xi < 0 ? 99 : xi) - (yi < 0 ? 99 : yi);
      return x.name.localeCompare(y.name);
    });
    return {
      engine: 'edge',
      total: filtered.length,
      voices: filtered.slice(0, 60),
      ...(filtered[0] ? { recommended: filtered[0].name } : {}),
      ...(filtered.length ? {} : { message: 'لا توجد أصوات Edge مطابقة لهذه اللغة.' }),
    };
  },
});
