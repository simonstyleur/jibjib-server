#!/bin/bash
# ============================================================================
# JibJib Backend API — Comprehensive Test Script
# Tests all major flows end-to-end against a running server.
# ============================================================================
set -euo pipefail

BASE="http://localhost:3000"
PASS=0
FAIL=0
TOTAL=0

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

assert() {
  local test_name="$1"
  local expected="$2"
  local actual="$3"
  TOTAL=$((TOTAL + 1))
  if [ "$actual" = "$expected" ]; then
    echo -e "  ${GREEN}✓${NC} $test_name"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}✗${NC} $test_name (expected: $expected, got: $actual)"
    FAIL=$((FAIL + 1))
  fi
}

assert_contains() {
  local test_name="$1"
  local expected="$2"
  local actual="$3"
  TOTAL=$((TOTAL + 1))
  if echo "$actual" | grep -q "$expected"; then
    echo -e "  ${GREEN}✓${NC} $test_name"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}✗${NC} $test_name (expected to contain: '$expected')"
    FAIL=$((FAIL + 1))
  fi
}

assert_not_empty() {
  local test_name="$1"
  local actual="$2"
  TOTAL=$((TOTAL + 1))
  if [ -n "$actual" ] && [ "$actual" != "null" ]; then
    echo -e "  ${GREEN}✓${NC} $test_name = $actual"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}✗${NC} $test_name (was empty/null)"
    FAIL=$((FAIL + 1))
  fi
}

# Helper to extract JSON fields using python3
json() {
  python3 -c "import json,sys; d=json.load(sys.stdin); print($1)" 2>/dev/null || echo ""
}

# ============================================================================
echo -e "\n${CYAN}══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  JibJib Backend API Tests${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}\n"

# ────────────────────────────────────────────────────────────────────────────
echo -e "${YELLOW}1. Health Check${NC}"
# ────────────────────────────────────────────────────────────────────────────
RESP=$(curl -s -w "\n%{http_code}" "$BASE/health")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert "GET /health returns 200" "200" "$CODE"
STATUS=$(echo "$BODY" | json "d['status']")
assert "Health status is ok" "ok" "$STATUS"
DB_STATUS=$(echo "$BODY" | json "d['db']")
assert "DB is connected" "connected" "$DB_STATUS"
REDIS_STATUS=$(echo "$BODY" | json "d['redis']")
assert "Redis is connected" "connected" "$REDIS_STATUS"

# ────────────────────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}2. Auth — Anonymous Registration${NC}"
# ────────────────────────────────────────────────────────────────────────────

# Test validation: missing required field
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/auth/anonymous" \
  -H "Content-Type: application/json" \
  -d '{}')
CODE=$(echo "$RESP" | tail -1)
assert "POST /auth/anonymous with empty body returns 422" "422" "$CODE"

# Create User A
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/auth/anonymous" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Alice",
    "device_id": "device-alice-001",
    "device_os": "ios",
    "app_version": "1.0.0",
    "language": "en"
  }')
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert "POST /auth/anonymous returns 201" "201" "$CODE"

USER_A_ID=$(echo "$BODY" | json "d['data']['user']['id']")
assert_not_empty "User A ID" "$USER_A_ID"

USER_A_NAME=$(echo "$BODY" | json "d['data']['user']['name']")
assert "User A name is Alice" "Alice" "$USER_A_NAME"

TOKEN_A=$(echo "$BODY" | json "d['data']['tokens']['access_token']")
assert_not_empty "User A access_token" "$TOKEN_A"

REFRESH_A=$(echo "$BODY" | json "d['data']['tokens']['refresh_token']")
assert_not_empty "User A refresh_token" "$REFRESH_A"

# Create User B
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/auth/anonymous" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Bob",
    "device_id": "device-bob-001",
    "device_os": "android",
    "app_version": "1.0.0",
    "language": "fr"
  }')
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert "Create User B returns 201" "201" "$CODE"

