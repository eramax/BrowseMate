<script lang="ts">
  // رسالة واحدة — dir حسب لغة نصها (RTL عربي)، markdown متدفق للردود عبر Flowdown
  import { attach, type FlowView } from '../lib/flowdown';
  import { textDir } from '../../shared/i18n';
  import type { ChatMessage } from '../../shared/types';

  let { msg }: { msg: ChatMessage } = $props();
  let host = $state<HTMLElement>();
  let view: FlowView | undefined;
  const dir = $derived(textDir(msg.content));

  $effect(() => {
    if (!host) return;
    view = attach(host);
    view.update(msg.content, {});
    return () => view.destroy();
  });
  // التحديث عند تغير النص (رسالة قائمة تُعدل نادراً — لأجل retry/live swap)
  $effect(() => { view?.update(msg.content, {}); });
</script>

{#if msg.role === 'user'}
  <div class="msg user" dir={dir}>{msg.content}</div>
{:else}
  <div class="msg assistant" dir={dir}>
    {#if msg.plan?.length}
      <div class="plan-card">
        <b>الخطة</b>
        <ol style="margin:0; padding-inline-start:18px">
          {#each msg.plan as s}<li>{s}</li>{/each}
        </ol>
      </div>
    {/if}
    {#if msg.toolCalls?.length}
      <div class="chips">
        {#each msg.toolCalls as c}
          <span class="chip {c.status}">{c.name}</span>
        {/each}
      </div>
    {/if}
    {#if msg.content}
      <div class="flow-host" bind:this={host}></div>
    {/if}
  </div>
{/if}
