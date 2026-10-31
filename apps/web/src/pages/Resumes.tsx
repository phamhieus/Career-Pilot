import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button, Card, DemoBadge, EmptyState, ErrorState, Field, fmtDate, Loading, PageHeader, Pill, Select } from '../components/ui';
import { api } from '../lib/api';
import { useAction } from '../lib/hooks';
import type { JobListItem } from '../lib/types';

interface ResumeRow { id: number; title: string; kind: string; language: string; template: string; updatedAt: string; versionNo: number | null; evidenceCoverage: number | null; jdRelevance: number | null; job: { id: number; title: string; company: string; isDemo: boolean } | null }

export default function Resumes() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const list = useQuery({ queryKey: ['resumes'], queryFn: () => api.get<ResumeRow[]>('/resumes') });
  const jobs = useQuery({ queryKey: ['jobs', 'for-cv'], queryFn: () => api.get<{ items: JobListItem[] }>('/jobs?limit=100') });
  const [f, setF] = useState({ kind: params.get('jobId') ? 'tailored' : 'master', jobId: params.get('jobId') ?? '', language: 'en', template: 'classic' });
  const create = useAction(() => api.post<{ resume: { id: number } }>('/resumes', { kind: f.kind, jobId: f.jobId ? Number(f.jobId) : undefined, language: f.language, template: f.template }), [['resumes']], (r) => navigate(`/resume/${r.resume.id}`));

  return (
    <>
      <PageHeader eyebrow="Apply" title="CV" highlight="builder" subtitle="A master CV from your confirmed profile, and tailored versions per job. Every bullet keeps a link to its source evidence." />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div>
          {list.isLoading && <Loading />}
          {list.error && <ErrorState error={list.error} retry={list.refetch} />}
          {list.data?.length === 0 && <EmptyState icon={<FileText className="size-5" />} title="No CVs yet">Create a master CV first, then tailor it for specific jobs.</EmptyState>}
          <div className="flex flex-col gap-3">
            {list.data?.map((r) => (
              <Link key={r.id} to={`/resume/${r.id}`} className="card flex flex-wrap items-center gap-4 p-5 hover:border-primary/40">
                <div className="flex size-11 items-center justify-center rounded-md bg-sky-tint text-primary dark:bg-primary-soft"><FileText className="size-5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 font-semibold">{r.title}<Pill tone={r.kind === 'master' ? 'dark' : 'blue'}>{r.kind}</Pill>{r.job?.isDemo && <DemoBadge />}</div>
                  <div className="text-caption text-muted">v{r.versionNo} · {r.language.toUpperCase()} · {r.template} · updated {fmtDate(r.updatedAt)}</div>
                </div>
                <div className="flex gap-4 text-right">
                  <div><div className="text-caption text-muted">Evidence</div><div className="font-semibold">{r.evidenceCoverage ?? '—'}%</div></div>
                  {r.jdRelevance != null && <div><div className="text-caption text-muted">JD relevance</div><div className="font-semibold">{r.jdRelevance}%</div></div>}
                </div>
              </Link>
            ))}
          </div>
        </div>
        <Card className="h-fit">
          <div className="mb-4 font-semibold">New CV</div>
          <div className="flex flex-col gap-4">
            <Field label="Type"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="master">Master CV</option><option value="tailored">Tailored for a job</option></Select></Field>
            {f.kind === 'tailored' && <Field label="Job"><Select value={f.jobId} onChange={(e) => setF({ ...f, jobId: e.target.value })}><option value="">—</option>{jobs.data?.items.map((j) => <option key={j.id} value={j.id}>{j.title} — {j.company}{j.isDemo ? ' (demo)' : ''}</option>)}</Select></Field>}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Language"><Select value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}><option value="en">English</option><option value="vi">Tiếng Việt</option></Select></Field>
              <Field label="Template"><Select value={f.template} onChange={(e) => setF({ ...f, template: e.target.value })}><option value="classic">Classic</option><option value="compact">Compact</option><option value="modern">Modern</option></Select></Field>
            </div>
            {create.error && <p className="text-body-sm text-vermillion">{(create.error as Error).message}</p>}
            <Button variant="primary" loading={create.isPending} disabled={f.kind === 'tailored' && !f.jobId} onClick={() => create.mutate(undefined)}>Generate from my evidence</Button>
            <p className="text-caption text-muted">Only confirmed profile entries are used. Nothing is invented: claims the AI adds without evidence are flagged for you.</p>
          </div>
        </Card>
      </div>
    </>
  );
}
