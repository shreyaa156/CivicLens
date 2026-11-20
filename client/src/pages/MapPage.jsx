import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BaseTiles from '../components/BaseTiles';
import { Link } from 'react-router-dom';
import { MapContainer, Polyline, Tooltip, useMap } from 'react-leaflet';
import { Search, SlidersHorizontal, X, MapPin, ExternalLink, Copy, Layers } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { CATEGORY, PRIORITY, PRIORITY_ORDER, STATUS, DEFAULT_CENTER, DEFAULT_ZOOM, categoryLabel, timeAgo, UNASSIGNED_COLOR } from '../lib/constants';
import L from '../lib/leaflet';
import ClusterLayer from '../components/ClusterLayer';
import { Alert, CategoryChip, DemoBadge, PriorityBadge, StatusBadge, Spinner, cx } from '../components/ui';

/** Frame the map around the real reports once they load (no hardcoded city). */
function FitToReports({ reports }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !reports.length) return;
    fitted.current = true;
    if (reports.length === 1) map.setView([reports[0].latitude, reports[0].longitude], 15);
    else map.fitBounds(L.latLngBounds(reports.map((r) => [r.latitude, r.longitude])), { padding: [40, 40], maxZoom: 15 });
  }, [reports, map]);
  return null;
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-500">{label}</span>
      <select className="input py-2" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
}

