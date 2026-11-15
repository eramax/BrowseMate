<script lang="ts">
  // الشات: مبدّل الجلسات مدمج + الرسائل + مؤشر عمل حي + الموافقات + التقدم
  import type { ChatMessage, ToolCallInfo, TtsPanelState, VoiceMessage as VoiceData } from '../../shared/types';
  import type { Lang } from '../../shared/i18n';
  import Message from './Message.svelte';
  import VoiceMessage from './VoiceMessage.svelte';

  let {
    messages, liveText, livePlan, toolCalls, busy, approvals, progress, lang,
    sessions, currentId, settingsError, stalled,
    send, stop, approve, retry, openSettings,
    openSession, createSession, removeSession, queuedText,
    ttsState, ttsPlay, ttsPause, ttsStop, ttsSeek, ttsReplay, ttsPrev, ttsNext, ttsReplayVoice, ttsDownloadVoice,
  }: {
    messages: ChatMessage[];
    liveText: string;
    livePlan: string[];
    toolCalls: ToolCallInfo[];
    busy: boolean;
    approvals: Array<{ id: string; tool: string; args: unknown; steps?: string[] }>;
    progress: string;
    lang: Lang;
    sessions: Array<{ id: string; title: string; updatedAt: number; createdAt: number }>;
    currentId: string;
    settingsError: boolean;
    stalled: boolean;
    send: (text: string) => void;
    stop: () => void;
    approve: (id: string, ok: boolean) => void;
    retry: () => void;
    openSettings: () => void;
    openSession: (id: string) => void;
    createSession: () => void;
    removeSession: (id: string) => void;
    queuedText: string;
    ttsState: TtsPanelState | null;
    ttsPlay: () => void;
    ttsPause: () => void;
    ttsStop: () => void;
    ttsSeek: (time: number) => void;
    ttsReplay: () => void;
    ttsPrev: () => void;
    ttsNext: () => void;
    ttsReplayVoice: (v: VoiceData) => void;
    ttsDownloadVoice: (v: VoiceData) => Promise<any> | void;
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
    stalled: 'توقف التنفيذ قبل الاكتمال (انقطاع الخدمة) — يمكنك إعادة المحاولة',
    queued: 'سيُرسل بعد انتهاء الرد الحالي',
  } : {
    placeholder: 'Ask anything… e.g. summarize this page',
    stop: 'Stop', retry: 'Retry', plan: 'Declared plan',
    batch: 'Approve full sequence', action: 'Sensitive action',
    approve: 'Approve', refuse: 'Refuse', approveAll: 'Approve all',
    working: 'Working', running: 'Running', settings: 'Complete model settings to continue',
    openSettings: 'Open settings', noSessions: 'No sessions', newSession: 'New session',
    stalled: 'The run stopped before finishing (connection lost) — you can retry',
    queued: 'Will send after the current reply finishes',
  });

  const currentTitle = $derived(sessions.find((s) => s.id === currentId)?.title ?? L.newSession);
  // رقم تسلسلي ثابت حسب تاريخ الإنشاء (الأقدم = 1)
  const sessionNumbers = $derived.by(() => {
    const ordered = [...sessions].sort((a, b) => {
      const ac = a.createdAt || 0;
      const bc = b.createdAt || 0;
      if (ac && bc && ac !== bc) return ac - bc;
      return a.id.localeCompare(b.id);
    });
    return new Map(ordered.map((s, i) => [s.id, i + 1]));
  });
  const currentNumber = $derived(sessionNumbers.get(currentId));
  const runningTool = $derived(toolCalls.find((c) => c.status === 'running')?.name);
  // صوت مرتبط بهذه الجلسة فقط — لا يظهر مشغل جلسة أخرى
  const sessionTts = $derived(ttsState && ttsState.sessionId === currentId ? ttsState : null);

  // الرسالة الصوتية المحفوظة المطابقة للصوت الحالي (لتشغيلها كمشغل واحد)
  const activeHistoryVoiceId = $derived.by(() => {
    if (!sessionTts?.active) return '';
    const rev = [...messages].reverse();
    // المسار الدقيق: نفس معرّف الرسالة الصوتية عبر كل فقرات القراءة
    if (sessionTts.voiceId) {
      for (const m of rev) {
        for (const v of m.voices ?? []) {
          if (v.id === sessionTts.voiceId) return v.id;
        }
      }
    }
    for (const m of rev) {
      for (const v of [...(m.voices ?? [])].reverse()) {
        if (v.text === sessionTts.text && (v.voice || '') === (sessionTts.voice || '')) return v.id;
      }
    }
    // توافق مع رسائل قديمة بلا voiceId
    if (!sessionTts.voiceId && sessionTts.tabId != null) {
      for (const m of rev) {
        const v = m.voices?.[m.voices.length - 1];
        if (v) return v.id;
      }
    }
    return '';
  });

  function historyPlayer(v: VoiceData): TtsPanelState {
    return {
      active: true,
      playing: false,
      engine: v.engine,
      title: '',
      text: v.text,
      index: 0,
      total: 1,
      currentTime: 0,
      duration: 0,
      tabId: null,
      voice: v.voice,
      rate: v.rate,
      sessionId: currentId,
      voiceId: v.id,
    };
  }

  function livePlay(): void {
    if (!sessionTts) return;
    const ended = sessionTts.status === 'ended'
      || (sessionTts.duration > 0 && sessionTts.currentTime >= sessionTts.duration - 0.25);
    if (!ended && sessionTts.currentTime > 0.2) ttsPlay();
    else ttsReplay();
  }
  const suggestions = $derived(lang === 'ar' ? [
    'لخّص هذه الصفحة',
    'ما أخطاء console في هذه الصفحة؟',
    'جمّع تبويباتي في مجموعات حسب الموضوع',
    'ابحث عن سعر OnePlus 16',
  ] : [
    'Summarize this page',
    'What console errors are on this page?',
    'Group my tabs by topic',
    'Find the OnePlus 16 price',
  ]);

  function submit() {
    const t = text.trim();
    if (!t) return;
    text = '';
    send(t);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  }
  $effect(() => {
    void messages.length + liveText.length + toolCalls.length + (sessionTts?.active ? 1 : 0);
    requestAnimationFrame(() => scroller?.scrollTo({ top: scroller.scrollHeight }));
  });
