// مهارات مبدئية تُزرع مرة واحدة عند أول تشغيل — لا تعيد إضافة ما حذفه المستخدم
import { chromeKV } from '../shared/storage';
import type { SkillFile } from '../shared/types';

const SEED_VERSION = 4;

const SEEDS: SkillFile[] = [
  {
    name: 'compare-prices',
    description: 'يقارن سعر منتج بين متجرين (جارير وإكسترا) ويعرض الفروق',
    whenToUse: 'عند البحث عن أفضل سعر لمنتج قبل الشراء',
    site: 'jarir.com, extra.com',
    notes: 'الأسعار تتغير؛ النتيجة قراءة لحظية من الصفحة',
    params: [{ name: 'model', type: 'string', required: true, description: 'اسم المنتج', example: 'OnePlus 16' }],
    steps: [
      { tool: 'navigate', args: { url: 'https://www.jarir.com/sa-en/catalogsearch/result/?q={{model}}' } },
      { tool: 'read_page', args: {} },
      { tool: 'navigate', args: { url: 'https://www.extra.com/en-sa/search/?q={{model}}' } },
      { tool: 'read_page', args: {} },
    ],
  },
  {
    name: 'site-audit',
    description: 'يفحص صفحة: أخطاء console، طلبات الشبكة، ولقطة شاشة',
    whenToUse: 'قبل نشر موقع أو عند التحقق من أعطال صفحة معينة',
    site: 'أي موقع',
    notes: 'الصفحات الداخلية مثل chrome:// لا يمكن فحصها',
    params: [{ name: 'url', type: 'string', required: true, description: 'رابط الصفحة', example: 'https://example.com' }],
    steps: [
      { tool: 'navigate', args: { url: '{{url}}' } },
      { tool: 'inspect_code', args: {} },
      { tool: 'screenshot', args: {} },
      { tool: 'read_page', args: {} },
    ],
  },
  {
    name: 'youtube-brief',
    description: 'يبحث في يوتيوب عن موضوع ويلخص أول النتائج',
    whenToUse: 'عندما تريد ملخصاً سريعاً لمحتوى يوتيوب حول موضوع',
    site: 'youtube.com',
    params: [{ name: 'q', type: 'string', required: true, description: 'كلمة البحث', example: 'شرح React' }],
    steps: [
      { tool: 'navigate', args: { url: 'https://www.youtube.com/results?search_query={{q}}' } },
      { tool: 'read_page', args: {} },
    ],
  },
  {
    name: 'cv-tailor',
    description: 'يولّد سيرة ذاتية PDF مخصصة للوظيفة المفتوحة في التبويب الحالي',
    whenToUse: 'عندما تكون في صفحة وظيفة وتريد سيرة ذاتية متناسبة مع متطلباتها',
    site: 'أي موقع توظيف',
    notes: 'أرفق سيرتك الذاتية كملف Markdown من بطاقة المهارة (زر 📎). لا يختلق النموذج خبرات غير موجودة.',
    instructions: `مهمتك: توليد سيرة ذاتية PDF مخصصة للوظيفة المعروضة في التبويب النشط. اكتب السيرة بالإنجليزية (English) دائماً ما لم يطلب المستخدم لغة أخرى صراحةً.
1) استدعِ read_page لقراءة صفحة الوظيفة، واستخرج: Job title، Company، Requirements، Responsibilities، Keywords.
2) اعتمد حصرياً على السيرة الذاتية الموجودة في context (Markdown). لا تخترع خبرات أو مهارات غير موجودة؛ أعد الترتيب والصياغة والإبراز فقط.
3) أنشئ مستند HTML كامل A4 احترافياً بالإنجليزية (خطوط نظام، ألوان هادئة، عمود واحد، عناوين واضحة، ATS-friendly: عناوين قياسية مثل Summary / Skills / Experience / Education). أبرز المهارات والخبرات المطابقة لمتطلبات الوظيفة وأعد ترتيبها حسب الصلة، واستخدم كلمات الوظيفة المفتاحية.
4) اجعل المحتوى في صفحة أو صفحتين كحد أقصى، بدون صور أو ألوان طباعة كثيفة، وبخط مقروء (10.5-11pt).
5) استدعِ export_pdf مع filename مناسب مثل CV-Company-JobTitle.pdf.
6) بعد النجاح اعرض ملخصاً قصيراً بالعربية: ما الذي أُبرز/أُعيد ترتيبه ولماذا، واسم الملف.
إن كان context فارغاً اطلب من المستخدم رفع CV.md من بطاقة المهارة قبل المتابعة.`,
    params: [],
    steps: [],
    version: 1,
  },
  {
    name: 'youtube-summary',
    description: 'يلخص فيديو يوتيوب من ترجمته (يدوية أو تلقائية) مع نقاط رئيسية',
    whenToUse: 'عندما تكون في صفحة فيديو يوتيوب وتريد ملخصاً سريعاً لمحتواه',
    site: 'youtube.com',
    notes: 'يعمل بدون مفاتيح — يقرأ الترجمة من الصفحة. بعض الفيديوهات بلا ترجمة إطلاقاً.',
    instructions: `مهمتك: تلخيص فيديو يوتيوب المفتوح في التبويب النشط بالاعتماد على ترجمته.
1) استدعِ youtube_transcript. إن أعاد NOT_YOUTUBE فاطلب من المستخدم رابط الفيديو ثم استخدم navigate لفتحه وأعد المحاولة.
2) إن أعاد NO_TRANSCRIPT فأخبر المستخدم أن الفيديو لا يحتوي ترجمة، واقترح بدائل.
3) لخّص النص بالعربية (أو لغة المستخدم) في: جملة ملخص، 5-8 نقاط رئيسية، وأهم التفاصيل/الأرقام/الأسماء.
4) لا تختلق محتوى غير موجود في الترجمة. ميّز بين ما قيل صراحةً واستنتاجك.
5) اذكر لغة الترجمة المستخدمة ومصدرها (يدوية/تلقائية).`,
    params: [],
    steps: [],
    version: 1,
  },
];

export async function seedSkills() {
  const seeded = (await chromeKV.get<number>('skillsSeeded')) ?? 0;
  if (seeded >= SEED_VERSION) return;
  const existing = (await chromeKV.get<Record<string, SkillFile>>('skills')) ?? {};
  for (const s of SEEDS) {
    const cur = existing[s.name];
    if (!cur) { existing[s.name] = s; continue; }
    // تحديث إرشادات المهارات المبدئية فقط إن لم يرفق المستخدم سياقاً (لم يعدّلها)
    if (s.instructions && !cur.context) existing[s.name] = { ...cur, instructions: s.instructions, notes: s.notes, whenToUse: s.whenToUse };
  }
  await chromeKV.set('skills', existing);
  await chromeKV.set('skillsSeeded', SEED_VERSION);
}
