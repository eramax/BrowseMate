// مخزن المستندات المولّدة — للتحميل/الطباعة من الشات بدون debugger
import { chromeKV } from '../shared/storage';

export interface Artifact {
  id: string;
  filename: string;
  mime: string;
  html: string;
  ts: number;
}
export interface ArtifactMeta {
  id: string;
  filename: string;
  mime: string;
  sizeKb: number;
}

const PREFIX = 'artifact:';
const MAX = 6; // إبقاء آخر 6 فقط (حصة التخزين)

export async function saveArtifact(filename: string, html: string, mime = 'text/html'): Promise<ArtifactMeta> {
  const id = crypto.randomUUID();
  await chromeKV.set(PREFIX + id, { id, filename, mime, html, ts: Date.now() } as Artifact);
  await prune();
  return { id, filename, mime, sizeKb: Math.max(1, Math.round(html.length / 1024)) };
}

export async function getArtifact(id: string): Promise<Artifact | undefined> {
  return chromeKV.get<Artifact>(PREFIX + id);
}

async function prune() {
  const keys = (await chromeKV.keys()).filter((k) => k.startsWith(PREFIX));
  if (keys.length <= MAX) return;
  const items: Artifact[] = [];
  for (const k of keys) {
    const a = await chromeKV.get<Artifact>(k);
    if (a) items.push(a);
  }
  items.sort((a, b) => a.ts - b.ts);
  for (const a of items.slice(0, items.length - MAX)) await chromeKV.remove(PREFIX + a.id);
}
