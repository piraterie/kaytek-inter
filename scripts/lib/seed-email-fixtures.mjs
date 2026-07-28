// scripts/lib/seed-email-fixtures.mjs
// Fixtures dédiées aux tests d'intégration de envoyer-email
// (scripts/test-email-integration.mjs). Réutilise les fonctions déjà
// exportées par scripts/seed-security-fixtures.mjs (organisations, comptes,
// abonnement, client/intervention/devis/facture) et ajoute uniquement ce qui
// manquait : une fiche entreprise avec TOUS les champs requis par
// envoyer-email (raison_sociale + email + telephone + adresse) — la fixture
// ensureParametresEntreprise() existante ne pose que raison_sociale et reste
// inchangée (utilisée par la suite de sécurité, comportement non modifié).

export async function ensureCompleteParametresEntreprise(serviceClient, orgId, overrides = {}) {
  const fields = {
    raison_sociale: 'Email Test Org',
    email: 'contact@email-test-org.example.test',
    telephone: '0102030405',
    adresse: '1 rue de Test',
    code_postal: '75000',
    ville: 'Paris',
    ...overrides,
  }

  const { data: existing } = await serviceClient
    .from('parametres_entreprise').select('id').eq('organisation_id', orgId).maybeSingle()
  if (existing) {
    const { error } = await serviceClient.from('parametres_entreprise').update(fields).eq('id', existing.id)
    if (error) throw new Error(`Mise à jour parametres_entreprise complète (org ${orgId}) impossible : ${error.message}`)
    return
  }
  const { error } = await serviceClient.from('parametres_entreprise').insert({ organisation_id: orgId, ...fields })
  if (error) throw new Error(`Création parametres_entreprise complète (org ${orgId}) impossible : ${error.message}`)
}

// Crée un utilisateur auth SANS ligne profiles correspondante — reproduit le
// seul état atteignable en pratique où requireCanSendEmail() (envoyer-email)
// résout organisationId à null : profiles.organisation_id est NOT NULL
// (migration 20260610000002_profiles_organisation_id.sql), donc un profil
// existant a TOUJOURS une organisation — seule l'ABSENCE de profil (JWT
// valide mais aucune ligne profiles, ex. échec/race pendant le provisioning)
// peut produire ce chemin. Dans ce cas précis, requireCanSendEmail() renvoie
// en réalité "Accès non autorisé" (canSend=false, testé avant la résolution
// d'organisation) plutôt que "Aucune organisation associée à ce compte" —
// ce dernier message est donc du code défensif actuellement inatteignable,
// documenté tel quel (voir docs/email-sending-architecture.md).
export async function ensureUserWithoutProfile(serviceClient, email, password) {
  const { data: list, error: listErr } = await serviceClient.auth.admin.listUsers()
  if (listErr) throw new Error(`Listage des utilisateurs auth impossible : ${listErr.message}`)
  const existing = list.users.find(u => u.email === email)
  if (existing) return existing.id

  const { data: created, error } = await serviceClient.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`Création utilisateur auth sans profil (${email}) impossible : ${error.message}`)
  return created.user.id
}
