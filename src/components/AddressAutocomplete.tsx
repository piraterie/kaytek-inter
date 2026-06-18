// src/components/AddressAutocomplete.tsx
import { useState, useEffect, useRef, useCallback } from 'react'

interface AddressSuggestion {
  label: string
  housenumber?: string
  street?: string
  postcode?: string
  city?: string
  x?: number
  y?: number
}

interface AddressAutocompleteProps {
  value: string
  onChange: (value: string) => void
  onSelect: (suggestion: AddressSuggestion) => void
  placeholder?: string
  disabled?: boolean
  style?: React.CSSProperties
}

export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = 'Adresse complète',
  disabled,
  style,
}: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.length < 3) { setSuggestions([]); setOpen(false); return }
    if (abortRef.current) abortRef.current.abort()
    abortRef.current = new AbortController()
    setLoading(true)
    try {
      const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=5&autocomplete=1`
      const res = await fetch(url, { signal: abortRef.current.signal })
      if (!res.ok) throw new Error('Erreur API adresse')
      const json = await res.json()
      const results: AddressSuggestion[] = (json.features || []).map((f: any) => ({
        label: f.properties.label,
        housenumber: f.properties.housenumber,
        street: f.properties.street,
        postcode: f.properties.postcode,
        city: f.properties.city,
        x: f.geometry?.coordinates?.[0],
        y: f.geometry?.coordinates?.[1],
      }))
      setSuggestions(results)
      setOpen(results.length > 0)
    } catch (err: any) {
      if (err.name !== 'AbortError') setSuggestions([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchSuggestions(value), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [value, fetchSuggestions])

  // Ferme si clic en dehors
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function handleSelect(s: AddressSuggestion) {
    onChange(s.label)
    onSelect(s)
    setOpen(false)
    setSuggestions([])
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', ...style }}>
      <div style={{ position: 'relative' }}>
        <input
          value={value}
          onChange={e => { onChange(e.target.value); if (!e.target.value) setSuggestions([]) }}
          onFocus={() => { if (suggestions.length > 0) setOpen(true) }}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          style={{ paddingRight: loading ? 32 : undefined }}
        />
        {loading && (
          <div style={{
            position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
            width: 14, height: 14, borderRadius: '50%',
            border: '2px solid var(--b2)', borderTopColor: 'var(--bl)',
            animation: 'spin 0.7s linear infinite',
          }} />
        )}
      </div>
      {open && suggestions.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'var(--s0)', border: '1px solid var(--b1)',
          borderRadius: 'var(--r2)', boxShadow: 'var(--sh1)',
          zIndex: 9999, overflow: 'hidden',
        }}>
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              onMouseDown={e => { e.preventDefault(); handleSelect(s) }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '10px 14px', border: 'none', background: 'none',
                cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 13, color: 'var(--t0)',
                borderBottom: i < suggestions.length - 1 ? '1px solid var(--b0)' : 'none',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--s1)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              <div style={{ fontWeight: 500 }}>{s.label}</div>
              {s.postcode && s.city && (
                <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 1 }}>{s.postcode} {s.city}</div>
              )}
            </button>
          ))}
        </div>
      )}
      <style>{`
        @keyframes spin { to { transform: translateY(-50%) rotate(360deg); } }
      `}</style>
    </div>
  )
}
