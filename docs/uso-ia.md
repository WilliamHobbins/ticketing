# Registro de uso de IA

Cada integrante anota el mismo día que usa IA para una decisión. Para cada caso se registra qué se le pidió, qué sugirió y qué decidimos nosotros. El registro está agrupado por rol y en orden de fecha.

**Contenido:** [Rol 1: William](#rol-1-william) · [Rol 2: Tomás](#rol-2-tomás) · [Rol 3: Lucas](#rol-3-lucas) · [Rol 4: Juan](#rol-4-juan)

---

## Rol 1

### 18/10/2026: Estructura inicial del proyecto
- **Qué se le pidió:** proponer una estructura inicial para Node.js/TypeScript, Nginx y observabilidad.
- **Qué sugirió:** separar users-service, gateway e infraestructura; JWT validado mediante `auth_request`; Prometheus y Grafana.
- **Qué decidimos:** lo presentamos al equipo como base inicial (`docs/decisiones-rol-1.md`) y no como decisión cerrada. Hoy el gateway, users-service y la infraestructura corren integrados con los demás servicios en el mismo compose.

### 19/10/2026: Revisión del trabajo inicial
- **Qué se le pidió:** revisar el trabajo inicial del Rol 1 y corregir problemas.
- **Qué sugirió:** detectó que `/stub_status` quedaba expuesto en el puerto público, logs con el campo `level` duplicado y sin `correlationId` en eventos de negocio, falta de `X-User-Id` hacia los servicios, métricas con cardinalidad abierta en rutas 404, `npm ci` con lockfile, un rate limit más estricto en login y un hash dummy contra la enumeración de usuarios.
- **Qué decidimos:** aplicamos las correcciones y las comprobamos con una prueba end-to-end local (Nginx, users-service y PostgreSQL) y con `scripts/smoke-test.sh`.

### 27/10/2026: Integración del catálogo en el compose y el gateway
- **Qué se le pidió:** revisar el `docker-compose.yml` y el `nginx.conf` para integrar el catálogo y entender por qué fallaba el arranque.
- **Qué sugirió:** faltaba el `.env`; había que corregir la base del catálogo, la carpeta del front y un bloque duplicado en Nginx, y resolver la autenticación según el método HTTP.
- **Qué decidimos:** aplicamos los cambios y levantamos el stack con Docker. Las lecturas del catálogo quedaron públicas y las escrituras exigen JWT.

---

## Rol 2: Tomás

### 27/10/2026: Modelo de sedes, sectores y asientos
- **Qué se le pidió:** cómo modelar sedes, sectores y asientos.
- **Qué sugirió:** generar los asientos a partir del sector (filas por asientos por fila), con el precio según el sector.
- **Qué decidimos:** lo adoptamos y dejamos la disponibilidad real en inventario. La tabla de estado de asientos del catálogo quedó solo como dato de demostración.

### 27/10/2026: Compra en el front sin servicio de pedidos
- **Qué se le pidió:** qué hacer con la compra en el front mientras no existe el servicio de pedidos.
- **Qué sugirió:** simular la compra y marcarla como tal hasta que exista pedidos.
- **Qué decidimos:** lo adoptamos como solución provisoria, dejando anotado que había que conectarlo con pedidos. Esa conexión quedó hecha el 10/11.

### 03/11/2026: Cómo consumir el catálogo desde el front
- **Qué se le pidió:** qué contrato de datos y qué ruta de acceso conviene para consumir el catálogo desde el front.
- **Qué sugirió:** consumir `GET /api/v1/catalog/events` y `/events/:id` con `fetch` a través del gateway (mismo origen, sin CORS), con tipos TypeScript para el contrato.
- **Qué decidimos:** lo adoptamos. El catálogo solo aporta los datos del evento, y el estado de asientos que trae quedó como demostración.

### 05/11/2026: Catálogo o inventario para mostrar el evento
- **Qué se le pidió:** qué conviene usar al mostrar el evento: lo que trae el catálogo o lo que trae el inventario.
- **Qué sugirió:** tomar el plano de `GET /events/:id/seats` de inventario y reservar con holds (`POST /holds`) con cuenta regresiva, opción de extender o cancelar, refresco del plano cada 15 s y liberación al salir de la pantalla.
- **Qué decidimos:** lo adoptamos: inventario es la fuente de verdad de la disponibilidad. Eso nos llevó a corregir diferencias entre el catálogo y el inventario.

### 07/11/2026: Sesión y selección de asientos al pedir login
- **Qué se le pidió:** dónde guardar la sesión y qué pasa con la selección de asientos al pedir login.
- **Qué sugirió:** pantallas de ingreso y registro con validación, token JWT en `sessionStorage` enviado como `Bearer`, y guardado de la selección para retomarla después del login.
- **Qué decidimos:** lo adoptamos en parte. La sesión dura lo que dura la pestaña, y para la pantalla de "Mi cuenta" decidimos no mostrar el ID del usuario.

### 10/11/2026: Reintentos en el pago y estados del pedido
- **Qué se le pidió:** cómo debe comportarse el front ante reintentos y cortes en el pago, y cómo mostrar el estado del pedido.
- **Qué sugirió:** crear el pedido con `{ holdId }`, pagar con `Idempotency-Key` (reintentar con la misma clave ante cortes o pago en curso), consultar las entradas hasta que se emitan, y pantallas de "Mis pedidos" y detalle con estados.
- **Qué decidimos:** lo adoptamos. El pedido, la reserva y las entradas son reales; solo el pago sigue simulado (`mock`).

### 14/11/2026: Imagen de fondo
- **Qué se le pidió:** crear una imagen de fondo para el sistema de tickets que represente distintos tipos de eventos: candombe, fútbol, rugby, conciertos y charlas.
- **Qué sugirió:** un diseño panorámico con tambores, público en conciertos, pelotas deportivas, elementos musicales y un orador, con estética moderna.
- **Qué decidimos:** no aprobamos la primera versión: pedimos cambiarla por un fondo claro y recién tras esa iteración se aprobó el diseño.

### Desarrollo del front con IA (varias sesiones)
- **Qué se le pidió:** desarrollo del front con ayuda de IA.
- **Qué sugirió:** gran parte del front (botones, fondos y la forma de resolver cada pantalla) la generó la IA.
- **Qué decidimos:** no quedarnos con la primera propuesta. Buscamos una forma atractiva que no fuera ni una venta de tickets estándar ni una página genérica de IA, y la fuimos puliendo.

---

## Rol 3: Lucas

### 17/10/2026: Diseño del inventario y las reservas
- **Qué se le pidió:** cómo diseñar el inventario y las reservas temporales de asientos.
- **Qué sugirió:** asientos AVAILABLE/SOLD en Postgres y holds en Redis con SET NX EX.
- **Qué decidimos:** lo tomamos como punto de partida y lo ajustamos en el diseño detallado del 25/10: `HELD` pasó a vivir solo en Redis y las claves se rediseñaron.

### 17/10/2026: Supabase o Postgres propio
- **Qué se le pidió:** si usar Supabase para la base de datos.
- **Qué sugirió:** usar el Postgres del docker-compose: se levanta con `docker compose up`, una base por servicio y paridad dev/prod.
- **Qué decidimos:** usamos Postgres en Docker y no Supabase, para no depender de un servicio externo.

### 17/10/2026: Estructura base del servicio
- **Qué se le pidió:** estructura base del servicio de inventario con Node y TypeScript.
- **Qué sugirió:** Express como framework, `pg` para Postgres, `ioredis` para Redis, `dotenv` y `tsx` para desarrollo.
- **Qué decidimos:** armamos el servicio con esa estructura, sobre el lenguaje que ya había definido el equipo.

### 19/10/2026: Empaquetado en Docker
- **Qué se le pidió:** cómo empaquetar el servicio de inventario en Docker.
- **Qué sugirió:** Dockerfile de dos etapas (compilar y ejecutar) con `node:22-alpine` y `.dockerignore` para no incluir el `.env`.
- **Qué decidimos:** adoptamos el Dockerfile y el `.dockerignore`. El apagado ordenado ante SIGTERM se implementó más tarde, al cerrar el factor de descartabilidad del 12-Factor.

### 19/10/2026: Atomicidad de los holds
- **Qué se le pidió:** cómo hacer atómicos crear y liberar un hold y cómo encontrar el asiento a partir del `holdId`.
- **Qué sugirió:** scripts Lua en Redis y dos claves: `hold:{eventId}:{seatId}` (candado) y `holdid:{holdId}` (índice).
- **Qué decidimos:** lo probamos con `curl` (201, 409 al repetir, TTL bajando y liberación). Este diseño de claves se reemplazó el 25/10 por `seat:`, `hold:` y `holds:expiry`, porque el hold tenía que sobrevivir al asiento para poder publicar `hold.expired`.

### 20/10/2026: Duración del hold
- **Qué se le pidió:** qué duración darle al hold.
- **Qué sugirió:** entre 5 y 15 minutos, configurable por variable de entorno.
- **Qué decidimos:** elegimos 600 s (10 min) en `HOLD_TTL_SECONDS`. Al ser variable de entorno, las pruebas de expiración se hicieron con TTL de 5 y 30 s sin tocar el código.

### 25/10/2026: Reserva temporal con Redis
- **Qué se le pidió:** diseñar la reserva temporal de asientos con Redis, con creación todo o nada.
- **Qué sugirió:** script Lua atómico, claves `seat:`, `hold:` y `holds:expiry`, y mantener `hold:` 1 h más que el TTL para poder publicar `hold.expired`.
- **Qué decidimos:** adoptamos las tres claves y el script Lua. El hash de `hold:` se conserva con una gracia de 1 h por la razón de `hold.expired`.

### 25/10/2026: Cómo se extiende un hold
- **Qué se le pidió:** definir cómo se extiende un hold.
- **Qué sugirió:** nuevo vencimiento = `max(actual, ahora + HOLD_EXTEND_SECONDS)`, para que extender no acorte ni acumule.
- **Qué decidimos:** la decisión original decía "desde ahora" a secas. Nos quedamos con el máximo porque con la suma simple llamar varias veces a `extend` acumulaba tiempo y un hold podía acortarse.

### 25/10/2026: Tablas de asientos e idempotencia
- **Qué se le pidió:** diseñar las tablas de asientos y la idempotencia del consumidor.
- **Qué sugirió:** ids de texto `sector-fila-número`, columnas `price`, `sector`, fila y número, y la tabla `processed_messages`.
- **Qué decidimos:** adoptado, con `HELD` solo en Redis. Los ids son `TEXT` y no `UUID` porque el formato del asiento no lo es.

### 25/10/2026: Consumo de `event.created`
- **Qué se le pidió:** consumir `event.created` sin duplicar asientos ni perder mensajes.
- **Qué sugirió:** una transacción por mensaje con el `messageId`, `ack` después del `COMMIT`, DLQ para mensajes inválidos y reintento para errores de infraestructura.
- **Qué decidimos:** adoptado completo. Lo verificamos publicando desde el panel de RabbitMQ: asientos creados, mensaje repetido como `duplicate` y mensaje inválido a la DLQ.

### 25/10/2026: Listado de asientos con estado HELD
- **Qué se le pidió:** resolver el listado de asientos con estado HELD.
- **Qué sugirió:** combinar Postgres (SOLD y existencia) con una consulta `MGET` a Redis (HELD).
- **Qué decidimos:** adoptado. Si Postgres dice `SOLD`, eso manda sobre lo que diga Redis.

### 25/10/2026: Total del hold
- **Qué se le pidió:** calcular el total del hold.
- **Qué sugirió:** validar en Postgres que existan y no estén SOLD antes de reservar, porque la clave de Redis vence con el TTL y un asiento vendido podría volver a reservarse.
- **Qué decidimos:** adoptado. Agregamos los códigos `SEAT_NOT_FOUND` y `EVENT_NOT_FOUND`, que el contrato no tenía, y quedaron anotados para el grupo.

### 25/10/2026: Barrido de holds vencidos
- **Qué se le pidió:** diseñar el barrido de holds vencidos y la publicación de `hold.expired`.
- **Qué sugirió:** lease en vez de ZREM antes de publicar, `messageId` determinístico a partir del `holdId` y publicador con canal de confirmación y conexión propia.
- **Qué decidimos:** adoptamos las tres ideas y las probamos con el camino feliz, la liberación manual y el broker caído. El desfase de reloj en `extend` lo dejamos documentado como mejora.

### 01/11/2026: Confirmación de venta con `payment.succeeded`
- **Qué se le pidió:** diseño de cómo confirmar la venta cuando llega `payment.succeeded`, sabiendo que Redis y Postgres no comparten transacción.
- **Qué sugirió:** orden Redis, Postgres, Redis: reclamar en Redis con un script atómico, vender en una transacción de Postgres y limpiar Redis al final.
- **Qué decidimos:** adoptado el orden. Decidimos además vender aunque el hold haya vencido si los asientos están libres (el dinero ya se cobró) y sacar el hold del índice de vencimientos al pagar.

### 01/11/2026: Bloqueo de filas e idempotencia de ventas
- **Qué se le pidió:** cómo evitar que dos ventas con asientos en común se bloqueen entre sí y que un reintento venda dos veces.
- **Qué sugirió:** bloquear las filas con `SELECT ... ORDER BY seat_id FOR UPDATE` y tratar como vendidos los asientos que ya tienen el mismo `order_id`.
- **Qué decidimos:** adoptado y verificado con las pruebas manuales 2 y 4 (mensaje duplicado y asiento vendido a otro pedido).

### 01/11/2026: Aviso de venta rechazada
- **Qué se le pidió:** cómo avisar a orders cuando se cobra un pedido que no se puede vender, sin perder el aviso si algo falla.
- **Qué sugirió:** publicar `sale.rejected` antes del `COMMIT`, con confirmación del broker y `messageId` derivado del `orderId`.
- **Qué decidimos:** el nombre del evento y los motivos (`SEAT_ALREADY_SOLD`, `SEAT_TAKEN`, `SEAT_NOT_FOUND`) los definimos nosotros. Lo coordinamos con el Rol 4, que consume `sale.rejected` y pasa el pedido a `REFUNDED`.

### 01/11/2026: Estructura de los consumidores
- **Qué se le pidió:** estructura de los consumidores nuevos sin copiar código.
- **Qué sugirió:** extraer conexión, DLQ, ack/nack y reconexión a `src/messaging.ts` y reutilizarla en los tres consumidores.
- **Qué decidimos:** la separación en una cola por tipo de evento, cada una con su DLQ, fue decisión nuestra. Probamos cada cola con mensajes desde el panel de RabbitMQ.

### 01/11/2026: Tests de concurrencia
- **Qué se le pidió:** armar los tests de concurrencia del inventario: framework y cómo probar contra servicios reales.
- **Qué sugirió:** runner nativo de Node (`node:test` con `tsx`) y tests de integración contra Postgres, Redis y RabbitMQ del compose, de caja negra para no exportar funciones internas.
- **Qué decidimos:** adoptamos `node:test` y la caja negra. Usamos un evento propio `evt-test` que se limpia al terminar, para no tocar los datos de `evt-1`.

### 01/11/2026: Revisión de `createHold`
- **Qué se le pidió:** revisar `createHold` antes de escribir los tests de concurrencia.
- **Qué sugirió:** detectó una carrera: una venta confirmada entre la consulta a Postgres y la reserva en Redis podía dejar un hold sobre un asiento ya vendido. Propuso re-verificar en Postgres después de reservar.
- **Qué decidimos:** incluimos la corrección en un commit aparte y la probamos forzando la carrera con una pausa de 10 s: respuesta `409` y Redis limpio. Sin la corrección respondía `201`.

### 01/11/2026: Respuestas `201` inesperadas en la prueba de la carrera
- **Qué se le pidió:** entender por qué la prueba de esa carrera daba `201` en las primeras corridas.
- **Qué sugirió:** varias hipótesis: código sin recargar, proceso viejo en el puerto o dos bases distintas. Propuso logs temporales.
- **Qué decidimos:** descartamos las dos últimas hipótesis con comprobaciones. La causa exacta de las primeras corridas quedó sin confirmar; con los logs funcionó y los quitamos antes del commit.

### 01/11/2026: Error de TypeScript en `test/`
- **Qué se le pidió:** resolver el error de TypeScript en `test/` (`rootDir`).
- **Qué sugirió:** separar la compilación: `include: ["src"]` en `tsconfig.json` y un `tsconfig.test.json` que también incluye `test`.
- **Qué decidimos:** adoptado, así el build de producción no compila los tests.

### 01/11/2026: Tests de idempotencia y casos borde de pagos
- **Qué se le pidió:** tests de idempotencia y ventas concurrentes (`payment.succeeded`) y casos borde (`payment.failed` duplicado, pago sobre hold vencido).
- **Qué sugirió:** publicar mensajes reales con una conexión propia y escuchar `sale.rejected` en una cola exclusiva creada antes de publicar. Simular el vencimiento borrando la clave del asiento.
- **Qué decidimos:** adoptamos el diseño. El test 4 acepta `SEAT_TAKEN` o `SEAT_ALREADY_SOLD` porque depende de quién llegue primero, y el vencimiento se simula en lugar de esperar el TTL real.

### 01/11/2026: Proceso de test que no terminaba
- **Qué se le pidió:** diagnosticar un proceso de test que no terminaba.
- **Qué sugirió:** listar los sockets abiertos al final de la corrida: el sobrante apuntaba al 5672 porque dos publicaciones simultáneas abrían dos conexiones.
- **Qué decidimos:** corregimos guardando la promesa de conexión. Descartamos `--test-force-exit` porque tapaba el problema en lugar de resolverlo.

### 01/11/2026: Endpoint `GET /metrics`
- **Qué se le pidió:** cómo exponer `GET /metrics` con holds creados y vencidos, y cantidad y latencia de requests.
- **Qué sugirió:** `prom-client` con registro propio, etiqueta `service`, métricas estándar del proceso y dos métricas HTTP (contador e histograma), sin contar las consultas a `/metrics`.
- **Qué decidimos:** adoptado y verificado con `curl` y con `test/metrics.test.ts`.

### 01/11/2026: Etiquetas de ruta sin series infinitas
- **Qué se le pidió:** cómo etiquetar los requests por ruta sin generar series infinitas.
- **Qué sugirió:** usar el patrón de la ruta (`/api/v1/holds/:holdId`) y no la URL real.
- **Qué decidimos:** la primera versión dejó la ruta como `/:holdId` porque Express vacía `req.baseUrl` al salir del router. Lo corregimos guardando la base en cada router (`captureBase`) y lo verificamos con cuatro rutas.

### 01/11/2026: Contadores en memoria de los pasos 4 y 5
- **Qué se le pidió:** qué hacer con los contadores en memoria de los pasos 4 y 5 (`sweeperStats`, `paymentStats`).
- **Qué sugirió:** reemplazarlos por contadores de `prom-client`, con etiqueta `reason` en las ventas rechazadas.
- **Qué decidimos:** adoptado. Comprobamos con `npm test` que los valores de `/metrics` coinciden con lo que hace cada test.

### 01/11/2026: Logs JSON con `correlationId`
- **Qué se le pidió:** cómo escribir logs JSON con `correlationId`, sin agregar otra dependencia.
- **Qué sugirió:** un `logger.ts` propio de unas 50 líneas, un log por request (sin `/health` ni `/metrics`) y lectura del `correlationId` del mensaje de RabbitMQ.
- **Qué decidimos:** adoptado, reemplazando los `console.*` un archivo por commit. Un `Select-String` detectó tres archivos que se nos habían pasado (`db`, `redis`, `migrate`) y los corregimos.

### 01/11/2026: Comprobación de `holds_expired_total` y `hold.expired`
- **Qué se le pidió:** comprobar `holds_expired_total` y la publicación de `hold.expired`, que los tests no cubren.
- **Qué sugirió:** arrancar el servicio con `HOLD_TTL_SECONDS=5`, crear un hold, esperar y mirar el contador y el log.
- **Qué decidimos:** hecho a mano: contador en 1, sin errores de publicación y log `hold.expired publicado`.

---

## Rol 4: Chino

### 22/10/2026: Framework y acceso a PostgreSQL
- **Qué se le pidió:** comparar opciones de framework y de acceso a PostgreSQL para orders-service.
- **Qué sugirió:** Express (simple, curva de aprendizaje baja) frente a NestJS; `pg` con SQL directo frente a Prisma.
- **Qué decidimos:** elegimos Express y `pg` directo por simplicidad y por el control explícito de las transacciones, que es lo crítico para la idempotencia, el outbox y la saga. Descartamos Prisma por la curva de aprendizaje.

### 22/10/2026: Análisis de los contratos
- **Qué se le pidió:** analizar los contratos del grupo desde el punto de vista de pedidos y notificaciones.
- **Qué sugirió:** señaló huecos: el notifier no tiene HTTP y nadie podía leer las entradas, la carrera entre la expiración del hold y el pago, qué pasa tras un pago fallido, y que faltaban `userId` y `total` en el hold.
- **Qué decidimos:** llevamos los puntos al grupo. `ticket.issued` pasó a ser obligatorio y orders guarda las entradas para servirlas en `GET /orders/{id}/tickets`.

### 22/10/2026: Carrera entre expiración del hold y pago
- **Qué se le pidió:** resolver la carrera entre la expiración del hold y el pago.
- **Qué sugirió:** extender el hold al empezar el pago o rechazar el pago.
- **Qué decidimos:** Lucas, desde inventario, propuso `POST /holds/{id}/extend` más `sale.rejected` como plan B, y el grupo adoptó esa combinación. Orders extiende el hold justo antes de cobrar.

### 26/10/2026: Idempotencia del pago y eventos sin pérdida
- **Qué se le pidió:** diseñar cómo garantizar que un pago no se procese dos veces ni se pierdan eventos.
- **Qué sugirió:** clave de idempotencia reservada en la base, patrón outbox para publicar eventos y consumidores idempotentes.
- **Qué decidimos:** adoptamos los tres mecanismos y los comprobamos con pruebas propias (ver las entradas siguientes). Lo aceptamos sabiendo que la entrega pasa a ser at-least-once, por eso todos los consumidores registran el `messageId`.

### 27/10/2026: Validar orders sin depender de inventory
- **Qué se le pidió:** cómo validar el flujo de orders sin depender de que inventory estuviera listo.
- **Qué sugirió:** un inventory falso mínimo, fuera del repo, y una secuencia de pruebas: idempotencia, hold vencido o inexistente, pago fallido y outbox hacia RabbitMQ.
- **Qué decidimos:** hicimos todas las pruebas y dieron lo esperado: un solo cobro con la misma clave, 422 con la clave reusada, 410 y 404 en holds inválidos, `EXPIRED` y `PAYMENT_FAILED` según el caso, y `payment.succeeded` llegó a RabbitMQ.

### 02–03/11/2026: Integración con inventory real y notifier
- **Qué se le pidió:** validar orders integrado con el inventory real y el notifier, y dejar los contratos documentados.
- **Qué sugirió:** pruebas del flujo completo y de la compensación, `openapi.yaml` y `events.md` armados a partir del código real, y un test automático de idempotencia del pago.
- **Qué decidimos:** probamos todo con `docker compose up` desde cero: pedido `PAID`, asientos `SOLD` y 2 entradas `VALID`; un mensaje repetido se ignora como `duplicate`; `sale.rejected` deja el pedido `REFUNDED` y las entradas `VOIDED`. Corregimos el YAML con los códigos de error reales, y al integrar unificamos el tipo del exchange dead-letter (en inventory era `direct` y fallaba el arranque; quedó `topic` en todos).