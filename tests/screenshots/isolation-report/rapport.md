# Rapport d'isolation multi-tenant

**Date :** 27/07/2026 16:38:53
**Session UID :** 1785163133294
**Client créé :** `TEST-ISO PW-1785163133294`

## 1. Création des données — Org A

### Client
- ✅ **`TEST-ISO PW-1785163133294`** créé dans Org A
- Screenshot : `02-admin-a-client-cree.png`

### Intervention
- ✅ Créée pour le client `TEST-ISO PW-1785163133294`
- Screenshot : `03-admin-a-intervention-creee.png`

### Devis
- ✅ Créé en brouillon pour `TEST-ISO PW-1785163133294`
- Screenshot : `05-admin-a-devis-cree.png`

### Facture
- Devis trouvé — marqué comme envoyé
- ✅ Facture créée depuis le devis
- Screenshot : `07-admin-a-facture-creee.png`

## 2. Vérification isolation — Org B

> Aucun élément contenant `TEST-ISO` ne doit apparaître dans l'interface d'Admin B.

### ✅ /clients — Isolation confirmée
- **0 ligne** contenant `TEST-ISO` dans la liste
- Screenshot : `08-admin-b-clients.png`

### ✅ /interventions — Isolation confirmée
- **0 ligne** contenant `TEST-ISO`
- Screenshot : `09-admin-b-interventions.png`

### ✅ /devis — Isolation confirmée
- **0 ligne** contenant `TEST-ISO`
- Screenshot : `10-admin-b-devis.png`

### ✅ /factures — Isolation confirmée
- **0 occurrence** de `TEST-ISO`
- Screenshot : `11-admin-b-factures.png`

### Recherche globale
- L'application n'expose pas de moteur de recherche global.
- Les 4 pages vérifiées (/clients, /interventions, /devis, /factures) couvrent l'ensemble des données métier.

---

## Résumé

| Entité | Créée dans Org A | Visible par Org B |
|--------|:----------------:|:-----------------:|
| Client | ✅ Oui | ✅ Non |
| Intervention | ✅ Oui | ✅ Non |
| Devis | ✅ Oui | ✅ Non |
| Facture | ✅ Oui | ✅ Non |

**✅ RÉSULTAT GLOBAL : Isolation confirmée — aucune fuite détectée.**

*Screenshots : `tests/screenshots/isolation-report/`*