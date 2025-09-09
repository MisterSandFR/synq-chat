#!/bin/bash

# Script de configuration des secrets GitHub pour l'auto-publication
# Synq Chat (Serveur Open Source) + Synq.Team (Site du Service)

set -e

echo "🔧 Configuration des secrets GitHub pour l'auto-publication"
echo "📦 Synq Chat (Serveur Open Source) + Synq.Team (Site du Service)"

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "${BLUE}[CONFIG]${NC} $1"
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
        echo "Installez-le avec: https://cli.github.com/"
        exit 1
    fi
    success "GitHub CLI détecté"
}

# Vérifier l'authentification GitHub
check_github_auth() {
    if ! gh auth status &> /dev/null; then
        error "Non authentifié avec GitHub CLI"
        echo "Authentifiez-vous avec: gh auth login"
        exit 1
    fi
    success "Authentifié avec GitHub CLI"
}

# Configurer les secrets pour Synq Chat (Serveur Open Source)
configure_synq_chat_secrets() {
    log "Configuration des secrets pour Synq Chat (Serveur Open Source)..."
    
    echo ""
    echo "📋 Secrets nécessaires pour Synq Chat:"
    echo "  - VPS_HOST: Adresse IP ou domaine du VPS"
    echo "  - VPS_USER: Utilisateur SSH du VPS"
    echo "  - VPS_SSH_KEY: Clé privée SSH pour le VPS"
    echo "  - VPS_DEPLOY_PATH: Chemin de déploiement sur le VPS"
    echo "  - DOCKER_REGISTRY: Registry Docker (ex: registry.synq.com)"
    echo "  - DOCKER_USERNAME: Nom d'utilisateur Docker"
    echo "  - DOCKER_PASSWORD: Mot de passe Docker"
    echo ""
    
    read -p "VPS_HOST (ex: 192.168.1.100 ou synq-chat.com): " VPS_HOST
    read -p "VPS_USER (ex: root ou synq): " VPS_USER
    read -p "VPS_DEPLOY_PATH (ex: /opt/synq-chat): " VPS_DEPLOY_PATH
    read -p "DOCKER_REGISTRY (ex: registry.synq.com): " DOCKER_REGISTRY
    read -p "DOCKER_USERNAME: " DOCKER_USERNAME
    read -s -p "DOCKER_PASSWORD: " DOCKER_PASSWORD
    echo ""
    
    echo "VPS_SSH_KEY (chemin vers la clé privée SSH): "
    read -p "Chemin vers la clé privée SSH (ex: ~/.ssh/id_rsa): " SSH_KEY_PATH
    
    if [ ! -f "$SSH_KEY_PATH" ]; then
        error "Clé SSH non trouvée: $SSH_KEY_PATH"
        exit 1
    fi
    
    # Configurer les secrets
    gh secret set VPS_HOST --body "$VPS_HOST"
    gh secret set VPS_USER --body "$VPS_USER"
    gh secret set VPS_DEPLOY_PATH --body "$VPS_DEPLOY_PATH"
    gh secret set DOCKER_REGISTRY --body "$DOCKER_REGISTRY"
    gh secret set DOCKER_USERNAME --body "$DOCKER_USERNAME"
    gh secret set DOCKER_PASSWORD --body "$DOCKER_PASSWORD"
    gh secret set VPS_SSH_KEY < "$SSH_KEY_PATH"
    
    success "Secrets Synq Chat configurés"
}

# Configurer les secrets pour Synq.Team (Site du Service)
configure_synq_team_secrets() {
    log "Configuration des secrets pour Synq.Team (Site du Service)..."
    
    echo ""
    echo "📋 Secrets nécessaires pour Synq.Team:"
    echo "  - SYNQ_TEAM_REPO: Repository GitHub de Synq.Team"
    echo "  - SYNQ_TEAM_TOKEN: Token GitHub pour Synq.Team"
    echo "  - SYNQ_TEAM_DEPLOY_URL: URL de déploiement du site"
    echo ""
    
    read -p "SYNQ_TEAM_REPO (ex: MisterSandFR/Synq.Team): " SYNQ_TEAM_REPO
    read -p "SYNQ_TEAM_DEPLOY_URL (ex: https://synq.team): " SYNQ_TEAM_DEPLOY_URL
    read -s -p "SYNQ_TEAM_TOKEN (token GitHub avec accès au repo): " SYNQ_TEAM_TOKEN
    echo ""
    
    # Configurer les secrets
    gh secret set SYNQ_TEAM_REPO --body "$SYNQ_TEAM_REPO"
    gh secret set SYNQ_TEAM_TOKEN --body "$SYNQ_TEAM_TOKEN"
    gh secret set SYNQ_TEAM_DEPLOY_URL --body "$SYNQ_TEAM_DEPLOY_URL"
    
    success "Secrets Synq.Team configurés"
}

