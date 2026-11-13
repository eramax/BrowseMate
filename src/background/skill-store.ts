// المصدر الوحيد للمهارات: SKILL.md (frontmatter+markdown) محفوظ في chrome.storage.sync
// مضغوط ومجزأ. الجلسات تبقى في chrome.storage.local. كل تعديل يُزامن فوراً.
// نسخة محلية تُستخدم فقط إذا كان sync غير متاح أو فشل.
import { chromeKV } from '../shared/storage';
import { pack, unpack, chunkString } from '../shared/codec';
import { toSkillMd, fromSkillMd } from '../shared/skill-md';
import type { SkillFile } from '../shared/types';

const MANIFEST = 'bm:skills:manifest';
const chunkKey = (i: number) => `bm:skills:c:${i}`;
const MAX_PAYLOAD = 90000;
const SYNC_QUOTA = 102400; // chrome.storage.sync.QUOTA_BYTES
const LOCAL_QUOTA = 10485760; // chrome.storage.local ~10MB

interface Usage { usedBytes: number; quotaBytes: number; percent: number }

async function usage(): Promise<Usage> {
  try {
    const area = mode === 'sync' ? chrome.storage.sync : chrome.storage.local;
    const usedBytes = await area.getBytesInUse(null);
    const quotaBytes = mode === 'sync' ? SYNC_QUOTA : LOCAL_QUOTA;
    return { usedBytes, quotaBytes, percent: Math.round((usedBytes / quotaBytes) * 1000) / 10 };
  } catch {
    return { usedBytes: 0, quotaBytes: mode === 'sync' ? SYNC_QUOTA : LOCAL_QUOTA, percent: 0 };
  }
}

interface Payload {
  docs: Record<string, string>; // name → SKILL.md
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

function normalizePayload(data: any): Payload {
  // توافق مع التنسيق القديم (skills map بدل docs)
  if (data?.docs) return { docs: data.docs, order: data.order ?? [], seeded: data.seeded ?? 0, updatedAt: data.updatedAt ?? 0 };
  const docs: Record<string, string> = {};
  if (data?.skills && typeof data.skills === 'object') {
    for (const [name, skill] of Object.entries<any>(data.skills)) docs[name] = toSkillMd(skill);
  }
  return { docs, order: data?.order ?? [], seeded: data?.seeded ?? 0, updatedAt: data?.updatedAt ?? 0 };
}

async function readLocal(): Promise<Payload | null> {
  const skills = await chromeKV.get<Record<string, SkillFile>>('skills');
  const docsRaw = await chromeKV.get<Record<string, string>>('skillDocs');
  if (docsRaw && Object.keys(docsRaw).length) return normalizePayload({ docs: docsRaw, order: await chromeKV.get('skills:order'), seeded: await chromeKV.get('skillsSeeded') });
  if (skills && Object.keys(skills).length) return normalizePayload({ skills, order: await chromeKV.get('skills:order'), seeded: await chromeKV.get('skillsSeeded') });
  return null;
}

async function writeLocal(p: Payload): Promise<void> {
  await chromeKV.set('skillDocs', p.docs);
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
  const data = JSON.parse(await unpack(payload));
  const p = normalizePayload(data);
  p.updatedAt = m.updatedAt;
  return p;
}

async function writeSync(p: Payload): Promise<void> {
  const serialized = await pack(JSON.stringify({ docs: p.docs, order: p.order, seeded: p.seeded ?? 0 }));
  if (serialized.length > MAX_PAYLOAD) throw new Error('المهارات أكبر من حد المزامنة (~100KB) — احذف مرفقات كبيرة أو قلّل المهارات');
  const oldRaw = (await chrome.storage.sync.get(MANIFEST))[MANIFEST] as string | undefined;
  const oldCount = oldRaw ? (JSON.parse(oldRaw).chunks as number) : 0;
  const chunks = chunkString(serialized, 6000);
  const obj: Record<string, string> = {};
  chunks.forEach((c, i) => (obj[chunkKey(i)] = c));
  obj[MANIFEST] = JSON.stringify({ chunks: chunks.length, updatedAt: p.updatedAt });
  await chrome.storage.sync.set(obj);
  if (oldCount > chunks.length)
    await chrome.storage.sync.remove(Array.from({ length: oldCount - chunks.length }, (_, i) => chunkKey(chunks.length + i)));
}

async function init() {
  if (!syncAvailable()) {
    mode = 'local';
    cache = (await readLocal()) ?? { docs: {}, order: [], seeded: 0, updatedAt: 0 };
    return;
  }
  try {
    const remote = await readSync();
    if (remote) { cache = remote; return; }
  } catch (e: any) {
    lastError = e?.message ?? String(e);
  }
  const legacy = await readLocal();
  if (legacy) {
    cache = { ...legacy, updatedAt: Date.now() };
    await persist();
    return;
  }
  cache = { docs: {}, order: [], seeded: 0, updatedAt: 0 };
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
    lastError = e?.message ?? String(e);
    mode = 'local';
    await writeLocal(p).catch(() => {});
  }
}

