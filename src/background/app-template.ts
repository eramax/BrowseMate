// قالب تطبيق Todo حتمي — JS مُختبَر داخلياً، النموذج يرسل بيانات فقط (لا كتابة كود)
export interface TodoAppData {
  title?: string;
  subtitle?: string;
  placeholder?: string;
  theme?: 'dark' | 'light';
  accent?: string;
  lang?: 'ar' | 'en';
  storageKey?: string;
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const accentOk = (a?: string) => (/^#[0-9a-fA-F]{3,8}$/.test(a ?? '') ? a! : '#7c9cff');

export function renderTodoApp(d: TodoAppData): string {
  const ar = (d.lang ?? 'ar') === 'ar';
  const t = ar
    ? { title: d.title ?? 'مهامي', sub: d.subtitle ?? 'أضف مهامك وتابع إنجازك', ph: d.placeholder ?? 'أضف مهمة جديدة…', add: 'إضافة', all: 'الكل', active: 'نشطة', done: 'مكتملة', clear: 'مسح المكتملة', empty: 'لا توجد مهام بعد', stats: ['مكتملة', 'متبقية'], theme: 'تبديل الوضع', del: 'حذف', toggle: 'تغيير حالة المهمة' }
    : { title: d.title ?? 'My Tasks', sub: d.subtitle ?? 'Add tasks and track progress', ph: d.placeholder ?? 'Add a new task…', add: 'Add', all: 'All', active: 'Active', done: 'Completed', clear: 'Clear completed', empty: 'No tasks yet', stats: ['done', 'left'], theme: 'Toggle theme', del: 'Delete', toggle: 'Toggle task' };
  const theme = d.theme === 'light' ? 'light' : 'dark';
  const accent = accentOk(d.accent);
  const key = (d.storageKey ?? 'bm_todo_v1').replace(/[^a-zA-Z0-9_-]/g, '') || 'bm_todo_v1';

  return `<!doctype html><html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t.title)}</title>
<style>
  :root{--accent:${accent};--bg:${theme === 'light' ? '#f6f7fb' : '#0b0e14'};--surface:${theme === 'light' ? '#fff' : '#141a28'};--surface2:${theme === 'light' ? '#eef1f7' : '#1d2434'};--text:${theme === 'light' ? '#151a24' : '#eef2fb'};--muted:${theme === 'light' ? '#5b6376' : '#9aa4b8'};--border:${theme === 'light' ? '#e0e4ee' : '#26304a'};--ok:${theme === 'light' ? '#0e9f6e' : '#4ade80'};--danger:#f87171}
  *{box-sizing:border-box}html,body{margin:0;min-height:100%}body{background:radial-gradient(800px 400px at 20% -10%,color-mix(in srgb,var(--accent) 18%,transparent),transparent),var(--bg);color:var(--text);font:15px/1.6 system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif}
  .wrap{max-width:640px;margin:0 auto;padding:40px 16px 64px}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:18px;box-shadow:0 20px 50px rgba(0,0,0,.25);overflow:hidden}
  header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:20px 22px;border-bottom:1px solid var(--border)}
  h1{margin:0;font-size:20px;letter-spacing:-.2px}
  .sub{margin:2px 0 0;color:var(--muted);font-size:12.5px}
  .theme{border:1px solid var(--border);background:var(--surface2);color:var(--text);border-radius:10px;padding:8px 11px;cursor:pointer}
  .row{display:flex;gap:8px;padding:16px 22px;border-bottom:1px solid var(--border)}
  input{flex:1;padding:12px 14px;border-radius:12px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit;outline:none}
  input:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}
  .add{padding:12px 18px;border:none;border-radius:12px;background:var(--accent);color:#0b0e14;font-weight:700;cursor:pointer;white-space:nowrap}
  .add:hover{filter:brightness(1.07)}
  .filters{display:flex;gap:6px;padding:12px 22px;border-bottom:1px solid var(--border);flex-wrap:wrap}
  .filters button{border:1px solid var(--border);background:var(--surface2);color:var(--muted);border-radius:99px;padding:6px 14px;font-size:12.5px;cursor:pointer}
  .filters button.on{background:var(--accent);border-color:var(--accent);color:#0b0e14;font-weight:600}
  ul{list-style:none;margin:0;padding:0;max-height:46vh;overflow-y:auto}
  li{display:flex;align-items:center;gap:10px;padding:13px 20px;border-bottom:1px solid var(--border)}
  li:last-child{border-bottom:none}
  .check{width:22px;height:22px;border-radius:7px;border:2px solid var(--border);background:transparent;cursor:pointer;display:grid;place-items:center;color:#0b0e14;flex:none}
  li.done .check{background:var(--ok);border-color:var(--ok)}
  li.done .check::after{content:"✓";font-weight:900;font-size:13px}
  .text{flex:1;word-break:break-word}
  li.done .text{text-decoration:line-through;color:var(--muted)}
  .del{border:none;background:transparent;color:var(--muted);cursor:pointer;font-size:16px;padding:4px 6px;border-radius:8px}
  .del:hover{color:var(--danger);background:color-mix(in srgb,var(--danger) 12%,transparent)}
  .empty{padding:34px 20px;text-align:center;color:var(--muted);font-size:13px}
  .foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 20px;border-top:1px solid var(--border);color:var(--muted);font-size:12.5px}
  .clear{border:none;background:transparent;color:var(--danger);cursor:pointer;font:inherit}
  .clear:disabled{color:var(--muted);cursor:not-allowed}
</style></head><body>
<div class="wrap"><div class="card">
  <header><div><h1>${esc(t.title)}</h1><p class="sub">${esc(t.sub)}</p></div>
    <button class="theme" id="themeBtn" aria-label="${esc(t.theme)}">☾</button></header>
  <div class="row"><input id="input" placeholder="${esc(t.ph)}" autocomplete="off" aria-label="${esc(t.ph)}"><button class="add" id="addBtn">${esc(t.add)}</button></div>
  <div class="filters" role="tablist">
    <button data-f="all" class="on">${esc(t.all)}</button>
    <button data-f="active">${esc(t.active)}</button>
    <button data-f="done">${esc(t.done)}</button>
  </div>
  <ul id="list" role="list"></ul>
  <div class="empty" id="empty" hidden>${esc(t.empty)}</div>
  <div class="foot"><span id="stats"></span><button class="clear" id="clearBtn">${esc(t.clear)}</button></div>
</div></div>
<script>
(function(){
  var KEY=${JSON.stringify(key)};
  var tasks=[]; var filter='all';
  try{ var raw=localStorage.getItem(KEY); if(raw) tasks=JSON.parse(raw)||[]; }catch(e){ tasks=[]; }
  var input=document.getElementById('input'), addBtn=document.getElementById('addBtn'),
      list=document.getElementById('list'), empty=document.getElementById('empty'),
      stats=document.getElementById('stats'), clearBtn=document.getElementById('clearBtn'),
      themeBtn=document.getElementById('themeBtn');
  function save(){ try{ localStorage.setItem(KEY, JSON.stringify(tasks)); }catch(e){} }
  function visible(){ return tasks.filter(function(t){ return filter==='all' || (filter==='active' && !t.done) || (filter==='done' && t.done); }); }
  function render(){
    list.textContent='';
    visible().forEach(function(task){
      var li=document.createElement('li'); if(task.done) li.className='done';
      var cb=document.createElement('button'); cb.className='check'; cb.setAttribute('aria-label', ${JSON.stringify(ar ? 'تغيير حالة المهمة' : 'Toggle task')});
      cb.addEventListener('click', function(){ task.done=!task.done; save(); render(); });
      var span=document.createElement('span'); span.className='text'; span.textContent=task.text;
      var del=document.createElement('button'); del.className='del'; del.textContent='✕'; del.setAttribute('aria-label', ${JSON.stringify(ar ? 'حذف' : 'Delete')});
      del.addEventListener('click', function(){ tasks=tasks.filter(function(x){return x.id!==task.id}); save(); render(); });
      li.appendChild(cb); li.appendChild(span); li.appendChild(del); list.appendChild(li);
    });
    empty.hidden = visible().length>0;
    var done=tasks.filter(function(t){return t.done}).length;
    stats.textContent = ${JSON.stringify(ar ? '' : '')} + done + ' ${ar ? 'مكتملة' : 'done'} · ' + (tasks.length-done) + ' ${ar ? 'متبقية' : 'left'}';
    clearBtn.disabled = done===0;
  }
  function add(){
    var v=(input.value||'').trim(); if(!v) return;
    tasks.unshift({id:Date.now()+'-'+Math.random().toString(36).slice(2,7), text:v, done:false});
    input.value=''; save(); render(); input.focus();
  }
  addBtn.addEventListener('click', add);
  input.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); add(); } });
  Array.prototype.forEach.call(document.querySelectorAll('.filters button'), function(b){
    b.addEventListener('click', function(){
      filter=b.getAttribute('data-f');
      Array.prototype.forEach.call(document.querySelectorAll('.filters button'), function(x){ x.classList.toggle('on', x===b); });
      render();
    });
  });
  clearBtn.addEventListener('click', function(){ tasks=tasks.filter(function(t){return !t.done}); save(); render(); });
  themeBtn.addEventListener('click', function(){
    var root=document.documentElement, dark=root.getAttribute('data-d')!=='light';
    root.setAttribute('data-d', dark?'light':'dark');
    root.style.setProperty('--bg', dark?'#f6f7fb':'#0b0e14');
    root.style.setProperty('--surface', dark?'#ffffff':'#141a28');
    root.style.setProperty('--surface2', dark?'#eef1f7':'#1d2434');
    root.style.setProperty('--text', dark?'#151a24':'#eef2fb');
    root.style.setProperty('--muted', dark?'#5b6376':'#9aa4b8');
    root.style.setProperty('--border', dark?'#e0e4ee':'#26304a');
  });
  render();
})();
</script>
</body></html>`;
}
