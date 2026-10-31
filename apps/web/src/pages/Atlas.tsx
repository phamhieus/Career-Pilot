import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ErrorState, Input, Loading, PageHeader, Pill } from '../components/ui';
import { api } from '../lib/api';

interface AtlasFamily { id: number; slug: string; name: string; description: string; roles: { slug: string; name: string; summary: string; roadmap: 'curated' | 'generated' | null; activeJobs: number; demoJobs: number }[] }
const TONES = ['border-signal-blue', 'border-coral', 'border-marigold', 'border-sky-wash'];

export default function Atlas() {
  const [q, setQ] = useState('');
  const [family, setFamily] = useState<string | null>(null);
  const atlas = useQuery({ queryKey: ['atlas'], queryFn: () => api.get<AtlasFamily[]>('/atlas') });
  const filtered = useMemo(() => (atlas.data ?? []).filter((f) => !family || f.slug === family).map((f) => ({ ...f, roles: f.roles.filter((r) => !q || `${r.name} ${r.summary}`.toLowerCase().includes(q.toLowerCase())) })).filter((f) => f.roles.length), [atlas.data, q, family]);

  return (
    <>
      <PageHeader eyebrow="Explore" title="Tech Career" highlight="Atlas" subtitle="Curated role profiles across eleven career families — responsibilities, level expectations, transitions and a sourced outlook." />
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative md:w-80"><Search className="absolute top-2.5 left-3 size-4 text-faint" /><Input aria-label="Search roles" placeholder="Search roles…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" /></div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setFamily(null)} className={`rounded-full px-3 py-1 text-caption font-medium ${!family ? 'bg-midnight-ink text-white' : 'bg-black/[0.05] dark:bg-white/10'}`}>All</button>
          {atlas.data?.map((f) => <button key={f.slug} onClick={() => setFamily(f.slug)} className={`rounded-full px-3 py-1 text-caption font-medium ${family === f.slug ? 'bg-midnight-ink text-white' : 'bg-black/[0.05] dark:bg-white/10'}`}>{f.name}</button>)}
        </div>
      </div>
      {atlas.isLoading && <Loading rows={6} />}
      {atlas.error && <ErrorState error={atlas.error} retry={atlas.refetch} />}
      <div className="flex flex-col gap-10">
        {filtered.map((f, fi) => (
          <section key={f.slug}>
            <div className="mb-3 flex items-baseline gap-3"><h2 className="text-heading-sm font-semibold">{f.name}</h2><span className="hidden text-body-sm text-ink-2 md:inline">{f.description}</span></div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {f.roles.map((r) => (
                <Link key={r.slug} to={`/atlas/${r.slug}`} className="card group flex flex-col gap-2 p-5 transition-colors duration-200 hover:border-primary/40">
                  <div className="flex items-center gap-2"><span className={`size-2.5 rounded-full border-2 ${TONES[fi % TONES.length]}`} /><span className="font-semibold group-hover:text-primary">{r.name}</span></div>
                  <p className="text-body-sm text-ink-2">{r.summary}</p>
                  <div className="mt-1 rounded-md bg-surface-2 px-3 py-2 text-caption">
                    <div className="font-medium text-ink-2">{f.slug === 'tech-leadership' ? 'Experienced practitioner → Lead → Organization-wide impact' : 'Junior → Middle → Senior'}</div>
                    <div className="mt-1 text-primary">Explore skills & requirements at each stage →</div>
                  </div>
                  <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
                    {r.roadmap === 'curated' && <Pill tone="blue">Curated roadmap</Pill>}
                    {r.roadmap === 'generated' && <Pill>Generated roadmap</Pill>}
                    {r.activeJobs > 0 && <Pill tone="green">{r.activeJobs} postings</Pill>}
                    {r.demoJobs > 0 && <Pill tone="peach">{r.demoJobs} demo</Pill>}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
