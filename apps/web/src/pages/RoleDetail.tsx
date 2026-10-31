import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, ExternalLink, Map } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { AccentCard, ButtonLink, Card, DemoBadge, ErrorState, Hint, Loading, PageHeader, Pill, Section } from '../components/ui';
import { api } from '../lib/api';
import { CareerProgression } from '../components/CareerProgression';
import type { Role, SourceRef } from '../lib/types';

interface RoleDetailData {
  role: Role;
  family: { name: string; slug: string };
  requirements: { skillSlug: string; skillName: string; category: string; weight: number; normalizedWeight: number; requiredLevel: number; critical: boolean }[];
  transitionsFrom: { role: { slug: string; name: string }; difficulty: number; typicalMonths: number; rationale: string; transferableSkills: string[] }[];
  transitionsTo: { role: { slug: string; name: string }; difficulty: number; typicalMonths: number; rationale: string; transferableSkills: string[] }[];
  collaborators: { roleSlug: string; name: string; how: string }[];
  roadmap: { title: string; curated: boolean } | null;
  relatedJobs: { id: number; title: string; company: string; location: string | null; isDemo: boolean; postedAt: string | null; originSite: string | null; url: string | null }[];
}

function SourceLinks({ ids, sources }: { ids?: string[]; sources: SourceRef[] }) {
  if (!ids?.length) return null;
  return <>{ids.map((id) => { const s = sources.find((x) => x.id === id); return s ? <a key={id} href={s.url} target="_blank" rel="noopener noreferrer" className="ml-1 text-caption text-primary hover:underline">[{s.publisher}]</a> : null; })}</>;
}

const DIFF = ['', 'Adjacent', 'Moderate', 'Significant', 'Major', 'Pivot'];

