// supabase/functions/_shared/google-review-link.ts
// Lien OFFICIEL de demande d'avis Google — jamais un lien de recherche
// générique. Format documenté par Google : nécessite le Place ID de
// l'établissement (metadata.placeId, capturé par google-business-api.ts
// et mis en cache sur gbp_connections.place_id lors de la sélection).
export function buildGoogleReviewLink(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`
}

// Rendu minimal du modèle de message — remplace {{prenom}} et {{lien_avis}}
// uniquement (les seules variables exposées à l'admin dans les paramètres).
// Pas de moteur de template générique : surface volontairement restreinte.
export function renderReviewRequestMessage(template: string, vars: { prenom: string; lienAvis: string }): string {
  return template
    .replaceAll('{{prenom}}', vars.prenom)
    .replaceAll('{{lien_avis}}', vars.lienAvis)
}

// Lien de désinscription — le token est OPAQUE (aléatoire, review_requests.
// unsubscribe_token), jamais une donnée personnelle encodée. baseUrl doit
// être l'origine du frontend (GOOGLE_REVIEW_UNSUBSCRIBE_BASE_URL), sans
// chemin final.
export function buildUnsubscribeLink(baseUrl: string, unsubscribeToken: string): string {
  const origin = baseUrl.replace(/\/$/, '')
  return `${origin}/desinscription-avis?token=${encodeURIComponent(unsubscribeToken)}`
}
