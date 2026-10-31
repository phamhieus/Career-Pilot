import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, desc, eq, gte, ne } from 'drizzle-orm';
import { z } from 'zod';
import { userContext, type AppContext } from '../context.js';
import { APPLICATION_OUTCOMES, APPLICATION_STAGES, jobApplications, learningPlans, learningTasks, resumes } from '../db/schema.js';
import { todayIso } from '../lib/dates.js';
import { badRequest } from '../lib/errors.js';
import * as apps from '../services/applications.js';
import * as assess from '../services/assessments.js';
import * as interviews from '../services/interviews.js';
import * as learning from '../services/learning.js';
import { computeAllRoleMatches } from '../services/matching.js';
import { markSeen } from '../services/onboarding.js';
import { getProfile } from '../services/profile.js';
import * as resume from '../services/resume.js';
import { loadSampleApplications } from '../services/sampleApplications.js';
import { exportDocx, exportPdf } from '../services/resumeExport.js';
import { idParam, parse, requireUser, sendFile } from './helpers.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function workRoutes(app: FastifyInstance, ctx: AppContext) {
  const uc = (req: FastifyRequest) => userContext(ctx, req.user?.id);
  // ---------------- Assessments ----------------
  app.get('/api/assessments', async (req) => assess.listAssessments(await uc(req), requireUser(req).id));
  app.post('/api/assessments/blueprints', async (req) => {
    const body = parse(z.object({ skillSlugs: z.array(z.string().max(80)).max(5).optional(), roleSlug: z.string().max(80).optional(), roadmapNodeKey: z.string().max(80).optional(), level: z.number().int().min(1).max(5).optional(), learningPlanId: z.number().int().optional() }), req.body);
    return assess.createBlueprint(await uc(req), requireUser(req).id, body);
  });
  app.post('/api/assessments/blueprints/:id/attempts', async (req) => assess.startAttempt(await uc(req), requireUser(req).id, idParam(req)));
  app.get('/api/assessments/attempts/:id', async (req) => assess.attemptView(await uc(req), requireUser(req).id, idParam(req)));
  app.post('/api/assessments/attempts/:id/submit', async (req) => {
    const body = parse(z.object({ answers: z.record(z.string(), z.object({ choice: z.number().int().min(0).max(10).optional(), text: z.string().max(10000).optional() })), language: z.enum(['en', 'vi']).optional() }), req.body);
    return assess.submitAttempt(await uc(req), requireUser(req).id, idParam(req), body.answers, body.language);
  });

  // ---------------- Learning ----------------
  app.get('/api/learning', async (req) => learning.listPlans(await uc(req), requireUser(req).id));
  app.post('/api/learning', async (req) => {
    const body = parse(z.object({ roleSlug: z.string().max(80), weeklyHours: z.number().min(1).max(80).optional(), deadline: dateStr.nullable().optional(), startDate: dateStr.optional(), studyDaysPerWeek: z.number().int().min(1).max(7).optional(), learningFormat: z.enum(['docs', 'project', 'youtube']).optional() }), req.body);
    return learning.createPlan(await uc(req), requireUser(req).id, body);
  });
  app.get('/api/learning/:id', async (req) => learning.getPlanDetail(await uc(req), requireUser(req).id, idParam(req)));
  app.patch('/api/learning/:id/format', async (req) => learning.changeLearningFormat(await uc(req), requireUser(req).id, idParam(req), parse(z.object({ learningFormat: z.enum(['docs', 'project', 'youtube']) }), req.body).learningFormat));
  app.post('/api/learning/:id/replan', async (req) => learning.replan(await uc(req), requireUser(req).id, idParam(req), 'manual', 'Recalculated on request with your latest evidence.'));
  app.post('/api/learning/:id/reschedule-missed', async (req) => learning.rescheduleMissed(await uc(req), requireUser(req).id, idParam(req)));
  app.post('/api/learning/:id/extra-skills', async (req) => learning.addExtraSkills(await uc(req), requireUser(req).id, idParam(req), parse(z.object({ skillSlugs: z.array(z.string().max(80)).min(1).max(10) }), req.body).skillSlugs));
  app.patch('/api/learning/tasks/:id', async (req) => learning.setTaskStatus(await uc(req), requireUser(req).id, idParam(req), parse(z.object({ status: z.enum(['done', 'skipped', 'todo']) }), req.body).status));

  // ---------------- Interviews ----------------
  app.get('/api/interviews', async (req) => interviews.listSessions(await uc(req), requireUser(req).id));
  app.post('/api/interviews', async (req) => {
    const body = parse(z.object({
      mode: z.enum(['discovery', 'skill_verification', 'job_specific', 'focused']), roleSlug: z.string().max(80).optional(), jobId: z.number().int().optional(),
      seniority: z.enum(['intern', 'junior', 'middle', 'senior', 'lead']).optional(), roundType: z.enum(['hr', 'technical', 'case', 'system_design', 'leadership', 'mixed']).optional(),
      language: z.enum(['en', 'vi']).optional(), durationMinutes: z.number().int().min(5).max(60).optional(), answerMode: z.enum(['text', 'voice']).optional(), focusSkills: z.array(z.string().max(80)).max(5).optional(),
    }), req.body);
    return interviews.createSession(await uc(req), requireUser(req).id, body);
  });
  app.get('/api/interviews/:id', async (req) => interviews.getSessionDetail(await uc(req), requireUser(req).id, idParam(req)));
  app.post('/api/interviews/:id/start', async (req) => {
    const body = parse(z.object({
      background: z.object({
        situation: z.enum(['student', 'tech', 'non_tech', 'break']), currentRoleSlug: z.string().max(80).nullable().optional(), currentTitle: z.string().max(120).optional(),
        yearsExperience: z.number().min(0).max(50).nullable().optional(), education: z.string().max(40).optional(), summary: z.string().max(1500).optional(),
      }).optional(),
    }), req.body ?? {});
    return interviews.startSession(await uc(req), requireUser(req).id, idParam(req), body.background);
  });
  app.post('/api/interviews/:id/answer', async (req) => interviews.answerQuestion(await uc(req), requireUser(req).id, idParam(req), parse(z.object({ content: z.string().max(8000).default(''), inputMode: z.enum(['text', 'voice']).default('text'), choices: z.array(z.string().max(60)).max(12).optional() }), req.body)));
  app.post('/api/interviews/:id/finish', async (req) => interviews.completeSession(await uc(req), requireUser(req).id, idParam(req)));
  app.post('/api/interviews/:id/abandon', async (req) => { await interviews.abandonSession(await uc(req), requireUser(req).id, idParam(req)); return { ok: true }; });

  // ---------------- Resumes ----------------
  app.get('/api/resumes', async (req) => resume.listResumes(await uc(req), requireUser(req).id));
  app.post('/api/resumes', async (req) => {
    const user = requireUser(req);
    const body = parse(z.object({ kind: z.enum(['master', 'tailored']), jobId: z.number().int().optional(), baseResumeId: z.number().int().optional(), language: z.enum(['en', 'vi']).optional(), template: z.string().max(20).optional(), title: z.string().max(160).optional() }), req.body);
    if (body.kind === 'tailored') {
      if (!body.jobId) throw badRequest('jobId is required for a tailored CV');
      return resume.createTailoredResume(await uc(req), user.id, { ...body, jobId: body.jobId });
    }
    return resume.createMasterResume(await uc(req), user.id, body);
  });
  app.get('/api/resumes/:id', async (req) => resume.getResumeDetail(await uc(req), requireUser(req).id, idParam(req)));
  app.post('/api/resumes/:id/versions', async (req) => resume.saveResumeVersion(await uc(req), requireUser(req).id, idParam(req), parse(z.object({ content: z.unknown(), note: z.string().max(200).optional(), template: z.string().max(20).optional(), title: z.string().max(160).optional(), language: z.enum(['en', 'vi']).optional() }), req.body)));
  app.get('/api/resumes/:id/versions/:versionId', async (req) => resume.getResume(await uc(req), requireUser(req).id, idParam(req), idParam(req, 'versionId')));
  app.post('/api/resumes/:id/versions/:versionId/restore', async (req) => resume.restoreVersion(await uc(req), requireUser(req).id, idParam(req), idParam(req, 'versionId')));
  app.post('/api/resumes/:id/regenerate', async (req) => resume.regenerateTailored(await uc(req), requireUser(req).id, idParam(req)));
  app.delete('/api/resumes/:id', async (req) => { await resume.deleteResume(await uc(req), requireUser(req).id, idParam(req)); return { ok: true }; });
  app.get('/api/resumes/:id/export', async (req, reply) => {
    const q = parse(z.object({ format: z.enum(['pdf', 'docx']), versionId: z.coerce.number().int().optional() }), req.query);
    const { resume: r, version } = await resume.getResume(await uc(req), requireUser(req).id, idParam(req), q.versionId);
    const base = `${r.title} v${version.versionNo}`;
    await markSeen(ctx, requireUser(req).id, 'cvExport');
    if (q.format === 'pdf') return sendFile(reply, await exportPdf(version.content, r.template), `${base}.pdf`, 'application/pdf');
    return sendFile(reply, await exportDocx(version.content, r.template), `${base}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });

  // ---------------- Applications ----------------
  app.get('/api/applications', async (req) => apps.listApplications(await uc(req), requireUser(req).id));
  app.get('/api/applications/analytics', async (req) => apps.applicationAnalytics(await uc(req), requireUser(req).id));
  app.post('/api/applications/sample', async (req) => loadSampleApplications(await uc(req), requireUser(req).id));
  app.post('/api/applications', async (req) => apps.createApplication(await uc(req), requireUser(req).id, parse(z.object({ jobId: z.number().int(), resumeVersionId: z.number().int().nullable().optional(), source: z.string().max(80).optional(), notes: z.string().max(4000).optional() }), req.body)));
  app.get('/api/applications/:id', async (req) => {
    const detail = await apps.getApplicationDetail(await uc(req), requireUser(req).id, idParam(req));
    await markSeen(ctx, requireUser(req).id, 'application');
    return detail;
  });
  app.patch('/api/applications/:id', async (req) => apps.updateApplication(await uc(req), requireUser(req).id, idParam(req), parse(z.object({ notes: z.string().max(4000).optional(), contacts: z.array(z.object({ name: z.string().max(100), role: z.string().max(100).optional(), email: z.string().max(160).optional(), note: z.string().max(400).optional() })).max(20).optional(), followUpAt: dateStr.nullable().optional(), resumeVersionId: z.number().int().nullable().optional(), source: z.string().max(80).optional() }), req.body)));
  app.post('/api/applications/:id/stage', async (req) => apps.changeStage(await uc(req), requireUser(req).id, idParam(req), parse(z.object({ stage: z.enum(APPLICATION_STAGES), outcome: z.enum(APPLICATION_OUTCOMES).nullable().optional(), note: z.string().max(1000).optional() }), req.body)));
  app.post('/api/applications/:id/notes', async (req) => apps.addNoteEvent(await uc(req), requireUser(req).id, idParam(req), parse(z.object({ note: z.string().min(1).max(2000) }), req.body).note));
  app.post('/api/applications/:id/rounds', async (req) => apps.addRound(await uc(req), requireUser(req).id, idParam(req), parse(z.object({ name: z.string().min(1).max(120), type: z.enum(['hr', 'technical', 'case', 'system_design', 'assessment', 'leadership', 'other']), scheduledAt: z.string().max(30).nullable().optional(), notes: z.string().max(2000).optional() }), req.body)));
  app.patch('/api/applications/:id/rounds/:roundId', async (req) => apps.updateRound(await uc(req), requireUser(req).id, idParam(req), idParam(req, 'roundId'), parse(z.object({ status: z.enum(['scheduled', 'completed', 'cancelled']).optional(), notes: z.string().max(2000).optional(), scheduledAt: z.string().max(30).nullable().optional(), practiceSessionId: z.number().int().nullable().optional() }), req.body)));

  // ---------------- Dashboard ----------------
  app.get('/api/dashboard', async (req) => {
    const user = requireUser(req);
    const prof = await getProfile(await uc(req), user.id);
    const targets = prof.profile.targetRoleSlugs;
    const matches = (await computeAllRoleMatches(await uc(req), user.id)).filter((m) => targets.length ? targets.includes(m.role.slug) : true).slice(0, targets.length || 4);
    const [plan] = await ctx.db.select().from(learningPlans).where(and(eq(learningPlans.userId, user.id), eq(learningPlans.status, 'active'))).orderBy(desc(learningPlans.createdAt));
    const today = todayIso(ctx.now());
    const upcoming = plan ? await ctx.db.select().from(learningTasks).where(and(eq(learningTasks.planId, plan.id), eq(learningTasks.status, 'todo'), gte(learningTasks.scheduledDate, today))).orderBy(learningTasks.scheduledDate).limit(5) : [];
    const planDetail = plan ? await learning.getPlanDetail(await uc(req), user.id, plan.id) : null;
    const appList = await apps.listApplications(await uc(req), user.id);
    const sessions = (await interviews.listSessions(await uc(req), user.id)).slice(0, 3);
    const resumeCount = (await ctx.db.select({ id: resumes.id }).from(resumes).where(eq(resumes.userId, user.id))).length;
    const open = await ctx.db.select({ id: jobApplications.id }).from(jobApplications).where(and(eq(jobApplications.userId, user.id), ne(jobApplications.stage, 'closed')));
    return {
      profile: { completeness: prof.completeness, headline: prof.profile.headline, skillCounts: ['app_verified', 'assessed', 'self_reported', 'extracted_claim'].map((s) => ({ status: s, count: prof.skills.filter((x) => x.status === s).length })) },
      matches,
      plan: plan ? { id: plan.id, title: plan.title, stats: planDetail!.stats, projectedEndDate: plan.projectedEndDate, feasible: plan.feasible } : null,
      upcomingTasks: upcoming,
      applications: { open: open.length, nextActions: appList.filter((a) => a.nextAction).slice(0, 4).map((a) => ({ applicationId: a.id, title: a.jobSnapshot.title, company: a.jobSnapshot.company, action: a.nextAction })) },
      interviews: sessions,
      resumeCount,
    };
  });

}
