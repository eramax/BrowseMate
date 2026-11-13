<script lang="ts">
  // BrowseMate — App الرئيسي: يملك Port والأحداث، العرض في مكوّنات
  import { openPanelPort, rpc } from './lib/port';
  import { t, setLang as setI18nLang, type Lang } from '../shared/i18n';
  import type { ChatMessage, Session, ToolCallInfo } from '../shared/types';
  import type { SkillFile } from '../shared/types';
  import ChatView from './components/ChatView.svelte';
  import SessionList from './components/SessionList.svelte';
  import SkillList from './components/SkillList.svelte';
  import SettingsView from './components/SettingsView.svelte';

  type Tab = 'chat' | 'sessions' | 'skills' | 'settings';
  const TABS: Array<{ key: Tab; k: string }> = [
    { key: 'chat', k: 'tabs.chat' },
    { key: 'sessions', k: 'tabs.sessions' },
    { key: 'skills', k: 'tabs.skills' },
    { key: 'settings', k: 'tabs.settings' },
  ];

  let tab = $state<Tab>('chat');
  let lang = $state<Lang>('ar');
  let sessionId = $state('');
  let messages = $state<ChatMessage[]>([]);
  let sessionsList = $state<Array<Pick<Session, 'id' | 'title' | 'updatedAt'>>>([]);
  let skills = $state<SkillFile[]>([]);

  // حالة التشغيل الحي
  let busy = $state(false);
  let liveText = $state('');
  let livePlan = $state<string[]>([]);
  let toolCalls = $state<ToolCallInfo[]>([]);
  let approvals = $state<Array<{ id: string; tool: string; args: unknown; steps?: string[] }>>([]);
  let progress = $state('');
  let lastUserText = $state('');

  const dir = $derived(lang === 'ar' ? 'rtl' : 'ltr');

  // ===== Port: كل أحداث SW =====
  const port = openPanelPort((e: any) => {
    switch (e.type) {
      case 'chat-started':
        busy = true; liveText = ''; livePlan = []; toolCalls = [];
        break;
      case 'delta':
        liveText = e.text;
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
        busy = false; approvals = []; progress = ''; livePlan = []; toolCalls = []; liveText = '';
        loadSession(sessionId);
        if (e.type === 'error' && !e.runId) console.warn('BrowseMate:', e.message);
        break;
      }
      case 'sessions-list':
        sessionsList = e.sessions;
        break;
      case 'session-data':
        messages = e.session.messages;
        break;
    }
  });

  // ===== تهيئة =====
  $effect(() => {
    (async () => {
      const s: any = await rpc('get-settings');
      if (s.settings.lang) setLangUi(s.settings.lang);
      const ens: any = await rpc('ensure-session');
      sessionId = ens.id;
      await loadSession(sessionId);
      await refreshSessions();
    })();
  });

  async function loadSession(id: string) {
    const res: any = await rpc('get-session', { id });
    if (res.ok && res.session) messages = res.session.messages;
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

  // ===== أوامر =====
  function send(text: string) {
    lastUserText = text;
    port.send({ type: 'chat', sessionId, text });
  }
  function stop() { port.send({ type: 'stop' }); }
  function approve(id: string, ok: boolean) {
    approvals = approvals.filter((a) => a.id !== id);
    port.send({ type: 'approval-response', id, approved: ok });
  }
  function retry() {
    if (lastUserText) send(lastUserText);
  }

  async function openSession(id: string) {
    sessionId = id;
    port.send({ type: 'session-switch', sessionId: id });
    tab = 'chat';
    await loadSession(id);
  }
  async function newSession() {
    const res: any = await rpc('new-session');
    if (res.ok) {
      await refreshSessions();
      await openSession(res.session.id);
    }
  }
  async function deleteSession(id: string) {
    await rpc('delete-session', { id });
    if (id === sessionId) {
      sessionId = '';
      messages = [];
      const ens: any = await rpc('ensure-session');
      sessionId = ens.id;
      await loadSession(sessionId);
    }
    await refreshSessions();
  }

  function runSkill(name: string, params: Record<string, string>) {
    const parts = Object.entries(params).filter(([, v]) => v.trim()).map(([k, v]) => `${k}: ${v}`);
    send(`شغّل المهارة ${name}${parts.length ? ` بمعاملات ${parts.join(', ')}` : ''}`);
    tab = 'chat';
  }
  async function deleteSkill(name: string) {
    await rpc('delete-skill', { name });
    await refreshSkills();
  }
  async function importSkill(json: string) {
    try {
      const skill = JSON.parse(json);
      const res: any = await rpc('import-skill', { skill });
      if (!res.ok) alert(res.error);
      else await refreshSkills();
    } catch (e: any) {
      alert(`JSON غير صالح: ${e.message}`);
    }
  }

  async function setLangUi(l: Lang) {
    lang = l;
    setI18nLang(l);
    document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
    await rpc('save-settings', { patch: { lang: l } });
  }
</script>

<div class="app" {dir}>
  <div class="tabs" {dir}>
    {#each TABS as x}
      <button class:active={tab === x.key} onclick={() => (tab = x.key)}>{t(x.k)}</button>
    {/each}
  </div>
  <div class="views">
    {#if tab === 'chat'}
      <ChatView
        {messages} {liveText} {livePlan} {toolCalls} {busy} {approvals} {progress} {lang}
        onsend={send} onstop={stop} onapprove={approve} onretry={retry}
      />
    {:else if tab === 'sessions'}
      <SessionList sessions={sessionsList} {lang} onopen={openSession} oncreate={newSession} onremove={deleteSession} />
    {:else if tab === 'skills'}
      <SkillList {skills} {lang} onrun={runSkill} onremove={deleteSkill} onimport={importSkill} />
    {:else}
      <SettingsView {lang} setUiLang={setLangUi} />
    {/if}
  </div>
</div>
