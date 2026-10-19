#!/usr/bin/env bash
# Prueba rápida del flujo de usuarios a través del gateway. Uso: ./scripts/smoke-test.sh [URL_BASE]
set -u
BASE="${1:-http://localhost:8080}"
EMAIL="smoke-$(date +%s)@example.com"; PASS="UnaClaveSegura123"; fail=0
check() { if [ "$2" = "$3" ]; then echo "OK   $1"; else echo "FAIL $1 (esperado $2, obtuvo $3)"; fail=1; fi; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

check "gateway /health"            200 "$(code "$BASE/health")"
check "users /health vía gateway"  200 "$(code "$BASE/api/v1/users/health")"
check "registro"                   201 "$(code -X POST "$BASE/api/v1/users/register" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"Smoke\"}")"
check "registro duplicado"         409 "$(code -X POST "$BASE/api/v1/users/register" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"Smoke\"}")"
check "login con clave incorrecta" 401 "$(code -X POST "$BASE/api/v1/users/login" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"incorrecta\"}")"
TOKEN=$(curl -s -X POST "$BASE/api/v1/users/login" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
check "login correcto (token)"     1 "$([ -n "$TOKEN" ] && echo 1 || echo 0)"
check "/me sin token"              401 "$(code "$BASE/api/v1/users/me")"
check "/me con token falso"        401 "$(code "$BASE/api/v1/users/me" -H 'Authorization: Bearer abc.def.ghi')"
check "/me con token válido"       200 "$(code "$BASE/api/v1/users/me" -H "Authorization: Bearer $TOKEN")"
check "/internal no expuesto"      404 "$(code "$BASE/internal/validate")"
check "ruta inexistente"           404 "$(code "$BASE/api/v1/nada")"
exit $fail