export default function RoleDetail() {
  const { roleSlug } = useParams();
  const q = useQuery({ queryKey: ['role', roleSlug], queryFn: () => api.get<RoleDetailData>(`/atlas/${roleSlug}`) });
  if (q.isLoading) return <Loading rows={6} />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const { role, family, requirements, transitionsFrom, transitionsTo, collaborators, roadmap, relatedJobs } = q.data!;
  const d = role.details;

  return (
    <>
      <Link to="/atlas" className="mb-4 inline-flex items-center gap-1 text-body-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Atlas</Link>
      <PageHeader eyebrow={family.name} title={role.name} subtitle={role.summary} actions={<>
        <ButtonLink to={`/matching?role=${role.slug}`} variant="primary">See my match</ButtonLink>
        {roadmap && <ButtonLink to={`/roadmap/${role.slug}`} variant="ghost" icon={<Map className="size-4" />}>Skill roadmap</ButtonLink>}
      </>} />

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div>
          <Section title="Overview & purpose"><Card><p className="font-serif text-[18px] leading-[1.56] text-ink-2">{role.purpose}</p></Card></Section>
          <Section title="Typical responsibilities">
            <Card><ul className="flex list-disc flex-col gap-2 pl-5">{d.responsibilities.map((r) => <li key={r}>{r}</li>)}</ul></Card>
          </Section>
          <CareerProgression key={role.slug} role={role} familySlug={family.slug} requirements={requirements} hasRoadmap={!!roadmap} />
          <Section title="Future outlook" description="Sourced observations, attributed predictions and labeled speculation are kept separate.">
            <div className="flex flex-col gap-3">
              <Card>
                <div className="mb-2 flex items-center gap-2"><Pill tone="green">Observed</Pill><Hint>Statements that summarize what a cited source reports.</Hint></div>
                <ul className="flex flex-col gap-2">{d.outlook.observations.map((o) => <li key={o.text}>{o.text}<SourceLinks ids={o.sourceIds} sources={d.sources} /></li>)}</ul>
              </Card>
              {d.outlook.predictions.length > 0 && (
                <Card>
                  <div className="mb-2"><Pill tone="blue">Prediction (attributed)</Pill></div>
                  <ul className="flex flex-col gap-2">{d.outlook.predictions.map((o) => <li key={o.text}>{o.text}<SourceLinks ids={o.sourceIds} sources={d.sources} /></li>)}</ul>
                </Card>
              )}
              <AccentCard tone="tint">
                <div className="mb-2"><Pill tone="yellow">Speculation — CareerPilot editorial</Pill></div>
                <ul className="flex flex-col gap-2">{d.outlook.speculation.map((o) => <li key={o.text}>{o.text}</li>)}</ul>
                <div className="mt-4 border-t border-black/10 pt-3"><div className="text-body-sm font-semibold">AI impact (near term)</div><p className="text-body-sm">{d.outlook.aiImpact}</p></div>
              </AccentCard>
            </div>
          </Section>
          <Section title="Career paths & transitions">
            <Card className="mb-3"><ul className="flex flex-col gap-1.5">{d.careerPaths.map((p) => <li key={p} className="text-body-sm">{p}</li>)}</ul><p className="mt-3 text-body-sm text-ink-2">{d.transitionsNote}</p></Card>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <div className="mb-2 text-body-sm font-medium text-muted">Common paths into this role</div>
                {transitionsFrom.map((t) => <Link key={t.role.slug} to={`/atlas/${t.role.slug}`} className="card mb-2 block p-4 hover:border-primary/40"><div className="flex items-center justify-between"><span className="font-medium">{t.role.name}</span><Pill>{DIFF[t.difficulty]} · ~{t.typicalMonths} mo</Pill></div><p className="mt-1 text-caption text-muted">{t.rationale}</p></Link>)}
              </div>
              <div>
                <div className="mb-2 text-body-sm font-medium text-muted">Where it can lead</div>
                {transitionsTo.map((t) => <Link key={t.role.slug} to={`/atlas/${t.role.slug}`} className="card mb-2 flex items-center justify-between p-4 hover:border-primary/40"><span className="font-medium">{t.role.name}</span><span className="flex items-center gap-1 text-caption text-muted">{DIFF[t.difficulty]}<ArrowRight className="size-3" /></span></Link>)}
              </div>
            </div>
          </Section>
        </div>

        <aside className="flex flex-col gap-4">
          <Card><div className="mb-2 font-semibold">Key tools</div><div className="flex flex-wrap gap-1.5">{d.tools.map((t) => <Pill key={t}>{t}</Pill>)}</div><div className="mt-4 mb-2 font-semibold">Competencies</div><ul className="flex list-disc flex-col gap-1 pl-5 text-body-sm">{d.competencies.map((c) => <li key={c}>{c}</li>)}</ul></Card>
          <Card><div className="mb-2 font-semibold">Entry barriers</div><p className="text-body-sm text-ink-2">{d.entryBarriers}</p></Card>
          <Card><div className="mb-2 font-semibold">Works closely with</div><ul className="flex flex-col gap-2">{collaborators.map((c) => <li key={c.roleSlug} className="text-body-sm"><Link to={`/atlas/${c.roleSlug}`} className="font-medium text-primary">{c.name}</Link> — <span className="text-ink-2">{c.how}</span></li>)}</ul></Card>
          <Card>
            <div className="mb-2 flex items-center justify-between font-semibold">Related jobs<Link to={`/jobs?role=${role.slug}`} className="text-caption font-normal text-primary">All →</Link></div>
            {relatedJobs.length === 0 ? <p className="text-body-sm text-muted">No active postings mapped to this role yet. Sync job sources on the Jobs page.</p> : (
              <ul className="flex flex-col gap-2">{relatedJobs.map((j) => <li key={j.id}><Link to={`/jobs/${j.id}`} className="text-body-sm font-medium hover:text-primary">{j.title}</Link> {j.isDemo && <DemoBadge />}<div className="text-caption text-muted">{j.company}{j.originSite ? ` · via ${j.originSite}` : ''}</div></li>)}</ul>
            )}
          </Card>
          <Card>
            <div className="mb-2 font-semibold">Sources & references</div>
            <ul className="flex flex-col gap-2">{d.sources.map((s) => <li key={s.id} className="text-caption"><a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1 text-primary hover:underline">{s.title}<ExternalLink className="mt-0.5 size-3 shrink-0" /></a><div className="text-muted">{s.publisher} · accessed {s.accessed}</div></li>)}</ul>
            <p className="mt-3 text-caption text-muted">Live market observations for this role come from ingested job postings — see Job Market.</p>
          </Card>
        </aside>
      </div>
    </>
  );
}
