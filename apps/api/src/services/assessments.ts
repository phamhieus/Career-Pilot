import { and, desc, eq, inArray } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import {
  assessmentAttempts, assessmentBlueprints, assessmentItems, careerRoles, evaluations, roadmapEdges, roadmapNodes, roadmaps,
  roleSkillRequirements, skills, userSkills, type BlueprintItem, type ItemEvaluation,
} from '../db/schema.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { round, sha256 } from '../lib/text.js';
import { skillRubric } from '../ai/heuristics.js';
import { addEvidence, loadUserSkillMap, VERIFICATION_POLICY } from './evidence.js';
import { applyAssessmentToPlans } from './learning.js';

/** Observed proficiency from a score at a target level. */
export function observedLevel(score: number, targetLevel: number): number {
  if (score >= 0.9) return Math.min(5, targetLevel + 0.5);
  if (score >= VERIFICATION_POLICY.passScore) return targetLevel;
  return round(Math.max(1, (targetLevel * score) / VERIFICATION_POLICY.passScore), 1);
}

export async function createBlueprint(ctx: AppContext, userId: number, input: { skillSlugs?: string[]; roleSlug?: string; roadmapNodeKey?: string; level?: number; learningPlanId?: number }) {
  let slugs = input.skillSlugs ?? [];
  let role: typeof careerRoles.$inferSelect | undefined;
  let rationale = '';
  if (input.roleSlug) {
    [role] = await ctx.db.select().from(careerRoles).where(eq(careerRoles.slug, input.roleSlug));
    if (!role) throw notFound('Role');
  }
  if (!slugs.length && role && input.roadmapNodeKey) {
    const [rm] = await ctx.db.select().from(roadmaps).where(eq(roadmaps.roleId, role.id));
    const preds = rm ? await ctx.db.select().from(roadmapEdges).where(and(eq(roadmapEdges.roadmapId, rm.id), eq(roadmapEdges.toKey, input.roadmapNodeKey))) : [];
    const nodes = preds.length ? await ctx.db.select({ slug: skills.slug }).from(roadmapNodes).innerJoin(skills, eq(skills.id, roadmapNodes.skillId)).where(and(eq(roadmapNodes.roadmapId, rm!.id), inArray(roadmapNodes.key, preds.map((p) => p.fromKey)))) : [];
    slugs = nodes.map((n) => n.slug);
    rationale = `Checkpoint "${input.roadmapNodeKey}" on the ${role.name} roadmap covers: ${slugs.join(', ')}.`;
  }
  if (!slugs.length && role) {
    // Pick critical / high-weight skills that are not yet verified.
    const reqs = await ctx.db.select({ r: roleSkillRequirements, slug: skills.slug }).from(roleSkillRequirements).innerJoin(skills, eq(skills.id, roleSkillRequirements.skillId)).where(eq(roleSkillRequirements.roleId, role.id));
    const us = await loadUserSkillMap(ctx, userId);
    slugs = reqs.filter((r) => us.get(r.slug)?.status !== 'app_verified').sort((a, b) => Number(b.r.critical) - Number(a.r.critical) || b.r.weight - a.r.weight).slice(0, 3).map((r) => r.slug);
    rationale = `Selected the highest-priority unverified skills for ${role.name}: ${slugs.join(', ')}.`;
  }
  if (!slugs.length) throw badRequest('Choose at least one skill, a role or a roadmap checkpoint');
  const skillRows = await ctx.db.select().from(skills).where(inArray(skills.slug, slugs));
  if (skillRows.length !== new Set(slugs).size) throw badRequest('Unknown skill in request');

  let targetLevel = input.level ?? 3;
  if (role && input.level == null) {
    const reqs = await ctx.db.select({ level: roleSkillRequirements.requiredLevel, skillId: roleSkillRequirements.skillId }).from(roleSkillRequirements).where(and(eq(roleSkillRequirements.roleId, role.id), inArray(roleSkillRequirements.skillId, skillRows.map((s) => s.id))));
    if (reqs.length) targetLevel = Math.round(reqs.reduce((s, r) => s + r.level, 0) / reqs.length);
  }

  const items: BlueprintItem[] = [];
  const notes: string[] = [];
  for (const s of skillRows) {
    let bank = await ctx.db.select().from(assessmentItems).where(eq(assessmentItems.skillId, s.id));
    let mcqs = bank.filter((b) => b.type === 'mcq');
    if (mcqs.length < 2) {
      const generated = await ctx.ai.generateMcqs({ name: s.name, outcome: s.learningOutcome }, targetLevel);
      if (generated) {
        for (const g of generated.data) {
          const key = `ai:${s.slug}:${sha256(g.prompt).slice(0, 10)}`;
          await ctx.db.insert(assessmentItems).values({ key, skillId: s.id, type: 'mcq', difficulty: g.difficulty, prompt: g.prompt, options: g.options, correctIndex: g.correctIndex, explanation: `${g.explanation} (AI-generated item)` }).onConflictDoNothing();
        }
        bank = await ctx.db.select().from(assessmentItems).where(eq(assessmentItems.skillId, s.id));
        mcqs = bank.filter((b) => b.type === 'mcq');
        notes.push(`Some ${s.name} questions were AI-generated.`);
      }
    }
    const pickedMcq = [...mcqs].sort((a, b) => Math.abs(a.difficulty - targetLevel) - Math.abs(b.difficulty - targetLevel)).slice(0, 3);
    let perf = bank.filter((b) => b.type !== 'mcq').sort((a, b) => Math.abs(a.difficulty - targetLevel) - Math.abs(b.difficulty - targetLevel))[0];
    if (!perf) {
      // Generic practical task derived from the skill definition.
      const key = `generic:${s.slug}`;
      await ctx.db.insert(assessmentItems).values({ key, skillId: s.id, type: 'practical', difficulty: 3, prompt: `Practical task — ${s.practiceTask} Describe precisely how you would do it (or paste your solution), the decisions you made and how you verified the result.`, rubric: skillRubric(s.name, s.aliases, s.learningOutcome) }).onConflictDoNothing();
      [perf] = await ctx.db.select().from(assessmentItems).where(eq(assessmentItems.key, key));
    }
    for (const m of pickedMcq) items.push({ itemId: m.id, skillSlug: s.slug, type: 'mcq', difficulty: m.difficulty });
    items.push({ itemId: perf.id, skillSlug: s.slug, type: perf.type, difficulty: perf.difficulty });
    if (!pickedMcq.length) notes.push(`${s.name} has no objective quiz items yet, so it can be assessed but not app-verified.`);
  }
  const [bp] = await ctx.db.insert(assessmentBlueprints).values({
    userId, roleId: role?.id ?? null, title: `${skillRows.map((s) => s.name).join(', ')} — level ${targetLevel}`,
    skillSlugs: slugs, targetLevel, items, rationale: [rationale || `Assessing ${slugs.join(', ')} at level ${targetLevel}.`, ...notes].join(' '),
    learningPlanId: input.learningPlanId ?? null,
  }).returning();
  return bp;
}

