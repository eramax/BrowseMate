<script lang="ts">
  // رسالة واحدة — dir حسب لغة النص، markdown متدفق، وزر حفظ الخطوات كمهارة (حتمي)
  import { attach, type FlowView } from '../lib/flowdown';
  import { textDir } from '../../shared/i18n';
  import type { ChatMessage } from '../../shared/types';
  import type { Lang } from '../../shared/i18n';

  let {
    msg, lang, canSaveSkill, onSaveSkill,
  }: {
    msg: ChatMessage;
    lang: Lang;
    canSaveSkill?: boolean;
    onSaveSkill?: (msgId: string, name: string, description: string) => Promise<{ ok: boolean; error?: string }>;
  } = $props();

  let host = $state<HTMLElement>();
  let view: FlowView | undefined;
  const dir = $derived(textDir(msg.content));

  $effect(() => {
    if (!host) return;
    view = attach(host);
    view.update(msg.content, {});
    return () => view.destroy();
  });
  $effect(() => { view?.update(msg.content, {}); });

  // حفظ كمهارة
  let saving = $state(false);
  let name = $state('');
  let desc = $state('');
  let err = $state('');
  const L = $derived(lang === 'ar'
    ? { save: 'احفظ الخطوات كمهارة', name: 'اسم المهارة', desc: 'الوصف (اختياري)', ok: 'حفظ', cancel: 'إلغاء', saved: 'تم الحفظ ✓' }
    : { save: 'Save steps as skill', name: 'Skill name', desc: 'Description (optional)', ok: 'Save', cancel: 'Cancel', saved: 'Saved ✓' });

  async function submit() {
    if (!name.trim() || !onSaveSkill) return;
    const r = await onSaveSkill(msg.id, name, desc);
    if (r.ok) { saving = false; err = L.saved; }
    else err = r.error ?? 'error';
  }
</script>

{#if msg.role === 'user'}
  <div class="msg user" dir={dir}>{msg.content}</div>
{:else}
  <div class="msg assistant" dir={dir}>
    <div class="who"><span class="logo">B</span> BrowseMate</div>
    {#if msg.plan?.length}
      <div class="plan-card">
        <b>الخطة</b>
        <ol style="margin:0;padding-inline-start:18px">{#each msg.plan as s}<li>{s}</li>{/each}</ol>
      </div>
    {/if}
    {#if msg.toolCalls?.length}
      <div class="chips">
        {#each msg.toolCalls as c}<span class="chip {c.status}">{c.name}</span>{/each}
      </div>
    {/if}
    {#if msg.content}
      <div class="flow-host" bind:this={host}></div>
    {/if}

    {#if canSaveSkill && onSaveSkill && msg.toolCalls && msg.toolCalls.filter((c) => c.status === 'ok').length >= 2}
      {#if !saving}
        <div><button class="mini" onclick={() => { saving = true; err = ''; }}>◈ {L.save}</button></div>
      {:else}
        <div class="card" style="gap:6px">
          <input bind:value={name} placeholder={L.name} style="padding:7px 9px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:12px" />
          <input bind:value={desc} placeholder={L.desc} style="padding:7px 9px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:12px" />
          {#if err}<div class="hint" style="color:var(--warn)">{err}</div>{/if}
          <div style="display:flex;gap:6px">
            <button class="mini" style="color:var(--accent);border-color:var(--accent)" onclick={submit}>{L.ok}</button>
            <button class="mini" onclick={() => (saving = false)}>{L.cancel}</button>
          </div>
        </div>
      {/if}
    {/if}
  </div>
{/if}
