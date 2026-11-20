import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { UploadCloud, LocateFixed, MapPin, X, Send, Loader2, AlertCircle, CheckCircle2, RotateCcw, ExternalLink, ImagePlus } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useApp } from '../lib/AppContext';
import LocationPicker from '../components/LocationPicker';
import AgentWorkflow from '../components/AgentWorkflow';
import AnalysisPanel from '../components/AnalysisPanel';
import { Alert, PageHeader, cx } from '../components/ui';

const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];

export default function ReportIssue() {
  const { config } = useApp();
  const maxMb = config?.maxUploadMb || 8;
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [description, setDescription] = useState('');
  const [position, setPosition] = useState(null);
  const [geoState, setGeoState] = useState({ loading: false, error: null });
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [phase, setPhase] = useState('form'); // form | submitting | processing | done
  const [run, setRun] = useState(null);
  const [report, setReport] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);
  const pollRef = useRef(null);

  useEffect(() => () => clearInterval(pollRef.current), []);
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  const pickFile = (f) => {
    if (!f) return;
    if (!ACCEPT.includes(f.type)) return setErrors((e) => ({ ...e, image: 'Please choose a JPEG, PNG or WebP photo.' }));
    if (f.size > maxMb * 1048576) return setErrors((e) => ({ ...e, image: `Photo must be under ${maxMb} MB.` }));
    setErrors((e) => ({ ...e, image: null }));
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const locate = () => {
    if (!('geolocation' in navigator)) return setGeoState({ loading: false, error: 'Geolocation is not supported by this browser. Please pick the location on the map.' });
    setGeoState({ loading: true, error: null });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({ latitude: +pos.coords.latitude.toFixed(6), longitude: +pos.coords.longitude.toFixed(6) });
        setGeoState({ loading: false, error: null, accuracy: Math.round(pos.coords.accuracy) });
        setErrors((e) => ({ ...e, location: null }));
      },
      (err) =>
        setGeoState({
          loading: false,
          error: err.code === 1 ? 'Location permission was denied. You can tap the map to choose the spot instead.' : 'Could not get your location. Please pick it on the map.',
        }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  };

  const validate = () => {
    const e = {};
    if (!file) e.image = 'Please add a photo of the issue.';
    if (!position) e.location = 'Please share your location or tap the map to mark the issue.';
    if (description.length > 1000) e.description = 'Description must be 1000 characters or fewer.';
    setErrors(e);
    return !Object.values(e).some(Boolean);
  };

  const pollRun = (runId, reportId) => {
    const tick = async () => {
      try {
        const { data } = await api.get(`/agents/runs/${runId}`);
        setRun(data.run);
        if (data.run.status !== 'running') {
          clearInterval(pollRef.current);
          const r = await api.get(`/reports/${reportId}`);
          setReport(r.data.report);
          setPhase('done');
        }
      } catch {
        /* keep polling */
      }
    };
    tick();
    pollRef.current = setInterval(tick, 900);
  };

  const submit = async (ev) => {
    ev.preventDefault();
    setSubmitError(null);
    if (!validate()) return;
    const fd = new FormData();
    fd.append('image', file);
    fd.append('description', description.trim());
    fd.append('latitude', position.latitude);
    fd.append('longitude', position.longitude);
    setPhase('submitting');
    try {
      const { data } = await api.post('/reports', fd);
      setReport(data.report);
      setPhase('processing');
      pollRun(data.runId, data.report.id);
    } catch (err) {
      setSubmitError(errorMessage(err));
      setPhase('form');
    }
  };

  const reset = () => {
    clearInterval(pollRef.current);
    setFile(null);
    setPreview(null);
    setDescription('');
    setRun(null);
    setReport(null);
    setPhase('form');
  };

  if (phase === 'processing' || phase === 'done') {
    return (
      <div className="container-page py-10">
        <PageHeader
          eyebrow={phase === 'done' ? 'Analysis complete' : 'Agents at work'}
          title={phase === 'done' ? `Report ${report?.reference} submitted` : 'Analysing your report…'}
          description={phase === 'done' ? 'Thank you for helping your city. Here is what the CivicLens agents found.' : 'Watch the two agents coordinate in real time. This usually takes a few seconds.'}
          actions={
            phase === 'done' && (
              <>
                <Link to={`/reports/${report.id}`} className="btn-secondary"><ExternalLink size={16} /> Issue details</Link>
                <button onClick={reset} className="btn-primary"><RotateCcw size={16} /> Report another</button>
              </>
            )
          }
        />
        <AgentWorkflow run={run || { status: 'running', steps: [] }} showLog={false} />
        {phase === 'done' && report && (
          <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
            <div className="card overflow-hidden">
              {report.image_url && <img src={report.image_url} alt="Submitted issue" className="aspect-[4/3] w-full object-cover" />}
              <div className="space-y-1 p-4 text-sm">
                <p className="flex items-center gap-1.5 font-semibold text-slate-700"><MapPin size={14} /> {report.area || 'Location recorded'}</p>
                <p className="font-mono text-xs text-slate-500">{report.latitude.toFixed(5)}, {report.longitude.toFixed(5)}</p>
                {report.citizen_description && <p className="pt-2 text-slate-600">“{report.citizen_description}”</p>}
              </div>
            </div>
            <div className="card p-6">
              <AnalysisPanel report={report} />
              <p className="mt-6 text-xs text-slate-500">
                Status: <strong>submitted</strong>. Save your reference <strong>{report.reference}</strong> to track it. CivicLens recommends actions for municipal staff; it has not automatically notified any department.
              </p>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="container-page py-10">
      <PageHeader eyebrow="Report an issue" title="Tell us what needs fixing" description="Add a photo and location. Our AI agents will identify the issue, check for duplicates and recommend a priority." />
      <form onSubmit={submit} noValidate className="grid gap-6 lg:grid-cols-2">
        <div className="card space-y-5 p-6">
          <div>
            <label className="label" htmlFor="photo">Photo of the issue <span className="text-red-500">*</span></label>
            {preview ? (
              <div className="relative overflow-hidden rounded-xl border border-slate-200">
                <img src={preview} alt="Preview of selected issue" className="max-h-80 w-full object-cover" />
                <button type="button" onClick={() => { setFile(null); setPreview(null); }} className="absolute right-2 top-2 rounded-full bg-white/90 p-1.5 shadow hover:bg-white" aria-label="Remove photo">
                  <X size={16} />
                </button>
                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 p-3 text-xs text-white">{file?.name} · {(file?.size / 1024 / 1024).toFixed(2)} MB</div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0]); }}
                className={cx('flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition', dragOver ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-slate-50/60 hover:border-brand-300 hover:bg-brand-50/40', errors.image && 'border-red-300')}
              >
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-brand-600 shadow-sm"><UploadCloud size={24} /></div>
                <p className="mt-3 text-sm font-semibold text-slate-700">Click to upload or drag & drop</p>
                <p className="mt-1 text-xs text-slate-500">JPEG, PNG or WebP · up to {maxMb} MB · use your phone camera on mobile</p>
              </button>
            )}
            <input ref={inputRef} id="photo" type="file" accept={ACCEPT.join(',')} capture="environment" className="sr-only" onChange={(e) => pickFile(e.target.files?.[0])} />
            {errors.image && <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-red-600"><AlertCircle size={13} />{errors.image}</p>}
          </div>

          <div>
            <label className="label" htmlFor="desc">Description <span className="font-normal text-slate-400">(optional, helps the AI)</span></label>
            <textarea id="desc" rows={4} maxLength={1000} className="input resize-none" placeholder="e.g. Deep pothole near the school gate, two-wheelers swerving into traffic." value={description} onChange={(e) => setDescription(e.target.value)} />
            <p className="mt-1 text-right text-xs text-slate-400">{description.length}/1000</p>
          </div>

          <div className="rounded-xl bg-slate-50 p-4 text-xs text-slate-600">
            <p className="flex items-center gap-1.5 font-semibold text-slate-700"><ImagePlus size={14} /> Tips for a good photo</p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
              <li>Take it in daylight from 2–5 metres away.</li>
              <li>Include surroundings (road, landmark) for context.</li>
              <li>Avoid faces and vehicle number plates where possible.</li>
            </ul>
          </div>
        </div>

        <div className="card space-y-4 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="label mb-0">Location <span className="text-red-500">*</span></p>
            <button type="button" onClick={locate} className="btn-secondary py-2" disabled={geoState.loading}>
              {geoState.loading ? <Loader2 size={16} className="animate-spin" /> : <LocateFixed size={16} />} Use my location
            </button>
          </div>
          <LocationPicker position={position} onChange={(p) => { setPosition(p); setErrors((e) => ({ ...e, location: null })); }} className="h-80" />
          <div className={cx('flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm', position ? 'border-civic-100 bg-civic-50 text-civic-700' : 'border-slate-200 bg-slate-50 text-slate-500', errors.location && 'border-red-200 bg-red-50 text-red-700')}>
            {position ? <CheckCircle2 size={16} /> : <MapPin size={16} />}
            {position ? (
              <span className="font-mono">{position.latitude.toFixed(6)}, {position.longitude.toFixed(6)}{geoState.accuracy ? ` · ±${geoState.accuracy} m` : ''}</span>
            ) : (
              <span>{errors.location || 'Tap the map or use your location to drop a pin. Drag the pin to fine-tune.'}</span>
            )}
          </div>
          {geoState.error && <Alert tone="warning" icon={AlertCircle}>{geoState.error}</Alert>}
          {submitError && <Alert tone="error" icon={AlertCircle} title="Could not submit report">{submitError}</Alert>}
          <button type="submit" className="btn-primary w-full py-3 text-base" disabled={phase === 'submitting'}>
            {phase === 'submitting' ? <><Loader2 size={18} className="animate-spin" /> Uploading…</> : <><Send size={18} /> Submit report</>}
          </button>
          <p className="text-center text-xs text-slate-400">Photos are re-encoded and stripped of metadata (including GPS EXIF) before storage.</p>
        </div>
      </form>
    </div>
  );
}
