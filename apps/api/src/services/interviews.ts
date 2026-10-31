import { and, asc, desc, eq, ne } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import {
  assessmentItems, careerFamilies, careerProfiles, careerRoles, interviewMessages, interviewReports, interviewSessions, jobs,
  profileItems, roleSkillRequirements, skills, type AnswerEvaluation, type DiscoveryBackground, type InterviewBlueprint, type InterviewTopic,
} from '../db/schema.js';
import { DISCOVERY_MCQ, discoveryFromChoices, discoveryMcq } from '../ai/heuristics.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { clamp, round } from '../lib/text.js';
import { addEvidence, loadUserSkillMap } from './evidence.js';

export type InterviewMode = 'discovery' | 'skill_verification' | 'job_specific' | 'focused';
export type RoundType = 'hr' | 'technical' | 'case' | 'system_design' | 'leadership' | 'mixed';
export type SessionStatus = 'planned' | 'in_progress' | 'completed' | 'abandoned';

const TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  planned: ['in_progress', 'abandoned'],
  in_progress: ['completed', 'abandoned'],
  completed: [],
  abandoned: [],
};
export function assertTransition(from: SessionStatus, to: SessionStatus) {
  if (!TRANSITIONS[from].includes(to)) throw conflict(`Cannot move interview from ${from} to ${to}`);
}

const ENGINEERING_FAMILIES = ['software-engineering', 'ai-data', 'cloud-devops', 'tech-leadership', 'cybersecurity'];
const CASE_TOPICS: Record<string, string> = {
  'business-analysis': 'Requirements case: conflicting stakeholder needs',
  'product-management': 'Product case: prioritization and metrics',
  'project-delivery': 'Delivery case: scope, risk and stakeholder conflict',
  'ux-research': 'Design case: usability problem diagnosis',
  'ui-product-design': 'Design critique case',
  'quality-engineering': 'Quality case: risk-based test strategy',
};
const CASE_SKILL: Record<string, string> = {
  'business-analysis': 'requirements-elicitation', 'product-management': 'prioritization', 'project-delivery': 'risk-management',
  'ux-research': 'usability-testing', 'ui-product-design': 'design-critique', 'quality-engineering': 'test-design',
};

export interface CreateSessionInput {
  mode: InterviewMode;
  roleSlug?: string;
  jobId?: number;
  seniority?: string;
  roundType?: RoundType;
  language?: 'en' | 'vi';
  durationMinutes?: number;
  answerMode?: 'text' | 'voice';
  focusSkills?: string[];
}

