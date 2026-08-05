// src/lib/hooks/index.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

export function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < breakpoint)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < breakpoint)
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [breakpoint])
  return isMobile
}
import { supabase } from '@/lib/supabase/client'
import { uploadPhoto as uploadPhotoStorage } from '@/lib/supabase/storage'
import { useAuthStore, useToastStore } from '@/lib/store'
import { pdfCache } from '@/lib/pdf/cache'
import type { Intervention, Devis, Facture, Client, Commission, Message, Profile, Prestation, ParametresEntreprise, ParametresEntreprisePublic, DashboardStats, JournalEntry } from '@/types'

const uid = () => useAuthStore.getState().user?.id
const isAdm = () => useAuthStore.getState().user?.role === 'admin'
const canManageOps = () => ['admin', 'assistant'].includes(useAuthStore.getState().user?.role || '')
const orgId = () => useAuthStore.getState().user?.organisation_id

// ── DASHBOARD ────────────────────────────────────────────────────
export function useDashboard() {
  const user = useAuthStore(s => s.user)
  return useQuery<DashboardStats>({
    queryKey: ['dashboard', user?.id],
    queryFn: async () => {
      const today = new Date()
      const startDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()
      const startMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString()
      const admin = isAdm()
      const isAssistant = user?.role === 'assistant'
      const [
        { count: todayCount },
        { data: factures },
        { data: commissionsDues },
        { count: msgs },
        { count: devisWaiting },
        { data: mesCommissions },
        { count: aPlanifier },
      ] = await Promise.all([
        supabase.from('interventions').select('id', { count: 'exact', head: true }).gte('date_prevue', startDay),
        admin ? supabase.from('factures').select('montant_ttc, statut_paiement').gte('created_at', startMonth) : Promise.resolve({ data: [] }),
        admin ? supabase.from('commissions').select('commission_admin').eq('statut', 'a_payer') : Promise.resolve({ data: [] }),
        supabase.from('messages').select('id', { count: 'exact', head: true }).eq('destinataire_id', user!.id).eq('lu', false),
        admin ? supabase.from('devis').select('id', { count: 'exact', head: true }).eq('statut', 'envoye') : Promise.resolve({ count: 0 }),
        (!admin && !isAssistant) ? supabase.from('commissions').select('part_intervenant, statut').eq('intervenant_id', user!.id).gte('created_at', startMonth) : Promise.resolve({ data: [] }),
        isAssistant ? supabase.from('interventions').select('id', { count: 'exact', head: true }).eq('statut', 'en_attente') : Promise.resolve({ count: 0 }),
      ])
      const fa = factures || []
      const impayees = fa.filter(f => f.statut_paiement === 'impayee')
      const comm = (commissionsDues as any[] || [])
      const myComm = (mesCommissions as any[] || [])
      return {
        interventions_today: todayCount || 0,
        ca_mois: fa.filter(f => f.statut_paiement === 'payee').reduce((s, f) => s + (f.montant_ttc || 0), 0),
        factures_impayees: impayees.length,
        montant_impaye: impayees.reduce((s, f) => s + (f.montant_ttc || 0), 0),
        commissions_dues: comm.reduce((s, c) => s + (c.commission_admin || 0), 0),
        devis_en_attente: devisWaiting || 0,
        messages_non_lus: msgs || 0,
        mes_commissions_mois: myComm.reduce((s, c) => s + (c.part_intervenant || 0), 0),
        mes_commissions_dues: myComm.filter(c => c.statut === 'a_payer').reduce((s, c) => s + (c.part_intervenant || 0), 0),
        interventions_a_planifier: aPlanifier || 0,
      }
    },
    refetchInterval: 30_000,
    enabled: !!user
  })
}

// ── PROFILES ─────────────────────────────────────────────────────
export function useProfiles() {
  return useQuery<Profile[]>({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').order('nom')
      if (error) throw error
      return data || []
    }
  })
}
export function useIntervenants() {
  return useQuery<Profile[]>({
    queryKey: ['intervenants'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'intervenant')
        .order('nom')
      if (error) throw error
      return data || []
    },
    staleTime: 0
  })
}
export function useUpdateProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...data }: Partial<Profile> & { id: string }) => {
      const { error } = await supabase.from('profiles').update(data).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profiles'] })
  })
}

// ── PARAMETRES ───────────────────────────────────────────────────
// Version complète (iban/bic inclus) — réservée admin par RLS
// (params_select_admin). Pour tout autre rôle, retourne null : utiliser
// usePublicParametres() pour les champs non sensibles.
export function useParametres() {
  return useQuery<ParametresEntreprise | null>({
    queryKey: ['parametres'],
    queryFn: async () => {
      const { data, error } = await supabase.from('parametres_entreprise').select('*').maybeSingle()
      if (error) throw error
      return data
    },
    staleTime: 1000 * 60 * 10
  })
}
// Version publique (sans iban/bic) — accessible à tout membre de
// l'organisation via la vue parametres_entreprise_public. À utiliser
// pour l'UI générale, les mentions légales du PDF (SIRET/TVA/RC Pro
// sont publiques), et REQUIRED_PARAMS, quel que soit le rôle.
export function usePublicParametres() {
  return useQuery<ParametresEntreprisePublic | null>({
    queryKey: ['parametres-public'],
    queryFn: async () => {
      const { data, error } = await supabase.from('parametres_entreprise_public').select('*').maybeSingle()
      if (error) throw error
      return data
    },
    staleTime: 1000 * 60 * 10
  })
}
export function useUpdateParametres() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: Partial<ParametresEntreprise>) => {
      const { data: ex } = await supabase.from('parametres_entreprise').select('id').maybeSingle()
      if (ex) {
        const { error } = await supabase.from('parametres_entreprise').update(data).eq('id', ex.id)
        if (error) throw error
      } else {
        const org_id = orgId()
        if (!org_id) throw new Error("Organisation introuvable — reconnectez-vous")
        const { error } = await supabase.from('parametres_entreprise').insert({ ...data, organisation_id: org_id })
        if (error) throw error
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['parametres'] })
  })
}

export const REQUIRED_PARAMS: Array<{ field: keyof ParametresEntreprisePublic; label: string }> = [
  { field: 'raison_sociale', label: 'Raison sociale' },
  { field: 'email',          label: 'Email entreprise' },
  { field: 'telephone',      label: 'Téléphone' },
  { field: 'adresse',        label: 'Adresse' },
]

// Champs non sensibles uniquement (raison_sociale/email/telephone/
// adresse) : doit fonctionner pour tous les rôles, pas seulement admin.
export function useParamsCompletion() {
  const { data: params, isLoading } = usePublicParametres()
  if (isLoading) {
    return { isComplete: true, missingFields: [] as typeof REQUIRED_PARAMS, isLoaded: false }
  }
  const missing = params
    ? REQUIRED_PARAMS.filter(f => !params[f.field])
    : [...REQUIRED_PARAMS]
  return { isComplete: missing.length === 0, missingFields: missing, isLoaded: true }
}

