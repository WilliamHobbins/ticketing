# Rol 3: Inventario y Reservas

## Responsabilidad del servicio
Gestiona los asientos de cada evento, las reservas temporales (holds) y evita la sobreventa.

## Modelo de datos
Cada asiento está en uno de tres estados:

- AVAILABLE: libre.
- HELD: reservado temporalmente mientras se paga. Vive solo en Redis y vence solo.
- SOLD: vendido, definitivo.

Postgres guarda la información permanente (eventos, asientos y su estado AVAILABLE o SOLD).
Redis guarda los holds, con una clave por asiento (`hold:{eventId}:{seatId}`).
Un asiento está reservado si figura AVAILABLE en Postgres y además existe su clave en Redis.

### Esquema
```sql
CREATE TABLE events (
  id          UUID PRIMARY KEY,
  name        TEXT NOT NULL,
  starts_at   TIMESTAMPTZ NOT NULL
);

CREATE TABLE seats (
  id          UUID PRIMARY KEY,
  event_id    UUID NOT NULL REFERENCES events(id),
  label       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'AVAILABLE'
              CHECK (status IN ('AVAILABLE', 'SOLD')),
  order_id    UUID,
  UNIQUE (event_id, label)
);
```

## Control de concurrencia
Para que dos personas no reserven el mismo asiento, el hold se crea con
`SET clave valor NX EX <segundos>` en Redis. NX crea la clave solo si no existe
y EX le pone un vencimiento. Como Redis ejecuta el comando de forma atómica, si
llegan dos pedidos simultáneos sobre el mismo asiento, solo uno obtiene el hold.
Al vencer el tiempo, la clave desaparece y el asiento vuelve a estar disponible.

Los holds se guardan en Redis y no en Postgres porque son datos temporales que deben vencer solos. Con SET NX EX, Redis crea la reserva solo si el asiento no tiene una, en una única operación atómica, y la elimina automáticamente al cumplirse el tiempo. En Postgres habría que programar un proceso que libere los holds vencidos y filtrar esos casos en cada consulta. Además, Redis mantiene los datos transitorios fuera de la base permanente, donde solo queda el estado definitivo (disponible o vendido).

## Decisiones de infraestructura
- Postgres propio del servicio, accedido por la variable DATABASE_URL.
- Redis accedido por la variable REDIS_URL. 
- No se usan servicios externos (como Supabase), para que todo corra con
  docker compose up y haya paridad entre desarrollo y producción.

## Stack del servicio
- Lenguaje: Node.js 20+ con TypeScript (definido por el equipo).
- Framework HTTP: Express, elegido por ser simple y maduro.
- Librerías: `pg` (Postgres), `ioredis` (Redis), `dotenv` (variables de entorno).
- Desarrollo: `tsx` para correr TypeScript directamente sin compilar a mano.

## Infraestructura local de desarrollo
Mientras no está el docker-compose base del equipo, se usan dos contenedores:

```
docker run -d --name inventory-db -e POSTGRES_USER=inventory -e POSTGRES_PASSWORD=inventory -e POSTGRES_DB=inventory -p 5432:5432 postgres:16
docker run -d --name inventory-redis -p 6379:6379 redis:7
```

El esquema se carga con `inventory-service/db/schema.sql`.

## Configuración (variables de entorno)
| Variable | Descripción | Valor de ejemplo |
|---|---|---|
| PORT | Puerto en el que escucha el servicio | 8083 |
| DATABASE_URL | Conexión a Postgres | postgres://inventory:inventory@localhost:5432/inventory |
| REDIS_URL | Conexión a Redis | redis://localhost:6379 |

El archivo `.env.example` se versiona; el `.env` real no (está en `.gitignore`).

## Cómo correr y probar el servicio
```
cd inventory-service
npm install
copy .env.example .env      # en Windows
npm run dev
curl.exe http://localhost:8083/health
```
Respuesta esperada: `{"status":"ok","service":"inventory-service"}`.