export async function startAttempt(ctx: AppContext, userId: number, blueprintId: number) {
  const [bp] = await ctx.db.select().from(assessmentBlueprints).where(and(eq(assessmentBlueprints.id, blueprintId), eq(assessmentBlueprints.userId, userId)));
  if (!bp) throw notFound('Assessment');
  const [attempt] = await ctx.db.insert(assessmentAttempts).values({ blueprintId, userId }).returning();
  return attempt;
}

/** Items as shown to a candidate: no answer keys, explanations or rubric indicators. */
export async function attemptView(ctx: AppContext, userId: number, attemptId: number) {
  const [row] = await ctx.db.select({ a: assessmentAttempts, bp: assessmentBlueprints }).from(assessmentAttempts).innerJoin(assessmentBlueprints, eq(assessmentBlueprints.id, assessmentAttempts.blueprintId)).where(and(eq(assessmentAttempts.id, attemptId), eq(assessmentAttempts.userId, userId)));
  if (!row) throw notFound('Assessment attempt');
  const itemRows = await ctx.db.select().from(assessmentItems).where(inArray(assessmentItems.id, row.bp.items.map((i) => i.itemId)));
  const [evaluation] = await ctx.db.select().from(evaluations).where(eq(evaluations.attemptId, attemptId));
  const graded = row.a.status === 'graded';
  return {
    attempt: row.a,
    blueprint: row.bp,
    items: row.bp.items.map((bi) => {
      const it = itemRows.find((x) => x.id === bi.itemId)!;
      return {
        id: it.id, skillSlug: bi.skillSlug, type: it.type, difficulty: it.difficulty, prompt: it.prompt, options: it.options,
        rubricCriteria: it.rubric?.map((r) => r.criterion) ?? null,
        ...(graded ? { correctIndex: it.correctIndex, explanation: it.explanation } : {}),
      };
    }),
    evaluation: evaluation ?? null,
  };
}

