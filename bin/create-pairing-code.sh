#!/bin/bash
# Generate a pairing code for the Agent Talk To Me iOS app.
# Run this while the listener is running in another terminal.
#
# Usage:
#   ./bin/create-pairing-code.sh          # Human-readable output
#   ./bin/create-pairing-code.sh --json   # JSON output (for programmatic use)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$SCRIPT_DIR/.env"

TOKEN="${REGISTRATION_TOKEN:?REGISTRATION_TOKEN not set in .env — start the listener first with 'npm start'}"
IDENTIFIER="${LISTENER_IDENTIFIER:-${IDENTIFIER:?IDENTIFIER not set in .env — start the listener first with 'npm start'}}"
API="${API_URL:?API_URL not set in .env}"

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
  echo "  2. REGISTRATION_TOKEN and IDENTIFIER are set in .env" >&2
  echo "  3. API_URL ($API) is reachable" >&2
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
