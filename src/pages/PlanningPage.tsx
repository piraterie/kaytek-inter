// src/pages/PlanningPage.tsx
import { useRef, useCallback } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import listPlugin from '@fullcalendar/list'
import type { EventClickArg, EventDropArg, EventContentArg } from '@fullcalendar/core'
import frLocale from '@fullcalendar/core/locales/fr'
import { useNavigate } from 'react-router-dom'
import { useInterventions, useUpdateIntervention, useIsMobile } from '@/lib/hooks'
import { useAuthStore, useToastStore } from '@/lib/store'
import type { Intervention } from '@/types'

// ── Couleurs par statut ──────────────────────────────────────
const STATUS_COLOR: Record<string, string> = {
  en_attente:  '#D97706',
  accepte:     '#2563EB',
  en_cours:    '#7C3AED',
  termine:     '#16A34A',
  annule:      '#DC2626',
  refuse:      '#DC2626',
  facture:     '#64748B',
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

// ── Rendu personnalisé des événements ───────────────────────
function EventCard({ info }: { info: EventContentArg }) {
  const i = info.event.extendedProps.intervention as Intervention
  const isMonth = info.view.type === 'dayGridMonth'
  const isList  = info.view.type.startsWith('list')

  if (isMonth) {
    return (
      <div style={{
        width: '100%', padding: '2px 6px',
        display: 'flex', alignItems: 'center', gap: 4,
        overflow: 'hidden',
      }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {i?.client ? `${i.client.prenom || ''} ${i.client.nom || ''}`.trim() : info.event.title}
        </span>
        {i?.urgence && <span style={{ flexShrink: 0, fontSize: 10 }}>🚨</span>}
      </div>
    )
  }

  if (isList) {
    return (
      <div style={{ padding: '2px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[i?.statut] || '#64748B', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--t0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {i?.client ? `${i.client.prenom || ''} ${i.client.nom || ''}`.trim() : info.event.title}
          </div>
          {i?.adresse && (
            <div style={{ fontSize: 11, color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              📍 {i.adresse}{i.ville ? ` · ${i.ville}` : ''}
            </div>
          )}
        </div>
        {i?.montant_ttc && (
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', flexShrink: 0 }}>
            {i.montant_ttc.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}
          </span>
        )}
      </div>
    )
  }

  // Jour / Semaine (timeGrid)
  return (
    <div style={{
      padding: '3px 6px', height: '100%',
      display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden',
    }}>
      <div style={{ fontWeight: 700, fontSize: 12, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
        {i?.urgence && <span style={{ fontSize: 10 }}>🚨</span>}
        {i?.client ? `${i.client.prenom || ''} ${i.client.nom || ''}`.trim() : info.event.title}
      </div>
      {i?.adresse && (
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.82)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          📍 {i.adresse}
        </div>
      )}
      {i?.montant_ttc && (
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.82)', marginTop: 'auto' }}>
          {i.montant_ttc.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}
        </div>
      )}
    </div>
  )
}

// ── Légende des statuts ──────────────────────────────────────
function Legend() {
  const entries = Object.entries(STATUS_LABEL)
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', padding: '0 0 14px' }}>
      {entries.map(([statut, label]) => (
        <div key={statut} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: STATUS_COLOR[statut] }} />
          <span style={{ fontSize: 11, color: 'var(--t2)', fontWeight: 500 }}>{label}</span>
        </div>
      ))}
    </div>
  )
}

// ── Page principale ──────────────────────────────────────────
export default function PlanningPage() {
  const nav = useNavigate()
  const { add } = useToastStore()
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const isMobile = useIsMobile()
  const calRef = useRef<FullCalendar>(null)

  const { data: interventions = [], isLoading } = useInterventions()
  const updateIntervention = useUpdateIntervention()

  // Conversion interventions → événements FullCalendar
  const events = interventions
    .filter(i => i.date_prevue || i.date_debut)
    .map(i => {
      const start = i.date_prevue || i.date_debut
      const color = STATUS_COLOR[i.statut] || '#64748B'
      const clientName = i.client
        ? `${i.client.prenom || ''} ${i.client.nom || ''}`.trim()
        : `Intervention ${i.numero}`
      return {
        id: i.id,
        title: clientName || i.numero,
        start,
        end: i.date_fin || undefined,
        color,
        borderColor: color,
        textColor: '#fff',
        extendedProps: { intervention: i },
      }
    })

  const handleEventClick = useCallback((info: EventClickArg) => {
    nav(`/interventions/${info.event.id}`)
  }, [nav])

  const handleEventDrop = useCallback(async (info: EventDropArg) => {
    if (!isAdmin) {
      info.revert()
      add('Seul un admin peut modifier le planning', 'warning')
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
  }, [isAdmin, updateIntervention, add])

  const initialView = isMobile ? 'listWeek' : 'timeGridWeek'

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">📅 Planning</div>
          <div className="page-subtitle">
            {interventions.length} intervention{interventions.length > 1 ? 's' : ''} planifiée{interventions.length > 1 ? 's' : ''}
          </div>
        </div>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => calRef.current?.getApi().today()}
        >
          Aujourd'hui
        </button>
      </div>

      <Legend />

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--t3)' }}>
          Chargement du planning…
        </div>
      ) : (
        <div className="card kaytek-planning" style={{ padding: isMobile ? 8 : 16 }}>
          <FullCalendar
            ref={calRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
            initialView={initialView}
            locale={frLocale}
            headerToolbar={{
              left:   isMobile ? 'prev,next' : 'prev,next today',
              center: 'title',
              right:  isMobile
                ? 'listWeek,timeGridDay'
                : 'dayGridMonth,timeGridWeek,timeGridDay,listWeek',
            }}
            buttonText={{
              today:        "Aujourd'hui",
              month:        'Mois',
              week:         'Semaine',
              day:          'Jour',
              list:         'Liste',
              listWeek:     'Liste',
              timeGridDay:  'Jour',
              timeGridWeek: 'Semaine',
            }}
            events={events}
            editable={isAdmin}
            droppable={isAdmin}
            eventDrop={handleEventDrop}
            eventClick={handleEventClick}
            eventContent={(info) => <EventCard info={info} />}
            dayMaxEvents={isMobile ? 2 : 4}
            height={isMobile ? 'auto' : 'calc(100dvh - 280px)'}
            slotMinTime="07:00:00"
            slotMaxTime="21:00:00"
            slotDuration="00:30:00"
            expandRows={!isMobile}
            nowIndicator
            weekends
            firstDay={1}
            allDaySlot={false}
            eventMinHeight={32}
            listDayFormat={{ weekday: 'long', day: 'numeric', month: 'long' }}
            listDaySideFormat={false}
            noEventsContent="Aucune intervention planifiée"
          />
        </div>
      )}
    </div>
  )
}
