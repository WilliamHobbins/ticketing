import { useEffect, useState } from 'react';
import { get, money, time } from './api';
import type { EventSummary } from './types';

export default function EventList() {
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let off = false;
    setFailed(false);
    get<EventSummary[]>('/events')
      .then((e) => !off && setEvents(e))
      .catch(() => !off && setFailed(true));
    return () => { off = true; };
  }, [attempt]);

  if (failed)
    return (
      <>
        <h1>No se pudo cargar el catálogo</h1>
        <p><button className="back" onClick={() => setAttempt((n) => n + 1)}>Reintentar</button></p>
      </>
    );
  if (!events) return <p className="muted">Cargando eventos…</p>;

  return (
    <>
      <h1>Próximos eventos</h1>
      {events.length === 0 && <p>No hay eventos publicados todavía.</p>}
      {events.map((e) => {
        const d = new Date(e.startsAt);
        return (
          <a key={e.id} className="row" href={`#/event/${e.id}`}>
            <div className="date">
              <b>{d.getDate()}</b>
              <span>{d.toLocaleDateString('es-UY', { month: 'short' })}</span>
            </div>
            <div>
              <h2>{e.title}</h2>
              <p>{e.venueName}, {e.venueCity}<br />{time(d)} h, {e.category}</p>
            </div>
            <div className="price"><small>Desde</small>{money(e.minPrice ?? e.basePrice)}</div>
          </a>
        );
      })}
    </>
  );
}
