import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import {
  careerFamilies, careerRoles, careerTransitions, jobs, learningPlans, learningResources, learningTasks, roadmapEdges, roadmapNodes, roadmaps,
  roleSkillRequirements, skills,
} from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { loadUserSkillMap } from './evidence.js';

export async function listAtlas(ctx: AppContext) {
  const fams = await ctx.db.select().from(careerFamilies).orderBy(careerFamilies.sortOrder);
  const roles = await ctx.db.select({ id: careerRoles.id, slug: careerRoles.slug, name: careerRoles.name, summary: careerRoles.summary, familyId: careerRoles.familyId }).from(careerRoles);
  const rms = await ctx.db.select({ roleId: roadmaps.roleId, curated: roadmaps.curated }).from(roadmaps);
  const counts = await ctx.db.select({ roleId: jobs.normalizedRoleId, isDemo: jobs.isDemo }).from(jobs).where(and(eq(jobs.status, 'active'), isNull(jobs.ownerUserId)));
  return fams.map((f) => ({
    ...f,
    roles: roles.filter((r) => r.familyId === f.id).map((r) => ({
      ...r,
      roadmap: rms.find((m) => m.roleId === r.id) ? (rms.find((m) => m.roleId === r.id)!.curated ? 'curated' : 'generated') : null,
      activeJobs: counts.filter((c) => c.roleId === r.id && !c.isDemo).length,
      demoJobs: counts.filter((c) => c.roleId === r.id && c.isDemo).length,
    })),
  }));
}

export async function roleDetail(ctx: AppContext, slug: string) {
  const [row] = await ctx.db.select({ role: careerRoles, family: careerFamilies }).from(careerRoles).innerJoin(careerFamilies, eq(careerFamilies.id, careerRoles.familyId)).where(eq(careerRoles.slug, slug));
  if (!row) throw notFound('Role');
  const reqs = await ctx.db.select({ r: roleSkillRequirements, s: skills }).from(roleSkillRequirements).innerJoin(skills, eq(skills.id, roleSkillRequirements.skillId)).where(eq(roleSkillRequirements.roleId, row.role.id));
  const allRoles = await ctx.db.select({ id: careerRoles.id, slug: careerRoles.slug, name: careerRoles.name }).from(careerRoles);
  const trans = await ctx.db.select().from(careerTransitions).where(or(eq(careerTransitions.fromRoleId, row.role.id), eq(careerTransitions.toRoleId, row.role.id)));
  const nameOf = (id: number) => allRoles.find((r) => r.id === id)!;
  const [rm] = await ctx.db.select().from(roadmaps).where(eq(roadmaps.roleId, row.role.id));
  const related = await ctx.db.select({ id: jobs.id, title: jobs.title, company: jobs.company, location: jobs.location, isDemo: jobs.isDemo, postedAt: jobs.postedAt, originSite: jobs.originSite, url: jobs.canonicalUrl })
    .from(jobs).where(and(eq(jobs.normalizedRoleId, row.role.id), eq(jobs.status, 'active'), isNull(jobs.ownerUserId))).orderBy(desc(jobs.lastSeenAt)).limit(8);
  const total = reqs.reduce((s, x) => s + x.r.weight, 0) || 1;
  return {
    role: row.role,
    family: row.family,
    requirements: reqs.map(({ r, s }) => ({ skillSlug: s.slug, skillName: s.name, category: s.category, weight: r.weight, normalizedWeight: Math.round((r.weight / total) * 1000) / 1000, requiredLevel: r.requiredLevel, critical: r.critical })).sort((a, b) => Number(b.critical) - Number(a.critical) || b.weight - a.weight),
    transitionsFrom: trans.filter((t) => t.toRoleId === row.role.id).map((t) => ({ ...t, role: nameOf(t.fromRoleId) })),
    transitionsTo: trans.filter((t) => t.fromRoleId === row.role.id).map((t) => ({ ...t, role: nameOf(t.toRoleId) })),
    collaborators: row.role.details.collaboration.map((c) => ({ ...c, name: allRoles.find((r) => r.slug === c.roleSlug)?.name ?? c.roleSlug })),
    roadmap: rm ? { title: rm.title, curated: rm.curated } : null,
    relatedJobs: related,
  };
}

export async function careerMap(ctx: AppContext) {
  const roles = await ctx.db.select({ id: careerRoles.id, slug: careerRoles.slug, name: careerRoles.name, familyId: careerRoles.familyId }).from(careerRoles);
  const fams = await ctx.db.select().from(careerFamilies).orderBy(careerFamilies.sortOrder);
  const trans = await ctx.db.select().from(careerTransitions);
  const skillRows = await ctx.db.select({ slug: skills.slug, name: skills.name }).from(skills);
  return {
    families: fams.map((f) => ({ slug: f.slug, name: f.name, id: f.id })),
    nodes: roles.map((r) => ({ slug: r.slug, name: r.name, family: fams.find((f) => f.id === r.familyId)!.slug })),
    edges: trans.map((t) => ({
      from: roles.find((r) => r.id === t.fromRoleId)!.slug, to: roles.find((r) => r.id === t.toRoleId)!.slug, difficulty: t.difficulty, typicalMonths: t.typicalMonths, rationale: t.rationale,
      transferableSkills: t.transferableSkills.map((s) => skillRows.find((x) => x.slug === s)?.name ?? s),
    })),
  };
}

