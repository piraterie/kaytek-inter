// guide/scripts/upload-videos.ts
// Upload les vidéos enregistrées par Playwright vers Supabase Storage
// et insère les métadonnées dans la table guide_videos.
//
// Commande : npx tsx guide/scripts/upload-videos.ts
// Prérequis : .env.guide avec SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js'
import { readdirSync, readFileSync, existsSync } from 'fs'
import path from 'path'

// ── Charge .env.guide ─────────────────────────────────────────────────────
function loadEnv(file: string) {
  const p = path.resolve(file)
  if (!existsSync(p)) return
  readFileSync(p, 'utf-8').split('\n').forEach(l => {
    if (!l.trim() || l.startsWith('#')) return
    const idx = l.indexOf('='); if (idx === -1) return
    const k = l.slice(0, idx).trim()
    const v = l.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
    if (k && !process.env[k]) process.env[k] = v
  })
}
loadEnv('.env.guide')

const SUPABASE_URL              = process.env.SUPABASE_URL              || ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const BUCKET                    = 'guide-videos'
const VIDEOS_DIR                = path.resolve('guide', 'output', 'videos')

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌  SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis dans .env.guide')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

// ── Métadonnées des vidéos ─────────────────────────────────────────────────
const METADATA: Record<string, { titre: string; description: string; duree_secondes: number }> = {
  // Admin
  'admin/00-visite-complete':           { titre: 'Visite complète Admin',                   description: 'Tour exhaustif de toutes les fonctions administrateur.',   duree_secondes: 120 },
  'admin/00-quick-start':               { titre: 'Démarrage rapide Admin',                  description: 'Découvrez l\'application en 2 minutes.',                    duree_secondes: 120 },
  'admin/01-connexion':                 { titre: 'Connexion',                               description: 'Se connecter à Kaytek Inter.',                              duree_secondes: 30  },
  'admin/02-creer-client':              { titre: 'Créer un client',                         description: 'Ajouter un nouveau client dans l\'application.',            duree_secondes: 60  },
  'admin/03-creer-intervention':        { titre: 'Créer une intervention',                  description: 'Créer et configurer une nouvelle intervention.',            duree_secondes: 60  },
  'admin/04-assigner-intervention':     { titre: 'Assigner une intervention',               description: 'Attribuer une intervention à un intervenant.',              duree_secondes: 45  },
  'admin/05-creer-devis':               { titre: 'Créer un devis',                          description: 'Générer un devis complet avec prestations et remise.',      duree_secondes: 90  },
  'admin/06-transformer-devis-facture': { titre: 'Transformer un devis en facture',         description: 'Convertir un devis accepté en facture.',                   duree_secondes: 45  },
  'admin/07-gerer-utilisateur':         { titre: 'Gérer un utilisateur',                    description: 'Modifier les permissions et le profil d\'un intervenant.',  duree_secondes: 60  },
  'admin/08-parametres-entreprise':     { titre: 'Paramètres entreprise',                   description: 'Configurer les informations et préférences de l\'entreprise.',duree_secondes: 60 },
  // Intervenant
  'intervenant/00-visite-complete':     { titre: 'Visite complète Intervenant',             description: 'Tour de toutes les fonctions disponibles.',                 duree_secondes: 120 },
  'intervenant/00-quick-start':         { titre: 'Démarrage rapide Intervenant',            description: 'Découvrez l\'application en 2 minutes.',                    duree_secondes: 120 },
  'intervenant/01-connexion':           { titre: 'Connexion',                               description: 'Se connecter à Kaytek Inter.',                              duree_secondes: 30  },
  'intervenant/02-reception-intervention': { titre: 'Réception d\'une intervention',        description: 'Consulter une nouvelle intervention assignée.',             duree_secondes: 45  },
  'intervenant/03-acceptation-intervention': { titre: 'Accepter une intervention',          description: 'Accepter ou refuser une intervention.',                    duree_secondes: 30  },
  'intervenant/04-gestion-statuts':     { titre: 'Gérer les statuts',                       description: 'Mettre à jour l\'état d\'avancement de l\'intervention.',  duree_secondes: 60  },
  'intervenant/05-ajout-photos':        { titre: 'Ajouter des photos',                      description: 'Joindre des photos avant/après à une intervention.',       duree_secondes: 45  },
  'intervenant/06-signature-client':    { titre: 'Signature client',                        description: 'Faire signer le devis au client sur le terrain.',          duree_secondes: 30  },
  'intervenant/07-cloture-intervention':{ titre: 'Clôturer une intervention',               description: 'Remplir le compte-rendu et terminer l\'intervention.',     duree_secondes: 45  },
}

