// supabase/functions/get-public-document/index.ts
// Edge function publique — sert les données d'un devis/facture via token
// Utilise la service role key pour bypasser le RLS (accès public contrôlé par token)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const token = url.searchParams.get('token')
    if (!token) {
      return new Response(JSON.stringify({ error: 'Token manquant' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    )

    // Récupère le lien par token
    const { data: link, error: linkErr } = await supabase
      .from('document_public_links')
      .select('*')
      .eq('token', token)
      .maybeSingle()

    if (linkErr || !link) {
      return new Response(JSON.stringify({ error: 'Lien introuvable' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Vérifie l'expiration
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: 'Ce lien a expiré' }), {
        status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Récupère le document
    let document = null
    if (link.document_type === 'devis') {
      const { data } = await supabase
        .from('devis')
        .select('id, numero, statut, modele_id, lignes, remise_pct, remise_montant, total_ht, tva_montant, total_ttc, notes, valide_jusqu_au, created_at, activite, signature_client, signature_url, signe_le, signe_par, signature_date, client:clients(nom, prenom, telephone, email, adresse_intervention), intervenant:profiles!intervenant_id(prenom, nom)')
        .eq('id', link.document_id)
        .single()
      document = data
    } else if (link.document_type === 'facture') {
      const { data } = await supabase
        .from('factures')
        .select('id, numero, statut_paiement, montant_ht, tva_montant, montant_ttc, date_emission, date_echeance, date_paiement, mode_paiement, notes, client:clients(nom, prenom, telephone, email, adresse_intervention), devis:devis(modele_id, lignes, remise_pct, total_ht, tva_montant, total_ttc, activite, notes)')
        .eq('id', link.document_id)
        .single()
      document = data
    }

    if (!document) {
      return new Response(JSON.stringify({ error: 'Document introuvable' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Récupère les paramètres de l'organisation (logo, nom entreprise, etc.)
    const { data: params } = await supabase
      .from('parametres_entreprise')
      .select('raison_sociale, logo_url, telephone, email, adresse, code_postal, ville, siret, numero_tva, iban, bic, rc_pro, cgv, modele_pdf_defaut')
      .eq('organisation_id', link.organisation_id)
      .maybeSingle()

    return new Response(JSON.stringify({
      document_type: link.document_type,
      document,
      params,
      token,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
