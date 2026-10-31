import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { assessmentItems, careerProfiles, careerRoles, jobs, profileItems, roadmapNodes, roadmaps, roleSkillRequirements, skills } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { yearsBetween } from '../lib/dates.js';
import { clamp, containsTerm, normalizeText, round } from '../lib/text.js';
import { criticalState, loadUserSkillMap, skillCredit, STATUS_LABEL, type UserSkillState } from './evidence.js';
import { certById } from './jobs/certs.js';

const SENIORITY_ORDER = ['intern', 'junior', 'middle', 'senior', 'lead'];
const SENIORITY_SHIFT: Record<string, number> = { intern: -2, junior: -1, middle: 0, senior: 1, lead: 1 };

export interface JobMatchSkill { slug: string; name: string; requirement: 'required' | 'preferred'; requiredLevel: number; status: string | null; statusLabel: string | null; level: number | null; credit: number | null; state: 'matched' | 'partial' | 'gap' | 'unknown' }

export interface JobMatch {
  jobId: number;
  score: number | null;
  scoreExplanation: string[];
  components: { key: string; label: string; score: number | null; weight: number; detail: string }[];
  evidenceCoverage: number;
  matchedSkills: JobMatchSkill[];
  criticalGaps: { label: string; reason: string }[];
  unknownRequirements: { label: string; reason: string }[];
  skills: JobMatchSkill[];
  recommendedAssessments: { skillSlug: string; skillName: string; reason: string }[];
  roadmapNodes: { roleSlug: string; nodeKey: string; label: string; skillSlug: string }[];
  manualChecks: string[];
  jobUrl: string | null;
  jdAvailable: boolean;
  disclaimer: string;
}

export function userSeniority(years: number | null): string | null {
  if (years == null) return null;
  return years < 2 ? 'junior' : years < 5 ? 'middle' : 'senior';
}

export interface JobMatchInputs {
  job: typeof jobs.$inferSelect;
  roleLevels: Map<string, number>;
  userSkills: Map<string, UserSkillState>;
  skillNames: Map<string, string>;
  profile: typeof careerProfiles.$inferSelect | undefined;
  totalYears: number | null;
  relevantYears: number | null;
  certificationTitles: string[];
}

