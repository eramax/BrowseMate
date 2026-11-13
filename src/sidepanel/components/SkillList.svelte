<script lang="ts">
  // المهارات: ▶ تشغيل بجلسة جديدة، ⚙ إعدادات/تحرير، تصدير/حذف، استيراد
  import type { SkillFile } from '../../shared/types';
  import type { Lang } from '../../shared/i18n';
  import { rpc } from '../lib/port';
  import { toSkillMd } from '../../shared/skill-md';

  let {
    skills, lang, run: runSkill, remove, refresh,
  }: {
    skills: SkillFile[];
    lang: Lang;
    run: (name: string, params: Record<string, string>) => void;
    remove: (name: string) => void;
    refresh: () => void;
  } = $props();

  let expanded = $state<string | null>(null);
  let paramValues = $state<Record<string, Record<string, string>>>({});

  // محرر الإعدادات
  let editing = $state<SkillFile | null>(null);
  let form = $state({ description: '', whenToUse: '', site: '', notes: '', instructions: '', context: '' });
  let saving = $state(false);
  let editErr = $state('');
  let fileMsg = $state('');

  // إعادة الترتيب
  let dragName = $state<string | null>(null);
  let dragOver = $state<string | null>(null);

  async function persistOrder(list: SkillFile[]) {
    await rpc('reorder-skills', { names: list.map((s) => s.name) });
    refresh();
  }
  function move(name: string, dir: -1 | 1) {
    const list = [...skills];
    const i = list.findIndex((s) => s.name === name);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    persistOrder(list);
  }
  function onDrop(targetName: string) {
    if (!dragName || dragName === targetName) { dragName = null; dragOver = null; return; }
    const list = [...skills];
    const from = list.findIndex((s) => s.name === dragName);
    const to = list.findIndex((s) => s.name === targetName);
    if (from < 0 || to < 0) return;
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    dragName = null; dragOver = null;
    persistOrder(list);
  }

  const L = $derived(lang === 'ar' ? {
    run: 'تشغيل', del: 'حذف', exp: 'تصدير',
    none: 'لا مهارات محفوظة بعد', save: 'حفظ', cancel: 'إلغاء',
    hint: 'تُنشأ المهارات من الشات: «احفظ هذا كمهارة باسم …»',
    playbook: 'مهارة إجرائية', settings: 'إعدادات المهارة', desc: 'الوصف', when: 'متى تُستخدم (المشكلة)',
    site: 'الموقع/النطاق', notes: 'ملاحظات وقيود', instructions: 'التعليمات (Playbook)',
    context: 'ملف مرفق Markdown (مثل CV.md)', attach: '📎 رفع ملف .md', attached: 'مرفق',
    params: 'معاملات', emptyFile: 'لا ملف مرفق',
    dragHint: 'اسحب البطاقة أو استخدم ↑↓ لتغيير الترتيب',
  } : {
    run: 'Run', del: 'Delete', exp: 'Export',
    none: 'No saved skills yet', save: 'Save', cancel: 'Cancel',
    hint: 'Create skills from chat: “save this as a skill named …”',
    playbook: 'Playbook', settings: 'Skill settings', desc: 'Description', when: 'When to use (problem)',
    site: 'Site/domain', notes: 'Notes & limits', instructions: 'Instructions (playbook)',
    context: 'Attached markdown (e.g. CV.md)', attach: '📎 Upload .md', attached: 'attached',
    params: 'Params', emptyFile: 'No file attached',
    dragHint: 'Drag a card or use ↑↓ to reorder',
  });

  function toggle(s: SkillFile) {
    expanded = expanded === s.name ? null : s.name;
    if (!paramValues[s.name]) {
      paramValues[s.name] = Object.fromEntries((s.params ?? []).map((p) => [p.name, '']));
    }
  }
  function exportSkill(s: SkillFile) {
    const url = URL.createObjectURL(new Blob([toSkillMd(s)], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${s.name}.md`; a.click();
    URL.revokeObjectURL(url);
  }

  function openSettings(s: SkillFile) {
    editing = s;
    form = {
      description: s.description ?? '', whenToUse: s.whenToUse ?? '', site: s.site ?? '',
      notes: s.notes ?? '', instructions: s.instructions ?? '', context: s.context ?? '',
    };
    editErr = ''; fileMsg = '';
  }
  async function saveSettings() {
    if (!editing) return;
    saving = true; editErr = '';
    const res: any = await rpc('update-skill', { name: editing.name, patch: { ...form } });
    saving = false;
    if (!res.ok) { editErr = res.error; return; }
    editing = null;
    refresh();
  }
  async function pickFile(file: File | undefined) {
    if (!file) return;
    form.context = await file.text();
    fileMsg = `${file.name} (${Math.round(form.context.length / 1024)}KB)`;
  }
  async function run(s: SkillFile) {
    runSkill(s.name, paramValues[s.name] ?? {});
  }
</script>

<div class="view">
  <div class="list" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
    {#if skills.length}<div class="hint" style="padding-inline-start:4px">{L.dragHint}</div>{/if}
    {#if !skills.length}
      <div class="empty"><div class="logo">◈</div>{L.none}<div class="hint">{L.hint}</div></div>
    {/if}
    {#each skills as s, i (s.name)}
      <div
        class="card"
        class:dragover={dragOver === s.name}
        draggable="true"
        ondragstart={(e) => { dragName = s.name; e.dataTransfer?.setData('text/plain', s.name); }}
        ondragover={(e) => { e.preventDefault(); dragOver = s.name; }}
        ondragleave={() => { if (dragOver === s.name) dragOver = null; }}
        ondrop={(e) => { e.preventDefault(); onDrop(s.name); }}
        ondragend={() => { dragName = null; dragOver = null; }}
      >
        <div class="row1">
          <span class="grip" title="اسحب للترتيب">⠿</span>
          <span class="title" role="button" tabindex="0" onclick={() => toggle(s)} onkeydown={(e) => e.key === 'Enter' && toggle(s)}>{s.name}</span>
          <button class="mini" title="أعلى" disabled={i === 0} onclick={() => move(s.name, -1)}>↑</button>
          <button class="mini" title="أسفل" disabled={i === skills.length - 1} onclick={() => move(s.name, 1)}>↓</button>
          <button class="mini accent" title={L.run} onclick={() => run(s)}>▶</button>
          <button class="mini" title={L.settings} onclick={() => openSettings(s)}>⚙</button>
          <button class="mini" title={L.exp} onclick={() => exportSkill(s)}>⤓</button>
          <button class="mini danger" title={L.del} onclick={() => remove(s.name)}>✕</button>
        </div>
        <div class="desc">{s.description}</div>
        {#if s.whenToUse}<div class="desc">🎯 {s.whenToUse}</div>{/if}
        {#if s.site}<div class="desc">🌐 {s.site}</div>{/if}
        {#if s.instructions}<div class="desc">⚙️ {L.playbook}</div>{/if}
        {#if s.context}<div class="desc">📎 {Math.round(s.context.length / 1024)}KB {L.attached}</div>{/if}
        {#if s.params?.length}<div class="desc">{L.params}: {s.params.map((p) => p.name).join(', ')}</div>{/if}

        {#if expanded === s.name && s.params?.length}
          <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:4px">
            {#each s.params as p (p.name)}
              <div style="display:flex; flex-direction:column; gap:2px">
                <input
                  placeholder={p.example ? `${p.name} — ${p.example}` : p.name}
                  title={p.description ?? p.name}
                  bind:value={paramValues[s.name][p.name]}
                  style="width:150px;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:12px"
                />
                {#if p.description}<span class="hint">{p.description}</span>{/if}
              </div>
            {/each}
            <button class="mini accent" style="align-self:flex-start" onclick={() => run(s)}>▶ {L.run}</button>
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>

{#if editing}
  <div class="modal-backdrop" onclick={() => (editing = null)}></div>
  <div class="modal" dir={lang === 'ar' ? 'rtl' : 'ltr'} role="dialog" aria-label={L.settings}>
    <div class="modal-head">
      <b>⚙ {L.settings}</b>
      <span class="hint">{editing.name}</span>
      <button class="mini" onclick={() => (editing = null)}>✕</button>
    </div>
    <div class="modal-body">
      <label class="fld">{L.desc}<input bind:value={form.description} /></label>
      <label class="fld">{L.when}<input bind:value={form.whenToUse} /></label>
      <label class="fld">{L.site}<input bind:value={form.site} dir="ltr" /></label>
      <label class="fld">{L.notes}<input bind:value={form.notes} /></label>
      <label class="fld">{L.context}
        <input bind:value={form.context} placeholder={L.context} dir="ltr" />
        <span class="hint">{fileMsg || (form.context ? `${Math.round(form.context.length / 1024)}KB` : L.emptyFile)}</span>
        <label class="mini" style="width:fit-content;cursor:pointer">
          {L.attach}
          <input type="file" accept=".md,.markdown,text/markdown,text/plain" style="display:none"
                 onchange={(e) => pickFile((e.currentTarget as HTMLInputElement).files?.[0])} />
        </label>
      </label>
      <label class="fld">{L.instructions}
        <textarea bind:value={form.instructions} rows="7" dir="auto"></textarea>
      </label>
      {#if editErr}<div class="hint" style="color:var(--warn)">{editErr}</div>{/if}
    </div>
    <div class="modal-foot">
      <button class="btn" disabled={saving} onclick={saveSettings}>{L.save}</button>
      <button class="btn ghost" onclick={() => (editing = null)}>{L.cancel}</button>
    </div>
  </div>
{/if}
