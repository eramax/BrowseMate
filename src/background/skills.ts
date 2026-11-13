// محرك تشغيل المهارات — حتمي: خطوات = أداة + وسائط + {{param}} (المواصفة §5)
import type { SkillFile, SkillStep } from '../shared/types';
import { substitute, type Params } from '../shared/template';

export function validateSkill(s: SkillFile): string | null {
  if (!s.name || !/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u.test(s.name) || s.name.length > 60)
    return 'name: حروف/أرقام/شرطة/مسافة فقط (حتى 60 حرفاً)';
  if (!s.description || s.description.trim().length < 3) return 'description: مطلوب (3 أحرف على الأقل)';
  if (!Array.isArray(s.steps) || s.steps.length === 0) return 'steps: يجب أن تحتوي خطوة واحدة على الأقل';
  for (const p of s.params ?? [])
    if (!/^[a-zA-Z0-9_-]+$/.test(p.name)) return `param name غير صالح: ${p.name}`;
  return null;
}

/** تعميم مهارة: استبدال قيم محددة (موقع/رابط/كلمة بحث) بمعاملات {{param}} */
export function generalizeSteps(
  steps: SkillStep[],
  replacements: Array<{ param: string; value: string }>,
): SkillStep[] {
  // الأطول أولاً حتى لا يُستبدل جزء من قيمة أطول
  const reps = replacements
    .filter((r) => r.param && r.value && r.value.length >= 2)
    .sort((a, b) => b.value.length - a.value.length);
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      let s = v;
      for (const r of reps) s = s.split(r.value).join(`{{${r.param}}}`);
      return s;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return steps.map((st) => ({ ...st, args: walk(st.args) as Record<string, unknown> }));
}

/** بناء مهارة حتمية من tool calls رسالة فعلية — بديل لا يعتمد على كلام النموذج */
export function buildSkillFromToolCalls(
  name: string,
  description: string,
  toolCalls: Array<{ name: string; args: unknown; status?: string }>,
): SkillFile | { error: string } {
  const META = new Set(['save_skill', 'list_skills', 'run_skill', 'delete_skill']);
  const usable = toolCalls.filter((t) => !META.has(t.name) && (t.status ?? 'ok') === 'ok');
  if (!usable.length) return { error: 'لا توجد أدوات ناجحة قابلة للتحويل إلى مهارة' };
  const steps = usable.map((t) => ({
    tool: t.name,
    args: (t.args && typeof t.args === 'object' ? t.args : {}) as Record<string, unknown>,
  }));
  const skill: SkillFile = { name: name.trim(), description: description.trim() || `مهارة من ${usable.length} خطوة`, params: [], steps };
  const err = validateSkill(skill);
  return err ? { error: err } : skill;
}

export interface SkillRunDeps {
  getTool: (name: string) => { execute: (args: any, ctx: any) => Promise<unknown> } | undefined;
  emit: (evt: unknown) => void;
  isSensitive: (tool: string) => boolean;
  requestApproval: (tool: string, args: unknown, steps?: string[]) => Promise<boolean>;
  signal?: AbortSignal;
}

export type SkillRunResult = {
  ok: boolean;
  error?: string;
  results: RunResult[];
};

interface RunResult {
  step: number;
  tool: string;
  args: unknown;
  result?: unknown;
  ts: number;
}

export async function runSkill(skill: SkillFile, params: Record<string, unknown>, deps: SkillRunDeps): Promise<SkillRunResult> {
  const missing = (skill.params ?? []).filter((p) => p.required && !(p.name in params));
  if (missing.length)
    return { ok: false, error: `معاملات ناقصة: ${missing.map((m) => m.name).join(', ')}`, results: [] };

  const typed: Params = {};
  for (const [k, v] of Object.entries(params))
    typed[k] = { value: v as string | number, type: skill.params?.find((p) => p.name === k)?.type };

  const results: RunResult[] = [];
  for (let i = 0; i < skill.steps.length; i++) {
    if (deps.signal?.aborted) return { ok: false, error: 'ألغى المستخدم', results };
    const step = skill.steps[i];
    const args = substitute(step.args, typed) as Record<string, unknown>;
    const tool = deps.getTool(step.tool);
    if (!tool) return { ok: false, error: `أداة غير معروفة في الخطوة ${i + 1}: ${step.tool}`, results };
    // بوابة الموافقة: دفعة المهارة تغطي الخطوات (المواصفة §4) — الدالة تُمرر إشارةً فقط
    if (deps.isSensitive(step.tool) || step.approval === true) {
      const ok = await deps.requestApproval(step.tool, args);
      if (!ok) return { ok: false, error: 'ألغى المستخدم', results };
    }
    deps.emit({ type: 'skill-progress', skill: skill.name, step: i + 1, total: skill.steps.length });
    try {
      const result = await tool.execute(args, {});
      results.push({ step: i, tool: step.tool, args, result, ts: Date.now() });
    } catch (e: any) {
      return { ok: false, error: e?.message ?? String(e), results }; // فشل خطوة يوقف المهارة (المواصفة §5)
    }
  }
  return { ok: true, results };
}
