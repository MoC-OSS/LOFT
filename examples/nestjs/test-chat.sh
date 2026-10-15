#!/usr/bin/env bash
# Quick test script for nestjs example
# Usage: ./test-chat.sh [port]

PORT="${1:-3004}"
BASE_URL="http://localhost:${PORT}"

echo "=== nestjs example test ==="
echo "Target: ${BASE_URL}"
echo ""

# Test 1: Health check
echo "--- Test 1: GET /chat/health ---"
curl -s "${BASE_URL}/chat/health" | jq .
echo ""

# Test 2: Create a session
echo "--- Test 2: POST /chat/sessions (create session) ---"
SESSION_RESPONSE=$(curl -s -w '\n%{http_code}' -X POST "${BASE_URL}/chat/sessions")
HTTP_CODE=$(echo "$SESSION_RESPONSE" | tail -1)
BODY=$(echo "$SESSION_RESPONSE" | sed '$d')
echo "$BODY" | jq .
SESSION_ID=$(echo "$BODY" | jq -r .sessionId)
echo "Session ID: ${SESSION_ID} (HTTP ${HTTP_CODE})"
if [ "$HTTP_CODE" = "201" ]; then
  echo "✓ Got expected 201"
else
  echo "✗ Expected 201, got ${HTTP_CODE}"
fi
echo ""

if [ "$SESSION_ID" = "null" ] || [ -z "$SESSION_ID" ]; then
  echo "ERROR: Failed to create session. Aborting."
  exit 1
fi

# Test 3: Send a message
echo "--- Test 3: POST /chat (first message) ---"
echo "Request: { \"sessionId\": \"${SESSION_ID}\", \"message\": \"My name is Alex\" }"
curl -s -X POST "${BASE_URL}/chat" \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\": \"${SESSION_ID}\", \"message\": \"My name is Alex\"}" | jq .
echo ""

# Test 4: Multi-turn recall (the key test)
echo "--- Test 4: POST /chat (multi-turn recall — should remember name) ---"
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

# Test 5: View conversation history
echo "--- Test 5: GET /chat/sessions/${SESSION_ID}/history ---"
curl -s "${BASE_URL}/chat/sessions/${SESSION_ID}/history" | jq .
echo ""

# Test 6: Missing sessionId (expect 400)
echo "--- Test 6: POST /chat (missing sessionId — expect 400) ---"
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE_URL}/chat" \
  -H 'Content-Type: application/json' \
  -d '{"message": "Hello"}')
if [ "$STATUS" = "400" ]; then
  echo "✓ Got expected 400"
else
  echo "✗ Expected 400, got $STATUS"
fi
curl -s -X POST "${BASE_URL}/chat" \
  -H 'Content-Type: application/json' \
  -d '{"message": "Hello"}' | jq .
echo ""

# Test 7: Empty message (expect 400)
echo "--- Test 7: POST /chat (empty message — expect 400) ---"
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE_URL}/chat" \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\": \"${SESSION_ID}\", \"message\": \"   \"}")
if [ "$STATUS" = "400" ]; then
  echo "✓ Got expected 400"
else
  echo "✗ Expected 400, got $STATUS"
fi
curl -s -X POST "${BASE_URL}/chat" \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\": \"${SESSION_ID}\", \"message\": \"   \"}" | jq .
echo ""

echo "=== Done ==="
