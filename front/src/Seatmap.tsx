import { useEffect, useMemo, useRef, useState } from 'react';
import { money } from './api';
import './seatmap.css';

/* Plano de asientos. Copia la distribución de cada sala (solo la posición de los asientos):
   - Teatro Solís: herradura, escenario arriba; platea al centro, palcos a los lados, paraíso en arco al fondo.
   - Teatro Larrañaga: herradura, escenario abajo; platea al centro y galería en arco alrededor.
   - Sala Zitarrosa: sala rectangular, escenario abajo; filas en tres bloques (lateral, centro, lateral) con pasillos.
   Si la sala no se reconoce, o trae un sector que no conocemos, se dibuja el plano simple por sectores y filas. */

export interface MapSeat {
    id: string;
    sector: string;
    row: number;
    number: number;
    price: number;
    status: 'available' | 'held' | 'sold';
}

const SEAT = 26; // lado del asiento (px)
const PITCH = 30; // distancia entre asientos de una fila
const ROW = 32; // distancia entre filas
const LABEL_H = 38;
const STAGE_H = 30;

interface Pos { x: number; y: number }
interface Label { x: number; y: number; name: string; price: number }
interface Group { name: string; price: number; rows: MapSeat[][] }
interface Layout {
    W: number;
    H: number;
    stage: { x: number; y: number; w: number; bottom: boolean };
    pos: Map<string, Pos>;
    labels: Label[];
}

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/** sector -> filas ordenadas -> asientos ordenados por número */
function group(seats: MapSeat[]): Map<string, Group> {
    const tmp = new Map<string, { name: string; price: number; rows: Map<number, MapSeat[]> }>();
    for (const s of seats) {
        const k = norm(s.sector);
        let g = tmp.get(k);
        if (!g) tmp.set(k, (g = { name: s.sector, price: s.price, rows: new Map() }));
        g.rows.set(s.row, [...(g.rows.get(s.row) ?? []), s]);
    }
    const out = new Map<string, Group>();
    tmp.forEach((g, k) =>
        out.set(k, {
            name: g.name,
            price: g.price,
            rows: [...g.rows.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l.sort((a, b) => a.number - b.number)),
        }),
    );
    return out;
}

/** Fila en arco: el centro queda más lejos del escenario que los extremos (como una fila de platea). */
function arcRow(list: MapSeat[], cx: number, y: number, pitch: number, sag: number, pos: Map<string, Pos>) {
    const n = list.length;
    const half = ((n - 1) * pitch) / 2 || 1;
    list.forEach((s, i) => {
        const dx = (i - (n - 1) / 2) * pitch;
        const u = dx / half;
        pos.set(s.id, { x: cx + dx - SEAT / 2, y: y + sag * (1 - u * u) });
    });
}

/** Calcula el alto y, si el escenario va abajo, da vuelta todo en vertical. */
function finish(pos: Map<string, Pos>, labels: Label[], W: number, stageW: number, stageBottom: boolean): Layout {
    let maxY = 0;
    pos.forEach((p) => (maxY = Math.max(maxY, p.y + SEAT)));
    const H = maxY + 16;
    if (stageBottom) {
        pos.forEach((p, id) => pos.set(id, { x: p.x, y: H - p.y - SEAT }));
        labels = labels.map((l) => ({ ...l, y: H - l.y - LABEL_H }));
    }
    return {
        W, H, pos, labels,
        stage: { x: (W - stageW) / 2, y: stageBottom ? H - STAGE_H : 0, w: stageW, bottom: stageBottom },
    };
}

const OUTER = ['tertulia', 'cazuela', 'galeria', 'paraiso']; // de adentro hacia afuera

