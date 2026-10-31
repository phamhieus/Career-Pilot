import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, Flag, Play, Quote, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { AccentCard, AiMetaNote, Button, ButtonLink, Card, cx, DemoBadge, ErrorState, Field, Input, label, Loading, Notice, PageHeader, Pill, ScoreBar, Section, Select, Textarea } from '../components/ui';
import { VoiceTextarea } from '../components/VoiceTextarea';
import { api } from '../lib/api';
import { useAction, useMeta } from '../lib/hooks';

interface Msg { id: number; seq: number; speaker: 'interviewer' | 'candidate'; kind: string; content: string; topicKey: string | null; difficulty: number | null; inputMode: string | null; rubricCriteria: string[] | null; idealPoints: string[] | null; generatedBy: string | null; options: { maxSelect: number; choices: { key: string; label: string }[] } | null; choices: string[] | null; evaluation: { score: number; criteria: { criterion: string; score: number; comment: string }[]; strengths: string[]; gaps: string[]; evidenceQuotes: string[]; method: string } | null }
interface Topic { key: string; label: string; kind: string; priority: number; reason: string; covered: boolean; followUps: number }
interface Report { overallScore: number; rubricBreakdown: { criterion: string; score: number }[]; strengths: string[]; weaknesses: string[]; questionFeedback: { question: string; answerExcerpt: string; score: number; feedback: string; quotes: string[]; topic: string }[]; improvements: string[]; learningTasks: { skillSlug: string; title: string }[]; comparison: { previousSessionId: number; previousScore: number; delta: number } | null; coaching: { summary: string; improvements: string[]; questionTips: { index: number; tip: string; betterStructure: string }[]; nextFocus: string[]; generatedBy: string } | null; profileSuggestions: { interests: string[]; workValues: string[]; taskAffinity: Record<string, number>; goals: string; constraints: string[]; generatedBy: string } | null; caveats: string[] }
interface Detail { session: { id: number; mode: string; status: string; roundType: string; seniority: string; language: string; durationMinutes: number; answerMode: 'text' | 'voice'; startedAt: string | null; currentDifficulty: number; blueprint: { topics: Topic[]; maxMainQuestions: number; context: { roleName: string; jobTitle?: string; background?: Background } } }; role: { slug: string; name: string } | null; job: { id: number; title: string; company: string; isDemo: boolean } | null; messages: Msg[]; report: Report | null; ai: { configured: boolean; provider: string; model: string | null } }

