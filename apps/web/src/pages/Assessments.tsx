import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button, Card, EmptyState, ErrorState, Field, fmtDate, Loading, Notice, PageHeader, Pill, Select } from '../components/ui';
import { api } from '../lib/api';
import { useAction, useMeta } from '../lib/hooks';
import { SkillPicker } from './Profile';

interface Blueprint { id: number; title: string; skillSlugs: string[]; targetLevel: number; rationale: string; createdAt: string; attempts: { id: number; status: string; startedAt: string; submittedAt: string | null; score: number | null; passed: boolean | null }[] }

export default function Assessments() {
  const meta = useMeta();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [skills, setSkills] = useState<string[]>([]);
  const [role, setRole] = useState('');
  const [level, setLevel] = useState('3');
  const jobId = params.get('jobId');
  const job = useQuery({ queryKey: ['job', jobId], enabled: !!jobId, queryFn: () => api.get<{ job: { title: string }; match: { recommendedAssessments: { skillSlug: string }[] } }>(`/jobs/${jobId}`) });
  useEffect(() => { if (job.data) setSkills(job.data.match.recommendedAssessments.slice(0, 3).map((r) => r.skillSlug)); }, [job.data]);
  const list = useQuery({ queryKey: ['assessments'], queryFn: () => api.get<Blueprint[]>('/assessments') });
  const create = useAction(() => api.post<{ id: number }>('/assessments/blueprints', skills.length ? { skillSlugs: skills, level: Number(level) } : { roleSlug: role }).then((bp) => api.post<{ id: number }>(`/assessments/blueprints/${bp.id}/attempts`)), [['assessments']], (a) => navigate(`/assessments/attempts/${a.id}`));

  return (
    <>
      <PageHeader eyebrow="Grow" title="Skill" highlight="assessments" subtitle="Objective quizzes plus scenario, practical and case-study tasks with structured rubrics. Passing both at ≥70% makes a skill app-verified." />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div>
          {list.isLoading && <Loading />}
          {list.error && <ErrorState error={list.error} retry={list.refetch} />}
          {list.data?.length === 0 && <EmptyState icon={<ClipboardCheck className="size-5" />} title="No assessments yet">Create one on the right, or start from a roadmap node or a job’s recommendations.</EmptyState>}
          <div className="flex flex-col gap-3">
            {list.data?.map((b) => (
              <Card key={b.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><div className="font-semibold">{b.title}</div><div className="text-caption text-muted">{fmtDate(b.createdAt)} · {b.rationale}</div></div>
                  <Button variant="ghost" onClick={() => api.post<{ id: number }>(`/assessments/blueprints/${b.id}/attempts`).then((a) => navigate(`/assessments/attempts/${a.id}`))}>Retake</Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {b.attempts.map((a) => (
                    <Link key={a.id} to={`/assessments/attempts/${a.id}`} className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-body-sm hover:border-primary/40">
                      Attempt #{a.id}{a.status === 'graded' ? <Pill tone={a.passed ? 'green' : 'red'}>{Math.round((a.score ?? 0) * 100)}% {a.passed ? 'passed' : 'not passed'}</Pill> : <Pill tone="yellow">in progress</Pill>}
                    </Link>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </div>
        <Card className="h-fit">
          <div className="mb-4 font-semibold">New assessment</div>
          {job.data && <Notice className="mb-3">Preselected skills recommended for “{job.data.job.title}”.</Notice>}
          <div className="flex flex-col gap-4">
            <Field label="Skills (up to 5)"><SkillPicker value={skills} onChange={(v) => setSkills(v.slice(0, 5))} options={meta.data?.skills ?? []} /></Field>
            <Field label="Target level"><Select value={level} onChange={(e) => setLevel(e.target.value)}>{[1, 2, 3, 4, 5].map((l) => <option key={l} value={l}>Level {l}</option>)}</Select></Field>
            <div className="text-center text-caption text-muted">— or let CareerPilot pick the priority skills for a role —</div>
            <Field label="Target role"><Select value={role} onChange={(e) => setRole(e.target.value)} disabled={skills.length > 0}><option value="">—</option>{meta.data?.roles.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}</Select></Field>
            {create.error && <p className="text-body-sm text-vermillion">{(create.error as Error).message}</p>}
            <Button variant="primary" disabled={!skills.length && !role} loading={create.isPending} onClick={() => create.mutate(undefined)}>Generate blueprint & start</Button>
          </div>
        </Card>
      </div>
    </>
  );
}