/** Solís y Larrañaga: herradura. */
function horseshoe(g: Map<string, Group>, withPalcos: boolean, stageBottom: boolean): Layout | null {
    const known = new Set(['platea', ...(withPalcos ? ['palcos'] : []), ...OUTER]);
    if (!g.size || [...g.keys()].some((k) => !known.has(k))) return null;

    const W = 700, cx = W / 2, top = 80;
    const pos = new Map<string, Pos>();
    const labels: Label[] = [];
    let bottom = top;

    const platea = g.get('platea');
    if (platea) {
        platea.rows.forEach((r, i) => arcRow(r, cx, top + i * ROW, PITCH, 34, pos));
        bottom = top + (platea.rows.length - 1) * ROW + 34 + SEAT;
        labels.push({ x: cx, y: top - 40, name: platea.name, price: platea.price });
    }

    const palcos = withPalcos ? g.get('palcos') : undefined;
    if (palcos) {
        // Dos bloques a los costados de la platea; la fila 1 es la más cercana a la platea.
        const R = palcos.rows.length;
        palcos.rows.forEach((r, i) => {
            const h = Math.ceil(r.length / 2);
            r.slice(0, h).forEach((s, k) => pos.set(s.id, { x: cx - 210 - i * PITCH - SEAT / 2, y: top + 16 + k * PITCH }));
            r.slice(h).forEach((s, k) => pos.set(s.id, { x: cx + 210 + i * PITCH - SEAT / 2, y: top + 16 + k * PITCH }));
            bottom = Math.max(bottom, top + 16 + (h - 1) * PITCH + SEAT);
        });
        const lx = (R - 1) * PITCH / 2;
        labels.push({ x: cx - 210 - lx, y: top - 40, name: palcos.name, price: palcos.price });
        labels.push({ x: cx + 210 + lx, y: top - 40, name: palcos.name, price: palcos.price });
    }

    let y = bottom + 44;
    for (const k of OUTER) {
        const o = g.get(k);
        if (!o) continue;
        const n = Math.max(...o.rows.map((r) => r.length));
        const pitch = Math.min(46, (W - 90) / Math.max(1, n - 1));
        o.rows.forEach((r, i) => arcRow(r, cx, y + i * ROW, pitch, 80, pos));
        labels.push({ x: cx, y: y + 36, name: o.name, price: o.price });
        y += o.rows.length * ROW + 120;
    }
    return finish(pos, labels, W, 280, stageBottom);
}

/** Zitarrosa: filas rectas en tres bloques (lateral, centro, lateral) separados por pasillos. */
function zitarrosa(g: Map<string, Group>): Layout | null {
    if (!g.size || [...g.keys()].some((k) => k !== 'platea' && k !== 'balcon')) return null;
    const W = 600, cx = W / 2, AISLE = 36;
    const pos = new Map<string, Pos>();
    const labels: Label[] = [];

    const place = (grp: Group, y0: number) => {
        labels.push({ x: cx, y: y0 - 40, name: grp.name, price: grp.price });
        grp.rows.forEach((r, i) => {
            const n = r.length;
            const wing = Math.ceil(n * 0.2);
            const startX = cx - (n * PITCH + 2 * AISLE) / 2;
            r.forEach((s, k) => {
                const gap = k < wing ? 0 : k < n - wing ? AISLE : 2 * AISLE;
                pos.set(s.id, { x: startX + k * PITCH + gap, y: y0 + i * ROW });
            });
        });
        return y0 + (grp.rows.length - 1) * ROW + SEAT;
    };

    let y = 80;
    const platea = g.get('platea');
    if (platea) y = place(platea, y) + 88;
    const balcon = g.get('balcon');
    if (balcon) place(balcon, y);
    return finish(pos, labels, W, 360, true);
}

function buildLayout(venue: string, seats: MapSeat[]): Layout | null {
    const v = norm(venue);
    const g = group(seats);
    if (v.includes('solis')) return horseshoe(g, true, false);
    if (v.includes('larra')) return horseshoe(g, false, true);
    if (v.includes('zitarrosa')) return zitarrosa(g);
    return null;
}

