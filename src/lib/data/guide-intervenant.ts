// src/lib/data/guide-intervenant.ts — Contenu statique du guide intervenant
import type { GuideSection } from './guide-admin'
export type { GuideSection }

export const GUIDE_INTERVENANT_SECTIONS: GuideSection[] = [
  {
    slug: 'connexion',
    titre: 'Connexion',
    objectif: 'Accéder à votre espace intervenant.',
    etapes: [
      'Ouvrir l\'application Kaytek Inter sur votre smartphone.',
      'Saisir votre email et votre mot de passe.',
      'Cliquer sur "Se connecter".',
      'Activer la biométrie pour les prochaines connexions (recommandé).',
    ],
    conseil: 'La biométrie (empreinte ou Face ID) vous permet de vous connecter en 1 seconde.',
    temps_moyen: '30 secondes',
    video_slug: 'connexion',
  },
  {
    slug: 'reception-intervention',
    titre: 'Réception d\'une intervention',
    objectif: 'Consulter une nouvelle intervention qui vous a été assignée.',
    etapes: [
      'Ouvrir le menu "Interventions".',
      'Voir la liste de vos interventions et leurs statuts.',
      'Cliquer sur une intervention pour voir les détails.',
      'Consulter l\'adresse, la description et la date prévue.',
    ],
    conseil: 'Vous recevez une notification dès qu\'une intervention vous est assignée.',
    temps_moyen: '45 secondes',
    video_slug: 'reception-intervention',
  },
  {
    slug: 'acceptation-intervention',
    titre: 'Accepter une intervention',
    objectif: 'Accepter ou refuser une intervention assignée.',
    etapes: [
      'Ouvrir la fiche de l\'intervention.',
      'Lire les détails (adresse, description, date).',
      'Cliquer sur "Accepter" pour confirmer.',
      'L\'administrateur est notifié de votre réponse.',
    ],
    conseil: 'Si vous ne pouvez pas réaliser l\'intervention, cliquez sur "Refuser" avec un motif.',
    temps_moyen: '30 secondes',
    video_slug: 'acceptation-intervention',
  },
  {
    slug: 'gestion-statuts',
    titre: 'Gérer les statuts',
    objectif: 'Mettre à jour l\'avancement de l\'intervention en temps réel.',
    etapes: [
      'Ouvrir la fiche de l\'intervention acceptée.',
      'Cliquer sur "En route" quand vous partez.',
      'Cliquer sur "Sur place" à votre arrivée.',
      'Cliquer sur "Intervention terminée" une fois le travail fini.',
    ],
    conseil: 'Chaque changement de statut notifie automatiquement l\'administrateur.',
    temps_moyen: '1 minute',
    video_slug: 'gestion-statuts',
  },
  {
    slug: 'ajout-photos',
    titre: 'Ajouter des photos',
    objectif: 'Documenter l\'intervention avec des photos avant/après.',
    etapes: [
      'Sur la fiche de l\'intervention, descendre jusqu\'à la section Photos.',
      'Cliquer sur "Ajouter une photo".',
      'Choisir le type : Avant, Après, ou Autre.',
      'Sélectionner la photo depuis votre galerie ou appareil photo.',
    ],
    conseil: 'Les photos avant/après protègent en cas de litige et valorisent votre travail.',
    temps_moyen: '1 minute',
    video_slug: 'ajout-photos',
  },
  {
    slug: 'signature-client',
    titre: 'Signature client',
    objectif: 'Faire signer le devis au client directement sur votre écran.',
    etapes: [
      'Ouvrir l\'aperçu du devis associé à l\'intervention.',
      'Faire défiler jusqu\'au bas de la page.',
      'Tendre votre téléphone au client.',
      'Le client signe avec son doigt sur l\'écran.',
      'Valider la signature.',
    ],
    conseil: 'Le devis signé est automatiquement enregistré et transmis à l\'administrateur.',
    temps_moyen: '1 minute',
    video_slug: 'signature-client',
  },
  {
    slug: 'cloture-intervention',
    titre: 'Clôturer une intervention',
    objectif: 'Finaliser l\'intervention avec le compte-rendu.',
    etapes: [
      'Ouvrir la fiche de l\'intervention terminée.',
      'Remplir le compte-rendu : travaux réalisés, matériaux utilisés.',
      'Indiquer le coût des pièces si vous avez avancé des frais.',
      'Cliquer sur "Intervention terminée".',
    ],
    conseil: 'Un compte-rendu détaillé aide l\'administrateur à facturer correctement.',
    temps_moyen: '2 minutes',
    video_slug: 'cloture-intervention',
  },
]

export const GUIDE_INTERVENANT_QUICK_START: GuideSection = {
  slug: 'quick-start',
  titre: 'Démarrage rapide',
  objectif: 'Maîtriser l\'essentiel de l\'application en moins de 2 minutes.',
  etapes: [
    'Le Dashboard montre vos interventions du jour et vos gains.',
    'Consultez "Interventions" pour voir les missions qui vous sont assignées.',
    'Mettez à jour les statuts (En route → Sur place → Terminé) depuis la fiche.',
    'Ajoutez des photos et signez les devis directement sur votre écran.',
    'La Messagerie vous connecte directement avec l\'administrateur.',
  ],
  temps_moyen: '2 minutes',
  video_slug: 'quick-start',
}

export const GUIDE_INTERVENANT_VISITE: GuideSection = {
  slug: 'visite-complete',
  titre: 'Visite complète',
  objectif: 'Tour de toutes les fonctionnalités disponibles pour les intervenants.',
  etapes: [
    'Découvrez toutes les pages et fonctions disponibles.',
    'Consultez le flux complet d\'une intervention.',
  ],
  temps_moyen: '2 minutes',
  video_slug: 'visite-complete',
}

export const ALL_INTERVENANT_SECTIONS: GuideSection[] = [
  GUIDE_INTERVENANT_QUICK_START,
  ...GUIDE_INTERVENANT_SECTIONS,
]
