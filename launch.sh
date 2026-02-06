#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✔${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✘${NC} $1"; }

ERRORS=0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "==============================="
echo "  Writer — pre-flight checks"
echo "==============================="
echo ""

# --- 1. Docker ---
echo "Docker"
if command -v docker &>/dev/null; then
    ok "docker found ($(docker --version | head -c 40))"
else
    fail "docker not found — install it first"
    ERRORS=$((ERRORS + 1))
fi

if docker info &>/dev/null; then
    ok "docker daemon is running"
else
    fail "docker daemon is not running — start Docker Desktop or the service"
    ERRORS=$((ERRORS + 1))
fi

# --- 2. Docker Compose ---
echo ""
echo "Docker Compose"
if docker compose version &>/dev/null; then
    ok "docker compose found ($(docker compose version --short))"
else
    fail "docker compose not found"
    ERRORS=$((ERRORS + 1))
fi

# --- 3. .env file & required variables ---
echo ""
echo "Environment"
ENV_FILE="${SCRIPT_DIR}/.env"

if [[ -f "$ENV_FILE" ]]; then
    ok ".env file found"
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    if [[ -n "${MISTRAL_API_KEY:-}" ]]; then
        ok "MISTRAL_API_KEY is set"
    else
        fail "MISTRAL_API_KEY is empty or missing in .env"
        ERRORS=$((ERRORS + 1))
    fi
else
    fail ".env file not found — create one with MISTRAL_API_KEY=<your key>"
    ERRORS=$((ERRORS + 1))
fi

# --- 4. Port availability ---
echo ""
echo "Ports"
for PORT in 8000 3000; do
    BUSY=0
    if ss -tlnp 2>/dev/null | grep -q ":${PORT} "; then
        BUSY=1
    elif command -v lsof &>/dev/null && lsof -i ":${PORT}" &>/dev/null; then
        BUSY=1
    fi

    if [[ $BUSY -eq 1 ]]; then
        fail "port ${PORT} is already in use"
        CONTAINER=$(docker ps --filter "publish=${PORT}" --format '{{.Names}}' 2>/dev/null || true)
        if [[ -n "$CONTAINER" ]]; then
            warn "occupied by container: ${CONTAINER}"
            read -rp "  Stop it? [Y/n] " REPLY
            REPLY="${REPLY:-Y}"
            if [[ "$REPLY" =~ ^[Yy]$ ]]; then
                docker stop "$CONTAINER" &>/dev/null && docker rm "$CONTAINER" &>/dev/null
                ok "container ${CONTAINER} stopped and removed"
            else
                ERRORS=$((ERRORS + 1))
            fi
        else
            warn "not a docker container — free the port manually"
            ERRORS=$((ERRORS + 1))
        fi
    else
        ok "port ${PORT} is available"
    fi
done

# --- 5. Project files ---
echo ""
echo "Project files"
for F in docker-compose.yml backend/Dockerfile frontend/Dockerfile backend/main.py frontend/package.json; do
    if [[ -f "${SCRIPT_DIR}/${F}" ]]; then
        ok "${F}"
    else
        fail "${F} missing"
        ERRORS=$((ERRORS + 1))
    fi
done

# --- Summary ---
echo ""
if [[ $ERRORS -gt 0 ]]; then
    echo -e "${RED}✘ ${ERRORS} problem(s) detected — fix them before launching.${NC}"
    exit 1
fi

echo -e "${GREEN}All checks passed!${NC}"
echo ""

# --- Launch ---
echo "Building & starting services…"
cd "$SCRIPT_DIR"

# Open browser once frontend is ready
(
    until curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 2>/dev/null | grep -q '200\|301\|302'; do
        sleep 2
    done
    if command -v xdg-open &>/dev/null; then
        xdg-open http://localhost:3000
    elif command -v google-chrome &>/dev/null; then
        google-chrome http://localhost:3000
    fi
) &

docker compose up --build
