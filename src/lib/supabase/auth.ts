// src/lib/supabase/auth.ts
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './client'
import { registerDevice } from '@/lib/devices'
import { fetchSubscriptionBlocked } from '@/lib/subscription'

// Les Edge Functions envoyer-email / inviter-intervenant renvoient de vrais
// statuts HTTP (400/403/404/422) pour les erreurs bloquantes — supabase-js les
// fait remonter comme FunctionsHttpError dont .message est un texte générique
// fixe ; le message métier réel n'est disponible qu'en relisant le corps JSON
// via .context.
// Exportée pour être testée directement (voir auth.test.ts).
export async function extractFunctionErrorMessage(error: unknown, fallback: string): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json()
      if (body?.error) return body.error
    } catch { /* corps non-JSON ou déjà consommé — on retombe sur le message générique */ }
  }
  return (error as any)?.message || fallback
}

export async function signIn(email: string, password: string) {
  try {
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password
    })

    if (signInError) {
      return { profile: null, error: signInError.message }
    }

    if (!data.user) {
      return { profile: null, error: 'Aucun utilisateur trouvé' }
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single()

    if (profileError) {
      return { profile: null, error: 'Profil introuvable' }
    }

    // Vérification et enregistrement de l'appareil (les admins ne sont jamais bloqués)
    const { error: deviceError } = await registerDevice(data.user.id, profile.organisation_id, profile.role === 'admin')
    if (deviceError === 'DEVICE_LIMIT') {
      await supabase.auth.signOut()
      return {
        profile: null,
        error: "Limite d'appareils atteinte. Demandez à votre administrateur de réinitialiser vos appareils ou de supprimer un ancien appareil."
      }
    }

    const subscriptionBlocked = await fetchSubscriptionBlocked()

    return { profile, error: null, subscriptionBlocked }
  } catch (err: any) {
    console.error('Erreur signIn:', err)
    return { profile: null, error: err.message || 'Erreur de connexion' }
  }
}

export async function resetPassword(email: string) {
  const redirectTo = `${window.location.origin}/reset-password`
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })

    if (error) {
      if (error.message?.toLowerCase().includes('sending recovery email') || error.message?.toLowerCase().includes('sending')) {
        return { error: 'Envoi impossible — vérifiez la configuration SMTP dans Supabase Auth (Authentication → Settings → SMTP)' }
      }
      return { error: error.message }
    }

    return { error: null }
  } catch (err: any) {
    return { error: err.message || 'Erreur lors de l\'envoi de l\'email' }
  }
}

// Supprime l'abonnement push de CE navigateur uniquement (pas les autres
// appareils du même utilisateur) et le désinscrit côté navigateur — sur un
// appareil partagé, empêche l'utilisateur suivant de recevoir les push
// destinés au précédent. Doit s'exécuter AVANT supabase.auth.signOut() : la
// RLS de push_subscriptions exige un auth.uid() encore valide. Best-effort,
// ne bloque jamais la déconnexion en cas d'échec (PushManager indisponible,
// erreur réseau/Supabase).
async function cleanupCurrentDevicePushSubscription() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    const registration = await navigator.serviceWorker.getRegistration()
    const sub = await registration?.pushManager.getSubscription()
    if (!sub) return
    const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
    if (error) console.error('Suppression push_subscriptions échouée (non bloquant):', error.message)
    await sub.unsubscribe()
  } catch (err) {
    console.error('Nettoyage abonnement push échoué (non bloquant):', err)
  }
}

export async function signOut() {
  try {
    await cleanupCurrentDevicePushSubscription()
    const { error } = await supabase.auth.signOut()
    if (error) {
      return { error: error.message }
    }
    return { error: null }
  } catch (err: any) {
    console.error('Erreur signOut:', err)
    return { error: err.message || 'Erreur de déconnexion' }
  }
}

export async function envoyerEmail(opts: {
  to: string; subject: string; html: string; pdfBase64?: string; pdfFilename?: string
  documentType: 'devis' | 'facture'; documentId: string
}) {
  try {
    const { data, error } = await supabase.functions.invoke('envoyer-email', { body: opts })
    if (error) return { error: await extractFunctionErrorMessage(error, "Erreur lors de l'envoi") }
    if (data?.error) return { error: data.error }
    return { error: null }
  } catch (err: any) {
    return { error: err.message || "Erreur lors de l'envoi" }
  }
}

export async function supprimerUtilisateur(userId: string) {
  try {
    const { data, error } = await supabase.functions.invoke('supprimer-utilisateur', {
      body: { userId }
    })
    if (error) return { error: error.message }
    if (data?.error) return { error: data.error }
    return { error: null }
  } catch (err: any) {
    return { error: err.message || 'Erreur lors de la suppression' }
  }
}

export async function inviterIntervenant(
  email: string,
  nom: string,
  prenom: string,
  commission_pct: number,
  type_intervenant?: 'entrepreneur' | 'salarie',
  role: 'intervenant' | 'assistant' = 'intervenant'
) {
  try {
    const { data, error } = await supabase.functions.invoke('inviter-intervenant', {
      body: { email, nom, prenom, commission_pct, type_intervenant, role }
    })

    if (error) return { error: error.message }
    if (data?.error) return { error: data.error }

    return { error: null }
  } catch (err: any) {
    console.error('Erreur inviterIntervenant:', err)
    return { error: err.message || "Erreur lors de l'invitation" }
  }
}
