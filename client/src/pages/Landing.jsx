import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Camera, MapPinned, ScanSearch, Scale, Workflow, ArrowRight, CheckCircle2, Copy, Gauge, Building, Eye, ShieldCheck, Timer, Users, LineChart,
  Construction, Trash2, Lightbulb, Droplets, Waves,
} from 'lucide-react';
import { SectionHeading } from '../components/ui';
import { api } from '../lib/api';
import { categoryLabel, timeAgo } from '../lib/constants';

const STEPS = [
  { icon: Camera, title: 'Snap & submit', text: 'Citizens photograph a pothole, garbage pile, broken light or leak and pin the location.' },
  { icon: ScanSearch, title: 'Agent 1 analyses', text: 'Gemini vision identifies the issue, rates severity and searches the database for nearby duplicates.' },
  { icon: Scale, title: 'Agent 2 prioritises', text: 'Weighs safety risk and community impact, assigns priority and recommends a department and action.' },
  { icon: MapPinned, title: 'City acts faster', text: 'Every report lands on a live map and dashboard so officials triage with evidence, not guesswork.' },
];

const FEATURES = [
  { icon: Eye, title: 'Vision-based detection', text: 'Recognises potholes, garbage, streetlights, leaks, open drains and damaged infrastructure from a single photo.' },
  { icon: Copy, title: 'Geospatial duplicate detection', text: 'Real database queries, haversine distances and perceptual image hashes flag repeat complaints.' },
  { icon: Gauge, title: 'Explainable prioritisation', text: 'Every Low / Medium / High / Critical decision comes with the evidence and reasoning behind it.' },
  { icon: Building, title: 'Department routing', text: 'Recommends Roads, Sanitation, Electricity, Water Supply or Drainage — ready for staff to act on.' },
  { icon: ShieldCheck, title: 'Human-in-the-loop', text: 'Uncertain, critical or contradictory cases are flagged for an administrator to confirm.' },
  { icon: Workflow, title: 'Transparent agent logs', text: 'Watch both agents work: tool calls, handoffs, validation and the final decision, timestamped.' },
];

const BENEFITS = [
  { icon: Timer, title: 'Faster triage', text: 'Reports arrive pre-classified and prioritised, cutting manual sorting time.' },
  { icon: Users, title: 'Less duplicate work', text: 'Repeat complaints are grouped instead of dispatching crews twice.' },
  { icon: LineChart, title: 'Data-driven planning', text: 'Category, area and priority trends reveal where maintenance budgets matter most.' },
];

const ISSUES = [
  [Construction, 'Potholes', '#f97316'],
  [Trash2, 'Garbage', '#84cc16'],
  [Lightbulb, 'Streetlights', '#eab308'],
  [Droplets, 'Water leaks', '#0ea5e9'],
  [Waves, 'Open drains', '#6366f1'],
];