/** Builds the topic plan for a session before it starts. Exported for tests. */
export function buildBlueprint(input: {
  mode: InterviewMode;
  roundType: RoundType;
  durationMinutes: number;
  roleName: string;
  familySlug: string | null;
  seniority: string;
  requirements: { slug: string; name: string; weight: number; critical: boolean }[];
  jobSkills: { slug: string; name: string }[];
  jobTitle?: string;
  focusSkills: { slug: string; name: string }[];
  unverified: Set<string>;
}): InterviewBlueprint {
  const maxMain = clamp(Math.round(input.durationMinutes / 4), 3, 10);
  if (input.mode === 'discovery') {
    // Multiple choice: one quick question per topic regardless of duration.
    return { topics: DISCOVERY_MCQ.map((d, i) => ({ key: `discovery:${d.key}`, label: d.label, kind: 'discovery', priority: 10 - i, reason: 'Discovery questionnaire', covered: false, followUps: 0 })), maxMainQuestions: DISCOVERY_MCQ.length, maxFollowUpsPerTopic: 0, context: { roleName: input.roleName } };
  }
  const skillTopics = new Map<string, InterviewTopic>();
  const addSkill = (slug: string, name: string, priority: number, reason: string) => {
    const existing = skillTopics.get(slug);
    const p = priority + (input.mode === 'skill_verification' && input.unverified.has(slug) ? 1.5 : 0);
    if (!existing || existing.priority < p) skillTopics.set(slug, { key: `skill:${slug}`, label: name, kind: 'skill', skillSlug: slug, priority: round(p, 2), reason, covered: false, followUps: 0 });
  };
  for (const f of input.focusSkills) addSkill(f.slug, f.name, 6, 'Requested focus');
  for (const j of input.jobSkills) addSkill(j.slug, j.name, 4.5, `Required by ${input.jobTitle ?? 'the job'}`);
  const totalW = input.requirements.reduce((s, r) => s + r.weight, 0) || 1;
  for (const r of input.requirements) addSkill(r.slug, r.name, (r.critical ? 3.5 : 1) + (r.weight / totalW) * 5, r.critical ? 'Critical for the role' : 'Role requirement');

  const special: InterviewTopic[] = [];
  const t = (key: string, label: string, kind: InterviewTopic['kind'], priority: number, reason: string, skillSlug?: string): InterviewTopic => ({ key, label, kind, priority, reason, covered: false, followUps: 0, skillSlug });
  const isEng = input.familySlug ? ENGINEERING_FAMILIES.includes(input.familySlug) : false;
  const caseLabel = input.familySlug ? CASE_TOPICS[input.familySlug] : undefined;
  const senior = ['senior', 'lead'].includes(input.seniority);
  switch (input.roundType) {
    case 'hr':
      special.push(t('behavioral-1', 'Ownership under pressure', 'behavioral', 9, 'HR round'), t('behavioral-2', 'Conflict handling', 'behavioral', 8.5, 'HR round'), t('behavioral-3', 'Learning from mistakes', 'behavioral', 8, 'HR round'));
      break;
    case 'leadership':
      special.push(t('leadership-1', 'Growing others', 'leadership', 9, 'Leadership round'), t('leadership-2', 'Unpopular decisions', 'leadership', 8.5, 'Leadership round'), t('behavioral-1', 'Ownership under pressure', 'behavioral', 7, 'Leadership round'));
      break;
    case 'case':
      special.push(t('case-1', caseLabel ?? `Case study for ${input.roleName}`, 'case', 9, 'Case round', input.familySlug ? CASE_SKILL[input.familySlug] : undefined));
      break;
    case 'system_design':
      special.push(t('system-design-1', isEng ? 'System design problem' : 'Solution design problem', 'system_design', 9, 'System design round', 'system-design'));
      break;
    case 'mixed':
      special.push(t('behavioral-1', 'Ownership under pressure', 'behavioral', 7.5, 'Mixed round'));
      if (isEng && (senior || input.seniority === 'middle')) special.push(t('system-design-1', 'System design problem', 'system_design', 6.5, 'Mixed round', 'system-design'));
      else if (caseLabel) special.push(t('case-1', caseLabel, 'case', 6.5, 'Mixed round', input.familySlug ? CASE_SKILL[input.familySlug] : undefined));
      break;
    case 'technical':
      break;
  }
  const skillsSorted = [...skillTopics.values()].sort((a, b) => b.priority - a.priority);
  const skillBudget = input.roundType === 'hr' || input.roundType === 'leadership' ? 1 : maxMain - special.length;
  const topics = [...special, ...skillsSorted.slice(0, Math.max(0, skillBudget))].slice(0, maxMain).sort((a, b) => b.priority - a.priority);
  return {
    topics,
    maxMainQuestions: Math.min(maxMain, topics.length),
    maxFollowUpsPerTopic: input.mode === 'focused' ? 2 : 1,
    context: { roleName: input.roleName, jobTitle: input.jobTitle, jdSkills: input.jobSkills.map((j) => j.name), gaps: [...input.unverified].slice(0, 10) },
  };
}

/** Adaptive decision after an answer (pure). */
export function decideNext(state: { blueprint: InterviewBlueprint; currentTopicKey: string; evaluation: AnswerEvaluation; difficulty: number; mainAsked: number; elapsedMinutes: number; durationMinutes: number }) {
  const bp = structuredClone(state.blueprint);
  const topic = bp.topics.find((t) => t.key === state.currentTopicKey)!;
  let difficulty = state.difficulty;
  if (state.evaluation.score >= 0.8) difficulty = Math.min(5, difficulty + 1);
  else if (state.evaluation.score < 0.4) difficulty = Math.max(1, difficulty - 1);
  const timeUp = state.elapsedMinutes >= state.durationMinutes;
  if (!timeUp && topic.kind !== 'discovery' && state.evaluation.needsFollowUp && state.evaluation.score < 0.6 && topic.followUps < bp.maxFollowUpsPerTopic) {
    topic.followUps++;
    return { action: 'follow_up' as const, blueprint: bp, topic, difficulty, focus: state.evaluation.followUpFocus ?? 'the specifics of what you did' };
  }
  topic.covered = true;
  const next = bp.topics.filter((t) => !t.covered).sort((a, b) => b.priority - a.priority)[0];
  if (!next || timeUp || state.mainAsked >= bp.maxMainQuestions) return { action: 'complete' as const, blueprint: bp, topic: null, difficulty };
  return { action: 'next_topic' as const, blueprint: bp, topic: next, difficulty };
}

