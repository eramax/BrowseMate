<script lang="ts">
  // الإعدادات داخل الـ panel — حفظ تلقائي + منتقي نماذج قابل للبحث
  import { rpc } from '../lib/port';
  import type { Lang } from '../../shared/i18n';

  let { lang, setUiLang }: { lang: Lang; setUiLang: (l: Lang) => void } = $props();

  let baseUrl = $state('');
  let apiKey = $state('');
  let model = $state('');
  let models = $state<string[]>([]);
  let notice = $state('');
  let saved = $state(false);
  let open = $state(false);
  let approvalMode = $state<'sensitive' | 'always' | 'never'>('sensitive');
  let skillsMsg = $state('');
  const filtered = $derived(
    model ? models.filter((m) => m.toLowerCase().includes(model.toLowerCase())) : models,
  );
  const L = $derived(lang === 'ar' ? {
    baseUrl: 'Base URL', apiKey: 'API Key', model: 'النموذج',
    fetch: 'جلب النماذج', language: 'اللغة', save: 'حفظ', saved: 'تم الحفظ ✓',
    fillFirst: 'أكمل Base URL وAPI Key أولاً', select: 'اختر أو اكتب معرف النموذج',
    autosave: 'يُحفظ تلقائياً على جهازك فقط — بدون backend',
    privacy: 'المفتاح لا يغادر جهازك إلا إلى مزودك.',
    perms: 'الصلاحيات',
    permSensitive: 'اسأل قبل الإجراءات الحساسة (موصى به)',
    permAlways: 'اسأل عن كل إجراء',
    permNever: 'بدون سؤال — تحكم كامل تلقائي',
    permsHint: 'يشمل التنقل، الإغلاق، النقر، الملء، والحذف.',
    skillsBackup: 'نسخ احتياطي للمهارات',
    exportAll: '⤓ تصدير كل المهارات',
    importAll: '⇪ استيراد ملف مهارات',
    syncNow: '↻ مزامنة الآن',
    skillsHint: 'المهارات تُحفظ في chrome.storage.sync (مضغوطة) — ونسخة محلية فقط إذا كان sync غير متاح.',
  } : {
    baseUrl: 'Base URL', apiKey: 'API Key', model: 'Model',
    fetch: 'Fetch models', language: 'Language', save: 'Save', saved: 'Saved ✓',
    fillFirst: 'Fill Base URL and API Key first', select: 'Pick or type a model id',
    autosave: 'Auto-saved locally — no backend',
    privacy: 'Your key never leaves your device except to your provider.',
    perms: 'Permissions',
    permSensitive: 'Ask before sensitive actions (recommended)',
    permAlways: 'Ask for every action',
    permNever: 'No prompts — full auto control',
    permsHint: 'Covers navigation, closing, clicking, filling and deletion.',
    skillsBackup: 'Skills backup',
    exportAll: '⤓ Export all skills',
    importAll: '⇪ Import skills file',
    syncNow: '↻ Sync now',
    skillsHint: 'Skills live in chrome.storage.sync (compressed) — a local copy is used only when sync is unavailable.',
  });

  oninit();

  async function oninit() {
    const res: any = await rpc('get-settings');
    baseUrl = res.settings.baseUrl;
    apiKey = res.settings.apiKey;
    model = res.settings.model;
    approvalMode = res.settings.approvalMode ?? 'sensitive';
    if (baseUrl && apiKey) await fetchModels(true);
    await refreshSyncStatus();
  }

  async function refreshSyncStatus() {
    const res: any = await rpc('skills-sync', { now: false });
    if (!res.ok) return;
    const st = res.status;
    const when = st.updatedAt ? new Date(st.updatedAt).toLocaleTimeString(lang === 'ar' ? 'ar' : 'en', { hour: '2-digit', minute: '2-digit' }) : '—';
    skillsMsg = st.error
      ? `⚠️ ${st.error}`
      : lang === 'ar'
        ? `${st.mode === 'sync' ? 'مزامنة مع حساب المتصفح' : 'نسخة محلية (sync غير متاح)'} — ${st.count} مهارة — ${when}`
        : `${st.mode === 'sync' ? 'Synced with browser account' : 'Local fallback (sync unavailable)'} — ${st.count} skills — ${when}`;
  }

  async function syncNow() {
    const res: any = await rpc('skills-sync', { now: true });
    if (res.ok) {
      const st = res.status;
      skillsMsg = st.error
        ? `⚠️ ${st.error}`
        : lang === 'ar' ? `تمت المزامنة (${st.count} مهارة)` : `Synced (${st.count} skills)`;
    }
    await refreshSyncStatus();
  }

  async function selectModel(m: string) {
    model = m;
    open = false;
    await saveAll();
  }

  async function saveAll() {
    await rpc('save-settings', { patch: { baseUrl, apiKey, model } });
    saved = true;
    setTimeout(() => (saved = false), 1600);
  }

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function autosave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveAll, 450);
  }

  async function setMode(m: 'sensitive' | 'always' | 'never') {
    approvalMode = m;
    await rpc('save-settings', { patch: { approvalMode: m } });
    saved = true;
    setTimeout(() => (saved = false), 1600);
  }

  // ===== نسخ احتياطي للمهارات =====
  async function exportAllSkills() {
    const res: any = await rpc('list-skills');
    if (!res.ok) { skillsMsg = res.error; return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(res.skills, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'browsemate-skills.json';
    a.click();
    URL.revokeObjectURL(url);
    skillsMsg = lang === 'ar' ? `تم تصدير ${res.skills.length} مهارة` : `Exported ${res.skills.length} skills`;
  }

  async function importSkillsFile(file: File | undefined) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const list: any[] = Array.isArray(parsed) ? parsed : [parsed];
      let ok = 0;
      const errs: string[] = [];
      for (const skill of list) {
        const r: any = await rpc('import-skill', { skill });
        if (r.ok) ok++;
        else errs.push(`${skill?.name ?? '?'}: ${r.error}`);
      }
      skillsMsg = lang === 'ar'
        ? `تم استيراد ${ok}${errs.length ? ` — فشل ${errs.length}` : ''}`
        : `Imported ${ok}${errs.length ? ` — ${errs.length} failed` : ''}`;
    } catch (e: any) {
      skillsMsg = `JSON: ${e.message}`;
    }
  }

  async function fetchModels(silent = false) {
    if (!baseUrl || !apiKey) { if (!silent) notice = L.fillFirst; return; }
    notice = '';
    await saveAll();
    const res: any = await rpc('list-models');
    if (res.ok) {
      models = res.models;
      if (!models.includes(model)) { model = models[0] ?? ''; await saveAll(); }
    } else {
      notice = res.error === 'FILL_FIRST' ? L.fillFirst : res.error;
    }
  }
