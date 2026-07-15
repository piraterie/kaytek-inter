// src/pages/UsersPage.tsx
import { useState, useMemo } from 'react'
import {
  Search, X, HardHat, Briefcase, Smartphone, Monitor, Pencil, Trash2, Shield,
  Send, CheckCircle2, XCircle,
} from 'lucide-react'
import { useProfiles, useUpdateProfile } from '@/lib/hooks'
import { useToastStore } from '@/lib/store'
import { inviterIntervenant, supprimerUtilisateur } from '@/lib/supabase/auth'
import { supabase } from '@/lib/supabase/client'
import { getUserDevices, revokeDevice, resetUserDevices, isCurrentDevice, type DeviceRecord } from '@/lib/devices'
import ConfirmModal from '@/components/ConfirmModal'
import type { Profile } from '@/types'

const ns = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default function UsersPage() {
  const { add } = useToastStore()
  const { data: profiles = [], isLoading, refetch } = useProfiles()
  const upd = useUpdateProfile()
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(false)
  const [editModal, setEditModal] = useState(false)
  const [editTarget, setEditTarget] = useState<Profile | null>(null)
  const [invForm, setInvForm] = useState({ email:'', nom:'', prenom:'', commission_pct:30, type_intervenant:'entrepreneur' as 'entrepreneur'|'salarie', role:'intervenant' as 'intervenant'|'assistant' })
  const [editForm, setEditForm] = useState({ nom:'', prenom:'', email:'', commission_pct:30, type_intervenant:'' as ''|'entrepreneur'|'salarie', can_create_documents: false, can_bypass_validation: false, telegram_chat_id: '', telegram_notifications_enabled: true })
  const [invLoading, setInvLoading] = useState(false)
  const [editLoading, setEditLoading] = useState(false)
  const [delLoading, setDelLoading] = useState<string|null>(null)
  const [devicesModal, setDevicesModal] = useState(false)
  const [devicesTarget, setDevicesTarget] = useState<Profile|null>(null)
  const [devicesData, setDevicesData] = useState<DeviceRecord[]>([])
  const [devicesLoading, setDevicesLoading] = useState(false)
  const [tgTestLoading, setTgTestLoading] = useState(false)
  const [tgTestResult, setTgTestResult] = useState<'idle'|'ok'|'error'>('idle')
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; action: () => void } | null>(null)
  const [tgTestError, setTgTestError] = useState('')

  const filteredProfiles = useMemo(() => {
    if (!search.trim()) return profiles
    const q = ns(search)
    return profiles.filter(p =>
      ns(p.nom).includes(q) ||
      ns(p.prenom).includes(q) ||
      ns(p.email).includes(q) ||
      ns(p.role).includes(q)
    )
  }, [profiles, search])

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault(); setInvLoading(true)
    const { error } = await inviterIntervenant(invForm.email, invForm.nom, invForm.prenom, invForm.commission_pct, invForm.type_intervenant, invForm.role)
    setInvLoading(false)
    if (error) add(error,'error')
    else { add(`Invitation envoyée à ${invForm.email}`); setModal(false); setInvForm({ email:'',nom:'',prenom:'',commission_pct:30, type_intervenant:'entrepreneur', role:'intervenant' }); refetch() }
  }

  function openEdit(p: Profile) {
    setEditTarget(p)
    setEditForm({ nom:p.nom, prenom:p.prenom, email:p.email, commission_pct:p.commission_pct, type_intervenant:(p.type_intervenant||'') as ''|'entrepreneur'|'salarie', can_create_documents: p.can_create_documents ?? false, can_bypass_validation: p.can_bypass_validation ?? false, telegram_chat_id: p.telegram_chat_id || '', telegram_notifications_enabled: p.telegram_notifications_enabled ?? true })
    setTgTestResult('idle'); setTgTestError('')
    setEditModal(true)
  }

  async function handleTestTelegram() {
    const chatId = editForm.telegram_chat_id.trim()
    if (!chatId) return
    setTgTestLoading(true); setTgTestResult('idle'); setTgTestError('')
    try {
      const { data, error } = await supabase.functions.invoke('send-telegram', {
        body: { chat_id: chatId, message: '✅ Test Telegram Kaytek réussi\n\nVous recevrez les alertes @Alertesinter_bot sur ce compte.' }
      })
      if (error) throw new Error(error.message)
      if (!data?.sent) {
        const reason = data?.reason
        if (reason === 'no_token') throw new Error('TELEGRAM_BOT_TOKEN absent — contacter l\'administrateur système')
        throw new Error(`Envoi échoué (${reason || 'raison inconnue'}) — vérifier le Chat ID`)
      }
      setTgTestResult('ok')
    } catch(e: any) { setTgTestResult('error'); setTgTestError(e.message || 'Erreur inconnue') }
    setTgTestLoading(false)
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault(); if (!editTarget) return; setEditLoading(true)
    try {
      const payload: any = { id: editTarget.id, nom: editForm.nom, prenom: editForm.prenom, commission_pct: editForm.commission_pct }
      if (editTarget.role === 'intervenant' && editForm.type_intervenant) payload.type_intervenant = editForm.type_intervenant
      if (editTarget.role === 'intervenant') {
        payload.can_create_documents = editForm.can_create_documents
        payload.can_bypass_validation = editForm.can_create_documents ? editForm.can_bypass_validation : false
      }
      payload.telegram_chat_id = editForm.telegram_chat_id || null
      payload.telegram_notifications_enabled = editForm.telegram_notifications_enabled
      await upd.mutateAsync(payload)
      add('Profil mis à jour'); setEditModal(false); setEditTarget(null)
    } catch(err:any) { add(err.message,'error') }
    setEditLoading(false)
  }

  function handleDelete(p: Profile) {
    setConfirmDialog({
      message: `Supprimer définitivement ${p.prenom} ${p.nom} ? Cette action est irréversible.`,
      action: async () => {
        setDelLoading(p.id)
        const { error } = await supprimerUtilisateur(p.id)
        setDelLoading(null)
        if (error) add(error, 'error')
        else { add(`${p.prenom} ${p.nom} supprimé`); refetch() }
      }
    })
  }

  async function toggleActive(id: string, actif: boolean) {
    try { await upd.mutateAsync({ id, actif: !actif }); add(actif?'Compte désactivé':'Compte réactivé') }
    catch(e:any) { add(e.message,'error') }
  }

  async function updateCommission(id: string, pct: number) {
    try { await upd.mutateAsync({ id, commission_pct: pct }); add('Commission mise à jour') }
    catch(e:any) { add(e.message,'error') }
  }

  async function openDevices(p: Profile) {
    setDevicesTarget(p)
    setDevicesModal(true)
    setDevicesLoading(true)
    const d = await getUserDevices(p.id)
    setDevicesData(d)
    setDevicesLoading(false)
  }

  async function handleRevokeDevice(deviceDbId: string) {
    await revokeDevice(deviceDbId)
    setDevicesData(prev => prev.map(d => d.id === deviceDbId ? { ...d, actif: false } : d))
    add('Appareil révoqué')
  }

  function handleResetDevices() {
    if (!devicesTarget) return
    setConfirmDialog({
      message: `Réinitialiser tous les appareils de ${devicesTarget.prenom} ${devicesTarget.nom} ?\n\nCet utilisateur sera déconnecté de tous ses appareils et pourra se reconnecter normalement.`,
      action: async () => {
        await resetUserDevices(devicesTarget.id)
        setDevicesData(prev => prev.map(d => ({ ...d, actif: false })))
        add('Appareils réinitialisés — l\'utilisateur peut se reconnecter')
      }
    })
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Utilisateurs</h1>
          <p className="page-subtitle">{profiles.length} utilisateur{profiles.length > 1 ? 's' : ''} · Admin : accès total · Intervenants : données isolées (RLS)</p>
        </div>
        <button className="btn btn-primary" onClick={()=>setModal(true)}>+ Inviter un utilisateur</button>
      </div>

      <div className="search-bar" style={{ marginBottom: 14 }}>
        <Search size={16} color="var(--t3)" style={{ flexShrink: 0 }} />
        <input placeholder="Rechercher par nom, prénom, email…" value={search} onChange={e=>setSearch(e.target.value)} />
        {search && (
          <button onClick={() => setSearch('')} style={{ border:'none',background:'none',color:'var(--t3)',cursor:'pointer',padding:'0 2px',display:'flex',flexShrink:0 }}><X size={15} /></button>
        )}
      </div>

      <div className="card">
        {isLoading&&<div style={{ padding:24,textAlign:'center',color:'var(--t3)' }}>Chargement…</div>}
        {!isLoading && filteredProfiles.length === 0 && (
          <div style={{ padding:24,textAlign:'center',color:'var(--t3)' }}>
            {search.trim() ? (
              <>
                <p style={{ marginBottom:10 }}>Aucun résultat pour « {search} »</p>
                <button className="btn btn-secondary btn-sm" onClick={() => setSearch('')}>Effacer la recherche</button>
              </>
            ) : 'Aucun utilisateur'}
          </div>
        )}
        {filteredProfiles.map(p=>(
          <div key={p.id} style={{ display:'flex',alignItems:'flex-start',gap:12,padding:'14px 16px',borderBottom:'1px solid var(--b0)',flexWrap:'wrap' }}>
            {/* Avatar */}
            <div className={`avatar ${p.role==='admin'?'purple':''}`} style={{ width:36,height:36,fontSize:13,flexShrink:0,marginTop:2 }}>
              {(p.prenom?.[0]||'')+(p.nom?.[0]||'')}
            </div>
            {/* Infos */}
            <div style={{ flex:1,minWidth:0 }}>
              <div style={{ fontSize:14,fontWeight:600,color:'var(--t0)' }}>{p.prenom} {p.nom}</div>
              <div style={{ fontSize:12,color:'var(--t2)',marginTop:2 }}>{p.email}</div>
              {p.role==='intervenant' && (
                <div style={{ fontSize:12,color:'var(--t3)',marginTop:1 }}>
                  {p.type_intervenant ? (
                    <span style={{ marginRight:6, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {p.type_intervenant==='entrepreneur' ? <HardHat size={11} /> : <Briefcase size={11} />}
                      {p.type_intervenant==='entrepreneur'?'Entrepreneur':'Salarié'}
                    </span>
                  ) : null}
                  comm. {p.commission_pct}%
                </div>
              )}
            </div>
            {/* Actions — wrappent sur une nouvelle ligne sur mobile */}
            <div style={{ display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',width:'100%',maxWidth:380 }}>
              <span className={`pill ${p.role==='admin'?'pill-purple':p.role==='assistant'?'pill-amber':'pill-blue'}`}>{p.role}</span>
              {(p.role==='intervenant'||p.role==='assistant')&&(
                <>
                  <span className={`pill ${p.actif?'pill-green':'pill-red'}`}>{p.actif?'Actif':'Inactif'}</span>
                  <div className={`toggle ${p.actif?'':'off'}`} onClick={()=>toggleActive(p.id, p.actif)} title={p.actif?'Désactiver':'Activer'} style={{ cursor:'pointer' }} />
                  {p.role==='intervenant' && (
                    <div style={{ display:'flex',alignItems:'center',gap:4 }}>
                      <input type="number" defaultValue={p.commission_pct} min={0} max={100} step={1}
                        style={{ width:52,fontSize:13,padding:'4px 6px',minHeight:'auto',borderRadius:6 }}
                        onBlur={e=>{ if(+e.target.value!==p.commission_pct) updateCommission(p.id,+e.target.value) }}
                        title="Commission %" />
                      <span style={{ fontSize:12,color:'var(--t2)' }}>%</span>
                    </div>
                  )}
                </>
              )}
              <div style={{ marginLeft:'auto',display:'flex',gap:8 }}>
                <button className="btn-icon sm" onClick={()=>openDevices(p)} title="Gérer les appareils"><Smartphone size={14} /></button>
                <button className="btn btn-secondary btn-sm" onClick={()=>openEdit(p)} title="Modifier"><Pencil size={13} /> Modifier</button>
                {(p.role==='intervenant'||p.role==='assistant')&&(
                  <button
                    className="btn-icon sm"
                    style={{ color:'var(--rdTx)' }}
                    onClick={()=>handleDelete(p)}
                    disabled={delLoading===p.id}
                    title="Supprimer définitivement"
                  >
                    {delLoading===p.id?'…':<Trash2 size={14} />}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop:10,padding:'12px 14px',background:'var(--blBg)',borderRadius:'var(--r2)',border:'1px solid var(--blBd)',fontSize:13,color:'var(--blTx)',display:'flex',gap:8,alignItems:'flex-start' }}>
        <Shield size={15} style={{ flexShrink: 0 }} /> RLS actif — chaque intervenant ne voit que ses interventions. Suppression = irréversible (profil + compte auth supprimés).
      </div>

      {/* Modal inviter */}
      {modal&&(
        <div className="modal-overlay" onClick={()=>setModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Inviter un utilisateur</span>
              <button className="btn-icon sm" onClick={()=>setModal(false)}><X size={15} /></button>
            </div>
            <form onSubmit={handleInvite}>
              <div className="modal-body">
                <p style={{ fontSize:13,color:'var(--t2)',marginBottom:14 }}>Un email d'invitation sera envoyé. L'utilisateur pourra définir son mot de passe.</p>
                <div className="form-group">
                  <label>Rôle</label>
                  <select value={invForm.role} onChange={e=>setInvForm(f=>({...f,role:e.target.value as any}))}>
                    <option value="intervenant">Intervenant</option>
                    <option value="assistant">Assistant</option>
                  </select>
                </div>
                <div className="form-group"><label>Prénom <span className="req">*</span></label><input value={invForm.prenom} onChange={e=>setInvForm(f=>({...f,prenom:e.target.value}))} required /></div>
                <div className="form-group"><label>Nom <span className="req">*</span></label><input value={invForm.nom} onChange={e=>setInvForm(f=>({...f,nom:e.target.value}))} required /></div>
                <div className="form-group"><label>Email <span className="req">*</span></label><input type="email" value={invForm.email} onChange={e=>setInvForm(f=>({...f,email:e.target.value}))} required /></div>
                {invForm.role === 'intervenant' && (
                  <>
                    <div className="form-group"><label>Commission (%)</label><input type="number" min={0} max={100} value={invForm.commission_pct} onChange={e=>setInvForm(f=>({...f,commission_pct:+e.target.value}))} /></div>
                    <div className="form-group">
                      <label>Type d'intervenant</label>
                      <select value={invForm.type_intervenant} onChange={e=>setInvForm(f=>({...f,type_intervenant:e.target.value as any}))}>
                        <option value="entrepreneur">Entrepreneur (autonome)</option>
                        <option value="salarie">Salarié</option>
                      </select>
                    </div>
                  </>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={()=>setModal(false)}>Annuler</button>
                <button type="submit" className="btn btn-primary" disabled={invLoading}>{invLoading?'Envoi…':'Envoyer invitation'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal appareils admin */}
      {devicesModal&&devicesTarget&&(
        <div className="modal-overlay" onClick={()=>setDevicesModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Smartphone size={16} /> Appareils — {devicesTarget.prenom} {devicesTarget.nom}</span>
              <button className="btn-icon sm" onClick={()=>setDevicesModal(false)}><X size={15} /></button>
            </div>
            <div className="modal-body">
              {devicesLoading ? (
                <div style={{ textAlign:'center',padding:24,color:'var(--t3)' }}>Chargement…</div>
              ) : devicesData.length === 0 ? (
                <div style={{ textAlign:'center',padding:24,color:'var(--t3)' }}>Aucun appareil enregistré</div>
              ) : (
                <div style={{ display:'flex',flexDirection:'column',gap:8 }}>
                  {devicesData.map(d=>(
                    <div key={d.id} style={{ display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderRadius:8,border:'1px solid var(--b1)' }}>
                      <span style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--s1)', color: 'var(--t2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink:0 }}>{d.systeme_exploitation==='iOS'||d.systeme_exploitation==='Android'?<Smartphone size={15} />:<Monitor size={15} />}</span>
                      <div style={{ flex:1,minWidth:0 }}>
                        <div style={{ fontSize:13,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
                          {d.nom_appareil||'Appareil inconnu'}
                          {isCurrentDevice(d.device_id)&&<span style={{ marginLeft:6,fontSize:10,padding:'1px 6px',background:'var(--bl)',color:'#fff',borderRadius:10 }}>Admin actuel</span>}
                        </div>
                        <div style={{ fontSize:11,color:'var(--t3)',marginTop:1 }}>
                          1ère connexion : {new Date(d.date_premiere_connexion).toLocaleDateString('fr-FR')} · Dernière : {new Date(d.date_derniere_connexion).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'})}
                        </div>
                      </div>
                      <span className={`pill ${d.actif?'pill-green':'pill-gray'}`} style={{ fontSize:10 }}>{d.actif?'Actif':'Révoqué'}</span>
                      {d.actif&&(
                        <button onClick={()=>handleRevokeDevice(d.id)} className="btn btn-secondary btn-sm" style={{ color:'var(--rdTx)',flexShrink:0 }}>Révoquer</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={()=>setDevicesModal(false)}>Fermer</button>
              {devicesData.some(d => d.actif) && (
                <button
                  className="btn btn-primary"
                  style={{ background: '#dc2626', borderColor: '#dc2626' }}
                  onClick={handleResetDevices}
                >
                  Réinitialiser les appareils
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal modifier */}
      {editModal&&editTarget&&(
        <div className="modal-overlay" onClick={()=>setEditModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Modifier {editTarget.prenom} {editTarget.nom}</span>
              <button className="btn-icon sm" onClick={()=>setEditModal(false)}><X size={15} /></button>
            </div>
            <form onSubmit={handleEdit}>
              <div className="modal-body">
                <div className="form-group"><label>Prénom</label><input value={editForm.prenom} onChange={e=>setEditForm(f=>({...f,prenom:e.target.value}))} required /></div>
                <div className="form-group"><label>Nom</label><input value={editForm.nom} onChange={e=>setEditForm(f=>({...f,nom:e.target.value}))} required /></div>
                <div className="form-group"><label>Email</label><input type="email" value={editForm.email} disabled style={{ opacity:0.5 }} title="L'email ne peut pas être modifié ici" /></div>
                {editTarget.role==='intervenant'&&(
                  <>
                    <div className="form-group"><label>Commission (%)</label><input type="number" min={0} max={100} value={editForm.commission_pct} onChange={e=>setEditForm(f=>({...f,commission_pct:+e.target.value}))} /></div>
                    <div className="form-group">
                      <label>Type d'intervenant</label>
                      <select value={editForm.type_intervenant} onChange={e=>setEditForm(f=>({...f,type_intervenant:e.target.value as any}))}>
                        <option value="">Non défini</option>
                        <option value="entrepreneur">Entrepreneur (autonome)</option>
                        <option value="salarie">Salarié</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Création de documents</label>
                      <div style={{ display:'flex',alignItems:'center',gap:12,paddingTop:4 }}>
                        <div
                          className={`toggle ${editForm.can_create_documents?'':'off'}`}
                          onClick={()=>setEditForm(f=>({...f,can_create_documents:!f.can_create_documents,can_bypass_validation:!f.can_create_documents?f.can_bypass_validation:false}))}
                          style={{ cursor:'pointer',flexShrink:0 }}
                        />
                        <span style={{ fontSize:13,color:'var(--t1)' }}>
                          {editForm.can_create_documents
                            ? 'Peut créer des devis et factures'
                            : 'Ne peut pas créer de devis/factures'}
                        </span>
                      </div>
                    </div>
                    {editForm.can_create_documents && (
                      <div className="form-group">
                        <label>Validation automatique</label>
                        <div style={{ display:'flex',alignItems:'center',gap:12,paddingTop:4 }}>
                          <div
                            className={`toggle ${editForm.can_bypass_validation?'':'off'}`}
                            onClick={()=>setEditForm(f=>({...f,can_bypass_validation:!f.can_bypass_validation}))}
                            style={{ cursor:'pointer',flexShrink:0 }}
                          />
                          <span style={{ fontSize:13,color:'var(--t1)' }}>
                            {editForm.can_bypass_validation
                              ? 'Devis/factures actifs sans validation admin'
                              : 'Devis/factures soumis à validation admin'}
                          </span>
                        </div>
                        <p style={{ fontSize:11,color:'var(--t3)',marginTop:4 }}>
                          {editForm.can_bypass_validation
                            ? 'L\'admin reçoit une notification informative uniquement.'
                            : 'L\'admin doit valider chaque document avant qu\'il soit utilisable.'}
                        </p>
                      </div>
                    )}
                  </>
                )}
                {/* ── Telegram ── */}
                <div style={{ marginTop:16, paddingTop:14, borderTop:'1px solid var(--b1)' }}>
                  <div style={{ fontSize:12, fontWeight:600, color:'var(--t2)', marginBottom:10, textTransform:'uppercase', letterSpacing:'0.05em' }}>
                    Telegram — @Alertesinter_bot
                  </div>
                  <div style={{ background:'var(--blBg)', border:'1px solid var(--blBd)', borderRadius:8, padding:'10px 12px', marginBottom:12, fontSize:12, color:'var(--blTx)', lineHeight:1.7 }}>
                    <b>Pour activer les alertes Telegram :</b><br/>
                    1. Ouvrir Telegram → chercher <b>@Alertesinter_bot</b> → appuyer <b>Démarrer</b><br/>
                    2. Chercher <b>@userinfobot</b> → envoyer /start → copier le nombre affiché<br/>
                    3. Coller ce nombre dans le champ Chat ID ci-dessous<br/>
                    4. Cliquer <b>Tester</b> pour vérifier la réception
                  </div>
                  <div className="form-group">
                    <label>Chat ID Telegram</label>
                    <input
                      type="text"
                      placeholder="ex : 123456789"
                      value={editForm.telegram_chat_id}
                      onChange={e=>{ setEditForm(f=>({...f, telegram_chat_id:e.target.value})); setTgTestResult('idle'); setTgTestError('') }}
                    />
                  </div>
                  <div className="form-group">
                    <label>Notifications Telegram</label>
                    <div style={{ display:'flex',alignItems:'center',gap:12,paddingTop:4 }}>
                      <div
                        className={`toggle ${editForm.telegram_notifications_enabled?'':'off'}`}
                        onClick={()=>setEditForm(f=>({...f, telegram_notifications_enabled:!f.telegram_notifications_enabled}))}
                        style={{ cursor:'pointer',flexShrink:0 }}
                      />
                      <span style={{ fontSize:13,color:'var(--t1)' }}>
                        {editForm.telegram_notifications_enabled ? 'Alertes Telegram activées' : 'Alertes Telegram désactivées'}
                      </span>
                    </div>
                  </div>
                  {editForm.telegram_chat_id.trim() && (
                    <div style={{ display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',marginTop:4 }}>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={handleTestTelegram} disabled={tgTestLoading} style={{ display:'flex',alignItems:'center',gap:6 }}>
                        {tgTestLoading ? '…' : <><Send size={13} /> Tester Telegram</>}
                      </button>
                      {tgTestResult==='ok' && <span style={{ fontSize:12,color:'var(--gnTx)', display: 'flex', alignItems: 'center', gap: 5 }}><CheckCircle2 size={13} /> Message reçu sur Telegram</span>}
                      {tgTestResult==='error' && <span style={{ fontSize:12,color:'var(--rdTx)', display: 'flex', alignItems: 'center', gap: 5 }}><XCircle size={13} /> {tgTestError}</span>}
                    </div>
                  )}
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={()=>setEditModal(false)}>Annuler</button>
                <button type="submit" className="btn btn-primary" disabled={editLoading}>{editLoading?'Sauvegarde…':'Sauvegarder'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmDialog && (
        <ConfirmModal
          message={confirmDialog.message}
          onConfirm={confirmDialog.action}
          onCancel={() => setConfirmDialog(null)}
          danger
        />
      )}
    </div>
  )
}
