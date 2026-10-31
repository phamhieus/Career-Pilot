import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, ChevronDown, Eye, EyeOff, FlaskConical } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { ProgressRing, useOnboarding, type OnboardingStep } from '../components/Guide';
import { AccentCard, Button, ButtonLink, Card, cx, ErrorState, Loading, Notice, Pill } from '../components/ui';
import { api } from '../lib/api';
import { useAction, useMe, useMeta } from '../lib/hooks';

const PHASE_TONE = ['border-signal-blue', 'border-coral', 'border-marigold', 'border-teal', 'border-sky-wash'];

export default function Welcome() {
  const me = useMe();
  const meta = useMeta();
  const qc = useQueryClient();
  const q = useOnboarding();
  const [openStep, setOpenStep] = useState<number | null>(null);
  const sample = useAction(() => api.post('/profile/sample'), [['profile'], ['onboarding'], ['dashboard'], ['matching']]);
  const toggleGuide = useAction((dismissed: boolean) => api.post('/onboarding/dismiss', { dismissed }), [['onboarding']]);
  if (q.isLoading) return <Loading rows={5} />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const d = q.data!;
  const current = d.steps.find((s) => s.n === d.current) ?? null;
  const expanded = openStep ?? current?.n ?? null;
  const name = me.data?.displayName.split(' ')[0];

  return (
    <>
      <section className="mb-10 text-center">
        <div className="mb-5 flex justify-center gap-2" aria-hidden>{['#097fe8', '#f64932', '#ffb110', '#62aef0', '#0f8a7e'].map((c, i) => <span key={c} className={cx('flex size-10 items-center justify-center rounded-full border-2 bg-surface text-caption font-semibold', i < d.completed / 3 && 'animate-pop')} style={{ borderColor: c }}>{i + 1}</span>)}</div>
        <h1 className="mx-auto max-w-3xl text-[36px] leading-[1.1] font-semibold tracking-[-0.03em] md:text-[48px]">
          {d.completed === 0 ? <>Welcome{name ? `, ${name}` : ''}. Let’s <span className="inline-block rounded-full bg-peach px-5 py-0.5">start</span> here.</> : d.current ? <>You’re on step <span className="inline-block rounded-full bg-peach px-5 py-0.5">{d.current}</span> of {d.total}.</> : <>You’ve finished the <span className="inline-block rounded-full bg-peach px-5 py-0.5">guide</span>.</>}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl font-serif text-[18px] leading-[1.56] text-ink-2">
          CareerPilot works best in this order: build your profile, explore roles, pick a real job, learn and prove the gaps, then apply. Each step takes a few minutes and unlocks the next.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {current && <ButtonLink to={current.href} variant="primary" icon={<ArrowRight className="size-4" />}>{d.completed === 0 ? 'Start step 1' : `Continue with step ${current.n}`}</ButtonLink>}
          <span className="inline-flex items-center gap-2 text-body-sm text-muted"><ProgressRing value={d.completed} total={d.total} />{d.completed}/{d.total} done</span>
        </div>
      </section>

      {d.completed === 0 && (
        <div className="mb-10 grid gap-4 md:grid-cols-2">
          <AccentCard tone="marigold">
            <div className="mb-1 text-[18px] font-semibold">Have a CV? Start with it.</div>
            <p className="mb-4 text-body-sm">Upload a PDF or DOCX. CareerPilot extracts your experience and skills, and you confirm what’s correct.</p>
            <ButtonLink to="/profile?tab=experience" variant="outline">Import my CV</ButtonLink>
          </AccentCard>
          <Card>
            <div className="mb-1 text-[18px] font-semibold">Just exploring?</div>
            <p className="mb-4 text-body-sm text-ink-2">Load a sample Backend Developer profile (clearly labeled) and walk through every step with it. You can replace it later.</p>
            <Button variant="ghost" icon={<FlaskConical className="size-4" />} loading={sample.isPending} onClick={() => sample.mutate(undefined)}>Load sample profile</Button>
            {sample.isSuccess && <p className="mt-2 text-body-sm text-teal">Sample loaded — step 1 is done.</p>}
          </Card>
        </div>
      )}
      {meta.data && !meta.data.ai.configured && (
        <Notice tone="warn" className="mb-8">Mock interviews, CV rewriting and suggestions work best with AI. <Link to="/settings" className="font-medium underline">Choose a provider and add your API key in Settings</Link> — it takes a minute. Without it, CareerPilot uses clearly labeled heuristics.</Notice>
      )}

      <div className="flex flex-col gap-8">
        {d.phases.map((phase, pi) => {
          const steps = d.steps.filter((s) => s.phase === phase.key);
          const doneCount = steps.filter((s) => s.done).length;
          return (
            <section key={phase.key} aria-labelledby={`phase-${phase.key}`}>
              <div className="mb-3 flex items-center gap-3">
                <span className={cx('flex size-8 items-center justify-center rounded-full border-2 bg-surface text-body-sm font-semibold', PHASE_TONE[pi])}>{pi + 1}</span>
                <h2 id={`phase-${phase.key}`} className="text-heading-sm font-semibold">{phase.label}</h2>
                <Pill tone={doneCount === steps.length ? 'green' : 'neutral'}>{doneCount}/{steps.length}</Pill>
              </div>
              <div className="flex flex-col gap-2">
                {steps.map((s) => <StepRow key={s.key} s={s} current={s.n === d.current} expanded={expanded === s.n} onToggle={() => setOpenStep(expanded === s.n ? -1 : s.n)} />)}
              </div>
            </section>
          );
        })}
      </div>

      <div className="mt-10 flex justify-center">
        <Button variant="text" icon={d.dismissed ? <Eye className="size-4" /> : <EyeOff className="size-4" />} loading={toggleGuide.isPending} onClick={() => { toggleGuide.mutate(!d.dismissed); qc.invalidateQueries({ queryKey: ['onboarding'] }); }}>
          {d.dismissed ? 'Show the step-by-step guide bar on every page' : 'Hide the guide bar (this page stays available)'}
        </Button>
      </div>
    </>
  );
}

