# Correction 1 — FONC-01 : Calcul de TVA avec remise

**Date** : 2026-07-22
**Branche** : `capacitor-android`
**Statut** : Correction appliquée, testée, non commitée, non déployée.

---

## 1. Problème initial

Dans `src/pages/DevisFormPage.tsx`, le calcul historique des totaux d'un devis était :

```ts
const tot = lignes.reduce((a, l) => ({ ht: a.ht + l.total_ht, ttc: a.ttc + l.total_ttc }), { ht: 0, ttc: 0 })
const remise = Math.round(tot.ttc * (form.remise_pct / 100) * 100) / 100
const totalFinal = tot.ttc - remise
const tva = Math.round((totalFinal - tot.ht) * 100) / 100
```

La remise était appliquée sur le **TTC agrégé**, puis la TVA était **recalculée par soustraction** (`totalFinal - tot.ht`) au lieu d'être recalculée sur une base HT. Pour toute remise dépassant environ 9 % (TVA 20 %) à 17 % (TVA 5,5 %), `tva` devenait **négatif**, un devis/facture pouvant afficher une TVA négative — une anomalie bloquante avant commercialisation (cf. `audit-kaytek-inter/phase-06-audit-fonctionnel.md`, `phase-12-rapport-final.md`, action `A1`).