// ── CLIENTS ──────────────────────────────────────────────────────
export function useClients(search?: string, showArchived = false) {
  return useQuery<Client[]>({
    queryKey: ['clients', search, showArchived],
    queryFn: async () => {
      let q = supabase.from('clients').select('*').order('nom')
      if (search) q = q.or(`nom.ilike.%${search}%,email.ilike.%${search}%,telephone.ilike.%${search}%`)
      const { data, error } = await q
      if (error) throw error
      const all = data || []
      // Filtrage côté client — fonctionne avant et après migration (archive peut être undefined)
      return showArchived
        ? all.filter(c => c.archive === true)
        : all.filter(c => c.archive !== true)
    }
  })
}
export function useCreateClient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: Omit<Client, 'id'|'created_at'|'updated_at'>) => {
      const org_id = orgId(); if (!org_id) throw new Error("Organisation introuvable — reconnectez-vous")
      const { data: result, error } = await supabase.from('clients').insert({ ...data, created_by: uid(), organisation_id: org_id }).select().single()
      if (error) throw error; return result
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] })
  })
}
export function useUpdateClient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...data }: Partial<Client> & { id: string }) => {
      const { error } = await supabase.from('clients').update(data).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] })
  })
}
export function useArchiveClient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, archive }: { id: string; archive: boolean }) => {
      console.log('[archive-client] id:', id, '| archive:', archive)
      const { data, error } = await supabase
        .from('clients')
        .update({ archive: archive })
        .eq('id', id)
        .select()
      console.log('[archive-client] result:', { data, error })
      if (error) throw error
      if (!data || data.length === 0) throw new Error('Aucune ligne mise à jour — droits insuffisants ou id introuvable')
      return data[0]
    },
    onMutate: async ({ id, archive }) => {
      await qc.cancelQueries({ queryKey: ['clients'] })
      const snapshot = qc.getQueriesData<Client[]>({ queryKey: ['clients'] })
      // Suppression immédiate de la liste courante
      snapshot.forEach(([key]) => {
        const showArchived = (key as any[])[2] as boolean
        qc.setQueryData<Client[]>(key as any, (old) => {
          if (!Array.isArray(old)) return old ?? []
          // Archivage → retirer de la vue non-archivée
          if (archive && !showArchived) return old.filter(c => c.id !== id)
          // Restauration → retirer de la vue archivée
          if (!archive && showArchived) return old.filter(c => c.id !== id)
          return old
        })
      })
      return { snapshot }
    },
    onError: (_err, _vars, ctx: any) => {
      if (ctx?.snapshot) ctx.snapshot.forEach(([key, data]: any) => qc.setQueryData(key, data))
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['clients'] })
  })
}
export function useDeleteClientSafe() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const [{ count: d }, { count: f }, { count: i }] = await Promise.all([
        supabase.from('devis').select('id', { count: 'exact', head: true }).eq('client_id', id),
        supabase.from('factures').select('id', { count: 'exact', head: true }).eq('client_id', id),
        supabase.from('interventions').select('id', { count: 'exact', head: true }).eq('client_id', id),
      ])
      if ((d || 0) + (f || 0) + (i || 0) > 0)
        throw new Error('Ce client a des données liées (devis, factures ou interventions). Archivez-le plutôt.')
      const { error } = await supabase.from('clients').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] })
  })
}
export function useBulkArchiveClients() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from('clients').update({ archive: true }).in('id', ids)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] })
  })
}
export function useDeleteArchivedClients() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from('clients').delete().in('id', ids)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] })
  })
}
export function useClient(id: string) {
  return useQuery<Client>({
    queryKey: ['client', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('*').eq('id', id).single()
      if (error) throw error
      return data
    },
    enabled: !!id
  })
}

// ── PRESTATIONS ──────────────────────────────────────────────────
export function usePrestations(categorie?: string) {
  return useQuery<Prestation[]>({
    queryKey: ['prestations', categorie],
    queryFn: async () => {
      let q = supabase.from('prestations').select('*').eq('actif', true).order('ordre').order('nom')
      if (categorie) q = q.eq('categorie', categorie)
      const { data, error } = await q
      if (error) throw error; return data || []
    },
    staleTime: 1000 * 60 * 5
  })
}
export function useAllPrestations() {
  return useQuery<Prestation[]>({
    queryKey: ['prestations-all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('prestations').select('*').order('categorie').order('ordre').order('nom')
      if (error) throw error; return data || []
    }
  })
}
export function useCreatePrestation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: Omit<Prestation, 'id'>) => {
      const org_id = orgId(); if (!org_id) throw new Error("Organisation introuvable — reconnectez-vous")
      const { data: result, error } = await supabase.from('prestations').insert({ ...data, organisation_id: org_id }).select().single()
      if (error) throw error; return result
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prestations'] })
      qc.invalidateQueries({ queryKey: ['prestations-all'] })
    }
  })
}
export function useUpdatePrestation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...data }: Partial<Prestation> & { id: string }) => {
      const { error } = await supabase.from('prestations').update(data).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prestations'] })
      qc.invalidateQueries({ queryKey: ['prestations-all'] })
    }
  })
}

export function useSeedDefaultPrestations() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (orgId: string) => {
      const { data, error } = await supabase.rpc('seed_default_prestations', { p_org_id: orgId })
      if (error) throw error
      return data as number
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prestations'] })
      qc.invalidateQueries({ queryKey: ['prestations-all'] })
    }
  })
}