async function ownedSession(ctx: AppContext, userId: number, id: number) {
  const [s] = await ctx.db.select().from(interviewSessions).where(and(eq(interviewSessions.id, id), eq(interviewSessions.userId, userId)));
  if (!s) throw notFound('Interview session');
  return s;
}

export async function createSession(ctx: AppContext, userId: number, input: CreateSessionInput) {
  let role: typeof careerRoles.$inferSelect | undefined;
  let familySlug: string | null = null;
  let job: typeof jobs.$inferSelect | undefined;
  if (input.jobId) {
    [job] = await ctx.db.select().from(jobs).where(eq(jobs.id, input.jobId));
    if (!job || (job.ownerUserId && job.ownerUserId !== userId)) throw notFound('Job');
  }
  const roleSlug = input.roleSlug ?? (job?.normalizedRoleId ? (await ctx.db.select({ slug: careerRoles.slug }).from(careerRoles).where(eq(careerRoles.id, job.normalizedRoleId)))[0]?.slug : undefined);
  if (roleSlug) {
    const [r] = await ctx.db.select({ role: careerRoles, fam: careerFamilies }).from(careerRoles).innerJoin(careerFamilies, eq(careerFamilies.id, careerRoles.familyId)).where(eq(careerRoles.slug, roleSlug));
    if (!r) throw notFound('Role');
    role = r.role;
    familySlug = r.fam.slug;
  }
  if (input.mode !== 'discovery' && !role) throw badRequest('A target role (or a job with a recognized role) is required');
  if (input.mode === 'job_specific' && !job) throw badRequest('Job-specific interviews need a job');

  const skillRows = await ctx.db.select({ id: skills.id, slug: skills.slug, name: skills.name }).from(skills);
  const nameOf = (slug: string) => skillRows.find((s) => s.slug === slug)?.name ?? slug;
  const reqs = role ? await ctx.db.select({ slug: skills.slug, name: skills.name, weight: roleSkillRequirements.weight, critical: roleSkillRequirements.critical }).from(roleSkillRequirements).innerJoin(skills, eq(skills.id, roleSkillRequirements.skillId)).where(eq(roleSkillRequirements.roleId, role.id)) : [];
  const userSkillMap = await loadUserSkillMap(ctx, userId);
  const unverified = new Set([...reqs.map((r) => r.slug), ...(job?.requiredSkills ?? [])].filter((s) => userSkillMap.get(s)?.status !== 'app_verified'));
  const seniority = input.seniority ?? job?.seniority ?? 'middle';
  const roundType = input.roundType ?? (input.mode === 'discovery' ? 'hr' : 'mixed');
  const durationMinutes = clamp(input.durationMinutes ?? 20, 5, 60);
  const blueprint = buildBlueprint({
    mode: input.mode, roundType, durationMinutes, roleName: role?.name ?? 'career discovery', familySlug, seniority, requirements: reqs,
    jobSkills: (job?.requiredSkills ?? []).map((s) => ({ slug: s, name: nameOf(s) })), jobTitle: job ? `${job.title} at ${job.company}` : undefined,
    focusSkills: (input.focusSkills ?? []).filter((s) => skillRows.some((x) => x.slug === s)).map((s) => ({ slug: s, name: nameOf(s) })), unverified,
  });
  const [session] = await ctx.db.insert(interviewSessions).values({
    userId, mode: input.mode, roleId: role?.id ?? null, jobId: job?.id ?? null, seniority, roundType, language: input.language ?? 'en',
    durationMinutes, answerMode: input.answerMode ?? 'text', focusSkills: input.focusSkills ?? [], status: 'planned', blueprint,
    currentDifficulty: seniority === 'senior' || seniority === 'lead' ? 4 : seniority === 'junior' || seniority === 'intern' ? 2 : 3,
  }).returning();
  return session;
}

