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
  const { data } = await supabase.storage.from('intervention-photos').createSignedUrl(path, 3600 * 24 * 365)
  return { url: data?.signedUrl || '', path, error: null }
}

export async function getSignedUrl(storagePath: string, bucket = 'intervention-photos') {
  const { data } = await supabase.storage.from(bucket).createSignedUrl(storagePath, 3600)
  return data?.signedUrl || ''
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
  const { data } = await supabase.storage.from('signatures').createSignedUrl(path, 3600 * 24 * 365)
  return { url: data?.signedUrl || '', error: null }
}

export async function uploadPdf(pdfBlob: Blob, fileName: string) {
  const path = `${Date.now()}-${fileName}`
  const { error } = await supabase.storage.from('pdf-documents').upload(path, pdfBlob, { contentType: 'application/pdf' })
  if (error) return { url: '', path: '', error: error.message }
  const { data } = await supabase.storage.from('pdf-documents').createSignedUrl(path, 3600 * 24 * 30)
  return { url: data?.signedUrl || '', path, error: null }
}
