#!/bin/bash

# Script de tests de production pour Synq Chat
# Usage: ./test-production.sh

set -e

# Configuration
BASE_URL="https://your-domain.com"
API_URL="$BASE_URL/api"
HEALTH_URL="$BASE_URL/api/health"

# Couleurs pour les logs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Compteurs
TESTS_PASSED=0
TESTS_FAILED=0
TOTAL_TESTS=0

# Fonctions de logging
log() {
    echo -e "${GREEN}[TEST]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
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

# Fonction de test d'endpoint
test_endpoint() {
    local endpoint=$1
    local expected_status=$2
    local description=$3
    local method=${4:-GET}
    local data=${5:-""}
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    if [ "$method" = "POST" ] && [ -n "$data" ]; then
        response=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
            -H "Content-Type: application/json" \
            -d "$data" \
            "$API_URL$endpoint")
    else
        response=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL$endpoint")
    fi
    
    if [ "$response" = "$expected_status" ]; then
        log "✓ $description - Status: $response"
        TESTS_PASSED=$((TESTS_PASSED + 1))
        return 0
    else
        error "✗ $description - Expected: $expected_status, Got: $response"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        return 1
    fi
}

# Fonction de test de connectivité
test_connectivity() {
    log "Test de connectivité de base..."
    
    # Test de l'endpoint de santé
    test_endpoint "/health" "200" "Endpoint de santé"
    
    # Test de l'endpoint principal
    test_endpoint "/" "200" "Page principale"
    
    # Test de l'API
    test_endpoint "/api/info" "200" "Informations de l'API"
}

# Fonction de test des fonctionnalités Synq
test_synq_features() {
    log "Test des fonctionnalités Synq..."
    
    # Test des analytics
    test_endpoint "/synq/analytics/dashboard" "200" "Tableau de bord analytics"
    test_endpoint "/synq/analytics/metrics" "200" "Métriques analytics"
    test_endpoint "/synq/analytics/reports" "200" "Rapports analytics"
    
    # Test des workflows
    test_endpoint "/synq/workflows" "200" "Liste des workflows"
    test_endpoint "/synq/workflows/templates" "200" "Modèles de workflows"
    
    # Test des notifications
    test_endpoint "/synq/notifications/settings" "200" "Paramètres de notifications"
    test_endpoint "/synq/notifications/history" "200" "Historique des notifications"
    
    # Test des permissions
    test_endpoint "/synq/permissions/roles" "200" "Rôles et permissions"
    test_endpoint "/synq/permissions/audit" "200" "Audit des permissions"
    
    # Test des documents collaboratifs
    test_endpoint "/synq/etherpad/templates" "200" "Modèles Etherpad"
    test_endpoint "/synq/etherpad/documents" "200" "Documents Etherpad"
    
    # Test de l'intégration Jitsi
    test_endpoint "/synq/jitsi/rooms" "200" "Salles Jitsi"
    test_endpoint "/synq/jitsi/config" "200" "Configuration Jitsi"
}

# Fonction de test des performances
test_performance() {
    log "Test des performances..."
    
    # Test de temps de réponse
    local start_time=$(date +%s%N)
    curl -s "$HEALTH_URL" > /dev/null
    local end_time=$(date +%s%N)
    local response_time=$(( (end_time - start_time) / 1000000 ))
    
    if [ $response_time -lt 1000 ]; then
        log "✓ Temps de réponse: ${response_time}ms (excellent)"
    elif [ $response_time -lt 3000 ]; then
        log "✓ Temps de réponse: ${response_time}ms (bon)"
    else
        warning "⚠ Temps de réponse: ${response_time}ms (lent)"
    fi
    
    # Test de charge simple
    log "Test de charge simple..."
    local concurrent_requests=10
    local success_count=0
    
    for i in $(seq 1 $concurrent_requests); do
        if curl -s "$HEALTH_URL" > /dev/null; then
            success_count=$((success_count + 1))
        fi
    done
    
    if [ $success_count -eq $concurrent_requests ]; then
        log "✓ Test de charge: $success_count/$concurrent_requests requêtes réussies"
    else
        warning "⚠ Test de charge: $success_count/$concurrent_requests requêtes réussies"
    fi
}

