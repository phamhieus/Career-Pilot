import { describe, expect, it } from 'vitest';
import { heuristicGrade, heuristicParseJob } from '../src/ai/heuristics.js';
import { deriveStatus, skillCredit, type UserSkillState } from '../src/services/evidence.js';
import { computeCapability, normalizeWeights } from '../src/services/matching.js';
import { buildPlanSchedule, type PlanNode } from '../src/services/learning.js';
import { validateStageChange } from '../src/services/applications.js';
import { assertTransition, decideNext } from '../src/services/interviews.js';
import { linearForecast } from '../src/services/market.js';
import { dedupKeyFor } from '../src/services/jobs/ingest.js';
import { prioritizedTopoSort, validateGraph } from '../src/lib/graph.js';
import { SKILLS } from '../src/seed/data/skills.js';
import { ROADMAPS } from '../src/seed/data/roadmaps.js';
import { Taxonomy } from '../src/services/taxonomy.js';
import { LEARNING_VIDEO_SERIES, videoSeriesForSkills } from '../src/services/learningVideos.js';

const us = (slug: string, status: UserSkillState['status'], proficiency: number | null): UserSkillState => ({ slug, skillId: 1, status, proficiency, confidence: 0.5, reason: '' });
const req = (skillSlug: string, weight: number, requiredLevel: number, critical = false) => ({ skillSlug, skillName: skillSlug, category: 'x', weight, requiredLevel, critical, baseHours: 30 });

describe('learning video series', () => {
  it('maps series only to existing skills and uses inspectable playlist sources', () => {
    const slugs = new Set(SKILLS.map((s) => s.slug));
    for (const series of LEARNING_VIDEO_SERIES) {
      expect(series.skillSlugs.every((s) => slugs.has(s))).toBe(true);
      expect(new URL(series.url).hostname).toBe('www.youtube.com');
      expect(new URL(series.url).searchParams.get('list')).toMatch(/^PL[A-Za-z0-9_-]+$/);
      expect(series.sourceUrl.startsWith('https://')).toBe(true);
    }
  });
  it('prioritizes the role series and keeps topic recommendations relevant', () => {
    expect(videoSeriesForSkills(['python', 'llm-applications'], 'ai-engineer')[0].id).toBe('microsoft-genai');
    expect(videoSeriesForSkills(['python']).every((s) => s.skillSlugs.includes('python'))).toBe(true);
    expect(videoSeriesForSkills(['stakeholder-management'])).toEqual([]);
  });
});

