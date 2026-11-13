<script lang="ts">
  // قائمة الجلسات — عرض + أوامر عبر callbacks
  import type { Lang } from '../../shared/i18n';

  let {
    sessions, lang, open, create, remove,
  }: {
    sessions: Array<{ id: string; title: string; updatedAt: number }>;
    lang: Lang;
    open: (id: string) => void;
    create: () => void;
    remove: (id: string) => void;
  } = $props();

  const newLabel = $derived(lang === 'ar' ? '+ جلسة جديدة' : '+ New session');
  const empty = $derived(lang === 'ar' ? 'لا جلسات بعد' : 'No sessions yet');
  const when = (ts: number) => new Date(ts).toLocaleString(lang === 'ar' ? 'ar' : 'en', { dateStyle: 'short', timeStyle: 'short' });
</script>

<div class="view">
  <div style="padding:10px 10px 0">
    <button class="btn" style="width:100%" onclick={create}>{newLabel}</button>
  </div>
  <div class="list" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
    {#if !sessions.length}<div class="empty">{empty}</div>{/if}
    {#each sessions as s (s.id)}
      <div class="item">
        <span class="title" onclick={() => open(s.id)} title={s.title}>{s.title}</span>
        <span class="meta">{when(s.updatedAt)}</span>
        <button class="mini danger" onclick={() => remove(s.id)} title="✕">✕</button>
      </div>
    {/each}
  </div>
</div>
