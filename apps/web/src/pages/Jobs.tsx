import { useQuery } from '@tanstack/react-query';
import { Briefcase, ClipboardPaste, Database, RefreshCw, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AiMetaNote, Button, Card, cx, DemoBadge, EmptyState, ErrorState, Field, fmtDate, Input, Loading, Modal, Notice, PageHeader, Pill, Select, Textarea } from '../components/ui';
import { api, qs } from '../lib/api';
import { useAction, useMeta } from '../lib/hooks';
import type { JobListItem } from '../lib/types';

interface Source { id: number; key: string; name: string; type: string; isDemo: boolean; lastSyncAt: string | null; lastSyncStatus: string | null; lastSyncMessage: string | null }
const PAGE = 20;

export default function Jobs() {
  const meta = useMeta();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const role = params.get('role') ?? '';
  const market = params.get('market') ?? '';
  const includeDemo = params.get('demo') !== 'false';
  const page = Number(params.get('page') ?? 0);
  const [importOpen, setImportOpen] = useState(false);
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); p.delete('page'); setParams(p); };
  const jobs = useQuery({ queryKey: ['jobs', params.toString()], queryFn: () => api.get<{ total: number; items: JobListItem[] }>(`/jobs${qs({ q: params.get('q'), role, market, includeDemo, limit: PAGE, offset: page * PAGE, withMatch: true })}`) });

  return (
    <>
      <PageHeader eyebrow="Apply" title="Job" highlight="intelligence" subtitle="Postings from permitted sources with provenance and freshness. Demo postings are fictional and always labeled." actions={<Button variant="primary" icon={<ClipboardPaste className="size-4" />} onClick={() => setImportOpen(true)}>Import a job description</Button>} />
      <SourcesPanel />
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <form className="relative md:w-72" onSubmit={(e) => { e.preventDefault(); set('q', q); }}><Search className="absolute top-2.5 left-3 size-4 text-faint" /><Input aria-label="Search jobs" placeholder="Title or company…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" /></form>
        <Select aria-label="Role" className="md:w-56" value={role} onChange={(e) => set('role', e.target.value)}><option value="">All roles</option>{meta.data?.roles.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}</Select>
        <Select aria-label="Market" className="md:w-40" value={market} onChange={(e) => set('market', e.target.value)}><option value="">All markets</option>{['vietnam', 'singapore', 'japan', 'remote', 'global'].map((m) => <option key={m} value={m}>{m}</option>)}</Select>
        <label className="inline-flex items-center gap-2 text-body-sm"><input type="checkbox" checked={includeDemo} onChange={(e) => set('demo', e.target.checked ? '' : 'false')} />Show demo postings</label>
      </div>
      {jobs.isLoading && <Loading rows={6} />}
      {jobs.error && <ErrorState error={jobs.error} retry={jobs.refetch} />}
      {jobs.data && jobs.data.items.length === 0 && <EmptyState icon={<Briefcase className="size-5" />} title="No postings match" action={<Button variant="ghost" onClick={() => setImportOpen(true)}>Import a JD</Button>}>Sync a source above or paste a job description you found.</EmptyState>}
      <div className="flex flex-col gap-3">
        {jobs.data?.items.map((j) => (
          <Link key={j.id} to={`/jobs/${j.id}`} className="card grid gap-3 p-5 transition-colors duration-200 hover:border-primary/40 md:grid-cols-[1fr_auto]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{j.title}</span>{j.isDemo && <DemoBadge />}{j.isPrivate && <Pill tone="blue">Your import</Pill>}{j.status !== 'active' && <Pill tone="red">{j.status}</Pill>}</div>
              <div className="text-body-sm text-ink-2">{j.company} · {j.location ?? j.market ?? 'location unknown'}{j.workMode ? ` · ${j.workMode}` : ''}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {j.role && <Pill>{j.role.name}</Pill>}
                {!j.hasDescription && <Pill tone="yellow" >No JD text at source</Pill>}
                {j.certifications.slice(0, 3).map((c) => <Pill key={c.id} tone={c.requirement === 'required' ? 'red' : 'neutral'}>{c.name ?? c.id}</Pill>)}
              </div>
              <div className="mt-2 text-caption text-muted">{j.originSite ? `via ${j.originSite}` : j.source} · posted {fmtDate(j.postedAt)} · last seen {fmtDate(j.lastSeenAt)}</div>
            </div>
            <div className="flex items-center gap-3 md:flex-col md:items-end">
              <div className="text-right"><div className="text-caption text-muted">Match</div><div className={cx('text-[26px] font-semibold', j.matchScore == null && 'text-faint')}>{j.matchScore ?? '—'}</div></div>
            </div>
          </Link>
        ))}
      </div>
      {jobs.data && jobs.data.total > PAGE && (
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button variant="text" disabled={page === 0} onClick={() => { const p = new URLSearchParams(params); p.set('page', String(page - 1)); setParams(p); }}>Previous</Button>
          <span className="text-body-sm text-muted">{page * PAGE + 1}–{Math.min(jobs.data.total, (page + 1) * PAGE)} of {jobs.data.total}</span>
          <Button variant="text" disabled={(page + 1) * PAGE >= jobs.data.total} onClick={() => { const p = new URLSearchParams(params); p.set('page', String(page + 1)); setParams(p); }}>Next</Button>
        </div>
      )}
      <ImportJob open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}

