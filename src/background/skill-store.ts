// المصدر الوحيد للمهارات: chrome.storage.sync (gzip + chunks) — لا نسخة محلية.
// الجلسات تبقى في chrome.storage.local. كل تعديل يُزامن فوراً.
import { chromeKV } from '../shared/storage';
import { pack, unpack, chunkString } from '../shared/codec';
import type { SkillFile } from '../shared/types';

const MANIFEST = 'bm:skills:manifest';
const chunkKey = (i: number) => `bm:skills:c:${i}`;
const MAX_PAYLOAD = 90000; // هامش تحت حد 100KB

interface Payload {
  skills: Record<string, SkillFile>;
  order: string[];
  seeded?: number;
  updatedAt: number;
}

let cache: Payload | null = null;
let initPromise: Promise<void> | null = null;
let lastError = '';
let mode: 'sync' | 'local' = 'sync';

function syncAvailable(): boolean {
  try { return Boolean(chrome.storage?.sync); } catch { return false; }
}

async function readLocal(): Promise<Payload | null> {
  const skills = await chromeKV.get<Record<string, SkillFile>>('skills');
  if (!skills || !Object.keys(skills).length) return null;
  return {
    skills,
    order: (await chromeKV.get<string[]>('skills:order')) ?? [],
    seeded: (await chromeKV.get<number>('skillsSeeded')) ?? 0,
    updatedAt: 0,
  };
}

async function writeLocal(p: Payload): Promise<void> {
  await chromeKV.set('skills', p.skills);
  await chromeKV.set('skills:order', p.order);
  await chromeKV.set('skillsSeeded', p.seeded ?? 0);
}

async function readSync(): Promise<Payload | null> {
  const raw = (await chrome.storage.sync.get(MANIFEST))[MANIFEST] as string | undefined;
  if (!raw) return null;
  const m = JSON.parse(raw) as { chunks: number; updatedAt: number };
  const keys = Array.from({ length: m.chunks }, (_, i) => chunkKey(i));
  const got = await chrome.storage.sync.get(keys);
  const payload = keys.map((k) => got[k] ?? '').join('');
  if (!payload) return null;
  const data = JSON.parse(await unpack(payload)) as Payload;
  return { skills: data.skills ?? {}, order: data.order ?? [], seeded: data.seeded ?? 0, updatedAt: m.updatedAt };
}

async function writeSync(payload: Payload): Promise<void> {
  const serialized = await pack(JSON.stringify({ skills: payload.skills, order: payload.order, seeded: payload.seeded ?? 0 }));
  if (serialized.length > MAX_PAYLOAD) throw new Error('المهارات أكبر من حد المزامنة (~100KB) — احذف مرفقات كبيرة أو قلّل المهارات');
  const oldRaw = (await chrome.storage.sync.get(MANIFEST))[MANIFEST] as string | undefined;
  const oldCount = oldRaw ? (JSON.parse(oldRaw).chunks as number) : 0;
  const chunks = chunkString(serialized, 6000);
  const obj: Record<string, string> = {};
  chunks.forEach((c, i) => (obj[chunkKey(i)] = c));
  obj[MANIFEST] = JSON.stringify({ chunks: chunks.length, updatedAt: payload.updatedAt });
  await chrome.storage.sync.set(obj);
  if (oldCount > chunks.length)
    await chrome.storage.sync.remove(Array.from({ length: oldCount - chunks.length }, (_, i) => chunkKey(chunks.length + i)));
}

async function init() {
  if (!syncAvailable()) {
    // لا يوجد chrome.storage.sync → النسخة المحلية هي المصدر
    mode = 'local';
    cache = (await readLocal()) ?? { skills: {}, order: [], seeded: 0, updatedAt: 0 };
    return;
  }
  try {
    const remote = await readSync();
    if (remote) { cache = remote; return; }
  } catch (e: any) {
    lastError = e?.message ?? String(e);
  }

  // ترحيل/استعادة من المحلي (تثبيت قديم أو فشل سابق في المزامنة)
  const legacy = await readLocal();
  if (legacy) {
    cache = { ...legacy, updatedAt: Date.now() };
    await persist();
    return;
  }
  cache = { skills: {}, order: [], seeded: 0, updatedAt: 0 };
}

