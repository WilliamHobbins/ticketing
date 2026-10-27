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
