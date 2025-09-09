# Fonctionnalités vocales natives Synq Chat

## Vue d'ensemble

Synq Chat intègre maintenant un support natif complet pour les appels audio/vidéo et les salons vocaux statiques, sans dépendance à des services externes comme Jitsi Meet. Cette implémentation utilise WebRTC natif pour offrir une expérience vocale intégrée et performante.

## Fonctionnalités principales

### 🎤 Salles vocales natives
- **Salles persistantes** : Création de salons vocaux statiques (style Discord)
- **Salles temporaires** : Appels à la demande pour discussions ponctuelles
- **Types de salles** : Audio uniquement, vidéo, ou conférence complète
- **Intégration canal** : Chaque canal peut avoir ses propres salles vocales

### 📹 Appels audio/vidéo natifs
- **WebRTC natif** : Pas de dépendance à des services externes
- **Qualité adaptative** : Ajustement automatique selon la connexion
- **Chiffrement** : Communications sécurisées de bout en bout
- **Multi-participants** : Support jusqu'à 50 participants par salle

### 🖥️ Partage d'écran natif
- **Sans extension** : Utilise l'API `getDisplayMedia()` native
- **Audio système** : Partage de l'audio système avec l'écran
- **Contrôles intégrés** : Boutons de contrôle dans l'interface vocale
- **Qualité optimisée** : Compression automatique pour réduire la bande passante

### 💬 Chat intégré
- **Chat en temps réel** : Messages synchronisés avec les appels
- **Notifications** : Alertes pour les événements vocaux
- **Historique** : Conservation des messages pendant les appels
- **Interface unifiée** : Chat et vocal dans la même interface

### 🛡️ Modération et sécurité
- **Contrôles modérateur** : Gestion des participants et permissions
- **Permissions par rôle** : Contrôle d'accès granulaire
- **Logs d'activité** : Traçabilité des événements vocaux
- **Authentification** : Accès sécurisé aux salles vocales

## Architecture technique

### Services backend

#### SynqNativeVoiceService
```typescript
// Service principal pour la gestion des salles vocales
class SynqNativeVoiceService {
  // Création de salles vocales
  createVoiceRoom(channelId: string, roomName?: string, roomType?: 'voice' | 'video' | 'conference')
  
  // Gestion des participants
  joinRoom(roomId: string, userId: string)
  leaveRoom(roomId: string, userId: string)
  
  // Contrôles WebRTC
  createPeerConnection(roomId: string, userId: string)
  toggleParticipantMute(roomId: string, userId: string, muted: boolean)
  toggleParticipantVideo(roomId: string, userId: string, enabled: boolean)
  toggleScreenShare(roomId: string, userId: string, sharing: boolean)
}
```

#### Configuration des paramètres
```typescript
// Paramètres de configuration disponibles
Synq_Native_Voice_Enabled: boolean
Synq_Voice_Persistent_Rooms: boolean
Synq_Voice_Max_Participants: number
Synq_Voice_Screen_Share_Enabled: boolean
Synq_Voice_Chat_Enabled: boolean
Synq_Voice_Encryption_Enabled: boolean
Synq_Voice_Moderation_Enabled: boolean
```

### Composants frontend

#### SynqNativeVoiceRooms
```tsx
// Composant principal pour la gestion des salles
<SynqNativeVoiceRooms
  channelId={channelId}
  rooms={rooms}
  onJoinRoom={handleJoinRoom}
  onLeaveRoom={handleLeaveRoom}
  onCreateRoom={handleCreateRoom}
  onDeleteRoom={handleDeleteRoom}
  currentRoom={currentRoom}
/>
```

#### NativeVoiceRoomInterface
```tsx
// Interface d'appel avec contrôles WebRTC
<NativeVoiceRoomInterface
  roomId={roomId}
  participantId={participantId}
  userInfo={userInfo}
  webrtcConfig={webrtcConfig}
  onLeaveRoom={handleLeaveRoom}
/>
```

## Configuration et déploiement

### 1. Activation des fonctionnalités

Dans l'interface d'administration :
1. Aller dans **Administration** > **Paramètres** > **Synq Native Voice**
2. Activer `Synq_Native_Voice_Enabled`
3. Configurer les paramètres selon vos besoins

### 2. Configuration WebRTC

#### Serveurs STUN/TURN
```javascript
// Configuration des serveurs ICE
WebRTC_Servers: "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302"
```

#### Serveurs TURN (optionnel)
```javascript
// Pour les environnements avec NAT strict
WebRTC_Servers: "username:password@turn:your-turn-server.com:3478"
```

### 3. Permissions

Configurer les permissions par rôle :
- `create-voice-rooms` : Créer des salles vocales
- `join-voice-rooms` : Rejoindre des salles vocales
- `moderate-voice-rooms` : Modérer les salles vocales
- `delete-voice-rooms` : Supprimer des salles vocales

### 4. Salles par défaut

Configuration JSON pour créer des salles automatiquement :
```json
[
  {
    "channelId": "GENERAL",
    "name": "Général - Voice",
    "roomType": "voice"
  },
  {
    "channelId": "DEVELOPMENT",
    "name": "Dev - Conference",
    "roomType": "conference"
  }
]
```

## API REST

### Endpoints disponibles

#### Gestion des salles
```http
GET    /api/v1/synq/voice/rooms              # Liste des salles actives
POST   /api/v1/synq/voice/rooms              # Créer une salle
GET    /api/v1/synq/voice/rooms/:roomId      # Informations d'une salle
DELETE /api/v1/synq/voice/rooms/:roomId      # Supprimer une salle
```

