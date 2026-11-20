import { useState } from 'react';
import { ScanSearch, Scale, Workflow, CheckCircle2, Circle, Loader2, XCircle, AlertTriangle, ChevronDown, Wrench, ArrowRight, Info } from 'lucide-react';
import { cx } from './ui';

const LANES = {
  intelligence: {
    title: 'Agent 1',
    name: 'Civic Issue Intelligence',
    icon: ScanSearch,
    tone: { ring: 'ring-brand-200', bg: 'bg-brand-50', text: 'text-brand-700', dot: 'bg-brand-600', bar: 'from-brand-500 to-brand-600' },
    milestones: [
      ['image_received', 'Image received'],
      ['analysis_started', 'Analysis started'],
      ['issue_identified', 'Issue identified'],
      ['tool_result:search_nearby_reports', 'Nearby reports retrieved'],
      ['duplicates_completed', 'Duplicate detection completed'],
    ],
  },
  orchestrator: {
    title: 'Orchestrator',
    name: 'Workflow coordination',
    icon: Workflow,
    tone: { ring: 'ring-slate-200', bg: 'bg-slate-50', text: 'text-slate-700', dot: 'bg-slate-700', bar: 'from-slate-500 to-slate-700' },
    milestones: [
      ['workflow_started', 'Workflow started'],
      ['handoff', 'Agent handoffs'],
      ['validation', 'Outputs validated'],
      ['final_decision', 'Final decision'],
    ],
  },
  action: {
    title: 'Agent 2',
    name: 'Civic Action & Prioritisation',
    icon: Scale,
    tone: { ring: 'ring-civic-100', bg: 'bg-civic-50', text: 'text-civic-700', dot: 'bg-civic-600', bar: 'from-civic-500 to-civic-600' },
    milestones: [
      ['risk_assessment_started', 'Risk assessment started'],
      ['evidence_considered', 'Evidence considered'],
      ['priority_assigned', 'Priority assigned'],
      ['department_recommended', 'Department recommended'],
      ['action_suggested', 'Next action suggested'],
    ],
  },
};

const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function Milestones({ laneKey, steps, runStatus }) {
  const lane = LANES[laneKey];
  const Icon = lane.icon;
  const mine = steps.filter((s) => s.agent === laneKey || (laneKey === 'orchestrator' && s.agent === 'orchestrator'));
  const errored = mine.some((s) => s.status === 'error');
  const running = runStatus === 'running';
  const items = lane.milestones.map(([key, label]) => {
    const hits = steps.filter((s) => s.step === key && (s.agent === laneKey || key === 'handoff' || key === 'validation'));
    return { key, label, step: hits[hits.length - 1], count: hits.length };
  });
  const done = items.filter((i) => i.step).length;
  const nextIdx = items.findIndex((i) => !i.step);

  return (
    <div className={cx('card relative overflow-hidden p-5 ring-1', lane.tone.ring)}>
      <div className={cx('absolute inset-x-0 top-0 h-1 bg-gradient-to-r', lane.tone.bar)} style={{ width: `${(done / items.length) * 100}%`, transition: 'width .4s' }} />
      <div className="flex items-center gap-3">
        <div className={cx('grid h-11 w-11 place-items-center rounded-xl', lane.tone.bg, lane.tone.text, running && nextIdx !== -1 && done > 0 && 'animate-pulse-ring')}>
          <Icon size={22} />
        </div>
        <div className="min-w-0">
          <p className={cx('text-xs font-bold uppercase tracking-wider', lane.tone.text)}>{lane.title}</p>
          <p className="truncate text-sm font-bold text-ink">{lane.name}</p>
        </div>
        <span className="ml-auto text-xs font-semibold text-slate-400">{done}/{items.length}</span>
      </div>
      <ol className="mt-4 space-y-2.5">
        {items.map((i, idx) => {
          const active = running && idx === nextIdx && !errored;
          return (
            <li key={i.key} className="flex items-start gap-2.5 text-sm">
              {i.step ? (
                i.step.status === 'error' ? <XCircle size={17} className="mt-0.5 shrink-0 text-red-500" /> : i.step.status === 'warning' ? <AlertTriangle size={17} className="mt-0.5 shrink-0 text-amber-500" /> : <CheckCircle2 size={17} className={cx('mt-0.5 shrink-0', lane.tone.text)} />
              ) : active ? (
                <Loader2 size={17} className="mt-0.5 shrink-0 animate-spin text-slate-400" />
              ) : (
                <Circle size={17} className="mt-0.5 shrink-0 text-slate-300" />
              )}
              <div className="min-w-0 flex-1">
                <p className={cx('font-semibold', i.step ? 'text-slate-800' : 'text-slate-400')}>
                  {i.label}
                  {i.count > 1 && <span className="ml-1 text-xs font-medium text-slate-400">×{i.count}</span>}
                </p>
                {i.step && <p className="line-clamp-2 text-xs text-slate-500">{i.step.message}</p>}
              </div>
              {i.step && <time className="shrink-0 font-mono text-[11px] text-slate-400">{fmtTime(i.step.created_at)}</time>}
            </li>
          );
        })}
        {laneKey === 'orchestrator' && (
          <li className="flex items-center gap-2.5 border-t border-slate-100 pt-2.5 text-sm">
            <Info size={17} className="text-slate-400" />
            <span className="font-semibold text-slate-700">Execution status:</span>
            <RunStatus status={runStatus} />
          </li>
        )}
      </ol>
    </div>
  );
}

