// src/components/OfflineBanner.tsx
import { useEffect, useRef } from 'react'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { syncQueue } from '@/lib/offline/sync'
import { useToastStore } from '@/lib/store'

export default function OfflineBanner() {
  const { online, pendingCount, refreshPending } = useOnlineStatus()
  const { add } = useToastStore()
  const prevOnline = useRef(online)
  const syncing = useRef(false)

  useEffect(() => {
    const wasOffline = !prevOnline.current && online
    prevOnline.current = online

    if (!wasOffline) return           // pas de transition offline → online
    if (syncing.current) return       // déjà en cours

    syncing.current = true

    if (pendingCount > 0) {
      add('Connexion rétablie — synchronisation en cours…', 'info')
      syncQueue().then(({ synced, failed, skipped }) => {
        refreshPending()
        syncing.current = false
        if (synced > 0)   add(`✓ ${synced} opération(s) synchronisée(s)`, 'success')
        if (failed > 0)   add(`${failed} opération(s) non synchronisée(s) — nouvelle tentative automatique`, 'warning')
        if (skipped > 0)  add(`${skipped} opération(s) supprimée(s) après trop d'échecs`, 'warning')
      })
    } else {
      add('Connexion rétablie ✓', 'success')
      syncing.current = false
    }
  }, [online]) // eslint-disable-line react-hooks/exhaustive-deps

  // Rien à afficher si online et rien en attente
  if (online && pendingCount === 0) return null

  return (
    <div style={{
      background: online ? 'var(--amBg)' : 'var(--rdBg)',
      borderBottom: `1px solid ${online ? 'var(--amBd)' : 'var(--rdBd)'}`,
      padding: '9px 16px',
      display: 'flex', alignItems: 'center', gap: 10,
      flexShrink: 0,
    }}>
      <span style={{ fontSize: 18 }}>{online ? '🔄' : '📡'}</span>
      <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: online ? 'var(--amTx)' : 'var(--rdTx)' }}>
        {online
          ? `${pendingCount} opération${pendingCount > 1 ? 's' : ''} en attente de synchronisation`
          : 'Mode hors ligne — les modifications seront synchronisées à la reconnexion'}
      </span>
      {online && pendingCount > 0 && (
        <span className="pill pill-amber" style={{ flexShrink: 0 }}>
          {pendingCount} en attente
        </span>
      )}
      {!online && (
        <span className="pill pill-red" style={{ flexShrink: 0 }}>Hors ligne</span>
      )}
    </div>
  )
}