/** Pure job match computation (unit-testable). */
export function computeJobMatchCore(i: JobMatchInputs): Omit<JobMatch, 'recommendedAssessments' | 'roadmapNodes'> {
  const shift = SENIORITY_SHIFT[i.job.seniority ?? 'middle'] ?? 0;
  const reqs = [
    ...i.job.requiredSkills.map((s) => ({ slug: s, requirement: 'required' as const, weight: 2 })),
    ...i.job.preferredSkills.map((s) => ({ slug: s, requirement: 'preferred' as const, weight: 1 })),
  ];
  const skillRows: JobMatchSkill[] = reqs.map((r) => {
    const requiredLevel = clamp((i.roleLevels.get(r.slug) ?? 3) + shift, 1, 5);
    const us = i.userSkills.get(r.slug);
    const c = skillCredit(us, requiredLevel);
    const gate = criticalState(us, requiredLevel);
    const state: JobMatchSkill['state'] = c.state === 'unknown' ? 'unknown' : gate === 'gap' ? 'gap' : c.level >= requiredLevel - 0.5 ? 'matched' : 'partial';
    return {
      slug: r.slug, name: i.skillNames.get(r.slug) ?? r.slug, requirement: r.requirement, requiredLevel,
      status: c.state === 'known' ? c.status : null, statusLabel: c.state === 'known' ? STATUS_LABEL[c.status] : null,
      level: c.state === 'known' ? c.level : null, credit: c.state === 'known' ? round(c.credit, 3) : null, state,
    };
  });
  const totalW = reqs.reduce((s, r) => s + r.weight, 0);
  const knownW = skillRows.reduce((s, r, idx) => s + (r.state !== 'unknown' ? reqs[idx].weight : 0), 0);
  const skillScore = knownW > 0 ? skillRows.reduce((s, r, idx) => s + (r.credit ?? 0) * reqs[idx].weight, 0) / knownW : null;
  const evidenceCoverage = totalW > 0 ? skillRows.reduce((s, r, idx) => s + (r.status === 'app_verified' || r.status === 'assessed' ? reqs[idx].weight : 0), 0) / totalW : 0;

  const components: JobMatch['components'] = [];
  components.push({ key: 'skills', label: 'Skills', weight: 0.6, score: skillScore == null ? null : Math.round(skillScore * 100), detail: totalW ? `${Math.round((knownW / totalW) * 100)}% of listed skill requirements have some evidence.` : 'No skill requirements extracted from this posting.' });

  const us = userSeniority(i.totalYears);
  let seniorityScore: number | null = null;
  if (us && i.job.seniority) {
    const diff = Math.abs(SENIORITY_ORDER.indexOf(us) - SENIORITY_ORDER.indexOf(i.job.seniority));
    seniorityScore = diff === 0 ? 1 : diff === 1 ? 0.6 : 0.2;
  }
  components.push({ key: 'seniority', label: 'Seniority', weight: 0.15, score: seniorityScore == null ? null : Math.round(seniorityScore * 100), detail: i.job.seniority ? `Posting targets ${i.job.seniority}; your experience suggests ${us ?? 'unknown'}.` : 'Seniority not stated in the posting.' });

  let expScore: number | null = null;
  if (i.job.minYears != null && i.relevantYears != null) expScore = clamp(i.relevantYears / Math.max(0.5, i.job.minYears));
  components.push({ key: 'experience', label: 'Experience', weight: 0.1, score: expScore == null ? null : Math.round(expScore * 100), detail: i.job.minYears != null ? `Asks for ${i.job.minYears}+ years; ~${round(i.relevantYears ?? 0, 1)} relevant years in your confirmed history.` : 'No minimum years stated.' });

  let locScore: number | null = null;
  const modes = i.profile?.workModes ?? [];
  const markets = i.profile?.markets ?? [];
  if ((modes.length || markets.length) && (i.job.workMode || i.job.market)) {
    const modeOk = !i.job.workMode || !modes.length || modes.includes(i.job.workMode);
    const marketOk = i.job.workMode === 'remote' || !i.job.market || !markets.length || markets.includes(i.job.market);
    locScore = modeOk && marketOk ? 1 : modeOk || marketOk ? 0.5 : 0.1;
  }
  components.push({ key: 'location', label: 'Location & work mode', weight: 0.15, score: locScore == null ? null : Math.round(locScore * 100), detail: `${i.job.workMode ?? 'work mode unknown'} · ${i.job.location ?? i.job.market ?? 'location unknown'}` });

  const knownComps = components.filter((c) => c.score != null);
  const wSum = knownComps.reduce((s, c) => s + c.weight, 0);
  const score = wSum > 0 && skillScore != null ? Math.round(knownComps.reduce((s, c) => s + c.weight * (c.score ?? 0), 0) / wSum) : null;

  const criticalGaps: JobMatch['criticalGaps'] = skillRows.filter((s) => s.requirement === 'required' && s.state === 'gap').map((s) => ({ label: s.name, reason: `Required at level ${s.requiredLevel}; your evidence shows ${s.level}.` }));
  const unknownRequirements: JobMatch['unknownRequirements'] = skillRows.filter((s) => s.state === 'unknown').map((s) => ({ label: s.name, reason: s.requirement === 'required' ? 'Required — no evidence in your profile yet.' : 'Preferred — no evidence yet.' }));
  for (const u of i.job.unknownRequirements) unknownRequirements.push({ label: u, reason: 'Mentioned in the JD but not in the CareerPilot skill taxonomy.' });

  const certTitles = i.certificationTitles.map((t) => ` ${normalizeText(t)} `);
  for (const c of i.job.certifications) {
    const ref = certById(c.id);
    const terms = [ref?.name, ref?.shortName, c.name].filter(Boolean) as string[];
    const held = certTitles.some((t) => terms.some((term) => containsTerm(t, term)));
    if (held) continue;
    if (c.requirement === 'required') criticalGaps.push({ label: `Certification: ${ref?.shortName ?? c.name ?? c.id}`, reason: 'Listed as required; not found among your confirmed certifications.' });
    else unknownRequirements.push({ label: `Certification: ${ref?.shortName ?? c.name ?? c.id}`, reason: `${c.requirement === 'preferred' ? 'Preferred' : 'Mentioned'} in the posting; not in your profile.` });
  }

  const explanation: string[] = [];
  if (score == null) explanation.push('Not enough evidence to compute a match: add skills, import your CV or take an assessment.');
  else explanation.push(`Weighted from ${knownComps.map((c) => `${c.label.toLowerCase()} ${c.score}%`).join(', ')}; unknown components are excluded rather than scored as zero.`);
  if (criticalGaps.length) explanation.push(`${criticalGaps.length} critical gap(s) — the score does not offset these.`);
  if (!i.job.description.trim()) explanation.push('The source does not publish JD text; requirements were derived from certification mentions only. Paste the full JD for a complete analysis.');

  return {
    jobId: i.job.id, score, scoreExplanation: explanation, components, evidenceCoverage: round(evidenceCoverage, 2),
    matchedSkills: skillRows.filter((s) => s.state === 'matched'), criticalGaps, unknownRequirements, skills: skillRows,
    manualChecks: i.job.qualifications.map((q) => `Check qualification: ${q}`),
    jobUrl: i.job.canonicalUrl, jdAvailable: !!i.job.description.trim(),
    disclaimer: 'A match score summarizes overlap with the posting; it is not a probability of being hired.',
  };
}

