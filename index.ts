// src/lib/hooks/index.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { supabase, uploadPhoto as storageUploadPhoto } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/store'
import type { Intervention, Devis, Facture, Client, Commission, Message, Profile, Prestation, ParametresEntreprise, DashboardStats } from '@/types'

// Récupère l'uid depuis la session Supabase en direct — plus fiable que getState()
async function getUid(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id || null
}

const isAdm = () => useAuthStore.getState().user?.role === 'admin'

// ── DASHBOARD ──────────────────────────────────────────────────
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
        { data: fa },
        { data: co },
        { count: msgs },
        { count: dw }
      ] = await Promise.all([
        supabase.from('interventions').select('id', { count: 'exact', head: true }).gte('created_at', startDay),
        supabase.from('factures').select('montant_ttc, statut_paiement').gte('created_at', startMonth),
        user?.role === 'admin' ? supabase.from('commissions').select('commission_admin').eq('statut', 'a_payer') : Promise.resolve({ data: [] as any[] }),
        supabase.from('messages').select('id', { count: 'exact', head: true }).eq('destinataire_id', user!.id).eq('lu', false),
        supabase.from('devis').select('id', { count: 'exact', head: true }).eq('statut', 'envoye')
      ])
      const factures = fa || []; const comms = co || []
      const impayees = factures.filter((f: any) => f.statut_paiement === 'impayee')
      return {
        interventions_today: todayCount || 0,
        ca_mois: factures.filter((f: any) => f.statut_paiement === 'payee').reduce((s: number, f: any) => s + (f.montant_ttc || 0), 0),
        factures_impayees: impayees.length,
        montant_impaye: impayees.reduce((s: number, f: any) => s + (f.montant_ttc || 0), 0),
        commissions_dues: comms.reduce((s: number, c: any) => s + (c.commission_admin || 0), 0),
        devis_en_attente: dw || 0,
        messages_non_lus: msgs || 0
      }
    },
    refetchInterval: 30_000,
    enabled: !!user
  })
}

// ── PROFILES ────────────────────────────────────────────────────
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
      if (error) throw new Error(error.message)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profiles'] })
  })
}

// ── PARAMETRES ──────────────────────────────────────────────────
export function useParametres() {
  return useQuery<ParametresEntreprise>({
    queryKey: ['parametres'],
    queryFn: async () => {
      const { data, error } = await supabase.from('parametres_entreprise').select('*').single()
      if (error) throw error
      return data
    },
    staleTime: 10 * 60 * 1000
  })
}
export function useUpdateParametres() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: Partial<ParametresEntreprise>) => {
      const { data: ex } = await supabase.from('parametres_entreprise').select('id').single()
      if (ex) {
        const { error } = await supabase.from('parametres_entreprise').update(data).eq('id', ex.id)
        if (error) throw new Error(error.message)
      } else {
        const { error } = await supabase.from('parametres_entreprise').insert(data)
        if (error) throw new Error(error.message)
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['parametres'] })
  })
}

// ── CLIENTS ─────────────────────────────────────────────────────
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
    mutationFn: async (data: Partial<Client>) => {
      const uid = await getUid()
      const { data: r, error } = await supabase.from('clients')
        .insert({ ...data, created_by: uid }).select().single()
      if (error) throw new Error(`Création client: ${error.message}`)
      return r
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] })
  })
}
export function useUpdateClient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...data }: Partial<Client> & { id: string }) => {
      const { error } = await supabase.from('clients').update(data).eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] })
  })
}

