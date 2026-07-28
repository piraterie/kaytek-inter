// eslint.config.js
//
// Configuration ESLint SCOPÉE au module d'envoi d'email — décision
// explicite pour ce chantier de fiabilisation (voir
// docs/email-sending-architecture.md) : ce dépôt n'a jamais eu de
// configuration ESLint avant cette correction. L'étendre à tout le code
// existant ferait remonter des dizaines/centaines d'avertissements sans
// rapport avec l'email et rendrait la nouvelle porte CI immédiatement rouge
// pour des raisons hors sujet. Le périmètre est donc imposé par le script
// npm "lint" (voir package.json), qui ne passe QUE les chemins du module
// email en argument à la CLI ESLint — ce fichier n'a donc pas besoin de
// règles d'inclusion/exclusion par chemin.
//
// project: false — lint syntaxique uniquement, pas de vérification de types
// via tsconfig.json : les Edge Functions Deno (supabase/functions/) utilisent
// des imports URL (https://deno.land/..., https://esm.sh/...) que la
// résolution de modules TypeScript standard ne sait pas gérer (c'est
// `deno check`, exécuté séparément, qui fait cette vérification pour elles —
// voir scripts/verify-email-contract.mjs et .github/workflows/email-contract-ci.yml).
import tseslint from 'typescript-eslint'

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        project: false,
      },
    },
    rules: {
      // Resserré pour CE module précisément parce qu'il a déjà cassé la
      // production deux fois (messages d'erreur masqués, champs de contrat
      // non synchronisés) — pas une préférence de style générale à imposer
      // au reste du dépôt.
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      // allowTernary/allowShortCircuit — idiome déjà utilisé dans le code
      // existant scopé ici (ex. `cond ? a.delete(x) : a.add(x)` pour un effet
      // de bord compact sur un Set, FacturesPage.tsx) : on adapte la règle à
      // l'idiome établi plutôt que de réécrire du code applicatif existant
      // sans rapport avec l'email pour satisfaire un nouvel outil.
      '@typescript-eslint/no-unused-expressions': ['error', { allowTernary: true, allowShortCircuit: true }],
      'no-console': 'off', // logging structuré volontaire (logEnvoyerEmailEvent) + scripts Node/Deno
    },
  },
)
