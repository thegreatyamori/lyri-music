/// <reference types="node" />
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// `package.json` is `type: module`, so this config is ESM and `__dirname` does
// not exist. The project root is the directory holding this file.
const ROOT = fileURLToPath(new URL('.', import.meta.url));

// Extension pages and the background module, as ES modules.
// The content script needs a different format and has its own config —
// see vite.content.config.ts.
export default defineConfig({
  root: join(ROOT, 'src'),
  publicDir: join(ROOT, 'public'),
  plugins: [solid()],
  build: {
    outDir: join(ROOT, 'dist'),
    emptyOutDir: true,
    target: 'chrome116',
    sourcemap: true,
    rollupOptions: {
      input: {
        popup: join(ROOT, 'src/popup/index.html'),
        worker: join(ROOT, 'src/background/worker.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
