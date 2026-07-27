// supabase/functions/_shared/google-ads-api-no-devtoken.test.ts — Phase 3
//
// Scénario "developer token absent" — GOOGLE_ADS_DEVELOPER_TOKEN doit être
// LAISSÉ NON DÉFINI pour ce fichier (séparé de google-ads-api.test.ts qui
// exige au contraire qu'il soit défini) : la constante est lue une seule
// fois au chargement du module, donc les deux scénarios ne peuvent pas
// cohabiter dans le même process de test.
//
// Exécution : deno test --allow-env supabase/functions/_shared/google-ads-api-no-devtoken.test.ts
import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { listAccessibleAdsAccounts } from './google-ads-api.ts'

const ORG_ID = '00000000-0000-0000-0000-0000000000a1'

Deno.test('GOOGLE_ADS_DEVELOPER_TOKEN absent — reason=developer_token_missing, aucun appel réseau', async () => {
  let called = false
  const originalFetch = globalThis.fetch
  globalThis.fetch = (() => { called = true; throw new Error('ne doit jamais être appelé') }) as typeof fetch
  try {
    const svc = {
      from() { throw new Error('ne doit jamais être appelé avant la vérification du developer token') },
      rpc() { throw new Error('ne doit jamais être appelé avant la vérification du developer token') },
    }
    const result = await listAccessibleAdsAccounts(svc as any, ORG_ID)
    assertEquals(result.ok, false)
    if (!result.ok) assertEquals(result.reason, 'developer_token_missing')
    assertEquals(called, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})
