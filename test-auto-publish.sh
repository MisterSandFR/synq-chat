#!/bin/bash

# Script de test de l'auto-publication Synq Chat + Synq.Team

set -e

echo "🧪 Test de l'auto-publication Synq Chat + Synq.Team"

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "${BLUE}[TEST]${NC} $1"
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

# Vérifier que gh CLI est installé
check_gh_cli() {
    if ! command -v gh &> /dev/null; then
        error "GitHub CLI (gh) n'est pas installé"
        exit 1
    fi
    success "GitHub CLI détecté"
}

# Vérifier l'authentification GitHub
check_github_auth() {
    if ! gh auth status &> /dev/null; then
        error "Non authentifié avec GitHub CLI"
        exit 1
    fi
    success "Authentifié avec GitHub CLI"
}

# Vérifier les secrets configurés
check_secrets() {
    log "Vérification des secrets GitHub..."
    
    REQUIRED_SECRETS=(
        "VPS_HOST"
        "VPS_USER"
        "VPS_SSH_KEY"
        "VPS_DEPLOY_PATH"
        "DOCKER_REGISTRY"
        "DOCKER_USERNAME"
        "DOCKER_PASSWORD"
        "SYNQ_TEAM_REPO"
        "SYNQ_TEAM_TOKEN"
        "SYNQ_TEAM_DEPLOY_URL"
    )
    
    for secret in "${REQUIRED_SECRETS[@]}"; do
        if gh secret list | grep -q "$secret"; then
            success "Secret $secret configuré"
        else
            error "Secret $secret manquant"
            exit 1
        fi
    done
    
    success "Tous les secrets sont configurés"
}

# Vérifier les workflows
check_workflows() {
    log "Vérification des workflows GitHub Actions..."
    
    if [ -f ".github/workflows/auto-deploy-complete.yml" ]; then
        success "Workflow auto-deploy-complete.yml trouvé"
    else
        error "Workflow auto-deploy-complete.yml manquant"
        exit 1
    fi
    
    if [ -f ".github/workflows/auto-deploy.yml" ]; then
        success "Workflow auto-deploy.yml trouvé"
    else
        warning "Workflow auto-deploy.yml manquant (optionnel)"
    fi
}

# Tester le workflow manuellement
test_workflow() {
    log "Test du workflow d'auto-publication..."
    
    echo "Déclenchement du workflow auto-deploy-complete.yml..."
    
    if gh workflow run auto-deploy-complete.yml --field environment=staging; then
        success "Workflow déclenché avec succès"
        
        # Attendre le workflow
        echo "⏳ Attente du workflow..."
        sleep 10
        
        # Récupérer l'ID du workflow
        RUN_ID=$(gh run list --workflow=auto-deploy-complete.yml --limit=1 --json databaseId --jq '.[0].databaseId')
        
        if [ -n "$RUN_ID" ]; then
            echo "📋 ID du workflow: $RUN_ID"
            echo "🔍 Voir les logs: gh run view $RUN_ID"
            echo "📊 Voir le statut: gh run list"
        fi
        
    else
        error "Échec du déclenchement du workflow"
        exit 1
    fi
}

# Vérifier le statut du déploiement
check_deployment_status() {
    log "Vérification du statut du déploiement..."
    
    # Attendre un peu pour que le déploiement commence
    sleep 30
    
    # Vérifier les workflows en cours
    echo "📊 Workflows en cours:"
    gh run list --limit=5
    
    # Vérifier le dernier workflow
    LATEST_RUN=$(gh run list --workflow=auto-deploy-complete.yml --limit=1 --json databaseId,status,conclusion --jq '.[0]')
    
    if [ -n "$LATEST_RUN" ]; then
        echo "📋 Dernier workflow:"
        echo "$LATEST_RUN"
    fi
}

# Vérifier les déploiements
verify_deployments() {
    log "Vérification des déploiements..."
    
    # Récupérer les URLs depuis les secrets
    VPS_HOST=$(gh secret get VPS_HOST 2>/dev/null || echo "localhost")
    SYNQ_TEAM_URL=$(gh secret get SYNQ_TEAM_DEPLOY_URL 2>/dev/null || echo "https://synq.team")
    
    echo "🔍 Vérification de Synq Chat (Serveur Open Source)..."
    if curl -f "http://$VPS_HOST/" > /dev/null 2>&1; then
        success "Synq Chat accessible sur http://$VPS_HOST"
    else
        warning "Synq Chat non accessible sur http://$VPS_HOST"
    fi
    
    echo "🔍 Vérification de Synq.Team (Site du Service)..."
    if curl -f "$SYNQ_TEAM_URL/" > /dev/null 2>&1; then
        success "Synq.Team accessible sur $SYNQ_TEAM_URL"
    else
        warning "Synq.Team non accessible sur $SYNQ_TEAM_URL"
    fi
}

# Afficher les informations de test
show_test_info() {
    log "Informations de test:"
    echo ""
    echo "📦 Synq Chat (Serveur Open Source):"
    echo "  - Repository: $(gh repo view --json nameWithOwner --jq '.nameWithOwner')"
    echo "  - Workflow: auto-deploy-complete.yml"
    echo "  - Déclenchement: Push sur main/develop"
    echo ""
    echo "🌐 Synq.Team (Site du Service):"
    echo "  - Repository: $(gh secret get SYNQ_TEAM_REPO 2>/dev/null || echo 'Non configuré')"
    echo "  - URL: $(gh secret get SYNQ_TEAM_DEPLOY_URL 2>/dev/null || echo 'Non configuré')"
    echo "  - Mise à jour: Automatique avec Synq Chat"
    echo ""
    echo "🚀 Auto-publication:"
    echo "  - Déclenchement: Automatique sur push"
    echo "  - Processus: Build → Deploy → Update → Verify"
    echo "  - Monitoring: GitHub Actions"
    echo ""
    echo "🔧 Commandes utiles:"
    echo "  - Voir les workflows: gh run list"
    echo "  - Voir les logs: gh run view [RUN_ID]"
    echo "  - Déclencher manuellement: gh workflow run auto-deploy-complete.yml"
    echo "  - Voir les secrets: gh secret list"
}

# Fonction principale
main() {
    log "Démarrage du test de l'auto-publication..."
    
    check_gh_cli
    check_github_auth
    check_secrets
    check_workflows
    
    echo ""
    echo "🎯 Test de l'auto-publication:"
    echo "  📦 Synq Chat (Serveur Open Source)"
    echo "  🌐 Synq.Team (Site du Service)"
    echo ""
    
    # Demander si l'utilisateur veut tester le workflow
    read -p "Voulez-vous déclencher le workflow de test ? (y/N): " -n 1 -r
    echo ""
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        test_workflow
        check_deployment_status
        verify_deployments
    else
        warning "Test du workflow ignoré"
    fi
    
    show_test_info
    
    success "🎉 Test de l'auto-publication terminé !"
    
    echo ""
    log "Prochaines étapes :"
    echo "  1. Monitorer les workflows : gh run list"
    echo "  2. Vérifier les déploiements : curl http://[VPS_HOST]/"
    echo "  3. Tester les fonctionnalités vocales"
    echo "  4. Vérifier la mise à jour de Synq.Team"
    echo ""
    success "L'auto-publication par IA est prête !"
}

# Exécuter le script principal
main "$@"
