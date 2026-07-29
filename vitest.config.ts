// vitest.config.ts
// Configuration Vitest dédiée aux tests unitaires (src/**/*.test.ts et
// src/**/*.test.tsx). Séparée de vite.config.ts (qui gère le build
// applicatif + PWA) et de playwright.config.ts (tests end-to-end sous
// tests/) pour ne modifier ni l'un ni l'autre. Reprend l'alias "@" déjà
// défini dans tsconfig.json / vite.config.ts, nécessaire pour importer
// "@/lib/...", et le plugin React (nécessaire pour transformer le JSX des
// tests de composants — absent de ce fichier jusqu'ici car aucun test de
// composant n'existait encore).
//
// environment reste 'node' par défaut (tests logiques purs, plus rapides) —
// les tests de composants qui ont besoin du DOM déclarent explicitement
// `// @vitest-environment jsdom` en tête de fichier (voir
// EmailDevisModal.test.tsx), sans ralentir le reste de la suite.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
  },
})
