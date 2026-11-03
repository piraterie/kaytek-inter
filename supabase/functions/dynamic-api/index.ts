// supabase/functions/dynamic-api/index.ts
// Fonction historique (antérieure au multi-tenant), jamais versionnée et restée
// déployée : elle créait SANS AUCUNE AUTHENTIFICATION un compte Auth confirmé
// pour n'importe quelle adresse e-mail. Aucun usage trouvé (dépôt, historique
// Git, site Netlify). Neutralisée le 2026-11-03 — code d'origine sauvegardé
// dans docs/archive/dynamic-api.original.ts.
//
// Création légitime des comptes :
//  - membres (intervenant / assistant) : Edge Function inviter-intervenant ;
//  - clients self-service : site Netlify (create-trial-account) + provisioning
//    via le trigger sur subscriptions — aucun lien avec cette fonction.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  console.warn('[dynamic-api] appel refusé (fonction neutralisée)')
  return new Response(JSON.stringify({ error: 'Fonction supprimée' }), {
    status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