async function askQuestion(ctx: AppContext, session: typeof interviewSessions.$inferSelect, topic: InterviewTopic, difficulty: number, followUp: { focus: string; previousQuestion: string } | null) {
  const messages = await ctx.db.select().from(interviewMessages).where(eq(interviewMessages.sessionId, session.id)).orderBy(asc(interviewMessages.seq));
  const mcq = topic.kind === 'discovery' ? discoveryMcq(topic.key, session.language) : null;
  if (mcq) {
    const content = followUp ? (session.language === 'vi' ? 'Bạn trực tiếp đóng góp phần nào? Chọn gần đúng nhất; có thể chọn chưa rõ.' : 'What part did you personally handle? Choose the closest options, or “not sure”.') : mcq.question;
    const options = followUp ? { ...mcq.options, choices: mcq.options.choices.filter((c) => c.key !== 'team') } : mcq.options;
    const [msg] = await ctx.db.insert(interviewMessages).values({ sessionId: session.id, seq: messages.length + 1, speaker: 'interviewer', kind: followUp ? 'follow_up' : 'question', content, topicKey: topic.key, options, generatedBy: 'bank' }).returning();
    return { message: msg, meta: { mode: 'heuristic' as const, provider: 'question bank' } };
  }
  const history = messages.filter((m) => m.speaker === 'interviewer').map((m) => ({ q: m.content, a: '' }));
  let skill: { name: string; terms: string[]; outcome: string; practice: string } | undefined;
  let bankPrompt: { prompt: string; rubric: NonNullable<(typeof assessmentItems.$inferSelect)['rubric']> } | null = null;
  if (topic.skillSlug) {
    const [s] = await ctx.db.select().from(skills).where(eq(skills.slug, topic.skillSlug));
    if (s) {
      skill = { name: s.name, terms: s.aliases, outcome: s.learningOutcome, practice: s.practiceTask };
      if (topic.kind !== 'skill' || difficulty >= 3) {
        const open = await ctx.db.select().from(assessmentItems).where(and(eq(assessmentItems.skillId, s.id), ne(assessmentItems.type, 'mcq')));
        const unused = open.filter((o) => o.rubric && !history.some((h) => h.q === o.prompt));
        if (unused.length) bankPrompt = { prompt: unused[0].prompt, rubric: unused[0].rubric! };
      }
    }
  }
  const [profile] = await ctx.db.select().from(careerProfiles).where(eq(careerProfiles.userId, session.userId));
  const items = await ctx.db.select().from(profileItems).where(and(eq(profileItems.userId, session.userId), eq(profileItems.confirmed, true)));
  const profileContext = profile ? `${profile.headline}\n${profile.summary}\n${items.filter((i) => i.kind === 'work' || i.kind === 'project').map((i) => `${i.title} @ ${i.organization}: ${i.description} ${i.highlights.join('; ')}`).join('\n')}` : null;
  const job = session.jobId ? (await ctx.db.select().from(jobs).where(eq(jobs.id, session.jobId)))[0] : undefined;
  const mainAsked = messages.filter((m) => m.kind === 'question').length;
  const q = await ctx.ai.interviewQuestion({
    topic, difficulty, language: session.language, askedCount: topic.kind === 'skill' ? 0 : messages.filter((m) => m.kind === 'question' && m.topicKey?.startsWith(topic.kind)).length + (topic.kind === 'discovery' ? mainAsked : 0),
    skill, bankPrompt, followUp, roleName: session.blueprint.context.roleName, seniority: session.seniority, roundType: session.roundType, mode: session.mode,
    jobContext: job?.description || null, profileContext, history,
  });
  const [msg] = await ctx.db.insert(interviewMessages).values({
    sessionId: session.id, seq: messages.length + 1, speaker: 'interviewer', kind: followUp ? 'follow_up' : 'question', content: q.data.question,
    topicKey: topic.key, difficulty, rubric: q.data.rubric, idealPoints: q.data.idealPoints, generatedBy: q.meta.mode === 'ai' ? `ai:${q.meta.provider}` : 'heuristic',
  }).returning();
  return { message: msg, meta: q.meta };
}

export async function startSession(ctx: AppContext, userId: number, id: number, background?: DiscoveryBackground) {
  const s = await ownedSession(ctx, userId, id);
  assertTransition(s.status, 'in_progress');
  let blueprint = s.blueprint;
  if (background && s.mode === 'discovery') {
    if (background.currentRoleSlug && !(await ctx.db.select({ id: careerRoles.id }).from(careerRoles).where(eq(careerRoles.slug, background.currentRoleSlug)))[0]) throw notFound('Role');
    blueprint = { ...blueprint, context: { ...blueprint.context, background } };
    // The background is the person's own statement, so it fills the profile directly — without overwriting text they already wrote.
    const [profile] = await ctx.db.select().from(careerProfiles).where(eq(careerProfiles.userId, userId));
    if (profile) {
      await ctx.db.update(careerProfiles).set({
        currentRoleSlug: background.currentRoleSlug !== undefined ? background.currentRoleSlug : profile.currentRoleSlug,
        yearsExperience: background.yearsExperience ?? profile.yearsExperience,
        headline: profile.headline || background.currentTitle || '',
        summary: profile.summary || background.summary || '',
        updatedAt: ctx.now(),
      }).where(eq(careerProfiles.userId, userId));
    }
  }
  const [updated] = await ctx.db.update(interviewSessions).set({ status: 'in_progress', startedAt: ctx.now(), blueprint }).where(eq(interviewSessions.id, id)).returning();
  const first = updated.blueprint.topics.filter((t) => !t.covered).sort((a, b) => b.priority - a.priority)[0];
  if (!first) throw badRequest('Interview blueprint has no topics');
  const q = await askQuestion(ctx, updated, first, updated.currentDifficulty, null);
  return { session: updated, question: publicMessage(q.message, 'in_progress', updated.mode), aiMeta: q.meta };
}

