// مهارات مبدئية تُزرع مرة واحدة عند أول تشغيل — لا تعيد إضافة ما حذفه المستخدم
import { chromeKV } from '../shared/storage';
import type { SkillFile } from '../shared/types';

const SEED_VERSION = 6;

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
    instructions: `مهمتك: توليد سيرة ذاتية إنجليزية مخصصة للوظيفة بسرعة وبأقل خطوات.
1) استدعِ read_page مرة واحدة على صفحة الوظيفة واستخرج: Job title، Company، Requirements، Responsibilities، Keywords.
2) لا تكتب HTML ولا تستخدم export_pdf. استدعِ render_cv مباشرة ببيانات JSON منظمة:
   - name/title/email/phone/location/links من سيرة المستخدم (context).
   - summary: 2-3 أسطر مخصصة للوظيفة.
   - skills: مرتبة حسب صلة الوظيفة.
   - experience: نفس الخبرات الحقيقية، bullets معاد صياغتها بإيجاز (3-5 لكل وظيفة) مع كلمات الوظيفة المفتاحية.
   - education/projects/certifications/languages كما في السيرة.
   - filename: CV-Company-Role.html
3) اعتمد حصرياً على context؛ لا تختلق خبرات أو مهارات. اجعل الناتج صفحة أو صفحتين.
4) بعد render_cv اكتب ملخصاً قصيراً بالعربية (3 أسطر): ما أُبرز، واسم الملف. لا حاجة لأي أداة إضافية.
إن كان context فارغاً اطلب رفع CV.md من ⚙ إعدادات المهارة.`,
    params: [],
    steps: [],
    version: 1,
  },
  {
    name: 'cover-letter',
    description: 'يكتب خطاب تقديم (Cover Letter) إنجليزي مخصص للوظيفة المفتوحة كملف منسق',
    whenToUse: 'عندما تكون في صفحة وظيفة وتريد خطاب تقديم مخصصاً لسيرتك',
    site: 'أي موقع توظيف',
    notes: 'يستخدم نفس CV.md المرفق في cv-tailor إن وُجد؛ لا يختلق إنجازات.',
    instructions: `مهمتك: كتابة Cover Letter إنجليزي مخصص للوظيفة المعروضة في التبويب النشط.
1) استدعِ read_page مرة واحدة واستخرج: Job title، Company، Requirements، Keywords، اسم جهة الاتصال إن وُجد.
2) اعتمد على context (السيرة) إن وُجد؛ وإن لم يوجد اطلب رفع CV.md من ⚙ إعدادات مهارة cv-tailor (السياق لا يُشارك تلقائياً).
3) اكتب 3-4 فقرات، 250-350 كلمة: افتتاحية (الوظيفة + الشركة + سبب الاهتمام)، ملاءمة (2-3 إنجازات حقيقية مرتبطة بالمتطلبات مع أرقام إن وُجدت)، لماذا الشركة، خاتمة (دعوة لمقابلة + شكر). لغة مهنية مباشرة، بلا مبالغات.
4) استدعِ render_document بحقول: title=Cover Letter — {Job Title}، subtitle={Company}، meta=[Date, To: Hiring Manager, Re: Application for {Job Title}]، paragraphs=[...]، signature.
5) filename مثل CoverLetter-Company-JobTitle.html.
6) بعد النجاح اكتب سطرين بالعربية عن الملف. لا تستخدم export_pdf ولا تكتب HTML.`,
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
    if (!cur) { existing[s.name] = { ...s, seedRev: SEED_VERSION }; continue; }
    if (cur.seedRev === -1 || cur.seedRev === SEED_VERSION) continue; // عدّلها المستخدم أو محدثة
    // ترقية مهارة مبدئية: حدّث التعليمات مع الحفاظ على الملف المرفق والمعاملات
    existing[s.name] = { ...s, context: cur.context, params: cur.params, seedRev: SEED_VERSION };
  }
  await chromeKV.set('skills', existing);
  await chromeKV.set('skillsSeeded', SEED_VERSION);
}
