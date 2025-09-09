#!/bin/bash

# Script de build et déploiement pour Synq Chat
# Usage: ./build-synq.sh [dev|prod|docker]

set -e

# Couleurs pour les logs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Fonction de logging
log() {
    echo -e "${BLUE}[SYNQ]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Vérifier les prérequis
check_prerequisites() {
    log "Vérification des prérequis..."
    
    # Vérifier Node.js
    if ! command -v node &> /dev/null; then
        error "Node.js n'est pas installé"
        exit 1
    fi
    
    NODE_VERSION=$(node --version | cut -d'v' -f2)
    REQUIRED_VERSION="22.16.0"
    if [ "$(printf '%s\n' "$REQUIRED_VERSION" "$NODE_VERSION" | sort -V | head -n1)" != "$REQUIRED_VERSION" ]; then
        error "Node.js version $REQUIRED_VERSION ou supérieure requise (actuelle: $NODE_VERSION)"
        exit 1
    fi
    
    # Vérifier Yarn
    if ! command -v yarn &> /dev/null; then
        error "Yarn n'est pas installé"
        exit 1
    fi
    
    YARN_VERSION=$(yarn --version)
    REQUIRED_YARN_VERSION="4.9.3"
    if [ "$(printf '%s\n' "$REQUIRED_YARN_VERSION" "$YARN_VERSION" | sort -V | head -n1)" != "$REQUIRED_YARN_VERSION" ]; then
        error "Yarn version $REQUIRED_YARN_VERSION ou supérieure requise (actuelle: $YARN_VERSION)"
        exit 1
    fi
    
    success "Prérequis vérifiés"
}

# Installation des dépendances
install_dependencies() {
    log "Installation des dépendances..."
    yarn install --frozen-lockfile
    success "Dépendances installées"
}

# Build en mode développement
build_dev() {
    log "Build en mode développement..."
    yarn build:services
    success "Build développement terminé"
}

# Build en mode production
build_prod() {
    log "Build en mode production..."
    yarn build:ci
    success "Build production terminé"
}

# Build Docker
build_docker() {
    log "Build de l'image Docker..."
    
    # Vérifier Docker
    if ! command -v docker &> /dev/null; then
        error "Docker n'est pas installé"
        exit 1
    fi
    
    # Créer le Dockerfile si nécessaire
    if [ ! -f "Dockerfile" ]; then
        log "Création du Dockerfile..."
        cat > Dockerfile << 'EOF'
FROM node:22.16.0-alpine

# Installer les dépendances système
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    musl-dev \
    giflib-dev \
    pixman-dev \
    pangomm-dev \
    libjpeg-turbo-dev \
    freetype-dev

# Définir le répertoire de travail
WORKDIR /app

# Copier les fichiers de configuration
COPY package.json yarn.lock ./
COPY .yarnrc.yml ./

# Installer les dépendances
RUN yarn install --frozen-lockfile

# Copier le code source
COPY . .

# Build de l'application
RUN yarn build:ci

# Exposer le port
EXPOSE 3000

# Variables d'environnement par défaut
ENV NODE_ENV=production
ENV PORT=3000

# Commande de démarrage
CMD ["yarn", "start"]
EOF
        success "Dockerfile créé"
    fi
    
    # Build de l'image
    docker build -t synq-chat:latest .
    success "Image Docker construite: synq-chat:latest"
}

# Tests
run_tests() {
    log "Exécution des tests..."
    yarn testunit
    success "Tests terminés"
}

# Linting
run_lint() {
    log "Exécution du linting..."
    yarn lint
    success "Linting terminé"
}

# Vérification de la configuration Synq
check_synq_config() {
    log "Vérification de la configuration Synq..."
    
    # Vérifier les fichiers de configuration Synq
    SYNQ_FILES=(
        "apps/meteor/server/settings/synq-ux.ts"
        "apps/meteor/server/settings/synq-branding.ts"
        "apps/meteor/server/settings/synq-permissions.ts"
        "apps/meteor/server/settings/synq-keycloak.ts"
        "apps/meteor/server/settings/synq-jitsi.ts"
        "apps/meteor/server/settings/synq-docs.ts"
        "apps/meteor/server/settings/synq-analytics.ts"
    )
    
    for file in "${SYNQ_FILES[@]}"; do
        if [ ! -f "$file" ]; then
            error "Fichier de configuration manquant: $file"
            exit 1
        fi
    done
    
    # Vérifier les composants Synq
    SYNQ_COMPONENTS=(
        "apps/meteor/client/components/SynqOnboarding.tsx"
        "apps/meteor/client/components/SynqAnalyticsDashboard.tsx"
        "apps/meteor/client/components/SynqVoiceRooms.tsx"
        "apps/meteor/client/components/SynqCollaborativeDocs.tsx"
        "apps/meteor/client/components/SynqWorkflows.tsx"
    )
    
    for component in "${SYNQ_COMPONENTS[@]}"; do
        if [ ! -f "$component" ]; then
            error "Composant Synq manquant: $component"
            exit 1
        fi
    done
    
    success "Configuration Synq vérifiée"
}

# Génération de la documentation
generate_docs() {
    log "Génération de la documentation..."
    
    # Créer le répertoire docs s'il n'existe pas
    mkdir -p docs
    
    # Générer la documentation des composants
    cat > docs/COMPONENTS.md << 'EOF'
# Composants Synq

## SynqOnboarding
Composant d'onboarding avec étapes guidées pour les nouveaux utilisateurs.

### Props
- `steps`: Array des étapes d'onboarding
- `onStepComplete`: Callback appelé quand une étape est terminée
- `onOnboardingComplete`: Callback appelé quand l'onboarding est terminé
- `onSkip`: Callback appelé quand l'utilisateur passe l'onboarding
- `currentStep`: Index de l'étape actuelle

## SynqAnalyticsDashboard
Tableau de bord complet pour les analytics et métriques d'usage.

### Props
- `data`: Données d'analytics
- `onRefresh`: Callback pour actualiser les données
- `onExport`: Callback pour exporter les données
- `onGenerateReport`: Callback pour générer un rapport
- `timeRange`: Période de temps sélectionnée
- `onTimeRangeChange`: Callback pour changer la période

## SynqVoiceRooms
Gestion des salles vocales persistantes avec interface Discord-like.

### Props
- `rooms`: Array des salles vocales
- `onJoinRoom`: Callback pour rejoindre une salle
- `onLeaveRoom`: Callback pour quitter une salle
- `onCreateRoom`: Callback pour créer une salle
- `onDeleteRoom`: Callback pour supprimer une salle
- `currentRoom`: ID de la salle actuelle

## SynqCollaborativeDocs
Interface pour les documents collaboratifs avec Etherpad.

### Props
- `docs`: Array des documents
- `onCreateDoc`: Callback pour créer un document
- `onEditDoc`: Callback pour éditer un document
- `onDeleteDoc`: Callback pour supprimer un document
- `onShareDoc`: Callback pour partager un document
- `onExportDoc`: Callback pour exporter un document

## SynqWorkflows
Système de workflows et automatisation avec commandes slash.

### Props
- `workflows`: Array des workflows
- `slashCommands`: Array des commandes slash
- `synqApps`: Array des apps Synq
- `onCreateWorkflow`: Callback pour créer un workflow
- `onUpdateWorkflow`: Callback pour mettre à jour un workflow
- `onDeleteWorkflow`: Callback pour supprimer un workflow
- `onCreateSlashCommand`: Callback pour créer une commande slash
- `onUpdateSlashCommand`: Callback pour mettre à jour une commande slash
- `onDeleteSlashCommand`: Callback pour supprimer une commande slash
- `onInstallApp`: Callback pour installer une app
- `onUninstallApp`: Callback pour désinstaller une app
EOF
    
    success "Documentation générée"
}

# Fonction principale
main() {
    log "Démarrage du build Synq Chat..."
    
    # Vérifier les prérequis
    check_prerequisites
    
    # Installer les dépendances
    install_dependencies
    
    # Vérifier la configuration Synq
    check_synq_config
    
    # Exécuter le linting
    run_lint
    
    # Générer la documentation
    generate_docs
    
    # Traitement selon l'argument
    case "${1:-dev}" in
        "dev")
            build_dev
            ;;
        "prod")
            build_prod
            ;;
        "docker")
            build_docker
            ;;
        "test")
            run_tests
            ;;
        *)
            error "Mode non reconnu: $1"
            echo "Usage: $0 [dev|prod|docker|test]"
            exit 1
            ;;
    esac
    
    success "Build Synq Chat terminé avec succès!"
    
    # Afficher les informations de déploiement
    if [ "$1" = "prod" ]; then
        echo ""
        log "Informations de déploiement:"
        echo "  - Application buildée dans: apps/meteor/build/"
        echo "  - Variables d'environnement requises:"
        echo "    * MONGO_URL"
        echo "    * ROOT_URL"
        echo "    * Synq_* settings"
        echo ""
        warning "N'oubliez pas de configurer vos variables d'environnement!"
    fi
    
    if [ "$1" = "docker" ]; then
        echo ""
        log "Informations Docker:"
        echo "  - Image: synq-chat:latest"
        echo "  - Port: 3000"
        echo "  - Pour démarrer: docker run -p 3000:3000 synq-chat:latest"
        echo ""
        warning "N'oubliez pas de configurer vos variables d'environnement!"
    fi
}

# Exécuter le script principal
main "$@"
