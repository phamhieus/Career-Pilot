import { and, eq, gte, inArray, isNull } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import {
  careerFamilies, careerProfiles, careerRoles, careerTransitions, jobSources, jobs, learningPlans, learningTasks, marketObservations,
  profileItems, roleSkillRequirements, skills,
} from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { depthMap } from '../lib/graph.js';
import { yearsBetween } from '../lib/dates.js';
import { clamp, round } from '../lib/text.js';
import { criticalState, loadUserSkillMap, skillCredit, STATUS_LABEL, type UserSkillState } from './evidence.js';

export type Level = 'junior' | 'middle' | 'senior';
export interface Dimension {
  key: 'capability' | 'interest' | 'growth' | 'market';
  label: string;
  score: number | null; // 0..100, null = unknown (insufficient evidence)
  coverage: number; // 0..1 share of the inputs that were known
  confidence: 'low' | 'medium' | 'high' | 'unknown';
  explanation: string[];
}
export interface RequirementRow {
  skillSlug: string; skillName: string; category: string; weight: number; normalizedWeight: number; requiredLevel: number; critical: boolean;
  state: 'unknown' | 'known'; status: string | null; statusLabel: string | null; level: number | null; levelAssumed: boolean; credit: number | null;
  gate: 'met' | 'claimed' | 'gap' | 'unknown' | null; estimatedGapHours: number;
  trust: number | null; levelFit: number | null; evidenceReason: string;
}
export interface CapabilityBreakdown {
  skillScore: number | null; levelOnlySkillScore: number | null; experienceScore: number | null;
  relevantYears: number | null; typicalYears: number; skillWeight: number; experienceWeight: number;
  skillPoints: number | null; experiencePoints: number | null; evidenceLossPoints: number | null; levelLossPoints: number | null; experienceLossPoints: number | null;
  knownCoverage: number; unknownSkills: number; assumedSkills: number;
  drivers: { skillSlug: string; skillName: string; pointsEarned: number; evidenceLoss: number; levelLoss: number }[];
}
export interface SkillTransfer {
  currentRole: { slug: string; name: string } | null;
  direct: { skillSlug: string; skillName: string; status: string; level: number | null; requiredLevel: number; roleShared: boolean; examples: string[] }[];
  supporting: { skillSlug: string; skillName: string; status: string; level: number | null; supports: string[] }[];
  other: { skillSlug: string; skillName: string; status: string; level: number | null }[];
}
export interface RoleMatch {
  role: { id: number; slug: string; name: string; family: string };
  level: Level;
  dimensions: Dimension[];
  criticalGate: { status: 'clear' | 'needs_evidence' | 'blocked'; gaps: string[]; unverified: string[]; message: string };
  requirements: RequirementRow[];
  capabilityBreakdown: CapabilityBreakdown;
  skillTransfer: SkillTransfer;
  transferableFrom: { roleSlug: string; difficulty: number; typicalMonths: number; rationale: string } | null;
  disclaimer: string;
}

const LEVEL_SHIFT: Record<Level, number> = { junior: -1, middle: 0, senior: 1 };
const DISCLAIMER = 'These are four independent indicators to guide exploration — not probabilities of being hired. Unknown means CareerPilot lacks evidence, not that you lack the skill.';

const confidenceFrom = (coverage: number): Dimension['confidence'] => (coverage >= 0.7 ? 'high' : coverage >= 0.4 ? 'medium' : coverage > 0 ? 'low' : 'unknown');

/** Normalizes weights so they sum to 1 (configurable matrices may use any positive scale). */
export function normalizeWeights<T extends { weight: number }>(rows: T[]): (T & { normalizedWeight: number })[] {
  const total = rows.reduce((s, r) => s + Math.max(0, r.weight), 0);
  return rows.map((r) => ({ ...r, normalizedWeight: total > 0 ? Math.max(0, r.weight) / total : 0 }));
}

export interface CapabilityInput {
  requirements: { skillSlug: string; skillName: string; category: string; weight: number; requiredLevel: number; critical: boolean; baseHours: number }[];
  userSkills: Map<string, UserSkillState>;
  relevantYears: number | null;
  minYears: number;
}

