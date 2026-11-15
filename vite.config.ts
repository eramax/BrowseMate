import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { crx } from '@crxjs/vite-plugin';

const manifest = {
  manifest_version: 3,
  name: 'BrowseMate',
  version: '0.3.1',
  side_panel: { default_path: 'src/sidepanel/index.html' },
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  content_scripts: [
    { matches: ['<all_urls>'], js: ['src/content/page-tools.js', 'src/content/reader/index.ts'], run_at: 'document_idle' },
  ],
  permissions: ['sidePanel', 'tabs', 'tabGroups', 'storage', 'scripting', 'declarativeNetRequest', 'debugger', 'downloads', 'activeTab', 'tts', 'offscreen'],
  host_permissions: ['<all_urls>'],
  action: {
    default_title: 'BrowseMate',
    default_icon: {
      '16': 'src/assets/icon16.png',
      '32': 'src/assets/icon32.png',
      '48': 'src/assets/icon48.png',
      '128': 'src/assets/icon128.png',
    },
  },
  icons: {
    '16': 'src/assets/icon16.png',
    '32': 'src/assets/icon32.png',
    '48': 'src/assets/icon48.png',
    '128': 'src/assets/icon128.png',
  },
  sandbox: { pages: ['src/preview/sandbox.html'] },
} as const;

export default defineConfig({
  plugins: [svelte(), crx({ manifest })],
  // service worker لا يملك window/document — لا تحقن Vite module-preload helper
  build: { modulePreload: false },
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
});
