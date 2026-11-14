export class ApiError extends Error {
    constructor(message: string, public status: number, public code?: string) {
        super(message);
    }
}

interface Opts { method?: string; body?: unknown; token?: string | null }

async function call<T>(path: string, { method = 'GET', body, token }: Opts = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;

    let res: Response;
    try {
        res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch {
        throw new ApiError('No se pudo conectar con el servicio.', 0, 'NETWORK');
    }
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* sin cuerpo JSON */ }
    if (!res.ok) throw new ApiError(data?.error?.message ?? 'Error ' + res.status, res.status, data?.error?.code);
    return data as T;
}

export interface LoginResult {
    accessToken: string;
    tokenType: 'Bearer';
    expiresIn: string;
    user: { id: string; name: string; email: string };
}

export const register = (name: string, email: string, password: string) =>
    call<{ id: string; name: string; email: string; createdAt: string }>('/api/v1/users/register', {
        method: 'POST', body: { name, email, password },
    });

export const login = (email: string, password: string) =>
    call<LoginResult>('/api/v1/users/login', { method: 'POST', body: { email, password } });

export const me = (token: string) =>
    call<{ name: string; email: string }>('/api/v1/users/me', { token });

/** Fecha de expiración (ms) leída del payload del JWT, o null si no se puede decodificar. */
export function tokenExpiry(token: string): number | null {
    try {
        const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const { exp } = JSON.parse(atob(p));
        return typeof exp === 'number' ? exp * 1000 : null;
    } catch { return null; }
}