/** Pure capability computation (exported for unit tests). */
export function computeCapability(input: CapabilityInput): { dimension: Dimension; rows: RequirementRow[]; gate: RoleMatch['criticalGate']; breakdown: CapabilityBreakdown } {
  const rows = normalizeWeights(input.requirements).map((r): RequirementRow => {
    const us = input.userSkills.get(r.skillSlug);
    const c = skillCredit(us, r.requiredLevel);
    const level = c.state === 'known' ? c.level : null;
    const gapFrac = level == null ? 1 : clamp((r.requiredLevel - level) / r.requiredLevel);
    return {
      skillSlug: r.skillSlug, skillName: r.skillName, category: r.category, weight: r.weight, normalizedWeight: r.normalizedWeight, requiredLevel: r.requiredLevel, critical: r.critical,
      state: c.state, status: c.state === 'known' ? c.status : null, statusLabel: c.state === 'known' ? STATUS_LABEL[c.status] : null,
      level, levelAssumed: c.state === 'known' ? c.levelAssumed : false, credit: c.state === 'known' ? round(c.credit, 3) : null,
      gate: r.critical ? criticalState(us, r.requiredLevel) : null,
      estimatedGapHours: round(r.baseHours * (r.requiredLevel / 3) * gapFrac, 1),
      trust: c.state === 'known' ? c.trust : null,
      levelFit: level == null ? null : Math.min(1, level / Math.max(1, r.requiredLevel)),
      evidenceReason: us?.reason || (us ? 'Recorded in your profile.' : 'No evidence recorded for this skill. This does not establish a skill gap.'),
    };
  });
  const known = rows.filter((r) => r.state === 'known');
  const coverage = known.reduce((s, r) => s + r.normalizedWeight, 0);
  const skillScore = coverage > 0 ? known.reduce((s, r) => s + r.normalizedWeight * (r.credit ?? 0), 0) / coverage : null;
  const verifiedCoverage = rows.filter((r) => r.status === 'app_verified' || r.status === 'assessed').reduce((s, r) => s + r.normalizedWeight, 0);
  const expScore = input.relevantYears == null ? null : clamp(input.relevantYears / Math.max(1, input.minYears));

  let score: number | null = null;
  if (skillScore != null) score = expScore != null ? 0.8 * skillScore + 0.2 * expScore : skillScore;
  const skillWeight = skillScore == null ? 0 : expScore != null ? 0.8 : 1;
  const experienceWeight = skillScore != null && expScore != null ? 0.2 : 0;
  const levelOnly = coverage > 0 ? known.reduce((s, r) => s + r.normalizedWeight * (r.levelFit ?? 0), 0) / coverage : null;
  const drivers = known.map((r) => {
    const maxPoints = r.normalizedWeight / coverage * skillWeight * 100;
    return { skillSlug: r.skillSlug, skillName: r.skillName, pointsEarned: round(maxPoints * (r.credit ?? 0), 2),
      evidenceLoss: round(maxPoints * Math.max(0, (r.levelFit ?? 0) - (r.credit ?? 0)), 2), levelLoss: round(maxPoints * (1 - (r.levelFit ?? 0)), 2) };
  }).sort((a, b) => (b.evidenceLoss + b.levelLoss) - (a.evidenceLoss + a.levelLoss));
  const breakdown: CapabilityBreakdown = {
    skillScore: skillScore == null ? null : round(skillScore * 100, 2), levelOnlySkillScore: levelOnly == null ? null : round(levelOnly * 100, 2),
    experienceScore: expScore == null ? null : round(expScore * 100, 2), relevantYears: input.relevantYears == null ? null : round(input.relevantYears, 1), typicalYears: input.minYears,
    skillWeight, experienceWeight, skillPoints: skillScore == null ? null : round(skillScore * skillWeight * 100, 2),
    experiencePoints: !experienceWeight || expScore == null ? null : round(expScore * experienceWeight * 100, 2),
    evidenceLossPoints: levelOnly == null || skillScore == null ? null : round(Math.max(0, levelOnly - skillScore) * skillWeight * 100, 2),
    levelLossPoints: levelOnly == null ? null : round((1 - levelOnly) * skillWeight * 100, 2),
    experienceLossPoints: !experienceWeight || expScore == null ? null : round((1 - expScore) * experienceWeight * 100, 2),
    knownCoverage: round(coverage, 4), unknownSkills: rows.length - known.length, assumedSkills: rows.filter((r) => r.levelAssumed).length, drivers,
  };
  const explanation: string[] = [];
  if (skillScore == null) explanation.push('No evidence for any required skill yet — add skills, import a CV or take an assessment.');
  else explanation.push(`Skill fit ${Math.round(skillScore * 100)}% across the ${Math.round(coverage * 100)}% of required skill weight with evidence.`);
  explanation.push(`${Math.round(verifiedCoverage * 100)}% of the requirement weight is backed by assessed or app-verified evidence; self-reported skills count at 60% and CV claims at 50% until assessed.`);
  if (expScore != null) explanation.push(`Relevant experience: ${round(input.relevantYears!, 1)} years vs ${input.minYears}+ typical for this level.`);
  else explanation.push('Relevant work experience unknown (no work history in profile).');

  const gaps = rows.filter((r) => r.gate === 'gap').map((r) => r.skillName);
  const unverified = rows.filter((r) => r.gate === 'unknown' || r.gate === 'claimed').map((r) => r.skillName);
  const gate: RoleMatch['criticalGate'] = gaps.length
    ? { status: 'blocked', gaps, unverified, message: `Critical gap: ${gaps.join(', ')} below the required level. This cannot be offset by strengths elsewhere.` }
    : unverified.length
      ? { status: 'needs_evidence', gaps, unverified, message: `Critical skills need evidence: ${unverified.join(', ')}.` }
      : { status: 'clear', gaps, unverified, message: 'All critical skills are met with assessed evidence.' };

  return {
    rows,
    breakdown,
    gate,
    dimension: { key: 'capability', label: 'Capability fit', score: score == null ? null : Math.round(score * 100), coverage: round(coverage, 2), confidence: confidenceFrom(verifiedCoverage > 0 ? (coverage + verifiedCoverage) / 2 : coverage * 0.6), explanation },
  };
}