describe('weights & capability', () => {
  it('normalizes weights to sum to 1 regardless of scale', () => {
    const n = normalizeWeights([{ weight: 3 }, { weight: 1 }, { weight: 0 }]);
    expect(n.map((x) => x.normalizedWeight)).toEqual([0.75, 0.25, 0]);
    expect(n.reduce((s, x) => s + x.normalizedWeight, 0)).toBeCloseTo(1);
  });

  it('treats missing evidence as UNKNOWN, not zero', () => {
    const r = computeCapability({ requirements: [req('a', 1, 3), req('b', 1, 3)], userSkills: new Map([['a', us('a', 'app_verified', 3)]]), relevantYears: null, minYears: 2 });
    expect(r.rows.find((x) => x.skillSlug === 'b')!.state).toBe('unknown');
    // Score is computed only over known requirements: verified a at level → 100, not 50.
    expect(r.dimension.score).toBe(100);
    expect(r.dimension.coverage).toBe(0.5);
  });

  it('returns null score when nothing is known', () => {
    const r = computeCapability({ requirements: [req('a', 1, 3)], userSkills: new Map(), relevantYears: null, minYears: 2 });
    expect(r.dimension.score).toBeNull();
    expect(r.dimension.confidence).toBe('unknown');
  });

  it('discounts unverified claims', () => {
    expect(skillCredit(us('a', 'self_reported', 5), 3)).toMatchObject({ credit: 0.6 });
    expect(skillCredit(us('a', 'extracted_claim', null), 3)).toMatchObject({ levelAssumed: true });
    expect(skillCredit(undefined, 3)).toEqual({ state: 'unknown' });
  });
  it('explains a 68 score as evidence adjustment rather than an unrecorded-skill penalty', () => {
    const result = computeCapability({
      requirements: [req('api', 1, 3), req('sql', 1, 3), req('unknown', 1, 3)],
      userSkills: new Map([['api', us('api', 'self_reported', 4)], ['sql', us('sql', 'self_reported', 3)]]),
      relevantYears: 7.3, minYears: 2,
    });
    expect(result.dimension.score).toBe(68);
    expect(result.breakdown).toMatchObject({ skillScore: 60, levelOnlySkillScore: 100, skillPoints: 48, experiencePoints: 20, evidenceLossPoints: 32, levelLossPoints: 0, experienceLossPoints: 0, unknownSkills: 1 });
    expect(result.breakdown.drivers).toHaveLength(2);
    expect(result.breakdown.drivers.reduce((sum, r) => sum + r.pointsEarned + r.evidenceLoss + r.levelLoss, 0)).toBeCloseTo(80, 2);
    expect(result.rows.find((r) => r.skillSlug === 'api')).toMatchObject({ levelFit: 1, trust: 0.6, levelAssumed: false });
  });
  it('separates proficiency shortfall, evidence discount and experience shortfall', () => {
    const result = computeCapability({ requirements: [req('a', 1, 4)], userSkills: new Map([['a', us('a', 'assessed', 2)]]), relevantYears: 1, minYears: 2 });
    expect(result.breakdown).toMatchObject({ levelOnlySkillScore: 50, skillScore: 42.5, skillPoints: 34, experiencePoints: 10, levelLossPoints: 40, evidenceLossPoints: 6, experienceLossPoints: 10 });
    expect(result.dimension.score).toBe(44);
    const b = result.breakdown;
    expect(b.skillPoints! + b.experiencePoints! + b.levelLossPoints! + b.evidenceLossPoints! + b.experienceLossPoints!).toBeCloseTo(100, 2);
  });
  it('keeps assumed proficiency explicit and does not award experience points with no known skills', () => {
    const claimed = computeCapability({ requirements: [req('a', 1, 3)], userSkills: new Map([['a', us('a', 'extracted_claim', null)]]), relevantYears: null, minYears: 2 });
    expect(claimed.breakdown.assumedSkills).toBe(1);
    expect(claimed.rows[0]).toMatchObject({ levelAssumed: true, level: 2.5, trust: 0.5 });
    const missing = computeCapability({ requirements: [req('a', 1, 3)], userSkills: new Map(), relevantYears: 10, minYears: 2 });
    expect(missing.dimension.score).toBeNull();
    expect(missing.breakdown).toMatchObject({ skillPoints: null, experiencePoints: null, unknownSkills: 1 });
  });

  it('critical gaps block regardless of strong scores elsewhere', () => {
    const r = computeCapability({
      requirements: [req('crit', 1, 4, true), req('a', 10, 3), req('b', 10, 3)],
      userSkills: new Map([['crit', us('crit', 'assessed', 2)], ['a', us('a', 'app_verified', 5)], ['b', us('b', 'app_verified', 5)]]),
      relevantYears: 10, minYears: 2,
    });
    expect(r.dimension.score).toBeGreaterThan(80);
    expect(r.gate.status).toBe('blocked');
    expect(r.gate.gaps).toContain('crit');
  });

  it('unknown critical skills require evidence', () => {
    const r = computeCapability({ requirements: [req('crit', 1, 3, true)], userSkills: new Map(), relevantYears: null, minYears: 2 });
    expect(r.gate.status).toBe('needs_evidence');
  });
});

