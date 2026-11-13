// محرك استبدال {{param}} لملفات المهارات — نقي وقابل للاختبار (المواصفة §5)
export type ParamValue = { value: string | number; type?: 'string' | 'number' };
export type Params = Record<string, ParamValue>;

const VAR = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g;

export function substitute<T>(args: T, params: Params): T {
  return walk(args, params) as T;
}

function walk(v: unknown, params: Params): unknown {
  if (typeof v === 'string') {
    // قيمة كاملة متغير واحد بنوع رقم ⇒ تحوّل لرقم
    const m = v.trim().match(/^\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}$/);
    if (m && params[m[1]]?.type === 'number') return Number(params[m[1]].value);
    return v.replace(VAR, (_, name) => (params[name] ? String(params[name].value) : `{{${name}}}`));
  }
  if (Array.isArray(v)) return v.map((x) => walk(x, params));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val, params);
    return out;
  }
  return v;
}
