import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, CalendarClock, Check, ChevronDown, ClipboardCheck, ExternalLink, History, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { AccentCard, Button, ButtonLink, Card, cx, ErrorState, fmtDate, Loading, Notice, PageHeader, Pill, ScoreBar, Section } from '../components/ui';
import { api } from '../lib/api';
import { useAction } from '../lib/hooks';
import type { Resource, Task } from '../lib/types';
import { LearningFormatPicker, LEARNING_FORMATS, type LearningFormat } from '../components/LearningFormatPicker';
import { YouTubeLearningPlayer, type YouTubeLearningSource } from '../components/YouTubeLearningPlayer';

interface PlanDetail {
  plan: { id: number; title: string; status: string; learningFormat: LearningFormat; weeklyHours: number; studyDaysPerWeek: number; startDate: string; deadline: string | null; projectedEndDate: string; totalHours: number; feasible: boolean; feasibilityNote: string; skippedNodeKeys: string[] };
  role: { slug: string; name: string };
  milestones: { id: number; title: string; targetDate: string; status: string; nodeKeys: string[] }[];
  tasks: Task[];
  revisions: { id: number; reason: string; summary: string; createdAt: string; changes: Record<string, unknown> }[];
  resources: Resource[];
  learningOptions: { nodeKey: string; label: string; projectBrief: string; docs: Resource[]; videos: Resource[]; series: YouTubeLearningSource[]; youtubeSearchUrl: string }[];
  videoSeries: YouTubeLearningSource[];
  stats: { done: number; total: number; doneHours: number; pastDue: number };
  jobSuggestions: { skillSlug: string; skillName: string; jobs: string[] }[];
}
const TYPE_TONE = { learn: 'neutral', practice: 'blue', assessment: 'green', project: 'peach', remedial: 'red' } as const;

