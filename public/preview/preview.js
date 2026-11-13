// صفحة المعاينة (امتداد حقيقي): تحمّل HTML من التخزين وتمرره لصفحة sandbox.
// قالب المعاينة يتبع لغة الإضافة (settings.lang) واتجاهها، ويبقى داخل الامتداد.
(function () {
  'use strict';
  var id = new URLSearchParams(location.search).get('id') || '';
  var frame = document.getElementById('frame');
  var nameEl = document.getElementById('name');
  var statusEl = document.getElementById('status');
  var logs = [];
  var ready = false;
  var lang = 'en';

  function t(en, ar) { return lang === 'ar' ? ar : en; }

  function applyLang() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.title = t('Preview', 'معاينة') + ' — BrowseMate';
    document.getElementById('reload').textContent = t('Reload', 'إعادة تحميل');
    document.getElementById('download').textContent = t('Download', 'تنزيل');
    if (!nameEl.textContent || nameEl.textContent === 'Preview' || nameEl.textContent === 'معاينة')
      nameEl.textContent = t('Preview', 'معاينة');
    setStatus();
  }

  function sendLogs() {
    if (!id || !logs.length) return;
    var batch = logs.splice(0, 40);
    try { chrome.runtime.sendMessage({ type: 'preview-log', id: id, entries: batch }); } catch (e) {}
  }

  function setStatus() {
    var errs = 0, warns = 0;
    logs.forEach(function (l) { if (l.level === 'error') errs++; else if (l.level === 'warn') warns++; });
    if (errs) { statusEl.className = 'status err'; statusEl.textContent = '⚠ ' + errs + ' ' + t('error(s)', 'أخطاء'); }
    else if (warns) { statusEl.className = 'status warn'; statusEl.textContent = '⚠ ' + warns + ' ' + t('warning(s)', 'تحذيرات'); }
    else { statusEl.className = 'status'; statusEl.textContent = t('ready', 'جاهز'); }
  }

  var shim = '<script>(function(){try{' +
    'function shim(n){try{window[n].getItem("__p");return}catch(e){}' +
    'var m={};var a={getItem:function(k){return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null},' +
    'setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]},clear:function(){m={}},' +
    'key:function(i){var ks=Object.keys(m);return i>=0&&i<ks.length?ks[i]:null}};' +
    'Object.defineProperty(a,"length",{get:function(){return Object.keys(m).length}});' +
    'try{Object.defineProperty(window,n,{configurable:true,value:a})}catch(e){}}' +
    'shim("localStorage");shim("sessionStorage");}catch(e){}})();<\/script>';

  var reporter = '<script>(function(){try{' +
    'function post(level,args){try{parent.postMessage({__bmLog:{level:level,args:args,ts:Date.now()}},"*")}catch(e){}}' +
    'function enc(x){try{return typeof x==="object"?JSON.stringify(x).slice(0,400):String(x).slice(0,400)}catch(e){return String(x)}}' +
    'window.addEventListener("error",function(e){post("error",[(e.message||"error")+" @"+(e.lineno||0)+":"+(e.colno||0)])});' +
    'window.addEventListener("unhandledrejection",function(e){post("error",["Unhandled: "+enc(e.reason)])});' +
    'var ce=console.error;console.error=function(){post("error",[].slice.call(arguments).map(enc));try{ce.apply(console,arguments)}catch(e){}};' +
    'var cw=console.warn;console.warn=function(){post("warn",[].slice.call(arguments).map(enc));try{cw.apply(console,arguments)}catch(e){}};' +
    '}catch(e){}})();<\/script>';

  function inject(html) {
    var head = /<head[^>]*>/i.exec(html);
    if (head) return html.slice(0, head.index + head[0].length) + shim + reporter + html.slice(head.index + head[0].length);
    return shim + reporter + html;
  }

  function load() {
    statusEl.className = 'status';
    statusEl.textContent = t('loading…', 'جارٍ التحميل…');
    chrome.runtime.sendMessage({ type: 'get-artifact-html', id: id }, function (res) {
      if (!res || !res.ok) {
        statusEl.className = 'status err';
        statusEl.textContent = t('document not found', 'المستند غير موجود');
        return;
      }
      nameEl.textContent = res.filename || t('Preview', 'معاينة');
      document.title = t('Preview', 'معاينة') + ' — ' + (res.filename || '');
      var html = inject(res.html || '');
      if (ready) frame.contentWindow.postMessage({ __bmRender: true, html: html }, '*');
      else frame._pending = html;
    });
  }

  frame.src = chrome.runtime.getURL('src/preview/sandbox.html');

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d) return;
    if (d.__bmSandboxReady) {
      ready = true;
      if (frame._pending) frame.contentWindow.postMessage({ __bmRender: true, html: frame._pending }, '*');
      return;
    }
    if (d.__bmLog) {
      logs.push({ level: String(d.__bmLog.level || 'log').slice(0, 10), args: (d.__bmLog.args || []).slice(0, 8), ts: Date.now() });
      if (logs.length > 200) logs = logs.slice(-200);
      setStatus();
      sendLogs();
    }
    if (d.__bmSandboxError) {
      logs.push({ level: 'error', args: [String(d.__bmSandboxError)], ts: Date.now() });
      setStatus();
      sendLogs();
    }
  });

  document.getElementById('reload').addEventListener('click', function () {
    frame.src = frame.src;
    ready = false;
    frame._pending = null;
    load();
  });

  document.getElementById('download').addEventListener('click', function () {
    chrome.runtime.sendMessage({ type: 'download-artifact', id: id }, function (res) {
      if (!res || !res.ok) return;
      var a = document.createElement('a');
      a.href = res.url;
      a.download = res.filename || 'index.html';
      a.click();
    });
  });

  // اقرأ لغة الإضافة أولاً، ثم طبّق القالب وابدأ التحميل (مع مهلة احتياطية).
  var started = false;
  function start() {
    if (started) return;
    started = true;
    applyLang();
    load();
  }
  try {
    chrome.storage.local.get('settings', function (res) {
      if (res && res.settings && res.settings.lang === 'ar') lang = 'ar';
      start();
    });
    setTimeout(start, 500);
  } catch (e) {
    start();
  }

  applyLang();
  setInterval(sendLogs, 1200);
})();
