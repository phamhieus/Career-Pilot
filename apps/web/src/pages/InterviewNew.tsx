import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { Button, Card, Field, Notice, PageHeader, Select } from '../components/ui';
import { api } from '../lib/api';
import { useMeta } from '../lib/hooks';
import type { JobListItem } from '../lib/types';

const schema = z.object({
  mode: z.enum(['discovery', 'skill_verification', 'job_specific', 'focused']),
  roleSlug: z.string(),
  jobId: z.string(),
  seniority: z.enum(['intern', 'junior', 'middle', 'senior', 'lead']),
  roundType: z.enum(['hr', 'technical', 'case', 'system_design', 'leadership', 'mixed']),
  language: z.enum(['en', 'vi']),
  durationMinutes: z.coerce.number().int().min(5).max(60),
  answerMode: z.enum(['text', 'voice']),
}).superRefine((v, ctx) => {
  if (v.mode === 'job_specific' && !v.jobId) ctx.addIssue({ code: 'custom', path: ['jobId'], message: 'Choose a job' });
  if (v.mode !== 'discovery' && v.mode !== 'job_specific' && !v.roleSlug) ctx.addIssue({ code: 'custom', path: ['roleSlug'], message: 'Choose a target role' });
});
type Values = z.input<typeof schema>;

export default function InterviewNew() {
  const meta = useMeta();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const jobs = useQuery({ queryKey: ['jobs', 'for-interview'], queryFn: () => api.get<{ items: JobListItem[] }>('/jobs?limit=100') });
  const { register, handleSubmit, watch, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { mode: (params.get('mode') as Values['mode']) ?? (params.get('jobId') ? 'job_specific' : 'skill_verification'), roleSlug: params.get('role') ?? '', jobId: params.get('jobId') ?? '', seniority: 'middle', roundType: (params.get('round') as Values['roundType']) ?? 'mixed', language: 'en', durationMinutes: 20, answerMode: 'voice' },
  });
  const mode = watch('mode');
  const onSubmit = handleSubmit(async (raw) => {
    const v = schema.parse(raw);
    const s = await api.post<{ id: number }>('/interviews', {
      mode: v.mode, roleSlug: v.roleSlug || undefined, jobId: v.jobId ? Number(v.jobId) : undefined, seniority: v.seniority,
      roundType: v.mode === 'discovery' ? 'hr' : v.roundType, language: v.language, durationMinutes: v.durationMinutes, answerMode: v.answerMode,
    });
    navigate(`/interviews/${s.id}`);
  });

  return (
    <>
      <PageHeader eyebrow="Mock interview" title="Configure your" highlight="session" subtitle="You’ll see the interview blueprint before the first question." />
      <Card className="max-w-3xl">
        <form onSubmit={onSubmit} className="grid gap-5 md:grid-cols-2" noValidate>
          <Field label="Mode" className="md:col-span-2"><Select {...register('mode')}><option value="discovery">Career discovery — explore interests, values and constraints</option><option value="skill_verification">Skill verification — probe skills that lack evidence</option><option value="job_specific">Job-specific — rehearse for a saved or imported job</option><option value="focused">Focused practice — feedback after each answer</option></Select></Field>
          {mode !== 'discovery' && <>
            <Field label="Target role" error={formState.errors.roleSlug?.message}><Select {...register('roleSlug')}><option value="">{mode === 'job_specific' ? 'From the job' : '—'}</option>{meta.data?.roles.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}</Select></Field>
            <Field label="Related job" error={formState.errors.jobId?.message}><Select {...register('jobId')}><option value="">None</option>{jobs.data?.items.map((j) => <option key={j.id} value={j.id}>{j.title} — {j.company}{j.isDemo ? ' (demo)' : ''}</option>)}</Select></Field>
            <Field label="Seniority"><Select {...register('seniority')}>{['intern', 'junior', 'middle', 'senior', 'lead'].map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
            <Field label="Round"><Select {...register('roundType')}><option value="hr">HR / behavioral</option><option value="technical">Technical / functional</option><option value="case">Case study</option><option value="system_design">System design</option><option value="leadership">Leadership</option><option value="mixed">Mixed</option></Select></Field>
          </>}
          <Field label="Language"><Select {...register('language')}><option value="en">English</option><option value="vi">Tiếng Việt</option></Select></Field>
          {mode === 'discovery' ? <Notice className="md:col-span-2">A short background step, then five quick multiple-choice questions — about 4 minutes. No score — your answers become profile suggestions you can review.</Notice> : <>
          <Field label="Duration (minutes)" error={formState.errors.durationMinutes?.message}><Select {...register('durationMinutes')}>{[10, 15, 20, 30, 45].map((d) => <option key={d} value={d}>{d}</option>)}</Select></Field>
          <Field label="Answer mode" hint="Voice call: the interviewer reads each question aloud and you answer by speaking, with an editable live transcript. You can record video or audio to replay later; recordings stay in this browser and are never uploaded." className="md:col-span-2"><Select {...register('answerMode')}><option value="voice">Voice call (speak your answers, optional recording)</option><option value="text">Text (type or dictate)</option></Select></Field>
          {meta.data && !meta.data.ai.configured && <Notice tone="warn" className="md:col-span-2">Mock interviews are AI-driven: questions, rubric grading, follow-ups and coaching. No AI provider is connected yet, so a basic heuristic interviewer would be used. <Link to="/settings" className="font-medium underline">Add your OpenAI or DeepSeek key in Settings</Link> for the full experience.</Notice>}
          {meta.data?.ai.configured && <Notice className="md:col-span-2">AI interviewer: {meta.data.ai.provider} · {meta.data.ai.model}. Questions adapt to your answers; you get AI coaching after the session.</Notice>}
          <Notice className="md:col-span-2">A good mock interview is practice, not proof: it’s recorded as interview observation and never verifies coding or production experience on its own.</Notice>
          </>}
          {formState.errors.root && <p className="text-vermillion md:col-span-2">{formState.errors.root.message}</p>}
          <div className="flex justify-end md:col-span-2"><Button variant="primary" type="submit" loading={formState.isSubmitting}>Build blueprint</Button></div>
        </form>
      </Card>
    </>
  );
}
