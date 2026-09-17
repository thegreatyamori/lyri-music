/// <reference types="node" />
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

// Manifest V3 content scripts are not ES modules: they are injected as a
// classic script, so this entry has to be a single self-contained IIFE.
// Everything it needs — Solid, the parser, the styles — is inlined.
export default defineConfig({
  root: join(ROOT, 'src'),
  publicDir: false,
  plugins: [solid()],
  build: {
    outDir: join(ROOT, 'dist'),
    // The pages build already wrote here.
    emptyOutDir: false,
    target: 'chrome116',
    sourcemap: true,
    lib: {
      entry: join(ROOT, 'src/content/index.tsx'),
      name: 'LyriMusicContent',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
