# Synq Chat - Plateforme de Communication Souveraine

Synq Chat est un fork amélioré de Rocket.Chat, conçu pour offrir une expérience de communication d'équipe transparente, sécurisée et souveraine.

## 🚀 Fonctionnalités Principales

### Interface Utilisateur Simplifiée
- **Mode débutant** avec interface épurée
- **Onboarding amélioré** pour les nouveaux utilisateurs
- **Tours guidés** et conseils contextuels
- **Navigation simplifiée** et raccourcis optimisés
- **Accessibilité** complète (lecteurs d'écran, navigation clavier)

### Branding et Personnalisation
- **Logo et couleurs personnalisées** par workspace
- **CSS/JavaScript personnalisés** pour une personnalisation avancée
- **Page de connexion personnalisée** avec image de fond
- **Thème sombre** par défaut
- **Favicon personnalisé**

### Permissions Granulaires
- **Rôles avancés** avec templates prédéfinis
- **Permissions par canal** avec héritage
- **Audit des permissions** et notifications de changement
- **Permissions conditionnelles** (optionnel)

### Intégration Keycloak (SSO)
- **Authentification unique** avec Keycloak
- **Provision automatique** des utilisateurs
- **Synchronisation des groupes et rôles**
- **Mapping personnalisé** des rôles

### Jitsi Amélioré
- **Salles vocales persistantes** (style Discord)
- **Auto-rejoindre** les salles vocales
- **Intégration avec les canaux**
- **Enregistrement des appels** (optionnel)
- **Modération des salles**

### Documents Collaboratifs
- **Intégration Etherpad** pour l'édition collaborative
- **Templates prédéfinis** (réunion, brainstorming, projet)
- **Versioning automatique** des documents
- **Permissions granulaires** par document
- **Export** en différents formats

### Analytics Intégrés
- **Métriques d'activité** (messages, utilisateurs actifs)
- **Top canaux et utilisateurs**
- **Heures et jours de pointe**
- **Temps de réponse** et types de messages
- **Rapports automatiques** et export des données

### Sidebar Personnalisée
- **Navigation simplifiée** avec catégories
- **Recherche intégrée** dans les canaux
- **Canaux récents** et favoris
- **Personnalisation** de l'apparence

### Templates de Workspace
- **Configuration rapide** selon le type d'organisation
- **Templates prédéfinis** (startup, entreprise, communauté, éducation)
- **Canaux et rôles** automatiquement créés

### Canaux en Lecture Seule
- **Gestion des permissions** par canal
- **Canaux archivés** et archivage automatique
- **Modération avancée**

### Workflows et Automatisation
- **Workflows personnalisés** avec déclencheurs multiples
- **Commandes slash** personnalisées
- **Apps Synq** avec marketplace intégré
- **Automatisation** des processus métier

### Bridge et Intégrations
- **Intégrations externes** simplifiées
- **Webhooks** et APIs
- **Synchronisation** avec d'autres plateformes

## 🛠️ Installation et Configuration

### Prérequis
- Node.js 22.16.0
- Yarn 4.9.3
- MongoDB 4.4, 5.0, ou 6.0

### Installation
```bash
# Cloner le repository
git clone https://github.com/yourorg/synq-chat.git
cd synq-chat

# Installer les dépendances
yarn install

# Configuration de l'environnement
cp .env.example .env.local
# Éditer .env.local avec vos paramètres

# Démarrer en mode développement
yarn dev
```

### Configuration des Fonctionnalités Synq

#### 1. Interface Utilisateur Simplifiée
```javascript
// Activer dans les paramètres admin
Synq_UX_Simplified_Enabled: true
Synq_UX_Onboarding_Enabled: true
Synq_UX_Guided_Tours_Enabled: true
```

#### 2. Branding Personnalisé
```javascript
// Configurer le branding
Synq_Workspace_Name: "Mon Entreprise"
Synq_Primary_Color: "#1d74f5"
Synq_Logo: "https://example.com/logo.png"
Synq_Custom_CSS: "/* CSS personnalisé */"
```

#### 3. Intégration Keycloak
```javascript
// Configuration SSO
Synq_Keycloak_Enabled: true
Synq_Keycloak_Server_URL: "https://sso.example.com"
Synq_Keycloak_Realm: "synq"
Synq_Keycloak_Client_ID: "synq-web"
```

#### 4. Jitsi Amélioré
```javascript
// Configuration des salles vocales
Synq_Jitsi_Enhanced_Enabled: true
Synq_Jitsi_Voice_Rooms: true
Synq_Jitsi_Persistent_Rooms: true
```

#### 5. Documents Collaboratifs
```javascript
// Configuration Etherpad
Synq_Docs_Enabled: true
Synq_Docs_Editor_Type: "etherpad"
Synq_Docs_Server_URL: "http://localhost:9001"
```

## 📚 Documentation

### Composants Principaux

#### SynqOnboarding
Composant d'onboarding avec étapes guidées pour les nouveaux utilisateurs.

#### SynqBrandingProvider
Provider pour appliquer le branding personnalisé à l'ensemble de l'application.

#### SynqAnalyticsDashboard
Tableau de bord complet pour les analytics et métriques d'usage.

#### SynqVoiceRooms
Gestion des salles vocales persistantes avec interface Discord-like.

#### SynqCollaborativeDocs
Interface pour les documents collaboratifs avec Etherpad.

#### SynqWorkflows
Système de workflows et automatisation avec commandes slash.

### Hooks Personnalisés

#### useSynqBranding
Hook pour accéder aux paramètres de branding et les appliquer dynamiquement.

#### useSynqSidebarCategories
Hook pour gérer les catégories de la sidebar personnalisée.

## 🔧 Développement

### Structure du Projet
```
apps/meteor/
├── client/
│   ├── components/          # Composants Synq
│   ├── hooks/              # Hooks personnalisés
│   ├── providers/          # Providers React
│   └── views/admin/        # Pages d'administration
├── server/
│   ├── settings/          # Configuration des paramètres
│   └── services/          # Services Synq
└── public/images/         # Assets Synq
```

### Ajout de Nouvelles Fonctionnalités

1. **Créer les paramètres** dans `server/settings/`
2. **Développer les composants** dans `client/components/`
3. **Ajouter les traductions** dans `packages/i18n/src/locales/fr.i18n.json`
4. **Créer les pages admin** dans `client/views/admin/`

### Tests
```bash
# Tests unitaires
yarn testunit

# Tests avec Storybook
yarn test-storybook
```

## 🌐 Déploiement

### Docker
```bash
# Build de l'image
docker build -t synq-chat .

# Déploiement avec docker-compose
docker-compose up -d
```

### Variables d'Environnement
```bash
# Configuration de base
MONGO_URL=mongodb://localhost:27017/synq
ROOT_URL=http://localhost:3000

# Configuration Synq
SYNQ_BRANDING_ENABLED=true
SYNQ_ANALYTICS_ENABLED=true
SYNQ_KEYCLOAK_ENABLED=false
```

## 🤝 Contribution

1. Fork le projet
2. Créer une branche feature (`git checkout -b feature/nouvelle-fonctionnalite`)
3. Commit les changements (`git commit -am 'Ajouter nouvelle fonctionnalité'`)
4. Push vers la branche (`git push origin feature/nouvelle-fonctionnalite`)
5. Créer une Pull Request

## 📄 Licence

Ce projet est sous licence MIT. Voir le fichier [LICENSE](LICENSE) pour plus de détails.

## 🆘 Support

- **Documentation** : [docs.synq.team](https://docs.synq.team)
- **Issues** : [GitHub Issues](https://github.com/yourorg/synq-chat/issues)
- **Discussions** : [GitHub Discussions](https://github.com/yourorg/synq-chat/discussions)
- **Email** : support@synq.team

## 🎯 Roadmap

### Version 1.1
- [ ] Intégration LDAP/SAML
- [ ] Mobile app Synq
- [ ] API GraphQL
- [ ] Plugins marketplace

### Version 1.2
- [ ] IA intégrée pour l'assistance
- [ ] Chiffrement bout-en-bout
- [ ] Fédération entre instances
- [ ] Analytics avancés

---

**Synq Chat** - Votre plateforme de communication souveraine, sans arnaque, sans compromis.
