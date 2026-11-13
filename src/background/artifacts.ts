// مخزن المستندات المولّدة — للتحميل/الطباعة من الشات بدون debugger
import { chromeKV } from '../shared/storage';

export interface Artifact {
  id: string;
  filename: string;
  mime: string;
  html?: string;
  dataUrl?: string; // ملفات ثنائية (PDF)
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
  return putArtifact(crypto.randomUUID(), filename, html, mime);
}

/** تحديث/إنشاء artifact بمعرف ثابت — يحافظ على زر التحميل نفسه عبر التعديلات */
export async function putArtifact(id: string, filename: string, html: string, mime = 'text/html'): Promise<ArtifactMeta> {
  await chromeKV.set(PREFIX + id, { id, filename, mime, html, ts: Date.now() } as Artifact);
  await prune();
  return { id, filename, mime, sizeKb: Math.max(1, Math.round(html.length / 1024)) };
}

/** حفظ PDF (base64 من CDP) كـ artifact لعرض زر تحميل في الشات */
export async function savePdfArtifact(filename: string, base64: string): Promise<ArtifactMeta> {
  return saveBinaryArtifact(filename, base64, 'application/pdf');
}

/** حفظ ملف ثنائي (ZIP مثلاً) كـ data URL لعرض زر تحميل في الشات */
export async function saveBinaryArtifact(filename: string, base64: string, mime: string): Promise<ArtifactMeta> {
  const id = crypto.randomUUID();
  const dataUrl = `data:${mime};base64,${base64}`;
  await chromeKV.set(PREFIX + id, { id, filename, mime, dataUrl, ts: Date.now() } as Artifact);
  await prune();
  return { id, filename, mime, sizeKb: Math.max(1, Math.round((base64.length * 3) / 4 / 1024)) };
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