/* ------------------------------------------------------------------ */

interface Props {
    venue: string;
    seats: MapSeat[];
    sel: Map<string, MapSeat>;
    disabled: boolean;
    onToggle: (s: MapSeat) => void;
}

function SeatBtn({ s, sel, disabled, onToggle, style }: Omit<Props, 'venue' | 'seats'> & { s: MapSeat; style?: React.CSSProperties }) {
    const on = sel.has(s.id);
    const unavailable = s.status !== 'available' && !on;
    const label = on
        ? 'tu selección'
        : s.status === 'sold' ? 'no disponible, vendido'
            : s.status === 'held' ? 'no disponible, reservado por otra persona'
                : money(s.price);
    return (
        <button
            className={`seat${s.status === 'sold' ? ' sold' : ''}${s.status === 'held' && !on ? ' held' : ''}${on ? ' on' : ''}`}
            style={style}
            disabled={unavailable || disabled}
            aria-pressed={on}
            aria-label={`${s.sector}, fila ${s.row}, asiento ${s.number}, ${label}`}
            onClick={() => onToggle(s)}
        >
            {s.number}
        </button>
    );
}

/** Plano con posiciones absolutas, escalado para que entre en el ancho disponible. */
function Positioned({ layout, seats, ...rest }: Omit<Props, 'venue'> & { layout: Layout }) {
    const wrap = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(1);

    useEffect(() => {
        const el = wrap.current;
        if (!el) return;
        const fit = () => setScale(Math.max(0.62, Math.min(1, el.clientWidth / layout.W)));
        fit();
        const ro = new ResizeObserver(fit);
        ro.observe(el);
        return () => ro.disconnect();
    }, [layout.W]);

    const { W, H, stage } = layout;
    return (
        <div className="sm-wrap" ref={wrap}>
            <div style={{ width: W * scale, height: H * scale }}>
                <div className="sm" style={{ width: W, height: H, transform: `scale(${scale})` }}>
                    <div
                        className={'sm-stage' + (stage.bottom ? ' sm-stage--bottom' : '')}
                        style={{ left: stage.x, top: stage.y, width: stage.w, height: STAGE_H }}
                    >
                        Escenario
                    </div>
                    {layout.labels.map((l, i) => (
                        <div className="sm-label" key={i} style={{ left: l.x, top: l.y }}>
                            <b>{l.name}</b>
                            <span>{money(l.price)} por entrada</span>
                        </div>
                    ))}
                    {seats.map((s) => {
                        const p = layout.pos.get(s.id);
                        return p ? <SeatBtn key={s.id} s={s} style={{ left: p.x, top: p.y }} {...rest} /> : null;
                    })}
                </div>
            </div>
        </div>
    );
}

/** Plano simple: un bloque por sector, con sus filas. */
function Plain({ seats, ...rest }: Omit<Props, 'venue'>) {
    const groups = useMemo(() => group(seats), [seats]);
    return (
        <>
            <div className="stage">Escenario</div>
            {[...groups.values()].map((g) => (
                <section className="sector" key={g.name}>
                    <h3>
                        <span>{g.name}</span>
                        <span className="muted">{money(g.price)} por entrada</span>
                    </h3>
                    {g.rows.map((list) => (
                        <div className="srow" key={list[0].row}>
                            <span className="rl">{list[0].row}</span>
                            <div className="seats">
                                {list.map((s) => <SeatBtn key={s.id} s={s} {...rest} />)}
                            </div>
                        </div>
                    ))}
                </section>
            ))}
        </>
    );
}

export default function Seatmap({ venue, seats, ...rest }: Props) {
    const layout = useMemo(() => buildLayout(venue, seats), [venue, seats]);
    return layout ? <Positioned layout={layout} seats={seats} {...rest} /> : <Plain seats={seats} {...rest} />;
}

export { buildLayout }; // para pruebas