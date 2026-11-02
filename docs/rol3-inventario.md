# Rol 3: Inventario y Reservas

## Responsabilidad del servicio
Gestiona los asientos de cada evento, las reservas temporales (holds) y evita la sobreventa.

## Modelo de datos
Cada asiento está en uno de tres estados:

- AVAILABLE: libre.
- HELD: reservado temporalmente mientras se paga. Vive solo en Redis y vence solo.
- SOLD: vendido, definitivo.

Postgres guarda la información permanente (eventos, asientos y su estado AVAILABLE o SOLD).
Redis guarda los holds, con una clave por asiento (`seat:{eventId}:{seatId}`).
Un asiento está reservado si figura AVAILABLE en Postgres y además existe su clave en Redis.

El detalle de las tablas está más abajo, en "Asientos en Postgres y consumo de `event.created`", y el esquema
completo en `inventory-service/db/schema.sql`.

## Control de concurrencia
Para que dos personas no reserven el mismo asiento, el hold se crea de forma atómica en Redis: el asiento
se toma solo si no tiene ya una clave, y la clave lleva un vencimiento (`EX`). Como Redis ejecuta cada
operación (o cada script Lua) de una sola vez, si llegan dos pedidos simultáneos sobre el mismo asiento,
solo uno obtiene el hold. Al vencer el tiempo, la clave desaparece y el asiento vuelve a estar disponible.

Los holds se guardan en Redis y no en Postgres porque son datos temporales que deben vencer solos. Redis
crea la reserva solo si el asiento no tiene una, en una única operación atómica, y la elimina
automáticamente al cumplirse el tiempo. En Postgres habría que programar un proceso que libere los holds
vencidos y filtrar esos casos en cada consulta. Además, Redis mantiene los datos transitorios fuera de la
base permanente, donde solo queda el estado definitivo (disponible o vendido).

## Decisiones de infraestructura
- Postgres propio del servicio, accedido por la variable DATABASE_URL.
- Redis accedido por la variable REDIS_URL.
- RabbitMQ accedido por la variable BROKER_URL.
- No se usan servicios externos (como Supabase), para que todo corra con
  docker compose up y haya paridad entre desarrollo y producción.

## Stack del servicio
- Lenguaje: Node.js 20+ con TypeScript (definido por el equipo).
- Framework HTTP: Express, elegido por ser simple y maduro.
- Librerías: `pg` (Postgres), `ioredis` (Redis), `amqplib` (RabbitMQ), `prom-client` (métricas) y `dotenv` (variables de entorno).
- Desarrollo: `tsx` para correr TypeScript directamente sin compilar a mano.

## Infraestructura local de desarrollo
El servicio usa la infraestructura del docker compose base del equipo: Postgres, Redis y RabbitMQ.
El esquema se aplica con `npm run migrate` (a partir de `inventory-service/db/schema.sql`).

## Configuración (variables de entorno)
| Variable | Descripción | Valor de ejemplo |
|---|---|---|
| PORT | Puerto en el que escucha el servicio | 8083 |
| DATABASE_URL | Conexión a Postgres | postgres://inventory:inventory@localhost:5432/inventory |
| REDIS_URL | Conexión a Redis | redis://localhost:6379 |
| BROKER_URL | Conexión a RabbitMQ | [completar con el valor de tu .env.example] |
| HOLD_TTL_SECONDS | Duración de un hold en segundos | 600 |
| HOLD_EXTEND_SECONDS | Segundos que suma `extend` (ver "Decisiones tomadas") | 120 |
| SWEEP_INTERVAL_SECONDS | Cada cuántos segundos corre el barrido de holds vencidos | 5 |

El archivo `.env.example` se versiona; el `.env` real no (está en `.gitignore`).
`DATABASE_URL` y `BROKER_URL` son obligatorias: si faltan, el servicio no arranca.

## Cómo correr y probar el servicio
```
cd inventory-service
npm install
copy .env.example .env      # en Windows
npm run dev
curl.exe http://localhost:8083/health
```
Respuesta esperada: `{"status":"ok","postgres":"ok","redis":"ok"}`. Si alguna dependencia no responde en
2 segundos, el estado de esa dependencia es `down`, el estado general es `degraded` y el código HTTP es 503.

Para correr los tests (con el servicio levantado y los tres contenedores arriba): `npm test`.

## Docker
El servicio se empaqueta con un Dockerfile de dos etapas (compilación y ejecución),
a partir de `node:22-alpine`. Se construye y corre con:

```
docker build -t inventory-service .
docker run --rm -p 8083:8083 --env-file .env inventory-service
```

El `.env` no se incluye en la imagen (`.dockerignore`); la configuración se inyecta al
iniciar el contenedor.

## Holds con Redis

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
| `seat:{eventId}:{seatId}` | `holdId`, con TTL exacto del hold | Bloquea el asiento |
| `hold:{holdId}` | Hash: `userId`, `eventId`, `seatIds` (JSON), `total`, `expiresAt` (ms) | Datos del hold. Vive 1 h más que el hold (GRACE) para que el barrido pueda publicar `hold.expired` |
| `holds:expiry` | Sorted set, score = vencimiento en ms | Lo recorre el barrido de expiración |