export function computeInterest(profile: typeof careerProfiles.$inferSelect | undefined, role: { taskProfile: Record<string, number>; workValues: string[]; familySlug: string }): Dimension {
  const parts: { w: number; v: number; label: string }[] = [];
  const explanation: string[] = [];
  const aff = profile?.taskAffinity ?? {};
  const dims = Object.entries(role.taskProfile);
  const ratedDims = dims.filter(([d]) => aff[d] != null);
  if (ratedDims.length) {
    const num = ratedDims.reduce((s, [d, w]) => s + w * ((aff[d] - 1) / 4), 0);
    const den = ratedDims.reduce((s, [, w]) => s + w, 0);
    const v = num / den;
    parts.push({ w: 0.6, v, label: 'task affinity' });
    const top = [...dims].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d]) => `${d} (${aff[d] ?? '?'}/5)`);
    explanation.push(`Task affinity ${Math.round(v * 100)}%: this role leans on ${top.join(', ')}.`);
  }
  if (profile?.workValues?.length) {
    const overlap = profile.workValues.filter((v) => role.workValues.includes(v));
    const v = overlap.length / Math.min(3, profile.workValues.length);
    parts.push({ w: 0.25, v: clamp(v), label: 'work values' });
    explanation.push(overlap.length ? `Shares your values: ${overlap.join(', ')}.` : 'None of your top work values are characteristic of this role.');
  }
  if (profile?.interests?.length) {
    const v = profile.interests.includes(role.familySlug) ? 1 : 0;
    parts.push({ w: 0.15, v, label: 'career interests' });
    explanation.push(v ? 'Within a career family you marked as interesting.' : 'Outside the career families you marked as interesting.');
  }
  const coverage = parts.reduce((s, p) => s + p.w, 0);
  if (!parts.length) return { key: 'interest', label: 'Interest & work fit', score: null, coverage: 0, confidence: 'unknown', explanation: ['Unknown — rate task preferences and work values in your profile or run a discovery interview.'] };
  const score = parts.reduce((s, p) => s + p.w * p.v, 0) / coverage;
  return { key: 'interest', label: 'Interest & work fit', score: Math.round(score * 100), coverage: round(coverage, 2), confidence: confidenceFrom(coverage), explanation };
}

