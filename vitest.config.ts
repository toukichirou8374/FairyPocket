// vitest 只跑 App 的測試（src/）。Fairy Hub 的測試用 Node 內建的 node:test（npm run test:hub），
// 不能被 vitest 收進來（H3-1 發現：H2 之後 `npm test` 會誤收 scripts/hub/test/*.test.mjs）。
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(viteConfig, defineConfig({ test: { include: ['src/**/*.test.ts', 'tests/**/*.test.ts'] } }));
