#!/usr/bin/env bash
# Quick test script for the express-streaming example
# Usage: ./test-chat.sh [port]

PORT="${1:-3007}"
BASE_URL="http://localhost:${PORT}"

echo "=== express-streaming test ==="
echo "Target: ${BASE_URL}"
echo ""

# Test 1: Create a session
echo "--- Test 1: POST /sessions (create session) ---"
SESSION_RESPONSE=$(curl -s -X POST "${BASE_URL}/sessions")
echo "$SESSION_RESPONSE" | jq .
SESSION_ID=$(echo "$SESSION_RESPONSE" | jq -r .sessionId)
echo "Session ID: ${SESSION_ID}"
echo ""

if [[ "$SESSION_ID" == "null" || -z "$SESSION_ID" ]]; then
  echo "ERROR: Failed to create session. Aborting." >&2
  exit 1
fi

# Test 2: Stream a reply that needs the lookup_order tool
# -N turns off curl's buffering, so each event prints as it arrives
echo "--- Test 2: POST /chat/stream (streams events; the model calls lookup_order) ---"
curl -s -N -X POST "${BASE_URL}/chat/stream" \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\": \"${SESSION_ID}\", \"message\": \"Hi! What is the status of my order A-1001?\"}"
echo ""

# Test 3: The reply was saved after the finish event
echo "--- Test 3: GET /sessions/${SESSION_ID}/history (roles and text only) ---"
curl -s "${BASE_URL}/sessions/${SESSION_ID}/history" \
  | jq '[.messages[] | {role, text: ([.content[] | select(.type == "text") | .text] | join(""))}]'
echo ""

# Test 4: Unknown session (expect 404 JSON, no stream)
echo "--- Test 4: POST /chat/stream (unknown session — expect 404) ---"
curl -s -w '\nHTTP %{http_code}\n' -X POST "${BASE_URL}/chat/stream" \
  -H 'Content-Type: application/json' \
  -d '{"sessionId": "00000000-0000-4000-8000-000000000000", "message": "Hello"}'
echo ""

echo "=== Done ==="