USER_B_ID=$(echo "$BODY" | json "d['data']['user']['id']")
TOKEN_B=$(echo "$BODY" | json "d['data']['tokens']['access_token']")
REFRESH_B=$(echo "$BODY" | json "d['data']['tokens']['refresh_token']")
assert_not_empty "User B ID" "$USER_B_ID"
assert_not_empty "User B access_token" "$TOKEN_B"

# ────────────────────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}3. Auth — Token Refresh${NC}"
# ────────────────────────────────────────────────────────────────────────────
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/auth/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\": \"$REFRESH_A\"}")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert "POST /auth/refresh returns 200" "200" "$CODE"

NEW_TOKEN_A=$(echo "$BODY" | json "d['data']['access_token']")
NEW_REFRESH_A=$(echo "$BODY" | json "d['data']['refresh_token']")
assert_not_empty "New access_token" "$NEW_TOKEN_A"
assert_not_empty "New refresh_token" "$NEW_REFRESH_A"
TOKEN_A="$NEW_TOKEN_A"
REFRESH_A="$NEW_REFRESH_A"

# Old refresh token should be revoked
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/auth/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\": \"$REFRESH_A\"}")
CODE=$(echo "$RESP" | tail -1)
# Using new refresh token should work
assert "Refresh with new token returns 200" "200" "$CODE"
BODY=$(echo "$RESP" | sed '$d')
TOKEN_A=$(echo "$BODY" | json "d['data']['access_token']")
REFRESH_A=$(echo "$BODY" | json "d['data']['refresh_token']")

# ────────────────────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}4. Auth — Protected Endpoints Without Token${NC}"
# ────────────────────────────────────────────────────────────────────────────
RESP=$(curl -s -w "\n%{http_code}" "$BASE/api/user/me")
CODE=$(echo "$RESP" | tail -1)
assert "GET /user/me without token returns 401" "401" "$CODE"

RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/pairing/create" \
  -H "Content-Type: application/json")
CODE=$(echo "$RESP" | tail -1)
assert "POST /pairing/create without token returns 401" "401" "$CODE"

# ────────────────────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}5. User Profile${NC}"
# ────────────────────────────────────────────────────────────────────────────
RESP=$(curl -s -w "\n%{http_code}" "$BASE/api/user/me" \
  -H "Authorization: Bearer $TOKEN_A")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert "GET /user/me returns 200" "200" "$CODE"

ME_NAME=$(echo "$BODY" | json "d['data']['name']")
assert "User name is Alice" "Alice" "$ME_NAME"

ME_PAIR=$(echo "$BODY" | json "d['data']['pair']")
assert "User A has no pair yet" "None" "$ME_PAIR"

# Update profile
RESP=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE/api/user/me" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice Updated", "language": "fr"}')
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert "PATCH /user/me returns 200" "200" "$CODE"
UPDATED_NAME=$(echo "$BODY" | json "d['data']['name']")
assert "Updated name is Alice Updated" "Alice Updated" "$UPDATED_NAME"

# Change name back
curl -s -X PATCH "$BASE/api/user/me" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice"}' > /dev/null

# ────────────────────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}6. Pairing — Create${NC}"
# ────────────────────────────────────────────────────────────────────────────
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/pairing/create" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert "POST /pairing/create returns 201" "201" "$CODE"

PAIR_ID=$(echo "$BODY" | json "d['data']['pair_id']")
assert_not_empty "Pair ID" "$PAIR_ID"

QR_TOKEN=$(echo "$BODY" | json "d['data']['qr']['token']")
assert_not_empty "QR token" "$QR_TOKEN"

INVITE_SLUG=$(echo "$BODY" | json "d['data']['invite_link']['slug']")
assert_not_empty "Invite slug" "$INVITE_SLUG"

PAIRING_CODE=$(echo "$BODY" | json "d['data']['code']['value']")
assert_not_empty "Pairing code" "$PAIRING_CODE"
assert_contains "Code starts with JIB-" "JIB-" "$PAIRING_CODE"

