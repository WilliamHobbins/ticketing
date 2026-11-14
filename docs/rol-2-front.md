# Catálogo y Front (Rol 2)

## 1. Producto

El sistema permite a una persona **ver los eventos disponibles, elegir sus asientos en un plano, reservarlos, pagar y ver sus entradas**. Este módulo cubre dos piezas: el catálogo, que alimenta la información de eventos, y el front, que recorre todo el flujo de compra y se conecta con los servicios de usuarios, inventario y pedidos.

### Recorrido del usuario

1. **Listado de eventos.** Muestra fecha, título, sede, ciudad, horario y precio "desde".
2. **Plano de asientos.** Al abrir un evento se ve el mapa con la distribución real de la sala. Cada asiento puede estar libre, elegido por la persona o no disponible (vendido o reservado por otra persona). El precio depende del sector.
3. **Selección.** Hasta 6 asientos por compra, con detalle y total en un panel lateral.
4. **Ingreso.** Si la persona no inició sesión, el botón dice "Ingresar para reservar". Al pulsarlo se guarda la selección, se le pide correo y contraseña (o crear una cuenta) y al terminar vuelve al evento con los mismos asientos elegidos.
5. **Reserva.** "Reservar asientos" bloquea los asientos en el servicio de inventario durante un tiempo limitado. El panel muestra una cuenta regresiva y permite pedir más tiempo o cancelar la reserva. Si la reserva vence, los asientos vuelven a quedar libres.
6. **Pago.** "Comprar entradas" crea el pedido a partir de la reserva y lleva a la pantalla de confirmación y pago, con el resumen del evento, el total y el tiempo que queda. El pago es simulado: no se hace ningún cobro real.
7. **Entradas.** Tras el pago, el detalle del pedido muestra una entrada por asiento con su código. Los códigos se emiten de forma asíncrona, así que aparecen unos segundos después.
8. **Mis pedidos y Mi cuenta.** Desde el encabezado se accede al historial de pedidos (con su estado) y a los datos de la cuenta.

### Capturas

