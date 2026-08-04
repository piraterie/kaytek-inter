import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'generateSW',
      // 'prompt' + injectRegister: false — l'enregistrement du service worker
      // est fait explicitement par src/components/UpdateBanner.tsx (hook
      // `virtual:pwa-register/react`), qui affiche une bannière "Actualiser
      // maintenant" au lieu de recharger la page à l'improviste (mode
      // 'autoUpdate' d'origine) — un rechargement forcé et silencieux pourrait
      // faire perdre une saisie en cours (devis/facture non enregistré).
      // L'auto-injection du script `registerSW.js` dans index.html est
      // désactivée pour éviter un double enregistrement du service worker.
      registerType: 'prompt',
      injectRegister: false,
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
