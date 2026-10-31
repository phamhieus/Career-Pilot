import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Compass, FileText, MessagesSquare } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { Logo } from '../components/Layout';
import { AccentCard, Button, Card, Field, Input, Tabs } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useTheme } from '../lib/hooks';

const schema = z.object({
  displayName: z.string().max(80).optional(),
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'At least 8 characters'),
});
type FormValues = z.infer<typeof schema>;

const MARKS = ['#097fe8', '#f64932', '#ffb110', '#62aef0', '#097fe8'];

export default function Landing() {
  useTheme();
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { register, handleSubmit, formState } = useForm<FormValues>({ resolver: zodResolver(schema) });
  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      if (mode === 'register') {
        await api.post('/auth/register', { email: v.email, password: v.password, displayName: v.displayName || v.email.split('@')[0] });
        navigate('/welcome', { replace: true }); // new accounts start on the guide
      }
      else await api.post('/auth/login', { email: v.email, password: v.password });
      await qc.invalidateQueries({ queryKey: ['me'] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong');
    }
  });

  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-line bg-canvas/90 px-6 shadow-nav backdrop-blur"><Logo /><a href="#auth" className="text-body-sm font-medium text-muted hover:text-ink">Sign in</a></nav>
      <section className="mx-auto max-w-[1100px] px-6 pt-16 pb-12 text-center md:pt-24">
        <div className="mb-8 flex justify-center gap-2" aria-hidden>
          {MARKS.map((c, i) => <span key={i} className="animate-pop size-10 rounded-full border-2 bg-surface" style={{ borderColor: c, animationDelay: `${i * 70}ms` }} />)}
        </div>
        <h1 className="mx-auto max-w-4xl text-[44px] leading-[1.08] font-semibold tracking-[-0.035em] md:text-display">
          Plan your next tech career move, then <span className="inline-block rounded-full bg-peach px-5 py-1 md:px-6">prove</span> it.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl font-serif text-[18px] leading-[1.56] text-ink-2">
          CareerPilot connects role discovery, skill evidence, real job postings, mock interviews, learning plans and your CV in one honest workspace — with scores that say “unknown” when evidence is missing.
        </p>
        <div className="mt-8 flex justify-center gap-2">
          <a href="#auth" className="rounded-md bg-primary px-[15px] py-[6px] text-body-sm font-medium text-white">Get started</a>
          <a href="#how" className="rounded-md bg-primary-soft px-[15px] py-[6px] text-body-sm font-medium text-primary">How it works</a>
        </div>
      </section>

      <section id="how" className="mx-auto grid max-w-[1100px] gap-4 px-6 pb-16 md:grid-cols-2">
        <AccentCard tone="marigold" className="md:col-span-2">
          <div className="flex items-start gap-3"><Compass className="mt-1 size-5" /><div><div className="text-heading-sm font-semibold">Curated tech roles across 11 career families</div><p className="mt-1 max-w-2xl">A career map of transitions between roles, and interactive skill roadmaps with prerequisites, resources and checkpoints.</p></div></div>
        </AccentCard>
        <Card><ClipboardCheck className="mb-3 size-5 text-primary" /><div className="text-[18px] font-semibold">Evidence, not vibes</div><p className="mt-1 text-ink-2">Self-reported, CV claim, assessed and app-verified skills are tracked separately. Course completion never counts as competence.</p></Card>
        <Card><MessagesSquare className="mb-3 size-5 text-coral" /><div className="text-[18px] font-semibold">Adaptive mock interviews</div><p className="mt-1 text-ink-2">Blueprint-driven, one question at a time, with follow-ups and a report. Answer by typing or dictation.</p></Card>
        <AccentCard tone="midnight" className="md:col-span-2">
          <div className="flex items-start gap-3"><FileText className="mt-1 size-5" /><div><div className="text-heading-sm font-semibold">CVs that only say what you can back up</div><p className="mt-1 max-w-2xl text-white/80">Every bullet links to source evidence. AI rewrites that add numbers or skills you never claimed are flagged for your confirmation.</p></div></div>
        </AccentCard>
      </section>

      <section id="auth" className="mx-auto max-w-md px-6 pb-24">
        <Card className="shadow-mockup">
          <div className="mb-5 flex justify-center"><Tabs value={mode} onChange={setMode} items={[{ value: 'register', label: 'Create account' }, { value: 'login', label: 'Sign in' }]} /></div>
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            {mode === 'register' && <Field label="Display name"><Input autoComplete="name" {...register('displayName')} /></Field>}
            <Field label="Email" error={formState.errors.email?.message}><Input type="email" autoComplete="email" {...register('email')} /></Field>
            <Field label="Password" error={formState.errors.password?.message}><Input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} {...register('password')} /></Field>
            {error && <div role="alert" className="text-body-sm text-vermillion">{error}</div>}
            <Button variant="primary" type="submit" loading={formState.isSubmitting}>{mode === 'register' ? 'Create account' : 'Sign in'}</Button>
            <p className="text-center text-caption text-muted">Your profile, CVs and interviews are private to your account. You can export or delete everything in Settings.</p>
          </form>
        </Card>
      </section>
    </div>
  );
}
