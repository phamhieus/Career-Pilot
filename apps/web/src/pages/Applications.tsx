import { useQuery } from '@tanstack/react-query';
import { BookOpenCheck, FlaskConical } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button, ButtonLink, Card, cx, DemoBadge, EmptyState, ErrorState, Field, fmtDate, label, Loading, Modal, Notice, PageHeader, Pill, Select, Stat, Tabs, Textarea } from '../components/ui';
import { api } from '../lib/api';
import { useAction } from '../lib/hooks';
import { OUTCOMES, STAGES } from '../lib/types';

export interface AppRow { id: number; stage: string; outcome: string | null; appliedAt: string | null; source: string; updatedAt: string; followUpAt: string | null; resumeLabel: string | null; roundCount: number; jobSnapshot: { title: string; company: string; isDemo: boolean; url: string | null }; nextAction: { title: string } | null }
interface Analytics { total: number; demoJobs: number; byStage: { stage: string; count: number }[]; byOutcome: { outcome: string; count: number }[]; funnel: { stage: string; count: number }[]; responseRate: number | null; medianDaysToResponse: number | null; bySource: { source: string; count: number }[] }

export function useStageChange(onDone?: () => void) {
  return useAction(({ id, stage, outcome, note }: { id: number; stage: string; outcome?: string | null; note?: string }) => api.post(`/applications/${id}/stage`, { stage, outcome: outcome ?? null, note }), [['applications'], ['application'], ['dashboard']], onDone);
}

export function CloseModal({ target, onClose }: { target: { id: number } | null; onClose: () => void }) {
  const [outcome, setOutcome] = useState<string>('rejected');
  const [note, setNote] = useState('');
  const change = useStageChange(onClose);
  return (
    <Modal open={!!target} onClose={onClose} title="Close application">
      <div className="flex flex-col gap-4">
        <Field label="Outcome"><Select value={outcome} onChange={(e) => setOutcome(e.target.value)}>{OUTCOMES.map((o) => <option key={o} value={o}>{label(o)}</option>)}</Select></Field>
        <Field label="Note (optional)"><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {change.error && <p className="text-body-sm text-vermillion">{(change.error as Error).message}</p>}
        <div className="flex justify-end"><Button variant="primary" loading={change.isPending} onClick={() => target && change.mutate({ id: target.id, stage: 'closed', outcome, note })}>Close application</Button></div>
      </div>
    </Modal>
  );
}

