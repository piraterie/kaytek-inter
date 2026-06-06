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
      const admin = isAdm()
      const [
        { count: todayCount },
        { data: factures },
        { data: commissionsDues },
        { count: msgs },
        { count: devisWaiting },
        { data: mesCommissions }
      ] = await Promise.all([
        supabase.from('interventions').select('id', { count: 'exact', head: true }).gte('date_prevue', startDay),
        admin ? supabase.from('factures').select('montant_ttc, statut_paiement').gte('created_at', startMonth) : Promise.resolve({ data: [] }),
        admin ? supabase.from('commissions').select('commission_admin').eq('statut', 'a_payer') : Promise.resolve({ data: [] }),
        supabase.from('messages').select('id', { count: 'exact', head: true }).eq('destinataire_id', user!.id).eq('lu', false),
        admin ? supabase.from('devis').select('id', { count: 'exact', head: true }).eq('statut', 'envoye') : Promise.resolve({ count: 0 }),
        !admin ? supabase.from('commissions').select('part_intervenant, statut').eq('intervenant_id', user!.id).gte('created_at', startMonth) : Promise.resolve({ data: [] }),
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
export function useDeleteIntervention() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('interventions').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['interventions'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }) }
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
      if (!isAdm()) {
        const user = useAuthStore.getState().user
        if (!user?.can_create_documents) throw new Error('Vous n\'êtes pas autorisé à créer des devis')
      }
      const { data: result, error } = await supabase.from('devis').insert({ ...data, created_by: uid() }).select().single()
      if (error) throw error
      if (!isAdm()) {
        const user = useAuthStore.getState().user
        await notifyAdmins(
          '📄 Nouveau devis à valider',
          `${user?.prenom || ''} ${user?.nom || ''} a soumis un devis en attente de validation`,
          '/devis'
        )
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
export function useDeleteAllDevis() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from('devis').delete().in('id', ids)
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

// ── NOTIFICATIONS ────────────────────────────────────────────────
// L'insertion en DB déclenche automatiquement le trigger pg_net → send-push
export async function notifyAdmins(titre: string, contenu: string, lien?: string) {
  const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin')
  if (!admins?.length) return
  for (const admin of admins) {
    await supabase.from('notifications').insert({
      user_id: admin.id, titre, contenu, type: 'info', lue: false, lien: lien || null
    })
  }
}

export async function notifyUser(userId: string, titre: string, contenu: string, lien?: string) {
  await supabase.from('notifications').insert({
    user_id: userId, titre, contenu, type: 'info', lue: false, lien: lien || null
  })
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
      if (error) throw error
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
  return useMutation({
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
  return useMutation({
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
      let q = supabase.from('factures').select('*, client:clients(id,nom,prenom,email,telephone)').order('created_at', { ascending: false })
      if (!isAdm()) q = q.eq('created_by', user!.id)
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
      if (!isAdm()) {
        const user = useAuthStore.getState().user
        if (!user?.can_create_documents) throw new Error('Vous n\'êtes pas autorisé à créer des factures')
      }
      const payload = {
        ...data,
        statut_paiement: 'en_attente_validation',
        date_emission: new Date().toISOString().split('T')[0],
        created_by: uid(),
        acompte_recu: data.acompte_recu ?? 0
      }
      const { data: result, error } = await supabase.from('factures').insert(payload).select().single()
      if (error) throw error
      const user = useAuthStore.getState().user
      await notifyAdmins(
        '🧾 Nouvelle facture à valider',
        `${user?.prenom || ''} ${user?.nom || ''} a soumis une facture en attente de validation`,
        '/factures'
      )
      return result
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['factures'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }) }
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
export function useDeleteFacture() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('factures').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['factures'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }) }
  })
}
export function useDeleteAllFactures() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from('factures').delete().in('id', ids)
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
        const { data: signed } = await supabase.storage.from('chat-media').createSignedUrls(paths, 3600)
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
      // Sécurité : un non-admin ne peut envoyer qu'à un admin
      if (user!.role !== 'admin') {
        const { data: dest } = await supabase.from('profiles').select('role').eq('id', destinataire_id).single()
        if (!dest || dest.role !== 'admin') throw new Error('Vous ne pouvez envoyer des messages qu\'à l\'administrateur')
      }
      const payload: any = { expediteur_id: user!.id, destinataire_id, contenu, type }
      if (intervention_id) payload.intervention_id = intervention_id
      if (media_url) payload.media_url = media_url
      const { error } = await supabase.from('messages').insert(payload)
      if (error) throw error
      // Push notification au destinataire — lien vers la conversation avec l'expéditeur
      const senderName = `${user!.prenom || ''} ${user!.nom || ''}`.trim() || 'Kaytek'
      supabase.functions.invoke('send-push', {
        body: {
          user_id: destinataire_id,
          titre: `💬 ${senderName}`,
          contenu: type === 'texte' ? contenu : type === 'audio' || type === 'vocal' ? '🎤 Message vocal' : '📷 Photo',
          lien: `/messagerie/${user!.id}`,
        }
      }).catch(() => {})
    },
    onSuccess: (_: any, v: any) => qc.invalidateQueries({ queryKey: ['messages', v.destinataire_id] })
  })
}

export function useConversations() {
  const user = useAuthStore(s => s.user)
  return useQuery<Profile[]>({
    queryKey: ['conversations', user?.id],
    queryFn: async () => {
      let q = supabase.from('profiles').select('*').neq('id', user!.id).eq('actif', true)
      // Les intervenants ne peuvent contacter que l'admin
      if (user!.role !== 'admin') q = q.eq('role', 'admin')
      const { data } = await q.order('nom')
      return data || []
    },
    enabled: !!user
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
          applicationServerKey: b64urlToUint8(VAPID_PUBLIC_KEY),
        })
        localStorage.setItem(VAPID_KEY_STORE, VAPID_PUBLIC_KEY)
      }

      const json = sub.toJSON()
      const p256dh = json.keys?.p256dh
      const auth = json.keys?.auth
      if (!p256dh || !auth) return

      // Upsert: INSERT ou UPDATE (les deux opérations)
      await supabase.from('push_subscriptions').upsert({
        user_id: user!.id,
        endpoint: sub.endpoint,
        p256dh,
        auth,
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
    refetchInterval: 15_000
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
      const { error } = await supabase.from('journal').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['journal'] })
  })
}

export function useDeleteAllJournal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from('journal').delete().in('id', ids)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['journal'] })
  })
}

export function useUpdateJournalEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, description }: { id: string; description: string }) => {
      const { error } = await supabase.from('journal').update({ description }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['journal'] })
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
