import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CircleHelp } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button, ButtonLink, Card, cx, DimensionCard, ErrorState, Loading, Notice, PageHeader, ScoreBar, Select, Tabs } from '../components/ui';
import { CapabilityExplanation, SkillComparison, TransferableSkills } from '../components/MatchExplanation';
import { api, qs } from '../lib/api';
import { useAction } from '../lib/hooks';
import type { MatchSummary, RoleMatch } from '../lib/types';

export default function Matching() {
  const [params, setParams] = useSearchParams();
  const role = params.get('role');
  const [includeDemo, setIncludeDemo] = useState(false);
  const [sort, setSort] = useState<'capability' | 'interest' | 'growth' | 'market'>('capability');
  const list = useQuery({ queryKey: ['matching', includeDemo], queryFn: () => api.get<MatchSummary[]>(`/matching${qs({ includeDemo })}`) });
  const sorted = [...(list.data ?? [])].sort((a, b) => (b.dimensions.find((d) => d.key === sort)?.score ?? -1) - (a.dimensions.find((d) => d.key === sort)?.score ?? -1));
  const active = role ?? sorted[0]?.role.slug ?? null;

  return (
    <>
      <PageHeader eyebrow="You" title="Role" highlight="matching" subtitle="Capability, interest, growth potential and market opportunity are computed independently from your evidence — none of them is a hiring probability." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={sort} onChange={setSort} items={[{ value: 'capability', label: 'Capability' }, { value: 'interest', label: 'Interest' }, { value: 'growth', label: 'Growth' }, { value: 'market', label: 'Market' }]} />
        <label className="ml-auto inline-flex items-center gap-2 text-body-sm"><input type="checkbox" checked={includeDemo} onChange={(e) => setIncludeDemo(e.target.checked)} />Include demo postings in market signals</label>
      </div>
      {list.isLoading && <Loading rows={6} />}
      {list.error && <ErrorState error={list.error} retry={list.refetch} />}
      {list.data && (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <Card padded={false} className="max-h-[78vh] overflow-auto">
            {sorted.map((m) => (
              <button key={m.role.slug} onClick={() => setParams({ role: m.role.slug })} className={cx('block w-full border-b border-line px-4 py-3 text-left transition-colors last:border-0', active === m.role.slug ? 'bg-primary-soft' : 'hover:bg-black/[0.02] dark:hover:bg-white/5')}>
                <div className="flex items-center justify-between gap-2"><span className="text-body-sm font-medium">{m.role.name}</span>{m.criticalGate === 'blocked' && <AlertTriangle className="size-3.5 text-coral" aria-label="critical gap" />}</div>
                <div className="mt-2 grid grid-cols-4 gap-1.5">{m.dimensions.map((d) => <div key={d.key} title={`${d.label}: ${d.score ?? 'unknown'}`}><ScoreBar value={d.score} tone={d.key === 'capability' ? 'blue' : d.key === 'interest' ? 'yellow' : d.key === 'growth' ? 'green' : 'red'} /></div>)}</div>
              </button>
            ))}
          </Card>
          {active && <RoleMatchDetail key={`${active}:${params.get('level') ?? 'middle'}`} slug={active} includeDemo={includeDemo} />}
        </div>
      )}
    </>
  );
}

const GATE_ICON = { clear: <CheckCircle2 className="size-5 text-teal" />, needs_evidence: <CircleHelp className="size-5 text-[#7a4f00]" />, blocked: <AlertTriangle className="size-5 text-coral" /> };

function RoleMatchDetail({ slug, includeDemo }: { slug: string; includeDemo: boolean }) {
  const [params] = useSearchParams();
  const initialLevel = params.get('level');
  const [level, setLevel] = useState(initialLevel === 'junior' || initialLevel === 'senior' ? initialLevel : 'middle');
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['matching', slug, level, includeDemo], queryFn: () => api.get<RoleMatch>(`/matching/${slug}${qs({ level, includeDemo })}`) });
  const assess = useAction((skillSlugs: string[]) => api.post<{ id: number }>('/assessments/blueprints', { skillSlugs, roleSlug: slug }).then((bp) => api.post<{ id: number }>(`/assessments/blueprints/${bp.id}/attempts`)), [], (a) => navigate(`/assessments/attempts/${a.id}`));
  if (q.isLoading) return <Loading rows={4} />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const m = q.data!;
  const unverifiedCritical = m.requirements.filter((r) => r.critical && r.gate !== 'met').map((r) => r.skillSlug).slice(0, 3);

  return (
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div><Link to={`/atlas/${m.role.slug}`} className="text-heading-sm font-semibold hover:text-primary">{m.role.name}</Link><div className="text-caption text-muted">{m.role.family}</div></div>
        <Select aria-label="Target level" className="ml-auto w-36" value={level} onChange={(e) => setLevel(e.target.value)}><option value="junior">Junior</option><option value="middle">Middle</option><option value="senior">Senior</option></Select>
      </div>
      <div className={cx('mb-4 flex items-start gap-3 rounded-lg px-5 py-4', m.criticalGate.status === 'blocked' ? 'bg-coral/10' : m.criticalGate.status === 'needs_evidence' ? 'bg-marigold/15' : 'bg-teal/10')}>
        {GATE_ICON[m.criticalGate.status]}
        <div className="flex-1"><div className="font-semibold">Critical skill gate: {m.criticalGate.status.replace('_', ' ')}</div><div className="text-body-sm">{m.criticalGate.message}</div></div>
        {unverifiedCritical.length > 0 && <Button variant="ghost" loading={assess.isPending} onClick={() => assess.mutate(unverifiedCritical)}>Assess critical skills</Button>}
      </div>
      <CapabilityExplanation match={m} />
      <div className="mb-6 grid gap-4 md:grid-cols-2">{m.dimensions.map((d) => <DimensionCard key={d.key} d={d} />)}</div>
      {m.transferableFrom && <Notice className="mb-6">From your current role: {m.transferableFrom.rationale} Typical transition ~{m.transferableFrom.typicalMonths} months.</Notice>}
      <TransferableSkills match={m} />
      {assess.error && <Notice tone="warn" className="mb-3">{(assess.error as Error).message}</Notice>}

      <SkillComparison match={m} onAssess={(slugs) => assess.mutate(slugs)} assessing={assess.isPending} />
      <p className="mb-6 text-caption text-muted">{m.disclaimer}</p>
      <div className="flex flex-wrap gap-2">
        <ButtonLink to={`/roadmap/${m.role.slug}`} variant="ghost">View skill roadmap</ButtonLink>
        <ButtonLink to={`/learning?role=${m.role.slug}`} variant="text">Create learning plan</ButtonLink>
        <ButtonLink to={`/jobs?role=${m.role.slug}`} variant="text">Jobs for this role</ButtonLink>
      </div>
    </div>
  );
}