describe('verification policy', () => {
  const now = new Date('2026-10-31T00:00:00Z');
  const ev = (type: string, score: number | null, gradingMethod: string | null, level = 3) => ({ id: 1, userId: 1, skillId: 1, type, score, observedLevel: level, gradingMethod, sourceRef: 'x', notes: '', createdAt: now }) as never;
  it('requires both objective quiz and rubric-graded performance to verify', () => {
    expect(deriveStatus([ev('quiz', 0.9, 'objective')], now).status).toBe('assessed');
    expect(deriveStatus([ev('quiz', 0.9, 'objective'), ev('practical', 0.8, 'ai_rubric')], now).status).toBe('app_verified');
  });
  it('never verifies from heuristic grading, interviews or course completion', () => {
    expect(deriveStatus([ev('quiz', 1, 'objective'), ev('practical', 1, 'heuristic_rubric')], now).status).toBe('assessed');
    expect(deriveStatus([ev('interview_observation', 1, 'ai_rubric')], now).status).toBe('assessed');
    expect(deriveStatus([ev('course_completion', null, null)], now)).toMatchObject({ status: 'self_reported', proficiency: null });
  });
  it('failing scores do not verify', () => {
    expect(deriveStatus([ev('quiz', 0.6, 'objective'), ev('practical', 0.9, 'ai_rubric')], now).status).toBe('assessed');
  });
});

describe('skill prerequisite graph', () => {
  it('global skill graph is a valid DAG', () => {
    const v = validateGraph(SKILLS.map((s) => s.slug), SKILLS.flatMap((s) => s.prereqs.map((p) => ({ from: p, to: s.slug }))));
    expect(v.danglingEdges).toEqual([]);
    expect(v.cycles).toEqual([]);
  });
  it('detects cycles and dangling edges', () => {
    const v = validateGraph(['a', 'b'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }, { from: 'a', to: 'zzz' }]);
    expect(v.valid).toBe(false);
    expect(v.cycles.length).toBeGreaterThan(0);
    expect(v.danglingEdges).toHaveLength(1);
  });
  it('covers the 8 required curated roadmaps', () => {
    expect(ROADMAPS.map((r) => r.role).sort()).toEqual(['ai-engineer', 'backend-engineer', 'business-analyst', 'cloud-engineer', 'devops-engineer', 'it-project-manager', 'product-manager', 'ux-ui-designer']);
  });
  it('topological sort respects prerequisites and uses priority for ties', () => {
    const order = prioritizedTopoSort(['a', 'b', 'c', 'd'], [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }], (n) => ({ a: 1, b: 5, c: 9, d: 0 })[n]!);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
    expect(order[0]).toBe('b');
  });
});

