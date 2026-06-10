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

// Aperçu texte du dernier message
function formatLastMsg(msg: any): string {
  if (!msg) return ''
  if (msg.type === 'audio' || msg.type === 'vocal') return '🎤 Message vocal'
  if (msg.type === 'photo') return '📷 Photo'
  const text = msg.contenu || ''
  return text.length > 52 ? text.slice(0, 52) + '…' : text
}

// Heure ou date courte du dernier message
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
  const [uploading, setUploading] = useState(false)
  const [showList, setShowList] = useState(!userId)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  // Suivi du premier message non lu pour le séparateur + scroll
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null)
  const msgsRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isFirstLoad = useRef(true)
  const isAtBottom = useRef(true)
  const [showScrollDown, setShowScrollDown] = useState(false)
  const [showScrollUp, setShowScrollUp] = useState(false)
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
    setShowScrollUp(false)
  }, [activeId])

  // À l'ouverture : scroll en haut (premier message visible)
  // Nouveau message : auto-scroll bas uniquement si déjà en bas
  useEffect(() => {
    if (!messages.length) return
    if (isFirstLoad.current) {
      isFirstLoad.current = false
      // Conserver le séparateur "Nouveaux messages" mais rester en haut
      const firstUnread = (messages as any[]).find(m => m.destinataire_id === user?.id && !m.lu)
      if (firstUnread) setFirstUnreadId(firstUnread.id)
      if (msgsRef.current) msgsRef.current.scrollTop = 0
    } else {
      // Nouveau message temps réel → scroll bas seulement si l'utilisateur est déjà en bas
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
    setShowScrollUp(scrollTop > 120)
  }

  function scrollToBottom() {
    msgsRef.current?.scrollTo({ top: msgsRef.current.scrollHeight, behavior: 'smooth' })
  }

  function scrollToTop() {
    msgsRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
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

  async function toggleRecording() {
    if (!window.isSecureContext) { add('Microphone indisponible : HTTPS requis', 'error'); return }
    if (!navigator.mediaDevices?.getUserMedia) { add('Microphone non disponible sur ce navigateur', 'warning'); return }
    if (recording) {
      mediaRef.current?.stop()
      if (timerRef.current) clearInterval(timerRef.current)
      return
    }
    const mimeType = getBestAudioMime()
    if (mimeType === null) { add('Enregistrement audio non supporté sur ce navigateur', 'warning'); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {})
      chunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        setRecording(false); setRecordingSecs(0)
        if (timerRef.current) clearInterval(timerRef.current)
        if (!chunksRef.current.length || !activeId) return
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

  function fmtSecs(s: number) { return `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}` }
  function isAudioUrl(url: string) { return url.includes('/audio-') || /\.(webm|mp3|ogg|opus|wav|m4a)(\?|$)/i.test(url) }

  function renderMessage(contenu: string, type: string) {
    if (type === 'audio' || (type === 'photo' && isAudioUrl(contenu))) return (
      <audio src={contenu} controls style={{ maxWidth: '100%', width: 220, height: 36, display: 'block' }} />
    )
    if (type === 'photo') return (
      <img src={contenu} alt="photo" onClick={() => setLightboxSrc(contenu)}
        style={{ maxWidth: '100%', maxHeight: 240, borderRadius: 10, display: 'block', cursor: 'zoom-in', objectFit: 'cover' }} />
    )
    return <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 14, lineHeight: 1.5 }}>{contenu}</span>
  }

  const audioSupported = typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  const bubbleSent = 'var(--bl)'
  const bubbleReceived = 'var(--s0)'

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
          {/* Header */}
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--b0)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--t0)', letterSpacing: '-.02em' }}>Messages</span>
            <span style={{ fontSize: 12, color: 'var(--t3)', background: 'var(--s2)', padding: '2px 8px', borderRadius: 20 }}>
              {conversations.length} contact{conversations.length > 1 ? 's' : ''}
            </span>
          </div>

          {/* Liste */}
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
                    display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
                    cursor: 'pointer', borderBottom: '1px solid var(--b0)',
                    background: active ? 'var(--blBg)' : 'transparent',
                    transition: 'background .12s',
                    minHeight: 72,
                  }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'var(--s1)' }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
                >
                  {/* Avatar + badge */}
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <div
                      className={`avatar ${c.role === 'admin' ? 'purple' : ''}`}
                      style={{ width: 46, height: 46, fontSize: 15 }}
                    >
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

                  {/* Nom + preview */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginBottom: 3 }}>
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

                  {/* Indicateur actif */}
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
              <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--b0)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--s0)', flexShrink: 0, minHeight: 56 }}>
                {isAdmin && isMobile && (
                  <button onClick={() => setShowList(true)} className="btn-icon" style={{ flexShrink: 0 }}>←</button>
                )}
                <div className="avatar" style={{ width: 36, height: 36, fontSize: 12, flexShrink: 0 }}>
                  {(selected.prenom?.[0] || selected.email?.[0] || '?').toUpperCase()}
                  {(selected.nom?.[0] || '').toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {(selected.prenom || selected.nom) ? `${selected.prenom ?? ''} ${selected.nom ?? ''}`.trim() : selected.email}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--t3)' }}>{selected.role === 'admin' ? 'Administrateur' : 'Intervenant'}</div>
                </div>
                {uploading && <span style={{ fontSize: 12, color: 'var(--t3)', flexShrink: 0 }}>Envoi…</span>}
              </div>

              {/* ── Messages ── */}
              <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
              <div
                ref={msgsRef}
                onScroll={handleScroll}
                style={{ height: '100%', overflowY: 'auto', padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 4, scrollbarWidth: 'none' }}
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
                  const showAvatar = !isMe && (!prevMsg || prevMsg.expediteur_id !== m.expediteur_id)
                  const isPhoto = m.type === 'photo'
                  const isAudio = m.type === 'audio'
                  const isFirstUnread = firstUnreadId === m.id

                  return (
                    <div key={m.id} style={{ display: 'contents' }}>
                      {/* Séparateur "Nouveaux messages" */}
                      {isFirstUnread && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 4px', flexShrink: 0 }}>
                          <div style={{ flex: 1, height: 1, background: 'var(--blBd)' }} />
                          <span style={{
                            fontSize: 11, fontWeight: 600, color: 'var(--blTx)',
                            background: 'var(--blBg)', padding: '4px 14px', borderRadius: 20,
                            border: '1px solid var(--blBd)', whiteSpace: 'nowrap', letterSpacing: '.01em',
                          }}>
                            ✉ Nouveaux messages
                          </span>
                          <div style={{ flex: 1, height: 1, background: 'var(--blBd)' }} />
                        </div>
                      )}

                      {/* Bulle de message */}
                      <div
                        id={`msg-${m.id}`}
                        className={isFirstUnread ? 'msg-first-unread' : ''}
                        style={{
                          display: 'flex', gap: 8, alignItems: 'flex-end',
                          flexDirection: isMe ? 'row-reverse' : 'row',
                          marginTop: showAvatar ? 10 : 2,
                        }}
                      >
                        {/* Avatar expéditeur (messages reçus seulement) */}
                        {!isMe && (
                          <div style={{ width: 28, flexShrink: 0 }}>
                            {showAvatar && (
                              <div className="avatar" style={{ width: 28, height: 28, fontSize: 9 }}>
                                {(m.expediteur?.prenom?.[0] || '') + (m.expediteur?.nom?.[0] || '')}
                              </div>
                            )}
                          </div>
                        )}
                        <div style={{ maxWidth: isMobile ? '78%' : '60%', display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
                          {/* Nom expéditeur au-dessus de la première bulle d'un groupe */}
                          {showAvatar && !isMe && (
                            <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 3, paddingLeft: 4, fontWeight: 500 }}>
                              {m.expediteur?.prenom || m.expediteur?.nom || ''}
                            </div>
                          )}
                          <div style={{
                            padding: isPhoto ? 4 : isAudio ? '8px 12px' : '9px 13px',
                            borderRadius: isMe ? '18px 4px 18px 18px' : '4px 18px 18px 18px',
                            background: isMe ? bubbleSent : bubbleReceived,
                            color: isMe ? '#fff' : 'var(--t0)',
                            border: isMe ? 'none' : '1px solid var(--b1)',
                            boxShadow: '0 1px 2px rgba(0,0,0,.08)',
                            wordBreak: 'break-word', maxWidth: '100%',
                          }}>
                            {renderMessage(m.contenu, m.type)}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 3, paddingLeft: 4, paddingRight: 4 }}>
                            {new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                            {isMe && <span style={{ marginLeft: 4, color: 'var(--bl)' }}>✓✓</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              {showScrollUp && (
                <button onClick={scrollToTop} style={{ position:'absolute', top:12, right:12, background:'var(--s0)', border:'1px solid var(--b1)', borderRadius:20, padding:'7px 14px', fontSize:12, fontWeight:600, color:'var(--t1)', cursor:'pointer', boxShadow:'0 2px 8px rgba(0,0,0,.14)', display:'flex', alignItems:'center', gap:5, zIndex:10, backdropFilter:'blur(8px)', WebkitBackdropFilter:'blur(8px)', whiteSpace:'nowrap', fontFamily:'inherit' }}>
                  ↑ Premier message
                </button>
              )}
              {showScrollDown && (
                <button onClick={scrollToBottom} style={{ position:'absolute', bottom:12, right:12, background:'var(--bl)', border:'none', borderRadius:20, padding:'7px 14px', fontSize:12, fontWeight:600, color:'#fff', cursor:'pointer', boxShadow:'0 2px 8px rgba(37,99,235,.35)', display:'flex', alignItems:'center', gap:5, zIndex:10, whiteSpace:'nowrap', fontFamily:'inherit' }}>
                  ↓ Derniers messages
                </button>
              )}
              </div>

              {/* ── Barre d'envoi ── */}
              <form onSubmit={handleSend} style={{ padding: '10px 12px', paddingBottom: 'calc(10px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--b0)', display: 'flex', gap: 8, alignItems: 'center', background: 'var(--s0)', flexShrink: 0 }}>
                <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handlePhoto} />

                <button type="button" className="btn-icon" title="Photo" onClick={() => fileRef.current?.click()} disabled={uploading || recording}
                  style={{ flexShrink: 0, fontSize: 18 }}>📷</button>

                {audioSupported && !recording && (
                  <button type="button" className="btn-icon" title="Message vocal" onClick={toggleRecording} disabled={uploading}
                    style={{ flexShrink: 0, fontSize: 18 }}>🎤</button>
                )}

                {recording && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, background: 'var(--rdBg)', border: '1px solid var(--rdBd)', borderRadius: 24, padding: '8px 14px' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--rd)', display: 'inline-block', animation: 'pulse 1s infinite' }} />
                    <span style={{ fontSize: 14, color: 'var(--rdTx)', fontWeight: 500 }}>{fmtSecs(recordingSecs)}</span>
                    <span style={{ fontSize: 12, color: 'var(--rdTx)', flex: 1 }}>Enregistrement…</span>
                    <button type="button" onClick={toggleRecording} style={{ background: 'var(--rd)', border: 'none', color: '#fff', borderRadius: 16, padding: '4px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
                      ⏹ Envoyer
                    </button>
                  </div>
                )}

                {!recording && (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', background: 'var(--s1)', border: '1px solid var(--b1)', borderRadius: 24, padding: '8px 16px', minHeight: 44, transition: 'border-color .15s' }}>
                    <input
                      value={text}
                      onChange={e => setText(e.target.value)}
                      placeholder={uploading ? 'Envoi en cours…' : 'Message…'}
                      disabled={uploading}
                      style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: 14, color: 'var(--t0)', minHeight: 'auto', padding: 0, width: '100%' }}
                      onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend(e as any))}
                    />
                  </div>
                )}

                {!recording && (
                  <button type="submit" disabled={!text.trim() || send.isPending || uploading}
                    style={{ width: 44, height: 44, borderRadius: '50%', background: text.trim() ? 'var(--bl)' : 'var(--s2)', border: 'none', color: text.trim() ? '#fff' : 'var(--t3)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: text.trim() ? 'pointer' : 'default', transition: 'background .15s', flexShrink: 0, fontSize: 18 }}>
                    ➤
                  </button>
                )}
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
