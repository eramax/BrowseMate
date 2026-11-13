// أدوات المهارات: run_skill / save_skill / list_skills / delete_skill
import { z } from 'zod';
import { register, getTool, allTools } from './registry';
import { runSkill, validateSkill } from '../skills';
import { chromeKV } from '../../shared/storage';
import type { SkillFile } from '../../shared/types';

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
    'يحفظ مهارة JSON بعد التحقق. لا تقل للمستخدم أن المهارة حُفظت إلا بعد نجاح هذه الأداة. استخرج تسلسل الأدوات والوسائط من المحادثة إلى { name, description, params:[{name,type}], steps:[{tool,args,approval?}] } — وسائط ثابتة وقيم متغيرة كـ {{param}} داخل النصوص. name: حروف/أرقام/شرطة/مسافة (يمكن أن يكون عربياً). اعرض JSON للمستخدم للتأكيد قبل الاستدعاء.',
  sensitive: false,
  schema: z.object({
    skill: z.union([z.unknown(), z.string()]),
  }),
  execute: async (a) => {
    let raw = a.skill;
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch { return { error: 'skill ليست JSON صالحاً' }; }
    }
    if (!raw || typeof raw !== 'object') return { error: 'skill يجب أن تكون كائن JSON' };
    // تطبيع الاسم (مسافات مكررة/شرطات زائدة)
    const s: any = { ...raw };
    if (typeof s.name === 'string') s.name = s.name.trim().replace(/\s+/g, ' ');
    const err = validateSkill(s);
    if (err) return { error: err };
    const skill = s as SkillFile;
    await skillKV.save(skill);
    return { saved: skill.name, steps: skill.steps.length, visibleInSkillsTab: true };
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
