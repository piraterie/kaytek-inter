// src/pages/MessagingPage.tsx
import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { MessageCircle, Mail, CheckCheck, Trash2, X, ArrowLeft, Handshake, Users } from 'lucide-react'
import { useMessages, useSendMessage, useConversations, useIsMobile, useDeleteMessage } from '@/lib/hooks'
import { usePartnerConnections, usePartnerUnreadCounts } from '@/lib/hooks/partners'
import { useAuthStore, useToastStore } from '@/lib/store'
import { uploadChatMedia } from '@/lib/supabase/storage'
import { Lightbox } from '@/components/Lightbox'
import { DocSheet, SheetRow } from '@/components/DocSheet'
import ConfirmModal from '@/components/ConfirmModal'
import PartnerConversationPanel from '@/components/PartnerConversationPanel'
import type { Profile, PartnerConnection } from '@/types'

// ── SVG Icons ────────────────────────────────────────────────────────────────
const IconCamera = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
    <circle cx="12" cy="13" r="4"/>
  </svg>
)
const IconMic = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
    <line x1="12" y1="19" x2="12" y2="23"/>
    <line x1="8" y1="23" x2="16" y2="23"/>
  </svg>
)
const IconSend = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13"/>
    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
  </svg>
)
const IconArrowLeft = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12"/>
    <polyline points="12 19 5 12 12 5"/>
  </svg>
)
// ─────────────────────────────────────────────────────────────────────────────

function getBestAudioMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/mpeg']
  return types.find(t => MediaRecorder.isTypeSupported(t)) ?? ''
}

function formatLastMsg(msg: any): string {
  if (!msg) return ''
  if (msg.type === 'audio' || msg.type === 'vocal') return 'Message vocal'
  if (msg.type === 'photo') return 'Photo'
  const text = msg.contenu || ''
  return text.length > 52 ? text.slice(0, 52) + '…' : text
}

function formatMsgTime(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.round((today.getTime() - msgDay.getTime()) / 86400000)
  if (diffDays === 0) return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  if (diffDays === 1) return 'Hier'
  if (diffDays < 7) return d.toLocaleDateString('fr-FR', { weekday: 'short' })
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
}