const CHOICE_EVALUATION: AnswerEvaluation = { score: 1, criteria: [], strengths: [], gaps: [], evidenceQuotes: [], needsFollowUp: false, method: 'user' };

export async function answerQuestion(ctx: AppContext, userId: number, id: number, input: { content: string; inputMode: 'text' | 'voice'; choices?: string[] }) {
  const s = await ownedSession(ctx, userId, id);
  if (s.status !== 'in_progress') throw conflict(`Interview is ${s.status}`);
  const messages = await ctx.db.select().from(interviewMessages).where(eq(interviewMessages.sessionId, id)).orderBy(asc(interviewMessages.seq));
  const last = messages.at(-1);
  if (!last || last.speaker !== 'interviewer') throw conflict('There is no open question to answer');
  const content = input.content.trim().slice(0, 8000);
  let choices: string[] | null = null;
  if (last.options) {
    choices = [...new Set(input.choices ?? [])];
    if (!choices.length) throw badRequest('Choose at least one option');
    if (choices.length > last.options.maxSelect) throw badRequest(`Choose at most ${last.options.maxSelect} option(s)`);
    if (choices.some((c) => !last.options!.choices.some((o) => o.key === c))) throw badRequest('Unknown option');
  } else if (content.length < 2) throw badRequest('Answer is empty');

  // Multiple-choice answers record preferences; there is nothing to grade.
  const ev = choices ? { data: CHOICE_EVALUATION, meta: { mode: 'heuristic' as const } } : await ctx.ai.evaluateAnswer({ question: last.content, answer: content, rubric: last.rubric ?? [], idealPoints: last.idealPoints ?? [], language: s.language, roleName: s.blueprint.context.roleName, seniority: s.seniority });
  await ctx.db.insert(interviewMessages).values({ sessionId: id, seq: last.seq + 1, speaker: 'candidate', kind: 'answer', content, topicKey: last.topicKey, evaluation: ev.data, choices, inputMode: input.inputMode, generatedBy: choices ? 'user' : ev.meta.mode === 'ai' ? `ai:${ev.meta.provider}` : 'heuristic' });

  // Ask once only when a team-project answer does not identify a personal contribution.
  if (s.mode === 'discovery' && last.topicKey === 'discovery:project' && last.kind !== 'follow_up' && choices?.includes('team') && !choices.some((k) => !['team', 'no-project'].includes(k)) && content.length < 20) {
    const topic = s.blueprint.topics.find((t) => t.key === last.topicKey)!;
    const q = await askQuestion(ctx, s, topic, s.currentDifficulty, { focus: 'personal contribution', previousQuestion: last.content });
    return { completed: false, feedback: null, nextQuestion: publicMessage(q.message, 'in_progress', s.mode), reportId: null };
  }

  const elapsedMinutes = s.startedAt ? (ctx.now().getTime() - s.startedAt.getTime()) / 60000 : 0;
  const mainAsked = messages.filter((m) => m.kind === 'question').length;
  const decision = decideNext({ blueprint: s.blueprint, currentTopicKey: last.topicKey!, evaluation: ev.data, difficulty: s.currentDifficulty, mainAsked, elapsedMinutes, durationMinutes: s.durationMinutes });
  await ctx.db.update(interviewSessions).set({ blueprint: decision.blueprint, currentDifficulty: decision.difficulty }).where(eq(interviewSessions.id, id));
  const feedback = s.mode === 'focused' ? { score: ev.data.score, criteria: ev.data.criteria, strengths: ev.data.strengths, gaps: ev.data.gaps } : null;

  if (decision.action === 'complete') {
    const report = await completeSession(ctx, userId, id);
    return { completed: true, feedback, reportId: report.id, nextQuestion: null };
  }
  const fresh = (await ownedSession(ctx, userId, id));
  const q = await askQuestion(ctx, fresh, decision.topic!, decision.difficulty, decision.action === 'follow_up' ? { focus: decision.focus!, previousQuestion: last.content } : null);
  return { completed: false, feedback, nextQuestion: publicMessage(q.message, 'in_progress', s.mode), reportId: null };
}

