import { randomUUID } from 'crypto';
import amqp from 'amqplib';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { config } from './config';
import { logger } from './logger';

type AmqpConnection = Awaited<ReturnType<typeof amqp.connect>>;

export interface EventEnvelope<T = unknown> {
  messageId: string;
  type: string;
  version: number;
  occurredAt: string;
  correlationId: string;
  data: T;
}

const DLX = `${config.EVENTS_EXCHANGE}.dlx`;

let connection: AmqpConnection | null = null;
let channel: ConfirmChannel | null = null;
let connected = false;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function isBrokerConnected(): boolean {
  return connected;
}

export async function connectBroker(maxAttempts = 10, delayMs = 3000): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      const conn = await amqp.connect(config.BROKER_URL);
      conn.on('error', (err: Error) => logger.error({ err }, 'Error en la conexión a RabbitMQ'));
      conn.on('close', () => {
        connected = false;
        logger.warn('Conexión a RabbitMQ cerrada');
      });
      const ch = await conn.createConfirmChannel();
      await ch.assertExchange(config.EVENTS_EXCHANGE, 'topic', { durable: true });
      await ch.assertExchange(DLX, 'topic', { durable: true });
      await ch.prefetch(10);
      connection = conn;
      channel = ch;
      connected = true;
      logger.info('Conectado a RabbitMQ');
      return;
    } catch (err) {
      if (attempt >= maxAttempts) throw err;
      logger.warn({ attempt, maxAttempts }, 'RabbitMQ no disponible, reintentando');
      await sleep(delayMs);
    }
  }
}

export async function publishEvent<T>(
  type: string,
  data: T,
  correlationId: string,
  messageId: string = randomUUID(),
): Promise<string> {
  if (!channel) throw new Error('RabbitMQ no está conectado');
  const envelope: EventEnvelope<T> = {
    messageId,
    type,
    version: 1,
    occurredAt: new Date().toISOString(),
    correlationId,
    data,
  };
  const ch = channel;
  await new Promise<void>((resolve, reject) => {
    ch.publish(
      config.EVENTS_EXCHANGE,
      type,
      Buffer.from(JSON.stringify(envelope)),
      { persistent: true, contentType: 'application/json', messageId, correlationId },
      (err) => (err ? reject(err) : resolve()),
    );
  });
  logger.info({ correlationId, type, messageId }, 'Evento publicado');
  return messageId;
}

export async function subscribe(
  queue: string,
  routingKeys: string[],
  handler: (envelope: EventEnvelope) => Promise<void>,
): Promise<void> {
  if (!channel) throw new Error('RabbitMQ no está conectado');
  const ch = channel;
  const dlq = `${queue}.dlq`;
  await ch.assertQueue(dlq, { durable: true });
  await ch.bindQueue(dlq, DLX, queue);
  await ch.assertQueue(queue, {
    durable: true,
    arguments: { 'x-dead-letter-exchange': DLX, 'x-dead-letter-routing-key': queue },
  });
  for (const key of routingKeys) await ch.bindQueue(queue, config.EVENTS_EXCHANGE, key);

  await ch.consume(queue, async (raw: ConsumeMessage | null) => {
    if (!raw) return;
    try {
      const envelope = JSON.parse(raw.content.toString()) as EventEnvelope;
      await handler(envelope);
      ch.ack(raw);
    } catch (err) {
      logger.error({ err, queue }, 'Falló el procesamiento del mensaje, se envía a la DLQ');
      ch.nack(raw, false, false);
    }
  });
  logger.info({ queue, routingKeys }, 'Suscripto a la cola');
}

export async function closeBroker(): Promise<void> {
  connected = false;
  try {
    await channel?.close();
    await connection?.close();
  } catch (err) {
    logger.warn({ err }, 'Error al cerrar RabbitMQ');
  }
}