## Logs
El servicio escribe logs en la salida estándar, una línea JSON por evento, con los campos
`timestamp`, `level`, `service` y `message`, como acordó el equipo.

## 12-Factor aplicado en este servicio
- Configuración: solo por variables de entorno, con .env.example.
- Servicios de apoyo: Postgres y Redis tratados como recursos por URL.
- Port binding: el servicio escucha en la variable PORT.
- Logs: a la salida estándar en formato JSON.
- Dependencias: declaradas en package.json.
- Build, release, run: una imagen Docker inmutable por servicio; la configuración se inyecta al correr.
- Descartabilidad: arranque rápido y apagado limpio ante SIGTERM (cierra el servidor y sale).

## Docker
El servicio se empaqueta con un Dockerfile de dos etapas (compilación y ejecución),
a partir de `node:22-alpine`. Se construye y corre con:

docker build -t inventory-service .
docker run --rm -p 8083:8083 --env-file .env inventory-service

El `.env` no se incluye en la imagen (`.dockerignore`); la configuración se inyecta al
iniciar el contenedor.

<!-- En la tabla de "Configuración (variables de entorno)", agregar esta fila: -->
| HOLD_TTL_SECONDS | Duración de un hold en segundos | 600 |

## Holds (reservas temporales)

Los holds se implementan en `src/holds.ts` y se exponen en `/api/v1/holds`.

### Claves en Redis
| Clave | Valor | Para qué |
|---|---|---|
| `hold:{eventId}:{seatId}` | `holdId` | Candado del asiento, con TTL |
| `holdid:{holdId}` | clave del asiento | Índice para encontrar el asiento al liberar |

### Atomicidad
Crear el hold (`SET NX EX` más el índice por `holdId`) se hace en un script Lua, que Redis
ejecuta de una sola vez. Liberar también: el script solo borra el asiento si el `holdId`
coincide con el dueño actual, así nadie libera un hold ajeno.

### Duración (TTL)
Se configura con `HOLD_TTL_SECONDS` (por defecto 600, es decir 10 minutos). En desarrollo y
tests se usa un valor de pocos segundos para ver la expiración sin esperar.

### Probar a mano
```
curl.exe -X POST http://localhost:8083/api/v1/holds -H "Content-Type: application/json" -d "{\"eventId\":\"evento-1\",\"seatId\":\"A1\"}"
```
La primera vez responde 201 con `holdId` y `expiresAt`. Repetirlo sobre el mismo asiento
responde 409. `docker exec -it inventory-redis redis-cli TTL hold:evento-1:A1` muestra el
tiempo restante. `DELETE /api/v1/holds/{holdId}` responde 204 y el asiento vuelve a poder
reservarse.

## Estado y pendientes
- La primera versión de los holds trabaja con un solo asiento (`seatId`), usa el código de
  error `SEAT_NOT_AVAILABLE` y no lee `X-User-Id`. Hay que alinearla con el contrato:
  `seatIds` (todo o nada), `SEAT_UNAVAILABLE` con los asientos en conflicto, un único
  `holdId` por reserva y `GET /holds/{holdId}`.
- Verificar en Postgres que el asiento no esté `SOLD` antes de crear el hold.
- Expiración y publicación de `hold.expired` en RabbitMQ.
- Pasar de hold a vendido al llegar `payment.succeeded`.
- Tests de concurrencia, métricas (`GET /metrics`) y el campo `correlationId` en los logs.

## Holds con Redis (mejorado)

### Qué se implementó
Reserva temporal de asientos (hold) sobre Redis. Un hold bloquea uno o más asientos de un evento durante un tiempo limitado (`HOLD_TTL_SECONDS`, 600 s por defecto). Si el pago no llega a tiempo, los asientos vuelven a estar disponibles.

