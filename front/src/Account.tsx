import { useEffect, useState } from 'react';
import { ApiError, me, tokenExpiry } from './authApi';

interface Props {
    token: string;
    setToken: (t: string | null) => void;
}

export default function Account({ token, setToken }: Props) {
    const [user, setUser] = useState<{ id: string; email: string } | null>(null);
    const [error, setError] = useState('');
    const exp = tokenExpiry(token);

    useEffect(() => {
        let off = false;
        me(token)
            .then((u) => !off && setUser(u))
            .catch((e: ApiError) => {
                if (off) return;
                if (e.status === 401) { setToken(null); location.hash = '#/login?next=%2Faccount'; }
                else setError(e.message);
            });
        return () => { off = true; };
    }, [token, setToken]);

    return (
        <div className="auth">
            <h1>Mi cuenta</h1>
            {error && <p className="msg" role="alert">{error}</p>}
            {!user && !error && <p className="muted">Cargando…</p>}
            {user && (
                <dl className="account">
                    <dt>Correo</dt><dd>{user.email}</dd>
                    <dt>ID</dt><dd className="mono">{user.id}</dd>
                    <dt>La sesión vence</dt>
                    <dd>{exp ? new Date(exp).toLocaleString('es-UY') : 'No disponible'}</dd>
                </dl>
            )}
            <p>
                <button className="btn" onClick={() => { setToken(null); location.hash = '#/'; }}>Cerrar sesión</button>
            </p>
            <a className="back" href="#/">Volver a los eventos</a>
        </div>
    );
}