#!/usr/bin/env node
// scripts/lib/mock-brevo-server.mjs
//
// Faux serveur Brevo — utilisé UNIQUEMENT par la CI d'intégration
// (.github/workflows/email-contract-ci.yml) pour que envoyer-email puisse
// exécuter un envoi complet (jusqu'à la "réponse Brevo") sans jamais
// toucher le vrai api.brevo.com ni exiger de clé API réelle. envoyer-email
// y est redirigé via la variable d'environnement BREVO_API_URL (voir
// supabase/functions/_shared/emailContract.ts — jamais définie en
// production, où le vrai Brevo reste utilisé par défaut).
//
// Comportement simulé via l'adresse "to[0].email" de la requête reçue
// (aucun autre état, aucune persistance) :
//   - contient "brevo-error-test"  → 400 { message: "Simulated Brevo rejection (mock server)" }
//   - contient "brevo-timeout-test" → ne répond jamais avant que le client
//     n'abandonne (simule une latence/erreur réseau réelle, pas un mock
//     fetch — complémentaire du test Deno qui, lui, ne fait aucun I/O réel)
//   - toute autre adresse → 200 { messageId: "mock-<horodatage aléatoire>" }
//
// N'écoute que sur 0.0.0.0:<port> à l'intérieur de son propre conteneur —
// jamais démarré en dehors d'un contexte CI/local explicite.
import { createServer } from 'node:http'

const PORT = Number(process.env.MOCK_BREVO_PORT || 8787)

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', chunk => { data += chunk })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

const server = createServer(async (req, res) => {
  if (req.method !== 'POST' || !req.url?.startsWith('/v3/smtp/email')) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ message: 'not found (mock server)' }))
    return
  }

  let payload
  try {
    payload = JSON.parse(await readBody(req))
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ message: 'invalid JSON body (mock server)' }))
    return
  }

  const recipient = payload?.to?.[0]?.email ?? ''
  console.log(`[mock-brevo] POST /v3/smtp/email — to=${recipient.includes('@') ? recipient.split('@')[1] : '(invalide)'} attachment=${!!payload?.attachment}`)

  if (recipient.includes('brevo-timeout-test')) {
    // Ne répond jamais — laisse le client (callBrevo) expérimenter un vrai
    // timeout/erreur réseau, pas une simulation en mémoire.
    return
  }

  if (recipient.includes('brevo-error-test')) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ message: 'Simulated Brevo rejection (mock server)' }))
    return
  }

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ messageId: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }))
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[mock-brevo] listening on 0.0.0.0:${PORT}`)
})

process.on('SIGTERM', () => server.close(() => process.exit(0)))
process.on('SIGINT', () => server.close(() => process.exit(0)))