export default function Applications() {
  const [view, setView] = useState<'kanban' | 'table' | 'analytics'>('kanban');
  const q = useQuery({ queryKey: ['applications'], queryFn: () => api.get<AppRow[]>('/applications') });
  const sample = useAction(() => api.post<{ inserted: number; total: number; candidateName: string }>('/applications/sample'), [['applications'], ['dashboard'], ['onboarding']]);
  const [dragging, setDragging] = useState<number | null>(null);
  const [closing, setClosing] = useState<{ id: number } | null>(null);
  const change = useStageChange();
  const drop = (stage: string) => {
    if (dragging == null) return;
    const app = q.data?.find((a) => a.id === dragging);
    setDragging(null);
    if (!app || app.stage === stage) return;
    if (stage === 'closed') setClosing({ id: app.id });
    else change.mutate({ id: app.id, stage });
  };

  return (
    <>
      <PageHeader eyebrow="Apply" title="Application" highlight="tracker" subtitle="You submit applications yourself; CareerPilot keeps the exact CV version, the timeline and what to do next. It never applies or emails on your behalf." actions={<><Button variant="ghost" icon={<FlaskConical className="size-4" />} loading={sample.isPending} onClick={() => sample.mutate(undefined)}>Load demo tracker — Dinh Dieu</Button><ButtonLink to="/jobs" variant="primary">Find a job to track</ButtonLink></>} />
      {(sample.data || q.data?.some((a) => a.source === 'Demo — Dinh Dieu')) && <Notice tone="demo" className="mb-4">Fictional application tracker for <b>Dinh Dieu</b>: {sample.data?.total ?? 10} demo applications across every stage, with interview rounds, follow-up reminders and sample outcomes. Your profile and CVs are kept as they are. Existing applications are preserved.</Notice>}
      {sample.error && <Notice tone="warn" className="mb-4">{(sample.error as Error).message}</Notice>}
      <div className="mb-4"><Tabs value={view} onChange={setView} items={[{ value: 'kanban', label: 'Kanban' }, { value: 'table', label: 'Table' }, { value: 'analytics', label: 'Analytics' }]} /></div>
      {change.error && <p className="mb-3 text-body-sm text-vermillion">{(change.error as Error).message}</p>}
      {q.isLoading && <Loading />}
      {q.error && <ErrorState error={q.error} retry={q.refetch} />}
      {q.data?.length === 0 && <EmptyState icon={<BookOpenCheck className="size-5" />} title="Nothing tracked yet" action={<ButtonLink to="/jobs" variant="ghost">Browse jobs</ButtonLink>}>Save a job from its detail page to start tracking.</EmptyState>}
      {q.data && q.data.length > 0 && view === 'kanban' && (
        <div className="-mx-4 overflow-x-auto px-4 pb-4">
          <div className="grid min-w-[1100px] grid-cols-7 gap-3">
            {STAGES.map((st) => {
              const items = q.data!.filter((a) => a.stage === st);
              return (
                <div key={st} onDragOver={(e) => e.preventDefault()} onDrop={() => drop(st)} className={cx('flex min-h-64 flex-col gap-2 rounded-lg bg-black/[0.03] p-2 dark:bg-white/[0.03]', dragging != null && 'outline-2 outline-dashed outline-primary/20')}>
                  <div className="flex items-center justify-between px-1 py-1 text-caption font-semibold tracking-wider text-muted uppercase">{label(st)}<span>{items.length}</span></div>
                  {items.map((a) => (
                    <Link key={a.id} to={`/applications/${a.id}`} draggable onDragStart={() => setDragging(a.id)} onDragEnd={() => setDragging(null)} className="cursor-grab rounded-md border border-line bg-surface px-3 py-2 transition-shadow hover:shadow-nav active:cursor-grabbing">
                      <div className="text-body-sm leading-snug font-medium">{a.jobSnapshot.title}</div>
                      <div className="text-caption text-muted">{a.jobSnapshot.company}</div>
                      <div className="mt-1.5 flex flex-wrap gap-1">{a.jobSnapshot.isDemo && <DemoBadge />}{a.outcome && <Pill tone={a.outcome === 'accepted' ? 'green' : 'red'}>{label(a.outcome)}</Pill>}{a.roundCount > 0 && <Pill>{a.roundCount} round(s)</Pill>}</div>
                      {a.nextAction && <div className="mt-1.5 text-caption text-primary">→ {a.nextAction.title}</div>}
                    </Link>
                  ))}
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-caption text-muted">Drag cards between columns. Moving to Closed asks for an outcome. Keyboard users can change the stage on the application page.</p>
        </div>
      )}
      {q.data && q.data.length > 0 && view === 'table' && (
        <Card padded={false} className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-body-sm">
            <thead><tr className="border-b border-line text-left text-caption text-muted"><th className="px-5 py-2 font-medium">Job</th><th className="px-3 font-medium">Stage</th><th className="px-3 font-medium">Applied</th><th className="px-3 font-medium">CV version</th><th className="px-3 font-medium">Follow-up</th><th className="px-5 font-medium">Next action</th></tr></thead>
            <tbody>{q.data.map((a) => (
              <tr key={a.id} className="border-b border-line last:border-0">
                <td className="px-5 py-2.5"><Link to={`/applications/${a.id}`} className="font-medium hover:text-primary">{a.jobSnapshot.title}</Link><div className="text-caption text-muted">{a.jobSnapshot.company} {a.jobSnapshot.isDemo && '· demo'}</div></td>
                <td className="px-3"><Pill>{label(a.stage)}</Pill>{a.outcome && <span className="ml-1 text-caption text-muted">{label(a.outcome)}</span>}</td>
                <td className="px-3">{fmtDate(a.appliedAt)}</td>
                <td className="px-3 text-caption">{a.resumeLabel ?? <span className="text-faint">none</span>}</td>
                <td className="px-3">{fmtDate(a.followUpAt)}</td>
                <td className="px-5 text-caption text-primary">{a.nextAction?.title}</td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      )}
      {view === 'analytics' && <AnalyticsView />}
      <CloseModal target={closing} onClose={() => setClosing(null)} />
    </>
  );
}

function AnalyticsView() {
  const q = useQuery({ queryKey: ['applications', 'analytics'], queryFn: () => api.get<Analytics>('/applications/analytics') });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  const a = q.data!;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card><Stat label="Tracked" value={a.total} hint={a.demoJobs ? `${a.demoJobs} on demo jobs` : undefined} /></Card>
        <Card><Stat label="Response rate" value={a.responseRate != null ? `${a.responseRate}%` : '—'} hint="reached screening or later" /></Card>
        <Card><Stat label="Median days to response" value={a.medianDaysToResponse != null ? a.medianDaysToResponse.toFixed(1) : '—'} /></Card>
        <Card><Stat label="Offers" value={a.funnel.find((f) => f.stage === 'offer')?.count ?? 0} /></Card>
      </div>
      <Card>
        <div className="mb-2 text-body-sm font-medium">Funnel</div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={a.funnel.map((f) => ({ name: label(f.stage), value: f.count }))} margin={{ left: -16 }}>
            <CartesianGrid vertical={false} stroke="var(--cp-line)" />
            <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'var(--cp-muted)' }} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'var(--cp-muted)' }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: 'var(--cp-surface)', border: '1px solid var(--cp-line)', borderRadius: 8, fontSize: 12 }} cursor={{ fill: 'rgba(0,117,222,0.06)' }} />
            <Bar dataKey="value" name="Applications" fill="#0075de" radius={[4, 4, 0, 0]} maxBarSize={40} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card><div className="mb-2 text-body-sm font-medium">Outcomes</div><div className="flex flex-wrap gap-2">{a.byOutcome.map((o) => <Pill key={o.outcome}>{label(o.outcome)}: {o.count}</Pill>)}</div></Card>
        <Card><div className="mb-2 text-body-sm font-medium">By source</div><div className="flex flex-wrap gap-2">{a.bySource.map((o) => <Pill key={o.source}>{o.source}: {o.count}</Pill>)}</div></Card>
      </div>
    </div>
  );
}
