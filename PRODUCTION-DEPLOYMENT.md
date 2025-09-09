# Synq Chat - Configuration de Production

## Vue d'ensemble

Ce document décrit la configuration complète pour déployer Synq Chat en production avec toutes les fonctionnalités Synq intégrées.

## Prérequis

### Infrastructure
- **Serveur**: Ubuntu 20.04+ ou CentOS 8+
- **RAM**: Minimum 8GB, Recommandé 16GB+
- **CPU**: Minimum 4 cœurs, Recommandé 8 cœurs+
- **Stockage**: Minimum 100GB SSD
- **Réseau**: Connexion stable avec ports ouverts

### Logiciels requis
- **Node.js**: Version 22.16.0+
- **MongoDB**: Version 6.0+
- **Redis**: Version 6.0+ (pour les sessions)
- **Nginx**: Version 1.18+ (reverse proxy)
- **Docker**: Version 20.10+ (optionnel)
- **Docker Compose**: Version 2.0+ (optionnel)

### Services externes (optionnels)
- **Keycloak**: Pour l'authentification SSO
- **Jitsi Meet**: Pour les salles vocales
- **Etherpad**: Pour les documents collaboratifs
- **SMTP Server**: Pour les notifications email
- **Push Notification Service**: FCM/APNS

## Installation

### 1. Préparation du serveur

```bash
# Mettre à jour le système
sudo apt update && sudo apt upgrade -y

# Installer les dépendances
sudo apt install -y curl wget git build-essential software-properties-common

# Installer Node.js 22.16.0
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Installer MongoDB
wget -qO - https://www.mongodb.org/static/pgp/server-6.0.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/6.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list
sudo apt update
sudo apt install -y mongodb-org

# Installer Redis
sudo apt install -y redis-server

# Installer Nginx
sudo apt install -y nginx

# Installer Docker (optionnel)
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
```

### 2. Configuration MongoDB

```bash
# Démarrer MongoDB
sudo systemctl start mongod
sudo systemctl enable mongod

# Créer la base de données Synq
mongo --eval "use synq_chat; db.createUser({user: 'synq_user', pwd: 'synq_password', roles: [{role: 'readWrite', db: 'synq_chat'}]})"
```

### 3. Configuration Redis

```bash
# Démarrer Redis
sudo systemctl start redis-server
sudo systemctl enable redis-server

# Configurer Redis pour la production
sudo nano /etc/redis/redis.conf
```

Ajouter dans `/etc/redis/redis.conf`:
```
# Configuration Redis pour Synq Chat
maxmemory 2gb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
save 60 10000
```

### 4. Déploiement de l'application

```bash
# Cloner le repository
git clone https://github.com/your-org/synq-chat.git
cd synq-chat

# Installer les dépendances
npm install

# Construire l'application
npm run build

# Copier les fichiers de configuration
cp .env.synq.example .env.production
```

### 5. Configuration de l'environnement

Éditer `.env.production`:

