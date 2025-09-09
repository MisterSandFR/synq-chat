#!/usr/bin/env bash
set -euo pipefail

ORCH_URL="${ORCH_URL:-https://orchestrator.synq.team}"
ORCH_KEY="${ORCH_KEY:-$ORCH_API_KEY}"
PLAN="${1:-starter}"
DOMAIN="${2:-acme.synq.team}"
ADMIN="${3:-admin@acme.com}"

curl -sS -X POST "$ORCH_URL/api/workspaces" \
  -H "Authorization: Bearer $ORCH_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"plan\":\"$PLAN\",\"domain\":\"$DOMAIN\",\"adminEmail\":\"$ADMIN\"}" | jq .
