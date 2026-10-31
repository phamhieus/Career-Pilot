import { and, eq, inArray, like } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import * as schema from '../db/schema.js';
import { careerProfiles, profileItems, skillEvidence, skills, users } from '../db/schema.js';
import { badRequest, notFound } from '../lib/errors.js';
import { addEvidence, listUserSkills, recomputeUserSkill, setSelfReported } from './evidence.js';

export const profilePatchSchema = z.object({
  headline: z.string().max(200).optional(),
  summary: z.string().max(3000).optional(),
  currentRoleSlug: z.string().max(80).nullable().optional(),
  yearsExperience: z.number().min(0).max(60).nullable().optional(),
  location: z.string().max(120).optional(),
  markets: z.array(z.enum(['vietnam', 'singapore', 'japan', 'remote', 'global'])).max(5).optional(),
  workModes: z.array(z.enum(['remote', 'hybrid', 'onsite'])).max(3).optional(),
  salaryMin: z.number().int().min(0).nullable().optional(),
  salaryCurrency: z.string().max(8).nullable().optional(),
  weeklyLearningHours: z.number().min(0).max(80).nullable().optional(),
  studyDaysPerWeek: z.number().int().min(1).max(7).optional(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  preferredLanguage: z.enum(['en', 'vi']).optional(),
  learningStyle: z.string().max(80).nullable().optional(),
  monthlyBudget: z.number().int().min(0).nullable().optional(),
  interests: z.array(z.string().max(60)).max(11).optional(),
  taskAffinity: z.record(z.string(), z.number().int().min(1).max(5)).optional(),
  workValues: z.array(z.string().max(40)).max(10).optional(),
  targetRoleSlugs: z.array(z.string().max(80)).max(5).optional(),
  goals: z.string().max(2000).optional(),
});

export const itemSchema = z.object({
  kind: z.enum(['work', 'project', 'education', 'certification']),
  title: z.string().min(1).max(200),
  organization: z.string().max(200).optional().default(''),
  startDate: z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/).nullable().optional(),
  endDate: z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/).nullable().optional(),
  description: z.string().max(3000).optional().default(''),
  highlights: z.array(z.string().max(500)).max(20).optional().default([]),
  skillSlugs: z.array(z.string().max(80)).max(40).optional().default([]),
  url: z.string().url().max(300).nullable().optional(),
  confirmed: z.boolean().optional(),
});

export async function getProfile(ctx: AppContext, userId: number) {
  const [user] = await ctx.db.select({ id: users.id, email: users.email, displayName: users.displayName, createdAt: users.createdAt }).from(users).where(eq(users.id, userId));
  let [profile] = await ctx.db.select().from(careerProfiles).where(eq(careerProfiles.userId, userId));
  if (!profile) [profile] = await ctx.db.insert(careerProfiles).values({ userId }).returning();
  const items = await ctx.db.select().from(profileItems).where(eq(profileItems.userId, userId));
  const userSkillList = await listUserSkills(ctx, userId);
  const checks = [
    { key: 'headline', done: !!profile.headline, label: 'Headline' },
    { key: 'experience', done: items.some((i) => i.kind === 'work' && i.confirmed), label: 'Confirmed work experience' },
    { key: 'skills', done: userSkillList.length >= 5, label: 'At least 5 skills' },
    { key: 'interests', done: Object.keys(profile.taskAffinity).length >= 3 || profile.workValues.length > 0, label: 'Task preferences or work values' },
    { key: 'constraints', done: !!profile.weeklyLearningHours, label: 'Weekly learning hours' },
    { key: 'targets', done: profile.targetRoleSlugs.length > 0, label: 'Target role(s)' },
    { key: 'assessed', done: userSkillList.some((s) => s.status === 'assessed' || s.status === 'app_verified'), label: 'At least one assessed skill' },
  ];
  return { user, profile, items: items.sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? '')), skills: userSkillList, completeness: { score: Math.round((checks.filter((c) => c.done).length / checks.length) * 100), checks } };
}

