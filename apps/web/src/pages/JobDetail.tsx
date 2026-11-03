import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, BookmarkPlus, CircleHelp, ClipboardCheck, ExternalLink, FileText, Map, MessagesSquare } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, ButtonLink, Card, cx, DemoBadge, ErrorState, fmtDate, Loading, Notice, PageHeader, Pill, ScoreBar, Section, SkillStatusPill, Textarea } from '../components/ui';
import { api } from '../lib/api';
import { useAction } from '../lib/hooks';
import type { JobMatch } from '../lib/types';

interface JobDetailData {
  job: { id: number; title: string; company: string; description: string; location: string | null; market: string | null; workMode: string | null; seniority: string | null; minYears: number | null; salaryMin: number | null; salaryMax: number | null; salaryCurrency: string | null; postedAt: string | null; firstSeenAt: string; lastSeenAt: string; lastCheckedAt: string; status: string; isDemo: boolean; canonicalUrl: string | null; originSite: string | null; parsedBy: string | null; ownerUserId: number | null; duplicateCount: number; requiredSkills: string[]; preferredSkills: string[]; qualifications: string[]; certifications: { id: string; name?: string; requirement: string }[] };
  source: { key: string; name: string; type: string; isDemo: boolean } | null;
  role: { slug: string; name: string } | null;
  snapshots: { id: number; capturedAt: string }[];
  match: JobMatch;
}
const STATE_TONE = { matched: 'green', partial: 'yellow', gap: 'red', unknown: 'neutral' } as const;

