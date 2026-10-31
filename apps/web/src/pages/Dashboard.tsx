import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarCheck, ClipboardCheck, FileText, MessagesSquare, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import { AccentCard, ButtonLink, Card, EmptyState, ErrorState, fmtDate, Loading, PageHeader, Pill, ScoreBar, Section, SKILL_STATUS } from '../components/ui';
import { AiSuggestions } from '../components/AiSuggestions';
import { ProgressRing, useOnboarding } from '../components/Guide';
import { api } from '../lib/api';
import { useMe } from '../lib/hooks';
import type { MatchSummary, Task } from '../lib/types';

interface DashboardData {
  profile: { completeness: { score: number; checks: { key: string; done: boolean; label: string }[] }; headline: string; skillCounts: { status: string; count: number }[] };
  matches: MatchSummary[];
  plan: { id: number; title: string; stats: { done: number; total: number; doneHours: number; pastDue: number }; projectedEndDate: string; feasible: boolean } | null;
  upcomingTasks: Task[];
  applications: { open: number; nextActions: { applicationId: number; title: string; company: string; action: { title: string; detail: string } }[] };
  interviews: { id: number; mode: string; roundType: string; status: string; roleName: string | null; score: number | null; createdAt: string }[];
  resumeCount: number;
}

export default function Dashboard() {
  const me = useMe();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardData>('/dashboard') });
  const ob = useOnboarding();
  if (q.isLoading) return <Loading rows={5} />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const d = q.data!;
  const firstName = me.data?.displayName.split(' ')[0];
  const nextCheck = d.profile.completeness.checks.find((c) => !c.done);

  return (
    <>
      <PageHeader eyebrow="Dashboard" title={`Welcome back${firstName ? `, ${firstName}` : ''}.`} subtitle={d.profile.headline || 'Start by building your profile — everything else builds on it.'} actions={<ButtonLink to="/matching" variant="primary">Explore role matches</ButtonLink>} />

      {ob.data && ob.data.current && (() => {
        const step = ob.data.steps.find((s) => s.n === ob.data!.current)!;
        return (
          <Link to="/welcome" className="mb-8 flex flex-wrap items-center gap-4 rounded-lg bg-midnight-ink p-5 text-white transition-opacity hover:opacity-95">
            <ProgressRing value={ob.data.completed} total={ob.data.total} size={44} />
            <div className="min-w-0 flex-1">
              <div className="text-caption tracking-wider text-white/60 uppercase">Getting started · {ob.data.completed}/{ob.data.total} done</div>
              <div className="text-[18px] font-semibold">Next: step {step.n} — {step.title}</div>
              <div className="text-body-sm text-white/70">{step.why}</div>
            </div>
            <span className="rounded-md bg-white px-[15px] py-[6px] text-body-sm font-medium text-midnight-ink">Open the guide →</span>
          </Link>
        );
      })()}

      <div className="mb-10 grid gap-4 md:grid-cols-3">
        <Card className="flex flex-col gap-3">
          <div className="flex items-center justify-between"><span className="text-body-sm font-medium text-ink-2">Profile completeness</span><span className="text-[28px] font-semibold">{d.profile.completeness.score}%</span></div>
          <ScoreBar value={d.profile.completeness.score} />
          {nextCheck ? <Link to="/profile" className="text-body-sm text-primary">Next: {nextCheck.label} →</Link> : <span className="text-body-sm text-teal">Profile complete</span>}
        </Card>
        <Card className="flex flex-col gap-3">
          <span className="text-body-sm font-medium text-ink-2">Skill evidence</span>
          <div className="flex flex-wrap gap-2">
            {d.profile.skillCounts.map((s) => <Pill key={s.status} tone={SKILL_STATUS[s.status].tone}>{s.count} {SKILL_STATUS[s.status].label.toLowerCase()}</Pill>)}
          </div>
          <Link to="/assessments" className="mt-auto text-body-sm text-primary">Verify skills with an assessment →</Link>
        </Card>
        <AccentCard tone="marigold" className="flex flex-col gap-2">
          <span className="text-body-sm font-medium">Applications in progress</span>
          <span className="text-[40px] leading-none font-semibold tracking-tight">{d.applications.open}</span>
          <Link to="/applications" className="mt-auto text-body-sm font-medium underline-offset-4 hover:underline">Open tracker →</Link>
        </AccentCard>
      </div>

      <Section title="Target roles" description="Four independent indicators — never merged into a single number." actions={<Link to="/matching" className="text-body-sm text-primary">All roles →</Link>}>
        {d.matches.length === 0 ? <EmptyState title="No roles yet" action={<ButtonLink to="/atlas" variant="ghost">Browse the atlas</ButtonLink>} /> : (
          <div className="grid gap-4 md:grid-cols-2">
            {d.matches.map((m) => (
              <Link key={m.role.slug} to={`/matching?role=${m.role.slug}`} className="card group p-5 transition-colors duration-200 hover:border-primary/40">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div><div className="font-semibold">{m.role.name}</div><div className="text-caption text-muted">{m.role.family}</div></div>
                  {m.criticalGate === 'blocked' ? <Pill tone="red">Critical gap</Pill> : m.criticalGate === 'needs_evidence' ? <Pill tone="yellow">Needs evidence</Pill> : <Pill tone="green">Critical skills met</Pill>}
                </div>
                <div className="grid grid-cols-4 gap-3">
                  {m.dimensions.map((dim) => (
                    <div key={dim.key}>
                      <div className="text-caption text-muted">{dim.label.split(' ')[0]}</div>
                      <div className="text-[18px] font-semibold">{dim.score ?? <span className="text-faint">?</span>}</div>
                      <ScoreBar value={dim.score} className="mt-1" />
                    </div>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="This week’s learning" actions={d.plan && <Link to={`/learning/${d.plan.id}`} className="text-body-sm text-primary">Open plan →</Link>}>
          {!d.plan ? (
            <EmptyState icon={<CalendarCheck className="size-5" />} title="No learning plan yet" action={<ButtonLink to="/learning" variant="ghost">Create a plan</ButtonLink>}>A plan respects prerequisites, your weekly hours and deadline.</EmptyState>
          ) : (
            <Card padded={false}>
              <div className="flex items-center justify-between border-b border-line px-5 py-4">
                <div><div className="font-medium">{d.plan.title}</div><div className="text-caption text-muted">{d.plan.stats.done}/{d.plan.stats.total} tasks · ends {fmtDate(d.plan.projectedEndDate)}</div></div>
                {d.plan.stats.pastDue > 0 && <Pill tone="red">{d.plan.stats.pastDue} past due</Pill>}
              </div>
              <ul className="divide-y divide-line">
                {d.upcomingTasks.length === 0 && <li className="px-5 py-4 text-body-sm text-muted">No sessions scheduled in the next days.</li>}
                {d.upcomingTasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-5 py-3">
                    <Pill tone={t.type === 'assessment' ? 'blue' : t.type === 'remedial' ? 'red' : 'neutral'}>{t.type}</Pill>
                    <span className="flex-1 truncate text-body-sm">{t.title}</span>
                    <span className="text-caption text-muted">{fmtDate(t.scheduledDate)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </Section>

        <Section title="Recommended next actions" actions={<Link to="/applications" className="text-body-sm text-primary">Tracker →</Link>}>
          {d.applications.nextActions.length === 0 ? (
            <EmptyState icon={<Sparkles className="size-5" />} title="Nothing pending" action={<ButtonLink to="/jobs" variant="ghost">Find jobs</ButtonLink>}>Save a job to start tracking an application.</EmptyState>
          ) : (
            <div className="flex flex-col gap-3">
              {d.applications.nextActions.map((a) => (
                <Link key={a.applicationId} to={`/applications/${a.applicationId}`} className="card flex items-start gap-3 p-4 hover:border-primary/40">
                  <ArrowRight className="mt-0.5 size-4 text-primary" />
                  <div><div className="text-body-sm font-medium">{a.action.title}</div><div className="text-caption text-muted">{a.title} · {a.company}</div></div>
                </Link>
              ))}
            </div>
          )}
        </Section>
      </div>

      <div className="mb-10"><AiSuggestions url="/suggestions/dashboard" title="Suggested next steps" /></div>

      <div className="grid gap-4 md:grid-cols-3">
        <Link to="/interviews/new" className="card flex items-center gap-3 p-5 hover:border-primary/40"><MessagesSquare className="size-5 text-coral" /><div><div className="font-medium">Practice an interview</div><div className="text-caption text-muted">{d.interviews.length} recent session(s)</div></div></Link>
        <Link to="/assessments" className="card flex items-center gap-3 p-5 hover:border-primary/40"><ClipboardCheck className="size-5 text-teal" /><div><div className="font-medium">Take an assessment</div><div className="text-caption text-muted">Turn claims into evidence</div></div></Link>
        <Link to="/resume" className="card flex items-center gap-3 p-5 hover:border-primary/40"><FileText className="size-5 text-primary" /><div><div className="font-medium">CV builder</div><div className="text-caption text-muted">{d.resumeCount} CV(s)</div></div></Link>
      </div>
    </>
  );
}
