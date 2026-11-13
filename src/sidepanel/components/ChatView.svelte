<script lang="ts">
  // الشات: الرسائل + الرسالة الحية + المترجم/الملء + الموافقات + التقدم — عرض فقط
  import type { ChatMessage, ToolCallInfo } from '../../shared/types';
  import type { Lang } from '../../shared/i18n';
  import Message from './Message.svelte';

  let {
    messages, liveText, livePlan, toolCalls, busy, approvals, progress, lang,
    send, stop, approve, retry,
  }: {
    messages: ChatMessage[];
    liveText: string;
    livePlan: string[];
    toolCalls: ToolCallInfo[];
    busy: boolean;
    approvals: Array<{ id: string; tool: string; args: unknown; steps?: string[] }>;
    progress: string;
    lang: Lang;
    send: (text: string) => void;
    stop: () => void;
    approve: (id: string, ok: boolean) => void;
    retry: () => void;
  } = $props();

  let text = $state('');
  let scroller = $state<HTMLElement>();

  const d = $derived(lang === 'ar' ? dictAr : dictEn);
  const dictAr = {
    placeholder: 'اطلب أي شيء… مثل: لخص هذه الصفحة',
    stop: 'إيقاف', retry: 'إعادة المحاولة', plan: 'خطة معلنة',
    batch: 'موافقة على تسلسل كامل', action: 'إجراء حساس',
    approve: 'موافقة', refuse: 'رفض', approveAll: 'موافقة على الكل',
  };
  const dictEn = {
    placeholder: 'Ask anything… e.g. summarize this page',
    stop: 'Stop', retry: 'Retry', plan: 'Declared plan',
    batch: 'Approve full sequence', action: 'Sensitive action',
    approve: 'Approve', refuse: 'Refuse', approveAll: 'Approve all',
  };

  function submit() {
    const t = text.trim();
    if (!t || busy) return;
    text = '';
    send(t);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  }
  // تمرير تلقائي لأسفل مع كل تغيير
  $effect(() => {
    void messages.length + liveText.length + toolCalls.length;
    requestAnimationFrame(() => scroller?.scrollTo({ top: scroller.scrollHeight }));
  });
</script>

<div class="view">
  <div class="msgs" bind:this={scroller}>
    {#each messages as m (m.id)}
      <Message msg={m} />
    {/each}

    {#if busy}
      <div class="msg assistant" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        {#if livePlan.length}
          <div class="plan-card"><b>{d.plan}</b>
            <ol style="margin:0;padding-inline-start:18px">{#each livePlan as s}<li>{s}</li>{/each}</ol>
          </div>
        {/if}
        {#if toolCalls.length}
          <div class="chips">
            {#each toolCalls as c}<span class="chip {c.status}">{c.name}</span>{/each}
          </div>
        {/if}
        {#if liveText}
          <Message msg={{ id: 'live', role: 'assistant', content: liveText, ts: 0 }} />
        {/if}
      </div>
    {/if}

    {#if !busy && !messages.length}
      <div class="empty">BrowseMate</div>
    {/if}
  </div>

  {#if progress}<div class="progress">⏳ {progress}</div>{/if}

  {#if approvals.length}
    <div class="approvals" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      {#each approvals as a (a.id)}
        <div class="approval">
          <span class="tool">{a.steps ? d.batch : d.action}</span> — <code>{a.tool}</code>
          {#if a.steps?.length}
            <ol class="steps">{#each a.steps as s}<li>{s}</li>{/each}</ol>
          {/if}
          <pre>{JSON.stringify(a.args, null, 1)}</pre>
          <div class="row">
            <button class="btn" onclick={() => approve(a.id, true)}>{d.approve}</button>
            <button class="btn ghost" onclick={() => approve(a.id, false)}>{d.refuse}</button>
          </div>
        </div>
      {/each}
      {#if approvals.length > 1}
        <button class="btn" onclick={() => approvals.forEach((a) => approve(a.id, true))}>{d.approveAll}</button>
      {/if}
    </div>
  {/if}

  <div class="composer" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
    <textarea
      bind:value={text}
      onkeydown={onKey}
      placeholder={d.placeholder}
      disabled={busy}
      rows="1"
    ></textarea>
    {#if busy}
      <button class="btn ghost" onclick={stop}>{d.stop}</button>
    {:else}
      <button class="btn" onclick={submit} disabled={!text.trim()}>{lang === 'ar' ? 'إرسال' : 'Send'}</button>
    {/if}
  </div>

  {#if !busy && messages.length && messages[messages.length - 1].content.startsWith('> ⚠️')}
    <div style="padding: 0 10px 10px">
      <button class="mini" onclick={retry}>{d.retry} ↻</button>
    </div>
  {/if}
</div>
