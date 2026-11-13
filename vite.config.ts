import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { crx } from '@crxjs/vite-plugin';

const manifest = {
  manifest_version: 3,
  name: 'BrowseMate',
  version: '0.1.0',
  side_panel: { default_path: 'src/sidepanel/index.html' },
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  content_scripts: [
    { matches: ['<all_urls>'], js: ['src/content/page-tools.js'], run_at: 'document_idle' },
  ],
  permissions: ['sidePanel', 'tabs', 'tabGroups', 'storage', 'scripting', 'debugger', 'downloads', 'activeTab'],
  host_permissions: ['<all_urls>'],
  action: { default_title: 'BrowseMate' },
  icons: { '128': 'src/assets/icon128.png' },
  sandbox: { pages: ['src/preview/sandbox.html'] },
} as const;

export default defineConfig({
  plugins: [svelte(), crx({ manifest })],
});