// ── Lecteur audio compact pour les bulles vocales ────────────────────────────
function AudioMessage({ src, isMe }: { src: string; isMe: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const fmtTime = (s: number) =>
    !isFinite(s) || isNaN(s) || s === 0 ? '0:00' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  const progress = duration > 0 ? currentTime / duration : 0

  function togglePlay() {
    if (!audioRef.current) return
    if (playing) audioRef.current.pause()
    else audioRef.current.play().catch(() => {})
  }
  function seek(e: React.MouseEvent<HTMLDivElement>) {
    if (!audioRef.current || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    audioRef.current.currentTime = ((e.clientX - rect.left) / rect.width) * duration
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minWidth: 170, padding: '4px 0' }}>
      <audio ref={audioRef} src={src} preload="metadata"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrentTime(0) }}
        onTimeUpdate={e => setCurrentTime((e.target as HTMLAudioElement).currentTime)}
        onLoadedMetadata={e => setDuration((e.target as HTMLAudioElement).duration)}
        style={{ display: 'none' }} />
      {/* Bouton play/pause */}
      <button onClick={e => { e.stopPropagation(); togglePlay() }}
        style={{ width: 34, height: 34, borderRadius: '50%', background: isMe ? 'rgba(255,255,255,0.2)' : 'var(--blBg)', border: `1.5px solid ${isMe ? 'rgba(255,255,255,0.3)' : 'var(--blBd)'}`, color: isMe ? '#fff' : 'var(--blTx)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent' } as React.CSSProperties}>
        {playing
          ? <svg width="10" height="10" viewBox="0 0 10 10"><rect x=".5" y=".5" width="3" height="9" rx=".8" fill="currentColor"/><rect x="6.5" y=".5" width="3" height="9" rx=".8" fill="currentColor"/></svg>
          : <svg width="10" height="10" viewBox="0 0 10 10"><polygon points="2,0.5 9.5,5 2,9.5" fill="currentColor"/></svg>
        }
      </button>
      {/* Piste + durée */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <div onClick={seek}
          style={{ height: 4, borderRadius: 3, background: isMe ? 'rgba(255,255,255,0.22)' : 'var(--b1)', cursor: 'pointer', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', borderRadius: 3, background: isMe ? 'rgba(255,255,255,0.85)' : 'var(--bl)', width: `${progress * 100}%`, transition: 'width .08s linear' }} />
        </div>
        <span style={{ fontSize: 11, color: isMe ? 'rgba(255,255,255,0.65)' : 'var(--t3)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
          {fmtTime(playing ? currentTime : duration)}
        </span>
      </div>
      {/* Icône micro */}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={isMe ? 'rgba(255,255,255,0.45)' : 'var(--t3)'} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      </svg>
    </div>
  )
}
// ─────────────────────────────────────────────────────────────────────────────

// ── Modal de confirmation avant envoi vocal ──────────────────────────────────
function VoiceConfirmModal({ src, onSend, onCancel, uploading }: { src: string; onSend: () => void; onCancel: () => void; uploading: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const fmtTime = (s: number) =>
    !isFinite(s) || isNaN(s) || s === 0 ? '0:00' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', zIndex: 300, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', animation: 'fadeIn .18s ease' }}>
      <div style={{ background: 'var(--s0)', borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 600, padding: '0 20px', paddingBottom: 'calc(20px + env(safe-area-inset-bottom))', boxShadow: '0 -8px 40px rgba(0,0,0,.25)', animation: 'sheetUp .24s cubic-bezier(.32,.72,0,1)' }}>
        <div style={{ width: 40, height: 4, background: 'var(--s3)', borderRadius: 2, margin: '14px auto 18px' }} />
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--t0)', textAlign: 'center', marginBottom: 16, letterSpacing: '-.02em' }}>
          Message vocal
        </div>
        <audio ref={audioRef} src={src} preload="metadata"
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onLoadedMetadata={e => setDuration((e.target as HTMLAudioElement).duration)} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: 'var(--s1)', borderRadius: 16, padding: '12px 16px', marginBottom: 14, border: '1px solid var(--b1)' }}>
          <button onClick={() => playing ? audioRef.current?.pause() : audioRef.current?.play().catch(() => {})}
            style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--bl)', border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent' } as React.CSSProperties}>
            {playing
              ? <svg width="11" height="11" viewBox="0 0 11 11"><rect x="1" y="1" width="3.5" height="9" rx=".8" fill="currentColor"/><rect x="6.5" y="1" width="3.5" height="9" rx=".8" fill="currentColor"/></svg>
              : <svg width="11" height="11" viewBox="0 0 11 11"><polygon points="2,1 10,5.5 2,10" fill="currentColor"/></svg>
            }
          </button>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t0)' }}>Écouter l'enregistrement</div>
            <div style={{ fontSize: 12, color: 'var(--t3)', fontVariantNumeric: 'tabular-nums', marginTop: 1 }}>{fmtTime(duration)}</div>
          </div>
        </div>
        <div style={{ fontSize: 13, color: 'var(--t2)', textAlign: 'center', marginBottom: 18 }}>Envoyer ce message vocal ?</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel}
            style={{ flex: 1, padding: '13px 0', borderRadius: 14, border: '1px solid var(--b1)', background: 'var(--s1)', color: 'var(--t1)', fontSize: 15, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent' } as React.CSSProperties}>
            Annuler
          </button>
          <button onClick={onSend} disabled={uploading}
            style={{ flex: 1, padding: '13px 0', borderRadius: 14, border: 'none', background: 'var(--bl)', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: uploading ? 0.75 : 1, WebkitTapHighlightColor: 'transparent' } as React.CSSProperties}>
            {uploading ? 'Envoi…' : 'Envoyer'}
          </button>
        </div>
      </div>
    </div>
  )
}
// ─────────────────────────────────────────────────────────────────────────────

