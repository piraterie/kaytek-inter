// src/pages/MessagingPage.tsx
import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useMessages, useSendMessage, useConversations, useIsMobile } from '@/lib/hooks'
import { useAuthStore, useToastStore } from '@/lib/store'
import { uploadChatMedia } from '@/lib/supabase/storage'
import { Lightbox } from '@/components/Lightbox'
import type { Profile } from '@/types'

function getBestAudioMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/mpeg']
  return types.find(t => MediaRecorder.isTypeSupported(t)) ?? ''
}

function formatLastMsg(msg: any): string {
  if (!msg) return ''
  if (msg.type === 'audio' || msg.type === 'vocal') return '🎤 Message vocal'
  if (msg.type === 'photo') return '📷 Photo'
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
  const [cancelProgress, setCancelProgress] = useState(0) // 0→1 swipe-left cancel
  const [uploading, setUploading] = useState(false)
  const [showList, setShowList] = useState(!userId)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null)
  const [showScrollDown, setShowScrollDown] = useState(false)
  const msgsRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isFirstLoad = useRef(true)
  const isAtBottom = useRef(true)
  const isCancelling = useRef(false)
  const recordStartX = useRef(0)
  const isMobile = useIsMobile()
  const isAdmin = user?.role === 'admin'

  const { data: conversations = [] } = useConversations()
  const activeId = userId || selected?.id || ''
  const { data: messages = [] } = useMessages(activeId)
  const send = useSendMessage()

  // Auto-sélectionner le premier contact disponible
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
      if (c) {
        setSelected(c)
        setShowList(false)
      } else if (!isAdmin) {
        nav('/messagerie', { replace: true })
      }
    }
  }, [userId, conversations, isAdmin, nav])

  // Réinitialiser l'état quand on change de conversation
  useEffect(() => {
    setFirstUnreadId(null)
    isFirstLoad.current = true
    isAtBottom.current = true
    setShowScrollDown(false)
  }, [activeId])

  // Premier chargement → scroll en bas (dernier message), nouveaux messages → scroll si déjà en bas
  useEffect(() => {
    if (!messages.length) return
    if (isFirstLoad.current) {
      isFirstLoad.current = false
      const firstUnread = (messages as any[]).find(m => m.destinataire_id === user?.id && !m.lu)
      if (firstUnread) setFirstUnreadId(firstUnread.id)
      // Toujours ouvrir sur le dernier message
      requestAnimationFrame(() => {
        if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight
      })
    } else {
      // Nouveau message temps réel → scroll si déjà en bas
      if (isAtBottom.current && msgsRef.current) {
        msgsRef.current.scrollTop = msgsRef.current.scrollHeight
      }
    }
  }, [messages, user?.id])

  // Pré-remplir depuis l'état de navigation (intervention → messagerie)
  useEffect(() => {
    const prefilled = (location.state as any)?.prefilledText
    if (prefilled) {
      setText(prefilled)
      window.history.replaceState({}, '')
    }
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
    setSelected(c)
    setShowList(false)
    nav(`/messagerie/${c.id}`)
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

  // ── Enregistrement vocal WhatsApp-style ──────────────────────────────
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
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        setRecording(false); setRecordingSecs(0)
        if (timerRef.current) clearInterval(timerRef.current)
        if (isCancelling.current || !chunksRef.current.length || !activeId) return
        setUploading(true)
        const blob = new Blob(chunksRef.current, mimeType ? { type: mimeType } : {})
        const { url, path, error } = await uploadChatMedia(blob, 'audio', user!.id)
        if (error) { add('Erreur upload audio: ' + error, 'error'); setUploading(false); return }
        try { await send.mutateAsync({ destinataire_id: activeId, contenu: url || path, type: 'audio', media_url: path || url }) }
        catch (err: any) { add('Erreur envoi vocal: ' + err.message, 'error') }
        setUploading(false)
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

  // Pointer events — capture le pointer pour recevoir move/up partout
  function handleMicDown(e: React.PointerEvent<HTMLButtonElement>) {
    e.preventDefault()
    if (uploading || recording) return
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
    recordStartX.current = e.clientX
    isCancelling.current = false
    setCancelProgress(0)
    startRecording()
  }

  function handleMicMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!recording) return
    const dx = e.clientX - recordStartX.current
    if (dx < 0) {
      const progress = Math.min(1, -dx / 80)
      setCancelProgress(progress)
      isCancelling.current = dx < -80
    } else {
      setCancelProgress(0)
      isCancelling.current = false
    }
  }

  function handleMicUp(e: React.PointerEvent<HTMLButtonElement>) {
    if (!recording) return
    stopRecording(isCancelling.current)
  }
  // ─────────────────────────────────────────────────────────────────────

  function fmtSecs(s: number) { return `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}` }
  function isAudioUrl(url: string) { return url.includes('/audio-') || /\.(webm|mp3|ogg|opus|wav|m4a)(\?|$)/i.test(url) }

  function renderMessage(contenu: string, type: string) {
    if (type === 'audio' || (type === 'photo' && isAudioUrl(contenu))) return (
      <audio src={contenu} controls style={{ maxWidth: '100%', width: 210, height: 36, display: 'block' }} />
    )
    if (type === 'photo') return (
      <img
        src={contenu}
        alt="photo"
        onClick={() => setLightboxSrc(contenu)}
        style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8, display: 'block', cursor: 'zoom-in', objectFit: 'cover', width: '100%' }}
      />
    )
    return <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 14, lineHeight: 1.45 }}>{contenu}</span>
  }

  const audioSupported = typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  const bubbleSent = 'var(--bl)'
  const bubbleReceived = 'var(--s0)'
  const isCancelActive = cancelProgress > 0.55

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100dvh - 52px)', marginTop: -16, marginLeft: -16, marginRight: -16 }}>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── LISTE CONVERSATIONS ── */}
        <div style={{
          width: isMobile ? '100%' : 280,
          minWidth: isMobile ? '100%' : 280,
          display: !isAdmin || (isMobile && !showList) ? 'none' : 'flex',
          flexDirection: 'column',
          background: 'var(--s0)',
          borderRight: '1px solid var(--b0)',
        }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--b0)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--t0)', letterSpacing: '-.02em' }}>Messages</span>
            <span style={{ fontSize: 12, color: 'var(--t3)', background: 'var(--s2)', padding: '2px 8px', borderRadius: 20 }}>
              {conversations.length} contact{conversations.length > 1 ? 's' : ''}
            </span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'none' }}>
            {conversations.length === 0 && (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>💬</div>
                Aucun contact disponible
              </div>
            )}
            {conversations.map(c => {
              const active = activeId === c.id
              const hasUnread = (c as any).unreadCount > 0
              const unreadCount = (c as any).unreadCount || 0
              const lastMsg = (c as any).lastMessage
              const displayName = (c.prenom || c.nom) ? `${c.prenom ?? ''} ${c.nom ?? ''}`.trim() : c.email

              return (
                <div
                  key={c.id}
                  onClick={() => selectConversation(c)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                    cursor: 'pointer', borderBottom: '1px solid var(--b0)',
                    background: active ? 'var(--blBg)' : 'transparent',
                    transition: 'background .12s',
                    minHeight: 68,
                    WebkitTapHighlightColor: 'transparent',
                  }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'var(--s1)' }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
                >
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <div className={`avatar ${c.role === 'admin' ? 'purple' : ''}`} style={{ width: 46, height: 46, fontSize: 15 }}>
                      {(c.prenom?.[0] || c.email?.[0] || '?').toUpperCase()}
                      {(c.nom?.[0] || '').toUpperCase()}
                    </div>
                    {unreadCount > 0 && (
                      <div style={{
                        position: 'absolute', top: -3, right: -3,
                        minWidth: 18, height: 18,
                        background: '#dc2626', color: '#fff',
                        borderRadius: 9, border: '2px solid var(--s0)',
                        fontSize: 10, fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: '0 3px',
                      }}>
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </div>
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginBottom: 2 }}>
                      <span style={{
                        fontSize: 14, fontWeight: hasUnread ? 700 : 500,
                        color: active ? 'var(--blTx)' : 'var(--t0)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                      }}>
                        {displayName}
                      </span>
                      {lastMsg && (
                        <span style={{ fontSize: 11, color: hasUnread ? 'var(--rd)' : 'var(--t3)', flexShrink: 0, fontWeight: hasUnread ? 600 : 400 }}>
                          {formatMsgTime(lastMsg.created_at)}
                        </span>
                      )}
                    </div>
                    <div style={{
                      fontSize: 12,
                      color: hasUnread ? 'var(--t1)' : 'var(--t3)',
                      fontWeight: hasUnread ? 500 : 400,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {lastMsg
                        ? (lastMsg.expediteur_id === user?.id ? 'Vous : ' : '') + formatLastMsg(lastMsg)
                        : (c.role === 'admin' ? 'Administrateur' : 'Intervenant')}
                    </div>
                  </div>

                  {active && !hasUnread && (
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--bl)', flexShrink: 0 }} />
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* ── ZONE CHAT ── */}
        <div style={{ flex: 1, display: isAdmin && isMobile && showList ? 'none' : 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--bg)' }}>
          {selected ? (
            <>
              {/* Header chat */}
              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--b0)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--s0)', flexShrink: 0, minHeight: 52 }}>
                {isAdmin && isMobile && (
                  <button onClick={() => setShowList(true)} className="btn-icon" style={{ flexShrink: 0 }}>←</button>
                )}
                <div className="avatar" style={{ width: 34, height: 34, fontSize: 11, flexShrink: 0 }}>
                  {(selected.prenom?.[0] || selected.email?.[0] || '?').toUpperCase()}
                  {(selected.nom?.[0] || '').toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {(selected.prenom || selected.nom) ? `${selected.prenom ?? ''} ${selected.nom ?? ''}`.trim() : selected.email}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--t3)' }}>{selected.role === 'admin' ? 'Administrateur' : 'Intervenant'}</div>
                </div>
                {uploading && <span style={{ fontSize: 11, color: 'var(--t3)', flexShrink: 0 }}>Envoi…</span>}
              </div>

              {/* ── Zone messages ── */}
              <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
                <div
                  ref={msgsRef}
                  onScroll={handleScroll}
                  style={{ height: '100%', overflowY: 'auto', padding: isMobile ? '10px 8px' : '14px 12px', display: 'flex', flexDirection: 'column', gap: 2, scrollbarWidth: 'none' }}
                >
                  {messages.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 40, color: 'var(--t3)', fontSize: 13 }}>
                      <div style={{ fontSize: 36, marginBottom: 10 }}>👋</div>
                      Commencez la conversation
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

                    return (
                      <div key={m.id} style={{ display: 'contents' }}>
                        {/* Séparateur "Nouveaux messages" */}
                        {isFirstUnread && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px', flexShrink: 0 }}>
                            <div style={{ flex: 1, height: 1, background: 'var(--blBd)' }} />
                            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--blTx)', background: 'var(--blBg)', padding: '3px 12px', borderRadius: 20, border: '1px solid var(--blBd)', whiteSpace: 'nowrap' }}>
                              ✉ Nouveaux messages
                            </span>
                            <div style={{ flex: 1, height: 1, background: 'var(--blBd)' }} />
                          </div>
                        )}

                        {/* Bulle */}
                        <div
                          id={`msg-${m.id}`}
                          style={{
                            display: 'flex', gap: 6, alignItems: 'flex-end',
                            flexDirection: isMe ? 'row-reverse' : 'row',
                            marginTop: showAvatar ? 8 : 1,
                            marginBottom: isLastInGroup ? 2 : 0,
                          }}
                        >
                          {/* Avatar (messages reçus) */}
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
                              padding: isPhoto ? 3 : isAudio ? '7px 11px' : '8px 12px',
                              borderRadius: isMe
                                ? (showAvatar ? '16px 4px 16px 16px' : '16px 4px 16px 16px')
                                : (showAvatar ? '4px 16px 16px 16px' : '4px 16px 16px 16px'),
                              background: isMe ? bubbleSent : bubbleReceived,
                              color: isMe ? '#fff' : 'var(--t0)',
                              border: isMe ? 'none' : '1px solid var(--b1)',
                              boxShadow: '0 1px 2px rgba(0,0,0,.07)',
                              wordBreak: 'break-word', maxWidth: '100%',
                            }}>
                              {renderMessage(m.contenu, m.type)}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 2, paddingLeft: 4, paddingRight: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
                              <span>{new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                              {isMe && <span style={{ color: 'var(--bl)' }}>✓✓</span>}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Bouton flottant "↓ Nouveau message" */}
                {showScrollDown && (
                  <button
                    onClick={scrollToBottom}
                    style={{
                      position: 'absolute', bottom: 12, right: 12,
                      background: 'var(--bl)', border: 'none',
                      borderRadius: 20, padding: '7px 14px',
                      fontSize: 12, fontWeight: 600, color: '#fff',
                      cursor: 'pointer',
                      boxShadow: '0 2px 10px rgba(37,99,235,.40)',
                      display: 'flex', alignItems: 'center', gap: 5,
                      zIndex: 10, whiteSpace: 'nowrap', fontFamily: 'inherit',
                    }}
                  >
                    ↓ Nouveau message
                  </button>
                )}
              </div>

              {/* ── Barre d'envoi ── */}
              <form
                onSubmit={handleSend}
                style={{
                  padding: isMobile ? '7px 10px' : '9px 12px',
                  paddingBottom: `calc(${isMobile ? 7 : 9}px + env(safe-area-inset-bottom))`,
                  borderTop: '1px solid var(--b0)',
                  display: 'flex', gap: 7, alignItems: 'center',
                  background: 'var(--s0)', flexShrink: 0,
                }}
              >
                <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handlePhoto} />

                {/* Bouton photo (masqué pendant enregistrement) */}
                {!recording && (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    title="Photo"
                    style={{ flexShrink: 0, width: 38, height: 38, borderRadius: '50%', border: '1px solid var(--b1)', background: 'var(--s1)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 17, color: 'var(--t2)' }}
                  >
                    📷
                  </button>
                )}

                {/* Zone centrale : indicateur d'enregistrement OU input texte */}
                {recording ? (
                  <div style={{
                    flex: 1, display: 'flex', alignItems: 'center', gap: 8,
                    background: 'var(--rdBg)', border: `1px solid ${isCancelActive ? 'var(--rd)' : 'var(--rdBd)'}`,
                    borderRadius: 24, padding: '0 14px', minHeight: 38,
                    transition: 'border-color .15s',
                    overflow: 'hidden',
                  }}>
                    {/* Indication annulation */}
                    <span style={{
                      fontSize: 12, fontWeight: isCancelActive ? 700 : 400,
                      color: isCancelActive ? 'var(--rd)' : 'var(--t3)',
                      transition: 'color .15s, font-weight .15s',
                      whiteSpace: 'nowrap', overflow: 'hidden',
                      maxWidth: cancelProgress > 0.1 ? 120 : 0,
                      opacity: cancelProgress,
                      transitionProperty: 'max-width, opacity, color',
                    }}>
                      {isCancelActive ? '✕ Annuler' : '← Glisser'}
                    </span>
                    <span style={{ flex: 1 }} />
                    {/* Dot animé */}
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--rd)', display: 'inline-block', flexShrink: 0, animation: 'pulse 1s infinite' }} />
                    {/* Timer */}
                    <span style={{ fontSize: 13, color: 'var(--rdTx)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', letterSpacing: '.03em', flexShrink: 0 }}>
                      {fmtSecs(recordingSecs)}
                    </span>
                  </div>
                ) : (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', background: 'var(--s1)', border: '1px solid var(--b1)', borderRadius: 24, padding: '0 14px', minHeight: 38, transition: 'border-color .15s' }}>
                    <input
                      value={text}
                      onChange={e => setText(e.target.value)}
                      placeholder={uploading ? 'Envoi en cours…' : 'Message…'}
                      disabled={uploading}
                      style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: 14, color: 'var(--t0)', padding: 0, width: '100%' }}
                      onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend(e as any))}
                    />
                  </div>
                )}

                {/* Bouton droit : Envoyer (texte) ou Micro (maintenir = enregistrer) */}
                {text.trim() && !recording ? (
                  <button
                    type="submit"
                    disabled={send.isPending || uploading}
                    style={{
                      width: 40, height: 40, borderRadius: '50%',
                      background: 'var(--bl)', border: 'none', color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', fontSize: 17, flexShrink: 0,
                      transition: 'opacity .15s',
                    }}
                  >
                    ➤
                  </button>
                ) : audioSupported ? (
                  <button
                    type="button"
                    onPointerDown={handleMicDown}
                    onPointerMove={handleMicMove}
                    onPointerUp={handleMicUp}
                    disabled={uploading}
                    title={recording ? 'Relâcher pour envoyer · Glisser ← pour annuler' : 'Maintenir pour enregistrer'}
                    style={{
                      width: 40, height: 40, borderRadius: '50%',
                      background: recording
                        ? (isCancelActive ? 'var(--s2)' : 'var(--rd)')
                        : 'var(--s2)',
                      border: recording ? 'none' : '1px solid var(--b1)',
                      color: recording ? '#fff' : 'var(--t2)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', fontSize: 18, flexShrink: 0,
                      transition: 'background .15s, transform .1s',
                      transform: recording ? `scale(${1.15 - cancelProgress * 0.35})` : 'scale(1)',
                      touchAction: 'none',
                      userSelect: 'none', WebkitUserSelect: 'none',
                    }}
                  >
                    🎤
                  </button>
                ) : null}
              </form>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--t3)', gap: 12 }}>
              <div style={{ fontSize: 48 }}>💬</div>
              <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--t2)' }}>Sélectionner une conversation</div>
              <div style={{ fontSize: 13 }}>Choisissez un contact pour commencer</div>
            </div>
          )}
        </div>
      </div>

      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </div>
  )
}