```bash
# Configuration de base
NODE_ENV=production
MONGO_URL=mongodb://synq_user:synq_password@localhost:27017/synq_chat
REDIS_URL=redis://localhost:6379
ROOT_URL=https://your-domain.com
PORT=3000

# Configuration Synq - Interface Utilisateur
SYNQ_UX_SIMPLIFIED_ENABLED=true
SYNQ_UX_ONBOARDING_ENABLED=true
SYNQ_UX_GUIDED_TOURS_ENABLED=true
SYNQ_UX_BEGINNER_MODE_ENABLED=true
SYNQ_UX_ACCESSIBILITY_ENABLED=true

# Configuration Synq - Branding
SYNQ_WORKSPACE_NAME=Synq
SYNQ_PRIMARY_COLOR=#1d74f5
SYNQ_SECONDARY_COLOR=#f5455c
SYNQ_ACCENT_COLOR=#ffd21f
SYNQ_LOGIN_BACKGROUND_COLOR=#f7f8fa
SYNQ_LOGIN_WELCOME_TEXT=Bienvenue sur Synq
SYNQ_LOGIN_SUBTITLE_TEXT=Votre plateforme de communication souveraine

# Configuration Synq - Permissions
SYNQ_PERMISSIONS_GRANULAR_ENABLED=true
SYNQ_PERMISSIONS_ALLOW_CUSTOM_ROLES=true
SYNQ_PERMISSIONS_ENABLE_AUDIT=true
SYNQ_PERMISSIONS_DEFAULT_ROLE=user

# Configuration Synq - Keycloak
SYNQ_KEYCLOAK_ENABLED=false
SYNQ_KEYCLOAK_SERVER_URL=https://your-keycloak-server.com
SYNQ_KEYCLOAK_REALM=synq
SYNQ_KEYCLOAK_CLIENT_ID=synq-chat
SYNQ_KEYCLOAK_CLIENT_SECRET=your-client-secret
SYNQ_KEYCLOAK_REDIRECT_URI=https://your-domain.com/_oauth/keycloak
SYNQ_KEYCLOAK_AUTO_PROVISION=true
SYNQ_KEYCLOAK_AUTO_UPDATE=true
SYNQ_KEYCLOAK_SYNC_GROUPS=true
SYNQ_KEYCLOAK_SYNC_ROLES=true
SYNQ_KEYCLOAK_SYNC_INTERVAL=60
SYNQ_KEYCLOAK_REAL_TIME_SYNC=false
SYNQ_KEYCLOAK_DEBUG_LOGS=false

# Configuration Synq - Jitsi
SYNQ_JITSI_ENHANCED_ENABLED=true
SYNQ_JITSI_SERVER_URL=https://meet.jit.si
SYNQ_JITSI_PERSISTENT_ROOMS=true
SYNQ_JITSI_VOICE_ROOMS=true
SYNQ_JITSI_AUTO_JOIN_VOICE=false
SYNQ_JITSI_ROOM_USER_LIMIT=50
SYNQ_JITSI_ROOM_LIFETIME=60
SYNQ_JITSI_RECORDING_ENABLED=false
SYNQ_JITSI_ENHANCED_SCREEN_SHARE=true
SYNQ_JITSI_INTEGRATED_CHAT=true
SYNQ_JITSI_PRESENCE_NOTIFICATIONS=true
SYNQ_JITSI_CHANNEL_INTEGRATION=true
SYNQ_JITSI_REQUIRE_AUTH=false
SYNQ_JITSI_ENCRYPTION_ENABLED=true
SYNQ_JITSI_ROOM_MODERATION=true
SYNQ_JITSI_CALL_LOGS=true

# Configuration Synq - Documents
SYNQ_DOCS_ENABLED=true
SYNQ_DOCS_EDITOR_TYPE=etherpad
SYNQ_DOCS_SERVER_URL=http://localhost:9001
SYNQ_DOCS_API_KEY=your-etherpad-api-key
SYNQ_DOCS_DEFAULT_PERMISSIONS={}
SYNQ_DOCS_LIFETIME=30
SYNQ_DOCS_AUTO_SAVE=true
SYNQ_DOCS_VERSIONING=true
SYNQ_DOCS_CHANNEL_INTEGRATION=true
SYNQ_DOCS_CHANGE_NOTIFICATIONS=true
SYNQ_DOCS_EASY_SHARING=true
SYNQ_DOCS_EXPORT_ENABLED=true

# Configuration Synq - Analytics
SYNQ_ANALYTICS_ENABLED=true
SYNQ_ANALYTICS_DATA_COLLECTION=true
SYNQ_ANALYTICS_COLLECTION_INTERVAL=5
SYNQ_ANALYTICS_DATA_RETENTION=90
SYNQ_ANALYTICS_MESSAGES_PER_DAY=true
SYNQ_ANALYTICS_ACTIVE_USERS=true
SYNQ_ANALYTICS_TOP_CHANNELS=true
SYNQ_ANALYTICS_RESPONSE_TIME=true
SYNQ_ANALYTICS_PEAK_HOURS=true
SYNQ_ANALYTICS_PEAK_DAYS=true
SYNQ_ANALYTICS_TOP_USERS=true
SYNQ_ANALYTICS_MESSAGE_TYPES=true
SYNQ_ANALYTICS_ADMIN_DASHBOARD=true
SYNQ_ANALYTICS_USER_DASHBOARD=false
SYNQ_ANALYTICS_AUTO_REPORTS=true
SYNQ_ANALYTICS_REPORT_FREQUENCY=7
SYNQ_ANALYTICS_EXPORT_ENABLED=true
SYNQ_ANALYTICS_EXTERNAL_INTEGRATION=false
SYNQ_ANALYTICS_API_ENABLED=true

# Configuration Synq - Workflows
SYNQ_WORKFLOWS_ENABLED=true
SYNQ_WORKFLOWS_MAX_ACTIONS=100
SYNQ_WORKFLOWS_TIMEOUT=300000
SYNQ_WORKFLOWS_RETRY_ON_FAILURE=true
SYNQ_WORKFLOWS_MAX_RETRIES=3

# Configuration Synq - Notifications
SYNQ_NOTIFICATIONS_ENABLED=true
SYNQ_NOTIFICATIONS_EMAIL_ENABLED=true
SYNQ_NOTIFICATIONS_PUSH_ENABLED=true
SYNQ_NOTIFICATIONS_IN_APP_ENABLED=true
SYNQ_NOTIFICATIONS_SMS_ENABLED=false
SYNQ_NOTIFICATIONS_WEBHOOK_ENABLED=false
SYNQ_NOTIFICATIONS_QUIET_HOURS_ENABLED=false
SYNQ_NOTIFICATIONS_QUIET_HOURS_START=22:00
SYNQ_NOTIFICATIONS_QUIET_HOURS_END=08:00
SYNQ_NOTIFICATIONS_QUIET_HOURS_TIMEZONE=Europe/Paris

# Configuration email (pour les notifications)
MAIL_URL=smtp://username:password@smtp-server.com:587
MAIL_FROM=noreply@your-domain.com

# Configuration push notifications (optionnel)
FCM_SERVER_KEY=your-fcm-server-key
APNS_CERT_PATH=/path/to/apns-cert.pem
APNS_KEY_PATH=/path/to/apns-key.pem

# Configuration SSL/TLS
SSL_CERT_PATH=/path/to/ssl-cert.pem
SSL_KEY_PATH=/path/to/ssl-key.pem
```

