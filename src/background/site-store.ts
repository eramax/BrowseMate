// مساحة عمل الموقع: الملف الحالي + سجل إصدارات للتراجع (بدون إعادة كتابة كاملة)
import { chromeKV } from '../shared/storage';

export interface SiteWorkspace {
  id: string;
  filename: string;
  html: string;
  version: number;
  updatedAt: number;
}

const KEY = 'siteWorkspace';
const HISTORY = 'siteHistory';

export async function getSite(): Promise<SiteWorkspace | undefined> {
  return chromeKV.get<SiteWorkspace>(KEY);
}

export async function saveSite(ws: SiteWorkspace, pushHistory = true): Promise<void> {
  if (pushHistory) {
    const hist = (await chromeKV.get<SiteWorkspace[]>(HISTORY)) ?? [];
    hist.push(ws);
    await chromeKV.set(HISTORY, hist.slice(-8));
  }
  await chromeKV.set(KEY, ws);
}

export async function undoSite(): Promise<SiteWorkspace | undefined> {
  const hist = (await chromeKV.get<SiteWorkspace[]>(HISTORY)) ?? [];
  const prev = hist.pop();
  if (!prev) return undefined;
  await chromeKV.set(HISTORY, hist);
  await chromeKV.set(KEY, prev);
  return prev;
}
