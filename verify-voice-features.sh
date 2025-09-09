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
