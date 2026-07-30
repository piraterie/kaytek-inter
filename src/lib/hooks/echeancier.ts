// src/lib/hooks/echeancier.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/store'
import { notifyAdmins } from '@/lib/hooks/index'
import type { Echeancier, Echeance, ModePaiementEcheance } from '@/types'

const ECHEANCIER_LIST_COLUMNS = 'id,devis_id,statut,montant_ttc,montant_paye,montant_restant,nombre_echeances'

// Échéanciers actifs (non annulés) de toute l'organisation, indexés par
// devis_id — utilisé par la liste des devis pour savoir, sans requête par
// ligne, si l'action de menu doit être "Créer" ou "Voir l'échéancier".
export function useEcheanciersByDevisMap() {
  const user = useAuthStore(s => s.user)
  return useQuery<Map<string, Pick<Echeancier, 'id' | 'devis_id' | 'statut' | 'montant_ttc' | 'montant_paye' | 'montant_restant' | 'nombre_echeances'>>>({
    queryKey: ['echeanciers-map', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('echeanciers')
        .select(ECHEANCIER_LIST_COLUMNS)
        .is('annule_le', null)
      if (error) throw error
      const map = new Map<string, any>()
      for (const row of data || []) map.set(row.devis_id, row)
      return map
    },
    enabled: !!user
  })
}

export function useEcheancierByDevis(devisId: string | undefined) {
  return useQuery<(Echeancier & { echeances: Echeance[] }) | null>({
    queryKey: ['echeancier-devis', devisId],
    queryFn: async () => {
      const { data: echeancier, error } = await supabase
        .from('echeanciers')
        .select('*')
        .eq('devis_id', devisId as string)
        .is('annule_le', null)
        .maybeSingle()
      if (error) throw error
      if (!echeancier) return null

      const { data: echeances, error: echErr } = await supabase
        .from('echeances')
        .select('*, paiements(*)')
        .eq('echeancier_id', echeancier.id)
        .order('numero_ordre', { ascending: true })
      if (echErr) throw echErr

      return { ...echeancier, echeances: echeances || [] } as any
    },
    enabled: !!devisId
  })
}

export interface CreateEcheancierInstallment {
  numero_ordre: number
  libelle: string
  pourcentage: number
  montant_ht: number
  tva_montant: number
  montant_ttc: number
  date_prevue: string
  rappel_actif?: boolean
  rappel_client_email?: boolean
}

export function useCreateEcheancier() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      devis_id: string
      nombre_echeances: number
      mode_repartition: 'egale' | 'pourcentages' | 'montants'
      echeances: CreateEcheancierInstallment[]
      note_interne?: string
      note_visible_client?: boolean
    }) => {
      const { data, error } = await supabase.rpc('create_echeancier', {
        p_devis_id: payload.devis_id,
        p_nombre_echeances: payload.nombre_echeances,
        p_mode_repartition: payload.mode_repartition,
        p_echeances: payload.echeances,
        p_note_interne: payload.note_interne || null,
        p_note_visible_client: payload.note_visible_client ?? false,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['echeanciers-map'] })
      qc.invalidateQueries({ queryKey: ['echeancier-devis', variables.devis_id] })
    }
  })
}

// Génère la facture (acompte / intermédiaire / solde / classique selon la
// position de l'échéance) via la RPC atomique — ne duplique pas la
// numérotation existante (gen_numero_facture() reste l'unique source).
export function useGenerateFactureEcheance(devisId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (echeanceId: string) => {
      const { data, error } = await supabase.rpc('generate_facture_echeance', { p_echeance_id: echeanceId })
      if (error) throw error
      return data as string
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['echeanciers-map'] })
      qc.invalidateQueries({ queryKey: ['echeancier-devis', devisId] })
      qc.invalidateQueries({ queryKey: ['factures'] })
    }
  })
}

// ── Liste org-wide (onglets Échéanciers / Impayés) ──────────────
export interface EcheancierListRow extends Omit<Echeancier, 'devis' | 'client' | 'echeances'> {
  devis: { numero: string } | null
  client: { nom: string; prenom?: string } | null
  echeances: Echeance[]
}

