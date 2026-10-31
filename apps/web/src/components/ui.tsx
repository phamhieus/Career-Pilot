import { clsx } from 'clsx';
import { AlertTriangle, Bot, CircleHelp, FlaskConical, Info, Loader2, ShieldCheck, X } from 'lucide-react';
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router';

export const cx = clsx;

// ---------------------------------------------------------------------------
// Buttons (DESIGN.md: one filled blue primary per view; ghost/text/outline otherwise)
// ---------------------------------------------------------------------------
type Variant = 'primary' | 'ghost' | 'text' | 'outline' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:brightness-110 rounded-md',
  ghost: 'bg-primary-soft text-primary hover:brightness-[0.97] rounded-md',
  text: 'bg-transparent text-ink hover:bg-black/5 dark:hover:bg-white/5 rounded-md',
  outline: 'bg-transparent text-ink border border-current/30 hover:border-current/60 rounded-sm',
  danger: 'bg-transparent text-vermillion border border-vermillion/40 hover:bg-vermillion/5 rounded-md',
};
export function Button({ variant = 'text', loading, className, children, icon, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx('inline-flex items-center justify-center gap-1.5 px-[15px] py-[6px] text-body-sm font-medium transition-all duration-200 ease-out disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap', VARIANTS[variant], className)}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}
export function ButtonLink({ to, variant = 'text', className, children, icon, external }: { to: string; variant?: Variant; className?: string; children: ReactNode; icon?: ReactNode; external?: boolean }) {
  const cls = cx('inline-flex items-center justify-center gap-1.5 px-[15px] py-[6px] text-body-sm font-medium transition-all duration-200', VARIANTS[variant], className);
  if (external) return <a href={to} target="_blank" rel="noopener noreferrer" className={cls}>{icon}{children}</a>;
  return <Link to={to} className={cls}>{icon}{children}</Link>;
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------
export function Card({ className, children, padded = true, ...rest }: { className?: string; children: ReactNode; padded?: boolean } & React.HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cx('card', padded && 'p-6', className)}>{children}</div>;
}
const ACCENTS = {
  marigold: 'bg-marigold text-black',
  coral: 'bg-coral text-white',
  sky: 'bg-sky-wash text-black',
  tint: 'bg-sky-tint text-black dark:bg-primary-soft dark:text-ink',
  midnight: 'bg-midnight-ink text-white',
  peach: 'bg-peach text-black',
} as const;
export function AccentCard({ tone, className, children }: { tone: keyof typeof ACCENTS; className?: string; children: ReactNode }) {
  return <div className={cx('rounded-lg p-6', ACCENTS[tone], className)}>{children}</div>;
}

