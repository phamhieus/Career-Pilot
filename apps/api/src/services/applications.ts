import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import {
  APPLICATION_OUTCOMES, APPLICATION_STAGES, applicationEvents, interviewRounds, interviewSessions, jobApplications, jobs, resumeVersions, resumes,
  type ApplicationOutcome, type ApplicationStage,
} from '../db/schema.js';
import { daysBetween, todayIso } from '../lib/dates.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { computeJobMatch } from './jobMatching.js';

const ORDER = (s: ApplicationStage) => APPLICATION_STAGES.indexOf(s);

/** Validates a stage/outcome change. Pure; exported for tests. */
export function validateStageChange(current: { stage: ApplicationStage; outcome: ApplicationOutcome | null; history: ApplicationStage[] }, next: { stage: ApplicationStage; outcome?: ApplicationOutcome | null }) {
  if (!APPLICATION_STAGES.includes(next.stage)) throw badRequest('Unknown stage');
  if (next.outcome && !APPLICATION_OUTCOMES.includes(next.outcome)) throw badRequest('Unknown outcome');
  if (next.stage === 'closed' && !next.outcome) throw badRequest('Closing an application requires an outcome (accepted, rejected, withdrawn, no_response)');
  if (next.stage !== 'closed' && next.outcome) throw badRequest('Outcome can only be set when the application is closed');
  if (next.outcome === 'accepted' && !current.history.includes('offer') && current.stage !== 'offer') throw badRequest('An application can only be accepted after reaching the Offer stage');
  if (current.stage === next.stage && (current.outcome ?? null) === (next.outcome ?? null)) throw conflict('Application is already in that state');
  const type = current.stage === 'closed' ? 'reopened' : next.stage === 'closed' ? 'closed' : ORDER(next.stage) < ORDER(current.stage) ? 'stage_reverted' : 'stage_changed';
  return { type };
}

async function owned(ctx: AppContext, userId: number, id: number) {
  const [a] = await ctx.db.select().from(jobApplications).where(and(eq(jobApplications.id, id), eq(jobApplications.userId, userId)));
  if (!a) throw notFound('Application');
  return a;
}

async function ownedVersion(ctx: AppContext, userId: number, versionId: number) {
  const [v] = await ctx.db.select({ v: resumeVersions, r: resumes }).from(resumeVersions).innerJoin(resumes, eq(resumes.id, resumeVersions.resumeId)).where(and(eq(resumeVersions.id, versionId), eq(resumes.userId, userId)));
  if (!v) throw notFound('Resume version');
  return v;
}

export async function createApplication(ctx: AppContext, userId: number, input: { jobId: number; resumeVersionId?: number | null; source?: string; notes?: string }) {
  const [job] = await ctx.db.select().from(jobs).where(eq(jobs.id, input.jobId));
  if (!job || (job.ownerUserId && job.ownerUserId !== userId)) throw notFound('Job');
  const dup = await ctx.db.select({ id: jobApplications.id }).from(jobApplications).where(and(eq(jobApplications.userId, userId), eq(jobApplications.jobId, job.id)));
  if (dup.length) throw conflict(`This job is already tracked (application #${dup[0].id})`);
  if (input.resumeVersionId) await ownedVersion(ctx, userId, input.resumeVersionId);
  const [app] = await ctx.db.insert(jobApplications).values({
    userId, jobId: job.id, resumeVersionId: input.resumeVersionId ?? null, source: input.source ?? job.originSite ?? 'CareerPilot', notes: input.notes ?? '',
    jobSnapshot: { title: job.title, company: job.company, url: job.canonicalUrl, location: job.location, description: job.description.slice(0, 20000), requiredSkills: job.requiredSkills, capturedAt: ctx.now().toISOString(), isDemo: job.isDemo },
  }).returning();
  await ctx.db.insert(applicationEvents).values({ applicationId: app.id, type: 'created', toStage: 'saved', note: 'Saved to tracker', data: { resumeVersionId: input.resumeVersionId ?? null } });
  return app;
}

