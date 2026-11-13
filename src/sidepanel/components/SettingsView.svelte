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
    const res: any = await rpc('list-models');
    if (res.ok) {
      models = res.models;
      if (!models.includes(model)) model = models[0] ?? '';
    } else {
      notice = res.error;
    }
  }

  async function save() {
    await rpc('save-settings', { patch: { baseUrl, apiKey, model } });
    notice = L.saved;
    setTimeout(() => (notice = ''), 1800);
  }
</script>

<div class="view">
  <div class="form" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
    <div class="field">
      <label>{L.baseUrl}</label>
      <input bind:value={baseUrl} placeholder="https://api.example.com/v1" dir="ltr" spellcheck="false" />
    </div>
    <div class="field">
      <label>{L.apiKey}</label>
      <input type="password" bind:value={apiKey} dir="ltr" spellcheck="false" autocomplete="off" />
    </div>
    <div class="field">
      <label>{L.model}</label>
      {#if models.length}
        <select bind:value={model}>
          {#each models as m}<option value={m}>{m}</option>{/each}
        </select>
      {:else}
        <input bind:value={model} dir="ltr" placeholder={L.select} spellcheck="false" />
      {/if}
      <button class="mini" style="margin-top:6px; width:fit-content" onclick={() => fetchModels()}>⇩ {L.fetch}</button>
    </div>
    <div class="field">
      <label>{L.language}</label>
      <div class="seg">
        <button class:active={lang === 'ar'} onclick={() => setUiLang('ar')}>العربية</button>
        <button class:active={lang === 'en'} onclick={() => setUiLang('en')}>English</button>
      </div>
    </div>
    <button class="btn" onclick={save}>{L.save}</button>
    {#if notice}<div class="toast">{notice}</div>{/if}
    <p class="hint">المفتاح يُحفظ على جهازك فقط (chrome.storage.local) — لا backend.</p>
  </div>
</div>