function StepRow({ s, current, expanded, onToggle }: { s: OnboardingStep; current: boolean; expanded: boolean; onToggle: () => void }) {
  return (
    <Card padded={false} className={cx('transition-colors', current && 'border-primary ring-2 ring-primary/15')}>
      <button onClick={onToggle} aria-expanded={expanded} className="flex w-full items-center gap-3 px-5 py-3.5 text-left">
        <span className={cx('flex size-7 shrink-0 items-center justify-center rounded-full text-caption font-semibold', s.done ? 'bg-teal text-white' : current ? 'bg-primary text-white' : 'bg-black/[0.05] text-muted dark:bg-white/10')}>{s.done ? <Check className="size-4" /> : s.n}</span>
        <span className={cx('flex-1 font-medium', s.done && 'text-muted')}>{s.title}</span>
        {current && <Pill tone="blue">Next</Pill>}
        <ChevronDown className={cx('size-4 text-muted transition-transform', !expanded && '-rotate-90')} />
      </button>
      {expanded && (
        <div className="border-t border-line px-5 py-4 pl-15">
          <p className="mb-3 font-serif text-[16px] text-ink-2">{s.why}</p>
          <div className="mb-1 text-body-sm font-semibold">How to do it</div>
          <ol className="mb-4 flex list-decimal flex-col gap-1 pl-5 text-body-sm">{s.howTo.map((h) => <li key={h}>{h}</li>)}</ol>
          <ButtonLink to={s.href} variant={s.done ? 'ghost' : 'primary'} icon={<ArrowRight className="size-4" />}>{s.done ? 'Open again' : s.cta}</ButtonLink>
        </div>
      )}
    </Card>
  );
}
