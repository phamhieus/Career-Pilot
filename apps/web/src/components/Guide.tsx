import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, ChevronDown, Compass, PartyPopper, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { api } from '../lib/api';
import { cx } from './ui';

export interface OnboardingStep { n: number; key: string; phase: string; title: string; description: string; done: boolean; href: string; cta: string; path: string; why: string; howTo: string[] }
export interface Onboarding { phases: { key: string; label: string }[]; steps: OnboardingStep[]; completed: number; total: number; current: number | null; dismissed: boolean }

export function useOnboarding(opts: { poll?: boolean } = {}) {
  const loc = useLocation();
  return useQuery({
    queryKey: ['onboarding', loc.pathname],
    queryFn: () => api.get<Onboarding>('/onboarding'),
    staleTime: 0,
    refetchInterval: opts.poll ? 5000 : false,
    placeholderData: (prev) => prev,
  });
}

const onStepPage = (step: OnboardingStep, pathname: string) => (step.path.endsWith('/') ? pathname.startsWith(step.path) && pathname.length > step.path.length : pathname === step.path || pathname.startsWith(`${step.path}/`));

export function ProgressRing({ value, total, size = 28 }: { value: number; total: number; size?: number }) {
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--cp-line)" strokeWidth="3" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--cp-primary)" strokeWidth="3" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - value / Math.max(1, total))} className="transition-all duration-500" />
    </svg>
  );
}

/** Sidebar entry: always one click away from the full guide. */
export function SidebarGuide({ onNavigate }: { onNavigate?: () => void }) {
  const q = useOnboarding();
  if (!q.data || q.data.completed === q.data.total) return null;
  return (
    <Link to="/welcome" onClick={onNavigate} className="mx-1 flex items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 transition-colors hover:border-primary/40">
      <ProgressRing value={q.data.completed} total={q.data.total} />
      <div className="min-w-0">
        <div className="text-body-sm font-semibold">Getting started</div>
        <div className="text-caption text-muted">{q.data.completed}/{q.data.total} steps done</div>
      </div>
    </Link>
  );
}

/**
 * Sticky guide shown on every page until onboarding is finished or hidden: tells the user which step
 * they are on, what to do on this page, and offers the next step as soon as the current one is done.
 */
export function GuideBar() {
  const loc = useLocation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(true);
  const [justDone, setJustDone] = useState<OnboardingStep | null>(null);
  const q = useOnboarding({ poll: true });
  const prevCurrent = useRef<number | null | undefined>(undefined);
  const d = q.data;

  useEffect(() => {
    if (!d) return;
    if (prevCurrent.current !== undefined && prevCurrent.current !== null && d.current !== prevCurrent.current) {
      const finished = d.steps.find((s) => s.n === prevCurrent.current);
      if (finished?.done) setJustDone(finished);
    }
    prevCurrent.current = d.current;
  }, [d]);
  useEffect(() => { if (justDone) { const t = setTimeout(() => setJustDone(null), 8000); return () => clearTimeout(t); } }, [justDone]);

  if (!d || d.dismissed || loc.pathname === '/welcome') return null;
  const step = d.steps.find((s) => s.n === d.current);
  const hide = async () => { await api.post('/onboarding/dismiss', { dismissed: true }); qc.invalidateQueries({ queryKey: ['onboarding'] }); };

  if (!step) {
    return (
      <div className="border-b border-line bg-teal/10 px-4 py-2.5 md:px-8">
        <div className="mx-auto flex max-w-[1240px] items-center gap-3 text-body-sm"><PartyPopper className="size-4 text-teal" /><span className="flex-1"><b>All {d.total} getting-started steps done.</b> Keep using the plan, tracker and interviews as your search progresses.</span><button onClick={hide} className="text-muted hover:text-ink">Hide</button></div>
      </div>
    );
  }
  const here = onStepPage(step, loc.pathname);
  const phase = d.phases.find((p) => p.key === step.phase);

  return (
    <div className={cx('border-b border-line px-4 py-3 md:px-8', here ? 'bg-sky-tint dark:bg-primary-soft' : 'bg-surface-2')} role="region" aria-label="Getting started guide">
      <div className="mx-auto max-w-[1240px]">
        {justDone && (
          <div className="mb-2 flex items-center gap-2 text-body-sm text-teal"><CheckCircle2 className="size-4" /><b>Step {justDone.n} done:</b> {justDone.title}</div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <ProgressRing value={d.completed} total={d.total} size={30} />
          <div className="min-w-0 flex-1">
            <div className="text-caption font-medium tracking-wider text-muted uppercase">Step {step.n} of {d.total} · {phase?.label}</div>
            <div className="font-semibold">{step.title}</div>
          </div>
          {here ? (
            <button onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-body-sm font-medium text-primary" aria-expanded={open}>
              What to do here <ChevronDown className={cx('size-4 transition-transform', !open && '-rotate-90')} />
            </button>
          ) : (
            <Link to={step.href} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-[15px] py-[6px] text-body-sm font-medium text-white hover:brightness-110">{step.cta}<ArrowRight className="size-4" /></Link>
          )}
          <Link to="/welcome" className="hidden text-body-sm text-muted hover:text-ink sm:inline"><Compass className="mr-1 inline size-4" />All steps</Link>
          <button onClick={hide} aria-label="Hide the guide" title="Hide the guide (you can show it again from Getting started)" className="rounded-md p-1 text-faint hover:text-ink"><X className="size-4" /></button>
        </div>
        {here && open && (
          <ol className="mt-2 ml-11 flex list-decimal flex-col gap-1 pl-4 text-body-sm">
            {step.howTo.map((h) => <li key={h}>{h}</li>)}
          </ol>
        )}
      </div>
    </div>
  );
}
