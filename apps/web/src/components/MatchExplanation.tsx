import { useState } from 'react';
import type { RequirementRow, RoleMatch } from '../lib/types';
import { Button, ButtonLink, Card, cx, Notice, Pill, Section, SkillStatusPill } from './ui';

const number = (v: number) => Number(v.toFixed(2)).toLocaleString();
const deduction = (v: number) => v > 0 ? `−${number(v)} pts` : '0 pts';
const assessed = (status: string | null) => status === 'app_verified' || status === 'assessed';

function comparison(r: RequirementRow) {
  if (r.state === 'unknown') return { label: 'Not recorded', tone: 'neutral' as const, action: 'Add evidence or assess first; a gap is not established.' };
  if (r.levelAssumed) return { label: 'Level unknown', tone: 'yellow' as const, action: 'Assess this skill to replace the assumed level with observed evidence.' };
  if ((r.level ?? 0) < r.requiredLevel) return { label: assessed(r.status) ? 'Below target (assessed)' : 'Below target (self-reported)', tone: 'red' as const, action: `Build from L${r.level} toward L${r.requiredLevel}, then reassess.` };
  if (!assessed(r.status)) return { label: 'At target (claimed)', tone: 'yellow' as const, action: 'Your stated level meets the target. Validate it with an assessment.' };
  return { label: 'At target (assessed)', tone: 'green' as const, action: r.status === 'app_verified' ? 'Maintain this strength and use it in role-specific practice.' : 'Level meets the target; complete the verification requirements for full evidence credit.' };
}