describe('learning plan scheduler', () => {
  const node = (key: string, hours: number, type: PlanNode['type'] = 'skill'): PlanNode => ({ key, type, label: key, skillSlug: type === 'skill' ? key : null, estimatedHours: hours, practiceTask: 'p', resourceIds: [] });
  const base = {
    nodes: [node('a', 10), node('b', 10), node('c', 20), node('chk', 1, 'assessment')],
    edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'a', to: 'chk' }, { from: 'b', to: 'chk' }],
    requirements: new Map([['a', { critical: false, normalizedWeight: 0.2, requiredLevel: 3 }], ['b', { critical: true, normalizedWeight: 0.4, requiredLevel: 3 }], ['c', { critical: false, normalizedWeight: 0.4, requiredLevel: 3 }]]),
    marketShare: new Map<string, number>(),
    userSkills: new Map<string, UserSkillState>(),
    weeklyHours: 8, studyDaysPerWeek: 4, startDate: '2026-11-02', deadline: null, completedNodeKeys: new Set<string>(),
  };
  it('orders tasks by prerequisites and never exceeds weekly capacity', () => {
    const s = buildPlanSchedule(base);
    const firstIdx = (k: string) => s.tasks.findIndex((t) => t.nodeKey === k);
    expect(firstIdx('a')).toBeLessThan(firstIdx('b'));
    expect(firstIdx('b')).toBeLessThan(firstIdx('c'));
    expect(firstIdx('chk')).toBeLessThan(firstIdx('c')); // checkpoint runs as soon as it unlocks
    const perWeek = new Map<number, number>();
    for (const t of s.tasks) perWeek.set(t.weekIndex, (perWeek.get(t.weekIndex) ?? 0) + t.estimatedHours);
    for (const h of perWeek.values()) expect(h).toBeLessThanOrEqual(8.05);
    expect(s.totalHours).toBeCloseTo(41, 0);
  });
  it('schedules daily dates only for the near term', () => {
    const s = buildPlanSchedule(base);
    const dated = s.tasks.filter((t) => t.scheduledDate);
    expect(dated.length).toBeGreaterThan(0);
    expect(dated.every((t) => t.scheduledDate! < '2026-11-16')).toBe(true);
    expect(s.tasks.some((t) => !t.scheduledDate)).toBe(true);
    expect(s.milestones.length).toBeGreaterThan(0);
    const perDay = new Map<string, number>();
    for (const t of dated) perDay.set(t.scheduledDate!, (perDay.get(t.scheduledDate!) ?? 0) + t.estimatedHours);
    for (const h of perDay.values()) expect(h).toBeLessThanOrEqual(8 / 4 + 0.05);
    // splitting into sessions never changes the total
    expect(s.tasks.reduce((x, t) => x + t.estimatedHours, 0)).toBeCloseTo(41, 0);
  });
  it('adapts format without changing total workload or removing assessments', () => {
    const docs = buildPlanSchedule(base);
    const project = buildPlanSchedule({ ...base, learningFormat: 'project' });
    const video = buildPlanSchedule({ ...base, learningFormat: 'youtube' });
    const hours = (s: typeof docs, type: string) => s.tasks.filter((t) => t.type === type).reduce((sum, t) => sum + t.estimatedHours, 0);
    expect(project.totalHours).toBe(docs.totalHours);
    expect(hours(project, 'project')).toBeGreaterThan(hours(docs, 'practice'));
    expect(hours(project, 'assessment')).toBe(hours(docs, 'assessment'));
    expect(video.tasks.filter((t) => t.type === 'learn').every((t) => t.title.startsWith('Watch on YouTube:'))).toBe(true);
  });
  it('skips verified skills and flags infeasible deadlines without overloading', () => {
    const s = buildPlanSchedule({ ...base, userSkills: new Map([['a', us('a', 'app_verified', 3)]]), deadline: '2026-11-16' });
    expect(s.skippedNodeKeys).toContain('a');
    expect(s.tasks.some((t) => t.nodeKey === 'a')).toBe(false);
    expect(s.feasible).toBe(false);
    expect(s.feasibilityNote).toMatch(/Not feasible/);
  });
  it('shrinks hours for partially-known skills', () => {
    const s = buildPlanSchedule({ ...base, userSkills: new Map([['c', us('c', 'assessed', 2)]]) });
    const cHours = s.tasks.filter((t) => t.nodeKey === 'c').reduce((x, t) => x + t.estimatedHours, 0);
    expect(cHours).toBeCloseTo(20 * (1 / 3), 0);
  });
});

describe('job dedup & parsing', () => {
  it('dedup key ignores case, accents and punctuation; private copies are separate', () => {
    expect(dedupKeyFor({ company: 'MB Bank', title: 'Data Engineer – Data', location: 'Hà Nội' })).toBe(dedupKeyFor({ company: 'mb bank', title: 'data engineer data', location: 'Ha Noi' }));
    expect(dedupKeyFor({ company: 'A', title: 'B', location: null }, 7)).not.toBe(dedupKeyFor({ company: 'A', title: 'B', location: null }));
  });
  it('heuristic JD parsing separates required and preferred and never invents salary', () => {
    const tax = new Taxonomy(SKILLS.map((s, i) => ({ id: i + 1, slug: s.slug, name: s.name, category: s.category, prerequisites: s.prereqs, baseHours: s.baseHours, terms: [s.name, ...s.aliases] })), []);
    const p = heuristicParseJob('Backend Engineer\nRequirements\n- 3+ years with Python and PostgreSQL\n- REST API design\nNice to have\n- Kubernetes', tax);
    expect(p.requiredSkills).toEqual(expect.arrayContaining(['python', 'sql', 'api-design']));
    expect(p.preferredSkills).toContain('kubernetes');
    expect(p.minYears).toBe(3);
    expect(p.salary).toBeNull();
  });
});