</script>

<div class="view">
  <div class="form" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
    <div class="field">
      <label>{L.baseUrl}</label>
      <input bind:value={baseUrl} oninput={autosave} placeholder="https://api.example.com/v1" dir="ltr" spellcheck="false" />
    </div>
    <div class="field">
      <label>{L.apiKey}</label>
      <input type="password" bind:value={apiKey} oninput={autosave} dir="ltr" spellcheck="false" autocomplete="off" />
    </div>

    <div class="field combobox">
      <label>{L.model}</label>
      <div class="combo-wrap">
        <input
          bind:value={model}
          oninput={() => { open = true; autosave(); }}
          onfocus={() => (open = true)}
          onkeydown={(e) => {
            if (e.key === 'Enter' && filtered.length) { e.preventDefault(); selectModel(filtered[0]); }
            if (e.key === 'Escape') open = false;
          }}
          dir="ltr" placeholder={L.select} spellcheck="false" autocomplete="off"
        />
        {#if open && filtered.length}
          <div class="dropdown" onfocusout={() => setTimeout(() => (open = false), 160)}>
            {#each filtered.slice(0, 60) as m (m)}
              <div class="opt" role="option" tabindex="0"
                   onclick={() => selectModel(m)}
                   onkeydown={(e) => e.key === 'Enter' && selectModel(m)}>{m}</div>
            {/each}
          </div>
        {/if}
      </div>
      <div class="hint">{#if models.length}{filtered.length}/{models.length} · {L.fetch}{:else}{L.select}{/if}</div>
      <button class="mini" style="width:fit-content;margin-top:2px" onclick={() => fetchModels()}>⇩ {L.fetch}</button>
    </div>

    <div class="field">
      <label>{L.perms}</label>
      <div class="seg" style="width:100%">
        <button class:active={approvalMode === 'sensitive'} onclick={() => setMode('sensitive')} title={L.permSensitive}>
          {lang === 'ar' ? 'حساس فقط' : 'Sensitive'}
        </button>
        <button class:active={approvalMode === 'always'} onclick={() => setMode('always')} title={L.permAlways}>
          {lang === 'ar' ? 'الكل' : 'All'}
        </button>
        <button class:active={approvalMode === 'never'} onclick={() => setMode('never')} title={L.permNever}>
          {lang === 'ar' ? 'بدون سؤال' : 'None'}
        </button>
      </div>
      <div class="hint">{L.permsHint}</div>
    </div>

    <div class="field">
      <label>{L.language}</label>
      <div class="seg">
        <button class:active={lang === 'ar'} onclick={() => setUiLang('ar')}>العربية</button>
        <button class:active={lang === 'en'} onclick={() => setUiLang('en')}>English</button>
      </div>
    </div>

    <div class="field">
      <label>{L.skillsBackup}</label>
      <div style="display:flex; gap:6px; flex-wrap:wrap">
        <button class="mini" onclick={exportAllSkills}>{L.exportAll}</button>
        <label class="mini" style="cursor:pointer">
          {L.importAll}
          <input type="file" accept=".json,application/json" style="display:none"
                 onchange={(e) => { importSkillsFile((e.currentTarget as HTMLInputElement).files?.[0]); (e.currentTarget as HTMLInputElement).value = ''; }} />
        </label>
        <button class="mini" onclick={syncNow}>{L.syncNow}</button>
      </div>
      <div class="hint">{L.skillsHint}</div>
      {#if skillsMsg}<div class="hint" style="color:var(--ok)">{skillsMsg}</div>{/if}
    </div>

    <button class="btn" onclick={() => saveAll()}>{L.save}</button>
    {#if saved}<div class="hint ok">{L.saved}</div>{/if}
    {#if notice}<div class="hint" style="color:var(--warn)">{notice}</div>{/if}
    <div class="hint">{L.autosave}<br />{L.privacy}</div>
  </div>
</div>