export function CapabilityExplanation({ match: m }: { match: RoleMatch }) {
  const b = m.capabilityBreakdown;
  const score = m.dimensions.find((d) => d.key === 'capability')?.score;
  const claims = m.requirements.filter((r) => r.status === 'self_reported' || r.status === 'extracted_claim');
  const drivers = b.drivers.filter((d) => d.evidenceLoss + d.levelLoss >= 0.1).slice(0, 3);
  return <Card className="mb-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-heading-sm font-semibold">{score == null ? 'Why capability is unknown' : `Why your capability score is ${score}/100`}</h2><a href="#skill-comparison" className="text-body-sm text-primary hover:underline">Compare my skills ↓</a></div>
    {b.skillScore == null ? <p className="mt-3 text-body-sm text-ink-2">No required skill has recorded evidence yet. Add your existing skills or take an assessment to establish a baseline. Unknown is not a score of zero.</p> : <>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md bg-primary-soft p-4"><div className="text-caption text-muted">How the score is calculated</div><p className="mt-1 break-words text-heading-sm font-semibold">{number(b.skillScore)} × {Math.round(b.skillWeight * 100)}%{b.experiencePoints != null && <> + {number(b.experienceScore!)} × {Math.round(b.experienceWeight * 100)}%</>} ≈ {score}</p><p className="mt-2 text-caption text-ink-2">{number(b.skillPoints!)} points from evidence-adjusted skills{b.experiencePoints != null ? ` + ${number(b.experiencePoints)} from relevant experience.` : '. Experience is not included because relevant work history is unknown.'}</p></div>
        <div className="rounded-md bg-surface-2 p-4"><div className="text-caption text-muted">What the system knows</div><p className="mt-1 text-body-sm">Recorded skills cover <b>{Math.round(b.knownCoverage * 100)}%</b> of the role's requirement weight. {b.unknownSkills} skill(s) are not recorded.</p><p className="mt-2 text-caption text-muted">Unrecorded skills are excluded from the capability calculation; they lower completeness, not your known-skill score.{b.assumedSkills > 0 && ` ${b.assumedSkills} recorded skill(s) use an assumed L2.5 because their level is unknown.`}</p></div>
      </div>
      <h3 className="mt-5 mb-2 font-semibold">What keeps the score below 100?</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-line p-3"><div className="text-caption text-muted">Evidence adjustment</div><div className="mt-1 text-heading-sm font-semibold">{deduction(b.evidenceLossPoints ?? 0)}</div><p className="mt-1 text-caption text-ink-2">Self-reported: 60% credit. CV claim: 50%. Assessed: 85%. App-verified: 100%.{claims.length > 0 && ` ${claims.length} requirement(s) currently rely on your own claims.`} This reflects evidence status, not a finding that you lack the skill.</p></div>
        <div className="rounded-md border border-line p-3"><div className="text-caption text-muted">Level below the target</div><div className="mt-1 text-heading-sm font-semibold">{deduction(b.levelLossPoints ?? 0)}</div><p className="mt-1 text-caption text-ink-2">The recorded or assumed level is compared with the selected {m.level} target. Assumed and self-reported levels still need assessment.</p></div>
        <div className="rounded-md border border-line p-3"><div className="text-caption text-muted">Relevant experience</div><div className="mt-1 text-heading-sm font-semibold">{b.experienceLossPoints == null ? 'Not included' : deduction(b.experienceLossPoints)}</div><p className="mt-1 text-caption text-ink-2">{b.relevantYears == null ? 'Add relevant work history if you want it considered.' : `${b.relevantYears} relevant years vs ${b.typicalYears}+ typical. Experience contribution is capped at the target; extra years do not offset skill-evidence adjustments.`}</p></div>
      </div>
      {drivers.length > 0 && <div className="mt-4"><h3 className="mb-2 text-body-sm font-semibold">Largest score drivers</h3><ul className="flex flex-col gap-2">{drivers.map((d) => <li key={d.skillSlug} className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-md bg-surface-2 px-3 py-2 text-body-sm"><a href={`#skill-${d.skillSlug}`} className="font-medium text-primary hover:underline">{d.skillName}</a><span className="text-caption text-muted">Evidence −{number(d.evidenceLoss)} pts · level −{number(d.levelLoss)} pts</span></li>)}</ul></div>}
    </>}
    <p className="mt-4 text-caption text-muted">The critical-skill gate is a separate requirement and does not subtract points again. Market and interest scores do not lower capability. Values are rounded.</p>
  </Card>;
}

export function TransferableSkills({ match: m }: { match: RoleMatch }) {
  const t = m.skillTransfer;
  const atTarget = t.direct.filter((r) => r.level != null && r.level >= r.requiredLevel);
  return <Section title="Skills you can carry into this role" description={`Compare the skills already recorded in your profile with ${m.role.name} requirements.${t.currentRole ? ` Your current role: ${t.currentRole.name}.` : ''}`}>
    <div className="grid gap-4 md:grid-cols-2">
      <Card><h3 className="mb-1 font-semibold">Directly matching skills · {t.direct.length}</h3><p className="mb-3 text-caption text-muted">{atTarget.length} recorded level(s) meet the selected target. Claims remain unverified until assessed. A role title alone does not establish any of these skills.</p>
        {t.direct.length ? <ul className="flex max-h-80 flex-col gap-3 overflow-y-auto">{t.direct.map((r) => <li key={r.skillSlug} className="border-b border-line pb-3 last:border-0"><div className="flex flex-wrap items-center gap-2"><a href={`#skill-${r.skillSlug}`} className="text-body-sm font-medium text-primary hover:underline">{r.skillName}</a><SkillStatusPill status={r.status} /></div><p className="mt-1 text-caption text-ink-2">Your recorded level: {r.level == null ? 'unknown' : `L${r.level}`} → target L{r.requiredLevel}{r.level != null && r.level < r.requiredLevel ? ' · build further' : r.level == null ? ' · assess level' : assessed(r.status) ? ' · assessed level meets target' : ' · stated level meets target; assess next'}</p>{r.roleShared && <p className="mt-1 text-caption text-muted">Also required in the {t.currentRole?.name} skill matrix.</p>}{r.examples.length > 0 && <p className="mt-1 text-caption text-muted">Your linked history (self-reported): {r.examples.join('; ')}</p>}</li>)}</ul> : <p className="text-body-sm text-muted">No direct overlaps are recorded yet. Add existing skills to your profile to compare them.</p>}
      </Card>
      <Card><h3 className="mb-1 font-semibold">Supporting skills · {t.supporting.length}</h3><p className="mb-3 text-caption text-muted">These are prerequisites in the skill taxonomy. They can support learning the target skill but do not prove it or add direct capability points.</p>
        {t.supporting.length ? <ul className="flex max-h-64 flex-col gap-3 overflow-y-auto">{t.supporting.map((r) => <li key={r.skillSlug}><div className="flex flex-wrap items-center gap-2 text-body-sm font-medium">{r.skillName}<SkillStatusPill status={r.status} /></div><p className="mt-1 text-caption text-muted">{r.level == null ? 'Level unknown' : `Recorded L${r.level}`} · Foundation for: {r.supports.join(', ')}</p></li>)}</ul> : <p className="text-body-sm text-muted">No additional prerequisite links were found in the current taxonomy.</p>}
        {t.other.length > 0 && <details className="mt-4 border-t border-line pt-3"><summary className="cursor-pointer text-body-sm text-primary">Other profile skills · {t.other.length}</summary><p className="mt-2 text-caption text-muted">No direct requirement or prerequisite mapping is recorded for this target. These skills are not counted in its capability score.</p><ul className="mt-2 flex flex-col gap-2">{t.other.map((r) => <li key={r.skillSlug} className="flex flex-wrap items-center gap-2 text-caption">{r.skillName}<SkillStatusPill status={r.status} /></li>)}</ul></details>}
      </Card>
    </div>
    {!t.currentRole && <Notice className="mt-3">Set your current role in <a href="/profile" className="text-primary underline">your profile</a> to see shared role requirements. Your recorded skills are compared even without a current role.</Notice>}
  </Section>;
}

export function SkillComparison({ match: m, onAssess, assessing }: { match: RoleMatch; onAssess: (slugs: string[]) => void; assessing: boolean }) {
  const [filter, setFilter] = useState<'all' | 'at-target' | 'below' | 'evidence' | 'unknown'>('all');
  const rows = m.requirements.filter((r) => filter === 'all' || filter === 'at-target' && !r.levelAssumed && r.level != null && r.level >= r.requiredLevel || filter === 'below' && !r.levelAssumed && r.level != null && r.level < r.requiredLevel || filter === 'evidence' && r.state === 'known' && (r.levelAssumed || r.status !== 'app_verified') || filter === 'unknown' && r.state === 'unknown');
  const knownCoverage = m.capabilityBreakdown.knownCoverage;
  return <section id="skill-comparison" className="scroll-mt-5">
    <Section title="Your skills vs role requirements" description={`Target: ${m.level} ${m.role.name}. Each row explains the skill requirement, your evidence, the score credit and the next step.`}>
      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Filter skill comparison">{([['all', 'All skills'], ['at-target', 'At target level'], ['below', 'Below target level'], ['evidence', 'Needs stronger evidence'], ['unknown', 'Not recorded']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)} className={cx('rounded-full border px-3 py-1 text-caption', filter === value ? 'border-primary bg-primary-soft text-primary' : 'border-line')}>{label}</button>)}</div>
      <Card padded={false} className="overflow-x-auto"><table className="w-full min-w-[760px] text-body-sm">
        <thead><tr className="border-b border-line text-left text-caption text-muted"><th className="px-4 py-3 font-medium">Required skill</th><th className="px-3 font-medium">Need</th><th className="px-3 font-medium">Your evidence</th><th className="px-3 font-medium">How this counts</th><th className="px-4 font-medium">Comparison & next step</th></tr></thead>
        <tbody>{rows.map((r) => {
          const state = comparison(r);
          const driver = m.capabilityBreakdown.drivers.find((d) => d.skillSlug === r.skillSlug);
          return <tr key={r.skillSlug} id={`skill-${r.skillSlug}`} className="scroll-mt-5 border-b border-line last:border-0">
            <td className="max-w-48 px-4 py-4 align-top"><div className="font-medium">{r.skillName}</div><div className="mt-1 flex flex-wrap items-center gap-1.5">{r.critical && <Pill tone="red">critical</Pill>}<span className="text-caption text-muted">{number(r.normalizedWeight * 100)}% role weight</span></div></td>
            <td className="px-3 py-4 align-top">L{r.requiredLevel}</td>
            <td className="max-w-44 px-3 py-4 align-top"><SkillStatusPill status={r.status ?? 'unknown'} /><p className="mt-1 text-caption">{r.level == null ? 'Level not known' : `L${r.level}${r.levelAssumed ? ' (assumed, not measured)' : ''}`}</p><details className="mt-2 text-caption text-muted"><summary className="cursor-pointer text-primary">Why this evidence status?</summary><p className="mt-1">{r.evidenceReason}</p></details></td>
            <td className="max-w-44 px-3 py-4 align-top">{r.credit == null ? <p className="text-caption text-muted">Excluded from known-skill score. Add evidence to improve coverage.</p> : <><div className="font-medium">{number(r.credit * 100)}% skill credit</div><p className="mt-1 text-caption text-muted">{number((r.levelFit ?? 0) * 100)}% level fit × {number((r.trust ?? 0) * 100)}% evidence factor</p>{driver && <p className="mt-1 text-caption text-muted">+{number(driver.pointsEarned)} capability pts{knownCoverage < 1 ? ' (weight normalized over known skills)' : ''}</p>}</>}</td>
            <td className="max-w-56 px-4 py-4 align-top"><Pill tone={state.tone}>{state.label}</Pill><p className="mt-2 text-caption text-ink-2">{state.action}</p><div className="mt-2 flex flex-wrap gap-2">{(r.status !== 'app_verified' || (r.level ?? 0) < r.requiredLevel) && <Button variant="text" className="px-0 py-1 text-caption" disabled={assessing} onClick={() => onAssess([r.skillSlug])}>Assess skill</Button>}{(r.levelAssumed || r.state === 'unknown' || (r.level ?? 0) < r.requiredLevel) && <ButtonLink to={`/roadmap/${m.role.slug}`} variant="text" className="px-0 py-1 text-caption">{r.levelAssumed || r.state === 'unknown' ? 'Explore this skill' : 'Build this skill'}</ButtonLink>}</div>{r.estimatedGapHours > 0 && <p className="mt-1 text-caption text-muted">~{number(r.estimatedGapHours)} h study estimate{r.levelAssumed || r.state === 'unknown' ? ' · uncertain until assessed' : ''}</p>}</td>
          </tr>;
        })}</tbody>
      </table>{!rows.length && <p className="p-4 text-body-sm text-muted">No skills in this category for the selected target.</p>}</Card>
      <p className="mt-3 text-caption text-muted">A credit percentage is a scoring input, not a pass rate or a hiring probability. Filters can overlap: a skill can be both below target and awaiting stronger evidence.</p>
    </Section>
  </section>;
}
