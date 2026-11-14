<script lang="ts">
  // رسالة واحدة — dir حسب لغة النص، markdown متدفق، وأزرار تحميل/طباعة للمستندات
  import { attach, type FlowView } from '../lib/flowdown';
  import { textDir } from '../../shared/i18n';
  import { rpc } from '../lib/port';
  import type { ChatMessage } from '../../shared/types';
  import type { Snippet } from 'svelte';

  let {
    msg,
    lang = 'en',
    children,
  }: {
    msg: ChatMessage;
    lang?: 'ar' | 'en';
    /** محتوى إضافي داخل رسالة المساعد (مثل بطاقة صوتية) */
    children?: Snippet;
  } = $props();

  let host = $state<HTMLElement>();
  let view: FlowView | undefined;
  const dir = $derived(textDir(msg.content));
  const planLabel = $derived(lang === 'ar' ? 'الخطة' : 'Plan');
  const L = $derived(lang === 'ar'
    ? { download: '⬇ تحميل', print: '🖨 طباعة / PDF' }
    : { download: '⬇ Download', print: '🖨 Print / PDF' });

  $effect(() => {
    if (!host) return;
    view = attach(host);
    view.update(msg.content, {});
    return () => view.destroy();
  });
  $effect(() => { view?.update(msg.content, {}); });

  async function download(id: string, filename: string) {
    const res: any = await rpc('download-artifact', { id });
    if (!res.ok) return;
    const a = document.createElement('a');
    a.href = res.url;
    a.download = res.filename || filename;
    a.click();
  }
  async function print(id: string) {
    await rpc('print-artifact', { id });
  }
</script>

{#if msg.role === 'user'}
  <div class="msg user" dir={dir}>{msg.content}</div>
{:else}
  <div class="msg assistant" dir={dir}>
    <div class="who"><span class="logo">B</span> BrowseMate</div>
    {#if msg.plan?.length}
      <div class="plan-card">
        <b>{planLabel}</b>
        <ol style="margin:0;padding-inline-start:18px">{#each msg.plan as s}<li>{s}</li>{/each}</ol>
      </div>
    {/if}
    {#if msg.toolCalls?.length}
      <div class="chips">
        {#each msg.toolCalls as c}<span class="chip {c.status}">{c.name}</span>{/each}
      </div>
    {/if}
    {#if msg.artifacts?.length}
      <div class="artifacts">
        {#each msg.artifacts as a (a.id)}
          <div class="artifact">
            <span class="fname" dir="ltr">📄 {a.filename} <small>{a.sizeKb}KB</small></span>
            <button class="mini accent" onclick={() => download(a.id, a.filename)}>{L.download}</button>
            <button class="mini" onclick={() => print(a.id)}>{L.print}</button>
          </div>
        {/each}
      </div>
    {/if}
    {#if msg.content}
      <div class="flow-host" bind:this={host}></div>
    {/if}
    {@render children?.()}
  </div>
{/if}
