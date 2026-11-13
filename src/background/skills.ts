// محرك تشغيل المهارات — حتمي: خطوات = أداة + وسائط + {{param}} (المواصفة §5)
import type { SkillFile } from '../shared/types';
import { substitute, type Params } from '../shared/template';

export function validateSkill(s: SkillFile): string | null {
  if (!s.name || !/^[a-z0-9-]+$/.test(s.name)) return 'name: kebab-case فقط';
  if (!Array.isArray(s.steps) || s.steps.length === 0) return 'steps: يجب أن تحتوي خطوة واحدة على الأقل';
  for (const p of s.params ?? [])
    if (!/^[a-zA-Z0-9_-]+$/.test(p.name)) return `param name غير صالح: ${p.name}`;
  return null;
}

export interface SkillRunDeps {
  getTool: (name: string) => { execute: (args: any, ctx: any) => Promise<unknown> } | undefined;
  emit: (evt: unknown) => void;
  isSensitive: (tool: string) => boolean;
  requestApproval: (tool: string, args: unknown, steps?: string[]) => Promise<boolean>;
  signal?: AbortSignal;
}

export type SkillRunResult =
  | { ok: true; results: RunResult[] }
  | { ok: false; error: string; results: RunResult[] };

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
