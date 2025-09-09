# Solution pour l'erreur de build Docker Synq Chat

## Problème identifié

L'erreur suivante se produisait lors du build Docker :

```
@rocket.chat/apps-engine:build: /bin/sh: deno: not found
@rocket.chat/apps-engine:build: Could not execute "deno" in the system. It is now a requirement for the Apps-Engine framework, and Rocket.Chat apps will not work without it.
```

## Cause

Le package `@rocket.chat/apps-engine` nécessite Deno pour fonctionner. Le script de build `packages/apps-engine/scripts/deno-cache.js` exécute `deno cache main.ts` dans le répertoire `deno-runtime`, mais Deno n'était pas correctement installé dans le conteneur Docker.

## Solution appliquée

### 1. Correction du Dockerfile

**Avant :**
```dockerfile
# Installer Deno pour apps-engine
RUN curl -fsSL https://deno.land/install.sh | sh
ENV DENO_INSTALL="/root/.deno"
ENV PATH="$DENO_INSTALL/bin:$PATH"
```

**Après :**
```dockerfile
# Installer les dépendances système (incluant Deno)
RUN apk add --no-cache \
    curl \
    bash \
    git \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    musl-dev \
    giflib-dev \
    pixman-dev \
    pangomm-dev \
    libjpeg-turbo-dev \
    freetype-dev \
    deno

# Vérifier l'installation de Deno
RUN deno --version
```

### 2. Avantages de cette approche

- **Plus fiable** : Utilise le gestionnaire de paquets Alpine (`apk`) au lieu d'un script d'installation externe
- **Plus rapide** : Pas besoin de télécharger et exécuter un script d'installation
- **Plus sécurisé** : Utilise les paquets officiels d'Alpine Linux
- **Cohérent** : Suit la même approche que le Dockerfile officiel de Rocket.Chat

### 3. Script de test

Un script `test-build.sh` a été créé pour tester le build localement avant de construire l'image Docker.

## Utilisation

### Build Docker
```bash
docker build -t synq-chat:latest .
```

### Test local (sans Docker)
```bash
./test-build.sh
```

## Vérification

Après la correction, le build devrait se terminer avec succès et vous devriez voir :

```
@rocket.chat/apps-engine:build: ✅ Build apps-engine réussi
```

Au lieu de l'erreur précédente.

## Notes techniques

- Le package `apps-engine` utilise Deno pour exécuter des applications Rocket.Chat
- Le script `deno-cache.js` pré-cache les dépendances Deno pour améliorer les performances
- Cette correction est compatible avec toutes les versions récentes de Deno
