import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import type { Role } from '../lib/types';
import { ButtonLink, Card, cx, Notice, Pill, Section } from './ui';

type Level = 'junior' | 'middle' | 'senior';
interface Requirement { skillSlug: string; skillName: string; category: string; requiredLevel: number; critical: boolean }
const LEVELS: Level[] = ['junior', 'middle', 'senior'];
const SHIFT = { junior: -1, middle: 0, senior: 1 };
const DEPTH = ['Awareness: explain the basics', 'Guided practice: complete a defined task with support', 'Independent delivery: handle routine work and explain decisions', 'Advanced practice: solve complex problems and review others’ work', 'Expert practice: set standards and guide work across teams'];
const STAGES = {
  junior: { title: 'Become a Junior', scope: 'Deliver a clearly scoped task with guidance.', ready: ['Complete a small piece of work from brief to review, and explain your decisions.', 'Use feedback to improve the result and identify when you need help.'], next: 'To reach Middle: move from completing assigned tasks to owning an end-to-end outcome independently.' },
  middle: { title: 'Junior → Middle', scope: 'Own an end-to-end outcome independently.', ready: ['Clarify an incomplete brief, plan the work and deliver it with appropriate quality checks.', 'Explain trade-offs, coordinate dependencies and resolve routine issues without step-by-step guidance.'], next: 'To reach Senior: handle ambiguity, make decisions that affect others and improve how the team delivers.' },
  senior: { title: 'Middle → Senior', scope: 'Lead complex work and improve outcomes beyond your own tasks.', ready: ['Frame an ambiguous problem, compare options and make risks and success measures explicit.', 'Review and mentor others, align stakeholders and show sustained improvements across multiple deliveries.'], next: 'After Senior: deepen specialist expertise or pursue technical leadership, people leadership or an adjacent role.' },
};

// Editorial examples of evidence, grouped by the kind of work each career family delivers.
const EVIDENCE: Record<string, [string, string, string]> = {
  'software-engineering': ['A working feature with tests, setup instructions and a walkthrough of your code.', 'A shipped feature covering design, integration, release and follow-up fixes; document the trade-offs.', 'A cross-service or product-wide improvement with a design proposal, rollout plan and measured quality or reliability results.'],
  'ai-data': ['A reproducible analysis, pipeline or AI prototype with a baseline, validation and documented limitations.', 'An end-to-end data or AI deliverable with evaluation, data-quality checks and monitoring of its outputs.', 'An approach used by multiple projects, with evaluation standards, governance decisions and measured business impact.'],
  'cloud-devops': ['A repeatable lab or environment configuration with an operational runbook and recovery exercise.', 'An independently operated workload with automation, monitoring, a recovery plan and a documented incident review.', 'A platform or reliability improvement across services with adoption, risk, cost and operational results.'],
  cybersecurity: ['A lab investigation or control implementation with findings, evidence and clear escalation steps.', 'An assessment, investigation or security change owned end to end with prioritized remediation and validation.', 'A security program or architecture decision with threat analysis, stakeholder alignment and measured risk reduction.'],
  'business-analysis': ['A requirements pack for a defined feature: process flow, acceptance criteria and traceability.', 'A project discovery with stakeholder interviews, conflicting needs resolved and requirements validated through delivery.', 'A multi-team scope or process change with decision records, impact measures and coaching of other analysts.'],
  'product-management': ['A feature brief explaining the user problem, evidence, priorities and success criteria.', 'A product-area discovery and release with prioritization, stakeholder alignment and a post-launch outcome review.', 'A strategy spanning several initiatives with explicit trade-offs, investment decisions and sustained outcome measures.'],
  'project-delivery': ['A workstream plan with dependencies, status updates, risks and follow-through on actions.', 'A completed project or delivery cycle with scope, risk, stakeholder decisions and an outcome review.', 'A multi-team program or delivery improvement with governance, dependency resolution and measurable results.'],
  'ux-research': ['A small study or experience improvement with a clear question, rationale and documented findings.', 'An independently led research or UX project connecting evidence to product decisions and validation.', 'A research or experience strategy across teams with reusable practices and evidence of adoption and impact.'],
  'ui-product-design': ['A coherent flow and prototype using an existing design system, including key states and accessibility checks.', 'An end-to-end feature design from problem framing to validation, handoff and implementation review.', 'A product-wide design direction or system improvement with rationale, team adoption and measured usability results.'],
  'quality-engineering': ['Test cases or automated checks for a feature with reproducible defect reports.', 'A risk-based test strategy for a release with maintainable automation and clear release evidence.', 'A quality improvement across teams with test architecture, coaching and measured escaped-defect or delivery results.'],
  'tech-leadership': ['Prior delivery experience in an engineering or related role; this is generally not an entry-level track.', 'A system design or team initiative with decision records, delivery ownership and stakeholder alignment.', 'A multi-team architecture or leadership outcome with long-term trade-offs, coaching and measured organizational impact.'],
};

