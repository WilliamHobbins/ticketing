# users-service
Registro, login y emisión/validación de JWT (HS256). Express + TypeScript + PostgreSQL.

## Endpoints
Ver `contracts/users-service.openapi.yaml`. Resumen: `POST /api/v1/users/register`, `POST /api/v1/users/login`,
`GET /api/v1/users/me` (protegido), `GET /health`, `GET /metrics`. `GET /internal/validate` es solo para el gateway.

## Correr
Con todo el stack: `docker compose up --build` desde la raíz.
Solo el servicio (requiere un Postgres accesible):
```bash
cp .env.example .env   # ajustar DATABASE_URL y JWT_SECRET
export $(grep -v '^#' .env | xargs)
npm ci && npm run dev
```
## Verificar
`npm run typecheck` y, con el stack arriba, `../scripts/smoke-test.sh`.
