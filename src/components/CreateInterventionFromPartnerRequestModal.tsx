// src/components/CreateInterventionFromPartnerRequestModal.tsx
// Importe une demande d'intervention partenaire acceptée en intervention
// interne. N'utilise QUE le snapshot déjà présent dans
// partner_intervention_requests — jamais source_intervention_id pour lire
// quoi que ce soit, jamais les tables clients/interventions de l'organisation
// source (structurellement impossible : la RLS ne les expose pas).
import { useState, useEffect, useMemo } from 'react'
import { X, User, UserCheck, Sparkles, Check } from 'lucide-react'
import { useCreateClient, useCreateIntervention, useIntervenants } from '@/lib/hooks'
import { useLinkResultingIntervention, useFindClientByPhone } from '@/lib/hooks/partners'
import { useToastStore } from '@/lib/store'
import { CustomSelect } from '@/components/CustomSelect'
import type { PartnerInterventionRequest, Categorie } from '@/types'

const ACTIVITES: { value: Categorie; label: string }[] = [
  { value: 'serrurerie', label: 'Serrurerie' },
  { value: 'plomberie', label: 'Plomberie' },
  { value: 'electricite', label: 'Électricité' },
  { value: 'vitrerie', label: 'Vitrerie' },
  { value: 'chauffagiste', label: 'Chauffagiste' },
]

