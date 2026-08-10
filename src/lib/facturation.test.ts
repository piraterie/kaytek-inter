// src/lib/facturation.test.ts
// Régression — bug "échéance facture serrurerie jusqu'à 1 mois" (2026-08-10) :
// une facture de serrurerie doit être payable immédiatement (échéance =
// date de facture), jamais reportée de 30 jours comme les autres métiers.
// Couvre la cause racine (useDevisToFacture / useCreateFacture dans
// src/lib/hooks/index.ts délèguent tous deux à calculerEcheanceFacture).
import { describe, it, expect } from 'vitest'
import { calculerEcheanceFacture, isPaiementImmediat } from './facturation'

describe('isPaiementImmediat', () => {
  it('est vrai pour la serrurerie', () => {
    expect(isPaiementImmediat('serrurerie')).toBe(true)
  })

  it.each(['vitrerie', 'plomberie', 'electricite', 'chauffagiste', null, undefined, ''])(
    'est faux pour %s',
    (activite) => {
      expect(isPaiementImmediat(activite as any)).toBe(false)
    }
  )
})

describe('calculerEcheanceFacture', () => {
  it('serrurerie : échéance = date de facture (paiement immédiat, aucun délai)', () => {
    const dateEmission = new Date('2026-08-10T14:32:00Z')
    const echeance = calculerEcheanceFacture('serrurerie', dateEmission)
    expect(echeance).toBe('2026-08-10')
  })

  it('autre métier (ex. plomberie) : conserve le délai standard de 30 jours', () => {
    const dateEmission = new Date('2026-08-10T00:00:00Z')
    const echeance = calculerEcheanceFacture('plomberie', dateEmission)
    expect(echeance).toBe('2026-09-09')
  })

  it('activité inconnue/absente : conserve le délai standard de 30 jours (comportement historique)', () => {
    const dateEmission = new Date('2026-08-10T00:00:00Z')
    expect(calculerEcheanceFacture(null, dateEmission)).toBe('2026-09-09')
    expect(calculerEcheanceFacture(undefined, dateEmission)).toBe('2026-09-09')
  })
})