</script>

<div class="view">
  <!-- مبدّل الجلسات داخل الشات -->
  <div class="session-bar" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
    <button class="session-btn" onclick={() => (menuOpen = !menuOpen)}>
      {#if currentNumber}<span class="s-num">#{currentNumber}</span>{/if}
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
            <span class="s-num">#{sessionNumbers.get(s.id) ?? '?'}</span>
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

  {#if stalled}
    <div class="banner" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <span>⏹️ {L.stalled}</span>
      <button class="mini" onclick={retry}>↻ {L.retry}</button>
    </div>
  {/if}

  <div class="msgs" bind:this={scroller}>
    {#each messages as m (m.id)}
      <Message msg={m} {lang}>
        {#if m.voices?.length}
          <div class="voice-stack">
            {#each m.voices as v (v.id)}
              {#if sessionTts?.active && v.id === activeHistoryVoiceId}
                <VoiceMessage
                  player={sessionTts}
                  {lang}
                  live={true}
                  onPlay={livePlay}
                  onPause={ttsPause}
                  onStop={ttsStop}
                  onSeek={ttsSeek}
                  onPrev={ttsPrev}
                  onNext={ttsNext}
                  onDownload={() => ttsDownloadVoice({
                    id: sessionTts?.voiceId || '',
                    text: sessionTts?.text || '',
                    voice: sessionTts?.voice || '',
                    rate: sessionTts?.rate || 1,
                    engine: sessionTts?.engine || 'edge',
                    createdAt: Date.now(),
                  })}
                />
              {:else}
                <VoiceMessage
                  player={historyPlayer(v)}
                  {lang}
                  live={false}
                  onReplay={() => ttsReplayVoice(v)}
                  onDownload={() => ttsDownloadVoice(v)}
                />
              {/if}
            {/each}
          </div>
        {/if}
      </Message>
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
        <Message msg={{ id: 'live', role: 'assistant', content: liveText, ts: 0 }} {lang} />
      {:else if !toolCalls.length}
        <div class="typing" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
          <span class="dot"></span><span class="dot"></span><span class="dot"></span>
          <span>{L.working}…</span>
        </div>
      {/if}
    {/if}

    {#if !busy && !messages.length && !settingsError}
      <div class="empty">
        <div class="logo">B</div>
        <span>BrowseMate</span>
        <div class="suggestions">
          {#each suggestions as s}
            <button class="suggestion" onclick={() => send(s)}>{s}</button>
          {/each}
        </div>
      </div>
    {/if}

    {#if sessionTts?.active && !activeHistoryVoiceId}
      <div class="msg assistant voice-msg" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <div class="who"><span class="logo">B</span> BrowseMate</div>
        <VoiceMessage
          player={sessionTts}
          {lang}
          live={true}
          onPlay={livePlay}
          onPause={ttsPause}
          onStop={ttsStop}
          onSeek={ttsSeek}
          onPrev={ttsPrev}
          onNext={ttsNext}
        />
      </div>
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

  {#if queuedText}
    <div class="queued" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <span class="q-label">⏳ {L.queued}</span>
      <span class="q-text">{queuedText}</span>
    </div>
  {/if}

  <div class="composer" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
    <textarea bind:value={text} onkeydown={onKey} placeholder={L.placeholder} rows="1"></textarea>
    <button
      class="btn"
      onclick={() => (busy && !text.trim() ? stop() : submit())}
      disabled={!text.trim() && !busy}
    >
      {busy && !text.trim() ? L.stop : (lang === 'ar' ? 'إرسال' : 'Send')}
    </button>
  </div>

  {#if !busy && messages.length && messages[messages.length - 1].content.includes('⚠️')}
    <div style="padding: 0 12px 10px"><button class="mini" onclick={retry}>↻ {L.retry}</button></div>
  {/if}
</div>
