import { useEffect, useState } from 'react';
import Account from './Account';
import AuthView from './AuthView';
import EventList from './EventList';
import EventView from './EventView';
import './auth.css';

const useHash = () => {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash;
};

export default function App() {
  const hash = useHash();
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem('token'));

  const saveToken = (t: string | null) => {
    if (t) sessionStorage.setItem('token', t);
    else sessionStorage.removeItem('token');
    setToken(t);
  };

  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const next = new URLSearchParams(query).get('next') || '/';
  const event = path.match(/^\/event\/([\w-]+)/);

  let view;
  if (event) {
    view = <EventView key={event[1]} id={event[1]} token={token} setToken={saveToken} />;
  } else if (path === '/login' || path === '/register' || path === '/account') {
    view = token
        ? <Account token={token} setToken={saveToken} />
        : <AuthView key={path} mode={path === '/register' ? 'register' : 'login'}
                    next={path === '/account' ? '/account' : next} setToken={saveToken} />;
  } else {
    view = <EventList />;
  }

  return (
      <>
        <header>
          <a className="brand" href="#/">Entradas</a>
          <span className="nav">
          {token ? (
              <>
                <a className="nav-link" href="#/account">Mi cuenta</a>
                <button className="nav-btn" onClick={() => saveToken(null)}>Salir</button>
              </>
          ) : (
              <>
                <a className="nav-btn" href="#/login">Ingresar</a>
                <a className="nav-btn nav-btn--solid" href="#/register">Crear cuenta</a>
              </>
          )}
        </span>
        </header>
        <main>{view}</main>
      </>
  );
}