import { useCallback, useEffect, useState } from 'react';
import BaseTiles from '../components/BaseTiles';
import { Link, useParams } from 'react-router-dom';
import { MapContainer, Marker } from 'react-leaflet';
import { ArrowLeft, MapPin, Clock, History, StickyNote, ShieldAlert, ShieldCheck, RefreshCw, Workflow, Check, X, Loader2, Lock } from 'lucide-react';
import { api, errorMessage, isUnauthorized } from '../lib/api';
import { STATUS, formatDate, statusLabel } from '../lib/constants';
import { markerIcon } from '../lib/leaflet';
import AnalysisPanel from '../components/AnalysisPanel';
import { RunStatus } from '../components/AgentWorkflow';
import { Alert, DemoBadge, PriorityBadge, Spinner, StatusBadge, EmptyState } from '../components/ui';

function AdminPanel({ report, onUpdated }) {
  const [authed, setAuthed] = useState(null);
  const [notes, setNotes] = useState([]);
  const [status, setStatus] = useState(report.status);
  const [statusNote, setStatusNote] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);

  const loadNotes = useCallback(() => {
    api.get(`/admin/reports/${report.id}/notes`).then((r) => { setNotes(r.data.notes); setAuthed(true); }).catch((e) => setAuthed(isUnauthorized(e) || e?.response?.status === 503 ? false : true));
  }, [report.id]);
  useEffect(() => { loadNotes(); setStatus(report.status); }, [loadNotes, report.status]);

  const run = async (key, fn, success) => {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: 'success', text: success });
      onUpdated();
    } catch (e) {
      setMsg({ tone: 'error', text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  if (authed === null) return <Spinner />;
  if (!authed) {
    return (
      <EmptyState icon={Lock} title="Administrator actions">
        <Link to="/dashboard" className="font-semibold text-brand-600 hover:underline">Sign in on the dashboard</Link> to update status, add notes or review duplicates.
      </EmptyState>
    );
  }
  const pendingDupes = report.duplicates.filter((d) => d.status === 'suggested');

  return (
    <div className="space-y-5">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div>
        <label className="label" htmlFor="status">Update status</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select id="status" className="input sm:w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <input className="input" placeholder="Optional note for history" value={statusNote} onChange={(e) => setStatusNote(e.target.value)} maxLength={1000} />
          <button className="btn-primary shrink-0" disabled={status === report.status || !!busy} onClick={() => run('status', () => api.patch(`/admin/reports/${report.id}/status`, { status, note: statusNote || undefined }), `Status changed to ${statusLabel(status)}.`).then(() => setStatusNote(''))}>
            {busy === 'status' ? <Loader2 size={16} className="animate-spin" /> : 'Save'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {report.needs_human_review ? (
          <button className="btn-secondary" disabled={!!busy} onClick={() => run('review', () => api.post(`/admin/reports/${report.id}/review`, { flag: false }), 'Human review cleared.')}><ShieldCheck size={16} /> Mark reviewed</button>
        ) : (
          <button className="btn-secondary" disabled={!!busy} onClick={() => run('review', () => api.post(`/admin/reports/${report.id}/review`, { flag: true, reason: 'Flagged by administrator' }), 'Flagged for human review.')}><ShieldAlert size={16} /> Flag for human review</button>
        )}
        {!report.is_demo && (
          <button className="btn-secondary" disabled={!!busy} onClick={() => run('reanalyse', () => api.post(`/admin/reports/${report.id}/reanalyse?wait=true`), 'Re-analysis completed.')}>
            {busy === 'reanalyse' ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} Re-run agents
          </button>
        )}
      </div>

      {pendingDupes.length > 0 && (
        <div className="rounded-xl border border-fuchsia-200 bg-fuchsia-50/50 p-4">
          <p className="text-sm font-bold text-fuchsia-900">Duplicate group: {pendingDupes.length} suggestion(s)</p>
          <p className="mt-0.5 text-xs text-fuchsia-800">Approving marks this report as a duplicate of {pendingDupes.map((d) => d.candidate_reference).join(', ')}.</p>
          <div className="mt-3 flex gap-2">
            <button className="btn-green py-1.5 text-xs" disabled={!!busy} onClick={() => run('dup', () => api.post(`/admin/duplicates/${report.id}/review`, { decision: 'approved' }), 'Duplicate group approved.')}><Check size={14} /> Approve</button>
            <button className="btn-danger py-1.5 text-xs" disabled={!!busy} onClick={() => run('dup', () => api.post(`/admin/duplicates/${report.id}/review`, { decision: 'rejected' }), 'Duplicate suggestion rejected.')}><X size={14} /> Reject</button>
          </div>
        </div>
      )}

      <div>
        <p className="label flex items-center gap-1.5"><StickyNote size={15} /> Administrative notes</p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!note.trim()) return;
            run('note', () => api.post(`/admin/reports/${report.id}/notes`, { note }), 'Note added.').then(() => { setNote(''); loadNotes(); });
          }}
        >
          <input className="input" placeholder="Add an internal note…" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
          <button className="btn-secondary shrink-0" disabled={!note.trim() || !!busy}>Add</button>
        </form>
        <ul className="mt-3 space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-xl bg-slate-50 p-3 text-sm">
              <p className="text-slate-700">{n.note}</p>
              <p className="mt-1 text-xs text-slate-400">{n.author} · {formatDate(n.created_at)}</p>
            </li>
          ))}
          {!notes.length && <li className="text-xs text-slate-400">No notes yet.</li>}
        </ul>
      </div>
    </div>
  );
}

