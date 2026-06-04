// src/lib/hooks/index.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { supabase } from '@/lib/supabase/client'
import { uploadPhoto as uploadPhotoStorage } from '@/lib/supabase/storage'
import { useAuthStore } from '@/lib/store'
import type { Intervention, Devis, Facture, Client, Commission, Message, Profile, Prestation, ParametresEntreprise, DashboardStats } from '@/types'

const uid = () => useAuthStore.getState().user?.id
const isAdm = () => useAuthStore.getState().user?.role === 'admin'

// ── DASHBOARD ────────────────────────────────────────────────────
export function useDashboard() {
  const user = useAuthStore(s => s.user)
  return useQuery<DashboardStats>({
    queryKey: ['dashboard', user?.id],
    queryFn: async () => {
      const today = new Date()
      const startDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()
      const startMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString()
      const [
        { count: todayCount },
        { data: factures },
        { data: commissions },
        { count: msgs },
        { count: devisWaiting }
      ] = await Promise.all([
        supabase.from('interventions').select('id', { count: 'exact', head: true }).gte('date_prevue', startDay),
        supabase.from('factures').select('montant_ttc, statut_paiement').gte('created_at', startMonth),
        isAdm() ? supabase.from('commissions').select('commission_admin').eq('statut', 'a_payer') : Promise.resolve({ data: [] }),
        supabase.from('messages').select('id', { count: 'exact', head: true }).eq('destinataire_id', user!.id).eq('lu', false),
        supabase.from('devis').select('id', { count: 'exact', head: true }).eq('statut', 'envoye')
      ])
      const fa = factures || []
      const impayees = fa.filter(f => f.statut_paiement === 'impayee')
      const comm = (commissions as any[] || [])
      return {
        interventions_today: todayCount || 0,
        ca_mois: fa.filter(f => f.statut_paiement === 'payee').reduce((s, f) => s + (f.montant_ttc || 0), 0),
        factures_impayees: impayees.length,
        montant_impaye: impayees.reduce((s, f) => s + (f.montant_ttc || 0), 0),
        commissions_dues: comm.reduce((s, c) => s + (c.commission_admin || 0), 0),
        devis_en_attente: devisWaiting || 0,
        messages_non_lus: msgs || 0
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
export function useParametres() {
  return useQuery<ParametresEntreprise>({
    queryKey: ['parametres'],
    queryFn: async () => {
      const { data, error } = await supabase.from('parametres_entreprise').select('*').single()
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
      const { data: ex } = await supabase.from('parametres_entreprise').select('id').single()
      if (ex) {
        const { error } = await supabase.from('parametres_entreprise').update(data).eq('id', ex.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('parametres_entreprise').insert(data)
        if (error) throw error
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['parametres'] })
  })
}

// ── CLIENTS ──────────────────────────────────────────────────────
export function useClients(search?: string) {
  return useQuery<Client[]>({
    queryKey: ['clients', search],
    queryFn: async () => {
      let q = supabase.from('clients').select('*').order('nom')
      if (search) q = q.or(`nom.ilike.%${search}%,email.ilike.%${search}%,telephone.ilike.%${search}%`)
      const { data, error } = await q
      if (error) throw error
      return data || []
    }
  })
}
export function useCreateClient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: Omit<Client, 'id'|'created_at'|'updated_at'>) => {
      const { data: result, error } = await supabase.from('clients').insert({ ...data, created_by: uid() }).select().single()
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

// ── PRESTATIONS ──────────────────────────────────────────────────
export function usePrestations(categorie?: string) {
  return useQuery<Prestation[]>({
    queryKey: ['prestations', categorie],
    queryFn: async () => {
      let q = supabase.from('prestations').select('*').eq('actif', true).order('ordre')
      if (categorie) q = q.eq('categorie', categorie)
      const { data, error } = await q
      if (error) throw error; return data || []
    },
    staleTime: 1000 * 60 * 5
  })
}

// ── INTERVENTIONS ────────────────────────────────────────────────
export function useInterventions(filters?: { statut?: string; intervenant_id?: string; search?: string }) {
  const user = useAuthStore(s => s.user)
  return useQuery<Intervention[]>({
    queryKey: ['interventions', filters, user?.id],
    queryFn: async () => {
      let q = supabase.from('interventions')
        .select('*, client:clients(id,nom,prenom,telephone,ville_intervention), intervenant:profiles!intervenant_id(id,nom,prenom,email,commission_pct), photos(id,url,type)')
        .order('created_at', { ascending: false })
      if (!isAdm()) q = q.eq('intervenant_id', user!.id)
      if (filters?.statut && filters.statut !== 'tous') q = q.eq('statut', filters.statut)
      if (filters?.intervenant_id) q = q.eq('intervenant_id', filters.intervenant_id)
      if (filters?.search) q = q.or(`description.ilike.%${filters.search}%,adresse.ilike.%${filters.search}%`)
      const { data, error } = await q
      if (error) throw error; return (data || []) as any
    },
    enabled: !!user
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
      const { data: result, error } = await supabase.from('interventions').insert({ ...data, created_by: uid(), tva_pct: data.tva_pct || 10 }).select().single()
      if (error) throw error; return result
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['interventions'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }) }
  })
}
export function useUpdateIntervention() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...data }: Partial<Intervention> & { id: string }) => {
      const { error } = await supabase.from('interventions').update(data).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_: any, v: any) => { qc.invalidateQueries({ queryKey: ['interventions'] }); qc.invalidateQueries({ queryKey: ['intervention', v.id] }) }
  })
}
export function useUploadPhoto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ file, interventionId, type }: { file: File; interventionId: string; type: 'avant'|'apres'|'autre' }) => {
      const { url, path, error } = await uploadPhotoStorage(file, interventionId, type)
      if (error) throw new Error(error)
      const { error: dbErr } = await supabase.from('photos').insert({ intervention_id: interventionId, url, storage_path: path, type, uploaded_by: uid(), taille_octets: file.size })
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
      let q = supabase.from('devis').select('*, client:clients(id,nom,prenom,email,telephone), intervenant:profiles!intervenant_id(id,nom,prenom)').order('created_at', { ascending: false })
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
      const { data: result, error } = await supabase.from('devis').insert({ ...data, created_by: uid() }).select().single()
      if (error) throw error; return result
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devis'] })
  })
}
export function useDeleteDevis() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('devis').delete().eq('id', id)
      if (error) throw error
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
      const echeance = new Date(); echeance.setDate(echeance.getDate() + 30)
      const { data: facture, error: fErr } = await supabase.from('factures').insert({
        devis_id: devisId, client_id: devis.client_id, intervention_id: devis.intervention_id,
        montant_ht: devis.total_ht, tva_montant: devis.tva_montant, montant_ttc: devis.total_ttc,
        statut_paiement: 'impayee', date_echeance: echeance.toISOString().split('T')[0],
        created_by: uid()
      }).select().single()
      if (fErr) throw fErr
      await supabase.from('devis').update({ statut: 'accepte' }).eq('id', devisId)
      return facture
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['devis'] }); qc.invalidateQueries({ queryKey: ['factures'] }) }
  })
}