async function getOrgId(): Promise<string> {
  const { data, error } = await admin.from('organisations').select('id').eq('slug', 'kaytek-inter').single()
  if (error || !data) throw new Error(`Organisation kaytek-inter introuvable : ${error?.message}`)
  return data.id
}

async function uploadVideo(
  orgId: string,
  role: 'admin' | 'intervenant',
  slug: string,
  filePath: string
): Promise<void> {
  const sectionSlug    = slug.replace(/^\d+-/, '')
  const key            = `${role}/${slug}`
  const meta           = METADATA[key]
  const storagePath    = `${orgId}/${role}/${slug}.webm`
  const fileBuffer     = readFileSync(filePath)

  console.log(`  ↑ Upload : ${storagePath}`)

  // Upload dans Supabase Storage (remplace si déjà existant)
  const { error: uploadError } = await admin.storage.from(BUCKET).upload(storagePath, fileBuffer, {
    contentType: 'video/webm',
    upsert: true,
  })
  if (uploadError) throw new Error(`Erreur upload ${storagePath} : ${uploadError.message}`)

  // Calculer l'ordre (numéro au début du slug)
  const ordre = parseInt(path.basename(slug).split('-')[0]) || 99

  // Upsert métadonnées dans guide_videos
  const { error: dbError } = await admin.from('guide_videos').upsert({
    organisation_id:  orgId,
    slug:             `${role}-${slug}`,
    role,
    section_slug:     sectionSlug,
    titre:            meta?.titre       ?? slug,
    description:      meta?.description ?? '',
    duree_secondes:   meta?.duree_secondes ?? null,
    storage_path:     storagePath,
    ordre,
    actif:            true,
  }, { onConflict: 'organisation_id,slug' })

  if (dbError) throw new Error(`Erreur DB ${slug} : ${dbError.message}`)
  console.log(`  ✓ ${meta?.titre ?? slug}`)
}

async function main() {
  console.log('\n🚀  Upload vidéos guide → Supabase Storage\n')

  if (!existsSync(VIDEOS_DIR)) {
    console.error(`❌  Dossier introuvable : ${VIDEOS_DIR}`)
    console.error('    Lancer d\'abord : npx playwright test --config=playwright.guide.config.ts')
    process.exit(1)
  }

  const orgId = await getOrgId()
  console.log(`✓ Organisation : ${orgId}\n`)

  let total = 0
  let errors = 0

  for (const role of ['admin', 'intervenant'] as const) {
    const roleDir = path.join(VIDEOS_DIR, role)
    if (!existsSync(roleDir)) { console.warn(`  ⚠ Dossier absent : ${roleDir}`); continue }

    const files = readdirSync(roleDir).filter(f => f.endsWith('.webm'))
    if (files.length === 0) { console.warn(`  ⚠ Aucune vidéo dans : ${roleDir}`); continue }

    console.log(`── ${role.toUpperCase()} (${files.length} vidéo(s)) ──`)
    for (const file of files) {
      const slug     = path.basename(file, '.webm')
      const filePath = path.join(roleDir, file)
      try {
        await uploadVideo(orgId, role, slug, filePath)
        total++
      } catch (err: any) {
        console.error(`  ❌ ${slug} : ${err.message}`)
        errors++
      }
    }
    console.log()
  }

  console.log(`✅  Upload terminé : ${total} vidéo(s) uploadée(s), ${errors} erreur(s)\n`)
}

main().catch(err => {
  console.error('\n❌ Erreur fatale :', err.message)
  process.exit(1)
})
