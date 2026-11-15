<script lang="ts">
  // BrowseMate — App: يملك Port والأحداث والجلسات؛ العرض في مكوّنات
  import { openPanelPort, rpc } from './lib/port';
  import { setLang as setI18nLang, type Lang } from '../shared/i18n';
  import type { ChatMessage, Session, ToolCallInfo, SkillFile, TtsPanelState, VoiceMessage } from '../shared/types';
  import ChatView from './components/ChatView.svelte';
  import SkillList from './components/SkillList.svelte';
  import SettingsView from './components/SettingsView.svelte';

  type Tab = 'chat' | 'skills' | 'settings';

  let tab = $state<Tab>('chat');
  let lang = $state<Lang>('en');
  let sessionId = $state('');
  let messages = $state<ChatMessage[]>([]);
  let sessionsList = $state<Array<Pick<Session, 'id' | 'title' | 'updatedAt' | 'createdAt'>>>([]);
  let skills = $state<SkillFile[]>([]);

  let busy = $state(false);
  let liveText = $state('');
  let livePlan = $state<string[]>([]);
  let toolCalls = $state<ToolCallInfo[]>([]);
  let approvals = $state<Array<{ id: string; tool: string; args: unknown; steps?: string[] }>>([]);
  let progress = $state('');
  let settingsError = $state(false);
  let stalled = $state(false);
  let lastUserText = $state('');
  let lastSkill = $state<{ name: string; params: Record<string, string> } | undefined>();
  let ttsState = $state<TtsPanelState | null>(null);
  const downloadWaiters = new Map<string, (r: any) => void>();
  let queuedSends = $state<Array<{ text: string; skill?: { name: string; params: Record<string, string> } }>>([]);
  let queuedText = $state('');
  let ackTimer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setInterval> | undefined;

  const dir = $derived(lang === 'ar' ? 'rtl' : 'ltr');
  const tabs = $derived(
    lang === 'ar'
      ? [
          { key: 'chat' as const, label: 'شات' },
          { key: 'skills' as const, label: 'المهارات' },
          { key: 'settings' as const, label: 'الإعدادات' },
        ]
      : [
          { key: 'chat' as const, label: 'Chat' },
          { key: 'skills' as const, label: 'Skills' },
          { key: 'settings' as const, label: 'Settings' },
        ],
  );

  // ===== Port (إعادة اتصال تلقائية + resync) =====
  const port = openPanelPort(handleEvent, () => {
    // SW أُعيد تشغيله: أعد مزامنة الجلسة وتحقق هل التشغيل ما زال حياً
    if (sessionId) loadSession(sessionId);
    if (busy) checkAlive();
  });

  function handleEvent(e: any) {
    // حالة الصوت تُبث لكل البانلات؛ العرض نفسه يفلترها حسب جلسته
    if (e.type === 'tts-state') {
      if (e.state && (!ttsState || (e.state.updatedAt ?? 0) >= (ttsState.updatedAt ?? 0))) ttsState = e.state;
      return;
    }
    if (e.type === 'tts-download-result') {
      const done = downloadWaiters.get(e.requestId);
      if (done) {
        downloadWaiters.delete(e.requestId);
        done(e);
      }
      return;
    }
    // أحداث تشغيل جلسة أخرى لا تخصّ هذه الواجهة
    if (typeof e.sessionId === 'string' && e.sessionId && sessionId && e.sessionId !== sessionId) return;
    switch (e.type) {
      case 'chat-started':
        clearTimeout(ackTimer);
        busy = true; stalled = false; liveText = ''; livePlan = []; toolCalls = [];
        break;
      case 'delta':
        busy = true; liveText = e.text;
        break;
      case 'plan':
        livePlan = e.steps;
        break;
      case 'tool-start':
        toolCalls = [...toolCalls, { ...e.info }];
        break;
      case 'tool-end': {
        const i = toolCalls.findIndex((c) => c.name === e.info.name && c.status === 'running');
        if (i >= 0) toolCalls[i] = { ...e.info };
        else toolCalls = [...toolCalls, { ...e.info }];
        break;
      }
      case 'skill-progress':
        progress = `${e.skill} — ${e.step}/${e.total}`;
        break;
      case 'approval-request':
        approvals = [...approvals, { id: e.id, tool: e.tool, args: e.args, steps: e.steps }];
        break;
      case 'done':
      case 'error': {
        clearTimeout(ackTimer);
        stopWatchdog();
        busy = false; approvals = []; progress = ''; livePlan = []; toolCalls = []; liveText = '';
        if (e.type === 'error') {
          if (e.code === 'SETTINGS_MISSING') settingsError = true;
          else console.warn('BrowseMate:', e.message);
        }
        void loadSession(sessionId).finally(() => setTimeout(flushQueue, 30));
        break;
      }
    }
  }

  // ===== التهيئة =====
  $effect(() => {
    (async () => {
      const s: any = await rpc('get-settings');
      if (s.settings?.lang) setLangUi(s.settings.lang);
      const ens: any = await rpc('ensure-session', { title: s.settings?.lang === 'ar' ? 'جلسة جديدة' : 'New chat' });
      sessionId = ens.id;
      await Promise.all([loadSession(sessionId), refreshSessions()]);
      const tts: any = await rpc('tts-status').catch(() => null);
      if (tts?.ok && (!ttsState || (tts.state?.updatedAt ?? 0) >= (ttsState.updatedAt ?? 0))) ttsState = tts.state;
    })();
  });

  async function loadSession(id: string) {
    if (!id) return;
    const res: any = await rpc('get-session', { id });
    if (res.ok && res.session) {
      // إخفاء مسودات فارغة قديمة (بقايا انقطاع) — لا فقاعات فارغة في الشات
      messages = (res.session.messages as ChatMessage[])
        .filter((m) => m.role !== 'assistant' || m.content.trim() || m.toolCalls?.length || m.voices?.length)
        // رسالة صوتية واحدة لكل رد. للبيانات القديمة نعرض النص الأطول (الأكثر اكتمالاً)،
        // وإذا كان مصدره صوت متصفح نحوّله إلى Edge لأن التشغيل الجديد Edge فقط.
        .map((m) => {
          if (!m.voices?.length) return m;
          const best = m.voices.reduce((a, b) => ((b.text?.length || 0) >= (a.text?.length || 0) ? b : a));
          const isBrowserVoice = best.engine !== 'edge' || !/Neural$/i.test(best.voice || '');
          const voice = isBrowserVoice
            ? (/[\u0600-\u06FF]/.test(best.text) ? 'ar-EG-ShakirNeural' : 'en-US-EmmaMultilingualNeural')
            : best.voice;
          return { ...m, voices: [{ ...best, engine: 'edge' as const, voice }] };
        });
    }
  }
  async function refreshSessions() {
    const res: any = await rpc('list-sessions');
    if (res.ok) sessionsList = res.sessions;
  }
  async function refreshSkills() {
    const res: any = await rpc('list-skills');
    if (res.ok) skills = res.skills;
  }
  $effect(() => { if (tab === 'skills') refreshSkills(); });

  // ===== أوامر الشات =====
  function send(text: string, skill?: { name: string; params: Record<string, string> }) {
    if (busy) {
      if (!text.trim()) return;
      queuedSends = [...queuedSends, { text, ...(skill ? { skill } : {}) }];
      queuedText = text;
      return;
    }
    lastUserText = text;
    lastSkill = skill;
    settingsError = false; stalled = false;
    // عرض فوري لرسالتك قبل أي اتصال (optimistic) — SW يحفظها أيضاً قبل الـ LLM
    messages = [...messages, { id: crypto.randomUUID(), role: 'user', content: text, ts: Date.now() }];
    busy = true; liveText = ''; livePlan = []; toolCalls = [];
    port.send({ type: 'chat', sessionId, text, ...(skill ? { skill } : {}) });
    clearTimeout(ackTimer);
    ackTimer = setTimeout(() => {
      if (busy && !liveText && !toolCalls.length) {
        busy = false;
        stalled = true;
        console.warn('BrowseMate: no response from worker');
      }
    }, 12000);
    startWatchdog();
  }
  function flushQueue(): void {
    if (busy || !queuedSends.length) return;
    const [next, ...rest] = queuedSends;
    queuedSends = rest;
    queuedText = rest[0]?.text ?? '';
    send(next.text, next.skill);
  }

  function stop() { port.send({ type: 'stop', sessionId }); }

  function ttsDownloadVoice(v: VoiceMessage): Promise<any> {
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      downloadWaiters.set(requestId, resolve);
      port.send({
        type: 'tts-download',
        requestId,
        text: v.text,
        voice: v.engine === 'edge' ? v.voice : '',
        rate: v.rate,
        sessionId,
      });
      setTimeout(() => {
        if (downloadWaiters.delete(requestId)) resolve({ ok: false, error: 'انتهت مهلة تجهيز الملف' });
      }, 300_000);
    });
  }
  function approve(id: string, ok: boolean) {
    approvals = approvals.filter((a) => a.id !== id);
    port.send({ type: 'approval-response', id, approved: ok });
  }
  function retry() { if (lastUserText) send(lastUserText, lastSkill); }

  // ===== استشعار انقطاع التشغيل (SW قُتل / انقطع البث) =====
  function startWatchdog() {
    stopWatchdog();
    watchdog = setInterval(checkAlive, 8000);
  }
  function stopWatchdog() {
    clearInterval(watchdog);
    watchdog = undefined;
  }
  async function checkAlive() {
    if (!busy) { stopWatchdog(); return; }
    const res: any = await rpc('run-active', { sessionId }).catch(() => ({ ok: false }));
    if (!res.ok) return; // SW يستيقظ
    if (!res.active) {
      stopWatchdog();
      busy = false; approvals = []; progress = ''; livePlan = []; toolCalls = []; liveText = '';
      stalled = true;
      await loadSession(sessionId);
    }
  }

  // ===== الجلسات =====
  async function openSession(id: string) {
    if (busy) { stop(); busy = false; } // لا تغيّر الجلسة وسط تشغيل
    sessionId = id;
    port.send({ type: 'session-switch', sessionId: id });
    tab = 'chat';
    await loadSession(id);
    await refreshSessions();
  }
  async function newSession() {
    const res: any = await rpc('new-session', { title: lang === 'ar' ? 'جلسة جديدة' : 'New chat' });
    if (res.ok) { await refreshSessions(); await openSession(res.session.id); }
  }
  async function deleteSession(id: string) {
    await rpc('delete-session', { id });
    if (id === sessionId) {
      sessionId = ''; messages = [];
      const ens: any = await rpc('ensure-session', { title: lang === 'ar' ? 'جلسة جديدة' : 'New chat' });
      sessionId = ens.id;
      await loadSession(sessionId);
    }
    await refreshSessions();
  }

  // ===== المهارات =====
  async function runSkill(name: string, params: Record<string, string>) {
    const parts = Object.entries(params).filter(([, v]) => v.trim()).map(([k, v]) => `${k}: ${v}`);
    const res: any = await rpc('new-session', { title: lang === 'ar' ? 'جلسة جديدة' : 'New chat' });
    if (!res.ok) return;
    const id = res.session.id;
    await rpc('rename-session', { id, title: name });
    await refreshSessions();
    sessionId = id;
    port.send({ type: 'session-switch', sessionId: id });
    tab = 'chat';
    messages = [];
    const msg = `شغّل المهارة ${name}${parts.length ? ` بمعاملات ${parts.join(', ')}` : ''}`;
    send(msg, { name, params });
  }
  async function deleteSkill(name: string) {
    await rpc('delete-skill', { name });
    await refreshSkills();
  }

  async function setLangUi(l: Lang) {
    lang = l;
    setI18nLang(l);
    document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
    await rpc('save-settings', { patch: { lang: l } });
  }
