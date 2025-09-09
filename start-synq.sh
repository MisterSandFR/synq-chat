#!/bin/bash

# Script de démarrage rapide pour Synq Chat
# Usage: ./start-synq.sh [dev|prod]

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

# Configuration par défaut
MODE=${1:-dev}
PORT=${2:-3000}

log "Démarrage de Synq Chat en mode $MODE sur le port $PORT"

# Vérifier les prérequis
check_prerequisites() {
    log "Vérification des prérequis..."
    
    # Vérifier Node.js
    if ! command -v node &> /dev/null; then
        error "Node.js n'est pas installé"
        exit 1
    fi
    
    # Vérifier Yarn
    if ! command -v yarn &> /dev/null; then
        error "Yarn n'est pas installé"
        exit 1
    fi
    
    # Vérifier MongoDB
    if ! command -v mongod &> /dev/null; then
        warning "MongoDB n'est pas installé ou pas dans le PATH"
        warning "Assurez-vous qu'une instance MongoDB est accessible"
    fi
    
    success "Prérequis vérifiés"
}

# Installer les dépendances
install_dependencies() {
    log "Installation des dépendances..."
    
    if [ ! -d "node_modules" ]; then
        yarn install
        success "Dépendances installées"
    else
        log "Dépendances déjà installées"
    fi
}

# Configuration de l'environnement
setup_environment() {
    log "Configuration de l'environnement..."
    
    # Créer le fichier .env s'il n'existe pas
    if [ ! -f ".env" ]; then
        log "Création du fichier .env..."
        cp .env.synq.example .env
        success "Fichier .env créé"
    fi
    
    # Variables d'environnement pour Synq
    export MONGO_URL=${MONGO_URL:-"mongodb://localhost:27017/synq"}
    export ROOT_URL=${ROOT_URL:-"http://localhost:$PORT"}
    export PORT=$PORT
    
    # Configuration Synq par défaut
    export SYNQ_UX_SIMPLIFIED_ENABLED=true
    export SYNQ_UX_ONBOARDING_ENABLED=true
    export SYNQ_UX_GUIDED_TOURS_ENABLED=true
    export SYNQ_WORKSPACE_NAME="Synq"
    export SYNQ_PRIMARY_COLOR="#1d74f5"
    export SYNQ_SECONDARY_COLOR="#f5455c"
    export SYNQ_ACCENT_COLOR="#ffd21f"
    
    success "Environnement configuré"
}

# Démarrer MongoDB si nécessaire
start_mongodb() {
    if command -v mongod &> /dev/null; then
        if ! pgrep -x "mongod" > /dev/null; then
            log "Démarrage de MongoDB..."
            mongod --fork --logpath /tmp/mongodb.log --dbpath ./data/db 2>/dev/null || {
                warning "Impossible de démarrer MongoDB automatiquement"
                warning "Assurez-vous qu'une instance MongoDB est en cours d'exécution"
            }
        else
            log "MongoDB est déjà en cours d'exécution"
        fi
    fi
}

# Construire le projet
build_project() {
    if [ "$MODE" = "prod" ]; then
        log "Construction du projet pour la production..."
        yarn build
        success "Projet construit"
    else
        log "Mode développement - pas de construction nécessaire"
    fi
}

# Démarrer l'application
start_application() {
    log "Démarrage de l'application Synq Chat..."
    
    if [ "$MODE" = "prod" ]; then
        yarn start
    else
        yarn dev
    fi
}

# Fonction principale
main() {
    echo ""
    echo "🚀 Synq Chat - Plateforme de Communication Souveraine"
    echo "=================================================="
    echo ""
    
    check_prerequisites
    install_dependencies
    setup_environment
    start_mongodb
    build_project
    
    echo ""
    success "Synq Chat est prêt à démarrer!"
    log "URL: http://localhost:$PORT"
    log "Mode: $MODE"
    echo ""
    
    start_application
}

# Gestion des signaux
trap 'echo -e "\n${YELLOW}[INFO]${NC} Arrêt de Synq Chat..."; exit 0' INT TERM

# Exécuter le script principal
main
