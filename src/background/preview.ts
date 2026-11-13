// فتح معاينة في تبويب data: (سكربتات الموقع تعمل) + مراسل أخطاء يحدّث عنوان التبويب
// لا جسر iframe: CSP يمنع تضمين صفحات الإضافة في data:. العنوان يقرأه preview_diagnostics.
import { saveArtifact, putArtifact } from './artifacts';
import { chromeKV } from '../shared/storage';

function reporterScript(): string {
  return `<script>(function(){
  try {
    var errs = [], warns = [];
    var MAX = 40;
    function enc(s){ try { return String(s).replace(/\\s+/g,' ').slice(0,140); } catch(e){ return ''; } }
    function paint(){
      var title = (errs.length ? ('[BM:err=' + errs.length + ',warn=' + warns.length + '] ' + errs[errs.length-1]) : (warns.length ? ('[BM:err=0,warn=' + warns.length + ']') : ''));
      if (title) { try { document.title = title; } catch(e){} }
      var el = document.getElementById('__bm_badge');
      if (!el && (errs.length || warns.length)) {
        el = document.createElement('div');
        el.id = '__bm_badge';
        el.style.cssText = 'position:fixed;z-index:2147483647;inset-inline-end:12px;bottom:12px;max-width:min(420px,80vw);' +
          'font:12px/1.5 system-ui;padding:8px 11px;border-radius:10px;color:#fff;background:#b3261e;' +
          'box-shadow:0 10px 30px rgba(0,0,0,.35);direction:rtl;cursor:pointer';
        el.onclick = function(){ el.dataset.open = el.dataset.open ? '' : '1'; render(); };
        (document.body || document.documentElement).appendChild(el);
      }
      render();
    }
    function render(){
      var el = document.getElementById('__bm_badge');
      if (!el) return;
      var msg = errs.length ? errs[errs.length-1] : (warns.length ? warns[warns.length-1] : '');
      el.style.background = errs.length ? '#b3261e' : '#8a6d1a';
      if (el.dataset.open) {
        el.innerHTML = '<b>أخطاء: ' + errs.length + ' — تحذيرات: ' + warns.length + '</b><br>' +
          errs.concat(warns).slice(-6).map(function(x){ return '• ' + enc(x); }).join('<br>');
      } else {
        el.textContent = (errs.length ? '⚠ ' + errs.length + ' خطأ' : '⚠ ' + warns.length + ' تحذير') + ' — انقر للتفاصيل';
      }
    }
    window.addEventListener('error', function(e){
      var m = (e.message || 'Script error') + ' @' + (e.lineno || 0) + ':' + (e.colno || 0);
      errs.push(enc(m)); if (errs.length > MAX) errs.shift(); paint();
    });
    window.addEventListener('unhandledrejection', function(e){
      errs.push('Unhandled: ' + enc(e.reason)); if (errs.length > MAX) errs.shift(); paint();
    });
    var ce = console.error;
    console.error = function(){
      try { errs.push(enc([].slice.call(arguments).join(' '))); if (errs.length > MAX) errs.shift(); paint(); } catch(e){}
      try { ce.apply(console, arguments); } catch(e){}
    };
    var cw = console.warn;
    console.warn = function(){
      try { warns.push(enc([].slice.call(arguments).join(' '))); if (warns.length > MAX) warns.shift(); paint(); } catch(e){}
      try { cw.apply(console, arguments); } catch(e){}
    };
    setInterval(function(){ if (errs.length || warns.length) paint(); }, 2000);
  } catch (e) {}
})();</script>`;
}

export interface PreviewResult {
  artifact: { id: string; filename: string; mime: string; sizeKb: number };
  tabId?: number;
  previewOpened: boolean;
  note: string;
}

export async function openPreview(html: string, filename: string, existingId?: string): Promise<PreviewResult> {
  const artifact = existingId
    ? await putArtifact(existingId, filename, html)
    : await saveArtifact(filename, html);
  await chromeKV
    .set('previewTab', { tabId: 0, artifactId: artifact.id, filename, updatedAt: Date.now() })
    .catch(() => {});

  // احقن المراسل أولاً (داخل <head>) ليلتقط أخطاء السكربتات قبل تنفيذها
  const withReporter = /<head[^>]*>/i.test(html)
    ? html.replace(/<head[^>]*>/i, (m) => m + reporterScript())
    : reporterScript() + html;
  const url = 'data:text/html;charset=utf-8,' + encodeURIComponent(withReporter);

  let tabId: number | undefined;
  let previewOpened = false;
  if (url.length < 1_800_000) {
    const tab = await chrome.tabs.create({ url, active: true });
    tabId = tab.id;
    previewOpened = true;
    await chromeKV.set('previewTab', { tabId, artifactId: artifact.id, filename, updatedAt: Date.now() }).catch(() => {});
  }
  return {
    artifact,
    tabId,
    previewOpened,
    note: previewOpened
      ? 'فُتحت المعاينة. استدعِ preview_diagnostics لقراءة عنوان التبويب وأخطاء console.'
      : 'الملف كبير للمعاينة المباشرة — استخدم زر التحميل.',
  };
}
