// src/components/ClientAutocomplete.tsx
// Champ de recherche client avec suggestions, remplace l'ancien menu
// déroulant (CustomSelect) sur la page "Créer un devis". Filtre côté
// client sur prénom/nom uniquement (la liste `clients` reçue en props est
// déjà scoping par organisation via useClients()/RLS — ce composant ne
// refait aucun appel réseau). La sélection ne se déclenche que sur un
// clic/tap volontaire : un simple défilement tactile de la liste ne doit
// jamais sélectionner un client (voir handleSuggestionPointerUp — un
// mouvement de pointeur au-delà de DRAG_THRESHOLD entre pointerdown et
// pointerup est traité comme un scroll et annule le clic qui suit).
import { useState, useRef, useEffect, useMemo } from 'react'
import type { Client } from '@/types'

const MAX_SUGGESTIONS = 10
const DRAG_THRESHOLD = 10

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

function fullName(c: Client): string {
  return [c.prenom, c.nom].filter(Boolean).join(' ')
}

interface Props {
  clients: Client[]
  value: string
  onSelect: (client: Client | null) => void
  placeholder?: string
  disabled?: boolean
}

export function ClientAutocomplete({ clients, value, onSelect, placeholder = 'Rechercher un client (prénom, nom)…', disabled }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const suppressClick = useRef(false)

  const selected = clients.find(c => c.id === value) || null

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const suggestions = useMemo(() => {
    const q = normalize(query)
    if (!q) return []
    return clients
      .filter(c => normalize(c.prenom || '').includes(q) || normalize(c.nom || '').includes(q))
      .slice(0, MAX_SUGGESTIONS)
  }, [clients, query])

  function handleSelect(c: Client) {
    onSelect(c)
    setQuery('')
    setOpen(false)
  }

  function handleClear() {
    onSelect(null)
    setQuery('')
    setOpen(true)
  }

  function handleSuggestionPointerDown(e: React.PointerEvent) {
    dragStart.current = { x: e.clientX, y: e.clientY }
  }

  function handleSuggestionPointerUp(e: React.PointerEvent) {
    const start = dragStart.current
    dragStart.current = null
    if (!start) return
    const dx = Math.abs(e.clientX - start.x)
    const dy = Math.abs(e.clientY - start.y)
    // Mouvement significatif entre pointerdown et pointerup = défilement,
    // pas un tap : on bloque le "click" de synthèse qui suivrait.
    suppressClick.current = dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD
  }

  function handleSuggestionClick(c: Client) {
    if (suppressClick.current) { suppressClick.current = false; return }
    handleSelect(c)
  }

  if (selected) {
    return (
      <div ref={containerRef} style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, padding: '0 8px 0 13px', border: '1px solid var(--b1)', borderRadius: 'var(--r)', background: 'var(--s0)' }}>
          <span style={{ flex: 1, fontSize: 14, color: 'var(--t0)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {fullName(selected)}
          </span>
          {!disabled && (
            <button
              type="button"
              onClick={handleClear}
              aria-label="Effacer la sélection du client"
              title="Changer de client"
              style={{ border: 'none', background: 'none', color: 'var(--t3)', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: 6, flexShrink: 0, borderRadius: 8 }}
            >✕</button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-autocomplete="list"
        aria-controls="client-autocomplete-list"
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => { if (query) setOpen(true) }}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <div id="client-autocomplete-list" role="listbox" style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'var(--s0)', border: '1px solid var(--b1)', borderRadius: 'var(--r2)',
          boxShadow: 'var(--sh1)', zIndex: 9999, overflow: 'hidden', maxHeight: 280, overflowY: 'auto',
        }}>
          {suggestions.map((c, i) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={false}
              onPointerDown={handleSuggestionPointerDown}
              onPointerUp={handleSuggestionPointerUp}
              onClick={() => handleSuggestionClick(c)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '10px 14px', border: 'none', background: 'none',
                cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 14, fontWeight: 500, color: 'var(--t0)',
                borderBottom: i < suggestions.length - 1 ? '1px solid var(--b0)' : 'none',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--s1)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              {fullName(c)}
            </button>
          ))}
        </div>
      )}
      {open && query && suggestions.length === 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'var(--s0)', border: '1px solid var(--b1)', borderRadius: 'var(--r2)',
          boxShadow: 'var(--sh1)', padding: '10px 14px', fontSize: 13, color: 'var(--t3)', zIndex: 9999,
        }}>
          Aucun client trouvé
        </div>
      )}
    </div>
  )
}
