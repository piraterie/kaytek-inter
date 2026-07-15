// src/components/PartnerMessagesModal.tsx
// Wrapper modal autour de PartnerConversationPanel — utilisé depuis
// PartenairesPage. La messagerie intégrée dans MessagingPage utilise le
// panneau directement, sans ce wrapper (voir MessagingPage.tsx).
import PartnerConversationPanel from './PartnerConversationPanel'
import type { PartnerConnection } from '@/types'

export default function PartnerMessagesModal({ connection, onClose }: { connection: PartnerConnection; onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480, height: 560, display: 'flex', flexDirection: 'column', padding: 0 }} onClick={e => e.stopPropagation()}>
        <PartnerConversationPanel connection={connection} onClose={onClose} />
      </div>
    </div>
  )
}
