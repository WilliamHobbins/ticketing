import { useEffect, useRef, useState } from 'react';
import { ApiErr, call, dateTime, get, money, ORDERS_API } from './api';
import { StatusBadge } from './OrderBadge';
import type { EventSummary, Order } from './types';

interface Props {
    token: string | null;
    setToken: (t: string | null) => void;
}

export default function OrdersList({ token, setToken }: Props) {
    const [orders, setOrders] = useState<Order[] | null>(null);
    const [titles, setTitles] = useState<Record<string, string>>({});
    const [failed, setFailed] = useState(false);
    const setTokenRef = useRef(setToken);
    setTokenRef.current = setToken;

    useEffect(() => {
        let off = false;
        call<Order[]>('GET', ORDERS_API, token)
            .then((list) => {
                if (off) return;
                setOrders(list);
                // Un solo pedido por evento distinto para los títulos.
                const ids = [...new Set(list.map((o) => o.eventId))];
                ids.forEach((eid) =>
                    get<EventSummary>('/events/' + eid)
                        .then((e) => !off && setTitles((p) => ({ ...p, [eid]: e.title })))
                        .catch(() => { /* sin título se muestra "Evento" */ }),
                );
            })
            .catch((e) => {
                if (off) return;
                if (e instanceof ApiErr && e.code === 'UNAUTHORIZED') setTokenRef.current(null);
                else setFailed(true);
            });
        return () => { off = true; };
    }, [token]);

    if (failed) return (<><h1>No se pudieron cargar tus pedidos</h1><p><a href="#/orders">Probar de nuevo</a></p></>);
    if (!orders) return <p className="muted">Cargando pedidos…</p>;

    return (
        <div className="ord">
            <h1>Mis pedidos</h1>
            {orders.length === 0 ? (
                <p>Todavía no tenés pedidos. <a href="#/">Mirá los eventos</a> y elegí tus asientos.</p>
            ) : (
                <ul className="ord-list">
                    {orders.map((o) => (
                        <li key={o.orderId}>
                            <a className="ord-row" href={(o.status === 'PENDING_PAYMENT' ? '#/checkout/' : '#/orders/') + o.orderId}>
                <span>
                  <b>{titles[o.eventId] ?? 'Evento'}</b>
                  <span className="muted"> {dateTime(o.createdAt)}, {o.seatIds.length} entrada{o.seatIds.length > 1 ? 's' : ''}</span>
                </span>
                                <span className="ord-row-end">
                  <StatusBadge status={o.status} />
                  <b>{money(o.total)}</b>
                </span>
                            </a>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}