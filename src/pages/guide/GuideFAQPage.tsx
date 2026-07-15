// src/pages/guide/GuideFAQPage.tsx — Questions fréquentes
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, ChevronDown, ChevronUp, BookOpen, HelpCircle, MessageCircle } from 'lucide-react'
import { FAQ_ITEMS, type FaqItem } from '@/lib/data/guide-faq'
import { useAuthStore } from '@/lib/store'

const ns = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function Accordion({ item, query }: { item: FaqItem; query: string }) {
  const [open, setOpen] = useState(false)

  function highlight(text: string): React.ReactNode {
    if (!query) return text
    const q = ns(query)
    const idx = ns(text).indexOf(q)
    if (idx === -1) return text
    return (
      <>
        {text.slice(0, idx)}
        <mark style={{ background: 'var(--amBg)', color: 'var(--amTx)', borderRadius: 3, padding: '0 2px' }}>
          {text.slice(idx, idx + query.length)}
        </mark>
        {text.slice(idx + query.length)}
      </>
    )
  }

  return (
    <div style={{ borderBottom: '1px solid var(--b0)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', padding: '14px 16px', background: 'none', border: 'none',
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
          textAlign: 'left', fontFamily: 'inherit',
        }}
      >
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--t0)', lineHeight: 1.4 }}>
          {highlight(item.question)}
        </span>
        {open
          ? <ChevronUp size={16} style={{ color: 'var(--t3)', flexShrink: 0 }} />
          : <ChevronDown size={16} style={{ color: 'var(--t3)', flexShrink: 0 }} />
        }
      </button>
      {open && (
        <div style={{ padding: '0 16px 16px', fontSize: 13, color: 'var(--t1)', lineHeight: 1.6 }}>
          {highlight(item.reponse)}
        </div>
      )}
    </div>
  )
}

export default function GuideFAQPage() {
  const { user } = useAuthStore()
  const nav      = useNavigate()
  const [search, setSearch] = useState('')
  const [categorie, setCategorie] = useState<'tout' | 'admin' | 'intervenant' | 'commun'>('tout')

  const role = user?.role || 'intervenant'

  const filtered = useMemo(() => {
    let items = FAQ_ITEMS.filter(f =>
      f.categorie === 'commun' || f.categorie === role ||
      (user?.role === 'admin' && f.categorie === 'admin') ||
      (user?.role === 'intervenant' && f.categorie === 'intervenant')
    )
    if (categorie !== 'tout') items = items.filter(f => f.categorie === categorie)
    if (search.trim()) {
      const q = ns(search)
      items = items.filter(f =>
        ns(f.question).includes(q) || ns(f.reponse).includes(q) || f.tags.some(t => ns(t).includes(q))
      )
    }
    return items
  }, [search, categorie, role, user?.role])

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><HelpCircle size={22} style={{ color: 'var(--bl)' }} /> FAQ</h1>
          <p className="page-subtitle">Réponses aux questions les plus fréquentes.</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => nav('/guide')} style={{ gap: 6 }}>
          <BookOpen size={14} />
          Guide
        </button>
      </div>

      {/* Barre de recherche */}
      <div className="card" style={{ padding: '12px 16px', marginBottom: 16 }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search size={15} style={{ position: 'absolute', left: 10, color: 'var(--t3)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher une question…"
            style={{
              width: '100%', padding: '10px 10px 10px 32px',
              background: 'var(--s1)', border: '1px solid var(--b0)',
              borderRadius: 8, fontSize: 13, color: 'var(--t0)',
              outline: 'none', fontFamily: 'inherit',
            }}
          />
        </div>
      </div>

      {/* Filtres par catégorie */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {(['tout', 'commun', ...(user?.role === 'admin' ? ['admin'] : []), ...(user?.role === 'intervenant' ? ['intervenant'] : [])] as const).map(cat => (
          <button
            key={cat}
            onClick={() => setCategorie(cat as any)}
            className={categorie === cat ? 'pill pill-blue' : 'pill'}
            style={{ cursor: 'pointer', border: 'none', fontFamily: 'inherit', fontSize: 12 }}
          >
            {cat === 'tout' ? 'Toutes' : cat === 'commun' ? 'Général' : cat === 'admin' ? 'Administrateur' : 'Intervenant'}
          </button>
        ))}
      </div>

      {/* Liste FAQ */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>
            Aucune question trouvée pour "{search}"
          </div>
        ) : (
          filtered.map(item => (
            <Accordion key={item.id} item={item} query={search} />
          ))
        )}
      </div>

      <div style={{ marginTop: 24, textAlign: 'center' }}>
        <p style={{ fontSize: 13, color: 'var(--t3)', marginBottom: 12 }}>
          Vous n'avez pas trouvé votre réponse ?
        </p>
        <button className="btn btn-secondary" onClick={() => nav('/messagerie')} style={{ gap: 6 }}>
          <MessageCircle size={14} /> Contacter l'administrateur
        </button>
      </div>
    </div>
  )
}
