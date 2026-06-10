// src/pages/MessagingPage.tsx
import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useMessages, useSendMessage, useConversations } from '@/lib/hooks'
import { useAuthStore, useToastStore } from '@/lib/store'
import { supabase } from '@/lib/supabase/client'
import type { Profile } from '@/types'

async function uploadMedia(file: File, type: 'image' | 'video' | 'audio'): Promise<string> {
  const ext = file.name.split('.').pop() || type
  const path = `messages/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await supabase.storage.from('intervention-photos').upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw new Error(error.message)
  const { data } = await supabase.storage.from('intervention-photos').createSignedUrl(path, 3600 * 24 * 7)
  return data?.signedUrl || ''
}

export default function MessagingPage() {
  const { userId } = useParams<{ userId: string }>()
  const nav = useNavigate()
  const { user } = useAuthStore()
  const { add } = useToastStore()
  const [text, setText] = useState('')
  const [selected, setSelected] = useState<Profile | null>(null)
  const [uploading, setUploading] = useState(false)
  const [recording, setRecording] = useState(false)
  const msgsEnd = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLInputElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  const { data: convs = [] } = useConversations()
  const activeId = userId || selected?.id || ''
  const { data: messages = [] } = useMessages(activeId)
  const send = useSendMessage()

  useEffect(() => {
    if (!activeId && convs.length > 0) {
      const first = convs[0]
      setSelected(first)
      nav(`/messagerie/${first.id}`, { replace: true })
    }
  }, [convs, activeId])

  useEffect(() => {
    if (userId && convs.length > 0) {
      const c = convs.find(c => c.id === userId)
      if (c) setSelected(c)
    }
  }, [userId, convs])

  useEffect(() => {
    msgsEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function selectConv(c: Profile) { setSelected(c); nav(`/messagerie/${c.id}`) }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim() || !activeId) return
    const t = text; setText('')
    try { await send.mutateAsync({ destinataire_id: activeId, contenu: t, type: 'texte' }) }
    catch (err: any) { add(err.message, 'error'); setText(t) }
  }

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file || !activeId) return
    if (file.size > 10 * 1024 * 1024) { add('Max 10 MB', 'warning'); return }
    setUploading(true)
    try {
      const url = await uploadMedia(file, 'image')
      await send.mutateAsync({ destinataire_id: activeId, contenu: url, type: 'photo' })
      add('Photo envoyée')
    } catch (err: any) { add(err.message, 'error') }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleVideo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file || !activeId) return
    if (file.size > 50 * 1024 * 1024) { add('Max 50 MB pour la vidéo', 'warning'); return }
    setUploading(true)
    try {
      const url = await uploadMedia(file, 'video')
      await send.mutateAsync({ destinataire_id: activeId, contenu: url, type: 'texte' })
      add('Vidéo envoyée')
    } catch (err: any) { add(err.message, 'error') }
    setUploading(false)
    if (videoRef.current) videoRef.current.value = ''
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      mediaRecorderRef.current = mr
      audioChunksRef.current = []
      mr.ondataavailable = e => audioChunksRef.current.push(e.data)
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        if (!activeId) return
        setUploading(true)
        try {
          const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
          const file = new File([blob], `vocal-${Date.now()}.webm`, { type: 'audio/webm' })
          const url = await uploadMedia(file, 'audio')
          await send.mutateAsync({ destinataire_id: activeId, contenu: url, type: 'texte' })
          add('Vocal envoyé')
        } catch (err: any) { add(err.message, 'error') }
        setUploading(false)
        setRecording(false)
      }
      mr.start()
      setRecording(true)
    } catch { add('Micro non disponible', 'error') }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop()
  }

  function renderMessage(m: any) {
    const isMe = m.expediteur_id === user?.id
    const isPhoto = m.type === 'photo' || (m.contenu?.startsWith('http') && m.contenu?.match(/\.(jpg|jpeg|png|webp|gif)/i))
    const isVideo = m.contenu?.startsWith('http') && m.contenu?.match(/\.(mp4|webm|mov)/i)
    const isAudio = m.contenu?.startsWith('http') && m.contenu?.match(/\.(webm|mp3|m4a|ogg)/i) && !isVideo

    return (
      <div key={m.id} style={{ display:'flex', gap:7, alignItems:'flex-end', flexDirection:isMe?'row-reverse':'row', marginBottom:8 }}>
        {!isMe && (
          <div style={{ width:26, height:26, borderRadius:'50%', background:'#2563eb', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:9, fontWeight:700, flexShrink:0, textTransform:'uppercase' }}>
            {(m.expediteur?.prenom?.[0]||'')+(m.expediteur?.nom?.[0]||'')}
          </div>
        )}
        <div style={{ maxWidth:'72%' }}>
          <div style={{ fontSize:10, color:'var(--t3)', marginBottom:3, textAlign:isMe?'right':'left' }}>
            {new Date(m.created_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}
          </div>
          <div style={{
            padding: isPhoto||isVideo||isAudio ? '4px' : '10px 14px',
            borderRadius:isMe?'14px 4px 14px 14px':'4px 14px 14px 14px',
            background:isMe?'#2563eb':'var(--s0)',
            color:isMe?'#fff':'var(--t0)',
            border:isMe?'none':'1.5px solid var(--b0)',
            fontSize:14, lineHeight:1.5, wordBreak:'break-word'
          }}>
            {isPhoto && <img src={m.contenu} alt="photo" style={{ maxWidth:'100%', borderRadius:10, display:'block', maxHeight:200, objectFit:'cover' }} />}
            {isVideo && <video src={m.contenu} controls style={{ maxWidth:'100%', borderRadius:10, display:'block' }} />}
            {isAudio && <audio src={m.contenu} controls style={{ width:'100%' }} />}
            {!isPhoto && !isVideo && !isAudio && m.type === 'intervention' && (
              <span style={{ fontSize:12, opacity:.85 }}>🔧 {m.contenu}</span>
            )}
            {!isPhoto && !isVideo && !isAudio && m.type !== 'intervention' && m.contenu}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom:14 }}>
        <h1 className="page-title">Messagerie</h1>
        <p className="page-subtitle">Chat temps réel · Photos · Vidéos · Vocal</p>
      </div>
      <div className="card" style={{ display:'flex', height:'calc(100dvh - 170px)', minHeight:360, overflow:'hidden' }}>
        {/* Liste conversations */}
        <div style={{ width:200, minWidth:180, borderRight:'1px solid var(--b0)', display:'flex', flexDirection:'column', background:'var(--s1)', flexShrink:0 }}>
          <div style={{ padding:'10px 12px', borderBottom:'1px solid var(--b0)', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--t2)' }}>
            Conversations
          </div>
          <div style={{ flex:1, overflowY:'auto', scrollbarWidth:'none' }}>
            {convs.length === 0 && <div style={{ padding:16, fontSize:12, color:'var(--t3)', textAlign:'center' }}>Aucun contact</div>}
            {convs.map(c => {
              const active = activeId === c.id
              return (
                <div key={c.id} onClick={() => selectConv(c)} style={{
                  display:'flex', alignItems:'center', gap:9, padding:'12px 12px',
                  cursor:'pointer', borderBottom:'1px solid var(--b0)',
                  background:active?'var(--blBg)':'transparent',
                  borderLeft:active?'3px solid var(--bl)':'3px solid transparent',
                  transition:'all .12s'
                }}>
                  <div style={{ width:32, height:32, borderRadius:'50%', background:c.role==='admin'?'#5b21b6':'#2563eb', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:11, fontWeight:700, flexShrink:0, textTransform:'uppercase' }}>
                    {(c.prenom?.[0]||'')+(c.nom?.[0]||'')}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12, fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.prenom} {c.nom}</div>
                    <div style={{ fontSize:10, color:'var(--t2)' }}>{c.role}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Zone chat */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0 }}>
          {selected ? (
            <>
              {/* Header */}
              <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--b0)', display:'flex', alignItems:'center', gap:10, background:'var(--s0)', flexShrink:0 }}>
                <div style={{ width:30, height:30, borderRadius:'50%', background:selected.role==='admin'?'#5b21b6':'#2563eb', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:10, fontWeight:700, textTransform:'uppercase' }}>
                  {(selected.prenom?.[0]||'')+(selected.nom?.[0]||'')}
                </div>
                <div>
                  <div style={{ fontSize:13, fontWeight:600 }}>{selected.prenom} {selected.nom}</div>
                  <div style={{ fontSize:10, color:'var(--gnTx)' }}>● En ligne</div>
                </div>
              </div>
              {/* Messages */}
              <div style={{ flex:1, overflowY:'auto', padding:'14px 14px', background:'var(--s1)', scrollbarWidth:'thin', WebkitOverflowScrolling:'touch' }}>
                {messages.length === 0 && (
                  <div style={{ textAlign:'center', padding:40, color:'var(--t3)', fontSize:13 }}>
                    Démarrez la conversation
                  </div>
                )}
                {messages.map(renderMessage)}
                <div ref={msgsEnd} />
              </div>
              {/* Input zone */}
              <div style={{ padding:'10px 12px', borderTop:'1px solid var(--b0)', background:'var(--s0)', flexShrink:0 }}>
                {uploading && (
                  <div style={{ fontSize:11, color:'var(--blTx)', marginBottom:6, textAlign:'center' }}>
                    ⏳ Envoi en cours...
                  </div>
                )}
                <form onSubmit={handleSend} style={{ display:'flex', gap:7, alignItems:'flex-end' }}>
                  <input value={text} onChange={e => setText(e.target.value)} placeholder="Message..."
                    style={{ flex:1, fontSize:15, minHeight:'auto', borderRadius:22, padding:'10px 16px' }}
                    onKeyDown={e => { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSend(e as any)} }} />
                  {/* Photo */}
                  <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handlePhoto} style={{ display:'none' }} />
                  <button type="button" className="btn-icon" onClick={()=>fileRef.current?.click()} disabled={uploading} title="Photo" style={{ fontSize:19, borderRadius:'50%', border:'none', background:'var(--blBg)' }}>📷</button>
                  {/* Vidéo */}
                  <input ref={videoRef} type="file" accept="video/*" capture="environment" onChange={handleVideo} style={{ display:'none' }} />
                  <button type="button" className="btn-icon" onClick={()=>videoRef.current?.click()} disabled={uploading} title="Vidéo" style={{ fontSize:19, borderRadius:'50%', border:'none', background:'var(--gnBg)' }}>🎥</button>
                  {/* Vocal */}
                  <button type="button" className="btn-icon" onMouseDown={startRecording} onMouseUp={stopRecording} onTouchStart={startRecording} onTouchEnd={stopRecording}
                    disabled={uploading} title="Maintenir pour enregistrer"
                    style={{ fontSize:19, borderRadius:'50%', border:'none', background:recording?'var(--rdBg)':'var(--amBg)', transform:recording?'scale(1.2)':'scale(1)', transition:'all .15s' }}>
                    🎤
                  </button>
                  {/* Envoyer */}
                  <button type="submit" disabled={!text.trim()||send.isPending}
                    style={{ width:42, height:42, borderRadius:'50%', background:'#2563eb', border:'none', color:'#fff', fontSize:18, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    ➤
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--t3)', fontSize:14 }}>
              Sélectionner une conversation
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
