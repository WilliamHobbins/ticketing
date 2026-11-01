import amqp from 'amqplib';
import type { ConfirmChannel } from 'amqplib';
import { config } from './config';
import { log } from './logger';

const EXCHANGE = 'ticketing.events';

type Conn = Awaited<ReturnType<typeof amqp.connect>>;
let conn: Conn | null = null;
let channel: ConfirmChannel | null = null;
let connecting: Promise<ConfirmChannel> | null = null;

// Conexión perezosa: se abre en el primer publish y se reabre sola si se cae.
async function getChannel(): Promise<ConfirmChannel> {
    if (channel) return channel;
    if (!connecting) {
        connecting = (async () => {
            const c = await amqp.connect(config.brokerUrl);
            const ch = await c.createConfirmChannel(); // canal con confirmación del broker
            await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
            const reset = () => { if (conn === c) { conn = null; channel = null; } };
            c.on('error', (e: Error) => log.warn({ err: e.message }, 'RabbitMQ: error de conexión'));
            c.on('close', reset);
            ch.on('error', (e: Error) => log.warn({ err: e.message }, 'RabbitMQ: error de canal'));
            ch.on('close', reset);
            conn = c;
            channel = ch;
            return ch;
        })().finally(() => { connecting = null; });
    }
    return connecting;
}

export interface Envelope {
    messageId: string;
    type: string;
    timestamp: string;
    data: unknown;
}

// Resuelve solo cuando RabbitMQ confirma que recibió el mensaje.
export async function publish(routingKey: string, msg: Envelope): Promise<void> {
    const ch = await getChannel();
    await new Promise<void>((resolve, reject) => {
        ch.publish(
            EXCHANGE,
            routingKey,
            Buffer.from(JSON.stringify(msg)),
            { persistent: true, contentType: 'application/json', messageId: msg.messageId, type: msg.type },
            (err) => (err ? reject(err) : resolve()),
        );
    });
}

export async function closePublisher(): Promise<void> {
    try { await channel?.close(); await conn?.close(); } catch { /* ya cerrado */ }
    channel = null;
    conn = null;
}