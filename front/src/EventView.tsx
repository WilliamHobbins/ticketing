import { useCallback, useEffect, useRef, useState } from 'react';
import { get, money, time, MAX_SEATS, ApiErr, authHeaders as headers, call, ORDERS_API } from './api';
import type { EventSummary } from './types';
import SeatMap from './SeatMap';

/* ------------------------------------------------------------------ */
/* Contrato con inventory-service (vía gateway: /api/v1/...)           */
/* ------------------------------------------------------------------ */

// Prefijo con el que el gateway expone inventory (holds y asientos). Ajustar si el gateway usa otro,
// por ejemplo '/api/v1/inventory'. Catalog usa '/api/v1/catalog' (ver api.ts).
const INV_API = '/api/v1';

/** Respuesta de GET /events/{eventId}/seats */
interface InvSeat {
  seatId: string;
  sector: string;
  row: number;
  number: number;
  price: number;
  status: 'AVAILABLE' | 'HELD' | 'SOLD';
}

/** Asiento tal como lo usa la pantalla */
interface Seat {
  id: string;
  sector: string;
  row: number;
  number: number;
  price: number;
  status: 'available' | 'held' | 'sold';
}

interface Hold {
  holdId: string;
  seatIds: string[];
  total: number;
  expiresAtMs: number;
}

const toSeat = (s: InvSeat): Seat => ({
  id: s.seatId,
  sector: s.sector,
  row: s.row,
  number: s.number,
  price: s.price,
  status: s.status === 'SOLD' ? 'sold' : s.status === 'HELD' ? 'held' : 'available',
});