async function ready(): Promise<Payload> {
  if (cache) return cache;
  if (!initPromise) initPromise = init();
  await initPromise;
  return cache!;
}

async function persist(): Promise<void> {
  const p = await ready();
  p.updatedAt = Date.now();
  if (mode === 'local') {
    await writeLocal(p).catch((e) => { lastError = e?.message ?? String(e); });
    return;
  }
  try {
    await writeSync(p);
    lastError = '';
  } catch (e: any) {
    // فشل/عدم توفر sync → نسخة محلية تلقائية حتى لا تُفقد المهارات
    lastError = e?.message ?? String(e);
    mode = 'local';
    await writeLocal(p).catch(() => {});
  }
}

export async function getSkills(): Promise<Record<string, SkillFile>> {
  return (await ready()).skills;
}

export async function getOrderedSkills(): Promise<SkillFile[]> {
  const p = await ready();
  const pos = new Map(p.order.map((n, i) => [n, i]));
  return Object.values(p.skills).sort(
    (a, b) => (pos.get(a.name) ?? 1e9) - (pos.get(b.name) ?? 1e9) || a.name.localeCompare(b.name),
  );
}

export async function saveSkill(skill: SkillFile, opts: { sync?: boolean } = {}): Promise<void> {
  const p = await ready();
  p.skills[skill.name] = { ...skill, updatedAt: Date.now() } as SkillFile;
  if (!p.order.includes(skill.name)) p.order.push(skill.name);
  if (opts.sync !== false) await persist();
}

export async function saveSkillsBulk(skills: SkillFile[], opts: { sync?: boolean } = {}): Promise<void> {
  const p = await ready();
  for (const s of skills) {
    p.skills[s.name] = { ...s, updatedAt: Date.now() } as SkillFile;
    if (!p.order.includes(s.name)) p.order.push(s.name);
  }
  if (opts.sync !== false) await persist();
}

export async function deleteSkill(name: string): Promise<void> {
  const p = await ready();
  delete p.skills[name];
  p.order = p.order.filter((n) => n !== name);
  await persist();
}

export async function setOrder(names: string[]): Promise<void> {
  const p = await ready();
  const valid = names.filter((n) => p.skills[n]);
  for (const n of Object.keys(p.skills)) if (!valid.includes(n)) valid.push(n);
  p.order = valid;
  await persist();
}

export async function getSeedRev(): Promise<number> {
  return (await ready()).seeded ?? 0;
}
export async function setSeedRev(v: number): Promise<void> {
  const p = await ready();
  p.seeded = v;
  await persist();
}

/** سحب من sync إذا كانت النسخة السحابية أحدث — عند بدء التشغيل/فتح اللوحة */
export async function pullSkills(): Promise<{ pulled: boolean }> {
  if (!syncAvailable()) return { pulled: false };
  try {
    const remote = await readSync();
    if (!remote) return { pulled: false };
    cache = remote;
    mode = 'sync';
    return { pulled: true };
  } catch {
    return { pulled: false };
  }
}

/** مزامنة فورية (تستخدمها الإعدادات) */
export async function syncNow(): Promise<{ ok: boolean; error?: string; count: number; updatedAt: number; mode: 'sync' | 'local' }> {
  await persist();
  const p = await ready();
  return { ok: !lastError, error: lastError || undefined, count: Object.keys(p.skills).length, updatedAt: p.updatedAt, mode };
}

export async function syncStatus(): Promise<{ ok: boolean; error?: string; count: number; updatedAt: number; mode: 'sync' | 'local' }> {
  const p = await ready();
  return { ok: !lastError, error: lastError || undefined, count: Object.keys(p.skills).length, updatedAt: p.updatedAt, mode };
}
