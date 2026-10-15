#!/usr/bin/env bash
# Quick test script for express-full example
# Usage: ./test-chat.sh [port]

PORT="${1:-3003}"
BASE_URL="http://localhost:${PORT}"

echo "=== express-full test ==="
echo "Target: ${BASE_URL}"
echo ""

# Test 1: Health check
echo "--- Test 1: GET /health ---"
curl -s "${BASE_URL}/health" | jq .
echo ""

# Test 2: Create a session
echo "--- Test 2: POST /api/sessions (create session) ---"
SESSION_RESPONSE=$(curl -s -X POST "${BASE_URL}/api/sessions")
echo "$SESSION_RESPONSE" | jq .
SESSION_ID=$(echo "$SESSION_RESPONSE" | jq -r .sessionId)
echo "Session ID: ${SESSION_ID}"
echo ""

if [ "$SESSION_ID" = "null" ] || [ -z "$SESSION_ID" ]; then
  echo "ERROR: Failed to create session. Aborting."
  exit 1
fi

# Test 3: Send a message
echo "--- Test 3: POST /api/chat (first message) ---"
echo "Request: { \"sessionId\": \"${SESSION_ID}\", \"message\": \"My name is Alex\" }"
curl -s -X POST "${BASE_URL}/api/chat" \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\": \"${SESSION_ID}\", \"message\": \"My name is Alex\"}" | jq .
echo ""

# Test 4: Multi-turn recall (the key test)
echo "--- Test 4: POST /api/chat (multi-turn recall — should remember name) ---"
echo "Request: { \"sessionId\": \"${SESSION_ID}\", \"message\": \"What is my name?\" }"
RECALL_RESPONSE=$(curl -s -X POST "${BASE_URL}/api/chat" \
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

# Test 5: Get session info
echo "--- Test 5: GET /api/sessions/${SESSION_ID} ---"
curl -s "${BASE_URL}/api/sessions/${SESSION_ID}" | jq .
echo ""

# Test 6: Delete session
echo "--- Test 6: DELETE /api/sessions/${SESSION_ID} ---"
curl -s -X DELETE "${BASE_URL}/api/sessions/${SESSION_ID}" | jq .
echo ""

# Test 7: Verify session is deleted (should error)
echo "--- Test 7: GET /api/sessions/${SESSION_ID} (after delete — expect error) ---"
curl -s "${BASE_URL}/api/sessions/${SESSION_ID}" | jq .
echo ""

# Test 8: Missing sessionId (expect 400)
echo "--- Test 8: POST /api/chat (missing sessionId — expect 400) ---"
curl -s -X POST "${BASE_URL}/api/chat" \
  -H 'Content-Type: application/json' \
  -d '{"message": "Hello"}' | jq .
echo ""

# Test 9: Missing message (expect 400)
echo "--- Test 9: POST /api/chat (missing message — expect 400) ---"
curl -s -X POST "${BASE_URL}/api/chat" \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\": \"some-id\"}" | jq .
echo ""

# Test 10: Empty message (expect 400)
echo "--- Test 10: POST /api/chat (empty message — expect 400) ---"
curl -s -X POST "${BASE_URL}/api/chat" \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\": \"some-id\", \"message\": \"\"}" | jq .
echo ""

echo "=== Done ==="
echo ""
echo "NOTE: Check server console for middleware log lines:"
echo "  [InputMiddleware] Processing N message(s)    (appears twice per /api/chat request)"
echo "  [BeforeGenerateMiddleware] Session: <id>"
echo "  [AfterGenerateMiddleware] Response received"