### Cómo se garantiza "todo o nada"
La creación del hold corre como un script Lua dentro de Redis. Redis ejecuta cada script de forma atómica, así que si dos pedidos compiten por el mismo asiento, uno solo lo toma. Si algún asiento de la lista está ocupado, no se toma ninguno y se devuelve `409 SEAT_UNAVAILABLE` con los asientos en conflicto. Liberar también es un script: solo borra los asientos que siguen a nombre de ese `holdId`, así nadie libera ni pisa el hold de otro.

### Manejo de errores y cabeceras
- Formato uniforme: `{ "error": { "code": "...", "message": "..." } }`. Códigos usados: `INVALID_REQUEST` y `INVALID_JSON` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `SEAT_NOT_FOUND`, `EVENT_NOT_FOUND` y `NOT_FOUND` (404), `SEAT_UNAVAILABLE` (409), `HOLD_EXPIRED` (410), `PAYLOAD_TOO_LARGE` (413) e `INTERNAL_ERROR` (500).
- `X-Correlation-Id` se propaga (si no llega, se genera) y se devuelve en la respuesta.
- El body se valida antes de tocar Redis (máximo 10 asientos por hold, sin repetidos).

### Decisiones tomadas
- **`extend`**: nuevo vencimiento = `max(vencimiento actual, ahora + HOLD_EXTEND_SECONDS)` con `HOLD_EXTEND_SECONDS = 120` por defecto [confirmar el valor con el grupo]. Se usa el máximo para que extender nunca acorte un hold y para que llamarlo varias veces no acumule tiempo. La decisión original decía "desde ahora" literal; el máximo es un ajuste a confirmar con el grupo.
- **`DELETE`** exige que `X-User-Id` coincida con el dueño del hold (si no, 403). Si orders necesita liberar holds ajenos, hay que revisarlo.
- **Asientos en conflicto del 409**: van en `error.details.seatIds`. El contrato no dice dónde; hay que confirmarlo con el grupo.
- **Base de datos**: `ticketing_inventory` (el contrato decía `inventory_db`).
- **`JWT_SECRET`** no va en inventory: el gateway valida el JWT y reenvía `X-User-Id`.

### Problema encontrado (pendiente de cerrar)
Probando con `HOLD_TTL_SECONDS=30`, `expiresAt` salió a +90 s pero el TTL real en Redis fue 120 s. Hipótesis: el reloj del contenedor de Redis (VM de Docker Desktop) va unos 30 s atrás del host, y `extend` usa `PEXPIREAT` con un timestamp absoluto del host. Solución propuesta: usar `PEXPIRE` con TTL relativo. Estado: [pendiente de verificar / resuelto: completar].

### Cómo probarlo a mano (PowerShell)
```powershell
'{"eventId":"evt-1","seatIds":["A3-12"]}' | Set-Content -Encoding ascii body.json
curl.exe -X POST http://localhost:8083/api/v1/holds -H "Content-Type: application/json" -H "X-User-Id: user-1" -d "@body.json"
```
Repetir el mismo POST con otro `X-User-Id` tiene que dar `409 SEAT_UNAVAILABLE`.

## Asientos en Postgres y consumo de `event.created`

### Qué se implementó
Inventory deja de depender solo de Redis: ahora tiene su propia copia de los asientos de cada evento en Postgres y la mantiene actualizada escuchando eventos de catalog. Esto sigue el patrón de microservicios de que cada servicio guarda en su base los datos que necesita, en lugar de consultarle a otro servicio cada vez.

1. **Consumidor de `event.created`** (RabbitMQ, exchange `ticketing.events`, routing key `event.created`). Por cada evento crea en Postgres el evento y todos sus asientos.
2. **Idempotencia** con la tabla `processed_messages`.
3. **Dead-letter queue** para mensajes inválidos.
4. **`GET /api/v1/events/{eventId}/seats`**, que combina Postgres y Redis.
5. **Total del hold** calculado con los precios de Postgres, validando que los asientos existan y no estén vendidos.
6. **`GET /health`** reporta si Postgres y Redis responden.

### Qué guarda Postgres
| Tabla | Contenido |
|---|---|
| `events` | `id`, `name`, `starts_at` |
| `seats` | clave `(event_id, seat_id)`, `sector`, `row_num`, `seat_num`, `price`, `status` (`AVAILABLE` o `SOLD`), `order_id` |
| `processed_messages` | `message_id`, `type`, `processed_at`: los mensajes ya procesados |

`HELD` no existe en Postgres: vive solo en Redis, porque es un estado temporal que se libera solo por TTL. Los ids de evento y asiento son `TEXT` (no `UUID`) porque el asiento tiene formato `sector-fila-número`.

### Consumidor de `event.created`
- **Topología**: cola `inventory.event-created` enlazada al exchange `ticketing.events`; su dead-letter queue es `inventory.event-created.dlq`, a través del exchange `ticketing.events.dlx`.
- **Una transacción por mensaje**: se registra el `messageId`, se inserta el evento y se generan los asientos con `generate_series`. Si algo falla, `ROLLBACK` y no queda nada a medias.
- **`ack` solo después del `COMMIT`**: si el servicio se cae a mitad, RabbitMQ reentrega el mensaje. Es la entrega at-least-once del contrato.
- **Idempotencia**: `INSERT ... ON CONFLICT DO NOTHING` sobre `processed_messages`. Si el `messageId` ya estaba, el mensaje se descarta como `duplicate`. Además, `ON CONFLICT DO NOTHING` en `events` y `seats` es una segunda defensa.
- **Dos tipos de error**:
  - Mensaje mal formado (JSON inválido, campos faltantes, `rows` o `seatsPerRow` no positivos): reintentarlo no lo arregla, va directo a la DLQ.
  - Error de infraestructura (por ejemplo Postgres caído): se devuelve a la cola y se reintenta cada 2 s. No se pierde ningún evento.
