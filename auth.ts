// src/lib/supabase/auth.ts
import { supabase } from './client'

export async function signIn(email: string, password: string) {
  try {
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password
    })
    if (signInError) return { profile: null, error: signInError.message }
    if (!data.user) return { profile: null, error: 'Aucun utilisateur trouvé' }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single()

    if (profileError) return { profile: null, error: 'Profil introuvable' }
    return { profile, error: null }
  } catch (err: any) {
    return { profile: null, error: err.message || 'Erreur de connexion' }
  }
}

export async function resetPassword(email: string) {
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`
    })
    if (error) return { error: error.message }
    return { error: null }
  } catch (err: any) {
    return { error: err.message || 'Erreur' }
  }
}

export async function signOut() {
  await supabase.auth.signOut()
}

export async function inviterIntervenant(email: string, nom: string, prenom: string) {
  try {
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
      data: { nom, prenom, role: 'intervenant' }
    })
    if (error) return { user: null, error: error.message }
    return { user: data.user, error: null }
  } catch (err: any) {
    return { user: null, error: err.message || 'Erreur invitation' }
  }
}
