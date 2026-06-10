// src/lib/supabase/auth.ts
import { supabase } from './client'
import type { Profile } from '@/types'

export async function signIn(email: string, password: string): Promise<{ profile: Profile | null; error: string | null }> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { profile: null, error: error.message }
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).single()
  if (!profile) return { profile: null, error: 'Profil introuvable' }
  if (!profile.actif) { await supabase.auth.signOut(); return { profile: null, error: 'Compte desactive' } }
  return { profile, error: null }
}

export async function signOut() { await supabase.auth.signOut() }

export async function resetPassword(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/login'
  })
  return { error: error?.message || null }
}

export async function inviterIntervenant(email: string, nom: string, prenom: string, commissionPct = 30) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password: crypto.randomUUID(),
    options: {
      data: { nom, prenom, role: 'intervenant' },
      emailRedirectTo: window.location.origin + '/login'
    }
  })
  if (error) return { error: error.message }
  if (data.user) {
    await supabase.from('profiles').update({ commission_pct: commissionPct, nom, prenom }).eq('id', data.user.id)
  }
  return { error: null }
}