export function computeGrowth(input: {
  rows: RequirementRow[];
  weeklyHours: number | null;
  weeksAvailable: number | null;
  prereqDepth: number;
  progress: { done: number; missed: number } | null;
}): Dimension & { estimatedHours: number; weeksNeeded: number | null } {
  const hours = round(input.rows.reduce((s, r) => s + r.estimatedGapHours, 0), 0);
  const unknownShare = input.rows.filter((r) => r.state === 'unknown').reduce((s, r) => s + r.normalizedWeight, 0);
  const transferable = input.rows.filter((r) => (r.credit ?? 0) >= 0.5).reduce((s, r) => s + r.normalizedWeight, 0);
  const parts: { w: number; v: number }[] = [{ w: 0.35, v: transferable }];
  const explanation = [`Transferable strengths cover ${Math.round(transferable * 100)}% of the requirement weight.`];
  let weeksNeeded: number | null = null;
  if (input.weeklyHours && input.weeklyHours > 0) {
    weeksNeeded = Math.ceil(hours / input.weeklyHours);
    const horizon = input.weeksAvailable ?? 26;
    const v = weeksNeeded === 0 ? 1 : clamp(horizon / weeksNeeded);
    parts.push({ w: 0.35, v });
    explanation.push(`Estimated ~${hours} study hours${unknownShare > 0 ? ' (upper bound: unknown skills counted as full gaps)' : ''} ≈ ${weeksNeeded} weeks at ${input.weeklyHours} h/week vs ${input.weeksAvailable != null ? `${input.weeksAvailable} weeks until your deadline` : 'a 26-week reference horizon'}.`);
  } else {
    explanation.push(`Estimated ~${hours} study hours; add weekly learning hours to assess time feasibility.`);
  }
  parts.push({ w: 0.15, v: clamp(1 - input.prereqDepth / 6) });
  explanation.push(`Longest prerequisite chain among gaps: ${input.prereqDepth} step(s).`);
  if (input.progress && input.progress.done + input.progress.missed > 0) {
    const v = input.progress.done / (input.progress.done + input.progress.missed);
    parts.push({ w: 0.15, v });
    explanation.push(`Recent learning follow-through: ${input.progress.done} tasks completed, ${input.progress.missed} missed (last 30 days).`);
  }
  const coverage = parts.reduce((s, p) => s + p.w, 0);
  const score = parts.reduce((s, p) => s + p.w * p.v, 0) / coverage;
  return { key: 'growth', label: 'Growth potential', score: Math.round(score * 100), coverage: round(1 - unknownShare * 0.5, 2), confidence: confidenceFrom(coverage * (1 - unknownShare * 0.5)), explanation, estimatedHours: hours, weeksNeeded };
}

const MARKET_ALIASES: Record<string, string[]> = { vietnam: ['vietnam', 'vn'], singapore: ['singapore', 'sg'], japan: ['japan', 'jp'], remote: ['remote'], global: ['global'] };

