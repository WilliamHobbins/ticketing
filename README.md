# Ticketing

Plataforma de venta de entradas basada en microservicios, con un gateway Nginx al frente.

## Arquitectura

| Servicio | Puerto interno | Descripción |
|---|---|---|
| gateway (Nginx) | 8080 (publicado) | Entrada única: rate limiting, validación JWT, sirve el front estático |
| users-service | 3001 | Registro, login y validación de tokens |
| catalog-service | 3002 | Catálogo de eventos (REST + GraphQL) |
| inventory-service | 8083 | Disponibilidad de asientos y reservas temporales |
| orders-service | 3004 | Pedidos |
| notifier-worker | 3005 | Notificaciones asíncronas (RabbitMQ) |
| postgres / redis / rabbitmq | 5432 / 6379 / 5672 | Infraestructura |
| prometheus / grafana | 9090 / 3000 | Métricas y dashboards |

## Requisitos

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado y corriendo
- [Node.js](https://nodejs.org/) 22 o superior (para el front)
- Git

## Puesta en marcha

### 1. Clonar el repositorio

```bash
git clone https://github.com/WilliamHobbins/ticketing
cd ticketing
```

### 2. Crear el archivo de entorno

Copiá el archivo de ejemplo y completá los valores (contraseñas, `JWT_SECRET`, etc.):

```powershell
# PowerShell (Windows)
Copy-Item .env.example .env
```

```bash
# Linux / macOS
cp .env.example .env
```

> El `.env` **no se sube a git**. Nunca commitees secretos.

### 3. Generar el build del front

El gateway sirve el front desde `front/dist`, que no está versionado:

```bash
npm --prefix front install
npm --prefix front run build
```

### 4. Levantar los servicios

```bash
docker compose up -d --build
```

Verificá que todo esté `healthy`:

```bash
docker compose ps
```

### 5. Abrir la app

| URL | Qué es |
|---|---|
| http://localhost:8080 | App servida por el gateway (build estático) |
| http://localhost:5173 | Front en modo desarrollo (`npm --prefix front run dev`) |
| http://localhost:3000 | Grafana |
| http://localhost:9090 | Prometheus |
| http://localhost:15672 | RabbitMQ Management |

## Desarrollo

Front con recarga en caliente:

```bash
npm --prefix front run dev
```

Vite redirige `/api` al gateway (`localhost:8080`), por lo que los servicios deben estar levantados.

## Después de hacer `git pull`

```bash
docker compose up -d --build
docker compose restart gateway      # refresca las IPs de los upstreams
npm --prefix front install          # solo si cambiaron dependencias
npm --prefix front run build        # regenera el front estático
```

## Comandos útiles

```bash
docker compose logs -f <servicio>   # ver logs (ej: catalog-service)
docker compose down                 # detener todo
docker compose down -v              # detener y BORRAR los datos (volúmenes)
```

## Problemas frecuentes

- **502 Bad Gateway tras recrear contenedores:** `docker compose restart gateway`.
- **`localhost:8080` muestra el front viejo o vacío:** regenerá el build (`npm --prefix front run build`) y recargá con Ctrl+F5.
- **Puerto ocupado (5432, 6379, 8080, 3000...):** cambialo en el `.env` (`POSTGRES_PORT`, `GATEWAY_PORT`, etc.).
- **Las bases de datos no se crearon:** `init-databases.sql` solo corre al crear el volumen de Postgres. Usá `docker compose down -v` y volvé a levantar (borra los datos).