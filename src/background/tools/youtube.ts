// قراءة ترجمة فيديو يوتيوب — من player response داخل الصفحة (MAIN world) أو لوحة النص، مجاناً وبدون مفاتيح
import { z } from 'zod';
import { register } from './registry';
import { withPage } from '../inject';

/** تعمل في MAIN world: تصل إلى ytInitialPlayerResponse وتجلب الترجمة بجلسة المتصفح الحقيقية */
async function ytMainExtract() {
  const pick = (tracks: any[]) =>
    tracks.find((t) => t.languageCode === 'ar')
    || tracks.find((t) => /^en/.test(t.languageCode || '') && t.kind !== 'asr')
    || tracks.find((t) => /^en/.test(t.languageCode || ''))
    || tracks[0];

  let tracks: any[] | null = null;
  try { tracks = (window as any).ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? null; } catch { /* ignore */ }
  if (!tracks?.length) {
    try {
      const p = document.querySelector('#movie_player') as any;
      tracks = p?.getPlayerResponse?.()?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? null;
    } catch { /* ignore */ }
  }
  if (!tracks?.length) return { ok: false, error: 'NO_TRACKS' };

  const tr = pick(tracks);
  try {
    const r = await fetch(tr.baseUrl + '&fmt=json3', { credentials: 'include' });
    if (!r.ok) return { ok: false, error: `FETCH_${r.status}` };
    const d = await r.json();
    const segments = (d.events || [])
      .map((ev: any) => (ev.segs || []).map((s: any) => s.utf8 || '').join(''))
      .filter(Boolean);
    if (!segments.length) return { ok: false, error: 'EMPTY' };
    const text = segments.join(' ').replace(/\s+/g, ' ').trim().slice(0, 20000);
    const title = document.querySelector('h1 yt-formatted-string')?.textContent?.trim() || document.title;
    return {
      ok: true,
      data: {
        videoId: new URL(location.href).searchParams.get('v'),
        title, lang: tr.languageCode, source: 'captions', segments, text,
      },
    };
  } catch {
    return { ok: false, error: 'EXC' };
  }
}

register({
  name: 'youtube_transcript',
  description:
    'يجلب النص الكامل (الترجمة) لفيديو يوتيوب المفتوح في التبويب النشط — يدوية وتلقائية ولغات متعددة. استخدمه لتلخيص الفيديو. إن لم يكن التبويب فيديو يوتيوب انتقل إليه أولاً بـ navigate.',
  sensitive: false,
  schema: z.object({}),
  execute: async (_a, ctx) => {
    const tab = await ctx.getActiveTab();
    let host = '';
    try { host = new URL(tab.url ?? '').hostname; } catch { /* ignore */ }
    if (!/(^|\.)youtube\.com$/.test(host))
      return { error: 'NOT_YOUTUBE', message: 'افتح صفحة فيديو يوتيوب أولاً (navigate) ثم أعد المحاولة.' };

    // 1) داخل سياق الصفحة الحقيقي (الأسرع والأدق)
    try {
      const [inj] = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, world: 'MAIN', func: ytMainExtract });
      const r: any = inj?.result;
      if (r?.ok) return r.data;
    } catch { /* fallthrough */ }

    // 2) احتياطي: لوحة النص في الواجهة (DOM)
    return withPage(tab.id!, 'yt_transcript');
  },
});