#### Gestion des participants
```http
POST   /api/v1/synq/voice/rooms/:roomId/join        # Rejoindre une salle
POST   /api/v1/synq/voice/rooms/:roomId/leave       # Quitter une salle
GET    /api/v1/synq/voice/rooms/:roomId/participants # Participants d'une salle
```

### Exemples d'utilisation

#### Créer une salle vocale
```bash
curl -X POST http://localhost:3000/api/v1/synq/voice/rooms \
  -H "Content-Type: application/json" \
  -H "X-Auth-Token: YOUR_TOKEN" \
  -H "X-User-Id: YOUR_USER_ID" \
  -d '{
    "channelId": "GENERAL",
    "roomName": "Réunion équipe",
    "roomType": "conference"
  }'
```

#### Rejoindre une salle
```bash
curl -X POST http://localhost:3000/api/v1/synq/voice/rooms/ROOM_ID/join \
  -H "X-Auth-Token: YOUR_TOKEN" \
  -H "X-User-Id: YOUR_USER_ID"
```

## Méthodes Meteor

### Méthodes disponibles

```javascript
// Gestion des salles
Meteor.call('synq.voice.create-room', channelId, roomName, roomType)
Meteor.call('synq.voice.join-room', roomId)
Meteor.call('synq.voice.leave-room', roomId)
Meteor.call('synq.voice.get-room-info', roomId)
Meteor.call('synq.voice.get-room-participants', roomId)
Meteor.call('synq.voice.get-active-rooms')
Meteor.call('synq.voice.get-channel-rooms', channelId)

// Contrôles des participants
Meteor.call('synq.voice.toggle-mute', roomId, userId, muted)
Meteor.call('synq.voice.toggle-video', roomId, userId, enabled)
Meteor.call('synq.voice.toggle-screen-share', roomId, userId, sharing)
```

## Intégration avec l'interface

### Ajout aux canaux

Les salles vocales apparaissent automatiquement dans les canaux avec :
- Bouton "Créer une salle vocale"
- Liste des salles actives
- Indicateurs de participants en temps réel
- Notifications d'événements vocaux

### Interface d'appel

L'interface d'appel offre :
- Contrôles audio/vidéo
- Partage d'écran
- Chat intégré
- Liste des participants
- Indicateurs de qualité de connexion

## Monitoring et statistiques

### Métriques disponibles

```javascript
// Statistiques des salles vocales
{
  voiceRooms: {
    total: number,           // Nombre total de salles
    active: number,         // Salles actives
    totalParticipants: number, // Participants totaux
    averageParticipantsPerRoom: number
  }
}
```

### Logs et événements

- Création/suppression de salles
- Rejoindre/quitter des salles
- Changements d'état des participants
- Erreurs de connexion WebRTC
- Activité de modération

## Sécurité et confidentialité

### Chiffrement
- Communications chiffrées de bout en bout
- Clés de chiffrement générées dynamiquement
- Support des certificats SSL/TLS

### Authentification
- Authentification requise pour rejoindre les salles
- Vérification des permissions par rôle
- Sessions sécurisées

### Modération
- Contrôles de modération intégrés
- Logs d'activité détaillés
- Système de permissions granulaire

## Performance et optimisation

### Qualité adaptative
- Ajustement automatique de la qualité selon la bande passante
- Compression audio/vidéo intelligente
- Optimisation pour différents types de connexion

### Ressources
- Gestion optimisée de la mémoire
- Nettoyage automatique des connexions fermées
- Limitation du nombre de participants par salle

## Dépannage

### Problèmes courants

#### Connexion WebRTC échoue
- Vérifier la configuration des serveurs STUN/TURN
- S'assurer que les ports WebRTC sont ouverts
- Vérifier les paramètres de pare-feu

#### Partage d'écran ne fonctionne pas
- Vérifier que `Synq_Voice_Screen_Share_Enabled` est activé
- S'assurer que le navigateur supporte `getDisplayMedia()`
- Vérifier les permissions du navigateur

#### Qualité audio/vidéo médiocre
- Ajuster les paramètres de qualité dans la configuration
- Vérifier la bande passante disponible
- Configurer des serveurs TURN pour les environnements NAT

### Logs de débogage

Activer les logs détaillés :
```javascript
Synq_Voice_Debug_Enabled: true
Synq_Voice_Log_Level: "debug"
```

## Migration depuis Jitsi

### Processus de migration

1. **Sauvegarde** : Exporter les salles Jitsi existantes
2. **Configuration** : Activer le service vocal natif
3. **Migration** : Utiliser le script de migration automatique
4. **Test** : Vérifier le fonctionnement des salles migrées
5. **Déploiement** : Basculer vers le service natif

### Script de migration

```bash
# Exécuter le script de migration
./scripts/migrate-jitsi-to-native.sh
```

## Support et contribution

### Documentation
- [Guide d'installation](docs/installation.md)
- [Guide de configuration](docs/configuration.md)
- [API Reference](docs/api.md)
- [Troubleshooting](docs/troubleshooting.md)

### Tests
```bash
# Exécuter les tests des fonctionnalités vocales
./test-voice-features.sh
```

### Contribution
- Signaler les bugs via GitHub Issues
- Proposer des améliorations via Pull Requests
- Participer aux discussions de la communauté

## Changelog

### Version 1.0.0
- ✅ Service vocal natif complet
- ✅ Salles vocales persistantes
- ✅ Partage d'écran natif
- ✅ Chat intégré
- ✅ Modération et permissions
- ✅ API REST complète
- ✅ Interface utilisateur moderne
- ✅ Support multi-navigateurs
- ✅ Chiffrement de bout en bout
- ✅ Statistiques et monitoring

---

**Synq Chat** - Communication vocale native intégrée 🎤