- **Reconexión**: si RabbitMQ no está o se cae, el servicio HTTP sigue funcionando y el consumidor reintenta conectarse cada 5 s.
- **Id de asiento**: `{sector}{fila}-{número}`, por ejemplo sector `A`, fila 3, número 12 da `A3-12`.

### `GET /api/v1/events/{eventId}/seats`
Responde `200 [{ seatId, sector, row, number, price, status }]` ordenado por sector, fila y número.
- `SOLD` y la lista de asientos salen de Postgres; `HELD` sale de Redis (clave `seat:{eventId}:{seatId}`), consultada con un solo `MGET` para todas las claves.
- Si un asiento está `SOLD` en Postgres, eso manda aunque Redis diga otra cosa.
- Evento inexistente: `404 EVENT_NOT_FOUND`.
- No exige `X-User-Id`.

### Cambios en la creación de holds
`POST /holds` consulta Postgres antes de tocar Redis:
- Asiento que no existe en el evento: `404 SEAT_NOT_FOUND` con `details.seatIds`.
- Asiento `SOLD`: `409 SEAT_UNAVAILABLE`. Esto es necesario porque la clave de Redis vence con el TTL; sin esta consulta, un asiento ya vendido volvería a poder reservarse.
- El `total` del hold es la suma de los precios, redondeada a 2 decimales.

### Cómo se probó
| Prueba | Resultado |
|---|---|
| Publicar `event.created` desde el panel de RabbitMQ | 22 asientos creados (12 del sector A, 10 del B) |
| Publicar el mismo mensaje dos veces | segunda vez `duplicate`, sin cambios en Postgres |
| Publicar un mensaje inválido | va a la DLQ, no se crea nada |
| `GET /events/evt-1/seats` | 22 asientos con precio y estado |
| Hold sobre `A1-3` | el asiento aparece `HELD` en el listado |
| Hold de `A1-2` (1500) y `B2-5` (900) | `total` = 2400 |
| Hold sobre `Z9-9` y listado de `nope` | `404 SEAT_NOT_FOUND` y `404 EVENT_NOT_FOUND` |
| Asiento marcado `SOLD` a mano | `409 SEAT_UNAVAILABLE` y `SOLD` en el listado |
| [Opcional: Postgres apagado durante el consumo] | [completar si lo hiciste, o borrar esta fila] |

### A tener en cuenta
- Códigos de error nuevos: `SEAT_NOT_FOUND` y `EVENT_NOT_FOUND` (404). El contrato solo menciona `SEAT_UNAVAILABLE`.
- `GET /events/{eventId}/seats` no requiere `X-User-Id`.
- Rol 2 (catalog): el formato del id de asiento es `{sector}{fila}-{número}` y los nombres de sector solo pueden tener letras, números, `_` y `-` (sin espacios), porque se usan en claves de Redis y en validaciones. Hay que acordar los nombres de sector.
- El front tiene que usar los `seatId` que devuelve el listado al crear un hold.

## Expiración de holds y evento `hold.expired`

### Qué hace
Cuando un hold vence, sus asientos se liberan solos (la clave `seat:*` tiene TTL en Redis). Pero Redis no avisa de forma confiable cuando una clave expira, así que inventory tiene un **barrido propio** que detecta los holds vencidos y publica `hold.expired` en RabbitMQ (exchange `ticketing.events`, routing key `hold.expired`). Quien lo consume es orders, que marca el pedido como `EXPIRED`.

### Cómo funciona el barrido (`src/sweeper.ts`)
1. Cada `SWEEP_INTERVAL_SECONDS` (por defecto 5) un script Lua atómico toma hasta 100 holds con score <= ahora y les corre el score 30 s hacia adelante (**lease**).
2. Por cada hold, lee `hold:{holdId}` y publica `hold.expired` con `data { holdId, eventId, seatIds, userId }`.
3. Solo cuando RabbitMQ **confirma** la publicación, saca el hold de `holds:expiry` (`ZREM`).
4. Si la publicación falla, no se hace nada más: el lease vence y el próximo barrido lo reintenta solo.

### Decisiones de diseño
- **Lease en vez de "ZREM y después publicar".** Si el proceso se cae entre el `ZREM` y la publicación, el evento se perdería para siempre. Con lease, el hold sigue en el índice hasta que hay confirmación.
- **Varias réplicas.** El script que toma los holds es atómico, así que dos barridos no agarran el mismo hold.
- **`messageId` determinístico.** Se calcula a partir del `holdId`, así que un reintento lleva el mismo `messageId` y el consumidor (orders) lo descarta por idempotencia.
- **Entrega at-least-once.** Si RabbitMQ recibe el mensaje pero el `ZREM` posterior falla, el evento se republica con el mismo `messageId`.
- **Publicador con canal de confirmación y conexión propia** (`src/publisher.ts`), con reconexión automática en el siguiente publish.
- **`correlationId` nuevo** por evento, porque el barrido no nace de un request.
- **Liberar a mano no genera evento.** El script de liberación hace `ZREM`, así que un `DELETE` no publica `hold.expired`.
- **`extend` durante el barrido.** Si el hold se extendió justo antes, el barrido ve que `expiresAt` es futuro y lo deja en el índice con su score real.

