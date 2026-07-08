// src/components/SendToPartnerModal.tsx
// Phase 3 v1 — envoi d'une demande d'intervention à un partenaire accepté.
// Ne transmet qu'un snapshot explicitement coché — jamais l'intervention
// réelle, jamais les données internes (notes_admin, client complet, etc.).
import { useState, useMemo } from 'react'
import { X, MapPin, Phone, User, FileText, Euro, Camera, Send } from 'lucide-react'
import { usePartnerConnections, useSendPartnerInterventionRequest } from '@/lib/hooks/partners'
import { useToastStore } from '@/lib/store'
import type { Intervention } from '@/types'

export default function SendToPartnerModal({ intervention, onClose }: { intervention: Intervention; onClose: () => void }) {
  const { add } = useToastStore()
  const { data: connections = [] } = usePartnerConnections()
  const accepted = useMemo(() => connections.filter(c => c.status === 'accepted'), [connections])
  const send = useSendPartnerInterventionRequest()

  const [connectionId, setConnectionId] = useState<string>('')
  const [shareAdresse, setShareAdresse] = useState(false)
  const [shareTelephone, setShareTelephone] = useState(false)
  const [shareNomClient, setShareNomClient] = useState(false)
  const [shareDescription, setShareDescription] = useState(false)
  const [shareMontant, setShareMontant] = useState(false)
  const [sharePhotos, setSharePhotos] = useState(false)
  const [consignes, setConsignes] = useState('')
  const [sending, setSending] = useState(false)

  const selected = accepted.find(c => c.id === connectionId)
  const clientNom = [intervention.client?.prenom, intervention.client?.nom].filter(Boolean).join(' ')
  const adresseFull = [intervention.adresse, intervention.code_postal, intervention.ville].filter(Boolean).join(' ')
  const photoCount = intervention.photos?.length || 0

  async function handleSend() {
    if (!connectionId || !selected || !selected.partner_profile) return
    setSending(true)
    try {
      await send.mutateAsync({
        connection_id: connectionId,
        target_organisation_id: selected.partner_profile.organisation_id,
        source_intervention_id: intervention.id,
        type_intervention: intervention.type,
        urgence: intervention.urgence,
        date_souhaitee: intervention.date_prevue,
        ville: intervention.ville,
        share_adresse: shareAdresse, adresse_partagee: adresseFull,
        share_telephone: shareTelephone, telephone_client_partage: intervention.client?.telephone,
        share_nom_client: shareNomClient, nom_client_partage: clientNom,
        share_description: shareDescription, description_partagee: intervention.description,
        share_montant: shareMontant, montant_partage: intervention.montant_ttc,
        share_photos: sharePhotos, photos_partagees: intervention.photos?.map(p => ({ id: p.id, type: p.type })),
        consignes_partagees: consignes.trim() || undefined
      })
      add('Demande envoyée au partenaire')
      onClose()
    } catch (err: any) { add(err.message || "Erreur lors de l'envoi", 'error') }
    setSending(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Envoyer à un partenaire</span>
          <button className="btn-icon sm" onClick={onClose}><X size={15} /></button>
        </div>
        <div className="modal-body">
          {accepted.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--t2)', textAlign: 'center', padding: '16px 0' }}>
              Aucun partenaire accepté pour l'instant. Rendez-vous dans Réseau partenaires pour en connecter un.
            </p>
          ) : (
            <>
              <div className="form-group">
                <label>Partenaire <span className="req">*</span></label>
                <select value={connectionId} onChange={e => setConnectionId(e.target.value)}>
                  <option value="">— Choisir un partenaire —</option>
                  {accepted.map(c => (
                    <option key={c.id} value={c.id}>{c.partner_profile?.nom_public || 'Organisation partenaire'}</option>
                  ))}
                </select>
              </div>

              <div style={{ marginTop: 16, marginBottom: 6, fontSize: 12, fontWeight: 600, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                Informations à partager
              </div>
              <p style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 10 }}>
                Toujours inclus : type de prestation, urgence, date souhaitée, ville. Le reste est optionnel.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <ShareRow icon={<MapPin size={14} />} label="Adresse complète" value={adresseFull || '—'} checked={shareAdresse} onChange={setShareAdresse} />
                <ShareRow icon={<Phone size={14} />} label="Téléphone client" value={intervention.client?.telephone || '—'} checked={shareTelephone} onChange={setShareTelephone} disabled={!intervention.client?.telephone} />
                <ShareRow icon={<User size={14} />} label="Nom du client" value={clientNom || '—'} checked={shareNomClient} onChange={setShareNomClient} disabled={!clientNom} />
                <ShareRow icon={<FileText size={14} />} label="Description" value={intervention.description || '—'} checked={shareDescription} onChange={setShareDescription} disabled={!intervention.description} />
                <ShareRow icon={<Euro size={14} />} label="Montant" value={intervention.montant_ttc ? `${intervention.montant_ttc} €` : '—'} checked={shareMontant} onChange={setShareMontant} disabled={!intervention.montant_ttc} />
                <ShareRow icon={<Camera size={14} />} label="Photos" value={photoCount > 0 ? `${photoCount} photo${photoCount > 1 ? 's' : ''}` : '—'} checked={sharePhotos} onChange={setSharePhotos} disabled={photoCount === 0} />
              </div>

              <div className="form-group" style={{ marginTop: 14 }}>
                <label>Consignes pour le partenaire</label>
                <textarea value={consignes} onChange={e => setConsignes(e.target.value)} rows={3} maxLength={500} placeholder="Ex : code d'accès, contraintes horaires…" />
              </div>

              {/* Aperçu */}
              <div style={{ marginTop: 16, padding: '12px 14px', background: 'var(--blBg)', border: '1px solid var(--blBd)', borderRadius: 8, fontSize: 12, color: 'var(--blTx)' }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Aperçu de ce qui sera envoyé</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span>• Type : {intervention.type || '—'} {intervention.urgence ? '(urgent)' : ''}</span>
                  <span>• Ville : {intervention.ville || '—'}</span>
                  <span>• Date souhaitée : {intervention.date_prevue ? new Date(intervention.date_prevue).toLocaleDateString('fr-FR') : '—'}</span>
                  {shareAdresse && <span>• Adresse : {adresseFull}</span>}
                  {shareTelephone && intervention.client?.telephone && <span>• Téléphone : {intervention.client.telephone}</span>}
                  {shareNomClient && clientNom && <span>• Client : {clientNom}</span>}
                  {shareDescription && intervention.description && <span>• Description : {intervention.description}</span>}
                  {shareMontant && intervention.montant_ttc && <span>• Montant : {intervention.montant_ttc} €</span>}
                  {sharePhotos && photoCount > 0 && <span>• {photoCount} photo{photoCount > 1 ? 's' : ''} (aperçu bientôt disponible)</span>}
                  {consignes.trim() && <span>• Consignes : {consignes.trim()}</span>}
                </div>
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
          {accepted.length > 0 && (
            <button type="button" className="btn btn-primary" disabled={!connectionId || sending} onClick={handleSend}>
              {sending ? 'Envoi…' : <><Send size={14} /> Confirmer l'envoi</>}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ShareRow({ icon, label, value, checked, onChange, disabled }: {
  icon: React.ReactNode; label: string; value: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--b1)', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
      <input type="checkbox" checked={checked && !disabled} disabled={disabled} onChange={e => onChange(e.target.checked)} style={{ width: 16, height: 16, flexShrink: 0 }} />
      <span style={{ color: 'var(--t3)', display: 'flex', flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--t0)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--t3)', marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{value}</span>
    </label>
  )
}
