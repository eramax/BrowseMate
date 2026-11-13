// ينسخ ملفات Brotli WASM إلى public/brotli قبل البناء.
// السبب: تحميلها وقت التشغيل بعنوان chrome-extension:// يتجنب Vite module-preload
// helper (الذي يستخدم window/document داخل service worker).
import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve('node_modules/brotli-wasm/pkg.web');
const dst = path.resolve('public/brotli');
const files = ['brotli_wasm.js', 'brotli_wasm_bg.wasm'];

if (!fs.existsSync(src)) {
  console.warn('brotli-wasm not installed — skipping brotli assets');
  process.exit(0);
}

fs.mkdirSync(dst, { recursive: true });
for (const f of files) fs.copyFileSync(path.join(src, f), path.join(dst, f));
console.log(`brotli: copied ${files.length} files to public/brotli`);