### Configuración y métricas
`SWEEP_INTERVAL_SECONDS` (por defecto 5). El barrido expone `holds_expired_total` y `hold_expired_publish_errors_total` en `/metrics` (ver "Observabilidad").

### Pruebas realizadas
1. **Camino feliz:** un hold con TTL de 30 s vence, el servicio loguea `hold.expired publicado`, el mensaje llega a la cola de prueba con el sobre completo y `holds:expiry` queda en 0.
2. **Liberación manual:** un hold borrado con `DELETE` sale del índice (`ZCARD` baja) y no llega ningún mensaje.
3. **RabbitMQ caído:** con el broker apagado cuando vence el hold, el publicador falla y el hold sigue en el índice; al volver el broker, el evento llega una sola vez.
4. **Con métricas (paso 7):** con `HOLD_TTL_SECONDS=5`, un hold vence y `holds_expired_total` pasa a 1, sin errores de publicación.

### Limitaciones
- El barrido compara con la hora del host y los asientos se liberan por la hora de Redis. Con relojes sincronizados no hay diferencia; se comprobó que hoy coinciden.
- La deduplicación por `messageId` no se probó a mano (requiere que falle el `ZREM` después de una publicación confirmada); está cubierta por diseño.

## Confirmación de venta (`payment.succeeded` y `payment.failed`)

### Qué hace
Inventory consume dos eventos que publica orders-service y decide qué pasa con los asientos reservados:

| Evento recibido | Qué hace inventory | Qué publica |
|---|---|---|
| `payment.succeeded` | Marca los asientos como `SOLD` en Postgres y limpia el hold en Redis. | `sale.rejected` solo si no se puede vender. |
| `payment.failed` | Libera el hold en Redis (los asientos vuelven a estar disponibles). | Nada. |

`payment.failed` no trae `eventId` ni `seatIds` (así lo define el contrato), por lo que inventory los lee del hash `hold:{holdId}` en Redis, que sigue disponible una hora después del vencimiento.

### Evento nuevo: `sale.rejected`
Se publica cuando se cobró un pedido pero los asientos ya no se pueden vender. Datos: `orderId`, `holdId`, `eventId`, `seatIds` y `reason`.

| `reason` | Cuándo ocurre |
|---|---|
| `SEAT_ALREADY_SOLD` | Algún asiento ya está vendido a **otro** pedido. |
| `SEAT_TAKEN` | Los asientos pertenecen hoy a **otro hold** activo (el hold original venció y alguien más los reservó). |
| `SEAT_NOT_FOUND` | Algún asiento no existe en el evento. |

El `messageId` se deriva del `orderId` (`deterministicUuid("sale.rejected:" + orderId)`): si el evento se publica dos veces, el consumidor lo reconoce como el mismo mensaje. Conserva el `correlationId` del `payment.succeeded` que lo originó.

### Colas
Una cola por tipo de evento, cada una con su dead-letter queue (patrón ya usado en `event.created`):

| Cola | Routing key | DLQ |
|---|---|---|
| `inventory.event-created` | `event.created` | `inventory.event-created.dlq` |
| `inventory.payment-succeeded` | `payment.succeeded` | `inventory.payment-succeeded.dlq` |
| `inventory.payment-failed` | `payment.failed` | `inventory.payment-failed.dlq` |

Un mensaje mal formado (JSON inválido, falta un campo, ids con caracteres raros) va directo a la DLQ, porque reintentarlo no lo arregla. Un error de infraestructura (Postgres o Redis caídos) se reencola con 2 segundos de espera. El `ack` se hace recién después de terminar el trabajo (principio de entrega *at-least-once*).

La lógica común (conexión, DLQ, ack/nack, reconexión cada 5 s) está en `src/messaging.ts`, y los tres consumidores la reutilizan. Archivos del paso: `src/messaging.ts`, `src/payments.ts`, `src/consumer.ts` (usa `messaging.ts`), `src/holds.ts` (funciones de reclamo y limpieza) e `src/index.ts` (arranca los consumidores).

### Flujo de `payment.succeeded`
Redis y Postgres no pueden compartir una transacción, así que el orden importa:

1. **Reclamo en Redis** (`claimSeatsForSale`, un script Lua atómico). Si los asientos siguen a nombre de este hold, o están libres (el hold venció o se liberó), quedan reservados 60 s a su nombre. Si pertenecen a **otro** hold, no toca nada y se rechaza la venta con `SEAT_TAKEN`. El mismo script saca el hold de `holds:expiry`, para que el barrido no publique `hold.expired` de un hold ya pagado.
2. **Transacción en Postgres** (`sellInPostgres`):
   - registra el `messageId` en `processed_messages`; si ya estaba, es un duplicado y termina;
   - bloquea las filas de los asientos con `SELECT ... ORDER BY seat_id FOR UPDATE`;
   - si falta algún asiento o está vendido a otro pedido, publica `sale.rejected`; si no, hace `UPDATE ... SET status='SOLD', order_id=...`;
   - `COMMIT`.