### 6. Configuration Nginx

Créer `/etc/nginx/sites-available/synq-chat`:

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL Configuration
    ssl_certificate /path/to/ssl-cert.pem;
    ssl_certificate_key /path/to/ssl-key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;

    # Static files
    location /images/synq/ {
        alias /path/to/synq-chat/apps/meteor/public/images/synq/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location /favicon.ico {
        alias /path/to/synq-chat/apps/meteor/public/favicon.ico;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # WebSocket support
    location /sockjs-node/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Main application
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }

    # API routes
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Activer le site:
```bash
sudo ln -s /etc/nginx/sites-available/synq-chat /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 7. Service Systemd

Créer `/etc/systemd/system/synq-chat.service`:

```ini
[Unit]
Description=Synq Chat Application
After=network.target mongod.service redis.service

[Service]
Type=simple
User=synq
Group=synq
WorkingDirectory=/path/to/synq-chat
Environment=NODE_ENV=production
EnvironmentFile=/path/to/synq-chat/.env.production
ExecStart=/usr/bin/node apps/meteor/server/main.js
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=synq-chat

# Security settings
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/path/to/synq-chat
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
```

Créer l'utilisateur et démarrer le service:
```bash
sudo useradd -r -s /bin/false synq
sudo chown -R synq:synq /path/to/synq-chat
sudo systemctl daemon-reload
sudo systemctl enable synq-chat
sudo systemctl start synq-chat
```

### 8. Configuration Docker (optionnel)

Créer `docker-compose.production.yml`:

```yaml
version: '3.8'

services:
  synq-chat:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    env_file:
      - .env.production
    depends_on:
      - mongodb
      - redis
    volumes:
      - ./uploads:/app/uploads
      - ./logs:/app/logs
    restart: unless-stopped
    networks:
      - synq-network

  mongodb:
    image: mongo:6.0
    ports:
      - "27017:27017"
    environment:
      - MONGO_INITDB_ROOT_USERNAME=admin
      - MONGO_INITDB_ROOT_PASSWORD=admin_password
      - MONGO_INITDB_DATABASE=synq_chat
    volumes:
      - mongodb_data:/data/db
      - ./mongo-init.js:/docker-entrypoint-initdb.d/mongo-init.js:ro
    restart: unless-stopped
    networks:
      - synq-network

  redis:
    image: redis:6.0-alpine
    ports:
      - "6379:6379"
    command: redis-server --appendonly yes --maxmemory 2gb --maxmemory-policy allkeys-lru
    volumes:
      - redis_data:/data
    restart: unless-stopped
    networks:
      - synq-network

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    depends_on:
      - synq-chat
    restart: unless-stopped
    networks:
      - synq-network

volumes:
  mongodb_data:
  redis_data:

networks:
  synq-network:
    driver: bridge
```

### 9. Scripts de déploiement

Créer `deploy.sh`:

```bash
#!/bin/bash

set -e

# Configuration
APP_DIR="/path/to/synq-chat"
BACKUP_DIR="/path/to/backups"
SERVICE_NAME="synq-chat"

# Couleurs pour les logs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[DEPLOY]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Fonction de sauvegarde
backup() {
    log "Creating backup..."
    BACKUP_NAME="synq-backup-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$BACKUP_DIR/$BACKUP_NAME"
    
    # Sauvegarder la base de données
    mongodump --db synq_chat --out "$BACKUP_DIR/$BACKUP_NAME/mongodb"
    
    # Sauvegarder les fichiers
    cp -r "$APP_DIR/uploads" "$BACKUP_DIR/$BACKUP_NAME/" 2>/dev/null || true
    
    log "Backup created: $BACKUP_NAME"
}

# Fonction de déploiement
deploy() {
    log "Starting deployment..."
    
    # Arrêter le service
    log "Stopping service..."
    sudo systemctl stop $SERVICE_NAME
    
    # Sauvegarder
    backup
    
    # Mettre à jour le code
    log "Updating code..."
    cd "$APP_DIR"
    git pull origin main
    
    # Installer les dépendances
    log "Installing dependencies..."
    npm install --production
    
    # Construire l'application
    log "Building application..."
    npm run build
    
    # Redémarrer le service
    log "Starting service..."
    sudo systemctl start $SERVICE_NAME
    
    # Vérifier le statut
    sleep 10
    if sudo systemctl is-active --quiet $SERVICE_NAME; then
        log "Deployment completed successfully!"
    else
        error "Service failed to start!"
        exit 1
    fi
}

# Fonction de rollback
rollback() {
    log "Rolling back..."
    
    # Arrêter le service
    sudo systemctl stop $SERVICE_NAME
    
    # Restaurer la dernière sauvegarde
    LATEST_BACKUP=$(ls -t "$BACKUP_DIR" | head -n1)
    if [ -n "$LATEST_BACKUP" ]; then
        log "Restoring from backup: $LATEST_BACKUP"
        mongorestore --db synq_chat "$BACKUP_DIR/$LATEST_BACKUP/mongodb/synq_chat"
        sudo systemctl start $SERVICE_NAME
        log "Rollback completed!"
    else
        error "No backup found!"
        exit 1
    fi
}

# Fonction de monitoring
monitor() {
    log "Checking service status..."
    
    if sudo systemctl is-active --quiet $SERVICE_NAME; then
        log "Service is running"
    else
        error "Service is not running!"
        exit 1
    fi
    
    # Vérifier la connectivité
    if curl -f http://localhost:3000/api/health > /dev/null 2>&1; then
        log "Application is responding"
    else
        error "Application is not responding!"
        exit 1
    fi
}

# Menu principal
case "$1" in
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
    *)
        echo "Usage: $0 {deploy|rollback|monitor|backup}"
        exit 1
        ;;
