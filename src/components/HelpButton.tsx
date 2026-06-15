// src/components/HelpButton.tsx — Bouton flottant ❓ Aide avec recherche globale
import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { HelpCircle, X, Search, BookOpen, Play, MessageCircle } from 'lucide-react'
import { useAuthStore } from '@/lib/store'
import { useIsMobile } from '@/lib/hooks'
import { ALL_ADMIN_SECTIONS } from '@/lib/data/guide-admin'
import { ALL_INTERVENANT_SECTIONS } from '@/lib/data/guide-intervenant'
import { FAQ_ITEMS } from '@/lib/data/guide-faq'
import type { GuideSection } from '@/lib/data/guide-admin'
import type { FaqItem } from '@/lib/data/guide-faq'

type SearchResult =
  | { type: 'section'; item: GuideSection; role: 'admin' | 'intervenant' }
  | { type: 'faq'; item: FaqItem }

function normalize(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function search(query: string, role: 'admin' | 'intervenant'): SearchResult[] {
  if (!query.trim()) return []
  const q = normalize(query)
  const results: SearchResult[] = []

  const sections = role === 'admin' ? ALL_ADMIN_SECTIONS : ALL_INTERVENANT_SECTIONS
  sections.forEach(s => {
    const haystack = normalize(`${s.titre} ${s.objectif} ${s.etapes.join(' ')} ${s.conseil || ''}`)
    if (haystack.includes(q)) {
      results.push({ type: 'section', item: s, role })
    }
  })

  FAQ_ITEMS.forEach(f => {
    if (f.categorie !== role && f.categorie !== 'commun') return
    const haystack = normalize(`${f.question} ${f.reponse} ${f.tags.join(' ')}`)
    if (haystack.includes(q)) results.push({ type: 'faq', item: f })
  })

  return results.slice(0, 6)
}

export default function HelpButton() {
  const { user }   = useAuthStore()
  const nav        = useNavigate()
  const isMobile   = useIsMobile()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const panelRef   = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLInputElement>(null)

  const role = user?.role || 'intervenant'
  const results = search(query, role)

  // Fermer si clic en dehors
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Focus l'input quand on ouvre
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100)
    else setQuery('')
  }, [open])

  function goTo(path: string) { setOpen(false); nav(path) }

  // Position : au-dessus de la barre de navigation mobile
  const bottom = isMobile ? 88 : 24
  const right  = isMobile ? 16 : 24

  function highlightMatch(text: string, q: string): React.ReactNode {
    if (!q) return text
    const idx = normalize(text).indexOf(normalize(q))
    if (idx === -1) return text
    return (
      <>
        {text.slice(0, idx)}
        <mark style={{ background: 'var(--amBg)', color: 'var(--amTx)', borderRadius: 3, padding: '0 2px' }}>
          {text.slice(idx, idx + q.length)}
        </mark>
        {text.slice(idx + q.length)}
      </>
    )
  }

  return (
    <div ref={panelRef} style={{ position: 'fixed', bottom, right, zIndex: 500 }}>
      {/* Panneau */}
      {open && (
        <div style={{
          position: 'absolute', bottom: 56, right: 0,
          width: 300, background: 'var(--card)',
          borderRadius: 14, boxShadow: '0 8px 40px rgba(0,0,0,.2)',
          border: '1px solid var(--b0)', overflow: 'hidden',
          animation: 'slideUp .2s ease',
        }}>
          {/* Barre de recherche */}
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--b0)' }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, color: 'var(--t3)', flexShrink: 0 }} />
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Rechercher dans le guide…"
                style={{
                  width: '100%', padding: '8px 8px 8px 30px',
                  background: 'var(--s1)', border: '1px solid var(--b0)',
                  borderRadius: 8, fontSize: 13, color: 'var(--t0)',
                  outline: 'none', fontFamily: 'inherit',
                }}
              />
            </div>
          </div>

          {/* Résultats de recherche */}
          {query.trim() && (
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              {results.length === 0 && (
                <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--t3)', textAlign: 'center' }}>
                  Aucun résultat
                </div>
              )}
              {results.map((r, i) => (
                <button
                  key={i}
                  onClick={() => {
                    if (r.type === 'section') goTo(`/guide/${role}/${r.item.slug}`)
                    else goTo('/guide/faq')
                  }}
                  style={{
                    width: '100%', padding: '10px 14px', background: 'none', border: 'none',
                    cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'flex-start',
                    gap: 8, borderBottom: '1px solid var(--b0)', fontFamily: 'inherit',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--s1)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>
                    {r.type === 'section' ? '📖' : '❓'}
                  </span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t0)' }}>
                      {highlightMatch(r.type === 'section' ? r.item.titre : r.item.question, query)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
                      {r.type === 'section' ? r.item.objectif.slice(0, 60) + '…' : 'FAQ'}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Liens rapides */}
          {!query.trim() && (
            <div style={{ padding: '8px 0' }}>
              <div style={{ padding: '6px 14px 4px', fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                Aide rapide
              </div>
              {[
                { icon: BookOpen, label: 'Guide d\'utilisation', path: '/guide' },
                { icon: Play, label: 'Vidéos', path: `/guide/${role}` },
                { icon: MessageCircle, label: 'FAQ', path: '/guide/faq' },
              ].map(({ icon: Icon, label, path }) => (
                <button
                  key={path}
                  onClick={() => goTo(path)}
                  style={{
                    width: '100%', padding: '10px 14px', background: 'none', border: 'none',
                    cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center',
                    gap: 10, fontFamily: 'inherit', color: 'var(--t1)', fontSize: 13, fontWeight: 500,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--s1)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  <Icon size={15} style={{ color: 'var(--bl)', flexShrink: 0 }} />
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bouton principal */}
      <button
        onClick={() => setOpen(o => !o)}
        title="Aide"
        style={{
          width: 48, height: 48, borderRadius: '50%',
          background: open ? 'var(--bl)' : 'var(--card)',
          border: '1.5px solid var(--b1)',
          boxShadow: '0 4px 16px rgba(0,0,0,.18)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', transition: 'all .2s',
          color: open ? '#fff' : 'var(--bl)',
        }}
        onMouseEnter={e => {
          if (!open) {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--blBg)'
            ;(e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.08)'
          }
        }}
        onMouseLeave={e => {
          if (!open) {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--card)'
            ;(e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'
          }
        }}
      >
        {open ? <X size={20} /> : <HelpCircle size={20} />}
      </button>

      <style>{`@keyframes slideUp { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }`}</style>
    </div>
  )
}