export async function abandonSession(ctx: AppContext, userId: number, id: number) {
  const s = await ownedSession(ctx, userId, id);
  assertTransition(s.status, 'abandoned');
  await ctx.db.update(interviewSessions).set({ status: 'abandoned', endedAt: ctx.now() }).where(eq(interviewSessions.id, id));
}

export async function completeSession(ctx: AppContext, userId: number, id: number) {
  const s = await ownedSession(ctx, userId, id);
  assertTransition(s.status, 'completed');
  const messages = await ctx.db.select().from(interviewMessages).where(eq(interviewMessages.sessionId, id)).orderBy(asc(interviewMessages.seq));
  const pairs = messages.filter((m) => m.speaker === 'interviewer').map((q) => ({ q, a: messages.find((m) => m.seq === q.seq + 1 && m.speaker === 'candidate') })).filter((p) => p.a?.evaluation);
  const questionnaire = pairs.some((p) => p.a!.choices);
  const caveats = questionnaire ? ['Discovery is a preferences questionnaire, not a test — there is no score.', 'Career matches are possibilities to explore, not definitive conclusions. Self-reported strengths and project descriptions do not verify skills.'] : ['This is a practice score. Conversational answers are recorded as "interview observations" and never verify coding or production experience on their own.'];
  if (pairs.some((p) => p.a!.evaluation!.method === 'heuristic_rubric')) caveats.push('Some answers were graded by the heuristic keyword rubric (AI not configured or unavailable); treat scores as rough.');

  const weightOf = (kind: string) => (kind === 'follow_up' ? 0.5 : 1);
  const totalW = pairs.reduce((s2, p) => s2 + weightOf(p.q.kind), 0);
  const overall = totalW ? Math.round((pairs.reduce((s2, p) => s2 + p.a!.evaluation!.score * weightOf(p.q.kind), 0) / totalW) * 100) : 0;
  const crit = new Map<string, number[]>();
  for (const p of pairs) for (const c of p.a!.evaluation!.criteria) {
    const k = c.criterion.replace(/\s*\(.*\)$/, '');
    crit.set(k, [...(crit.get(k) ?? []), c.score / 4]);
  }
  const rubricBreakdown = [...crit.entries()].map(([criterion, v]) => ({ criterion, score: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) })).sort((a, b) => b.score - a.score);
  const strengths = [...new Set([...rubricBreakdown.filter((r) => r.score >= 70).map((r) => r.criterion), ...pairs.flatMap((p) => p.a!.evaluation!.strengths)])].slice(0, 6);
  const weaknesses = [...new Set([...rubricBreakdown.filter((r) => r.score < 50).map((r) => r.criterion), ...pairs.flatMap((p) => p.a!.evaluation!.gaps)])].slice(0, 6);
  const topics = s.blueprint.topics;
  const questionFeedback = pairs.map((p) => ({
    question: p.q.content,
    answerExcerpt: p.a!.content.slice(0, 400),
    score: Math.round(p.a!.evaluation!.score * 100),
    feedback: p.a!.evaluation!.criteria.map((c) => `${c.criterion}: ${c.comment}`).join(' · '),
    quotes: p.a!.evaluation!.evidenceQuotes,
    topic: topics.find((t) => t.key === p.q.topicKey)?.label ?? p.q.topicKey ?? '',
  }));
  const improvements: string[] = [];
  if (weaknesses.some((w) => /result|impact/i.test(w))) improvements.push('Quantify outcomes: state what changed and by how much, using numbers you can stand behind.');
  if (weaknesses.some((w) => /action|personal/i.test(w))) improvements.push('Describe your own actions ("I…") rather than the team\'s.');
  if (weaknesses.some((w) => /trade|reason/i.test(w))) improvements.push('Explain trade-offs: what alternatives you considered and why you chose one.');
  if (weaknesses.some((w) => /accura|technical/i.test(w))) improvements.push('Review the fundamentals of the weak topics below and practice explaining them aloud.');
  if (!improvements.length && pairs.length && !questionnaire) improvements.push('Keep answers structured (situation → actions → result → reflection) and concise.');

  // Topic-level evidence (interview observation; never verifies).
  const learningTasks: { skillSlug: string; title: string }[] = [];
  for (const t of topics.filter((x) => x.skillSlug)) {
    const tp = pairs.filter((p) => p.q.topicKey === t.key);
    if (!tp.length) continue;
    const score = tp.reduce((a, p) => a + p.a!.evaluation!.score, 0) / tp.length;
    const difficulty = Math.max(...tp.map((p) => p.q.difficulty ?? 3));
    const [sk] = await ctx.db.select().from(skills).where(eq(skills.slug, t.skillSlug!));
    if (sk && s.mode !== 'discovery') {
      await addEvidence(ctx, userId, sk.id, { type: 'interview_observation', score: round(score, 2), observedLevel: round(Math.min(difficulty + 0.5, Math.max(1, (difficulty * score) / 0.7)), 1), gradingMethod: tp[0].a!.evaluation!.method, sourceRef: `interview:${id}`, notes: `Mock interview (${s.roundType})` });
    }
    if (score < 0.6) learningTasks.push({ skillSlug: t.skillSlug!, title: `Strengthen ${t.label}: review fundamentals and practice explaining with a concrete example` });
  }

  let comparison: { previousSessionId: number; previousScore: number; delta: number } | null = null;
  const previous = await ctx.db.select({ s: interviewSessions, r: interviewReports }).from(interviewSessions).innerJoin(interviewReports, eq(interviewReports.sessionId, interviewSessions.id))
    .where(and(eq(interviewSessions.userId, userId), eq(interviewSessions.status, 'completed'), eq(interviewSessions.roundType, s.roundType), eq(interviewSessions.mode, s.mode), s.roleId ? eq(interviewSessions.roleId, s.roleId) : undefined, ne(interviewSessions.id, id)))
    .orderBy(desc(interviewSessions.endedAt)).limit(1);
  if (previous[0]) comparison = { previousSessionId: previous[0].s.id, previousScore: Math.round(previous[0].r.overallScore), delta: overall - Math.round(previous[0].r.overallScore) };

  let profileSuggestions: Record<string, unknown> | null = null;
  if (s.mode === 'discovery') {
    const fromChoices = discoveryFromChoices(pairs.filter((p) => p.a!.choices).map((p) => ({ topicKey: p.q.topicKey ?? '', choices: p.a!.choices! })));
    const texts = pairs.map((p) => p.a!.content).filter((t) => t.trim().length >= 2);
    const ex = texts.length ? await ctx.ai.extractDiscovery(texts) : null;
    const merged = !questionnaire ? ex?.data ?? fromChoices : !ex ? fromChoices : {
      // Explicit choices win over what was inferred from optional notes.
      interests: [...new Set([...fromChoices.interests, ...ex.data.interests])],
      workValues: [...new Set([...fromChoices.workValues, ...ex.data.workValues])],
      taskAffinity: { ...ex.data.taskAffinity, ...fromChoices.taskAffinity },
      goals: fromChoices.goals || ex.data.goals,
      constraints: [...fromChoices.constraints, ...ex.data.constraints],
    };
    const answerChoices = (key: string) => pairs.filter((p) => p.q.topicKey === `discovery:${key}`).flatMap((p) => p.a!.choices ?? []);
    const choiceLabels = (key: string) => DISCOVERY_MCQ.find((q) => q.key === key)?.choices.filter(([k]) => answerChoices(key).includes(k)).map(([, label]) => s.language === 'vi' ? label.vi : label.en) ?? [];
    const roles = await ctx.db.select().from(careerRoles);
    const families = await ctx.db.select().from(careerFamilies);
    const ranked = roles.map((role) => {
      const family = families.find((f) => f.id === role.familyId);
      const reasons: string[] = [];
      let affinity = 0;
      for (const [task, rating] of Object.entries(merged.taskAffinity)) {
        const weight = role.taskProfile[task] ?? 0;
        affinity += weight * (rating - 3);
        if (weight >= 0.5 && rating >= 4) reasons.push(`Your stated interest in ${task} aligns with this role's work.`);
      }
      if (family && merged.interests.includes(family.slug)) { affinity += 2; reasons.push(`You chose ${family.name} as an area to explore.`); }
      const values = role.workValues.filter((v) => merged.workValues.includes(v));
      affinity += values.length * 0.4;
      if (values.length) reasons.push(`Shared work preferences: ${values.join(', ')}.`);
      return { role, affinity, reasons };
    }).filter((r) => r.reasons.length && r.affinity > 0).sort((a, b) => b.affinity - a.affinity);
    const topMatches = [];
    for (const { role, reasons } of ranked.slice(0, 3)) {
      const reqs = await ctx.db.select({ name: skills.name }).from(roleSkillRequirements).innerJoin(skills, eq(skills.id, roleSkillRequirements.skillId)).where(and(eq(roleSkillRequirements.roleId, role.id), eq(roleSkillRequirements.critical, true)));
      topMatches.push({ slug: role.slug, name: role.name, reasons: reasons.slice(0, 3), potentialGaps: reqs.slice(0, 4).map((r) => r.name), trial: role.details.responsibilities[0] ?? role.summary });
    }
    profileSuggestions = { ...merged, topMatches, selfReportedStrengths: choiceLabels('strengths'), enjoyedActivities: choiceLabels('project'), generatedBy: ex ? ex.meta.mode : 'choices', note: 'Suggestions only — review and apply them on your profile.' };
  }

  // AI coaching explains and suggests; the score above stays deterministic.
  let coaching: (typeof interviewReports.$inferInsert)['coaching'] = null;
  if (s.mode !== 'discovery') {
    const c = await ctx.ai.coachInterview({
      roleName: s.blueprint.context.roleName, mode: s.mode, roundType: s.roundType, seniority: s.seniority, language: s.language,
      qa: pairs.map((p, i) => ({ index: i + 1, question: p.q.content, answer: p.a!.content, score: p.a!.evaluation!.score, criteria: p.a!.evaluation!.criteria })),
    });
    if (c) coaching = { ...c.data, generatedBy: `ai:${c.meta.provider}${c.meta.model ? ` (${c.meta.model})` : ''}` };
    else if (!ctx.ai.status().configured) caveats.push('Connect an AI provider in Settings to get AI coaching on your answers.');
  }

  await ctx.db.update(interviewSessions).set({ status: 'completed', endedAt: ctx.now() }).where(eq(interviewSessions.id, id));
  const [report] = await ctx.db.insert(interviewReports).values({ sessionId: id, overallScore: overall, rubricBreakdown, strengths, weaknesses, questionFeedback, improvements, learningTasks, comparison, profileSuggestions, caveats, coaching }).returning();
  return report;
}

