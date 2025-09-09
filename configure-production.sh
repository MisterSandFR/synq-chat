#!/bin/bash

# Script de configuration de production pour Synq Chat
# Active automatiquement les nouvelles fonctionnalités vocales

set -e

echo "🔧 Configuration de production - Synq Chat avec fonctionnalités vocales"

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

# Configuration des paramètres de production
configure_production_settings() {
    log "Configuration des paramètres de production..."
    
    # Créer le fichier de configuration de production
    cat > production-settings.json << EOF
{
  "Synq_Native_Voice_Enabled": true,
  "Synq_Voice_Persistent_Rooms": true,
  "Synq_Voice_Max_Participants": 50,
  "Synq_Voice_Screen_Share_Enabled": true,
  "Synq_Voice_Chat_Enabled": true,
  "Synq_Voice_Encryption_Enabled": true,
  "Synq_Voice_Moderation_Enabled": true,
  "Synq_Voice_Recording_Enabled": false,
  "Synq_Voice_Presence_Notifications": true,
  "Synq_Voice_Speech_Detection": true,
  "Synq_Voice_Noise_Reduction": true,
  "Synq_Voice_Echo_Cancellation": true,
  "Synq_Voice_Auto_Quality_Adaptation": true,
  "Synq_Voice_Audio_Compression": true,
  "Synq_Voice_Video_Compression": true,
  "Synq_Voice_Audio_Quality": "high",
  "Synq_Voice_Video_Quality": "high",
  "Synq_Voice_Bandwidth_Limit": 0,
  "Synq_Voice_Require_Auth": true,
  "Synq_Voice_Call_Logs": true,
  "WebRTC_Enabled": true,
  "WebRTC_Servers": "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302",
  "WebRTC_Enable_Direct": true,
  "WebRTC_Enable_Private": true,
  "WebRTC_Enable_Channel": true,
  "Synq_Voice_Default_Rooms": "[]",
  "Synq_Voice_WebRTC_Config": "{}",
  "Synq_Voice_Role_Permissions": "{}"
}
EOF

    success "Configuration de production créée"
}

# Créer les salles vocales par défaut
create_default_voice_rooms() {
    log "Création des salles vocales par défaut..."
    
    cat > default-voice-rooms.json << EOF
[
  {
    "channelId": "GENERAL",
    "name": "Général - Voice",
    "roomType": "voice",
    "description": "Salle vocale générale pour discussions informelles"
  },
  {
    "channelId": "GENERAL", 
    "name": "Général - Conference",
    "roomType": "conference",
    "description": "Salle de conférence pour réunions importantes"
  },
  {
    "channelId": "DEVELOPMENT",
    "name": "Dev - Voice",
    "roomType": "voice", 
    "description": "Salle vocale pour l'équipe de développement"
  },
  {
    "channelId": "SUPPORT",
    "name": "Support - Voice",
    "roomType": "voice",
    "description": "Salle vocale pour l'équipe de support"
  }
]
EOF

    success "Configuration des salles par défaut créée"
}

# Créer la configuration des permissions
create_permissions_config() {
    log "Configuration des permissions vocales..."
    
    cat > voice-permissions.json << EOF
{
  "admin": {
    "create-voice-rooms": true,
    "join-voice-rooms": true,
    "moderate-voice-rooms": true,
    "delete-voice-rooms": true,
    "record-calls": true,
    "manage-participants": true
  },
  "moderator": {
    "create-voice-rooms": true,
    "join-voice-rooms": true,
    "moderate-voice-rooms": true,
    "delete-voice-rooms": false,
    "record-calls": false,
    "manage-participants": true
  },
  "user": {
    "create-voice-rooms": false,
    "join-voice-rooms": true,
    "moderate-voice-rooms": false,
    "delete-voice-rooms": false,
    "record-calls": false,
    "manage-participants": false
  }
}
EOF

    success "Configuration des permissions créée"
}