export function CareerProgression({ role, familySlug, requirements, hasRoadmap }: { role: Role; familySlug: string; requirements: Requirement[]; hasRoadmap: boolean }) {
  const available = LEVELS.filter((l) => !/^n\/a/i.test(role.details.levels[l].trim()));
  const [selected, setSelected] = useState<Level>(available[0] ?? 'middle');
  const level = available.includes(selected) ? selected : available[0] ?? 'middle';
  const stage = STAGES[level];
  const index = LEVELS.indexOf(level);
  const target = (r: Requirement, l: Level) => Math.min(5, Math.max(1, r.requiredLevel + SHIFT[l]));
  const evidence = EVIDENCE[familySlug]?.[index];
  return (
    <section id="career-path" className="scroll-mt-6">
      <Section title="Career path & level requirements" description={`Explore what it takes to enter and grow as a ${role.name}. Select a stage to see skills, work evidence and promotion criteria.`}>
        <Notice className="mb-4">CareerPilot editorial guide. Titles and promotion criteria vary by employer; years are context, not proof of readiness. Skill targets use the same level adjustments as Role matching.</Notice>
        {available.length < 3 && <p className="mb-4 text-body-sm text-ink-2">This role usually builds on prior professional experience. A Junior stage is not defined here; see “Common paths into this role” below for entry routes.</p>}
        <div className="mb-4 grid gap-3 sm:grid-cols-3" role="group" aria-label="Career stage">
          {available.map((l, i) => <button key={l} type="button" aria-pressed={level === l} onClick={() => setSelected(l)} className={cx('card p-4 text-left transition-colors hover:border-primary/40', level === l && 'border-primary bg-primary-soft')}>
            <div className="mb-2 flex items-center justify-between"><span className="text-caption text-muted">Stage {i + 1}</span>{i < available.length - 1 && <ArrowRight className="size-4 text-muted" />}</div>
            <div className="font-semibold capitalize">{l}</div><p className="mt-1 text-caption text-muted">{role.minYears[l]}+ years typical</p>
            <p className="mt-2 text-body-sm text-ink-2">{role.details.levels[l]}</p>
          </button>)}
        </div>
        <Card className="mb-4">
          <div className="mb-4"><h3 className="text-heading-sm font-semibold">{available.length < 3 && level === available[0] ? `Enter the ${role.name} track` : stage.title}</h3><p className="mt-1 text-body-sm text-muted">{stage.scope}</p></div>
          <div className="grid gap-5 md:grid-cols-2">
            <div><h4 className="mb-2 font-semibold">What you need to demonstrate</h4><ul className="flex flex-col gap-2 text-body-sm text-ink-2">{[role.details.levels[level], ...stage.ready].map((s) => <li key={s} className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" /><span>{s}</span></li>)}</ul></div>
            <div><h4 className="mb-2 font-semibold">Work evidence to prepare</h4>{evidence && <p className="text-body-sm text-ink-2">{evidence}</p>}<p className="mt-2 text-body-sm text-ink-2">Explain how your work demonstrates {role.details.competencies.slice(0, 3).join(', ')}. Record your own contribution, feedback and the result.</p><div className="mt-3 flex flex-wrap gap-1.5">{role.details.tools.slice(0, 3).map((t) => <Pill key={t}>{t}</Pill>)}</div></div>
          </div>
          <div className="mt-5 border-t border-line pt-4"><div className="mb-1 text-caption font-semibold text-muted">NEXT MILESTONE</div><p className="text-body-sm">{stage.next}</p></div>
          <div className="mt-4 flex flex-wrap gap-2"><ButtonLink to={`/matching?role=${role.slug}&level=${level}`} variant="primary">Check my gaps for {level}</ButtonLink>{hasRoadmap && <ButtonLink to={`/roadmap/${role.slug}`} variant="ghost">Open skill roadmap</ButtonLink>}</div>
        </Card>
        <Card>
          <h3 className="mb-1 font-semibold capitalize">Skills to reach {level}</h3>
          <p className="mb-4 text-caption text-muted">Critical skills are essential. Compare your evidence with each target; a score alone does not establish promotion readiness.</p>
          <div className="overflow-x-auto"><table className="w-full min-w-[440px] text-body-sm">
            <thead><tr className="border-b border-line text-left text-caption text-muted"><th className="py-2 font-medium">Skill</th>{available.map((l) => <th key={l} className={cx('px-3 py-2 font-medium capitalize', l === level && 'bg-primary-soft text-primary')}>{l}</th>)}</tr></thead>
            <tbody>{requirements.map((r) => <tr key={r.skillSlug} className="border-b border-line last:border-0"><td className="py-3 pr-3"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{r.skillName}</span>{r.critical && <Pill tone="red">Critical</Pill>}</div><p className="mt-1 text-caption text-muted">{DEPTH[target(r, level) - 1]}</p></td>{available.map((l) => <td key={l} className={cx('px-3', l === level && 'bg-primary-soft font-semibold text-primary')}>L{target(r, l)}/5</td>)}</tr>)}</tbody>
          </table></div>
          <details className="mt-4 text-caption text-muted"><summary className="cursor-pointer font-medium">What do skill levels L1–L5 mean?</summary><ul className="mt-2 flex flex-col gap-1">{DEPTH.map((d, i) => <li key={d}>L{i + 1} — {d}</li>)}</ul></details>
        </Card>
      </Section>
    </section>
  );
}
