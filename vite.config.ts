import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  server: {
    // Bind explicite sur le loopback IPv4 (jamais 0.0.0.0 — pas d'exposition
    // réseau supplémentaire, la sécurité n'est pas affaiblie). Sans cette
    // option, Vite bind sur "localhost", dont la résolution dépend de l'OS/
    // machine (souvent ::1 en priorité sur Windows) — Playwright cible
    // http://127.0.0.1:5183 en dur dans playwright.security.config.ts, et
    // un mismatch IPv4/IPv6 fait alors échouer le health-check du
    // webServer (timeout) même quand Vite a démarré avec succès. Aligne
    // aussi playwright.config.ts (BASE_URL par défaut, voir ce fichier).
    host: '127.0.0.1',
  },
  plugins: [
    react(),
    VitePWA({
      strategies: 'generateSW',
      registerType: 'autoUpdate',
      workbox: {
        importScripts: ['/push-sw.js'],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
      },
      manifest: {
        name: 'Kaytek Inter',
        short_name: 'Kaytek',
        description: 'Gestion interventions serrurerie et vitrerie',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Bundle UMD auto-suffisant : core-js intégré, pas d'imports externes Node.js
      'exceljs': path.resolve(__dirname, 'node_modules/exceljs/dist/exceljs.min.js'),
    }
  },
  optimizeDeps: {
    // Pré-bundle ExcelJS via esbuild → CJS→ESM, évite les imports core-js nus dans le navigateur
    include: ['exceljs'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          query: ['@tanstack/react-query'],
          pdf: ['@react-pdf/renderer'],
          xlsx: ['xlsx'],
          exceljs: ['exceljs'],
        }
      }
    }
  }
})
