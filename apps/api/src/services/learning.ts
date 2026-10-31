import { and, asc, desc, eq, inArray, isNull, lt, ne } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import {
  careerProfiles, careerRoles, jobApplications, jobs, learningPlans, learningResources, learningTasks, milestones, planRevisions,
  roadmapEdges, roadmapNodes, roadmaps, roleSkillRequirements, skills,
} from '../db/schema.js';
import { addDays, daysBetween, todayIso } from '../lib/dates.js';
import { badRequest, notFound } from '../lib/errors.js';
import { prioritizedTopoSort, type Edge } from '../lib/graph.js';
import { clamp, round } from '../lib/text.js';
import { loadUserSkillMap, type UserSkillState } from './evidence.js';
import { videoSeriesForSkills } from './learningVideos.js';

export interface PlanNode {
  key: string;
  type: 'group' | 'skill' | 'concept' | 'project' | 'assessment';
  label: string;
  skillSlug: string | null;
  estimatedHours: number;
  practiceTask: string;
  resourceIds: number[];
}
export interface PlanInput {
  learningFormat?: 'docs' | 'project' | 'youtube';
  nodes: PlanNode[];
  edges: Edge[];
  requirements: Map<string, { critical: boolean; normalizedWeight: number; requiredLevel: number }>;
  marketShare: Map<string, number>;
  userSkills: Map<string, UserSkillState>;
  weeklyHours: number;
  studyDaysPerWeek: number;
  startDate: string;
  deadline: string | null;
  completedNodeKeys: Set<string>;
  nearTermDays?: number;
  milestoneWeeks?: number;
}
export interface PlannedTask {
  nodeKey: string;
  skillSlug: string | null;
  title: string;
  detail: string;
  type: 'learn' | 'practice' | 'assessment' | 'project' | 'remedial';
  weekIndex: number;
  scheduledDate: string | null;
  estimatedHours: number;
  resourceIds: number[];
  sortOrder: number;
}
export interface PlanSchedule {
  orderedNodeKeys: string[];
  skippedNodeKeys: string[];
  tasks: PlannedTask[];
  milestones: { title: string; targetDate: string; nodeKeys: string[] }[];
  totalHours: number;
  weeksNeeded: number;
  projectedEndDate: string;
  feasible: boolean;
  feasibilityNote: string;
}

/** Hours still needed for a skill node given current evidence (min 25% for a review pass). */
export function remainingHours(node: PlanNode, us: UserSkillState | undefined, requiredLevel: number): number {
  const scale = requiredLevel / 3;
  if (!us || us.proficiency == null) return round(node.estimatedHours * scale, 1);
  const gap = clamp((requiredLevel - us.proficiency) / requiredLevel);
  return round(node.estimatedHours * scale * Math.max(0.25, gap), 1);
}

