// src/lib/buildGuard.ts
// Filet de sécurité anti-cache : à chaque changement d'APP_BUILD_VERSION,
// désinscrit tous les service workers et vide tous les caches (Cache Storage)
// avant le premier rendu, puis recharge une fois. Évite qu'une ancienne
// version de l'app reste figée sur des assets périmés après une mise à jour,
// indépendamment du cycle de vie normal du service worker (skipWaiting/
// clientsClaim déjà actifs côté Workbox).
import { APP_BUILD_VERSION } from './buildInfo'

const STORAGE_KEY = 'kaytek-build-id'

export async function ensureFreshBuild(): Promise<void> {
  if (typeof window === 'undefined') return

  let lastBuild: string | null = null
  try {
    lastBuild = localStorage.getItem(STORAGE_KEY)
  } catch {
    return // localStorage indisponible (navigation privée stricte, etc.)
  }

  if (lastBuild === APP_BUILD_VERSION) return // déjà à jour, rien à faire

  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map(r => r.unregister()))
    }
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map(k => caches.delete(k)))
    }
  } catch {
    // best-effort — on continue même si la purge échoue partiellement
  }

  try {
    localStorage.setItem(STORAGE_KEY, APP_BUILD_VERSION)
  } catch { /* ignore */ }

  // Ne recharge que si une version précédente était connue (pas au tout
  // premier lancement, où il n'y a évidemment rien à rafraîchir).
  if (lastBuild !== null) {
    window.location.reload()
  }
}
