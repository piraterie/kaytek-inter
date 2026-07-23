// vitest.config.ts
// Configuration Vitest dédiée aux tests unitaires (src/**/*.test.ts).
// Séparée de vite.config.ts (qui gère le build applicatif + PWA) et de
// playwright.config.ts (tests end-to-end sous tests/) pour ne modifier
// ni l'un ni l'autre. Reprend uniquement l'alias "@" déjà défini dans
// tsconfig.json / vite.config.ts, nécessaire pour importer "@/lib/...".
import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