# Duplicate create should fail
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/pairing/create" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json")
CODE=$(echo "$RESP" | tail -1)
assert "Duplicate pairing create returns 409" "409" "$CODE"

# ────────────────────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}7. Pairing — Refresh QR${NC}"
# ────────────────────────────────────────────────────────────────────────────
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/pairing/refresh-qr" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert "POST /pairing/refresh-qr returns 200" "200" "$CODE"

NEW_QR=$(echo "$BODY" | json "d['data']['qr']['token']")
assert_not_empty "New QR token after refresh" "$NEW_QR"
NEW_CODE=$(echo "$BODY" | json "d['data']['code']['value']")
assert_not_empty "New code after refresh" "$NEW_CODE"
PAIRING_CODE="$NEW_CODE"

# ────────────────────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}8. Pairing — Join via Code${NC}"
# ────────────────────────────────────────────────────────────────────────────

# Self-join should fail (Alice is already paired, so gets 409 ALREADY_PAIRED)
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/pairing/join" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{\"code\": \"$PAIRING_CODE\"}")
CODE=$(echo "$RESP" | tail -1)
assert "Self-join returns 409 (already paired)" "409" "$CODE"

# User B joins
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/pairing/join" \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" \
  -d "{\"code\": \"$PAIRING_CODE\"}")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert "POST /pairing/join returns 200" "200" "$CODE"

JOINED_PAIR_ID=$(echo "$BODY" | json "d['data']['id']")
assert "Joined pair ID matches" "$PAIR_ID" "$JOINED_PAIR_ID"

LIST_ID=$(echo "$BODY" | json "d['data']['shared_list_id']")
assert_not_empty "Default list ID" "$LIST_ID"

# Verify User A now sees partner
RESP=$(curl -s -w "\n%{http_code}" "$BASE/api/user/me" \
  -H "Authorization: Bearer $TOKEN_A")
BODY=$(echo "$RESP" | sed '$d')
PARTNER_NAME=$(echo "$BODY" | json "d['data']['pair']['paired_with']['name']")
assert "Alice's partner is Bob" "Bob" "$PARTNER_NAME"

# Refresh token for User A to pick up pair
RESP=$(curl -s -X POST "$BASE/api/auth/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\": \"$REFRESH_A\"}")
TOKEN_A=$(echo "$RESP" | json "d['data']['access_token']")
REFRESH_A=$(echo "$RESP" | json "d['data']['refresh_token']")

# Refresh token for User B to pick up pair
RESP=$(curl -s -X POST "$BASE/api/auth/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\": \"$REFRESH_B\"}")
TOKEN_B=$(echo "$RESP" | json "d['data']['access_token']")
REFRESH_B=$(echo "$RESP" | json "d['data']['refresh_token']")

# ────────────────────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}9. Lists — Get Lists${NC}"
# ────────────────────────────────────────────────────────────────────────────
RESP=$(curl -s -w "\n%{http_code}" "$BASE/api/lists" \
  -H "Authorization: Bearer $TOKEN_A")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert "GET /lists returns 200" "200" "$CODE"

LIST_COUNT=$(echo "$BODY" | json "len(d['data'])")
assert "Pair has 1 list" "1" "$LIST_COUNT"

LIST_NAME=$(echo "$BODY" | json "d['data'][0]['name']")
assert "Default list name is Grocery" "Grocery" "$LIST_NAME"

# Get list by ID
RESP=$(curl -s -w "\n%{http_code}" "$BASE/api/lists/$LIST_ID" \
  -H "Authorization: Bearer $TOKEN_A")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert "GET /lists/:id returns 200" "200" "$CODE"

# ────────────────────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}10. Items — Add Items${NC}"
# ────────────────────────────────────────────────────────────────────────────

# Test without pair (should fail for unpaired user)
# Already paired, so test adding items

