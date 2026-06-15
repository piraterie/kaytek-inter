// src/lib/data/guide-faq.ts — Questions fréquentes du centre d'aide
export interface FaqItem {
  id: string
  question: string
  reponse: string
  categorie: 'admin' | 'intervenant' | 'commun'
  tags: string[]
}

export const FAQ_ITEMS: FaqItem[] = [
  // ── Commun ──────────────────────────────────────────────────────────────
  {
    id: 'connexion-oubli-mdp',
    question: 'J\'ai oublié mon mot de passe, que faire ?',
    reponse: 'Sur l\'écran de connexion, cliquez sur "Mot de passe oublié ?", saisissez votre adresse email et vous recevrez un lien de réinitialisation par email.',
    categorie: 'commun',
    tags: ['connexion', 'mot de passe', 'oubli', 'reset'],
  },
  {
    id: 'connexion-biometrie',
    question: 'Comment activer la connexion par empreinte ?',
    reponse: 'Après votre première connexion par mot de passe, l\'application vous propose d\'activer la biométrie. Vous pouvez aussi l\'activer depuis votre profil.',
    categorie: 'commun',
    tags: ['biométrie', 'empreinte', 'Face ID', 'connexion rapide'],
  },
  {
    id: 'messagerie-utilisation',
    question: 'Comment envoyer un message ?',
    reponse: 'Allez dans "Messagerie", sélectionnez la conversation, tapez votre message et appuyez sur Envoyer. Vous pouvez aussi envoyer des photos et des messages vocaux.',
    categorie: 'commun',
    tags: ['messagerie', 'message', 'chat', 'communication'],
  },
  {
    id: 'notifications-push',
    question: 'Je ne reçois pas de notifications, que faire ?',
    reponse: 'Vérifiez que les notifications sont autorisées pour Kaytek Inter dans les paramètres de votre téléphone. Ensuite, connectez-vous et autorisez les notifications dans l\'application.',
    categorie: 'commun',
    tags: ['notifications', 'push', 'alerte'],
  },
  {
    id: 'deconnexion-auto',
    question: 'Pourquoi suis-je déconnecté automatiquement ?',
    reponse: 'Par sécurité, l\'application vous déconnecte après 30 minutes d\'inactivité. Activez la biométrie pour vous reconnecter rapidement.',
    categorie: 'commun',
    tags: ['déconnexion', 'sécurité', 'timeout', 'session'],
  },

  // ── Admin ────────────────────────────────────────────────────────────────
  {
    id: 'admin-creer-devis',
    question: 'Comment créer un devis ?',
    reponse: 'Allez dans "Devis" → "Nouveau devis", sélectionnez le client, ajoutez les prestations depuis le catalogue, appliquez une remise si besoin, puis enregistrez ou envoyez directement.',
    categorie: 'admin',
    tags: ['devis', 'créer', 'nouveau', 'document'],
  },
  {
    id: 'admin-envoyer-devis',
    question: 'Comment envoyer un devis par email ?',
    reponse: 'Depuis la liste des devis, ouvrez le devis et cliquez sur "Envoyer par email". Vous pouvez personnaliser le message avant l\'envoi.',
    categorie: 'admin',
    tags: ['devis', 'envoyer', 'email', 'client'],
  },
  {
    id: 'admin-facture',
    question: 'Comment créer une facture ?',
    reponse: 'La méthode la plus simple est de transformer un devis accepté en facture. Vous pouvez aussi créer une facture directement depuis "Factures" → "Nouvelle facture".',
    categorie: 'admin',
    tags: ['facture', 'créer', 'transformer', 'devis'],
  },
  {
    id: 'admin-intervention-creer',
    question: 'Comment créer une intervention ?',
    reponse: 'Allez dans "Interventions" → "Nouvelle intervention", sélectionnez le client, renseignez l\'adresse et le type, puis assignez un intervenant.',
    categorie: 'admin',
    tags: ['intervention', 'créer', 'nouveau'],
  },
  {
    id: 'admin-assigner',
    question: 'Comment assigner une intervention à un intervenant ?',
    reponse: 'Sur la fiche de l\'intervention, cliquez sur "Modifier" puis sélectionnez l\'intervenant dans la liste déroulante. L\'intervenant reçoit une notification automatique.',
    categorie: 'admin',
    tags: ['intervention', 'assigner', 'attribuer', 'intervenant'],
  },
  {
    id: 'admin-commission',
    question: 'Comment gérer les commissions ?',
    reponse: 'Allez dans "Commissions" pour voir toutes les commissions calculées. Cliquez sur "Marquer comme payé" une fois le virement effectué à l\'intervenant.',
    categorie: 'admin',
    tags: ['commission', 'payer', 'rémunération'],
  },
  {
    id: 'admin-utilisateur-permissions',
    question: 'Comment donner des permissions à un intervenant ?',
    reponse: 'Dans "Utilisateurs", cliquez sur "Modifier" à côté de l\'intervenant. Activez "Peut créer des documents" pour les devis, et "Peut envoyer sans validation" pour l\'envoi direct.',
    categorie: 'admin',
    tags: ['utilisateur', 'permissions', 'droits', 'intervenant'],
  },
  {
    id: 'admin-catalogue',
    question: 'Comment ajouter une prestation au catalogue ?',
    reponse: 'Allez dans "Catalogue", cliquez sur "Nouvelle prestation", renseignez le nom, la catégorie, et les prix. Cette prestation sera ensuite disponible lors de la création de devis.',
    categorie: 'admin',
    tags: ['catalogue', 'prestation', 'service', 'prix'],
  },

  // ── Intervenant ──────────────────────────────────────────────────────────
  {
    id: 'inter-accepter',
    question: 'Comment accepter une intervention ?',
    reponse: 'Ouvrez la fiche de l\'intervention depuis "Interventions", puis cliquez sur "Accepter". L\'administrateur est automatiquement notifié.',
    categorie: 'intervenant',
    tags: ['intervention', 'accepter', 'confirmer'],
  },
  {
    id: 'inter-statuts',
    question: 'Comment mettre à jour le statut de mon intervention ?',
    reponse: 'Sur la fiche de l\'intervention, utilisez les boutons de statut : "En route" quand vous partez, "Sur place" à votre arrivée, "Terminé" quand vous avez fini.',
    categorie: 'intervenant',
    tags: ['statut', 'en route', 'sur place', 'terminé'],
  },
  {
    id: 'inter-photos',
    question: 'Comment ajouter des photos à une intervention ?',
    reponse: 'Sur la fiche de l\'intervention, descendez jusqu\'à "Photos" et cliquez sur "Ajouter une photo". Choisissez le type (Avant, Après, Autre) puis sélectionnez votre photo.',
    categorie: 'intervenant',
    tags: ['photos', 'ajouter', 'avant', 'après'],
  },
  {
    id: 'inter-signature',
    question: 'Comment faire signer un devis au client ?',
    reponse: 'Depuis l\'aperçu du devis, descendez jusqu\'à la zone de signature. Tendez votre téléphone au client, il signe avec son doigt, puis cliquez sur "Valider".',
    categorie: 'intervenant',
    tags: ['signature', 'signer', 'devis', 'client'],
  },
  {
    id: 'inter-cr',
    question: 'Comment remplir le compte-rendu ?',
    reponse: 'Sur la fiche de l\'intervention terminée, renseignez les travaux réalisés, les matériaux utilisés et le temps passé. Ces informations servent à la facturation.',
    categorie: 'intervenant',
    tags: ['compte-rendu', 'CR', 'travaux', 'matériaux'],
  },
  {
    id: 'inter-commissions',
    question: 'Comment voir mes commissions ?',
    reponse: 'Allez dans "Commissions" pour voir vos commissions calculées, leur statut (à payer, payé) et le détail de chaque intervention concernée.',
    categorie: 'intervenant',
    tags: ['commissions', 'gains', 'rémunération', 'paiement'],
  },
]
