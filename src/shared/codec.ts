// ضغط/تقسيم حمولات المهارات — Brotli WASM (quality 11) مع fallback إلى gzip
// + base64 + chunks لاحترام حدود chrome.storage.sync
const CHUNK = 6000;

let brotliPromise: Promise<any | null> | null = null;
async function getBrotli(): Promise<any | null> {
  if (!brotliPromise) {
    brotliPromise = (async () => {
      try {
        // ملفات Brotli تُنسخ إلى public/brotli عند البناء (prebuild) وتُحمَّل بعنوان
        // وقت التشغيل — لا نستخدم import ثابتاً حتى لا يحقن Vite module-preload helper
        // الذي يعتمد على window/document داخل service worker.
        if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) return null;
        const base = chrome.runtime.getURL('brotli/');
        const mod: any = await import(/* @vite-ignore */ base + 'brotli_wasm.js');
        await mod.default(chrome.runtime.getURL('brotli/brotli_wasm_bg.wasm'));
        return mod;
      } catch {
        return null;
      }
    })();
  }
  try {
    return await brotliPromise;
  } catch {
    return null;
  }
}

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
  const readPromise = new Response(cs.readable).arrayBuffer(); // اقرأ بالتوازي مع الكتابة (منع backpressure)
  await w.write(bytes as unknown as BufferSource);
  await w.close();
  return new Uint8Array(await readPromise);
}

async function gunzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const w = ds.writable.getWriter();
  const readPromise = new Response(ds.readable).arrayBuffer();
  await w.write(bytes as unknown as BufferSource);
  await w.close();
  return new Uint8Array(await readPromise);
}

export async function pack(text: string): Promise<string> {
  const raw = new TextEncoder().encode(text);
  // Brotli أولاً (أفضل ضغط) — عند أي فشل نعود إلى gzip
  const br = await getBrotli();
  if (br && typeof br.compress === 'function') {
    try {
      const out: Uint8Array = br.compress(raw, { quality: 11 });
      return 'br:' + b64encode(out);
    } catch {
      /* fallback */
    }
  }
  if (typeof CompressionStream === 'undefined') return 'raw:' + b64encode(raw);
  return 'gz:' + b64encode(await gzipBytes(raw));
}

export async function unpack(payload: string): Promise<string> {
  if (payload.startsWith('br:')) {
    const br = await getBrotli();
    if (!br || typeof br.decompress !== 'function') throw new Error('brotli unavailable');
    return new TextDecoder().decode(br.decompress(b64decode(payload.slice(3))));
  }
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