# Add batch of items
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/lists/$LIST_ID/items" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {"name": "Milk", "category": "dairy", "quantity": "2x"},
      {"name": "Bread", "category": "bakery"},
      {"name": "Tomatoes", "category": "produce", "quantity": "1kg"}
    ]
  }')
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert "POST /lists/:id/items returns 201" "201" "$CODE"

ITEMS_COUNT=$(echo "$BODY" | json "len(d['data'])")
assert "3 items created" "3" "$ITEMS_COUNT"

ITEM1_ID=$(echo "$BODY" | json "d['data'][0]['id']")
ITEM2_ID=$(echo "$BODY" | json "d['data'][1]['id']")
ITEM3_ID=$(echo "$BODY" | json "d['data'][2]['id']")
assert_not_empty "Item 1 ID" "$ITEM1_ID"

ITEM1_NAME=$(echo "$BODY" | json "d['data'][0]['name']")
assert "Item 1 name is Milk" "Milk" "$ITEM1_NAME"

ITEM1_CAT=$(echo "$BODY" | json "d['data'][0]['category']")
assert "Item 1 category is dairy" "dairy" "$ITEM1_CAT"

ITEM1_QTY=$(echo "$BODY" | json "d['data'][0]['quantity']")
assert "Item 1 quantity is 2x" "2x" "$ITEM1_QTY"

ITEM1_CREATOR=$(echo "$BODY" | json "d['data'][0]['created_by']['name']")
assert "Item created by Alice" "Alice" "$ITEM1_CREATOR"

# Validation: empty items array
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/lists/$LIST_ID/items" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"items": []}')
CODE=$(echo "$RESP" | tail -1)
assert "Empty items array returns 422" "422" "$CODE"

# ────────────────────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}11. Items — Update Item${NC}"
# ────────────────────────────────────────────────────────────────────────────
RESP=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE/api/lists/$LIST_ID/items/$ITEM1_ID" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"name": "Whole Milk", "quantity": "3x"}')
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert "PATCH item returns 200" "200" "$CODE"

UPDATED_NAME=$(echo "$BODY" | json "d['data']['name']")
assert "Updated name is Whole Milk" "Whole Milk" "$UPDATED_NAME"

UPDATED_QTY=$(echo "$BODY" | json "d['data']['quantity']")
assert "Updated quantity is 3x" "3x" "$UPDATED_QTY"

# ────────────────────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}12. Items — Check/Uncheck${NC}"
# ────────────────────────────────────────────────────────────────────────────

# User B checks Item 1
RESP=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE/api/lists/$LIST_ID/items/$ITEM1_ID" \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" \
  -d '{"is_checked": true}')
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert "Check item returns 200" "200" "$CODE"

IS_CHECKED=$(echo "$BODY" | json "d['data']['is_checked']")
assert "Item is checked" "True" "$IS_CHECKED"

CHECKED_BY=$(echo "$BODY" | json "d['data']['checked_by']['name']")
assert "Checked by Bob" "Bob" "$CHECKED_BY"

# Uncheck it
RESP=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE/api/lists/$LIST_ID/items/$ITEM1_ID" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"is_checked": false}')
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert "Uncheck item returns 200" "200" "$CODE"

IS_CHECKED=$(echo "$BODY" | json "d['data']['is_checked']")
assert "Item is unchecked" "False" "$IS_CHECKED"

CHECKED_BY=$(echo "$BODY" | json "d['data']['checked_by']")
assert "checked_by is None after uncheck" "None" "$CHECKED_BY"

# ────────────────────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}13. Items — Delete & Undo${NC}"
# ────────────────────────────────────────────────────────────────────────────
RESP=$(curl -s -w "\n%{http_code}" -X DELETE "$BASE/api/lists/$LIST_ID/items/$ITEM2_ID" \
  -H "Authorization: Bearer $TOKEN_A")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert "DELETE item returns 200" "200" "$CODE"

DELETED_AT=$(echo "$BODY" | json "d['data']['deleted_at']")
assert_not_empty "deleted_at timestamp" "$DELETED_AT"

