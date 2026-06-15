// src/pages/guide/GuidePage.tsx — Redirection intelligente vers le bon guide
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/lib/store'

export default function GuidePage() {
  const { user } = useAuthStore()
  if (user?.role === 'admin') return <Navigate to="/guide/admin" replace />
  return <Navigate to="/guide/intervenant" replace />
}
