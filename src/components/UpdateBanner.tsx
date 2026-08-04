// src/components/UpdateBanner.tsx
// Bannière de mise à jour PWA : un onglet ouvert de longue durée (session
// admin en arrière-plan, PWA installée) peut continuer à exécuter un vieux
// bundle après un déploiement — y compris un vieux nom d'Edge Function
// Google si une fonction est renommée/supprimée côté serveur. Plutôt que de
// laisser l'utilisateur découvrir l'erreur puis devoir faire Ctrl+Maj+R
// manuellement, on détecte la nouvelle version (service worker en attente)
// et on propose un rechargement en un clic, dès qu'elle est disponible.
import { useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { RefreshCw } from 'lucide-react'

const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000 // 30 min — suffisant pour un onglet longtemps ouvert

export default function UpdateBanner() {
  const [reloading, setReloading] = useState(false)
  const registrationRef = useRef<ServiceWorkerRegistration | undefined>(undefined)

  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      registrationRef.current = registration
    },
  })

  useEffect(() => {
    const id = window.setInterval(() => {
      registrationRef.current?.update().catch(() => { /* best-effort */ })
    }, UPDATE_CHECK_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [])

  if (!needRefresh) return null

  const handleReload = () => {
    setReloading(true)
    updateServiceWorker(true)
  }

  return (
    <div style={{
      background: 'var(--blBg)',
      borderBottom: '1px solid var(--blBd)',
      padding: '9px 16px',
      display: 'flex', alignItems: 'center', gap: 10,
      flexShrink: 0,
    }}>
      <RefreshCw size={16} color="var(--blTx)" style={{ flexShrink: 0 }} className={reloading ? 'spin' : undefined} />
      <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--blTx)' }}>
        Une nouvelle version de Kaytek Inter est disponible.
      </span>
      <button
        onClick={handleReload}
        disabled={reloading}
        style={{
          fontSize: 12, fontWeight: 600, color: 'var(--blTx)',
          background: 'rgba(0,0,0,0.08)', border: '1px solid var(--blBd)',
          borderRadius: 6, padding: '4px 10px', cursor: reloading ? 'default' : 'pointer',
          flexShrink: 0, fontFamily: 'inherit', opacity: reloading ? 0.7 : 1,
        }}
      >
        {reloading ? 'Actualisation…' : 'Actualiser maintenant'}
      </button>
    </div>
  )
}
