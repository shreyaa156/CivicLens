import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, AreaChart, Area } from 'recharts';
import { Mail, FileText, Clock, AlertTriangle, Siren, Copy, CheckCircle2, ShieldAlert, RefreshCw, Check, X, Activity, ArrowRight, MapPin } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { PRIORITY, PRIORITY_ORDER, categoryLabel, timeAgo, formatDate } from '../lib/constants';
import AdminGate from '../components/AdminGate';
import { RunStatus } from '../components/AgentWorkflow';
import { Alert, CategoryChip, DemoBadge, EmptyState, PageHeader, PriorityBadge, Spinner, StatusBadge, cx } from '../components/ui';

const BRAND = '#2563eb';
const axis = { fontSize: 12, fill: '#64748b' };
// Subtle hover highlight for bar charts (no hard border box).
const barCursor = { fill: '#2563eb', fillOpacity: 0.06, stroke: 'none', radius: 8 };
const fmtDay = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** Clean tooltip: label in muted text, value in ink with a colour swatch for identity. */
function ChartTooltip({ active, payload, label, colorFor, formatLabel }) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  const value = item.value ?? 0;
  const color = colorFor ? colorFor(item.payload) : item.color || item.stroke || BRAND;
  return (
    <div className="pointer-events-none rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur">
      <p className="text-xs font-medium text-slate-500">{formatLabel ? formatLabel(label) : label}</p>
      <p className="mt-0.5 flex items-center gap-2 text-sm font-bold text-ink">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
        {value} {value === 1 ? 'report' : 'reports'}
      </p>
    </div>
  );
}

/** Evenly spaced whole-number ticks with headroom above the tallest value. */
function yScale(values) {
  const max = Math.max(0, ...values);
  const step = max <= 5 ? 1 : max <= 10 ? 2 : Math.ceil(max / 5 / 5) * 5;
  const top = Math.max(step * 2, Math.ceil((max + step * 0.5) / step) * step);
  const ticks = [];
  for (let t = 0; t <= top; t += step) ticks.push(t);
  return { domain: [0, top], ticks };
}

/** Every day of the last 30 days, with 0 for days without reports (real counts only). */
function fillTimeline(rows) {
  const counts = Object.fromEntries(rows.map((r) => [r.day, r.reports]));
  const out = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    out.push({ day, reports: counts[day] || 0 });
  }
  return out;
}

