// src/hooks/useOnlineStatus.ts
import { useState, useEffect } from 'react'
import { getPendingCount } from '@/lib/offline/queue'

export function useOnlineStatus() {
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)
  const [pendingCount, setPendingCount] = useState(getPendingCount)

  useEffect(() => {
    const onOnline  = () => setOnline(true)
    const onOffline = () => setOnline(false)
    const onQueue   = () => setPendingCount(getPendingCount())

    window.addEventListener('online',  onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('kaytek-queue-change', onQueue)

    return () => {
      window.removeEventListener('online',  onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('kaytek-queue-change', onQueue)
    }
  }, [])

  const refreshPending = () => setPendingCount(getPendingCount())

  return { online, pendingCount, refreshPending }
}
