// src/pages/guide/GuideAdminVideosPage.tsx — Gestion des vidéos du guide (admin)
import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAllGuideVideos, useUpdateGuideVideo, useDeleteGuideVideo, useUploadGuideVideo } from '@/lib/hooks/guide'
import { useToastStore } from '@/lib/store'
import ConfirmModal from '@/components/ConfirmModal'
import { BookOpen, Upload, Edit2, Trash2, Eye, EyeOff, ArrowLeft } from 'lucide-react'
import type { GuideVideo, Role } from '@/types'

const ROLE_LABELS: Record<Role, string> = { admin: 'Administrateur', intervenant: 'Intervenant' }

function EditModal({ video, onClose }: { video: GuideVideo; onClose: () => void }) {
  const update = useUpdateGuideVideo()
  const { add } = useToastStore()
  const [form, setForm] = useState({ titre: video.titre, description: video.description || '', ordre: video.ordre })

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    try {
      await update.mutateAsync({ id: video.id, ...form })
      add('Vidéo mise à jour')
      onClose()
    } catch (err: any) { add(err.message, 'error') }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(4px)' }} />
      <div style={{ position: 'fixed', inset: 0, zIndex: 1101, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div className="card" style={{ width: '100%', maxWidth: 420, padding: 24 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Modifier la vidéo</h3>
          <form onSubmit={handleSave}>
            <div className="form-group">
              <label>Titre</label>
              <input value={form.titre} onChange={e => setForm(f => ({ ...f, titre: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} style={{ resize: 'vertical' }} />
            </div>
            <div className="form-group">
              <label>Ordre d'affichage</label>
              <input type="number" value={form.ordre} onChange={e => setForm(f => ({ ...f, ordre: parseInt(e.target.value) || 0 }))} min={0} />
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button type="submit" className="btn btn-primary" disabled={update.isPending}>
                {update.isPending ? 'Enregistrement…' : 'Enregistrer'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}

function UploadModal({ onClose }: { onClose: () => void }) {
  const upload = useUploadGuideVideo()
  const { add } = useToastStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState({ role: 'admin' as Role, sectionSlug: '', slug: '', titre: '', description: '', ordre: 0 })
  const [file, setFile] = useState<File | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) { add('Choisissez un fichier vidéo', 'error'); return }
    if (!form.sectionSlug || !form.slug || !form.titre) { add('Remplissez tous les champs obligatoires', 'error'); return }
    try {
      await upload.mutateAsync({ file, ...form })
      add('Vidéo uploadée avec succès')
      onClose()
    } catch (err: any) { add(err.message, 'error') }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(4px)' }} />
      <div style={{ position: 'fixed', inset: 0, zIndex: 1101, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div className="card" style={{ width: '100%', maxWidth: 460, padding: 24, maxHeight: '90vh', overflowY: 'auto' }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Uploader une vidéo</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Rôle *</label>
              <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as Role }))} style={{ width: '100%', padding: '8px 10px', background: 'var(--s1)', border: '1px solid var(--b0)', borderRadius: 8, fontFamily: 'inherit', fontSize: 13, color: 'var(--t0)' }}>
                <option value="admin">Administrateur</option>
                <option value="intervenant">Intervenant</option>
              </select>
            </div>
            <div className="form-group">
              <label>Slug section *</label>
              <input placeholder="ex: creer-client" value={form.sectionSlug} onChange={e => setForm(f => ({ ...f, sectionSlug: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label>Slug vidéo *</label>
              <input placeholder="ex: 02-creer-client" value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label>Titre *</label>
              <input placeholder="Créer un client" value={form.titre} onChange={e => setForm(f => ({ ...f, titre: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} style={{ resize: 'vertical' }} />
            </div>
            <div className="form-group">
              <label>Ordre</label>
              <input type="number" value={form.ordre} onChange={e => setForm(f => ({ ...f, ordre: parseInt(e.target.value) || 0 }))} min={0} />
            </div>
            <div className="form-group">
              <label>Fichier vidéo * (WebM ou MP4)</label>
              <input
                ref={fileRef}
                type="file"
                accept="video/webm,video/mp4,video/quicktime"
                onChange={e => setFile(e.target.files?.[0] || null)}
                required
              />
              {file && <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 6 }}>{file.name} — {(file.size / 1024 / 1024).toFixed(1)} Mo</div>}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="submit" className="btn btn-primary" disabled={upload.isPending || !file}>
                {upload.isPending ? 'Upload en cours…' : 'Uploader'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}

export default function GuideAdminVideosPage() {
  const nav = useNavigate()
  const { add } = useToastStore()
  const { data: videos = [], isLoading } = useAllGuideVideos()
  const updateVideo = useUpdateGuideVideo()
  const deleteVideo = useDeleteGuideVideo()

  const [editTarget, setEditTarget] = useState<GuideVideo | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<GuideVideo | null>(null)
  const [showUpload, setShowUpload] = useState(false)

  async function handleToggleActive(v: GuideVideo) {
    try {
      await updateVideo.mutateAsync({ id: v.id, actif: !v.actif })
      add(v.actif ? 'Vidéo désactivée' : 'Vidéo activée')
    } catch (err: any) { add(err.message, 'error') }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteVideo.mutateAsync({ id: deleteTarget.id, storagePath: deleteTarget.storage_path })
      add('Vidéo supprimée')
      setDeleteTarget(null)
    } catch (err: any) { add(err.message, 'error') }
  }

  const byRole = (role: Role) => videos.filter(v => v.role === role).sort((a, b) => a.ordre - b.ordre)

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <button onClick={() => nav('/guide/admin')} className="btn btn-secondary btn-sm" style={{ gap: 5 }}>
              <ArrowLeft size={13} />
              Guide
            </button>
          </div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BookOpen size={22} style={{ color: 'var(--bl)' }} />
            Gestion des vidéos
          </h1>
          <p className="page-subtitle">Ajoutez, modifiez ou supprimez les vidéos du centre d'aide.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowUpload(true)} style={{ gap: 6 }}>
          <Upload size={15} />
          Uploader une vidéo
        </button>
      </div>

      {isLoading && <div style={{ textAlign: 'center', padding: 40, color: 'var(--t3)' }}>Chargement…</div>}

      {(['admin', 'intervenant'] as Role[]).map(role => {
        const roleVideos = byRole(role)
        return (
          <div key={role} style={{ marginBottom: 28 }}>
            <div className="card-header" style={{ marginBottom: 12 }}>
              <span className="card-title">{ROLE_LABELS[role]}</span>
              <span className="pill pill-gray" style={{ fontSize: 11 }}>{roleVideos.length} vidéo(s)</span>
            </div>
            {roleVideos.length === 0 ? (
              <div className="card" style={{ padding: '20px', textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>
                Aucune vidéo pour ce rôle.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {roleVideos.map(v => (
                  <div key={v.id} className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: v.actif ? 'var(--t0)' : 'var(--t3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {v.titre}
                        {!v.actif && <span className="pill pill-gray" style={{ fontSize: 10 }}>Inactif</span>}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>
                        {v.section_slug} · ordre {v.ordre}
                        {v.duree_secondes && ` · ${Math.floor(v.duree_secondes / 60)}:${String(v.duree_secondes % 60).padStart(2, '0')}`}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button
                        onClick={() => handleToggleActive(v)}
                        className="btn btn-secondary btn-sm"
                        title={v.actif ? 'Désactiver' : 'Activer'}
                        style={{ padding: '6px 8px' }}
                      >
                        {v.actif ? <Eye size={13} /> : <EyeOff size={13} />}
                      </button>
                      <button
                        onClick={() => setEditTarget(v)}
                        className="btn btn-secondary btn-sm"
                        title="Modifier"
                        style={{ padding: '6px 8px' }}
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(v)}
                        className="btn btn-sm"
                        style={{ padding: '6px 8px', background: 'var(--rdBg)', color: 'var(--rdTx)', border: '1px solid var(--rdBd)', borderRadius: 6 }}
                        title="Supprimer"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {editTarget && <EditModal video={editTarget} onClose={() => setEditTarget(null)} />}
      {showUpload && <UploadModal onClose={() => setShowUpload(false)} />}
      {deleteTarget && (
        <ConfirmModal
          message={`Supprimer la vidéo "${deleteTarget.titre}" ? Cette action est irréversible.`}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
