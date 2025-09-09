#!/bin/bash

# Script de déploiement automatisé pour Synq Chat
# Usage: ./deploy-production.sh [deploy|rollback|monitor|backup]

set -e

# Configuration
APP_DIR="/opt/synq-chat"
BACKUP_DIR="/opt/backups/synq-chat"
SERVICE_NAME="synq-chat"
NGINX_SITE="synq-chat"
DOMAIN="your-domain.com"
EMAIL="admin@your-domain.com"

# Couleurs pour les logs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Fonctions de logging
log() {
    echo -e "${GREEN}[DEPLOY]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

info() {
    echo -e "${BLUE}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

# Fonction de vérification des prérequis
check_prerequisites() {
    log "Vérification des prérequis..."
    
    # Vérifier Node.js
    if ! command -v node &> /dev/null; then
        error "Node.js n'est pas installé"
        exit 1
    fi
    
    # Vérifier npm
    if ! command -v npm &> /dev/null; then
        error "npm n'est pas installé"
        exit 1
    fi
    
    # Vérifier MongoDB
    if ! command -v mongo &> /dev/null; then
        error "MongoDB n'est pas installé"
        exit 1
    fi
    
    # Vérifier Redis
    if ! command -v redis-cli &> /dev/null; then
        error "Redis n'est pas installé"
        exit 1
    fi
    
    # Vérifier Nginx
    if ! command -v nginx &> /dev/null; then
        error "Nginx n'est pas installé"
        exit 1
    fi
    
    log "Tous les prérequis sont satisfaits"
}

# Fonction de sauvegarde
backup() {
    log "Création de la sauvegarde..."
    
    BACKUP_NAME="synq-backup-$(date +%Y%m%d-%H%M%S)"
    BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"
    
    mkdir -p "$BACKUP_PATH"
    
    # Sauvegarder la base de données MongoDB
    log "Sauvegarde de la base de données MongoDB..."
    mongodump --db synq_chat --out "$BACKUP_PATH/mongodb" || {
        error "Échec de la sauvegarde MongoDB"
        exit 1
    }
    
    # Sauvegarder les fichiers uploads
    if [ -d "$APP_DIR/uploads" ]; then
        log "Sauvegarde des fichiers uploads..."
        cp -r "$APP_DIR/uploads" "$BACKUP_PATH/" || {
            warning "Impossible de sauvegarder les uploads"
        }
    fi
    
    # Sauvegarder la configuration
    log "Sauvegarde de la configuration..."
    cp "$APP_DIR/.env.production" "$BACKUP_PATH/" 2>/dev/null || {
        warning "Impossible de sauvegarder la configuration"
    }
    
    # Sauvegarder les logs
    if [ -d "$APP_DIR/logs" ]; then
        log "Sauvegarde des logs..."
        cp -r "$APP_DIR/logs" "$BACKUP_PATH/" || {
            warning "Impossible de sauvegarder les logs"
        }
    fi
    
    # Créer un fichier de métadonnées
    cat > "$BACKUP_PATH/metadata.json" << EOF
{
    "timestamp": "$(date -Iseconds)",
    "version": "$(cd $APP_DIR && git rev-parse HEAD 2>/dev/null || echo 'unknown')",
    "backup_type": "full",
    "database": "mongodb",
    "files": ["uploads", "logs", "config"]
}
EOF
    
    log "Sauvegarde créée: $BACKUP_NAME"
    
    # Nettoyer les anciennes sauvegardes (garder les 10 dernières)
    log "Nettoyage des anciennes sauvegardes..."
    ls -t "$BACKUP_DIR" | tail -n +11 | xargs -I {} rm -rf "$BACKUP_DIR/{}" 2>/dev/null || true
    
    log "Sauvegarde terminée avec succès"
}

# Fonction de déploiement
deploy() {
    log "Début du déploiement..."
    
    # Vérifier les prérequis
    check_prerequisites
    
    # Arrêter le service
    log "Arrêt du service..."
    sudo systemctl stop $SERVICE_NAME || {
        warning "Le service n'était pas en cours d'exécution"
    }
    
    # Créer une sauvegarde
    backup
    
    # Mettre à jour le code
    log "Mise à jour du code..."
    cd "$APP_DIR"
    
    # Sauvegarder les modifications locales
    git stash push -m "Auto-stash before deployment $(date)" || true
    
    # Récupérer les dernières modifications
    git fetch origin
    git reset --hard origin/main
    
    # Restaurer les modifications locales si nécessaire
    git stash pop || true
    
    # Installer les dépendances
    log "Installation des dépendances..."
    npm ci --production || {
        error "Échec de l'installation des dépendances"
        exit 1
    }
    
    # Construire l'application
    log "Construction de l'application..."
    npm run build || {
        error "Échec de la construction de l'application"
        exit 1
    }
    
    # Vérifier la configuration
    log "Vérification de la configuration..."
    if [ ! -f ".env.production" ]; then
        error "Fichier de configuration .env.production manquant"
        exit 1
    fi
    
    # Vérifier les permissions
    log "Vérification des permissions..."
    sudo chown -R synq:synq "$APP_DIR" || {
        error "Impossible de définir les permissions"
        exit 1
    }
    
    # Redémarrer le service
    log "Démarrage du service..."
    sudo systemctl start $SERVICE_NAME
    
    # Attendre que le service démarre
    sleep 10
    
    # Vérifier le statut du service
    if sudo systemctl is-active --quiet $SERVICE_NAME; then
        log "Service démarré avec succès"
    else
        error "Échec du démarrage du service"
        sudo journalctl -u $SERVICE_NAME --no-pager -n 50
        exit 1
    fi
    
    # Vérifier la connectivité
    log "Vérification de la connectivité..."
    for i in {1..30}; do
        if curl -f http://localhost:3000/api/health > /dev/null 2>&1; then
            log "Application répond correctement"
            break
        fi
        
        if [ $i -eq 30 ]; then
            error "L'application ne répond pas après 30 tentatives"
            exit 1
        fi
        
        sleep 2
    done
    
    # Vérifier Nginx
    log "Vérification de Nginx..."
    sudo nginx -t || {
        error "Configuration Nginx invalide"
        exit 1
    }
    
    sudo systemctl reload nginx || {
        error "Échec du rechargement de Nginx"
        exit 1
    }
    
    # Tests de production
    log "Exécution des tests de production..."
    if [ -f "test-production.sh" ]; then
        chmod +x test-production.sh
        ./test-production.sh || {
            warning "Certains tests de production ont échoué"
        }
    fi
    
    log "Déploiement terminé avec succès!"
    
    # Envoyer une notification
    send_notification "Déploiement réussi" "Synq Chat a été déployé avec succès sur $DOMAIN"
}

# Fonction de rollback
rollback() {
    log "Début du rollback..."
    
    # Arrêter le service
    log "Arrêt du service..."
    sudo systemctl stop $SERVICE_NAME
    
    # Trouver la dernière sauvegarde
    LATEST_BACKUP=$(ls -t "$BACKUP_DIR" | head -n1)
    
    if [ -z "$LATEST_BACKUP" ]; then
        error "Aucune sauvegarde trouvée"
        exit 1
    fi
    
    log "Restauration depuis la sauvegarde: $LATEST_BACKUP"
    
    # Restaurer la base de données
    log "Restauration de la base de données..."
    mongorestore --db synq_chat "$BACKUP_DIR/$LATEST_BACKUP/mongodb/synq_chat" || {
        error "Échec de la restauration de la base de données"
        exit 1
    }
    
    # Restaurer les fichiers
    if [ -d "$BACKUP_DIR/$LATEST_BACKUP/uploads" ]; then
        log "Restauration des fichiers uploads..."
        rm -rf "$APP_DIR/uploads"
        cp -r "$BACKUP_DIR/$LATEST_BACKUP/uploads" "$APP_DIR/"
    fi
    
    # Restaurer la configuration
    if [ -f "$BACKUP_DIR/$LATEST_BACKUP/.env.production" ]; then
        log "Restauration de la configuration..."
        cp "$BACKUP_DIR/$LATEST_BACKUP/.env.production" "$APP_DIR/"
    fi
    
    # Redémarrer le service
    log "Redémarrage du service..."
    sudo systemctl start $SERVICE_NAME
    
    # Vérifier le statut
    sleep 10
    if sudo systemctl is-active --quiet $SERVICE_NAME; then
        log "Rollback terminé avec succès!"
    else
        error "Échec du rollback"
        exit 1
    fi
    
    # Envoyer une notification
    send_notification "Rollback effectué" "Synq Chat a été restauré depuis la sauvegarde $LATEST_BACKUP"
}

# Fonction de monitoring
monitor() {
    log "Vérification du statut du service..."
    
    # Vérifier le service
    if sudo systemctl is-active --quiet $SERVICE_NAME; then
        log "Service en cours d'exécution"
    else
        error "Service arrêté"
        exit 1
    fi
    
    # Vérifier la connectivité
    if curl -f http://localhost:3000/api/health > /dev/null 2>&1; then
        log "Application répond correctement"
    else
        error "Application ne répond pas"
        exit 1
    fi
    
    # Vérifier MongoDB
    if mongo --eval "db.runCommand('ping')" > /dev/null 2>&1; then
        log "MongoDB fonctionne correctement"
    else
        error "MongoDB ne répond pas"
        exit 1
    fi
    
    # Vérifier Redis
    if redis-cli ping > /dev/null 2>&1; then
        log "Redis fonctionne correctement"
    else
        error "Redis ne répond pas"
        exit 1
    fi
    
    # Vérifier Nginx
    if sudo systemctl is-active --quiet nginx; then
        log "Nginx fonctionne correctement"
    else
        error "Nginx ne fonctionne pas"
        exit 1
    fi
    
    # Vérifier l'espace disque
    DISK_USAGE=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
    if [ $DISK_USAGE -gt 80 ]; then
        warning "Utilisation du disque élevée: ${DISK_USAGE}%"
    else
        log "Utilisation du disque: ${DISK_USAGE}%"
    fi
    
    # Vérifier la mémoire
    MEMORY_USAGE=$(free | awk 'NR==2{printf "%.0f", $3*100/$2}')
    if [ $MEMORY_USAGE -gt 90 ]; then
        warning "Utilisation de la mémoire élevée: ${MEMORY_USAGE}%"
    else
        log "Utilisation de la mémoire: ${MEMORY_USAGE}%"
    fi
    
    log "Monitoring terminé - Tout fonctionne correctement"
}

# Fonction d'envoi de notifications
send_notification() {
    local subject="$1"
    local message="$2"
    
    if command -v mail &> /dev/null; then
        echo "$message" | mail -s "$subject" "$EMAIL" || true
    fi
    
    # Log de la notification
    log "Notification envoyée: $subject"
}

# Fonction d'aide
show_help() {
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  deploy    Déployer l'application en production"
    echo "  rollback  Restaurer depuis la dernière sauvegarde"
    echo "  monitor   Vérifier le statut de l'application"
    echo "  backup    Créer une sauvegarde manuelle"
    echo "  help      Afficher cette aide"
    echo ""
    echo "Examples:"
    echo "  $0 deploy"
    echo "  $0 rollback"
    echo "  $0 monitor"
}

# Menu principal
case "${1:-help}" in
    deploy)
        deploy
        ;;
    rollback)
        rollback
        ;;
    monitor)
        monitor
        ;;
    backup)
        backup
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        error "Commande inconnue: $1"
        show_help
        exit 1
        ;;
esac