Le même schéma de calcul était dupliqué, avec de légères variantes, dans :
- `manuelTtc` (ajout manuel de ligne) dans `DevisFormPage.tsx`,
- `src/lib/pdf/generator.tsx` (affichage PDF du devis — pas de recalcul mais affichage potentiellement incohérent avec la convention retenue),
- `src/lib/hooks/index.ts` (`useDuplicateDevis`, `useDevisToFacture` — copie brute des montants déjà stockés, y compris s'ils étaient déjà erronés).

## 2. Cause racine

Absence d'une fonction de calcul centrale, pure, opérant sur les données sources (quantité, prix HT, taux de TVA par ligne) avec une convention explicite pour la remise. Le calcul partait du TTC déjà arrondi et en déduisait la TVA par différence, ce qui casse l'invariant comptable `HT + TVA = TTC` dès que la remise est significative.

## 3. Convention retenue (obligatoire, documentée dans le code)

- `total_ht` = HT **après** remise (net)
- `tva_montant` = TVA calculée sur le HT après remise, **par taux de TVA**, jamais par soustraction sur un TTC
- `total_ttc` = `total_ht + tva_montant`, exact à l'arrondi près (invariant garanti)
- `remise_montant` = montant TTC économisé par rapport au TTC avant remise
- `remise_pct` = pourcentage appliqué
- Affichage : quand une remise est appliquée, un **sous-total HT avant remise** est montré explicitement au-dessus de la ligne "Remise", pour ne jamais laisser croire à une double déduction entre un "Total HT" déjà net et une ligne "Remise" supplémentaire. Sans remise, l'affichage reste strictement inchangé (3 lignes : Total HT / TVA / Total TTC).

## 4. Formule utilisée (multi-taux, avec remise)

Implémentée dans `src/lib/devisCalc.ts::calculerTotauxDevis` :

1. Pour chaque ligne : `ligne.total_ht = quantité × prix_ht` (arrondi 2 décimales), `ligne.total_ttc = total_ht × (1 + tva_pct/100)` (arrondi 2 décimales).
2. Les lignes sont groupées par taux de TVA. Le HT total de chaque groupe est calculé **avant remise**.
3. La remise (`remise_pct`, 0–100, clampée par sécurité — voir §6) est répartie **proportionnellement** entre les groupes de taux, au prorata du HT de chaque groupe par rapport au HT total avant remise.
4. Pour chaque groupe : `HT_après_remise = HT_avant_remise × (1 − remise_pct/100)` (arrondi 2 décimales), puis `TVA_groupe = HT_après_remise × taux/100` (arrondi 2 décimales).
5. `total_ht = Σ HT_après_remise` (tous groupes), `tva_montant = Σ TVA_groupe`, `total_ttc = arrondi2(total_ht + tva_montant)` — garantissant l'exactitude au centime de l'invariant par construction (le TTC n'est jamais recalculé indépendamment).
6. **Réconciliation d'arrondi déterministe** : si la somme des HT après remise arrondis par groupe diverge d'un centime du HT total après remise arrondi globalement (cas possible quand la remise est répartie sur plusieurs taux avec des montants non ronds), l'écart d'1 centime est imputé **au groupe ayant le plus grand HT avant remise** — règle déterministe, testée explicitement (`devisCalc.test.ts`, cas construits avec montants non ronds).

Cette fonction ne prend jamais en entrée un total déjà arrondi/agrégé : uniquement `quantité`, `prix_ht`, `tva_pct` par ligne, plus `remise_pct`.

## 5. Fichiers modifiés

| Fichier | Nature du changement |
|---|---|
| `src/lib/devisCalc.ts` **(nouveau)** | Module pur de calcul (types, `calculerLigne`, `calculerTotauxDevis`, `validerLignesPourRecalcul`, helpers d'arrondi/clamp). Aucune dépendance React/Supabase. |
| `src/lib/devisCalc.test.ts` **(nouveau)** | 42 tests unitaires Vitest couvrant la matrice obligatoire (taux simples, remises 0/10/20/50/100 % à 10 %/20 % de TVA, multi-taux avec/sans remise, réconciliation d'arrondi, protections). |
| `vitest.config.ts` **(nouveau)** | Config Vitest isolée (alias `@`, `include: src/**/*.test.ts`, environnement `node`). Ne modifie ni `vite.config.ts` ni `playwright.config.ts`. |
| `package.json` | Ajout de `vitest@2.1.9` en devDependency exacte + script `test:unit`. Aucune autre dépendance/script touché. |
| `package-lock.json` | Mise à jour automatique liée à l'ajout de `vitest` uniquement (via `npm install --save-dev --save-exact`). |
| `src/pages/DevisFormPage.tsx` | `calc()` délègue à `calculerLigne`. Totaux (`totaux`) délégués à `calculerTotauxDevis`. `manuelTtc` délégué à `calculerLigne`. Ajout validation explicite de la remise (`remiseError`, `handleRemiseChange`) avec message utilisateur, blocage de `save()` si invalide. Affichage récap restructuré en "waterfall" conditionnel. |
| `src/lib/pdf/generator.tsx` | `Totals` : prop `remise` remplacée par `htAvantRemise` (calculé via nouveau helper `calculerHtAvantRemisePourAffichage`, `undefined` si lignes historiques inexploitables → repli sur affichage simple). Montants HT/TVA/TTC affichés restent toujours ceux stockés sur le devis (aucun recalcul silencieux des montants réels). Appel PDF facture non modifié (aucune remise sur les factures). |
| `src/pages/DevisApercuPage.tsx` | Ajout `htAvantRemise` dérivé (même logique que le PDF). Bloc de rendu des totaux restructuré en tableau conditionnel (waterfall si dispo, sinon affichage d'origine). |
| `src/lib/hooks/index.ts` | `useDuplicateDevis` et `useDevisToFacture` : valident les lignes sources (`validerLignesPourRecalcul`) et recalculent les montants via `calculerTotauxDevis` si valides ; sinon conservent les montants déjà stockés (`console.warn` non bloquant). Voir §7. |

## 6. Validation de la remise saisie (formulaire)

Ajout de `handleRemiseChange` dans `DevisFormPage.tsx` : rejette explicitement (message affiché, `form.remise_pct` **non** mis à jour) toute saisie non finie (NaN), négative, ou > 100. Le clamp défensif interne de `calculerTotauxDevis`/`clampRemisePct` (tout non-fini → 0) reste un filet de sécurité de dernier recours, documenté dans le JSDoc, mais n'est plus le seul mécanisme de protection — la validation au niveau du formulaire empêche désormais qu'une saisie invalide soit silencieusement acceptée puis enregistrée.

## 7. Données historiques (duplication / transformation devis→facture)

`validerLignesPourRecalcul(lignes: unknown)` vérifie strictement que `lignes` est un tableau non vide dont chaque élément possède `quantite`/`prix_ht`/`tva_pct` numériques finis et cohérents. Renvoie `null` au moindre doute (jamais un résultat partiel).

- Si valide → recalcul complet via `calculerTotauxDevis` (corrige au passage un éventuel devis dupliqué qui aurait été créé avec l'ancien bug de TVA négative).
- Si invalide (données historiques incomplètes) → **les montants déjà stockés sur le devis source sont conservés tels quels** (stratégie retenue : préserver plutôt que bloquer ou zéroter), avec un `console.warn` explicite non bloquant pour la traçabilité. Aucune donnée déjà enregistrée en base n'est jamais modifiée par cette correction — seul le nouveau document créé (duplicata ou facture) est concerné.

## 8. Hors périmètre (strictement non traité dans cette correction)

- **FONC-03 (nouvellement identifiée, à traiter séparément)** — `src/pages/InterventionDetailPage.tsx` (lignes ~178-182) calcule le HT/TVA d'une facture créée directement depuis une intervention avec un **taux de TVA fixe codé en dur à 10 %** (`montant_ht: Math.round((factureForm.montant_ttc / 1.1) * 100) / 100`), indépendamment du taux réel applicable. Ce chemin de facturation directe n'utilise pas `devisCalc.ts` et n'a pas été touché. À traiter comme correction distincte, sur autorisation explicite.
- Contraintes SQL (`CHECK`) sur les montants financiers — non modifiées, aucune migration créée.
- Devis déjà stockés en base avec l'ancien calcul erroné — non retouchés (voir §7 pour la duplication/transformation, qui ne modifie que les nouveaux documents).
- Mise en page générale des PDF, commissions, numérotation, abonnements — non touchés.

## 9. Environnement / installation

- Node : `v22.16.0`, npm : `9.6.2` (vérifiés avant installation).
- `vitest@2.1.9` installé en devDependency exacte (`--save-exact`), aucune autre dépendance modifiée, aucun `npm audit fix` exécuté.
- Nouveau script `"test:unit": "vitest run"` ajouté à `package.json` ; aucun script existant renommé/modifié ; Playwright (`test`, `test:beta`, etc.) intact.

## 10. Tests exécutés et résultats exacts

**`npx vitest run`** (dernière exécution) :
```
✓ src/lib/devisCalc.test.ts (42 tests) 14ms
Test Files  1 passed (1)
     Tests  42 passed (42)
```
Matrice couverte : taux simples (0/5,5/10/20 %) ; remises 0/10/20/50/100 % à TVA 10 % et 20 % (incluant la reproduction exacte du scénario FONC-01 original) ; multi-taux avec/sans remise, quantités/prix variés ; réconciliation d'arrondi déterministe (cas construit à dessein) ; protections (lignes vides, quantité nulle, remise négative, remise > 100, NaN/Infinity, `validerLignesPourRecalcul` sur données incomplètes/malformées).

Deux ajustements apportés **au fichier de test lui-même** (aucun changé dans `devisCalc.ts`) :
- Une assertion `toBe` sur une re-sommation flottante dans le test a été remplacée par `toBeCloseTo(..., 10)` (résidu IEEE754 propre au test, pas à la fonction — le TTC produit par `calculerTotauxDevis` est lui bien arrondi exactement).
- L'attente pour `remise_pct = Infinity`/`-Infinity` a été corrigée de `100`/`0` vers `0`/`0`, conforme au comportement volontaire et documenté de `clampRemisePct` (toute valeur non finie → 0, par sécurité contre une remise de 100 % accidentelle sur donnée corrompue).

**`npm run typecheck`** :
```
src/pages/DevisFormPage.tsx(191,42): error TS2339: Property 'adresse_intervention' does not exist...
```
Une seule erreur, **pré-existante** (déjà documentée en phase 9/10 de l'audit, alors à la ligne 170). Preuve qu'elle n'est pas introduite par cette correction : `git diff --unified=0 -- src/pages/DevisFormPage.tsx | grep -A2 -B2 "openRdvModal\|adresse_intervention"` ne retourne **aucune ligne** — la fonction `openRdvModal()` concernée n'apparaît nulle part dans le diff ; son décalage de la ligne 170 à 191 est uniquement dû aux insertions de code plus haut dans le fichier.

**`npm run build`** : succès (`✓ built in 13.20s`), PWA precache 96 entrées, 3690.51 KiB (vs 3686.57 KiB avant correction — augmentation négligeable, cohérente avec le code ajouté). Mêmes avertissements de taille de chunk déjà documentés en phase 9 (PERF-01, `pdf-*.js`/`exceljs-*.js`), aucun nouvel avertissement.

## 11. Éléments non testés / non vérifiés

- **Aucune vérification navigateur/Playwright** n'a été effectuée sur cette correction (non demandée à ce stade ; les tests Playwright existants n'ont pas été exécutés ni modifiés).
- Le rendu visuel réel du PDF (mise en page du bloc "Sous-total HT avant remise / Remise / Total HT après remise") n'a pas été vérifié visuellement (génération PDF réelle non exécutée) — seule la logique de `calculerHtAvantRemisePourAffichage` et la structure conditionnelle du composant `Totals` ont été relues.
- Le comportement de `useDuplicateDevis`/`useDevisToFacture` sur un devis réel existant en base (avec des lignes historiques réellement incomplètes) n'a pas été testé en conditions réelles — seule la fonction `validerLignesPourRecalcul` est couverte par tests unitaires sur des structures simulées.
- **FONC-03** (`InterventionDetailPage.tsx`, TVA fixe à 10 %) reste non corrigée — identifiée et documentée uniquement.

## 12. Risques résiduels

- Faible : la logique de répartition proportionnelle de la remise entre taux de TVA n'a pas d'équivalent métier antérieur à comparer — le comportement est nouveau (avant, un devis multi-taux avec remise produisait déjà des montants incohérents). Risque d'écart de perception si un utilisateur compare avec un devis multi-taux déjà émis avant cette correction.
- Faible : les devis déjà stockés avec l'ancien bug (TVA négative) ne sont pas corrigés rétroactivement ; ils resteront affichés tels quels tant qu'ils ne sont ni dupliqués ni transformés en facture.
- Nul côté base de données : aucune migration, aucune écriture, aucune donnée modifiée par cette correction.

## 13. Procédure de déploiement future (documentée, non exécutée)

Aucune migration SQL n'est nécessaire pour cette correction (purement frontend). Déploiement standard applicatif :
```
npm run build
# puis déploiement selon la procédure habituelle du projet (non exécuté ici)
```
Aucune commande `supabase db push` ni opération Supabase distante n'est concernée par cette correction.

## 14. Procédure de retour arrière (rollback)

Purement local, aucune donnée/production affectée :
```
git checkout -- src/pages/DevisFormPage.tsx src/pages/DevisApercuPage.tsx src/lib/pdf/generator.tsx src/lib/hooks/index.ts package.json package-lock.json
rm src/lib/devisCalc.ts src/lib/devisCalc.test.ts vitest.config.ts
```
Cela restaure exactement l'état précédent (bug FONC-01 y compris), sans impact sur la base de données ni sur les documents déjà générés.

---

**Correction 1 terminée. Je n'ai pas commencé la correction suivante. J'attends votre autorisation.**
