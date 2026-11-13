// فحص صياغة JavaScript المضمّن قبل المعاينة — يمنع صفحات "تعمل شكلياً" لكن أزرارها لا تعمل.
// الأرقام المعروضة هي أرقام أسطر داخل ملف HTML الكامل (لا داخل <script>) حتى يستطيع edit/ws_patch
// إصلاح السطر الصحيح مباشرة، مع عرض السطر المكسور نفسه وتلميح للخطأ الشائع.
import { parse } from 'acorn';

export interface JsSyntaxIssue {
  script: number;
  message: string;
  /** سطر 1-based داخل ملف HTML الكامل */
  line: number;
  /** عمود 1-based */
  column: number;
  /** نص السطر المكسور كما هو في HTML */
  source: string;
  hint?: string;
}

export function checkInlineScriptsDetailed(html: string): JsSyntaxIssue[] {
  const issues: JsSyntaxIssue[] = [];
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
      const relLine = Number(e?.loc?.line ?? 1);
      const column = Number(e?.loc?.column ?? 0) + 1;

      // موضع أول حرف من محتوى السكربت داخل HTML، ثم عدد الأسطر قبله.
      const codeStart = m.index + m[0].indexOf(code);
      const lineOffset = (html.slice(0, codeStart).match(/\n/g) ?? []).length;
      const line = lineOffset + relLine;
      const source = html.split('\n')[line - 1] ?? code.split('\n')[relLine - 1] ?? '';

      issues.push({
        script: idx,
        message: String(e?.message ?? 'syntax error'),
        line,
        column,
        source,
        hint: hintFor(source),
      });
    }
  }

  return issues;
}

/** واجهة متوافقة: نصوص جاهزة للعرض في نتيجة الأداة */
export function checkInlineScripts(html: string): string[] {
  return checkInlineScriptsDetailed(html).map(formatIssue);
}

function hintFor(source: string): string | undefined {
  if (source.includes("'''")) {
    return "ثلاث علامات اقتباس مفردة — استخدم قيمة بين علامتي اقتباس مزدوجة مثل \"&#39;\"، أو أنشئ العناصر بـ textContent.";
  }
  if (/['"]&['"]\s*:\s*['"]&['"]/.test(source) || /['"]<['"]\s*:\s*['"]<['"]/.test(source)) {
    return 'خريطة escape تعيد نفس الحرف. الأفضل: احذف دالة escape واستخدم document.createElement + textContent لبيانات المستخدم، أو استبدل القيم بـ &amp; و &lt; و &gt; و &quot; و &#39;.';
  }
  return undefined;
}

function formatIssue(i: JsSyntaxIssue): string {
  const max = 320;
  const source = i.source.length > max ? `${i.source.slice(0, max)}…` : i.source;
  const col = Math.max(1, Math.min(i.column, source.length + 1));
  const before = source.slice(0, col - 1).replace(/\t/g, '  ');
  const lines = [
    `script #${i.script}: ${i.message} (HTML سطر ${i.line}:${i.column})`,
    `${String(i.line).padStart(4, ' ')} | ${source}`,
    `     | ${' '.repeat(before.length)}^`,
  ];
  if (i.hint) lines.push(`     | تلميح: ${i.hint}`);
  return lines.join('\n');
}