# Fonction de test de sécurité
test_security() {
    log "Test de sécurité..."
    
    # Test des headers de sécurité
    local headers=$(curl -s -I "$BASE_URL")
    
    if echo "$headers" | grep -q "X-Frame-Options"; then
        log "✓ Header X-Frame-Options présent"
    else
        warning "⚠ Header X-Frame-Options manquant"
    fi
    
    if echo "$headers" | grep -q "X-Content-Type-Options"; then
        log "✓ Header X-Content-Type-Options présent"
    else
        warning "⚠ Header X-Content-Type-Options manquant"
    fi
    
    if echo "$headers" | grep -q "X-XSS-Protection"; then
        log "✓ Header X-XSS-Protection présent"
    else
        warning "⚠ Header X-XSS-Protection manquant"
    fi
    
    if echo "$headers" | grep -q "Strict-Transport-Security"; then
        log "✓ Header Strict-Transport-Security présent"
    else
        warning "⚠ Header Strict-Transport-Security manquant"
    fi
    
    # Test des endpoints sensibles
    test_endpoint "/admin" "403" "Accès admin non autorisé"
    test_endpoint "/api/admin/users" "401" "API admin non autorisée"
}

# Fonction de test de la base de données
test_database() {
    log "Test de la base de données..."
    
    # Test de connectivité MongoDB
    if mongo --eval "db.runCommand('ping')" > /dev/null 2>&1; then
        log "✓ MongoDB connecté"
    else
        error "✗ MongoDB non accessible"
        return 1
    fi
    
    # Test de connectivité Redis
    if redis-cli ping > /dev/null 2>&1; then
        log "✓ Redis connecté"
    else
        error "✗ Redis non accessible"
        return 1
    fi
    
    # Test des collections Synq
    local collections=$(mongo synq_chat --eval "db.getCollectionNames()" --quiet)
    
    if echo "$collections" | grep -q "synq_analytics"; then
        log "✓ Collection synq_analytics présente"
    else
        warning "⚠ Collection synq_analytics manquante"
    fi
    
    if echo "$collections" | grep -q "synq_workflows"; then
        log "✓ Collection synq_workflows présente"
    else
        warning "⚠ Collection synq_workflows manquante"
    fi
    
    if echo "$collections" | grep -q "synq_notifications"; then
        log "✓ Collection synq_notifications présente"
    else
        warning "⚠ Collection synq_notifications manquante"
    fi
}

# Fonction de test des services externes
test_external_services() {
    log "Test des services externes..."
    
    # Test de Keycloak (si activé)
    if [ "$SYNQ_KEYCLOAK_ENABLED" = "true" ]; then
        if curl -s "$SYNQ_KEYCLOAK_SERVER_URL" > /dev/null; then
            log "✓ Keycloak accessible"
        else
            warning "⚠ Keycloak non accessible"
        fi
    else
        info "Keycloak désactivé"
    fi
    
    # Test de Jitsi
    if [ "$SYNQ_JITSI_ENHANCED_ENABLED" = "true" ]; then
        if curl -s "$SYNQ_JITSI_SERVER_URL" > /dev/null; then
            log "✓ Jitsi accessible"
        else
            warning "⚠ Jitsi non accessible"
        fi
    else
        info "Jitsi désactivé"
    fi
    
    # Test d'Etherpad
    if [ "$SYNQ_DOCS_ENABLED" = "true" ]; then
        if curl -s "$SYNQ_DOCS_SERVER_URL" > /dev/null; then
            log "✓ Etherpad accessible"
        else
            warning "⚠ Etherpad non accessible"
        fi
    else
        info "Etherpad désactivé"
    fi
}

# Fonction de test des logs
test_logs() {
    log "Test des logs..."
    
    # Vérifier les logs du service
    if sudo journalctl -u synq-chat --since "1 hour ago" --no-pager | grep -q "ERROR"; then
        warning "⚠ Erreurs trouvées dans les logs du service"
    else
        log "✓ Aucune erreur dans les logs du service"
    fi
    
    # Vérifier les logs Nginx
    if sudo journalctl -u nginx --since "1 hour ago" --no-pager | grep -q "ERROR"; then
        warning "⚠ Erreurs trouvées dans les logs Nginx"
    else
        log "✓ Aucune erreur dans les logs Nginx"
    fi
}

