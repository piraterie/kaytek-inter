// src/pages/PartenairesPage.tsx
// Réseau partenaires — Phase 1 (fondations + connexions) + Phase 2 (messagerie)
// + Phase 3 v1 (demandes d'intervention partenaire, snapshot uniquement).
import { useState, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
  Search, X, Copy, Check, Handshake, Inbox, Send, History, ChevronDown, ChevronUp, Lock, MessageCircle,
  Wrench, PlayCircle, CheckCircle2, Ban, MapPin, CalendarDays, Camera, Eye, FilePlus2,
} from 'lucide-react'
import {
  useMyPartnerProfile, useUpsertPartnerProfile, usePartnerSearch,
  usePartnerConnections, useSendPartnerRequest, useUpdatePartnerConnectionStatus,
  usePartnerConnectionEvents, usePartnerUnreadCounts,
  usePartnerInterventionRequests, useUpdatePartnerInterventionStatus, usePartnerInterventionEvents
} from '@/lib/hooks/partners'
import { useAuthStore, useToastStore } from '@/lib/store'
import PartnerMessagesModal from '@/components/PartnerMessagesModal'
import SendToPartnerModal from '@/components/SendToPartnerModal'
import CreateInterventionFromPartnerRequestModal from '@/components/CreateInterventionFromPartnerRequestModal'
import type { PartnerConnection, PartnerConnectionStatus, PartnerSearchResult, PartnerInterventionRequest } from '@/types'

type Tab = 'mine' | 'received' | 'sent' | 'interventions-received' | 'interventions-sent'

const STATUS_LABEL: Record<string, string> = {
  pending: 'En attente', accepted: 'Partenaire', refused: 'Refusée',
  blocked: 'Bloquée', archived: 'Archivée', none: ''
}
const STATUS_PILL: Record<string, string> = {
  pending: 'pill-amber', accepted: 'pill-green', refused: 'pill-red',
  blocked: 'pill-gray', archived: 'pill-gray', none: ''
}
const EVENT_LABEL: Record<string, string> = {
  requested: 'Demande envoyée', accepted: 'Connexion acceptée', refused: 'Demande refusée',
  blocked: 'Connexion bloquée', archived: 'Connexion archivée'
}

const PIR_STATUS_LABEL: Record<string, string> = {
  pending: 'En attente', accepted: 'Acceptée', refused: 'Refusée',
  in_progress: 'En cours', completed: 'Terminée', cancelled: 'Annulée'
}
const PIR_STATUS_PILL: Record<string, string> = {
  pending: 'pill-amber', accepted: 'pill-blue', refused: 'pill-red',
  in_progress: 'pill-orange', completed: 'pill-green', cancelled: 'pill-gray'
}
const PIR_EVENT_LABEL: Record<string, string> = {
  requested: 'Demande envoyée', accepted: 'Acceptée', refused: 'Refusée',
  in_progress: 'Passée en cours', completed: 'Terminée', cancelled: 'Annulée'
}

const URL_TAB_MAP: Record<string, Tab> = {
  'interventions-recues': 'interventions-received',
  'interventions-envoyees': 'interventions-sent'
}

