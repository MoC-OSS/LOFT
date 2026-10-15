#!/usr/bin/env bash
# Pizza Order Bot — Focus Data Collection Demo
# Prerequisites: Docker PostgreSQL running, app running on PORT (default 3006)

set -e

PORT="${1:-3006}"
BASE="http://localhost:${PORT}"

echo "============================================"
echo "  Pizza Order Bot — Focus Demo"
echo "============================================"
echo ""

# Create a session
echo ">>> Creating session..."
SESSION_RESPONSE=$(curl -s -X POST "$BASE/api/sessions" -H 'Content-Type: application/json')
SESSION_ID=$(echo "$SESSION_RESPONSE" | jq -r '.sessionId')
echo "Session ID: $SESSION_ID"
echo ""

send() {
  local msg="$1"
  local label="$2"
  echo "============================================"
  echo "  $label"
  echo "============================================"
  echo "User: $msg"
  echo ""
  RESPONSE=$(curl -s -X POST "$BASE/api/chat" \
    -H 'Content-Type: application/json' \
    -d "{\"sessionId\": \"$SESSION_ID\", \"message\": \"$msg\"}")
  echo "Bot: $(echo "$RESPONSE" | jq -r '.response' | head -30)"
  echo ""
  echo "Order Complete: $(echo "$RESPONSE" | jq -r '.orderComplete')"
  echo "Focus Status:"
  echo "$RESPONSE" | jq '.focusStatus'
  echo ""
  sleep 1
}

# Turn 1: Pizza type + size
send "I'd like to order a large pepperoni pizza" "Turn 1: Pizza type and size"

# Turn 2: Quantity + delivery address
send "2 pizzas to 123 Main Street" "Turn 2: Quantity and delivery address"

# Turn 3: Payment method (triggers completion)
send "Pay by card" "Turn 3: Payment method (completes order)"

echo "============================================"
echo "  Demo Complete!"
echo "============================================"
echo ""
echo "The Focus engine collected all required fields"
echo "across 3 conversation turns without any agent"
echo "orchestration — just direct chat.generate() calls."
