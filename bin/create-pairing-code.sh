#!/bin/bash
# Generate a pairing code for the Agent Talk To Me iOS app.
# Run this while the listener is running in another terminal.
#
# Usage:
#   ./bin/create-pairing-code.sh          # Human-readable output
#   ./bin/create-pairing-code.sh --json   # JSON output (for programmatic use)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: .env not found at $ENV_FILE" >&2
  echo "Run 'npm start' first to register and generate credentials." >&2
  exit 1
fi

# Read .env safely (handles unquoted values with spaces)
get_env() {
  grep "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | sed "s/^$1=//" | sed 's/^["'\''"]//;s/["'\''"]$//' || true
}

TOKEN=$(get_env REGISTRATION_TOKEN)
IDENTIFIER=$(get_env LISTENER_IDENTIFIER)
[ -z "$IDENTIFIER" ] && IDENTIFIER=$(get_env IDENTIFIER)
API=$(get_env API_URL)

if [ -z "$TOKEN" ]; then
  echo "Error: REGISTRATION_TOKEN not found in .env" >&2
  echo "Run 'npm start' first to register and generate credentials." >&2
  exit 1
fi

if [ -z "$IDENTIFIER" ]; then
  echo "Error: IDENTIFIER not found in .env" >&2
  echo "Run 'npm start' first to register and generate credentials." >&2
  exit 1
fi

if [ -z "$API" ]; then
  echo "Error: API_URL not found in .env" >&2
  exit 1
fi

RESPONSE=$(curl -s -X POST "$API/api/v1/listeners/$IDENTIFIER/pair" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json")

CODE=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['code'])" 2>/dev/null)
EXPIRES=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['expires_at'])" 2>/dev/null)

if [ -z "$CODE" ]; then
  echo "Error: could not create pairing code." >&2
  echo "API response: $RESPONSE" >&2
  echo "" >&2
  echo "Make sure:" >&2
  echo "  1. The listener has been started at least once (npm start)" >&2
  echo "  2. API_URL ($API) is reachable" >&2
  exit 1
fi

if [ "${1:-}" = "--json" ]; then
  echo "{\"code\": \"$CODE\", \"expires_at\": \"$EXPIRES\"}"
else
  echo "Koppelcode: $CODE (geldig tot $EXPIRES)"
  echo ""
  echo "De gebruiker voert deze code in de Agent Talk To Me iOS-app in."
  echo "De code is 10 minuten geldig."
fi
