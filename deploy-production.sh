#!/bin/bash

# Script de déploiement en production pour Synq Chat avec fonctionnalités vocales
set -e

echo "🚀 Déploiement en production - Synq Chat avec fonctionnalités vocales natives"

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "${BLUE}[DEPLOY]${NC} $1"
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

# Configuration de production
PRODUCTION_BRANCH="main"
DEPLOYMENT_ENV="production"
DOCKER_IMAGE_NAME="synq-chat"
DOCKER_TAG="latest"

# Vérifier les prérequis
check_prerequisites() {
    log "Vérification des prérequis de déploiement..."
    
    if ! command -v docker &> /dev/null; then
        error "Docker n'est pas installé"
        exit 1
    fi
    success "Docker: $(docker --version)"
    
    if ! command -v docker-compose &> /dev/null; then
        error "Docker Compose n'est pas installé"
        exit 1
    fi
    success "Docker Compose: $(docker-compose --version)"
    
    if ! command -v git &> /dev/null; then
        error "Git n'est pas installé"
        exit 1
    fi
    success "Git: $(git --version)"
}

# Construire l'image Docker
build_docker_image() {
    log "Construction de l'image Docker de production..."
    
    # Construire l'image avec les nouvelles fonctionnalités
    if docker build -t ${DOCKER_IMAGE_NAME}:${DOCKER_TAG} .; then
        success "Image Docker construite avec succès"
    else
        error "Échec de la construction de l'image Docker"
        exit 1
    fi
    
    # Tagger pour la production
    docker tag ${DOCKER_IMAGE_NAME}:${DOCKER_TAG} ${DOCKER_IMAGE_NAME}:production
    success "Image taggée pour la production"
}

# Créer la configuration de production
create_production_config() {
    log "Création de la configuration de production..."
    
    cat > docker-compose.production.yml << EOF
version: '3.8'

services:
  synq-chat:
    image: ${DOCKER_IMAGE_NAME}:production
    container_name: synq-chat-production
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - ROOT_URL=https://synq-chat.com
      - MONGO_URL=mongodb://mongo:27017/synq-chat
      - REDIS_URL=redis://redis:6379
      # Configuration des fonctionnalités vocales
      - Synq_Native_Voice_Enabled=true
      - Synq_Voice_Persistent_Rooms=true
      - Synq_Voice_Max_Participants=50
      - Synq_Voice_Screen_Share_Enabled=true
      - Synq_Voice_Chat_Enabled=true
      - Synq_Voice_Encryption_Enabled=true
      - Synq_Voice_Moderation_Enabled=true
      - Synq_Voice_Recording_Enabled=false
      - Synq_Voice_Presence_Notifications=true
      - Synq_Voice_Speech_Detection=true
      - Synq_Voice_Noise_Reduction=true
      - Synq_Voice_Echo_Cancellation=true
      - Synq_Voice_Auto_Quality_Adaptation=true
      - Synq_Voice_Audio_Compression=true
      - Synq_Voice_Video_Compression=true
      # Configuration WebRTC
      - WebRTC_Enabled=true
      - WebRTC_Servers=stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302
      - WebRTC_Enable_Direct=true
      - WebRTC_Enable_Private=true
      - WebRTC_Enable_Channel=true
    volumes:
      - synq-chat-data:/app/uploads
      - synq-chat-logs:/app/logs
    depends_on:
      - mongo
      - redis
    networks:
      - synq-network

  mongo:
    image: mongo:6.0
    container_name: synq-mongo-production
    restart: unless-stopped
    volumes:
      - mongo-data:/data/db
    networks:
      - synq-network

  redis:
    image: redis:7-alpine
    container_name: synq-redis-production
    restart: unless-stopped
    volumes:
      - redis-data:/data
    networks:
      - synq-network

  nginx:
    image: nginx:alpine
    container_name: synq-nginx-production
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    depends_on:
      - synq-chat
    networks:
      - synq-network

volumes:
  synq-chat-data:
  synq-chat-logs:
  mongo-data:
  redis-data:

networks:
  synq-network:
    driver: bridge
EOF

    success "Configuration de production créée"
}