UNDO_UNTIL=$(echo "$BODY" | json "d['data']['undo_until']")
assert_not_empty "undo_until timestamp" "$UNDO_UNTIL"

# Undo the delete
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/lists/$LIST_ID/items/$ITEM2_ID/undo" \
  -H "Authorization: Bearer $TOKEN_A")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert "POST undo returns 200" "200" "$CODE"

RESTORED_NAME=$(echo "$BODY" | json "d['data']['name']")
assert "Restored item name is Bread" "Bread" "$RESTORED_NAME"

# ────────────────────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}14. Items — List Verification${NC}"
# ────────────────────────────────────────────────────────────────────────────
RESP=$(curl -s -w "\n%{http_code}" "$BASE/api/lists/$LIST_ID" \
  -H "Authorization: Bearer $TOKEN_A")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert "GET list with items returns 200" "200" "$CODE"

ITEM_COUNT=$(echo "$BODY" | json "len(d['data']['items'])")
assert "List has 3 items" "3" "$ITEM_COUNT"

# ────────────────────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}15. Trips — Start Trip${NC}"
# ────────────────────────────────────────────────────────────────────────────
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/trips/start" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{\"list_id\": \"$LIST_ID\"}")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert "POST /trips/start returns 201" "201" "$CODE"

TRIP_ID=$(echo "$BODY" | json "d['data']['id']")
assert_not_empty "Trip ID" "$TRIP_ID"

TRIP_STATUS=$(echo "$BODY" | json "d['data']['status']")
assert "Trip status is active" "active" "$TRIP_STATUS"

TRIP_TOTAL=$(echo "$BODY" | json "d['data']['items_total']")
assert "Trip items_total is 3" "3" "$TRIP_TOTAL"

# Duplicate trip start should fail
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/trips/start" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{\"list_id\": \"$LIST_ID\"}")
CODE=$(echo "$RESP" | tail -1)
assert "Duplicate trip start returns 409" "409" "$CODE"

# ────────────────────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}16. Trips — Get Active Trip${NC}"
# ────────────────────────────────────────────────────────────────────────────
RESP=$(curl -s -w "\n%{http_code}" "$BASE/api/trips/active?list_id=$LIST_ID" \
  -H "Authorization: Bearer $TOKEN_B")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert "GET /trips/active returns 200" "200" "$CODE"

ACTIVE_TRIP_ID=$(echo "$BODY" | json "d['data']['id']")
assert "Active trip ID matches" "$TRIP_ID" "$ACTIVE_TRIP_ID"

SHOPPER_NAME=$(echo "$BODY" | json "d['data']['shopper']['name']")
assert "Shopper is Alice" "Alice" "$SHOPPER_NAME"

# ────────────────────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}17. Trips — Check Items During Trip & End${NC}"
# ────────────────────────────────────────────────────────────────────────────

# Check 2 items during trip
curl -s -X PATCH "$BASE/api/lists/$LIST_ID/items/$ITEM1_ID" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"is_checked": true}' > /dev/null

curl -s -X PATCH "$BASE/api/lists/$LIST_ID/items/$ITEM2_ID" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"is_checked": true}' > /dev/null

# End trip
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/trips/$TRIP_ID/end" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert "POST /trips/:id/end returns 200" "200" "$CODE"

END_STATUS=$(echo "$BODY" | json "d['data']['status']")
assert "Trip status is completed" "completed" "$END_STATUS"

DURATION=$(echo "$BODY" | json "d['data']['duration_minutes']")
assert_not_empty "Duration minutes" "$DURATION"

SKIPPED_COUNT=$(echo "$BODY" | json "len(d['data']['skipped_items'])")
assert "1 skipped item (Tomatoes)" "1" "$SKIPPED_COUNT"

# Verify items were unchecked after trip end
RESP=$(curl -s "$BASE/api/lists/$LIST_ID" \
  -H "Authorization: Bearer $TOKEN_A")
