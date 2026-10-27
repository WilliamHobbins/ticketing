# Catálogo y Front mínimo (Rol 2)

## 1. Producto

El sistema permite a una persona **ver los eventos disponibles, elegir sus asientos en un plano y comprar**. Este módulo cubre las dos primeras etapas del recorrido: el catálogo que alimenta la información y el front que la muestra.

### Recorrido del usuario

1. **Listado de eventos.** Muestra fecha, título, sede, ciudad, horario y precio "desde".
2. **Plano de asientos.** Al abrir un evento se ve el mapa por sector y fila. Cada asiento puede estar libre, seleccionado u ocupado. El precio depende del sector.
3. **Selección.** Hasta 6 asientos por compra, con detalle y total en un panel lateral.
4. **Compra.** Si la persona no inició sesión, se le pide correo y contraseña (servicio de usuarios) y la compra continúa sin perder la selección.

### Capturas

Capturar con el stack levantado (`docker compose up --build -d`) en [http://localhost:8080](http://localhost:8080) y guardar en `docs/img/`.

| Archivo | Qué mostrar | URL |
|---|---|---|
| `01-listado.png` | Listado de eventos con datos de ejemplo | [http://localhost:8080/](http://localhost:8080/) |
| `02-mapa-asientos.png` | Plano de un evento con asientos libres y ocupados | Clic en cualquier evento |
| `03-seleccion.png` | 2 o 3 asientos elegidos con el total en el panel | En la pantalla anterior |
| `04-compra.png` | Confirmación de compra | Botón "Comprar entradas" |
| `05-graphiql.png` | Sandbox de GraphQL ejecutando una consulta (solo desarrollo) | [http://localhost:8080/api/v1/catalog/graphql](http://localhost:8080/api/v1/catalog/graphql) |

![Listado de eventos](img/01-listado.png)

![Plano de asientos](img/02-mapa-asientos.png)

![Selección de asientos](img/03-seleccion.png)

![Compra confirmada](img/04-compra.png)

![Sandbox GraphQL](img/05-graphiql.png)

### API del catálogo (`/api/v1/catalog`)

| Recurso | Lectura (pública) | Escritura (requiere sesión) |
|---|---|---|
| Sedes | `GET /venues`, `GET /venues/:id` | `POST /venues`, `PUT /venues/:id`, `DELETE /venues/:id` |
| Sectores | `GET /venues/:id/sectors`, `GET /sectors/:id` | `POST /venues/:id/sectors`, `PUT /venues/:id/sectors`, `DELETE /venues/:id/sectors` |
| Eventos | `GET /events?q=&city=&limit=`, `GET /events/:id` | `POST /events`, `PUT /events/:id`, `DELETE /events/:id` |
| Asientos | `GET /events/:id/seats` (mapa con precio y estado) | Se generan a partir del sector (filas × asientos por fila) |
| Salud | `GET /health` | — |

Los datos de ejemplo se cargan solos en el primer arranque: 3 sedes (Teatro Solís, Sala Zitarrosa, Teatro Larrañaga), 7 sectores, 6 eventos y unos 900 asientos, con cerca del 15 % ya ocupados para que el plano se vea realista.

**GraphQL (opcional).** Endpoint de solo lectura en `/api/v1/catalog/graphql` con `events`, `event`, `venues` y `venue`, que permite pedir un evento con su sede, sectores y asientos en una sola consulta. El sandbox (GraphiQL) solo está activo si `NODE_ENV` no es `production`; en producción, el sandbox responde 406 y la introspección queda deshabilitada.

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
| React | Interfaz por componentes (`App`, `EventList`, `EventView`) | El estado de la pantalla (asientos elegidos, sesión y mensajes) se refleja automáticamente en la vista, sin manipular el DOM a mano. |
| TypeScript | Lenguaje del front | Mismo lenguaje que el backend; los tipos `EventSummary` y `Seat` describen el contrato con la API y detectan errores al compilar. |
| Vite | Servidor de desarrollo y empaquetado (`npm run build` genera `front/dist`) | Arranque inmediato en desarrollo y un resultado final de archivos estáticos livianos. |
| Nginx (el gateway existente) | Sirve `front/dist` y reenvía `/api` a los servicios | Mismo origen que la API: sin CORS y sin servicio adicional. |
| `fetch` + rutas por hash (`#/event/:id`) | Consumo de la API y navegación | Cada pantalla tiene URL propia, útil para capturas y para compartir, y no requiere configuración extra en Nginx. |
| CSS plano (`styles.css`) | Estilos | Sin librería de estilos: la interfaz es pequeña y el diseño se controla por completo. |

**Cómo se despliega.** Vite compila el front a archivos estáticos en `front/dist`. El `docker-compose.yml` monta esa carpeta en el gateway (`./front/dist:/usr/share/nginx/html:ro`), por lo que antes de levantar el stack hay que ejecutar `npm install && npm run build` dentro de `front/`. En desarrollo, `npm run dev` abre el front en el puerto 5173 y reenvía `/api` al gateway.

**Accesibilidad y diseño.** Diseño responsive. Los asientos son botones con etiquetas descriptivas ("Platea, fila B, asiento 4, $ 2.100"), con foco visible y respeto a `prefers-reduced-motion`.

## 4. Alcance y límites actuales

- **La compra está simulada hasta que exista el servicio de pedidos.** El front llama a `POST /api/v1/orders` con `{ eventId, seatIds }`. Si ese servicio no responde (404, 502, 503), muestra la confirmación marcada como simulada. Cuando el servicio exista, el mismo botón funcionará sin cambios; si responde otro error (por ejemplo, asiento ya vendido), el front lo informa.
- **El estado de los asientos del catálogo es solo de demostración.** La tabla `event_seat_status` existe para poblar el plano. La fuente de verdad de disponibilidad y reservas debe ser el servicio de inventario (holds con TTL, sin sobreventa); el catálogo deberá consultarlo o recibir sus eventos.
- Los asientos no tienen CRUD individual: se regeneran al crear o modificar un sector.
- Falta el contrato OpenAPI en `contracts/` y pruebas automatizadas del servicio.

## 5. Conclusión

El catálogo y el front cubren el tramo inicial del recorrido de compra con una base realista: datos persistentes en PostgreSQL, lecturas rápidas gracias a Redis y degradación elegante si la caché falla, métricas y logs integrados con la observabilidad del proyecto, y un front en React que permite demostrar el flujo completo. Se verificó el funcionamiento con PostgreSQL y Redis reales: CRUD, validaciones, caché con invalidación, GraphQL y el interruptor de sandbox por entorno.

Dado que el catálogo es un servicio de mucha lectura y poca escritura, la combinación de caché y base transaccional resulta adecuada. Lo que queda es conectar el front con inventario y pedidos para que la compra deje de ser simulada, que es donde se resuelve el problema crítico del sistema: no vender dos veces el mismo asiento.
