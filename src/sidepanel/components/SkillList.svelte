<script lang="ts">
  // المهارات: تشغيل بالاسم (رسالة شات) + حذف + استيراد/تصدير JSON
  import type { SkillFile } from '../../shared/types';
  import type { Lang } from '../../shared/i18n';

  let {
    skills, lang, run, remove, importJson,
  }: {
    skills: SkillFile[];
    lang: Lang;
    run: (name: string, params: Record<string, string>) => void;
    remove: (name: string) => void;
    importJson: (json: string) => void;
  } = $props();

  let expanded = $state<string | null>(null);
  let paramValues = $state<Record<string, Record<string, string>>>({});
  let importText = $state('');
  let importing = $state(false);

  const L = $derived(lang === 'ar' ? {
    run: 'تشغيل', del: 'حذف', exp: 'تصدير', imp: 'استيراد JSON',
    none: 'لا مهارات محفوظة', ph: 'الصق ملف المهارة JSON هنا', save: 'حفظ',
  } : {
    run: 'Run', del: 'Delete', exp: 'Export', imp: 'Import JSON',
    none: 'No saved skills', ph: 'Paste skill JSON here', save: 'Save',
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
</script>

<div class="view">
  <div class="list" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
    {#if !skills.length}<div class="empty">{L.none}</div>{/if}
    {#each skills as s (s.name)}
      <div class="item" style="align-items:flex-start; flex-direction:column">
        <div style="display:flex; width:100%; align-items:center; gap:8px">
          <span class="title" style="white-space:normal" onclick={() => toggle(s)} title={s.description}>
            <b>{s.name}</b> <span class="meta">{s.description}</span>
          </span>
          <button class="mini" onclick={() => exportSkill(s)}>{L.exp}</button>
          <button class="mini danger" onclick={() => remove(s.name)}>{L.del}</button>
        </div>
        {#if expanded === s.name}
          <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:8px; width:100%">
            {#each s.params as p (p.name)}
              <input
                placeholder={p.name}
                bind:value={paramValues[s.name][p.name]}
                style="padding:5px 8px; border-radius:7px; border:1px solid var(--border); background:var(--bg); color:var(--text); font-size:12px"
              />
            {/each}
            <button class="mini" onclick={() => run(s.name, paramValues[s.name])}>▶ {L.run}</button>
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <div style="padding:10px; border-top:1px solid var(--border)">
    {#if importing}
      <textarea
        bind:value={importText}
        placeholder={L.ph}
        rows="4"
        dir="ltr"
        style="width:100%; font-size:11px; padding:8px; border-radius:8px; border:1px solid var(--border); background:var(--panel); color:var(--text)"
      ></textarea>
      <div style="display:flex; gap:6px; margin-top:6px">
        <button class="btn" onclick={() => { importJson(importText); importText = ''; importing = false; }}>{L.save}</button>
        <button class="btn ghost" onclick={() => (importing = false)}>✕</button>
      </div>
    {:else}
      <button class="mini" onclick={() => (importing = true)}>⇪ {L.imp}</button>
    {/if}
  </div>
</div>