export default function InterviewSession() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['interview', id], queryFn: () => api.get<Detail>(`/interviews/${id}`) });
  const [answer, setAnswer] = useState('');
  const [choices, setChoices] = useState<string[]>([]);
  const [inputMode, setInputMode] = useState<'text' | 'voice'>('text');
  const [lastFeedback, setLastFeedback] = useState<Msg['evaluation'] | null>(null);
  const current = q.data && [...q.data.messages].reverse().find((m) => m.speaker === 'interviewer');
  const inv = [['interview', id], ['interviews'], ['profile'], ['dashboard']];
  const start = useAction((background?: Background) => api.post(`/interviews/${id}/start`, { background }), inv);
  const send = useAction(() => api.post<{ feedback: Msg['evaluation'] | null }>(`/interviews/${id}/answer`, { content: answer, inputMode, choices: current?.options ? choices : undefined }), inv, (r) => setLastFeedback(r.feedback));
  // Clear the answer as soon as the next question arrives — not after the refetch, which would wipe text typed in between.
  useEffect(() => { setAnswer(''); setChoices([]); }, [current?.id]);
  const finish = useAction(() => api.post(`/interviews/${id}/finish`), inv);
  const abandon = useAction(() => api.post(`/interviews/${id}/abandon`), inv);
  if (q.isLoading) return <Loading rows={4} />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const d = q.data!;
  const s = d.session;
  const awaiting = s.status === 'in_progress' && d.messages.at(-1)?.speaker === 'interviewer';
  const asked = d.messages.filter((m) => m.kind === 'question').length;
  const discovery = s.mode === 'discovery';
  const title = discovery ? 'Career discovery' : `${label(s.roundType)} interview`;

  return (
    <>
      <Link to="/interviews" className="mb-4 inline-flex items-center gap-1 text-body-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Interviews</Link>
      <PageHeader eyebrow={<span className="flex items-center gap-2">{d.role?.name ?? 'Discovery'}{d.job && <> · {d.job.title} — {d.job.company} {d.job.isDemo && <DemoBadge />}</>}</span>} title={title} subtitle={discovery ? `Multiple choice · ${s.language === 'vi' ? 'Tiếng Việt' : 'English'}` : `${s.seniority} · ${s.durationMinutes} min · ${s.language === 'vi' ? 'Tiếng Việt' : 'English'} · ${s.answerMode} answers`}
        actions={s.status === 'in_progress' && <><Button variant="text" icon={<Flag className="size-4" />} loading={finish.isPending} onClick={() => finish.mutate(undefined)}>End & get report</Button><Button variant="text" onClick={() => window.confirm('Abandon this session?') && abandon.mutate(undefined)}>Abandon</Button></>} />

      {s.status === 'planned' && discovery && <BackgroundStep starting={start.isPending} error={start.error as Error | null} onStart={(b) => start.mutate(b)} />}

      {s.status === 'planned' && !discovery && (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card>
            <div className="mb-1 text-heading-sm font-semibold">Interview blueprint</div>
            <p className="mb-4 text-body-sm text-ink-2">Up to {s.blueprint.maxMainQuestions} main questions, highest priority first. Weak answers may get one follow-up; difficulty adapts to your answers.</p>
            <ol className="flex flex-col gap-2">{s.blueprint.topics.map((t, i) => <li key={t.key} className="flex items-center gap-3 rounded-md border border-line px-3 py-2"><span className="text-caption text-muted">{i + 1}</span><span className="flex-1 font-medium">{t.label}</span><Pill>{label(t.kind)}</Pill><span className="hidden text-caption text-muted md:inline">{t.reason}</span></li>)}</ol>
          </Card>
          <AccentCard tone="marigold" className="h-fit">
            <div className="mb-2 font-semibold">Before you start</div>
            <ul className="mb-4 flex list-disc flex-col gap-1 pl-5 text-body-sm"><li>Answer as you would in a real interview.</li><li>Model answers stay hidden until the end.</li><li>Use concrete examples: what <i>you</i> did and the result.</li></ul>
            <Button variant="primary" icon={<Play className="size-4" />} loading={start.isPending} onClick={() => start.mutate(undefined)}>Start interview</Button>
            {start.error && <p className="mt-2 text-body-sm">{(start.error as Error).message}</p>}
          </AccentCard>
        </div>
      )}

      {s.status === 'in_progress' && current && (
        <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
          <div>
            <Card className="mb-4">
              <div className="mb-3 flex flex-wrap items-center gap-2 text-caption text-muted">
                <Pill tone={current.kind === 'follow_up' ? 'yellow' : 'blue'}>{current.kind === 'follow_up' ? 'Follow-up' : `Question ${asked}`}</Pill>
                <span>{s.blueprint.topics.find((t) => t.key === current.topicKey)?.label}</span>{current.difficulty != null && <span>· difficulty {current.difficulty}/5</span>}
                {!current.options && <span className="ml-auto"><AiMetaNote meta={current.generatedBy?.startsWith('ai') ? { mode: 'ai', provider: current.generatedBy.slice(3) } : { mode: 'heuristic', provider: 'heuristic' }} /></span>}
              </div>
              <p className="font-serif text-[20px] leading-[1.5]">{current.content}</p>
              {current.rubricCriteria && <div className="mt-3 flex flex-wrap gap-1.5 text-caption text-muted">You’ll be assessed on: {current.rubricCriteria.map((c) => <Pill key={c}>{c}</Pill>)}</div>}
            </Card>
            {awaiting && current.options && (
              <Card>
                <ChoiceList options={current.options} value={choices} onChange={setChoices} />
                <details className="mt-4"><summary className="cursor-pointer text-caption text-muted">Add an example or note (optional)</summary><Textarea aria-label="Note" className="mt-2 min-h-16" rows={2} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Anything to add? (optional)" /></details>
                {send.error && <p className="mt-2 text-body-sm text-vermillion">{(send.error as Error).message}</p>}
                <div className="mt-3 flex items-center justify-between"><span className="text-caption text-muted">{current.options.maxSelect > 1 ? `${choices.length}/${current.options.maxSelect} selected` : 'Pick one'}</span><Button variant="primary" loading={send.isPending} disabled={!choices.length} onClick={() => send.mutate(undefined)}>Next</Button></div>
              </Card>
            )}
            {awaiting && !current.options && (
              <Card>
                <VoiceTextarea value={answer} onChange={setAnswer} language={s.language} rows={8} onModeChange={setInputMode} placeholder="Type or dictate your answer…" />
                {send.error && <p className="mt-2 text-body-sm text-vermillion">{(send.error as Error).message}</p>}
                <div className="mt-3 flex items-center justify-between"><span className="text-caption text-muted">{answer.trim().split(/\s+/).filter(Boolean).length} words</span><Button variant="primary" loading={send.isPending} disabled={answer.trim().length < 2} onClick={() => send.mutate(undefined)}>Submit answer</Button></div>
              </Card>
            )}
            {lastFeedback && s.mode === 'focused' && (
              <Card className="mt-4"><div className="mb-2 font-semibold">Feedback on your last answer · {Math.round(lastFeedback.score * 100)}%</div><ul className="flex flex-col gap-1 text-body-sm">{lastFeedback.criteria.map((c) => <li key={c.criterion}><b>{c.criterion}</b> {c.score}/4 — {c.comment}</li>)}</ul></Card>
            )}
          </div>
          <TopicProgress topics={s.blueprint.topics} />
        </div>
      )}

      {(s.status === 'completed' || s.status === 'abandoned') && <ReportView d={d} />}
    </>
  );
}