export default function PartenairesPage() {
  const { add } = useToastStore()
  const user = useAuthStore(s => s.user)
  const myOrg = user?.organisation_id
  const [searchParams] = useSearchParams()
  const nav = useNavigate()

  const { data: myProfile, isLoading: profileLoading } = useMyPartnerProfile()
  const upsertProfile = useUpsertPartnerProfile()
  const { data: connections = [], isLoading: connsLoading } = usePartnerConnections()
  const sendRequest = useSendPartnerRequest()
  const updateStatus = useUpdatePartnerConnectionStatus()
  const { data: interventionRequests = [], isLoading: pirLoading } = usePartnerInterventionRequests()
  const updatePirStatus = useUpdatePartnerInterventionStatus()

  const [tab, setTab] = useState<Tab>(() => URL_TAB_MAP[searchParams.get('tab') || ''] || 'mine')
  const [profileModal, setProfileModal] = useState(false)
  const [profileForm, setProfileForm] = useState({ nom_public: '', metier: '', ville: '', bio: '', visible_reseau: false })
  const [profileSaving, setProfileSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [search, setSearch] = useState('')
  const { data: searchResults = [], isLoading: searchLoading } = usePartnerSearch(search)
  const [historyOpenId, setHistoryOpenId] = useState<string | null>(null)
  const [messagesConnection, setMessagesConnection] = useState<PartnerConnection | null>(null)
  const [sendInterventionConnectionId, setSendInterventionConnectionId] = useState<string | null>(null)
  const { data: unreadCounts = {} } = usePartnerUnreadCounts()
  const [refuseTarget, setRefuseTarget] = useState<PartnerInterventionRequest | null>(null)
  const [refuseNote, setRefuseNote] = useState('')
  const [completeTarget, setCompleteTarget] = useState<PartnerInterventionRequest | null>(null)
  const [completeNote, setCompleteNote] = useState('')
  const [pirHistoryOpenId, setPirHistoryOpenId] = useState<string | null>(null)
  const [importTarget, setImportTarget] = useState<PartnerInterventionRequest | null>(null)

  const mine = useMemo(() => connections.filter(c => c.status === 'accepted' || c.status === 'blocked'), [connections])
  const received = useMemo(() => connections.filter(c => c.status === 'pending' && c.target_organisation_id === myOrg), [connections, myOrg])
  const sent = useMemo(() => connections.filter(c => c.status === 'pending' && c.requester_organisation_id === myOrg), [connections, myOrg])
  const pirReceived = useMemo(() => interventionRequests.filter(r => r.target_organisation_id === myOrg), [interventionRequests, myOrg])
  const pirSent = useMemo(() => interventionRequests.filter(r => r.source_organisation_id === myOrg), [interventionRequests, myOrg])

  function findConnectionFor(r: PartnerInterventionRequest) {
    return connections.find(c => c.id === r.connection_id) || null
  }

  async function handlePirAccept(r: PartnerInterventionRequest) {
    try { await updatePirStatus.mutateAsync({ id: r.id, status: 'accepted' }); add('Demande acceptée') }
    catch (err: any) { add(err.message || 'Erreur', 'error') }
  }
  async function handlePirRefuse() {
    if (!refuseTarget || !refuseNote.trim()) return
    try {
      await updatePirStatus.mutateAsync({ id: refuseTarget.id, status: 'refused', note_refus: refuseNote.trim() })
      add('Demande refusée'); setRefuseTarget(null); setRefuseNote('')
    } catch (err: any) { add(err.message || 'Erreur', 'error') }
  }
  async function handlePirInProgress(r: PartnerInterventionRequest) {
    try { await updatePirStatus.mutateAsync({ id: r.id, status: 'in_progress' }); add('Intervention en cours') }
    catch (err: any) { add(err.message || 'Erreur', 'error') }
  }
  async function handlePirComplete() {
    if (!completeTarget) return
    try {
      await updatePirStatus.mutateAsync({ id: completeTarget.id, status: 'completed', compte_rendu: completeNote.trim() || undefined })
      add('Intervention marquée terminée'); setCompleteTarget(null); setCompleteNote('')
    } catch (err: any) { add(err.message || 'Erreur', 'error') }
  }
  async function handlePirCancel(r: PartnerInterventionRequest) {
    try { await updatePirStatus.mutateAsync({ id: r.id, status: 'cancelled' }); add('Demande annulée') }
    catch (err: any) { add(err.message || 'Erreur', 'error') }
  }

  function openProfileModal() {
    setProfileForm({
      nom_public: myProfile?.nom_public || '',
      metier: myProfile?.metier || '',
      ville: myProfile?.ville || '',
      bio: myProfile?.bio || '',
      visible_reseau: myProfile?.visible_reseau ?? false
    })
    setProfileModal(true)
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault()
    if (!profileForm.nom_public.trim()) return
    setProfileSaving(true)
    try {
      await upsertProfile.mutateAsync({
        nom_public: profileForm.nom_public.trim(),
        metier: profileForm.metier.trim() || undefined,
        ville: profileForm.ville.trim() || undefined,
        bio: profileForm.bio.trim() || undefined,
        visible_reseau: profileForm.visible_reseau
      })
      add('Profil partenaire enregistré')
      setProfileModal(false)
    } catch (err: any) { add(err.message || 'Erreur', 'error') }
    setProfileSaving(false)
  }

  function copyCode() {
    if (!myProfile?.code_partenaire) return
    navigator.clipboard.writeText(myProfile.code_partenaire).then(() => {
      setCopied(true); add('Code copié')
      setTimeout(() => setCopied(false), 1500)
    })
  }

  async function handleSendRequest(r: PartnerSearchResult) {
    try {
      await sendRequest.mutateAsync({ target_organisation_id: r.organisation_id, target_profile_id: r.contact_profile_id, message: undefined })
      add(`Demande envoyée à ${r.nom_public}`)
    } catch (err: any) { add(err.message || 'Erreur lors de l\'envoi', 'error') }
  }

  async function handleStatusChange(id: string, status: PartnerConnectionStatus, successMsg: string) {
    try {
      await updateStatus.mutateAsync({ id, status })
      add(successMsg)
    } catch (err: any) { add(err.message || 'Erreur', 'error') }
  }

  if (!user) return null
  if (user.role !== 'admin') {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--t3)' }}>
        <Lock size={20} style={{ marginBottom: 8 }} />
        <p>Le réseau partenaires est réservé aux administrateurs.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Réseau partenaires</h1>
          <p className="page-subtitle">Connectez votre organisation à d'autres entreprises Kaytek Inter, sans partager vos données privées.</p>
        </div>
      </div>

      {/* ── Mon profil partenaire ── */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        {profileLoading ? (
          <div style={{ color: 'var(--t3)' }}>Chargement…</div>
        ) : myProfile ? (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
            <div className="avatar purple" style={{ width: 40, height: 40, fontSize: 14 }}>
              {myProfile.nom_public.slice(0, 2)}
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--t0)' }}>{myProfile.nom_public}</div>
              <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 2 }}>
                {[myProfile.metier, myProfile.ville].filter(Boolean).join(' · ') || 'Aucune information complémentaire'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <span className="pill pill-blue" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'monospace' }}>
                  {myProfile.code_partenaire}
                </span>
                <button className="btn-icon sm" onClick={copyCode} title="Copier le code partenaire">
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                </button>
                <span className={`pill ${myProfile.visible_reseau ? 'pill-green' : 'pill-gray'}`}>
                  {myProfile.visible_reseau ? 'Visible dans le réseau' : 'Non visible dans le réseau'}
                </span>
              </div>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={openProfileModal}>Modifier mon profil</button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t0)' }}>Aucun profil partenaire</div>
              <p style={{ fontSize: 12, color: 'var(--t2)', marginTop: 2 }}>Créez votre profil pour être trouvé par d'autres organisations et envoyer des demandes de connexion.</p>
            </div>
            <button className="btn btn-primary" onClick={openProfileModal}>Créer / modifier mon profil partenaire</button>
          </div>
        )}
      </div>

      {/* ── Recherche ── */}
      <div className="search-bar" style={{ marginBottom: 14 }}>
        <Search size={16} color="var(--t3)" style={{ flexShrink: 0 }} />
        <input placeholder="Rechercher par code partenaire, pseudo, métier, ville ou email exact…" value={search} onChange={e => setSearch(e.target.value)} />
        {search && (
          <button onClick={() => setSearch('')} style={{ border: 'none', background: 'none', color: 'var(--t3)', cursor: 'pointer', padding: '0 2px', display: 'flex', flexShrink: 0 }}><X size={15} /></button>
        )}
      </div>
      {search.trim().length >= 2 && (
        <div className="card" style={{ marginBottom: 20 }}>
          {searchLoading && <div style={{ padding: 20, textAlign: 'center', color: 'var(--t3)' }}>Recherche…</div>}
          {!searchLoading && searchResults.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--t3)' }}>Aucun résultat pour « {search} »</div>
          )}
          {searchResults.map(r => (
            <PartnerResultRow key={r.organisation_id} result={r} onSend={() => handleSendRequest(r)} sending={sendRequest.isPending} />
          ))}
        </div>
      )}

      {/* ── Onglets ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, borderBottom: '1px solid var(--b1)', flexWrap: 'wrap' }}>
        <TabButton icon={Handshake} label="Mes partenaires" count={mine.length} active={tab === 'mine'} onClick={() => setTab('mine')} />
        <TabButton icon={Inbox} label="Demandes reçues" count={received.length} active={tab === 'received'} onClick={() => setTab('received')} />
        <TabButton icon={Send} label="Demandes envoyées" count={sent.length} active={tab === 'sent'} onClick={() => setTab('sent')} />
        <TabButton icon={Wrench} label="Interventions reçues" count={pirReceived.filter(r => r.status === 'pending').length} active={tab === 'interventions-received'} onClick={() => setTab('interventions-received')} />
        <TabButton icon={Wrench} label="Interventions envoyées" count={0} active={tab === 'interventions-sent'} onClick={() => setTab('interventions-sent')} />
      </div>

      <div className="card">
        {connsLoading && <div style={{ padding: 24, textAlign: 'center', color: 'var(--t3)' }}>Chargement…</div>}

        {!connsLoading && tab === 'mine' && (
          mine.length === 0
            ? <Empty text="Aucun partenaire pour l'instant. Recherchez une organisation ci-dessus pour envoyer une demande." />
            : mine.map(c => (
              <ConnectionRow key={c.id} c={c} myOrg={myOrg!}
                historyOpen={historyOpenId === c.id}
                onToggleHistory={() => setHistoryOpenId(historyOpenId === c.id ? null : c.id)}
                actions={
                  c.status === 'accepted' ? (
                    <>
                      <button className="btn btn-secondary btn-sm" title="Message" onClick={() => setMessagesConnection(c)} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <MessageCircle size={13} /> Message
                        {(unreadCounts[c.id] || 0) > 0 && (
                          <span style={{ minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8, background: '#dc2626', color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {unreadCounts[c.id] > 9 ? '9+' : unreadCounts[c.id]}
                          </span>
                        )}
                      </button>
                      <button className="btn btn-secondary btn-sm" title="Envoyer une intervention" onClick={() => setSendInterventionConnectionId(c.id)}>
                        <Wrench size={13} /> Envoyer une intervention
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => handleStatusChange(c.id, 'blocked', 'Partenaire bloqué')}>Bloquer</button>
                      <button className="btn btn-secondary btn-sm" style={{ color: 'var(--rdTx)' }} onClick={() => handleStatusChange(c.id, 'archived', 'Connexion archivée')}>Archiver</button>
                    </>
                  ) : c.blocked_by_organisation_id === myOrg ? (
                    <button className="btn btn-secondary btn-sm" onClick={() => handleStatusChange(c.id, 'accepted', 'Partenaire débloqué')}>Débloquer</button>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--t3)' }}>Bloqué par l'autre organisation</span>
                  )
                } />
            ))
        )}

        {!connsLoading && tab === 'received' && (
          received.length === 0
            ? <Empty text="Aucune demande reçue." />
            : received.map(c => (
              <ConnectionRow key={c.id} c={c} myOrg={myOrg!}
                historyOpen={historyOpenId === c.id}
                onToggleHistory={() => setHistoryOpenId(historyOpenId === c.id ? null : c.id)}
                actions={
                  <>
                    <button className="btn btn-primary btn-sm" onClick={() => handleStatusChange(c.id, 'accepted', 'Demande acceptée')}>Accepter</button>
                    <button className="btn btn-secondary btn-sm" style={{ color: 'var(--rdTx)' }} onClick={() => handleStatusChange(c.id, 'refused', 'Demande refusée')}>Refuser</button>
                  </>
                } />
            ))
        )}

        {!connsLoading && tab === 'sent' && (
          sent.length === 0
            ? <Empty text="Aucune demande envoyée." />
            : sent.map(c => (
              <ConnectionRow key={c.id} c={c} myOrg={myOrg!}
                historyOpen={historyOpenId === c.id}
                onToggleHistory={() => setHistoryOpenId(historyOpenId === c.id ? null : c.id)}
                actions={
                  <>
                    <span className="pill pill-amber">En attente de réponse</span>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleStatusChange(c.id, 'archived', 'Demande annulée')}>Annuler</button>
                  </>
                } />
            ))
        )}

        {!pirLoading && tab === 'interventions-received' && (
          pirReceived.length === 0
            ? <Empty text="Aucune demande d'intervention reçue." />
            : pirReceived.map(r => (
              <PartnerInterventionRow key={r.id} r={r}
                historyOpen={pirHistoryOpenId === r.id}
                onToggleHistory={() => setPirHistoryOpenId(pirHistoryOpenId === r.id ? null : r.id)}
                onMessage={() => { const c = findConnectionFor(r); if (c) setMessagesConnection(c) }}
                actions={
                  <>
                    {r.status === 'pending' && (
                      <>
                        <button className="btn btn-primary btn-sm" onClick={() => handlePirAccept(r)}><CheckCircle2 size={13} /> Accepter</button>
                        <button className="btn btn-secondary btn-sm" style={{ color: 'var(--rdTx)' }} onClick={() => setRefuseTarget(r)}><Ban size={13} /> Refuser</button>
                      </>
                    )}
                    {r.status === 'accepted' && (
                      <button className="btn btn-primary btn-sm" onClick={() => handlePirInProgress(r)}><PlayCircle size={13} /> Marquer en cours</button>
                    )}
                    {r.status === 'in_progress' && (
                      <button className="btn btn-primary btn-sm" style={{ background: '#16a34a', border: 'none' }} onClick={() => setCompleteTarget(r)}><CheckCircle2 size={13} /> Marquer terminé</button>
                    )}
                    {(r.status === 'accepted' || r.status === 'in_progress') && (
                      r.resulting_intervention_id ? (
                        <button className="btn btn-secondary btn-sm" onClick={() => nav(`/interventions/${r.resulting_intervention_id}`)}>
                          <Eye size={13} /> Voir l'intervention
                        </button>
                      ) : (
                        <button className="btn btn-secondary btn-sm" onClick={() => setImportTarget(r)}>
                          <FilePlus2 size={13} /> Créer une intervention
                        </button>
                      )
                    )}
                  </>
                } />
            ))
        )}

        {!pirLoading && tab === 'interventions-sent' && (
          pirSent.length === 0
            ? <Empty text="Aucune demande d'intervention envoyée." />
            : pirSent.map(r => (
              <PartnerInterventionRow key={r.id} r={r}
                historyOpen={pirHistoryOpenId === r.id}
                onToggleHistory={() => setPirHistoryOpenId(pirHistoryOpenId === r.id ? null : r.id)}
                onMessage={() => { const c = findConnectionFor(r); if (c) setMessagesConnection(c) }}
                actions={
                  (r.status === 'pending' || r.status === 'accepted') ? (
                    <button className="btn btn-secondary btn-sm" style={{ color: 'var(--rdTx)' }} onClick={() => handlePirCancel(r)}><Ban size={13} /> Annuler</button>
                  ) : null
                } />
            ))
        )}
      </div>

      {/* ── Modal profil ── */}
      {profileModal && (
        <div className="modal-overlay" onClick={() => setProfileModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Profil partenaire</span>
              <button className="btn-icon sm" onClick={() => setProfileModal(false)}><X size={15} /></button>
            </div>
            <form onSubmit={handleSaveProfile}>
              <div className="modal-body">
                <p style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 14 }}>
                  Ces informations peuvent être vues par d'autres organisations. Ne contient jamais votre email ni vos données internes.
                </p>
                <div className="form-group"><label>Nom public <span className="req">*</span></label>
                  <input value={profileForm.nom_public} onChange={e => setProfileForm(f => ({ ...f, nom_public: e.target.value }))} required maxLength={80} />
                </div>
                <div className="form-group"><label>Métier</label>
                  <input value={profileForm.metier} onChange={e => setProfileForm(f => ({ ...f, metier: e.target.value }))} placeholder="ex : Serrurerie, plomberie…" maxLength={80} />
                </div>
                <div className="form-group"><label>Ville</label>
                  <input value={profileForm.ville} onChange={e => setProfileForm(f => ({ ...f, ville: e.target.value }))} maxLength={80} />
                </div>
                <div className="form-group"><label>Présentation</label>
                  <textarea value={profileForm.bio} onChange={e => setProfileForm(f => ({ ...f, bio: e.target.value }))} rows={3} maxLength={400} />
                </div>
                <div className="form-group">
                  <label>Visible dans le réseau partenaire</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 4 }}>
                    <div className={`toggle ${profileForm.visible_reseau ? '' : 'off'}`} onClick={() => setProfileForm(f => ({ ...f, visible_reseau: !f.visible_reseau }))} style={{ cursor: 'pointer', flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: 'var(--t1)' }}>
                      {profileForm.visible_reseau ? 'Trouvable par recherche (nom, métier, ville)' : 'Trouvable uniquement par code partenaire ou email exact'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setProfileModal(false)}>Annuler</button>
                <button type="submit" className="btn btn-primary" disabled={profileSaving}>{profileSaving ? 'Sauvegarde…' : 'Sauvegarder'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal messagerie partenaire ── */}
      {messagesConnection && (
        <PartnerMessagesModal connection={messagesConnection} onClose={() => setMessagesConnection(null)} />
      )}

      {/* ── Modal envoyer une intervention (partenaire pré-sélectionné) ── */}
      {sendInterventionConnectionId && (
        <SendToPartnerModal presetConnectionId={sendInterventionConnectionId} onClose={() => setSendInterventionConnectionId(null)} />
      )}

      {/* ── Modal créer une intervention depuis une demande partenaire reçue ── */}
      {importTarget && (
        <CreateInterventionFromPartnerRequestModal
          request={importTarget}
          onClose={() => setImportTarget(null)}
          onCreated={(interventionId) => nav(`/interventions/${interventionId}`)}
        />
      )}

      {/* ── Modal refus demande d'intervention ── */}
      {refuseTarget && (
        <div className="modal-overlay" onClick={() => { setRefuseTarget(null); setRefuseNote('') }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Refuser la demande</span>
              <button className="btn-icon sm" onClick={() => { setRefuseTarget(null); setRefuseNote('') }}><X size={15} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Motif du refus <span className="req">*</span></label>
                <textarea value={refuseNote} onChange={e => setRefuseNote(e.target.value)} rows={3} autoFocus placeholder="Ex : indisponible sur cette période…" />
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => { setRefuseTarget(null); setRefuseNote('') }}>Annuler</button>
              <button type="button" className="btn btn-primary" style={{ background: '#dc2626', border: 'none' }} disabled={!refuseNote.trim() || updatePirStatus.isPending} onClick={handlePirRefuse}>
                Confirmer le refus
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal clôture demande d'intervention ── */}
      {completeTarget && (
        <div className="modal-overlay" onClick={() => { setCompleteTarget(null); setCompleteNote('') }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Marquer terminée</span>
              <button className="btn-icon sm" onClick={() => { setCompleteTarget(null); setCompleteNote('') }}><X size={15} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Compte-rendu (optionnel)</label>
                <textarea value={completeNote} onChange={e => setCompleteNote(e.target.value)} rows={3} placeholder="Travail réalisé, remarques…" />
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => { setCompleteTarget(null); setCompleteNote('') }}>Annuler</button>
              <button type="button" className="btn btn-primary" style={{ background: '#16a34a', border: 'none' }} disabled={updatePirStatus.isPending} onClick={handlePirComplete}>
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TabButton({ icon: Icon, label, count, active, onClick }: { icon: any; label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', border: 'none', background: 'none',
        borderBottom: active ? '2px solid var(--bl)' : '2px solid transparent',
        color: active ? 'var(--bl)' : 'var(--t2)', fontWeight: active ? 600 : 500, fontSize: 13, cursor: 'pointer'
      }}
    >
      <Icon size={14} /> {label}
      {count > 0 && <span className="pill pill-gray" style={{ fontSize: 10, padding: '1px 6px' }}>{count}</span>}
    </button>
  )
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: 24, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>{text}</div>
}

function PartnerResultRow({ result, onSend, sending }: { result: PartnerSearchResult; onSend: () => void; sending: boolean }) {
  const status = result.connection_status
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--b0)', flexWrap: 'wrap' }}>
      <div className="avatar" style={{ width: 34, height: 34, fontSize: 12 }}>{result.nom_public.slice(0, 2)}</div>
      <div style={{ flex: 1, minWidth: 160 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t0)' }}>{result.nom_public}</div>
        <div style={{ fontSize: 12, color: 'var(--t2)' }}>{[result.metier, result.ville].filter(Boolean).join(' · ') || result.code_partenaire}</div>
      </div>
      {status === 'none' ? (
        <button className="btn btn-primary btn-sm" onClick={onSend} disabled={sending}>Envoyer une demande</button>
      ) : (
        <span className={`pill ${STATUS_PILL[status] || 'pill-gray'}`}>{STATUS_LABEL[status] || status}</span>
      )}
    </div>
  )
}

function ConnectionRow({ c, myOrg, actions, historyOpen, onToggleHistory }: {
  c: PartnerConnection; myOrg: string; actions: React.ReactNode; historyOpen: boolean; onToggleHistory: () => void
}) {
  const p = c.partner_profile
  const { data: events = [] } = usePartnerConnectionEvents(historyOpen ? c.id : null)
  return (
    <div style={{ borderBottom: '1px solid var(--b0)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', flexWrap: 'wrap' }}>
        <div className="avatar" style={{ width: 34, height: 34, fontSize: 12 }}>{(p?.nom_public || '?').slice(0, 2)}</div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t0)' }}>{p?.nom_public || 'Organisation partenaire'}</div>
          <div style={{ fontSize: 12, color: 'var(--t2)' }}>{[p?.metier, p?.ville].filter(Boolean).join(' · ') || p?.code_partenaire || '—'}</div>
        </div>
        <span className={`pill ${STATUS_PILL[c.status]}`}>{STATUS_LABEL[c.status]}</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>{actions}</div>
        <button className="btn-icon sm" title="Historique" onClick={onToggleHistory}>
          <History size={13} /> {historyOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>
      </div>
      {historyOpen && (
        <div style={{ padding: '0 16px 14px 62px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {events.length === 0 && <span style={{ fontSize: 12, color: 'var(--t3)' }}>Aucun événement</span>}
          {events.map(e => (
            <div key={e.id} style={{ fontSize: 12, color: 'var(--t2)' }}>
              {EVENT_LABEL[e.action] || e.action} · {new Date(e.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Demandes d'intervention partenaire (Phase 3 v1) ──────────────────────────
// Ne rend jamais source_intervention_id — uniquement le snapshot partagé.
function PartnerInterventionRow({ r, actions, historyOpen, onToggleHistory, onMessage }: {
  r: PartnerInterventionRequest; actions: React.ReactNode
  historyOpen: boolean; onToggleHistory: () => void; onMessage: () => void
}) {
  const p = r.partner_profile
  const { data: events = [] } = usePartnerInterventionEvents(historyOpen ? r.id : null)
  const photoCount = r.photos_partagees?.length || 0

  return (
    <div style={{ borderBottom: '1px solid var(--b0)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 16px', flexWrap: 'wrap' }}>
        <div className="avatar" style={{ width: 34, height: 34, fontSize: 12, marginTop: 2 }}>{(p?.nom_public || '?').slice(0, 2)}</div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t0)' }}>{p?.nom_public || 'Organisation partenaire'}</span>
            {r.urgence && <span className="urgence-badge">URGENT</span>}
            <span className={`pill ${PIR_STATUS_PILL[r.status]}`}>{PIR_STATUS_LABEL[r.status]}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--t2)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {r.type_intervention && <span>{r.type_intervention}</span>}
            {r.ville && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><MapPin size={11} /> {r.ville}</span>}
            {r.date_souhaitee && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><CalendarDays size={11} /> {new Date(r.date_souhaitee).toLocaleDateString('fr-FR')}</span>}
            {photoCount > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Camera size={11} /> {photoCount} photo{photoCount > 1 ? 's' : ''} partagée{photoCount > 1 ? 's' : ''} — aperçu bientôt disponible</span>}
          </div>
          {(r.adresse_partagee || r.telephone_client_partage || r.nom_client_partage) && (
            <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 4 }}>
              {r.nom_client_partage && <div>Client : {r.nom_client_partage}</div>}
              {r.telephone_client_partage && <div>Tél. : {r.telephone_client_partage}</div>}
              {r.adresse_partagee && <div>Adresse : {r.adresse_partagee}</div>}
            </div>
          )}
          {r.description_partagee && <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 4 }}>{r.description_partagee}</div>}
          {r.montant_partage != null && <div style={{ fontSize: 12, color: 'var(--t1)', fontWeight: 600, marginTop: 4 }}>{r.montant_partage} €</div>}
          {r.consignes_partagees && <div style={{ fontSize: 12, color: 'var(--amTx)', marginTop: 4, fontStyle: 'italic' }}>Consignes : {r.consignes_partagees}</div>}
          {r.status === 'refused' && r.note_refus && <div style={{ fontSize: 12, color: 'var(--rdTx)', marginTop: 4 }}>Motif du refus : {r.note_refus}</div>}
          {r.status === 'completed' && r.compte_rendu && <div style={{ fontSize: 12, color: 'var(--gnTx)', marginTop: 4 }}>Compte-rendu : {r.compte_rendu}</div>}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={onMessage}><MessageCircle size={13} /> Message</button>
          {actions}
        </div>
        <button className="btn-icon sm" title="Historique" onClick={onToggleHistory}>
          <History size={13} /> {historyOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>
      </div>
      {historyOpen && (
        <div style={{ padding: '0 16px 14px 62px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {events.length === 0 && <span style={{ fontSize: 12, color: 'var(--t3)' }}>Aucun événement</span>}
          {events.map(e => (
            <div key={e.id} style={{ fontSize: 12, color: 'var(--t2)' }}>
              {PIR_EVENT_LABEL[e.action] || e.action} · {new Date(e.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