export type NodeStatus = 'not_started' | 'learning' | 'assessment_required' | 'app_verified' | 'completed';

export async function roadmapForUser(ctx: AppContext, roleSlug: string, userId: number | null) {
  const [role] = await ctx.db.select().from(careerRoles).where(eq(careerRoles.slug, roleSlug));
  if (!role) throw notFound('Role');
  const [rm] = await ctx.db.select().from(roadmaps).where(eq(roadmaps.roleId, role.id));
  if (!rm) throw notFound('Roadmap');
  const nodes = await ctx.db.select({ n: roadmapNodes, slug: skills.slug }).from(roadmapNodes).leftJoin(skills, eq(skills.id, roadmapNodes.skillId)).where(eq(roadmapNodes.roadmapId, rm.id));
  const edges = await ctx.db.select().from(roadmapEdges).where(eq(roadmapEdges.roadmapId, rm.id));
  const resIds = [...new Set(nodes.flatMap((x) => x.n.resourceIds))];
  const resources = resIds.length ? await ctx.db.select().from(learningResources).where(inArray(learningResources.id, resIds)) : [];
  const reqs = await ctx.db.select({ slug: skills.slug, level: roleSkillRequirements.requiredLevel, critical: roleSkillRequirements.critical }).from(roleSkillRequirements).innerJoin(skills, eq(skills.id, roleSkillRequirements.skillId)).where(eq(roleSkillRequirements.roleId, role.id));

  const us = userId ? await loadUserSkillMap(ctx, userId) : new Map();
  const plan = userId ? (await ctx.db.select().from(learningPlans).where(and(eq(learningPlans.userId, userId), eq(learningPlans.roleId, role.id), eq(learningPlans.status, 'active'))))[0] : undefined;
  const tasks = plan ? await ctx.db.select().from(learningTasks).where(eq(learningTasks.planId, plan.id)) : [];

  const status = new Map<string, NodeStatus>();
  const levelFor = (slug: string | null) => reqs.find((r) => r.slug === slug)?.level ?? 3;
  for (const { n, slug } of nodes.filter((x) => x.n.type !== 'assessment')) {
    const nt = tasks.filter((t) => t.nodeKey === n.key && t.type !== 'remedial');
    const anyDone = nt.some((t) => t.status === 'done');
    const allDone = nt.length > 0 && nt.filter((t) => t.type !== 'assessment').every((t) => t.status === 'done' || t.status === 'skipped');
    if (n.type === 'skill' && slug) {
      const s = us.get(slug);
      if (s?.status === 'app_verified' && (s.proficiency ?? 0) >= levelFor(slug) - 0.5) status.set(n.key, 'app_verified');
      else if (allDone || s) status.set(n.key, 'assessment_required');
      else if (anyDone) status.set(n.key, 'learning');
      else status.set(n.key, 'not_started');
    } else {
      status.set(n.key, allDone ? 'completed' : anyDone ? 'learning' : 'not_started');
    }
  }
  for (const { n } of nodes.filter((x) => x.n.type === 'assessment')) {
    const preds = edges.filter((e) => e.toKey === n.key).map((e) => status.get(e.fromKey));
    status.set(n.key, preds.length && preds.every((p) => p === 'app_verified') ? 'app_verified' : preds.some((p) => p && p !== 'not_started') ? 'assessment_required' : 'not_started');
  }
  const satisfied = (s?: NodeStatus) => s === 'app_verified' || s === 'completed';
  return {
    role: { slug: role.slug, name: role.name },
    roadmap: rm,
    planId: plan?.id ?? null,
    nodes: nodes.map(({ n, slug }) => {
      const req = reqs.find((r) => r.slug === slug);
      const preds = edges.filter((e) => e.toKey === n.key).map((e) => e.fromKey);
      const s = slug ? us.get(slug) : undefined;
      return {
        key: n.key, type: n.type, label: n.label, group: n.groupKey, skillSlug: slug, description: n.description, learningOutcome: n.learningOutcome,
        estimatedHours: n.estimatedHours, practiceTask: n.practiceTask, verificationMethod: n.verificationMethod, x: n.x, y: n.y,
        resources: resources.filter((r) => n.resourceIds.includes(r.id)),
        status: status.get(n.key) ?? 'not_started',
        prerequisites: preds,
        locked: preds.some((p) => !satisfied(status.get(p))),
        requirement: req ? { level: req.level, critical: req.critical } : null,
        gap: !!req && status.get(n.key) !== 'app_verified',
        evidence: s ? { status: s.status, proficiency: s.proficiency, reason: s.reason } : null,
        tasks: tasks.filter((t) => t.nodeKey === n.key).map((t) => ({ id: t.id, title: t.title, status: t.status, type: t.type })),
      };
    }),
    edges: edges.map((e) => ({ from: e.fromKey, to: e.toKey })),
  };
}