| Método y ruta | Qué hace | Respuestas |
|---|---|---|
| `POST /api/v1/holds` `{ eventId, seatIds[] }` | Crea el hold. Es todo o nada | `201 { holdId, eventId, seatIds, expiresAt }`, `409 SEAT_UNAVAILABLE`, `400`, `401` |
| `GET /api/v1/holds/{holdId}` | Consulta el hold | `200` con `status: "ACTIVE"`, `410 HOLD_EXPIRED` |
| `DELETE /api/v1/holds/{holdId}` | Libera el hold (idempotente) | `204`, `403 FORBIDDEN` si es de otro usuario |
| `POST /api/v1/holds/{holdId}/extend` | Extiende el hold | `200` con el nuevo `expiresAt`, `410 HOLD_EXPIRED` |

El usuario llega en el header `X-User-Id` (lo reenvía el gateway tras validar el JWT). Si falta, el servicio responde `401`.

### Qué guarda Redis
| Clave | Valor | Para qué |
|---|---|---|
| `seat:{eventId}:{seatId}` | `holdId`, con TTL exacto del hold | Bloquea el asiento. Se crea con SET NX EX |
| `hold:{holdId}` | Hash: `userId`, `eventId`, `seatIds` (JSON), `total`, `expiresAt` (ms) | Datos del hold. Vive 1 h más que el hold (GRACE) para que el barrido del paso 4 pueda publicar `hold.expired` |
| `holds:expiry` | Sorted set, score = vencimiento en ms | Lo usará el barrido de expiración (paso 4) |

### Cómo se garantiza "todo o nada"
La creación del hold corre como un script Lua dentro de Redis. Redis ejecuta cada script de forma atómica, así que si dos pedidos compiten por el mismo asiento, uno solo lo toma. Si algún asiento de la lista está ocupado, no se toma ninguno y se devuelve `409 SEAT_UNAVAILABLE` con los asientos en conflicto.

### Manejo de errores y cabeceras
- Formato uniforme: `{ "error": { "code": "...", "message": "..." } }`. Códigos usados: `INVALID_JSON` (400), `SEAT_UNAVAILABLE` (409), `HOLD_EXPIRED` (410), `FORBIDDEN` (403), 401, 404 y 500.
- `X-Correlation-Id` se propaga (si no llega, se genera).
- El body se valida antes de tocar Redis.

### Decisiones tomadas
- **`extend`**: nuevo vencimiento = `max(vencimiento actual, ahora + HOLD_EXTEND_SECONDS)` con `HOLD_EXTEND_SECONDS = [confirmar]`. Se usa el máximo para que extender nunca acorte un hold y para que llamarlo varias veces no acumule tiempo. La decisión original decía "desde ahora" literal; el máximo es un ajuste a confirmar con el grupo.
- **`DELETE`** exige que `X-User-Id` coincida con el dueño del hold (si no, 403). Si orders necesita liberar holds ajenos, hay que revisarlo.
- **Asientos en conflicto del 409**: van en `error.details.seatIds`. El contrato no dice dónde; hay que confirmarlo con el grupo.
- **`total`** vale 0 hasta el paso 3c (se calcula con los precios de Postgres).
- **Base de datos**: `ticketing_inventory` (el contrato decía `inventory_db`).
- **`JWT_SECRET`** no va en inventory: el gateway valida el JWT y reenvía `X-User-Id`.

### Problema encontrado (pendiente de cerrar)
Probando con `HOLD_TTL_SECONDS=30`, `expiresAt` salió a +90 s pero el TTL real en Redis fue 120 s. Hipótesis: el reloj del contenedor de Redis (VM de Docker Desktop) va unos 30 s atrás del host, y `extend` usaba `PEXPIREAT` con un timestamp absoluto del host. Solución propuesta: usar `PEXPIRE` con TTL relativo. Estado: [pendiente de verificar / resuelto: completar].

### Cómo probarlo a mano (PowerShell)
```powershell
'{"eventId":"evt-1","seatIds":["A3-12"]}' | Set-Content -Encoding ascii body.json
curl.exe -X POST http://localhost:8083/api/v1/holds -H "Content-Type: application/json" -H "X-User-Id: user-1" -d "@body.json"
```
Repetir el mismo POST con otro `X-User-Id` tiene que dar `409 SEAT_UNAVAILABLE`.

