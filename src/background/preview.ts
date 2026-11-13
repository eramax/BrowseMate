// فتح معاينة داخل صفحة الإضافة (preview.html + sandbox page) — سكربتات الموقع تعمل،
// والتقاط console يتم عبر postMessage إلى صفحة الإضافة. لا data: في المسار الافتراضي.
import { saveArtifact, putArtifact } from './artifacts';
import { chromeKV } from '../shared/storage';
import { repairHtml } from './html-check';
import { checkInlineScripts } from './js-check';

export interface PreviewResult {
  artifact: { id: string; filename: string; mime: string; sizeKb: number };
  tabId?: number;
  previewOpened: boolean;
  note: string;
  repairs?: string[];
  error?: string;
  issues?: string[];
}

export async function openPreview(html: string, filename: string, existingId?: string): Promise<PreviewResult> {
  // إصلاح الوسوم المكسورة قبل أي معاينة (يمنع الصفحات البيضاء)
  const fixed = repairHtml(html);
  const normalized = fixed.fatal.length ? html : fixed.html;

  // الحفظ أولاً دائماً — أي HTML يرسله النموذج يجب أن يُسجَّل كملف قابل للتحميل/التحرير
  const artifact = existingId
    ? await putArtifact(existingId, filename, normalized)
    : await saveArtifact(filename, normalized);

  if (fixed.fatal.length) {
    return {
      artifact,
      previewOpened: false,
      error: 'HTML غير صالح — حُفظ الملف لكن لم تُفتح المعاينة',
      issues: fixed.fatal,
      repairs: fixed.repairs,
      note: 'أصلح HTML (خصوصاً <title> و<body>) عبر ws_read/ws_patch أو site_read/site_edit ثم أعد المحاولة.',
    };
  }
  html = fixed.html;

  const jsErrors = checkInlineScripts(html);
  if (jsErrors.length) {
    return {
      artifact,
      previewOpened: false,
      error: 'JavaScript غير صالح — حُفظ الملف لكن لم تُفتح المعاينة',
      issues: jsErrors,
      repairs: fixed.repairs.length ? fixed.repairs : undefined,
      note: 'استخدم ws_read (أو site_read) لقراءة الملف ثم ws_patch (أو site_edit) لإصلاح السطر المذكور.',
    };
  }
  await chromeKV
    .set('previewTab', { tabId: 0, artifactId: artifact.id, filename, updatedAt: Date.now() })
    .catch(() => {});

  // المعاينة داخل صفحة الإضافة (sandbox page) — ليست data:
  const pageUrl = chrome.runtime.getURL('preview.html') + '?id=' + encodeURIComponent(artifact.id);
  let tabId: number | undefined;
  let previewOpened = false;
  try {
    const tab = await chrome.tabs.create({ url: pageUrl, active: true });
    tabId = tab.id;
    previewOpened = true;
    await chromeKV.set('previewTab', { tabId, artifactId: artifact.id, filename, updatedAt: Date.now() }).catch(() => {});
  } catch {
    // fallback نادر: افتح HTML مباشرة لو تعذّر فتح صفحة الإضافة
    const url = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    if (url.length < 1_800_000) {
      const tab = await chrome.tabs.create({ url, active: true });
      tabId = tab.id;
      previewOpened = true;
    }
  }
  return {
    artifact,
    tabId,
    previewOpened,
    repairs: fixed.repairs.length ? fixed.repairs : undefined,
    note: previewOpened
      ? 'فُتحت المعاينة داخل الإضافة. استدعِ preview_diagnostics لقراءة أخطاء console.'
      : 'الملف كبير للمعاينة المباشرة — استخدم زر التحميل.',
  };
}
