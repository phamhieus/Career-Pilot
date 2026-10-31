import { and, desc, eq } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { skillEvidence, skills, userSkills, type EvidenceType, type GradingMethod, type SkillStatus } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { round } from '../lib/text.js';

/**
 * Verification policy (deterministic, documented in docs/ARCHITECTURE.md):
 * - App-Verified: within the last 365 days, the latest objective quiz on the skill scored >= 0.70 AND the
 *   latest performance task (scenario / practical / case study / project) scored >= 0.70, graded
 *   objectively or by AI rubric. Heuristic-graded or interview-only evidence never verifies a skill.
 * - Assessed: any assessment, practical or interview evidence exists.
 * - Self-reported / Extracted claim: only the user's own statement or CV extraction.
 * - Course completion is recorded but never raises status above self-reported.
 */
export const VERIFICATION_POLICY = {
  windowDays: 365,
  passScore: 0.7,
  performanceTypes: ['scenario', 'practical', 'case_study', 'project'] as EvidenceType[],
  trustedMethods: ['objective', 'ai_rubric'] as GradingMethod[],
};

/** How much an unverified claim is trusted when computing capability credit. */
export const TRUST: Record<SkillStatus, number> = { app_verified: 1, assessed: 0.85, self_reported: 0.6, extracted_claim: 0.5 };
/** Level assumed for a CV claim that carries no proficiency level. */
export const ASSUMED_CLAIM_LEVEL = 2.5;

export const STATUS_LABEL: Record<SkillStatus, string> = {
  app_verified: 'App-verified',
  assessed: 'Assessed',
  self_reported: 'Self-reported',
  extracted_claim: 'Extracted claim',
};

export interface EvidenceInput {
  type: EvidenceType;
  score?: number | null;
  observedLevel?: number | null;
  gradingMethod?: GradingMethod | null;
  sourceRef: string;
  notes?: string;
}

export async function addEvidence(ctx: AppContext, userId: number, skillId: number, ev: EvidenceInput) {
  await ctx.db.insert(skillEvidence).values({
    userId, skillId, type: ev.type, score: ev.score ?? null, observedLevel: ev.observedLevel ?? null,
    gradingMethod: ev.gradingMethod ?? null, sourceRef: ev.sourceRef, notes: ev.notes ?? '',
  });
  return recomputeUserSkill(ctx, userId, skillId);
}

export function deriveStatus(evidence: (typeof skillEvidence.$inferSelect)[], now: Date): { status: SkillStatus | null; proficiency: number | null; confidence: number; reason: string } {
  const windowStart = now.getTime() - VERIFICATION_POLICY.windowDays * 86_400_000;
  const recent = [...evidence].filter((e) => e.createdAt.getTime() >= windowStart).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const latestQuiz = recent.find((e) => e.type === 'quiz' && e.gradingMethod === 'objective');
  const latestPerf = recent.find((e) => VERIFICATION_POLICY.performanceTypes.includes(e.type) && e.gradingMethod && VERIFICATION_POLICY.trustedMethods.includes(e.gradingMethod));
  const assessments = recent.filter((e) => e.type === 'quiz' || e.type === 'interview_observation' || VERIFICATION_POLICY.performanceTypes.includes(e.type));
  const selfReport = evidence.filter((e) => e.type === 'self_report').sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

  if (latestQuiz && latestPerf && (latestQuiz.score ?? 0) >= VERIFICATION_POLICY.passScore && (latestPerf.score ?? 0) >= VERIFICATION_POLICY.passScore) {
    const levels = [latestQuiz.observedLevel, latestPerf.observedLevel].filter((x): x is number => x != null);
    return {
      status: 'app_verified',
      proficiency: levels.length ? round(levels.reduce((a, b) => a + b, 0) / levels.length, 1) : null,
      confidence: 0.9,
      reason: `Quiz ${Math.round((latestQuiz.score ?? 0) * 100)}% and ${latestPerf.type.replace('_', ' ')} ${Math.round((latestPerf.score ?? 0) * 100)}% both met the 70% verification threshold.`,
    };
  }
  if (assessments.length) {
    const weighted = assessments.slice(0, 4).filter((e) => e.observedLevel != null).map((e) => ({ v: e.observedLevel!, w: e.type === 'interview_observation' || e.gradingMethod === 'heuristic_rubric' ? 0.5 : 1 }));
    const totalW = weighted.reduce((s, x) => s + x.w, 0);
    const onlyWeak = assessments.every((e) => e.type === 'interview_observation' || e.gradingMethod === 'heuristic_rubric');
    const missing: string[] = [];
    if (!latestQuiz || (latestQuiz.score ?? 0) < VERIFICATION_POLICY.passScore) missing.push('a passing objective quiz');
    if (!latestPerf || (latestPerf.score ?? 0) < VERIFICATION_POLICY.passScore) missing.push('a passing scenario/practical task graded by rubric');
    return {
      status: 'assessed',
      proficiency: totalW ? round(weighted.reduce((s, x) => s + x.v * x.w, 0) / totalW, 1) : null,
      confidence: onlyWeak ? 0.5 : 0.7,
      reason: `Assessed${onlyWeak ? ' (interview or heuristic grading only)' : ''}; verification still needs ${missing.join(' and ') || 'consistent passing results'}.`,
    };
  }
  if (selfReport) {
    return { status: 'self_reported', proficiency: selfReport.observedLevel ?? null, confidence: 0.35, reason: 'Self-reported; not yet assessed.' };
  }
  if (evidence.some((e) => e.type === 'course_completion')) {
    return { status: 'self_reported', proficiency: null, confidence: 0.3, reason: 'Course completion recorded; completion alone does not demonstrate competence.' };
  }
  if (evidence.some((e) => e.type === 'cv_extraction' || e.type === 'project')) {
    return { status: 'extracted_claim', proficiency: null, confidence: 0.25, reason: 'Mentioned in your CV or profile history; level unknown until assessed.' };
  }
  return { status: null, proficiency: null, confidence: 0, reason: '' };
}