3. **Limpieza en Redis** (`releaseHoldKeys`, reutiliza el script que usa `DELETE /holds`): borra los `seat:*` que siguen siendo de este hold, el hash del hold y su entrada en `holds:expiry`.
4. `ack`.

### Decisiones de diseño
- **Vender aunque el hold haya vencido.** El dinero ya se cobró. Si los asientos están libres, se venden igual; solo se rechaza si alguien más los tiene o ya los compró.
- **Reclamo atómico en Redis antes de vender.** Si solo se consultara Redis y después se vendiera en Postgres, otro usuario podría reservar el asiento en el medio. El reclamo cierra esa ventana.
- **La limpieza nunca pisa a otro hold.** Solo se borran las claves `seat:*` cuyo valor es el `holdId` de este pago (comparación dentro del script Lua).
- **Idempotencia en dos niveles.** Por `messageId` (`processed_messages`) y por negocio: si el mismo pedido llega con otro `messageId`, los asientos ya vendidos con ese `order_id` se consideran vendidos correctamente, no rechazados.
- **Orden fijo al bloquear filas** (`ORDER BY seat_id`). Dos ventas con asientos en común no pueden quedarse esperándose mutuamente (deadlock).
- **`sale.rejected` se publica antes del `COMMIT`.** Con confirmación del broker y `messageId` determinístico. Si el `COMMIT` falla, el mensaje se reintenta y se vuelve a publicar el mismo evento, que el consumidor deduplica; nunca queda un rechazo sin avisar.
- **La limpieza corre también con mensajes duplicados.** Si el proceso se cae entre el `COMMIT` y la limpieza de Redis, el reintento termina el trabajo.
- **`payment.failed`: liberar primero, anotar el `messageId` después.** Liberar es idempotente, así que repetirlo no daña.

### Qué pasa si algo falla
| Momento del fallo | Resultado |
|---|---|
| Antes del reclamo o durante la transacción | `ROLLBACK`, el mensaje se reencola, no se vendió nada. Las claves reclamadas vencen solas a los 60 s. |
| Después del `COMMIT`, antes de limpiar Redis | El reintento ve el `messageId` ya procesado, no vuelve a vender y completa la limpieza. |
| Se publicó `sale.rejected` pero falló el `COMMIT` | El reintento publica el mismo `messageId`; no hay duplicados efectivos. |
| Redis o Postgres caídos | Error de infraestructura: el mensaje se reencola cada 2 s hasta que vuelvan. |
| Mensaje inválido | Va a la DLQ de su cola, sin reintentos. |

### Pruebas realizadas (manuales, con eventos publicados desde el panel de RabbitMQ)
Datos: evento `evt-1`. Todas con resultado esperado.

| # | Caso | Resultado observado |
|---|---|---|
| 1 | Venta normal con hold vigente | Asiento `SOLD` con el `order_id`; Redis sin `seat:*`, sin `hold:*` y sin entrada en `holds:expiry`. |
| 2 | Mismo mensaje publicado dos veces | Segundo mensaje reconocido como `duplicate`; una sola fila en `processed_messages` y una sola venta. |
| 3 | Hold liberado (simula vencimiento) con el asiento libre | Se vende igual. |
| 4 | Asiento ya vendido a otro pedido | Venta rechazada con `SEAT_ALREADY_SOLD`; el asiento conserva el pedido original; llega `sale.rejected` con el mismo `correlationId`. |
| 5 | Asiento tomado por otro hold | Rechazo con `SEAT_TAKEN`; la reserva del otro usuario queda intacta en Redis. |
| 6 | `payment.failed` | Hold liberado, asiento otra vez `AVAILABLE`, índice de vencimientos vacío, sin evento publicado. |

### Limitaciones conocidas
- **Carrera con el barrido.** Si `payment.succeeded` llega cuando el barrido ya publicó `hold.expired`, orders recibe ambos eventos. A acordar con el Rol 4 que el pago confirmado prevalece.
- **El notifier es independiente.** Emite la entrada al recibir `payment.succeeded`, sin esperar el resultado de inventory. Falta acordar con el Rol 4 qué hace orders (reembolso o aviso) al recibir `sale.rejected`.
- **`sale.rejected` necesita una cola.** Si orders no crea una cola enlazada a `ticketing.events` con la routing key `sale.rejected`, RabbitMQ descarta los mensajes en silencio.
- **La publicación ocurre con la transacción abierta.** Solo en el camino de rechazo; si RabbitMQ tarda, las filas de esos asientos quedan bloqueadas ese tiempo.
- Las ventas confirmadas y rechazadas se exponen como `sales_confirmed_total` y `sales_rejected_total{reason}` en `/metrics` (ver "Observabilidad").

### Cambios al contrato
- Evento nuevo `sale.rejected` (datos y motivos arriba): sumarlo al documento de contratos.
- Orders tiene que incluir `holdId` en `payment.failed`.

## Pruebas de concurrencia e idempotencia