// ── INTERVENTIONS ────────────────────────────────────────────────
export function useInterventions(filters?: { statut?: string; intervenant_id?: string; search?: string; showArchived?: boolean }) {
  const user = useAuthStore(s => s.user)
  return useQuery<Intervention[]>({
    queryKey: ['interventions', filters, user?.id],
    queryFn: async () => {
      let q = supabase.from('interventions')
        .select('*, client:clients(id,nom,prenom,telephone,ville_intervention), intervenant:profiles!intervenant_id(id,nom,prenom,email,commission_pct), photos(id,url,type)')
        .order('created_at', { ascending: false })
      if (!canManageOps()) q = q.eq('intervenant_id', user!.id)
      if (filters?.statut && filters.statut !== 'tous') q = q.eq('statut', filters.statut)
      if (filters?.intervenant_id) q = q.eq('intervenant_id', filters.intervenant_id)
      if (filters?.search) q = q.or(`description.ilike.%${filters.search}%,adresse.ilike.%${filters.search}%`)
      const { data, error } = await q
      if (error) throw error
      const all = (data || []) as any[]
      // Filtrage côté client — fonctionne avant et après migration (archive peut être undefined)
      return (filters?.showArchived
        ? all.filter(i => i.archive === true)
        : all.filter(i => i.archive !== true)) as any
    },
    enabled: !!user
  })
}
export function useArchiveIntervention() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, archive }: { id: string; archive: boolean }) => {
      console.log('[archive-intervention] id:', id, '| archive:', archive)
      const { data, error } = await supabase
        .from('interventions')
        .update({ archive: archive })
        .eq('id', id)
        .select()
      console.log('[archive-intervention] result:', { data, error })
      if (error) throw error
      if (!data || data.length === 0) throw new Error('Aucune ligne mise à jour — droits insuffisants ou id introuvable')
      return data[0]
    },
    onMutate: async ({ id, archive }) => {
      await qc.cancelQueries({ queryKey: ['interventions'] })
      const snapshot = qc.getQueriesData<Intervention[]>({ queryKey: ['interventions'] })
      snapshot.forEach(([key]) => {
        const filters = (key as any[])[1] as any
        const showArchived = filters?.showArchived as boolean
        qc.setQueryData<Intervention[]>(key as any, (old) => {
          if (!Array.isArray(old)) return old ?? []
          if (archive && !showArchived) return old.filter(i => i.id !== id)
          if (!archive && showArchived) return old.filter(i => i.id !== id)
          return old
        })
      })
      return { snapshot }
    },
    onError: (_err, _vars, ctx: any) => {
      if (ctx?.snapshot) ctx.snapshot.forEach(([key, data]: any) => qc.setQueryData(key, data))
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['interventions'] })
  })
}
export function useBulkArchiveInterventions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from('interventions').update({ archive: true }).in('id', ids)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['interventions'] })
  })
}
export function useDeleteArchivedInterventions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from('interventions').delete().in('id', ids)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['interventions'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }) }
  })
}
export function useIntervention(id: string) {
  return useQuery<Intervention>({
    queryKey: ['intervention', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('interventions')
        .select('*, client:clients(*), intervenant:profiles!intervenant_id(id,nom,prenom,email,telephone,commission_pct), photos(*)')
        .eq('id', id).single()
      if (error) throw error; return data as any
    },
    enabled: !!id
  })
}
export function useCreateIntervention() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: Partial<Intervention>) => {
      const { numero: _dropNumero, ...cleanData } = data
      console.log('[create-intervention payload]', cleanData)
      const org_id = orgId(); if (!org_id) throw new Error("Organisation introuvable — reconnectez-vous")
      const { data: result, error } = await supabase.from('interventions').insert({ ...cleanData, created_by: uid(), tva_pct: cleanData.tva_pct || 10, organisation_id: org_id }).select().single()
      if (error) {
        if (error.code === '23505') throw new Error('Numéro d\'intervention déjà utilisé — veuillez réessayer.')
        throw error
      }
      const lien = `/interventions/${(result as any).id}`
      // Si un intervenant est assigné dès la création, le notifier
      if (data.intervenant_id) {
        notifyUser(data.intervenant_id, '🚨 Nouvelle intervention', 'Une intervention vous a été attribuée.', lien).catch(() => {})
      }
      // Créée par un assistant → prévenir l'admin (visibilité sur le dispatch)
      const creator = useAuthStore.getState().user
      if (creator?.role === 'assistant') {
        const creatorName = `${creator.prenom || ''} ${creator.nom || ''}`.trim()
        notifyAdmins('🆕 Intervention créée par l\'assistant', `${creatorName} a créé une nouvelle intervention.`, lien).catch(() => {})
      }
      return result
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['interventions'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); qc.invalidateQueries({ queryKey: ['interventions-pending-count'] }) }
  })
}
export function useUpdateIntervention() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...data }: Partial<Intervention> & { id: string }) => {
      const { error } = await supabase.from('interventions').update(data).eq('id', id)
      if (error) throw error
      const lien = `/interventions/${id}`
      const user = useAuthStore.getState().user
      const userName = `${user?.prenom || ''} ${user?.nom || ''}`.trim()
      if (data.statut === 'accepte') {
        notifyAdmins('✅ Intervention acceptée', `${userName} a accepté une intervention.`, lien).catch(() => {})
      } else if (data.statut === 'refuse') {
        notifyAdmins('❌ Intervention refusée', `${userName} a refusé une intervention.`, lien).catch(() => {})
      } else if (data.intervenant_id) {
        // Réassignation d'intervenant
        notifyUser(data.intervenant_id, '🚨 Nouvelle intervention', 'Une intervention vous a été attribuée.', lien).catch(() => {})
        // Assignée/réassignée par un assistant → prévenir l'admin
        if (user?.role === 'assistant') {
          notifyAdmins('🔄 Intervention assignée par l\'assistant', `${userName} a assigné un intervenant sur une intervention.`, lien).catch(() => {})
        }
      } else if (data.statut) {
        // Autre changement de statut → notifier l'intervenant assigné
        const { data: current } = await supabase.from('interventions').select('intervenant_id').eq('id', id).single()
        if (current?.intervenant_id) {
          notifyUser(current.intervenant_id, '🔄 Intervention mise à jour', 'Une intervention vous concernant a été modifiée.', lien).catch(() => {})
        }
      }
    },
    onSuccess: (_: any, v: any) => {
      qc.invalidateQueries({ queryKey: ['interventions'] })
      qc.invalidateQueries({ queryKey: ['intervention', v.id] })
      qc.invalidateQueries({ queryKey: ['interventions-pending-count'] })
    }
  })
}
export function useDeleteIntervention() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('interventions').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['interventions'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['interventions-pending-count'] })
      // Nettoyage des notifications orphelines (cross-user) géré côté DB par un trigger ;
      // on invalide localement pour refléter la suppression immédiatement.
      qc.invalidateQueries({ queryKey: ['notifications'] })
    }
  })
}
// Vérifie si une intervention a des enregistrements liés avant suppression physique
// (devis/factures gardent un lien nullable, mais commissions/justificatifs/photos
// sont supprimés en cascade — on veut avertir avant de perdre ces données).
export async function checkInterventionLinks(interventionId: string) {
  const [devis, factures, commissions, commissionReceipts, messages] = await Promise.all([
    supabase.from('devis').select('id', { count: 'exact', head: true }).eq('intervention_id', interventionId),
    supabase.from('factures').select('id', { count: 'exact', head: true }).eq('intervention_id', interventionId),
    supabase.from('commissions').select('id', { count: 'exact', head: true }).eq('intervention_id', interventionId),
    supabase.from('commission_receipts').select('id', { count: 'exact', head: true }).eq('intervention_id', interventionId),
    supabase.from('messages').select('id', { count: 'exact', head: true }).eq('intervention_id', interventionId),
  ])
  return {
    devis: devis.count || 0,
    factures: factures.count || 0,
    commissions: commissions.count || 0,
    commissionReceipts: commissionReceipts.count || 0,
    messages: messages.count || 0,
  }
}
export function useUploadPhoto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ file, interventionId, type }: { file: File; interventionId: string; type: 'avant'|'apres'|'autre' }) => {
      const org_id = orgId()
      if (!org_id) throw new Error("Organisation introuvable — reconnectez-vous")
      const { url, path, error } = await uploadPhotoStorage(file, interventionId, type)
      if (error) throw new Error(error)
      const { error: dbErr } = await supabase.from('photos').insert({
        intervention_id: interventionId,
        url,
        storage_path: path,
        type,
        uploaded_by: uid(),
        taille_octets: file.size,
        organisation_id: org_id
      })
      if (dbErr) throw dbErr
    },
    onSuccess: (_: any, v: any) => qc.invalidateQueries({ queryKey: ['intervention', v.interventionId] })
  })
}

