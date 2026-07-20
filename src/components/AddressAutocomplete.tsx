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

type Status = 'idle' | 'loading' | 'results' | 'empty' | 'error'

const MIN_CHARS = 3
const DEBOUNCE_MS = 300
const MAX_MENU_HEIGHT = 240

export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = 'Adresse complète',
  disabled,
  style,
}: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [open, setOpen] = useState(false)
  const [menuAbove, setMenuAbove] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Incremented on every new request/reset; lets a resolving fetch detect it has
  // been superseded even if the browser/API ignores AbortController.
  const requestSeqRef = useRef(0)

  const computeMenuPosition = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const viewportH = window.visualViewport?.height ?? window.innerHeight
    const spaceBelow = viewportH - rect.bottom
    const spaceAbove = rect.top
    setMenuAbove(spaceBelow < MAX_MENU_HEIGHT + 8 && spaceAbove > spaceBelow)
  }, [])

  const fetchSuggestions = useCallback(async (q: string) => {
    const seq = ++requestSeqRef.current
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setStatus('loading')
    try {
      const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=5&autocomplete=1`
      const res = await fetch(url, { signal: controller.signal })
      // Discard if a newer request has started since — protects against
      // out-of-order responses even if abort isn't honored by the network layer.
      if (seq !== requestSeqRef.current) return
      if (!res.ok) throw new Error('Erreur API adresse')
      const json = await res.json()
      if (seq !== requestSeqRef.current) return
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
      setStatus(results.length > 0 ? 'results' : 'empty')
      computeMenuPosition()
      setOpen(true)
    } catch (err: any) {
      if (seq !== requestSeqRef.current) return
      if (err.name === 'AbortError') return
      setSuggestions([])
      setStatus('error')
      computeMenuPosition()
      setOpen(true)
    }
  }, [computeMenuPosition])

  // Cancel any in-flight request / pending debounce on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      abortRef.current?.abort()
    }
  }, [])

  // Keep the menu on the correct side (above/below) if the on-screen keyboard
  // opens/closes or the viewport otherwise resizes while it's visible.
  useEffect(() => {
    if (!open) return
    const handler = () => computeMenuPosition()
    window.addEventListener('resize', handler)
    window.visualViewport?.addEventListener('resize', handler)
    return () => {
      window.removeEventListener('resize', handler)
      window.visualViewport?.removeEventListener('resize', handler)
    }
  }, [open, computeMenuPosition])

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

  function scheduleSearch(q: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchSuggestions(q), DEBOUNCE_MS)
  }

  // Only real keystrokes reach here — programmatic value changes from the
  // parent (prefill on edit, or a selection below) never re-trigger a search.
  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    onChange(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (v.trim().length < MIN_CHARS) {
      abortRef.current?.abort()
      requestSeqRef.current++
      setSuggestions([])
      setStatus('idle')
      setOpen(false)
      return
    }
    scheduleSearch(v)
  }

  function handleSelect(s: AddressSuggestion) {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    abortRef.current?.abort()
    requestSeqRef.current++
    onChange(s.label)
    onSelect(s)
    setOpen(false)
    setSuggestions([])
    setStatus('idle')
  }

  const showSpinner = status === 'loading'

  return (
    <div ref={containerRef} style={{ position: 'relative', ...style }}>
      <div style={{ position: 'relative' }}>
        <input
          value={value}
          onChange={handleInputChange}
          onFocus={() => { if (status === 'results' || status === 'empty' || status === 'error') { computeMenuPosition(); setOpen(true) } }}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          // Padding is reserved unconditionally so the spinner never shifts the field's width/content.
          style={{ paddingRight: 32 }}
        />
        {showSpinner && (
          <div style={{
            position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
            width: 14, height: 14, borderRadius: '50%',
            border: '2px solid var(--b2)', borderTopColor: 'var(--bl)',
            animation: 'spin 0.7s linear infinite',
          }} />
        )}
      </div>
      {open && (status === 'results' || status === 'empty' || status === 'error') && (
        <div style={{
          position: 'absolute', left: 0, right: 0,
          ...(menuAbove ? { bottom: 'calc(100% + 4px)' } : { top: 'calc(100% + 4px)' }),
          background: 'var(--s0)', border: '1px solid var(--b1)',
          borderRadius: 'var(--r2)', boxShadow: 'var(--sh1)',
          zIndex: 9999, overflow: 'hidden',
          maxHeight: MAX_MENU_HEIGHT, overflowY: 'auto',
        }}>
          {status === 'results' && suggestions.map((s, i) => (
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
          {status === 'empty' && (
            <div style={{ padding: '10px 14px', fontSize: 13, color: 'var(--t3)' }}>
              Aucune adresse trouvée. Vous pouvez saisir l'adresse manuellement.
            </div>
          )}
          {status === 'error' && (
            <div style={{ padding: '10px 14px', fontSize: 13, color: 'var(--t3)' }}>
              Service d'adresses indisponible. Vous pouvez saisir l'adresse manuellement.
            </div>
          )}
        </div>
      )}
      <style>{`
        @keyframes spin { to { transform: translateY(-50%) rotate(360deg); } }
      `}</style>
    </div>
  )
}
