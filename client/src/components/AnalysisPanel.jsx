import { Link } from 'react-router-dom';
import { ShieldAlert, Building, ArrowRightCircle, Copy, MessageSquareQuote, AlertTriangle, ImageOff, FlaskConical, Sparkles, MapPin } from 'lucide-react';
import { Alert, CategoryChip, ConfidenceBar, PriorityBadge, DemoBadge, Badge, cx } from './ui';

const SEVERITY_STYLE = {
  low: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  moderate: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  high: 'bg-orange-50 text-orange-700 ring-orange-600/20',
  critical: 'bg-red-50 text-red-700 ring-red-600/20',
};

function Field({ label, children, className }) {
  return (
    <div className={className}>
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

export function SourceNote({ report }) {
  if (report.is_demo) {
    return (
      <Alert tone="warning" icon={FlaskConical} title="DEMO record">
        Sample data for demonstration. Not a genuine complaint and not produced by the CivicLens agents.
      </Alert>
    );
  }
  if (report.ai_mode === 'development') {
    return (
      <Alert tone="warning" icon={FlaskConical} title="Development-mode analysis">
        These results are deterministic sample responses generated without Google Gemini (no API key configured). The photo was not analysed by an AI model.
      </Alert>
    );
  }
  if (report.ai_mode === 'gemini') {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full bg-civic-50 px-3 py-1 text-xs font-semibold text-civic-700">
        <Sparkles size={13} /> Analysed by Google Gemini agents
      </div>
    );
  }
  return null;
}

export default function AnalysisPanel({ report }) {
  if (!report) return null;
  const failed = report.analysis_status === 'failed';
  const duplicates = (report.duplicates || []).filter((d) => d.status !== 'rejected');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <SourceNote report={report} />
        {report.is_demo && <DemoBadge />}
      </div>

      {failed && (
        <Alert tone="error" icon={AlertTriangle} title="Automated analysis unavailable">
          The AI analysis could not be completed. Your report has been saved and is queued for manual review by an administrator.
        </Alert>
      )}
      {report.analysis_status === 'partial' && (
        <Alert tone="warning" icon={AlertTriangle} title="Partial analysis">
          Issue analysis completed, but the prioritisation agent was unavailable. An administrator will assign priority.
        </Alert>
      )}

      {report.needs_human_review && (
        <Alert tone="warning" icon={ShieldAlert} title="Flagged for human review">
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {report.review_reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </Alert>
      )}

      {!failed && (
        <>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Detected issue"><CategoryChip category={report.category} size="lg" /></Field>
            <Field label="Severity">
              {report.severity ? <Badge className={cx('capitalize', SEVERITY_STYLE[report.severity])}>{report.severity}</Badge> : '—'}
            </Field>
            <Field label="Priority"><PriorityBadge priority={report.priority} /></Field>
            <Field label="Confidence"><ConfidenceBar value={report.confidence} /></Field>
          </div>

          {report.image_assessment && report.image_assessment !== 'clear' && (
            <Alert tone="warning" icon={ImageOff}>
              Image assessed as <strong>{report.image_assessment}</strong>. A clearer photo taken in daylight from 2–5 metres helps the AI.
            </Alert>
          )}

          <Field label="AI-generated description">
            <p className="text-sm leading-relaxed text-slate-700">{report.ai_description || '—'}</p>
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400"><Building size={14} /> Recommended department</p>
              <p className="mt-1.5 font-bold text-ink">{report.department || '—'}</p>
              <p className="mt-1 text-xs text-slate-500">Recommendation only — no department has been notified automatically.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400"><ArrowRightCircle size={14} /> Recommended action</p>
              <p className="mt-1.5 text-sm text-slate-700">{report.recommended_action || '—'}</p>
            </div>
          </div>

          <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-4">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-700"><MessageSquareQuote size={14} /> Why this priority?</p>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-700">{report.priority_explanation || '—'}</p>
          </div>

          <div>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400"><Copy size={14} /> Potential duplicates</p>
            <p className="mt-1.5 text-sm text-slate-600">{report.duplicate_summary || 'No duplicate check recorded.'}</p>
            {duplicates.length > 0 && (
              <ul className="mt-3 space-y-2">
                {duplicates.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-200 bg-white p-3 text-sm">
                    <Link to={`/reports/${d.candidate_report_id}`} className="font-bold text-brand-700 hover:underline">{d.candidate_reference}</Link>
                    {d.candidate_is_demo && <DemoBadge />}
                    <Badge className={d.likelihood === 'likely' ? 'bg-red-50 text-red-700 ring-red-600/20' : 'bg-amber-50 text-amber-700 ring-amber-600/20'}>{d.likelihood}</Badge>
                    <span className="inline-flex items-center gap-1 text-slate-500"><MapPin size={13} />{d.distance_m} m</span>
                    <span className="text-slate-500">Image sim: {d.image_similarity != null ? `${Math.round(d.image_similarity * 100)}%` : 'n/a'}</span>
                    <span className="text-slate-500">Text sim: {d.text_similarity != null ? `${Math.round(d.text_similarity * 100)}%` : 'n/a'}</span>
                    <Badge className="bg-slate-50 text-slate-600 ring-slate-400/20 capitalize">{d.status}</Badge>
                    <p className="w-full text-xs text-slate-500">{d.reason}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