export async function submitAttempt(ctx: AppContext, userId: number, attemptId: number, answers: Record<string, { choice?: number; text?: string }>, language = 'en') {
  const [row] = await ctx.db.select({ a: assessmentAttempts, bp: assessmentBlueprints }).from(assessmentAttempts).innerJoin(assessmentBlueprints, eq(assessmentBlueprints.id, assessmentAttempts.blueprintId)).where(and(eq(assessmentAttempts.id, attemptId), eq(assessmentAttempts.userId, userId)));
  if (!row) throw notFound('Assessment attempt');
  if (row.a.status === 'graded') throw conflict('This attempt has already been graded');
  const itemRows = await ctx.db.select().from(assessmentItems).where(inArray(assessmentItems.id, row.bp.items.map((i) => i.itemId)));

  const perItem: ItemEvaluation[] = [];
  const uncertainties = new Set<string>();
  for (const bi of row.bp.items) {
    const it = itemRows.find((x) => x.id === bi.itemId)!;
    const ans = answers[String(it.id)] ?? {};
    if (it.type === 'mcq') {
      const correct = ans.choice != null && ans.choice === it.correctIndex;
      perItem.push({ itemId: it.id, skillSlug: bi.skillSlug, type: 'mcq', score: correct ? 1 : 0, correct, method: 'objective', feedback: correct ? 'Correct.' : `Incorrect. ${it.explanation}` });
    } else {
      const text = (ans.text ?? '').trim();
      if (text.length < 20) {
        perItem.push({ itemId: it.id, skillSlug: bi.skillSlug, type: it.type, score: 0, method: 'objective', feedback: 'No substantive answer submitted.' });
        continue;
      }
      const graded = await ctx.ai.gradeOpenAnswer({ prompt: it.prompt, rubric: it.rubric ?? [], answer: text, language });
      if (graded.meta.mode === 'heuristic') uncertainties.add(`Open answers were graded by the heuristic keyword rubric${graded.meta.fallbackReason ? ` (${graded.meta.fallbackReason})` : ''}; heuristic grades never verify a skill.`);
      perItem.push({
        itemId: it.id, skillSlug: bi.skillSlug, type: it.type, score: graded.data.score, method: graded.data.method,
        feedback: [graded.data.strengths.length ? `Strengths: ${graded.data.strengths.join('; ')}.` : '', graded.data.gaps.length ? `Gaps: ${graded.data.gaps.join('; ')}.` : ''].filter(Boolean).join(' ') || 'Graded against the rubric.',
        criteria: graded.data.criteria,
      });
    }
  }

  const perSkill: { skillSlug: string; score: number; passed: boolean; newStatus: (typeof evaluations.$inferSelect)['perSkill'][number]['newStatus']; observedLevel: number }[] = [];
  const skillRows = await ctx.db.select().from(skills).where(inArray(skills.slug, row.bp.skillSlugs));
  const planResults: { skillSlug: string; passed: boolean; newStatus: string; feedback: string }[] = [];
  for (const s of skillRows) {
    const its = perItem.filter((p) => p.skillSlug === s.slug);
    const mcq = its.filter((p) => p.type === 'mcq');
    const perf = its.filter((p) => p.type !== 'mcq');
    const quizScore = mcq.length ? mcq.reduce((a, b) => a + b.score, 0) / mcq.length : null;
    const perfScore = perf.length ? perf.reduce((a, b) => a + b.score, 0) / perf.length : null;
    if (mcq.length && mcq.length < 3) uncertainties.add(`Only ${mcq.length} objective item(s) for ${s.name}; results are indicative.`);
    if (quizScore != null) await addEvidence(ctx, userId, s.id, { type: 'quiz', score: round(quizScore, 2), observedLevel: observedLevel(quizScore, row.bp.targetLevel), gradingMethod: 'objective', sourceRef: `attempt:${attemptId}`, notes: `Quiz at level ${row.bp.targetLevel}` });
    let latest = null;
    if (perfScore != null) {
      const method = perf.some((p) => p.method === 'heuristic_rubric') ? 'heuristic_rubric' : perf.every((p) => p.method === 'objective') ? 'objective' : 'ai_rubric';
      latest = await addEvidence(ctx, userId, s.id, { type: perf[0].type as 'scenario' | 'practical' | 'case_study', score: round(perfScore, 2), observedLevel: observedLevel(perfScore, row.bp.targetLevel), gradingMethod: method, sourceRef: `attempt:${attemptId}`, notes: `${perf[0].type} at level ${row.bp.targetLevel}` });
    }
    const [us] = latest ? [latest] : await ctx.db.select().from(userSkills).where(and(eq(userSkills.userId, userId), eq(userSkills.skillId, s.id)));
    const score = round([quizScore, perfScore].filter((x): x is number => x != null).reduce((a, b, _, arr) => a + b / arr.length, 0), 2);
    const passed = (quizScore == null || quizScore >= VERIFICATION_POLICY.passScore) && (perfScore == null || perfScore >= VERIFICATION_POLICY.passScore);
    const status = us?.status ?? 'assessed';
    perSkill.push({ skillSlug: s.slug, score, passed, newStatus: status, observedLevel: observedLevel(score, row.bp.targetLevel) });
    planResults.push({ skillSlug: s.slug, passed, newStatus: status, feedback: its.filter((p) => p.score < 0.7).map((p) => p.feedback).join(' ').slice(0, 500) });
  }

  const overall = round(perItem.reduce((a, b) => a + b.score, 0) / Math.max(1, perItem.length), 2);
  const passed = perSkill.every((p) => p.passed);
  const feedback = perSkill.map((p) => `${p.skillSlug}: ${Math.round(p.score * 100)}% → ${p.newStatus.replace('_', ' ')}`).join('; ');
  const [ev] = await ctx.db.insert(evaluations).values({ attemptId, score: overall, passed, perItem, perSkill, feedback, uncertainties: [...uncertainties] }).returning();
  await ctx.db.update(assessmentAttempts).set({ status: 'graded', answers, submittedAt: ctx.now() }).where(eq(assessmentAttempts.id, attemptId));
  const revisions = await applyAssessmentToPlans(ctx, userId, planResults, attemptId);
  return { evaluation: ev, planRevisions: revisions };
}

export async function listAssessments(ctx: AppContext, userId: number) {
  const bps = await ctx.db.select().from(assessmentBlueprints).where(eq(assessmentBlueprints.userId, userId)).orderBy(desc(assessmentBlueprints.createdAt));
  const attempts = bps.length ? await ctx.db.select({ a: assessmentAttempts, e: evaluations }).from(assessmentAttempts).leftJoin(evaluations, eq(evaluations.attemptId, assessmentAttempts.id)).where(inArray(assessmentAttempts.blueprintId, bps.map((b) => b.id))).orderBy(desc(assessmentAttempts.startedAt)) : [];
  return bps.map((bp) => ({ ...bp, attempts: attempts.filter((x) => x.a.blueprintId === bp.id).map((x) => ({ id: x.a.id, status: x.a.status, startedAt: x.a.startedAt, submittedAt: x.a.submittedAt, score: x.e?.score ?? null, passed: x.e?.passed ?? null })) }));
}

