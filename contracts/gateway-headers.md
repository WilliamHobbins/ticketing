# Contrato gateway ↔ servicios internos
Los servicios **no validan el JWT**: confían en el gateway (la red de Docker no publica sus puertos).

| Cabecera | Quién la pone | Uso |
|---|---|---|
| `X-Correlation-Id` | Gateway (o el cliente) | Incluirla en todos los logs, en llamadas REST salientes y en el mensaje de cada evento |
| `X-User-Id` | Gateway, solo en rutas protegidas (UUID del usuario) | Identificar al dueño de la reserva/pedido |
| `X-User-Email` | Gateway, solo en rutas protegidas | Notificaciones |
| `Idempotency-Key` | Cliente | Solo en el pago (lo usa el Rol 4) |

El gateway pisa `X-User-Id` con la identidad validada, por lo que un cliente no puede falsificarla en rutas protegidas.
Las rutas públicas (p. ej. catálogo) no deben leer `X-User-Id`.
Códigos del gateway: `401 UNAUTHORIZED`, `429 RATE_LIMITED`, `404 NOT_FOUND`, con el formato de error común.
