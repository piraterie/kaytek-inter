// src/lib/subscription.ts
import { supabase } from './supabase/client'

// Statuts d'abonnement Stripe donnant accès à l'application. Tout le reste
// (canceled, unpaid, past_due, statut inconnu/NULL) bloque l'accès. Un essai
// (trialing) dont la date de fin est dépassée bloque aussi, au cas où Stripe
// n'a pas encore synchronisé le nouveau statut.
export function isSubscriptionAccessAllowed(status: string | null, trialEndsAt: string | null): boolean {
  if (status === 'active') return true
  if (status === 'trialing') {
    if (!trialEndsAt) return true
    return new Date(trialEndsAt) > new Date()
  }
  return false
}

// Aucune ligne renvoyée par la RPC = organisation sans abonnement lié
// (pré-Stripe, ex. kaytek-inter) = jamais bloquée.
export async function fetchSubscriptionBlocked(): Promise<boolean> {
  const { data } = await supabase
    .rpc('get_my_organisation_subscription_status')
    .maybeSingle()

  return !!data && !isSubscriptionAccessAllowed(data.subscription_status, data.trial_ends_at)
}
