#!/usr/bin/env bash
# Restaurant Agent Showcase — Demo Script
# Tests all 5 flows via the router agent.
# Prerequisites: Docker PostgreSQL running, app running on PORT (default 3005)

set -e

PORT="${1:-3005}"
BASE="http://localhost:${PORT}"

echo "============================================"
echo "  Restaurant Agent Showcase — Demo"
echo "============================================"
echo ""

# ──────────────────────────────────────────────
# Flow 1: Simple — single agent
# ──────────────────────────────────────────────

echo ">>> Creating session for Flow 1..."
SESSION_ID=$(curl -s -X POST "$BASE/api/sessions" -H 'Content-Type: application/json' | jq -r '.sessionId')

echo "============================================"
echo "  Flow 1: Simple — Wine Recommendation"
echo "============================================"
echo "User: What wine pairs well with grilled salmon?"
echo ""
RESPONSE=$(curl -s -X POST "$BASE/api/chat" \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\": \"$SESSION_ID\", \"message\": \"What wine pairs well with grilled salmon?\"}")
echo "Agent: $(echo "$RESPONSE" | jq -r '.response' | head -20)"
echo ""
sleep 1

# ──────────────────────────────────────────────
# Flow 2: Chain — linear pipeline
# ──────────────────────────────────────────────

echo ">>> Creating session for Flow 2..."
SESSION_ID=$(curl -s -X POST "$BASE/api/sessions" -H 'Content-Type: application/json' | jq -r '.sessionId')

echo "============================================"
echo "  Flow 2: Chain — Dinner Menu Planning"
echo "============================================"
echo "User: Plan a romantic 3-course Italian dinner for two"
echo ""
RESPONSE=$(curl -s -X POST "$BASE/api/chat" \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\": \"$SESSION_ID\", \"message\": \"Plan a romantic 3-course Italian dinner for two\"}")
echo "Agent: $(echo "$RESPONSE" | jq -r '.response' | head -30)"
echo ""
sleep 1

# ──────────────────────────────────────────────
# Flow 3: Parallel — FAN_OUT
# ──────────────────────────────────────────────

echo ">>> Creating session for Flow 3..."
SESSION_ID=$(curl -s -X POST "$BASE/api/sessions" -H 'Content-Type: application/json' | jq -r '.sessionId')

echo "============================================"
echo "  Flow 3: Parallel — Catering Organization"
echo "============================================"
echo "User: Organize catering for a company party, 50 people, Mediterranean theme"
echo ""
RESPONSE=$(curl -s -X POST "$BASE/api/chat" \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\": \"$SESSION_ID\", \"message\": \"Organize catering for a company party, 50 people, Mediterranean theme\"}")
echo "Agent: $(echo "$RESPONSE" | jq -r '.response' | head -30)"
echo ""
sleep 1

# ──────────────────────────────────────────────
# Flow 4: Team — restaurant review
# ──────────────────────────────────────────────

echo ">>> Creating session for Flow 4..."
SESSION_ID=$(curl -s -X POST "$BASE/api/sessions" -H 'Content-Type: application/json' | jq -r '.sessionId')

echo "============================================"
echo "  Flow 4: Team — Restaurant Review"
echo "============================================"
echo "User: Write a detailed review of a fine dining French restaurant called Le Petit Bistro"
echo ""
RESPONSE=$(curl -s -X POST "$BASE/api/chat" \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\": \"$SESSION_ID\", \"message\": \"Write a detailed review of a fine dining French restaurant called Le Petit Bistro\"}")
echo "Agent: $(echo "$RESPONSE" | jq -r '.response' | head -30)"
echo ""
sleep 1

# ──────────────────────────────────────────────
# Flow 5: Full — Focus + FAN_OUT + Team
# ──────────────────────────────────────────────

echo ">>> Creating session for Flow 5..."
SESSION_ID=$(curl -s -X POST "$BASE/api/sessions" -H 'Content-Type: application/json' | jq -r '.sessionId')

send_full() {
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
  echo "Agent: $(echo "$RESPONSE" | jq -r '.response' | head -30)"
  echo ""
  sleep 1
}

send_full "I need to organize a banquet for my company anniversary" "Flow 5: Full — Banquet (turn 1: intent)"
send_full "June 15th, 100 guests, budget 10000 dollars, Italian cuisine, indoor venue" "Flow 5: Full — Banquet (turn 2: details)"
send_full "Some guests are vegetarian, no other restrictions" "Flow 5: Full — Banquet (turn 3: triggers pipeline)"

# ──────────────────────────────────────────────
# Flow 6: Reservation — resolveFields + custom Node + ScopedContext
# ──────────────────────────────────────────────

echo ">>> Creating session for Flow 6..."
SESSION_ID=$(curl -s -X POST "$BASE/api/sessions" -H 'Content-Type: application/json' | jq -r '.sessionId')

send_reservation() {
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
  echo "Agent: $(echo "$RESPONSE" | jq -r '.response' | head -20)"
  echo ""
  sleep 1
}

send_reservation "I'd like to book a table please" "Flow 6: Reservation (turn 1: intent)"
send_reservation "This Saturday at 7pm, 4 people, outdoor seating would be nice" "Flow 6: Reservation (turn 2: details)"
send_reservation "Yes, it's a special occasion" "Flow 6: Reservation (turn 3: special occasion adds occasion_type via resolveFields)"
send_reservation "It's a birthday" "Flow 6: Reservation (turn 4: completes Focus and runs the pipeline)"

echo "============================================"
echo "  Demo Complete!"
echo "============================================"
echo ""
echo "6 flows demonstrated:"
echo "  1. Simple      — single agent (sommelier)"
echo "  2. Chain       — linear pipeline (nutritionist → chef → presenter)"
echo "  3. Parallel    — FAN_OUT (3 specialists + coordinator)"
echo "  4. Team        — TeamBuilder (critic team + verdict)"
echo "  5. Full        — Focus + FAN_OUT + Team + policies"
echo "  6. Reservation — resolveFields + custom Node + ScopedContext"
echo ""
echo "Check server console for [TRACE] spans and ORCHESTRATOR METRICS."
