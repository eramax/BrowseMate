<script lang="ts">
  // رسالة صوتية داخل المحادثة — شكل رسالة واتساب/تليجرام: تشغيل، موجة، مدة، تقدّم، إيقاف.
  import type { TtsPanelState } from '../../shared/types';
  import type { Lang } from '../../shared/i18n';

  let {
    player,
    lang,
    live = true,
    onPlay,
    onPause,
    onStop,
    onSeek,
    onPrev,
    onNext,
    onReplay,
  }: {
    player: TtsPanelState;
    lang: Lang;
    /** true = مشغل حي، false = رسالة صوتية محفوظة قابلة لإعادة التشغيل */
    live?: boolean;
    onPlay?: () => void;
    onPause?: () => void;
    onStop?: () => void;
    onSeek?: (time: number) => void;
    onPrev?: () => void;
    onNext?: () => void;
    onReplay?: () => void;
  } = $props();

  let seekValue = $state(0);
  let dragging = $state(false);
  $effect(() => {
    if (!dragging) seekValue = player.currentTime;
  });

  const dir = $derived(lang === 'ar' ? 'rtl' : 'ltr');
  const canSeek = $derived(live && player.duration > 0.1);
  const pct = $derived(canSeek ? Math.max(0, Math.min(1, seekValue / player.duration)) : 0);
  const engineLabel = $derived(player.engine === 'edge' ? 'Edge' : lang === 'ar' ? 'المتصفح' : 'Browser');
  const bars = [7, 12, 18, 10, 22, 14, 8, 19, 13, 24, 9, 16, 21, 11, 7, 17, 12, 23, 14, 8, 18, 13, 21, 10, 15, 19, 9, 7];

  function fmt(sec: number): string {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
</script>

<div class="voice-bubble" {dir} class:playing={player.playing}>
  <button
    type="button"
    class="voice-play"
    title={live && player.playing ? (lang === 'ar' ? 'إيقاف مؤقت' : 'Pause') : (lang === 'ar' ? 'تشغيل' : 'Play')}
    onclick={() => {
      if (!live) { onReplay?.(); return; }
      if (player.playing) onPause?.(); else onPlay?.();
    }}
  >
    {live && player.playing ? '⏸' : '▶'}
  </button>

  <div class="voice-body">
    <div class="voice-caption" title={player.text}>{player.text}</div>
    <div class="voice-wave-wrap">
      <div class="voice-wave" aria-hidden="true">
        {#each bars as h, i}
          <span class="bar" class:on={live ? i / bars.length <= pct : true} style={`height:${h}px`}></span>
        {/each}
      </div>
      {#if live && canSeek}
        <input
          class="voice-seek"
          type="range"
          min="0"
          max={Math.max(player.duration, 0.1)}
          step="0.1"
          value={seekValue}
          aria-label={lang === 'ar' ? 'موضع القراءة' : 'Seek voice message'}
          oninput={(e) => {
            dragging = true;
            seekValue = Number((e.currentTarget as HTMLInputElement).value);
          }}
          onchange={(e) => {
            dragging = false;
            onSeek(Number((e.currentTarget as HTMLInputElement).value));
          }}
        />
      {/if}
    </div>

    <div class="voice-meta">
      {#if live && canSeek}
        <span class="voice-time">{fmt(seekValue)} / {fmt(player.duration)}</span>
      {/if}
      {#if live && player.total > 1}<span class="voice-count">{player.index + 1}/{player.total}</span>{/if}
      <span class="voice-engine">{engineLabel}</span>
      <span class="voice-spacer"></span>
      {#if live && player.total > 1}
        <button type="button" class="voice-mini" title={lang === 'ar' ? 'السابق' : 'Previous'} onclick={onPrev}>⏮</button>
        <button type="button" class="voice-mini" title={lang === 'ar' ? 'التالي' : 'Next'} onclick={onNext}>⏭</button>
      {/if}
      {#if live}
        <button type="button" class="voice-mini stop" title={lang === 'ar' ? 'إيقاف' : 'Stop'} onclick={onStop}>⏹</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .voice-bubble {
    align-self: flex-start;
    display: flex;
    align-items: center;
    gap: 9px;
    width: min(370px, 100%);
    padding: 8px 10px;
    background: var(--surface-2, var(--surface));
    border: 1px solid var(--border-soft);
    border-radius: 18px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
  }
  .voice-play {
    flex: none;
    width: 40px;
    height: 40px;
    border: none;
    border-radius: 50%;
    cursor: pointer;
    color: #fff;
    font-size: 17px;
    line-height: 1;
    display: grid;
    place-items: center;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    box-shadow: 0 4px 12px rgba(99, 102, 241, 0.35);
  }
  .voice-play:active { transform: scale(0.95); }
  .voice-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .voice-caption {
    font-size: 10.5px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .voice-wave-wrap { position: relative; height: 26px; display: flex; align-items: center; }
  .voice-wave {
    display: flex;
    align-items: center;
    gap: 2px;
    width: 100%;
    height: 26px;
    overflow: hidden;
  }
  .bar {
    flex: 1;
    min-width: 1px;
    border-radius: 2px;
    background: var(--border);
    opacity: 0.75;
    transition: background 0.15s ease;
  }
  .bar.on { background: var(--accent); opacity: 1; }
  .playing .bar.on { background: linear-gradient(180deg, #8b5cf6, #22d3ee); }
  .voice-seek {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  .voice-wave-wrap:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 6px;
  }
  .voice-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
    font-size: 10px;
  }
  .voice-time { font-variant-numeric: tabular-nums; direction: ltr; }
  .voice-count, .voice-engine {
    padding: 0 5px;
    border-radius: 999px;
    border: 1px solid var(--border-soft);
    background: var(--bg);
    font-size: 9px;
  }
  .voice-spacer { flex: 1; }
  .voice-mini {
    width: 22px;
    height: 22px;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    font-size: 12px;
    border-radius: 6px;
    display: grid;
    place-items: center;
  }
  .voice-mini:hover { background: var(--border-soft); color: var(--text); }
  .voice-mini.stop:hover { color: #f87171; }
</style>
