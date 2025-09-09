#!/bin/bash

# Script de déploiement Docker pour Synq Chat
# Usage: ./deploy-docker.sh [deploy|stop|start|restart|logs|backup|restore]

set -e

# Configuration
COMPOSE_FILE="docker/production/docker-compose.yml"
BACKUP_DIR="/opt/backups/synq-chat-docker"
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
    echo -e "${GREEN}[DOCKER]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
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
    log "Vérification des prérequis Docker..."
    
    # Vérifier Docker
    if ! command -v docker &> /dev/null; then
        error "Docker n'est pas installé"
        exit 1
    fi
    
    # Vérifier Docker Compose
    if ! command -v docker-compose &> /dev/null; then
        error "Docker Compose n'est pas installé"
        exit 1
    fi
    
    # Vérifier le fichier de configuration
    if [ ! -f "$COMPOSE_FILE" ]; then
        error "Fichier Docker Compose non trouvé: $COMPOSE_FILE"
        exit 1
    fi
    
    # Vérifier le fichier d'environnement
    if [ ! -f ".env.production" ]; then
        error "Fichier d'environnement .env.production non trouvé"
        exit 1
    fi
    
    log "Tous les prérequis Docker sont satisfaits"
}

# Fonction de déploiement
deploy() {
    log "Début du déploiement Docker..."
    
    # Vérifier les prérequis
    check_prerequisites
    
    # Arrêter les conteneurs existants
    log "Arrêt des conteneurs existants..."
    docker-compose -f "$COMPOSE_FILE" down || true
    
    # Construire les images
    log "Construction des images Docker..."
    docker-compose -f "$COMPOSE_FILE" build --no-cache
    
    # Démarrer les services
    log "Démarrage des services..."
    docker-compose -f "$COMPOSE_FILE" up -d
    
    # Attendre que les services démarrent
    log "Attente du démarrage des services..."
    sleep 30
    
    # Vérifier le statut des conteneurs
    log "Vérification du statut des conteneurs..."
    docker-compose -f "$COMPOSE_FILE" ps
    
    # Vérifier la santé des services
    log "Vérification de la santé des services..."
    
    # Attendre que l'application soit prête
    for i in {1..60}; do
        if docker-compose -f "$COMPOSE_FILE" exec synq-chat curl -f http://localhost:3000/api/health > /dev/null 2>&1; then
            log "Application Synq Chat prête"
            break
        fi
        
        if [ $i -eq 60 ]; then
            error "L'application n'est pas prête après 60 tentatives"
            docker-compose -f "$COMPOSE_FILE" logs synq-chat
            exit 1
        fi
        
        sleep 5
    done
    
    # Vérifier MongoDB
    if docker-compose -f "$COMPOSE_FILE" exec mongodb mongosh --eval "db.runCommand('ping')" > /dev/null 2>&1; then
        log "MongoDB prêt"
    else
        error "MongoDB non accessible"
        exit 1
    fi
    
    # Vérifier Redis
    if docker-compose -f "$COMPOSE_FILE" exec redis redis-cli ping > /dev/null 2>&1; then
        log "Redis prêt"
    else
        error "Redis non accessible"
        exit 1
    fi
    
    # Vérifier Nginx
    if docker-compose -f "$COMPOSE_FILE" exec nginx wget --quiet --tries=1 --spider http://localhost/health > /dev/null 2>&1; then
        log "Nginx prêt"
    else
        error "Nginx non accessible"
        exit 1
    fi
    
    log "Déploiement Docker terminé avec succès!"
    
    # Afficher les informations de connexion
    info "Services disponibles:"
    info "  - Application: https://$DOMAIN"
    info "  - Monitoring: http://$DOMAIN:9100"
    info "  - MongoDB: localhost:27017"
    info "  - Redis: localhost:6379"
}

# Fonction d'arrêt
stop() {
    log "Arrêt des services Docker..."
    docker-compose -f "$COMPOSE_FILE" down
    log "Services arrêtés"
}

# Fonction de démarrage
start() {
    log "Démarrage des services Docker..."
    docker-compose -f "$COMPOSE_FILE" up -d
    log "Services démarrés"
}

# Fonction de redémarrage
restart() {
    log "Redémarrage des services Docker..."
    docker-compose -f "$COMPOSE_FILE" restart
    log "Services redémarrés"
}

# Fonction d'affichage des logs
logs() {
    local service=${1:-""}
    
    if [ -n "$service" ]; then
        log "Affichage des logs pour le service: $service"
        docker-compose -f "$COMPOSE_FILE" logs -f "$service"
    else
        log "Affichage des logs pour tous les services"
        docker-compose -f "$COMPOSE_FILE" logs -f
    fi
}

