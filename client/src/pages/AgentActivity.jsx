import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Activity, ScanSearch, Scale, Workflow, ExternalLink, FlaskConical, Sparkles, FileJson } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { categoryLabel, timeAgo, formatDate } from '../lib/constants';
import AgentWorkflow, { RunStatus } from '../components/AgentWorkflow';
import AdminGate from '../components/AdminGate';
import { Alert, DemoBadge, EmptyState, PageHeader, PriorityBadge, Spinner, cx } from '../components/ui';

function ResultBlock({ result }) {
  const isA1 = result.agent === 'intelligence';
  return (
    <details className="card overflow-hidden" open={false}>
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-bold">
        <FileJson size={16} className={isA1 ? 'text-brand-600' : 'text-civic-600'} />
        {isA1 ? 'Agent 1 structured output' : 'Agent 2 structured output'}
        <span className={cx('ml-auto rounded-full px-2 py-0.5 text-xs', result.valid ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>{result.valid ? 'validated' : 'validated with corrections'}</span>
      </summary>
      {result.validation_errors && <p className="px-4 pb-2 text-xs text-amber-700">{result.validation_errors.join('; ')}</p>}
      <pre className="max-h-80 overflow-auto bg-slate-900 p-4 text-[11px] leading-relaxed text-slate-100">{JSON.stringify(result.output, null, 2)}</pre>
    </details>
  );
}

function AgentActivityInner() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const [runs, setRuns] = useState(null);
  const [ai, setAi] = useState(null);
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = () =>
      api.get('/admin/agent-runs', { params: { limit: 50 } }).then((r) => { setRuns(r.data.runs); setAi(r.data.ai); }).catch((e) => setError(errorMessage(e)));
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!runId && runs?.length) navigate(`/agents/${runs[0].id}`, { replace: true });
  }, [runId, runs, navigate]);

  useEffect(() => {
    if (!runId) return;
    let timer;
    const load = () =>
      api.get(`/agents/runs/${runId}`).then((r) => {
        setRun(r.data.run);
        if (r.data.run.status === 'running') timer = setTimeout(load, 1000);
      }).catch((e) => setError(errorMessage(e)));
    load();
    return () => clearTimeout(timer);
  }, [runId]);

  return (
    <div className="container-page py-8">
      <PageHeader
        eyebrow="Transparency"
        title="Agent activity"
        description="Genuine execution logs from every orchestration run: each model turn, tool call, handoff, validation step and final decision — with timestamps."
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        {[
          [ScanSearch, 'Agent 1 · Civic Issue Intelligence', 'Vision analysis, severity, confidence, nearby-report search & duplicate detection.', 'bg-brand-50 text-brand-600'],
          [Workflow, 'Orchestrator', 'Runs the workflow, hands off evidence, validates outputs, applies guardrails and stores results.', 'bg-slate-100 text-slate-700'],
          [Scale, 'Agent 2 · Civic Action & Prioritisation', 'Risk assessment, priority, department routing, next action and human-review flags.', 'bg-civic-50 text-civic-600'],
        ].map(([Icon, title, text, tone]) => (
          <div key={title} className="card flex gap-3 p-4">
            <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tone}`}><Icon size={18} /></div>
            <div><p className="text-sm font-bold">{title}</p><p className="text-xs text-slate-500">{text}</p></div>
          </div>
        ))}
      </div>

      {ai && (
        <Alert tone={ai.mode === 'gemini' ? 'success' : 'warning'} icon={ai.mode === 'gemini' ? Sparkles : FlaskConical} className="mb-6">
          Current AI provider: <strong>{ai.provider}</strong>{ai.mode === 'gemini' && ` · model ${ai.model}`}. Each run below records which mode produced it.
        </Alert>
      )}
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}

      {!runs ? <Spinner /> : !runs.length ? (
        <div className="card"><EmptyState icon={Activity} title="No agent runs yet"><Link to="/report" className="font-semibold text-brand-600">Submit a report</Link> to watch the agents work.</EmptyState></div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <aside className="card h-fit max-h-[80vh] overflow-auto">
            <p className="sticky top-0 border-b border-slate-100 bg-white px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-400">Recent runs</p>
            <ul className="divide-y divide-slate-100">
              {runs.map((r) => (
                <li key={r.id}>
                  <Link to={`/agents/${r.id}`} className={cx('block px-4 py-3 hover:bg-slate-50', String(r.id) === runId && 'bg-brand-50/60')}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold">Run #{r.id}</p>
                      <RunStatus status={r.status} />
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">{r.reference} · {categoryLabel(r.category)}</p>
                    <p className="text-xs text-slate-400">{r.tool_calls} tool calls · {r.ai_mode === 'gemini' ? 'Gemini' : 'Dev mode'} · {timeAgo(r.started_at)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </aside>

          <section className="min-w-0 space-y-5">
            {!run ? <Spinner /> : (
              <>
                <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
                  <p className="text-lg font-extrabold">Run #{run.id}</p>
                  <RunStatus status={run.status} />
                  <Link to={`/reports/${run.report_id}`} className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline">{run.reference} <ExternalLink size={13} /></Link>
                  {run.is_demo ? <DemoBadge /> : null}
                  <PriorityBadge priority={run.final_decision?.priority || run.priority} />
                  <span className="text-slate-500">Started {formatDate(run.started_at)}</span>
                  {run.duration_ms != null && <span className="text-slate-500">{(run.duration_ms / 1000).toFixed(2)}s</span>}
                  {run.error && <span className="w-full text-red-600">Error: {run.error}</span>}
                </div>
                <AgentWorkflow run={run} />
                {run.results?.length > 0 && <div className="grid gap-4">{run.results.map((r) => <ResultBlock key={r.id} result={r} />)}</div>}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export default function AgentActivity() {
  return (
    <AdminGate>
      <AgentActivityInner />
    </AdminGate>
  );
}
