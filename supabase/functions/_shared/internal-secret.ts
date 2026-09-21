// supabase/functions/_shared/internal-secret.ts
//
// Secret interne partagé entre pg_cron (via pg_net) et les Edge Functions de
// synchronisation planifiées. Comparaison en temps constant : la durée de la
// vérification ne révèle rien du secret attendu.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export async function getInternalSecret(svc: SupabaseClient): Promise<string | null> {
  const { data, error } = await svc.rpc('get_internal_push_secret')
  if (error) return null
  return (data as string) ?? null
}

export function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  let diff = ea.length ^ eb.length
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return diff === 0
}
