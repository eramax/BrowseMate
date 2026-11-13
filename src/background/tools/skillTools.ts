// أدوات المهارات: run_skill / save_skill / list_skills / delete_skill
import { z } from 'zod';
import { register, getTool, allTools } from './registry';
import { runSkill, validateSkill, generalizeSteps } from '../skills';
import { chromeKV } from '../../shared/storage';
import type { SkillFile, SkillStep } from '../../shared/types';

const skillKV = {
  async all(): Promise<Record<string, SkillFile>> { return (await chromeKV.get('skills')) ?? {}; },
  async save(s: SkillFile) { const all = await this.all(); all[s.name] = s; await chromeKV.set('skills', all); },
  async remove(name: string) { const all = await this.all(); delete all[name]; await chromeKV.set('skills', all); },
};

register({
  name: 'run_skill',
  description: 'ينفذ مهارة محفوظة بالاسم مع معاملاتها ويعيد نتائج كل الخطوات. استخدم list_skills أولاً إن لم تكن متأكدًا من الاسم.',
  sensitive: false, // بوابة الدفعة المدمجة أدناه هي المعتمدة (المواصفة §4)
  schema: z.object({
    name: z.string(),
    params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  }),
  execute: async (a, ctx) => {
    const skill = (await skillKV.all())[a.name];
    if (!skill) return { error: `مهارة غير موجودة: ${a.name}` };
    // موافقة مجمعة واحدة على كل الخطوات — تُتخطى في وضع "بدون سؤال"
    const planSteps = skill.steps.map((s) => (s.approval === true ? `${s.tool} ⚠` : s.tool));
    if (ctx.approvalMode !== 'never') {
      const ok = await ctx.requestApproval(`run_skill:${a.name}`, { params: a.params ?? {} }, planSteps);
      if (!ok) return { error: 'REFUSED_BY_USER', message: 'ألغى المستخدم' };
    }
    return {
      skill: { name: skill.name, description: skill.description, whenToUse: skill.whenToUse, site: skill.site, notes: skill.notes, params: skill.params },
      ...(await runSkill(skill, a.params ?? {}, {
        getTool,
        emit: (evt) => ctx.emit(evt as any),
        isSensitive: (t) => allTools().find((x) => x.name === t)?.sensitive ?? false,
        requestApproval: async () => true, // الدفعة تغطي الخطوات
        signal: ctx.signal,
      })),
      planSteps,
    };
  },
});

register({
  name: 'save_skill',
  description:
    'يحفظ مهارة JSON مخصّصة بخطوات محددة. المهارة ليست مجرد أدوات: يجب وصف المشكلة (whenToUse) والموقع (site) وملاحظات القيود (notes)، وتعريف المعاملات بدل تثبيت قيم موقع معين. استخدم {{param}} داخل النصوص.',
  sensitive: false,
  schema: z.object({
    name: z.string().describe('اسم المهارة (يمكن أن يكون عربياً)'),
    description: z.string().describe('وصف مختصر لما تفعله'),
    whenToUse: z.string().optional().describe('المشكلة/الحالة التي تُستخدم فيها المهارة'),
    site: z.string().optional().describe('الموقع أو النطاق المرتبط (مثال: github.com)'),
    notes: z.string().optional().describe('قيود أو تحذيرات أو خطوات يدوية'),
    params: z.array(z.object({
      name: z.string().describe('اسم المعامل بلا مسافات'),
      type: z.enum(['string', 'number']),
      required: z.boolean().optional(),
      description: z.string().optional(),
      example: z.string().optional(),
    })).optional(),
    steps: z.array(z.object({
      tool: z.string().describe('اسم أداة موجودة'),
      args: z.record(z.string(), z.any()).optional().describe('وسائط الأداة، ويمكن استخدام {{param}}'),
      approval: z.boolean().optional(),
      note: z.string().optional(),
    })).min(1),
  }),
  execute: async (a) => {
    const skill: SkillFile = {
      name: String(a.name ?? '').trim(),
      description: String(a.description ?? '').trim(),
      whenToUse: a.whenToUse?.trim() || undefined,
      site: a.site?.trim() || undefined,
      notes: a.notes?.trim() || undefined,
      params: a.params ?? [],
      steps: (a.steps ?? []).map((s: any) => ({ tool: s.tool, args: s.args ?? {}, approval: s.approval, note: s.note })),
      version: 1,
    };
    const unknown = skill.steps.filter((s) => !getTool(s.tool));
    if (unknown.length) return { error: `أدوات غير معروفة: ${unknown.map((s) => s.tool).join(', ')}` };
    const err = validateSkill(skill);
    if (err) return { error: err };
    await skillKV.save(skill);
    return { saved: skill.name, steps: skill.steps.length, params: skill.params.length, visibleInSkillsTab: true };
  },
});