export async function updateProfile(ctx: AppContext, userId: number, patch: z.infer<typeof profilePatchSchema>) {
  await getProfile(ctx, userId);
  const [row] = await ctx.db.update(careerProfiles).set({ ...patch, updatedAt: ctx.now() }).where(eq(careerProfiles.userId, userId)).returning();
  return row;
}

async function syncItemClaims(ctx: AppContext, userId: number, item: typeof profileItems.$inferSelect) {
  const ref = `profile_item:${item.id}`;
  const old = await ctx.db.select().from(skillEvidence).where(and(eq(skillEvidence.userId, userId), eq(skillEvidence.sourceRef, ref)));
  await ctx.db.delete(skillEvidence).where(and(eq(skillEvidence.userId, userId), eq(skillEvidence.sourceRef, ref)));
  const affected = new Set(old.map((o) => o.skillId));
  if (item.confirmed && item.skillSlugs.length) {
    const rows = await ctx.db.select().from(skills).where(inArray(skills.slug, item.skillSlugs));
    for (const s of rows) {
      await ctx.db.insert(skillEvidence).values({ userId, skillId: s.id, type: item.kind === 'certification' ? 'course_completion' : 'cv_extraction', sourceRef: ref, notes: `Listed on "${item.title}"` });
      affected.add(s.id);
    }
  }
  for (const sid of affected) await recomputeUserSkill(ctx, userId, sid);
}

export async function createItem(ctx: AppContext, userId: number, input: z.infer<typeof itemSchema>, source: 'manual' | 'cv_import' | 'interview' = 'manual') {
  const tax = await ctx.taxonomy();
  const skillSlugs = input.skillSlugs.length ? input.skillSlugs.filter((s) => tax.bySlug.has(s)) : tax.findSkills([input.title, input.description, ...input.highlights].join('\n'));
  const [item] = await ctx.db.insert(profileItems).values({ ...input, skillSlugs, userId, source, confirmed: input.confirmed ?? source === 'manual' }).returning();
  await syncItemClaims(ctx, userId, item);
  return item;
}

export async function updateItem(ctx: AppContext, userId: number, id: number, input: Partial<z.infer<typeof itemSchema>>) {
  const [existing] = await ctx.db.select().from(profileItems).where(and(eq(profileItems.id, id), eq(profileItems.userId, userId)));
  if (!existing) throw notFound('Profile item');
  const tax = await ctx.taxonomy();
  const patch = { ...input, ...(input.skillSlugs ? { skillSlugs: input.skillSlugs.filter((s) => tax.bySlug.has(s)) } : {}) };
  const [item] = await ctx.db.update(profileItems).set(patch).where(eq(profileItems.id, id)).returning();
  await syncItemClaims(ctx, userId, item);
  return item;
}

export async function deleteItem(ctx: AppContext, userId: number, id: number) {
  const [existing] = await ctx.db.select().from(profileItems).where(and(eq(profileItems.id, id), eq(profileItems.userId, userId)));
  if (!existing) throw notFound('Profile item');
  await ctx.db.delete(profileItems).where(eq(profileItems.id, id));
  await syncItemClaims(ctx, userId, { ...existing, confirmed: false });
}

export async function extractText(file: { buffer: Buffer; mimetype: string; filename: string }): Promise<string> {
  const name = file.filename.toLowerCase();
  if (file.mimetype === 'application/pdf' || name.endsWith('.pdf')) {
    if (file.buffer.subarray(0, 4).toString() !== '%PDF') throw badRequest('File is not a valid PDF');
    const { extractText: pdfText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(file.buffer));
    const { text } = await pdfText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join('\n') : text;
  }
  if (name.endsWith('.docx') || file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    if (file.buffer.subarray(0, 2).toString() !== 'PK') throw badRequest('File is not a valid DOCX');
    const mammoth = await import('mammoth');
    return (await mammoth.extractRawText({ buffer: file.buffer })).value;
  }
  if (name.endsWith('.txt') || name.endsWith('.md') || file.mimetype.startsWith('text/')) return file.buffer.toString('utf8');
  throw badRequest('Unsupported file type. Upload PDF, DOCX or TXT.');
}

