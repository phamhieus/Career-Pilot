import { and, desc, eq, inArray } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import {
  assessmentAttempts, careerProfiles, interviewSessions, jobApplications, learningPlans, learningTasks, profileItems, resumeVersions, resumes, userSkills,
} from '../db/schema.js';

/**
 * Guided first-run journey that mirrors the product's end-to-end scenario.
 * Completion is derived from real records; "seen" markers are written by the API when the
 * user actually opens the corresponding page (matching, roadmap, job match, CV export, …).
 */
export async function markSeen(ctx: AppContext, userId: number, key: string) {
  const [p] = await ctx.db.select({ onboarding: careerProfiles.onboarding }).from(careerProfiles).where(eq(careerProfiles.userId, userId));
  if (!p || p.onboarding.seen?.[key]) return;
  const onboarding = { ...p.onboarding, seen: { ...(p.onboarding.seen ?? {}), [key]: ctx.now().toISOString() } };
  await ctx.db.update(careerProfiles).set({ onboarding }).where(eq(careerProfiles.userId, userId));
}

export async function setOnboardingDismissed(ctx: AppContext, userId: number, dismissed: boolean) {
  const [p] = await ctx.db.select({ onboarding: careerProfiles.onboarding }).from(careerProfiles).where(eq(careerProfiles.userId, userId));
  await ctx.db.update(careerProfiles).set({ onboarding: { ...(p?.onboarding ?? {}), dismissed } }).where(eq(careerProfiles.userId, userId));
}

export interface OnboardingStep {
  n: number;
  key: string;
  phase: string;
  title: string;
  description: string;
  done: boolean;
  href: string;
  cta: string;
  /** Page path where the step happens (used to show contextual guidance). */
  path: string;
  why: string;
  howTo: string[];
}

export const PHASES = [
  { key: 'profile', label: 'Set up your profile' },
  { key: 'explore', label: 'Explore roles' },
  { key: 'jobs', label: 'Pick a job' },
  { key: 'learn', label: 'Learn & verify' },
  { key: 'apply', label: 'Apply' },
];