function SourcesPanel() {
  const sources = useQuery({ queryKey: ['job-sources'], queryFn: () => api.get<Source[]>('/jobs/sources') });
  const sync = useAction(({ key, useSnapshot }: { key: string; useSnapshot?: boolean }) => api.post<{ inserted: number; note?: string }>(`/jobs/sources/${key}/sync`, { useSnapshot }), [['job-sources'], ['jobs'], ['market'], ['atlas'], ['matching']]);
  const syncable = (sources.data ?? []).filter((s) => ['cert_trends', 'greenhouse', 'lever'].includes(s.type));
  return (
    <Card className="mb-6">
      <div className="mb-3 flex items-center gap-2 font-semibold"><Database className="size-4 text-primary" />Sources</div>
      <div className="grid gap-3 md:grid-cols-2">
        {syncable.map((s) => (
          <div key={s.key} className="rounded-md border border-line p-3">
            <div className="flex items-center justify-between gap-2">
              <div><div className="text-body-sm font-medium">{s.name}</div><div className="text-caption text-muted">{s.lastSyncAt ? `Last sync ${fmtDate(s.lastSyncAt)} · ${s.lastSyncStatus}` : 'Never synced'}</div></div>
              <Button variant="ghost" icon={<RefreshCw className="size-3.5" />} loading={sync.isPending && sync.variables?.key === s.key && !sync.variables.useSnapshot} onClick={() => sync.mutate({ key: s.key })}>Sync now</Button>
            </div>
            {s.lastSyncMessage && <p className="mt-2 text-caption text-ink-2">{s.lastSyncMessage}</p>}
            {s.type === 'cert_trends' && s.lastSyncStatus === 'error' && <Button variant="text" className="mt-1 px-0" onClick={() => sync.mutate({ key: s.key, useSnapshot: true })}>Import bundled snapshot (2026-10-31) instead</Button>}
          </div>
        ))}
        <div className="rounded-md border border-dashed border-line p-3 text-caption text-muted">Company boards (Greenhouse/Lever public APIs) can be enabled with GREENHOUSE_BOARDS / LEVER_COMPANIES. CareerPilot never scrapes sites that disallow it or bypasses anti-bot measures.</div>
      </div>
      {sync.error && <p className="mt-2 text-body-sm text-vermillion">{(sync.error as Error).message}</p>}
    </Card>
  );
}

function ImportJob({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [f, setF] = useState({ text: '', title: '', company: '', url: '', location: '' });
  const run = useAction(() => api.post<{ jobId: number; aiMeta: { mode: string; provider: string } }>('/jobs/import', { text: f.text, title: f.title || undefined, company: f.company || undefined, url: f.url || undefined, location: f.location || undefined }), [['jobs']], (r) => { onClose(); navigate(`/jobs/${r.jobId}`); });
  return (
    <Modal open={open} onClose={onClose} title="Import a job description" wide>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Title (optional)"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Company (optional)"><Input value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></Field>
        <Field label="Original posting URL"><Input type="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></Field>
        <Field label="Location"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        <Field label="Job description text" className="md:col-span-2"><Textarea rows={10} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder="Paste the full JD…" /></Field>
      </div>
      <Notice className="mt-3">Imported JDs are private to you. The text is treated as untrusted data: AI extracts facts only, and salary is kept only if written explicitly.</Notice>
      {run.data && <AiMetaNote meta={run.data.aiMeta} />}
      {run.error && <p className="mt-2 text-body-sm text-vermillion">{(run.error as Error).message}</p>}
      <div className="mt-4 flex justify-end"><Button variant="primary" loading={run.isPending} disabled={f.text.trim().length < 80} onClick={() => run.mutate(undefined)}>Analyze & save</Button></div>
    </Modal>
  );
}