/** Parses a CV into UNCONFIRMED profile items plus extracted skill claims. */
export async function importCv(ctx: AppContext, userId: number, text: string) {
  if (text.trim().length < 50) throw badRequest('Could not read enough text from the CV');
  const tax = await ctx.taxonomy();
  const parsed = await ctx.ai.parseResume(text, tax);
  const created = [];
  for (const it of parsed.data.items) {
    created.push(await createItem(ctx, userId, { kind: it.kind, title: it.title, organization: it.organization, startDate: it.startDate, endDate: it.endDate, description: it.description, highlights: it.highlights, skillSlugs: it.skillSlugs, confirmed: false }, 'cv_import'));
  }
  const skillRows = parsed.data.skills.length ? await ctx.db.select().from(skills).where(inArray(skills.slug, parsed.data.skills)) : [];
  await ctx.db.delete(skillEvidence).where(and(eq(skillEvidence.userId, userId), eq(skillEvidence.sourceRef, 'cv_import')));
  for (const s of skillRows) await addEvidence(ctx, userId, s.id, { type: 'cv_extraction', sourceRef: 'cv_import', notes: 'Listed in imported CV' });
  const [profile] = await ctx.db.select().from(careerProfiles).where(eq(careerProfiles.userId, userId));
  const suggestions = { headline: parsed.data.headline, summary: parsed.data.summary, location: parsed.data.location, name: parsed.data.name };
  if (profile && !profile.headline && parsed.data.headline) await ctx.db.update(careerProfiles).set({ headline: parsed.data.headline }).where(eq(careerProfiles.userId, userId));
  if (profile && !profile.summary && parsed.data.summary) await ctx.db.update(careerProfiles).set({ summary: parsed.data.summary }).where(eq(careerProfiles.userId, userId));
  return { items: created, extractedSkills: skillRows.map((s) => s.slug), suggestions, aiMeta: parsed.meta };
}

export async function applyDiscovery(ctx: AppContext, userId: number, input: { interests?: string[]; workValues?: string[]; taskAffinity?: Record<string, number>; goals?: string }) {
  const { profile } = await getProfile(ctx, userId);
  return updateProfile(ctx, userId, {
    interests: [...new Set([...profile.interests, ...(input.interests ?? [])])],
    workValues: [...new Set([...(input.workValues ?? []), ...profile.workValues])].slice(0, 6),
    taskAffinity: { ...profile.taskAffinity, ...(input.taskAffinity ?? {}) },
    goals: input.goals ? [profile.goals, input.goals].filter(Boolean).join('\n') : profile.goals,
  });
}

const SAMPLE_SKILLS: [string, number][] = [['programming-fundamentals', 4], ['java', 4], ['sql', 4], ['api-design', 4], ['relational-databases', 3], ['testing', 3], ['git', 4], ['containers', 3], ['caching', 3], ['web-fundamentals', 4], ['linux', 3], ['ci-cd', 3], ['message-queues', 2], ['system-design', 2], ['python', 2], ['aws', 2], ['llm-applications', 1]];

