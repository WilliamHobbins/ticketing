# Sistema de Tickets — Rol 1
Node.js + TypeScript, Nginx, PostgreSQL, Redis, RabbitMQ, Prometheus y Grafana.

## Requisitos
- Docker Desktop (con Docker Compose v2)
- Node.js 20+ y npm (solo si querés ejecutar users-service fuera de Docker)
- Git

## 1. Preparar configuración
```bash
cp .env.example .env
```
En Windows PowerShell:
```powershell
Copy-Item .env.example .env
```
Editá `.env`: cambiá `POSTGRES_PASSWORD`, `JWT_SECRET` y `RABBITMQ_PASSWORD` por valores propios antes de compartir o publicar el repositorio. No subas `.env` a Git.

## 2. Levantar todo
Desde la raíz del proyecto:
```bash
docker compose up --build -d
docker compose ps
```
Ver logs:
```bash
docker compose logs -f users-service gateway
```
Detener:
```bash
docker compose down
```
Borrar también los datos persistidos (¡destructivo!):
```bash
docker compose down -v
```

## 3. URLs locales
- API pública a través de Nginx: http://localhost:8080
- Health del gateway: `GET http://localhost:8080/health`
- Health de usuarios: `GET http://localhost:8080/api/v1/users/health`
- Métricas de usuarios: `users-service:3001/metrics` (solo dentro de la red de Docker; Prometheus las scrapea)
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3000
- RabbitMQ Management: http://localhost:15672

Grafana usa `GRAFANA_USER` / `GRAFANA_PASSWORD` del `.env`.

## 4. Probar registro y login
Registro:
```bash
curl -i -X POST http://localhost:8080/api/v1/users/register \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"demo@example.com\",\"password\":\"UnaClaveSegura123\",\"name\":\"Demo\"}"
```
Login:
```bash
curl -i -X POST http://localhost:8080/api/v1/users/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"demo@example.com\",\"password\":\"UnaClaveSegura123\"}"
```
La respuesta del login incluye `accessToken`. Para una ruta protegida de prueba:
```bash
curl -i http://localhost:8080/api/v1/users/me \
  -H "Authorization: Bearer PEGAR_ACCESS_TOKEN"
```
Sin token, `/api/v1/users/me` debe responder `401`.

## 5. Arquitectura y límites de esta primera versión
- Nginx es el punto de entrada público. Aplica rate limiting, asigna/propaga `X-Correlation-Id` y enruta a users-service.
- Nginx `auth_request` consulta `users-service` para validar JWT en rutas protegidas y reenvía `X-User-Id`/`X-User-Email` a los servicios internos (ver `contracts/gateway-headers.md`).
- Users-service usa PostgreSQL para persistencia, bcrypt para contraseñas, JWT para autenticación, logs JSON con Pino y métricas Prometheus.
- Redis y RabbitMQ quedan levantados para que el resto del equipo los use; este servicio todavía no publica ni consume mensajes.
- El endpoint `GET /metrics` de users-service y el exporter de Nginx se scrapean en Prometheus.
- La configuración de rutas de catálogo, inventario y pedidos se agrega cuando el equipo acuerde los nombres/puertos de esos servicios. No se enrutan todavía.
- El JWT de ejemplo usa HS256. El secreto debe ser largo, aleatorio y compartido de forma segura entre los componentes que deban validar tokens.
- Para producción harían falta, entre otras cosas, TLS, rotación/gestión de secretos, políticas de expiración y renovación de tokens, y endurecimiento adicional.

## 6. Carpetas
- `users-service/`: registro, login, JWT, `/me`, health, métricas y logs.
- `gateway/nginx.conf`: reverse proxy, rate limiting, correlation ID y validación con `auth_request`.
- `infra/`: PostgreSQL init, Prometheus y dashboard/provisioning Grafana.
- `contracts/`: espacio para OpenAPI y contratos de eventos compartidos.
- `docs/`: borrador de observabilidad y registro de uso de IA.

## 7. Verificación rápida
```bash
./scripts/smoke-test.sh   # con el stack levantado
```

## 8. Comandos útiles
```bash
docker compose logs -f
docker compose logs -f postgres
docker compose restart gateway
docker compose config
```