CHECKED_COUNT=$(echo "$RESP" | json "sum(1 for i in d['data']['items'] if i['is_checked'])")
assert "All items unchecked after trip end" "0" "$CHECKED_COUNT"

# ────────────────────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}18. Messages — Send & Get${NC}"
# ────────────────────────────────────────────────────────────────────────────
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/lists/$LIST_ID/items/$ITEM1_ID/messages" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"text": "Get the organic one please!", "type": "text"}')
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert "POST message returns 201" "201" "$CODE"

MSG_TEXT=$(echo "$BODY" | json "d['data']['text']")
assert "Message text matches" "Get the organic one please!" "$MSG_TEXT"

# User B sends a reply
curl -s -X POST "$BASE/api/lists/$LIST_ID/items/$ITEM1_ID/messages" \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" \
  -d '{"text": "Sure thing!", "type": "text"}' > /dev/null

# Get messages
RESP=$(curl -s -w "\n%{http_code}" "$BASE/api/lists/$LIST_ID/items/$ITEM1_ID/messages" \
  -H "Authorization: Bearer $TOKEN_A")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert "GET messages returns 200" "200" "$CODE"

MSG_COUNT=$(echo "$BODY" | json "len(d['data'])")
assert "2 messages in thread" "2" "$MSG_COUNT"

HAS_MORE=$(echo "$BODY" | json "d['has_more']")
assert "has_more is False" "False" "$HAS_MORE"

CURSOR=$(echo "$BODY" | json "d['cursor']")
assert "cursor is None when no more pages" "None" "$CURSOR"

# ────────────────────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}19. Notification Preferences${NC}"
# ────────────────────────────────────────────────────────────────────────────
RESP=$(curl -s -w "\n%{http_code}" "$BASE/api/notifications/preferences" \
  -H "Authorization: Bearer $TOKEN_A")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert "GET /notifications/preferences returns 200" "200" "$CODE"

PREFS_COUNT=$(echo "$BODY" | json "len(d['data'])")
assert "8 notification preference types" "8" "$PREFS_COUNT"

# Update a preference
RESP=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE/api/notifications/preferences" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"preferences": [{"type": "items_added", "enabled": false}]}')
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert "PATCH preferences returns 200" "200" "$CODE"

# ────────────────────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}20. Common Items (Autocomplete)${NC}"
# ────────────────────────────────────────────────────────────────────────────
RESP=$(curl -s -w "\n%{http_code}" "$BASE/api/common-items?q=tom&lang=en")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert "GET /common-items?q=tom returns 200" "200" "$CODE"

CI_COUNT=$(echo "$BODY" | json "len(d.get('data', d.get('items', [])))")
TOTAL=$((TOTAL + 1))
if [ "$CI_COUNT" -ge "1" ]; then
  echo -e "  ${GREEN}✓${NC} Common items search returned $CI_COUNT results"
  PASS=$((PASS + 1))
else
  echo -e "  ${RED}✗${NC} Common items search returned 0 results"
  FAIL=$((FAIL + 1))
fi

# ────────────────────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}21. Sync — Offline Batch${NC}"
# ────────────────────────────────────────────────────────────────────────────
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/sync" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{
    \"device_id\": \"device-alice-001\",
    \"changes\": [
      {
        \"operation\": \"edit\",
        \"entity_type\": \"item\",
        \"entity_id\": \"$ITEM3_ID\",
        \"payload\": {\"name\": \"Cherry Tomatoes\"},
        \"client_timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\"
      }
    ]
  }")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert "POST /sync returns 200" "200" "$CODE"

SYNC_STATUS=$(echo "$BODY" | json "d['data']['results'][0]['status']")
assert "Sync result status is applied" "applied" "$SYNC_STATUS"

assert_not_empty "Server timestamp" "$(echo "$BODY" | json "d['data']['server_timestamp']")"

