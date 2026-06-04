// src/pages/MessagingPage.tsx
import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useMessages, useSendMessage, useConversations } from '@/lib/hooks'
import { useAuthStore, useToastStore } from '@/lib/store'
import type { Profile } from '@/types'

export default function MessagingPage() {
  const { userId } = useParams<{userId:string}>()
  const nav = useNavigate()
  const { user } = useAuthStore()
  const { add } = useToastStore()
  const [text, setText] = useState('')
  const [selected, setSelected] = useState<Profile|null>(null)
  const msgsRef = useRef<HTMLDivElement>(null)

  const { data: conversations = [] } = useConversations()
  const activeId = userId || selected?.id || ''
  const { data: messages = [] } = useMessages(activeId)
  const send = useSendMessage()

  // Auto-select first on load
  useEffect(() => {
    if (!activeId && conversations.length) {
      const first = conversations[0]
      setSelected(first)
      nav(`/messagerie/${first.id}`, { replace: true })
    }
  }, [conversations, activeId, nav])

  // Select from URL
  useEffect(() => {
    if (userId && conversations.length) {
      const c = conversations.find(c => c.id === userId)
      if (c) setSelected(c)
    }
  }, [userId, conversations])

  // Scroll bas
  useEffect(() => {
    if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight
  }, [messages])

  function selectConv(c: Profile) {
    setSelected(c); nav(`/messagerie/${c.id}`)
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim() || !activeId) return
    const t = text; setText('')
    try { await send.mutateAsync({ destinataire_id: activeId, contenu: t }) }
    catch(err:any) { add(err.message,'error'); setText(t) }
  }

  return (
    <div>
      <div style={{ marginBottom:16 }}><h1 className="page-title">Messagerie</h1><p className="page-subtitle">Chat temps réel avec les intervenants</p></div>
      <div className="card" style={{ display:'flex',height:'calc(100dvh - 200px)',minHeight:400,overflow:'hidden' }}>
        {/* Liste conversations */}
        <div style={{ width:200,minWidth:200,borderRight:'1px solid var(--b0)',display:'flex',flexDirection:'column',background:'var(--s1)' }}>
          <div style={{ padding:'9px 12px',borderBottom:'1px solid var(--b0)',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',color:'var(--t2)' }}>Conversations</div>
          <div style={{ flex:1,overflowY:'auto',scrollbarWidth:'none' }}>
            {conversations.length===0&&<div style={{ padding:16,fontSize:12,color:'var(--t3)',textAlign:'center' }}>Aucun utilisateur</div>}
            {conversations.map(c=>{
              const active = activeId===c.id
              return (
                <div key={c.id} onClick={()=>selectConv(c)}
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
          {/* Header chat */}
          {selected ? (
            <>
              <div style={{ padding:'10px 14px',borderBottom:'1px solid var(--b0)',display:'flex',alignItems:'center',gap:9,background:'var(--s0)',flexShrink:0 }}>
                <div className="avatar" style={{ width:26,height:26,fontSize:9 }}>{(selected.prenom?.[0]||'')+(selected.nom?.[0]||'')}</div>
                <div>
                  <div style={{ fontSize:12,fontWeight:600,color:'var(--t0)' }}>{selected.prenom} {selected.nom}</div>
                  <div style={{ fontSize:10,color:'var(--gnTx)' }}>En ligne</div>
                </div>
              </div>
              {/* Messages */}
              <div ref={msgsRef} style={{ flex:1,overflowY:'auto',padding:'12px 14px',display:'flex',flexDirection:'column',gap:8,background:'var(--s1)',scrollbarWidth:'none' }}>
                {messages.length===0&&<div style={{ textAlign:'center',padding:32,color:'var(--t3)',fontSize:12 }}>Aucun message — commencez la conversation</div>}
                {messages.map(m=>{
                  const isMe = m.expediteur_id===user?.id
                  return (
                    <div key={m.id} style={{ display:'flex',gap:7,alignItems:'flex-end',flexDirection:isMe?'row-reverse':'row' }}>
                      {!isMe&&<div className="avatar" style={{ width:22,height:22,fontSize:8,flexShrink:0 }}>{(m.expediteur?.prenom?.[0]||'')+(m.expediteur?.nom?.[0]||'')}</div>}
                      <div>
                        <div style={{ fontSize:10,color:'var(--t2)',marginBottom:2,textAlign:isMe?'right':'left' }}>{new Date(m.created_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</div>
                        <div style={{ maxWidth:320,padding:'8px 12px',borderRadius:isMe?'10px 2px 10px 10px':'2px 10px 10px 10px',fontSize:12,lineHeight:1.5,background:isMe?'var(--bl)':'var(--s0)',color:isMe?'#fff':'var(--t0)',border:isMe?'none':'1px solid var(--b0)' }}>
                          {m.contenu}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              {/* Input */}
              <form onSubmit={handleSend} style={{ padding:'10px 12px',borderTop:'1px solid var(--b0)',display:'flex',gap:7,alignItems:'center',background:'var(--s0)',flexShrink:0 }}>
                <input value={text} onChange={e=>setText(e.target.value)} placeholder="Message…" style={{ flex:1,border:'1px solid var(--b1)',background:'var(--s1)',borderRadius:'var(--r)',padding:'7px 11px',fontSize:12,outline:'none',minHeight:'auto' }} onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&(e.preventDefault(),handleSend(e as any))} />
                <button type="submit" className="btn btn-primary btn-sm" disabled={!text.trim()||send.isPending}>✉</button>
              </form>
            </>
          ) : (
            <div style={{ flex:1,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--t3)',fontSize:13 }}>
              Sélectionner une conversation
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
