// مهارات مبدئية تُزرع مرة واحدة عند أول تشغيل — لا تعيد إضافة ما حذفه المستخدم
import { chromeKV } from '../shared/storage';
import type { SkillFile } from '../shared/types';

const SEED_VERSION = 1;

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
];

export async function seedSkills() {
  const seeded = (await chromeKV.get<number>('skillsSeeded')) ?? 0;
  if (seeded >= SEED_VERSION) return;
  const existing = (await chromeKV.get<Record<string, SkillFile>>('skills')) ?? {};
  for (const s of SEEDS) if (!existing[s.name]) existing[s.name] = s;
  await chromeKV.set('skills', existing);
  await chromeKV.set('skillsSeeded', SEED_VERSION);
}
