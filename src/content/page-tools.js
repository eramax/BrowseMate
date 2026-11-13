// أدوات الصفحة داخل سياق الصفحة: قراءة/ملء/نقر — ملف JS صافٍ (يُحقن بأمان حتى خاماً)
// كل عنصر تفاعلي يحصل على معرف ta-N حتى تعيد الوكيل استخدامه في fill/click
(function () {
  if ((window).__browseMateLoaded) return;
  (window).__browseMateLoaded = true;

  var registry = new Map();
  var nextId = 1;

  function labelOf(el) {
    var aria = el.getAttribute('aria-label');
    if (aria) return aria;
    if (el.id) {
      var l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l) return (l.textContent || '').trim();
    }
    var inner = el.closest('label');
    if (inner) return (inner.textContent || '').trim();
    var ph = el.placeholder;
    if (ph) return ph;
    return (el.textContent || '').trim().slice(0, 60);
  }

  function collectInteractive() {
    var out = [];
    document.querySelectorAll('input, textarea, select, button, a[href], [role="button"]').forEach(function (el) {
      if (!el.offsetParent && el.tagName !== 'A') return; // تخطي المخفي
      var kind =
        el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ? 'input'
        : (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') ? 'button' : 'link';
      var id = 'ta-' + nextId++;
      el.setAttribute('data-ta-id', id);
      registry.set(id, el);
      out.push({
        id: id,
        tag: el.tagName.toLowerCase(),
        kind: kind,
        label: labelOf(el),
        placeholder: el.placeholder || undefined,
        value: el.value || undefined,
      });
    });
    return out.slice(0, 200);
  }

  async function ytTranscript() {
    var vid = new URL(location.href).searchParams.get('v');
    var titleEl = document.querySelector('h1 yt-formatted-string, h1.title');
    var title = titleEl ? titleEl.textContent.trim() : document.title;
    var join = function (segs) { return segs.join(' ').replace(/\s+/g, ' ').trim().slice(0, 20000); };
    var SEG_SEL = 'transcript-segment-view-model, ytd-transcript-segment-renderer';
    function readSegs() {
      var seen = {};
      var out = [];
      document.querySelectorAll(SEG_SEL).forEach(function (e) {
        var t = e.querySelector('span[role="text"], #segment-text, .segment-text');
        var txt = t ? t.textContent.trim() : '';
        if (txt && !seen[txt]) { seen[txt] = 1; out.push(txt); }
      });
      return out;
    }

    // لوحة النص في الواجهة (المسار المعتمد في 2026 — player response لم يعد متاحاً)
    var segs = readSegs();
    if (!segs.length) {
      // فكّ طي الوصف — اختر الزر المرئي فقط (يوجد "...more" مخفي أولاً)
      var expand = Array.prototype.filter.call(
        document.querySelectorAll('#expand, tp-yt-paper-button#expand, ytd-text-inline-expander #expand'),
        function (x) { return x.offsetParent !== null; }
      ).find(function (x) { return /more|المزيد|إظهار/i.test(x.textContent || ''); });
      if (expand) {
        expand.click();
        await new Promise(function (r) { setTimeout(r, 600); });
      }

      // قد يظهر زر النص بتأخير بعد فتح الوصف — انتظر ظهوره
      function findBtn() {
        return Array.prototype.slice.call(document.querySelectorAll('button, tp-yt-paper-button'))
          .filter(function (x) { return x.offsetParent !== null; })
          .find(function (x) {
            var label = (x.getAttribute('aria-label') || '') + ' ' + (x.textContent || '');
            return !/close|إغلاق|أغلق/i.test(label)
              && /show transcript|transcript|إظهار النص|عرض النص|نص الفيديو|نسخ النص/i.test(label);
          });
      }
      var btn = findBtn();
      for (var t = 0; t < 12 && !btn; t++) {
        await new Promise(function (r) { setTimeout(r, 250); });
        btn = findBtn();
      }
      if (!btn) {
        return { error: 'NO_TRANSCRIPT', message: 'لم أجد زر "إظهار النص" — قد لا توجد ترجمة لهذا الفيديو' };
      }
      btn.click();

      for (var i = 0; i < 40; i++) {
        await new Promise(function (r) { setTimeout(r, 250); });
        segs = readSegs();
        if (segs.length) break;
      }
    }

    // بعض الفيديوهات الطويلة تُحمّل المقاطع تدريجياً — مرّر اللوحة حتى النهاية واجمع
    if (segs.length) {
      var panel = document.querySelector('ytd-engagement-panel-section-list-renderer[target-id*="transcript"]')
        || document.querySelector('ytd-transcript-renderer');
      var sc = null;
      if (panel) {
        sc = Array.prototype.find.call(panel.querySelectorAll('*'), function (e) {
          return e.scrollHeight > e.clientHeight + 40 && e.clientHeight > 80;
        }) || panel;
      }
      var last = segs.length;
      for (var s = 0; sc && s < 25; s++) {
        sc.scrollTop = sc.scrollHeight;
        await new Promise(function (r) { setTimeout(r, 220); });
        segs = readSegs();
        if (segs.length === last) break;
        last = segs.length;
      }
    }

    if (!segs.length) {
      return { error: 'NO_TRANSCRIPT', message: 'لوحة النص فُتحت لكن لم تُقرأ أي مقاطع — الفيديو قد لا يحتوي ترجمة' };
    }
    return { videoId: vid, title: title, lang: 'panel', source: 'panel', segments: segs, text: join(segs) };
  }

  chrome.runtime.onMessage.addListener(function (msg, _s, send) {
    if (!msg || msg.__ta !== 'page-tools') return;
    (async function () {
      if (msg.op === 'ping') { send({ ok: true }); return; }
      if (msg.op === 'yt_transcript') {
        if (!/(^|\.)youtube\.com$/.test(location.hostname)) {
          send({ ok: false, error: 'NOT_YOUTUBE', message: 'التبويب النشط ليس يوتيوب' }); return;
        }
        var tr = await ytTranscript();
        if (tr.error) send({ ok: false, error: tr.error, message: tr.message });
        else send({ ok: true, data: tr });
        return;
      }
      if (msg.op === 'read') {
        var text = document.body.innerText.replace(/\n{3,}/g, '\n\n').slice(0, 6000);
        send({ ok: true, data: { title: document.title, url: location.href, text: text, elements: collectInteractive() } });
        return;
      }
      if (msg.op === 'fill') {
        for (var _i = 0, _a = msg.values; _i < _a.length; _i++) {
          var v = _a[_i];
          var el = registry.get(v.id);
          if (!el) { send({ ok: false, error: 'element ' + v.id + ' not found (re-read the page)' }); return; }
          el.focus();
          // native setter — يعمل مع حقول React/Vue المتحكَّم بها
          var proto = Object.getPrototypeOf(el);
          var desc = Object.getOwnPropertyDescriptor(proto, 'value');
          if (desc && desc.set) desc.set.call(el, v.value); else el.value = v.value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.blur();
        }
        send({ ok: true, data: { filled: msg.values.length } });
        return;
      }
      if (msg.op === 'click') {
        var target = msg.id
          ? registry.get(msg.id)
          : Array.from(document.querySelectorAll('button, a[href], [role="button"]'))
              .find(function (e) { return ((e.textContent || '').trim() || e.getAttribute('aria-label') || '').includes(msg.label); });
        if (!target) { send({ ok: false, error: 'element not found (re-read the page)' }); return; }
        target.scrollIntoView({ block: 'center' });
        target.click();
        send({ ok: true, data: { clicked: true } });
      }
    })();
    return true; // رد غير متزامن
  });
})();
