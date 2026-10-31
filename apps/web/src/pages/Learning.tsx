import { useQuery } from '@tanstack/react-query';
import { GraduationCap } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button, Card, EmptyState, ErrorState, Field, fmtDate, Input, Loading, PageHeader, Pill, Section, Select } from '../components/ui';
import { api } from '../lib/api';
import { useAction, useMeta } from '../lib/hooks';
import type { ProfileResponse } from '../lib/types';
import { LearningFormatPicker, type LearningFormat } from '../components/LearningFormatPicker';
import { YouTubeLearningPlayer, type YouTubeLearningSource } from '../components/YouTubeLearningPlayer';

interface PlanRow { plan: { id: number; title: string; status: string; weeklyHours: number; startDate: string; deadline: string | null; projectedEndDate: string; totalHours: number; feasible: boolean; createdAt: string }; roleName: string; roleSlug: string }

export default function Learning() {
  const meta = useMeta();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [learningFormat, setLearningFormat] = useState<LearningFormat>('docs');
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api.get<ProfileResponse>('/profile') });
  const plans = useQuery({ queryKey: ['learning'], queryFn: () => api.get<PlanRow[]>('/learning') });
  const [form, setForm] = useState<{ roleSlug: string; weeklyHours: string; deadline: string; studyDaysPerWeek: string } | null>(null);
  const p = profile.data?.profile;
  const f = form ?? { roleSlug: params.get('role') ?? p?.targetRoleSlugs[0] ?? '', weeklyHours: p?.weeklyLearningHours?.toString() ?? '8', deadline: p?.deadline ?? '', studyDaysPerWeek: String(p?.studyDaysPerWeek ?? 5) };
  const create = useAction(() => api.post<{ id: number }>('/learning', { roleSlug: f.roleSlug, learningFormat, weeklyHours: Number(f.weeklyHours), deadline: f.deadline || null, studyDaysPerWeek: Number(f.studyDaysPerWeek) }), [['learning'], ['dashboard'], ['roadmap']], (r) => navigate(`/learning/${r.id}`));
  const active = plans.data?.find((x) => x.plan.status === 'active');
  const activePlanId = active?.plan.id.toString();
  const activePlan = useQuery({ queryKey: ['learning', activePlanId], enabled: !!activePlanId, queryFn: () => api.get<{ videoSeries: YouTubeLearningSource[] }>(`/learning/${activePlanId}`) });

  return (
    <>
      <PageHeader eyebrow="Grow" title="Adaptive learning" highlight="plan" subtitle="Ordered by prerequisites and priority, sized to your weekly hours, revised when you pass or miss things." />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0">
          {plans.isLoading && <Loading />}
          {plans.error && <ErrorState error={plans.error} retry={plans.refetch} />}
          {active && <Section title="Your YouTube course series" description={`Watch lessons for your ${active.roleName} learning plan right here. Choose a series and use the playlist menu to move between lessons.`}>
            <Card>
              {activePlan.isLoading && <Loading rows={3} />}
              {activePlan.error && <ErrorState error={activePlan.error} retry={activePlan.refetch} />}
              {activePlan.data && <YouTubeLearningPlayer key={activePlanId} sources={activePlan.data.videoSeries} storageKey={`careerpilot:learning:${activePlanId}:series:main`} label={active.roleName} />}
              <Link to={`/learning/${active.plan.id}`} className="mt-4 inline-block text-body-sm font-medium text-primary hover:underline">Open tasks & full learning plan →</Link>
            </Card>
          </Section>}
          {plans.data?.length === 0 && <EmptyState icon={<GraduationCap className="size-5" />} title="No plans yet">Choose a target role on the right. Skills you have already verified are skipped automatically.</EmptyState>}
          <div className="flex flex-col gap-3">
            {plans.data?.map(({ plan, roleName }) => (
              <Link key={plan.id} to={`/learning/${plan.id}`} className="card flex flex-wrap items-center justify-between gap-3 p-5 hover:border-primary/40">
                <div><div className="flex items-center gap-2 font-semibold">{plan.title}<Pill tone={plan.status === 'active' ? 'green' : 'neutral'}>{plan.status}</Pill>{!plan.feasible && <Pill tone="red">deadline at risk</Pill>}</div><div className="text-caption text-muted">{roleName} · {plan.weeklyHours} h/week · {Math.round(plan.totalHours)} h total · ends {fmtDate(plan.projectedEndDate)}</div></div>
                <span className="text-body-sm text-primary">Open →</span>
              </Link>
            ))}
          </div>
        </div>
        <Card className="h-fit">
          <div className="mb-1 font-semibold">{active ? 'Change goal / new plan' : 'Create a plan'}</div>
          {active && <p className="mb-3 text-caption text-muted">Creating a new plan archives “{active.plan.title}”. Verified skills stay on your profile and are skipped in the new plan.</p>}
          <div className="flex flex-col gap-4">
            <Field label="Target role"><Select value={f.roleSlug} onChange={(e) => setForm({ ...f, roleSlug: e.target.value })}><option value="">—</option>{meta.data?.roles.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}</Select></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Hours / week"><Input type="number" min={1} max={80} value={f.weeklyHours} onChange={(e) => setForm({ ...f, weeklyHours: e.target.value })} /></Field>
              <Field label="Study days / week"><Input type="number" min={1} max={7} value={f.studyDaysPerWeek} onChange={(e) => setForm({ ...f, studyDaysPerWeek: e.target.value })} /></Field>
            </div>
            <Field label="Deadline (optional)"><Input type="date" value={f.deadline} onChange={(e) => setForm({ ...f, deadline: e.target.value })} /></Field>
            <LearningFormatPicker value={learningFormat} onChange={setLearningFormat} />
            {create.error && <p className="text-body-sm text-vermillion">{(create.error as Error).message}</p>}
            <Button variant="primary" disabled={!f.roleSlug} loading={create.isPending} onClick={() => create.mutate(undefined)}>Generate plan</Button>
          </div>
        </Card>
      </div>
    </>
  );
}