/** Rubrics, hidden ideal points and evaluations stay server-side until the session is completed. */
export function publicMessage(m: typeof interviewMessages.$inferSelect, status: SessionStatus, mode: string) {
  const revealed = status === 'completed' || status === 'abandoned';
  return {
    id: m.id, seq: m.seq, speaker: m.speaker, kind: m.kind, content: m.content, topicKey: m.topicKey, difficulty: m.difficulty, inputMode: m.inputMode, createdAt: m.createdAt,
    generatedBy: m.generatedBy,
    rubricCriteria: m.rubric?.map((r) => r.criterion) ?? null,
    idealPoints: revealed ? m.idealPoints : null,
    options: m.options, choices: m.choices,
    evaluation: revealed || (mode === 'focused' && m.speaker === 'candidate') ? m.evaluation : null,
  };
}

export async function getSessionDetail(ctx: AppContext, userId: number, id: number) {
  const s = await ownedSession(ctx, userId, id);
  const messages = await ctx.db.select().from(interviewMessages).where(eq(interviewMessages.sessionId, id)).orderBy(asc(interviewMessages.seq));
  const [report] = await ctx.db.select().from(interviewReports).where(eq(interviewReports.sessionId, id));
  const role = s.roleId ? (await ctx.db.select({ slug: careerRoles.slug, name: careerRoles.name }).from(careerRoles).where(eq(careerRoles.id, s.roleId)))[0] : null;
  const job = s.jobId ? (await ctx.db.select({ id: jobs.id, title: jobs.title, company: jobs.company, isDemo: jobs.isDemo }).from(jobs).where(eq(jobs.id, s.jobId)))[0] : null;
  return { session: s, role, job, messages: messages.map((m) => publicMessage(m, s.status, s.mode)), report: report ?? null, ai: ctx.ai.status() };
}

export async function listSessions(ctx: AppContext, userId: number) {
  const rows = await ctx.db.select({ s: interviewSessions, roleName: careerRoles.name, score: interviewReports.overallScore }).from(interviewSessions)
    .leftJoin(careerRoles, eq(careerRoles.id, interviewSessions.roleId)).leftJoin(interviewReports, eq(interviewReports.sessionId, interviewSessions.id))
    .where(eq(interviewSessions.userId, userId)).orderBy(desc(interviewSessions.createdAt));
  return rows.map((r) => ({ ...r.s, roleName: r.roleName, score: r.score }));
}