export async function computeMarket(ctx: AppContext, roleId: number, certTrendsRoleIds: string[], userMarkets: string[], maxRoleCount: number, includeDemo: boolean): Promise<Dimension> {
  const since = new Date(ctx.now().getTime() - 120 * 86_400_000);
  const rows = await ctx.db.select({ market: jobs.market, workMode: jobs.workMode, lastSeenAt: jobs.lastSeenAt, isDemo: jobs.isDemo, sourceId: jobs.sourceId, originSite: jobs.originSite })
    .from(jobs).where(and(eq(jobs.normalizedRoleId, roleId), eq(jobs.status, 'active'), isNull(jobs.ownerUserId), gte(jobs.lastSeenAt, since)));
  const real = rows.filter((r) => !r.isDemo);
  const considered = includeDemo ? rows : real;
  // Cert Trends role aggregates are counted over every posting a board lists (not only those naming a
  // certification), so they are the unbiased role-demand signal: postings for the role / postings scanned.
  const obs = certTrendsRoleIds.length
    ? await ctx.db.select().from(marketObservations).where(and(inArray(marketObservations.roleKey, certTrendsRoleIds), inArray(marketObservations.metric, ['postings', 'scanned'])))
    : [];
  const [certTrendsSource] = await ctx.db.select({ id: jobSources.id }).from(jobSources).where(eq(jobSources.type, 'cert_trends'));
  const explanation: string[] = [];
  const roleDemandNote = () => {
    const periods = [...new Set(obs.filter((o) => o.metric === 'postings' && o.value > 0).map((o) => o.period))].sort();
    const latest = periods.at(-1);
    if (!latest) return;
    const postings = obs.filter((o) => o.period === latest && o.metric === 'postings').reduce((s, o) => s + o.value, 0);
    const scanned = obs.filter((o) => o.period === latest && o.metric === 'scanned').reduce((s, o) => s + o.value, 0);
    explanation.push(`Cert Trends role-demand count for ${latest}: ${postings} matching title(s) out of ${scanned} postings scanned on fully-enumerated boards${certTrendsRoleIds.includes('devops') ? ' (DevOps, SRE and platform titles share one bucket)' : ''}.`);
  };
  const certFiltered = !!certTrendsSource && considered.some((r) => r.sourceId === certTrendsSource.id);
  if (considered.length < 5) {
    explanation.push(`Insufficient market data: ${real.length} real posting(s) mapped to this role in the last 120 days${rows.length - real.length ? ` (+${rows.length - real.length} demo postings, excluded)` : ''}.`);
    roleDemandNote();
    if (certFiltered) explanation.push('Cert Trends publishes only postings that name a certification, so its job list is a filtered sample.');
    explanation.push('Sync job sources (Jobs → Sources) to improve coverage.');
    return { key: 'market', label: 'Market opportunity', score: null, coverage: 0, confidence: 'unknown', explanation };
  }
  const demand = Math.log(1 + considered.length) / Math.log(1 + Math.max(maxRoleCount, considered.length));
  const parts = [{ w: 0.7, v: demand }];
  explanation.push(`${considered.length} active posting(s) mapped to this role in the last 120 days${includeDemo ? ' (including labeled demo postings)' : ''}; demand is relative to the most-posted role in the same sources.`);
  if (userMarkets.length) {
    const wanted = new Set(userMarkets.flatMap((m) => MARKET_ALIASES[m] ?? [m]));
    const fit = considered.filter((r) => (r.market && wanted.has(r.market)) || r.workMode === 'remote').length / considered.length;
    parts.push({ w: 0.3, v: fit });
    explanation.push(`${Math.round(fit * 100)}% of these postings are in your preferred markets or remote.`);
  } else explanation.push('Set preferred markets in your profile to weigh location fit.');
  const sources = new Set(considered.map((r) => r.originSite ?? r.sourceId)).size;
  explanation.push(`Coverage: ${sources} upstream source(s). Data reflects ingested sources only, not the whole market.`);
  if (certFiltered) explanation.push('Note: Cert Trends publishes only postings that name a certification, so counts from it over-represent certification-heavy roles.');
  roleDemandNote();
  const coverage = parts.reduce((s, p) => s + p.w, 0);
  return { key: 'market', label: 'Market opportunity', score: Math.round((parts.reduce((s, p) => s + p.w * p.v, 0) / coverage) * 100), coverage: round(Math.min(1, considered.length / 30), 2), confidence: considered.length >= 30 ? 'high' : considered.length >= 10 ? 'medium' : 'low', explanation };
}

// ---------------------------------------------------------------------------

async function roleRequirements(ctx: AppContext, roleId: number, level: Level) {
  const rows = await ctx.db.select({ r: roleSkillRequirements, s: skills }).from(roleSkillRequirements).innerJoin(skills, eq(skills.id, roleSkillRequirements.skillId)).where(eq(roleSkillRequirements.roleId, roleId));
  return rows.map(({ r, s }) => ({
    skillSlug: s.slug, skillName: s.name, category: s.category, weight: r.weight, critical: r.critical, baseHours: s.baseHours,
    requiredLevel: Math.min(5, Math.max(1, r.requiredLevel + LEVEL_SHIFT[level])),
  }));
}