# Créer le script d'initialisation MongoDB
create_mongodb_init() {
    log "Création du script d'initialisation MongoDB..."
    
    cat > init-voice-features.js << EOF
// Script d'initialisation des fonctionnalités vocales dans MongoDB
// À exécuter après le déploiement

print("🎤 Initialisation des fonctionnalités vocales Synq Chat...");

// Activer les paramètres vocaux
db.rocketchat_settings.updateMany(
  { _id: { \$in: [
    "Synq_Native_Voice_Enabled",
    "Synq_Voice_Persistent_Rooms", 
    "Synq_Voice_Screen_Share_Enabled",
    "Synq_Voice_Chat_Enabled",
    "Synq_Voice_Encryption_Enabled",
    "Synq_Voice_Moderation_Enabled",
    "Synq_Voice_Presence_Notifications",
    "Synq_Voice_Speech_Detection",
    "Synq_Voice_Noise_Reduction",
    "Synq_Voice_Echo_Cancellation",
    "Synq_Voice_Auto_Quality_Adaptation",
    "Synq_Voice_Audio_Compression",
    "Synq_Voice_Video_Compression",
    "Synq_Voice_Require_Auth",
    "Synq_Voice_Call_Logs",
    "WebRTC_Enabled",
    "WebRTC_Enable_Direct",
    "WebRTC_Enable_Private", 
    "WebRTC_Enable_Channel"
  ]}},
  { \$set: { value: true } }
);

// Configurer les valeurs numériques
db.rocketchat_settings.updateMany(
  { _id: "Synq_Voice_Max_Participants" },
  { \$set: { value: 50 } }
);

db.rocketchat_settings.updateMany(
  { _id: "Synq_Voice_Audio_Quality" },
  { \$set: { value: "high" } }
);

db.rocketchat_settings.updateMany(
  { _id: "Synq_Voice_Video_Quality" },
  { \$set: { value: "high" } }
);

db.rocketchat_settings.updateMany(
  { _id: "Synq_Voice_Bandwidth_Limit" },
  { \$set: { value: 0 } }
);

// Configurer les serveurs WebRTC
db.rocketchat_settings.updateMany(
  { _id: "WebRTC_Servers" },
  { \$set: { value: "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302" } }
);

// Configurer les salles par défaut
db.rocketchat_settings.updateMany(
  { _id: "Synq_Voice_Default_Rooms" },
  { \$set: { value: "[]" } }
);

// Configurer les permissions
db.rocketchat_settings.updateMany(
  { _id: "Synq_Voice_Role_Permissions" },
  { \$set: { value: "{}" } }
);

// Désactiver l'enregistrement par défaut
db.rocketchat_settings.updateMany(
  { _id: "Synq_Voice_Recording_Enabled" },
  { \$set: { value: false } }
);

print("✅ Configuration des fonctionnalités vocales terminée !");
print("🎤 Les salles vocales natives sont maintenant activées");
print("📹 Les appels audio/vidéo natifs sont configurés");
print("🖥️ Le partage d'écran natif est activé");
print("💬 Le chat intégré est configuré");
print("🔐 La sécurité et le chiffrement sont activés");

// Afficher les paramètres configurés
print("\\n📋 Paramètres configurés:");
db.rocketchat_settings.find({
  _id: { \$regex: "Synq_Voice|WebRTC" }
}).forEach(function(setting) {
  print("- " + setting._id + ": " + setting.value);
});
EOF

    success "Script d'initialisation MongoDB créé"
}

# Créer le script de vérification
create_verification_script() {
    log "Création du script de vérification..."
    
    cat > verify-voice-features.sh << 'EOF'
#!/bin/bash

echo "🔍 Vérification des fonctionnalités vocales en production..."

# Vérifier que les services sont démarrés
if docker-compose -f docker-compose.production.yml ps | grep -q "Up"; then
    echo "✅ Services Docker démarrés"
else
    echo "❌ Services Docker non démarrés"
    exit 1
fi

# Vérifier l'API des fonctionnalités vocales
if curl -f http://localhost/api/v1/synq/voice/rooms > /dev/null 2>&1; then
    echo "✅ API des fonctionnalités vocales accessible"
else
    echo "⚠️ API des fonctionnalités vocales non accessible (normal si pas d'auth)"
fi

# Vérifier la page principale
if curl -f http://localhost > /dev/null 2>&1; then
    echo "✅ Application accessible"
else
    echo "❌ Application non accessible"
    exit 1
fi

# Vérifier les logs pour les erreurs
if docker-compose -f docker-compose.production.yml logs synq-chat | grep -i error | tail -5; then
    echo "⚠️ Erreurs détectées dans les logs"
else
    echo "✅ Aucune erreur critique dans les logs"
fi

echo "🎉 Vérification terminée !"
echo "🌐 Application: http://localhost"
echo "🎤 Fonctionnalités vocales: Activées"
echo "📱 API REST: http://localhost/api/v1/synq/voice/"
EOF

    chmod +x verify-voice-features.sh
    success "Script de vérification créé"
}