async function visibleJob(ctx: AppContext, userId: number, jobId: number) {
  const [job] = await ctx.db.select().from(jobs).where(and(eq(jobs.id, jobId), or(isNull(jobs.ownerUserId), eq(jobs.ownerUserId, userId))));
  if (!job) throw notFound('Job');
  return job;
}

export async function loadJobMatchUser(ctx: AppContext, userId: number) {
  const [profile] = await ctx.db.select().from(careerProfiles).where(eq(careerProfiles.userId, userId));
  const items = await ctx.db.select().from(profileItems).where(and(eq(profileItems.userId, userId), eq(profileItems.confirmed, true)));
  const work = items.filter((i) => i.kind === 'work');
  const totalYears = work.length ? work.reduce((s, w) => s + yearsBetween(w.startDate, w.endDate, ctx.now()), 0) : profile?.yearsExperience ?? null;
  return { profile, work, totalYears, certificationTitles: items.filter((i) => i.kind === 'certification').map((i) => i.title), userSkills: await loadUserSkillMap(ctx, userId) };
}

export async function computeJobMatch(ctx: AppContext, userId: number, jobId: number, pre?: Awaited<ReturnType<typeof loadJobMatchUser>>): Promise<JobMatch> {
  const job = await visibleJob(ctx, userId, jobId);
  const u = pre ?? (await loadJobMatchUser(ctx, userId));
  const allSkillRows = await ctx.db.select({ id: skills.id, slug: skills.slug, name: skills.name }).from(skills);
  const skillNames = new Map(allSkillRows.map((s) => [s.slug, s.name]));
  const roleLevels = new Map<string, number>();
  if (job.normalizedRoleId) {
    const rr = await ctx.db.select({ slug: skills.slug, level: roleSkillRequirements.requiredLevel }).from(roleSkillRequirements).innerJoin(skills, eq(skills.id, roleSkillRequirements.skillId)).where(eq(roleSkillRequirements.roleId, job.normalizedRoleId));
    for (const r of rr) roleLevels.set(r.slug, r.level);
  }
  const jdSkills = [...job.requiredSkills, ...job.preferredSkills];
  const relevant = u.work.length ? u.work.reduce((s, w) => (w.skillSlugs.filter((x) => jdSkills.includes(x)).length >= 2 ? s + yearsBetween(w.startDate, w.endDate, ctx.now()) : s), 0) : null;
  const core = computeJobMatchCore({ job, roleLevels, userSkills: u.userSkills, skillNames, profile: u.profile, totalYears: u.totalYears, relevantYears: relevant, certificationTitles: u.certificationTitles });

  // Recommend assessments for unverified or unknown skills that the item bank can assess.
  const needEvidence = core.skills.filter((s) => s.state === 'unknown' || s.status === 'self_reported' || s.status === 'extracted_claim' || s.state === 'partial');
  const ids = allSkillRows.filter((s) => needEvidence.some((n) => n.slug === s.slug)).map((s) => s.id);
  const bank = ids.length ? await ctx.db.select({ skillId: assessmentItems.skillId }).from(assessmentItems).where(inArray(assessmentItems.skillId, ids)) : [];
  const assessable = new Set(bank.map((b) => allSkillRows.find((s) => s.id === b.skillId)!.slug));
  const recommendedAssessments = needEvidence.filter((s) => assessable.has(s.slug)).map((s) => ({
    skillSlug: s.slug, skillName: s.name,
    reason: s.state === 'unknown' ? 'No evidence yet — assess to find out where you stand.' : s.state === 'partial' ? 'Below the level this posting needs — reassess after practice.' : `${s.statusLabel} only — an assessment can verify it.`,
  }));

  // Roadmap nodes covering gaps (prefer the job's normalized role roadmap).
  const gapSlugs = core.skills.filter((s) => s.state !== 'matched').map((s) => s.slug);
  const gapIds = allSkillRows.filter((s) => gapSlugs.includes(s.slug)).map((s) => s.id);
  let roadmapNodesOut: JobMatch['roadmapNodes'] = [];
  if (gapIds.length) {
    const rows = await ctx.db.select({ key: roadmapNodes.key, label: roadmapNodes.label, skillId: roadmapNodes.skillId, roleSlug: careerRoles.slug, roleId: careerRoles.id })
      .from(roadmapNodes).innerJoin(roadmaps, eq(roadmaps.id, roadmapNodes.roadmapId)).innerJoin(careerRoles, eq(careerRoles.id, roadmaps.roleId))
      .where(inArray(roadmapNodes.skillId, gapIds));
    const preferred = rows.filter((r) => r.roleId === job.normalizedRoleId);
    const chosen = preferred.length ? preferred : rows;
    const seen = new Set<string>();
    roadmapNodesOut = chosen.filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true))).map((r) => ({ roleSlug: r.roleSlug, nodeKey: r.key, label: r.label, skillSlug: allSkillRows.find((s) => s.id === r.skillId)!.slug }));
  }
  return { ...core, recommendedAssessments, roadmapNodes: roadmapNodesOut };
}
