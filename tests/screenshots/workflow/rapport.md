# Rapport Workflow Complet Kaytek

**Date :** 12/06/2026 22:57:36
**UID session :** `1781297822070`
**Client créé :** `TEST-WORKFLOW PW-1781297822070`  ·  email `test-workflow-1781297822070@example.test`

## Résumé des étapes

| Étape | Statut | Note |
|-------|:------:|------|
| 01 — Dashboard Admin A | ✅ |  |
| 02 — Créer client TEST-WORKFLOW | ✅ | TEST-WORKFLOW PW-1781297822070 |
| 03 — Créer devis + prestation | ✅ | TTC 240€ visible: true |
| 04 — Signature client | ⚠️ | Bouton "Éditer" absent du DocSheet |
| 05 — PDF devis | ⚠️ | Bouton "Exporter PDF" absent du DocSheet |
| 06 — Email devis | ⚠️ | Bouton "Envoyer par email" absent (email client manquant ?) |
| 07 — Convertir en facture | ⚠️ | "Transformer en facture" indisponible — statut non compatible |
| 08 — Créer intervention | ✅ | Intervention créée — TEST-WORKFLOW PW-1781297822070 |
| 09 — Intervenant A dashboard | ⚠️ | Auth intervenant non configurée (INTERVENANT_AUTH vide/absent) |
| 10 — Messagerie | ⚠️ | Auth intervenant non configurée |
| 11 — Photo/vocal | ⚠️ | Non automatisable : getUserMedia indisponible en headless |
| 11a — Bouton photo | ✅ | Présent dans l'interface |
| 11b — Bouton micro | ✅ | Présent dans l'interface |
| 12 — Journal | ✅ | 14 entrée(s) visible(s) dans le journal |

---
*Légende : ✅ Réussi · ❌ Échec · ⚠️ Partiel / non automatisable*
*Screenshots : `tests/screenshots/workflow/`*