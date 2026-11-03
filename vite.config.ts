import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { existsSync, readFileSync } from 'node:fs';
import type { Connect, Plugin } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// 只在本機開發／預覽伺服器提供個人原版素材包；不會進入建置結果
const PACK = new URL('./private/FairyPocket-原版素材包.json', import.meta.url);
const servePack: Connect.NextHandleFunction = (req, res, next) => {
  if (!req.url?.split('?')[0].endsWith('/local-pack.json') || !existsSync(PACK)) return next();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(readFileSync(PACK));
};
const localPack = (): Plugin => ({
  name: 'local-pack',
  configureServer: (s) => void s.middlewares.use(servePack),
  configurePreviewServer: (s) => void s.middlewares.use(servePack),
});

export default defineConfig({
  // 相對路徑：可部署在 GitHub Pages 子路徑或任何免費靜態主機
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: { host: true },
  preview: { host: true },
  build: { chunkSizeWarningLimit: 800 }, // Three.js 本身約 550 kB
  plugins: [
    localPack(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon.png'],
      manifest: {
        name: 'FairyPocket',
        short_name: 'FairyPocket',
        description: '口袋裡的 3D 悅靈寵物',
        lang: 'zh-TW',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#9fd8ff',
        theme_color: '#5fb8f0',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
