// قراءة ترجمة فيديو يوتيوب — من player response داخل الصفحة (MAIN world) أو لوحة النص، مجاناً وبدون مفاتيح
import { z } from 'zod';
import { register } from './registry';
import { withPage } from '../inject';

/** تعمل في MAIN world: تصل إلى ytInitialPlayerResponse وتجلب الترجمة بجلسة المتصفح الحقيقية */
async function ytMainExtract() {
  // الترتيب: الترجمة اليدوية بلغة الصوت الأصلية ← أي يدوية ← التلقائية بلغة الصوت ← أي تلقائية
  const pickOriginal = (tracks: any[], defaultLang: string) => {
    const base = String(defaultLang || '').toLowerCase().split('-')[0];
    const manual = tracks.filter((t) => t.kind !== 'asr');
    const asr = tracks.filter((t) => t.kind === 'asr');
    const match = (arr: any[]) => base && arr.find((t) => String(t.languageCode || '').toLowerCase().startsWith(base));
    return match(manual) || manual[0] || match(asr) || asr[0] || tracks[0];
  };

  let tracks: any[] | null = null;
  let defaultLang = '';
  try {
    const pr = (window as any).ytInitialPlayerResponse;
    tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? null;
    defaultLang = pr?.videoDetails?.defaultAudioLanguage ?? '';
  } catch { /* ignore */ }
  if (!tracks?.length) {
    try {
      const p = document.querySelector('#movie_player') as any;
      const pr = p?.getPlayerResponse?.();
      tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? null;
      defaultLang = pr?.videoDetails?.defaultAudioLanguage ?? defaultLang;
    } catch { /* ignore */ }
  }
  if (!tracks?.length) return { ok: false, error: 'NO_TRACKS' };

  const tr = pickOriginal(tracks, defaultLang);
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
    'يجلب النص الكامل (الترجمة الأصلية) من لوحة "إظهار النص" في فيديو يوتيوب المفتوح أو تبويب محدد (tabId) — يدوية وتلقائية. استخدمه لتلخيص الفيديو.',
  sensitive: false,
  idempotent: true,
  schema: z.object({ tabId: z.number().optional().describe('معرف تبويب خلفي (اختياري)') }),
  execute: async (a, ctx) => {
    const tab = a.tabId !== undefined ? await chrome.tabs.get(a.tabId) : await ctx.getActiveTab();
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
