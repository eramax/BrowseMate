<script lang="ts">
  // الشات: مبدّل الجلسات مدمج + الرسائل + مؤشر عمل حي + الموافقات + التقدم
  import type { ChatMessage, ToolCallInfo } from '../../shared/types';
  import type { Lang } from '../../shared/i18n';
  import Message from './Message.svelte';

  let {
    messages, liveText, livePlan, toolCalls, busy, approvals, progress, lang,
    sessions, currentId, settingsError,
    send, stop, approve, retry, openSettings,
    openSession, createSession, removeSession,
  }: {
    messages: ChatMessage[];
    liveText: string;
    livePlan: string[];
    toolCalls: ToolCallInfo[];
    busy: boolean;
    approvals: Array<{ id: string; tool: string; args: unknown; steps?: string[] }>;
    progress: string;
    lang: Lang;
    sessions: Array<{ id: string; title: string; updatedAt: number }>;
    currentId: string;
    settingsError: boolean;
    send: (text: string) => void;
    stop: () => void;
    approve: (id: string, ok: boolean) => void;
    retry: () => void;
    openSettings: () => void;
    openSession: (id: string) => void;
    createSession: () => void;
    removeSession: (id: string) => void;
  } = $props();

  let text = $state('');
  let scroller = $state<HTMLElement>();
  let menuOpen = $state(false);

  const L = $derived(lang === 'ar' ? {
    placeholder: 'اطلب أي شيء… مثل: لخص هذه الصفحة',
    stop: 'إيقاف', retry: 'إعادة المحاولة', plan: 'خطة معلنة',
    batch: 'موافقة على تسلسل كامل', action: 'إجراء حساس',
    approve: 'موافقة', refuse: 'رفض', approveAll: 'موافقة على الكل',
    working: 'يعمل', running: 'ينفذ', settings: 'أكمل إعدادات النموذج للمتابعة',
    openSettings: 'فتح الإعدادات', noSessions: 'لا جلسات', newSession: 'جلسة جديدة',
  } : {
    placeholder: 'Ask anything… e.g. summarize this page',
    stop: 'Stop', retry: 'Retry', plan: 'Declared plan',
    batch: 'Approve full sequence', action: 'Sensitive action',
    approve: 'Approve', refuse: 'Refuse', approveAll: 'Approve all',
    working: 'Working', running: 'Running', settings: 'Complete model settings to continue',
    openSettings: 'Open settings', noSessions: 'No sessions', newSession: 'New session',
  });

  const currentTitle = $derived(sessions.find((s) => s.id === currentId)?.title ?? L.newSession);
  const runningTool = $derived(toolCalls.find((c) => c.status === 'running')?.name);

  function submit() {
    const t = text.trim();
    if (!t || busy) return;
    text = '';
    send(t);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  }
  $effect(() => {
    void messages.length + liveText.length + toolCalls.length;
    requestAnimationFrame(() => scroller?.scrollTo({ top: scroller.scrollHeight }));
  });
</script>

<div class="view">
  <!-- مبدّل الجلسات داخل الشات -->
  <div class="session-bar" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
    <button class="session-btn" onclick={() => (menuOpen = !menuOpen)}>
      <span class="s-title">{currentTitle}</span>
      <span class="chev">▾</span>
    </button>
    <button class="mini" onclick={createSession} title={L.newSession}>＋</button>
    {#if menuOpen}
      <div class="backdrop" onclick={() => (menuOpen = false)}></div>
      <div class="session-menu">
        {#if !sessions.length}<div class="empty" style="padding:12px">{L.noSessions}</div>{/if}
        {#each sessions as s (s.id)}
          <div class="s-item" class:active={s.id === currentId}>
            <span class="s-name" onclick={() => { openSession(s.id); menuOpen = false; }}>{s.title}</span>
            <button class="mini danger" onclick={() => removeSession(s.id)}>✕</button>
          </div>
        {/each}
      </div>
    {/if}
    {#if busy}<span class="working"><span class="dot"></span>{runningTool ? `${L.running}: ${runningTool}` : `${L.working}…`}</span>{/if}
  </div>

  {#if settingsError}
    <div class="banner" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <span>⚠️ {L.settings}</span>
      <button class="mini" onclick={openSettings}>{L.openSettings}</button>
    </div>
  {/if}

  <div class="msgs" bind:this={scroller}>
    {#each messages as m (m.id)}
      <Message msg={m} />
    {/each}

    {#if busy}
      {#if livePlan.length}
        <div class="plan-card" dir={lang === 'ar' ? 'rtl' : 'ltr'}><b>{L.plan}</b>
          <ol style="margin:0;padding-inline-start:18px">{#each livePlan as s}<li>{s}</li>{/each}</ol>
        </div>
      {/if}
      {#if toolCalls.length}
        <div class="chips" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
          {#each toolCalls as c}<span class="chip {c.status}">{c.name}</span>{/each}
        </div>
      {/if}
      {#if liveText}
        <Message msg={{ id: 'live', role: 'assistant', content: liveText, ts: 0 }} />
      {:else if !toolCalls.length}
        <div class="typing" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
          <span class="dot"></span><span class="dot"></span><span class="dot"></span>
          <span>{L.working}…</span>
        </div>
      {/if}
    {/if}

    {#if !busy && !messages.length && !settingsError}
      <div class="empty">BrowseMate</div>
    {/if}
  </div>

  {#if progress}<div class="progress" dir={lang === 'ar' ? 'rtl' : 'ltr'}>⏳ {progress}</div>{/if}

  {#if approvals.length}
    <div class="approvals" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      {#each approvals as a (a.id)}
        <div class="approval">
          <span class="tool">{a.steps ? L.batch : L.action}</span> — <code>{a.tool}</code>
          {#if a.steps?.length}
            <ol class="steps">{#each a.steps as s}<li>{s}</li>{/each}</ol>
          {/if}
          <pre>{JSON.stringify(a.args, null, 1)}</pre>
          <div class="row">
            <button class="btn" onclick={() => approve(a.id, true)}>{L.approve}</button>
            <button class="btn ghost" onclick={() => approve(a.id, false)}>{L.refuse}</button>
          </div>
        </div>
      {/each}
      {#if approvals.length > 1}
        <button class="btn" onclick={() => approvals.forEach((a) => approve(a.id, true))}>{L.approveAll}</button>
      {/if}
    </div>
  {/if}

  <div class="composer" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
    <textarea bind:value={text} onkeydown={onKey} placeholder={L.placeholder} disabled={busy} rows="1"></textarea>
    {#if busy}
      <button class="btn ghost" onclick={stop}>{L.stop}</button>
    {:else}
      <button class="btn" onclick={submit} disabled={!text.trim()}>{lang === 'ar' ? 'إرسال' : 'Send'}</button>
    {/if}
  </div>

  {#if !busy && messages.length && messages[messages.length - 1].content.includes('⚠️')}
    <div style="padding: 0 12px 10px"><button class="mini" onclick={retry}>↻ {L.retry}</button></div>
  {/if}
</div>
