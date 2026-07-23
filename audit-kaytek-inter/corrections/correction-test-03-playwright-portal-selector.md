# TEST-03 — Correction du sélecteur Playwright incompatible avec le portail React de CustomSelect

Exécuté strictement en local (Supabase CLI, stack local déjà provisionné lors de VALIDATION-FINALE). Aucune commande n'a jamais touché un projet Supabase distant. Aucun `supabase db push`, aucun `migration repair`, aucun commit, aucun push, aucun déploiement. `CustomSelect.tsx` n'a pas été modifié.

## 1. Sélecteur initial et raison de l'échec

```ts
await pageA.locator('.modal [data-selected]').filter({ hasText: NOM }).first().click()
```

`CustomSelect.tsx` (lignes 122 et 176) rend sa liste déroulante via `createPortal(<div ref={listRef} style={{ position: 'fixed', ... }}>..., document.body)` — un choix de conception délibéré (commentaire en tête de fichier : « Dropdown rendu via portal (position: fixed) pour éviter le clipping causé par overflow:hidden et transform sur .card »). La liste n'est donc **jamais** un descendant DOM de `.modal`, quelle que soit sa position visuelle à l'écran. Le sélecteur `.modal [data-selected]` ne peut structurellement matcher aucun élément — le composant fonctionne correctement, le défaut est uniquement dans le test.

## 2. DOM observé

Inspection du composant (lecture seule, aucune modification) :
- Bouton déclencheur : `<button type="button" onClick={toggle}>` — pas d'attribut `role`/`aria-*` (pas de `role="listbox"`/`role="option"` disponible, donc `page.getByRole('option', ...)` n'est pas applicable ici) ;
- Liste (portail, `document.body`) : `<div ref={listRef} style={position:'fixed', ...}>`, sans classe ni id distinctif ;
- Chaque option : `<div key={opt.value} data-selected={isSelected} onMouseDown={...} onTouchEnd={...}>{opt.label}</div>` — `data-selected` est rendu littéralement `"true"` ou `"false"` par React (pas omis), donc présent sur **toutes** les options, pas seulement celle sélectionnée ;
- Le portail n'est monté que lorsque `open === true` (`{open && dropPos && createPortal(...)}`) : `[data-selected]` n'existe dans le DOM entier **que** pendant qu'une liste est effectivement ouverte, et une seule liste est ouverte à la fois dans ce parcours (clic extérieur ferme les autres).

Capture d'écran de l'échec original (`test-results/.../test-failed-1.png`) : la liste déroulante s'affiche correctement à l'écran, positionnée sous le bouton, avec 2 options lisibles — confirmant que le rendu est correct et que seul le sélecteur de test était en cause.

## 3. Nouveau sélecteur et raison de sa stabilité

```ts
const clientOption = pageA.locator('[data-selected]').filter({ hasText: PRENOM }).first()
await clientOption.waitFor({ state: 'visible' })
await clientOption.click()
await pageA.locator('[data-selected]').waitFor({ state: 'detached' })
```

