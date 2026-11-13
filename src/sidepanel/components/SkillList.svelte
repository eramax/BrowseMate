<script lang="ts">
  // المهارات: تشغيل بالاسم + حذف + استيراد/تصدير JSON
  import type { SkillFile } from '../../shared/types';
  import type { Lang } from '../../shared/i18n';
  import { rpc } from '../lib/port';

  let {
    skills, lang, run: runSkill, remove, importJson, refresh,
  }: {
    skills: SkillFile[];
    lang: Lang;
    run: (name: string, params: Record<string, string>) => void;
    remove: (name: string) => void;
    importJson: (json: string) => void;
    refresh: () => void;
  } = $props();

  let attached = $state<Record<string, string>>({});
  let expanded = $state<string | null>(null);
  let paramValues = $state<Record<string, Record<string, string>>>({});
  let importText = $state('');
  let importing = $state(false);

  const L = $derived(lang === 'ar' ? {
    run: 'تشغيل', del: 'حذف', exp: 'تصدير', imp: 'استيراد JSON',
    none: 'لا مهارات محفوظة بعد', ph: 'الصق ملف المهارة JSON هنا', save: 'حفظ',
    hint: 'تُنشأ المهارات من الشات: «احفظ هذا كمهارة باسم …»',
    attach: '📎 إرفاق CV.md', attached: 'ملف مرفق', playbook: 'مهارة إجرائية',
    removeFile: 'إزالة الملف',
  } : {
    run: 'Run', del: 'Delete', exp: 'Export', imp: 'Import JSON',
    none: 'No saved skills yet', ph: 'Paste skill JSON here', save: 'Save',
    hint: 'Create skills from chat: “save this as a skill named …”',
    attach: '📎 Attach CV.md', attached: 'File attached', playbook: 'Playbook',
    removeFile: 'Remove file',
  });

  function toggle(s: SkillFile) {
    expanded = expanded === s.name ? null : s.name;
    if (!paramValues[s.name]) {
      paramValues[s.name] = Object.fromEntries((s.params ?? []).map((p) => [p.name, '']));
    }
  }
  function exportSkill(s: SkillFile) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${s.name}.skill.json`; a.click();
    URL.revokeObjectURL(url);
  }

  async function attachFile(name: string, file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    const res: any = await rpc('update-skill', { name, patch: { context: text } });
    if (!res.ok) alert(res.error);
    else { attached[name] = `${file.name} (${Math.round(text.length / 1024)}KB)`; refresh(); }
  }
  async function clearFile(name: string) {
    const res: any = await rpc('update-skill', { name, patch: { context: '' } });
    if (res.ok) { attached[name] = ''; refresh(); }
  }
  function run(s: SkillFile) {
    const params = paramValues[s.name] ?? {};
    runSkill(s.name, params);
  }
</script>

<div class="view">
  <div class="list" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
    {#if !skills.length}
      <div class="empty"><div class="logo">◈</div>{L.none}<div class="hint">{L.hint}</div></div>
    {/if}
    {#each skills as s (s.name)}
      <div class="card">
        <div class="row1">
          <span class="title" role="button" tabindex="0" onclick={() => toggle(s)} onkeydown={(e) => e.key === 'Enter' && toggle(s)}>{s.name}</span>
          <button class="mini" onclick={() => exportSkill(s)}>{L.exp}</button>
          <button class="mini" onclick={() => remove(s.name)}>{L.del}</button>
        </div>
        <div class="desc">{s.description}</div>
        {#if s.whenToUse}<div class="desc">🎯 {s.whenToUse}</div>{/if}
        {#if s.site}<div class="desc">🌐 {s.site}</div>{/if}
        {#if s.notes}<div class="desc">📌 {s.notes}</div>{/if}
        {#if s.instructions}<div class="desc">⚙️ {L.playbook}</div>{/if}
        {#if s.params?.length}<div class="desc">{L.params}: {s.params.map((p) => p.name).join(', ')}</div>{/if}
        {#if expanded === s.name}
          {#if s.instructions}
            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-top:4px">
              <label class="mini" style="cursor:pointer">
                {L.attach}
                <input type="file" accept=".md,.markdown,text/markdown,text/plain" style="display:none"
                       onchange={(e) => attachFile(s.name, (e.currentTarget as HTMLInputElement).files?.[0])} />
              </label>
              {#if s.context}
                <span class="hint" style="color:var(--ok)">✓ {L.attached} — {Math.round(s.context.length / 1024)}KB</span>
                <button class="mini" onclick={() => clearFile(s.name)}>{L.removeFile}</button>
              {:else}
                <span class="hint">CV.md</span>
              {/if}
            </div>
          {/if}
          <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:4px">
            {#each s.params as p (p.name)}
              <div style="display:flex; flex-direction:column; gap:2px">
                <input
                  placeholder={p.example ? `${p.name} — ${p.example}` : p.name}
                  title={p.description ?? p.name}
                  bind:value={paramValues[s.name][p.name]}
                  style="width:130px;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:12px"
                />
                {#if p.description}<span class="hint">{p.description}</span>{/if}
              </div>
            {/each}
            <button class="mini" style="color:var(--accent);border-color:var(--accent);align-self:flex-start" onclick={() => runSkill(s.name, paramValues[s.name] ?? {})}>▶ {L.run}</button>
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <div style="padding:10px 12px 12px; border-top:1px solid var(--border-soft)">
    {#if importing}
      <textarea
        bind:value={importText}
        placeholder={L.ph}
        rows="4"
        dir="ltr"
        style="width:100%; font-size:11px; padding:8px; border-radius:9px; border:1px solid var(--border); background:var(--surface); color:var(--text)"
      ></textarea>
      <div style="display:flex; gap:6px; margin-top:6px">
        <button class="btn" style="padding:7px 14px" onclick={() => { importJson(importText); importText = ''; importing = false; }}>{L.save}</button>
        <button class="btn ghost" style="padding:7px 12px" onclick={() => (importing = false)}>✕</button>
      </div>
    {:else}
      <button class="mini" onclick={() => (importing = true)}>⇪ {L.imp}</button>
    {/if}
  </div>
</div>
