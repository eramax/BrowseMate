// أدوات مساحة العمل العامة — ملفات متعددة، كتابة/إلحاق/قراءة/باتش/معاينة/تنزيل ZIP.
// لا يوجد أي قالب تطبيق هنا: النموذج يكتب الملفات، والمنصة تتحقق وتعاين.
import { z } from 'zod';
import { register } from './registry';
import { openPreview } from '../preview';
import { applyEdits, editOnce, type Edit } from '../site-edit';
import { checkInlineScripts, checkInlineScriptsDetailed } from '../js-check';
import { workspace as ws, composeHtml, safePath } from '../workspace';
import { saveArtifact, saveBinaryArtifact } from '../artifacts';
import { createZip } from '../../shared/zip';
import type { ToolContext } from '../../shared/types';

function snapshot() {
  return ws.listFiles().then((files) => ({
    files,
    totalBytes: files.reduce((n, f) => n + f.bytes, 0),
  }));
}

function err(e: unknown) {
  return { error: e instanceof Error ? e.message : String(e) };
}

register({
  name: 'ws_list',
  description: 'يعرض ملفات مساحة العمل الحالية وأحجامها والملف الرئيسي (entry). استخدمه قبل التعديل أو المعاينة.',
  sensitive: false,
  schema: z.object({}),
  execute: async () => ({ entry: await ws.getEntry(), ...(await snapshot()) }),
});

register({
  name: 'ws_write',
  description:
    'ينشئ/يستبدل الملف الرئيسي index.html. اكتب الجزء الأول فقط، ثم أكمل بـ ws_append. النتيجة تعيد complete وtail حتى تعرف هل الملف مكتمل ومن أين تكمل.',
  sensitive: false,
  schema: z.object({
    path: z.string().describe('المسار (الافتراضي index.html)'),
    content: z.string().describe('الجزء الأول من الملف (للاستبدال)'),
  }),
  execute: async (a, ctx) => {
    try {
      const path = safePath(a.path);
      await ws.writeFile(path, a.content);
      ctx.lastPatchError?.delete(path);
      const complete = !path.endsWith('.html') || /<\/html>/i.test(a.content);
      const warnings: string[] = [];
      if (!complete)
        warnings.push('الملف غير مكتمل (لا ينتهي بـ </html>) — أكمل بـ ws_append من آخر نص في tail. لا تعد كتابة الملف كاملاً.');
      return {
        written: path,
        bytes: a.content.length,
        complete,
        tail: a.content.slice(-160),
        ...(await snapshot()),
        ...(warnings.length ? { warnings } : {}),
      };
    } catch (e) {
      return err(e);
    }
  },
});

register({
  name: 'ws_append',
  description:
    'يضيف الجزء التالي إلى نهاية index.html. استخدمه عندما يتوقف إخراج الملف الطويل. لا يكرر ما سبق؛ أرسل الجزء الجديد فقط. النتيجة تعيد complete وtail.',
  sensitive: false,
  schema: z.object({
    path: z.string().describe('المسار (index.html)'),
    content: z.string().describe('الجزء الإضافي فقط (ليس الملف كاملاً)'),
  }),
  execute: async (a, ctx) => {
    try {
      const path = safePath(a.path);
      await ws.appendFile(path, a.content);
      ctx.lastPatchError?.delete(path);
      const current = (await ws.readFile(path)) ?? '';
      const complete = !path.endsWith('.html') || /<\/html>/i.test(current);
      return {
        appended: path,
        added: a.content.length,
        bytes: current.length,
        complete,
        tail: current.slice(-160),
        ...(await snapshot()),
      };
    } catch (e) {
      return err(e);
    }
  },
});

register({
  name: 'ws_read',
  description: 'يقرأ ملفاً من مساحة العمل لرؤية النص الحرفي قبل تعديله بـ ws_patch. لا يعيد كتابة الملف.',
  sensitive: false,
  schema: z.object({ path: z.string().describe('مسار الملف') }),
  execute: async (a) => {
    try {
      const path = safePath(a.path);
      const content = await ws.readFile(path);
      if (content === undefined) return { error: `الملف غير موجود: ${path}`, ...(await snapshot()) };
      const limit = 90000;
      return {
        path,
        bytes: content.length,
        truncated: content.length > limit,
        complete: !path.endsWith('.html') || /<\/html>/i.test(content),
        tail: content.slice(-160),
        content: content.slice(0, limit),
      };
    } catch (e) {
      return err(e);
    }
  },
});

