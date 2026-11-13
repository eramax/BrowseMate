// سجل الأدوات — تعريف بنمط MCP (name + description + JSON Schema + zod + handler)
// JSON Schema يُصدَّر للعرض/التصدير الخارجي لاحقاً (اتجاه mcp-chrome) دون إعادة بناء
import { z, toJSONSchema } from 'zod';
import type { ToolContext } from '../../shared/types';

export interface RegisteredTool {
  name: string;
  description: string;
  sensitive: boolean;
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

/** بناء أدوات AI SDK مع بوابة الموافقة للأدوات الحساسة + تخطيها عند تسليح الخطة المجمعة */
export function asAISDKTools(ctx: ToolContext, isPlanArmed: () => boolean): Record<string, any> {
  const out: Record<string, any> = {};
  for (const t of allTools()) {
    out[t.name] = {
      description: t.description,
      inputSchema: t.schema,
      execute: async (args: any) => {
        if (t.sensitive && !isPlanArmed()) {
          const ok = await ctx.requestApproval(t.name, args);
          if (!ok) return { error: 'REFUSED_BY_USER', message: 'المستخدم رفض هذا الإجراء الحساس — أعد التخطيط أو اسأل.' };
        }
        return t.execute(args, ctx);
      },
    };
  }
  return out;
}