export async function recomputeUserSkill(ctx: AppContext, userId: number, skillId: number) {
  const evidence = await ctx.db.select().from(skillEvidence).where(and(eq(skillEvidence.userId, userId), eq(skillEvidence.skillId, skillId)));
  const derived = deriveStatus(evidence, ctx.now());
  const selfRating = evidence.filter((e) => e.type === 'self_report').sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]?.observedLevel ?? null;
  if (!derived.status) {
    await ctx.db.delete(userSkills).where(and(eq(userSkills.userId, userId), eq(userSkills.skillId, skillId)));
    return null;
  }
  const values = { userId, skillId, status: derived.status, proficiency: derived.proficiency, confidence: derived.confidence, statusReason: derived.reason, selfRating: selfRating != null ? Math.round(selfRating) : null, updatedAt: ctx.now() };
  const [row] = await ctx.db.insert(userSkills).values(values).onConflictDoUpdate({ target: [userSkills.userId, userSkills.skillId], set: values }).returning();
  return row;
}

export async function setSelfReported(ctx: AppContext, userId: number, skillSlug: string, rating: number) {
  const [skill] = await ctx.db.select().from(skills).where(eq(skills.slug, skillSlug));
  if (!skill) throw notFound('Skill');
  await ctx.db.delete(skillEvidence).where(and(eq(skillEvidence.userId, userId), eq(skillEvidence.skillId, skill.id), eq(skillEvidence.type, 'self_report')));
  return addEvidence(ctx, userId, skill.id, { type: 'self_report', observedLevel: rating, sourceRef: 'profile', notes: `Self-rated ${rating}/5` });
}

export async function removeSelfReported(ctx: AppContext, userId: number, skillSlug: string) {
  const [skill] = await ctx.db.select().from(skills).where(eq(skills.slug, skillSlug));
  if (!skill) throw notFound('Skill');
  await ctx.db.delete(skillEvidence).where(and(eq(skillEvidence.userId, userId), eq(skillEvidence.skillId, skill.id), eq(skillEvidence.type, 'self_report')));
  return recomputeUserSkill(ctx, userId, skill.id);
}

export interface UserSkillState { slug: string; skillId: number; status: SkillStatus; proficiency: number | null; confidence: number; reason: string }

export async function loadUserSkillMap(ctx: AppContext, userId: number): Promise<Map<string, UserSkillState>> {
  const rows = await ctx.db.select({ us: userSkills, slug: skills.slug }).from(userSkills).innerJoin(skills, eq(skills.id, userSkills.skillId)).where(eq(userSkills.userId, userId));
  return new Map(rows.map(({ us, slug }) => [slug, { slug, skillId: us.skillId, status: us.status, proficiency: us.proficiency, confidence: us.confidence, reason: us.statusReason }]));
}

export async function listUserSkills(ctx: AppContext, userId: number) {
  const rows = await ctx.db.select({ us: userSkills, skill: skills }).from(userSkills).innerJoin(skills, eq(skills.id, userSkills.skillId)).where(eq(userSkills.userId, userId));
  const ev = await ctx.db.select().from(skillEvidence).where(eq(skillEvidence.userId, userId)).orderBy(desc(skillEvidence.createdAt));
  return rows.map(({ us, skill }) => ({
    slug: skill.slug, name: skill.name, category: skill.category, status: us.status, statusLabel: STATUS_LABEL[us.status],
    proficiency: us.proficiency, selfRating: us.selfRating, confidence: us.confidence, reason: us.statusReason, updatedAt: us.updatedAt,
    evidence: ev.filter((e) => e.skillId === skill.id).slice(0, 10).map((e) => ({ id: e.id, type: e.type, score: e.score, observedLevel: e.observedLevel, gradingMethod: e.gradingMethod, sourceRef: e.sourceRef, notes: e.notes, createdAt: e.createdAt })),
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export type CreditResult =
  | { state: 'unknown' }
  | { state: 'known'; level: number; levelAssumed: boolean; trust: number; credit: number; status: SkillStatus };

/** Capability credit for one requirement. Missing evidence is UNKNOWN, never zero. */
export function skillCredit(us: UserSkillState | undefined, requiredLevel: number): CreditResult {
  if (!us) return { state: 'unknown' };
  const levelAssumed = us.proficiency == null;
  const level = us.proficiency ?? ASSUMED_CLAIM_LEVEL;
  const trust = TRUST[us.status];
  return { state: 'known', level, levelAssumed, trust, credit: Math.min(1, level / Math.max(1, requiredLevel)) * trust, status: us.status };
}

/** Gate state for a critical requirement. */
export function criticalState(us: UserSkillState | undefined, requiredLevel: number): 'met' | 'claimed' | 'gap' | 'unknown' {
  if (!us) return 'unknown';
  const verifiedish = us.status === 'app_verified' || us.status === 'assessed';
  if (us.proficiency == null) return verifiedish ? 'claimed' : 'claimed';
  if (verifiedish) return us.proficiency >= requiredLevel - 0.5 ? 'met' : 'gap';
  return us.proficiency >= requiredLevel - 1 ? 'claimed' : 'gap';
}
