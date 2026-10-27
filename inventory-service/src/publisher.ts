import { createHash, randomUUID } from "node:crypto";
import amqp from "amqplib";
import { config } from "./config";

const EXCHANGE = "ticketing.events";

// Tipos inferidos de la propia librería, para no depender de nombres que cambian entre versiones.
type Conn = Awaited<ReturnType<typeof amqp.connect>>;
type ConfirmCh = Awaited<ReturnType<Conn["createConfirmChannel"]>>;

let channelPromise: Promise<ConfirmCh> | null = null;

// Conecta la primera vez que se necesita y se reconecta sola: si la conexión o el
// canal se cierran, el próximo publish vuelve a crear todo.
function getChannel(): Promise<ConfirmCh> {
  if (!channelPromise) {
    const p = (async () => {
      const conn = await amqp.connect(config.brokerUrl);
      conn.on("error", (err) => console.error("Publisher: error de conexión:", err.message));
      conn.on("close", () => {
        if (channelPromise === p) channelPromise = null;
      });
      const ch = await conn.createConfirmChannel();
      ch.on("error", (err) => console.error("Publisher: error de canal:", err.message));
      ch.on("close", () => {
        if (channelPromise === p) channelPromise = null;
      });
      await ch.assertExchange(EXCHANGE, "topic", { durable: true });
      return ch;
    })();
    channelPromise = p;
    p.catch(() => {
      if (channelPromise === p) channelPromise = null;
    });
  }
  return channelPromise;
}

// Convierte un texto en un UUID estable: el mismo texto siempre da el mismo UUID.
export function deterministicUuid(seed: string): string {
  const h = createHash("sha256").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// Publica con el sobre estándar del contrato. Resuelve cuando RabbitMQ confirma;
// rechaza si no hay conexión o el broker no confirma.
export async function publishEvent(
  type: string,
  data: Record<string, unknown>,
  correlationId: string,
  messageId: string = randomUUID(),
): Promise<void> {
  const ch = await getChannel();
  const envelope = {
    messageId,
    type,
    version: 1,
    occurredAt: new Date().toISOString(),
    correlationId,
    data,
  };
  await new Promise<void>((resolve, reject) => {
    ch.publish(
      EXCHANGE,
      type, // la routing key es el tipo del evento
      Buffer.from(JSON.stringify(envelope)),
      { persistent: true, contentType: "application/json" },
      (err) => (err ? reject(err) : resolve()),
    );
  });
}