/** يكتب الملف بعد التعديل، ويفحص JS فوراً، ويمنع الحلقات التي لا تُحدث تقدماً. */
async function commitFile(path: string, next: string, ctx: ToolContext, applied: number) {
  await ws.writeFile(path, next);
  const complete = !path.endsWith('.html') || /<\/html>/i.test(next);

  if (path.endsWith('.html')) {
    const detailed = checkInlineScriptsDetailed(next);
    if (detailed.length) {
      const fingerprint = detailed.map((i) => `${i.script}:${i.message}`).join('|');
      const prev = ctx.lastPatchError?.get(path);
      ctx.lastPatchError?.set(path, fingerprint);
      const issues = checkInlineScripts(next);
      if (prev === fingerprint) {
        return {
          error: 'NO_PROGRESS',
          message:
            'نفس خطأ JavaScript تكرر بعد التعديل. توقف عن تعديل الحرف الواحد: احذف دالة escape واستخدم document.createElement + textContent لبيانات المستخدم، أو استبدل الدالة كاملة بالنمط الصحيح.',
          issues,
          complete,
          tail: next.slice(-160),
        };
      }
      return {
        error: 'JavaScript ما زال غير صالح بعد التعديل',
        issues,
        hint: 'أصلح سبب الخطأ كاملاً، لا الحرف فقط. إن كان الخطأ في دالة escape فاحذفها واستخدم textContent.',
        complete,
        tail: next.slice(-160),
      };
    }
    ctx.lastPatchError?.delete(path);
  }

  return {
    patched: path,
    applied,
    bytes: next.length,
    complete,
    tail: next.slice(-160),
  };
}

register({
  name: 'edit',
  description:
    'يعدّل ملفاً بتعديل دقيق (oldString → newString) — نفس نمط أداة edit في OpenCode وأغلب الوكلاء. اقرأ الملف بـ ws_read أولاً. يجب أن يطابق oldString النص حرفياً ويكون فريداً، أو استخدم replaceAll:true. هذه هي الأداة الأساسية للتعديل؛ لا تعد كتابة الملف كاملاً.',
  sensitive: false,
  schema: z.object({
    path: z.string().describe('مسار الملف'),
    oldString: z.string().describe('النص القديم بالحرف (مع سياق كافٍ ليكون فريداً)'),
    newString: z.string().describe('النص الجديد'),
    replaceAll: z.boolean().optional().describe('استبدل كل التكرارات'),
  }),
  execute: async (a, ctx) => {
    try {
      const path = safePath(a.path);
      const content = await ws.readFile(path);
      if (content === undefined) return { error: `الملف غير موجود: ${path}`, ...(await snapshot()) };
      const r = editOnce(content, a.oldString, a.newString, a.replaceAll);
      if (!r.ok) return { error: r.error, failedIndex: r.failedIndex, hint: 'اقرأ الملف بـ ws_read ثم أعد المحاولة بنص مطابق حرفياً.' };
      return await commitFile(path, r.html, ctx, 1);
    } catch (e) {
      return err(e);
    }
  },
});

register({
  name: 'ws_patch',
  description:
    'يعدّل ملفاً بعدة تعديلات diff في نداء واحد (oldText → newText). كل التعديلات تُطبق أو لا شيء. فضّل edit للتعديل المفرد؛ استخدم ws_patch فقط عندما تحتاج عدة تعديلات مستقلة.',
  sensitive: false,
  schema: z.object({
    path: z.string().describe('مسار الملف'),
    edits: z.array(z.object({
      oldText: z.string().describe('نص موجود حرفياً في الملف (مع سياق كافٍ ليكون فريداً)'),
      newText: z.string().describe('البديل الجديد'),
      all: z.boolean().optional().describe('استبدل كل التكرارات'),
    })).min(1),
  }),
  execute: async (a, ctx) => {
    try {
      const path = safePath(a.path);
      const content = await ws.readFile(path);
      if (content === undefined) return { error: `الملف غير موجود: ${path}`, ...(await snapshot()) };
      const r = applyEdits(content, a.edits as Edit[]);
      if (!r.ok) return { error: r.error, failedIndex: r.failedIndex, hint: 'اقرأ الملف بـ ws_read ثم أعد المحاولة بنص مطابق حرفياً.' };
      return await commitFile(path, r.html, ctx, r.applied);
    } catch (e) {
      return err(e);
    }
  },
});