export function RunStatus({ status }) {
  const map = {
    running: 'bg-blue-50 text-blue-700 ring-blue-600/20',
    completed: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    partial: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    failed: 'bg-red-50 text-red-700 ring-red-600/20',
  };
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset', map[status] || map.running)}>
      {status === 'running' && <Loader2 size={11} className="animate-spin" />}
      {status}
    </span>
  );
}

function LogRow({ step, startedAt }) {
  const [open, setOpen] = useState(false);
  const agentStyle = {
    intelligence: 'bg-brand-50 text-brand-700',
    action: 'bg-civic-50 text-civic-700',
    orchestrator: 'bg-slate-100 text-slate-700',
  }[step.agent];
  const statusDot = { success: 'bg-emerald-500', info: 'bg-slate-300', warning: 'bg-amber-500', error: 'bg-red-500' }[step.status];
  const isTool = step.step.startsWith('tool_');
  const offset = ((new Date(step.created_at) - new Date(startedAt)) / 1000).toFixed(2);
  return (
    <li className="border-b border-slate-100 last:border-0">
      <button type="button" className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-slate-50" onClick={() => setOpen((o) => !o)} disabled={!step.data}>
        <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', statusDot)} />
        <span className="w-14 shrink-0 font-mono text-[11px] leading-5 text-slate-400">+{offset}s</span>
        <span className={cx('hidden w-28 shrink-0 rounded-md px-1.5 py-0.5 text-center text-[11px] font-bold sm:inline-block', agentStyle)}>
          {step.agent === 'intelligence' ? 'Agent 1' : step.agent === 'action' ? 'Agent 2' : 'Orchestrator'}
        </span>
        <span className="min-w-0 flex-1 text-sm text-slate-700">
          {isTool && <Wrench size={12} className="mr-1 inline text-slate-400" />}
          {step.message}
          {step.duration_ms != null && <span className="ml-2 text-xs text-slate-400">{step.duration_ms} ms</span>}
        </span>
        {step.data && <ChevronDown size={16} className={cx('mt-0.5 shrink-0 text-slate-400 transition', open && 'rotate-180')} />}
      </button>
      {open && step.data && (
        <pre className="mx-4 mb-3 max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">{JSON.stringify(step.data, null, 2)}</pre>
      )}
    </li>
  );
}

/** Visualises one genuine orchestration run: three lanes + full execution log. */
export default function AgentWorkflow({ run, showLog = true }) {
  if (!run) return null;
  const steps = run.steps || [];
  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:items-stretch">
        <Milestones laneKey="intelligence" steps={steps} runStatus={run.status} />
        <div className="hidden items-center text-slate-300 lg:flex"><ArrowRight size={22} /></div>
        <Milestones laneKey="orchestrator" steps={steps} runStatus={run.status} />
        <div className="hidden items-center text-slate-300 lg:flex"><ArrowRight size={22} /></div>
        <Milestones laneKey="action" steps={steps} runStatus={run.status} />
      </div>
      {showLog && (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-bold text-ink">Execution log <span className="font-medium text-slate-400">· {steps.length} events</span></p>
            <p className="text-xs text-slate-500">
              {run.ai_mode === 'gemini' ? `Google Gemini · ${run.model}` : 'Development mode · sample responses (not Gemini)'}
              {run.duration_ms != null && ` · ${(run.duration_ms / 1000).toFixed(1)}s total`}
            </p>
          </div>
          <ol className="max-h-[520px] overflow-auto">
            {steps.map((s) => (
              <LogRow key={s.id} step={s} startedAt={run.started_at} />
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