Capturar con el stack levantado (`docker compose up --build -d`) en [http://localhost:8080](http://localhost:8080) y guardar en `docs/img/`.

| Archivo | Qué mostrar | URL |
|---|---|---|
| `01-listado.png` | Listado de eventos con datos de ejemplo | [http://localhost:8080/](http://localhost:8080/) |
| `02-mapa-asientos.png` | Plano de un evento con asientos libres y ocupados | Clic en cualquier evento |
| `03-seleccion.png` | 2 o 3 asientos elegidos con el total en el panel | En la pantalla anterior |
| `04-reserva.png` | Reserva activa con la cuenta regresiva | Botón "Reservar asientos" |
| `05-login.png` | Pantalla de ingreso o registro con un error de validación visible | `#/login` o `#/register` |
| `06-checkout.png` | Pantalla "Confirmar y pagar" | Botón "Comprar entradas" |
| `07-pedido.png` | Detalle de un pedido pagado con sus entradas y códigos | Tras pagar |
| `08-mis-pedidos.png` | Listado de pedidos con distintos estados | `#/orders` |
| `09-cuenta.png` | Pantalla "Mi cuenta" | `#/account` |
| `10-graphiql.png` | Sandbox de GraphQL ejecutando una consulta (solo desarrollo) | [http://localhost:8080/api/v1/catalog/graphql](http://localhost:8080/api/v1/catalog/graphql) |

![Listado de eventos](img/01-listado.png)

![Plano de asientos](img/02-mapa-asientos.png)

![Selección de asientos](img/03-seleccion.png)

![Reserva activa](img/04-reserva.png)

![Ingreso y registro](img/05-login.png)

![Confirmar y pagar](img/06-checkout.png)

![Detalle del pedido con entradas](img/07-pedido.png)

![Mis pedidos](img/08-mis-pedidos.png)

![Mi cuenta](img/09-cuenta.png)

![Sandbox GraphQL](img/10-graphiql.png)

### API del catálogo (`/api/v1/catalog`)

| Recurso | Lectura (pública) | Escritura (requiere sesión) |
|---|---|---|
| Sedes | `GET /venues`, `GET /venues/:id` | `POST /venues`, `PUT /venues/:id`, `DELETE /venues/:id` |
| Sectores | `GET /venues/:id/sectors`, `GET /sectors/:id` | `POST /venues/:id/sectors`, `PUT /venues/:id/sectors`, `DELETE /venues/:id/sectors` |
| Eventos | `GET /events?q=&city=&limit=`, `GET /events/:id` | `POST /events`, `PUT /events/:id`, `DELETE /events/:id` |
| Asientos | `GET /events/:id/seats` (mapa con precio y estado de demostración) | Se generan a partir del sector (filas × asientos por fila) |
| Salud | `GET /health` | — |

Los datos de ejemplo se cargan solos en el primer arranque: 3 sedes (Teatro Solís, Sala Zitarrosa, Teatro Larrañaga), 7 sectores, 6 eventos y unos 900 asientos, con cerca del 15 % ya ocupados para que el plano se vea realista.

**GraphQL (opcional).** Endpoint de solo lectura en `/api/v1/catalog/graphql` con `events`, `event`, `venues` y `venue`, que permite pedir un evento con su sede, sectores y asientos en una sola consulta. El sandbox (GraphiQL) solo está activo si `NODE_ENV` no es `production`; en producción, el sandbox responde 406 y la introspección queda deshabilitada.

### Servicios que consume el front

El front no habla solo con el catálogo. Cada pantalla usa el servicio que corresponde, siempre a través del gateway:

| Servicio | Prefijo | Qué usa el front |
|---|---|---|
| Catálogo | `/api/v1/catalog` | `GET /events`, `GET /events/:id` (datos del evento) |
| Usuarios | `/api/v1/users` | `POST /register`, `POST /login`, `GET /me` |
| Inventario | `/api/v1` | `GET /events/:id/seats` (plano con disponibilidad real), `POST /holds`, `POST /holds/:id/extend`, `DELETE /holds/:id` |
| Pedidos | `/api/v1/orders` | `POST /` con `{ holdId }`, `GET /`, `GET /:id`, `POST /:id/pay`, `GET /:id/tickets` |

Los servicios responden los errores con el formato `{ error: { code, message, details } }`, y el front traduce cada código a una acción o un mensaje (por ejemplo, `SEAT_UNAVAILABLE` quita los asientos tomados y avisa cuáles fueron).

## 2. Tecnologías del catálogo

| Tecnología | Uso | Motivo |
|---|---|---|
| Node.js 20 + TypeScript | Lenguaje y runtime | Mismo stack que el resto del repositorio; el tipado evita errores en el contrato de datos. |
| Express | API REST | Simple, conocido por todo el equipo. |
| PostgreSQL (`pg`) | Fuente de verdad: sedes, sectores, asientos y eventos | Integridad referencial y transacciones; esquema propio `catalog` para no mezclarse con usuarios. |
| Redis (`ioredis`) | Caché de lecturas | Patrón cache-aside con TTL de 60 s (10 s para el mapa de asientos). |
| Zod | Validación de entrada | Rechaza datos inválidos con 400 antes de tocar la base. |
| GraphQL Yoga | Consulta GraphQL opcional | Sandbox integrado y plugin para deshabilitar introspección. |
| Pino + pino-http | Logs JSON con `X-Correlation-Id` | Trazabilidad entre gateway y servicios. |
| prom-client | Métricas para Prometheus | Latencia HTTP y contador de aciertos/fallos de caché. |
| Docker | Empaquetado en dos etapas | Imagen final sin dependencias de desarrollo, ejecutada como usuario sin privilegios. |

**Cómo funciona la caché.** Cada lectura busca primero en Redis. Cada escritura incrementa un número de versión en Redis, por lo que las claves anteriores dejan de usarse de inmediato y no hace falta borrarlas una por una. Si Redis no responde, el servicio lee directamente de PostgreSQL: la API sigue funcionando, solo que más lenta (comportamiento verificado apagando Redis).

**Seguridad.** Las lecturas son públicas. Las escrituras exigen el header `X-User-Id`, que el gateway inyecta solo después de validar el JWT con `auth_request`; en las lecturas, el gateway lo deja vacío para que un cliente no pueda falsificarlo.

## 3. Tecnologías del front

| Tecnología | Uso | Motivo |
|---|---|---|
| React | Interfaz por componentes (ver tabla de componentes) | El estado de la pantalla (asientos elegidos, reserva, sesión y mensajes) se refleja automáticamente en la vista, sin manipular el DOM a mano. |
| TypeScript | Lenguaje del front | Mismo lenguaje que el backend; los tipos (`EventSummary`, `Order`, `Ticket`, `OrderStatus`) describen el contrato con las APIs y detectan errores al compilar. |
| Vite | Servidor de desarrollo y empaquetado (`npm run build` genera `front/dist`) | Arranque inmediato en desarrollo y un resultado final de archivos estáticos livianos. |
| Nginx (el gateway existente) | Sirve `front/dist` y reenvía `/api` a los servicios | Mismo origen que la API: sin CORS y sin servicio adicional. |
| `fetch` + rutas por hash | Consumo de las APIs y navegación | Cada pantalla tiene URL propia, útil para capturas y para compartir, y no requiere configuración extra en Nginx. |
| `sessionStorage` | Token de sesión, selección pendiente de login y vencimiento de la reserva | Los datos viven solo mientras la pestaña está abierta y no se mezclan entre pestañas. |
| CSS plano (`styles.css`, `auth.css`, `seatmap.css`, `Orders.css`) | Estilos | Sin librería de estilos: la interfaz es pequeña y el diseño se controla por completo. |

### Componentes

| Archivo | Responsabilidad |
|---|---|
| `main.tsx` | Punto de entrada: monta `App` en el DOM. |
| `App.tsx` | Encabezado, lectura de la ruta por hash, estado de sesión (token) y elección de la pantalla a mostrar. Redirige al login si se entra a una ruta protegida sin sesión. |
| `EventList.tsx` | Listado de eventos con reintento si falla la carga. |
| `EventView.tsx` | Pantalla del evento: selección de asientos y ciclo completo de la reserva (reservar, extender, cancelar, comprar). |
| `Seatmap.tsx` | Dibuja el plano y cada asiento como botón. Ver detalle abajo. |
| `AuthView.tsx` | Formulario de ingreso y de registro, con validación en el cliente. |
| `Account.tsx` | Datos de la cuenta y cierre de sesión. |
| `Checkout.tsx` | Confirmación y pago del pedido. |
| `Orderslist.tsx` | Historial de pedidos. |
| `Orderdetail.tsx` | Detalle de un pedido y sus entradas. |
| `Orderbadge.tsx` | Etiqueta con el estado del pedido (`StatusBadge`) y sus textos en español. |
| `api.ts` | Cliente compartido: `get` para el catálogo, `call` autenticado para pedidos, `ApiErr`, `uuid` para la `Idempotency-Key`, y formatos de moneda (UYU), fecha y hora. |
| `authApi.ts` | Llamadas al servicio de usuarios (`register`, `login`, `me`) y lectura de la expiración del token. |
| `types.ts` | Tipos compartidos del contrato con las APIs. |

### Rutas

| Ruta (hash) | Pantalla | Requiere sesión |
|---|---|---|
| `#/` | Listado de eventos | No |
| `#/event/:id` | Plano, selección y reserva | No (sí para reservar) |
| `#/login`, `#/register` | Ingreso y registro. Aceptan `?next=` para volver a la pantalla de origen. | No |
| `#/account` | Mi cuenta | Sí |
| `#/orders` | Mis pedidos | Sí |
| `#/orders/:id` | Detalle del pedido y entradas | Sí |
| `#/checkout/:id` | Confirmar y pagar | Sí |

### Plano de asientos

El plano copia la distribución de cada sala, solo en cuanto a la posición de los asientos:

- **Teatro Solís:** herradura con el escenario arriba; platea al centro, palcos a los lados y paraíso en arco al fondo.
- **Teatro Larrañaga:** herradura con el escenario abajo; platea al centro y galería en arco alrededor.
- **Sala Zitarrosa:** sala rectangular con el escenario abajo; filas en tres bloques (lateral, centro, lateral) separados por pasillos.

Si la sala no se reconoce, o trae un sector desconocido, se dibuja un plano simple por sectores y filas. El plano se escala para entrar en el ancho disponible (con un mínimo; por debajo, hace scroll horizontal).

### Reserva de asientos

La reserva se apoya en los *holds* del servicio de inventario, que evitan que dos personas compren el mismo asiento:

- Al reservar, los asientos pasan a "reservado" para el resto de las personas y se abre una cuenta regresiva con el vencimiento que informa el servidor.
- Mientras no hay reserva, el plano se refresca cada 15 segundos para reflejar reservas ajenas que vencen. Si un asiento elegido deja de estar libre, se quita de la selección y se avisa.
- Si la persona cambia de pantalla o cierra la pestaña, la reserva se libera. Cuando se crea el pedido, la reserva pasa a ser del pedido y ya no se libera al salir.
- Si el asiento fue tomado por otra persona justo antes de reservar, se informa cuál y se pide elegir otro.

### Pago e idempotencia

El pago usa una `Idempotency-Key` generada por intento. Si la respuesta no llega (corte de red) o el servidor indica que el pago sigue en curso, el front reintenta con la **misma clave**, de modo que repetir la solicitud no cobra dos veces. Cuando la respuesta es definitiva, el siguiente intento usa una clave nueva.

El pedido puede estar en uno de estos estados:

| Estado | Texto en pantalla | Qué ofrece el front |
|---|---|---|
| `PENDING_PAYMENT` | Pendiente de pago | "Ir a pagar" |
| `PAID` | Pagado | Entradas con código |
| `PAYMENT_FAILED` | Pago rechazado | "Elegir asientos" para volver a intentar |
| `EXPIRED` | Reserva vencida | "Elegir asientos" |
| `REFUNDED` | Reembolsado | Entradas anuladas |

En modo desarrollo, el checkout incluye una casilla para simular un pago rechazado.

### Sesión

El registro valida correo, nombre, contraseña de 10 a 72 bytes y que ambas contraseñas coincidan; luego inicia sesión automáticamente. El token se guarda en `sessionStorage` y se envía como `Authorization: Bearer`. Si algún servicio responde `UNAUTHORIZED`, el front descarta el token y pide ingresar de nuevo. Para desarrollar contra un servicio sin gateway se puede definir `VITE_DEV_USER_ID`, que agrega el header `X-User-Id`.

**Cómo se despliega.** Vite compila el front a archivos estáticos en `front/dist`. El `docker-compose.yml` monta esa carpeta en el gateway (`./front/dist:/usr/share/nginx/html:ro`), por lo que antes de levantar el stack hay que ejecutar `npm install && npm run build` dentro de `front/`. En desarrollo, `npm run dev` abre el front en el puerto 5173 y reenvía `/api` al gateway.

**Accesibilidad y diseño.** Diseño responsive. Los asientos son botones con etiquetas descriptivas ("Platea, fila B, asiento 4, $ 2.100"), que además indican si el asiento está vendido, reservado por otra persona o elegido (`aria-pressed`). Los errores de formularios y los mensajes usan `role="alert"`, los temporizadores usan `role="timer"`, y hay foco visible y respeto a `prefers-reduced-motion`.

## 4. Alcance y límites actuales

- **El pago es simulado.** El pedido, la reserva y las entradas pasan por los servicios reales, pero el pago usa un método `mock` que no hace ningún cobro. Integrar una pasarela real requiere cambiar solo la llamada de pago del checkout.
- **La disponibilidad viene de inventario.** El plano que ve la persona sale del servicio de inventario. La tabla `event_seat_status` del catálogo y su `GET /events/:id/seats` quedan como datos de demostración y no los usa el front.
- **La sesión dura lo que dura la pestaña.** El token está en `sessionStorage`: al cerrar la pestaña hay que ingresar de nuevo.
- **Las actualizaciones son por consulta periódica.** El plano se refresca cada 15 s, y el detalle del pedido consulta hasta que llegan las entradas (hasta unos 60 s; si tardan más, se avisa que vuelva a mirar más tarde). No hay notificaciones en tiempo real.
- **Los planos a medida cubren tres salas.** Una sede nueva se muestra con el plano simple hasta que se le agregue su distribución.
- Los asientos no tienen CRUD individual: se regeneran al crear o modificar un sector.
- Falta el contrato OpenAPI en `contracts/` y pruebas automatizadas del servicio y del front.

## 5. Conclusión

El catálogo y el front cubren el recorrido completo de compra: desde el listado hasta las entradas emitidas. El catálogo ofrece una base realista, con datos persistentes en PostgreSQL, lecturas rápidas gracias a Redis y degradación elegante si la caché falla, además de métricas y logs integrados con la observabilidad del proyecto. El front, en React, integra cuatro servicios (catálogo, usuarios, inventario y pedidos) y traduce sus errores a mensajes claros para la persona.

El problema crítico del sistema, no vender dos veces el mismo asiento, se refleja en la interfaz mediante reservas con tiempo límite, un plano que se mantiene al día y un pago idempotente que no cobra doble ante reintentos. Se verificó el funcionamiento del catálogo con PostgreSQL y Redis reales: CRUD, validaciones, caché con invalidación, GraphQL y el interruptor de sandbox por entorno.

Lo que queda pendiente es reemplazar el pago simulado por una pasarela real, documentar los contratos en OpenAPI y sumar pruebas automatizadas.