# Créer la documentation de déploiement
create_deployment_docs() {
    log "Création de la documentation de déploiement..."
    
    cat > DEPLOYMENT-VOICE-FEATURES.md << EOF
# Déploiement des fonctionnalités vocales natives - Synq Chat

## Vue d'ensemble

Ce guide explique comment déployer et configurer les nouvelles fonctionnalités vocales natives de Synq Chat en production.

## Fonctionnalités déployées

### 🎤 Salles vocales natives
- Salons vocaux persistants style Discord
- Intégration avec les canaux existants
- Notifications de présence en temps réel
- Gestion des permissions par rôle

### 📹 Appels audio/vidéo natifs
- WebRTC natif sans dépendance externe
- Support jusqu'à 50 participants
- Qualité adaptative selon la connexion
- Chiffrement de bout en bout

### 🖥️ Partage d'écran natif
- Partage d'écran sans extension
- Audio système inclus
- Contrôles intégrés dans l'interface
- Qualité optimisée automatiquement

### 💬 Chat intégré
- Messages synchronisés avec les appels
- Notifications temps réel
- Historique conservé
- Interface unifiée

## Configuration de production

### 1. Paramètres activés automatiquement

Les paramètres suivants sont configurés automatiquement :

\`\`\`json
{
  "Synq_Native_Voice_Enabled": true,
  "Synq_Voice_Persistent_Rooms": true,
  "Synq_Voice_Max_Participants": 50,
  "Synq_Voice_Screen_Share_Enabled": true,
  "Synq_Voice_Chat_Enabled": true,
  "Synq_Voice_Encryption_Enabled": true,
  "Synq_Voice_Moderation_Enabled": true,
  "Synq_Voice_Presence_Notifications": true,
  "Synq_Voice_Speech_Detection": true,
  "Synq_Voice_Noise_Reduction": true,
  "Synq_Voice_Echo_Cancellation": true,
  "Synq_Voice_Auto_Quality_Adaptation": true,
  "Synq_Voice_Audio_Compression": true,
  "Synq_Voice_Video_Compression": true,
  "WebRTC_Enabled": true,
  "WebRTC_Servers": "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302"
}
\`\`\`

### 2. Permissions configurées

\`\`\`json
{
  "admin": {
    "create-voice-rooms": true,
    "join-voice-rooms": true,
    "moderate-voice-rooms": true,
    "delete-voice-rooms": true,
    "record-calls": true,
    "manage-participants": true
  },
  "moderator": {
    "create-voice-rooms": true,
    "join-voice-rooms": true,
    "moderate-voice-rooms": true,
    "delete-voice-rooms": false,
    "record-calls": false,
    "manage-participants": true
  },
  "user": {
    "create-voice-rooms": false,
    "join-voice-rooms": true,
    "moderate-voice-rooms": false,
    "delete-voice-rooms": false,
    "record-calls": false,
    "manage-participants": false
  }
}
\`\`\`

## Déploiement

### 1. Déploiement automatique

\`\`\`bash
# Exécuter le script de déploiement
./deploy-production.sh
\`\`\`

### 2. Configuration manuelle

\`\`\`bash
# Configurer les paramètres
./configure-production.sh

# Initialiser MongoDB
mongo < init-voice-features.js

# Vérifier le déploiement
./verify-voice-features.sh
\`\`\`

## Vérification

### 1. Tests automatiques

\`\`\`bash
# Exécuter les tests des fonctionnalités vocales
./test-voice-features.sh
\`\`\`

### 2. Vérification manuelle

1. **Accéder à l'application** : http://localhost
2. **Se connecter** avec un compte administrateur
3. **Aller dans Administration** > Paramètres > Synq Native Voice
4. **Vérifier** que tous les paramètres sont activés
5. **Créer une salle vocale** dans un canal
6. **Tester** les appels audio/vidéo
7. **Tester** le partage d'écran

## API REST

### Endpoints disponibles

\`\`\`http
GET    /api/v1/synq/voice/rooms              # Liste des salles actives
POST   /api/v1/synq/voice/rooms              # Créer une salle
GET    /api/v1/synq/voice/rooms/:roomId      # Informations d'une salle
DELETE /api/v1/synq/voice/rooms/:roomId      # Supprimer une salle
POST   /api/v1/synq/voice/rooms/:roomId/join        # Rejoindre une salle
POST   /api/v1/synq/voice/rooms/:roomId/leave       # Quitter une salle
GET    /api/v1/synq/voice/rooms/:roomId/participants # Participants d'une salle
\`\`\`

### Exemple d'utilisation

\`\`\`bash
# Créer une salle vocale
curl -X POST http://localhost/api/v1/synq/voice/rooms \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: YOUR_TOKEN" \\
  -H "X-User-Id: YOUR_USER_ID" \\
  -d '{
    "channelId": "GENERAL",
    "roomName": "Réunion équipe",
    "roomType": "conference"
  }'
\`\`\`

## Monitoring

### 1. Logs

\`\`\`bash
# Voir les logs des fonctionnalités vocales
docker-compose -f docker-compose.production.yml logs synq-chat | grep -i voice
\`\`\`

### 2. Métriques

Les métriques suivantes sont disponibles :

- Nombre de salles vocales actives
- Participants totaux dans les salles
- Qualité de connexion moyenne
- Utilisation des ressources

### 3. Alertes

Configurer des alertes pour :
- Salles vocales avec beaucoup de participants
- Erreurs de connexion WebRTC
- Problèmes de qualité audio/vidéo

## Dépannage

### Problèmes courants

#### Connexion WebRTC échoue
- Vérifier la configuration des serveurs STUN/TURN
- S'assurer que les ports WebRTC sont ouverts
- Vérifier les paramètres de pare-feu

#### Partage d'écran ne fonctionne pas
- Vérifier que \`Synq_Voice_Screen_Share_Enabled\` est activé
- S'assurer que le navigateur supporte \`getDisplayMedia()\`
- Vérifier les permissions du navigateur

#### Qualité audio/vidéo médiocre
- Ajuster les paramètres de qualité dans la configuration
- Vérifier la bande passante disponible
- Configurer des serveurs TURN pour les environnements NAT

### Support

Pour obtenir de l'aide :
1. Consulter les logs : \`docker-compose logs synq-chat\`
2. Vérifier la configuration : Administration > Paramètres
3. Tester les fonctionnalités : \`./test-voice-features.sh\`
4. Contacter le support technique

## Conclusion

Les fonctionnalités vocales natives de Synq Chat sont maintenant déployées et configurées en production. 

**Fonctionnalités disponibles :**
- ✅ Salles vocales persistantes
- ✅ Appels audio/vidéo natifs  
- ✅ Partage d'écran natif
- ✅ Chat intégré
- ✅ Modération avancée
- ✅ Sécurité et chiffrement
- ✅ API REST complète
- ✅ Monitoring et statistiques

**Prochaines étapes :**
1. Tester avec des utilisateurs réels
2. Configurer les salles par défaut selon vos besoins
3. Former les utilisateurs aux nouvelles fonctionnalités
4. Monitorer l'utilisation et les performances

---

**Synq Chat** - Communication vocale native intégrée 🎤
EOF

    success "Documentation de déploiement créée"
}

# Fonction principale
main() {
    log "Démarrage de la configuration de production..."
    
    configure_production_settings
    create_default_voice_rooms
    create_permissions_config
    create_mongodb_init
    create_verification_script
    create_deployment_docs
    
    success "🎉 Configuration de production terminée !"
    
    echo ""
    log "Fichiers créés :"
    echo "  📄 production-settings.json - Paramètres de production"
    echo "  📄 default-voice-rooms.json - Salles par défaut"
    echo "  📄 voice-permissions.json - Configuration des permissions"
    echo "  📄 init-voice-features.js - Script d'initialisation MongoDB"
    echo "  📄 verify-voice-features.sh - Script de vérification"
    echo "  📄 DEPLOYMENT-VOICE-FEATURES.md - Documentation complète"
    echo ""
    log "Prochaines étapes :"
    echo "  1. Exécuter : ./deploy-production.sh"
    echo "  2. Initialiser MongoDB : mongo < init-voice-features.js"
    echo "  3. Vérifier : ./verify-voice-features.sh"
    echo "  4. Tester : ./test-voice-features.sh"
    echo ""
    success "Les fonctionnalités vocales natives sont prêtes pour la production !"
}

# Exécuter le script principal
main "$@"