esac
```

Rendre le script exécutable:
```bash
chmod +x deploy.sh
```

### 10. Monitoring et logs

Créer `monitoring.sh`:

```bash
#!/bin/bash

# Script de monitoring pour Synq Chat

# Configuration
LOG_FILE="/var/log/synq-chat-monitor.log"
ALERT_EMAIL="admin@your-domain.com"

# Fonctions de monitoring
check_service() {
    if ! systemctl is-active --quiet synq-chat; then
        echo "$(date): Service synq-chat is not running" >> $LOG_FILE
        send_alert "Service synq-chat is not running"
        return 1
    fi
    return 0
}

check_database() {
    if ! mongo --eval "db.runCommand('ping')" > /dev/null 2>&1; then
        echo "$(date): MongoDB is not responding" >> $LOG_FILE
        send_alert "MongoDB is not responding"
        return 1
    fi
    return 0
}

check_redis() {
    if ! redis-cli ping > /dev/null 2>&1; then
        echo "$(date): Redis is not responding" >> $LOG_FILE
        send_alert "Redis is not responding"
        return 1
    fi
    return 0
}

check_disk_space() {
    USAGE=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
    if [ $USAGE -gt 80 ]; then
        echo "$(date): Disk usage is high: ${USAGE}%" >> $LOG_FILE
        send_alert "Disk usage is high: ${USAGE}%"
        return 1
    fi
    return 0
}

