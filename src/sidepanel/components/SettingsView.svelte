<script lang="ts">
  // الإعدادات داخل الـ panel — حفظ تلقائي + منتقي نماذج قابل للبحث
  import { rpc } from '../lib/port';
import { fromSkillMd, toSkillMd } from '../../shared/skill-md';
import { createZip, readZip } from '../../shared/zip';
  import type { Lang } from '../../shared/i18n';

  let { lang, setUiLang, sessionId }: { lang: Lang; setUiLang: (l: Lang) => void; sessionId: string } = $props();

  let baseUrl = $state('');
  let apiKey = $state('');
  let model = $state('');
  let models = $state<string[]>([]);
  let notice = $state('');
  let saved = $state(false);
  let open = $state(false);
  let approvalMode = $state<'sensitive' | 'always' | 'never'>('sensitive');
  let debug = $state(false);
  let debugMsg = $state('');
  let debugPreview = $state('');
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
    debug: 'التشخيص',
    debugToggle: 'تسجيل تشخيصي مفصل لكل جلسة',
    debugHint: 'يسجل الرسائل، تعليمات النموذج، كل أجزاء البث، الأدوات (الوسائط/النتيجة/المدة/الأخطاء)، الموافقات، والاستخدام. يُخزّن آخر ~2MB لكل جلسة في chrome.storage.local. قد يحتوي بيانات حساسة.',
    debugView: 'عرض سجل الجلسة',
    debugDownload: 'تنزيل سجل الجلسة',
    debugAll: 'تنزيل كل السجلات',
    debugClear: 'مسح السجلات',
    debugEmpty: 'لا يوجد سجل لهذه الجلسة بعد.',
    debugCleared: 'تم مسح سجلات التشخيص.',
    debugConfirm: 'مسح كل سجلات التشخيص؟',
    debugEntries: 'مدخلات',
    debugSessions: 'جلسات',
    debugOn: 'تم تفعيل التسجيل التشخيصي.',
    debugOff: 'تم إيقاف التسجيل التشخيصي.',
    skillsBackup: 'نسخ احتياطي للمهارات',
    exportAll: '⤓ تصدير كل المهارات',
    importAll: '⇪ استيراد ملف مهارات',
    syncNow: '↻ مزامنة الآن',
    skillsHint: 'الصيغة الوحيدة SKILL.md (frontmatter + markdown). التصدير الجماعي ZIP يحتوي skills/<name>/SKILL.md.',
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
    debug: 'Debug',
    debugToggle: 'Detailed per-session debug logging',
    debugHint: 'Logs messages, model instructions, every stream part, tools (args/result/duration/errors), approvals and usage. Keeps ~2MB per session in chrome.storage.local. May contain sensitive data.',
    debugView: 'View session log',
    debugDownload: 'Download session log',
    debugAll: 'Download all logs',
    debugClear: 'Clear logs',
    debugEmpty: 'No log for this session yet.',
    debugCleared: 'Debug logs cleared.',
    debugConfirm: 'Clear all debug logs?',
    debugEntries: 'entries',
    debugSessions: 'sessions',
    debugOn: 'Debug logging enabled.',
    debugOff: 'Debug logging disabled.',
    skillsBackup: 'Skills backup',
    exportAll: '⤓ Export all skills',
    importAll: '⇪ Import skills file',
    syncNow: '↻ Sync now',
    skillsHint: 'Only SKILL.md (frontmatter + markdown). Bulk export is a ZIP of skills/<name>/SKILL.md.',
  });

  oninit();

  async function oninit() {
    const res: any = await rpc('get-settings');
    baseUrl = res.settings.baseUrl;
    apiKey = res.settings.apiKey;
    model = res.settings.model;
    approvalMode = res.settings.approvalMode ?? 'sensitive';
    debug = Boolean(res.settings.debug);
    if (baseUrl && apiKey) await fetchModels(true);
    await refreshSyncStatus();
  }

  async function refreshSyncStatus() {
    const res: any = await rpc('skills-sync', { now: false });
    if (!res.ok) return;
    const st = res.status;
    const when = st.updatedAt ? new Date(st.updatedAt).toLocaleTimeString(lang === 'ar' ? 'ar' : 'en', { hour: '2-digit', minute: '2-digit' }) : '—';
    const kb = (n: number) => `${(n / 1024).toFixed(1)}KB`;
    const usage = st.usage ? `${kb(st.usage.usedBytes)} / ${kb(st.usage.quotaBytes)} (${st.usage.percent}%)` : '';
    skillsMsg = st.error
      ? `⚠️ ${st.error}`
      : lang === 'ar'
        ? `${st.mode === 'sync' ? 'مزامنة مع حساب المتصفح' : 'نسخة محلية (sync غير متاح)'} — ${st.count} مهارة — ${usage} — ${when}`
        : `${st.mode === 'sync' ? 'Synced with browser account' : 'Local fallback (sync unavailable)'} — ${st.count} skills — ${usage} — ${when}`;
  }

  async function syncNow() {
    const res: any = await rpc('skills-sync', { now: true });
    if (res.ok) {
      const st = res.status;
      const kb = (n: number) => `${(n / 1024).toFixed(1)}KB`;
      const usage = st.usage ? `${kb(st.usage.usedBytes)} / ${kb(st.usage.quotaBytes)} (${st.usage.percent}%)` : '';
      skillsMsg = st.error
        ? `⚠️ ${st.error}`
        : lang === 'ar' ? `تمت المزامنة (${st.count} مهارة — ${usage})` : `Synced (${st.count} skills — ${usage})`;
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

  // ===== Debug =====
  async function toggleDebug() {
    debug = !debug;
    await rpc('save-settings', { patch: { debug } });
    debugMsg = debug ? L.debugOn : L.debugOff;
  }

  function saveJson(name: string, data: unknown) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function viewDebug() {
    const res: any = await rpc('get-debug-log', { sessionId });
    if (!res.ok || !res.log) { debugPreview = ''; debugMsg = L.debugEmpty; return; }
    const text = JSON.stringify(res.log, null, 2);
    debugPreview = text.length > 400000 ? `${text.slice(0, 400000)}\n…` : text;
    debugMsg = `${res.log.entries?.length ?? 0} ${L.debugEntries}`;
  }

  async function downloadDebug() {
    const res: any = await rpc('get-debug-log', { sessionId });
    if (!res.log) { debugMsg = L.debugEmpty; return; }
    saveJson(`browsemate-debug-${sessionId || 'session'}.json`, res.log);
    debugMsg = `${res.log.entries?.length ?? 0} ${L.debugEntries}`;
  }

  async function downloadAllDebug() {
    const res: any = await rpc('get-debug-all');
    if (!res.ok) return;
    saveJson('browsemate-debug-all.json', res.logs);
    debugMsg = `${res.logs?.length ?? 0} ${L.debugSessions}`;
  }

  async function clearDebug() {
    if (!confirm(L.debugConfirm)) return;
    await rpc('clear-debug');
    debugPreview = '';
    debugMsg = L.debugCleared;
  }

  // ===== نسخ احتياطي للمهارات (SKILL.md / ZIP فقط) =====
  async function exportAllSkills() {
    const res: any = await rpc('list-skills');
    if (!res.ok) { skillsMsg = res.error; return; }
    const files = (res.skills as any[]).map((s) => ({
      path: `skills/${String(s.name).replace(/[\\/:*?"<>|]+/g, '-')}/SKILL.md`,
      data: toSkillMd(s),
    }));
    const zip = createZip(files);
    const url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'browsemate-skills.zip';
    a.click();
    URL.revokeObjectURL(url);
    skillsMsg = lang === 'ar' ? `تم تصدير ${files.length} مهارة (ZIP / SKILL.md)` : `Exported ${files.length} skills (ZIP / SKILL.md)`;
  }

  async function importSkillsFile(file: File | undefined) {
    if (!file) return;
    try {
      const entries: Array<{ path: string; text: string }> = [];
      if (file.name.toLowerCase().endsWith('.zip')) {
        const zip = await readZip(new Uint8Array(await file.arrayBuffer()));
        for (const e of zip) {
          if (/\.md$/i.test(e.path) && !e.path.endsWith('/')) entries.push({ path: e.path, text: e.data });
        }
      } else {
        entries.push({ path: file.name, text: await file.text() });
      }
      if (!entries.length) { skillsMsg = lang === 'ar' ? 'لا ملفات SKILL.md داخل الأرشيف' : 'No SKILL.md files in archive'; return; }

      let ok = 0;
      const errs: string[] = [];
      for (const e of entries) {
        const parsed = fromSkillMd(e.text);
        if (parsed.error || !parsed.skill) { errs.push(`${e.path}: ${parsed.error ?? 'صيغة غير صالحة'}`); continue; }
        const r: any = await rpc('import-skill', { skill: parsed.skill });
        if (r.ok) ok++;
        else errs.push(`${parsed.skill.name}: ${r.error}`);
      }
      skillsMsg = lang === 'ar'
        ? `تم استيراد ${ok}${errs.length ? ` — فشل ${errs.length}: ${errs[0]}` : ''}`
        : `Imported ${ok}${errs.length ? ` — ${errs.length} failed: ${errs[0]}` : ''}`;
    } catch (e: any) {
      skillsMsg = `SKILL.md/ZIP: ${e.message}`;
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
      <label>{L.debug}</label>
      <label style="display:flex; align-items:center; gap:8px">
        <input type="checkbox" checked={debug} onchange={toggleDebug} />
        <span>{L.debugToggle}</span>
      </label>
      <div class="hint">{L.debugHint}</div>
      <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px">
        <button class="mini" onclick={viewDebug}>{L.debugView}</button>
        <button class="mini" onclick={downloadDebug}>{L.debugDownload}</button>
        <button class="mini" onclick={downloadAllDebug}>{L.debugAll}</button>
        <button class="mini danger" onclick={clearDebug}>{L.debugClear}</button>
      </div>
      {#if debugMsg}<div class="hint">{debugMsg}</div>{/if}
      {#if debugPreview}<pre class="debug-pre">{debugPreview}</pre>{/if}
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
          <input type="file" accept=".md,.markdown,.zip,text/markdown,application/zip" style="display:none"
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