/** Clearly-labeled sample profile so the acceptance flow can be explored without a real CV. */
export async function loadSampleProfile(ctx: AppContext, userId: number) {
  await updateProfile(ctx, userId, {
    headline: 'Backend Developer (sample profile)',
    summary: 'Backend developer with experience building REST APIs with Java and Spring Boot, PostgreSQL data models and containerized services. Interested in moving toward AI engineering and cloud. (Sample data — replace with your own.)',
    currentRoleSlug: 'backend-engineer', yearsExperience: 5, location: 'Ho Chi Minh City', markets: ['vietnam', 'remote'], workModes: ['hybrid', 'remote'],
    weeklyLearningHours: 10, studyDaysPerWeek: 5, preferredLanguage: 'en', targetRoleSlugs: ['ai-engineer', 'cloud-engineer'],
    taskAffinity: { building: 5, analysis: 4, research: 4, design: 3, communication: 3, operations: 3, organizing: 2, leading: 2 },
    workValues: ['learning', 'impact', 'autonomy'], interests: ['ai-data', 'cloud-devops', 'software-engineering'],
    goals: 'Become an AI Engineer within a year while keeping backend strengths.',
  });
  const existing = await ctx.db.select().from(profileItems).where(and(eq(profileItems.userId, userId), like(profileItems.organization, '%(sample)%')));
  if (!existing.length) {
    await createItem(ctx, userId, { kind: 'work', title: 'Backend Developer', organization: 'Example Retail Platform (sample)', startDate: '2021-03', endDate: null, description: 'Backend services for an e-commerce platform.', highlights: ['Built and maintained REST APIs in Java and Spring Boot for order and payment flows', 'Designed PostgreSQL schemas and added indexes for slow reporting queries', 'Introduced Redis caching for product catalog reads', 'Containerized services with Docker and maintained GitHub Actions CI pipelines'], skillSlugs: ['java', 'api-design', 'sql', 'relational-databases', 'caching', 'containers', 'ci-cd'], url: null });
    await createItem(ctx, userId, { kind: 'work', title: 'Junior Java Developer', organization: 'Example Software Outsourcing (sample)', startDate: '2019-06', endDate: '2021-02', description: '', highlights: ['Implemented features and unit tests for client web applications', 'Fixed production bugs using logs and debugging tools'], skillSlugs: ['java', 'testing', 'programming-fundamentals', 'git'], url: null });
    await createItem(ctx, userId, { kind: 'project', title: 'Personal chatbot experiment', organization: 'Personal project (sample)', startDate: '2025-01', endDate: '2025-03', description: 'A small Telegram bot calling an LLM API.', highlights: ['Built a Python bot that calls an LLM API to summarize links shared in a group chat'], skillSlugs: ['python', 'llm-applications'], url: null });
    await createItem(ctx, userId, { kind: 'education', title: 'B.Sc. Computer Science', organization: 'Example University (sample)', startDate: '2015-09', endDate: '2019-06', description: '', highlights: [], skillSlugs: [], url: null });
  }
  for (const [slug, rating] of SAMPLE_SKILLS) await setSelfReported(ctx, userId, slug, rating);
  return getProfile(ctx, userId);
}

/** Full export of the user's personal data (JSON). */
export async function exportUserData(ctx: AppContext, userId: number) {
  const q = async <T>(p: Promise<T>) => p;
  const s = schema;
  return {
    exportedAt: ctx.now().toISOString(),
    user: (await q(ctx.db.select({ id: s.users.id, email: s.users.email, displayName: s.users.displayName, createdAt: s.users.createdAt }).from(s.users).where(eq(s.users.id, userId))))[0],
    profile: (await q(ctx.db.select().from(s.careerProfiles).where(eq(s.careerProfiles.userId, userId))))[0],
    profileItems: await ctx.db.select().from(s.profileItems).where(eq(s.profileItems.userId, userId)),
    skills: await ctx.db.select().from(s.userSkills).where(eq(s.userSkills.userId, userId)),
    evidence: await ctx.db.select().from(s.skillEvidence).where(eq(s.skillEvidence.userId, userId)),
    assessments: await ctx.db.select().from(s.assessmentBlueprints).where(eq(s.assessmentBlueprints.userId, userId)),
    interviews: await ctx.db.select().from(s.interviewSessions).where(eq(s.interviewSessions.userId, userId)),
    learningPlans: await ctx.db.select().from(s.learningPlans).where(eq(s.learningPlans.userId, userId)),
    resumes: await ctx.db.select().from(s.resumes).where(eq(s.resumes.userId, userId)),
    applications: await ctx.db.select().from(s.jobApplications).where(eq(s.jobApplications.userId, userId)),
    privateJobs: await ctx.db.select().from(s.jobs).where(eq(s.jobs.ownerUserId, userId)),
    note: 'No audio is ever stored by CareerPilot; voice answers are transcribed in your browser and saved as text.',
  };
}

export async function deleteAccount(ctx: AppContext, userId: number) {
  // Cascading foreign keys remove profile, evidence, assessments, interviews, plans, CVs, applications and private jobs.
  await ctx.db.delete(users).where(eq(users.id, userId));
}
