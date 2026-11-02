import { randomUUID } from "node:crypto";
import amqp, { ConsumeMessage } from "amqplib";
import { config } from "./config";
import { errorMessage, logger } from "./logger";

export const EXCHANGE = "ticketing.events";
const DLX = "ticketing.events.dlx";

// Mensaje mal formado: no tiene sentido reintentarlo, va directo a la DLQ.
export class InvalidMessage extends Error {}

export interface Envelope {
  messageId: string;
  type: string;
  correlationId: string;
  data: any;
}

// Valida el sobre estándar del contrato. La validación de "data" la hace cada consumidor.
export function parseEnvelope(msg: ConsumeMessage, expectedType: string): Envelope {
  let body: any;
  try {
    body = JSON.parse(msg.content.toString("utf8"));
  } catch {
    throw new InvalidMessage("JSON inválido");
  }
  if (typeof body?.messageId !== "string" || body.messageId === "") {
    throw new InvalidMessage("falta messageId");
  }
  if (body.type !== expectedType) throw new InvalidMessage("type inesperado");
  if (typeof body.data !== "object" || body.data === null) throw new InvalidMessage("falta data");
  const correlationId =
    typeof body.correlationId === "string" && body.correlationId !== "" ? body.correlationId : randomUUID();
  return { messageId: body.messageId, type: body.type, correlationId, data: body.data };
}

function correlationOf(msg: ConsumeMessage): string | undefined {
  try {
    const id = JSON.parse(msg.content.toString("utf8"))?.correlationId;
    return typeof id === "string" && id !== "" ? id : undefined;
  } catch {
    return undefined;
  }
}

interface ConsumerOptions {
  queue: string;
  routingKey: string;
  // Procesa el mensaje y devuelve un texto corto para el log ("sold", "duplicate"...).
  handler: (msg: ConsumeMessage) => Promise<string>;
}

async function runConsumer({ queue, routingKey, handler }: ConsumerOptions): Promise<void> {
  const dlq = `${queue}.dlq`;
  const conn = await amqp.connect(config.brokerUrl);
  conn.on("error", (err) => logger.error("RabbitMQ connection error", { queue, error: err.message }));

  try {
    const ch = await conn.createChannel();
    ch.on("error", (err) => logger.error("RabbitMQ channel error", { queue, error: err.message }));

    await ch.assertExchange(EXCHANGE, "topic", { durable: true });
    await ch.assertExchange(DLX, "topic", { durable: true });
    await ch.assertQueue(dlq, { durable: true });
    await ch.bindQueue(dlq, DLX, queue);
    await ch.assertQueue(queue, {
      durable: true,
      arguments: { "x-dead-letter-exchange": DLX, "x-dead-letter-routing-key": queue },
    });
    await ch.bindQueue(queue, EXCHANGE, routingKey);
    await ch.prefetch(10);

    await ch.consume(queue, async (msg) => {
      if (!msg) return;
      try {
        const result = await handler(msg);
        logger.info("mensaje procesado", { correlationId: correlationOf(msg), queue, routingKey, result });
        ch.ack(msg);
      } catch (err) {
        try {
          if (err instanceof InvalidMessage) {
            logger.error("Mensaje inválido, va a la DLQ", { correlationId: correlationOf(msg), queue, error: err.message });
            ch.nack(msg, false, false); // requeue=false -> dead-letter
          } else {
            logger.error("Error procesando mensaje, se reintenta", { correlationId: correlationOf(msg), queue, routingKey, error: errorMessage(err) });
            setTimeout(() => {
              try {
                ch.nack(msg, false, true); // requeue=true
              } catch {
                // canal cerrado: RabbitMQ reentrega el mensaje solo
              }
            }, 2000);
          }
        } catch {
          // canal cerrado: RabbitMQ reentrega el mensaje solo
        }
      }
    });

    logger.info("Consumidor escuchando", { queue });
    // Esperamos a que se cierre la conexión o el canal.
    await new Promise<void>((resolve) => {
      conn.on("close", () => resolve());
      ch.on("close", () => resolve());
    });
  } finally {
    await conn.close().catch(() => {}); // evita conexiones colgadas al reintentar
  }
}

// Si RabbitMQ no está o se cae, reintenta cada 5 s sin tumbar el servicio HTTP.
export async function startQueueConsumer(options: ConsumerOptions): Promise<void> {
  for (;;) {
    try {
      await runConsumer(options);
    } catch (err) {
      logger.error("No se pudo consumir, se reintenta en 5 s", { queue: options.queue, error: errorMessage(err) });
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}