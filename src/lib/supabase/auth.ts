// src/lib/supabase/auth.ts
import { supabase } from './client'
import { registerDevice } from '@/lib/devices'
import { fetchSubscriptionBlocked } from '@/lib/subscription'

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

export async function signOut() {
  try {
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
}) {
  try {
    const { data, error } = await supabase.functions.invoke('envoyer-email', { body: opts })
    if (error) return { error: error.message }
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
