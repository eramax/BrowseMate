// صيغة SKILL.md القياسية (frontmatter + markdown) — تبادل مع أي وكيل/مهارات من الإنترنت
// JSON يبقى التمثيل الداخلي لأن محرك الخطوات يحتاجه؛ MD هو صيغة الاستيراد/التصدير.
import type { SkillFile } from './types';

export function toSkillMd(s: SkillFile): string {
  const fm: Record<string, unknown> = {
    name: s.name,
    description: s.description,
    whenToUse: s.whenToUse,
    site: s.site,
    notes: s.notes,
    params: s.params ?? [],
    steps: s.steps ?? [],
    version: s.version ?? 1,
  };
  if (s.seedRev !== undefined) fm.seedRev = s.seedRev;
  const lines = Object.entries(fm)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v)}`);
  const body = (s.instructions ?? '').trim();
  const ctx = s.context?.trim() ? `\n\n\`\`\`skill-context\n${s.context.trim()}\n\`\`\`` : '';
  return `---\n${lines.join('\n')}\n---\n\n${body}${ctx}\n`;
}

export function fromSkillMd(md: string): { skill?: SkillFile; error?: string } {
  const text = md.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
  if (!text.trimStart().startsWith('---')) return { error: 'ملف SKILL.md يجب أن يبدأ بـ ---' };
  const start = text.indexOf('---');
  const end = text.indexOf('\n---', start + 3);
  if (end < 0) return { error: 'frontmatter غير مغلق (---)' };
  const fmText = text.slice(start + 3, end).trim();
  let rest = text.slice(end + 4);

  const fm: Record<string, any> = {};
  for (const line of fmText.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    const raw = line.slice(i + 1).trim();
    try {
      fm[key] = raw.startsWith('"') || raw.startsWith('{') || raw.startsWith('[') ? JSON.parse(raw) : raw;
    } catch {
      fm[key] = raw.replace(/^"|"$/g, '');
    }
  }

  let context = '';
  const ctxMatch = rest.match(/```skill-context\n([\s\S]*?)\n```/);
  if (ctxMatch) {
    context = ctxMatch[1];
    rest = rest.replace(ctxMatch[0], '');
  }

  const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? undefined : String(v));
  const skill: SkillFile = {
    name: String(fm.name ?? '').trim(),
    description: String(fm.description ?? '').trim(),
    whenToUse: str(fm.whenToUse),
    site: str(fm.site),
    notes: str(fm.notes),
    params: Array.isArray(fm.params) ? fm.params : [],
    steps: Array.isArray(fm.steps) ? fm.steps : [],
    instructions: rest.trim() || undefined,
    context: context || undefined,
    version: typeof fm.version === 'number' ? fm.version : 1,
  };
  if (typeof fm.seedRev === 'number') skill.seedRev = fm.seedRev;
  return { skill };
}