function Stat({ icon: Icon, label, value, tone, hint }) {
  const tones = {
    blue: 'bg-brand-50 text-brand-600',
    amber: 'bg-amber-50 text-amber-600',
    orange: 'bg-orange-50 text-orange-600',
    red: 'bg-red-50 text-red-600',
    fuchsia: 'bg-fuchsia-50 text-fuchsia-600',
    green: 'bg-civic-50 text-civic-600',
  };
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-500">{label}</p>
        <span className={cx('grid h-8 w-8 place-items-center rounded-lg', tones[tone])}><Icon size={16} /></span>
      </div>
      <p className="mt-2 text-3xl font-extrabold tabular-nums text-ink">{value}</p>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function ChartCard({ title, children, className }) {
  return (
    <div className={cx('card p-5', className)}>
      <p className="mb-4 text-sm font-bold text-ink">{title}</p>
      {children}
    </div>
  );
}

function DuplicateReview({ onChanged }) {
  const [groups, setGroups] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => api.get('/admin/duplicates', { params: { status: 'suggested' } }).then((r) => setGroups(r.data.groups)).catch((e) => setError(errorMessage(e))), []);
  useEffect(() => { load(); }, [load]);

  const decide = async (reportId, decision) => {
    setBusy(`${reportId}-${decision}`);
    try {
      await api.post(`/admin/duplicates/${reportId}/review`, { decision });
      await load();
      onChanged?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
        <p className="flex items-center gap-2 text-sm font-bold"><Copy size={16} className="text-fuchsia-600" /> Suggested duplicate groups</p>
        <span className="text-xs text-slate-400">{groups?.length ?? 0} pending</span>
      </div>
      {error && <Alert tone="error" className="m-4">{error}</Alert>}
      {!groups ? <Spinner /> : !groups.length ? (
        <EmptyState icon={Copy} title="No duplicates awaiting review">Duplicate suggestions from Agent 1 appear here for approval.</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100">
          {groups.map((g) => (
            <li key={g.report_id} className="px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Link to={`/reports/${g.report_id}`} className="font-bold text-brand-700 hover:underline">{g.reference}</Link>
                  <span className="text-sm text-slate-500">{categoryLabel(g.category)}</span>
                  <PriorityBadge priority={g.priority} />
                </div>
                <div className="flex gap-2">
                  <button className="btn-green py-1.5 text-xs" disabled={!!busy} onClick={() => decide(g.report_id, 'approved')}><Check size={14} /> Approve group</button>
                  <button className="btn-danger py-1.5 text-xs" disabled={!!busy} onClick={() => decide(g.report_id, 'rejected')}><X size={14} /> Reject</button>
                </div>
              </div>
              <ul className="mt-2 space-y-1">
                {g.links.map((l) => (
                  <li key={l.id} className="text-xs text-slate-600">
                    ↳ <Link to={`/reports/${l.candidate_report_id}`} className="font-semibold text-slate-800 hover:underline">{l.candidate_reference}</Link> · {l.distance_m} m · {l.likelihood} · image {l.image_similarity != null ? `${Math.round(l.image_similarity * 100)}%` : 'n/a'} — <span className="text-slate-500">{l.reason}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DashboardInner() {
  const demo = 'exclude'; // genuine reports only
  const [data, setData] = useState(null);
  const [review, setReview] = useState([]);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [s, r] = await Promise.all([api.get('/admin/stats', { params: { demo } }), api.get('/reports', { params: { review: 'true', demo, limit: 8 } })]);
      setData(s.data);
      setReview(r.data.reports.filter((x) => ['submitted', 'under_review', 'in_progress'].includes(x.status)));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRefreshing(false);
    }
  }, [demo]);
  useEffect(() => { load(); }, [load]);

  if (error && !data) return <div className="container-page py-10"><Alert tone="error">{error}</Alert></div>;
  if (!data) return <Spinner label="Loading dashboard…" />;
  const t = data.totals;
  const byPriority = PRIORITY_ORDER.map((p) => ({ name: p, value: data.byPriority.find((x) => x.name === p)?.value || 0 }));
  const unassigned = data.byPriority.find((x) => x.name === 'unclassified')?.value || 0;
  const timeline = fillTimeline(data.timeline);
  const byCategory = data.byCategory.map((c) => ({ ...c, label: categoryLabel(c.name === 'unclassified' ? null : c.name) }));
  const catScale = yScale(byCategory.map((c) => c.value));
  const priScale = yScale(byPriority.map((p) => p.value));
  const timeScale = yScale(timeline.map((d) => d.reports));

  return (
    <div className="container-page py-8">
      <PageHeader
        eyebrow="Administration"
        title="Operations dashboard"
        description="Monitor reports, review AI decisions and act on duplicates. Priorities and departments are AI recommendations for staff to confirm."
        actions={
          <>
            <Link to="/messages" className="btn-secondary">
              <Mail size={16} /> Messages
              {data.messages?.unread > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-xs text-white">{data.messages.unread} new</span>}
            </Link>
            <button className="btn-secondary" onClick={load} disabled={refreshing}><RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> Refresh</button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
        <Stat icon={FileText} label="Total reports" value={t.total} tone="blue" />
        <Stat icon={Clock} label="Pending" value={t.pending} tone="amber" hint="Submitted / under review" />
        <Stat icon={AlertTriangle} label="High priority" value={t.high} tone="orange" hint="Open" />
        <Stat icon={Siren} label="Critical" value={t.critical} tone="red" hint="Open" />
        <Stat icon={Copy} label="Potential duplicates" value={t.potential_duplicates} tone="fuchsia" hint="Awaiting review" />
        <Stat icon={CheckCircle2} label="Resolved" value={t.resolved} tone="green" />
        <Stat icon={ShieldAlert} label="Needs review" value={t.needs_review} tone="amber" hint="Human review flag" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <ChartCard title="Reports by category" className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={byCategory} margin={{ left: -20, right: 8 }}>
              <CartesianGrid vertical={false} stroke="#eef2f7" />
              <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} interval={0} angle={-15} textAnchor="end" height={50} />
              <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} {...catScale} />
              <Tooltip cursor={barCursor} content={<ChartTooltip colorFor={() => BRAND} />} wrapperStyle={{ outline: 'none' }} offset={16} />
              <Bar dataKey="value" fill={BRAND} radius={[4, 4, 0, 0]} maxBarSize={44} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Reports by priority">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={byPriority} margin={{ left: -20, right: 8 }}>
              <CartesianGrid vertical={false} stroke="#eef2f7" />
              <XAxis dataKey="name" tick={axis} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} {...priScale} />
              <Tooltip cursor={barCursor} content={<ChartTooltip colorFor={(row) => PRIORITY[row.name]?.color} />} wrapperStyle={{ outline: 'none' }} offset={16} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={48}>
                {byPriority.map((p) => <Cell key={p.name} fill={PRIORITY[p.name].color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {unassigned > 0 && <p className="text-xs text-slate-400">{unassigned} report(s) without priority (not shown)</p>}
        </ChartCard>
        <ChartCard title="Reports over the last 30 days" className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={timeline} margin={{ left: -20, right: 8 }}>
              <defs>
                <linearGradient id="fillBrand" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={BRAND} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={BRAND} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="#eef2f7" />
              <XAxis dataKey="day" tick={axis} tickLine={false} axisLine={false} tickFormatter={fmtDay} minTickGap={24} />
              <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} {...timeScale} />
              <Tooltip cursor={{ stroke: '#94a3b8', strokeDasharray: '4 4' }} content={<ChartTooltip colorFor={() => BRAND} formatLabel={fmtDay} />} wrapperStyle={{ outline: 'none' }} offset={16} />
              <Area type="linear" dataKey="reports" stroke={BRAND} strokeWidth={2} fill="url(#fillBrand)" activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Reports by area (top 10)">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.byArea} layout="vertical" margin={{ left: 10, right: 16 }}>
              <XAxis type="number" allowDecimals={false} hide />
              <YAxis type="category" dataKey="name" tick={axis} tickLine={false} axisLine={false} width={110} interval={0} />
              <Tooltip cursor={barCursor} content={<ChartTooltip colorFor={() => '#10b981'} />} wrapperStyle={{ outline: 'none' }} offset={16} />
              <Bar dataKey="value" fill="#10b981" radius={[0, 4, 4, 0]} maxBarSize={16} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
            <p className="flex items-center gap-2 text-sm font-bold"><ShieldAlert size={16} className="text-amber-600" /> Human review queue</p>
            <span className="text-xs text-slate-400">{review.length} open</span>
          </div>
          {!review.length ? <EmptyState icon={ShieldAlert} title="Nothing needs review" /> : (
            <ul className="divide-y divide-slate-100">
              {review.map((r) => (
                <li key={r.id}>
                  <Link to={`/reports/${r.id}`} className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><span className="font-bold">{r.reference}</span><PriorityBadge priority={r.priority} />{r.is_demo && <DemoBadge />}</div>
                      <p className="mt-0.5 truncate text-xs text-amber-700">{r.review_reasons.join(' · ') || 'Flagged'}</p>
                    </div>
                    <ArrowRight size={16} className="mt-1 text-slate-300" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <DuplicateReview onChanged={load} />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <div className="card overflow-hidden xl:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
            <p className="text-sm font-bold">Recent reports</p>
            <Link to="/map" className="text-xs font-semibold text-brand-600 hover:underline">Open map →</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                <tr><th className="px-5 py-2.5">Report</th><th className="px-3 py-2.5">Category</th><th className="px-3 py-2.5">Priority</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Area</th><th className="px-5 py-2.5 text-right">Submitted</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.recent.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3"><Link to={`/reports/${r.id}`} className="font-bold text-brand-700 hover:underline">{r.reference}</Link> {r.is_demo && <DemoBadge />}</td>
                    <td className="px-3 py-3"><CategoryChip category={r.category} /></td>
                    <td className="px-3 py-3"><PriorityBadge priority={r.priority} /></td>
                    <td className="px-3 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-3 py-3 text-slate-500"><span className="inline-flex items-center gap-1"><MapPin size={12} />{r.area || '—'}</span></td>
                    <td className="px-5 py-3 text-right text-slate-500" title={formatDate(r.created_at)}>{timeAgo(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
            <p className="flex items-center gap-2 text-sm font-bold"><Activity size={16} className="text-brand-600" /> Agent activity</p>
            <Link to="/agents" className="text-xs font-semibold text-brand-600 hover:underline">All runs →</Link>
          </div>
          {!data.runs.length ? <EmptyState icon={Activity} title="No agent runs yet">Submit a report to see the agents work.</EmptyState> : (
            <ul className="divide-y divide-slate-100">
              {data.runs.map((run) => (
                <li key={run.id}>
                  <Link to={`/agents/${run.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">Run #{run.id} · {run.reference}</p>
                      <p className="text-xs text-slate-500">{run.tool_calls} tool calls · {run.duration_ms != null ? `${(run.duration_ms / 1000).toFixed(1)}s` : '…'} · {run.ai_mode === 'gemini' ? 'Gemini' : 'Dev mode'}</p>
                    </div>
                    <RunStatus status={run.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  return (
    <AdminGate>
      <DashboardInner />
    </AdminGate>
  );
}
