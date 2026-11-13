// ضغط/تقسيم حمولات المهارات — gzip + base64 + chunks لاحترام حدود chrome.storage.sync
const CHUNK = 6000;

function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
function b64decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const w = cs.writable.getWriter();
  await w.write(bytes as unknown as BufferSource);
  await w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

async function gunzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const w = ds.writable.getWriter();
  await w.write(bytes as unknown as BufferSource);
  await w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

export async function pack(text: string): Promise<string> {
  const raw = new TextEncoder().encode(text);
  if (typeof CompressionStream === 'undefined') return 'raw:' + b64encode(raw);
  return 'gz:' + b64encode(await gzipBytes(raw));
}

export async function unpack(payload: string): Promise<string> {
  if (payload.startsWith('raw:')) return new TextDecoder().decode(b64decode(payload.slice(4)));
  if (!payload.startsWith('gz:')) throw new Error('bad payload');
  if (typeof DecompressionStream === 'undefined') throw new Error('no DecompressionStream');
  return new TextDecoder().decode(await gunzipBytes(b64decode(payload.slice(3))));
}

export function chunkString(s: string, size = CHUNK): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out.length ? out : [''];
}