// ── PRESTATIONS ─────────────────────────────────────────────────
export function usePrestations(categorie?: string) {
  return useQuery<Prestation[]>({
    queryKey: ['prestations', categorie],
    queryFn: async () => {
      let q = supabase.from('prestations').select('*').eq('actif', true).order('ordre')
      if (categorie) q = q.eq('categorie', categorie)
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
    staleTime: 5 * 60 * 1000
  })
}

// ── INTERVENTIONS ───────────────────────────────────────────────
export function useInterventions(filters?: { statut?: string; search?: string }) {
  const user = useAuthStore(s => s.user)
  const role = user?.role  // réactif — mis à jour quand le store est hydraté
  return useQuery<Intervention[]>({
    queryKey: ['interventions', filters, user?.id, role],
    queryFn: async () => {
      let q = supabase.from('interventions')
        .select('*, client:clients(id,nom,prenom,telephone,ville_intervention), intervenant:profiles(id,nom,prenom,commission_pct), photos(id,url,type)')
        .order('created_at', { ascending: false })
      if (role !== 'admin') q = q.eq('intervenant_id', user!.id)
      if (filters?.statut && filters.statut !== 'tous') q = q.eq('statut', filters.statut)
      if (filters?.search) q = q.or(`description.ilike.%${filters.search}%,adresse.ilike.%${filters.search}%`)
      const { data, error } = await q
      if (error) throw new Error(`Interventions: ${error.message}`)
      return (data || []) as any
    },
    enabled: !!user
  })
}
export function useIntervention(id: string) {
  return useQuery<Intervention>({
    queryKey: ['intervention', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('interventions')
        .select('*, client:clients(*), intervenant:profiles(id,nom,prenom,email,telephone,commission_pct), photos(*)')
        .eq('id', id).single()
      if (error) throw error
      return data as any
    },
    enabled: !!id
  })
}
export function useCreateIntervention() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: Partial<Intervention> & { type: string }) => {
      const uid = await getUid()
      if (!uid) throw new Error('Non connecté — veuillez vous reconnecter')
      const payload = {
        ...data,
        created_by: uid,
        tva_pct: data.tva_pct || 10,
        statut: data.statut || 'en_attente'
      }
      const { data: r, error } = await supabase.from('interventions').insert(payload).select().single()
      if (error) throw new Error(`Création intervention: ${error.message}`)
      // Créer une notification pour l'intervenant si assigné
      if (data.intervenant_id) {
        await supabase.from('notifications').insert({
          user_id: data.intervenant_id,
          titre: 'Nouvelle intervention assignée',
          contenu: `Adresse: ${data.adresse || 'Non précisée'}`,
          type: 'info',
          lien: `/interventions/${r.id}`
        }).then(() => {})
        // Message automatique dans la messagerie
        await supabase.from('messages').insert({
          expediteur_id: uid,
          destinataire_id: data.intervenant_id,
          contenu: `Nouvelle intervention assignée — Adresse: ${data.adresse || 'Non précisée'} — Type: ${data.type}`,
          type: 'intervention',
          intervention_id: r.id
        }).then(() => {})
      }
      return r
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['interventions'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['messages'] })
    }
  })
}
export function useUpdateIntervention() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...data }: Partial<Intervention> & { id: string }) => {
      const uid = await getUid()
      if (!uid) throw new Error('Non connecté')
      const { error } = await supabase.from('interventions').update(data).eq('id', id)
      if (error) throw new Error(`Mise à jour: ${error.message}`)
      // Si statut change → notifier admin/intervenant
      if (data.statut) {
        const { data: inter } = await supabase.from('interventions').select('intervenant_id, created_by').eq('id', id).single()
        const notifyId = data.statut === 'accepte' || data.statut === 'refuse' ? inter?.created_by : inter?.intervenant_id
        if (notifyId && notifyId !== uid) {
          await supabase.from('notifications').insert({
            user_id: notifyId,
            titre: `Intervention ${data.statut.replace('_', ' ')}`,
            type: data.statut === 'refuse' ? 'alerte' : 'succes'
          }).then(() => {})
          await supabase.from('messages').insert({
            expediteur_id: uid,
            destinataire_id: notifyId,
            contenu: `Intervention mise à jour: statut → ${data.statut.replace('_', ' ')}`,
            type: 'system',
            intervention_id: id
          }).then(() => {})
        }
      }
    },
    onSuccess: (_: any, v: any) => {
      qc.invalidateQueries({ queryKey: ['interventions'] })
      qc.invalidateQueries({ queryKey: ['intervention', v.id] })
      qc.invalidateQueries({ queryKey: ['messages'] })
    }
  })
}
export function useUploadPhoto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ file, interventionId, type }: { file: File; interventionId: string; type: 'avant' | 'apres' | 'autre' }) => {
      const uid = await getUid()
      const { url, path, error } = await storageUploadPhoto(file, interventionId, type)
      if (error) throw new Error(`Upload photo: ${error}`)
      const { error: dbErr } = await supabase.from('photos').insert({
        intervention_id: interventionId, url, storage_path: path,
        type, uploaded_by: uid, taille_octets: file.size
      })
      if (dbErr) throw new Error(`DB photo: ${dbErr.message}`)
    },
    onSuccess: (_: any, v: any) => qc.invalidateQueries({ queryKey: ['intervention', v.interventionId] })
  })
}