// ── DEVIS ────────────────────────────────────────────────────────
export function useDevis(filters?: { statut?: string }) {
  const user = useAuthStore(s => s.user)
  return useQuery<Devis[]>({
    queryKey: ['devis', filters, user?.id],
    queryFn: async () => {
      let q = supabase.from('devis').select('id,numero,statut,total_ht,tva_montant,total_ttc,remise_pct,remise_montant,modele_id,valide_jusqu_au,envoye_le,notes,pdf_url,signature_url,signature_client,signature_date,signe_le,signe_par,created_at,updated_at,client_id,intervenant_id,intervention_id,activite,lignes,created_by, client:clients(id,nom,prenom,email,telephone), intervenant:profiles!intervenant_id(id,nom,prenom)').order('created_at', { ascending: false })
      if (!isAdm()) q = q.eq('intervenant_id', user!.id)
      if (filters?.statut && filters.statut !== 'tous') q = q.eq('statut', filters.statut)
      const { data, error } = await q
      if (error) throw error; return (data || []) as any
    },
    enabled: !!user
  })
}
export function useDevisById(id: string) {
  return useQuery<Devis>({
    queryKey: ['devis-single', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('devis').select('*, client:clients(*), intervenant:profiles!intervenant_id(*)').eq('id', id).single()
      if (error) throw error; return data as any
    },
    enabled: !!id && id !== 'nouveau'
  })
}
export function useCreateDevis() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: any) => {
      const user = useAuthStore.getState().user
      if (!isAdm()) {
        if (!user?.can_create_documents) throw new Error('Vous n\'êtes pas autorisé à créer des devis')
      }
      const { numero: _dropNumero, ...cleanDevis } = data
      const org_id = orgId(); if (!org_id) throw new Error("Organisation introuvable — reconnectez-vous")
      const { data: result, error } = await supabase.from('devis').insert({ ...cleanDevis, created_by: uid(), organisation_id: org_id }).select().single()
      if (error) {
        if (error.code === '23505') throw new Error('Numéro de devis déjà utilisé — veuillez réessayer.')
        throw error
      }
      if (!isAdm()) {
        if (data.statut === 'en_attente_validation') {
          await notifyAdmins(
            '📄 Nouveau devis à valider',
            `${user?.prenom || ''} ${user?.nom || ''} a soumis un devis en attente de validation`,
            '/devis'
          )
        } else {
          await notifyAdmins(
            'ℹ Nouveau devis créé',
            `${user?.prenom || ''} ${user?.nom || ''} a créé le devis ${(result as any)?.numero || ''}.`,
            '/devis'
          )
        }
      }
      return result
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devis'] })
  })
}
export function useUpdateDevis() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const { error } = await supabase.from('devis').update(data).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_: any, variables: any) => {
      if (variables.signature_client) pdfCache.del(variables.id)
      qc.invalidateQueries({ queryKey: ['devis'] })
      qc.invalidateQueries({ queryKey: ['devis-single'] })
    }
  })
}
export function useDeleteDevis() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('devis').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['devis'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      // Nettoyage des notifications orphelines (cross-user) géré côté DB par un trigger ;
      // on invalide localement pour refléter la suppression immédiatement.
      qc.invalidateQueries({ queryKey: ['notifications'] })
    }
  })
}
export function useDeleteAllDevis() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (!ids.length) return
      const { data, error } = await supabase.from('devis').delete().in('id', ids).select()
      if (error) throw error
      if (!data || data.length === 0) throw new Error('Suppression refusée — droits insuffisants ou devis introuvables')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['devis'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['notifications'] })
    }
  })
}
export function useDuplicateDevis() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (d: Devis) => {
      const user = useAuthStore.getState().user
      if (!isAdm() && !user?.can_create_documents) throw new Error('Vous n\'êtes pas autorisé à créer des devis')
      const org_id = orgId()
      if (!org_id) throw new Error('Organisation introuvable — reconnectez-vous')
      const payload: any = {
        client_id: d.client_id,
        intervenant_id: d.intervenant_id,
        activite: d.activite,
        lignes: d.lignes,
        remise_pct: d.remise_pct || 0,
        ...(d.remise_montant != null ? { remise_montant: d.remise_montant } : {}),
        total_ht: d.total_ht,
        tva_montant: d.tva_montant,
        total_ttc: d.total_ttc,
        modele_id: d.modele_id || 0,
        notes: d.notes,
        statut: 'brouillon',
        valide_jusqu_au: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
        created_by: uid(),
        organisation_id: org_id
      }
      const { data: result, error } = await supabase.from('devis').insert(payload).select().single()
      if (error) {
        if (error.code === '23505') throw new Error('Numéro de devis déjà utilisé — veuillez réessayer.')
        throw error
      }
      return result as Devis
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devis'] })
  })
}
export function useDevisToFacture() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (devisId: string) => {
      const { data: devis, error } = await supabase.from('devis').select('*').eq('id', devisId).single()
      if (error || !devis) throw new Error('Devis introuvable')
      if (!devis.client_id) throw new Error("Ce devis n'a pas de client associé")

      // Vérifier qu'une facture n'existe pas déjà pour ce devis
      const { count: existingCount } = await supabase
        .from('factures')
        .select('id', { count: 'exact', head: true })
        .eq('devis_id', devisId)
      if ((existingCount ?? 0) > 0)
        throw new Error('Ce devis a déjà été converti en facture — consultez l\'onglet Factures.')

      const org_id = orgId(); if (!org_id) throw new Error("Organisation introuvable — reconnectez-vous")
      const echeance = new Date(); echeance.setDate(echeance.getDate() + 30)
      const facturePayload: any = {
        devis_id: devisId,
        client_id: devis.client_id,
        montant_ht: devis.total_ht,
        tva_montant: devis.tva_montant,
        montant_ttc: devis.total_ttc,
        statut_paiement: 'impayee',
        date_echeance: echeance.toISOString().split('T')[0],
        created_by: uid(),
        ...(devis.notes ? { notes: devis.notes } : {}),
        organisation_id: org_id
      }
      if (devis.intervention_id) facturePayload.intervention_id = devis.intervention_id

      // Tentative avec retry sur conflit de numéro (trigger concurrent)
      let facture: any = null
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data, error: fErr } = await supabase.from('factures').insert(facturePayload).select().single()
        if (!fErr) { facture = data; break }
        if (fErr.code === '23505' && attempt < 2) continue
        if (fErr.code === '23505') throw new Error('Impossible de générer un numéro unique — veuillez réessayer.')
        throw fErr
      }

      const { error: updErr } = await supabase.from('devis').update({ statut: 'accepte' }).eq('id', devisId)
      if (updErr) console.warn('[devisToFacture] mise à jour statut devis échouée:', updErr.message)
      return facture
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['devis'] }); qc.invalidateQueries({ queryKey: ['factures'] }) }
  })
}

// ── NOTIFICATIONS ────────────────────────────────────────────────
// Priorité : Telegram si configuré → skip_push=true dans la notification (pas de doublon push)
// Fallback  : si Telegram non configuré ou échoue → push via trigger DB (skip_push=false)

const APP_URL = 'https://kaytek-inter.vercel.app'

function buildTelegramMessage(titre: string, contenu: string, lien?: string): string {
  const lines = [titre, contenu]
  if (lien) lines.push(`👉 Ouvrir : ${APP_URL}${lien}`)
  return lines.join('\n')
}

export async function notifyAdmins(titre: string, contenu: string, lien?: string) {
  const org_id = orgId()
  if (!org_id) return
  const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin').eq('organisation_id', org_id)
  if (!admins?.length) return
  const msg = buildTelegramMessage(titre, contenu, lien)
  for (const admin of admins) {
    let telegramSent = false
    try {
      const { data } = await supabase.functions.invoke('send-telegram', {
        body: { user_id: admin.id, message: msg }
      })
      telegramSent = data?.sent === true
    } catch { /* fallback vers push */ }
    try {
      await supabase.from('notifications').insert({
        user_id: admin.id, titre, contenu, type: 'info', lue: false, lien: lien || null,
        skip_push: telegramSent, organisation_id: org_id
      } as any)
    } catch { /* notifications table may not exist yet */ }
  }
}