interface Background { situation: 'student' | 'tech' | 'non_tech' | 'break'; currentRoleSlug?: string | null; currentTitle?: string; yearsExperience?: number | null; education?: string; summary?: string }
const SITUATIONS: [Background['situation'], string][] = [['student', 'Student or recent graduate'], ['tech', 'Working in tech'], ['non_tech', 'Working outside tech'], ['break', 'Between jobs or on a career break']];
const EDUCATION: [string, string][] = [['', 'Prefer not to say'], ['cs', 'Computer science / IT'], ['stem', 'Other STEM'], ['business', 'Business / economics'], ['design', 'Design / arts'], ['social', 'Social sciences / humanities'], ['self_taught', 'Self-taught / bootcamp'], ['other', 'Other']];

/** Discovery starts from where the person is today; it is saved to the profile so matching can use it. */
function BackgroundStep({ starting, error, onStart }: { starting: boolean; error: Error | null; onStart: (b: Background) => void }) {
  const meta = useMeta();
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api.get<{ profile: { currentRoleSlug: string | null; yearsExperience: number | null; headline: string; summary: string } }>('/profile') });
  const [b, setB] = useState<Background | null>(null);
  if (profile.isLoading) return <Loading rows={3} />;
  const p = profile.data?.profile;
  const v: Background = b ?? { situation: p?.currentRoleSlug ? 'tech' : 'non_tech', currentRoleSlug: p?.currentRoleSlug ?? null, currentTitle: p?.headline ?? '', yearsExperience: p?.yearsExperience ?? null, education: '', summary: p?.summary ?? '' };
  const set = (patch: Partial<Background>) => setB({ ...v, ...patch });
  const working = v.situation === 'tech' || v.situation === 'non_tech';
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card>
        <div className="mb-1 text-heading-sm font-semibold">Your background</div>
        <p className="mb-4 text-body-sm text-ink-2">Start from where you are today. This is saved to your profile so role matching can count what transfers.</p>
        <div className="mb-1.5 text-body-sm font-medium">Current situation</div>
        <div role="radiogroup" aria-label="Current situation" className="mb-5 grid gap-2 sm:grid-cols-2">
          {SITUATIONS.map(([key, text]) => (
            <label key={key} className={cx('flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-body-sm transition-colors', v.situation === key ? 'border-primary bg-primary-soft' : 'border-line hover:border-primary/40')}>
              <input type="radio" name="situation" checked={v.situation === key} onChange={() => set({ situation: key })} />{text}
            </label>
          ))}
        </div>
        <details><summary className="mb-3 cursor-pointer text-body-sm font-medium text-primary">Optional background details</summary><div className="grid gap-4 md:grid-cols-2">
          {v.situation === 'tech' && <Field label="Current or most recent tech role"><Select value={v.currentRoleSlug ?? ''} onChange={(e) => set({ currentRoleSlug: e.target.value || null })}><option value="">Not listed</option>{meta.data?.roles.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}</Select></Field>}
          <Field label={working ? 'Job title' : v.situation === 'student' ? 'What you study' : 'Most recent job title'}><Input value={v.currentTitle ?? ''} maxLength={120} onChange={(e) => set({ currentTitle: e.target.value })} placeholder={v.situation === 'student' ? 'e.g. Final-year IT student' : 'e.g. Accountant, Backend developer'} /></Field>
          <Field label="Years of work experience"><Input type="number" min={0} max={50} step={0.5} value={v.yearsExperience ?? ''} onChange={(e) => set({ yearsExperience: e.target.value === '' ? null : Math.min(50, Math.max(0, Number(e.target.value))) })} /></Field>
          <Field label="Education"><Select value={v.education ?? ''} onChange={(e) => set({ education: e.target.value })}>{EDUCATION.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</Select></Field>
          <Field label="In a few sentences: what have you done so far?" hint="Optional. Projects, responsibilities, tools you used." className="md:col-span-2"><Textarea rows={3} maxLength={1500} value={v.summary ?? ''} onChange={(e) => set({ summary: e.target.value })} /></Field>
        </div></details>
      </Card>
      <AccentCard tone="marigold" className="h-fit">
        <div className="mb-2 font-semibold">Then 8 quick questions</div>
        <p className="mb-3 text-body-sm">Mostly tap to choose. No typing is required. We only ask a follow-up if your answer needs clarification.</p>
        <ul className="mb-4 flex list-disc flex-col gap-1 pl-5 text-body-sm"><li>There are no right answers and no score.</li><li>Pick what fits you today; add a note if an option misses something.</li><li>You review the suggestions before anything changes on your preferences.</li></ul>
        <Button variant="primary" icon={<Play className="size-4" />} loading={starting} onClick={() => onStart({ ...v, currentRoleSlug: v.situation === 'tech' ? v.currentRoleSlug : null, currentTitle: v.currentTitle?.trim(), summary: v.summary?.trim() })}>Continue</Button>
        {error && <p className="mt-2 text-body-sm">{error.message}</p>}
      </AccentCard>
    </div>
  );
}