// ── DEVIS ────────────────────────────────────────────────────────
export function useDevis(filters?: { statut?: string }) {
  const user = useAuthStore(s => s.user)
  const role = user?.role
  return useQuery<Devis[]>({
    queryKey: ['devis', filters, user?.id, role],
    queryFn: async () => {
      let q = supabase.from('devis')
        .select('*, client:clients(id,nom,prenom,email,telephone), intervenant:profiles(id,nom,prenom)')
        .order('created_at', { ascending: false })
      if (role !== 'admin') q = q.eq('created_by', user!.id)
      if (filters?.statut && filters.statut !== 'tous') q = q.eq('statut', filters.statut)
      const { data, error } = await q
      if (error) throw new Error(`Devis: ${error.message}`)
      return (data || []) as any
    },
    enabled: !!user
  })
}
export function useDevisById(id: string) {
  return useQuery<Devis>({
    queryKey: ['devis-single', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('devis')
        .select('*, client:clients(*), intervenant:profiles(*)')
        .eq('id', id).single()
      if (error) throw error
      return data as any
    },
    enabled: !!id
  })
}
export function useCreateDevis() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: any) => {
      // Récupérer uid depuis session Supabase directement
      const uid = await getUid()
      if (!uid) throw new Error('Session expirée — veuillez vous reconnecter')
      // Nettoyer les lignes vides
      const lignes = (data.lignes || []).filter((l: any) => l.description?.trim() || l.prix_ht > 0)
      const payload = {
        client_id: data.client_id,
        intervenant_id: data.intervenant_id || null,
        intervention_id: data.intervention_id || null,
        activite: data.activite || 'serrurerie',
        statut: data.statut || 'brouillon',
        lignes: lignes,
        remise_pct: data.remise_pct || 0,
        remise_montant: data.remise_montant || 0,
        total_ht: data.total_ht || 0,
        tva_montant: data.tva_montant || 0,
        total_ttc: data.total_ttc || 0,
        modele_id: data.modele_id || 0,
        notes: data.notes || null,
        valide_jusqu_au: data.valide_jusqu_au || null,
        created_by: uid
      }
      const { data: result, error } = await supabase.from('devis').insert(payload).select().single()
      if (error) throw new Error(`Création devis: ${error.message} (code: ${error.code})`)
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
      if (error) throw new Error(`Mise à jour devis: ${error.message}`)
    },
    onSuccess: () => {
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
      if (error) throw new Error(error.message)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devis'] })
  })
}
export function useDevisToFacture() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (devisId: string) => {
      const uid = await getUid()
      if (!uid) throw new Error('Session expirée')
      const { data: d, error } = await supabase.from('devis').select('*').eq('id', devisId).single()
      if (error || !d) throw new Error('Devis introuvable')
      const echeance = new Date(); echeance.setDate(echeance.getDate() + 30)
      const { data: f, error: fErr } = await supabase.from('factures').insert({
        devis_id: devisId,
        client_id: d.client_id,
        intervention_id: d.intervention_id || null,
        montant_ht: d.total_ht,
        tva_montant: d.tva_montant,
        montant_ttc: d.total_ttc,
        acompte_recu: 0,
        statut_paiement: 'impayee',
        date_echeance: echeance.toISOString().split('T')[0],
        created_by: uid
      }).select().single()
      if (fErr) throw new Error(`Création facture: ${fErr.message}`)
      await supabase.from('devis').update({ statut: 'accepte' }).eq('id', devisId)
      return f
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['devis'] })
      qc.invalidateQueries({ queryKey: ['factures'] })
    }
  })
}

