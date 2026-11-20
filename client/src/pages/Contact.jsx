import { useState } from 'react';
import { Send, Loader2, CheckCircle2, AlertCircle, Building2, MessageSquare } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { Alert, PageHeader } from '../components/ui';

const EMPTY = { name: '', email: '', subject: '', message: '', website: '' };

function validate(f) {
  const e = {};
  if (f.name.trim().length < 2) e.name = 'Please enter your name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) e.email = 'Please enter a valid email address.';
  if (f.subject.trim().length < 3) e.subject = 'Subject must be at least 3 characters.';
  if (f.message.trim().length < 10) e.message = 'Message must be at least 10 characters.';
  return e;
}

export default function Contact() {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [state, setState] = useState({ status: 'idle' });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    const v = validate(form);
    setErrors(v);
    if (Object.keys(v).length) return;
    setState({ status: 'sending' });
    try {
      const { data } = await api.post('/contact', form);
      setState({ status: 'done', id: data.id });
      setForm(EMPTY);
    } catch (err) {
      const fields = err?.response?.data?.error?.fields;
      if (fields) setErrors(Object.fromEntries(fields.map((f) => [f.field, f.message])));
      setState({ status: 'error', message: errorMessage(err) });
    }
  };

  const Field = ({ id, label, children }) => (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      {children}
      {errors[id] && <p className="mt-1 flex items-center gap-1 text-xs font-medium text-red-600"><AlertCircle size={12} />{errors[id]}</p>}
    </div>
  );

  return (
    <div className="container-page py-10">
      <PageHeader eyebrow="Contact" title="Get in touch" description="Questions, partnership enquiries from municipal corporations, or feedback about CivicLens — we would love to hear from you." />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <form onSubmit={submit} noValidate className="card space-y-4 p-6">
          {state.status === 'done' && (
            <Alert tone="success" icon={CheckCircle2} title="Message received">
              Thank you. Your message has been delivered to the CivicLens team.
            </Alert>
          )}
          {state.status === 'error' && <Alert tone="error" icon={AlertCircle}>{state.message}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            {Field({ id: 'name', label: 'Name', children: <input id="name" className="input" value={form.name} onChange={set('name')} maxLength={100} autoComplete="name" /> })}
            {Field({ id: 'email', label: 'Email', children: <input id="email" type="email" className="input" value={form.email} onChange={set('email')} maxLength={200} autoComplete="email" /> })}
          </div>
          {Field({ id: 'subject', label: 'Subject', children: <input id="subject" className="input" value={form.subject} onChange={set('subject')} maxLength={150} /> })}
          {Field({ id: 'message', label: 'Message', children: <textarea id="message" rows={6} className="input resize-none" value={form.message} onChange={set('message')} maxLength={5000} /> })}
          {/* Honeypot field — hidden from humans */}
          <input type="text" name="website" value={form.website} onChange={set('website')} className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" />
          <button className="btn-primary w-full py-3 sm:w-auto sm:px-8" disabled={state.status === 'sending'}>
            {state.status === 'sending' ? <><Loader2 size={18} className="animate-spin" /> Sending…</> : <><Send size={18} /> Send message</>}
          </button>
        </form>
        <aside className="space-y-4">
          {[
            [Building2, 'For municipal corporations', 'Interested in piloting CivicLens in your city? Tell us about your ward structure and departments.'],
            [MessageSquare, 'For citizens', 'To report a civic issue, use the Report page — it is faster and routes your photo through the AI agents.'],
          ].map(([Icon, title, text]) => (
            <div key={title} className="card flex gap-3 p-5">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600"><Icon size={18} /></div>
              <div><p className="font-bold">{title}</p><p className="mt-0.5 text-sm text-slate-600">{text}</p></div>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