function LiveStats() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    api.get('/stats/public').then((r) => setData(r.data)).catch(() => setError(true));
  }, []);

  const t = data?.totals;
  const d = data?.latestDecision;
  const tiles = t && [
    ['Reports submitted', t.total],
    ['Open issues', t.open],
    ['Resolved', t.resolved],
    ['Areas covered', t.areas],
  ];

  return (
    <div className="relative mx-auto w-full max-w-md animate-fade-up [animation-delay:150ms]">
      <div className="absolute -inset-6 rounded-[2rem] bg-gradient-to-br from-brand-200/60 via-white to-civic-100/70 blur-2xl" />
      <div className="relative card p-5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Live from CivicLens</p>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-civic-50 px-2 py-0.5 text-[10px] font-semibold text-civic-700">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-civic-500" /> Real data
          </span>
        </div>
        {error && <p className="mt-4 text-sm text-slate-500">Live figures are unavailable right now.</p>}
        {!data && !error && <div className="mt-4 h-40 animate-pulse rounded-xl bg-slate-100" />}
        {t && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {tiles.map(([label, value]) => (
                <div key={label} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                  <p className="text-2xl font-extrabold tabular-nums text-ink">{value}</p>
                  <p className="text-xs font-medium text-slate-500">{label}</p>
                </div>
              ))}
            </div>
            {t.total > 0 && (
              <p className="mt-3 text-xs text-slate-500">
                {t.last_7_days} in the last 7 days · {t.critical_open} critical open · {t.duplicates_detected} duplicate link(s) found
                {data.agentRuns.avg_seconds != null && <> · agents average {data.agentRuns.avg_seconds}s per report</>}
              </p>
            )}
            {d ? (
              <Link to={`/reports/${d.report_id}`} className="mt-4 flex items-start gap-3 rounded-xl border border-slate-100 bg-white p-3 shadow-sm transition hover:border-brand-200">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"><Scale size={18} /></div>
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Latest AI decision · {d.reference}</p>
                  <p className="text-sm font-bold text-ink">
                    {categoryLabel(d.category)}{d.priority ? ` · ${d.priority}` : ''}{d.department ? ` → ${d.department}` : ''}
                  </p>
                  <p className="truncate text-[11px] text-slate-500">
                    {d.area || 'Location recorded'} · {d.ai_mode === 'gemini' ? `Gemini · ${d.model}` : 'Development mode'} · {timeAgo(d.completed_at)}
                  </p>
                </div>
              </Link>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500">
                No reports yet. <Link to="/report" className="font-semibold text-brand-600 hover:underline">Be the first to report an issue.</Link>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function Landing() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(37,99,235,0.12),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(16,185,129,0.12),transparent_55%)]" />
        <div className="container-page relative grid items-center gap-12 py-16 lg:grid-cols-2 lg:py-24">
          <div className="animate-fade-up">
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-100 bg-white px-3 py-1 text-xs font-semibold text-brand-700 shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-civic-500" /> Agentic AI for Tier 2 & Tier 3 cities
            </span>
            <h1 className="mt-5 text-4xl font-extrabold leading-[1.08] text-ink sm:text-5xl lg:text-6xl">
              Smarter Cities.{' '}
              <span className="bg-gradient-to-r from-brand-600 to-civic-600 bg-clip-text text-transparent">Faster Action.</span>{' '}
              Better Communities.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-slate-600">
              CivicLens turns a citizen's photo into an actionable, prioritised civic work item. Two AI agents analyse the issue, detect duplicate complaints and recommend who should act — with every decision explained.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/report" className="btn-primary px-6 py-3 text-base"><Camera size={18} /> Report an Issue</Link>
              <Link to="/map" className="btn-secondary px-6 py-3 text-base">Explore the map <ArrowRight size={18} /></Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-2">
              {ISSUES.map(([Icon, label, color]) => (
                <span key={label} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200">
                  <Icon size={14} style={{ color }} /> {label}
                </span>
              ))}
            </div>
          </div>
          <LiveStats />
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="container-page py-16">
        <SectionHeading eyebrow="How it works" title="From photo to prioritised action in seconds" center>
          A transparent two-agent workflow coordinated by an orchestrator — no black boxes.
        </SectionHeading>
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <div key={s.title} className="card relative p-6 transition hover:-translate-y-1 hover:shadow-lift">
              <span className="absolute right-5 top-5 text-4xl font-extrabold text-slate-100">{String(i + 1).padStart(2, '0')}</span>
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-brand-600 to-civic-500 text-white"><s.icon size={20} /></div>
              <h3 className="mt-4 text-lg font-bold">{s.title}</h3>
              <p className="mt-1.5 text-sm text-slate-600">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Two agents */}
      <section className="bg-white py-16">
        <div className="container-page">
          <SectionHeading eyebrow="Agentic architecture" title="Two specialised agents, one accountable workflow">
            Each agent reasons with Google Gemini and acts through real backend tools. The orchestrator validates every output before it is stored.
          </SectionHeading>
          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            <div className="rounded-2xl border border-brand-100 bg-gradient-to-b from-brand-50 to-white p-6">
              <ScanSearch className="text-brand-600" />
              <p className="mt-3 text-xs font-bold uppercase tracking-wider text-brand-700">Agent 1</p>
              <h3 className="text-xl font-bold">Civic Issue Intelligence</h3>
              <ul className="mt-4 space-y-2 text-sm text-slate-600">
                {['Gemini vision classification & description', 'Severity + calibrated confidence', 'Flags unclear or irrelevant photos', 'Tool: search_nearby_reports (SQL + haversine)', 'Tool: compare_candidates (image hash, text)'].map((t) => (
                  <li key={t} className="flex gap-2"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-brand-600" />{t}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-6">
              <Workflow className="text-slate-700" />
              <p className="mt-3 text-xs font-bold uppercase tracking-wider text-slate-500">Orchestrator</p>
              <h3 className="text-xl font-bold">Coordination & guardrails</h3>
              <ul className="mt-4 space-y-2 text-sm text-slate-600">
                {['Structured handoffs between agents', 'Schema validation of every output', 'Discards duplicate claims not backed by DB', 'Retries, fallbacks and failure handling', 'Human-review flags & execution logs'].map((t) => (
                  <li key={t} className="flex gap-2"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-slate-600" />{t}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-civic-100 bg-gradient-to-b from-civic-50 to-white p-6">
              <Scale className="text-civic-600" />
              <p className="mt-3 text-xs font-bold uppercase tracking-wider text-civic-700">Agent 2</p>
              <h3 className="text-xl font-bold">Civic Action & Prioritisation</h3>
              <ul className="mt-4 space-y-2 text-sm text-slate-600">
                {['Safety-risk assessment', 'Weighs nearby duplicate complaints', 'Low / Medium / High / Critical priority', 'Department + next-action recommendation', 'Tools: priority policy, departments, area backlog'].map((t) => (
                  <li key={t} className="flex gap-2"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-civic-600" />{t}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-6 text-center">
            <Link to="/report" className="btn-secondary">Report an issue and watch them work <ArrowRight size={16} /></Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="container-page py-16">
        <SectionHeading eyebrow="Features" title="Everything a municipal team needs to triage" center />
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="card p-6">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600"><f.icon size={20} /></div>
              <h3 className="mt-4 font-bold">{f.title}</h3>
              <p className="mt-1.5 text-sm text-slate-600">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Benefits + CTA */}
      <section className="container-page">
        <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 via-brand-600 to-civic-600 p-8 text-white sm:p-12">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-100">Benefits</p>
              <h2 className="mt-2 text-3xl font-extrabold sm:text-4xl">Built for growing cities with lean teams</h2>
              <p className="mt-3 text-brand-50/90">Tier 2 and Tier 3 cities face rising complaint volumes with limited staff. CivicLens helps them focus on what matters most, first.</p>
              <Link to="/report" className="btn mt-6 bg-white px-6 py-3 text-base text-brand-700 hover:bg-brand-50"><Camera size={18} /> Report an issue now</Link>
            </div>
            <div className="space-y-4">
              {BENEFITS.map((b) => (
                <div key={b.title} className="flex gap-4 rounded-2xl bg-white/10 p-4 backdrop-blur">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/15"><b.icon size={20} /></div>
                  <div>
                    <p className="font-bold">{b.title}</p>
                    <p className="text-sm text-brand-50/85">{b.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
