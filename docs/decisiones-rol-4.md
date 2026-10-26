   # Decisiones del Rol 4 — Pedidos, pagos y notificaciones

   ## 1. REST vs mensajería (cuándo uso cada uno y por qué)
   ## 2. Saga y compensación (pasos, estados del pedido)
   ## 3. Idempotencia del pago (Idempotency-Key)
   ## 4. Outbox (publicar eventos sin perderlos)
   ## 5. Consumidores idempotentes y DLQ
   ## 6. Decisiones puntuales
   - Puerto 3004
   - `pg` directo, sin ORM
   - `ticket.issued` obligatorio
   - `event_id` como text
   ## 7. Pruebas y screenshots