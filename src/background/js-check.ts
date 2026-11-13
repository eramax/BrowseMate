// فحص صياغة JavaScript المضمّن قبل المعاينة — يمنع صفحات "تعمل شكلياً" لكن أزرارها لا تعمل
import { parse } from 'acorn';

export function checkInlineScripts(html: string): string[] {
  const errors: string[] = [];
  const re = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(html))) {
    idx++;
    const attrs = m[1] ?? '';
    const code = m[2] ?? '';
    if (!code.trim()) continue;
    const isModule = /type\s*=\s*["']module["']/i.test(attrs);
    try {
      parse(code, {
        ecmaVersion: 'latest',
        sourceType: isModule ? 'module' : 'script',
        allowAwaitOutsideFunction: true,
        allowReturnOutsideFunction: true,
      });
    } catch (e: any) {
      const loc = e?.loc ? ` (سطر ${e.loc.line}:${e.loc.column})` : '';
      errors.push(`script #${idx}: ${e?.message ?? 'syntax error'}${loc}`);
    }
  }
  return errors;
}
