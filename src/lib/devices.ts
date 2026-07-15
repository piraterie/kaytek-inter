// src/lib/devices.ts
import { supabase } from './supabase/client'

const DEVICE_KEY = 'kaytek-device-id'
const MAX_DEVICES = 2
const STALE_DAYS = 90

export interface DeviceRecord {
  id: string
  user_id: string
  device_id: string
  device_fingerprint: string | null
  nom_appareil: string | null
  navigateur: string | null
  systeme_exploitation: string | null
  adresse_ip: string | null
  date_premiere_connexion: string
  date_derniere_connexion: string
  actif: boolean
}

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}

function getDeviceInfo() {
  const ua = navigator.userAgent

  let navigateur = 'Autre'
  if (/Edg\//.test(ua)) navigateur = 'Edge'
  else if (/OPR\/|Opera\//.test(ua)) navigateur = 'Opera'
  else if (/Chrome\//.test(ua)) navigateur = 'Chrome'
  else if (/Firefox\//.test(ua)) navigateur = 'Firefox'
  else if (/Safari\//.test(ua)) navigateur = 'Safari'

  let systeme_exploitation = 'Autre'
  if (/Windows/.test(ua)) systeme_exploitation = 'Windows'
  else if (/iPhone|iPad/.test(ua)) systeme_exploitation = 'iOS'
  else if (/Android/.test(ua)) systeme_exploitation = 'Android'
  else if (/Mac OS X/.test(ua)) systeme_exploitation = 'macOS'
  else if (/Linux/.test(ua)) systeme_exploitation = 'Linux'

  const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua)
  const nom_appareil = `${isMobile ? 'Mobile' : 'PC'} · ${navigateur} · ${systeme_exploitation}`

  return { nom_appareil, navigateur, systeme_exploitation }
}

// Empreinte stable basée sur caractéristiques matérielles/navigateur.
// Résiste aux : mises à jour mineures navigateur, rotation écran, vidage cookies.
// Ne contient PAS le UA complet (trop volatile entre versions mineures).
function getDeviceFingerprint(): string {
  const ua = navigator.userAgent
  let navigateur = 'Autre'
  if (/Edg\//.test(ua)) navigateur = 'Edge'
  else if (/OPR\/|Opera\//.test(ua)) navigateur = 'Opera'
  else if (/Chrome\//.test(ua)) navigateur = 'Chrome'
  else if (/Firefox\//.test(ua)) navigateur = 'Firefox'
  else if (/Safari\//.test(ua)) navigateur = 'Safari'

  const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua)
  // Normalise portrait/paysage : toujours largeur-max × hauteur-min
  const w = Math.max(screen.width, screen.height)
  const h = Math.min(screen.width, screen.height)

  return [
    isMobile ? 'mobile' : 'desktop',
    navigateur,
    `${w}x${h}`,
    (navigator.language || '').split('-')[0],
    String(navigator.hardwareConcurrency || 0),
  ].join('|')
}

export async function registerDevice(userId: string, organisationId: string, isAdmin = false): Promise<{ error: string | null }> {
  const device_id = getDeviceId()
  const device_fingerprint = getDeviceFingerprint()
  const { nom_appareil, navigateur, systeme_exploitation } = getDeviceInfo()
  const now = new Date().toISOString()

  // Étape 1 — Correspondance exacte par device_id (cas nominal : reconnexion normale)
  const { data: byId } = await supabase
    .from('devices')
    .select('id')
    .eq('user_id', userId)
    .eq('device_id', device_id)
    .single()

  if (byId) {
    await supabase
      .from('devices')
      .update({ date_derniere_connexion: now, actif: true, nom_appareil, navigateur, systeme_exploitation, device_fingerprint })
      .eq('id', byId.id)
    return { error: null }
  }

  // Étape 2 — localStorage vidé → chercher par fingerprint (même appareil physique)
  // Couvre : vider cookies, réinstaller PWA, Safari iOS ITP
  const { data: byFpRows } = await supabase
    .from('devices')
    .select('id')
    .eq('user_id', userId)
    .eq('device_fingerprint', device_fingerprint)
    .order('date_derniere_connexion', { ascending: false })
    .limit(1)

  const byFp = byFpRows?.[0] ?? null

  if (byFp) {
    // Même appareil physique — mettre à jour l'UUID et last_seen sans consommer de slot
    await supabase
      .from('devices')
      .update({ device_id, date_derniere_connexion: now, actif: true, nom_appareil, navigateur, systeme_exploitation })
      .eq('id', byFp.id)
    return { error: null }
  }

  // Étape 3 — Véritable nouvel appareil — vérifier la limite (sauf pour les admins)
  if (!isAdmin) {
    const { count } = await supabase
      .from('devices')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('actif', true)

    if ((count || 0) >= MAX_DEVICES) {
      // 3a — Libérer un slot si un appareil actif n'a pas été vu depuis STALE_DAYS jours
      const staleDate = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString()
      const { data: staleRows } = await supabase
        .from('devices')
        .select('id')
        .eq('user_id', userId)
        .eq('actif', true)
        .lt('date_derniere_connexion', staleDate)
        .order('date_derniere_connexion', { ascending: true })
        .limit(1)

      const stale = staleRows?.[0] ?? null
      if (stale) {
        await supabase.from('devices').update({ actif: false }).eq('id', stale.id)
        // Slot libéré — on continue vers l'insert
      } else {
        // 3b — Fallback pré-migration : appareil actif sans fingerprint (enregistrement ancien)
        // Adopte le slot le plus récent sans fingerprint et y stocke le nouveau device_id + fingerprint
        const { data: nullFpRows } = await supabase
          .from('devices')
          .select('id')
          .eq('user_id', userId)
          .eq('actif', true)
          .is('device_fingerprint', null)
          .order('date_derniere_connexion', { ascending: false })
          .limit(1)

        const nullFp = nullFpRows?.[0] ?? null
        if (nullFp) {
          await supabase
            .from('devices')
            .update({ device_id, device_fingerprint, date_derniere_connexion: now, actif: true, nom_appareil, navigateur, systeme_exploitation })
            .eq('id', nullFp.id)
          return { error: null }
        }

        return { error: 'DEVICE_LIMIT' }
      }
    }
  }

  // Étape 4 — Insérer le nouvel appareil
  await supabase.from('devices').insert({
    user_id: userId,
    device_id,
    device_fingerprint,
    nom_appareil,
    navigateur,
    systeme_exploitation,
    date_premiere_connexion: now,
    date_derniere_connexion: now,
    actif: true,
    organisation_id: organisationId,
  })

  return { error: null }
}

export async function getMyDevices(): Promise<DeviceRecord[]> {
  const { data } = await supabase
    .from('devices')
    .select('*')
    .order('date_derniere_connexion', { ascending: false })
  return data || []
}

export async function disconnectDevice(deviceId: string): Promise<void> {
  await supabase.from('devices').update({ actif: false }).eq('id', deviceId)
}

export async function disconnectAllOtherDevices(): Promise<void> {
  const currentDeviceId = getDeviceId()
  await supabase.from('devices').update({ actif: false }).neq('device_id', currentDeviceId)
}

export async function getUserDevices(userId: string): Promise<DeviceRecord[]> {
  const { data } = await supabase
    .from('devices')
    .select('*')
    .eq('user_id', userId)
    .order('date_derniere_connexion', { ascending: false })
  return data || []
}

export async function revokeDevice(deviceDbId: string): Promise<void> {
  await supabase.from('devices').update({ actif: false }).eq('id', deviceDbId)
}

export function isCurrentDevice(deviceId: string): boolean {
  return deviceId === getDeviceId()
}

export async function resetUserDevices(userId: string): Promise<void> {
  await supabase.from('devices').update({ actif: false }).eq('user_id', userId)
}
