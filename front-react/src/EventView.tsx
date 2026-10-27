import { FormEvent, useEffect, useMemo, useState } from 'react';
import { get, money, time, MAX_SEATS } from './api';
import type { EventSummary, Seat } from './types';

interface Props {
  id: string;
  token: string | null;
  setToken: (t: string | null) => void;
}
interface Done { demo: boolean; count: number; total: number }

export default function EventView({ id, token, setToken }: Props) {
  const [ev, setEv] = useState<EventSummary | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [failed, setFailed] = useState(false);
  const [sel, setSel] = useState<Map<string, Seat>>(new Map());
  const [needLogin, setNeedLogin] = useState(false);
  const [message, setMessage] = useState('');
  const [done, setDone] = useState<Done | null>(null);

  useEffect(() => {
    let off = false;
    Promise.all([get<EventSummary>('/events/' + id), get<Seat[]>('/events/' + id + '/seats')])
      .then(([e, s]) => { if (!off) { setEv(e); setSeats(s); } })
      .catch(() => !off && setFailed(true));
    return () => { off = true; };
  }, [id]);

  // sector -> fila -> asientos
  const bySector = useMemo(() => {
    const out = new Map<string, Map<string, Seat[]>>();
    for (const s of seats) {
      const rows = out.get(s.sector) ?? new Map<string, Seat[]>();
      const row = String(s.row);
      rows.set(row, [...(rows.get(row) ?? []), s]);
      out.set(s.sector, rows);
    }
    return out;
  }, [seats]);

  const items = [...sel.values()];
  const total = items.reduce((a, s) => a + s.price, 0);

  function toggle(s: Seat) {
    const next = new Map(sel);
    if (next.has(s.id)) { next.delete(s.id); setMessage(''); }
    else if (next.size < MAX_SEATS) { next.set(s.id, s); setMessage(''); }
    else setMessage('Máximo ' + MAX_SEATS + ' entradas por compra.');
    setSel(next);
  }

  async function buy(tok: string | null = token) {
    if (!tok) { setNeedLogin(true); return; }
    const ids = [...sel.keys()];
    let demo = false;
    try {
      const r = await fetch('/api/v1/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
        body: JSON.stringify({ eventId: id, seatIds: ids }),
      });
      if ([404, 502, 503].includes(r.status)) demo = true; // pedidos aún no desplegado: modo demo
      else if (r.status === 401) {
        setToken(null); setNeedLogin(true); setMessage('La sesión venció. Ingresá de nuevo.');
        return;
      } else if (!r.ok) {
        setMessage('No se pudo completar la compra (' + r.status + '). Probá con otros asientos.');
        return;
      }
    } catch { demo = true; }
    setSeats((prev) => prev.map((s) => (ids.includes(s.id) ? { ...s, status: 'sold' } : s)));
    setDone({ demo, count: ids.length, total });
    setSel(new Map());
  }

  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)));
    const r = await fetch('/api/v1/users/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    }).catch(() => null);
    if (!r || !r.ok) { setMessage('Correo o contraseña incorrectos.'); return; }
    const { accessToken } = (await r.json()) as { accessToken: string };
    setToken(accessToken);
    setMessage('');
    await buy(accessToken);
  }

  if (failed)
    return (<><h1>No se pudo cargar el catálogo</h1><p><a href="#/">Volver a los eventos</a></p></>);
  if (!ev) return <p className="muted">Cargando mapa de asientos…</p>;

  const d = new Date(ev.startsAt);

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
            <span><i style={{ background: 'var(--cobalt)', borderColor: 'var(--cobalt)' }} />Tu selección</span>
            <span><i style={{ borderColor: 'var(--sold)' }} />Ocupado</span>
          </div>
          <div className="stage">Escenario</div>
          {[...bySector].map(([name, rows]) => (
            <section className="sector" key={name}>
              <h3>
                <span>{name}</span>
                <span className="muted">{money([...rows.values()][0][0].price)} por entrada</span>
              </h3>
              {[...rows].map(([row, list]) => (
                <div className="srow" key={row}>
                  <span className="rl">{row}</span>
                  <div className="seats">
                    {list.map((s) => {
                      const sold = s.status !== 'available';
                      const on = sel.has(s.id);
                      return (
                        <button
                          key={s.id}
                          className={`seat${sold ? ' sold' : ''}${on ? ' on' : ''}`}
                          disabled={sold}
                          aria-pressed={on}
                          aria-label={`${name}, fila ${row}, asiento ${s.number}, ${sold ? 'ocupado' : money(s.price)}`}
                          onClick={() => toggle(s)}
                        >
                          {s.number}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>

        {done ? (
          <aside className="ok">
            <h3>Compra confirmada</h3>
            <p>{done.count} entrada{done.count > 1 ? 's' : ''} por {money(done.total)}.</p>
            {done.demo && (
              <p className="muted">Compra simulada: el servicio de pedidos todavía no está disponible en este entorno.</p>
            )}
            <a className="back" href="#/">Ver más eventos</a>
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
            {needLogin && !token ? (
              <form onSubmit={login}>
                <p className="muted" style={{ margin: '0 0 8px' }}>Ingresá para completar la compra.</p>
                <input name="email" type="email" placeholder="Correo" required autoComplete="username" />
                <input name="password" type="password" placeholder="Contraseña" required autoComplete="current-password" />
                <button className="btn">Ingresar y comprar</button>
              </form>
            ) : (
              <button className="btn" disabled={!items.length} onClick={() => buy()}>Comprar entradas</button>
            )}
            {message && <p className="msg" role="alert">{message}</p>}
          </aside>
        )}
      </div>
    </>
  );
}
