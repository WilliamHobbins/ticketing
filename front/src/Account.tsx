import { useEffect, useState } from 'react';
import { ApiError, me, tokenExpiry } from './authApi';

interface Props {
    token: string;
    setToken: (t: string | null) => void;
}

const storedName = (): string => {
    try {
        const u = JSON.parse(sessionStorage.getItem('user') ?? 'null');
        return typeof u?.name === 'string' ? u.name.trim() : '';
    } catch { return ''; }
};

export default function Account({ token, setToken }: Props) {
    const [email, setEmail] = useState('');
    const [error, setError] = useState('');
    const name = storedName();
    const exp = tokenExpiry(token);

    useEffect(() => {
        let off = false;
        me(token)
            .then((u) => !off && setEmail(u.email))
            .catch((e: ApiError) => {
                if (off) return;
                if (e.status === 401) { setToken(null); location.hash = '#/login?next=%2Faccount'; }
                else setError(e.message);
            });
        return () => { off = true; };
    }, [token, setToken]);

    const displayName = name || email;

    return (
        <div className="auth">
            <h1>Mi cuenta</h1>
            {error && <p className="msg" role="alert">{error}</p>}
            {!email && !error && <p className="muted">Cargando…</p>}
            {email && (
                <div className="account-card">
                    <div className="account-head">
                        <div className="account-avatar" aria-hidden="true">
                            {displayName.charAt(0).toUpperCase() || '?'}
                        </div>
                        <div>
                            <div className="account-name">{displayName}</div>
                            <div className="account-email">{email}</div>
                        </div>
                    </div>
                    <div className="account-row">
                        <span className="account-label">La sesión vence</span>
                        <span className="account-value">
                            {exp
                                ? new Date(exp).toLocaleString('es-UY', { dateStyle: 'long', timeStyle: 'short' })
                                : 'No disponible'}
                        </span>
                    </div>
                </div>
            )}
            <p>
                <button className="btn" onClick={() => { setToken(null); location.hash = '#/'; }}>Cerrar sesión</button>
            </p>
            <a className="back" href="#/">Volver a los eventos</a>
        </div>
    );
}