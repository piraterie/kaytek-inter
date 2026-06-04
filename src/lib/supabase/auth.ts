// src/lib/supabase/auth.ts
import { supabase } from './client'

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

    return { profile, error: null }
  } catch (err: any) {
    console.error('Erreur signIn:', err)
    return { profile: null, error: err.message || 'Erreur de connexion' }
  }
}

export async function resetPassword(email: string) {
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`
    })

    if (error) {
      return { error: error.message }
    }

    return { error: null }
  } catch (err: any) {
    console.error('Erreur resetPassword:', err)
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
  commission_pct: number
) {
  try {
    const { data, error } = await supabase.functions.invoke('inviter-intervenant', {
      body: { email, nom, prenom, commission_pct }
    })

    if (error) return { error: error.message }
    if (data?.error) return { error: data.error }

    return { error: null }
  } catch (err: any) {
    console.error('Erreur inviterIntervenant:', err)
    return { error: err.message || "Erreur lors de l'invitation" }
  }
}
