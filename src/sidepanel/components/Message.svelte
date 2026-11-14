<script lang="ts">
  // رسالة واحدة — dir حسب لغة النص، markdown متدفق، وأزرار تحميل/طباعة للمستندات
  import { attach, type FlowView } from '../lib/flowdown';
  import { textDir } from '../../shared/i18n';
  import { rpc } from '../lib/port';
  import type { ChatMessage, VoiceMessage } from '../../shared/types';

  let { msg, lang = 'en', activeVoiceId = '' }: { msg: ChatMessage; lang?: 'ar' | 'en'; activeVoiceId?: string } = $props();
  let host = $state<HTMLElement>();
  let view: FlowView | undefined;
  const dir = $derived(textDir(msg.content));
  const visibleVoices = $derived((msg.voices ?? []).filter((v) => v.id !== activeVoiceId));
  const planLabel = $derived(lang === 'ar' ? 'الخطة' : 'Plan');
  const L = $derived(lang === 'ar'
    ? { download: '⬇ تحميل', print: '🖨 طباعة / PDF', voice: 'رسالة صوتية' }
    : { download: '⬇ Download', print: '🖨 Print / PDF', voice: 'Voice message' });
  const voiceBars = [7, 12, 18, 10, 21, 14, 8, 19, 12, 23, 9, 16, 20, 11, 7, 17, 13, 22, 10, 15, 19, 9];
  async function replayVoice(v: VoiceMessage) {
    await rpc('tts-speak-text', { text: v.text, voice: v.voice, rate: v.rate, engine: v.engine });
  }

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
    {#if visibleVoices.length}
      <div class="voice-list">
        {#each visibleVoices as v (v.id)}
          <button type="button" class="history-voice" onclick={() => replayVoice(v)} title={v.text}>
            <span class="hv-play">▶</span>
            <span class="hv-wave" aria-hidden="true">
              {#each voiceBars as h}
                <span style={`height:${h}px`}></span>
              {/each}
            </span>
            <span class="hv-meta">{v.engine === 'edge' ? 'Edge' : 'Browser'} · {L.voice}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .voice-list { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
  .history-voice {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 340px;
    padding: 7px 9px;
    background: var(--surface-2, var(--surface));
    border: 1px solid var(--border-soft);
    border-radius: 16px;
    cursor: pointer;
    text-align: start;
    color: inherit;
  }
  .history-voice:hover { border-color: var(--accent); }
  .hv-play {
    flex: none;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: #fff;
    font-size: 13px;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
  }
  .hv-wave { display: flex; align-items: center; gap: 2px; height: 22px; flex: 1; min-width: 80px; }
  .hv-wave span { flex: 1; min-width: 1px; border-radius: 2px; background: var(--border); }
  .hv-meta { flex: none; font-size: 9px; color: var(--muted); white-space: nowrap; }
</style>
