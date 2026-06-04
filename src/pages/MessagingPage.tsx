// src/pages/MessagingPage.tsx
import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useMessages, useSendMessage, useConversations } from '@/lib/hooks'
import { useAuthStore, useToastStore } from '@/lib/store'
import { uploadChatMedia } from '@/lib/supabase/storage'
import type { Profile } from '@/types'

export default function MessagingPage() {
  const { userId } = useParams<{userId:string}>()
  const nav = useNavigate()
  const { user } = useAuthStore()
  const { add } = useToastStore()
  const [text, setText] = useState('')
  const [selected, setSelected] = useState<Profile|null>(null)
  const [recording, setRecording] = useState(false)
  const [uploading, setUploading] = useState(false)
  const msgsRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const mediaRef = useRef<MediaRecorder|null>(null)
  const chunksRef = useRef<Blob[]>([])

  const { data: conversations = [] } = useConversations()
  const activeId = userId || selected?.id || ''
  const { data: messages = [] } = useMessages(activeId)
  const send = useSendMessage()

  useEffect(() => {
    if (!activeId && conversations.length) {
      const first = conversations[0]; setSelected(first); nav(`/messagerie/${first.id}`, { replace: true })
    }
  }, [conversations, activeId, nav])

  useEffect(() => {
    if (userId && conversations.length) { const c = conversations.find(c => c.id === userId); if (c) setSelected(c) }
  }, [userId, conversations])

  useEffect(() => {
    if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight
  }, [messages])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim() || !activeId) return
    const t = text; setText('')
    try { await send.mutateAsync({ destinataire_id: activeId, contenu: t }) }
    catch(err:any) { add(err.message,'error'); setText(t) }
  }

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file || !activeId) return
    setUploading(true)
    const { url, error } = await uploadChatMedia(file, 'photo', user!.id)
    if (error) { add('Erreur upload photo: ' + error, 'error'); setUploading(false); return }
    try { await send.mutateAsync({ destinataire_id: activeId, contenu: url, type: 'photo', media_url: url }) }
    catch(err:any) { add(err.message,'error') }
    setUploading(false); if (fileRef.current) fileRef.current.value = ''
  }

  async function toggleRecording() {
    if (recording) {
      mediaRef.current?.stop()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      chunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        setRecording(false)
        if (!chunksRef.current.length || !activeId) return
        setUploading(true)
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        const { url, error } = await uploadChatMedia(blob, 'audio', user!.id)
        if (error) { add('Erreur upload audio: ' + error, 'error'); setUploading(false); return }
        try { await send.mutateAsync({ destinataire_id: activeId, contenu: url, type: 'audio', media_url: url }) }
        catch(err:any) { add(err.message,'error') }
        setUploading(false)
      }
      mr.start(); mediaRef.current = mr; setRecording(true)
    } catch { add('Microphone non disponible', 'error') }
  }

  function renderMessage(contenu: string, type: string) {
    if (type === 'photo') return <img src={contenu} alt="photo" style={{ maxWidth:220, maxHeight:180, borderRadius:8, display:'block' }} />
    if (type === 'audio') return <audio src={contenu} controls style={{ maxWidth:220, height:36 }} />
    return <span style={{ whiteSpace:'pre-wrap', wordBreak:'break-word' }}>{contenu}</span>
  }

  return (
    <div>
      <div style={{ marginBottom:16 }}><h1 className="page-title">Messagerie</h1><p className="page-subtitle">Chat temps réel · photos · vocaux</p></div>
      <div className="card" style={{ display:'flex',height:'calc(100dvh - 200px)',minHeight:400,overflow:'hidden' }}>
        {/* Liste conversations */}
        <div style={{ width:200,minWidth:200,borderRight:'1px solid var(--b0)',display:'flex',flexDirection:'column',background:'var(--s1)' }}>
          <div style={{ padding:'9px 12px',borderBottom:'1px solid var(--b0)',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',color:'var(--t2)' }}>Conversations</div>
          <div style={{ flex:1,overflowY:'auto',scrollbarWidth:'none' }}>
            {conversations.length===0&&<div style={{ padding:16,fontSize:12,color:'var(--t3)',textAlign:'center' }}>Aucun utilisateur</div>}
            {conversations.map(c=>{
              const active = activeId===c.id
              return (
                <div key={c.id} onClick={()=>{ setSelected(c); nav(`/messagerie/${c.id}`) }}
                  style={{ display:'flex',alignItems:'center',gap:9,padding:'10px 12px',cursor:'pointer',borderBottom:'1px solid var(--b0)',background:active?'var(--blBg)':'transparent',borderRight:active?'2px solid var(--bl)':'none',transition:'background .12s' }}>
                  <div className={`avatar ${c.role==='admin'?'purple':''}`} style={{ width:30,height:30,fontSize:10 }}>{(c.prenom?.[0]||'')+(c.nom?.[0]||'')}</div>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ fontSize:12,fontWeight:600,color:'var(--t0)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis' }}>{c.prenom} {c.nom}</div>
                    <div style={{ fontSize:10,color:'var(--t2)' }}>{c.role}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        {/* Zone chat */}
        <div style={{ flex:1,display:'flex',flexDirection:'column',minWidth:0 }}>
          {selected ? (
            <>
              <div style={{ padding:'10px 14px',borderBottom:'1px solid var(--b0)',display:'flex',alignItems:'center',gap:9,background:'var(--s0)',flexShrink:0 }}>
                <div className="avatar" style={{ width:26,height:26,fontSize:9 }}>{(selected.prenom?.[0]||'')+(selected.nom?.[0]||'')}</div>
                <div>
                  <div style={{ fontSize:12,fontWeight:600,color:'var(--t0)' }}>{selected.prenom} {selected.nom}</div>
                  <div style={{ fontSize:10,color:'var(--gnTx)' }}>{selected.role}</div>
                </div>
                {uploading && <span style={{ marginLeft:'auto',fontSize:11,color:'var(--t2)' }}>Envoi…</span>}
              </div>
              <div ref={msgsRef} style={{ flex:1,overflowY:'auto',padding:'12px 14px',display:'flex',flexDirection:'column',gap:8,background:'var(--s1)',scrollbarWidth:'none' }}>
                {messages.length===0&&<div style={{ textAlign:'center',padding:32,color:'var(--t3)',fontSize:12 }}>Aucun message — commencez la conversation</div>}
                {messages.map(m=>{
                  const isMe = m.expediteur_id===user?.id
                  return (
                    <div key={m.id} style={{ display:'flex',gap:7,alignItems:'flex-end',flexDirection:isMe?'row-reverse':'row' }}>
                      {!isMe&&<div className="avatar" style={{ width:22,height:22,fontSize:8,flexShrink:0 }}>{(m.expediteur?.prenom?.[0]||'')+(m.expediteur?.nom?.[0]||'')}</div>}
                      <div>
                        <div style={{ fontSize:10,color:'var(--t2)',marginBottom:2,textAlign:isMe?'right':'left' }}>{new Date(m.created_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</div>
                        <div style={{ maxWidth:320,padding: m.type==='photo'?'4px':'8px 12px',borderRadius:isMe?'10px 2px 10px 10px':'2px 10px 10px 10px',fontSize:12,lineHeight:1.5,background:isMe?'var(--bl)':'var(--s0)',color:isMe?'#fff':'var(--t0)',border:isMe?'none':'1px solid var(--b0)' }}>
                          {renderMessage(m.contenu, m.type)}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              {/* Input */}
              <form onSubmit={handleSend} style={{ padding:'10px 12px',borderTop:'1px solid var(--b0)',display:'flex',gap:7,alignItems:'center',background:'var(--s0)',flexShrink:0 }}>
                <input ref={fileRef} type="file" accept="image/*" style={{ display:'none' }} onChange={handlePhoto} />
                <button type="button" className="btn-icon sm" title="Envoyer une photo" onClick={()=>fileRef.current?.click()} disabled={uploading}>📷</button>
                <button
                  type="button"
                  className="btn-icon sm"
                  title={recording ? 'Arrêter l\'enregistrement' : 'Message vocal'}
                  onClick={toggleRecording}
                  disabled={uploading}
                  style={{ color: recording ? 'var(--rdTx)' : undefined, background: recording ? 'var(--rdBg)' : undefined }}
                >
                  {recording ? '⏹' : '🎤'}
                </button>
                {recording && <span style={{ fontSize:11,color:'var(--rdTx)',animation:'pulse 1s infinite' }}>● Enregistrement…</span>}
                <input
                  value={text}
                  onChange={e=>setText(e.target.value)}
                  placeholder={recording ? 'Enregistrement en cours…' : 'Message…'}
                  disabled={recording || uploading}
                  style={{ flex:1,border:'1px solid var(--b1)',background:'var(--s1)',borderRadius:'var(--r)',padding:'7px 11px',fontSize:12,outline:'none',minHeight:'auto' }}
                  onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&(e.preventDefault(),handleSend(e as any))}
                />
                <button type="submit" className="btn btn-primary btn-sm" disabled={!text.trim()||send.isPending||recording||uploading}>✉</button>
              </form>
            </>
          ) : (
            <div style={{ flex:1,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--t3)',fontSize:13 }}>Sélectionner une conversation</div>
          )}
        </div>
      </div>
    </div>
  )
}
