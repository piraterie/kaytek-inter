// src/lib/data/guide-admin.ts — Contenu statique du guide administrateur
export interface GuideSection {
  slug: string
  titre: string
  objectif: string
  etapes: string[]
  conseil?: string
  temps_moyen: string
  video_slug: string // correspond à guide_videos.section_slug
}

export const GUIDE_ADMIN_SECTIONS: GuideSection[] = [
  {
    slug: 'connexion',
    titre: 'Connexion',
    objectif: 'Accéder à votre espace administrateur en toute sécurité.',
    etapes: [
      'Ouvrir l\'application sur votre appareil.',
      'Saisir votre adresse email et votre mot de passe.',
      'Cliquer sur "Se connecter".',
      'Activer la connexion biométrique pour les prochaines fois (optionnel).',
    ],
    conseil: 'Activez la biométrie pour vous connecter plus rapidement.',
    temps_moyen: '30 secondes',
    video_slug: 'connexion',
  },
  {
    slug: 'creer-client',
    titre: 'Créer un client',
    objectif: 'Enregistrer un nouveau client dans votre base.',
    etapes: [
      'Aller dans le menu "Clients".',
      'Cliquer sur "Nouveau client".',
      'Remplir les informations : nom, téléphone, adresse.',
      'Cliquer sur "Enregistrer".',
    ],
    conseil: 'L\'email et l\'adresse ne sont pas obligatoires mais facilitent l\'envoi de devis.',
    temps_moyen: '1 minute',
    video_slug: 'creer-client',
  },
  {
    slug: 'creer-intervention',
    titre: 'Créer une intervention',
    objectif: 'Créer et planifier une nouvelle intervention terrain.',
    etapes: [
      'Aller dans le menu "Interventions".',
      'Cliquer sur "Nouvelle intervention".',
      'Sélectionner le client et renseigner l\'adresse.',
      'Choisir le type d\'activité et la date prévue.',
      'Cliquer sur "Créer".',
    ],
    conseil: 'Cochez "Urgente" pour que l\'intervention apparaisse en priorité dans le tableau de bord.',
    temps_moyen: '1 minute',
    video_slug: 'creer-intervention',
  },
  {
    slug: 'assigner-intervention',
    titre: 'Assigner une intervention',
    objectif: 'Attribuer une intervention à l\'un de vos intervenants.',
    etapes: [
      'Ouvrir la fiche de l\'intervention.',
      'Cliquer sur "Modifier".',
      'Sélectionner l\'intervenant dans la liste.',
      'Enregistrer les modifications.',
    ],
    conseil: 'L\'intervenant reçoit une notification automatique dès l\'attribution.',
    temps_moyen: '45 secondes',
    video_slug: 'assigner-intervention',
  },
  {
    slug: 'creer-devis',
    titre: 'Créer un devis',
    objectif: 'Générer un devis professionnel pour un client.',
    etapes: [
      'Aller dans "Devis" puis cliquer sur "Nouveau devis".',
      'Sélectionner le client.',
      'Ajouter les prestations depuis le catalogue ou manuellement.',
      'Appliquer une remise si nécessaire.',
      'Enregistrer en brouillon ou envoyer directement.',
    ],
    conseil: 'Utilisez le catalogue pour ajouter des prestations en un clic avec les prix pré-configurés.',
    temps_moyen: '2 minutes',
    video_slug: 'creer-devis',
  },
  {
    slug: 'transformer-devis-facture',
    titre: 'Transformer un devis en facture',
    objectif: 'Convertir un devis accepté en facture.',
    etapes: [
      'Ouvrir le devis accepté depuis la liste.',
      'Cliquer sur "Transformer en facture".',
      'Confirmer la conversion.',
      'La facture est créée automatiquement avec les mêmes informations.',
    ],
    conseil: 'Vérifiez que le devis est bien signé avant de le convertir en facture.',
    temps_moyen: '45 secondes',
    video_slug: 'transformer-devis-facture',
  },
  {
    slug: 'gerer-utilisateur',
    titre: 'Gérer un utilisateur',
    objectif: 'Modifier les permissions et le profil d\'un intervenant.',
    etapes: [
      'Aller dans "Utilisateurs".',
      'Cliquer sur "Modifier" à côté de l\'intervenant.',
      'Ajuster le taux de commission, le type et les permissions.',
      'Gérer les appareils connectés si nécessaire.',
      'Enregistrer.',
    ],
    conseil: 'Activez "Peut créer des documents" pour qu\'un intervenant puisse générer ses propres devis.',
    temps_moyen: '1 minute',
    video_slug: 'gerer-utilisateur',
  },
  {
    slug: 'parametres-entreprise',
    titre: 'Paramètres entreprise',
    objectif: 'Configurer les informations de votre entreprise.',
    etapes: [
      'Aller dans "Paramètres".',
      'Renseigner le SIRET, TVA, IBAN et les coordonnées.',
      'Uploader votre logo.',
      'Configurer les emails automatiques.',
      'Enregistrer.',
    ],
    conseil: 'Le logo et le SIRET apparaissent sur vos devis et factures PDF.',
    temps_moyen: '3 minutes',
    video_slug: 'parametres-entreprise',
  },
]

export const GUIDE_ADMIN_QUICK_START: GuideSection = {
  slug: 'quick-start',
  titre: 'Démarrage rapide',
  objectif: 'Comprendre l\'application en moins de 2 minutes.',
  etapes: [
    'Le Dashboard vous donne une vue d\'ensemble : CA, interventions, impayés.',
    'Créez d\'abord vos clients, puis vos interventions.',
    'Depuis les devis, générez et envoyez des documents professionnels.',
    'Gérez votre équipe depuis "Utilisateurs".',
    'Configurez votre entreprise dans "Paramètres".',
  ],
  temps_moyen: '2 minutes',
  video_slug: 'quick-start',
}

export const GUIDE_ADMIN_VISITE: GuideSection = {
  slug: 'visite-complete',
  titre: 'Visite complète',
  objectif: 'Tour exhaustif de toutes les fonctionnalités administrateur.',
  etapes: [
    'Découvrez toutes les pages et fonctions disponibles.',
    'Consultez les flux de travail complets.',
  ],
  temps_moyen: '2 minutes',
  video_slug: 'visite-complete',
}

/** Toutes les sections dans l'ordre d'affichage */
export const ALL_ADMIN_SECTIONS: GuideSection[] = [
  GUIDE_ADMIN_QUICK_START,
  ...GUIDE_ADMIN_SECTIONS,
]
