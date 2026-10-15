#!/usr/bin/env bash
# Quick test script for express-basic example
# Usage: ./test-chat.sh [message] [port]

PORT="${2:-3001}"
BASE_URL="http://localhost:${PORT}"
MESSAGE="${1:-What is 2+2?}"

echo "=== express-basic test ==="
echo "Target: ${BASE_URL}"
echo ""

# Test 1: Valid chat request
echo "--- Test 1: POST /chat (valid message) ---"
echo "Request: { \"message\": \"${MESSAGE}\" }"
echo ""
curl -s -X POST "${BASE_URL}/chat" \
  -H 'Content-Type: application/json' \
  -d "{\"message\": \"${MESSAGE}\"}" | jq .
echo ""

# Test 2: Missing message (expect 400)
echo "--- Test 2: POST /chat (missing message — expect 400) ---"
curl -s -X POST "${BASE_URL}/chat" \
  -H 'Content-Type: application/json' \
  -d '{}' | jq .
echo ""

# Test 3: Empty message (expect 400)
echo "--- Test 3: POST /chat (empty message — expect 400) ---"
curl -s -X POST "${BASE_URL}/chat" \
  -H 'Content-Type: application/json' \
  -d '{"message": ""}' | jq .
echo ""

echo "=== Done ==="
