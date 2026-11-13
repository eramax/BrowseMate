// تطبيق تعديلات diff (oldText → newText) على HTML — كل التعديلات أو لا شيء
export interface Edit { oldText: string; newText: string; all?: boolean }

export type EditResult =
  | { ok: true; html: string; applied: number }
  | { ok: false; error: string; failedIndex: number; nearby?: string };

/** مقتطف من الملف حول أول سطر في oldText — يساعد النموذج على نسخ النص الحرفي */
function nearby(text: string, oldText: string): string | undefined {
  const first = oldText
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  if (!first) return undefined;
  for (const len of [80, 40, 20, 12, 8, 4]) {
    const key = first.slice(0, len);
    if (key.length < 4) continue;
    const idx = text.indexOf(key);
    if (idx >= 0) {
      const start = Math.max(0, idx - 120);
      const end = Math.min(text.length, idx + Math.max(oldText.length, key.length) + 220);
      return text.slice(start, end);
    }
  }
  return undefined;
}

export function applyEdits(html: string, edits: Edit[]): EditResult {
  if (!Array.isArray(edits) || !edits.length) return { ok: false, error: 'لا توجد تعديلات', failedIndex: -1 };
  let cur = html;
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    if (!e || typeof e.oldText !== 'string' || !e.oldText) {
      return { ok: false, error: `تعديل ${i + 1}: oldText مطلوب`, failedIndex: i };
    }
    const count = cur.split(e.oldText).length - 1;
    if (count === 0) {
      const near = nearby(cur, e.oldText);
      return {
        ok: false,
        failedIndex: i,
        nearby: near,
        error: `تعديل ${i + 1}: لم أجد oldText في الملف. اقرأ الملف أولاً (ws_read) واستخدم نصاً مطابقاً حرفياً (بما فيه المسافات).${near ? ' راجع nearby.' : ''}`,
      };
    }
    if (count > 1 && !e.all) {
      return {
        ok: false,
        failedIndex: i,
        nearby: nearby(cur, e.oldText),
        error: `تعديل ${i + 1}: oldText يتكرر ${count} مرات. أضف سياقاً أكبر ليكون فريداً أو مرر all:true.`,
      };
    }
    cur = e.all ? cur.split(e.oldText).join(e.newText) : cur.replace(e.oldText, e.newText);
  }
  return { ok: true, html: cur, applied: edits.length };
}

export interface PartialEditResult {
  ok: boolean;
  html: string;
  applied: number;
  failed: Array<{ index: number; error: string; nearby?: string }>;
}

/**
 * يطبّق التعديلات بالتسلسل ويحتفظ بالناجح ويبلغ عن الفاشل.
 * مناسب للوكلاء: لا يضيّع 5 تعديلات صحيحة بسبب سادس خاطئ.
 */
export function applyEditsPartial(text: string, edits: Edit[]): PartialEditResult {
  let cur = text;
  let applied = 0;
  const failed: PartialEditResult['failed'] = [];
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    if (!e || typeof e.oldText !== 'string' || !e.oldText) {
      failed.push({ index: i, error: `تعديل ${i + 1}: oldText مطلوب` });
      continue;
    }
    const count = cur.split(e.oldText).length - 1;
    if (count === 0) {
      const near = nearby(cur, e.oldText);
      failed.push({
        index: i,
        nearby: near,
        error: `تعديل ${i + 1}: لم أجد oldText في الملف. اقرأ الملف بـ ws_read واستخدم نصاً مطابقاً حرفياً.${near ? ' راجع nearby.' : ''}`,
      });
      continue;
    }
    if (count > 1 && !e.all) {
      failed.push({ index: i, error: `تعديل ${i + 1}: oldText يتكرر ${count} مرات. أضف سياقاً أكبر أو all:true.` });
      continue;
    }
    cur = e.all ? cur.split(e.oldText).join(e.newText) : cur.replace(e.oldText, e.newText);
    applied++;
  }
  return { ok: failed.length === 0, html: cur, applied, failed };
}

/** أداة edit المفردة (oldString → newString) — نفس نمط OpenCode/وكلاء التحرير */
export function editOnce(
  text: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): EditResult {
  if (!oldString) return { ok: false, error: 'oldString مطلوب', failedIndex: 0 };
  if (oldString === newString) return { ok: false, error: 'oldString وnewString متطابقان — لا يوجد تغيير', failedIndex: 0 };
  const count = text.split(oldString).length - 1;
  if (count === 0) {
    const near = nearby(text, oldString);
    return {
      ok: false,
      failedIndex: 0,
      nearby: near,
      error: `لم أجد oldString في الملف. اقرأ الملف بـ ws_read واستخدم نصاً مطابقاً حرفياً بما فيه المسافات.${near ? ' راجع nearby.' : ''}`,
    };
  }
  if (count > 1 && !replaceAll)
    return {
      ok: false,
      failedIndex: 0,
      nearby: nearby(text, oldString),
      error: `oldString يتكرر ${count} مرات. أضف سياقاً أكبر ليكون فريداً أو استخدم replaceAll:true.`,
    };
  return {
    ok: true,
    html: replaceAll ? text.split(oldString).join(newString) : text.replace(oldString, newString),
    applied: 1,
  };
}