// ── FACTURES ─────────────────────────────────────────────────────
export function useFactures(filters?: { statut?: string }) {
  const user = useAuthStore(s => s.user)
  return useQuery<Facture[]>({
    queryKey: ['factures', filters, user?.id],
    queryFn: async () => {
      let q = supabase.from('factures').select('*, client:clients(id,nom,prenom,email,telephone)').order('created_at', { ascending: false })
      if (filters?.statut && filters.statut !== 'tous') q = q.eq('statut_paiement', filters.statut)
      const { data, error } = await q
      if (error) throw error; return (data || []) as any
    },
    enabled: !!user
  })
}
export function useUpdateFacture() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...data }: Partial<Facture> & { id: string }) => {
      const { error } = await supabase.from('factures').update(data).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['factures'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }) }
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
      const unread = (data || []).filter(m => m.destinataire_id === user.id && !m.lu).map(m => m.id)
      if (unread.length) await supabase.from('messages').update({ lu: true, lu_le: new Date().toISOString() }).in('id', unread)
      return (data || []) as any
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
      const payload: any = { expediteur_id: user!.id, destinataire_id, contenu, intervention_id, type }
      if (media_url) payload.media_url = media_url
      const { error } = await supabase.from('messages').insert(payload)
      if (error) throw error
    },
    onSuccess: (_: any, v: any) => qc.invalidateQueries({ queryKey: ['messages', v.destinataire_id] })
  })
}

export function useConversations() {
  const user = useAuthStore(s => s.user)
  return useQuery<Profile[]>({
    queryKey: ['conversations', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('*').neq('id', user!.id).eq('actif', true).order('nom')
      return data || []
    },
    enabled: !!user
  })
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
    refetchInterval: 15_000
  })
  useEffect(() => {
    if (!user) return
    const ch = supabase.channel('unread-badge')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `destinataire_id=eq.${user.id}` },
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
