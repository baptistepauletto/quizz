import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, api, getToken, login } from '../lib/api';

/** Asks for the host PIN once, then renders its children. Used by /prep and /host. */
export function PinGate({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!getToken()) return setAuthed(false);
    api('GET', '/api/packs')
      .then(() => setAuthed(true))
      .catch((err) => setAuthed(err instanceof ApiError && err.status === 401 ? false : true));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(pin);
      setAuthed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in');
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  if (authed === null) return <div className="page muted">Loading…</div>;
  if (authed) return <>{children}</>;

  return (
    <form className="home" onSubmit={submit}>
      <h1 className="brand">
        <span className="brand-q">Quizz</span>
        <span className="brand-in">In</span>
      </h1>
      <div className="field">
        <label htmlFor="pin">Host PIN</label>
        <input
          id="pin"
          className="input"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value)}
        />
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn primary big" disabled={busy || !pin}>
        Unlock
      </button>
    </form>
  );
}