export default function LearningPlan() {
  const { planId } = useParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['learning', planId], queryFn: () => api.get<PlanDetail>(`/learning/${planId}`) });
  const inv = [['learning'], ['dashboard'], ['roadmap']];
  const setStatus = useAction(({ id, status }: { id: number; status: string }) => api.patch(`/learning/tasks/${id}`, { status }), inv);
  const reschedule = useAction(() => api.post<{ missed: number }>(`/learning/${planId}/reschedule-missed`), inv);
  const replan = useAction(() => api.post(`/learning/${planId}/replan`), inv);
  const changeFormat = useAction((learningFormat: LearningFormat) => api.patch(`/learning/${planId}/format`, { learningFormat }), inv);
  const addSkills = useAction((slugs: string[]) => api.post(`/learning/${planId}/extra-skills`, { skillSlugs: slugs }), inv);
  const assess = useAction((slug: string) => api.post<{ id: number }>('/assessments/blueprints', { skillSlugs: [slug] }).then((bp) => api.post<{ id: number }>(`/assessments/blueprints/${bp.id}/attempts`)), [], (a) => navigate(`/assessments/attempts/${a.id}`));
  const [openWeeks, setOpenWeeks] = useState<Set<number>>(new Set([0, 1]));
  if (q.isLoading) return <Loading rows={5} />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const d = q.data!;
  const res = (ids: number[]) => d.resources.filter((r) => ids.includes(r.id));
  const nearTerm = d.tasks.filter((t) => t.scheduledDate && (t.status === 'todo' || t.status === 'missed'));
  const byDate = new Map<string, Task[]>();
  for (const t of nearTerm) byDate.set(t.scheduledDate!, [...(byDate.get(t.scheduledDate!) ?? []), t]);
  const weeks = new Map<number, Task[]>();
  for (const t of d.tasks) weeks.set(t.weekIndex, [...(weeks.get(t.weekIndex) ?? []), t]);
  const archived = d.plan.status !== 'active';

  const taskRow = (t: Task) => (
    <div key={t.id} className="flex flex-wrap items-start gap-3 py-2.5">
      <button aria-label={t.status === 'done' ? 'Mark as not done' : 'Mark as done'} disabled={archived} onClick={() => setStatus.mutate({ id: t.id, status: t.status === 'done' ? 'todo' : 'done' })} className={cx('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border transition-colors', t.status === 'done' ? 'border-teal bg-teal text-white' : 'border-line hover:border-primary')}>{t.status === 'done' && <Check className="size-3.5" />}</button>
      <div className="min-w-0 flex-1">
        <div className={cx('flex flex-wrap items-center gap-2 text-body-sm font-medium', (t.status === 'done' || t.status === 'skipped') && 'text-muted line-through')}>{t.title}<Pill tone={TYPE_TONE[t.type as keyof typeof TYPE_TONE] ?? 'neutral'}>{t.type}</Pill>{t.status === 'missed' && <Pill tone="red">missed</Pill>}{t.status === 'skipped' && <Pill>skipped</Pill>}</div>
        {t.detail && <div className="text-caption text-ink-2">{t.detail}</div>}
        {res(t.resourceIds).length > 0 && <div className="mt-1 flex flex-wrap gap-x-3">{res(t.resourceIds).map((r) => <a key={r.id} href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-caption text-primary hover:underline"><BookOpen className="size-3" />{r.title}<ExternalLink className="size-2.5" /></a>)}</div>}
        {t.type !== 'assessment' && d.learningOptions.find((o) => o.nodeKey === t.nodeKey) && <TaskLearningOptions key={`${t.id}:${d.plan.learningFormat}`} options={d.learningOptions.find((o) => o.nodeKey === t.nodeKey)!} preferred={d.plan.learningFormat} storageKey={`careerpilot:learning:${planId}:series:${t.nodeKey}`} />}
      </div>
      <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
        {t.type === 'assessment' && t.skillSlug && t.status !== 'done' && !archived && <Button variant="ghost" className="px-2.5 py-1" onClick={() => assess.mutate(t.skillSlug!)}><ClipboardCheck className="size-3.5" />Start</Button>}
        {t.type === 'assessment' && !t.skillSlug && t.status !== 'done' && <ButtonLink to={`/roadmap/${d.role.slug}`} variant="ghost" className="px-2.5 py-1">Checkpoint</ButtonLink>}
        <span className="text-caption text-muted">{t.estimatedHours}h</span>
        {t.status === 'todo' && !archived && <button onClick={() => setStatus.mutate({ id: t.id, status: 'skipped' })} className="text-caption text-faint hover:text-ink">skip</button>}
      </div>
    </div>
  );

  return (
    <>
      <Link to="/learning" className="mb-4 inline-flex items-center gap-1 text-body-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Plans</Link>
      <PageHeader eyebrow={<Link to={`/roadmap/${d.role.slug}`} className="hover:text-ink">{d.role.name} roadmap</Link>} title={d.plan.title}
        subtitle={`${d.plan.weeklyHours} h/week over ${d.plan.studyDaysPerWeek} study days · started ${fmtDate(d.plan.startDate)} · projected end ${fmtDate(d.plan.projectedEndDate)}`}
        actions={!archived && <Button variant="ghost" icon={<RefreshCw className="size-4" />} loading={replan.isPending} onClick={() => replan.mutate(undefined)}>Recalculate with latest evidence</Button>} />
      {archived && <Notice tone="warn" className="mb-4">This plan is archived (goal changed). History is kept for reference.</Notice>}

      <Section title="Your YouTube course series" description="Follow a course in order without leaving your learning plan. Use the playlist menu to move between lessons; each task below also offers topic-specific series.">
        <Card><YouTubeLearningPlayer key={planId} sources={d.videoSeries} storageKey={`careerpilot:learning:${planId}:series:main`} label={d.role.name} /></Card>
      </Section>

      <div className="mb-8 grid gap-4 md:grid-cols-3">
        <Card><div className="text-body-sm text-ink-2">Progress</div><div className="text-[30px] font-semibold">{d.stats.done}<span className="text-muted">/{d.stats.total}</span></div><ScoreBar value={(d.stats.done / Math.max(1, d.stats.total)) * 100} /><div className="mt-1 text-caption text-muted">{d.stats.doneHours} of ~{Math.round(d.plan.totalHours)} hours</div></Card>
        <AccentCard tone={d.plan.feasible ? 'tint' : 'coral'} className="md:col-span-2"><div className="mb-1 font-semibold">{d.plan.feasible ? 'Schedule fits your constraints' : 'Deadline at risk'}</div><p className="text-body-sm">{d.plan.feasibilityNote}</p>{d.plan.skippedNodeKeys.length > 0 && <p className="mt-2 text-caption opacity-80">Skipped (already verified or completed): {d.plan.skippedNodeKeys.join(', ')}</p>}</AccentCard>
      </div>

      {d.stats.pastDue > 0 && !archived && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg bg-marigold/20 px-5 py-4">
          <CalendarClock className="size-5" /><div className="flex-1 text-body-sm"><b>{d.stats.pastDue} session(s) are past due.</b> Reschedule from today without exceeding your weekly hours.</div>
          <Button variant="primary" loading={reschedule.isPending} onClick={() => reschedule.mutate(undefined)}>Reschedule missed</Button>
        </div>
      )}
      {d.jobSuggestions.length > 0 && !archived && (
        <Notice className="mb-6">
          <div className="mb-2 font-medium">Tracked jobs require skills this plan doesn’t cover:</div>
          <ul className="mb-2">{d.jobSuggestions.map((s) => <li key={s.skillSlug}><b>{s.skillName}</b> — {s.jobs.join('; ')}</li>)}</ul>
          <Button variant="ghost" loading={addSkills.isPending} onClick={() => addSkills.mutate(d.jobSuggestions.map((s) => s.skillSlug))}>Add them to the plan</Button>
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          <Section title="Next two weeks" description="Daily sessions are scheduled only for the near term; later work stays at weekly granularity.">
            {byDate.size === 0 ? <Card><p className="text-body-sm text-muted">No sessions scheduled in the near term.</p></Card> : (
              <div className="flex flex-col gap-3">
                {[...byDate.entries()].sort().map(([date, ts]) => (
                  <Card key={date} padded={false} className="px-5 py-2">
                    <div className="border-b border-line py-2 text-caption font-semibold uppercase tracking-wider text-muted">{new Date(date).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</div>
                    <div className="divide-y divide-line">{ts.map(taskRow)}</div>
                  </Card>
                ))}
              </div>
            )}
          </Section>
          <Section title="Full plan by week">
            <div className="flex flex-col gap-2">
              {[...weeks.entries()].sort((a, b) => a[0] - b[0]).map(([w, ts]) => {
                const open = openWeeks.has(w);
                const done = ts.filter((t) => t.status === 'done' || t.status === 'skipped').length;
                return (
                  <Card key={w} padded={false}>
                    <button className="flex w-full items-center gap-3 px-5 py-3 text-left" aria-expanded={open} onClick={() => setOpenWeeks((s) => { const n = new Set(s); if (n.has(w)) n.delete(w); else n.add(w); return n; })}>
                      <ChevronDown className={cx('size-4 transition-transform', !open && '-rotate-90')} />
                      <span className="font-medium">Week {w + 1}</span>
                      <span className="text-caption text-muted">{ts.reduce((s, t) => s + t.estimatedHours, 0).toFixed(1)} h · {done}/{ts.length} done</span>
                    </button>
                    {open && <div className="divide-y divide-line border-t border-line px-5">{ts.map(taskRow)}</div>}
                  </Card>
                );
              })}
            </div>
          </Section>
        </div>
        <aside className="flex flex-col gap-6">
          <Card>
            <LearningFormatPicker value={d.plan.learningFormat} onChange={(format) => changeFormat.mutate(format)} disabled={archived || changeFormat.isPending} />
            <p className="mt-3 text-caption text-muted">Changing this preference reschedules remaining work. Project mode allocates more time to hands-on work. Completed history is kept.</p>
            {changeFormat.isPending && <p className="mt-2 text-caption text-primary">Updating your plan…</p>}
            {changeFormat.error && <p role="alert" className="mt-2 text-caption text-vermillion">{(changeFormat.error as Error).message}</p>}
          </Card>
          <div>
            <h2 className="mb-3 text-heading-sm font-semibold">Milestones</h2>
            <ol className="relative flex flex-col gap-4 border-l border-line pl-5">
              {d.milestones.map((m) => <li key={m.id} className="relative"><span className={cx('absolute top-1 -left-[27px] size-3 rounded-full border-2', m.status === 'done' ? 'border-teal bg-teal' : 'border-signal-blue bg-surface')} /><div className="text-body-sm font-medium">{m.title}</div><div className="text-caption text-muted">target {fmtDate(m.targetDate)}</div></li>)}
            </ol>
          </div>
          <div>
            <h2 className="mb-3 flex items-center gap-2 text-heading-sm font-semibold"><History className="size-4" />Revisions</h2>
            <div className="flex flex-col gap-3">
              {d.revisions.map((r) => <Card key={r.id} className="p-4"><div className="flex items-center justify-between gap-2"><Pill tone={r.reason.includes('failed') || r.reason.includes('missed') ? 'yellow' : r.reason.includes('passed') ? 'green' : 'neutral'}>{r.reason.replace(/_/g, ' ')}</Pill><span className="text-caption text-muted">{fmtDate(r.createdAt)}</span></div><p className="mt-2 text-body-sm text-ink-2">{r.summary}</p></Card>)}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

function TaskLearningOptions({ options, preferred, storageKey }: { options: PlanDetail['learningOptions'][number]; preferred: LearningFormat; storageKey: string }) {
  const [format, setFormat] = useState(preferred);
  const [open, setOpen] = useState(false);
  return <details className="mt-2 rounded-md border border-line p-2" onToggle={(e) => setOpen(e.currentTarget.open)}>
    <summary className="cursor-pointer text-caption font-medium text-primary">Choose learning material: documents, project or YouTube</summary>
    <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label={`Learning material for ${options.label}`}>
      {LEARNING_FORMATS.map(({ value, label, icon: Icon }) => <button key={value} type="button" aria-pressed={format === value} onClick={() => setFormat(value)} className={cx('inline-flex items-center gap-1 rounded-md border px-2 py-1 text-caption', format === value ? 'border-primary bg-primary-soft text-primary' : 'border-line')}><Icon className="size-3.5" />{label}</button>)}
    </div>
    <div className="mt-3 text-body-sm text-ink-2">
      {format === 'docs' && (options.docs.length ? <ul className="flex flex-col gap-2">{options.docs.map((r) => <li key={r.id}><a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">{r.title}<ExternalLink className="size-3" /></a><div className="text-caption text-muted">{r.provider} · {r.type}{!r.free && ' · Paid'}</div></li>)}</ul> : <p className="text-caption text-muted">No document is linked to this topic yet. Try the project or YouTube option.</p>)}
      {format === 'project' && <><div className="mb-1 font-medium">Practical brief</div><p className="whitespace-pre-wrap">{options.projectBrief || `Apply ${options.label} in a small, demonstrable piece of work. Explain your approach and validate the result.`}</p><p className="mt-2 text-caption text-muted">Keep the deliverable, your decisions and validation results as evidence. Previewing this option does not add study hours to your plan.</p></>}
      {format === 'youtube' && open && <>
        <YouTubeLearningPlayer sources={[...options.series, ...options.videos.map((r) => ({ ...r, id: `resource-${r.id}` }))]} storageKey={storageKey} label={options.label} />
        <a href={options.youtubeSearchUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">Find {options.label} lessons on YouTube<ExternalLink className="size-3" /></a>
        <p className="mt-2 text-caption text-muted">Choose the lessons relevant to this task from the series, then complete the practical work. You can also browse YouTube and paste another playlist into the player above.</p>
      </>}
    </div>
  </details>;
}
