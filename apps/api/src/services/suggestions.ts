import { and, desc, eq } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { learningPlans } from '../db/schema.js';
import type { Suggestion } from '../ai/service.js';
import { getApplicationDetail } from './applications.js';
import { listSessions } from './interviews.js';
import { getPlanDetail } from './learning.js';
import { computeAllRoleMatches } from './matching.js';
import { getOnboarding } from './onboarding.js';
import { getProfile } from './profile.js';

const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, now: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: now, value });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return value;
}

/** AI-phrased next actions for one application, grounded in the deterministic detail. */
export async function applicationSuggestions(ctx: AppContext, userId: number, applicationId: number, refresh = false) {
  const d = await getApplicationDetail(ctx, userId, applicationId);
  const { profile } = await getProfile(ctx, userId);
  const a = d.application;
  const key = `app:${userId}:${applicationId}:${a.updatedAt.getTime()}:${d.events.length}:${d.rounds.length}:${ctx.ai.status().provider}`;
  if (refresh) cache.delete(key);
  return cached(key, ctx.now().getTime(), async () => {
    const jobQ = a.jobId ? `jobId=${a.jobId}` : '';
    const allowedLinks = [...new Set([
      ...d.nextActions.map((n) => n.link).filter((l): l is string => !!l && l.startsWith('/')),
      `/interviews/new?${jobQ}&mode=job_specific`, `/assessments?${jobQ}`, `/resume?${jobQ}`, '/learning', '/profile',
      ...(a.jobId ? [`/jobs/${a.jobId}`] : []),
    ])];
    const res = await ctx.ai.suggestNextSteps({
      context: 'a job application the user is tracking',
      language: profile.preferredLanguage,
      allowedLinks,
      fallback: d.nextActions.map((n): Suggestion => ({ title: n.title, detail: n.detail, link: n.link?.startsWith('/') ? n.link : undefined })),
      facts: {
        job: { title: a.jobSnapshot.title, company: a.jobSnapshot.company, isDemo: a.jobSnapshot.isDemo, requiredSkills: a.jobSnapshot.requiredSkills },
        stage: a.stage, outcome: a.outcome, appliedAt: a.appliedAt, followUpAt: a.followUpAt, today: ctx.now().toISOString().slice(0, 10),
        cvAttached: d.resume ? `${d.resume.title} v${d.resume.versionNo}` : null,
        match: d.match ? { score: d.match.score, evidenceCoveragePct: Math.round(d.match.evidenceCoverage * 100), criticalGaps: d.match.criticalGaps.map((g) => g.label) } : null,
        interviewRounds: d.rounds.map((r) => ({ name: r.name, type: r.type, scheduledAt: r.scheduledAt, status: r.status, practiced: !!r.practiceSessionId })),
        practiceSessions: d.interviewSessions.map((s) => ({ round: s.roundType, status: s.status })),
        recentEvents: d.events.slice(-5).map((e) => ({ type: e.type, to: e.toStage, at: e.at })),
        ruleBasedActions: d.nextActions.map((n) => n.title),
      },
    });
    return { suggestions: res.data, meta: res.meta };
  });
}

/** AI-phrased career suggestions for the dashboard, grounded in profile, matches, plan and tracker state. */
export async function dashboardSuggestions(ctx: AppContext, userId: number, refresh = false) {
  const prof = await getProfile(ctx, userId);
  const onboarding = await getOnboarding(ctx, userId);
  const [plan] = await ctx.db.select().from(learningPlans).where(and(eq(learningPlans.userId, userId), eq(learningPlans.status, 'active'))).orderBy(desc(learningPlans.createdAt));
  const planDetail = plan ? await getPlanDetail(ctx, userId, plan.id) : null;
  const key = `dash:${userId}:${prof.profile.updatedAt.getTime()}:${prof.skills.length}:${onboarding.completed}:${planDetail?.stats.done ?? -1}:${ctx.ai.status().provider}`;
  if (refresh) cache.delete(key);
  return cached(key, ctx.now().getTime(), async () => {
    const targets = prof.profile.targetRoleSlugs;
    const matches = (await computeAllRoleMatches(ctx, userId)).filter((m) => (targets.length ? targets.includes(m.role.slug) : true)).slice(0, 3);
    const sessions = (await listSessions(ctx, userId)).filter((s) => s.status === 'completed').slice(0, 3);
    const target = targets[0] ?? matches[0]?.role.slug;
    const fallback: Suggestion[] = [];
    const next = onboarding.steps.find((s) => !s.done);
    if (next) fallback.push({ title: next.title, detail: next.description, link: next.href });
    if (planDetail?.stats.pastDue) fallback.push({ title: 'Reschedule missed sessions', detail: `${planDetail.stats.pastDue} session(s) are past due.`, link: `/learning/${plan!.id}` });
    const blocked = matches.find((m) => m.criticalGate === 'blocked' || m.criticalGate === 'needs_evidence');
    if (blocked) fallback.push({ title: `Assess critical skills for ${blocked.role.name}`, detail: 'Critical skills need evidence before they count.', link: `/matching?role=${blocked.role.slug}` });
    const allowedLinks = ['/profile', '/matching', '/learning', '/assessments', '/interviews/new', '/jobs', '/resume', '/applications', '/market', ...(target ? [`/roadmap/${target}`, `/matching?role=${target}`, `/jobs?role=${target}`] : []), ...(plan ? [`/learning/${plan.id}`] : []), ...onboarding.steps.map((s) => s.href)];
    const res = await ctx.ai.suggestNextSteps({
      context: 'the user’s career transition dashboard',
      language: prof.profile.preferredLanguage,
      allowedLinks: [...new Set(allowedLinks)],
      fallback: fallback.slice(0, 4),
      facts: {
        headline: prof.profile.headline, currentRole: prof.profile.currentRoleSlug, goals: prof.profile.goals.slice(0, 400),
        weeklyLearningHours: prof.profile.weeklyLearningHours, deadline: prof.profile.deadline,
        profileGaps: prof.completeness.checks.filter((c) => !c.done).map((c) => c.label),
        skillEvidence: ['app_verified', 'assessed', 'self_reported', 'extracted_claim'].map((s) => ({ status: s, count: prof.skills.filter((x) => x.status === s).length })),
        targetRoles: matches.map((m) => ({ role: m.role.name, slug: m.role.slug, capability: m.dimensions[0].score, interest: m.dimensions[1].score, growth: m.dimensions[2].score, market: m.dimensions[3].score, criticalGate: m.criticalGate, skillsWithGaps: m.gapCount })),
        learningPlan: planDetail ? { title: planDetail.plan.title, done: planDetail.stats.done, total: planDetail.stats.total, pastDue: planDetail.stats.pastDue, feasible: planDetail.plan.feasible, projectedEnd: planDetail.plan.projectedEndDate } : null,
        recentInterviews: sessions.map((s) => ({ mode: s.mode, round: s.roundType, score: s.score })),
        onboarding: { completed: onboarding.completed, total: onboarding.total, nextStep: next?.title ?? null },
      },
    });
    return { suggestions: res.data, meta: res.meta };
  });
}