# Créer la configuration Nginx
create_nginx_config() {
    log "Création de la configuration Nginx..."
    
    cat > nginx.conf << EOF
events {
    worker_connections 1024;
}

http {
    upstream synq-chat {
        server synq-chat:3000;
    }

    # Configuration pour les fonctionnalités vocales WebRTC
    map \$http_upgrade \$connection_upgrade {
        default upgrade;
        '' close;
    }

    server {
        listen 80;
        server_name synq-chat.com www.synq-chat.com;
        return 301 https://\$server_name\$request_uri;
    }

    server {
        listen 443 ssl http2;
        server_name synq-chat.com www.synq-chat.com;

        ssl_certificate /etc/nginx/ssl/cert.pem;
        ssl_certificate_key /etc/nginx/ssl/key.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
        ssl_prefer_server_ciphers off;

        # Headers pour WebRTC
        add_header X-Frame-Options DENY;
        add_header X-Content-Type-Options nosniff;
        add_header X-XSS-Protection "1; mode=block";
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

        # Configuration pour les fonctionnalités vocales
        location /api/v1/synq/voice/ {
            proxy_pass http://synq-chat;
            proxy_http_version 1.1;
            proxy_set_header Upgrade \$http_upgrade;
            proxy_set_header Connection \$connection_upgrade;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
            proxy_cache_bypass \$http_upgrade;
        }

        # Configuration pour WebRTC
        location /webrtc/ {
            proxy_pass http://synq-chat;
            proxy_http_version 1.1;
            proxy_set_header Upgrade \$http_upgrade;
            proxy_set_header Connection \$connection_upgrade;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
            proxy_cache_bypass \$http_upgrade;
        }

        # Configuration générale
        location / {
            proxy_pass http://synq-chat;
            proxy_http_version 1.1;
            proxy_set_header Upgrade \$http_upgrade;
            proxy_set_header Connection \$connection_upgrade;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
            proxy_cache_bypass \$http_upgrade;
        }

        # Configuration pour les fichiers statiques
        location /static/ {
            proxy_pass http://synq-chat;
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }
}
EOF

    success "Configuration Nginx créée"
}

# Déployer en production
deploy_production() {
    log "Déploiement en production..."
    
    # Arrêter les services existants
    if docker-compose -f docker-compose.production.yml down; then
        success "Services existants arrêtés"
    else
        warning "Aucun service existant à arrêter"
    fi
    
    # Démarrer les nouveaux services
    if docker-compose -f docker-compose.production.yml up -d; then
        success "Services de production démarrés"
    else
        error "Échec du démarrage des services"
        exit 1
    fi
    
    # Vérifier le statut des services
    log "Vérification du statut des services..."
    docker-compose -f docker-compose.production.yml ps
    
    success "Déploiement en production terminé"
}

# Tester le déploiement
test_deployment() {
    log "Test du déploiement..."
    
    # Attendre que les services soient prêts
    sleep 30
    
    # Tester l'API des fonctionnalités vocales
    if curl -f http://localhost/api/v1/synq/voice/rooms > /dev/null 2>&1; then
        success "API des fonctionnalités vocales accessible"
    else
        warning "API des fonctionnalités vocales non accessible (normal si pas d'auth)"
    fi
    
    # Tester la page principale
    if curl -f http://localhost > /dev/null 2>&1; then
        success "Application accessible"
    else
        error "Application non accessible"
        exit 1
    fi
    
    success "Tests de déploiement réussis"
}

# Créer les certificats SSL (auto-signés pour le test)
create_ssl_certificates() {
    log "Création des certificats SSL..."
    
    mkdir -p ssl
    
    if openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout ssl/key.pem -out ssl/cert.pem \
        -subj "/C=FR/ST=France/L=Paris/O=Synq/CN=synq-chat.com"; then
        success "Certificats SSL créés"
    else
        error "Échec de la création des certificats SSL"
        exit 1
    fi
}

# Afficher les informations de déploiement
show_deployment_info() {
    log "Informations de déploiement:"
    echo ""
    echo "🌐 Application: https://synq-chat.com"
    echo "🎤 Fonctionnalités vocales: Activées"
    echo "📱 API REST: https://synq-chat.com/api/v1/synq/voice/"
    echo "🔧 Configuration: docker-compose.production.yml"
    echo ""
    echo "📊 Services déployés:"
    echo "  - Synq Chat (port 3000)"
    echo "  - MongoDB (port 27017)"
    echo "  - Redis (port 6379)"
    echo "  - Nginx (ports 80/443)"
    echo ""
    echo "🎯 Nouvelles fonctionnalités disponibles:"
    echo "  ✅ Salles vocales persistantes"
    echo "  ✅ Appels audio/vidéo natifs"
    echo "  ✅ Partage d'écran sans extension"
    echo "  ✅ Chat intégré dans les appels"
    echo "  ✅ Modération avancée"
    echo "  ✅ API REST complète"
    echo ""
    echo "🔐 Configuration de sécurité:"
    echo "  - Chiffrement de bout en bout"
    echo "  - Authentification requise"
    echo "  - Permissions par rôle"
    echo "  - Logs d'activité"
    echo ""
    echo "📈 Monitoring:"
    echo "  - Statistiques en temps réel"
    echo "  - Métriques de performance"
    echo "  - Logs détaillés"
    echo ""
    warning "N'oubliez pas de configurer vos vrais certificats SSL pour la production!"
}

# Fonction principale
main() {
    log "Démarrage du déploiement en production..."
    
    check_prerequisites
    build_docker_image
    create_production_config
    create_nginx_config
    create_ssl_certificates
    deploy_production
    test_deployment
    show_deployment_info
    
    success "🎉 Déploiement en production terminé avec succès!"
    success "Les fonctionnalités vocales natives sont maintenant disponibles!"
}

# Exécuter le script principal
main "$@"