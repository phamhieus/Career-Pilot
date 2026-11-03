import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button, ButtonLink, Card, cx, DemoBadge, ErrorState, Field, fmtDate, Input, label, Loading, Notice, PageHeader, Pill, Section, Select, Textarea } from '../components/ui';
import { AiSuggestions } from '../components/AiSuggestions';
import { api } from '../lib/api';
import { useAction } from '../lib/hooks';
import { STAGES } from '../lib/types';
import { CloseModal, useStageChange } from './Applications';

interface Detail {
  application: { id: number; stage: string; outcome: string | null; appliedAt: string | null; source: string; notes: string; contacts: { name: string; role?: string; email?: string; note?: string }[]; followUpAt: string | null; resumeVersionId: number | null; jobSnapshot: { title: string; company: string; url: string | null; location: string | null; description: string; requiredSkills: string[]; capturedAt: string; isDemo: boolean } };
  events: { id: number; type: string; fromStage: string | null; toStage: string | null; note: string; at: string }[];
  rounds: { id: number; name: string; type: string; scheduledAt: string | null; status: string; notes: string; practiceSessionId: number | null }[];
  resume: { versionId: number; versionNo: number; resumeId: number; title: string } | null;
  job: { id: number; title: string; company: string; status: string; isDemo: boolean; url: string | null } | null;
  match: { score: number | null; criticalGaps: { label: string; reason: string }[]; evidenceCoverage: number } | null;
  interviewSessions: { id: number; status: string; roundType: string; createdAt: string }[];
  nextActions: { priority: number; title: string; detail: string; link?: string }[];
}
interface ResumeRow { id: number; title: string; currentVersionId: number; versionNo: number }

