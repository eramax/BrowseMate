// صفحة sandbox: تستقبل HTML من الصفحة الأب وتكتبه (inline scripts مسموحة هنا)
(function () {
  'use strict';
  parent.postMessage({ __bmSandboxReady: true }, '*');
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || !d.__bmRender || typeof d.html !== 'string') return;
    try {
      document.open();
      document.write(d.html);
      document.close();
    } catch (err) {
      parent.postMessage({ __bmSandboxError: String(err) }, '*');
    }
  });
})();
