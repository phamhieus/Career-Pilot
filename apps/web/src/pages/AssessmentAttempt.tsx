import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button, ButtonLink, Card, cx, ErrorState, Loading, Notice, PageHeader, Pill, SkillStatusPill } from '../components/ui';
import { VoiceTextarea } from '../components/VoiceTextarea';
import { api } from '../lib/api';
import { useAction } from '../lib/hooks';

interface Item { id: number; skillSlug: string; type: string; difficulty: number; prompt: string; options: string[] | null; rubricCriteria: string[] | null; correctIndex?: number | null; explanation?: string }
interface Evaluation { score: number; passed: boolean; feedback: string; uncertainties: string[]; perItem: { itemId: number; score: number; correct?: boolean; method: string; feedback: string; criteria?: { criterion: string; score: number; comment: string }[] }[]; perSkill: { skillSlug: string; score: number; passed: boolean; newStatus: string; observedLevel: number }[] }
interface AttemptView { attempt: { id: number; status: string; answers: Record<string, { choice?: number; text?: string }> }; blueprint: { title: string; rationale: string; targetLevel: number }; items: Item[]; evaluation: Evaluation | null }

export default function AssessmentAttempt() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['attempt', id], queryFn: () => api.get<AttemptView>(`/assessments/attempts/${id}`) });
  const [answers, setAnswers] = useState<Record<string, { choice?: number; text?: string }>>({});
  const submit = useAction(() => api.post<{ planRevisions: { planId: number; summary: string }[] }>(`/assessments/attempts/${id}/submit`, { answers }), [['attempt', id], ['assessments'], ['profile'], ['matching'], ['dashboard'], ['roadmap'], ['learning']]);
  if (q.isLoading) return <Loading rows={4} />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const { blueprint, items, evaluation, attempt } = q.data!;
  const graded = attempt.status === 'graded';
  const shown = graded ? attempt.answers : answers;
  const answered = items.filter((i) => (i.type === 'mcq' ? shown[i.id]?.choice != null : (shown[i.id]?.text ?? '').trim().length >= 20)).length;

  return (
    <>
      <Link to="/assessments" className="mb-4 inline-flex items-center gap-1 text-body-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Assessments</Link>
      <PageHeader eyebrow={`Attempt #${attempt.id} · target level ${blueprint.targetLevel}`} title={blueprint.title} subtitle={blueprint.rationale} />

      {evaluation && (
        <Card className="mb-8">
          <div className="flex flex-wrap items-center gap-4">
            {evaluation.passed ? <CheckCircle2 className="size-8 text-teal" /> : <XCircle className="size-8 text-coral" />}
            <div><div className="text-[32px] leading-none font-semibold">{Math.round(evaluation.score * 100)}%</div><div className="text-body-sm text-muted">{evaluation.passed ? 'Passed' : 'Not yet passed'} — 70% on both quiz and practical is required</div></div>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {evaluation.perSkill.map((s) => <div key={s.skillSlug} className="rounded-md border border-line p-3"><div className="flex items-center justify-between"><span className="font-medium">{s.skillSlug}</span><SkillStatusPill status={s.newStatus} /></div><div className="text-caption text-muted">{Math.round(s.score * 100)}% · observed level {s.observedLevel}</div></div>)}
          </div>
          {evaluation.uncertainties.length > 0 && <Notice tone="warn" className="mt-4"><ul className="flex flex-col gap-1">{evaluation.uncertainties.map((u) => <li key={u}>{u}</li>)}</ul></Notice>}
          {submit.data?.planRevisions?.length ? <Notice className="mt-4">Your learning plan was updated: {submit.data.planRevisions.map((r) => r.summary).join(' ')} <Link className="font-medium underline" to={`/learning/${submit.data.planRevisions[0].planId}`}>Open plan</Link></Notice> : null}
          <div className="mt-4 flex gap-2"><ButtonLink to="/profile" variant="ghost">See evidence on profile</ButtonLink><ButtonLink to="/learning" variant="text">Learning plan</ButtonLink></div>
        </Card>
      )}

      <div className="flex flex-col gap-4">
        {items.map((it, idx) => {
          const res = evaluation?.perItem.find((p) => p.itemId === it.id);
          return (
            <Card key={it.id}>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-caption text-muted"><span className="font-semibold text-ink">Q{idx + 1}</span><Pill>{it.type.replace('_', ' ')}</Pill><Pill>{it.skillSlug}</Pill><span>difficulty {it.difficulty}/5</span>{res && <Pill tone={res.score >= 0.7 ? 'green' : 'red'}>{Math.round(res.score * 100)}% · {res.method.replace('_', ' ')}</Pill>}</div>
              <p className="mb-4 whitespace-pre-wrap font-medium">{it.prompt}</p>
              {it.type === 'mcq' && it.options ? (
                <div role="radiogroup" className="flex flex-col gap-2">
                  {it.options.map((o, oi) => {
                    const chosen = shown[it.id]?.choice === oi;
                    const correct = graded && it.correctIndex === oi;
                    return (
                      <label key={oi} className={cx('flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-body-sm transition-colors', correct ? 'border-teal bg-teal/10' : chosen && graded ? 'border-coral bg-coral/10' : chosen ? 'border-primary bg-primary-soft' : 'border-line hover:border-primary/40')}>
                        <input type="radio" name={`q${it.id}`} className="mt-0.5" disabled={graded} checked={chosen} onChange={() => setAnswers({ ...answers, [it.id]: { choice: oi } })} />{o}
                      </label>
                    );
                  })}
                  {graded && it.explanation && <p className="text-body-sm text-ink-2">{it.explanation}</p>}
                </div>
              ) : (
                <>
                  {it.rubricCriteria && <div className="mb-2 flex flex-wrap gap-1.5 text-caption">Graded on: {it.rubricCriteria.map((c) => <Pill key={c}>{c}</Pill>)}</div>}
                  <VoiceTextarea value={shown[it.id]?.text ?? ''} onChange={(v) => setAnswers({ ...answers, [it.id]: { text: v } })} disabled={graded} rows={7} placeholder="Explain your approach, decisions and how you'd verify it…" />
                  {res && <div className="mt-3 rounded-md bg-surface-2 p-3 text-body-sm"><p>{res.feedback}</p>{res.criteria && <ul className="mt-2 flex flex-col gap-1 text-caption">{res.criteria.map((c) => <li key={c.criterion}><b>{c.criterion}</b> {c.score}/4 — {c.comment}</li>)}</ul>}</div>}
                </>
              )}
            </Card>
          );
        })}
      </div>
      {!graded && (
        <div className="sticky bottom-4 mt-6 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-5 py-3 shadow-mockup">
          <span className="text-body-sm text-muted">{answered}/{items.length} answered</span>
          {submit.error && <span className="text-body-sm text-vermillion">{(submit.error as Error).message}</span>}
          <Button variant="primary" loading={submit.isPending} onClick={() => submit.mutate(undefined)} disabled={answered === 0}>Submit for grading</Button>
        </div>
      )}
    </>
  );
}