register({
  name: 'ws_delete',
  description: 'يحذف ملفاً من مساحة العمل. إجراء هدّام — يطلب موافقة في الوضع الحساس.',
  sensitive: true,
  schema: z.object({ path: z.string().describe('مسار الملف') }),
  execute: async (a) => {
    try {
      const path = safePath(a.path);
      const content = await ws.readFile(path);
      if (content === undefined) return { error: `الملف غير موجود: ${path}`, ...(await snapshot()) };
      await ws.deleteFile(path);
      return { deleted: path, ...(await snapshot()) };
    } catch (e) {
      return err(e);
    }
  },
});

register({
  name: 'ws_preview',
  description:
    'يجمع الملفات المحلية (CSS/JS) داخل index.html ويعاين المشروع داخل الإضافة. استدعِه بعد كتابة الملفات، ثم preview_diagnostics لأخطاء console. إن كانت هناك ملفات مفقودة سيعيد قائمتها.',
  sensitive: false,
  schema: z.object({
    entry: z.string().optional().describe('الملف الرئيسي (افتراضياً index.html)'),
  }),
  execute: async (a) => {
    try {
      const entry = a.entry ? safePath(a.entry) : await ws.getEntry();
      const files = await ws.getFiles();
      if (!Object.keys(files).length) return { error: 'مساحة العمل فارغة — ابدأ بـ ws_write لملف index.html.' };
      const entryContent = files[entry];
      if (entry.endsWith('.html') && entryContent !== undefined && !/<\/html>/i.test(entryContent))
        return {
          error: 'الملف غير مكتمل — لا ينتهي بـ </html>. أكمل بـ ws_append من آخر نص في tail ثم أعد ws_preview.',
          complete: false,
          bytes: entryContent.length,
          tail: entryContent.slice(-160),
        };
      const composed = composeHtml(entry, files);
      if (composed.missing.length)
        return {
          error: `ملفات مفقودة: ${composed.missing.join(', ')} — اكتبها بـ ws_write أو أصلح المسارات.`,
          missing: composed.missing,
          ...(await snapshot()),
        };
      await ws.setEntry(entry);
      const result = await openPreview(composed.html, entry);
      return {
        ...result,
        entry,
        inlined: composed.inlined,
        ...(await snapshot()),
      };
    } catch (e) {
      return err(e);
    }
  },
});

register({
  name: 'ws_download',
  description:
    'يضيف زر تحميل في الشات: ملف HTML مباشر إذا كان المشروع ملفاً واحداً، أو ZIP إذا تعددت الملفات.',
  sensitive: false,
  schema: z.object({ filename: z.string().optional().describe('اسم الملف (اختياري)') }),
  execute: async (a) => {
    try {
      const files = await ws.getFiles();
      const entries = Object.entries(files);
      if (!entries.length) return { error: 'مساحة العمل فارغة — لا يوجد ما يُنزّل.' };
      if (entries.length === 1) {
        const [path, data] = entries[0];
        const artifact = await saveArtifact(a.filename || path, data, 'text/html');
        return { artifact, files: [path], bytes: data.length, format: 'html' };
      }
      const zip = createZip(entries.map(([path, data]) => ({ path, data })));
      const artifact = await saveBinaryArtifact(a.filename || 'project.zip', toBase64(zip), 'application/zip');
      return { artifact, files: entries.map(([path]) => path), bytes: zip.length, format: 'zip' };
    } catch (e) {
      return err(e);
    }
  },
});

register({
  name: 'ws_reset',
  description: 'يمسح كل ملفات مساحة العمل ويبدأ مشروعاً جديداً. إجراء هدّام — يطلب موافقة في الوضع الحساس.',
  sensitive: true,
  schema: z.object({}),
  execute: async () => {
    await ws.reset();
    return { reset: true, entry: await ws.getEntry(), files: [] };
  },
});

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