function BackgroundSummary({ b }: { b: Background }) {
  const meta = useMeta();
  const role = meta.data?.roles.find((r) => r.slug === b.currentRoleSlug)?.name;
  const facts = [SITUATIONS.find(([k]) => k === b.situation)?.[1], role, b.currentTitle, b.yearsExperience != null ? `${b.yearsExperience} years of experience` : null, b.education ? EDUCATION.find(([k]) => k === b.education)?.[1] : null].filter(Boolean);
  return (
    <Card className="mb-4">
      <div className="mb-2 font-semibold">Your background</div>
      <div className="flex flex-wrap gap-1.5">{facts.map((f) => <Pill key={f}>{f}</Pill>)}</div>
      {b.summary && <p className="mt-2 text-body-sm text-ink-2">{b.summary}</p>}
      <p className="mt-2 text-caption text-muted">Saved to your profile — <Link to="/matching" className="underline">matching</Link> uses it to count transferable skills.</p>
    </Card>
  );
}

function ChoiceList({ options, value, onChange }: { options: NonNullable<Msg['options']>; value: string[]; onChange: (v: string[]) => void }) {
  const single = options.maxSelect === 1;
  const exclusive = (key: string) => ['unsure', 'none', 'no-project'].includes(key);
  const toggle = (key: string) => {
    if (single) { onChange([key]); return; }
    if (value.includes(key)) { onChange(value.filter((k) => k !== key)); return; }
    if (exclusive(key)) { onChange([key]); return; }
    const concrete = value.filter((k) => !exclusive(k));
    if (concrete.length < options.maxSelect) onChange([...concrete, key]);
  };
  return (
    <div role={single ? 'radiogroup' : 'group'} className="grid gap-2 sm:grid-cols-2">
      {options.choices.map((c) => {
        const chosen = value.includes(c.key);
        const full = !single && !chosen && !exclusive(c.key) && value.length >= options.maxSelect;
        return (
          <label key={c.key} className={cx('flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-body-sm transition-colors', chosen ? 'border-primary bg-primary-soft' : 'border-line hover:border-primary/40', full && 'cursor-not-allowed opacity-50')}>
            <input type={single ? 'radio' : 'checkbox'} name="discovery-choice" className="mt-0.5" checked={chosen} disabled={full} onChange={() => toggle(c.key)} />{c.label}
          </label>
        );
      })}
    </div>
  );
}

