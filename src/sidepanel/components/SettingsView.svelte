<script lang="ts">
  // الإعدادات داخل الـ panel — Base URL + API key + سحب النماذج + اللغة
  import { rpc } from '../lib/port';
  import type { Settings } from '../../background/settings';
  import type { Lang } from '../../shared/i18n';

  let { lang, setUiLang }: { lang: Lang; setUiLang: (l: Lang) => void } = $props();

  let baseUrl = $state('');
  let apiKey = $state('');
  let model = $state('');
  let models = $state<string[]>([]);
  let notice = $state('');
  let open = $state(false);
  const filtered = $derived(
    model
      ? models.filter((m) => m.toLowerCase().includes(model.toLowerCase()))
      : models,
  );

  async function selectModel(m: string) {
    model = m;
    open = false;
    await saveAll();
  }

  const L = $derived(lang === 'ar' ? {
    baseUrl: 'Base URL', apiKey: 'API Key', model: 'النموذج',
    fetch: 'جلب النماذج', language: 'اللغة', save: 'حفظ', saved: 'تم الحفظ ✓',
    fillFirst: 'أكمل Base URL وAPI Key أولاً', select: 'اختر نموذجًا',
  } : {
    baseUrl: 'Base URL', apiKey: 'API Key', model: 'Model',
    fetch: 'Fetch models', language: 'Language', save: 'Save', saved: 'Saved ✓',
    fillFirst: 'Fill Base URL and API Key first', select: 'Select a model',
  });

  oninit();

  async function oninit() {
    const res: any = await rpc('get-settings');
    baseUrl = res.settings.baseUrl;
    apiKey = res.settings.apiKey;
    model = res.settings.model;
    if (baseUrl && apiKey) await fetchModels(true);
  }

  async function fetchModels(silent = false) {
    if (!baseUrl || !apiKey) { if (!silent) notice = L.fillFirst; return; }
    await saveAll(); // كل الحقول قبل الجلب
    const res: any = await rpc('list-models');
    if (res.ok) {
      models = res.models;
      if (!models.includes(model)) model = models[0] ?? '';
      await saveAll();
    } else {
      notice = res.error === 'FILL_FIRST' ? L.fillFirst : res.error;
    }
  }

  async function saveAll() {
    await rpc('save-settings', { patch: { baseUrl, apiKey, model } });
    notice = L.saved;
    setTimeout(() => (notice = ''), 1500);
  }

  // حفظ تلقائي عند التعديل — يمنع حالة "الحقول ممتلئة والإعدادات فارغة" بعد Reload
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function autosave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveAll, 400);
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
        <div class="dropdown" onfocusout={() => setTimeout(() => (open = false), 150)}>
          {#each filtered.slice(0, 60) as m (m)}
            <div class="opt" role="option" tabindex="0"
                 onclick={() => selectModel(m)}
                 onkeydown={(e) => e.key === 'Enter' && selectModel(m)}>
              {m}
            </div>
          {/each}
        </div>
      {/if}
      <div class="hint">{#if models.length}{filtered.length}/{models.length} نموذج{:else}{L.select}{/if}</div>
      <button class="mini" style="margin-top:6px; width:fit-content" onclick={() => fetchModels()}>⇩ {L.fetch}</button>
    </div>
    <div class="field">
      <label>{L.language}</label>
      <div class="seg">
        <button class:active={lang === 'ar'} onclick={() => setUiLang('ar')}>العربية</button>
        <button class:active={lang === 'en'} onclick={() => setUiLang('en')}>English</button>
      </div>
    </div>
    <button class="btn" onclick={() => saveAll()}>{L.save}</button>
    {#if notice}<div class="toast">{notice}</div>{/if}
    <p class="hint">المفتاح يُحفظ على جهازك فقط (chrome.storage.local) — لا backend.</p>
  </div>
</div>