export async function notifyUser(userId: string, titre: string, contenu: string, lien?: string) {
  const org_id = orgId()
  if (!org_id) return
  let telegramSent = false
  try {
    const { data } = await supabase.functions.invoke('send-telegram', {
      body: { user_id: userId, message: buildTelegramMessage(titre, contenu, lien) }
    })
    telegramSent = data?.sent === true
  } catch { /* fallback vers push */ }
  try {
    await supabase.from('notifications').insert({
      user_id: userId, titre, contenu, type: 'info', lue: false, lien: lien || null,
      skip_push: telegramSent, organisation_id: org_id
    } as any)
  } catch { /* notifications table may not exist yet */ }
}

// ── NOTIFICATIONS IN-APP ──────────────────────────────────────────
export function useMyNotifications() {
  const user = useAuthStore(s => s.user)
  const qc = useQueryClient()
  const { add } = useToastStore()

  const query = useQuery({
    queryKey: ['notifications', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications').select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) return []
      return data || []
    },
    refetchInterval: 30_000,
    enabled: !!user
  })

  // Realtime : toast immédiat + refresh quand une nouvelle notif arrive
  useEffect(() => {
    if (!user) return
    const ch = supabase.channel(`notif-rt-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications',
        filter: `user_id=eq.${user.id}`
      }, (payload: any) => {
        qc.invalidateQueries({ queryKey: ['notifications', user.id] })
        const n = payload.new
        if (n?.titre) add(`${n.titre}${n.contenu ? ' — ' + n.contenu : ''}`, 'info')
      })
      // Suppression côté DB (par ce user sur un autre appareil, ou par le
      // trigger de nettoyage en cascade quand l'élément lié est supprimé)
      .on('postgres_changes', {
        event: 'DELETE', schema: 'public', table: 'notifications',
        filter: `user_id=eq.${user.id}`
      }, () => qc.invalidateQueries({ queryKey: ['notifications', user.id] }))
      // Marquage lu/non-lu depuis un autre appareil
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'notifications',
        filter: `user_id=eq.${user.id}`
      }, () => qc.invalidateQueries({ queryKey: ['notifications', user.id] }))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [user?.id])

  return query
}

export function useMarkNotificationRead() {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  return useMutation({
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ['notifications', user?.id] })
      const prev = qc.getQueryData<any[]>(['notifications', user?.id])
      qc.setQueryData<any[]>(['notifications', user?.id], old =>
        (old || []).map(n => n.id === id ? { ...n, lue: true } : n)
      )
      console.log('[notif] markRead optimiste →', id)
      return { prev }
    },
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from('notifications')
        .update({ lue: true })
        .eq('id', id)
        .select()
      console.log('[notif] SUPABASE UPDATE RESULT', data, error)
      if (error) { console.error('[notif] markRead DB error:', error); throw error }
    },
    onError: (err: any, _id: any, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(['notifications', user?.id], ctx.prev)
      useToastStore.getState().add('Erreur lecture notif : ' + (err?.message || 'inconnue'), 'error')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications', user?.id] }),
  })
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  return useMutation<void, Error, void>({
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['notifications', user?.id] })
      const prev = qc.getQueryData<any[]>(['notifications', user?.id])
      qc.setQueryData<any[]>(['notifications', user?.id], old =>
        (old || []).map(n => ({ ...n, lue: true }))
      )
      console.log('[notif] markAllRead optimiste')
      return { prev }
    },
    mutationFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .update({ lue: true })
        .eq('user_id', user!.id).eq('lue', false)
        .select()
      console.log('[notif] SUPABASE UPDATE ALL RESULT', data, error)
      if (error) { console.error('[notif] markAllRead DB error:', error); throw error }
    },
    onError: (err: any, _: any, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(['notifications', user?.id], ctx.prev)
      useToastStore.getState().add('Erreur tout lu : ' + (err?.message || 'inconnue'), 'error')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications', user?.id] }),
  })
}

export function useDeleteNotification() {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  return useMutation({
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ['notifications', user?.id] })
      const prev = qc.getQueryData<any[]>(['notifications', user?.id])
      qc.setQueryData<any[]>(['notifications', user?.id], old =>
        (old || []).filter(n => n.id !== id)
      )
      console.log('[notif] delete optimiste →', id)
      return { prev }
    },
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from('notifications').delete().eq('id', id).select()
      console.log('[notif] SUPABASE DELETE RESULT', data, error)
      if (error) { console.error('[notif] delete DB error:', error); throw error }
    },
    onError: (err: any, _id: any, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(['notifications', user?.id], ctx.prev)
      useToastStore.getState().add('Erreur suppression notif : ' + (err?.message || 'inconnue'), 'error')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications', user?.id] }),
  })
}

export function useDeleteAllReadNotifications() {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  return useMutation<void, Error, void>({
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['notifications', user?.id] })
      const prev = qc.getQueryData<any[]>(['notifications', user?.id])
      qc.setQueryData<any[]>(['notifications', user?.id], old =>
        (old || []).filter(n => !n.lue)
      )
      console.log('[notif] deleteAllRead optimiste')
      return { prev }
    },
    mutationFn: async () => {
      const { data, error } = await supabase
        .from('notifications').delete()
        .eq('user_id', user!.id).eq('lue', true)
        .select()
      console.log('[notif] SUPABASE DELETE ALL READ RESULT', data, error)
      if (error) { console.error('[notif] deleteAllRead DB error:', error); throw error }
    },
    onError: (err: any, _: any, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(['notifications', user?.id], ctx.prev)
      useToastStore.getState().add('Erreur suppression lues : ' + (err?.message || 'inconnue'), 'error')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications', user?.id] }),
  })
}

// ── FACTURES ─────────────────────────────────────────────────────
export function useFactures(filters?: { statut?: string }) {
  const user = useAuthStore(s => s.user)
  return useQuery<Facture[]>({
    queryKey: ['factures', filters, user?.id],
    queryFn: async () => {
      let q = supabase.from('factures').select('*, client:clients(id,nom,prenom,email,telephone), devis:devis(id,numero,modele_id,activite,lignes,total_ht,tva_montant,total_ttc,remise_pct,remise_montant)').order('created_at', { ascending: false })
      if (filters?.statut && filters.statut !== 'tous') q = q.eq('statut_paiement', filters.statut)
      const { data, error } = await q
      if (error) throw error; return (data || []) as any
    },
    enabled: !!user
  })
}
export function useCreateFacture() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: Partial<Facture> & { intervention_id: string }) => {
      const user = useAuthStore.getState().user
      if (!isAdm()) {
        if (!user?.can_create_documents) throw new Error('Vous n\'êtes pas autorisé à créer des factures')
      }
      const canBypass = !isAdm() && user?.can_bypass_validation === true
      const { numero: _dropNumero, ...cleanFacture } = data
      const org_id = orgId(); if (!org_id) throw new Error("Organisation introuvable — reconnectez-vous")
      const payload = {
        ...cleanFacture,
        statut_paiement: canBypass ? 'impayee' : 'en_attente_validation',
        date_emission: new Date().toISOString().split('T')[0],
        created_by: uid(),
        acompte_recu: cleanFacture.acompte_recu ?? 0,
        organisation_id: org_id
      }
      const { data: result, error } = await supabase.from('factures').insert(payload).select().single()
      if (error) {
        if (error.code === '23505') throw new Error('Numéro de facture déjà utilisé — veuillez réessayer.')
        throw error
      }
      if (canBypass) {
        await notifyAdmins(
          'ℹ Nouvelle facture créée',
          `${user?.prenom || ''} ${user?.nom || ''} a créé une facture directement.`,
          '/factures'
        )
      } else {
        await notifyAdmins(
          '🧾 Nouvelle facture à valider',
          `${user?.prenom || ''} ${user?.nom || ''} a soumis une facture en attente de validation`,
          '/factures'
        )
      }
      return result
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['factures'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }) }
  })
}
export function useUpdateFacture() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...data }: Partial<Facture> & { id: string }) => {
      const { data: updated, error } = await supabase.from('factures').update(data).eq('id', id).select()
      if (error) throw error
      if (!updated || updated.length === 0) throw new Error('Mise à jour impossible — droits insuffisants ou facture introuvable')
      console.log('[useUpdateFacture] DB updated', updated[0]?.id, '| statut_paiement:', updated[0]?.statut_paiement, '| statut:', (updated[0] as any)?.statut)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['factures'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['commissions-data'] })
    }
  })
}
export function useDeleteFacture() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('factures').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['factures'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['commissions-data'] })
    }
  })
}
export function useDeleteAllFactures() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (!ids.length) return
      const { data, error } = await supabase.from('factures').delete().in('id', ids).select()
      if (error) throw error
      if (!data || data.length === 0) throw new Error('Suppression refusée — droits insuffisants ou factures introuvables')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['factures'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['commissions-data'] })
    }
  })
}

// ── COMMISSIONS ──────────────────────────────────────────────────
export function useCommissions(intervenantId?: string) {
  const user = useAuthStore(s => s.user)
  const targetId = intervenantId || (!isAdm() ? user?.id : undefined)
  return useQuery<Commission[]>({
    queryKey: ['commissions', targetId],
    queryFn: async () => {
      let q = supabase.from('commissions').select('*, intervenant:profiles!intervenant_id(id,nom,prenom,commission_pct), intervention:interventions(id,numero,adresse)').order('created_at', { ascending: false })
      if (targetId) q = q.eq('intervenant_id', targetId)
      const { data, error } = await q
      if (error) throw error; return (data || []) as any
    },
    enabled: !!user
  })
}
export function useUpdateCommission() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, statut }: { id: string; statut: 'a_payer'|'paye' }) => {
      const { error } = await supabase.from('commissions').update({ statut, paye_le: statut === 'paye' ? new Date().toISOString() : null }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['commissions'] })
  })
}

export function useCommissionsData() {
  const user = useAuthStore(s => s.user)
  return useQuery({
    queryKey: ['commissions-data', user?.id],
    queryFn: async () => {
      console.log('[commissions] user', user?.id, user?.role)

      // !inner = INNER JOIN requis pour filtrer sur intervention.intervenant_id
      let q = supabase.from('factures')
        .select(`
          id, numero, montant_ttc, date_paiement, created_at,
          intervention:intervention_id!inner(
            id, numero, adresse, intervenant_id, cout_pieces, materiel_confirme, materiel_payeur,
            intervenant:profiles!intervenant_id(id, nom, prenom, commission_pct)
          ),
          client:client_id(id, nom, prenom)
        `)
        .eq('statut_paiement', 'payee')
        .order('created_at', { ascending: false })

      // Admin voit tout ; intervenant voit uniquement ses interventions
      if (!isAdm()) q = (q as any).eq('intervention.intervenant_id', user!.id)

      const { data, error } = await q
      if (error) throw error

      const factures = (data || []) as any[]
      console.log('[commissions] factures payées', factures.length, factures)

      // Statuts "reçue" depuis commission_receipts (table optionnelle — silencieux si absente)
      const factureIds = factures.map(f => f.id)
      const receiptsMap: Record<string, any> = {}
      if (factureIds.length > 0) {
        const { data: receipts } = await supabase
          .from('commission_receipts')
          .select('id, facture_id, intervenant_id, recue, recue_le')
          .in('facture_id', factureIds)
        ;(receipts || []).forEach((r: any) => {
          receiptsMap[`${r.facture_id}_${r.intervenant_id}`] = r
        })
      }

      const result = factures
        .filter(f => f.intervention?.intervenant_id)
        .map(f => {
          const inter = f.intervention
          const intervenant = inter?.intervenant
          const commPct = intervenant?.commission_pct ?? 30
          const ttc = f.montant_ttc || 0
          const coutPieces = (inter?.materiel_confirme && inter?.cout_pieces) ? inter.cout_pieces : 0
          const base = Math.max(0, Math.round((ttc - coutPieces) * 100) / 100)
          const commIntervenant = Math.round(base * commPct / 100 * 100) / 100
          const resteEntreprise = Math.round((base - commIntervenant) * 100) / 100
          const receipt = receiptsMap[`${f.id}_${inter.intervenant_id}`]
          return {
            id: f.id,
            facture_numero: f.numero,
            intervention_id: inter?.id,
            intervention_numero: inter?.numero,
            intervention_adresse: inter?.adresse,
            intervenant_id: inter?.intervenant_id,
            intervenant,
            client: f.client,
            montant_ttc: ttc,
            cout_pieces: coutPieces,
            cout_pieces_raw: inter?.cout_pieces || 0,
            materiel_confirme: inter?.materiel_confirme || false,
            materiel_payeur: inter?.materiel_payeur || null,
            base_commissionnable: base,
            commission_pct: commPct,
            commission_intervenant: commIntervenant,
            reste_entreprise: resteEntreprise,
            date_paiement: f.date_paiement,
            created_at: f.created_at,
            recue: receipt?.recue === true,
            recue_le: receipt?.recue_le || null,
          }
        })

      // Compter les factures payées sans intervention (non incluses dans les commissions) — admin uniquement
      let unattributedCount = 0
      if (isAdm()) {
        const { count } = await supabase
          .from('factures')
          .select('*', { count: 'exact', head: true })
          .eq('statut_paiement', 'payee')
          .is('intervention_id', null)
        unattributedCount = count || 0
      }

      return { items: result, unattributedCount }
    },
    enabled: !!user,
  })
}

export function useMarkCommissionReceived() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ facture_id, intervention_id }: { facture_id: string; intervention_id: string }) => {
      const intervenant_id = uid()
      if (!intervenant_id) throw new Error('Non authentifié')
      const org_id = orgId()
      if (!org_id) throw new Error("Organisation introuvable — reconnectez-vous")
      const { error } = await supabase
        .from('commission_receipts')
        .upsert(
          { facture_id, intervention_id, intervenant_id, recue: true, recue_le: new Date().toISOString(), organisation_id: org_id },
          { onConflict: 'facture_id,intervenant_id' }
        )
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['commissions-data'] }),
  })
}

export function useUpdateInterventionMateriel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ intervention_id, cout_pieces, materiel_payeur, confirmer }: {
      intervention_id: string; cout_pieces: number; materiel_payeur: string | null; confirmer: boolean
    }) => {
      const payload: any = { cout_pieces, materiel_payeur }
      if (confirmer) {
        payload.materiel_confirme = true
        payload.materiel_confirme_par = uid()
        payload.materiel_confirme_at = new Date().toISOString()
      } else {
        payload.materiel_confirme = false
        payload.materiel_confirme_par = null
        payload.materiel_confirme_at = null
      }
      const { error } = await supabase.from('interventions').update(payload).eq('id', intervention_id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['commissions-data'] }),
  })
}

// ── MESSAGES + REALTIME ──────────────────────────────────────────
export function useMessages(withUserId: string) {
  const user = useAuthStore(s => s.user)
  const qc = useQueryClient()
  const query = useQuery<Message[]>({
    queryKey: ['messages', withUserId, user?.id],
    queryFn: async () => {
      if (!user) return []
      const { data, error } = await supabase.from('messages')
        .select('*, expediteur:profiles!expediteur_id(id,nom,prenom)')
        .or(`and(expediteur_id.eq.${user.id},destinataire_id.eq.${withUserId}),and(expediteur_id.eq.${withUserId},destinataire_id.eq.${user.id})`)
        .order('created_at', { ascending: true })
      if (error) throw error
      const msgs = (data || []) as any[]
      // Marquer comme lus
      const unread = msgs.filter((m: any) => m.destinataire_id === user.id && !m.lu).map((m: any) => m.id)
      if (unread.length) await supabase.from('messages').update({ lu: true, lu_le: new Date().toISOString() }).in('id', unread)
      // Régénérer les URLs signées pour les médias (path stocké dans media_url ou contenu)
      const mediaMsgs = msgs.filter((m: any) =>
        ['audio', 'photo', 'vocal'].includes(m.type) &&
        m.media_url && !m.media_url.startsWith('http')
      )
      if (mediaMsgs.length) {
        const paths = mediaMsgs.map((m: any) => m.media_url)
        const { data: signed } = await supabase.storage.from('chat-media').createSignedUrls(paths, 604800)
        const signedMap: Record<string, string> = {}
        signed?.forEach((s: any, i: number) => { if (s.signedUrl) signedMap[paths[i]] = s.signedUrl })
        return msgs.map((m: any) => {
          if (['audio', 'photo', 'vocal'].includes(m.type) && m.media_url && signedMap[m.media_url]) {
            return { ...m, contenu: signedMap[m.media_url] }
          }
          return m
        })
      }
      return msgs
    },
    enabled: !!user && !!withUserId
  })
  useEffect(() => {
    if (!user || !withUserId) return
    const ch = supabase.channel(`chat-${user.id}-${withUserId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
        () => qc.invalidateQueries({ queryKey: ['messages', withUserId, user.id] }))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [user, withUserId, qc])
  return query
}

export function useSendMessage() {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  return useMutation({
    mutationFn: async ({ destinataire_id, contenu, intervention_id, type = 'texte', media_url }: { destinataire_id: string; contenu: string; intervention_id?: string; type?: Message['type']; media_url?: string }) => {
      // Sécurité : un intervenant ne peut envoyer qu'à un admin ; un assistant peut
      // écrire à l'admin ET aux intervenants (coordination opérationnelle) ; l'admin
      // peut écrire à tout le monde.
      if (user!.role === 'intervenant') {
        const { data: dest } = await supabase.from('profiles').select('role').eq('id', destinataire_id).single()
        if (!dest || dest.role !== 'admin') throw new Error('Vous ne pouvez envoyer des messages qu\'à l\'administrateur')
      } else if (user!.role === 'assistant') {
        const { data: dest } = await supabase.from('profiles').select('role').eq('id', destinataire_id).single()
        if (!dest || (dest.role !== 'admin' && dest.role !== 'intervenant')) throw new Error('Vous ne pouvez envoyer des messages qu\'à l\'administrateur ou aux intervenants')
      }
      const org_id = orgId()
      if (!org_id) throw new Error("Organisation introuvable — reconnectez-vous")
      const payload: any = { expediteur_id: user!.id, destinataire_id, contenu, type, organisation_id: org_id }
      if (intervention_id) payload.intervention_id = intervention_id
      if (media_url) payload.media_url = media_url
      const { error } = await supabase.from('messages').insert(payload)
      if (error) throw error
      // Telegram en priorité — push uniquement si Telegram non configuré ou échoue
      const senderName = `${user!.prenom || ''} ${user!.nom || ''}`.trim() || 'Kaytek'
      const pushContenu = type === 'texte' ? contenu : type === 'audio' ? '🎤 Message vocal' : '📷 Photo'
      const telegramMsg = [
        '💬 NOUVEAU MESSAGE',
        `${senderName} vous a envoyé un message.`,
        `👉 Ouvrir : ${APP_URL}/messagerie/${user!.id}`,
      ].join('\n')
      let telegramSent = false
      try {
        const { data } = await supabase.functions.invoke('send-telegram', {
          body: { user_id: destinataire_id, message: telegramMsg }
        })
        telegramSent = data?.sent === true
      } catch { /* fallback vers push */ }
      if (!telegramSent) {
        supabase.functions.invoke('send-push', {
          body: { user_id: destinataire_id, titre: `💬 ${senderName}`, contenu: pushContenu, lien: `/messagerie/${user!.id}` }
        }).catch(() => {})
      }
    },
    onSuccess: (_: any, v: any) => qc.invalidateQueries({ queryKey: ['messages', v.destinataire_id] })
  })
}

export function useDeleteMessage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, mediaPath }: { id: string; mediaPath?: string }) => {
      const { error } = await supabase.from('messages').delete().eq('id', id)
      if (error) throw new Error(error.message)
      if (mediaPath && !mediaPath.startsWith('http')) {
        await supabase.storage.from('chat-media').remove([mediaPath]).catch(() => {})
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages'] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
      qc.invalidateQueries({ queryKey: ['unread'] })
    },
  })
}