// ── FACTURES ────────────────────────────────────────────────────
export function useFactures(filters?: { statut?: string }) {
  const user = useAuthStore(s => s.user)
  const role = user?.role
  return useQuery<Facture[]>({
    queryKey: ['factures', filters, user?.id, role],
    queryFn: async () => {
      let q = supabase.from('factures')
        .select('*, client:clients(id,nom,prenom,email,telephone)')
        .order('created_at', { ascending: false })
      if (filters?.statut && filters.statut !== 'tous') q = q.eq('statut_paiement', filters.statut)
      const { data, error } = await q
      if (error) throw error
      return (data || []) as any
    },
    enabled: !!user
  })
}
export function useUpdateFacture() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...data }: Partial<Facture> & { id: string }) => {
      const { error } = await supabase.from('factures').update(data).eq('id', id)
      if (error) throw new Error(`Mise à jour facture: ${error.message}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['factures'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    }
  })
}

// ── COMMISSIONS ──────────────────────────────────────────────────
export function useCommissions(intervenantId?: string) {
  const user = useAuthStore(s => s.user)
  const role = user?.role
  const targetId = intervenantId || (role !== 'admin' ? user?.id : undefined)
  return useQuery<Commission[]>({
    queryKey: ['commissions', targetId, role],
    queryFn: async () => {
      let q = supabase.from('commissions')
        .select('*, intervenant:profiles(id,nom,prenom,commission_pct), intervention:interventions(id,numero,adresse)')
        .order('created_at', { ascending: false })
      if (targetId) q = q.eq('intervenant_id', targetId)
      const { data, error } = await q
      if (error) throw error
      return (data || []) as any
    },
    enabled: !!user
  })
}
export function useUpdateCommission() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, statut }: { id: string; statut: 'a_payer' | 'paye' }) => {
      const { error } = await supabase.from('commissions')
        .update({ statut, paye_le: statut === 'paye' ? new Date().toISOString() : null }).eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['commissions'] })
  })
}

// ── MESSAGES + REALTIME ──────────────────────────────────────────
export function useMessages(withUserId: string) {
  const user = useAuthStore(s => s.user)
  const qc = useQueryClient()
  const qKey = ['messages', withUserId, user?.id]

  const q = useQuery<Message[]>({
    queryKey: qKey,
    queryFn: async () => {
      if (!user || !withUserId) return []
      const { data, error } = await supabase.from('messages')
        .select('*, expediteur:profiles(id,nom,prenom)')
        .or(`and(expediteur_id.eq.${user.id},destinataire_id.eq.${withUserId}),and(expediteur_id.eq.${withUserId},destinataire_id.eq.${user.id})`)
        .order('created_at', { ascending: true })
      if (error) throw error
      // Marquer comme lus
      const unread = (data || []).filter(m => m.destinataire_id === user.id && !m.lu).map(m => m.id)
      if (unread.length) {
        supabase.from('messages').update({ lu: true, lu_le: new Date().toISOString() }).in('id', unread).then(() => {
          qc.invalidateQueries({ queryKey: ['unread', user.id] })
        })
      }
      return (data || []) as any
    },
    enabled: !!user && !!withUserId,
    refetchInterval: 5000 // Fallback polling si realtime échoue
  })

  useEffect(() => {
    if (!user || !withUserId) return
    const ch = supabase.channel(`chat-${[user.id, withUserId].sort().join('-')}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages',
        filter: `destinataire_id=eq.${user.id}` },
        () => qc.invalidateQueries({ queryKey: qKey }))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages',
        filter: `destinataire_id=eq.${withUserId}` },
        () => qc.invalidateQueries({ queryKey: qKey }))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [user?.id, withUserId])

  return q
}

export function useSendMessage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ destinataire_id, contenu, type = 'texte', media_url, intervention_id }: {
      destinataire_id: string; contenu: string; type?: string; media_url?: string; intervention_id?: string
    }) => {
      // Utiliser getUser() de Supabase directement — plus fiable
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Session expirée — veuillez vous reconnecter')
      const { error } = await supabase.from('messages').insert({
        expediteur_id: user.id,
        destinataire_id,
        contenu,
        type,
        intervention_id: intervention_id || null,
        lu: false
      })
      if (error) throw new Error(`Envoi message: ${error.message}`)
    },
    onSuccess: (_: any, v: any) => {
      qc.invalidateQueries({ queryKey: ['messages', v.destinataire_id] })
      qc.invalidateQueries({ queryKey: ['unread'] })
    }
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
      const { count } = await supabase.from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('destinataire_id', user!.id).eq('lu', false)
      return count || 0
    },
    enabled: !!user,
    refetchInterval: 10_000
  })
  useEffect(() => {
    if (!user) return
    const ch = supabase.channel('unread-badge')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages',
        filter: `destinataire_id=eq.${user.id}` },
        () => qc.invalidateQueries({ queryKey: ['unread', user.id] }))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [user?.id])
  return q
}

// ── JOURNAL ──────────────────────────────────────────────────────
export function useJournal() {
  return useQuery({
    queryKey: ['journal'],
    queryFn: async () => {
      const { data, error } = await supabase.from('journal').select('*').order('created_at', { ascending: false }).limit(200)
      if (error) throw error
      return data || []
    }
  })
}