export default function JobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['job', id], queryFn: () => api.get<JobDetailData>(`/jobs/${id}`) });
  const [jdText, setJdText] = useState('');
  const save = useAction(() => api.post<{ id: number }>('/applications', { jobId: Number(id) }), [['applications'], ['dashboard']], (a) => navigate(`/applications/${a.id}`));
  const tailor = useAction(() => api.post<{ resume: { id: number } }>('/resumes', { kind: 'tailored', jobId: Number(id) }), [['resumes']], (r) => navigate(`/resume/${r.resume.id}`));
  const enrich = useAction(() => api.post<{ jobId: number }>(`/jobs/${id}/description`, { text: jdText }), [['jobs']], (r) => navigate(`/jobs/${r.jobId}`));
  const assess = useAction((skillSlugs: string[]) => api.post<{ id: number }>('/assessments/blueprints', { skillSlugs: skillSlugs.slice(0, 3) }).then((bp) => api.post<{ id: number }>(`/assessments/blueprints/${bp.id}/attempts`)), [], (a) => navigate(`/assessments/attempts/${a.id}`));
  if (q.isLoading) return <Loading rows={5} />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const { job, source, role, match, snapshots } = q.data!;

  return (
    <>
      <Link to="/jobs" className="mb-4 inline-flex items-center gap-1 text-body-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Jobs</Link>
      <PageHeader eyebrow={<span className="flex items-center gap-2">{job.company}{job.isDemo && <DemoBadge />}</span>} title={job.title} subtitle={[job.location ?? job.market, job.workMode, job.seniority].filter(Boolean).join(' · ') || undefined}
        actions={<>
          <Button variant="primary" icon={<BookmarkPlus className="size-4" />} loading={save.isPending} onClick={() => save.mutate(undefined)}>Save to tracker</Button>
          <Button variant="ghost" icon={<FileText className="size-4" />} loading={tailor.isPending} onClick={() => tailor.mutate(undefined)}>Tailor my CV</Button>
          <ButtonLink to={`/interviews/new?jobId=${job.id}&mode=job_specific`} variant="text" icon={<MessagesSquare className="size-4" />}>Mock interview</ButtonLink>
        </>} />
      {job.isDemo && <Notice tone="demo" className="mb-4">This is a fictional demo posting used to demonstrate the workflow. It is not a real vacancy.</Notice>}
      {(save.error || tailor.error) && <Notice tone="warn" className="mb-4">{((save.error || tailor.error) as Error).message}</Notice>}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          <Section title="Your match" description={match.disclaimer}>
            <Card className="mb-4">
              <div className="flex flex-wrap items-end gap-6">
                <div><div className="text-caption text-muted">Overall</div><div className={cx('text-[48px] leading-none font-semibold tracking-tight', match.score == null && 'text-faint')}>{match.score ?? 'Unknown'}</div></div>
                <div><div className="text-caption text-muted">Evidence coverage</div><div className="text-[22px] font-semibold">{Math.round(match.evidenceCoverage * 100)}%</div><div className="text-caption text-muted">backed by assessed/verified skills</div></div>
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {match.components.map((c) => <div key={c.key}><div className="flex justify-between text-body-sm"><span className="font-medium">{c.label}</span><span className="text-muted">{c.score ?? 'unknown'}</span></div><ScoreBar value={c.score} className="my-1" /><div className="text-caption text-muted">{c.detail}</div></div>)}
              </div>
              <ul className="mt-4 flex flex-col gap-1 text-body-sm text-ink-2">{match.scoreExplanation.map((e) => <li key={e}>{e}</li>)}</ul>
            </Card>
            {match.criticalGaps.length > 0 && (
              <div className="mb-4 rounded-lg bg-coral/10 p-5">
                <div className="mb-2 flex items-center gap-2 font-semibold"><AlertTriangle className="size-4 text-coral" />Critical gaps</div>
                <ul className="flex flex-col gap-1 text-body-sm">{match.criticalGaps.map((g) => <li key={g.label}><b>{g.label}</b> — {g.reason}</li>)}</ul>
              </div>
            )}
            {match.unknownRequirements.length > 0 && (
              <div className="mb-4 rounded-lg bg-marigold/15 p-5">
                <div className="mb-2 flex items-center gap-2 font-semibold"><CircleHelp className="size-4" />Unknown — needs evidence</div>
                <ul className="flex flex-col gap-1 text-body-sm">{match.unknownRequirements.map((g) => <li key={g.label}><b>{g.label}</b> — {g.reason}</li>)}</ul>
              </div>
            )}
            <Card padded={false} className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-body-sm">
                <thead><tr className="border-b border-line text-left text-caption text-muted"><th className="px-5 py-2 font-medium">Skill</th><th className="px-3 font-medium">Needed</th><th className="px-3 font-medium">Your evidence</th><th className="px-5 font-medium">Result</th></tr></thead>
                <tbody>{match.skills.map((s) => (
                  <tr key={s.slug + s.requirement} className="border-b border-line last:border-0">
                    <td className="px-5 py-2.5 font-medium">{s.name}<div className="text-caption font-normal text-muted">{s.requirement}</div></td>
                    <td className="px-3">L{s.requiredLevel}</td>
                    <td className="px-3"><SkillStatusPill status={s.status ?? 'unknown'} />{s.level != null && <span className="ml-1 text-caption text-muted">L{s.level}</span>}</td>
                    <td className="px-5"><Pill tone={STATE_TONE[s.state]}>{s.state}</Pill></td>
                  </tr>
                ))}</tbody>
              </table>
            </Card>
          </Section>

          <Section title="Job description" description={job.parsedBy ? `Requirements extracted by ${job.parsedBy}.` : undefined}>
            {job.description ? <Card><div className="whitespace-pre-wrap text-body-sm leading-relaxed text-ink-2">{job.description}</div></Card> : (
              <Card>
                <p className="mb-3 text-body-sm text-ink-2">The source does not publish the full JD text, so requirements come only from certification mentions. If you have the JD (e.g. from the original posting), paste it to analyze it — this creates a private copy for you.</p>
                <Textarea rows={6} value={jdText} onChange={(e) => setJdText(e.target.value)} placeholder="Paste the job description…" />
                <div className="mt-3 flex justify-end"><Button variant="ghost" disabled={jdText.trim().length < 80} loading={enrich.isPending} onClick={() => enrich.mutate(undefined)}>Analyze pasted JD</Button></div>
              </Card>
            )}
          </Section>
        </div>

        <aside className="flex flex-col gap-4">
          <Card>
            <div className="mb-3 font-semibold">Provenance</div>
            <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-body-sm">
              <dt className="text-muted">Source</dt><dd>{source?.name}{job.originSite && ` · ${job.originSite}`}</dd>
              <dt className="text-muted">Status</dt><dd><Pill tone={job.status === 'active' ? 'green' : 'red'}>{job.status}</Pill></dd>
              <dt className="text-muted">Posted</dt><dd>{fmtDate(job.postedAt)}</dd>
              <dt className="text-muted">First seen</dt><dd>{fmtDate(job.firstSeenAt)}</dd>
              <dt className="text-muted">Last seen</dt><dd>{fmtDate(job.lastSeenAt)}</dd>
              <dt className="text-muted">Snapshots</dt><dd>{snapshots.length}</dd>
              {job.duplicateCount > 0 && <><dt className="text-muted">Also listed</dt><dd>{job.duplicateCount} other source(s), merged</dd></>}
              <dt className="text-muted">Salary</dt><dd>{job.salaryMin ? `${job.salaryMin.toLocaleString()}–${job.salaryMax?.toLocaleString()} ${job.salaryCurrency}` : 'Not stated'}</dd>
            </dl>
            {job.canonicalUrl && <a href={job.canonicalUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-1 text-body-sm font-medium text-primary hover:underline">Open original posting <ExternalLink className="size-3.5" /></a>}
          </Card>
          {match.recommendedAssessments.length > 0 && (
            <Card>
              <div className="mb-2 flex items-center gap-2 font-semibold"><ClipboardCheck className="size-4 text-teal" />Recommended assessments</div>
              <ul className="mb-3 flex flex-col gap-2 text-body-sm">{match.recommendedAssessments.map((a) => <li key={a.skillSlug}><b>{a.skillName}</b><div className="text-caption text-muted">{a.reason}</div></li>)}</ul>
              <Button variant="ghost" loading={assess.isPending} onClick={() => assess.mutate(match.recommendedAssessments.map((a) => a.skillSlug))}>Start assessment (top 3)</Button>
            </Card>
          )}
          {match.roadmapNodes.length > 0 && (
            <Card>
              <div className="mb-2 flex items-center gap-2 font-semibold"><Map className="size-4 text-primary" />Roadmap nodes for your gaps</div>
              <div className="flex flex-wrap gap-1.5">{match.roadmapNodes.map((n) => <Link key={n.roleSlug + n.nodeKey} to={`/roadmap/${n.roleSlug}`} className="rounded-full bg-sky-tint px-2.5 py-0.5 text-caption text-primary-ink dark:bg-primary-soft dark:text-primary">{n.label}</Link>)}</div>
            </Card>
          )}
          {role && <Card><div className="text-body-sm">Normalized role: <Link to={`/atlas/${role.slug}`} className="font-medium text-primary">{role.name}</Link></div></Card>}
          {match.manualChecks.length > 0 && <Card><div className="mb-2 font-semibold">Check manually</div><ul className="text-body-sm">{match.manualChecks.map((m) => <li key={m}>{m}</li>)}</ul></Card>}
        </aside>
      </div>
    </>
  );
}