register({
  name: 'save_skill_from_run',
  description:
    'يحفظ المهارة من الأدوات التي نُفّذت فعلاً، مع تعميمها: مرّر replacements لتحويل القيم المحددة (رابط مستودع، كلمة بحث، مدينة…) إلى معاملات {{param}}، وعرّف كل معامل في params مع وصفه ومثاله. أضف whenToUse (المشكلة) وsite (الموقع) وnotes (القيود). استدعها فوراً عندما يقول المستخدم "احفظ هذا/الخطوات كمهارة" — بدون تأكيد إضافي.',
  sensitive: false,
  schema: z.object({
    name: z.string().describe('اسم المهارة (يمكن أن يكون عربياً)'),
    description: z.string().optional(),
    whenToUse: z.string().optional().describe('المشكلة التي تحلها المهارة'),
    site: z.string().optional().describe('الموقع/النطاق إن كانت خاصة بموقع'),
    notes: z.string().optional().describe('قيود/تحذيرات'),
    params: z.array(z.object({
      name: z.string(),
      type: z.enum(['string', 'number']),
      required: z.boolean().optional(),
      description: z.string().optional(),
      example: z.string().optional(),
    })).optional(),
    replacements: z.array(z.object({
      param: z.string().describe('اسم المعامل'),
      value: z.string().describe('القيمة الفعلية التي ظهرت في التشغيل'),
    })).optional().describe('تحويل القيم المحددة إلى {{param}}'),
  }),
  execute: async (a, ctx) => {
    const META = new Set(['save_skill', 'save_skill_from_run', 'list_skills', 'run_skill', 'delete_skill']);
    const current = ctx.getToolLog?.() ?? [];
    const fallback = current.some((t) => t.status === 'ok') ? [] : (await ctx.getSessionToolLog?.()) ?? [];
    const usable = [...current, ...fallback].filter((t) => !META.has(t.name) && t.status === 'ok');
    if (!usable.length) return { error: 'لا توجد أدوات ناجحة في هذا التشغيل — نفّذ الإجراء أولاً ثم احفظه.' };

    const rawSteps: SkillStep[] = usable.map((t) => ({
      tool: t.name,
      args: (t.args && typeof t.args === 'object' ? t.args : {}) as Record<string, unknown>,
    }));
    const steps = generalizeSteps(rawSteps, a.replacements ?? []);
    const skill: SkillFile = {
      name: String(a.name ?? '').trim(),
      description: String(a.description ?? '').trim() || `مهارة من ${steps.length} خطوة`,
      whenToUse: a.whenToUse?.trim() || undefined,
      site: a.site?.trim() || undefined,
      notes: a.notes?.trim() || undefined,
      params: a.params ?? (a.replacements ?? []).map((r: { param: string }) => ({ name: r.param, type: 'string' as const, required: true })),
      steps,
      version: 1,
    };
    const err = validateSkill(skill);
    if (err) return { error: err };
    await skillKV.save(skill);
    const generalized = steps.reduce((n, s) => n + (JSON.stringify(s.args).match(/\{\{/g)?.length ?? 0), 0);
    return { saved: skill.name, steps: steps.length, params: skill.params.length, placeholders: generalized, visibleInSkillsTab: true };
  },
});

register({
  name: 'list_skills',
  description: 'يسرد المهارات المحفوظة (اسم، وصف، معاملات).',
  sensitive: false,
  schema: z.object({}),
  execute: async () =>
    Object.values(await skillKV.all()).map((s) => ({ name: s.name, description: s.description, params: s.params })),
});

register({
  name: 'delete_skill',
  description: 'يحذف مهارة محفوظة بالاسم.',
  sensitive: true,
  schema: z.object({ name: z.string() }),
  execute: async (a) => { await skillKV.remove(a.name); return { deleted: a.name }; },
});

export { skillKV };
