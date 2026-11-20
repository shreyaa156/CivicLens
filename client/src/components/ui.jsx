import { Loader2, FlaskConical, Inbox } from 'lucide-react';
import { CATEGORY, PRIORITY, STATUS, categoryLabel, statusLabel } from '../lib/constants';

const cx = (...c) => c.filter(Boolean).join(' ');
export { cx };

export function Badge({ className, children, title }) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset whitespace-nowrap', className)}>
      {children}
    </span>
  );
}

export function PriorityBadge({ priority }) {
  if (!priority) return <Badge className="bg-slate-50 text-slate-500 ring-slate-400/20">Unassigned</Badge>;
  return (
    <Badge className={PRIORITY[priority]?.badge}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: PRIORITY[priority]?.color }} />
      {priority}
    </Badge>
  );
}

export function StatusBadge({ status }) {
  return <Badge className={STATUS[status]?.badge || 'bg-slate-100 text-slate-600 ring-slate-400/20'}>{statusLabel(status)}</Badge>;
}

export function DemoBadge() {
  return (
    <Badge className="bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-600/20" title="Sample record for demonstration — not a genuine complaint">
      <FlaskConical size={11} /> DEMO
    </Badge>
  );
}

export function CategoryChip({ category, size = 'sm' }) {
  const meta = CATEGORY[category];
  const Icon = meta?.icon;
  return (
    <span className={cx('inline-flex items-center gap-1.5 font-semibold text-slate-700', size === 'lg' ? 'text-base' : 'text-sm')}>
      {Icon && (
        <span className="grid place-items-center rounded-lg p-1" style={{ background: `${meta.color}1f`, color: meta.color }}>
          <Icon size={size === 'lg' ? 18 : 14} />
        </span>
      )}
      {categoryLabel(category)}
    </span>
  );
}

export function Spinner({ label, className }) {
  return (
    <div className={cx('flex items-center justify-center gap-2 py-10 text-sm text-slate-500', className)}>
      <Loader2 className="animate-spin text-brand-600" size={18} /> {label || 'Loading…'}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, children }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">
        <Icon size={22} />
      </div>
      <p className="font-semibold text-slate-700">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function Alert({ tone = 'info', icon: Icon, title, children, className }) {
  const tones = {
    info: 'border-brand-200 bg-brand-50 text-brand-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    error: 'border-red-200 bg-red-50 text-red-800',
    success: 'border-civic-100 bg-civic-50 text-civic-700',
  };
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('flex gap-3 rounded-xl border p-3.5 text-sm', tones[tone], className)}>
      {Icon && <Icon size={18} className="mt-0.5 shrink-0" />}
      <div>
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'mt-0.5 opacity-90' : ''}>{children}</div>}
      </div>
    </div>
  );
}

export function ConfidenceBar({ value }) {
  if (value == null) return <span className="text-sm text-slate-400">—</span>;
  const pct = Math.round(value * 100);
  const color = pct >= 75 ? 'bg-civic-500' : pct >= 55 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
        <div className={cx('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-semibold text-slate-700">{pct}%</span>
    </div>
  );
}

export function SectionHeading({ eyebrow, title, children, center }) {
  return (
    <div className={cx('max-w-2xl', center && 'mx-auto text-center')}>
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h2 className="mt-2 text-3xl font-extrabold text-ink sm:text-4xl">{title}</h2>
      {children && <p className="mt-3 text-base text-slate-600">{children}</p>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <div className="flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="mt-1 text-2xl font-extrabold text-ink sm:text-3xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