function TopicProgress({ topics }: { topics: Topic[] }) {
  return (
    <Card className="h-fit">
      <div className="mb-3 text-body-sm font-semibold">Coverage</div>
      <ul className="flex flex-col gap-2">{topics.map((t) => <li key={t.key} className="flex items-center gap-2 text-body-sm"><span className={cx('flex size-4 items-center justify-center rounded-full border', t.covered ? 'border-teal bg-teal text-white' : 'border-line')}>{t.covered && <Check className="size-3" />}</span><span className={cx(t.covered && 'text-muted')}>{t.label}</span></li>)}</ul>
    </Card>
  );
}

function ReportView({ d }: { d: Detail }) {
  const r = d.report;
  const apply = useAction(() => api.post('/profile/apply-discovery', { interests: r?.profileSuggestions?.interests, workValues: r?.profileSuggestions?.workValues, taskAffinity: r?.profileSuggestions?.taskAffinity }), [['profile'], ['matching']]);
  if (!r) return <Notice tone="warn">This session was abandoned before a report was generated.</Notice>;
  const pairs = d.messages.filter((m) => m.speaker === 'interviewer').map((q) => ({ q, a: d.messages.find((m) => m.seq === q.seq + 1) }));
  const questionnaire = pairs.some((p) => p.q.options);
  return (
    <>
      {!questionnaire && <div className="mb-8 grid gap-4 md:grid-cols-3">
        <AccentCard tone="midnight"><div className="text-body-sm text-white/70">Practice score</div><div className="text-[56px] leading-none font-semibold tracking-tight">{Math.round(r.overallScore)}</div>
          {r.comparison && <div className="mt-2 flex items-center gap-1 text-body-sm">{r.comparison.delta >= 0 ? <TrendingUp className="size-4 text-teal" /> : <TrendingDown className="size-4 text-coral" />}{r.comparison.delta >= 0 ? '+' : ''}{r.comparison.delta} vs <Link to={`/interviews/${r.comparison.previousSessionId}`} className="underline">previous comparable session</Link> ({r.comparison.previousScore})</div>}
        </AccentCard>
        <Card className="md:col-span-2"><div className="mb-3 font-semibold">Rubric breakdown</div><div className="grid gap-3 sm:grid-cols-2">{r.rubricBreakdown.map((b) => <div key={b.criterion}><div className="flex justify-between text-body-sm"><span>{b.criterion}</span><span className="text-muted">{b.score}</span></div><ScoreBar value={b.score} className="mt-1" /></div>)}</div></Card>
      </div>}
      {r.caveats.map((c) => <Notice key={c} tone="warn" className="mb-3">{c}</Notice>)}
      {r.coaching && (
        <AccentCard tone="tint" className="mb-8">
          <div className="mb-2 flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-marigold" />AI coaching <span className="text-caption font-normal text-muted">· {r.coaching.generatedBy} · does not change your score</span></div>
          <p className="mb-3 font-serif text-[17px] leading-relaxed">{r.coaching.summary}</p>
          <ul className="mb-3 flex flex-col gap-1 text-body-sm">{r.coaching.improvements.map((i) => <li key={i}>→ {i}</li>)}</ul>
          {r.coaching.nextFocus.length > 0 && <div className="flex flex-wrap items-center gap-1.5 text-body-sm">Focus next: {r.coaching.nextFocus.map((f) => <Pill key={f} tone="blue">{f}</Pill>)}</div>}
        </AccentCard>
      )}
      {d.session.blueprint.context.background && <BackgroundSummary b={d.session.blueprint.context.background} />}
      {questionnaire && r.profileSuggestions && <DiscoverySummary suggestions={r.profileSuggestions} />}
      {r.profileSuggestions && (
        <Card className="mb-8">
          <div className="mb-2 font-semibold">Suggested profile updates</div>
          <p className="mb-3 text-body-sm text-ink-2">Extracted from what you said — review before applying.</p>
          <div className="flex flex-wrap gap-1.5 text-body-sm">{r.profileSuggestions.interests.map((i) => <Pill key={i} tone="blue">{i}</Pill>)}{r.profileSuggestions.workValues.map((v) => <Pill key={v} tone="yellow">{v}</Pill>)}{Object.entries(r.profileSuggestions.taskAffinity).map(([k, v]) => <Pill key={k}>{k}: {v}/5</Pill>)}</div>
          {r.profileSuggestions.constraints.length > 0 && <ul className="mt-3 list-disc pl-5 text-body-sm text-ink-2">{r.profileSuggestions.constraints.map((c) => <li key={c}>{c}</li>)}</ul>}
          <div className="mt-4 flex items-center gap-3"><Button variant="primary" loading={apply.isPending} onClick={() => apply.mutate(undefined)}>Apply to my profile</Button>{apply.isSuccess && <span className="text-body-sm text-teal">Applied — <Link to="/matching" className="underline">see role matches</Link></span>}</div>
        </Card>
      )}
      {!questionnaire && <div className="mb-8 grid gap-4 md:grid-cols-2">
        <Card><div className="mb-2 font-semibold text-teal">Strengths</div><ul className="list-disc pl-5 text-body-sm">{r.strengths.length ? r.strengths.map((s) => <li key={s}>{s}</li>) : <li className="text-muted">None identified with confidence.</li>}</ul></Card>
        <Card><div className="mb-2 font-semibold text-vermillion">To improve</div><ul className="list-disc pl-5 text-body-sm">{r.weaknesses.map((s) => <li key={s}>{s}</li>)}</ul>{r.improvements.length > 0 && <ul className="mt-3 flex flex-col gap-1 border-t border-line pt-3 text-body-sm">{r.improvements.map((s) => <li key={s}>→ {s}</li>)}</ul>}</Card>
      </div>}
      {r.learningTasks.length > 0 && <Card className="mb-8"><div className="mb-2 font-semibold">Recommended learning tasks</div><ul className="flex flex-col gap-1 text-body-sm">{r.learningTasks.map((t) => <li key={t.skillSlug}>{t.title}</li>)}</ul><div className="mt-3 flex gap-2"><ButtonLink to="/learning" variant="ghost">Open learning plan</ButtonLink><ButtonLink to="/assessments" variant="text">Take an assessment</ButtonLink></div></Card>}
      <Section title={questionnaire ? 'Your answers' : 'Transcript & question-by-question feedback'}>
        <div className="flex flex-col gap-4">
          {pairs.map(({ q, a }, pairIndex) => {
            const tip = r.coaching?.questionTips.find((t) => t.index === pairIndex + 1);
            const mainNo = pairs.filter((p) => p.q.kind !== 'follow_up' && p.q.seq <= q.seq).length;
            const fb = r.questionFeedback.find((f) => f.question === q.content);
            return (
              <Card key={q.id}>
                <div className="mb-2 flex flex-wrap items-center gap-2 text-caption text-muted"><Pill tone={q.kind === 'follow_up' ? 'yellow' : 'blue'}>{q.kind === 'follow_up' ? 'Follow-up' : `Q${mainNo}`}</Pill>{fb && <span>{fb.topic}</span>}{a?.inputMode === 'voice' && <Pill>voice</Pill>}{fb && !q.options && <span className="ml-auto text-[18px] font-semibold text-ink">{fb.score}</span>}</div>
                <p className="mb-3 font-medium">{q.content}</p>
                {a?.choices && <div className="mb-3 flex flex-wrap gap-1.5">{a.choices.map((k) => <Pill key={k} tone="blue">{q.options?.choices.find((c) => c.key === k)?.label ?? k}</Pill>)}</div>}
                {a ? a.content && <p className="mb-3 whitespace-pre-wrap rounded-md bg-surface-2 p-3 text-body-sm">{a.content}</p> : <p className="mb-3 text-body-sm text-muted">Not answered.</p>}
                {fb && !q.options && <p className="text-body-sm text-ink-2">{fb.feedback}</p>}
                {fb && fb.quotes.length > 0 && <div className="mt-2 flex flex-col gap-1">{fb.quotes.map((qt) => <div key={qt} className="flex items-start gap-1.5 text-caption italic text-muted"><Quote className="size-3 shrink-0" />“{qt}”</div>)}</div>}
                {tip && <div className="mt-3 rounded-md bg-sky-tint p-3 text-body-sm dark:bg-primary-soft"><div className="mb-1 flex items-center gap-1 font-medium"><Sparkles className="size-3.5 text-marigold" />Coach tip</div><p>{tip.tip}</p>{tip.betterStructure && <p className="mt-1 text-ink-2"><b>Stronger structure:</b> {tip.betterStructure}</p>}</div>}
                {q.idealPoints && q.idealPoints.length > 0 && <div className="mt-3 border-t border-line pt-3 text-body-sm"><span className="font-medium">A strong answer would cover:</span> {q.idealPoints.join(' · ')}</div>}
              </Card>
            );
          })}
        </div>
      </Section>
    </>
  );
}

