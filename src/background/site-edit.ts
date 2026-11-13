// تطبيق تعديلات diff (oldText → newText) على HTML — كل التعديلات أو لا شيء
export interface Edit { oldText: string; newText: string; all?: boolean }

export type EditResult =
  | { ok: true; html: string; applied: number }
  | { ok: false; error: string; failedIndex: number };

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
      return {
        ok: false,
        failedIndex: i,
        error: `تعديل ${i + 1}: لم أجد oldText في الملف. اقرأ الملف أولاً (site_read أو ws_read) واستخدم نصاً مطابقاً حرفياً (بما فيه المسافات).`,
      };
    }
    if (count > 1 && !e.all) {
      return {
        ok: false,
        failedIndex: i,
        error: `تعديل ${i + 1}: oldText يتكرر ${count} مرات. أضف سياقاً أكبر ليكون فريداً أو مرر all:true.`,
      };
    }
    cur = e.all ? cur.split(e.oldText).join(e.newText) : cur.replace(e.oldText, e.newText);
  }
  return { ok: true, html: cur, applied: edits.length };
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
  if (count === 0)
    return {
      ok: false,
      failedIndex: 0,
      error: 'لم أجد oldString في الملف. اقرأ الملف بـ ws_read (أو site_read) واستخدم نصاً مطابقاً حرفياً بما فيه المسافات.',
    };
  if (count > 1 && !replaceAll)
    return {
      ok: false,
      failedIndex: 0,
      error: `oldString يتكرر ${count} مرات. أضف سياقاً أكبر ليكون فريداً أو استخدم replaceAll:true.`,
    };
  return {
    ok: true,
    html: replaceAll ? text.split(oldString).join(newString) : text.replace(oldString, newString),
    applied: 1,
  };
}