/** Deterministic plan scheduler: prerequisite-respecting, priority-ordered, capacity-bounded. */
export function buildPlanSchedule(input: PlanInput): PlanSchedule {
  const nearTermDays = input.nearTermDays ?? 14;
  const milestoneWeeks = input.milestoneWeeks ?? 4;
  const reqLevel = (slug: string | null) => (slug ? input.requirements.get(slug)?.requiredLevel ?? 3 : 3);
  const workNodes = input.nodes.filter((n) => n.type !== 'group');

  const skipped = new Set<string>();
  for (const n of workNodes) {
    if (input.completedNodeKeys.has(n.key)) { skipped.add(n.key); continue; }
    if (n.type === 'skill' && n.skillSlug) {
      const us = input.userSkills.get(n.skillSlug);
      if (us?.status === 'app_verified' && (us.proficiency ?? 0) >= reqLevel(n.skillSlug) - 0.5) skipped.add(n.key);
    }
  }
  // Checkpoints whose skill prerequisites are all verified are unnecessary.
  for (const n of workNodes.filter((x) => x.type === 'assessment')) {
    const preds = input.edges.filter((e) => e.to === n.key).map((e) => e.from);
    if (preds.length && preds.every((p) => skipped.has(p))) skipped.add(n.key);
  }
  const included = workNodes.filter((n) => !skipped.has(n.key));
  const includedKeys = new Set(included.map((n) => n.key));
  const edges = input.edges.filter((e) => includedKeys.has(e.from) && includedKeys.has(e.to));

  const priority = (key: string): number => {
    const n = included.find((x) => x.key === key)!;
    if (n.type === 'assessment') return 4; // run checkpoints as soon as they unlock
    if (n.type !== 'skill' || !n.skillSlug) return n.type === 'concept' ? 1 : 0.5;
    const r = input.requirements.get(n.skillSlug);
    return (r?.critical ? 3 : 0) + (r?.normalizedWeight ?? 0) * 5 + (input.marketShare.get(n.skillSlug) ?? 0) * 3;
  };
  const order = prioritizedTopoSort(included.map((n) => n.key), edges, priority);

  // Expand nodes into tasks.
  const coveredByCheckpoint = new Set(input.edges.filter((e) => included.find((n) => n.key === e.to)?.type === 'assessment').map((e) => e.from));
  const units: Omit<PlannedTask, 'weekIndex' | 'scheduledDate' | 'sortOrder'>[] = [];
  for (const key of order) {
    const n = included.find((x) => x.key === key)!;
    if (n.type === 'skill') {
      const hours = remainingHours(n, n.skillSlug ? input.userSkills.get(n.skillSlug) : undefined, reqLevel(n.skillSlug));
      const projectFirst = input.learningFormat === 'project';
      const learnH = hours < 2 ? hours : round(hours * (projectFirst ? 0.3 : 0.6), 1);
      const detail = input.learningFormat === 'youtube' ? 'Choose a YouTube lesson from the learning options. Follow along, take notes and check your understanding with practice.' : projectFirst ? 'Review the linked reference material to prepare for the practical project.' : 'Study the linked resources and take notes on key concepts.';
      units.push({ nodeKey: key, skillSlug: n.skillSlug, title: `${input.learningFormat === 'youtube' ? 'Watch on YouTube' : 'Learn'}: ${n.label}`, detail, type: 'learn', estimatedHours: learnH, resourceIds: n.resourceIds });
      if (hours >= 2) units.push({ nodeKey: key, skillSlug: n.skillSlug, title: `${projectFirst ? 'Project' : 'Practice'}: ${n.label}`, detail: n.practiceTask, type: projectFirst ? 'project' : 'practice', estimatedHours: round(hours - learnH, 1), resourceIds: [] });
      if (n.skillSlug && input.requirements.get(n.skillSlug)?.critical && !coveredByCheckpoint.has(key)) {
        units.push({ nodeKey: key, skillSlug: n.skillSlug, title: `Assess: ${n.label}`, detail: 'Take the skill assessment to verify this critical skill.', type: 'assessment', estimatedHours: 1, resourceIds: [] });
      }
    } else if (n.type === 'assessment') {
      units.push({ nodeKey: key, skillSlug: null, title: n.label, detail: 'Take the checkpoint assessment in CareerPilot.', type: 'assessment', estimatedHours: 1, resourceIds: [] });
    } else if (n.type === 'project') {
      units.push({ nodeKey: key, skillSlug: null, title: n.label, detail: n.practiceTask, type: 'project', estimatedHours: n.estimatedHours, resourceIds: [] });
    } else {
      units.push({ nodeKey: key, skillSlug: null, title: `Learn: ${n.label}`, detail: n.practiceTask, type: 'learn', estimatedHours: n.estimatedHours, resourceIds: n.resourceIds });
    }
  }

  // Fill weeks without exceeding weekly capacity; split large tasks into parts.
  const cap = input.weeklyHours;
  const tasks: PlannedTask[] = [];
  let week = 0;
  let used = 0;
  for (const u of units) {
    let remaining = u.estimatedHours;
    const parts: { week: number; hours: number }[] = [];
    while (remaining > 0.05) {
      if (used >= cap - 0.05) { week++; used = 0; }
      const h = round(Math.min(remaining, cap - used), 1);
      parts.push({ week, hours: h });
      used += h;
      remaining = round(remaining - h, 1);
    }
    parts.forEach((p, i) => tasks.push({ ...u, title: parts.length > 1 ? `${u.title} (part ${i + 1}/${parts.length})` : u.title, estimatedHours: p.hours, weekIndex: p.week, scheduledDate: null, sortOrder: tasks.length }));
  }

  // Daily sessions only for the near-term horizon: near-term tasks are split into day-sized sessions.
  const daily = round(cap / Math.max(1, input.studyDaysPerWeek), 2);
  const studyDay = (n: number) => { // n-th study day (0-based) → calendar date
    const weekNo = Math.floor(n / input.studyDaysPerWeek);
    return addDays(input.startDate, weekNo * 7 + (n % input.studyDaysPerWeek));
  };
  const scheduled: PlannedTask[] = [];
  let dayIdx = 0;
  let dayUsed = 0;
  let horizonOver = false;
  for (const t of tasks) {
    if (horizonOver) { scheduled.push(t); continue; }
    let remaining = t.estimatedHours;
    const sessions: { date: string; hours: number }[] = [];
    while (remaining > 0.05) {
      if (dayUsed >= daily - 0.05) { dayIdx++; dayUsed = 0; }
      const date = studyDay(dayIdx);
      if (daysBetween(input.startDate, date) >= nearTermDays) { horizonOver = true; break; }
      const h = round(Math.min(remaining, daily - dayUsed), 1);
      sessions.push({ date, hours: h });
      dayUsed += h;
      remaining = round(remaining - h, 1);
    }
    if (!sessions.length) { scheduled.push(t); continue; }
    const parts = sessions.length + (remaining > 0.05 ? 1 : 0);
    sessions.forEach((s, i) => scheduled.push({ ...t, title: parts > 1 ? `${t.title} — session ${i + 1}/${parts}` : t.title, estimatedHours: s.hours, scheduledDate: s.date }));
    if (remaining > 0.05) scheduled.push({ ...t, title: `${t.title} — session ${parts}/${parts}`, estimatedHours: remaining, scheduledDate: null });
  }
  scheduled.forEach((t, i) => { t.sortOrder = i; });
  tasks.splice(0, tasks.length, ...scheduled);

  const totalHours = round(tasks.reduce((s, t) => s + t.estimatedHours, 0), 1);
  const weeksNeeded = tasks.length ? Math.max(...tasks.map((t) => t.weekIndex)) + 1 : 0;
  const projectedEndDate = addDays(input.startDate, weeksNeeded * 7);

  const milestonesOut: PlanSchedule['milestones'] = [];
  for (let start = 0; start < weeksNeeded; start += milestoneWeeks) {
    const inRange = tasks.filter((t) => t.weekIndex >= start && t.weekIndex < start + milestoneWeeks);
    const keys = [...new Set(inRange.map((t) => t.nodeKey))].filter((k) => Math.max(...tasks.filter((t) => t.nodeKey === k).map((t) => t.weekIndex)) < start + milestoneWeeks);
    if (!keys.length) continue;
    const labels = keys.map((k) => included.find((n) => n.key === k)!.label);
    milestonesOut.push({ title: `Milestone ${milestonesOut.length + 1}: ${labels.slice(0, 3).join(', ')}${labels.length > 3 ? ` +${labels.length - 3}` : ''}`, targetDate: addDays(input.startDate, Math.min(weeksNeeded, start + milestoneWeeks) * 7), nodeKeys: keys });
  }

  let feasible = true;
  let note = `${totalHours} hours over ${weeksNeeded} week(s) at ${cap} h/week.`;
  if (input.deadline) {
    const weeksAvail = Math.max(0, Math.floor(daysBetween(input.startDate, input.deadline) / 7));
    if (weeksNeeded > weeksAvail) {
      feasible = false;
      const criticalHours = round(tasks.filter((t) => t.skillSlug && input.requirements.get(t.skillSlug)?.critical).reduce((s, t) => s + t.estimatedHours, 0), 1);
      note = `Not feasible by ${input.deadline}: needs ~${weeksNeeded} weeks at ${cap} h/week but only ${weeksAvail} remain. Options: raise to ~${weeksAvail ? Math.ceil(totalHours / weeksAvail) : '∞'} h/week, move the deadline to ${projectedEndDate}, or focus first on critical skills (~${criticalHours} h). The schedule never exceeds your weekly hours.`;
    } else note += ` Fits before your deadline (${input.deadline}).`;
  }
  return { orderedNodeKeys: order, skippedNodeKeys: [...skipped], tasks, milestones: milestonesOut, totalHours, weeksNeeded, projectedEndDate, feasible, feasibilityNote: note };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function loadRoadmapGraph(ctx: AppContext, roleId: number) {
  const [rm] = await ctx.db.select().from(roadmaps).where(eq(roadmaps.roleId, roleId));
  if (!rm) throw notFound('Roadmap for role');
  const nodes = await ctx.db.select({ n: roadmapNodes, slug: skills.slug }).from(roadmapNodes).leftJoin(skills, eq(skills.id, roadmapNodes.skillId)).where(eq(roadmapNodes.roadmapId, rm.id));
  const edges = await ctx.db.select().from(roadmapEdges).where(eq(roadmapEdges.roadmapId, rm.id));
  return {
    roadmap: rm,
    nodes: nodes.map(({ n, slug }): PlanNode => ({ key: n.key, type: n.type, label: n.label, skillSlug: slug ?? null, estimatedHours: n.estimatedHours, practiceTask: n.practiceTask, resourceIds: n.resourceIds })),
    edges: edges.map((e) => ({ from: e.fromKey, to: e.toKey })),
  };
}

async function planInputs(ctx: AppContext, userId: number, roleId: number, extraSkillSlugs: string[]) {
  const graph = await loadRoadmapGraph(ctx, roleId);
  const reqRows = await ctx.db.select({ r: roleSkillRequirements, slug: skills.slug }).from(roleSkillRequirements).innerJoin(skills, eq(skills.id, roleSkillRequirements.skillId)).where(eq(roleSkillRequirements.roleId, roleId));
  const totalW = reqRows.reduce((s, x) => s + x.r.weight, 0) || 1;
  const requirements = new Map(reqRows.map(({ r, slug }) => [slug, { critical: r.critical, normalizedWeight: r.weight / totalW, requiredLevel: r.requiredLevel }]));
  // Market signal: share of real postings for this role that require each skill.
  const roleJobs = await ctx.db.select({ req: jobs.requiredSkills }).from(jobs).where(and(eq(jobs.normalizedRoleId, roleId), eq(jobs.status, 'active'), eq(jobs.isDemo, false), isNull(jobs.ownerUserId)));
  const marketShare = new Map<string, number>();
  for (const j of roleJobs) for (const s of j.req) marketShare.set(s, (marketShare.get(s) ?? 0) + 1 / roleJobs.length);
  // Extra skills requested from tracked job requirements become additional nodes.
  if (extraSkillSlugs.length) {
    const extra = await ctx.db.select().from(skills).where(inArray(skills.slug, extraSkillSlugs));
    for (const s of extra) {
      if (graph.nodes.some((n) => n.skillSlug === s.slug)) continue;
      const res = await ctx.db.select({ id: learningResources.id }).from(learningResources).where(eq(learningResources.skillId, s.id));
      graph.nodes.push({ key: `extra:${s.slug}`, type: 'skill', label: s.name, skillSlug: s.slug, estimatedHours: s.baseHours, practiceTask: s.practiceTask, resourceIds: res.map((r) => r.id) });
      if (!requirements.has(s.slug)) requirements.set(s.slug, { critical: false, normalizedWeight: 0.05, requiredLevel: 3 });
    }
  }
  return { graph, requirements, marketShare, userSkills: await loadUserSkillMap(ctx, userId) };
}

async function persistSchedule(ctx: AppContext, planId: number, schedule: PlanSchedule, sortOffset = 0) {
  const msIds: number[] = [];
  for (const [i, m] of schedule.milestones.entries()) {
    const [row] = await ctx.db.insert(milestones).values({ planId, sortOrder: i, title: m.title, targetDate: m.targetDate, nodeKeys: m.nodeKeys }).returning({ id: milestones.id });
    msIds.push(row.id);
  }
  const msFor = (key: string) => { const idx = schedule.milestones.findIndex((m) => m.nodeKeys.includes(key)); return idx >= 0 ? msIds[idx] : null; };
  if (schedule.tasks.length) {
    await ctx.db.insert(learningTasks).values(schedule.tasks.map((t) => ({
      planId, milestoneId: msFor(t.nodeKey), nodeKey: t.nodeKey, skillSlug: t.skillSlug, title: t.title, detail: t.detail, type: t.type,
      weekIndex: t.weekIndex, scheduledDate: t.scheduledDate, estimatedHours: t.estimatedHours, resourceIds: t.resourceIds, sortOrder: sortOffset + t.sortOrder,
    })));
  }
}

export async function createPlan(ctx: AppContext, userId: number, input: { roleSlug: string; weeklyHours?: number; deadline?: string | null; startDate?: string; studyDaysPerWeek?: number; learningFormat?: 'docs' | 'project' | 'youtube' }) {
  const [role] = await ctx.db.select().from(careerRoles).where(eq(careerRoles.slug, input.roleSlug));
  if (!role) throw notFound('Role');
  const [profile] = await ctx.db.select().from(careerProfiles).where(eq(careerProfiles.userId, userId));
  const weeklyHours = input.weeklyHours ?? profile?.weeklyLearningHours ?? null;
  if (!weeklyHours || weeklyHours <= 0) throw badRequest('Set weekly learning hours (in your profile or in the request) before generating a plan.');
  const studyDays = input.studyDaysPerWeek ?? profile?.studyDaysPerWeek ?? 5;
  const startDate = input.startDate ?? todayIso(ctx.now());
  const deadline = input.deadline === undefined ? profile?.deadline ?? null : input.deadline;

  const { graph, requirements, marketShare, userSkills } = await planInputs(ctx, userId, role.id, []);
  const learningFormat = input.learningFormat ?? 'docs';
  const schedule = buildPlanSchedule({ learningFormat, nodes: graph.nodes, edges: graph.edges, requirements, marketShare, userSkills, weeklyHours, studyDaysPerWeek: studyDays, startDate, deadline, completedNodeKeys: new Set() });

  // Goal change: archive previous active plans, preserving their history.
  const previous = await ctx.db.select().from(learningPlans).where(and(eq(learningPlans.userId, userId), eq(learningPlans.status, 'active')));
  for (const p of previous) {
    await ctx.db.update(learningPlans).set({ status: 'archived', updatedAt: ctx.now() }).where(eq(learningPlans.id, p.id));
    await ctx.db.insert(planRevisions).values({ planId: p.id, reason: 'goal_changed', summary: `Archived: new goal ${role.name}. Verified skills are kept on your profile and carried into the new plan.`, changes: { newRoleSlug: role.slug } });
  }

  const [plan] = await ctx.db.insert(learningPlans).values({
    userId, roleId: role.id, title: `${role.name} learning plan`, learningFormat, weeklyHours, studyDaysPerWeek: studyDays, startDate, deadline,
    projectedEndDate: schedule.projectedEndDate, totalHours: schedule.totalHours, feasible: schedule.feasible, feasibilityNote: schedule.feasibilityNote,
    skippedNodeKeys: schedule.skippedNodeKeys,
  }).returning();
  await persistSchedule(ctx, plan.id, schedule);
  await ctx.db.insert(planRevisions).values({
    planId: plan.id, reason: 'created',
    summary: `Plan created: ${schedule.tasks.length} tasks, ${schedule.totalHours} h, ${schedule.skippedNodeKeys.length} node(s) skipped because already verified.`,
    changes: { skipped: schedule.skippedNodeKeys, previousPlans: previous.map((p) => p.id) },
  });
  return plan;
}

async function ownedPlan(ctx: AppContext, userId: number, planId: number) {
  const [plan] = await ctx.db.select().from(learningPlans).where(and(eq(learningPlans.id, planId), eq(learningPlans.userId, userId)));
  if (!plan) throw notFound('Learning plan');
  return plan;
}

/** Recompute the remaining schedule from today, keeping completed history. */
export async function replan(ctx: AppContext, userId: number, planId: number, reason: string, summary: string, extra: Record<string, unknown> = {}) {
  const plan = await ownedPlan(ctx, userId, planId);
  if (plan.status !== 'active') throw badRequest('Only active plans can be revised');
  const tasks = await ctx.db.select().from(learningTasks).where(eq(learningTasks.planId, planId));
  const doneByNode = new Map<string, { total: number; done: number }>();
  for (const t of tasks.filter((x) => x.type !== 'remedial')) {
    const e = doneByNode.get(t.nodeKey) ?? { total: 0, done: 0 };
    e.total++;
    if (t.status === 'done' || t.status === 'skipped') e.done++;
    doneByNode.set(t.nodeKey, e);
  }
  const completed = new Set([...doneByNode.entries()].filter(([, v]) => v.total > 0 && v.done === v.total).map(([k]) => k));
  const { graph, requirements, marketShare, userSkills } = await planInputs(ctx, userId, plan.roleId, plan.extraSkillSlugs);
  const startDate = todayIso(ctx.now());
  const schedule = buildPlanSchedule({ learningFormat: plan.learningFormat, nodes: graph.nodes, edges: graph.edges, requirements, marketShare, userSkills, weeklyHours: plan.weeklyHours, studyDaysPerWeek: plan.studyDaysPerWeek, startDate, deadline: plan.deadline, completedNodeKeys: completed });

  const before = new Set(tasks.filter((t) => t.status === 'todo' || t.status === 'missed').map((t) => t.nodeKey));
  const after = new Set(schedule.tasks.map((t) => t.nodeKey));
  const keepRemedial = tasks.filter((t) => t.type === 'remedial' && t.status === 'todo');
  await ctx.db.delete(learningTasks).where(and(eq(learningTasks.planId, planId), inArray(learningTasks.status, ['todo', 'missed']), ne(learningTasks.type, 'remedial')));
  await ctx.db.delete(milestones).where(eq(milestones.planId, planId));
  // Offset week indices so history and the new schedule share one timeline.
  const weekOffset = Math.max(0, Math.floor(daysBetween(plan.startDate, startDate) / 7));
  schedule.tasks.forEach((t) => { t.weekIndex += weekOffset; });
  await persistSchedule(ctx, planId, schedule, tasks.length);
  await ctx.db.update(learningPlans).set({ projectedEndDate: schedule.projectedEndDate, totalHours: round(schedule.totalHours + tasks.filter((t) => t.status === 'done').reduce((s, t) => s + t.estimatedHours, 0), 1), feasible: schedule.feasible, feasibilityNote: schedule.feasibilityNote, skippedNodeKeys: schedule.skippedNodeKeys, updatedAt: ctx.now() }).where(eq(learningPlans.id, planId));
  const changes = {
    addedNodes: [...after].filter((k) => !before.has(k)),
    removedNodes: [...before].filter((k) => !after.has(k)),
    previousEndDate: plan.projectedEndDate,
    newEndDate: schedule.projectedEndDate,
    remedialKept: keepRemedial.length,
    ...extra,
  };
  const [rev] = await ctx.db.insert(planRevisions).values({ planId, reason, summary, changes }).returning();
  return rev;
}

export async function setTaskStatus(ctx: AppContext, userId: number, taskId: number, status: 'done' | 'skipped' | 'todo') {
  const [row] = await ctx.db.select({ t: learningTasks, p: learningPlans }).from(learningTasks).innerJoin(learningPlans, eq(learningPlans.id, learningTasks.planId)).where(and(eq(learningTasks.id, taskId), eq(learningPlans.userId, userId)));
  if (!row) throw notFound('Task');
  await ctx.db.update(learningTasks).set({ status, completedAt: status === 'done' ? ctx.now() : null }).where(eq(learningTasks.id, taskId));
  // Milestone completes when all of its tasks are done or skipped.
  if (row.t.milestoneId) {
    const ms = await ctx.db.select({ status: learningTasks.status }).from(learningTasks).where(eq(learningTasks.milestoneId, row.t.milestoneId));
    const allDone = ms.every((t) => t.status === 'done' || t.status === 'skipped');
    await ctx.db.update(milestones).set({ status: allDone ? 'done' : 'pending' }).where(eq(milestones.id, row.t.milestoneId));
  }
  return { ...row.t, status };
}

/** Marks past-due near-term sessions as missed and reschedules from today. */
export async function rescheduleMissed(ctx: AppContext, userId: number, planId: number) {
  await ownedPlan(ctx, userId, planId);
  const today = todayIso(ctx.now());
  const missed = await ctx.db.update(learningTasks).set({ status: 'missed' }).where(and(eq(learningTasks.planId, planId), eq(learningTasks.status, 'todo'), lt(learningTasks.scheduledDate, today))).returning({ id: learningTasks.id });
  if (!missed.length) return { missed: 0, revision: null };
  const revision = await replan(ctx, userId, planId, 'missed_sessions', `${missed.length} missed session(s) rescheduled from ${today}; weekly load kept at the plan's hours.`, { missedTaskIds: missed.map((m) => m.id) });
  return { missed: missed.length, revision };
}

/** Called after an assessment is graded: skip verified nodes, add remedial work for failures. */
export async function applyAssessmentToPlans(ctx: AppContext, userId: number, results: { skillSlug: string; passed: boolean; newStatus: string; feedback: string }[], attemptId: number) {
  const plans = await ctx.db.select().from(learningPlans).where(and(eq(learningPlans.userId, userId), eq(learningPlans.status, 'active')));
  const revisions = [];
  for (const plan of plans) {
    const tasks = await ctx.db.select().from(learningTasks).where(eq(learningTasks.planId, plan.id));
    const relevant = results.filter((r) => tasks.some((t) => t.skillSlug === r.skillSlug) || plan.extraSkillSlugs.includes(r.skillSlug));
    if (!relevant.length) continue;
    const passed = relevant.filter((r) => r.passed);
    const failed = relevant.filter((r) => !r.passed);
    for (const r of passed) {
      // Assessment tasks for the skill are now done; learning tasks are skipped if the skill is verified.
      await ctx.db.update(learningTasks).set({ status: 'done', completedAt: ctx.now() }).where(and(eq(learningTasks.planId, plan.id), eq(learningTasks.skillSlug, r.skillSlug), eq(learningTasks.type, 'assessment'), eq(learningTasks.status, 'todo')));
      if (r.newStatus === 'app_verified') await ctx.db.update(learningTasks).set({ status: 'skipped' }).where(and(eq(learningTasks.planId, plan.id), eq(learningTasks.skillSlug, r.skillSlug), inArray(learningTasks.status, ['todo', 'missed'])));
    }
    const today = todayIso(ctx.now());
    for (const r of failed) {
      const nodeKey = tasks.find((t) => t.skillSlug === r.skillSlug)?.nodeKey ?? `extra:${r.skillSlug}`;
      const name = r.skillSlug.replace(/-/g, ' ');
      await ctx.db.insert(learningTasks).values([
        { planId: plan.id, nodeKey, skillSlug: r.skillSlug, title: `Remedial: review ${name}`, detail: `Focus on the weak areas from assessment #${attemptId}: ${r.feedback}`.slice(0, 800), type: 'remedial', weekIndex: Math.max(0, Math.floor(daysBetween(plan.startDate, today) / 7)), scheduledDate: addDays(today, 1), estimatedHours: 2, sortOrder: tasks.length },
        { planId: plan.id, nodeKey, skillSlug: r.skillSlug, title: `Retake assessment: ${name}`, detail: 'Retake after the review session.', type: 'assessment', weekIndex: Math.max(0, Math.floor(daysBetween(plan.startDate, today) / 7)), scheduledDate: addDays(today, 3), estimatedHours: 1, sortOrder: tasks.length + 1 },
      ]);
    }
    const summary = [
      passed.length ? `Passed: ${passed.map((p) => p.skillSlug).join(', ')} — evidence updated${passed.some((p) => p.newStatus === 'app_verified') ? ', verified nodes skipped and dependents unlocked' : ''}.` : '',
      failed.length ? `Not yet passed: ${failed.map((f) => f.skillSlug).join(', ')} — remedial review and a retake added.` : '',
    ].filter(Boolean).join(' ');
    const reason = failed.length ? 'assessment_failed' : 'assessment_passed';
    revisions.push(await replan(ctx, userId, plan.id, reason, summary, { attemptId, passed: passed.map((p) => p.skillSlug), failed: failed.map((f) => f.skillSlug) }));
  }
  return revisions;
}

/** Skills required by the user's tracked (open) applications that the plan does not cover. */
export async function jobRequirementSuggestions(ctx: AppContext, userId: number, planId: number) {
  const plan = await ownedPlan(ctx, userId, planId);
  const planTasks = await ctx.db.select({ slug: learningTasks.skillSlug }).from(learningTasks).where(eq(learningTasks.planId, planId));
  const graph = await loadRoadmapGraph(ctx, plan.roleId);
  const covered = new Set([...planTasks.map((t) => t.slug), ...graph.nodes.map((n) => n.skillSlug), ...plan.extraSkillSlugs].filter(Boolean) as string[]);
  const apps = await ctx.db.select({ a: jobApplications, j: jobs }).from(jobApplications).innerJoin(jobs, eq(jobs.id, jobApplications.jobId)).where(and(eq(jobApplications.userId, userId), ne(jobApplications.stage, 'closed')));
  const userSkills = await loadUserSkillMap(ctx, userId);
  const names = new Map((await ctx.db.select({ slug: skills.slug, name: skills.name }).from(skills)).map((s) => [s.slug, s.name]));
  const out = new Map<string, { skillSlug: string; skillName: string; jobs: string[] }>();
  for (const { j } of apps) {
    for (const s of j.requiredSkills) {
      if (covered.has(s) || userSkills.get(s)?.status === 'app_verified') continue;
      const e = out.get(s) ?? { skillSlug: s, skillName: names.get(s) ?? s, jobs: [] };
      e.jobs.push(`${j.title} — ${j.company}`);
      out.set(s, e);
    }
  }
  return [...out.values()];
}

export async function addExtraSkills(ctx: AppContext, userId: number, planId: number, slugs: string[]) {
  const plan = await ownedPlan(ctx, userId, planId);
  const merged = [...new Set([...plan.extraSkillSlugs, ...slugs])];
  await ctx.db.update(learningPlans).set({ extraSkillSlugs: merged }).where(eq(learningPlans.id, planId));
  return replan(ctx, userId, planId, 'job_requirements_changed', `Added ${slugs.join(', ')} because tracked job postings require them.`, { addedSkills: slugs });
}

export async function getPlanDetail(ctx: AppContext, userId: number, planId: number) {
  const plan = await ownedPlan(ctx, userId, planId);
  const [role] = await ctx.db.select().from(careerRoles).where(eq(careerRoles.id, plan.roleId));
  const ms = await ctx.db.select().from(milestones).where(eq(milestones.planId, planId)).orderBy(asc(milestones.sortOrder));
  const tasks = await ctx.db.select().from(learningTasks).where(eq(learningTasks.planId, planId)).orderBy(asc(learningTasks.weekIndex), asc(learningTasks.sortOrder));
  const revisions = await ctx.db.select().from(planRevisions).where(eq(planRevisions.planId, planId)).orderBy(desc(planRevisions.createdAt), desc(planRevisions.id));
  const resIds = [...new Set(tasks.flatMap((t) => t.resourceIds))];
  const resources = resIds.length ? await ctx.db.select().from(learningResources).where(inArray(learningResources.id, resIds)) : [];
  const { graph } = await planInputs(ctx, userId, plan.roleId, plan.extraSkillSlugs);
  const optionIds = [...new Set(graph.nodes.flatMap((n) => n.resourceIds))];
  const optionResources = optionIds.length ? await ctx.db.select().from(learningResources).where(inArray(learningResources.id, optionIds)) : [];
  const isYouTube = (url: string) => {
    try { return ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(new URL(url).hostname); } catch { return false; }
  };
  const learningOptions = graph.nodes.filter((n) => n.type !== 'group' && n.type !== 'assessment').map((n) => {
    const linked = optionResources.filter((r) => n.resourceIds.includes(r.id));
    return { nodeKey: n.key, label: n.label, projectBrief: n.practiceTask,
      docs: linked.filter((r) => r.type !== 'video' && !isYouTube(r.url)),
      videos: linked.filter((r) => isYouTube(r.url)),
      series: videoSeriesForSkills(n.skillSlug ? [n.skillSlug] : []),
      youtubeSearchUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${n.label} ${role.name} tutorial`)}`,
    };
  });
  const today = todayIso(ctx.now());
  return {
    plan, role: { slug: role.slug, name: role.name }, milestones: ms, tasks, revisions, resources, learningOptions,
    videoSeries: videoSeriesForSkills(graph.nodes.flatMap((n) => n.skillSlug ? [n.skillSlug] : []), role.slug),
    stats: {
      done: tasks.filter((t) => t.status === 'done').length,
      total: tasks.filter((t) => t.status !== 'skipped').length,
      doneHours: round(tasks.filter((t) => t.status === 'done').reduce((s, t) => s + t.estimatedHours, 0), 1),
      pastDue: tasks.filter((t) => t.status === 'todo' && t.scheduledDate && t.scheduledDate < today).length,
    },
    jobSuggestions: await jobRequirementSuggestions(ctx, userId, planId),
  };
}

export async function changeLearningFormat(ctx: AppContext, userId: number, planId: number, learningFormat: 'docs' | 'project' | 'youtube') {
  const plan = await ownedPlan(ctx, userId, planId);
  if (plan.status !== 'active') throw badRequest('Only active plans can be revised');
  await ctx.db.update(learningPlans).set({ learningFormat, updatedAt: ctx.now() }).where(eq(learningPlans.id, planId));
  return replan(ctx, userId, planId, 'learning_format_changed', `Learning preference changed to ${learningFormat}. Remaining work rescheduled; completed history kept.`, { learningFormat });
}

export async function listPlans(ctx: AppContext, userId: number) {
  return ctx.db.select({ plan: learningPlans, roleName: careerRoles.name, roleSlug: careerRoles.slug }).from(learningPlans).innerJoin(careerRoles, eq(careerRoles.id, learningPlans.roleId)).where(eq(learningPlans.userId, userId)).orderBy(desc(learningPlans.createdAt));
}