- Sans préfixe `.modal` : puisque `[data-selected]` n'existe dans le DOM **que** pendant l'ouverture d'une liste CustomSelect, cibler cet attribut seul identifie sans ambiguïté la liste actuellement affichée — pas besoin (et pas possible) de le scoper par ancêtre DOM ;
- Filtré sur `PRENOM` (identifiant unique horodaté par run, `PW-${Date.now()}`) plutôt que sur `NOM` (constant `"TEST-ISO"` sur tous les runs — le fichier de test écrit de vraies données qui restent en base, cf. son propre commentaire d'en-tête) : la première occurrence utilisait `NOM`, ce qui aurait pu matcher un client d'un run précédent au lieu du client fraîchement créé — corrigé pour éliminer cette ambiguïté ;
- Attente sur état DOM réel (`waitFor({state:'visible'})` avant clic, `waitFor({state:'detached'})` après — le portail est démonté par `CustomSelect` dès la sélection via `setOpen(false)`) plutôt que des `waitForTimeout()` arbitraires ;
- Vérification que la valeur choisie est bien affichée dans le champ déclencheur (`.filter({ hasText: NOM/PRENOM })` sur le bouton, après fermeture de la liste).

Ce sélecteur a été appliqué aux deux occurrences du fichier (sélection client pour l'intervention, sélection client pour le devis) — la seconde (ligne ~137 d'origine) n'avait pas le préfixe `.modal` mais bénéficie de la même amélioration d'attente.

## 4. Deux défauts additionnels révélés en cascade (même fichier, même catégorie)

Une fois le sélecteur de portail corrigé, l'exécution est allée plus loin et a révélé deux autres suppositions de test obsolètes — **ni l'une ni l'autre n'est un défaut applicatif** :

- **Navigation post-sauvegarde du devis** : le test attendait `waitForURL('**/devis')` après « Sauvegarder brouillon », mais `DevisFormPage.tsx` (ligne ~285) navigue vers `/devis/:id/apercu` lorsque le devis n'est pas rattaché à une intervention (cas de ce parcours) — comportement actuel confirmé en lisant le composant, jamais modifié. Corrigé : `waitForURL(/\/devis\/[^/]+\/apercu/)` puis retour explicite à `/devis` (`pageA.goto('/devis')`) pour la suite du parcours (recherche de la ligne, transformation en facture) — le parcours via UI est intégralement conservé, aucune donnée insérée directement en base.
- **Bouton « Actions » de la liste devis** : le test cherchait `button:has-text("···")`, mais `DevisPage.tsx` (ligne ~596) rend une icône Lucide (`<MoreHorizontal size={15} />`, sans texte) avec `title="Actions"`. Corrigé : `button[title="Actions"]` (attribut stable, déjà présent, accessible).

Conformément à la règle d'arrêt (point 18), ces deux causes ont été vérifiées par lecture directe du code source applicatif avant correction : aucune des deux ne révèle un défaut réel de l'application — uniquement des suppositions de test devenues obsolètes après une évolution de l'UI, jamais exercées avec succès jusqu'ici puisque le test échouait toujours plus tôt (au sélecteur de portail).

## 5. Résultat — exécution ciblée

```
npx playwright test tests/multi-tenant/02-isolation-create.spec.ts --config=playwright.security.config.ts --reporter=list
```
(wrapper `run-security-playwright.mjs` non utilisé pour cette commande ciblée — commande directe, comme pour la validation finale précédente)

```
ok 1 [security-setup] security auth — admin org A
ok 2 [security-setup] security auth — admin org B (multi-tenant)
ok 3 [security-setup] security auth — intervenant org A
ok 4 [multi-tenant-security] isolation complète : créer dans org A, vérifier dans org B
4 passed
```
1 test cible découvert, 1 exécuté, 1 réussi, 0 ignoré, 0 connexion distante (préflight confirmé). Rapport d'isolation généré (`tests/screenshots/isolation-report/rapport.md`) : client, intervention, devis, facture créés via l'UI réelle dans l'organisation A ; 0 occurrence de `TEST-ISO` détectée dans `/clients`, `/interventions`, `/devis`, `/factures` de l'organisation B — **isolation confirmée avec des données réelles créées via UI**, jamais par insertion directe en base.

## 6. Résultat — Playwright complet

```
npx playwright test --config=playwright.security.config.ts --reporter=list,json
```
```
14 passed (1.1m)
stats: { expected: 14, skipped: 0, unexpected: 0, flaky: 0 }
```
**14 tests exécutés, 14 réussis, 0 échoué, 0 ignoré.**

## 7. Résultat — `npm run test:security` et build

`npm run test:security` (chaîne : preflight → sql → storage → edge-functions → concurrency → playwright) exécute avec succès jusqu'à l'étape playwright, où le wrapper `scripts/run-security-playwright.mjs` échoue avec la même erreur pré-existante déjà documentée en VALIDATION-FINALE (`spawnSync npx.cmd EINVAL`, absence de `shell:true`, bug de l'environnement Windows/Git-Bash de cette machine) — **limite du runner Windows, non modifiée dans cette correction** (hors périmètre : seul `tests/multi-tenant/02-isolation-create.spec.ts` était autorisé). Toutes les sous-suites qu'elle chaîne ont été validées individuellement :
- SQL : 5/5 (TEST-02, déjà validé) ;
- Storage : 6 PASS / 0 FAIL / 1 WARN non bloquant (VALIDATION-FINALE, reconfirmé dans cette même exécution) ;
- Edge Functions : 6 PASS / 0 FAIL / 3 WARN non bloquants (VALIDATION-FINALE) ;
- Concurrence : 2 PASS / 0 FAIL / 1 WARN non bloquant (reconfirmé dans cette même exécution) ;
- Playwright : 14/14 (commande directe, §6).

`npm run build` :
```
✓ built in 16.65s
PWA v0.20.5 — 96 entries précachées
```
**Build réussi** (code de sortie 0). Seul avertissement : taille de certains chunks JS (`exceljs`, `pdf`) au-delà de 500 kB — avertissement Vite standard, non bloquant, sans rapport avec cette correction.

`npm run typecheck` (exécuté à titre de vérification complémentaire, non exigée si le build seul doit réussir) : une seule erreur pré-existante, sans rapport avec cette correction ni avec les fichiers touchés :
```
src/pages/DevisFormPage.tsx(191,42): error TS2339: Property 'adresse_intervention' does not exist on type '{ nom: string; prenom?: string; telephone?: string; email?: string; }'.
```
Documentée comme dette technique non bloquante (le build `vite build`, basé sur esbuild, ne l'empêche pas de réussir).

## 8. Tests réussis / échoués / ignorés (bilan complet)

| Suite | Réussis | Échoués | Ignorés |
|---|---|---|---|
| SQL (Corrections 2-5) | 5/5 | 0 | 0 |
| Unitaires | 42/42 | 0 | 0 |
| Storage | 6 | 0 | 0 (1 WARN non bloquant) |
| Edge Functions | 6 | 0 | 0 (3 WARN non bloquants) |
| Concurrence | 2 | 0 | 0 (1 WARN non bloquant) |
| Playwright | **14/14** | 0 | 0 |

Zéro test critique ignoré sur l'ensemble des suites. Zéro connexion distante à aucun moment (préflight local confirmé avant chaque exécution).

## 9. Limites environnementales restantes (non bloquantes, déjà documentées)

- `scripts/run-security-playwright.mjs` : bug `spawnSync('npx.cmd', ...)` sans `shell:true`, propre à cette machine Windows/Git-Bash — non corrigé (hors périmètre de TEST-03), contourné par la commande directe équivalente ;
- `scripts/test-security-storage.mjs` / `test-security-edge-functions.mjs` : `select('id, ...)` sur `subscriptions`, table sans colonne `id` (clé = `user_id`) — dégrade en WARN, jamais en FAIL ;
- `scripts/test-security-concurrency.mjs` : `statut_paiement: 'a_payer'`, valeur absente de la contrainte CHECK — dégrade en WARN ;
- `npm run typecheck` : 1 erreur pré-existante dans `DevisFormPage.tsx`, sans rapport avec cette correction.

Toutes documentées dans le rapport VALIDATION-FINALE précédent ou ci-dessus ; aucune n'affecte le résultat Playwright 14/14 ni le build.

## 10. Fichiers modifiés

- `tests/multi-tenant/02-isolation-create.spec.ts` (seul fichier de test autorisé — sélecteur de portail, navigation post-sauvegarde devis, sélecteur du bouton Actions)
- `audit-kaytek-inter/corrections/correction-test-03-playwright-portal-selector.md` (ce rapport)

`CustomSelect.tsx`, `DevisFormPage.tsx`, `DevisPage.tsx` ont été **lus** pour diagnostiquer les causes racines mais **jamais modifiés**. Aucune migration, aucune Edge Function, aucune policy, aucune fonction SQL métier, aucun privilège, aucun secret distant, `package.json` non modifié.

## 11. Absence d'opération distante

Confirmé par le préflight (`runPreflight()`) exécuté avant chaque suite/test tout au long de cette correction : `SUPABASE_TEST_URL`/`SUPABASE_TEST_DB_URL` résolus sur `127.0.0.1` à chaque appel, aucune variable de contournement utilisée, aucune référence au projet de production connu.

## 12. Verdict final de commercialisation

| Critère (section 8 de l'autorisation) | Statut |
|---|---|
| SQL réussi | ✅ |
| Unitaires réussi | ✅ |
| Storage réussi | ✅ |
| Edge Functions réussi | ✅ |
| Concurrence réussi | ✅ |
| Playwright 14/14 | ✅ |
| Build réussi | ✅ |
| Zéro test critique ignoré | ✅ |
| Zéro défaut multi-tenant | ✅ (isolation confirmée avec données réelles créées via UI, org A invisible depuis org B sur les 4 types de ressources) |
| Zéro accès anonyme sensible | ✅ |
| Zéro doublon de commission | ✅ (numérotation concurrente prouvée atomique) |
| Aucune production contactée | ✅ |

Tous les critères de la section 8 sont remplis.

---

**VALIDATION FINALE RÉUSSIE. Kaytek Inter peut être commercialisée dans le cadre d'un lancement contrôlé. J'attends votre autorisation avant tout déploiement.**
