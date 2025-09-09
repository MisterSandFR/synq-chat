# Synq Chat

<div align="center">
  <img src="apps/meteor/public/images/synq/logo.svg" alt="Synq Chat Logo" width="200" height="200">
  
  **Votre plateforme de communication souveraine et sécurisée**
  
  [![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
  [![Node.js](https://img.shields.io/badge/node.js-22.16.0+-green.svg)](https://nodejs.org/)
  [![MongoDB](https://img.shields.io/badge/mongodb-6.0+-green.svg)](https://mongodb.com/)
  [![Docker](https://img.shields.io/badge/docker-ready-blue.svg)](https://docker.com/)
</div>

## 🚀 Vue d'ensemble

**Synq Chat** est un fork avancé de Rocket.Chat, enrichi de fonctionnalités spécifiques pour créer une solution de communication souveraine et sécurisée. Basé sur le commit Rocket.Chat `46e37bfe85`, Synq Chat apporte des améliorations significatives en termes d'expérience utilisateur, d'intégrations et de sécurité.

### 🎯 Objectifs de Synq Chat

- **Souveraineté numérique** : Solution hébergée en interne
- **Sécurité renforcée** : Authentification SSO et permissions granulaires
- **Expérience utilisateur optimisée** : Interface simplifiée et onboarding guidé
- **Intégrations avancées** : Jitsi, Etherpad, Analytics, Workflows
- **Communication collaborative** : Documents partagés et salles vocales persistantes

## 📋 Fonctionnalités Synq Ajoutées

### 🔐 Authentification et Sécurité

#### **Intégration Keycloak**
- **Authentification SSO** complète avec Keycloak
- **Provisionnement automatique** des utilisateurs
- **Synchronisation des rôles** et groupes
- **Mapping personnalisé** des rôles Synq ↔ Keycloak
- **Logs de débogage** avancés

**Fichiers ajoutés :**
- `apps/meteor/server/services/SynqKeycloakService.ts`
- `apps/meteor/server/services/SynqKeycloakIntegration.ts`
- `apps/meteor/server/settings/synq-keycloak.ts`
- `apps/meteor/client/components/SynqKeycloakLoginButton.tsx`

### 🎥 Communication Vocale et Vidéo

#### **Jitsi Meet Intégré**
- **Salles vocales persistantes** par canal
- **Modération avancée** des salles
- **Partage d'écran amélioré**
- **Enregistrement des appels** (optionnel)
- **Chat intégré** dans les salles
- **Notifications de présence**
- **Chiffrement des communications**
- **Logs des appels** détaillés

**Fichiers ajoutés :**
- `apps/meteor/server/services/SynqJitsiService.ts`
- `apps/meteor/server/settings/synq-jitsi.ts`
- `apps/meteor/client/components/SynqVoiceRooms.tsx`

### 📝 Documents Collaboratifs

#### **Intégration Etherpad**
- **Édition collaborative** en temps réel
- **Modèles de documents** prédéfinis (réunions, notes, brainstorming)
- **Système de versioning** complet
- **Permissions par défaut** configurables
- **Sauvegarde automatique**
- **Intégration avec les canaux**
- **Notifications de changements**
- **Export** en multiples formats

**Fichiers ajoutés :**
- `apps/meteor/server/services/SynqEtherpadService.ts`
- `apps/meteor/server/settings/synq-docs.ts`
- `apps/meteor/client/components/SynqCollaborativeDocs.tsx`

### 📊 Analytics et Tableaux de Bord

#### **Système d'Analytics Avancé**
- **Collecte de données** en temps réel
- **Métriques d'activité** : messages/jour, utilisateurs actifs, canaux populaires
- **Analyse comportementale** : heures de pointe, types de messages
- **Tableaux de bord** administrateur et utilisateur
- **Rapports automatiques** périodiques
- **Export** et intégration externe
- **API complète** pour les métriques

**Fichiers ajoutés :**
- `apps/meteor/server/services/SynqAnalyticsService.ts`
- `apps/meteor/server/settings/synq-analytics.ts`
- `apps/meteor/client/components/SynqAnalyticsDashboard.tsx`

### ⚡ Workflows et Automatisation

#### **Système de Workflows**
- **Workflows personnalisés** avec déclencheurs
- **Actions multiples** en séquence
- **Gestion des erreurs** et retry automatique
- **Intégrations externes** (webhooks, APIs)
- **Monitoring** des workflows
- **Templates** prédéfinis

**Fichiers ajoutés :**
- `apps/meteor/server/services/SynqWorkflowService.ts`
- `apps/meteor/server/settings/synq-workflows.ts`
- `apps/meteor/client/components/SynqWorkflows.tsx`

### 🔔 Notifications Avancées

#### **Système de Notifications**
- **Multi-canaux** : email, push, in-app, SMS
- **Heures silencieuses** configurables
- **Webhooks personnalisés**
- **Templates** de notifications
- **Gestion des préférences** utilisateur
- **Notifications en temps réel**

**Fichiers ajoutés :**
- `apps/meteor/server/services/SynqNotificationService.ts`
- `apps/meteor/server/settings/synq-notifications.ts`

### 🛡️ Permissions Granulaires

#### **Système de Permissions Avancé**
- **Rôles personnalisés** avec permissions spécifiques
- **Permissions par canal** individuelles
- **Audit complet** des actions
- **Notifications de sécurité**
- **Intégration base de données**
- **Templates de rôles**

**Fichiers ajoutés :**
- `apps/meteor/server/services/SynqPermissionService.ts`
- `apps/meteor/server/settings/synq-permissions.ts`
- `apps/meteor/client/components/SynqChannelPermissions.tsx`
- `apps/meteor/client/components/SynqRoleTemplates.tsx`

### 🎨 Interface Utilisateur et Expérience

#### **Composants UI Synq**
- **Logo Synq** personnalisé et réutilisable
- **Header** et **Sidebar** adaptés
- **Layout** principal optimisé
- **Formulaires de connexion** personnalisés
- **Onboarding** guidé pour nouveaux utilisateurs
- **Branding** complet et cohérent

**Fichiers ajoutés :**
- `apps/meteor/client/components/SynqLogo.tsx`
- `apps/meteor/client/components/SynqHeader.tsx`
- `apps/meteor/client/components/SynqSidebar.tsx`
- `apps/meteor/client/components/SynqLayout.tsx`
- `apps/meteor/client/components/SynqLoginForm.tsx`
- `apps/meteor/client/components/SynqOnboarding.tsx`
- `apps/meteor/client/providers/SynqBrandingProvider.tsx`
- `apps/meteor/client/hooks/useSynqBranding.ts`

#### **Paramètres UI/UX**
- **Interface simplifiée** pour débutants
- **Tours guidés** interactifs
- **Mode débutant** activable
- **Accessibilité** améliorée
- **Personnalisation** de l'interface

**Fichiers ajoutés :**
- `apps/meteor/server/settings/synq-ux.ts`
- `apps/meteor/server/settings/synq-branding.ts`
- `apps/meteor/server/settings/synq-sidebar.ts`

### 🌐 Internationalisation

#### **Traductions Françaises**
- **Traductions complètes** pour toutes les fonctionnalités Synq
- **Fichier dédié** `synq-fr.i18n.json`
- **Terminologie** adaptée au contexte français
- **Messages d'aide** et descriptions détaillées

**Fichiers ajoutés :**
- `packages/i18n/src/locales/synq-fr.i18n.json`

## 🏗️ Architecture Technique

### Structure des Services Ajoutés

```
apps/meteor/server/services/
├── SynqAnalyticsService.ts      # Analytics et métriques
├── SynqEtherpadService.ts       # Documents collaboratifs
├── SynqJitsiService.ts          # Salles vocales
├── SynqKeycloakService.ts       # Authentification SSO
├── SynqKeycloakIntegration.ts   # Intégration Keycloak
├── SynqNotificationService.ts   # Notifications
├── SynqPermissionService.ts     # Permissions granulaires
└── SynqWorkflowService.ts       # Workflows et automatisation
```

### Configuration des Paramètres Ajoutés

```
apps/meteor/server/settings/
├── synq-analytics.ts           # Configuration analytics
├── synq-branding.ts            # Branding et personnalisation
├── synq-docs.ts               # Documents collaboratifs
├── synq-jitsi.ts              # Configuration Jitsi
├── synq-keycloak.ts           # Configuration Keycloak
├── synq-permissions.ts        # Permissions granulaires
├── synq-ux.ts                 # Interface utilisateur
└── synq-workflows.ts          # Workflows
```

### Composants Frontend Ajoutés

```
apps/meteor/client/components/
├── SynqAnalyticsDashboard.tsx  # Tableau de bord analytics
├── SynqCollaborativeDocs.tsx   # Documents collaboratifs
├── SynqHeader.tsx             # Header personnalisé
├── SynqLayout.tsx             # Layout principal
├── SynqLogo.tsx               # Logo Synq
├── SynqLoginForm.tsx          # Formulaire de connexion
├── SynqOnboarding.tsx         # Onboarding utilisateur
├── SynqSidebar.tsx            # Sidebar personnalisée
├── SynqVoiceRooms.tsx         # Salles vocales
└── SynqWorkflows.tsx          # Interface workflows
```

## 🚀 Installation et Déploiement

### Prérequis

- **Node.js** : Version 22.16.0+
- **MongoDB** : Version 6.0+
- **Redis** : Version 6.0+
- **Nginx** : Version 1.18+ (pour la production)

### Installation Rapide

```bash
# Cloner le repository
git clone https://github.com/MisterSandFR/synq-chat.git
cd synq-chat

# Installer les dépendances
npm install

# Configurer l'environnement
cp .env.example .env.production
nano .env.production

# Construire l'application
npm run build

# Démarrer en développement
npm run dev
```

### Déploiement en Production

#### Option 1 : Déploiement Traditionnel

```bash
# Utiliser le script de déploiement
./deploy-production.sh deploy

# Vérifier le statut
./deploy-production.sh monitor

# Tester la production
./test-production.sh
```

#### Option 2 : Déploiement Docker

```bash
# Déployer avec Docker
./deploy-docker.sh deploy

# Vérifier le statut
./deploy-docker.sh monitor

# Voir les logs
./deploy-docker.sh logs
```

## 📚 Documentation

### Guides Disponibles

- **[PRODUCTION-DEPLOYMENT.md](PRODUCTION-DEPLOYMENT.md)** - Guide de déploiement complet
- **[DOCKER-PRODUCTION.md](DOCKER-PRODUCTION.md)** - Configuration Docker
- **[DEPLOYMENT-GUIDE.md](DEPLOYMENT-GUIDE.md)** - Guide final de déploiement
- **[SYNQ-FEATURES.md](SYNQ-FEATURES.md)** - Détail des fonctionnalités Synq
- **[FEATURES.md](FEATURES.md)** - Fonctionnalités Rocket.Chat de base

### Scripts Utiles Ajoutés

- `deploy-production.sh` - Déploiement traditionnel
- `deploy-docker.sh` - Déploiement Docker
- `test-production.sh` - Tests de production
- `start-synq.sh` - Démarrage rapide
- `build-synq.sh` - Construction de l'application

## 🧪 Tests

### Tests d'Intégration Ajoutés

```bash
# Exécuter les tests d'intégration Synq
npm run test:integration

# Tests spécifiques aux composants Synq
npm run test:synq-components
```

### Tests de Production

```bash
# Tests complets de production
./test-production.sh
```

## 🔧 Configuration

### Variables d'Environnement Principales

```bash
# Configuration de base
NODE_ENV=production
MONGO_URL=mongodb://localhost:27017/synq_chat
REDIS_URL=redis://localhost:6379
ROOT_URL=https://your-domain.com

# Configuration Synq - Keycloak
SYNQ_KEYCLOAK_ENABLED=true
SYNQ_KEYCLOAK_SERVER_URL=https://your-keycloak-server.com
SYNQ_KEYCLOAK_REALM=synq
SYNQ_KEYCLOAK_CLIENT_ID=synq-chat

# Configuration Synq - Jitsi
SYNQ_JITSI_ENHANCED_ENABLED=true
SYNQ_JITSI_SERVER_URL=https://meet.jit.si
SYNQ_JITSI_PERSISTENT_ROOMS=true

# Configuration Synq - Etherpad
SYNQ_DOCS_ENABLED=true
SYNQ_DOCS_SERVER_URL=http://localhost:9001
SYNQ_DOCS_EDITOR_TYPE=etherpad

# Configuration Synq - Analytics
SYNQ_ANALYTICS_ENABLED=true
SYNQ_ANALYTICS_DATA_COLLECTION=true
```

## 🤝 Contribution

### Structure du Projet

Synq Chat suit la structure monorepo de Rocket.Chat :

```
synq-chat/
├── apps/
│   └── meteor/                 # Application principale
│       ├── client/            # Composants frontend
│       ├── server/            # Services backend
│       └── tests/             # Tests
├── packages/                   # Packages partagés
├── scripts/                   # Scripts de build
└── docs/                      # Documentation
```

### Guidelines de Contribution

1. **Fork** le repository
2. **Créer** une branche feature (`git checkout -b feature/nouvelle-fonctionnalite`)
3. **Commit** vos changements (`git commit -am 'Ajout nouvelle fonctionnalité'`)
4. **Push** vers la branche (`git push origin feature/nouvelle-fonctionnalite`)
5. **Créer** une Pull Request

## 📄 Licence

Ce projet est sous licence MIT. Voir le fichier [LICENSE](LICENSE) pour plus de détails.

## 🙏 Remerciements

### Rocket.Chat Original

Synq Chat est basé sur **Rocket.Chat**, une excellente plateforme de communication open source.

- **Commit de base** : `46e37bfe85` - "chore(fuselage): Remove references to deprecated `Grid.Item` component (#36879)"
- **Repository original** : [RocketChat/Rocket.Chat](https://github.com/RocketChat/Rocket.Chat)
- **Équipe Rocket.Chat** : Diego Sampaio, Marcelo Schmidt, Rafael Caferati, Rodrigo Nascimento et toute l'équipe

### Contributions Synq

- **Développement** : Équipe Synq
- **Architecture** : Services backend et composants frontend
- **Intégrations** : Keycloak, Jitsi, Etherpad, Analytics
- **UI/UX** : Interface utilisateur optimisée et branding

## 📞 Support

### Documentation
- Consultez les guides de déploiement
- Vérifiez la documentation des fonctionnalités
- Utilisez les scripts de test et monitoring

### Issues
- Créez une issue sur GitHub pour signaler un bug
- Utilisez les templates d'issue appropriés
- Fournissez des logs et informations de reproduction

---

<div align="center">
  <strong>Synq Chat</strong> - Votre solution de communication souveraine et sécurisée 🚀
  
  <br><br>
  
  <em>Basé sur Rocket.Chat avec des fonctionnalités Synq avancées</em>
</div>