/** المهارات مفكوكة من SKILL.md — للاستخدام في التنفيذ */
export async function getSkills(): Promise<Record<string, SkillFile>> {
  const p = await ready();
  const out: Record<string, SkillFile> = {};
  for (const [name, md] of Object.entries(p.docs)) {
    const r = fromSkillMd(md);
    if (r.skill) out[name] = r.skill;
  }
  return out;
}

export async function getOrderedSkills(): Promise<SkillFile[]> {
  const p = await ready();
  const all = await getSkills();
  const pos = new Map(p.order.map((n, i) => [n, i]));
  return Object.values(all).sort(
    (a, b) => (pos.get(a.name) ?? 1e9) - (pos.get(b.name) ?? 1e9) || a.name.localeCompare(b.name),
  );
}

export async function saveSkill(skill: SkillFile, opts: { sync?: boolean } = {}): Promise<void> {
  const p = await ready();
  const next = { ...skill, updatedAt: Date.now() } as SkillFile;
  p.docs[skill.name] = toSkillMd(next);
  if (!p.order.includes(skill.name)) p.order.push(skill.name);
  if (opts.sync !== false) await persist();
}

export async function saveSkillsBulk(skills: SkillFile[], opts: { sync?: boolean } = {}): Promise<void> {
  const p = await ready();
  for (const s of skills) {
    p.docs[s.name] = toSkillMd({ ...s, updatedAt: Date.now() } as SkillFile);
    if (!p.order.includes(s.name)) p.order.push(s.name);
  }
  if (opts.sync !== false) await persist();
}

export async function deleteSkill(name: string): Promise<void> {
  const p = await ready();
  delete p.docs[name];
  p.order = p.order.filter((n) => n !== name);
  await persist();
}

export async function setOrder(names: string[]): Promise<void> {
  const p = await ready();
  const valid = names.filter((n) => p.docs[n]);
  for (const n of Object.keys(p.docs)) if (!valid.includes(n)) valid.push(n);
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

/** سحب أحدث نسخة من sync */
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

export async function syncNow(): Promise<{ ok: boolean; error?: string; count: number; updatedAt: number; mode: 'sync' | 'local'; usage: Usage }> {
  await persist();
  const p = await ready();
  return { ok: !lastError, error: lastError || undefined, count: Object.keys(p.docs).length, updatedAt: p.updatedAt, mode, usage: await usage() };
}

export async function syncStatus(): Promise<{ ok: boolean; error?: string; count: number; updatedAt: number; mode: 'sync' | 'local'; usage: Usage }> {
  const p = await ready();
  return { ok: !lastError, error: lastError || undefined, count: Object.keys(p.docs).length, updatedAt: p.updatedAt, mode, usage: await usage() };
}
