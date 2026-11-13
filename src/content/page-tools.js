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

  chrome.runtime.onMessage.addListener(function (msg, _s, send) {
    if (!msg || msg.__ta !== 'page-tools') return;
    (async function () {
      if (msg.op === 'ping') { send({ ok: true }); return; }
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
