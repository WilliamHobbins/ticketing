export const API = '/api/v1/catalog';
export const MAX_SEATS = 6;

export async function get<T>(path: string): Promise<T> {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json() as Promise<T>;
}

export const money = (n: number) =>
    new Intl.NumberFormat('es-UY', { style: 'currency', currency: 'UYU', maximumFractionDigits: 0 }).format(n);

export const time = (d: Date) => d.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' });

/* ------------------------------------------------------------------ */
/* Cliente compartido para los servicios detrás del gateway           */
/* ------------------------------------------------------------------ */

export const ORDERS_API = '/api/v1/orders';

// Solo para desarrollo directo contra un servicio (sin gateway): VITE_DEV_USER_ID=<uuid>
const DEV_USER_ID: string | undefined = (import.meta as any).env?.VITE_DEV_USER_ID;

/** Error con el formato { error: { code, message, details } } de los servicios */
export class ApiErr extends Error {
  constructor(
      public status: number,
      public code: string,
      message: string,
      public details?: { seatIds?: string[] },
  ) {
    super(message);
  }
}

export function authHeaders(token: string | null, json = false): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = 'Bearer ' + token;
  if (DEV_USER_ID) h['X-User-Id'] = DEV_USER_ID;
  return h;
}

/** Llamada autenticada. Lanza ApiErr si el servidor responde con error, y Error si no hay red. */
export async function call<T = void>(
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    token: string | null,
    body?: unknown,
    extraHeaders?: Record<string, string>,
): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: { ...authHeaders(token, body !== undefined), ...extraHeaders },
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

/** UUID para Idempotency-Key. randomUUID solo existe en https/localhost, de ahí el respaldo. */
export const uuid = (): string =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === 'x' ? r : (r & 3) | 8).toString(16);
        });

export const dateTime = (iso: string) =>
    new Date(iso).toLocaleString('es-UY', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);


export const eventWhen = (iso: string) =>
    cap(new Date(iso).toLocaleDateString('es-UY', { weekday: 'long', day: 'numeric', month: 'long' })) +
    ', ' + time(new Date(iso));