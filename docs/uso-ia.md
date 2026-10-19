# Registro de uso de IA
Completar por el integrante el mismo día que use IA para una decisión. Registrar sugerencias y la decisión final del equipo.

| Fecha | Quién | Qué se le pidió | Qué sugirió | Qué decidimos nosotros |
|---|---|---|---|---|
| 2026-10-18 | Rol 1 | Proponer estructura inicial para Node.js/TypeScript, Nginx y observabilidad | Separar users-service, gateway e infraestructura; JWT validado mediante `auth_request`; Prometheus/Grafana | Pendiente de revisión y aprobación del equipo |
| 2026-10-19 | Rol 1 | Revisar el trabajo inicial del Rol 1 y corregir problemas | `/stub_status` quedaba expuesto en el puerto público; logs con campo `level` duplicado y sin correlationId en eventos de negocio; falta de `X-User-Id` hacia servicios; métricas con cardinalidad abierta en rutas 404; `npm ci` con lockfile; rate limit más estricto en login; hash dummy contra enumeración de usuarios | Aceptado y verificado con prueba end-to-end local (Nginx + users-service + PostgreSQL) y `scripts/smoke-test.sh` |
