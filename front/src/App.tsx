import { useEffect, useState } from 'react';
import EventList from './EventList';
import EventView from './EventView';

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

  const m = hash.match(/^#\/event\/([\w-]+)/);

  return (
    <>
      <header>
        <a className="brand" href="#/">Entradas</a>
        <span>{token && <button onClick={() => saveToken(null)}>Salir</button>}</span>
      </header>
      <main>{m ? <EventView key={m[1]} id={m[1]} token={token} setToken={saveToken} /> : <EventList />}</main>
    </>
  );
}