# Créer le fichier de configuration local
create_local_config() {
    log "Création du fichier de configuration local..."
    
    cat > .env.local << EOF
# Configuration locale pour l'auto-publication
# Synq Chat (Serveur Open Source) + Synq.Team (Site du Service)

# VPS Configuration
VPS_HOST=$VPS_HOST
VPS_USER=$VPS_USER
VPS_DEPLOY_PATH=$VPS_DEPLOY_PATH

# Docker Registry
DOCKER_REGISTRY=$DOCKER_REGISTRY
DOCKER_USERNAME=$DOCKER_USERNAME

# Synq.Team Configuration
SYNQ_TEAM_REPO=$SYNQ_TEAM_REPO
SYNQ_TEAM_DEPLOY_URL=$SYNQ_TEAM_DEPLOY_URL

# Generated on $(date)
EOF

    success "Fichier de configuration local créé (.env.local)"
}

# Créer la documentation de configuration
create_config_docs() {
    log "Création de la documentation de configuration..."
    
    cat > AUTO-PUBLISH-CONFIG.md << EOF
# Configuration de l'Auto-Publication Synq Chat + Synq.Team

## Architecture

- **Synq Chat** = Serveur open source (GitHub public)
- **Synq.Team** = Site du service utilisant le serveur open source
- **Auto-publication** = Déploiement automatique par IA des nouvelles versions

## Secrets GitHub configurés

### Pour Synq Chat (Serveur Open Source)
- \`VPS_HOST\` - Adresse IP ou domaine du VPS
- \`VPS_USER\` - Utilisateur SSH du VPS
- \`VPS_SSH_KEY\` - Clé privée SSH pour le VPS
- \`VPS_DEPLOY_PATH\` - Chemin de déploiement sur le VPS
- \`DOCKER_REGISTRY\` - Registry Docker
- \`DOCKER_USERNAME\` - Nom d'utilisateur Docker
- \`DOCKER_PASSWORD\` - Mot de passe Docker

### Pour Synq.Team (Site du Service)
- \`SYNQ_TEAM_REPO\` - Repository GitHub de Synq.Team
- \`SYNQ_TEAM_TOKEN\` - Token GitHub pour Synq.Team
- \`SYNQ_TEAM_DEPLOY_URL\` - URL de déploiement du site

## Workflow d'auto-publication

### 1. Déclenchement
- Push sur \`main\` ou \`develop\`
- Pull Request vers \`main\`
- Déclenchement manuel via GitHub Actions

### 2. Processus
1. **Build Synq Chat** - Construction du serveur open source
2. **Deploy Synq Chat** - Déploiement sur le VPS
3. **Update Synq.Team** - Mise à jour du site du service
4. **Verify Deployments** - Vérification des deux déploiements
5. **Notify Status** - Notification du statut

### 3. Résultat
- **Synq Chat** déployé sur le VPS avec les nouvelles fonctionnalités
- **Synq.Team** mis à jour avec la nouvelle version
- **Auto-publication** complète et fonctionnelle

## Vérification

### Synq Chat (Serveur Open Source)
- URL: http://\$VPS_HOST
- API: http://\$VPS_HOST/api/v1/synq/voice/
- WebRTC: http://\$VPS_HOST/webrtc/

### Synq.Team (Site du Service)
- URL: \$SYNQ_TEAM_DEPLOY_URL
- Version mise à jour automatiquement
- Fonctionnalités présentées sur le site

## Dépannage

### Vérifier les secrets
\`\`\`bash
gh secret list
\`\`\`

### Vérifier les workflows
\`\`\`bash
gh run list
\`\`\`

### Vérifier les logs
\`\`\`bash
gh run view [RUN_ID]
\`\`\`

## Support

Pour obtenir de l'aide :
1. Vérifier les logs GitHub Actions
2. Vérifier la configuration des secrets
3. Tester manuellement le déploiement
4. Contacter le support technique

---

**Synq Chat** - Auto-publication par IA activée 🚀
EOF

    success "Documentation de configuration créée"
}

# Fonction principale
main() {
    log "Démarrage de la configuration de l'auto-publication..."
    
    check_gh_cli
    check_github_auth
    
    echo ""
    echo "🎯 Configuration de l'auto-publication:"
    echo "  📦 Synq Chat (Serveur Open Source)"
    echo "  🌐 Synq.Team (Site du Service)"
    echo ""
    
    configure_synq_chat_secrets
    configure_synq_team_secrets
    create_local_config
    create_config_docs
    
    success "🎉 Configuration de l'auto-publication terminée !"
    
    echo ""
    log "Prochaines étapes :"
    echo "  1. Vérifier les secrets : gh secret list"
    echo "  2. Tester le workflow : gh workflow run auto-deploy-complete.yml"
    echo "  3. Vérifier les déploiements : gh run list"
    echo "  4. Monitorer l'auto-publication : GitHub Actions"
    echo ""
    success "L'auto-publication par IA est maintenant configurée !"
}

# Exécuter le script principal
main "$@"