export async function changeStage(ctx: AppContext, userId: number, id: number, input: { stage: ApplicationStage; outcome?: ApplicationOutcome | null; note?: string }) {
  const app = await owned(ctx, userId, id);
  const events = await ctx.db.select().from(applicationEvents).where(eq(applicationEvents.applicationId, id));
  const history = events.map((e) => e.toStage).filter(Boolean) as ApplicationStage[];
  const { type } = validateStageChange({ stage: app.stage, outcome: app.outcome, history }, input);
  const patch: Partial<typeof jobApplications.$inferInsert> = { stage: input.stage, outcome: input.stage === 'closed' ? input.outcome! : null, updatedAt: ctx.now() };
  if (input.stage !== 'saved' && input.stage !== 'closed' && !app.appliedAt) patch.appliedAt = ctx.now();
  const [updated] = await ctx.db.update(jobApplications).set(patch).where(eq(jobApplications.id, id)).returning();
  await ctx.db.insert(applicationEvents).values({ applicationId: id, type, fromStage: app.stage, toStage: input.stage, note: input.note ?? '', data: { outcome: input.outcome ?? null, resumeVersionId: app.resumeVersionId } });
  return updated;
}

export async function updateApplication(ctx: AppContext, userId: number, id: number, input: { notes?: string; contacts?: { name: string; role?: string; email?: string; note?: string }[]; followUpAt?: string | null; resumeVersionId?: number | null; source?: string }) {
  const app = await owned(ctx, userId, id);
  if (input.resumeVersionId && input.resumeVersionId !== app.resumeVersionId) {
    const v = await ownedVersion(ctx, userId, input.resumeVersionId);
    const afterSubmit = ORDER(app.stage) >= ORDER('applied');
    await ctx.db.insert(applicationEvents).values({ applicationId: id, type: afterSubmit ? 'resume_changed_after_submission' : 'resume_attached', note: `${v.r.title} v${v.v.versionNo}${afterSubmit ? ' — note: the employer has the version you originally submitted' : ''}`, data: { from: app.resumeVersionId, to: input.resumeVersionId } });
  }
  if (input.followUpAt !== undefined && input.followUpAt !== app.followUpAt) await ctx.db.insert(applicationEvents).values({ applicationId: id, type: 'follow_up_set', note: input.followUpAt ? `Follow-up on ${input.followUpAt}` : 'Follow-up cleared' });
  const [updated] = await ctx.db.update(jobApplications).set({ ...input, updatedAt: ctx.now() }).where(eq(jobApplications.id, id)).returning();
  return updated;
}

export async function addNoteEvent(ctx: AppContext, userId: number, id: number, note: string) {
  await owned(ctx, userId, id);
  const [e] = await ctx.db.insert(applicationEvents).values({ applicationId: id, type: 'note', note: note.slice(0, 2000) }).returning();
  return e;
}

export async function addRound(ctx: AppContext, userId: number, id: number, input: { name: string; type: string; scheduledAt?: string | null; notes?: string }) {
  await owned(ctx, userId, id);
  const [r] = await ctx.db.insert(interviewRounds).values({ applicationId: id, name: input.name, type: input.type, scheduledAt: input.scheduledAt ?? null, notes: input.notes ?? '' }).returning();
  await ctx.db.insert(applicationEvents).values({ applicationId: id, type: 'round_added', note: `${input.name}${input.scheduledAt ? ` on ${input.scheduledAt}` : ''}` });
  return r;
}

export async function updateRound(ctx: AppContext, userId: number, id: number, roundId: number, input: { status?: 'scheduled' | 'completed' | 'cancelled'; notes?: string; scheduledAt?: string | null; practiceSessionId?: number | null }) {
  await owned(ctx, userId, id);
  if (input.practiceSessionId) {
    const [s] = await ctx.db.select().from(interviewSessions).where(and(eq(interviewSessions.id, input.practiceSessionId), eq(interviewSessions.userId, userId)));
    if (!s) throw notFound('Interview session');
  }
  const [r] = await ctx.db.update(interviewRounds).set(input).where(and(eq(interviewRounds.id, roundId), eq(interviewRounds.applicationId, id))).returning();
  if (!r) throw notFound('Interview round');
  if (input.status) await ctx.db.insert(applicationEvents).values({ applicationId: id, type: 'round_updated', note: `${r.name}: ${input.status}` });
  return r;
}

export interface NextAction { priority: number; title: string; detail: string; link?: string }

