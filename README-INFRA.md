# Synq Infra (VPS-1)

## Vue d'ensemble

Cette infrastructure permet de déployer automatiquement des instances Synq Chat via un orchestrateur centralisé. L'orchestrateur utilise Traefik comme reverse proxy avec certificats SSL automatiques via Let's Encrypt.

## Architecture

```
VPS-1 (Infrastructure)
├── Traefik (Reverse Proxy + SSL)
├── Orchestrator (API de provisionnement)
└── Workspaces (Instances Synq Chat)
    ├── workspace-1/
    ├── workspace-2/
    └── ...
```

## Installation

### 1. Préparation du VPS

```bash
# Installer Docker et Docker Compose
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Installer Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

### 2. Configuration DNS

Pointez `*.synq.team` vers l'IP de votre VPS :
```
*.synq.team    A    YOUR_VPS_IP
```

### 3. Déploiement de l'Infrastructure

```bash
# Cloner le repository
git clone https://github.com/MisterSandFR/synq-chat.git
cd synq-chat/infra

# Configurer l'environnement
cp env.example .env
nano .env
```

Éditer `.env` :
```bash
# Traefik ACME
ACME_EMAIL=admin@synq.team

# Orchestrator public FQDN
ORCH_FQDN=orchestrator.synq.team

# Orchestrator API key (must match orchestrator/.env)
ORCH_API_KEY=sk_orch_xxx
```

### 4. Créer les Dossiers Nécessaires

```bash
# Créer les dossiers de travail
mkdir -p workspaces templates

# Le template est déjà présent dans templates/rocketchat.compose.yml
```

### 5. Démarrer l'Infrastructure

```bash
# Démarrer Traefik + Orchestrator
docker compose up -d --build

# Vérifier le statut
docker compose ps
```

## Utilisation

### Provisionner un Workspace

```bash
# Configurer la clé API
export ORCH_API_KEY=sk_orch_xxx

# Provisionner un workspace
./scripts/provision_workspace.sh starter acme.synq.team admin@acme.com
```

### Configurer le Branding

```bash
# Seeder le branding et les canaux par défaut
node ./scripts/seed_rc_branding.mjs https://acme.synq.team admin adminpass
```

## API de l'Orchestrateur

### Endpoints Disponibles

#### `GET /api/health`
Vérifier le statut de l'orchestrateur.

#### `POST /api/workspaces`
Créer un nouveau workspace.

**Headers :**
```
Authorization: Bearer sk_orch_xxx
Content-Type: application/json
```

**Body :**
```json
{
  "plan": "starter",
  "domain": "acme.synq.team",
  "adminEmail": "admin@acme.com"
}
```

**Response :**
```json
{
  "id": "acme",
  "status": "queued"
}
```

#### `GET /api/workspaces/:id`
Vérifier le statut d'un workspace.

**Headers :**
```
Authorization: Bearer sk_orch_xxx
```

**Response :**
```json
{
  "id": "acme",
  "status": "ready"
}
```

## Configuration Avancée

### Variables d'Environnement de l'Orchestrateur

```bash
PORT=8081                                    # Port de l'API
ORCH_API_KEY=sk_orch_xxx                    # Clé API
VERCEL_WEBHOOK_URL=https://synq.team/api/webhooks/orchestrator
JITSI_DOMAIN=meet.jit.si                    # Domaine Jitsi
WORKSPACES_ROOT=/opt/synq/infra/workspaces  # Dossier des workspaces
TEMPLATE_PATH=/opt/synq/infra/templates/rocketchat.compose.yml
```

### Personnalisation du Template

Le template `templates/rocketchat.compose.yml` peut être modifié pour :

- Changer l'image Rocket.Chat vers Synq Chat
- Ajouter des services supplémentaires
- Modifier la configuration MongoDB
- Ajouter des volumes persistants

### Monitoring

```bash
# Voir les logs de l'orchestrateur
docker compose logs -f orchestrator

# Voir les logs de Traefik
docker compose logs -f traefik

# Statut des workspaces
docker compose -f workspaces/acme/docker-compose.yml ps
```

## Sécurité

### Firewall (UFW)

```bash
# Configurer UFW
sudo ufw enable
sudo ufw allow ssh
sudo ufw allow 80
sudo ufw allow 443
sudo ufw deny 3000  # Bloquer l'accès direct à Rocket.Chat
```

### Clés API

- Changez la clé API par défaut `sk_orch_xxx`
- Utilisez des clés fortes et uniques
- Limitez l'accès à l'orchestrateur par IP si nécessaire

## Maintenance

### Sauvegarde

```bash
# Sauvegarder les workspaces
tar -czf workspaces-backup-$(date +%Y%m%d).tar.gz workspaces/

# Sauvegarder les certificats SSL
docker run --rm -v traefik_letsencrypt:/data alpine tar czf - /data > letsencrypt-backup.tar.gz
```

### Mise à Jour

```bash
# Mettre à jour l'orchestrateur
cd orchestrator
git pull
docker compose -f ../infra/docker-compose.yml build orchestrator
docker compose -f ../infra/docker-compose.yml up -d orchestrator
```

### Nettoyage

```bash
# Supprimer un workspace
rm -rf workspaces/acme/
docker volume prune -f
```

## Dépannage

### Problèmes Courants

1. **Certificats SSL non générés**
   - Vérifiez que le DNS pointe vers le VPS
   - Vérifiez les logs Traefik : `docker compose logs traefik`

2. **Workspace ne démarre pas**
   - Vérifiez les logs : `docker compose -f workspaces/acme/docker-compose.yml logs`
   - Vérifiez la connectivité MongoDB

3. **Orchestrateur inaccessible**
   - Vérifiez que Traefik fonctionne
   - Vérifiez les labels Docker

### Logs Utiles

```bash
# Logs de l'orchestrateur
docker compose logs orchestrator

# Logs de Traefik
docker compose logs traefik

# Logs d'un workspace spécifique
docker compose -f workspaces/acme/docker-compose.yml logs
```

## Intégration avec Synq.Team

L'orchestrateur peut être intégré avec le frontend Synq.Team pour :

- Provisionner automatiquement des workspaces
- Gérer les abonnements
- Surveiller l'utilisation
- Facturer les clients

### Webhook

L'orchestrateur envoie des webhooks vers `https://synq.team/api/webhooks/orchestrator` quand un workspace est prêt :

```json
{
  "id": "acme",
  "status": "ready",
  "fqdn": "acme.synq.team",
  "adminUrl": "https://acme.synq.team/admin",
  "plan": "starter",
  "adminEmail": "admin@acme.com"
}
```

---

**Synq Infra** - Infrastructure automatisée pour Synq Chat 🚀
