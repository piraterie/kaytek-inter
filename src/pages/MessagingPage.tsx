// src/pages/MessagingPage.tsx
import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
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

export default function MessagingPage() {
  const { userId } = useParams<{ userId: string }>()
  const nav = useNavigate()
  const { user } = useAuthStore()
  const { add } = useToastStore()
  const [text, setText] = useState('')
  const [selected, setSelected] = useState<Profile | null>(null)
  const [recording, setRecording] = useState(false)
  const [recordingSecs, setRecordingSecs] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [showList, setShowList] = useState(!userId)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const msgsRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isMobile = useIsMobile()
  const isAdmin = user?.role === 'admin'

  const { data: conversations = [] } = useConversations()
  const activeId = userId || selected?.id || ''
  const { data: messages = [] } = useMessages(activeId)
  const send = useSendMessage()

  // Auto-sélectionner le premier contact disponible
  // Pour les non-admins : toujours auto-naviguer (un seul contact : l'admin)
  // Pour les admins sur desktop : auto-naviguer ; sur mobile : afficher la liste
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
        // L'intervenant tente d'accéder à une conversation interdite → redirection
        nav('/messagerie', { replace: true })
      }
    }
  }, [userId, conversations, isAdmin, nav])

  useEffect(() => {
    if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight
  }, [messages])

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
    const stored = path || url
    try { await send.mutateAsync({ destinataire_id: activeId, contenu: stored, type: 'photo', media_url: stored }) }
    catch (err: any) { add(err.message, 'error') }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function toggleRecording() {
    if (!navigator.mediaDevices?.getUserMedia) { add('Microphone non disponible', 'warning'); return }

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
        setRecording(false)
        setRecordingSecs(0)
        if (timerRef.current) clearInterval(timerRef.current)
        if (!chunksRef.current.length || !activeId) return
        setUploading(true)
        const blob = new Blob(chunksRef.current, mimeType ? { type: mimeType } : {})
        const { url, path, error } = await uploadChatMedia(blob, 'audio', user!.id)
        if (error) { add('Erreur upload audio: ' + error, 'error'); setUploading(false); return }
        const stored = path || url
        try {
          await send.mutateAsync({ destinataire_id: activeId, contenu: stored, type: 'audio', media_url: stored })
        } catch (err: any) { add('Erreur envoi vocal: ' + err.message, 'error') }
        setUploading(false)
      }
      mr.start()
      mediaRef.current = mr
      setRecording(true)
      setRecordingSecs(0)
      timerRef.current = setInterval(() => setRecordingSecs(s => s + 1), 1000)
    } catch { add('Microphone refusé — vérifiez les permissions', 'error') }
  }

  function fmtSecs(s: number) { return `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}` }

  function isAudioUrl(url: string) {
    return url.includes('/audio-') || /\.(webm|mp3|ogg|opus|wav|m4a)(\?|$)/i.test(url)
  }

  function renderMessage(contenu: string, type: string) {
    // Détection audio : par type OU par URL (fallback photo stocké comme audio)
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

  // Couleurs bulles
  const bubbleSent = 'var(--bl)'
  const bubbleReceived = 'var(--s0)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100dvh - 52px)', marginTop: -16, marginLeft: -16, marginRight: -16 }}>

      {/* Layout split : liste gauche + chat droite */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* LISTE CONVERSATIONS — visible uniquement pour l'admin */}
        <div style={{
          width: isMobile ? '100%' : 260,
          minWidth: isMobile ? '100%' : 260,
          display: !isAdmin || (isMobile && !showList) ? 'none' : 'flex',
          flexDirection: 'column',
          background: 'var(--s0)',
          borderRight: '1px solid var(--b0)',
        }}>
          {/* Header liste */}
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--b0)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--s0)' }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--t0)' }}>Messages</span>
            <span style={{ fontSize: 12, color: 'var(--t3)' }}>{conversations.length} contact{conversations.length > 1 ? 's' : ''}</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'none' }}>
            {conversations.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>Aucun contact disponible</div>
            )}
            {conversations.map(c => {
              const active = activeId === c.id
              return (
                <div key={c.id} onClick={() => selectConversation(c)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--b0)', background: active ? 'var(--blBg)' : 'transparent', transition: 'background .12s', minHeight: 64 }}>
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <div className={`avatar ${c.role === 'admin' ? 'purple' : ''}`} style={{ width: 42, height: 42, fontSize: 14 }}>
                      {(c.prenom?.[0] || c.email?.[0] || '?').toUpperCase()}
                      {(c.nom?.[0] || '').toUpperCase()}
                    </div>
                    <div style={{ position: 'absolute', bottom: 1, right: 1, width: 10, height: 10, borderRadius: '50%', background: '#22c55e', border: '1.5px solid var(--s0)' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: active ? 'var(--blTx)' : 'var(--t0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {(c.prenom || c.nom) ? `${c.prenom ?? ''} ${c.nom ?? ''}`.trim() : c.email}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 1 }}>{c.role === 'admin' ? 'Administrateur' : 'Intervenant'}</div>
                  </div>
                  {active && <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--bl)', flexShrink: 0 }} />}
                </div>
              )
            })}
          </div>
        </div>

        {/* ZONE CHAT */}
        <div style={{ flex: 1, display: isAdmin && isMobile && showList ? 'none' : 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--bg)' }}>
          {selected ? (
            <>
              {/* Header chat */}
              <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--b0)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--s0)', flexShrink: 0, minHeight: 56 }}>
                {isAdmin && isMobile && (
                  <button onClick={() => setShowList(true)} className="btn-icon" style={{ flexShrink: 0 }}>←</button>
                )}
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <div className="avatar" style={{ width: 36, height: 36, fontSize: 12 }}>
                    {(selected.prenom?.[0] || selected.email?.[0] || '?').toUpperCase()}
                    {(selected.nom?.[0] || '').toUpperCase()}
                  </div>
                  <div style={{ position: 'absolute', bottom: 1, right: 1, width: 9, height: 9, borderRadius: '50%', background: '#22c55e', border: '1.5px solid var(--s0)' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {(selected.prenom || selected.nom) ? `${selected.prenom ?? ''} ${selected.nom ?? ''}`.trim() : selected.email}
                  </div>
                  <div style={{ fontSize: 11, color: '#22c55e' }}>En ligne</div>
                </div>
                {uploading && <span style={{ fontSize: 12, color: 'var(--t3)', flexShrink: 0 }}>Envoi…</span>}
              </div>

              {/* Messages */}
              <div ref={msgsRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 6, scrollbarWidth: 'none' }}>
                {messages.length === 0 && (
                  <div style={{ textAlign: 'center', padding: 32, color: 'var(--t3)', fontSize: 13 }}>
                    Commencez la conversation 👋
                  </div>
                )}
                {messages.map((m, idx) => {
                  const isMe = m.expediteur_id === user?.id
                  const prevMsg = messages[idx - 1]
                  const showAvatar = !isMe && (!prevMsg || prevMsg.expediteur_id !== m.expediteur_id)
                  const isPhoto = m.type === 'photo'
                  const isAudio = m.type === 'audio'

                  return (
                    <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexDirection: isMe ? 'row-reverse' : 'row', marginTop: showAvatar ? 8 : 0 }}>
                      {/* Avatar expéditeur (reçu seulement) */}
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
                        {/* Bulle */}
                        <div style={{
                          padding: isPhoto ? 4 : isAudio ? '8px 12px' : '9px 13px',
                          borderRadius: isMe ? '18px 4px 18px 18px' : '4px 18px 18px 18px',
                          background: isMe ? bubbleSent : bubbleReceived,
                          color: isMe ? '#fff' : 'var(--t0)',
                          border: isMe ? 'none' : '1px solid var(--b1)',
                          boxShadow: '0 1px 2px rgba(0,0,0,.08)',
                          wordBreak: 'break-word',
                          maxWidth: '100%',
                        }}>
                          {renderMessage(m.contenu, m.type)}
                        </div>
                        {/* Heure */}
                        <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 3, paddingLeft: 4, paddingRight: 4 }}>
                          {new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                          {isMe && <span style={{ marginLeft: 4, color: 'var(--bl)' }}>✓✓</span>}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Barre d'input */}
              <form onSubmit={handleSend} style={{ padding: '10px 12px', paddingBottom: 'calc(10px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--b0)', display: 'flex', gap: 8, alignItems: 'center', background: 'var(--s0)', flexShrink: 0 }}>
                <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handlePhoto} />

                {/* Bouton photo */}
                <button type="button" className="btn-icon" title="Photo" onClick={() => fileRef.current?.click()} disabled={uploading || recording}
                  style={{ flexShrink: 0, fontSize: 18 }}>📷</button>

                {/* Bouton vocal */}
                {audioSupported && !recording && (
                  <button type="button" className="btn-icon" title="Message vocal" onClick={toggleRecording} disabled={uploading}
                    style={{ flexShrink: 0, fontSize: 18 }}>🎤</button>
                )}

                {/* Indicateur d'enregistrement */}
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

                {/* Input texte */}
                {!recording && (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', background: 'var(--s1)', border: '1px solid var(--b1)', borderRadius: 24, padding: '8px 16px', minHeight: 44, transition: 'border-color .15s' }}>
                    <input value={text} onChange={e => setText(e.target.value)}
                      placeholder={uploading ? 'Envoi en cours…' : 'Message…'}
                      disabled={uploading}
                      style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: 14, color: 'var(--t0)', minHeight: 'auto', padding: 0, width: '100%' }}
                      onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend(e as any))} />
                  </div>
                )}

                {/* Bouton envoyer */}
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
              <div style={{ fontSize: 40 }}>💬</div>
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
