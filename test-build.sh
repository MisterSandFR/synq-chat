#!/bin/bash

# Script de test pour vérifier le build Synq Chat
# Ce script teste le processus de build sans Docker

set -e

echo "🔧 Test du build Synq Chat..."

# Vérifier les prérequis
echo "📋 Vérification des prérequis..."

# Vérifier Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js n'est pas installé"
    exit 1
fi
echo "✅ Node.js: $(node --version)"

# Vérifier Yarn
if ! command -v yarn &> /dev/null; then
    echo "❌ Yarn n'est pas installé"
    exit 1
fi
echo "✅ Yarn: $(yarn --version)"

# Vérifier Deno
if ! command -v deno &> /dev/null; then
    echo "❌ Deno n'est pas installé"
    echo "💡 Installation de Deno..."
    curl -fsSL https://deno.land/install.sh | sh
    export DENO_INSTALL="$HOME/.deno"
    export PATH="$DENO_INSTALL/bin:$PATH"
fi
echo "✅ Deno: $(deno --version)"

# Installer les dépendances
echo "📦 Installation des dépendances..."
yarn install

# Test du build apps-engine spécifiquement
echo "🔨 Test du build apps-engine..."
cd packages/apps-engine
yarn build
echo "✅ Build apps-engine réussi"

# Retour au répertoire racine
cd ../..

# Test du build complet
echo "🔨 Test du build complet..."
yarn build
echo "✅ Build complet réussi"

echo "🎉 Tous les tests de build sont passés avec succès!"
echo ""
echo "💡 Le Dockerfile corrigé devrait maintenant fonctionner."
echo "   Pour tester avec Docker:"
echo "   docker build -t synq-chat:latest ."
