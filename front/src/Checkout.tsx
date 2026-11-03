import { useEffect, useRef, useState } from 'react';
import { ApiErr, call, eventWhen, get, money, ORDERS_API, uuid } from './api';
import type { EventSummary, Order } from './types';

interface Props {
    id: string; // orderId
    token: string | null;
    setToken: (t: string | null) => void;
}

const DEV: boolean = !!(import.meta as any).env?.DEV;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clock = (ms: number) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
};

export default function Checkout({ id, token, setToken }: Props) {
    const [order, setOrder] = useState<Order | null>(null);
    const [ev, setEv] = useState<EventSummary | null>(null);
    const [loadError, setLoadError] = useState<'notfound' | 'error' | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [simulateFail, setSimulateFail] = useState(false);
    const [now, setNow] = useState(Date.now());

    // Expiración del hold, que EventView deja en sessionStorage al crear el pedido.
    const [expiresAt] = useState<number | null>(() => {
        try { return Number(sessionStorage.getItem('holdExpires:' + id)) || null; } catch { return null; }
    });

    // La Idempotency-Key vive por intento de pago: se reutiliza solo si se repite LA MISMA solicitud.
    const attempt = useRef<{ key: string; simulate: string } | null>(null);
    const setTokenRef = useRef(setToken);
    setTokenRef.current = setToken;

    useEffect(() => {
        let off = false;
        call<Order>('GET', ORDERS_API + '/' + id, token)
            .then((o) => {
                if (off) return;
                // Si ya no está pendiente, el detalle muestra el estado real (pagado, vencido, etc.).
                if (o.status !== 'PENDING_PAYMENT') { location.hash = '#/orders/' + id; return; }
                setOrder(o);
                get<EventSummary>('/events/' + o.eventId).then((e) => !off && setEv(e)).catch(() => { /* el título es opcional */ });
            })
            .catch((e) => {
                if (off) return;
                if (e instanceof ApiErr && e.code === 'UNAUTHORIZED') setTokenRef.current(null);
                else setLoadError(e instanceof ApiErr && e.status === 404 ? 'notfound' : 'error');
            });
        return () => { off = true; };
    }, [id, token]);

    useEffect(() => {
        if (!expiresAt) return;
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, [expiresAt]);

    const remaining = expiresAt ? expiresAt - now : null;
    const [serverExpired, setServerExpired] = useState(false);
    const expired = serverExpired || (remaining !== null && remaining <= 0);

    async function pay() {
        if (!order) return;
        const simulate = simulateFail ? 'fail' : 'success';
        if (!attempt.current || attempt.current.simulate !== simulate) attempt.current = { key: uuid(), simulate };
        const key = attempt.current.key;
        setBusy(true);
        setMessage('');
        try {
            for (let i = 0; ; i++) {
                try {
                    const r = await call<{ orderId: string; status: Order['status'] }>(
                        'POST', ORDERS_API + '/' + id + '/pay', token,
                        { method: 'mock', simulate },
                        { 'Idempotency-Key': key },
                    );
                    attempt.current = null;
                    if (r.status === 'PAID') location.hash = '#/orders/' + id;
                    else setOrder({ ...order, status: r.status }); // PAYMENT_FAILED: no es un error HTTP
                    return;
                } catch (e) {
                    // Otro intento con esta misma clave sigue en curso: esperar y reintentar con la misma clave.
                    if (e instanceof ApiErr && e.code === 'PAYMENT_IN_PROGRESS' && i < 5) { await sleep(1500); continue; }
                    throw e;
                }
            }
        } catch (e) {
            handleError(e);
        } finally {
            setBusy(false);
        }
    }

    function handleError(e: unknown) {
        if (!(e instanceof ApiErr)) {
            // Sin respuesta: no sabemos si el pago llegó. Se conserva la clave, así que reintentar no cobra dos veces.
            setMessage('No se pudo conectar con el servidor. Podés volver a pulsar Pagar sin riesgo de cobro doble.');
            return;
        }
        if (e.code === 'PAYMENT_IN_PROGRESS') {
            setMessage('El pago sigue en proceso. Esperá unos segundos y volvé a pulsar Pagar.');
            return;
        }
        attempt.current = null; // respuesta definitiva: el próximo intento usa clave nueva
        switch (e.code) {
            case 'UNAUTHORIZED': setTokenRef.current(null); return;
            case 'HOLD_EXPIRED': setServerExpired(true); return;
            case 'ORDER_NOT_PENDING': location.hash = '#/orders/' + id; return;
            case 'ORDER_NOT_FOUND': setLoadError('notfound'); return;
            default: setMessage(e.message || 'Algo salió mal (' + e.status + ').');
        }
    }

    if (loadError === 'notfound')
        return (<><h1>No encontramos el pedido</h1><p><a href="#/orders">Ver mis pedidos</a></p></>);
    if (loadError) return (<><h1>No se pudo cargar el pedido</h1><p><a href="#/orders">Ver mis pedidos</a></p></>);
    if (!order) return <p className="muted">Cargando pedido…</p>;

    const n = order.seatIds.length;
    const eventLink = '#/event/' + order.eventId;

    if (order.status === 'PAYMENT_FAILED')
        return (
            <div className="ord">
                <h1>No se pudo procesar el pago</h1>
                <p className="ord-lead">El pago fue rechazado y no se te cobró. Liberamos tus asientos: elegí de nuevo para volver a intentarlo.</p>
                <p><a className="btn" href={eventLink}>Elegir asientos</a></p>
                <p><a className="back" href={'#/orders/' + id}>Ver el pedido</a></p>
            </div>
        );

    if (expired)
        return (
            <div className="ord">
                <h1>Tu reserva venció</h1>
                <p>Los asientos volvieron a quedar libres. Elegí de nuevo para comprar.</p>
                <p><a className="btn" href={eventLink}>Elegir asientos</a></p>
            </div>
        );

    return (
        <div className="ord">
            <h1>Confirmar y pagar</h1>
            <section className="ord-card">
                <h3>{ev?.title ?? 'Tu pedido'}</h3>
                {ev && (
                    <>
                        <p className="ord-venue">{ev.venueName}, {ev.venueCity}</p>
                        <p className="ord-when">{eventWhen(ev.startsAt)}</p>
                    </>
                )}
                <p>{n} entrada{n > 1 ? 's' : ''}</p>
                <div className="total"><span>Total</span><b>{money(order.total)}</b></div>
                {remaining !== null && (
                    <p className="muted" role="timer" aria-live="off">Tu reserva vence en <b>{clock(remaining)}</b>.</p>
                )}
            </section>

            <p className="muted">Pago simulado: no se hace ningún cobro real.</p>
            {DEV && (
                <label className="ord-dev">
                    <input type="checkbox" checked={simulateFail} disabled={busy} onChange={(e) => setSimulateFail(e.target.checked)} />
                    Simular pago rechazado (solo desarrollo)
                </label>
            )}
            <button className="btn" disabled={busy} onClick={pay}>
                {busy ? 'Procesando pago…' : 'Pagar ' + money(order.total)}
            </button>
            {message && <p className="msg" role="alert">{message}</p>}
        </div>
    );
}