export function useEcheanciersList() {
  const user = useAuthStore(s => s.user)
  return useQuery<EcheancierListRow[]>({
    queryKey: ['echeanciers-list', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('echeanciers')
        .select('*, devis:devis(numero), client:clients(nom,prenom), echeances(id,numero_ordre,libelle,date_prevue,statut,montant_ttc,montant_paye,montant_restant)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data || []) as any
    },
    enabled: !!user
  })
}

export interface EcheanceImpayeeRow extends Echeance {
  echeancier: { montant_restant: number } | null
  devis: { numero: string } | null
  client: { id: string; nom: string; prenom?: string; telephone?: string } | null
}

// Échéances en retard, impayées, ou partiellement réglées (non soldées) —
// cf. cahier des charges section 8 : "échéances dépassées non payées,
// factures en retard, paiements partiels non soldés".
const IMPAYES_STATUTS = ['en_retard', 'impaye', 'paiement_partiel']

export function useEcheancesImpayees() {
  const user = useAuthStore(s => s.user)
  return useQuery<EcheanceImpayeeRow[]>({
    queryKey: ['echeances-impayees', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('echeances')
        .select('*, echeancier:echeanciers(montant_restant), devis:devis(numero), client:clients(id,nom,prenom,telephone)')
        .in('statut', IMPAYES_STATUTS)
        .order('date_prevue', { ascending: true })
      if (error) throw error
      return (data || []) as any
    },
    enabled: !!user
  })
}

// ── Situation financière d'un client (fiche client) ─────────────
export interface ClientSituationFinanciere {
  totalFacture: number
  totalEncaisse: number
  totalRestant: number
  totalEnRetard: number
  nbEcheanciersActifs: number
  prochaineEcheance: Echeance | null
  dernierPaiement: { montant: number; date_paiement: string } | null
}

export function useClientFinances(clientId: string | undefined) {
  const user = useAuthStore(s => s.user)
  return useQuery<ClientSituationFinanciere>({
    queryKey: ['client-finances', clientId],
    queryFn: async () => {
      const [{ data: echeanciers }, { data: paiements }] = await Promise.all([
        supabase.from('echeanciers').select('*, echeances(*)').eq('client_id', clientId as string).is('annule_le', null),
        supabase.from('paiements').select('montant,date_paiement').eq('client_id', clientId as string).is('deleted_at', null).order('date_paiement', { ascending: false }).limit(1),
      ])

      const toutesEcheances = (echeanciers || []).flatMap((e: any) => e.echeances || []) as Echeance[]
      const totalFacture = (echeanciers || []).reduce((s: number, e: any) => s + e.montant_ttc, 0)
      const totalEncaisse = (echeanciers || []).reduce((s: number, e: any) => s + e.montant_paye, 0)
      const totalRestant = (echeanciers || []).reduce((s: number, e: any) => s + e.montant_restant, 0)
      const totalEnRetard = toutesEcheances
        .filter(e => ['en_retard', 'impaye'].includes(e.statut))
        .reduce((s, e) => s + e.montant_restant, 0)
      const prochaine = toutesEcheances
        .filter(e => !['paye', 'annule'].includes(e.statut))
        .sort((a, b) => new Date(a.date_prevue).getTime() - new Date(b.date_prevue).getTime())[0] || null

      return {
        totalFacture, totalEncaisse, totalRestant, totalEnRetard,
        nbEcheanciersActifs: (echeanciers || []).length,
        prochaineEcheance: prochaine,
        dernierPaiement: paiements?.[0] || null,
      }
    },
    enabled: !!clientId && !!user
  })
}

export function useCreatePaiement(devisId: string | undefined) {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  return useMutation({
    mutationFn: async (payload: {
      echeance_id: string
      echeancier_id: string
      devis_id: string
      client_id: string
      facture_id?: string | null
      montant: number
      date_paiement: string
      mode_paiement: ModePaiementEcheance
      reference?: string
      note?: string
    }) => {
      const { data, error } = await supabase.from('paiements').insert({
        organisation_id: user?.organisation_id,
        client_id: payload.client_id,
        devis_id: payload.devis_id,
        echeancier_id: payload.echeancier_id,
        echeance_id: payload.echeance_id,
        facture_id: payload.facture_id || null,
        montant: payload.montant,
        date_paiement: payload.date_paiement,
        mode_paiement: payload.mode_paiement,
        reference: payload.reference || null,
        note: payload.note || null,
        created_by: user?.id,
      }).select().single()
      if (error) throw error

      // Le trigger DB a déjà recalculé les statuts au moment où cette
      // requête revient — relit l'état à jour pour construire une
      // notification interne précise (partiel / soldé).
      const [{ data: echeanceApres }, { data: echeancierApres }, { data: devis }] = await Promise.all([
        supabase.from('echeances').select('statut,libelle,montant_restant').eq('id', payload.echeance_id).single(),
        supabase.from('echeanciers').select('statut,montant_restant').eq('id', payload.echeancier_id).single(),
        supabase.from('devis').select('numero').eq('id', payload.devis_id).single(),
      ])

      return { paiement: data, echeanceApres, echeancierApres, devisNumero: devis?.numero }
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['echeanciers-map'] })
      qc.invalidateQueries({ queryKey: ['echeancier-devis', devisId] })
      qc.invalidateQueries({ queryKey: ['echeanciers-list'] })
      qc.invalidateQueries({ queryKey: ['echeances-impayees'] })
      qc.invalidateQueries({ queryKey: ['client-finances'] })
      qc.invalidateQueries({ queryKey: ['factures'] })

      const montant = result.paiement.montant.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
      if (result.echeancierApres?.statut === 'paye') {
        notifyAdmins(
          '✅ Échéancier soldé',
          `Le solde du devis ${result.devisNumero || ''} est maintenant payé (dernier versement ${montant}).`,
          `/devis/${devisId}/apercu`
        ).catch(() => {})
      } else {
        notifyAdmins(
          '💳 Paiement enregistré',
          `Un paiement de ${montant} a été enregistré pour "${result.echeanceApres?.libelle || ''}" (devis ${result.devisNumero || ''}).`,
          `/devis/${devisId}/apercu`
        ).catch(() => {})
      }
    }
  })
}