interface DiscoveryInsights {
  interests: string[]; taskAffinity: Record<string, number>; goals: string;
  topMatches?: { slug: string; name: string; reasons: string[]; potentialGaps: string[]; trial: string }[];
  selfReportedStrengths?: string[]; enjoyedActivities?: string[];
}

function DiscoverySummary({ suggestions: s }: { suggestions: DiscoveryInsights }) {
  const [trial, setTrial] = useState<string | null>(null);
  return <div className="mb-8 flex flex-col gap-5">
    <Section title="Top 3 Career Matches" description="Possible directions based on your stated preferences. These are starting points for exploration; they do not establish job readiness.">
      {s.topMatches?.length ? <div className="grid gap-3 md:grid-cols-3">{s.topMatches.map((m, i) => <Card key={m.slug}>
        <div className="text-caption text-muted">Direction {i + 1}</div><h3 className="mt-1 font-semibold">{m.name}</h3>
        <ul className="mt-3 flex list-disc flex-col gap-2 pl-4 text-body-sm text-ink-2">{m.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        <div className="mt-4 flex flex-wrap gap-2"><ButtonLink to={`/atlas/${m.slug}`} variant="ghost">Explore role</ButtonLink><Button variant="text" onClick={() => setTrial(trial === m.slug ? null : m.slug)}>Try a Career Trial</Button></div>
        {trial === m.slug && <div className="mt-3 rounded-md bg-surface-2 p-3 text-body-sm"><b>Small career trial</b><p className="mt-1">Try a small, simulated version of this responsibility: {m.trial}.</p><p className="mt-2 text-caption text-muted">Write down what you enjoyed, what felt draining and what you would need to learn. This explores interest and does not verify a skill.</p></div>}
      </Card>)}</div> : <Notice>There is not enough preference information to suggest three roles yet. Explore the Career Atlas or add more answers before choosing a direction.</Notice>}
    </Section>
    <div className="grid gap-4 md:grid-cols-2">
      <Card><h3 className="mb-3 font-semibold">Strengths & Interests</h3><div className="mb-2 text-caption text-muted">Self-reported strengths · not verified</div>{s.selfReportedStrengths?.length ? <ul className="list-disc pl-5 text-body-sm">{s.selfReportedStrengths.map((v) => <li key={v}>{v}</li>)}</ul> : <p className="text-body-sm text-muted">No strengths identified yet.</p>}<div className="mt-4 mb-2 text-caption text-muted">Work you said you enjoy</div><div className="flex flex-wrap gap-1.5">{Object.entries(s.taskAffinity).filter(([, rating]) => rating >= 4).map(([task]) => <Pill key={task} tone="blue">{task}</Pill>)}</div>{s.goals && <p className="mt-4 text-body-sm"><b>Your direction:</b> {s.goals}</p>}</Card>
      <Card><h3 className="mb-2 font-semibold">Potential Skill Gaps</h3><p className="mb-3 text-body-sm text-muted">These role requirements need further assessment. A missing assessment does not mean you lack the skill.</p><ul className="flex flex-col gap-3">{s.topMatches?.map((m) => <li key={m.slug} className="text-body-sm"><b>{m.name}</b><div className="mt-1 flex flex-wrap gap-1.5">{m.potentialGaps.map((g) => <Pill key={g}>{g} · assess</Pill>)}</div></li>)}</ul><ButtonLink to="/assessments" variant="ghost" className="mt-4">Take a Skill Assessment</ButtonLink></Card>
    </div>
    <Notice><b>Next Step:</b> Explore a suggested role, try its small Career Trial, or take a Skill Assessment before deciding on a learning plan.</Notice>
  </div>;
}