/** Deterministic, rule-based next actions. Never sends anything externally. */
export function recommendNextActions(input: {
  app: typeof jobApplications.$inferSelect;
  lastEventAt: Date;
  rounds: (typeof interviewRounds.$inferSelect)[];
  criticalGaps: string[];
  recommendedAssessments: string[];
  jobUrl: string | null;
  today: string;
}): NextAction[] {
  const { app, today } = input;
  const out: NextAction[] = [];
  const jobQ = app.jobId ? `jobId=${app.jobId}` : '';
  if (app.followUpAt && app.followUpAt <= today && app.stage !== 'closed') out.push({ priority: 1, title: 'Follow-up reminder is due', detail: `You planned to follow up on ${app.followUpAt}.` });
  switch (app.stage) {
    case 'saved':
      if (!app.resumeVersionId) out.push({ priority: 2, title: 'Create a tailored CV for this job', detail: 'Generate a CV from your confirmed evidence and attach that exact version.', link: `/resume?${jobQ}` });
      else out.push({ priority: 2, title: 'Submit on the employer’s site, then mark as Applied', detail: 'CareerPilot never applies on your behalf.', link: input.jobUrl ?? undefined });
      if (input.criticalGaps.length) out.push({ priority: 3, title: `Address critical gap: ${input.criticalGaps[0]}`, detail: 'Consider assessing or learning it before applying, or mention transferable evidence.', link: '/learning' });
      break;
    case 'applied': {
      const days = daysBetween(input.lastEventAt.toISOString().slice(0, 10), today);
      if (days >= 7) out.push({ priority: 2, title: 'Consider a polite follow-up', detail: `No updates for ${days} days. Draft a short note to the recruiter yourself.` });
      out.push({ priority: 4, title: 'Prepare with an HR / behavioral mock interview', detail: 'Screening calls often start with motivation and experience questions.', link: `/interviews/new?${jobQ}&round=hr&mode=job_specific` });
      break;
    }
    case 'screening':
      out.push({ priority: 2, title: 'Run an HR / behavioral mock interview', detail: 'Practice your motivation story and STAR examples.', link: `/interviews/new?${jobQ}&round=hr&mode=job_specific` });
      break;
    case 'assessment':
      out.push({ priority: 2, title: 'Practice the skills this job tests', detail: input.recommendedAssessments.length ? `Suggested: ${input.recommendedAssessments.slice(0, 3).join(', ')}` : 'Take assessments on the job’s required skills.', link: `/assessments?${jobQ}` });
      break;
    case 'interview': {
      const upcoming = input.rounds.filter((r) => r.status === 'scheduled').sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''))[0];
      out.push({ priority: 2, title: upcoming ? `Prepare for "${upcoming.name}"` : 'Log your interview rounds', detail: upcoming ? 'Run a job-specific mock interview matching this round.' : 'Add rounds to track dates and practice.', link: upcoming ? `/interviews/new?${jobQ}&round=${upcoming.type === 'hr' ? 'hr' : upcoming.type === 'system_design' ? 'system_design' : 'technical'}&mode=job_specific` : undefined });
      break;
    }
    case 'offer':
      out.push({ priority: 2, title: 'Review the offer against your priorities', detail: 'Compare salary, work mode and growth with your profile preferences before deciding.', link: '/profile' });
      break;
    case 'closed':
      if (app.outcome === 'rejected') out.push({ priority: 3, title: 'Capture lessons learned', detail: 'Note any feedback and update your learning plan for repeated gaps.', link: '/learning' });
      break;
  }
  return out.sort((a, b) => a.priority - b.priority);
}

export async function getApplicationDetail(ctx: AppContext, userId: number, id: number) {
  const app = await owned(ctx, userId, id);
  const events = await ctx.db.select().from(applicationEvents).where(eq(applicationEvents.applicationId, id)).orderBy(asc(applicationEvents.at), asc(applicationEvents.id));
  const rounds = await ctx.db.select().from(interviewRounds).where(eq(interviewRounds.applicationId, id)).orderBy(asc(interviewRounds.scheduledAt));
  const resume = app.resumeVersionId ? (await ctx.db.select({ versionId: resumeVersions.id, versionNo: resumeVersions.versionNo, resumeId: resumes.id, title: resumes.title }).from(resumeVersions).innerJoin(resumes, eq(resumes.id, resumeVersions.resumeId)).where(eq(resumeVersions.id, app.resumeVersionId)))[0] ?? null : null;
  const job = app.jobId ? (await ctx.db.select().from(jobs).where(eq(jobs.id, app.jobId)))[0] ?? null : null;
  const match = job ? await computeJobMatch(ctx, userId, job.id).catch(() => null) : null;
  const sessions = job ? await ctx.db.select({ id: interviewSessions.id, status: interviewSessions.status, roundType: interviewSessions.roundType, createdAt: interviewSessions.createdAt }).from(interviewSessions).where(and(eq(interviewSessions.userId, userId), eq(interviewSessions.jobId, job.id))).orderBy(desc(interviewSessions.createdAt)) : [];
  const nextActions = recommendNextActions({ app, lastEventAt: events.at(-1)?.at ?? app.createdAt, rounds, criticalGaps: match?.criticalGaps.map((g) => g.label) ?? [], recommendedAssessments: match?.recommendedAssessments.map((r) => r.skillName) ?? [], jobUrl: job?.canonicalUrl ?? app.jobSnapshot.url, today: todayIso(ctx.now()) });
  return { application: app, events, rounds, resume, job: job ? { id: job.id, title: job.title, company: job.company, status: job.status, isDemo: job.isDemo, url: job.canonicalUrl } : null, match: match ? { score: match.score, criticalGaps: match.criticalGaps, evidenceCoverage: match.evidenceCoverage } : null, interviewSessions: sessions, nextActions };
}