</script>

<div class="app" {dir}>
  <div class="tabs">
    {#each tabs as x (x.key)}
      <button class:active={tab === x.key} onclick={() => (tab = x.key)}>{x.label}</button>
    {/each}
  </div>

  <div class="views">
    {#if tab === 'chat'}
      <ChatView
        {messages} {liveText} {livePlan} {toolCalls} {busy} {approvals} {progress} {lang}
        sessions={sessionsList} currentId={sessionId} {settingsError} {stalled}
        send={send} stop={stop} approve={approve} retry={retry} openSettings={() => (tab = 'settings')}
        openSession={openSession} createSession={newSession} removeSession={deleteSession}
        {queuedText}
        ttsState={ttsState}
        ttsPlay={() => rpc('tts-resume', { sessionId })}
        ttsPause={() => rpc('tts-pause', { sessionId })}
        ttsStop={() => rpc('tts-stop', { sessionId })}
        ttsSeek={(time) => rpc('tts-seek', { time, sessionId })}
        ttsReplay={() => rpc('tts-replay', { sessionId })}
        ttsPrev={() => rpc('tts-prev', { sessionId })}
        ttsNext={() => rpc('tts-next', { sessionId })}
        ttsReplayVoice={(v) => rpc('tts-speak-text', { text: v.text, voice: v.engine === 'edge' ? v.voice : '', rate: v.rate, engine: 'edge', sessionId, voiceId: v.id, replay: true })}
        ttsDownloadVoice={ttsDownloadVoice}
      />
    {:else if tab === 'skills'}
      <SkillList {skills} {lang} run={runSkill} remove={deleteSkill} refresh={refreshSkills} />
    {:else}
      <SettingsView {lang} setUiLang={setLangUi} {sessionId} />
    {/if}
  </div>
</div>