export default function CreateInterventionFromPartnerRequestModal({ request, onClose, onCreated }: {
  request: PartnerInterventionRequest; onClose: () => void; onCreated: (interventionId: string) => void
}) {
  const { add } = useToastStore()
  const createClient = useCreateClient()
  const createIntervention = useCreateIntervention()
  const linkResulting = useLinkResultingIntervention()
  const { data: intervenants = [] } = useIntervenants()
  const { data: existingClient, isLoading: searchingClient } = useFindClientByPhone(request.telephone_client_partage)

  const hasClientInfo = !!(request.nom_client_partage || request.telephone_client_partage || request.adresse_partagee)
  const [clientMode, setClientMode] = useState<'existing' | 'new' | 'none'>(hasClientInfo ? 'new' : 'none')

  const [initialNom, initialPrenom] = useMemo(() => {
    if (!request.nom_client_partage) return ['', '']
    const parts = request.nom_client_partage.trim().split(/\s+/)
    return parts.length > 1 ? [parts.slice(1).join(' '), parts[0]] : [parts[0] || '', '']
  }, [request.nom_client_partage])

  const [nom, setNom] = useState(initialNom)
  const [prenom, setPrenom] = useState(initialPrenom)
  const [telephone, setTelephone] = useState(request.telephone_client_partage || '')
  const [adresse, setAdresse] = useState(request.adresse_partagee || '')
  const [ville, setVille] = useState(request.ville || '')
  const [description, setDescription] = useState(
    [request.description_partagee, request.consignes_partagees].filter(Boolean).join('\n\n')
  )
  const [type, setType] = useState<Categorie | ''>((request.type_intervention as Categorie) || '')
  const [urgence, setUrgence] = useState(request.urgence)
  const [dateSouhaitee, setDateSouhaitee] = useState(
    request.date_souhaitee ? new Date(request.date_souhaitee).toISOString().slice(0, 16) : ''
  )
  const [intervenantId, setIntervenantId] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (existingClient && clientMode !== 'new') setClientMode('existing')
  }, [existingClient])

  async function handleCreate() {
    setCreating(true)
    try {
      let clientId: string | undefined
      if (clientMode === 'existing' && existingClient) {
        clientId = existingClient.id
      } else if (clientMode === 'new') {
        const client = await createClient.mutateAsync({
          type: 'particulier',
          nom: nom.trim() || 'Client partenaire',
          prenom: prenom.trim() || undefined,
          telephone: telephone.trim() || undefined,
          adresse_intervention: adresse.trim() || undefined,
          ville_intervention: ville.trim() || undefined,
        } as any)
        clientId = (client as any).id
      }

      const inter = await createIntervention.mutateAsync({
        client_id: clientId,
        type: (type || undefined) as any,
        urgence,
        adresse: adresse.trim() || undefined,
        ville: ville.trim() || undefined,
        description: description.trim() || undefined,
        date_prevue: dateSouhaitee ? new Date(dateSouhaitee).toISOString() : undefined,
        intervenant_id: intervenantId || undefined,
        statut: 'en_attente',
      } as any)

      const interventionId = (inter as any).id
      try {
        await linkResulting.mutateAsync({ id: request.id, resulting_intervention_id: interventionId })
      } catch (linkErr: any) {
        add(`Intervention créée mais non liée à la demande : ${linkErr.message}`, 'error')
        onCreated(interventionId)
        onClose()
        return
      }
      add('Intervention créée et liée à la demande partenaire')
      onCreated(interventionId)
      onClose()
    } catch (err: any) { add(err.message || 'Erreur lors de la création', 'error') }
    setCreating(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 540 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Créer une intervention</span>
          <button className="btn-icon sm" onClick={onClose}><X size={15} /></button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 16 }}>
            Pré-rempli à partir des informations partagées par le partenaire. Vérifiez et complétez avant de créer.
          </p>

          {/* ── Client ── */}
          <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 600, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Client</div>
          {searchingClient && <p style={{ fontSize: 12, color: 'var(--t3)' }}>Recherche d'un client existant…</p>}
          {!searchingClient && existingClient && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', marginBottom: 10, borderRadius: 8, border: `1px solid ${clientMode === 'existing' ? 'var(--blBd)' : 'var(--b1)'}`, background: clientMode === 'existing' ? 'var(--blBg)' : 'transparent' }}>
              <UserCheck size={16} color={clientMode === 'existing' ? 'var(--blTx)' : 'var(--t3)'} />
              <div style={{ flex: 1, fontSize: 13 }}>
                <div style={{ fontWeight: 600, color: 'var(--t0)' }}>{existingClient.nom} {existingClient.prenom}</div>
                <div style={{ fontSize: 11, color: 'var(--t3)' }}>Client existant trouvé — {existingClient.telephone}</div>
              </div>
              {clientMode === 'existing' ? (
                <span className="pill pill-blue" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Check size={11} /> Utilisé</span>
              ) : (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setClientMode('existing')}>Utiliser</button>
              )}
            </div>
          )}
          {clientMode !== 'existing' && (
            <>
              {existingClient && (
                <button type="button" className="btn btn-secondary btn-sm" style={{ marginBottom: 10 }} onClick={() => setClientMode('existing')}>
                  Utiliser {existingClient.nom} plutôt qu'un nouveau client
                </button>
              )}
              {clientMode === 'none' ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setClientMode('new')}>
                  <User size={13} /> Renseigner un client
                </button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="form-row">
                    <div className="form-group"><label>Prénom</label><input value={prenom} onChange={e => setPrenom(e.target.value)} /></div>
                    <div className="form-group"><label>Nom</label><input value={nom} onChange={e => setNom(e.target.value)} /></div>
                  </div>
                  <div className="form-group"><label>Téléphone</label><input value={telephone} onChange={e => setTelephone(e.target.value)} /></div>
                </div>
              )}
            </>
          )}

          {/* ── Intervention ── */}
          <div style={{ marginTop: 18, marginBottom: 8, fontSize: 12, fontWeight: 600, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Intervention</div>
          <div className="form-row">
            <div className="form-group">
              <label>Type</label>
              <select value={type} onChange={e => setType(e.target.value as Categorie)}>
                <option value="">— Non défini —</option>
                {ACTIVITES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </div>
            <div className="form-group"><label>Date souhaitée</label>
              <input type="datetime-local" value={dateSouhaitee} onChange={e => setDateSouhaitee(e.target.value)} />
            </div>
          </div>
          <div className="form-group"><label>Adresse</label><input value={adresse} onChange={e => setAdresse(e.target.value)} /></div>
          <div className="form-group"><label>Ville</label><input value={ville} onChange={e => setVille(e.target.value)} /></div>
          <div className="form-group"><label>Description / consignes</label><textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} /></div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none', fontSize: 14, fontWeight: 500, letterSpacing: 0, cursor: 'pointer', marginBottom: 4 }}>
            <input type="checkbox" checked={urgence} onChange={e => setUrgence(e.target.checked)} style={{ width: 'auto', minHeight: 'auto' }} />
            <Sparkles size={13} color="var(--rdTx)" /> Urgente
          </label>

          {/* ── Intervenant ── */}
          <div style={{ marginTop: 14 }} className="form-group">
            <label>Intervenant interne</label>
            <CustomSelect
              value={intervenantId}
              placeholder="Non affecté"
              options={[
                { value: '', label: 'Non affecté' },
                ...intervenants.map(p => ({ value: p.id, label: [p.prenom, p.nom].filter(Boolean).join(' ') || p.email || 'Intervenant sans nom' }))
              ]}
              onChange={setIntervenantId}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="btn btn-primary" disabled={creating} onClick={handleCreate}>
            {creating ? 'Création…' : "Créer l'intervention"}
          </button>
        </div>
      </div>
    </div>
  )
}