export async function listApplications(ctx: AppContext, userId: number) {
  const apps = await ctx.db.select().from(jobApplications).where(eq(jobApplications.userId, userId)).orderBy(desc(jobApplications.updatedAt));
  const vIds = apps.map((a) => a.resumeVersionId).filter((x): x is number => !!x);
  const versions = vIds.length ? await ctx.db.select({ id: resumeVersions.id, versionNo: resumeVersions.versionNo, title: resumes.title }).from(resumeVersions).innerJoin(resumes, eq(resumes.id, resumeVersions.resumeId)).where(inArray(resumeVersions.id, vIds)) : [];
  const ids = apps.map((a) => a.id);
  const rounds = ids.length ? await ctx.db.select().from(interviewRounds).where(inArray(interviewRounds.applicationId, ids)) : [];
  const events = ids.length ? await ctx.db.select({ applicationId: applicationEvents.applicationId, at: applicationEvents.at }).from(applicationEvents).where(inArray(applicationEvents.applicationId, ids)) : [];
  const today = todayIso(ctx.now());
  return apps.map((a) => {
    const last = events.filter((e) => e.applicationId === a.id).map((e) => e.at).sort((x, y) => y.getTime() - x.getTime())[0] ?? a.createdAt;
    const r = rounds.filter((x) => x.applicationId === a.id);
    return { ...a, resumeLabel: versions.find((v) => v.id === a.resumeVersionId) ? `${versions.find((v) => v.id === a.resumeVersionId)!.title} v${versions.find((v) => v.id === a.resumeVersionId)!.versionNo}` : null, roundCount: r.length, nextAction: recommendNextActions({ app: a, lastEventAt: last, rounds: r, criticalGaps: [], recommendedAssessments: [], jobUrl: a.jobSnapshot.url, today })[0] ?? null };
  });
}

export async function applicationAnalytics(ctx: AppContext, userId: number) {
  const apps = await ctx.db.select().from(jobApplications).where(eq(jobApplications.userId, userId));
  const ids = apps.map((a) => a.id);
  const events = ids.length ? await ctx.db.select().from(applicationEvents).where(inArray(applicationEvents.applicationId, ids)) : [];
  const reached = (s: ApplicationStage) => apps.filter((a) => events.some((e) => e.applicationId === a.id && e.toStage && ORDER(e.toStage as ApplicationStage) >= ORDER(s) && e.toStage !== 'closed') || (ORDER(a.stage) >= ORDER(s) && a.stage !== 'closed')).length;
  const applied = apps.filter((a) => a.appliedAt).length;
  const responseDays = apps.filter((a) => a.appliedAt).map((a) => {
    const first = events.filter((e) => e.applicationId === a.id && e.toStage && e.toStage !== 'closed' && ORDER(e.toStage as ApplicationStage) > ORDER('applied')).sort((x, y) => x.at.getTime() - y.at.getTime())[0];
    return first ? (first.at.getTime() - a.appliedAt!.getTime()) / 86_400_000 : null;
  }).filter((x): x is number => x != null);
  const bySource = new Map<string, number>();
  for (const a of apps) bySource.set(a.source || 'unknown', (bySource.get(a.source || 'unknown') ?? 0) + 1);
  return {
    total: apps.length,
    demoJobs: apps.filter((a) => a.jobSnapshot.isDemo).length,
    byStage: APPLICATION_STAGES.map((s) => ({ stage: s, count: apps.filter((a) => a.stage === s).length })),
    byOutcome: APPLICATION_OUTCOMES.map((o) => ({ outcome: o, count: apps.filter((a) => a.outcome === o).length })),
    funnel: [{ stage: 'applied', count: applied }, { stage: 'screening', count: reached('screening') }, { stage: 'interview', count: reached('interview') }, { stage: 'offer', count: reached('offer') }],
    responseRate: applied ? Math.round((reached('screening') / applied) * 100) : null,
    medianDaysToResponse: responseDays.length ? responseDays.sort((a, b) => a - b)[Math.floor(responseDays.length / 2)] : null,
    bySource: [...bySource.entries()].map(([source, count]) => ({ source, count })),
  };
}
