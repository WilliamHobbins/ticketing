# Decisiones propuestas — Rol 1

Estas decisiones son una base inicial, no sustituyen la aprobación del equipo:
1. Users-service: Node.js 20 + TypeScript + Express.
2. Gateway: Nginx como reverse proxy.
3. Autenticación: JWT HS256 con secreto por variable de entorno; Nginx `auth_request` consulta a users-service para rutas protegidas.
4. Persistencia de usuarios: PostgreSQL, tabla `users`, contraseña con bcrypt.
5. Logs: JSON por stdout; se propaga `X-Correlation-Id`.
6. Métricas: prom-client en users-service y nginx-prometheus-exporter para Nginx.
7. Observabilidad: Prometheus + Grafana con dashboard provisionado.
8. Redis y RabbitMQ se levantan en Compose para los servicios vecinos.
9. Las rutas de catálogo, inventario y pedidos se agregan cuando se acuerden sus nombres y puertos.
10. El gateway reenvía `X-User-Id` y `X-User-Email` (identidad validada); los servicios internos no revalidan el JWT. Ver `contracts/gateway-headers.md`.
11. Rate limit: 10 req/s general y 2 req/s en login/registro, por IP.