export default function ReportDetail() {
  const { id } = useParams();
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => api.get(`/reports/${id}`).then((r) => setReport(r.data.report)).catch((e) => setError(errorMessage(e))), [id]);
  useEffect(() => { load(); }, [load]);

  if (error) return <div className="container-page py-10"><Alert tone="error">{error}</Alert></div>;
  if (!report) return <Spinner label="Loading report…" />;

  return (
    <div className="container-page py-8">
      <Link to="/map" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-brand-600"><ArrowLeft size={16} /> Back to map</Link>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-extrabold sm:text-3xl">{report.reference}</h1>
        <StatusBadge status={report.status} />
        <PriorityBadge priority={report.priority} />
        {report.is_demo && <DemoBadge />}
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
        <span className="inline-flex items-center gap-1"><Clock size={14} /> {formatDate(report.created_at)}</span>
        <span className="inline-flex items-center gap-1"><MapPin size={14} /> {report.address || report.area || `${report.latitude.toFixed(5)}, ${report.longitude.toFixed(5)}`}</span>
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <div className="card p-6">
            <h2 className="mb-4 text-lg font-bold">AI analysis</h2>
            <AnalysisPanel report={report} />
          </div>
          <div className="card p-6">
            <h2 className="mb-4 text-lg font-bold">Administration</h2>
            <AdminPanel report={report} onUpdated={load} />
          </div>
        </div>

        <aside className="space-y-6">
          <div className="card overflow-hidden">
            {report.images.length ? (
              <a href={report.image_url} target="_blank" rel="noreferrer"><img src={report.image_url} alt="Reported issue" className="aspect-[4/3] w-full object-cover" /></a>
            ) : (
              <div className="grid aspect-[4/3] place-items-center bg-slate-100 text-sm text-slate-400">{report.is_demo ? 'DEMO record — no photo' : 'No photo'}</div>
            )}
            <div className="p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Citizen description</p>
              <p className="mt-1 text-sm text-slate-700">{report.citizen_description || <span className="text-slate-400">None provided</span>}</p>
            </div>
          </div>

          <div className="card h-56 overflow-hidden">
            <MapContainer center={[report.latitude, report.longitude]} zoom={16} className="h-full w-full" scrollWheelZoom={false}>
              <BaseTiles />
              <Marker position={[report.latitude, report.longitude]} icon={markerIcon(report.priority, { size: 22 })} />
            </MapContainer>
          </div>

          {report.latest_run && (
            <Link to={`/agents/${report.latest_run.id}`} className="card flex items-center gap-3 p-4 transition hover:shadow-lift">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600"><Workflow size={18} /></div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">Agent run #{report.latest_run.id}</p>
                <p className="text-xs text-slate-500">{report.latest_run.ai_mode === 'gemini' ? `Gemini · ${report.latest_run.model}` : 'Development mode'} · view execution log</p>
              </div>
              <RunStatus status={report.latest_run.status} />
            </Link>
          )}

          <div className="card p-5">
            <p className="mb-3 flex items-center gap-2 text-sm font-bold"><History size={16} /> Status history</p>
            <ol className="relative space-y-4 border-l-2 border-slate-100 pl-5">
              {report.history.map((h) => (
                <li key={h.id} className="relative">
                  <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white bg-brand-500 ring-2 ring-brand-100" />
                  <p className="text-sm font-semibold">{h.from_status ? `${statusLabel(h.from_status)} → ` : ''}{statusLabel(h.to_status)}</p>
                  {h.note && <p className="text-xs text-slate-600">{h.note}</p>}
                  <p className="text-xs text-slate-400">{h.changed_by} · {formatDate(h.created_at)}</p>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}