export async function getOnboarding(ctx: AppContext, userId: number) {
  const { db } = ctx;
  const [profile] = await db.select().from(careerProfiles).where(eq(careerProfiles.userId, userId));
  const seen = profile?.onboarding.seen ?? {};
  const items = await db.select({ kind: profileItems.kind, confirmed: profileItems.confirmed }).from(profileItems).where(eq(profileItems.userId, userId));
  const skills = await db.select({ status: userSkills.status }).from(userSkills).where(eq(userSkills.userId, userId));
  const sessions = await db.select({ id: interviewSessions.id, mode: interviewSessions.mode, status: interviewSessions.status }).from(interviewSessions).where(eq(interviewSessions.userId, userId));
  const plans = await db.select({ id: learningPlans.id }).from(learningPlans).where(and(eq(learningPlans.userId, userId), eq(learningPlans.status, 'active'))).orderBy(desc(learningPlans.createdAt));
  const practiceDone = plans.length ? (await db.select({ id: learningTasks.id }).from(learningTasks).where(and(eq(learningTasks.planId, plans[0].id), inArray(learningTasks.type, ['practice', 'project']), eq(learningTasks.status, 'done')))).length > 0 : false;
  const graded = (await db.select({ id: assessmentAttempts.id }).from(assessmentAttempts).where(and(eq(assessmentAttempts.userId, userId), eq(assessmentAttempts.status, 'graded')))).length > 0;
  const tailored = await db.select({ id: resumes.id, jobId: resumes.jobId }).from(resumes).where(and(eq(resumes.userId, userId), eq(resumes.kind, 'tailored'))).orderBy(desc(resumes.updatedAt));
  const editedTailored = tailored.length ? (await db.select({ id: resumeVersions.id }).from(resumeVersions).where(and(inArray(resumeVersions.resumeId, tailored.map((t) => t.id)), eq(resumeVersions.createdBy, 'user')))).length > 0 : false;
  const apps = await db.select({ id: jobApplications.id, stage: jobApplications.stage, jobId: jobApplications.jobId }).from(jobApplications).where(eq(jobApplications.userId, userId)).orderBy(desc(jobApplications.updatedAt));

  const target = profile?.targetRoleSlugs[0] ?? 'ai-engineer';
  const rolesViewed = Object.keys(seen).filter((k) => k.startsWith('role:')).length;
  const lastJobKey = Object.entries(seen).filter(([k]) => k.startsWith('job:')).sort((a, b) => b[1].localeCompare(a[1]))[0]?.[0];
  const jobId = tailored[0]?.jobId ?? apps[0]?.jobId ?? (lastJobKey ? Number(lastJobKey.slice(4)) : null);
  const jobHref = jobId ? `/jobs/${jobId}` : '/jobs';
  const completed = (mode: string) => sessions.some((s) => s.mode === mode && s.status === 'completed');

  const steps: Omit<OnboardingStep, 'n'>[] = [
    { key: 'profile', phase: 'profile', title: 'Create or import your profile', description: 'Import your CV or add experience and skills. Imported entries stay unconfirmed until you review them.', done: items.some((i) => i.kind === 'work' && i.confirmed) || skills.length >= 5, href: '/profile', cta: 'Open profile', path: "/profile", why: "Everything else — matching, plans, CVs — is computed from your profile and skills.", howTo: ["Open Profile → Experience and click “Import CV” (PDF, DOCX or text), then confirm each imported entry.","Or add entries manually, or click “Load sample backend profile” to try the app.","In Skills, rate your skills 1–5. Set weekly learning hours under Constraints & goals."] },
    { key: 'discovery', phase: 'profile', title: 'Complete a discovery or skill interview', description: 'A short interview about what energizes you, your values and constraints — or a skill verification interview.', done: completed('discovery') || completed('skill_verification'), href: '/interviews/new?mode=discovery', cta: 'Start interview', path: "/interviews", why: "Clarifies what you enjoy and value, so role suggestions fit you, not just your skills.", howTo: ["Click “Build blueprint”, then “Start interview”.","Answer five short questions by typing or dictating.","On the report, review the suggested interests and values and click “Apply to my profile”."] },
    { key: 'roles', phase: 'explore', title: 'Explore target roles', description: 'Read at least two role profiles (for example AI Engineer and Cloud Engineer) and pick your targets.', done: rolesViewed >= 2, href: '/atlas', cta: 'Open atlas', path: "/atlas", why: "Understand what each role really involves before committing time to it.", howTo: ["Open the Career Atlas and read at least two role pages (e.g. AI Engineer and Cloud Engineer).","Check responsibilities, level expectations, critical skills and the outlook.","Add the roles you like as targets under Profile → Constraints & goals."] },
    { key: 'matching', phase: 'explore', title: 'See skill matching and evidence gaps', description: 'Four independent indicators per role, with critical gaps and skills that still need evidence.', done: !!seen.matching, href: `/matching?role=${target}`, cta: 'View matching', path: "/matching", why: "Shows how close you are to each role and which critical skills still need evidence.", howTo: ["Select a target role in the list.","Read the four indicators — they are independent, not one score.","Note the critical gate and the skills marked Unknown or Self-reported."] },
    { key: 'roadmap', phase: 'explore', title: 'View the interactive roadmap', description: 'Prerequisites, resources and checkpoints for your target role.', done: !!seen.roadmap, href: `/roadmap/${target}`, cta: 'Open roadmap', path: "/roadmap", why: "Turns the gaps into an ordered path with resources and checkpoints.", howTo: ["Pan and zoom the graph; click a node to see the outcome, resources and verification method.","Red rings mark required skills you have not verified yet."] },
    { key: 'job', phase: 'jobs', title: 'Select a job', description: 'Sync real postings, import a job description, or open a clearly labeled demo job.', done: !!lastJobKey, href: '/jobs', cta: 'Browse jobs', path: "/jobs", why: "A concrete posting makes your learning and CV target specific.", howTo: ["Click “Sync now” on Cert Trends to load real postings, or “Import a job description” to paste one.","Open a posting (demo postings are labeled and fictional)."] },
    { key: 'jobMatch', phase: 'jobs', title: 'Review job matching and critical gaps', description: 'See matched skills, critical gaps, unknown requirements and recommended assessments for that job.', done: !!lastJobKey && !!seen.jobMatch, href: jobHref, cta: 'Open job', path: "/jobs/", why: "Tells you exactly what this job needs that you cannot yet show.", howTo: ["On the job page, review the match components, critical gaps and unknown requirements.","Use “Start assessment” on the recommended skills if you want to close evidence gaps."] },
    { key: 'plan', phase: 'learn', title: 'Generate your learning plan', description: 'A schedule that respects prerequisites, your weekly hours and deadline.', done: plans.length > 0, href: `/learning?role=${target}`, cta: 'Create plan', path: "/learning", why: "Builds a realistic schedule from your gaps, weekly hours and deadline.", howTo: ["Choose the target role, check hours per week and deadline, then click “Generate plan”.","Verified skills are skipped automatically."] },
    { key: 'practice', phase: 'learn', title: 'Complete a practice task and an assessment', description: 'Tick off a practice task in your plan, then take an assessment.', done: practiceDone && graded, href: plans.length ? `/learning/${plans[0].id}` : '/learning', cta: practiceDone ? 'Take an assessment' : 'Open plan', path: "/learning/", why: "Practice and assessments are what turn claims into evidence.", howTo: ["In your plan, tick a practice task when you finish it.","Click “Start” on an assessment task (or use Assessments), answer and submit."] },
    { key: 'progress', phase: 'learn', title: 'See your evidence and progress update', description: 'Assessed skills update your profile, matching and plan automatically.', done: skills.some((s) => s.status === 'assessed' || s.status === 'app_verified') && !!seen.skills, href: '/profile?tab=skills', cta: 'View skills', path: "/profile", why: "See how evidence changes your skill status, matching and plan.", howTo: ["Open Profile → Skills and check the new status and evidence entries.","Your plan shows a revision explaining what changed."] },
    { key: 'mockInterview', phase: 'apply', title: 'Run a job-specific mock interview', description: 'Rehearse for the selected job and review the report.', done: completed('job_specific'), href: jobId ? `/interviews/new?mode=job_specific&jobId=${jobId}` : '/interviews/new?mode=job_specific', cta: 'Start mock interview', path: "/interviews", why: "Rehearse the real interview for the job you picked.", howTo: ["Choose mode “Job-specific” and the job, then “Build blueprint” and “Start interview”.","Answer one question at a time; read the report and AI coaching afterwards."] },
    { key: 'tailoredCv', phase: 'apply', title: 'Generate and edit a tailored CV', description: 'Built only from confirmed evidence; review flagged claims and save your edits as a new version.', done: editedTailored, href: tailored[0] ? `/resume/${tailored[0].id}` : jobId ? `/resume?jobId=${jobId}` : '/resume', cta: tailored[0] ? 'Edit CV' : 'Create CV', path: "/resume", why: "A CV focused on this job, built only from what you can back up.", howTo: ["Create a tailored CV for the job (or click “Tailor my CV” on the job page).","Review flagged bullets: revert, edit, link evidence or confirm them.","Click “Save as v2” to keep your edits as a new version."] },
    { key: 'exportCv', phase: 'apply', title: 'Export the CV', description: 'Download as PDF or DOCX.', done: !!seen.cvExport, href: tailored[0] ? `/resume/${tailored[0].id}` : '/resume', cta: 'Export', path: "/resume/", why: "Get a file you can submit on the employer’s site.", howTo: ["In the CV editor, click “PDF” or “DOCX”."] },
    { key: 'tracker', phase: 'apply', title: 'Save the job to the application tracker', description: 'The exact CV version you attach is kept with the application.', done: apps.length > 0, href: jobHref, cta: 'Save job', path: "/jobs/", why: "Keeps the job, the exact CV version you sent and every step in one place.", howTo: ["On the job page, click “Save to tracker”.","Attach the CV version you will submit."] },
    { key: 'track', phase: 'apply', title: 'Track the application and follow next actions', description: 'Move it to Applied once you have submitted it on the employer’s site, then follow the recommended next actions.', done: apps.some((a) => a.stage !== 'saved') && !!seen.application, href: apps[0] ? `/applications/${apps[0].id}` : '/applications', cta: 'Open tracker', path: "/applications", why: "You apply yourself; CareerPilot keeps the timeline and suggests what to do next.", howTo: ["After submitting on the employer’s site, move the card to “Applied”.","Open the application to see recommended next actions and AI suggestions."] },
  ];
  const numbered: OnboardingStep[] = steps.map((s, i) => ({ ...s, n: i + 1 }));
  const current = numbered.find((s) => !s.done) ?? null;
  return { phases: PHASES, steps: numbered, completed: numbered.filter((s) => s.done).length, total: numbered.length, current: current?.n ?? null, dismissed: !!profile?.onboarding.dismissed };
}