async function inv<T = void>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    token: string | null,
    body?: unknown,
): Promise<T> {
  const r = await fetch(INV_API + path, {
    method,
    headers: headers(token, body !== undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return undefined as T;
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const e = data?.error;
    throw new ApiErr(r.status, e?.code ?? 'ERROR', e?.message ?? 'Error ' + r.status, e?.details);
  }
  return data as T;
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
};

/* ------------------------------------------------------------------ */

interface Props {
  id: string;
  token: string | null;
  setToken: (t: string | null) => void;
}

export default function EventView({ id, token, setToken }: Props) {
  const [ev, setEv] = useState<EventSummary | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [failed, setFailed] = useState(false);
  const [sel, setSel] = useState<Map<string, Seat>>(new Map());
  const [hold, setHold] = useState<Hold | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const pendingKey = 'pendingSeats:' + id;

  // Refs para poder liberar el hold al salir de la pantalla.
  const holdRef = useRef<Hold | null>(null);
  const tokenRef = useRef<string | null>(token);
  holdRef.current = hold;
  tokenRef.current = token;

  const refreshSeats = useCallback(async (): Promise<Seat[]> => {
    const list = (await inv<InvSeat[]>('GET', '/events/' + id + '/seats', tokenRef.current)).map(toSeat);
    setSeats(list);
    return list;
  }, [id]);

  /* Carga inicial: datos del evento (catalog) + asientos (inventory) */
  useEffect(() => {
    let off = false;
    Promise.all([get<EventSummary>('/events/' + id), refreshSeats()])
        .then(([e, s]) => {
          if (off) return;
          setEv(e);
          // Si venís del login, recupera los asientos que habías elegido.
          try {
            const raw = sessionStorage.getItem(pendingKey);
            if (raw) {
              sessionStorage.removeItem(pendingKey);
              const ids: string[] = JSON.parse(raw);
              const keep = s.filter((x) => ids.includes(x.id) && x.status === 'available').slice(0, MAX_SEATS);
              setSel(new Map(keep.map((x) => [x.id, x])));
            }
          } catch { /* sin selección guardada */ }
        })
        .catch(() => !off && setFailed(true));
    return () => { off = true; };
  }, [id, pendingKey, refreshSeats]);

  /* Mientras no hay hold, refresca el mapa cada 15 s para ver holds ajenos que vencen */
  useEffect(() => {
    if (hold) return;
    const t = setInterval(() => {
      refreshSeats()
          .then((list) =>
              setSel((prev) => {
                const next = new Map<string, Seat>();
                for (const [k, v] of prev) if (list.find((x) => x.id === k)?.status === 'available') next.set(k, v);
                if (next.size !== prev.size) setMessage('Algunos asientos que elegiste ya no están libres.');
                return next;
              }),
          )
          .catch(() => { /* se reintenta en el próximo ciclo */ });
    }, 15000);
    return () => clearInterval(t);
  }, [hold, refreshSeats]);

  /* Cuenta regresiva del hold */
  useEffect(() => {
    if (!hold) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hold]);

  const remaining = hold ? hold.expiresAtMs - now : 0;

  useEffect(() => {
    if (hold && remaining <= 0) {
      setHold(null);
      setSel(new Map());
      setMessage('Tu reserva venció y los asientos volvieron a quedar libres. Elegí de nuevo.');
      refreshSeats().catch(() => {});
    }
  }, [hold, remaining, refreshSeats]);

  /* Liberar el hold si el usuario se va (cambia de pantalla o cierra la pestaña) */
  useEffect(() => {
    const release = () => {
      const h = holdRef.current;
      const t = tokenRef.current;
      if (!h || !t) return;
      fetch(INV_API + '/holds/' + h.holdId, { method: 'DELETE', headers: headers(t), keepalive: true }).catch(() => {});
    };
    window.addEventListener('pagehide', release);
    return () => {
      window.removeEventListener('pagehide', release);
      release();
    };
  }, []);

  const items = [...sel.values()];
  const total = items.reduce((a, s) => a + s.price, 0);

  function toggle(s: Seat) {
    const next = new Map(sel);
    if (next.has(s.id)) { next.delete(s.id); setMessage(''); }
    else if (next.size < MAX_SEATS) { next.set(s.id, s); setMessage(''); }
    else setMessage('Máximo ' + MAX_SEATS + ' entradas por compra.');
    setSel(next);
  }

  function goToLogin() {
    try { sessionStorage.setItem(pendingKey, JSON.stringify([...sel.keys()])); } catch { /* ignorar */ }
    location.hash = '#/login?next=' + encodeURIComponent('/event/' + id);
  }

  /* Traduce los errores de inventory a acciones y mensajes */
  function handleError(e: unknown) {
    if (!(e instanceof ApiErr)) {
      setMessage('No se pudo conectar con el servidor. Probá de nuevo.');
      return;
    }
    const bad = e.details?.seatIds ?? [];
    const dropBad = () =>
        setSel((prev) => {
          const next = new Map(prev);
          bad.forEach((k) => next.delete(k));
          return next;
        });

    switch (e.code) {
      case 'UNAUTHORIZED':
        setToken(null);
        goToLogin();
        return;
      case 'SEAT_UNAVAILABLE':
        dropBad();
        refreshSeats().catch(() => {});
        setMessage(
            bad.length
                ? 'Alguien se te adelantó con ' + (bad.length > 1 ? 'estos asientos: ' : 'este asiento: ') + bad.join(', ') + '. Elegí otros.'
                : 'Uno o más asientos ya no están disponibles. Elegí otros.',
        );
        return;
      case 'SEAT_NOT_FOUND':
        dropBad();
        refreshSeats().catch(() => {});
        setMessage('Uno de los asientos ya no existe en este evento. Actualizamos el plano.');
        return;
      case 'HOLD_EXPIRED':
        setHold(null);
        setSel(new Map());
        refreshSeats().catch(() => {});
        setMessage('Tu reserva venció. Elegí los asientos de nuevo.');
        return;
      case 'FORBIDDEN':
      case 'HOLD_NOT_OWNED':
        setMessage('Esta reserva pertenece a otra cuenta.');
        return;
      case 'EVENT_NOT_FOUND':
        setFailed(true);
        return;
      default:
        setMessage(e.message || 'Algo salió mal (' + e.status + ').');
    }
  }

  /* 1) Reservar: POST /holds */
  async function reserve() {
    if (!token) { goToLogin(); return; }
    setBusy(true);
    setMessage('');
    try {
      const r = await inv<{ holdId: string; seatIds: string[]; expiresAt: string }>(
          'POST', '/holds', token, { eventId: id, seatIds: [...sel.keys()] },
      );
      setHold({ holdId: r.holdId, seatIds: r.seatIds, total, expiresAtMs: Date.parse(r.expiresAt) });
      refreshSeats().catch(() => {});
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }

  /* 2) Extender: POST /holds/{holdId}/extend */
  async function extend() {
    if (!hold) return;
    setBusy(true);
    setMessage('');
    try {
      const r = await inv<{ expiresAt: string }>('POST', '/holds/' + hold.holdId + '/extend', token);
      const next = Date.parse(r.expiresAt);
      setMessage(next > hold.expiresAtMs + 1000 ? 'Sumaste tiempo a tu reserva.' : 'Tu reserva ya tiene el tiempo máximo por ahora.');
      setHold({ ...hold, expiresAtMs: next });
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }

  /* 3) Cancelar: DELETE /holds/{holdId} (los asientos siguen elegidos para cambiar la selección) */
  async function cancel() {
    if (!hold) return;
    setBusy(true);
    setMessage('');
    try {
      await inv('DELETE', '/holds/' + hold.holdId, token);
      setHold(null);
      refreshSeats().catch(() => {});
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }

  /* 4) Comprar: crea el pedido en orders (solo con el holdId) y pasa al checkout, donde se paga */
  async function buy() {
    if (!hold) return;
    setBusy(true);
    setMessage('');
    try {
      const order = await call<{ orderId: string }>('POST', ORDERS_API, token, { holdId: hold.holdId });
      // El checkout no recibe la expiración del hold por la API: se la pasamos por sessionStorage.
      try { sessionStorage.setItem('holdExpires:' + order.orderId, String(hold.expiresAtMs)); } catch { /* ignorar */ }
      holdRef.current = null; // el hold ya es del pedido: no liberarlo al salir de esta pantalla
      location.hash = '#/checkout/' + order.orderId;
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }

  if (failed)
    return (<><h1>No se pudo cargar el evento</h1><p><a href="#/">Volver a los eventos</a></p></>);
  if (!ev) return <p className="muted">Cargando mapa de asientos…</p>;

  const d = new Date(ev.startsAt);
  const locked = !!hold;

  return (
      <>
        <a className="back" href="#/">Volver a los eventos</a>
        <h1>{ev.title}</h1>
        <p className="muted" style={{ marginTop: -12 }}>
          {ev.venueName}, {ev.venueCity}. {d.toLocaleDateString('es-UY', { weekday: 'long', day: 'numeric', month: 'long' })}, {time(d)} h
        </p>
        <div className="layout">
          <div>
            <div className="legend">
              <span><i />Libre</span>
              <span><i className="lg-on" />Tu selección</span>
              <span className="na"><i className="lg-off" />No disponible</span>
            </div>
            <SeatMap venue={ev.venueName} seats={seats} sel={sel} disabled={locked || busy} onToggle={toggle} />
          </div>

          {hold ? (
              <aside>
                <h3>Reserva activa</h3>
                <p className="muted" role="timer" aria-live="off">
                  Tenés <b>{clock(remaining)}</b> para completar la compra.
                </p>
                <ul>
                  {items.map((s) => (
                      <li key={s.id}>
                        <span>{s.sector}, fila {s.row}, asiento {s.number}</span>
                        <b>{money(s.price)}</b>
                      </li>
                  ))}
                </ul>
                <div className="total"><span>Total</span><b>{money(hold.total)}</b></div>
                <button className="btn" disabled={busy} onClick={buy}>Comprar entradas</button>
                <p>
                  <button className="back" disabled={busy} onClick={extend}>Pedir más tiempo</button>{' '}
                  <button className="back" disabled={busy} onClick={cancel}>Cancelar reserva</button>
                </p>
                {message && <p className="msg" role="alert">{message}</p>}
              </aside>
          ) : (
              <aside>
                <h3>Tu selección</h3>
                {items.length ? (
                    <>
                      <ul>
                        {items.map((s) => (
                            <li key={s.id}>
                              <span>{s.sector}, fila {s.row}, asiento {s.number}</span>
                              <b>{money(s.price)}</b>
                            </li>
                        ))}
                      </ul>
                      <div className="total"><span>Total</span><b>{money(total)}</b></div>
                    </>
                ) : (
                    <p className="muted">Elegí hasta {MAX_SEATS} asientos en el plano.</p>
                )}
                <button className="btn" disabled={!items.length || busy} onClick={reserve}>
                  {token ? 'Reservar asientos' : 'Ingresar para reservar'}
                </button>
                {message && <p className="msg" role="alert">{message}</p>}
              </aside>
          )}
        </div>
      </>
  );
}