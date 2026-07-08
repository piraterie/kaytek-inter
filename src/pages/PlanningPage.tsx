// src/pages/PlanningPage.tsx
import { useRef, useCallback, useState, useMemo, useEffect } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin   from '@fullcalendar/daygrid'
import timeGridPlugin  from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import listPlugin      from '@fullcalendar/list'
import type { EventClickArg, EventDropArg, EventContentArg, DatesSetArg } from '@fullcalendar/core'
import frLocale from '@fullcalendar/core/locales/fr'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle, MapPin, User, Bell, CalendarDays, Car, Clock,
  CheckCircle2, ChevronUp, ChevronDown,
} from 'lucide-react'
import { useInterventions, useUpdateIntervention, useIsMobile } from '@/lib/hooks'
import { useAuthStore, useToastStore } from '@/lib/store'
import { supabase } from '@/lib/supabase/client'
import type { Intervention } from '@/types'

// ── Couleurs statuts ──────────────────────────────────────────────
// Clés liées aux variables CSS sémantiques (--rd/--or/--am/--bl/--pu/--gn/--gr)
// qui s'adaptent automatiquement au thème clair / sombre.
type StatusKey = 'rd' | 'or' | 'am' | 'bl' | 'pu' | 'gn' | 'gr'

const STATUS_VAR: Record<StatusKey, string> = {
  rd: '--rd', or: '--or', am: '--am', bl: '--bl', pu: '--pu', gn: '--gn', gr: '--gr',
}
const STATUS_KEY: Record<string, StatusKey> = {
  en_attente: 'am',
  accepte:    'bl',
  en_cours:   'pu',
  termine:    'gn',
  annule:     'gr',
  refuse:     'gr',
  facture:    'gn',
}
const STATUS_LABEL: Record<string, string> = {
  en_attente: 'En attente',
  accepte:    'Accepté',
  en_cours:   'En cours',
  termine:    'Terminé',
  annule:     'Annulé',
  refuse:     'Refusé',
  facture:    'Facturé',
}
const STATUS_PILL: Record<string, string> = {
  en_attente: 'pill-amber',
  accepte:    'pill-blue',
  en_cours:   'pill-purple',
  termine:    'pill-green',
  annule:     'pill-gray',
  refuse:     'pill-gray',
  facture:    'pill-green',
}

// ── Statut dynamique (urgence + timing) — cohérent avec la légende ──
function getEventStatusKey(i: Intervention): StatusKey {
  if (i.statut === 'annule' || i.statut === 'refuse') return 'gr'
  if (i.statut === 'termine' || i.statut === 'facture') return 'gn'
  if (i.urgence) return 'rd'
  if (i.date_prevue) {
    const dp   = new Date(i.date_prevue)
    const now  = new Date()
    const diff = dp.getTime() - now.getTime()
    const h2   = 2 * 60 * 60 * 1000
    if (diff > 0 && diff <= h2)  return 'or' // < 2h → orange foncé
    if (diff < 0 && ['en_attente', 'accepte', 'en_cours'].includes(i.statut))
      return 'rd'                             // en retard → rouge
  }
  return STATUS_KEY[i.statut] ?? 'gr'
}

// ── Nom client ────────────────────────────────────────────────────
function clientLabel(i: Intervention): string {
  return i.client
    ? `${i.client.prenom ?? ''} ${i.client.nom ?? ''}`.trim()
    : `Intervention ${i.numero}`
}