export function useConversations() {
  const user = useAuthStore(s => s.user)
  const qc = useQueryClient()

  // Realtime: rafraîchir la liste quand un message arrive
  useEffect(() => {
    if (!user) return
    const ch = supabase.channel(`conv-rt-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `destinataire_id=eq.${user.id}`
      }, () => qc.invalidateQueries({ queryKey: ['conversations', user.id] }))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [user?.id, qc])

  return useQuery<(Profile & { lastMessage: any; unreadCount: number })[]>({
    queryKey: ['conversations', user?.id],
    queryFn: async () => {
      // 1. Contacts disponibles — admin : tout le monde ; assistant : admin + intervenants
      // (coordination opérationnelle) ; intervenant : admin uniquement.
      let q = supabase.from('profiles').select('*').neq('id', user!.id).eq('actif', true)
      if (user!.role === 'intervenant') q = q.eq('role', 'admin')
      else if (user!.role === 'assistant') q = q.in('role', ['admin', 'intervenant'])
      const { data: profiles } = await q.order('nom')
      const profileList = (profiles || []) as Profile[]
      if (!profileList.length) return []

      // 2. Messages récents pour preview + unread count
      const { data: recentMsgs } = await supabase
        .from('messages')
        .select('id, expediteur_id, destinataire_id, contenu, type, created_at, lu')
        .or(`expediteur_id.eq.${user!.id},destinataire_id.eq.${user!.id}`)
        .order('created_at', { ascending: false })
        .limit(300)

      const msgs = recentMsgs || []
      const partnerSet = new Set(profileList.map(p => p.id))
      const convMap: Record<string, { lastMsg: any; unreadCount: number }> = {}
      for (const p of profileList) convMap[p.id] = { lastMsg: null, unreadCount: 0 }

      for (const m of msgs) {
        const partnerId = m.expediteur_id === user!.id ? m.destinataire_id : m.expediteur_id
        if (!partnerSet.has(partnerId)) continue
        if (!convMap[partnerId].lastMsg) convMap[partnerId].lastMsg = m
        // Comptage non lus : messages du partenaire vers moi, non lus
        if (m.expediteur_id === partnerId && m.destinataire_id === user!.id && !m.lu) {
          convMap[partnerId].unreadCount++
        }
      }

      // 3. Tri : non lus d'abord, puis par heure du dernier message
      return profileList
        .map(p => ({ ...p, lastMessage: convMap[p.id].lastMsg, unreadCount: convMap[p.id].unreadCount }))
        .sort((a, b) => {
          const au = a.unreadCount > 0 ? 1 : 0
          const bu = b.unreadCount > 0 ? 1 : 0
          if (bu !== au) return bu - au
          const at = a.lastMessage?.created_at || a.created_at
          const bt = b.lastMessage?.created_at || b.created_at
          return bt.localeCompare(at)
        })
    },
    enabled: !!user,
    refetchInterval: 45_000
  })
}

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string

export function useRequestNotificationPermission() {
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])
}

const VAPID_KEY_STORE = 'kaytek-vapid-v'

function b64urlToUint8(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = (4 - (padded.length % 4)) % 4
  return Uint8Array.from(atob(padded + '='.repeat(pad)), c => c.charCodeAt(0))
}

export function usePushSubscription() {
  const user = useAuthStore(s => s.user)

  useEffect(() => {
    if (!user || !('serviceWorker' in navigator) || !('PushManager' in window) || !VAPID_PUBLIC_KEY) return

    async function setupPush() {
      let permission = Notification.permission
      if (permission === 'default') permission = await Notification.requestPermission()
      if (permission !== 'granted') return

      const registration = await navigator.serviceWorker.ready

      // Si la clé VAPID a changé, on force une nouvelle subscription
      let sub = await registration.pushManager.getSubscription()
      const storedKey = localStorage.getItem(VAPID_KEY_STORE)
      if (sub && storedKey !== VAPID_PUBLIC_KEY) {
        await sub.unsubscribe()
        sub = null
      }

      if (!sub) {
        sub = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: b64urlToUint8(VAPID_PUBLIC_KEY) as BufferSource,
        })
        localStorage.setItem(VAPID_KEY_STORE, VAPID_PUBLIC_KEY)
      }

      const json = sub.toJSON()
      const p256dh = json.keys?.p256dh
      const auth = json.keys?.auth
      if (!p256dh || !auth) return

      const org_id = user?.organisation_id
      if (!org_id) return

      // Upsert: INSERT ou UPDATE (les deux opérations)
      await supabase.from('push_subscriptions').upsert({
        user_id: user!.id,
        endpoint: sub.endpoint,
        p256dh,
        auth,
        organisation_id: org_id,
      }, { onConflict: 'endpoint' })
    }

    setupPush().catch(console.error)
  }, [user])
}

function showMessageNotification(senderName: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  if (document.visibilityState === 'visible') return
  const n = new Notification('Nouveau message — Kaytek Inter', {
    body: `${senderName} vous a envoyé un message`,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'nouveau-message',
  })
  n.onclick = () => { window.focus(); n.close() }
}

export function useUnreadCount() {
  const user = useAuthStore(s => s.user)
  const qc = useQueryClient()
  const q = useQuery<number>({
    queryKey: ['unread', user?.id],
    queryFn: async () => {
      const { count } = await supabase.from('messages').select('id', { count: 'exact', head: true }).eq('destinataire_id', user!.id).eq('lu', false)
      return count || 0
    },
    enabled: !!user,
    refetchInterval: 60_000
  })
  useEffect(() => {
    if (!user) return
    const ch = supabase.channel('unread-badge')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `destinataire_id=eq.${user.id}` },
        async (payload: any) => {
          qc.invalidateQueries({ queryKey: ['unread', user.id] })
          const senderId = payload?.new?.expediteur_id
          if (senderId) {
            const { data: profile } = await supabase.from('profiles').select('prenom,nom').eq('id', senderId).single()
            const name = profile ? `${profile.prenom || ''} ${profile.nom || ''}`.trim() : 'Quelqu\'un'
            showMessageNotification(name)
          }
        })
      // Suppression d'un message non lu (par l'expéditeur ou un autre appareil) → recalcul immédiat du badge
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages', filter: `destinataire_id=eq.${user.id}` },
        () => {
          qc.invalidateQueries({ queryKey: ['unread', user.id] })
          qc.invalidateQueries({ queryKey: ['conversations', user.id] })
        })
      // Message marqué lu depuis un autre appareil
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `destinataire_id=eq.${user.id}` },
        () => qc.invalidateQueries({ queryKey: ['unread', user.id] }))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [user, qc])
  return q
}

// ── JOURNAL ──────────────────────────────────────────────────────
export function useJournal() {
  return useQuery({
    queryKey: ['journal'],
    queryFn: async () => {
      const { data, error } = await supabase.from('journal').select('*').order('created_at', { ascending: false }).limit(200)
      if (error) throw error; return data || []
    }
  })
}

export function useDeleteJournalEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from('journal').delete().eq('id', id).select()
      if (error) throw error
      if (!data || data.length === 0) throw new Error('Suppression impossible — droits insuffisants ou entrée introuvable')
    },
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ['journal'] })
      const previous = qc.getQueryData<JournalEntry[]>(['journal'])
      qc.setQueryData<JournalEntry[]>(['journal'], old => (old ?? []).filter(j => j.id !== id))
      return { previous }
    },
    onError: (_err: unknown, _id: string, context: any) => {
      if (context?.previous) qc.setQueryData(['journal'], context.previous)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['journal'] })
  })
}

export function useDeleteAllJournal() {
  const qc = useQueryClient()
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      const org_id = orgId()
      if (!org_id) throw new Error('Organisation introuvable — reconnectez-vous')
      const { error } = await supabase.from('journal').delete().eq('organisation_id', org_id)
      if (error) throw error
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['journal'] })
      const previous = qc.getQueryData<JournalEntry[]>(['journal'])
      qc.setQueryData<JournalEntry[]>(['journal'], [])
      return { previous }
    },
    onError: (_err: unknown, _vars: unknown, context: any) => {
      if (context?.previous) qc.setQueryData(['journal'], context.previous)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['journal'] })
  })
}

export function useUpdateJournalEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, description }: { id: string; description: string }) => {
      const { error } = await supabase.from('journal').update({ description }).eq('id', id)
      if (error) throw error
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['journal'] })
  })
}

// ── LIENS PUBLICS ────────────────────────────────────────────────
export function useCreatePublicLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ document_type, document_id }: { document_type: 'devis' | 'facture'; document_id: string }) => {
      const org_id = orgId()
      if (!org_id) throw new Error('Organisation introuvable — reconnectez-vous')
      const { data, error } = await supabase
        .from('document_public_links')
        .insert({ document_type, document_id, organisation_id: org_id, created_by: uid() })
        .select('token')
        .single()
      if (error) throw error
      return data as { token: string }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['public-links'] })
  })
}

// ── SIGNED PHOTO URLS (refresh auto toutes les 4 min) ────────────
import { getSignedUrls } from '@/lib/supabase/storage'
import type { Photo } from '@/types'

export function useSignedPhotos(photos: Photo[] | undefined): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({})

  useEffect(() => {
    const paths = (photos || []).map(p => p.storage_path).filter(Boolean) as string[]
    if (!paths.length) { setUrls({}); return }

    getSignedUrls(paths).then(setUrls)

    const interval = setInterval(() => {
      getSignedUrls(paths).then(setUrls)
    }, 4 * 60 * 1000)

    return () => clearInterval(interval)
  }, [photos])

  return urls
}
