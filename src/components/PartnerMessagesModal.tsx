// src/components/PartnerMessagesModal.tsx
// Messagerie partenaire — Phase 2. Fil de discussion texte simple, lié à une
// connexion partenaire. Aucun partage de photo/audio (hors scope Phase 2).
import { useState, useRef, useEffect } from 'react'
import { X, Send, MessageCircle } from 'lucide-react'
import { usePartnerMessages, useSendPartnerMessage } from '@/lib/hooks/partners'
import { useAuthStore, useToastStore } from '@/lib/store'
import type { PartnerConnection } from '@/types'

export default function PartnerMessagesModal({ connection, onClose }: { connection: PartnerConnection; onClose: () => void }) {
  const { user } = useAuthStore()
  const { add } = useToastStore()
  const { data: messages = [], isLoading } = usePartnerMessages(connection.id)
  const send = useSendPartnerMessage()
  const [text, setText] = useState('')
  const msgsRef = useRef<HTMLDivElement>(null)
  const canSend = connection.status === 'accepted'
  const partnerName = connection.partner_profile?.nom_public || 'Partenaire'

  useEffect(() => {
    if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight
  }, [messages.length])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim() || !canSend) return
    const t = text; setText('')
    try { await send.mutateAsync({ connection_id: connection.id, contenu: t }) }
    catch (err: any) { add(err.message || 'Erreur lors de l\'envoi', 'error'); setText(t) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480, height: 560, display: 'flex', flexDirection: 'column', padding: 0 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header" style={{ flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div className="avatar" style={{ width: 32, height: 32, fontSize: 11, flexShrink: 0 }}>{partnerName.slice(0, 2)}</div>
            <div style={{ minWidth: 0 }}>
              <div className="modal-title" style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{partnerName}</div>
              <div style={{ fontSize: 11, color: 'var(--t3)' }}>{connection.partner_profile?.metier || 'Messagerie partenaire'}</div>
            </div>
          </div>
          <button className="btn-icon sm" onClick={onClose}><X size={15} /></button>
        </div>

        <div ref={msgsRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column' }}>
          {isLoading && <div style={{ textAlign: 'center', color: 'var(--t3)', padding: 20, fontSize: 13 }}>Chargement…</div>}
          {!isLoading && messages.length === 0 && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--t3)', gap: 10 }}>
              <MessageCircle size={32} style={{ opacity: 0.4 }} />
              <div style={{ fontSize: 13 }}>Aucun message. Démarrez la conversation.</div>
            </div>
          )}
          {messages.map((m, idx) => {
            const isMe = m.sender_organisation_id === user?.organisation_id
            const prev = messages[idx - 1]
            const showGap = !prev || prev.sender_organisation_id !== m.sender_organisation_id
            return (
              <div key={m.id} style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start', marginTop: showGap ? 10 : 2 }}>
                <div style={{ maxWidth: '78%', display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    padding: '8px 12px',
                    borderRadius: isMe ? '14px 4px 14px 14px' : '4px 14px 14px 14px',
                    background: isMe ? 'var(--bl)' : 'var(--s1)',
                    color: isMe ? '#fff' : 'var(--t0)',
                    border: isMe ? 'none' : '1px solid var(--b1)',
                    fontSize: 13.5, lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word'
                  }}>
                    {m.contenu}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 2, padding: '0 4px' }}>
                    {new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ flexShrink: 0, borderTop: '1px solid var(--b1)', padding: '10px 12px', paddingBottom: 'calc(10px + env(safe-area-inset-bottom))' }}>
          {canSend ? (
            <form onSubmit={handleSend} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', background: 'var(--s1)', border: '1px solid var(--b1)', borderRadius: 24, padding: '0 14px', minHeight: 38 }}>
                <input
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder="Message…"
                  style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: 14, color: 'var(--t0)', padding: 0, width: '100%' }}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e as any) } }}
                />
              </div>
              <button type="submit" disabled={!text.trim() || send.isPending}
                style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--bl)', border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, opacity: !text.trim() ? 0.5 : 1 }}>
                <Send size={15} />
              </button>
            </form>
          ) : (
            <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--t3)', padding: '8px 4px' }}>
              {connection.status === 'blocked' ? "Connexion bloquée — impossible d'envoyer un message."
                : connection.status === 'archived' ? "Connexion archivée — impossible d'envoyer un message."
                : connection.status === 'pending' ? 'Connexion en attente — acceptez-la pour discuter.'
                : "Connexion non active — impossible d'envoyer un message."}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
