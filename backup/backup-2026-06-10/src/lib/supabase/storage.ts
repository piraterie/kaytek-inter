// src/lib/supabase/storage.ts
import { supabase } from './client'

async function compressImage(file: File, maxWidth = 1200, quality = 0.82): Promise<File> {
  return new Promise(resolve => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      let { width, height } = img
      if (width > maxWidth) { height = (height * maxWidth) / width; width = maxWidth }
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
      canvas.toBlob(b => resolve(b ? new File([b], file.name, { type: 'image/jpeg' }) : file), 'image/jpeg', quality)
      URL.revokeObjectURL(url)
    }
    img.src = url
  })
}

export async function uploadPhoto(file: File, interventionId: string, type: 'avant'|'apres'|'autre') {
  if (!file.type.startsWith('image/')) return { url: '', path: '', error: 'Fichier non image' }
  if (file.size > 15 * 1024 * 1024) return { url: '', path: '', error: 'Fichier trop lourd (max 15 MB)' }
  const compressed = await compressImage(file)
  const path = `${interventionId}/${type}-${Date.now()}.jpg`
  const { error } = await supabase.storage.from('intervention-photos').upload(path, compressed, { contentType: 'image/jpeg', upsert: false })
  if (error) return { url: '', path: '', error: error.message }
  const { data } = await supabase.storage.from('intervention-photos').createSignedUrl(path, 300)
  return { url: data?.signedUrl || '', path, error: null }
}

export async function getSignedUrl(storagePath: string, bucket = 'intervention-photos') {
  const { data } = await supabase.storage.from(bucket).createSignedUrl(storagePath, 300)
  return data?.signedUrl || ''
}

export async function getSignedUrls(paths: string[], bucket = 'intervention-photos'): Promise<Record<string, string>> {
  if (!paths.length) return {}
  const { data } = await supabase.storage.from(bucket).createSignedUrls(paths, 300)
  if (!data) return {}
  const map: Record<string, string> = {}
  data.forEach((item, i) => { if (item.signedUrl) map[paths[i]] = item.signedUrl })
  return map
}

export async function uploadLogo(file: File) {
  const ext = file.name.split('.').pop() || 'png'
  const path = `logo.${ext}`
  const { error } = await supabase.storage.from('logos').upload(path, file, { contentType: file.type, upsert: true })
  if (error) return { url: '', error: error.message }
  const { data } = supabase.storage.from('logos').getPublicUrl(path)
  return { url: data.publicUrl + '?t=' + Date.now(), error: null }
}

export async function uploadSignature(blob: Blob, docId: string, docType: 'devis'|'facture') {
  const path = `${docType}-${docId}.png`
  const { error } = await supabase.storage.from('signatures').upload(path, blob, { contentType: 'image/png', upsert: true })
  if (error) return { url: '', error: error.message }
  const { data } = await supabase.storage.from('signatures').createSignedUrl(path, 300)
  return { url: data?.signedUrl || '', error: null }
}

export async function uploadChatMedia(file: File | Blob, type: 'photo' | 'audio', userId: string) {
  const actualMime = file.type || (type === 'photo' ? 'image/jpeg' : 'audio/webm')
  // iOS : préférer mp4 pour l'audio
  const ext = type === 'photo' ? 'jpg'
    : actualMime.includes('mp4') ? 'mp4'
    : actualMime.includes('ogg') ? 'ogg'
    : actualMime.includes('mpeg') ? 'mp3'
    : 'webm'
  const path = `${userId}/${type}-${Date.now()}.${ext}`
  let toUpload: File | Blob = file
  if (type === 'photo' && file instanceof File) toUpload = await compressImage(file)
  const { error } = await supabase.storage.from('chat-media').upload(path, toUpload, { contentType: actualMime, upsert: false })
  if (error) return { url: '', path: '', error: error.message }
  const { data } = await supabase.storage.from('chat-media').createSignedUrl(path, 604800)
  return { url: data?.signedUrl || '', path, error: null }
}

export async function uploadPdf(pdfBlob: Blob, fileName: string) {
  const path = `${Date.now()}-${fileName}`
  const { error } = await supabase.storage.from('pdf-documents').upload(path, pdfBlob, { contentType: 'application/pdf' })
  if (error) return { url: '', path: '', error: error.message }
  const { data } = await supabase.storage.from('pdf-documents').createSignedUrl(path, 300)
  return { url: data?.signedUrl || '', path, error: null }
}
