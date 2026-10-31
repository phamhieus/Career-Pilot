import { useQuery } from '@tanstack/react-query';
import { MessagesSquare } from 'lucide-react';
import { Link } from 'react-router';
import { ButtonLink, EmptyState, ErrorState, fmtDate, label, Loading, PageHeader, Pill } from '../components/ui';
import { api } from '../lib/api';

interface Session { id: number; mode: string; roundType: string; status: string; seniority: string; roleName: string | null; score: number | null; createdAt: string; answerMode: string; language: string }
const MODES: Record<string, string> = { discovery: 'Career discovery', skill_verification: 'Skill verification', job_specific: 'Job-specific', focused: 'Focused practice' };

export default function Interviews() {
  const q = useQuery({ queryKey: ['interviews'], queryFn: () => api.get<Session[]>('/interviews') });
  return (
    <>
      <PageHeader eyebrow="Grow" title="AI mock" highlight="interviews" subtitle="Each session starts from a blueprint built from your profile, evidence and (optionally) a target job. One question at a time, adaptive follow-ups, a full report at the end." actions={<ButtonLink to="/interviews/new" variant="primary">New interview</ButtonLink>} />
      <div className="mb-8 grid gap-3 md:grid-cols-4">
        {Object.entries(MODES).map(([k, v]) => <Link key={k} to={`/interviews/new?mode=${k}`} className="card p-4 hover:border-primary/40"><div className="font-medium">{v}</div><div className="text-caption text-muted">{{ discovery: 'Find out what fits you', skill_verification: 'Probe unverified skills', job_specific: 'Rehearse for a saved job', focused: 'Practice with per-answer feedback' }[k]}</div></Link>)}
      </div>
      {q.isLoading && <Loading />}
      {q.error && <ErrorState error={q.error} retry={q.refetch} />}
      {q.data?.length === 0 && <EmptyState icon={<MessagesSquare className="size-5" />} title="No sessions yet">Start with a discovery interview if you are still deciding on a direction.</EmptyState>}
      <div className="flex flex-col gap-2">
        {q.data?.map((s) => (
          <Link key={s.id} to={`/interviews/${s.id}`} className="card flex flex-wrap items-center gap-3 p-4 hover:border-primary/40">
            <div className="min-w-0 flex-1"><div className="font-medium">{MODES[s.mode]}{s.roleName && ` · ${s.roleName}`}</div><div className="text-caption text-muted">{label(s.roundType)} round · {s.seniority} · {s.language.toUpperCase()} · {s.answerMode} · {fmtDate(s.createdAt)}</div></div>
            <Pill tone={s.status === 'completed' ? 'green' : s.status === 'in_progress' ? 'yellow' : s.status === 'abandoned' ? 'red' : 'neutral'}>{label(s.status)}</Pill>
            {s.score != null && <span className="w-12 text-right text-[20px] font-semibold">{Math.round(s.score)}</span>}
          </Link>
        ))}
      </div>
    </>
  );
}