### Qué se probó y por qué
El documento de decisiones pide, como definición de "terminado" del Rol 3, tests de concurrencia sobre un mismo asiento. Además se probó la idempotencia del consumidor de pagos, porque la entrega de RabbitMQ es at-least-once y un mensaje repetido no debe vender dos veces.

### Decisiones de diseño
- **Runner:** `node:test` (el nativo de Node) ejecutado con `tsx`. No agrega dependencias. El script es `npm test`.
- **Integración real, sin mocks:** los tests corren contra el Postgres, Redis y RabbitMQ del `docker compose` y contra el servicio levantado (`npm run dev`). Es lo que demuestra la concurrencia de verdad: los mocks no reproducen las carreras entre Redis y Postgres.
- **Caja negra:** los tests no importan funciones internas de `payments.ts`. Publican mensajes reales a `ticketing.events` y observan el resultado en Postgres, Redis y en una cola propia enlazada a `sale.rejected`. Así se prueba el consumidor completo, incluido el `ack`, y no hizo falta modificar el código del servicio para testearlo.
- **Evento propio:** `evt-test` (asientos `T1-1` a `T1-5`), que se recrea antes de cada test y se borra al terminar, para no tocar `evt-1`. Los `messageId` de prueba empiezan con `test-` y se limpian de `processed_messages`.
- **Configuración de TypeScript:** `tsconfig.json` compila solo `src` (build de producción) y `tsconfig.test.json` incluye también `test` para chequear tipos (`npx tsc -p tsconfig.test.json`).

### Tests

| # | Archivo | Qué verifica |
|---|---------|--------------|
| 1 | `holds.concurrency.test.ts` | 50 `POST /holds` en paralelo sobre el mismo asiento: gana exactamente uno (`201`), los otros 49 reciben `409 SEAT_UNAVAILABLE`, y en Redis el asiento queda a nombre del hold ganador. |
| 2 | `holds.concurrency.test.ts` | 50 holds sobre `[T1-1, T1-2]` y `[T1-2, T1-3]` (comparten `T1-2`): gana uno solo y el asiento exclusivo del perdedor queda libre (todo o nada). |
| 3 | `payments.idempotency.test.ts` | El mismo `payment.succeeded` publicado 3 veces: una sola fila en `processed_messages`, asiento `SOLD` a nombre de ese pedido, ningún `sale.rejected` y clave de Redis liberada. |
| 4 | `payments.idempotency.test.ts` | Dos `payment.succeeded` de pedidos distintos sobre el mismo asiento: uno vende y el otro genera `sale.rejected` (`SEAT_TAKEN` o `SEAT_ALREADY_SOLD`, según quién llegue primero); el asiento queda con un solo `order_id`. |
| 5a | `payments.edge-cases.test.ts` | `payment.failed` duplicado: una sola fila en `processed_messages`, el hold se libera, el asiento sigue `AVAILABLE` en Postgres y otro usuario puede reservarlo. |
| 5b | `payments.edge-cases.test.ts` | Hold vencido y nadie tomó el asiento: el pago prevalece y la venta se confirma. |
| 5c | `payments.edge-cases.test.ts` | Hold vencido y otro usuario ya reservó el asiento: la venta se rechaza con `SEAT_TAKEN` y no se pisa la reserva del otro usuario. |
| 6 | `metrics.test.ts` | `/metrics` responde en formato Prometheus; crear un hold sube `holds_created_total` en 1; la etiqueta de ruta usa el patrón y no el id real (3 tests). |

El vencimiento de los tests 5b y 5c se simula borrando la clave del asiento en Redis, que es lo que haría el TTL; esperar el TTL real de 10 minutos no aportaría nada más.

### Resultado
Los 10 tests pasan (`tests 10`, `pass 10`, `fail 0`) y el proceso termina solo. Los 7 primeros son de concurrencia, idempotencia y casos borde; los 3 últimos, de `metrics.test.ts`.

```
▶ Concurrencia en holds
  ✔ 50 holds en paralelo sobre el mismo asiento: gana exactamente uno (260.1457ms)
  ✔ asientos solapados: gana un solo hold y no queda nada a medias (135.6319ms)
▶ Métricas
  ✔ GET /metrics responde en formato Prometheus (68.7858ms)
  ✔ crear un hold sube holds_created_total en 1 (26.8255ms)
  ✔ la etiqueta de ruta usa el patrón y no el id real (9.6076ms)
▶ Casos borde de pagos
  ✔ payment.failed duplicado libera el hold y el asiento vuelve a estar disponible (1151.4179ms)
  ✔ hold vencido y nadie más tomó el asiento: el pago prevalece y se vende (709.39ms)
  ✔ hold vencido y otro usuario tomó el asiento: se rechaza la venta y no se pisa su reserva (567.9607ms)
▶ Idempotencia del consumidor payment.succeeded
  ✔ el mismo payment.succeeded repetido 3 veces vende una sola vez (1669.5243ms)
  ✔ dos ventas concurrentes sobre el mismo asiento: una vende y la otra se rechaza (679.5409ms)
ℹ tests 10
ℹ pass 10
ℹ fail 0
```

### Hallazgo: carrera entre `createHold` y una venta
Al revisar el código para los tests apareció una ventana chica en `createHold`:

1. Consulta a Postgres: el asiento está `AVAILABLE`.
2. En ese instante se confirma una venta de ese asiento, se hace el `COMMIT` y se borra su clave de Redis.
3. El script Lua encuentra la clave libre y reserva un asiento que ya está `SOLD`.

