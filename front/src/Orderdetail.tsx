import { useEffect, useRef, useState } from 'react';
import { ApiErr, call, dateTime, eventWhen, get, money, ORDERS_API } from './api';
import { StatusBadge } from './Orderbadge';
import type { EventSummary, Order, Ticket } from './types';

interface Props {
    id: string; // orderId
    token: string | null;
    setToken: (t: string | null) => void;
}

// Las entradas llegan por un evento asíncrono (ticket.issued): se consulta hasta que aparezcan.
const TICKET_POLL_MS = 1500;
const TICKET_POLL_MAX = 40;
const PENDING_POLL_MS = 5000;

export default function OrderDetail({ id, token, setToken }: Props) {
    const [order, setOrder] = useState<Order | null>(null);
    const [ev, setEv] = useState<EventSummary | null>(null);
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [slow, setSlow] = useState(false);
    const [error, setError] = useState<'notfound' | 'error' | null>(null);
    const setTokenRef = useRef(setToken);
    setTokenRef.current = setToken;

    useEffect(() => {
        let off = false;
        let timer: number | undefined;
        let tries = 0;

        const load = async () => {
            try {
                const o = await call<Order>('GET', ORDERS_API + '/' + id, token);
                if (off) return;
                setOrder(o);
                setError(null);
                let next = o.status === 'PENDING_PAYMENT' ? PENDING_POLL_MS : 0; // puede vencer por sí solo
                if (o.status === 'PAID' || o.status === 'REFUNDED') {
                    const t = await call<Ticket[]>('GET', ORDERS_API + '/' + id + '/tickets', token);
                    if (off) return;
                    setTickets(t);
                    if (o.status === 'PAID' && t.length === 0) {
                        if (tries++ < TICKET_POLL_MAX) next = TICKET_POLL_MS;
                        else setSlow(true);
                    }
                }
                if (next) timer = window.setTimeout(load, next);
            } catch (e) {
                if (off) return;
                if (e instanceof ApiErr && e.code === 'UNAUTHORIZED') setTokenRef.current(null);
                else setError(e instanceof ApiErr && e.status === 404 ? 'notfound' : 'error');
            }
        };
        load();
        return () => { off = true; window.clearTimeout(timer); };
    }, [id, token]);

    const eventId = order?.eventId;
    useEffect(() => {
        if (!eventId) return;
        let off = false;
        get<EventSummary>('/events/' + eventId).then((e) => !off && setEv(e)).catch(() => { /* el título es opcional */ });
        return () => { off = true; };
    }, [eventId]);

    if (error === 'notfound')
        return (<><h1>No encontramos el pedido</h1><p><a href="#/orders">Ver mis pedidos</a></p></>);
    if (error && !order)
        return (<><h1>No se pudo cargar el pedido</h1><p><a href="#/orders">Ver mis pedidos</a></p></>);
    if (!order) return <p className="muted">Cargando pedido…</p>;

    const n = order.seatIds.length;
    const when = ev ? eventWhen(ev.startsAt) : '';
    const hasTickets = order.status === 'PAID' || order.status === 'REFUNDED';
    // Se dibuja una entrada por asiento desde el primer momento; el código aparece cuando llega de tickets.
    // En un pedido REFUNDED, si todavía no llegaron las entradas, se muestran como anuladas.
    const cards: Ticket[] = tickets.length
        ? tickets
        : order.seatIds.map((s): Ticket => ({
            ticketId: s,
            seatId: s,
            code: '',
            status: order.status === 'REFUNDED' ? 'VOIDED' : 'VALID',
        }));

    return (
        <div className="ord">
            <a className="back" href="#/orders">Mis pedidos</a>
            <h1>{ev?.title ?? 'Pedido'}</h1>
            <p><StatusBadge status={order.status} /></p>

            <section className="ord-hero">
                {ev && (
                    <>
                        <p className="ord-venue">{ev.venueName}, {ev.venueCity}</p>
                        <p className="ord-when">{when}</p>
                    </>
                )}
                <p className="ord-meta">{n} entrada{n > 1 ? 's' : ''}, pedido del {dateTime(order.createdAt)}</p>
                <div className="total"><span>Total</span><b>{money(order.total)}</b></div>
            </section>

            {order.status === 'PENDING_PAYMENT' && (
                <p><a className="btn" href={'#/checkout/' + id}>Ir a pagar</a></p>
            )}
            {(order.status === 'PAYMENT_FAILED' || order.status === 'EXPIRED') && (
                <>
                    <p>
                        {order.status === 'EXPIRED'
                            ? 'La reserva venció antes de pagar.'
                            : 'El pago fue rechazado y no se te cobró.'}{' '}
                        Para comprar de nuevo, elegí los asientos otra vez.
                    </p>
                    <p><a className="btn" href={'#/event/' + order.eventId}>Elegir asientos</a></p>
                </>
            )}
            {order.status === 'REFUNDED' && (
                <p>Alguien tomó el asiento antes de concretar la venta. Te devolvimos el pago y las entradas quedaron anuladas.</p>
            )}

            {hasTickets && (
                <section>
                    <h2 className="ord-h">Tus entradas</h2>
                    <ul className="tickets">
                        {cards.map((t) => (
                            <li key={t.ticketId} className={'ticket' + (t.status === 'VOIDED' ? ' ticket--void' : '')}>
                                <div className="ticket-main" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                    <div className="ticket-title">{ev?.title ?? 'Entrada'}</div>
                                    {ev && <div>{ev.venueName}, {ev.venueCity}</div>}
                                    {ev && <div className="muted">{when}</div>}
                                </div>
                                <div className="ticket-stub" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <div>Asiento</div>
                                    <b>{t.seatId}</b>
                                    {t.code && (
                                        <>
                                            <div style={{ marginTop: 8 }}>Código</div>
                                            <code>{t.code}</code>
                                        </>
                                    )}
                                    {t.status === 'VOIDED' && <div>Anulada</div>}
                                </div>
                            </li>
                        ))}
                    </ul>
                    {slow && <p className="muted">Los códigos tardan más de lo normal en llegar. Volvé a mirar en unos minutos.</p>}
                </section>
            )}

        </div>
    );
}