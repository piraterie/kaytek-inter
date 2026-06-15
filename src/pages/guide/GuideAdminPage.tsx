// src/pages/guide/GuideAdminPage.tsx — Guide complet pour les administrateurs
import { useState, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { BookOpen, Search, Bell, ChevronRight, Settings } from 'lucide-react'
import { ALL_ADMIN_SECTIONS } from '@/lib/data/guide-admin'
import { useGuideNews } from '@/lib/hooks/guide'
import { useCompletedSlugs } from '@/lib/hooks/guide'
import { useIsMobile } from '@/lib/hooks'
import GuideProgress from '@/components/guide/GuideProgress'
import GuideSectionCard from '@/components/guide/GuideSectionCard'
import { format } from 'date-fns'; import { fr } from 'date-fns/locale'

const ns = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default function GuideAdminPage() {
  const { section: sectionParam } = useParams<{ section: string }>()
  const nav        = useNavigate()
  const isMobile   = useIsMobile()
  const completed  = useCompletedSlugs()
  const { data: news = [] } = useGuideNews()

  const [search, setSearch] = useState('')
  const [activeSlug, setActiveSlug] = useState(sectionParam || ALL_ADMIN_SECTIONS[0].slug)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [newsExpanded, setNewsExpanded] = useState(false)

  const activeSection = ALL_ADMIN_SECTIONS.find(s => s.slug === activeSlug) ?? ALL_ADMIN_SECTIONS[0]

  const filteredSections = useMemo(() => {
    if (!search.trim()) return ALL_ADMIN_SECTIONS
    const q = ns(search)
    return ALL_ADMIN_SECTIONS.filter(s =>
      ns(s.titre).includes(q) || ns(s.objectif).includes(q) || s.etapes.some(e => ns(e).includes(q))
    )
  }, [search])

  function selectSection(slug: string) {
    setActiveSlug(slug)
    setMobileMenuOpen(false)
    nav(`/guide/admin/${slug}`, { replace: true })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const SectionList = () => (
    <div>
      {/* Recherche */}
      <div style={{ padding: '0 0 12px', position: 'relative' }}>
        <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--t3)' }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher…"
          style={{
            width: '100%', padding: '8px 8px 8px 30px', boxSizing: 'border-box',
            background: 'var(--s1)', border: '1px solid var(--b0)',
            borderRadius: 8, fontSize: 12, color: 'var(--t0)', outline: 'none',
            fontFamily: 'inherit',
          }}
        />
      </div>

      {/* Nouveautés */}
      {news.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <button
            onClick={() => setNewsExpanded(x => !x)}
            style={{
              width: '100%', padding: '9px 10px', background: 'none', border: 'none',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
              borderRadius: 8, fontFamily: 'inherit',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--s1)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            <Bell size={14} style={{ color: 'var(--or)', flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--t0)', textAlign: 'left' }}>
              Nouveautés
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--or)', color: '#fff', padding: '1px 6px', borderRadius: 10 }}>
              {news.length}
            </span>
          </button>
          {newsExpanded && (
            <div style={{ marginLeft: 8, paddingLeft: 8, borderLeft: '2px solid var(--b1)' }}>
              {news.slice(0, 3).map(n => (
                <div key={n.id} style={{ padding: '6px 8px' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t0)' }}>{n.titre}</div>
                  <div style={{ fontSize: 11, color: 'var(--t3)' }}>
                    {format(new Date(n.date_publication), 'd MMM yyyy', { locale: fr })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Navigation sections */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {filteredSections.length === 0 && (
          <div style={{ padding: '12px 10px', fontSize: 12, color: 'var(--t3)', textAlign: 'center' }}>
            Aucune section trouvée
          </div>
        )}
        {filteredSections.map((s, i) => {
          const isActive = s.slug === activeSlug
          const isDone   = completed.has(s.slug)
          return (
            <button
              key={s.slug}
              onClick={() => selectSection(s.slug)}
              style={{
                padding: '9px 10px', background: isActive ? 'var(--blBg)' : 'none',
                border: 'none', borderRadius: 8, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 8,
                textAlign: 'left', fontFamily: 'inherit',
                transition: 'background .15s',
              }}
              onMouseEnter={e => { if (!isActive) (e.currentTarget.style.background = 'var(--s1)') }}
              onMouseLeave={e => { if (!isActive) (e.currentTarget.style.background = 'none') }}
            >
              <span style={{ fontSize: 12, color: isActive ? 'var(--blTx)' : 'var(--t3)', fontWeight: 600, minWidth: 18 }}>
                {i === 0 ? '🚀' : isDone ? '✓' : String(i)}
              </span>
              <span style={{ flex: 1, fontSize: 13, color: isActive ? 'var(--blTx)' : 'var(--t0)', fontWeight: isActive ? 600 : 400 }}>
                {s.titre}
              </span>
              {isDone && !isActive && (
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gn)', flexShrink: 0 }} />
              )}
            </button>
          )
        })}
      </div>

      {/* Lien gestion vidéos */}
      <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--b0)' }}>
        <button
          onClick={() => nav('/guide/admin/videos')}
          style={{
            width: '100%', padding: '9px 10px', background: 'none', border: 'none',
            borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center',
            gap: 8, fontFamily: 'inherit', color: 'var(--t2)', fontSize: 12,
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--s1)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
        >
          <Settings size={13} style={{ flexShrink: 0 }} />
          Gérer les vidéos
        </button>
      </div>
    </div>
  )

  return (
    <div>
      {/* En-tête */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BookOpen size={22} style={{ color: 'var(--bl)' }} />
            Guide Administrateur
          </h1>
          <p className="page-subtitle">Toutes les fonctionnalités expliquées pas à pas.</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => nav('/guide/faq')}>
          ❓ FAQ
        </button>
      </div>

      {/* Progression */}
      <GuideProgress sections={ALL_ADMIN_SECTIONS} />

      {/* Layout desktop : sidebar + contenu */}
      {!isMobile ? (
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
          {/* Sidebar */}
          <div className="card" style={{ width: 220, flexShrink: 0, padding: '14px 10px', position: 'sticky', top: 80 }}>
            <SectionList />
          </div>
          {/* Contenu */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <GuideSectionCard
              section={activeSection}
              role="admin"
              isQuickStart={activeSection.slug === 'quick-start'}
            />
          </div>
        </div>
      ) : (
        /* Layout mobile : accordéon */
        <div>
          {/* Bouton "Choisir une section" mobile */}
          <button
            onClick={() => setMobileMenuOpen(o => !o)}
            className="card"
            style={{
              width: '100%', padding: '14px 16px', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
              fontFamily: 'inherit', background: 'var(--card)',
            }}
          >
            <span style={{ flex: 1, fontWeight: 600, fontSize: 14, color: 'var(--t0)', textAlign: 'left' }}>
              {activeSection.titre}
            </span>
            <ChevronRight size={16} style={{ color: 'var(--t3)', transform: mobileMenuOpen ? 'rotate(90deg)' : 'none', transition: 'transform .2s' }} />
          </button>

          {/* Menu mobile déroulant */}
          {mobileMenuOpen && (
            <div className="card" style={{ padding: '12px 10px', marginBottom: 16 }}>
              <SectionList />
            </div>
          )}

          {/* Contenu mobile */}
          <GuideSectionCard
            section={activeSection}
            role="admin"
            isQuickStart={activeSection.slug === 'quick-start'}
          />
        </div>
      )}
    </div>
  )
}