check_memory() {
    USAGE=$(free | awk 'NR==2{printf "%.0f", $3*100/$2}')
    if [ $USAGE -gt 90 ]; then
        echo "$(date): Memory usage is high: ${USAGE}%" >> $LOG_FILE
        send_alert "Memory usage is high: ${USAGE}%"
        return 1
    fi
    return 0
}

send_alert() {
    echo "$1" | mail -s "Synq Chat Alert" $ALERT_EMAIL
}

# Exécuter les vérifications
check_service
check_database
check_redis
check_disk_space
check_memory

echo "$(date): Monitoring check completed" >> $LOG_FILE
```

Ajouter au crontab:
```bash
# Monitoring toutes les 5 minutes
*/5 * * * * /path/to/monitoring.sh

# Sauvegarde quotidienne à 2h du matin
0 2 * * * /path/to/deploy.sh backup

# Nettoyage des logs hebdomadaire
0 3 * * 0 find /var/log -name "*.log" -mtime +7 -delete
```

### 11. Tests de production

Créer `test-production.sh`:

```bash
#!/bin/bash

# Tests de production pour Synq Chat

BASE_URL="https://your-domain.com"
API_URL="$BASE_URL/api"

# Fonction de test
test_endpoint() {
    local endpoint=$1
    local expected_status=$2
    
    response=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL$endpoint")
    
    if [ "$response" = "$expected_status" ]; then
        echo "✓ $endpoint - Status: $response"
        return 0
    else
        echo "✗ $endpoint - Expected: $expected_status, Got: $response"
        return 1
    fi
}

# Tests des endpoints Synq
echo "Testing Synq Chat production endpoints..."

test_endpoint "/synq/analytics/dashboard" "200"
test_endpoint "/synq/workflows" "200"
test_endpoint "/synq/notifications/settings" "200"
test_endpoint "/synq/permissions/roles" "200"
test_endpoint "/synq/etherpad/templates" "200"

echo "Production tests completed!"
```

## Maintenance

### Mise à jour de l'application

```bash
# Utiliser le script de déploiement
./deploy.sh deploy
```

### Sauvegarde manuelle

```bash
# Créer une sauvegarde
./deploy.sh backup

# Restaurer depuis une sauvegarde
./deploy.sh rollback
```

### Monitoring

```bash
# Vérifier le statut du service
sudo systemctl status synq-chat

# Voir les logs
sudo journalctl -u synq-chat -f

# Vérifier les ressources
htop
df -h
free -h
```

### Dépannage

```bash
# Redémarrer le service
sudo systemctl restart synq-chat

# Vérifier la configuration
sudo nginx -t

# Tester la connectivité
curl -I https://your-domain.com

# Vérifier les ports
netstat -tlnp | grep :3000
```

## Sécurité

### Firewall

```bash
# Configurer UFW
sudo ufw enable
sudo ufw allow ssh
sudo ufw allow 80
sudo ufw allow 443
sudo ufw deny 3000
```

### SSL/TLS

```bash
# Générer un certificat SSL avec Let's Encrypt
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### Mise à jour de sécurité

```bash
# Mettre à jour le système
sudo apt update && sudo apt upgrade -y

# Mettre à jour Node.js
sudo npm install -g n
sudo n stable
```

## Performance

### Optimisation MongoDB

```bash
# Configurer MongoDB pour la production
sudo nano /etc/mongod.conf
```

Ajouter:
```yaml
storage:
  wiredTiger:
    engineConfig:
      cacheSizeGB: 4
    collectionConfig:
      blockCompressor: snappy
    indexConfig:
      prefixCompression: true

operationProfiling:
  slowOpThresholdMs: 100
  mode: slowOp
```

### Optimisation Redis

```bash
# Configurer Redis pour la production
sudo nano /etc/redis/redis.conf
```

Ajouter:
```
maxmemory 2gb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
save 60 10000
```

### Monitoring des performances

```bash
# Installer des outils de monitoring
sudo apt install htop iotop nethogs

# Monitoring MongoDB
mongostat

# Monitoring Redis
redis-cli --stat
```

---

**Synq Chat** est maintenant configuré pour la production avec toutes les fonctionnalités Synq intégrées ! 🚀
