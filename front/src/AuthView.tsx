import { FormEvent, useState } from 'react';
import { ApiError, login, register } from './authApi';

interface Props {
    mode: 'login' | 'register';
    next: string;
    setToken: (t: string | null) => void;
}
type Errors = Partial<Record<'name' | 'email' | 'password' | 'password2', string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AuthView({ mode, next, setToken }: Props) {
    const isRegister = mode === 'register';
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const [showPass, setShowPass] = useState(false);

    function validate(f: FormData): Errors {
        const e: Errors = {};
        const email = String(f.get('email')).trim();
        const password = String(f.get('password'));
        if (!EMAIL_RE.test(email) || email.length > 254) e.email = 'Ingresá un correo válido.';
        if (isRegister) {
            if (!String(f.get('name')).trim()) e.name = 'Ingresá tu nombre.';
            if (password.length < 10) e.password = 'Usá al menos 10 caracteres.';
            else if (new TextEncoder().encode(password).length > 72)
                e.password = 'Máximo 72 bytes (acentos y emojis cuentan más de uno).';
            if (password !== f.get('password2')) e.password2 = 'Las contraseñas no coinciden.';
        } else if (!password) e.password = 'Ingresá tu contraseña.';
        return e;
    }

    async function submit(ev: FormEvent<HTMLFormElement>) {
        ev.preventDefault();
        const f = new FormData(ev.currentTarget);
        const errs = validate(f);
        setErrors(errs);
        setMessage('');
        if (Object.keys(errs).length) return;

        const email = String(f.get('email')).trim().toLowerCase();
        const password = String(f.get('password'));
        setBusy(true);
        try {
            if (isRegister) await register(String(f.get('name')).trim(), email, password);
            const r = await login(email, password); // tras registrarse, entra directo
            sessionStorage.setItem('user', JSON.stringify(r.user));
            setToken(r.accessToken);
            location.hash = '#' + next;
        } catch (err) {
            const e = err as ApiError;
            if (e.code === 'EMAIL_ALREADY_EXISTS') setErrors({ email: 'Ya existe una cuenta con ese correo.' });
            else if (e.code === 'INVALID_CREDENTIALS') setMessage('Correo o contraseña incorrectos.');
            else setMessage(e.message);
        } finally {
            setBusy(false);
        }
    }

    const q = next !== '/' ? '?next=' + encodeURIComponent(next) : '';
    const field = (k: keyof Errors) => errors[k] && <p className="field-err" role="alert">{errors[k]}</p>;

    const legend = (
        <div className="legend">
            <span><i />Libre</span>
            <span><i className="lg-on" />Tu selección</span>
            <span className="na"><i className="lg-off" />No disponible</span>
        </div>
    );


    return (
        <div className="auth">
            <h1>{isRegister ? 'Crear cuenta' : 'Ingresar'}</h1>
            <form onSubmit={submit} noValidate>
                {isRegister && (
                    <label>Nombre
                        <input name="name" autoComplete="name" maxLength={100} aria-invalid={!!errors.name} />
                        {field('name')}
                    </label>
                )}
                <label>Correo
                    <input name="email" type="email" autoComplete="username" aria-invalid={!!errors.email} />
                    {field('email')}
                </label>
                <label>Contraseña
                    <span className="pw">
            <input
                name="password"
                type={showPass ? 'text' : 'password'}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                aria-invalid={!!errors.password}
            />
            <button type="button" className="link" onClick={() => setShowPass((v) => !v)}>
              {showPass ? 'Ocultar' : 'Mostrar'}
            </button>
          </span>
                    {isRegister && <small className="muted">Entre 10 y 72 caracteres.</small>}
                    {field('password')}
                </label>
                {isRegister && (
                    <label>Repetir contraseña
                        <input name="password2" type={showPass ? 'text' : 'password'} autoComplete="new-password" aria-invalid={!!errors.password2} />
                        {field('password2')}
                    </label>
                )}
                <button className="btn" disabled={busy}>
                    {busy ? 'Enviando…' : isRegister ? 'Crear cuenta' : 'Ingresar'}
                </button>
                {message && <p className="msg" role="alert">{message}</p>}
            </form>
            <p className="muted">
                {isRegister
                    ? <>¿Ya tenés cuenta? <a href={'#/login' + q}>Ingresar</a></>
                    : <>¿No tenés cuenta? <a href={'#/register' + q}>Crear cuenta</a></>}
            </p>
        </div>
    );
}