export function PageHeader({ title, highlight, subtitle, actions, eyebrow }: { title: ReactNode; highlight?: string; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="max-w-3xl">
        {eyebrow && <div className="mb-2 text-caption font-medium uppercase tracking-wider text-muted">{eyebrow}</div>}
        <h1 className="text-[34px] leading-[1.1] font-semibold tracking-[-0.03em] md:text-[42px]">
          {title}
          {highlight && <> <span className="inline-block rounded-full bg-peach px-4 py-0.5 text-black">{highlight}</span></>}
        </h1>
        {subtitle && <p className="mt-3 font-serif text-[18px] leading-[1.56] text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Section({ title, description, actions, children, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('mb-10', className)}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-heading-sm font-semibold">{title}</h2>
          {description && <p className="mt-1 text-body-sm text-ink-2">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Pills & badges
// ---------------------------------------------------------------------------
const PILL = {
  neutral: 'bg-black/[0.05] text-ink dark:bg-white/10',
  blue: 'bg-sky-tint text-[#005bb0] dark:bg-primary-soft dark:text-primary',
  yellow: 'bg-marigold/25 text-[#7a4f00] dark:text-marigold',
  red: 'bg-coral/15 text-vermillion',
  green: 'bg-teal/12 text-teal',
  dark: 'bg-midnight-ink text-white',
  peach: 'bg-peach text-black',
} as const;
export type PillTone = keyof typeof PILL;
export function Pill({ tone = 'neutral', children, className, title }: { tone?: PillTone; children: ReactNode; className?: string; title?: string }) {
  return <span title={title} className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-caption font-medium whitespace-nowrap', PILL[tone], className)}>{children}</span>;
}

export const SKILL_STATUS: Record<string, { label: string; tone: PillTone; help: string }> = {
  app_verified: { label: 'App-verified', tone: 'green', help: 'Passed an objective quiz and a rubric-graded practical task.' },
  assessed: { label: 'Assessed', tone: 'blue', help: 'Has assessment or interview evidence, but verification criteria are not yet met.' },
  self_reported: { label: 'Self-reported', tone: 'yellow', help: 'Your own rating. Counts at 60% until assessed.' },
  extracted_claim: { label: 'CV claim', tone: 'neutral', help: 'Mentioned in your CV or history. Level unknown until assessed.' },
  unknown: { label: 'Unknown', tone: 'neutral', help: 'No evidence yet — not the same as a gap.' },
};
export function SkillStatusPill({ status }: { status: string | null }) {
  const s = SKILL_STATUS[status ?? 'unknown'] ?? SKILL_STATUS.unknown;
  return <Pill tone={s.tone} title={s.help}>{status === 'app_verified' && <ShieldCheck className="size-3" />}{s.label}</Pill>;
}

export function DemoBadge() {
  return <Pill tone="peach" title="Fictional demo data, not a real vacancy"><FlaskConical className="size-3" />Demo</Pill>;
}

export function AiMetaNote({ meta }: { meta?: { mode: string; provider: string; model?: string | null; fallbackReason?: string } | null }) {
  if (!meta) return null;
  if (meta.mode === 'ai') return <span className="inline-flex items-center gap-1 text-caption text-muted"><Bot className="size-3" />AI · {meta.provider}{meta.model ? ` (${meta.model})` : ''}</span>;
  return <span className="inline-flex items-center gap-1 text-caption text-[#7a4f00] dark:text-marigold" title={meta.fallbackReason}><Info className="size-3" />Heuristic mode{meta.fallbackReason ? ` — ${meta.fallbackReason}` : ''}</span>;
}

// ---------------------------------------------------------------------------
// Data display
// ---------------------------------------------------------------------------
export function ScoreBar({ value, tone = 'blue', className }: { value: number | null; tone?: 'blue' | 'yellow' | 'red' | 'green'; className?: string }) {
  const color = { blue: 'bg-primary', yellow: 'bg-marigold', red: 'bg-coral', green: 'bg-teal' }[tone];
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/10', className)}>
      {value != null && <div className={cx('h-full rounded-full transition-all duration-500', color)} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <div className="text-caption uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 text-[28px] font-semibold tracking-tight">{value}</div>
      {hint && <div className="text-caption text-muted">{hint}</div>}
    </div>
  );
}

const CONF_TONE: Record<string, PillTone> = { high: 'green', medium: 'blue', low: 'yellow', unknown: 'neutral' };
export function DimensionCard({ d }: { d: { key: string; label: string; score: number | null; confidence: string; explanation?: string[]; coverage?: number } }) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-body-sm font-medium text-ink-2">{d.label}</span>
        <Pill tone={CONF_TONE[d.confidence] ?? 'neutral'}>{d.confidence === 'unknown' ? 'insufficient evidence' : `${d.confidence} confidence`}</Pill>
      </div>
      <div className="flex items-baseline gap-1">
        {d.score == null ? <span className="text-[34px] font-semibold tracking-tight text-faint">Unknown</span> : <><span className="text-[40px] leading-none font-semibold tracking-[-0.03em]">{d.score}</span><span className="text-muted">/100</span></>}
      </div>
      <ScoreBar value={d.score} tone={d.key === 'capability' ? 'blue' : d.key === 'interest' ? 'yellow' : d.key === 'growth' ? 'green' : 'red'} />
      {d.explanation && <ul className="flex flex-col gap-1.5 text-body-sm text-ink-2">{d.explanation.map((e, i) => <li key={i} className="leading-snug">{e}</li>)}</ul>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------
export function Loading({ label = 'Loading…', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div aria-busy="true" aria-label={label} className="flex flex-col gap-3">
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-black/[0.04] dark:bg-white/5" />)}
    </div>
  );
}
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof Error ? error.message : 'Something went wrong';
  return (
    <Card className="flex items-start gap-3 border-coral/30">
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-coral" />
      <div className="flex-1">
        <div className="font-medium">Couldn’t load this</div>
        <div className="text-body-sm text-ink-2">{msg}</div>
      </div>
      {retry && <Button variant="ghost" onClick={retry}>Retry</Button>}
    </Card>
  );
}
export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
      {icon && <div className="flex size-12 items-center justify-center rounded-full border-2 border-marigold bg-surface text-ink">{icon}</div>}
      <div className="text-[18px] font-semibold">{title}</div>
      {children && <div className="max-w-md font-serif text-[16px] text-ink-2">{children}</div>}
      {action}
    </div>
  );
}
export function Notice({ tone = 'info', children, className }: { tone?: 'info' | 'warn' | 'demo'; children: ReactNode; className?: string }) {
  const cls = { info: 'bg-sky-tint text-[#0a3a66] dark:bg-primary-soft dark:text-ink', warn: 'bg-marigold/20 text-[#5c3b00] dark:text-marigold', demo: 'bg-peach/70 text-black' }[tone];
  return <div className={cx('flex items-start gap-2 rounded-md px-4 py-3 text-body-sm', cls, className)}>{tone === 'demo' ? <FlaskConical className="mt-0.5 size-4 shrink-0" /> : <Info className="mt-0.5 size-4 shrink-0" />}<div>{children}</div></div>;
}
export function Hint({ children }: { children: ReactNode }) {
  return <span className="group relative inline-flex"><CircleHelp className="size-3.5 text-faint" /><span className="pointer-events-none absolute bottom-5 left-1/2 z-20 hidden w-64 -translate-x-1/2 rounded-md bg-midnight-ink px-3 py-2 text-caption text-white group-hover:block">{children}</span></span>;
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------
const field = 'rounded-md border border-line bg-surface px-3 py-2 text-body-sm text-ink placeholder:text-faint transition-colors duration-200 focus:border-primary focus:outline-none';
export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('flex flex-col gap-1.5', className)}>
      <span className="text-body-sm font-medium">{label}</span>
      {children}
      {hint && !error && <span className="text-caption text-muted">{hint}</span>}
      {error && <span className="text-caption text-vermillion">{error}</span>}
    </label>
  );
}
const width = (c?: string) => (c && /(^|\s|:)w-/.test(c) ? '' : 'w-full');
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(field, width(className), className)} />;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(field, 'w-full min-h-24', className)} />;
export const Select = ({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(field, width(className), 'pr-8', className)}>{children}</select>;

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[] }) {
  return (
    <div role="tablist" className="inline-flex gap-1 rounded-md bg-black/[0.04] p-1 dark:bg-white/5">
      {items.map((it) => (
        <button key={it.value} role="tab" aria-selected={value === it.value} onClick={() => onChange(it.value)} className={cx('rounded-[6px] px-3 py-1 text-body-sm font-medium transition-all duration-200', value === it.value ? 'bg-surface text-ink shadow-nav' : 'text-muted hover:text-ink')}>{it.label}</button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 md:items-center md:p-6" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()} className={cx('card animate-pop max-h-[92vh] w-full overflow-auto p-6 shadow-mockup', wide ? 'md:max-w-3xl' : 'md:max-w-lg')}>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-heading-sm font-semibold">{title}</h2>
          <button aria-label="Close" onClick={onClose} className="rounded-md p-1 text-muted hover:bg-black/5 dark:hover:bg-white/5"><X className="size-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onMouseDown={onClose}>
      <aside role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()} className="h-full w-full max-w-md overflow-auto border-l border-line bg-surface p-6 shadow-mockup">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="text-heading-sm font-semibold">{title}</div>
          <button aria-label="Close" onClick={onClose} className="rounded-md p-1 text-muted hover:bg-black/5 dark:hover:bg-white/5"><X className="size-5" /></button>
        </div>
        {children}
      </aside>
    </div>
  );
}

export const fmtDate = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
export const label = (s: string | null | undefined) => (s ?? '—').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