describe('interview engine', () => {
  it('enforces session state transitions', () => {
    expect(() => assertTransition('planned', 'in_progress')).not.toThrow();
    expect(() => assertTransition('planned', 'completed')).toThrow();
    expect(() => assertTransition('completed', 'in_progress')).toThrow();
  });
  it('asks a follow-up for weak answers, then moves on; adapts difficulty', () => {
    const bp = { topics: [{ key: 't1', label: 'A', kind: 'skill' as const, priority: 2, reason: '', covered: false, followUps: 0 }, { key: 't2', label: 'B', kind: 'skill' as const, priority: 1, reason: '', covered: false, followUps: 0 }], maxMainQuestions: 2, maxFollowUpsPerTopic: 1, context: { roleName: 'x' } };
    const weak = { score: 0.3, criteria: [], strengths: [], gaps: [], evidenceQuotes: [], needsFollowUp: true, followUpFocus: 'impact', method: 'heuristic_rubric' as const };
    const d1 = decideNext({ blueprint: bp, currentTopicKey: 't1', evaluation: weak, difficulty: 3, mainAsked: 1, elapsedMinutes: 1, durationMinutes: 20 });
    expect(d1.action).toBe('follow_up');
    expect(d1.difficulty).toBe(2);
    const d2 = decideNext({ blueprint: d1.blueprint, currentTopicKey: 't1', evaluation: weak, difficulty: 2, mainAsked: 1, elapsedMinutes: 2, durationMinutes: 20 });
    expect(d2.action).toBe('next_topic');
    expect(d2.topic!.key).toBe('t2');
    const strong = { ...weak, score: 0.9, needsFollowUp: false };
    const d3 = decideNext({ blueprint: d2.blueprint, currentTopicKey: 't2', evaluation: strong, difficulty: 2, mainAsked: 2, elapsedMinutes: 3, durationMinutes: 20 });
    expect(d3.action).toBe('complete');
    expect(d3.difficulty).toBe(3);
  });
  it('heuristic grader only quotes text that is in the answer', () => {
    const answer = 'First I reproduced the issue with a minimal input. Then I added a guard for empty orders and wrote a regression unit test.';
    const g = heuristicGrade(answer, [{ criterion: 'Debugging', weight: 1, indicators: ['reproduce', 'minimal', 'unit test'] }]);
    for (const q of g.evidenceQuotes) expect(answer).toContain(q);
    expect(g.score).toBeGreaterThan(0);
  });
});

describe('applications', () => {
  it('validates stage & outcome rules', () => {
    expect(() => validateStageChange({ stage: 'applied', outcome: null, history: ['saved', 'applied'] }, { stage: 'closed' })).toThrow(/outcome/);
    expect(() => validateStageChange({ stage: 'applied', outcome: null, history: [] }, { stage: 'screening', outcome: 'rejected' })).toThrow();
    expect(() => validateStageChange({ stage: 'interview', outcome: null, history: ['interview'] }, { stage: 'closed', outcome: 'accepted' })).toThrow(/Offer/);
    expect(validateStageChange({ stage: 'offer', outcome: null, history: ['offer'] }, { stage: 'closed', outcome: 'accepted' }).type).toBe('closed');
    expect(validateStageChange({ stage: 'closed', outcome: 'rejected', history: [] }, { stage: 'interview' }).type).toBe('reopened');
  });
});

describe('market forecast', () => {
  it('refuses to forecast with insufficient history', () => {
    expect(linearForecast([{ period: '2026-09', value: 10 }, { period: '2026-10', value: 20 }]).status).toBe('insufficient');
    const gappy = ['2026-01', '2026-02', '2026-04', '2026-05', '2026-06', '2026-07'].map((p) => ({ period: p, value: 5 }));
    expect(linearForecast(gappy).status).toBe('insufficient');
  });
  it('produces an interval around a linear trend', () => {
    const s = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'].map((p, i) => ({ period: p, value: 10 + 2 * i + (i % 2 ? 0.5 : -0.5) }));
    const f = linearForecast(s);
    expect(f.status).toBe('ok');
    expect(f.points![0].period).toBe('2026-07');
    expect(f.points![0].low).toBeLessThanOrEqual(f.points![0].value);
    expect(f.points![0].high).toBeGreaterThanOrEqual(f.points![0].value);
    expect(f.points![0].value).toBeCloseTo(22, 0);
  });
});
