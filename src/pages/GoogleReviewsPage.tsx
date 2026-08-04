// src/pages/GoogleReviewsPage.tsx — Phase 2/4
// Avis Google Business Profile : établissement connecté, avis (liste,
// réponse, filtres), lien officiel de demande d'avis (copier/QR/e-mail).
import { useMemo, useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import {
  Star, RefreshCw, Loader2, Copy, Check, Mail, MessageSquare, Trash2,
  MapPin, Phone, Globe, AlertTriangle, ArrowLeft,
} from 'lucide-react'
import { useToastStore } from '@/lib/store'
import { useGoogleOAuthStatus } from '@/lib/hooks/googleIntegrations'
import { useGbpReviews, useSyncGbpReviews, useReplyToGbpReview, useDeleteGbpReviewReply, type GbpReview } from '@/lib/hooks/googleReviews'

function buildReviewLink(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`
}

const CANNED_REPLIES = [
  'Merci beaucoup pour votre avis, nous sommes ravis que notre service vous ait satisfait !',
  "Merci pour votre retour. Nous sommes désolés que l'expérience n'ait pas été à la hauteur — n'hésitez pas à nous recontacter directement pour que nous puissions corriger cela.",
  'Merci pour votre confiance et votre fidélité !',
]

function StarsDisplay({ rating }: { rating: number | null }) {
  if (!rating) return <span style={{ fontSize: 12, color: 'var(--t3)' }}>Sans note</span>
  return (
    <span style={{ display: 'inline-flex', gap: 1 }}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} size={14} fill={i < rating ? '#f59e0b' : 'none'} color={i < rating ? '#f59e0b' : 'var(--bd)'} />
      ))}
    </span>
  )
}

function ReviewCard({ review }: { review: GbpReview }) {
  const { add } = useToastStore()
  const [replying, setReplying] = useState(false)
  const [text, setText] = useState(review.response_text || '')
  const replyMut = useReplyToGbpReview()
  const deleteMut = useDeleteGbpReviewReply()

  async function handleSend() {
    if (!text.trim()) return
    try {
      await replyMut.mutateAsync({ googleReviewId: review.google_review_id, text: text.trim() })
      add('Réponse publiée')
      setReplying(false)
    } catch (e: any) { add(e.message, 'error') }
  }

  async function handleDelete() {
    try {
      await deleteMut.mutateAsync(review.google_review_id)
      add('Réponse supprimée')
    } catch (e: any) { add(e.message, 'error') }
  }

  return (
    <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>{review.reviewer_display_name || 'Client Google'}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
            <StarsDisplay rating={review.star_rating} />
            {review.review_created_at && (
              <span style={{ fontSize: 11.5, color: 'var(--t3)' }}>
                {new Date(review.review_created_at).toLocaleDateString('fr-FR')}
              </span>
            )}
          </div>
        </div>
        {review.response_text ? (
          <span className="pill pill-green">Répondu</span>
        ) : (
          <span className="pill pill-amber">Sans réponse</span>
        )}
      </div>

      {review.comment && <div style={{ fontSize: 13, color: 'var(--t1)' }}>{review.comment}</div>}

      {review.response_text && !replying && (
        <div style={{ background: 'var(--bg2)', borderRadius: 8, padding: 10, fontSize: 12.5 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--t2)' }}>Votre réponse</div>
          {review.response_text}
        </div>
      )}

      {replying ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {CANNED_REPLIES.map((c, i) => (
              <button key={i} type="button" className="btn-secondary btn-sm" onClick={() => setText(c)}>Modèle {i + 1}</button>
            ))}
          </div>
          <textarea
            value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={4096}
            style={{ width: '100%', borderRadius: 8, border: '1px solid var(--bd)', padding: 8, fontSize: 13, fontFamily: 'inherit' }}
            placeholder="Votre réponse publique à cet avis…"
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary btn-sm" disabled={replyMut.isPending || !text.trim()} onClick={handleSend}>
              {replyMut.isPending ? <Loader2 size={13} className="spin" /> : null} Publier
            </button>
            <button className="btn-secondary btn-sm" onClick={() => { setReplying(false); setText(review.response_text || '') }}>Annuler</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary btn-sm" onClick={() => setReplying(true)}>
            <MessageSquare size={13} /> {review.response_text ? 'Modifier la réponse' : 'Répondre'}
          </button>
          {review.response_text && (
            <button className="btn-secondary btn-sm" disabled={deleteMut.isPending} onClick={handleDelete}>
              {deleteMut.isPending ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />} Supprimer la réponse
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ReviewLinkCard({ placeId, raisonSociale }: { placeId: string; raisonSociale?: string | null }) {
  const { add } = useToastStore()
  const [copied, setCopied] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const link = buildReviewLink(placeId)

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, link, { width: 140, margin: 1 }).catch(() => {})
    }
  }, [link])

  function handleCopy() {
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true)
      add('Lien copié')
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function handleEmailShare() {
    const subject = encodeURIComponent('Votre avis compte pour nous')
    const body = encodeURIComponent(`Bonjour,\n\nMerci pour votre confiance ! Pourriez-vous prendre un instant pour partager votre avis sur Google ?\n${link}\n\nMerci beaucoup,\n${raisonSociale || ''}`)
    window.open(`mailto:?subject=${subject}&body=${body}`)
  }

  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 15 }}>Lien de demande d'avis</div>
      <div style={{ fontSize: 12.5, color: 'var(--t2)' }}>
        Lien officiel Google — partagez-le directement à un client pour qu'il dépose un avis sur votre établissement.
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <canvas ref={canvasRef} style={{ borderRadius: 8, border: '1px solid var(--bd)' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 12, wordBreak: 'break-all', color: 'var(--t2)', background: 'var(--bg2)', borderRadius: 6, padding: 8 }}>{link}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn-secondary btn-sm" onClick={handleCopy}>
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copié' : 'Copier le lien'}
            </button>
            <button className="btn-secondary btn-sm" onClick={handleEmailShare}><Mail size={13} /> Envoyer par e-mail</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function GoogleReviewsPage() {
  const nav = useNavigate()
  const { add } = useToastStore()
  const { data: status, isLoading: statusLoading } = useGoogleOAuthStatus()
  const { data: reviews, isLoading: reviewsLoading, isError, error } = useGbpReviews()
  const syncMut = useSyncGbpReviews()
  const [ratingFilter, setRatingFilter] = useState<number | 'tous'>('tous')
  const [statusFilter, setStatusFilter] = useState<'tous' | 'repondu' | 'sans_reponse'>('tous')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 10

  const gbp = status?.google_business
  const isConnected = gbp?.status === 'connected'
  const hasLocation = !!gbp?.google_location_id
  const neverSynced = isConnected && hasLocation && !gbp?.last_synced_at
  const hasSyncError = isConnected && hasLocation && !!gbp?.last_error

  const filtered = useMemo(() => {
    return (reviews ?? []).filter((r) => {
      if (ratingFilter !== 'tous' && r.star_rating !== ratingFilter) return false
      if (statusFilter === 'repondu' && !r.response_text) return false
      if (statusFilter === 'sans_reponse' && r.response_text) return false
      return true
    })
  }, [reviews, ratingFilter, statusFilter])

  const stats = useMemo(() => {
    const all = reviews ?? []
    const avg = all.length ? all.reduce((s, r) => s + (r.star_rating || 0), 0) / all.filter((r) => r.star_rating).length : 0
    const unanswered = all.filter((r) => !r.response_text).length
    return { total: all.length, avg: Number.isFinite(avg) ? avg : 0, unanswered }
  }, [reviews])

  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  async function handleSync() {
    try {
      const res = await syncMut.mutateAsync()
      add(`Synchronisé — ${res.synced} avis (${res.newReviews} nouveau${(res.newReviews ?? 0) > 1 ? 'x' : ''})`)
    } catch (e: any) { add(e.message, 'error') }
  }

  if (statusLoading) return <div ><Loader2 className="spin" /></div>

  if (!isConnected || !hasLocation) {
    return (
      <div >
        <button className="btn-secondary btn-sm" onClick={() => nav('/parametres/integrations')} style={{ marginBottom: 12 }}>
          <ArrowLeft size={14} /> Retour aux intégrations
        </button>
        <div className="card" style={{ padding: 24, textAlign: 'center' }}>
          <AlertTriangle size={28} color="var(--amTx)" style={{ marginBottom: 8 }} />
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {!isConnected ? 'Google Business Profile non connecté' : 'Aucun établissement sélectionné'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 12 }}>
            Connectez votre compte et sélectionnez un établissement depuis les paramètres d'intégrations.
          </div>
          <button className="btn-primary" onClick={() => nav('/parametres/integrations')}>Configurer</button>
        </div>
      </div>
    )
  }

  return (
    <div >
      <div className="page-header">
        <h1 className="page-title">Avis Google</h1>
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{gbp?.location_title || 'Établissement'}</div>
            {gbp?.location_address && <div style={{ fontSize: 12.5, color: 'var(--t2)', display: 'flex', alignItems: 'center', gap: 4 }}><MapPin size={12} /> {gbp.location_address}</div>}
            {gbp?.location_phone && <div style={{ fontSize: 12.5, color: 'var(--t2)', display: 'flex', alignItems: 'center', gap: 4 }}><Phone size={12} /> {gbp.location_phone}</div>}
            {gbp?.location_website && <div style={{ fontSize: 12.5, color: 'var(--t2)', display: 'flex', alignItems: 'center', gap: 4 }}><Globe size={12} /> {gbp.location_website}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <button className="btn-secondary btn-sm" disabled={syncMut.isPending} onClick={handleSync}>
              {syncMut.isPending ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} Synchroniser
            </button>
            {gbp?.last_synced_at && (
              <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>
                Dernière synchro : {new Date(gbp.last_synced_at).toLocaleString('fr-FR')}
              </div>
            )}
          </div>
        </div>
      </div>

      {hasSyncError && (
        <div className="card" style={{ padding: 12, marginBottom: 16, color: 'var(--rdTx)', fontSize: 12.5, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>La dernière tentative de synchronisation a échoué : {gbp?.last_error}. {neverSynced ? 'Aucun avis n\'a encore été récupéré.' : 'Les avis affichés ci-dessous datent de la dernière synchronisation réussie.'}</span>
        </div>
      )}

      {gbp?.place_id && <div style={{ marginBottom: 16 }}><ReviewLinkCard placeId={gbp.place_id} raisonSociale={gbp.location_title} /></div>}

      {neverSynced ? (
        <div className="card" style={{ padding: 24, textAlign: 'center' }}>
          <AlertTriangle size={28} color="var(--amTx)" style={{ marginBottom: 8 }} />
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Aucune synchronisation n'a encore été effectuée</div>
          <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 12, maxWidth: 360, marginLeft: 'auto', marginRight: 'auto' }}>
            Les avis de cet établissement n'ont pas encore été récupérés. Lancez une première synchronisation pour les afficher.
          </div>
          <button className="btn-primary" disabled={syncMut.isPending} onClick={handleSync}>
            {syncMut.isPending ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Synchroniser maintenant
          </button>
        </div>
      ) : (
        <>
          <div className="grid-3" style={{ marginBottom: 16 }}>
            <div className="stat-card">
              <div className="stat-value">{stats.avg.toFixed(1)} <Star size={16} fill="#f59e0b" color="#f59e0b" style={{ display: 'inline', verticalAlign: 'middle' }} /></div>
              <div className="stat-label">Note moyenne</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.total}</div>
              <div className="stat-label">Avis au total</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.unanswered}</div>
              <div className="stat-label">Sans réponse</div>
            </div>
          </div>

          <div className="card" style={{ padding: 16, marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>Filtrer :</span>
            <select value={ratingFilter} onChange={(e) => { setRatingFilter(e.target.value === 'tous' ? 'tous' : Number(e.target.value)); setPage(0) }} >
              <option value="tous">Toutes les notes</option>
              {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} étoile{n > 1 ? 's' : ''}</option>)}
            </select>
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as any); setPage(0) }} >
              <option value="tous">Tous statuts</option>
              <option value="repondu">Répondus</option>
              <option value="sans_reponse">Sans réponse</option>
            </select>
          </div>

          {isError && <div className="card" style={{ padding: 16, color: 'var(--rdTx)' }}>{(error as Error)?.message || 'Erreur de chargement'}</div>}
          {reviewsLoading && <Loader2 className="spin" />}
          {!reviewsLoading && !isError && filtered.length === 0 && (
            <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--t2)', fontSize: 13 }}>
              {reviews?.length ? 'Aucun avis ne correspond à ces filtres.' : "Synchronisation effectuée — Google n'a renvoyé aucun avis pour cet établissement."}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {paged.map((r) => <ReviewCard key={r.id} review={r} />)}
          </div>

          {filtered.length > PAGE_SIZE && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
              <button className="btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Précédent</button>
              <span style={{ fontSize: 12.5, alignSelf: 'center' }}>Page {page + 1} / {Math.ceil(filtered.length / PAGE_SIZE)}</span>
              <button className="btn-secondary btn-sm" disabled={(page + 1) * PAGE_SIZE >= filtered.length} onClick={() => setPage((p) => p + 1)}>Suivant</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
