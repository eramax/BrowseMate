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

    // 1) مسارات الترجمة من player response (بدون مفاتيح)
    var tracks = null;
    try { tracks = window.ytInitialPlayerResponse && window.ytInitialPlayerResponse.captions
      && window.ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer
      && window.ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer.captionTracks; } catch (e) {}
    if (!tracks) {
      try {
        var pl = document.querySelector('#movie_player');
        var pr = pl && pl.getPlayerResponse && pl.getPlayerResponse();
        tracks = pr && pr.captions && pr.captions.playerCaptionsTracklistRenderer && pr.captions.playerCaptionsTracklistRenderer.captionTracks;
      } catch (e) {}
    }
    if (tracks && tracks.length) {
      // الترجمة الأصلية أولاً (لغة الصوت) — لا تفضّل العربية إن كان الفيديو إنجليزياً
      var manual = tracks.filter(function (t) { return t.kind !== 'asr'; });
      var asr = tracks.filter(function (t) { return t.kind === 'asr'; });
      var pick = manual[0] || asr[0] || tracks[0];
      try {
        var res = await fetch(pick.baseUrl + '&fmt=json3', { credentials: 'include' });
        if (res.ok) {
          var data = await res.json();
          var segs = (data.events || []).map(function (ev) {
            return (ev.segs || []).map(function (s) { return s.utf8 || ''; }).join('');
          }).filter(Boolean);
          if (segs.length) {
            return { videoId: vid, title: title, lang: pick.languageCode, source: 'captions', segments: segs, text: join(segs) };
          }
        }
      } catch (e) {}
    }

    // 2) لوحة النص في الواجهة (احتياطي موثوق)
    var expand = Array.prototype.find.call(
      document.querySelectorAll('#expand, tp-yt-paper-button#expand, ytd-text-inline-expander #expand'),
      function (x) { return /more|المزيد|إظهار/i.test(x.textContent || ''); });
    if (expand) expand.click();
    await new Promise(function (r) { setTimeout(r, 400); });
    var all = Array.prototype.slice.call(document.querySelectorAll('button, tp-yt-paper-button, ytd-button-renderer'));
    var btn = all.find(function (x) {
      return /transcript|النص|نص الفيديو|إظهار النص|عرض النص/i.test((x.getAttribute('aria-label') || '') + ' ' + (x.textContent || ''));
    });
    if (btn) btn.click();
    for (var i = 0; i < 25; i++) {
      var els = document.querySelectorAll('ytd-transcript-segment-renderer');
      if (els.length) {
        var segs2 = Array.prototype.map.call(els, function (e) {
          var t = e.querySelector('#segment-text, .segment-text');
          return t ? t.textContent.trim() : '';
        }).filter(Boolean);
        if (segs2.length) {
          return { videoId: vid, title: title, lang: 'panel', source: 'panel', segments: segs2, text: join(segs2) };
        }
      }
      await new Promise(function (r) { setTimeout(r, 200); });
    }
    return { error: 'NO_TRANSCRIPT', message: 'لا توجد ترجمة متاحة أو تعذر فتح لوحة النص لهذا الفيديو' };
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