export default function MessagingPage() {
  const { userId } = useParams<{ userId: string }>()
  const nav = useNavigate()
  const location = useLocation()
  const { user } = useAuthStore()
  const { add } = useToastStore()
  const [text, setText] = useState('')
  const [selected, setSelected] = useState<Profile | null>(null)
  const [recording, setRecording] = useState(false)
  const [recordingSecs, setRecordingSecs] = useState(0)
  const [cancelProgress, setCancelProgress] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [showList, setShowList] = useState(!userId)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null)
  const [showScrollDown, setShowScrollDown] = useState(false)
  const [pendingAudio, setPendingAudio] = useState<{ blob: Blob; url: string } | null>(null)
  const [contextMsg, setContextMsg] = useState<any>(null)
  const [deleteTarget, setDeleteTarget] = useState<any>(null)
  const [scope, setScope] = useState<'team' | 'partners'>('team')
  const [selectedPartner, setSelectedPartner] = useState<PartnerConnection | null>(null)

  const msgsRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isFirstLoad = useRef(true)
  const isAtBottom = useRef(true)
  const isCancelling = useRef(false)
  const recordStartX = useRef(0)
  const lpStart = useRef<{ x: number; y: number } | null>(null)
  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isMobile = useIsMobile()
  const isAdmin = user?.role === 'admin'

  const { data: conversations = [] } = useConversations()
  const activeId = userId || selected?.id || ''
  const { data: messages = [] } = useMessages(activeId)
  const send = useSendMessage()
  const deleteMutation = useDeleteMessage()

  const { data: partnerConnectionsRaw = [] } = usePartnerConnections()
  const acceptedPartners = partnerConnectionsRaw.filter(c => c.status === 'accepted')
  const { data: partnerUnread = {} } = usePartnerUnreadCounts()
  const partnerUnreadTotal = Object.values(partnerUnread).reduce((s, n) => s + n, 0)

  function selectPartner(c: PartnerConnection) {
    setSelectedPartner(c); setShowList(false)
  }
  function switchScope(next: 'team' | 'partners') {
    setScope(next); setShowList(true)
  }

  useEffect(() => {
    if (!activeId && conversations.length) {
      const first = conversations[0]
      setSelected(first)
      if (!isMobile || !isAdmin) nav(`/messagerie/${first.id}`, { replace: true })
    }
  }, [conversations, activeId, nav, isMobile, isAdmin])

  useEffect(() => {
    if (userId && conversations.length) {
      const c = conversations.find(c => c.id === userId)
      if (c) { setSelected(c); setShowList(false) }
      else if (!isAdmin) nav('/messagerie', { replace: true })
    }
  }, [userId, conversations, isAdmin, nav])

  useEffect(() => {
    setFirstUnreadId(null)
    isFirstLoad.current = true
    isAtBottom.current = true
    setShowScrollDown(false)
  }, [activeId])

  useEffect(() => {
    if (!messages.length) return
    if (isFirstLoad.current) {
      isFirstLoad.current = false
      const firstUnread = (messages as any[]).find(m => m.destinataire_id === user?.id && !m.lu)
      if (firstUnread) setFirstUnreadId(firstUnread.id)
      requestAnimationFrame(() => {
        if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight
      })
    } else {
      if (isAtBottom.current && msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight
    }
  }, [messages, user?.id])

  useEffect(() => {
    const prefilled = (location.state as any)?.prefilledText
    if (prefilled) { setText(prefilled); window.history.replaceState({}, '') }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleScroll() {
    if (!msgsRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = msgsRef.current
    const distFromBottom = scrollHeight - scrollTop - clientHeight
    isAtBottom.current = distFromBottom < 60
    setShowScrollDown(distFromBottom > 120)
  }

  function scrollToBottom() {
    msgsRef.current?.scrollTo({ top: msgsRef.current.scrollHeight, behavior: 'smooth' })
  }

  function selectConversation(c: Profile) {
    setSelected(c); setShowList(false); nav(`/messagerie/${c.id}`)
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim() || !activeId) return
    const t = text; setText('')
    try { await send.mutateAsync({ destinataire_id: activeId, contenu: t, type: 'texte' }) }
    catch (err: any) { add(err.message, 'error'); setText(t) }
  }

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file || !activeId) return
    setUploading(true)
    const { url, path, error } = await uploadChatMedia(file, 'photo', user!.id)
    if (error) { add('Erreur upload: ' + error, 'error'); setUploading(false); return }
    try { await send.mutateAsync({ destinataire_id: activeId, contenu: url || path, type: 'photo', media_url: path || url }) }
    catch (err: any) { add(err.message, 'error') }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  // ── Vocal hold-to-record ─────────────────────────────────────────────────
  async function startRecording() {
    if (!window.isSecureContext) { add('Microphone indisponible : HTTPS requis', 'error'); return }
    if (!navigator.mediaDevices?.getUserMedia) { add('Microphone non disponible sur ce navigateur', 'warning'); return }
    const mimeType = getBestAudioMime()
    if (mimeType === null) { add('Enregistrement audio non supporté sur ce navigateur', 'warning'); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {})
      chunksRef.current = []
      isCancelling.current = false
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        setRecording(false); setRecordingSecs(0)
        if (timerRef.current) clearInterval(timerRef.current)
        if (isCancelling.current || !chunksRef.current.length) return
        const blob = new Blob(chunksRef.current, mimeType ? { type: mimeType } : {})
        const url = URL.createObjectURL(blob)
        setPendingAudio({ blob, url })
      }
      mr.start()
      mediaRef.current = mr
      setRecording(true); setRecordingSecs(0)
      timerRef.current = setInterval(() => setRecordingSecs(s => s + 1), 1000)
    } catch (err: any) {
      const n = err?.name || ''
      if (n === 'NotAllowedError' || n === 'PermissionDeniedError') add('Microphone refusé — autorisez l\'accès dans les paramètres du navigateur', 'error')
      else if (n === 'NotFoundError' || n === 'DevicesNotFoundError') add('Aucun microphone détecté sur cet appareil', 'error')
      else if (n === 'NotSupportedError') add('Enregistrement audio non supporté sur ce navigateur', 'warning')
      else if (n === 'SecurityError') add('Microphone bloqué — HTTPS requis', 'error')
      else if (n === 'AbortError') add('Enregistrement interrompu', 'warning')
      else add(`Microphone indisponible : ${err?.message || n || 'erreur inconnue'}`, 'error')
    }
  }

  function stopRecording(cancelled: boolean) {
    isCancelling.current = cancelled
    mediaRef.current?.stop()
    if (timerRef.current) clearInterval(timerRef.current)
    setCancelProgress(0)
  }

  function handleMicDown(e: React.PointerEvent<HTMLButtonElement>) {
    e.preventDefault()
    if (uploading || recording) return
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
    recordStartX.current = e.clientX
    isCancelling.current = false; setCancelProgress(0)
    startRecording()
  }
  function handleMicMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!recording) return
    const dx = e.clientX - recordStartX.current
    if (dx < 0) {
      setCancelProgress(Math.min(1, -dx / 80))
      isCancelling.current = dx < -80
    } else { setCancelProgress(0); isCancelling.current = false }
  }
  function handleMicUp() {
    if (!recording) return
    stopRecording(isCancelling.current)
  }

  async function sendPendingAudio() {
    if (!pendingAudio || !activeId) return
    const { blob, url } = pendingAudio
    setPendingAudio(null)
    URL.revokeObjectURL(url)
    setUploading(true)
    const { url: uploadUrl, path, error } = await uploadChatMedia(blob, 'audio', user!.id)
    if (error) { add('Erreur upload audio: ' + error, 'error'); setUploading(false); return }
    try { await send.mutateAsync({ destinataire_id: activeId, contenu: uploadUrl || path, type: 'audio', media_url: path || uploadUrl }) }
    catch (err: any) { add('Erreur envoi vocal: ' + err.message, 'error') }
    setUploading(false)
  }
  // ────────────────────────────────────────────────────────────────────────────

  // ── Long-press pour supprimer ────────────────────────────────────────────
  function handleMsgDown(e: React.PointerEvent, msg: any) {
    lpStart.current = { x: e.clientX, y: e.clientY }
    lpTimer.current = setTimeout(() => {
      lpStart.current = null
      if ('vibrate' in navigator) navigator.vibrate(32)
      setContextMsg(msg)
    }, 550)
  }
  function handleMsgMove(e: React.PointerEvent) {
    if (!lpStart.current || !lpTimer.current) return
    const dx = e.clientX - lpStart.current.x
    const dy = e.clientY - lpStart.current.y
    if (dx * dx + dy * dy > 80) {
      clearTimeout(lpTimer.current); lpTimer.current = null; lpStart.current = null
    }
  }
  function handleMsgUp() {
    if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null }
    lpStart.current = null
  }

  async function handleDeleteMsg() {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync({ id: deleteTarget.id, mediaPath: deleteTarget.media_url })
      add('Message supprimé', 'success')
    } catch (err: any) { add('Erreur : ' + err.message, 'error') }
    setDeleteTarget(null)
  }
  // ────────────────────────────────────────────────────────────────────────────

  function fmtSecs(s: number) { return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}` }
  function isAudioUrl(url: string) { return url.includes('/audio-') || /\.(webm|mp3|ogg|opus|wav|m4a)(\?|$)/i.test(url) }

  function renderMessage(contenu: string, type: string, isMe: boolean) {
    if (type === 'audio' || (type === 'photo' && isAudioUrl(contenu)))
      return <AudioMessage src={contenu} isMe={isMe} />
    if (type === 'photo') return (
      <img src={contenu} alt="photo" onClick={() => setLightboxSrc(contenu)}
        style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8, display: 'block', cursor: 'zoom-in', objectFit: 'cover', width: '100%' }} />
    )
    return <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 14, lineHeight: 1.45 }}>{contenu}</span>
  }

  const audioSupported = typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  const isCancelActive = cancelProgress > 0.55

  // Mobile: topbar est position:fixed (56px+safe-area), main-content a padding-top correspondant.
  // marginTop:0 = le composant commence pile en bas de la topbar.
  // height:100% = remplit exactement la zone contenu (100dvh - padding-top - padding-bottom).
  // Desktop: annuler le padding 18px haut+bas du parent via marges négatives et calc(100% + 36px).
  // On utilise 100% du parent plutôt que calc(100dvh - 74px) pour s'adapter à la bannière d'alerte.
  const outerStyle: React.CSSProperties = isMobile
    ? { display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%', marginTop: 0, marginLeft: -16, marginRight: -16 }
    : { display: 'flex', flexDirection: 'column', overflow: 'hidden', height: 'calc(100% + 36px)', marginTop: -18, marginLeft: -18, marginRight: -18 }

  return (
    <div style={outerStyle}>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── LISTE CONVERSATIONS ── */}
        <div style={{ width: isMobile ? '100%' : 280, minWidth: isMobile ? '100%' : 280, display: !isAdmin || (isMobile && !showList) ? 'none' : 'flex', flexDirection: 'column', background: 'var(--s0)', borderRight: '1px solid var(--b0)' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--b0)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isAdmin ? 10 : 0 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--t0)', letterSpacing: '-.02em' }}>Messages</span>
              <span style={{ fontSize: 12, color: 'var(--t3)', background: 'var(--s2)', padding: '2px 8px', borderRadius: 20 }}>
                {scope === 'team' ? conversations.length : acceptedPartners.length} contact{(scope === 'team' ? conversations.length : acceptedPartners.length) > 1 ? 's' : ''}
              </span>
            </div>
            {isAdmin && (
              <div style={{ display: 'flex', gap: 4, background: 'var(--s1)', borderRadius: 10, padding: 3 }}>
                <button onClick={() => switchScope('team')}
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '6px 8px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: scope === 'team' ? 'var(--s0)' : 'transparent', color: scope === 'team' ? 'var(--t0)' : 'var(--t3)', boxShadow: scope === 'team' ? 'var(--sh0)' : 'none' }}>
                  <Users size={13} /> Équipe
                </button>
                <button onClick={() => switchScope('partners')}
                  style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '6px 8px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: scope === 'partners' ? 'var(--s0)' : 'transparent', color: scope === 'partners' ? 'var(--t0)' : 'var(--t3)', boxShadow: scope === 'partners' ? 'var(--sh0)' : 'none' }}>
                  <Handshake size={13} /> Partenaires
                  {partnerUnreadTotal > 0 && (
                    <span style={{ position: 'absolute', top: 2, right: 10, width: 7, height: 7, borderRadius: '50%', background: '#dc2626' }} />
                  )}
                </button>
              </div>
            )}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'none' }}>
            {scope === 'partners' ? (
              <>
                {acceptedPartners.length === 0 && (
                  <div style={{ padding: 32, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8, opacity: 0.5 }}><Handshake size={30} /></div>
                    Aucun partenaire connecté.
                    <div style={{ marginTop: 4 }}>Rendez-vous dans Réseau partenaires pour en ajouter un.</div>
                  </div>
                )}
                {acceptedPartners.map(c => {
                  const active = selectedPartner?.id === c.id
                  const name = c.partner_profile?.nom_public || 'Organisation partenaire'
                  const unread = partnerUnread[c.id] || 0
                  return (
                    <div key={c.id} onClick={() => selectPartner(c)}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--b0)', background: active ? 'var(--blBg)' : 'transparent', transition: 'background .12s', minHeight: 68, WebkitTapHighlightColor: 'transparent' } as React.CSSProperties}
                      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'var(--s1)' }}
                      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}>
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        <div className="avatar" style={{ width: 46, height: 46, fontSize: 15 }}>{name.slice(0, 2).toUpperCase()}</div>
                        {unread > 0 && (
                          <div style={{ position: 'absolute', top: -3, right: -3, minWidth: 18, height: 18, background: '#dc2626', color: '#fff', borderRadius: 9, border: '2px solid var(--s0)', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>
                            {unread > 9 ? '9+' : unread}
                          </div>
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: unread > 0 ? 700 : 500, color: active ? 'var(--blTx)' : 'var(--t0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                        <div style={{ fontSize: 12, color: 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.partner_profile?.metier || 'Partenaire'}</div>
                      </div>
                      {active && unread === 0 && <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--bl)', flexShrink: 0 }} />}
                    </div>
                  )
                })}
              </>
            ) : (
            <>
            {conversations.length === 0 && (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8, opacity: 0.5 }}><MessageCircle size={30} /></div>Aucun contact disponible
              </div>
            )}
            {conversations.map(c => {
              const active = activeId === c.id
              const hasUnread = (c as any).unreadCount > 0
              const unreadCount = (c as any).unreadCount || 0
              const lastMsg = (c as any).lastMessage
              const displayName = (c.prenom || c.nom) ? `${c.prenom ?? ''} ${c.nom ?? ''}`.trim() : c.email
              return (
                <div key={c.id} onClick={() => selectConversation(c)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--b0)', background: active ? 'var(--blBg)' : 'transparent', transition: 'background .12s', minHeight: 68, WebkitTapHighlightColor: 'transparent' } as React.CSSProperties}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'var(--s1)' }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}>
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <div className={`avatar ${c.role === 'admin' ? 'purple' : ''}`} style={{ width: 46, height: 46, fontSize: 15 }}>
                      {(c.prenom?.[0] || c.email?.[0] || '?').toUpperCase()}{(c.nom?.[0] || '').toUpperCase()}
                    </div>
                    {unreadCount > 0 && (
                      <div style={{ position: 'absolute', top: -3, right: -3, minWidth: 18, height: 18, background: '#dc2626', color: '#fff', borderRadius: 9, border: '2px solid var(--s0)', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginBottom: 2 }}>
                      <span style={{ fontSize: 14, fontWeight: hasUnread ? 700 : 500, color: active ? 'var(--blTx)' : 'var(--t0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{displayName}</span>
                      {lastMsg && <span style={{ fontSize: 11, color: hasUnread ? 'var(--rd)' : 'var(--t3)', flexShrink: 0, fontWeight: hasUnread ? 600 : 400 }}>{formatMsgTime(lastMsg.created_at)}</span>}
                    </div>
                    <div style={{ fontSize: 12, color: hasUnread ? 'var(--t1)' : 'var(--t3)', fontWeight: hasUnread ? 500 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {lastMsg ? (lastMsg.expediteur_id === user?.id ? 'Vous : ' : '') + formatLastMsg(lastMsg) : (c.role === 'admin' ? 'Administrateur' : 'Intervenant')}
                    </div>
                  </div>
                  {active && !hasUnread && <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--bl)', flexShrink: 0 }} />}
                </div>
              )
            })}
            </>
            )}
          </div>
        </div>

        {/* ── ZONE CHAT ── */}
        <div style={{ flex: 1, display: isAdmin && isMobile && showList ? 'none' : 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--bg)' }}>
          {scope === 'partners' ? (
            selectedPartner ? (
              <PartnerConversationPanel connection={selectedPartner} onBack={isAdmin && isMobile ? () => setShowList(true) : undefined} />
            ) : (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--t3)', gap: 12 }}>
                <Handshake size={44} style={{ opacity: 0.4 }} />
                <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--t2)' }}>Sélectionner un partenaire</div>
                <div style={{ fontSize: 13 }}>Choisissez un partenaire connecté pour discuter</div>
              </div>
            )
          ) : selected ? (
            <>
              {/* Header */}
              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--b0)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--s0)', flexShrink: 0, minHeight: 52 }}>
                {isAdmin && isMobile && (
                  <button onClick={() => setShowList(true)} className="btn-icon"
                    style={{ flexShrink: 0, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <IconArrowLeft />
                  </button>
                )}
                <div className="avatar" style={{ width: 34, height: 34, fontSize: 11, flexShrink: 0 }}>
                  {(selected.prenom?.[0] || selected.email?.[0] || '?').toUpperCase()}{(selected.nom?.[0] || '').toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {(selected.prenom || selected.nom) ? `${selected.prenom ?? ''} ${selected.nom ?? ''}`.trim() : selected.email}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--t3)' }}>{selected.role === 'admin' ? 'Administrateur' : 'Intervenant'}</div>
                </div>
                {uploading && <span style={{ fontSize: 11, color: 'var(--t3)', flexShrink: 0 }}>Envoi…</span>}
              </div>

              {/* Messages */}
              <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
                <div ref={msgsRef} onScroll={handleScroll}
                  style={{ height: '100%', overflowY: 'auto', padding: isMobile ? '10px 8px' : '14px 12px', display: 'flex', flexDirection: 'column', gap: 2, scrollbarWidth: 'none' }}>
                  {messages.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 40, color: 'var(--t3)', fontSize: 13 }}>
                      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10, opacity: 0.5 }}><MessageCircle size={34} /></div>Commencez la conversation
                    </div>
                  )}
                  {(messages as any[]).map((m, idx) => {
                    const isMe = m.expediteur_id === user?.id
                    const prevMsg = (messages as any[])[idx - 1]
                    const nextMsg = (messages as any[])[idx + 1]
                    const showAvatar = !isMe && (!prevMsg || prevMsg.expediteur_id !== m.expediteur_id)
                    const isLastInGroup = !nextMsg || nextMsg.expediteur_id !== m.expediteur_id
                    const isPhoto = m.type === 'photo'
                    const isAudio = m.type === 'audio'
                    const isFirstUnread = firstUnreadId === m.id
                    const canDelete = isMe || isAdmin

                    return (
                      <div key={m.id} style={{ display: 'contents' }}>
                        {isFirstUnread && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px', flexShrink: 0 }}>
                            <div style={{ flex: 1, height: 1, background: 'var(--blBd)' }} />
                            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--blTx)', background: 'var(--blBg)', padding: '3px 12px', borderRadius: 20, border: '1px solid var(--blBd)', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Mail size={11} /> Nouveaux messages</span>
                            <div style={{ flex: 1, height: 1, background: 'var(--blBd)' }} />
                          </div>
                        )}
                        <div id={`msg-${m.id}`}
                          {...(canDelete ? {
                            onPointerDown: (e: React.PointerEvent) => handleMsgDown(e, m),
                            onPointerMove: handleMsgMove,
                            onPointerUp: handleMsgUp,
                            onPointerCancel: handleMsgUp,
                          } : {})}
                          style={{
                            display: 'flex', gap: 6, alignItems: 'flex-end',
                            flexDirection: isMe ? 'row-reverse' : 'row',
                            marginTop: showAvatar ? 8 : 1,
                            marginBottom: isLastInGroup ? 2 : 0,
                            userSelect: canDelete ? 'none' : 'auto',
                            WebkitUserSelect: canDelete ? 'none' : 'auto',
                            WebkitTapHighlightColor: 'transparent',
                          } as React.CSSProperties}>
                          {!isMe && (
                            <div style={{ width: isMobile ? 24 : 28, flexShrink: 0 }}>
                              {showAvatar && (
                                <div className="avatar" style={{ width: isMobile ? 24 : 28, height: isMobile ? 24 : 28, fontSize: isMobile ? 8 : 9 }}>
                                  {(m.expediteur?.prenom?.[0] || '') + (m.expediteur?.nom?.[0] || '')}
                                </div>
                              )}
                            </div>
                          )}
                          <div style={{ maxWidth: isMobile ? '82%' : '62%', display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
                            {showAvatar && !isMe && (
                              <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 2, paddingLeft: 4, fontWeight: 500 }}>
                                {m.expediteur?.prenom || m.expediteur?.nom || ''}
                              </div>
                            )}
                            <div style={{
                              padding: isPhoto ? 3 : '8px 12px',
                              borderRadius: isMe ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
                              background: isMe ? 'var(--bl)' : 'var(--s0)',
                              color: isMe ? '#fff' : 'var(--t0)',
                              border: isMe ? 'none' : '1px solid var(--b1)',
                              boxShadow: '0 1px 2px rgba(0,0,0,.07)',
                              wordBreak: 'break-word', maxWidth: '100%',
                              minWidth: isAudio ? 190 : 'auto',
                            }}>
                              {renderMessage(m.contenu, m.type, isMe)}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 2, paddingLeft: 4, paddingRight: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
                              <span>{new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                              {isMe && <CheckCheck size={12} color="var(--bl)" />}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Bouton scroll down compact */}
                {showScrollDown && (
                  <button onClick={scrollToBottom}
                    style={{ position: 'absolute', bottom: 10, right: 12, background: 'var(--s0)', border: '1px solid var(--b1)', borderRadius: '50%', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 10, boxShadow: '0 2px 10px rgba(0,0,0,.18)', WebkitTapHighlightColor: 'transparent' } as React.CSSProperties}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--bl)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>
                    </svg>
                  </button>
                )}
              </div>

              {/* Barre d'envoi */}
              <form onSubmit={handleSend}
                style={{ padding: isMobile ? '7px 10px' : '9px 12px', paddingBottom: `calc(${isMobile ? 7 : 9}px + env(safe-area-inset-bottom))`, borderTop: '1px solid var(--b0)', display: 'flex', gap: 7, alignItems: 'center', background: 'var(--s0)', flexShrink: 0 }}>
                <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handlePhoto} />

                {!recording && (
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} title="Photo"
                    style={{ flexShrink: 0, width: 38, height: 38, borderRadius: '50%', border: '1px solid var(--b1)', background: 'var(--s1)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--t2)', WebkitTapHighlightColor: 'transparent' } as React.CSSProperties}>
                    <IconCamera />
                  </button>
                )}

                {recording ? (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: 'var(--rdBg)', border: `1px solid ${isCancelActive ? 'var(--rd)' : 'var(--rdBd)'}`, borderRadius: 24, padding: '0 14px', minHeight: 38, transition: 'border-color .15s', overflow: 'hidden' }}>
                    <span style={{ fontSize: 12, fontWeight: isCancelActive ? 700 : 400, color: isCancelActive ? 'var(--rd)' : 'var(--t3)', whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: cancelProgress > 0.1 ? 110 : 0, opacity: cancelProgress, transitionProperty: 'max-width, opacity, color', transition: 'max-width .15s, opacity .15s, color .15s', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {isCancelActive ? <><X size={11} /> Annuler</> : <><ArrowLeft size={11} /> Glisser</>}
                    </span>
                    <span style={{ flex: 1 }} />
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--rd)', display: 'inline-block', flexShrink: 0, animation: 'pulse 1s infinite' }} />
                    <span style={{ fontSize: 13, color: 'var(--rdTx)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', letterSpacing: '.03em', flexShrink: 0 }}>{fmtSecs(recordingSecs)}</span>
                  </div>
                ) : (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', background: 'var(--s1)', border: '1px solid var(--b1)', borderRadius: 24, padding: '0 14px', minHeight: 38 }}>
                    <input value={text} onChange={e => setText(e.target.value)}
                      placeholder={uploading ? 'Envoi en cours…' : 'Message…'} disabled={uploading}
                      style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: 14, color: 'var(--t0)', padding: 0, width: '100%' }}
                      onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend(e as any))} />
                  </div>
                )}

                {text.trim() && !recording ? (
                  <button type="submit" disabled={send.isPending || uploading}
                    style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--bl)', border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, WebkitTapHighlightColor: 'transparent' } as React.CSSProperties}>
                    <IconSend />
                  </button>
                ) : audioSupported ? (
                  <button type="button"
                    onPointerDown={handleMicDown} onPointerMove={handleMicMove} onPointerUp={handleMicUp}
                    disabled={uploading}
                    title={recording ? 'Relâcher pour envoyer · Glisser ← pour annuler' : 'Maintenir pour enregistrer'}
                    style={{
                      width: 40, height: 40, borderRadius: '50%',
                      background: recording ? (isCancelActive ? 'var(--s2)' : 'var(--rd)') : 'var(--s2)',
                      border: recording ? 'none' : '1px solid var(--b1)',
                      color: recording ? '#fff' : 'var(--t2)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', flexShrink: 0,
                      transform: recording ? `scale(${1.15 - cancelProgress * 0.35})` : 'scale(1)',
                      transition: 'background .15s, transform .1s',
                      touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none', WebkitTapHighlightColor: 'transparent',
                    } as React.CSSProperties}>
                    <IconMic />
                  </button>
                ) : null}
              </form>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--t3)', gap: 12 }}>
              <MessageCircle size={44} style={{ opacity: 0.4 }} />
              <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--t2)' }}>Sélectionner une conversation</div>
              <div style={{ fontSize: 13 }}>Choisissez un contact pour commencer</div>
            </div>
          )}
        </div>
      </div>

      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}

      {pendingAudio && (
        <VoiceConfirmModal
          src={pendingAudio.url}
          onSend={sendPendingAudio}
          onCancel={() => { URL.revokeObjectURL(pendingAudio.url); setPendingAudio(null) }}
          uploading={uploading}
        />
      )}

      {contextMsg && (
        <DocSheet
          title="Message"
          subtitle={contextMsg.type === 'audio' ? 'Message vocal' : contextMsg.type === 'photo' ? 'Photo' : contextMsg.contenu?.slice(0, 55)}
          onClose={() => setContextMsg(null)}>
          <SheetRow icon={<Trash2 size={16} />} label="Supprimer le message" sublabel="Cette action est irréversible" danger
            onClick={() => { setDeleteTarget(contextMsg); setContextMsg(null) }} />
        </DocSheet>
      )}

      {deleteTarget && (
        <ConfirmModal
          message="Supprimer ce message définitivement ?"
          confirmLabel="Supprimer"
          onConfirm={handleDeleteMsg}
          onCancel={() => setDeleteTarget(null)}
          loading={deleteMutation.isPending}
        />
      )}
    </div>
  )
}
