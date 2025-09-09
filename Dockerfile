# Dockerfile pour Synq Chat (Rocket.Chat fork)
FROM node:22.16.0-alpine

# Installer les dépendances système
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

# Définir le répertoire de travail
WORKDIR /app

# Copier les fichiers de configuration
COPY package.json yarn.lock ./
COPY turbo.json ./

# Activer Corepack et installer les dépendances
RUN corepack enable && yarn install

# Copier le code source (sauf node_modules)
COPY . .

# Réinstaller les dépendances après copie
RUN yarn install

# Construire l'application
RUN yarn build

# Exposer le port
EXPOSE 3000

# Commande de démarrage
CMD ["yarn", "start"]
