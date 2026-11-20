import { Construction, Trash2, Lightbulb, Droplets, Waves, Building2, CircleHelp, Ban } from 'lucide-react';

export const CATEGORY = {
  pothole: { label: 'Pothole / Road', icon: Construction, color: '#f97316' },
  garbage: { label: 'Garbage', icon: Trash2, color: '#84cc16' },
  broken_streetlight: { label: 'Streetlight', icon: Lightbulb, color: '#eab308' },
  water_leakage: { label: 'Water Leakage', icon: Droplets, color: '#0ea5e9' },
  open_drain: { label: 'Open Drain', icon: Waves, color: '#6366f1' },
  damaged_infrastructure: { label: 'Infrastructure', icon: Building2, color: '#a855f7' },
  other: { label: 'Other', icon: CircleHelp, color: '#64748b' },
  not_civic_issue: { label: 'Not Civic', icon: Ban, color: '#94a3b8' },
};
export const categoryLabel = (c) => CATEGORY[c]?.label || (c ? c.replace(/_/g, ' ') : 'Unclassified');

export const PRIORITY = {
  Critical: { color: '#dc2626', badge: 'bg-red-50 text-red-700 ring-red-600/20' },
  High: { color: '#f97316', badge: 'bg-orange-50 text-orange-700 ring-orange-600/20' },
  Medium: { color: '#eab308', badge: 'bg-amber-50 text-amber-700 ring-amber-600/20' },
  Low: { color: '#10b981', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' },
};
export const PRIORITY_ORDER = ['Critical', 'High', 'Medium', 'Low'];
export const UNASSIGNED_COLOR = '#94a3b8';

export const STATUS = {
  submitted: { label: 'Submitted', badge: 'bg-slate-100 text-slate-700 ring-slate-500/20' },
  under_review: { label: 'Under Review', badge: 'bg-violet-50 text-violet-700 ring-violet-600/20' },
  in_progress: { label: 'In Progress', badge: 'bg-blue-50 text-blue-700 ring-blue-600/20' },
  resolved: { label: 'Resolved', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' },
  rejected: { label: 'Rejected', badge: 'bg-red-50 text-red-700 ring-red-600/20' },
  duplicate: { label: 'Duplicate', badge: 'bg-zinc-100 text-zinc-700 ring-zinc-500/20' },
};
export const statusLabel = (s) => STATUS[s]?.label || s;

export const AGENTS = {
  orchestrator: { name: 'Orchestrator', short: 'Orchestrator', color: 'slate' },
  intelligence: { name: 'Civic Issue Intelligence Agent', short: 'Agent 1 · Intelligence', color: 'blue' },
  action: { name: 'Civic Action & Prioritisation Agent', short: 'Agent 2 · Action', color: 'green' },
};

// Fallback map view (all of India) used only when there are no reports or location yet.
export const DEFAULT_CENTER = [22.5, 79.0];
export const DEFAULT_ZOOM = 5;

export const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export const timeAgo = (iso) => {
  if (!iso) return '';
  const s = Math.max(1, Math.round((Date.now() - new Date(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