export default function MapPage() {
  const [reports, setReports] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ category: '', priority: '', status: '', q: '' });
  const [showDupes, setShowDupes] = useState(true);
  const [selected, setSelected] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.get('/reports', { params: { demo: 'exclude', limit: 1000 } }), api.get('/duplicates')])
      .then(([r, d]) => {
        setReports(r.data.reports);
        setGroups(d.data.groups);
        setError(null);
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return reports.filter(
      (r) =>
        (!filters.category || r.category === filters.category) &&
        (!filters.priority || r.priority === filters.priority) &&
        (!filters.status || r.status === filters.status) &&
        (!q || [r.reference, r.citizen_description, r.ai_description, r.area, categoryLabel(r.category)].some((v) => v?.toLowerCase().includes(q))),
    );
  }, [reports, filters]);

  const visibleIds = useMemo(() => new Set(filtered.map((r) => r.id)), [filtered]);
  const dupLines = useMemo(
    () =>
      groups.flatMap((g) =>
        g.links
          .filter((l) => l.status !== 'rejected' && (visibleIds.has(l.report_id) || visibleIds.has(l.candidate_report_id)))
          .map((l) => ({ id: l.id, from: [l.source_lat, l.source_lon], to: [l.candidate_lat, l.candidate_lon], status: l.status, label: `${l.source_reference} ↔ ${l.candidate_reference} · ${l.distance_m} m · ${l.likelihood}` })),
      ),
    [groups, visibleIds],
  );

  const onSelect = useCallback((r) => setSelected(r), []);
  const set = (k) => (v) => setFilters((f) => ({ ...f, [k]: v }));
  const activeCount = ['category', 'priority', 'status', 'q'].filter((k) => filters[k]).length;

  const FiltersPanel = (
    <div className="space-y-3">
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="input pl-9" placeholder="Search reference, area, description…" value={filters.q} onChange={(e) => set('q')(e.target.value)} aria-label="Search reports" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
        <Select label="Category" value={filters.category} onChange={set('category')} options={Object.entries(CATEGORY).map(([k, v]) => [k, v.label])} />
        <Select label="Priority" value={filters.priority} onChange={set('priority')} options={PRIORITY_ORDER.map((p) => [p, p])} />
        <Select label="Status" value={filters.status} onChange={set('status')} options={Object.entries(STATUS).map(([k, v]) => [k, v.label])} />
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
        <input type="checkbox" checked={showDupes} onChange={(e) => setShowDupes(e.target.checked)} className="h-4 w-4 rounded accent-brand-600" />
        Show duplicate groups ({dupLines.length})
      </label>
      {activeCount > 0 && (
        <button className="btn-ghost w-full py-1.5 text-xs" onClick={() => setFilters((f) => ({ ...f, category: '', priority: '', status: '', q: '' }))}>
          <X size={14} /> Clear filters
        </button>
      )}
    </div>
  );

  return (
    <div className="container-page py-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Interactive issue map</p>
          <h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">City issue map</h1>
          <p className="mt-1 text-sm text-slate-600">{loading ? 'Loading…' : `${filtered.length} of ${reports.length} reports shown`} · OpenStreetMap</p>
        </div>
        <button className="btn-secondary lg:hidden" onClick={() => setPanelOpen((o) => !o)}>
          <SlidersHorizontal size={16} /> Filters {activeCount > 0 && `(${activeCount})`}
        </button>
      </div>
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <aside className={cx('card h-fit p-4', panelOpen ? 'block' : 'hidden lg:block')}>
          {FiltersPanel}
          <div className="mt-5 border-t border-slate-100 pt-4">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400"><Layers size={13} /> Legend</p>
            <ul className="space-y-1.5 text-sm">
              {PRIORITY_ORDER.map((p) => (
                <li key={p} className="flex items-center gap-2"><span className="h-3 w-3 rounded-full border-2 border-white shadow" style={{ background: PRIORITY[p].color }} />{p}</li>
              ))}
              <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full border-2 border-white shadow" style={{ background: UNASSIGNED_COLOR }} />Unassigned</li>
              <li className="flex items-center gap-2"><span className="h-0.5 w-5 border-t-2 border-dashed border-fuchsia-500" />Duplicate link</li>
            </ul>
          </div>
        </aside>

        <div className="relative">
          <div className="card relative h-[70vh] min-h-[480px] overflow-hidden">
            {loading && <div className="absolute inset-0 z-[500] grid place-items-center bg-white/60"><Spinner label="Loading reports…" /></div>}
            {!loading && !error && reports.length === 0 && (
              <div className="pointer-events-none absolute inset-0 z-[500] grid place-items-center">
                <div className="pointer-events-auto card max-w-xs p-5 text-center">
                  <p className="font-bold text-ink">No reports yet</p>
                  <p className="mt-1 text-sm text-slate-500">Issues appear here as citizens report them.</p>
                  <Link to="/report" className="btn-primary mt-3 py-2">Report an issue</Link>
                </div>
              </div>
            )}
            <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} className="h-full w-full" scrollWheelZoom>
              <FitToReports reports={reports} />
              <BaseTiles />
              <ClusterLayer reports={filtered} onSelect={onSelect} selectedId={selected?.id} />
              {showDupes &&
                dupLines.map((l) => (
                  <Polyline key={l.id} positions={[l.from, l.to]} pathOptions={{ color: l.status === 'approved' ? '#7c3aed' : '#d946ef', weight: 3, dashArray: '6 6' }}>
                    <Tooltip sticky>{l.label}</Tooltip>
                  </Polyline>
                ))}
            </MapContainer>
          </div>

          {selected && (
            <div className="card absolute bottom-4 left-4 right-4 z-[1000] max-w-md animate-fade-up overflow-hidden sm:right-auto sm:w-96">
              <div className="flex gap-3 p-4">
                {selected.image_url ? (
                  <img src={selected.image_url} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover" />
                ) : (
                  <div className="grid h-20 w-20 shrink-0 place-items-center rounded-xl bg-slate-100 text-[10px] font-semibold text-slate-400">No photo</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-bold">{selected.reference}</p>
                    <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-700" aria-label="Close"><X size={16} /></button>
                  </div>
                  <CategoryChip category={selected.category} />
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <PriorityBadge priority={selected.priority} />
                    <StatusBadge status={selected.status} />
                    {selected.is_demo && <DemoBadge />}
                  </div>
                </div>
              </div>
              <div className="border-t border-slate-100 px-4 py-3 text-sm">
                <p className="line-clamp-2 text-slate-600">{selected.ai_description || selected.citizen_description}</p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span className="flex items-center gap-1"><MapPin size={12} />{selected.area || `${selected.latitude.toFixed(4)}, ${selected.longitude.toFixed(4)}`} · {timeAgo(selected.created_at)}</span>
                  {selected.duplicate_count > 0 && <span className="flex items-center gap-1 font-semibold text-fuchsia-600"><Copy size={12} />{selected.duplicate_count} duplicate link(s)</span>}
                </div>
                <Link to={`/reports/${selected.id}`} className="btn-primary mt-3 w-full py-2"><ExternalLink size={15} /> View details</Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