export async function loadMatchContext(ctx: AppContext, userId: number) {
  const [profile] = await ctx.db.select().from(careerProfiles).where(eq(careerProfiles.userId, userId));
  const userSkills = await loadUserSkillMap(ctx, userId);
  const history = await ctx.db.select().from(profileItems).where(and(eq(profileItems.userId, userId), eq(profileItems.confirmed, true)));
  const work = history.filter((p) => p.kind === 'work');
  const allSkills = await ctx.db.select({ slug: skills.slug, name: skills.name, prerequisites: skills.prerequisites }).from(skills);
  const depth = depthMap(allSkills.map((s) => s.slug), allSkills.flatMap((s) => s.prerequisites.map((p) => ({ from: p, to: s.slug }))));
  const since = new Date(ctx.now().getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const tasks = await ctx.db.select({ status: learningTasks.status, date: learningTasks.scheduledDate }).from(learningTasks).innerJoin(learningPlans, eq(learningPlans.id, learningTasks.planId)).where(and(eq(learningPlans.userId, userId), gte(learningTasks.scheduledDate, since)));
  const progress = tasks.length ? { done: tasks.filter((t) => t.status === 'done').length, missed: tasks.filter((t) => t.status === 'missed').length } : null;
  const roleCounts = await ctx.db.select({ roleId: jobs.normalizedRoleId }).from(jobs).where(and(eq(jobs.status, 'active'), isNull(jobs.ownerUserId), eq(jobs.isDemo, false)));
  const counts = new Map<number, number>();
  for (const r of roleCounts) if (r.roleId) counts.set(r.roleId, (counts.get(r.roleId) ?? 0) + 1);
  const currentRole = profile?.currentRoleSlug ? (await ctx.db.select({ id: careerRoles.id, slug: careerRoles.slug, name: careerRoles.name }).from(careerRoles).where(eq(careerRoles.slug, profile.currentRoleSlug)))[0] ?? null : null;
  const currentRoleSkills = currentRole ? (await ctx.db.select({ slug: skills.slug }).from(roleSkillRequirements).innerJoin(skills, eq(skills.id, roleSkillRequirements.skillId)).where(eq(roleSkillRequirements.roleId, currentRole.id))).map((s) => s.slug) : [];
  return { profile, userSkills, work, history, allSkills, currentRole, currentRoleSkills, depth, progress, maxRoleCount: Math.max(5, ...counts.values()) };
}

export function relevantYears(work: (typeof profileItems.$inferSelect)[], reqSlugs: string[], now: Date): number | null {
  if (!work.length) return null;
  return work.reduce((sum, w) => {
    const overlap = w.skillSlugs.filter((s) => reqSlugs.includes(s)).length;
    return overlap >= 2 || overlap / Math.max(1, reqSlugs.length) >= 0.3 ? sum + yearsBetween(w.startDate, w.endDate, now) : sum;
  }, 0);
}

export async function computeRoleMatch(ctx: AppContext, userId: number, roleSlug: string, opts: { level?: Level; includeDemo?: boolean; mc?: Awaited<ReturnType<typeof loadMatchContext>> } = {}): Promise<RoleMatch> {
  const level = opts.level ?? 'middle';
  const [row] = await ctx.db.select({ role: careerRoles, family: careerFamilies }).from(careerRoles).innerJoin(careerFamilies, eq(careerFamilies.id, careerRoles.familyId)).where(eq(careerRoles.slug, roleSlug));
  if (!row) throw notFound('Role');
  const mc = opts.mc ?? (await loadMatchContext(ctx, userId));
  const reqs = await roleRequirements(ctx, row.role.id, level);
  const years = relevantYears(mc.work, reqs.map((r) => r.skillSlug), ctx.now());
  const cap = computeCapability({ requirements: reqs, userSkills: mc.userSkills, relevantYears: years, minYears: row.role.minYears[level] });
  const interest = computeInterest(mc.profile, { taskProfile: row.role.taskProfile, workValues: row.role.workValues, familySlug: row.family.slug });
  const gapSlugs = cap.rows.filter((r) => r.estimatedGapHours > 0).map((r) => r.skillSlug);
  const weeksAvailable = mc.profile?.deadline ? Math.max(0, Math.floor((new Date(mc.profile.deadline).getTime() - ctx.now().getTime()) / (7 * 86_400_000))) : null;
  const growth = computeGrowth({ rows: cap.rows, weeklyHours: mc.profile?.weeklyLearningHours ?? null, weeksAvailable, prereqDepth: Math.max(0, ...gapSlugs.map((s) => mc.depth.get(s) ?? 0)), progress: mc.progress });
  const market = await computeMarket(ctx, row.role.id, row.role.certTrendsRoleIds, mc.profile?.markets ?? [], mc.maxRoleCount, !!opts.includeDemo);

  let transferableFrom: RoleMatch['transferableFrom'] = null;
  let currentRole: SkillTransfer['currentRole'] = null;
  let sharedSlugs: string[] = [];
  if (mc.profile?.currentRoleSlug) {
    const from = mc.currentRole;
    if (from) {
      currentRole = { slug: from.slug, name: from.name };
      sharedSlugs = mc.currentRoleSkills;
      const [t] = await ctx.db.select().from(careerTransitions).where(and(eq(careerTransitions.fromRoleId, from.id), eq(careerTransitions.toRoleId, row.role.id)));
      if (t) transferableFrom = { roleSlug: mc.profile.currentRoleSlug, difficulty: t.difficulty, typicalMonths: t.typicalMonths, rationale: t.rationale };
    }
  }
  const skillTransfer: SkillTransfer = { currentRole, direct: [], supporting: [], other: [] };
  for (const [slug, us] of mc.userSkills) {
    const skillName = mc.allSkills.find((s) => s.slug === slug)?.name ?? slug;
    const target = cap.rows.find((r) => r.skillSlug === slug);
    if (target) {
      skillTransfer.direct.push({ skillSlug: slug, skillName, status: us.status, level: us.proficiency, requiredLevel: target.requiredLevel,
        roleShared: sharedSlugs.includes(slug), examples: mc.history.filter((p) => (p.kind === 'work' || p.kind === 'project') && p.skillSlugs.includes(slug)).map((p) => `${p.title}${p.organization ? ` · ${p.organization}` : ''}`).slice(0, 3) });
    } else {
      const supports = reqs.filter((r) => mc.allSkills.find((s) => s.slug === r.skillSlug)?.prerequisites.includes(slug)).map((r) => r.skillName);
      const item = { skillSlug: slug, skillName, status: us.status, level: us.proficiency };
      if (supports.length) skillTransfer.supporting.push({ ...item, supports });
      else skillTransfer.other.push(item);
    }
  }
  const { estimatedHours: _h, weeksNeeded: _w, ...growthDim } = growth;
  return {
    role: { id: row.role.id, slug: row.role.slug, name: row.role.name, family: row.family.name },
    level,
    dimensions: [cap.dimension, interest, growthDim, market],
    criticalGate: cap.gate,
    requirements: cap.rows,
    capabilityBreakdown: cap.breakdown,
    skillTransfer,
    transferableFrom,
    disclaimer: DISCLAIMER,
  };
}

/** Compact matches for all roles (used for exploration lists). Sorted by capability, then interest. */
export async function computeAllRoleMatches(ctx: AppContext, userId: number, opts: { includeDemo?: boolean } = {}) {
  const roles = await ctx.db.select({ slug: careerRoles.slug }).from(careerRoles);
  const mc = await loadMatchContext(ctx, userId);
  const out = [];
  for (const r of roles) {
    const m = await computeRoleMatch(ctx, userId, r.slug, { mc, includeDemo: opts.includeDemo });
    out.push({ role: m.role, dimensions: m.dimensions.map(({ key, label, score, confidence }) => ({ key, label, score, confidence })), criticalGate: m.criticalGate.status, gapCount: m.requirements.filter((x) => x.estimatedGapHours > 0).length });
  }
  const val = (x: number | null) => x ?? -1;
  return out.sort((a, b) => val(b.dimensions[0].score) - val(a.dimensions[0].score) || val(b.dimensions[1].score) - val(a.dimensions[1].score));
}