# Fonction de test des ressources système
test_system_resources() {
    log "Test des ressources système..."
    
    # Vérifier l'espace disque
    local disk_usage=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
    if [ $disk_usage -lt 80 ]; then
        log "✓ Espace disque: ${disk_usage}% utilisé"
    else
        warning "⚠ Espace disque: ${disk_usage}% utilisé (élevé)"
    fi
    
    # Vérifier la mémoire
    local memory_usage=$(free | awk 'NR==2{printf "%.0f", $3*100/$2}')
    if [ $memory_usage -lt 90 ]; then
        log "✓ Mémoire: ${memory_usage}% utilisée"
    else
        warning "⚠ Mémoire: ${memory_usage}% utilisée (élevée)"
    fi
    
    # Vérifier la charge CPU
    local load_avg=$(uptime | awk -F'load average:' '{print $2}' | awk '{print $1}' | sed 's/,//')
    local cpu_cores=$(nproc)
    local load_threshold=$(echo "$cpu_cores * 0.8" | bc)
    
    if (( $(echo "$load_avg < $load_threshold" | bc -l) )); then
        log "✓ Charge CPU: $load_avg (normal)"
    else
        warning "⚠ Charge CPU: $load_avg (élevée)"
    fi
}

# Fonction de génération de rapport
generate_report() {
    log "Génération du rapport de tests..."
    
    local report_file="/tmp/synq-production-test-report-$(date +%Y%m%d-%H%M%S).txt"
    
    cat > "$report_file" << EOF
=== RAPPORT DE TESTS DE PRODUCTION SYNQ CHAT ===
Date: $(date)
URL: $BASE_URL

=== RÉSULTATS GÉNÉRAUX ===
Tests réussis: $TESTS_PASSED
Tests échoués: $TESTS_FAILED
Total des tests: $TOTAL_TESTS
Taux de réussite: $(( TESTS_PASSED * 100 / TOTAL_TESTS ))%

=== SYSTÈME ===
OS: $(uname -a)
Node.js: $(node --version)
NPM: $(npm --version)
MongoDB: $(mongo --version | head -n1)
Redis: $(redis-cli --version)

=== SERVICES ===
Synq Chat: $(sudo systemctl is-active synq-chat)
Nginx: $(sudo systemctl is-active nginx)
MongoDB: $(sudo systemctl is-active mongod)
Redis: $(sudo systemctl is-active redis-server)

=== RESSOURCES ===
Espace disque: $(df / | awk 'NR==2 {print $5}')
Mémoire: $(free | awk 'NR==2{printf "%.0f", $3*100/$2}')%
Charge CPU: $(uptime | awk -F'load average:' '{print $2}' | awk '{print $1}')

=== RECOMMANDATIONS ===
EOF
    
    if [ $TESTS_FAILED -gt 0 ]; then
        echo "⚠ Des tests ont échoué. Vérifiez les logs pour plus de détails." >> "$report_file"
    fi
    
    if [ $TESTS_PASSED -eq $TOTAL_TESTS ]; then
        echo "✓ Tous les tests sont passés. Le système fonctionne correctement." >> "$report_file"
    fi
    
    log "Rapport généré: $report_file"
    
    # Afficher le rapport
    cat "$report_file"
}

# Fonction principale
main() {
    log "Début des tests de production pour Synq Chat"
    log "URL de test: $BASE_URL"
    
    # Charger la configuration
    if [ -f ".env.production" ]; then
        source .env.production
        log "Configuration chargée depuis .env.production"
    else
        warning "Fichier .env.production non trouvé"
    fi
    
    # Exécuter tous les tests
    test_connectivity
    test_synq_features
    test_performance
    test_security
    test_database
    test_external_services
    test_logs
    test_system_resources
    
    # Générer le rapport
    generate_report
    
    # Résumé final
    log "=== RÉSUMÉ DES TESTS ==="
    log "Tests réussis: $TESTS_PASSED"
    log "Tests échoués: $TESTS_FAILED"
    log "Total: $TOTAL_TESTS"
    
    if [ $TESTS_FAILED -eq 0 ]; then
        log "🎉 Tous les tests sont passés avec succès!"
        exit 0
    else
        error "❌ $TESTS_FAILED test(s) ont échoué"
        exit 1
    fi
}

# Exécuter les tests
main "$@"
