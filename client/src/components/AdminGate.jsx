import { useEffect, useState } from 'react';
import { KeyRound, Loader2, LogOut, ShieldCheck, TriangleAlert } from 'lucide-react';
import { api, getAdminToken, setAdminToken, errorMessage } from '../lib/api';
import { useApp } from '../lib/AppContext';
import { Alert, Spinner } from './ui';

/** Gate admin pages behind ADMIN_TOKEN when the server requires one. */
export default function AdminGate({ children }) {
  const { config, loading } = useApp();
  const [state, setState] = useState('checking');
  const [token, setToken] = useState('');
  const [error, setError] = useState(null);

  const verify = async () => {
    try {
      await api.get('/admin/verify');
      setState('ok');
    } catch (e) {
      setState('login');
      if (getAdminToken()) setError(errorMessage(e));
    }
  };

  useEffect(() => {
    if (!loading) verify();
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state === 'checking') return <Spinner label="Checking admin access…" />;
  if (state === 'ok') {
    return (
      <>
        <div className="border-b border-slate-800 bg-slate-900 text-slate-100">
          <div className="container-page flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
            <span className="inline-flex items-center gap-1.5 font-semibold"><ShieldCheck size={14} /> Admin portal · for municipal staff</span>
            {config?.adminTokenRequired ? (
              <button className="inline-flex items-center gap-1 font-semibold text-slate-300 hover:text-white" onClick={() => { setAdminToken(''); setState('login'); }}>
                <LogOut size={13} /> Sign out
              </button>
            ) : (
              <span className="inline-flex items-center gap-1 text-amber-300"><TriangleAlert size={13} /> Open to everyone: set ADMIN_TOKEN in .env to require a login</span>
            )}
          </div>
        </div>
        {children}
      </>
    );
  }
  return (
    <div className="container-page grid min-h-[60vh] place-items-center py-10">
      <form
        className="card w-full max-w-sm p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setAdminToken(token.trim());
          setState('checking');
          await verify();
        }}
      >
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-600"><KeyRound size={20} /></div>
        <h1 className="mt-4 text-xl font-extrabold">Administrator access</h1>
        <p className="mt-1 text-sm text-slate-600">Enter the ADMIN_TOKEN configured on the server.</p>
        <input type="password" className="input mt-4" placeholder="Admin token" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="current-password" required />
        {error && <Alert tone="error" className="mt-3">{error}</Alert>}
        <button className="btn-primary mt-4 w-full" disabled={!token}>{state === 'checking' ? <Loader2 className="animate-spin" size={16} /> : 'Continue'}</button>
      </form>
    </div>
  );
}