**Corrección:** después de reservar en Redis, `createHold` vuelve a consultar Postgres. Si algún asiento está `SOLD`, libera las claves (`releaseHoldKeys`, que solo borra las que siguen a nombre de ese hold) y responde `409 SEAT_UNAVAILABLE`. Si la venta se confirma después del Lua, el reclamo de la venta choca con el hold en Redis y se rechaza con `SEAT_TAKEN`. Costo: una consulta más por hold.

**Prueba manual de la carrera:** se forzó con una pausa temporal de 10 s en `createHold` y marcando `B1-3` como `SOLD` en Postgres a los 3 s. Resultado: `409 SEAT_UNAVAILABLE` con `B1-3` en `details.seatIds`, en 10.24 s (rechazado por la re-verificación y no por el primer chequeo), sin clave `seat:evt-1:B1-3` en Redis y con `holds:expiry` en 0. Sin la corrección habría respondido `201` con la clave colgada en Redis. La pausa y los logs temporales se quitaron antes del commit.

### Problemas encontrados al testear
- **Conexión duplicada a RabbitMQ en los tests:** al publicar dos mensajes a la vez, cada uno abría su propia conexión y una quedaba sin cerrar, con lo que el proceso de test no terminaba. Se identificó listando los sockets abiertos (la conexión sobrante apuntaba al puerto 5672) y se corrigió guardando la promesa de conexión para que las llamadas simultáneas la compartan.
- **Primeras corridas de la prueba manual:** dieron `201` aunque el código ya tenía la re-verificación. No se pudo confirmar la causa; lo más probable es que el servicio no hubiera recargado el último guardado. Funcionó al volver a guardar el archivo con logs de depuración.

### Limitaciones conocidas
- Los tests necesitan el servicio y los tres contenedores levantados; si no, fallan con un mensaje que lo indica.
- `metrics.test.ts` usa el evento `evt-1` con el asiento `A1-3` libre (datos de ejemplo).
- En el test 4 el motivo del rechazo varía entre corridas (`SEAT_TAKEN` o `SEAT_ALREADY_SOLD`), porque depende de quién llegue primero. El test acepta ambos.
- No hay tests automáticos de la expiración real por TTL ni del barrido que publica `hold.expired`; eso se probó a mano (pasos 4 y 7).

## Observabilidad: métricas y logs

### Qué se implementó
El documento de decisiones pide que todos los servicios expongan `GET /metrics` y escriban logs JSON con `correlationId`. Inventory lo cumple con dos módulos chicos: `src/metrics.ts` y `src/logger.ts`.

### Métricas (`GET /metrics`)
Se usa la librería `prom-client`, que genera el formato de texto de Prometheus. Todas las métricas llevan la etiqueta `service="inventory-service"`. La ruta no lleva el prefijo `/api/v1`, igual que `/health`.

| Métrica | Tipo | Qué cuenta |
|---|---|---|
| `http_requests_total{method,route,status}` | contador | Requests atendidos |
| `http_request_duration_seconds{method,route,status}` | histograma | Latencia de los requests |
| `holds_created_total` | contador | Holds creados con éxito |
| `holds_expired_total` | contador | Holds vencidos cuyo `hold.expired` se publicó |
| `hold_expired_publish_errors_total` | contador | Fallos al publicar `hold.expired` (se reintentan solos) |
| `sales_confirmed_total` | contador | Ventas confirmadas (asientos pasados a `SOLD`) |
| `sales_rejected_total{reason}` | contador | Ventas rechazadas, por motivo |
| `holds_released_by_payment_total` | contador | Holds liberados por un `payment.failed` |
| `process_*`, `nodejs_*` | varios | Métricas estándar del proceso (CPU, memoria, event loop) |

### Decisiones de diseño
- **`prom-client` en vez de armar el formato a mano.** Genera solo el formato de Prometheus y el histograma de latencia. Cuesta una dependencia más.
- **La etiqueta `route` usa el patrón de la ruta** (`/api/v1/holds/:holdId`) y no la URL real. Si usara la URL real, cada `holdId` crearía una serie nueva y las métricas crecerían sin límite. Los requests que ninguna ruta atiende (404) se agrupan bajo `route="unmatched"`.
- **Express vacía `req.baseUrl` cuando el request sale del router.** La primera versión dejó la ruta como `/:holdId`; se corrigió guardando la base en cada router (`captureBase`) mientras el request todavía está dentro.
- **Los contadores en memoria de los pasos 4 y 5 se reemplazaron** por contadores de `prom-client`, para tener una sola fuente de verdad. `sales_rejected_total` lleva la etiqueta `reason`, que solo puede valer `SEAT_TAKEN`, `SEAT_ALREADY_SOLD` o `SEAT_NOT_FOUND`.
- **`holds_created_total` se incrementa al final de `createHold`**, después de la re-verificación en Postgres, así que solo cuentan los holds que realmente quedaron creados.
- **Las consultas a `/metrics` no se cuentan** como requests, para no inflar los números cada vez que Prometheus consulta.

