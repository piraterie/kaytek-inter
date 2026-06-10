// src/lib/devices.ts
import { supabase } from './supabase/client'

const DEVICE_KEY = 'kaytek-device-id'
const MAX_DEVICES = 2

export interface DeviceRecord {
  id: string
  user_id: string
  device_id: string
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

export async function registerDevice(userId: string): Promise<{ error: string | null }> {
  const device_id = getDeviceId()
  const { nom_appareil, navigateur, systeme_exploitation } = getDeviceInfo()
  const now = new Date().toISOString()

  const { data: existing } = await supabase
    .from('devices')
    .select('id')
    .eq('user_id', userId)
    .eq('device_id', device_id)
    .single()

  if (existing) {
    await supabase
      .from('devices')
      .update({ date_derniere_connexion: now, actif: true, nom_appareil, navigateur, systeme_exploitation })
      .eq('id', existing.id)
    return { error: null }
  }

  // Nouvel appareil — vérifier la limite
  const { count } = await supabase
    .from('devices')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('actif', true)

  if ((count || 0) >= MAX_DEVICES) {
    return { error: 'DEVICE_LIMIT' }
  }

  await supabase.from('devices').insert({
    user_id: userId,
    device_id,
    nom_appareil,
    navigateur,
    systeme_exploitation,
    date_premiere_connexion: now,
    date_derniere_connexion: now,
    actif: true,
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
