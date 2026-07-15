// src/pages/ClientDetailPage.tsx
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Archive, Zap, Calendar, FileText, Euro, Plus,
  Phone, MessageCircle, MapPin, Copy,
} from 'lucide-react'
import { useClient } from '@/lib/hooks'
import { useToastStore } from '@/lib/store'
import { supabase } from '@/lib/supabase/client'
import { DocSheet, SheetRow } from '@/components/DocSheet'

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const nav = useNavigate()
  const { add } = useToastStore()
  const { data: client, isLoading } = useClient(id!)
  const [counts, setCounts] = useState({ interventions: 0, devis: 0, factures: 0 })
  const [actionsSheet, setActionsSheet] = useState(false)

  useEffect(() => {
    if (!id) return
    Promise.all([
      supabase.from('interventions').select('id', { count: 'exact', head: true }).eq('client_id', id),
      supabase.from('devis').select('id', { count: 'exact', head: true }).eq('client_id', id),
      supabase.from('factures').select('id', { count: 'exact', head: true }).eq('client_id', id),
    ]).then(([i, d, f]) => setCounts({
      interventions: i.count || 0,
      devis: d.count || 0,
      factures: f.count || 0,
    }))
  }, [id])

  if (isLoading) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--t3)' }}>Chargement…</div>
  if (!client) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--rdTx)' }}>Client introuvable</div>

  const tel = client.telephone
  const addrParts = [client.adresse_intervention, client.cp_intervention, client.ville_intervention].filter(Boolean)
  const addrFull = addrParts.join(' ')
  const wazeUrl = `https://waze.com/ul?q=${encodeURIComponent(addrFull)}&navigate=yes`

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4" style={{ flexWrap: 'wrap' }}>
        <button className="btn-icon" onClick={() => nav('/clients')}><ArrowLeft size={16} /></button>
        <div>
          <h1 className="page-title">{client.nom}{client.prenom ? ` ${client.prenom}` : ''}</h1>
          <p className="page-subtitle">
            {client.type}{client.raison_sociale ? ` · ${client.raison_sociale}` : ''}
          </p>
        </div>
        {client.archive && (
          <span className="pill pill-amber" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Archive size={11} /> Archivé</span>
        )}
      </div>

      {/* Fiche info */}
      <div className="card card-body mb-4">
        {([
          ['Téléphone', client.telephone || '—'],
          ['Email', client.email || '—'],
          ['Adresse', addrFull || '—'],
          ...(client.notes_internes ? [['Notes internes', client.notes_internes]] : []),
        ] as [string, string][]).map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--b0)', fontSize: 12 }}>
            <span style={{ color: 'var(--t2)' }}>{k}</span>
            <span style={{ fontWeight: 500, textAlign: 'right', maxWidth: '60%' }}>{v}</span>
          </div>
        ))}
      </div>

      {/* ACTIONS RAPIDES */}
      {(tel || addrFull) && (
        <div className="card card-body mb-4" style={{ padding: '12px 14px' }}>
          <button
            className="btn btn-secondary"
            style={{ width: '100%', justifyContent: 'center', gap: 8, minHeight: 48, fontWeight: 600 }}
            onClick={() => setActionsSheet(true)}
          >
            <Zap size={15} /> Actions
          </button>
        </div>
      )}

      {/* HISTORIQUE CLIENT */}
      <div className="card card-body" style={{ padding: '12px 14px' }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--t2)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Historique client</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button className="btn btn-secondary" style={{ justifyContent: 'flex-start' }}
            onClick={() => nav('/interventions')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Calendar size={14} /> Voir les interventions</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, background: 'var(--b1)', borderRadius: 10, padding: '2px 8px', color: 'var(--t2)' }}>
              {counts.interventions}
            </span>
          </button>
          <button className="btn btn-secondary" style={{ justifyContent: 'flex-start' }}
            onClick={() => nav('/devis')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><FileText size={14} /> Voir les devis</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, background: 'var(--b1)', borderRadius: 10, padding: '2px 8px', color: 'var(--t2)' }}>
              {counts.devis}
            </span>
          </button>
          <button className="btn btn-secondary" style={{ justifyContent: 'flex-start' }}
            onClick={() => nav('/factures')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Euro size={14} /> Voir les factures</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, background: 'var(--b1)', borderRadius: 10, padding: '2px 8px', color: 'var(--t2)' }}>
              {counts.factures}
            </span>
          </button>
          <button className="btn btn-primary" style={{ justifyContent: 'flex-start' }}
            onClick={() => nav('/interventions')}>
            <Plus size={14} /> Créer une nouvelle intervention
          </button>
        </div>
      </div>

      {/* Actions sheet */}
      {actionsSheet && (
        <DocSheet
          title="Actions"
          subtitle={[client.nom, client.prenom].filter(Boolean).join(' ')}
          onClose={() => setActionsSheet(false)}
        >
          {tel && (
            <SheetRow icon={<Phone size={16} />} label="Appeler" sublabel={tel}
              onClick={() => { setActionsSheet(false); window.location.href = `tel:${tel}` }} />
          )}
          {tel && (
            <SheetRow icon={<MessageCircle size={16} />} label="Envoyer un SMS" sublabel={tel}
              onClick={() => { setActionsSheet(false); window.location.href = `sms:${tel}` }} />
          )}
          {addrFull && (
            <SheetRow icon={<MapPin size={16} />} label="Ouvrir dans Waze" sublabel={addrFull}
              onClick={() => { setActionsSheet(false); window.open(wazeUrl, '_blank') }} />
          )}
          {addrFull && (
            <SheetRow icon={<Copy size={16} />} label="Copier l'adresse" sublabel={addrFull}
              onClick={async () => {
                setActionsSheet(false)
                try { await navigator.clipboard.writeText(addrFull); add('Adresse copiée') }
                catch { add("Impossible de copier l'adresse", 'error') }
              }} />
          )}
        </DocSheet>
      )}
    </div>
  )
}
