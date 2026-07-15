// src/components/SendToPartnerModal.tsx
// Phase 3 v1 — envoi d'une demande d'intervention à un partenaire accepté.
// Ne transmet qu'un snapshot explicitement coché — jamais l'intervention
// réelle, jamais les données internes (notes_admin, client complet, etc.).
//
// Deux points d'entrée :
//  · depuis une intervention (InterventionDetailPage) : `intervention` fourni,
//    le partenaire reste à choisir.
//  · depuis un partenaire (PartenairesPage) : `presetConnectionId` fourni,
//    l'intervention reste à choisir dans la liste des interventions actives.
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, MapPin, Phone, User, FileText, Euro, Camera, Send, Wrench, Info, PlusCircle } from 'lucide-react'
import { usePartnerConnections, useSendPartnerInterventionRequest } from '@/lib/hooks/partners'
import { useInterventions } from '@/lib/hooks'
import { useToastStore } from '@/lib/store'
import type { Intervention } from '@/types'

export default function SendToPartnerModal({ intervention, presetConnectionId, onClose }: {
  intervention?: Intervention; presetConnectionId?: string; onClose: () => void
}) {
  const { add } = useToastStore()
  const nav = useNavigate()
  const { data: connections = [], isLoading: connectionsLoading } = usePartnerConnections()
  const accepted = useMemo(() => connections.filter(c => c.status === 'accepted'), [connections])
  const send = useSendPartnerInterventionRequest()

  const needsInterventionPicker = !intervention
  const { data: myInterventions = [], isLoading: interventionsLoading } = useInterventions({ statut: 'tous', showArchived: false })
  const [pickedInterventionId, setPickedInterventionId] = useState('')
  const pickedIntervention = needsInterventionPicker
    ? myInterventions.find(i => i.id === pickedInterventionId)
    : intervention
  const activeIntervention = pickedIntervention

  const [connectionId, setConnectionId] = useState<string>(presetConnectionId || '')
  const [shareAdresse, setShareAdresse] = useState(false)
  const [shareTelephone, setShareTelephone] = useState(false)
  const [shareNomClient, setShareNomClient] = useState(false)
  const [shareDescription, setShareDescription] = useState(false)
  const [shareMontant, setShareMontant] = useState(false)
  const [sharePhotos, setSharePhotos] = useState(false)
  const [consignes, setConsignes] = useState('')
  const [sending, setSending] = useState(false)

  const selectedConnection = accepted.find(c => c.id === connectionId)
  const clientNom = activeIntervention ? [activeIntervention.client?.prenom, activeIntervention.client?.nom].filter(Boolean).join(' ') : ''
  const adresseFull = activeIntervention ? [activeIntervention.adresse, activeIntervention.code_postal, activeIntervention.ville].filter(Boolean).join(' ') : ''
  const photoCount = activeIntervention?.photos?.length || 0

  async function handleSend() {
    if (!connectionId || !selectedConnection || !selectedConnection.partner_profile || !activeIntervention) return
    setSending(true)
    try {
      await send.mutateAsync({
        connection_id: connectionId,
        target_organisation_id: selectedConnection.partner_profile.organisation_id,
        source_intervention_id: activeIntervention.id,
        type_intervention: activeIntervention.type,
        urgence: activeIntervention.urgence,
        date_souhaitee: activeIntervention.date_prevue,
        ville: activeIntervention.ville,
        share_adresse: shareAdresse, adresse_partagee: adresseFull,
        share_telephone: shareTelephone, telephone_client_partage: activeIntervention.client?.telephone,
        share_nom_client: shareNomClient, nom_client_partage: clientNom,
        share_description: shareDescription, description_partagee: activeIntervention.description,
        share_montant: shareMontant, montant_partage: activeIntervention.montant_ttc,
        share_photos: sharePhotos, photos_partagees: activeIntervention.photos?.map(p => ({ id: p.id, type: p.type })),
        consignes_partagees: consignes.trim() || undefined
      })
      add('Demande envoyée au partenaire')
      onClose()
    } catch (err: any) { add(err.message || "Erreur lors de l'envoi", 'error') }
    setSending(false)
  }

  const presetPartnerName = presetConnectionId
    ? accepted.find(c => c.id === presetConnectionId)?.partner_profile?.nom_public
    : null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Envoyer à un partenaire</span>
          <button className="btn-icon sm" onClick={onClose}><X size={15} /></button>
        </div>
        <div className="modal-body">
          {connectionsLoading ? (
            <p style={{ fontSize: 13, color: 'var(--t2)', textAlign: 'center', padding: '16px 0' }}>Chargement…</p>
          ) : accepted.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <p style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 12 }}>
                Aucun partenaire accepté pour l'instant. Connectez-vous d'abord à une organisation partenaire.
              </p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => { onClose(); nav('/partenaires') }}>
                Aller sur Réseau partenaires
              </button>
            </div>
          ) : (
            <>
              {needsInterventionPicker ? (
                <div className="form-group">
                  <label>Intervention <span className="req">*</span></label>
                  {interventionsLoading ? (
                    <p style={{ fontSize: 12, color: 'var(--t3)' }}>Chargement des interventions…</p>
                  ) : myInterventions.length === 0 ? (
                    <div style={{ padding: '12px 14px', background: 'var(--amBg)', border: '1px solid var(--amBd)', borderRadius: 8 }}>
                      <p style={{ fontSize: 12, color: 'var(--amTx)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Info size={13} style={{ flexShrink: 0 }} /> Aucune intervention disponible à envoyer.
                      </p>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => { onClose(); nav('/interventions', { state: { openCreate: true } }) }}>
                        <PlusCircle size={13} /> Créer une intervention d'abord
                      </button>
                    </div>
                  ) : (
                    <select value={pickedInterventionId} onChange={e => setPickedInterventionId(e.target.value)}>
                      <option value="">— Choisir une intervention —</option>
                      {myInterventions.map(i => (
                        <option key={i.id} value={i.id}>
                          {i.numero} — {[i.client?.nom, i.client?.prenom].filter(Boolean).join(' ') || 'Sans client'} — {i.ville || i.adresse || 'Sans adresse'}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, padding: '8px 10px', background: 'var(--s1)', borderRadius: 8, fontSize: 12, color: 'var(--t2)' }}>
                  <Wrench size={13} /> {activeIntervention?.numero} — {[activeIntervention?.client?.nom, activeIntervention?.client?.prenom].filter(Boolean).join(' ')}
                </div>
              )}

              {presetConnectionId ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, padding: '8px 10px', background: 'var(--blBg)', border: '1px solid var(--blBd)', borderRadius: 8, fontSize: 13, color: 'var(--blTx)', fontWeight: 600 }}>
                  Vers : {presetPartnerName || 'Organisation partenaire'}
                </div>
              ) : (
                <div className="form-group">
                  <label>Partenaire <span className="req">*</span></label>
                  <select value={connectionId} onChange={e => setConnectionId(e.target.value)}>
                    <option value="">— Choisir un partenaire —</option>
                    {accepted.map(c => (
                      <option key={c.id} value={c.id}>{c.partner_profile?.nom_public || 'Organisation partenaire'}</option>
                    ))}
                  </select>
                </div>
              )}

              {activeIntervention && (
                <>
                  <div style={{ marginTop: 16, marginBottom: 6, fontSize: 12, fontWeight: 600, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                    Informations à partager
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 10 }}>
                    Toujours inclus : type de prestation, urgence, date souhaitée, ville. Le reste est optionnel.
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <ShareRow icon={<MapPin size={14} />} label="Adresse complète" value={adresseFull || '—'} checked={shareAdresse} onChange={setShareAdresse} />
                    <ShareRow icon={<Phone size={14} />} label="Téléphone client" value={activeIntervention.client?.telephone || '—'} checked={shareTelephone} onChange={setShareTelephone} disabled={!activeIntervention.client?.telephone} />
                    <ShareRow icon={<User size={14} />} label="Nom du client" value={clientNom || '—'} checked={shareNomClient} onChange={setShareNomClient} disabled={!clientNom} />
                    <ShareRow icon={<FileText size={14} />} label="Description" value={activeIntervention.description || '—'} checked={shareDescription} onChange={setShareDescription} disabled={!activeIntervention.description} />
                    <ShareRow icon={<Euro size={14} />} label="Montant" value={activeIntervention.montant_ttc ? `${activeIntervention.montant_ttc} €` : '—'} checked={shareMontant} onChange={setShareMontant} disabled={!activeIntervention.montant_ttc} />
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
                      <span>• Type : {activeIntervention.type || '—'} {activeIntervention.urgence ? '(urgent)' : ''}</span>
                      <span>• Ville : {activeIntervention.ville || '—'}</span>
                      <span>• Date souhaitée : {activeIntervention.date_prevue ? new Date(activeIntervention.date_prevue).toLocaleDateString('fr-FR') : '—'}</span>
                      {shareAdresse && <span>• Adresse : {adresseFull}</span>}
                      {shareTelephone && activeIntervention.client?.telephone && <span>• Téléphone : {activeIntervention.client.telephone}</span>}
                      {shareNomClient && clientNom && <span>• Client : {clientNom}</span>}
                      {shareDescription && activeIntervention.description && <span>• Description : {activeIntervention.description}</span>}
                      {shareMontant && activeIntervention.montant_ttc && <span>• Montant : {activeIntervention.montant_ttc} €</span>}
                      {sharePhotos && photoCount > 0 && <span>• {photoCount} photo{photoCount > 1 ? 's' : ''} (aperçu bientôt disponible)</span>}
                      {consignes.trim() && <span>• Consignes : {consignes.trim()}</span>}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
        {accepted.length > 0 && (!connectionId || !activeIntervention) && !(needsInterventionPicker && myInterventions.length === 0) && (
          <div style={{ padding: '0 22px 12px', fontSize: 12, color: 'var(--t3)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Info size={13} style={{ flexShrink: 0 }} />
            {!activeIntervention && !connectionId ? "Choisissez une intervention et un partenaire pour continuer."
              : !activeIntervention ? "Choisissez une intervention pour continuer."
              : "Choisissez un partenaire pour continuer."}
          </div>
        )}
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
          {accepted.length > 0 && (
            <button type="button" className="btn btn-primary" disabled={!connectionId || !activeIntervention || sending} onClick={handleSend}>
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
