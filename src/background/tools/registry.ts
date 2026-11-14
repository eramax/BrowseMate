// سجل الأدوات — تعريف بنمط MCP (name + description + JSON Schema + zod + handler)
// JSON Schema يُصدَّر للعرض/التصدير الخارجي لاحقاً (اتجاه mcp-chrome) دون إعادة بناء
import { z, toJSONSchema } from 'zod';
import type { ToolContext } from '../../shared/types';

export interface RegisteredTool {
  name: string;
  description: string;
  sensitive: boolean;
  /** قراءة/معاينة: يسمح بتكرارها لأن حالة الملف قد تغيرت بين الاستدعاءين */
  idempotent?: boolean;
  schema: z.ZodTypeAny;
  jsonSchema: Record<string, unknown>;
  execute: (args: any, ctx: ToolContext) => Promise<unknown>;
}

const tools = new Map<string, RegisteredTool>();

export function register(t: Omit<RegisteredTool, 'jsonSchema'> & { jsonSchema?: Record<string, unknown> }) {
  tools.set(t.name, { ...t, jsonSchema: t.jsonSchema ?? (toJSONSchema(t.schema) as Record<string, unknown>) });
}
export const getTool = (name: string) => tools.get(name);
export const allTools = () => [...tools.values()];

/** بناء أدوات AI SDK — بوابة الموافقة تحترم وضع الصلاحيات + تسليح الخطة المجمعة */
export function asAISDKTools(ctx: ToolContext, isPlanArmed: () => boolean): Record<string, any> {
  const out: Record<string, any> = {};
  for (const t of allTools()) {
    out[t.name] = {
      description: t.description,
      inputSchema: t.schema,
      execute: async (args: any) => {
        const startedAt = Date.now();
        ctx.debug?.log('tool:start', { name: t.name, args });
        // حماية من الحلقات: نفس الأداة بنفس الوسائط مرتين = أوقف وأطلب تغيير النهج.
        // لا نطبقها على أدوات القراءة/المعاينة: تكرار ws_preview بعد تعديل ضروري
        // (وبدونه تبقى المعاينة على نسخة قديمة كما حدث فعلياً).
        if (!t.idempotent) {
          const key = t.name + ':' + stableStringify(args);
          const seen = ctx.seenCalls?.get(key) ?? 0;
          if (seen >= 1) {
            ctx.debug?.log('tool:blocked-repeat', { name: t.name, args, durationMs: Date.now() - startedAt }, 'warn');
            return {
              error: 'REPEATED_IDENTICAL_CALL',
              message: 'نفس الاستدعاء تكرر بنفس الوسائط — لا تعده. اقرأ الملف (ws_read أو site_read) ثم عدّل بـ edit، أو غيّر النهج/الوسائط.',
            };
          }
          ctx.seenCalls?.set(key, seen + 1);
        }
        if (ctx.callCount) {
          ctx.callCount.value++;
          if (ctx.callCount.value > 40) {
            ctx.debug?.log('tool:budget-exceeded', { name: t.name, args, count: ctx.callCount.value }, 'warn');
            return { error: 'TOOL_BUDGET_EXCEEDED', message: 'تجاوزت 40 استدعاء أداة في تشغيل واحد. توقف واكتب ملخصاً أو اطلب توجيهاً.' };
          }
        }
        const ask = ctx.approvalMode === 'always' || (ctx.approvalMode === 'sensitive' && t.sensitive);
        if (ask && !isPlanArmed()) {
          ctx.debug?.log('approval:request', { tool: t.name, args });
          const ok = await ctx.requestApproval(t.name, args);
          ctx.debug?.log('approval:result', { tool: t.name, approved: ok, durationMs: Date.now() - startedAt }, ok ? 'info' : 'warn');
          if (!ok) {
            ctx.debug?.log('tool:refused', { name: t.name, args, durationMs: Date.now() - startedAt }, 'warn');
            return { error: 'REFUSED_BY_USER', message: 'المستخدم رفض هذا الإجراء الحساس — أعد التخطيط أو اسأل.' };
          }
        }
        try {
          const out = await t.execute(args, ctx);
          ctx.debug?.log('tool:end', { name: t.name, durationMs: Date.now() - startedAt, result: out });
          return out;
        } catch (e) {
          ctx.debug?.log('tool:error', { name: t.name, durationMs: Date.now() - startedAt, error: e }, 'error');
          throw e;
        }
      },
    };
  }
  return out;
}


/** JSON مستقر لاستخدامه كمفتاح تكرار */
function stableStringify(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, val) =>
      val && typeof val === 'object' && !Array.isArray(val)
        ? Object.keys(val).sort().reduce((o: any, k) => ((o[k] = val[k]), o), {})
        : val,
    );
  } catch {
    return String(v);
  }
}
