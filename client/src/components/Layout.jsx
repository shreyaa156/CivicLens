import { Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Menu, X, FlaskConical, Sparkles, Camera, ShieldCheck } from 'lucide-react';
import { useApp } from '../lib/AppContext';
import { cx, Spinner } from './ui';

// Citizen portal: anyone can use these pages.
const CITIZEN_NAV = [
  { to: '/report', label: 'Report Issue' },
  { to: '/map', label: 'Issue Map' },
  { to: '/contact', label: 'Contact' },
];
// Admin portal: municipal staff only (protected by ADMIN_TOKEN).
const ADMIN_NAV = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/agents', label: 'Agent Activity' },
  { to: '/messages', label: 'Messages' },
];
const NAV = [...CITIZEN_NAV, ...ADMIN_NAV];

export function Logo({ light }) {
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label="CivicLens home">
      <img src="/favicon.svg" alt="" className="h-9 w-9" />
      <span className={cx('text-lg font-extrabold tracking-tight', light ? 'text-white' : 'text-ink')}>
        Civic<span className="text-brand-600">Lens</span>
      </span>
    </Link>
  );
}

function AiModeBanner() {
  const { config } = useApp();
  if (!config) return null;
  if (config.ai.mode === 'development') {
    return (
      <div className="border-b border-amber-200 bg-amber-50 text-amber-900">
        <div className="container-page flex items-center gap-2 py-1.5 text-xs font-medium">
          <FlaskConical size={14} className="shrink-0" />
          <span>
            <strong>Development mode:</strong> GEMINI_API_KEY is not configured. Agent outputs are deterministic sample responses — not Google Gemini.
          </span>
        </div>
      </div>
    );
  }
  return null;
}

export default function Layout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const { config } = useApp();
  useEffect(() => {
    setOpen(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col">
      <AiModeBanner />
      <header className="sticky top-0 z-[1100] border-b border-slate-200/70 bg-white/85 backdrop-blur-lg">
        <div className="container-page flex h-16 items-center justify-between">
          <Logo />
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
            {CITIZEN_NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) =>
                  cx('rounded-lg px-3 py-2 text-sm font-semibold transition', isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-ink')
                }>
                {n.label}
              </NavLink>
            ))}
            <span className="mx-2 h-6 w-px bg-slate-200" aria-hidden="true" />
            <span className="mr-1 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              <ShieldCheck size={13} /> Admin
            </span>
            {ADMIN_NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  cx('rounded-lg px-3 py-2 text-sm font-semibold transition', isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-ink')
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="hidden items-center gap-3 lg:flex">
            {config?.ai.mode === 'gemini' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-civic-50 px-2.5 py-1 text-xs font-semibold text-civic-700">
                <Sparkles size={12} /> Gemini live
              </span>
            )}
            <Link to="/report" className="btn-primary">
              <Camera size={16} /> Report now
            </Link>
          </div>
          <button className="btn-ghost lg:hidden" onClick={() => setOpen((o) => !o)} aria-label="Toggle menu" aria-expanded={open}>
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        {open && (
          <nav className="border-t border-slate-100 bg-white lg:hidden" aria-label="Mobile">
            <div className="container-page flex flex-col py-2">
              <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Citizens</p>
              {CITIZEN_NAV.map((n) => (
                <NavLink key={n.to} to={n.to} className={({ isActive }) => cx('rounded-lg px-3 py-2.5 text-sm font-semibold', isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-700')}>
                  {n.label}
                </NavLink>
              ))}
              <p className="mt-2 flex items-center gap-1 border-t border-slate-100 px-3 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wider text-slate-400"><ShieldCheck size={12} /> Admin (staff only)</p>
              {ADMIN_NAV.map((n) => (
                <NavLink key={n.to} to={n.to} className={({ isActive }) => cx('rounded-lg px-3 py-2.5 text-sm font-semibold', isActive ? 'bg-slate-900 text-white' : 'text-slate-700')}>
                  {n.label}
                </NavLink>
              ))}
            </div>
          </nav>
        )}
      </header>

      <main className="flex-1">
        <Suspense fallback={<Spinner />}>
          <Outlet />
        </Suspense>
      </main>

      <footer className="mt-16 border-t border-slate-200 bg-white">
        <div className="container-page grid gap-8 py-10 md:grid-cols-4">
          <div className="md:col-span-2">
            <Logo />
            <p className="mt-3 max-w-sm text-sm text-slate-500">Smarter Cities. Faster Action. Better Communities. AI-assisted civic issue intelligence for Tier 2 and Tier 3 cities in India.</p>
            <p className="mt-3 max-w-md text-xs text-slate-400">
              CivicLens recommends priorities and departments to help municipal staff triage. It is not connected to any government system and does not notify departments automatically.
            </p>
          </div>
          <div>
            <p className="text-sm font-bold text-ink">Platform</p>
            <ul className="mt-3 space-y-2 text-sm text-slate-500">
              {CITIZEN_NAV.map((n) => (
                <li key={n.to}><Link className="hover:text-brand-600" to={n.to}>{n.label}</Link></li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-sm font-bold text-ink">About</p>
            <ul className="mt-3 space-y-2 text-sm text-slate-500">
              <li>Map data © <a className="hover:text-brand-600" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors</li>
              <li>AI by Google Gemini</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-slate-100 py-4 text-center text-xs text-slate-400">© {new Date().getFullYear()} CivicLens</div>
      </footer>
    </div>
  );
}
