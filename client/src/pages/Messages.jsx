import { useCallback, useEffect, useState } from 'react';
import { Inbox, Mail, RefreshCw } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { formatDate, timeAgo } from '../lib/constants';
import AdminGate from '../components/AdminGate';
import { Alert, EmptyState, PageHeader, Spinner, cx } from '../components/ui';

const FILTERS = [
  ['all', 'All'],
  ['unread', 'Unread'],
  ['read', 'Read'],
];

function MessagesInner() {
  const [filter, setFilter] = useState('all');
  const [messages, setMessages] = useState(null);
  const [counts, setCounts] = useState({ total: 0, unread: 0 });
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/messages', { params: { filter } });
      setMessages(data.messages);
      setCounts(data.counts);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [filter]);
  useEffect(() => {
    load();
  }, [load]);

  const selected = messages?.find((m) => m.id === selectedId) || null;

  const setRead = async (msg, read) => {
    try {
      const { data } = await api.patch(`/admin/messages/${msg.id}`, { read });
      setCounts(data.counts);
      setMessages((list) => list.map((m) => (m.id === msg.id ? data.message : m)));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const open = (msg) => {
    setSelectedId(msg.id);
    if (!msg.is_read) setRead(msg, true);
  };

  return (
    <div className="container-page py-8">
      <PageHeader
        eyebrow="Administration"
        title="Messages"
        description="Messages sent through the public Contact page. Only administrators can see them."
        actions={
          <button className="btn-secondary" onClick={load}>
            <RefreshCw size={16} /> Refresh
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map(([value, label]) => (
          <button
            key={value}
            onClick={() => {
              setFilter(value);
              setSelectedId(null);
            }}
            className={cx('rounded-full px-3.5 py-1.5 text-sm font-semibold transition', filter === value ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50')}
          >
            {label}
            {value === 'unread' && counts.unread > 0 && <span className="ml-1.5 rounded-full bg-brand-600 px-1.5 text-xs text-white">{counts.unread}</span>}
          </button>
        ))}
        <span className="ml-auto text-sm text-slate-500">
          {counts.total} message{counts.total === 1 ? '' : 's'} · {counts.unread} unread
        </span>
      </div>

      {error && <Alert tone="error" className="mb-4">{error}</Alert>}

      {!messages ? (
        <Spinner />
      ) : !messages.length ? (
        <div className="card">
          <EmptyState icon={Inbox} title={filter === 'all' ? 'No messages yet' : `No ${filter} messages`}>
            Messages from the public Contact page will appear here.
          </EmptyState>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
          <ul className="card max-h-[70vh] divide-y divide-slate-100 overflow-auto">
            {messages.map((m) => (
              <li key={m.id}>
                <button onClick={() => open(m)} className={cx('flex w-full gap-3 px-4 py-3 text-left transition hover:bg-slate-50', selectedId === m.id && 'bg-brand-50/60')}>
                  <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', m.is_read ? 'bg-transparent' : 'bg-brand-600')} aria-label={m.is_read ? 'Read' : 'Unread'} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={cx('truncate text-sm', m.is_read ? 'font-medium text-slate-700' : 'font-bold text-ink')}>{m.name}</span>
                      <span className="shrink-0 text-xs text-slate-400">{timeAgo(m.created_at)}</span>
                    </span>
                    <span className={cx('block truncate text-sm', m.is_read ? 'text-slate-600' : 'font-semibold text-slate-800')}>{m.subject}</span>
                    <span className="block truncate text-xs text-slate-500">{m.message}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="card min-h-[320px] p-6">
            {!selected ? (
              <EmptyState icon={Mail} title="Select a message">Choose a message on the left to read it.</EmptyState>
            ) : (
              <article>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold text-ink">{selected.subject}</h2>
                    <p className="mt-1 text-sm text-slate-600">
                      <span className="font-semibold text-slate-800">{selected.name}</span> · <a className="text-brand-600 hover:underline" href={`mailto:${selected.email}`}>{selected.email}</a>
                    </p>
                    <p className="text-xs text-slate-400">{formatDate(selected.created_at)}</p>
                  </div>
                </div>
                <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{selected.message}</p>
              </article>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Messages() {
  return (
    <AdminGate>
      <MessagesInner />
    </AdminGate>
  );
}