# Fonction de sauvegarde
backup() {
    log "Création de la sauvegarde Docker..."
    
    BACKUP_NAME="synq-docker-backup-$(date +%Y%m%d-%H%M%S)"
    BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"
    
    mkdir -p "$BACKUP_PATH"
    
    # Sauvegarder la base de données MongoDB
    log "Sauvegarde de la base de données MongoDB..."
    docker-compose -f "$COMPOSE_FILE" exec -T mongodb mongodump --db synq_chat --archive > "$BACKUP_PATH/mongodb-backup.archive"
    
    # Sauvegarder les volumes
    log "Sauvegarde des volumes..."
    docker run --rm -v synq-chat_synq_uploads:/data -v "$BACKUP_PATH":/backup alpine tar czf /backup/uploads.tar.gz -C /data .
    docker run --rm -v synq-chat_synq_logs:/data -v "$BACKUP_PATH":/backup alpine tar czf /backup/logs.tar.gz -C /data .
    docker run --rm -v synq-chat_synq_config:/data -v "$BACKUP_PATH":/backup alpine tar czf /backup/config.tar.gz -C /data .
    
    # Créer un fichier de métadonnées
    cat > "$BACKUP_PATH/metadata.json" << EOF
{
    "timestamp": "$(date -Iseconds)",
    "backup_type": "docker",
    "services": ["synq-chat", "mongodb", "redis", "nginx"],
    "volumes": ["synq_uploads", "synq_logs", "synq_config"]
}
EOF
    
    log "Sauvegarde créée: $BACKUP_NAME"
    
    # Nettoyer les anciennes sauvegardes
    log "Nettoyage des anciennes sauvegardes..."
    ls -t "$BACKUP_DIR" | tail -n +11 | xargs -I {} rm -rf "$BACKUP_DIR/{}" 2>/dev/null || true
    
    log "Sauvegarde terminée avec succès"
}

# Fonction de restauration
restore() {
    local backup_name=$1
    
    if [ -z "$backup_name" ]; then
        error "Nom de la sauvegarde requis"
        echo "Usage: $0 restore <backup_name>"
        exit 1
    fi
    
    BACKUP_PATH="$BACKUP_DIR/$backup_name"
    
    if [ ! -d "$BACKUP_PATH" ]; then
        error "Sauvegarde non trouvée: $backup_name"
        exit 1
    fi
    
    log "Restauration depuis la sauvegarde: $backup_name"
    
    # Arrêter les services
    log "Arrêt des services..."
    docker-compose -f "$COMPOSE_FILE" down
    
    # Restaurer la base de données MongoDB
    log "Restauration de la base de données MongoDB..."
    docker-compose -f "$COMPOSE_FILE" up -d mongodb
    sleep 10
    docker-compose -f "$COMPOSE_FILE" exec -T mongodb mongorestore --db synq_chat --archive < "$BACKUP_PATH/mongodb-backup.archive"
    
    # Restaurer les volumes
    log "Restauration des volumes..."
    docker run --rm -v synq-chat_synq_uploads:/data -v "$BACKUP_PATH":/backup alpine tar xzf /backup/uploads.tar.gz -C /data
    docker run --rm -v synq-chat_synq_logs:/data -v "$BACKUP_PATH":/backup alpine tar xzf /backup/logs.tar.gz -C /data
    docker run --rm -v synq-chat_synq_config:/data -v "$BACKUP_PATH":/backup alpine tar xzf /backup/config.tar.gz -C /data
    
    # Redémarrer tous les services
    log "Redémarrage des services..."
    docker-compose -f "$COMPOSE_FILE" up -d
    
    log "Restauration terminée avec succès"
}

# Fonction de monitoring
monitor() {
    log "Monitoring des services Docker..."
    
    # Statut des conteneurs
    docker-compose -f "$COMPOSE_FILE" ps
    
    # Utilisation des ressources
    docker stats --no-stream
    
    # Santé des services
    log "Vérification de la santé des services..."
    
    if docker-compose -f "$COMPOSE_FILE" exec synq-chat curl -f http://localhost:3000/api/health > /dev/null 2>&1; then
        log "✓ Application Synq Chat en bonne santé"
    else
        error "✗ Application Synq Chat non accessible"
    fi
    
    if docker-compose -f "$COMPOSE_FILE" exec mongodb mongosh --eval "db.runCommand('ping')" > /dev/null 2>&1; then
        log "✓ MongoDB en bonne santé"
    else
        error "✗ MongoDB non accessible"
    fi
    
    if docker-compose -f "$COMPOSE_FILE" exec redis redis-cli ping > /dev/null 2>&1; then
        log "✓ Redis en bonne santé"
    else
        error "✗ Redis non accessible"
    fi
    
    if docker-compose -f "$COMPOSE_FILE" exec nginx wget --quiet --tries=1 --spider http://localhost/health > /dev/null 2>&1; then
        log "✓ Nginx en bonne santé"
    else
        error "✗ Nginx non accessible"
    fi
}

# Fonction d'aide
show_help() {
    echo "Usage: $0 [COMMAND] [OPTIONS]"
    echo ""
    echo "Commands:"
    echo "  deploy              Déployer l'application avec Docker"
    echo "  stop                Arrêter tous les services"
    echo "  start               Démarrer tous les services"
    echo "  restart             Redémarrer tous les services"
    echo "  logs [service]      Afficher les logs (optionnel: service spécifique)"
    echo "  backup              Créer une sauvegarde"
    echo "  restore <name>      Restaurer depuis une sauvegarde"
    echo "  monitor             Vérifier le statut des services"
    echo "  help                Afficher cette aide"
    echo ""
    echo "Examples:"
    echo "  $0 deploy"
    echo "  $0 logs synq-chat"
    echo "  $0 restore synq-docker-backup-20240101-120000"
}

# Menu principal
case "${1:-help}" in
    deploy)
        deploy
        ;;
    stop)
        stop
        ;;
    start)
        start
        ;;
    restart)
        restart
        ;;
    logs)
        logs "$2"
        ;;
    backup)
        backup
        ;;
    restore)
        restore "$2"
        ;;
    monitor)
        monitor
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