// ── EventCard ─────────────────────────────────────────────────────
function EventCard({ info, isMobile }: { info: EventContentArg; isMobile: boolean }) {
  const i         = info.event.extendedProps.intervention as Intervention
  const statusKey = info.event.extendedProps.statusKey as StatusKey
  const dotColor  = `var(${STATUS_VAR[statusKey]})`
  const isMonth   = info.view.type === 'dayGridMonth'
  const isList    = info.view.type.startsWith('list')
  const isDay     = info.view.type === 'timeGridDay'
  const name      = clientLabel(i)
  const heure     = i.date_prevue
    ? new Date(i.date_prevue).toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' })
    : null

  if (isMonth) {
    // Mobile : 7 colonnes sur un écran étroit ne laissent pas la place pour
    // "heure + nom" sur une seule ligne → badge 2 lignes (heure au-dessus,
    // nom tronqué en dessous) pour ne jamais perdre l'un des deux.
    if (isMobile) {
      return (
        <div style={{ width:'100%', padding:'2px 4px', overflow:'hidden' }}>
          <div style={{ display:'flex', alignItems:'center', gap:3 }}>
            <div style={{ width:6, height:6, borderRadius:'50%', background:dotColor, flexShrink:0 }} />
            {heure && <span style={{ fontSize:8.5, fontWeight:700, color:'inherit', opacity:.8, flexShrink:0 }}>{heure}</span>}
            {i?.urgence && <AlertTriangle size={9} color="var(--rd)" style={{ flexShrink:0 }} />}
          </div>
          <div style={{ fontSize:10, fontWeight:700, color:'inherit', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginTop:1 }}>
            {name}
          </div>
        </div>
      )
    }
    return (
      <div style={{ width:'100%', padding:'2px 6px', display:'flex', alignItems:'center', gap:4, overflow:'hidden' }}>
        <div style={{ width:7, height:7, borderRadius:'50%', background:dotColor, flexShrink:0 }} />
        {/* flex:1 + minWidth:0 — indispensable pour que l'ellipsis tronque proprement
            au lieu de faire disparaître tout le texte dans une cellule étroite */}
        <span style={{ flex:1, minWidth:0, fontSize:11, fontWeight:700, color:'inherit', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {name}
        </span>
        {i?.urgence && <AlertTriangle size={10} color="var(--rd)" style={{ flexShrink:0 }} />}
      </div>
    )
  }

  if (isList) {
    return (
      <div style={{ padding:'2px 0', display:'flex', alignItems:'center', gap:8 }}>
        <div style={{ width:8, height:8, borderRadius:'50%', background:dotColor, flexShrink:0 }} />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontWeight:600, fontSize:13, color:'var(--t0)', display:'flex', alignItems:'center', gap:5, flexWrap:'wrap' }}>
            {heure && <span style={{ fontSize:11, color:'var(--t2)', fontWeight:500, flexShrink:0 }}>{heure}</span>}
            {i?.urgence && <AlertTriangle size={11} color="var(--rd)" style={{ flexShrink:0 }} />}
            <span style={{ flex:'1 1 auto', minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</span>
          </div>
          {i?.adresse && (
            <div style={{ fontSize:11, color:'var(--t2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', display:'flex', alignItems:'center', gap:4 }}>
              <MapPin size={10} style={{ flexShrink:0 }} /> {i.adresse}{i.ville ? ` · ${i.ville}` : ''}
            </div>
          )}
          {i?.intervenant && (
            <div style={{ fontSize:11, color:'var(--t3)', display:'flex', alignItems:'center', gap:4 }}>
              <User size={10} style={{ flexShrink:0 }} /> {i.intervenant.prenom} {i.intervenant.nom}
            </div>
          )}
          {isMobile && (
            <span className={`pill ${STATUS_PILL[i.statut] ?? 'pill-gray'}`} style={{ fontSize:9.5, marginTop:4 }}>
              {STATUS_LABEL[i.statut]}
            </span>
          )}
        </div>
        {i?.montant_ttc ? (
          <span style={{ fontSize:11, fontWeight:700, color:'var(--t2)', flexShrink:0 }}>
            {i.montant_ttc.toLocaleString('fr-FR', { style:'currency', currency:'EUR', maximumFractionDigits:0 })}
          </span>
        ) : null}
      </div>
    )
  }

  // timeGrid (jour / semaine)
  // flexShrink:0 sur chaque ligne — sans ça, un événement court (peu de hauteur
  // disponible) écrase le texte à quelques pixels au lieu de couper proprement
  // les dernières lignes (comportement par défaut de flexbox avec overflow:hidden).
  return (
    <div style={{ padding:'4px 6px', height:'100%', display:'flex', flexDirection:'column', gap:1, overflow:'hidden', borderLeft:`3px solid ${dotColor}` }}>
      <div style={{ fontWeight:700, fontSize: isMobile ? 12.5 : 12, color:'inherit', display:'flex', alignItems:'center', gap:4, minWidth:0, flexShrink:0 }}>
        {heure && <span style={{ opacity:.85, flexShrink:0 }}>{heure}</span>}
        {i?.urgence && <AlertTriangle size={10} style={{ flexShrink:0 }} />}
        <span style={{ flex:'1 1 auto', minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</span>
      </div>
      {i?.adresse && (
        <div style={{ fontSize: isMobile ? 11 : 10, color:'inherit', opacity:.8, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flexShrink:0, display:'flex', alignItems:'center', gap:3 }}>
          <MapPin size={9} style={{ flexShrink:0 }} /> {i.adresse}
        </div>
      )}
      {i?.intervenant && (
        <div style={{ fontSize: isMobile ? 11 : 10, color:'inherit', opacity:.7, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flexShrink:0, display:'flex', alignItems:'center', gap:3 }}>
          <User size={9} style={{ flexShrink:0 }} /> {i.intervenant.prenom} {i.intervenant.nom}
        </div>
      )}
      {isMobile && isDay && (
        <span className={`pill ${STATUS_PILL[i.statut] ?? 'pill-gray'}`} style={{ fontSize:9.5, marginTop:3, alignSelf:'flex-start', flexShrink:0 }}>
          {STATUS_LABEL[i.statut]}
        </span>
      )}
      {i?.montant_ttc ? (
        <div style={{ fontSize: isMobile ? 11 : 10, color:'inherit', opacity:.8, marginTop:'auto', fontWeight:700, flexShrink:0 }}>
          {i.montant_ttc.toLocaleString('fr-FR', { style:'currency', currency:'EUR', maximumFractionDigits:0 })}
        </div>
      ) : null}
    </div>
  )
}

// ── Légende ───────────────────────────────────────────────────────
function Legend() {
  const entries: { key: StatusKey; label: string }[] = [
    { key:'rd', label:'Urgent / en retard' },
    { key:'or', label:'< 2h' },
    { key:'am', label:'En attente' },
    { key:'bl', label:'Accepté' },
    { key:'pu', label:'En cours' },
    { key:'gn', label:'Terminé / Facturé' },
    { key:'gr', label:'Annulé / Refusé' },
  ]
  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:'5px 12px', padding:'0 0 12px' }}>
      {entries.map(e => (
        <div key={e.key} style={{ display:'flex', alignItems:'center', gap:4 }}>
          <div style={{ width:9, height:9, borderRadius:'50%', background:`var(${STATUS_VAR[e.key]})`, flexShrink:0 }} />
          <span style={{ fontSize:11, color:'var(--t2)', fontWeight:500 }}>{e.label}</span>
        </div>
      ))}
    </div>
  )
}

// ── Carte intervention (blocs du jour / à venir) ──────────────────
interface BadgeInfo { label: string; color: string }

function InterventionRow({
  intervention: i, badge, onClick,
}: { intervention: Intervention; badge?: BadgeInfo; onClick: () => void }) {
  const name  = clientLabel(i)
  const heure = i.date_prevue
    ? new Date(i.date_prevue).toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' })
    : null
  const anyReminderSent = !!(i.rappel_24h_envoye_at || i.rappel_2h_envoye_at || i.rappel_30min_envoye_at)

  return (
    <div
      className="planning-row"
      onClick={onClick}
      style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'10px 14px',
                borderBottom:'1px solid var(--b0)', cursor:'pointer' }}
    >
      {/* Heure */}
      {heure && (
        <div style={{ fontSize:13, fontWeight:700, color:'var(--t2)', flexShrink:0, minWidth:38, paddingTop:2 }}>
          {heure}
        </div>
      )}
      {/* Infos */}
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontWeight:600, fontSize:14, color:'var(--t0)', display:'flex', alignItems:'center', gap:5, flexWrap:'wrap' }}>
          {i.urgence && <AlertTriangle size={13} color="var(--rd)" />}
          <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</span>
        </div>
        {i.adresse && (
          <div style={{ fontSize:12, color:'var(--t2)', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', display:'flex', alignItems:'center', gap:4 }}>
            <MapPin size={11} style={{ flexShrink:0 }} /> {i.adresse}{i.ville ? `, ${i.ville}` : ''}
          </div>
        )}
        {i.intervenant && (
          <div style={{ fontSize:11, color:'var(--t3)', marginTop:1, display:'flex', alignItems:'center', gap:4 }}>
            <User size={10} style={{ flexShrink:0 }} /> {i.intervenant.prenom} {i.intervenant.nom}
          </div>
        )}
      </div>
      {/* Badges */}
      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4, flexShrink:0 }}>
        {badge && (
          <span style={{
            fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:12,
            background: badge.color + '20', color: badge.color, border:`1px solid ${badge.color}40`,
            whiteSpace:'nowrap',
          }}>
            {badge.label}
          </span>
        )}
        <span className={`pill ${STATUS_PILL[i.statut] ?? 'pill-gray'}`} style={{ fontSize:10 }}>
          {STATUS_LABEL[i.statut]}
        </span>
        {anyReminderSent && (
          <span style={{ fontSize:10, color:'var(--gnTx)', display:'flex', alignItems:'center', gap:3 }}>
            <Bell size={10} /> rappel envoyé
          </span>
        )}
        {i.montant_ttc ? (
          <span style={{ fontSize:11, fontWeight:600, color:'var(--t2)' }}>
            {i.montant_ttc.toLocaleString('fr-FR', { style:'currency', currency:'EUR', maximumFractionDigits:0 })}
          </span>
        ) : null}
      </div>
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────
export default function PlanningPage() {
  const nav      = useNavigate()
  const { add }  = useToastStore()
  const { user } = useAuthStore()
  const isAdmin  = user?.role === 'admin'
  const canManageOps = isAdmin || user?.role === 'assistant'
  const isMobile = useIsMobile()
  const calRef   = useRef<FullCalendar>(null)

  type ViewType = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'listWeek'
  const [calTitle, setCalTitle] = useState('')
  const [calView,  setCalView]  = useState<ViewType>(isMobile ? 'dayGridMonth' : 'timeGridWeek')

  const handleDatesSet = useCallback((arg: DatesSetArg) => {
    setCalTitle(arg.view.title)
    setCalView(arg.view.type as ViewType)
  }, [])

  const goPrev   = useCallback(() => calRef.current?.getApi().prev(), [])
  const goNext   = useCallback(() => calRef.current?.getApi().next(), [])
  const goToday  = useCallback(() => calRef.current?.getApi().today(), [])
  const changeView = useCallback((v: ViewType) => calRef.current?.getApi().changeView(v), [])

  const [showToday,     setShowToday]     = useState(true)
  const [showUpcoming,  setShowUpcoming]  = useState(true)
  const [checkingRappels, setCheckingRappels] = useState(false)

  const { data: interventions = [], isLoading } = useInterventions()
  const updateIntervention = useUpdateIntervention()

  // ── Calculs dashboard ──────────────────────────────────────────
  const now = useMemo(() => new Date(), [])

  const { stats, todayList, aVenir } = useMemo(() => {
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const todayEnd   = new Date(todayStart.getTime() + 86_400_000)
    const weekEnd    = new Date(todayStart.getTime() + 7 * 86_400_000)
    const tomorrowEnd = new Date(todayEnd.getTime() + 86_400_000)

    const todayList = interventions
      .filter(i => i.date_prevue && new Date(i.date_prevue) >= todayStart && new Date(i.date_prevue) < todayEnd)
      .sort((a, b) => new Date(a.date_prevue!).getTime() - new Date(b.date_prevue!).getTime())

    const lateCount = interventions.filter(i => {
      if (!i.date_prevue) return false
      return new Date(i.date_prevue) < todayStart &&
             !['termine', 'annule', 'refuse', 'facture'].includes(i.statut)
    }).length

    const doneCount = interventions.filter(i =>
      ['termine', 'facture'].includes(i.statut)
    ).length

    const upcomingFuture = interventions.filter(i => {
      if (!i.date_prevue) return false
      if (['annule', 'refuse', 'termine', 'facture'].includes(i.statut)) return false
      const dp = new Date(i.date_prevue)
      return dp > now && dp < weekEnd
    }).sort((a, b) => new Date(a.date_prevue!).getTime() - new Date(b.date_prevue!).getTime())

    const aVenir = upcomingFuture.map(i => {
      const dp   = new Date(i.date_prevue!)
      const diff = dp.getTime() - now.getTime()
      const h30  = 30 * 60_000
      const h2   = 2 * 3_600_000
      let badge: BadgeInfo
      if (diff <= h30)          badge = { label: '< 30 min',       color: '#DC2626' }
      else if (diff <= h2)      badge = { label: '< 2h',           color: '#EA580C' }
      else if (dp < todayEnd)   badge = { label: "Aujourd'hui",    color: '#D97706' }
      else if (dp < tomorrowEnd)badge = { label: 'Demain',          color: '#2563EB' }
      else                      badge = { label: 'Cette semaine',   color: '#7C3AED' }
      return { intervention: i, badge }
    })

    return {
      stats: {
        today:    todayList.length,
        upcoming: upcomingFuture.filter(i => new Date(i.date_prevue!) >= todayEnd).length,
        late:     lateCount,
        done:     doneCount,
      },
      todayList,
      aVenir,
    }
  }, [interventions, now])

  // ── Événements FullCalendar ────────────────────────────────────
  const events = useMemo(() =>
    interventions
      .filter(i => i.date_prevue || i.date_debut)
      .map(i => {
        const statusKey = getEventStatusKey(i)
        return {
          id:    i.id,
          title: clientLabel(i),
          start: i.date_prevue || i.date_debut,
          end:   i.date_fin    || undefined,
          borderColor: `var(${STATUS_VAR[statusKey]})`,
          classNames: [`ev-${statusKey}`],
          extendedProps: { intervention: i, statusKey },
        }
      }),
  [interventions])

  // ── Handlers ──────────────────────────────────────────────────
  const handleEventClick = useCallback((info: EventClickArg) => {
    nav(`/interventions/${info.event.id}`)
  }, [nav])

  const handleDateClick = useCallback((info: { date: Date }) => {
    const cal = calRef.current?.getApi()
    if (cal?.view.type === 'dayGridMonth') {
      cal.changeView('timeGridDay', info.date)
    }
  }, [])

  const handleEventDrop = useCallback(async (info: EventDropArg) => {
    if (!canManageOps) {
      info.revert()
      add('Seul un admin ou un assistant peut modifier le planning', 'warning')
      return
    }
    const newDate = info.event.start?.toISOString()
    if (!newDate) { info.revert(); return }
    try {
      await updateIntervention.mutateAsync({ id: info.event.id, date_prevue: newDate })
      add('Planning mis à jour', 'success')
    } catch {
      info.revert()
      add('Erreur lors du déplacement', 'error')
    }
  }, [canManageOps, updateIntervention, add])

  // ── Vérification des rappels ───────────────────────────────────
  const checkRappels = useCallback(async (silent = false) => {
    if (!isAdmin) return
    if (!silent) setCheckingRappels(true)
    try {
      const { data } = await supabase.functions.invoke('send-reminders', {})
      if (!silent) {
        const n = data?.sent ?? 0
        add(n > 0 ? `${n} rappel${n > 1 ? 's' : ''} envoyé${n > 1 ? 's' : ''}` : 'Aucun rappel à envoyer')
      }
    } catch (err: any) {
      if (!silent) add(err.message ?? 'Erreur vérification rappels', 'error')
    }
    if (!silent) setCheckingRappels(false)
  }, [isAdmin, add])

  // Auto-check silencieux à l'ouverture de la page (admin uniquement)
  useEffect(() => {
    if (isAdmin) checkRappels(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="planning-page">
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><CalendarDays size={22} /> Planning</div>
          <div className="page-subtitle">
            {interventions.length} intervention{interventions.length > 1 ? 's' : ''} planifiée{interventions.length > 1 ? 's' : ''}
          </div>
        </div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          {isAdmin && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => checkRappels(false)}
              disabled={checkingRappels}
              title="Vérifier et envoyer les rappels automatiques"
            >
              {checkingRappels ? '…' : <><Bell size={14} /> Rappels</>}
            </button>
          )}
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => calRef.current?.getApi().today()}
          >
            Aujourd'hui
          </button>
        </div>
      </div>

      {/* ── Statistiques ──────────────────────────────────────── */}
      <div className="planning-stats">
        <div className="planning-stat">
          <div className="planning-stat-value">{stats.today}</div>
          <div className="planning-stat-label"><CalendarDays size={11} style={{ verticalAlign: 'text-bottom', marginRight: 3 }} />Aujourd'hui</div>
        </div>
        <div className="planning-stat">
          <div className="planning-stat-value">{stats.upcoming}</div>
          <div className="planning-stat-label"><Car size={11} style={{ verticalAlign: 'text-bottom', marginRight: 3 }} />À venir</div>
        </div>
        <div className="planning-stat" style={stats.late > 0 ? { borderColor:'var(--rdBd)' } : {}}>
          <div className="planning-stat-value" style={stats.late > 0 ? { color:'#DC2626' } : {}}>
            {stats.late}
          </div>
          <div className="planning-stat-label"><Clock size={11} style={{ verticalAlign: 'text-bottom', marginRight: 3 }} />En retard</div>
        </div>
        <div className="planning-stat">
          <div className="planning-stat-value" style={{ color:'#16A34A' }}>{stats.done}</div>
          <div className="planning-stat-label"><CheckCircle2 size={11} style={{ verticalAlign: 'text-bottom', marginRight: 3 }} />Terminées</div>
        </div>
      </div>

      {/* ── Interventions du jour ─────────────────────────────── */}
      {todayList.length > 0 && (
        <div className="planning-section card" style={{ marginBottom:12, padding:0, overflow:'hidden' }}>
          <button
            className="planning-section-header"
            onClick={() => setShowToday(v => !v)}
            style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between',
                     padding:'10px 14px', background:'none', border:'none', borderBottom: showToday ? '1px solid var(--b0)' : 'none',
                     cursor:'pointer', fontWeight:600, fontSize:14, color:'var(--t0)' }}
          >
            <span>Aujourd'hui — {todayList.length} intervention{todayList.length > 1 ? 's' : ''}</span>
            <span style={{ fontSize:12, color:'var(--t3)', display: 'flex' }}>{showToday ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
          </button>
          {showToday && todayList.map(i => (
            <InterventionRow
              key={i.id}
              intervention={i}
              onClick={() => nav(`/interventions/${i.id}`)}
            />
          ))}
        </div>
      )}

      {/* ── À venir ───────────────────────────────────────────── */}
      {aVenir.length > 0 && (
        <div className="planning-section card" style={{ marginBottom:12, padding:0, overflow:'hidden' }}>
          <button
            className="planning-section-header"
            onClick={() => setShowUpcoming(v => !v)}
            style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between',
                     padding:'10px 14px', background:'none', border:'none', borderBottom: showUpcoming ? '1px solid var(--b0)' : 'none',
                     cursor:'pointer', fontWeight:600, fontSize:14, color:'var(--t0)' }}
          >
            <span>À venir — {aVenir.length} intervention{aVenir.length > 1 ? 's' : ''}</span>
            <span style={{ fontSize:12, color:'var(--t3)', display: 'flex' }}>{showUpcoming ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
          </button>
          {showUpcoming && aVenir.map(({ intervention: i, badge }) => (
            <InterventionRow
              key={i.id}
              intervention={i}
              badge={badge}
              onClick={() => nav(`/interventions/${i.id}`)}
            />
          ))}
        </div>
      )}

      <Legend />

      {/* ── FullCalendar ──────────────────────────────────────── */}
      {isLoading ? (
        <div style={{ textAlign:'center', padding:'48px 0', color:'var(--t3)' }}>
          Chargement du planning…
        </div>
      ) : (
        <div className="card kaytek-planning" style={{ padding: isMobile ? 6 : 16 }}>
          {/* Toolbar mobile : 3 lignes distinctes pour ne jamais chevaucher */}
          {isMobile && (
            <div className="planning-mobile-toolbar">
              <div className="pmt-nav">
                <button type="button" className="pmt-navbtn" onClick={goPrev} aria-label="Période précédente">‹</button>
                <button type="button" className="pmt-today" onClick={goToday}>Aujourd'hui</button>
                <button type="button" className="pmt-navbtn" onClick={goNext} aria-label="Période suivante">›</button>
              </div>
              <div className="pmt-title">{calTitle}</div>
              <div className="pmt-views">
                {([
                  ['dayGridMonth', 'Mois'],
                  ['timeGridWeek', 'Semaine'],
                  ['timeGridDay',  'Jour'],
                  ['listWeek',     'Liste'],
                ] as [ViewType, string][]).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    className={`pmt-viewbtn${calView === v ? ' active' : ''}`}
                    onClick={() => changeView(v)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <FullCalendar
            ref={calRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
            initialView={isMobile ? 'dayGridMonth' : 'timeGridWeek'}
            locale={frLocale}
            headerToolbar={isMobile ? false : {
              left:   'prev,next today',
              center: 'title',
              right:  'dayGridMonth,timeGridWeek,timeGridDay,listWeek',
            }}
            // Mobile : la vue "Semaine" affiche une fenêtre de 3 jours glissante plutôt
            // que 7 colonnes compressées — chaque colonne reste large et lisible sans
            // scroll horizontal ni dépendance au plugin premium @fullcalendar/scrollgrid.
            views={isMobile ? { timeGridWeek: { type:'timeGrid', duration:{ days:3 } } } : undefined}
            buttonText={{
              today:        "Aujourd'hui",
              month:        'Mois',
              week:         'Semaine',
              day:          'Jour',
              listWeek:     'Liste',
              timeGridDay:  'Jour',
              timeGridWeek: 'Semaine',
            }}
            events={events}
            editable={canManageOps}
            droppable={canManageOps}
            eventDrop={handleEventDrop}
            eventClick={handleEventClick}
            dateClick={handleDateClick}
            datesSet={handleDatesSet}
            eventContent={(info: EventContentArg) => <EventCard info={info} isMobile={isMobile} />}
            moreLinkClick="day"
            moreLinkText={n => `+ ${n} autre${n > 1 ? 's' : ''}`}
            dayMaxEvents={isMobile ? 2 : 4}
            height={isMobile ? 'auto' : 'calc(100dvh - 200px)'}
            slotMinTime="07:00:00"
            slotMaxTime="21:00:00"
            slotDuration="00:30:00"
            expandRows={!isMobile}
            nowIndicator
            weekends
            firstDay={1}
            allDaySlot={false}
            eventMinHeight={isMobile ? 64 : 32}
            listDayFormat={{ weekday:'long', day:'numeric', month:'long' }}
            listDaySideFormat={false}
            noEventsContent="Aucune intervention planifiée"
          />
        </div>
      )}
    </div>
  )
}
