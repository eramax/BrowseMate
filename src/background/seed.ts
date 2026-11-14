// مهارات مبدئية تُزرع مرة واحدة عند أول تشغيل — لا تعيد إضافة ما حذفه المستخدم
import type { SkillFile } from '../shared/types';
import { getSeedRev, setSeedRev, saveSkillsBulk, getSkills } from './skill-store';

const SEED_VERSION = 22;

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
    instructions: `مهمتك: تلخيص فيديو يوتيوب المفتوح في التبويب النشط بالاعتماد على ترجمته الأصلية.
1) استدعِ youtube_transcript. الأداة تجلب الترجمة الأصلية (لغة الفيديو: إنجليزية للإنجليزي، عربية للعربي) — لا تطلب ترجمة عربية إن كان الأصل إنجليزياً.
2) إن أعاد NOT_YOUTUBE فاطلب من المستخدم رابط الفيديو ثم استخدم navigate لفتحه وأعد المحاولة.
3) إن أعاد NO_TRANSCRIPT فأخبر المستخدم أن الفيديو لا يحتوي ترجمة، واقترح بدائل.
4) لخّص بالعربية دائماً: جملة ملخص، 5-8 نقاط رئيسية، وأهم التفاصيل/الأرقام/الأسماء. حافظ على المصطلحات التقنية والأسماء كما وردت بالإنجليزية.
5) لا تختلق محتوى غير موجود في الترجمة. ميّز بين ما قيل صراحةً واستنتاجك.
6) اذكر لغة الترجمة المستخدمة ومصدرها (يدوية/تلقائية).`,
    params: [],
    steps: [],
    version: 1,
  },
  {
    name: 'web-builder',
    description: 'يبني موقعاً/تطبيق ويب كاملاً (Frontend فقط) كملف HTML واحد ويعاينه ويعدّله بـ diff',
    whenToUse: 'عندما تطلب تصميم موقع أو تطبيق ويب أو واجهة، وتريد معاينته وتعديله وتنزيله',
    site: 'أي متصفح',
    notes: 'ملف HTML واحد (CSS/JS داخله) بدون npm/build. الكتابة الأولى بـ ws_write، ثم الإضافة بـ ws_append، والتعديل/الإدراج بـ edit (أو ws_patch لعدة تعديلات).',
    instructions: `مهمتك: بناء موقع/تطبيق ويب (Frontend فقط) كملف HTML واحد يحتوي CSS وJS داخله. لا تستخدم أي قالب جاهز ولا تفترض نوع المشروع. اجعله Single Page: كل الشاشات/الأقسام داخل نفس الملف.
0) لمشروع جديد: ws_reset أولاً. لمواصلة مشروع موجود: ws_list/ws_read.
1) اكتب index.html مرة واحدة عبر ws_write. ابدأ بالجزء الأول (head + style + بداية body). لا تحاول كتابة الملف كله إن كان طويلاً.
2) بعد الكتابة الأولى لا تستخدم ws_write مرة أخرى (إلا لإعادة بناء كاملة يطلبها المستخدم، مع overwrite:true). استخدم:
   - ws_append لإضافة الجزء التالي في نهاية الملف (استكمال chunk).
   - edit لتعديل أو إدراج جزء في مكان محدد: oldString فريد → newString يحتوي الجزء الجديد. هذا هو diff، وهو الأداة الأساسية لأي تعديل لاحق.
   - ws_patch فقط عندما تحتاج عدة تعديلات مستقلة في نداء واحد. إن فشل بعضها فسيعيد failed/nearby؛ أصلح الفاشل فقط.
   - بعد نجاح edit أو ws_patch لا تعيد ws_read؛ انتقل مباشرة إلى ws_preview.
3) بعد كل جزء اقرأ complete وtail من نتيجة الأداة: إن كانت complete:false أكمل بـ ws_append أو edit. لا تكرر نفس الجزء، ولا تعد إرسال الملف كاملاً. ws_patch يطبق الناجح ويبلغ عن الفاشل (partial)؛ لا تعتبره فشلاً كاملاً.
4) ws_read لرؤية النص الحرفي قبل edit. ws_list لمراجعة الملف.
5) ws_preview للمعاينة. إن أعاد خطأ HTML/JS: اقرأ الملف بـ ws_read ثم أصلح السطر المذكور بـ edit. رقم السطر في الرسالة مطلق داخل الملف. إن فشل edit فراجع nearby وانسخ النص الحرفي؛ لا تعد توليد الملف.
6) بعد نجاح المعاينة: preview_diagnostics، وأصلح أخطاء console بـ edit (حتى مرتين).
7) ws_download لتنزيل الملف، أو اترك زر التحميل في الشات.
8) قواعد الكود:
   - HTML صحيح ومغلق: <!doctype html> ... </html>.
   - استخدم addEventListener فقط (لا onclick داخل HTML)، ولا تضع "</script>" داخل أي سلسلة JS.
   - لبناء العناصر ديناميكياً: document.createElement + textContent. لا تستخدم innerHTML إطلاقاً، ولا تكتب دالة escapeHtml. هذا يمنع أخطاء الاقتباس نهائياً.
   - إن احتجت قالب HTML ثابتاً، استخدم <template> وcloneNode ثم املأ النصوص بـ textContent.
   - كل CSS/JS داخل الملف. CDN مسموح.
9) لا تنهِ دورك بوعد («سأصلح»، «سأعيد») بدون تنفيذ الأداة في نفس الدور. اعرض ملخصاً قصيراً فقط.`,
    params: [],
    steps: [],
    version: 1,
  },
  {
    name: 'tab-groups',
    description: 'ينظّم تبويبات المتصفح في مجموعات حسب الموضوع/الموقع، مع استثناء التبويبات المثبتة افتراضياً',
    whenToUse: 'عندما يطلب المستخدم تجميع/ترتيب تبويباته أو تنظيمها حسب الموضوع',
    site: 'أي متصفح',
    notes: 'list_tabs مرة واحدة، ثم group_tabs مرة واحدة مع groups. لا تضم pinned إلا بطلب صريح. لا تدّعِ النجاح بدون groupId.',
    instructions: `مهمتك: تجميع تبويبات المتصفح الحالية في مجموعات مفيدة.
1) استدعِ list_tabs مرة واحدة فقط لقراءة التبويبات (id, title, url, pinned, groupable).
2) صنّف التبويبات حسب الموضوع/النطاق. لا تفتح أو تغلق أو تنقل أي تبويب.
3) استدعِ group_tabs مرة واحدة مع groups:[{title,color,tabIds},...]. اجعل الأسماء مختصرة والألوان من القائمة المتاحة.
4) التبويبات المثبتة (pinned:true) لا تُضمّن إلا إذا طلب المستخدم صراحةً ضم المثبتة — عندها includePinned:true. الافتراضي استثناؤها.
5) تجاوز التبويبات غير القابلة للتجميع (groupable:false) مثل chrome:// والإضافات؛ group_tabs يتخطاها ويعيدها في skippedUnsupported.
6) بعد النتيجة اذكر groupId لكل مجموعة وعدد التبويبات، وskippedPinned/skippedUnsupported. لا تقل "تم التجميع" بدون groupId من نتيجة الأداة.
7) لا تجمع تبويباً واحداً في كل نداء، ولا تعد list_tabs بعد كل مجموعة.`,
    params: [],
    steps: [],
    version: 1,
  },
];

export async function seedSkills() {
  const seeded = await getSeedRev();
  if (seeded >= SEED_VERSION) return;
  const existing = await getSkills();
  const toSave: SkillFile[] = [];
  for (const s of SEEDS) {
    const cur = existing[s.name];
    if (!cur) { toSave.push({ ...s, seedRev: SEED_VERSION }); continue; }
    if (cur.seedRev === -1 || cur.seedRev === SEED_VERSION) continue;
    toSave.push({ ...s, context: cur.context, params: cur.params, seedRev: SEED_VERSION });
  }
  if (toSave.length) await saveSkillsBulk(toSave);
  await setSeedRev(SEED_VERSION);
}
