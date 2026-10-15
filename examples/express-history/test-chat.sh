#!/usr/bin/env bash
# Quick test script for express-history example
# Usage: ./test-chat.sh [port]

PORT="${1:-3002}"
BASE_URL="http://localhost:${PORT}"

echo "=== express-history test ==="
echo "Target: ${BASE_URL}"
echo ""

# Test 1: Create a session
echo "--- Test 1: POST /sessions (create session) ---"
SESSION_RESPONSE=$(curl -s -X POST "${BASE_URL}/sessions")
echo "$SESSION_RESPONSE" | jq .
SESSION_ID=$(echo "$SESSION_RESPONSE" | jq -r .sessionId)
echo "Session ID: ${SESSION_ID}"
echo ""

if [ "$SESSION_ID" = "null" ] || [ -z "$SESSION_ID" ]; then
  echo "ERROR: Failed to create session. Aborting."
  exit 1
fi

# Test 2: Send a message
echo "--- Test 2: POST /chat (first message) ---"
echo "Request: { \"sessionId\": \"${SESSION_ID}\", \"message\": \"My name is Alex\" }"
curl -s -X POST "${BASE_URL}/chat" \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\": \"${SESSION_ID}\", \"message\": \"My name is Alex\"}" | jq .
echo ""

# Test 3: Multi-turn recall (the key test)
echo "--- Test 3: POST /chat (multi-turn recall — should remember name) ---"
echo "Request: { \"sessionId\": \"${SESSION_ID}\", \"message\": \"What is my name?\" }"
RECALL_RESPONSE=$(curl -s -X POST "${BASE_URL}/chat" \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\": \"${SESSION_ID}\", \"message\": \"What is my name?\"}")
echo "$RECALL_RESPONSE" | jq .
echo ""

# Check if response contains "Alex"
if echo "$RECALL_RESPONSE" | jq -r .response | grep -qi "alex"; then
  echo "✓ Multi-turn recall PASSED — LLM remembered the name"
else
  echo "✗ Multi-turn recall FAILED — response did not contain 'Alex'"
fi
echo ""

# Test 4: View conversation history
echo "--- Test 4: GET /sessions/${SESSION_ID}/history ---"
curl -s "${BASE_URL}/sessions/${SESSION_ID}/history" | jq .
echo ""

# Test 5: Missing sessionId (expect 400)
echo "--- Test 5: POST /chat (missing sessionId — expect 400) ---"
curl -s -X POST "${BASE_URL}/chat" \
  -H 'Content-Type: application/json' \
  -d '{"message": "Hello"}' | jq .
echo ""

# Test 6: Missing message (expect 400)
echo "--- Test 6: POST /chat (missing message — expect 400) ---"
curl -s -X POST "${BASE_URL}/chat" \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\": \"${SESSION_ID}\"}" | jq .
echo ""

# Test 7: Empty message (expect 400)
echo "--- Test 7: POST /chat (empty message — expect 400) ---"
curl -s -X POST "${BASE_URL}/chat" \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\": \"${SESSION_ID}\", \"message\": \"\"}" | jq .
echo ""

echo "=== Done ==="