### Logs
Cada evento es una línea JSON en la salida estándar, con los campos `timestamp`, `level`, `service`, `correlationId` y `message`, más los campos propios de cada evento (`holdId`, `orderId`, `queue`, etc.). Se escribe con un logger propio de unas 50 líneas (`src/logger.ts`), sin librería.

```json
{"timestamp":"2026-11-01T23:44:02.424Z","level":"warn","service":"inventory-service","correlationId":"8ec730f0-d462-49e1-90f8-f1a3dff7fbcb","message":"Venta rechazada","orderId":"o-test-X","holdId":"0287f878-76cf-447b-8f8c-1b318d9dd1cf","reason":"SEAT_TAKEN"}
```

- **Origen del `correlationId`:** en los requests HTTP es el header `X-Correlation-Id` (si no llega, se genera uno). En los consumidores se toma del sobre del mensaje de RabbitMQ. El barrido de holds genera uno nuevo por cada `hold.expired`, porque no nace de un request. Si un mensaje está tan mal formado que no se puede leer, el campo sale `null`.
- **Un log por request** (`message: "request"`, con método, ruta, status y duración). `/health` y `/metrics` se excluyen para no llenar el log de consultas automáticas.
- **No queda ningún `console.*` en `src`**: toda la salida es JSON, incluidos los arranques, los errores de conexión y la migración.
- Con esto se puede seguir una compra de punta a punta: el mismo `correlationId` aparece en el `payment.succeeded` recibido, en el `sale.rejected` publicado y en el log de `mensaje procesado`.

### Pruebas realizadas
| # | Prueba | Resultado |
|---|---|---|
| 1 | `GET /metrics` | Formato Prometheus con la etiqueta `service` |
| 2 | Cuatro requests (`/health`, un `holdId` inválido, el listado de asientos y una ruta inexistente) | Quedan registrados con las rutas `/health`, `/api/v1/holds/:holdId`, `/api/v1/events/:eventId/seats` y `unmatched` |
| 3 | Crear y liberar un hold a mano | `holds_created_total` sube en 1 |
| 4 | `npm test` completo, y luego `/metrics` | `holds_created_total` = 9, `sales_confirmed_total` = 3, `sales_rejected_total{reason="SEAT_TAKEN"}` = 2 y `holds_released_by_payment_total` = 1, que coincide con lo que hacen los tests |
| 5 | Request con `X-Correlation-Id: prueba-123` | El log lo conserva; sin header, genera un uuid |
| 6 | Hold con `HOLD_TTL_SECONDS=5`, esperando el vencimiento | `holds_expired_total` = 1, `hold_expired_publish_errors_total` = 0, y el log `hold.expired publicado` (que sale solo después de la confirmación de RabbitMQ) |
| 7 | Test automático `test/metrics.test.ts` | Pasa. Verifica el formato, que crear un hold sube el contador en 1 y que la etiqueta usa el patrón y no el id real |

### Limitaciones conocidas
- Los contadores viven en memoria y vuelven a cero cuando el servicio se reinicia. Prometheus lo tolera, porque calcula con `rate()`.
- Para ver las métricas en Prometheus o Grafana hace falta que `infra/prometheus.yml` tenga a inventory-service como target (configuración del Rol 1). El dashboard es uno solo y está a cargo del Rol 1; las consultas útiles son `rate(http_requests_total[1m])`, `holds_created_total` y `sales_rejected_total`.
- Los logs no tienen rotación ni archivo: salen por la salida estándar, y lo que haga con ellos es responsabilidad del entorno (12-Factor).

## 12-Factor aplicado en este servicio
- Codebase: un repositorio (monorepo) y un artefacto desplegable por servicio.
- Dependencias: declaradas en package.json.
- Configuración: solo por variables de entorno, con .env.example.
- Servicios de apoyo: Postgres, Redis y RabbitMQ tratados como recursos por URL.
- Build, release, run: una imagen Docker inmutable por servicio; la configuración se inyecta al correr.
- Procesos: servicio sin estado propio; el estado vive en Postgres y Redis.
- Port binding: el servicio escucha en la variable PORT.
- Concurrencia: se escala levantando más réplicas; el barrido de holds es seguro con varias réplicas (script atómico con lease).
- Descartabilidad: arranque rápido y apagado limpio ante SIGTERM (cierra el servidor y sale).
- Paridad dev/prod: el mismo docker compose para todos.
- Logs: a la salida estándar, una línea JSON por evento y con `correlationId`; no hay archivos ni rotación dentro del servicio.
- Procesos administrativos: la migración del esquema es un script aparte (`npm run migrate`), no parte del arranque del servicio.

## Pendientes y puntos a acordar con el grupo
- Confirmar el valor de `HOLD_EXTEND_SECONDS` y la regla de `extend` (`max(actual, ahora + extensión)`).
- Cerrar el problema del reloj de Redis en `extend` (ver "Problema encontrado").
- Acordar con el Rol 2 los nombres de sector y el formato del id de asiento.
- Acordar con el Rol 4: que el pago confirmado prevalece sobre `hold.expired`, qué hace orders al recibir `sale.rejected` (y que cree su cola), y que `payment.failed` incluya `holdId`.
- Sumar `sale.rejected` y los códigos de error nuevos al documento de contratos.
- Conectar inventory-service a Prometheus (`infra/prometheus.yml`) con el Rol 1 y pasarle las métricas para el dashboard de Grafana.