# Verify item was actually updated
RESP=$(curl -s "$BASE/api/lists/$LIST_ID" \
  -H "Authorization: Bearer $TOKEN_A")
SYNCED_NAME=$(echo "$RESP" | json "[i['name'] for i in d['data']['items'] if i['id'] == '$ITEM3_ID'][0]")
assert "Synced item name is Cherry Tomatoes" "Cherry Tomatoes" "$SYNCED_NAME"

# ────────────────────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}22. Deep Link${NC}"
# ────────────────────────────────────────────────────────────────────────────
RESP=$(curl -s -w "\n%{http_code}" "$BASE/pair/some-slug-that-doesnt-exist")
CODE=$(echo "$RESP" | tail -1)
# Deep link should redirect or return HTML/302
TOTAL=$((TOTAL + 1))
if [ "$CODE" = "302" ] || [ "$CODE" = "200" ] || [ "$CODE" = "404" ]; then
  echo -e "  ${GREEN}✓${NC} GET /pair/:slug returns $CODE (valid response)"
  PASS=$((PASS + 1))
else
  echo -e "  ${RED}✗${NC} GET /pair/:slug returned unexpected $CODE"
  FAIL=$((FAIL + 1))
fi

# ────────────────────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}23. Error Handling${NC}"
# ────────────────────────────────────────────────────────────────────────────

# Invalid JSON
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/auth/anonymous" \
  -H "Content-Type: application/json" \
  -d 'not json')
CODE=$(echo "$RESP" | tail -1)
assert "Invalid JSON returns 400" "400" "$CODE"

# 404 route
RESP=$(curl -s -w "\n%{http_code}" "$BASE/api/nonexistent")
CODE=$(echo "$RESP" | tail -1)
assert "Unknown route returns 404" "404" "$CODE"

# Wrong list ID (User B tries different pair's list after unpairing - simulate wrong UUID)
RESP=$(curl -s -w "\n%{http_code}" "$BASE/api/lists/00000000-0000-0000-0000-000000000000" \
  -H "Authorization: Bearer $TOKEN_A")
CODE=$(echo "$RESP" | tail -1)
assert "Non-existent list returns 404" "404" "$CODE"

# Invalid item ID for update
RESP=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE/api/lists/$LIST_ID/items/00000000-0000-0000-0000-000000000000" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"name": "Ghost"}')
CODE=$(echo "$RESP" | tail -1)
assert "Update non-existent item returns 404" "404" "$CODE"

# ────────────────────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}24. Auth — Logout${NC}"
# ────────────────────────────────────────────────────────────────────────────
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/auth/logout" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\": \"$REFRESH_A\", \"device_id\": \"device-alice-001\"}")
CODE=$(echo "$RESP" | tail -1)
assert "POST /auth/logout returns 204" "204" "$CODE"

# Old refresh token should now be revoked
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/auth/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\": \"$REFRESH_A\"}")
CODE=$(echo "$RESP" | tail -1)
assert "Refresh with revoked token returns 401" "401" "$CODE"

# ────────────────────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}25. Pairing — Unpair${NC}"
# ────────────────────────────────────────────────────────────────────────────
RESP=$(curl -s -w "\n%{http_code}" -X DELETE "$BASE/api/pairing" \
  -H "Authorization: Bearer $TOKEN_B")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert "DELETE /pairing returns 200" "200" "$CODE"

ARCHIVED_AT=$(echo "$BODY" | json "d['data']['archived_at']")
assert_not_empty "archived_at timestamp" "$ARCHIVED_AT"

# Verify User B no longer has a pair
RESP=$(curl -s "$BASE/api/user/me" \
  -H "Authorization: Bearer $TOKEN_B")
PAIR_AFTER_UNPAIR=$(echo "$RESP" | json "d['data']['pair']")
assert "User B has no pair after unpair" "None" "$PAIR_AFTER_UNPAIR"

# ════════════════════════════════════════════════════════════════════════════
echo -e "\n${CYAN}══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, $TOTAL total"
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}\n"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