export default function ApplicationDetail() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['application', id], queryFn: () => api.get<Detail>(`/applications/${id}`) });
  const resumes = useQuery({ queryKey: ['resumes'], queryFn: () => api.get<ResumeRow[]>('/resumes') });
  const inv = [['application', id], ['applications'], ['dashboard']];
  const change = useStageChange();
  const [closing, setClosing] = useState<{ id: number } | null>(null);
  const patch = useAction((body: object) => api.patch(`/applications/${id}`, body), inv);
  const addNote = useAction((note: string) => api.post(`/applications/${id}/notes`, { note }), inv, () => setNoteText(''));
  const addRound = useAction((body: object) => api.post(`/applications/${id}/rounds`, body), inv, () => setRound({ name: '', type: 'technical', scheduledAt: '' }));
  const updRound = useAction(({ rid, body }: { rid: number; body: object }) => api.patch(`/applications/${id}/rounds/${rid}`, body), inv);
  const [noteText, setNoteText] = useState('');
  const [round, setRound] = useState({ name: '', type: 'technical', scheduledAt: '' });
  const [notes, setNotes] = useState('');
  const [contacts, setContacts] = useState<Detail['application']['contacts']>([]);
  useEffect(() => { if (q.data) { setNotes(q.data.application.notes); setContacts(q.data.application.contacts); } }, [q.data]);
  if (q.isLoading) return <Loading rows={5} />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const d = q.data!;
  const a = d.application;
  const stageIdx = STAGES.indexOf(a.stage as (typeof STAGES)[number]);

  return (
    <>
      <Link to="/applications" className="mb-4 inline-flex items-center gap-1 text-body-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Tracker</Link>
      <PageHeader eyebrow={<span className="flex items-center gap-2">{a.jobSnapshot.company}{a.jobSnapshot.isDemo && <DemoBadge />}</span>} title={a.jobSnapshot.title} subtitle={`Source: ${a.source} · saved snapshot ${fmtDate(a.jobSnapshot.capturedAt)}${a.appliedAt ? ` · applied ${fmtDate(a.appliedAt)}` : ''}`}
        actions={<>{d.job && <ButtonLink to={`/jobs/${d.job.id}`} variant="ghost">Job & match</ButtonLink>}{a.jobSnapshot.url && <ButtonLink to={a.jobSnapshot.url} external variant="text" icon={<ExternalLink className="size-4" />}>Original posting</ButtonLink>}</>} />

      <Card className="mb-6">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Stage">
          {STAGES.map((st, i) => (
            <button key={st} disabled={change.isPending} onClick={() => (st === 'closed' ? setClosing({ id: a.id }) : st !== a.stage && change.mutate({ id: a.id, stage: st }))} className={cx('rounded-full px-3 py-1 text-body-sm font-medium transition-colors', st === a.stage ? 'bg-primary text-white' : i < stageIdx ? 'bg-sky-tint text-primary-ink dark:bg-primary-soft dark:text-primary' : 'bg-black/[0.04] text-muted hover:text-ink dark:bg-white/5')}>{label(st)}</button>
          ))}
          {a.outcome && <Pill tone={a.outcome === 'accepted' ? 'green' : 'red'} className="ml-2">Outcome: {label(a.outcome)}</Pill>}
        </div>
        {change.error && <p className="mt-2 text-body-sm text-vermillion">{(change.error as Error).message}</p>}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0">
          <Section title="Recommended next actions" description="Rule-based from your stage, dates, rounds and job match. Nothing is sent externally.">
            <div className="flex flex-col gap-2">
              {d.nextActions.length === 0 && <Card><p className="text-body-sm text-muted">No actions right now.</p></Card>}
              {d.nextActions.map((n) => (
                <Card key={n.title} className="flex items-start gap-3 p-4">
                  <ArrowRight className="mt-0.5 size-4 text-primary" />
                  <div className="flex-1"><div className="font-medium">{n.title}</div><div className="text-body-sm text-ink-2">{n.detail}</div></div>
                  {n.link && (n.link.startsWith('http') ? <ButtonLink to={n.link} external variant="ghost">Open</ButtonLink> : <ButtonLink to={n.link} variant="ghost">Go</ButtonLink>)}
                </Card>
              ))}
            </div>
          </Section>

          <div className="mb-10"><AiSuggestions url={`/applications/${a.id}/suggestions`} title="AI-recommended next actions" /></div>

          <Section title="Interview rounds">
            <Card padded={false}>
              {d.rounds.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
                  <div className="flex-1"><div className="font-medium">{r.name}</div><div className="text-caption text-muted">{label(r.type)} · {r.scheduledAt ? fmtDate(r.scheduledAt) : 'date TBD'}</div></div>
                  <Select aria-label="Round status" className="w-36" value={r.status} onChange={(e) => updRound.mutate({ rid: r.id, body: { status: e.target.value } })}>{['scheduled', 'completed', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}</Select>
                  <Select aria-label="Linked practice session" className="w-48" value={r.practiceSessionId ?? ''} onChange={(e) => updRound.mutate({ rid: r.id, body: { practiceSessionId: e.target.value ? Number(e.target.value) : null } })}><option value="">No practice linked</option>{d.interviewSessions.map((s) => <option key={s.id} value={s.id}>Mock #{s.id} · {label(s.roundType)} · {s.status}</option>)}</Select>
                  {r.practiceSessionId && <Link to={`/interviews/${r.practiceSessionId}`} className="text-caption text-primary">report</Link>}
                </div>
              ))}
              <form className="grid gap-2 px-5 py-3 md:grid-cols-[1fr_160px_180px_auto]" onSubmit={(e) => { e.preventDefault(); addRound.mutate({ name: round.name, type: round.type, scheduledAt: round.scheduledAt || null }); }}>
                <Input aria-label="Round name" required placeholder="e.g. Technical interview" value={round.name} onChange={(e) => setRound({ ...round, name: e.target.value })} />
                <Select aria-label="Round type" value={round.type} onChange={(e) => setRound({ ...round, type: e.target.value })}>{['hr', 'technical', 'case', 'system_design', 'assessment', 'leadership', 'other'].map((t) => <option key={t} value={t}>{label(t)}</option>)}</Select>
                <Input aria-label="Date" type="date" value={round.scheduledAt} onChange={(e) => setRound({ ...round, scheduledAt: e.target.value })} />
                <Button variant="ghost" type="submit" icon={<Plus className="size-4" />} loading={addRound.isPending}>Add</Button>
              </form>
            </Card>
            {d.job && <div className="mt-2"><ButtonLink to={`/interviews/new?jobId=${d.job.id}&mode=job_specific`} variant="text">Practice a job-specific mock interview →</ButtonLink></div>}
          </Section>

          <Section title="Timeline">
            <ol className="relative flex flex-col gap-4 border-l border-line pl-5">
              {d.events.map((e) => (
                <li key={e.id} className="relative"><span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full bg-signal-blue" />
                  <div className="text-body-sm"><span className="font-medium">{label(e.type)}</span>{e.fromStage && e.toStage && <span className="text-ink-2"> · {label(e.fromStage)} → {label(e.toStage)}</span>}</div>
                  {e.note && <div className="text-body-sm text-ink-2">{e.note}</div>}
                  <div className="text-caption text-muted">{new Date(e.at).toLocaleString()}</div>
                </li>
              ))}
            </ol>
            <div className="mt-4 flex gap-2"><Input aria-label="Add a note to the timeline" placeholder="Add a timeline note…" value={noteText} onChange={(e) => setNoteText(e.target.value)} /><Button variant="ghost" disabled={!noteText.trim()} loading={addNote.isPending} onClick={() => addNote.mutate(noteText)}>Add</Button></div>
          </Section>
        </div>

        <aside className="flex flex-col gap-4">
          <Card>
            <div className="mb-2 font-semibold">CV submitted</div>
            {d.resume ? <Link to={`/resume/${d.resume.resumeId}`} className="text-body-sm font-medium text-primary">{d.resume.title} · v{d.resume.versionNo}</Link> : <p className="text-body-sm text-muted">No CV version attached.</p>}
            <Select aria-label="Attach CV version" className="mt-3" value={a.resumeVersionId ?? ''} onChange={(e) => e.target.value && patch.mutate({ resumeVersionId: Number(e.target.value) })}>
              <option value="">Attach a CV version…</option>
              {resumes.data?.map((r) => <option key={r.id} value={r.currentVersionId}>{r.title} (v{r.versionNo})</option>)}
            </Select>
            {stageIdx >= 1 && <p className="mt-2 text-caption text-muted">Changing the CV after applying is logged; the employer still has what you originally sent.</p>}
            {!d.resume && d.job && <ButtonLink to={`/resume?jobId=${d.job.id}`} variant="text" className="mt-2 px-0">Create a tailored CV →</ButtonLink>}
          </Card>
          {d.match && (
            <Card>
              <div className="mb-1 font-semibold">Match snapshot</div>
              <div className="text-[28px] font-semibold">{d.match.score ?? 'Unknown'}</div>
              <div className="text-caption text-muted">{Math.round(d.match.evidenceCoverage * 100)}% evidence coverage</div>
              {d.match.criticalGaps.length > 0 && <Notice tone="warn" className="mt-3">Critical gaps: {d.match.criticalGaps.map((g) => g.label).join(', ')}</Notice>}
            </Card>
          )}
          <Card>
            <div className="mb-2 font-semibold">Follow-up reminder</div>
            <Input type="date" aria-label="Follow-up date" value={a.followUpAt ?? ''} onChange={(e) => patch.mutate({ followUpAt: e.target.value || null })} />
            <p className="mt-1 text-caption text-muted">Shown on your dashboard when due. No emails are sent.</p>
          </Card>
          <Card>
            <div className="mb-2 font-semibold">Notes</div>
            <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="mt-3 mb-2 font-semibold">Contacts</div>
            {contacts.map((c, i) => (
              <div key={i} className="mb-2 grid grid-cols-[1fr_1fr_auto] gap-2">
                <Input aria-label="Contact name" placeholder="Name" value={c.name} onChange={(e) => setContacts(contacts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <Input aria-label="Contact role" placeholder="Role / email" value={c.role ?? ''} onChange={(e) => setContacts(contacts.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} />
                <button aria-label="Remove contact" onClick={() => setContacts(contacts.filter((_, j) => j !== i))} className="p-1 text-faint hover:text-vermillion"><Trash2 className="size-4" /></button>
              </div>
            ))}
            <div className="flex justify-between"><Button variant="text" className="px-0" onClick={() => setContacts([...contacts, { name: '' }])} icon={<Plus className="size-3.5" />}>Contact</Button><Button variant="ghost" loading={patch.isPending} onClick={() => patch.mutate({ notes, contacts: contacts.filter((c) => c.name.trim()) })}>Save</Button></div>
          </Card>
          <Field label="Job snapshot (as saved)"><Textarea rows={6} readOnly value={a.jobSnapshot.description || '(no JD text at source)'} className="text-caption" /></Field>
        </aside>
      </div>
      <CloseModal target={closing} onClose={() => setClosing(null)} />
    </>
  );
}
