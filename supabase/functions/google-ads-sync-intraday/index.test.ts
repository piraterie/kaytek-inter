// supabase/functions/google-ads-sync-intraday/index.test.ts
//
// Point d'entrée planifié : chemin INTERNE uniquement. Rejets précoces, sans base
// ni réseau (aucun appel Supabase n'est effectué avant la vérification du secret).
// Exécution (avec les variables factices du runner) : deno test --allow-env supabase/functions/google-ads-sync-intraday/index.test.ts
import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { handleSyncAdsIntraday } from './index.ts'

const req = (method: string, headers: Record<string, string> = {}, body?: unknown) =>
  new Request('https://example.local/functions/v1/google-ads-sync-intraday', { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })

Deno.test('OPTIONS : préflight CORS', async () => {
  assertEquals((await handleSyncAdsIntraday(req('OPTIONS'))).status, 200)
})

Deno.test('GET refusé (405)', async () => {
  assertEquals((await handleSyncAdsIntraday(req('GET'))).status, 405)
})

Deno.test('sans secret interne : 401, aucun traitement (un JWT utilisateur ne suffit pas)', async () => {
  const r = await handleSyncAdsIntraday(req('POST', { Authorization: 'Bearer un-jwt-utilisateur' }, { job: 'hourly' }))
  assertEquals(r.status, 401)
  assertEquals((await r.json()).error, 'Secret interne requis')
})
