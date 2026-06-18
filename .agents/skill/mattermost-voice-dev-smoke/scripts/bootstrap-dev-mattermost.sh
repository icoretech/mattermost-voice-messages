#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.dev.yml}"
SITE_URL="${MM_SERVICESETTINGS_SITEURL:-${MATTERMOST_DEV_SITE_URL:-http://localhost:18065}}"
ADMIN_EMAIL="${MM_ADMIN_USERNAME:-admin@example.com}"
ADMIN_PASSWORD="${MM_ADMIN_PASSWORD:-Password1!}"
ADMIN_USERNAME="${MM_ADMIN_USER:-admin}"
TEAM_NAME="${MATTERMOST_DEV_TEAM:-example-org}"
TEAM_DISPLAY_NAME="${MATTERMOST_DEV_TEAM_DISPLAY:-Example Org}"

wait_for_mattermost() {
  local deadline=$((SECONDS + 180))
  until curl -fsS "$SITE_URL/api/v4/system/ping" >/dev/null; do
    if (( SECONDS >= deadline )); then
      echo "Mattermost did not become ready at $SITE_URL" >&2
      return 1
    fi
    sleep 2
  done
}

api_post() {
  local path="$1"
  local payload="$2"
  local token="${3:-}"
  local tmp_body
  local status
  tmp_body="$(mktemp)"
  if [[ -n "$token" ]]; then
    status="$(curl -sS -o "$tmp_body" -w '%{http_code}' \
      -H 'Content-Type: application/json' \
      -H "Authorization: Bearer $token" \
      -d "$payload" \
      "$SITE_URL$path")"
  else
    status="$(curl -sS -o "$tmp_body" -w '%{http_code}' \
      -H 'Content-Type: application/json' \
      -d "$payload" \
      "$SITE_URL$path")"
  fi
  printf '%s\n' "$status"
  cat "$tmp_body"
  rm -f "$tmp_body"
}

json_escape() {
  python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"
}

login() {
  local payload
  local tmp_headers
  local status
  payload="{\"login_id\":$(json_escape "$ADMIN_EMAIL"),\"password\":$(json_escape "$ADMIN_PASSWORD")}"
  tmp_headers="$(mktemp)"
  status="$(curl -sS -D "$tmp_headers" -o /dev/null -w '%{http_code}' \
    -H 'Content-Type: application/json' \
    -d "$payload" \
    "$SITE_URL/api/v4/users/login")"
  if [[ "$status" != "200" ]]; then
    rm -f "$tmp_headers"
    return 1
  fi
  awk 'tolower($1)=="token:" {print $2}' "$tmp_headers" | tr -d '\r'
  rm -f "$tmp_headers"
}

create_admin_if_needed() {
  local token
  if token="$(login)"; then
    printf '%s\n' "$token"
    return 0
  fi

  local payload
  payload="{\"email\":$(json_escape "$ADMIN_EMAIL"),\"username\":$(json_escape "$ADMIN_USERNAME"),\"password\":$(json_escape "$ADMIN_PASSWORD")}"
  local response
  response="$(api_post /api/v4/users "$payload")"
  local status
  status="$(printf '%s\n' "$response" | sed -n '1p')"
  if [[ "$status" != "201" && "$status" != "400" ]]; then
    printf '%s\n' "$response" >&2
    return 1
  fi

  token="$(login)"
  printf '%s\n' "$token"
}

ensure_team() {
  local token="$1"
  local payload
  payload="{\"name\":$(json_escape "$TEAM_NAME"),\"display_name\":$(json_escape "$TEAM_DISPLAY_NAME"),\"type\":\"O\"}"
  local response
  response="$(api_post /api/v4/teams "$payload" "$token")"
  local status
  status="$(printf '%s\n' "$response" | sed -n '1p')"
  if [[ "$status" != "201" && "$status" != "400" ]]; then
    printf '%s\n' "$response" >&2
    return 1
  fi
}

start_mattermost_if_needed() {
  if curl -fsS "$SITE_URL/api/v4/system/ping" >/dev/null; then
    return 0
  fi

  docker compose -f "$COMPOSE_FILE" up -d
}

main() {
  start_mattermost_if_needed
  wait_for_mattermost
  local token
  token="$(create_admin_if_needed)"
  ensure_team "$token"

  cat <<EOF
Mattermost dev stack ready:
  URL: $SITE_URL/$TEAM_NAME/channels/town-square
  Admin login: $ADMIN_EMAIL
  Admin password: $ADMIN_PASSWORD

Deploy the plugin with:
  MM_SERVICESETTINGS_SITEURL=$SITE_URL MM_ADMIN_USERNAME=$ADMIN_EMAIL MM_ADMIN_PASSWORD='$ADMIN_PASSWORD' make deploy
EOF
}

main "$@"
